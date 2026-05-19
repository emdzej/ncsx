import { describe, expect, it } from 'vitest';
import { parseZst, type SgfamRow, type AtRecord } from '@emdzej/ncsx-text-tables';
import { findSgsByFlag, indexAt, indexSgfam, indexZst } from './indexes.js';

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
