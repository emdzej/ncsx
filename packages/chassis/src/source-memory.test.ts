import { describe, expect, it } from 'vitest';
import { inMemoryChassisSource } from './source-memory.js';

describe('inMemoryChassisSource', () => {
  const files = new Map([
    ['e46/E46DST.000', Uint8Array.from([0x01])],
    ['e46/E46SGFAM.DAT', Uint8Array.from([0x02])],
    ['e46/A_EWS3.C07', Uint8Array.from([0x03])],
    ['BR_REF.DAT', Uint8Array.from([0x04])],
  ]);
  const src = inMemoryChassisSource(files);

  it('reads files by forward-slash path', async () => {
    expect(await src.read('e46/E46DST.000')).toEqual(Uint8Array.from([0x01]));
  });

  it('accepts backslash paths (NCSEXPER-style)', async () => {
    expect(await src.read('e46\\E46DST.000')).toEqual(Uint8Array.from([0x01]));
  });

  it('exists() returns true/false', async () => {
    expect(await src.exists('BR_REF.DAT')).toBe(true);
    expect(await src.exists('nope')).toBe(false);
  });

  it('list() returns immediate children of a dir', async () => {
    const entries = (await src.list('e46')).sort();
    expect(entries).toEqual(['A_EWS3.C07', 'E46DST.000', 'E46SGFAM.DAT']);
  });

  it("list('') returns root-level entries", async () => {
    const entries = (await src.list('')).sort();
    expect(entries).toEqual(['BR_REF.DAT', 'e46']);
  });

  it('read() throws on ENOENT', async () => {
    await expect(src.read('nope')).rejects.toThrow(/ENOENT/);
  });
});
