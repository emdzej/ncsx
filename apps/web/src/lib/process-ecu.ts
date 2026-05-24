/**
 * "Process ECU" orchestrator — mirrors the NCSEXPER flow where the user
 * picks an SG from the SGFAM list and the app reads its CODIERINDEX
 * from the live ECU, then auto-loads the matching `.Cxx` CABD variant.
 *
 * Sequence:
 *   1. Spin up a per-CABD runtime (loads `A_<cabd>.IPO`, wires
 *      CabiProvider + EDIABAS).
 *   2. `runCabimain("CODIERINDEX_LESEN")` — the IPO's CILesen handler
 *      issues `apiJob(SGBD, "IDENT", "", "ID_COD_INDEX")`, reads back
 *      the 1-2 char hex value, and stores it under the CABD parameter
 *      name `CODIERINDEX` (we mirror NCSEXPER's `coapiSetFgNr`-style
 *      flow via our cabdPars store).
 *   3. Parse the hex → coding-index number.
 *   4. Look up the physical CABD-module file basename via SGAUSWAHL:
 *      we need the SGAUSWAHL row whose `UMRSG === SgfamRow.sgName`
 *      AND whose `CBD === "C<HH>"` (where HH = coding-index as
 *      two-digit upper-case hex). That row's `SGNAME` is the `.Cxx`
 *      file basename, and `SGBD` is the EDIABAS SGBD bound to that
 *      specific CI (older / newer CIs of the same SG sometimes use
 *      different SGBDs — see ecu-selection.md §8).
 *   5. Call into the existing CABD loader + buildFunctionList path
 *      (same code ModuleList uses when the user picks a CI manually).
 *
 * On any failure, the returned `ProcessEcuResult` carries an `error`
 * the caller can surface — the caller doesn't have to know about IPO
 * internals.
 */

import { getLogger } from "@emdzej/bimmerz-logger";
import { buildFunctionList, type FunctionList } from "@emdzej/ncsx-function-list";
import type { Chassis } from "@emdzej/ncsx-chassis";
import { formatFahrgestellNr } from "@emdzej/ncsx-identity";
import type { SgfamRow } from "@emdzej/ncsx-text-tables";
import { app } from "./state.svelte";
import { startNcsRuntime } from "./runtime.svelte";

const log = getLogger("NCSX.web.process-ecu");

export interface ProcessEcuResult {
  ok: boolean;
  /** Parsed coding index (e.g. `6` for `.C06`) when read succeeded. */
  codingIndex?: number;
  /** Physical CABD-module basename matching `(SgfamRow.sgName, ci)`. */
  moduleName?: string;
  /** EDIABAS SGBD for that specific (SG, CI) pair. */
  sgbd?: string;
  /** Last EDIABAS JOB_STATUS from CODIERINDEX_LESEN, for diagnostic display. */
  jobStatus?: string;
  /** Failure cause when `ok=false`. */
  error?: string;
}

/**
 * Find the SGAUSWAHL row that links a logical SG (SgfamRow.sgName) +
 * a CI label (e.g. `"C06"`) to its on-disk `.Cxx` module file. Returns
 * `undefined` if the chassis doesn't ship that variant.
 */
export function findPhysicalModule(
  chassis: Chassis,
  logicalSgName: string,
  ciLabel: string,
): { moduleName: string; sgbd: string } | undefined {
  for (const block of chassis.sget.blocks) {
    if (!block.name.startsWith("SGAUSWAHL_")) continue;
    for (const row of block.rows) {
      const umrsg = String(row.UMRSG ?? "");
      const cbd = String(row.CBD ?? "");
      if (umrsg !== logicalSgName || cbd !== ciLabel) continue;
      const moduleName = String(row.SGNAME ?? "");
      const sgbd = String(row.SGBD ?? "");
      if (!moduleName || !sgbd) continue;
      return { moduleName, sgbd };
    }
  }
  return undefined;
}

/**
 * Format a coding-index number into the canonical `Cxx` filename suffix.
 * `6 → "C06"`, `16 → "C10"` (hex, upper-case, 2-digit padded).
 */
