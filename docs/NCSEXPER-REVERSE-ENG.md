# NCSEXPER (NCS Expertentool) — Reverse-Engineering Notes

Analysis target: `~/Downloads/inpa/NCSEXPER/BIN/NCSEXPER.exe`
(PE32 i386, BMW/Softing, EDIABAS 6.0.2, NCS Expert version 4.0.1, 2013)

Reference projects already mapped:
- `~/Projects/my/ediabasx/` — EDIABAS / api32 / BEST-VM port (TypeScript)
- `~/Projects/my/inpax/` — INPA / IPO interpreter port (TypeScript)
- `~/Projects/my/bimmerz/packages/ncs-data/` — partial DATEN parser (TypeScript)

## Doc map

This file is the high-level overview. Format details and runtime flows live in sibling files in this folder:

| Doc | Covers |
|-----|--------|
| [`pfl-format.md`](pfl-format.md) | PFL profile INI format — every section, every key, the shipped profiles, what consumes each key, Lesemodus bounds. |
| [`daten-format.md`](daten-format.md) | DATEN folder formats — the binary frame format (signature, frame types, format-string mini-language, full `A` OPERATION operator set, `EINHEIT` units) **and** the text-table family (ZST, AT, SGFAM, AT.M00, AT.ZUS, VARIABLE.ASC). |
| [`ecu-selection.md`](ecu-selection.md) | How NCSEXPER turns `(BR, VIN, ZCS, FA)` + profile into a concrete list of ECUs to code, via COAPI/CDH/SGET/SGFAM. Includes the `AUFTRAGSAUSDRUCK` byte-coded predicate grammar. |

---

## 1. Architecture — high level

NCSEXPER is a thin **Win32 (MFC-style) GUI** wrapped around **three embedded runtimes**:

```
                ┌─────────────────────────────────────────────┐
                │  NCSEXPER.exe (MFC-style Win32 UI)          │
                │  - main menu / function keys                │
                │  - profile editor (PFL)                     │
                │  - VIN/ZCS/FA/Baureihe wizard               │
                └──────────┬─────────────┬──────────────┬─────┘
                           │             │              │
              ┌────────────▼──┐ ┌────────▼──────┐ ┌─────▼────────┐
              │ COAPI / CDH   │ │ INPA IPO      │ │ Verification │
              │ (coding API + │ │ interpreter   │ │ engine       │
              │ data handler) │ │ runs SGDAT\   │ │ runs .ssd    │
              │ reads DATEN\  │ │ *.ipo         │ │ scripts      │
              └────────────┬──┘ └────────┬──────┘ └─────┬────────┘
                           │             │              │
                           └─────────────┴──────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │  api32.dll  (EDIABAS 6.0.2)  │
                          │  loaded dynamically:         │
                          │  apiInit / apiJob / apiResult│
                          └──────────────┬───────────────┘
                                         │
                                         ▼
                              Vehicle bus (KWP/DS2/UDS)
```

Layers, briefly:

- **GUI / business logic** — profile load/save, BR selection, ECU list management, coding/verify state machine. Hard-coded into `NCSEXPER.exe`.
- **COAPI / CDH** — the coding-API library. Splits in two layers:
  - **COAPI** (`COAPI.CPP`, `COAPI2.CPP`, `COAPI4.CPP`, `COAPIPAR.CPP`, `COAPIIUP.CPP`, `COAPIPFD.CPP`, `COAPIKF.CPP`, `COAPIEBA.CPP`, `COAPIINI.CPP`) — high-level: `coapiSetBaureihe`, `coapiGetAswFromAuftrag`, `coapiScanAllSgFromBr`, `coapiCodeSgByFswPswList`, …
  - **CDH** ("Coding Data Handler") — lower-level: `CDHSetBaureihe`, `CDHReadSget`, `CDHGetVmGerName`, `CDHGetCabdName`, `CDHGetFswPswFromCvt`, …
  Source modules visible from the embedded debug strings — see `0x005af060` (`COAPI.CPP`) through `0x005b1b48` (`COAPIEBA.CPP`).
