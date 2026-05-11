import type { CabdRule } from '@emdzej/ncsx-cabd';
import type { Chassis } from '@emdzej/ncsx-chassis';
import type { SelectedSg } from '@emdzej/ncsx-ecu-select';

/**
 * One FSW/PSW change. Identified by numeric FSW id (the u16 stored in the CABD
 * `PARZUWEISUNG_FSW` row) and the raw PSW value.
 *
 * If `sgName` is given, only that SG receives the edit. Otherwise every selected SG whose
 * CABD has a matching FSW row gets the edit.
 */
export interface CodingEdit {
  /** Optional: pin this edit to a single SG. */
  sgName?: string;
  /** Numeric FSW id from the SG's CABD `PARZUWEISUNG_FSW` row. */
  fsw: number;
  /** Raw PSW value (post-EINHEIT/OPERATION logical form). */
  psw: number;
  /** Optional: target a specific indexed FSW slot (CABD's `INDEX` field). */
  index?: number;
  /** Optional: optional `BLOCKNR` filter (for segmented netto buffers). */
  blocknr?: number;
}

export interface PlanCodingOptions {
  chassis: Chassis;
  /** User-supplied FA string ("0205 0502 0524" or "$0902 W0524 …"). */
  fa: string;
  /** List of FSW/PSW edits to apply. */
  edits: readonly CodingEdit[];
  /**
   * EDIABAS job name to invoke for each plan. Default `SG_CODIEREN`. Override to
   * `SG_CODIEREN_OHNE_CI` / `SG_CODIEREN_OHNE_FG` / etc. per the chosen profile.
   */
  jobName?: string;
  /**
   * Pre-existing netto buffer per SG (e.g. what `CODIERDATEN_LESEN` returned). When omitted,
   * each plan starts from a zero-filled buffer sized to fit every PARZUWEISUNG_FSW row's
   * `WORTADR + BYTEADR`.
   */
  initialNetto?: ReadonlyMap<string, Uint8Array>;
  /** Coding-index hint per SG (passed to `chassis.cabd.forSg(sg, ci)`). */
  codingIndex?: ReadonlyMap<string, number>;
  /** Warning sink. */
  onWarning?: (msg: string) => void;
}

export type AppliedEdit = CodingEdit & { rule: CabdRule };

export interface CodingPlan {
  /** Logical SG short name. */
  sgName: string;
  /** SGBD module name (from SGFAM); the first arg to `apiJob`. */
  sgbd: string;
  /** CABD module name (from SGFAM). */
  cabd: string;
  /** EDIABAS job to invoke. */
  jobName: string;
  /** Final netto byte buffer to ship. */
  netto: Uint8Array;
  /** Each edit that ended up applied, plus the CABD rule it used. */
  applied: AppliedEdit[];
  /** Edits requested for this SG that couldn't be applied (e.g. unknown FSW). */
  skipped: { edit: CodingEdit; reason: string }[];
  /** SGAUSWAHL_* block this SG came from. */
  source: SelectedSg['source'];
}
