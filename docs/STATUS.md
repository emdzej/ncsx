# ncsx — current state & resume-from-here

Last updated: 2026-05-22.

> **Architectural assumptions** ncsx is built on: [`assumptions.md`](assumptions.md).
> Read that first if you're new — covers IPO scope, FA/ZCS handling, SGAUSWAHL resolution.
>
> **The full NCS Expert ↔ IPO ↔ CABI ↔ EDIABAS call architecture** (it's wild):
> [`call-architecture.md`](call-architecture.md). Required reading before touching
> `packages/inpax-cabi-provider` or `apps/web/src/lib/runtime.svelte.ts`.
>
> **NCSEXPER syscall table** (for upstream pluggable inpax `SystemFunctionMap`):
> [`ncsexper-syscall-table.md`](ncsexper-syscall-table.md) — staged inventory +
> ghidra verification recipe + the canonical machine-readable map at
> `packages/inpax-cabi-provider/src/ncsexper-syscalls.ts`.

## TL;DR

`ncsx` is a working browser app. Read coding, edit FSW/PSW, write back over Web Serial or a
remote gateway — end-to-end verified on E46 KMB (read+write), AKMB (read), GM5 (read+write).
FA/ZCS edit dialogs are wired but not yet exercised on hardware.

Live at **[ncsx.bimmerz.app](https://ncsx.bimmerz.app)**.

## What works end-to-end on real hardware

| Flow | Status |
|---|---|
| Pick BMW Standard Tools install, browse chassis catalog | ✔ |
| Read VIN + FA / ZCS from the identity SG | ✔ |
| FA-derived ECU filter (which SGs the car actually has) | ✔ |
| Decode FA tokens (German + English via NCSDummy CSV) | ✔ |
| Decode ZCS SA bit-set via `<BR>ZST.*` | ✔ |
| Auto-pick `.Cxx` variant via `CODIERINDEX_LESEN` | ✔ |
| Manual `.Cxx` browse | ✔ |
| `CODIERDATEN_LESEN` through the per-CABD IPO | ✔ |
| Edit PSWs in the UI, see byte-level diff | ✔ |
| `SG_CODIEREN` through the per-CABD IPO | ✔ on KMB / GM5 |
| Generic "Other jobs" runner via `JOB_ERMITTELN` | ✔ |
| Apply Defaults via `SG_CODIEREN` with `ANLIEFERZUSTAND` | ✔ on CABDs with full default netto; gated otherwise |
| Export `FSW_PSW.TRC` / `FSW_PSW.MAN` / `NETTODAT.TRC` | ✔ (NETTODAT.TRC format matches NCSEXPER `coapiTraceNettoData`) |
| Import `FSW_PSW.MAN` to stage edits | ✔ |

## What's wired but not hardware-verified

| Flow | Status |
|---|---|
| **FA edit dialog → `FA_WRITE`** | code path complete (`FA_STREAM` cabd-par seeded in `runCabimain`); not yet tested on bench |
| **ZCS edit dialog → `ZCS_SCHREIBEN`** | code path complete (`GM/SA/VN_SCHLUESSEL` cabd-pars seeded); not yet tested on bench |

Both dialogs use optimistic host-state update + revert on failure. **Missing: verify
readback after write** (`processWriteCoding` already does this for `SG_CODIEREN`; FA/ZCS
dialogs trust `JOB_STATUS=OKAY`).

## What's not done

| Open item | Where |
|---|---|
| Verify readback after FA_WRITE / ZCS_SCHREIBEN | `apps/web/src/components/{Fa,Zcs}EditorDialog.svelte` |
| ZCS_LOESCHEN-before-SG_CODIEREN on ZCS-master chassis re-code | `apps/web/src/lib/process-ecu.ts:processWriteCoding` |
| Post-write `C_CHECKSUM` verify for `SG_CODIEREN` (`FUN_00406060`) | `process-ecu.ts:processWriteCoding` |
| Per-FSW default-PSW derivation → real "Apply Defaults" for CABDs without `ANLIEFERZUSTAND` | `apps/web` + maybe `packages/function-list` |
| Authentication (`CDHCallAuthenticate` / `CDHAuthGetRandom`) | `packages/inpax-cabi-provider/src/provider.ts` — stubs; requires BMW seed/key tables we don't ship |
| OPFS-backed cache for parsed CABD bundles | future Phase 5 (web app) |
| `TraceOverlay` persistence | future Phase 5 (web app) |
| Kernfunktionen runner (interactive IPOs — abs_uc.ipo etc.) | future; reuse `@emdzej/inpax`'s UI providers, see [`ipo-usage.md`](ipo-usage.md) |
| Custom FSW/PSW parameters (NCS Dummy's "Add Parameter" equivalent) — let users register custom PSW values under existing FSWs and ship them as patches | future; see [`custom-fsw-psw.md`](custom-fsw-psw.md) — sidecar overlay model recommended over NCS Dummy's in-place DATEN mutation |

## Architecture

Three layers, each its own repo:

```
ncsx       (this repo)   — NCS Expert: coding flow, FA, chassis catalog
inpax                    — INPA: IPO bytecode interpreter, screen/menu UI
ediabasx                 — EDIABAS: BEST/2 SGBD interpreter, wire transports
```

The web app routes every write through the per-CABD `A_*.ipo` — same path NCS Expert uses,
so per-CABD auth gates, multi-step write protocols, and checksum recalculation are honoured.
Direct `apiJob` calls would skip those and break on a non-trivial subset of CABDs.

Per-dispatch seeding mirrors NCSEXPER's `FUN_00402c70`:

| Job | Seeded cabd-pars | Source |
|---|---|---|
| any | `APPLIKATION` | `app.chassis.code` |
| `FGNR_SCHREIBEN` | `FAHRGESTELL_NR` (with BMW Mod-36 check char) | `app.identity.vin` |
| `ZCS_SCHREIBEN` | `GM_SCHLUESSEL`, `SA_SCHLUESSEL`, `VN_SCHLUESSEL` | `app.identity.zcs` |
| `FA_WRITE` | `FA_STREAM` | `app.identity.fa` |

For `SG_CODIEREN`, `FAHRGESTELL_NR` is seeded via `CDHSetSystemData` (different IPC channel —
the IPO threads it into the post-write `C_FG_AUFTRAG` job's `para`).

The cabd-par store is **per-dispatch** (cleared at the start of every job, matching NCSEXPER
`FUN_0044b880`). Long-lived host state lives in `app.identity` / `app.chassis`.

## Packages

```
ncsx/
├── apps/
│   └── web/                            browser SPA (Svelte 5 + Vite)
└── packages/
    ├── cabd/                           netto ↔ FSW/PSW encode/decode
    ├── chassis/                        bundle loader + lazy CABD + SWT lookups
    ├── coder/                          legacy planCoding() orchestrator
    ├── daten/                          binary frame parser
    ├── ecu-select/                     SGAUSWAHL_* walker + AUFTRAGSAUSDRUCK eval
    ├── fa-asw/                         FA token string → ASW bit set
    ├── function-list/                  build typed FunctionList from a CABD
    ├── identity/                       read VIN/FA/ZCS + Mod-36 fgnr formatter
    ├── inpax-cabi-provider/            CABI/CDH bridge for the inpax IPO interpreter
    ├── options/                        NCSDummy-style coding-option overlay
    ├── pfl/                            PFL profile INI parser
    ├── predicate/                      byte-coded AUFTRAGSAUSDRUCK predicate compiler/runner
    ├── property-formulas/              inverse formulas for property-style FSWs
    ├── text-tables/                    ZST / AT / SGFAM / AT.M00 / AT.ZUS parsers
    ├── trace/                          TraceOverlay — staged-edit tracker
    ├── translations/                   NCSDummy CSV loader (community keyword → English)
    └── wire/                           shared EdiabasLike type contracts
```

`pnpm install && pnpm run ci` — build + lint + typecheck + test, all green.

## Reverse-engineering status

All major RE items closed. Remaining open items are small or deferrable:

| Item | Status |
|---|---|
| AUFTRAGSAUSDRUCK predicate grammar | ✔ full decoder (`packages/predicate`) |
| CABD `A` (OPERATION) ops + EINHEIT | ✔ 9-operator + 5-unit set decoded |
| DATEN-frame CRC formula | ✔ XOR-fold, verified |
| UMRSG column semantics | ✔ Umrechnungs-SG, `sprintf("V%s%s.%s", UMRSG, VMG, CABD)` |
| `.ssd` / ZUT record format | ✔ record-tag-driven, handler family documented |
| ZCSUT update flow (`coapiChangeZcsVm`) | ✔ entry surface mapped |
| FA → ASW / predicate-ID parity | ✔ via SWTASW |
| IPO usage in NCS | ✔ [`ipo-usage.md`](ipo-usage.md) |
| NCSEXPER `coapiSetCabdPar` per-dispatch model | ✔ verified via `FUN_00402c70` + `FUN_0044b880` |
| BMW Mod-36 checksum for `FAHRGESTELL_NR` | ✔ ported from `coapiSetFgNr` |
| NCSEXPER NETTODAT.TRC format | ✔ ported from `coapiTraceNettoData` (`FUN_004248f0`) |
| NCSEXPER FA_WRITE / FA_READ flow | ✔ `coapiWriteAuftrag` (`FUN_0042f9c0`) + `coapiReadAuftrag` (`FUN_0042f800`) |
| `ProfilPruefsumme` editor write-path | ☐ deferred (not on load/save round-trip) |
| Lesemodus enum value names | ☐ deferred (ranges known; symbolic mapping unconfirmed) |
| `.ssd` MASKE / UMRECHNUNG value syntax | ☐ deferred — needs a real `.ssd` sample |
| ZCSUT inner walk (`FUN_0043e4f0` / `FUN_0043cea0`) | ☐ deferred |
| `FUN_0042bad0` — NCSEXPER's SG_CODIEREN orchestrator | ☐ partially traced; checksum verify (`FUN_00406060`) untraced |

## Resume entry points

In priority order:

### 1. First-light test: FA and ZCS write

Read FA on the bench ECU → open "edit FA" → small no-op edit (add an existing token,
confirm dedupe, then remove + re-add) → write → re-read FA → diff.

Same for ZCS — read → no change → write SA back unchanged → re-read → byte-compare.

If either fails, the console traces (`[CDHapiJob]`, `[CDHSetCabdPar]`, `[CDHGetApiJobData]`,
`[CDHapiResultText]`) show the full round-trip — diff against an NCSEXPER `ABLAUF.TRC` if
needed.

### 2. Verify readback after FA_WRITE / ZCS_SCHREIBEN

In `FaEditorDialog.svelte` and `ZcsEditorDialog.svelte`, after `runCabimain` returns
`JOB_STATUS=OKAY`, dispatch `FA_READ` / `ZCS_LESEN` against the same SG, drain the result,
update `app.identity` with the readback value. ~20 lines per dialog. Same pattern
`processWriteCoding` uses for `SG_CODIEREN`.

### 3. SG_CODIEREN post-write checksum verify

NCSEXPER's `FUN_0042bad0` runs `C_CHECKSUM` after `SG_CODIEREN` (we already commented this
in `process-ecu.ts:processWriteCoding`). Trace `FUN_00406060` and `FUN_0042bad0` to
understand the checksum job's params, then wire it into `processWriteCoding`'s reread step.

### 4. ZCS_LOESCHEN-before-SG_CODIEREN on ZCS-master chassis

NCSEXPER's `FUN_004030e0` dispatches `ZCS_LOESCHEN` before `SG_CODIEREN` when the chassis
flag at `local_188 + 0x2a8c` is set (ZCS-master path). Mirror this in `processWriteCoding`
so re-coding a ZCS-master ECU under a different FA works.

### 5. Per-FSW default-PSW derivation for "Apply Defaults"

Currently gated to CABDs with a complete `ANLIEFERZUSTAND`. For CABDs without one,
synthesize the default netto by picking each FSW's "default PSW" (probably first listed in
`PARZUWEISUNG_PSW1`, or a convention we'd need to confirm against a CABD with both
mechanisms). Splice into the read-back netto. Then the button becomes universal.

### 6. OPFS-backed cache + TraceOverlay persistence (web app Phase 5)

Cache parsed CABD bundles in OPFS so the second visit to a module doesn't re-parse. Draft
`TraceOverlay` to local persistence so a tab close doesn't lose staged edits.

### 7. Kernfunktionen runner

Wire the non-`A_*` IPOs (`abs_uc.ipo`, `ews.ipo`, …) — those are fully interactive
(setscreen / setmenu / userbox*). Needs real UI providers; reuse `@emdzej/inpax`'s
`WebUIProvider`. See [`ipo-usage.md`](ipo-usage.md).

## Reference projects

- [`@emdzej/ediabasx`](../../ediabasx/) — EDIABAS / api32 / BEST-VM port (Web Serial + gateway).
- [`@emdzej/inpax`](../../inpax/) — INPA / IPO bytecode interpreter with UI providers.
- [`@emdzej/bimmerz`](https://github.com/mjaskolski/bimmerz) — earlier POC; superseded.
