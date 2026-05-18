# User flow — replacing NCS Expert + NCS Dummy with ncsx

This doc describes the **end-user coding flow** ncsx aims to deliver: connect to the car, pick
a module, tick checkboxes, write back. It collapses the three-program juggle that the BMW
community has lived with (INPA → NCS Expert → text editor → NCS Expert again) into a single
web UI on top of the ncsx package stack.

Companion docs:
- [`ncsdummy-analysis.md`](ncsdummy-analysis.md) — what NCS Dummy does and which new packages
  we need to deliver parity (`packages/function-list`, `packages/trace`, `packages/options`).
- [`coding-flow.md`](coding-flow.md) — the internal encode/decode pipeline (FSW/PSW ↔ netto bytes).
- [`trc-man-files.md`](trc-man-files.md) — what TRC/MAN files are inside NCSEXPER.
- [`STATUS.md`](STATUS.md) — current implementation state and resume entry points.

Source for the legacy flow: *The Beginner's Guide to Coding With NCS Expert* (Rev. 2011.04.23),
local copy at `/Users/mjaskols/Downloads/Guide to BMW Coding (2011.04.23).pdf`.

---

## 1. The legacy flow (NCS Expert, every time)

Verbatim from the guide:

| # | Step | Tool | Pain point                                                  |
|---|------|------|-------------------------------------------------------------|
| 1 | Plug K+DCAN cable, ignition ON                  | hardware    |                                                  |
| 2 | Launch INPA, leave EDIABAS Server running       | INPA        | second program just to keep a daemon alive       |
| 3 | Create empty `C:\NCSEXPER\WORK\FSW_PSW.MAN`     | Explorer    | foot-gun if file is non-empty from a prior run   |
| 4 | NCS Expert → Load profile "Revtor's"            | NCS Expert  | needs an out-of-the-box profile (REVTOR.PFL)     |
| 5 | VIN/ZCS/FA → ZCS/FA f. ECU                      | NCS Expert  | reads VIN/FA from car                            |
| 6 | Process ECU → pick module                        | NCS Expert  |                                                  |
| 7 | **Job → change `SG_CODIEREN` → `CODIERDATEN_LESEN`** | NCS Expert | wrong job = write instead of read. "Could make your entire car explode." |
| 8 | Execute job → wait for "Coding ended"            | NCS Expert  | produces `FSW_PSW.TRC`                           |
| 9 | Open `FSW_PSW.TRC` in a text editor, edit values | Notepad     | no validation, no value hints, no FA awareness   |
| 10 | Save as `FSW_PSW.MAN`                            | Notepad     | wrong filename → nothing happens                 |
| 11 | **Job → change back to `SG_CODIEREN`**           | NCS Expert  | symmetric foot-gun                               |
| 12 | Execute job → bytes hit ECU                      | NCS Expert  | reads `FSW_PSW.MAN`                              |
| 13 | **Empty `FSW_PSW.MAN`** afterwards               | Explorer    | forget this and next session re-applies the same edits |

NCS Dummy fixes step 9 (replaces Notepad with a checkbox editor) but everything else stays.

---

## 2. The ncsx flow

One web app, one session:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ncsx web UI                                                         │
│                                                                      │
│  ① Connect ▾  E60 · WBA…1234 · FA: 205 245 318 …                    │
│                                                                      │
│  ② Modules (374)                Search/filter: ____________          │
│  ┌────────────────────────────┐                                      │
│  │ □ KMBI_E60.C06   instrument cluster      94.0%                    │
│  │ □ LSZ.C37        light switch            87.5%                    │
│  │ ☑ CAS_E60.C04    car-access system       (edited)                 │
│  │ □ …                                                                │
│  └────────────────────────────┘                                      │
│                                                                      │
│  ③ Editor — KMBI_E60.C06                                             │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ ▾ Steuerung_Anzeige_1 — Control display 1                      │ │
│  │   □ CSUM_ST_ANZEIGE_1   CHECKSUM CONTROL DISPLAY 1              │ │
│  │       □ grundcode_var   basic code variable                     │ │
│  │   ☑ GPS_UHR             USE TIME FROM GPS                       │ │
│  │       □ nicht_aktiv     not enabled        ⓘ inc compatible w/ FA│ │
│  │       ☑ aktiv           enabled            ✓ in FA              │ │
│  │   ☑ BC_DIGITAL_V        ON-BOARD COMPUTER (OBC) DIGITAL SPEED   │ │
│  │       □ nicht_aktiv                                              │ │
│  │       ☑ aktiv                                                    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ④ [ Apply to ECU ]  [ Export TRC ]  [ Export MAN ]  [ Import … ]    │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 What disappears from the legacy flow

