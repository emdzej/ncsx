/**
 * Inpax IPO runtime wire-up for ncsx — per-module VM that loads the matching
 * `A_<cabd>.ipo` dispatcher, sets `JOBNAME`, and runs `cabimain` so the per-CABD
 * job-name mapping (e.g. `FGNR_LESEN` → SGBD's `C_FG_LESEN`) is honoured.
 *
 * Mirrors `apps/inpax-web/src/lib/runtime.svelte.ts:102-314` (the inpax-web reference
 * implementation). Differences:
 *
 * - **UI scope splits by IPO style**:
 *   - For `A_*.ipo` *coding dispatchers* (Cod/Lesen/FgnrLesen/ZcsLesen/…) the IPO
 *     is batch-mode — `PEMProtokollAusgabe`, `digitalout`, `setstate` are
 *     observability calls we can route to no-ops. No screen / menu / F-key needed.
 *   - For *Kernfunktionen / functional IPOs* (abs_uc.ipo, ews.ipo, …, all the
 *     non-`A_*` files under SGDAT) the IPO is fully interactive — `setmenu`,
 *     `setscreen`, `userbox*`, F-key dispatch are real UI calls. Running Basic-
 *     Functions in ncsx will need ncsx-side ScreenCanvas + FKeyBar components
 *     fed by `WebUIProvider`. The provider is already wired; the consumer
 *     components don't exist yet. Tracked as a future task.
 * - We reuse the live `Ediabas` instance from `connection.session.ediabas` rather
 *   than creating a second one (would clash on the serial port).
 * - **Missing**: the CABI provider — NCSEXPER's `A_*.ipo` calls `CDHGetCabdName`,
 *   `CDHapiJob`, etc. via the CABI bridge (101 functions, statically linked in
 *   NCSEXPER.EXE). Until `packages/inpax-cabi-provider` lands (task #51), CABI
 *   syscalls will throw "unimplemented" — the runtime here logs them so we can
 *   triage which functions matter for the first read flow.
 *
 * See `docs/ipo-usage.md` for the IPO dispatch model and `docs/cabi-binding-plan.md`
 * for the planned CABI surface.
 */

import { parseIpo } from "@emdzej/inpax-parser";
import { VM, MainScheduler, ExecutionContext } from "@emdzej/inpax-interpreter";
import { SystemFunction, type FunctionBlock } from "@emdzej/inpax-core";
import { CabiProvider } from "@emdzej/ncsx-inpax-cabi-provider";

/**
 * Inpax 0.6.0 defines this type in `interpreter.ts` but doesn't re-export it
 * from the vm/index barrel — packaging gap. Re-declare locally; the shape
 * mirrors the interpreter's `SystemFunctionOverride` definition exactly so
 * if/when inpax exports it we can drop this and `import type`-it instead.
 */
type SystemFunctionOverride = (
  ctx: ExecutionContext,
  vm: VM,
) => void | Promise<void>;
import {
  NullUIProvider,
  NullSimulationProvider,
  NullPrintProvider,
  NullPemProvider,
  NullDtmProvider,
  NullExternalProvider,
  NullSpsProvider,
} from "@emdzej/inpax-providers/null";
import { EdiabasXProvider, Inp1Adapter } from "@emdzej/inpax-ediabasx-provider";
import { Ediabas, type EdiabasConfig } from "@emdzej/ediabasx-ediabas";
import { app } from "./state.svelte";
import { connection } from "./ediabas-session.svelte";

export interface RuntimeHandle {
  /** The CABD module name this runtime is bound to (e.g. `A_AKMB46`). */
  cabd: string;
  /** Underlying VM — for advanced callers / debugging. */
  vm: VM;
  /**
   * CABI/CDH provider — host-side state for the 80+ CDH functions the IPO can
   * call. Stores the per-job `lastJob.sets` map after `CDHapiJob` runs; UI
   * code can read named results from it via `cabi.findResult(name)`.
   */
  cabi: CabiProvider;
  /** EDIABAS bridge — exposes `lastResults` after a job runs. */
  ediabas: EdiabasXProvider;
  /**
   * Run the IPO's `cabimain(JOBNAME)` dispatcher with the supplied job name.
   * Awaits `__inpa_startup__` first so globals / constants are populated,
   * then invokes `cabimain` with `jobName` bound to its `local[0]`. The
   * matching `A_*.ipo` switch dispatches to `Cod` / `Lesen` / `FgnrLesen` /
   * `ZcsLesen` / `Ident` etc., which call `apiJob` via the CABI provider.
   *
   * Result data lives on `cabi.findResult(name)` afterwards (e.g.
   * `"FAHRGESTELL_NR"`, `"FA_STREAM"`, `"GM_SCHLUESSEL"`). `cabi.lastJobStatus`
   * carries the EDIABAS `JOB_STATUS`.
   */
  runCabimain: (jobName: string) => Promise<void>;
  /** Stop the scheduler + tear down. Idempotent. */
  dispose: () => Promise<void>;
}

