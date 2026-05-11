import type { DatenFile } from '@emdzej/ncsx-daten';
import type {
  AtFile,
  AtM00File,
  AtRecord,
  SgfamRow,
} from '@emdzej/ncsx-text-tables';
import type { CabdLoader } from './cabd-loader.js';
import type { ZstIndex } from './indexes.js';

export type ChassisWarning = {
  kind: 'missing-optional' | 'parse-failure';
  file: string;
  message: string;
};

export interface LoadChassisOptions {
  /** Sink for non-fatal warnings (missing optional file, malformed table, …). */
  onWarning?: (w: ChassisWarning) => void;
}

/**
 * The bundle a single chassis ships under DATEN. Cross-linked and indexed for fast
 * ECU-selection lookups.
 */
export interface Chassis {
  /** Canonical chassis code (post BR_ERSATZ aliasing). */
  code: string;
  /** Original code as requested (may differ if `BR_ERSATZ` rewrote it). */
  requestedCode: string;
  /** Chassis directory under the source root (`e46`, `e89`, …). */
  dir: string;

  brRef: DatenFile;
  dst: DatenFile;
  sget: DatenFile;
  sgvt: DatenFile;
  zcsut: DatenFile;
  cvt: DatenFile;

  /** SGFAM rows by logical SG name. */
  sgfam: Map<string, SgfamRow>;
  /** ZST records, plus by-SA-code / by-FSW indexes. */
  zst?: ZstIndex;
  /** AT records by FA code (e.g. "502" → AtRecord). */
  at?: Map<string, AtRecord>;
  /** Raw parsed AT file (`AtFile`) — kept for callers that need `.date` / unparsed lines. */
  atRaw?: AtFile;
  /** AT.M00 (compact FA-token list). */
  atM00?: AtM00File;
  /** AT.ZUS (companion change-log / extension; same shape as AT). */
  atZus?: AtFile;

  /** Lazy CABD `.Cxx` loader (cached). */
  cabd: CabdLoader;
}
