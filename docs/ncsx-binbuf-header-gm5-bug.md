# `CDHGetApiJobData` binbuf header missing `payloadBytes` field → GM5 (and any `wortBreite=1` chassis) fails with `ERROR_BIN_BUFFER`

## TL;DR

`inpax-cabi-provider/src/provider.ts` builds the binbuf packet that NCSEXPER's
IPO scripts pass to the SGBD via `pary`. Our packet writes `wordCount` at
`packet[15..16]`, which the KMB46R-family `C_S_*` SGBDs read — they're fine.
The GM5-family `C_C_*` SGBDs read **`payloadBytes` from `packet[13..14]`**
instead, and we never write anything there, so the SGBD's `slen S2; comp L0, #$16`
length check sees `expected = 22 + 0 = 22, actual = 22 + N*WB`, and fails with
`JOB_STATUS = "ERROR_BIN_BUFFER"`.

NCSEXPER's `CDHGetApiJobData` (`FUN_004440f0`) writes **both** fields
unconditionally — `packet[13..14] = N*WB` *and* `packet[15..16] = N` — so
either SG family's `slen` check passes. We need to do the same.

Also: NCSEXPER writes a `0x03` terminator at `packet[21 + N*WB]` (the last
byte of the buffer). KMB tolerates a zero there, but it's part of the
reference layout — set it for completeness.

Affects: every `wortBreite == 1` ECU (E46 GM5, ZKE, etc. — most pre-2003
"narrow" modules). `wortBreite >= 2` chassis (KMB46R, AKMB, MFL, …) keep
working unchanged because they only read `packet[15..16]`.

Discovered while wiring NCS Expert's GM5 coding flow on top of the KMB
write path that landed in ncsx@(commit 71450f9). Same `ERROR_BIN_BUFFER`
shape as the earlier KMB write bug — but a different field of the header,
exposed by a different SG family.

## Where the bug is

`packages/inpax-cabi-provider/src/provider.ts`, function `CDHGetApiJobData`,
around lines 597–639 (the packet-construction block — comment anchor:
*"22-byte header — mirrors NCSEXPER's MakeHeader (FUN_00443ec0)"*).

Current code:

```ts
const totalLen = 22 + payloadLen;
const packet = new Uint8Array(totalLen);
packet[0] = 1;                          // data type
packet[1] = wortBreite;
packet[2] = byteFolge;
packet[3] = adrMode;
// bytes 4..14 stay zero                 ← packet[13..14] is in here, left as 0
packet[15] = wordCount & 0xff;          // wordCount LE
packet[16] = (wordCount >> 8) & 0xff;
const wireAddr = (startAddr / wortBreite) | 0;
packet[17] = wireAddr & 0xff;
packet[18] = (wireAddr >> 8) & 0xff;
// bytes 19..20 stay zero
for (let i = 0; i < actualLen; i++) {
  packet[0x15 + i] = this.slots[this.slotCursor + i]!.value & 0xff;
}
// packet[21 + payloadLen] is the trailing terminator — currently stays 0
```

## Why KMB works and GM5 doesn't — bytecode evidence

Disassembled `inpa/EDIABAS/Ecu/C_GM5.prg` (job `C_C_LESEN` @ `0x2511`) and
`KOMBI46R.prg` (job `C_S_LESEN` @ `0x1DBBD`). Looking at which header
offsets each SGBD's BEST/2 bytecode references via `move B0, S1[L1]` with
constant `L1`:

| Offset | KMB `C_S_LESEN` references? | GM5 `C_C_LESEN` references? | Field |
|---|---|---|---|
| `#$D` (13) | no | **yes** | wordCount LE — but GM5 reads it as `payloadBytes` directly |
| `#$E` (14) | no | **yes** | (high byte of the same field) |
| `#$F` (15) | **yes** | no | wordCount LE — KMB multiplies by `wortBreite` |
| `#$10` (16) | **yes** | no | (high byte of the same field) |
| `#$11` (17) | yes | yes | wireAddr LE (both families) |
| `#$12` (18) | yes | yes | (high byte of the same field) |
| `#$15` (21) | yes | yes | data area start (both families) |

Both SGBDs converge on the same `slen` formula `total == 22 + N*WB`:

- **KMB** (`wortBreite=2`): reads `wordCount` from `packet[15..16]`, computes
  `22 + wordCount * wortBreite = 22 + 8*2 = 38` → matches our 38-byte
  packet. ✓
