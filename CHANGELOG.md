# Changelog

All notable changes to **ncsx** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.6.0 — 2026-05-28

**ediabasx 0.4.0 + inpax 0.9.0 uplift.** Picks up the new SAE J2534
transport, shared web-ui components, and the slow-K-line-ECU fix.
Web app moves to the shared `@emdzej/bimmerz-theme` palette and
deduplicates its interface-config + connect UI against the rest of
the bimmerz family.

### Added

- **SAE J2534 transport** in the web app via
  `@emdzej/ediabasx-interface-j2534`. Pick "J2534 (OpenPort 2.0)"
  in Settings to drive a Tactrix OpenPort 2.0 over Web Serial — same
  cluster / IKE / body-module coding that previously only worked
  over K+DCAN now works over OpenPort too. Includes the host-side
  `ParRegenTime` fix from ediabasx 0.4.0.
- **Gateway transport** in the web app — pick "Gateway" + enter the
  WebSocket URL of a remote `ediabasx gateway --transport websocket`
  server. Used to be a config-only stub; now actually connects.
- **Shared UI components from `@emdzej/ediabasx-web-ui`** — the
  interface configuration panel and Connect/Disconnect pill come
  from the shared package now. Adding a new transport upstream
  shows up here automatically.

### Changed

- **Web app adopts `@emdzej/bimmerz-theme`.** Tailwind preset +
  `tokens.css` import replace the local `:root` / `.dark` block.
  Class names unchanged (`bg-surface`, `text-muted`, …); subtle
  hue shift from ncsx's zinc neutrals to bimmerz's slate-tinted
  palette, matching the rest of the family.
- **`apps/web/src/lib/ediabas-session.svelte.ts`** — the previously
  webserial-only `connectWebSerial()` becomes a polymorphic
  `connect()` that branches on `app.config.interface`. The shared
  `<InterfaceConfigPanel>` can now expose all three transports
  knowing the session code actually handles them.
- **All `@emdzej/ediabasx-*` deps bumped to `^0.4.0`**; all
  `@emdzej/inpax-*` deps bumped to `^0.9.0`.

## 0.5.1 — 2026-05-27

**inpax 0.8.1 uplift.** Picks up the upstream VM fix for cross-frame
`Scope.Local` reference writes — without it any IPO function called
with an out-/inout-param ref could write to the wrong stack slot or
throw `Stack index out of bounds`. ncsx's coding IPOs (`Cod`,
`FgnrSchreiben`, `JobsXX`, etc.) all use out-refs, so the upstream
fix lands here as a routine dep bump.

### Changed

- All `@emdzej/inpax-*` dependencies bumped from `^0.7.1` → `^0.8.1`
  (`packages/pfl`, `apps/web`).

## 0.5.0 — 2026-05-26

**Custom PSW parameters** — NCS Dummy's "Add FSW/PSW Parameter" equivalent,
end-to-end. Users can now register brand-new PSWs under existing FSWs, ship
them inside `.ncsxpatch.yaml` files, and apply patches that bring custom
PSWs with them. Factory DATEN stays untouched — the patch file IS the
overlay. See [`docs/custom-fsw-psw.md`](docs/custom-fsw-psw.md) for the
design.

### Added

- **`.ncsxpatch.yaml` schema** gains optional per-module `custom_psws:`
  block. Each entry declares `fsw` + `keyword` + hex `data` + optional
  `description`. Schema rejects malformed hex / odd digit counts at parse
  time; round-trip via `serializePatch` / `parsePatch` preserves the block.
- **`@emdzej/ncsx-patches`**: `extractCustomPsws(patch)` returns
  `Map<moduleName, CustomPswOverlayEntry[]>` ready to pipe into the
  function-list builder. `parseHexBytes(hex)` + `toOverlayEntry(psw)`
  exposed as primitives.
