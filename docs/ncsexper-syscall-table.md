# NCSEXPER syscall table — staged inventory + verification recipe

NCSEXPER's IPO interpreter dispatches `CALL sys <id>` opcodes (opcode
`0x0C`, flag `0x81`) through a function-pointer array stored at
`CInterpreter::this + 0x50`, indexed by the 16-bit ID. **The table is
purely numeric — no string names are stored in `NCSEXPER.EXE` for any
of these IDs.** The disassembler in inpax annotates with INPA's
`SystemFunctionMap` names, but those are inpax's *guesses* about what
each slot does. NCSEXPER's actual table likely diverges at at least
one slot (proven for `0x0D`) and possibly more.

This doc is the canonical reference for filling in NCSEXPER's table so
upstream inpax can ship a per-IPO pluggable `SystemFunctionMap`.

---

## Where the dispatch lives (ghidra-verified)

| Symbol | Address | Role |
|---|---|---|
| `CInterpreter::DoInterpret` | `NCSEXPER.EXE:0x0045d830` | Per-opcode dispatch. `case 0xc` handles `CALL`. |
| `FUN_004689e0` (resolver) | `NCSEXPER.EXE:0x004689e0` | `(flag, id) → handler*`. Returns `2` for sys, `1` for user-fn. |
| `FUN_0045df30` (state machine) | `NCSEXPER.EXE:0x0045df30` | Outer run-state coordinator. |
| `FUN_00440db0` (= `CDHIntTrigger`) | `NCSEXPER.EXE:0x00440db0` | Per-tick interpreter step. |
| `FUN_00441070` (run loop) | `NCSEXPER.EXE:0x00441070` | Windows message-pump wrapper around `CDHIntTrigger`. |

The CALL handler at `DoInterpret:case 0xc`:

```c
iVar7 = FUN_004689e0(flag, id, &local_18);   // resolve handler
if (iVar7 == 1) {                            // user function (flag 0x80)
  FUN_0045ce30(local_18);                    // push IPO frame
}
else if (iVar7 == 2) {                       // sys function (flag 0x81)
  (*local_18)(VMContext, &resultSlot);       // direct C call
}
```

The resolver (`FUN_004689e0`):

```c
if (flag != 0x80) {                                            // sys
  if (id < 0 || (this + 0x54) <= id) FUN_0046f840(id);
  *result = *(addr at this + 0x50)[id];                        // table base
  return 2;
}
// else user — table at this + 0x3c, size at this + 0x40
```

So **`this + 0x50` is the syscall table base pointer**, **`this + 0x54`
is the entry count**.

---

## The canonical machine-readable table

`packages/inpax-cabi-provider/src/ncsexper-syscalls.ts` —
`NCSEXPER_SYSCALL_TABLE`. Currently 40+ entries seeded from the IDs
called by `A_KMB46.ipo`. Each entry has:

- `inpaName` — INPA's name for the ID (inpax `SystemFunctionMap` baseline)
- `signature` — INPA-spec arg/return shape
- `verified` — `'observed' | 'inpa-only' | 'verified-same' | 'divergent'`
- `evidence` — why we currently think what we think
- `handler` (for `'divergent'`) — TypeScript provider method to bind

---

## Final verdict (2026-05-20)

**Slot `0x0D` in NCSEXPER's runtime IPO interpreter takes 4 string args
and is the apiJob bridge.** Direct evidence from `A_KMB46.ipo::FgnrLesen`:

```
000c: FRAME              ← marks the start of an arg-push region
000d: LOAD local[0]      ← arg 1 (JOBNAME from cabimain arg)
000e: LOAD const "C_FG_LESEN"   ← arg 2 (SGBD-side job name)
000f: LOAD const ""       ← arg 3 (params)
0010: LOAD const ""       ← arg 4 (paramsHex)
0011: CALL sys 0x0D       ← consumes ALL 4 args (FRAME→CALL bracket)
...
001c: CALL user TestApiFehler   ← validates api32.dll error state — proves 0x0D hit EDIABAS
```

