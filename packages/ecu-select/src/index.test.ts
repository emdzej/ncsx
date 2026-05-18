import { describe, expect, it } from 'vitest';
import type { Block, DatenFile, RawBytes } from '@emdzej/ncsx-daten';
import type { Chassis } from '@emdzej/ncsx-chassis';
import { selectEcus } from './index.js';

const rawBytes = (...bytes: number[]): RawBytes => ({ bytes: Uint8Array.from(bytes) });

const SBlock = (
  name: string,
  rows: Array<{
    SGNAME: string;
    CBD?: string;
    CABD?: string;
    SGBD?: string;
    UMRSG?: string;
    VMG?: string;
    AUFTRAGSAUSDRUCK?: RawBytes;
    INDEX?: number | null;
  }>,
  id = 0x1000,
): Block => ({
  id,
  name,
  fields: [],
  rows: rows.map((r) => ({
    SGNAME: r.SGNAME,
    CBD: r.CBD ?? '',
    CABD: r.CABD ?? '',
    SGBD: r.SGBD ?? '',
    UMRSG: r.UMRSG ?? '',
    VMG: r.VMG ?? '',
    AUFTRAGSAUSDRUCK: r.AUFTRAGSAUSDRUCK ?? rawBytes(),
    INDEX: r.INDEX ?? null,
  })),
});

const empty = (): DatenFile => ({ signatures: [], blocks: [], rowsInOrder: [] });

const baseChassis = (sget: DatenFile): Chassis => ({
  code: 'E46',
  requestedCode: 'E46',
  dir: 'e46',
  brRef: empty(),
  dst: empty(),
  sget,
  sgvt: empty(),
  zcsut: empty(),
  cvt: empty(),
  sgfam: new Map(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cabd: {} as any,
});

describe('selectEcus — basic walk', () => {
  it('returns rows whose AUFTRAGSAUSDRUCK matches the ASW', () => {
    // Predicate: S 0x0902  (single bit)
    const predicate = rawBytes(0x53, 0x02, 0x09);
    const chassis = baseChassis({
      signatures: [],
      blocks: [
        SBlock(
          'SGAUSWAHL_SGBD',
          [
            { SGNAME: 'A', CBD: 'C01', CABD: 'A_A', SGBD: 'C_A', UMRSG: 'X', AUFTRAGSAUSDRUCK: predicate },
            { SGNAME: 'B', CBD: 'C02', CABD: 'A_B', SGBD: 'C_B', UMRSG: 'X', AUFTRAGSAUSDRUCK: rawBytes(0x53, 0xff, 0xff) },
          ],
          0x0003,
        ),
      ],
    });
    const asw = new Set([0x0902]);
    const out = selectEcus(chassis, asw);
    expect(out.map((s) => s.sgName)).toEqual(['A']);
    expect(out[0]).toMatchObject({ source: 'SGBD', cabd: 'A_A', sgbd: 'C_A' });
  });

  it('treats empty AUFTRAGSAUSDRUCK as matching every FA', () => {
    const chassis = baseChassis({
      signatures: [],
      blocks: [SBlock('SGAUSWAHL_SGBD', [{ SGNAME: 'EVERYWHERE' }], 0x0003)],
    });
    expect(selectEcus(chassis, new Set()).map((s) => s.sgName)).toEqual(['EVERYWHERE']);
  });

  it('emits no rows when SGET has no SGAUSWAHL_* blocks', () => {
    expect(selectEcus(baseChassis(empty()), new Set())).toEqual([]);
  });
});

describe('selectEcus — walk order + dedupe', () => {
  // Same SG name in all three blocks; most-specific should win.
  const predicate = rawBytes(); // empty = always matches

  const chassis = baseChassis({
    signatures: [],
    blocks: [
      SBlock('SGAUSWAHL_VMSGBD', [{ SGNAME: 'X', CBD: 'V1', CABD: 'C1', SGBD: 'S1', UMRSG: 'U', VMG: 'M', AUFTRAGSAUSDRUCK: predicate }]),
      SBlock('SGAUSWAHL_SGBD', [{ SGNAME: 'X', CBD: 'V2', CABD: 'C2', SGBD: 'S2', UMRSG: 'U', AUFTRAGSAUSDRUCK: predicate }]),
      SBlock('SGAUSWAHL_VM', [{ SGNAME: 'X', CBD: 'V3', UMRSG: 'U', VMG: 'M', AUFTRAGSAUSDRUCK: predicate }]),
    ],
  });

  it('returns VMSGBD when all three match', () => {
    const out = selectEcus(chassis, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('VMSGBD');
    expect(out[0]!.cbd).toBe('V1');
  });

  it('falls through to SGBD when VMSGBD predicate is unmatched', () => {
    const sget: DatenFile = {
      signatures: [],
      blocks: [
        SBlock('SGAUSWAHL_VMSGBD', [
          { SGNAME: 'X', CBD: 'V1', AUFTRAGSAUSDRUCK: rawBytes(0x53, 0xff, 0xff) }, // predicate: S 0xFFFF (unmatched)
        ]),
        SBlock('SGAUSWAHL_SGBD', [{ SGNAME: 'X', CBD: 'V2', CABD: 'C2', SGBD: 'S2', UMRSG: 'U', AUFTRAGSAUSDRUCK: predicate }]),
      ],
    };
    const out = selectEcus(baseChassis(sget), new Set());
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('SGBD');
    expect(out[0]!.cbd).toBe('V2');
  });

  it('disabling dedupe yields all three matches', () => {
    const out = selectEcus(chassis, new Set(), { dedupeBySgName: false });
    expect(out.map((s) => s.source)).toEqual(['VMSGBD', 'SGBD', 'VM']);
  });
});

describe('selectEcus — error handling', () => {
  it('skips rows with predicate evaluation errors and warns', () => {
    const chassis = baseChassis({
      signatures: [],
      blocks: [
        SBlock(
          'SGAUSWAHL_SGBD',
          [
            { SGNAME: 'BAD', AUFTRAGSAUSDRUCK: rawBytes(0x77) }, // 0x77 is not a valid predicate byte
            { SGNAME: 'GOOD', AUFTRAGSAUSDRUCK: rawBytes() },
          ],
          0x0003,
        ),
      ],
    });
    const warns: string[] = [];
    const out = selectEcus(chassis, new Set(), { onWarning: (m) => warns.push(m) });
    expect(out.map((s) => s.sgName)).toEqual(['GOOD']);
    expect(warns.some((w) => /BAD.*evaluation failed/.test(w))).toBe(true);
  });

  it('skips rows with predicates over the length limit', () => {
    const long = rawBytes(...new Array(200).fill(0x53));
    const chassis = baseChassis({
      signatures: [],
      blocks: [SBlock('SGAUSWAHL_SGBD', [{ SGNAME: 'TOOLONG', AUFTRAGSAUSDRUCK: long }], 0x0003)],
    });
    const warns: string[] = [];
    const out = selectEcus(chassis, new Set(), { onWarning: (m) => warns.push(m), maxPredicateLength: 100 });
    expect(out).toEqual([]);
    expect(warns.some((w) => /exceeds limit/.test(w))).toBe(true);
  });
});
