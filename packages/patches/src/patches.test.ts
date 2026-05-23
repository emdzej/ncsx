import { describe, expect, it } from 'vitest';
import type { FunctionList } from '@emdzej/ncsx-function-list';
import {
  mergeModulePatch,
  modulesForCurrent,
  parsePatch,
  PatchSchemaError,
  resolveModulePatch,
  serializePatch,
  targetsToEdits,
  type PatchFile,
} from './index.js';

const SAMPLE: PatchFile = {
  schema: 'ncsx-patch/v1',
  title: 'DRL via parking lights',
  description: 'Activates running lights through the front parking lamps.\nEuro feature; missing on US-spec cars.',
  author: 'emdzej',
  keywords: ['DRL', 'lights', 'retrofit'],
  chassis: 'E46',
  modules: [
    {
      module: 'LCM',
      coding_indexes: ['C06', 'C07'],
      require_current: { TFL_LICHTHUPE: 'nicht_aktiv' },
      edits: {
        TFL_FUNKTION: 'aktiv',
        TFL_LICHTHUPE: 'aktiv',
        STANDLICHT_TFL: 'aktiv',
      },
    },
  ],
};

const TFL_FUNKTION_FSW = 100;
const TFL_LICHTHUPE_FSW = 101;
const STANDLICHT_FSW = 102;
const AKTIV_PSW = 200;
const NICHT_AKTIV_PSW = 201;

function fakeList(): FunctionList {
  return {
    items: [
      {
        kind: 'function',
        fsw: TFL_FUNKTION_FSW,
        fswKeyword: 'TFL_FUNKTION',
        block: 0,
        address: 0,
        length: 1,
        mask: new Uint8Array([0xff]),
        parameters: [
          { psw: AKTIV_PSW, pswKeyword: 'aktiv', data: new Uint8Array([1]) },
          { psw: NICHT_AKTIV_PSW, pswKeyword: 'nicht_aktiv', data: new Uint8Array([0]) },
        ],
      },
      {
        kind: 'function',
        fsw: TFL_LICHTHUPE_FSW,
        fswKeyword: 'TFL_LICHTHUPE',
        block: 0,
        address: 1,
        length: 1,
        mask: new Uint8Array([0xff]),
        parameters: [
          { psw: AKTIV_PSW, pswKeyword: 'aktiv', data: new Uint8Array([1]) },
          { psw: NICHT_AKTIV_PSW, pswKeyword: 'nicht_aktiv', data: new Uint8Array([0]) },
        ],
      },
      {
        kind: 'function',
        fsw: STANDLICHT_FSW,
        fswKeyword: 'STANDLICHT_TFL',
        block: 0,
        address: 2,
        length: 1,
        mask: new Uint8Array([0xff]),
        parameters: [
          { psw: AKTIV_PSW, pswKeyword: 'aktiv', data: new Uint8Array([1]) },
        ],
      },
    ],
    memoryStructure: 'BYTE',
    memoryType: 'FREI',
    deliveryState: new Uint8Array(),
    codingIndices: [],
    hardwareVersions: [],
    softwareVersions: [],
  };
}

