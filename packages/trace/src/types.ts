import type { GroupKind, MemoryStructure } from '@emdzej/ncsx-function-list';

/**
 * One PSW choice in a function's overlay. Mirror of `FunctionList`'s Parameter, plus a
 * `selected` flag that the trace reader / UI toggles.
 */
export interface TraceOverlayParameter {
  psw: number;
  pswKeyword: string;
  data: Uint8Array;
  /** True when this PSW is "checked" — written out when serialising back to TRC/MAN. */
  selected: boolean;
}

interface TraceOverlayMaskedBase {
  block: number;
  address: number;
  length: number;
  mask: Uint8Array;
}

export interface TraceOverlayFunction extends TraceOverlayMaskedBase {
  kind: 'function';
  fsw: number;
  fswKeyword: string;
  parameters: TraceOverlayParameter[];
  /**
   * Set by the Nettodata reader when the bytes at `(block, address, length)` under `mask`
   * don't match any declared PSW. The UI surfaces this as a "Custom" parameter.
   */
  custom: Uint8Array | null;
}

export interface TraceOverlayProperty extends TraceOverlayMaskedBase {
  kind: 'property';
  fsw: number;
  fswKeyword: string;
  operations: Uint8Array[];
  unit: string;
  arrayName?: string;
  arrayIndex?: number;
  /**
   * Decoded byte payload for this property when a trace has been loaded. `null` means "no
   * trace loaded" (default state). For property serialisation, this is the canonical
   * source: `data !== null` ⇒ write into the nettodata buffer.
   */
  data: Uint8Array | null;
}

export interface TraceOverlayUnoccupied extends TraceOverlayMaskedBase {
  kind: 'unoccupied';
  fillBytes: Uint8Array;
  /** Trace-supplied bytes; `null` when no trace is loaded. */
  data: Uint8Array | null;
}

export interface TraceOverlayGroup {
  kind: 'group';
  groupKind: GroupKind;
  block: number;
  address: number;
  length: number;
  description: string;
}

/**
 * An FSW keyword that appeared in an FSW/PSW trace but is not present in the catalog. Kept
 * around so the UI can surface "this trace references unknown function X" without losing
 * the user's intent.
 */
export interface TraceOverlayUnresolved {
  kind: 'unresolved';
  fswKeyword: string;
  parameterKeywords: string[];
}

export type TraceOverlayItem =
  | TraceOverlayFunction
  | TraceOverlayProperty
  | TraceOverlayUnoccupied
  | TraceOverlayGroup
  | TraceOverlayUnresolved;

export interface TraceOverlay {
  memoryStructure: MemoryStructure;
  /** Convenience: `true` for `WORDMSB` / `WORDLSB`. */
  isWord: boolean;
  items: TraceOverlayItem[];
}

/** Detected file format. */
export type TraceFormat = 'fsw-psw' | 'nettodata';

export class TraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TraceError';
  }
}
