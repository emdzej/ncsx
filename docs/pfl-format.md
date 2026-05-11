# PFL Profile File Format

Reference for `.pfl` files under `NCSEXPER/PFL/`. A profile is the policy NCSEXPER applies to a coding session — it decides which buttons appear, which subsystems read/write, which jobs run, and which verification scripts gate the workflow.

## 1. Container

PFL files are **plain Windows INI** files (`file(1)` reports them as "Generic INItialization configuration"). NCSEXPER reads them with `GetPrivateProfileStringA` / `GetPrivateProfileIntA` and writes them with `WritePrivateProfileStringA` (all three imported by the EXE).

- Encoding: ANSI (CP1252) — German umlauts present in `ProfilBezeichnung` / `ProfilKommentar`.
- Line endings: CRLF.
- Comments: `;` starts a comment line (standard Win32 INI).
- Section headers are `[NAME]`, keys are `Key=Value`.
- Whitespace around `=` is tolerated.
- Sections and keys are **case-insensitive** (Win32 INI behaviour).
- All known PFLs use `ProfilFormatVersion=3.0`; no other versions in the field.

## 2. Section index

A complete profile has these 10 sections, in this canonical order:

```
[HEADER]
[FGNR_ZCS]
[ASW]
[FSWPSW]
[NETTODATEN]
[SGET]
[CODING]
[INDIVID]
[VERIFIKATION]
[APPLIKATION]
```

Missing keys fall back to the in-EXE defaults (typically `0`). Missing **sections** generally mean "subsystem disabled". A round-trip serializer should emit all sections in this order.

## 3. Section schemas

In the tables below: `bool` is `0`/`1`. `int` is a small unsigned decimal. `string` is free text (may contain spaces; trailing whitespace preserved). Where a key was seen in the shipped profiles, the typical/sentinel values are given.

### 3.1 `[HEADER]`

Metadata describing the profile itself.

| Key                     | Type   | Required | Example                | Meaning |
|-------------------------|--------|----------|------------------------|---------|
| `ProfilFormatVersion`   | string | ✔        | `3.0`                  | File format version. Only `3.0` observed. |
| `ProfilBezeichnung`     | string | ✔        | `Expertenmodus 2.0`    | Display name shown in the profile picker. |
| `ProfilKommentar`       | string |          | `Codierprofil`         | Free-text description. |
| `ProfilTag`             | string |          | (often empty)          | Day of profile creation (`DD`). |
| `ProfilMonat`           | string |          | (often empty)          | Month (`MM`). |
| `ProfilJahr`            | string |          | (often empty)          | Year (`YYYY`). |
| `ProfilPruefsumme`      | hex u16| ✔        | `0058`                 | 4-hex-digit tag stored as `%s` (not as `%d`). Confirmed by Ghidra: the loader (`FUN_00418d20`) reads it via `FUN_0043c860("ProfilPruefsumme", default, 0)` (`GetPrivateProfileStringA` wrapper) and writes it back via `_sprintf(local_e4, "ProfilPruefsumme=%s\n", *(iVar18 + 0x38))` — **no validation, no recomputation**. Round-tripping is byte-perfect; treat it as opaque metadata that the profile editor maintains. |

### 3.2 `[FGNR_ZCS]` — VIN / ZCS entry

Controls the first wizard step ("enter VIN / ZCS / Baureihe").

| Key                     | Type | Example | Meaning |
|-------------------------|------|---------|---------|
| `FgNrEingabeModus`      | int  | `1`     | VIN entry mode. **Loader only accepts `1` or `2`**; values outside that range are silently ignored (kept at default). `1` = editable, `2` = read-only (or vice-versa, exact mapping in `coapiSetFgNr`). |
| `ChecksummeBerechnen`   | bool | `1`     | Recompute the VIN check digit when the user types. |
| `LoeschenVorEingabe`    | bool | `0`     | Clear the existing VIN/ZCS before opening the dialog. |
| `FktZcsEingeben`        | bool | `1`     | Show "Enter ZCS" button. |
| `FktZcsAusSteuerdatei`  | bool | `1`     | Allow loading ZCS from a `.ssd` steuer-file. |
| `FktZcsAusFahrzeug`     | bool | `1`     | Allow reading ZCS from the vehicle (calls `ZCS_LESEN`). |
| `FktBrAuswahl`          | bool | `1`     | Show the Baureihe selector (chassis dropdown). |

### 3.3 `[ASW]` — variant words (ASW)

