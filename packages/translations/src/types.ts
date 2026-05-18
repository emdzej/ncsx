/**
 * Parsed Translations.csv result.
 *
 * `entries` is the dictionary; `lastModified` / `contributors` are pulled from the two
 * special meta rows NCSDummy uses at the top of the file.
 */
export interface TranslationFile {
  /** keyword → English translation. Linear-time lookup; ~26k entries. */
  entries: Map<string, string>;
  /** `LASTMODIFIED,YYYYMMDD` row. `null` if absent or malformed. */
  lastModified: Date | null;
  /** `CONTRIBUTORS,"alice,bob,…"` row, split on commas. Empty if absent. */
  contributors: string[];
}
