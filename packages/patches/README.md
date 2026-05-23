# @emdzej/ncsx-patches

YAML patch format + reader/writer for shareable NCS coding changes
(`.ncsxpatch.yaml`).

A patch is the rich-format cousin of `FSW_PSW.MAN`: same FSW/PSW
edits, wrapped in metadata (title, description, author, keywords,
chassis, optional CI pin, optional `require_current` assertions)
and capable of carrying multiple module blocks in a single file.

Schema reference, compatibility model, and UI flow are documented in
[`docs/patches.md`](../../docs/patches.md).

## Usage

```ts
import {
  buildPatchFromCurrent,  // (in apps/web only — pulls in FunctionList)
  parsePatch,
  serializePatch,
  resolveModulePatch,
  modulesForCurrent,
  type PatchFile,
} from '@emdzej/ncsx-patches';

// Read a patch file
const patch: PatchFile = parsePatch(readFileSync('feature.ncsxpatch.yaml', 'utf-8'));

// Resolve against a loaded FunctionList
const { resolved, warnings } = resolveModulePatch(patch.modules[0], functionList);
// `resolved.targets` is a Record<fsw_id, psw_id> ready to merge into the
// FunctionTree's staged-edits state.

// Round-trip
writeFileSync('out.ncsxpatch.yaml', serializePatch(patch));
```

## Exports

| Export | Purpose |
|---|---|
| `parsePatch(text)` | YAML → `PatchFile` with zod validation. Throws `PatchSchemaError` on invalid input. |
| `serializePatch(patch)` | `PatchFile` → YAML. Block-literal `description`, flow-style `keywords`/`coding_indexes`. |
| `resolveModulePatch(modulePatch, list, currentCi?)` | Translate keyword edits → numeric `targets`. Returns warnings for unresolved entries + soft CI mismatch. |
| `checkRequireCurrent(modulePatch, list, netto, decodeCurrentPsw)` | Evaluate `require_current` against a netto buffer. |
| `modulesForCurrent(patch, moduleName)` | Pick the patch entries that apply to a given SG (case-insensitive). |
| `targetsToEdits(list, targets)` | Inverse of `resolveModulePatch` — Record<fsw_id, psw_id> → Record<FSW_KW, PSW_KW>. |
| `mergeModulePatch(patch, next, mode)` | Splice or replace a module block in an existing patch. |

## License

[PolyForm Noncommercial 1.0.0](../../LICENSE) — free for personal,
research, and hobby use.