- **GM5** (`wortBreite=1`): reads `payloadBytes` from `packet[13..14]`,
  computes `22 + payloadBytes`. With our current code, `packet[13..14] = 0`
  (we never write there) → expected `22 + 0 = 22`, actual `30`,
  `ERROR_BIN_BUFFER`. ✗

For `wortBreite = 1`, `wordCount` and `payloadBytes` happen to be equal,
which is presumably why NCSEXPER never had to branch — the same N value
satisfies both fields when WB=1, and the wider chassis carry the WB
multiplier in the SGBD's own `slen` check.

## What NCSEXPER actually writes — Ghidra evidence

Decompile of `NCSEXPER.EXE` (decompiled functions):

- **`MakeHeader` (`FUN_00443ec0`)** — sets up the first 4 bytes via
  `CONCAT13` of (data type, wortBreite, byteFolge, adrMode), and on
  write packets (param == 1) calls `memset(&packet[9], 0xFF, wortBreite)`
  (the mask area).

- **`CDHGetApiJobData` (`FUN_004440f0`)** — does the per-call buffer fill.
  The fields we care about:

  ```c
  // Read path (`*param_5 = 1`):
  local_20 = (&DAT_0072edc8)[DAT_007311d0 * 2];   // first slot byte-addr
  uVar3 = 0;  uVar4 = 0;
  do {
      ...
      FUN_00443cb0();                              // per-slot: writes wireAddr
      uVar3 = uVar3 + DAT_00730dc8;                // += wortBreite
      uVar4 = uVar4 + 1;                           // ++ wordCount
  } while (...);

  DAT_00730ddd     = (undefined2)uVar3;            // packet[13..14] = N * WB  (LE)

  // Write path (`*param_5 = 2`):
  iVar1 = FUN_00443cf0(&local_20);                 // WriteMaskData
  DAT_00730ddd     = (undefined2)local_20;         // packet[13..14] = mask-data LE
  uVar4 = 1;
  uVar3 = DAT_00730dc8;                            // wortBreite

  // Common to both paths (right before SendBinBuf):
  (&DAT_00730de5)[uVar3] = 3;                      // packet[21 + uVar3] = 0x03  (terminator)
  *param_3                = uVar3 + 0x16;          // bufSize = 22 + N*WB
  _DAT_00730ddf           = uVar4;                 // packet[15..16] = wordCount (or 1) LE
  ```

Buffer base is `DAT_00730dd0`. Offsets I'm reading off the addresses:

| Symbol | Offset from base | Field |
|---|---|---|
| `DAT_00730dd0` | 0 | data type / wortBreite / byteFolge / adrMode (`MakeHeader`) |
| `DAT_00730dd9` | 9 | mask `0xFF…` (write only; `memset` in `MakeHeader`) |
| `DAT_00730ddd` | **13** | **`payloadBytes` LE (read) / `WriteMaskData` result (write)** |
| `DAT_00730ddf` | 15 | wordCount LE |
| `DAT_00730de5` | 21 | data area start (also used as `(base+21)[uVar3] = 3` terminator) |

So NCSEXPER unconditionally lays both `payloadBytes` *and* `wordCount`, plus
the `0x03` terminator. Our impl writes only `wordCount` and leaves both the
other field and the terminator at zero.

## Reproduction

### A. Smallest log-level repro

Trigger any `wortBreite == 1` ECU coding read flow. Concrete: pick GM5 in
ncsx-web → "Read coding" → console shows:

```
[CDHapiJob] ecu=C_GM5 job=IDENT params(0)=[]
[CDHapiJobData] ecu=C_GM5 job=C_C_LESEN bufHandle=1 buf.size=30 bytes=010100000000000000000000000000080000000000000000000000000000
[CDHapiJobData] ← job=C_C_LESEN JOB_STATUS=ERROR_BIN_BUFFER sets=1
```

Note `packet[13..14] = 00 00` and `packet[15..16] = 08 00`. The fix flips
`packet[13..14] = 08 00` as well; after which `JOB_STATUS = OKAY`.

For comparison the KMB case (working today): `wortBreite = 2`, packet is
38 bytes, `packet[15..16] = 08 00` (wordCount), `packet[17..18] = 10 00`
(wireAddr block 0x10). KMB never reads `[13..14]` so its zero state is fine.

