<script lang="ts">
  import {
    connectWebSerial,
    disconnect,
    connection,
  } from "../lib/ediabas-session.svelte";
  import { app } from "../lib/state.svelte";

  const haveEcuDir = $derived(app.install?.ediabasEcu != null);

  async function onConnect(): Promise<void> {
    await connectWebSerial();
  }

  async function onDisconnect(): Promise<void> {
    await disconnect();
  }
</script>

{#if connection.status.kind === "connected"}
  <button
    class="flex items-center gap-1.5 rounded border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs text-green-700 transition hover:border-green-500 hover:bg-green-500/20 dark:text-green-400"
    title="Click to disconnect — {connection.status.portInfo}"
    onclick={onDisconnect}
  >
    <span aria-hidden="true">●</span>
    Disconnect
  </button>
{:else if connection.status.kind === "connecting"}
  <span class="text-xs text-faint">Connecting…</span>
{:else if connection.status.kind === "error"}
  <button
    class="flex items-center gap-1.5 rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-700 transition hover:border-red-500 hover:bg-red-500/20 dark:text-red-400"
    title={connection.status.message}
    onclick={onConnect}
  >
    <span aria-hidden="true">●</span>
    Connection error — retry
  </button>
{:else if haveEcuDir}
  <button
    class="rounded border border-divider bg-surface px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:bg-elevated"
    onclick={onConnect}
    title="Connect to ECU via Web Serial"
  >
    Connect
  </button>
{:else}
  <span class="text-xs text-faint" title="Pick an install with an EDIABAS/Ecu folder to enable">
    No EDIABAS/Ecu
  </span>
{/if}
