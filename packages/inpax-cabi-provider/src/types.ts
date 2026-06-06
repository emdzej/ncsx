/**
 * Public types for the CABI provider. CDH functions are async because each one
 * may bottom out in an EDIABAS apiJob over a serial cable — even pure getters can
 * block on SGBD load. Adopting Promise everywhere keeps the dispatch surface
 * uniform; pure-data getters just `Promise.resolve(...)`.
 */

import type { IEdiabas } from '@emdzej/ncsx-wire';
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
  /** The connected IEdiabas instance — `CDHapiJob` delegates here. */
  ediabas: IEdiabas | null;
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
  /**
   * Raw FA string for the active vehicle, in its native glued form
   * (`E46_#0306&N6SW%0354$167$1CA$205$832$L7BA`) — same shape NCSEXPER
   * keeps internally and walks via `strtok` in `getFaElement`
   * (`FUN_0044fc40`).
   *
   * Populated by the host (ncsx-web runtime) from `app.identity.fa`
   * before kicking off any IPO that touches FA — read back by the
   * IPO via the `CDHGetFa{Version,Element}` / `CDHGetAnzahlFaElemente`
   * trio. `null` (or empty) means no FA has been read for this
   * session; the FA getters then degrade to "empty FA" semantics —
   * zero elements, empty version — same as NCSEXPER when the user
   * hasn't loaded one.
   */
  fa: string | null;
}
