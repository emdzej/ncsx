import { parseDatenFile, type DatenFile } from '@emdzej/ncsx-daten';
import type { ChassisSource } from './source.js';

const padCi = (ci: number): string => ci.toString(16).toUpperCase().padStart(2, '0');

const CXX_RE = /^(.+)\.C([0-9A-Fa-f]{2})$/;

export class CabdNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CabdNotFoundError';
  }
}

/**
 * One `.C??` coding-data module discovered on disk. `moduleName` is the file basename
 * (e.g. `KMB_E46`), `codingIndexes` is every coding-index hex suffix that file's
 * sibling-set ships (e.g. `[0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]`).
 *
 * NCS Dummy uses the same shape — see
 * `NcsDummy/Classes/Modules/ModuleListReader.cs:25-43`, which enumerates `*.C??` files
 * directly rather than going through SGFAM.
 */
export interface CabdModule {
  /** File basename, e.g. `KMB_E46`. */
  moduleName: string;
  /** Sorted, ascending list of hex coding-index suffixes available on disk. */
  codingIndexes: number[];
}

/**
 * Resolve and lazily load a CABD `<basename>.Cxx` file from the chassis directory.
 * Caches the parsed `DatenFile` per `(basename, ci)`. Caches the chassis directory
 * listing once on first probe so a typical "scan all modules up front" sweep makes a
 * single `source.list()` round-trip.
 *
 * **Module resolution is by on-disk file basename, not by SGFAM.** Pick a module by its
 * basename (`KMB_E46`, `EWS`, `LSZ_E46`, …) plus a coding index (`0x07` for `.C07`). For
 * FA-driven flows, the basename comes from `SGAUSWAHL.SGNAME` and the coding index from
 * the leading-`C`-stripped value of `SGAUSWAHL.CBD`. See
 * [`docs/ecu-selection.md` §8](../../../docs/ecu-selection.md) for the lookup contract.
 *
 * `SGFAM.CABD` is **not** a file basename and there is no string transform from it to one
 * — see the doc for the antipatterns to avoid.
 */
export class CabdLoader {
  private readonly cache = new Map<string, DatenFile>();
  private listingPromise: Promise<readonly string[]> | null = null;
  private modulesPromise: Promise<CabdModule[]> | null = null;

  constructor(
    private readonly source: ChassisSource,
    /** Path of the chassis directory under the source root (e.g. `e46`). */
    private readonly chassisDir: string,
  ) {}

  /**
   * Enumerate every `.C??` file in the chassis directory, grouped by basename. Sorted
   * alphabetically by `moduleName`. Same logic NCS Dummy's `ModuleListReader` uses to
   * populate its Modules dropdown.
   *
   * The result is cached — call it as often as you like.
   */
  async listModules(): Promise<CabdModule[]> {
    if (!this.modulesPromise) {
      this.modulesPromise = this.computeModules();
    }
    return this.modulesPromise;
  }

  /**
   * Open one specific module by on-disk basename + coding index. Throws
   * `CabdNotFoundError` if `<basename>.C<ci>` isn't present (case-insensitive).
   */
  async openModule(moduleName: string, codingIndex: number): Promise<DatenFile> {
    const cacheKey = `${moduleName}.C${padCi(codingIndex)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const entries = await this.listing();
    const want = cacheKey.toLowerCase();
    const filename = entries.find((e) => e.toLowerCase() === want);
    if (!filename) {
      throw new CabdNotFoundError(
        `${cacheKey} not in ${this.chassisDir} — listModules() to see what's available`,
      );
    }

    const bytes = await this.source.read(`${this.chassisDir}/${filename}`);
    const file = parseDatenFile(bytes);
    this.cache.set(cacheKey, file);
    return file;
  }

  private async computeModules(): Promise<CabdModule[]> {
    const entries = await this.listing();
    const byBase = new Map<string, Set<number>>();
    for (const entry of entries) {
      const match = CXX_RE.exec(entry);
      if (!match) continue;
      const base = match[1]!;
      const ci = Number.parseInt(match[2]!, 16);
      if (!Number.isFinite(ci)) continue;
      let set = byBase.get(base);
      if (!set) {
        set = new Set();
        byBase.set(base, set);
      }
      set.add(ci);
    }
    const out: CabdModule[] = [];
    for (const [base, cis] of byBase) {
      out.push({ moduleName: base, codingIndexes: [...cis].sort((a, b) => a - b) });
    }
    out.sort((a, b) => a.moduleName.localeCompare(b.moduleName));
    return out;
  }

  private listing(): Promise<readonly string[]> {
    if (!this.listingPromise) {
      this.listingPromise = this.source.list(this.chassisDir);
    }
    return this.listingPromise;
  }
}
