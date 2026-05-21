/**
 * Per-slot inpax `SystemFunctionOverride` map for NCSEXPER's 99-entry
 * CABI syscall table. The slot ↔ name ↔ signature mapping comes from
 * `@emdzej/ncsx-inpax-cabi-provider`'s `NCSEXPER_CABI_SLOTS` (extracted
 * from `ncsserv.exe`, cross-validated 68/68 against bytecode evidence).
 *
 * Strategy:
 *
 *  1. **Hot-path slots** (CDHapiJob, CDHapiResultText, apiResult*, etc.)
 *     pop their args per the CABI.H signature and dispatch into
 *     `CabiProvider`. Results land on `cabi.lastJob` and are read back
 *     by the orchestrator via `handle.cabi.findResult(...)`.
 *
 *  2. **Out-ref-writing slots** (utility funcs the IPO's control flow
 *     depends on — e.g. strlen, hexconvert) pop args + write a default
 *     value through each out-ref so the IPO progresses with sane data.
 *
 *  3. **Observability slots** (PEM*, OutputDebug*, FSW/PSW toggles,
 *     CDHSetCabdPar, file I/O) pop args correctly to keep the stack
 *     balanced, then no-op. `opCall`'s `popFrame()` rebalances after
 *     each override returns; out-ref destinations stay at their ALLOC
 *     default (0 / "" / false), which the IPO treats as "no error" and
 *     falls through.
 *
 *  4. **Unmapped slots** (anything outside 0x00..0x62) throw — that's
 *     a signal we hit a slot we haven't catalogued. Shouldn't happen
 *     for CABI IPOs but we want to know if it does.
 *
 * Each override is responsible for popping ALL its args (in reverse
 * declaration order — the IPO pushes top-down, the override pops
 * LIFO). After the override returns, the VM's `opCall` calls
 * `popFrame()` which truncates the value stack back to the FRAME
 * marker — so even if we drop args, the stack rebalances. The benefit
 * of explicit popping is correctness when an override later reads
 * something off the stack (which currently nothing does, but might).
 */

import {
  Stack,
  type ExecutionContext,
  type VM,
} from "@emdzej/inpax-interpreter";
import {
  ValueType,
  type StackEntry,
} from "@emdzej/inpax-core";
import {
  NCSEXPER_CABI_SLOTS,
  type CabiParam,
  type CabiSlot,
  type CabiProvider,
} from "@emdzej/ncsx-inpax-cabi-provider";

export type SystemFunctionOverride = (
  ctx: ExecutionContext,
  vm: VM,
) => void | Promise<void>;

export interface CabiOverrideOptions {
  /**
   * SGBD basename to inject when `CDHapiJob` is called with an empty
   * `ecu` argument. The IPO normally passes its local `JOBNAME` here
   * but for our flow we have a known SGBD from the picked SgfamRow.
   */
  defaultSgbd: string;
}

/**
 * Pop args off the IPO stack in reverse declaration order. Returns
 * an object keyed by param name. `in` params resolve to their value;
 * `out`/`inout` params resolve to a `StackEntry` ref we can write
 * back to via `ctx.setOutParam(ref, ...)`.
 */
/**
 * Hex preview of a JS string read as a byte sequence (each char's
 * `codePointAt(0)` treated as the byte). Kept around for ad-hoc
 * debugging — drop a `console.log(hexPreview(str))` into an override
 * to spot truncation / re-encoding when a binary blob round-trips
 * EDIABAS → IPO local → apiJob param. Originally added to chase the
 * FA_STREAM2STRUCT hand-off before the ediabasx 0.2.2 / CABI provider
 * semicolon-split fix; left exported so consumers can pull it in
 * without re-deriving it.
 */
export function hexPreview(s: string, head = 24, tail = 24): string {
  if (!s) return '(empty)';
  const codes = [...s].map((c) => c.codePointAt(0)!);
  const toHex = (n: number) => n.toString(16).padStart(n > 0xff ? 4 : 2, '0').toUpperCase();
  if (codes.length <= head + tail + 4) {
    return `len=${codes.length} bytes=${codes.map(toHex).join(' ')}`;
  }
  const front = codes.slice(0, head).map(toHex).join(' ');
  const back = codes.slice(-tail).map(toHex).join(' ');
  return `len=${codes.length} head=[${front}] tail=[${back}]`;
}

