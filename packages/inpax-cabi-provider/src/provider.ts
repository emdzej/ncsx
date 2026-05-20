/**
 * `@emdzej/ncsx-inpax-cabi-provider` — implements the ~80 CDH* functions
 * NCSEXPER's A_*.ipo dispatchers call via the IPO interpreter's CALLE bridge.
 *
 * The 1:1 source-of-truth for signatures is `NCSEXPER/SGDAT/CABI.H` (cited per
 * function below). Behaviour is verified against NCSEXPER.EXE via ghidra MCP —
 * the `// behaviour:` lines call out the function address whenever a real impl
 * lands so the next reader can trace through.
 *
 * Strategy:
 * - **Every CDH function from CABI.H + the ghidra string table is declared
 *   here** with its correct in/out signature. Future agents add implementations
 *   to existing scaffolding rather than re-deriving names.
 * - **Stubs throw `CdhNotImplementedError`** with the function name + a one-line
 *   hint. The runtime catches these at the dispatcher boundary, logs them, and
 *   surfaces "CDH X not implemented" so we triage WHICH functions the current
 *   flow actually needs.
 * - **Critical functions are implemented inline** — minimum set to make
 *   `FgnrLesen` / `Cod` / `Lesen` / `ZcsLesen` handlers run end-to-end.
 *
 * Per the `AGENTS.md` rule "always verify with ghidra": when adding behaviour
 * for a stub, run `mcp__ghidra__decompile_function_by_address` first and cite
 * the address in the `behaviour:` comment.
 */

import {
  COAPI_OK,
  COAPI_ERROR,
  COAPI_DIABAS_ERROR,
  COAPI_DIABAS_INIT_ERROR,
  COAPI_PAR_ERROR,
} from './error-codes.js';
import type { CdhContext, CdhResult } from './types.js';

export class CdhNotImplementedError extends Error {
  constructor(name: string, hint?: string) {
    super(`CDH function ${name} is not implemented yet${hint ? ` — ${hint}` : ''}`);
    this.name = 'CdhNotImplementedError';
  }
}

/**
 * Stash of `apiResultText`-style data the EDIABAS layer just returned. Populated
 * by `CDHapiJob` and read by `CDHapiResult*`. NCSEXPER's COAPI keeps an equivalent
 * stash in `CDH-LIB` (ghidra address `0x005af9f0`).
 */
interface LastJobState {
  /** Result sets in emission order (from `Ediabas.executeJob`). */
  sets: Array<Map<string, unknown>>;
  jobStatus: string;
}

export class CabiProvider {
  protected ctx: CdhContext;
  protected lastJob: LastJobState = { sets: [], jobStatus: '' };
  /** Whether the host already called `CDHapiInit`. Mirrors NCSEXPER's COAPI gate. */
  protected initialised = false;

  constructor(ctx: CdhContext) {
    this.ctx = ctx;
  }

