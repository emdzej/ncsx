import { describe, expect, it } from 'vitest';
import type { FunctionItem, Parameter } from './types.js';
import { applyPswToNetto, decodeCurrentPsw } from './decode.js';

/**
 * Two-byte FSW at offset 4 with mask `0xFF 0x0F` — owns the whole low nibble of byte 5
 * but not the high nibble (which a sibling FSW would own).
 */
function fixture(): { fn: FunctionItem; off: Parameter; on: Parameter } {
  const off: Parameter = {
    psw: 0x00,
    pswKeyword: 'nicht_aktiv',
    data: Uint8Array.from([0x00, 0x00]),
  };
  const on: Parameter = {
    psw: 0x01,
    pswKeyword: 'aktiv',
    data: Uint8Array.from([0xa5, 0x03]),
  };
  const fn: FunctionItem = {
    kind: 'function',
    fsw: 0x025f,
    fswKeyword: 'KEYCARDREADER',
    block: 0,
    address: 4,
    length: 2,
    mask: Uint8Array.from([0xff, 0x0f]),
    parameters: [off, on],
  };
  return { fn, off, on };
}

describe('decodeCurrentPsw', () => {
  it('matches the all-zeros PSW against a fresh buffer', () => {
    const { fn, off } = fixture();
    const netto = new Uint8Array(8);
    expect(decodeCurrentPsw(fn, netto)).toBe(off);
  });

  it("matches the active PSW when the FSW's masked bytes line up", () => {
    const { fn, on } = fixture();
    const netto = new Uint8Array(8);
    netto[4] = 0xa5;
    netto[5] = 0x03;
    expect(decodeCurrentPsw(fn, netto)).toBe(on);
  });

  it('ignores bits outside the mask — sibling FSW changes do not flip our decode', () => {
    const { fn, on } = fixture();
    const netto = new Uint8Array(8);
    netto[4] = 0xa5;
    netto[5] = 0xf3; // high nibble owned by sibling FSW; should be ignored
    expect(decodeCurrentPsw(fn, netto)).toBe(on);
  });

  it("returns null when no PSW's masked bytes match (custom/unknown coding)", () => {
    const { fn } = fixture();
    const netto = new Uint8Array(8);
    netto[4] = 0xc0;
    netto[5] = 0x09;
    expect(decodeCurrentPsw(fn, netto)).toBe(null);
  });

  it('returns null when the buffer is too short to cover the FSW slot', () => {
    const { fn } = fixture();
    const netto = new Uint8Array(4); // address=4, length=2 needs at least 6 bytes
    expect(decodeCurrentPsw(fn, netto)).toBe(null);
  });
});

describe('applyPswToNetto', () => {
  it('writes the PSW data into the FSW slot, preserving out-of-mask bits', () => {
    const { fn, on } = fixture();
    const netto = new Uint8Array(8);
    netto[5] = 0xf0; // sibling FSW's high nibble
    const out = applyPswToNetto(fn, on, netto);
    expect(out[4]).toBe(0xa5);
    expect(out[5]).toBe(0xf3); // high nibble preserved, low nibble overwritten
  });

  it('does not mutate the input buffer', () => {
    const { fn, on } = fixture();
    const netto = new Uint8Array(8);
    const copy = Uint8Array.from(netto);
    applyPswToNetto(fn, on, netto);
    expect(Array.from(netto)).toEqual(Array.from(copy));
  });

  it('round-trips: apply then decode returns the same Parameter', () => {
    const { fn, on } = fixture();
    const after = applyPswToNetto(fn, on, new Uint8Array(8));
    expect(decodeCurrentPsw(fn, after)).toBe(on);
  });

  it('pads the output when the input is shorter than address+length', () => {
    const { fn, on } = fixture();
    const out = applyPswToNetto(fn, on, new Uint8Array(2));
    expect(out.length).toBe(6);
    expect(out[4]).toBe(0xa5);
    expect(out[5]).toBe(0x03);
  });

  it('rejects a Parameter that does not belong to this FunctionItem', () => {
    const { fn } = fixture();
    const stranger: Parameter = { psw: 0x99, pswKeyword: 'x', data: Uint8Array.from([0, 0]) };
    expect(() => applyPswToNetto(fn, stranger, new Uint8Array(8))).toThrow(
      /not a member/,
    );
  });
});
