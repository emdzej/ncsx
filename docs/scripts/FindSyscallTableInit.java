// Find the function that initialises CInterpreter's syscall table at this+0x50.
//
// The resolver FUN_004689e0 reads `*(this+0x50)[id]` to dispatch syscalls. The
// constructor that sets `this+0x50` must do one of:
//
//   (A) Single load: `mov dword ptr [<reg>+0x50], imm32` — imm32 is the
//       static .rdata table base.
//   (B) Dynamic init: `mov dword ptr [<reg>+0x50], <heap_ptr>` (after malloc),
//       then a sequence of `mov [<heap_ptr>+id*4], <handler_addr>` writes.
//
// For case (A) we just need to find the `c7 41/45/47/.. 50 ?? ?? ?? ??` pattern.
// For case (B) we look for `mov [ecx+0x50], eax` after a malloc / new call,
// then trace the subsequent writes.
//
// This script scans .text for both shapes and reports all hits.

//@category NCSExpert
//@author ncsx
//@menupath Tools.NCSExpert.Find syscall table init

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressRange;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryAccessException;
import ghidra.program.model.symbol.Symbol;

import java.io.BufferedWriter;
import java.io.FileWriter;
import java.io.IOException;

public class FindSyscallTableInit extends GhidraScript {

    private static final long TEXT_START  = 0x00401000L;
    private static final long TEXT_END    = 0x005ad9ffL;
    private static final long RDATA_START = 0x005ae000L;
    private static final long RDATA_END   = 0x006017ffL;

    private static final String OUTPUT_PATH =
        "/Users/mjaskols/Projects/my/ncsx/docs/scripts/syscall-table-init.txt";

    @Override
    public void run() throws Exception {
        BufferedWriter w = new BufferedWriter(new FileWriter(OUTPUT_PATH));
        try {
            writeLine(w, "================================================================");
            writeLine(w, "Hunt for `mov [reg+0x50], imm32` patterns in .text");
            writeLine(w, "================================================================");

            Memory mem = currentProgram.getMemory();

            // Variant byte patterns for `mov dword ptr [reg+0x50], imm32`:
            //
            //   C7 41 50 ?? ?? ?? ?? — mov dword ptr [ecx+0x50], imm32   (thiscall — most likely)
            //   C7 42 50 ?? ?? ?? ?? — mov dword ptr [edx+0x50], imm32
            //   C7 43 50 ?? ?? ?? ?? — mov dword ptr [ebx+0x50], imm32
            //   C7 45 50 ?? ?? ?? ?? — mov dword ptr [ebp+0x50], imm32
            //   C7 46 50 ?? ?? ?? ?? — mov dword ptr [esi+0x50], imm32
            //   C7 47 50 ?? ?? ?? ?? — mov dword ptr [edi+0x50], imm32
            //
            // Plus dynamic-init pattern:
            //   89 41 50            — mov [ecx+0x50], eax
            //   89 47 50            — mov [edi+0x50], eax
            //   ... etc.

            int totalImm = 0;
            int totalReg = 0;

            for (int regByte : new int[] {0x41, 0x42, 0x43, 0x45, 0x46, 0x47}) {
                writeLine(w, "");
                writeLine(w, "--- C7 " + String.format("%02X", regByte) + " 50 ?? ?? ?? ??  (mov [reg+0x50], imm32)");
                int hits = scanImmediateStore(mem, w, regByte);
                totalImm += hits;
            }

            for (int regByte : new int[] {0x41, 0x42, 0x43, 0x45, 0x46, 0x47}) {
                writeLine(w, "");
                writeLine(w, "--- 89 " + String.format("%02X", regByte) + " 50  (mov [reg+0x50], <reg>)");
                int hits = scanRegisterStore(mem, w, regByte);
                totalReg += hits;
            }

            writeLine(w, "");
            writeLine(w, "================================================================");
            writeLine(w, "Done. Immediate-store hits: " + totalImm + ", register-store hits: " + totalReg);
            writeLine(w, "================================================================");

            println("Wrote results to: " + OUTPUT_PATH);
            println("Immediate-store hits: " + totalImm);
            println("Register-store hits:  " + totalReg);
        } finally {
            w.close();
        }
    }

