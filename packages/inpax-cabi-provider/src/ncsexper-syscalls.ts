/**
 * NCSEXPER CABI syscall table — the verified mapping from slot ID to
 * function name + CABI.H signature. Extracted from `ncsserv.exe`'s
 * keyword block (the 1996 Softing NCS-ELDI-Server, NCSEXPER.EXE's
 * 16-bit predecessor — same v1.x bytecode VM, same CABI table).
 *
 * Validation: 68/68 empirically-observed slots match the CABI.H
 * declaration shape for the name at that slot. See
 * `docs/ncsexper-syscall-table.md` and `docs/ncsexper-cabi-syscalls.md`.
 *
 * This module exposes the raw metadata. The actual per-slot
 * `SystemFunctionOverride` factories — which pop args per the
 * signature and dispatch into `CabiProvider` — live with the runtime
 * consumer (`apps/ncsx-web/src/lib/runtime.svelte.ts`). Keeping the
 * factory out of this package lets us avoid taking
 * `@emdzej/inpax-interpreter` as a runtime dep.
 */

/**
 * Per-parameter direction + type, extracted from CABI.H.
 * `in` = value pushed on stack; `out`/`inout` = reference pushed.
 */
export interface CabiParam {
  direction: 'in' | 'out' | 'inout';
  type: 'string' | 'int' | 'real' | 'bool';
  name: string;
}

export type CabiCategory =
  | 'timer'
  | 'flow'
  | 'convert'
  | 'string'
  | 'file'
  | 'simulation'
  | 'ediabas-cdh'
  | 'ediabas-raw'
  | 'binbuf'
  | 'string-array'
  | 'cdh-error'
  | 'cdh-init'
  | 'cdh-data'
  | 'cdh-cabd'
  | 'cdh-sg'
  | 'cdh-chassis'
  | 'cdh-coding'
  | 'cdh-cbd'
  | 'cdh-flash'
  | 'cdh-sgvt'
  | 'cdh-auth'
  | 'cdh-fa'
  | 'unknown';

export interface CabiSlot {
  /** Numeric slot ID — what the IPO's `CALL sys N` references. */
  id: number;
  /** CABI.H function name. */
  name: string;
  /** Raw CABI.H parameter list, in declaration order. */
  params: readonly CabiParam[];
  category: CabiCategory;
  /**
   * Whether the slot has been observed in any of the 915 CABI IPOs in
   * NCSEXPER/SGDAT. `false` means declared in the runtime table but
   * unused — safe to no-op.
   */
  observed: boolean;
  /**
   * One-line note on what the function does. Synthesised from CABI.H
   * section headers + function-name semantics. See
   * `docs/ncsexper-cabi-syscalls.md` for the full description.
   */
  purpose: string;
}

const p = (
  direction: CabiParam['direction'],
  type: CabiParam['type'],
  name: string,
): CabiParam => ({ direction, type, name });

/**
 * Compact builder so the table doesn't run to thousands of lines.
 * `ins` / `outs` arrays declare params in CABI.H declaration order.
 */
function slot(
  id: number,
  name: string,
  category: CabiCategory,
  params: readonly CabiParam[],
  observed: boolean,
  purpose: string,
): CabiSlot {
  return { id, name, category, params, observed, purpose };
}

/**
 * The 99-entry CABI syscall table, in slot-ID order. Source of truth
 * for every IPO `CALL sys N` dispatch in NCSEXPER.
 */
