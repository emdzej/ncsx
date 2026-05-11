/**
 * Common lexical utilities for the DATEN text-table family.
 *
 * - Encoding: ISO-8859-1 (Latin-1). Pass raw text already decoded as Latin-1.
 * - Line endings: CRLF or LF (both accepted).
 * - Comments: `//` ("AT family", C++ style) or `;` ("ZST/SGFAM family", classic INI style).
 *   The two styles can coexist on the same line; the parser strips both.
 * - Some tables use `;` as both line-comment AND record-leader (legacy ZST rows are written
 *   `;<SA-code>` to make the file look like a comment in old editors). Per-parser handling
 *   decides whether `;` introduces a comment or a data record.
 */
export interface TextLine {
  /** 1-based line number in the source. */
  lineNo: number;
  /** Original line content (CRLF stripped). */
  raw: string;
  /** Line content with all `//` comments and trailing whitespace stripped. */
  trimmed: string;
  /** Trailing `//` comment text (without the leader), or `''` if none. */
  comment: string;
}

const stripCrlf = (line: string): string =>
  line.endsWith('\r') ? line.slice(0, -1) : line;

/**
 * Iterate over text lines. Each yielded line has its trailing `//` comment split off
 * and the result trimmed of trailing whitespace.
 */
export function* iterLines(text: string): Generator<TextLine> {
  const rows = text.split(/\n/);
  for (let i = 0; i < rows.length; i++) {
    const raw = stripCrlf(rows[i]!);
    const cIdx = raw.indexOf('//');
    const body = cIdx === -1 ? raw : raw.slice(0, cIdx);
    const comment = cIdx === -1 ? '' : raw.slice(cIdx + 2).trim();
    yield { lineNo: i + 1, raw, trimmed: body.replace(/\s+$/, ''), comment };
  }
}

/**
 * Split a line on whitespace into non-empty tokens.
 */
export function tokens(s: string): string[] {
  return s.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Trim ASCII leading whitespace only.
 */
export function lstrip(s: string): string {
  return s.replace(/^[ \t]+/, '');
}
