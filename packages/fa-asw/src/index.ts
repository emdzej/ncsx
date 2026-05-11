import { tokenizeFa } from './tokenize.js';
import type { AswSet, FaToAswOptions, FaWarning } from './types.js';

export { tokenizeFa } from './tokenize.js';
export type { AswSet, FaToAswOptions, FaWarning } from './types.js';

/**
 * Build an ASW bit set directly from a list of u16 KEYIDs. Use this when you already have
 * the IDs (e.g. from a ZCS decoder, an `.ssd` script, or a saved snapshot).
 */
export function aswFromIds(ids: Iterable<number>): AswSet {
  const out: AswSet = new Set();
  for (const id of ids) out.add(id & 0xffff);
  return out;
}

/**
 * Convert an FA string into the ASW bit set the predicate evaluator consumes.
 *
 * Pipeline (mirrors NCSEXPER's `coapiGetAswFromAuftrag` → `RecFncAsw`):
 *
 *  1. Tokenise the FA string (whitespace / commas; strip `$` / category-letter prefixes).
 *  2. For each token, look up the matching `W <token>` record in `chassis.at`.
 *  3. For each FSW name on that record, look up its u16 KEYID in `chassis.swtAsw`.
 *  4. Set the corresponding bit in the ASW vector.
 *  5. If `includeZwang` (default `true`), add KEYIDs from every Zwang (`Z`) entry in
 *     `chassis.atM00` whose code resolves through SWTASW.
 *
 * Missing AT records and missing SWTASW entries each surface as a warning (or throw in
 * strict mode). The ASW is still returned with whatever did resolve, so callers can recover.
 */
export function faToAsw(fa: string, options: FaToAswOptions): AswSet {
  const { chassis, onWarning, strict = false, includeZwang = true } = options;
  const warn = (w: FaWarning): void => {
    if (strict) throw new Error(`${w.kind}: ${w.message}`);
    if (onWarning) onWarning(w);
  };

  const asw: AswSet = new Set();

  if (!chassis.swtAsw) {
    warn({ kind: 'no-swt', message: `chassis ${chassis.code} has no SWTASW lookup table` });
    return asw;
  }

  const resolveFsw = (fsw: string): boolean => {
    const id = chassis.swtAsw!.byKeyword.get(fsw);
    if (id === undefined) {
      warn({
        kind: 'unknown-fsw',
        fsw,
        message: `FSW '${fsw}' not in chassis ${chassis.code}'s SWTASW`,
      });
      return false;
    }
    asw.add(id);
    return true;
  };

  const tokens = tokenizeFa(fa);
  for (const token of tokens) {
    const at = chassis.at?.get(token) ?? chassis.at?.get(token.replace(/^0+/, ''));
    if (!at) {
      warn({
        kind: 'unknown-fa-code',
        code: token,
        message: `FA code '${token}' is not in chassis ${chassis.code}'s AT dictionary`,
      });
      continue;
    }
    for (const fsw of at.fsws) resolveFsw(fsw);
  }

  if (includeZwang && chassis.atM00) {
    for (const entry of chassis.atM00.entries) {
      if (entry.category !== 'Z') continue;
      const code = entry.code.replace(/^#/, '');
      const at = chassis.at?.get(code) ?? chassis.at?.get(code.replace(/^0+/, ''));
      if (!at) continue; // Zwang codes are often hidden / not in W records; silently skip
      for (const fsw of at.fsws) resolveFsw(fsw);
    }
  }

  return asw;
}