export const NCSEXPER_CABI_SLOTS: readonly CabiSlot[] = [
  // ─── Timer / flow control ───────────────────────────────────────────
  slot(0x00, 'settimer', 'timer',
    [p('in', 'int', 'timernum'), p('in', 'int', 'timeval')],
    true, 'Start a countdown timer; pair with testtimer.'),
  slot(0x01, 'testtimer', 'timer',
    [p('in', 'int', 'timernum'), p('out', 'bool', 'expiredflag')],
    true, 'Returns true once the timer expired.'),
  slot(0x02, 'exit', 'flow',
    [], true, 'Terminate the IPO. RET-equivalent at the script level.'),

  // ─── Type conversion ────────────────────────────────────────────────
  slot(0x03, 'realtostring', 'convert',
    [p('in', 'real', 'r'), p('in', 'string', 'format'), p('out', 'string', 's')],
    false, 'Format a real as a string using a printf-like format.'),
  slot(0x04, 'inttostring', 'convert',
    [p('in', 'int', 'i'), p('out', 'string', 's')],
    true, 'Format an int as a decimal string.'),
  slot(0x05, 'hexconvert', 'convert',
    [p('in', 'string', 'HexString'),
     p('out', 'int', 'high'), p('out', 'int', 'mid'),
     p('out', 'int', 'low'), p('out', 'int', 'seg')],
    true, 'Split a hex string into 16-bit chunks.'),

  // ─── String operations ──────────────────────────────────────────────
  slot(0x06, 'strcat', 'string',
    [p('out', 'string', 'DestStr'),
     p('in', 'string', 'SrcStr1'), p('in', 'string', 'SrcStr2')],
    true, 'Concatenate SrcStr1 + SrcStr2 into DestStr.'),
  slot(0x07, 'strlen', 'string',
    [p('out', 'int', 'len'), p('in', 'string', 'str')],
    true, 'Length of a string.'),
  slot(0x08, 'midstr', 'string',
    [p('out', 'string', 'ResultStr'),
     p('in', 'string', 'SrcStr'),
     p('in', 'int', 'FirstIndex'),
     p('in', 'int', 'Count')],
    true, 'Substring at FirstIndex, Count chars.'),

  // ─── Simulation (user input) ────────────────────────────────────────
  slot(0x09, 'simnum', 'simulation',
    [p('out', 'real', 'val'),
     p('in', 'string', 'BoxTitle'), p('in', 'string', 'BoxText'),
     p('in', 'real', 'minval'), p('in', 'real', 'maxval')],
    false, 'Prompt the user for a real value (range-checked).'),
  slot(0x0a, 'simdigital', 'simulation',
    [p('out', 'bool', 'val'),
     p('in', 'string', 'BoxTitle'), p('in', 'string', 'BoxText'),
     p('in', 'string', 'FalseStr'), p('in', 'string', 'TrueStr')],
    false, 'Prompt the user for a bool.'),

  // ─── EDIABAS via CDH error handling ─────────────────────────────────
  slot(0x0b, 'CDHapiInit', 'ediabas-cdh',
    [], true, 'Initialise EDIABAS via the CDH wrapper.'),
  slot(0x0c, 'CDHapiEnd', 'ediabas-cdh',
    [], true, 'Shut down EDIABAS via CDH.'),
  slot(0x0d, 'CDHapiJob', 'ediabas-cdh',
    [p('in', 'string', 'ecu'), p('in', 'string', 'job'),
     p('in', 'string', 'para'), p('in', 'string', 'result')],
    true, 'Run EDIABAS job, route errors into CDH state. THE apiJob bridge for A_*.ipo.'),
  slot(0x0e, 'CDHapiJobData', 'ediabas-cdh',
    [p('in', 'string', 'ecu'), p('in', 'string', 'job'),
     p('in', 'int', 'BufHandle'), p('in', 'int', 'BufSize'),
     p('in', 'string', 'result')],
    true, 'Run an EDIABAS job with a binary buffer param.'),
  slot(0x0f, 'CDHapiResultText', 'ediabas-cdh',
    [p('out', 'string', 'ResultText'),
     p('in', 'string', 'ApiResult'),
     p('in', 'int', 'ApiSet'),
     p('in', 'string', 'ApiFormat')],
    true, 'Read a string result by name + set.'),
  slot(0x10, 'CDHapiResultInt', 'ediabas-cdh',
    [p('out', 'int', 'ResultVal'),
     p('in', 'string', 'ApiResult'),
     p('in', 'int', 'ApiSet')],
    true, 'Read an int result by name + set.'),
  slot(0x11, 'CDHapiResultSets', 'ediabas-cdh',
    [p('out', 'int', 'sets')],
    true, 'Get result-set count from the last job.'),
  slot(0x12, 'CDHapiResultDigital', 'ediabas-cdh',
    [p('out', 'bool', 'ResultVal'),
     p('in', 'string', 'ApiResult'),
     p('in', 'int', 'ApiSet')],
    false, 'Read a bool result.'),
  slot(0x13, 'CDHapiResultAnalog', 'ediabas-cdh',
    [p('out', 'real', 'ResultVal'),
     p('in', 'string', 'ApiResult'),
     p('in', 'int', 'ApiSet')],
    false, 'Read a real result.'),
  slot(0x14, 'CDHapiResultBinary', 'ediabas-cdh',
    [p('in', 'int', 'BufHandle'),
     p('in', 'string', 'ApiResult'),
     p('in', 'int', 'ApiSet'),
     p('out', 'int', 'RetVal')],
    true, 'Read a binary result into the named binary buffer.'),
  slot(0x15, 'CDHapiCheckJobStatus', 'ediabas-cdh',
    [p('in', 'string', 'RefStr')],
    false, 'Check JOB_STATUS against a reference string.'),

  // ─── EDIABAS raw (1:1, no CDH error layer) ──────────────────────────
  slot(0x16, 'apiInit', 'ediabas-raw',
    [p('out', 'bool', 'rc')], false, 'Initialise EDIABAS, return rc.'),
  slot(0x17, 'apiEnd', 'ediabas-raw', [], false, 'Shut down EDIABAS.'),
  slot(0x18, 'apiJob', 'ediabas-raw',
    [p('in', 'string', 'ecu'), p('in', 'string', 'job'),
     p('in', 'string', 'para'), p('in', 'string', 'result')],
    true, 'Run EDIABAS job, raw (no CDH error layer).'),
  slot(0x19, 'apiState', 'ediabas-raw',
    [p('out', 'int', 'ApiState')], false, 'Read EDIABAS state.'),
  slot(0x1a, 'apiResultText', 'ediabas-raw',
    [p('out', 'bool', 'rc'), p('out', 'string', 'ResultText'),
     p('in', 'string', 'ApiResult'), p('in', 'int', 'ApiSet'),
     p('in', 'string', 'ApiFormat')],
    true, 'Read string result, with rc.'),
  slot(0x1b, 'apiResultInt', 'ediabas-raw',
    [p('out', 'bool', 'rc'), p('out', 'int', 'ResultVal'),
     p('in', 'string', 'ApiResult'), p('in', 'int', 'ApiSet')],
    true, 'Read int result, with rc.'),
  slot(0x1c, 'apiResultSets', 'ediabas-raw',
    [p('out', 'bool', 'rc'), p('out', 'int', 'sets')],
    false, 'Result-set count, with rc.'),
  slot(0x1d, 'apiResultReal', 'ediabas-raw',
    [p('out', 'bool', 'rc'), p('out', 'real', 'ResultVal'),
     p('in', 'string', 'ApiResult'), p('in', 'int', 'ApiSet')],
    false, 'Read real result, with rc.'),
  slot(0x1e, 'apiErrorCode', 'ediabas-raw',
    [p('out', 'int', 'ErrorCode')], true, 'Last EDIABAS error code.'),
  slot(0x1f, 'apiErrorText', 'ediabas-raw',
    [p('out', 'string', 'ErrorText')], true, 'Last EDIABAS error text.'),

  // ─── Binary data string + binbuf ────────────────────────────────────
  slot(0x20, 'GetBinaryDataString', 'binbuf',
    [p('out', 'string', 'DataString'), p('out', 'int', 'DataStringLen')],
    false, 'Read current binary data string + length.'),

  // ─── File I/O ───────────────────────────────────────────────────────
  slot(0x21, 'fileopen', 'file',
    [p('in', 'string', 'FileName'), p('in', 'string', 'OpenMode')],
    true, 'Open a file for write.'),
  slot(0x22, 'fileclose', 'file', [], true, 'Close the open file.'),
  slot(0x23, 'filewrite', 'file',
    [p('in', 'string', 'str')], true, 'Append a string.'),

  // ─── String arrays ──────────────────────────────────────────────────
  slot(0x24, 'StrArrayCreate', 'string-array',
    [p('out', 'bool', 'rc'), p('out', 'int', 'hStrArray')],
    false, 'Allocate a string array.'),
  slot(0x25, 'StrArrayDestroy', 'string-array',
    [p('in', 'int', 'hStrArray')], false, 'Free a string array.'),
  slot(0x26, 'StrArrayWrite', 'string-array',
    [p('in', 'int', 'hStrArray'), p('in', 'int', 'index'),
     p('in', 'string', 'str')],
    false, 'Write string at index.'),
  slot(0x27, 'StrArrayRead', 'string-array',
    [p('in', 'int', 'hStrArray'), p('in', 'int', 'index'),
     p('out', 'string', 'str')],
    false, 'Read string at index.'),
  slot(0x28, 'StrArrayGetElementCount', 'string-array',
    [p('in', 'int', 'hStrArray'), p('out', 'int', 'ElementCount')],
    false, 'Element count.'),
  slot(0x29, 'StrArrayDelete', 'string-array',
    [p('in', 'int', 'hStrArray')], false, 'Delete an element.'),

  // ─── CDH init ───────────────────────────────────────────────────────
  slot(0x2a, 'CDHGetFswPswFromZcs', 'cdh-init',
    [p('in', 'string', 'Gm'), p('in', 'string', 'Sa'),
     p('in', 'string', 'Vn'), p('out', 'int', 'RetVal')],
    false, 'Initialise CDH from a ZCS triple (GM/SA/VN).'),
  slot(0x2b, 'CDHSetReturnVal', 'cdh-error',
    [p('in', 'int', 'Wert')], true, 'Set per-IPO COAPI return code.'),
  slot(0x2c, 'CDHSetSystemData', 'cdh-data',
    [p('in', 'string', 'Bezeichner'), p('in', 'string', 'Wert'),
     p('out', 'int', 'RetVal')],
    true, 'Set a named system data variable.'),
  slot(0x2d, 'CDHGetSystemData', 'cdh-data',
    [p('in', 'string', 'Bezeichner'),
     p('out', 'string', 'Wert'), p('out', 'int', 'RetVal')],
    true, 'Read a named system data variable.'),
  slot(0x2e, 'CDHSetCabdPar', 'cdh-cabd',
    [p('in', 'string', 'Bezeichner'), p('in', 'string', 'Wert'),
     p('out', 'int', 'RetVal')],
    true, 'Set a CABD parameter (string) by name.'),
  slot(0x2f, 'CDHGetCabdPar', 'cdh-cabd',
    [p('in', 'string', 'Bezeichner'),
     p('out', 'string', 'Wert'), p('out', 'int', 'RetVal')],
    true, 'Read a CABD parameter (string) by name.'),
  slot(0x30, 'CDHGetFswPswFromCvt', 'cdh-init',
    [p('out', 'int', 'RetVal')],
    false, 'Initialise CDH from the CVT table.'),

  // ─── SG resolution ──────────────────────────────────────────────────
  slot(0x31, 'CDHReadSget', 'cdh-sg',
    [p('out', 'string', 'SgList'), p('out', 'int', 'RetVal')],
    true, 'Read SG-Ermittlung result.'),
  slot(0x32, 'CDHSetSgName', 'cdh-sg',
    [p('in', 'string', 'SgName'), p('out', 'int', 'RetVal')],
    true, 'Set the currently-active SG name.'),
  slot(0x33, 'CDHGetSgbdName', 'cdh-sg',
    [p('out', 'string', 'SgbdName'), p('out', 'int', 'RetVal')],
    true, 'Get the resolved SGBD basename.'),

  // ─── Chassis ────────────────────────────────────────────────────────
  slot(0x34, 'CDHGetBaureiheFromZcs', 'cdh-chassis',
    [p('in', 'string', 'Gm'), p('in', 'string', 'Sa'),
     p('in', 'string', 'Vn'),
     p('out', 'string', 'Baureihe'), p('out', 'int', 'RetVal')],
    false, 'Derive chassis from a ZCS triple.'),

  // ─── FSW / PSW manipulation ─────────────────────────────────────────
  slot(0x35, 'CDHActivateFsw', 'cdh-coding',
    [p('in', 'string', 'Fsw'), p('out', 'int', 'RetVal')],
    true, 'Activate a function code (FSW).'),
  slot(0x36, 'CDHInactivateFsw', 'cdh-coding',
    [p('in', 'string', 'Fsw'), p('out', 'int', 'RetVal')],
    true, 'Deactivate a function code.'),
  slot(0x37, 'CDHActivateGrp', 'cdh-coding',
    [p('in', 'string', 'Gruppe'), p('out', 'int', 'RetVal')],
    true, 'Activate a group.'),
  slot(0x38, 'CDHInactivateGrp', 'cdh-coding',
    [p('in', 'string', 'Gruppe'), p('out', 'int', 'RetVal')],
    true, 'Deactivate a group.'),
  slot(0x39, 'CDHActivateAllFsw', 'cdh-coding',
    [], true, 'Activate every FSW.'),
  slot(0x3a, 'CDHInactivateAllFsw', 'cdh-coding',
    [], true, 'Deactivate every FSW.'),
  slot(0x3b, 'CDHChangePsw', 'cdh-coding',
    [p('in', 'string', 'Fsw'), p('in', 'string', 'Psw'),
     p('out', 'int', 'RetVal')],
    false, 'Change the parameter attached to an FSW.'),
  slot(0x3c, 'CDHSaveFswPswList', 'cdh-coding',
    [p('out', 'int', 'RetVal')], false, 'Save current FSW/PSW list.'),
  slot(0x3d, 'CDHRestoreFswPswList', 'cdh-coding',
    [p('out', 'int', 'RetVal')], false, 'Restore saved FSW/PSW list.'),

  // ─── CBD / netto-byte stream ────────────────────────────────────────
  slot(0x3e, 'CDHSetCbdName', 'cdh-cbd',
    [p('in', 'string', 'CbdName')], true, 'Set the active CBD by name.'),
  slot(0x3f, 'CDHGetInfo', 'cdh-cbd',
    [p('in', 'string', 'Bezeichner'), p('in', 'int', 'InfoNr'),
     p('out', 'string', 'Info'), p('out', 'int', 'NrOfInfo'),
     p('out', 'int', 'RetVal')],
    true, 'Read a named info attribute from the active CBD.'),
  slot(0x40, 'CDHCheckIdent', 'cdh-cbd',
    [p('in', 'string', 'Bezeichner'), p('in', 'string', 'Id1'),
     p('in', 'string', 'Id2'), p('out', 'int', 'RetVal')],
    true, 'Verify identity match.'),
  slot(0x41, 'CDHGetFswDataFromCbd', 'cdh-cbd',
    [p('in', 'string', 'Fsw'), p('out', 'int', 'RetVal')],
    true, 'Pull FSW data row from the active CBD.'),
  slot(0x42, 'CDHGetFswPswDataFromCbd', 'cdh-cbd',
    [p('in', 'string', 'Fsw'), p('in', 'string', 'Psw'),
     p('out', 'int', 'RetVal')],
    false, 'Pull FSW+PSW data row.'),
  slot(0x43, 'CDHGetGrpDataFromCbd', 'cdh-cbd',
    [p('in', 'string', 'Gruppe'), p('out', 'int', 'RetVal')],
    true, 'Pull group data.'),
  slot(0x44, 'CDHGetNettoDataFromCbd', 'cdh-cbd',
    [p('out', 'int', 'RetVal')], true, 'Materialise netto byte stream.'),
  slot(0x45, 'CDHGetNettoMaskFromCbd', 'cdh-cbd',
    [p('out', 'int', 'RetVal')], true, 'Materialise netto write-mask.'),
  slot(0x46, 'CDHGetFswPswFromNettoData', 'cdh-cbd',
    [p('in', 'string', 'OutFileName'), p('out', 'int', 'RetVal')],
    true, 'Reverse netto-byte stream into FSW/PSW pairs.'),

  // ─── Per-job binary result buffer ──────────────────────────────────
  slot(0x47, 'CDHResetApiJobData', 'cdh-data',
    [], true, 'Clear per-job binary result buffer.'),
  slot(0x48, 'CDHGetApiJobData', 'cdh-data',
    [p('in', 'int', 'MaxData'), p('in', 'int', 'BufHandle'),
     p('out', 'int', 'BufSize'), p('out', 'int', 'NrOfData'),
     p('out', 'int', 'DataType'), p('out', 'int', 'RetVal')],
    true, 'Read raw binary result bytes into a buffer.'),
  slot(0x49, 'CDHCheckDataUsed', 'cdh-data',
    [p('out', 'int', 'RetVal')], true, 'Verify all binary result bytes were consumed.'),
  slot(0x4a, 'CDHBinBufToNettoData', 'cdh-data',
    [p('in', 'int', 'BufHandle'), p('out', 'int', 'RetVal')],
    true, "Treat a BinBuf's contents as the netto-byte stream."),

  // ─── Binary buffer helpers ──────────────────────────────────────────
  slot(0x4b, 'CDHBinBufCreate', 'binbuf',
    [p('out', 'int', 'BufHandle'), p('out', 'int', 'RetVal')],
    true, 'Allocate a binary buffer.'),
  slot(0x4c, 'CDHBinBufDelete', 'binbuf',
    [p('in', 'int', 'BufHandle'), p('out', 'int', 'RetVal')],
    true, 'Free a binary buffer.'),
  slot(0x4d, 'CDHBinBufWriteByte', 'binbuf',
    [p('in', 'int', 'BufHandle'), p('in', 'int', 'ByteVal'),
     p('in', 'int', 'Position'), p('out', 'int', 'RetVal')],
    true, 'Write a byte at Position.'),
  slot(0x4e, 'CDHBinBufWriteWord', 'binbuf',
    [p('in', 'int', 'BufHandle'), p('in', 'int', 'WordVal'),
     p('in', 'int', 'Position'), p('out', 'int', 'RetVal')],
    true, 'Write a 16-bit word at Position.'),
  slot(0x4f, 'CDHBinBufReadByte', 'binbuf',
    [p('in', 'int', 'BufHandle'), p('out', 'int', 'ByteVal'),
     p('in', 'int', 'Position'), p('out', 'int', 'RetVal')],
    true, 'Read a byte at Position.'),
  slot(0x50, 'CDHBinBufReadWord', 'binbuf',
    [p('in', 'int', 'BufHandle'), p('out', 'int', 'WordVal'),
     p('in', 'int', 'Position'), p('out', 'int', 'RetVal')],
    true, 'Read a 16-bit word at Position.'),
  slot(0x51, 'CDHBinBufToStr', 'binbuf',
    [p('in', 'int', 'BufHandle'),
     p('out', 'string', 'BinBufStr'), p('out', 'int', 'RetVal')],
    true, 'Serialise a binary buffer to a hex string.'),

  // ─── CDH error state ────────────────────────────────────────────────
  slot(0x52, 'CDHResetError', 'cdh-error',
    [], false, 'Reset CDH error state.'),
  slot(0x53, 'CDHSetError', 'cdh-error',
    [p('in', 'int', 'ErrNr'),
     p('in', 'string', 'ModulName'), p('in', 'string', 'ProcName'),
     p('in', 'int', 'LineNr'), p('in', 'string', 'ErrorInfo')],
    true, 'Set a CDH error.'),
  slot(0x54, 'CDHTestError', 'cdh-error',
    [p('out', 'int', 'ErrNr')], true, 'Read current CDH error number.'),

  // ─── Byte-data, word-par ────────────────────────────────────────────
  slot(0x55, 'CDHGetApiJobByteData', 'cdh-data',
    [p('in', 'int', 'MaxData'), p('in', 'int', 'BufHandle'),
     p('out', 'int', 'BufSize'),
     p('out', 'int', 'NrOfData'), p('out', 'int', 'RetVal')],
    true, 'Read raw byte result (typed).'),
  slot(0x56, 'CDHSetCabdWordPar', 'cdh-cabd',
    [p('in', 'string', 'Bezeichner'), p('in', 'int', 'Wert'),
     p('out', 'int', 'RetVal')],
    true, 'Set a CABD parameter (16-bit word) by name.'),
  slot(0x57, 'CDHGetCabdWordPar', 'cdh-cabd',
    [p('in', 'string', 'Bezeichner'),
     p('out', 'int', 'Wert'), p('out', 'int', 'RetVal')],
    true, 'Read a CABD parameter (16-bit word) by name.'),

  // ─── Flash programming ──────────────────────────────────────────────
  slot(0x58, 'CDHGetReferenzProgramm', 'cdh-flash',
    [], false, 'NOT in CABI.H V2.0; signature TBD. Likely flash-reference program.'),
  slot(0x59, 'CDHGetReferenzDaten', 'cdh-flash',
    [], false, 'NOT in CABI.H V2.0; signature TBD. Likely flash-reference data.'),
  slot(0x5a, 'CDHDelay', 'timer',
    [p('in', 'int', 'd')], true, 'Block for d milliseconds.'),
  slot(0x5b, 'CDHSetDataOrg', 'cdh-flash',
    [p('in', 'int', 'WortBreite'), p('in', 'int', 'ByteFolge'),
     p('in', 'int', 'AdrMode'), p('out', 'int', 'RetVal')],
    true, 'Configure flash data organisation.'),

  // ─── SGVT identification ────────────────────────────────────────────
  slot(0x5c, 'CDHIdReady', 'cdh-sgvt',
    [p('out', 'bool', 'IdReady')], false, 'SGVT identification ready check.'),

  // ─── Authentication ─────────────────────────────────────────────────
  slot(0x5d, 'CDHCallAuthenticate', 'cdh-auth',
    [p('in', 'string', 'SgFamilie'),
     p('in', 'string', 'UserId'), p('in', 'string', 'StgId'),
     p('in', 'string', 'Type'),
     p('in', 'int', 'SgrndHdl'), p('in', 'string', 'Level'),
     p('in', 'int', 'ResponseHdl'),
     p('out', 'int', 'ResponseLen'), p('out', 'int', 'RetVal')],
    true, 'Run per-SG authentication challenge/response.'),

  // ─── FA coding ──────────────────────────────────────────────────────
  slot(0x5e, 'CDHGetFaVersion', 'cdh-fa',
    [p('out', 'string', 'Version'), p('out', 'int', 'RetVal')],
    false, 'Read FA version string.'),
  slot(0x5f, 'CDHGetAnzahlFaElemente', 'cdh-fa',
    [p('out', 'int', 'Anzahl')], false, 'Count of FA elements.'),
  slot(0x60, 'CDHGetFaElement', 'cdh-fa',
    [p('in', 'string', 'Typ'), p('in', 'bool', 'FirstElement'),
     p('out', 'string', 'Element')],
    false, 'Iterate FA elements by type.'),
  slot(0x61, 'CDHCheckIdent2', 'cdh-fa',
    [p('in', 'string', 'Bezeichner'), p('in', 'int', 'Id1'),
     p('out', 'int', 'RetVal')],
    false, 'Verify identity v2 (numeric Id1).'),
  slot(0x62, 'CDHAuthGetRandom', 'cdh-auth',
    [p('out', 'string', 'RndBin'), p('out', 'string', 'RndAsc')],
    false, 'Get auth random (binary + ASCII forms).'),
];

/** Lookup by slot ID. Returns undefined for unmapped slots. */
export function getCabiSlot(id: number): CabiSlot | undefined {
  return NCSEXPER_CABI_SLOTS.find((s) => s.id === id);
}
