# ECU Selection in NCSEXPER

How does NCSEXPER decide which ECUs to talk to, and how does an FA (Auftrag) on the screen turn into a concrete list of `(SGNAME, CABD, SGBD, JOB)` to execute?

This is the runtime contract between four data sources — the **PFL profile**, the **DATEN binary tables**, the **DATEN text tables**, and the **SGDAT IPO scripts** — orchestrated by NCSEXPER's `COAPI` and `CDH` (Coding Data Handler) libraries.

Cross-refs:
- PFL keys involved: see [`pfl-format.md`](pfl-format.md) — sections `[FGNR_ZCS]`, `[SGET]`, `[CODING]`.
- DATEN files involved: see [`daten-format.md`](daten-format.md) — `BR_REF.DAT`, `<BR>SGFAM.DAT`, `<BR>DST.000`, `<BR>SGET.000`, `<BR>SGVT.000`.
- Ghidra evidence: COAPI string handles `0x005af*..0x005b*` and Coding-Data-Handler strings `CDH*` at `0x005af*`.

---

## 1. Inputs

NCSEXPER builds its work list from **four user-supplied identifiers** plus the active profile:

| Input            | Where it comes from                                  | What it pins down |
|------------------|-------------------------------------------------------|---------------------|
| **Baureihe (BR)**| User dropdown, or `coapiGetBrFromZcs` (derived)       | The chassis (`E46`, `E89`, …). Selects the DATEN sub-directory. |
| **VIN (FG-Nr.)** | User entry / vehicle read (`FG_NR_LESEN`)             | Identifies the car. Optional for coding; required only when the workflow writes VIN. |
| **ZCS**          | User entry, file, or vehicle read (`ZCS_LESEN`)       | Encodes the variant keys (`SA_SCHLUESSEL`, `VN_SCHLUESSEL`, `AM_SCHLUESSEL`, `GM_SCHLUESSEL`). Carries the FA in compact form. |
| **FA (Auftrag)** | User entry, or computed `coapiGetAuftrag` from ZCS    | The full order — list of SA codes (e.g. `205`, `403`, `508`), VN+M+E entries. Drives all downstream bit decisions. |

The GUI explicitly groups them as the "VIN/ZCS/FA/Baureihe" wizard (dialog string `FG/ZCS/FA/Baureihe`, `0x005dc258`).

The active **profile** then decides:
- whether the user is allowed to pick BR (`[FGNR_ZCS].FktBrAuswahl`),
- which inputs are required (`FktZcsEingeben`, `FktZcsAusSteuerdatei`, `FktZcsAusFahrzeug`),
- whether the SGET-driven ECU enumeration runs at all (`[SGET].SgetLesen`),
- whether the user may narrow the list manually (`[SGET].FktSgAuswahl`),
- whether car-wide or per-ECU coding mode is offered (`[CODING].FktSgCodieren`, `FktFzgCodieren`),
- and whether only the currently-selected SG receives writes (`[CODING].ZcsNurAktuellesSg`).

---

## 2. The selection pipeline