    /**
     * Scan .text for `C7 <regByte> 50 imm32` — direct store of an immediate
     * 4-byte value into `[reg+0x50]`. The immediate is the candidate table
     * base address.
     */
    private int scanImmediateStore(Memory mem, BufferedWriter w, int regByte) throws IOException {
        int hits = 0;
        Address a = toAddr(TEXT_START);
        Address end = toAddr(TEXT_END);
        while (a.compareTo(end) <= 0) {
            try {
                int b0 = mem.getByte(a) & 0xFF;
                if (b0 == 0xC7) {
                    int b1 = mem.getByte(a.add(1)) & 0xFF;
                    int b2 = mem.getByte(a.add(2)) & 0xFF;
                    if (b1 == regByte && b2 == 0x50) {
                        long imm = ((long) mem.getInt(a.add(3))) & 0xFFFFFFFFL;
                        // Filter: imm should be a plausible address (in .rdata or .data).
                        if (imm >= 0x00400000L && imm <= 0x009fffffL) {
                            String fnName = enclosingFunctionName(a);
                            writeLine(w, String.format(
                                "  0x%08x in %-30s  -> [reg+0x50] = 0x%08x %s",
                                a.getOffset(), fnName, imm, sectionLabel(imm)));
                            hits++;
                        }
                    }
                }
            } catch (MemoryAccessException e) {
                // skip unreadable bytes
            }
            a = a.add(1);
        }
        return hits;
    }

    /**
     * Scan .text for `89 <regByte> 50` — store of any register into `[reg+0x50]`.
     * Useful for dynamic-init patterns (constructor does malloc, returns ptr in
     * eax, then `mov [ecx+0x50], eax`).
     */
    private int scanRegisterStore(Memory mem, BufferedWriter w, int regByte) throws IOException {
        int hits = 0;
        Address a = toAddr(TEXT_START);
        Address end = toAddr(TEXT_END);
        while (a.compareTo(end) <= 0) {
            try {
                int b0 = mem.getByte(a) & 0xFF;
                if (b0 == 0x89) {
                    int b1 = mem.getByte(a.add(1)) & 0xFF;
                    int b2 = mem.getByte(a.add(2)) & 0xFF;
                    // For 89 with ModR/M like 0x41 (ecx + disp8), 0x42 (edx + disp8), etc.,
                    // the upper 3 bits encode src register. We're matching any src here.
                    // ModR/M byte: mod=01 (disp8), r/m=<base reg>. So 0x40..0x47 for various src+base.
                    // Simplest: match exactly 0x41/0x42/0x43/0x45/0x46/0x47 (which means src=eax, base=ecx/edx/ebx/ebp/esi/edi).
                    if (b1 == regByte && b2 == 0x50) {
                        String fnName = enclosingFunctionName(a);
                        writeLine(w, String.format(
                            "  0x%08x in %-30s  -> [reg+0x50] = eax (dynamic store)",
                            a.getOffset(), fnName));
                        hits++;
                    }
                }
            } catch (MemoryAccessException e) {}
            a = a.add(1);
        }
        return hits;
    }

    private String enclosingFunctionName(Address a) {
        Function fn = getFunctionContaining(a);
        if (fn != null) return fn.getName();
        return "<unowned>";
    }

    private String sectionLabel(long imm) {
        if (imm >= RDATA_START && imm <= RDATA_END) return "[.rdata]";
        if (imm >= TEXT_START && imm <= TEXT_END) return "[.text]";
        return "[.data/.bss/other]";
    }

    private void writeLine(BufferedWriter w, String s) throws IOException {
        w.write(s);
        w.newLine();
    }
}
