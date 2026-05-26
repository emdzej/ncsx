/**
 * Transient state for the patches modal. Lives outside `app` because
 * the payload (parsed PatchFile, callback to merge resolved targets
 * back into FunctionTree-local state) is per-open, not per-session.
 *
 * Three modes share one dialog — the UI shows different fields per
 * mode but the open/close lifecycle is uniform.
 */

import type { CustomPsw, PatchFile } from "@emdzej/ncsx-patches";

/** Which UI flow the dialog is running. */
export type PatchDialogMode = "save" | "append" | "apply";

interface PatchDialogState {
  open: boolean;
  mode: PatchDialogMode;
  /**
   * Snapshot of the FunctionTree's pending edits at open-time.
   * For `save` / `append` this is what gets written. For `apply` it's
   * still useful so we can warn the user they have un-committed edits
   * that the apply will overlay (we don't refuse, just inform).
   */
  currentTargets: Record<number, number>;
  /**
   * Snapshot of the FunctionTree's per-session custom-PSW draft at
   * open-time. For `save` / `append` these go into the module block's
   * `custom_psws:` so the saved patch is self-describing. For
   * `apply` we don't read this (the patch's own custom_psws drive
   * the overlay rebuild) — kept on the state shape for uniformity.
   */
  currentCustomPsws: readonly CustomPsw[];
  /**
   * For `append`: the existing patch parsed from the picked file.
   * For `apply`: the patch the user is about to apply.
   * Always reset on close.
   */
  loadedPatch: PatchFile | null;
  /** Display filename for the loaded patch (apply / append). */
  loadedFilename: string;
  /**
   * Apply-mode callback — invoked when the user clicks "Apply" in the
   * dialog. The FunctionTree owns the `targets` state, so we hand
   * resolved edits back through a closure rather than reaching across
   * components.
   */
  onApplied: ((targets: Record<number, number>) => void) | null;
}

export const patchDialog = $state<PatchDialogState>({
  open: false,
  mode: "save",
  currentTargets: {},
  currentCustomPsws: [],
  loadedPatch: null,
  loadedFilename: "",
  onApplied: null,
});

export function openPatchDialog(
  mode: PatchDialogMode,
  payload: {
    currentTargets: Record<number, number>;
    /** Optional — defaults to empty array if the caller has no draft. */
    currentCustomPsws?: readonly CustomPsw[];
    loadedPatch?: PatchFile;
    loadedFilename?: string;
    onApplied?: (targets: Record<number, number>) => void;
  },
): void {
  patchDialog.open = true;
  patchDialog.mode = mode;
  patchDialog.currentTargets = payload.currentTargets;
  patchDialog.currentCustomPsws = payload.currentCustomPsws ?? [];
  patchDialog.loadedPatch = payload.loadedPatch ?? null;
  patchDialog.loadedFilename = payload.loadedFilename ?? "";
  patchDialog.onApplied = payload.onApplied ?? null;
}

export function closePatchDialog(): void {
  patchDialog.open = false;
  patchDialog.loadedPatch = null;
  patchDialog.loadedFilename = "";
  patchDialog.onApplied = null;
  patchDialog.currentCustomPsws = [];
}
