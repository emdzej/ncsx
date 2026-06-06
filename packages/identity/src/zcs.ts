import {
  findResult,
  jobStatus,
  type IEdiabas,
} from '@emdzej/ncsx-wire';

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

function asString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

export async function readZcs(
  ediabas: IEdiabas,
  sgbd: string,
): Promise<ZcsReadResult> {
  let response;
  try {
    /* IEdiabas merges loadSgbd + executeJob into a single call —
       the ECU name is the first arg, no separate "load then run". */
    response = await ediabas.job(sgbd, ZCS_JOB);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const status = jobStatus(response);
  if (status && status !== 'OKAY') {
    return { ok: false, jobStatus: status };
  }
  const gm = findResult(response, RESULT_GM);
  const sa = findResult(response, RESULT_SA);
  const vn = findResult(response, RESULT_VN);
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
      jobStatus: status || 'OKAY',
      error: `${ZCS_JOB} ran but missing fields: ${missing}`,
    };
  }
  return {
    ok: true,
    jobStatus: status || 'OKAY',
    zcs: {
      gm: asString(gm.value).trim(),
      sa: asString(sa.value).trim(),
      vn: asString(vn.value).trim(),
    },
  };
}
