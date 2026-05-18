<script lang="ts">
  import { loadChassis } from "@emdzej/ncsx-chassis";
  import { app } from "../lib/state.svelte";

  /**
   * Per-subsystem badges shown above the chassis grid so the user can tell at
   * a glance which capabilities the picked install supports.
   */
  const subsystems = $derived.by(() => {
    const i = app.install;
    if (!i) return [];
    return [
      { label: "DATEN", present: i.daten !== null, role: "coding catalogs" },
      { label: "PFL", present: i.pfl !== null, role: "profiles" },
      { label: "NCS SGDAT", present: i.ncsSgdat !== null, role: "BEST scripts" },
      { label: "NCS CFGDAT", present: i.ncsCfgdat !== null, role: "COAPI config" },
      { label: "EDIABAS/Ecu", present: i.ediabasEcu !== null, role: "SGBD files (wire)" },
      { label: "INPA SGDAT", present: i.inpaSgdat !== null, role: "IPO scripts" },
    ];
  });

  async function openChassis(code: string): Promise<void> {
    if (!app.install?.datenSource) return;
    app.error = null;
    app.busy = true;
    try {
      app.chassis = await loadChassis(app.install.datenSource, code, {
        onWarning: (w) => console.warn(`[chassis ${code}]`, w),
      });
      app.view = "browse-modules";
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    } finally {
      app.busy = false;
    }
  }
</script>

<div class="mx-auto max-w-4xl p-6">
  <h2 class="mb-1 text-2xl font-bold text-foreground">Pick a chassis</h2>
  <p class="mb-3 text-sm text-faint">
    {app.install?.chassisCodes.length ?? 0} chassis declared in
    <code class="text-muted">NCSEXPER/DATEN/BR_REF.DAT</code>.
  </p>

  <div class="mb-6 flex flex-wrap gap-1.5 text-xs">
    {#each subsystems as s (s.label)}
      <span
        class="inline-flex items-center gap-1 rounded border border-divider bg-surface px-2 py-0.5"
        class:opacity-40={!s.present}
        title="{s.role}"
      >
        <span class={s.present ? "text-green-600 dark:text-green-400" : "text-faint"}>
          {s.present ? "✓" : "·"}
        </span>
        <span class="text-muted">{s.label}</span>
      </span>
    {/each}
  </div>

  {#if app.busy}
    <p class="text-sm text-faint">Loading chassis…</p>
  {:else}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {#each app.install?.chassisCodes ?? [] as code (code)}
        <button
          class="rounded border border-rule bg-surface px-4 py-3 text-center font-semibold transition hover:border-accent hover:bg-elevated"
          onclick={() => openChassis(code)}
        >
          {code}
        </button>
      {/each}
    </div>
  {/if}
</div>
