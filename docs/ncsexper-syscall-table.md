# NCSEXPER CABI syscall table — resolved

NCSEXPER's IPO interpreter dispatches `CALL sys <id>` opcodes (opcode
`0x0C`, flag `0x81`) through a function-pointer array stored at
`CInterpreter::this + 0x50`, indexed by a 16-bit slot ID. **The slot
table has 99 entries.** Both halves (slot ↔ name and name ↔ signature)
are now known with high confidence.

The canonical mapping lives in `docs/scripts/ncsexper-cabi-syscall-table.txt`,
extracted from the 1996 16-bit `ncsserv.exe` (Softing's NCS-ELDI-Server,
NCSEXPER.EXE's direct predecessor — same v1.x interpreter, same CABI
table). Cross-validated 68/68 against bytecode evidence from the 915
CABI IPOs in NCSEXPER/SGDAT.

---

## How we got the table

### Sources

| Source | Contains | Reliability |
|---|---|---|
| `ncsserv.exe` (16-bit NE, 802KB, 1996/1997, v3.0.5) | Keyword table as a packed null-separated string array in `.data`, indexed by slot ID. Anchored at `settimer\0testtimer\0exit\0…` (file offset `0xbe70a`). | **Ground truth** — every IPO emits `CALL sys N` against this table. |
| `NCSEXPER/SGDAT/CABI.H` | Function declarations with `(in/out: type name)` parameter directions. **Order is NOT slot order** — names map to the runtime table by name, not by line. | Authoritative for signatures (in-arg count, out-ref count). |
| 915 `A_*.ipo` + digit-prefix CABI IPOs in `NCSEXPER/SGDAT` | 334,505 `CALL sys` instructions across the 71 slots actually used in the wild. Each emit shows the FRAME→pushes pattern (ins, refs). | Confirms each slot's signature shape matches the named function's CABI.H declaration. |

`ncsserv.exe` ships in BMW's Ediabas 6.4.3 install at
`Archive/CABI_RUN.LZH` (and in `Archive/CABI_CFG.LZH`). Extract with
`lha xq CABI_RUN.LZH`. The keyword table is at file offset `0xbe70a`
onward — null-separated, in slot-ID order, terminates after slot
`0x62 = CDHAuthGetRandom`.

`docs/scripts/extract-ncsserv-keyword-table.mjs` reproduces the
extraction. `docs/scripts/ncsexper-cabi-syscall-table.txt` is the
committed output.

### Cross-validation

`docs/scripts/infer-syscall-table.mjs` walks every CABI IPO and aggregates
`(slot, ins, refs)` tuples. We then check, for each empirical slot, that
the dominant `(ins, refs)` shape matches the CABI.H declaration for the
name at that slot in the `ncsserv.exe` table. Result: **68 matches, 0
mismatches** (slots `0x00..0x62` minus slots not used by any CABI
dispatcher). Two names — `CDHGetReferenzProgramm`, `CDHGetReferenzDaten`
at slots `0x58`/`0x59` — are present in the runtime table but not
declared in `CABI.H` (likely added in a later compiler revision); they
get a TBD signature.

---

## The dispatcher (ghidra-verified in NCSEXPER.EXE)

| Symbol | Address | Role |
|---|---|---|
| `CInterpreter::DoInterpret` | `NCSEXPER.EXE:0x0045d830` | Per-opcode dispatch loop. `case 0xc` handles `CALL`. |
| Sys-call resolver | `NCSEXPER.EXE:0x004689e0` | `(this, flag, id, &handler) → 1 (user)` or `2 (sys)`. Reads `*(int*)(this+0x50) + id*4`. |
| `apiJob` handler (slot `0x0D`) | `NCSEXPER.EXE:0x0044be90` | Pops 4 string args via `FUN_0045efa0`, calls `___apiJob_20` through the `FUN_0045ee30 → FUN_00478c70` wrappers. |
| `FUN_0045efa0` | `NCSEXPER.EXE:0x0045efa0` | "Pop arg N from VM stack" helper that every syscall handler calls one-per-argument. |

CALL handler body:

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

`this+0x50` is set up programmatically by `CInterpreter`'s constructor —
each entry written by a separate `mov [edi+N*4], imm32` immediate write
in the C++ body (which is why our earlier `[reg+0x50] = imm32` scan
came up empty: ~99 individual immediate writes, not a single `memcpy`
from `.rdata`). Reverse-engineering each handler in NCSEXPER.EXE is
still useful for behaviour details, but the slot ↔ name mapping is
already known from `ncsserv.exe`.

---

