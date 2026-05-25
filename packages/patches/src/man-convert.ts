/**
 * Conversion helpers between NCSEXPER's `.MAN` selection lists and
 * the `.ncsxpatch.yaml` schema.
 *
 * The MAN format models each FSW as zero-or-more PSWs (a parameter
 * list). The v1 patch schema models each FSW as exactly one PSW
 * (`edits: Record<FSW, PSW>`), so the MAN → patch conversion is
 * lossy when a FSW has multiple PSWs. We surface the dropped values
 * via `warnings` so callers can render them; we never throw on the
 * collapse.
 *
 * The reverse direction (patch → MAN selections) is lossless because
 * a patch's single PSW becomes a `[psw]` list of length 1.
 *
 * Selections are passed structurally — same shape as
 * `@emdzej/ncsx-trace`'s `FswPswSelection` — so the trace package's
 * `parseFswPswTrace` / `writeFswPswTrace` output and input both flow
 * through these helpers without a cross-package import on this side.
 */

import type { ModulePatch, PatchFile } from './schema.js';

/**
 * One FSW group as it appears in a `.MAN` file: the function keyword
 * and the list of PSW keywords (possibly empty) selected under it.
 *
 * Structurally compatible with `@emdzej/ncsx-trace`'s `FswPswSelection`.
 */
export interface ManSelection {
  fswKeyword: string;
  pswKeywords: string[];
}

export interface PatchFromManOptions {
  /** Required — chassis code (E46, E60, …); MAN files don't carry this. */
  chassis: string;
  /** Required — module short name (LCM, GM5, KOMBI, …); MAN files don't carry this. */
  module: string;
  /** Short title shown in pickers. Defaults to `<module> on <chassis>`. */
  title?: string;
  /** Long-form description. */
  description?: string;
  /** Author identifier. */
  author?: string;
  /** Search/filter tags. */
  keywords?: readonly string[];
  /** Optional per-module description. */
  moduleDescription?: string;
  /** Optional `.Cxx` coding-index hints. */
  codingIndexes?: readonly string[];
}

export type ManConversionWarning =
  | {
      kind: 'multi-psw-flattened';
      fsw: string;
      kept: string;
      dropped: string[];
    }
  | {
      kind: 'empty-psw-skipped';
      fsw: string;
    };

export interface PatchFromManResult {
  patch: PatchFile;
  warnings: ManConversionWarning[];
}

/**
 * Build a single-module `.ncsxpatch.yaml` document from MAN
 * selections. Multi-PSW selections are collapsed to the first PSW;
 * empty-PSW selections are skipped. Both surface as `warnings`.
 *
 * Throws when the resulting `edits` would be empty (the patch
 * schema requires at least one).
 */
export function patchFromManSelections(
  selections: readonly ManSelection[],
  opts: PatchFromManOptions,
): PatchFromManResult {
  const warnings: ManConversionWarning[] = [];
  const edits: Record<string, string> = {};

  for (const sel of selections) {
    if (sel.pswKeywords.length === 0) {
      warnings.push({ kind: 'empty-psw-skipped', fsw: sel.fswKeyword });
      continue;
    }
    edits[sel.fswKeyword] = sel.pswKeywords[0]!;
    if (sel.pswKeywords.length > 1) {
      warnings.push({
        kind: 'multi-psw-flattened',
        fsw: sel.fswKeyword,
        kept: sel.pswKeywords[0]!,
        dropped: sel.pswKeywords.slice(1),
      });
    }
  }

  if (Object.keys(edits).length === 0) {
    throw new Error(
      'patchFromManSelections: no usable FSW/PSW pairs (every selection was empty or filtered)',
    );
  }

  const module: ModulePatch = {
    module: opts.module,
    ...(opts.codingIndexes && opts.codingIndexes.length > 0 && {
      coding_indexes: [...opts.codingIndexes],
    }),
    ...(opts.moduleDescription && { description: opts.moduleDescription }),
    edits,
  };

  const patch: PatchFile = {
    schema: 'ncsx-patch/v1',
    title: opts.title ?? `${opts.module} on ${opts.chassis}`,
    ...(opts.description && { description: opts.description }),
    ...(opts.author && { author: opts.author }),
    ...(opts.keywords && opts.keywords.length > 0 && { keywords: [...opts.keywords] }),
    chassis: opts.chassis,
    modules: [module],
  };

  return { patch, warnings };
}

/**
 * Convert a patch document into per-module MAN selection lists.
 * Returns one `ManSelection[]` per module entry in the patch,
 * keyed by the module's short name.
 *
 * The conversion is lossless: each edit `(fsw, psw)` becomes one
 * `ManSelection { fswKeyword: fsw, pswKeywords: [psw] }`.
 */
export function patchToManSelections(
  patch: PatchFile,
): Map<string, ManSelection[]> {
  const out = new Map<string, ManSelection[]>();
  for (const m of patch.modules) {
    const selections: ManSelection[] = [];
    for (const [fsw, psw] of Object.entries(m.edits)) {
      selections.push({ fswKeyword: fsw, pswKeywords: [psw] });
    }
    out.set(m.module, selections);
  }
  return out;
}
