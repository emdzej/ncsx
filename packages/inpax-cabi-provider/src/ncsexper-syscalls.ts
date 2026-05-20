/**
 * NCSEXPER IPO interpreter syscall table — staged inventory.
 *
 * NCSEXPER's IPO interpreter (`CInterpreter::DoInterpret` at
 * `NCSEXPER.EXE 0x0045d830`) dispatches `CALL sys <id>` opcodes (opcode
 * `0x0C` with flag byte `0x81`) through a function-pointer array at
 * `(this+0x50)[id]`. The resolver is `FUN_004689e0` at
 * `NCSEXPER.EXE 0x004689e0`:
 *
 *   if (param_2 != 0x80) {                      // flag = 0x81 → sys
 *     *result = *(addr at this+0x50)[id];       // table base
 *     return 2;                                 // → "call directly"
 *   }
 *
 * The dispatcher in `DoInterpret` then invokes the resolved handler as
 * `(*handler)(vm_context, &shared_result_slot)`. Each handler pops its
 * args off the IPO operand stack and writes outputs through the result
 * slot.
 *
 * **NCSEXPER stores ZERO string names for its syscalls** — `grep` over
 * NCSEXPER.EXE for "setmenutitle" / "INPAapiJob" / "exitwindows" returns
 * nothing. Dispatch is purely numeric. So the only way to know what each
 * slot does is to read the table at runtime (or via a ghidra script).
 *
 * **This file is the inventory we can build without runtime memory
 * access.** Each entry includes:
 *
 *   - `id`             — the numeric slot
 *   - `inpaName`       — INPA's name for that ID (per inpax-core
 *                        `SystemFunctionMap`); this is the disassembler's
 *                        annotation and the BASELINE assumption
 *   - `signature`      — `(stack_in[]) → stack_out[]` shape per INPA spec
 *   - `verified`       — `'observed'` (used by NCSEXPER IPOs), `'inpa-only'`
 *                        (not seen in any NCSEXPER IPO), `'verified-same'`
 *                        (ghidra-confirmed identical to INPA), `'divergent'`
 *                        (ghidra-confirmed NCSEXPER differs from INPA)
 *   - `evidence`       — short note on the verification status
 *
 * ## Filling in Stage 2
 *
 * Once the inpax `SystemFunctionMap` is pluggable upstream, run this
 * recipe to upgrade `verified: 'observed'` entries to either
 * `'verified-same'` or `'divergent'`:
 *
 *   1. In ghidra, find any `CInterpreter` instance (one of the globals
 *      around `DAT_007aa500`..`DAT_007aa568` references it; the
 *      constructor is reachable via xrefs to `s_CDHIntTrigger_005b0874`).
 *   2. Read pointer at `this + 0x50` — that's the syscall table base.
 *   3. For each ID below, read `table[id]` (4-byte function address).
 *   4. Decompile each handler:
 *        `mcp__ghidra__decompile_function_by_address(addr)`
 *      Compare body against the INPA spec. Identical-ish → `'verified-same'`.
 *      Calls into the CDH-* bridge or api32.dll → `'divergent'`.
 *
 * For each `'divergent'` entry, add a `handler` field naming the
 * TypeScript implementation that should bind to that slot — that's what
 * the upstream-pluggable inpax SystemFunctionMap will consume.
 */

export type SyscallVerification =
  | 'observed' // used by NCSEXPER IPOs we've disassembled; semantics unverified
  | 'inpa-only' // listed in INPA spec; not seen in NCSEXPER IPOs
  | 'verified-same' // ghidra-confirmed identical to INPA
  | 'divergent'; // ghidra-confirmed NCSEXPER differs from INPA

export interface NcsexperSyscallEntry {
  id: number;
  inpaName: string;
  /**
   * Human-readable arg/return shape from inpax-core's IPO docs. For
   * divergent slots, add `ncsexperSignature` once we know it.
   */
  signature: string;
  verified: SyscallVerification;
  evidence: string;
  /**
   * Method name on `CabiProvider` (or fully-qualified provider path) that
   * should bind to this slot in the pluggable SystemFunctionMap. Only
   * set for `'divergent'` entries; `undefined` for everything else
   * (inpax's stock handler still works).
   */
  handler?: string;
}

/**
 * The ID-keyed map. Entries are ordered by ID so future agents can scan
 * for the first gap when adding new observed IDs.
 *
 * Currently 40+ entries reflect the IDs called from `A_KMB46.ipo`
 * (E46 KMB/AKMB module dispatcher) — see `/tmp/akmb.dis` after running
 * `pnpm cli disasm A_KMB46.ipo` from the inpax workspace.
 */
