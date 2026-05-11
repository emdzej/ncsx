import { encodeEinheit } from './einheit.js';
import { applyOperationsWrite } from './operations.js';
import { CabdError, CabdRule, EncodeOptions, Einheit } from './types.js';

const trailingZeros = (n: number): number => {
  if (n === 0) return 0;
  let i = 0;
  while (((n >>> i) & 1) === 0) i++;
  return i;
};

/**
 * Encode one CABD field into a netto buffer, in place.
 *
 * Pipeline (write direction):
 *
 *  1. Invert the OPERATION list (apply each inverse op in reverse order) on `value` to
 *     recover the LSB-aligned source value.
 *  2. Format into `byteadr` source bytes per EINHEIT.
 *  3. If `autoShift` (default): shift each source byte back up to where its MASKE expects
 *     the bits (left-shift by the mask's trailing-zero count).
 *  4. For each byte at `wortadr + i`:
 *       `netto[wortadr+i] = (netto[wortadr+i] & ~MASKE[i]) | (shifted[i] & MASKE[i])`.
 *
 * Mutates `netto` in place and returns it for chaining.
 */
export function encodeField(
  rule: CabdRule,
  value: number,
  netto: Uint8Array,
  opts: EncodeOptions = {},
): Uint8Array {
  const { wortadr, byteadr, maske } = rule;
  const einheit: Einheit = rule.einheit ?? 'h';
  const autoShift = opts.autoShift ?? true;

  if (wortadr + byteadr > netto.length) {
    throw new CabdError(
      `field at WORTADR=0x${wortadr.toString(16)} BYTEADR=${byteadr} overruns netto buffer (length ${netto.length})`,
    );
  }
  if (maske.length !== byteadr) {
    throw new CabdError(`MASKE length (${maske.length}) must equal BYTEADR (${byteadr})`);
  }

  const preOps = applyOperationsWrite(value >>> 0, rule.operations ?? []);
  const src = encodeEinheit(preOps, byteadr, einheit);

  for (let i = 0; i < byteadr; i++) {
    const mask = maske[i]! & 0xff;
    const shift = autoShift ? trailingZeros(mask) : 0;
    const shifted = (src[i]! << shift) & 0xff;
    netto[wortadr + i] = (netto[wortadr + i]! & (~mask & 0xff)) | (shifted & mask);
  }
  return netto;
}
