# `FAHRGESTELL_NR` system-data — 18-byte (VIN + Mod-36 check char) format

## TL;DR

NCSEXPER's named system-data store keeps the chassis number under
`FAHRGESTELL_NR` as an **18-byte string** — the 17-char VIN followed by
a single BMW-Mod-36 check character. Coding SGBDs that take the chassis
number via `pars` (BMW E46 `GM5::C_FG_AUFTRAG` is the surfaced
example) trip a hard `strlen S, #$12` (= length must equal 18) on the
received string. Seeding the bare 17-char VIN fails with
`JOB_STATUS = "ERROR_NUMBER_ARGUMENT"`.

The check char is computed by NCSEXPER over `"FP" + vin` via a
weighted Mod-36 sum (= alternate chars ×3) → `sum mod 36` → encode
`0..9` as `'0'..'9'`, `10..35` as `'A'..'Z'`. Worked example:
`"FPWBAAA00000PM10277"` → check char `'L'` →
`FAHRGESTELL_NR = "WBAAA00000PM10277L"`.

Affects: any coding write flow whose IPO threads
`FAHRGESTELL_NR` into a SGBD `C_FG_AUFTRAG` (or equivalent
`C_FG_*` job). First observed during NCS Expert's `SG_CODIEREN` flow
on E46 GM5 right after the data write — `C_C_AUFTRAG` returns `OKAY`,
`C_FG_AUFTRAG` then fails because the IPO passes a bare 17-char VIN
into the SGBD's `strlen == 18` gate.

## Where we found it

### IPO side — `A_GM5.ipo` PC `0x008e..0x009a`

```
[008e] LOAD const "FAHRGESTELL_NR"
[008f] PUSHREF local[3]                 ; out: value into local[3]
[0090] PUSHREF local[7]                 ; out: retval into local[7]
[0091] CALL  sys slot 0x2D              ; CDHGetSystemData
[0092] FRAME
[0093] LOAD  local[7]
[0094] CALL  user TestCDHFehler         ; abort if retval != 0
[0095] FRAME
[0096] LOAD  local[1]                   ; ecu = "C_GM5"
[0097] LOAD  const "C_FG_AUFTRAG"
[0098] LOAD  local[3]                   ; para ← the FG string
[0099] LOAD  const ""
[009a] CALL  sys slot 0x0D              ; CDHapiJob
```

The IPO reads the chassis number out of the system-data store and
hands it directly to the SGBD as `para`.

### SGBD side — `C_GM5.prg::C_FG_AUFTRAG` @ `0x1382`

```
[1382] clear  S1
[1385] pars   S1, #$1.I                 ; read string param 1 → S1
[138A] jz     __0000139C                ; empty? → ERROR_NUMBER_ARGUMENT
       ... unwraps S4 ← S1 ...
[13EB] strlen L0, S1                    ; length of received string
[13FB] move   L0, #$12.L                ; 0x12 = 18
[140B] comp   L0, L1                    ; sLen vs 18
[140F] jz     __00001421                ; equal → continue
       push   0
       jump   ...
__0000142A jz __00002499                 ; not-equal → ERROR_NUMBER_ARGUMENT
```

The SGBD's first gate is an **exact length check against 18**. C# /
ediabasx `OpStrlen` returns `GetStringData().Length` — character count
up to (but excluding) the first `0x00`. So the buffer in `S1` has to
be **18 non-zero bytes** for the check to pass.

### Host side — `coapiSetFgNr` (`FUN_0042a560`)

NCSEXPER's MFC side stores the chassis number through `coapiSetFgNr`,
which:

```c
// (1) Strip + uppercase, compute length
__strupr(local_48);
int len = strlen(local_48);          // 7, 17, or 18

// (2) 17-char branch: compute check char and store as <vin><check>
if (len == 0x11) {
    strncpy(local_30, "FP", 3);
    strncat(local_30, local_48, 0x11);          // "FP" + 17-char VIN
    coapiCalcM36CheckSum(local_30, &local_49);   // local_49 = check char
    strncpy(&DAT_0060e9f4, local_48, 0x11);     // copy 17 chars
    DAT_0060ea05 = local_49;                     // 18th byte = check char
}

// (3) 18-char branch: verify supplied 18th char matches CalcMod36
if (len == 0x12) {
    strncpy(local_30, "FP", 3);
    strncat(local_30, local_48, 0x11);
    coapiCalcM36CheckSum(local_30, &local_49);
    if (local_37 != local_49) {                  // input[17] vs computed
        error("FAHRGESTELL_NR check char mismatch");
    }
    strncpy(&DAT_0060e9f4, local_48, 0x13);
}

// (4) Both branches end here — store into the system-data table
CDHSetSystemData("FAHRGESTELL_NR", &DAT_0060e9f4);          // 18 bytes
CDHSetSystemData("FAHRGESTELL_NR_KOMPL", local_30);          // 7 bytes
```