export const NCSEXPER_SYSCALL_TABLE: Record<number, NcsexperSyscallEntry> = {
  0x00: {
    id: 0x00,
    inpaName: 'setmenutitle',
    signature: '(string title) → void',
    verified: 'observed',
    evidence:
      'Called from A_KMB46.ipo. INPA UI primitive — NCSEXPER may no-op since it has its own MFC menu title.',
  },
  0x01: {
    id: 0x01,
    inpaName: 'setmenu',
    signature: '(int handle, item[] items) → void',
    verified: 'observed',
    evidence: 'Called from A_KMB46.ipo. INPA F-key menu setup.',
  },
  0x02: {
    id: 0x02,
    inpaName: 'setitem',
    signature: '(int slot, string label) → void',
    verified: 'observed',
    evidence: 'Called from A_KMB46.ipo.',
  },
  0x06: {
    id: 0x06,
    inpaName: 'setstate',
    signature: '(int sm, string state) → void',
    verified: 'observed',
    evidence: 'Called from A_KMB46.ipo. State-machine transition.',
  },
  0x07: {
    id: 0x07,
    inpaName: 'callstatemachine',
    signature: '(int sm) → void',
    verified: 'observed',
    evidence: 'Called from A_KMB46.ipo.',
  },
  0x08: {
    id: 0x08,
    inpaName: 'returnstatemachine',
    signature: '() → void',
    verified: 'observed',
    evidence: 'Called from A_KMB46.ipo.',
  },
  0x0b: {
    id: 0x0b,
    inpaName: 'setjobstatus',
    signature: '(string status) → void',
    verified: 'observed',
    evidence:
      'Called from A_KMB46.ipo right before every CALL sys 0x0D. Sets the "current job" label that NCSEXPER displays in the status bar.',
  },
  0x0c: {
    id: 0x0c,
    inpaName: 'exit',
    signature: '() → void',
    verified: 'observed',
    evidence: 'IPO terminate (called from __inpa_shutdown__).',
  },
  0x0d: {
    id: 0x0d,
    inpaName: 'exitwindows',
    signature: '() → void',
    verified: 'verified-same',
    evidence:
      "Confirmed via NCSEXPER.EXE's own embedded v1.x IPS compiler keyword table: " +
      "string 'exitwindows' at .rdata offset 0x48dde0 — 13th position in the table starting at " +
      "0x48dd34. Matches inpax-core's v5.x ID 0x0D. The 4-LOAD-then-CALL pattern in FgnrLesen " +
      "is stack manipulation for downstream ops, NOT args to exitwindows. " +
      "Independently confirmed in INPACOMP.exe (v5.x reference compiler) at the same position. " +
      "See docs/ncsexper-syscall-table.md.",
  },
  0x0e: {
    id: 0x0e,
    inpaName: 'scriptselect',
    signature: '(string title, list options) → string',
    verified: 'observed',
    evidence: 'A_KMB46.ipo offers an IPO-chooser dialog via this.',
  },
  0x0f: {
    id: 0x0f,
    inpaName: 'scriptchange',
    signature: '(string scriptName, int flag, string param) → void',
    verified: 'observed',
    evidence:
      'A_KMB46.ipo::Lesen calls scriptchange("ID_COD_INDEX", 1, "") to chain into a coding-index lookup script. Critical for the read flow.',
  },
  0x10: {
    id: 0x10,
    inpaName: 'select',
    signature: '(int item) → void',
    verified: 'observed',
    evidence: 'Activates a menu / scriptselect item.',
  },
  0x14: {
    id: 0x14,
    inpaName: 'stop',
    signature: '() → void',
    verified: 'observed',
    evidence: 'Aborts current run.',
  },
  0x2b: {
    id: 0x2b,
    inpaName: 'PEMInitialisiere',
    signature: '(int flag) → void',
    verified: 'observed',
    evidence:
      "PEM (Print Element Manager) starts a new protocol report. NCSEXPER and INPA both have this; suspect 'verified-same'.",
  },
  0x2c: {
    id: 0x2c,
    inpaName: 'PEMProtokollKopf',
    signature: '(string header) → void',
    verified: 'inpa-only',
    evidence: 'Not observed in A_KMB46.ipo but in other IPOs likely.',
  },
  0x2d: {
    id: 0x2d,
    inpaName: 'PEMProtokollZeile',
    signature: '(string row) → void',
    verified: 'inpa-only',
    evidence: 'Not observed in A_KMB46.ipo.',
  },
  0x2e: {
    id: 0x2e,
    inpaName: 'PEMSGZ_Kopfzeile',
    signature: '(string label, ref local1, ref local2) → void',
    verified: 'observed',
    evidence: 'Heavy use across A_KMB46.ipo. Writes a section-header line to the PEM report.',
  },
  0x2f: {
    id: 0x2f,
    inpaName: 'PEMTrennLinie',
    signature: '(string sectionLabel, ref local1, ref local2) → void',
    verified: 'observed',
    evidence:
      'Called from cabimain at offset 0x06 with "JOBNAME" label. Writes a divider in the PEM report.',
  },
  0x33: {
    id: 0x33,
    inpaName: 'PEMProtokollAusgabe',
    signature: '(string section, ref payload) → void',
    verified: 'observed',
    evidence: 'Emit a protocol output line. Heavy use.',
  },
  0x35: {
    id: 0x35,
    inpaName: 'sys_35',
    signature: 'unknown',
    verified: 'observed',
    evidence:
      'inpax-core has no name for ID 0x35. Could be NCSEXPER-only or an INPA syscall inpax-core hasnt catalogued. Needs ghidra to identify.',
  },
  0x36: {
    id: 0x36,
    inpaName: 'PEMPrintFormular',
    signature: '() → void',
    verified: 'observed',
    evidence: 'PEM form printer.',
  },
  0x37: {
    id: 0x37,
    inpaName: 'PEMPrinter_ff',
    signature: '() → void',
    verified: 'observed',
    evidence: 'PEM form-feed.',
  },
  0x38: {
    id: 0x38,
    inpaName: 'PEMFree_mem',
    signature: '() → void',
    verified: 'observed',
    evidence: 'PEM cleanup.',
  },
  0x39: {
    id: 0x39,
    inpaName: 'PEMLoad_formular',
    signature: '() → void',
    verified: 'observed',
    evidence: 'Load a PEM form from disk.',
  },
  0x3a: {
    id: 0x3a,
    inpaName: 'PEMDefault_druckfeld',
    signature: '() → void',
    verified: 'observed',
    evidence: 'Default print field setup.',
  },
  0x40: {
    id: 0x40,
    inpaName: 'inputnum',
    signature: '(string title, string prompt, string suffix, ref out) → void',
    verified: 'observed',
    evidence: 'Used by Lesen to read CODIERINDEX.',
  },
  0x41: {
    id: 0x41,
    inpaName: 'inputhex',
    signature: '(string title, string prompt, string suffix, ref out) → void',
    verified: 'observed',
    evidence: 'Hex input dialog.',
  },
  0x43: {
    id: 0x43,
    inpaName: 'input2text',
    signature: 'unknown',
    verified: 'observed',
    evidence: 'Two-string input dialog.',
  },
  0x44: {
    id: 0x44,
    inpaName: 'input2hexnum',
    signature: 'unknown',
    verified: 'observed',
    evidence: 'Two-field hex/num input.',
  },
  0x45: {
    id: 0x45,
    inpaName: 'input2hex',
    signature: 'unknown',
    verified: 'observed',
    evidence: 'Two-field hex input.',
  },
  0x48: {
    id: 0x48,
    inpaName: 'text',
    signature: '(string text) → void',
    verified: 'observed',
    evidence: 'Plain text output to screen.',
  },
  0x49: {
    id: 0x49,
    inpaName: 'textout',
    signature: '(string text, …) → void',
    verified: 'observed',
    evidence: 'Formatted text output.',
  },
  0x4a: {
    id: 0x4a,
    inpaName: 'ftextout',
    signature: '(string format, …) → void',
    verified: 'observed',
    evidence: 'printf-style text output.',
  },
  0x4b: {
    id: 0x4b,
    inpaName: 'digitalout',
    signature: '(ref value, ref status) → void',
    verified: 'observed',
    evidence: 'Digital gauge.',
  },
  0x4c: {
    id: 0x4c,
    inpaName: 'analogout',
    signature: 'unknown',
    verified: 'observed',
    evidence: 'Analog gauge.',
  },
  0x4d: {
    id: 0x4d,
    inpaName: 'multianalogout',
    signature: 'unknown',
    verified: 'observed',
    evidence: 'Multi-gauge.',
  },
  0x4e: {
    id: 0x4e,
    inpaName: 'hexdump',
    signature: '(ref bytes, int length) → string',
    verified: 'observed',
    evidence: 'Hex-formatted dump.',
  },
  0x50: {
    id: 0x50,
    inpaName: 'clearrect',
    signature: '(int x, int y, int w, int h) → void',
    verified: 'observed',
    evidence: 'Clear screen region.',
  },
  0x53: {
    id: 0x53,
    inpaName: 'infobox',
    signature: '(string text) → void',
    verified: 'observed',
    evidence: 'Modal info popup.',
  },
  0x54: {
    id: 0x54,
    inpaName: 'userboxopen',
    signature: '(int handle, string title) → void',
    verified: 'observed',
    evidence: 'Open a userbox for free-text content.',
  },
};

/**
 * Convenience accessor — returns the entry or a synthetic 'unknown'
 * entry with `verified: 'inpa-only'` (so consumer fallbacks pick the
 * stock inpax handler).
 */
export function getNcsexperSyscall(id: number): NcsexperSyscallEntry {
  return (
    NCSEXPER_SYSCALL_TABLE[id] ?? {
      id,
      inpaName: `sys_${id.toString(16).padStart(2, '0').toLowerCase()}`,
      signature: 'unknown',
      verified: 'inpa-only',
      evidence: 'Not observed in any NCSEXPER IPO inspected so far.',
    }
  );
}

/**
 * Quick lookup for "what overrides do I need to apply to the inpax
 * stock SystemFunctionMap to support NCSEXPER's IPOs?" Returns only the
 * `'divergent'` entries — the rest can use inpax's defaults.
 */
export function getDivergentSlots(): NcsexperSyscallEntry[] {
  return Object.values(NCSEXPER_SYSCALL_TABLE).filter(
    (e) => e.verified === 'divergent',
  );
}
