# DATEN folder file formats

Reference for every file under `NCSEXPER/DATEN/`. There are **two distinct families**:

- **Binary "frame" files** (§1) — opaque to humans, used at runtime for the lookup tables NCSEXPER actually consults during coding.
- **Text tables** (§2) — CRLF / ISO-8859-1 sources for `ZST`, `AT`, `SGFAM`, etc. These are the human-editable masters that get released alongside the binaries; for some files only the text form ships, for others only the binary.

Cross-references:
- NCS Dummy notes / `RE NCS Expert DATEN folder files structure.pdf` (mirrored locally in `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/Projekty/E46/NCS DATEN.md`).
- TypeScript POC: `~/Projects/my/bimmerz/packages/ncs-data/src/{reader,parsers,types}.ts`.
- Ghidra (`NCSEXPER.exe`) — handler strings: `coapiReadSget`, `coapiReadAsw`, `coapiGetSgFamData`, `coapiGetAswFromAuftrag`, `coapiScanAllSgFromBr`, file names `br_ref.dat`, `EXXSGFAM.DAT`, `SWTASW.DAT`.

---

## 1. Binary frame format

### 1.1 Container

Every binary DATEN file is a flat stream of fixed-shape frames:

```
struct frame {
  uint8_t  size;                  // payload length, 0..255
  uint16_t type;                  // little-endian
  uint8_t  payload[size];
  uint8_t  crc;                   // XOR of [size, type_lo, type_hi, payload[0..size-1]]
};
```

- Total bytes on disk = `size + 4`.
- Multi-byte integers in the payload are **little-endian**.
- `crc` is the **XOR fold** of every byte that precedes it in the frame (size byte, two type bytes, and all `size` payload bytes). Not a sum.

**Worked CRC verification** (signature 1, the canonical 12-byte file header):

```
bytes : 07 00 01  00 01 00 01 01 01 63   65
        size type   payload (7 bytes)    crc
folded: 07^00^01^00^01^00^01^01^01^63  = 65   ✓
```

The `@bimmerz/core` `calculateCrc` in `packages/core/src/utils.ts:186` is exactly this XOR-fold and parses every shipped DATEN file cleanly.

### 1.2 File layout — four sections

```
┌────────────────────────────┐
│ 1. Signature   (2 frames)  │  fixed magic
├────────────────────────────┤
│ 2. Definitions (3 × N)     │  one (id+name, format, names) triplet per block
├────────────────────────────┤
│ 3. Divider     (1 frame)   │  end of definitions, start of data
├────────────────────────────┤
│ 4. Data        (N rows)    │  per-block rows, each row's frame `type` is the
│                            │  block ID declared in section 2
└────────────────────────────┘
```

### 1.3 Frame types

Values are `u16 LE`. (NCS Dummy notes write some of these in big-endian form, e.g. `0x0003` instead of `0x0300`; this doc uses what `Buffer.readUInt16LE` actually returns.)

| Type     | Section      | Meaning |
|----------|--------------|---------|
| `0x0100` | Signature 1  | Magic. Payload usually `01 00 01 01 01 63 65` (7 bytes). |
| `0x0200` | Signature 2  | Magic. Typically empty (`size=0`) or `02` (`size=1`). |
| `0x0300` | Definitions  | **ID + name** block opener. Payload = `id:u16 LE` + ASCII name + `0x00`. |
| `0x0400` | Definitions  | **Format string** for the just-opened block (ASCII, NUL-terminated). |
| `0x0500` | Definitions  | **Field names**, comma-separated ASCII, NUL-terminated. Closes the block. |
| `0xFF00` | Divider      | End of definitions. Empty payload. |
| **other**| Data         | Data row for the block whose **id matches the type**. Payload is decoded against the previously-registered format string. |

### 1.4 Canonical file header

The first 12 bytes are identical across virtually every binary DATEN file:

