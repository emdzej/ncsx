import { describe, expect, it } from 'vitest';
import type { Block, DatenFile, OrderedRow } from '@emdzej/ncsx-daten';
import { parseZst, type SgfamRow, type AtRecord } from '@emdzej/ncsx-text-tables';
import {
  findSgsByFlag,
  indexAt,
  indexSgfam,
  indexZcsut,
  indexZst,
} from './indexes.js';

describe('indexSgfam', () => {
  it('keys rows by SG short-name', () => {
    const rows: SgfamRow[] = [
      { sgName: 'EWS', cabd: 'A_EWS3', sgbd: 'C_EWS3', zcs: 1, fa: 0, comment: '' },
      { sgName: 'KMB', cabd: 'A_KMB46', sgbd: 'C_KMB46', zcs: 1, fa: 0, comment: '' },
    ];
    const map = indexSgfam(rows);
    expect(map.get('EWS')!.cabd).toBe('A_EWS3');
    expect(map.get('KMB')!.sgbd).toBe('C_KMB46');
    expect(map.size).toBe(2);
  });
});

describe('indexZst', () => {
  it('groups records by SA code and by FSW', () => {
    const file = parseZst(
      `;0205                 0000000000000008 0000000000 AUTOMATIK\n` +
      `;0502                 0000000000000020 0000000000 SWA\n` +
      `;0205                 0000000000000008 0000000001 AUTOMATIK\n`,
    );
    const idx = indexZst(file);
    expect(idx.bySaCode.get('0205')!).toHaveLength(2);
    expect(idx.byFsw.get('AUTOMATIK')!).toHaveLength(2);
    expect(idx.byFsw.get('SWA')!).toHaveLength(1);
  });
});

describe('indexAt', () => {
  it('keys AT records by FA code', () => {
    const records: AtRecord[] = [
      { category: 'W', code: '502', fsws: ['SWA'], comment: '' },
      { category: 'W', code: '524', fsws: ['ALC', 'XENON'], comment: '' },
    ];
    const map = indexAt(records);
    expect(map.get('502')!.fsws).toEqual(['SWA']);
    expect(map.get('524')!.fsws).toEqual(['ALC', 'XENON']);
  });
});

describe('findSgsByFlag', () => {
  const sgfam = indexSgfam([
    { sgName: 'AKMB', cabd: 'A_AKMB46', sgbd: 'C_KMB46', zcs: 0, fa: 1, comment: '' },
    { sgName: 'EWS', cabd: 'A_EWS3', sgbd: 'C_EWS3', zcs: 1, fa: 0, comment: '' },
    { sgName: 'KMB', cabd: 'A_KMB46', sgbd: 'C_KMB46', zcs: 1, fa: 0, comment: '' },
  ]);

  it('returns the FA-master SGs (E46: AKMB only)', () => {
    expect(findSgsByFlag(sgfam, 'fa').map((r) => r.sgName)).toEqual(['AKMB']);
  });

  it('returns every ZCS-master (E46 has multiple)', () => {
    expect(findSgsByFlag(sgfam, 'zcs').map((r) => r.sgName).sort()).toEqual(['EWS', 'KMB']);
  });

  it('returns an empty array when no SG carries the flag', () => {
    const empty = indexSgfam([
      { sgName: 'X', cabd: 'A_X', sgbd: 'C_X', zcs: 0, fa: 0, comment: '' },
    ]);
    expect(findSgsByFlag(empty, 'fa')).toEqual([]);
  });
});

// --- indexZcsut -------------------------------------------------------------
//
// The DatenFile shape that parseDatenFile produces — we mock the bits we
// touch (block + values) rather than constructing a real binary file.
// Helpers keep the per-test setup readable.
function block(id: number, name: string, fieldNames: string[]): Block {
  return {
    id,
    name,
    fields: fieldNames.map((n) => ({
      name: n,
      type: 0,
      kind: 'scalar' as const,
      raw: new Uint8Array(),
    })),
    rows: [],
  };
}

function row(b: Block, values: Record<string, unknown>): OrderedRow {
  return { block: b, values: values as never };
}

function bytes(...hex: string[]): { bytes: Uint8Array } {
  const u8 = new Uint8Array(hex.map((h) => parseInt(h, 16)));
  return { bytes: u8 };
}

function fileOf(rows: OrderedRow[]): DatenFile {
  // `blocks` collects the unique block objects from `rows` — we don't need
  // their `rows` arrays populated because indexZcsut only walks rowsInOrder.
  const blocksSet = new Set<Block>();
  for (const r of rows) blocksSet.add(r.block);
  return { signatures: [], blocks: [...blocksSet], rowsInOrder: rows };
}

