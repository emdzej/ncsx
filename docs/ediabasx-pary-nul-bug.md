# `pary` corrupts binary payload length by appending a NUL terminator

## TL;DR

ediabasx's `pary` opcode routes the binary parameter through `setStringValue`, which appends a `\0` byte unless the payload already ends in one. This silently grows the destination S register by 1 byte whenever the payload's last byte isn't `0x00`, breaking `slen S` and any length-comparison the SGBD performs on the input.

Affects: any BEST2 job that reads a binary parameter via `pary` *and* validates the buffer length (or otherwise depends on `slen`).

Discovered while porting BMW NCS Expert's coding flow — `CODIERDATEN_LESEN` works, `SG_CODIEREN` fails with `JOB_STATUS=ERROR_BIN_BUFFER` purely because of this 1-byte skew.

## Root cause

```ts
// packages/interpreter/src/operations/parameters.ts (pary)
export function pary(
  registers: RegisterSet,
  flags: Flags,
  parameters: ParameterSet,
  destination: StringRegisterRef
): void {
  const payload = parameters.getBinaryPayload();
  flags.z = payload.length === 0;
  setStringValue(registers, destination, cp1252ToUtf8(payload));   // ← here
}
```

```ts
// packages/interpreter/src/operations/register-values.ts (setStringValue)
export function setStringValue(
  registers: RegisterSet,
  ref: StringRegisterRef,
  value: string
): void {
  // Mirror C# Operand.SetStringData: append a trailing NUL byte so the
  // stored buffer's logical length includes the terminator. (…)
  const normalized = value.endsWith("\0") ? value : value + "\0";
  registers.setS(ref.index, normalized);
}
```

