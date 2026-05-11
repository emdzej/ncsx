# TRC and MAN files

Short answer:

- **TRC** files (`*.TRC`) are **plain-text trace logs** written by NCSEXPER's COAPI library — *not* by any EDIABAS job and *not* by IPO scripts. They record what the coding session did at the COAPI layer.
- **MAN** files (`*.MAN`) are **plain-text "manipulation" snapshots** of FSW/PSW values that the user edited inline (when `[FSWPSW].FswPswManipulieren=1` in the profile).
- Neither file is part of the EDIABAS job protocol. `SG_CODIEREN` and `CODIERDATEN_LESEN` only exchange **netto data bytes** with the ECU; the TRC/MAN files are NCSEXPER's own observability/audit artefacts, written by the COAPI layer that wraps those jobs.

## 1. Where they live

By default in `..\WORK\` (configured via `WORKING_DIR` in `CFGDAT/COAPI.INI`). NCSEXPER 4.0.1 ships these stub files:

| File             | Purpose | Default state |
|------------------|---------|---------------|
| `ABLAUF.TRC`     | "Execution flow" trace — every COAPI entry/exit and high-level decision. Always-on when `[Trace] GesamtTrace = ON`. | 16 bytes, `Exit:coapiInit\r\n` (only the init step ran). |
| `ASW1.TRC`       | Trace 1: ASW operations (`coapiTraceAsw` / `coapiTraceAswliste`). | empty (no session run). |
| `ASW2.TRC`       | Trace 2: ASW deltas / multiple-PSW comparisons. | empty. |
| `FSW_PSW.MAN`    | Manipulation log — captures user-edited FSW/PSW values. | empty (no inline edits performed). |

The exact filenames are **profile- and INI-driven**, not hard-coded. See §3.

## 2. What produces them

NCSEXPER has a per-subsystem trace layer inside COAPI. The relevant call sites (Ghidra string handles):

| String                          | Address     | What it writes |
|---------------------------------|-------------|---------------|
| `coapiSetTrace`                 | `0x005af168`| Toggle trace globally / per subsystem. |
| `coapiTestTrace`                | `0x005af188`| Cheap "is trace on?" probe used at the top of every COAPI entry. |
| `coapiTraceAblauf`              | `0x005af2b4`| Writes `ABLAUF.TRC` lines (`Entry:`/`Exit:<routine>`). |
| `coapiTraceAsw`                 | `0x005dbe18`| Writes ASW state to the configured ASW trace file. |
| `coapiTraceFswPsw`              | `0x005dbe38`| Writes FSW/PSW state. |
| `coapiTraceNettoData`           | `0x005dbe68`| Writes netto-data buffer (the raw bytes that go to / come from the ECU). |
| `coapiTraceFswMultiplePsw`      | `0x005af334`| Multi-PSW per FSW. |
| `coapiTraceSystemData`          | `0x005af300`| Writes system-data trace. |
| `coapiTraceIndividFswPsw`       | `0x005ddfd0`| Individual (Car & Key Memory) FSW/PSW. |

None of these are EDIABAS jobs. They run **alongside** the EDIABAS calls — typically before/after each `apiJob(SGBD, "SG_CODIEREN" \| "CODIERDATEN_LESEN" \| …)` — so the TRC files mirror, but are *not produced by*, the diagnostic dialog with the ECU.

The IPO scripts under `SGDAT\` are unaware of TRC/MAN. They only call `apiJob/apiResult*`; the COAPI bridge layer that invokes them is what writes the trace.

## 3. How tracing is configured

There are **two layers of switches** the user can flip:

### 3.1 Global toggles — `CFGDAT/COAPI.INI`

```ini
[Trace]
; ON, OFF
GesamtTrace        = ON           ; master switch — if OFF, nothing is written
;
AswTrace           = OFF          ; subsystem-specific switches
AswTraceFile       =              ; output path (default: WORK\ASW.TRC)
FswPswTrace        = OFF
FswPswTraceFile    =
NettoDatenTrace    = OFF
NettoDatenTraceFile=
SystemDatenTrace   = OFF
SystemDatenTraceFile=

