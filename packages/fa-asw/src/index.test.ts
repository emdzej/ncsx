import { describe, expect, it } from 'vitest';
import { faToAsw } from './index.js';
import type { Chassis } from '@emdzej/ncsx-chassis';
import type { AtRecord } from '@emdzej/ncsx-text-tables';

const baseChassis = (overrides: Partial<Chassis> = {}): Chassis => ({
  code: 'E46',
  requestedCode: 'E46',
  dir: 'e46',
  brRef: { signatures: [], blocks: [] },
  dst: { signatures: [], blocks: [] },
  sget: { signatures: [], blocks: [] },
  sgvt: { signatures: [], blocks: [] },
  zcsut: { signatures: [], blocks: [] },
  cvt: { signatures: [], blocks: [] },
  sgfam: new Map(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cabd: {} as any,
  ...overrides,
});

describe('faToAsw — basic conversion', () => {
  it('encodes each token as a u16 SA code', () => {
    const asw = faToAsw('0902 0524 0205');
    expect([...asw].sort((a, b) => a - b)).toEqual([0x0205, 0x0524, 0x0902]);
  });

  it("strips '$' / category prefixes", () => {
    const asw = faToAsw('$0902 W0524 Z#0205');
    expect(asw.has(0x0902)).toBe(true);
    expect(asw.has(0x0524)).toBe(true);
    expect(asw.has(0x0205)).toBe(true);
  });

  it('warns on malformed tokens but keeps going', () => {
    const warns: string[] = [];
    const asw = faToAsw('0902 6UD 0524', { onWarning: (w) => warns.push(w.kind) });
    expect(asw.has(0x0902)).toBe(true);
    expect(asw.has(0x0524)).toBe(true);
    expect(warns).toContain('malformed-token');
  });

  it('throws on malformed token in strict mode', () => {
    expect(() => faToAsw('0902 6UD', { strict: true })).toThrow(/6UD/);
  });

  it('returns an empty set for blank FA', () => {
    expect(faToAsw('').size).toBe(0);
  });

  it('de-duplicates repeated tokens', () => {
    const asw = faToAsw('0902 0902 902');
    expect(asw.size).toBe(1);
    expect(asw.has(0x0902)).toBe(true);
  });
});

describe('faToAsw — with chassis', () => {
  it('warns on codes missing from chassis AT', () => {
    const at = new Map<string, AtRecord>([
      ['0902', { category: 'W', code: '0902', fsws: [], comment: '' }],
    ]);
    const chassis = baseChassis({ at });
    const warns: string[] = [];
    faToAsw('0902 9999', { chassis, onWarning: (w) => warns.push(`${w.kind}`) });
    expect(warns).toEqual(['unknown-code']);
  });

  it('auto-includes Zwang entries from AT.M00', () => {
    const chassis = baseChassis({
      atM00: {
        date: '22.01.2007',
        filename: 'E46AT.M00',
        entries: [
          { category: 'Z', code: '#0904' },
          { category: 'Z', code: '#0305' },
          { category: 'W', code: '0100' },   // not Zwang — ignored
        ],
        unparsed: [],
      },
    });
    const asw = faToAsw('0902', { chassis });
    expect(asw.has(0x0902)).toBe(true);
    expect(asw.has(0x0904)).toBe(true);
    expect(asw.has(0x0305)).toBe(true);
    expect(asw.has(0x0100)).toBe(false);
  });

  it("looks up tokens against AT with leading-zero variants", () => {
    const at = new Map<string, AtRecord>([
      ['902', { category: 'W', code: '902', fsws: [], comment: '' }],
    ]);
    const chassis = baseChassis({ at });
    const warns: string[] = [];
    faToAsw('0902', { chassis, onWarning: (w) => warns.push(w.kind) });
    // '0902' isn't in AT but '902' (stripped of leading zeros) is — no warning.
    expect(warns).toEqual([]);
  });
});
