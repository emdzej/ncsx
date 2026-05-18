import type { FunctionList, FunctionListItem } from '@emdzej/ncsx-function-list';
import type {
  TraceOverlay,
  TraceOverlayItem,
  TraceOverlayParameter,
} from './types.js';

/**
 * Lift a `FunctionList` (the static DATEN-derived catalog) into a `TraceOverlay` — the
 * working model that carries "checked" state and custom-byte overrides. With no trace
 * loaded, every parameter starts `selected: false` and every property/unoccupied has
 * `data: null`.
 */
export function buildTraceOverlay(list: FunctionList): TraceOverlay {
  const items: TraceOverlayItem[] = list.items.map(cloneItem);
  return {
    memoryStructure: list.memoryStructure,
    isWord: list.memoryStructure !== 'BYTE',
    items,
  };
}

function cloneItem(item: FunctionListItem): TraceOverlayItem {
  switch (item.kind) {
    case 'function': {
      const parameters: TraceOverlayParameter[] = item.parameters.map((p) => ({
        psw: p.psw,
        pswKeyword: p.pswKeyword,
        data: copy(p.data),
        selected: false,
      }));
      return {
        kind: 'function',
        block: item.block,
        address: item.address,
        length: item.length,
        mask: copy(item.mask),
        fsw: item.fsw,
        fswKeyword: item.fswKeyword,
        parameters,
        custom: null,
      };
    }
    case 'property':
      return {
        kind: 'property',
        block: item.block,
        address: item.address,
        length: item.length,
        mask: copy(item.mask),
        fsw: item.fsw,
        fswKeyword: item.fswKeyword,
        operations: item.operations.map(copy),
        unit: item.unit,
        ...(item.arrayName !== undefined ? { arrayName: item.arrayName } : {}),
        ...(item.arrayIndex !== undefined ? { arrayIndex: item.arrayIndex } : {}),
        data: null,
      };
    case 'unoccupied':
      return {
        kind: 'unoccupied',
        block: item.block,
        address: item.address,
        length: item.length,
        mask: copy(item.mask),
        fillBytes: copy(item.fillBytes),
        data: null,
      };
    case 'group':
      return {
        kind: 'group',
        groupKind: item.groupKind,
        block: item.block,
        address: item.address,
        length: item.length,
        description: item.description,
      };
  }
}

function copy(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}
