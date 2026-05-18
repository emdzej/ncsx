/**
 * Context passed to every formula. Mirrors NCSDummy's
 * `Formulas.ToString(chassis, module, codingIndex, keyword, mask, data)` signature.
 *
 * Most formulas only look at `data`. A handful gate on `chassis` / `module` /
 * `codingIndex` to pick a chassis-specific decoder (e.g. the BMW E60 fuel-percent formula
 * differs from the F30 one).
 */
export interface FormulaContext {
  chassis: string;
  module: string;
  codingIndex: number;
  keyword: string;
  mask: Uint8Array;
  data: Uint8Array;
}

/**
 * One formula. Returns the decoded human-readable string, or `null` if this formula
 * doesn't apply to the supplied context (e.g. chassis mismatch). When no formula
 * matches at all, the top-level `formatValue` returns `null` and the UI should render
 * the raw bytes.
 */
export type Formula = (ctx: FormulaContext) => string | null;
