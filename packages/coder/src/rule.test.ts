import { describe, expect, it } from 'vitest';
import type { Block, RawBytes, RowValues } from '@emdzej/ncsx-daten';
import { computeNettoSize, findParzuweisung, indexFsws, ruleFromRow } from './rule.js';

const block = (rows: RowValues[]): Block => ({ id: 0x0100, name: 'PARZUWEISUNG_FSW', fields: [], rows });

const baseRow = (overrides: Partial<RowValues>): RowValues => ({
  BLOCKNR: null,
  WORTADR: 0x04,
  BYTEADR: 1,
  FSW: 0x025f,
  INDEX: null,
  MASKE: [0xff],
  EINHEIT: 0x68, // 'h'
  INDIVID: null,
  ...overrides,
});

describe('findParzuweisung', () => {
  it('finds PARZUWEISUNG_FSW by name', () => {
    const found = findParzuweisung({ signatures: [], blocks: [block([])], rowsInOrder: [] });
    expect(found?.name).toBe('PARZUWEISUNG_FSW');
  });

  it('returns undefined when absent', () => {
    expect(findParzuweisung({ signatures: [], blocks: [], rowsInOrder: [] })).toBeUndefined();
  });
});

describe('ruleFromRow', () => {
  it('extracts a minimal rule', () => {
    const rule = ruleFromRow(baseRow({}));
    expect(rule).toEqual({
      wortadr: 0x04,
      byteadr: 1,
      maske: [0xff],
      einheit: 'h',
      operations: [],
    });
  });

  it("defaults EINHEIT to 'h' when missing", () => {
    const rule = ruleFromRow(baseRow({ EINHEIT: null }));
    expect(rule?.einheit).toBe('h');
  });

  it('returns undefined when required fields are missing', () => {
    expect(ruleFromRow({ ...baseRow({}), WORTADR: null })).toBeUndefined();
    expect(ruleFromRow({ ...baseRow({}), MASKE: null })).toBeUndefined();
  });

  it('returns undefined when MASKE length mismatches BYTEADR', () => {
    expect(
      ruleFromRow(baseRow({ BYTEADR: 2, MASKE: [0xff] })),
    ).toBeUndefined();
  });

  it('parses an embedded OPERATION list (5-byte tuples)', () => {
    const opBytes: RawBytes = {
      bytes: Uint8Array.from([
        // '+' 0x05 00 00 00
        0x2b, 0x05, 0x00, 0x00, 0x00,
        // '>' 0x04 00 00 00
        0x3e, 0x04, 0x00, 0x00, 0x00,
      ]),
    };
    const rule = ruleFromRow(baseRow({ OPERATION: opBytes }));
    expect(rule?.operations).toEqual([
      { op: '+', operand: 5 },
      { op: '>', operand: 4 },
    ]);
  });
});

describe('indexFsws', () => {
  it('groups rows by FSW id', () => {
    const idx = indexFsws(block([
      baseRow({ FSW: 0x0100, WORTADR: 0x00 }),
      baseRow({ FSW: 0x0100, WORTADR: 0x02 }),
      baseRow({ FSW: 0x0200, WORTADR: 0x04 }),
    ]));
    expect(idx.get(0x0100)).toHaveLength(2);
    expect(idx.get(0x0200)).toHaveLength(1);
  });
});

describe('computeNettoSize', () => {
  it('returns the max WORTADR + BYTEADR', () => {
    const size = computeNettoSize(block([
      baseRow({ WORTADR: 0x04, BYTEADR: 1 }),
      baseRow({ WORTADR: 0x10, BYTEADR: 2 }),
      baseRow({ WORTADR: 0x08, BYTEADR: 4 }),
    ]));
    expect(size).toBe(0x12);
  });

  it('skips malformed rows gracefully', () => {
    const size = computeNettoSize(block([
      baseRow({ WORTADR: 0x04 }),
      { ...baseRow({}), WORTADR: null },
      baseRow({ WORTADR: 0x10, BYTEADR: 2 }),
    ]));
    expect(size).toBe(0x12);
  });
});
