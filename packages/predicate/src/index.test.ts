import { describe, expect, it } from 'vitest';
import { evalAuftragsausdruck, extractReferencedIds } from './index.js';

describe('evalAuftragsausdruck — end-to-end', () => {
  // (S0386 + S0387) , S0389
  const bytes = Uint8Array.from([
    0x28, 0x53, 0x86, 0x03, 0x2b, 0x53, 0x87, 0x03, 0x29, 0x2c, 0x53, 0x89, 0x03,
  ]);

  it('returns true when either branch is satisfied', () => {
    expect(evalAuftragsausdruck(bytes, new Set([0x0386, 0x0387]))).toBe(true);
    expect(evalAuftragsausdruck(bytes, new Set([0x0389]))).toBe(true);
    expect(evalAuftragsausdruck(bytes, new Set([0x0386, 0x0389]))).toBe(true);
  });

  it('returns false when neither branch is satisfied', () => {
    expect(evalAuftragsausdruck(bytes, new Set([0x0386]))).toBe(false);
    expect(evalAuftragsausdruck(bytes, new Set())).toBe(false);
  });

  it('returns true for an empty predicate', () => {
    expect(evalAuftragsausdruck(new Uint8Array(), new Set())).toBe(true);
  });

  it('accepts any object with a .has(id) method as ASW', () => {
    const asw = { has: (id: number) => id === 0x0389 };
    expect(evalAuftragsausdruck(bytes, asw)).toBe(true);
  });
});

describe('extractReferencedIds', () => {
  it('lists every S<id> token in order', () => {
    const bytes = Uint8Array.from([
      0x28, 0x53, 0x86, 0x03, 0x2b, 0x53, 0x87, 0x03, 0x29, 0x2c, 0x53, 0x89, 0x03,
    ]);
    expect(extractReferencedIds(bytes)).toEqual([0x0386, 0x0387, 0x0389]);
  });

  it('returns an empty list for a token-less predicate', () => {
    expect(extractReferencedIds(Uint8Array.from([0x28, 0x29]))).toEqual([]);
  });
});
