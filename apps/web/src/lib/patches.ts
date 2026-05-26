/**
 * Host glue between the FunctionTree's pending-edits state and the
 * `@emdzej/ncsx-patches` package. Everything UI-flavoured lives here
 * — the package itself stays UI-agnostic.
 *
 * Three operations:
 *
 * - `buildPatchFromCurrent` — snapshot current pending edits + app
 *   state into a `PatchFile` ready to serialize. Used by both
 *   "Save as patch" (write a fresh file) and "Append to patch"
 *   (build the new module block then merge).
 *
 * - `applyPatchToTargets` — given a parsed patch file, resolve the
 *   first matching module block against the loaded FunctionList
 *   and return a `targets` map the FunctionTree can merge. Pairs
 *   with `modulesForCurrent` so callers can pick the right block
 *   when a patch covers multiple modules.
 *
 * - `formatCodingIndex` — small helper that mirrors the `Cxx`
 *   format used by `ModuleList`/`selectedSg`, so the soft
 *   coding-index check works against the user-visible label.
 */

import type { FunctionList } from "@emdzej/ncsx-function-list";
import { buildFunctionList, decodeCurrentPsw } from "@emdzej/ncsx-function-list";
import type { Chassis } from "@emdzej/ncsx-chassis";
import {
  checkRequireCurrent,
  extractCustomPsws,
  mergeModulePatch,
  modulesForCurrent,
  resolveModulePatch,
  serializePatch,
  targetsToEdits,
  type CustomPsw,
  type MergeMode,
  type ModulePatch,
  type PatchFile,
} from "@emdzej/ncsx-patches";

/** `C${hex_upper.padStart(2,'0')}` — same shape `ModuleList` writes into `selectedSg`. */
export function formatCodingIndex(ci: number): string {
  return `C${ci.toString(16).toUpperCase().padStart(2, "0")}`;
}

export interface PatchSeed {
  /** Top-level patch metadata (title is required, the rest are optional). */
  title: string;
  description?: string;
  author?: string;
  keywords?: string[];
  /** When true, the current module's coding index gets pinned in the patch. */
  pinCodingIndex?: boolean;
  /** When true, the current ECU netto is snapshotted into `require_current`. */
  captureRequireCurrent?: boolean;
  /** Optional per-module description (rendered under each module block). */
  moduleDescription?: string;
}

export interface BuildPatchInputs {
  chassisCode: string;
  module: string;
  codingIndex: number;
  functionList: FunctionList;
  targets: Record<number, number>;
  /** Last-read netto — required when `captureRequireCurrent` is true. */
  netto?: Uint8Array | null;
  /**
   * Custom PSW drafts the user authored in this session. Emitted as the
   * module's `custom_psws:` block so a recipient applying the patch
   * registers them into their FunctionList overlay. Empty arrays are
   * omitted (no empty block written). Optional — `undefined` works
   * exactly like `[]`.
   */
  customPsws?: readonly CustomPsw[];
  seed: PatchSeed;
}

/**
 * Build a fresh `PatchFile` from the FunctionTree's current state. The
 * returned object can be serialized straight to YAML (via
 * `serializePatch`) for "Save as patch", or fed into
 * `mergeIntoExistingPatch` for "Append to patch".
 */
export function buildPatchFromCurrent(inputs: BuildPatchInputs): PatchFile {
  const modulePatch = buildModulePatch(inputs);
  return {
    schema: "ncsx-patch/v1",
    title: inputs.seed.title,
    description: inputs.seed.description?.length
      ? inputs.seed.description
      : undefined,
    author: inputs.seed.author?.length ? inputs.seed.author : undefined,
    keywords: inputs.seed.keywords?.length ? inputs.seed.keywords : undefined,
    chassis: inputs.chassisCode,
    modules: [modulePatch],
  };
}

