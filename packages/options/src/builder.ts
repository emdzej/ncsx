import type { DatenFile, FieldValue, OrderedRow, RawBytes } from '@emdzej/ncsx-daten';
import {
  OptionFunction,
  OptionList,
  OptionListError,
  OptionParameter,
} from './types.js';

function fieldAt(row: OrderedRow, position: number): FieldValue | undefined {
  const def = row.block.fields[position];
  if (!def) return undefined;
  return row.values[def.name];
}

const asNumber = (v: FieldValue | undefined): number | undefined =>
  typeof v === 'number' ? v : undefined;

/** Pull bytes from a length-prefixed `A` (RawBytes) field — used by AUFTRAGSAUSDRUCK rows. */
function rawBytesField(v: FieldValue | undefined): Uint8Array | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'bytes' in (v as RawBytes)) {
    return (v as RawBytes).bytes;
  }
  return undefined;
}

interface BuildOptionListOptions {
  /**
   * If `true` (default), only rows inside `GRUPPE` scope are considered — `INDIVID`
   * scope is ignored. Matches NCSDummy's `OptionListReader` behaviour: individual-mode
   * coding (per-key / per-VIN) is not part of the order-options model.
   */
  groupScopeOnly?: boolean;
}

/**
 * Build an `OptionList` from a CVT DATEN file by pairing `AUFTRAGSAUSDRUCK` predicate
 * rows with the immediately-following `FSW_PSW` rows.
 *
 * The pairing is *strictly* by document order — same as NCSDummy. If no AUFTRAGSAUSDRUCK
 * precedes a given FSW_PSW row, we still emit the (FSW, PSW) entry with an empty
 * predicate (meaning "always applicable"). When multiple AUFTRAGSAUSDRUCK fragments are
 * accumulated for the same `(FSW, PSW)` pair, they're joined with an ASCII comma byte.
 *
 * Block-name nomenclature note: NCSDummy's `OptionListReader.cs` `is` checks
 * use the suffixed C# class names (`GRUPPE_S`, `INDIVID_S`, `AUFTRAGSAUSDRUCK_A`,
 * `FSW_PSW_WW`) but those are NCSDummy's parser-internal type identifiers — the
 * actual on-disk DATEN block strings are the unsuffixed forms used here. Verified
 * empirically across E36/E39/E46/E53/E60/E89 CVT files (all use the unsuffixed
 * names; no shipping CVT uses the `_S`/`_A`/`_WW` forms).
 *
 * See `NcsDummy/Classes/Options/OptionListReader.cs:24-85` and
 * `docs/ncsdummy-analysis.md` §3.3 for the design rationale.
 */
export function buildOptionList(
  daten: DatenFile,
  options: BuildOptionListOptions = {},
): OptionList {
  const groupScopeOnly = options.groupScopeOnly ?? true;

  /** Last AUFTRAGSAUSDRUCK fragment seen, awaiting an FSW_PSW partner. */
  let pendingPredicate: Uint8Array | undefined;
  /** When true (inside INDIVID), skip everything until next GRUPPE. */
  let inIndividual = false;

  /** Per-FSW accumulator, preserving insertion order. */
  const byFsw = new Map<number, OptionFunction>();
  const order: number[] = [];

  /** Pair-level state: most recent `(fsw, psw)` we've appended to. */
  let lastParam: OptionParameter | null = null;

  for (const row of daten.rowsInOrder) {
    switch (row.block.name) {
      case 'GRUPPE':
        inIndividual = false;
        break;
      case 'INDIVID':
        inIndividual = true;
        break;
      case 'AUFTRAGSAUSDRUCK': {
        if (groupScopeOnly && inIndividual) break;
        pendingPredicate = rawBytesField(fieldAt(row, 0));
        break;
      }
      case 'FSW_PSW': {
        if (groupScopeOnly && inIndividual) break;
        const fsw = asNumber(fieldAt(row, 0));
        const psw = asNumber(fieldAt(row, 1));
        if (fsw === undefined || psw === undefined) {
          throw new OptionListError(
            `FSW_PSW row missing field(s) (fsw=${fsw}, psw=${psw})`,
          );
        }
        const fragment = pendingPredicate ?? new Uint8Array(0);
        pendingPredicate = undefined;
        let func = byFsw.get(fsw);
        if (!func) {
          func = { fsw, parameters: [] };
          byFsw.set(fsw, func);
          order.push(fsw);
        }
        const existing = func.parameters.find((p) => p.psw === psw);
        if (existing) {
          // Same (fsw, psw) seen before — comma-join the fragments to match NCSDummy.
          if (fragment.length > 0) {
            const merged = new Uint8Array(existing.predicate.length + 1 + fragment.length);
            merged.set(existing.predicate, 0);
            merged[existing.predicate.length] = 0x2c; // ','
            merged.set(fragment, existing.predicate.length + 1);
            existing.predicate = merged;
          }
          lastParam = existing;
        } else {
          const param: OptionParameter = { psw, predicate: fragment };
          func.parameters.push(param);
          lastParam = param;
        }
        break;
      }
      default:
        break;
    }
  }

  // `lastParam` is only used for symmetry / future extensions; suppress unused-var lint.
  void lastParam;

  return { functions: order.map((id) => byFsw.get(id)!) };
}
