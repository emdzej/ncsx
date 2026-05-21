<script lang="ts">
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { processEcu, formatCi } from "../lib/process-ecu";

  /**
   * Per-row state — what's happening with each SGFAM entry. Keyed by
   * `sgName` since that's the natural identity (`row.cabd` /
   * `row.sgbd` can be the same across logical SGs).
   *
   * The flow per row:
   *   idle  →  reading  →  done | error
   * `done` carries the resolved CI + `.Cxx` filename so the user sees
   * which variant got auto-picked without having to jump to the
   * FunctionTree view first.
   */
  type RowState =
    | { kind: "idle" }
    | { kind: "reading" }
    | { kind: "done"; ci: number; moduleName: string; sgbd: string }
    | { kind: "error"; message: string };

  let rowStates = $state<Record<string, RowState>>({});
  const reading = $derived(
    Object.values(rowStates).some((s) => s.kind === "reading"),
  );
  const canConnect = $derived(connection.status.kind === "connected");

  /**
   * SGFAM rows for the active chassis, alphabetically sorted. We show
   * every entry — not the FA/ZCS-master subset IdentityPanel uses —
   * because "Process ECU" is the whole-fleet coding entry point.
   */
  const rows = $derived.by<SgfamRow[]>(() => {
    if (!app.chassis) return [];
    return [...app.chassis.sgfam.values()].sort((a, b) =>
      a.sgName.localeCompare(b.sgName),
    );
  });

  async function onProcess(row: SgfamRow): Promise<void> {
    if (!app.chassis || !connection.session || reading) return;
    if (!row.cabd || !row.sgbd) {
      rowStates[row.sgName] = {
        kind: "error",
        message: "SGFAM row missing CABD or SGBD",
      };
      return;
    }
    rowStates[row.sgName] = { kind: "reading" };
    app.error = null;
    try {
      const res = await processEcu(app.chassis, row);
      if (res.ok && res.codingIndex !== undefined && res.moduleName && res.sgbd) {
        rowStates[row.sgName] = {
          kind: "done",
          ci: res.codingIndex,
          moduleName: res.moduleName,
          sgbd: res.sgbd,
        };
        // processEcu already flipped app.view → "view-module" on success,
        // but keep the row state populated so when the user backs out
        // they see which CI was resolved.
      } else {
        rowStates[row.sgName] = {
          kind: "error",
          message: res.error ?? "Process failed",
        };
      }
    } catch (err) {
      rowStates[row.sgName] = {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
</script>

<section class="rounded border border-divider bg-surface p-3">
  <div class="mb-2 flex items-baseline justify-between gap-2">
    <h3 class="text-sm font-semibold text-foreground">Process ECU</h3>
    <span class="text-xs text-faint">{rows.length} SGs in {app.chassis?.code}</span>
  </div>

  {#if !canConnect}
    <p class="text-xs text-faint">Connect to the ECU to read its coding index.</p>
  {:else if rows.length === 0}
    <p class="text-xs text-faint">
      No SGs in <span class="font-mono">{app.chassis?.code}</span>'s SGFAM.
    </p>
  {:else}
    <ul class="space-y-1">
      {#each rows as row (row.sgName)}
        {@const state = rowStates[row.sgName] ?? { kind: "idle" }}
        <li class="flex items-baseline justify-between gap-2 text-sm">
          <span class="flex-1 truncate">
            <span class="font-semibold text-foreground">{row.sgName}</span>
            <span class="ml-2 font-mono text-xs text-faint">{row.sgbd}</span>
            {#if state.kind === "done"}
              <span class="ml-2 text-xs text-green-600 dark:text-green-400">
                → {state.moduleName}.{formatCi(state.ci)}
              </span>
            {:else if state.kind === "error"}
              <span class="ml-2 text-xs text-red-600 dark:text-red-400">{state.message}</span>
            {/if}
          </span>
          <button
            class="shrink-0 rounded border border-divider bg-base px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
            onclick={() => onProcess(row)}
            disabled={reading || !row.sgbd || !row.cabd}
            title={!row.sgbd
              ? `SGFAM row for ${row.sgName} has no SGBD`
              : !row.cabd
                ? `SGFAM row for ${row.sgName} has no CABD`
                : `Read CODIERINDEX from ${row.sgName} via ${row.sgbd}`}
          >
            {state.kind === "reading" ? "Reading…" : "Process ECU"}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
