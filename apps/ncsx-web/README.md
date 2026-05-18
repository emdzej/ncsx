# @emdzej/ncsx-web

Browser SPA for **NCSX**. Pick a BMW Standard Tools install root, browse the chassis
catalog, drill into a module's FunctionList, and (Soon™) tick checkboxes to apply coding
changes over Web Serial.

Pure client-side. No server. Mirrors the architecture of `@emdzej/ediabasx-web` and
`@emdzej/inpax-web` — same Svelte 5 + Vite + Tailwind + PWA stack, same File System
Access pattern. See [`docs/user-flow.md`](../../docs/user-flow.md) for the full design.

## Develop

```bash
pnpm install                # at the repo root
pnpm --filter @emdzej/ncsx-web dev
# → http://localhost:5175
```

## Build

```bash
pnpm --filter @emdzej/ncsx-web build
# → apps/ncsx-web/dist/  — static SPA, deploy anywhere
```

## What works today (v0)

1. **Install picker** — `showDirectoryPicker()` selects the **BMW Standard Tools install
   root** (the folder containing `NCSEXPER/`, `EDIABAS/`, `EC-APPS/`). We drill
   case-insensitively for each canonical subdir so different OS / casing layouts work.
   Handle persists across reloads via IndexedDB; permission re-prompts via a "Continue
   with…" button. Falls back to "user picked NCSEXPER directly" or "user picked DATEN
   directly" if the canonical layout isn't found.
2. **Install summary** — badges show which subsystems were discovered: DATEN, PFL, NCS
   SGDAT, NCS CFGDAT, EDIABAS/Ecu, INPA SGDAT. Coding works as long as DATEN is found;
   wire access (Phase 6) will also need EDIABAS/Ecu; Kernfunktionen (Phase 9+) will need
   one of the SGDAT folders.
3. **Chassis list** — parses `NCSEXPER/DATEN/BR_REF.DAT` to enumerate chassis codes.
4. **Module browser** — loads the picked chassis (DST + SGET + SGVT + SGFAM + ZST + AT +
   SWT tables) and lists every SG declared in SGFAM, with a name filter.
5. **FunctionList tree** — picks an SG, lazy-loads its CABD `.Cxx`, builds the typed
   `FunctionList` (via `@emdzej/ncsx-function-list`), and renders a read-only tree of
   functions / properties / unoccupied / group headers. FSW/PSW keywords resolved via the
   chassis's SWT tables.

## Subsystems we discover

| Subdir                    | Used for                                                  | Required for     |
|---------------------------|-----------------------------------------------------------|------------------|
| `NCSEXPER/DATEN`          | Chassis catalogs, CABD `.Cxx`                             | **coding** (v0)  |
| `NCSEXPER/PFL`            | `.pfl` profile files                                      | future "session settings" |
| `NCSEXPER/SGDAT`          | Per-SG BEST scripts (`.ipo`)                              | future Kernfunktionen runner |
| `NCSEXPER/CFGDAT`         | `COAPI.INI` / `NCSEXPER.INI`                              | reference / debug |
| `NCSEXPER/WORK`           | TRC/MAN files (NCS Expert's traditional scratch space)    | optional escape hatch |
| `EDIABAS/Ecu`             | SGBD `.prg` / `.grp` files                                | **wire** (Phase 6) |
| `EDIABAS/Bin`             | `EDIABAS.INI` (not directly used in browser)              | nice to have     |
| `EC-APPS/INPA/SGDAT`      | INPA IPO scripts                                          | future Kernfunktionen runner |
| `EC-APPS/INPA/CFGDAT`     | `INPA.INI`                                                | reference / debug |

## What's coming

Per [`docs/user-flow.md`](../../docs/user-flow.md) phase plan:

- Phase 5: OPFS-backed cache for parsed CABD bundles (skip the re-parse on second visit)
  + draft `TraceOverlay` persistence (so a tab close doesn't lose your edits).
- Phase 6: `packages/wire` — `WebSerialTransport` + `@emdzej/ediabasx` to read/write the
  ECU directly.
- Phase 7: `Apply to ECU` button.
- Phase 8: `Export TRC` / `Export MAN` / `Import…` for NCS Expert interop.

## Browser support

Chromium derivatives only (Chrome, Edge, Opera, Brave). Firefox and Safari miss
`showDirectoryPicker` / Web Serial / OPFS-sync. The app surfaces an "unsupported
browser" banner on those.

Plain HTTP `localhost` works for dev. Any other host needs TLS (Web Serial is
secure-context-gated).
