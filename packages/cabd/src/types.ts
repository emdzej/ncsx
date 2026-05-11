/**
 * `EINHEIT` (unit) character that controls how source bytes fold into the logical value.
 *
 * | Char | Source format | Decoding | Encoding |
 * |------|---------------|----------|----------|
 * | `A`  | ASCII hex digit         | `'0'-'9'` → 0..9; `'A'-'Z'` → 10..35           | inverse |
 * | `a`  | raw ASCII byte          | `c`                                            | `c & 0xff` |
 * | `b`  | ASCII bit-string        | sum of `(c-'0') << pos` per char               | inverse |
 * | `d`  | ASCII decimal digits    | `parseInt(s, 10)`                              | decimal string |
 * | `h`  | hex bytes (LE)          | raw value (u8/u16/u32 LE)                      | raw write |
 */
export type Einheit = 'A' | 'a' | 'b' | 'd' | 'h';

/**
 * One CABD `A`-field OPERATION entry. On the wire each entry is 5 bytes
 * (`op_char + u32 LE operand`); a list of them is packed inside one length-prefixed `A` field.
 */
export type Operation =
  | { op: '!' }
  | { op: '&' | '*' | '+' | '-' | '/' | '>' | '^' | '|'; operand: number };

/**
 * A single CABD coding rule (PARZUWEISUNG_FSW row, simplified).
 *
 * Source-of-truth: `docs/daten-format.md` §1 and §1.7-1.8.
 */
export interface CabdRule {
  /** Byte offset into the netto buffer where this field starts. (`WORTADR` in the CABD row.) */
  wortadr: number;
  /** Number of consecutive bytes the field spans. (`BYTEADR` — a *count*, not a second address.) */
  byteadr: number;
  /** Mask bytes, one per byte covered. Length must equal `byteadr`. */
  maske: number[];
  /** Unit/source-format char. Optional — defaults to `'h'` (raw bytes). */
  einheit?: Einheit;
  /** Operation list applied on read (in-order). Inverse is applied on write. Default: `[]`. */
  operations?: Operation[];
}

export interface DecodeOptions {
  /**
   * When the masked bit slice doesn't start at bit 0 of its byte (i.e. mask is not `0xff`),
   * the decoder auto-applies a trailing-zero right-shift to bring the value into LSB-aligned
   * form before EINHEIT folding. Disable to keep the raw (shifted-up) value.
   */
  autoShift?: boolean;
}

export interface EncodeOptions {
  autoShift?: boolean;
}

export class CabdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CabdError';
  }
}
