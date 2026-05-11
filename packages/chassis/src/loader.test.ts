import { describe, expect, it } from 'vitest';
import { loadChassis } from './loader.js';
import { inMemoryChassisSource } from './source-memory.js';
import { buildBrRef, buildDst } from './test-helpers.js';

const SGFAM_TEXT = `; comment
S EWS A_EWS3 C_EWS3 1 0
S KMB A_KMB46 C_KMB46 1 0
`;

const ZST_TEXT = `;Tabelle: E46ZST.000                Index: co vom: 18.02.2002  NAEL: E3424.R
I co
U 20020218093000
V E46ZST.000
;0205                 0000000000000008 0000000000 AUTOMATIK
;0502                 0000000000000020 0000000000 SWA
`;

const AT_TEXT = `// Auftragsdatei: E46AT.000
DATUM 22.01.2007
W 502                   SWA                                            //Scheinwerfer-Waschanlage
W 524                   ALC XENON                                      //Lichtautomatik
`;

const AT_M00_TEXT = `DATUM 22.01.2007
DATEINAME E46AT.M00
W 0100
W 0103
`;

const ascii = (s: string): Uint8Array =>
  Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

const baseFiles = (): Map<string, Uint8Array> =>
  new Map([
    ['BR_REF.DAT', buildBrRef(['E46', 'E89'], [['E91', 'E89']])],
    ['e46/E46DST.000', buildDst()],
    ['e46/E46SGET.000', buildDst()],
    ['e46/E46SGVT.000', buildDst()],
    ['e46/E46ZCSUT.000', buildDst()],
    ['e46/E46CVT.000', buildDst()],
    ['e46/E46SGFAM.DAT', ascii(SGFAM_TEXT)],
    ['e46/E46ZST.000', ascii(ZST_TEXT)],
    ['e46/E46AT.000', ascii(AT_TEXT)],
    ['e46/E46AT.M00', ascii(AT_M00_TEXT)],
    ['e46/A_EWS3.C07', buildDst()],
  ]);

describe('loadChassis', () => {
  it('returns a fully populated chassis bundle for E46', async () => {
    const src = inMemoryChassisSource(baseFiles());
    const chassis = await loadChassis(src, 'E46');
    expect(chassis.code).toBe('E46');
    expect(chassis.requestedCode).toBe('E46');
    expect(chassis.dir).toBe('e46');
    expect(chassis.dst.blocks.length).toBeGreaterThan(0);
    expect(chassis.sgfam.get('EWS')!.cabd).toBe('A_EWS3');
    expect(chassis.zst!.bySaCode.get('0205')).toHaveLength(1);
    expect(chassis.at!.get('502')!.fsws).toEqual(['SWA']);
    expect(chassis.atM00!.entries.length).toBe(2);
  });

  it('aliases requested code via BR_ERSATZ (E91 → E89)', async () => {
    const files = baseFiles();
    files.set('e89/E89DST.000', buildDst());
    const src = inMemoryChassisSource(files);
    const chassis = await loadChassis(src, 'E91');
    expect(chassis.code).toBe('E89');
    expect(chassis.requestedCode).toBe('E91');
    expect(chassis.dir).toBe('e89');
  });

  it('throws on missing DST.000 for the resolved chassis', async () => {
    const files = baseFiles();
    files.delete('e46/E46DST.000');
    const src = inMemoryChassisSource(files);
    await expect(loadChassis(src, 'E46')).rejects.toThrow(/E46DST\.000/);
  });

  it('emits warnings for missing optional companions', async () => {
    const files = baseFiles();
    files.delete('e46/E46SGFAM.DAT');
    files.delete('e46/E46ZST.000');
    const src = inMemoryChassisSource(files);
    const warns: string[] = [];
    const chassis = await loadChassis(src, 'E46', {
      onWarning: (w) => warns.push(`${w.kind}:${w.file}`),
    });
    expect(warns).toEqual(
      expect.arrayContaining([
        'missing-optional:e46/E46SGFAM.DAT',
        'missing-optional:e46/E46ZST.000',
      ]),
    );
    expect(chassis.sgfam.size).toBe(0);
    expect(chassis.zst).toBeUndefined();
  });

  it('exposes a working lazy CABD loader', async () => {
    const src = inMemoryChassisSource(baseFiles());
    const chassis = await loadChassis(src, 'E46');
    const ews = await chassis.cabd.forSg('EWS', 0x07);
    expect(ews.blocks.length).toBeGreaterThan(0);
  });
});