describe('indexZcsut', () => {
  it('groups MASKE/UMRECHNUNG rows by the most recent SG', () => {
    const sgBlock = block(2, 'SG', ['SGNAME']);
    const noCdnr = block(3, 'NO_CODIERINDEX', ['CDNR']);
    const maske = block(11, 'MASKE', ['GM', 'SA', 'VN']);
    const umr = block(12, 'UMRECHNUNG', [
      'GMALT', 'SAALT', 'VNALT', 'GMNEU', 'SANEU', 'VNNEU',
    ]);

    const file = fileOf([
      row(sgBlock, { SGNAME: 'KMB' }),
      row(noCdnr, { CDNR: '**' }),
      row(maske, {
        GM: '????????',
        SA: bytes('00', '00', '00', '00', '00', '00', '00', '00'),
        VN: bytes('00', '00', '00', '00', '00'),
      }),
      row(sgBlock, { SGNAME: 'EWS' }),
      row(noCdnr, { CDNR: '**' }),
      row(maske, {
        GM: '6638????',
        SA: bytes('00', '00', '00', '00', '00', '00', '00', '00'),
        VN: bytes('00', '04', '40', '00', '00'),
      }),
      row(umr, {
        GMALT: '6638????',
        SAALT: bytes('00', '00', '00', '00', '00', '00', '00', '00'),
        VNALT: bytes('00', '00', '00', '00', '00'),
        GMNEU: '6638????',
        SANEU: bytes('00', '00', '00', '00', '00', '00', '00', '00'),
        VNNEU: bytes('00', '04', '40', '00', '00'),
      }),
    ]);

    const idx = indexZcsut(file);

    expect(idx.bySg.size).toBe(2);
    const kmb = idx.bySg.get('KMB')!;
    expect(kmb.groups).toHaveLength(1);
    expect(kmb.groups[0].codingIndices).toBeNull();
    expect(kmb.groups[0].masks).toEqual([
      { gm: '????????', saHex: '0000000000000000', vnHex: '0000000000' },
    ]);
    expect(kmb.groups[0].conversions).toEqual([]);

    const ews = idx.bySg.get('EWS')!;
    expect(ews.groups).toHaveLength(1);
    expect(ews.groups[0].masks).toEqual([
      { gm: '6638????', saHex: '0000000000000000', vnHex: '0004400000' },
    ]);
    expect(ews.groups[0].conversions).toHaveLength(1);
    expect(ews.groups[0].conversions[0]).toMatchObject({
      gmOld: '6638????',
      vnOldHex: '0000000000',
      vnNewHex: '0004400000',
    });
  });

  it('opens a new group on each ID_CODIERINDEX within the same SG', () => {
    // Models the E46 ABG block — multiple coding-index groups, each with its
    // own MASKE patterns. Group switching must be by ID_CODIERINDEX, not by
    // SG (which doesn't change here).
    const sgBlock = block(2, 'SG', ['SGNAME']);
    const idCdnr = block(7, 'ID_CODIERINDEX', ['CDNR']);
    const maske = block(11, 'MASKE', ['GM', 'SA', 'VN']);

    const file = fileOf([
      row(sgBlock, { SGNAME: 'ABG' }),
      row(idCdnr, { CDNR: [7] }),
      row(maske, {
        GM: '6638????',
        SA: bytes('00', '00', '00', '00', '00', '00', '00', '00'),
        VN: bytes('00', '04', '40', '00', '00'),
      }),
      row(maske, {
        GM: '6657????',
        SA: bytes('00', '00', '00', '00', '00', '00', '00', '00'),
        VN: bytes('00', '04', '40', '00', '00'),
      }),
      row(idCdnr, { CDNR: [48, 49, 50] }),
      row(maske, {
        GM: '????????',
        SA: bytes('00', '00', '00', '00', '00', '00', '00', '00'),
        VN: bytes('00', '00', '00', '00', '00'),
      }),
    ]);

    const abg = indexZcsut(file).bySg.get('ABG')!;
    expect(abg.groups).toHaveLength(2);
    expect(abg.groups[0].codingIndices).toEqual([7]);
    expect(abg.groups[0].masks).toHaveLength(2);
    expect(abg.groups[1].codingIndices).toEqual([48, 49, 50]);
    expect(abg.groups[1].masks).toHaveLength(1);
  });

  it('ignores MASKE rows that arrive before any SG context', () => {
    // Defensive: a malformed file might emit a stray data row before any SG
    // marker — drop it rather than crashing or attaching to a phantom ECU.
    const maske = block(11, 'MASKE', ['GM', 'SA', 'VN']);
    const file = fileOf([
      row(maske, {
        GM: '????????',
        SA: bytes('00', '00', '00', '00', '00', '00', '00', '00'),
        VN: bytes('00', '00', '00', '00', '00'),
      }),
    ]);
    const idx = indexZcsut(file);
    expect(idx.bySg.size).toBe(0);
  });

  it('coerces a missing CDNR collection to an empty coding-index list', () => {
    // ID_CODIERINDEX rows where the CDNR field somehow isn't an array
    // shouldn't crash — emit a group with `codingIndices: []` so the caller
    // can warn / skip.
    const sgBlock = block(2, 'SG', ['SGNAME']);
    const idCdnr = block(7, 'ID_CODIERINDEX', ['CDNR']);

    const file = fileOf([
      row(sgBlock, { SGNAME: 'X' }),
      row(idCdnr, { CDNR: undefined }),
    ]);

    const idx = indexZcsut(file);
    const x = idx.bySg.get('X')!;
    expect(x.groups).toHaveLength(1);
    expect(x.groups[0].codingIndices).toEqual([]);
  });
});
