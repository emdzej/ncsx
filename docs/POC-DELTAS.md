# bimmerz `ncs-data` POC — gap analysis vs. corrected DATEN spec

Concrete list of changes the existing `bimmerz/packages/ncs-data` parser needs in order to match what NCSEXPER actually does (per Ghidra round-2). Companion to [`daten-format.md`](daten-format.md).

Reviewed files: `~/Projects/my/bimmerz/packages/ncs-data/src/{parsers.ts,reader.ts,types.ts}`. Helper `calculateCrc` lives in `~/Projects/my/bimmerz/packages/core/src/utils.ts:186`.

## ✔ Already correct

| Area | Evidence |
|------|----------|
| **CRC algorithm** is XOR-fold | `packages/core/src/utils.ts:186` — `crc ^= buffer[i]`. Matches the spec. False alarm in the earlier draft of these notes. |
| **Frame framing** (`size:u8`, `type:u16 LE`, `payload`, `crc:u8`) | `reader.ts:11-16`. |
| **Frame-type constants** (`0x0100`/`0x0200`/`0x0300`/…/`0xFF00` u16 LE) | `types.ts:9-15`. The "0x0003 vs 0x0300" notation confusion from the NCS Dummy notes was resolved — POC values are correct. |
| **Definition triplet handling** (`0x0300` → name, `0x0400` → format, `0x0500` → names) | `reader.ts:35-64`. |
| **Optional `{X}`** — read presence flag, then value if present | `parsers.ts:82-90`. |
| **Plain collection `(X)`** — `u16 LE` count + values | `parsers.ts:91-101`. |
| **Scalars `B`, `W`, `L`, `S`** — correct widths & endianness | `parsers.ts:119-144`. |

## ✘ Bugs to fix

### 1. `A` field is length-prefixed (`u8 length + bytes`), not 1 byte

**Where:** `parsers.ts:111-118`.

```ts
case DATA_TYPES.BITWISE_OPERATION: {
    return {
        length: 1,                      // ← bug: should be 1 + length-prefix's value
        value: payload.readUInt8(offset)
    }
}
```