export function formatCi(ci: number): string {
  return `C${ci.toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * Run the read-coding-index flow against a live ECU and prep the
 * FunctionTree for editing. On success, mutates `app.functionList`,
 * `app.selectedModule`, `app.selectedSg`, `app.lastReadNetto`, and
 * `app.view = "view-module"`.
 */
export async function processEcu(
  chassis: Chassis,
  row: SgfamRow,
): Promise<ProcessEcuResult> {
  if (!row.cabd || !row.sgbd) {
    return { ok: false, error: `SGFAM row for ${row.sgName} is missing CABD or SGBD` };
  }

  const handle = await startNcsRuntime({
    cabdBasename: row.cabd,
    sgbd: row.sgbd,
  });
  let codingIndexHex: string | undefined;
  let jobStatus: string | undefined;
  try {
    await handle.runCabimain("CODIERINDEX_LESEN");
    jobStatus = handle.cabi.lastJobStatus;
    const raw = handle.cabi.cabdPar("CODIERINDEX");
    if (typeof raw === "string") codingIndexHex = raw.trim();
  } finally {
    await handle.dispose();
  }

  if (!codingIndexHex || codingIndexHex.length === 0) {
    return {
      ok: false,
      jobStatus,
      error: `IPO ran but CODIERINDEX wasn't published (last status: ${jobStatus ?? "—"})`,
    };
  }

  const ci = Number.parseInt(codingIndexHex, 16);
  if (!Number.isFinite(ci) || ci < 0 || ci > 0xff) {
    return {
      ok: false,
      jobStatus,
      error: `Unparseable CODIERINDEX "${codingIndexHex}"`,
    };
  }

  const ciLabel = formatCi(ci);
  const physical = findPhysicalModule(chassis, row.sgName, ciLabel);
  if (!physical) {
    return {
      ok: false,
      codingIndex: ci,
      jobStatus,
      error: `No SGAUSWAHL row matches ${row.sgName} + ${ciLabel} — chassis ${chassis.code} doesn't ship this variant`,
    };
  }

  const cabd = await chassis.cabd.openModule(physical.moduleName, ci);
  const list = buildFunctionList(cabd, {
    keywords: {
      fsw: chassis.swtFsw?.byKeyId,
      psw: chassis.swtPsw?.byKeyId,
    },
  });

  app.functionList = list;
  app.selectedSg = `${physical.moduleName}.${ciLabel}`;
  app.selectedModule = {
    moduleName: physical.moduleName,
    codingIndex: ci,
    sgbd: physical.sgbd,
    umrsg: row.sgName,
    resolution: {
      kind: "auto",
      sourceSg: row.sgName,
      codingIndexHex,
      jobStatus: jobStatus ?? "",
    },
  };
  app.lastReadNetto = null;
  app.availableJobs = null;
  app.view = "view-module";

  // Enumerate the IPO's declared jobs in the background — same shape
  // NCSEXPER's "Change job" dialog uses. Doesn't block the view from
  // opening; if it fails, the action bar just shows the explicit
  // Read/Apply buttons without the "Run job" dropdown.
  void processListJobs(row, physical.sgbd)
    .then((result) => {
      if (result.ok && result.jobs) {
        app.availableJobs = result.jobs;
      }
    })
    .catch((err: unknown) => {
      // Non-fatal — the explicit Read/Apply buttons still work even
      // without the enumerated list.
      log.warn({ err }, "JOB_ERMITTELN failed");
    });

  return {
    ok: true,
    codingIndex: ci,
    moduleName: physical.moduleName,
    sgbd: physical.sgbd,
    jobStatus,
  };
}

export interface ReadCodingResult {
  ok: boolean;
  /** Netto-data bytes returned by the SGBD's `C_S_LESEN` job. */
  netto?: Uint8Array;
  /** Last EDIABAS JOB_STATUS surfaced by the IPO run, for diagnostics. */
  jobStatus?: string;
  /** Failure cause when `ok=false`. */
  error?: string;
}

