<script lang="ts">
  // Thin wrapper bridging ncsx's connection state to the shared
  // <ConnectButton> from @emdzej/ediabasx-web-ui. The bespoke fallback
  // ("No EDIABAS/Ecu" when no install is picked) stays here as a
  // ncsx-specific affordance — the shared button is for the actual
  // connect/connecting/error/connected states.
  import { ConnectButton as SharedConnectButton, type ConnectionPhase } from "@emdzej/ediabasx-web-ui";
  import { connect, disconnect, connection } from "../lib/ediabas-session.svelte";
  import { app } from "../lib/state.svelte";

  const haveEcuDir = $derived(app.install?.ediabasEcu != null);

  /** Map the session's discriminated-union status to the shared button's flat phase. */
  const phase = $derived<ConnectionPhase>(
    connection.status.kind === "connected"
      ? "connected"
      : connection.status.kind === "connecting"
        ? "connecting"
        : connection.status.kind === "error"
          ? "error"
          : "disconnected",
  );

  const message = $derived(
    connection.status.kind === "connected"
      ? `Connected · ${connection.status.portInfo}`
      : connection.status.kind === "connecting"
        ? "Connecting…"
        : connection.status.kind === "error"
          ? connection.status.message
          : "Not connected",
  );
  const errorMessage = $derived(
    connection.status.kind === "error" ? connection.status.message : undefined,
  );
</script>

{#if haveEcuDir}
  <SharedConnectButton
    {phase}
    {message}
    {errorMessage}
    idleTitle="Connect to ECU via the configured interface"
    onconnect={connect}
    ondisconnect={disconnect}
  />
{:else}
  <span class="text-xs text-faint" title="Pick an install with an EDIABAS/Ecu folder to enable">
    No EDIABAS/Ecu
  </span>
{/if}