describe('serialize / parse round-trip', () => {
  it('round-trips a complete patch', () => {
    const text = serializePatch(SAMPLE);
    const back = parsePatch(text);
    expect(back).toEqual(SAMPLE);
  });

  it('renders multi-line description as block literal', () => {
    const text = serializePatch(SAMPLE);
    expect(text).toContain('description: |');
  });

  it('renders keywords inline (flow style)', () => {
    const text = serializePatch(SAMPLE);
    expect(text).toMatch(/keywords:\s*\[/);
  });

  it('renders coding_indexes inline', () => {
    const text = serializePatch(SAMPLE);
    expect(text).toMatch(/coding_indexes:\s*\[/);
  });
});

describe('parse validation', () => {
  it('rejects wrong schema discriminator', () => {
    expect(() => parsePatch('schema: ncsx-patch/v2\ntitle: x\nchassis: E46\nmodules: [{module: LCM, edits: {A: B}}]')).toThrow(
      PatchSchemaError,
    );
  });

  it('rejects empty edits', () => {
    const bad = 'schema: ncsx-patch/v1\ntitle: x\nchassis: E46\nmodules:\n  - module: LCM\n    edits: {}\n';
    expect(() => parsePatch(bad)).toThrow(PatchSchemaError);
  });

  it('rejects empty modules array', () => {
    expect(() => parsePatch('schema: ncsx-patch/v1\ntitle: x\nchassis: E46\nmodules: []')).toThrow(PatchSchemaError);
  });

  it('accepts minimal valid patch', () => {
    const min = 'schema: ncsx-patch/v1\ntitle: t\nchassis: E46\nmodules:\n  - module: LCM\n    edits:\n      FOO: bar\n';
    const out = parsePatch(min);
    expect(out.modules[0]!.edits).toEqual({ FOO: 'bar' });
  });
});

describe('resolveModulePatch', () => {
  it('resolves all known FSW/PSW pairs', () => {
    const { resolved, warnings } = resolveModulePatch(SAMPLE.modules[0]!, fakeList());
    expect(warnings).toEqual([]);
    expect(resolved.targets).toEqual({
      [TFL_FUNKTION_FSW]: AKTIV_PSW,
      [TFL_LICHTHUPE_FSW]: AKTIV_PSW,
      [STANDLICHT_FSW]: AKTIV_PSW,
    });
  });

  it('warns on unknown FSW and skips it', () => {
    const patch = {
      ...SAMPLE.modules[0]!,
      edits: { ...SAMPLE.modules[0]!.edits, BOGUS_FSW: 'aktiv' },
    };
    const { resolved, warnings } = resolveModulePatch(patch, fakeList());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('BOGUS_FSW');
    expect(resolved.targets[TFL_FUNKTION_FSW]).toBe(AKTIV_PSW);
  });

  it('warns on unknown PSW and skips it', () => {
    const patch = {
      ...SAMPLE.modules[0]!,
      edits: { TFL_FUNKTION: 'voellig_aktiv' },
    };
    const { resolved, warnings } = resolveModulePatch(patch, fakeList());
    expect(warnings[0]).toContain('voellig_aktiv');
    expect(resolved.targets).toEqual({});
  });

  it('warns on coding-index mismatch but still resolves', () => {
    const { warnings } = resolveModulePatch(SAMPLE.modules[0]!, fakeList(), 'C04');
    expect(warnings.some((w) => w.includes('C06') && w.includes('C04'))).toBe(true);
  });

  it('does not warn when current CI matches', () => {
    const { warnings } = resolveModulePatch(SAMPLE.modules[0]!, fakeList(), 'C06');
    expect(warnings).toEqual([]);
  });

  it('does not warn when no coding_indexes declared', () => {
    const patch = { ...SAMPLE.modules[0]!, coding_indexes: undefined };
    const { warnings } = resolveModulePatch(patch, fakeList(), 'C99');
    expect(warnings).toEqual([]);
  });

  it('accepts numeric FSW_<id> / PSW_<id> fallback', () => {
    const patch = {
      module: 'LCM',
      edits: { [`FSW_${TFL_FUNKTION_FSW}`]: `PSW_${AKTIV_PSW}` },
    };
    const { resolved, warnings } = resolveModulePatch(patch, fakeList());
    expect(warnings).toEqual([]);
    expect(resolved.targets).toEqual({ [TFL_FUNKTION_FSW]: AKTIV_PSW });
  });
});

describe('modulesForCurrent', () => {
  it('filters by module name case-insensitively', () => {
    const patch: PatchFile = {
      ...SAMPLE,
      modules: [
        { module: 'LCM', edits: { A: 'b' } },
        { module: 'GM5', edits: { C: 'd' } },
        { module: 'lcm', edits: { E: 'f' } },
      ],
    };
    const hits = modulesForCurrent(patch, 'LCM');
    expect(hits).toHaveLength(2);
  });

  it('returns empty when no module matches', () => {
    expect(modulesForCurrent(SAMPLE, 'KOMBI')).toEqual([]);
  });
});

describe('targetsToEdits', () => {
  it('inverts the FunctionTree targets map back to keyword form', () => {
    const list = fakeList();
    const edits = targetsToEdits(list, {
      [TFL_FUNKTION_FSW]: AKTIV_PSW,
      [TFL_LICHTHUPE_FSW]: NICHT_AKTIV_PSW,
    });
    expect(edits).toEqual({ TFL_FUNKTION: 'aktiv', TFL_LICHTHUPE: 'nicht_aktiv' });
  });

  it('drops entries that have no matching FSW or PSW', () => {
    const list = fakeList();
    const edits = targetsToEdits(list, { 9999: AKTIV_PSW });
    expect(edits).toEqual({});
  });
});

describe('mergeModulePatch', () => {
  it('appends a new module block when name does not match', () => {
    const next = { module: 'GM5', edits: { ZV: 'aktiv' } };
    const out = mergeModulePatch(SAMPLE, next, 'merge');
    expect(out.modules).toHaveLength(2);
    expect(out.modules[1]!.module).toBe('GM5');
  });

  it('replaces a matching block in replace mode', () => {
    const next = { module: 'LCM', edits: { FOO: 'bar' } };
    const out = mergeModulePatch(SAMPLE, next, 'replace');
    expect(out.modules[0]!.edits).toEqual({ FOO: 'bar' });
    expect(out.modules[0]!.coding_indexes).toBeUndefined();
  });

  it('preserves prior edits in merge mode and overlays new ones', () => {
    const next = { module: 'LCM', edits: { TFL_FUNKTION: 'nicht_aktiv', NEW_FSW: 'aktiv' } };
    const out = mergeModulePatch(SAMPLE, next, 'merge');
    expect(out.modules[0]!.edits).toEqual({
      TFL_FUNKTION: 'nicht_aktiv', // overridden
      TFL_LICHTHUPE: 'aktiv', // preserved
      STANDLICHT_TFL: 'aktiv', // preserved
      NEW_FSW: 'aktiv', // added
    });
    expect(out.modules[0]!.coding_indexes).toEqual(['C06', 'C07']);
  });
});
