# NCSEXPER IPO analysis scripts

Tools for reverse-engineering NCSEXPER's bytecode runtime. Most need the
inpax parser, so run them from `apps/ncsx-web/` (where the dep is installed):

    cd apps/ncsx-web
    node ../../docs/scripts/dump-ipo.mjs <path/to/file.ipo> [fnName] [fromPc] [toPc]
    node ../../docs/scripts/infer-syscall-table.mjs <path/to/NCSEXPER/SGDAT>

`dump-ipo.mjs` prints the constants, function list, and a typed disassembly
of one (or all) functions in an IPO. Useful for spot-checking the per-CABD
A_*.ipo dispatchers.

`infer-syscall-table.mjs` walks all `.ipo` files in a directory, **filters
to CABI-style IPOs only** (those whose function table contains `cabimain` —
the ones NCSEXPER actually runs), and for every `CALL sys N` records the
push pattern between `FRAME` and the matching `CALL`. Aggregates per slot.

The latest output is committed at `ncsexper-cabi-slots-empirical.txt` —
71 distinct slots in 915 CABI IPOs, ~334k sys-calls, most with 100% sig
confidence.

`DumpNcsexperSyscallTable.java` / `FindSyscallTableInit.java` were earlier
ghidra-side attempts to find the runtime dispatch table. They didn't crack
it directly — the table isn't a static initialiser, and the immediate-store
pattern came up empty. The follow-up is `FindCabiSyscallTable.java` which
locates the table by scanning `.rdata` / `.data` for known handler
addresses (the ones we identified via `FUN_0045efa0` xref analysis —
e.g. `0x0044be90` is the `apiJob` bridge).

## Why CABI-only

NCSEXPER's binary hardcodes its entry-point name lookup to
`cabimain` / `cabiexit` (writes at `0x004414d7` / `0x004414dd` in
`CDHIntInit`). There is no `"inpainit"` string anywhere in
`NCSEXPER.EXE`, so IPOs whose entry point is `inpainit` are not runnable
through NCSEXPER's VM.

The NCSEXPER/SGDAT directory ships **1,798 .ipo files**, but only 915 have
`cabimain` — the other 879 are `inpainit`-style scripts that BMW bundles
into the install for the INPA.EXE side of the toolchain. They're shipped
alongside but not invoked by NCSEXPER's interpreter. Ignore them when
analysing NCSEXPER's bytecode.
