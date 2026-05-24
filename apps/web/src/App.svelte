<script lang="ts">
  import { onMount } from "svelte";
  import { getLogger } from "@emdzej/bimmerz-logger";
  import { parseTranslationsCsv } from "@emdzej/ncsx-translations";
  import { app } from "./lib/state.svelte";

  const log = getLogger("NCSX.web");
  import InstallPicker from "./components/InstallPicker.svelte";
  import ChassisList from "./components/ChassisList.svelte";
  import ModuleList from "./components/ModuleList.svelte";
  import FunctionTree from "./components/FunctionTree.svelte";
  import ErrorBanner from "./components/ErrorBanner.svelte";
  import ConnectButton from "./components/ConnectButton.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";
  import IdentityPanel from "./components/IdentityPanel.svelte";
  import FaEditorDialog from "./components/FaEditorDialog.svelte";
  import ZcsEditorDialog from "./components/ZcsEditorDialog.svelte";
  import PatchDialog from "./components/PatchDialog.svelte";
  import AboutDialog from "./components/AboutDialog.svelte";

  // Load the community-maintained translation dictionary on app boot. Vite serves
  // `/translations.csv` from `apps/web/public/`. The CSV is ~1 MB but parses in
  // ~30 ms in tests; we fire-and-forget so the install picker shows immediately.
  onMount(async () => {
    try {
      const res = await fetch("/translations.csv");
      if (!res.ok) return;
      app.translations = parseTranslationsCsv(await res.text());
    } catch (err) {
      // Translations are nice-to-have, not required. Log to console and move on.
      log.warn({ err }, "failed to load translations.csv");
    }
  });

  function home(): void {
    app.view = app.install ? "browse-chassis" : "picker";
    app.chassis = null;
    app.selectedSg = null;
    app.selectedModule = null;
    app.functionList = null;
    app.lastReadNetto = null;
    app.availableJobs = null;
    app.identity = null;
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
      <!-- Build version surfaced from package.json via Vite `define`.
           Clicking opens the About dialog, which surfaces ncsx /
           ediabasx / inpax versions (each linked to their release tag)
           and a "Report an issue" link. Faint styling keeps it as
           metadata, not chrome. -->
      <button
        class="text-xs text-faint underline-offset-2 transition hover:text-foreground hover:underline"
        onclick={() => (app.showAbout = true)}
        title="About NCSX — versions, source, report an issue"
      >
        {__APP_VERSION__}
      </button>
      <!-- GitHub repo link. The 16×16 mark is GitHub's official
           public-domain octocat SVG (https://github.com/logos); we
           inline rather than reference an asset so the icon is
           theme-coloured (`currentColor`) and renders before any
           network fetch. `noopener noreferrer` is standard hygiene
           for `target="_blank"`. -->
      <a
        href="https://github.com/emdzej/ncsx"
        target="_blank"
        rel="noopener noreferrer"
        class="text-faint transition hover:text-foreground"
        title="ncsx on GitHub"
        aria-label="ncsx on GitHub"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
      </a>
      <span class="flex-1"></span>
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
    {#if app.chassis && (app.view === "browse-modules" || app.view === "view-module")}
      <!--
        Identity (VIN / FA / ZCS) stays visible once a chassis is loaded, across both
        the module-list and the per-module FunctionTree views — same source-ECU readback
        regardless of which screen the user is on. Constrained to the same `max-w` as
        the views below so the layout reads as a stacked column rather than a banner.
      -->
      <div class="mx-auto max-w-5xl p-6 pb-0">
        <IdentityPanel />
      </div>
    {/if}
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
  <FaEditorDialog />
  <ZcsEditorDialog />
  <PatchDialog />
  <AboutDialog />
</div>
