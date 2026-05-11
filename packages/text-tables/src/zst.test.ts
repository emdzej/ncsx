import { describe, expect, it } from 'vitest';
import { parseZst } from './zst.js';

describe('parseZst', () => {
  it('parses the canonical header block', () => {
    const text = `;Tabelle: E46ZST.000                Index: co vom: 18.02.2002  NAEL: E3424.R
I co
U 20020218093000
V E46ZST.000
;
`;
    const { header } = parseZst(text);
    expect(header.tabelle).toBe('E46ZST.000');
    expect(header.index).toBe('co');
    expect(header.vom).toBe('18.02.2002');
    expect(header.nael).toBe('E3424.R');
    expect(header.timestamp).toBe('20020218093000');
    expect(header.filename).toBe('E46ZST.000');
  });

  it('extracts SA-bit data rows with 64-bit + 40-bit masks and an FSW', () => {
    const text = `;0897        00000020 0000000000000000 0000000000 DAUERTON
;0399                 0000000000000001 0000000000 VERDECK_EL_AUT
;0205                 0000000000000008 0000000000 AUTOMATIK
;0502                 0000000000000020 0000000000 SWA      //wird um Regensensor reduziert ab 3/98
`;
    const { records } = parseZst(text);
    expect(records).toHaveLength(4);
    const r = records[0]!;
    expect(r.kind).toBe('regular');
    expect(r.saCode).toBe('0897');
    // 16-hex-char SA mask
    expect(r.saMask).toBe('0000000000000000');
    // 10-hex-char FA mask
    expect(r.faMask).toBe('0000000000');
    expect(r.fsw).toBe('DAUERTON');
    expect(records[3]!.fsw).toBe('SWA');
    expect(records[3]!.comment).toBe('wird um Regensensor reduziert ab 3/98');
  });

  it('captures the optional marker column when present (N0301, V0301, BFD)', () => {
    const text = `;0662 V0301           0000000002000000 0000000000 RADIO_CD43
;0662 N0301           0000000002000000 0008040660 RADIO_CD43_ALT
;H BFD  N0301         0000000000000000 0008640622 BRAKEFORCE
`;
    const { records } = parseZst(text);
    expect(records[0]!.marker).toBe('V0301');
    expect(records[1]!.marker).toBe('N0301');
    expect(records[1]!.faMask).toBe('0008040660');
    expect(records[2]!.kind).toBe('hidden');
    expect(records[2]!.saCode).toBe('BFD');
    expect(records[2]!.marker).toBe('N0301');
    expect(records[2]!.fsw).toBe('BRAKEFORCE');
  });

  it('skips section-divider decoration', () => {
    const text = `;*****************
;0205                 0000000000000008 0000000000 AUTOMATIK
;*****************
`;
    const { records } = parseZst(text);
    expect(records).toHaveLength(1);
  });
});