/**
 * Run `CODIERDATEN_LESEN` against a live ECU through the per-CABD IPO
 * dispatcher. Mirrors NCSEXPER's path: `cabimain` switches on the job
 * name and dispatches to `Lesen`, which runs `IDENT` (apiJob) →
 * `C_S_LESEN` (apiJobData) → reads back `CODIER_DATEN` as the netto
 * bytes.
 *
 * Why through the IPO and not a direct `apiJob(sgbd, "CODIERDATEN_LESEN")`?
 * The IPO carries per-CABD nuances (auth, multi-step state machines,
 * coding-index gates) that the SGBD alone doesn't enforce. Going
 * through the dispatcher means we behave like NCSEXPER on every CABD
 * — including the chassis where the read path forks differently.
 *
 * The caller wires the SGFAM row (for the CABD/IPO basename) and the
 * effective SGBD (potentially CI-specific via SGAUSWAHL, e.g.
 * `KOMBI46R` for newer KMB CIs vs `C_KMB46` for older ones).
 */
export async function processReadCoding(
  row: SgfamRow,
  sgbd: string,
  functionList: FunctionList,
): Promise<ReadCodingResult> {
  if (!row.cabd) {
    return { ok: false, error: `SGFAM row for ${row.sgName} has no CABD — can't load A_*.ipo` };
  }
  if (!sgbd) {
    return { ok: false, error: `No SGBD resolved for ${row.sgName}` };
  }

  // Flatten FunctionList items into the per-byte slot table NCSEXPER's
  // C side would seed via repeated CDHSetNettoData(addr, 0) calls. The
  // IPO's CDHGetApiJobData walks this table to build C_S_LESEN request
  // packets. Each address gets one slot regardless of how many
  // FunctionList items touch it.
  const slots = flattenSlots(functionList);
  if (slots.length === 0) {
    return {
      ok: false,
      error: `FunctionList for ${row.sgName} has no coded addresses — nothing to read`,
    };
  }

  const handle = await startNcsRuntime({
    cabdBasename: row.cabd,
    sgbd,
  });
  handle.cabi.setNettoSlots(slots);
  // NCSEXPER's C side normally configures the data-org during CABD
  // load — *before* the IPO runs. Our orchestrator replaces that C
  // side, so we seed it here. Derive WortBreite from the CABD's
  // SPEICHERORG (`memoryStructure`) and leave byte-order / addr-mode
  // at their post-coapiSetCabd defaults: ByteFolge=0 (low-byte
  // first), AdrMode=0 (linear). The SGBD's `len = 22 + N*WB` check
  // fails if WB doesn't match the SGBD's hardcoded word width — for
  // E46 KMB that's 2 (the `mult L0, 2` is a literal in
  // `C_KMB46.prg::C_S_LESEN`).
  const wortBreite =
    functionList.memoryStructure === "BYTE" ? 1 : 2;
  await handle.cabi.CDHSetDataOrg(wortBreite, 0, 0);

  let jobStatus: string | undefined;
  let slotValues: Map<number, number> | undefined;
  try {
    await handle.runCabimain("CODIERDATEN_LESEN");
    jobStatus = handle.cabi.lastJobStatus;
    slotValues = handle.cabi.nettoSlotValues();
  } finally {
    await handle.dispose();
  }

  if (!slotValues || slotValues.size === 0) {
    return {
      ok: false,
      jobStatus,
      error: `IPO ran but no slot values were populated (status: ${jobStatus ?? "—"})`,
    };
  }

  // Materialise the netto: pad to max(address) + 1 (or to the
  // FunctionList's deliveryState length if larger so the resulting
  // bytes line up with default-value comparisons). Holes (addresses
  // no slot covered) stay at the deliveryState byte if available,
  // otherwise 0.
  const maxAddr = Math.max(...slotValues.keys());
  const size = Math.max(maxAddr + 1, functionList.deliveryState.length);
  const netto = new Uint8Array(size);
  if (functionList.deliveryState.length > 0) {
    netto.set(functionList.deliveryState.subarray(0, size));
  }
  for (const [addr, value] of slotValues) {
    if (addr >= 0 && addr < netto.length) netto[addr] = value;
  }

  return { ok: true, netto, jobStatus };
}

