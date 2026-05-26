<script lang="ts">
  /**
   * Save / append / apply patches modal. One dialog covers all three
   * flows — the fields visible per mode are gated on
   * `patchDialog.mode`. The host (FunctionTree) opens it via
   * `openPatchDialog(mode, …)` and the dialog mutates either the
   * filesystem (save/append) or the FunctionTree's `targets` via the
   * `onApplied` callback (apply).
   *
   * No File System Access API dance — we use the same Blob+anchor
   * download trick `fsw-psw-trc.ts` already uses for `.MAN` files,
   * and a hidden `<input type="file">` for picking patches to read.
   * Keeps the build cross-browser without permission prompts.
   */
  import { app } from "../lib/state.svelte";
  import {
    closePatchDialog,
    patchDialog,
  } from "../lib/patch-dialog.svelte";
  import {
    applyPatchToTargets,
    buildPatchFromCurrent,
    formatCodingIndex,
    mergeIntoExistingPatch,
    rebuildFunctionListWithPatch,
    serializePatch,
    type ApplyOutcome,
  } from "../lib/patches";
  import { parsePatch, type PatchFile, modulesForCurrent } from "@emdzej/ncsx-patches";

  /** Save / append form state. Reset every time the dialog opens. */
  let title = $state("");
  let description = $state("");
  let author = $state("");
  let keywordsText = $state(""); // comma- or space-separated
  let pinCodingIndex = $state(false);
  let captureRequireCurrent = $state(false);
  let moduleDescription = $state("");
  let mergeMode = $state<"merge" | "replace">("merge");
  let error = $state<string | null>(null);
  let applyOutcome = $state<ApplyOutcome | null>(null);

  /** Initialise per-mode whenever the dialog reopens. */
  $effect(() => {
    if (!patchDialog.open) return;
    error = null;
    applyOutcome = null;
    if (patchDialog.mode === "save") {
      title = "";
      description = "";
      author = "";
      keywordsText = "";
      pinCodingIndex = false;
      captureRequireCurrent = false;
      moduleDescription = "";
    } else if (patchDialog.mode === "append") {
      mergeMode = "merge";
      moduleDescription = "";
      pinCodingIndex = patchDialog.loadedPatch?.modules.some((m) =>
        Boolean(m.coding_indexes?.length),
      ) ?? false;
      captureRequireCurrent = false;
    } else if (patchDialog.mode === "apply") {
      // If the patch declares `custom_psws:` for the current module,
      // rebuild app.functionList with the overlay merged in before
      // resolving — otherwise the patch's references to its own
      // custom PSWs would resolve as "unknown PSW" warnings.
      // Sync path stays for patches without custom PSWs.
      void prepareApply();
    }
  });

  /**
   * Apply-mode preparation: rebuild the FunctionList with the patch's
   * `custom_psws:` overlay (if any) before resolving. Catches overlay
   * errors (unknown FSW, byte-length mismatch, keyword collision) and
   * surfaces them via the dialog's `error` field instead of crashing.
   */
  async function prepareApply(): Promise<void> {
    if (
      !patchDialog.loadedPatch ||
      !app.chassis ||
      !app.selectedModule ||
      !app.selectedModule.umrsg
    ) {
      // No umrsg means no SGAUSWAHL row → no way to look the patch's
      // `module:` key against the loaded module. Skip the overlay
      // rebuild and fall back to the existing apply path; if the patch
      // doesn't carry custom_psws this is also fine.
      applyOutcome = computeApplyOutcome();
      return;
    }
    try {
      const { list, customPswCount } = await rebuildFunctionListWithPatch({
        chassis: app.chassis,
        physicalModuleName: app.selectedModule.moduleName,
        umrsg: app.selectedModule.umrsg,
        codingIndex: app.selectedModule.codingIndex,
        patch: patchDialog.loadedPatch,
      });
      app.functionList = list;
      applyOutcome = computeApplyOutcome();
      if (customPswCount > 0 && applyOutcome) {
        applyOutcome = {
          ...applyOutcome,
          warnings: [
            `Registered ${customPswCount} custom PSW${customPswCount === 1 ? "" : "s"} from this patch.`,
            ...applyOutcome.warnings,
          ],
        };
      }
    } catch (err) {
      error =
        "Custom-PSW overlay rejected: " +
        (err instanceof Error ? err.message : String(err));
      applyOutcome = null;
    }
  }

  /** Current chassis + module fields — bail to "?" rather than crash if missing. */
  const chassisCode = $derived(app.chassis?.code ?? "?");
  const moduleName = $derived(app.selectedModule?.umrsg ?? "?");
  const codingIndex = $derived(app.selectedModule?.codingIndex ?? 0);
  const ciLabel = $derived(formatCodingIndex(codingIndex));
  const editCount = $derived(Object.keys(patchDialog.currentTargets).length);

  function parseKeywords(s: string): string[] {
    return s
      .split(/[,\s]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  function close(): void {
    closePatchDialog();
  }

  /** Trigger a browser download for a YAML string with the suggested filename. */
  function downloadYaml(text: string, filename: string): void {
    const blob = new Blob([text], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** Suggested filename — `<title-slug>.ncsxpatch.yaml`. */
  function filenameFor(t: string, fallback: string): string {
    const slug = t
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${slug || fallback}.ncsxpatch.yaml`;
  }

  function onSave(): void {
    if (!app.functionList || !app.selectedModule) {
      error = "No module loaded";
      return;
    }
    if (!title.trim()) {
      error = "Title is required";
      return;
    }
    if (editCount === 0) {
      error = "No pending edits to save";
      return;
    }
    try {
      const patch = buildPatchFromCurrent({
        chassisCode,
        module: moduleName,
        codingIndex,
        functionList: app.functionList,
        targets: patchDialog.currentTargets,
        customPsws: patchDialog.currentCustomPsws,
        netto: app.lastReadNetto,
        seed: {
          title: title.trim(),
          description: description.trim(),
          author: author.trim(),
          keywords: parseKeywords(keywordsText),
          pinCodingIndex,
          captureRequireCurrent: captureRequireCurrent && app.lastReadNetto != null,
          moduleDescription: moduleDescription.trim(),
        },
      });
      downloadYaml(serializePatch(patch), filenameFor(title, "patch"));
      close();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function onAppend(): void {
    if (!app.functionList || !app.selectedModule || !patchDialog.loadedPatch) {
      error = "Missing context — re-open the dialog";
      return;
    }
    if (editCount === 0) {
      error = "No pending edits to append";
      return;
    }
    try {
      const merged = mergeIntoExistingPatch(
        patchDialog.loadedPatch,
        {
          chassisCode,
          module: moduleName,
          codingIndex,
          functionList: app.functionList,
          targets: patchDialog.currentTargets,
          customPsws: patchDialog.currentCustomPsws,
          netto: app.lastReadNetto,
          seed: {
            title: patchDialog.loadedPatch.title, // preserved
            pinCodingIndex,
            captureRequireCurrent: captureRequireCurrent && app.lastReadNetto != null,
            moduleDescription: moduleDescription.trim(),
          },
        },
        mergeMode,
      );
      downloadYaml(
        serializePatch(merged),
        patchDialog.loadedFilename || filenameFor(merged.title, "patch"),
      );
      close();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function computeApplyOutcome(): ApplyOutcome | null {
    if (!patchDialog.loadedPatch || !app.functionList || !app.selectedModule) {
      return null;
    }
    return applyPatchToTargets({
      patch: patchDialog.loadedPatch,
      module: moduleName,
      codingIndex,
      chassisCode,
      functionList: app.functionList,
      netto: app.lastReadNetto,
    });
  }

  function onApply(): void {
    if (!applyOutcome || !patchDialog.onApplied) {
      error = "Nothing to apply";
      return;
    }
    if (Object.keys(applyOutcome.targets).length === 0) {
      error = "Patch produced no applicable edits for this module";
      return;
    }
    if (applyOutcome.requireCurrentMismatches.length > 0) {
      const ok = window.confirm(
        `This patch's require_current assertions don't match the current ECU:\n\n` +
          applyOutcome.requireCurrentMismatches.join("\n") +
          `\n\nApply anyway?`,
      );
      if (!ok) return;
    }
    patchDialog.onApplied(applyOutcome.targets);
    close();
  }

  /** Apply-mode: when there are multiple matching blocks, summarise. */
  const matchingBlocks = $derived(
    patchDialog.mode === "apply" && patchDialog.loadedPatch
      ? modulesForCurrent(patchDialog.loadedPatch, moduleName)
      : [],
  );

  /** Common dialog title. */
  const headerTitle = $derived(
    patchDialog.mode === "save"
      ? "Save as patch"
      : patchDialog.mode === "append"
        ? "Append to patch"
        : "Apply patch",
  );

  const headerSubtitle = $derived(
    patchDialog.mode === "save"
      ? `${editCount} pending edit${editCount === 1 ? "" : "s"} from ${moduleName} (${ciLabel}, ${chassisCode})`
      : patchDialog.mode === "append"
        ? `appending ${editCount} edit${editCount === 1 ? "" : "s"} to ${patchDialog.loadedFilename || "patch"}`
        : `from ${patchDialog.loadedFilename || "patch"} → ${moduleName} (${ciLabel}, ${chassisCode})`,
  );
</script>

{#if patchDialog.open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={close}
    onkeydown={(e) => e.key === "Escape" && close()}
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded border border-rule bg-surface shadow-2xl"
      role="document"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="flex items-baseline justify-between gap-4 border-b border-divider px-4 py-3">
        <div>
          <h2 class="text-sm font-bold uppercase tracking-wider text-muted">
            {headerTitle}
          </h2>
          <p class="mt-0.5 text-xs text-faint">{headerSubtitle}</p>
        </div>
        <button
          class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
          onclick={close}
        >
          close
        </button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-sm">
        {#if patchDialog.mode === "save" || patchDialog.mode === "append"}
          {#if patchDialog.mode === "save"}
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold uppercase tracking-wider text-faint">
                Title <span class="text-rose-500">*</span>
              </span>
              <input
                type="text"
                bind:value={title}
                placeholder="e.g. DRL via parking lights (E46 LCM)"
                class="rounded border border-rule bg-base px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold uppercase tracking-wider text-faint">
                Description
              </span>
              <textarea
                bind:value={description}
                rows="3"
                placeholder="What does this patch change? Why?"
                class="rounded border border-rule bg-base px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
              ></textarea>
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="flex flex-col gap-1">
                <span class="text-xs font-semibold uppercase tracking-wider text-faint">
                  Author
                </span>
                <input
                  type="text"
                  bind:value={author}
                  placeholder="name / handle / email"
                  class="rounded border border-rule bg-base px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs font-semibold uppercase tracking-wider text-faint">
                  Keywords
                </span>
                <input
                  type="text"
                  bind:value={keywordsText}
                  placeholder="DRL, lights, retrofit"
                  class="rounded border border-rule bg-base px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                />
              </label>
            </div>
          {/if}

          {#if patchDialog.mode === "append"}
            <div class="rounded border border-divider bg-base p-2 text-xs">
              <p class="mb-1 font-semibold text-muted">Existing patch</p>
              <p class="text-faint">
                <span class="font-mono">{patchDialog.loadedFilename}</span> ·
                {patchDialog.loadedPatch?.title} ·
                {patchDialog.loadedPatch?.chassis} ·
                {patchDialog.loadedPatch?.modules.length}
                module block{patchDialog.loadedPatch?.modules.length === 1 ? "" : "s"}
              </p>
              {#if patchDialog.loadedPatch && patchDialog.loadedPatch.chassis.toLowerCase() !== chassisCode.toLowerCase()}
                <p class="mt-1 text-rose-500">
                  ⚠ chassis mismatch: patch targets
                  <span class="font-mono">{patchDialog.loadedPatch.chassis}</span>,
                  loaded is <span class="font-mono">{chassisCode}</span>
                </p>
              {/if}
            </div>
            {#if patchDialog.loadedPatch?.modules.some((m) => m.module.toLowerCase() === moduleName.toLowerCase())}
              <label class="flex flex-col gap-1">
                <span class="text-xs font-semibold uppercase tracking-wider text-faint">
                  Existing {moduleName} block — how to combine?
                </span>
                <select
                  bind:value={mergeMode}
                  class="rounded border border-rule bg-base px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  <option value="merge">Merge — keep existing edits, overlay these</option>
                  <option value="replace">Replace — wipe existing edits, use only these</option>
                </select>
              </label>
            {/if}
            <label class="flex flex-col gap-1">
              <span class="text-xs font-semibold uppercase tracking-wider text-faint">
                Module description (optional)
              </span>
              <input
                type="text"
                bind:value={moduleDescription}
                placeholder="What does this module block do?"
                class="rounded border border-rule bg-base px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
              />
            </label>
          {/if}

          <fieldset class="flex flex-col gap-1.5 rounded border border-divider bg-base p-2">
            <legend class="px-1 text-xs font-semibold uppercase tracking-wider text-faint">
              Compatibility checks
            </legend>
            <label class="flex items-baseline gap-2 text-xs">
              <input type="checkbox" bind:checked={pinCodingIndex} />
              <span>
                Pin coding index <span class="font-mono">{ciLabel}</span> —
                apply-time warning if recipient is on a different CI
              </span>
            </label>
            <label class="flex items-baseline gap-2 text-xs">
              <input
                type="checkbox"
                bind:checked={captureRequireCurrent}
                disabled={app.lastReadNetto == null}
              />
              <span class:opacity-50={app.lastReadNetto == null}>
                Capture current PSW values as <span class="font-mono">require_current</span>
                — refuse apply if ECU isn't in this state
                {#if app.lastReadNetto == null}<span class="text-rose-500"> (needs a recent Read)</span>{/if}
              </span>
            </label>
          </fieldset>
        {/if}

        {#if patchDialog.mode === "apply" && applyOutcome}
          <div class="rounded border border-divider bg-base p-2 text-xs">
            <p class="mb-1 font-semibold text-muted">
              {patchDialog.loadedPatch?.title}
            </p>
            {#if patchDialog.loadedPatch?.description}
              <p class="mb-2 whitespace-pre-line text-faint">
                {patchDialog.loadedPatch.description}
              </p>
            {/if}
            <p class="text-faint">
              chassis <span class="font-mono">{patchDialog.loadedPatch?.chassis}</span>
              {#if patchDialog.loadedPatch?.author}
                · by <span class="font-mono">{patchDialog.loadedPatch.author}</span>
              {/if}
              {#if patchDialog.loadedPatch?.keywords?.length}
                · {patchDialog.loadedPatch.keywords.join(", ")}
              {/if}
            </p>
          </div>

          {#if matchingBlocks.length === 0}
            <p class="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
              This patch has no entries for <span class="font-mono">{moduleName}</span>.
              Modules covered: {patchDialog.loadedPatch?.modules.map((m) => m.module).join(", ") || "(none)"}.
              Load the right module and re-apply, or pick a different patch.
            </p>
          {:else}
            <div class="rounded border border-divider bg-base p-2 text-xs">
              <p class="mb-1 font-semibold text-muted">
                Will stage {Object.keys(applyOutcome.targets).length} edit{Object.keys(applyOutcome.targets).length === 1 ? "" : "s"}
              </p>
              {#if matchingBlocks[0]?.description}
                <p class="mb-2 italic text-faint">{matchingBlocks[0].description}</p>
              {/if}
              <ul class="space-y-0.5 font-mono">
                {#each Object.entries(matchingBlocks[0]?.edits ?? {}) as [fsw, psw] (fsw)}
                  <li class="text-foreground">
                    <span class="text-muted">{fsw}</span>
                    <span class="text-faint"> → </span>
                    <span>{psw}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if applyOutcome.warnings.length > 0}
            <div class="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
              <p class="mb-1 font-semibold">Warnings</p>
              <ul class="list-inside list-disc space-y-0.5">
                {#each applyOutcome.warnings as w (w)}
                  <li>{w}</li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if applyOutcome.requireCurrentMismatches.length > 0}
            <div class="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
              <p class="mb-1 font-semibold">require_current mismatches</p>
              <ul class="list-inside list-disc space-y-0.5">
                {#each applyOutcome.requireCurrentMismatches as m (m)}
                  <li>{m}</li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if editCount > 0}
            <p class="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
              You already have {editCount} staged edit{editCount === 1 ? "" : "s"} —
              the patch will overlay them by FSW id.
            </p>
          {/if}
        {/if}

        {#if error}
          <p class="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </p>
        {/if}
      </div>

      <footer class="flex items-center justify-end gap-2 border-t border-divider bg-elevated/50 px-4 py-2">
        <button
          class="rounded border border-rule px-2 py-0.5 text-xs text-muted hover:bg-elevated hover:text-foreground"
          onclick={close}
        >
          Cancel
        </button>
        {#if patchDialog.mode === "save"}
          <button
            class="rounded bg-accent px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            onclick={onSave}
            disabled={editCount === 0 || !title.trim()}
          >
            Download patch
          </button>
        {:else if patchDialog.mode === "append"}
          <button
            class="rounded bg-accent px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            onclick={onAppend}
            disabled={editCount === 0 || !patchDialog.loadedPatch}
          >
            Download merged patch
          </button>
        {:else}
          <button
            class="rounded bg-accent px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            onclick={onApply}
            disabled={!applyOutcome || Object.keys(applyOutcome.targets).length === 0}
          >
            Stage edits
          </button>
        {/if}
      </footer>
    </div>
  </div>
{/if}
