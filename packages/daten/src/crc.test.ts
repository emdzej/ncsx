import { describe, it, expect } from 'vitest';
import { xorFoldCrc } from './crc.js';

describe('xorFoldCrc', () => {
  it('matches the canonical signature frame CRC', () => {
    // Bytes 0..9 of the canonical 12-byte signature-1 frame.
    // The 11th byte (0x65) is the expected CRC.
    const buf = Uint8Array.from([
      0x07, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63,
    ]);
    expect(xorFoldCrc(buf)).toBe(0x65);
  });

  it('respects offset + length', () => {
    const buf = Uint8Array.from([0xff, 0xff, 0x12, 0x34, 0x56, 0xff]);
    // XOR of [0x12, 0x34, 0x56] = 0x70
    expect(xorFoldCrc(buf, 2, 3)).toBe(0x70);
  });

  it('returns 0 for an empty range', () => {
    expect(xorFoldCrc(Uint8Array.from([0x01, 0x02]), 0, 0)).toBe(0);
  });
});
