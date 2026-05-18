# @emdzej/ncsx-ecu-select

Given a chassis bundle and the car's ASW bit set, returns the list of SGs (ECUs) that are
in scope — the ones whose `AUFTRAGSAUSDRUCK` predicate matches.

This is **step 2 of the coding flow**: before you can code or read any SG, you need to
know which SGs the car actually has. NCS Expert calls this "Process ECU" and walks the
same `SGAUSWAHL_*` blocks in the same order; this package is the deterministic equivalent.

NCSEXPER equivalent: `coapiScanAllSgFromBr` (with `coapiScanAllSgFromZcs` being the same
function fed by a different ASW source).

Spec: [`../../docs/ecu-selection.md` §3.4](../../docs/ecu-selection.md#34-step-4--sget-driven-enumeration-the-matcher).

## What it does

Walks the three `SGAUSWAHL_*` blocks of `<BR>SGET.000` in most-specific-first order:

1. **`SGAUSWAHL_VMSGBD`** — variant + module-variant + SGBD-specific rows.
2. **`SGAUSWAHL_SGBD`** — module-variant + SGBD-specific rows.
3. **`SGAUSWAHL_VM`** — variant-only fallback.

For each row, evaluates the `AUFTRAGSAUSDRUCK` byte-coded predicate against the supplied
`AswSet` (via [`@emdzej/ncsx-predicate`](../predicate/)). Matching rows are returned as a
`SelectedSg[]` with the resolved `(sgName, cabd, sgbd, …)` tuple.

By default, deduplicates by `sgName` so the most-specific row wins for each SG.

## Install

```bash
pnpm add @emdzej/ncsx-ecu-select
# or:
"@emdzej/ncsx-ecu-select": "workspace:*"
```

## Quick start

```ts
import { loadChassis } from '@emdzej/ncsx-chassis';
import { nodeChassisSource } from '@emdzej/ncsx-chassis/node';
import { faToAsw } from '@emdzej/ncsx-fa-asw';
import { selectEcus } from '@emdzej/ncsx-ecu-select';

const chassis = await loadChassis(nodeChassisSource('…/DATEN'), 'E46');
const asw = faToAsw('0205 0502 0524', { chassis });
const selected = selectEcus(chassis, asw);

for (const sg of selected) {
  console.log(`${sg.source}  ${sg.sgName}  CBD=${sg.cbd}  CABD=${sg.cabd}  SGBD=${sg.sgbd}`);
}
```

## API

| Export                     | Purpose                                                |
|----------------------------|--------------------------------------------------------|
| `selectEcus(chassis, asw, opts?)` | Walk `SGAUSWAHL_*` and return matched SGs       |
| `SelectedSg`               | One row in the result                                  |
| `SelectionSource`          | `'VMSGBD' \| 'SGBD' \| 'VM'` — which block matched     |

### `SelectedSg`

```ts
interface SelectedSg {
  sgName: string;       // logical SG short name (matches SGFAM)
  cbd: string;          // CBD coding bundle name
  cabd?: string;        // CABD coding module name (omitted for VM rows)
  sgbd?: string;        // EDIABAS SGBD file (omitted for VM rows)
  umrsg: string;        // conversion-SG hint
  vmg?: string;         // module-variant (omitted for SGBD rows)
  index: number | null;
  source: SelectionSource;  // which SGAUSWAHL_* block this came from
}
```

### `selectEcus` options

```ts
selectEcus(chassis, asw, {
  dedupeBySgName: true,         // most-specific row wins per SG (default true)
  maxPredicateLength: 100,      // skip predicates longer than this (safety)
  onWarning: (msg) => { … },    // surface skip reasons (rare; mostly malformed predicates)
});
```

## When to reach for it

- Building a "Pick a module" UI — feed `selected` into a list.
- Driving a multi-SG batch operation (planCoding does this internally).
- Debugging "why isn't NCS Expert seeing my module?" — compare `selectEcus` output against
  what NCS Expert lists for your VIN.

## Tie-breaker semantics

When `dedupeBySgName: true` (the default):

- The walk order is most-specific → least-specific (VMSGBD → SGBD → VM).
- The first `(sgName)` to match wins; subsequent rows for the same SG are skipped.
- This matches NCSEXPER's behaviour: a VMSGBD-specific override beats a VM fallback.

Set `dedupeBySgName: false` if you want every matching row (e.g. for diagnostic
"why didn't my preferred row match?" exploration).

## Related

- [`@emdzej/ncsx-chassis`](../chassis/) — supplies the `SGET.000` data.
- [`@emdzej/ncsx-fa-asw`](../fa-asw/) — produces the `AswSet` this consumes.
- [`@emdzej/ncsx-predicate`](../predicate/) — used to evaluate each row's `AUFTRAGSAUSDRUCK`.
- [`@emdzej/ncsx-coder`](../coder/) — top-level orchestrator that calls this internally.
- Spec: [`../../docs/ecu-selection.md`](../../docs/ecu-selection.md).
