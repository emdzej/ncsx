/**
 * Memory layout declared by `SPEICHERORG` in the CABD file. Affects how nettodata addresses
 * are packed and whether the SG codes one byte or one word at a time. See
 * `docs/ncsdummy-analysis.md` §4.
 */
export type MemoryStructure = 'BYTE' | 'WORDMSB' | 'WORDLSB';
export type MemoryType = 'FREI' | 'BLOCK';

/** Group flavour, lifted from the three group-header block names in the DATEN. */
export type GroupKind = 'coding' | 'manufacturer' | 'reserved';

/**
 * One value an FSW can take. The `data` bytes are the **netto values** that get written into
 * the buffer at `(block, address, length)` under the parent FSW's mask. Multiple bytes for
 * multi-byte FSWs; PARZUWEISUNG_PSW2 continuation rows are concatenated here.
 */
export interface Parameter {
  /** PSW id from PARZUWEISUNG_PSW1. */
  psw: number;
  /** Resolved PSW name (e.g. `aktiv`), or `''` if no SWT table was supplied. */
  pswKeyword: string;
  /** Byte values to write at the FSW's slot when this PSW is chosen. */
  data: Uint8Array;
}

interface MaskedItemBase {
  /** Memory "block number" (NCSEXPER's BLOCKNR). Always 0 on classic SGs. */
  block: number;
  /** Byte offset into the netto buffer (`WORTADR`). */
  address: number;
  /** Length in bytes (`BYTEADR` — a count, not a second address). */
  length: number;
  /** Mask bytes, one per byte covered. Length === `length`. */
  mask: Uint8Array;
}

/** A coding function with enumerated PSWs (the common case). */
export interface FunctionItem extends MaskedItemBase {
  kind: 'function';
  /** FSW id (numeric). */
  fsw: number;
  /** Resolved FSW name (e.g. `KEYCARDREADER`), or `''` if no SWT table supplied. */
  fswKeyword: string;
  parameters: Parameter[];
}

/**
 * A coding "property" — no enumerated PSWs, value is computed via OPERATION + EINHEIT.
 * Used for things like VIN, code-index, dates, free-form integers.
 */
export interface PropertyItem extends MaskedItemBase {
  kind: 'property';
  fsw: number;
  fswKeyword: string;
  /**
   * Raw OPERATION list bytes, each entry is `(op_char, u32 LE operand)` (5 bytes).
   * Interpret via `packages/cabd`'s `applyOperationsRead`/`applyOperationsWrite`.
   */
  operations: Uint8Array[];
  /** EINHEIT character ('h', 'A', 'a', 'b', 'd'). */
  unit: string;
  /** If keyword ends in `[N]`, the base name (e.g. `KEY` for `KEY[3]`). */
  arrayName?: string;
  /** Numeric index `N` if keyword was `name[N]`. */
  arrayIndex?: number;
}

/** A byte range the SG doesn't actively code (UNBELEGT1 + optional UNBELEGT2 fill bytes). */
export interface UnoccupiedItem extends MaskedItemBase {
  kind: 'unoccupied';
  /** Default values for this range, or empty if no UNBELEGT2 follows. */
  fillBytes: Uint8Array;
}

/** A UI group header (CODIERDATENBLOCK / HERSTELLERDATENBLOCK / RESERVIERTDATENBLOCK). */
export interface GroupItem {
  kind: 'group';
  groupKind: GroupKind;
  block: number;
  address: number;
  length: number;
  description: string;
}

export type FunctionListItem = FunctionItem | PropertyItem | UnoccupiedItem | GroupItem;

/**
 * The result of `buildFunctionList`. Aggregates the per-item catalog with the SG-wide
 * metadata pulled from singleton DATEN blocks (SPEICHERORG, ANLIEFERZUSTAND, SGID_*).
 */
export interface FunctionList {
  items: FunctionListItem[];
  /** `BYTE` / `WORDMSB` / `WORDLSB` from `SPEICHERORG`; defaults to `BYTE`. */
  memoryStructure: MemoryStructure;
  /** `FREI` / `BLOCK` from `SPEICHERORG`; defaults to `FREI`. */
  memoryType: MemoryType;
  /** Default byte image from `ANLIEFERZUSTAND`; empty if absent. */
  deliveryState: Uint8Array;
  /** Coding indices this DATEN is valid for (from `SGID_CODIERINDEX`). */
  codingIndices: number[];
  /** Hardware version strings (from `SGID_HARDWARENUMMER`). */
  hardwareVersions: string[];
  /** Software version strings (from `SGID_SWNUMMER`). */
  softwareVersions: string[];
}

/**
 * Optional sources for resolving numeric FSW/PSW ids to keywords. Pass the chassis-level
 * SWT tables from `@emdzej/ncsx-chassis` (`chassis.swtFsw`, `chassis.swtPsw`).
 */
export interface KeywordSources {
  /** FSW id → keyword name lookup. */
  fsw?: ReadonlyMap<number, string>;
  /** PSW id → keyword name lookup. */
  psw?: ReadonlyMap<number, string>;
}

/**
 * One custom PSW to merge into the built FunctionList. Each entry registers
 * a new PSW under an existing FSW (matched by keyword); the builder assigns
 * a synthetic id from the `CUSTOM_PSW_ID_BASE` range so factory ids stay
 * untouched.
 *
 * Sourced from `@emdzej/ncsx-patches`' `custom_psws:` block at apply time
 * (see `extractCustomPsws`). Authoring lives in patch files — there is no
 * separate overlay format. See `docs/custom-fsw-psw.md`.
 */
export interface CustomPswOverlayEntry {
  /** Keyword of the FSW this PSW belongs under. Must already exist in the DATEN. */
  fswKeyword: string;
  /** New PSW's keyword. Must be unique within the FSW's parameter list. */
  pswKeyword: string;
  /**
   * Byte values to write at the FSW's slot when this PSW is chosen. Length
   * must equal the parent FSW's `length` byte count.
   */
  data: Uint8Array;
}

/**
 * IDs at or above this value are reserved for custom PSWs. The builder
 * checks every DATEN-sourced PSW id against this ceiling and throws if a
 * factory PSW ever lands in the reserved range — the reservation only
 * holds if BMW respects the same convention by accident.
 *
 * Empirically observed maximum in real DATEN: ≈ 0x1000-ish. 0xF000 leaves
 * plenty of factory headroom while still giving 4096 custom slots per
 * session.
 */
export const CUSTOM_PSW_ID_BASE = 0xf000;

export class FunctionListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FunctionListError';
  }
}