[DiffDateien]
AswDiffFile        =              ; "diff" mode — compare current run vs. previous
FswPswDiffFile     =
NettoDatDiffFile   =
```

`GesamtTrace` is the master gate — when `OFF`, no other trace setting matters. `ABLAUF.TRC` is the only file always produced when `GesamtTrace=ON`.

The `[DiffDateien]` group is the *reference snapshot* used by `coapiCompareAsw` / `coapiCompareFswMultiPsw` / `coapiCompareNettoData` — if set, the new run is diffed against the file and only divergences get traced.

### 3.2 Per-profile toggles — PFL `[ASW]` / `[FSWPSW]` / `[NETTODATEN]`

The PFL profile (`AswTrace=1`, `FswPswTrace=1`, `NettoDatenTrace=1`) **overrides** the COAPI.INI defaults for that subsystem when a profile is loaded. The boolean from the PFL flows through `FUN_00424e80(<subsystem>, <enable>, …)` in the loader. Order of precedence:

```
COAPI.INI [Trace] flag    ──┐
                            ├──►   subsystem trace = effective
PFL [section] *Trace key  ──┘
```

The implementation OR-s them (any "ON" wins), so a profile can **enable** tracing the user hadn't turned on globally, but it can't turn off `GesamtTrace`.

## 4. File formats

### 4.1 `*.TRC` — trace logs

Plain ASCII, CRLF line endings, append-only. Each line is of the form:

```
<Tag>:<context>
```

The shipped `ABLAUF.TRC` contains exactly one entry:

```
Exit:coapiInit
```

A live session would interleave entries like:

```
Entry:coapiSetBaureihe
Exit:coapiSetBaureihe
Entry:coapiGetAswFromAuftrag
  AUFTRAGSAUSDRUCK=...
  ASW=...
Exit:coapiGetAswFromAuftrag
Entry:coapiRunCabd
  SG=KMB
  CABD=A_KMB46.C07
Exit:coapiRunCabd
```

Format intentionally human-greppable — there's no checksum, no schema, no fixed columns. NCSEXPER doesn't reload its own TRC files.

### 4.2 `*.MAN` — manipulation snapshots

Plain ASCII. Written when the user clicks "Edit FSW/PSW" in the profile editor (which is gated on `[FSWPSW].FswPswManipulieren=1`). Contents: the FSW/PSW key/value table after the edit, in the same on-screen format NCSEXPER uses for the manipulation dialog (one key=value pair per line, function-keyword from `<BR>ZST.000`).

`FSW_PSW.MAN` ships empty because the default profiles all set `FswPswManipulieren=0`. To get a non-empty sample, load `Expertenmodus.pfl` or `Expertmodus (offen).pfl` (both have `FswPswManipulieren=1`) and edit a value mid-session.

### 4.3 `*.DIF` (referenced but not shipped)

`[DiffDateien]` (`AswDiffFile` / `FswPswDiffFile` / `NettoDatDiffFile`) point to **input** files — the reference snapshots `coapiCompareAsw` etc. diff the live run against. Format is the same as the matching `*.TRC` output (so a previous session's TRC can be promoted to a baseline by renaming it). Not shipped in the stock install.

## 5. Where TRC/MAN intersect the SG_CODIEREN / CODIERDATEN_LESEN flow

The EDIABAS jobs are an inner detail; the COAPI bridge wraps each call with trace points:

```
coapiCodeSgByFswPswList(...)
 ├─ coapiTraceAblauf("Entry:coapiCodeSgByFswPswList")    → ABLAUF.TRC
 ├─ coapiTraceFswPsw(...)                                → FswPswTraceFile
 ├─ coapiGetNettoDataFromCbd(...)                        → builds netto buffer in RAM
 ├─ coapiTraceNettoData(...)                             → NettoDatenTraceFile
 ├─ ───────────────────────────────────────────────
 │   Embedded IPO interpreter runs <SGBD>.ipo's
 │   "SG_CODIEREN" entry point. That IPO calls
 │   apiJob("<SGBD>", "SG_CODIEREN", "<hex>", "")
 │   which lands in FUN_0042580c → ___apiJob_20 → api32.dll
 │   ECU writes coding. apiResult* reports JOB_STATUS.
 ├─ ───────────────────────────────────────────────
 ├─ check JOB_STATUS == OKAY
 ├─ coapiTraceFswPsw(...)                                → second snapshot, "after"
 ├─ coapiTraceAblauf("Exit:coapiCodeSgByFswPswList")     → ABLAUF.TRC
 └─ return
