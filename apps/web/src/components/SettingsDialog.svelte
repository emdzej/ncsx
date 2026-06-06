<script lang="ts">
  import {
    LOG_LEVELS,
    resetConfig,
    saveConfig,
    type LogLevel,
  } from "../lib/config";
  import {
    InterfaceConfigPanel,
    ModeConfigPanel,
    ServerConfigPanel,
    ConnectConfigPanel,
  } from "@emdzej/ediabasx-web-ui";
  import {
    clearInstallHandle,
    saveInstallHandle,
    clearRemoteInstallUrl,
  } from "../lib/install-storage";
  import { clearInstallSource, setInstallSource } from "../lib/bundled-install";
  import { FsaDirectory } from "@emdzej/bimmerz-vfs";
  import { discoverNcsxInstall } from "../lib/daten-install";
  import { app } from "../lib/state.svelte";
  import { applyLoggerConfig } from "../lib/logger-wiring";
  import { LOG_CATEGORIES as NCSX_LOG_CATEGORIES } from "@emdzej/ncsx-chassis";
  import { LOG_CATEGORIES as INPAX_LOG_CATEGORIES } from "@emdzej/inpax-interpreter";
  import { LOG_CATEGORIES as EDIABASX_LOG_CATEGORIES } from "@emdzej/ediabasx-ediabas";

  /**
   * Categories surfaced as per-row controls. Three sources composed
   * — apps don't hardcode the list, so adding a new category in any
   * upstream library automatically shows up here on the next install:
   *
   * - `@emdzej/ncsx-chassis` — NCSX.* tree (this app's surface).
   * - `@emdzej/inpax-interpreter` — INPAX.* tree (the IPO VM that
   *   runs the per-CABD `A_*.IPO` dispatchers).
   * - `@emdzej/ediabasx-ediabas` — EDIABASX.* tree (the BEST/2
   *   interpreter the IPO dispatches into).
   */
  const KNOWN_LOG_CATEGORIES = [
    ...NCSX_LOG_CATEGORIES,
    ...INPAX_LOG_CATEGORIES,
    ...EDIABASX_LOG_CATEGORIES,
  ];

  /**
   * Persist on every config mutation. We could debounce but the writes are tiny and
   * the user closes the dialog right after — simpler to flush eagerly so reload is
   * always a true round-trip of what was on screen.
   */
  $effect(() => {
    saveConfig(app.config);
  });

  /**
   * Re-apply the bimmerz-logger central config whenever the user
   * tweaks Settings. Existing logger handles are proxies, so changes
   * here take effect immediately on the next log call across the
   * whole app — no component refresh needed.
   */
  $effect(() => {
    applyLoggerConfig(app.config.logging);
  });

  function setLogLevel(value: LogLevel): void {
    app.config.logging = { ...(app.config.logging ?? {}), level: value };
  }

  function setCategoryLevel(name: string, value: LogLevel | ""): void {
    const next = { ...(app.config.logging?.categories ?? {}) };
    if (value === "") {
      delete next[name];
    } else {
      next[name] = value;
    }
    app.config.logging = {
      ...(app.config.logging ?? {}),
      categories: Object.keys(next).length > 0 ? next : undefined,
    };
  }

  function close(): void {
    app.showSettings = false;
  }

  function reset(): void {
    app.config = resetConfig();
  }

  /**
   * Reset everything that depends on the picked install — chassis,
   * selected module, function list, last-read netto, identity. We
   * clear them all in one place so "Forget" / "Change folder" land
   * the app in a clean state regardless of where the user was.
   */
  function clearDerivedInstallState(): void {
    app.chassis = null;
    app.identity = null;
    app.selectedSg = null;
    app.selectedModule = null;
    app.functionList = null;
    app.lastReadNetto = null;
    app.availableJobs = null;
  }

  async function forgetInstall(): Promise<void> {
    await clearInstallHandle();
    /* Forget across all three source paths — the remote URL marker
       lived independently and used to survive "Forget" silently
       re-mounting the same remote on next load. */
    clearRemoteInstallUrl();
    clearInstallSource();
    app.install = null;
    app.installSource = null;
    clearDerivedInstallState();
    app.view = "picker";
    app.showSettings = false;
  }

  async function changeInstall(): Promise<void> {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      /* Wrap in FsaDirectory so the install discovery + downstream
         readers all see one `VirtualDirectory` shape regardless of
         whether the user picks local or mounts remote. */
      const install = await discoverNcsxInstall(new FsaDirectory(handle));
      app.install = install;
      clearDerivedInstallState();
      await saveInstallHandle(handle);
      /* Picking a new folder supersedes any prior remote-URL pin. */
      clearRemoteInstallUrl();
      setInstallSource({ source: "fs-access" });
      app.installSource = { source: "fs-access" };
      app.view = "browse-chassis";
      app.showSettings = false;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      app.error = err instanceof Error ? err.message : String(err);
    }
  }

  // Tabs — keeps the dialog scannable. "Connection" is what
  // most users want most of the time, so it's the default.
  type Tab = "connection" | "data" | "developer";
  let activeTab = $state<Tab>("connection");
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "connection", label: "Connection" },
    { id: "data", label: "Data" },
    { id: "developer", label: "Developer" },
  ];