```
07 00 01  00 01 00 01 01 01 63 65  01
└┬┘ └─┬─┘ └─────────┬────────────┘  └┬┘
 |   type=0x0100    payload (7 B)    crc=0x01
 size=0x07
```

Followed by signature 2 (typically `00 02 02 01` — `size=0`, `type=0x0200`, no payload, crc=0x01).

### 1.5 Definition triplet

A block is declared with three consecutive frames sharing the layout:

```
type 0x0300 — ID + name
  payload : <id:u16 LE> <name:ASCII> 0x00

type 0x0400 — format
  payload : <format-string:ASCII> 0x00

type 0x0500 — names
  payload : <name1>,<name2>,...,<nameN>:ASCII 0x00
```

Once the triplet closes, the parser holds:
- block **id** (used to identify data rows below)
- block **name** (semantic — `BR_ZEILE`, `SGZEILE`, `PARZUWEISUNG_FSW`, …)
- ordered list of fields, each with a **type** (from the format string) and a **name** (from the names string).

### 1.6 Format-string mini-language

The format string in `0x0400` is read character-by-character. Each character is a scalar type or a structural modifier.

#### Scalar types

| Char | Wire format | Notes |
|------|-------------|-------|
| `B`  | `u8`        | single byte |
| `W`  | `u16` LE    | word |
| `L`  | `u32` LE    | long word |
| `S`  | `char[]` terminated by `0x00` | ASCII string |
| `A`  | `u8 length` + `length` raw bytes | **Length-prefixed bytes** — content is field-name-dependent. See §1.7. |

#### Modifiers

| Pattern | Meaning |
|---------|---------|
| `X`     | one mandatory `X` |
| `{X}`   | **optional** `X` — 1 presence byte (`00` = absent, `01` = present), then a value of `X` only if present |
| `(X)`   | **collection** of zero-or-more `X` — `u16 LE` element count, then that many `X` values |
| `X(X)`  | **non-empty list** — one mandatory `X`, then `(X)` (i.e. the leading element is required) |
| `XX(XX)`| **range list** — one mandatory pair, then `(XX)` of additional pairs. Used for address ranges. |

Examples seen in the wild:

| Format          | Decode |
|-----------------|--------|
| `{L}LWW{B}(B){B}{B}` | optional L, L, W, W, optional B, B-collection, optional B, optional B |
| `WW(WW)`        | range list — e.g. `0000-0037 (0044-0047, 0062-0084)` |
| `SS(S)`         | non-empty string list — e.g. `"$IDHWNR" "03" ("04","05","06")` |
| `SW(W)`         | non-empty word list with leading label |
| `A{B}{`         | OPERATION, optional B, optional ??? (some format strings end mid-modifier — handle gracefully) |
| `SSSSA{B}{`     | 4 strings, OPERATION, optional B, ... (`SGAUSWAHL_VM` row layout) |
| `SSSSSA{B}{`    | 5 strings + OPERATION + ... (`SGAUSWAHL_SGBD`) |
| `SSSSSSA{B}{`   | 6 strings + OPERATION + ... (`SGAUSWAHL_VMSGBD`) |

### 1.7 The `A` (length-prefixed bytes) field

`A` on the wire is **a length-prefixed byte buffer**: `u8 length` followed by `length` raw bytes. Verified empirically against `<BR>SGET.000` rows (e.g. an `AUFTRAGSAUSDRUCK` blob starts with `0x17` = 23, then 23 predicate bytes).

The *content* of those bytes is **field-name-dependent**:

