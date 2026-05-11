import { describe, expect, it } from 'vitest';
import { loadBrRef, resolveChassisCode } from './br-ref.js';
import { inMemoryChassisSource } from './source-memory.js';
import { buildBrRef } from './test-helpers.js';

describe('loadBrRef', () => {
  it('reads BR_REF.DAT from the source root', async () => {
    const src = inMemoryChassisSource(
      new Map([['BR_REF.DAT', buildBrRef(['E46'], [])]]),
    );
    const file = await loadBrRef(src);
    expect(file.blocks.map((b) => b.name)).toContain('BR_ZEILE');
  });

  it('caches per source instance', async () => {
    const src = inMemoryChassisSource(
      new Map([['BR_REF.DAT', buildBrRef(['E46'], [])]]),
    );
    const a = await loadBrRef(src);
    const b = await loadBrRef(src);
    expect(a).toBe(b);
  });

  it('throws if BR_REF.DAT is missing', async () => {
    const src = inMemoryChassisSource(new Map());
    await expect(loadBrRef(src)).rejects.toThrow(/BR_REF/);
  });
});

describe('resolveChassisCode', () => {
  const brRef = (() => {
    const bytes = buildBrRef(['E31', 'E36', 'E46', 'E89'], [
      ['E91', 'E89'],
      ['R56', 'R50'],
    ]);
    // Reuse parseDatenFile via the in-memory source loader.
    return loadBrRef(inMemoryChassisSource(new Map([['BR_REF.DAT', bytes]])));
  })();

  it('returns the canonical code for a direct match', async () => {
    expect(resolveChassisCode(await brRef, 'E46')).toBe('E46');
  });

  it('is case-insensitive', async () => {
    expect(resolveChassisCode(await brRef, 'e36')).toBe('E36');
  });

  it('follows BR_ERSATZ aliases', async () => {
    expect(resolveChassisCode(await brRef, 'E91')).toBe('E89');
    expect(resolveChassisCode(await brRef, 'R56')).toBe('R50');
  });

  it('passes unknown codes through unchanged (uppercased)', async () => {
    expect(resolveChassisCode(await brRef, 'xyz')).toBe('XYZ');
  });
});
