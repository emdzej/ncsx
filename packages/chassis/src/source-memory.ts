import type { ChassisSource } from './source.js';

const normalise = (p: string): string => p.replaceAll('\\', '/').replace(/^\/+/, '');

/**
 * In-memory {@link ChassisSource} for tests. The `files` map keys are normalised paths
 * (forward slashes, no leading `/`); values are the raw file bytes.
 */
export function inMemoryChassisSource(files: Map<string, Uint8Array>): ChassisSource {
  return {
    async read(path) {
      const key = normalise(path);
      const buf = files.get(key);
      if (!buf) throw new Error(`ENOENT: ${key}`);
      return buf;
    },
    async exists(path) {
      return files.has(normalise(path));
    },
    async list(dir) {
      const prefix = normalise(dir);
      const prefixSlash = prefix === '' ? '' : prefix + '/';
      const out = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefixSlash)) continue;
        const rest = key.slice(prefixSlash.length);
        const slash = rest.indexOf('/');
        out.add(slash === -1 ? rest : rest.slice(0, slash));
      }
      return [...out];
    },
  };
}
