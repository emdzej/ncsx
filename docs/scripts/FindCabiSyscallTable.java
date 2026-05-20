// FindCabiSyscallTable.java — locate NCSEXPER.EXE's CABI syscall-table.
//
// V2 strategy: the first pass only found one isolated word equal to the
// apiJob handler address — meaning the table isn't a flat absolute-pointer
// array. It's likely built up by individual MOV instructions in
// CInterpreter's constructor (`mov [edi+N*4], imm32`), so we hunt for those
// instead, AND we dump raw bytes around any data-side hit so we can see
// what shape the data actually has.
//
// Three searches in one pass:
//
//   A) `.data` / `.rdata` 4-byte words == 0x0044be90 (absolute pointer).
//      We did this in v1 — there's one hit at 0x00603a2c. Dump the
//      surrounding 0x40 bytes both ways as raw u32 hex so the layout is
//      visible.
//
//   B) `.data` / `.rdata` 4-byte words == apiJob's RVA (0x000be90 = handler
//      - 0x00400000), in case the table stores RVAs.
//
//   C) `.text` immediate operands == 0x0044be90 anywhere in the binary.
//      Scans for the byte pattern `90 BE 44 00` aligned to any offset.
//      Reports each match with the surrounding instruction context. If
//      the table is populated via `mov [reg+N], 0x0044be90`, every entry
//      is its own immediate write — and the surrounding code reveals the
//      base register + offset.
//
// Run from Ghidra Script Manager. Paste, hit Run, capture console output.
//
//@author ncsx
//@category NCSX

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolTable;

import java.util.ArrayList;
import java.util.List;

public class FindCabiSyscallTable extends GhidraScript {

    private static final long APIJOB_HANDLER = 0x0044be90L;
    private static final long IMAGE_BASE = 0x00400000L;
    private static final long APIJOB_RVA = APIJOB_HANDLER - IMAGE_BASE;
    private static final long TEXT_MIN = 0x00401000L;
    private static final long TEXT_MAX = 0x005ad9ffL;

    @Override
    protected void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        FunctionManager funcMgr = currentProgram.getFunctionManager();
        SymbolTable symTab = currentProgram.getSymbolTable();
        Listing listing = currentProgram.getListing();

        println(String.format("Anchor: apiJob handler @ 0x%08x", APIJOB_HANDLER));
        println(String.format("        as RVA              0x%08x", APIJOB_RVA));
        println("");

        // === A) absolute-pointer hits in .data / .rdata =========================
        println("[A] absolute-pointer (0x" + Long.toHexString(APIJOB_HANDLER) + ") hits in .data/.rdata:");
        List<Address> absHits = scanWords(mem, APIJOB_HANDLER, /*dataOnly=*/ true);
        println(String.format("    %d hits", absHits.size()));
        for (Address hit : absHits) {
            println("");
            println("    hit @ 0x" + hit.toString(false));
            dumpAround(mem, hit, 0x20);    // ± 0x20 bytes
            tryExpandTable(mem, funcMgr, symTab, hit);
        }
        println("");

        // === B) RVA hits ========================================================
        println("[B] RVA (0x" + Long.toHexString(APIJOB_RVA) + ") hits in .data/.rdata:");
        List<Address> rvaHits = scanWords(mem, APIJOB_RVA, /*dataOnly=*/ true);
        println(String.format("    %d hits", rvaHits.size()));
        for (Address hit : rvaHits) {
            println("");
            println("    hit @ 0x" + hit.toString(false));
            dumpAround(mem, hit, 0x20);
        }
        println("");

        // === C) immediate-operand hits in .text =================================
        println("[C] immediate-operand (mov reg/[m], 0x" + Long.toHexString(APIJOB_HANDLER) + ") hits in .text:");
        int instrHits = 0;
        for (Instruction insn = listing.getInstructionAt(toAddr(TEXT_MIN));
             insn != null && insn.getAddress().getOffset() <= TEXT_MAX;
             insn = listing.getInstructionAfter(insn.getAddress())) {
            // Walk all scalar operands; skip references that are program-flow
            // (call targets), only flag immediate values.
            int nOps = insn.getNumOperands();
            for (int i = 0; i < nOps; i++) {
                Object[] objs = insn.getOpObjects(i);
                if (objs == null) continue;
                for (Object o : objs) {
                    if (o instanceof Scalar) {
                        long val = ((Scalar) o).getUnsignedValue();
                        if (val == APIJOB_HANDLER) {
                            Function inFn = funcMgr.getFunctionContaining(insn.getAddress());
                            String fnName = inFn != null ? inFn.getName() : "<no fn>";
                            println(String.format(
                                "    0x%s  in %s :  %s",
                                insn.getAddress().toString(false),
                                fnName,
                                insn.toString()));
                            instrHits++;
                        }
                    }
                }
            }
        }
        println(String.format("    %d instruction hits", instrHits));
    }

    private List<Address> scanWords(Memory mem, long target, boolean dataOnly) throws Exception {
        List<Address> hits = new ArrayList<>();
        for (MemoryBlock block : mem.getBlocks()) {
            if (!block.isInitialized()) continue;
            if (dataOnly) {
                String n = block.getName().toLowerCase();
                if (!n.contains("data") && !n.contains("rdata")) continue;
            }
            Address start = block.getStart();
            Address end = block.getEnd().subtract(4);
            for (Address a = start; a.compareTo(end) <= 0; a = a.add(4)) {
                long w;
                try {
                    w = mem.getInt(a) & 0xffffffffL;
                } catch (Exception e) {
                    continue;
                }
                if (w == target) hits.add(a);
            }
        }
        return hits;
    }

    private void dumpAround(Memory mem, Address center, int radius) {
        long start = center.getOffset() - radius;
        long end = center.getOffset() + radius;
        // align to 16
        start = start & ~0xfL;
        for (long off = start; off <= end; off += 16) {
            StringBuilder sb = new StringBuilder();
            sb.append(String.format("      0x%08x: ", off));
            for (int i = 0; i < 4; i++) {
                long w;
                try {
                    w = mem.getInt(toAddr(off + i * 4)) & 0xffffffffL;
                } catch (Exception e) {
                    sb.append("???????? ");
                    continue;
                }
                String marker = (off + i * 4 == center.getOffset()) ? "*" : " ";
                sb.append(String.format("%s%08x ", marker, w));
            }
            println(sb.toString());
        }
    }

    private void tryExpandTable(Memory mem, FunctionManager funcMgr, SymbolTable symTab, Address hit) throws Exception {
        // Walk back/forward keeping entries that point into .text.
        Address back = hit;
        while (true) {
            Address prev = back.subtract(4);
            long w;
            try {
                w = mem.getInt(prev) & 0xffffffffL;
            } catch (Exception e) {
                break;
            }
            if (w < TEXT_MIN || w > TEXT_MAX) break;
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
            if (w < TEXT_MIN || w > TEXT_MAX) break;
            fwd = next;
        }
        long entries = (fwd.subtract(back) / 4) + 1;
        println(String.format("      contiguous text-pointer run: 0x%s..0x%s  (%d entries)",
            back.toString(false), fwd.toString(false), entries));
    }
}