function popArgs(
  ctx: ExecutionContext,
  params: readonly CabiParam[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = params.length - 1; i >= 0; i--) {
    const param = params[i];
    if (param.direction === "in") {
      switch (param.type) {
        case "string": out[param.name] = ctx.popString(); break;
        case "int":    out[param.name] = ctx.popInt(); break;
        case "real":   out[param.name] = ctx.popReal(); break;
        case "bool":   out[param.name] = ctx.popBool(); break;
      }
    } else {
      out[param.name] = ctx.popRef();
    }
  }
  return out;
}

function writeOut(
  ctx: ExecutionContext,
  ref: unknown,
  type: CabiParam["type"],
  value: string | number | boolean,
): void {
  const refEntry = ref as StackEntry;
  if (!refEntry?.refInfo) return; // not a real ref → nothing to write
  let entry: StackEntry;
  switch (type) {
    case "string": entry = Stack.createEntry(ValueType.String, String(value)); break;
    case "int":    entry = Stack.createEntry(ValueType.Int, Number(value) | 0); break;
    case "real":   entry = Stack.createEntry(ValueType.Real, Number(value)); break;
    case "bool":   entry = Stack.createEntry(ValueType.Bool, Boolean(value)); break;
  }
  ctx.setOutParam(refEntry, entry);
}

/**
 * Build the per-slot override map. Returns a `Map<slotId, override>`
 * suitable for passing to `VM`'s `systemFunctions` config.
 *
 * Each override is also wrapped in an instrumentation shim that:
 *   - Counts syscalls and aborts after `SAFETY_CAP` invocations so a
 *     runaway IPO can't lock the browser forever. The cap is high
 *     enough that legitimate flows pass through cleanly.
 *   - Forces a `setTimeout(0)` macrotask yield every
 *     `YIELD_INTERVAL` syscalls so the browser can repaint, UI events
 *     can fire, and we can observe console logs in real time. Without
 *     this, hundreds of consecutive sync syscalls between async
 *     `apiJob` boundaries can starve the macrotask queue and freeze
 *     the page.
 */
const SAFETY_CAP = 50_000;
const YIELD_INTERVAL = 50;
/**
 * How often to dump a top-N histogram to the console. When an IPO
 * spins silently (UI responsive but the read never finishes), the
 * histogram tells us which slot is being hit on repeat without
 * pegging the cap. Quiet runs print one summary; runaways print every
 * HISTOGRAM_INTERVAL syscalls.
 */
const HISTOGRAM_INTERVAL = 1_000;

export function buildCabiSystemFunctions(
  cabi: CabiProvider,
  opts: CabiOverrideOptions,
): Map<number, SystemFunctionOverride> {
  const map = new Map<number, SystemFunctionOverride>();
  let count = 0;
  const slotHits = new Map<number, number>();
  const slotNames = new Map<number, string>();
  /**
   * Trace the first N syscalls verbosely so we can see how the IPO
   * starts up — useful when a flow hangs and the histogram alone
   * doesn't show the *order*. Tail-end of an infinite loop, the
   * histogram shows the spinner; the trace shows the lead-up.
   */
  const TRACE_FIRST = 30;
  for (const slot of NCSEXPER_CABI_SLOTS) {
    slotNames.set(slot.id, slot.name);
    const raw = makeOverride(slot, cabi, opts);
    map.set(slot.id, async (ctx, vm) => {
      count++;
      slotHits.set(slot.id, (slotHits.get(slot.id) ?? 0) + 1);
      if (count <= TRACE_FIRST) {
        console.log(`[cabi-syscall #${count}] ${slot.name} (0x${slot.id.toString(16)})`);
      }
      if (count > SAFETY_CAP) {
        const top = topHits(slotHits, slotNames, 8);
        throw new Error(
          `[cabi-syscall] safety cap (${SAFETY_CAP}) hit — last slot 0x${slot.id.toString(16)} ${slot.name}. Top: ${top}`,
        );
      }
      if (count % YIELD_INTERVAL === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (count % HISTOGRAM_INTERVAL === 0) {
        console.warn(
          `[cabi-syscall] ${count} calls so far — top: ${topHits(slotHits, slotNames, 8)}`,
        );
      }
      await raw(ctx, vm);
    });
  }
  return map;
}

function topHits(
  hits: Map<number, number>,
  names: Map<number, string>,
  k: number,
): string {
  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id, n]) => `${names.get(id) ?? `0x${id.toString(16)}`}=${n}`)
    .join(" ");
}

