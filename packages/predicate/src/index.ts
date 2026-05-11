import { lexAuftragsausdruck } from './lexer.js';
import { evalExpression } from './parser.js';
import { AswBitSet, EvaluatePredicateOptions } from './types.js';

export { lexAuftragsausdruck } from './lexer.js';
export { evalExpression } from './parser.js';
export {
  PredicateError,
  TOKEN_CLASS,
  type AswBitSet,
  type EvaluatePredicateOptions,
} from './types.js';

/**
 * Evaluate a byte-coded AUFTRAGSAUSDRUCK predicate against the current ASW bit set.
 *
 * Empty predicates evaluate to `true` (a row with no constraints applies to every FA).
 */
export function evalAuftragsausdruck(
  bytes: Uint8Array,
  asw: AswBitSet,
  opts: EvaluatePredicateOptions = {},
): boolean {
  const flat = lexAuftragsausdruck(bytes, asw, opts);
  if (flat === '') return true;
  return evalExpression(flat);
}

/**
 * Walk a predicate's bytes and collect every SA-bit ID it references via `S<id-lo><id-hi>`.
 *
 * Useful for the FA editor's "show me the SAs this row needs" feature and for static analysis
 * (e.g. cross-checking that every referenced ID exists in the ZST dictionary).
 */
export function extractReferencedIds(bytes: Uint8Array): number[] {
  const ids: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x53 && i + 2 < bytes.length) {
      ids.push(bytes[i + 1]! | (bytes[i + 2]! << 8));
      i += 2;
    }
  }
  return ids;
}
