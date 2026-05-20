# NCSEXPER syscall table

NCSEXPER's IPO interpreter dispatches `CALL sys <id>` opcodes (opcode
`0x0C`, flag `0x81`) through a function-pointer array stored at
`CInterpreter::this + 0x50`, indexed by the 16-bit ID. **The table is
purely numeric — no string names are stored alongside the IDs.** Each
handler is a separate C function in `NCSEXPER.EXE`'s `.text`; we
recover its name from a stack-local error-context string the handler
bakes for itself.

The table is **single** (not switchable). NCSEXPER has exactly one
mode of operation: running CABI-style IPOs (the ones whose function
table has `cabimain`/`cabiexit`).

This doc is the canonical reference for filling in NCSEXPER's table so
inpax can dispatch NCSEXPER bytecode through a faithful per-slot map.

---

## Single-mode, single-table — proven

Earlier drafts of this doc speculated that NCSEXPER might switch
between a "CABI" and an "INPA" slot table depending on which IPO is
loaded. That hypothesis is wrong. The ghidra evidence is unambiguous:

| Site | Address | Evidence |
|---|---|---|
| `CDHIntInit` (C-side script-name init) | `NCSEXPER.EXE:0x004410f0` | Writes `PTR_s_ScriptInit_00603948 := "cabimain"` and `PTR_s_ScriptExit_0060394c := "cabiexit"` once at app startup. **Only writer of these globals.** |
| `FUN_00464a30` (post-load init) | `NCSEXPER.EXE:0x00464a30` | Per IPO load, calls `FUN_00463fa0(4, "cabimain")` and `..."cabiexit"` to resolve handlers in the just-loaded IPO. Same lookup every time. |
| Strings table | — | `NCSEXPER.EXE` contains **no `"inpainit"` string**. Confirmed via full-binary string search. So NCSEXPER cannot resolve INPA-style entry points even if it tried. |

The bimodal empirical-signature data that confused the earlier draft
came from IPOs NCSEXPER never executes. `NCSEXPER/SGDAT/` ships 1,798
`.ipo` files but only **915 are CABI-style** (have `cabimain`). The
other **879 are INPA-style** (`inpainit`/`inpaexit` entry, INPA 5.x
format), bundled into the same directory by BMW's installer but
runnable only by `INPA.EXE`. NCSEXPER's VM loads but never invokes
the dispatch path for them. When analysing NCSEXPER's runtime, filter
to CABI-only.

---

## Where the dispatch lives (ghidra-verified)

| Symbol | Address | Role |
|---|---|---|
| `CInterpreter::DoInterpret` | `NCSEXPER.EXE:0x0045d830` | Per-opcode dispatch. `case 0xc` handles `CALL`. |
| `FUN_004689e0` (resolver) | `NCSEXPER.EXE:0x004689e0` | `(this, flag, id, &handler) → 1 (user) or 2 (sys)`. |
| `FUN_0045df30` (state machine) | `NCSEXPER.EXE:0x0045df30` | Outer run-state coordinator. |
| `FUN_00440db0` (= `CDHIntTrigger`) | `NCSEXPER.EXE:0x00440db0` | Per-tick interpreter step. |
| `FUN_00441070` (run loop) | `NCSEXPER.EXE:0x00441070` | Windows message-pump wrapper around `CDHIntTrigger`. |
| `FUN_0045efa0` (pop-arg-by-position) | `NCSEXPER.EXE:0x0045efa0` | Helper every syscall handler calls to fetch its Nth arg from the VM stack. |

The CALL handler at `DoInterpret:case 0xc`:

```c
iVar7 = FUN_004689e0(this, flag, id, &handler);
if (iVar7 == 1) {                            // user function (flag 0x80)
  FUN_00461a70(...);                          // push return address
  FUN_0045ce30(handler);                      // jump to user fn
}
else if (iVar7 == 2) {                       // sys function (flag 0x81)
  (*handler)(VMContext+0x20, &DAT_007aa538);  // direct C call
  FUN_00463530();                             // popFrame
}
```

The resolver (`FUN_004689e0`):

```c
if (flag != 0x80) {                          // sys
  if (id < 0 || (this + 0x54) <= id) FUN_0046f840(id);    // bounds check
  *handler = *((handler**)(*(this + 0x50)))[id];           // ⇐ THE TABLE
  return 2;
}
// else user — table at this + 0x3c, size at this + 0x40
```

So `this + 0x50` holds a pointer to the function-pointer array, and
`this + 0x54` is its length. Each entry is a 4-byte function pointer
called with `(VMContext+0x20, &DAT_007aa538)`.

