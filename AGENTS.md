# Working agreements for ncsx

Conventions that durably shape how this codebase is worked on. Update
when a new agreement is reached; don't relitigate them per session.

---

## 1. Don't guess NCSEXPER / INPA behaviour — verify with ghidra

For any question of the form "does NCSEXPER do X?" / "what job /
result / SGBD does it call?" / "where does field Y come from?", run
**ghidra MCP** before stating an answer. Quoting older docs or
inferring from the EDIABAS API surface has misled this work multiple
times — most recently:

- Initial claim "coding doesn't use IPO" — wrong; `A_KMB46.ipo` is
  the dispatcher (see `docs/ipo-usage.md` correction).
- Initial guess of `FA_LESEN` as the FA job — wrong; ghidra trace
  through `coapiReadAuftrag` (`0x0042f800`) shows it's `FA_READ`
  with result name `FA_STREAM`.
- Initial guess of `FG_NR_LANG` / `FG_NR` / `FGNR` as the VIN result
  field — wrong; ghidra trace through `coapiReadFgNr`
  (`0x0042e430`) shows it's `FAHRGESTELL_NR`.
- Initial guess of "one `ZCS` bytes field" for ZCS read — wrong;
  ghidra trace through `coapiReadZcs` (`0x0042b6e0`) shows three
  separate text results: `GM_SCHLUESSEL`, `SA_SCHLUESSEL`,
  `VN_SCHLUESSEL`.

### How to verify

| Tool                                              | When                                    |
|---------------------------------------------------|-----------------------------------------|
| `mcp__ghidra__list_strings` (filter)              | Find string constants                   |
| `mcp__ghidra__get_xrefs_to` (string address)      | Find what function uses that string     |
| `mcp__ghidra__decompile_function_by_address`      | Read the function body                  |
| `mcp__ghidra__search_functions_by_name`           | Find named functions (rare in NCSEXPER) |
| `pnpm cli disasm <path.ipo>` (from inpax repo)    | Inspect IPO bytecode                    |

Cross-check by inspecting both layers when the question spans them:
NCSEXPER.EXE for C functions (via ghidra), `.ipo` files for
interpreter bytecode (via inpax disasm). A claim is grounded when
the ghidra string xref + decompilation back it up.

### When ghidra isn't enough

Some behaviour lives in the SGBD `.prg` files (BEST/2 bytecode), not
in NCSEXPER.EXE. For those, `pnpm cli info / disasm` won't help —
EDIABAS doesn't ship an open-source disassembler for `.prg`. In
those cases, run the actual job against a live SG via
`packages/wire`'s direct path and read the raw EDIABAS response,
then document what came back.

### Always cite the address

When you state a finding, include the function address you saw it
at (`coapiReadAuftrag @ 0x0042f800`) so the next reader can repeat
the verification.

---

## 2. Architectural assumptions live in `docs/assumptions.md`

When a finding shapes how the rest of ncsx works, add an entry to
`docs/assumptions.md` (numbered, evidence-anchored). That doc is the
single source of truth for "this is the model we're building on" —
read it before designing anything new.

---

## 3. No hardcoded BMW lookup tables

Don't hand-roll `Map<chassis, ...>` or `const KNOWN_X = […]` for BMW
domain data. Derive from authoritative sources — DATEN binary tables
(BR_REF, SGFAM, SGAUSWAHL, SWT*, ZST), or NCSEXPER.EXE's symbol /
string tables. Acceptable hardcoded data: pure protocol/EDIABAS
constants (`SG_CODIEREN`, `JOB_STATUS`, `OKAY`), test fixtures, and
app-config defaults.

---

## 4. Explicit ECU selection — never auto-fire reads

ECU-targeted jobs (`readCoding`, `readVin`, `readFa`,
`applyCodingPlan`, …) only run from explicit user gestures. NCS
Expert always asks the user to pick the source ECU first; ncsx
mirrors that. The only thing that can happen on connect is
probe-style metadata that the cable already exposes — never
anything that talks to an ECU.

---

## 5. Pointer to docs

- `docs/STATUS.md` — entry point: where we are, what's next.
- `docs/assumptions.md` — load-bearing architectural assumptions.
- `docs/NCSEXPER-REVERSE-ENG.md` — ghidra notes inventory.
- `docs/ipo-usage.md` — IPO scope (per-CABD dispatcher, not main UI).
- `docs/ecu-selection.md` — SGAUSWAHL resolution + SG ↔ CABD-file rules.
