# Coding flow — how FSW/PSW edits become ECU bytes

This doc answers: **"how does NCSEXPER turn an `FSW = PSW` edit (whether typed in the manipulation dialog or read back from a `.MAN` file) into the bytes the ECU receives, and how does the symmetric read direction work?"**

Companion to:
- [`daten-format.md`](daten-format.md) — frame format, OPERATION operators, EINHEIT units, format-string mini-language.
- [`ecu-selection.md`](ecu-selection.md) — how the SG list is picked before any of this runs.
- [`trc-man-files.md`](trc-man-files.md) — what MAN/TRC files are and how they relate to the workflow.

---

## 1. The two halves of the pipeline

```
                          ┌──────────────┐
        DECODE (read)     │ FSW=PSW pair │      ENCODE (write)
                          │ (logical)    │
                          └──────┬───────┘
                                 │
                                 ▼
   ZST lookup  ▲           ┌──────────────┐           ZST lookup  ▼
               │           │ FSW id +     │                       │
               │           │ PSW value    │                       │
               │           └──────┬───────┘                       │
               │                  │                               │
       CABD .Cxx row lookup  ▲    │   ▼ CABD .Cxx row lookup       │
       (PARZUWEISUNG_FSW)    │    │   (same row)                   │
               │             │    │                               │
               │             │    │                               │
               ▼             │    │                               ▼
        ┌──────────────┐     │    │              ┌──────────────────┐
        │ apply OPS    │←────┘    └─────────────►│ invert OPS list  │
        │ apply EINHEIT│                         │ invert EINHEIT   │
        └──────┬───────┘                         └─────────┬────────┘
               │                                           │
        netto[WORTADR..WORTADR+BYTEADR]                netto[WORTADR..]
        masked-read with MASKE                          masked-write w/MASKE
               │                                           │
               ▼                                           ▲
   ┌────────────────────────────┐            ┌─────────────────────────────┐
   │ CODIERDATEN_LESEN          │            │ CODIERDATEN_SCHREIBEN       │
   │   (read netto from ECU)    │            │   (write netto to ECU)      │
   │   bytes ← bus              │            │   bytes → bus               │
   └────────────────────────────┘            └─────────────────────────────┘
```

Same three tables, traversed in opposite directions. Implementing the encode path is therefore "just the inverse of decode" — and the decode side is fully documented in `daten-format.md` §1.7-1.9.

---

## 2. The three tables that drive the translation

| Table              | File                          | Maps                                                 |
|--------------------|-------------------------------|------------------------------------------------------|
| **ZST**            | `<BR>ZST.000` (text)          | symbolic name ↔ numeric ID (FSW + PSW)               |
| **CABD**           | `<SGBD>.Cxx` (binary frames)  | FSW id → (`WORTADR`, `BYTEADR`, `MASKE`, `EINHEIT`, `OPERATION` list) — i.e. *where in the netto buffer this FSW lives and how to encode it* |
| **netto buffer**   | (RAM)                          | the raw byte buffer that crosses the EDIABAS wire    |

The pipeline is symbolic-to-numeric (ZST), numeric-to-rule (CABD), rule-to-bytes (OPERATION/EINHEIT/MASKE).

### 2.1 ZST — function/parameter dictionary

`<BR>ZST.000` is a text table (`;Tabelle: …` header). Each function-keyword (FSW) has:

- a row declaring its **FSW id** (a `u16` referenced by CABD),
- and a list of valid **PSW** (parameter) values, each with its own numeric code.

For binary FSWs (on/off): two PSWs, typically `nicht_aktiv=0` / `aktiv=1` or similar.
For multi-valued: e.g. country variant → several PSWs each with their integer.

