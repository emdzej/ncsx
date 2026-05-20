# Dump NCSEXPER's IPO interpreter syscall table.
#
# Paste into Ghidra's Script Manager (File → Configure → Script Manager → New)
# with NCSEXPER.EXE loaded. Or run via `analyzeHeadless` if scripting from CLI.
#
# Strategy:
#
# 1. Locate the syscall resolver (FUN_004689e0). It reads the table base via
#    `*(this + 0x50)` and indexes by ID.
# 2. Find any caller of that resolver — that gives us a code location where
#    the `this` pointer is set. The `this` is usually a CInterpreter
#    singleton stored at a known global.
# 3. Walk all reads of `this + 0x50` to find what static address ends up there
#    (i.e. find a constructor that does `mov [ecx+0x50], <static_table_addr>`).
# 4. From the static table address, read N function pointers (each 4 bytes,
#    little-endian) until the values stop looking like .text addresses.
# 5. For each entry, look up the function it points at and dump
#    `[id] = 0xADDR  (function_name)`.
#
# Output format is paste-ready for incorporation into
# `packages/inpax-cabi-provider/src/ncsexper-syscalls.ts` — one line per slot.

from ghidra.program.model.address import AddressSet
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor

# ─── Known anchor points (from prior ghidra trace) ─────────────────────────
SYSCALL_RESOLVER_ADDR = 0x004689e0   # FUN_004689e0 — resolves (flag, id) → handler*
DO_INTERPRET_ADDR     = 0x0045d830   # FUN_0045d830 — CInterpreter::DoInterpret
TEXT_START            = 0x00401000   # .text segment start
TEXT_END              = 0x005ad9ff   # .text segment end

# ─── Step 1: Find what static address gets stored at `this+0x50` ───────────
#
# We scan the .text segment for an instruction sequence that writes a 4-byte
# value into [reg + 0x50]. Common constructor pattern:
#     mov  ecx, this
#     mov  [ecx + 0x50], <addr_of_table>
#     mov  [ecx + 0x54], <table_size>
#
# Because pinning the exact constructor is brittle, we search by data: any
# 4-byte value in .rdata that points into .text AND is followed by more such
# values, is a function-pointer table candidate. The table that contains
# handlers for the IDs we know NCSEXPER calls (0x0B setjobstatus, 0x0C exit,
# 0x0D apiJob-bridge, 0x2E PEMSGZ_Kopfzeile, 0x33 PEMProtokollAusgabe, …) is
# our syscall table.

def is_text_addr(value):
    return TEXT_START <= value <= TEXT_END

def read_u32(addr):
    """Read little-endian uint32 at a given numeric address."""
    a = toAddr(addr)
    if a is None:
        return None
    try:
        return getInt(a) & 0xFFFFFFFF
    except Exception:
        return None

def get_func_name(addr):
    """Pretty-print the function (or label) at a given address."""
    a = toAddr(addr)
    if a is None:
        return "<invalid addr>"
    fn = getFunctionAt(a)
    if fn is not None:
        return fn.getName()
    sym = getSymbolAt(a)
    if sym is not None:
        return sym.getName()
    return "FUN_{:08x}".format(addr)

# ─── Step 2: scan .rdata for function-pointer tables ───────────────────────
#
# Stride 4 bytes. A run of >= 16 consecutive valid-text addresses is a
# candidate table. For each candidate, print the first 16 entries with their
# function names — you eyeball which one has the right shape (e.g. slot 0x0B
# should look like a job-status setter; slot 0x2E should look like a PEM
# header writer).

RDATA_START = 0x005ae000
RDATA_END   = 0x006017ff

print("Scanning .rdata for syscall-table candidates...")
print("(looking for runs of >= 16 consecutive function pointers)")
print()

addr = RDATA_START
candidates = []
while addr < RDATA_END - 64:
    run_start = addr
    run_len = 0
    while addr < RDATA_END and is_text_addr(read_u32(addr) or 0):
        addr += 4
        run_len += 1
    if run_len >= 16:
        candidates.append((run_start, run_len))
    else:
        addr += 4

print("Found {} candidate runs:".format(len(candidates)))
for (start, run_len) in candidates:
    print("  0x{:08x}: {} entries".format(start, run_len))
print()

# ─── Step 3: dump each candidate ───────────────────────────────────────────
#
# Print the first up-to-100 entries of each candidate with function names.
# Manually identify which run is the syscall table — it should have:
#
#   [0x00] = setmenutitle-like     (one-arg string setter)
#   [0x0B] = setjobstatus-like     (one-arg string setter)
#   [0x0C] = exit                  (zero-arg)
#   [0x0D] = apiJob bridge         (four-arg, references api32.dll)
#   [0x2E] = PEM_header-like
#   ... etc.

for (start, run_len) in candidates:
    print("─" * 72)
    print("CANDIDATE @ 0x{:08x}  ({} entries)".format(start, run_len))
    print("─" * 72)
    n = min(run_len, 100)
    for i in range(n):
        ptr_addr = start + i * 4
        fn_addr = read_u32(ptr_addr)
        name = get_func_name(fn_addr)
        print("  [0x{:02x}] = 0x{:08x}  ({})".format(i, fn_addr, name))
    print()

print("done.")
print()
print("→ Paste the matching candidate into")
print("  packages/inpax-cabi-provider/src/ncsexper-syscalls.ts")
print("  upgrading each entry's `verified` to either")
print("  'verified-same' or 'divergent'.")
