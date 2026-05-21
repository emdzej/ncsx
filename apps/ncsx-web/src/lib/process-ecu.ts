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

import { buildFunctionList, type FunctionList } from "@emdzej/ncsx-function-list";
import type { Chassis } from "@emdzej/ncsx-chassis";
import type { SgfamRow } from "@emdzej/ncsx-text-tables";
import { app } from "./state.svelte";
import { startNcsRuntime } from "./runtime.svelte";

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
  app.view = "view-module";

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
 * Walk the FunctionList and emit one slot per coded byte address.
 * Deduplicated — overlapping items share a single slot. Sorted by
 * address so CDHGetApiJobData can find contiguous runs.
 */
function flattenSlots(list: FunctionList): Array<{ addr: number }> {
  const addrs = new Set<number>();
  for (const item of list.items) {
    if (item.kind === "group") continue;
    for (let off = 0; off < item.length; off++) {
      addrs.add(item.address + off);
    }
  }
  return [...addrs].sort((a, b) => a - b).map((addr) => ({ addr }));
}