  /** Replace the live context — used when the user switches chassis / SG. */
  setContext(next: Partial<CdhContext>): void {
    this.ctx = { ...this.ctx, ...next };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EDIABAS bridge — implemented
  // ───────────────────────────────────────────────────────────────────────────

  /** `extern CDHapiInit( );` — IPO calls this once before any apiJob. */
  // behaviour: NCSEXPER's `coapiApiInit` (FUN_*) lazy-loads EDIABAS via apiInit.
  // For us EDIABAS is already initialised by the time the IPO runs; this is a
  // no-op that just sets the `initialised` gate.
  async CDHapiInit(): Promise<CdhResult> {
    if (!this.ctx.ediabas) return { retVal: COAPI_DIABAS_INIT_ERROR };
    this.initialised = true;
    return { retVal: COAPI_OK };
  }

  /** `extern CDHapiEnd( );` — IPO calls this on shutdown. */
  async CDHapiEnd(): Promise<CdhResult> {
    this.initialised = false;
    this.lastJob = { sets: [], jobStatus: '' };
    return { retVal: COAPI_OK };
  }

  /**
   * `extern CDHapiJob( in: string ecu, in: string job, in: string para, in: string result );`
   * — the workhorse. Loads the SGBD and runs the job; stashes results for the
   * subsequent `CDHapiResult*` calls.
   */
  // behaviour: NCSEXPER routes this through `FUN_00433a70` which loads the SGBD,
  // sets the JOBNAME global, and runs the IPO interpreter. From inpax's side
  // we're already INSIDE the interpreter — so we just delegate to apiJob.
  async CDHapiJob(
    ecu: string,
    job: string,
    para: string,
    _result: string,
  ): Promise<CdhResult> {
    if (!this.ctx.ediabas) return { retVal: COAPI_DIABAS_INIT_ERROR };
    if (!ecu || !job) return { retVal: COAPI_PAR_ERROR };
    try {
      await this.ctx.ediabas.loadSgbd(ecu);
      const sets = await this.ctx.ediabas.executeJob(job, {
        params: para ? [para] : undefined,
      });
      this.lastJob.sets = sets.map((set) => {
        const map = new Map<string, unknown>();
        for (const r of set) map.set(r.name, r.value);
        return map;
      });
      const jobStatus = this.findResult('JOB_STATUS');
      this.lastJob.jobStatus =
        typeof jobStatus === 'string' ? jobStatus : String(jobStatus ?? '');
      return { retVal: COAPI_OK };
    } catch (err) {
      // EDIABAS layer threw — typically a transport / SGBD-load failure. Stash
      // an error breadcrumb on jobStatus so a follow-up CDHapiCheckJobStatus
      // doesn't see a stale OK from a previous job.
      this.lastJob = {
        sets: [],
        jobStatus: err instanceof Error ? err.message : String(err),
      };
      return { retVal: COAPI_DIABAS_ERROR };
    }
  }

  /**
   * `extern CDHapiResultText( out: string ResultText, in: string ApiResult,
   *   in: int ApiSet, in: string ApiFormat );`
   */
  async CDHapiResultText(
    apiResult: string,
    apiSet: number,
    _apiFormat: string,
  ): Promise<CdhResult<{ resultText: string }>> {
    const v = this.findResultInSet(apiResult, apiSet);
    if (v === undefined) return { retVal: COAPI_ERROR };
    return {
      retVal: COAPI_OK,
      out: { resultText: typeof v === 'string' ? v : String(v) },
    };
  }

  /** `CDHapiResultInt( out: int ResultVal, in: string ApiResult, in: int ApiSet );` */
  async CDHapiResultInt(
    apiResult: string,
    apiSet: number,
  ): Promise<CdhResult<{ resultVal: number }>> {
    const v = this.findResultInSet(apiResult, apiSet);
    if (v === undefined) return { retVal: COAPI_ERROR };
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return { retVal: COAPI_ERROR };
    return { retVal: COAPI_OK, out: { resultVal: n } };
  }

  /** `CDHapiResultDigital( out: bool ResultVal, in: string ApiResult, in: int ApiSet );` */
  async CDHapiResultDigital(
    apiResult: string,
    apiSet: number,
  ): Promise<CdhResult<{ resultVal: boolean }>> {
    const v = this.findResultInSet(apiResult, apiSet);
    if (v === undefined) return { retVal: COAPI_ERROR };
    return { retVal: COAPI_OK, out: { resultVal: Boolean(v) } };
  }

  /** `CDHapiResultAnalog( out: real ResultVal, in: string ApiResult, in: int ApiSet );` */
  async CDHapiResultAnalog(
    apiResult: string,
    apiSet: number,
  ): Promise<CdhResult<{ resultVal: number }>> {
    const v = this.findResultInSet(apiResult, apiSet);
    if (v === undefined) return { retVal: COAPI_ERROR };
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return { retVal: COAPI_ERROR };
    return { retVal: COAPI_OK, out: { resultVal: n } };
  }

  /** `CDHapiResultSets( out: int sets );` */
  async CDHapiResultSets(): Promise<CdhResult<{ sets: number }>> {
    return { retVal: COAPI_OK, out: { sets: this.lastJob.sets.length } };
  }

  /** `CDHapiCheckJobStatus( in: string RefStr );` */
  async CDHapiCheckJobStatus(refStr: string): Promise<CdhResult> {
    return {
      retVal: this.lastJob.jobStatus === refStr ? COAPI_OK : COAPI_DIABAS_ERROR,
    };
  }

  /** `CDHResetApiJobData( );` */
  async CDHResetApiJobData(): Promise<CdhResult> {
    this.lastJob = { sets: [], jobStatus: '' };
    return { retVal: COAPI_OK };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Context getters — implemented (read from CdhContext)
  // ───────────────────────────────────────────────────────────────────────────

  /** `CDHGetCabdName( out: string CabdName, out: int RetVal );` — ghidra: 0x005afbc4. */
  async CDHGetCabdName(): Promise<CdhResult<{ cabdName: string }>> {
    return {
      retVal: COAPI_OK,
      out: { cabdName: this.ctx.currentCabd ?? '' },
    };
  }

  /** `CDHGetSgbdName( out: string SgbdName, out: int RetVal );` — ghidra: 0x005afbd4. */
  async CDHGetSgbdName(): Promise<CdhResult<{ sgbdName: string }>> {
    const row = this.ctx.currentSgName
      ? this.ctx.chassis?.sgfam.get(this.ctx.currentSgName)
      : undefined;
    return { retVal: COAPI_OK, out: { sgbdName: row?.sgbd ?? '' } };
  }

  /** `CDHSetSgName( in: string SgName, out: int RetVal );` — ghidra: 0x005afa9c. */
  async CDHSetSgName(sgName: string): Promise<CdhResult> {
    this.ctx.currentSgName = sgName;
    return { retVal: COAPI_OK };
  }

  /** `CDHGetCodierBaureihe` (returns current chassis code) — ghidra: 0x005afc60. */
  async CDHGetCodierBaureihe(): Promise<CdhResult<{ baureihe: string }>> {
    return {
      retVal: COAPI_OK,
      out: { baureihe: this.ctx.currentCodierBaureihe ?? this.ctx.chassis?.code ?? '' },
    };
  }

  /** `CDHSetBaureihe( in: string Baureihe, out: int RetVal );` — ghidra: 0x005afc78. */
  async CDHSetBaureihe(baureihe: string): Promise<CdhResult> {
    this.ctx.currentCodierBaureihe = baureihe;
    return { retVal: COAPI_OK };
  }

  /**
   * `CDHIdReady( out: bool IdReady );` — true when CDHCheckIdent has succeeded
   * for the current SG. We stub `true` while CDHCheckIdent is unimplemented;
   * scripts treat this as "skip the auth retry path".
   */
  async CDHIdReady(): Promise<CdhResult<{ idReady: boolean }>> {
    return { retVal: COAPI_OK, out: { idReady: true } };
  }

  /** `CDHSetReturnVal( in: int Wert );` — script-side return-value setter. */
  async CDHSetReturnVal(_wert: number): Promise<CdhResult> {
    // Captured by the interpreter; we just return OK so the IPO can chain.
    return { retVal: COAPI_OK };
  }

  /** `CDHResetError( );` */
  async CDHResetError(): Promise<CdhResult> {
    return { retVal: COAPI_OK };
  }

  /** `CDHTestError( out: int ErrNr );` */
  async CDHTestError(): Promise<CdhResult<{ errNr: number }>> {
    return { retVal: COAPI_OK, out: { errNr: 0 } };
  }

  /** `CDHDelay( in: int d );` — milliseconds. */
  async CDHDelay(d: number): Promise<CdhResult> {
    await new Promise((r) => setTimeout(r, d));
    return { retVal: COAPI_OK };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Stubs — throw CdhNotImplementedError. Add behaviour as needed, citing the
  // ghidra address in a `// behaviour:` line.
  // ───────────────────────────────────────────────────────────────────────────

  async CDHapiResultBinary(
    _bufHandle: number,
    _apiResult: string,
    _apiSet: number,
  ): Promise<CdhResult<{ retVal: number }>> {
    throw new CdhNotImplementedError('CDHapiResultBinary', 'binary result fetch — needs BinBuf');
  }

  async CDHapiJobData(
    _ecu: string,
    _job: string,
    _bufHandle: number,
    _bufSize: number,
    _result: string,
  ): Promise<CdhResult> {
    throw new CdhNotImplementedError(
      'CDHapiJobData',
      'apiJob with binary param from BinBuf',
    );
  }

  async CDHGetApiJobData(
    _maxData: number,
    _bufHandle: number,
  ): Promise<CdhResult<{ bufSize: number; nrOfData: number; dataType: number }>> {
    throw new CdhNotImplementedError('CDHGetApiJobData');
  }

  async CDHGetApiJobByteData(
    _maxData: number,
    _bufHandle: number,
  ): Promise<CdhResult<{ bufSize: number; nrOfData: number }>> {
    throw new CdhNotImplementedError('CDHGetApiJobByteData');
  }

  // ── ZCS / FA / coding-key lookup ────────────────────────────────────────────

  async CDHGetFswPswFromZcs(
    _gm: string,
    _sa: string,
    _vn: string,
  ): Promise<CdhResult> {
    throw new CdhNotImplementedError(
      'CDHGetFswPswFromZcs',
      'decode ZCS → FSW/PSW list via ZST',
    );
  }

  async CDHGetFswPswFromCvt(): Promise<CdhResult> {
    throw new CdhNotImplementedError(
      'CDHGetFswPswFromCvt',
      'decode CVT → FSW/PSW list',
    );
  }

  async CDHGetBaureiheFromZcs(
    _gm: string,
    _sa: string,
    _vn: string,
  ): Promise<CdhResult<{ baureihe: string }>> {
    throw new CdhNotImplementedError(
      'CDHGetBaureiheFromZcs',
      'derive chassis code from ZCS bytes',
    );
  }

  async CDHGetVmZcsProgName(): Promise<CdhResult<{ progName: string }>> {
    throw new CdhNotImplementedError('CDHGetVmZcsProgName');
  }

  async CDHGetVmGerName(): Promise<CdhResult<{ gerName: string }>> {
    throw new CdhNotImplementedError('CDHGetVmGerName');
  }

  async CDHGetFaVersion(): Promise<CdhResult<{ version: string }>> {
    throw new CdhNotImplementedError(
      'CDHGetFaVersion',
      'FA chassis prefix (E46_, E60_, etc.)',
    );
  }

  async CDHGetAnzahlFaElemente(): Promise<CdhResult<{ anzahl: number }>> {
    throw new CdhNotImplementedError('CDHGetAnzahlFaElemente');
  }

  async CDHGetFaElement(
    _typ: string,
    _firstElement: boolean,
  ): Promise<CdhResult<{ element: string }>> {
    throw new CdhNotImplementedError('CDHGetFaElement');
  }

  // ── System / CABD parameters ────────────────────────────────────────────────

  async CDHSetSystemData(_bezeichner: string, _wert: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHSetSystemData');
  }

  async CDHGetSystemData(_bezeichner: string): Promise<CdhResult<{ wert: string }>> {
    throw new CdhNotImplementedError('CDHGetSystemData');
  }

  async CDHSetCabdPar(_bezeichner: string, _wert: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHSetCabdPar');
  }

  async CDHGetCabdPar(_bezeichner: string): Promise<CdhResult<{ wert: string }>> {
    throw new CdhNotImplementedError('CDHGetCabdPar');
  }

  async CDHSetCabdWordPar(_bezeichner: string, _wert: number): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHSetCabdWordPar');
  }

  async CDHGetCabdWordPar(_bezeichner: string): Promise<CdhResult<{ wert: number }>> {
    throw new CdhNotImplementedError('CDHGetCabdWordPar');
  }

  async CDHSetCbdName(_cbdName: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHSetCbdName');
  }

  async CDHSetDataOrg(
    _wortBreite: number,
    _byteFolge: number,
    _adrMode: number,
  ): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHSetDataOrg');
  }

  async CDHReadSget(): Promise<CdhResult<{ sgList: string }>> {
    throw new CdhNotImplementedError(
      'CDHReadSget',
      'walk SGAUSWAHL_* and return matched SG list',
    );
  }

  // ── FSW / PSW manipulation ──────────────────────────────────────────────────

  async CDHActivateFsw(_fsw: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHActivateFsw');
  }

  async CDHInactivateFsw(_fsw: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHInactivateFsw');
  }

  async CDHActivateAllFsw(): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHActivateAllFsw');
  }

