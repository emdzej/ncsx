import { describe, expect, it } from 'vitest';
import {
  formatFahrgestellNr,
  formatGm,
  formatSa,
  formatVn,
  mod36Checksum,
  stripGmCheck,
  stripSaCheck,
  stripVnCheck,
} from './m36-checksum.js';

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

describe('formatGm / formatSa / formatVn', () => {
  // Reference data taken from real E46 ZCS reads (cabi-provider logs).
  // The prefixes "C1"/"C2"/"C3" match the strncmp tests in
  // NCSEXPER's FUN_00409f60 — those strip the same prefixes off
  // incoming display strings, confirming the per-key channel tag.

  it('GM: body "FFFFFFFF" + prefix "C1" → check P (=25)', () => {
    expect(formatGm('FFFFFFFF')).toBe('FFFFFFFFP');
  });

  it('GM: body "61630000" + prefix "C1" → check 5', () => {
    expect(formatGm('61630000')).toBe('616300005');
  });

  it('SA: body "0000284803AC1400" + prefix "C2" → check G (=16)', () => {
    expect(formatSa('0000284803AC1400')).toBe('0000284803AC1400G');
  });

  it('VN: body "0000640620" + prefix "C3" → check 1', () => {
    expect(formatVn('0000640620')).toBe('00006406201');
  });

  it('uppercases lowercase input before computing', () => {
    expect(formatSa('0000284803ac1400')).toBe('0000284803AC1400G');
  });

  it('rejects wrong-length bodies', () => {
    expect(() => formatGm('TOOSHORT')).not.toThrow(); // 8 chars exactly
    expect(() => formatGm('FFFFFFF')).toThrow(/must be 8 chars/);
    expect(() => formatSa('FFFFFFFFFFFFFFFFEXTRA')).toThrow(/must be 16 chars/);
    expect(() => formatVn('123')).toThrow(/must be 10 chars/);
  });
});

describe('stripGmCheck / stripSaCheck / stripVnCheck', () => {
  it('GM: drops the 9th char (the check)', () => {
    expect(stripGmCheck('616300005')).toBe('61630000');
  });

  it('SA: drops the 17th char', () => {
    expect(stripSaCheck('0000284803AC1400G')).toBe('0000284803AC1400');
  });

  it('VN: 11 chars → drops check', () => {
    expect(stripVnCheck('00006406201')).toBe('0000640620');
  });

  it('VN: 10 chars (some IPO reads return body-only) passes through', () => {
    expect(stripVnCheck('0000640620')).toBe('0000640620');
  });

  it('round-trips: stripGmCheck(formatGm(x)) === x', () => {
    expect(stripGmCheck(formatGm('61630000'))).toBe('61630000');
  });

  it('rejects wrong-length input', () => {
    expect(() => stripGmCheck('shortone')).toThrow(/expected 9 chars/);
    expect(() => stripSaCheck('toolong')).toThrow(/expected 17 chars/);
    expect(() => stripVnCheck('123')).toThrow(/expected 10 or 11 chars/);
  });
});