---

## Recognising syscall handlers in the binary

Each handler has a uniform shape:

1. Calls `FUN_0045efa0(N, &outptr)` once per argument (N = 0-based
   position in the IPO's push order).
2. Bakes its own name as a stack-local 16-byte string for diagnostics
   (constructed byte-by-byte from a `.rdata` constant — e.g.
   `s_CDHapiResultInt_005b0d78`).
3. Does its work, then returns.

Examples (from a quick survey):

| Address | Name (from error string) | Args | Slot (TBD) |
|---|---|---|---|
| `0x0044be90` | `CDHapiJob` (or `apiJob`) | 4× `string` | **likely `0x0D`** — matches the 4-string `apiJob` pattern every A_*.ipo uses |
| `0x0044c370` | `CDHapiResultInt` | (in: string, in: int) → out int | TBD |

Xrefs to `FUN_0045efa0` give the complete handler list — roughly **80
distinct functions** clustered in three `.text` ranges:
`0x44be90..0x44df50`, `0x45a6f0..0x45cd41`, `0x46c7d0..0x46e049`.
That matches the empirical 71 distinct slots we see in the wild +
a handful of unused entries.

---

## Empirical signature evidence

Run `docs/scripts/infer-syscall-table.mjs` against `NCSEXPER/SGDAT`
to aggregate every `CALL sys N` across the 915 CABI IPOs. Latest
result is at `docs/scripts/ncsexper-cabi-slots-empirical.txt`. Highlights:

| Slot | Dominant signature (% conf.) | Sample callers | Likely meaning |
|---|---|---|---|
| `0x00` | `in=2 ref=0` (100%) | TesterPresentHandling | `settimer(int, int)` |
| `0x01` | `in=1 ref=1` (100%) | TesterPresentHandling | `testtimer(in:int, out:bool)` |
| `0x02` | `in=0 ref=0` (100%, 4172/4172) | TestCDHFehler | `exit()` |
| `0x0B` | `in=0 ref=0` (100%, 11373/11373) | GetDiagProt | likely state-machine helper |
| `0x0C` | `in=0 ref=0` (100%, 907/907) | cabiexit | `fileclose()` or similar |
| `0x0D` | `in=4 ref=0` (100%, 35491/35491) | every apiJob site | **apiJob bridge — confirmed** |
| `0x0F` | `in=3 ref=1` (100%, 38149) | every `apiResultText` site | `apiResultText(in:str, in:int, in:str, out:bool)` |
| `0x2B` | `in=1 ref=0` (100%, 19613) | TestCDHFehler | `CDHSetReturnVal(in: int)` |
| `0x2E` | `in=2 ref=1` (100%, 55189) | every `apiResultText` site | `CDHapiResultText(in:str, in:int, out:str)` |
| `0x33` | `in=0 ref=2` (100%, 12448) | GetDiagProt | 2 outrefs — likely `CDHGetCabdName(out:str, out:str)` |
| `0x53` | `in=5 ref=0` (100%, 1922) | OutputDebugString | 5 string args — diag log |

71 slots total, almost all >99% signature confidence. Even though
slot IDs don't match INPA's table, the signatures match `cabi.h`/
`Inpa.h` shapes 1-to-1 in most cases. **Once we have the actual
binary table, naming each slot is mechanical** — we know what shape
to look for at each entry.

---

## Next step — actually dump the table

The follow-up is `docs/scripts/FindCabiSyscallTable.java` (ghidra
Script Manager → run). Strategy:

1. Scan `.rdata` and `.data` for 4-byte words equal to `0x0044be90`
   (the apiJob handler we identified). That address will appear
   inside the syscall-table array — locating it gives us the array's
   bounds.
2. From that anchor, scan backwards / forwards for aligned function
   pointers into `.text`. The bounds are detectable: entries that
   stop pointing into `[0x401000, 0x5ad9ff]` mark the end.
3. For each entry in the table, decompile the handler, extract its
   error-context string literal (built byte-by-byte from `.rdata`),
   and emit `{slot, addr, name}`.
4. Cross-reference each entry's `FUN_0045efa0` call count with our
   empirical `(ins, refs)` data → sanity check.

Output: a single TS module in `packages/inpax-cabi-provider/` of the
form `Map<slot, { name, ins, refs }>`. Plumb it into inpax via the
per-slot override mechanism — each slot gets a handler that pops
args per the canonical signature, dispatches into `CabiProvider`,
and writes outs back through refs.

Once that lands the catch-all no-op in `apps/ncsx-web/src/lib/runtime.svelte.ts`
goes away.
