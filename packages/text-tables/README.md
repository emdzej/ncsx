# @emdzej/ncsx-text-tables

Parsers for the **text-format** files under `NCSEXPER/DATEN/`:

| File                      | Parser           | Purpose |
|---------------------------|------------------|---------|
| `<BR>SGFAM.DAT`           | `parseSgfam`     | Logical SG short-name → `(CABD, SGBD, ZCS-flag, FA-flag)` |
| `<BR>AT.000`              | `parseAt`        | FA-token dictionary: type-letter + code + FSWs |
| `<BR>AT.M00`              | `parseAtM00`     | Compact M-list (Z / E / W / S category records) |
| `<BR>AT.ZUS`              | `parseAtZus`     | AT companion (same lexical form, mostly change log) |
| `<BR>ZST.000`             | `parseZst`       | SA-bit / ASW-bit / FA-bit master table with masks + FSW keywords |

Spec: [`../../docs/daten-format.md` §2](../../docs/daten-format.md#2-text-table-format).

Encoding: ISO-8859-1 (Latin-1). Pass the file contents decoded as Latin-1, e.g.:

```ts
const raw = readFileSync(path, 'latin1');
```
