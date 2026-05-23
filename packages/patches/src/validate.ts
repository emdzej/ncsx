/**
 * Validate a patch entry against a loaded FunctionList and produce the
 * `targets` map (FSW id → PSW id) the FunctionTree can stage as edits.
 *
 * Mirrors the resolution logic in `apps/web/src/lib/fsw-psw-trc.ts`'s
 * `parseFswPswMan` — same FSW/PSW keyword lookup, same numeric
 * `FSW_<id>` / `PSW_<id>` fallback. Pulled into the package so CLI
 * tooling can reuse it later without depending on the web app.
 */

import type { FunctionItem, FunctionList } from '@emdzej/ncsx-function-list';
import type { ModulePatch, PatchFile } from './schema.js';

export interface ResolvedEdits {
  /** FSW id → PSW id, ready to merge into FunctionTree's `targets`. */
  targets: Record<number, number>;
  /** Resolution failures the caller should surface (unknown FSW, unknown PSW, etc.). */
  warnings: string[];
}

export interface RequireCurrentResult {
  /** True if every `require_current` assertion held. Trivially true if no assertions. */
  matched: boolean;
  /** One human-readable line per mismatch. */
  mismatches: string[];
}

export interface CompatibilityResult {
  /** Soft warnings (chassis mismatch, coding-index mismatch, missing FSW, missing PSW). */
  warnings: string[];
  /** Resolved edits — the subset of `patch.edits` that maps onto the loaded CABD. */
  resolved: ResolvedEdits;
}

/** Index helpers so we can resolve FSW/PSW by either keyword or numeric fallback. */
interface FnIndex {
  byKeyword: Map<string, FunctionItem>;
  byFsw: Map<number, FunctionItem>;
}

function buildFnIndex(list: FunctionList): FnIndex {
  const byKeyword = new Map<string, FunctionItem>();
  const byFsw = new Map<number, FunctionItem>();
  for (const it of list.items) {
    if (it.kind !== 'function') continue;
    if (it.fswKeyword) byKeyword.set(it.fswKeyword, it);
    byFsw.set(it.fsw, it);
  }
  return { byKeyword, byFsw };
}

function resolveFn(idx: FnIndex, token: string): FunctionItem | undefined {
  const hit = idx.byKeyword.get(token);
  if (hit) return hit;
  if (token.startsWith('FSW_')) {
    const n = Number(token.slice(4));
    if (Number.isFinite(n)) return idx.byFsw.get(n);
  }
  return undefined;
}

function resolvePsw(fn: FunctionItem, token: string) {
  const byKw = fn.parameters.find((p) => p.pswKeyword === token);
  if (byKw) return byKw;
  if (token.startsWith('PSW_')) {
    const n = Number(token.slice(4));
    if (Number.isFinite(n)) return fn.parameters.find((p) => p.psw === n);
  }
  return undefined;
}

/**
 * Resolve `module.edits` against `list`. Unresolved entries become warnings;
 * the resolved subset is returned in `targets`.
 *
 * Coding-index advisory check is included here too — if `module.coding_indexes`
 * is non-empty and `currentCodingIndex` is provided, a mismatch surfaces as a
 * warning. Empty/missing `coding_indexes` is treated as "any".
 */
export function resolveModulePatch(
  modulePatch: ModulePatch,
  list: FunctionList,
  currentCodingIndex?: string,
): CompatibilityResult {
  const warnings: string[] = [];
  const targets: Record<number, number> = {};
  const idx = buildFnIndex(list);

  if (
    modulePatch.coding_indexes?.length &&
    currentCodingIndex &&
    !modulePatch.coding_indexes.includes(currentCodingIndex)
  ) {
    warnings.push(
      `Patch declares coding indexes [${modulePatch.coding_indexes.join(', ')}] but current is ${currentCodingIndex} — applying anyway, FSW/PSW lookup will catch hard failures.`,
    );
  }

  for (const [fswToken, pswToken] of Object.entries(modulePatch.edits)) {
    const fn = resolveFn(idx, fswToken);
    if (!fn) {
      warnings.push(`Unknown FSW "${fswToken}" — skipped.`);
      continue;
    }
    const psw = resolvePsw(fn, pswToken);
    if (!psw) {
      warnings.push(`FSW "${fswToken}" has no PSW "${pswToken}" — skipped.`);
      continue;
    }
    targets[fn.fsw] = psw.psw;
  }

  return { warnings, resolved: { targets, warnings: [] } };
}

/**
 * Verify `module.require_current` against a netto buffer.
 *
 * Returns `matched: true` if every assertion holds OR there are no assertions.
 * The caller decides what to do when assertions fail — typically refuse the
 * apply unless the user opts in.
 */
export function checkRequireCurrent(
  modulePatch: ModulePatch,
  list: FunctionList,
  netto: Uint8Array,
  decodeCurrentPsw: (item: FunctionItem, netto: Uint8Array) => { psw: number; pswKeyword: string } | null,
): RequireCurrentResult {
  const assertions = modulePatch.require_current;
  if (!assertions || Object.keys(assertions).length === 0) {
    return { matched: true, mismatches: [] };
  }
  const idx = buildFnIndex(list);
  const mismatches: string[] = [];
  for (const [fswToken, expectedPswToken] of Object.entries(assertions)) {
    const fn = resolveFn(idx, fswToken);
    if (!fn) {
      mismatches.push(`require_current: unknown FSW "${fswToken}"`);
      continue;
    }
    const current = decodeCurrentPsw(fn, netto);
    const currentKw = current?.pswKeyword || (current ? `PSW_${current.psw}` : '(none)');
    const expectedPsw = resolvePsw(fn, expectedPswToken);
    if (!expectedPsw) {
      mismatches.push(
        `require_current: FSW "${fswToken}" has no PSW "${expectedPswToken}"`,
      );
      continue;
    }
    if (current?.psw !== expectedPsw.psw) {
      mismatches.push(
        `require_current: ${fswToken} is ${currentKw}, expected ${expectedPswToken}`,
      );
    }
  }
  return { matched: mismatches.length === 0, mismatches };
}

/**
 * Pick the module entries in a patch that apply to the current SG.
 *
 * Match is done on the module short name (`module.module` ===
 * `currentModule`) — case-insensitive to be friendly to hand-written
 * patches that say "Lcm" vs "LCM".
 */
export function modulesForCurrent(
  patch: PatchFile,
  currentModule: string,
): ModulePatch[] {
  const want = currentModule.toLowerCase();
  return patch.modules.filter((m) => m.module.toLowerCase() === want);
}
