/**
 * Human-readable descriptions for FA tokens and the FSW keywords AT
 * records hand out. BMW's FA vocabulary follows a few well-known
 * conventions — production-date codes, Pulk (production-wave)
 * markers, German month names — that aren't in NCSDummy's
 * Translations.csv (it focuses on feature keywords, not scheduling
 * vocabulary). We decode them heuristically here.
 *
 * Conventions (verified against `E46AT.000` records):
 *
 *   #MMYY    Production date. `#0306` = March 2006. Year heuristic:
 *            00–89 → 20xx, 90–99 → 19xx (covers 1990–2089).
 *   PUxx     Pulk xx — a production-wave milestone. `PU01` =
 *            Pulk 01 ≈ year 2001. Same year heuristic as date codes.
 *   <MONTH>xx
 *            German month name + 2-digit year. `MAERZ01` = March
 *            2001. BMW pulks the schedule twice a year (March +
 *            September), so MAERZxx + SEPTxx are very common.
 *
 * Falls back to `null` so callers can chain into the community
 * Translations.csv for feature keywords (KOMBI, SHD, etc.).
 */

const MONTHS_DE_TO_EN: Readonly<Record<string, string>> = {
  JAN: 'January',
  FEB: 'February',
  MAERZ: 'March',
  MAERZ_OFFEN: 'March',
  APR: 'April',
  APRIL: 'April',
  MAI: 'May',
  JUN: 'June',
  JUNI: 'June',
  JUL: 'July',
  JULI: 'July',
  AUG: 'August',
  SEPT: 'September',
  SEP: 'September',
  OKT: 'October',
  NOV: 'November',
  DEZ: 'December',
};

const NUMERIC_MONTH_DE_TO_EN: ReadonlyArray<string> = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** 00–89 → 20xx, 90–99 → 19xx. Matches BMW's split for E36-onwards FAs. */
function yearOf(yy: number): number {
  return yy <= 89 ? 2000 + yy : 1900 + yy;
}

/**
 * Describe one keyword. Returns null when no built-in convention
 * applies (caller should then check community translations).
 */
export function describeFaKeyword(kw: string): string | null {
  if (!kw) return null;

  // #MMYY — production date code (in tokens, AT lookup, and FSWs all).
  const date = /^#(\d{2})(\d{2})$/.exec(kw);
  if (date) {
    const mm = Number(date[1]);
    const yy = Number(date[2]);
    const month = NUMERIC_MONTH_DE_TO_EN[mm - 1];
    if (mm >= 1 && mm <= 12) {
      return `Production date — ${month} ${yearOf(yy)}`;
    }
  }

  // PUxx — Pulk (production wave). BMW pulks twice a year so PU01 spans
  // the March + September 2001 release windows. The exact month is in
  // the matching MAERZxx / SEPTxx entries.
  const pulk = /^PU(\d{2})$/.exec(kw);
  if (pulk) {
    return `Pulk ${pulk[1]} — production wave (≈${yearOf(Number(pulk[1]))})`;
  }

  // German month name + 2-digit year — `MAERZ01`, `SEPT04`, etc.
  for (const [de, en] of Object.entries(MONTHS_DE_TO_EN)) {
    const re = new RegExp(`^${de}(\\d{2})$`);
    const m = re.exec(kw);
    if (m) {
      return `${en} ${yearOf(Number(m[1]))}`;
    }
  }

  return null;
}

/**
 * Like `describeFaKeyword` but also falls back to the community
 * Translations.csv map (if available). Returns null when nothing
 * matches — caller can render `—` or skip the description line.
 */
export function describeFaKeywordWithFallback(
  kw: string,
  translations: Map<string, string> | undefined,
): string | null {
  return describeFaKeyword(kw) ?? translations?.get(kw) ?? null;
}
