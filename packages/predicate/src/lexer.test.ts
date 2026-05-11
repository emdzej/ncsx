import { describe, expect, it } from 'vitest';
import { lexAuftragsausdruck } from './lexer.js';
import { PredicateError } from './types.js';

describe('lexAuftragsausdruck', () => {
  it('resolves S<id> tokens against the ASW set', () => {
    // S 0x0386, S 0x0387, S 0x0389
    const bytes = Uint8Array.from([0x53, 0x86, 0x03, 0x53, 0x87, 0x03, 0x53, 0x89, 0x03]);
    const asw = new Set([0x0386, 0x0389]);
    expect(lexAuftragsausdruck(bytes, asw)).toBe('101');
  });

  it('passes through operators', () => {
    // ( S0386 + S0387 ) , S0389
    const bytes = Uint8Array.from([
      0x28, 0x53, 0x86, 0x03, 0x2b, 0x53, 0x87, 0x03, 0x29, 0x2c, 0x53, 0x89, 0x03,
    ]);
    const asw = new Set([0x0386, 0x0387]);
    expect(lexAuftragsausdruck(bytes, asw)).toBe('(1+1),0');
  });

  it('treats backslash as whitespace (continuation)', () => {
    const bytes = Uint8Array.from([0x53, 0x86, 0x03, 0x5c, 0x2c, 0x53, 0x87, 0x03]);
    expect(lexAuftragsausdruck(bytes, new Set([0x0387]))).toBe('0,1');
  });

  it('calls onUnknownBit when a referenced ID is missing', () => {
    const bytes = Uint8Array.from([0x53, 0xaa, 0xbb]);
    const unknown: number[] = [];
    lexAuftragsausdruck(bytes, new Set(), { onUnknownBit: (id) => unknown.push(id) });
    expect(unknown).toEqual([0xbbaa]);
  });

  it('throws on truncated S<id>', () => {
    expect(() => lexAuftragsausdruck(Uint8Array.from([0x53, 0x86]), new Set())).toThrow(PredicateError);
  });

  it('throws on unknown token byte', () => {
    expect(() => lexAuftragsausdruck(Uint8Array.from([0x77]), new Set())).toThrow(PredicateError);
  });
});
