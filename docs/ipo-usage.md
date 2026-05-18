# NCSEXPER's use of INPA IPO files

Three questions, short answers first, then evidence.

## 1. When does NCSEXPER use IPO files?

| Path                                                  | Uses IPO? |
|-------------------------------------------------------|-----------|
| Coding (`SG_CODIEREN`, `CODIERDATEN_LESEN`, `CODIERDATEN_SCHREIBEN`) | **No.** COAPI/CDH builds the netto buffer and calls `api32.dll::apiJob` directly. |
| Kernfunktionen menu (`[CODING].FktKernfunktionen=1` / `[INDIVID].FktKernfunktionen=1`) | **Yes.** The selected Kernfunktion loads the matching `SGDAT/*.ipo` and runs it under NCSEXPER's embedded IPO interpreter. |
| `.ssd` / ZUT verifier | **No.** Different format — record-tag-driven (see [`ssd-zut-format.md`](ssd-zut-format.md)). |

NCSEXPER's `.text` segment carries a **full embedded IPO interpreter** (TEST-Infotext loader, the INPA system-function table, opcode dispatcher — confirmed by `__inpa_startup__`, `__inpa_shutdown__`, `INPA Bridge16 Window`, `INPA Return Window`, `INPA-PrintScreen_%05d` strings in `.rdata`). It runs the same `.ipo` files INPA itself runs (same `TEST-Infotext` header — see [`inpax/docs/ipo-file-structure.md`](../../inpax/docs/ipo-file-structure.md)), but **only for interactive diagnostics**. The coding pipeline never enters the interpreter.

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

- IPOs aren't on the **coding** hot path; COAPI calls `apiJob` directly.
- IPOs power the **Kernfunktionen** menu (diagnostic jobs and live data).
- Two styles of IPO live in `SGDAT/`: CABI-style (`cabimain`/`cabiexit`) for batch job dispatch, INPA-style (`inpainit`/`inpaexit`) for interactive screens.
- All IPOs use the same INPA UI syscalls (`setscreen`, `setmenu`, `userbox*`, gauges) plus EDIABAS bridge calls (`INPAapiJob`, `INPAapiResult*`) and the PEM print-output API.
- NCSEXPER **embeds the full INPA UI runtime** to make these syscalls work — confirmed by the linked-in window-class strings and the embedded interpreter's function table.
- The `CDH*` functions CABI-style scripts call are **statically linked into NCSEXPER.EXE itself** and reached via the IPO interpreter's built-in symbol table (opcode `0x0D CALLE`). The `Cabiger.dll` / `CabiUS.dll` files ship localised resource strings only — no CABI functions are exported from either.

For ncsx: when we get to "run a Kernfunktion" feature, we can reuse the `@emdzej/inpax` interpreter as-is. The system-function table we need to implement is the INPA one — same names, same signatures — plus the PEM print-output helpers (route to a log buffer instead of a print spool) and the CABI surface (see [`cabi-binding-plan.md`](cabi-binding-plan.md)).
