import { iterLines } from './lexer.js';

/**
 * `<BR>ZST.000` is the **Zentrale Steuerwort-Tabelle** — master mapping of SA/VN/FA codes →
 * (SA-bit-mask, FA-bit-mask, FSW keyword).
 *
 * Lexical conventions:
 * - Pre-amble: comment-style metadata lines starting with `;` plus `I co`, `U <ts>`, `V <name>`.
 * - Section dividers: rows starting with `;*****` decoration only.
 * - Data rows: paradoxically also start with `;` (legacy — to make the file look like a comment
 *   in old editors that scanned by lines). The semantic content is what follows the leading `;`.
 *
 * Data-row columns (positional, whitespace-separated, with optional empty cells):
 *
 * ```
 * ;<SA-code>  [<marker>]  <SA-bit-mask>  <FA-bit-mask>  <FSW-keyword>  [// comment]
 * ```
 *
 * - `<SA-code>` — 4-digit short-code (e.g. `0902`)
 * - `<marker>` — optional secondary key (e.g. `N0301`, `V0301`, `BFD`, `225`)
 * - `<SA-bit-mask>` — 16 hex chars (64-bit mask, little-endian byte order in the file). The
 *   bit position this SA code occupies in the ASW vector.
 * - `<FA-bit-mask>` — 10 hex chars (40-bit secondary). Used for the "Hex-extra"/ZCS-fragment
 *   slot.
 * - `<FSW-keyword>` — the function-keyword that this row contributes to (e.g. `DAUERTON`,
 *   `MILANSTEUERUNG`). May be empty.
 *
 * Hidden rows (`;H ...`) are kept as `kind: 'hidden'` for completeness.
 */
export interface ZstHeader {
  tabelle?: string;
  index?: string;
  vom?: string;
  nael?: string;
  timestamp?: string;
  filename?: string;
}

export interface ZstRecord {
  kind: 'regular' | 'hidden';
  /** 4-digit SA/VN code, or empty for ASW-only rows. */
  saCode: string;
  /** Optional secondary marker (`N0301`, `V0301`, `BFD`, `225`, etc.). */
  marker: string;
  /** 16-hex-char SA-bit-mask (left-justified) — 64-bit. */
  saMask: string;
  /** 10-hex-char FA-bit-mask — 40-bit. */
  faMask: string;
  /** Function-keyword (FSW) name this row contributes to. */
  fsw: string;
  /** Trailing `// comment`. */
  comment: string;
  /** Source line number. */
  lineNo: number;
}

export interface ZstFile {
  header: ZstHeader;
  records: ZstRecord[];
  unparsed: { lineNo: number; raw: string; reason: string }[];
}

/** Matches a 16-hex-char SA mask token. */
const SA_MASK_RE = /^[0-9A-Fa-f]{16}$/;
/** Matches a 10-hex-char FA mask token. */
const FA_MASK_RE = /^[0-9A-Fa-f]{10}$/;

export function parseZst(content: string): ZstFile {
  const header: ZstHeader = {};
  const records: ZstRecord[] = [];
  const unparsed: ZstFile['unparsed'] = [];

  for (const line of iterLines(content)) {
    const raw = line.trimmed;
    const tr = raw.trim();
    if (tr === '') continue;

    // Header records first.
    if (tr.startsWith(';Tabelle:')) {
      // ;Tabelle: <name>   Index: <idx>  vom: <date>  NAEL: <doc>
      const m = tr.match(/;Tabelle:\s*(\S+)\s+Index:\s*(\S+)\s+vom:\s*(\S+)\s+NAEL:\s*(\S+)/);
      if (m) {
        header.tabelle = m[1];
        header.index = m[2];
        header.vom = m[3];
        header.nael = m[4];
      }
      continue;
    }
    if (/^I\s+\S+$/.test(tr)) {
      header.index ??= tr.split(/\s+/)[1];
      continue;
    }
    if (/^U\s+\d{14}$/.test(tr)) {
      header.timestamp = tr.split(/\s+/)[1];
      continue;
    }
    if (/^V\s+\S+/.test(tr)) {
      header.filename = tr.split(/\s+/)[1];
      continue;
    }

    // Decoration-only rows (e.g. `;************`).
    if (/^;\s*\*+\s*$/.test(tr) || /^;\s*\*/.test(tr.split(/[^*]/)[0] ?? '')) continue;
    // Free-text comment rows that don't contain a SA-mask token.
    if (!tr.startsWith(';') && !/^[A-Z]/.test(tr)) continue;

    // A data row starts with `;`, then has SA-code or empty SA-code slot, then masks.
    // Strategy: find the first 16-hex-char token in the line; everything left of it is
    // (SA-code, optional marker); everything right is (FA-mask, FSW, ...).
    let payload = tr.startsWith(';H') ? tr.slice(2) : tr.startsWith(';') ? tr.slice(1) : tr;
    payload = payload.trimStart();
    const tokens = payload.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length < 2) continue;

    const maskIdx = tokens.findIndex((t) => SA_MASK_RE.test(t));
    if (maskIdx === -1) {
      // No SA-mask token on this line — treat as comment / pre-amble.
      continue;
    }
    const left = tokens.slice(0, maskIdx);
    const saMask = tokens[maskIdx]!;
    const right = tokens.slice(maskIdx + 1);
    const faMask = right[0] && FA_MASK_RE.test(right[0]) ? right[0] : '';
    const fsw = (faMask ? right[1] : right[0]) ?? '';
    const kind: ZstRecord['kind'] = tr.startsWith(';H') ? 'hidden' : 'regular';

    records.push({
      kind,
      saCode: left[0] ?? '',
      marker: left.slice(1).join(' '),
      saMask,
      faMask,
      fsw,
      comment: line.comment,
      lineNo: line.lineNo,
    });
  }

  if (records.length === 0 && unparsed.length === 0) {
    // Surface the case of "we read the file but found nothing recognisable" as a soft warning.
  }
  return { header, records, unparsed };
}
