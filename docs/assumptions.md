# Working assumptions

Living list of the load-bearing architectural assumptions ncsx is built on. Every entry
here came out of disassembly or DATEN inspection — not docs or guesswork. When a new
observation contradicts one of these, update the entry here (and the doc it references)
rather than silently overwriting elsewhere.

Last verified: 2026-05-19.

---

## A1. NCSEXPER's main UI is MFC, not IPO-driven

- `NCSEXPER.EXE` is a Visual C++ MFC app. The `.exe` carries `CDialog`, `CFormView`,
  `CMFCStatusBar`, `CMFCMenuBar`, `CMFCPopupMenu`, `CMFCToolBar`, `CMFCRibbonBar`,
  `CMFCVisualManager*` etc. in its string table.
- The pre-ECU main screen, the chassis modal, the Choose-ECU modal, the post-ECU
  detail panel, the Process-car / Process-ECU pickers, the Change-Job dropdown, and the
  F-key bar are **all MFC dialogs / form views**. None are painted by IPO `setmenu`/
  `setscreen`.
- PFL `Fkt*` flags (e.g. `FktSgCodieren`, `FktKernfunktionen`, `FktCodierJobAendern`)
  toggle visibility of compiled MFC controls. They can hide buttons; they can't add
  controls. That's the proof the buttons exist in the EXE.

**Implication for ncsx**: our Svelte UI is the right shape. We don't need to run an IPO
interpreter just to draw screens. NCSEXPER doesn't either.

See: [`ipo-usage.md` §1 / "No entry-point IPO"](ipo-usage.md), [`NCSEXPER-REVERSE-ENG.md`](NCSEXPER-REVERSE-ENG.md).

---

## A2. NCSEXPER has no entry-point IPO

- `NCSEXPER/CFGDAT/` contains only `COAPI.INI`, `INPA.INI`, locale `.eng`/`.ger`
  strings, and `.TXT` files. No IPOs there.
- `strings NCSEXPER.EXE | grep -ci ipo` returns 2 — both are bare extensions
  (`.ipo` / `.IPO`), used as a suffix at runtime. No hardcoded IPO filename.
- The `..\cfgdat\start{ger,us}.ips` strings present in `NCSEXPER.EXE` refer to **INPA's**
  tooling (the IPS source compiles to IPO bytecode). They appear to be vestigial from
  when the IPO interpreter was lifted out of INPA; NCSEXPER's `WinMain` is MFC, not an
  IPO host.
- `NCSEXPER/SGDAT/startus.ipo` exists but is **byte-identical** to
  `EC-APPS/INPA/CFGDAT/startus.ipo` (verified by MD5). Its strings (`"BMW Group
  Rectification programs"`, `"< F1 >  Information"`, `"<Shift> + < F10>  Exit"`,
  `"..\CFGDAT\INPA.INI"`, `"Battery :"`) are INPA's main-screen labels — none of
  NCSEXPER's UI vocabulary appears in it. It's INPA's UI driver, shipped to a shared
  SGDAT directory.

**Implication for ncsx**: don't search for or implement a "main IPO" handler. There
isn't one. The startup boot order is `MFC WinMain → main dialog → user input`.

See: [`ipo-usage.md` §1 / "No entry-point IPO"](ipo-usage.md).

---

## A3. NCSEXPER uses IPO per-CABD, per-job, at "Execute job" time only

- 168 `A_*.ipo` files in `SGDAT/` — one per CABD module (e.g. `A_KMB46.ipo` for KMB on
  E46, `A_AKMB46.ipo` for AKMB). Each is a self-contained CABI-style dispatcher.
- The IPO's `cabimain` function is a switch on `JOBNAME`:
  ```
  if JOBNAME == "JOB_ERMITTELN"      → call Jobs       (emit job manifest)
  if JOBNAME == "INFO"               → call InfoJob
  if JOBNAME == "CODIERINDEX_LESEN"  → setjobstatus + call CILesen
  if JOBNAME in (SG_CODIEREN | TEILBEREICH_CODIEREN |
                 FGNR_SCHREIBEN | ZCS_SCHREIBEN | ZCS_LOESCHEN)
                                     → setjobstatus + call Cod(JOBNAME)
  if JOBNAME == "CODIERDATEN_LESEN"  → setjobstatus + call Lesen
  if JOBNAME == "FGNR_LESEN"         → setjobstatus + call FgnrLesen
  if JOBNAME == "ZCS_LESEN"          → setjobstatus + call ZcsLesen
  if JOBNAME == "NETTODATEN_SCHREIBEN" → setjobstatus + call NettoDat
  if JOBNAME == "SG_IDENT"           → setjobstatus + call Ident
  ```
