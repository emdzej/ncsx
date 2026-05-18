/**
 * Helpers used by the formula table. Faithful TypeScript translations of NCSDummy's
 * static members at the tail of `Classes/Formulas/Formulas.cs`. Same names (camelCased),
 * same semantics.
 */

/**
 * Fold a 1- or 2-byte little-endian `Uint8Array` into its unsigned numeric value.
 * **NCSDummy only supports widths 1 and 2** — anything else returns `0` (matching the
 * C# `data.Length switch { 1 => byte, 2 => u16, _ => 0f }`).
 */
export function getFloat(data: Uint8Array | number[]): number {
  if (data.length === 1) return data[0]! & 0xff;
  if (data.length === 2) return (data[0]! & 0xff) | ((data[1]! & 0xff) << 8);
  return 0;
}

/**
 * Single-byte folded into the upper half: `data[0] >= 128 ? data[0] - 128 : 0`.
 * NCSDummy's `GetFloat_0_128` — used for "high-bit-as-presence" encodings.
 */
export function getFloat0_128(data: Uint8Array | number[]): number {
  if (data.length !== 1) return 0;
  const b = data[0]! & 0xff;
  return b >= 128 ? b - 128 : 0;
}

/**
 * Single-byte two's complement (8-bit): `data[0] < 128 ? data[0] : data[0] - 256`.
 * NCSDummy's `GetFloat_Neg128`.
 */
export function getFloatNeg128(data: Uint8Array | number[]): number {
  if (data.length !== 1) return 0;
  const b = data[0]! & 0xff;
  return b < 128 ? b : b - 256;
}

/**
 * Nibble two's complement (4-bit): `data[0] < 8 ? data[0] : data[0] - 16`.
 * NCSDummy's `GetFloat_Neg8`.
 */
export function getFloatNeg8(data: Uint8Array | number[]): number {
  if (data.length !== 1) return 0;
  const b = data[0]! & 0xff;
  return b < 8 ? b : b - 16;
}

/** Reverse a byte array. NCSDummy's `Reverse`. */
export function reverse(data: Uint8Array | number[]): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[data.length - 1 - i]! & 0xff;
  return out;
}

/**
 * Subtract each `data[i]` from its corresponding `mask[i % maskLen]` byte. NCSDummy's
 * `Invert(byte[] data, byte[] mask)` — used to flip "active-high" coding into "active-low".
 * Note: this is arithmetic subtraction, not bitwise NOT.
 */
export function invert(data: Uint8Array | number[], mask: Uint8Array | number[]): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const m = mask.length === 2 ? mask[i % 2 === 0 ? 0 : 1]! : mask[0]!;
    out[i] = (m - data[i]!) & 0xff;
  }
  return out;
}

/**
 * Format a number the way NCSDummy's `PrintNumber(double value)` does:
 *
 *   - `Infinity` → `"∞"`
 *   - `|value| < 10000` → C# `"G4"` (4 significant digits, trailing zeros trimmed)
 *   - otherwise → C# `"#"` (integer, no decimal)
 */
export function printNumber(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (Math.abs(value) < 10000) return formatG4(value);
  return Math.trunc(value).toString();
}

/**
 * C# `G4` format: up to 4 significant digits, trailing zeros stripped, integer dot not
 * emitted. `0` → `"0"`; `0.123456` → `"0.1235"`; `12.345` → `"12.35"`; `1234.5` →
 * `"1234"` (integer with 4 sig digs); negative numbers preserve their sign.
 */
function formatG4(value: number): string {
  if (value === 0) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  // `toPrecision(4)` produces e.g. `"1.235e+3"` or `"0.1235"`. Reject scientific notation
  // for the range we care about (|x| < 10000), and strip trailing zeros.
  let s = abs.toPrecision(4);
  if (s.includes('e')) {
    // Out of normal range — fall back to the integer formatter via toFixed.
    s = abs.toFixed(0);
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return sign + s;
}

/**
 * Build a string by keeping every byte greater than `0x1F` (printable ASCII space+).
 * NCSDummy's `GetString` — does NOT NUL-terminate; it filters control chars instead.
 */
export function getString(data: Uint8Array | number[]): string {
  let s = '';
  for (let i = 0; i < data.length; i++) {
    const b = data[i]! & 0xff;
    if (b > 31) s += String.fromCharCode(b);
  }
  return s;
}

/** Power-of helper kept for parity with NCSDummy's `Math.Pow` references. */
export function pow(base: number, exp: number): number {
  return Math.pow(base, exp);
}
