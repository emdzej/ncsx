/**
 * Encode a token as the u16 SA code the predicate evaluator's `S<id-lo><id-hi>` opcode uses.
 *
 * Each character of the token is treated as a hex nibble. For 3-character codes the leading
 * nibble is implicitly `0` (so `"902"` and `"0902"` both encode to `0x0902`). The result is
 * an unsigned 16-bit value.
 *
 * Returns `undefined` for tokens that can't be encoded (contain non-hex chars, too long, etc.).
 *
 * Examples:
 *
 * ```
 * "0902"  → 0x0902
 * "902"   → 0x0902
 * "4AC"   → 0x04AC
 * "FFFF"  → 0xFFFF
 * "6UD"   → undefined  (U is not a hex digit)
 * ""      → undefined
 * ```
 */
export function encodeSaCode(token: string): number | undefined {
  if (token.length === 0 || token.length > 4) return undefined;
  if (!/^[0-9A-Fa-f]+$/.test(token)) return undefined;
  return parseInt(token.padStart(4, '0'), 16) & 0xffff;
}

/**
 * Format a u16 SA code back to its 4-character canonical form (uppercase hex, zero-padded).
 *
 * ```
 * 0x0902 → "0902"
 * 0x04AC → "04AC"
 * ```
 */
export function formatSaCode(id: number): string {
  return (id & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}