The NUL-append is correct for *string* assignments (preserves the C# `scmp` length-aware compare semantics — an IMM_STR `"2"` is stored as `[0x32, 0x00]` length 2). It's wrong for `pary`, whose contract is "load the raw binary param as bytes" (see the comment in `ediabas.ts:73`: *"Binary — read by `pary` (full buffer as bytes)"*).

`parb` / `parw` / `parl` aren't affected (they go through `setIntValue`). `pars` actually wants the string semantics. **Only `pary` is broken.**

## Reproduction

### A. Smallest unit-test repro

Two-byte binary payloads — one ending in `0x00`, one not. After `pary` the S register lengths should be equal; today they differ by 1.

```ts
import { describe, it, expect } from "vitest";
import { RegisterSet, Flags, ParameterSet, pary, pushParameterBinary } from "@emdzej/ediabasx-interpreter";

describe("pary preserves binary payload length", () => {
  function readBack(payload: Uint8Array) {
    const regs = new RegisterSet();
    const flags = new Flags();
    const params = new ParameterSet();
    pushParameterBinary(params, 1, payload);
    pary(regs, flags, params, { kind: "S", index: 1 });
    return regs.getSBinary(1);
  }

  it("payload ending in 0x00 is preserved verbatim", () => {
    const payload = new Uint8Array([0x12, 0x34, 0x00]);   // length 3
    const out = readBack(payload);
    expect(Array.from(out)).toEqual([0x12, 0x34, 0x00]);  // currently: PASS
    expect(out.length).toBe(3);
  });

  it("payload ending in non-zero is also preserved verbatim", () => {
    const payload = new Uint8Array([0x12, 0x34, 0x89]);   // length 3
    const out = readBack(payload);
    expect(Array.from(out)).toEqual([0x12, 0x34, 0x89]);  // currently: FAIL
    expect(out.length).toBe(3);                            // currently: 4 (NUL appended)
  });

  it("terminator-style payload preserves length", () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);   // ends in 0x03
    const out = readBack(payload);
    expect(out.length).toBe(3);                            // currently: 4
  });
});
```

### B. End-to-end repro with a real SGBD job

Use `C_KMB46.prg` from `INPA/EDIABAS/Ecu/`, job `C_S_SCHREIBEN`. Build a 38-byte coding-write request: 22 header bytes + 16 payload bytes (8 words × `wortBreite=2`).

| Offset | Bytes | Meaning |
|---|---|---|
| 0 | `01` | data type (1 = read packet; SCHREIBEN's `S2[0]==1` branch) |
| 1 | `02` | wortBreite |
| 2..3 | `00 00` | byteFolge, adrMode |
| 4..14 | `00…` | reserved |
| 15..16 | `08 00` | wordCount = 8 (LE) |
| 17..18 | `38 00` | wireAddr (block address) = 0x38 |
| 19..21 | `00 00 00` | reserved |
| 22..37 | data | 16 write bytes |

SCHREIBEN does `slen L0, S2; comp L0, (0x16 + wordCount*wortBreite); jnz ERROR_BIN_BUFFER`. The 22+16 = 38 byte expectation only matches our 38-byte payload **if the S register length isn't grown by `pary`**.

Two payloads that exercise both paths:

```text
# Case A — last byte = 0x00 → passes today
01 02 00 00 00 00 00 00 00 FF FF 00 00 00 00 00
08 00 38 00 00 00 00      # header
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00  # 16 zero payload bytes

JOB_STATUS = OKAY (or a downstream error, but NOT ERROR_BIN_BUFFER)

# Case B — last byte ≠ 0x00 → fails today
01 02 00 00 00 00 00 00 00 FF FF 00 00 00 00 00
08 00 38 00 00 00 00      # header (identical to Case A)
89 DB 31 2D 02 04 84 5A 1A 00 50 4D 10 27 70 0A  # real ECU coding bytes

JOB_STATUS = ERROR_BIN_BUFFER          # length check fires
```

Same packet shape, same `wordCount`/`wortBreite`, only the payload contents differ. The 16 bytes in Case B are an actual GETRIEBEART-region coding window from an E46 KMB and end in `0x0A` (non-zero), which is enough to trigger the bug.

### C. Even simpler — a single-job smoke test against ediabasx's own VM

Spin up a minimal BEST2 job:

```text
JOB
  clear S1
  pary S1
  slen L0, S1
  ergs "LEN", L0
  ergs "JOB_STATUS", "OKAY"
  eoj
```

Invoke once with `Uint8Array([0xAA, 0xBB])` and once with `Uint8Array([0xAA, 0x00])`. Both should report `LEN=2`. Today the first reports `LEN=3`, the second `LEN=2`.

## Proposed fix

```ts
// parameters.ts — pary
export function pary(
  registers: RegisterSet,
  flags: Flags,
  parameters: ParameterSet,
  destination: StringRegisterRef
): void {
  const payload = parameters.getBinaryPayload();
  flags.z = payload.length === 0;
  registers.setSBinary(destination.index, payload);   // bypass setStringValue
}
```

`setSBinary` writes the raw bytes directly and sets `sLengths[reg] = payload.length` exactly — no codec round-trip, no NUL terminator. That matches `pary`'s documented contract and is consistent with how `getSBinary` reads on the other side.

## Why this didn't surface earlier

For the BMW coding port, the read flow (`C_S_LESEN`) happens to ship payloads whose last byte is always `0x00` — the IPO pre-fills the binbuf's scratchpad with zeros, knowing the SGBD will overwrite that region with the K-line response. So `value.endsWith("\0")` is true on every read, the NUL-append no-ops, the length stays correct, and the bug stays hidden.

Writes (`C_S_SCHREIBEN`) ship the *actual* ECU bytes in that region, which can be any value. The first byte ≥ `0x01` at the tail of a write packet flips the bug on.

This is also why adding a `0x03` terminator byte at the end of the read packet (the layout NCSEXPER actually uses) breaks reads symmetrically — the symptom isn't read-vs-write, it's "last byte is non-zero."

## Suggested follow-ups (optional, separate from the fix)

- A `RegisterSet`-level assertion when an integrity-critical operation (`scmp`, `slen`, `ergy`) is called on an S register that's been a-bit-of-both: it would catch any future regression of this kind.
- Worth grepping for other call sites that pass binary data through `setStringValue` — `pary` is the only one I spotted, but the same pattern would bite anywhere else binary data goes through the string-write codepath.
````

Wrote it to `docs/ediabasx-pary-nul-bug.md` in the ncsx repo so you have a single file to hand off. Includes the three repro tiers (unit test you can drop into ediabasx's vitest, real-SGBD packet diff, and a smallest-possible BEST2 smoke job), the one-line fix, and the explanation of why reads happened to work despite the bug being present from day one.