So NCSEXPER never stores the bare VIN — it always pre-computes the
M36 check and appends it before writing into the system-data store.

## The Mod-36 algorithm — `CalcMod36CheckSum` (`FUN_0043e9d0`)

Decompiled assembly:

```asm
XOR EDI,EDI                  ; counter i = 0
XOR ESI,ESI                  ; toggle = 0
XOR EAX,EAX
MOV [EBP-4], EDI             ; sum = 0  (16-bit accumulator)
CMP AX, BX                   ; BX = input length
JNC done                     ; len == 0 → skip loop

loop:
  MOV EAX, [EBP+0x8]         ; EAX = input ptr
  MOVZX EDX, DI              ; EDX = i
  MOV AL, [EDX+EAX]          ; AL = input[i]
  LEA ECX, [EBP+0xf]
  PUSH ECX
  CALL DecodeCharToBin       ; '0'..'9'→0..9, 'A'..'Z'→10..35
  ADD ESP, 4
  TEST AX, AX
  JNZ err                    ; invalid char → 0x41 error

  TEST SI, SI                ; toggle?
  JNZ skip_mul               ; toggle == 1 → skip ×3
  MOV AL, [EBP+0xf]
  MOV CL, AL
  ADD CL, CL                 ; CL = v*2
  ADD AL, CL                 ; AL = v*3
  MOV [EBP+0xf], AL

skip_mul:
  MOVZX EDX, byte [EBP+0xf]
  ADD word [EBP-4], DX       ; sum (word) += weighted value

  MOV EAX, 1
  SUB EAX, ESI               ; toggle = 1 - toggle
  INC EDI                    ; i++
  MOVZX ESI, AX

  CMP DI, BX
  JC loop

done:
  MOVSX EAX, word [EBP-4]    ; sign-extend 16-bit sum → 32-bit
  CDQ
  MOV ECX, 0x24              ; 36
  IDIV ECX                   ; EDX = sum mod 36 (signed)
  MOV ECX, EDX
  MOV EDX, [EBP+0x10]
  CALL EncodeBinToChar       ; ECX → '0'..'9' / 'A'..'Z'
```

**Algorithm in plain text**:

```
sum = 0       // 16-bit accumulator
for i in 0 .. len(input) - 1:
    v = mod36_decode(input[i])             // '0'..'9' → 0..9, 'A'..'Z' → 10..35
    if i is even (0, 2, 4, ...):
        v = v * 3
    sum = (sum + v) & 0xffff               // 16-bit wrap
checksum_value = ((int16)sum) mod 36       // signed mod, normalised to 0..35
checksum_char  = mod36_encode(checksum_value)
```

The **even/odd weighting starts on iteration 0 with the multiply** —
the toggle is set to 0 before the first iteration and the multiplier
fires whenever toggle == 0. So character indices `0, 2, 4, …` are
tripled; `1, 3, 5, …` are added at face value.

`DecodeCharToBin` (`FUN_0043e800`):

```c
if (isdigit(c))      v = c - '0';      // 0..9
else if (isupper(c)) v = c - 'A' + 10; // 10..35
else                 return 0x41;      // invalid
```

`EncodeBinToChar` (`FUN_0043e870`):

```c
if (v < 10)      out = '0' + v;
else if (v < 36) out = 'A' + (v - 10);
```

## Worked example

VIN `WBAAA00000PM10277`. Compute the check over `"FP" + vin` = 19 chars.

