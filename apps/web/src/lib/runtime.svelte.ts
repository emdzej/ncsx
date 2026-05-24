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

import { getLogger } from "@emdzej/bimmerz-logger";
import { parseIpo } from "@emdzej/inpax-parser";
import { VM, MainScheduler } from "@emdzej/inpax-interpreter";
import { type FunctionBlock } from "@emdzej/inpax-core";
import { CabiProvider } from "@emdzej/ncsx-inpax-cabi-provider";
import { formatFahrgestellNr } from "@emdzej/ncsx-identity";
import { buildCabiSystemFunctions } from "./cabi-syscall-overrides";
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

const log = getLogger("NCSX.web.runtime");

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
 *
 * Exported so write-dialog target-resolvers can probe an IPO for
 * jobname-dispatch support without booting the full VM. Cheap byte
 * read + string search is enough to answer "does this IPO handle
 * FGNR_SCHREIBEN / FA_WRITE / ZCS_SCHREIBEN?" — the jobname appears
 * as a string constant in any cabimain that dispatches it.
 */
export async function loadIpoBytes(basename: string): Promise<Uint8Array> {
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
    // Snapshot the FA into the provider so the IPO's `CDHGetFaVersion`
    // / `CDHGetAnzahlFaElemente` / `CDHGetFaElement` calls can walk it
    // (mirrors NCSEXPER's MFC side seeding the FA buffer at session
    // start). `null` if the user hasn't read identity yet — the FA
    // getters then degrade to "empty FA" semantics.
    fa: app.identity?.fa ?? null,
  });

  // 6. NCSEXPER CABI syscall overrides. The 99-entry slot table comes
  //    from `ncsserv.exe`'s keyword block (cross-validated 68/68 against
  //    the 334k empirical CALL sys observations from the 915 CABI IPOs
  //    in NCSEXPER/SGDAT — see `docs/ncsexper-syscall-table.md`).
  //
  //    Each slot gets a `SystemFunctionOverride` that:
  //    1. Pops args per the CABI.H signature (in reverse declaration
  //       order — IPO pushes top-down, override pops LIFO).
  //    2. Dispatches into `CabiProvider` for the load-bearing slots
  //       (CDHapiJob at 0x0D, CDHapiResultText at 0x0F, etc.) so EDIABAS
  //       calls actually fire and result data lands on `cabi.lastJob`.
  //    3. Writes outs back through ref-params for utility funcs the IPO
  //       depends on (strlen, strcat, midstr, ...) — without this the
  //       IPO's control flow reads stale ALLOC defaults.
  //    4. Pops + no-ops the rest (observability slots like PEM*,
  //       CDHSetCabdPar, FSW/PSW toggles — useful in NCSEXPER's full
  //       coding flow but not for our read-only path).
  //
  //    See `cabi-syscall-overrides.ts` for the per-slot implementations.
  const systemFunctions = buildCabiSystemFunctions(cabi, {
    defaultSgbd: sgbd,
  });

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
    log.error({ err, cabd: cabdBasename }, "VM startup error");
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
    // Per-dispatch cabd-par seeding — mirrors NCSEXPER's
    // dispatchUserJob (FUN_00402c70):
    //   1. coapiClearCabdParsKeepApp() — wipe the CMapStringToString
    //      but restore APPLIKATION afterwards.
    //   2. Push job-specific keys from CDocument fields (typed host
    //      state) into the freshly-empty map.
    //   3. Dispatch via coapiRunCabd("…", cabdHandle, 0) — which
    //      writes JOBNAME into the same map and runs cabimain.
    //
    // Step (1) is implicit for us: every `startNcsRuntime` call
    // constructs a brand-new CabiProvider with an empty cabdPars
    // Map, so the dispatch already starts clean. Step (2) is the
    // mapping below — job-keyed reads from `app.identity` and
    // `app.chassis`. NCSEXPER's anchor is the inline strcmp
    // chain in dispatchUserJob (PC 0x402d25 / 0x402e65 / 0x402ec5).
    //
    // Wipe the per-session error scratchpad before dispatching. The
    // IPO's `__inpa_startup__` / cabimain prologue installs a
    // "no-job-yet" sentinel (typically errNr=1063 / returnVal=1063,
    // visible in CDHSetError logs as `mod="A_<cabd>.IPS"
    // proc="cabimain"`); NCSEXPER's `coapiRunCabimain` clears it
    // immediately before the IPO begins real work. Without this reset
    // the IPO's post-read `CDHTestError` check trips on its own
    // sentinel and bails — symptom is SG_CODIEREN returning OKAY at
    // the EDIABAS layer but writing nothing (only the first
    // `C_S_LESEN` runs).
    await cabi.CDHResetError();

    // APPLIKATION is the one key NCSEXPER preserves across the
    // dispatchUserJob reset (cabdParsClearKeepApp_impl saves it →
    // RemoveAll → restores). We re-seed it unconditionally since
    // there's no preserved-across-reset channel; the chassis code
    // is the natural value.
    //
    // Caveat: NCSEXPER's FA_WRITE path actually wipes APPLIKATION a
    // second time (coapiWriteAuftrag calls coapiResetCabdPars on its
    // resolved CABD handle before seeding FA_STREAM), so under the
    // real binary APPLIKATION is absent when cabimain("FA_WRITE")
    // runs. Re-seeding here is defensive — harmless if the IPO
    // ignores it, useful if it doesn't.
    if (app.chassis?.code) {
      await cabi.CDHSetCabdPar("APPLIKATION", app.chassis.code);
    }
    // FAHRGESTELL_NR — seeded only for FGNR_SCHREIBEN, matching
    // dispatchUserJob's per-job branch. The VIN gets the BMW Mod-36
    // check character appended (formatFahrgestellNr port of
    // coapiSetFgNr's CalcMod36CheckSum). The IPO ultimately ships
    // the encoded VIN through the SGBD's `C_FG_AUFTRAG` job
    // (via CDHapiJob / CDHapiJobData depending on the dispatcher).
    if (jobName === "FGNR_SCHREIBEN" && app.identity?.vin) {
      await cabi.CDHSetCabdPar(
        "FAHRGESTELL_NR",
        formatFahrgestellNr(app.identity.vin),
      );
    }
    // ZCS_SCHREIBEN — seed GM/SA/VN keys from the cached ZCS read.
    // Matches the three coapiSetCabdPar calls at PC 0x402d2f..0x402d5d
    // in dispatchUserJob.
    //
    // IPO-side (A_KMB46.ipo on E46): cabimain's ZCS_SCHREIBEN branch
    // dispatches to the unified `Cod` user-function — shared with
    // SG_CODIEREN / TEILBEREICH_CODIEREN / FGNR_SCHREIBEN /
    // ZCS_LOESCHEN. `Cod` reads current coding via C_S_LESEN, builds
    // the new ZCS bytes from the seeded GM/SA/VN, and ships them via
    // `CDHapiJobData(sgbd, "C_S_AUFTRAG", bytes, len, "")`. The SGBD
    // side handles `C_S_AUFTRAG` as the universal write-with-order
    // job — same one used for FGNR_SCHREIBEN / ZCS_LOESCHEN.
    if (jobName === "ZCS_SCHREIBEN" && app.identity?.zcs) {
      const zcs = app.identity.zcs;
      await cabi.CDHSetCabdPar("GM_SCHLUESSEL", zcs.gm);
      await cabi.CDHSetCabdPar("SA_SCHLUESSEL", zcs.sa);
      await cabi.CDHSetCabdPar("VN_SCHLUESSEL", zcs.vn);
    }
    // FA_WRITE — NCSEXPER's coapiWriteAuftrag (FUN_0042f9c0) seeds
    // the raw FA token string as the `FA_STREAM` cabd-par before
    // dispatching the IPO. The IPO then:
    //   1. CDHGetCabdPar("FA_STREAM") → FA token string
    //   2. Build a CSV input (e.g. "1;02;<faText>;…")
    //   3. CDHapiJob("FA", "FA_STREAM_FOR_ECU", csv, "")
    //      — invokes FA.PRG (the BMW-shipped meta-SGBD) to convert
    //      FA tokens → binary FA bytes
    //   4. CDHapiResultText("FA_STREAM_FOR_ECU", 1) → binary FA hex
    //   5. CDHapiJob(targetSgbd, "C_FA_AUFTRAG", binaryFaHex, "")
    //      — THE ACTUAL WRITE on the target ECU's SGBD
    //
    // The typed FA-walker channel — `fa:` passed to the CabiProvider
    // constructor, surfaced via `CDHGetFaVersion` /
    // `CDHGetAnzahlFaElemente` / `CDHGetFaElement` — is a separate
    // IPC used by FA-decode IPOs that iterate FA element-by-element.
    // FA_WRITE doesn't use it.
    //
    // FA_READ needs no seed — the IPO PRODUCES `FA_STREAM` via
    // CDHSetCabdPar during the run, and we surface it in the result
    // panel.
    if (jobName === "FA_WRITE" && app.identity?.fa) {
      await cabi.CDHSetCabdPar("FA_STREAM", app.identity.fa);
    }

    // NCSEXPER's C side publishes JOBNAME via the CABD-parameter store
    // before invoking the IPO scheduler — cabimain's pc=6 reads it back
    // via CDHGetCabdPar("JOBNAME"). Mirror that: set the param first so
    // the IPO's dispatch finds the right case. Also push it as local[0]
    // (defensive — matches the disassembly comment in docs/ipo-usage.md
    // that says `local[0] := JOBNAME`).
    await cabi.CDHSetCabdPar("JOBNAME", jobName);
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
