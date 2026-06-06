import {
  findResult,
  jobStatus,
  type IEdiabas,
} from '@emdzej/ncsx-wire';

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

/**
 * VINs are 17 chars of [A-HJ-NPR-Z0-9] (no I/O/Q). Don't enforce the check digit — just
 * guard against the SG returning a placeholder like `00000000000000000` (some SGs
 * report all-zeros when the FAHRGESTELL_NR field isn't paired to the car yet).
 */
function looksLikeVin(s: string): boolean {
  return s.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(s) && !/^0+$/.test(s);
}

/**
 * Placeholder prefix NCSEXPER's `coapiSetFgNr` (NCSEXPER.EXE `0x0042a560`)
 * uses to pad the 7-char ECU FGNR into a 17-char VIN-shaped string.
 * Positions 1-3 = "WBA" (BMW AG WMI), positions 4-10 = "AA00000" (filler
 * — NOT derived from FA/chassis; NCSEXPER doesn't reconstruct the real
 * mid-VIN). The 7-char FGNR substitutes positions 11-17.
 */
const NCSEXPER_VIN_PLACEHOLDER = 'WBAAA00000';

/**
 * Replicate NCSEXPER's `coapiSetFgNr` padding so `FAHRGESTELL_NR` reads
 * out as a 17-character string regardless of what the cluster actually
 * returned.
 *
 * - **7 chars in** (typical ECU response — the bare Fahrgestellnummer):
 *   prepend `"WBAAA00000"` placeholder → 17 chars. **Not a real VIN** —
 *   the middle 10 characters are stub. NCSEXPER's UI displays this same
 *   synthetic string and labels it "VIN".
 * - **17 chars in**: pass through as-is.
 * - **18 chars in**: drop the trailing check-digit byte that some SGs
 *   append (NCSEXPER does this validation in `coapiSetFgNr`'s 18-char
 *   branch — we accept without verifying for now).
 * - **Anything else**: return unchanged so the caller can surface the
 *   garbage rather than silently fabricating padding around it.
 *
 * The bare 7-char FGNR (what NCSEXPER stores as `FAHRGESTELL_NR_KOMPL`
 * — "kompakt", not "komplett") is also available via the second return
 * field for callers that want to display both side-by-side.
 */
export interface PaddedVin {
  /** 17-char VIN-shaped string (real VIN when SG returned one; padded placeholder when SG returned bare FGNR). */
  vin: string;
  /** Bare 7-char FGNR — what NCSEXPER calls `FAHRGESTELL_NR_KOMPL`. */
  fgnr: string;
  /** True when `vin` is the placeholder-padded form (middle 10 chars synthetic). */
  padded: boolean;
}

export function padFgnrToVin(raw: string): PaddedVin {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s.length === 7) {
    return {
      vin: NCSEXPER_VIN_PLACEHOLDER + s,
      fgnr: s,
      padded: true,
    };
  }
  if (s.length === 17) {
    return { vin: s, fgnr: s.slice(10), padded: false };
  }
  if (s.length === 18) {
    const trimmed = s.slice(0, 17);
    return { vin: trimmed, fgnr: trimmed.slice(10), padded: false };
  }
  return { vin: s, fgnr: s.length >= 7 ? s.slice(-7) : s, padded: false };
}

export async function readVin(
  ediabas: IEdiabas,
  sgbd: string,
): Promise<VinReadResult> {
  let response;
  try {
    /* IEdiabas merges loadSgbd + executeJob into one call. */
    response = await ediabas.job(sgbd, VIN_JOB);
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
  const r = findResult(response, VIN_RESULT_NAME);
  if (!r) {
    return {
      ok: false,
      jobStatus: status || 'OKAY',
      error: `${VIN_JOB} ran but no ${VIN_RESULT_NAME} field in response`,
    };
  }
  const raw = typeof r.value === 'string' ? r.value : String(r.value);
  const trimmed = raw.trim().toUpperCase();
  if (!looksLikeVin(trimmed)) {
    return {
      ok: false,
      jobStatus: status || 'OKAY',
      error: `FAHRGESTELL_NR returned "${trimmed}" (not a valid VIN)`,
    };
  }
  return { ok: true, vin: trimmed, jobStatus: status || 'OKAY' };
}
