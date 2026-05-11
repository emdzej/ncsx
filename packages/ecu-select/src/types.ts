import type { Chassis } from '@emdzej/ncsx-chassis';
import type { AswSet } from '@emdzej/ncsx-fa-asw';

/** Which SGAUSWAHL_* block a SelectedSg came from. */
export type SelectionSource = 'VMSGBD' | 'SGBD' | 'VM';

/**
 * One ECU resolved by walking `<BR>SGET.000` against the ASW.
 *
 * Field availability depends on the source block (see `docs/daten-format.md` §1.9):
 *
 * | Source    | SGNAME | CBD | CABD | SGBD | UMRSG | VMG |
 * |-----------|--------|-----|------|------|-------|-----|
 * | VMSGBD    | ✓      | ✓   | ✓    | ✓    | ✓     | ✓   |
 * | SGBD      | ✓      | ✓   | ✓    | ✓    | ✓     | —   |
 * | VM        | ✓      | ✓   | —    | —    | ✓     | ✓   |
 */
export interface SelectedSg {
  sgName: string;
  cbd: string;
  cabd?: string;
  sgbd?: string;
  umrsg: string;
  vmg?: string;
  index: number | null;
  source: SelectionSource;
}

export interface SelectEcusOptions {
  /**
   * Skip the lower-priority blocks once an SG has been matched in a higher-priority block.
   * Default: `true` — mirrors NCSEXPER's "most specific wins" tie-breaker per SG.
   */
  dedupeBySgName?: boolean;
  /**
   * Maximum AUFTRAGSAUSDRUCK length to accept; rows with longer predicates are skipped
   * with a warning. Default: 100 (matches NCSEXPER's static buffer size).
   */
  maxPredicateLength?: number;
  /**
   * Warning sink. Errors during a single row's predicate evaluation are caught and emitted
   * as warnings; the row is skipped and the walk continues.
   */
  onWarning?: (msg: string) => void;
}

export type EcuSelector = (chassis: Chassis, asw: AswSet, opts?: SelectEcusOptions) => SelectedSg[];
