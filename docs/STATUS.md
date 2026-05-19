# ncsx — current state & resume-from-here

Last updated: commit `ddd67b4` (Nov 2025).

> **Architectural assumptions** ncsx is currently built on: see [`assumptions.md`](assumptions.md).
> Read that first if you're new — covers IPO scope, FA/ZCS handling, SGAUSWAHL resolution.
>
> **The full NCS Expert ↔ IPO ↔ CABI ↔ EDIABAS call architecture** (it's wild):
> [`call-architecture.md`](call-architecture.md). Required reading before touching
> packages/wire or packages/inpax-cabi-provider.

## TL;DR

Reverse-engineering of BMW **NCSEXPER 4.0.1** is **functionally complete**.
TypeScript re-implementation is **at the orchestrator stage**: 9 packages, 201 tests, all
green. The only remaining "implementation" gap is wiring an actual EDIABAS stack underneath
(via `@emdzej/ediabasx`) and a CLI/UI layer on top.

## Packages

```
ncsx/packages/                                                   tests
├── daten/         binary frame parser                             33
├── pfl/           PFL profile (uses inpax INI parser)             29
├── text-tables/   ZST / AT / SGFAM / AT.M00 / AT.ZUS              18
├── predicate/     AUFTRAGSAUSDRUCK byte-coded evaluator           21
├── cabd/          netto-bytes ↔ FSW/PSW (encode + decode)         28
├── chassis/       bundle loader + lazy CABD + SWT lookups         30
├── fa-asw/        FA string → ASW bit set (via AT + SWTASW)       15
├── ecu-select/    SGAUSWAHL_* walker (coapiScanAllSgFromBr)       11
└── coder/         planCoding({chassis, fa, edits}) orchestrator   16
                                                                 ────
                                                                  201 ✔
```

`pnpm install && pnpm run ci` — 36/36 turbo tasks pass (build / lint / typecheck / test).

## Architecture

```
                              ┌──────────────┐
                              │   user FA    │
                              └──────┬───────┘
                                     │
                              ┌──────▼───────────┐
                              │  @emdzej/ncsx-   │
                              │  fa-asw          │
                              │                  │  AT record lookup
                              │                  │  ↓ FSW names
                              │                  │  SWTASW lookup
                              │                  │  ↓ u16 KEYIDs
                              └──────┬───────────┘
                                     │ asw: Set<u16>
                                     │
              ┌──────────────────────▼─────────────────────────────┐
              │  @emdzej/ncsx-ecu-select                            │
              │    walk chassis.sget.SGAUSWAHL_VMSGBD               │
              │       → SGAUSWAHL_SGBD → SGAUSWAHL_VM                │
              │    eval AUFTRAGSAUSDRUCK via @emdzej/ncsx-predicate │
              │    return SelectedSg[]                              │
              └────────────────────────┬───────────────────────────┘
                                       │
                              ┌────────▼─────────┐
                              │  @emdzej/ncsx-   │
                              │  coder           │
                              │    planCoding()  │
                              │      for each SG │
                              │      load CABD   │
                              │      encode FSW  │
                              │      → netto[]   │
                              └────────┬─────────┘
                                       │ CodingPlan[]
                                       ▼
                          (you-supply)  apiJob(sgbd, jobName, hex(netto), '')
                                  →  @emdzej/ediabasx  →  ECU
```

## What's *not* yet built

| Open item                                 | Status / where it'll go |
|-------------------------------------------|--------------------------|
| **FSW/PSW name → numeric id resolution**  | Edits to `coder` currently require numeric `fsw`/`psw`. `chassis.swtFsw` (FSW name → CABD KEYID) and `chassis.swtPsw` (PSW name → value) are **already loaded**; just need a thin helper. ~30 lines in `coder`. |
| **CODIERDATEN_LESEN integration**         | `coder` accepts an `initialNetto` map. The "read from ECU" call is a one-liner against EDIABAS — wait for the wire layer. |
| **EDIABAS wire transfer**                 | Use [`@emdzej/ediabasx`](../../ediabasx/) (already exists). One `apiJob` call per `CodingPlan`. |
| **CLI** (`ncsx code …`)                   | Last mile. Thin wrapper over `coder` + ediabasx. |
| **Kernfunktionen runner (IPO interpreter)** | Reuse [`@emdzej/inpax`](../../inpax/) verbatim. See [`ipo-usage.md`](ipo-usage.md). |
| **VFP / ZUT verifier (`.ssd`)**           | Documented in [`ssd-zut-format.md`](ssd-zut-format.md). Not blocking coding. |

## Docs

Read order (under `docs/`):

1. [`README.md`](README.md) — landing page
2. [`NCSEXPER-REVERSE-ENG.md`](NCSEXPER-REVERSE-ENG.md) — architecture overview, EDIABAS job catalogue
3. [`pfl-format.md`](pfl-format.md) — PFL INI schema
4. [`daten-format.md`](daten-format.md) — binary frame format + text-table family
5. [`ecu-selection.md`](ecu-selection.md) — FA + ZCS → SG list pipeline + AUFTRAGSAUSDRUCK grammar
6. [`coding-flow.md`](coding-flow.md) — FSW/PSW ↔ netto-byte translation, both directions
7. [`trc-man-files.md`](trc-man-files.md) — TRC/MAN observability files
8. [`ssd-zut-format.md`](ssd-zut-format.md) — VERIFIKATION script format
9. [`ipo-usage.md`](ipo-usage.md) — when NCS runs IPO files + syscall catalogue
10. [`POC-DELTAS.md`](POC-DELTAS.md) — historical: gaps from the prior bimmerz POC

## Reverse-engineering status

All five "round-2/round-3" open items are now closed or deferred with workarounds:

| Item | Status |
|------|--------|
| AUFTRAGSAUSDRUCK predicate grammar    | ✔ done — full decoder ([`predicate`](../packages/predicate/)) |
| Lesemodus value ranges                | ✔ done — bounds from profile loader, in [`pfl-format.md`](pfl-format.md) |
| ProfilPruefsumme behaviour            | ✔ confirmed opaque (not validated on load/save) |
| CABD `A` (OPERATION) ops + EINHEIT    | ✔ full 9-operator + 5-unit set decoded ([`cabd`](../packages/cabd/)) |
| DATEN-frame CRC formula               | ✔ XOR-fold, mathematically verified |
| UMRSG column semantics                | ✔ Umrechnungs-SG, sprintf("V%s%s.%s", UMRSG, VMG, CABD) |
| `.ssd` / ZUT record format            | ✔ record-tag-driven, handler family documented |
| ZCSUT update flow (`coapiChangeZcsVm`)| ✔ entry surface mapped (3-tag output decoder) |
| **FA → ASW / predicate-ID parity**    | ✔ via SWTASW: FA token → AT record → FSW names → KEYID → ASW bit (commit `0b28221`) |
| IPO usage in NCS                      | ✔ documented in [`ipo-usage.md`](ipo-usage.md) |

Remaining open RE items (small, deferrable):
- `ProfilPruefsumme` editor write-path (only matters if we want to mint new profiles programmatically).
- Lesemodus enum *value names* (numeric ranges known; symbolic mapping inside `coapiReadAsw/FswPsw/NettoData`).
- ZCSUT inner functions `FUN_0043e4f0` / `FUN_0043cea0` for full ZCS-update walk.
- `.ssd` `MASKE` / `UMRECHNUNG` value syntax (needs a real `.ssd` sample to confirm; likely matches CABD OPERATION).

## Resume entry points

When picking back up, in priority order:

### 1. FSW/PSW name → numeric resolution helper (smallest win)

`packages/coder/src/edit-resolver.ts`. About 30 lines:

```ts
import type { Chassis } from '@emdzej/ncsx-chassis';
import type { CodingEdit } from './types.js';

export interface NamedEdit {
  sgName?: string;
  fsw: string;       // FSW name (e.g. "KEYCARDREADER")
  psw: string | number;  // PSW name or raw value
  index?: number;
  blocknr?: number;
}

export function resolveNamedEdits(chassis: Chassis, edits: NamedEdit[]): CodingEdit[] {
  // Use chassis.swtFsw.byKeyword to resolve `fsw` name → u16 CABD FSW id.
  // Use chassis.swtPsw.byKeyword to resolve `psw` name → raw value (if string).
  // Numeric PSW passes through.
}
```

### 2. EDIABAS wire layer

`packages/wire/` — new package. Depends on `@emdzej/ediabasx`. One function:

```ts
export async function applyCodingPlan(
  apiJob: (sgbd: string, job: string, params: string, results: string) => Promise<JobResult>,
  plan: CodingPlan,
): Promise<{ status: 'OKAY' | 'ERROR'; details?: string }> {
  // hex-encode plan.netto
  // call apiJob(plan.sgbd, plan.jobName, hex, '')
  // check JOB_STATUS via the result set
}
```

### 3. CLI

`apps/cli/` — new app. `ncsx code --br E46 --fa "BL91" --edit "KMB.KEYCARDREADER=eingebaut"` …
Wires everything: `loadChassis` → `planCoding` (with named edits) → either dump the
hex-encoded netto (offline mode) or call into the wire layer.

### 4. Kernfunktionen runner

Reuse the `@emdzej/inpax` IPO interpreter. Implement NCSEXPER's INPA system-function table
(stubs are fine for `setscreen`/`setmenu`/`userbox*` if we're running headless; route `PEM*`
to a string buffer). See [`ipo-usage.md`](ipo-usage.md) for the full syscall list.

## Reference projects (sibling repos)

- [`@emdzej/ediabasx`](../../ediabasx/) — EDIABAS / api32 / BEST-VM port. Plug in via wire layer.
- [`@emdzej/inpax`](../../inpax/) — INPA / IPO interpreter. Reuse for Kernfunktionen.
- [`@emdzej/bimmerz`](https://github.com/mjaskolski/bimmerz) — earlier POC (superseded by this repo).

## Commit log so far

```
ddd67b4 docs: NCS↔INPA IPO usage (when, what syscalls, UI hosting)
0b28221 feat(chassis,fa-asw): real FA → ASW via SWTASW
6738e92 feat(coder): top-level coding orchestrator
ce83ae8 feat(ecu-select): walk SGAUSWAHL_* to produce in-scope SG list
839652c feat(fa-asw): FA token string → ASW bit set
bbcf967 feat(chassis): chassis bundle loader with lazy CABD
ad9140d feat(cabd): CABD field decoder + encoder
68b9eeb feat(predicate): AUFTRAGSAUSDRUCK byte-coded evaluator
f9e146a feat(text-tables): parsers for SGFAM/AT/ZST/M00/ZUS
e087bd9 feat(pfl): typed PFL profile parser/serializer
522948e feat(daten): binary frame parser
ce7abd3 docs + workspace scaffold
```