The IPO bytecode's `FRAME → … → CALL` is a hard bracket: every LOAD/PUSHREF
between FRAME and the next CALL is an arg to that CALL. INPA's `exitwindows`
takes 0 args; slot 0x0D in NCSEXPER takes 4. The behaviour the IPO clearly
expects is `apiJob(jobLabel, sgbdJob, params, paramsHex)`, and the
`TestApiFehler` user function immediately after seals it — that function
exists precisely to check EDIABAS error state.

**The compile-time keyword `exitwindows` at INPA's IPS-compiler keyword
table position 0x0D is a Softing-internal naming quirk** — the compiler
emits the same numeric ID, but the runtime handler has nothing to do with
"closing windows". Likely historical: the keyword was repurposed when the
EDIABAS bridge needed a slot, but Softing kept the old name in the lexer.

## Compile-time keyword table vs runtime dispatch table — two different things

**Proof from INPA.EXE (NOT NCSEXPER.EXE)**: INPA embeds an IPS compiler
with a keyword table at `.rdata` `0x48dd34`. The position of each string
gives the **compile-time ID assignment** the compiler emits for that
keyword. **This is NOT the same as the runtime interpreter's
ID→handler dispatch table.** They can (and do, at slot 0x0D) diverge.

NCSEXPER.EXE does NOT embed the compiler — only the interpreter. Earlier
claim that "NCSEXPER.EXE has the v1.x keyword table" was wrong; those
strings exist only in INPA.EXE. The Softing static library that both
binaries share is the **runtime interpreter** (`CInterpreter::DoInterpret`
at `FUN_0045d830` in both), not the compiler.

The INPA keyword table:

```
0x48dd34  setmenutitle       = 0x00
0x48dd44  setmenu            = 0x01
0x48dd4c  setitem            = 0x02
0x48dd54  settitle           = 0x03
0x48dd60  setscreen          = 0x04
0x48dd6c  setstatemachine    = 0x05
0x48dd7c  setstate           = 0x06
0x48dd88  callstatemachine   = 0x07
0x48dd9c  returnstatemachine = 0x08
0x48ddb0  settimer           = 0x09
0x48ddbc  testtimer          = 0x0A
0x48ddc8  setjobstatus       = 0x0B
0x48ddd?  exit               = 0x0C   (between setjobstatus and exitwindows)
0x48dde0  exitwindows        = 0x0D   ← matches inpax-core, NOT apiJob
0x48ddec  scriptselect       = 0x0E
0x48ddfc  scriptchange       = 0x0F
...
0x48e250  INPAapiInit        = 0x60
0x48e25c  INPAapiEnd         = 0x61
0x48e268  INPAapiJob         = 0x62   ← matches inpax-core
0x48e274  INPAapiResultText  = 0x63
0x48e288  INPAapiResultInt   = 0x64
0x48e29c  INPAapiResultSets  = 0x65
0x48e2b0  INPAapiResultDigital = 0x66
0x48e2c8  INPAapiResultAnalog  = 0x67
0x48e2dc  INPAapiResultBinary  = 0x68
0x48e2f0  INPAapiCheckJobStatus = 0x69
0x48e308  INPAapiFsLesen2    = 0x6A
0x48e318  INPAapiFsLesen     = 0x6B
0x48e328  INPAapiFsMode      = 0x6C
...
0x48e43c  DTMFindLogUnit     = 0x7D
...
```

The keyword strings span `0x48dd34` – `0x48e554+` in NCSEXPER.EXE. Every
position lines up with inpax-core's v5.x SystemFunctionMap ID, confirming
that **NCSEXPER's v1.x interpreter and inpax-core's v5.x map share the
same ID space for shared names**. v5.x is a superset (added later
functions like ApiJobFsLesenFAB at 0x97, structure ops at 0x9A–0x9F,
setitemrepeat at 0xA1) but every v1.x name is at the same slot as in v5.x.

