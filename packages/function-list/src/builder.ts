import type { DatenFile, FieldValue, OrderedRow, RawBytes, RowValues } from '@emdzej/ncsx-daten';
import {
  FunctionItem,
  FunctionList,
  FunctionListError,
  FunctionListItem,
  GroupKind,
  KeywordSources,
  MemoryStructure,
  MemoryType,
  Parameter,
  PropertyItem,
  UnoccupiedItem,
} from './types.js';

/**
 * Look up a field on a row by **positional index** in the block's field list. Robust to
 * variations in DATEN field-name conventions across chassis revisions.
 */
function fieldAt(row: OrderedRow, position: number): FieldValue | undefined {
  const def = row.block.fields[position];
  if (!def) return undefined;
  return row.values[def.name];
}

const asNumber = (v: FieldValue | undefined): number | undefined =>
  typeof v === 'number' ? v : undefined;

const asString = (v: FieldValue | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

/**
 * NCSEXPER's "single collection" fields (`{X}` in the format string) are decoded by our
 * parser as `optional` — either `null` (length 0) or the bare scalar value (length 1). For
 * fields that may carry multiple bytes (e.g. INDEX when it's a multi-char string), the
 * parser will instead expose a regular `collection`, which decodes to an array. Normalise
 * both shapes into a number — taking the first element of an array, or `undefined` for
 * `null`.
 */
const asOptionalNumber = (v: FieldValue | undefined): number | undefined => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  return undefined;
};

/** Single-character helper: convert an optional byte to its ASCII character, or `''`. */
const asOptionalChar = (v: FieldValue | undefined): string => {
  const n = asOptionalNumber(v);
  return n === undefined ? '' : String.fromCharCode(n);
};

/**
 * Pull a `Uint8Array` out of a collection-of-bytes (`(B)` in the format string), an
 * optional byte (`{B}`), or a length-prefixed `A` raw-bytes field. Returns an empty array
 * if the field is absent.
 */
function bytesField(v: FieldValue | undefined): Uint8Array {
  if (v === null || v === undefined) return new Uint8Array(0);
  if (typeof v === 'number') return Uint8Array.from([v]);
  if (typeof v === 'string') return Uint8Array.from(v, (c) => c.charCodeAt(0));
  if (Array.isArray(v)) {
    const out = new Uint8Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const e = v[i];
      out[i] = typeof e === 'number' ? e & 0xff : 0;
    }
    return out;
  }
  if (typeof v === 'object' && 'bytes' in v) return v.bytes;
  return new Uint8Array(0);
}

/**
 * Extract an array of raw-byte blobs from an `(A)` collection field (each entry is one
 * length-prefixed A block — used by PARZUWEISUNG_DIR's `Operation` field, which is a list
 * of 5-byte OPERATION entries).
 */
function rawBytesArrayField(v: FieldValue | undefined): Uint8Array[] {
  if (!Array.isArray(v)) return [];
  const out: Uint8Array[] = [];
  for (const entry of v) {
    if (entry && typeof entry === 'object' && 'bytes' in (entry as RawBytes)) {
      out.push((entry as RawBytes).bytes);
    }
  }
  return out;
}

/** Pull a list of strings out of a `(S)` collection field, ignoring non-string entries. */
function stringArrayField(v: FieldValue | undefined): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry === 'string') out.push(entry);
  }
  return out;
}

/** Numeric-collection helper for SGID_CODIERINDEX (which is `(B)` or similar). */
function numberArrayField(v: FieldValue | undefined): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const entry of v) {
    if (typeof entry === 'number') out.push(entry);
  }
  return out;
}

type PartialFunction = FunctionItem;
type PartialUnoccupied = UnoccupiedItem;

const GROUP_KIND: Record<string, GroupKind> = {
  CODIERDATENBLOCK: 'coding',
  HERSTELLERDATENBLOCK: 'manufacturer',
  RESERVIERTDATENBLOCK: 'reserved',
};

const ARRAY_KEYWORD_RE = /^(?<base>.+?)\[(?<index>[0-9]+)\]$/;

interface BuildFunctionListOptions {
  /** Optional FSW/PSW name lookups. When omitted, `*Keyword` fields are left empty. */
  keywords?: KeywordSources;
  /**
   * If true, an `INDIVID_S` row toggles "skip mode" until a `GRUPPE_S` row resets it.
   * NCSDummy's `OptionListReader` honours this; the function-list catalog typically wants
   * both, so this is **off by default**. Turn on to mirror NCSDummy's options-list scoping.
   */
  skipIndividualBlocks?: boolean;
}

