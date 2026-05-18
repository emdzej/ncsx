/**
 * One (FSW, PSW) combination together with all AUFTRAGSAUSDRUCK predicates that gate it.
 *
 * The CVT DATEN file pairs an `AUFTRAGSAUSDRUCK_A` row with the immediately-following
 * `FSW_PSW_WW` row inside a `GRUPPE_S` scope. Multiple predicate fragments for the same
 * `(fsw, psw)` pair are concatenated with an ASCII comma (byte `0x2c`) — same convention
 * NCSDummy uses in `Classes/Options/OptionParameterListItem.AddOptions`. The resulting byte
 * blob is a comma-separated OR-of-conjunctions; evaluate it with `@emdzej/ncsx-predicate`.
 */
export interface OptionParameter {
  /** PSW id from the `FSW_PSW_WW` row. */
  psw: number;
  /** Concatenated AUFTRAGSAUSDRUCK bytes (comma-joined predicate fragments). */
  predicate: Uint8Array;
}

/** All option-list entries for one FSW. */
export interface OptionFunction {
  /** FSW id from the `FSW_PSW_WW` row. */
  fsw: number;
  parameters: OptionParameter[];
}

/**
 * Result of `buildOptionList`. Returns one `OptionFunction` per distinct FSW id seen, in
 * the order the CVT file presented them.
 */
export interface OptionList {
  functions: OptionFunction[];
}

export class OptionListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionListError';
  }
}
