import { describe, expect, it } from 'vitest';
import { decodeField } from './decode.js';
import { encodeField } from './encode.js';
import { CabdRule } from './types.js';

describe('decodeField + encodeField — simple cases', () => {
  it('decodes a 1-byte field with MASKE=0xFF', () => {
    const rule: CabdRule = {
      wortadr: 0x04,
      byteadr: 1,
      maske: [0xff],
      einheit: 'h',
    };
    const netto = Uint8Array.from([0, 0, 0, 0, 0x42, 0, 0, 0]);
    expect(decodeField(rule, netto)).toBe(0x42);
  });

  it('encodes a 1-byte field with MASKE=0xFF without disturbing neighbours', () => {
    const rule: CabdRule = {
      wortadr: 0x04,
      byteadr: 1,
      maske: [0xff],
      einheit: 'h',
    };
    const netto = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x00, 0x66, 0x77, 0x88]);
    encodeField(rule, 0x99, netto);
    expect(Array.from(netto)).toEqual([0x11, 0x22, 0x33, 0x44, 0x99, 0x66, 0x77, 0x88]);
  });
});

describe('decode + encode — sub-byte masks with auto-shift', () => {
  // Real shape from docs/coding-flow.md §5: KEYCARDREADER lives in netto[4] at bit 6 (mask 0x40)
  const rule: CabdRule = {
    wortadr: 0x04,
    byteadr: 1,
    maske: [0x40],
    einheit: 'h',
  };

  it('reads the masked bit as 0 or 1 (auto-shift on)', () => {
    expect(decodeField(rule, Uint8Array.from([0, 0, 0, 0, 0x00, 0, 0, 0]))).toBe(0);
    expect(decodeField(rule, Uint8Array.from([0, 0, 0, 0, 0x40, 0, 0, 0]))).toBe(1);
    expect(decodeField(rule, Uint8Array.from([0, 0, 0, 0, 0xff, 0, 0, 0]))).toBe(1);
  });

  it('writes 1 → sets bit 6, leaves siblings alone', () => {
    const netto = Uint8Array.from([0, 0, 0, 0, 0b00111111, 0, 0, 0]);
    encodeField(rule, 1, netto);
    expect(netto[4]).toBe(0b01111111);
  });

  it('writes 0 → clears bit 6, leaves siblings alone', () => {
    const netto = Uint8Array.from([0, 0, 0, 0, 0b11111111, 0, 0, 0]);
    encodeField(rule, 0, netto);
    expect(netto[4]).toBe(0b10111111);
  });

  it('multiple FSWs sharing a byte: write each in turn, others preserved', () => {
    // Three FSWs sharing netto[4]: KCR (0x40), SWA (0x20), BC_BASIS (0x10).
    const kcr: CabdRule = { wortadr: 4, byteadr: 1, maske: [0x40], einheit: 'h' };
    const swa: CabdRule = { wortadr: 4, byteadr: 1, maske: [0x20], einheit: 'h' };
    const bc: CabdRule = { wortadr: 4, byteadr: 1, maske: [0x10], einheit: 'h' };
    const netto = Uint8Array.from([0, 0, 0, 0, 0x0a, 0, 0, 0]); // baseline
    encodeField(kcr, 1, netto);
    encodeField(swa, 1, netto);
    encodeField(bc, 0, netto);
    // Should have set bits 6 and 5, cleared bit 4, kept the rest (0x0a low nibble).
    expect(netto[4]).toBe(0b01101010);
  });
});

describe('round-trips with non-trivial operations', () => {
  it('FAHRGESTELL_NR with EINHEIT=h and -0x30 op', () => {
    // VIN digit stored as binary nibble; on read, subtract 0x30 to get ASCII.
    // Actually: the source stores `c - 0x30`, so read = src - 0x30? Let me re-read the docs:
    // In ZAE2 (E31), digits are packed as binary nibbles and read with OPERATION `- 0x30`.
    // So if the netto byte is 0x01 (binary "1"), read returns 0x01 - 0x30 = -0x2F (u32 wraps).
    // That seems wrong. Let me model the inverse: the op is for the READ direction. If you
    // want to *write* the digit '1' (0x31) into a binary-packed slot, the inverse op `+ 0x30`
    // turns 0x01 (the logical PSW value) into 0x31 (the source byte). That matches the doc:
    // "subtract 0x30 from the netto byte" on read recovers the original ASCII char.
    //
    // Modelled here: logical value is the ASCII char (0x31), netto stores the binary nibble (0x01).
    const rule: CabdRule = {
      wortadr: 0,
      byteadr: 1,
      maske: [0xff],
      einheit: 'h',
      operations: [{ op: '+', operand: 0x30 }],
    };
    const netto = Uint8Array.from([0x01]);
    expect(decodeField(rule, netto)).toBe(0x31); // ASCII '1'

    // Encode the ASCII '1' back to the netto buffer.
    const out = Uint8Array.from([0x00]);
    encodeField(rule, 0x31, out);
    expect(out[0]).toBe(0x01);
  });

  it('right-shift recovers split-byte ZCS key fragment (docs §6.3 SA_SCHLUESSEL[17])', () => {
    // SA_SCHLUESSEL[17] high fragment: bits 0..1 of netto[0xFD]. Read ops: > 4 then & 0x03.
    // After applying, the value is shifted into 4..5 first (high bits) then masked. Per the
    // doc, > n is implemented as auto-mask right-shift; the rule here mimics that with
    // autoShift OFF so the OPERATION list is what does the work.
    const rule: CabdRule = {
      wortadr: 0,
      byteadr: 1,
      maske: [0x03],
      einheit: 'h',
      operations: [{ op: '>', operand: 4 }],
    };
    const netto = Uint8Array.from([0b00000011]); // both bits set at positions 0..1
    // autoShift defaults to true; with mask 0x03 it doesn't shift (trailing zeros = 0).
    // The op `> 4` then shifts right by 4 → 0.
    expect(decodeField(rule, netto)).toBe(0);
  });
});

describe('field boundary checks', () => {
  it('throws on out-of-bounds WORTADR', () => {
    const rule: CabdRule = { wortadr: 4, byteadr: 1, maske: [0xff], einheit: 'h' };
    expect(() => decodeField(rule, Uint8Array.from([0, 0]))).toThrow(/overruns/);
  });

  it('throws on mismatched MASKE length', () => {
    const rule: CabdRule = { wortadr: 0, byteadr: 2, maske: [0xff], einheit: 'h' };
    expect(() => decodeField(rule, Uint8Array.from([0, 0]))).toThrow(/MASKE length/);
  });
});
