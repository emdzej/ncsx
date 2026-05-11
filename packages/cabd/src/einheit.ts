import { CabdError, Einheit } from './types.js';

/**
 * Fold `bytes` (LSB-aligned source-byte sequence) into a logical numeric value using
 * the row's EINHEIT character. Matches the switch in NCSEXPER's `GetDataFromOperation`
 * (`FUN_004575c0`, `CBD_READ.C`).
 */
export function decodeEinheit(bytes: Uint8Array, einheit: Einheit): number {
  switch (einheit) {
    case 'h': {
      // Raw little-endian bytes.
      let v = 0;
      for (let i = 0; i < bytes.length; i++) v |= bytes[i]! << (8 * i);
      return v >>> 0;
    }
    case 'a': {
      // Raw ASCII byte (only first byte is meaningful for width=1).
      return bytes[0] ?? 0;
    }
    case 'A': {
      // ASCII alphanumeric hex digit (0-9 or A-Z) → 0..35.
      const c = bytes[0] ?? 0;
      if (c >= 0x30 && c <= 0x39) return c - 0x30;
      if (c >= 0x41 && c <= 0x5a) return c - 0x37;
      throw new CabdError(`einheit 'A': non-alnum source byte 0x${c.toString(16)}`);
    }
    case 'b': {
      // Bit-string: each char '0'/'1' contributes (c-'0') << position.
      let v = 0;
      for (let i = 0; i < bytes.length; i++) {
        v |= (bytes[i]! - 0x30) << i;
      }
      return v >>> 0;
    }
    case 'd': {
      // Decimal digits.
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return parseInt(s, 10) || 0;
    }
  }
}

/**
 * Inverse: format `value` back into `byteadr` source bytes per EINHEIT. Used during encode
 * before MASKE splice.
 */
export function encodeEinheit(value: number, byteadr: number, einheit: Einheit): Uint8Array {
  const out = new Uint8Array(byteadr);
  switch (einheit) {
    case 'h': {
      for (let i = 0; i < byteadr; i++) out[i] = (value >>> (8 * i)) & 0xff;
      return out;
    }
    case 'a': {
      out[0] = value & 0xff;
      return out;
    }
    case 'A': {
      if (value < 10) out[0] = 0x30 + value;
      else if (value < 36) out[0] = 0x37 + value;
      else throw new CabdError(`einheit 'A': value ${value} out of range [0, 35]`);
      return out;
    }
    case 'b': {
      for (let i = 0; i < byteadr; i++) out[i] = 0x30 + ((value >>> i) & 1);
      return out;
    }
    case 'd': {
      const s = String(value);
      for (let i = 0; i < byteadr; i++) out[i] = s.charCodeAt(i) || 0x30;
      return out;
    }
  }
}