- **`@emdzej/ncsx-function-list`**: `buildFunctionList(daten, { customPsws })`
  merges overlay entries into the matching FSW's parameter list after the
  DATEN walk. Synthetic ids assigned from `CUSTOM_PSW_ID_BASE = 0xF000` —
  the builder throws if any factory PSW occupies that range so the
  reservation stays safe.
- **`apps/web` FunctionTree**: inline **`+ Add parameter`** form under
  each FSW row. Submit validates keyword shape, hex syntax, and
  byte-length against the FSW's `length`; appends to a session-scoped
  `customPswDraft`, rebuilds the FunctionList, and the new PSW appears
  as a regular radio option with a small `custom` badge plus a × button
  on its row that removes it from the draft.
- **Apply patch**: when a loaded patch declares `custom_psws:` for the
  current module, `app.functionList` is rebuilt with the overlay before
  resolving `edits` — the patch's references to its own custom PSWs
  now resolve cleanly instead of surfacing as "unknown PSW" warnings.
- **Save / Append patch** thread the session's `customPswDraft` through
  to the emitted YAML so a draft authored via `+ Add parameter` becomes
  part of the saved file alongside the staged edits.

### Internal

- `rebuildFunctionListWithPatch` (patch-driven) and
  `rebuildFunctionListWithDraft` (UI-driven) share a single
  `rebuildFunctionListCore` in `apps/web/src/lib/patches.ts` — one
  CABD-open + builder call regardless of source.

### Notes

- Patches still require at least one `edits:` entry per module (schema
  constraint unchanged). A draft-only "library" patch isn't expressible
  in v1 — stage at least one edit using your custom PSW before Save.
- Custom-PSW ids are session-scoped and reassigned on every rebuild;
  callers should not persist or rely on the numeric id outside one
  in-process pass.

### Tested

- 17 new tests across `@emdzej/ncsx-patches` + `@emdzej/ncsx-function-list`
  (overlay merge, sequential id assignment, error paths, hex parsing,
  extractor grouping, schema rejection, round-trip equivalence). All 100+
  workspace tests pass; web typecheck + svelte-check clean.

## 0.4.0 — 2026-05-25

End-to-end **identity-write flows** for FA, FGNR (VIN), and ZCS — all
three now run as multi-target writes through a single shared UX, with
candidate ECUs discovered by IPO byte-search and the IPO/SGBD seed
channels traced and documented.

### Added

- **`@emdzej/ncsx-coder` `buildSlotsFromValues`** — generic FSW-value
  → slot-table primitive that consumes a `FunctionList` and a
  `Map<keyword, value>` and emits the slot list `setNettoSlots`
  consumes. Replaces the bespoke `buildZcsSlots`-shaped helpers
  per-field; future identity / factory-defaults flows can target it
  directly. Exit values: `{ slots, netto, applied, skipped }`.
- **`apps/web` `WriteTargetList` component.** Shared multi-ECU
  checkbox-list + status-pills UI used by all three identity-write
  dialogs. Renders per-ECU `pending → writing → ok / error` states
  with retry-failed-only buttons, all/none select shortcuts, and an
  "N of M selected" / "K ok / J failed" footer summary.
- **Multi-target FGNR (VIN) write — `FgnrEditorDialog`.** New dialog
  that scans the chassis for IPOs that dispatch `FGNR_SCHREIBEN`,
  lets the user pick which ECUs to write to, and runs the dispatch
  sequentially with per-ECU status. Catches both slot-driven (KMB on
  E46) and param-driven (LSZ, GM5) write styles uniformly via IPO
  byte-search.
- **Multi-target ZCS write — `ZcsEditorDialog` retrofit.** Same shape:
  IPO byte-search for `ZCS_SCHREIBEN`, per-ECU IDENT, multi-target
  loop. ZCSUT dropdowns (GM/VN templates) and SA bit-picker keep
  keying off the read-source SG since the values are universal across
  the write set.