| Removed                                           | How                                                    |
|---------------------------------------------------|--------------------------------------------------------|
| INPA + EDIABAS-Server running on the side         | ncsx talks to the cable directly via `@emdzej/ediabasx`|
| The "Job" dropdown footgun (`SG_CODIEREN` vs `CODIERDATEN_LESEN`) | Read and Write are explicit buttons, irreversible only when you press Apply |
| Pre-creating an empty `FSW_PSW.MAN`               | No MAN file exists by default; we encode in memory     |
| Loading "Revtor's profile"                        | We pick the right NCSEXPER profile flags ourselves     |
| Hand-editing text files                           | Web UI with checkboxes and FA-aware annotations        |
| Remembering to empty `FSW_PSW.MAN` afterwards     | Nothing persists between sessions unless you ask       |

### 2.2 What stays — for compatibility

- **`Export TRC` / `Export MAN`** writes files matching NCS Expert's format
  ([`ncsdummy-analysis.md` §2](ncsdummy-analysis.md)) so users can hand them to NCS Expert or
  share them on bimmerforums.
- **`Import …`** ingests `FSW_PSW.TRC`, `FSW_PSW.MAN`, `NETTODAT.TRC`, `NETTODAT.MAN` — both
  for "open a trace someone else made" and for "I already ran NCS Expert, take it from here".

---

## 3. Step-by-step: what each ncsx action does behind the scenes

### Read (= NCS Expert's `CODIERDATEN_LESEN`)

```
UI: user clicks "Open module KMBI_E60.C06"
  │
  ▼
packages/session.openModule(chassis, sg)
  │
  ├─► packages/wire.readNetto(sg)
  │     EDIABAS apiJob("KMBI_E60", "CODIERDATEN_LESEN", "", "")
  │     ↳ returns raw netto buffer
  │
  ├─► packages/function-list.load(chassis, sg)
  │     parses <SGBD>.C06 + <BR>ZST.000 → typed catalog
  │
  ├─► packages/options.load(chassis)
  │     parses CVT DATEN → (FSW,PSW) → FA-predicate index
  │
  └─► packages/trace.overlay(functionList, netto, fa, options)
        builds TraceOverlay — catalog with checked/unchecked,
        FA-applicable annotations, decoded property values
  │
  ▼
UI: render checkbox tree
```

### Edit (= NCS Expert's text-editing step)

Local-only mutation of the in-memory `TraceOverlay`:

```ts
overlay.toggle('GPS_UHR', 'aktiv')           // tick a PSW
overlay.setCustom('SPEEDLOCK_X_KMH_MIN_C0E', 0x08)  // set raw byte for properties
```

No network traffic, no file writes. UI shows a diff badge next to every changed FSW so the
user can see what they're about to apply.

### Write (= NCS Expert's `SG_CODIEREN`)

```
UI: user clicks "Apply to ECU"
  │
  ▼
packages/session.applyChanges(overlay)
  │
  ├─► packages/coder.planCoding({chassis, fa, edits: overlay.diff()})
  │     → CodingPlan with netto bytes per SG
  │
  └─► packages/wire.writeNetto(sg, netto)
        EDIABAS apiJob("KMBI_E60", "SG_CODIEREN", hex(netto), "")
        ↳ "Coding ended" or surfaced error
  │
  ▼
UI: success toast + optional re-read to confirm
```

No `FSW_PSW.MAN` ever touches disk unless the user clicks `Export MAN`.

### Export TRC / Export MAN

Walks the `TraceOverlay`, produces either format (text writers from
[`ncsdummy-analysis.md` §2](ncsdummy-analysis.md)). Filename and folder are user-chosen.

### Import TRC / MAN

Reverse — runs the readers from
[`ncsdummy-analysis.md` §3.2](ncsdummy-analysis.md), produces a `TraceOverlay`, jumps straight
into the editor. If the trace is a `NETTODAT.*` file it carries enough bytes to skip the
"Read" step entirely; an `FSW_PSW.*` file still needs the DATEN catalog to know how the named
FSWs/PSWs map to bytes.