```

`CODIERDATEN_LESEN` (read path) is symmetric — the read happens between the entry/exit trace bracket and feeds the netto buffer that subsequent COAPI calls decode using `<BR>SGFAM.DAT` + `*.Cxx` CABD tables.

**Key takeaways for re-implementation:**

- A faithful ncsx doesn't need to write TRC/MAN files at all to function — they're observability output.
- If you want compatibility with operators who debug from TRC files: emit `ABLAUF.TRC` from the equivalent of `coapiTraceAblauf` (Entry/Exit lines at each public COAPI call), honour the COAPI.INI / PFL toggles, and you're done. Other TRC files only matter when their specific subsystem is enabled.
- The MAN file is even less critical — it's only meaningful if you implement the "edit FSW/PSW inline" GUI dialog.
- TRC/MAN never round-trip into the tool — they're output-only. There's no read path to worry about.

## 6. Putting it together

```
PFL profile               COAPI.INI [Trace]
   │                            │
   ├──"AswTrace=1"               ├──"GesamtTrace=ON"
   │                            │
   └────────┬──────────┬────────┘
            │OR
            ▼
   coapiTestTrace(subsys)──►  on    ─┐
                                     │ writes
   coapi*(...)──────────────────────►├──► WORK/<file>.TRC      (one per subsystem)
                                     │
   apiJob("SG_CODIEREN"|"CODIERDATEN_LESEN"|...)  ──► ECU
   apiResult*(...)                            ──► RAM netto buffer

   user edits FSW/PSW (profile flag FswPswManipulieren=1) ──► WORK/FSW_PSW.MAN