A MAN file line `KEYCARDREADER = eingebaut` resolves through ZST to:
- FSW id `0x025F` (whatever ZST says for `KEYCARDREADER`)
- PSW value `0x01` (whatever ZST says for `eingebaut` *within* `KEYCARDREADER`'s parameter list)

### 2.2 CABD — per-SG byte-layout rules

`<SGBD>.Cxx` (binary frame file — see [`daten-format.md` §1.9](daten-format.md#19-per-file-role--binary-family)) is the SG's "where do bits live" dictionary. The key block is `PARZUWEISUNG_FSW`. Each row carries:

```ts
type ParzuweisungFSW = {
  BLOCKNR?: number;             // optional block index when the netto buffer is segmented
  WORTADR:  number;             // u32 LE — byte offset into the netto buffer
  BYTEADR:  number;             // u16    — width: number of bytes the field spans
  FSW:      number;             // u16    — FSW id (matches ZST)
  INDEX?:   number;             // optional u8 — for indexed FSWs (arrays)
  MASKE:    number[];           // collection of u8 — bit mask per byte position
  EINHEIT?: number;             // optional u8 — unit char (A/a/b/d/h)
  INDIVID?: number;             // optional u8 — individual flag
  // (Some rows also carry an OPERATION list; see daten-format.md §1.7)
};
```

Note that **`BYTEADR` is a count, not a second address** — it tells the decoder how many consecutive bytes at `WORTADR` belong to this field. `MASKE` is a collection of the same length, carrying the bit mask for each.

### 2.3 The netto buffer

A contiguous run of bytes — exactly what `CODIERDATEN_LESEN` returns and what `CODIERDATEN_SCHREIBEN` accepts. Length is per-SG (anywhere from a few bytes to hundreds for modern ECUs). The CABD rules are coordinate-into-this-buffer; the buffer itself has no internal structure visible to NCSEXPER.

---

## 3. ENCODE — FSW/PSW edit → netto bytes

Given a MAN-file edit (or any in-memory FSW/PSW change), produce the netto buffer to ship.

### Stage 1 — resolve symbols via ZST

```
ZST: "KEYCARDREADER"             → FSW id  0x025F
ZST: "eingebaut" (inside KCR)    → PSW val 0x01
```

If MAN already stored numeric IDs (some implementations do), skip this stage.

### Stage 2 — find the CABD rule

In the SG's `.Cxx`, scan `PARZUWEISUNG_FSW` rows for one with `FSW = 0x025F`. Return the row.

```
WORTADR  = 0x00000004
BYTEADR  = 0x0001
MASKE    = [0xFF]
EINHEIT  = 'h'
OPS      = []
```

If the row has an `INDEX` and the MAN edit also has an index (`KEYCARDREADER[2] = …`), match both.

### Stage 3 — invert OPERATION list

The OPERATION operators in CABD are defined for the **read** direction (apply them to the source bytes to recover the logical value). To encode, run the list **in reverse order** with each operator inverted:

| Read operator | Inverse for encode | Notes |
|---------------|---------------------|-------|
| `!`           | `!`                  | self-inverse |
| `+ n`         | `- n`                | |
| `- n`         | `+ n`                | |
| `> n`         | `< n` (left-shift)   | width-bounded |
| `* n`         | `/ n`                | (lossy if not divisible; in practice only used where it's safe) |
| `/ n`         | `* n`                | |
| `& n`         | `& n`                | self-inverse for the bits the mask covers; combine with the row's MASKE step |
| `\| n`        | `\| n`               | as above |
| `^ n`         | `^ n`                | self-inverse |

If the read path is `decode(bytes) = op_k(... op_1(EINHEIT(bytes)))`, the encode path is `encode(value) = EINHEIT⁻¹(op_1⁻¹(... op_k⁻¹(value)))`.

For our example (`OPS=[]`), this stage is a no-op: `0x01` passes through.

### Stage 4 — invert EINHEIT to produce source bytes

The EINHEIT char tells you how the **read** direction folds source bytes into a number. To encode, do the reverse:

| EINHEIT | Encode |
|---------|--------|
| `'h'`   | output `BYTEADR` raw bytes in LE order: u8 for width 1, u16 LE for 2, u32 LE for 4. |
| `'A'`   | output one ASCII hex digit per byte: `value < 10` → `'0'+value`; else → `'A' + value - 10`. |
| `'a'`   | output one raw ASCII byte = value as char. |
| `'d'`   | output the decimal digits of value, packed however the row's `MASKE` expects. |
| `'b'`   | output a bitstring: bit `i` → char `'0'` or `'1'` at position `i` of the source bytes. |

For our example (EINHEIT=`'h'`, width=1, value=`0x01`): emit `[0x01]`.

### Stage 5 — splice into the netto buffer with MASKE

```c
for (uint16_t i = 0; i < BYTEADR; i++) {
    uint8_t mask = MASKE[i];
    netto[WORTADR + i] &= ~mask;                  // clear the bits we own
    netto[WORTADR + i] |= (encoded[i] & mask);    // set them to the new value
}
```

The mask step is the load-bearing one: one byte at `WORTADR` may be shared by several FSWs, each owning a different bit slice. The mask makes the edit non-destructive to neighbouring fields.

For our example (`MASKE=[0xFF]`): the byte at `netto[0x04]` is entirely replaced by `0x01`.

### Stage 6 — wire transfer

Once every edit has been spliced into the netto buffer, the SG's IPO in `SGDAT\<C_…>.ipo` is entered with `SG_CODIEREN` (or whichever variant the profile picked — `SG_CODIEREN_OHNE_CI`, etc.). Inside the IPO:

```
apiJob("<SGBD>", "AUTHENTISIERUNG",       "",              "")  // unlock
apiJob("<SGBD>", "NORMALER_DATENVERKEHR", "NEIN",          "")  // quiet bus
apiJob("<SGBD>", "CODIERDATEN_SCHREIBEN", "<netto-hex>",   "")  // the write
apiJob("<SGBD>", "NORMALER_DATENVERKEHR", "JA",            "")  // restore
apiJob("<SGBD>", "SG_RESET",              "",              "")  // optional
```

`<netto-hex>` is the netto buffer formatted as ASCII hex (driven by `COAPI.INI [Filter].FswFilter=ASCII`). NCSEXPER's bridge (`FUN_0042580c` → `___apiJob_20`) forwards each call to `api32.dll`.

`apiResult*` is polled until `JOB_STATUS = OKAY`. Failure surfaces in the GUI as `Codierfehler`; success as `Codierung OK`.

---

## 4. DECODE — netto bytes → FSW/PSW values

Mirror of §3.

### Stage 1 — read netto from ECU

```
apiJob("<SGBD>", "CODIERDATEN_LESEN", "", "")
apiResult*       → "<netto-hex>" → parse to byte buffer
```

### Stage 2 — for each `PARZUWEISUNG_FSW` row in the SG's CABD

a. Extract `BYTEADR` bytes starting at `WORTADR`.
b. Apply the row's `MASKE`: `extracted[i] &= MASKE[i]`.
c. Apply EINHEIT: fold the `BYTEADR` source bytes into an integer value per the unit char (see [`daten-format.md` §1.8](daten-format.md#18-the-einheit-unit-byte)).
d. Apply each OPERATION in the row's list in order, transforming the value (see [`daten-format.md` §1.7](daten-format.md#17-the-a-operation-field)).
e. Result: numeric **PSW value** for this FSW.

### Stage 3 — resolve numeric → symbol via ZST

a. FSW id (the row's `FSW` field) → FSW name via ZST.
b. PSW value → PSW name via the FSW's parameter list in ZST.

Output: `FSW_name = PSW_name`, ready to display, save to a MAN file, or compare against a snapshot.

---

## 5. Worked end-to-end example

MAN file (3 edits):

```
KEYCARDREADER         = eingebaut
SWA                   = aktiv
BC_BASIS              = nicht_aktiv
```

ZST resolves:

```
KEYCARDREADER → FSW 0x025F   eingebaut    → 0x01
SWA           → FSW 0x0177   aktiv        → 0x01
BC_BASIS      → FSW 0x0150   nicht_aktiv  → 0x00
```

CABD rows in this SG's `.Cxx` (`PARZUWEISUNG_FSW`):

```
FSW=0x025F  WORTADR=0x04  BYTEADR=1  MASKE=[0x40]  EINHEIT='h'  OPS=[]   // KCR  bit 6
FSW=0x0177  WORTADR=0x04  BYTEADR=1  MASKE=[0x20]  EINHEIT='h'  OPS=[]   // SWA  bit 5
FSW=0x0150  WORTADR=0x04  BYTEADR=1  MASKE=[0x10]  EINHEIT='h'  OPS=[]   // BCB  bit 4
```

All three share `netto[0x04]`. Suppose the ECU currently returns `netto[0x04] = 0x0A` (binary `0000 1010`).

Splices:

```
KCR:  0x0A & ~0x40 = 0x0A   |  (0x01 & 0x40)? No — wait:
                              The PSW value 0x01 needs to be SHIFTED into the bit
                              slice the mask claims. The encoder must place the
                              value at the masked position.

Properly:
  byte_at_4 = (byte_at_4 & ~MASKE[i]) | ((value << trailing_zeros(MASKE[i])) & MASKE[i])
```

So for `KEYCARDREADER`, mask `0x40` has 6 trailing zeros, value `0x01` → `0x01 << 6 = 0x40`. Splice:

```
netto[0x04] = (0x0A & ~0x40) | (0x40 & 0x40)
            = 0x0A           | 0x40
            = 0x4A
```

Then SWA (mask `0x20`, value `0x01`, shift 5): `(0x4A & ~0x20) | (0x20 & 0x20) = 0x4A | 0x20 = 0x6A`.
Then BC_BASIS (mask `0x10`, value `0x00`, shift 4): `(0x6A & ~0x10) | (0x00 & 0x10) = 0x6A & 0xEF = 0x6A`.

(BC_BASIS bit was already 0.)

Final `netto[0x04] = 0x6A`. Other bytes unchanged.

Wire payload (assume SG has 8 coding bytes, others are `XX`):

```
XX XX XX XX 6A XX XX XX
```

Call:

```
apiJob("<SGBD>", "CODIERDATEN_SCHREIBEN", "XXXXXXXX6AXXXXXX", "")
```

> ⚠ **The mask-with-shift step is the trap.** A single-byte mask of `0xFF` (full byte) shifts by 0, so EINHEIT=`'h'` writes the raw value at the masked position — that's the simple case I used in earlier docs. For sub-byte masks, the encoder needs to multiply the value into the masked bit slice. The decode direction does the reverse — extract the masked bits, then right-shift by the mask's trailing-zero count.
>
> The CABD `OPERATION` list's `> n` operator is what makes the shift explicit on the **read** side: for bit slices spread across two bytes, you'll see `> n` operations to re-align them before they're concatenated. For aligned-within-a-byte masks (the common case), the row carries no OPERATION list and the trailing-zero shift is implicit.

---

## 6. Edge cases

### Indexed FSWs (`INDEX` field present)

Some FSWs are arrays — multiple PARZUWEISUNG_FSW rows share an FSW id but differ in `INDEX`. Example: `FAHRGESTELL_NR[1..17]` for the VIN. The MAN file format names indexed elements like `FAHRGESTELL_NR[1] = 'W'`; the encoder picks the CABD row whose `(FSW, INDEX)` pair matches.

### Multi-byte fields

`BYTEADR > 1` means the field spans multiple consecutive bytes. `MASKE` is then a list of the same length, one entry per byte. Each splice step iterates over both lists in lockstep.

### Bit fragments across two bytes

When a single logical value (typically a ZCS-key fragment) is stored across two bytes with a non-trivial OPERATION list, the read direction applies the operations to recover the value, and the write direction applies the inverses. Example from the NCS Dummy notes for `SA_SCHLUESSEL[17]`:

```
PARZUWEISUNG_FSW (read):
  WORTADR=0xFD  BYTEADR=1  MASKE=[0x03]  OPS=[> 4]   // upper 2 bits go to position 4..5
  WORTADR=0xFE  BYTEADR=1  MASKE=[0xF0]  OPS=[]      // lower 4 bits as-is

Encoding the inverse:
  given 6-bit value V (0..63)
    high_part = V >> 4              (was: read shifted by 4)
    low_part  = V & 0x0F            (was: read masked 0xF0)
    netto[0xFD] = (netto[0xFD] & ~0x03) | high_part
    netto[0xFE] = (netto[0xFE] & ~0xF0) | (low_part << 4)
```

### OPERATION inversion ambiguity

`& n`, `| n`, `^ n`, `*` and `/` can be lossy in the read direction (they discard bits). In practice, the CABD files don't combine those with general-purpose masks — they use them as *normalizers* for fields that already fit, so the inverse is well-defined as the same operator (for `& | ^`) or as the dual (`* n` ↔ `/ n`). If you ever hit a row whose OPS make the inverse ambiguous, fall back to "skip this FSW, log a warning" — NCSEXPER does the same.

### EINHEIT for write-only / read-only fields

Some PARZUWEISUNG_FSW rows are flagged `INDIVID=1` — they only apply during individual coding (Car & Key Memory). Skip them when bulk-coding from a MAN file unless the profile is set up for it.

### Default ANLIEFERZUSTAND

If `CODIERDATEN_LESEN` fails or the SG was never coded, the netto buffer starts from the CABD's `ANLIEFERZUSTAND` block (factory defaults). The encode pipeline is otherwise identical.

---

## 7. Where each piece lives in NCSEXPER

| Stage                              | Routine / source-module       | Notes |
|------------------------------------|--------------------------------|-------|
| Parse MAN file                     | `coapiReadFswPsw` (when `FswPswLeseDatei` is set) or the manipulation dialog | MAN is also the output destination for the dialog. |
| FSW/PSW name → ID (ZST)            | text-table parser over `<BR>ZST.000` | (ncsx implementation gap — see `POC-DELTAS.md`) |
| Find PARZUWEISUNG_FSW row (CABD)   | `coapiRunCabd` / `CDHGetFswDataFromCbd` | per-SG `.Cxx` walker |
| Apply OPERATION + EINHEIT (read)   | `GetDataFromOperation` (`FUN_004575c0` in `CBD_READ.C`) | fully decoded in [`daten-format.md` §1.7-1.8](daten-format.md#17-the-a-operation-field) |
| Invert OPERATION + EINHEIT (write) | `coapiGetNettoDataFromCbd` / `CDHGetNettoDataFromCbd` / `CDHSetNettoMaskData` | symmetric inverse — see §3 above |
| Splice with MASKE                  | `CDHSetNettoMaskData`          | the AND-NOT / OR step |
| Wire transfer                      | per-SG IPO in `SGDAT\` → `apiJob` → `api32.dll::__apiJob@20` | wrapper in `FUN_0042580c` |
| Format netto buffer as hex string  | `COAPI.INI [Filter].FswFilter=ASCII` | `BINARY` and `NONE` modes also exist but are rare |
| Audit log                          | `coapiTraceFswPsw` (writes the FSW/PSW table to `WORK/<FswPswTraceFile>`), `coapiTraceNettoData` (writes the raw bytes) | observability only — see [`trc-man-files.md`](trc-man-files.md) |

---

## 8. Re-implementation hints for ncsx

To do a full code cycle in ncsx from a MAN-style edit list, you need (in order):

1. **PFL parser** — to know which Lesemodus is in effect and where `FswPswLeseDatei` points. ([`pfl-format.md`](pfl-format.md))
2. **DATEN binary frame parser** — for `<BR>SGFAM.DAT`, `<SGBD>.Cxx`. ([`daten-format.md` §1](daten-format.md#1-binary-frame-format))
3. **DATEN text parser** — for `<BR>ZST.000` and friends. ([`daten-format.md` §2](daten-format.md#2-text-table-format))
4. **CABD decoder + encoder** — read direction first (matches the `GetDataFromOperation` recipe verbatim), then invert each step for the write direction.
5. **MAN reader/writer** — same lexical conventions as the text family (CRLF, ISO-8859-1, `;` comments, `KEY = VALUE`). Output-only writer is enough to start; reader is needed for `FswPswLeseDatei` round-trips.
6. **EDIABAS wrapper** — `apiJob` / `apiResult*` bindings, IPO interpreter (reuse `inpax`) to invoke per-SG entry points.

The encode side is **purely an inversion** of the decode side — no new tables, no new file formats. If you have a working decoder (which the bimmerz POC almost does, modulo the bugs in [`POC-DELTAS.md`](POC-DELTAS.md)), writing back is half a day's work.