| Field (file)                                    | Byte format inside `A`                                                  |
|-------------------------------------------------|--------------------------------------------------------------------------|
| `AUFTRAGSAUSDRUCK` (`<BR>SGET.000`, `<BR>SGFAM.DAT`, …) | Byte-coded boolean predicate. Tokens: `S<id-lo><id-hi>` = SA-bit lookup, `+` = AND, `,` = OR, `!` = NOT, `(`/`)` = grouping, `\` = continuation. Full grammar in [`ecu-selection.md` §6](ecu-selection.md#6-auftragsausdruck--byte-coded-predicate-grammar). |
| CABD `OPERATION` slot (inside `<SGBD>.Cxx` PARZUWEISUNG_FSW and similar) | Packed **5-byte** entries: 1 ASCII op char + 4 operand bytes (u32 LE). The op set is `! & * + - / > ^ \|`. Documented below. The first byte of the `A` field is the total byte length of the OPERATION list; divide by 5 for the count. |
| Anything else                                   | Treat as opaque bytes. |

In code, the parser just hands back `RawBytes { bytes: Uint8Array }`; semantic interpreters consume those bytes per field-name. This keeps the framing layer field-agnostic.

#### CABD OPERATION packing — the 9-operator set

When an `A` field's content is a CABD OPERATION list, each 5-byte entry packs as:

```
struct Operation {
  uint8_t  op;           // ASCII char from { ! & * + - / > ^ | }
  uint32_t operand;      // u32 LE
};
```

Decoded from `GetDataFromOperation` (`FUN_004575c0` in `CBD_READ.C`):

| Op  | Hex   | Operand | Effect (operand is the `u32 LE` after the op char) |
|-----|-------|---------|----------------------------------------------------|
| `!` | 0x21  | unused  | `value = value XOR 0xFFFFFFFF`  (bitwise invert) |
| `&` | 0x26  | `n`     | `value = value AND n` |
| `*` | 0x2A  | `n`     | `value = value * n` |
| `+` | 0x2B  | `n`     | `value = value + n` |
| `-` | 0x2D  | `n`     | `value = value - n` |
| `/` | 0x2F  | `n`     | `value = value / n` |
| `>` | 0x3E  | `n`     | `value = (value >> n) & ((1 << (32 - n)) - 1)`  (right shift with auto-mask) |
| `^` | 0x5E  | `n`     | `value = value XOR n` |
| `\|`| 0x7C  | `n`     | `value = value OR n` |

> The NCS Dummy notes only list `!`, `+`, `-`, `>` because those are the ones that actually appear in the public DATEN files. The remaining ones (`&`, `*`, `/`, `^`, `\|`) are still implemented in the decoder — be defensive when porting.

Pre-condition: an OPERATION runs on a value that has already been **assembled** from CABD-row source bytes using the row's `EINHEIT` (unit) character — see §1.8.

Where the operations show up:

| Function keyword | Module(s) | Why |
|------------------|-----------|-----|
| `FAHRGESTELL_NR_KOMPL` | E31 EKM | VIN stored bit-inverted (`!`). |
| `FAHRGESTELL_NR` | ZAE2 (E31) | VIN digits packed as binary nibbles; `- 0x30` un-packs them back to ASCII characters. |
| `GM_SCHLUESSEL`, `SA_SCHLUESSEL`, `VN_SCHLUESSEL`, `AM_SCHLUESSEL`, `CODIERDATUM` | `KMB_E32/E34/E36.C25/C27` etc. | ZCS keys are 6-bit values packed across two bytes; `> n` re-aligns the fragments before they're concatenated. |

When you parse the **content of an `A` field** that holds a CABD OPERATION list, walk it in 5-byte strides:

```ts
type Operation =
  | { op: '!' }
  | { op: '&' | '*' | '+' | '-' | '/' | '>' | '^' | '|'; operand: number /* u32 LE */ };

