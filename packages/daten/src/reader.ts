import { xorFoldCrc } from './crc.js';
import { parseFormatString } from './format-string.js';
import { readRow } from './row.js';
import { Block, DatenFile, FRAME_TYPE, FieldDef, ParseOptions } from './types.js';

interface Frame {
  size: number;
  type: number;
  payload: Uint8Array;
  crc: number;
  /** Offset of the first byte of the frame in the source buffer (for diagnostics). */
  offset: number;
}

function readFrame(buf: Uint8Array, offset: number): Frame {
  const size = buf[offset]!;
  const typeLo = buf[offset + 1]!;
  const typeHi = buf[offset + 2]!;
  const type = typeLo | (typeHi << 8);
  const payload = buf.subarray(offset + 3, offset + 3 + size);
  const crc = buf[offset + 3 + size]!;
  return { size, type, payload, crc, offset };
}

function asciiZ(payload: Uint8Array): string {
  let end = 0;
  while (end < payload.length && payload[end] !== 0x00) end++;
  let s = '';
  for (let i = 0; i < end; i++) s += String.fromCharCode(payload[i]!);
  return s;
}

/**
 * Parse a complete DATEN file (`BR_REF.DAT`, `*.000`, `*.Cxx`, etc.) into the in-memory model.
 *
 * Frame layout: `[size:u8][type:u16 LE][payload:size][crc:u8]`. CRC is XOR-fold over
 * `[size, type_lo, type_hi, payload]`. Layout walks four sections in order:
 *
 *  1. Signature (frame types `0x0100`, `0x0200`).
 *  2. Block definitions — triples of `0x0300` (id+name), `0x0400` (format), `0x0500` (field names).
 *  3. Divider `0xFF00` (empty).
 *  4. Data rows — each frame's `type` is the id of the block it belongs to.
 *
 * Full spec: `docs/daten-format.md`.
 */
export function parseDatenFile(buf: Uint8Array, opts: ParseOptions = {}): DatenFile {
  const { strictCrc = true, onWarning } = opts;
  const warn = (msg: string): void => {
    if (onWarning) onWarning(msg);
  };

  const file: DatenFile = { signatures: [], blocks: [], rowsInOrder: [] };
  let currentBlock: Block | null = null;
  let pendingFormat: ReturnType<typeof parseFormatString> | null = null;
  let off = 0;

  while (off < buf.length) {
    const frame = readFrame(buf, off);
    const frameLength = 3 + frame.size + 1;
    const computedCrc = xorFoldCrc(buf, off, frameLength - 1);
    if (computedCrc !== frame.crc) {
      const msg =
        `CRC mismatch at offset 0x${off.toString(16)} for frame type 0x${frame.type
          .toString(16)
          .padStart(4, '0')}: expected 0x${frame.crc.toString(16)}, got 0x${computedCrc.toString(16)}`;
      if (strictCrc) throw new Error(msg);
      warn(msg);
      off += frameLength;
      continue;
    }

    switch (frame.type) {
      case FRAME_TYPE.SIGNATURE_1:
      case FRAME_TYPE.SIGNATURE_2:
        file.signatures.push({
          type: frame.type,
          payload: Uint8Array.from(frame.payload),
        });
        break;

      case FRAME_TYPE.BLOCK_ID_NAME: {
        // payload = u16 LE id + ASCII name + 0x00
        const id = frame.payload[0]! | (frame.payload[1]! << 8);
        let end = 2;
        while (end < frame.payload.length && frame.payload[end] !== 0x00) end++;
        let name = '';
        for (let i = 2; i < end; i++) name += String.fromCharCode(frame.payload[i]!);
        currentBlock = { id, name, fields: [], rows: [] };
        pendingFormat = null;
        file.blocks.push(currentBlock);
        break;
      }

      case FRAME_TYPE.BLOCK_FORMAT: {
        if (!currentBlock) {
          warn(`format frame at 0x${off.toString(16)} with no open block`);
          break;
        }
        pendingFormat = parseFormatString(asciiZ(frame.payload), warn);
        break;
      }

      case FRAME_TYPE.BLOCK_NAMES: {
        if (!currentBlock) {
          warn(`names frame at 0x${off.toString(16)} with no open block`);
          break;
        }
        if (!pendingFormat) {
          warn(`names frame at 0x${off.toString(16)} with no pending format`);
          break;
        }
        const names = asciiZ(frame.payload).split(',');
        const fields: FieldDef[] = [];
        const max = Math.max(pendingFormat.length, names.length);
        if (pendingFormat.length !== names.length) {
          warn(
            `block "${currentBlock.name}" (#${currentBlock.id}): ${pendingFormat.length} format fields vs ${names.length} names`,
          );
        }
        for (let i = 0; i < max; i++) {
          const shape = pendingFormat[i];
          const name = names[i] ?? `field_${i}`;
          if (!shape) continue;
          fields.push({ ...shape, name });
        }
        currentBlock.fields = fields;
        pendingFormat = null;
        break;
      }

      case FRAME_TYPE.DIVIDER:
        // No-op; data frames follow.
        break;

      default: {
        // Data row — frame.type is the block id.
        const block = file.blocks.find((b) => b.id === frame.type);
        if (!block) {
          warn(
            `data frame at 0x${off.toString(16)} references unknown block id 0x${frame.type
              .toString(16)
              .padStart(4, '0')}`,
          );
          break;
        }
        const values = readRow(block.fields, frame.payload);
        block.rows.push(values);
        file.rowsInOrder.push({ block, values });
      }
    }

    off += frameLength;
  }

  return file;
}
