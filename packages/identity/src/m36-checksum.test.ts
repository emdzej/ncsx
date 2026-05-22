import { describe, expect, it } from 'vitest';
import { mod36Checksum, formatFahrgestellNr } from './m36-checksum.js';

describe('BMW Mod-36 checksum', () => {
  it('encodes the worked NCSEXPER example "FPWBAAA00000PM10277" → L', () => {
    // Hand-traced from FUN_0043e9d0 (CalcMod36CheckSum):
    //   F=15×3, P=25,   W=32×3, B=11,    A=10×3, A=10,     A=10×3, 0=0,
    //   0=0×3,  0=0,    0=0×3,  0=0,     P=25×3, M=22,     1=1×3,  0=0,
    //   2=2×3,  7=7,    7=7×3
    // Sum = 45+25+96+11+30+10+30+0+0+0+0+0+75+22+3+0+6+7+21 = 381
    // 381 mod 36 = 21 → 'L' (10='A', 11='B', ..., 21='L')
    expect(mod36Checksum('FPWBAAA00000PM10277')).toBe('L');
  });

  it('handles all-digit input (even/odd weighting + simple sum)', () => {
    // "9" alone: i=0 even → 9*3 = 27 → 27 → 'R' (10+17 = 27)
    expect(mod36Checksum('9')).toBe('R');
    // "00": both zeros, sum = 0 → '0'
    expect(mod36Checksum('00')).toBe('0');
  });

  it('is case-insensitive on input letters', () => {
    expect(mod36Checksum('abc')).toBe(mod36Checksum('ABC'));
  });

  it('rejects non-alphanumeric input', () => {
    expect(() => mod36Checksum('FP-FOO')).toThrow(/invalid character/);
  });
});

describe('formatFahrgestellNr', () => {
  it('appends the M36 check char to a real VIN', () => {
    expect(formatFahrgestellNr('WBAAA00000PM10277')).toBe('WBAAA00000PM10277L');
  });

  it('uppercases lowercase input before computing', () => {
    expect(formatFahrgestellNr('wbaaa00000pm10277')).toBe('WBAAA00000PM10277L');
  });

  it('rejects wrong-length VIN', () => {
    expect(() => formatFahrgestellNr('TOOSHORT')).toThrow(/must be 17 chars/);
    expect(() => formatFahrgestellNr('WBAAA00000PM102771X')).toThrow(/must be 17 chars/);
  });
});
