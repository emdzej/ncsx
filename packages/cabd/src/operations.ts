import { Operation, CabdError } from './types.js';

const U32 = (n: number): number => n >>> 0;

/**
 * Apply a single OPERATION to a value (read direction). Matches the dispatcher in NCSEXPER's
 * `GetDataFromOperation` (`FUN_004575c0`, `CBD_READ.C`).
 */
export function applyOperation(value: number, op: Operation): number {
  switch (op.op) {
    case '!':
      return U32(value ^ 0xffffffff);
    case '&':
      return U32(value & op.operand);
    case '*':
      return U32(value * op.operand);
    case '+':
      return U32(value + op.operand);
    case '-':
      return U32(value - op.operand);
    case '/':
      if (op.operand === 0) throw new CabdError('division by zero in CABD operation');
      return U32(Math.trunc(value / op.operand));
    case '>': {
      // Right-shift with auto-mask: keep only the bits that survive the shift.
      const n = op.operand & 0x1f;
      const mask = n === 0 ? 0xffffffff : ((1 << (32 - n)) - 1) >>> 0;
      return U32((value >>> n) & mask);
    }
    case '^':
      return U32(value ^ op.operand);
    case '|':
      return U32(value | op.operand);
  }
}

/**
 * Walk the operation list left-to-right and fold them into the value (read direction).
 */
export function applyOperationsRead(value: number, ops: readonly Operation[]): number {
  let v = value;
  for (const op of ops) v = applyOperation(v, op);
  return v;
}

/**
 * Invert a single OPERATION (used during encode).
 *
 * - `!` is self-inverse.
 * - `+ n` ↔ `- n`, `* n` ↔ `/ n`.
 * - `& n`, `| n`, `^ n` are involutions over the masked bit slice — re-applying them recovers
 *   the original. We still apply them again on encode so the round-trip is correct for the
 *   masked region (the splice step then ANDs with `~MASKE` and ORs the result back in).
 * - `> n` (right-shift) inverts to `< n` (left-shift), implemented via an inverse operator.
 */
export function invertOperation(op: Operation): Operation {
  switch (op.op) {
    case '!':
      return { op: '!' };
    case '+':
      return { op: '-', operand: op.operand };
    case '-':
      return { op: '+', operand: op.operand };
    case '*':
      return { op: '/', operand: op.operand };
    case '/':
      return { op: '*', operand: op.operand };
    case '>':
      // The inverse of right-shift is left-shift. Encode-only synthetic op.
      return { op: '*', operand: U32(1 << (op.operand & 0x1f)) };
    case '&':
    case '|':
    case '^':
      return op;
  }
}

/**
 * Apply the inverse OPERATION list (right-to-left with each op inverted) to recover the
 * source bytes that, when read through the forward pipeline, yield `value`.
 */
export function applyOperationsWrite(value: number, ops: readonly Operation[]): number {
  let v = value;
  for (let i = ops.length - 1; i >= 0; i--) {
    v = applyOperation(v, invertOperation(ops[i]!));
  }
  return v;
}
