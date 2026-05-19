import { describe, expect, it, vi } from 'vitest';
import type { EdiabasJobResultLike, EdiabasLike } from '@emdzej/ncsx-wire';
import { readFa } from './fa.js';
import { readVin } from './vin.js';
import { readZcs } from './zcs.js';

function fakeEdiabas(
  per: Map<string, EdiabasJobResultLike[][]>,
): EdiabasLike {
  return {
    loadSgbd: vi.fn().mockResolvedValue(undefined),
    executeJob: vi.fn().mockImplementation((job: string) => {
      const hit = per.get(job);
      if (!hit) throw new Error(`unknown job ${job}`);
      return Promise.resolve(hit);
    }),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

const okResult = (extras: EdiabasJobResultLike[]): EdiabasJobResultLike[][] => [[
  { name: 'JOB_STATUS', type: 'string', value: 'OKAY' },
  ...extras,
]];

const nokResult = (status: string): EdiabasJobResultLike[][] => [[
  { name: 'JOB_STATUS', type: 'string', value: status },
]];

describe('readVin', () => {
  it('extracts a 17-char VIN from FAHRGESTELL_NR (the ghidra-verified field)', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['FGNR_LESEN', okResult([
        { name: 'FAHRGESTELL_NR', type: 'string', value: 'WBADM51030GW42718' },
      ])],
    ]));
    const result = await readVin(ediabas, 'KOMBI46R');
    expect(result.ok).toBe(true);
    expect(result.vin).toBe('WBADM51030GW42718');
  });

  it('returns not-ok when the SG NOT-OKs', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['FGNR_LESEN', nokResult('SG-NOT-CONNECTED')],
    ]));
    const result = await readVin(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.jobStatus).toBe('SG-NOT-CONNECTED');
  });

  it('returns not-ok when the field comes back as all-zeros (paired placeholder)', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['FGNR_LESEN', okResult([
        { name: 'FAHRGESTELL_NR', type: 'string', value: '00000000000000000' },
      ])],
    ]));
    const result = await readVin(ediabas, 'X');
    expect(result.ok).toBe(false);
  });

  it('reports the exception when loadSgbd throws', async () => {
    const ediabas: EdiabasLike = {
      loadSgbd: vi.fn().mockRejectedValue(new Error('SGBD not found: ZZZ')),
      executeJob: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    };
    const result = await readVin(ediabas, 'ZZZ');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SGBD not found');
  });

  it('reports a useful error when FAHRGESTELL_NR is missing from the response', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['FGNR_LESEN', okResult([{ name: 'SOMETHING_ELSE', type: 'string', value: 'X' }])],
    ]));
    const result = await readVin(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('FAHRGESTELL_NR');
  });
});

describe('readFa', () => {
  it('extracts FA from the FA_STREAM result of the FA_READ job', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['FA_READ', okResult([
        { name: 'FA_STREAM', type: 'string', value: 'E46_#0306&N6SW%0354$167$1CA$205' },
      ])],
    ]));
    const result = await readFa(ediabas, 'KOMBI46R');
    expect(result.ok).toBe(true);
    expect(result.fa).toBe('E46_#0306&N6SW%0354$167$1CA$205');
  });

  it('returns not-ok when the SG NOT-OKs', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['FA_READ', nokResult('IFH-0009: ERROR_NR_JOB_NOT_FOUND')],
    ]));
    const result = await readFa(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.jobStatus).toBe('IFH-0009: ERROR_NR_JOB_NOT_FOUND');
  });

  it('returns not-ok when FA_STREAM is missing from the response', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['FA_READ', okResult([{ name: 'INFO', type: 'string', value: 'no FA' }])],
    ]));
    const result = await readFa(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('FA_STREAM');
  });

  it('reports the exception when executeJob throws', async () => {
    const ediabas: EdiabasLike = {
      loadSgbd: vi.fn().mockResolvedValue(undefined),
      executeJob: vi.fn().mockRejectedValue(new Error('cable unplugged')),
      isConnected: vi.fn().mockReturnValue(true),
    };
    const result = await readFa(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('cable unplugged');
  });
});

describe('readZcs', () => {
  it('extracts GM / SA / VN from three separate text fields (ghidra-verified)', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['ZCS_LESEN', okResult([
        { name: 'GM_SCHLUESSEL', type: 'string', value: 'AAA0' },
        { name: 'SA_SCHLUESSEL', type: 'string', value: '0123456789ABCDEF' },
        { name: 'VN_SCHLUESSEL', type: 'string', value: '0001' },
      ])],
    ]));
    const result = await readZcs(ediabas, 'C_KMB46');
    expect(result.ok).toBe(true);
    expect(result.zcs).toEqual({
      gm: 'AAA0',
      sa: '0123456789ABCDEF',
      vn: '0001',
    });
  });

  it('returns not-ok when the SG NOT-OKs', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['ZCS_LESEN', nokResult('SG-NOT-CONNECTED')],
    ]));
    const result = await readZcs(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.jobStatus).toBe('SG-NOT-CONNECTED');
  });

  it('returns not-ok when any of GM/SA/VN is missing — names every missing field', async () => {
    const ediabas = fakeEdiabas(new Map([
      ['ZCS_LESEN', okResult([
        { name: 'GM_SCHLUESSEL', type: 'string', value: 'AAA0' },
        // SA and VN missing
      ])],
    ]));
    const result = await readZcs(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SA_SCHLUESSEL');
    expect(result.error).toContain('VN_SCHLUESSEL');
  });

  it('reports the exception when loadSgbd throws', async () => {
    const ediabas: EdiabasLike = {
      loadSgbd: vi.fn().mockRejectedValue(new Error('SGBD not found')),
      executeJob: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    };
    const result = await readZcs(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SGBD not found');
  });
});
