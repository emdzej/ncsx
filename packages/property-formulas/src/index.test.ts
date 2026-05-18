import { describe, expect, it } from 'vitest';
import { FORMULAS, formatValue } from './index.js';
import {
  getFloat,
  getFloat0_128,
  getFloatNeg128,
  getFloatNeg8,
  getString,
  invert,
  printNumber,
  reverse,
} from './helpers.js';

describe('helpers', () => {
  describe('getFloat', () => {
    it('reads 1-byte unsigned', () => {
      expect(getFloat(Uint8Array.from([0x7f]))).toBe(0x7f);
      expect(getFloat(Uint8Array.from([0xff]))).toBe(0xff);
    });
    it('reads 2-byte little-endian unsigned', () => {
      expect(getFloat(Uint8Array.from([0x34, 0x12]))).toBe(0x1234);
    });
    it('returns 0 for other widths (matching NCSDummy)', () => {
      expect(getFloat(Uint8Array.from([0x01, 0x02, 0x03]))).toBe(0);
      expect(getFloat(new Uint8Array(0))).toBe(0);
    });
  });

  describe('signed-byte folds', () => {
    it('getFloat0_128 returns the upper-half offset', () => {
      expect(getFloat0_128(Uint8Array.from([0x7f]))).toBe(0);
      expect(getFloat0_128(Uint8Array.from([0x80]))).toBe(0);
      expect(getFloat0_128(Uint8Array.from([0x81]))).toBe(1);
      expect(getFloat0_128(Uint8Array.from([0xff]))).toBe(0x7f);
    });
    it('getFloatNeg128 produces signed-8 values', () => {
      expect(getFloatNeg128(Uint8Array.from([0x00]))).toBe(0);
      expect(getFloatNeg128(Uint8Array.from([0x7f]))).toBe(127);
      expect(getFloatNeg128(Uint8Array.from([0x80]))).toBe(-128);
      expect(getFloatNeg128(Uint8Array.from([0xff]))).toBe(-1);
    });
    it('getFloatNeg8 produces signed-4 nibble values', () => {
      expect(getFloatNeg8(Uint8Array.from([0x07]))).toBe(7);
      expect(getFloatNeg8(Uint8Array.from([0x08]))).toBe(-8);
      expect(getFloatNeg8(Uint8Array.from([0x0f]))).toBe(-1);
    });
  });

  describe('reverse / invert', () => {
    it('reverses bytes', () => {
      expect(Array.from(reverse(Uint8Array.from([1, 2, 3])))).toEqual([3, 2, 1]);
    });
    it('inverts using a single-byte mask', () => {
      expect(Array.from(invert([0x42], [0xff]))).toEqual([0xff - 0x42]);
    });
    it('inverts using a 2-byte alternating mask', () => {
      // mask=[0x55, 0xaa]; data[0]→mask[0]-data[0], data[1]→mask[1]-data[1], data[2]→mask[0]-data[2], …
      expect(Array.from(invert([0x05, 0x20, 0x15], [0x55, 0xaa]))).toEqual([
        0x55 - 0x05,
        0xaa - 0x20,
        0x55 - 0x15,
      ]);
    });
  });

  describe('printNumber', () => {
    it('renders Infinity as ∞', () => {
      expect(printNumber(Infinity)).toBe('∞');
      expect(printNumber(-Infinity)).toBe('∞');
      expect(printNumber(NaN)).toBe('∞');
    });
    it('uses G4 (4 sig figs) for |n| < 10000', () => {
      expect(printNumber(0)).toBe('0');
      expect(printNumber(1.234567)).toBe('1.235');
      expect(printNumber(123.456)).toBe('123.5');
      expect(printNumber(1234)).toBe('1234');
      expect(printNumber(-50)).toBe('-50');
    });
    it('uses integer format for |n| >= 10000', () => {
      expect(printNumber(12345)).toBe('12345');
      expect(printNumber(99999.7)).toBe('99999');
    });
  });

  describe('getString', () => {
    it('keeps printable ASCII (> 0x1F), drops control chars', () => {
      expect(getString(Uint8Array.from([0x48, 0x69, 0x00, 0x21]))).toBe('Hi!');
      expect(getString(Uint8Array.from([0x00, 0x01, 0x02]))).toBe('');
    });
  });
});

describe('formatValue dispatch', () => {
  const baseCtx = (overrides: Partial<{
    chassis: string; module: string; codingIndex: number; keyword: string;
    mask: Uint8Array; data: Uint8Array;
  }>) => ({
    chassis: 'E60',
    module: 'KMBI_E60',
    codingIndex: 0x06,
    keyword: 'UNKNOWN',
    mask: Uint8Array.from([0xff]),
    data: Uint8Array.from([0x00]),
    ...overrides,
  });

  it('returns null for an unknown keyword', () => {
    expect(formatValue(baseCtx({ keyword: 'NEVER_HEARD_OF_THIS_FSW' }))).toBeNull();
  });

  it('returns null when chassis / module / keyword / mask is empty', () => {
    expect(formatValue(baseCtx({ chassis: '' }))).toBeNull();
    expect(formatValue(baseCtx({ module: '' }))).toBeNull();
    expect(formatValue(baseCtx({ keyword: '' }))).toBeNull();
    expect(formatValue(baseCtx({ mask: new Uint8Array(0) }))).toBeNull();
  });

  it('decodes a known formula end-to-end', () => {
    // LENK_UEBERSETZUNG returns PrintNumber(GetFloat(data) / 5).
    // data=[0x32] → 50 / 5 = 10 → printNumber → "10".
    const out = formatValue(baseCtx({
      keyword: 'LENK_UEBERSETZUNG',
      data: Uint8Array.from([0x32]),
    }));
    expect(out).toBe('10');
  });

  it('returns "?" when the formula sees empty data (NCSDummy convention)', () => {
    const out = formatValue(baseCtx({
      keyword: 'LENK_UEBERSETZUNG',
      data: new Uint8Array(0),
    }));
    expect(out).toBe('?');
  });

  it('exposes a sizeable dispatch table (sanity check on the port)', () => {
    // The port should produce >800 keyword entries from 1055 cases in 149 groups.
    expect(FORMULAS.size).toBeGreaterThan(800);
  });
});
