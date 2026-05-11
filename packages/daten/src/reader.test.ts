import { describe, it, expect } from 'vitest';
import { parseDatenFile } from './reader.js';
import { xorFoldCrc } from './crc.js';
import { RawBytes } from './types.js';

/**
 * Helper: build a single frame `[size, type_lo, type_hi, ...payload, crc]` with a correct CRC.
 */
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

/**
 * Worked example from `docs/daten-format.md` §1.8 / NCS Dummy notes:
 *
 *   Definition #0x0012 — "PARZUWEISUNG_FSW"
 *     DATAFORMAT  : "{L}LWW{B}(B){B}{B}"
 *     DATANAMES   : "BLOCKNR,WORTADR,BYTEADR,FSW,INDEX,MASKE,EINHEIT,INDIVID"
 *
 *   One data row, fully framed; decoded values:
 *     BLOCKNR=∅, WORTADR=0x00000004, BYTEADR=0x0001, FSW=0x025F,
 *     INDEX=∅,    MASKE=[0xFF],       EINHEIT=0x68 ('h'), INDIVID=∅
 */
function buildExampleFile(): Uint8Array {
  const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
  const block0012Name = [0x12, 0x00, ...ascii('PARZUWEISUNG_FSW'), 0x00];
  const formatStr = [...ascii('{L}LWW{B}(B){B}{B}'), 0x00];
  const namesStr = [
    ...ascii('BLOCKNR,WORTADR,BYTEADR,FSW,INDEX,MASKE,EINHEIT,INDIVID'),
    0x00,
  ];
  const dataRow = [
    // BLOCKNR (optional L) — absent
    0x00,
    // WORTADR (L) = 0x00000004
    0x04, 0x00, 0x00, 0x00,
    // BYTEADR (W) = 0x0001
    0x01, 0x00,
    // FSW (W) = 0x025F
    0x5f, 0x02,
    // INDEX (optional B) — absent
    0x00,
    // MASKE ((B)) count=1, value 0xFF
    0x01, 0x00, 0xff,
    // EINHEIT (optional B) — present, 'h'
    0x01, 0x68,
    // INDIVID (optional B) — absent
    0x00,
  ];

  return concat(
    frame(0x0100, [0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]),
    frame(0x0200, [0x02]),
    frame(0x0300, block0012Name),
    frame(0x0400, formatStr),
    frame(0x0500, namesStr),
    frame(0xff00, []),
    frame(0x0012, dataRow),
  );
}

describe('parseDatenFile — canonical PARZUWEISUNG_FSW example', () => {
  const FILE = buildExampleFile();

  it('parses signatures', () => {
    const file = parseDatenFile(FILE);
    expect(file.signatures.length).toBe(2);
    expect(file.signatures[0]!.type).toBe(0x0100);
    expect(file.signatures[1]!.type).toBe(0x0200);
  });

  it('parses block definition', () => {
    const file = parseDatenFile(FILE);
    expect(file.blocks.length).toBe(1);
    const b = file.blocks[0]!;
    expect(b.id).toBe(0x0012);
    expect(b.name).toBe('PARZUWEISUNG_FSW');
    expect(b.fields.map((f) => f.name)).toEqual([
      'BLOCKNR', 'WORTADR', 'BYTEADR', 'FSW', 'INDEX', 'MASKE', 'EINHEIT', 'INDIVID',
    ]);
    expect(b.fields[0]).toEqual({ name: 'BLOCKNR', kind: 'optional', scalar: 'L' });
    expect(b.fields[1]).toEqual({ name: 'WORTADR', kind: 'scalar', scalar: 'L' });
    expect(b.fields[5]).toEqual({ name: 'MASKE', kind: 'collection', scalar: 'B' });
  });

  it('decodes the data row to the values from the spec', () => {
    const file = parseDatenFile(FILE);
    const row = file.blocks[0]!.rows[0]!;
    expect(row.BLOCKNR).toBeNull();
    expect(row.WORTADR).toBe(0x00000004);
    expect(row.BYTEADR).toBe(0x0001);
    expect(row.FSW).toBe(0x025f);
    expect(row.INDEX).toBeNull();
    expect(row.MASKE).toEqual([0xff]);
    expect(row.EINHEIT).toBe(0x68);
    expect(row.INDIVID).toBeNull();
  });

  it('throws on CRC mismatch in strict mode', () => {
    const corrupt = Uint8Array.from(FILE);
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1]! ^ 0xff) & 0xff;
    expect(() => parseDatenFile(corrupt)).toThrow(/CRC mismatch/);
  });

  it('skips bad frames with strictCrc:false', () => {
    const corrupt = Uint8Array.from(FILE);
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1]! ^ 0xff) & 0xff;
    const warns: string[] = [];
    const file = parseDatenFile(corrupt, { strictCrc: false, onWarning: (m) => warns.push(m) });
    expect(file.blocks[0]!.rows.length).toBe(0);
    expect(warns.some((w) => /CRC mismatch/.test(w))).toBe(true);
  });
});

