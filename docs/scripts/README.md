# IPO analysis scripts

Ad-hoc tooling for reverse-engineering NCSEXPER's runtime. Most need the
inpax parser, so run them from `apps/ncsx-web/` (where the dep is installed):

    node ../../docs/scripts/dump-ipo.mjs <path/to/file.ipo> [fnName] [fromPc] [toPc]
    node ../../docs/scripts/infer-syscall-table.mjs <path/to/NCSEXPER/SGDAT>
    node ../../docs/scripts/match-syscall-table.mjs

`dump-ipo.mjs` prints the constants, function list, and a typed disassembly
of one (or all) functions in an IPO. Useful for spot-checking a single
dispatcher.

`infer-syscall-table.mjs` walks all `.ipo` files in a directory and, for
every `CALL sys N` it sees, records the (in-args, out-refs) shape pushed
between the preceding `FRAME` and the call. Aggregates per-slot stats —
gives you NCSEXPER's empirical syscall table by frequency.

`match-syscall-table.mjs` extends the above by cross-referencing each
`(slot, signature)` against `cabi.h` and `Inpa.h` declarations, and splits
the analysis into the CABI runtime (`A_*.ipo`) vs the INPA-style runtime
(everything else) — they share the bytecode interpreter but use **different
slot tables**, which is why naive INPA-table dispatch fails on NCSEXPER IPOs.

The two ghidra Java scripts (`DumpNcsexperSyscallTable.java`,
`FindSyscallTableInit.java`) are unfinished attempts to locate NCSEXPER.EXE's
`.data` table; they came up empty. The runtime table is probably populated
programmatically in `CInterpreter`'s constructor — needs another ghidra
session to pin down.