```
                ┌────────────────────────────────────────────────────────┐
                │ 1. coapiSetBaureihe(BR)                                │
 user/ZCS ─────►│    or coapiGetBrFromZcs(ZCS) → BR                      │  → ..\DATEN\<br>\ resolved
                │    BR_REF.DAT → canonical BR (E91→E89 etc.)            │
                └──────────────────────┬─────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────────┐
                │ 2. Load chassis tables for BR                          │
                │      <BR>DST.000   → SGFAM/SGET/SGVT/ZCSUT/CVT names   │
                │      <BR>SGFAM.DAT → logical SG → (CABD, SGBD)         │
                │      <BR>SGET.000  → FA-expression → SG selection      │
                │      <BR>CVT.000   → chassis constants                 │
                └──────────────────────┬─────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────────┐
                │ 3. coapiSetAuftrag(FA) / coapiReadAuftrag(file/ZCS)    │
                │      coapiGetAswFromAuftrag(FA)  → ASW words            │
                │      coapiGetAswFromZcs(ZCS)     → ASW words            │
                │    (ASW is the canonical variant bit-vector.)          │
                └──────────────────────┬─────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────────┐
                │ 4. coapiScanAllSgFromBr(BR, FA)                        │
                │    or coapiScanAllSgFromZcs(BR, ZCS)                   │
                │      iterate <BR>SGET.000 rows; for each candidate SG: │
                │        ausdruckCheckAuftrag(AUFTRAGSAUSDRUCK, ASW)     │
                │      keep matches → "in-scope" SG list                 │
                └──────────────────────┬─────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────────┐
                │ 5. Per-SG resolution                                   │
                │      coapiTestSgInSget(sg)        → confirm presence    │
                │      coapiGetVmSgName(sg, VM)     → variant SG name     │
                │      coapiGetSgFamData(sg)        → (CABD, SGBD)        │
                │      coapiReadCodierIndexFromSgVm → coding index        │
                │      coapiRunCabd(...)            → coding rules        │
                └──────────────────────┬─────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────────┐
                │ 6. Execute via EDIABAS / IPO                            │
                │      apiJob(SGBD, "SG_CODIEREN" | ..., params, "")     │
                │      (IPO script in SGDAT\ orchestrates the job set)   │
                └────────────────────────────────────────────────────────┘
```

The whole pipeline is in `COAPI.CPP` / `COAPI4.CPP` / `COAPI2.CPP` (visible as string-handle names at `0x005af060`, `0x005af868`, `0x005afd18`), with the FA-expression matcher in `AUSDRUCK.C` (`0x006051e0`).

---

## 3. Step-by-step detail

### 3.1 Step 1 — Baureihe resolution

