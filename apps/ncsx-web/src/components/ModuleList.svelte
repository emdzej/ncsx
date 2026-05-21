<script lang="ts">
  import { onMount } from "svelte";
  import { buildFunctionList } from "@emdzej/ncsx-function-list";
  import type { CabdModule } from "@emdzej/ncsx-chassis";
  import { app } from "../lib/state.svelte";
  import EcuList from "./EcuList.svelte";

  let filter = $state("");
  let modules = $state<CabdModule[]>([]);
  let loading = $state(false);

  /**
   * Reverse-index from on-disk SGAUSWAHL.SGNAME (= the .Cxx file basename) to the set
   * of logical SG names (SGAUSWAHL.UMRSG) that use that physical file. One physical
   * SG file can serve several logical SGs — e.g. `KMB_E46.C06` shows up for both
   * UMRSG=`KMB` and UMRSG=`AKMB`. See docs/ecu-selection.md §8.
   */
  const umrsgByPhysicalSg = $derived.by(() => {
    const out = new Map<string, Set<string>>();
    const sget = app.chassis?.sget;
    if (!sget) return out;
    for (const block of sget.blocks) {
      if (!block.name.startsWith("SGAUSWAHL_")) continue;
      for (const row of block.rows) {
        const physical = String(row.SGNAME ?? "");
        const logical = String(row.UMRSG ?? "");
        if (!physical || !logical) continue;
        let set = out.get(physical);
        if (!set) {
          set = new Set();
          out.set(physical, set);
        }
        set.add(logical);
      }
    }
    return out;
  });

  /**
   * Reverse-index from on-disk SGNAME → EDIABAS SGBD column. Used when launching a
   * read/write job against the cable: we need to know which SGBD to talk to. Multiple
   * (SGNAME, CBD) rows can map to different SGBDs (e.g. KMB_E46 uses `C_KMB46` for
   * older CIs and `KOMBI46R` for newer); when we open a specific .Cxx we'll pick the
   * SGBD whose row matched its CBD column.
   */
  const sgbdByPhysicalAndCi = $derived.by(() => {
    const out = new Map<string, string>();
    const sget = app.chassis?.sget;
    if (!sget) return out;
    for (const block of sget.blocks) {
      if (!block.name.startsWith("SGAUSWAHL_")) continue;
      for (const row of block.rows) {
        const physical = String(row.SGNAME ?? "");
        const cbd = String(row.CBD ?? "");
        const sgbd = String(row.SGBD ?? "");
        if (!physical || !cbd || !sgbd) continue;
        out.set(`${physical}.${cbd}`, sgbd);
      }
    }
    return out;
  });

  onMount(async () => {
    if (!app.chassis) return;
    loading = true;
    try {
      modules = await app.chassis.cabd.listModules();
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  const filtered = $derived(
    filter.length === 0
      ? modules
      : modules.filter((m) => {
          const q = filter.toLowerCase();
          if (m.moduleName.toLowerCase().includes(q)) return true;
          // Match by logical SG name (UMRSG) too — users search for "KMB", not "KMB_E46".
          const umrsgs = umrsgByPhysicalSg.get(m.moduleName);
          if (umrsgs) {
            for (const u of umrsgs) {
              if (u.toLowerCase().includes(q)) return true;
            }
          }
          return false;
        }),
  );

  async function openModule(moduleName: string, ci: number): Promise<void> {
    if (!app.chassis) return;
    app.error = null;
    app.busy = true;
    try {
      const cabd = await app.chassis.cabd.openModule(moduleName, ci);
      const list = buildFunctionList(cabd, {
        keywords: {
          fsw: app.chassis.swtFsw?.byKeyId,
          psw: app.chassis.swtPsw?.byKeyId,
        },
      });
      const ciLabel = `C${ci.toString(16).toUpperCase().padStart(2, "0")}`;
      const umrsgs = umrsgByPhysicalSg.get(moduleName);
      app.functionList = list;
      app.selectedSg = `${moduleName}.${ciLabel}`;
      app.selectedModule = {
        moduleName,
        codingIndex: ci,
        sgbd: sgbdByPhysicalAndCi.get(`${moduleName}.${ciLabel}`) ?? null,
        umrsg: umrsgs ? [...umrsgs][0] ?? null : null,
        resolution: { kind: "manual" },
      };
      app.lastReadNetto = null;
      app.view = "view-module";
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    } finally {
      app.busy = false;
    }
  }

  function back(): void {
    app.chassis = null;
    app.identity = null;
    app.view = "browse-chassis";
  }

  const fmtCi = (ci: number): string =>
    `C${ci.toString(16).toUpperCase().padStart(2, "0")}`;
</script>

<div class="mx-auto max-w-4xl p-6">
  <div class="mb-4 flex items-baseline justify-between gap-2">
    <h2 class="text-2xl font-bold text-foreground">
      {app.chassis?.code} — modules
    </h2>
    <button
      class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
      onclick={back}
    >
      ← back to chassis
    </button>
  </div>

  <p class="mb-3 text-sm text-faint">
    {modules.length} coding modules ({modules.reduce(
      (a, m) => a + m.codingIndexes.length,
      0,
    )} `.C??` files on disk).
  </p>

  <div class="mb-4 space-y-3">
    <EcuList />
  </div>

  <details class="mb-4">
    <summary class="cursor-pointer text-xs text-faint hover:text-muted">
      Browse all coding variants manually …
    </summary>
  </details>

  <input
    type="search"
    placeholder="Filter (e.g. KMB, LSZ, EWS, …)"
    bind:value={filter}
    class="mb-4 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
  />

  {#if loading}
    <p class="text-sm text-faint">Scanning chassis directory…</p>
  {:else if app.busy}
    <p class="text-sm text-faint">Loading coding catalog…</p>
  {:else}
    <ul class="space-y-2">
      {#each filtered as mod (mod.moduleName)}
        {@const umrsgs = umrsgByPhysicalSg.get(mod.moduleName)}
        <li class="rounded border border-rule bg-surface px-3 py-2">
          <div class="flex items-baseline justify-between gap-2">
            <div>
              <span class="text-sm font-semibold text-foreground">
                {mod.moduleName}
              </span>
              {#if umrsgs && umrsgs.size > 0}
                <span class="ml-2 text-xs text-faint">
                  SG{umrsgs.size > 1 ? "s" : ""}: {[...umrsgs].join(", ")}
                </span>
              {/if}
            </div>
            <span class="text-xs text-faint">
              {mod.codingIndexes.length}
              {mod.codingIndexes.length === 1 ? "variant" : "variants"}
            </span>
          </div>
          <div class="mt-1 flex flex-wrap gap-1">
            {#each mod.codingIndexes as ci (ci)}
              <button
                class="rounded border border-divider bg-base px-2 py-0.5 text-xs font-mono transition hover:border-accent hover:bg-elevated"
                onclick={() => openModule(mod.moduleName, ci)}
              >
                {fmtCi(ci)}
              </button>
            {/each}
          </div>
        </li>
      {/each}
    </ul>

    {#if filtered.length === 0 && !loading}
      <p class="mt-4 text-sm text-faint">
        No modules match "{filter}".
      </p>
    {/if}
  {/if}
</div>
