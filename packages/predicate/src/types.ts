/**
 * A set of currently-active ASW (variant) bit IDs. The predicate evaluator consults this when
 * resolving `S<id-lo><id-hi>` tokens.
 */
export type AswBitSet = ReadonlySet<number> | { has(id: number): boolean };

export interface EvaluatePredicateOptions {
  /**
   * Called when the predicate references an unknown SA bit ID. Default behaviour: treat as `0`
   * (bit not present).
   */
  onUnknownBit?: (id: number) => void;
  /**
   * In "list mode" (mirroring NCSEXPER's `param_4 = 1` lexer flag), the FA-matcher rewrites
   * the predicate to emit a list of contributing bit IDs rather than a boolean. We don't
   * implement this mode in the evaluator — use {@link extractReferencedIds} instead.
   */
}

/**
 * Token-classifier numbers — match `FUN_0046f330` in NCSEXPER. Useful for diagnostics.
 */
export const TOKEN_CLASS = {
  EOF: 6,        // \0, \n, \r — end of expression
  NOT: 2,        // '!'
  LPAREN: 9,     // '('
  RPAREN: 10,    // ')'
  COMBINATOR: 3, // '+' (AND) or ',' (OR)
  LITERAL: 1,    // '0' or '1'
  ERROR: 0,      // anything else
} as const;

export class PredicateError extends Error {
  constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message);
    this.name = 'PredicateError';
  }
}