- Each handler does more than wrap `apiJob`. `Lesen` (146 ops) writes the protocol
  report (`PEMProtokollAusgabe`), checks CDH error state (`TestCDHFehler`), drives a
  state machine (`setstate`, `setjobstatus`), and can `scriptchange` into another IPO
  (e.g. `"ID_COD_INDEX"` for coding-index lookup).
- The actual EDIABAS work happens through the **CDH\* bridge** — 101 functions
  statically linked into `NCSEXPER.EXE`. The IPO interpreter resolves `CDHapiJob`,
  `CDHGetCabdName`, etc. via NCSEXPER's built-in symbol table at opcode `0x0D CALLE`.

**Implication for ncsx**: when the user clicks Read/Write, NCSEXPER doesn't call
`apiJob(SG_CODIEREN)` directly — it runs `A_<cabd>.ipo::cabimain("SG_CODIEREN")` and lets
the IPO's `Cod` handler do the call (plus state-machine + protocol-report). For full
fidelity we need the inpax interpreter + a TypeScript CDH bindings layer.

See: [`ipo-usage.md` "The CABI-style A_*.ipo dispatcher"](ipo-usage.md),
[`cabi-binding-plan.md`](cabi-binding-plan.md).

---

## A4. Direct `apiJob` is byte-equivalent to the IPO handler — for now

- `wire.applyCodingPlan` calls `apiJob(SGBD, "SG_CODIEREN", hex)` directly, skipping
  the IPO. The bytes on the wire are identical to what `A_*.ipo::Cod` produces, because
  the IPO handler's terminal call is the same `apiJob` invocation through `CDHapiJob`.
- Skipped by the bypass: protocol-report writes (PEM\* — we don't need them; same
  reason we skip the TRC files), in-IPO UI feedback (`digitalout`, `infobox` — we have
  our own), error-recovery state machine, and `scriptchange` chains (e.g.
  `CODIERDATEN_LESEN` → `ID_COD_INDEX`).
- This is **fine for single-PSW edits** on a vanilla SG.
- This is **risky for special modes** — auth-retry sequences, `_OHNE_CI` /  `_OHNE_FG`
  variants that orchestrate multiple jobs, and SGs whose `Lesen` calls `scriptchange`
  for a coding-index lookup before the read.

**Implication for ncsx**: ship direct-apiJob now (current `packages/wire`). Plan inpax
interpreter integration for the moment we hit one of the special-mode failures, or
when we add a Process-Car flow that does multi-SG batch coding.

---

## A5. "Change Job" dropdown contents are per-IPO, not per-SGBD

- Each `A_*.ipo` has a `Jobs` function that emits its own job manifest via
  `PEMSGZ_Kopfzeile` ("JOB[1]=JOB_ERMITTELN, JOB[2]=INFO, JOB[3]=CODIERINDEX_LESEN, …").
- NCSEXPER's MFC "Change Job" modal is populated from that manifest, not from
  EDIABAS SGBD job-table reflection (which I originally guessed).
- So the available jobs are determined by **which IPO the chosen CABD points at**, not
  by what the `.prg` SGBD happens to implement. A SGBD may implement more jobs than the
  IPO exposes.

**Implication for ncsx**: if we expose a "Change Job" picker, we should source the
list from the IPO's `Jobs` function, not from `apiJobInfo` reflection.

---

## A6. FA vs ZCS support is per-SG (SGFAM flags), not per-chassis — and they're structurally different

- `<BR>SGFAM.DAT` has two flag columns per row: `ZCS` (col 5) and `FA` (col 6). Both
  are parsed into `SgfamRow.zcs` / `SgfamRow.fa` in `packages/text-tables`.
- A chassis can have both kinds simultaneously. E46 has AKMB (`fa=1`, `zcs=0`),
  ALSZ (`fa=1`, `zcs=0`), and EWS / KMB (`fa=0`, `zcs=1`).

**FA and ZCS are not interchangeable data — they're different shapes:**

- **FA** is a **single token string** the SG hands back verbatim, with sigil-prefixed
  tokens: `E46_#0306&N6SW%0354$167$1CA$205$210$226$249$251$30`. Sigils carry meaning
  (`_` = chassis prefix, `#` = standard option, `&` = N-prefix engine code, `%` = type
  series, `$` = SA code, `*` = something else). Editing FA = adding/removing tokens.
  NCS Expert's "Enter FA" dialog renders the token list with an `Attribute:` input +
  `Add` button and a separate `Chasis:` field pre-filled with the chassis prefix.