function parseOperations(bytes: Uint8Array): Operation[] {
  const ops: Operation[] = [];
  for (let i = 0; i + 5 <= bytes.length; i += 5) {
    const op = String.fromCharCode(bytes[i]!);
    const operand =
      ((bytes[i + 1]! | (bytes[i + 2]! << 8) | (bytes[i + 3]! << 16) | (bytes[i + 4]! << 24)) >>> 0);
    ops.push(op === '!' ? { op } : ({ op, operand } as Operation));
  }
  return ops;
}
```

> Earlier drafts of this doc claimed `A` itself was 5 bytes. That was wrong — the 5-byte struct is the *content* of an `A` field when it carries an OPERATION list. On the wire, `A` is always `u8 length + length bytes`. The fixed `@emdzej/ncsx-daten` parser models it as `RawBytes` and lets semantic interpreters consume the bytes per field name.

### 1.8 The `EINHEIT` (unit) byte

CABD rows in `*.Cxx` files carry an `EINHEIT` byte (the optional `{B}` typically) that controls how a sequence of source bytes is folded into the value the OPERATION list then transforms. From the same `GetDataFromOperation` decompilation:

| EINHEIT | Hex   | Source format | Decoding |
|---------|-------|---------------|----------|
| `A`     | 0x41  | ASCII char    | `digit('0'-'9')` → `c - 0x30`; `upper('A'-'Z')` → `c - 0x37`. Effectively a hex/base-36 digit. |
| `a`     | 0x61  | ASCII char    | raw byte value (`c`). |
| `b`     | 0x62  | ASCII bit-string | each char (`'0'`/`'1'`) contributes `(c - '0') << position`. |
| `d`     | 0x64  | ASCII digits  | `strtoul(s, base=10)`. |
| `h`     | 0x68  | ASCII digits  | `strtoul(s, base=16)`. |

The CABD row also carries a **width** byte (1, 2, or 4) telling the decoder whether to emit a `u8`, `u16 LE`, or `u32 LE` after applying the OPERATION list. Anything else is rejected.

### 1.9 What this looks like put together

For a CABD `PARZUWEISUNG_FSW` (or similar) row reading bit fragments from `SA_SCHLUESSEL[17]`:

```
WIDTH    = 2           // u16 output
EINHEIT  = 'h'         // hex digits in the source
OPS      = [
  { op: '>', operand: 4 },  // right-shift 4 to re-align the 2-bit fragment
  { op: '&', operand: 0x3F } // mask to 6 bits
]
```

The decoder reads `width` (=2) source bytes via the EINHEIT decoder, then folds them through each OPERATION in order, then writes the resulting u16 LE into the netto buffer.

### 1.8 Worked end-to-end example

```
Definition  block id 0x0012, name "PARZUWEISUNG_FSW"
  format     "{L}LWW{B}(B){B}{B}"
  names      "BLOCKNR,WORTADR,BYTEADR,FSW,INDEX,MASKE,EINHEIT,INDIVID"

Data frame  size=0x10, type=0x0012, crc=0xCD
  payload  : 00 04 00 00 00 01 00 5F 02 00 01 00 FF 01 68 00

Decoded:
  BLOCKNR  = ∅                        (optional absent — leading 0x00)
  WORTADR  = 0x00000004               (L)
  BYTEADR  = 0x0001                   (W)
  FSW      = 0x025F                   (W — lookup key into SWTFSW)
  INDEX    = ∅                        (optional absent)
  MASKE    = [0xFF]                   (collection of 1 byte; u16 LE count = 0x0001)
  EINHEIT  = 0x68 ('h')               (optional present)
  INDIVID  = ∅                        (optional absent)

Disassembly:
  PARZUWEISUNG_FSW : {} 00000004 0001 025F {} (FF) {h} {}
