/**
 * Format a `Uint8Array` as a hex string suitable for the `params` argument of
 * `apiJob(sgbd, job, params, results)`. Uppercase, no separators — matching the
 * convention NCS Expert and INPA use.
 *
 * Examples:
 *  - `bytes [0x12, 0x34, 0xAB]` → `"1234AB"`
 *  - empty → `""`
 */
export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i]! & 0xff).toString(16).toUpperCase().padStart(2, '0');
  }
  return s;
}

/**
 * Parse a hex string back into bytes. Tolerates an optional `0x` prefix and embedded
 * whitespace / commas (EDIABAS occasionally returns formatted output). Throws on
 * malformed input.
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.replace(/^0x/i, '').replace(/[\s,]/g, '');
  if (cleaned.length % 2 !== 0) {
    throw new Error(`hex string has odd length: ${cleaned.length}`);
  }
  if (!/^[0-9A-Fa-f]*$/.test(cleaned)) {
    const match = cleaned.match(/[^0-9A-Fa-f]/);
    throw new Error(`bad hex byte: '${match?.[0] ?? '?'}' in ${cleaned}`);
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
