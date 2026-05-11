import { iterLines, tokens } from './lexer.js';

/**
 * `<BR>AT.M00` is the **compact M-list** — a flat dictionary of FA-token short-codes by
 * category. Used by the FA editor to populate the entry drop-downs.
 *
 * Each record is one line:
 *
 * ```
 * <CATEGORY> <CODE>
 * ```
 *
 * Plus two metadata records:
 * - `DATUM <DD.MM.YYYY>`
 * - `DATEINAME <filename>`
 *
 * Category letters observed:
 *
 * | Letter | Meaning (best-effort from comments) |
 * |--------|-------------------------------------|
 * | `Z`    | Zwang (mandatory marker, value usually `#NNNN`) |
 * | `E`    | Entfällt (fallback / removed)              |
 * | `W`    | Wahl (selectable option, 4-hex code)       |
 * | `S`    | Sonderausstattung (special equipment)      |
 * | other  | Pass-through; kept verbatim                |
 */
export interface AtM00Entry {
  category: string;
  code: string;
}

export interface AtM00File {
  date?: string;
  filename?: string;
  entries: AtM00Entry[];
  unparsed: { lineNo: number; raw: string; reason: string }[];
}

export function parseAtM00(content: string): AtM00File {
  const file: AtM00File = { entries: [], unparsed: [] };

  for (const line of iterLines(content)) {
    const body = line.trimmed.trim();
    if (body === '') continue;
    if (body.startsWith(';') || body.startsWith('//')) continue;

    const parts = tokens(body);
    if (parts.length < 2) {
      file.unparsed.push({ lineNo: line.lineNo, raw: line.raw, reason: 'too few tokens' });
      continue;
    }
    const [head, ...rest] = parts;
    if (head === 'DATUM') {
      file.date = rest.join(' ');
      continue;
    }
    if (head === 'DATEINAME') {
      file.filename = rest.join(' ');
      continue;
    }
    if (head!.length !== 1) {
      file.unparsed.push({
        lineNo: line.lineNo,
        raw: line.raw,
        reason: `expected 1-char category, got '${head}'`,
      });
      continue;
    }
    file.entries.push({ category: head!, code: rest.join(' ') });
  }
  return file;
}
