import { parseDatenFile, type DatenFile } from '@emdzej/ncsx-daten';
import type { ChassisSource } from './source.js';

const BR_REF_NAMES = ['BR_REF.DAT', 'br_ref.dat'];

/**
 * Load and cache `BR_REF.DAT` from the source root.
 *
 * NCSEXPER reads it once at startup; we cache it weakly per source so multiple `loadChassis`
 * calls on the same root don't reparse it.
 */
const cache = new WeakMap<ChassisSource, DatenFile>();

export async function loadBrRef(source: ChassisSource): Promise<DatenFile> {
  const cached = cache.get(source);
  if (cached) return cached;

  let bytes: Uint8Array | undefined;
  for (const name of BR_REF_NAMES) {
    if (await source.exists(name)) {
      bytes = await source.read(name);
      break;
    }
  }
  if (!bytes) throw new Error('BR_REF.DAT not found at source root');

  const file = parseDatenFile(bytes);
  cache.set(source, file);
  return file;
}

/**
 * Resolve a chassis short-code through `BR_REF.DAT`:
 * - First, see if it's in `BR_ZEILE` (canonical chassis list).
 * - If not, see if it's in `BR_ERSATZ` (alias table) and follow the alias.
 *
 * Returns the canonical chassis code that owns a DATEN sub-directory.
 */
export function resolveChassisCode(brRef: DatenFile, requested: string): string {
  const upper = requested.toUpperCase();

  // BR_ZEILE: direct match
  const brZeile = brRef.blocks.find((b) => b.name === 'BR_ZEILE');
  if (brZeile) {
    for (const row of brZeile.rows) {
      for (const v of Object.values(row)) {
        if (typeof v === 'string' && v.toUpperCase() === upper) return upper;
      }
    }
  }

  // BR_ERSATZ: alias (e.g. E91 → E89)
  const brErsatz = brRef.blocks.find((b) => b.name === 'BR_ERSATZ');
  if (brErsatz) {
    for (const row of brErsatz.rows) {
      const values = Object.values(row).filter((v): v is string => typeof v === 'string');
      if (values[0]?.toUpperCase() === upper && values[1]) {
        return values[1].toUpperCase();
      }
    }
  }

  // Not in BR_REF — assume the caller knows what they're doing and pass the code through.
  return upper;
}
