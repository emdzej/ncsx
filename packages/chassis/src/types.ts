import type { DatenFile } from '@emdzej/ncsx-daten';
import type {
  AtFile,
  AtM00File,
  AtRecord,
  SgfamRow,
} from '@emdzej/ncsx-text-tables';
import type { CabdLoader } from './cabd-loader.js';
import type { ZcsutIndex, ZstIndex } from './indexes.js';
import type { SwtTable } from './swt.js';

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
  cvt: DatenFile;
  /**
   * Parsed `<BR>ZCSUT.000` — per-SG (GM, SA, VN) catalogue + conversion
   * rules for pre-FA chassis. Optional because FA-master chassis don't
   * ship a ZCSUT file. Raw `DatenFile` is available via `zcsut.file`;
   * the indexed `bySg` map is what the ZCS editor consumes.
   */
  zcsut?: ZcsutIndex;

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

  /** FSW name → ASW KEYID lookup (`<BR>SWTASW##.DAT`). Drives the predicate evaluator. */
  swtAsw?: SwtTable;
  /** FSW name → FSW KEYID lookup (`<BR>SWTFSW##.DAT`). Drives CABD PARZUWEISUNG_FSW resolution. */
  swtFsw?: SwtTable;
  /** PSW name → PSW value lookup (`<BR>SWTPSW##.DAT`). Drives FSW=PSW edit resolution. */
  swtPsw?: SwtTable;

  /** Lazy CABD `.Cxx` loader (cached). */
  cabd: CabdLoader;
}
