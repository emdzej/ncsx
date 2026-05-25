# Custom FSW/PSW parameters — feature proposal

NCS Dummy ships an **"Add FSW/PSW Parameter"** action that lets a user
register a brand-new PSW value under an existing FSW, with custom
bytes. The new PSW becomes a selectable coding option just like a
factory-shipped one, so the user can then `SG_CODIEREN` to write those
bytes to the ECU.

ncsx doesn't have this yet. This doc describes how NCS Dummy
implements it and sketches the ncsx-shaped equivalent.

## Why it's useful

- **Codename swaps that the factory CABD doesn't enumerate.** Real
  retrofits (DRL via parking lights, comfort access on a chassis with
  no factory option) sometimes need a specific bit pattern that lives
  inside the FSW's mask but isn't named by any PSW in the chassis-
  shipped DATEN. Without this feature the user is stuck either
  applying a different PSW with a similar pattern (lossy), or
  hand-editing bytes through the netto editor (error-prone, no
  reusability).
- **Per-keyword presets that survive between sessions.** A user can
  build a library of "this is the value I always set for FSW X" and
  share it (via the patches repo) as a named PSW.
- **Patch authoring affordance.** Today the patch system stores
  `<keyword>: <psw-name>` pairs that resolve against the factory PSW
  list. A custom PSW gives patches a stable named target for unusual
  combinations.

## How NCS Dummy does it

Two-stage flow: a UI step that stages the new parameter in-memory,
then a destructive "update module" step that rewrites two chassis
DATEN files in place (with `.ncsdummy_backup` rollback files).

### Stage 1 — UI (`TraceTreeView.cs:982 AddFswPswParameter`)

Right-click on a FSW node → "Add FSW/PSW Parameter"
(`TraceTreeView.cs:1744`, `Ctrl+N`). The handler creates a
`ParameterListItemNewFswPsw` tree node under the FSW with:

- Auto-generated keyword: `new_parameter1`, `new_parameter2`, …
  (scans siblings for `new_parameter\d+` and picks `max + 1`)
- Zero-filled byte array sized to match the parent FSW's `Length`
- Formula-derived value via
  `Formulas.ToString(chassis, module, codingIndex, keyword, mask, data)`
- For multi-word FSWs (`IsMultiWord`), a sibling new-parameter node
  on the paired half too (keeps both halves consistent)

User then edits keyword name + bytes via the property panel. The new
node lives only in memory until the user explicitly saves.

### Stage 2 — Persistence (`UpdateModule.cs ReadWrite`)

Background worker, four passes:

| Pass | What it does |
|---|---|
| `ProcessTreeNodes` (l.57) | Walk the tree, collect new PSW nodes into two structures: `pswList` (set of keywords) and `ModuleFunctionList` (parent-FSW `(block, address, mask)` → `(keyword, data)` tuples). Skips non-FSW tree nodes. |
| `FswFileReadWrite` (l.98) | **Modify `<chassis>SWTFSW.<swtIndex>`** (the chassis-wide keyword→ID dictionary). Backup first to `.ncsdummy_backup`. Scan every `SWT_EINTRAG_WS` row to find the maximum identifier in use. For each new keyword not already present, assign `id = max + 1` and **append a new `SWT_EINTRAG_WS` record** to the file. Mirror the assignment into the in-memory `KeywordList`. |
| `ProcessFunctionList` (l.199) | Back-fill the freshly-assigned identifiers from `pswList` onto the per-parameter entries inside `ModuleFunctionList`. |
| `ModuleFileReadWrite` (l.219) | **Modify `<module>.<Cxx>`** (the CABD module file). Backup first. Scan for the matching `PARZUWEISUNG_FSW_LLWWBBBB` row by `(block, address, mask)`. When the next non-PSW row appears, that's the insertion point — call `ExtendFileForInsert` to make room (4 KB sliding-window backwards copy of trailing bytes), then write the new PSW rows in place. |

The PSW byte encoding (`GetParameterBytes`, l.319):

- First 16 bytes of the data emit as a `PARZUWEISUNG_PSW1_WB` frame
  (with the assigned PSW identifier)
- Each additional 16-byte chunk emits as a `PARZUWEISUNG_PSW2_B`
  frame (continuation)
- Frame type IDs come from the file's definition section (the IPO
  reader has already mapped `PARZUWEISUNG_PSW1`/`PARZUWEISUNG_PSW2`
  to numeric IDs in `datenDefinitions`)

After both files are written, the user sees the new PSW in the tree
just like any factory-shipped one, and `SG_CODIEREN` against that FSW
with the new PSW selected writes the custom bytes to the ECU.

## How ncsx could do it

Two design choices to pin down, in order of seriousness:

