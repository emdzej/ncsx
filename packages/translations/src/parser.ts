import type { TranslationFile } from './types.js';

/**
 * Parse the NCSDummy `Translations.csv` body into a {@link TranslationFile}. Mirrors
 * NCSDummy's `Classes/Translations/TranslationFileReader.cs` character-by-character:
 *
 *   - First column is the **keyword**, second column is the **translation**.
 *   - Either column may be quoted with `"`. Doubled `""` inside a quoted field is one literal `"`.
 *   - The unquoted separator is `,` *or* `;`. Inside a quoted field both are literal.
 *   - Empty translations are dropped (NCSDummy keeps them out of the lookup).
 *   - Two reserved meta rows: `CONTRIBUTORS,"alice,bob,…"` and `LASTMODIFIED,20190919`.
 *   - Trailing whitespace on the translation is trimmed.
 *
 * The CSV format is ad-hoc — there is no RFC 4180 conformance to assume. This parser is
 * a faithful TypeScript translation of NCSDummy's logic.
 */
export function parseTranslationsCsv(text: string): TranslationFile {
  const entries = new Map<string, string>();
  let lastModified: Date | null = null;
  let contributors: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') continue;
    const cells = parseLine(raw);
    if (cells.length < 2) continue;
    const keyword = cells[0]!;
    const translation = cells[1]!.trim();
    if (keyword === '' || translation === '') continue;

    if (keyword === 'CONTRIBUTORS') {
      contributors = translation.split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (keyword === 'LASTMODIFIED') {
      lastModified = parseYmd(translation);
      continue;
    }
    entries.set(keyword, translation);
  }

  return { entries, lastModified, contributors };
}

/**
 * Split one CSV line into cells using NCSDummy's quoting + separator rules. We only
 * read the first two cells in practice, but the parser surfaces them all so callers can
 * keep extra columns (none exist today; future-proofing is free).
 */
function parseLine(line: string): string[] {
  const cells: string[] = [];
  let buf = '';
  let inQuotes = false;
  let quoteOpenedAtCellStart = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes) {
        // Doubled `""` inside a quoted field is a literal `"`.
        buf += c;
        inQuotes = false;
      } else if (buf === '') {
        quoteOpenedAtCellStart = true;
      } else {
        inQuotes = true;
      }
      continue;
    }
    if ((c === ',' || c === ';') && (inQuotes || !quoteOpenedAtCellStart)) {
      cells.push(buf);
      buf = '';
      quoteOpenedAtCellStart = false;
      inQuotes = false;
      continue;
    }
    inQuotes = false;
    buf += c;
  }
  cells.push(buf);
  return cells;
}

const YMD_RE = /^(\d{4})(\d{2})(\d{2})$/;

function parseYmd(s: string): Date | null {
  const m = YMD_RE.exec(s);
  if (!m) return null;
  const y = Number.parseInt(m[1]!, 10);
  const mo = Number.parseInt(m[2]!, 10);
  const d = Number.parseInt(m[3]!, 10);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}
