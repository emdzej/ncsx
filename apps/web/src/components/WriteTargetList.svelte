<script lang="ts" module>
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";

  /**
   * Per-ECU write status for one identity-write dispatch. Shared
   * across the three dialogs (FA / ZCS / FGNR) that all run the
   * same multi-target "checkbox list → write loop → status pills"
   * UX.
   */
  export type WriteStatus =
    | { kind: "pending" }
    | { kind: "writing" }
    | { kind: "ok"; durationMs: number }
    | { kind: "error"; message: string };

  export interface WriteTargetListProps {
    /**
     * Targets to render. `undefined` while the dialog is still
     * resolving them (CABD scan in flight); `[]` after scan when
     * no ECU on this chassis supports the write; populated when
     * we have candidates.
     */
    targets: SgfamRow[] | undefined;
    /** sgNames the user has currently selected for write. */
    selected: Set<string>;
    /**
     * Per-ECU status during/after a write run. Empty before write,
     * populated as the write loop progresses. Survives after the
     * loop ends so the user sees what landed.
     */
    results: Map<string, WriteStatus>;
    /** Write loop in flight — disables checkboxes + retry buttons. */
    writing: boolean;
    /**
     * Number of candidate ECUs scanned (whether they matched or not).
     * Surfaced in the "scanning N CABDs…" loading line.
     */
    candidateCount: number;
    /** Short noun for what we're scanning — e.g. "FAHRGESTELL_NR FSWs". */
    scanFor: string;
    /** Message rendered when `targets.length === 0`. */
    emptyMessage: string;
    onToggle: (sgName: string) => void;
    onRetry: (sg: SgfamRow) => void;
    /**
     * Select-all / select-none shortcuts. Rendered next to the "N
     * selected" count when the list is in its pre-write state (so
     * they don't appear during/after a write run).
     */
    onSelectAll: () => void;
    onSelectNone: () => void;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props extends WriteTargetListProps {
    /** Optional snippet rendered above the target list (e.g. "Target ECUs" header). */
    header?: Snippet;
  }

  let {
    targets,
    selected,
    results,
    writing,
    candidateCount,
    scanFor,
    emptyMessage,
    header,
    onToggle,
    onRetry,
    onSelectAll,
    onSelectNone,
  }: Props = $props();

  // Whether the list is in "pick-targets" mode (vs "writing/done"
  // mode). All/None shortcuts only show in pick-targets mode.
  const inPickMode = $derived(!writing && results.size === 0);
  const allSelected = $derived(
    targets !== undefined && targets.length > 0 && targets.every((t) => selected.has(t.sgName)),
  );
  const noneSelected = $derived(selected.size === 0);
</script>

<div class="rounded border border-divider bg-base p-2">
  {#if header}
    {@render header()}
  {:else}
    <div class="mb-2 flex items-baseline justify-between gap-2">
      <p class="text-xs font-semibold uppercase tracking-wider text-faint">
        Target ECUs
        {#if targets !== undefined}
          · {targets.length} found
          {#if inPickMode}
            · {selected.size} selected
          {/if}
        {/if}
      </p>
      {#if inPickMode && targets !== undefined && targets.length > 1}
        <span class="flex gap-2 text-xs text-faint">
          <button
            class="underline-offset-2 hover:text-muted hover:underline disabled:no-underline disabled:opacity-40"
            onclick={onSelectAll}
            disabled={allSelected}
            title="Select all targets"
          >
            all
          </button>
          <span class="text-faint">·</span>
          <button
            class="underline-offset-2 hover:text-muted hover:underline disabled:no-underline disabled:opacity-40"
            onclick={onSelectNone}
            disabled={noneSelected}
            title="Deselect all"
          >
            none
          </button>
        </span>
      {/if}
    </div>
  {/if}

  {#if targets === undefined}
    <p class="text-xs text-faint italic">
      Scanning {candidateCount} identity-master ECU CABD{candidateCount === 1 ? "" : "s"} for {scanFor}…
    </p>
  {:else if targets.length === 0}
    <p class="text-xs text-rose-700 dark:text-rose-300">{emptyMessage}</p>
  {:else}
    <ul class="space-y-1">
      {#each targets as row (row.sgName)}
        {@const status = results.get(row.sgName)}
        <li class="flex items-center justify-between gap-2 text-xs">
          <label
            class="flex min-w-0 flex-1 items-center gap-2 {writing || results.size > 0
              ? 'cursor-default'
              : 'cursor-pointer'}"
          >
            {#if results.size === 0 && !writing}
              <input
                type="checkbox"
                checked={selected.has(row.sgName)}
                onchange={() => onToggle(row.sgName)}
              />
            {:else if status?.kind === "ok"}
              <span class="inline-flex h-4 w-4 items-center justify-center text-emerald-600 dark:text-emerald-400">✓</span>
            {:else if status?.kind === "error"}
              <span class="inline-flex h-4 w-4 items-center justify-center text-rose-600 dark:text-rose-400">✗</span>
            {:else if status?.kind === "writing"}
              <span class="inline-flex h-4 w-4 items-center justify-center text-amber-600 dark:text-amber-400">⟳</span>
            {:else}
              <span class="inline-flex h-4 w-4 items-center justify-center text-faint">·</span>
            {/if}
            <span class="min-w-0">
              <span class="font-semibold text-foreground">{row.sgName}</span>
              <span class="ml-2 font-mono text-faint">{row.sgbd}</span>
              {#if status?.kind === "ok"}
                <span class="ml-2 text-faint">({status.durationMs} ms)</span>
              {:else if status?.kind === "writing"}
                <span class="ml-2 text-faint italic">writing…</span>
              {:else if status?.kind === "pending"}
                <span class="ml-2 text-faint italic">queued</span>
              {/if}
            </span>
          </label>
          {#if status?.kind === "error"}
            <button
              class="rounded border border-divider px-2 py-0.5 text-xs text-muted hover:border-accent hover:bg-elevated disabled:opacity-40"
              onclick={() => onRetry(row)}
              disabled={writing}
              title={status.message}
            >
              retry
            </button>
          {/if}
        </li>
        {#if status?.kind === "error"}
          <li class="ml-6 text-xs text-rose-700 dark:text-rose-300 break-all">
            {status.message}
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
</div>
