import { encodeSaCode } from './sa-code.js';
import { tokenizeFa } from './tokenize.js';
import type { AswSet, FaToAswOptions, FaWarning } from './types.js';

export { encodeSaCode, formatSaCode } from './sa-code.js';
export { tokenizeFa } from './tokenize.js';
export type { AswSet, FaToAswOptions, FaWarning } from './types.js';

/**
 * Convert an FA string into the ASW bit set the predicate evaluator consumes.
 *
 * Tokens are uppercased and stripped of `$` / category-letter prefixes. Each token is
 * encoded as a u16 SA code (hex-nibble-per-char). Unknown tokens produce a warning (or
 * throw in strict mode).
 *
 * If `options.chassis` is given:
 *  - Tokens that don't appear as `category='W'` entries in `chassis.at` produce a
 *    `'unknown-code'` warning.
 *  - Any Zwang (`category='Z'`) entry in `chassis.atM00` whose code is included by the user
 *    is auto-added to the set (mirrors NCSEXPER's "forced inclusion" behaviour).
 */
export function faToAsw(fa: string, options: FaToAswOptions = {}): AswSet {
  const { chassis, onWarning, strict = false } = options;
  const warn = (w: FaWarning): void => {
    if (strict) throw new Error(`${w.kind}: ${w.message}`);
    if (onWarning) onWarning(w);
  };

  const tokens = tokenizeFa(fa);
  const asw: AswSet = new Set();

  for (const token of tokens) {
    const id = encodeSaCode(token);
    if (id === undefined) {
      warn({
        kind: 'malformed-token',
        token,
        message: `cannot encode '${token}' as a 4-hex-digit SA code`,
      });
      continue;
    }
    if (chassis && chassis.at && !chassis.at.has(token) && !chassis.at.has(token.replace(/^0+/, ''))) {
      warn({
        kind: 'unknown-code',
        code: token,
        message: `SA code '${token}' is not in chassis ${chassis.code}'s AT dictionary`,
      });
    }
    asw.add(id);
  }

  // Auto-expand Zwang codes from AT.M00 — every `Z #NNNN` entry implies the SA code is
  // forced-on as a downstream consequence of one of the W codes the user typed.
  if (chassis?.atM00) {
    for (const entry of chassis.atM00.entries) {
      if (entry.category !== 'Z') continue;
      const code = entry.code.replace(/^#/, '');
      const id = encodeSaCode(code);
      if (id !== undefined) asw.add(id);
    }
  }

  return asw;
}