Controls reading of the "Auswahl-Steuerwort" (variant word stream) per ECU.

| Key             | Type   | Example | Meaning |
|-----------------|--------|---------|---------|
| `AswLesenModus` | int    | `1`     | Source for ASW. **Loader bounds-check: `0..2`** (values ≥3 are dropped). Likely `0` = off, `1` = from FA, `2` = from ZCS. |
| `AswTrace`      | bool   | `1`     | Write `ASW` lookups to a trace file (`AswTraceFile` in `COAPI.INI`). |
| `AswLeseDatei`  | string | empty   | Override file used when `AswLesenModus` is "from file". |

### 3.4 `[FSWPSW]` — function/parameter coding words

Controls reading/manipulating FSW (Funktionsschlüsselwort) and PSW (Parameter-schlüsselwort) values.

| Key                     | Type   | Example | Meaning |
|-------------------------|--------|---------|---------|
| `FswPswLesenModus`      | int    | `1`     | Read mode. **Loader bounds-check: `0..2`**, same pattern as `AswLesenModus`. |
| `FswPswTrace`           | bool   | `1`     | Trace FSW/PSW reads. |
| `FswPswManipulieren`    | bool   | `0`/`1` | If `1`, the user may **edit** FSW/PSW values mid-session ("Expertenmodus offen" sets this). |
| `FswPswLeseDatei`       | string | empty   | Optional source-file override. |

### 3.5 `[NETTODATEN]` — raw coding bytes

Controls handling of the raw "netto" coding-data buffer (the bytes that actually go to the ECU).

| Key                          | Type   | Example | Meaning |
|------------------------------|--------|---------|---------|
| `NettoDatenLesenModus`       | int    | `1`     | Source for netto data. **Loader bounds-check: `0..3`** (4 modes, one more than ASW/FSW-PSW). |
| `NettoDatenTrace`            | bool   | `1`     | Trace netto-data reads. |
| `NettoDatenLeseDatei`        | string | empty   | Optional file override. |

### 3.6 `[SGET]` — SG-set picker

Controls how the user picks the set of ECUs to operate on.

| Key                | Type | Example | Meaning |
|--------------------|------|---------|---------|
| `SgetLesen`        | bool | `1`     | Actually load the SGET table for the current chassis. If `0`, no FA-driven ECU enumeration happens. |
| `FktSgAuswahl`     | bool | `1`     | Show the **ECU picker** ("Choose ECU"). Without this, the user can't manually narrow the set. |
| `FktSgetEingeben`  | bool | `0`/`1` | Allow editing SGET data inline (rare — only `Expertmodus (offen)` enables it). |

### 3.7 `[CODING]` — coding workflow

The fattest section — gates almost every operation under the "Process ECU" / "Process car" buttons.

| Key                          | Type   | Example | Meaning |
|------------------------------|--------|---------|---------|
| `ZcsutLesen`                 | bool   | `0`/`1` | Consult the ZCS-update table (`<BR>ZCSUT.000`). Required by Car & Key Memory mode. |
| `ZcsSchreibenModus`          | int    | `1`/`3` | When/whether to write ZCS back. **Loader bounds-check: `1..3`** (`0` is silently dropped — the value `0` you sometimes see in legacy profiles is treated as "no change to default"). `1` = after per-SG coding only, `2` = (unconfirmed — "deferred"?), `3` = after every change. |
| `ZcsVorCodierungLoeschen`    | bool   | `0`     | Erase ZCS before coding. |
| `ZcsNurAktuellesSg`          | bool   | `0`/`1` | Limit ZCS write to the currently-selected ECU. |
| `FktSgCodieren`              | bool   | `1`     | Show "Code ECU" button. |
| `FktFzgCodieren`             | bool   | `0`/`1` | Show "Code car" button. |
| `FktCodierJobAendern`        | bool   | `0`/`1` | Allow overriding the EDIABAS job NCSEXPER will call (`SG_CODIEREN` → custom). Used together with `SpezialJobName`. |
| `FktSgAuslesen`              | bool   | `0`/`1` | Show "Read ECU" button (read coding without writing). |
| `KonvertierenFswPsw`         | bool   | `0`/`1` | Convert FSW/PSW between text and binary representations on the fly. |
| `FktKernfunktionen`          | bool   | `0`/`1` | Show the Kernfunktionen (core-function) row. |
| `SpezialJobName`             | string | empty   | EDIABAS job name override (used when `FktCodierJobAendern=1`). |
| `SgCodFktText`               | string | empty   | Custom label for the per-ECU code button. |
| `FzgCodFktText`              | string | empty   | Custom label for the car-wide code button. |
| `CiFromSg`                   | bool   | `0`     | Source the coding-index from the **ECU itself** (read it live) instead of from ZCS. |

