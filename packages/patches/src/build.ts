/**
 * Build patch entries from staged edits in the host UI.
 *
 * `targetsToEdits` turns the FunctionTree's `Record<fsw_id, psw_id>`
 * back into the patch file's `{ [FSW_KEYWORD]: PSW_KEYWORD }` shape,
 * using the FunctionList for keyword resolution. Unresolved FSW/PSW
 * fall back to the `FSW_<id>` / `PSW_<id>` numeric form so the patch
 * still round-trips on hosts without SWT tables.
 *
 * `mergeModulePatch` slots a new module entry into an existing patch:
 * - If a module with the same `module:` short name already exists,
 *   the caller picks the merge mode (`replace` or `merge`).
 * - `replace` overwrites the block entirely.
 * - `merge` preserves the previous block's keys and adds/overrides
 *   only the keys present in the new block. Metadata fields
 *   (`description`, `coding_indexes`, `require_current`) on the new
 *   block win when set; falling back to the previous block when
 *   unset.
 */

import type { FunctionItem, FunctionList } from '@emdzej/ncsx-function-list';
import type { ModulePatch, PatchFile } from './schema.js';

export function targetsToEdits(
  list: FunctionList,
  targets: Record<number, number>,
): Record<string, string> {
  const fnByFsw = new Map<number, FunctionItem>();
  for (const it of list.items) {
    if (it.kind === 'function') fnByFsw.set(it.fsw, it);
  }
  const edits: Record<string, string> = {};
  for (const [fswStr, pswId] of Object.entries(targets)) {
    const fswNum = Number(fswStr);
    const fn = fnByFsw.get(fswNum);
    if (!fn) continue;
    const param = fn.parameters.find((p) => p.psw === pswId);
    if (!param) continue;
    const fswKw = fn.fswKeyword || `FSW_${fswNum}`;
    const pswKw = param.pswKeyword || `PSW_${pswId}`;
    edits[fswKw] = pswKw;
  }
  return edits;
}

export type MergeMode = 'replace' | 'merge';

/**
 * Merge or replace a module block in an existing patch. Returns a new
 * `PatchFile` — never mutates the input.
 */
export function mergeModulePatch(
  patch: PatchFile,
  next: ModulePatch,
  mode: MergeMode,
): PatchFile {
  const want = next.module.toLowerCase();
  const idx = patch.modules.findIndex((m) => m.module.toLowerCase() === want);
  const modules = [...patch.modules];
  if (idx < 0) {
    modules.push(next);
    return { ...patch, modules };
  }
  const prev = modules[idx]!;
  modules[idx] =
    mode === 'replace'
      ? next
      : {
          module: next.module,
          coding_indexes: next.coding_indexes ?? prev.coding_indexes,
          description: next.description ?? prev.description,
          require_current: next.require_current ?? prev.require_current,
          edits: { ...prev.edits, ...next.edits },
        };
  return { ...patch, modules };
}