- `BR_REF.DAT` is loaded once at startup (`coapiInit` → reads `br_ref.dat`).
- Block `BR_ZEILE` carries the chassis code → directory mapping.
- Block `BR_ERSATZ` carries aliases (e.g. `E91 → E89`, `R56 → R50`).
- `coapiSetBaureihe(BR)` and `CDHSetBaureihe(BR)` push the chosen code into the COAPI/CDH state and into the `%s_PFAD_DATEN` template (key `0x005b0eac`) — used to compose paths like `..\daten\e46\` for the rest of the run.
- If the user has only entered a ZCS (no BR), `coapiGetBrFromZcs` recovers it: every ZCS-bearing module ships the BR identifier in its key prefix, and the routine searches `BR_REF.DAT` to find a match.

### 3.2 Step 2 — chassis-level table load

`<BR>DST.000` is the **master index** for the chassis. Its `SGZEILE` rows enumerate, for each logical SG slot:

```
LFDNR  BEZTAB   BEZVM   DCSNR  BEZPRT
```

which name the per-chassis SGET, SGVT, ZCSUT, CVT files and other components. NCSEXPER opens those and keeps them in memory for the remainder of the session.

- `<BR>SGFAM.DAT` is parsed line-by-line (text format, see [`daten-format.md` §2.6](daten-format.md#26-sgfam--sg-family-map-brsgfamdat)). The result is the dictionary `coapiGetSgFamData` later returns: logical SG name → `{ CABD, SGBD, zcsFlag, faFlag, comment }`.
- `<BR>SGET.000` is parsed but **not** yet matched — matching happens in step 4.

### 3.3 Step 3 — FA / ZCS → ASW

ASW (Auswahl-Steuerwort) is NCSEXPER's canonical **variant bit-vector**. Whatever the user provides (FA tokens, ZCS keys, or a saved file), it is normalised to ASW first.

| Source           | Routine                          | What it does |
|------------------|----------------------------------|--------------|
| FA (text)        | `coapiGetAswFromAuftrag`         | Tokenise the FA, look each token up in the chassis's SA/FA dictionaries (`<BR>AT.000`, `<BR>AT.M00`, `<BR>ZST.000`), and set the corresponding bits in the ASW vector. |
| ZCS              | `coapiGetAswFromZcs`             | Decode the `SA_SCHLUESSEL` / `VN_SCHLUESSEL` / `AM_SCHLUESSEL` / `GM_SCHLUESSEL` bytes (applying the `A`-OPERATION transforms documented in [`daten-format.md` §1.7](daten-format.md#17-the-a-operation-field)) and project them onto ASW. |
| SGVT pivot       | `coapiGetAswFromSgvt`            | Used when ZCS and SGVT carry different variant slots — translates one space to the other. |
| `SWTASW.DAT`     | resource                         | Vocabulary file used by both ASW conversions to resolve string-name ↔ bit-index. |

The ASW result is also what the GUI shows as "im Codierauftrag enthalten:" (`0x005dc190`).

### 3.4 Step 4 — SGET-driven enumeration (the matcher)

`<BR>SGET.000` contains three parallel blocks holding candidate SGs at increasing specificity:

| Block               | Row fields                                                                 | Used when |
|---------------------|----------------------------------------------------------------------------|-----------|
| `SGAUSWAHL_VM`      | `SGNAME, CBD, UMRSG, VMG, AUFTRAGSAUSDRUCK, INDEX`                          | Variant-only match — fallback. |
| `SGAUSWAHL_SGBD`    | `SGNAME, CBD, CABD, SGBD, UMRSG, AUFTRAGSAUSDRUCK, INDEX`                   | Variant + SGBD match. |
| `SGAUSWAHL_VMSGBD`  | `SGNAME, CBD, CABD, SGBD, UMRSG, VMG, AUFTRAGSAUSDRUCK, INDEX`              | Most specific: variant + module variant + SGBD. |

`coapiScanAllSgFromBr` (or `_FromZcs`) walks **all three** blocks, and for each candidate row tests its `AUFTRAGSAUSDRUCK` against the in-memory ASW vector. The match is performed by `ausdruckCheckAuftrag` / `ausdruckCheckAMerkmal` in `AUSDRUCK.C`:

- `AUFTRAGSAUSDRUCK` is a **5-byte OPERATION** field (the same `A` type from the binary frame format — see [`daten-format.md` §1.7](daten-format.md#17-the-a-operation-field)) carrying a logical predicate over SA/VN bits. Operators observed: `!` (negation), `+`/`-` (presence), `>` (bit-shift comparison).
- For each candidate, the matcher evaluates the predicate on ASW. A "true" return means the SG is in scope for this FA.
- The three blocks are tried **most specific first** (`SGAUSWAHL_VMSGBD`, then `SGAUSWAHL_SGBD`, then `SGAUSWAHL_VM`); the first match wins. This is why two FAs that differ only in one SA code can yield wildly different ECU sets.

The result is the **car-wide ECU work list** — typically 20–60 SGs for an E46, more for newer chassis.

> If `[SGET].SgetLesen=0`, the matcher is skipped entirely; NCSEXPER will only operate on whatever single ECU the user picks manually.

### 3.5 Step 5 — per-SG resolution

For each matched SG, COAPI/CDH expand it into a concrete `(CABD-file, SGBD-module, current-coding-index)` triple:

- `coapiTestSgInSget(sg)` confirms the SG still appears in SGET (defensive — after manual edits).
- `coapiGetVmSgName(sg, VM)` resolves variant-specific SGBD names. The same logical SG (e.g. `MOT`) may map to different SGBDs (e.g. `C_ME9_4N`, `C_MEVD17`) depending on the FA's engine variant slot.
- `coapiGetSgFamData(sg)` returns the `<BR>SGFAM.DAT` row — `{ CABD = "A_…", SGBD = "C_…", zcsFlag, faFlag }`.
- `coapiReadCodierIndexFromSgVm(sg, VM)` queries the ECU itself (via `CODIERINDEX_LESEN`) to find out which CABD revision (`Cxx` extension) is currently in the ECU.
- The matching `<CABD>.Cxx` file is opened and `coapiRunCabd(...)` runs the coding rules against the netto buffer (driven by either FSW/PSW from the FA, or ASW directly, or already-read netto data — chosen by `[ASW].AswLesenModus`, `[FSWPSW].FswPswLesenModus`, `[NETTODATEN].NettoDatenLesenModus`).

### 3.6 Step 6 — execution

The decision of **which EDIABAS job to call** happens in two layers:

- **What** to do is decided here: `SG_CODIEREN`, `CODIERDATEN_LESEN`, `CODIERDATEN_SCHREIBEN`, `SG_RESET`, etc.
- **How** to do it lives in the SGDAT IPO script for the resolved SGBD module — see `SGDAT\<C_…>.ipo`. The IPO assembles the precise EDIABAS call sequence (handle `ACCESS_TIMING_PARAMETER`, toggle `NORMALER_DATENVERKEHR`, run `SG_CODIEREN`, verify `JOB_STATUS=OKAY`, etc.) and forwards each `apiJob(...)` through NCSEXPER's bridge to `api32.dll`.

The list of jobs invoked from "SG-Coding mode" is conserved across SGs: `INFO,JOB_ERMITTELN,SG_CODIEREN,CODIERDATEN_LESEN` (string `0x005dbb60`) — these are the four NCSEXPER tries every time it codes an ECU.

---

## 4. Where the ECU-list dropdown comes from

The "Choose ECU" picker (`SG ausw…` button when `[SGET].FktSgAuswahl=1`) is populated **after step 4**: NCSEXPER shows the in-scope SG list (i.e. those whose `AUFTRAGSAUSDRUCK` matched), letting the user narrow it down before pressing "Process ECU".

Similarly:
- "Choose chassis" (`FktBrAuswahl=1`) populates from `BR_REF.DAT::BR_ZEILE`.
- "Choose job" (`FktCodierJobAendern=1`) lets the user override the default `SG_CODIEREN` to one of the alternates (`SG_CODIEREN_OHNE_CI`, `SG_CODIEREN_OHNE_FG`, etc.) — written into `[CODING].SpezialJobName`.

---

## 5. Worked example (E46, SA `0902 KEYCARDREADER`)

Given:
- BR = `E46`, FA contains SA code `0902 KEYCARDREADER`.
- Profile = `Expertenmodus.pfl` (full coding, ECU picker visible).

What happens:

1. `BR_REF.DAT`: `E46` → directory `..\daten\e46\`.
2. `E46DST.000` opens, names `E46SGFAM.DAT`, `E46SGET.000`, `E46SGVT.000`, `E46ZCSUT.000`, `E46CVT.000`.
3. `E46SGFAM.DAT` loaded → SGFAM table (rows `S AKMB A_AKMB46 C_KMB46 0 1`, `S BTM A_TM46 C_BTM46 0 0`, …).
4. `coapiGetAswFromAuftrag(FA)` → ASW bit `0902` is set.
5. `coapiScanAllSgFromBr(E46, FA)` walks `E46SGET.000`:
   - tries `SGAUSWAHL_VMSGBD` → no specific match for KMB+0902 with current VM.
   - tries `SGAUSWAHL_SGBD` → row `(KMB, C_KMB46_E46, A_KMB46, C_KMB46, …, AUFTRAGSAUSDRUCK=…0902…)` matches.
   - tries `SGAUSWAHL_VM` → other rows possibly match for AKMB/AEWS/etc.
   - Returns `[(AKMB, A_AKMB46, C_KMB46), (KMB, A_KMB46, C_KMB46), … ]`.
6. User picks `KMB` in the picker.
7. `coapiGetSgFamData("KMB")` → `{CABD: "A_KMB46", SGBD: "C_KMB46"}`.
8. `coapiReadCodierIndexFromSgVm("KMB", VM)` → e.g. `0x07`, picks `A_KMB46.C07`.
9. `coapiRunCabd("A_KMB46.C07", …)` → finds `PARZUWEISUNG_FSW` row whose `FSW` is the SWTFSW handle for `KEYCARDREADER`, applies `MASKE` / `OPERATION` to the netto buffer.
10. SGDAT `C_KMB46.ipo` (or whichever IPO bridges `C_KMB46.prg`) is invoked with `SG_CODIEREN` → bridge → `___apiJob@20("C_KMB46", "SG_CODIEREN", netto-data-as-hex, "")`.
11. `JOB_STATUS` polled until `OKAY`; success/failure is reported as `Codierung OK` / `Codierfehler` in the status bar.

---

## 6. AUFTRAGSAUSDRUCK — byte-coded predicate grammar

The `AUFTRAGSAUSDRUCK` cell in any SGET row is **not** the same `A`-OPERATION 5-byte field as the rest of the binary frame format. It's an `S`-typed string-style field whose payload is a **byte-coded boolean expression** evaluated against the in-memory ASW bit-vector. The matcher lives in `AUSDRUCK.C` and was decompiled from NCSEXPER's `FUN_0045e780` (lexer → infix string) + `FUN_0046f3e0` (preprocessor) + `FUN_0046f4e0` / `FUN_0046f2d0` / `FUN_0046f5e0` (Pratt-style evaluator).

### 6.1 Token bytes (consumed by `FUN_0045e780`)

| Byte | ASCII | Meaning |
|------|-------|---------|
| `0x53` | `S`   | **SA-bit reference**: followed by `id:u16 LE` — look the bit ID up in ASW; emits `'1'` if set, `'0'` otherwise. |
| `0x21` | `!`   | **NOT** — only meaningful before `(`. (When the matcher is called in "list mode" — `param_4 != 0` — `!` is dropped.) |
| `0x28` | `(`   | open subexpression |
| `0x29` | `)`   | close subexpression |
| `0x2b` | `+`   | **AND** combinator. In "list mode" rewritten to `,` (OR / collect). |
| `0x2c` | `,`   | **OR** combinator (also: list separator in list mode). |
| `0x5c` | `\`   | **continuation marker** — fetch the next `AUFTRAGSAUSDRUCK` chunk from the row and keep going. Long expressions span multiple binary fields. |

The lexer rewrites the byte stream into a flat ASCII expression string (replacing each `S<lo><hi>` triple with the literal `0` or `1` it resolves to), then hands that string to the evaluator.

### 6.2 Evaluator grammar

```
expr     ::= and_term (',' and_term)*    // OR  (parse_or  / FUN_0046f4e0)
and_term ::= atom    ('+' atom)*          // AND (parse_and / FUN_0046f2d0)
atom     ::= '0' | '1' | '!'? '(' expr ')' // (parse_atom / FUN_0046f5e0)
```

Precedence: `!` (unary, applies to a following `(...)`) tighter than `+` (AND), which is tighter than `,` (OR).

A preprocessing pass (`FUN_0046f3e0`) folds `!0`/`!1` directly to `1`/`0` so the atom-level rule only needs to handle `!` before parentheses.

The boolean classifier `FUN_0046f330` maps each ASCII byte to a token-class number; useful when re-implementing:

| Byte(s)               | Class |
|-----------------------|-------|
| `\0`, `\n`, `\r`      | 6 (EOF) |
| `!`                   | 2 |
| `(`                   | 9 |
| `)`                   | 10 |
| `+`, `,`              | 3 |
| `0`, `1`              | 1 |
| anything else         | 0 (syntax error) |

### 6.3 Two callers

Both callers live next to the lexer:

| Function              | Drives                                    | Source-name (Ghidra) |
|-----------------------|-------------------------------------------|----------------------|
| `FUN_0045ec50`        | bit-vector match (over ASW)               | `ausdruckCheckAuftrag` |
| `FUN_0045ed20`        | string/Merkmal match (over text tokens)   | `ausdruckCheckAMerkmal` |

`ausdruckCheckAuftrag` is the one the ECU enumerator uses. `ausdruckCheckAMerkmal` is the same grammar but with `S<id>` references resolved by string lookup (FA token names from `<BR>AT.000` / `<BR>AT.M00`) rather than bit IDs — used by the FA editor for validity checking.

The shared "list mode" flag (param_4) is the difference between **"is this FA satisfied"** (boolean, mode=0) and **"emit the list of contributing tokens"** (mode=1).

### 6.4 Worked example

Row with `AUFTRAGSAUSDRUCK` payload bytes (hex):

```
28 53 02 09 2b 53 03 09 29 2c 53 05 09
└┘ └────┘ └┘ └────┘ └┘ └┘ └────┘
 (   S    +    S    )   ,    S
       902       903           905
```

decodes to the string-form predicate `(902+903),905`, i.e. `((SA902 ∧ SA903) ∨ SA905)`.

The matcher evaluates that against the FA-derived ASW vector: if either both 902 and 903 are present, or 905 is present, this SG is in scope.

---

## 7. The `UMRSG` column (Umrechnungs-SG)

Confirmed from `GetSgeFile` (`FUN_004485f0` in the larger NCSEXPER image): every `SGAUSWAHL_*` row in `<BR>SGET.000` carries an `UMRSG` field that NCSEXPER reads alongside `SGNAME`, `CBD`, `CABD`, `SGBD`, `VMG`. The UMRSG name is used to compose a variant-resolved coding key:

```c
_sprintf(result, "V%s%s.%s", UMRSG, VMG, CABD);
```

Then `UMRSG` is looked up in a runtime variant-mapping table (`FUN_00448a90`) to return an index. So UMRSG is the **Umrechnungs-Steuergerät** — the "translation SG" used to resolve a logical SG name to its variant-specific equivalent in the current chassis. It's part of the same lookup chain as `<BR>SGFAM.DAT` but operates per-row inside SGET rather than as a chassis-wide table.

When the FA matcher selects a row from `SGAUSWAHL_VMSGBD`, `SGAUSWAHL_SGBD`, or `SGAUSWAHL_VM`, the resolved tuple is `{ SGNAME, CBD, CABD?, SGBD?, UMRSG, VMG?, AUFTRAGSAUSDRUCK, INDEX }`. The `?`-marked fields appear only in the more-specific blocks.

The `V%s%s.%s` template composes an **internal lookup key** used by `FUN_00448a90` to map UMRSG to its variant-specific equivalent. It is *not* a path to an on-disk file — for that, see §8 below.

## 8. CABD `.Cxx` file resolution (on disk)

This is the question every consumer hits first: **"given an SG, which `.Cxx` file on disk
holds its coding data?"** NCSEXPER's logic, confirmed by Ghidra (`FUN_00427610` —
`coapiReadCbdFromBr` — walks `SGAUSWAHL_*` rows via `FUN_00434060` =
`coapiGetAllSgetData`) and by inspecting real E46 DATEN:

**The on-disk path is `<chassis_dir>/<SGAUSWAHL.SGNAME>.<SGAUSWAHL.CBD>`** — the `.` is
literal; `CBD` already includes the leading `C`.

### 8.1 Evidence from E46

`E46/E46SGET.000`, `SGAUSWAHL_SGBD` block (truncated):

| SGNAME      | CBD   | CABD       | SGBD       | UMRSG  | → on-disk file       |
|-------------|-------|------------|------------|--------|----------------------|
| `KMB_E46`   | `C06` | `A_KMB46`  | `C_KMB46`  | `KMB`  | `e46/KMB_E46.C06` ✓ |
| `KMB_E46`   | `C06` | `A_AKMB46` | `C_KMB46`  | `AKMB` | `e46/KMB_E46.C06` ✓ |
| `KMB_E46`   | `C07` | `A_KMB46`  | `KOMBI46R` | `KMB`  | `e46/KMB_E46.C07` ✓ |
| `KMBE46M3`  | `C20` | `A_KMB46`  | `C_KMB46`  | `KMB`  | `e46/KMBE46M3.C20` ✓ |
| `EWS`       | `C81` | `A_EWS3`   | `C_EWS3`   | `EWS`  | `e46/EWS.C81` ✓     |
| `EWS`       | `C81` | `A_AEWS3`  | `C_EWS3`   | `EWS`  | `e46/EWS.C81` ✓     |
| `LSZ`       | `C31` | `A_ALSZ`   | `C_LSZA`   | `ALSZ` | `e46/LSZ.C31` ✓     |

Note: the same `(SGNAME, CBD)` pair can appear in multiple rows, each with a different
`UMRSG` / `CABD` / `SGBD` combination. That's how one physical coding file (e.g.
`KMB_E46.C06`) services multiple **logical** SGs (`KMB` and `AKMB`) — both rows point
to the same `.Cxx` file; the choice of logical-SG row affects which EDIABAS module to
talk to (`SGBD`) and which logical name to show in the UI (`UMRSG`).

### 8.2 Column meanings (cross-reference table)

| Column                       | Role                                                        |
|------------------------------|-------------------------------------------------------------|
| `SGAUSWAHL_*.SGNAME`         | **Physical coding-file basename.** Use to build the path.   |
| `SGAUSWAHL_*.CBD`            | Coding-index suffix, already including the leading `C`.     |
| `SGAUSWAHL_*.CABD`           | Logical CABD name (same value as `SGFAM.CABD`). Bookkeeping; **not** a file basename. |
| `SGAUSWAHL_*.SGBD`           | EDIABAS module — feed to `apiJob(sgbd, …)`.                 |
| `SGAUSWAHL_*.UMRSG`          | Logical SG name. Matches `SGFAM.SG` and is what NCS Expert's UI dropdown shows. |
| `SGFAM.SG`                   | Logical SG name (= `SGAUSWAHL.UMRSG`).                      |
| `SGFAM.CABD`                 | Logical CABD name (= `SGAUSWAHL.CABD`). **Not a file basename.** |
| `SGFAM.SGBD`                 | EDIABAS module (= `SGAUSWAHL.SGBD`).                        |

### 8.3 Anti-patterns

- **Do not** use `SGFAM.CABD` as a file basename. `A_KMB46` is not `KMB_E46.C0?`; `A_EWS3`
  is not `EWS.C81`. There is no string transform that gets you from one to the other —
  the relationship is bookkeeping only.
- **Do not** assume `SGFAM.SG` matches `SGAUSWAHL.SGNAME`. SGFAM.SG matches
  `SGAUSWAHL.UMRSG`. `SGAUSWAHL.SGNAME` is the *file* basename.
- **Do not** assume one logical SG → one `.Cxx` file. `AKMB` shares `KMB_E46.C0?` with
  `KMB` (different `UMRSG`, same `SGNAME` / `CBD`).

### 8.4 The two correct lookup paths

**FA-driven** (what NCS Expert does): walk `SGAUSWAHL_VMSGBD` → `SGAUSWAHL_SGBD` →
`SGAUSWAHL_VM` and evaluate each row's `AUFTRAGSAUSDRUCK` against the FA-derived ASW. For
each surviving row:

```
file       = <chassis_dir>/<row.SGNAME>.<row.CBD>
sgbd       = row.SGBD                    // for apiJob()
ui_label   = row.UMRSG                   // what to show the user
```

This is what `packages/ecu-select` returns as `SelectedSg[]` (`selected.sgName` is the
SGAUSWAHL `SGNAME`, `selected.cbd` is the suffix).

**File-system enumeration** (what NCS Dummy does): `Directory.GetFiles(chassisDir,
"*.C??")`, group by basename. Each entry is `(SGNAME, [CBD, …])` directly — no SGAUSWAHL
walk needed. To label each module with its logical SG(s), find `SGAUSWAHL_*` rows where
`SGNAME == basename`, then collect their `UMRSG` column.

This is what `packages/chassis`'s `CabdLoader.listModules()` returns and what
`apps/web`'s `ModuleList` renders.

### 8.5 Ghidra source-code anchors

- `FUN_00427610` — `coapiReadCbdFromBr`. Walks `SGAUSWAHL_*` rows, collects parallel
  `CBD` and `CABD` arrays.
- `FUN_00434060` — `coapiGetAllSgetData`. Row iterator over the active SGAUSWAHL block.
  Seven output parameters in the SGAUSWAHL_SGBD case: `(SGNAME, CBD, CABD, SGBD, UMRSG,
  AUFTRAGSAUSDRUCK_bytes, INDEX)`. Exact column-to-parameter mapping depends on which
  `SGAUSWAHL_*` block is active (`SGAUSWAHL_VM` drops CABD/SGBD; `SGAUSWAHL_VMSGBD`
  adds `VMG`).
- `FUN_00432500` — `CDHGetCabdName`. Trivial getter, copies the currently-selected
  CABD's logical name out of `DAT_0061a6d4`. The setter is in the SGAUSWAHL walker.
- NCS Dummy parallel: `Classes/Modules/ModuleListReader.cs:25-43` (`Directory.GetFiles`
  pattern).

## 9. Open questions

1. **`VMG` / `VM` matching tie-breakers** — when two `SGAUSWAHL_VM` rows match, which wins? Probably the first (file order), but this needs confirming by single-step in Ghidra through `coapiGetVmSgName`.
2. **ZCSUT update flow** — `coapiChangeZcsVm` rewrites ZCS after coding when `[CODING].ZcsutLesen=1` / `ZcsSchreibenModus=3`; the rules for which SGs receive the write are in `<BR>ZCSUT.000` and not yet decoded. Related: see `docs/ssd-zut-format.md` for the `.ssd`/ZUT record format that drives this subsystem.

### ZCSUT update — what we know from `coapiChangeZcsVm` (`FUN_0042b420`)

The function takes four strings (`GM_SCHLUESSEL`, `SA_SCHLUESSEL`, `VN_SCHLUESSEL`, `AM_SCHLUESSEL`), plus a mode flag selecting between `coapiChangeZcs` (mode 0) and `coapiChangeZcsVm` (mode ≠ 0), plus an out param that returns the **count of affected SGs**. The flow:

1. **Validate** the three input keys (GM/SA/VN) — non-empty check.
2. `FUN_0042a2f0(GM, SA, VN, 0)` — parse & validate against current FA.
3. `FUN_00434130(...)` — fetch the active FA into a local buffer.
4. Dispatch on mode:
   - mode 0: `FUN_0042b040(fa, AM, out1, out2, out3, out4, 1)` — `coapiChangeZcs` path.
   - mode ≠0: `FUN_004295a0(fa, AM, out1, out2, out3, out4)` — `coapiChangeZcsVm` path (variant-aware).
5. Both produce up to four output strings (`out1..out4`). The decoder picks one of three "type-tags":
   - **Tag 1**: simple value parsed from `out1` (`_strtoul(out1, …, 0x10)`).
   - **Tag 2**: pair `(strtoul(out2,16), strtoul(out3,16))` — used when both `out2` and `out3` are populated. Likely a range or "before/after" pair.
   - **Tag 3**: value from `out4`.
6. `FUN_0043e4f0(AM_buf, tag, val1, val2)` — apply the change to the ZCSUT model.
7. `FUN_0043cea0()` returns the **affected-SGs count** → stored in `*param_6` (the out param).
8. If anything changed, `FUN_0043ec30/50/70(GM, SA, VN)` write the **three updated keys** back to the active state.

This means **the ZCSUT lookup is what tells NCSEXPER which SGs need re-coding** after a ZCS edit — the affected-count gates whether the post-coding sweep runs. The actual `<BR>ZCSUT.000` interrogation happens inside `FUN_0043e4f0` / `FUN_0043cea0`, which still need a dedicated decompilation pass.
