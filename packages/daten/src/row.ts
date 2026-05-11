import { readScalar } from './scalar.js';
import { FieldDef, FieldValue, RawBytes, RowValues } from './types.js';

/**
 * Decode one data-row payload against the field list of its block.
 *
 * Modifier semantics (matching `docs/daten-format.md` §1.6):
 *
 * | Kind           | Wire layout                                                      |
 * |----------------|-------------------------------------------------------------------|
 * | scalar         | `value`                                                          |
 * | optional       | `u8 present` ; if present, `value`                                |
 * | collection     | `u16 LE count` ; `count × value`                                  |
 * | non-empty-list | `value` (mandatory) ; `u16 LE count` ; `count × value`            |
 * | range-list     | `value value` (mandatory pair) ; `u16 LE count` ; `count × (value value)` |
 */
export function readRow(fields: FieldDef[], payload: Uint8Array): RowValues {
  const out: RowValues = {};
  let off = 0;

  const readU16 = (): number => {
    const lo = payload[off]!;
    const hi = payload[off + 1]!;
    off += 2;
    return lo | (hi << 8);
  };

  for (const field of fields) {
    switch (field.kind) {
      case 'scalar': {
        const r = readScalar(field.scalar, payload, off);
        off += r.length;
        out[field.name] = r.value;
        break;
      }
      case 'optional': {
        const present = payload[off++]!;
        if (present === 0) {
          out[field.name] = null;
        } else {
          const r = readScalar(field.scalar, payload, off);
          off += r.length;
          out[field.name] = r.value;
        }
        break;
      }
      case 'collection': {
        const count = readU16();
        const values: Array<number | string | RawBytes> = [];
        for (let i = 0; i < count; i++) {
          const r = readScalar(field.scalar, payload, off);
          off += r.length;
          values.push(r.value);
        }
        out[field.name] = values as FieldValue;
        break;
      }
      case 'non-empty-list': {
        // mandatory leading element
        const first = readScalar(field.scalar, payload, off);
        off += first.length;
        const count = readU16();
        const values: Array<number | string | RawBytes> = [first.value];
        for (let i = 0; i < count; i++) {
          const r = readScalar(field.scalar, payload, off);
          off += r.length;
          values.push(r.value);
        }
        out[field.name] = values as FieldValue;
        break;
      }
      case 'range-list': {
        // mandatory leading pair
        const a = readScalar(field.scalar, payload, off);
        off += a.length;
        const b = readScalar(field.scalar, payload, off);
        off += b.length;
        const count = readU16();
        const values: Array<number | string | RawBytes> = [a.value, b.value];
        for (let i = 0; i < count; i++) {
          const ra = readScalar(field.scalar, payload, off);
          off += ra.length;
          const rb = readScalar(field.scalar, payload, off);
          off += rb.length;
          values.push(ra.value, rb.value);
        }
        out[field.name] = values as FieldValue;
        break;
      }
    }
  }
  return out;
}