</script>

{#if app.showSettings}
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    onclick={close}
    onkeydown={(e) => e.key === "Escape" && close()}
    tabindex="-1"
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="flex max-h-[90vh] w-full max-w-xl flex-col rounded border border-rule bg-surface shadow-2xl"
      role="document"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      tabindex="-1"
    >
      <header class="flex shrink-0 items-baseline justify-between gap-4 border-b border-divider px-4 py-3">
        <h2 class="text-sm font-bold uppercase tracking-wider text-muted">Settings</h2>
        <button
          class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
          onclick={close}
        >
          close
        </button>
      </header>

      <!-- Tab strip. Mirrors the inpax-web pattern — flat row with an
           accent underline under the active tab. -->
      <div class="flex shrink-0 gap-1 border-b border-divider px-2" role="tablist">
        {#each tabs as tab (tab.id)}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            class="border-b-2 px-3 py-2 text-xs font-medium uppercase tracking-wider transition"
            class:border-accent={activeTab === tab.id}
            class:text-accent={activeTab === tab.id}
            class:border-transparent={activeTab !== tab.id}
            class:text-muted={activeTab !== tab.id}
            class:hover:text-foreground={activeTab !== tab.id}
            onclick={() => (activeTab = tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>

      <section class="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm text-foreground">
        {#if activeTab === "connection"}
        <!-- Mode toggle — embedded (local cable) vs client (remote
             ediabasx-server via WebSocket or Bimmerz Connect relay).
             The fieldsets below branch on this. -->
        <ModeConfigPanel bind:config={app.config} />

        {#if app.config.mode === "client"}
          <!-- Client mode: direct WebSocket vs Bimmerz Connect relay,
               plus the relevant URL field. The session-token blob
               for Bimmerz Connect is prompted by ConnectSessionDialog
               on Connect — transient, never persisted to settings. -->
          <ConnectConfigPanel bind:config={app.config} />
          <ServerConfigPanel bind:config={app.config} />
        {:else}
          <!-- Embedded mode: pick a local EDIABAS interface. Shared
               across the bimmerz family via @emdzej/ediabasx-web-ui. -->
          <InterfaceConfigPanel bind:config={app.config} />
        {/if}


        {:else if activeTab === "data"}
          <!-- Install root —
               surfaces the picked BMW Standard Tools folder + lets the user
               swap it (e.g. moved the install) or forget the saved handle
               entirely (handy when the saved folder is gone). -->
          <div>
            <span class="mb-1 block text-xs font-semibold uppercase tracking-wider text-faint">
              Install
            </span>
            <div class="flex items-center justify-between gap-2 rounded border border-divider bg-base px-3 py-2">
              <span class="truncate text-sm">
                {#if app.install}
                  <span class="font-mono text-foreground">{app.install.root.name}</span>
                  <span class="ml-2 text-xs text-faint">
                    · {app.install.chassisCodes.length} chassis declared
                  </span>
                {:else}
                  <span class="italic text-faint">(no install picked)</span>
                {/if}
              </span>
              <div class="flex shrink-0 items-center gap-3">
                <button
                  class="rounded border border-rule px-2 py-0.5 text-xs text-muted hover:bg-elevated hover:text-foreground"
                  onclick={changeInstall}
                  title="Pick a different install folder (will replace the saved one)"
                >
                  Change folder…
                </button>
                <button
                  class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={forgetInstall}
                  disabled={!app.install}
                  title="Drop the remembered install handle and return to the picker"
                >
                  Forget
                </button>
              </div>
            </div>
          </div>

        {:else if activeTab === "developer"}
        <!-- Logging — bimmerz-logger central config -->
        <fieldset class="space-y-2 rounded border border-divider bg-base p-3">
          <legend class="px-1 text-xs font-semibold uppercase tracking-wider text-faint">
            Logging
          </legend>
          <label class="text-xs text-muted">
            Default level
            <select
              class="mt-0.5 w-full rounded border border-rule bg-surface px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
              value={app.config.logging?.level ?? "info"}
              onchange={(e) => setLogLevel((e.currentTarget as HTMLSelectElement).value as LogLevel)}
            >
              {#each LOG_LEVELS as lvl (lvl)}
                <option value={lvl}>{lvl}</option>
              {/each}
            </select>
            <span class="mt-1 block text-faint">
              Applies to every category without a specific rule below.
            </span>
          </label>

          <div class="pt-1">
            <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
              Category overrides
            </p>
            <p class="mb-2 text-xs text-faint">
              Hierarchical — a rule for <code>NCSX</code> covers every
              <code>NCSX.*</code> child unless something more specific
              matches. <code>INPAX.*</code> + <code>EDIABASX.*</code>
              trees are exposed too because this app embeds both
              libraries.
            </p>
            <ul class="space-y-1.5">
              {#each KNOWN_LOG_CATEGORIES as cat (cat.name)}
                {@const current = app.config.logging?.categories?.[cat.name] ?? ""}
                <li class="grid grid-cols-[1fr_8rem] items-baseline gap-2">
                  <div class="min-w-0">
                    <code class="text-xs text-foreground">{cat.name}</code>
                    {#if cat.hint}
                      <p class="text-xs text-faint">{cat.hint}</p>
                    {/if}
                  </div>
                  <select
                    class="rounded border border-rule bg-surface px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
                    value={current}
                    onchange={(e) =>
                      setCategoryLevel(
                        cat.name,
                        (e.currentTarget as HTMLSelectElement).value as LogLevel | "",
                      )}
                  >
                    <option value="">(inherit)</option>
                    {#each LOG_LEVELS as lvl (lvl)}
                      <option value={lvl}>{lvl}</option>
                    {/each}
                  </select>
                </li>
              {/each}
            </ul>
          </div>
        </fieldset>
        {/if}
      </section>

      <footer class="flex shrink-0 items-center justify-between gap-2 border-t border-divider bg-elevated/50 px-4 py-2">
        <button
          class="rounded border border-rule px-2 py-0.5 text-xs text-muted hover:bg-elevated hover:text-foreground"
          onclick={reset}
          title="Reset to default config (does not affect picked install)"
        >
          Reset to defaults
        </button>
        <button
          class="rounded bg-accent px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-accent-muted"
          onclick={close}
        >
          Done
        </button>
      </footer>
    </div>
  </div>
{/if}
