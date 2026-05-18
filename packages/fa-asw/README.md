# @emdzej/ncsx-fa-asw

Converts a user-facing **FA string** (Auftrag — the comma/space-separated list of factory
option codes like `"0205 0502 0524"`) into the **ASW bit set** that the
[`@emdzej/ncsx-predicate`](../predicate/) evaluator consumes to match `AUFTRAGSAUSDRUCK`
rows in `<BR>SGET.000` and `<BR>CVT.000`.

NCSEXPER equivalent: `coapiGetAswFromAuftrag` → `RecFncAsw`.

Spec: [`../../docs/ecu-selection.md` §3.3](../../docs/ecu-selection.md#33-step-3--fa--zcs--asw).

## Mental model

```
   FA string             AT records              SWTASW                ASW bit set
"$0902 $0524 $0205" ──→ ['SWA', 'CL', …] ──→  KEYID lookups   ──→  Set<u16>
                          (FSW names)            (per FSW)
```

1. Tokenise the FA string (whitespace / commas; strip `$` and category-letter prefixes).
2. Look each token up in `chassis.at` to get the FSW names it implies.
3. Look each FSW name up in `chassis.swtAsw` to get its u16 KEYID.
4. Optionally pull in additional Zwang (forced-inclusion) codes from `chassis.atM00`.

## Install

```bash
pnpm add @emdzej/ncsx-fa-asw
# or:
"@emdzej/ncsx-fa-asw": "workspace:*"
```

## Quick start

```ts
import { loadChassis } from '@emdzej/ncsx-chassis';
import { nodeChassisSource } from '@emdzej/ncsx-chassis/node';
import { faToAsw } from '@emdzej/ncsx-fa-asw';

const chassis = await loadChassis(nodeChassisSource('…/DATEN'), 'E46');
const asw = faToAsw('$0902 $0524 $0205', { chassis });
// asw is a Set<number> of u16 KEYIDs that the predicate evaluator consumes.

// Feed it to a predicate (typically via ecu-select, but you can call it directly):
import { evalAuftragsausdruck } from '@emdzej/ncsx-predicate';
evalAuftragsausdruck(predicateBytes, asw);
```

## API

| Export             | Purpose                                                          |
|--------------------|------------------------------------------------------------------|
| `faToAsw(fa, opts)` | The pipeline: FA string → ASW bit set                           |
| `tokenizeFa(fa)`   | Just the FA tokeniser (handy for UI input echo / validation)     |
| `aswFromIds(ids)`  | Build an `AswSet` directly from a list of KEYIDs                 |
| `AswSet`           | Type alias: `Set<number>`                                        |

### `faToAsw` options

```ts
faToAsw(fa, {
  chassis,                  // required — supplies AT + SWTASW + AT.M00
  strict: false,            // when true, throws on unknown FA codes / FSWs
  includeZwang: true,       // when true, add KEYIDs from AT.M00 Z records
  onWarning: (w) => { … },  // unknown FA code, unknown FSW, no SWT table, …
});
```

## FA-string syntax accepted

- Whitespace OR commas as separators: `"0902,0524,0205"` works the same as `"0902 0524 0205"`.
- Optional `$` prefix per token: `"$0902"` (matches the convention NCSEXPER's editor uses).
- Optional leading category letter: `"W0902"` is the same as `"0902"`.
- Leading zeros are tolerated — `"0205"` and `"205"` both resolve.

## Warnings

`onWarning` receives objects like:

- `{ kind: 'unknown-fa-code', code: '999', message: … }` — token not in `chassis.at`.
- `{ kind: 'unknown-fsw', fsw: 'GHOST', message: … }` — AT record references a FSW not in SWTASW.
- `{ kind: 'no-swt', message: … }` — chassis bundle has no SWTASW table loaded.

In `strict: true` mode each of these throws instead.

## What this *doesn't* do (yet)

- **ZCS → ASW** decoding. A car's ZCS (Zentral-Codier-Schlüssel) is another way of
  expressing FA; converting it requires the per-module ZCS decoder. Wait for a future
  `zcs-asw` package or do it yourself via `chassis.zcsut`.
- **FSW-keyword to ASW lookup.** The predicate's `S<id>` opcode references SA codes, not
  FSW IDs. If you want to test "is FSW SWA active?", use `chassis.zst` to find which SA
  codes contribute to that FSW, then check whether those SAs are in the ASW.

## Related

- [`@emdzej/ncsx-chassis`](../chassis/) — supplies the `AT` + `SWTASW` + `AT.M00` tables.
- [`@emdzej/ncsx-predicate`](../predicate/) — consumes the `AswSet` this produces.
- [`@emdzej/ncsx-ecu-select`](../ecu-select/) — most common downstream caller.
- Spec: [`../../docs/ecu-selection.md` §3.3](../../docs/ecu-selection.md#33-step-3--fa--zcs--asw).
