import { describe, expect, it, vi } from 'vitest';
import type {
  EdiabasJobResponse,
  EdiabasResultEntry,
  EdiabasResultSet,
  IEdiabas,
} from '@emdzej/ncsx-wire';
import { readFa } from './fa.js';
import { readVin } from './vin.js';
import { readZcs } from './zcs.js';

/**
 * Lightweight `IEdiabas` stub. We only fake `job(...)` — every other
 * method throws or no-ops, since the identity helpers don't touch
 * them. `per` is keyed by job name and returns the data-set payload
 * the SGBD would emit; `fakeIEdiabas` adds the standard
 * `sets[0]=system-set-with-JOB_STATUS=OKAY` prefix automatically so
 * the test stays focused on data-set content. Use `nokResponse` for
 * negative cases.
 */
type ResultEntry = Omit<EdiabasResultEntry, 'unit' | 'comment'>;

function asSet(entries: ResultEntry[]): EdiabasResultSet {
  const set: EdiabasResultSet = {};
  for (const e of entries) {
    set[e.name] = { name: e.name, type: e.type, value: e.value };
  }
  return set;
}

function okResponse(extras: ResultEntry[]): EdiabasJobResponse {
  return {
    sets: [
      asSet([{ name: 'JOB_STATUS', type: 'text', value: 'OKAY' }]),
      asSet(extras),
    ],
  };
}

function nokResponse(status: string): EdiabasJobResponse {
  return {
    sets: [
      asSet([{ name: 'JOB_STATUS', type: 'text', value: status }]),
    ],
  };
}

function fakeIEdiabas(per: Map<string, EdiabasJobResponse>): IEdiabas {
  const unsupported = () => {
    throw new Error('not used in identity tests');
  };
  return {
    init: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    job: vi.fn().mockImplementation((_ecu: string, jobName: string) => {
      const hit = per.get(jobName);
      if (!hit) throw new Error(`unknown job ${jobName}`);
      return Promise.resolve(hit);
    }),
    resultSets: vi.fn().mockReturnValue(0),
    resultText: vi.fn().mockReturnValue(''),
    resultInt: vi.fn().mockReturnValue(0),
    resultReal: vi.fn().mockReturnValue(0),
    resultBinary: vi.fn().mockReturnValue([]),
    resultFormat: vi.fn().mockReturnValue(undefined),
    state: vi.fn().mockReturnValue('ready' as const),
    break: vi.fn().mockResolvedValue(undefined),
    errorCode: vi.fn().mockReturnValue(0),
    errorText: vi.fn().mockReturnValue(''),
    /* Helpers in the IEdiabas shape we don't use — but TS requires
       them. Cast to `IEdiabas` so we don't have to fully enumerate. */
    ...({} as Record<string, () => unknown>),
    // satisfy compiler — anything we missed will throw if called.
    valueOf: unsupported,
  } as unknown as IEdiabas;
}

