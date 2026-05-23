# @emdzej/ncsx-chassis

Loads a complete **chassis bundle** from NCSEXPER's DATEN tree. Resolves chassis aliases
(E91 → E89, R56 → R50, …), opens all the per-chassis text + binary tables in parallel, and
exposes a lazy CABD-by-SG loader on top.

This is the package end-user apps reach for first: give it a folder, get a `Chassis`
object back, and every downstream piece of the stack (`fa-asw`, `ecu-select`, `coder`,
`function-list`) works against it.

Spec: [`../../docs/daten-format.md`](../../docs/daten-format.md) for the file formats,
[`../../docs/ecu-selection.md`](../../docs/ecu-selection.md) for how the loaded tables
compose to drive ECU selection.

## What you get

```ts
interface Chassis {
  code: string;            // canonical chassis code (after aliasing) — e.g. 'E89'
  requestedCode: string;   // what the caller asked for — e.g. 'E91'
  dir: string;             // lowercase chassis dir name, e.g. 'e89'

  // Binary tables (DatenFile objects from @emdzej/ncsx-daten)
  brRef: DatenFile;        // BR_REF.DAT
  dst: DatenFile;          // <BR>DST.000
  sget: DatenFile;         // <BR>SGET.000
  sgvt: DatenFile;         // <BR>SGVT.000
  zcsut: DatenFile;        // <BR>ZCSUT.000 (optional)
  cvt: DatenFile;          // <BR>CVT.000 (optional)

  // Text tables (parsed; indexed where it helps)
  sgfam: Map<string, SgfamRow>;  // SG short-name → SGFAM row
  zst?: ZstIndex;                // <BR>ZST.000 — by FSW and SA
  at?: Map<string, AtRecord>;    // <BR>AT.000 — by FA code
  atM00?: AtM00File;             // <BR>AT.M00 (Z/E/W/S rows)
  atZus?: AtFile;                // <BR>AT.ZUS (optional)

  // SWT lookup tables (FSW/PSW/ASW name ↔ KEYID)
  swtAsw?: SwtTable;
  swtFsw?: SwtTable;
  swtPsw?: SwtTable;

  // Lazy CABD loader — loads <SGBD>.Cxx files on demand and caches them
  cabd: CabdLoader;
}
```

## Install

```bash
pnpm add @emdzej/ncsx-chassis
# or:
"@emdzej/ncsx-chassis": "workspace:*"
```

## Quick start (Node)

```ts
import { loadChassis } from '@emdzej/ncsx-chassis';
import { nodeChassisSource } from '@emdzej/ncsx-chassis/node';

const source = nodeChassisSource('/path/to/NCSEXPER/DATEN');
const chassis = await loadChassis(source, 'E91', {
  onWarning: (w) => console.warn(w),
});

console.log(chassis.code);                  // 'E89' (aliased)
console.log(chassis.sgfam.get('EWS'));      // { sgName: 'EWS', cabd: 'A_EWS3', sgbd: 'C_EWS3', … }

// Lazy enumerate every .Cxx coding-data module shipped for this chassis.
const modules = await chassis.cabd.listModules();
// → [{ moduleName: 'EWS', codingIndexes: [0x81] }, …]

// Open one by basename + coding index:
const ews = await chassis.cabd.openModule('EWS', 0x81);
```

The `.Cxx` file name is the **physical SG basename** (e.g. `KMB_E46`, `EWS`) — *not* the
SGFAM `CABD` column. See [`../../docs/ecu-selection.md` §8](../../docs/ecu-selection.md)
for the full lookup contract and how to derive the basename from a `SelectedSg` returned
by `@emdzej/ncsx-ecu-select`.

## Quick start (Browser)

In the browser we don't have `node:fs`; provide your own `ChassisSource` adapter backed by
[`FileSystemDirectoryHandle`](https://developer.mozilla.org/docs/Web/API/FileSystemDirectoryHandle).
The `apps/web` app does this in
[`src/lib/fs-chassis-source.ts`](../../apps/web/src/lib/fs-chassis-source.ts) —
~80 lines, case-insensitive segment drill.

## `ChassisSource`

Thin filesystem abstraction so callers can plug in any backing store. Implement three
methods:

```ts
interface ChassisSource {
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;
}
```

Bundled adapters:

- `nodeChassisSource(rootDir)` — `node:fs/promises` backed. **Import from
  `@emdzej/ncsx-chassis/node`** (not the default entry — that one is browser-safe).
- `inMemoryChassisSource(files)` — `Map<string, Uint8Array>` backed; used in tests.

## API

| Export                      | Purpose                                                         |
|-----------------------------|-----------------------------------------------------------------|
| `loadChassis(source, code, opts?)` | Top-level loader                                         |
| `loadBrRef(source)`         | Just `BR_REF.DAT` (used internally, exposed for alias dumps)    |
| `resolveChassisCode(brRef, requested)` | Apply BR_REF aliases (E91 → E89, …)                  |
| `CabdLoader`                | The lazy CABD class hung off `chassis.cabd`                     |
| `indexSgfam` / `indexZst` / `indexAt` / `indexSwt` | Indexers that turn parsed `DatenFile`s into the convenient `Map`s on the chassis bundle |
| `loadSwtFile(source, dir, kind)` | Find + parse one `SWT<kind><NN>.DAT` lookup table          |
| `nodeChassisSource(rootDir)` | (subpath `/node`) Node `fs/promises` adapter                   |
| `inMemoryChassisSource(files)` | Map-backed adapter for tests                                  |

## What gets read

| Required           | Required (otherwise throws)                                    |
|--------------------|----------------------------------------------------------------|
| `BR_REF.DAT`       | At the source root — used for aliasing                         |
| `<BR>DST.000`      | The minimum-viable per-chassis file                            |

| Optional           | If missing, the field is `undefined` and a warning fires       |
|--------------------|----------------------------------------------------------------|
| `<BR>SGET.000`     | ECU-selection rows                                             |
| `<BR>SGVT.000`     | SG variants                                                    |
| `<BR>ZCSUT.000`    | ZCS update tables                                              |
| `<BR>CVT.000`      | Coding-variant order-options                                   |
| `<BR>SGFAM.DAT`    | SG name → CABD/SGBD mapping                                    |
| `<BR>ZST.000`      | SA / FA / ASW master                                           |
| `<BR>AT.000`       | FA-code dictionary                                             |
| `<BR>AT.M00`       | Zwang/Entfall/special rules                                    |
| `<BR>AT.ZUS`       | AT companion                                                   |
| `SWTASW<NN>.DAT`   | ASW name ↔ KEYID                                               |
| `SWTFSW<NN>.DAT`   | FSW name ↔ KEYID                                               |
| `SWTPSW<NN>.DAT`   | PSW name ↔ KEYID                                               |

CABD `.Cxx` files (~150 per chassis) are **not** preloaded — use
`chassis.cabd.listModules()` to enumerate them and
`chassis.cabd.openModule(moduleName, ci)` to fetch one on demand.

## Related

- [`@emdzej/ncsx-daten`](../daten/) — the binary parser this builds on.
- [`@emdzej/ncsx-text-tables`](../text-tables/) — the text parsers used internally.
- [`@emdzej/ncsx-fa-asw`](../fa-asw/) — first consumer of the loaded chassis.
- [`@emdzej/ncsx-ecu-select`](../ecu-select/) / [`@emdzej/ncsx-coder`](../coder/) — downstream.
