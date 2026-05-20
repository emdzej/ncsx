# NCSEXPER IPO analysis scripts

Tools for reverse-engineering NCSEXPER's bytecode runtime.

## Scripts

`dump-ipo.mjs` — prints constants, function list, and typed disassembly
of one (or all) functions in an IPO. Useful for spot-checking the
per-CABD `A_*.ipo` dispatchers and the cabimain switch. Needs the
inpax parser, run from `apps/ncsx-web/`:

    cd apps/ncsx-web
    node ../../docs/scripts/dump-ipo.mjs path/to/file.ipo [fnName] [fromPc] [toPc]

`infer-syscall-table.mjs` — walks every `.ipo` file in a directory,
filters to CABI-style scripts (those with `cabimain`), records every
`CALL sys N`'s FRAME→CALL push pattern, aggregates per slot. Output is
slot → dominant `(ins, refs)` shape with sample counts. Used to
cross-validate the runtime table.

    cd apps/ncsx-web
    node ../../docs/scripts/infer-syscall-table.mjs path/to/NCSEXPER/SGDAT

`extract-ncsserv-keyword-table.mjs` — extracts the CABI syscall
`slot → name` table from `ncsserv.exe`'s `.data` (16-bit NE binary, the
1996 Softing NCS-Server — predecessor to NCSEXPER.EXE's embedded
interpreter, same v1.x VM, same table). The keyword strings are stored
null-separated in slot-ID order; anchor on `settimer\0` and read off
sequentially. 99 entries, terminates at `CDHAuthGetRandom`. No
dependencies — runs standalone.

    # First extract ncsserv.exe from BMW's Ediabas 6.4.3 install:
    cd /tmp && mkdir cabi-extract && cd cabi-extract
    lha xq /path/to/Ediabas-6.4.3-full/Archive/CABI_RUN.LZH

    # Then run the extractor:
    node /path/to/ncsx/docs/scripts/extract-ncsserv-keyword-table.mjs

## Reference outputs

`ncsexper-cabi-syscall-table.txt` — the 99-entry CABI syscall table
extracted from `ncsserv.exe`. **Canonical mapping.** Slot 0x0D
(`CDHapiJob`) is the load-bearing apiJob bridge; cross-validated
against the 334k empirical `CALL sys` observations from the 915 CABI
IPOs in `NCSEXPER/SGDAT`.

`ncsexper-cabi-slots-empirical.txt` — bytecode-derived slot signatures
across the 915 CABI IPOs. Used to verify each name in the runtime
table matches its CABI.H declaration shape (68/68 match).

## Ghidra (NCSEXPER.EXE)

`FindCabiSyscallTable.java` — Ghidra Java script for NCSEXPER.EXE that
anchors on the known `apiJob` handler at `0x0044be90`. Less useful now
that the slot table is known from `ncsserv.exe`; keep it for mapping
each NCSEXPER.EXE handler address back to its slot, which we'll need
for behaviour analysis on any slot whose CABI.H signature is ambiguous.

## Why CABI-only

NCSEXPER's binary hardcodes its entry-point name lookup to
`cabimain` / `cabiexit` (writes at `0x004414d7` / `0x004414dd` in
`CDHIntInit`). There is no `"inpainit"` string anywhere in
`NCSEXPER.EXE`, so IPOs whose entry point is `inpainit` are not runnable
through NCSEXPER's VM.

`NCSEXPER/SGDAT/` ships **1,798 .ipo files**, but only 915 have
`cabimain` — the other 879 are `inpainit`-style scripts that BMW
bundles into the install for the `INPA.EXE` side of the toolchain.
They're shipped alongside but not invoked by NCSEXPER's interpreter.
Ignore them when analysing NCSEXPER's bytecode.
