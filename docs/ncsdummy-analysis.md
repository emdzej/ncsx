# NCSDummy — analysis & ncsx incorporation plan

Goal of this doc: explain what NCSDummy (the .NET WinForms tool by *revtor*, v0.6.0.9, 2019) does
end-to-end, anchor each piece to concrete source in the decompiled C# tree, and lay out what new
packages ncsx needs to deliver the same "edit BMW coding by ticking checkboxes" experience.

Decompiled source lives at `~/Projects/my/ncsx-research/ncsdummy-src/` (produced from
`/Users/mjaskols/Downloads/inpa/BMW SOFTWARE/NCS Dummy/NcsDummy.exe` with
`ilspycmd -p --nested-directories`). Refer to `NcsDummy/Classes/...` paths below as relative to
that root.

---

## 1. What NCSDummy actually is

NCSDummy is **not** a coder; it does not talk to the ECU. It is a friendly editor for the four
text files that NCS Expert reads/writes against `C:\NCSEXPER\WORK\`:

| File                 | Direction in NCS Expert | What it contains                          |
|----------------------|--------------------------|-------------------------------------------|
| `FSW_PSW.TRC`        | written by NCS Expert    | The SG's current coding, as FSW/PSW names |
| `NETTODAT.TRC`       | written by NCS Expert    | The SG's current coding, as raw bytes     |
| `FSW_PSW.MAN`        | read by NCS Expert       | "Apply these FSW/PSW changes"             |
| `NETTODAT.MAN`       | read by NCS Expert       | "Apply these raw-byte changes"            |

Workflow: user runs NCS Expert to dump `.TRC` files from the car → opens them in NCSDummy →
ticks/unticks options → exports a `.MAN` file → runs NCS Expert again to flash. NCSDummy reads
the **same DATEN files** that NCS Expert ships (`C:\NCSEXPER\DATEN\<chassis>\*`), so it knows
which (FSW, PSW) maps to which byte/mask in the ECU memory.

PDF manual at `/Users/mjaskols/Downloads/inpa/BMW SOFTWARE/NCS Dummy/ncsdummy.pdf` is the
authoritative user-facing reference.

---

## 2. The four trace files — concrete formats

Reader: `Classes/FswPswNettodatas/FswPswNettodataListReader.cs:68-78` (mode sniffer regexes).

### 2.1 FSW/PSW trace (`*.TRC` or `*.MAN`)

Plain text, one FSW per outer line, parameters indented with a tab:

```
LENKSEITE_LSZ
	wert_01
KALTUEBERWACHUNG_BL_MI
	nicht_aktiv
KALTUEBERWACHUNG_BL
	aktiv
