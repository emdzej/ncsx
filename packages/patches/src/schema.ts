/**
 * `.ncsxpatch.yaml` schema, v1.
 *
 * A patch describes one or more **module-scoped** FSW/PSW edits. The
 * shape mirrors the `FSW_PSW.MAN` format that NCSEXPER consumes
 * (pairs of FSW keyword → PSW keyword) but wraps it in a YAML
 * envelope with author/chassis/module metadata so patches can be
 * filtered and shared.
 *
 * Compatibility is checked in two layers at apply time:
 *
 * 1. **Soft** — `chassis` / per-module `coding_indexes` are advisory.
 *    A mismatch surfaces a warning but does not block.
 * 2. **Hard** — every FSW keyword in `edits` must resolve against
 *    the loaded CABD's FunctionList, and every PSW keyword must be a
 *    valid value for that FSW. Unresolved entries are dropped from
 *    the apply with a warning.
 *
 * Optional `require_current` asserts what the ECU currently holds
 * before write. If any pair mismatches, the apply is refused unless
 * the caller forces it.
 */

import { z } from 'zod';

/**
 * One custom PSW the patch contributes to the FSW catalogue at apply time.
 * Lets a shared patch declare PSWs that the chassis DATEN doesn't enumerate
 * by default — e.g. "DRL via parking lights, 50% brightness" with custom
 * bytes. The build step in `@emdzej/ncsx-function-list` assigns synthetic
 * ids from the `CUSTOM_PSW_ID_BASE` range so factory ids stay untouched.
 *
 * See `docs/custom-fsw-psw.md` and the proposal companion in this package's
 * README.
 */
export const CustomPswSchema = z.object({
  /** Keyword of the FSW this PSW extends. Must already exist in the loaded DATEN. */
  fsw: z.string().min(1),
  /**
   * The new PSW's keyword. Must be unique within the FSW's parameter list
   * (no collision with factory PSWs or other custom entries).
   */
  keyword: z.string().min(1),
  /**
   * Byte values to write at the FSW's slot when this PSW is chosen, as a
   * hex string. Whitespace allowed (`"5A 3C"` and `"5A3C"` both parse).
   * Length must equal the parent FSW's byte length.
   */
  data: z
    .string()
    .min(2)
    .regex(/^[0-9A-Fa-f\s]+$/, 'data must be a hex string')
    .refine((s) => s.replace(/\s+/g, '').length % 2 === 0, 'data must have an even number of hex digits'),
  /** Free-text note describing the value. Used for UI display only. */
  description: z.string().optional(),
});

export type CustomPsw = z.infer<typeof CustomPswSchema>;

/** Module-level patch entry — one block of edits scoped to a single SG. */
export const ModulePatchSchema = z.object({
  /** SGFAM short name (LCM, GM5, KOMBI, …). Matched against `app.selectedModule.umrsg`. */
  module: z.string().min(1),

  /**
   * Optional list of `.Cxx` coding-index variants the patch was authored against
   * ("C06", "C07"). Advisory only — the FSW/PSW existence check covers the
   * harder constraint.
   */
  coding_indexes: z.array(z.string().min(1)).optional(),

  /** Free-text description of what this module block changes. */
  description: z.string().optional(),

  /**
   * Custom PSWs the patch contributes. Registered into the FunctionList at
   * apply time (via `@emdzej/ncsx-function-list`'s `customPsws` builder
   * option), then referenceable in `edits` like any factory PSW.
   *
   * Custom PSWs ride inside the patch file so a downloaded patch
   * self-describes — no separate overlay file to keep in sync.
   */
  custom_psws: z.array(CustomPswSchema).optional(),

  /**
   * Pre-write assertions. Each key is an FSW keyword, value is the PSW keyword
   * the ECU is expected to currently hold. Apply refuses if any assertion fails.
   */
  require_current: z.record(z.string()).optional(),

  /**
   * The actual changes. Keys are FSW keywords (or `FSW_<id>` fallback), values
   * are PSW keywords (or `PSW_<id>` fallback). Order is preserved on round-trip.
   */
  edits: z.record(z.string()).refine((e) => Object.keys(e).length > 0, {
    message: 'edits must contain at least one FSW → PSW pair',
  }),
});

export type ModulePatch = z.infer<typeof ModulePatchSchema>;

/** Top-level `.ncsxpatch.yaml` document. */
export const PatchFileSchema = z.object({
  /** Schema discriminator; v1 = `ncsx-patch/v1`. */
  schema: z.literal('ncsx-patch/v1'),

  /** Short human title — shown in the patch picker. */
  title: z.string().min(1),

  /** Long-form description of the patch as a whole. */
  description: z.string().optional(),

  /** Free-form author identifier (name, handle, email — whatever the user wrote). */
  author: z.string().optional(),

  /** Search/filter tags. */
  keywords: z.array(z.string()).optional(),

  /** Canonical chassis code (E46, E90, F30, …). Matches `app.chassis.code`. */
  chassis: z.string().min(1),

  /** One entry per module the patch touches. Order is preserved. */
  modules: z.array(ModulePatchSchema).min(1),
});

export type PatchFile = z.infer<typeof PatchFileSchema>;

export class PatchSchemaError extends Error {
  constructor(message: string, public issues?: z.ZodIssue[]) {
    super(message);
    this.name = 'PatchSchemaError';
  }
}