| i  | char | v (mod-36) | i even? | weighted | running sum |
|---:|:----:|-----------:|:-------:|---------:|------------:|
|  0 | `F`  |        15  | yes ×3  |       45 |          45 |
|  1 | `P`  |        25  |   no    |       25 |          70 |
|  2 | `W`  |        32  | yes ×3  |       96 |         166 |
|  3 | `B`  |        11  |   no    |       11 |         177 |
|  4 | `A`  |        10  | yes ×3  |       30 |         207 |
|  5 | `A`  |        10  |   no    |       10 |         217 |
|  6 | `A`  |        10  | yes ×3  |       30 |         247 |
|  7 | `0`  |         0  |   no    |        0 |         247 |
|  8 | `0`  |         0  | yes ×3  |        0 |         247 |
|  9 | `0`  |         0  |   no    |        0 |         247 |
| 10 | `0`  |         0  | yes ×3  |        0 |         247 |
| 11 | `0`  |         0  |   no    |        0 |         247 |
| 12 | `P`  |        25  | yes ×3  |       75 |         322 |
| 13 | `M`  |        22  |   no    |       22 |         344 |
| 14 | `1`  |         1  | yes ×3  |        3 |         347 |
| 15 | `0`  |         0  |   no    |        0 |         347 |
| 16 | `2`  |         2  | yes ×3  |        6 |         353 |
| 17 | `7`  |         7  |   no    |        7 |         360 |
| 18 | `7`  |         7  | yes ×3  |       21 |         381 |

`381 mod 36 = 21 → 'L'` (since `10 → 'A'`, `21 → 'L'`).

So `FAHRGESTELL_NR = "WBAAA00000PM10277" + "L" = "WBAAA00000PM10277L"`.

## Reproduction (without the fix)

1. Read identity on an E46 with GM5 (NETTODAT.TRC import or live read).
2. Open a coding-write flow on the GM5 SG.
3. Console shows the post-write `C_FG_AUFTRAG`:

   ```
   [CDHapiJob] ecu=C_GM5 job=C_FG_AUFTRAG params(1)=["WBAAA00000PM10277"]
                                                     ^^^^^^^^^^^^^^^^^^^
                                                     17-char VIN, no check
   ```

4. UI surfaces:

   ```
   Write failed: IPO ran SG_CODIEREN but
   JOB_STATUS=ERROR_NUMBER_ARGUMENT — write did not complete cleanly
   ```

5. The actual `C_C_AUFTRAG` data write **does** succeed — only the
   trailing `C_FG_AUFTRAG` "stamp the chassis number" step fails.
   Re-reading the SG after this confirms the coding bytes landed in
   the ECU.

## Fix

### Library (`@emdzej/ncsx-identity`)

New module `packages/identity/src/m36-checksum.ts` exporting two
functions:

```ts
/** Compute the BMW Mod-36 check character of an arbitrary input string. */
export function mod36Checksum(input: string): string

/** Format a 17-char VIN into the 18-char `FAHRGESTELL_NR` shape (VIN + check). */
export function formatFahrgestellNr(vin: string): string
```

Verbatim port of `CalcMod36CheckSum` (`FUN_0043e9d0`) and
`coapiSetFgNr` (`FUN_0042a560`)'s 17-char branch. Locked by unit tests
that include the worked example above (`mod36Checksum("FPWBAAA00000PM10277") === "L"`).

### Seed call (`apps/web/src/lib/process-ecu.ts`)

```ts
import { formatFahrgestellNr } from "@emdzej/ncsx-identity";

// ... right before runCabimain("SG_CODIEREN"):
if (app.identity?.vin) {
  const fgnr = formatFahrgestellNr(app.identity.vin);
  await handle.cabi.CDHSetSystemData("FAHRGESTELL_NR", fgnr);
}
```

Mirrors `coapiSetFgNr`'s 17-char input path exactly: uppercase, prepend
`"FP"`, run `CalcMod36CheckSum`, append the check char.

## Why KMB / AKMB don't hit this

KMB's coding IPO uses `C_FG_LESEN` (read chassis from ECU) — no host
input, no length check. GM5's flow uses `C_FG_AUFTRAG` (write/confirm
chassis to ECU) which is the gated path. Other ZCS-master chassis
(ZKE5, etc.) that have `C_FG_AUFTRAG` in their SGBD will need the same
seeded format.

## Bench-write status as of 2026-05-25 — `ERROR_VERIFY` on the bench LSZ

