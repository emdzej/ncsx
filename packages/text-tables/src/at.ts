import { iterLines } from './lexer.js';

/**
 * `<BR>AT.000` is the **Auftragsdatei** — the canonical FA-token dictionary for a chassis.
 *
 * After a long header block (filename, change log) the file contains records of the form:
 *
 * ```
 * <type-letter> <code>     <FSW-tokens...>          // optional comment
 * ```
 *
 * Examples:
 *
 * ```
 * W 488                                                                  //Lordosenstuetze
 * W 502                   SWA                                            //Scheinwerfer-Waschanlage
 * W 524                   ALC XENON                                      //Lichtautomatik
 * S 230                                                                  //Special equipment 230
 * ```
 *
 * The first character is the category (1-char), followed by a 3- or 4-character code. Any
 * whitespace-separated tokens before the trailing `//` comment are **FSW keywords** that get
 * set when the FA contains this code.
 */
export interface AtRecord {
  /** Category letter (W, S, E, Z, …). */
  category: string;
  /** SA/FA code (3-4 characters; hex digits or letters). */
  code: string;
  /** FSW keywords this code activates. Order preserved. */
  fsws: string[];
  /** Trailing `//` comment, if any. */
  comment: string;
}

export interface AtFile {
  /** Top-of-file `DATUM <date>` (if present). */
  date?: string;
  records: AtRecord[];
  unparsed: { lineNo: number; raw: string; reason: string }[];
}

const CATEGORY_LETTERS = new Set(['W', 'S', 'E', 'Z', 'H', 'V']);

export function parseAt(content: string): AtFile {
  const file: AtFile = { records: [], unparsed: [] };

  for (const line of iterLines(content)) {
    const body = line.trimmed.trim();
    if (body === '') continue;

    // Take DATUM as metadata if it appears bare.
    if (body.startsWith('DATUM ')) {
      file.date = body.slice('DATUM '.length).trim();
      continue;
    }

    // Skip `//` comment-only lines (iterLines already stripped trailing `//`, so a body
    // starting after a `//` strip means the line was all-comment — `body` will be empty).
    // Skip lines starting with `;` — none observed in AT, but be defensive.
    if (body.startsWith(';')) continue;

    // Records start with a single-letter category followed by whitespace.
    const m = body.match(/^([A-Z])\s+(\S+)\s*(.*)$/);
    if (!m) {
      // Not a data record (probably a header / continuation comment).
      continue;
    }
    const [, category, code, rest] = m;
    if (!CATEGORY_LETTERS.has(category!)) {
      // Unknown leading letter — treat as commentary and skip rather than flag.
      continue;
    }
    const fsws = rest!.split(/\s+/).filter((t) => t.length > 0);
    file.records.push({
      category: category!,
      code: code!,
      fsws,
      comment: line.comment,
    });
  }

  return file;
}
