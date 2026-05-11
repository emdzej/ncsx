import { decodeEinheit } from './einheit.js';
import { applyOperationsRead } from './operations.js';
import { CabdError, CabdRule, DecodeOptions, Einheit } from './types.js';

const trailingZeros = (n: number): number => {
  if (n === 0) return 0;
  let i = 0;
  while (((n >>> i) & 1) === 0) i++;
  return i;
};

/**
 * Decode one CABD field from a netto buffer.
 *
 * Pipeline (read direction):
 *
 *  1. Extract `byteadr` bytes at `wortadr` from the netto buffer.
 *  2. AND each extracted byte with its MASKE byte.
 *  3. If `autoShift` (default): right-shift each masked byte by its mask's trailing-zero
 *     count, so the meaningful bits live at the LSB. Multi-byte fields get the same
 *     per-byte treatment.
 *  4. Fold the resulting bytes into a number per EINHEIT.
 *  5. Run the OPERATION list left-to-right.
 *
 * Throws on `wortadr + byteadr` overrun.
 */
export function decodeField(
  rule: CabdRule,
  netto: Uint8Array,
  opts: DecodeOptions = {},
): number {
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

  const src = new Uint8Array(byteadr);
  for (let i = 0; i < byteadr; i++) {
    const masked = netto[wortadr + i]! & (maske[i]! & 0xff);
    const shift = autoShift ? trailingZeros(maske[i]! & 0xff) : 0;
    src[i] = (masked >>> shift) & 0xff;
  }

  const folded = decodeEinheit(src, einheit);
  return applyOperationsRead(folded, rule.operations ?? []);
}