describe('readVin', () => {
  it('extracts a 17-char VIN from FAHRGESTELL_NR (the ghidra-verified field)', async () => {
    const ediabas = fakeIEdiabas(new Map([
      ['FGNR_LESEN', okResponse([
        { name: 'FAHRGESTELL_NR', type: 'text', value: 'WBADM51030GW42718' },
      ])],
    ]));
    const result = await readVin(ediabas, 'KOMBI46R');
    expect(result.ok).toBe(true);
    expect(result.vin).toBe('WBADM51030GW42718');
  });

  it('returns not-ok when the SG NOT-OKs', async () => {
    const ediabas = fakeIEdiabas(new Map([
      ['FGNR_LESEN', nokResponse('SG-NOT-CONNECTED')],
    ]));
    const result = await readVin(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.jobStatus).toBe('SG-NOT-CONNECTED');
  });

  it('returns not-ok when the field comes back as all-zeros (paired placeholder)', async () => {
    const ediabas = fakeIEdiabas(new Map([
      ['FGNR_LESEN', okResponse([
        { name: 'FAHRGESTELL_NR', type: 'text', value: '00000000000000000' },
      ])],
    ]));
    const result = await readVin(ediabas, 'X');
    expect(result.ok).toBe(false);
  });

  it('reports the exception when job() throws', async () => {
    const ediabas = fakeIEdiabas(new Map());
    /* Override `job` to throw — mirrors a transport / loadSgbd error
       (both surface as a rejection from `IEdiabas.job` in the
       merged-call shape). */
    (ediabas.job as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('SGBD not found: ZZZ'),
    );
    const result = await readVin(ediabas, 'ZZZ');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SGBD not found');
  });

  it('reports a useful error when FAHRGESTELL_NR is missing from the response', async () => {
    const ediabas = fakeIEdiabas(new Map([
      ['FGNR_LESEN', okResponse([{ name: 'SOMETHING_ELSE', type: 'text', value: 'X' }])],
    ]));
    const result = await readVin(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('FAHRGESTELL_NR');
  });
});

describe('readFa', () => {
  it('extracts FA from the FA_STREAM result of the FA_READ job', async () => {
    const ediabas = fakeIEdiabas(new Map([
      ['FA_READ', okResponse([
        { name: 'FA_STREAM', type: 'text', value: 'E46_#0306&N6SW%0354$167$1CA$205' },
      ])],
    ]));
    const result = await readFa(ediabas, 'KOMBI46R');
    expect(result.ok).toBe(true);
    expect(result.fa).toBe('E46_#0306&N6SW%0354$167$1CA$205');
  });

  it('returns not-ok when the SG NOT-OKs', async () => {
    const ediabas = fakeIEdiabas(new Map([
      ['FA_READ', nokResponse('IFH-0009: ERROR_NR_JOB_NOT_FOUND')],
    ]));
    const result = await readFa(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.jobStatus).toBe('IFH-0009: ERROR_NR_JOB_NOT_FOUND');
  });

  it('returns not-ok when FA_STREAM is missing from the response', async () => {
    const ediabas = fakeIEdiabas(new Map([
      ['FA_READ', okResponse([{ name: 'INFO', type: 'text', value: 'no FA' }])],
    ]));
    const result = await readFa(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('FA_STREAM');
  });

  it('reports the exception when job() throws', async () => {
    const ediabas = fakeIEdiabas(new Map());
    (ediabas.job as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cable unplugged'),
    );
    const result = await readFa(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('cable unplugged');
  });
});

describe('readZcs', () => {
  it('extracts GM / SA / VN from three separate text fields (ghidra-verified)', async () => {
    const ediabas = fakeIEdiabas(new Map([
      ['ZCS_LESEN', okResponse([
        { name: 'GM_SCHLUESSEL', type: 'text', value: 'AAA0' },
        { name: 'SA_SCHLUESSEL', type: 'text', value: '0123456789ABCDEF' },
        { name: 'VN_SCHLUESSEL', type: 'text', value: '0001' },
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
    const ediabas = fakeIEdiabas(new Map([
      ['ZCS_LESEN', nokResponse('SG-NOT-CONNECTED')],
    ]));
    const result = await readZcs(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.jobStatus).toBe('SG-NOT-CONNECTED');
  });

  it('returns not-ok when any of GM/SA/VN is missing — names every missing field', async () => {
    const ediabas = fakeIEdiabas(new Map([
      ['ZCS_LESEN', okResponse([
        { name: 'GM_SCHLUESSEL', type: 'text', value: 'AAA0' },
        // SA and VN missing
      ])],
    ]));
    const result = await readZcs(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SA_SCHLUESSEL');
    expect(result.error).toContain('VN_SCHLUESSEL');
  });

  it('reports the exception when job() throws', async () => {
    const ediabas = fakeIEdiabas(new Map());
    (ediabas.job as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('SGBD not found'),
    );
    const result = await readZcs(ediabas, 'X');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SGBD not found');
  });
});
