import { readFile, readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { ChassisSource } from './source.js';

const toPosix = (p: string): string => p.replaceAll('\\', sep);

/**
 * Node `fs/promises`-backed {@link ChassisSource}. `rootDir` is an absolute or relative path
 * to the DATEN root (the parent of the chassis sub-directories, e.g.
 * `~/Downloads/inpa/NCSEXPER/DATEN`).
 */
export function nodeChassisSource(rootDir: string): ChassisSource {
  const resolve = (path: string): string => join(rootDir, toPosix(path));

  return {
    async read(path) {
      const buf = await readFile(resolve(path));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    async exists(path) {
      try {
        await stat(resolve(path));
        return true;
      } catch {
        return false;
      }
    },
    async list(dir) {
      return readdir(resolve(dir));
    },
  };
}
