<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../lib/state.svelte";
  import {
    isFileSystemAccessSupported,
    loadInstallHandle,
    saveInstallHandle,
    clearInstallHandle,
    queryHandlePermission,
    requestHandlePermission,
  } from "../lib/install-storage";
  import { discoverNcsxInstall } from "../lib/daten-install";

  const supported = isFileSystemAccessSupported();

  let savedHandle = $state<FileSystemDirectoryHandle | null>(null);
  let restoring = $state(false);

  onMount(async () => {
    if (!supported) return;
    const handle = await loadInstallHandle();
    if (!handle) return;
    const perm = await queryHandlePermission(handle);
    if (perm === "granted") {
      restoring = true;
      try {
        await openHandle(handle, { skipSave: true });
      } catch (err) {
        app.error = err instanceof Error ? err.message : String(err);
      } finally {
        restoring = false;
      }
      return;
    }
    if (perm === "denied") {
      await clearInstallHandle();
      return;
    }
    savedHandle = handle;
  });

  async function openHandle(
    handle: FileSystemDirectoryHandle,
    options: { skipSave?: boolean } = {},
  ): Promise<void> {
    const install = await discoverNcsxInstall(handle);
    app.install = install;
    app.view = "browse-chassis";
    if (!options.skipSave) {
      await saveInstallHandle(handle);
    }
  }

  async function pickFolder(): Promise<void> {
    app.error = null;
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      await openHandle(handle);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      app.error = err instanceof Error ? err.message : String(err);
    }
  }

  async function continueLast(): Promise<void> {
    if (!savedHandle) return;
    app.error = null;
    try {
      const perm = await requestHandlePermission(savedHandle);
      if (perm !== "granted") {
        await clearInstallHandle();
        savedHandle = null;
        return;
      }
      await openHandle(savedHandle);
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="flex h-full flex-col items-center justify-center gap-8 p-8">
  <div class="max-w-2xl text-center">
    <h1 class="text-4xl font-bold text-accent">NCSX</h1>
    <p class="mt-2 text-muted">
      BMW NCS Expert coding, in your browser. Friendly checkboxes, no .MAN files.
    </p>
    <!-- Version + GitHub link — same shape as the top-bar pair in
         App.svelte. Visible here so users on the picker (before they
         pick a folder) can find the repo / changelog without
         entering the app. Mirrors inpax-web's welcome screen. -->
    <p class="mt-3 flex items-center justify-center gap-2 text-xs text-faint">
      <a
        href="https://github.com/emdzej/ncsx/releases/tag/{__APP_VERSION__}"
        target="_blank"
        rel="noopener noreferrer"
        class="transition hover:text-foreground"
        title="View release notes on GitHub"
      >
        {__APP_VERSION__}
      </a>
      <a
        href="https://github.com/emdzej/ncsx"
        target="_blank"
        rel="noopener noreferrer"
        class="transition hover:text-foreground"
        title="ncsx on GitHub"
        aria-label="ncsx on GitHub"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
      </a>
    </p>
  </div>

  {#if !supported}
    <div class="max-w-md rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-600/40 dark:bg-red-950/40 dark:text-red-300">
      <strong class="font-semibold">Unsupported browser.</strong>
      NCSX needs the File System Access API (and, later, Web Serial) — both
      Chromium-only. Use Chrome, Edge, or Opera.
    </div>
  {:else if restoring}
    <p class="text-sm text-faint">Restoring last folder…</p>
  {:else if savedHandle}
    <div class="flex flex-col items-center gap-3">
      <button
        class="rounded bg-accent px-6 py-3 font-medium text-white transition hover:bg-accent-muted"
        onclick={continueLast}
      >
        Continue with {savedHandle.name}
      </button>
      <button
        class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
        onclick={pickFolder}
      >
        Pick a different folder
      </button>
    </div>
  {:else}
    <div class="flex max-w-xl flex-col items-stretch gap-4">
      <button
        class="flex flex-col items-center gap-2 rounded border border-rule bg-surface p-4 text-center transition hover:border-accent hover:bg-elevated"
        onclick={pickFolder}
      >
        <span class="font-semibold text-foreground">
          Pick BMW Standard Tools install root
        </span>
        <span class="text-xs text-faint">
          Point us at the folder that contains
          <code class="text-muted">NCSEXPER/</code> and
          <code class="text-muted">EDIABAS/</code>. We'll auto-discover DATEN,
          PFL, A_*.ipo dispatchers, and SGBD files. NCSX remembers it for
          next time.
        </span>
      </button>
      <!-- Keyword-translation hint. NCSX ships a copy of NCSDummy's
           community-maintained `translations.csv` so FSW/PSW
           keywords (`KEYCARDREADER` → "Keycard reader") show in
           English alongside the raw BMW codes. The file is served
           from the app bundle at `/translations.csv` (sourced from
           `apps/ncsx-web/public/translations.csv`). Surfacing this
           in the picker so users know (1) where the translations
           come from, (2) that nothing in their BMW install
           directory is consulted for translation — they're shipped
           with the app and refresh on every release. -->
      <p class="text-center text-xs text-faint">
        Keyword translations (KEYCARDREADER → "Keycard reader" etc.) are
        bundled with the app from the
        <a
          href="https://github.com/Sandr0x/NCSDummy"
          target="_blank"
          rel="noopener noreferrer"
          class="text-muted underline-offset-2 hover:text-foreground hover:underline"
        >NCSDummy community CSV</a>; the BMW install folder isn't
        consulted for them.
      </p>
      <p class="text-center text-xs text-faint">
        All reads are local. Nothing leaves your machine.
      </p>
    </div>
  {/if}

  {#if app.error}
    <div class="max-w-md rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-600/40 dark:bg-red-950/40 dark:text-red-300">
      {app.error}
    </div>
  {/if}
</div>
