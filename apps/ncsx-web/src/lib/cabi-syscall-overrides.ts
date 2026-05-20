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

/**
 * inpax's `opAlloc` maps the IPO ALLOC type marker `0x53` to
 * `ValueType.Long` (default `0`). NCSEXPER's compiler emits `0x53` for
 * **String** (default `""`). So a freshly-ALLOCed "string" local
 * arrives at our overrides as `{type: Long, value: 0}` — naive
 * `popString()` returns `"0"` and downstream EDIABAS calls hit
 * "SGBD not found: 0". Recognise the divergence: when CABI.H expects
 * a string and we see a numeric-zero entry, treat it as `""`.
 *
 * This also covers the symmetric case for `in: int` params that arrive
 * as String "" — coerce to 0.
 */
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
function popArgs(
  ctx: ExecutionContext,
  params: readonly CabiParam[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = params.length - 1; i >= 0; i--) {
    const param = params[i];
    if (param.direction === "in") {
      const entry = ctx.stack.pop();
      out[param.name] = coerceIn(entry, param.type);
    } else {
      out[param.name] = ctx.popRef();
    }
  }
  return out;
}

/**
 * Coerce a stack entry to the CABI.H-declared param type, tolerating
 * inpax's `0x53 → Long` mismap of NCSEXPER's String type marker (and
 * symmetric cases). A `Long 0` arriving where CABI.H wants a string
 * becomes `""`; a `String ""` arriving where CABI.H wants an int
 * becomes `0`.
 */
function coerceIn(entry: StackEntry, type: CabiParam["type"]): string | number | boolean {
  const v = entry.value;
  const t = entry.type;
  switch (type) {
    case "string":
      if (t === ValueType.String) return String(v ?? "");
      // Non-string entry: numeric 0 / null / false → "" (uninitialised
      // string local from ALLOC 0x53). Anything else stringifies.
      if (v === null || v === 0 || v === false) return "";
      return String(v);
    case "int":
      if (typeof v === "number") return v | 0;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "string" && v.length > 0) {
        const n = Number(v);
        return Number.isFinite(n) ? n | 0 : 0;
      }
      return 0;
    case "real":
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "string" && v.length > 0) {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    case "bool":
      if (typeof v === "boolean") return v;
      return Boolean(v);
  }
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
 */
export function buildCabiSystemFunctions(
  cabi: CabiProvider,
  opts: CabiOverrideOptions,
): Map<number, SystemFunctionOverride> {
  const map = new Map<number, SystemFunctionOverride>();
  for (const slot of NCSEXPER_CABI_SLOTS) {
    map.set(slot.id, makeOverride(slot, cabi, opts));
  }
  return map;
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
        await cabi.CDHapiJob(
          ecu,
          String(args.job),
          String(args.para),
          String(args.result),
        );
      };

    case "CDHapiInit":
      return async () => { await cabi.CDHapiInit(); };
    case "CDHapiEnd":
      return async () => { await cabi.CDHapiEnd(); };

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

    case "CDHSetReturnVal":
    case "CDHResetError":
    case "CDHResetApiJobData":
    case "CDHSetCbdName":
    case "CDHSetSgName":
    case "CDHSetCabdPar":
    case "CDHSetSystemData":
    case "CDHSetCabdWordPar":
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
    case "CDHGetNettoDataFromCbd":
    case "CDHGetNettoMaskFromCbd":
    case "CDHGetFswPswFromNettoData":
    case "CDHCheckIdent":
    case "CDHCheckIdent2":
    case "CDHCheckDataUsed":
    case "CDHGetInfo":
    case "CDHGetCabdPar":
    case "CDHGetSystemData":
    case "CDHGetCabdWordPar":
    case "CDHGetSgbdName":
    case "CDHReadSget":
    case "CDHGetBaureiheFromZcs":
    case "CDHGetFswPswFromZcs":
    case "CDHGetFswPswFromCvt":
    case "CDHIdReady":
    case "CDHSetDataOrg":
    case "CDHDelay":
    case "CDHCallAuthenticate":
    case "CDHAuthGetRandom":
    case "CDHGetFaVersion":
    case "CDHGetAnzahlFaElemente":
    case "CDHGetFaElement":
    case "CDHapiResultSets":
    case "CDHapiResultBinary":
    case "CDHapiJobData":
    case "CDHapiCheckJobStatus":
    case "CDHBinBufToNettoData":
    case "CDHBinBufCreate":
    case "CDHBinBufDelete":
    case "CDHBinBufWriteByte":
    case "CDHBinBufWriteWord":
    case "CDHBinBufReadByte":
    case "CDHBinBufReadWord":
    case "CDHBinBufToStr":
    case "CDHGetApiJobData":
    case "CDHGetApiJobByteData":
    case "settimer":
    case "exit":
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
