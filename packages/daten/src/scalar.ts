import { RawBytes, ScalarType } from './types.js';

export interface ScalarRead<T = number | string | RawBytes> {
  /** Decoded value. */
  value: T;
  /** Number of bytes consumed from the payload. */
  length: number;
}

/**
 * Decode one scalar at `offset` in `payload`. Multi-byte numerics are little-endian.
 *
 * `A` (length-prefixed bytes): wire format is `u8 length` followed by `length` raw bytes. The
 * interpretation of those bytes is *field-name dependent* (see `docs/ecu-selection.md` §6 for
 * `AUFTRAGSAUSDRUCK`; `docs/daten-format.md` §1.7 for CABD `OPERATION` packing).
 *
 * Bug fixed vs. bimmerz POC (`parsers.ts:111-118` returned `length: 1`): that desynced every
 * row containing an `A` field. The real wire format is `u8 length + length bytes`.
 */
export function readScalar(scalar: ScalarType, payload: Uint8Array, offset: number): ScalarRead {
  switch (scalar) {
    case 'B':
      return { value: payload[offset]!, length: 1 };
    case 'W': {
      const lo = payload[offset]!;
      const hi = payload[offset + 1]!;
      return { value: lo | (hi << 8), length: 2 };
    }
    case 'L': {
      const b0 = payload[offset]!;
      const b1 = payload[offset + 1]!;
      const b2 = payload[offset + 2]!;
      const b3 = payload[offset + 3]!;
      return { value: ((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0), length: 4 };
    }
    case 'S': {
      let end = offset;
      while (end < payload.length && payload[end] !== 0x00) end++;
      let value = '';
      for (let i = offset; i < end; i++) value += String.fromCharCode(payload[i]!);
      return { value, length: end - offset + 1 };
    }
    case 'A': {
      const len = payload[offset]!;
      const bytes = Uint8Array.from(payload.subarray(offset + 1, offset + 1 + len));
      const value: RawBytes = { bytes };
      return { value, length: 1 + len };
    }
  }
}
