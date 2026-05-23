<script lang="ts">
  import { findSgsByFlag } from "@emdzej/ncsx-chassis";
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { startNcsRuntime } from "../lib/runtime.svelte";
  import { describeFaKeywordWithFallback } from "../lib/fa-describe";

  /**
   * Local edit state. `gm` and `vn` are scalar inputs; `saHex` is the
   * 16-hex-char bitset built from the active SA codes' masks. We
   * stage these locally and only push them onto `app.identity.zcs`
   * once the IPO write succeeds.
   */
  let gm = $state("");
  let saHex = $state("");
  let vn = $state("");
  let search = $state("");
  let writing = $state(false);
  let writeError = $state<string | null>(null);

  $effect(() => {
    if (!app.showZcsEditor) return;
    writeError = null;
    search = "";
    gm = app.identity?.zcs?.gm ?? "";
    saHex = app.identity?.zcs?.sa ?? "";
    vn = app.identity?.zcs?.vn ?? "";
  });

  /**
   * SA-bit catalogue: every ZST row with a non-empty `saMask`,
   * grouped by `saCode` so the user toggles "Sport package" once
   * regardless of how many FSWs the package activates internally.
   * Each entry carries its FSW list + comment for display.
   */
  const saEntries = $derived.by<
    Array<{
      saCode: string;
      saMask: string;
      maskBig: bigint;
      comment: string;
      fsws: Array<{ keyword: string; description: string | null }>;
    }>
  >(() => {
    if (!app.chassis?.zst) return [];
    const tr = app.translations?.entries;
    const grouped = new Map<
      string,
      {
        saCode: string;
        saMask: string;
        maskBig: bigint;
        comment: string;
        fsws: Array<{ keyword: string; description: string | null }>;
        seenFsws: Set<string>;
      }
    >();
    for (const rec of app.chassis.zst.file.records) {
      if (!rec.saMask || /^0+$/.test(rec.saMask)) continue;
      const key = rec.saCode || `mask:${rec.saMask}`;
      let entry = grouped.get(key);
      if (!entry) {
        let maskBig: bigint;
        try {
          maskBig = BigInt("0x" + rec.saMask);
        } catch {
          continue;
        }
        if (maskBig === 0n) continue;
        entry = {
          saCode: rec.saCode || rec.saMask,
          saMask: rec.saMask,
          maskBig,
          comment: rec.comment ?? "",
          fsws: [],
          seenFsws: new Set(),
        };
        grouped.set(key, entry);
      }
      if (rec.fsw && !entry.seenFsws.has(rec.fsw)) {
        entry.seenFsws.add(rec.fsw);
        entry.fsws.push({
          keyword: rec.fsw,
          description: describeFaKeywordWithFallback(rec.fsw, tr),
        });
      }
      if (!entry.comment && rec.comment) entry.comment = rec.comment;
    }
    return [...grouped.values()]
      .map(({ saCode, saMask, maskBig, comment, fsws }) => ({
        saCode,
        saMask,
        maskBig,
        comment,
        fsws,
      }))
      .sort((a, b) => a.saCode.localeCompare(b.saCode));
  });

  const filteredEntries = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return saEntries;
    return saEntries.filter(
      (e) =>
        e.saCode.toLowerCase().includes(q) ||
        e.comment.toLowerCase().includes(q) ||
        e.fsws.some(
          (f) =>
            f.keyword.toLowerCase().includes(q) ||
            (f.description?.toLowerCase().includes(q) ?? false),
        ),
    );
  });

  /** Parse the staged SA hex into a BigInt for membership tests. */
  const stagedSaBig = $derived.by<bigint>(() => {
    try {
      return saHex.trim().length === 0 ? 0n : BigInt("0x" + saHex.trim());
    } catch {
      return 0n;
    }
  });

  function isActive(entry: { maskBig: bigint }): boolean {
    return (stagedSaBig & entry.maskBig) === entry.maskBig;
  }

  function toggle(entry: { maskBig: bigint }, on: boolean): void {
    let next: bigint;
    if (on) {
      next = stagedSaBig | entry.maskBig;
    } else {
      // Clear every bit in entry.maskBig from stagedSaBig.
      next = stagedSaBig & ~entry.maskBig;
    }
    saHex = formatSa(next, saHex.length || 16);
  }

  function formatSa(value: bigint, width: number): string {
    const hex = value.toString(16).toUpperCase();
    return hex.padStart(width, "0");
  }

  /** Bits set in stagedSa that don't correspond to any known ZST code. */
  const unknownBits = $derived.by(() => {
    let known = 0n;
    for (const e of saEntries) known |= e.maskBig;
    const orphan = stagedSaBig & ~known;
    if (orphan === 0n) return null;
    return formatSa(orphan, saHex.length || 16);
  });

  const original = $derived(app.identity?.zcs);
  const hasChanges = $derived(
    !!original &&
      (gm.trim() !== original.gm.trim() ||
        saHex.trim().toUpperCase() !== original.sa.trim().toUpperCase() ||
        vn.trim() !== original.vn.trim()),
  );

  /**
   * Pick a SG to dispatch ZCS_SCHREIBEN against. Prefer the SG that
   * identity was read from (most recent context). Fall back to the
   * first ZCS-master SG in SGFAM.
   */
  const targetSg = $derived.by<SgfamRow | null>(() => {
    if (!app.chassis) return null;
    if (app.identity?.source) return app.identity.source;
    const masters = findSgsByFlag(app.chassis.sgfam, "zcs");
    return masters[0] ?? null;
  });

  function close(): void {
    if (writing) return;
    app.showZcsEditor = false;
  }

  async function commit(): Promise<void> {
    if (!app.chassis || !app.identity?.zcs || !targetSg) return;
    if (!targetSg.cabd || !targetSg.sgbd) {
      writeError = `${targetSg.sgName} missing CABD or SGBD in SGFAM`;
      return;
    }
    if (!connection.session) {
      writeError = "Connect to the ECU first";
      return;
    }
    const ok = window.confirm(
      `Write ZCS to ${targetSg.sgName} (${targetSg.sgbd})?\n\n` +
        `GM=${gm}, SA=${saHex}, VN=${vn}\n\n` +
        `Dispatches ZCS_SCHREIBEN through ${targetSg.cabd}.IPO.`,
    );
    if (!ok) return;
    writing = true;
    writeError = null;
    const oldZcs = app.identity.zcs;
    app.identity.zcs = { ...oldZcs, gm, sa: saHex, vn };
    try {
      const handle = await startNcsRuntime({
        cabdBasename: targetSg.cabd,
        sgbd: targetSg.sgbd,
      });
      try {
        await handle.runCabimain("ZCS_SCHREIBEN");
        const status = handle.cabi.lastJobStatus;
        if (status !== "OKAY") {
          throw new Error(
            `ZCS_SCHREIBEN returned JOB_STATUS=${status || "(missing)"}`,
          );
        }
      } finally {
        await handle.dispose();
      }
      app.showZcsEditor = false;
    } catch (err) {
      app.identity.zcs = oldZcs;
      writeError = err instanceof Error ? err.message : String(err);
    } finally {
      writing = false;
    }
  }
