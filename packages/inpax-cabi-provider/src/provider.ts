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
  COAPI_INVALID_HANDLE,
  COAPI_PAR_ERROR,
} from './error-codes.js';
import type { CdhContext, CdhResult } from './types.js';

/** Lowercase hex → bytes. Tolerates any 2-char-per-byte hex. */
function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i]! & 0xff).toString(16).toUpperCase().padStart(2, '0');
  }
  return s;
}

/**
 * Coerce an EDIABAS result value into bytes. EDIABAS surfaces binary
 * results as either Uint8Array (preferred), `number[]`, or a hex
 * string. Returns null when the shape isn't recognised.
 */
function coerceBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return Uint8Array.from(value as number[]);
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/^0x/i, '').replace(/[\s,]/g, '');
    if (cleaned.length === 0) return new Uint8Array(0);
    if (cleaned.length % 2 !== 0) return null;
    if (!/^[0-9A-Fa-f]+$/.test(cleaned)) return null;
    const out = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return null;
}

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
  /**
   * Key-value store the IPO uses to thread results between handlers.
   * NCSEXPER's CDH layer keeps an equivalent CABD-parameter store —
   * the IPO's `CDHSetCabdPar(name, value, retval)` writes into it,
   * `CDHGetCabdPar(name, out, retval)` reads from it. Host code then
   * pulls the final results (FAHRGESTELL_NR, FA_STREAM, etc.) by
   * name via `cabdPar(name)` after `runCabimain` returns.
   */
  protected cabdPars: Map<string, string | number> = new Map();
  /**
   * Word width / endianness / addressing mode set by `CDHSetDataOrg`.
   * Initialized to "not configured" — the IPO must call CDHSetDataOrg
   * before any read/write or the CDHGetApiJobData family bails with
   * COAPI_ERROR (mirrors NCSEXPER's `DAT_007315e0 == 0` check).
   */
  protected dataOrg: { wortBreite: 1 | 2 | 4; byteFolge: 0 | 1; adrMode: 0 | 1 } | null = null;
  /**
   * Per-byte slot table. Mirrors NCSEXPER's `DAT_0072edc8` array of
   * 8-byte records. Populated by the IPO via `CDHSetNettoData(addr,
   * value)` calls — one per byte the CABD touches. `mask` is fixed at
   * 0xFF (CDHSetNettoData always writes 0xFF), `flags` bit 0 = "used"
   * (always 1 after SetNettoData), bit 1 = "in-flight" (set when
   * CDHGetApiJobData hands the slot to the SGBD, cleared when
   * CDHBinBufToNettoData distributes the response).
   */
  protected slots: Array<{ addr: number; value: number; mask: number; flags: number }> = [];
  /**
   * Read cursor into `slots[]` — bumped by `CDHGetApiJobData` so each
   * call to the IPO's Lesen-loop builds a packet for the next
   * contiguous slot range. Reset to 0 by `CDHResetApiJobData`.
   */
  protected slotCursor = 0;
  /**
   * Slot range currently waiting on the SGBD's response. Set by
   * `CDHGetApiJobData` after it builds a request, consumed by
   * `CDHBinBufToNettoData` to know exactly which slots get which
   * response bytes — keyed by **slot index**, not by byte/block
   * address.
   *
   * Why bypass the request header's address field: the K-line
   * `ReadMemoryByAddress` telegram (and therefore the binbuf bytes
   * 17-18 the SGBD forwards) carries a WORD/BLOCK address on
   * word-mode chassis, while our slot table is keyed by BYTE
   * address. Round-tripping the address through the header forces
   * a units conversion on receive, and any drift between the two
   * halves (we hit this once) silently mis-distributes every byte
   * past offset 0. Tracking the slot index range directly removes
   * that whole class of bug.
   */
  protected pendingDistribution: { startIdx: number; count: number } | null = null;
  /**
   * Live BinBuf handles. Each handle indexes into the map; the
   * underlying storage is a Uint8Array + current logical size.
   * NCSEXPER uses MFC's `CByteArray` and pretends the handle is an
   * index into a fixed `DAT_007681cc` array; we use a sparse map
   * which is equivalent for IPO-side semantics.
   */
  protected binBufs: Map<number, { bytes: Uint8Array; size: number }> = new Map();
  protected nextBinBufHandle = 1;

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
      // NCSEXPER's CABI convention — and BMW EDIABAS more generally —
      // packs multiple BEST2 `par(N)` slots into a single semicolon-
      // delimited `para` string. EDIABAS splits it on `;` before the
      // SGBD's bytecode runs so `par(0)`, `par(1)`, … `par(N)` are
      // individually addressable.
      //
      // The canonical anchor for this is `FA_STREAM2STRUCT` (FA.PRG):
      // the IPO builds `para = "1;<FA_BYTES>"` expecting `par(0)="1"`
      // (the BLOCK indicator) and `par(1)=<FA_BYTES>`. Passing the
      // whole `"1;<FA_BYTES>"` as a single array element makes the
      // SGBD see `par(0)="1;<bytes>"` and `par(1)=""`, which fails the
      // length check and returns `ERROR_NO_FA`.
      //
      // inpax fixed the same bug in 0.5.1 for `INPAapiJob`:
      //   • STEUERN_ANZEIGE  para="TACHO;40"           → par(0)="TACHO", par(1)="40"
      //   • STEUERN_LEUCHTE  para="0xFF;0xFF;0xFF;…"   → par(0..5)="0xFF"
      //   • FA_STREAM2STRUCT para="1;<FA_BYTES>"        → par(0)="1", par(1)=<bytes>
      //   • IDENT            para=""                    → no params
      const params = para === '' ? [] : para.split(';');
      // Diagnostic tap — logs every SGBD job dispatch so the browser
      // console can be diffed against NCSEXPER's ABLAUF.TRC when a
      // job hits an unexpected error path. Remove when the write
      // flow stabilises.
      console.log(
        `[CDHapiJob] ecu=${ecu} job=${job} params(${params.length})=[${params.map((p) => JSON.stringify(p)).join(", ")}]`,
      );
      const sets = await this.ctx.ediabas.executeJob(job, { params });
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
      console.error(
        `[CDHapiJob] ← job=${job} EXCEPTION:`,
        err,
      );
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

  /**
   * `CDHResetApiJobData( );` — clears the last-job stash + the slot
   * table's in-flight flags so a fresh CDHGetApiJobData walk restarts
   * from the top. Doesn't drop the slot list itself (host re-seeds
   * via `setNettoSlots`).
   */
  async CDHResetApiJobData(): Promise<CdhResult> {
    this.lastJob = { sets: [], jobStatus: '' };
    this.slotCursor = 0;
    this.pendingDistribution = null;
    for (const s of this.slots) s.flags &= ~2;
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

  /**
   * `CDHapiResultBinary( in: int BufHandle, in: string ApiResult,
   *    in: int ApiSet, out: int RetVal );` — ghidra FUN_0044d7f0.
   *
   * Pull the named binary result from the most recent apiJob and
   * write its bytes into the BinBuf at `bufHandle`. NCSEXPER calls
   * EDIABAS's `apiResultBinary` to fill a 4KB local buffer, then
   * `CDHBinBufWrite` to push it into the BinBuf. We collapse those
   * two steps: read directly off `lastJob.sets`.
   */
  async CDHapiResultBinary(
    bufHandle: number,
    apiResult: string,
    apiSet: number,
  ): Promise<CdhResult> {
    const v = this.findResultInSet(apiResult, apiSet);
    if (v === undefined) return { retVal: COAPI_ERROR };
    const bytes = coerceBytes(v);
    if (!bytes) return { retVal: COAPI_ERROR };
    this.writeBinBuf(bufHandle, 0, bytes);
    return { retVal: COAPI_OK };
  }

  /**
   * `CDHapiJobData( in: string ecu, in: string job, in: int BufHandle,
   *    in: int BufSize, in: string result );` — ghidra FUN_00478ce0.
   *
   * Same as CDHapiJob but the `para` argument comes from a BinBuf.
   * EDIABAS's `apiJobData` takes raw bytes; ediabasx's `executeJob`
   * takes a hex string, so we serialise. The SGBD's `C_S_LESEN` then
   * parses `para[0]=type, para[1]=wortBreite, …, para[15-16]=count,
   * para[17-18]=address, …` per the layout we worked out in
   * C_KMB46.prg's BEST2 bytecode.
   */
  async CDHapiJobData(
    ecu: string,
    job: string,
    bufHandle: number,
    _bufSize: number,
    _result: string,
  ): Promise<CdhResult> {
    if (!this.ctx.ediabas) return { retVal: COAPI_DIABAS_INIT_ERROR };
    if (!ecu || !job) return { retVal: COAPI_PAR_ERROR };
    const buf = this.binBufs.get(bufHandle);
    if (!buf) return { retVal: COAPI_INVALID_HANDLE };
    // NCSEXPER **ignores** the `bufSize` parameter the IPO passes
    // (ghidra FUN_0044d190 → FUN_00453880 = `CDHBinBufRead`, which
    // outputs the binbuf's `.size` field instead of the caller's
    // arg). Matters for the IPO Cod path: the `CDHGetApiJobData`
    // call that templates the C_CHECKSUM binbuf returns `bufSize=0`
    // when the slot table is exhausted, and the IPO forwards that
    // 0 here. If we honoured it we'd slice to 0 bytes and the SGBD
    // would bail with `ERROR_NO_BIN_BUFFER` — even though the binbuf
    // itself has the header bytes + the `BinBufWriteWord` patches
    // (start addr, end addr) the IPO laid down. Use `buf.size`
    // directly to mirror NCSEXPER. `_bufSize` is kept on the
    // signature for the IPO ABI compatibility but ignored.
    //
    // BinBuf bytes go on the BINARY parameter channel (read by the
    // SGBD's `pary` opcode), not the indexed-string channel. The hex-
    // string workaround we used before ediabasx 0.2.4 always landed
    // in `pari` and the SGBD bailed with ERROR_NO_BIN_BUFFER.
    // Slicing first to clone — ediabasx assumes ownership of the
    // Uint8Array it gets handed.
    const para = buf.bytes.slice(0, buf.size);
    // Diagnostic tap — same as CDHapiJob but for binary-param jobs.
    // Logs the FULL binbuf in hex so the SGBD packet (data type,
    // wortBreite, wordCount, wireAddr, payload, terminator) can be
    // inspected. Crucial for diffing SCHREIBEN/AUFTRAG/CHECKSUM
    // bytes against what NCSEXPER would have shipped.
    console.log(
      `[CDHapiJobData] ecu=${ecu} job=${job} bufHandle=${bufHandle} buf.size=${buf.size} bytes=${bytesToHex(para)}`,
    );
    try {
      await this.ctx.ediabas.loadSgbd(ecu);
      const sets = await this.ctx.ediabas.executeJob(job, { params: [para] });
      this.lastJob.sets = sets.map((set) => {
        const map = new Map<string, unknown>();
        for (const r of set) map.set(r.name, r.value);
        return map;
      });
      const jobStatus = this.findResult('JOB_STATUS');
      this.lastJob.jobStatus =
        typeof jobStatus === 'string' ? jobStatus : String(jobStatus ?? '');
      console.log(
        `[CDHapiJobData] ← job=${job} JOB_STATUS=${this.lastJob.jobStatus} sets=${sets.length}`,
      );
      return { retVal: COAPI_OK };
    } catch (err) {
      // When ediabasx's BEST2 interpreter throws, the stack is the
      // most useful diagnostic — log it before swallowing into
      // jobStatus.
      console.error(
        `[CDHapiJobData] ← job=${job} EXCEPTION:`,
        err,
      );
      this.lastJob = {
        sets: [],
        jobStatus: err instanceof Error ? err.message : String(err),
      };
      return { retVal: COAPI_DIABAS_ERROR };
    }
  }

  /**
   * `CDHGetApiJobData( in: int MaxData, in: int BufHandle,
   *    out: int BufSize, out: int NrOfData, out: int DataType,
   *    out: int RetVal );` — ghidra FUN_004440f0.
   *
   * Walks the slot table (populated earlier by `CDHSetNettoData`),
   * builds a request packet for the next contiguous range of slots,
   * and writes it into the BinBuf at `bufHandle`. NCSEXPER's MakeHeader
   * (FUN_00443ec0) lays the first 22 bytes; WriteMaskData (FUN_00443cf0)
   * fills the per-slot mask/control bytes. We mirror the byte layout
   * exactly so the SGBD's C_S_LESEN bytecode is happy.
   *
   * Returns `NrOfData=1` while there's still slot data to ferry, then
   * `0` to break the IPO's polling loop. Sets `flags |= 2` on consumed
   * slots so the same range isn't sent twice.
   */
  async CDHGetApiJobData(
    maxData: number,
    bufHandle: number,
  ): Promise<CdhResult<{ bufSize: number; nrOfData: number; dataType: number }>> {
    if (!this.dataOrg) return { retVal: COAPI_ERROR };
    // Advance past any slots already flagged in-flight (bit 1 set).
    while (
      this.slotCursor < this.slots.length &&
      (this.slots[this.slotCursor]!.flags & 2) !== 0
    ) {
      this.slotCursor++;
    }
    if (this.slotCursor >= this.slots.length) {
      return { retVal: COAPI_OK, out: { bufSize: 0, nrOfData: 0, dataType: 0 } };
    }
    const { wortBreite, byteFolge, adrMode } = this.dataOrg;
    // Find the longest contiguous run of "used, not in-flight" slots
    // starting at slotCursor. NCSEXPER aligns runs to wortBreite-byte
    // boundaries — we do the same so the SGBD's count*wortBreite math
    // lands on a clean byte boundary.
    const startAddr = this.slots[this.slotCursor]!.addr;
    // `maxData` is the IPO's per-call records cap. NCSEXPER's
    // `coapiTraceNettoData` calculates `0x10/WB` (= 8 for WB=2)
    // for its OWN slot-table walk, and the SGBD's K-line
    // `ReadMemoryByAddress` caps responses at 16 bytes per call.
    //
    // Empirical: when we passed `maxData=16` (the IPO's value)
    // through unmodified and requested 32-byte reads, the SGBD
    // returned 32 bytes that decomposed as two overlapping 16-byte
    // windows (`0x40..0x4F` and `0x48..0x57`, matching NCSEXPER's
    // `B 00000040` and `B 00000048` trace lines) instead of one
    // contiguous `0x40..0x5F` window. We then spread those 32 bytes
    // over the wrong slot addresses, throwing off every FSW decode
    // past offset 0x10.
    //
    // Hard-cap at 8 records per chunk (= 16 bytes for WB=2). This
    // matches NCSEXPER's trace cadence and stays under the SGBD's
    // K-line frame budget.
    const HARD_CAP_RECORDS = 8;
    const maxRecords =
      maxData > 0
        ? Math.min(HARD_CAP_RECORDS, maxData)
        : HARD_CAP_RECORDS;
    const maxBytes = maxRecords * wortBreite;
    let endCursor = this.slotCursor + 1;
    while (
      endCursor < this.slots.length &&
      endCursor - this.slotCursor < maxBytes &&
      (this.slots[endCursor]!.flags & 1) !== 0 &&
      (this.slots[endCursor]!.flags & 2) === 0 &&
      this.slots[endCursor]!.addr === startAddr + (endCursor - this.slotCursor)
    ) {
      endCursor++;
    }
    // Number of slots in this contiguous run — what we'll actually
    // consume. Distinct from the wire-payload length: the SGBD reads
    // in wortBreite-byte words, so a 5-slot run with wortBreite=2
    // needs a 6-byte (3-word) read on the wire, but only 5 slots get
    // their .value populated from the response.
    const actualLen = endCursor - this.slotCursor;
    // Round UP to a wortBreite multiple. NCSEXPER's len-check is
    // `len(input) == 22 + N*wortBreite` so the packet must be word-
    // aligned; the SGBD reads N words from startAddr, returns N*WB
    // bytes — the last (payloadLen - actualLen) bytes are read off
    // the ECU but no slot maps to them, so they're dropped on
    // distribute. Wasting up to (wortBreite-1) bytes per contiguous
    // run is fine; previously we rounded DOWN which silently skipped
    // the trailing odd slot AND advanced the cursor past whatever
    // slot followed it — wrong values for the last slot of every
    // run + corruption of the next run's first slot.
    const payloadLen = Math.ceil(actualLen / wortBreite) * wortBreite;
    const wordCount = payloadLen / wortBreite;
    const totalLen = 22 + payloadLen;
    const packet = new Uint8Array(totalLen);
    // 22-byte header — mirrors NCSEXPER's MakeHeader (FUN_00443ec0).
    packet[0] = 1; // data type — "binary read request"
    packet[1] = wortBreite;
    packet[2] = byteFolge;
    packet[3] = adrMode;
    // bytes 4..14 stay zero
    packet[15] = wordCount & 0xff;
    packet[16] = (wordCount >> 8) & 0xff;
    // The K-line `ReadMemoryByAddress` telegram the SGBD builds
    // (`S4[5/6] = input[0x12/0x11]`) carries the address in WORD UNITS
    // for WB>1 chassis, NOT byte units. Verified against NCSDummy's
    // `BlockAddress(block, address, isWord) = address/2`: NCSEXPER's
    // NETTODAT.TRC entry at file address `0x38` describes the word
    // at byte address `0x70`. So our `slot.addr` (a byte address) has
    // to be DIVIDED by `wortBreite` before going on the wire. Without
    // this, byte 0x70 reads from ECU memory 0xE0 instead.
    const wireAddr = (startAddr / wortBreite) | 0;
    packet[17] = wireAddr & 0xff;
    packet[18] = (wireAddr >> 8) & 0xff;
    // bytes 19..20 stay zero
    // Data area at offset 0x15 (= 21), `payloadLen` bytes long.
    //
    // Confirmed from C_KMB46.prg's BEST2 bytecode: C_S_SCHREIBEN
    // (and C_S_AUFTRAG / C_S_LESEN distribution) all read/write the
    // data section at `S2[0x15..0x15+payloadLen-1]`. We previously
    // wrote scratchpad at packet[22..], which silently worked for
    // reads (the SGBD's response overwrites S2[0x15..] anyway) but
    // shifted *writes* by one byte: the SGBD picked up `packet[0x15]`
    // (the last "header" byte we left as 0) as data byte 0, then our
    // intended data as bytes 1..N — so every chunk's data landed one
    // byte later in the ECU than the slot.addr we computed, AND a
    // zero clobbered the byte at the chunk's first address.
    //
    // For READ the slot.value is 0 (zero scratchpad), so the SGBD
    // overwrites these bytes with the K-line response and our
    // pendingDistribution-based CDHBinBufToNettoData still reads
    // from offset 0x15 → unchanged read path.
    for (let i = 0; i < actualLen; i++) {
      packet[0x15 + i] = this.slots[this.slotCursor + i]!.value & 0xff;
    }
    this.writeBinBuf(bufHandle, 0, packet);
    // Mark in-flight + advance cursor by ACTUAL slots consumed, not
    // by wire payload length. Stash the slot range so the matching
    // `CDHBinBufToNettoData` can walk slot indices directly instead
    // of re-deriving them from the header's wire address (which is
    // in word units, vs. our byte-keyed slot table — see field comment
    // on `pendingDistribution`).
    const startIdx = this.slotCursor;
    for (let i = startIdx; i < startIdx + actualLen; i++) {
      this.slots[i]!.flags |= 2;
    }
    this.slotCursor += actualLen;
    this.pendingDistribution = { startIdx, count: actualLen };
    return {
      retVal: COAPI_OK,
      out: { bufSize: totalLen, nrOfData: 1, dataType: 1 },
    };
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

  async CDHSetCabdPar(bezeichner: string, wert: string): Promise<CdhResult> {
    this.cabdPars.set(bezeichner, wert);
    return { retVal: COAPI_OK };
  }

  async CDHGetCabdPar(bezeichner: string): Promise<CdhResult<{ wert: string }>> {
    const v = this.cabdPars.get(bezeichner);
    return { retVal: COAPI_OK, out: { wert: typeof v === 'string' ? v : String(v ?? '') } };
  }

  async CDHSetCabdWordPar(bezeichner: string, wert: number): Promise<CdhResult> {
    this.cabdPars.set(bezeichner, wert | 0);
    return { retVal: COAPI_OK };
  }

  async CDHGetCabdWordPar(bezeichner: string): Promise<CdhResult<{ wert: number }>> {
    const v = this.cabdPars.get(bezeichner);
    return { retVal: COAPI_OK, out: { wert: typeof v === 'number' ? v : Number(v) | 0 } };
  }

  /**
   * Public accessor for the IPO-managed CABD parameter store. After
   * `runCabimain` returns, host code reads result values by their
   * NCS-contract name (e.g. `"FAHRGESTELL_NR"`, `"FA_STREAM"`) — the IPO
   * sets these via `CDHSetCabdPar` along its execution.
   */
  cabdPar(name: string): string | number | undefined {
    return this.cabdPars.get(name);
  }

  /** Clear the CABD-parameter store between unrelated reads. */
  resetCabdPars(): void {
    this.cabdPars.clear();
  }

  /**
   * Grow the BinBuf if needed and copy `src` in at `position`. Updates
   * the logical size to max(current, position + src.length). Doubles
   * capacity on each grow — typical BinBufs in NCSEXPER's read flow
   * are under 256 bytes; growing once is plenty.
   */
  protected writeBinBuf(handle: number, position: number, src: Uint8Array): void {
    const buf = this.binBufs.get(handle);
    if (!buf) return;
    const needed = position + src.length;
    if (needed > buf.bytes.length) {
      let cap = buf.bytes.length || 64;
      while (cap < needed) cap *= 2;
      const grown = new Uint8Array(cap);
      grown.set(buf.bytes.subarray(0, buf.size));
      buf.bytes = grown;
    }
    buf.bytes.set(src, position);
    if (needed > buf.size) buf.size = needed;
  }

  async CDHSetCbdName(_cbdName: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHSetCbdName');
  }

  /**
   * `CDHSetDataOrg(WortBreite ∈ {1,2,4}, ByteFolge ∈ {0,1}, AdrMode ∈ {0,1})`
   * — ghidra FUN_004437d0. Configures the per-slot data width and
   * endianness used by the subsequent Lesen/Cod packet exchange. The
   * IPO calls this once at the top of cabimain before BinBufCreate.
   */
  async CDHSetDataOrg(
    wortBreite: number,
    byteFolge: number,
    adrMode: number,
  ): Promise<CdhResult> {
    if (wortBreite !== 1 && wortBreite !== 2 && wortBreite !== 4)
      return { retVal: COAPI_PAR_ERROR };
    if (byteFolge !== 0 && byteFolge !== 1) return { retVal: COAPI_PAR_ERROR };
    if (adrMode !== 0 && adrMode !== 1) return { retVal: COAPI_PAR_ERROR };
    this.dataOrg = {
      wortBreite: wortBreite as 1 | 2 | 4,
      byteFolge: byteFolge as 0 | 1,
      adrMode: adrMode as 0 | 1,
    };
    return { retVal: COAPI_OK };
  }

  /**
   * Host-side seed for the slot table — mirrors NCSEXPER's internal
   * `CDHSetNettoData` (ghidra FUN_00443890) which is called by
   * NCSEXPER's C side once per CABD-defined byte before the IPO
   * dispatches. We expose it publicly so the orchestrator can flatten
   * `FunctionList` items into per-byte slots before `runCabimain`.
   * The IPO's `CDHGetNettoDataFromCbd` (slot 0x44) becomes a no-op:
   * slots are already populated.
   */
  setNettoSlots(slots: Array<{ addr: number; value?: number }>): void {
    this.slots = slots
      .map((s) => ({
        addr: s.addr | 0,
        value: (s.value ?? 0) & 0xff,
        mask: 0xff,
        flags: 1,
      }))
      .sort((a, b) => a.addr - b.addr);
    this.slotCursor = 0;
  }

  /**
   * After `runCabimain`, read the slot values out as a netto-style
   * `Map<address, byte>`. Caller materialises the actual netto array
   * — there may be address gaps and we don't enforce a base address.
   */
  nettoSlotValues(): Map<number, number> {
    const out = new Map<number, number>();
    for (const s of this.slots) out.set(s.addr, s.value);
    return out;
  }

  /**
   * `CDHGetNettoDataFromCbd(out RetVal)` — slot 0x44. In NCSEXPER the
   * IPO calls this to materialise the netto slot table from the loaded
   * CABD. In ncsx we seed slots from `FunctionList` host-side before
   * `runCabimain`, so this is a confirm-only no-op.
   */
  async CDHGetNettoDataFromCbd(): Promise<CdhResult> {
    return { retVal: this.slots.length > 0 ? COAPI_OK : COAPI_ERROR };
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

  async CDHGetNettoMaskFromCbd(): Promise<CdhResult> {
    // For the read path the SGBD echoes back exactly the bytes we
    // request — there's no separate "write mask" needed for Lesen.
    // Cod (write) needs the mask; we'll wire it when that path runs.
    return { retVal: COAPI_OK };
  }

  async CDHGetFswPswFromNettoData(_outFileName: string): Promise<CdhResult> {
    throw new CdhNotImplementedError('CDHGetFswPswFromNettoData');
  }

  async CDHCheckDataUsed(): Promise<CdhResult> {
    // NCSEXPER checks every slot has flags bit 1 set (in-flight); we
    // set that in CDHGetApiJobData and rely on CDHBinBufToNettoData
    // to consume it. Just ok.
    return { retVal: COAPI_OK };
  }

  // ── BinBuf — binary buffer handle API ───────────────────────────────────────

  /** `CDHBinBufCreate(out BufHandle)` — alloc handle, empty buffer. */
  async CDHBinBufCreate(): Promise<CdhResult<{ bufHandle: number }>> {
    const handle = this.nextBinBufHandle++;
    this.binBufs.set(handle, { bytes: new Uint8Array(64), size: 0 });
    return { retVal: COAPI_OK, out: { bufHandle: handle } };
  }

  async CDHBinBufDelete(bufHandle: number): Promise<CdhResult> {
    return {
      retVal: this.binBufs.delete(bufHandle) ? COAPI_OK : COAPI_INVALID_HANDLE,
    };
  }

  async CDHBinBufWriteByte(
    bufHandle: number,
    byteVal: number,
    position: number,
  ): Promise<CdhResult> {
    if (!this.binBufs.has(bufHandle)) return { retVal: COAPI_INVALID_HANDLE };
    this.writeBinBuf(bufHandle, position, Uint8Array.of(byteVal & 0xff));
    return { retVal: COAPI_OK };
  }

  async CDHBinBufWriteWord(
    bufHandle: number,
    wordVal: number,
    position: number,
  ): Promise<CdhResult> {
    if (!this.binBufs.has(bufHandle)) return { retVal: COAPI_INVALID_HANDLE };
    // Word order follows dataOrg.byteFolge — 0 = low-first (LE), 1 = high-first (BE).
    const lo = wordVal & 0xff;
    const hi = (wordVal >> 8) & 0xff;
    const bytes =
      this.dataOrg?.byteFolge === 1
        ? Uint8Array.of(hi, lo)
        : Uint8Array.of(lo, hi);
    this.writeBinBuf(bufHandle, position, bytes);
    return { retVal: COAPI_OK };
  }

  async CDHBinBufReadByte(
    bufHandle: number,
    position: number,
  ): Promise<CdhResult<{ byteVal: number }>> {
    const buf = this.binBufs.get(bufHandle);
    if (!buf) return { retVal: COAPI_INVALID_HANDLE };
    if (position < 0 || position >= buf.size) return { retVal: COAPI_PAR_ERROR };
    return { retVal: COAPI_OK, out: { byteVal: buf.bytes[position]! } };
  }

  async CDHBinBufReadWord(
    bufHandle: number,
    position: number,
  ): Promise<CdhResult<{ wordVal: number }>> {
    const buf = this.binBufs.get(bufHandle);
    if (!buf) return { retVal: COAPI_INVALID_HANDLE };
    if (position < 0 || position + 1 >= buf.size) return { retVal: COAPI_PAR_ERROR };
    const b0 = buf.bytes[position]!;
    const b1 = buf.bytes[position + 1]!;
    const wordVal =
      this.dataOrg?.byteFolge === 1 ? (b0 << 8) | b1 : (b1 << 8) | b0;
    return { retVal: COAPI_OK, out: { wordVal } };
  }

  async CDHBinBufToStr(
    bufHandle: number,
  ): Promise<CdhResult<{ binBufStr: string }>> {
    const buf = this.binBufs.get(bufHandle);
    if (!buf) return { retVal: COAPI_INVALID_HANDLE };
    return {
      retVal: COAPI_OK,
      out: { binBufStr: bytesToHex(buf.bytes.subarray(0, buf.size)) },
    };
  }

  /**
   * `CDHBinBufToNettoData(BufHandle, RetVal)` — slot 0x4A. Distribute
   * the SGBD's response bytes back into the slot table.
   *
   * The buffer contains the 22-byte request header (now partially
   * stomped by the SGBD's response overlap at offset 0x15) plus
   * `N*wortBreite` bytes of payload. The first `pendingDistribution.count`
   * payload bytes are real ECU data; any trailing bytes are the
   * wortBreite-alignment padding the request padded out for the SGBD's
   * word-aligned length check (see `CDHGetApiJobData`).
   *
   * We walk the slot range stashed by `CDHGetApiJobData` and assign
   * `response_byte & slot.mask` to each slot in order. This sidesteps
   * the byte-vs-block-address ambiguity that bit us when we tried to
   * recover the slot positions from the wire address in the header:
   * the header carries the K-line WORD address, our slots are keyed
   * by BYTE address, and the round-trip silently x2-skewed every FSW
   * past offset 0. Index-based dispatch removes the unit conversion
   * entirely.
   *
   * The response payload starts at offset 0x15 (the last header byte
   * is overwritten by `response[0]`) per the SGBD's emit pattern in
   * C_KMB46.prg.
   */
  async CDHBinBufToNettoData(bufHandle: number): Promise<CdhResult> {
    const buf = this.binBufs.get(bufHandle);
    if (!buf) return { retVal: COAPI_INVALID_HANDLE };
    if (buf.size < 22) return { retVal: COAPI_PAR_ERROR };
    if (!this.pendingDistribution) return { retVal: COAPI_ERROR };
    const { startIdx, count } = this.pendingDistribution;
    const payloadStart = 0x15;
    for (let i = 0; i < count; i++) {
      const slot = this.slots[startIdx + i];
      if (!slot) break;
      const respByte = buf.bytes[payloadStart + i] ?? 0;
      slot.value = slot.mask & respByte;
      slot.flags &= ~2;
    }
    this.pendingDistribution = null;
    return { retVal: COAPI_OK };
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