```

### 1.9 Per-file role — binary family

(Sub-directory names below refer to chassis codes like `E46`, `E83`, `E89`, …; `<BR>` is one of them.)

| File                              | Block IDs / role |
|-----------------------------------|------------------|
| `BR_REF.DAT`                      | Top-level chassis index. Blocks `BR_ZEILE` and `BR_ERSATZ`. `BR_ZEILE` rows map E-code → file directory; `BR_ERSATZ` rows are aliases (e.g. `E91 → E89`). Loaded once at startup. |
| `<BR>SGET.000`                    | **SG-Eingabetabelle** — drives "code car". Blocks: `DATEINAME`, `NAME`, `AUFTRAGSAUSDRUCK`, `SGAUSWAHL_VM`, `SGAUSWAHL_SGBD`, `SGAUSWAHL_VMSGBD`. Resolves an FA expression → list of `(SGNAME, CBD, [CABD,] SGBD, UMRSG, [VMG,] AUFTRAGSAUSDRUCK, INDEX)` rows. The three `SGAUSWAHL_*` levels are tried in order — most specific first. |
| `<BR>SGVT.000`                    | **SG-Variantentabelle** — per-SG variant resolution. Maps VM keys → variant SG names. |
| `<BR>ZCSUT.000`                   | **ZCS Update Table** — ZCS↔SG rules applied when `[CODING].ZcsutLesen=1`. |
| `<BR>DST.000`                     | **Datenstation** master index per chassis: `ZST`, `CVT`, `SGET`, `SGVT`, `ZCSUT`, `DATDIR`, `VMDIR`, `NUMSG`, `SGZEILE`. Tells the engine which physical files cover which logical concept. |
| `<BR>CVT.000`                     | **Code-Varianten-Tabelle** — chassis-wide constant data (`feste_Daten_E46`, `GRUPPE`, `INDIVID`, `AUFTRAGSAUSDRUCK`, `FSW_PSW`, `FSW`). |
| `<BR>_CONF.BAP`                   | Configuration / dependency rules. |
| `<BR>AUSBL.H00`                   | Ausblendliste (hide-list); single `SGZEILE` block of SGNAME strings. |
| `<BR>AT.K00`                      | Variant-key file (binary form parallel to `<BR>AT.000` text). |
| **`<SGBD>.Cxx`** (`C01`–`C81`)    | **Per-SG CABD coding data** — the actual byte-level coding tables. Extension digits are CABD revisions / variants. Common blocks: `SGID_CODIERINDEX`, `SGID_HARDWARENUMMER`, `SGID_SWNUMMER`, `SPEICHERORG`, `ANLIEFERZUSTAND`, `CODIERDATENBLOCK`, `PARZUWEISUNG_FSW`, `KENNUNG_D`, `KENNUNG_X`, `KENNUNG_K`, `KENNUNG_ALL`. |
| `VARIABLE.DAT`                    | Global variable dictionary (binary form). |

### 1.10 Reader pseudocode

```ts
function parse(buf: Uint8Array): DataFile {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let dataPhase = false;
  let off = 0;
  while (off < buf.length) {
    const start = off;
    const size  = buf[off++];
    const type  = buf[off] | (buf[off+1] << 8); off += 2;
    const payload = buf.subarray(off, off + size); off += size;
    const crc   = buf[off++];
    assertXor(buf.subarray(start, off - 1), crc);

    switch (type) {
      case 0x0100: case 0x0200:                  // signatures — ignore
        break;
      case 0x0300:                                // id + name (start block)
        current = openBlock(payload);
        blocks.push(current);
        break;
      case 0x0400:                                // format
        current!.fields = parseFormat(asciiZ(payload));
        break;
      case 0x0500:                                // names (close block)
        assignNames(current!, asciiZ(payload).split(','));
        break;
      case 0xFF00:                                // divider
        dataPhase = true;
        break;
      default: {                                  // data row
        const block = blocks.find(b => b.id === type);
        if (!block) throw new Error(`row for unknown block ${type.toString(16)}`);
        block.rows.push(decodeRow(payload, block.fields));
      }
    }
  }
  return blocks;
}
```

---

## 2. Text-table format

A handful of files in DATEN are **plain ISO-8859-1 text** with CRLF line endings — they're the human-editable masters that BMW ships next to the compiled binaries. `file(1)` reports them as "ISO-8859 text, with CRLF line terminators".

Files in this family:
- `<BR>ZST.000` — Zentrale Steuerwort-Tabelle
- `<BR>AT.000` — Auftragsdatei (FA dictionary)
- `<BR>AT.ZUS` — Auftragsdatei companion / Zusatz
- `<BR>AT.M00` — Auftragsdatei compact M-list
- `<BR>SGFAM.DAT` — SG family → CABD mapping
- `VARIABLE.ASC` — global variable dictionary source

### 2.1 Common lexical rules

- Encoding: ISO-8859-1 (German umlauts: `ä`, `ö`, `ü`, `ß` appear in comments).
- Line endings: CRLF (`\r\n`).
- Comments: lines starting with `;` or `//` are ignored.
- Whitespace: leading whitespace is ignored; multiple spaces between fields are field separators.
- Continuations: none — every record is one line.

