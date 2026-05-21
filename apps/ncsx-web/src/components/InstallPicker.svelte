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
    <p class="mt-3 text-xs text-faint">{__APP_VERSION__}</p>
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
