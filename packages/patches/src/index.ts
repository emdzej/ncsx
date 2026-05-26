export {
  CustomPswSchema,
  ModulePatchSchema,
  PatchFileSchema,
  PatchSchemaError,
  type CustomPsw,
  type ModulePatch,
  type PatchFile,
} from './schema.js';
export { extractCustomPsws, parseHexBytes, toOverlayEntry } from './custom-psws.js';
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