The same proof was independently confirmed in INPACOMP.exe (BMW's
companion v5.x compiler reference at
`EC-APPS/INPA/BIN/INPACOMP.exe`) — its keyword table at offset `0x6CEAC`+
is laid out identically. Two independent witnesses, same result.

**Consequence**: the upstream-pluggable inpax `SystemFunctionMap` does
NOT need NCSEXPER-specific ID overrides. The stock map dispatches to the
correct handler for every ID NCSEXPER's IPOs call.

The whole reason this matters is the dispatch:

- The pluggable upstream-inpax `SystemFunctionMap` will dispatch by ID.
- If it uses inpax-core's v5.x mapping, every NCSEXPER IPO syscall will
  call the v5.x handler.
- If v1.x slots actually mean different things, every call lands in the
  wrong handler — silent or crashy.

So **the ghidra table dump is necessary**, not optional, even though we
now have inpax-compiler / inpax-interpreter both wired to v5.x assumptions.

### Slot 0x0D IS the apiJob bridge (third and final verdict)

I've flip-flopped on this twice. Locking it now with the evidence that
finally fits:

`A_KMB46.ipo::FgnrLesen` at offset 0x11 has this sequence:

```
LOAD local[0]              ; JOBNAME (from cabimain arg, e.g. "FGNR_LESEN")
LOAD const "C_FG_LESEN"    ; SGBD-side job name (per-CABD hardcoded constant)
LOAD const ""              ; params
LOAD const ""              ; paramsHex
CALL sys 0x0D              ; → apiJob bridge
...
CALL user TestApiFehler    ; checks api32.dll error state (← smoking gun)
...
CALL sys scriptchange "FG_NR"   ; chain to FG_NR sub-script for next stage
```

**The smoking gun**: `TestApiFehler` (a user-defined function whose name
literally means "Test API Error") runs immediately after `CALL sys 0x0D`.
It exists to validate that the preceding API call succeeded. That API is
EDIABAS / `api32.dll`. The only way slot 0x0D could plausibly set that
error state is if it issued `apiJob`.

This also makes the C-code analysis tractable: I'd been looking for an
`apiJob` call in NCSEXPER.EXE's COAPI helpers (`coapiReadFgNr` →
`coapiRunCabd` → IPO loop) and finding none. The reason is that the
`apiJob` happens **inside the IPO interpreter**, when slot 0x0D dispatches.
The C code never directly calls api32.dll — it routes everything through
the IPO interpreter's slot 0x0D handler.

### Why earlier evidence misled me

INPA.EXE has an embedded IPS compiler whose keyword table sits at
`.rdata` `0x48dd34`. That table maps **keywords to IDs at compile time**:

```
0x48dd34  setmenutitle  → 0x00
0x48dde0  exitwindows   → 0x0D
0x48e268  INPAapiJob    → 0x62
```

So when you write `exitwindows()` in IPS source, the compiler emits
`CALL sys 0x0D`. But **the runtime interpreter's table at slot 0x0D
dispatches to a DIFFERENT handler than INPA's `exitwindows`**. Likely
the keyword "exitwindows" in v1.x is a vestigial / repurposed name that
was reused for the apiJob bridge in the runtime — a Softing-internal
naming inconsistency.

The compile-time table I extracted from INPACOMP.exe and NCSEXPER.EXE
*.rdata*. The runtime dispatch table lives in `CInterpreter::this+0x50`
and isn't directly enumerable without running the binary or walking the
constructor's `mov [this+0x50], ...` writes in ghidra. **Until that
runtime table is dumped (via the ghidra script in
`docs/scripts/dump-ncsexper-syscall-table.py`), slot 0x0D's true handler
is best inferred from IPO usage shape, not from compile-time keywords.**

### Where the per-CABD job-name translation actually lives

Resolved: **inside each `A_*.ipo` as a hardcoded constant**.

