import { describe, expect, it } from 'vitest';
import { parseDatenFile, xorFoldCrc } from '@emdzej/ncsx-daten';
import { buildFunctionList } from './builder.js';

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

// IDs we'll use throughout.
const ID_PARZ_FSW = 0x0012;
const ID_PARZ_PSW1 = 0x0013;
const ID_PARZ_PSW2 = 0x0014;
const ID_PARZ_DIR = 0x0015;
const ID_UNBELEGT1 = 0x0016;
const ID_UNBELEGT2 = 0x0017;
const ID_CODBLK = 0x0018;
const ID_SPEICHERORG = 0x0019;

/** Helper: encode a `{X}` optional field — `0x00` absent, `0x01 + value` present. */
const optAbsent = [0x00];
const optByte = (v: number): number[] => [0x01, v & 0xff];

/** `(B)` collection: u16 LE count + bytes. */
const collBytes = (bs: number[]): number[] => [bs.length & 0xff, (bs.length >> 8) & 0xff, ...bs];

/** Two bytes LE. */
const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
/** Four bytes LE. */
const u32 = (n: number): number[] => [
  n & 0xff,
  (n >>> 8) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 24) & 0xff,
];

/**
 * Minimal CABD file with one FSW (two PSWs), one property, one unoccupied block (with fill),
 * one CODIERDATENBLOCK group, and a SPEICHERORG header.
 */
function buildExample(): Uint8Array {
  const defs = [
    ...BLOCK_DEF(ID_PARZ_FSW, 'PARZUWEISUNG_FSW', '{L}LWW{B}(B){B}{B}',
      'BLOCKNR,WORTADR,BYTEADR,FSW,INDEX,MASKE,EINHEIT,INDIVID'),
    ...BLOCK_DEF(ID_PARZ_PSW1, 'PARZUWEISUNG_PSW1', 'W(B)', 'PSW,WERTE'),
    ...BLOCK_DEF(ID_PARZ_PSW2, 'PARZUWEISUNG_PSW2', '(B)', 'WERTE'),
    ...BLOCK_DEF(ID_PARZ_DIR, 'PARZUWEISUNG_DIR', '{L}LWW{B}(B)(A)B',
      'BLOCKNR,WORTADR,BYTEADR,FSW,INDEX,MASKE,OPERATION,EINHEIT'),
    ...BLOCK_DEF(ID_UNBELEGT1, 'UNBELEGT1', '{L}LW{B}(B)', 'BLOCKNR,WORTADR,BYTEADR,INDEX,MASKE'),
    ...BLOCK_DEF(ID_UNBELEGT2, 'UNBELEGT2', '(B)', 'WERTE'),
    ...BLOCK_DEF(ID_CODBLK, 'CODIERDATENBLOCK', '{L}LWS',
      'BLOCKNR,WORTADR,BYTEADR,BESCHREIBUNG'),
    ...BLOCK_DEF(ID_SPEICHERORG, 'SPEICHERORG', 'SS', 'STRUKTUR,TYP'),
  ];

  // SPEICHERORG = WORDMSB / FREI
  const speicherorgRow = frame(ID_SPEICHERORG, [
    ...ascii('WORDMSB'), 0x00,
    ...ascii('FREI'), 0x00,
  ]);

  // Group header at addr=0x100, length=0x20
  const groupRow = frame(ID_CODBLK, [
    ...optAbsent,           // BLOCKNR
    ...u32(0x100),          // WORTADR
    ...u16(0x20),           // BYTEADR (length)
    ...ascii('Coding block 1'), 0x00, // BESCHREIBUNG (string is ASCII + NUL)
  ]);

  // PARZUWEISUNG_FSW: FSW=0x0123, addr=0x100, len=1, mask=[0xFF], einheit='h', individ absent
  const fswRow = frame(ID_PARZ_FSW, [
    ...optAbsent,           // BLOCKNR
    ...u32(0x100),          // WORTADR
    ...u16(0x01),           // BYTEADR (length=1)
    ...u16(0x0123),         // FSW id
    ...optAbsent,           // INDEX
    ...collBytes([0xff]),   // MASKE
    ...optByte(0x68),       // EINHEIT 'h'
    ...optAbsent,           // INDIVID
  ]);

  // PSW1: PSW=0x0001, value byte 0x00
  const psw1Row = frame(ID_PARZ_PSW1, [
    ...u16(0x0001),         // PSW id
    ...collBytes([0x00]),   // WERTE
  ]);

  // PSW1: PSW=0x0002, value byte 0x01 (with continuation in PSW2)
  const psw1RowB = frame(ID_PARZ_PSW1, [
    ...u16(0x0002),
    ...collBytes([0x01]),
  ]);
  const psw2RowB = frame(ID_PARZ_PSW2, [
    ...collBytes([0x02, 0x03]),
  ]);

  // PARZUWEISUNG_DIR: FSW=0x0200, addr=0x200, len=2, mask=[0xFF,0xFF], no ops, unit='d'
  const dirRow = frame(ID_PARZ_DIR, [
    ...optAbsent,           // BLOCKNR
    ...u32(0x200),          // WORTADR
    ...u16(0x02),           // BYTEADR (length)
    ...u16(0x0200),         // FSW id
    ...optAbsent,           // INDEX
    ...collBytes([0xff, 0xff]), // MASKE
    ...u16(0),              // OPERATION (A) collection, count=0
    0x64,                   // EINHEIT 'd' (scalar B)
  ]);

  // UNBELEGT1 at addr=0x300, len=4
  const unbel1 = frame(ID_UNBELEGT1, [
    ...optAbsent,           // BLOCKNR
    ...u32(0x300),          // WORTADR
    ...u16(0x04),           // BYTEADR
    ...optAbsent,           // INDEX
    ...collBytes([0xff, 0xff, 0xff, 0xff]), // MASKE
  ]);
  // UNBELEGT2 fills with one byte, tiled across 4 positions
  const unbel2 = frame(ID_UNBELEGT2, [
    ...collBytes([0xaa]),
  ]);

  return concat(
    ...SIGS,
    ...defs,
    DIVIDER,
    speicherorgRow,
    groupRow,
    fswRow,
    psw1Row,
    psw1RowB,
    psw2RowB,
    dirRow,
    unbel1,
    unbel2,
  );
}

