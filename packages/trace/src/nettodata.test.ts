import { describe, expect, it } from 'vitest';
import type { FunctionList } from '@emdzej/ncsx-function-list';
import { buildTraceOverlay } from './overlay.js';
import {
  applyNettodataTrace,
  parseNettodataTrace,
  unpackBlockAddress,
  writeNettodataTrace,
} from './nettodata.js';

function listByte(): FunctionList {
  return {
    items: [
      // Function: two PSWs, one byte at address 0x100, mask 0x18 (so bits 3-4).
      {
        kind: 'function',
        block: 0,
        address: 0x100,
        length: 1,
        mask: Uint8Array.from([0x18]),
        fsw: 0x100,
        fswKeyword: 'BC_DIGITAL_V',
        parameters: [
          { psw: 0x01, pswKeyword: 'nicht_aktiv', data: Uint8Array.from([0x00]) },
          { psw: 0x02, pswKeyword: 'aktiv', data: Uint8Array.from([0x08]) },
        ],
      },
      // Property: 2 bytes at 0x200, full mask.
      {
        kind: 'property',
        block: 0,
        address: 0x200,
        length: 2,
        mask: Uint8Array.from([0xff, 0xff]),
        fsw: 0x200,
        fswKeyword: 'SPEED_LIMIT',
        operations: [],
        unit: 'd',
        data: null,
      } as unknown as FunctionList['items'][number],
    ],
    memoryStructure: 'BYTE',
    memoryType: 'FREI',
    deliveryState: new Uint8Array(0),
    codingIndices: [],
    hardwareVersions: [],
    softwareVersions: [],
  };
}

describe('parseNettodataTrace', () => {
  it('expands a B record into per-byte entries', () => {
    const entries = parseNettodataTrace('B 00000100,0003,01,02,03\n');
    expect(entries.length).toBe(3);
    expect(entries[0]).toEqual({
      blockAddress: 0x100,
      mask: 0xff,
      data: 0x01,
      isWord: false,
    });
    expect(entries[2]!.blockAddress).toBe(0x102);
    expect(entries[2]!.data).toBe(0x03);
  });

  it('parses an M record', () => {
    const entries = parseNettodataTrace('M 00000100,0001,18,08\n');
    expect(entries).toEqual([
      { blockAddress: 0x100, mask: 0x18, data: 0x08, isWord: false },
    ]);
  });

  it('handles word-mode (4-hex tokens)', () => {
    const entries = parseNettodataTrace('B 00000100,0001,1234\n');
    expect(entries).toEqual([
      { blockAddress: 0x100, mask: 0xffff, data: 0x1234, isWord: true },
    ]);
  });

  it('throws on mixed byte/word in the same file', () => {
    expect(() =>
      parseNettodataTrace('B 00000100,0001,01\nB 00000101,0001,1234\n'),
    ).toThrow(/mixes byte and word/);
  });

  it('throws on malformed lines', () => {
    expect(() => parseNettodataTrace('garbage\n')).toThrow(/malformed/);
  });
});

