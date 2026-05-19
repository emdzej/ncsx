/**
 * Public types for the CABI provider. CDH functions are async because each one
 * may bottom out in an EDIABAS apiJob over a serial cable — even pure getters can
 * block on SGBD load. Adopting Promise everywhere keeps the dispatch surface
 * uniform; pure-data getters just `Promise.resolve(...)`.
 */

import type { EdiabasLike } from '@emdzej/ncsx-wire';
import type { Chassis } from '@emdzej/ncsx-chassis';

/**
 * Out-parameter return shape. CABI/CDH functions use `out:` parameters to return
 * additional values alongside a `RetVal` error code; in TypeScript we collapse
 * that into a single result object. `retVal: 0` means COAPI_OK; non-zero is one
 * of the codes in `error-codes.ts`.
 */
export interface CdhResult<T = void> {
  retVal: number;
  /** Out-parameters as a structured object. Empty for void-returning CDH functions. */
  out?: T;
}

/**
 * Host context the provider needs. Populated by the consumer (ncsx-web's
 * runtime) when constructing the provider — these are the live references the
 * CDH implementations read/write.
 */
export interface CdhContext {
  /** The connected Ediabas instance — `CDHapiJob` delegates here. */
  ediabas: EdiabasLike | null;
  /** Active chassis (BR_REF row, SGFAM, SWT tables, …). */
  chassis: Chassis | null;
  /**
   * Current SG short-name (e.g. `AKMB`) — set by `CDHSetSgName`, read by
   * `CDHGetSgbdName` (after lookup via SGFAM).
   */
  currentSgName: string | null;
  /**
   * Current CABD module basename (e.g. `A_AKMB46`) — set by the runtime when it
   * binds an IPO; used by `CDHGetCabdName`.
   */
  currentCabd: string | null;
  /**
   * Current CBD coding-index (e.g. `C08`) — derived from SGAUSWAHL when an SG
   * is picked.
   */
  currentCbd: string | null;
  /** Currently set Codier-Baureihe (chassis code, e.g. `E46`). */
  currentCodierBaureihe: string | null;
}
