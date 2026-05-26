/**
 * Bridge from `.ncsxpatch.yaml`'s `custom_psws:` blocks to the
 * `customPsws` option `@emdzej/ncsx-function-list`'s `buildFunctionList`
 * accepts.
 *
 * Patches are module-scoped, the function-list builder runs once per
 * module. Callers ask for "the custom PSWs for module X" — the
 * function returns the entries flattened across every modules-block
 * with `module: X` (a single patch usually has one but the schema
 * permits multiple).
 *
 * Hex parsing is forgiving: `"5A 3C"`, `"5a3c"`, `"5A:3C"` all yield
 * `Uint8Array([0x5a, 0x3c])`. The schema's regex already constrained
 * the input to `[0-9A-Fa-f\s]+`; the parser here strips whitespace +
 * pairs the hex digits.
 */

import type { CustomPswOverlayEntry } from '@emdzej/ncsx-function-list';
import type { CustomPsw, PatchFile } from './schema.js';

/**
 * Extract every module's `custom_psws` block, indexed by module short
 * name. Returns an empty `Map` if no module declares any.
 *
 * Use the result by indexing with the loaded module's short name and
 * passing the array to `buildFunctionList({ customPsws: … })`.
 */
export function extractCustomPsws(patch: PatchFile): Map<string, CustomPswOverlayEntry[]> {
  const out = new Map<string, CustomPswOverlayEntry[]>();
  for (const mod of patch.modules) {
    if (!mod.custom_psws || mod.custom_psws.length === 0) continue;
    const entries = mod.custom_psws.map(toOverlayEntry);
    const existing = out.get(mod.module);
    if (existing) {
      existing.push(...entries);
    } else {
      out.set(mod.module, entries);
    }
  }
  return out;
}

/**
 * Convert a single `CustomPsw` (the schema shape, with hex `data`
 * string) to the binary `CustomPswOverlayEntry` shape the function-
 * list builder expects.
 */
export function toOverlayEntry(psw: CustomPsw): CustomPswOverlayEntry {
  return {
    fswKeyword: psw.fsw,
    pswKeyword: psw.keyword,
    data: parseHexBytes(psw.data),
  };
}

/** Permissive hex-string → byte array. Whitespace and `:` separators dropped. */
export function parseHexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[\s:]+/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error(`hex string has an odd digit count: "${hex}"`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = clean.slice(i * 2, i * 2 + 2);
    const parsed = Number.parseInt(byte, 16);
    if (!Number.isFinite(parsed)) {
      throw new Error(`bad hex byte "${byte}" in "${hex}"`);
    }
    out[i] = parsed;
  }
  return out;
}