### B. Bytecode-level repro (no real hardware needed)

`pnpm --filter @emdzej/ediabasx-cli build && node /Users/<you>/Projects/my/ediabasx/apps/cli/dist/index.js disasm /Users/<you>/Downloads/inpa/EDIABAS/Ecu/C_GM5.prg > /tmp/C_GM5.dis`

Look at C_C_LESEN @ `0x2511`, specifically the length-check block at
`0x26CC..0x273C`:

```
move S1, S2
slen L0, S2                       # L0 = sLen(buffer)
push L0; pop L1                   # L1 = sLen
push L1
move L0, #$16.L                   # L0 = 22
push L0
clear L0
move I0, S0[#$1]                  # I0 = packet[13..14] (LE)  ← what we leave as 0
...
adds L0, L1                       # L0 = 22 + I0
comp L0, L1                       # compare against sLen
jnz  __00002733                   # not equal → ERROR_BIN_BUFFER
...
move S1, "ERROR_BIN_BUFFER"
```

`move I0, S0[#$1]` ultimately reads from `packet[13..14]` (the SGBD copied
those bytes into `S0[1..2]` earlier via the `move L0, #$D / #$E` reads).
That field is the entire input to the formula `22 + X`. With `X = 0` the
check rejects any non-22-byte buffer.

## Proposed fix

Two one-line additions in `CDHGetApiJobData` packet construction:

```ts
// inpax-cabi-provider/src/provider.ts, around line 605
const totalLen = 22 + payloadLen;
const packet = new Uint8Array(totalLen);
packet[0] = 1;
packet[1] = wortBreite;
packet[2] = byteFolge;
packet[3] = adrMode;

// NEW — payloadBytes at packet[13..14] LE.
//
// Mirrors NCSEXPER's `DAT_00730ddd = (undefined2)uVar3` in
// CDHGetApiJobData (FUN_004440f0), where uVar3 is the per-loop
// accumulator of `wortBreite` per slot — equal to N*WB in the read
// path.
//
// Required for `wortBreite == 1` SG families (GM5 C_C_*): their
// `slen S2; comp L0, #$16` length check reads this field as the
// expected-extra-bytes value and computes `slen == 22 +
// packet[13..14]_LE`. Without this our packets fail
// `ERROR_BIN_BUFFER`.
//
// Harmless for `wortBreite >= 2` SG families (KMB C_S_*) which read
// wordCount from packet[15..16] instead and apply their own
// multiplication by wortBreite.
packet[13] = payloadLen & 0xff;
packet[14] = (payloadLen >> 8) & 0xff;

packet[15] = wordCount & 0xff;
packet[16] = (wordCount >> 8) & 0xff;

const wireAddr = (startAddr / wortBreite) | 0;
packet[17] = wireAddr & 0xff;
packet[18] = (wireAddr >> 8) & 0xff;

for (let i = 0; i < actualLen; i++) {
  packet[0x15 + i] = this.slots[this.slotCursor + i]!.value & 0xff;
}

// NEW — terminator `0x03` at the last byte of the buffer.
//
// Mirrors NCSEXPER's `(&DAT_00730de5)[uVar3] = 3` — `packet[21 +
// payloadBytes]`. KMB tolerates a zero here (we left it zero for the
// 16-chunk write loop and writes still succeeded), so this is more of
// a "match the reference" than a known-required field; flip it on
// while we're touching the function so future SGBD families don't
// surprise us.
packet[21 + payloadLen] = 3;
```

Plus the existing `writeBinBuf` call goes through unchanged.

The narrow (GM5) and wide (KMB) chassis now satisfy the same packet shape:

```
KMB46R, N=8, WB=2 (payloadLen=16, totalLen=38):
  packet[13..14] = 10 00   (= 16 LE)   ← NEW (was 00 00)
  packet[15..16] = 08 00   (= 8 LE)
  packet[37]     = 03                  ← NEW (was 00)
  KMB SGBD: reads [15..16]=8, formula 22+8*2=38 → matches sLen → OK

GM5, N=8, WB=1 (payloadLen=8, totalLen=30):
  packet[13..14] = 08 00   (= 8 LE)    ← NEW (was 00 00)
  packet[15..16] = 08 00   (= 8 LE)
  packet[29]     = 03                  ← NEW (was 00)
  GM5 SGBD: reads [13..14]=8, formula 22+8=30 → matches sLen → OK
