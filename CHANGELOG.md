# Changelog

All notable changes to **ncsx** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