/**
 * Build a typed FunctionList from a parsed CABD `.Cxx` `DatenFile`. Walks
 * `daten.rowsInOrder` so the inter-block adjacency required for PSW continuation
 * (`PARZUWEISUNG_PSW2` follows `PARZUWEISUNG_PSW1`) and unoccupied fill (`UNBELEGT2`
 * follows `UNBELEGT1`) is preserved.
 *
 * The traversal mirrors `NcsDummy/Classes/Functions/FunctionListReader.cs:55-250` — see
 * `docs/ncsdummy-analysis.md` §3.1 for the design rationale.
 */
export function buildFunctionList(
  daten: DatenFile,
  options: BuildFunctionListOptions = {},
): FunctionList {
  const fswMap = options.keywords?.fsw;
  const pswMap = options.keywords?.psw;

  const items: FunctionListItem[] = [];
  let lastFunction: PartialFunction | null = null;
  let lastUnoccupied: PartialUnoccupied | null = null;
  let lastParameter: Parameter | null = null;
  let skipIndividual = false;

  let memoryStructure: MemoryStructure = 'BYTE';
  let memoryType: MemoryType = 'FREI';
  let deliveryState: Uint8Array = new Uint8Array(0);
  let codingIndices: number[] = [];
  let hardwareVersions: string[] = [];
  let softwareVersions: string[] = [];

  for (const row of daten.rowsInOrder) {
    const name = row.block.name;

    // Group-scope gating. Only relevant when caller asked us to honour it.
    if (options.skipIndividualBlocks) {
      if (name === 'INDIVID_S') {
        skipIndividual = true;
        continue;
      }
      if (name === 'GRUPPE_S') {
        skipIndividual = false;
        continue;
      }
      if (skipIndividual) continue;
    }

    switch (name) {
      case 'PARZUWEISUNG_FSW': {
        const fsw = asNumber(fieldAt(row, 3));
        const length = asNumber(fieldAt(row, 2));
        const address = asNumber(fieldAt(row, 1));
        const block = asOptionalNumber(fieldAt(row, 0)) ?? 0;
        const mask = bytesField(fieldAt(row, 5));
        if (fsw === undefined || length === undefined || address === undefined) {
          throw new FunctionListError(
            `PARZUWEISUNG_FSW row missing required field(s) (fsw=${fsw}, len=${length}, addr=${address})`,
          );
        }
        const item: PartialFunction = {
          kind: 'function',
          block,
          address,
          length,
          mask,
          fsw,
          fswKeyword: fswMap?.get(fsw) ?? '',
          parameters: [],
        };
        items.push(item);
        lastFunction = item;
        lastParameter = null;
        lastUnoccupied = null;
        break;
      }

      case 'PARZUWEISUNG_PSW1': {
        if (!lastFunction) {
          throw new FunctionListError('PARZUWEISUNG_PSW1 with no preceding PARZUWEISUNG_FSW');
        }
        const psw = asNumber(fieldAt(row, 0));
        const data = bytesField(fieldAt(row, 1));
        if (psw === undefined) {
          throw new FunctionListError('PARZUWEISUNG_PSW1 missing parameter id');
        }
        const param: Parameter = {
          psw,
          pswKeyword: pswMap?.get(psw) ?? '',
          data,
        };
        lastFunction.parameters.push(param);
        lastParameter = param;
        break;
      }

      case 'PARZUWEISUNG_PSW2': {
        if (!lastParameter) {
          throw new FunctionListError('PARZUWEISUNG_PSW2 with no preceding PARZUWEISUNG_PSW1');
        }
        const more = bytesField(fieldAt(row, 0));
        if (more.length > 0) {
          const merged = new Uint8Array(lastParameter.data.length + more.length);
          merged.set(lastParameter.data, 0);
          merged.set(more, lastParameter.data.length);
          lastParameter.data = merged;
        }
        break;
      }

      case 'PARZUWEISUNG_DIR': {
        const fsw = asNumber(fieldAt(row, 3));
        const length = asNumber(fieldAt(row, 2));
        const address = asNumber(fieldAt(row, 1));
        const block = asOptionalNumber(fieldAt(row, 0)) ?? 0;
        const mask = bytesField(fieldAt(row, 5));
        const operations = rawBytesArrayField(fieldAt(row, 6));
        const unit = asOptionalChar(fieldAt(row, 7));
        if (fsw === undefined || length === undefined || address === undefined) {
          throw new FunctionListError(
            `PARZUWEISUNG_DIR row missing required field(s) (fsw=${fsw})`,
          );
        }
        const fswKeyword = fswMap?.get(fsw) ?? '';
        const arrayMatch = ARRAY_KEYWORD_RE.exec(fswKeyword);
        const property: PropertyItem = {
          kind: 'property',
          block,
          address,
          length,
          mask,
          fsw,
          fswKeyword,
          operations,
          unit,
          ...(arrayMatch?.groups?.['base']
            ? {
                arrayName: arrayMatch.groups['base'],
                arrayIndex: Number.parseInt(arrayMatch.groups['index']!, 10),
              }
            : {}),
        };
        items.push(property);
        lastFunction = null;
        lastParameter = null;
        lastUnoccupied = null;
        break;
      }

      case 'UNBELEGT1': {
        const length = asNumber(fieldAt(row, 2));
        const address = asNumber(fieldAt(row, 1));
        const block = asOptionalNumber(fieldAt(row, 0)) ?? 0;
        const mask = bytesField(fieldAt(row, 4));
        if (length === undefined || address === undefined) {
          throw new FunctionListError('UNBELEGT1 row missing required field(s)');
        }
        const item: PartialUnoccupied = {
          kind: 'unoccupied',
          block,
          address,
          length,
          mask,
          fillBytes: new Uint8Array(0),
        };
        items.push(item);
        lastUnoccupied = item;
        lastFunction = null;
        lastParameter = null;
        break;
      }

      case 'UNBELEGT2': {
        if (!lastUnoccupied) break; // tolerate stray UNBELEGT2 — same as NCSDummy's silent ignore
        const values = bytesField(fieldAt(row, 0));
        if (values.length === 0) break;
        // NCSDummy tiles the values when they're shorter than the unoccupied length.
        if (values.length === lastUnoccupied.length) {
          lastUnoccupied.fillBytes = values;
        } else {
          const fill = new Uint8Array(lastUnoccupied.length);
          for (let i = 0; i < fill.length; i++) fill[i] = values[i % values.length]!;
          lastUnoccupied.fillBytes = fill;
        }
        break;
      }

      case 'CODIERDATENBLOCK':
      case 'HERSTELLERDATENBLOCK':
      case 'RESERVIERTDATENBLOCK': {
        const length = asNumber(fieldAt(row, 2)) ?? 0;
        const address = asNumber(fieldAt(row, 1)) ?? 0;
        const block = asOptionalNumber(fieldAt(row, 0)) ?? 0;
        const description = asString(fieldAt(row, 3)) ?? '';
        items.push({
          kind: 'group',
          groupKind: GROUP_KIND[name]!,
          block,
          address,
          length,
          description,
        });
        lastFunction = null;
        lastParameter = null;
        lastUnoccupied = null;
        break;
      }

      case 'SPEICHERORG': {
        const structure = asString(fieldAt(row, 0));
        const type = asString(fieldAt(row, 1));
        if (structure === 'BYTE' || structure === 'WORDMSB' || structure === 'WORDLSB') {
          memoryStructure = structure;
        } else if (structure !== undefined && structure !== '') {
          throw new FunctionListError(`Unsupported memory structure "${structure}"`);
        }
        if (type === 'FREI' || type === 'BLOCK') {
          memoryType = type;
        } else if (type !== undefined && type !== '') {
          throw new FunctionListError(`Unsupported memory type "${type}"`);
        }
        break;
      }

      case 'ANLIEFERZUSTAND': {
        deliveryState = bytesField(fieldAt(row, 0));
        break;
      }

      case 'SGID_CODIERINDEX': {
        codingIndices = collectScalarPlusArray(row.values);
        break;
      }

      case 'SGID_HARDWARENUMMER': {
        hardwareVersions = collectStringPlusArray(row.values);
        break;
      }

      case 'SGID_SWNUMMER': {
        softwareVersions = collectStringPlusArray(row.values);
        break;
      }

      default:
        // Unknown block — ignore. The catalog only cares about the well-known ones above.
        break;
    }
  }

  return {
    items,
    memoryStructure,
    memoryType,
    deliveryState,
    codingIndices,
    hardwareVersions,
    softwareVersions,
  };
}

/**
 * SGID_CODIERINDEX is declared as one scalar followed by an optional list (a "non-empty-list"
 * in our format-string vocab). Flatten both halves into a plain number array regardless of
 * how the parser surfaced them.
 */
function collectScalarPlusArray(row: RowValues): number[] {
  const out: number[] = [];
  for (const value of Object.values(row)) {
    if (typeof value === 'number') {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'number') out.push(entry);
      }
    }
  }
  return out;
}

function collectStringPlusArray(row: RowValues): string[] {
  const out: string[] = [];
  for (const value of Object.values(row)) {
    if (typeof value === 'string') {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') out.push(entry);
      }
    }
  }
  return out;
}

// Re-export to keep `import { stringArrayField, numberArrayField } from './builder.js'`
// working if any future helper needs them; otherwise tree-shaken away.
export { stringArrayField, numberArrayField, bytesField, rawBytesArrayField };
