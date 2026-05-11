import type { Chassis } from '@emdzej/ncsx-chassis';
import type { Block, RawBytes, RowValues } from '@emdzej/ncsx-daten';
import type { AswSet } from '@emdzej/ncsx-fa-asw';
import { evalAuftragsausdruck, PredicateError } from '@emdzej/ncsx-predicate';
import type { SelectEcusOptions, SelectedSg, SelectionSource } from './types.js';

export type { SelectEcusOptions, SelectedSg, SelectionSource, EcuSelector } from './types.js';

const SOURCE_ORDER: ReadonlyArray<{ block: string; source: SelectionSource }> = [
  { block: 'SGAUSWAHL_VMSGBD', source: 'VMSGBD' },
  { block: 'SGAUSWAHL_SGBD', source: 'SGBD' },
  { block: 'SGAUSWAHL_VM', source: 'VM' },
];

const isRawBytes = (v: unknown): v is RawBytes =>
  typeof v === 'object' && v !== null && 'bytes' in v;

const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const asIndex = (v: unknown): number | null => (typeof v === 'number' ? v : null);

const findBlock = (chassis: Chassis, name: string): Block | undefined =>
  chassis.sget.blocks.find((b) => b.name === name);

/**
 * Materialise one SGAUSWAHL_* row into a {@link SelectedSg}, given the source block.
 */
function toSelected(row: RowValues, source: SelectionSource): SelectedSg | undefined {
  const sgName = asString(row.SGNAME);
  if (!sgName) return undefined;
  return {
    sgName,
    cbd: asString(row.CBD),
    cabd: source === 'VM' ? undefined : asString(row.CABD),
    sgbd: source === 'VM' ? undefined : asString(row.SGBD),
    umrsg: asString(row.UMRSG),
    vmg: source === 'SGBD' ? undefined : asString(row.VMG),
    index: asIndex(row.INDEX),
    source,
  };
}

/**
 * Walk SGAUSWAHL_VMSGBD → SGAUSWAHL_SGBD → SGAUSWAHL_VM in `<BR>SGET.000` and return rows
 * whose `AUFTRAGSAUSDRUCK` predicate evaluates to `true` against `asw`.
 *
 * Mirrors NCSEXPER's `coapiScanAllSgFromBr` walk order (see
 * [`docs/ecu-selection.md` §3.4](../../docs/ecu-selection.md#34-step-4--sget-driven-enumeration-the-matcher)).
 */
export function selectEcus(
  chassis: Chassis,
  asw: AswSet,
  options: SelectEcusOptions = {},
): SelectedSg[] {
  const { dedupeBySgName = true, maxPredicateLength = 100, onWarning } = options;
  const warn = (msg: string): void => {
    if (onWarning) onWarning(msg);
  };

  const seen = new Set<string>();
  const out: SelectedSg[] = [];

  for (const { block: blockName, source } of SOURCE_ORDER) {
    const block = findBlock(chassis, blockName);
    if (!block) continue;

    for (const row of block.rows) {
      const sgName = asString(row.SGNAME);
      if (!sgName) continue;
      if (dedupeBySgName && seen.has(sgName)) continue;

      const predicate = row.AUFTRAGSAUSDRUCK;
      let predicateBytes: Uint8Array;
      if (isRawBytes(predicate)) {
        predicateBytes = predicate.bytes;
      } else if (predicate === null || predicate === undefined) {
        predicateBytes = new Uint8Array();
      } else {
        warn(`${blockName} row "${sgName}": AUFTRAGSAUSDRUCK has unexpected type, skipping`);
        continue;
      }

      if (predicateBytes.length > maxPredicateLength) {
        warn(
          `${blockName} row "${sgName}": AUFTRAGSAUSDRUCK length ${predicateBytes.length} exceeds limit ${maxPredicateLength}, skipping`,
        );
        continue;
      }

      let matches: boolean;
      try {
        matches = evalAuftragsausdruck(predicateBytes, asw);
      } catch (err) {
        const msg = err instanceof PredicateError ? err.message : String(err);
        warn(`${blockName} row "${sgName}": predicate evaluation failed (${msg}), skipping`);
        continue;
      }

      if (!matches) continue;

      const selected = toSelected(row, source);
      if (!selected) continue;
      out.push(selected);
      if (dedupeBySgName) seen.add(sgName);
    }
  }

  return out;
}