### 2.2 ZST — Zentrale Steuerwort-Tabelle (`<BR>ZST.000`)

Master mapping of SA codes / FA bits → coding bits, per chassis. The single biggest file in any chassis directory (`E46ZST.000` is 169 KB after years of additions). Drives both the FA parser and the FSW/PSW assignment used during coding.

#### Header

```
;Tabelle: E46ZST.000                Index: co vom: 18.02.2002  NAEL: E3424.R
I co
U 20020218093000
V E46ZST.000
```

| Line | Meaning |
|------|---------|
| `;Tabelle: <name>   Index: <idx>  vom: <DD.MM.YYYY>  NAEL: <change-doc>` | Comment header, identifies the file revision. |
| `I <index>`  | Index letter (matches `Index:` from the comment). |
| `U <YYYYMMDDhhmmss>` | Generation timestamp. |
| `V <filename>` | Self-reference / verification name. |

After the header, free-form `;` comments document the change history.

#### Record types

Each non-comment line starts with a **type letter** followed by space-separated columns. Within the SA-bit section the typical record is:

```
;0902                 0000000000000040 0000000000 KEYCARDREADER
└──┬──┘               └──────┬───────┘ └────┬───┘ └──────┬──────┘
 SA code (or              FA bit-mask (10  Hex-extra    Function keyword
 prefix:                 hex chars,        flags (10    name (FSW)
  ;NNNN  SA            64-bit / 32+32)     hex chars)
  ;H NNNN  hidden
  ;HMM…  marker)
```

Columns are positional, **not** delimited by single spaces — they live at fixed column ranges. From inspecting `E46ZST.000`:

| Column range | Field | Notes |
|--------------|-------|-------|
| 1            | record-type letter (`;`/`H`/blank-`SA`/`#`/`?`) | `;<SA>` regular, `;H<SA>` historical/hidden, etc. |
| 2..7         | SA code (4-digit numeric) or prefix marker | e.g. `0902`. |
| 9..15        | optional secondary marker (`NNNN N…`, `BFD`, `PU01`, comment block) | |
| 22..37       | **SA-Maske** — 16 hex chars = 64-bit mask (little-endian byte order when written) | This is the bit-vector used by `coapiGetAswFromAuftrag` to mark which SA bits an FA expression sets. |
| 39..48       | **secondary mask** — 10 hex chars (32-bit ZCS-fragment / "Hex-extra") | |
| 50+          | **function keyword** — short identifier (e.g. `KEYCARDREADER`) | This name is what FSW/PSW rows in the binary CABD files reference. |
| trailing     | `// comment` (any `//` introduces a tail-comment) | |

Recognised line types inside `E46ZST.000`:

