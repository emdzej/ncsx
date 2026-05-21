<script lang="ts">
  import {
    isSecureContext,
    isWebSerialSupported,
    resetConfig,
    saveConfig,
    type InterfaceType,
  } from "../lib/config";
  import {
    clearInstallHandle,
    saveInstallHandle,
  } from "../lib/install-storage";
  import { discoverNcsxInstall } from "../lib/daten-install";
  import { app } from "../lib/state.svelte";

  /**
   * Persist on every config mutation. We could debounce but the writes are tiny and
   * the user closes the dialog right after — simpler to flush eagerly so reload is
   * always a true round-trip of what was on screen.
   */
  $effect(() => {
    saveConfig(app.config);
  });

  function close(): void {
    app.showSettings = false;
  }

  function reset(): void {
    app.config = resetConfig();
  }

  function setInterface(value: InterfaceType): void {
    app.config = { ...app.config, interface: value };
  }

  /**
   * Inputs are bound directly to `app.config.serial.*` via deep-write helpers — Svelte 5
   * runes propagate per-field changes. We keep `serial` defined (with all fields) so the
   * UI never has to ?? defaults inline.
   */
  function bindSerial<K extends keyof NonNullable<typeof app.config.serial>>(
    key: K,
  ): NonNullable<typeof app.config.serial>[K] {
    return app.config.serial?.[key] as NonNullable<typeof app.config.serial>[K];
  }

  function setSerial<K extends keyof NonNullable<typeof app.config.serial>>(
    key: K,
    value: NonNullable<typeof app.config.serial>[K],
  ): void {
    app.config = {
      ...app.config,
      serial: { ...(app.config.serial ?? {}), [key]: value },
    };
  }

  function setGatewayUrl(url: string): void {
    app.config = { ...app.config, gateway: { ...(app.config.gateway ?? {}), url } };
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
  }

  async function forgetInstall(): Promise<void> {
    await clearInstallHandle();
    app.install = null;
    clearDerivedInstallState();
    app.view = "picker";
    app.showSettings = false;
  }

  async function changeInstall(): Promise<void> {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      const install = await discoverNcsxInstall(handle);
      app.install = install;
      clearDerivedInstallState();
      await saveInstallHandle(handle);
      app.view = "browse-chassis";
      app.showSettings = false;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      app.error = err instanceof Error ? err.message : String(err);
    }
  }

  const webSerialAvailable = $derived(isWebSerialSupported());
  const secure = $derived(isSecureContext());
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
      class="w-full max-w-xl rounded border border-rule bg-surface shadow-2xl"
      role="document"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      tabindex="-1"
    >
      <header class="flex items-baseline justify-between gap-4 border-b border-divider px-4 py-3">
        <h2 class="text-sm font-bold uppercase tracking-wider text-muted">Settings</h2>
        <button
          class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
          onclick={close}
        >
          close
        </button>
      </header>

      <section class="space-y-4 px-4 py-4 text-sm text-foreground">
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

        <!-- Interface -->
        <div>
          <label for="iface" class="mb-1 block text-xs font-semibold uppercase tracking-wider text-faint">Interface</label>
          <select
            id="iface"
            class="w-full rounded border border-rule bg-base px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
            value={app.config.interface}
            onchange={(e) => setInterface((e.currentTarget as HTMLSelectElement).value as InterfaceType)}
          >
            <option value="webserial">Web Serial (USB cable)</option>
            <option value="gateway">Gateway (remote ediabasx server)</option>
          </select>
          {#if app.config.interface === "webserial" && !webSerialAvailable}
            <p class="mt-1 text-xs text-red-500">
              Web Serial is not available in this browser. Use Chrome / Edge / Opera on
              desktop, served over HTTPS or localhost.
            </p>
          {/if}
        </div>

        <!-- Web Serial config -->
        {#if app.config.interface === "webserial"}
          <fieldset class="space-y-3 rounded border border-divider bg-base p-3">
            <legend class="px-1 text-xs font-semibold uppercase tracking-wider text-faint">
              Serial parameters
            </legend>
            <div class="grid grid-cols-2 gap-3">
              <label class="text-xs text-muted">
                Baud
                <input
                  type="number"
                  class="mt-0.5 w-full rounded border border-rule bg-surface px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                  value={bindSerial("baudRate")}
                  oninput={(e) =>
                    setSerial("baudRate", Number((e.currentTarget as HTMLInputElement).value) || 115200)}
                />
              </label>
              <label class="text-xs text-muted">
                Timeout (ms)
                <input
                  type="number"
                  class="mt-0.5 w-full rounded border border-rule bg-surface px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                  value={bindSerial("timeoutMs")}
                  oninput={(e) =>
                    setSerial("timeoutMs", Number((e.currentTarget as HTMLInputElement).value) || 5000)}
                />
              </label>
              <label class="text-xs text-muted">
                Data bits
                <select
                  class="mt-0.5 w-full rounded border border-rule bg-surface px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                  value={String(bindSerial("dataBits"))}
                  onchange={(e) =>
                    setSerial("dataBits", Number((e.currentTarget as HTMLSelectElement).value) as 7 | 8)}
                >
                  <option value="8">8</option>
                  <option value="7">7</option>
                </select>
              </label>
              <label class="text-xs text-muted">
                Parity
                <select
                  class="mt-0.5 w-full rounded border border-rule bg-surface px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                  value={bindSerial("parity")}
                  onchange={(e) =>
                    setSerial("parity", (e.currentTarget as HTMLSelectElement).value as "none" | "even" | "odd")}
                >
                  <option value="none">none</option>
                  <option value="even">even</option>
                  <option value="odd">odd</option>
                </select>
              </label>
              <label class="text-xs text-muted">
                Stop bits
                <select
                  class="mt-0.5 w-full rounded border border-rule bg-surface px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
                  value={String(bindSerial("stopBits"))}
                  onchange={(e) =>
                    setSerial("stopBits", Number((e.currentTarget as HTMLSelectElement).value) as 1 | 2)}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </label>
              <label class="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  class="rounded border-rule"
                  checked={bindSerial("probeAdapterOnConnect") ?? true}
                  onchange={(e) =>
                    setSerial("probeAdapterOnConnect", (e.currentTarget as HTMLInputElement).checked)}
                />
                Probe K+DCAN adapter on connect
              </label>
            </div>
            <p class="text-xs text-faint">
              Defaults match the K+DCAN cable consensus (115200, 8N1, fast init).
              Disable the probe when working with a passthrough FTDI cable that
              doesn't speak the K+DCAN telegrams.
            </p>
          </fieldset>
        {/if}

        <!-- Gateway config -->
        {#if app.config.interface === "gateway"}
          <fieldset class="space-y-2 rounded border border-divider bg-base p-3">
            <legend class="px-1 text-xs font-semibold uppercase tracking-wider text-faint">
              Gateway
            </legend>
            <label class="text-xs text-muted">
              WebSocket URL
              <input
                type="text"
                placeholder="ws://localhost:6801"
                class="mt-0.5 w-full rounded border border-rule bg-surface px-2 py-1 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
                value={app.config.gateway?.url ?? ""}
                oninput={(e) => setGatewayUrl((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            {#if !secure && app.config.gateway?.url?.startsWith("ws://")}
              <p class="text-xs text-amber-500">
                ⚠ Page loaded over HTTPS — browsers refuse plain <code>ws://</code>.
                Use <code>wss://</code> or load this page over <code>http://localhost</code>.
              </p>
            {/if}
            <p class="text-xs text-faint">
              Run <code>ediabasx gateway --transport websocket</code> on the machine
              that owns the cable; point this URL at it.
            </p>
          </fieldset>
        {/if}
      </section>

      <footer class="flex items-center justify-between gap-2 border-t border-divider bg-elevated/50 px-4 py-2">
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
