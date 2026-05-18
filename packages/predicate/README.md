# @emdzej/ncsx-predicate

Evaluator for the **byte-coded AUFTRAGSAUSDRUCK predicate** language used in NCSEXPER's
`<BR>SGET.000` `SGAUSWAHL_*` rows and `<BR>CVT.000` order-options. These predicates
encode "does this row apply to my car's FA?" in a compact byte language.

Spec: [`../../docs/ecu-selection.md` §6](../../docs/ecu-selection.md#6-auftragsausdruck--byte-coded-predicate-grammar).

## What it does

Takes a byte-coded predicate (a `Uint8Array`) and an **ASW bit set** (a `Set<number>` of
u16 SA IDs derived from the car's FA — see [`@emdzej/ncsx-fa-asw`](../fa-asw/)). Returns
`true` if the predicate's boolean expression evaluates to true under that ASW.

The grammar, after `S<id-lo><id-hi>` tokens are resolved to `0`/`1` based on whether the
ASW has the matching bit set:

```ebnf
expr     = and_term (',' and_term)*    ; OR
and_term = atom    ('+' atom)*          ; AND
atom     = '0' | '1' | '!'? '(' expr ')'
```

## Install

```bash
pnpm add @emdzej/ncsx-predicate
# or:
"@emdzej/ncsx-predicate": "workspace:*"
```

## Quick start

```ts
import { evalAuftragsausdruck } from '@emdzej/ncsx-predicate';

// `(SA_902 + SA_903) , SA_905` — "(902 AND 903) OR 905"
const predicate = new Uint8Array([
  0x28,                   // (
    0x53, 0x86, 0x03,      //   S 0x0386
    0x2b,                  //   +  (AND)
    0x53, 0x87, 0x03,      //   S 0x0387
  0x29,                   // )
  0x2c,                   // ,  (OR)
  0x53, 0x89, 0x03,       // S 0x0389
]);

evalAuftragsausdruck(predicate, new Set([0x0389])); // → true
evalAuftragsausdruck(predicate, new Set([0x0386])); // → false (need 0x0387 too)
```

## API

| Export                          | Purpose                                              |
|---------------------------------|------------------------------------------------------|
| `evalAuftragsausdruck(bytes, asw, opts?)` | Top-level: evaluate a predicate to `boolean` |
| `lexAuftragsausdruck(bytes, asw, opts?)`  | Lex-and-substitute: returns a flat `"0+(1,…)"` string |
| `evalExpression(flat)`          | Pure-string evaluator (mostly internal)              |
| `extractReferencedIds(bytes)`   | Find every `S<id>` reference (for static analysis)   |
| `PredicateError`                | Thrown on malformed bytes                            |

### Operators

| Byte | Symbol | Meaning                                                |
|------|--------|--------------------------------------------------------|
| `0x53` | `S`  | Reference an SA ID: `S<lo><hi>` → looks up u16 in ASW  |
| `0x28` / `0x29` | `(` `)` | Grouping                                      |
| `0x21` | `!`  | NOT (applies to the next atom)                         |
| `0x2b` | `+`  | AND                                                    |
| `0x2c` | `,`  | OR                                                     |
| `0x30` | `0`  | Literal `false`                                        |
| `0x31` | `1`  | Literal `true`                                         |

## When to reach for it

- You're walking `SGAUSWAHL_*` rows from `<BR>SGET.000` and need to know which apply.
  ([`@emdzej/ncsx-ecu-select`](../ecu-select/) already does this for you.)
- You're walking a CVT DATEN file and need to filter PSWs by the user's FA.
  ([`@emdzej/ncsx-options`](../options/) extracts these predicates per (FSW, PSW); then
  feed them through this evaluator.)
- You want to know what SA codes a row references without evaluating it
  (`extractReferencedIds`).

## Empty predicates

A zero-length `Uint8Array` evaluates to `true` — that's NCSEXPER's convention for "no
constraint, applies to all FAs". Worth knowing because most order-options rows you'll see
in real DATEN are empty.

## Related

- [`@emdzej/ncsx-fa-asw`](../fa-asw/) — produces the `AswBitSet` this evaluator consumes.
- [`@emdzej/ncsx-ecu-select`](../ecu-select/) — most common caller.
- [`@emdzej/ncsx-options`](../options/) — pairs predicates with their (FSW, PSW) target.
- Spec: [`../../docs/ecu-selection.md` §6](../../docs/ecu-selection.md#6-auftragsausdruck--byte-coded-predicate-grammar).
