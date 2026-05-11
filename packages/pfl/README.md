# @emdzej/ncsx-pfl

Parser and serializer for NCSEXPER `.pfl` **profile** files.

Spec: [`../../docs/pfl-format.md`](../../docs/pfl-format.md).

## Quick start

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parsePfl, serializePfl } from '@emdzej/ncsx-pfl';

const raw = readFileSync('NCSEXPER/PFL/Expertenmodus.pfl', 'latin1');
const profile = parsePfl(raw);

console.log(profile.header.bezeichnung);          // "Expertenmodus 2.0"
console.log(profile.coding.fktSgCodieren);        // true
console.log(profile.fgnrZcs.fgNrEingabeModus);    // 1

// Round-trip:
writeFileSync('out.pfl', serializePfl(profile), 'latin1');
```

## What it does

- INI parse via [`@emdzej/inpax-ini-parser`](../../../inpax/packages/ini-parser/).
- Bounds-checks Lesemodus and similar enums per the loader's spec in [`docs/pfl-format.md`](../../docs/pfl-format.md).
- Preserves `ProfilPruefsumme` as an opaque hex string (Ghidra confirmed the checksum isn't recomputed on load/save).
- Round-trips byte-stable for unmodified profiles — section order, key order and value formats match what NCSEXPER itself writes.

## What it doesn't do

- Compute `ProfilPruefsumme` from scratch — the editor write-path is still TBD (see open items in [`docs/README.md`](../../docs/README.md#status)).
- Validate `.ssd` references in `[VERIFIKATION].SteuerFileName` (file existence, schema).
