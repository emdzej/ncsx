# Patches (`.ncsxpatch.yaml`)

A **patch** is a YAML file that describes one or more module-scoped
FSW/PSW coding changes, wrapped in metadata so it can be shared,
indexed, and verified at apply time.

Patches are the rich-format cousin of `FSW_PSW.MAN`:

- `.MAN` is plain text, one module at a time, no metadata.
- `.ncsxpatch.yaml` is YAML, multi-module per file, with
  title/author/keywords/chassis/coding-index/require-current.

The CABI write path (`SG_CODIEREN` via the per-CABD `A_*.IPO`) is
unchanged — patches just stage the same edits a user would otherwise
make by hand in the FunctionTree.

## File extension

`.ncsxpatch.yaml`

(The `.yaml` suffix keeps editor syntax-highlighting; the
`.ncsxpatch` infix makes the purpose clear and lets file-association
rules target the right opener.)

## Schema (v1)

```yaml
# REQUIRED
schema: ncsx-patch/v1
title: DRL via parking lights (E46 LCM)
chassis: E46
modules:
  - module: LCM
    edits:
      TFL_FUNKTION: aktiv
      TFL_LICHTHUPE: aktiv
      STANDLICHT_TFL: aktiv

# OPTIONAL — top-level
description: |
  Activates running lights through the front parking lamps when
  ignition is on. Standard Euro feature; missing on US-spec cars.
author: emdzej
keywords: [DRL, lights, retrofit]

# OPTIONAL — per-module
#   modules:
#     - module: LCM
#       description: ...                 # free text
#       coding_indexes: [C06, C07]       # advisory CI pinning
#       require_current:                 # pre-write assertions
#         TFL_LICHTHUPE: nicht_aktiv
#       edits: {...}
```

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema` | string literal `"ncsx-patch/v1"` | yes | Schema discriminator. |
| `title` | string | yes | Shown in the patch picker / file metadata. |
| `description` | string | no | Block literal preferred for multi-line text. |
| `author` | string | no | Free-form (name, handle, email). |
| `keywords` | string[] | no | Search/filter tags. |
| `chassis` | string | yes | Canonical chassis code (`E46`, `E90`, `F30`, …). |
| `modules` | array | yes | At least one block. |
| `modules[].module` | string | yes | SGFAM short name (`LCM`, `GM5`, `KOMBI`, …). Case-insensitive at apply time. |
| `modules[].coding_indexes` | string[] | no | Advisory CI pin (`C06`, `C07`). Mismatch → warning, not refusal. |
| `modules[].description` | string | no | Per-block description (rendered in the apply preview). |
| `modules[].require_current` | record\<FSW, PSW\> | no | Refuse apply if these don't match the live ECU. |
| `modules[].edits` | record\<FSW, PSW\> | yes (min 1) | FSW keyword → PSW keyword. `FSW_<id>` / `PSW_<id>` numeric fallback supported. |

## Compatibility model

Two layers, applied in this order when the user clicks **Apply patch**:

1. **Soft** — surface a warning if any of these don't match:
   - `chassis` ≠ `app.chassis.code`.
   - `coding_indexes` is non-empty and doesn't include the current
     CI (e.g. patch says `[C06, C07]`, ECU is on `C04`).
   - Patch covers no entries for the current module.
2. **Hard** — drop the entry, surface a warning:
   - FSW keyword doesn't resolve against the loaded CABD's
     `PARZUWEISUNG_FSW`.
   - FSW resolves but PSW keyword isn't a valid value for it.
3. **Strict (`require_current`)** — refuse the apply unless the user
   confirms past the mismatch warning:
   - Every key in `require_current` must be currently active in the
     ECU's last-read netto. If not, the dialog pops a confirm before
     staging.

Resolution is order-preserving and order-stable: patches always write
their `edits` in insertion order, and the FunctionTree's pending edits
overlay in the same order.

## UI flow

### Save as patch

1. Stage one or more PSW changes in the FunctionTree.
2. **Save as patch…** → fill in title (required) + optional
   description / author / keywords.
3. Optional toggles:
   - **Pin coding index** — adds `coding_indexes: [<current CI>]`
     to the module block.
   - **Capture require_current** — snapshots the current PSW of each
     FSW you're editing into `require_current`.
4. Download — browser saves a `.ncsxpatch.yaml` file.

### Append to patch

1. Stage one or more PSW changes.
2. **Append to patch…** → pick an existing `.ncsxpatch.yaml` file.
3. If the patch already covers this module, pick **merge** (overlay
   new edits on top of existing) or **replace** (wipe existing,
   keep only new).
4. Download — same file, augmented.

### Apply patch

1. Load the right module (chassis + UMRSG + CI).
2. **Apply patch…** → pick a `.ncsxpatch.yaml` file.
3. The dialog previews the entries it would stage, surfaces
   warnings, and refuses on hard mismatches (no module block,
   no resolvable edits).
4. **Stage edits** — pending edits overlay your current edits by
   FSW id. Hit **Apply to ECU** as usual to actually write.

Multi-module patches are supported by the **file**, but each apply
only stages the **current module's** block. Repeat the load + apply
flow for each module the patch covers — there's no cross-module
auto-apply (yet).

## Example: enabling DRL on an E46 LCM

```yaml
schema: ncsx-patch/v1
title: DRL via parking lights (E46 LCM)
description: |
  Activates running lights through the front parking lamps when
  ignition is on. Standard Euro feature; missing on US-spec cars.

  Sources: Bentley Service Manual §63-13-08, BMW TIS bulletin 6312-08.