- **Structured FA editor — `FaEditorDialog` rewrite.** Parses
  `STANDARD_FA` into the typed struct
  `{ br, date, typ, lack, polster, zusbau[], sa[] }` and edits each
  slot independently. Slot-aware AT pickers: C_DATE from Z-`#`
  entries, C_TYP from W type-shape (`^[A-Z]{2}[A-Z0-9]{2}$`), SA from
  the remainder. LACK / POLSTER / ZUSBAU are freehand text since no
  AT dictionary ships them. Multi-target write via FA_WRITE byte-
  search.

### Changed

- **Runtime FGNR seed now writes both channels.** `runtime.svelte.ts`
  seeds `FAHRGESTELL_NR` via **both** `CDHSetCabdPar` (slot 0x1B) and
  `CDHSetSystemData` (slot 0x2C). LSZ/GM5 IPOs read VIN via
  `CDHGetSystemData` — without that seed they dispatched
  `C_FG_AUFTRAG` with `params(0)=[]` → `ERROR_NUMBER_ARGUMENT`.
  KMB's slot builder also pulls from system-data when computing
  FAHRGESTELL_NR[1..18] values; writing-without-seed produced
  `ERROR_VERIFY` from the post-write read-back.
- **Optimistic identity update for VIN / ZCS commit.** The runtime
  auto-seeds VIN and ZCS from `app.identity.{vin,zcs}` inside
  `runCabimain`, so the dialog updates the identity *before* the
  write loop instead of only on success. Revert on total failure;
  leave on partial (matches the mixed state of the car).
- **Per-ECU `IDENT` in every identity-write loop.** Drops the
  `app.selectedModule.codingIndex` shortcut that bled the
  user-selected module's CI across every target ECU. The
  `ID_COD_INDEX` parse is now base-16 — fixes `LSZ.C34` mapping to
  the wrong `C22` `.Cxx` because the digit string `"34"` was being
  parsed as decimal.
- **Candidate scan via IPO byte-search.** All three dialogs find
  write targets by reading `<basename>.IPO` bytes and string-
  searching for the jobname (`FA_WRITE`, `FGNR_SCHREIBEN`,
  `ZCS_SCHREIBEN`). Cheaper than parsing each IPO's cabimain
  dispatch table; catches LSZ-style param-driven writers that
  declare no CABD FSWs for the field.
- **`loadIpoBytes` exported from `runtime.svelte`** so the write-
  dialog target-resolvers can probe IPO contents without booting
  the VM.

### Fixed

- **FA wire-format round-trip on edit.** The previous flat-chip
  editor flattened every constituent's marker to `$` on rebuild,
  producing strings like `E46_$E46$0A08$N6TT$…$EP31#0904` that
  FA.PRG's `FA_STREAM_FOR_ECU` rejected with `ERROR_UNKNOWN_CONSTIT`
  (`$0A08` says "SA code" but `0A08` is a LACK). The structured
  rewrite emits per-slot markers (`*BW32`, `%0A08`, `&N6TT`,
  `|7531125`, `$205`) and the chassis-code duplication that produced
  `E46_$E46$…` is dropped at parse time.
- **FA double-marker on `#`-prefixed tokens.** `tokenizeFa`
  preserves `#` (for AT date-code lookups); the old emitter
  unconditionally prepended a marker, producing `$#0905` → `ERROR_SA`.
  Tokens that already carry `#` now re-emit verbatim.

### Documentation

- **New `docs/fa-format.md`.** FA wire format with per-marker
  constituents, the `FA_STREAM2STRUCT` decoded shape, slot →
  AT-category dictionary mapping per slot, slot-driven vs
  param-driven IPO write styles, and the system-data vs cabd-par
  seed channel matrix (with the FGNR cautionary tale of seeding
  the wrong channel).
- **`docs/daten-format.md` AT category table** updated from
  "best-guess from context" to what we measured on `E46AT.000`:
  W mixes SA codes and C_TYP variants (disambiguated by code
  shape, not category); Z is C_DATE (`#`-prefixed); LACK,
  POLSTER, and ZUSBAU have no chassis-shipped AT entries.

