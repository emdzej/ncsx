# @emdzej/ncsx-pfl

Typed parser + serializer for NCSEXPER `.pfl` **profile** files — the INI-style configs
that live under `C:\NCSEXPER\PFL\` and that NCS Expert's "Load profile" menu picks up.
Best known is `REVTOR.PFL`, the community profile that enables `CODIERDATEN_LESEN` and a
few other expert-mode options.

Spec: [`../../docs/pfl-format.md`](../../docs/pfl-format.md).

## What it does

- Reads a `.pfl` text body into a typed `PflProfile` object (one TypeScript field per
  documented INI key, with enums / numbers / booleans coerced correctly).
- Bounds-checks Lesemodus and similar value-range enums.
- Preserves opaque fields like `ProfilPruefsumme` as hex strings (the loader doesn't
  verify it, and we don't either — see "Why no checksum?" below).
- Round-trips byte-stable for unmodified profiles: section order, key order, and value
  formatting all match what NCSEXPER itself writes.

## Install

```bash
pnpm add @emdzej/ncsx-pfl
# or:
"@emdzej/ncsx-pfl": "workspace:*"
```

## Quick start

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parsePfl, serializePfl } from '@emdzej/ncsx-pfl';

const raw = readFileSync('NCSEXPER/PFL/Expertenmodus.pfl', 'latin1');
const profile = parsePfl(raw);

console.log(profile.header.bezeichnung);          // "Expertenmodus 2.0"
console.log(profile.coding.fktSgCodieren);        // true
console.log(profile.fgnrZcs.fgNrEingabeModus);    // 1

// Modify a knob and write back:
profile.coding.fktCodierdatenLesen = true;
writeFileSync('out.pfl', serializePfl(profile), 'latin1');
```

## Profile sections

| Section          | Type field           | What it controls                                     |
|------------------|----------------------|------------------------------------------------------|
| `[KOPF]`         | `PflHeader`          | Profile name / version / description                |
| `[FGNR_ZCS]`     | `PflFgnrZcs`         | How VIN / ZCS / FA is sourced                       |
| `[SGET]`         | `PflSget`            | SG-list filter overrides                            |
| `[APPLIKATION]`  | `PflApplikation`     | UI defaults (which tab opens first, etc.)           |
| `[CODIERUNG]`    | `PflCoding`          | Which jobs are enabled (CODIERDATEN_LESEN!)         |
| `[ASW]`          | `PflAsw`             | ASW-edit dialog defaults                            |
| `[FSWPSW]`       | `PflFswPsw`          | FSW/PSW-edit dialog defaults, Lesemodus enum        |
| `[NETTODATEN]`   | `PflNettodaten`      | Nettodata-edit dialog defaults                      |
| `[INDIVID]`      | `PflIndivid`         | Individual-coding flags                             |
| `[VERIFIKATION]` | `PflVerifikation`    | `.ssd` script reference                             |

## API

| Export             | Purpose                                            |
|--------------------|----------------------------------------------------|
| `parsePfl(text)`   | Parse a `.pfl` body to a `PflProfile`              |
| `serializePfl(p)`  | Serialize a `PflProfile` back to `.pfl` text       |
| `PflProfile`       | The top-level type (re-exports all section types)  |

### `parsePfl` options

```ts
parsePfl(raw, {
  onWarning: (w: PflWarning) => { /* unknown section, out-of-range value, … */ },
  strict: false, // default — warn rather than throw on unknown sections
});
```

## Why no checksum?

`ProfilPruefsumme` is parsed and preserved verbatim. NCSEXPER's profile loader doesn't
verify it (confirmed via Ghidra against NCSEXPER 4.0.1's `coapiLoadProfil` — see
[`docs/pfl-format.md`](../../docs/pfl-format.md) for the reverse-engineering notes). If
you want to round-trip-edit a profile and have NCSEXPER load it, you don't need to touch
the checksum.

If you want to mint a fresh profile programmatically, the checksum write-path is still
open. The community workaround is to copy an existing profile and edit the keys you care
about.

## Related

- [`@emdzej/inpax-ini-parser`](../../../inpax/packages/ini-parser/) — underlying INI parse.
- Spec: [`../../docs/pfl-format.md`](../../docs/pfl-format.md).
