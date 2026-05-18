/**
 * Render a `keyword  -  translation` label exactly the way NCSDummy does in
 * `Classes/Functions/ParameterListItem.cs:22`:
 *
 * ```cs
 * this.Text = (translation != "") ? (keyword + "  -  " + translation) : keyword;
 * ```
 *
 * The two-space-dash-two-space separator is verbatim. Returns just the keyword when no
 * translation is available.
 */
export function formatLabel(
  keyword: string,
  translations: ReadonlyMap<string, string> | undefined,
): string {
  if (!translations) return keyword;
  const t = translations.get(keyword);
  return t && t !== '' ? `${keyword}  -  ${t}` : keyword;
}

/**
 * Variant that returns the parts so callers can render keyword and translation as separate
 * elements (useful in HTML where styling the two halves differently is common).
 */
export function splitLabel(
  keyword: string,
  translations: ReadonlyMap<string, string> | undefined,
): { keyword: string; translation: string | null } {
  const t = translations?.get(keyword);
  return { keyword, translation: t && t !== '' ? t : null };
}
