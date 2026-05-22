import type { FunctionItem, Parameter } from './types.js';

/**
 * NCSDummy's `Mask.UnmaskByte` — shift the masked bits of `byteVal` down
 * to bit position 0 to get the logical value of the field. CABD stores
 * PSW data in logical form (`0/1/2/3` for a 2-bit field, not
 * `0/8/16/24`), so the netto byte has to be normalized the same way
 * before comparing to a PSW's data.
 */
function unmaskByte(byteVal: number, mask: number): number {
  const masked = mask & 0xff;
  if (masked === 0) return 0;
  if (masked === 0xff) return byteVal & 0xff;
  let m = masked;
  let d = byteVal & 0xff;
  while ((m & 1) === 0) {
    m >>= 1;
    d >>= 1;
  }
  return d & m;
}

/**
 * Inverse of `unmaskByte`: shift a logical value (0..N) into the bit
 * positions the mask occupies. Mirrors NCSDummy's `Mask.MaskByte`.
 * Used when applying a PSW selection back to a netto byte.
 */
export function maskByte(value: number, mask: number): number {
  const masked = mask & 0xff;
  if (masked === 0) return 0;
  if (masked === 0xff) return value & 0xff;
  let m = masked;
  let v = value & 0xff;
  while ((m & 1) === 0) {
    m >>= 1;
    v <<= 1;
  }
  return v & masked;
}

/**
 * Compare the FSW's slice of the netto buffer (`[address, address+length)`) against a
 * candidate `Parameter.data`. The PSW data is in logical (unshifted) form per CABD
 * convention, so we shift-normalize the netto byte using the FSW's `mask` before
 * comparing. Bits outside the mask are ignored — that's how multiple FSWs can share
 * the same byte without interfering.
 *
 * Returns `false` if the netto buffer is too short to cover the slice.
 */
function matchesPsw(netto: Uint8Array, fn: FunctionItem, data: Uint8Array): boolean {
  if (netto.length < fn.address + fn.length) return false;
  for (let i = 0; i < fn.length; i++) {
    const m = fn.mask[i] ?? 0;
    const n = netto[fn.address + i] ?? 0;
    const d = data[i] ?? 0;
    if (unmaskByte(n, m) !== (d & 0xff)) return false;
  }
  return true;
}

/**
 * Identify which `Parameter` (PSW) is currently selected for this FSW given the SG's
 * netto buffer. Returns `null` when:
 *
 * - the netto buffer is too short for this FSW's slot (incomplete read), or
 * - no enumerated PSW's masked bytes match the buffer's masked bytes (the SG is coded to
 *   a "custom" value not in CABD's `PARZUWEISUNG_PSW1` enumeration, which happens on
 *   manually-edited ECUs).
 *
 * Pure function — does not mutate. Safe to call repeatedly during render.
 */
export function decodeCurrentPsw(
  fn: FunctionItem,
  netto: Uint8Array,
): Parameter | null {
  for (const p of fn.parameters) {
    if (matchesPsw(netto, fn, p.data)) return p;
  }
  return null;
}

/**
 * Splice a new PSW selection into a copy of the netto buffer. Only the bits inside the
 * FSW's `mask` change — bits owned by sibling FSWs in the same byte are preserved.
 *
 * The returned buffer is a fresh `Uint8Array`; the input is untouched. This is the
 * lowest-level coding operation: equivalent to one CABD `encodeField()` call but using
 * the function-list's pre-resolved `Parameter.data` instead of re-running the CABD rule.
 *
 * Throws if `param` is not one of `fn.parameters` (programmer error — pick from the
 * same FunctionItem you're targeting). Pads the output with zeros if `netto` is shorter
 * than `fn.address + fn.length`, so callers don't have to size-check first.
 */
export function applyPswToNetto(
  fn: FunctionItem,
  param: Parameter,
  netto: Uint8Array,
): Uint8Array {
  if (!fn.parameters.includes(param)) {
    throw new Error(
      `applyPswToNetto: param psw=0x${param.psw.toString(16)} is not a member of fsw=0x${fn.fsw.toString(16)}`,
    );
  }
  const needed = fn.address + fn.length;
  const out = new Uint8Array(Math.max(netto.length, needed));
  out.set(netto);
  for (let i = 0; i < fn.length; i++) {
    const m = fn.mask[i] ?? 0;
    const d = param.data[i] ?? 0;
    const off = fn.address + i;
    // PSW data is the LOGICAL value of the field (0..N), not the
    // bit-positioned value. `maskByte` shifts it into the mask's
    // bit window so OR'ing it in produces a correctly-coded netto
    // byte. Mirrors NCSDummy's `Mask.MaskByte`.
    out[off] = ((out[off] ?? 0) & ~m & 0xff) | maskByte(d, m);
  }
  return out;
}