- `A_KMB46.ipo::FgnrLesen` loads `"C_FG_LESEN"` and passes it as arg 2 to
  `CALL sys 0x0D` (the apiJob bridge).
- `A_KMB46.ipo::Lesen` (CODIERDATEN_LESEN handler) loads `"C_S_LESEN"`.
- Other CABDs ship their own `A_*.ipo` with different hardcoded names.
- **The IPO IS the per-CABD mapping table**, compiled in at IPS-to-IPO
  emission time.

This means our existing `packages/wire`'s direct `apiJob` calls with
the contract names (`FGNR_LESEN`, `SG_CODIEREN`, etc.) will **only**
work if the SGBD `.prg` itself aliases the contract names to the
implementation names. That's testable via `apiJobInfo` against a live
SGBD. If aliases work → `packages/wire` works as-is. If not → we MUST
run the IPO via inpax-interpreter (with our `CabiProvider.CDHapiJob`
bound to slot 0x0D) to get the right SGBD-side names.

---

## Stage 2 — verification recipe

Once upstream inpax exposes a pluggable `SystemFunctionMap`, walk this
recipe to upgrade every `'observed'` entry to either `'verified-same'`
or `'divergent'`:

### 1. Read the syscall table at runtime

Run `docs/scripts/dump-ncsexper-syscall-table.py` via Ghidra's Script Manager
(`File → Configure → Script Manager → Manage Scripts → ＋`, paste, Run).
The script:

1. Scans `.rdata` for runs of ≥16 consecutive function-pointer values
   (sequences where every 4 bytes points into `.text` 0x00401000–0x005ad9ff).
2. Prints each candidate run with the first 100 entries decoded as
   `[id] = 0xADDR  (fn_name)`.
3. You identify the syscall table by shape:
   - `[0x00]` should look like a setmenutitle-style setter (1 string arg).
   - `[0x0B]` should be a setjobstatus-style setter.
   - `[0x0C]` should be `exit` (zero-arg).
   - `[0x0D]` should reference the api32.dll bridge — that's the apiJob
     handler ≠ INPA's `exitwindows`.
   - `[0x2E]` should be a PEM-header writer.

Paste the matching candidate's full output back here for incorporation
into `packages/inpax-cabi-provider/src/ncsexper-syscalls.ts`.

### 2. For each entry, classify

- **Identical-ish to INPA**: handler body matches the INPA spec (e.g.
  `setjobstatus` writes the string arg to a NCSEXPER member, same as
  INPA writes to its job-status global) → `verified: 'verified-same'`.
- **Divergent**: handler calls into `CDH*` bridge, `api32.dll`, or does
  something NCSEXPER-specific (writes to COAPI state, dispatches
  protocol-report, etc.) → `verified: 'divergent'`. Add a `handler`
  field naming the `CabiProvider` method.

### 3. Pluggable-map plug-in

The upstream-pluggable inpax `SystemFunctionMap` should accept an
override map keyed by ID. We pass it `getDivergentSlots()` from
`packages/inpax-cabi-provider`:

```ts
import { getDivergentSlots } from '@emdzej/ncsx-inpax-cabi-provider';
import { CabiProvider } from '@emdzej/ncsx-inpax-cabi-provider';

const cabi = new CabiProvider(ctx);
const overrides = getDivergentSlots().map((entry) => ({
  id: entry.id,
  handler: cabi[entry.handler.split('.')[1]].bind(cabi),
}));

const vm = new VM(ipo, {
  systemFunctionOverrides: overrides,   // ← upstream inpax adds this
  runtime: { ui, ediabas, ... },
});
```

---

## Stage 2 update — the "verified-same" assumption was wrong

After empirical analysis (`docs/scripts/match-syscall-table.mjs`, run
across all 194 `A_*.ipo` files in NCSEXPER/SGDAT plus the 1,604
Kernfunktion IPOs), **NCSEXPER's slot table diverges from INPA's
across virtually the entire numeric ID range**, not just the few
slots we had flagged. The earlier "verified-same" annotations were
inferred from `inpa.h`/`cabi.h` header similarity, which turns out
to be irrelevant: both apps ship identical `.h` files, but each
embeds its own runtime dispatch table.