describe('parseDatenFile — A (length-prefixed) field — bug-1 regression', () => {
  /**
   * Block "BLOB_TEST" (id 0x0099), format "AW", row carries:
   *   BLOB = 5 raw bytes [0x21, 0x28, 0x53, 0x1e, 0x00]  (length-prefixed on the wire as 0x05 + 5 bytes)
   *   TAIL = 0xBEEF
   *
   * If the parser regresses to "A = 1 byte" (the bimmerz bug), it'll consume only the length
   * prefix and read TAIL from inside the BLOB content — wrong by ~5 bytes. The test catches that.
   */
  const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
  const FILE = concat(
    frame(0x0100, [0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]),
    frame(0x0200, [0x02]),
    frame(0x0300, [0x99, 0x00, ...ascii('BLOB_TEST'), 0x00]),
    frame(0x0400, [...ascii('AW'), 0x00]),
    frame(0x0500, [...ascii('BLOB,TAIL'), 0x00]),
    frame(0xff00, []),
    frame(0x0099, [
      // BLOB length=5, then 5 bytes
      0x05, 0x21, 0x28, 0x53, 0x1e, 0x00,
      // TAIL = 0xBEEF
      0xef, 0xbe,
    ]),
  );

  it('reads BLOB as length-prefixed and TAIL still lands at the right offset', () => {
    const file = parseDatenFile(FILE);
    const row = file.blocks[0]!.rows[0]!;
    const blob = row.BLOB as RawBytes;
    expect(Array.from(blob.bytes)).toEqual([0x21, 0x28, 0x53, 0x1e, 0x00]);
    expect(row.TAIL).toBe(0xbeef);
  });
});

describe('parseDatenFile — XX(XX) range list — bug-2 regression', () => {
  const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
  const FILE = concat(
    frame(0x0100, [0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]),
    frame(0x0200, [0x02]),
    frame(0x0300, [0xaa, 0x00, ...ascii('KENNUNG_D'), 0x00]),
    frame(0x0400, [...ascii('WW(WW)'), 0x00]),
    frame(0x0500, [...ascii('RANGES'), 0x00]),
    frame(0xff00, []),
    // RANGES = [start1=0x0000, end1=0x0037, count=2, (0x0044,0x0047), (0x0062,0x0084)]
    frame(0x00aa, [
      0x00, 0x00, // 0x0000
      0x37, 0x00, // 0x0037
      0x02, 0x00, // count=2
      0x44, 0x00, // 0x0044
      0x47, 0x00, // 0x0047
      0x62, 0x00, // 0x0062
      0x84, 0x00, // 0x0084
    ]),
  );

  it('parses WW(WW) as a single range-list field, not 3 scalars', () => {
    const file = parseDatenFile(FILE);
    const b = file.blocks[0]!;
    expect(b.fields).toEqual([{ name: 'RANGES', kind: 'range-list', scalar: 'W' }]);
    expect(b.rows[0]!.RANGES).toEqual([
      0x0000, 0x0037,
      0x0044, 0x0047,
      0x0062, 0x0084,
    ]);
  });
});

describe('parseDatenFile — X(X) non-empty list — bug-3 regression', () => {
  const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
  const FILE = concat(
    frame(0x0100, [0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]),
    frame(0x0200, [0x02]),
    frame(0x0300, [0xbb, 0x00, ...ascii('KENNUNG_K'), 0x00]),
    frame(0x0400, [...ascii('S(S)'), 0x00]),
    frame(0x0500, [...ascii('NAMES'), 0x00]),
    frame(0xff00, []),
    // NAMES = ["WL", count=2, "FFFF", "0000"]
    frame(0x00bb, [
      ...ascii('WL'), 0x00,
      0x02, 0x00,
      ...ascii('FFFF'), 0x00,
      ...ascii('0000'), 0x00,
    ]),
  );

  it('parses S(S) as a single non-empty-list field with leading "WL"', () => {
    const file = parseDatenFile(FILE);
    const b = file.blocks[0]!;
    expect(b.fields).toEqual([{ name: 'NAMES', kind: 'non-empty-list', scalar: 'S' }]);
    expect(b.rows[0]!.NAMES).toEqual(['WL', 'FFFF', '0000']);
  });
});