/**
 * Walk the FunctionList and emit one slot per byte address the CABD
 * declares. Deduplicated — overlapping items share a single slot.
 * Sorted by address so CDHGetApiJobData can find contiguous runs.
 *
 * Includes group items (CODIERDATENBLOCK / HERSTELLERDATENBLOCK /
 * RESERVIERTDATENBLOCK) so we cover the FULL netto extent, not just
 * bytes carrying a function/property. NCSEXPERT reads byte ranges
 * declared at the block level too — confirmed by comparing our read
 * with `NETTODAT.TRC`: ranges like `0x10..0x1F` (sitting inside a
 * group but with no nested function) are read by NCSEXPERT but were
 * dropped by us when we filtered groups out.
 *
 * When `codingOnly` is true, restrict slot emission to addresses that
 * fall inside a `CODIERDATENBLOCK` group (groupKind === 'coding').
 * The ECU rejects writes to `HERSTELLERDATENBLOCK` and
 * `RESERVIERTDATENBLOCK` regions with `ERROR_ECU_PARAMETER` (status
 * byte 0xB0); those are diagnostic-readable but not coder-writable.
 * Used by `processWriteCoding` so SG_CODIEREN only touches the
 * writable region — matching what NCSEXPER would have NCSdummy's
 * coding pass produce.
 */
function flattenSlots(
  list: FunctionList,
  netto?: Uint8Array,
  { codingOnly = false }: { codingOnly?: boolean } = {},
): Array<{ addr: number; value?: number }> {
  // Build the set of byte addresses contained inside coding groups —
  // only consulted when `codingOnly` is set.
  let writableSet: Set<number> | null = null;
  if (codingOnly) {
    writableSet = new Set<number>();
    for (const item of list.items) {
      if (item.kind !== "group" || item.groupKind !== "coding") continue;
      for (let off = 0; off < item.length; off++) {
        writableSet.add(item.address + off);
      }
    }
  }
  const addrs = new Set<number>();
  for (const item of list.items) {
    for (let off = 0; off < item.length; off++) {
      const addr = item.address + off;
      if (writableSet && !writableSet.has(addr)) continue;
      addrs.add(addr);
    }
  }
  const sorted = [...addrs].sort((a, b) => a - b);
  if (!netto) return sorted.map((addr) => ({ addr }));
  // Drop slots whose address falls outside the netto's extent. For
  // Apply Defaults specifically (netto = CABD ANLIEFERZUSTAND, which
  // can be shorter than the full CODIERDATENBLOCK range), zero-filling
  // here would send "write zero to this ECU byte" telegrams for bytes
  // the CABD has no factory default for — the ECU rejects with
  // ERROR_VERIFY because the ECU's actual value doesn't match the
  // bogus zero we're writing. Skipping the slot instead leaves the
  // ECU's current byte untouched, matching NCSEXPER's "MAN file only
  // mentions what it mentions" semantics.
  //
  // For normal writes (netto = lastReadNetto with user edits spliced
  // in), netto covers the full coding region by construction so this
  // filter is a no-op.
  return sorted
    .filter((addr) => addr < netto.length)
    .map((addr) => ({ addr, value: netto[addr]! }));
}

export interface WriteCodingResult {
  ok: boolean;
  /** EDIABAS JOB_STATUS from the IPO run (`OKAY` on success). */
  jobStatus?: string;
  /** Netto bytes the SGBD reported after the write (when re-read landed). */
  verifiedNetto?: Uint8Array;
  /** Failure cause when `ok=false`. */
  error?: string;
}

/**
 * Run `SG_CODIEREN` against a live ECU through the per-CABD IPO's
 * `Cod` handler. Mirrors `processReadCoding` but seeds the slot table
 * with values from `pendingNetto` instead of zeros — those bytes end
 * up in the `C_S_SCHREIBEN` (or `C_S_AUFTRAG`) telegram's data
 * payload. The IPO picks the exact SGBD job based on its internal
 * `[FSWPSW].SgCodierenAuftrag` equivalent state.
 *
 * Optionally re-reads the netto post-write so callers can verify the
 * SGBD's report (and let users see any auto-checksum-recalc the SGBD
 * applied). `reread: false` skips that round trip for callers that
 * want to handle it themselves.
 *
 * Same caveat as `processReadCoding`: the SGFAM `row.cabd` resolves
 * the `A_*.ipo` to dispatch; `sgbd` is the CI-specific EDIABAS module
 * from SGAUSWAHL.
 */