/**
 * Resolve `<install>/NCSEXPER/SGDAT/<basename>.IPO` to bytes. Case-insensitive on
 * the filename — installs synced from Windows often mix `.ipo` and `.IPO`.
 */
async function loadIpoBytes(basename: string): Promise<Uint8Array> {
  if (!app.install?.ncsSgdat) {
    throw new Error("No NCSEXPER/SGDAT directory in the picked install");
  }
  const wantedUpper = `${basename}.IPO`.toUpperCase();
  for await (const [name, handle] of app.install.ncsSgdat.entries()) {
    if (handle.kind !== "file") continue;
    if (name.toUpperCase() === wantedUpper) {
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    }
  }
  throw new Error(
    `IPO not found: ${basename}.IPO — checked ${app.install.ncsSgdat.name}`,
  );
}

export interface StartNcsRuntimeOptions {
  /**
   * CABD module name from SGFAM.CABD / SGAUSWAHL — already includes the
   * `A_` prefix (e.g. `A_KMB46`). Used as the filename basename to look
   * up the IPO from NCSEXPER/SGDAT.
   */
  cabdBasename: string;
  /**
   * EDIABAS SGBD basename (e.g. `C_KMB46`) — what the CDHapiJob override
   * passes to `apiJob`. Comes from `SgfamRow.sgbd`. Decoupled from
   * `app.selectedModule` so the identity-read flow (which runs before any
   * module is selected) can drive the runtime directly off the SGFAM row.
   */
  sgbd: string;
}

/**
 * Build a per-CABD runtime. Looks up `<cabdBasename>.IPO` from NCSEXPER/SGDAT
 * and wires the inpax VM, providers, and CDH bridge for it.
 *
 * Requires an active `connection.session` — the runtime reuses that Ediabas
 * instance via `getTransport` so we don't double-open the serial port.
 */
