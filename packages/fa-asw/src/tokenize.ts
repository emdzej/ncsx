/**
 * Split an FA string into normalised tokens.
 *
 * Real FAs read off the ECU come in two shapes:
 *
 *   1. **Glued / native form**: `E46_#0306&N6SW%0354$167$1CA$205$832$L7BA`
 *      — tokens are concatenated with single category-marker chars
 *      (`_ # & % $ | * + -`) acting as both delimiter AND classifier.
 *   2. **Pre-separated form**: `$BL91 BR91`, `0205,0502,0524`
 *      — whitespace / comma separated, prefix chars optional.
 *
 * NCSEXPER's `convertFzgAuftragString` (ghidra `FUN_00450180`) feeds
 * the FA through `strtok` with a marker-char delimiter string, then
 * dispatches on each token's first byte. We do the equivalent: insert
 * a space before every marker char, split on whitespace+commas, then
 * trim leading markers.
 *
 * **Keeps the `#` prefix** because AT records store date codes with
 * the `#` intact (the chassis `at` map has keys like `#0306` —
 * stripping the `#` would miss every lookup).
 *
 * ```
 * "E46_#0306&N6SW%0354$167"  → ["E46", "#0306", "N6SW", "0354", "167"]
 * "$BL91 BR91"                → ["BL91", "BR91"]
 * "0205,0502,0524"            → ["0205", "0502", "0524"]
 * "#0904"                     → ["#0904"]
 * ```
 */
export function tokenizeFa(fa: string): string[] {
  if (!fa) return [];
  // Insert a space before each FA category marker so glued strings
  // separate into spaced tokens. Markers listed mirror the chars
  // NCSEXPER's `convertFzgAuftragString` recognises plus `_` (the
  // chassis prefix delimiter).
  const spaced = fa.replace(/([#&%$_|*+\-])/g, ' $1');
  const out: string[] = [];
  for (const raw of spaced.split(/[\s,]+/)) {
    if (!raw) continue;
    let t = raw.toUpperCase();
    // Strip leading markers EXCEPT `#` — date codes (`#0306`) are
    // stored with the `#` in AT records, so it stays part of the key.
    while (t.length > 0 && /[$&%_|*+\-]/.test(t[0]!)) t = t.slice(1);
    if (t.length === 0) continue;
    out.push(t);
  }
  return out;
}