export async function processWriteCoding(
  row: SgfamRow,
  sgbd: string,
  functionList: FunctionList,
  pendingNetto: Uint8Array,
  {
    reread = true,
    lastReadNetto,
  }: { reread?: boolean; lastReadNetto?: Uint8Array } = {},
): Promise<WriteCodingResult> {
  if (!row.cabd) {
    return { ok: false, error: `SGFAM row for ${row.sgName} has no CABD — can't load A_*.ipo` };
  }
  if (!sgbd) {
    return { ok: false, error: `No SGBD resolved for ${row.sgName}` };
  }

  // Slots seeded with the *pending* netto values — CDHGetApiJobData
  // copies these into the binbuf scratchpad which the SGBD then ships
  // in the C_S_SCHREIBEN data telegram. Restricted to CODIERDATENBLOCK
  // addresses: the ECU rejects writes to manufacturer / reserved
  // regions with status 0xB0 = ERROR_ECU_PARAMETER, which the SGBD
  // surfaces as JOB_STATUS=ERROR_ECU_PARAMETER. Read path
  // (processReadCoding) keeps the full netto extent because the ECU
  // is happy to *read* anywhere. (Empirical: widening the filter
  // brings ECU_PARAMETER straight back.)
  const slots = flattenSlots(functionList, pendingNetto, { codingOnly: true });
  // `lastReadNetto` accepted for future use (diff-only filtering) but
  // currently NOT applied: empirically a diff-filtered slot table
  // truncates the slot list early enough that the IPO Cod's
  // post-write `CDHGetApiJobData` call (used to template the
  // C_CHECKSUM binbuf) returns bufSize=0, which the IPO forwards into
  // apiJobData → SGBD bails with ERROR_NO_BIN_BUFFER. Until we
  // understand how NCSEXPER survives that same dispatch (its decomp
  // also returns bufSize=0 when slots are exhausted), keep the full
  // CODIERDATENBLOCK-wide seed.
  void lastReadNetto;
  // Diagnostic: log slot-value distribution before dispatch. Lets us
  // see whether the pendingNetto we were handed actually populates the
  // CODIERDATENBLOCK addresses (or leaves them at zero because the
  // netto is shorter than the slot range — the common shape-mismatch
  // that surfaces as `ERROR_VERIFY` from C_S_AUFTRAG even though the
  // SGBD/IPO transport is healthy).
  //
  // Also report the unfiltered coding-region span so we can tell apart
  // "the CABD declares no CODIERDATENBLOCK groups" (codingRange empty)
  // from "the pendingNetto is too short to cover the coding range"
  // (codingRange present, slots dropped). The first means a CABD
  // parser gap; the second means Apply Defaults can't run because
  // ANLIEFERZUSTAND is smaller than the writable region.
  const codingAddrs: number[] = [];
  for (const item of functionList.items) {
    if (item.kind !== "group" || item.groupKind !== "coding") continue;
    for (let off = 0; off < item.length; off++) {
      codingAddrs.push(item.address + off);
    }
  }
  codingAddrs.sort((a, b) => a - b);
  const codingRange =
    codingAddrs.length > 0
      ? `0x${codingAddrs[0]!.toString(16)}..0x${codingAddrs[codingAddrs.length - 1]!.toString(16)} (${codingAddrs.length} bytes)`
      : "<empty>";
  const nonZeroSlots = slots.filter((s) => (s.value ?? 0) !== 0).length;
  const maxSlotAddr = slots.length > 0 ? slots[slots.length - 1]!.addr : 0;
  log.debug(
    {
      codingRange,
      slots: slots.length,
      nonZeroSlots,
      addrStart: slots[0]?.addr,
      addrEnd: maxSlotAddr,
      pendingNettoLen: pendingNetto.length,
      deliveryStateLen: functionList.deliveryState.length,
    },
    "processWriteCoding",
  );

  if (slots.length === 0) {
    // Differentiate the two failure modes so callers can react usefully.
    if (codingAddrs.length === 0) {
      return {
        ok: false,
        error: `${row.sgName}'s CABD declares no CODIERDATENBLOCK group — nothing the coding API is allowed to write`,
      };
    }
    return {
      ok: false,
      error: `${row.sgName}'s CODIERDATENBLOCK spans ${codingRange} but the source netto only covers ${pendingNetto.length} bytes — every coded byte falls outside the supplied defaults`,
    };
  }

  const handle = await startNcsRuntime({ cabdBasename: row.cabd, sgbd });
  handle.cabi.setNettoSlots(slots);
  // Same C-side-replacement as the read path — NCSEXPER configures
  // CDHSetDataOrg during CABD load, before the IPO dispatches.
  const wortBreite =
    functionList.memoryStructure === "BYTE" ? 1 : 2;
  await handle.cabi.CDHSetDataOrg(wortBreite, 0, 0);

  // Seed the IPO's system-data store with the chassis number so the
  // IPO can thread it into `C_FG_AUFTRAG`'s `para`. Anchor: A_GM5.ipo
  // @ PC 0x008e..0x009a does
  //   CDHGetSystemData("FAHRGESTELL_NR", &local[3])
  //   → CDHapiJob("C_GM5", "C_FG_AUFTRAG", local[3], "")
  // and the SGBD's `strlen S1; comp L0, #$12 (=18)` check rejects
  // anything other than an exactly-18-byte buffer with
  // `JOB_STATUS = "ERROR_NUMBER_ARGUMENT"`.
  //
  // NCSEXPER stores `FAHRGESTELL_NR` as `<17-char VIN><M36 check
  // char>` (18 chars), computed by `coapiSetFgNr` (FUN_0042a560) via
  // `CalcMod36CheckSum` over `"FP" + vin`. `formatFahrgestellNr`
  // (`packages/identity/src/m36-checksum.ts`) is the JS port — same
  // algorithm, locked by unit tests against the worked
  // `"FPWBAAA00000PM10277" → 'L'` example.
  //
  // Skip silently if identity hasn't been read yet — the IPO's
  // `TestCDHFehler` path tolerates the missing value (CDHGetSystemData
  // returns retVal=0 + empty string) and the downstream SGBD will
  // surface ERROR_NUMBER_ARGUMENT as before, which is a better failure
  // mode than synthesising a fake FG here.
  if (app.identity?.vin) {
    const fgnr = formatFahrgestellNr(app.identity.vin);
    await handle.cabi.CDHSetSystemData("FAHRGESTELL_NR", fgnr);
  }

  let jobStatus: string | undefined;
  let lastErr: ReturnType<typeof handle.cabi.getLastCdhError> | null = null;
  let returnVal = 0;
  try {
    await handle.runCabimain("SG_CODIEREN");
    jobStatus = handle.cabi.lastJobStatus;
    lastErr = handle.cabi.getLastCdhError();
    returnVal = handle.cabi.getReturnVal();
  } finally {
    await handle.dispose();
  }

  if (jobStatus !== "OKAY") {
    return {
      ok: false,
      jobStatus,
      error: `IPO ran SG_CODIEREN but JOB_STATUS=${jobStatus ?? "(missing)"} — write did not complete cleanly`,
    };
  }

  // `JOB_STATUS=OKAY` only reflects the *last* EDIABAS job the IPO ran
  // (typically IDENT or a verify read). The IPO itself signals success
  // via `CDHSetReturnVal(0)` and clean error state. A non-zero
  // `returnVal` or a leftover `CDHSetError` after dispatch means the
  // IPO bailed out cleanly without reaching `C_S_AUFTRAG` — silently
  // skipping the write. Surface both so the user sees what happened.
  if (returnVal !== 0 || (lastErr && lastErr.errNr !== 0)) {
    return {
      ok: false,
      jobStatus,
      error:
        `IPO bailed before writing — returnVal=${returnVal}` +
        (lastErr && lastErr.errNr !== 0
          ? ` · errNr=${lastErr.errNr} at ${lastErr.modulName}:${lastErr.procName}:${lastErr.lineNr}` +
            (lastErr.errorInfo ? ` "${lastErr.errorInfo}"` : "")
          : ""),
    };
  }

  if (!reread) return { ok: true, jobStatus };

  // Verify by re-reading. Uses the same IPO path as a normal Read so
  // any auto-checksum / mirror bytes the SGBD touched are reflected.
  const verify = await processReadCoding(row, sgbd, functionList);
  return {
    ok: true,
    jobStatus,
    verifiedNetto: verify.ok ? verify.netto : undefined,
  };
}

