# @emdzej/ncsx-ecu-select

ECU-selection driver for a chassis bundle.

Given a `Chassis` (from [`@emdzej/ncsx-chassis`](../chassis/)) and an `ASW` bit set (from
[`@emdzej/ncsx-fa-asw`](../fa-asw/)), walks the three `SGAUSWAHL_*` blocks of `<BR>SGET.000`
in most-specific-first order:

1. `SGAUSWAHL_VMSGBD` — variant + module variant + SGBD specific.
2. `SGAUSWAHL_SGBD`   — module variant + SGBD specific.
3. `SGAUSWAHL_VM`     — variant-only fallback.

For each row, evaluates the `AUFTRAGSAUSDRUCK` byte-coded predicate against the ASW (via
[`@emdzej/ncsx-predicate`](../predicate/)). Matching rows are returned as a `SelectedSg[]`.

NCSEXPER equivalent: `coapiScanAllSgFromBr` (with `coapiScanAllSgFromZcs` being the same
function fed by a different ASW source).

## Quick start

```ts
import { loadChassis, nodeChassisSource } from '@emdzej/ncsx-chassis';
import { faToAsw } from '@emdzej/ncsx-fa-asw';
import { selectEcus } from '@emdzej/ncsx-ecu-select';

const chassis = await loadChassis(nodeChassisSource('…/DATEN'), 'E46');
const asw = faToAsw('0205 0502 0524');
const selected = selectEcus(chassis, asw);

for (const sg of selected) {
  console.log(`${sg.source}  ${sg.sgName}  CBD=${sg.cbd}  CABD=${sg.cabd}  SGBD=${sg.sgbd}`);
}
```

## Spec

- [`../../docs/ecu-selection.md` §3.4](../../docs/ecu-selection.md#34-step-4--sget-driven-enumeration-the-matcher)
  for the walk order + tie-breaker semantics.
- [`../../docs/daten-format.md` §1.9](../../docs/daten-format.md) for `<BR>SGET.000` field
  layout.