  async CDHInactivateAllFsw(): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHInactivateAllFsw');
  }

  async CDHActivateGrp(_gruppe: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHActivateGrp');
  }

  async CDHInactivateGrp(_gruppe: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHInactivateGrp');
  }

  async CDHChangePsw(_fsw: string, _psw: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHChangePsw');
  }

  async CDHSaveFswPswList(): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHSaveFswPswList');
  }

  async CDHRestoreFswPswList(): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHRestoreFswPswList');
  }

  async CDHSaveTmpFswPswList(): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHSaveTmpFswPswList');
  }

  async CDHRestoreTmpFswPswList(): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHRestoreTmpFswPswList');
  }

  // ── Identity / Info ─────────────────────────────────────────────────────────

  async CDHGetInfo(
    _bezeichner: string,
    _infoNr: number,
  ): Promise<CdhResult<{ info: string; nrOfInfo: number }>> {
    throw new CdhNotImplementedError(
      'CDHGetInfo',
      'INFO job dispatch + result formatting',
    );
  }

  async CDHCheckIdent(
    _bezeichner: string,
    _id1: string,
    _id2: string,
  ): Promise<CdhResult> {
    throw new CdhNotImplementedError(
      'CDHCheckIdent',
      'verify SG-Ident matches expected (CDNR/HWNR)',
    );
  }

  async CDHCheckIdent2(_bezeichner: string, _id1: number): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHCheckIdent2');
  }

  // ── CABD data fetch ─────────────────────────────────────────────────────────

  async CDHGetFswDataFromCbd(_fsw: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHGetFswDataFromCbd');
  }

  async CDHGetFswPswDataFromCbd(_fsw: string, _psw: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHGetFswPswDataFromCbd');
  }

  async CDHGetGrpDataFromCbd(_gruppe: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHGetGrpDataFromCbd');
  }

  async CDHGetNettoDataFromCbd(): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHGetNettoDataFromCbd');
  }

  async CDHGetNettoMaskFromCbd(): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHGetNettoMaskFromCbd');
  }

  async CDHGetFswPswFromNettoData(_outFileName: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHGetFswPswFromNettoData');
  }

  async CDHCheckDataUsed(): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHCheckDataUsed');
  }

  // ── BinBuf — binary buffer handle API ───────────────────────────────────────

  async CDHBinBufCreate(): Promise<CdhResult<{ bufHandle: number }>> {
    throw new CdhNotImplementedError('CDHBinBufCreate');
  }

  async CDHBinBufDelete(_bufHandle: number): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHBinBufDelete');
  }

  async CDHBinBufWriteByte(
    _bufHandle: number,
    _byteVal: number,
    _position: number,
  ): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHBinBufWriteByte');
  }

  async CDHBinBufWriteWord(
    _bufHandle: number,
    _wordVal: number,
    _position: number,
  ): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHBinBufWriteWord');
  }

  async CDHBinBufReadByte(
    _bufHandle: number,
    _position: number,
  ): Promise<CdhResult<{ byteVal: number }>> {
    throw new CdhNotImplementedError('CDHBinBufReadByte');
  }

  async CDHBinBufReadWord(
    _bufHandle: number,
    _position: number,
  ): Promise<CdhResult<{ wordVal: number }>> {
    throw new CdhNotImplementedError('CDHBinBufReadWord');
  }

  async CDHBinBufToStr(
    _bufHandle: number,
  ): Promise<CdhResult<{ binBufStr: string }>> {
    throw new CdhNotImplementedError('CDHBinBufToStr');
  }

  async CDHBinBufToNettoData(_bufHandle: number): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHBinBufToNettoData');
  }

  // ── Authentication ──────────────────────────────────────────────────────────

  async CDHCallAuthenticate(
    _sgFamilie: string,
    _userId: string,
    _stgId: string,
    _type: string,
    _sgrndHdl: number,
    _level: string,
    _responseHdl: number,
  ): Promise<CdhResult<{ responseLen: number }>> {
    throw new CdhNotImplementedError('CDHCallAuthenticate', 'SG seed/key auth');
  }

  async CDHAuthGetRandom(): Promise<CdhResult<{ rndBin: string; rndAsc: string }>> {
    throw new CdhNotImplementedError('CDHAuthGetRandom');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Public accessor for any named result from the most recent `CDHapiJob` call.
   * Walks every result set in emission order and returns the first match. Used
   * by host orchestrator code to read e.g. `FAHRGESTELL_NR` after running the
   * IPO without going through another `CDHapiResultText` syscall.
   */
  findResult(name: string): unknown {
    for (const set of this.lastJob.sets) {
      const v = set.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  /** Last seen `JOB_STATUS` from the most recent `CDHapiJob`. `'OKAY'` on success. */
  get lastJobStatus(): string {
    return this.lastJob.jobStatus;
  }

  protected findResultInSet(name: string, setIndex: number): unknown {
    // EDIABAS sets are 1-indexed by convention; index 0 is the system/metadata set.
    const idx = setIndex === 0 ? 0 : setIndex - 1;
    const set = this.lastJob.sets[idx];
    return set?.get(name);
  }
}