export interface ListJobsResult {
  ok: boolean;
  /** Job names the CABD's IPO declared via JOB[N] / JOB_ANZAHL. */
  jobs?: string[];
  jobStatus?: string;
  error?: string;
}

/**
 * Enumerate the SG's available jobs by dispatching `JOB_ERMITTELN`
 * through the per-CABD IPO — same call NCSEXPER's "Change job" dialog
 * makes to build its list (screenshot reference in
 * `docs/ncsexper-job-list.md` if it exists).
 *
 * Each `A_*.ipo` has a `Jobs` function the cabimain switch routes to
 * when JOBNAME == "JOB_ERMITTELN". That function unconditionally
 * emits `CDHSetCabdPar("JOB[1]", "<name1>")`,
 * `CDHSetCabdPar("JOB[2]", "<name2>")`, … followed by
 * `CDHSetCabdPar("JOB_ANZAHL", "<N>")` with the count. We read back
 * from `cabi.cabdPar(...)` after the run.
 *
 * The job set is **static per IPO** — declared at IPO authoring time
 * by BMW. It doesn't depend on connected-ECU state, but we still
 * route through the runtime so the dispatcher's Jobs function fires
 * (the strings live in IPO constants, not in any data file we could
 * read directly).
 *
 * AKMB exposes 14 jobs (JOB_ERMITTELN, INFO, CODIERINDEX_LESEN,
 * SG_CODIEREN, TEILBEREICH_CODIEREN, FGNR_SCHREIBEN, ZCS_LOESCHEN,
 * CODIERDATEN_LESEN, FGNR_LESEN, ZCS_LESEN, NETTODATEN_SCHREIBEN,
 * SG_IDENT, FA_READ, FA_WRITE). GM5 exposes 9 (no FA_*, no
 * ZCS_* — different SGBD generation). The list is always returned
 * in the order the IPO declares them.
 */