- **ZCS** is **three numeric fields** the SG reports separately: `GM` (base-model code,
  short string), `SA` (a hex-encoded bit-set indexed by `<BR>ZST.*`, multiple bytes), and
  `VN` (version-number short string). NCS Expert's "Enter ZCS" dialog renders them as
  three text inputs (GM / SA / VN) + a `Calculate checksum` checkbox. Editing the SA
  bit-set means toggling bits per ZST.

- **VIN** (FG) is a 17-character string, read via `FGNR_LESEN` regardless of FA-vs-ZCS
  era. NCS Expert's "Enter VIN" dialog is a single text field + `Calculate checksum`
  checkbox.

**Read paths**:
- `FA=1` SGs respond to `FA_LESEN` / `FA_STREAM_LESEN` and return the FA string.
- `ZCS=1` SGs respond to `ZCS_LESEN` and return raw ZCS bytes (the bit-set), plus
  separate `GM` / `VN` / `CODIERINDEX` fields if the SG splits them out.
- NCSEXPER bridges the two for the rest of the coding pipeline by **translating
  ZCS → synthetic FA** via the chassis's `<BR>ZCSUT.DAT` (ZCS-Umsetzungstabelle).
  Downstream (PARZUWEISUNG_FSW conditional rows, ASW evaluation, SGAUSWAHL predicates)
  operates on FA exclusively.

**Type model in ncsx** (`packages/identity` + `apps/web/src/lib/state.svelte.ts`):

```ts
interface VehicleIdentity {
  source: SgfamRow;
  vin?: string;
  fa?: string;                 // populated when source SG has FA=1
  zcs?: {
    netto: Uint8Array;         // raw SA bit-set bytes
    gm?: string;
    vn?: string;
    codingIndex?: number;
  };                           // populated when source SG has ZCS=1
  vinStatus?: string;
  faStatus?: string;
  zcsStatus?: string;
  error?: string;
}
```

**Implication for ncsx**:
- `findSgsByFlag(chassis.sgfam, 'fa' | 'zcs')` populates the identity-picker candidates.
- `readVin`, `readFa`, `readZcs` primitives ship in `packages/identity`. ZCS returns
  raw bytes; SA-bit decoding via ZST is a separate, pending package.
- For FA/ZCS/VIN **editors** (a roadmap feature — NCS Expert has dialogs for all
  three), the data model above is the right input shape. The FA editor is a token-list
  builder; the ZCS editor is three text fields plus an SA bit-toggle UI.
- ZCSUT parsing is a separate gap — `chassis.zcsut` is loaded as raw `DatenFile` but
  never decoded. Needed for `zcsToFa(zcsut, bytes) → string` so ZCS-era cars feed the
  rest of the pipeline.

See: [`ecu-selection.md` §3.3](ecu-selection.md), `packages/chassis/src/indexes.ts:53`
(`findSgsByFlag`), `packages/identity/src/zcs.ts` (`readZcs`).

---

## A7. SGAUSWAHL row holds the auto-discovered triple — file basename, IPO, SGBD

- After the user picks a chassis + ECU, NCSEXPER's metadata panel shows e.g.
  `KMB_E46.C08, A_AKMB46.IPO, KOMBI46R.PRG`.
- All three come from a single `SGAUSWAHL_*` row (in `<BR>SGET.000`):
  - `SGNAME` = `KMB_E46` (file basename for the `.Cxx` CABD module)
  - `CBD` = `C08` (coding-index suffix → `KMB_E46.C08`)
  - `CABD` = `A_AKMB46` (the CABD module name, and basename of the matching
    `A_AKMB46.IPO`)
  - `SGBD` = `KOMBI46R` (EDIABAS SGBD basename → `KOMBI46R.PRG`)
- `packages/ecu-select` already returns this on `SelectedSg` — we have the data, just
  don't surface it yet.

See: [`ecu-selection.md` §8](ecu-selection.md), `packages/ecu-select/src/index.ts`.

---

## A8. "Get coded" list = `selectEcus(chassis, asw)`

- NCSEXPER's post-Process-car screen shows e.g. `Get coded: ABG,MK60,LWS,ALSZ,GM5,IHK,
  PDC,RLS,AKMB,AEWS,RAD,SM`. This is the set of SGs that match the FA via SGAUSWAHL_*
  predicate evaluation.
- `packages/ecu-select::selectEcus(chassis, asw)` already walks
  `SGAUSWAHL_VMSGBD → SGAUSWAHL_SGBD → SGAUSWAHL_VM`, evaluates each row's
  `AUFTRAGSAUSDRUCK` predicate against the FA-derived ASW set, and returns the rows
  whose predicate is true. That's exactly NCS's logic.

See: [`ecu-selection.md` §3](ecu-selection.md), `packages/ecu-select/src/index.ts:49`.
