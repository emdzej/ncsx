# @emdzej/ncsx-trace

**TRC / MAN** trace-file readers, writers, and the `TraceOverlay` model that the friendly
checkbox editor edits. This is the data plane between "user ticks a box" and "bytes hit
the ECU".

Mirrors NCS Dummy's `Classes/TraceFunctions` family — see
[`../../docs/ncsdummy-analysis.md` §2-3](../../docs/ncsdummy-analysis.md) for the design
rationale and source-code anchors, and [`../../docs/user-flow.md`](../../docs/user-flow.md)
for how this fits into the end-user flow.

## The four file types

| File              | Direction in NCS Expert | Format       | What it carries                            |
|-------------------|--------------------------|--------------|--------------------------------------------|
| `FSW_PSW.TRC`     | written by NCS Expert    | FSW/PSW text | Current ECU coding, as keywords            |
| `NETTODAT.TRC`    | written by NCS Expert    | Nettodata B/M | Current ECU coding, as raw bytes           |
| `FSW_PSW.MAN`     | read by NCS Expert       | FSW/PSW text | "Apply these FSW/PSW changes"              |
| `NETTODAT.MAN`    | read by NCS Expert       | Nettodata B/M | "Apply these raw-byte changes"             |

Both formats serialise the same in-memory `TraceOverlay` — just two ways of writing it.

## Install

```bash
pnpm add @emdzej/ncsx-trace
# or:
"@emdzej/ncsx-trace": "workspace:*"
```

## What you get

```ts
interface TraceOverlay {
  memoryStructure: MemoryStructure;  // BYTE / WORDMSB / WORDLSB
  isWord: boolean;                   // true for word-mode SGs
  items: TraceOverlayItem[];
}

type TraceOverlayItem =
  | TraceOverlayFunction      // function with parameters[], each with `selected: bool`
  | TraceOverlayProperty      // property with optional `data: Uint8Array | null`
  | TraceOverlayUnoccupied    // unoccupied byte range, optional `data`
  | TraceOverlayGroup         // UI group header
  | TraceOverlayUnresolved;   // FSW keyword that wasn't in the catalog
```

## Quick start

```ts
import { parseDatenFile } from '@emdzej/ncsx-daten';
import { buildFunctionList } from '@emdzej/ncsx-function-list';
import {
  buildTraceOverlay,
  parseFswPswTrace,
  applyFswPswTrace,
  writeNettodataTrace,
  sniffTraceFormat,
  parseNettodataTrace,
  applyNettodataTrace,
} from '@emdzej/ncsx-trace';

// 1. Build an unchecked overlay from the SG's catalog.
const cabd = parseDatenFile(await readBytes('KMBI_E60.C06'));
const list = buildFunctionList(cabd, { keywords: chassis.keywordSources });
const overlay = buildTraceOverlay(list);

// 2. Load a TRC from disk (could be either format).
const text = await readText('FSW_PSW.TRC');
if (sniffTraceFormat(text) === 'fsw-psw') {
  applyFswPswTrace(overlay, parseFswPswTrace(text));
} else {
  applyNettodataTrace(overlay, parseNettodataTrace(text));
}

// 3. User toggles checkboxes by mutating overlay.items directly…

// 4. Export to NETTODAT.MAN so NCS Expert can flash it.
const manText = writeNettodataTrace(overlay);
await writeText('NETTODAT.MAN', manText);
```

## API

| Function                                  | Purpose                                              |
|-------------------------------------------|------------------------------------------------------|
| `buildTraceOverlay(list)`                 | Lift a `FunctionList` into a fresh `TraceOverlay`    |
| `sniffTraceFormat(text)`                  | Detect `'fsw-psw'` / `'nettodata'` / `null`          |
| `parseFswPswTrace(text)`                  | Parse FSW/PSW text → `FswPswSelection[]`             |
| `applyFswPswTrace(overlay, sels, opts?)`  | Mark matching parameters as `selected`               |
| `writeFswPswTrace(overlay)`               | Serialise checked items → FSW/PSW text               |
| `parseNettodataTrace(text)`               | Parse Nettodata B/M records → `NettodataEntry[]`     |
| `applyNettodataTrace(overlay, entries, opts?)` | Decode bytes back to checked PSWs / custom data |
| `writeNettodataTrace(overlay)`            | Serialise overlay → coalesced B/M records            |
| `unpackBlockAddress(packed, isWord)`      | Inverse of NCSEXPER's `BlockAddress` packing         |

## File formats

### FSW/PSW

Plain text, one FSW per outer line, parameters indented with a tab:

```
LENKSEITE_LSZ
	wert_01
KALTUEBERWACHUNG_BL
	aktiv
```

### Nettodata

Plain text, two record types, all hex, no whitespace inside a record:

```
B AAAAAAAA,LLLL,XX,XX,XX,...        ; resolved consecutive bytes (or words)
M AAAAAAAA,LLLL,MM,VV               ; one masked byte/word (mask, value)
```

- `AAAAAAAA` — 32-bit hex packed `(block << 8) + (isWord ? addr/2 : addr)`.
- `LLLL` — number of values in this record.
- `XX` (or `XXXX`) — data values. Width depends on the SG's memory structure.
- `B` records run up to 16 bytes / 8 words and only encode fully-masked addresses.
- `M` records cover any address whose function/property doesn't own every bit.

## Strict / lenient modes

Both readers default to lenient: unknown keywords or partial coverage become
`TraceOverlayUnresolved` items / synthetic `custom` data, so the UI can still render the
trace and surface what's wrong.

```ts
applyFswPswTrace(overlay, selections, { strict: true });
applyNettodataTrace(overlay, entries, { strict: true });
```

In strict mode the readers throw with a "make sure chassis and module match those of the
trace file" message — the same one NCS Dummy uses.

## When to reach for it

- Importing an existing `FSW_PSW.TRC` / `NETTODAT.TRC` someone made with NCS Expert.
- Letting the user edit catalog options via checkboxes and writing the result out.
- Roundtripping: read a trace, mutate, write — the writer canonical-orders by FSW id and
  coalesces nettodata into compact B-runs.

## Related

- [`@emdzej/ncsx-function-list`](../function-list/) — the catalog this overlays.
- [`@emdzej/ncsx-cabd`](../cabd/) — same MASKE-accumulator algorithm for writing nettodata.
- [`@emdzej/ncsx-coder`](../coder/) — for the same edits at the EDIABAS-job level.
- Design: [`../../docs/ncsdummy-analysis.md` §2-3](../../docs/ncsdummy-analysis.md).
- User flow: [`../../docs/user-flow.md`](../../docs/user-flow.md).
