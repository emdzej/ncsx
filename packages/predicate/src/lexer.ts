import { AswBitSet, EvaluatePredicateOptions, PredicateError } from './types.js';

/**
 * Resolve the byte-coded AUFTRAGSAUSDRUCK source into a flat ASCII expression string.
 *
 * The wire bytes are walked one tag at a time:
 *
 * | Byte | Source char | Effect |
 * |------|-------------|--------|
 * | `0x53` `'S'` | `S<id-lo><id-hi>` | Emit `'1'` if `asw.has(id)`, otherwise `'0'`. |
 * | `0x21` `'!'` | `!` | Pass through (unary NOT — applies to the next `(`). |
 * | `0x28` `'('` | `(` | Pass through. |
 * | `0x29` `')'` | `)` | Pass through. |
 * | `0x2b` `'+'` | `+` | Pass through (AND combinator). |
 * | `0x2c` `','` | `,` | Pass through (OR combinator). |
 * | `0x5c` `'\\'` | continuation marker | Treated as whitespace — multi-frame predicate joiner. |
 *
 * Any other byte aborts the lex with a {@link PredicateError}.
 *
 * Faithful re-implementation of `FUN_0045e780` in NCSEXPER.
 */
export function lexAuftragsausdruck(
  bytes: Uint8Array,
  asw: AswBitSet,
  opts: EvaluatePredicateOptions = {},
): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    switch (b) {
      case 0x53: { // 'S' <id-lo> <id-hi>
        if (i + 2 >= bytes.length) {
          throw new PredicateError(`truncated S<id> token`, i);
        }
        const id = bytes[i + 1]! | (bytes[i + 2]! << 8);
        const present = asw.has(id);
        if (!present && opts.onUnknownBit) opts.onUnknownBit(id);
        out += present ? '1' : '0';
        i += 3;
        break;
      }
      case 0x21: // !
      case 0x28: // (
      case 0x29: // )
      case 0x2b: // +
      case 0x2c: // ,
        out += String.fromCharCode(b);
        i += 1;
        break;
      case 0x5c: // '\' continuation marker — treated as whitespace
        i += 1;
        break;
      case 0x00:
      case 0x0a:
      case 0x0d:
        // End-of-content terminators (rare on the wire; defensive).
        i = bytes.length;
        break;
      default:
        throw new PredicateError(
          `unexpected byte 0x${b.toString(16).padStart(2, '0')}`,
          i,
        );
    }
  }
  return out;
}
