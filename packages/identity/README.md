# @emdzej/ncsx-identity

Read **VIN**, **FA**, and **ZCS** from a connected BMW ECU. Picks the right identity
SG per chassis using SGFAM's FA/ZCS flags — no hardcoded chassis tables, no
per-generation switch statements.

Different chassis generations carry vehicle identity in different ways:

- **FA-master chassis** (post-E60-ish): a single token string — `E89_#0306&N6SW%0354$167…`
  — handed back verbatim by the SG. Edited by adding / removing tokens.
- **ZCS-master chassis** (E36 / E38 / E39 / E46 / E53): three structured fields —
  `GM` (base-model code), `SA` (hex-encoded bit-set indexed by `<BR>ZST.*`), `VN`
  (version number).

VIN comes through on both paths via a separate `FGNR_LESEN` job.

## Usage

```ts
import {
  readVin,
  readFa,
  readZcs,
  formatFahrgestellNr,
} from "@emdzej/ncsx-identity";

const { vin } = await readVin(sgbd, ediabas);
const { fa } = await readFa(sgbd, ediabas);          // FA chassis
const { zcs } = await readZcs(sgbd, ediabas);        // ZCS chassis

// Format VIN as the 18-char FAHRGESTELL_NR the IPO expects in
// `C_FG_AUFTRAG`'s `para` — appends the BMW Mod-36 check char.
const fgnr = formatFahrgestellNr(vin);
// "WBAAA00000PM10277" → "WBAAA00000PM10277L"
```

`sgbd` is an EDIABAS module name (`"C_KMB46"`, `"D_KOMBI"`, …) — typically derived
from SGFAM's identity row. `ediabas` is anything matching `EdiabasLike` from
`@emdzej/ncsx-wire` — `@emdzej/ediabasx-ediabas`'s `Ediabas` class satisfies it.

## Picking the right identity SG

```ts
import { findIdentitySg } from "@emdzej/ncsx-chassis";  // chassis-bundle helper

const idRow = findIdentitySg(chassis);
const { vin } = await readVin(idRow.sgbd, ediabas);
```

`findIdentitySg` walks SGFAM looking for the row whose FA-master or ZCS-master
flag is set. Falls back to a deterministic per-chassis-code map if SGFAM doesn't
mark one.

## BMW Mod-36 checksum

`mod36Checksum(input)` and `formatFahrgestellNr(vin)` are direct ports of
NCSEXPER's `coapiSetFgNr` → `CalcMod36CheckSum`. The algorithm sums the input's
character codes weighted by position modulo 36, mapping the remainder back to
`[0-9A-Z]` (skipping I, O for visual disambiguation).

Worked example, unit-tested: `"FPWBAAA00000PM10277"` → `'L'`.

## Exports

```ts
export { readVin, padFgnrToVin, type VinReadResult, type PaddedVin };
export { readFa, type FaReadResult };
export { readZcs, type ZcsRead, type ZcsReadResult };
export { mod36Checksum, formatFahrgestellNr };
export type { IdentityReadResult };
```

## Consumers

- `apps/web/src/components/IdentityPanel.svelte` — drives the identity card
  in the UI.
- `apps/web/src/lib/process-ecu.ts` — `processWriteCoding` calls
  `formatFahrgestellNr(app.identity.vin)` and seeds it as `FAHRGESTELL_NR` via
  `CDHSetSystemData` so `SG_CODIEREN`'s post-write `C_FG_AUFTRAG` has the right
  18-byte chassis number to thread into the SGBD.
