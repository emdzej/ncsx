import { describe, expect, it } from 'vitest';
import { CabdLoader, CabdNotFoundError } from './cabd-loader.js';
import { inMemoryChassisSource } from './source-memory.js';
import { buildDst } from './test-helpers.js';
import type { SgfamRow } from '@emdzej/ncsx-text-tables';

const stubBytes = buildDst();

const sgfam = new Map<string, SgfamRow>([
  ['EWS', { sgName: 'EWS', cabd: 'A_EWS3', sgbd: 'C_EWS3', zcs: 1, fa: 0, comment: '' }],
  ['KMB', { sgName: 'KMB', cabd: 'A_KMB46', sgbd: 'C_KMB46', zcs: 1, fa: 0, comment: '' }],
]);

describe('CabdLoader', () => {
  it('resolves SG → CABD module and loads the exact .Cxx requested', async () => {
    const src = inMemoryChassisSource(
      new Map([
        ['e46/A_EWS3.C07', stubBytes],
        ['e46/A_EWS3.C09', stubBytes],
      ]),
    );
    const loader = new CabdLoader(src, 'e46', sgfam);
    const file = await loader.forSg('EWS', 0x07);
    expect(file.blocks.length).toBeGreaterThan(0);
  });

  it('finds the single .Cxx when ci is omitted', async () => {
    const src = inMemoryChassisSource(new Map([['e46/A_KMB46.C03', stubBytes]]));
    const loader = new CabdLoader(src, 'e46', sgfam);
    const file = await loader.forSg('KMB');
    expect(file.blocks.length).toBeGreaterThan(0);
  });

  it('throws if multiple .Cxx match and no ci was given', async () => {
    const src = inMemoryChassisSource(
      new Map([
        ['e46/A_EWS3.C07', stubBytes],
        ['e46/A_EWS3.C09', stubBytes],
      ]),
    );
    const loader = new CabdLoader(src, 'e46', sgfam);
    await expect(loader.forSg('EWS')).rejects.toThrow(CabdNotFoundError);
  });

  it('throws if no .Cxx exists for the CABD', async () => {
    const src = inMemoryChassisSource(new Map());
    const loader = new CabdLoader(src, 'e46', sgfam);
    await expect(loader.forSg('EWS')).rejects.toThrow(CabdNotFoundError);
  });

  it('throws if the SG is missing from SGFAM', async () => {
    const src = inMemoryChassisSource(new Map());
    const loader = new CabdLoader(src, 'e46', sgfam);
    await expect(loader.forSg('NOPE')).rejects.toThrow(/not in SGFAM/);
  });

  it('caches by (CABD, ci)', async () => {
    const src = inMemoryChassisSource(new Map([['e46/A_EWS3.C07', stubBytes]]));
    const loader = new CabdLoader(src, 'e46', sgfam);
    const a = await loader.forSg('EWS', 0x07);
    const b = await loader.forSg('EWS', 0x07);
    expect(a).toBe(b);
  });

  it('accepts case-insensitive directory entries (.c07 vs .C07)', async () => {
    const src = inMemoryChassisSource(new Map([['e46/a_ews3.c07', stubBytes]]));
    const loader = new CabdLoader(src, 'e46', sgfam);
    const file = await loader.forSg('EWS', 0x07);
    expect(file.blocks.length).toBeGreaterThan(0);
  });
});
