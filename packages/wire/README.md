# @emdzej/ncsx-wire

The **wire layer** between ncsx's `CodingPlan` / `TraceOverlay` and a real ECU. Thin
adapters around [`@emdzej/ediabasx-ediabas`](https://www.npmjs.com/package/@emdzej/ediabasx-ediabas)
that issue the four EDIABAS jobs the coding flow needs:

| Job                   | Direction | What ncsx uses it for                                |
|-----------------------|-----------|------------------------------------------------------|
| `CODIERDATEN_LESEN`   | read      | Pull the SG's current netto buffer into a `TraceOverlay` |
| `SG_CODIEREN`         | write     | Flash a `CodingPlan` back to the SG                  |
| `CODIERINDEX_LESEN`   | read      | Discover which `<basename>.C<ci>` file matches the SG |
| `IDENTIFIKATION`      | read      | Lightweight "is the SG awake?" ping                  |

See [`docs/user-flow.md`](../../docs/user-flow.md) Phase 6 for where this fits, and
[`docs/coding-flow.md`](../../docs/coding-flow.md) for the encode/decode pipeline that
feeds it.

## What this package *isn't*

- **Not a transport.** Bring your own configured `Ediabas` instance. In the browser that
  means `new SerialInterface({ transport: new WebSerialTransport(port) })` + a
  `new Ediabas({ transport, … })`. In Node it's `NodeSerialTransport` instead. The
  inpax embedding guide walks through both (see
  [`inpax/docs/guides/developer/embedding.md` §6](../../../inpax/docs/guides/developer/embedding.md)).
- **Not a session manager.** Reconnects, retries, and timeout policy are above this layer.
- **Not the inpax-cabi-provider.** That's a separate package (Phase 9) that wraps the same
  primitives into ~100 CABI function bindings for IPO scripts.

## Install

```bash
pnpm add @emdzej/ncsx-wire @emdzej/ediabasx-ediabas
# or:
"@emdzej/ncsx-wire": "workspace:*"
"@emdzej/ediabasx-ediabas": "^0.2.1"
```

## Quick start (Web Serial)

```ts
import { Ediabas } from '@emdzej/ediabasx-ediabas';
import { SerialInterface, WebSerialTransport } from '@emdzej/ediabasx-interface-serial';
import { applyCodingPlan, readCoding, readCodingIndex } from '@emdzej/ncsx-wire';
import { planCoding } from '@emdzej/ncsx-coder';

// 1. One-time: user clicks Connect.
const port = await navigator.serial.requestPort();
const transport = new SerialInterface({
  port: 'webserial',
  baudRate: 115200,
  transport: new WebSerialTransport(port),
  probeAdapterOnConnect: true,
});
const ediabas = new Ediabas({
  ecuPath: '.',
  transport,
  loadSgbdResolver: …,   // returns SGBD bytes from the EDIABAS/Ecu dir handle
});
await ediabas.connect();

// 2. Read the SG's current coding.
const current = await readCoding(ediabas, 'KMBI_E60');
if (!current.ok) {
  console.error('read failed:', current.errorText);
}

// 3. Compute a CodingPlan from the user's edits (using initialNetto from step 2).
const plans = await planCoding({
  chassis,
  fa: '0205 0502 0524',
  edits: [{ sgName: 'KMBI', fsw: 0x025F, psw: 0x01 }],
  initialNetto: current.netto ? new Map([['KMBI_E60', current.netto]]) : undefined,
});

// 4. Flash the change.
const result = await applyCodingPlan(ediabas, plans[0]!);
console.log('SG_CODIEREN →', result.jobStatus);   // 'OKAY' or an error code
```

## API

| Function                          | Job                  | Returns                                |
|-----------------------------------|----------------------|----------------------------------------|
| `readCoding(ediabas, sgbd)`       | `CODIERDATEN_LESEN`  | `{ ok, errorCode, errorText, jobStatus, netto? }` |
| `applyCodingPlan(ediabas, plan)`  | uses `plan.jobName`  | same shape, no `netto`                 |
| `readCodingIndex(ediabas, sgbd)`  | `CODIERINDEX_LESEN`  | `{ ok: true, codingIndex } \| { ok: false, … }` |
| `identify(ediabas, sgbd)`         | `IDENTIFIKATION`     | success/failure flag                   |
| `bytesToHex(bytes)`               | (helper)             | uppercase hex, no separators           |
| `hexToBytes(hex)`                 | (helper)             | tolerates `0x` prefix + whitespace     |

All adapters take an `EdiabasLike` interface — defined locally so the package doesn't
hard-depend on `@emdzej/ediabasx-ediabas`'s exact `Ediabas` class. Pass a real Ediabas
instance, a mock for tests, or any shim that implements `apiJob` / `apiResultText` /
`apiResultInt` / `apiErrorCode` / `apiErrorText`.

## Related

- [`@emdzej/ncsx-coder`](../coder/) — produces the `CodingPlan` this layer flashes.
- [`@emdzej/ncsx-trace`](../trace/) — `TraceOverlay`s built from the netto bytes this
  layer reads.
- [`@emdzej/ediabasx-ediabas`](https://www.npmjs.com/package/@emdzej/ediabasx-ediabas) —
  the EDIABAS core this wraps.
- [`@emdzej/ediabasx-interface-serial`](https://www.npmjs.com/package/@emdzej/ediabasx-interface-serial) —
  Web Serial + Node serialport transports.