| First char | Use |
|-----------|-----|
| `;`       | Comment / SA-bit declaration (most numeric SA rows look like comments because they're `;NNNN`-prefixed for legacy reasons but are still consumed by the parser). |
| `H`       | "Hidden" SA — internal/development codes, may be ignored. |
| `*`       | Section separator decoration (visual only). |
| (blank)   | Continuation / explicit data line — same column structure as `;` rows. |

There are dedicated subsection bands in the file marked with `;****…` decorative lines:

- "Vergebene SA-Bits" — the SA bit-vector dictionary.
- "Codierbits" — FSW assignments.
- "Maerz01 receycelbar" / "Entwicklungsumfang" — pre-/post-release notes.

### 2.3 AT — Auftragsdatei (`<BR>AT.000`)

The Auftrag/FA shortname dictionary — every FA token used by the GUI's FA editor lives here. ASCII text with German comment blocks describing each entry's history.

```
// Auftragsdatei: E46AT.000
//         -350-
// Erstverw.Kogr.: 61.35
// Ident-Nummer: 6 938 570.5
DATUM 22.01.2007
//
// Aenderungsdokumentation:
// E E3354.P   b           Datei neu erstellt
// ...
```

| Line type | Meaning |
|-----------|---------|
| `DATUM DD.MM.YYYY` | File timestamp. |
| `// …`             | Comments (entire line). |
| `<TOKEN> …`        | FA-token declarations — actual production rules are appended after the comment headers. (Full grammar still being mapped — most operators look like `<TOKEN> <values>` with optional `// comment`.) |

Companion `.ZUS` file carries change-log / status info paralleling `.000`.

### 2.4 AT.M00 — compact M-list

A flat, line-oriented index used by the FA conversion stage. Lines start with a single letter denoting their category:

```
DATUM 22.01.2007
DATEINAME E46AT.M00
Z #0904
Z #0305
Z #0905
Z #0306
E EWS4
E ZHZN
…
W 0100
W 0103
W 0106
…
```

| Letter | Meaning | What it actually contains (E46) |
|--------|---------|---------------------------------|
| `W`    | "Wahl" — selectable option | **Both** SA codes (`205`, `880`) **and** C_TYP model variants (`BW32`, `EP31`, `BL91`). On E46: 419 numeric + 208 alpha. Distinguish C_TYP from SA by shape `^[A-Z]{2}[A-Z0-9]{2}$`, not category. |
| `Z`    | "Zeitpunkt" — production-update revision | `#`-prefixed date codes (`#0303`, `#0904`) — the marker that goes on the wire with `#` after the BR prefix. Sparse (4 entries on E46). |
| `E`    | "Entfällt" / fallback retrofit | Dealer/retrofit codes (`EWS4`, `ZHZN`). Overlaps with H/K — same codes appear under multiple letters. |
| `H`    | "Hinweis" / retrofit hint | Variants of E for retrofit-flagged options. |
| `K`    | retrofit/KSD variants | E46: MAYDAY, NOKIA, LEDH — dealer-installable hardware. |
| `A`    | (unverified) | E46: 10 alpha entries — purpose not yet mapped. |
| `DATUM`/`DATEINAME` | metadata header lines. |

**Critical caveat**: the AT category does **NOT** determine the FA wire marker. `205` (W numeric) takes `$` on the wire; `BW32` (W alpha) takes `*`; `N6SW` (W alpha in some FAs, missing in others) takes `&`. The marker is set by which structural slot the token occupies in `STANDARD_FA` — see `docs/fa-format.md §3` for the slot↔marker↔dictionary mapping and the type-shape heuristic used to split alpha-W into C_TYP vs SA.

`LACK` (paint), `POLSTER` (upholstery), and `ZUSBAU` (sales order) have **no AT dictionary entries** on E46 — they're factory-burned values with no chassis-shipped enumeration.

Records are 1 token wide and consumed by `coapiReadAuftrag` when parsing the M-list to seed the FA editor's drop-downs.

### 2.5 AT.ZUS — Zusatz

Plain text companion to `AT.000` carrying additional metadata and change-log entries; identical lexical conventions, no fixed record grammar.

### 2.6 SGFAM — SG family map (`<BR>SGFAM.DAT`)

The **central name-resolution table** for the chassis: every logical SG short-name (e.g. `EWS`, `KMB`, `MK60`) maps to its CABD module + SGBD job module + flags.

```
; SG    CABD     C_SGBD   ZCS FA KOMMENTAR

S AKMB  A_AKMB46 C_KMB46  0   1
S AEWS  A_AEWS3  C_EWS3   0   0
S ALC   A_ALCDS2 ALC_DS2  0   0
S BIT   A_BIT    C_BIT    0   0
S DSC   A_ASCDSC C_ASCDSC 0   0
S EWS   A_EWS3   C_EWS3   1   0
S KMB   A_KMB46  C_KMB46  1   0
```

| Column | Field   | Meaning |
|--------|---------|---------|
| 1      | type-letter `S` | Service-Steuergerät row. |
| 2      | `SG`    | Logical 3- to 5-char SG short-name (matches `SGNAME` in SGET / DST). |
| 3      | `CABD`  | CABD data-module name — resolves to a binary file under DATEN/`<BR>/A_*` (`A_EWS3` etc.). Used by `coapiReadCabd` to load coding rules. |
| 4      | `C_SGBD`| SGBD module name — the **EDIABAS `.PRG` / `.GRP`** to load and run jobs against (`C_EWS3` → SGBD `C_EWS3.prg`). |
| 5      | `ZCS`   | `0`/`1` flag — does this SG participate in ZCS? (Bit position implied by row order or by an extra column in some chassis.) |
| 6      | `FA`    | `0`/`1` flag — does this SG carry FA data? (i.e. whether the FA must be written here for the car-wide coding to succeed.) |
| 7+     | `KOMMENTAR` | Free-form trailing comment. |

`SGFAM` is what `coapiGetSgFamData` returns; it's the bridge from `<BR>SGET.000`'s "code these SGs" output to the actual filenames the CABD/EDIABAS layers need.

### 2.7 VARIABLE.ASC

ASCII source for `VARIABLE.DAT` — global variable definitions used across CABD modules. Lexical conventions match the rest of the text family (CRLF, `;` comments, fixed columns). Records define `<name> <type> [<initial-value>]`; not yet fully mapped — the binary form is what the runtime actually reads.

---

## 3. End-to-end: locating a coding rule

For a concrete vehicle (E46, FA contains SA `0902 KEYCARDREADER`, target ECU `KMB`):

1. `BR_REF.DAT` → resolve `E46` → directory `..\daten\e46\`.
2. `e46\E46DST.000` → look up `SGFAM` block → file `E46SGFAM.DAT`.
3. `e46\E46SGFAM.DAT` → row `S KMB A_KMB46 C_KMB46 1 0` → CABD = `A_KMB46`, SGBD = `C_KMB46`.
4. `e46\E46SGET.000` → search `SGAUSWAHL_VMSGBD` rows for `SGNAME=KMB` whose `AUFTRAGSAUSDRUCK` mask intersects the FA's SA mask. If miss, fall back to `SGAUSWAHL_SGBD`, then `SGAUSWAHL_VM`.
5. `e46\A_KMB46.Cxx` → load CABD; locate `PARZUWEISUNG_FSW` row whose `FSW = SWT-key-of("KEYCARDREADER")` (the FSW key lives in `SWTFSW.DAT`, resolved through `ZST.000`).
6. Apply the row's `WORTADR / BYTEADR / MASKE / OPERATION` to the netto data buffer — that's the byte/bit to flip.

---

## 4. Cross-references with the bimmerz POC

`~/Projects/my/bimmerz/packages/ncs-data/src/`:

- ✔ Frame framing + block triplet parsing.
- ✔ Scalar types `B`, `W`, `L`, `S` and `(X)`, `{X}` modifiers.
- ✘ `A` is consumed as **1 byte** — should be **5 bytes** (op + 4 operands).
- ✘ Range `XX(XX)` and non-empty `X(X)` lists are not yet distinct from `(X)`.
- ✔ CRC is already XOR-fold (`@bimmerz/core` `calculateCrc`).
- ✘ No text-format parsers yet (ZST, AT, SGFAM, AT.M00).

These deltas are what the next round of ncsx work should close.