---

## 4. Annotation, not filtering

NCS Dummy shows order options as a tooltip but doesn't gate the UI on FA. ncsx will be smarter:
**every PSW row gets a badge** showing whether the AUFTRAGSAUSDRUCK predicate matches the
current car's FA.

| Badge        | Meaning                                              |
|--------------|------------------------------------------------------|
| ✓ in FA      | predicate matches → safe to enable                   |
| ⚠ not in FA   | predicate doesn't match — usually means this feature would require an FA-change to function correctly. The user can still tick it; we just warn. |
| (no badge)   | no order-options data for this (FSW, PSW)            |

Reasoning: NCS Dummy users routinely tick "not-in-FA" options successfully because their FA
is out of date or because the predicate is over-strict. Hard-filtering would block legitimate
edits. Annotate-with-warning is the right default; we can add a "hide non-FA" toggle in the
filter bar for users who want it.

(See [`ncsdummy-analysis.md` §3.3](ncsdummy-analysis.md) for the data model — the predicate
bytes are already evaluated against the FA by `packages/predicate`.)

---

## 5. Architecture — pure-browser PWA (no daemon)

ncsx ships as a static SPA, same playbook as the sibling apps:

- [`@emdzej/ediabasx-web`](../../ediabasx/apps/web/README.md) — picks PRG/GRP files in the browser,
  drives the K+DCAN cable via **Web Serial** through `@emdzej/ediabasx-interface-serial`
  (`WebSerialTransport`).
- [`@emdzej/inpax-web`](../../inpax/apps/inpax-web/) — picks an INPA install root via
  `showDirectoryPicker`, persists the `FileSystemDirectoryHandle` in IndexedDB, drills
  case-insensitively for `EC-APPS/INPA/CFGDAT` etc.

ncsx mirrors both. The whole app is client-side:

```
┌──────────────────────────────────────────────────────────────┐
│  Browser tab (apps/ncsx-web)                                  │
│                                                                │
│  Svelte 5 (runes) + TypeScript + Vite + Tailwind + vite-pwa   │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ UI:  module list · function tree · FA badges · apply     │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ packages/session   ← top-level orchestrator              │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │ packages/wire     → @emdzej/ediabasx + WebSerialTransport│ │
│  │ packages/function-list, trace, options                   │ │
│  │ packages/coder, cabd, chassis, fa-asw, predicate, daten, │ │
│  │ text-tables, ecu-select, pfl                             │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  Browser APIs:                                                 │
│   - showDirectoryPicker()  → DATEN folder (FileSystemDirHandle)│
│   - IndexedDB              → persists the handle across reloads│
│   - OPFS                   → cached catalogs + draft overlays  │
│   - showSaveFilePicker()   → TRC/MAN exports                   │
│   - navigator.serial       → K+DCAN cable                      │
└──────────────────────────┬───────────────────────────────────┘
                           │  WebSerial → FTDI K+DCAN
                    ┌──────▼───────┐
                    │   Vehicle    │
                    └──────────────┘
```

No backend. No upload. No install. Visit the URL (or install as a PWA), grant permission to the
DATEN folder once, and the app comes back to that same folder on every subsequent visit.

### 5.1 Filesystem strategy

Three storage roles, three different APIs:

| Role                        | API                              | Lifetime              | Why this one              |
|-----------------------------|----------------------------------|-----------------------|---------------------------|
| **DATEN folder** (read-only) | `showDirectoryPicker()`          | persistent (handle in IndexedDB; permission re-prompted on reload via user gesture) | user-visible path, hundreds of MB — must not be copied into the browser  |
| **Parsed-catalog cache**    | OPFS (`navigator.storage.getDirectory()`) | persistent, sandboxed | keyed by `(chassis, sgFile, mtime)` — skip the DATEN re-parse on second visit |
| **Draft TraceOverlays**     | OPFS                             | persistent, sandboxed | survive accidental tab close before the user hits Apply |
| **TRC/MAN exports**         | `showSaveFilePicker()`           | one-shot              | user picks where to save                                |
| **TRC/MAN imports**         | `showOpenFilePicker()` (single) or `<input type=file>` | one-shot | small files; no need for a persistent handle            |

