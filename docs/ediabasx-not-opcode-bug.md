# `not` opcode (`0x0A`) calls a 2-operand helper with a `{kind:"none"}` placeholder → "Cannot read value from operand"

## TL;DR

The `not` (bitwise complement) opcode handler at `packages/interpreter/src/interpreter.ts:1570` is unary, but it dispatches through the generic `arithmeticReadModifyWrite` helper, which unconditionally calls `readPolyValue(state, arg1, len)` (line 674). The handler passes `{ kind: "none" } as Operand` as a placeholder for `arg1`. `readPolyValue` has no branch for `kind === "none"` and falls through to the final `throw new EdiabasError(EdiabasErrorCodes.INVALID_INSTRUCTION, "Cannot read value from operand")` at line 599.

Net effect: any BEST2 job that executes `not` aborts with the cryptic *"Cannot read value from operand"* message.

Affects: every job that uses `not`. Real-world repro: BMW E46 `KOMBI46R.prg::C_CHECKSUM` — runs `not L0` at addresses `0x1F4CC` and `0x1F5A4` to negate a 32-bit register inside its post-coding verify path. NCS Expert's `SG_CODIEREN` flow can't complete because of this.

## Root cause

```ts
// packages/interpreter/src/interpreter.ts:1569..1576
// 0x0a: not - bitwise complement, indexed dest supported.
0x0a: async (state, arg0) => {
  arithmeticReadModifyWrite(state, arg0, { kind: "none" } as Operand, (val0, _val1, len) => {
    const mask = maskForLen(len);
    const result = (~val0) & mask;
    return { result, flagsPatch: { ...updateZS(result, len), v: false } };
  });
},
```

```ts
// packages/interpreter/src/interpreter.ts:658..686  (arithmeticReadModifyWrite)
const len = Math.max(1, getOperandLen(state, arg0, true));
const val0 = readPolyValue(state, arg0, len);
const val1 = readPolyValue(state, arg1, len);          // ← throws on { kind: "none" }
const { result, flagsPatch } = compute(val0, val1, len);
```

```ts
// packages/interpreter/src/interpreter.ts:569..600  (readPolyValue / readIntegerValue)
if (operand.kind === "immediate") { … }
if (operand.kind === "register")  { … }
if (operand.kind === "indexed" || operand.kind === "string") { … }
throw new EdiabasError(EdiabasErrorCodes.INVALID_INSTRUCTION, "Cannot read value from operand");
```

`not` is unary; `arithmeticReadModifyWrite` is for binary ops. The unary handler papers over the mismatch with `{ kind: "none" }` but the helper has no special case for that.

## Proposed fix

Either (a) special-case the helper to skip `arg1` when its `kind === "none"`, or (b) give the unary handler its own helper. (b) is cleaner:

```ts
// new helper alongside arithmeticReadModifyWrite
function unaryReadModifyWrite(
  state: InterpreterState,
  arg0: Operand,
  compute: (val0: number, len: number) => { result: number; flagsPatch: Partial<Flags> }
): void {
  if (arg0.kind === "register" && (arg0.ref.kind === "S" || arg0.ref.kind === "F")) {
    throw new EdiabasError(
      EdiabasErrorCodes.REGISTER_ERROR,
      `Cannot perform arithmetic on ${arg0.ref.kind} register`
    );
  }
  if (arg0.kind !== "register" && arg0.kind !== "indexed") {
    throw new EdiabasError(
      EdiabasErrorCodes.INVALID_INSTRUCTION,
      "Expected register or indexed destination"
    );
  }
  const len = Math.max(1, getOperandLen(state, arg0, true));
  const val0 = readPolyValue(state, arg0, len);
  const { result, flagsPatch } = compute(val0, len);
  if (arg0.kind === "register") {
    setIntValue(state.registers, arg0.ref as IntRegisterRef, result);
  } else {
    writePolyValue(state, arg0, result, len);
  }
  if (flagsPatch.z !== undefined) state.flags.z = flagsPatch.z;
  if (flagsPatch.s !== undefined) state.flags.s = flagsPatch.s;
  if (flagsPatch.v !== undefined) state.flags.v = flagsPatch.v;
  if (flagsPatch.c !== undefined) state.flags.c = flagsPatch.c;
}

// then opcode 0x0a becomes:
0x0a: async (state, arg0) => {
  unaryReadModifyWrite(state, arg0, (val0, len) => {
    const mask = maskForLen(len);
    const result = (~val0) & mask;
    return { result, flagsPatch: { ...updateZS(result, len), v: false } };
  });
},
```

A check across the opcode table shows this is the only unary arithmetic op that goes through the binary helper — other unary ops (negation via `subb 0,X`, etc.) compose via different paths.

## Reproduction

### A. Unit test

```ts
import { describe, it, expect } from "vitest";
import { Interpreter, /* whatever the test setup helpers are */ } from "@emdzej/ediabasx-interpreter";

describe("opcode 0x0A (not) on a register", () => {
  it("complements an L register in place", async () => {
    // Build a one-instruction job: `not L0` with L0 preset to 0x12345678.
    const state = makeState({ L: [0x12345678, 0, 0, 0, 0, 0, 0, 0] });
    await execOnce(state, opcode(0x0a, regOperand("L", 0)));
    expect(getInt(state, "L", 0)).toBe(0xEDCBA987 >>> 0); // ~0x12345678
    expect(state.flags.s).toBe(true);   // high bit set
    expect(state.flags.z).toBe(false);
    // currently: throws EdiabasError "Cannot read value from operand"
  });
});
```

### B. Real-SGBD repro (BMW E46 KMB coding)

`inpa/EDIABAS/Ecu/KOMBI46R.prg`, job `C_CHECKSUM`. Triggered by the NCS-Expert `SG_CODIEREN` IPO immediately after the per-chunk `C_S_AUFTRAG` write loop completes. Symptoms: 16 successful `C_S_AUFTRAG` calls followed by `EdiabasError: Cannot read value from operand` from `executeJob("C_CHECKSUM", …)`.

Disasm of the failing site (from `ediabasx disasm KOMBI46R.prg C_CHECKSUM`):

```
[0001F4CC] not  L0       ; ← throw site #1
…
[0001F5A4] not  L0       ; ← throw site #2 (same handler)
```

Either fires depending on which arm of C_CHECKSUM's verify path runs. Both bail with the same exception today.

## Why this hadn't surfaced before

`not` is uncommon in read-only diagnostic jobs (`IDENT`, `STATUS_*`) but very common in verify / checksum / encode paths. Tests against `C_S_LESEN` and `IDENT` for E46 KMB never executed `not`, so the bug stayed latent. The first job that hit it was `C_CHECKSUM` during the SG_CODIEREN write flow, which only runs once everything upstream (auth, slot table seeding, binary param NUL-append fix from 0.2.5, etc.) is right.
