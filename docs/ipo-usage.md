# NCSEXPER's use of INPA IPO files

Three questions, short answers first, then evidence.

## 1. When does NCSEXPER use IPO files?

| Path                                                  | Uses IPO? |
|-------------------------------------------------------|-----------|
| **Coding & identity** (`SG_CODIEREN`, `CODIERDATEN_LESEN`, `CODIERDATEN_SCHREIBEN`, `FGNR_LESEN`, `FA_LESEN`, `ZCS_LESEN`, `SG_IDENT`, `CODIERINDEX_LESEN`, …) | **Yes.** Routed through the per-CABD `A_*.ipo` script (e.g. `A_KMB46.ipo`). `cabimain` switches on the job name and calls handler functions like `Cod`, `Lesen`, `FgnrLesen`, `ZcsLesen`, `Ident`, `CILesen`. The handlers issue EDIABAS work through the CDH* bridge into `api32.dll`. |
| Kernfunktionen menu (`[CODING].FktKernfunktionen=1` / `[INDIVID].FktKernfunktionen=1`) | **Yes.** The selected Kernfunktion loads the matching `SGDAT/*.ipo` and runs it under NCSEXPER's embedded IPO interpreter. |
| `.ssd` / ZUT verifier | **No.** Different format — record-tag-driven (see [`ssd-zut-format.md`](ssd-zut-format.md)). |

