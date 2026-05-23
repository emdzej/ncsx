import { describe, expect, it } from 'vitest';
import { parseDatenFile, xorFoldCrc } from '@emdzej/ncsx-daten';
import { buildOptionList } from './builder.js';

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

function frame(type: number, payload: ArrayLike<number>): Uint8Array {
  const size = payload.length;
  const head = Uint8Array.from([size, type & 0xff, (type >> 8) & 0xff, ...Array.from(payload)]);
  const crc = xorFoldCrc(head);
  return Uint8Array.from([...head, crc]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const SIGS = [
  frame(0x0100, [0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]),
  frame(0x0200, [0x02]),
];

const BLOCK_DEF = (id: number, name: string, format: string, names: string): Uint8Array[] => [
  frame(0x0300, [id & 0xff, (id >> 8) & 0xff, ...ascii(name), 0x00]),
  frame(0x0400, [...ascii(format), 0x00]),
  frame(0x0500, [...ascii(names), 0x00]),
];

const DIVIDER = frame(0xff00, []);

const ID_GRUPPE = 0x0001;
const ID_INDIVID = 0x0002;
const ID_AUFTRAG = 0x0003;
const ID_FSW_PSW = 0x0004;

const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
/** `A` field on the wire is u8 length + bytes. */
const aField = (bs: number[]): number[] => [bs.length, ...bs];

function buildCvt(): Uint8Array {
  const defs = [
    ...BLOCK_DEF(ID_GRUPPE, 'GRUPPE', 'S', 'NAME'),
    ...BLOCK_DEF(ID_INDIVID, 'INDIVID', 'S', 'NAME'),
    ...BLOCK_DEF(ID_AUFTRAG, 'AUFTRAGSAUSDRUCK', 'A', 'PREDICATE'),
    ...BLOCK_DEF(ID_FSW_PSW, 'FSW_PSW', 'WW', 'FSW,PSW'),
  ];

  return concat(
    ...SIGS,
    ...defs,
    DIVIDER,

    // Enter group scope
    frame(ID_GRUPPE, [...ascii('GRP'), 0x00]),

    // AUFTRAGSAUSDRUCK [0x01, 0x02] precedes FSW_PSW(fsw=0x100, psw=0x200)
    frame(ID_AUFTRAG, aField([0x01, 0x02])),
    frame(ID_FSW_PSW, [...u16(0x100), ...u16(0x200)]),

    // Another AUFTRAGSAUSDRUCK [0x03] precedes FSW_PSW(fsw=0x100, psw=0x201)
    frame(ID_AUFTRAG, aField([0x03])),
    frame(ID_FSW_PSW, [...u16(0x100), ...u16(0x201)]),

    // No AUFTRAGSAUSDRUCK before this one → empty predicate
    frame(ID_FSW_PSW, [...u16(0x101), ...u16(0x300)]),

    // Two AUFTRAGSAUSDRUCK fragments accumulate via comma-join for the same (fsw, psw):
    // First fragment: [0xAA]
    frame(ID_AUFTRAG, aField([0xaa])),
    frame(ID_FSW_PSW, [...u16(0x100), ...u16(0x200)]),

    // Enter individual scope — anything here should be skipped
    frame(ID_INDIVID, [...ascii('IND'), 0x00]),
    frame(ID_AUFTRAG, aField([0xff])),
    frame(ID_FSW_PSW, [...u16(0x100), ...u16(0x999)]),

    // Back to group scope
    frame(ID_GRUPPE, [...ascii('GRP2'), 0x00]),
    frame(ID_FSW_PSW, [...u16(0x102), ...u16(0x400)]),
  );
}

describe('buildOptionList', () => {
  const cvt = parseDatenFile(buildCvt());

  it('returns one OptionFunction per distinct FSW, in encounter order', () => {
    const list = buildOptionList(cvt);
    expect(list.functions.map((f) => f.fsw)).toEqual([0x100, 0x101, 0x102]);
  });

  it('pairs AUFTRAGSAUSDRUCK with the next FSW_PSW', () => {
    const list = buildOptionList(cvt);
    const fn = list.functions.find((f) => f.fsw === 0x100)!;
    const p200 = fn.parameters.find((p) => p.psw === 0x200)!;
    const p201 = fn.parameters.find((p) => p.psw === 0x201)!;
    // p200 was seen twice (once with [0x01,0x02], once with [0xAA]); fragments comma-joined
    expect(Array.from(p200.predicate)).toEqual([0x01, 0x02, 0x2c, 0xaa]);
    expect(Array.from(p201.predicate)).toEqual([0x03]);
  });

  it('emits an empty predicate when no AUFTRAGSAUSDRUCK precedes the FSW_PSW', () => {
    const list = buildOptionList(cvt);
    const fn = list.functions.find((f) => f.fsw === 0x101)!;
    expect(fn.parameters[0]!.psw).toBe(0x300);
    expect(fn.parameters[0]!.predicate.length).toBe(0);
  });

  it('skips INDIVID-scoped rows by default', () => {
    const list = buildOptionList(cvt);
    const fn = list.functions.find((f) => f.fsw === 0x100)!;
    // PSW 0x999 should NOT appear (it was inside INDIVID)
    expect(fn.parameters.find((p) => p.psw === 0x999)).toBeUndefined();
  });

  it('includes INDIVID rows when groupScopeOnly:false', () => {
    const list = buildOptionList(cvt, { groupScopeOnly: false });
    const fn = list.functions.find((f) => f.fsw === 0x100)!;
    const p999 = fn.parameters.find((p) => p.psw === 0x999);
    expect(p999).toBeDefined();
    expect(Array.from(p999!.predicate)).toEqual([0xff]);
  });

  it('resets pending predicate after consuming it', () => {
    // The 0x101/0x300 entry comes immediately after a consumed AUFTRAGSAUSDRUCK paired with
    // 0x100/0x201; the test on empty predicate above already covers this. Sanity check
    // that 0x300 isn't getting [0x03] accidentally.
    const list = buildOptionList(cvt);
    const fn = list.functions.find((f) => f.fsw === 0x101)!;
    expect(fn.parameters[0]!.predicate.length).toBe(0);
  });
});