### 1. Where do the new PSWs live?

**Option A — in-place DATEN mutation (NCS Dummy's approach).**
Modify the user's `~/Downloads/inpa/NCSEXPER/DATEN/<chassis>SWTFSW.000`
and `<module>.<Cxx>` files directly with sibling `.ncsx_backup` files.

| Pro | Con |
|---|---|
| Conceptually identical to NCS Dummy — same edits, same persistence shape, same outcome on the ECU. | Touches the user's factory data. Reversible via backup but a backup chain is fragile, and re-syncing the install from BMW Standard Tools loses everything. |
| New PSWs survive page reload automatically (they're in the parsed CABD). | We don't currently have a write path for DATEN files. The frame parser is read-only. |

**Option B — sidecar overlay (recommended).**
Store custom PSWs in a JSON/YAML file outside the BMW install, and
merge them into the parsed CABD at load time inside the
`@emdzej/ncsx-cabd` loader.

| Pro | Con |
|---|---|
| Factory DATEN stay pristine. Backup-and-restore is just deleting the overlay file. | Overlays are app-specific — sharing them needs an export step. |
| Trivially shareable as community patches (the patches repo already has a folder convention; an overlay is just a sidecar file). | Adds a second data source the loader has to consult per CABD. |
| Per-user customization without conflict (different users can run different overlay sets against the same install). | The keyword→ID assignment has to live somewhere durable since the patch references the keyword name. |
| Reversible per-keyword instead of per-file. | First-touch CABDs need to be loaded before an overlay can extend them. |

For ncsx, Option B fits the existing architecture better: we already
keep the BMW install read-only, the patches repo is the canonical
"user customizations" surface, and the CABD loader is the natural
merge point. Overlays would compose with the rest of the
`@emdzej/ncsx-coder` machinery without touching the file parsers.

### 2. Identifier assignment in the overlay world

NCS Dummy assigns numeric IDs because the file format needs them.
In an overlay model we have two options:

- **Synthetic IDs above a known ceiling.** Reserve IDs ≥ `0xF000`
  (or similar high-bits-set space that BMW doesn't use) and assign
  there. Keeps the FSW→PSW lookup path uniform (everything is a
  `uint16` ID, factory or custom). Risk: BMW could theoretically
  use those IDs in a future DATEN drop, although nothing observed so
  far approaches that range.
- **Keyword-keyed lookups for overlay-sourced PSWs.** Store custom
  PSWs by keyword string and have the FunctionList resolver fall
  back to the overlay keyword-map when the numeric-ID lookup misses.
  No ID-space conflict possible but adds a second lookup path.

The synthetic-ID approach is simpler and matches NCS Dummy's mental
model. Pick a documented ceiling (e.g. ID ≥ `0xF000` is "custom"),
fail loud if the install ever surfaces an ID in that range, and move
on.

## Implementation sketch

If we ship this, the moving parts roughly are:

- **`packages/cabd` overlay loader.** New optional `overlays: OverlayMap`
  parameter on the CABD loader; after parsing factory frames, fold
  in any overlay PSWs for the same `(block, address, mask)` key.
- **`packages/coder` slot-builder.** No change — slots are built from
  the merged FunctionList, source-agnostic.
- **`apps/web` UI.** A "+ Add parameter" button under each FSW row
  in the FunctionTree. Opens a small inline editor (keyword,
  hex-byte editor, optional description) that writes to the overlay
  file via OPFS or a synthetic file picker.
- **Patches repo integration.** A custom PSW can ride inside a
  `.ncsxpatch.yaml` as a `custom_psws:` block — the apply step
  registers it into the overlay before applying the keyword→psw
  pairs that reference it. This is the natural composition path:
  shared patches that depend on a custom PSW carry the PSW
  definition with them.

## References

- NCS Dummy source (this analysis):
  - `ncsx-research/ncsdummy-src/NcsDummy/Components/TraceEditor/TraceTreeView.cs:982,1744`
    — UI + AddFswPswParameter handler
  - `ncsx-research/ncsdummy-src/NcsDummy/Classes/UpdateModule/UpdateModule.cs`
    — full persistence pipeline (ProcessTreeNodes → FswFileReadWrite
    → ProcessFunctionList → ModuleFileReadWrite)
  - `ncsx-research/ncsdummy-src/NcsDummy/Classes/Functions/ParameterListItemNewFswPsw.cs`
    — UI tree-node model
- ncsx DATEN format (read side): `docs/daten-format.md`, especially
  §1.7 "The `A` (length-prefixed bytes) field" and §1.6
  format-string mini-language — the writer would emit the same shapes
  in reverse.
- ncsx patches: `docs/patches.md` (apply/serialize flow that an
  overlay PSW would slot into).
