# @emdzej/ncsx-property-formulas

Per-FSW **property-value decoders**, ported from NCS Dummy's
[`Classes/Formulas/Formulas.cs`](../../../ncsx-research/ncsdummy-src/NcsDummy/Classes/Formulas/Formulas.cs)
(1982 lines, 1055 `case` arms across 149 distinct formula bodies).

This is the layer that turns raw CABD bytes like `00100000` into the human-readable
`"32 km/h"` you see in NCS Dummy's details pane. It's purely a display aid — the canonical
decode for coding purposes goes through `@emdzej/ncsx-cabd` (OPERATION + EINHEIT). This
package adds the community-curated unit/format knowledge that CABD alone doesn't carry.

See [`../../docs/ncsdummy-analysis.md` §5](../../docs/ncsdummy-analysis.md) for how it fits
into NCS Dummy's rendering pipeline.

## Install

```bash
pnpm add @emdzej/ncsx-property-formulas
# or:
"@emdzej/ncsx-property-formulas": "workspace:*"
```

## Quick start

```ts
import { formatValue } from '@emdzej/ncsx-property-formulas';

const human = formatValue({
  chassis: 'E60',
  module: 'KMBI_E60',
  codingIndex: 0x06,
  keyword: 'LENK_UEBERSETZUNG',
  mask: Uint8Array.from([0xff]),
  data: Uint8Array.from([0x32]),  // 50
});
// → "10"   (LENK_UEBERSETZUNG = data / 5)
```

Returns `null` when the keyword has no formula or when chassis/module/data is missing.
Returns `"?"` when a formula matches but the data buffer is empty.

## API

| Export                      | Purpose                                                  |
|-----------------------------|----------------------------------------------------------|
| `formatValue(ctx)`          | Top-level — keyword → human-readable value (or null)     |
| `FORMULAS`                  | The raw `Map<keyword, Formula>` if you want to iterate   |
| `Formula` / `FormulaContext`| Types for callers that want to register custom formulas  |
| `getFloat` / `getFloat0_128` / `getFloatNeg128` / `getFloatNeg8` | Byte-folding helpers (faithful to NCS Dummy) |
| `printNumber`               | C# `G4`-style formatter                                   |
| `getString` / `reverse` / `invert` / `pow` | Other helpers                            |

## How the port was made

The 1055 case arms are too many to hand-translate. `scripts/port-formulas.py` (in this
repo's history; the latest output lives at `src/formulas.ts`) does a brace-balanced
extraction of the outer `switch (keyword) {…}` and emits one
`reg([keys…], (ctx) => { … })` per group via a regex-driven rewriter:

| C#                                | TS                                |
|-----------------------------------|-----------------------------------|
| `data` / `mask` / `chassis` / `module` | `ctx.data` / `ctx.mask` / …  |
| `PrintNumber(x)` / `GetFloat(x)`  | `printNumber(x)` / `getFloat(x)`  |
| `data == null \|\| data.Length == 0` | `ctx.data.length === 0`        |
| `data.Length`                     | `ctx.data.length`                 |
| `1f` / `2.5d` (numeric suffix)    | `1` / `2.5`                       |
| `(int)x` (explicit cast)          | `x`                               |
| `string.IsNullOrEmpty(x)`         | `!x`                              |
| `byte.MaxValue` etc.              | `0xff` etc.                       |
| `new byte[N] { a, b, c }` (multi-line) | `Uint8Array.from([a, b, c])` |

Anything the rewriter couldn't translate cleanly would fail to compile — the package
currently builds clean, so all 149 groups round-tripped.

## Caveats

- **Not coding-canonical.** These are display heuristics. For actual byte ↔ value coding
  use `@emdzej/ncsx-cabd`'s `decodeField`/`encodeField`, which run OPERATION + EINHEIT.
- **No fallback chassis logic.** When NCS Dummy's case has a nested `switch (module) {…}`
  with a `default: return null;`, our port returns `null` for unmatched modules — same
  behaviour, but means many formulas are intentionally chassis/module-gated.
- **Community-curated.** Some cases have known quirks copied verbatim (e.g. magic
  constants like `data * 18f / 4095f` for voltage divider readings).

## Related

- [`@emdzej/ncsx-cabd`](../cabd/) — OPERATION + EINHEIT pipeline; canonical numeric decode.
- [`@emdzej/ncsx-function-list`](../function-list/) — the catalog whose `property` items
  use this for display.
- [`@emdzej/ncsx-translations`](../translations/) — keyword → English; the other half of
  NCS Dummy's rendering.
