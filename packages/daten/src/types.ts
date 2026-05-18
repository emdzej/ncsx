export const FRAME_TYPE = {
  SIGNATURE_1: 0x0100,
  SIGNATURE_2: 0x0200,
  BLOCK_ID_NAME: 0x0300,
  BLOCK_FORMAT: 0x0400,
  BLOCK_NAMES: 0x0500,
  DIVIDER: 0xff00,
} as const;

export type KnownFrameType = (typeof FRAME_TYPE)[keyof typeof FRAME_TYPE];

export const SCALAR_TYPE = {
  BYTE: 'B',
  WORD: 'W',
  LONG: 'L',
  STRING: 'S',
  OPERATION: 'A',
} as const;

export type ScalarType = (typeof SCALAR_TYPE)[keyof typeof SCALAR_TYPE];

/**
 * The kind of a field, derived from the format string.
 * - 'scalar' — one mandatory value of `scalar`.
 * - 'optional' — 1 presence byte, then a value of `scalar` if present.
 * - 'collection' — u16 LE count + that many `scalar` values.
 * - 'non-empty-list' — one mandatory `scalar`, then optional `(scalar)` of more.
 *   Written `X(X)` in the format string.
 * - 'range-list' — one mandatory pair of `scalar`s, then optional `(scalar scalar)` of more.
 *   Written `XX(XX)` in the format string. Decoded values are `[a, b, a, b, ...]`.
 */
export type FieldKind = 'scalar' | 'optional' | 'collection' | 'non-empty-list' | 'range-list';

export interface FieldShape {
  kind: FieldKind;
  scalar: ScalarType;
}

export interface FieldDef extends FieldShape {
  name: string;
}

/**
 * A parsed `A` (length-prefixed variable-bytes) field. On the wire: `u8 length + length bytes`.
 *
 * The *interpretation* of `bytes` depends on the field name:
 *  - `AUFTRAGSAUSDRUCK` (SGET) — byte-coded boolean predicate. See `docs/ecu-selection.md` §6.
 *  - CABD `OPERATION` slots — packed 5-byte entries `(op_char, u32 LE operand)` driving the
 *    `! & * + - / > ^ |` ops on netto bytes. See `docs/daten-format.md` §1.7.
 *  - Other fields — opaque blobs.
 *
 * The parser deliberately returns the raw bytes; semantic interpreters consume them per field name.
 */
export interface RawBytes {
  bytes: Uint8Array;
}

/**
 * Decoded value of one field. Strings and booleans collapse to native JS types; numerics stay number.
 * Optional absent values are `null`. Collections / lists produce arrays.
 */
export type FieldValue =
  | number
  | string
  | RawBytes
  | null
  | Array<number | string | RawBytes>;

export type RowValues = Record<string, FieldValue>;

export interface Block {
  id: number;
  name: string;
  fields: FieldDef[];
  rows: RowValues[];
}

/**
 * One data row paired with its owning block, in document (file) order. Useful for consumers
 * that depend on cross-block adjacency in the binary stream — e.g. CABD's
 * `PARZUWEISUNG_PSW1` rows must follow their parent `PARZUWEISUNG_FSW` row to be paired up.
 *
 * `values` is the same object reference held inside `block.rows`; mutating one affects both.
 */
export interface OrderedRow {
  block: Block;
  values: RowValues;
}

export interface DatenFile {
  signatures: { type: number; payload: Uint8Array }[];
  blocks: Block[];
  /** All data rows in document order. Same row objects as `block.rows`. */
  rowsInOrder: OrderedRow[];
}

export interface ParseOptions {
  /** Stop on CRC mismatch (default `true`). When false, mismatched frames are skipped with a warning. */
  strictCrc?: boolean;
  /** Optional callback for warnings (CRC mismatch, malformed format string, unknown frame type, etc.). */
  onWarning?: (msg: string) => void;
}
