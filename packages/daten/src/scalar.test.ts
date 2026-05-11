import { describe, it, expect } from 'vitest';
import { readScalar } from './scalar.js';
import { RawBytes } from './types.js';

describe('readScalar', () => {
  it('reads B (u8)', () => {
    expect(readScalar('B', Uint8Array.from([0xab]), 0)).toEqual({ value: 0xab, length: 1 });
  });

  it('reads W (u16 LE)', () => {
    expect(readScalar('W', Uint8Array.from([0x34, 0x12]), 0)).toEqual({ value: 0x1234, length: 2 });
  });

  it('reads L (u32 LE)', () => {
    expect(
      readScalar('L', Uint8Array.from([0x78, 0x56, 0x34, 0x12]), 0),
    ).toEqual({ value: 0x12345678, length: 4 });
  });

  it('reads L as unsigned even at the high bit', () => {
    expect(
      readScalar('L', Uint8Array.from([0xff, 0xff, 0xff, 0xff]), 0),
    ).toEqual({ value: 0xffffffff, length: 4 });
  });

  it('reads S as NUL-terminated ASCII (includes terminator in length)', () => {
    const buf = Uint8Array.from([
      'h'.charCodeAt(0), 'i'.charCodeAt(0), 0x00, 0xff,
    ]);
    expect(readScalar('S', buf, 0)).toEqual({ value: 'hi', length: 3 });
  });

  // Bug 1 fix — A is length-prefixed (u8 length + bytes), not 1 byte.
  describe('A (length-prefixed bytes)', () => {
    it('reads empty A (length 0)', () => {
      const { value, length } = readScalar('A', Uint8Array.from([0x00]), 0);
      expect(length).toBe(1);
      expect((value as RawBytes).bytes.length).toBe(0);
    });

    it('reads short A and consumes length+1 bytes total', () => {
      // length=5, then [0x21, 0x28, 0x53, 0x1e, 0x00]
      const buf = Uint8Array.from([0x05, 0x21, 0x28, 0x53, 0x1e, 0x00, 0xff]);
      const { value, length } = readScalar('A', buf, 0);
      expect(length).toBe(6);
      const r = value as RawBytes;
      expect(Array.from(r.bytes)).toEqual([0x21, 0x28, 0x53, 0x1e, 0x00]);
    });

    it('handles A at non-zero offset', () => {
      const buf = Uint8Array.from([0xff, 0xff, 0x02, 0xaa, 0xbb, 0xff]);
      const { value, length } = readScalar('A', buf, 2);
      expect(length).toBe(3);
      expect(Array.from((value as RawBytes).bytes)).toEqual([0xaa, 0xbb]);
    });
  });
});
