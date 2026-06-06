/**
 * The "wire" the rest of ncsx talks to EDIABAS through. We re-export
 * `@emdzej/ediabasx-core`'s IEdiabas surface here (instead of pulling
 * it on directly in every consumer) so the indirection is one place
 * to change if/when the surface evolves again — and so tests can
 * stub against a small named contract instead of the full IEdiabas.
 *
 * Helpers live alongside the type re-exports:
 *
 *   • `dataSets(response)` — slice `sets[0]` (the system set) off, so
 *     callers reasoning over **data** sets stay aligned with native
 *     `apiResult*` indexing (which is data-set-only).
 *   • `findResult(response, name)` — search across all data sets by
 *     name. Mirrors the per-set scan callers used to do over
 *     `EdiabasJobResultLike[][]`.
 *   • `jobStatus(response)` — read JOB_STATUS off the system set,
 *     which is where IEdiabas places it (the inner `Ediabas` class
 *     materialises it there via `buildSystemSet`).
 */
export type {
  IEdiabas,
  EdiabasJobResponse,
  EdiabasResultEntry,
  EdiabasResultSet,
  EdiabasResultType,
  EdiabasState,
} from '@emdzej/ediabasx-core';

import type {
  EdiabasJobResponse,
  EdiabasResultEntry,
  EdiabasResultSet,
} from '@emdzej/ediabasx-core';

/**
 * Return just the data sets from a job response — `sets[1..N]`.
 * `sets[0]` is always the system set (VARIANTE / OBJECT / JOBNAME /
 * SAETZE / JOB_STATUS / ...) and code that wants to iterate "the
 * job's actual results" should skip it.
 */
export function dataSets(response: EdiabasJobResponse): EdiabasResultSet[] {
  return response.sets.length > 0 ? response.sets.slice(1) : [];
}

/**
 * Search the data sets for the first entry with the given name.
 * Replacement for the per-set scan callers used to do over the
 * pre-IEdiabas `EdiabasJobResult[][]` shape — same semantics (first
 * hit across all sets wins), but the input is now the IEdiabas
 * response shape.
 *
 * Skips the system set (`sets[0]`) — code that needs system-set
 * metadata (JOB_STATUS / VARIANTE / SAETZE) should call
 * {@link jobStatus} or read `response.sets[0][name]` directly so the
 * intent is explicit.
 */
export function findResult(
  response: EdiabasJobResponse,
  name: string,
): EdiabasResultEntry | undefined {
  for (const set of dataSets(response)) {
    const hit = set[name];
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Read `JOB_STATUS` from a job response. Returns the empty string if
 * the SGBD didn't emit one (shouldn't happen for well-formed BMW
 * SGBDs, but defensive). Sourced from `sets[0]` — the inner
 * `Ediabas` class materialises JOB_STATUS into the system set via
 * `buildSystemSet`, so this is the canonical location regardless of
 * whether the SGBD's bytecode wrote it into a data set as well.
 */
export function jobStatus(response: EdiabasJobResponse): string {
  const systemSet = response.sets[0];
  if (!systemSet) return '';
  const entry = systemSet['JOB_STATUS'];
  if (!entry) return '';
  return typeof entry.value === 'string' ? entry.value : String(entry.value);
}