### 3.8 `[INDIVID]` — Car & Key Memory

Controls the "Individualisierung" mode (per-driver / per-key personalisation).

| Key                  | Type | Example | Meaning |
|----------------------|------|---------|---------|
| `CheckIndividTrace`  | bool | `0`/`1` | Verify and trace Individual coding operations. |
| `FktIndivid`         | bool | `0`/`1` | Show "Car/Key memory" button. |
| `FktKernfunktionen`  | bool | `0`/`1` | Show Kernfunktionen inside the Individ. menu (this is a **separate** key from `[CODING].FktKernfunktionen`). |

### 3.9 `[VERIFIKATION]` — `.ssd` verification

When set, NCSEXPER replays a `.ssd` script after key operations and gates the workflow on each step's `JOB_STATUS`. The verifier engine is the `CCreateJobCond` / `CJobCond` / `CReadErrCond` family inside the EXE.

| Key              | Type   | Example | Meaning |
|------------------|--------|---------|---------|
| `CodierungEin`   | bool   | `0`     | Verify coding (post-code check). |
| `VfpEin`         | bool   | `0`     | "VFP" verification step (Verfahrensprüfung). |
| `ZutEin`         | bool   | `0`     | "ZUT" verification step (ZCS update table). |
| `SteuerFileName` | string | empty   | Path to the `.ssd` controller file that the verifier executes. |

### 3.10 `[APPLIKATION]`

| Key          | Type   | Example | Meaning |
|--------------|--------|---------|---------|
| `AppKennung` | string | `SERIE` | Application channel. `SERIE` = production (default). Other values seen in the wild: `ENTW` (development), `WERK` (factory). Controls which subset of CABD revisions is admissible. |

## 4. Built-in profiles (shipped with NCSEXPER 4.0.1)

Each ships in `PFL/` and pre-selects a coherent set of switches:

| File                                  | Bezeichnung                              | What it unlocks |
|---------------------------------------|------------------------------------------|-----------------|
| `01_Default.pfl`                      | Default Profil                           | Read-only; no Kernfunktionen, no SGET editing, no per-car coding. |
| `Car Key Memory.pfl`                  | Car & Key Memory                         | Individual mode + ZCSUT on writes. |
| `Expertenmodus.pfl`                   | Expertenmodus 2.0                        | Full coding (per-ECU + per-car), Kernfunktionen, ZCSUT, manipulation of FSW/PSW, Individual on. |
| `Expertmodus (offen).pfl`             | Expertenmodus (OFFEN)                    | All of the above + `FktSgetEingeben=1`, `ZcsNurAktuellesSg=1`. Loosest profile. |
| `Expertmodus (Werkseinstellung).pfl`  | Expertenmodus (Werkseinstellung)         | Factory variant — Individual disabled, FSW/PSW manipulation off. |
| `ZCS bei nderung schreiben.pfl`       | SG Codieren mit ZCSUT…                   | Aggressive ZCS write-back, no Kernfunktionen / Individual. |
| `NCSDUMMY4.PFL`                       | NCS Dummy compatibility profile          | (Bundled for the NCS Dummy companion tool — same schema.) |

`PFL/Profile.txt` notes that additional profiles can be requested from `EI-73 Datenintegration` at BMW; profiles are **policy data**, not a versioned API.

## 5. Where the keys are consumed

(Determined from string xrefs inside NCSEXPER.exe with Ghidra. All keys are read by `GetPrivateProfileStringA` / `GetPrivateProfileIntA`; written by `WritePrivateProfileStringA`.)