- **INPA IPO interpreter** — embedded inside NCSEXPER (not a separate process). Runs the per-ECU `.ipo` scripts in `SGDAT\` that decide which EDIABAS jobs/parameters to actually send for each operation. NCSEXPER provides the INPA system-function table (`INPAapiInit/End/Job/Result*`, `setscreen`, `setmenu`, `__inpa_startup__`, etc.) that those scripts call into.
- **Verification engine** — small embedded "do these jobs, check `JOB_STATUS`" runtime driven by `.ssd` files. Implemented as `CCreateJobCond` / `CJobCond` / `CReadErrCond` (strings at `0x0049386c`+ and beyond).
- **EDIABAS** — `api32.dll` is loaded with `LoadLibraryA("api32.dll")` + `GetProcAddress`; the wrapped exports `___apiInit@4`, `___apiJob@20`, `___apiResultText@20` etc. are visible in `.rdata`. Version banner: `EDIABAS Version 6.0.2 / Copyright BMW AG, created by Softing GmbH`.

### Boot sequence (decompiled wrappers, original analysis pass)

```c
void FUN_00454580(void) {                       // apiInit wrapper
    DAT_00497b54 = 1;
    iVar1 = ___apiInit_4(&DAT_004a3ca8);        // EDIABAS handle stored at 0x4a3ca8
    FUN_004545cb(iVar1);                        // error path
}

void FUN_004546de(p1, p2, p3, p4) {              // apiJob wrapper
    ___apiJob_20(DAT_004a3ca8, p1, p2, p3, p4); // p1=SGBD, p2=job, p3=params, p4=resultset
}