/** Build just the module entry — used when appending into an existing patch. */
export function buildModulePatch(inputs: BuildPatchInputs): ModulePatch {
  const edits = targetsToEdits(inputs.functionList, inputs.targets);
  const out: ModulePatch = {
    module: inputs.module,
    edits,
  };
  if (inputs.customPsws && inputs.customPsws.length > 0) {
    // Schema accepts readonly arrays; convert to mutable for the
    // typed-shape Zod inferred from `.array(...)`.
    out.custom_psws = [...inputs.customPsws];
  }
  if (inputs.seed.pinCodingIndex) {
    out.coding_indexes = [formatCodingIndex(inputs.codingIndex)];
  }
  if (inputs.seed.moduleDescription?.length) {
    out.description = inputs.seed.moduleDescription;
  }
  if (inputs.seed.captureRequireCurrent && inputs.netto) {
    const snapshot = snapshotRequireCurrent(
      inputs.functionList,
      inputs.targets,
      inputs.netto,
    );
    if (Object.keys(snapshot).length > 0) {
      out.require_current = snapshot;
    }
  }
  return out;
}

/**
 * For each FSW the user is editing, record what the ECU **currently**
 * holds (FSW keyword → current PSW keyword). On apply, the recipient
 * can refuse if any of those don't match — protects against applying
 * a patch on top of an already-modified ECU.
 */
function snapshotRequireCurrent(
  list: FunctionList,
  targets: Record<number, number>,
  netto: Uint8Array,
): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const byFsw = new Map<number, (typeof list.items)[number] & { kind: "function" }>();
  for (const it of list.items) {
    if (it.kind === "function") {
      byFsw.set(it.fsw, it);
    }
  }
  for (const fswStr of Object.keys(targets)) {
    const fn = byFsw.get(Number(fswStr));
    if (!fn) continue;
    const current = decodeCurrentPsw(fn, netto);
    if (!current) continue;
    const fswKw = fn.fswKeyword || `FSW_${fn.fsw}`;
    const pswKw = current.pswKeyword || `PSW_${current.psw}`;
    snapshot[fswKw] = pswKw;
  }
  return snapshot;
}

/**
 * Merge `inputs` as a new/updated module block into `existing`. Caller
 * picks the merge mode (`replace` or `merge`) — relevant when the
 * existing patch already has a block for the same module.
 */
export function mergeIntoExistingPatch(
  existing: PatchFile,
  inputs: BuildPatchInputs,
  mode: MergeMode,
): PatchFile {
  const modulePatch = buildModulePatch(inputs);
  return mergeModulePatch(existing, modulePatch, mode);
}

/** Serialise a `PatchFile` to YAML — thin re-export for callers that don't need the package directly. */
export { serializePatch };

export interface ApplyOutcome {
  /** FSW id → PSW id ready to merge into FunctionTree's `targets`. */
  targets: Record<number, number>;
  /** Soft warnings — chassis/CI mismatch, unresolved FSW/PSW. */
  warnings: string[];
  /** `require_current` assertions that failed (empty if patch had none). */
  requireCurrentMismatches: string[];
  /** Which module block in the patch ended up being applied. */
  appliedModule: ModulePatch | null;
}

export interface ApplyInputs {
  patch: PatchFile;
  module: string;
  codingIndex: number;
  chassisCode: string;
  functionList: FunctionList;
  /** Last-read netto. Required for `require_current` enforcement; omit to skip. */
  netto?: Uint8Array | null;
}

/**
 * Resolve the patch's first block matching `module` against the loaded
 * FunctionList, build a `targets` map, and check `require_current`.
 *
 * The function returns warnings but never throws on soft mismatches —
 * the caller decides whether to surface them or refuse the apply.
 */
export function applyPatchToTargets(inputs: ApplyInputs): ApplyOutcome {
  const matching = modulesForCurrent(inputs.patch, inputs.module);
  if (matching.length === 0) {
    return {
      targets: {},
      warnings: [
        `Patch has no entries for module "${inputs.module}" — found: ${
          inputs.patch.modules.map((m) => m.module).join(", ") || "(none)"
        }`,
      ],
      requireCurrentMismatches: [],
      appliedModule: null,
    };
  }
  const block = matching[0]!;
  const warnings: string[] = [];
  if (inputs.patch.chassis.toLowerCase() !== inputs.chassisCode.toLowerCase()) {
    warnings.push(
      `Patch targets chassis ${inputs.patch.chassis}, current chassis is ${inputs.chassisCode} — applying anyway.`,
    );
  }
  const ciLabel = formatCodingIndex(inputs.codingIndex);
  const { resolved, warnings: resolveWarnings } = resolveModulePatch(
    block,
    inputs.functionList,
    ciLabel,
  );
  warnings.push(...resolveWarnings);
  let requireCurrentMismatches: string[] = [];
  if (inputs.netto && block.require_current) {
    const { mismatches } = checkRequireCurrent(
      block,
      inputs.functionList,
      inputs.netto,
      decodeCurrentPsw,
    );
    requireCurrentMismatches = mismatches;
  }
  return {
    targets: resolved.targets,
    warnings,
    requireCurrentMismatches,
    appliedModule: block,
  };
}

