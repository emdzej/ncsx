import { describe, expect, it } from 'vitest';
import { encodeSaCode, formatSaCode } from './sa-code.js';

describe('encodeSaCode', () => {
  it('encodes 4-digit hex codes', () => {
    expect(encodeSaCode('0902')).toBe(0x0902);
    expect(encodeSaCode('0524')).toBe(0x0524);
    expect(encodeSaCode('FFFF')).toBe(0xffff);
  });

  it('zero-pads 3-char codes', () => {
    expect(encodeSaCode('902')).toBe(0x0902);
    expect(encodeSaCode('4AC')).toBe(0x04ac);
  });

  it('zero-pads shorter codes', () => {
    expect(encodeSaCode('A')).toBe(0x000a);
    expect(encodeSaCode('12')).toBe(0x0012);
  });

  it('accepts lowercase hex digits', () => {
    expect(encodeSaCode('0aBc')).toBe(0x0abc);
  });

  it('rejects non-hex characters', () => {
    expect(encodeSaCode('6UD')).toBeUndefined();   // 'U' isn't hex
    expect(encodeSaCode('EWS4')).toBeUndefined();  // 'W'/'S' aren't hex
  });

  it('rejects empty/oversized tokens', () => {
    expect(encodeSaCode('')).toBeUndefined();
    expect(encodeSaCode('12345')).toBeUndefined();
  });
});

describe('formatSaCode', () => {
  it('uppercase 4-char zero-padded hex', () => {
    expect(formatSaCode(0x0902)).toBe('0902');
    expect(formatSaCode(0x04ac)).toBe('04AC');
    expect(formatSaCode(0xffff)).toBe('FFFF');
    expect(formatSaCode(0x0001)).toBe('0001');
  });

  it('masks values to 16 bits', () => {
    expect(formatSaCode(0x12345)).toBe('2345');
  });
});