void FUN_0042580c(p1, p2, p3, p4) {              // INPAapiJob → EDIABAS bridge
    FUN_004546de(p1, p2, p3, p4);
    h = GetModuleHandleA("WEUSER");
    if (h) { p = GetProcAddress(h, "USERSTARTDIAGINFO"); if (p) p(); }
}
```

`FUN_0042580c` is **the** bridge: every `apiJob(...)` invocation an IPO script issues lands here.

### Does NCSEXPER use INPA? — yes, embedded

NCSEXPER does **not** spawn `inpa.exe` and does **not** dynamically link `inpaus.dll` / `inpager.dll`. The strings `inpaus.dll`, `inpager.dll`, `inpa.ini`, `inpascr.ini` exist only as legacy fallback paths. The IPO loader (`TEST-Infotext` header at `0x0049a1b4`), the INPA system-function set, the `__inpa_startup__`/`__inpa_shutdown__` lifecycle and the `Address / OpCode` bytecode dumper are all linked into `NCSEXPER.exe` itself.

SGDAT IPO files use the same header format as INPA's own scripts (see [`inpax/docs/ipo-file-structure.md`](../../inpax/docs/ipo-file-structure.md)), so the inpax interpreter can be reused 1:1.

What NCSEXPER adds **on top of** vanilla INPA:
- The **CABD / DATEN** subsystem (variant tables, coding decoder, ZCS handling) — see [`daten-format.md`](daten-format.md).
- The **profile / verification** subsystem (PFL switches gating which buttons appear, plus the `.ssd`-driven verifier).
- The **FAB manager** (`WEFABM`) for the diagnostics fingerprint files in `..\INPA\FAB`.

### Evidence in the binary

| Address(es) | String                                          | What it tells us |
|-------------|--------------------------------------------------|------------------|
| `0049a1b4`  | `TEST-Infotext`                                 | Embedded IPO loader. |
| `0048d418`, `0048d49c`, `0048e854` | `..\sgdat\`              | SGDAT path used for IPO scripts. |
| `0048c142`  | `api32.dll`                                      | Dynamic EDIABAS DLL load. |
| `0048bebc..0048bf50` | `___apiInit@4`, `___apiJob@20`, `___apiJobData@24`, `___apiJobExt@36`, `___apiJobInfo@8`, `___apiResult*` | EDIABAS API surface. |
| `0048e250..0048e328` | `INPAapiInit`, `INPAapiEnd`, `INPAapiJob`, `INPAapiResultText/Int/Sets/Digital/Analog/Binary`, `INPAapiCheckJobStatus`, `INPAapiFsLesen/Lesen2/Mode` | NCSEXPER's implementation of the INPA system-function table. |
| `0048dd44`, `0048f034` | `setmenu`, `setmenutitle`, `setscreen`     | INPA screen/menu system embedded. |
| `0048d484`, `0048d490`, `0048d208` | `inpa.ini`, `inpascr.ini`, `inpa.err` | Legacy INPA config naming. |
| `005af060..005b1b48` | `COAPI.CPP` … `COAPIEBA.CPP`                | COAPI library source modules. |
| `005af0f8..005dc024` | `coapi*` function-name table                 | Public/internal COAPI API names — read together with [`ecu-selection.md`](ecu-selection.md). |
| `005af9f0..005b0a08` | `CDH-LIB`, `CDH*`                            | Coding-Data-Handler API names. |
| `006051e0..0060523c` | `AUSDRUCK.C`, `ausdruckCheckAuftrag`, `ausdruckCheckAMerkmal` | FA-expression matcher. |
| `0048f6e0..0048f9c0` | `Decodiertabelle …`, `numerische/Bit-/wertunabhaengige/Konstanten-/Sonder-Decodierung` | Six "Decodiertyp" cases for CABD coding rules. |
| `00497b84`  | `, EDIABAS Version 6.0.2\nCopyright BMW AG, created by Softing GmbH` | Toolchain version. |

---

## 2. Configuration & data files at a glance

(Detailed schemas in the dedicated docs.)

| File / dir                     | Format                       | Purpose | Doc |
|--------------------------------|------------------------------|---------|-----|
| `BIN/NCSEXPER.INI`             | INI (window position only)   | UI state. | — |
| `CFGDAT/COAPI.INI`             | INI                          | Tool-wide paths (`*_PFAD_DATEN`, `*_PFAD_TAB`), tracing, system data (factory/dealer numbers). | (covered inline in §3 below) |
| `CFGDAT/INPA.INI`              | INI                          | INPA fallback config — only the legacy interpreter cares. | — |
| `CFGDAT/NCSEXPER.TXT`          | INI                          | UI string-table for German/English text. | — |
| `CFGDAT/COAPI.ERR.{eng,ger}`   | text                         | COAPI error messages. | — |
| `CFGDAT/Edierror.{eng,ger}`    | text                         | EDIABAS error texts. | — |
| `PFL/*.pfl`                    | INI                          | Coding **profile** (which buttons, which gates, which jobs). | [`pfl-format.md`](pfl-format.md) |
| `DATEN/BR_REF.DAT`             | binary frames                | Top-level chassis index. | [`daten-format.md`](daten-format.md#19-per-file-role--binary-family) |
| `DATEN/<BR>/<BR>DST.000`       | binary frames                | Chassis master index. | same |
| `DATEN/<BR>/<BR>SGET.000`      | binary frames                | FA-expression → ECU list. | same |
| `DATEN/<BR>/<BR>SGVT.000`      | binary frames                | Per-SG variant resolution. | same |
| `DATEN/<BR>/<BR>ZCSUT.000`     | binary frames                | ZCS update table. | same |
| `DATEN/<BR>/<BR>CVT.000`       | binary frames                | Chassis constants. | same |
| `DATEN/<BR>/<sgbd>.Cxx`        | binary frames                | Per-SG CABD coding rules. | same |
| `DATEN/<BR>/<BR>SGFAM.DAT`     | text (CRLF, ISO-8859-1)      | Logical SG → CABD / SGBD map. | [`daten-format.md` §2.6](daten-format.md#26-sgfam--sg-family-map-brsgfamdat) |
| `DATEN/<BR>/<BR>ZST.000`       | text                         | SA-bit / FSW master table. | [`daten-format.md` §2.2](daten-format.md#22-zst--zentrale-steuerwort-tabelle-brzst000) |
| `DATEN/<BR>/<BR>AT.000`        | text                         | Auftrag (FA token) dictionary. | [`daten-format.md` §2.3](daten-format.md#23-at--auftragsdatei-brat000) |
| `DATEN/<BR>/<BR>AT.M00`        | text                         | Compact M-list (FA tokens). | [`daten-format.md` §2.4](daten-format.md#24-atm00--compact-m-list) |
| `DATEN/<BR>/<BR>AT.ZUS`        | text                         | AT companion / change log. | [`daten-format.md` §2.5](daten-format.md#25-atzus--zusatz) |
| `SGDAT/*.ipo`                  | compiled INPA bytecode       | Per-ECU script (job sequence). | [`inpax/docs/ipo-file-structure.md`](../../inpax/docs/ipo-file-structure.md) |
| `STDAT/*.ssd`                  | text (mini-language)         | Verifier scripts. | TODO |
| `WORK/`                        | various                      | Runtime traces / logs. | — |

---

## 3. CFGDAT/COAPI.INI — runtime paths

Important for re-implementation because it's read **before** any DATEN file. The shipped example sets:

```
[SETUP]
CabdFormat = IPO                          ; CABD modules are IPO-driven

[Baureihe]
Baureihe = E31,E32,E33,E34,E36,…          ; chassis the install supports

[Pfadangaben]
EXX_PFAD_DATEN = ..\daten                 ; generic fallback
E46_PFAD_DATEN = ..\daten\e46             ; per-chassis path
…                                          ; one *_PFAD_DATEN per chassis
EXX_PFAD_TAB   = ..\TAB
…
ERROR_TEXTE    = ..\cfgdat
WORKING_DIR    = ..\work
GENERAL_KF_DATA_PATH = ..\data

[Systemdaten]
WERK_NR = 0000
HAENDLER_NR = 12345
…                                          ; checksums, default keys, etc.

[Filter]
AswFilter = ASCII                          ; ASCII | BINARY | NONE
FswFilter = ASCII

[Trace]
GesamtTrace = ON                           ; master trace switch
AswTrace = OFF                             ; per-subsystem traces
…
```

NCSEXPER reads keys via `GetPrivateProfileStringA` keyed by `<BR>_PFAD_DATEN` (string handle `%s_PFAD_DATEN` at `0x005b0eac`); when no chassis-specific override exists, the `EXX_` family is used.

---

## 4. EDIABAS jobs invoked

Direct calls from `NCSEXPER.exe` itself are limited — almost all decisions live in the IPO scripts.

### 4.1 Hard-coded in the EXE

| String       | Where used | Notes |
|--------------|------------|-------|
| `FS_LESEN`   | `INPAapiFsLesen` / `INPAapiFsLesen2` bridge, `ApiJobFsLesenFAB` | Fault-memory read. |
| `IS_LESEN`   | Identification read path. | |
| `JOB_STATUS` | Result-set field polled after every job. | OK/NOT-OK gate. |
| `FGNR_LESEN` (`005af7e0`), `FGNR_SCHREIBEN` (`005dbbf0`) | `coapiReadFgNr` / `coapiSetFgNr` | VIN read/write. |
| `CODIERUNG_LESEN`, `CODIERDATEN_LESEN`, `CODIERINDEX_LESEN`, `SG_CODIEREN`, `TEILBEREICH_CODIEREN`, `NETTODATEN_CODIEREN`, `INFO`, `JOB_ERMITTELN` | COAPI's defaults — the `INFO,JOB_ERMITTELN,SG_CODIEREN,CODIERDATEN_LESEN` 4-tuple (string `0x005dbb60`) is what gets called on every coding cycle. |
| `FA_READ`, `FA_WRITE`, `FA_STREAM` | FA read/write helpers. |
| `AUTHENTISIERUNG`, `DIAGNOSE_AUFRECHT`, `NORMALER_DATENVERKEHR`, `ACCESS_TIMING_PARAMETER`, `DIAGNOSEPROTOKOLL_LESEN` | Standard EDIABAS diag-plumbing. |

Verification / `.ssd` scripts can call any further job, since they pass `(SGBD, JOB, params)` triples to the verifier engine.

### 4.2 In the IPO scripts (SGDAT)

The per-ECU IPO scripts are where the bulk of the catalogue lives. Headline jobs harvested from `strings SGDAT/*.ipo` across all 2,202 shipped IPOs:

**Identification / status**
- `SG_IDENT_LESEN`, `SG_AIF_LESEN` / `SG_AIF_SCHREIBEN`
- `SG_STATUS_LESEN` (+ `_INTERN`, `_MODI`, `_REGLER`)
- `SG_STATUS_SCHREIBEN_MODI` / `_REGLER` / `SG_STATUS_SETZEN`
- `SG_PHYS_HWNR_LESEN`, `SG_RESET` (+ `_OHNE_UHR_DATUM`)
- `IDENT`, `VersionInfo`, `HwReferenzLesen`, `DatenReferenzLesen`, `ZifLesen`, `ZifBackupLesen`, `AifLesen`, `AifSchreiben`, `FlashStatusLesen`, `INFO`, `JOB_ERMITTELN`

**Coding (core NCS workflow)**
- `CODIERUNG_LESEN`, `CODIERUNG_LESEN_ALLES`, `CODIERUNG_LAENDERVARIANTE_LESEN`, `CODIERUNG_MULTIFUNKTION_LESEN`, `CODIERUNG_BLOCK_1_LESEN`
- `CODIERDATEN_LESEN`, `CODIERDATEN_SCHREIBEN`, `CODIERDATEN1_LESEN`, `CODIERDATEN1_SCHREIBEN`
- `CODIERDATEN_TMS_BLOCK_LESEN_LEAR`, `CODIERDATEN_TMS_BLOCK_SCHREIBEN_LEAR`, `CODIERDATEN_TMS_CHINA`
- `CODIERINDEX_LESEN`
- `SG_CODIEREN` and the variants `SG_CODIEREN_OHNE_CI`, `_OHNE_FG`, `_OHNE_FG_AEI`, `_OHNE_KLIMA`

**VIN / FG / ZCS**
- `FG_NR_LESEN`, `FG_NUMMER_LESEN`, `FG_VERGLEICH`
- `VIN_SMC_LESEN`, `VIN_SMC_LINKS`, `VIN_SMC_RECHTS`, `VIN_SMC_LINKS_SCHREIBEN_LEAR`, `VIN_SMC_RECHTS_SCHREIBEN_LEAR`, `FG_NR_SMC_LESEN`, `FG_ALS_BT_USER_FRIENDLY_NAME_SCHREIBEN`
- `ZCS_LESEN`, `ZCS_SCHREIBEN`, `ZCS_LOESCHEN`

**Fault memory / diag plumbing**
- `FS_LESEN`, `FS_HEX_LESEN`, `FS_DEL`, `FS_INIT`, `FS_FILE_MODE`, `FS_ERROR_INFOS`
- `FS_IS_HS_LESEN`, `FS_IS_HS_LOESCHEN` (+ `_ALT`, `_FUNKTIONAL`, `_MANUEL`, `_F01BN2K`, `_SHOWRES`)

**Programming / authentication / bus state**
- `SG_PROGRAMMIEREN`, `Programmieren`
- `AUTHENTISIERUNG`, `AUTHENTISIERUNG_START`, `AUTHENTISIERUNG_ZUFALLSZAHL_LESEN`
- `DIAGNOSE_AUFRECHT`, `NORMALER_DATENVERKEHR`, `ACCESS_TIMING_PARAMETER`, `_DEFAULT`
- `DIAG_PROT`, `DIAGNOSE_ENDE`, `DIAGNOSE_MODE`, `DIAGNOSEPROTOKOLL_LESEN`

**Misc / cabi runtime**
- `TestApiFehler`, `TestApiFehlerNoExit`, `TestCDHFehler`, `SetCDHFehler`, `TesterPresentHandling`
- `OutputDebugString`, `OutputDebugInt`, `OutputDebugBool` (INPA-side trace helpers)

### 4.3 Extracting per-IPO job lists

```bash
strings ~/Downloads/inpa/NCSEXPER/SGDAT/<NAME>.ipo | \
  grep -E '^[A-Z][A-Z0-9_]{3,}$' | sort -u
```

Caveat: that also returns parameter tokens (`NEIN`, `JA`, `OKAY`, `JOB_STATUS`, `JOB[N]`). The clean approach (once the IPO interpreter is wired up) is to walk the IPO's `Constants Data` block — each IPO declares a `Jobs` array near the top (e.g. for `00EK9272.ipo`: `JOB_ERMITTELN`, `INFO`, `SG_IDENT_LESEN`, `SG_AIF_LESEN`, `SG_AIF_SCHREIBEN`, `SG_STATUS_LESEN`, `SG_PROGRAMMIEREN`, …).

### 4.4 GUI ↔ IPO contract

For every chassis-level operation:

1. NCSEXPER reads PFL flags + DATEN (SGFAM/DST/SGET) to decide **which logical ECUs** are in scope — full flow in [`ecu-selection.md`](ecu-selection.md).
2. For each ECU it resolves logical name → CABD file (`A_*`) → SGBD module → IPO script via `<BR>SGFAM.DAT`.
3. The relevant IPO entry point (`SG_CODIEREN`, `CODIERUNG_LESEN`, `SG_IDENT_LESEN`, …) runs under the embedded interpreter.
4. Inside the IPO, `apiJob(SGBD, "<JOB>", "<params>", "")` is issued; the bridge forwards to `api32.dll::__apiJob@20`.
5. Results are read back with `apiResult*` and the IPO propagates them to NCSEXPER's coding state machine.

This is why the EXE itself carries very few hard-coded job names — pushing per-ECU logic into IPOs is how BMW evolves coverage per model year without re-shipping NCSEXPER.

---

## 5. Suggested re-implementation order (ncsx)

1. **PFL parser/serializer** — trivial INI work; mirrors `ediabasx/packages/ini-parser`. Schema in [`pfl-format.md`](pfl-format.md). Round-trip with checksum.
2. **DATEN binary frame parser** — fork from `bimmerz/packages/ncs-data`. Fix `A` field (5 bytes not 1) and range / non-empty collections; CRC is already XOR-fold. Add chassis-level loader (`BR_REF.DAT` → `<BR>DST.000` graph). Spec in [`daten-format.md` §1](daten-format.md#1-binary-frame-format). Concrete delta in [`POC-DELTAS.md`](POC-DELTAS.md).
3. **DATEN text parser** — ZST / SGFAM / AT / AT.M00 / AT.ZUS. Spec in [`daten-format.md` §2](daten-format.md#2-text-table-format). FA-token-to-ASW-bit mapping is the load-bearing one.
4. **CABD decoder** — six Decodiertyp cases (numerisch / bit / wertunabhaengig / reverse-wertunabhaengig / Konstante / Sonder).
5. **FA-expression matcher** — port `ausdruckCheckAuftrag` / `ausdruckCheckAMerkmal`. Required to drive ECU selection from FA. See [`ecu-selection.md` §3.4](ecu-selection.md#34-step-4--sget-driven-enumeration-the-matcher).
6. **IPO interpreter** — reuse `inpax`. NCSEXPER's `INPAapi*` table is a strict subset of `inpax`'s system-function list, so wiring the existing VM into ncsx mostly means stubbing the screen/menu surface and pointing `apiJob` at `ediabasx`.
7. **GUI** — last. Once 1–6 work, NCSEXPER's UI is just orchestration over them.

---

## 6. Ghidra investigation status

### Done (this round)

- **`AUFTRAGSAUSDRUCK` grammar** — fully decoded from `AUSDRUCK.C` (`ausdruckCheckAuftrag` = `FUN_0045ec50`, `ausdruckCheckAMerkmal` = `FUN_0045ed20`) and the evaluator stack (`FUN_0046f3e0` / `FUN_0046f4e0` / `FUN_0046f2d0` / `FUN_0046f5e0`). Documented in [`ecu-selection.md` §6](ecu-selection.md#6-auftragsausdruck--byte-coded-predicate-grammar).
- **Lesemodus value ranges** — confirmed from the profile loader (`FUN_00418d20`): `FgNrEingabeModus ∈ {1,2}`, `AswLesenModus`/`FswPswLesenModus ∈ {0..2}`, `NettoDatenLesenModus ∈ {0..3}`, `ZcsSchreibenModus ∈ {1..3}`. Recorded in [`pfl-format.md`](pfl-format.md).
- **`ProfilPruefsumme` storage** — confirmed it's stored as `%s` and **not validated/recomputed** by the load/write pair. It's opaque metadata maintained by the editor dialog. Documented in [`pfl-format.md` §3.1](pfl-format.md#31-header).
- **CABD `A` (OPERATION) operator set** — extracted from `GetDataFromOperation` (`FUN_004575c0` in `CBD_READ.C`). Full set is 9 operators (`! & * + - / > ^ |`), each with a `u32 LE` operand. Confirmed the field is 5 bytes (1 char + 4 operand), and multiple OPERATION entries can be chained. Documented in [`daten-format.md` §1.7](daten-format.md#17-the-a-operation-field).
- **`EINHEIT` units** — 5 single-char codes (`A`, `a`, `b`, `d`, `h`) controlling how source bytes fold into the value an OPERATION list then transforms. Documented in [`daten-format.md` §1.8](daten-format.md#18-the-einheit-unit-byte).
- **DATEN-frame CRC formula** — confirmed XOR-fold against the canonical 12-byte signature frame (`XOR([0x07, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]) = 0x65`, matching the byte at offset 11). The bimmerz POC's `@bimmerz/core::calculateCrc` is the correct implementation.

### Still open

- **`ProfilPruefsumme` *editor* write-path** — confirmed not on the load/save round-trip; pin down the editor-dialog action that mutates the field.
- **Lesemodus enum value names** — ranges known, but the symbolic meaning of each integer lives inside `coapiReadAsw` / `coapiReadFswPsw` / `coapiReadNettoData` (and the per-button GUI handlers). Run a Ghidra pass over those switch statements.
- **`UMRSG` column** in SGET — semantics not yet pinned down; suspected "Umrechnungs-SG" (variant-translation SG).
- **ZCSUT update rules** — `coapiChangeZcsVm` xrefs.
- **`.ssd` verification grammar** — `CCreateJobCond` / `CJobCond` / `CReadErrCond` xrefs (separate doc to produce later).