## Single mode, single table

NCSEXPER has exactly **one mode**: running CABI IPOs (the ones whose
function table contains `cabimain`/`cabiexit`). Evidence:

- `CDHIntInit` (`NCSEXPER.EXE:0x004410f0`) writes the script entry-point
  globals to `"cabimain"`/`"cabiexit"` at app startup. **Only writers
  of those globals.**
- `NCSEXPER.EXE` contains **no `"inpainit"` string** anywhere — INPA-style
  IPOs cannot be loaded through NCSEXPER's VM even if they appear in
  `SGDAT/`.
- `NCSEXPER/SGDAT/` ships 1,798 `.ipo` files, but only **915 are CABI**
  (have `cabimain`). The other **879 are INPA 5.x** scripts (`inpainit`/
  `inpaexit` entry, INPA UI primitives like `setscreen`/`setmenu`/
  `userbox*`) — bundled in the same directory by BMW's installer for
  the `INPA.EXE` side of the toolchain. NCSEXPER doesn't touch them.

When analysing NCSEXPER's bytecode, filter to CABI-only.

---

## Slot table (verified)

Full table at `docs/scripts/ncsexper-cabi-syscall-table.txt`. Highlights:

| Slot | Name | Signature (from CABI.H) | Empirical (ins, refs) |
|---|---|---|---|
| `0x00` | `settimer` | `(in: int, in: int)` | `2, 0` ✓ |
| `0x01` | `testtimer` | `(in: int, out: bool)` | `1, 1` ✓ |
| `0x02` | `exit` | `()` | `0, 0` ✓ |
| `0x0B` | `CDHapiInit` | `()` | `0, 0` ✓ |
| `0x0C` | `CDHapiEnd` | `()` | `0, 0` ✓ |
| `0x0D` | **`CDHapiJob`** | `(in:str, in:str, in:str, in:str)` | `4, 0` ✓ |
| `0x0F` | `CDHapiResultText` | `(out:str, in:str, in:int, in:str)` | `3, 1` ✓ |
| `0x18` | `apiJob` | `(in:str, in:str, in:str, in:str)` | `4, 0` ✓ |
| `0x1A` | `apiResultText` | `(out:bool, in:str, in:int, out:str)` | `2, 2` (matches "in/in/out/out" shape after dropping the first out) |
| `0x2B` | `CDHSetReturnVal` | `(in: int)` | `1, 0` ✓ |
| `0x2E` | `CDHSetCabdPar` | `(in:str, in:str, out:int)` | `2, 1` ✓ |
| `0x33` | `CDHGetSgbdName` | `(out:str, out:str)` | `0, 2` ✓ |
| `0x62` | `CDHAuthGetRandom` | `(out:str, out:str)` | (not observed) |

Note: slot `0x0D` is **`CDHapiJob`**, not `apiJob`. Both have the same
4-string signature and both ultimately call `___apiJob`, but
`CDHapiJob` goes through NCSEXPER's COAPI bookkeeping layer first
(checks `CDHSetReturnVal`'s last value, populates CDH error state,
etc.) before invoking the EDIABAS API. Most CABI IPOs use slot `0x0D`
exclusively; slot `0x18` (`apiJob`) is the raw bypass.

---

## What's next

### Plug it into the runtime

`apps/ncsx-web/src/lib/runtime.svelte.ts` currently registers a no-op
override for every slot in `0x00..0x60` and only handles slot `0x0D`
specifically. With the full table in hand, replace that with proper
per-slot dispatchers:

```ts
import { NCSEXPER_CABI_SLOTS } from '@emdzej/ncsx-inpax-cabi-provider';

for (const [slot, fn] of NCSEXPER_CABI_SLOTS) {
  systemFunctions.set(slot, fn);
}
```

Each `fn` pops the right number of in-args, reads/writes out-refs per
the CABI.H signature, and dispatches into the matching `CabiProvider`
method (which we already author per CABI.H in
`packages/inpax-cabi-provider`). The no-op fallback goes away.

### Author the per-slot dispatchers

The mechanical work: 99 slots, each gets a thin wrapper that translates
the inpax `(ctx, vm)` calling convention into a `CabiProvider` method
call. About 80 are CDH-prefixed → straight delegation to existing
provider methods. The rest are utility (`settimer`/`testtimer`/`exit`/
`hexconvert`/`midstr`/etc.) and EDIABAS API (`apiJob`/`apiResultText`/
etc.) — need new shims.

`packages/inpax-cabi-provider/src/ncsexper-syscalls.ts` (already
exists, currently a stub) is the home for the registration map.
