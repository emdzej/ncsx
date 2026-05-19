import type { EdiabasJobResultLike, EdiabasLike } from '@emdzej/ncsx-wire';

/**
 * Job NCSEXPER's `coapiReadAuftrag` (NCSEXPER.EXE `0x0042f800`) issues. **`FA_READ`**
 * — English, not German `FA_LESEN`. Ghidra-verified via the string constant at
 * `0x005dbc1c` xref'd from `FUN_0042f800` and the `FUN_00433a70("FA_READ", …)` call.
 */
const FA_JOB = 'FA_READ';

/**
 * EDIABAS result-set field the SGBD emits the FA token list under. Ghidra-verified
 * via `apiResultText("FA_STREAM", …)` inside `coapiReadAuftrag`. The previous
 * `STANDARD_FA` / `FA_LANG` / `FA` guesses don't exist on these SGBDs.
 */
const FA_RESULT_NAME = 'FA_STREAM';

export interface FaReadResult {
  ok: boolean;
  /**
   * FA exactly as the SG returned it — preserves the sigil-prefixed token shape
   * (`E46_#0306&N6SW%0354$167…`) so the downstream parser sees it the way COAPI does.
   */
  fa?: string;
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

export async function readFa(
  ediabas: EdiabasLike,
  sgbd: string,
): Promise<FaReadResult> {
  try {
    await ediabas.loadSgbd(sgbd);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let sets: EdiabasJobResultLike[][];
  try {
    sets = await ediabas.executeJob(FA_JOB);
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
  const r = findResult(sets, FA_RESULT_NAME);
  if (!r) {
    return {
      ok: false,
      jobStatus: jobStatus || 'OKAY',
      error: `${FA_JOB} ran but no ${FA_RESULT_NAME} field in response`,
    };
  }
  const raw = typeof r.value === 'string' ? r.value : String(r.value);
  const trimmed = raw.trim();
  if (trimmed === '') {
    return {
      ok: false,
      jobStatus: jobStatus || 'OKAY',
      error: `${FA_RESULT_NAME} returned an empty string`,
    };
  }
  return { ok: true, fa: trimmed, jobStatus: jobStatus || 'OKAY' };
}
