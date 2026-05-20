// FindCabiSyscallTable.java — locate NCSEXPER.EXE's CABI syscall-table array.
//
// Strategy:
//   1. Treat the apiJob handler at 0x0044be90 as a known anchor (identified
//      by reading its body: pops 4 string args via FUN_0045efa0, calls the
//      apiJob bridge chain → ___apiJob).
//   2. Scan every defined data block (.data + .rdata) for any 4-byte word
//      equal to that handler address. The match address sits inside the
//      syscall table.
//   3. From each match, walk backwards and forwards in 4-byte steps as
//      long as each word points into the .text range (any function in the
//      program). The contiguous run of function pointers is the table.
//   4. Print each entry as `[slot] addr -> handler addr (name if known)`.
//      Cross-check the slot index of 0x0044be90 against the empirical
//      apiJob slot 0x0D — if they match, we've found the table.
//
// Run from Ghidra: File → Configure → Script Manager → ＋, paste this file,
// then Run. Output goes to the Script Manager console.
//
//@author ncsx
//@category NCSX

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressIterator;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolTable;

import java.util.ArrayList;
import java.util.List;

public class FindCabiSyscallTable extends GhidraScript {

    // Known apiJob handler in NCSEXPER.EXE. Identified manually by reading
    // FUN_0044be90's body: pops 4 string args (FUN_0045efa0(0..3)), invokes
    // FUN_0045ee30 -> FUN_00478c70 -> ___apiJob_20.
    private static final long APIJOB_HANDLER = 0x0044be90L;

    // NCSEXPER.EXE .text range — adjust if image base differs. Default
    // image base 0x400000 + standard MFC image, .text ends around 0x5ad9ff.
    private static final long TEXT_MIN = 0x00401000L;
    private static final long TEXT_MAX = 0x005ad9ffL;

    @Override
    protected void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        FunctionManager funcMgr = currentProgram.getFunctionManager();
        SymbolTable symTab = currentProgram.getSymbolTable();

        Address apiJob = toAddr(APIJOB_HANDLER);
        println(String.format("Searching for syscall table containing apiJob @ 0x%08x", APIJOB_HANDLER));

        // 1. Find every 4-byte word in .data/.rdata equal to apiJob's address.
        List<Address> hits = new ArrayList<>();
        for (MemoryBlock block : mem.getBlocks()) {
            if (!block.isInitialized()) continue;
            String name = block.getName().toLowerCase();
            if (!name.contains("data") && !name.contains("rdata")) continue;
            println(String.format("  scanning block %s [0x%s..0x%s]",
                block.getName(),
                block.getStart().toString(false),
                block.getEnd().toString(false)));
            Address start = block.getStart();
            Address end = block.getEnd().subtract(4);
            for (Address a = start; a.compareTo(end) <= 0; a = a.add(4)) {
                long w;
                try {
                    w = mem.getInt(a) & 0xffffffffL;
                } catch (Exception e) {
                    continue;
                }
                if (w == APIJOB_HANDLER) {
                    hits.add(a);
                }
            }
        }
        println(String.format("Found %d candidate hits", hits.size()));

        // 2. For each hit, walk back/forward expanding while each word is a
        //    plausible .text address.
        for (Address hit : hits) {
            println("");
            println(String.format("=== hit @ 0x%s ===", hit.toString(false)));

            Address back = hit;
            while (true) {
                Address prev = back.subtract(4);
                long w;
                try {
                    w = mem.getInt(prev) & 0xffffffffL;
                } catch (Exception e) {
                    break;
                }
                if (!isTextAddr(w)) break;
                back = prev;
            }

            Address fwd = hit;
            while (true) {
                Address next = fwd.add(4);
                long w;
                try {
                    w = mem.getInt(next) & 0xffffffffL;
                } catch (Exception e) {
                    break;
                }
                if (!isTextAddr(w)) break;
                fwd = next;
            }

            long entries = (fwd.subtract(back) / 4) + 1;
            println(String.format("  table candidate: 0x%s .. 0x%s  (%d entries)",
                back.toString(false), fwd.toString(false), entries));

            // Skip obvious non-table runs (too short).
            if (entries < 16) {
                println("  (skipped — too short)");
                continue;
            }

            // 3. Print each entry. Show the slot index, the .data address,
            //    the handler .text address, and any symbol/function name.
            int apiJobSlot = -1;
            for (int i = 0; i < entries; i++) {
                Address slotAddr = back.add((long) i * 4);
                long handlerVal;
                try {
                    handlerVal = mem.getInt(slotAddr) & 0xffffffffL;
                } catch (Exception e) {
                    continue;
                }
                Address handlerAddr = toAddr(handlerVal);
                Function fn = funcMgr.getFunctionAt(handlerAddr);
                String label = fn != null ? fn.getName() : "<no fn>";
                Symbol sym = symTab.getPrimarySymbol(handlerAddr);
                if (sym != null && fn == null) label = sym.getName();
                println(String.format("  [0x%02x] @0x%s -> 0x%08x  %s",
                    i, slotAddr.toString(false), handlerVal, label));
                if (handlerVal == APIJOB_HANDLER) apiJobSlot = i;
            }
            if (apiJobSlot >= 0) {
                println(String.format("  >> apiJob (0x%08x) sits at slot 0x%02x in this table",
                    APIJOB_HANDLER, apiJobSlot));
                if (apiJobSlot == 0x0D) {
                    println("  >> matches empirical evidence — THIS IS THE CABI SYSCALL TABLE");
                }
            }
        }

        if (hits.isEmpty()) {
            println("");
            println("No matches found. Possibilities:");
            println("  - The table holds offsets, not absolute addresses.");
            println("  - The table is heap-allocated and the entries are written");
            println("    one at a time via repeated `mov [esi+N*4], imm32` rather");
            println("    than memcpy from a .rdata source. In that case, search");
            println("    .text for any `mov [reg+0x?], 0x0044be90` immediate write.");
            println("  - The image base differs from 0x00400000.");
        }
    }

    private boolean isTextAddr(long v) {
        return v >= TEXT_MIN && v <= TEXT_MAX;
    }
}
