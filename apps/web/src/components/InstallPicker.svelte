<script lang="ts">
  /**
   * Install picker — two paths to a mounted install:
   *
   *   1. Pick a local folder (FSA) — wraps the
   *      `FileSystemDirectoryHandle` in an `FsaDirectory` and mounts.
   *      Persists the handle to IndexedDB for restore-on-reload.
   *   2. Mount a remote install URL (HTTP VFS) — `HttpDirectory`
   *      walking a tree of `index.json` listings. Persists the URL
   *      to localStorage for restore-on-reload.
   *
   * Either path ends in `mountInstall(root: VirtualDirectory)` which
   * runs `discoverNcsxInstall`, populates `app.install`, and
   * transitions to the browse view. The third "bundled" source —
   * importing a ZIP via `bimmerz-bundler` — is reserved on the
   * `InstallSource` marker but not wired here yet; add a tile when
   * the bundler ships.
   */
  import { onMount } from "svelte";
  import { app } from "../lib/state.svelte";
  import { FsaDirectory, HttpDirectory, type VirtualDirectory } from "@emdzej/bimmerz-vfs";
  import {
    isFileSystemAccessSupported,
    loadInstallHandle,
    saveInstallHandle,
    clearInstallHandle,
    queryHandlePermission,
    requestHandlePermission,
    loadRemoteInstallUrl,
    saveRemoteInstallUrl,
    clearRemoteInstallUrl,
  } from "../lib/install-storage";
  import {
    getInstallSource,
    setInstallSource,
    clearInstallSource,
  } from "../lib/bundled-install";
  import { discoverNcsxInstall } from "../lib/daten-install";

  const supported = isFileSystemAccessSupported();

  let savedHandle = $state<FileSystemDirectoryHandle | null>(null);
  let savedRemoteUrl = $state<string | null>(null);
  let restoring = $state(false);
  /** Remote-URL input field in the "mount remote" tile. */
  let remoteUrl = $state("");

  onMount(async () => {
    /* Restore order matters: try remote first (URL-based, cheap),
       then FSA (needs permission grant on user gesture). If neither
       restores cleanly we fall through to the picker tiles. */
    const remembered = loadRemoteInstallUrl();
    if (remembered) {
      restoring = true;
      try {
        await mountRemote(remembered, { skipSave: true });
        return;
      } catch (err) {
        app.error = err instanceof Error ? err.message : String(err);
        /* Keep the URL in the input so the user can edit + retry
           rather than re-type the whole thing. */
        remoteUrl = remembered;
        savedRemoteUrl = remembered;
      } finally {
        restoring = false;
      }
    }

    if (!supported) return;
    const handle = await loadInstallHandle();
    if (!handle) return;
    const perm = await queryHandlePermission(handle);
    if (perm === "granted") {
      restoring = true;
      try {
        await mountFsaHandle(handle, { skipSave: true });
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

  /**
   * Common mount path — runs install discovery on a `VirtualDirectory`
   * and transitions the app view. Both FSA + remote paths funnel
   * through here so the post-mount housekeeping (`app.installSource`,
   * `app.view`) lives in one place.
   */
  async function mountInstall(root: VirtualDirectory): Promise<void> {
    const install = await discoverNcsxInstall(root);
    app.install = install;
    app.view = "browse-chassis";
    /* Mirror the (now-current) source marker into reactive app state
       so the top-bar pill updates without a reload. */
    app.installSource = getInstallSource();
  }

  async function mountFsaHandle(
    handle: FileSystemDirectoryHandle,
    options: { skipSave?: boolean } = {},
  ): Promise<void> {
    await mountInstall(new FsaDirectory(handle));
    if (!options.skipSave) {
      await saveInstallHandle(handle);
      clearRemoteInstallUrl();
    }
    /* The source marker reflects WHAT the install is, not whether
       we're saving on first pick — so write it on both the
       first-pick and restore-on-reload paths. Without this the
       restore path mounts the install but leaves `installSource`
       null, which surfaces as a "?" pill in the top bar. */
    setInstallSource({ source: "fs-access" });
    app.installSource = getInstallSource();
  }

  async function mountRemote(
    url: string,
    options: { skipSave?: boolean } = {},
  ): Promise<void> {
    const root = new HttpDirectory(url);
    await mountInstall(root);
    if (!options.skipSave) {
      saveRemoteInstallUrl(url);
      /* Switching to a remote install supersedes any prior FSA
         pick — clear the saved handle so a reload comes back here
         instead of prompting for permission against a stale folder. */
      await clearInstallHandle();
    }
    setInstallSource({ source: "remote" });
    app.installSource = getInstallSource();
  }

  async function pickFolder(): Promise<void> {
    app.error = null;
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      await mountFsaHandle(handle);
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
      await mountFsaHandle(savedHandle);
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    }
  }

  async function submitRemote(): Promise<void> {
    const url = remoteUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      app.error = "Remote install URL must start with http:// or https://";
      return;
    }
    app.error = null;
    try {
      await mountRemote(url);
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    }
  }

  function dismissSavedRemote(): void {
    savedRemoteUrl = null;
    clearRemoteInstallUrl();
    clearInstallSource();
    app.installSource = null;
    remoteUrl = "";
  }
</script>

<div class="flex h-full flex-col items-center justify-center gap-8 p-8">
  <div class="max-w-2xl text-center">
    <h1 class="text-4xl font-bold text-accent">NCSX</h1>
    <p class="mt-2 text-muted">
      BMW NCS Expert coding, in your browser. Friendly checkboxes, no .MAN files.
    </p>
    <!-- Version + GitHub link. -->
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

  {#if restoring}
    <p class="text-sm text-faint">Restoring last install…</p>
  {:else if savedHandle && !savedRemoteUrl}
    <div class="flex flex-col items-center gap-3">
      <button
        class="rounded bg-accent px-6 py-3 font-medium text-white transition hover:bg-accent-muted"
        onclick={continueLast}
      >
        Continue with {savedHandle.name}
      </button>
      <button
        class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
        onclick={() => (savedHandle = null)}
      >
        Pick a different install
      </button>
    </div>
  {:else}
    <div class="flex w-full max-w-2xl flex-col items-stretch gap-3">
      {#if savedRemoteUrl}
        <!-- Restore-failed banner — the URL we tried is in the
             input below; user can edit + retry, or dismiss to start
             fresh. -->
        <div class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-600/40 dark:bg-amber-950/40 dark:text-amber-300">
          Couldn't reach <code class="font-mono">{savedRemoteUrl}</code>.
          Edit the URL below and re-mount, or
          <button class="underline-offset-2 hover:underline" onclick={dismissSavedRemote}>
            forget the saved URL
          </button>.
        </div>
      {/if}

      {#if supported}
        <button
          class="flex flex-col items-center gap-2 rounded border border-rule bg-surface p-4 text-center transition hover:border-accent hover:bg-elevated"
          onclick={pickFolder}
        >
          <span class="font-semibold text-foreground">
            Pick BMW Standard Tools install folder
          </span>
          <span class="text-xs text-faint">
            Point us at the folder containing
            <code class="text-muted">NCSEXPER/</code> and
            <code class="text-muted">EDIABAS/</code>. Auto-discovers DATEN,
            SGDAT, PFL, and SGBDs. NCSX remembers it for next time.
            <span class="block mt-1 italic">Local — nothing leaves your machine.</span>
          </span>
        </button>
      {:else}
        <div class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-600/40 dark:bg-amber-950/40 dark:text-amber-300">
          <strong>Local folder picker unavailable.</strong> The File System
          Access API is Chromium-only — use Chrome, Edge, or Opera to pick a
          local install. Mount-by-URL works on any browser.
        </div>
      {/if}

      <div class="rounded border border-rule bg-surface p-4">
        <div class="font-semibold text-foreground text-center">
          Mount a remote install
        </div>
        <p class="mt-1 text-center text-xs text-faint">
          Point us at a tree of <code class="text-muted">index.json</code>
          listings served over HTTP — generate one with
          <code class="text-muted">bimmerz data index</code> against your
          BMW Standard Tools install. Works on any browser; no permission
          grant needed.
        </p>
        <div class="mt-3 flex items-stretch gap-2">
          <input
            type="url"
            class="flex-1 rounded border border-rule bg-base px-2 py-1.5 font-mono text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
            placeholder="https://my-installs.example.com/bmw-standard-tools/"
            bind:value={remoteUrl}
            onkeydown={(e) => e.key === 'Enter' && submitRemote()}
          />
          <button
            class="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!remoteUrl.trim()}
            onclick={submitRemote}
          >
            Mount
          </button>
        </div>
      </div>

      <p class="mt-1 text-center text-xs text-faint">
        Keyword translations (KEYCARDREADER → "Keycard reader" etc.) are
        bundled with the app from the
        <a
          href="https://github.com/Sandr0x/NCSDummy"
          target="_blank"
          rel="noopener noreferrer"
          class="text-muted underline-offset-2 hover:text-foreground hover:underline"
        >NCSDummy community CSV</a>; your install folder isn't consulted
        for them.
      </p>
    </div>
  {/if}

  {#if app.error}
    <div class="max-w-md rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-600/40 dark:bg-red-950/40 dark:text-red-300">
      {app.error}
    </div>
  {/if}
</div>
