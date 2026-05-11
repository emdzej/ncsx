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

const DEFAULT_JOB = 'SG_CODIEREN';

/**
 * Top-level: orchestrate FA + edits into per-SG coding plans.
 *
 * Pipeline:
 *
 *  1. `faToAsw(fa, { chassis })` — convert the FA string into the ASW bit set.
 *  2. `selectEcus(chassis, asw)` — pick in-scope SGs by walking SGAUSWAHL_*.
 *  3. For each selected SG, group the edits that target it:
 *      - if `edit.sgName` is set, only that SG;
 *      - otherwise, all SGs whose CABD has a matching FSW id.
 *  4. For each (SG, edits) pair, lazily load CABD via `chassis.cabd.forSg`, find the
 *     `PARZUWEISUNG_FSW` block, build a {@link CabdRule} per edit, encode the PSW value
 *     into the SG's netto buffer.
 *
 * The initial netto buffer comes from `options.initialNetto?.get(sgName)` if provided
 * (typical NCSEXPER source: a fresh `CODIERDATEN_LESEN` of the ECU). Otherwise we start
 * from a zero-filled buffer sized to fit every PARZUWEISUNG_FSW row's `WORTADR+BYTEADR`.
 *
 * Spec: `docs/coding-flow.md`.
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
    const editsForSg = edits.filter((e) => !e.sgName || e.sgName === sg.sgName);
    if (editsForSg.length === 0) continue;

    const plan = await planSg(sg, editsForSg, {
      chassis,
      jobName,
      initialNetto: initialNetto?.get(sg.sgName),
      codingIndex: codingIndex?.get(sg.sgName),
      warn,
    });
    if (plan) plans.push(plan);
  }
  return plans;
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
  const sgfamRow = chassis.sgfam.get(sg.sgName);
  const cabdName = sg.cabd ?? sgfamRow?.cabd ?? '';
  const sgbdName = sg.sgbd ?? sgfamRow?.sgbd ?? '';
  if (!cabdName) {
    warn(`${sg.sgName}: no CABD module name (not in SGFAM and not in SGET row)`);
    return undefined;
  }

  let cabdFile;
  try {
    cabdFile = await chassis.cabd.forSg(sg.sgName, codingIndex);
  } catch (err) {
    warn(`${sg.sgName}: cabd load failed (${err instanceof Error ? err.message : String(err)})`);
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
      skipped.push({ edit, reason: `FSW 0x${edit.fsw.toString(16)} not in CABD ${cabdName}` });
      continue;
    }
    const row = pickRow(rows, edit);
    if (!row) {
      skipped.push({ edit, reason: `no PARZUWEISUNG_FSW row for FSW 0x${edit.fsw.toString(16)} matching index/blocknr` });
      continue;
    }
    const rule = ruleFromRow(row);
    if (!rule) {
      skipped.push({ edit, reason: `PARZUWEISUNG_FSW row for FSW 0x${edit.fsw.toString(16)} is malformed` });
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
    sgbd: sgbdName,
    cabd: cabdName,
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
