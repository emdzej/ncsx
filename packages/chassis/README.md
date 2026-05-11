# @emdzej/ncsx-chassis

Loads a single **chassis bundle** from NCSEXPER's DATEN tree: parses
`BR_REF.DAT`, resolves aliases (E91 → E89, R56 → R50, …), then opens the
chassis-specific tables (`<BR>DST.000`, `<BR>SGET.000`, `<BR>SGVT.000`,
`<BR>ZCSUT.000`, `<BR>CVT.000`, `<BR>SGFAM.DAT`, `<BR>ZST.000`,
`<BR>AT.000`, `<BR>AT.M00`, optional `<BR>AT.ZUS`).

CABD files (`<SGBD>.Cxx`, ~150 per chassis) are **loaded lazily** via
`chassis.loadCabd(sgName, ci?)`.

## Quick start

```ts
import { loadChassis, nodeChassisSource } from '@emdzej/ncsx-chassis';

const source = nodeChassisSource('/path/to/NCSEXPER/DATEN');
const chassis = await loadChassis(source, 'E91'); // aliases to E89

console.log(chassis.code);                 // 'E89'
console.log(chassis.sgfam.get('EWS'));     // { sgName: 'EWS', cabd: 'A_EWS3', sgbd: 'C_EWS3', … }

// Lazy load a CABD file for a specific SG / coding index:
const ews = await chassis.loadCabd('EWS', 0x07);
```

## Spec

- [`../../docs/daten-format.md`](../../docs/daten-format.md) for the file formats.
- [`../../docs/ecu-selection.md`](../../docs/ecu-selection.md) for how SGFAM
  + SGET + ZCSUT compose to drive ECU selection.

## `ChassisSource`

Thin filesystem abstraction so callers can plug in fixtures, in-memory
sources, or remote stores. Built-in adapters:

- `nodeChassisSource(rootDir)` — `node:fs/promises` backed.
- `inMemoryChassisSource(files)` — `Map<string, Uint8Array>` backed (for tests).
