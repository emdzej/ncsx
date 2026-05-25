import { describe, expect, it } from 'vitest';
import {
  patchFromManSelections,
  patchToManSelections,
  type ManSelection,
} from './man-convert.js';
import { parsePatch } from './parse.js';
import { serializePatch } from './serialize.js';

describe('patchFromManSelections', () => {
  it('builds a single-module patch with the expected edits', () => {
    const selections: ManSelection[] = [
      { fswKeyword: 'BC_DIGITAL_V', pswKeywords: ['aktiv'] },
      { fswKeyword: 'GPS_UHR', pswKeywords: ['nicht_aktiv'] },
    ];

    const { patch, warnings } = patchFromManSelections(selections, {
      chassis: 'E46',
      module: 'KOMBI',
    });

    expect(patch.schema).toBe('ncsx-patch/v1');
    expect(patch.title).toBe('KOMBI on E46');
    expect(patch.chassis).toBe('E46');
    expect(patch.modules).toHaveLength(1);
    expect(patch.modules[0]!.module).toBe('KOMBI');
    expect(patch.modules[0]!.edits).toEqual({
      BC_DIGITAL_V: 'aktiv',
      GPS_UHR: 'nicht_aktiv',
    });
    expect(warnings).toEqual([]);
  });

  it('flattens multi-PSW selections to the first PSW with a warning', () => {
    const selections: ManSelection[] = [
      { fswKeyword: 'GHOST', pswKeywords: ['wert_03', 'wert_04', 'wert_05'] },
      { fswKeyword: 'GPS_UHR', pswKeywords: ['aktiv'] },
    ];

    const { patch, warnings } = patchFromManSelections(selections, {
      chassis: 'E46',
      module: 'KOMBI',
    });

    expect(patch.modules[0]!.edits).toEqual({
      GHOST: 'wert_03',
      GPS_UHR: 'aktiv',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      kind: 'multi-psw-flattened',
      fsw: 'GHOST',
      kept: 'wert_03',
      dropped: ['wert_04', 'wert_05'],
    });
  });

  it('skips FSW entries that have no PSW (records a warning)', () => {
    const selections: ManSelection[] = [
      { fswKeyword: 'EMPTY_ONE', pswKeywords: [] },
      { fswKeyword: 'GPS_UHR', pswKeywords: ['aktiv'] },
    ];

    const { patch, warnings } = patchFromManSelections(selections, {
      chassis: 'E46',
      module: 'KOMBI',
    });

    expect(patch.modules[0]!.edits).toEqual({ GPS_UHR: 'aktiv' });
    expect(warnings).toContainEqual({ kind: 'empty-psw-skipped', fsw: 'EMPTY_ONE' });
  });

  it('throws when every selection is filtered out', () => {
    const selections: ManSelection[] = [
      { fswKeyword: 'ONLY_EMPTY', pswKeywords: [] },
    ];
    expect(() =>
      patchFromManSelections(selections, { chassis: 'E46', module: 'KOMBI' }),
    ).toThrow(/no usable FSW.PSW pairs/);
  });

  it('honours the optional metadata fields', () => {
    const { patch } = patchFromManSelections(
      [{ fswKeyword: 'GPS_UHR', pswKeywords: ['aktiv'] }],
      {
        chassis: 'E46',
        module: 'KOMBI',
        title: 'Custom title',
        description: 'A test patch',
        author: 'test@example.com',
        keywords: ['test', 'kombi'],
        moduleDescription: 'Per-module notes',
        codingIndexes: ['C06', 'C07'],
      },
    );

    expect(patch.title).toBe('Custom title');
    expect(patch.description).toBe('A test patch');
    expect(patch.author).toBe('test@example.com');
    expect(patch.keywords).toEqual(['test', 'kombi']);
    expect(patch.modules[0]!.description).toBe('Per-module notes');
    expect(patch.modules[0]!.coding_indexes).toEqual(['C06', 'C07']);
  });
});

describe('patchToManSelections', () => {
  it('emits one entry per module with selections', () => {
    const patch = parsePatch(`
schema: ncsx-patch/v1
title: Multi-module test
chassis: E46
modules:
  - module: KOMBI
    edits:
      BC_DIGITAL_V: aktiv
      GPS_UHR: nicht_aktiv
  - module: GM5
    edits:
      WELCOME_LIGHTS: aktiv
`);

    const result = patchToManSelections(patch);
    expect(result.size).toBe(2);
    expect(result.get('KOMBI')).toEqual([
      { fswKeyword: 'BC_DIGITAL_V', pswKeywords: ['aktiv'] },
      { fswKeyword: 'GPS_UHR', pswKeywords: ['nicht_aktiv'] },
    ]);
    expect(result.get('GM5')).toEqual([
      { fswKeyword: 'WELCOME_LIGHTS', pswKeywords: ['aktiv'] },
    ]);
  });
});

describe('MAN → patch → MAN round-trip', () => {
  it('preserves the FSW/PSW pairs through the conversion cycle', () => {
    const original: ManSelection[] = [
      { fswKeyword: 'BC_DIGITAL_V', pswKeywords: ['aktiv'] },
      { fswKeyword: 'GPS_UHR', pswKeywords: ['nicht_aktiv'] },
    ];

    const { patch } = patchFromManSelections(original, {
      chassis: 'E46',
      module: 'KOMBI',
    });

    // Round-trip through YAML to make sure ordering survives.
    const yaml = serializePatch(patch);
    const reparsed = parsePatch(yaml);

    const back = patchToManSelections(reparsed);
    expect(back.get('KOMBI')).toEqual(original);
  });
});
