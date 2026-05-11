# NCSEXPER Reverse-Engineering Docs

Reverse-engineering notes for BMW's **NCS Expertentool** (NCSEXPER 4.0.1, 2013) — the BMW factory coding tool we're recreating as a TypeScript port (`ncsx`), riding on the same engine stack as the sibling projects [`ediabasx`](https://github.com/mjaskolski/ediabasx) (EDIABAS) and [`inpax`](https://github.com/mjaskolski/inpax) (INPA).

## Read order

1. **[`NCSEXPER-REVERSE-ENG.md`](NCSEXPER-REVERSE-ENG.md)** — start here. Architecture, COAPI/CDH/INPA/EDIABAS stack, EDIABAS jobs the tool invokes, suggested re-implementation order.
2. **[`pfl-format.md`](pfl-format.md)** — PFL profile INI schema (every section, every key, value ranges, shipped profiles).
3. **[`daten-format.md`](daten-format.md)** — DATEN folder formats. Binary frame format (signature, frame types, format-string language, the `A` OPERATION 9-operator set, the `EINHEIT` 5-unit set) **and** the text-table family (`ZST`, `AT`, `SGFAM`, `AT.M00`, `AT.ZUS`, `VARIABLE.ASC`).
4. **[`ecu-selection.md`](ecu-selection.md)** — runtime flow: `(BR, VIN, ZCS, FA)` + profile → concrete ECU work list. Includes the `AUFTRAGSAUSDRUCK` byte-coded predicate grammar.
5. **[`trc-man-files.md`](trc-man-files.md)** — what NCSEXPER writes to `WORK\*.TRC` and `WORK\*.MAN`, and where the toggles live (it's a COAPI-side concern, not part of the EDIABAS protocol).
6. **[`coding-flow.md`](coding-flow.md)** — the end-to-end FSW/PSW ↔ netto-byte translation: ZST → CABD → OPERATION inversion → MASKE splice → `CODIERDATEN_SCHREIBEN`. Worked examples for both write (encode) and read (decode) directions.
7. **[`ssd-zut-format.md`](ssd-zut-format.md)** — `.ssd` / ZUT verifier record format (record-tag-driven script consumed by NCSEXPER's ZUT/VFP subsystems when `[VERIFIKATION].ZutEin=1` / `.VfpEin=1`).
8. **[`POC-DELTAS.md`](POC-DELTAS.md)** — concrete patch list against the existing `bimmerz/packages/ncs-data` TypeScript POC, mapped to line numbers + spec sections.

## Status

| Topic                                  | Status      |
|----------------------------------------|-------------|
| Architecture (COAPI/CDH/INPA/EDIABAS)  | ✔ done      |
| PFL schema                             | ✔ done      |
| PFL Lesemodus value ranges             | ✔ done      |
| PFL ProfilPruefsumme storage           | ✔ done (opaque) |
| DATEN binary frame format              | ✔ done      |
| DATEN `A` OPERATION (9 operators)      | ✔ done      |
| DATEN `EINHEIT` unit byte              | ✔ done      |
| DATEN text tables (ZST/AT/SGFAM/M00)   | ◐ structural, full grammars TBD |
| ECU selection flow                     | ✔ done      |
| `AUFTRAGSAUSDRUCK` grammar             | ✔ done      |
| EDIABAS jobs catalogue                 | ✔ done      |
| TRC / MAN file purpose                 | ✔ done      |
| Coding flow (FSW/PSW ↔ netto bytes)    | ✔ done      |
| `UMRSG` column                         | ✔ done      |
| `.ssd` / ZUT verifier record format    | ✔ done (record tags + handler family) |
| DATEN-frame CRC routine                | ✔ done (XOR-fold, mathematically verified) |
| ZCSUT update flow (`coapiChangeZcsVm`) | ✔ surface mapped (entry decomp + 3-tag output decoder); inner `<BR>ZCSUT.000` interrogation still deferred |
| Lesemodus enum value *names*           | ☐ deferred (only value `1` appears in shipped profiles; ranges & writer/reader confirmed) |
| `ProfilPruefsumme` editor write-path   | ☐ deferred (confirmed not on load/save round-trip; mutation lives in editor dialog OnSave) |
| `.ssd` `MASKE` / `UMRECHNUNG` value syntax | ☐ deferred (handler strings only hit error-log path; need a real `.ssd` sample) |

✔ done — confirmed in Ghidra + cross-referenced with sample files.
◐ partial — structure mapped, finer-grained grammar still being inferred.
☐ open — needs another Ghidra pass.

## External references

- NCS Dummy / `RE NCS Expert DATEN folder files structure.pdf` — mirrored in `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/Projekty/E46/NCS DATEN.md`. Authoritative DATEN-format notes carried over from the older project.
- [`inpax/docs/ipo-file-structure.md`](../../inpax/docs/ipo-file-structure.md) — IPO bytecode format used by the NCSEXPER scripts under `SGDAT\`.
- [`ediabasx/docs/`](../../ediabasx/docs/) — EDIABAS / BEST-VM internals; relevant for understanding how `apiJob()` calls dispatch.
- [`bimmerz/packages/ncs-data/`](https://github.com/mjaskolski/bimmerz) — existing partial DATEN parser POC; see [`POC-DELTAS.md`](POC-DELTAS.md) for the gaps it still needs to close.
