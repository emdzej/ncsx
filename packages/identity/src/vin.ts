import type { EdiabasJobResultLike, EdiabasLike } from '@emdzej/ncsx-wire';

/**
 * Job NCSEXPER's `coapiReadFgNr` (NCSEXPER.EXE `0x0042e430`) actually issues. The
 * earlier candidate-list approach guessed multiple aliases; ghidra trace shows there's
 * exactly one: `FGNR_LESEN`. Other names (`FG_NR_LESEN`, `IDENT_LESEN`) don't appear
 * in NCSEXPER's identity-read path.
 */
const VIN_JOB = 'FGNR_LESEN';

/**
 * EDIABAS result-set field name the SGBD emits the VIN under. Ghidra-verified via
 * `apiResultText("FAHRGESTELL_NR", …)` inside `coapiReadFgNr`. NOT one of the
 * `FG_NR_LANG`/`FG_NR`/`FGNR_LANG`/`FGNR`/`IDENT` guesses I had originally — those
 * jobs/fields don't exist on these SGBDs.
 */
const VIN_RESULT_NAME = 'FAHRGESTELL_NR';

export interface VinReadResult {
  ok: boolean;
  vin?: string;
  /** Last JOB_STATUS seen — useful for "tried, SG said NOT-OK". */
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

/**
 * VINs are 17 chars of [A-HJ-NPR-Z0-9] (no I/O/Q). Don't enforce the check digit — just
 * guard against the SG returning a placeholder like `00000000000000000` (some SGs
 * report all-zeros when the FAHRGESTELL_NR field isn't paired to the car yet).
 */
function looksLikeVin(s: string): boolean {
  return s.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(s) && !/^0+$/.test(s);
}

export async function readVin(
  ediabas: EdiabasLike,
  sgbd: string,
): Promise<VinReadResult> {
  try {
    await ediabas.loadSgbd(sgbd);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let sets: EdiabasJobResultLike[][];
  try {
    sets = await ediabas.executeJob(VIN_JOB);
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
  const r = findResult(sets, VIN_RESULT_NAME);
  if (!r) {
    return {
      ok: false,
      jobStatus: jobStatus || 'OKAY',
      error: `${VIN_JOB} ran but no ${VIN_RESULT_NAME} field in response`,
    };
  }
  const raw = typeof r.value === 'string' ? r.value : String(r.value);
  const trimmed = raw.trim().toUpperCase();
  if (!looksLikeVin(trimmed)) {
    return {
      ok: false,
      jobStatus: jobStatus || 'OKAY',
      error: `FAHRGESTELL_NR returned "${trimmed}" (not a valid VIN)`,
    };
  }
  return { ok: true, vin: trimmed, jobStatus: jobStatus || 'OKAY' };
}
