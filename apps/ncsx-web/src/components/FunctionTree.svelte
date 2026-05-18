<script lang="ts">
  import type {
    FunctionListItem,
    PropertyItem,
    UnoccupiedItem,
  } from "@emdzej/ncsx-function-list";
  import { app } from "../lib/state.svelte";

  let filter = $state("");

  /** Translation lookup (or undefined while the CSV is still loading). */
  const tr = $derived(app.translations?.entries);

  /** Render a keyword with a faint trailing translation, NCSDummy-style. */
  function describe(keyword: string): { keyword: string; translation: string | null } {
    const t = tr?.get(keyword);
    return { keyword, translation: t && t !== "" ? t : null };
  }

  const items = $derived(app.functionList?.items ?? []);
  const filtered = $derived(
    filter.length === 0
      ? items
      : items.filter((item) => matchesFilter(item, filter.toLowerCase())),
  );

  /**
   * The filter also matches translation text, so typing "enabled" finds every PSW whose
   * English label includes "enabled" (even when the German keyword is `aktiv`).
   */
  function matchesFilter(item: FunctionListItem, q: string): boolean {
    if (item.kind === "function") {
      if (item.fswKeyword.toLowerCase().includes(q)) return true;
      if ((tr?.get(item.fswKeyword) ?? "").toLowerCase().includes(q)) return true;
      return item.parameters.some(
        (p) =>
          p.pswKeyword.toLowerCase().includes(q) ||
          (tr?.get(p.pswKeyword) ?? "").toLowerCase().includes(q),
      );
    }
    if (item.kind === "property") {
      return (
        item.fswKeyword.toLowerCase().includes(q) ||
        (tr?.get(item.fswKeyword) ?? "").toLowerCase().includes(q)
      );
    }
    if (item.kind === "group") {
      return (
        item.description.toLowerCase().includes(q) ||
        (tr?.get(item.description) ?? "").toLowerCase().includes(q)
      );
    }
    return false;
  }

  const stats = $derived({
    functions: items.filter((i) => i.kind === "function").length,
    properties: items.filter((i) => i.kind === "property").length,
    unoccupied: items.filter((i) => i.kind === "unoccupied").length,
    groups: items.filter((i) => i.kind === "group").length,
  });

  function back(): void {
    app.functionList = null;
    app.selectedSg = null;
    app.view = "browse-modules";
  }

  const fmtAddr = (n: number): string => n.toString(16).toUpperCase().padStart(8, "0");
  const fmtMask = (m: Uint8Array): string =>
    Array.from(m, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  const fmtData = (d: Uint8Array): string =>
    Array.from(d, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");

  function propertySummary(item: PropertyItem | UnoccupiedItem): string {
    return `${fmtAddr(item.address)} · len ${item.length} · mask ${fmtMask(item.mask)}`;
  }
</script>

<div class="mx-auto max-w-5xl p-6">
  <div class="mb-4 flex items-baseline justify-between gap-2">
    <div>
      <h2 class="text-2xl font-bold text-foreground">{app.selectedSg}</h2>
      <p class="mt-1 text-xs text-faint">
        {app.functionList?.memoryStructure} ·
        {stats.functions} functions ·
        {stats.properties} properties ·
        {stats.unoccupied} unoccupied ·
        {stats.groups} groups
      </p>
    </div>
    <button
      class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
      onclick={back}
    >
      ← back to modules
    </button>
  </div>

  <input
    type="search"
    placeholder="Filter — keyword or English (e.g. KEYCARDREADER, enabled)"
    bind:value={filter}
    class="mb-4 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
  />

  <p class="mb-2 text-xs text-faint">
    Read-only catalog view. Editing comes next.
  </p>

  <ul class="space-y-1">
    {#each filtered as item, i (i)}
      {#if item.kind === "function"}
        {@const fn = describe(item.fswKeyword || `FSW #${item.fsw}`)}
        <li class="rounded border border-divider bg-surface px-3 py-2">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-semibold text-foreground">
              {fn.keyword}{#if fn.translation}
                <span class="ml-2 text-xs font-normal text-faint">— {fn.translation}</span>
              {/if}
            </span>
            <span class="text-xs text-faint">
              {fmtAddr(item.address)} · len {item.length} · mask {fmtMask(item.mask)}
            </span>
          </div>
          <ul class="ml-4 mt-1 space-y-0.5">
            {#each item.parameters as p, pi (pi)}
              {@const param = describe(p.pswKeyword || `PSW #${p.psw}`)}
              <li class="flex items-baseline justify-between gap-2 text-sm">
                <span class="text-muted">
                  ☐ {param.keyword}{#if param.translation}
                    <span class="ml-1 text-xs text-faint">— {param.translation}</span>
                  {/if}
                </span>
                <span class="text-xs text-faint">{fmtData(p.data)}</span>
              </li>
            {/each}
          </ul>
        </li>
      {:else if item.kind === "property"}
        {@const prop = describe(item.fswKeyword || `PROPERTY #${item.fsw}`)}
        <li class="rounded border border-divider bg-surface px-3 py-2">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-semibold text-foreground">
              {prop.keyword}{#if prop.translation}
                <span class="ml-2 text-xs font-normal text-faint">— {prop.translation}</span>
              {/if}
            </span>
            <span class="text-xs text-faint">{propertySummary(item)} · unit {item.unit || "h"}</span>
          </div>
        </li>
      {:else if item.kind === "unoccupied"}
        <li class="rounded border border-divider bg-surface/60 px-3 py-1 text-xs text-faint">
          ⟨unoccupied⟩ {propertySummary(item)}
        </li>
      {:else if item.kind === "group"}
        {@const g = describe(item.description)}
        <li class="mt-3 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
          {item.groupKind} · {g.keyword}{#if g.translation}
            <span class="ml-1 normal-case font-normal text-faint">— {g.translation}</span>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>

  {#if filtered.length === 0}
    <p class="mt-4 text-sm text-faint">No items match "{filter}".</p>
  {/if}
</div>
