# @emdzej/ncsx-function-list

Typed **module catalog** builder. Walks a parsed CABD `.Cxx` `DatenFile` (from
[`@emdzej/ncsx-daten`](../daten/)) and emits a `FunctionList` — a strongly-typed array of
`function` / `property` / `unoccupied` / `group` items.

This is the **catalog layer** the friendly UI renders. Mirrors NCS Dummy's
`Classes/Functions/FunctionListReader`. Design notes:
[`../../docs/ncsdummy-analysis.md` §3.1](../../docs/ncsdummy-analysis.md).

## Item kinds

| Kind         | DATEN blocks consumed                              | Notes                                  |
|--------------|----------------------------------------------------|----------------------------------------|
| `function`   | `PARZUWEISUNG_FSW` + `PARZUWEISUNG_PSW1` + `PSW2`  | Enumerated FSW with a list of PSWs    |
| `property`   | `PARZUWEISUNG_DIR`                                 | Value computed via OPERATION + EINHEIT |
| `unoccupied` | `UNBELEGT1` + optional `UNBELEGT2`                 | Default bytes the SG doesn't code     |
| `group`      | `CODIERDATENBLOCK` / `HERSTELLERDATENBLOCK` / `RESERVIERTDATENBLOCK` | UI grouping headers |

Plus the catalog as a whole carries metadata from the singleton blocks:

| Field              | DATEN block             | What it tells you                                 |
|--------------------|-------------------------|---------------------------------------------------|
| `memoryStructure`  | `SPEICHERORG`           | `BYTE` / `WORDMSB` / `WORDLSB`                    |
| `memoryType`       | `SPEICHERORG`           | `FREI` / `BLOCK`                                  |
| `deliveryState`    | `ANLIEFERZUSTAND`       | Default byte image — the SG's factory coding      |
| `codingIndices`    | `SGID_CODIERINDEX`      | Coding indices this DATEN file is valid for       |
| `hardwareVersions` | `SGID_HARDWARENUMMER`   | HW versions this DATEN is valid for               |
| `softwareVersions` | `SGID_SWNUMMER`         | SW versions this DATEN is valid for               |

## Install

```bash
pnpm add @emdzej/ncsx-function-list
# or:
"@emdzej/ncsx-function-list": "workspace:*"
```

## Quick start

```ts
import { readFileSync } from 'node:fs';
import { parseDatenFile } from '@emdzej/ncsx-daten';
import { buildFunctionList } from '@emdzej/ncsx-function-list';

const cabd = parseDatenFile(readFileSync('KMBI_E60.C06'));
const list = buildFunctionList(cabd, {
  keywords: { fsw: chassis.swtFsw?.byKeyId, psw: chassis.swtPsw?.byKeyId },
});

console.log(list.memoryStructure);   // 'WORDMSB'
console.log(list.codingIndices);     // [0x06, …]

for (const item of list.items) {
  if (item.kind === 'function') {
    console.log(
      item.fswKeyword,
      '→',
      item.parameters.map((p) => p.pswKeyword),
    );
  }
}
```

## API

| Export                       | Purpose                                                |
|------------------------------|--------------------------------------------------------|
| `buildFunctionList(daten, opts?)` | Walk a parsed CABD `DatenFile` → `FunctionList`   |
| `FunctionList`               | Top-level result type                                  |
| `FunctionListItem`           | Discriminated union of item kinds                      |
| `FunctionItem` / `PropertyItem` / `UnoccupiedItem` / `GroupItem` | Per-kind types       |
| `Parameter`                  | One PSW choice within a FunctionItem                   |
| `KeywordSources`             | `{ fsw?, psw? }` ID→name maps for keyword resolution   |
| `FunctionListError`          | Thrown on malformed input                              |

### `buildFunctionList` options

```ts
buildFunctionList(daten, {
  keywords: {
    fsw: chassis.swtFsw?.byKeyId,  // u16 → 'KEYCARDREADER' etc.
    psw: chassis.swtPsw?.byKeyId,  // u16 → 'aktiv', 'nicht_aktiv', etc.
  },
  // Mirror NCS Dummy's OptionListReader scoping — skip rows inside INDIVID_S blocks.
  // The default (false) includes everything; flip to true if you want group-only items.
  skipIndividualBlocks: false,
});
```

If you pass `keywords`, `fswKeyword` / `pswKeyword` are populated. Otherwise they're `''`
and the consumer can resolve names later (or display raw numeric IDs).

## Cross-block adjacency

`PARZUWEISUNG_PSW1` and `PARZUWEISUNG_PSW2` rows refer back to the **immediately
preceding** `PARZUWEISUNG_FSW` row in document order — not by any explicit FK. Same for
`UNBELEGT2` → `UNBELEGT1`. The builder uses `daten.rowsInOrder` (the document-ordered
iterator added to `@emdzej/ncsx-daten` for this purpose) to preserve that adjacency.

## Property arrays

When a `PARZUWEISUNG_DIR` row's FSW keyword ends in `[N]` (e.g. `KEY[3]`), the resulting
`PropertyItem` carries `arrayName: 'KEY'` and `arrayIndex: 3`. Use this to group related
indexed properties in the UI.

## Related

- [`@emdzej/ncsx-daten`](../daten/) — required input. Parses the binary CABD `.Cxx` file
  this package walks.
- [`@emdzej/ncsx-chassis`](../chassis/) — supplies SWT keyword tables for ID resolution.
- [`@emdzej/ncsx-trace`](../trace/) — overlays this catalog with checked/custom state.
- [`@emdzej/ncsx-cabd`](../cabd/) — encodes/decodes the bytes that fill these slots.
- Design: [`../../docs/ncsdummy-analysis.md` §3.1](../../docs/ncsdummy-analysis.md).
