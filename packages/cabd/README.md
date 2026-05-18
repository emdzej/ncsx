# @emdzej/ncsx-cabd

CABD coding-rule **decoder and encoder** — converts between the raw byte-level
`netto` buffer that the ECU exchanges over EDIABAS and the logical FSW/PSW value layer
NCSEXPER's coding UI works with.

This is the bidirectional core of BMW coding: read direction lets you decode what the ECU
currently has; write direction lets you encode an edit ready to flash back.

Spec: [`../../docs/coding-flow.md`](../../docs/coding-flow.md) (end-to-end pipeline) and
[`../../docs/daten-format.md` §1.7-1.8](../../docs/daten-format.md#17-the-a-length-prefixed-bytes-field)
(OPERATION operators + EINHEIT units).

## The CABD rule

Every FSW lives somewhere in the SG's coding memory. A CABD rule (one row in
`PARZUWEISUNG_FSW` / `PARZUWEISUNG_DIR`) says where and how:

```ts
interface CabdRule {
  wortadr: number;       // byte offset into the netto buffer (despite the name)
  byteadr: number;       // number of consecutive bytes this FSW covers
  maske: number[];       // mask bytes, one per byte covered (length === byteadr)
  einheit?: Einheit;     // 'h' | 'A' | 'a' | 'b' | 'd' — how source bytes fold into a number
  operations?: Operation[]; // post-processing operations: ! & * + - / > ^ |
}
```

## Install

```bash
pnpm add @emdzej/ncsx-cabd
# or:
"@emdzej/ncsx-cabd": "workspace:*"
```

## Quick start

```ts
import { decodeField, encodeField } from '@emdzej/ncsx-cabd';

const rule = {
  wortadr: 0x04,         // FSW lives at netto[4]
  byteadr: 1,            // one byte wide
  maske: [0xff],         // owns all 8 bits
  einheit: 'h' as const, // raw hex bytes
  operations: [],
};

const netto = Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);

// Read direction: bytes → value
console.log(decodeField(rule, netto)); // 0x01

// Write direction: value → bytes (mutates `netto` in place)
encodeField(rule, 0x42, netto);
console.log(netto[4]?.toString(16));   // "42"
```

## API

| Export                      | Direction | Purpose                                       |
|-----------------------------|-----------|-----------------------------------------------|
| `decodeField(rule, netto)`  | read      | Bytes at `wortadr` → logical value            |
| `encodeField(rule, v, netto)` | write   | Value → masked bytes spliced into `netto`     |
| `applyOperationsRead(value, ops)` | read | Run the OPERATION list left-to-right        |
| `applyOperationsWrite(value, ops)` | write | Run the inverted OPERATION list           |
| `decodeEinheit(bytes, e)`   | read      | Fold source bytes per EINHEIT char            |
| `encodeEinheit(value, e, len)` | write  | Inverse of `decodeEinheit`                    |

## OPERATION operators

| Op    | Read direction | Write direction (inverse) |
|-------|----------------|---------------------------|
| `!`   | `~value` (bitwise NOT) | same                |
| `&`   | `value & N`    | undefined (lossy)         |
| `*`   | `value * N`    | `value / N`               |
| `+`   | `value + N`    | `value - N`               |
| `-`   | `value - N`    | `value + N`               |
| `/`   | `value / N`    | `value * N`               |
| `>`   | `value >> N`   | `value << N`              |
| `^`   | `value ^ N`    | same                      |
| `|`   | `value | N`    | undefined (lossy)         |

`&` and `|` operations are lossy in the write direction; `encodeField` will throw if your
rule requires inverting one.

## EINHEIT (unit) chars

| Char | Source format              | Decoded value                                  |
|------|----------------------------|------------------------------------------------|
| `h`  | hex bytes (LE)             | raw u8/u16/u32 LE                              |
| `A`  | ASCII hex digit            | `'0'-'9'` → 0..9; `'A'-'Z'` → 10..35           |
| `a`  | raw ASCII byte             | `c & 0xff`                                     |
| `b`  | ASCII bit-string           | sum of `(c-'0') << pos` per char               |
| `d`  | ASCII decimal digits       | `parseInt(s, 10)`                              |

## Decode/encode pipeline

```
read:  netto bytes ──┬─→ AND with MASKE ─→ right-shift by trailing-zero count of mask
                     │                       (auto-shift, can disable)
                     │                       ↓
                     └─→ fold via EINHEIT ─→ run OPERATION list ─→ logical value

write: logical value ─→ invert OPERATION list ─→ unfold via EINHEIT ─→ left-shift to mask bit pos
                                                                          ↓
                                            splice into netto with MASKE-controlled OR
```

## Related

- [`@emdzej/ncsx-daten`](../daten/) — gives you the raw `PARZUWEISUNG_FSW` rows that
  build a `CabdRule`.
- [`@emdzej/ncsx-coder`](../coder/) — uses this package per-edit to encode into a netto
  buffer.
- [`@emdzej/ncsx-trace`](../trace/) — Nettodata write path uses the same MASKE accumulation.
- Specs: [`../../docs/coding-flow.md`](../../docs/coding-flow.md) and
  [`../../docs/daten-format.md` §1.7-1.8](../../docs/daten-format.md#17-the-a-length-prefixed-bytes-field).
