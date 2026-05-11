# @emdzej/ncsx-predicate

Evaluator for the **byte-coded AUFTRAGSAUSDRUCK predicate** language used in NCSEXPER's `<BR>SGET.000` rows.

Spec: [`../../docs/ecu-selection.md` §6](../../docs/ecu-selection.md#6-auftragsausdruck--byte-coded-predicate-grammar).

The grammar (after `S<id-lo><id-hi>` tokens are resolved to `0`/`1`):

```ebnf
expr     = and_term (',' and_term)*    ; OR
and_term = atom    ('+' atom)*          ; AND
atom     = '0' | '1' | '!'? '(' expr ')'
```

## Quick start

```ts
import { evalAuftragsausdruck } from '@emdzej/ncsx-predicate';

const predicate = new Uint8Array([
  0x28,                   // (
    0x53, 0x86, 0x03,      //   S 0x0386  — SA bit id 902
    0x2b,                  //   AND (+)
    0x53, 0x87, 0x03,      //   S 0x0387  — SA bit id 903
  0x29,                   // )
  0x2c,                   // OR (,)
  0x53, 0x89, 0x03,       // S 0x0389  — SA bit id 905
]);

const asw = new Set([0x0389]);  // FA-derived ASW bit set
const result = evalAuftragsausdruck(predicate, asw);
console.log(result); // true
```
