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
import { VM, MainScheduler } from "@emdzej/inpax-interpreter";
import { WebUIProvider } from "@emdzej/inpax-web-provider";
import {
  NullSimulationProvider,
  NullPrintProvider,
  NullPemProvider,
  NullDtmProvider,
  NullSpsProvider,
} from "@emdzej/inpax-providers/null";
import { EdiabasXProvider, Inp1Adapter } from "@emdzej/inpax-ediabasx-provider";
import {
  BrowserExternalProvider,
  BrowserNativeImportProvider,
} from "@emdzej/inpax-web-provider";
import { Ediabas, type EdiabasConfig } from "@emdzej/ediabasx-ediabas";
import { toInpaInstall } from "./inpa-install-adapter";
import { app } from "./state.svelte";
import { connection } from "./ediabas-session.svelte";

export interface RuntimeHandle {
  /** The CABD module name this runtime is bound to (e.g. `A_AKMB46`). */
  cabd: string;
  /** Underlying VM — for advanced callers / debugging. */
  vm: VM;
  /** EDIABAS bridge — exposes `lastResults` after a job runs. */
  ediabas: EdiabasXProvider;
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

/**
 * Build a per-CABD runtime. `cabdBasename` is the CABD module name from SGAUSWAHL.CABD
 * (e.g. `A_AKMB46`); we look up the matching `A_<cabd>.IPO` from NCSEXPER/SGDAT.
 *
 * Requires an active `connection.session` — the runtime reuses that Ediabas
 * instance via `getTransport` so we don't double-open the serial port.
 */
export async function startNcsRuntime(cabdBasename: string): Promise<RuntimeHandle> {
  if (!connection.session) {
    throw new Error("No active ECU connection — Connect to the ECU first");
  }
  if (!app.install) {
    throw new Error("No install picked");
  }
  const inpaInstall = toInpaInstall(app.install);
  if (!inpaInstall.ecu) {
    throw new Error("No EDIABAS/Ecu directory in the install");
  }

  // 1. Read + parse the IPO.
  const ipoBytes = await loadIpoBytes(cabdBasename);
  const ipo = parseIpo(ipoBytes);

  // 2. Providers. UI exists for state tracking even though we don't paint to it;
  //    PEM/Print/Sim/Sps/Dtm are silent — ncsx's UI is Svelte-native, not the
  //    INPA canvas.
  const ui = new WebUIProvider();
  const external = new BrowserExternalProvider();

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

  // 4. Native imports — INI lookups (CALLE for INPA.INI / EDIABAS.INI). NCSEXPER's
  //    A_*.ipo files do *some* INI lookups for chassis vocabulary; the provider
  //    pre-fetches eagerly so the synchronous CALLE handler always has data.
  const nativeImports = new BrowserNativeImportProvider({
    install: inpaInstall,
    ediabasConfig: {
      ecuPath: inpaInstall.ecu.name,
      interfaceName: "serial",
      iniPath: "",
    },
  });
  await nativeImports.prefetchIniFiles();

  // 5. VM. CABI provider intentionally absent for now — task #51. When the IPO
  //    calls a CDH* function via CALLE it will throw "unimplemented"; we log it
  //    here so we can triage which CDH functions matter for the first read flow.
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
      nativeImports,
    },
    debug: false,
    screenExecutor: { tickInterval: 50 },
  });

  // 6. Scheduler — runs __inpa_startup__ asynchronously. For NCS's A_*.ipo files
  //    this populates the IPO's globals/constants; the actual job dispatch
  //    happens later via `vm.executeBlock(cabimain)` with JOBNAME set.
  const scheduler = new MainScheduler(vm, { tickInterval: 50, debug: false });
  scheduler.start();
  void vm.run().catch((err: unknown) => {
    console.error(`[ncsx-runtime/${cabdBasename}] VM startup error:`, err);
  });

  let disposed = false;
  return {
    cabd: cabdBasename,
    vm,
    ediabas: ediabasProvider,
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
