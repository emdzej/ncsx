<script lang="ts">
  import { findSgsByFlag } from "@emdzej/ncsx-chassis";
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";
  import { tokenizeFa } from "@emdzej/ncsx-fa-asw";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { startNcsRuntime } from "../lib/runtime.svelte";
  import { describeFaKeywordWithFallback } from "../lib/fa-describe";

  /**
   * Local edit state: the tokens the user has staged. Initialised from
   * `app.identity.fa` each time the dialog opens. We don't mutate
   * `app.identity` until the IPO write succeeds — that way "cancel"
   * cleanly discards the in-progress edits.
   */
  let stagedTokens = $state<string[]>([]);
  let prefix = $state(""); // chassis prefix segment before the first separator (e.g. "E89_")
  let search = $state("");
  let writing = $state(false);
  let writeError = $state<string | null>(null);

  /**
   * Reset the dialog's local state every time it's reopened.
   * `app.identity.fa` is the source of truth; this dialog merely
   * stages edits on top of a copy.
   */
  $effect(() => {
    if (!app.showFaEditor) return;
    writeError = null;
    search = "";
    const raw = app.identity?.fa ?? "";
    // Pull out the chassis prefix — everything up to and including
    // the first `_` if there is one (e.g. `E89_` or `R5X_`). The
    // prefix isn't an FA token; it identifies the chassis the FA was
    // read on and survives every edit. tokenizeFa already strips it.
    const sep = raw.indexOf("_");
    if (sep > 0) {
      prefix = raw.slice(0, sep + 1);
    } else {
      prefix = "";
    }
    stagedTokens = tokenizeFa(raw);
  });

  /** All AT codes the chassis declares, sorted by category then code. */
  const allCodes = $derived.by<
    Array<{ code: string; category: string; comment: string; description: string | null }>
  >(() => {
    if (!app.chassis?.at) return [];
    const tr = app.translations?.entries;
    const out: Array<{
      code: string;
      category: string;
      comment: string;
      description: string | null;
    }> = [];
    for (const [code, rec] of app.chassis.at) {
      out.push({
        code,
        category: rec.category,
        comment: rec.comment ?? "",
        description: describeFaKeywordWithFallback(code, tr),
      });
    }
    return out.sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.code.localeCompare(b.code),
    );
  });

  const stagedSet = $derived(new Set(stagedTokens));

  /** Filtered code list — substring match against code OR comment OR description. */
  const filteredCodes = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return allCodes;
    return allCodes.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.comment.toLowerCase().includes(q) ||
        (c.description?.toLowerCase().includes(q) ?? false),
    );
  });

  /**
   * Marker prefix per AT category — mirrors NCSEXPER's FA token
   * delimiters. The category letter on the AT row maps to the
   * marker char the FA token carries:
   *   W (Werks)   → $
   *   S (Sonder)  → $
   *   E (Extra)   → %
   *   Z (...)     → %
   *   H (...)     → &
   *   V (...)     → &
   *
   * The right mapping is "look up the FIRST char of any existing
   * FA token with the same category" since the markers aren't
   * always 1:1 with category letters across chassis generations.
   * To stay safe, we default to `$` (most common) but try to
   * preserve markers we saw in the source FA.
   */
  let markerByCategory = $state<Record<string, string>>({});
  $effect(() => {
    if (!app.identity?.fa) return;
    const raw = app.identity.fa;
    const map: Record<string, string> = {};
    // Scan markers in the original FA — any character that's a marker
    // immediately before a known code. We attach it to the category
    // of that code so we re-emit the same marker on add.
    if (app.chassis?.at) {
      const tokens = tokenizeFa(raw);
      let pos = raw.indexOf("_") + 1;
      for (const tok of tokens) {
        const idx = raw.indexOf(tok, pos);
        if (idx <= 0) continue;
        const marker = raw[idx - 1] ?? "";
        if (/[#&%$|*+\-]/.test(marker)) {
          const rec = app.chassis.at.get(tok);
          if (rec) map[rec.category] = marker;
        }
        pos = idx + tok.length;
      }
    }
    markerByCategory = map;
  });

  function markerFor(category: string): string {
    return markerByCategory[category] ?? "$";
  }

  function addToken(code: string): void {
    if (stagedSet.has(code)) return;
    stagedTokens = [...stagedTokens, code];
  }

  function removeToken(code: string): void {
    stagedTokens = stagedTokens.filter((t) => t !== code);
  }

  /**
   * Reassemble the FA string from the staged tokens. Format mirrors
   * what NCSEXPER's `coapiReadAuftrag` returns: `<prefix><marker><code><marker><code>…`
   * where the marker is the FA-category prefix character.
   *
   * AT entries the chassis didn't declare get the default `$` marker
   * (most common across BMW chassis). Markers for known entries come
   * from `markerByCategory`, which scans the source FA for the
   * marker character that preceded each token at read time.
   */
  const stagedFaString = $derived.by(() => {
    if (stagedTokens.length === 0) return prefix;
    const parts: string[] = [prefix];
    for (const tok of stagedTokens) {
      const rec = app.chassis?.at?.get(tok);
      const marker = rec ? markerFor(rec.category) : "$";
      parts.push(marker + tok);
    }
    return parts.join("");
  });

  /**
   * Tokens that were in the original FA but are no longer staged
   * (= the user removed them). Surfaced in the diff panel.
   */
  const removed = $derived.by(() => {
    if (!app.identity?.fa) return [];
    const original = new Set(tokenizeFa(app.identity.fa));
    const staged = stagedSet;
    return [...original].filter((t) => !staged.has(t));
  });

  /** Tokens added since the original FA was read. */
  const added = $derived.by(() => {
    if (!app.identity?.fa) return stagedTokens;
    const original = new Set(tokenizeFa(app.identity.fa));
    return stagedTokens.filter((t) => !original.has(t));
  });

  const hasChanges = $derived(added.length > 0 || removed.length > 0);

  /**
   * Pick a SG to dispatch FA_WRITE against. Prefer the SG identity
   * was read from (so we hit the same ECU); fall back to the first
   * FA-master SGFAM row. Without one of those we can't dispatch.
   */
  const targetSg = $derived.by<SgfamRow | null>(() => {
    if (!app.chassis) return null;
    if (app.identity?.source) return app.identity.source;
    const masters = findSgsByFlag(app.chassis.sgfam, "fa");
    return masters[0] ?? null;
  });

  function close(): void {
    if (writing) return;
    app.showFaEditor = false;
  }

  async function commit(): Promise<void> {
    if (!app.chassis || !app.identity || !targetSg) return;
    if (!targetSg.cabd || !targetSg.sgbd) {
      writeError = `${targetSg.sgName} missing CABD or SGBD in SGFAM`;
      return;
    }
    if (!connection.session) {
      writeError = "Connect to the ECU first";
      return;
    }
    const newFa = stagedFaString;
    const ok = window.confirm(
      `Write FA to ${targetSg.sgName} (${targetSg.sgbd})?\n\n` +
        `${added.length} added, ${removed.length} removed.\n\n` +
        `Dispatches FA_WRITE through ${targetSg.cabd}.IPO.\n\n` +
        `The IPO seeds FA_STREAM, encodes via FA.PRG, and writes via apiJobData.`,
    );
    if (!ok) return;
    writing = true;
    writeError = null;
    // Optimistically update the host identity so `runCabimain`'s
    // FA_WRITE seed picks up the new value. On failure we revert.
    const oldFa = app.identity.fa;
    app.identity.fa = newFa;
    try {
      const handle = await startNcsRuntime({
        cabdBasename: targetSg.cabd,
        sgbd: targetSg.sgbd,
      });
      try {
        await handle.runCabimain("FA_WRITE");
        const status = handle.cabi.lastJobStatus;
        if (status !== "OKAY") {
          throw new Error(
            `FA_WRITE returned JOB_STATUS=${status || "(missing)"}`,
          );
        }
      } finally {
        await handle.dispose();
      }
      // Success — leave `app.identity.fa` at its new value, close.
      app.showFaEditor = false;
    } catch (err) {
      // Revert optimistic update so the panel reflects what the ECU
      // really has. User can re-read identity to confirm or retry.
      app.identity.fa = oldFa;
      writeError = err instanceof Error ? err.message : String(err);
    } finally {
      writing = false;
    }
  }
</script>

{#if app.showFaEditor}
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
      class="flex max-h-[90vh] w-full max-w-3xl flex-col rounded border border-rule bg-surface shadow-2xl"
      role="document"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="flex items-baseline justify-between gap-4 border-b border-divider px-4 py-3">
        <div>
          <h2 class="text-sm font-bold uppercase tracking-wider text-muted">
            Edit FA
          </h2>
          {#if targetSg}
            <p class="mt-0.5 text-xs text-faint">
              writes to <span class="font-mono">{targetSg.sgName}</span>
              ({targetSg.sgbd}) via <span class="font-mono">FA_WRITE</span>
            </p>
          {/if}
        </div>
        <button
          class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
          onclick={close}
          disabled={writing}
        >
          close
        </button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-sm">
        <!-- Staged FA preview -->
        <div>
          <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
            FA string ({stagedTokens.length} tokens)
          </p>
          <p class="break-all rounded border border-divider bg-base p-2 font-mono text-xs text-foreground">
            {stagedFaString || "(empty)"}
          </p>
          {#if hasChanges}
            <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
              {#if added.length > 0}
                <div class="rounded border border-emerald-500/40 bg-emerald-500/10 p-2">
                  <p class="mb-1 font-semibold text-emerald-700 dark:text-emerald-300">
                    +{added.length} added
                  </p>
                  <p class="font-mono text-faint">{added.join(", ")}</p>
                </div>
              {/if}
              {#if removed.length > 0}
                <div class="rounded border border-rose-500/40 bg-rose-500/10 p-2">
                  <p class="mb-1 font-semibold text-rose-700 dark:text-rose-300">
                    −{removed.length} removed
                  </p>
                  <p class="font-mono text-faint">{removed.join(", ")}</p>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Current tokens as removable chips -->
        <div>
          <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
            Current tokens
          </p>
          {#if stagedTokens.length === 0}
            <p class="text-xs text-faint italic">No tokens staged.</p>
          {:else}
            <ul class="flex flex-wrap gap-1.5">
              {#each stagedTokens as tok (tok)}
                {@const rec = app.chassis?.at?.get(tok)}
                {@const desc = describeFaKeywordWithFallback(tok, app.translations?.entries)}
                <li
                  class="flex items-baseline gap-1.5 rounded border border-divider bg-base px-2 py-0.5 text-xs"
                  title={rec?.comment || desc || tok}
                >
                  <span class="font-mono text-foreground">{tok}</span>
                  {#if desc}
                    <span class="text-faint">— {desc}</span>
                  {/if}
                  <button
                    class="ml-1 text-faint hover:text-rose-500"
                    onclick={() => removeToken(tok)}
                    title="Remove {tok}"
                    aria-label="Remove {tok}"
                  >
                    ✕
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- Add new tokens -->
        <div class="flex min-h-0 flex-1 flex-col">
          <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
            Add — {allCodes.length} codes available in
            <span class="font-mono">{app.chassis?.code}AT.000</span>
          </p>
          <input
            type="search"
            placeholder="Search code or description…"
            bind:value={search}
            class="mb-2 w-full rounded border border-rule bg-base px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
          />
          <ul class="min-h-[8rem] flex-1 overflow-y-auto rounded border border-divider bg-base text-xs">
            {#if filteredCodes.length === 0}
              <li class="p-2 text-faint italic">No codes match "{search}".</li>
            {:else}
              {#each filteredCodes.slice(0, 200) as c (c.code)}
                {@const present = stagedSet.has(c.code)}
                <li
                  class="flex items-baseline justify-between gap-2 border-b border-divider/40 px-2 py-1 last:border-b-0"
                >
                  <span class="flex items-baseline gap-2">
                    <span class="w-4 font-mono text-faint">{c.category}</span>
                    <span class="font-mono text-foreground">{c.code}</span>
                    {#if c.description}
                      <span class="text-muted">— {c.description}</span>
                    {:else if c.comment}
                      <span class="text-faint italic">{c.comment}</span>
                    {/if}
                  </span>
                  <button
                    class="rounded border border-divider px-2 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 {present
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'hover:border-accent hover:bg-elevated'}"
                    onclick={() => addToken(c.code)}
                    disabled={present}
                    title={present ? "Already staged" : "Add to FA"}
                  >
                    {present ? "✓ added" : "add"}
                  </button>
                </li>
              {/each}
              {#if filteredCodes.length > 200}
                <li class="p-2 text-center text-faint italic">
                  …showing first 200 of {filteredCodes.length} matches. Narrow the search to see more.
                </li>
              {/if}
            {/if}
          </ul>
        </div>

        {#if writeError}
          <p class="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
            {writeError}
          </p>
        {/if}
      </div>

      <footer class="flex items-center justify-between gap-2 border-t border-divider bg-elevated/50 px-4 py-2">
        <span class="text-xs text-faint">
          {#if !hasChanges}
            no changes staged
          {:else}
            {added.length} to add · {removed.length} to remove
          {/if}
        </span>
        <div class="flex items-center gap-2">
          <button
            class="rounded border border-rule px-2 py-0.5 text-xs text-muted hover:bg-elevated hover:text-foreground"
            onclick={close}
            disabled={writing}
          >
            Cancel
          </button>
          <button
            class="rounded bg-accent px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            onclick={commit}
            disabled={writing || !hasChanges || !targetSg || connection.status.kind !== "connected"}
            title={connection.status.kind !== "connected"
              ? "Connect to the ECU first"
              : !targetSg
                ? "No FA-master SG available"
                : !hasChanges
                  ? "Stage at least one change first"
                  : "Dispatch FA_WRITE"}
          >
            {writing ? "Writing…" : "Write FA"}
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}
