export {
  ModulePatchSchema,
  PatchFileSchema,
  PatchSchemaError,
  type ModulePatch,
  type PatchFile,
} from './schema.js';
export { parsePatch } from './parse.js';
export { serializePatch } from './serialize.js';
export {
  checkRequireCurrent,
  modulesForCurrent,
  resolveModulePatch,
  type CompatibilityResult,
  type RequireCurrentResult,
  type ResolvedEdits,
} from './validate.js';
export { mergeModulePatch, targetsToEdits, type MergeMode } from './build.js';
export {
  patchFromManSelections,
  patchToManSelections,
  type ManSelection,
  type ManConversionWarning,
  type PatchFromManOptions,
  type PatchFromManResult,
} from './man-convert.js';
