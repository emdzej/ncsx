/**
 * XOR-fold CRC over the byte range `[offset, offset + length)`.
 *
 * For a DATEN frame, the CRC is computed over `[size, type_lo, type_hi, payload[0..size-1]]`.
 * Verified against the canonical 12-byte signature frame:
 *
 *     XOR([0x07, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]) === 0x65
 *
 * See `docs/daten-format.md` §1.1.
 */
export function xorFoldCrc(buffer: Uint8Array, offset = 0, length = buffer.length - offset): number {
  let crc = 0;
  const end = offset + length;
  for (let i = offset; i < end; i++) {
    crc ^= buffer[i]!;
  }
  return crc;
}