| Section          | Reader / writer routine (string handle) |
|------------------|-----------------------------------------|
| `[FGNR_ZCS]`     | coapi VIN-input dialog wiring (`FG/ZCS/FA/Baureihe` dialog id) |
| `[ASW]`          | `AswLesenModus=%d\n`, `AswTrace=%d\n`, `AswLeseDatei=%s\n` (see `0x005e019c..`) |
| `[FSWPSW]`       | written by the FSW/PSW serializer (mirror of `AswLesenModus` family) |
| `[NETTODATEN]`   | written by the netto-data serializer |
| `[SGET]`         | `FktSgAuswahl=%d\n`, `FktSgetEingeben=%d\n` (`0x005e02b0..`) |
| `[CODING]`       | `ZcsVorCodierungLoeschen=%d\n`, `FktSgCodieren=%d\n`, `FktFzgCodieren=%d\n`, `FktCodierJobAendern=%d\n`, `FktSgAuslesen=%d\n`, `CodierungEin=%d\n` (`0x005e030c..`) |
| `[INDIVID]`      | individ. module config writer |
| `[VERIFIKATION]` | verifier (`CCreateJobCond` / `CJobCond`) |
| `[APPLIKATION]`  | `AppKennung` consumed by `coapiSetApplicationName` |

## 6. Re-implementing the parser

Minimal viable read/write:

```ts
import { Schema, parseIni, serializeIni } from "ini";  // or any Win32-INI-compatible lib

const Pfl = {
  HEADER: {
    ProfilFormatVersion: "string",
    ProfilBezeichnung: "string",
    ProfilKommentar: "string?",
    ProfilTag: "string?",
    ProfilMonat: "string?",
    ProfilJahr: "string?",
    ProfilPruefsumme: "hex16",
  },
  FGNR_ZCS: {
    FgNrEingabeModus: "int",
    ChecksummeBerechnen: "bool",
    LoeschenVorEingabe: "bool",
    FktZcsEingeben: "bool",
    FktZcsAusSteuerdatei: "bool",
    FktZcsAusFahrzeug: "bool",
    FktBrAuswahl: "bool",
  },
  ASW: { AswLesenModus: "int", AswTrace: "bool", AswLeseDatei: "string?" },
  FSWPSW: {
    FswPswLesenModus: "int",
    FswPswTrace: "bool",
    FswPswManipulieren: "bool",
    FswPswLeseDatei: "string?",
  },
  NETTODATEN: {
    NettoDatenLesenModus: "int",
    NettoDatenTrace: "bool",
    NettoDatenLeseDatei: "string?",
  },
  SGET: { SgetLesen: "bool", FktSgAuswahl: "bool", FktSgetEingeben: "bool" },
  CODING: {
    ZcsutLesen: "bool",
    ZcsSchreibenModus: "int",
    ZcsVorCodierungLoeschen: "bool",
    ZcsNurAktuellesSg: "bool",
    FktSgCodieren: "bool",
    FktFzgCodieren: "bool",
    FktCodierJobAendern: "bool",
    FktSgAuslesen: "bool",
    KonvertierenFswPsw: "bool",
    FktKernfunktionen: "bool",
    SpezialJobName: "string?",
    SgCodFktText: "string?",
    FzgCodFktText: "string?",
    CiFromSg: "bool",
  },
  INDIVID: {
    CheckIndividTrace: "bool",
    FktIndivid: "bool",
    FktKernfunktionen: "bool",
  },
  VERIFIKATION: {
    CodierungEin: "bool",
    VfpEin: "bool",
    ZutEin: "bool",
    SteuerFileName: "string?",
  },
  APPLIKATION: { AppKennung: "string" },
};
```

For the **checksum**: until the algorithm is reversed, keep the original `ProfilPruefsumme` on round-trip if no `[HEADER]`/`[…]` body bytes changed. To compute one from scratch, capture an unchanged profile, edit one byte, and binary-diff the result against NCSEXPER's writeback — that should pin it down. Ghidra entry points to look at: routines around the `005e0458 "CodierungEin=%d\n"` neighbourhood (the profile serializer) and the writes to `DAT_004a3ca8`-area globals where the in-memory profile struct lives.

## 7. Open questions

1. **`ProfilPruefsumme` semantics** — Ghidra confirms the loader doesn't validate or recompute it; the value is **opaque metadata** that the profile-editor dialog maintains by some user-visible workflow. (The shipped profiles span `003A`/`0058`/`0079`/`008A`/`00EA`/`00EB` with no obvious correlation to content.) Pin down the editor write-path if you ever need to mint a new profile programmatically.
2. **Lesemodus enum value names** — ranges confirmed (see §3.3–3.5/§3.7); the symbolic meaning of each integer is still inside `coapiReadAsw` / `coapiReadFswPsw` / `coapiReadNettoData` switch bodies.
3. **`[VERIFIKATION].SteuerFileName` script grammar** — separate doc; consumed by `CCreateJobCond` / `CJobCond` / `CReadErrCond`.
