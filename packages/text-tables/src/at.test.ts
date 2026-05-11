import { describe, expect, it } from 'vitest';
import { parseAt } from './at.js';

describe('parseAt', () => {
  it('parses DATUM and skips header / change-log comments', () => {
    const text = `// Auftragsdatei: E46AT.000
//         -350-
DATUM 22.01.2007
//
// Aenderungsdokumentation:
// E E3354.P   b           Datei neu erstellt
`;
    const { date, records } = parseAt(text);
    expect(date).toBe('22.01.2007');
    expect(records).toEqual([]);
  });

  it('parses W-records with FSWs and a trailing comment', () => {
    const text = `W 488                                                                  //Lordosenstuetze Fahrer/Beifahrer
W 502                   SWA                                            //Scheinwerfer-Waschanlage
W 524                   ALC XENON                                      //Lichtautomatik
`;
    const { records } = parseAt(text);
    expect(records).toEqual([
      { category: 'W', code: '488', fsws: [], comment: 'Lordosenstuetze Fahrer/Beifahrer' },
      { category: 'W', code: '502', fsws: ['SWA'], comment: 'Scheinwerfer-Waschanlage' },
      { category: 'W', code: '524', fsws: ['ALC', 'XENON'], comment: 'Lichtautomatik' },
    ]);
  });

  it('accepts hex-letter codes', () => {
    const text = `W 4AC                                                                  //EDELHOLZAUSFUEHRUNG
`;
    const { records } = parseAt(text);
    expect(records[0]!.code).toBe('4AC');
  });

  it('keeps E / S / Z / H / V categories alongside W', () => {
    const text = `W 488
S 230
E EWS4
Z 0904
H BFD
`;
    const { records } = parseAt(text);
    expect(records.map((r) => r.category)).toEqual(['W', 'S', 'E', 'Z', 'H']);
  });

  it('ignores lowercase leaders (treated as commentary)', () => {
    const text = `w 488
W 488
`;
    const { records } = parseAt(text);
    expect(records).toEqual([{ category: 'W', code: '488', fsws: [], comment: '' }]);
  });
});