> **Doc history note.** An earlier version of this table claimed coding "doesn't use IPO — COAPI calls apiJob directly". That was wrong, and disassembly of `A_KMB46.ipo` (2026-05-19) corrects it. The misreading came from over-weighting one paragraph in the original ghidra notes; the actual evidence (the IPO's `cabimain` switch + `Cod`/`Lesen` handlers) is unambiguous.

NCSEXPER's `.text` segment carries a **full embedded IPO interpreter** (TEST-Infotext loader, the INPA system-function table, opcode dispatcher — confirmed by `__inpa_startup__`, `__inpa_shutdown__`, `INPA Bridge16 Window`, `INPA Return Window`, `INPA-PrintScreen_%05d` strings in `.rdata`). It runs the same `.ipo` files INPA itself runs (same `TEST-Infotext` header — see [`inpax/docs/ipo-file-structure.md`](../../inpax/docs/ipo-file-structure.md)). Both NCSEXPER's MFC main-screen coding flow **and** the Kernfunktionen menu pass through this interpreter.

### The CABI-style A_*.ipo dispatcher

The per-CABD-module script (e.g. `A_KMB46.ipo` for the KMB cluster on E46) is the workhorse. Inpax CLI disassembly confirms the shape — `cabimain` is a job-name switch:

```
local[0] := JOBNAME (passed by NCSEXPER's MFC UI)
if JOBNAME == "JOB_ERMITTELN"      → call Jobs        (emits the protocol-header job list)
if JOBNAME == "INFO"               → call InfoJob
if JOBNAME == "CODIERINDEX_LESEN"  → setjobstatus + call CILesen
if JOBNAME in (SG_CODIEREN | TEILBEREICH_CODIEREN | FGNR_SCHREIBEN | ZCS_SCHREIBEN | ZCS_LOESCHEN)
                                    → setjobstatus + call Cod(JOBNAME)
if JOBNAME == "CODIERDATEN_LESEN"  → setjobstatus + call Lesen
if JOBNAME == "FGNR_LESEN"         → setjobstatus + call FgnrLesen
if JOBNAME == "ZCS_LESEN"          → setjobstatus + call ZcsLesen
if JOBNAME == "NETTODATEN_SCHREIBEN" → setjobstatus + call NettoDat
if JOBNAME == "SG_IDENT"           → setjobstatus + call Ident
```

The handlers do more than just call `apiJob`. `Lesen` (146 ops) writes to the protocol report (`PEMProtokollAusgabe`), checks CDH error state (`TestCDHFehler`), updates UI (`digitalout`), drives a state machine (`setstate`, `setjobstatus`), and even `scriptchange`s into another IPO (e.g. `"ID_COD_INDEX"`) for coding-index resolution. The actual EDIABAS work goes through CDH* functions statically linked into NCSEXPER.EXE — see §4.

**The "Change Job" dropdown source.** The IPO's `Jobs` function emits the JOB[1]..JOB[N] strings into the PEM report (`PEMSGZ_Kopfzeile`). NCSEXPER's MFC UI reads that list to populate the "Change Job" modal. So the dropdown contents are per-CABD-module, sourced from the IPO itself — not from EDIABAS SGBD job-table reflection.

### No entry-point IPO

Unlike INPA.EXE, NCSEXPER.EXE has **no startup IPO**. Evidence:

- `NCSEXPER/CFGDAT/` contains only `COAPI.INI`, `INPA.INI`, locale `.eng`/`.ger` strings, and `.TXT` files. No `.ipo` files anywhere outside `SGDAT/`.
- `strings NCSEXPER.EXE | grep -c '\.ipo'` returns **2** — both are the bare extensions `.ipo` / `.IPO`, used to append to a basename constructed at runtime from SGAUSWAHL data.
- The `.exe` is dense in MFC class strings: `CDialog`, `CFormView`, `CMFCStatusBar`, `CMFCMenuBar`, `CMFCPopupMenu`, `CMFCToolBar`, `CMFCRibbonBar`, `CMFCVisualManager*`. The main UI is a full MFC application.

**INPA.EXE is the opposite shape.** Its CFGDAT contains `startus.ipo` / `startger.ipo` (locale variants) whose `inpainit` function paints the main menu via `setmenu`/`setscreen` syscalls. INPA's main UI is genuinely IPO-driven; NCSEXPER's isn't.

For NCSEXPER, IPOs are entered **only at job-execute time** — never at startup, never for the chassis/ECU/job pickers themselves. The flow is:

```
WinMain (MFC) → main dialog → user picks ECU + job → "Execute job" click
  ↓
NCSEXPER loads A_<cabd>.ipo from SGDAT (basename from the SGAUSWAHL row)
Embedded interpreter runs cabimain(JOBNAME)
  → switch on JOBNAME → calls handler (Lesen, Cod, FgnrLesen, ZcsLesen, Ident, …)
  → handler calls CDH* (statically linked into NCSEXPER.EXE)
  → CDH* calls api32.dll::apiJob → SGBD (.prg) → ECU
```

### What this means for ncsx

Our current `wire.applyCodingPlan` calls `apiJob(SGBD, "SG_CODIEREN", hex)` directly. The bytes on the wire are identical to what NCSEXPER's `A_*.ipo::Cod` handler produces, so the SG accepts both. What we lose by bypassing the IPO:

- Protocol-report writes (`PEM*`) — we don't need these; equivalent to the TRC files we already chose to skip.
- UI feedback inside the IPO (`digitalout`, `infobox`) — we have our own UI.
- Error-recovery state machine (`TestCDHFehler`, `TestApiFehler`) — minor; the EDIABAS `JOB_STATUS` is the same signal.
- Multi-step orchestration (`scriptchange` chains, e.g. CODIERDATEN_LESEN → ID_COD_INDEX) — **this can matter** for SGs that gate reads on auth/CI lookups.

For full NCS-faithful behaviour we need to **run the IPO via the inpax interpreter** plus a CABI binding layer that resolves CDH* into ncsx packages. See `cabi-binding-plan.md` (planned) for the per-function mapping. Until then, direct `apiJob` is good enough for single-PSW edits but will hit limits on more complex coding modes.

### Two IPO flavours in `SGDAT/`

Disassembling shipped IPOs shows two distinct styles:

| Style | Entry points | Purpose | Typical syscalls |
|-------|--------------|---------|------------------|
| **A — CABI-style** (e.g. `00EK9272.ipo`) | `cabimain`, `cabiexit` | Per-SG diag-job dispatcher. The `Jobs` function in the IPO switches by job name and calls `INPAapiJob(SGBD, JOB, params)`. Used by INPA's job-runner menu and by NCSEXPER's Kernfunktionen / Job-Liste features. | `INPAapiJob`, `PEMSGZ_*`, `setjobstatus`, `OutputDebugString`, plus `CDH*` calls into the CABI DLL (see §4 below). |
| **B — INPA-style** (e.g. `ews.ipo`) | `inpainit`, `inpaexit` | Full interactive diagnostic. Live-data screens, menu navigation, fault-memory views. Used by NCSEXPER's Kernfunktionen flow when the script is interactive (rather than batch-job). | `setscreen`, `setmenu`, `userbox*`, `ftextout`, `digitalout`, `analogout`, `INPAapiResult*` |

**"CABI-style" labels a calling convention**, not an `cabi.ipo` shared library. The script's
entry points (`cabimain`/`cabiexit`) and its calls to `CDH*` / `apiJob` functions are
resolved through the **external-DLL bridge** described in §4 — they do not import from
another `.ipo` file. There is no IPO-to-IPO import mechanism; cross-script transfer only
happens via `scriptchange` / `scriptselect` (whole-script replace).

### Inventory — what's actually in `SGDAT/`

`NCSEXPER/SGDAT/` ships **1,798 `.ipo` files** (counted on a current install). The same
directory is shared verbatim with INPA (`INPA/SGDAT/` is the same set, often a symlink
or sync target — file counts match exactly). The IPOs split into four naming buckets,
roughly:

| Pattern         | Count | Style       | What it is                                                |
|-----------------|------:|-------------|-----------------------------------------------------------|
| `A_*.ipo`       |   168 | CABI-style  | Per-CABD-module batch dispatchers (e.g. `A_KMB46.ipo`).   |
| `D_*.ipo`       |   240 | INPA-style  | Per-diagnose-group interactive scripts (`D_KFS.ipo`, …).  |
| Digit-prefix    |   713 | CABI-style  | Part-number / EK-job-keyed batch scripts (`00EK9272.ipo`, `001MVD1722.ipo`, `00MDS410.ipo`). |
| Functional name | 1,081 | INPA-style  | Subsystem diagnostics named by what they do (`abs_uc.ipo`, `airbag.ipo`, `acc.ipo`, `afs_read.ipo`). |

**Zero `C_*.ipo` files.** This trips people up: `C_KMB46` is an SGBD basename, but
SGBDs are compiled BEST/2 bytecode and live in `EDIABAS/Ecu/` as `.prg` files. They are
read by `api32.dll`'s interpreter, not by NCSEXPER's IPO interpreter. The two interpreters
share zero code and run on different bytecodes; the name overlap is purely
chassis-vocabulary coincidence.

**None of these 1,798 files drive the main NCSEXPER screens.** They're all behind the
**Basic-Functions** (Kernfunktionen) button — when the user clicks one, NCSEXPER's
embedded IPO interpreter loads the matching file, opens an "INPA Bridge16 Window" child
window, and runs the script inside it (see §3). The main coding flow
(`SG_CODIEREN` / `CODIERDATEN_LESEN`) never touches any of them.

## 2. Syscalls the IPOs make

Aggregated from disassembling five sample SGDAT IPOs (top 30, in order of frequency):

| # of calls | syscall | category |
|-----------:|---------|----------|
| 236 | `PEMSGZ_Kopfzeile`       | PEM (report header line) |
| 179 | `multianalogout`         | UI — multi-gauge |
| 171 | `exitwindows`            | flow |
| 160 | `scriptchange`           | flow — load another IPO |
|  90 | `ftextclear`             | UI — clear formatted text |
|  84 | `PEMInitialisiere`       | PEM (start report) |
|  80 | `select`                 | UI — choose item |
|  58 | `userboxopen`            | UI — open text panel |
|  55 | `userboxftextout`        | UI — write to userbox |
|  53 | `PEMProtokollAusgabe`    | PEM (emit protocol line) |
|  50 | `PEMTrennLinie`          | PEM (divider line) |
|  48 | `setjobstatus`           | flow — EDIABAS job status |
|  39 | `digitalout`             | UI — digital gauge |
|  34 | `winhelpkey`             | UI — F1 help binding |
|  30 | `scriptselect`           | flow — chooser |
|  28 | `setscreen`              | **INPA UI — screen** |
|  21 | `setmenutitle`           | **INPA UI — menu title** |
|  20 | `infobox`                | UI — popup |
|  20 | `analogout`              | UI — single gauge |
|  19 | `userboxclose`           | UI |
|  18 | `setitem`                | UI |
|  16 | `returnstatemachine`     | flow |
|  15 | `setstate`               | flow |
|  13 | `userboxclear`           | UI |
|  13 | `setcolor`               | UI |
|  12 | `setmenu`                | **INPA UI — menu** |
|  10 | `callstatemachine`       | flow |
|   6 | `hexdump`                | format |
|   5 | `stop` / `viewclose` / `INPAapiJob` | flow / UI / EDIABAS |

Other syscalls observed at lower frequency (in the `ews.ipo` sample alone — an interactive INPA script):
`INPAapiResultText` (50), `INPAapiResultDigital` (29), `ftextout` (297), `viewopen` (2), `printfile`, `printscreen`, `messagebox`, `start`, `INPAapiInit`, `INPAapiFsLesen`, `INPAapiFsMode`, `INPAapiCheckJobStatus`, `INPAapiResultInt`, `inputhex`, `inttostring`, `inttohexstring`, `realtostring`, `stringtoreal`, `strlen`, `midstr`, `settitle`, `deselect`.

### Grouped by purpose

| Group | Syscalls |
|-------|----------|
| **EDIABAS bridge** | `INPAapiInit`, `INPAapiJob`, `INPAapiCheckJobStatus`, `INPAapiResultInt/Text/Digital/Analog/Binary/Sets/Format/Number`, `INPAapiFsLesen`, `INPAapiFsMode` |
| **Print Element Manager (PEM)** — writes to the Protokoll report | `PEMInitialisiere`, `PEMSGZ_Kopfzeile`, `PEMProtokollAusgabe`, `PEMTrennLinie` |
| **INPA UI — screens / menus** | `setscreen`, `setmenu`, `setmenutitle`, `settitle`, `select`, `deselect`, `setitem`, `setcolor`, `ftextout`, `ftextclear`, `infobox`, `messagebox`, `viewopen`, `viewclose`, `printscreen` |
| **INPA UI — userbox widgets** | `userboxopen`, `userboxclose`, `userboxclear`, `userboxftextout` |
| **Visualisation** | `analogout`, `multianalogout`, `digitalout` |
| **Flow / state** | `callstatemachine`, `returnstatemachine`, `setstate`, `scriptchange`, `scriptselect`, `exit`, `exitwindows`, `stop`, `start`, `setjobstatus`, `winhelpkey` |
| **Formatting helpers** | `hexdump`, `hexstring`, `inttostring`, `inttohexstring`, `realtostring`, `stringtoreal`, `midstr`, `strlen`, `inputhex`, `input2int`, `printfile` |
| **Debug** | `OutputDebugString`, `OutputDebugInt`, `OutputDebugBool` |

## 3. Does NCSEXPER use UI primitives from INPA?

**Yes — every IPO it runs does.** Both styles call INPA's screen/menu/userbox primitives. NCSEXPER **must implement** them all in its embedded interpreter — Ghidra confirms by listing the same names in `.rdata`:

- `setmenu`, `setmenutitle`, `setscreen` — `0x0048dd44`, `0x0048f034`
- `INPA Bridge16 Window` — `0x0048f0ec`
- `INPA Return Window` — `0x0048f140`
- `INPA-PrintScreen_%05d` — `0x0048fda0`

So NCSEXPER **hosts a full INPA UI runtime** alongside its main MFC dialog. When an IPO calls `setscreen` or `userboxopen`, NCSEXPER opens an INPA-style child window (the "INPA Bridge16 Window" / "INPA Return Window") and routes the output there. The "Protokoll" pane in the MFC dialog displays the PEM output.

The split:
- **NCSEXPER's own UI** (MFC) — profile/chassis/FA/ZCS entry, ECU picker, Kernfunktionen launcher, coding status bar. Built in C++ MFC.
- **INPA-style UI** (hosted) — anything an IPO renders via `setscreen`/`setmenu`/`userbox*`. The same widget primitives `inpa.exe` uses, re-implemented inside NCSEXPER.
- **Protokoll report** — assembled by `PEM*` syscalls inside IPOs; displayed by NCSEXPER's report window. Printable via `printfile`/`printscreen`.

## 4. The CABI bridge — how IPOs reach `CDH*` functions

CABI-style IPO scripts call functions like `CDHGetCabdName`, `CDHapiJob`,
`CDHGetFswPswDataFromCbd`, etc. These functions are **not** in another `.ipo`, and —
despite the misleading opcode name — they are not in a separate DLL either. They are
implemented **directly inside NCSEXPER.EXE itself**.

### The DLLs are localisation-only

| File                                | What it actually is                                          |
|-------------------------------------|--------------------------------------------------------------|
| `NCSEXPER/BIN/Cabiger.dll` (58 KB)  | Localisation resource DLL — German UI/error strings          |
| `NCSEXPER/BIN/CabiUS.dll` (55 KB)   | Localisation resource DLL — US English strings               |
| `NCSEXPER/SGDAT/CABI.H` (391 lines) | C-header with 97 `extern` declarations, fed to the IPO compiler |

Confirmed empirically:

- **Both DLLs have a single PE export: `entry` (the stock Visual C++ `DllMain` CRT
  wrapper).** No `CDH*`, `api*`, or `cabi*` symbols are exported.
- The `.text` segment is ~11 KB of pure Microsoft Visual C++ runtime helpers
  (`_strncpy`, `_amsg_exit`, etc.). No CABI strings appear in `.text`.
- The bulk of each file (`.rsrc`, ~28 KB) is a Windows resource section — localized
  string tables that NCSEXPER reads with `LoadStringA(hCabiDll, id, …)` to render
  German vs English UI text.

The DLLs serve the same purpose as a `.po` / `.mo` translation bundle on Linux: load
one or the other at startup to swap the language.

### The actual implementations live in NCSEXPER.EXE

The CDH function bodies are statically linked into the main executable. Ghidra's trace
strings at `0x005af*` (e.g. `CDHGetCabdName` at `0x005afbc4`,
`CDHGetCodierBaureihe` at `0x005afc60` — see
[`ecu-selection.md` §8.5](ecu-selection.md)) point at the implementations in
NCSEXPER.EXE's `.text`:

- `FUN_00432500` — body of `CDHGetCabdName` (trivial getter returning `DAT_0061a6d4`)
- `FUN_00427610` — body of `coapiReadCbdFromBr`
- `FUN_00434060` — body of `coapiGetAllSgetData`
- …

### Mechanism

```
IPO bytecode   ───CALLE 0x0D, const_idx──>   "CDHGetCabdName" (const-pool string)
                                              │
                                              ▼
                            NCSEXPER's embedded IPO interpreter
                            looks the string up in its
                            built-in symbol table (in .data)
                                              │
                                              ▼
                            FUN_00432500 in NCSEXPER.EXE's .text
```

The opcode is named "Call external DLL" for historical reasons: INPA's earlier 16-bit
design (whose `INPA Bridge16 Window` window class still appears in NCSEXPER's
`.rdata`) did resolve these names against real DLL exports. The 32-bit ports linked
the implementations into the host executable instead but kept the opcode name.

The IPO compiler reads `CABI.H` to typecheck the calls (in/out parameter directions and
types) and emits `0x0D CALLE` instructions with the function name in the IPO's constant
pool. At runtime the embedded interpreter resolves the name against NCSEXPER.EXE's
internal symbol table and marshals arguments per the header's signature.

Inpax's [`interpreter-analysis.md` §0x0D](../../inpax/docs/interpreter-analysis.md)
documents the same opcode for INPA.EXE — same model: a built-in symbol table inside the
host executable.

### What this means for ncsx (Phase 9)

When we add the Kernfunktionen runner, we'll need a CABI binding package that registers
all 97 CABI functions with the inpax interpreter's system-function table, routing each
to the appropriate ncsx package. The contract (signatures, parameter directions) comes
from `CABI.H`; we don't need to reverse-engineer NCSEXPER's binary implementations
unless behaviour is ambiguous from the header alone. Detailed plan + per-function
package mapping in [`cabi-binding-plan.md`](cabi-binding-plan.md).

## TL;DR

- IPOs **are** the coding hot path. The per-CABD `A_*.ipo` (e.g. `A_KMB46.ipo`) is loaded by NCSEXPER's embedded interpreter and its `cabimain` switch dispatches every coding/identity job (`Cod`, `Lesen`, `FgnrLesen`, `ZcsLesen`, `NettoDat`, `Ident`, `CILesen`, `InfoJob`) to a handler that calls the CDH* bridge → `apiJob`.
- The **"Change Job" dropdown contents come from the IPO**'s `Jobs` function, not from SGBD job-table reflection.
- IPOs also power the **Kernfunktionen** menu (diagnostic jobs and live data) — same interpreter, different IPO files (functional-named, not `A_*`).
- `SGDAT/` holds **1,798 IPOs** in four buckets (`A_*` / `D_*` / digit-prefix / functional name) — zero `C_*.ipo` files because SGBDs live in `EDIABAS/Ecu/` as `.prg`.
- Two styles of IPO live in `SGDAT/`: CABI-style (`cabimain`/`cabiexit`) for batch job dispatch, INPA-style (`inpainit`/`inpaexit`) for interactive screens.
- All IPOs use the same INPA UI syscalls (`setscreen`, `setmenu`, `userbox*`, gauges) plus EDIABAS bridge calls (`INPAapiJob`, `INPAapiResult*`) and the PEM print-output API.
- NCSEXPER **embeds the full INPA UI runtime** to make these syscalls work — confirmed by the linked-in window-class strings and the embedded interpreter's function table.
- The `CDH*` functions CABI-style scripts call are **statically linked into NCSEXPER.EXE itself** and reached via the IPO interpreter's built-in symbol table (opcode `0x0D CALLE`). The `Cabiger.dll` / `CabiUS.dll` files ship localised resource strings only — no CABI functions are exported from either.

For ncsx: when we get to "run a Kernfunktion" feature, we can reuse the `@emdzej/inpax` interpreter as-is. The system-function table we need to implement is the INPA one — same names, same signatures — plus the PEM print-output helpers (route to a log buffer instead of a print spool) and the CABI surface (see [`cabi-binding-plan.md`](cabi-binding-plan.md)).