</script>

{#if app.showZcsEditor}
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
            Edit ZCS
          </h2>
          {#if targetSg}
            <p class="mt-0.5 text-xs text-faint">
              writes to <span class="font-mono">{targetSg.sgName}</span>
              ({targetSg.sgbd}) via <span class="font-mono">ZCS_SCHREIBEN</span>
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
        <!-- GM / SA / VN scalar inputs -->
        <div class="grid grid-cols-3 gap-3">
          <label class="text-xs text-muted">
            GM
            <input
              type="text"
              class="mt-0.5 w-full rounded border border-rule bg-base px-2 py-1 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
              bind:value={gm}
              spellcheck="false"
            />
          </label>
          <label class="col-span-2 text-xs text-muted">
            SA (hex bit-set)
            <input
              type="text"
              class="mt-0.5 w-full rounded border border-rule bg-base px-2 py-1 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
              bind:value={saHex}
              spellcheck="false"
            />
          </label>
          <label class="text-xs text-muted">
            VN
            <input
              type="text"
              class="mt-0.5 w-full rounded border border-rule bg-base px-2 py-1 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
              bind:value={vn}
              spellcheck="false"
            />
          </label>
        </div>

        {#if unknownBits}
          <p class="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <span class="font-semibold">Heads up:</span> the SA bit-set has bits
            set that don't map to any ZST row for
            <span class="font-mono">{app.chassis?.code}</span>:
            <span class="font-mono">{unknownBits}</span>. They'll be preserved
            on write but you can't toggle them via the list below.
          </p>
        {/if}

        <!-- SA bit toggles -->
        <div class="flex min-h-0 flex-1 flex-col">
          <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
            SA codes — {saEntries.length} in
            <span class="font-mono">{app.chassis?.code}ZST.*</span>
          </p>
          <input
            type="search"
            placeholder="Search code, comment, or FSW…"
            bind:value={search}
            class="mb-2 w-full rounded border border-rule bg-base px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none"
          />
          <ul class="min-h-[10rem] flex-1 overflow-y-auto rounded border border-divider bg-base text-xs">
            {#if filteredEntries.length === 0}
              <li class="p-2 text-faint italic">No SA codes match "{search}".</li>
            {:else}
              {#each filteredEntries as e (e.saCode + e.saMask)}
                {@const on = isActive(e)}
                <li class="border-b border-divider/40 px-2 py-1.5 last:border-b-0">
                  <label class="flex cursor-pointer items-baseline gap-2">
                    <input
                      type="checkbox"
                      class="accent-accent"
                      checked={on}
                      onchange={(ev) => toggle(e, (ev.currentTarget as HTMLInputElement).checked)}
                    />
                    <span class="font-mono text-foreground">{e.saCode}</span>
                    {#if e.comment}
                      <span class="text-muted">— {e.comment}</span>
                    {/if}
                  </label>
                  {#if e.fsws.length > 0}
                    <ul class="ml-5 mt-0.5 space-y-0.5">
                      {#each e.fsws as f (f.keyword)}
                        <li class="flex items-baseline gap-2 text-faint">
                          <span class="font-mono text-muted">{f.keyword}</span>
                          {#if f.description}
                            <span>— {f.description}</span>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </li>
              {/each}
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
            changes staged
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
                ? "No ZCS-master SG available"
                : !hasChanges
                  ? "Stage at least one change first"
                  : "Dispatch ZCS_SCHREIBEN"}
          >
            {writing ? "Writing…" : "Write ZCS"}
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}