export interface RebuildFunctionListInputs {
  chassis: Chassis;
  /** Physical CABD module name (e.g. `KMB_E46`). Drives `cabd.openModule`. */
  physicalModuleName: string;
  /**
   * SG short name (`umrsg`) — the key `custom_psws:` use in the patch. May
   * differ from `physicalModuleName`. Looked up via `extractCustomPsws`.
   */
  umrsg: string;
  codingIndex: number;
  patch: PatchFile;
}

export interface RebuildFunctionListResult {
  list: FunctionList;
  /** Number of custom PSWs the patch contributed to this module. */
  customPswCount: number;
}

/**
 * Rebuild a module's FunctionList with the patch's `custom_psws:` overlay
 * merged in. The result replaces `app.functionList` so the FunctionTree
 * picks the new PSWs up; subsequent `applyPatchToTargets` calls resolve
 * `edits` against the augmented list.
 *
 * Throws on overlay errors — unknown FSW, byte-length mismatch, or PSW
 * keyword collision. Caller catches + surfaces to the user.
 *
 * The CABD re-open is async; existing builds in the app are sync because
 * they happen during `process-ecu.ts` flow. Patch apply isn't a hot path,
 * so the extra await is fine.
 */
export async function rebuildFunctionListWithPatch(
  inputs: RebuildFunctionListInputs,
): Promise<RebuildFunctionListResult> {
  const customPsws = extractCustomPsws(inputs.patch).get(inputs.umrsg) ?? [];
  const list = await rebuildFunctionListCore({
    chassis: inputs.chassis,
    physicalModuleName: inputs.physicalModuleName,
    codingIndex: inputs.codingIndex,
    customPsws,
  });
  return { list, customPswCount: customPsws.length };
}

/**
 * Rebuild a module's FunctionList with an in-session custom-PSW
 * draft merged in. Same shape as `rebuildFunctionListWithPatch` but
 * takes the patch-schema `CustomPsw[]` directly — used by the
 * "+ Add Parameter" UI which mutates a session-scoped draft rather
 * than reading from a parsed patch file.
 *
 * Throws on overlay errors. Caller updates `app.functionList` with
 * the result; Svelte's reactivity propagates to the FunctionTree.
 */
export async function rebuildFunctionListWithDraft(inputs: {
  chassis: Chassis;
  physicalModuleName: string;
  codingIndex: number;
  customPsws: readonly CustomPsw[];
}): Promise<FunctionList> {
  // Wrap the draft into a synthetic single-module patch so the same
  // hex-string → Uint8Array conversion that `extractCustomPsws` does
  // for patches applies here too. Keeps both rebuild paths sharing
  // one data conversion implementation.
  const syntheticPatch: PatchFile = {
    schema: "ncsx-patch/v1",
    title: "(draft)",
    chassis: "(draft)",
    modules: [
      {
        module: "_",
        custom_psws: [...inputs.customPsws],
        edits: { _placeholder: "_" },
      },
    ],
  };
  const overlay = extractCustomPsws(syntheticPatch).get("_") ?? [];
  return rebuildFunctionListCore({
    chassis: inputs.chassis,
    physicalModuleName: inputs.physicalModuleName,
    codingIndex: inputs.codingIndex,
    customPsws: overlay,
  });
}

/** Shared core — both rebuild paths funnel here once the overlay is normalised. */
async function rebuildFunctionListCore(inputs: {
  chassis: Chassis;
  physicalModuleName: string;
  codingIndex: number;
  customPsws: ReadonlyArray<{ fswKeyword: string; pswKeyword: string; data: Uint8Array }>;
}): Promise<FunctionList> {
  const cabd = await inputs.chassis.cabd.openModule(
    inputs.physicalModuleName,
    inputs.codingIndex,
  );
  return buildFunctionList(cabd, {
    keywords: {
      fsw: inputs.chassis.swtFsw?.byKeyId,
      psw: inputs.chassis.swtPsw?.byKeyId,
    },
    customPsws: [...inputs.customPsws],
  });
}
