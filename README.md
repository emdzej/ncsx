# ncsx

**BMW NCS Expert in your browser.** A TypeScript port of the BMW factory coding tool
(NCSEXPER 4.0.1), built on the same engine stack as the sibling projects
[`ediabasx`](https://github.com/emdzej/ediabasx) (EDIABAS) and
[`inpax`](https://github.com/emdzej/inpax) (INPA).

Read the chassis's DATEN catalog, browse every ECU coding option in plain English,
edit individual FSW/PSW values, then write the result back to the car over a K+DCAN
cable or a remote gateway — all without leaving the browser. No installer, no
Wine, no admin rights.

Live at **[ncsx.bimmerz.app](https://ncsx.bimmerz.app)** (Chromium-only — uses
File System Access + Web Serial).

## What you need

- A BMW Standard Tools install (genuine, BMW-shipped data). The app picks the root
  folder containing `NCSEXPER/`, `EDIABAS/`, and `EC-APPS/` and reads from it
  read-only — nothing is uploaded.
- A K+DCAN cable plugged into a USB port (Web Serial), **or** an
  [`ediabasx` gateway](https://github.com/emdzej/ediabasx) running over WebSocket
  if the cable is on a different machine.
- Chrome, Edge, Opera, or Brave on desktop. Firefox and Safari lack the required
  Web Platform APIs.

## What works today

- **Chassis catalog browser** — every chassis declared in `BR_REF.DAT`, with all of
  its ECU coding variants discoverable through SGFAM / SGAUSWAHL.
- **Vehicle identity** — read VIN + FA (post-E60) or ZCS (E36/E38/E39/E46/E53) from
  the appropriate per-chassis identity SG. SGFAM's FA/ZCS flags pick the right SG
  automatically — no hardcoded tables.
- **FA-driven ECU filter** — once identity is loaded, the SG list filters to what
  the car actually has, matching NCSEXPER's `AUFTRAGSAUSDRUCK` evaluation.
- **Per-CABD function tree** — every FSW / PSW / property / unoccupied slot
  rendered with NCSDummy keyword translations, current PSW highlighted from the
  live netto.
- **Read coding** — `CODIERDATEN_LESEN` through the per-CABD `A_*.ipo` dispatcher,
  same path NCS Expert uses (auth gates, multi-step state machines, CI lookups
  all honoured).
- **Edit + write coding** — stage PSW changes, see the byte-level diff,
  `SG_CODIEREN` through the IPO. End-to-end verified on E46 KMB + AKMB + GM5.
- **Generic job runner** — `JOB_ERMITTELN` enumerates every job the IPO declares
  (matching NCSEXPER's "Change Job" dialog); user can dispatch any of them
  through a dropdown.
- **Apply defaults** — destructive write of the CABD's `ANLIEFERZUSTAND` via
  `SG_CODIEREN`, gated to CABDs that ship a complete factory netto.
- **Export / import** — `FSW_PSW.TRC` (full snapshot), `FSW_PSW.MAN` (staged
  edits), `NETTODAT.TRC` (raw bytes). All formats match what NCS Expert writes
  to `WORK/`.

See [`docs/STATUS.md`](docs/STATUS.md) for the live status board.

## Architecture

Three layers, each with its own repo:

```
ncsx       (this repo)   — NCS Expert: coding flow, FA, chassis catalog
inpax                    — INPA: IPO bytecode interpreter, screen/menu UI
ediabasx                 — EDIABAS: BEST/2 SGBD interpreter, wire transports
```

`ncsx` parses BMW's DATEN files, builds typed function-lists, dispatches BMW's
own `A_<cabd>.IPO` coding scripts through the `inpax` interpreter, and lets the
IPO's CABI/CDH calls drive `ediabasx`'s wire layer. Going through the IPO is
load-bearing — it carries per-CABD auth gates, multi-step write protocols, and
checksum recalculation that direct `apiJob` calls would skip.

## Packages

Pure libraries, all under `@emdzej/ncsx-*`. Most are independently useful for
anyone parsing BMW's data formats — no dependency on the web app.

| Package | Purpose |
|---|---|
| [`@emdzej/ncsx-chassis`](packages/chassis) | Load a complete chassis bundle from DATEN (DST + SGET + SGVT + SGFAM + ZST + AT + SWT + CABD loader). |
| [`@emdzej/ncsx-cabd`](packages/cabd) | CABD coding-rule decoder/encoder — converts between byte-level netto and logical FSW/PSW values. |
| [`@emdzej/ncsx-coder`](packages/coder) | End-to-end coding orchestrator — chassis + FA + edits → `CodingPlan[]` ready to ship. |
| [`@emdzej/ncsx-daten`](packages/daten) | DATEN binary frame parser — signature, frame types, format strings, OPERATION / EINHEIT decoders. |
| [`@emdzej/ncsx-text-tables`](packages/text-tables) | `.AT` text-table parser family (ZST, AT, SGFAM, AT.M00, AT.ZUS, VARIABLE.ASC). |
| [`@emdzej/ncsx-function-list`](packages/function-list) | Build a typed `FunctionList` from a parsed CABD (NCSDummy keyword translations baked in). |
| [`@emdzej/ncsx-ecu-select`](packages/ecu-select) | `AUFTRAGSAUSDRUCK` predicate evaluator — filters SGs to what the FA-derived ASW says is installed. |
| [`@emdzej/ncsx-fa-asw`](packages/fa-asw) | FA → ASW (Ausstattungsschluessel-Wert) — walks AT/SWTASW to expand FA tokens. |
| [`@emdzej/ncsx-identity`](packages/identity) | Read VIN / FA / ZCS from a connected ECU; picks the right identity SG per chassis. |
| [`@emdzej/ncsx-inpax-cabi-provider`](packages/inpax-cabi-provider) | CABI/CDH bridge — implements the 80+ `CDH*` functions NCSEXPER's `A_*.ipo` dispatchers call. |
| [`@emdzej/ncsx-options`](packages/options) | NCSDummy-style coding-option overlay (per-FSW friendly names + valid PSW set). |
| [`@emdzej/ncsx-pfl`](packages/pfl) | `.pfl` profile INI parser. |
| [`@emdzej/ncsx-predicate`](packages/predicate) | Byte-coded `AUFTRAGSAUSDRUCK` predicate compiler/runner. |
| [`@emdzej/ncsx-property-formulas`](packages/property-formulas) | Inverse formulas for property-style FSWs (mileage / date / VIN). |
| [`@emdzej/ncsx-trace`](packages/trace) | `TraceOverlay` — track staged edits across the chassis. |
| [`@emdzej/ncsx-translations`](packages/translations) | NCSDummy community keyword → English dictionary loader. |
| [`@emdzej/ncsx-wire`](packages/wire) | Shared `EdiabasLike` type contracts. |

## Apps

| App | What it is |
|---|---|
| [`@emdzej/ncsx-web`](apps/ncsx-web) | The browser SPA at `ncsx.bimmerz.app`. Pure client-side: Svelte 5 + Vite + Tailwind. |

## Develop

```bash
pnpm install                          # at the repo root
pnpm web                              # dev server on http://localhost:5175

pnpm build                            # build everything via turbo
pnpm typecheck                        # tsc --noEmit + svelte-check
pnpm lint                             # eslint
pnpm test                             # vitest across all packages
```

Per-package work uses the standard pnpm filter pattern:

```bash
pnpm --filter @emdzej/ncsx-cabd test
pnpm --filter @emdzej/ncsx-web dev
```

Most packages ship a built `dist/` consumed by the web app; rebuild a package
(`pnpm --filter <name> build`) if changes don't show up in the dev server.

## Reverse-engineering notes

The reverse-engineering documentation lives under [`docs/`](docs/) — it covers
NCSEXPER's architecture, the DATEN file formats, the coding flow byte-by-byte,
and the CABI/CDH binding plan. Start with [`docs/STATUS.md`](docs/STATUS.md) for
the current snapshot and [`docs/NCSEXPER-REVERSE-ENG.md`](docs/NCSEXPER-REVERSE-ENG.md)
for the architecture overview.

These are written for someone who wants to understand *why* the code does what
it does — they're not required reading to use the web app or the libraries.

## Related projects

- [`ediabasx`](https://github.com/emdzej/ediabasx) — EDIABAS / BEST/2 interpreter
  and wire transports (Web Serial, gateway).
- [`inpax`](https://github.com/emdzej/inpax) — INPA / IPO bytecode interpreter
  with screen and menu UI providers.
- [tisx](https://github.com/emdzej/tisx) — TIS graphics decoder.
- [wdsx](https://github.com/emdzej/wdsx) — Wiring Diagram System.
- [NCS Dummy](https://www.loyal2b.com/ncsdummy/) — the long-standing community
  Windows tool whose keyword translations and FSW-naming heuristics this project
  builds on.

## Right to Repair

The [Right to Repair](https://repair.eu) movement advocates for consumers' ability to fix the products they own — from electronics to vehicles — without being locked out by manufacturers through proprietary tools, paywalled documentation, or artificial restrictions.

**I build these tools because I believe repair is a fundamental right, not a privilege.**

Too often, service manuals, diagnostic software, and technical documentation are kept behind closed doors — unavailable to individuals even when they're willing to pay. This wasn't always the case. Products once shipped with schematics and repair guides as standard. The increasing complexity of modern technology doesn't change the fact that capable people exist who can — and should be allowed to — use that information.

These projects exist to preserve access to technical knowledge and ensure that owners aren't left at the mercy of vendors who may discontinue support, charge prohibitive fees, or simply refuse service.

## Support

If you find this project useful, consider [buying me a coffee](https://buymeacoffee.com/emdzej) ☕ or [sponsoring on GitHub](https://github.com/sponsors/emdzej) or if it's your thing: via PayPal

[![Donate with PayPal](https://www.paypalobjects.com/en_US/PL/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/donate/?business=TDBR3A97PLQRQ&no_recurring=0&item_name=%28emdzej%29&currency_code=PLN)

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free for noncommercial use (personal projects, research, education, hobby diagnostics on your own car). Commercial use requires a separate licence — open an issue if you need one.

This repository contains no BMW proprietary data. All DATEN files, SGBDs, and IPOs the tool consumes must come from a legally-acquired BMW Standard Tools install on the user's own machine.

## Disclaimer

This project is for educational and research purposes only. It is not affiliated with BMW AG.
