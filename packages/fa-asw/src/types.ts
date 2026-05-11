import type { Chassis } from '@emdzej/ncsx-chassis';

/**
 * The ASW bit set the predicate evaluator consumes. Keys are `u16` SA codes — the same
 * 4-hex-digit encoding the predicate's `S<id-lo><id-hi>` opcode uses on the wire (e.g.
 * SA code "0902" is encoded as `0x0902`).
 */
export type AswSet = Set<number>;

export type FaWarning =
  | { kind: 'malformed-token'; token: string; message: string }
  | { kind: 'unknown-code'; code: string; message: string };

export interface FaToAswOptions {
  /**
   * Chassis bundle. When provided, the resolver:
   *  - Cross-checks each token against the AT dictionary (`chassis.at`) and emits a warning
   *    for codes that aren't documented for this chassis.
   *  - Auto-expands Zwang ("Z") entries from `chassis.atM00`: any SA code that the M-list
   *    marks as a forced/implied consequence of an option also gets activated.
   */
  chassis?: Chassis;
  /** Sink for non-fatal warnings. */
  onWarning?: (w: FaWarning) => void;
  /** Reject unknown codes by throwing instead of warning. Default `false`. */
  strict?: boolean;
}
