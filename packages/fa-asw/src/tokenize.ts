/**
 * Split an FA string into normalised tokens (uppercased, leading `$` or 1-letter category
 * prefix dropped). Whitespace and commas are valid separators.
 *
 * Examples:
 *
 * ```
 * "$0902 $0524 0205"                 → ["0902", "0524", "0205"]
 * "W0205,W0502,S0230"                → ["0205", "0502", "0230"]
 * "0205   0502\t0524"                → ["0205", "0502", "0524"]
 * ```
 *
 * Unknown / mangled tokens are still returned uppercased; the SA-code parser decides whether
 * they're acceptable.
 */
export function tokenizeFa(fa: string): string[] {
  const out: string[] = [];
  for (const raw of fa.split(/[\s,]+/)) {
    if (!raw) continue;
    let t = raw.toUpperCase();
    if (t.startsWith('$')) t = t.slice(1);
    // Category-letter prefix (W0205, S0230, Z#0904, E EWS4, …). The leading letter is the
    // category; drop it unless the *whole* token is short enough to be a code itself.
    if (/^[A-Z][0-9A-F#]+$/.test(t) && t.length > 1 && /[#]?[0-9A-F]/.test(t.slice(1))) {
      t = t.slice(1);
    }
    if (t.startsWith('#')) t = t.slice(1);
    if (t.length === 0) continue;
    out.push(t);
  }
  return out;
}
