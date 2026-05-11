import { iterLines, tokens } from './lexer.js';

/**
 * One row of `<BR>SGFAM.DAT`. Maps a logical SG short-name to its CABD module + SGBD job
 * module, plus a couple of flags.
 *
 * Format (whitespace-columnar):
 *
 * ```
 * S <SGNAME> <CABD>      <C_SGBD>   <ZCS-flag> <FA-flag>   [comment...]
 * ```
 *
 * The leading `S` marks a real SG-Steuergerät row. Comments use `;`.
 */
export interface SgfamRow {
  sgName: string;
  cabd: string;
  sgbd: string;
  /** `1` if this SG participates in ZCS; `0` otherwise. */
  zcs: number;
  /** `1` if this SG carries FA data; `0` otherwise. */
  fa: number;
  /** Optional trailing free-text columns past the 5 mandatory ones. */
  comment: string;
}

export interface SgfamFile {
  rows: SgfamRow[];
  /** Lines that didn't parse cleanly (handy for diagnostics). */
  unparsed: { lineNo: number; raw: string; reason: string }[];
}

export function parseSgfam(content: string): SgfamFile {
  const rows: SgfamRow[] = [];
  const unparsed: SgfamFile['unparsed'] = [];

  for (const line of iterLines(content)) {
    // Strip `;` comments. SGFAM files never use `;` as a record leader.
    const semi = line.trimmed.indexOf(';');
    const body = (semi === -1 ? line.trimmed : line.trimmed.slice(0, semi)).trim();
    if (body === '') continue;

    const parts = tokens(body);
    if (parts.length < 5 || parts[0] !== 'S') {
      unparsed.push({
        lineNo: line.lineNo,
        raw: line.raw,
        reason: parts[0] !== 'S' ? `expected leading 'S', got '${parts[0] ?? '(empty)'}'` : 'too few columns',
      });
      continue;
    }

    const [, sgName, cabd, sgbd, zcsStr, faStr, ...rest] = parts;
    const zcs = Number(zcsStr);
    const fa = Number(faStr);
    if (!Number.isInteger(zcs) || !Number.isInteger(fa)) {
      unparsed.push({
        lineNo: line.lineNo,
        raw: line.raw,
        reason: `ZCS/FA columns must be integers, got '${zcsStr}'/'${faStr}'`,
      });
      continue;
    }
    rows.push({
      sgName: sgName!,
      cabd: cabd!,
      sgbd: sgbd!,
      zcs,
      fa,
      comment: rest.join(' '),
    });
  }

  return { rows, unparsed };
}