export async function processListJobs(
  row: SgfamRow,
  sgbd: string,
): Promise<ListJobsResult> {
  if (!row.cabd) {
    return { ok: false, error: `SGFAM row for ${row.sgName} has no CABD — can't load A_*.ipo` };
  }
  if (!sgbd) {
    return { ok: false, error: `No SGBD resolved for ${row.sgName}` };
  }

  const handle = await startNcsRuntime({ cabdBasename: row.cabd, sgbd });
  let jobStatus: string | undefined;
  const jobs: string[] = [];
  try {
    await handle.runCabimain("JOB_ERMITTELN");
    jobStatus = handle.cabi.lastJobStatus;
    // Read `JOB[1]..JOB[N]`. Stop the moment we miss one (defensive
    // — if `JOB_ANZAHL` lies, we still walk up to that bound but
    // bail early on a gap).
    const rawCount = handle.cabi.cabdPar("JOB_ANZAHL");
    const count =
      typeof rawCount === "string"
        ? Number.parseInt(rawCount, 10)
        : typeof rawCount === "number"
          ? rawCount
          : 0;
    if (Number.isFinite(count) && count > 0) {
      for (let i = 1; i <= count; i++) {
        const v = handle.cabi.cabdPar(`JOB[${i}]`);
        if (typeof v !== "string" || v.length === 0) break;
        jobs.push(v);
      }
    }
  } finally {
    await handle.dispose();
  }

  return { ok: true, jobs, jobStatus };
}