describe('applyNettodataTrace + writeNettodataTrace', () => {
  it('decodes B bytes back into a selected PSW', () => {
    const overlay = buildTraceOverlay(listByte());
    applyNettodataTrace(overlay, parseNettodataTrace('B 00000100,0001,08\n'));
    const fn = overlay.items.find((it) => it.kind === 'function');
    if (fn?.kind !== 'function') throw new Error('expected function');
    expect(fn.parameters.find((p) => p.pswKeyword === 'aktiv')!.selected).toBe(true);
    expect(fn.custom).toBeNull();
  });

  it('decodes property bytes', () => {
    const overlay = buildTraceOverlay(listByte());
    applyNettodataTrace(overlay, parseNettodataTrace('B 00000200,0002,32,64\n'));
    const prop = overlay.items.find((it) => it.kind === 'property');
    if (prop?.kind !== 'property') throw new Error('expected property');
    expect(prop.data).not.toBeNull();
    expect(Array.from(prop.data!)).toEqual([0x32, 0x64]);
  });

  it('falls back to "custom" when bytes don\'t match any PSW', () => {
    const overlay = buildTraceOverlay(listByte());
    applyNettodataTrace(overlay, parseNettodataTrace('M 00000100,0001,18,10\n'));
    const fn = overlay.items.find((it) => it.kind === 'function');
    if (fn?.kind !== 'function') throw new Error('expected function');
    expect(fn.parameters.every((p) => !p.selected)).toBe(true);
    expect(fn.custom).not.toBeNull();
    expect(Array.from(fn.custom!)).toEqual([0x10]);
  });

  it('writes a "B" run for a single fully-masked address', () => {
    const overlay = buildTraceOverlay(listByte());
    const fn = overlay.items.find((it) => it.kind === 'function');
    if (fn?.kind !== 'function') throw new Error('setup');
    fn.parameters.find((p) => p.pswKeyword === 'aktiv')!.selected = true;
    fn.mask = Uint8Array.from([0xff]); // upgrade to full-mask so writer emits B
    fn.parameters.find((p) => p.pswKeyword === 'aktiv')!.data = Uint8Array.from([0xff]);
    expect(writeNettodataTrace(overlay)).toBe('B 00000100,0001,FF\n');
  });

  it('writes an "M" record for partial-mask functions', () => {
    const overlay = buildTraceOverlay(listByte());
    const fn = overlay.items.find((it) => it.kind === 'function');
    if (fn?.kind !== 'function') throw new Error('setup');
    fn.parameters.find((p) => p.pswKeyword === 'aktiv')!.selected = true;
    expect(writeNettodataTrace(overlay)).toBe('M 00000100,0001,18,08\n');
  });

  it('coalesces consecutive fully-masked bytes into a single B record', () => {
    const list: FunctionList = {
      ...listByte(),
      items: [
        {
          kind: 'function',
          block: 0,
          address: 0x100,
          length: 4,
          mask: Uint8Array.from([0xff, 0xff, 0xff, 0xff]),
          fsw: 0x100,
          fswKeyword: 'CSUM',
          parameters: [
            {
              psw: 0x01,
              pswKeyword: 'val',
              data: Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]),
            },
          ],
        },
      ],
    };
    const overlay = buildTraceOverlay(list);
    const fn = overlay.items[0];
    if (fn?.kind !== 'function') throw new Error('setup');
    fn.parameters[0]!.selected = true;
    expect(writeNettodataTrace(overlay)).toBe('B 00000100,0004,AA,BB,CC,DD\n');
  });

  it('round-trips parse → apply → write for a B record', () => {
    const overlay = buildTraceOverlay(listByte());
    const input = 'B 00000100,0001,08\nB 00000200,0002,32,64\n';
    applyNettodataTrace(overlay, parseNettodataTrace(input));
    const out = writeNettodataTrace(overlay);
    // We can't expect byte-equal output (B at 0x100 with full mask vs the original at 0x100
    // with partial — but here the selected PSW happens to be `0x08` which combined with the
    // function's mask 0x18 produces `0x08` as data and `0x18` as mask — so an M record).
    expect(out).toContain('M 00000100,0001,18,08');
    expect(out).toContain('B 00000200,0002,32,64');
  });
});

describe('unpackBlockAddress', () => {
  // NCSEXPER's BlockAddress = (block << 8) + (isWord ? address/2 : address). The packing
  // is lossy in the obvious way — the bottom 8 bits of the packed value are *always* the
  // bottom of the byte address, and the upper bits absorb both the original `block` and
  // the high bits of the original `address`. So a function declared with `block=0,
  // address=0x100` packs to `0x100` and unpacks to `block=1, address=0` — which is fine
  // because the inverse pair re-packs to the same `0x100`.
  it('byte mode: bottom 8 bits go to address, rest to block', () => {
    expect(unpackBlockAddress(0x00000100, false)).toEqual({ block: 1, address: 0 });
    expect(unpackBlockAddress(0x010000ff, false)).toEqual({ block: 0x10000, address: 0xff });
  });

  it('word mode: bottom 8 bits × 2 = address', () => {
    expect(unpackBlockAddress(0x00000080, true)).toEqual({ block: 0, address: 0x100 });
  });
});
