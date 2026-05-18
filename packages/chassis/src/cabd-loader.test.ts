import { describe, expect, it } from 'vitest';
import { CabdLoader, CabdNotFoundError } from './cabd-loader.js';
import { inMemoryChassisSource } from './source-memory.js';
import { buildDst } from './test-helpers.js';

const stubBytes = buildDst();

describe('CabdLoader.openModule', () => {
  it('opens the requested .Cxx by basename + ci', async () => {
    const src = inMemoryChassisSource(
      new Map([
        ['e46/EWS.C07', stubBytes],
        ['e46/EWS.C09', stubBytes],
      ]),
    );
    const loader = new CabdLoader(src, 'e46');
    const file = await loader.openModule('EWS', 0x07);
    expect(file.blocks.length).toBeGreaterThan(0);
  });

  it('throws if the requested module is missing', async () => {
    const src = inMemoryChassisSource(new Map());
    const loader = new CabdLoader(src, 'e46');
    await expect(loader.openModule('EWS', 0x07)).rejects.toThrow(CabdNotFoundError);
  });

  it('caches by (basename, ci)', async () => {
    const src = inMemoryChassisSource(new Map([['e46/EWS.C07', stubBytes]]));
    const loader = new CabdLoader(src, 'e46');
    const a = await loader.openModule('EWS', 0x07);
    const b = await loader.openModule('EWS', 0x07);
    expect(a).toBe(b);
  });

  it('accepts case-insensitive directory entries (.c07 matches request for .C07)', async () => {
    const src = inMemoryChassisSource(new Map([['e46/ews.c07', stubBytes]]));
    const loader = new CabdLoader(src, 'e46');
    const file = await loader.openModule('EWS', 0x07);
    expect(file.blocks.length).toBeGreaterThan(0);
  });
});

describe('CabdLoader.listModules', () => {
  it('groups .Cxx files by basename, sorted, with ascending coding indexes', async () => {
    const src = inMemoryChassisSource(
      new Map([
        ['e46/KMB_E46.C06', stubBytes],
        ['e46/KMB_E46.C02', stubBytes],
        ['e46/KMB_E46.C07', stubBytes],
        ['e46/EWS.C81', stubBytes],
        ['e46/SOMETHING.txt', stubBytes], // ignored — not .Cxx
      ]),
    );
    const loader = new CabdLoader(src, 'e46');
    const modules = await loader.listModules();
    expect(modules).toEqual([
      { moduleName: 'EWS', codingIndexes: [0x81] },
      { moduleName: 'KMB_E46', codingIndexes: [0x02, 0x06, 0x07] },
    ]);
  });

  it('returns the cached result on repeat calls', async () => {
    const src = inMemoryChassisSource(new Map([['e46/EWS.C07', stubBytes]]));
    const loader = new CabdLoader(src, 'e46');
    const a = await loader.listModules();
    const b = await loader.listModules();
    expect(a).toBe(b);
  });

  it('returns an empty list for a chassis dir with no .Cxx files', async () => {
    const src = inMemoryChassisSource(
      new Map([['e46/E46DST.000', stubBytes]]),
    );
    const loader = new CabdLoader(src, 'e46');
    expect(await loader.listModules()).toEqual([]);
  });
});