**Spec** ([`daten-format.md` §1.7](daten-format.md#17-the-a-length-prefixed-bytes-field)):

On the wire, an `A` field is `u8 length` followed by `length` raw bytes. The interpretation of those bytes is **field-name-dependent**:

- `AUFTRAGSAUSDRUCK` — byte-coded boolean predicate ([`ecu-selection.md` §6](ecu-selection.md#6-auftragsausdruck--byte-coded-predicate-grammar)).
- CABD `OPERATION` slot — packed 5-byte entries `(op_char, u32 LE operand)`.
- Other fields — opaque blob.

> Earlier drafts of this doc claimed `A` itself was 5 bytes. That was the *internal runtime layout* the `GetDataFromOperation` decompilation showed, not the on-wire framing. Verified against `<BR>SGET.000`: the first byte after the string fields is the length prefix (e.g. `0x17` = 23-byte predicate follows), not an op char.

**Fix sketch:**

```ts
case DATA_TYPES.BITWISE_OPERATION: {
    const len = payload.readUInt8(offset);
    const bytes = payload.subarray(offset + 1, offset + 1 + len);
    return { length: 1 + len, value: { bytes } };
}
```

The fixed `@emdzej/ncsx-daten` parser in this repo implements exactly this (`packages/daten/src/scalar.ts`) and parses every shipped `<BR>SGET.000` row cleanly, with the predicate bytes available for downstream semantic interpretation.

This is the **load-bearing bug** — without it every `*SGET.000` / `*.Cxx` row that contains an `A` field desyncs and corrupts the rest of the row.

### 2. Range collection `XX(XX)` decodes as two entries (and wrong shape)

**Where:** `parsers.ts:32-55`.

```ts
} else if (char === '(') {
    const dataType = formatString[offset++];
    let terminator = formatString[offset++];
    let range = false;

    if (terminator === dataType) {           // saw ((X))  but the real format is XX(XX)
        range = true;
        terminator = formatString[offset++];
        result.push({ collection: true, range, type: dataType as DATA_TYPE });
    }

    if (terminator !== ')') {
        continue;
    }

    result.push({ collection: true, range, type: dataType as DATA_TYPE });
    //         ^ falls through and pushes a SECOND entry for the range case
}
```

Two problems:

a. The "range" detection looks for `((X))` but actual range collections are spelled **`XX(XX)`** — a mandatory leading pair followed by an optional list of more pairs. The mandatory pair (`XX`) is consumed by the outer loop as two plain `X` fields and never marked as part of the range. So `WW(WW)` currently parses to `[W, W, W-collection]` instead of one logical "range list" with element type `(W, W)`.

b. Even on the (incorrect) `((X))` branch, the function pushes one entry inside the `if(range)` block and then **falls through** and pushes a second entry, doubling the field.

**Fix sketch:** introduce a dedicated peek/lookahead step in `dataFormatDefinitionsParser`. Conceptually:

```ts
// Detect `X(X)` (non-empty list) and `XX(XX)` (non-empty pair-list)
// by looking back at fields already emitted when '(' is encountered.
```

See spec rules in [`daten-format.md` §1.6](daten-format.md#16-format-string-mini-language).

### 3. Non-empty list `X(X)` is not distinguished from plain `(X)`

Fields like `KENNUNG_K : SS(S)` and `KENNUNG_ALL : SW(W)` carry a leading mandatory element. The POC currently treats the leading element as a separate scalar and the trailing `(X)` as an independent collection. Functionally that yields the right number of decoded values, but the **logical type** is wrong (two unrelated fields vs. one "non-empty list") and downstream consumers can't tell which is which.

If the parser keeps the current behavior (two emitted fields), that's at least decodable — but make it intentional and document it in `types.ts`.

### 4. Truncated optional `{X{...` is silently dropped

**Where:** `parsers.ts:19-31`.

```ts
if (char === '{') {
    const dataType = formatString[offset++];
    const terminator = formatString[offset++];
    if (terminator !== '}') {
        continue;     // ← swallows the malformed group, leaving offset in the middle of a row
    }
    result.push({ optional: true, type: dataType as DATA_TYPE });
}
```

Real files (`*SGET.000`) carry formats like `A{B}{` — an `A` then a `{B}` then a truncated **second** `{` group. NCSEXPER tolerates this; the POC ignores it but doesn't compensate for the consumed `{B}` content in the payload. Result: silent desync at runtime.

Two acceptable fixes:
- Treat a trailing `{` with no body as a no-op (current behavior is fine, but make it explicit).
- Or, more strictly, log a warning and stop parsing the format string so the file is rejected with a clear error.

### 5. `EINHEIT` (unit) byte is parsed correctly but not interpreted

CABD rows carry an `EINHEIT` byte that decides how the **source-byte string** is folded into a numeric value (codes `A`/`a`/`b`/`d`/`h`). The POC reads it as a plain byte — correct at the framing level. The work to actually decode CABD bytes back to logical values (`numerische Decodierung`, `Bit-Decodierung`, `wertunabhaengige Decodierung`, etc.) is a **separate layer** that doesn't exist in the POC yet. Track it as a TODO, not a parser bug.

See spec rules in [`daten-format.md` §1.8](daten-format.md#18-the-einheit-unit-byte).

## ☐ Missing features (not bugs, but needed for ncsx)

| Feature                                        | Where the spec lives                         |
|------------------------------------------------|-----------------------------------------------|
| **Cross-file loader** — `BR_REF.DAT` → `<BR>DST.000` → per-SG `.Cxx` graph | [`daten-format.md` §3](daten-format.md#3-end-to-end-locating-a-coding-rule) |
| **Text-table parsers** — `<BR>SGFAM.DAT`, `<BR>ZST.000`, `<BR>AT.000`, `<BR>AT.M00`, `<BR>AT.ZUS` | [`daten-format.md` §2](daten-format.md#2-text-table-format) |
| **CABD decoder** — six Decodiertyp cases (`numerisch`, `Bit`, `wertunabhaengig`, `reverse wertunabhaengig`, `Konstante`, `Sonder`) operating over `(EINHEIT, OPERATION list, MASKE, NETTODATA)` | [`daten-format.md` §1.7-1.9](daten-format.md#17-the-a-operation-field) |
| **FA-expression matcher** — `ausdruckCheckAuftrag` byte-coded predicate evaluator | [`ecu-selection.md` §6](ecu-selection.md#6-auftragsausdruck--byte-coded-predicate-grammar) |
| **ASW computation** — `coapiGetAswFromAuftrag` / `coapiGetAswFromZcs` — projects FA tokens or ZCS bytes onto the canonical variant bit-vector | [`ecu-selection.md` §3.3](ecu-selection.md#33-step-3--fa--zcs--asw) |
| **PFL profile parser/serializer** | [`pfl-format.md`](pfl-format.md) |

## Suggested implementation order

The fixes are independent and shippable as small PRs:

1. **Bug 1** (length-prefixed `A` field) — single 4-line patch, biggest impact.
2. **Bug 2** (range collection misparse) — refactor `dataFormatDefinitionsParser` to do a proper lookahead.
3. **Bug 4** (truncated optional) — explicit handling.
4. **Bug 3** (non-empty list `X(X)`) — types-only refinement.
5. New features 1–6 in order — none of them are urgent for the existing POC consumers but are needed for ncsx to actually code an ECU.