export async function startNcsRuntime(
  options: StartNcsRuntimeOptions,
): Promise<RuntimeHandle> {
  const { cabdBasename, sgbd } = options;
  if (!connection.session) {
    throw new Error("No active ECU connection — Connect to the ECU first");
  }
  if (!app.install) {
    throw new Error("No install picked");
  }

  // 1. Read + parse the IPO.
  const ipoBytes = await loadIpoBytes(cabdBasename);
  const ipo = parseIpo(ipoBytes);

  // 2. Providers. A_*.ipo CABI dispatchers are batch / non-interactive — no
  //    `setscreen` / `setmenu` / `userbox*` — so the UI and external providers
  //    are pure no-ops here. (When we later wire Kernfunktionen, those IPOs
  //    *are* interactive and will need a real UI provider — task #52.)
  //
  //    `@emdzej/inpax-web-provider` 0.6.0 ships `.svelte.ts` source files that
  //    Svelte's `compileModule` can't parse (TypeScript syntax in module
  //    files), so it can't be imported here. Null providers cover everything
  //    A_*.ipo actually needs.
  const ui = new NullUIProvider();
  const external = new NullExternalProvider();

  // 3. EDIABAS — wrap the live instance from connection.session. `getTransport`
  //    returns null until the user connects; once connected, the provider's
  //    init() (driven by the IPO's `__inpa_startup__` or by us calling `ensure`)
  //    pulls the active transport.
  const ediabasInstance: Ediabas = connection.session.ediabas;
  const ediabasProvider = new EdiabasXProvider({
    instance: ediabasInstance,
    // Inpax doesn't need to manage the transport — we already own it.
    // Returning null at connection time would make init() fail; instead we
    // return a constant truthy reference that the wrapper can re-use.
    getTransport: () =>
      (connection.session?.ediabas as unknown as {
        transport?: EdiabasConfig["transport"];
      }).transport ?? null,
  });
  const inp1 = new Inp1Adapter(ediabasProvider);

  // 4. Native imports left undefined. `IInpaRuntime.nativeImports` is optional —
  //    when unset the interpreter logs and pops the frame on CALLE, leaving
  //    out-args untouched. A_*.ipo CABI dispatchers don't do INI lookups via
  //    CALLE (those happen in NCSEXPER's C side around the IPO); if a specific
  //    dispatcher does hit one, the log will tell us which import and we can
  //    add a minimal inline stub then.

  // 5. CABI provider — owns the CDH* surface + the per-IPO context (current
  //    CABD basename, SGFAM row, chassis pointer). Currently focused on
  //    CDHapiJob since slot 0x0D (`SystemFunction.exitwindows` in inpax's
  //    naming, but NCSEXPER's runtime uses it as the apiJob bridge — see
  //    docs/ncsexper-syscall-table.md for the proof) is the load-bearing
  //    override that makes A_*.ipo's per-CABD job-name mapping work.
  const cabi = new CabiProvider({
    ediabas: connection.session.ediabas,
    chassis: app.chassis,
    currentSgName: app.selectedModule?.umrsg ?? null,
    currentCabd: cabdBasename,
    currentCbd: app.selectedModule
      ? `C${app.selectedModule.codingIndex.toString(16).toUpperCase().padStart(2, "0")}`
      : null,
    currentCodierBaureihe: app.chassis?.code ?? null,
  });

  // 6. System-function overrides. The IPO bytecode calls `CALL sys 0x0D` with
  //    four string args (jobLabel, sgbdJob, params, paramsHex) — the IPO
  //    bytecode treats this as the apiJob bridge regardless of the
  //    compile-time keyword inpax names it. We bind it to our CDHapiJob
  //    handler which delegates to the live Ediabas instance.
  //
  //    Stack order: LIFO. The IPO pushes (jobLabel, sgbdJob, params,
  //    paramsHex) top-down, so we pop them in reverse: paramsHex first,
  //    then params, then sgbdJob, then jobLabel.
  //
  //    The result lands on cabi.lastJob — subsequent CDHapiResult* calls
  //    (also overridable here if the IPO uses them) read from that state.
  //    For the current flow (FgnrLesen) the IPO doesn't actually call
  //    CDHapiResultText; NCSEXPER's COAPI C code reads the result via
  //    `apiResultText("FAHRGESTELL_NR", ...)` directly after the IPO returns
  //    (we mirror that by reading EdiabasXProvider's lastResults from the
  //    orchestrator).
  const apiJobOverride: SystemFunctionOverride = async (ctx) => {
    const paramsHex = ctx.popString();
    const params = ctx.popString();
    const sgbdJob = ctx.popString();
    const jobLabel = ctx.popString();
    // jobLabel is the contract name (e.g. "FGNR_LESEN") — useful for logging
    // and the protocol report. sgbdJob is what we actually pass to apiJob.
    // sgbd is captured from the runtime config (per-CABD); the IdentityPanel
    // and module flows pass their own row's SGBD in.
    void jobLabel;
    // Combine params + paramsHex into the EDIABAS params arg. NCSEXPER
    // passes both as a single string concatenated; for now we use whichever
    // is non-empty (paramsHex wins when both are present, since paramsHex
    // is the more specific binary form).
    const paramsArg = paramsHex || params;
    await cabi.CDHapiJob(sgbd, sgbdJob, paramsArg, "");
  };

  // 6a. Catch-all no-op for every CABI-runtime slot used by A_*.ipo files.
  //
  //     NCSEXPER's `CALL sys N` dispatch table is entirely different from
  //     INPA's — same opcode (0x0C), same bytecode format, but a different
  //     numeric-ID → function mapping baked into NCSEXPER.EXE's `.data`.
  //     We inferred from disassembling all 194 A_*.ipo files that the CABI
  //     runtime uses 55 distinct slot IDs in the range 0x00..0x60. Inpax's
  //     hardcoded SystemFunctionMap targets INPA's table — using it
  //     unmodified produces "Stack underflow" / "Expected reference for
  //     out parameter" on virtually every call (PEMInitialisiere expects
  //     4 args but NCSEXPER's same-numbered slot takes 1, etc.).
  //
  //     Workaround until we dump NCSEXPER's actual `.data` table via
  //     ghidra: register a no-op for every slot the IPOs touch. `opCall`
  //     calls `popFrame()` after the override returns, which truncates the
  //     value stack back to the FRAME marker — args (and any out-refs)
  //     get cleaned up automatically. Slots with observability semantics
  //     (PEM*, OutputDebug*, setjobstatus) suffer no real loss; slots
  //     with out-param semantics leave the caller's destination at its
  //     pre-call value (typically the ALLOC default — 0 / "" / false),
  //     which is "no error" by convention. The IPO falls through error
  //     branches.
  //
  //     The load-bearing slot is 0x0D (apiJob bridge — confirmed via
  //     ghidra + the FRAME→4-string-arg pattern in every FgnrLesen /
  //     Cod / Lesen / ZcsLesen handler). That one gets a real handler
  //     above (`apiJobOverride`) that routes into our CabiProvider.
  //     Results land on `cabi.lastJob` and the orchestrator reads them
  //     via `handle.cabi.findResult(...)` after `runCabimain` returns —
  //     we don't depend on the IPO's apiResultText calls writing back.
  const noOp: SystemFunctionOverride = () => {
    /* CABI runtime slot — popFrame after this cleans args + out-refs */
  };
  const systemFunctions = new Map<number, SystemFunctionOverride>();
  for (let id = 0x00; id <= 0x60; id++) systemFunctions.set(id, noOp);
  systemFunctions.set(SystemFunction.exitwindows, apiJobOverride);

  const vm = new VM(ipo, {
    runtime: {
      ui,
      ediabas: ediabasProvider,
      inp1,
      simulation: new NullSimulationProvider(),
      print: new NullPrintProvider(),
      pem: new NullPemProvider(),
      dtm: new NullDtmProvider(),
      external,
      sps: new NullSpsProvider(),
    },
    systemFunctions,
    debug: false,
    screenExecutor: { tickInterval: 50 },
  });

  // 7. Scheduler — runs __inpa_startup__ asynchronously. For NCS's A_*.ipo files
  //    this populates the IPO's globals/constants; the actual job dispatch
  //    happens later via `runCabimain(jobName)`.
  const scheduler = new MainScheduler(vm, { tickInterval: 50, debug: false });
  scheduler.start();
  const startupPromise = vm.run().catch((err: unknown) => {
    console.error(`[ncsx-runtime/${cabdBasename}] VM startup error:`, err);
  });

  // 8. cabimain runner. NCSEXPER's MFC UI calls into the IPO with the job
  //    name as `local[0]` — see `docs/ipo-usage.md:22` ("local[0] := JOBNAME
  //    (passed by NCSEXPER's MFC UI)"). We mimic the same by pushing the
  //    string onto a fresh ExecutionContext before `executeBlockWithContext`
  //    runs the block: with frameOffset = 0 on a fresh ctx, `local[0]` ==
  //    `stack[0]`, so the IPO's `if JOBNAME == "FGNR_LESEN"` switch picks the
  //    right handler.
  //
  //    Startup must complete first — `__inpa_startup__` writes constants /
  //    globals that the cabimain switch reads from.
  const runCabimain = async (jobName: string): Promise<void> => {
    await startupPromise;
    let cabimain: FunctionBlock | undefined;
    for (const block of vm.getIpo().functions.values()) {
      if (block.header.name === "cabimain") {
        cabimain = block;
        break;
      }
    }
    if (!cabimain) {
      throw new Error(
        `cabimain not found in ${cabdBasename}.ipo — IPO is not a CABI-style dispatcher`,
      );
    }
    const ctx = vm.createExecutionContext();
    ctx.pushString(jobName);
    await vm.executeBlockWithContext(cabimain, ctx);
  };

  let disposed = false;
  return {
    cabd: cabdBasename,
    vm,
    cabi,
    ediabas: ediabasProvider,
    runCabimain,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      scheduler.stop();
      try {
        await ediabasProvider.end();
      } catch {
        /* ignore */
      }
    },
  };
}