## 0.3.1 — 2026-05-24

Identity-panel UX rework + a Ghidra-verified rewrite of the FA / ZCS
write-path commentary.

### Changed

- **Identity panel exposes FA + ZCS per ECU, not per role.** The same
  physical ECU often appears in SGFAM as two rows under the same
  SGBD with different CABDs — one with FA=1, one with ZCS=1 (E46
  `AKMB`/`KMB` → `C_KMB46`; `ALSZ`/`LSZ` → `C_LSZA`). The panel now
  groups identity-master rows by SGBD and shows both Read FA / Read
  ZCS buttons on the same ECU row; whichever personality SGFAM
  doesn't declare is disabled with an explanatory tooltip.
- **`VehicleIdentity.source` → `faSource` / `zcsSource`.** Each
  payload tracks the SGFAM row it was read from independently, so
  the FA editor dispatches `FA_WRITE` against the FA-master CABD
  and the ZCS editor dispatches `ZCS_SCHREIBEN` against the
  ZCS-master CABD — even when both reads happened on the same SGBD.
  Reads merge into existing identity instead of replacing it.

### Documentation

- **runtime.svelte.ts comments rewritten.** Traced the full
  `FA_WRITE` / `ZCS_SCHREIBEN` chain through NCSEXPER in Ghidra and
  the corresponding `cabimain` handlers in `A_AKMB46.ipo` /
  `A_KMB46.ipo`. Fixed several misleading claims:
  - The IPO ships FA writes via `CDHapiJob(sgbd, "C_FA_AUFTRAG", …)`
    after FA.PRG's `FA_STREAM_FOR_ECU` job converts the FA token
    string to binary — *not* via the previously-claimed
    `apiJobData(sgbd, "FA_SCHREIBEN", …)`. `FA_SCHREIBEN` doesn't
    exist in NCSEXPER's string table or the IPO.
  - `ZCS_SCHREIBEN` (and `FGNR_SCHREIBEN` / `ZCS_LOESCHEN`) go
    through the IPO's unified `Cod` handler which calls
    `CDHapiJobData(sgbd, "C_S_AUFTRAG", bytes, len, "")` — the
    universal write-with-order SGBD job.
  - Renamed NCSEXPER reverse-engineering function references in
    comments to match the Ghidra symbol updates (`FUN_00402c70` →
    `dispatchUserJob`, `FUN_0044b880` → `cabdParsClearKeepApp_impl`,
    etc.).
  - Clarified that `coapiWriteAuftrag`'s inner cabd-par reset
    wipes the outer `cabdParsClearKeepApp` reset's preserved
    APPLIKATION key, so re-seeding APPLIKATION per-call (as we do)
    is defensive rather than bit-for-bit mirroring NCSEXPER.

No runtime-behaviour change — the host-side cabd-par seeding
(`FA_STREAM` / `GM_/SA_/VN_SCHLUESSEL` / `JOBNAME`) was already
correct, only the comments around it were wrong.

## 0.3.0 — 2026-05-24

