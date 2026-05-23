<script lang="ts">
  import { app } from "../lib/state.svelte";

  function close(): void {
    app.showAbout = false;
  }
</script>

{#if app.showAbout}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={close}
    onkeydown={(e) => e.key === "Escape" && close()}
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="w-full max-w-md rounded border border-rule bg-surface shadow-2xl"
      role="document"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="flex items-baseline justify-between gap-4 border-b border-divider px-4 py-3">
        <h2 class="text-sm font-bold uppercase tracking-wider text-muted">About NCSX</h2>
        <button
          class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
          onclick={close}
        >
          close
        </button>
      </header>

      <section class="space-y-3 px-4 py-4 text-sm text-foreground">
        <p class="text-faint">
          BMW NCS Expert in your browser. Read coding, edit FSW/PSW, write back over
          Web Serial.
        </p>

        <!-- Versions block. ncsx is the app itself; ediabasx + inpax are the engine
             stack underneath. Linking to each release tag means the user can pop the
             matching changelog with one click. -->
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded border border-divider bg-base p-3 text-xs">
          <dt class="font-mono text-faint">ncsx</dt>
          <dd>
            <a
              href="https://github.com/emdzej/ncsx/releases/tag/{__APP_VERSION__}"
              target="_blank"
              rel="noopener noreferrer"
              class="font-mono text-foreground underline-offset-2 hover:text-accent hover:underline"
            >
              {__APP_VERSION__}
            </a>
          </dd>
          <dt class="font-mono text-faint">ediabasx</dt>
          <dd>
            <a
              href="https://github.com/emdzej/ediabasx/releases/tag/{__EDIABASX_VERSION__}"
              target="_blank"
              rel="noopener noreferrer"
              class="font-mono text-foreground underline-offset-2 hover:text-accent hover:underline"
            >
              {__EDIABASX_VERSION__}
            </a>
            <span class="ml-2 text-faint">— EDIABAS / BEST-VM engine</span>
          </dd>
          <dt class="font-mono text-faint">inpax</dt>
          <dd>
            <a
              href="https://github.com/emdzej/inpax/releases/tag/{__INPAX_VERSION__}"
              target="_blank"
              rel="noopener noreferrer"
              class="font-mono text-foreground underline-offset-2 hover:text-accent hover:underline"
            >
              {__INPAX_VERSION__}
            </a>
            <span class="ml-2 text-faint">— INPA IPO interpreter</span>
          </dd>
        </dl>

        <!-- Links block. GitHub repo + bug report. The repo link lives on the
             octocat icon in the top bar too; mirroring it here keeps the dialog
             a one-stop landing for "where do I look further?". -->
        <ul class="space-y-1 text-xs">
          <li>
            <a
              href="https://github.com/emdzej/ncsx"
              target="_blank"
              rel="noopener noreferrer"
              class="text-muted underline-offset-2 hover:text-accent hover:underline"
            >
              ↗ Source on GitHub
            </a>
          </li>
          <li>
            <a
              href="https://github.com/emdzej/ncsx/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              class="text-muted underline-offset-2 hover:text-accent hover:underline"
            >
              ↗ Report an issue
            </a>
          </li>
        </ul>
      </section>

      <footer class="flex items-center justify-end border-t border-divider bg-elevated/50 px-4 py-2">
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
