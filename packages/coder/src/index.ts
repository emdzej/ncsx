import { encodeField } from '@emdzej/ncsx-cabd';
import { faToAsw } from '@emdzej/ncsx-fa-asw';
import { selectEcus, type SelectedSg } from '@emdzej/ncsx-ecu-select';
import type { RowValues } from '@emdzej/ncsx-daten';
import {
  computeNettoSize,
  findParzuweisung,
  indexFsws,
  ruleFromRow,
} from './rule.js';
import type {
  AppliedEdit,
  CodingEdit,
  CodingPlan,
  PlanCodingOptions,
} from './types.js';

export type { AppliedEdit, CodingEdit, CodingPlan, PlanCodingOptions } from './types.js';
export {
  buildSlotsFromValues,
  type BuildSlotsOptions,
  type BuildSlotsResult,
  type NettoSlot,
} from './slot-builder.js';

const DEFAULT_JOB = 'SG_CODIEREN';

/**
 * Top-level: orchestrate FA + edits into per-SG coding plans.
 *
 * Pipeline:
 *
 *  1. `faToAsw(fa, { chassis })` — convert the FA string into the ASW bit set.
 *  2. `selectEcus(chassis, asw)` — pick in-scope SGs by walking SGAUSWAHL_*.
 *  3. For each selected SG, group the edits that target it. `edit.sgName` matches
 *     **either** the physical SGAUSWAHL.SGNAME (file basename, e.g. `KMB_E46`) **or**
 *     the logical SGAUSWAHL.UMRSG (e.g. `KMB`). Unpinned edits apply to every SG whose
 *     CABD has a matching FSW id.
 *  4. For each (SG, edits) pair, lazily load the CABD `.Cxx` file via
 *     `chassis.cabd.openModule(sg.sgName, ci)`. The coding-index `ci` comes from the
 *     SGAUSWAHL row's `CBD` column (e.g. `C06` → 0x06) unless the caller pins a
 *     different one via `options.codingIndex`. See `docs/ecu-selection.md` §8 for the
 *     file-resolution rules.
 *  5. Index `PARZUWEISUNG_FSW` rows by FSW id, build a `CabdRule` per edit, encode
 *     the PSW value into the SG's netto buffer.
 *
 * The initial netto buffer comes from `options.initialNetto?.get(<sgName or umrsg>)` if
 * provided (typical NCSEXPER source: a fresh `CODIERDATEN_LESEN` of the ECU). Otherwise
 * we start from a zero-filled buffer sized to fit every PARZUWEISUNG_FSW row's
 * `WORTADR+BYTEADR`.
 *
 * Spec: `docs/coding-flow.md`, `docs/ecu-selection.md` §8.
 */
export async function planCoding(options: PlanCodingOptions): Promise<CodingPlan[]> {
  const {
    chassis,
    fa,
    edits,
    jobName = DEFAULT_JOB,
    initialNetto,
    codingIndex,
    onWarning,
  } = options;
  const warn = (msg: string): void => {
    if (onWarning) onWarning(msg);
  };

  const asw = faToAsw(fa, { chassis });
  const selected = selectEcus(chassis, asw, { onWarning });

  const plans: CodingPlan[] = [];
  for (const sg of selected) {
    const editsForSg = edits.filter((e) => matchesEdit(e, sg));
    if (editsForSg.length === 0) continue;

    const plan = await planSg(sg, editsForSg, {
      chassis,
      jobName,
      initialNetto: pickPerSg(initialNetto, sg),
      codingIndex: pickPerSg(codingIndex, sg),
      warn,
    });
    if (plan) plans.push(plan);
  }
  return plans;
}

/** An edit applies to this SG if it isn't pinned, or its pin matches SGNAME or UMRSG. */
function matchesEdit(edit: CodingEdit, sg: SelectedSg): boolean {
  if (!edit.sgName) return true;
  return edit.sgName === sg.sgName || edit.sgName === sg.umrsg;
}

