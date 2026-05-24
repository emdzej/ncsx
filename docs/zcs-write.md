# ZCS write — how NCSEXPER converts a `(GM, SA, VN)` triplet into bytes on the ECU

This doc captures the full reverse-engineering trail behind
`ZCS_SCHREIBEN` — what each byte means, what algorithm computes the
check chars, what the IPO's `Cod` handler does on the way, and what
the host has to supply.

Companion to:

- [`coding-flow.md`](coding-flow.md) — FSW/PSW read+write (different
  flow; ZCS doesn't go through `PARZUWEISUNG_FSW`).
- [`daten-format.md`](daten-format.md) — DST frame format and
  CABD-block conventions referenced below.
- [`ncsexper-syscall-table.md`](ncsexper-syscall-table.md) — IPO
  syscall ↔ slot ID mapping.

---

## 1. The three ZCS keys

| Key   | Body length | Total (body + check) | Semantic |
|-------|------------:|---------------------:|----------|
| **GM** | 8 hex chars  |  9 chars | Grundmodell — hardware/model identifier |
| **SA** | 16 hex chars | 17 chars | Sonderausstattung — feature bit-set |
| **VN** | 10 hex chars | 11 chars | Versionsnummer — SW-revision marker |

Each is stored as `<body><check>` where the trailing 1-char **check
digit** is computed by NCSEXPER's `CalcMod36CheckSum`
(`FUN_0043e9d0` in NCSEXPER.EXE — ported as `mod36Checksum` in
`@emdzej/ncsx-identity/m36-checksum`).

## 2. Mod-36 checksum input — per-key prefix

The Mod-36 checksum is computed over `<2-char-prefix> + <body>`.
The prefix encodes WHICH key the value is for:

| Key | Prefix | Verified examples                                          |
|-----|--------|------------------------------------------------------------|
| GM  | `C1`   | `FFFFFFFF` → `P` (25), `61630000` → `5`                    |
| SA  | `C2`   | `0000284803AC1400` → `G` (16), `FFFFFFFFFFFFFFFF` → `E` (14) |
| VN  | `C3`   | `0000640620` → `1`                                         |

The prefix letters come from `FUN_00409f60`'s `_strncmp(buf, "C1"/"C2"/"C3", 2)`
calls — that function strips the same prefixes off incoming display
strings, confirming the channel-tag mapping. Without the prefix,
the checksum would only validate the body bytes; with it, the SGBD
can also reject a value that was sent in the wrong slot
(e.g. someone tried to write a GM value into the SA slot).

Helpers in `@emdzej/ncsx-identity`:

```ts
formatGm(body: string): string   // 8 → 9 chars (body + check)
formatSa(body: string): string   // 16 → 17 chars
formatVn(body: string): string   // 10 → 11 chars

stripGmCheck(value: string): string  // 9 → 8 chars
stripSaCheck(value: string): string  // 17 → 16 chars
stripVnCheck(value: string): string  // 10 or 11 chars → 10 chars
                                     //   (some IPO reads return VN body-only)
```

## 3. ECU memory layout — the 20-byte ZCS region

Every ZCS-master CABD declares a region named `"ZCS"` in
`CODIERDATENBLOCK`. The region is always **20 bytes**; the base
address (`WORTADR`) varies per CABD revision:

```
KMB_E46.C02–.C06  WORTADR=104, BYTEADR=20  ; pre-2003 layout
KMB_E46.C07–.C08  WORTADR=368, BYTEADR=20  ; 2003+ layout
```

The byte layout inside the 20-byte block is a fixed BMW convention
(NOT described by per-FSW rows in any chassis I've checked):

```
offset  bytes  content                               EINHEIT
─────────────────────────────────────────────────────────────
0..3    4 B    GM body  — 8 nibbles, packed 2/byte   'h' (hex)
   4    1 B    GM check char (ASCII)                 'a' (raw)
5..12   8 B    SA body  — 16 nibbles                 'h'
  13    1 B    SA check char (ASCII)                 'a'
14..18  5 B    VN body  — 10 nibbles                 'h'
  19    1 B    VN check char (ASCII)                 'a'
─────────────────────────────────────────────────────────────
total: 20 B
```

**Nibble packing** for "hex" bytes: high nibble = first hex char,
low nibble = second. So GM body `"61630000"` packs into
`[0x61, 0x63, 0x00, 0x00]`.

**ASCII check chars** are stored verbatim — `'P'` becomes byte
`0x50`.

The CABD's `PARZUWEISUNG_DIR` rows for the ZCS range tag each
nibble as a separate FSW (`MASKE=0xF0` for the high nibble,
`MASKE=0x0F` for the low) and each ASCII byte as one FSW with
`MASKE=0xFF` and `EINHEIT='a'`. This is mostly cosmetic — at write
time the IPO doesn't iterate the FSWs; it ships the 20 raw bytes
as one block.

## 4. The IPO's `Cod` handler — control flow for `ZCS_SCHREIBEN`

Anchor: `A_KMB46.ipo` (E46's CABD-bridge IPO). `cabimain` routes
`SG_CODIEREN` / `TEILBEREICH_CODIEREN` / `FGNR_SCHREIBEN` /
`ZCS_SCHREIBEN` / `ZCS_LOESCHEN` all to the same `Cod` user-function.

`Cod`'s prologue (any jobname):

```
0x37  CDHapiJob("IDENT", "", "ID_COD_INDEX")  ; read ECU identity
0x48  CDHapiResultText(ID_COD_INDEX, 1)       ; into local[2]
```

Then a jobname-specific branch. For `ZCS_SCHREIBEN`:

```
PC 0x1f1   if JOBNAME == "ZCS_SCHREIBEN" or "ZCS_LOESCHEN":
PC 0x1fb     CDHGetGrpDataFromCbd("ZCS")              ; load ZCS group
                                                      ;   metadata into
                                                      ;   internal slot state
PC 0x204     loop:
PC 0x20a       CDHGetApiJobData(maxData, &bufSize,    ; pull next slot
                  &nrOfData, &dataType, &retVal)      ;   chunk into binbuf
PC 0x218       if nrOfData == 0: break out of loop
PC 0x21f       CDHapiJobData(sgbd, "C_S_AUFTRAG",     ; ★ THE WRITE ★
                  binbuf, bufSize, "")
PC 0x22f     end loop
PC 0x237     CDHSetSystemData("CHECKSUM", "00")       ; reset checksum state
PC 0x261     hexdump(binbuf, value=56,  pos=5)        ; build a 9-byte
PC 0x269     hexdump(binbuf, value=182, pos=7)        ;   verification packet
PC 0x288     CDHapiJobData(sgbd, "C_CHECKSUM",        ; ★ POST-WRITE VERIFY ★
                  binbuf, 9, "")
```

`C_S_AUFTRAG` is the SGBD job that takes a raw byte buffer and
writes it into the ECU's coding region. `C_CHECKSUM` is a follow-up
that asks the ECU to compute a checksum over the written region —
ECU rejection (status byte `0xA0` = "operation denied / parameter")
surfaces as `JOB_STATUS = ERROR_ECU_PARAMETER`.

## 5. What the HOST has to do

The IPO **does not** read the user's `GM_SCHLUESSEL` /
`SA_SCHLUESSEL` / `VN_SCHLUESSEL` cabd-pars on the write path. They
exist for diagnostic logging only; the IPO's actual data source is
the netto-slot table populated BEFORE `runCabimain("ZCS_SCHREIBEN")`
runs.

So the host must:

1. **Compute the check chars** — `formatGm(body)` / `formatSa(body)` /
   `formatVn(body)` from `@emdzej/ncsx-identity`.

2. **Resolve the ECU's coding index** — needed to pick the right
   `.Cxx` (different CIs have different ZCS WORTADR). Either reuse
   `app.selectedModule.codingIndex` if available, or call
   `CDHapiJob(sgbd, "IDENT", …)` and read `ID_COD_INDEX`.

3. **Open the CABD module** —
   `chassis.cabd.openModule(moduleName, ci)`. Module name comes
   from `findPhysicalModule(chassis, sgName, formatCi(ci))`
   (SGAUSWAHL resolution in `apps/web/src/lib/process-ecu.ts`).

4. **Build the slot table** — `buildZcsSlots(cabd, applied_gm,
   applied_sa, applied_vn)` from `apps/web/src/lib/zcs-slots.ts`:
   reads the `CODIERDATENBLOCK` row tagged `BEZEICHNUNG="ZCS"`
   to find the base addr, then emits 20 `{addr, value}` entries
   covering the body+check bytes.

5. **Wire it into the runtime** — before `runCabimain`:

   ```ts
   handle.cabi.setNettoSlots(slots)
   await handle.cabi.CDHSetDataOrg(wortBreite, 0, 0)  // 1 for BYTE, 2 for WORD*
   await handle.runCabimain("ZCS_SCHREIBEN")
   ```

   `wortBreite` is derived from the CABD's `SPEICHERORG` row
   (`STRUKTUR` = `BYTE` / `WORDMSB` / `WORDLSB`). Same convention as
   `processWriteCoding` for SG_CODIEREN.

## 6. Failure modes seen during development

| Symptom                                                        | Root cause                                                                                          | Fix                                                                                                              |
|----------------------------------------------------------------|----------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| Silent dispatch — cabd-par seeds logged but **no `CDHapiJob*` calls** | `Cod` prologue calls `CDHGetNettoDataFromCbd` which returned `COAPI_ERROR` for empty `slots[]`; `TestCDHFehler` aborted before the first SGBD call | `CDHGetNettoDataFromCbd` always returns `COAPI_OK` now (slots is legitimately empty for non-SG_CODIEREN flows) |
| `ZCS_SCHREIBEN returned JOB_STATUS=ERROR_ECU_PARAMETER`        | IPO ran `IDENT` then `C_CHECKSUM` with `00 00 00 00 00 38 00 B6 00` (skipped `C_S_AUFTRAG`)         | `setNettoSlots()` populated with the 20-byte ZCS region BEFORE `runCabimain` — see step 5 above                  |
| `ZCS_SCHREIBEN returned JOB_STATUS=ERROR_NUMBER_ARGUMENT` (hypothetical, not yet observed) | Wrong-length GM/SA/VN sent — SGBD's `strlen` check trips                                            | Length-validate client-side before write (`GM=9 / SA=17 / VN=11`) — already enforced by `ZcsEditorDialog`        |

## 7. Architecture choice — direct vs generic slot path

The current implementation (`apps/web/src/lib/zcs-slots.ts`) is a
**direct ZCS-specific path**: it reads the CABD's CODIERDATENBLOCK
to find the ZCS base addr and packs `(GM, SA, VN)` strings into 20
bytes inline. It does NOT go through `buildFunctionList` /
`flattenSlots`.

A future refactor could use the **generic path**: synthesize a
20-byte netto containing the encoded ZCS region, position it at the
ZCS base addr inside a larger netto, then call
`flattenSlots(functionList, netto, { codingOnly: true })` filtered
to the ZCS range. That'd give symmetry with SG_CODIEREN's flow at
the cost of one extra indirection on every ZCS dispatch.

For now the direct path wins on simplicity — the ZCS layout
(4-1-8-1-5-1) is a fixed BMW convention, not described by
PARZUWEISUNG rows in a way the generic flattener can encode (each
nibble is a separate FSW — packing a hex-string user input into
those nibbles would need a custom path anyway).

If "write only ECU sub-region X" lands as a general feature (e.g.
writing only `Var_Fahrzeugparameter` or only `Codierdatum` without
touching the rest of the coding region), THAT's the right
motivation for the generic refactor.
