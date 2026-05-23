/**
 * Transient state for the patches modal. Lives outside `app` because
 * the payload (parsed PatchFile, callback to merge resolved targets
 * back into FunctionTree-local state) is per-open, not per-session.
 *
 * Three modes share one dialog — the UI shows different fields per
 * mode but the open/close lifecycle is uniform.
 */

import type { PatchFile } from "@emdzej/ncsx-patches";

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
  loadedPatch: null,
  loadedFilename: "",
  onApplied: null,
});

export function openPatchDialog(
  mode: PatchDialogMode,
  payload: {
    currentTargets: Record<number, number>;
    loadedPatch?: PatchFile;
    loadedFilename?: string;
    onApplied?: (targets: Record<number, number>) => void;
  },
): void {
  patchDialog.open = true;
  patchDialog.mode = mode;
  patchDialog.currentTargets = payload.currentTargets;
  patchDialog.loadedPatch = payload.loadedPatch ?? null;
  patchDialog.loadedFilename = payload.loadedFilename ?? "";
  patchDialog.onApplied = payload.onApplied ?? null;
}

export function closePatchDialog(): void {
  patchDialog.open = false;
  patchDialog.loadedPatch = null;
  patchDialog.loadedFilename = "";
  patchDialog.onApplied = null;
}
