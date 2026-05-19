<script lang="ts">
  import { onMount } from "svelte";
  import { parseTranslationsCsv } from "@emdzej/ncsx-translations";
  import { app } from "./lib/state.svelte";
  import InstallPicker from "./components/InstallPicker.svelte";
  import ChassisList from "./components/ChassisList.svelte";
  import ModuleList from "./components/ModuleList.svelte";
  import FunctionTree from "./components/FunctionTree.svelte";
  import ErrorBanner from "./components/ErrorBanner.svelte";
  import ConnectButton from "./components/ConnectButton.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";

  // Load the community-maintained translation dictionary on app boot. Vite serves
  // `/translations.csv` from `apps/ncsx-web/public/`. The CSV is ~1 MB but parses in
  // ~30 ms in tests; we fire-and-forget so the install picker shows immediately.
  onMount(async () => {
    try {
      const res = await fetch("/translations.csv");
      if (!res.ok) return;
      app.translations = parseTranslationsCsv(await res.text());
    } catch (err) {
      // Translations are nice-to-have, not required. Log to console and move on.
      console.warn("[ncsx-web] failed to load translations.csv:", err);
    }
  });

  function home(): void {
    app.view = app.install ? "browse-chassis" : "picker";
    app.chassis = null;
    app.selectedSg = null;
    app.selectedModule = null;
    app.functionList = null;
    app.lastReadNetto = null;
  }
</script>

<div class="flex h-full flex-col bg-base text-foreground">
  {#if app.view !== "picker"}
    <header class="flex items-center gap-4 border-b border-divider bg-surface px-4 py-2 text-sm">
      <button
        class="font-semibold text-accent transition hover:text-accent-muted"
        onclick={home}
      >
        NCSX
      </button>
      <span class="text-xs text-faint">{__APP_VERSION__}</span>
      <span class="flex-1"></span>
      {#if app.translations}
        <span
          class="text-xs text-faint"
          title="Community-maintained keyword translations from NCSDummy"
        >
          {app.translations.entries.size.toLocaleString()} translations
        </span>
      {/if}
      {#if app.install}
        <span class="text-xs text-faint">
          {app.install.root.name}
        </span>
      {/if}
      <button
        class="rounded border border-divider bg-surface px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:bg-elevated"
        onclick={() => (app.showSettings = true)}
        title="Configure interface, serial parameters, gateway URL"
      >
        Settings
      </button>
      <ConnectButton />
    </header>
  {/if}

  <main class="flex-1 overflow-y-auto">
    {#if app.view === "picker"}
      <InstallPicker />
    {:else if app.view === "browse-chassis"}
      <ChassisList />
    {:else if app.view === "browse-modules"}
      <ModuleList />
    {:else if app.view === "view-module"}
      <FunctionTree />
    {/if}
  </main>

  <ErrorBanner />
  <SettingsDialog />
</div>
