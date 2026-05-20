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

## Resolved: v1.x and v5.x share the same syscall ID space for shared names

**Proof from NCSEXPER.EXE directly** — NCSEXPER embeds its own v1.x IPS
compiler / emitter, and the keyword table is laid out in `.rdata` at
consecutive addresses starting `0x48dd34`. The position of each string in
the table corresponds directly to its v1.x system-function ID:

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

### Why I previously thought slot `0x0D` diverged (and why I was wrong)

`FgnrLesen` at offset 0x11 has this sequence:

```
LOAD local[0]              ; JOBNAME (from cabimain arg)
LOAD const "C_FG_LESEN"    ; SGBD-side job name
LOAD const ""
LOAD const ""
CALL sys 0x000D
```

I read this as "4-arg apiJob call at slot 0x0D" → therefore NCSEXPER
diverges from INPA where 0x0D is exitwindows. **The INPACOMP keyword-order
evidence rules that out.** Slot 0x0D is `exitwindows` in NCSEXPER too.

So what ARE those 4 LOADs? Most likely **stack preparation for a
sequence of downstream operations** — IPO bytecode is stack-based and the
operand stack can accumulate values across multiple instructions before
they're consumed. `exitwindows` itself takes 0 args; the LOADs are
populating data for whatever runs after.

Confirmed by: A_KMB46.ipo has **zero** `CALL sys 0x62` (INPAapiJob)
invocations. The IPO never calls apiJob at all. NCSEXPER's COAPI does it
in C code via `FUN_00433a70`'s callees, BEFORE running the IPO. The IPO
is purely observability / state-machine / scriptchange orchestration.

### Where the per-CABD job-name translation actually lives

The strings `"C_FG_LESEN"`, `"C_S_LESEN"`, `"C_S_SCHREIBEN"`, etc. inside
`A_KMB46.ipo` are PEM-report labels or scriptchange targets, not args to
`apiJob`. The real per-CABD translation lives in one of:

- **The SGBD `.prg` itself** — EDIABAS supports job aliases. `KOMBI46R.PRG`
  likely declares `FGNR_LESEN` as an alias for `C_FG_LESEN` inside its
  BEST/2 job-table. NCSEXPER's COAPI calls `apiJob(KOMBI46R, "FGNR_LESEN")`
  and the SGBD interpreter resolves the alias internally.
- **NCSEXPER's COAPI C code** — `FUN_00433a70` may look up the
  CABD-specific name from a static table before calling apiJob.

Both are plausible; only one is true; **resolving which is a follow-up
investigation**. Either way, the IPO's `cabimain` dispatcher isn't
doing the translation — it's just orchestration.

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

## What I expect to find in Stage 2

Educated guesses, to be replaced by ghidra evidence:

| Slot | Inpax name | Likely NCSEXPER behaviour |
|---|---|---|
| `0x00`-`0x08` | setmenutitle..returnstatemachine | **Verified-same** (state-machine + menu primitives shared with INPA) |
| `0x0B` | setjobstatus | **Verified-same** (string-state setter) |
| `0x0C` | exit | **Verified-same** |
| `0x0D` | exitwindows | **Divergent → apiJob** ✓ confirmed |
| `0x0E`-`0x14` | scriptselect..stop | **Verified-same** |
| `0x2B`-`0x3A` | PEM* | **Probably divergent** — NCSEXPER's PEM writes to its own protocol files (TRC etc.) using NCSEXPER-specific formatting, not INPA's print spool. Each slot may end up `divergent` with a `handler` binding into a `PemProvider`. |
| `0x35` | (no inpax name) | **Unknown** — needs ghidra. Could be an apiResult* sibling. |
| `0x40`-`0x4E` | input*/text*/digital*/analog*/hexdump | **Verified-same** (input dialogs + gauges work the same across INPA/NCSEXPER) |
| `0x50` | clearrect | **Verified-same** |
| `0x53`-`0x54` | infobox/userboxopen | **Verified-same** |

The big surface area to audit is the **PEM range** (`0x2B`-`0x3A`):
NCSEXPER's protocol-report system feeds the TRC files we already
discussed, not INPA's print spool — so handlers likely differ even if
the IDs match. Expected outcome: most PEM* entries become `'divergent'`
with `handler` bindings into a future `PemProvider`.

---

## Open questions to resolve in Stage 2

1. **Slot 0x35 (`sys_35`)** — what is it? Possibly an `apiResultText`
   sibling that pairs with `CDHapiJob` at 0x0D for reading per-job
   results.
2. **The PEM slots** — do they all write to the same protocol file?
   Where does that file path come from at runtime?
3. **Are there NCSEXPER-only IDs beyond the inpax range?** Some IPOs we
   haven't disassembled (Cod, Lesen, ZcsLesen) may use IDs > 0x54 that
   inpax has annotated but NCSEXPER repurposes.
