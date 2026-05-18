import { describe, expect, it } from 'vitest';
import { aswFromIds, faToAsw } from './index.js';
import type { Chassis, SwtTable } from '@emdzej/ncsx-chassis';
import type { AtRecord } from '@emdzej/ncsx-text-tables';

const makeSwt = (entries: ReadonlyArray<readonly [string, number]>): SwtTable => {
  const byKeyword = new Map<string, number>();
  const byKeyId = new Map<number, string>();
  for (const [kw, id] of entries) {
    byKeyword.set(kw, id);
    byKeyId.set(id, kw);
  }
  return { byKeyword, byKeyId, source: 'test' };
};

const baseChassis = (overrides: Partial<Chassis> = {}): Chassis => ({
  code: 'E46',
  requestedCode: 'E46',
  dir: 'e46',
  brRef: { signatures: [], blocks: [], rowsInOrder: [] },
  dst: { signatures: [], blocks: [], rowsInOrder: [] },
  sget: { signatures: [], blocks: [], rowsInOrder: [] },
  sgvt: { signatures: [], blocks: [], rowsInOrder: [] },
  zcsut: { signatures: [], blocks: [], rowsInOrder: [] },
  cvt: { signatures: [], blocks: [], rowsInOrder: [] },
  sgfam: new Map(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cabd: {} as any,
  ...overrides,
});

describe('aswFromIds', () => {
  it('returns a Set of u16-masked ids', () => {
    const asw = aswFromIds([0x0016, 0x0029, 0x12345]);
    expect([...asw].sort((a, b) => a - b)).toEqual([0x0016, 0x0029, 0x2345]);
  });
});

describe('faToAsw — resolves FA tokens through AT → SWTASW', () => {
  it('walks W-record FSWs to ASW KEYIDs', () => {
    const chassis = baseChassis({
      at: new Map<string, AtRecord>([
        ['BL91', { category: 'W', code: 'BL91', fsws: ['E46', 'COUP', 'LL'], comment: '' }],
      ]),
      swtAsw: makeSwt([
        ['E46', 0x0001],
        ['COUP', 0x0016],
        ['LL', 0x0022],
      ]),
    });
    const asw = faToAsw('BL91', { chassis });
    expect([...asw].sort((a, b) => a - b)).toEqual([0x0001, 0x0016, 0x0022]);
  });

  it('warns on unknown FA tokens but continues', () => {
    const chassis = baseChassis({
      at: new Map<string, AtRecord>([
        ['BL91', { category: 'W', code: 'BL91', fsws: ['COUP'], comment: '' }],
      ]),
      swtAsw: makeSwt([['COUP', 0x0016]]),
    });
    const warns: string[] = [];
    const asw = faToAsw('BL91 NOPE', { chassis, onWarning: (w) => warns.push(w.kind) });
    expect(asw.has(0x0016)).toBe(true);
    expect(warns).toContain('unknown-fa-code');
  });

  it("warns on FSWs that aren't in SWTASW", () => {
    const chassis = baseChassis({
      at: new Map<string, AtRecord>([
        ['BL91', { category: 'W', code: 'BL91', fsws: ['MISSING'], comment: '' }],
      ]),
      swtAsw: makeSwt([]),
    });
    const warns: string[] = [];
    faToAsw('BL91', { chassis, onWarning: (w) => warns.push(w.kind) });
    expect(warns).toContain('unknown-fsw');
  });

  it('emits no-swt when chassis lacks SWTASW', () => {
    const chassis = baseChassis();
    const warns: string[] = [];
    const asw = faToAsw('BL91', { chassis, onWarning: (w) => warns.push(w.kind) });
    expect(asw.size).toBe(0);
    expect(warns).toEqual(['no-swt']);
  });

  it('throws in strict mode', () => {
    const chassis = baseChassis();
    expect(() => faToAsw('BL91', { chassis, strict: true })).toThrow(/no-swt/);
  });

  it('looks up leading-zero variants of FA codes', () => {
    const chassis = baseChassis({
      at: new Map<string, AtRecord>([
        ['902', { category: 'W', code: '902', fsws: ['SWA'], comment: '' }],
      ]),
      swtAsw: makeSwt([['SWA', 0x004c]]),
    });
    const asw = faToAsw('0902', { chassis });
    expect(asw.has(0x004c)).toBe(true);
  });
});
