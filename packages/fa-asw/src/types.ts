import type { Chassis } from '@emdzej/ncsx-chassis';

/**
 * The ASW bit set the predicate evaluator consumes. Keys are `u16` ASW KEYIDs from
 * `<BR>SWTASW##.DAT` — the same packing the predicate's `S<id-lo><id-hi>` opcode uses
 * (high 12 bits = word index, low 4 bits = bit position in that word).
 */
export type AswSet = Set<number>;

export type FaWarning =
  | { kind: 'unknown-fa-code'; code: string; message: string }
  | { kind: 'unknown-fsw'; fsw: string; message: string }
  | { kind: 'no-swt'; message: string };

export interface FaToAswOptions {
  /** Required for proper FA → ASW resolution. */
  chassis: Chassis;
  /** Warning sink. */
  onWarning?: (w: FaWarning) => void;
  /** Throw instead of warning. */
  strict?: boolean;
  /**
   * When `true` (default), Zwang (`Z`) entries from `chassis.atM00` are auto-resolved through
   * the same FSW pipeline and added to the ASW. Set `false` to ignore them.
   */
  includeZwang?: boolean;
}
