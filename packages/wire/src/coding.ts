import type { CodingPlan } from '@emdzej/ncsx-coder';
import { bytesToHex, hexToBytes } from './hex.js';
import {
  ApiJobResult,
  EdiabasJobResultLike,
  EdiabasLike,
  Jobs,
  WireError,
} from './types.js';

/**
 * Walk all result sets returned by `executeJob` and find the **first** named result by
 * `name`. Returns the result row, or `undefined` if missing.
 */
function findResult(
  sets: EdiabasJobResultLike[][],
  name: string,
): EdiabasJobResultLike | undefined {
  for (const set of sets) {
    const hit = set.find((r) => r.name === name);
    if (hit) return hit;
  }
  return undefined;
}

function jobStatusFrom(sets: EdiabasJobResultLike[][]): string {
  const r = findResult(sets, 'JOB_STATUS');
  if (!r) return '';
  return typeof r.value === 'string' ? r.value : String(r.value);
}

/**
 * Read the current coding netto buffer from an SG via `CODIERDATEN_LESEN`.
 *
 * The SG returns its full netto image; we hand it back as a `Uint8Array` for ncsx's
 * coder/cabd pipeline to decode. Use this before computing a CodingPlan so the plan
 * splices edits on top of the actual current bytes instead of starting from zero.
 *
 * EDIABAS-side: `executeJob("CODIERDATEN_LESEN")` → result sets containing
 *   - `JOB_STATUS` text result (e.g. "OKAY")
 *   - `CODIERDATEN` text or binary result (hex / raw bytes of the netto buffer)
 */
export async function readCoding(
  ediabas: EdiabasLike,
  sgbd: string,
): Promise<ApiJobResult> {
  try {
    await ediabas.loadSgbd(sgbd);
    const sets = await ediabas.executeJob(Jobs.ReadCoding);
    const jobStatus = jobStatusFrom(sets);
    if (jobStatus !== 'OKAY') {
      return { ok: false, jobStatus: jobStatus || '(no JOB_STATUS)' };
    }
    const codingResult = findResult(sets, 'CODIERDATEN');
    if (!codingResult) {
      return { ok: false, jobStatus, error: 'No CODIERDATEN result in response' };
    }
    const netto = coerceNetto(codingResult.value);
    return { ok: true, jobStatus, netto };
  } catch (err) {
    return {
      ok: false,
      jobStatus: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Apply one `CodingPlan` to the ECU. The plan's `netto` buffer goes into the job's
 * `params` slot as an uppercase hex string; the SG responds with a `JOB_STATUS` we
 * surface in the returned `ApiJobResult`.
 *
 * Uses the `jobName` from the plan (defaults to `SG_CODIEREN`); plans driven by special
 * profiles (`Revtor`-style "Codieren ohne CI" jobs) carry their own name.
 *
 * **Effectful — writes to the ECU.** Caller is responsible for confirming with the user
 * before invoking. Returns the SG's response without retrying on error.
 */
export async function applyCodingPlan(
  ediabas: EdiabasLike,
  plan: CodingPlan,
): Promise<ApiJobResult> {
  if (!plan.sgbd) {
    throw new WireError(`CodingPlan for ${plan.sgName} has no sgbd — can't dispatch`);
  }
  try {
    await ediabas.loadSgbd(plan.sgbd);
    const paramsHex = bytesToHex(plan.netto);
    const sets = await ediabas.executeJob(plan.jobName, { params: [paramsHex] });
    const jobStatus = jobStatusFrom(sets);
    return {
      ok: jobStatus === 'OKAY',
      jobStatus: jobStatus || '(no JOB_STATUS)',
    };
  } catch (err) {
    return {
      ok: false,
      jobStatus: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read the SG's active coding index via `CODIERINDEX_LESEN`. Used to pick the right
 * `<basename>.C<ci>` file from the chassis CABD bundle when the user hasn't pinned it
 * manually.
 */
export async function readCodingIndex(
  ediabas: EdiabasLike,
  sgbd: string,
): Promise<{ ok: true; codingIndex: number } | { ok: false; error: string }> {
  try {
    await ediabas.loadSgbd(sgbd);
    const sets = await ediabas.executeJob(Jobs.ReadCodingIndex);
    const r = findResult(sets, 'CODIERINDEX');
    if (!r) return { ok: false, error: 'No CODIERINDEX in response' };
    const ci =
      typeof r.value === 'number' ? r.value : Number.parseInt(String(r.value), 16);
    if (!Number.isFinite(ci))
      return { ok: false, error: `CODIERINDEX not numeric: ${String(r.value)}` };
    return { ok: true, codingIndex: ci };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Lightweight ping — issues `IDENTIFIKATION` and returns whether the SG responds. Useful
 * for the Connect dialog's "test connection" affordance.
 */
export async function identify(
  ediabas: EdiabasLike,
  sgbd: string,
): Promise<ApiJobResult> {
  try {
    await ediabas.loadSgbd(sgbd);
    const sets = await ediabas.executeJob(Jobs.Identify);
    const jobStatus = jobStatusFrom(sets) || 'OKAY';
    return { ok: true, jobStatus };
  } catch (err) {
    return {
      ok: false,
      jobStatus: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Coerce the `CODIERDATEN` result's `value` into a `Uint8Array`. EDIABAS returns it as
 * either a hex string (most SGs) or a raw byte array (some), and the type tag varies. We
 * accept both.
 */
function coerceNetto(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return Uint8Array.from(value as number[]);
  }
  if (typeof value === 'string') return hexToBytes(value);
  throw new WireError(`unexpected CODIERDATEN value type: ${typeof value}`);
}