/** Map lookups by physical SGNAME first, falling back to logical UMRSG. */
function pickPerSg<T>(
  map: ReadonlyMap<string, T> | undefined,
  sg: SelectedSg,
): T | undefined {
  if (!map) return undefined;
  return map.get(sg.sgName) ?? map.get(sg.umrsg);
}

/**
 * Parse the SGAUSWAHL `CBD` column (`"C07"`) into the coding-index byte (`0x07`). Returns
 * `undefined` if the value doesn't follow the `C<hex>` shape.
 */
function ciFromCbd(cbd: string): number | undefined {
  const match = /^C([0-9A-Fa-f]{1,2})$/.exec(cbd);
  if (!match) return undefined;
  const n = Number.parseInt(match[1]!, 16);
  return Number.isFinite(n) ? n : undefined;
}

interface PlanSgContext {
  chassis: PlanCodingOptions['chassis'];
  jobName: string;
  initialNetto?: Uint8Array;
  codingIndex?: number;
  warn: (msg: string) => void;
}

async function planSg(
  sg: SelectedSg,
  edits: readonly CodingEdit[],
  ctx: PlanSgContext,
): Promise<CodingPlan | undefined> {
  const { chassis, jobName, initialNetto, codingIndex, warn } = ctx;
  const sgbdName = sg.sgbd ?? '';
  const cabdName = sg.cabd ?? '';

  const ci = codingIndex ?? ciFromCbd(sg.cbd);
  if (ci === undefined) {
    warn(`${sg.sgName}: can't derive coding index (CBD="${sg.cbd}", no override)`);
    return undefined;
  }

  let cabdFile;
  try {
    cabdFile = await chassis.cabd.openModule(sg.sgName, ci);
  } catch (err) {
    warn(
      `${sg.sgName}.C${ci.toString(16).padStart(2, '0').toUpperCase()}: cabd load failed (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return undefined;
  }

  const block = findParzuweisung(cabdFile);
  if (!block) {
    warn(`${sg.sgName}: CABD has no PARZUWEISUNG_FSW block`);
    return undefined;
  }
  const fswIndex = indexFsws(block);

  const minSize = computeNettoSize(block);
  const netto =
    initialNetto && initialNetto.length >= minSize
      ? Uint8Array.from(initialNetto)
      : padTo(initialNetto, minSize);

  const applied: AppliedEdit[] = [];
  const skipped: CodingPlan['skipped'] = [];

  for (const edit of edits) {
    const rows = fswIndex.get(edit.fsw);
    if (!rows) {
      skipped.push({
        edit,
        reason: `FSW 0x${edit.fsw.toString(16)} not in CABD ${sg.sgName}`,
      });
      continue;
    }
    const row = pickRow(rows, edit);
    if (!row) {
      skipped.push({
        edit,
        reason: `no PARZUWEISUNG_FSW row for FSW 0x${edit.fsw.toString(16)} matching index/blocknr`,
      });
      continue;
    }
    const rule = ruleFromRow(row);
    if (!rule) {
      skipped.push({
        edit,
        reason: `PARZUWEISUNG_FSW row for FSW 0x${edit.fsw.toString(16)} is malformed`,
      });
      continue;
    }
    try {
      encodeField(rule, edit.psw, netto);
      applied.push({ ...edit, rule });
    } catch (err) {
      skipped.push({
        edit,
        reason: `encodeField failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    sgName: sg.sgName,
    umrsg: sg.umrsg,
    sgbd: sgbdName,
    cabd: cabdName,
    cbd: `C${ci.toString(16).toUpperCase().padStart(2, '0')}`,
    jobName,
    netto,
    applied,
    skipped,
    source: sg.source,
  };
}

function pickRow(rows: RowValues[], edit: CodingEdit): RowValues | undefined {
  for (const row of rows) {
    if (edit.index !== undefined && row.INDEX !== edit.index) continue;
    if (edit.blocknr !== undefined && row.BLOCKNR !== edit.blocknr) continue;
    return row;
  }
  return undefined;
}

function padTo(src: Uint8Array | undefined, minSize: number): Uint8Array {
  const out = new Uint8Array(Math.max(minSize, src?.length ?? 0));
  if (src) out.set(src);
  return out;
}
