# Repro — `executeJob` can't pass binary params to `pary`

Concrete inputs to reproduce the bug, plus expected outcomes before/after
the fix. Drop this into the ediabasx ticket so anyone can verify.

## Test inputs

| Field      | Value                                                                                       |
|------------|---------------------------------------------------------------------------------------------|
| SGBD file  | `C_KMB46.prg` (E46 instrument cluster coding SGBD)                                          |
| Job        | `C_S_LESEN`                                                                                 |
| Job kind   | Binbuf-driven read (BEST2 reads its arg via `pary` at the very top of the entry point)      |
| Param size | 54 bytes (22-byte CABI request header + 16×2-byte scratchpad)                               |

### Param bytes (hex)

```
01 02 00 00 00 00 00 00 00 00 00 00 00 00 00 10
00 20 00 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
00 00 00 00 00 00
```

As a single hex string for clipboard friendliness:

```
0102000000000000000000000000001000200000000000000000000000000000000000000000000000000000000000000000000000000000
```

### Param byte-by-byte decode (mirrors NCSEXPER's `MakeHeader` in `FUN_00443ec0`)

| Offset | Bytes        | Meaning                                                 |
|--------|--------------|---------------------------------------------------------|
| 0      | `01`         | type = 1 ("read request")                               |
| 1      | `02`         | WortBreite = 2 (16-bit word width)                      |
| 2      | `00`         | ByteFolge = 0 (low byte first)                          |
| 3      | `00`         | AdrMode  = 0 (linear)                                   |
| 4–14   | zeros        | reserved                                                |
| 15     | `10`         | word count = 16 (low byte)                              |
| 16     | `00`         | word count = 16 (high byte)                             |
| 17     | `20`         | start address = 0x0020 (low byte)                       |
| 18     | `00`         | start address (mid byte)                                |
| 19–21  | zeros        | reserved + "overlap" byte the SGBD writes response[0] to |
| 22–53  | zeros        | 32-byte scratchpad — SGBD overwrites with ECU data       |

Total = 22 + 16 × 2 = **54 bytes**.

## How the test should call ediabasx

### Today (broken — strings only)

```ts
import { Ediabas } from "@emdzej/ediabasx-ediabas";

const ediabas = new Ediabas({ /* transport, ecuPath, … */ });
await ediabas.loadSgbd("C_KMB46");

// 54-byte para encoded as a hex string — what we have to do today because
// executeJob only accepts string[].
const paraHex =
  "0102000000000000000000000000001000200000000000000000000000000000000000000000000000000000000000000000000000000000";

const sets = await ediabas.executeJob("C_S_LESEN", { params: [paraHex] });
const status = sets[0]?.find((r) => r.name === "JOB_STATUS")?.value;
console.log(status);
// Today's output: "ERROR_NO_BIN_BUFFER"
// — the SGBD's `pary S1; jz ERROR_NO_BIN_BUFFER` triggers because
// `ParameterSet.binaryPayload` is empty.
```

### After the fix (accepts `Uint8Array`)

```ts
const para = new Uint8Array([
  0x01, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x10, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const sets = await ediabas.executeJob("C_S_LESEN", { params: [para] });
const status = sets[0]?.find((r) => r.name === "JOB_STATUS")?.value;
const codierDaten = sets[0]?.find((r) => r.name === "CODIER_DATEN")?.value;
// After fix, with a real cable connected:
//   status      = "OKAY"
//   codierDaten = Uint8Array (54 bytes: original 22-byte header echo,
//                 plus 32 bytes of real ECU data at offset 0x15)
// After fix, no cable / sim interface:
//   status      = IFH_0017 or ECU_TIMEOUT or similar
//                 (anything but ERROR_NO_BIN_BUFFER — the `pary` check passed)
```

## Pass / fail criteria

The single observable that decides whether the fix works:

| `JOB_STATUS`           | Meaning                                                       |
|------------------------|---------------------------------------------------------------|
| `ERROR_NO_BIN_BUFFER`  | **FAIL** — binary payload never reached `pary`.               |
| Anything else          | **PASS** — bytes made it into `binaryPayload`, SGBD progressed past the input-validation gate. With a real cable: expect `OKAY` + a populated `CODIER_DATEN`. Without a cable: expect an EDIABAS transport / ECU-comm error, which still means binary-param routing works. |

No actual ECU access is required to verify the fix — `ERROR_NO_BIN_BUFFER`
is emitted by the SGBD's *input-validation* prologue, before any
`xsend` on the wire. As soon as `pary` sees a non-empty payload, the
SGBD progresses past the gate.

## Where the failing call originates (for context)

NCSX's `@emdzej/ncsx-inpax-cabi-provider` `CDHapiJobData` builds the
binbuf packet from NCSEXPER's CABI slot-table + `MakeHeader`
convention, then calls:

```ts
const hex = bytesToHex(buf.bytes.subarray(0, n));
await this.ctx.ediabas.executeJob(job, { params: [hex] });
```

`job` is `C_S_LESEN` (or `C_S_SCHREIBEN` / `C_S_AUFTRAG` for the write
side). The SGBD's BEST2 prologue (see `C_KMB46.prg::C_S_LESEN` at
`0x6250` in disasm) is:

```
clear S1
pary S1            ; pop binary parameter into S1
jz ERROR_NO_BIN_BUFFER
```

When `params[0]` arrives as a string, `ParameterSet.binaryPayload` stays
empty; `pary` reads zero length; the jump fires; the SGBD emits
`JOB_STATUS=ERROR_NO_BIN_BUFFER` and returns.

## Proposed fix (recap)

```ts
// ediabas.js executeJobRaw / executeJob options.params loop
for (let i = 0; i < params.length; i++) {
  const p = params[i];
  parameters.set(
    i,
    p instanceof Uint8Array
      ? { kind: "binary", value: p }
      : { kind: "string", value: p },
  );
}
```

Plus widen `executeJob`'s typed options:

```ts
params?: (string | Uint8Array)[];
```

Backward-compatible — existing string-array callers keep working.
