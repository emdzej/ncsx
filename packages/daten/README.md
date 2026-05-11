# @emdzej/ncsx-daten

Parser for BMW **NCSEXPER DATEN** binary-frame files:

- `BR_REF.DAT` — chassis index
- `<BR>SGET.000` / `<BR>SGVT.000` / `<BR>ZCSUT.000` / `<BR>DST.000` / `<BR>CVT.000` — per-chassis tables
- `<SGBD>.Cxx` — per-SG CABD coding files
- `<BR>AUSBL.H00`, `<BR>AT.K00`, `VARIABLE.DAT`, `*_CONF.BAP` — auxiliary binary tables

Format spec: [`../../docs/daten-format.md`](../../docs/daten-format.md).

This package replaces (and fixes the bugs in) the original `bimmerz/packages/ncs-data` POC. Concrete delta vs. that POC: [`../../docs/POC-DELTAS.md`](../../docs/POC-DELTAS.md).

## Quick start

```ts
import { readFileSync } from 'node:fs';
import { parseDatenFile } from '@emdzej/ncsx-daten';

const buf = readFileSync('NCSEXPER/DATEN/BR_REF.DAT');
const file = parseDatenFile(buf);

for (const block of file.blocks) {
  console.log(block.id.toString(16), block.name);
  for (const row of block.rows) {
    console.log('  ', row);
  }
}
```

## Frame format (1-page primer)

```
struct frame {
  uint8_t  size;                 // payload length
  uint16_t type;                 // u16 little-endian
  uint8_t  payload[size];
  uint8_t  crc;                  // XOR-fold of [size, type_lo, type_hi, payload]
};
```

Frame types: `0x0100`/`0x0200` (signatures), `0x0300` (block id + name), `0x0400` (format), `0x0500` (field names), `0xFF00` (divider), anything else = data row for the matching block id.

Format-string mini-language: scalars `B` `W` `L` `S` `A` (OPERATION — see §1.7 of the spec), with modifiers `{X}` (optional), `(X)` (collection), `X(X)` (non-empty list), `XX(XX)` (range list).