/**
 * Decoded shape of a single `CDHapiJob` result set — what
 * `cabi.lastJob.sets[i]` carries after a job runs. Keys come from the
 * SGBD's `ergX("NAME", value)` calls; values are whatever ediabasx
 * marshals out (typically string / number / Uint8Array).
 */
export type JobResultSet = ReadonlyMap<string, unknown>;

export interface RunJobResult {
  ok: boolean;
  /** Job that was dispatched. */
  jobName: string;
  /** All result sets the SGBD emitted (one per `ergsi` block etc.). */
  sets: JobResultSet[];
  /** EDIABAS JOB_STATUS the IPO's apiJob left in lastJob. */
  jobStatus?: string;
  /** All `CDHSetCabdPar(...)` values the IPO wrote during this run — surfaced for jobs like JOB_ERMITTELN that publish via CABD pars rather than result sets. */
  cabdPars: Record<string, string | number>;
  /** EDIABAS-layer error text if the IPO threw out of the interpreter. */
  error?: string;
}

/**
 * Run an arbitrary CABD-known job by name through the per-CABD IPO
 * dispatcher. Use for jobs that don't have a dedicated orchestrator
 * (e.g. `INFO`, `SG_IDENT`, `KEY_MEMORY_NR`) or for manual one-shots
 * from a "Run job" UI.
 *
 * Caveats:
 *   - WRITE-class jobs (`SG_CODIEREN`, `FGNR_SCHREIBEN`, `FA_WRITE`,
 *     `NETTODATEN_SCHREIBEN`, `TEILBEREICH_CODIEREN`, `ZCS_LOESCHEN`)
 *     typically expect upstream state — netto slots seeded via
 *     `CDHSetNettoData`, FAHRGESTELL_NR in system-data, FA seeded on
 *     the provider, etc. Without that prep they'll usually return a
 *     SGBD-level error (`ERROR_NUMBER_ARGUMENT`,
 *     `ERROR_NO_BIN_BUFFER`) but won't damage anything they didn't
 *     have the inputs to write.
 *   - READ-class jobs are safe to invoke directly — no prep, no
 *     side-effect.
 *
 * Returns the SGBD's result sets plus the cabdPars map so the UI can
 * format whichever surface the job exposes.
 */
export async function processRunJob(
  row: SgfamRow,
  sgbd: string,
  jobName: string,
): Promise<RunJobResult> {
  if (!row.cabd) {
    return {
      ok: false,
      jobName,
      sets: [],
      cabdPars: {},
      error: `SGFAM row for ${row.sgName} has no CABD — can't load A_*.ipo`,
    };
  }
  if (!sgbd) {
    return {
      ok: false,
      jobName,
      sets: [],
      cabdPars: {},
      error: `No SGBD resolved for ${row.sgName}`,
    };
  }

  const handle = await startNcsRuntime({ cabdBasename: row.cabd, sgbd });
  let jobStatus: string | undefined;
  let sets: JobResultSet[] = [];
  const cabdPars: Record<string, string | number> = {};
  try {
    await handle.runCabimain(jobName);
    jobStatus = handle.cabi.lastJobStatus;
    // Public accessor on CabiProvider — returns ReadonlyArray of
    // ReadonlyMap, we copy into mutable Maps for the caller.
    // Tolerate provider builds without the accessor (Vite can cache
    // a pre-accessor dist for the lifetime of a dev session).
    const rawSets = handle.cabi.lastJobSets ?? [];
    sets = rawSets.map((set) => new Map(set));
    // Pull whatever the IPO wrote into CABD pars during the run.
    // This catches jobs like JOB_ERMITTELN that publish their results
    // through `CDHSetCabdPar` rather than EDIABAS result sets.
    const map =
      typeof handle.cabi.allCabdPars === "function"
        ? handle.cabi.allCabdPars()
        : new Map<string, string | number>();
    for (const [k, v] of map) {
      cabdPars[k] = v;
    }
  } catch (err) {
    return {
      ok: false,
      jobName,
      sets,
      cabdPars,
      jobStatus,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await handle.dispose();
  }

  return { ok: true, jobName, sets, cabdPars, jobStatus };
}
