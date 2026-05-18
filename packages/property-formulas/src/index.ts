import { FORMULAS } from './formulas.js';
import type { FormulaContext } from './types.js';

export type { Formula, FormulaContext } from './types.js';
export {
  getFloat,
  getFloat0_128,
  getFloatNeg128,
  getFloatNeg8,
  getString,
  invert,
  pow,
  printNumber,
  reverse,
} from './helpers.js';
export { FORMULAS } from './formulas.js';

/**
 * Render a property's raw bytes as a human-readable value using NCS Dummy's per-FSW
 * formula table. Returns `null` when there's no formula for this keyword — the caller
 * should fall back to rendering the raw bytes (and ideally CABD's EINHEIT+OPERATION
 * decoding).
 *
 * Faithful port of `Formulas.ToString` in
 * `NcsDummy/Classes/Formulas/Formulas.cs`. The big switch on `keyword` becomes a Map
 * lookup; cases that gate on `(chassis, module, codingIndex)` do that gating internally.
 */
export function formatValue(ctx: FormulaContext): string | null {
  if (
    !ctx.chassis ||
    !ctx.module ||
    !ctx.keyword ||
    !ctx.mask ||
    ctx.mask.length === 0
  ) {
    return null;
  }
  const formula = FORMULAS.get(ctx.keyword);
  if (!formula) return null;
  return formula(ctx);
}