Concrete examples from the 789,508 sys-calls we logged:

| Slot | Inpax/INPA name@slot       | Inpax signature                                  | NCSEXPER bytecode pattern (samples)     |
|------|----------------------------|--------------------------------------------------|-----------------------------------------|
| 0x02 | `setitem`                  | `(in: int, in: string, in: bool)` — 3 args       | A_*.ipo: 0 args (795), other: 3 args (5251) |
| 0x0D | `exitwindows`              | `()` — 0 args                                    | 4 in:string args (35,491)               |
| 0x2B | `PEMInitialisiere`         | `(out: bool)` per header, `(out)` per inpax dispatch | 1 in:int arg (19,613, 100%)         |
| 0x53 | `infobox`                  | `(in: string, in: string)` — 2 args              | 5 args (sample seen in `cabimain`)      |

The bytecode opcodes (`0x0C CALL sys`, `0x0D CALLE`, FRAME marker
convention, etc.) are stable across the two hosts — both NCSEXPER
and INPA statically linked the same Softing bytecode interpreter.
What differs is the **runtime function-ID array** in `.data` that
each `.exe` populates in its `CInterpreter` constructor.

The empirical scan also shows NCSEXPER uses **two distinct slot
tables** depending on which IPO family is loaded:

- **CABI runtime** (`A_*.ipo` — 194 files, the coding/identity flow): 55
  distinct slots used in range 0x00..0x60.
- **INPA-style runtime** (D_*.ipo, abs_uc.ipo, ews.ipo, … — 1,604 files,
  Kernfunktionen): 124 distinct slots, partially overlapping but with
  different semantics at the same numeric IDs.

Same interpreter, two contexts, two tables. NCSEXPER probably
swaps which `.data` array is active depending on which IPO it's
loading — needs ghidra to confirm, but the empirical evidence
(same slot used with incompatible signatures across A_* vs others)
is conclusive.

### Current workaround in `apps/ncsx-web/src/lib/runtime.svelte.ts`

We register a no-op `SystemFunctionOverride` for every slot in
`0x00..0x60`, then layer a real handler on slot `0x0D` that routes
to our `CabiProvider.CDHapiJob`. The no-op approach works because
`opCall`'s `popFrame()` truncates the value stack back to the
FRAME marker after each override returns — so args (and any
out-refs the IPO pushed) get cleaned up automatically. Callers
reading out-param destinations see the ALLOC default (0 / "" /
false), which the IPO interprets as "no error" — falls through
to the happy path.

Cost: protocol-report side effects are gone (acceptable — we have
our own UI), and the few real-data slots (apiResult*, CDH*) don't
write back through their refs. The latter doesn't matter for the
current flow because we read EDIABAS results directly off
`cabi.lastJob.sets` after `runCabimain` returns.

### What stage 2 still needs

1. **Dump NCSEXPER.EXE's actual `.data` syscall table via ghidra**.
   Prior attempts (`DumpNcsexperSyscallTable.java`,
   `FindSyscallTableInit.java`) came up empty. The table is
   probably populated programmatically rather than declared as a
   static initialiser — need to find the `CInterpreter`
   constructor (or wherever `[reg+0x50]` writes the handler
   pointers) and follow the function pointers back to named
   symbols.
2. **For each slot the IPO actually uses (55 + 124 distinct,
   union ≈ 150)**, replace the no-op with a real handler that
   reads/writes through refs correctly. Until then, anything
   that depends on syscall return values besides apiJob is
   functionally a no-op.
3. **Confirm the two-table hypothesis**: is there one table per
   IPO style, or is it the same physical array but the IPO
   carries an "expected calling convention" hint we haven't
   identified?
