# @emdzej/ncsx-options

Reads a chassis-level **CVT DATEN file** (`<BR>CVT.000`) and emits an `OptionList` —
per-(FSW, PSW) byte-coded AUFTRAGSAUSDRUCK predicates that tell the UI **which PSWs are
applicable under which FAs**.

This is the data backing the "✓ in FA / ⚠ not in FA" badges next to each PSW in the
friendly checkbox editor. Pair with [`@emdzej/ncsx-predicate`](../predicate/) to evaluate
each predicate against the car's FA.

Mirrors NCS Dummy's `Classes/Options/OptionListReader`. Design notes:
[`../../docs/ncsdummy-analysis.md` §3.3](../../docs/ncsdummy-analysis.md).

## What it does

Walks the CVT DATEN file's rows in document order:

- An `AUFTRAGSAUSDRUCK` row stashes its predicate bytes.
- The **immediately-following** `FSW_PSW` row consumes that predicate and binds it to
  its `(FSW, PSW)` target.
- If multiple AUFTRAGSAUSDRUCK fragments accumulate for the same `(FSW, PSW)` pair (a
  legitimate CVT pattern), they're comma-joined into one OR-of-conjunctions blob.
- `GRUPPE` / `INDIVID` boundary rows toggle scope; by default only group-scope rows
  are surfaced (per NCS Dummy convention — individual-mode coding isn't part of order
  options).

## Install

```bash
pnpm add @emdzej/ncsx-options
# or:
"@emdzej/ncsx-options": "workspace:*"
```

## Quick start

```ts
import { readFileSync } from 'node:fs';
import { parseDatenFile } from '@emdzej/ncsx-daten';
import { buildOptionList } from '@emdzej/ncsx-options';
import { evalAuftragsausdruck } from '@emdzej/ncsx-predicate';
import { faToAsw } from '@emdzej/ncsx-fa-asw';

const cvt = parseDatenFile(readFileSync('E46CVT.000'));
const opts = buildOptionList(cvt);

const asw = faToAsw('0205 0502 0524', { chassis });

for (const fn of opts.functions) {
  for (const p of fn.parameters) {
    const applicable =
      p.predicate.length === 0
        ? true
        : evalAuftragsausdruck(p.predicate, asw);
    console.log(`FSW=${fn.fsw} PSW=${p.psw} ${applicable ? '✓' : '⚠'}`);
  }
}
```

## API

| Export                | Purpose                                                       |
|-----------------------|---------------------------------------------------------------|
| `buildOptionList(cvt, opts?)` | Walk a parsed CVT `DatenFile` → `OptionList`          |
| `OptionList`          | Top-level result — `{ functions: OptionFunction[] }`          |
| `OptionFunction`      | One FSW's options: `{ fsw, parameters: OptionParameter[] }`   |
| `OptionParameter`     | One PSW's predicate: `{ psw, predicate: Uint8Array }`         |
| `OptionListError`     | Thrown on malformed rows                                      |

### `buildOptionList` options

```ts
buildOptionList(cvt, {
  // When true (default), rows inside INDIVID scope are skipped. Set false if you want
  // to surface individual-mode options too (rare; typically used for car-and-key memory
  // edits).
  groupScopeOnly: true,
});
```

## Predicate encoding

The `predicate` byte arrays are AUFTRAGSAUSDRUCK in the same byte-coded language used by
`<BR>SGET.000` rows. Evaluate them via [`@emdzej/ncsx-predicate`](../predicate/):

```ts
import { evalAuftragsausdruck, extractReferencedIds } from '@emdzej/ncsx-predicate';

const applies = evalAuftragsausdruck(param.predicate, asw);
const sasMentioned = extractReferencedIds(param.predicate); // for tooltips
```

An **empty `predicate`** means "always applicable" — no FA constraint on this PSW. Most
basic on/off PSWs (`aktiv`, `nicht_aktiv`) have empty predicates; the gating predicates
mostly live on country variants, special-equipment options, and version-specific values.

## When multiple fragments accumulate

CVT files sometimes list the same `(FSW, PSW)` pair more than once, each preceded by a
different AUFTRAGSAUSDRUCK fragment. NCS Dummy treats that as an OR of the fragments and
comma-joins them; this package matches that convention. The joined byte sequence is still
a valid AUFTRAGSAUSDRUCK and evaluates correctly through the standard predicate
evaluator.

## Related

- [`@emdzej/ncsx-daten`](../daten/) — required input. Parses the CVT DATEN file.
- [`@emdzej/ncsx-predicate`](../predicate/) — evaluates the produced predicate bytes.
- [`@emdzej/ncsx-fa-asw`](../fa-asw/) — produces the `AswSet` the predicate consumes.
- [`@emdzej/ncsx-function-list`](../function-list/) — the catalog this layer annotates.
- Design: [`../../docs/ncsdummy-analysis.md` §3.3](../../docs/ncsdummy-analysis.md).
