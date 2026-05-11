import { describe, expect, it } from 'vitest';
import { parseAtM00 } from './at-m00.js';

describe('parseAtM00', () => {
  it('parses DATUM, DATEINAME, and category records', () => {
    const text = `DATUM 22.01.2007
DATEINAME E46AT.M00
Z #0904
Z #0305
E EWS4
W 0100
W 0103
S 230
`;
    const { date, filename, entries, unparsed } = parseAtM00(text);
    expect(date).toBe('22.01.2007');
    expect(filename).toBe('E46AT.M00');
    expect(unparsed).toEqual([]);
    expect(entries).toEqual([
      { category: 'Z', code: '#0904' },
      { category: 'Z', code: '#0305' },
      { category: 'E', code: 'EWS4' },
      { category: 'W', code: '0100' },
      { category: 'W', code: '0103' },
      { category: 'S', code: '230' },
    ]);
  });

  it('skips blank and comment-only lines', () => {
    const text = `; a comment
// another

W 0100
`;
    const { entries } = parseAtM00(text);
    expect(entries).toEqual([{ category: 'W', code: '0100' }]);
  });
});