```

## Suggested regression test

Stand-alone unit test against `CDHGetApiJobData` with a seeded slot table
and asserted packet bytes — no need to round-trip through ediabasx:

```ts
import { describe, expect, it } from "vitest";
import { CabiProvider } from "./provider";

describe("CDHGetApiJobData binbuf header", () => {
  it("writes payloadBytes at [13..14] and wordCount at [15..16] for wortBreite=2 (KMB shape)", async () => {
    const provider = makeProviderWithSlots({
      wortBreite: 2,
      startAddr: 0x10,
      records: 8,
    });
    const packet = captureBinBufWrite(() => provider.CDHGetApiJobData(8, 1));

    expect(packet[13]).toBe(0x10);  // payloadBytes = 16 LE
    expect(packet[14]).toBe(0x00);
    expect(packet[15]).toBe(0x08);  // wordCount = 8 LE
    expect(packet[16]).toBe(0x00);
    expect(packet[17]).toBe(0x08);  // wireAddr = startAddr/WB = 8
    expect(packet[18]).toBe(0x00);
    expect(packet[packet.length - 1]).toBe(0x03);   // terminator
    expect(packet.length).toBe(22 + 16);
  });

  it("writes payloadBytes at [13..14] for wortBreite=1 (GM5 shape)", async () => {
    const provider = makeProviderWithSlots({
      wortBreite: 1,
      startAddr: 0,
      records: 8,
    });
    const packet = captureBinBufWrite(() => provider.CDHGetApiJobData(8, 1));

    expect(packet[13]).toBe(0x08);  // payloadBytes = 8 LE
    expect(packet[14]).toBe(0x00);
    expect(packet[15]).toBe(0x08);  // wordCount = 8 LE (equal because WB=1)
    expect(packet[16]).toBe(0x00);
    expect(packet[packet.length - 1]).toBe(0x03);
    expect(packet.length).toBe(22 + 8);
  });

  it("real GM5 packet now satisfies its SGBD's `slen == 22 + packet[13..14]` check", () => {
    const provider = makeProviderWithSlots({
      wortBreite: 1,
      startAddr: 0,
      records: 8,
    });
    const packet = captureBinBufWrite(() => provider.CDHGetApiJobData(8, 1));

    const payloadBytesLE = packet[13] | (packet[14] << 8);
    expect(packet.length).toBe(22 + payloadBytesLE);
  });
});
```

(`makeProviderWithSlots` and `captureBinBufWrite` are placeholders for
whatever helpers the existing `CabiProvider` test setup uses — adjust to
match house style.)

## Why this didn't surface earlier

The KMB write flow landed first because that's what the user was coding.
KMB is `wortBreite=2`, `C_S_*` job family. Those SGBDs only read
`packet[15..16]` (which we set correctly), `packet[17..18]` (wireAddr —
also correct), and `packet[21..]` (data area). They never look at
`packet[13..14]` and don't enforce the terminator. So our impl passed the
length check by reading from a field we *do* populate.

The very first time we tried a `wortBreite=1` chassis (GM5), its SGBD
reached for the other field and saw our zero — failing the same
`ERROR_BIN_BUFFER` check that bit us during the KMB write debugging, but
via a different missing field.

## Out-of-scope follow-ups (separate from this fix)

- The user reports NCSEXPERT itself "thinks GM5 is coding index 05" and
  fails to read GM5 — that's a *NCSEXPERT-side* SGFAM / SG-resolution
  issue, not an ncsx packet-layout issue. The fix above unblocks ncsx
  against the real SGBD; NCSEXPERT's own mis-identification is a
  separate investigation (probably in `reference_ncsexper_sg_resolution.md`
  territory).
- The `0xFF` mask area at `packet[9..(8+WB)]` is only written by
  NCSEXPER's `MakeHeader` on write packets (its `unaff_EBX == 1`
  branch). We don't write it. KMB writes work, so it's apparently not
  required for the BEST/2 jobs we drive — but worth checking against the
  C_C_AUFTRAG bytecode for GM5 once `C_C_LESEN` works, in case the write
  path needs it.
- The user mentioned "netto read from GM5 is all 00" — likely just a
  consequence of the read job failing with `ERROR_BIN_BUFFER` and our
  upstream code defaulting unread slots to zero. Confirm the read now
  returns real bytes after the fix lands.
