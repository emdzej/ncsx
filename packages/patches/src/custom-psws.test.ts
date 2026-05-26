import { describe, expect, it } from 'vitest';
import { parsePatch } from './parse.js';
import { extractCustomPsws, parseHexBytes, toOverlayEntry } from './custom-psws.js';

describe('parseHexBytes', () => {
  it('parses a contiguous hex string', () => {
    expect([...parseHexBytes('DEADBEEF')]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('tolerates whitespace + colons between pairs', () => {
    expect([...parseHexBytes('DE AD BE EF')]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect([...parseHexBytes('DE:AD:BE:EF')]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect([...parseHexBytes('  DE\tAD  BE EF  ')]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('lowercase + mixed case both fine', () => {
    expect([...parseHexBytes('5a3c')]).toEqual([0x5a, 0x3c]);
    expect([...parseHexBytes('Aa Bb')]).toEqual([0xaa, 0xbb]);
  });

  it('throws on odd digit count', () => {
    expect(() => parseHexBytes('ABC')).toThrow(/odd digit count/);
  });
});

describe('toOverlayEntry', () => {
  it('maps the patch shape to the function-list overlay shape', () => {
    const entry = toOverlayEntry({ fsw: 'FSW_DRL', keyword: 'half_bright', data: '50' });
    expect(entry.fswKeyword).toBe('FSW_DRL');
    expect(entry.pswKeyword).toBe('half_bright');
    expect([...entry.data]).toEqual([0x50]);
  });
});

describe('extractCustomPsws', () => {
  it('groups entries by module', () => {
    const patch = parsePatch(`
schema: ncsx-patch/v1
title: Test patch with custom PSWs
chassis: E46
modules:
  - module: LCM
    custom_psws:
      - fsw: FSW_DRL
        keyword: drl_50
        data: "50"
      - fsw: FSW_DRL
        keyword: drl_75
        data: "75"
    edits:
      FSW_DRL: drl_50
  - module: KOMBI
    custom_psws:
      - fsw: FSW_LCD_BRIGHTNESS
        keyword: dim_mode
        data: "0A 0A"
        description: Dim mode for LCD
    edits:
      FSW_LCD_BRIGHTNESS: dim_mode
`);
    const grouped = extractCustomPsws(patch);
    expect(grouped.size).toBe(2);
    const lcm = grouped.get('LCM')!;
    expect(lcm).toHaveLength(2);
    expect(lcm[0]!.pswKeyword).toBe('drl_50');
    expect([...lcm[0]!.data]).toEqual([0x50]);
    expect(lcm[1]!.pswKeyword).toBe('drl_75');
    const kombi = grouped.get('KOMBI')!;
    expect(kombi).toHaveLength(1);
    expect(kombi[0]!.fswKeyword).toBe('FSW_LCD_BRIGHTNESS');
    expect([...kombi[0]!.data]).toEqual([0x0a, 0x0a]);
  });

  it('returns empty Map for patches with no custom_psws', () => {
    const patch = parsePatch(`
schema: ncsx-patch/v1
title: Vanilla patch
chassis: E46
modules:
  - module: LCM
    edits:
      WELCOME_LIGHTS: aktiv
`);
    const grouped = extractCustomPsws(patch);
    expect(grouped.size).toBe(0);
  });

  it('merges entries when a patch has multiple blocks for the same module', () => {
    // The schema allows multiple modules entries with the same name —
    // exercises the merge path.
    const patch = parsePatch(`
schema: ncsx-patch/v1
title: Multi-block patch
chassis: E46
modules:
  - module: LCM
    custom_psws:
      - fsw: FSW_DRL
        keyword: a
        data: "11"
    edits:
      FSW_DRL: a
  - module: LCM
    custom_psws:
      - fsw: FSW_DRL
        keyword: b
        data: "22"
    edits:
      FSW_DRL: b
`);
    const lcm = extractCustomPsws(patch).get('LCM')!;
    expect(lcm).toHaveLength(2);
    expect(lcm.map((e) => e.pswKeyword)).toEqual(['a', 'b']);
  });
});

describe('schema validation', () => {
  it('rejects custom_psws entries with non-hex data', () => {
    expect(() =>
      parsePatch(`
schema: ncsx-patch/v1
title: Bad data
chassis: E46
modules:
  - module: LCM
    custom_psws:
      - fsw: FSW_DRL
        keyword: invalid
        data: "not hex"
    edits:
      FSW_DRL: invalid
`),
    ).toThrow(/hex/i);
  });

  it('rejects custom_psws entries with odd digit count', () => {
    expect(() =>
      parsePatch(`
schema: ncsx-patch/v1
title: Odd
chassis: E46
modules:
  - module: LCM
    custom_psws:
      - fsw: FSW_DRL
        keyword: x
        data: "ABC"
    edits:
      FSW_DRL: x
`),
    ).toThrow(/even number of hex digits/);
  });
});