describe('buildFunctionList — single CABD example', () => {
  const daten = parseDatenFile(buildExample());
  const list = buildFunctionList(daten);

  it('captures SPEICHERORG metadata', () => {
    expect(list.memoryStructure).toBe('WORDMSB');
    expect(list.memoryType).toBe('FREI');
  });

  it('emits items in document order', () => {
    expect(list.items.map((i) => i.kind)).toEqual([
      'group',
      'function',
      'property',
      'unoccupied',
    ]);
  });

  it('captures the function with both PSWs and PSW2 continuation', () => {
    const fn = list.items[1];
    if (fn?.kind !== 'function') throw new Error('expected function');
    expect(fn.fsw).toBe(0x0123);
    expect(fn.address).toBe(0x100);
    expect(fn.length).toBe(1);
    expect(Array.from(fn.mask)).toEqual([0xff]);
    expect(fn.parameters.length).toBe(2);
    expect(fn.parameters[0]!.psw).toBe(0x0001);
    expect(Array.from(fn.parameters[0]!.data)).toEqual([0x00]);
    expect(fn.parameters[1]!.psw).toBe(0x0002);
    // PSW2 continuation concatenated: 0x01 + 0x02 0x03
    expect(Array.from(fn.parameters[1]!.data)).toEqual([0x01, 0x02, 0x03]);
  });

  it('captures a property with empty operations and unit', () => {
    const prop = list.items[2];
    if (prop?.kind !== 'property') throw new Error('expected property');
    expect(prop.fsw).toBe(0x0200);
    expect(prop.unit).toBe('d');
    expect(prop.operations.length).toBe(0);
    expect(prop.length).toBe(2);
  });

  it('tiles UNBELEGT2 fill across the unoccupied length', () => {
    const u = list.items[3];
    if (u?.kind !== 'unoccupied') throw new Error('expected unoccupied');
    expect(u.length).toBe(4);
    expect(Array.from(u.fillBytes)).toEqual([0xaa, 0xaa, 0xaa, 0xaa]);
  });

  it('captures the group header description', () => {
    const g = list.items[0];
    if (g?.kind !== 'group') throw new Error('expected group');
    expect(g.groupKind).toBe('coding');
    expect(g.description).toBe('Coding block 1');
  });

  it('resolves FSW/PSW keywords when SWT tables supplied', () => {
    const fswMap = new Map<number, string>([[0x0123, 'KEYCARDREADER']]);
    const pswMap = new Map<number, string>([
      [0x0001, 'nicht_aktiv'],
      [0x0002, 'aktiv'],
    ]);
    const resolved = buildFunctionList(daten, { keywords: { fsw: fswMap, psw: pswMap } });
    const fn = resolved.items[1];
    if (fn?.kind !== 'function') throw new Error('expected function');
    expect(fn.fswKeyword).toBe('KEYCARDREADER');
    expect(fn.parameters.map((p) => p.pswKeyword)).toEqual(['nicht_aktiv', 'aktiv']);
  });

  it('detects array-indexed property keywords', () => {
    const fswMap = new Map<number, string>([[0x0200, 'KEY[3]']]);
    const resolved = buildFunctionList(daten, { keywords: { fsw: fswMap } });
    const prop = resolved.items[2];
    if (prop?.kind !== 'property') throw new Error('expected property');
    expect(prop.arrayName).toBe('KEY');
    expect(prop.arrayIndex).toBe(3);
  });

  it('throws when PSW1 has no preceding FSW', () => {
    const bad = concat(
      ...SIGS,
      ...BLOCK_DEF(ID_PARZ_PSW1, 'PARZUWEISUNG_PSW1', 'W(B)', 'PSW,WERTE'),
      DIVIDER,
      frame(ID_PARZ_PSW1, [...u16(1), ...collBytes([0])]),
    );
    const file = parseDatenFile(bad);
    expect(() => buildFunctionList(file)).toThrow(/no preceding PARZUWEISUNG_FSW/);
  });
});