function makeOverride(
  slot: CabiSlot,
  cabi: CabiProvider,
  opts: CabiOverrideOptions,
): SystemFunctionOverride {
  switch (slot.name) {
    // ─── EDIABAS bridge — load-bearing ────────────────────────────────
    case "CDHapiJob":
    case "apiJob":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const ecu = String(args.ecu || opts.defaultSgbd);
        const job = String(args.job);
        const para = String(args.para);
        const result = String(args.result);
        try {
          await cabi.CDHapiJob(ecu, job, para, result);
        } catch (err) {
          console.error(`[apiJob] ${ecu}/${job} failed:`, err);
          throw err;
        }
      };

    case "CDHapiInit":
      return async () => { await cabi.CDHapiInit(); };
    case "CDHapiEnd":
      return async () => { await cabi.CDHapiEnd(); };

    // CDHapiJobData(ecu, job, BufHandle, BufSize, result) — sister to
    // CDHapiJob but the para slot is fed from a BinBuf. The Lesen
    // dispatcher uses this to run `C_S_LESEN` after IDENT seeded the
    // SGBD's state. We don't faithfully transport the BinBuf bytes —
    // the SGBD reads its internal state and answers, the netto data
    // comes back as a named result on `lastJob.sets`.
    case "CDHapiJobData":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const ecu = String(args.ecu || opts.defaultSgbd);
        const job = String(args.job);
        try {
          await cabi.CDHapiJobData(ecu, job, Number(args.BufHandle) | 0, Number(args.BufSize) | 0, String(args.result));
        } catch (err) {
          console.error(`[apiJobData] ${ecu}/${job} failed:`, err);
          throw err;
        }
      };

    // CDHGetApiJobData(MaxData, BufHandle, out BufSize, out NrOfData,
    // out DataType, out RetVal) — IPO's Lesen handler polls this in a
    // loop after IDENT until NrOfData reads 0, then proceeds to
    // CDHapiJobData. Provider returns 1-then-0 across the pair, so the
    // loop exits on the second call.
    case "CDHGetApiJobData":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHGetApiJobData(Number(args.MaxData) | 0, Number(args.BufHandle) | 0);
        writeOut(ctx, args.BufSize, "int", res.out?.bufSize ?? 0);
        writeOut(ctx, args.NrOfData, "int", res.out?.nrOfData ?? 0);
        writeOut(ctx, args.DataType, "int", res.out?.dataType ?? 0);
        writeOut(ctx, args.RetVal, "int", 0);
      };

    // CDHapiResultBinary(BufHandle, ApiResult, ApiSet, out RetVal) —
    // confirms the named binary result exists on the most recent
    // apiJob's result set. We don't move bytes through a BinBuf — the
    // host orchestrator pulls them via `cabi.findResult(name)` after
    // runCabimain returns.
    case "CDHapiResultBinary":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHapiResultBinary(
          Number(args.BufHandle) | 0,
          String(args.ApiResult),
          Number(args.ApiSet) | 0,
        );
        writeOut(ctx, args.RetVal, "int", res.retVal === 0 ? 0 : 1);
      };

    case "CDHapiResultText": {
      // out: string ResultText, in: string ApiResult, in: int ApiSet, in: string ApiFormat
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        const value = cabi.findResult(String(args.ApiResult));
        writeOut(ctx, args.ResultText, "string", value == null ? "" : String(value));
      };
    }
    case "CDHapiResultInt": {
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        const value = cabi.findResult(String(args.ApiResult));
        const n = typeof value === "number" ? value : Number(value ?? 0);
        writeOut(ctx, args.ResultVal, "int", Number.isFinite(n) ? n : 0);
      };
    }
    case "CDHapiResultDigital": {
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        const value = cabi.findResult(String(args.ApiResult));
        writeOut(ctx, args.ResultVal, "bool", Boolean(value));
      };
    }
    case "CDHapiResultAnalog": {
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        const value = cabi.findResult(String(args.ApiResult));
        const n = typeof value === "number" ? value : Number(value ?? 0);
        writeOut(ctx, args.ResultVal, "real", Number.isFinite(n) ? n : 0);
      };
    }

    // ─── Utility funcs the IPO uses for control flow ──────────────────
    case "strlen": {
      // out: int len, in: string str
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        writeOut(ctx, args.len, "int", String(args.str).length);
      };
    }
    case "strcat": {
      // out: string DestStr, in: string SrcStr1, in: string SrcStr2
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        writeOut(ctx, args.DestStr, "string", String(args.SrcStr1) + String(args.SrcStr2));
      };
    }
    case "midstr": {
      // out: string ResultStr, in: string SrcStr, in: int FirstIndex, in: int Count
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        const src = String(args.SrcStr);
        const start = Math.max(0, Number(args.FirstIndex) - 1); // 1-based → 0-based
        const count = Math.max(0, Number(args.Count));
        writeOut(ctx, args.ResultStr, "string", src.substring(start, start + count));
      };
    }
    case "inttostring": {
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        writeOut(ctx, args.s, "string", String(Number(args.i) | 0));
      };
    }
    case "realtostring": {
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        // Ignore format — we don't have a printf equivalent; basic toString.
        writeOut(ctx, args.s, "string", String(args.r));
      };
    }

    // ─── CDH state we mostly observe but don't act on ────────────────
    case "CDHTestError":
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        writeOut(ctx, args.ErrNr, "int", 0); // "no error" — IPO falls through happy path
      };

    // ─── Slot table + BinBuf — load-bearing for Lesen / Cod ──────────
    case "CDHSetDataOrg":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHSetDataOrg(
          Number(args.WortBreite) | 0,
          Number(args.ByteFolge) | 0,
          Number(args.AdrMode) | 0,
        );
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHGetNettoDataFromCbd":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHGetNettoDataFromCbd();
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHGetNettoMaskFromCbd":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHGetNettoMaskFromCbd();
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHCheckDataUsed":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHCheckDataUsed();
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHBinBufCreate":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHBinBufCreate();
        writeOut(ctx, args.BufHandle, "int", res.out?.bufHandle ?? 0);
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHBinBufDelete":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHBinBufDelete(Number(args.BufHandle) | 0);
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHBinBufWriteByte":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHBinBufWriteByte(
          Number(args.BufHandle) | 0,
          Number(args.ByteVal) | 0,
          Number(args.Position) | 0,
        );
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHBinBufWriteWord":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHBinBufWriteWord(
          Number(args.BufHandle) | 0,
          Number(args.WordVal) | 0,
          Number(args.Position) | 0,
        );
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHBinBufReadByte":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHBinBufReadByte(
          Number(args.BufHandle) | 0,
          Number(args.Position) | 0,
        );
        writeOut(ctx, args.ByteVal, "int", res.out?.byteVal ?? 0);
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHBinBufReadWord":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHBinBufReadWord(
          Number(args.BufHandle) | 0,
          Number(args.Position) | 0,
        );
        writeOut(ctx, args.WordVal, "int", res.out?.wordVal ?? 0);
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHBinBufToStr":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHBinBufToStr(Number(args.BufHandle) | 0);
        writeOut(ctx, args.BinBufStr, "string", res.out?.binBufStr ?? "");
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    case "CDHBinBufToNettoData":
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHBinBufToNettoData(Number(args.BufHandle) | 0);
        writeOut(ctx, args.RetVal, "int", res.retVal);
      };

    // CABI slot 0x02 `exit()` — terminate the IPO. NCSEXPER's
    // RET-equivalent at the script level (mirrors inpax's internal
    // `exit` for INPA's slot 0x0C). Without this, the IPO's Lesen
    // tail keeps re-running because our no-op doesn't stop the VM —
    // strcat/CDHSetReturnVal/exit show up in a 1:1:1 spin in the
    // histogram. Setting `state.running = false` makes the execute
    // loop's `while (running && currentBlock)` bail on the next
    // iteration.
    case "exit":
      return (_ctx, vm) => {
        vm.stop();
      };

    case "testtimer":
      // out: bool expiredflag — IPO uses settimer/testtimer pairs to
      // build busy-wait loops (`Warten`: while (!testtimer()) {}). If
      // we no-op, the loop spins forever and freezes the browser thread.
      // We own time at the host level (await for async EDIABAS calls);
      // the IPO's polling cadence is irrelevant. Always report "timer
      // expired" so any busy-wait exits on its first iteration.
      return (ctx) => {
        const args = popArgs(ctx, slot.params);
        writeOut(ctx, args.expiredflag, "bool", true);
      };

    case "CDHSetCabdPar": {
      // out: int RetVal — IPO writes the SGBD-result-to-NCS-contract-name
      // mapping here. The host reads via `cabi.cabdPar(name)` after
      // runCabimain returns.
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        await cabi.CDHSetCabdPar(String(args.Bezeichner), String(args.Wert));
        writeOut(ctx, args.RetVal, "int", 0);
      };
    }
    case "CDHGetCabdPar": {
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHGetCabdPar(String(args.Bezeichner));
        writeOut(ctx, args.Wert, "string", res.out?.wert ?? "");
        writeOut(ctx, args.RetVal, "int", 0);
      };
    }
    case "CDHSetCabdWordPar": {
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        await cabi.CDHSetCabdWordPar(String(args.Bezeichner), Number(args.Wert) | 0);
        writeOut(ctx, args.RetVal, "int", 0);
      };
    }
    case "CDHGetCabdWordPar": {
      return async (ctx) => {
        const args = popArgs(ctx, slot.params);
        const res = await cabi.CDHGetCabdWordPar(String(args.Bezeichner));
        writeOut(ctx, args.Wert, "int", res.out?.wert ?? 0);
        writeOut(ctx, args.RetVal, "int", 0);
      };
    }

    case "CDHSetReturnVal":
    case "CDHResetError":
    case "CDHResetApiJobData":
    case "CDHSetCbdName":
    case "CDHSetSgName":
    case "CDHSetSystemData":
    case "CDHSetError":
    case "CDHActivateFsw":
    case "CDHInactivateFsw":
    case "CDHActivateGrp":
    case "CDHInactivateGrp":
    case "CDHActivateAllFsw":
    case "CDHInactivateAllFsw":
    case "CDHChangePsw":
    case "CDHSaveFswPswList":
    case "CDHRestoreFswPswList":
    case "CDHGetFswDataFromCbd":
    case "CDHGetFswPswDataFromCbd":
    case "CDHGetGrpDataFromCbd":
    case "CDHGetFswPswFromNettoData":
    case "CDHCheckIdent":
    case "CDHCheckIdent2":
    case "CDHGetInfo":
    case "CDHGetSystemData":
    case "CDHGetSgbdName":
    case "CDHReadSget":
    case "CDHGetBaureiheFromZcs":
    case "CDHGetFswPswFromZcs":
    case "CDHGetFswPswFromCvt":
    case "CDHIdReady":
    case "CDHDelay":
    case "CDHCallAuthenticate":
    case "CDHAuthGetRandom":
    case "CDHGetFaVersion":
    case "CDHGetAnzahlFaElemente":
    case "CDHGetFaElement":
    case "CDHapiResultSets":
    case "CDHapiCheckJobStatus":
    case "CDHGetApiJobByteData":
    case "settimer":
    case "hexconvert":
    case "simnum":
    case "simdigital":
    case "fileopen":
    case "fileclose":
    case "filewrite":
    case "StrArrayCreate":
    case "StrArrayDestroy":
    case "StrArrayWrite":
    case "StrArrayRead":
    case "StrArrayGetElementCount":
    case "StrArrayDelete":
    case "GetBinaryDataString":
    case "apiInit":
    case "apiEnd":
    case "apiState":
    case "apiResultText":
    case "apiResultInt":
    case "apiResultSets":
    case "apiResultReal":
    case "apiErrorCode":
    case "apiErrorText":
    // Undocumented (not in CABI.H V2.0) — signature is empty so popArgs is a no-op too.
    case "CDHGetReferenzProgramm": // eslint-disable-line no-fallthrough
    case "CDHGetReferenzDaten":
      return (ctx) => {
        popArgs(ctx, slot.params);
        // No-op: opCall's popFrame() truncates the value stack back to
        // FRAME, dropping any args + out-refs we didn't write. Caller's
        // out-param destination stays at its ALLOC default (typically
        // 0 / "" / false), which the IPO interprets as "no error".
      };

    default:
      // Slot not in our switch list. Pop args defensively so the stack
      // doesn't underflow on the next op, then log so we know which slot
      // a real IPO is hitting that we missed.
      return (ctx) => {
        popArgs(ctx, slot.params);
        console.warn(
          `[cabi-syscall] slot 0x${slot.id.toString(16)} (${slot.name}) — no override registered, popped args + no-op`,
        );
      };
  }
}