```

So to answer the original question directly: **`SG_CODIEREN` and `CODIERDATEN_LESEN` themselves don't touch TRC/MAN.** The IPO scripts that invoke them don't either. The trace/manipulation files are produced by NCSEXPER's COAPI layer wrapping the IPO/EDIABAS call — toggled per-profile via PFL and per-install via `CFGDAT/COAPI.INI`.

## 7. How a MAN file's contents reach the ECU

A common follow-up: "if I edited an FSW/PSW value and it ended up in `WORK/FSW_PSW.MAN`, how does that change actually get coded?"

**Short answer: the MAN file is never sent to the ECU.** It's a log/save-state. The actual write to the ECU goes through a separate CABD-encoding step on the **in-memory** FSW/PSW table and produces raw netto bytes, which are what `SG_CODIEREN` shipping over EDIABAS to the ECU.

The complete pipeline, with MAN's role highlighted:

```
┌─────────────────────────────────────────────────────────────┐
│ STAGE 1 — INITIAL FSW/PSW STATE                              │
│ coapiReadFswPsw(...) populates the per-SG in-memory table:   │
│   • [FSWPSW].FswPswLesenModus = 1 → synthesize from FA        │
│     (CABD ANLIEFERZUSTAND defaults + FA-driven mods)         │
│   • FswPswLesenModus = 2          → read netto from ECU      │
│     (CODIERDATEN_LESEN), decode it via CABD                  │
│   • [FSWPSW].FswPswLeseDatei = …  → restore from a saved file│
│     ▲ This is where a MAN file from a prior session can flow │
│       back in — set FswPswLeseDatei to a previous            │
│       WORK/FSW_PSW.MAN to re-apply the saved edits.          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ STAGE 2 — USER EDITS (manipulation dialog)                   │
│ Gated on [FSWPSW].FswPswManipulieren = 1.                    │
│ coapiChangePsw / coapiActivateFsw / coapiInactivateFsw       │
│ mutate the in-memory table for the current SG.                │
│ When the user confirms an edit, coapiTraceFswPsw (or the     │
│ manipulation handler directly) appends the new key/value to  │
│ FSW_PSW.MAN — an audit log of what was edited this session.   │
│   ▲ MAN is *output-only* here. It does not get re-read in    │
│     the same session.                                        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ STAGE 3 — ENCODE TO NETTO BYTES (the CABD pass)              │
│ coapiCodeSgByFswPswList(...) — runs the in-memory table      │
│ through the SG's CABD .Cxx file:                              │
│   For each (FSW, PSW):                                       │
│     • Find the matching PARZUWEISUNG_FSW row in the CABD     │
│     • Apply that row's WORTADR / BYTEADR / MASKE /           │
│       OPERATION list / EINHEIT to the netto-data buffer       │
│ Result: a contiguous byte buffer (the netto data) ready to   │
│ ship to the ECU.                                              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ STAGE 4 — WIRE TRANSFER (EDIABAS)                            │
│ The SG's IPO script (in SGDAT\<C_…>.ipo) is entered with     │
│ "SG_CODIEREN" as the entry point. Inside the IPO it:          │
│   • Authenticates (AUTHENTISIERUNG)                          │
│   • Disables normal data flow (NORMALER_DATENVERKEHR=NEIN)   │
│   • Calls apiJob("<SGBD>", "CODIERDATEN_SCHREIBEN",          │
│        "<netto-hex-from-stage-3>", "") — the wire write       │
│   • Re-enables data flow                                     │
│   • Optionally resets the SG                                 │
│   • Reports JOB_STATUS=OKAY through apiResult*               │
│ NCSEXPER's bridge (FUN_0042580c → ___apiJob_20)               │
│ forwards each apiJob to api32.dll on the diagnostic bus.     │
└─────────────────────────────────────────────────────────────┘
```

Three things to internalise:

1. **MAN ≠ wire payload.** The ECU only ever sees **netto coding bytes** via `CODIERDATEN_SCHREIBEN` (which the per-SG IPO usually invokes under the `SG_CODIEREN` umbrella). The FSW/PSW representation that MAN stores is a *symbolic* layer — it means nothing to the ECU.
2. **The translator is CABD, not MAN.** What turns "I want `KEYCARDREADER = 0x01`" into "byte at offset 0x04 gets ORed with 0x40" is the per-SG CABD `.Cxx` file, specifically the `PARZUWEISUNG_FSW` block (and `CODIERDATENBLOCK`, `SGID_HARDWARENUMMER`, etc.). `coapiRunCabd` / `coapiGetNettoDataFromCbd` are what evaluate it.
3. **MAN is also a portable save-state.** If you point `[FSWPSW].FswPswLeseDatei = <path-to-a-MAN-file>` in the next profile, NCSEXPER will load the previously-saved FSW/PSW edits straight into memory at stage 1, so they can flow through stages 3–4 in a brand-new session without having to redo the manual edits. This is the closest thing to "writing a MAN file back to the ECU".

Same logic applies to `WORK/ASW*.TRC` vs the ASW input flow, and `WORK/<NettoDaten>.TRC` vs `NettoDatenLeseDatei`: trace outputs and read-mode inputs share the same wire-level abstraction, so a recorded trace can be reused as a saved-state input.
