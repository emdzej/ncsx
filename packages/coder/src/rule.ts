import type { CabdRule, Einheit, Operation } from '@emdzej/ncsx-cabd';
import type { Block, DatenFile, RawBytes, RowValues } from '@emdzej/ncsx-daten';

const PARZ_BLOCK_NAMES = ['PARZUWEISUNG_FSW', 'PARZUWEISUNG_FSW1'] as const;

const isRawBytes = (v: unknown): v is RawBytes =>
  typeof v === 'object' && v !== null && 'bytes' in v;

const VALID_EINHEIT = new Set<string>(['A', 'a', 'b', 'd', 'h']);

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined;

const asByteArray = (v: unknown): number[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== 'number') return undefined;
    out.push(x & 0xff);
  }
  return out;
};

/**
 * Parse the OPERATION list packed inside a CABD `A`-field's content (5-byte tuples).
 * Documented in `docs/daten-format.md` §1.7.
 */
function parseOperationList(bytes: Uint8Array): Operation[] {
  const ops: Operation[] = [];
  for (let i = 0; i + 5 <= bytes.length; i += 5) {
    const op = String.fromCharCode(bytes[i]!);
    const operand =
      ((bytes[i + 1]! |
        (bytes[i + 2]! << 8) |
        (bytes[i + 3]! << 16) |
        (bytes[i + 4]! << 24)) >>>
        0);
    switch (op) {
      case '!':
        ops.push({ op });
        break;
      case '&':
      case '*':
      case '+':
      case '-':
      case '/':
      case '>':
      case '^':
      case '|':
        ops.push({ op, operand });
        break;
      default:
        // Unknown op char — skip silently. The CABD layer will throw on apply if reached.
        break;
    }
  }
  return ops;
}

/** Find the PARZUWEISUNG_FSW (or PARZUWEISUNG_FSW1) block in a CABD file. */
export function findParzuweisung(cabd: DatenFile): Block | undefined {
  for (const name of PARZ_BLOCK_NAMES) {
    const b = cabd.blocks.find((x) => x.name === name);
    if (b) return b;
  }
  return undefined;
}

/**
 * Build a {@link CabdRule} from one PARZUWEISUNG_FSW row.
 *
 * Returns `undefined` if any required field (WORTADR, BYTEADR, FSW, MASKE) is missing or
 * malformed.
 */
export function ruleFromRow(row: RowValues): CabdRule | undefined {
  const wortadr = asNumber(row.WORTADR);
  const byteadr = asNumber(row.BYTEADR);
  const maske = asByteArray(row.MASKE);
  if (wortadr === undefined || byteadr === undefined || !maske) return undefined;
  if (maske.length !== byteadr) return undefined;

  const einheitByte = asNumber(row.EINHEIT);
  const einheit =
    einheitByte !== undefined && VALID_EINHEIT.has(String.fromCharCode(einheitByte))
      ? (String.fromCharCode(einheitByte) as Einheit)
      : 'h';

  // OPERATION list may live in an `A` field named `OPERATION` (if the row spec has one) —
  // but typically the operation list is its own block in the CABD. For now, look at the
  // current row for an embedded operation list; we'll layer richer resolution in a later
  // pass when the SA_SCHLUESSEL split-byte case is exercised.
  const opField = row.OPERATION;
  const operations: Operation[] = isRawBytes(opField) ? parseOperationList(opField.bytes) : [];

  return { wortadr, byteadr, maske, einheit, operations };
}

/**
 * Index PARZUWEISUNG_FSW rows by FSW id. When the same FSW appears multiple times (indexed
 * fields), the value is a list ordered by row appearance.
 */
export function indexFsws(block: Block): Map<number, RowValues[]> {
  const out = new Map<number, RowValues[]>();
  for (const row of block.rows) {
    const fsw = asNumber(row.FSW);
    if (fsw === undefined) continue;
    const list = out.get(fsw);
    if (list) list.push(row);
    else out.set(fsw, [row]);
  }
  return out;
}

/**
 * Compute the minimum netto buffer length that fits every WORTADR+BYTEADR pair in a block.
 */
export function computeNettoSize(block: Block): number {
  let size = 0;
  for (const row of block.rows) {
    const wortadr = asNumber(row.WORTADR);
    const byteadr = asNumber(row.BYTEADR);
    if (wortadr === undefined || byteadr === undefined) continue;
    const end = wortadr + byteadr;
    if (end > size) size = end;
  }
  return size;
}
