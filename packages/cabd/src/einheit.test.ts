import { describe, expect, it } from 'vitest';
import { decodeEinheit, encodeEinheit } from './einheit.js';
import { CabdError } from './types.js';

describe('decodeEinheit', () => {
  it("'h' folds bytes as u32 LE", () => {
    expect(decodeEinheit(Uint8Array.from([0x42]), 'h')).toBe(0x42);
    expect(decodeEinheit(Uint8Array.from([0x34, 0x12]), 'h')).toBe(0x1234);
    expect(decodeEinheit(Uint8Array.from([0x78, 0x56, 0x34, 0x12]), 'h')).toBe(0x12345678);
  });

  it("'a' returns the raw first byte", () => {
    expect(decodeEinheit(Uint8Array.from([0x42, 0x00]), 'a')).toBe(0x42);
  });

  it("'A' decodes alphanumeric hex digits", () => {
    expect(decodeEinheit(Uint8Array.from([0x30]), 'A')).toBe(0);   // '0'
    expect(decodeEinheit(Uint8Array.from([0x39]), 'A')).toBe(9);   // '9'
    expect(decodeEinheit(Uint8Array.from([0x41]), 'A')).toBe(10);  // 'A'
    expect(decodeEinheit(Uint8Array.from([0x5a]), 'A')).toBe(35);  // 'Z'
    expect(() => decodeEinheit(Uint8Array.from([0x20]), 'A')).toThrow(CabdError);
  });

  it("'b' folds bit-string chars", () => {
    expect(decodeEinheit(Uint8Array.from([0x31, 0x30, 0x31]), 'b')).toBe(0b101);
  });

  it("'d' parses decimal digits", () => {
    expect(decodeEinheit(Uint8Array.from([0x31, 0x32, 0x33]), 'd')).toBe(123);
  });
});

describe('encodeEinheit', () => {
  it("'h' writes u32 LE bytes", () => {
    expect(Array.from(encodeEinheit(0x12345678, 4, 'h'))).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("'A' writes a single hex/base-36 digit", () => {
    expect(Array.from(encodeEinheit(9, 1, 'A'))).toEqual([0x39]);
    expect(Array.from(encodeEinheit(10, 1, 'A'))).toEqual([0x41]);
    expect(Array.from(encodeEinheit(35, 1, 'A'))).toEqual([0x5a]);
    expect(() => encodeEinheit(36, 1, 'A')).toThrow(CabdError);
  });

  it("'b' writes bit-string chars", () => {
    expect(Array.from(encodeEinheit(0b101, 3, 'b'))).toEqual([0x31, 0x30, 0x31]);
  });

  it("'d' writes decimal digits", () => {
    expect(Array.from(encodeEinheit(42, 2, 'd'))).toEqual([0x34, 0x32]);
  });
});