Pattern lifted directly from `inpax/apps/inpax-web/src/lib/install-storage.ts` and
`inpa-install.ts` (case-insensitive directory drill, `queryPermission`/`requestPermission`
dance on reload). The DATEN folder layout we walk for is:

```
<DATEN root>/
  <chassis>/                  (E46, E60, E90, F30, …)
    *.C00 .. *.C0F            CABD frame files
    *.M00, *.ZUS              text tables
    *AT.000                   FA-token table
    *ZST.000                  ZST function/parameter dictionary
    LADEN.BAT                 (ignored — Windows install script)
  SGDAT/                      (NCS Expert convention; optional for ncsx)
```

### 5.2 Browser support

Chromium derivatives only (Chrome, Edge, Opera, Brave). Firefox/Safari miss
`showDirectoryPicker`/OPFS-sync/Web Serial — show a "use a Chromium-based browser" banner like
inpax-web does (`isFileSystemAccessSupported()` check). Plain HTTP works on `localhost` for
dev; TLS required for any other host (Web Serial is secure-context-gated).

### 5.3 Deployment

Static SPA — `apps/ncsx-web/dist/` deploys to any static host. Reuse the ediabasx-web nginx
Dockerfile pattern (multi-stage, immutable cache headers on `/assets/*`, SPA fallback). PWA
manifest so the app is installable.

---

## 6. Build order (re-orders the analysis doc's phases for "first useful web app")

| Phase | What lands                                                                  | Demo unlock                                              |
|------:|-----------------------------------------------------------------------------|----------------------------------------------------------|
| 1     | `packages/function-list` (Phase A from analysis doc)                        | Module catalog parses from DATEN — pure logic, testable  |
| 2     | `packages/options` (Phase C)                                                | FSWs/PSWs carry FA-predicate metadata                    |
| 3     | `packages/trace` reader+writer (Phase B)                                    | Can open/save TRC/MAN as plain unit tests                |
| 4     | `apps/ncsx-web` skeleton (Svelte + Vite, picks DATEN folder, renders tree)  | Offline editor in the browser, no car needed             |
| 5     | OPFS catalog cache + draft-overlay persistence                              | Snappy reloads; drafts survive tab close                 |
| 6     | `packages/wire` (`@emdzej/ediabasx` + `WebSerialTransport`)                 | "Open module" reads real bytes from the ECU              |
| 7     | `Apply to ECU` button (calls `coder` + `wire.writeNetto`)                   | End-to-end coding                                        |
| 8     | TRC/MAN import/export wired to the file pickers                             | NCS Expert interop                                       |
| 9     | TUI client (`apps/ncsx-tui`?) reusing the same packages                     | Power-user surface (Phase F polish from analysis doc)    |

Phases 1–5 have **no car-in-the-loop dependency** — pure offline work, fast iteration.
Phases 6–8 need the cable. Phase 9 is optional.

---

## 7. Open questions to revisit before building

1. **Module-list source** — NCS Expert uses `Process ECU` + a dropdown driven by `SGAUSWAHL_*`
   walking. `packages/ecu-select` already does this. Recheck the FA-source choice (read from
   ECU vs typed by user) — see [`ecu-selection.md`](ecu-selection.md).
2. **Multi-SG batch apply** — NCS Expert codes one SG at a time. Do we expose "apply changes
   to N modules" as one button? `packages/coder.planCoding` already returns a `CodingPlan[]`,
   so this is mostly a UI affordance.
3. **Profile equivalent** — NCSEXPER's PFL profile controls things like FA-mode and individual-
   mode. We pick sensible defaults but might want a "session settings" panel for the same
   knobs (`Lesemodus`, ZCS vs FA source, etc.). [`pfl-format.md`](pfl-format.md) lists them.
4. **Pre-write backups** — before every `Apply to ECU`, auto-export the pre-edit
   `NETTODAT.TRC` to an OPFS-backed history folder (and offer `showSaveFilePicker` to dump
   it to disk). Cheap insurance against bricks.
5. **Daten install layout discovery** — what's the canonical NCSEXPER DATEN root? On Windows
   it's `C:\NCSEXPER\DATEN\`; users might also have `SGDAT/`, `ECU/`, `PFL/` siblings.
   Mirror `inpax-web`'s `discoverInpaInstall` pattern with a ncsx-specific drill.