```

Sniff regex: `^[^\s]+$` (any non-whitespace token on a line by itself starts FSW mode).
Parse regex: `^((?<functionkeyword>[^\s]+)|[\s]+(?<parameterkeyword>[^\s]+))$`.

Writer: `Classes/TraceFunctions/FswPswTraceFunctionListWriter.cs:34-116`.
Filters items to those that are `Checked && (Function|Unresolved)`, orders by FSW identifier,
prints each FSW header followed by tab+PSW lines (dedup'd, only checked PSWs).

### 2.2 Nettodata trace (`*.TRC` or `*.MAN`)

Plain text, two record types, all hex, no whitespace inside a record:

```
B AAAAAAAA,LLLL,XX,XX,XX,...        ; resolved consecutive bytes (or words)
M AAAAAAAA,LLLL,MM,VV               ; one masked byte (mask, value) at AAAAAAAA
```

- `AAAAAAAA` = 32-bit hex block-address (`Nettodata.BlockAddress(block, address, isWord)`).
- `LLLL` = number of values in the record (hex).
- Byte-mode: each value is 2 hex digits. Word-mode: 4 hex digits.
- `B` rows = `length` consecutive fully-resolved values starting at `AAAAAAAA`.
- `M` row = one address with mask `MM` and value `VV` (used when only some bits are owned).

Sniff regex: `^(B|M) [0-9A-F]{8},[0-9A-F]{4},([0-9A-F]{4}(,[0-9A-F]{4}){0,7}|[0-9A-F]{2}(,[0-9A-F]{2}){0,15})$`.

Writer logic: `Classes/TraceFunctions/NettodataTraceFunctionListWriter.cs:35-150`. For every
checked function/property/unoccupied node it accumulates `(data & mask)` into a
`NettodataList` keyed by block-address (masks OR-merge when multiple FSWs share a byte).
Then it walks the list: fully-masked entries (`mask == FF` or `FFFF`) get coalesced into `B`
runs of up to 16 bytes / 8 words; everything else emits an `M`.

This is exactly the encode side of ncsx's `packages/cabd` `encodeFsw` + the per-SG netto buffer
in `packages/coder`. Same algorithm, different output target (text file vs `apiJob` bytes).

### 2.3 What ncsx already covers vs the gap

| ncsx today                                        | NCSDummy equivalent                                              |
|---------------------------------------------------|------------------------------------------------------------------|
| `packages/cabd` encode → `Uint8Array` of netto    | `NettodataTraceFunctionListWriter` → `B`/`M` text records       |
| `packages/cabd` decode (netto → FSW/PSW name)     | `TraceFunctionListReader` MAN branch (lines 84–155)             |
| nothing                                           | FSW_PSW.TRC/.MAN reader+writer (1 day of work)                  |
| nothing                                           | NETTODAT.TRC/.MAN reader+writer (B/M record format) (1 day)     |

---

## 3. In-memory data model

Three layers, all live in TreeView nodes (this is WinForms, but the hierarchy maps cleanly to
a plain JSON-ish tree).

### 3.1 `FunctionList` — the DATEN catalog

Built once per (chassis, module, codingIndex) by `Classes/Functions/FunctionListReader.cs`.
Items:

| Item type (base `FunctionListItem`)         | What it represents                                  |
|---------------------------------------------|-----------------------------------------------------|
| `FunctionListItemFunction`                  | An FSW with a defined PSW list (most common)        |
| `FunctionListItemProperty`                  | An FSW with no enumerated PSWs — value is a formula |
| `FunctionListItemUnoccupied`                | A byte range the SG doesn't actively code           |
| `FunctionListItemCodingDataGroup`           | UI grouping (`CODIERDATENBLOCK_LLWS`)               |
| `FunctionListItemManufacturerDataGroup`     | UI grouping (`HERSTELLERDATENBLOCK_LLWS`)           |
| `FunctionListItemReservedDataGroup`         | UI grouping (`RESERVIERTDATENBLOCK_LLWS`)           |
| `FunctionListItemMask` (abstract)           | Common base for anything with `(block, addr, mask)` |

Each `Function` has child `ParameterListItem` nodes (one per allowed PSW).
A `Property` has no PSW children — instead it carries a `Mask`, `Operation`, `Unit`, and
optional `Array`/`ArrayIndex` to support indexed properties (`KEY[0]`, `KEY[1]`, …).

### 3.2 `TraceFunctionList` — the working overlay

Built by `Classes/TraceFunctions/TraceFunctionListReader.cs`. Clones `FunctionList` and
overlays it with the contents of either an FSW/PSW trace or a Nettodata trace:

- If TRC is FswPsw: for each function, mark the matching PSW children as `Checked = true`.
  Unresolved keywords become `TraceFunctionListItemUnresolved`.
- If TRC is Nettodata: for each function, call `NettodataList.GetBytes(block, addr, len, mask)`
  to extract the bytes covered by this FSW. If those bytes match a known PSW, check it; if
  no PSW matches, add a synthetic `TraceParameterListItemCustom` showing the raw bytes plus
  a formula-decoded string.

Property nodes get filled the same way for nettodata mode (their byte values come straight from
the trace). Unresolved nettodata bytes that don't fit any function become
`TraceFunctionListItemUnknown` at the right address.

This is the **canonical model the rest of NCSDummy operates on**. Exporting back is "walk the
overlay, write out the checked rows". Two writers consume the same overlay, producing TRC vs
MAN.

### 3.3 `OptionFunctionList` — the friendly-UI filter

Built by `Classes/Options/OptionListReader.cs` from a **CVT DATEN file** (different file than
the per-SG coding DATEN; one per BR). Shape:

```ts
type OptionFunctionList = OptionFunctionListItem[]
type OptionFunctionListItem  = { Identifier: FSW_id; ParameterList: OptionParameterList }
type OptionParameterList     = OptionParameterListItem[]
type OptionParameterListItem = { Identifier: PSW_id; Options: AUFTRAGSAUSDRUCK_bytes }
```

The reader pairs each `AUFTRAGSAUSDRUCK_A` record with the immediately-following
`FSW_PSW_WW` record, gated to **group** blocks only (`GRUPPE_S` enters, `INDIVID_S` exits).
Multiple AUFTRAGSAUSDRUCK fragments for the same `(FSW,PSW)` are concatenated with an
ASCII comma — see `OptionParameterListItem.AddOptions` — producing a single byte array
that's an OR-of-conjunctions of FA tokens. (ncsx already evaluates this byte language in
`packages/predicate`.)

The result is what the UI shows under "Options:" in each parameter row — e.g.
`(ALPINA_S85B50+GOLF)+KMBI_CI_06` — and it's purely informative; NCSDummy does **not**
auto-filter PSWs by FA. The user reads the order options to decide what to tick.

---

## 4. DATEN fields NCSDummy parses

NCSDummy decodes ~80 distinct DATEN field types via `Classes/Daten/Fields/`. Compared to
ncsx today, the ones we don't yet fully model (but need to, to build the catalog) are:

| Field                          | Meaning                                                     |
|--------------------------------|-------------------------------------------------------------|
| `PARZUWEISUNG_FSW_LLWWBBBB`    | Function: length, address, byte-block, byte-addr, mask…     |
| `PARZUWEISUNG_PSW1_WB`         | First PSW (id + first chunk of value bytes)                 |
| `PARZUWEISUNG_PSW2_B`          | Continuation bytes for the previous PSW                     |
| `PARZUWEISUNG_DIR_LLWWBBAB`    | "Direct" / property assignment (mask + operation + unit)    |
| `MASKE_SAA`                    | Mask definition (referenced by properties)                  |
| `UMRECHNUNG_SAASAA`            | Conversion formula (op + unit) for property values          |
| `SPEICHERORG_SS`               | `BYTE` / `WORDMSB` / `WORDLSB` + `FREI`/`BLOCK` memory type |
| `ANLIEFERZUSTAND_B`            | Delivery-state default bytes                                |
| `UNBELEGT1_LLWBB` / `UNBELEGT2_B` | Unoccupied byte range header + fill values               |
| `CODIERDATENBLOCK_LLWS`        | UI group header ("CODING DATA BLOCK")                       |
| `HERSTELLERDATENBLOCK_LLWS`    | UI group header ("MANUFACTURER DATA BLOCK")                 |
| `RESERVIERTDATENBLOCK_LLWS`    | UI group header ("RESERVED DATA BLOCK")                     |
| `SGID_CODIERINDEX_BB`          | SG coding indices this DATEN is valid for                   |
| `SGID_HARDWARENUMMER_SS`       | SG HW versions this DATEN is valid for                      |
| `SGID_SWNUMMER_SS`             | SG SW versions this DATEN is valid for                      |
| `KENNUNG_*`                    | Identification/checksum records                             |

All of these live alongside the AT / SGAUSWAHL / FSW_PSW_WW / AUFTRAGSAUSDRUCK fields ncsx
already parses — same outer DATEN frame format, ncsx's `packages/daten` reader already
unpacks the frames correctly.

Field definitions in NCSDummy work through `DatenDefinitionBuilder` (reads the header
block defining field layouts) → `DatenFieldBuilder` (decodes each frame to a typed
`DatenField`). ncsx's `packages/daten` already has this two-pass design; we just need to add
the extra typed field classes.

---

## 5. Other features worth knowing

- **Translations**: `Translations.csv` (1 MB) maps FSW/PSW keywords → English. Loaded via
  `Classes/Translations/`. Community-maintained.
- **Multi-word functions**: same FSW name appears twice across two addresses with the same
  PSW children. NCSDummy ties them together (`Add()` in `TraceFunctionList:70-80`) so editing
  one updates the other. ncsx coder already handles multi-byte values inherently; this is
  purely a UI concept.
- **Custom parameters**: when MAN-mode reading finds bytes that don't match any defined PSW,
  it inserts a `TraceParameterListItemCustom` so the user keeps the value but sees it as
  "not one of the standard options". Powered by `Classes/Formulas/Formulas.cs` (1982 lines —
  per-(chassis,module,FSW) decoders for properties like VIN, dates, speed limits, etc.).
- **Trace differences**: `Classes/Differences/` — overlays two trace files and highlights
  what changed. UI-only sugar.
- **Disassembly/checksums tab**: `Panels/DisassemblyAndChecksums.cs` + `Classes/Daten/*` round-
  trip (DATEN → text disassembly → DATEN reassembly). Adjacent functionality; not on the
  critical path for "edit coding".
- **CRC16, Mod36 checksums**: `Classes/Checksums/` (tiny). Used during DATEN reassembly and
  ZST checksum updates (matches our `packages/daten` CRC plus an additional Mod36 for ZST).
- **Mask semantics doc**: PDF section 3.1.2 ("Control Unit Data") — `address` 32-bit, `length`
  bytes covered, `mask` bits owned, `data` raw, `masked = data & mask`. Same model as ncsx.

---

## 6. Source-code anchors (so future-me can re-trace)

| Concept                       | File                                                                                |
|-------------------------------|-------------------------------------------------------------------------------------|
| Program entry                 | `NcsDummy/Program.cs`                                                               |
| Main window + work-folder UI  | `NcsDummy/Main.cs` (1685 LoC)                                                       |
| Modules-and-Traces panel      | `NcsDummy/Panels/ModulesAndTraces.cs:1372` (TRC filename pattern), `:1530–1810`     |
| TRC/MAN auto-load buttons     | `Panels/ModulesAndTraces.cs:1498–1535, 1701–1818, 1878–1902`                        |
| DATEN frame loop              | `Classes/Functions/FunctionListReader.cs:55–250`                                    |
| DATEN field decoder           | `Classes/Daten/Fields/DatenFieldBuilder.cs`                                         |
| DATEN definition decoder      | `Classes/Daten/Definitions/DatenDefinitionBuilder.cs`                               |
| AT (FA-token) list reader     | `Classes/Daten/AtListReader.cs`                                                     |
| ZST (state) list reader       | `Classes/Daten/ZstListReader.cs`                                                    |
| Options/CVT reader            | `Classes/Options/OptionListReader.cs`                                               |
| FSW/PSW trace reader          | `Classes/FswPswNettodatas/FswPswNettodataListReader.cs`                             |
| Nettodata trace reader (mode B) | `FswPswNettodataListReader.cs:119–135`                                            |
| Trace overlay builder         | `Classes/TraceFunctions/TraceFunctionListReader.cs`                                 |
| FSW/PSW trace writer          | `Classes/TraceFunctions/FswPswTraceFunctionListWriter.cs`                           |
| Nettodata trace writer        | `Classes/TraceFunctions/NettodataTraceFunctionListWriter.cs`                        |
| Per-FSW property formulas     | `Classes/Formulas/Formulas.cs`                                                      |
| CRC16 / Mod36                 | `Classes/Checksums/Crc16.cs`, `Classes/Checksums/Mod36.cs`                          |
| Keyword (name → id) lists     | `Classes/Keywords/KeywordListReader.cs`                                             |

---

## 7. Mapping NCSDummy → ncsx today

| NCSDummy area                    | ncsx today                                                                  | Status     |
|----------------------------------|------------------------------------------------------------------------------|------------|
| DATEN frame parser               | `packages/daten` (binary frame + definition+field two-pass)                  | ✅ ready   |
| AT/ZST/SGFAM text-table          | `packages/text-tables`                                                       | ✅ ready   |
| SGAUSWAHL → SG list              | `packages/ecu-select`                                                        | ✅ ready   |
| AUFTRAGSAUSDRUCK predicate eval  | `packages/predicate`                                                         | ✅ ready   |
| Chassis bundle + swt lookups     | `packages/chassis`                                                           | ✅ ready   |
| FA → ASW                         | `packages/fa-asw`                                                            | ✅ ready   |
| FSW/PSW → netto encode           | `packages/cabd` + `packages/coder`                                           | ✅ ready   |
| Netto → FSW/PSW decode           | `packages/cabd` (decode)                                                     | ✅ ready   |
| Module catalog (FunctionList)    | partial: ncsx coder iterates `chassis.swtFsw`, no typed FunctionList model   | gap        |
| Property formulas (VIN/date/…)   | none                                                                         | gap        |
| Options/CVT layer                | none — predicate decoder exists, but no per-(FSW,PSW) AUFTRAGSAUSDRUCK index | gap        |
| TRC/MAN file IO (both kinds)     | none                                                                         | **gap**    |
| TraceFunctionList overlay        | none                                                                         | **gap**    |
| Translations (CSV)               | none                                                                         | nice-to-have |
| Multi-word linkage               | n/a (we already encode whole values atomically)                              | n/a        |

---

## 8. Incorporation plan

Phased, in priority order. Aim is to give ncsx everything required to **read TRC, edit, write
MAN** with the same correctness guarantees NCSDummy gives, plus a clean API surface so a
future web/CLI UI can sit on top.

### Phase A — DATEN catalog (foundation)

**New package:** `packages/function-list/`

Builds a typed `FunctionList` for a given (chassis, module) by walking the SG's coding DATEN
and emitting one item per `PARZUWEISUNG_FSW_LLWWBBBB`, `PARZUWEISUNG_DIR_LLWWBBAB`,
`UNBELEGT1_LLWBB`, and the three group headers. Extend `packages/daten` field-type table to
recognise the dozen DATEN fields listed in §4 above (most decoding is mechanical from the
field-name suffixes — `LLWWBBBB` etc. are length codes).

Output shape (proposed):

```ts
type FunctionListItem =
  | { kind: 'function';     block; addr; length; mask; fsw; psws: PswItem[] }
  | { kind: 'property';     block; addr; length; mask; fsw; operation; unit; arrayName?; arrayIndex? }
  | { kind: 'unoccupied';   block; addr; length; mask; fillBytes }
  | { kind: 'group';        block; addr; length; description; groupKind: 'coding'|'manufacturer'|'reserved' }
```

Cost estimate: ~600 LoC + tests.

### Phase B — TRC/MAN file IO

**New package:** `packages/trace/`

Two parsers (FSW/PSW vs Nettodata) using the regex grammar from §2, two writers using the
encoder logic from §2.2. The Nettodata writer can reuse `packages/cabd`'s per-address
accumulator unchanged; the only new code is the coalescing into `B`/`M` records.

Output of both parsers: a `TraceOverlay` (the typed version of `TraceFunctionList`) — a
`FunctionList` with `checked: boolean` on every parameter plus an optional
`custom: { bytes, decoded }` for nettodata bytes that didn't match a known PSW.

Cost estimate: ~400 LoC + tests (sample files at
`/Users/mjaskols/Downloads/inpa/BMW SOFTWARE/NCS Dummy/` and elsewhere on disk; we should
collect some real `*.TRC`/`*.MAN` from the user's machine for integration tests).

### Phase C — Options layer (friendly UI)

**New package:** `packages/options/` (or fold into `function-list`)

Implements `OptionListReader` against the chassis-level CVT DATEN file. Output is the
`OptionFunctionList` shape from §3.3 but with the AUFTRAGSAUSDRUCK already evaluated against
a given FA — so each PSW carries a `applicableUnderFA: boolean` boolean, plus the original
predicate string for display.

This is what unlocks a real UI: "show only PSWs valid for this car". Pairs naturally with
`packages/predicate` (already done) and `packages/fa-asw` (already done).

Cost estimate: ~200 LoC + tests.

### Phase D — Property formulas

`Classes/Formulas/Formulas.cs` is 1982 lines of per-(chassis, module, FSW) ad-hoc decoders
(speed lookups, VIN encoding, date packing, …). We do not need parity for an MVP — when no
formula matches, show the raw bytes (NCSDummy degrades the same way). Port incrementally as
real properties come up.

### Phase E — CLI / API surface

With A–C in place, the existing `packages/coder` planner can grow a sibling that emits
TRC/MAN instead of (or in addition to) calling `apiJob`. Natural API:

```ts
const overlay = await readTrace('FSW_PSW.TRC', functionList);
overlay.set('KEYCARDREADER', 'eingebaut');
await writeTrace('FSW_PSW.MAN', overlay, { format: 'fswpsw' });
// or
await writeTrace('NETTODAT.MAN', overlay, { format: 'nettodata' });
```

This is exactly how NCSDummy's "Export FSW_PSW.MAN" / "Export NETTODAT.MAN" buttons work —
the in-memory model is read-once, write-many.

### Phase F (later, optional) — Translations + UI

Translations.csv is community-maintained and 1 MB. We can ship it as-is and treat translation
lookup as a UI concern (not a coding concern). Same with the HEX trace viewer and Trace
Differences feature — pure UI sugar on top of the TraceOverlay.

---

## 9. Decisions to make before starting Phase A

1. **Do we want translations in core or in the UI layer?** Recommendation: UI layer (keeps
   `function-list` deterministic and translation-free).
2. **Where do per-FSW formulas live?** Recommendation: `packages/property-formulas/`, lazy
   loaded by chassis name (mirroring NCSDummy's `Formulas.cs` switch on chassis).
3. **Strict mode on/off for TRC reading?** NCSDummy exposes `strictFswPswTraceFileReading` and
   `strictNettodataTraceFileReading` as user settings — strict = throw on unresolved/conflicting,
   non-strict = warn and continue. Recommendation: same flag, default non-strict.
4. **Naming**: NCSDummy says "trace file" for both TRC and MAN. We should keep that vocabulary
   to match the user manual, and reserve "MAN" only for the file extension/role.

---

## 10. References

- PDF user manual: `/Users/mjaskols/Downloads/inpa/BMW SOFTWARE/NCS Dummy/ncsdummy.pdf`
- Decompiled source: `~/Projects/my/ncsx-research/ncsdummy-src/`
- Re-decompile command: `ilspycmd -p --nested-directories -o <out> <NcsDummy.exe>`
  (install with `dotnet tool install -g ilspycmd`)
- Bimmerforums thread (manual links here): http://forums.bimmerforums.com/forum/showthread.php?t=1553779
