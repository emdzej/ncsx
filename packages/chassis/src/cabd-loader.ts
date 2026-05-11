import { parseDatenFile, type DatenFile } from '@emdzej/ncsx-daten';
import type { ChassisSource } from './source.js';
import type { SgfamRow } from '@emdzej/ncsx-text-tables';

const padCi = (ci: number): string => ci.toString(16).toUpperCase().padStart(2, '0');

const CXX_RE = /^(.+)\.C([0-9A-Fa-f]{2})$/;

export class CabdNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CabdNotFoundError';
  }
}

/**
 * Resolve and lazily load a CABD `<SGBD>.Cxx` file from the chassis directory. Caches by
 * `(cabdName, ci)`.
 *
 * If `ci` is given, opens exactly `<CABD>.C<ci>` (case-insensitive on disk via the directory
 * listing — `.C07` vs `.c07` are both accepted).
 *
 * If `ci` is omitted, scans the chassis directory for any `<CABD>.C??` file; throws if there
 * are multiple matches (caller must disambiguate by reading the ECU's `CODIERINDEX_LESEN`
 * result first).
 */
export class CabdLoader {
  private readonly cache = new Map<string, DatenFile>();

  constructor(
    private readonly source: ChassisSource,
    /** Path of the chassis directory under the source root (e.g. `e46`). */
    private readonly chassisDir: string,
    private readonly sgfam: ReadonlyMap<string, SgfamRow>,
  ) {}

  /**
   * Look the SG up in SGFAM, find its CABD module name, then locate and parse the matching
   * `.Cxx` file.
   */
  async forSg(sgName: string, ci?: number): Promise<DatenFile> {
    const row = this.sgfam.get(sgName);
    if (!row) {
      throw new CabdNotFoundError(`SG '${sgName}' not in SGFAM`);
    }
    return this.byCabdName(row.cabd, ci);
  }

  /**
   * Open a CABD module directly by its short name (e.g. `A_EWS3`).
   */
  async byCabdName(cabd: string, ci?: number): Promise<DatenFile> {
    const cacheKey = ci === undefined ? cabd : `${cabd}.C${padCi(ci)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let filename: string;
    if (ci !== undefined) {
      filename = await this.findExact(cabd, padCi(ci));
    } else {
      filename = await this.findAny(cabd);
    }

    const bytes = await this.source.read(`${this.chassisDir}/${filename}`);
    const file = parseDatenFile(bytes);
    this.cache.set(cacheKey, file);
    return file;
  }

  /**
   * Find `<cabd>.C<ci-hex>` in the chassis directory, accepting either case for `.C`.
   */
  private async findExact(cabd: string, ciHex: string): Promise<string> {
    const entries = await this.source.list(this.chassisDir);
    const want = `${cabd}.C${ciHex}`.toLowerCase();
    for (const entry of entries) {
      if (entry.toLowerCase() === want) return entry;
    }
    throw new CabdNotFoundError(`${want} not in ${this.chassisDir}`);
  }

  /**
   * Find any `.Cxx` for the given CABD. Throws on multiple matches (caller must pin a CI).
   */
  private async findAny(cabd: string): Promise<string> {
    const entries = await this.source.list(this.chassisDir);
    const matches: string[] = [];
    const prefix = `${cabd}.`.toLowerCase();
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (!lower.startsWith(prefix)) continue;
      if (!CXX_RE.test(entry)) continue;
      matches.push(entry);
    }
    if (matches.length === 0) {
      throw new CabdNotFoundError(`no .Cxx for ${cabd} in ${this.chassisDir}`);
    }
    if (matches.length > 1) {
      throw new CabdNotFoundError(
        `multiple .Cxx for ${cabd} in ${this.chassisDir} (${matches.join(', ')}) — supply ci`,
      );
    }
    return matches[0]!;
  }
}
