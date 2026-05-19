import type { EdiabasJobResultLike, EdiabasLike } from '@emdzej/ncsx-wire';

/**
 * Job NCSEXPER's `coapiReadZcs` (NCSEXPER.EXE `0x0042b6e0`) issues. Verified via the
 * string at `0x005af58c` xref'd from `FUN_0042b6e0` and the
 * `FUN_00433a70("ZCS_LESEN", …)` call.
 */
const ZCS_JOB = 'ZCS_LESEN';

/**
 * EDIABAS result-set field names the SGBD emits the ZCS payload under — **three
 * separate text fields**, not a single hex blob. NCSEXPER reads them via consecutive
 * `apiResultText` calls inside `coapiReadZcs`. The previous one-`ZCS`-field model
 * was wrong.
 */
const RESULT_GM = 'GM_SCHLUESSEL';
const RESULT_SA = 'SA_SCHLUESSEL';
const RESULT_VN = 'VN_SCHLUESSEL';

/**
 * Three text fields the SG reports together as the chassis ZCS. NCS Expert's
 * "Enter ZCS" dialog binds one input per field, in this order:
 *
 * - `gm` — Grundausstattungs-Modul key (base-model code, short string).
 * - `sa` — Sonderausstattung key (the SA-bits bit-set encoded as a hex string;
 *   decoding to named SA codes needs the chassis `<BR>ZST.*` table — pending).
 * - `vn` — Versions-Nummer key.
 */
export interface ZcsRead {
  gm: string;
  sa: string;
  vn: string;
}

export interface ZcsReadResult {
  ok: boolean;
  zcs?: ZcsRead;
  jobStatus?: string;
  error?: string;
}

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

function asString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

export async function readZcs(
  ediabas: EdiabasLike,
  sgbd: string,
): Promise<ZcsReadResult> {
  try {
    await ediabas.loadSgbd(sgbd);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let sets: EdiabasJobResultLike[][];
  try {
    sets = await ediabas.executeJob(ZCS_JOB);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const jobStatus = jobStatusFrom(sets);
  if (jobStatus && jobStatus !== 'OKAY') {
    return { ok: false, jobStatus };
  }
  const gm = findResult(sets, RESULT_GM);
  const sa = findResult(sets, RESULT_SA);
  const vn = findResult(sets, RESULT_VN);
  if (!gm || !sa || !vn) {
    const missing = [
      !gm && RESULT_GM,
      !sa && RESULT_SA,
      !vn && RESULT_VN,
    ]
      .filter(Boolean)
      .join(', ');
    return {
      ok: false,
      jobStatus: jobStatus || 'OKAY',
      error: `${ZCS_JOB} ran but missing fields: ${missing}`,
    };
  }
  return {
    ok: true,
    jobStatus: jobStatus || 'OKAY',
    zcs: {
      gm: asString(gm.value).trim(),
      sa: asString(sa.value).trim(),
      vn: asString(vn.value).trim(),
    },
  };
}
