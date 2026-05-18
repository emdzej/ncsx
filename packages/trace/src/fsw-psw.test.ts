import { describe, expect, it } from 'vitest';
import type { FunctionList } from '@emdzej/ncsx-function-list';
import { buildTraceOverlay } from './overlay.js';
import {
  applyFswPswTrace,
  parseFswPswTrace,
  writeFswPswTrace,
} from './fsw-psw.js';

function makeList(): FunctionList {
  return {
    items: [
      {
        kind: 'group',
        groupKind: 'coding',
        block: 0,
        address: 0x100,
        length: 0x20,
        description: 'Display 1',
      },
      {
        kind: 'function',
        block: 0,
        address: 0x100,
        length: 1,
        mask: Uint8Array.from([0xff]),
        fsw: 0x100,
        fswKeyword: 'GPS_UHR',
        parameters: [
          { psw: 0x01, pswKeyword: 'nicht_aktiv', data: Uint8Array.from([0x00]) },
          { psw: 0x02, pswKeyword: 'aktiv', data: Uint8Array.from([0x01]) },
        ],
      },
      {
        kind: 'function',
        block: 0,
        address: 0x101,
        length: 1,
        mask: Uint8Array.from([0x18]),
        fsw: 0x200,
        fswKeyword: 'BC_DIGITAL_V',
        parameters: [
          { psw: 0x01, pswKeyword: 'nicht_aktiv', data: Uint8Array.from([0x00]) },
          { psw: 0x02, pswKeyword: 'aktiv', data: Uint8Array.from([0x08]) },
        ],
      },
    ],
    memoryStructure: 'BYTE',
    memoryType: 'FREI',
    deliveryState: new Uint8Array(0),
    codingIndices: [],
    hardwareVersions: [],
    softwareVersions: [],
  };
}

describe('parseFswPswTrace', () => {
  it('parses an FSW/PSW trace with tab-indented parameters', () => {
    const text = 'GPS_UHR\n\taktiv\nBC_DIGITAL_V\n\taktiv\n';
    expect(parseFswPswTrace(text)).toEqual([
      { fswKeyword: 'GPS_UHR', pswKeywords: ['aktiv'] },
      { fswKeyword: 'BC_DIGITAL_V', pswKeywords: ['aktiv'] },
    ]);
  });

  it('handles CRLF line endings and blank lines', () => {
    const text = 'GPS_UHR\r\n\taktiv\r\n\r\nBC_DIGITAL_V\r\n\taktiv\r\n';
    expect(parseFswPswTrace(text)).toEqual([
      { fswKeyword: 'GPS_UHR', pswKeywords: ['aktiv'] },
      { fswKeyword: 'BC_DIGITAL_V', pswKeywords: ['aktiv'] },
    ]);
  });

  it('throws on parameter line before any function', () => {
    expect(() => parseFswPswTrace('\torphan\nFOO\n')).toThrow(/before any function/);
  });

  it('throws on malformed lines', () => {
    expect(() => parseFswPswTrace('two tokens')).toThrow(/malformed/);
  });
});

describe('applyFswPswTrace', () => {
  it('marks matching parameters as selected', () => {
    const overlay = buildTraceOverlay(makeList());
    applyFswPswTrace(overlay, parseFswPswTrace('GPS_UHR\n\taktiv\nBC_DIGITAL_V\n\taktiv\n'));
    const gps = overlay.items.find(
      (it) => it.kind === 'function' && it.fswKeyword === 'GPS_UHR',
    );
    if (gps?.kind !== 'function') throw new Error('expected function');
    expect(gps.parameters.find((p) => p.pswKeyword === 'aktiv')!.selected).toBe(true);
    expect(gps.parameters.find((p) => p.pswKeyword === 'nicht_aktiv')!.selected).toBe(false);
  });

  it('appends unresolved entries when FSW keyword is unknown', () => {
    const overlay = buildTraceOverlay(makeList());
    applyFswPswTrace(overlay, parseFswPswTrace('GHOST_FN\n\twert_03\n'));
    const ghost = overlay.items.find((it) => it.kind === 'unresolved');
    expect(ghost).toBeDefined();
    if (ghost?.kind !== 'unresolved') throw new Error('expected unresolved');
    expect(ghost.fswKeyword).toBe('GHOST_FN');
    expect(ghost.parameterKeywords).toEqual(['wert_03']);
  });

  it('strict mode throws on unresolved FSW', () => {
    const overlay = buildTraceOverlay(makeList());
    expect(() =>
      applyFswPswTrace(
        overlay,
        parseFswPswTrace('GHOST_FN\n\twert_03\n'),
        { strict: true },
      ),
    ).toThrow(/unresolved function keyword "GHOST_FN"/);
  });

  it('strict mode throws on unresolved PSW', () => {
    const overlay = buildTraceOverlay(makeList());
    expect(() =>
      applyFswPswTrace(
        overlay,
        parseFswPswTrace('GPS_UHR\n\twert_99\n'),
        { strict: true },
      ),
    ).toThrow(/unresolved parameter keyword "wert_99"/);
  });
});

describe('writeFswPswTrace', () => {
  it('serialises only checked items, sorted by FSW id, in canonical format', () => {
    const overlay = buildTraceOverlay(makeList());
    // Tick BC_DIGITAL_V/aktiv first, then GPS_UHR/aktiv — output must still sort by FSW id.
    const bc = overlay.items.find(
      (it) => it.kind === 'function' && it.fswKeyword === 'BC_DIGITAL_V',
    );
    if (bc?.kind !== 'function') throw new Error('setup');
    bc.parameters.find((p) => p.pswKeyword === 'aktiv')!.selected = true;
    const gps = overlay.items.find(
      (it) => it.kind === 'function' && it.fswKeyword === 'GPS_UHR',
    );
    if (gps?.kind !== 'function') throw new Error('setup');
    gps.parameters.find((p) => p.pswKeyword === 'aktiv')!.selected = true;

    expect(writeFswPswTrace(overlay)).toBe('GPS_UHR\n\taktiv\nBC_DIGITAL_V\n\taktiv\n');
  });

  it('round-trips with parse', () => {
    const overlay = buildTraceOverlay(makeList());
    const original = 'GPS_UHR\n\taktiv\nBC_DIGITAL_V\n\taktiv\n';
    applyFswPswTrace(overlay, parseFswPswTrace(original));
    expect(writeFswPswTrace(overlay)).toBe(original);
  });

  it('omits functions with nothing checked', () => {
    const overlay = buildTraceOverlay(makeList());
    expect(writeFswPswTrace(overlay)).toBe('');
  });

  it('emits unresolved entries after resolved ones', () => {
    const overlay = buildTraceOverlay(makeList());
    applyFswPswTrace(
      overlay,
      parseFswPswTrace('GPS_UHR\n\taktiv\nGHOST\n\twert_03\n'),
    );
    expect(writeFswPswTrace(overlay)).toBe('GPS_UHR\n\taktiv\nGHOST\n\twert_03\n');
  });
});