describe('buildFunctionList — INDIVID_S / GRUPPE_S gating', () => {
  function buildIndividExample(): Uint8Array {
    // Tiny block list: GRUPPE_S and INDIVID_S markers, plus one FSW in each scope.
    const ID_GRUPPE = 0x0020;
    const ID_INDIVID = 0x0021;
    const defs = [
      ...BLOCK_DEF(ID_GRUPPE, 'GRUPPE_S', 'S', 'NAME'),
      ...BLOCK_DEF(ID_INDIVID, 'INDIVID_S', 'S', 'NAME'),
      ...BLOCK_DEF(ID_PARZ_FSW, 'PARZUWEISUNG_FSW', '{L}LWW{B}(B){B}{B}',
        'BLOCKNR,WORTADR,BYTEADR,FSW,INDEX,MASKE,EINHEIT,INDIVID'),
    ];
    const grupRow = frame(ID_GRUPPE, [...ascii('GROUP'), 0x00]);
    const indRow = frame(ID_INDIVID, [...ascii('IND'), 0x00]);
    const fswA = frame(ID_PARZ_FSW, [
      ...optAbsent, ...u32(0x100), ...u16(1), ...u16(0x0100),
      ...optAbsent, ...collBytes([0xff]), ...optByte(0x68), ...optAbsent,
    ]);
    const fswB = frame(ID_PARZ_FSW, [
      ...optAbsent, ...u32(0x200), ...u16(1), ...u16(0x0200),
      ...optAbsent, ...collBytes([0xff]), ...optByte(0x68), ...optAbsent,
    ]);
    return concat(
      ...SIGS, ...defs, DIVIDER,
      grupRow, fswA,    // group-scoped FSW
      indRow, fswB,     // individual-scoped FSW
    );
  }

  const file = parseDatenFile(buildIndividExample());

  it('includes both by default', () => {
    const list = buildFunctionList(file);
    const fnIds = list.items
      .filter((i) => i.kind === 'function')
      .map((i) => (i.kind === 'function' ? i.fsw : -1));
    expect(fnIds).toEqual([0x0100, 0x0200]);
  });

  it('skips INDIVID_S-scoped rows when asked', () => {
    const list = buildFunctionList(file, { skipIndividualBlocks: true });
    const fnIds = list.items
      .filter((i) => i.kind === 'function')
      .map((i) => (i.kind === 'function' ? i.fsw : -1));
    expect(fnIds).toEqual([0x0100]);
  });
});
