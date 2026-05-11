import { PredicateError } from './types.js';

/**
 * Evaluate the flat ASCII expression produced by the lexer.
 *
 * Grammar (recursive-descent, mirroring `FUN_0046f4e0` / `FUN_0046f2d0` / `FUN_0046f5e0`):
 *
 * ```ebnf
 * expr     = and_term (',' and_term)*    ; OR
 * and_term = atom    ('+' atom)*          ; AND
 * atom     = '0' | '1' | '!'? '(' expr ')'
 * ```
 *
 * Precedence: `!` (unary) > `+` (AND) > `,` (OR).
 *
 * Whitespace is permitted between tokens (in case a caller pre-prettified the expression).
 */
export function evalExpression(expr: string): boolean {
  let i = 0;
  const peek = (): string | undefined => {
    while (i < expr.length && /\s/.test(expr[i]!)) i++;
    return expr[i];
  };
  const consume = (): string | undefined => {
    const c = peek();
    if (c !== undefined) i++;
    return c;
  };

  const parseAtom = (): boolean => {
    let negate = false;
    if (peek() === '!') {
      consume();
      negate = true;
    }
    const c = consume();
    if (c === '0') return negate ? true : false;
    if (c === '1') return negate ? false : true;
    if (c === '(') {
      const v = parseOr();
      if (consume() !== ')') {
        throw new PredicateError(`expected ')'`, i);
      }
      return negate ? !v : v;
    }
    throw new PredicateError(`unexpected '${c ?? '(end)'}'`, i);
  };

  const parseAnd = (): boolean => {
    let v = parseAtom();
    while (peek() === '+') {
      consume();
      const r = parseAtom();
      v = v && r;
    }
    return v;
  };

  const parseOr = (): boolean => {
    let v = parseAnd();
    while (peek() === ',') {
      consume();
      const r = parseAnd();
      v = v || r;
    }
    return v;
  };

  const result = parseOr();
  if (peek() !== undefined) {
    throw new PredicateError(`trailing characters after expression: '${expr.slice(i)}'`, i);
  }
  return result;
}
