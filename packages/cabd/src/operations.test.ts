import { describe, expect, it } from 'vitest';
import {
  applyOperation,
  applyOperationsRead,
  applyOperationsWrite,
  invertOperation,
} from './operations.js';
import { CabdError } from './types.js';

describe('applyOperation', () => {
  it('! inverts u32', () => {
    expect(applyOperation(0x55555555, { op: '!' })).toBe(0xaaaaaaaa);
    expect(applyOperation(0, { op: '!' })).toBe(0xffffffff);
  });

  it('& / | / ^', () => {
    expect(applyOperation(0xff00, { op: '&', operand: 0x0ff0 })).toBe(0x0f00);
    expect(applyOperation(0xff00, { op: '|', operand: 0x0001 })).toBe(0xff01);
    expect(applyOperation(0xff00, { op: '^', operand: 0xff00 })).toBe(0x0000);
  });

  it('+ / -', () => {
    expect(applyOperation(0x10, { op: '+', operand: 0x05 })).toBe(0x15);
    expect(applyOperation(0x43, { op: '-', operand: 0x30 })).toBe(0x13);
  });

  it('* / /', () => {
    expect(applyOperation(7, { op: '*', operand: 3 })).toBe(21);
    expect(applyOperation(20, { op: '/', operand: 4 })).toBe(5);
    expect(() => applyOperation(1, { op: '/', operand: 0 })).toThrow(CabdError);
  });

  it('> right-shifts with auto-mask', () => {
    expect(applyOperation(0xff, { op: '>', operand: 4 })).toBe(0x0f);
    expect(applyOperation(0x40, { op: '>', operand: 6 })).toBe(0x01);
  });
});

describe('applyOperationsRead / applyOperationsWrite — round-trip', () => {
  it('round-trips a single + n op', () => {
    const ops = [{ op: '+', operand: 0x05 } as const];
    const v = 0x20;
    const r = applyOperationsRead(v, ops);
    const w = applyOperationsWrite(r, ops);
    expect(w).toBe(v);
  });

  it('round-trips an N-shift + mask chain', () => {
    const ops = [
      { op: '>', operand: 4 } as const,
      { op: '&', operand: 0x0f } as const,
    ];
    const v = 0x3a;
    const r = applyOperationsRead(v, ops);
    // 0x3a >> 4 = 0x03, & 0x0f = 0x03
    expect(r).toBe(0x03);
    // Inverse: <<4 then & is involutive — `applyOperationsWrite` does ops reversed with each inverted.
    // & stays as &, * is the inverse of >. So we get 3 & 0x0f = 3, then 3 * 16 = 48 = 0x30.
    const w = applyOperationsWrite(r, ops);
    expect(w).toBe(0x30);
  });

  it('round-trips a sequence with ! (self-inverse)', () => {
    const ops = [{ op: '!' } as const];
    expect(applyOperationsWrite(applyOperationsRead(0x42, ops), ops)).toBe(0x42);
  });
});

describe('invertOperation', () => {
  it('returns the right inverse for each op', () => {
    expect(invertOperation({ op: '!' })).toEqual({ op: '!' });
    expect(invertOperation({ op: '+', operand: 5 })).toEqual({ op: '-', operand: 5 });
    expect(invertOperation({ op: '-', operand: 5 })).toEqual({ op: '+', operand: 5 });
    expect(invertOperation({ op: '*', operand: 4 })).toEqual({ op: '/', operand: 4 });
    expect(invertOperation({ op: '/', operand: 4 })).toEqual({ op: '*', operand: 4 });
    expect(invertOperation({ op: '>', operand: 4 })).toEqual({ op: '*', operand: 16 });
    expect(invertOperation({ op: '&', operand: 0x0f })).toEqual({ op: '&', operand: 0x0f });
    expect(invertOperation({ op: '|', operand: 0x10 })).toEqual({ op: '|', operand: 0x10 });
    expect(invertOperation({ op: '^', operand: 0x20 })).toEqual({ op: '^', operand: 0x20 });
  });
});
