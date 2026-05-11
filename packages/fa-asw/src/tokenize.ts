/**
 * Split an FA string into normalised tokens. Whitespace and commas are valid separators;
 * each token is uppercased and stripped of a leading `$` or `#`.
 *
 * AT.000 FA codes are **alphanumeric** (`BL91`, `BR91`, `0205`, `4AC`, …) — do *not* strip a
 * leading letter, because for vehicle-type codes like `BL91` the `B` is part of the code,
 * not a record-category marker.
 *
 * ```
 * "$BL91 BR91"     → ["BL91", "BR91"]
 * "0205,0502,0524" → ["0205", "0502", "0524"]
 * "#0904"          → ["0904"]
 * ```
 */
export function tokenizeFa(fa: string): string[] {
  const out: string[] = [];
  for (const raw of fa.split(/[\s,]+/)) {
    if (!raw) continue;
    let t = raw.toUpperCase();
    while (t.startsWith('$') || t.startsWith('#')) t = t.slice(1);
    if (t.length === 0) continue;
    out.push(t);
  }
  return out;
}
