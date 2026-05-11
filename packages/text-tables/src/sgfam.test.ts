import { describe, expect, it } from 'vitest';
import { parseSgfam } from './sgfam.js';

describe('parseSgfam', () => {
  it('parses a minimal SGFAM file', () => {
    const text = `; comment
;-----
S EWS   A_EWS3   C_EWS3   1   0
S KMB   A_KMB46  C_KMB46  1   0
S ALSZ  A_ALSZ   C_LSZA   0   1
`;
    const { rows, unparsed } = parseSgfam(text);
    expect(unparsed).toEqual([]);
    expect(rows).toEqual([
      { sgName: 'EWS', cabd: 'A_EWS3', sgbd: 'C_EWS3', zcs: 1, fa: 0, comment: '' },
      { sgName: 'KMB', cabd: 'A_KMB46', sgbd: 'C_KMB46', zcs: 1, fa: 0, comment: '' },
      { sgName: 'ALSZ', cabd: 'A_ALSZ', sgbd: 'C_LSZA', zcs: 0, fa: 1, comment: '' },
    ]);
  });

  it('captures trailing comment columns', () => {
    const text = `S ABG A_ZAE2 C_ZAE2 0 0 // trailing inline
S DSC A_ASCDSC C_ASCDSC 0 0 some extra free text
`;
    const { rows } = parseSgfam(text);
    expect(rows[0]!.comment).toBe('');                  // `//` was stripped by lexer
    expect(rows[1]!.comment).toBe('some extra free text');
  });

  it('flags malformed rows as unparsed instead of throwing', () => {
    const text = `S EWS only-three
S EWS A_EWS3 C_EWS3 X 0
`;
    const { rows, unparsed } = parseSgfam(text);
    expect(rows).toEqual([]);
    expect(unparsed).toHaveLength(2);
  });
});
