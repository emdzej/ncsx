import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from './hex.js';

describe('bytesToHex', () => {
  it('formats uppercase, no separators', () => {
    expect(bytesToHex(Uint8Array.from([0x12, 0x34, 0xab]))).toBe('1234AB');
  });
  it('handles empty', () => {
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });
  it('pads single nibbles', () => {
    expect(bytesToHex(Uint8Array.from([0x00, 0x0f, 0xa0]))).toBe('000FA0');
  });
});

describe('hexToBytes', () => {
  it('parses a clean uppercase string', () => {
    expect(Array.from(hexToBytes('1234AB'))).toEqual([0x12, 0x34, 0xab]);
  });
  it('parses mixed case', () => {
    expect(Array.from(hexToBytes('aBcDeF'))).toEqual([0xab, 0xcd, 0xef]);
  });
  it('strips 0x prefix', () => {
    expect(Array.from(hexToBytes('0xCAFE'))).toEqual([0xca, 0xfe]);
  });
  it('strips whitespace and commas', () => {
    expect(Array.from(hexToBytes('CA FE, BE EF'))).toEqual([0xca, 0xfe, 0xbe, 0xef]);
  });
  it('throws on odd length', () => {
    expect(() => hexToBytes('ABC')).toThrow(/odd length/);
  });
  it('throws on non-hex character', () => {
    expect(() => hexToBytes('AB1G')).toThrow(/bad hex byte/);
  });
  it('round-trips with bytesToHex', () => {
    const original = Uint8Array.from([0, 1, 2, 0xff, 0x80, 0x42]);
    expect(Array.from(hexToBytes(bytesToHex(original)))).toEqual(Array.from(original));
  });
});
