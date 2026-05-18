# @emdzej/ncsx-text-tables

Parsers for the **text-format** companion files NCSEXPER ships alongside its binary DATEN
files under `C:\NCSEXPER\DATEN\<BR>\`. These are all line-oriented, ISO-8859-1, with their
own legacy syntax conventions (semicolon-prefixed data rows, positional whitespace
columns, etc.).

Spec: [`../../docs/daten-format.md` §2](../../docs/daten-format.md#2-text-table-format).

## Files parsed

| File                  | Parser            | Purpose                                                    |
|-----------------------|-------------------|------------------------------------------------------------|
| `<BR>SGFAM.DAT`       | `parseSgfam`      | Logical SG short-name → `(CABD, SGBD, ZCS-flag, FA-flag)`  |
| `<BR>AT.000`          | `parseAt`         | FA-token dictionary: type-letter + code + FSW list         |
| `<BR>AT.M00`          | `parseAtM00`      | Compact M-list (Z / E / W / S category records)            |
| `<BR>AT.ZUS`          | `parseAtZus`      | AT companion (same lexical form, mostly change log)        |
| `<BR>ZST.000`         | `parseZst`        | SA-bit / ASW-bit / FA-bit master with masks + FSW keywords |

## Install

```bash
pnpm add @emdzej/ncsx-text-tables
# or:
"@emdzej/ncsx-text-tables": "workspace:*"
```

**Encoding matters.** These files are Latin-1, not UTF-8. Decode accordingly:

```ts
const raw = readFileSync(path, 'latin1');
```

## Quick start

```ts
import { readFileSync } from 'node:fs';
import {
  parseSgfam,
  parseAt,
  parseAtM00,
  parseZst,
} from '@emdzej/ncsx-text-tables';

const root = '/Users/me/NCSEXPER/DATEN/e46';

const sgfam = parseSgfam(readFileSync(`${root}/E46SGFAM.DAT`, 'latin1'));
console.log(sgfam.rows.find((r) => r.sgName === 'EWS'));
// { sgName: 'EWS', cabd: 'A_EWS3', sgbd: 'C_EWS3', zcsFlag: …, faFlag: … }

const at = parseAt(readFileSync(`${root}/E46AT.000`, 'latin1'));
const w502 = at.records.find((r) => r.category === 'W' && r.code === '502');
console.log(w502?.fsws);   // ['SWA', …] — FSWs implied by FA code 502

const zst = parseZst(readFileSync(`${root}/E46ZST.000`, 'latin1'));
console.log(zst.records.filter((r) => r.fsw === 'DAUERTON').length);
```

## API

| Export                | Returns                                       |
|-----------------------|-----------------------------------------------|
| `parseSgfam(text)`    | `SgfamFile { rows: SgfamRow[] }`              |
| `parseAt(text)`       | `AtFile { records: AtRecord[] }`              |
| `parseAtM00(text)`    | `AtM00File { entries: AtM00Entry[] }`         |
| `parseAtZus(text)`    | Same shape as `parseAt`                       |
| `parseZst(text)`      | `ZstFile { header, records, unparsed }`       |
| `iterLines(text)`     | Low-level line iterator (handles comments)    |
| `tokens(line)`        | Whitespace-tokenise a row line                |

## Key concepts

### SGFAM — the SG family table

Per-SG declaration:

- `sgName` — logical short name like `EWS`, `KMB`, `LSZ_E46`
- `cabd` — coding-bundle DATEN file name to load (e.g. `A_EWS3` → opens `A_EWS3.C07`)
- `sgbd` — EDIABAS SGBD file the cable speaks (e.g. `C_EWS3`)
- `zcsFlag` / `faFlag` — whether this SG participates in ZCS / FA scopes

### AT — FA token dictionary

Each record is `(category, code, fsws[])`:

- `category` — one of `W` (Werks-/order option), `Z` (Zwang/forced), `E` (Entfall/excluded),
  `S` (Sonderfall/special)
- `code` — 4-digit short code, e.g. `0205`
- `fsws[]` — function-keyword names this FA code implies (used by `fa-asw` to build the
  ASW bit set)

### AT.M00 — compact M-list

A variant of AT used for chassis-wide forced-inclusion rules. `parseAtM00` exposes the same
`(category, code, fsws[])` shape.

### ZST — the master SA/FA/FSW table

The grand reference for SA/VN/FA-code ↔ ASW-bit-mask + FA-bit-mask + FSW keyword.
Notably, the file format uses lines that start with `;` to look like comments to legacy
editors, but the parser knows to treat them as data when they match the right shape.

## Related

- [`@emdzej/ncsx-chassis`](../chassis/) — loads + indexes all of these into a `Chassis` bundle.
- [`@emdzej/ncsx-fa-asw`](../fa-asw/) — uses `parseAt` output to map FA strings → ASW bit set.
- Spec: [`../../docs/daten-format.md` §2](../../docs/daten-format.md#2-text-table-format).
