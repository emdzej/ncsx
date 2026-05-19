import { describe, expect, it, vi } from 'vitest';
import type { CodingPlan } from '@emdzej/ncsx-coder';
import { applyCodingPlan, identify, readCoding, readCodingIndex } from './coding.js';
import type { EdiabasJobResultLike, EdiabasLike } from './types.js';

function fakeEdiabas(
  executeJob: () => Promise<EdiabasJobResultLike[][]>,
): EdiabasLike {
  return {
    loadSgbd: vi.fn().mockResolvedValue(undefined),
    executeJob: vi.fn().mockImplementation(executeJob),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

const okSet = (extras: EdiabasJobResultLike[]): EdiabasJobResultLike[][] => [[
  { name: 'JOB_STATUS', type: 'string', value: 'OKAY' },
  ...extras,
]];

describe('readCoding', () => {
  it('returns parsed netto when CODIERDATEN is a hex string', async () => {
    const ediabas = fakeEdiabas(() =>
      Promise.resolve(okSet([{ name: 'CODIERDATEN', type: 'string', value: 'DEADBEEF42' }])),
    );
    const result = await readCoding(ediabas, 'KMBI_E60');
    expect(result.ok).toBe(true);
    expect(Array.from(result.netto!)).toEqual([0xde, 0xad, 0xbe, 0xef, 0x42]);
  });

  it('accepts CODIERDATEN as a raw Uint8Array', async () => {
    const ediabas = fakeEdiabas(() =>
      Promise.resolve(okSet([
        { name: 'CODIERDATEN', type: 'binary', value: Uint8Array.from([1, 2, 3]) },
      ])),
    );
    const result = await readCoding(ediabas, 'X');
    expect(result.ok).toBe(true);
    expect(Array.from(result.netto!)).toEqual([1, 2, 3]);
  });

  it('returns not-ok when JOB_STATUS is not OKAY', async () => {
    const ediabas = fakeEdiabas(() =>
      Promise.resolve([[{ name: 'JOB_STATUS', type: 'string', value: 'IFR-Error' }]]),
    );
    const result = await readCoding(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.jobStatus).toBe('IFR-Error');
  });

  it('surfaces thrown errors', async () => {
    const ediabas = fakeEdiabas(() => Promise.reject(new Error('cable unplugged')));
    const result = await readCoding(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('cable unplugged');
  });
});

describe('applyCodingPlan', () => {
  const plan: CodingPlan = {
    sgName: 'KMBI_E60',
    umrsg: 'KMBI',
    sgbd: 'KMBI_E60',
    cabd: 'A_KMBI_E60',
    cbd: 'C06',
    jobName: 'SG_CODIEREN',
    netto: Uint8Array.from([0x01, 0x02, 0x03]),
    applied: [],
    skipped: [],
    source: 'SGBD',
  };

  it('hex-encodes the netto and passes it as params', async () => {
    const executeJob = vi.fn(() => Promise.resolve(okSet([])));
    const ediabas = fakeEdiabas(executeJob);
    await applyCodingPlan(ediabas, plan);
    const mockExec = ediabas.executeJob as ReturnType<typeof vi.fn>;
    expect(mockExec.mock.calls[0]?.[0]).toBe('SG_CODIEREN');
    expect(mockExec.mock.calls[0]?.[1]).toEqual({ params: ['010203'] });
  });

  it('uses the custom job name from the plan', async () => {
    const ediabas = fakeEdiabas(() => Promise.resolve(okSet([])));
    await applyCodingPlan(ediabas, { ...plan, jobName: 'SG_CODIEREN_OHNE_CI' });
    const mockExec = (ediabas.executeJob as ReturnType<typeof vi.fn>);
    expect(mockExec.mock.calls[0]?.[0]).toBe('SG_CODIEREN_OHNE_CI');
  });

  it('throws when the plan has no sgbd', async () => {
    const ediabas = fakeEdiabas(() => Promise.resolve(okSet([])));
    await expect(applyCodingPlan(ediabas, { ...plan, sgbd: '' })).rejects.toThrow(/no sgbd/);
  });

  it('surfaces a non-OKAY job status', async () => {
    const ediabas = fakeEdiabas(() =>
      Promise.resolve([[{ name: 'JOB_STATUS', type: 'string', value: 'ERROR_CODIERINDEX' }]]),
    );
    const result = await applyCodingPlan(ediabas, plan);
    expect(result.ok).toBe(false);
    expect(result.jobStatus).toBe('ERROR_CODIERINDEX');
  });
});

describe('readCodingIndex', () => {
  it('extracts a numeric CODIERINDEX', async () => {
    const ediabas = fakeEdiabas(() =>
      Promise.resolve([[{ name: 'CODIERINDEX', type: 'integer', value: 7 }]]),
    );
    const result = await readCodingIndex(ediabas, 'X');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.codingIndex).toBe(7);
  });

  it('parses a hex-string CODIERINDEX', async () => {
    const ediabas = fakeEdiabas(() =>
      Promise.resolve([[{ name: 'CODIERINDEX', type: 'string', value: '07' }]]),
    );
    const result = await readCodingIndex(ediabas, 'X');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.codingIndex).toBe(7);
  });

  it('returns not-ok when CODIERINDEX is missing', async () => {
    const ediabas = fakeEdiabas(() => Promise.resolve([[]]));
    const result = await readCodingIndex(ediabas, 'X');
    expect(result.ok).toBe(false);
  });
});

describe('identify', () => {
  it('returns ok when the SG responds', async () => {
    const ediabas = fakeEdiabas(() => Promise.resolve(okSet([])));
    const result = await identify(ediabas, 'X');
    expect(result.ok).toBe(true);
  });

  it('returns not-ok when executeJob throws', async () => {
    const ediabas = fakeEdiabas(() => Promise.reject(new Error('no cable')));
    const result = await identify(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no cable');
  });
});
