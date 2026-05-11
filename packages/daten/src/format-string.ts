import { FieldShape, ScalarType, SCALAR_TYPE } from './types.js';

const SCALAR_CHARS = new Set<string>(Object.values(SCALAR_TYPE));

function isScalar(ch: string): ch is ScalarType {
  return SCALAR_CHARS.has(ch);
}

/**
 * Parse a DATEN format string into a list of {@link FieldShape}s.
 *
 * Grammar:
 *
 * ```ebnf
 * format    = field* ;
 * field     = optional | range | non_empty_list | collection | scalar ;
 * optional  = "{" scalar "}" ;
 * range     = scalar scalar "(" scalar scalar ")" ;
 * non_empty_list = scalar "(" scalar ")" ;
 * collection     = "(" scalar ")" ;
 * scalar    = "B" | "W" | "L" | "S" | "A" ;
 * ```
 *
 * - `range` is checked before `non_empty_list` (so `WW(WW)` is one range, not a scalar + non-empty list).
 * - `non_empty_list` is checked before plain scalar (so `S(S)` is one list, not `S` + collection).
 * - Mismatched (`X` ≠ `Y` in `XY(XY)`) range/list falls back to scalar + collection.
 *
 * Bugs fixed vs. the bimmerz POC (`bimmerz/packages/ncs-data/src/parsers.ts`):
 * - **Bug 2**: range collection is `XX(XX)`, not `((X))`. The POC misdetected it as `((X))` AND
 *   pushed two entries due to a fall-through. Fixed here by recognising `XY(XY)` pairs.
 * - **Bug 3**: non-empty list `X(X)` was indistinguishable from `(X)`. Now exposed as its own kind.
 * - **Bug 4**: truncated `{X` (no `}`) is no longer silently dropped; we warn and skip the stray `{`.
 */
export function parseFormatString(
  format: string,
  onWarning?: (msg: string) => void,
): FieldShape[] {
  const shapes: FieldShape[] = [];
  let i = 0;
  while (i < format.length) {
    const ch = format[i]!;

    // Optional: { X }
    if (ch === '{') {
      const inner = format[i + 1];
      const close = format[i + 2];
      if (inner && isScalar(inner) && close === '}') {
        shapes.push({ kind: 'optional', scalar: inner });
        i += 3;
        continue;
      }
      onWarning?.(`format string: malformed optional at offset ${i}: '${format.slice(i, i + 3)}'`);
      i += 1;
      continue;
    }

    // Plain collection: ( X )
    if (ch === '(') {
      const inner = format[i + 1];
      const close = format[i + 2];
      if (inner && isScalar(inner) && close === ')') {
        shapes.push({ kind: 'collection', scalar: inner });
        i += 3;
        continue;
      }
      onWarning?.(`format string: malformed collection at offset ${i}: '${format.slice(i, i + 3)}'`);
      i += 1;
      continue;
    }

    if (isScalar(ch)) {
      // Range-list?  X X ( X X )
      if (
        format[i + 1] === ch &&
        format[i + 2] === '(' &&
        format[i + 3] === ch &&
        format[i + 4] === ch &&
        format[i + 5] === ')'
      ) {
        shapes.push({ kind: 'range-list', scalar: ch });
        i += 6;
        continue;
      }

      // Non-empty list?  X ( X )
      if (
        format[i + 1] === '(' &&
        format[i + 2] === ch &&
        format[i + 3] === ')'
      ) {
        shapes.push({ kind: 'non-empty-list', scalar: ch });
        i += 4;
        continue;
      }

      // Plain scalar.
      shapes.push({ kind: 'scalar', scalar: ch });
      i += 1;
      continue;
    }

    onWarning?.(`format string: unexpected char '${ch}' at offset ${i}`);
    i += 1;
  }
  return shapes;
}