Logger migration onto `@emdzej/bimmerz-logger` — matches the
ediabasx 0.3.0 + inpax 0.7.0 cut-overs. The Settings dialog now
exposes the combined `NCSX.*` + `INPAX.*` + `EDIABASX.*` category
catalogue (sourced from each library's `LOG_CATEGORIES` export) so a
single panel controls log levels across all three subsystems the
web app embeds.

### Changed (breaking)

- **`@emdzej/ediabasx-*` deps bumped to `^0.3.0`**, picking up the
  ediabasx logger migration + the new modal Run-job arg dialog +
  `LOG_CATEGORIES` export.
- **`@emdzej/inpax-*` deps bumped to `^0.7.0`**, picking up the
  inpax logger migration + its `LOG_CATEGORIES` export.
- **No more direct `console.*` calls in the runtime code path.**
  Lifecycle traces, dispatcher logs, install-storage warnings, and
  every other diagnostic now route through bimmerz-logger
  categories — by default invisible at the standard `info` level,
  visible when the user opts into trace/debug via Settings.

### Added

- **`@emdzej/bimmerz-logger@^0.1.2`** added as a peer dep in
  library packages (`@emdzej/ncsx-chassis`,
  `@emdzej/ncsx-inpax-cabi-provider`) and a regular dep in
  `@emdzej/ncsx-web`.
- **Hierarchical `NCSX.*` categories.** Every internal `getLogger()`
  call uses one of:
  - `NCSX` — catch-all
  - `NCSX.cabi-provider` — CDH* dispatch tap
  - `NCSX.web` — top-level web app (translations etc.)
  - `NCSX.web.pwa` — service-worker lifecycle
  - `NCSX.web.runtime` — per-module IPO runtime startup
  - `NCSX.web.process-ecu` — read / write coding lifecycle
  - `NCSX.web.cabi-syscalls` — per-slot CABI syscall dispatch traces
  - `NCSX.web.install-storage` — IndexedDB persistence warnings
  - `NCSX.web.chassis-list` — chassis-load warnings
  - `NCSX.web.ecu-list` — FA→ASW resolution warnings
  - `NCSX.web.function-tree` — JOB_ERMITTELN enumeration warnings
- **`@emdzej/ncsx-chassis` exports `LOG_CATEGORIES`** —
  catalogue iterable from consuming apps so Settings UIs don't
  hardcode category names. Drives the ncsx-web Settings panel
  alongside `@emdzej/inpax-interpreter`'s and
  `@emdzej/ediabasx-ediabas`'s catalogues.
- **ncsx-web Settings — Logging section.** Default-level dropdown
  plus per-category override picker, sourced from all three
  upstream library catalogues unioned together. Changes apply
  immediately at runtime — handles are proxies; every cached
  logger picks up new settings on its next emit.
- **`logger-wiring.ts`** in `apps/web/src/lib/` — small helper that
  validates the persisted `WebLoggerConfig` (catches corrupted
  localStorage entries) and feeds it to `configureLogger()`.
  Applied at boot from `main.ts` so component-init log calls land
  at the user's chosen level.

### Internal

- All ncsx packages bumped to **0.3.0** in lockstep.

## 0.2.0 — 2026-05-23

NCSDummy-equivalent UI surface plus a shareable patch format, riding on top of
the 0.1.0 coding engine.

### Added

- **Shareable coding patches (`.ncsxpatch.yaml`)** — Save / Append / Apply
  buttons next to the existing TRC/MAN ones. Patches are YAML files that wrap
  the same FSW/PSW edits a `.MAN` carries, plus title / description / author /
  keywords / chassis metadata, optional coding-index pinning, and optional
  `require_current` pre-write assertions. Multi-module patches in one file;
  apply stages edits for the currently-loaded module. Format reference:
  [`docs/patches.md`](docs/patches.md). New companion repo:
  [`ncsx-community-patches`](https://github.com/emdzej/ncsx-community-patches)
  — drop a patch under `patches/<CHASSIS>/`, open a PR, indexes regenerate on
  merge.
- **Decoded property values** — property-style FSWs (VIN, mileage, dates,
  steering ratio, fuel-percent, …) now render with their decoded value via
  NCSDummy's per-keyword formula table (149 ported formulas covering 1055 case
  arms). Falls back silently for keywords with no formula. Activated the
  formerly-unused `@emdzej/ncsx-property-formulas` package.
- **In-FA / not-in-FA chips** on enumerated PSW rows — driven by the
  chassis-level CVT predicate evaluator. Green ✓ chip means the car's order
  options match the PSW's predicate; amber ⚠ means the PSW is in the CABD but
  the car's options don't enable it. Works on both FA-master chassis
  (E60+ / F-platforms) and ZCS-master chassis (E36/E38/E39/E46/E53) — the
  latter via SA-bit expansion through the chassis ZST + SWTASW tables.
  Activated `@emdzej/ncsx-options` + `@emdzej/ncsx-predicate`.

### Fixed

- **`SG_CODIEREN` silently no-op'd after the cce748f error-scratchpad wiring.**
  Every IPO's `cabimain` prologue installs a "no-job-yet" sentinel via
  `CDHSetError` as its first instruction; without an explicit reset the IPO's
  later `CDHTestError` saw the sentinel and bailed before reaching
  `C_S_AUFTRAG`. Symptom: write returned `JOB_STATUS=OKAY` but nothing changed
  in the ECU. `runCabimain` now resets the error scratchpad right before
  dispatch (mirrors NCSEXPER's `coapiRunCabimain`). Write outcome is now also
  gated on the IPO's `returnVal` / `lastCdhError` — `JOB_STATUS` alone is too
  permissive (it tracks the last apiJob, typically a harmless IDENT).
- **Options builder block-name mismatch.** The CVT parser was checking for
  `GRUPPE_S` / `INDIVID_S` / `FSW_PSW_WW` (those are NCSDummy's *C# class*
  names) but real on-disk DATEN block strings are unsuffixed (`GRUPPE` /
  `INDIVID` / `FSW_PSW`). Verified across E36 / E39 / E46 / E53 / E60 / E89
  CVTs — none use the suffixed forms. The package's own tests passed because
  they fed it synthetic data using the buggy names.

### Changed

- Renamed `apps/ncsx-web` → `apps/web` to align with the inpax / ediabasx
  conventions. Same npm package name (`@emdzej/ncsx-web`).
- Renamed `e46` → `E46` in the community-patches repo to match canonical
  chassis codes (indexer normalises chassis from patch metadata regardless of
  directory casing).

### Internal

- New `@emdzej/ncsx-patches` package — zod schema, YAML parser/serializer,
  validate-against-FunctionList helpers.
- Workspace bumped to **0.2.0** across all 19 publishable packages plus the
  private root + web app.

## 0.1.0 — 2026-05-22

Initial release. NCS Expert running in the browser, end-to-end against real BMW ECUs over
Web Serial or a remote `ediabasx` gateway.

### What works on hardware

- **Install picker** — pick a BMW Standard Tools install root. Browser remembers it across
  reloads (File System Access + IndexedDB). Falls back to picking `NCSEXPER/` or `DATEN/`
  directly when the canonical layout isn't found.
- **Chassis catalog** — parses `BR_REF.DAT` to enumerate every chassis the install
  declares. Resolves `BR_ERSATZ` aliases.
- **Vehicle identity** — read VIN, FA (E60+), and ZCS (E36/E38/E39/E46/E53) from the
  per-chassis identity SG. SGFAM's FA/ZCS flags pick the right SG automatically; no
  hardcoded chassis tables.
- **FA-derived ECU filter** — once identity is loaded, the SG list filters to what the car
  actually has, evaluating each `AUFTRAGSAUSDRUCK` predicate against the FA-derived ASW.
- **Decoded identity panel** — FA tokens and ZCS SA bits both rendered with German
  AT/ZST comments and English NCSDummy translations.
- **Per-CABD function tree** — every FSW / PSW / property / unoccupied slot the CABD
  declares, with translations and the currently-coded PSW highlighted from the live netto.
- **Auto-pick `.Cxx` variant** — `CODIERINDEX_LESEN` through the per-CABD IPO; the
  matching variant loads automatically. Manual override via the chassis browser.
- **Read coding** — `CODIERDATEN_LESEN` via the per-CABD IPO dispatcher, same path NCS
  Expert uses (auth gates, multi-step state machines, CI lookups honoured).
- **Edit + write coding** — stage PSW changes with a byte-level diff, then `SG_CODIEREN`
  via the IPO. Verified on E46 KMB / GM5.
- **Apply Defaults** — destructive write of the CABD's `ANLIEFERZUSTAND` via `SG_CODIEREN`.
  Gated to CABDs that ship a complete factory netto; greyed out elsewhere with a tooltip
  explaining the missing bytes.
- **Generic job runner** — `JOB_ERMITTELN` enumerates every job the IPO declares (matching
  NCSEXPER's "Change Job" dialog); the user can dispatch any of them. Write-class jobs
  prompt for confirmation.
- **FA editor** — modal dialog: removable token chips, searchable list of every code in
  `<BR>AT.000` (with German comment + English translation), live FA-string preview,
  added/removed diff chips. Writes `FA_WRITE` through the per-CABD IPO.
- **ZCS editor** — modal dialog: GM / SA / VN inputs plus a checkbox list of every ZST row
  with a non-zero SA mask, grouped by SA code with FSW comments. Writes `ZCS_SCHREIBEN`.
- **TRC / MAN export & import** — `FSW_PSW.TRC` (snapshot), `FSW_PSW.MAN` (staged edits),
  `NETTODAT.TRC` (raw bytes). All formats match NCSEXPER's `coapiTraceNettoData` /
  `coapiTraceFswPsw` output byte-for-byte. MAN files can be imported to stage edits.

### Architecture

- Three-layer engine stack: this repo (`ncsx`) on top of [`inpax`](https://github.com/emdzej/inpax)
  (IPO interpreter) on top of [`ediabasx`](https://github.com/emdzej/ediabasx)
  (EDIABAS / BEST-VM).
- All writes route through BMW's own `A_<cabd>.IPO` coding scripts — direct `apiJob` calls
  are deliberately avoided so per-CABD auth gates, multi-step write protocols, and
  checksum recalculation come through unchanged.
- Per-dispatch cabd-par seeding mirrors NCSEXPER's `FUN_00402c70`: `APPLIKATION` on every
  job; `FAHRGESTELL_NR` for `FGNR_SCHREIBEN`; `GM/SA/VN_SCHLUESSEL` for `ZCS_SCHREIBEN`;
  `FA_STREAM` for `FA_WRITE`. Store is cleared at the start of every dispatch (matches
  NCSEXPER `FUN_0044b880`).
- 17 libraries under `@emdzej/ncsx-*`, independently usable for anyone parsing BMW's data
  formats.

### Browser support

- Chromium derivatives only (Chrome, Edge, Opera, Brave) — uses `showDirectoryPicker`,
  Web Serial, and OPFS.
- Plain HTTP on `localhost` works for dev; any other host needs TLS (Web Serial is
  secure-context-gated).

### Known limitations

- **Authentication is stubbed.** `CDHCallAuthenticate` / `CDHAuthGetRandom` are no-ops —
  the BMW seed/key tables aren't shipped. ECUs that gate write-class jobs behind auth
  won't accept writes until those crypto tables are present.
- **FA / ZCS writes are mechanically wired but not yet hardware-verified.** First-light
  testing pending; see `docs/STATUS.md`.
- **No verify readback after FA_WRITE / ZCS_SCHREIBEN.** Both trust `JOB_STATUS=OKAY` from
  the IPO. `SG_CODIEREN` already re-reads after write; FA/ZCS should follow the same
  pattern.
- **No post-write checksum verify (`C_CHECKSUM`)** after `SG_CODIEREN`. NCSEXPER runs it
  via `FUN_00406060`; we don't yet.
- **`Apply Defaults` only works** when the CABD ships a complete `ANLIEFERZUSTAND`
  covering the full `CODIERDATENBLOCK` range. CABDs without one (e.g. AKMB on E46) have
  the button disabled.

### Reference

- Live: [`ncsx.bimmerz.app`](https://ncsx.bimmerz.app)
- Resume notes / next steps: [`docs/STATUS.md`](docs/STATUS.md)
- Reverse-engineering documentation: [`docs/README.md`](docs/README.md)
