// Dump NCSEXPER's IPO interpreter syscall table.
//
// Output is written to a file (configurable below) so you can paste it
// back into the chat without the Console window truncating it.
//
// The filter is tightened to runs of 100..300 consecutive .text pointers —
// the typical size of an interpreter dispatch table (~160 entries by inpax
// reckoning). Tighter than the original "≥16" gate that caught every C++
// vtable and switch table in the binary.

//@category NCSExpert
//@author ncsx
//@menupath Tools.NCSExpert.Dump syscall table
//@toolbar globe.png

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Symbol;

import java.io.BufferedWriter;
import java.io.FileWriter;
import java.io.IOException;

public class DumpNcsexperSyscallTable extends GhidraScript {

    // .text segment range (from NCSEXPER.EXE's PE headers — verified).
    private static final long TEXT_START = 0x00401000L;
    private static final long TEXT_END   = 0x005ad9ffL;

    // .rdata segment range.
    private static final long RDATA_START = 0x005ae000L;
    private static final long RDATA_END   = 0x006017ffL;

    // Candidate-run filter: the IPO interpreter syscall table is expected to
    // be ~160 entries; vtables are smaller, big tables (image-id arrays etc.)
    // are larger. Tune the range here if no candidates surface.
    private static final int MIN_RUN_LEN = 100;
    private static final int MAX_RUN_LEN = 300;

    // Output file — drop the script result here. Adjust if you want it
    // somewhere else; the path is platform-agnostic (Java handles slashes).
    private static final String OUTPUT_PATH =
        "/Users/mjaskols/Projects/my/ncsx/docs/scripts/syscall-table-dump.txt";

    // Anchor functions we already located, for sanity-tagging candidates.
    private static final long DO_INTERPRET_ADDR     = 0x0045d830L;
    private static final long SYSCALL_RESOLVER_ADDR = 0x004689e0L;

    @Override
    public void run() throws Exception {
        BufferedWriter w = new BufferedWriter(new FileWriter(OUTPUT_PATH));
        try {
            writeLine(w, "================================================================");
            writeLine(w, "NCSEXPER syscall table scan");
            writeLine(w, "================================================================");
            writeLine(w, "Scanning  .rdata 0x" + hex(RDATA_START) + " .. 0x" + hex(RDATA_END));
            writeLine(w, "Filtering .text  0x" + hex(TEXT_START) + " .. 0x" + hex(TEXT_END));
            writeLine(w, "Run-length filter: " + MIN_RUN_LEN + " .. " + MAX_RUN_LEN);
            writeLine(w, "Anchor: DoInterpret 0x" + hex(DO_INTERPRET_ADDR)
                       + ", syscall resolver 0x" + hex(SYSCALL_RESOLVER_ADDR));
            writeLine(w, "");

            // Walk .rdata 4 bytes at a time, tracking runs of consecutive code pointers.
            long addr = RDATA_START;
            int candidateCount = 0;

            while (addr < RDATA_END - 64) {
                long runStart = addr;
                int runLen = 0;
                while (addr + 4 <= RDATA_END && isTextAddr(readU32(addr))) {
                    addr += 4;
                    runLen++;
                }
                if (runLen >= MIN_RUN_LEN && runLen <= MAX_RUN_LEN) {
                    candidateCount++;
                    dumpCandidate(w, runStart, runLen, candidateCount);
                } else if (runLen == 0) {
                    addr += 4;
                }
                // (otherwise `addr` already past the run; loop continues)
            }

            writeLine(w, "");
            writeLine(w, "================================================================");
            writeLine(w, "Done. " + candidateCount + " candidate(s) in the "
                          + MIN_RUN_LEN + ".." + MAX_RUN_LEN + " range.");
            writeLine(w, "================================================================");

            println("Wrote " + candidateCount + " candidate(s) to:");
            println("  " + OUTPUT_PATH);
        } finally {
            w.close();
        }
    }

    private void dumpCandidate(BufferedWriter w, long start, int runLen, int idx)
        throws IOException
    {
        writeLine(w, "");
        writeLine(w, "----------------------------------------------------------------");
        writeLine(w, "CANDIDATE #" + idx + " @ 0x" + hex(start) + "  (" + runLen + " entries)");
        writeLine(w, "----------------------------------------------------------------");
        for (int i = 0; i < runLen; i++) {
            long ptrAddr = start + ((long) i) * 4L;
            long fnAddr = readU32(ptrAddr);
            String fnName = nameOf(fnAddr);
            writeLine(w, String.format("  [0x%02x] = 0x%08x  (%s)", i, fnAddr, fnName));
        }
    }

    private void writeLine(BufferedWriter w, String s) throws IOException {
        w.write(s);
        w.newLine();
    }

    private long readU32(long offset) {
        Address a = toAddr(offset);
        if (a == null) return 0L;
        try {
            return ((long) getInt(a)) & 0xFFFFFFFFL;
        } catch (Exception e) {
            return 0L;
        }
    }

    private boolean isTextAddr(long value) {
        return value >= TEXT_START && value <= TEXT_END;
    }

    private String nameOf(long fnAddr) {
        Address a = toAddr(fnAddr);
        if (a == null) return "<invalid addr>";
        Function fn = getFunctionAt(a);
        if (fn != null) return fn.getName();
        Symbol sym = getSymbolAt(a);
        if (sym != null) return sym.getName();
        return String.format("FUN_%08x", fnAddr);
    }

    private static String hex(long v) {
        return String.format("%08x", v & 0xFFFFFFFFL);
    }
}