author: emdzej
keywords: [DRL, lights, retrofit, us-spec]
chassis: E46

modules:
  - module: LCM
    description: Enable TFL function + assign parking-lamp output.
    coding_indexes: [C06, C07]
    require_current:
      TFL_LICHTHUPE: nicht_aktiv
    edits:
      TFL_FUNKTION: aktiv
      TFL_LICHTHUPE: aktiv
      STANDLICHT_TFL: aktiv
```

## Multi-module example: comfort access

```yaml
schema: ncsx-patch/v1
title: Comfort Access (E60)
description: |
  Enable Comfort Access — touch-sensor unlock on the door handles +
  welcome-light fade + dashboard icon.
author: emdzej
keywords: [CA, comfort-access, retrofit]
chassis: E60

modules:
  - module: CAS
    description: Wire CAS to expect touch-sensor events.
    edits:
      KOMFORT_ZUGANG: aktiv
      TUERGRIFF_SENSORIK: aktiv

  - module: LCM
    description: Welcome-light fade on unlock.
    edits:
      WELCOME_LIGHT: aktiv

  - module: KOMBI
    description: Show the CA indicator on the dash.
    edits:
      CA_ANZEIGE: aktiv
```

To apply: load CAS → Apply patch → write; load LCM → Apply patch →
write; load KOMBI → Apply patch → write.

## Sharing

The `bimmerz-patches` community repo collects vetted patches. To
contribute:

1. Author the patch on a real chassis, confirm it codes cleanly,
   confirm the ECU still passes its post-write read.
2. Set a clear `title` and a `description` that explains the
   feature, the prerequisites (hardware retrofits, FA codes, other
   modules), and the source of the change if known.
3. Open a PR against `bimmerz-patches` with the file under
   `<chassis>/<module>/<title>.ncsxpatch.yaml`.

## Format stability

`schema: ncsx-patch/v1` is fixed for the lifetime of the v1 reader.
Future additions:

- Backwards-compatible additions (new optional fields) → still v1.
- Breaking shape changes (renaming `edits`, reordering hard checks)
  → bump to `ncsx-patch/v2`, ship a v1→v2 migrator in the CLI.

The reader rejects unknown top-level schemas to keep mistakes
loud — a `v2` patch loaded into a `v1`-only client surfaces a clear
"unsupported schema" error rather than silent partial apply.
