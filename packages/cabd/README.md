# @emdzej/ncsx-cabd

CABD coding-rule **decoder** and **encoder** — converts between the byte-level netto buffer that
the ECU exchanges and the logical FSW/PSW value layer NCSEXPER uses internally.

Spec: [`../../docs/coding-flow.md`](../../docs/coding-flow.md) (end-to-end pipeline) and
[`../../docs/daten-format.md` §1.7-1.8](../../docs/daten-format.md#17-the-a-length-prefixed-bytes-field)
(OPERATION operators + EINHEIT units).

## What it does

Given a **CABD rule** — `{ wortadr, byteadr, maske, einheit, operations }` — and a **netto buffer**:

- `decodeField(rule, netto)` reads `byteadr` bytes at `wortadr`, applies the row's MASKE,
  folds the source bytes per EINHEIT, runs the OPERATION list, returns the logical value.
- `encodeField(rule, value, netto)` mutates `netto` in place: clears the masked bits at
  `wortadr` and ORs in the encoded value.

The 9-operator OPERATION set (`! & * + - / > ^ |`) is implemented both forward (decode) and
inverted (encode). See `docs/daten-format.md` §1.7 for semantics.

## Quick start

```ts
import { decodeField, encodeField } from '@emdzej/ncsx-cabd';

const rule = {
  wortadr: 0x04,
  byteadr: 1,
  maske: [0xff],
  einheit: 'h' as const,
  operations: [],
};

const netto = Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
console.log(decodeField(rule, netto)); // 0x01

encodeField(rule, 0x42, netto);
console.log(netto[4]?.toString(16));   // "42"
```