After the [system-data seed fix](#fix) landed, `C_FG_AUFTRAG` started
receiving the correct VIN parameter on LSZ (E46). The job now reaches
the SGBD-side write step instead of bailing at the empty-param gate.
However the bench result is still `ERROR_VERIFY` on a true content
change — only **idempotent self-writes** (re-writing the value already
on the ECU) succeed.

### Investigation summary

Disassembling `A_LSZ.ipo:Cod` (FGNR_SCHREIBEN branch, instructions
0x9b..0xee):

```
00b5: CDHGetSystemData("FAHRGESTELL_NR")    → local[3] = full 18 chars
00b6: midstr(local[3], 10, 7)               → local[5] = chars [9..16]
00c3: local[5] != "ZZ00000" AND
      local[5] != local[4]                  → only write on actual change
00cd: CDHapiJob(C_LSZA, "C_FG_AUFTRAG",
      local[3], "")                         → write the FULL 18 chars
```

- Trace confirms `C_FG_AUFTRAG params(1)=["WBAEP31060PE84104K"]` —
  exactly what the IPO intends to send.
- The IPO contains **zero auth calls** (no `CDHCallAuthenticate`,
  `CDHAuthGetRandom`, SEED/KEY, or `BMW Login`). Same for `Cod`,
  `Ident`, `cabimain`, and `__inpa_startup__`. NCSEXPER doesn't gate
  VIN writes on LSZ through SecurityAccess at the IPO layer.
- `JOB_STATUS=ERROR_VERIFY` is set by `C_LSZA.prg` (SGBD bytecode),
  not by ediabasx. The SGBD does *write → read-back → compare* and
  reports `ERROR_VERIFY` on mismatch.
- `_TEL_ANTWORT = D0 0A A0 02 50 4D 10 27 70 22` decodes as header +
  `"PM"` + BCD-packed `10277` + trailer — the **old** production
  sequence. The ECU returned its current value after the write
  request was issued, meaning the write request was silently dropped
  at the bus level.

### Likely causes (in order of probability)

1. **Vehicle wake state not synthesised on the bench.** BMW K-line
   ECUs typically only accept identity writes when KL15 + KL30 are
   live and at least one CAN/K-bus partner is producing traffic.
   The bench harness can ID-read fine but rejects identity writes.
2. **One-time-programmable VIN slot on this LSZ revision.** Some E46
   LSZ firmware variants lock VIN after first programming; a
   different-VIN write becomes a no-op that the SGBD then catches as
   ERROR_VERIFY.
3. **Missing `DiagnosticSessionControl` (UDS 0x10) "programming
   session"**. Our bench `INITIALISIERUNG` may not send the session-
   change frame NCSEXPER's outer flow would on a real car.

### Software stack verdict

The cabi-provider, runtime seed (both `CDHSetCabdPar` and
`CDHSetSystemData` for `FAHRGESTELL_NR`), the IPO dispatch, and the
SGBD argument format are all correct against NCSEXPER's intent —
verified end-to-end against the IPO disassembly. No further software
fix is currently identifiable without an **NCSEXPER ABLAUF.TRC
capture** of a successful real-vehicle VIN write on the same chassis
to diff against our bench transport.

Suggested follow-up tooling if you ever pick this up again:

- Capture `ABLAUF.TRC` from NCSEXPER doing a known-good VIN write on
  an E46 with the same LSZ firmware. Compare telegram sequence at
  the kdcan layer (`ediabasx/packages/interface-serial/src/kdcan/`)
  against ours. Anything NCSEXPER sends before `C_FG_AUFTRAG` that
  we don't is the missing piece.
- Confirm whether KMB (slot-driven, `C_S_AUFTRAG` path) has the same
  failure mode — if KMB also `ERROR_VERIFY`s with the correct
  payload, the issue is ECU-hardware, not protocol. If KMB works,
  the issue is LSZ-specific.

## Suggested follow-ups

- `FAHRGESTELL_NR_KOMPL` (= VIN[0..6], 7 chars) is also written by
  `coapiSetFgNr`. Not exercised yet by any IPO we've decompiled; seed
  it too once a flow needs it (`packages/identity/src/m36-checksum.ts`
  could grow a `formatFahrgestellNrKompl(vin: string): string`
  helper that just returns `vin.slice(0, 7)`).
- Other host-seeded system-data keys we'll probably surface as more
  IPOs run end-to-end: `BAUREIHE`, `TYP_SCHLUESSEL`, `LACK_CODE`,
  `POLSTERCODE`, etc. Same `CDHSetSystemData` slot — the dispatcher
  is already wired (see `apps/web/src/lib/cabi-syscall-overrides.ts`),
  just need to plumb the values from `app.identity`.
- If an SGBD ever validates the supplied check char against its own
  re-computation (which `coapiSetFgNr`'s 18-char branch does on host
  input), our `formatFahrgestellNr` output will match because we ran
  the same algorithm. No additional work required.
