# @emdzej/ncsx-daten

Parser for BMW **NCSEXPER DATEN binary-frame files** — the format every chassis-table,
SG-coding, and lookup file under `C:\NCSEXPER\DATEN\` is encoded in.

This is the foundational package in the ncsx stack: every higher-level package
(`chassis`, `cabd`, `function-list`, `options`, …) takes a parsed `DatenFile` as input.

Full format spec: [`../../docs/daten-format.md`](../../docs/daten-format.md).
Concrete delta vs. the original `bimmerz/packages/ncs-data` POC:
[`../../docs/POC-DELTAS.md`](../../docs/POC-DELTAS.md).

## File types this parses

| File pattern               | What it is                                                    |
|----------------------------|---------------------------------------------------------------|
| `BR_REF.DAT`               | Chassis index — list of supported chassis + aliases           |
| `<BR>DST.000`              | Per-chassis dataset overview (e.g. `E46DST.000`)              |
| `<BR>SGET.000`             | SG-list selectors with `SGAUSWAHL_*` and AUFTRAGSAUSDRUCK     |
| `<BR>SGVT.000`             | SG variants                                                   |
| `<BR>ZCSUT.000`            | ZCS update tables                                             |
| `<BR>CVT.000`              | Coding variants (per-FSW order-option predicates)             |
| `<SGBD>.Cxx`               | Per-SG CABD coding rules (`PARZUWEISUNG_FSW` + PSWs etc.)     |
| `SWT<KIND><NN>.DAT`        | Keyword↔KEYID lookup tables (ASW/FSW/PSW)                     |
| `<BR>AUSBL.H00`, `*.K00`   | Auxiliary binary tables                                       |

## Install

```bash
pnpm add @emdzej/ncsx-daten
# or, in the ncsx monorepo:
"@emdzej/ncsx-daten": "workspace:*"
```

## Quick start

```ts
import { readFileSync } from 'node:fs';
import { parseDatenFile } from '@emdzej/ncsx-daten';

const buf = readFileSync('NCSEXPER/DATEN/BR_REF.DAT');
const file = parseDatenFile(buf);

for (const block of file.blocks) {
  console.log(`block 0x${block.id.toString(16)} ${block.name}`);
  for (const row of block.rows) {
    console.log('  ', row);
  }
}
```

## Frame format (one-page primer)

```
struct frame {
  uint8_t  size;                 // payload length in bytes
  uint16_t type;                 // u16 little-endian
  uint8_t  payload[size];
  uint8_t  crc;                  // XOR-fold of [size, type_lo, type_hi, payload]
};
```

| Frame type | Meaning                                                |
|------------|--------------------------------------------------------|
| `0x0100`   | Signature 1                                            |
| `0x0200`   | Signature 2                                            |
| `0x0300`   | Block definition — id + name                           |
| `0x0400`   | Block definition — format string                       |
| `0x0500`   | Block definition — field names (comma-separated)       |
| `0xFF00`   | Divider — end of definitions, start of data            |
| any other  | Data row for the block whose id matches the frame type |

Format-string mini-language: scalars `B` (u8) `W` (u16 LE) `L` (u32 LE) `S` (ASCII+NUL) `A`
(length-prefixed raw bytes), with modifiers `{X}` (optional u8 presence), `(X)` (u16-count
collection), `X(X)` (non-empty list), `XX(XX)` (range list).

## API

| Export                  | Purpose                                                        |
|-------------------------|----------------------------------------------------------------|
| `parseDatenFile(buf)`   | Two-pass parse: definitions then data rows                     |
| `parseFormatString(s)`  | Just the format-string mini-language                           |
| `readScalar(type, …)`   | Read one scalar value from a payload                           |
| `readRow(fields, payload)` | Read one row's worth of values                              |
| `xorFoldCrc(bytes)`     | The DATEN per-frame CRC (XOR-fold of header + payload)         |

### `DatenFile` shape

```ts
interface DatenFile {
  signatures: { type: number; payload: Uint8Array }[];
  blocks: Block[];
  /** All data rows in document order — same row objects as `block.rows`. */
  rowsInOrder: OrderedRow[];
}

interface Block {
  id: number;
  name: string;       // e.g. "PARZUWEISUNG_FSW"
  fields: FieldDef[]; // declared columns
  rows: RowValues[];  // one entry per data frame for this block
}
```

`rowsInOrder` exists because some consumers (`function-list`, `options`) need
cross-block adjacency — e.g. `PARZUWEISUNG_PSW1` always follows its parent
`PARZUWEISUNG_FSW` in the binary, and that ordering is lost if you only walk
`block.rows`.

## Options

```ts
parseDatenFile(buf, {
  strictCrc: false,        // default true — when false, mismatched frames are skipped
  onWarning: (msg) => { … }, // CRC mismatch, malformed format string, unknown frame type
});
```

## Related

- [`@emdzej/ncsx-cabd`](../cabd/) — operates on `PARZUWEISUNG_FSW` row values from this parser.
- [`@emdzej/ncsx-chassis`](../chassis/) — loads + indexes whole chassis bundles.
- [`@emdzej/ncsx-function-list`](../function-list/) — turns a CABD `.Cxx` into a typed catalog.
- [`@emdzej/ncsx-predicate`](../predicate/) — evaluates the `A`-field AUFTRAGSAUSDRUCK bytes.
- Spec: [`../../docs/daten-format.md`](../../docs/daten-format.md).
