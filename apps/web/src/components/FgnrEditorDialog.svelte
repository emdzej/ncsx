<script lang="ts">
  /**
   * FGNR (VIN) editor — multi-target identity-write flow.
   *
   * BMW's convention is that FAHRGESTELL_NR should agree across
   * every ECU that stores it (KMB, LCM, IKE, EWS, etc., depending
   * on chassis). Writing to one ECU and not another leaves the
   * car inconsistent — downstream coding gets confused about which
   * VIN it's working against.
   *
   * The dialog scans the chassis's identity-master ECUs (FA=1 or
   * ZCS=1 in SGFAM) on open, finds every one whose CABD declares
   * `FAHRGESTELL_NR[*]` FSWs, and offers them as a checkbox list.
   * On Write, runs FGNR_SCHREIBEN against each selected ECU
   * sequentially with per-ECU status tracking — partial failures
   * leave the dialog open with retry buttons.
   *
   * Same primitive (`buildSlotsFromValues`) used in the inner per-
   * ECU write loop as for ZCS — the only per-ECU difference is the
   * value map keyed by FAHRGESTELL_NR[i].
   */
  import { untrack } from "svelte";
  import { buildSlotsFromValues } from "@emdzej/ncsx-coder";
  import { formatFahrgestellNr, mod36Checksum } from "@emdzej/ncsx-identity";
  import { buildFunctionList } from "@emdzej/ncsx-function-list";
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { startNcsRuntime } from "../lib/runtime.svelte";
  import { findPhysicalModule, formatCi } from "../lib/process-ecu";

  // Per-ECU write status. Tracked separately from the targets list
  // so the same ECU can be retried after a failure.
  type WriteStatus =
    | { kind: "pending" }
    | { kind: "writing" }
    | { kind: "ok"; durationMs: number }
    | { kind: "error"; message: string };

  let vinBody = $state("");
  let writing = $state(false);
  let writeError = $state<string | null>(null);
  /**
   * The list of identity-master ECUs whose CABD declares
   * FAHRGESTELL_NR FSWs. `undefined` while the scan is in flight,
   * `[]` if nothing matches (which means VIN write isn't supported
   * on this chassis), or a populated array.
   */
  let fgnrTargets = $state<SgfamRow[] | undefined>(undefined);
  /** sgNames the user has selected to write to. Defaults to all targets. */
  let selected = $state(new Set<string>());
  /** Per-ECU status during/after a write run. */
  let results = $state(new Map<string, WriteStatus>());

  // Populate VIN body + reset target scan on dialog open.
  $effect(() => {
    if (!app.showFgnrEditor) {
      fgnrTargets = undefined;
      selected = new Set();
      results = new Map();
      return;
    }
    untrack(() => {
      writeError = null;
      const vin = app.identity?.vin ?? "";
      vinBody = vin.slice(0, 17).toUpperCase();
      void resolveFgnrTargets();
    });
  });

  /** Mod-36 check digit for the current VIN body, or null if invalid length. */
  const vinCheck = $derived.by<string | null>(() => {
    if (vinBody.length !== 17) return null;
    try {
      return mod36Checksum(`FP${vinBody.toUpperCase()}`);
    } catch {
      return null;
    }
  });

  /** Full 18-char FAHRGESTELL_NR ready for fanning into FSW values. */
  const fgnr = $derived(vinCheck !== null ? vinBody.toUpperCase() + vinCheck : "");

  const lengthError = $derived.by<string | null>(() => {
    if (vinBody.trim().length !== 17) {
      return `VIN must be 17 chars, got ${vinBody.trim().length}`;
    }
    return null;
  });

  /** Candidate identity-master rows — input to the FGNR-FSW scan. */
  const candidateSgs = $derived.by<SgfamRow[]>(() => {
    if (!app.chassis) return [];
    const seen = new Set<string>();
    const out: SgfamRow[] = [];
    for (const row of app.chassis.sgfam.values()) {
      if (row.fa !== 1 && row.zcs !== 1) continue;
      if (!row.cabd || !row.sgbd) continue;
      if (seen.has(row.sgName)) continue;
      seen.add(row.sgName);
      out.push(row);
    }
    return out;
  });

  /**
   * Scan every candidate ECU's CABD for FAHRGESTELL_NR FSWs. Each
   * ECU that has them lands in `fgnrTargets` and starts out
   * `selected`. The scan is parallel — ~3-4 CABD loads on a
   * typical chassis, each cheap because CabdLoader caches parsed
   * files for the session.
   */
  async function resolveFgnrTargets(): Promise<void> {
    const chassis = app.chassis;
    if (!chassis) {
      fgnrTargets = [];
      return;
    }
    fgnrTargets = undefined;
    const matched: SgfamRow[] = [];
    const probes = candidateSgs.map(async (row) => {
      try {
        const ci = guessCiForRow(row);
        if (ci === null) return;
        const cabd = await chassis.cabd.openModule(row.sgName, ci);
        if (hasFgnrFsw(cabd)) matched.push(row);
      } catch {
        // CABD load failed — skip. Real-world causes: SGAUSWAHL CBD
        // points at a `.Cxx` revision the chassis doesn't actually
        // ship; happens on edge-case CABDs.
      }
    });
    await Promise.all(probes);
    matched.sort((a, b) => a.sgName.localeCompare(b.sgName));
    fgnrTargets = matched;
    selected = new Set(matched.map((r) => r.sgName));
    results = new Map();
  }

  /**
   * Pick the SGAUSWAHL-declared default CI for a SGFAM row. Most
   * chassis pin one CI per SG; for multi-CI ECUs the FAHRGESTELL_NR
   * FSW set is typically consistent across revisions (storage moves
   * but the FSW names stay), so the probe answers the right
   * question.
   */
  function guessCiForRow(row: SgfamRow): number | null {
    const chassis = app.chassis;
    if (!chassis) return null;
    for (const block of chassis.sget.blocks) {
      if (!block.name.startsWith("SGAUSWAHL_")) continue;
      for (const sgr of block.rows) {
        if (sgr.UMRSG !== row.sgName) continue;
        const cbd = String(sgr.CBD ?? "");
        const m = /^C([0-9A-Fa-f]{1,2})$/.exec(cbd);
        if (m) {
          const n = Number.parseInt(m[1]!, 16);
          if (Number.isFinite(n)) return n;
        }
      }
    }
    return null;
  }

  function hasFgnrFsw(cabd: import("@emdzej/ncsx-daten").DatenFile): boolean {
    const chassis = app.chassis;
    if (!chassis?.swtFsw) return false;
    for (const block of cabd.blocks) {
      if (
        block.name !== "PARZUWEISUNG_FSW" &&
        block.name !== "PARZUWEISUNG_FSW1" &&
        block.name !== "PARZUWEISUNG_DIR"
      ) {
        continue;
      }
      for (const row of block.rows) {
        const fsw = row.FSW;
        if (typeof fsw !== "number") continue;
        const keyword = chassis.swtFsw.byKeyId.get(fsw);
        if (typeof keyword === "string" && keyword.startsWith("FAHRGESTELL_NR")) {
          return true;
        }
      }
    }
    return false;
  }

  function toggle(sgName: string): void {
    const next = new Set(selected);
    if (next.has(sgName)) next.delete(sgName);
    else next.add(sgName);
    selected = next;
  }

  function close(): void {
    if (writing) return;
    app.showFgnrEditor = false;
  }

  /**
   * Run FGNR_SCHREIBEN against every selected ECU sequentially. We
   * could parallelise but BMW SGBDs aren't always re-entrant on the
   * same K-line bus, and serial gives clearer per-ECU diagnostics.
   * On any failure, leave the dialog open with the failing ECU's
   * status set to `error` so the user can retry just that one.
   */
  async function commit(): Promise<void> {
    if (!app.chassis || !fgnrTargets || fgnrTargets.length === 0) return;
    if (!connection.session) {
      writeError = "Connect to the ECU first";
      return;
    }
    if (lengthError) {
      writeError = lengthError;
      return;
    }
    const toWrite = fgnrTargets.filter((r) => selected.has(r.sgName));
    if (toWrite.length === 0) {
      writeError = "No ECUs selected";
      return;
    }
    const ok = window.confirm(
      `Write VIN to ${toWrite.length} ECU${toWrite.length === 1 ? "" : "s"}: ` +
        toWrite.map((r) => r.sgName).join(", ") +
        `\n\nVIN=${vinBody.toUpperCase()}, check=${vinCheck}\n` +
        `FAHRGESTELL_NR=${fgnr}\n\n` +
        `Each ECU runs its own FGNR_SCHREIBEN. Partial failures will\n` +
        `leave the dialog open — you can retry failed ECUs individually.`,
    );
    if (!ok) return;

    writing = true;
    writeError = null;
    // Seed all targets to "pending" so the UI shows them as queued.
    const initial = new Map<string, WriteStatus>();
    for (const t of toWrite) initial.set(t.sgName, { kind: "pending" });
    results = initial;

    let allOk = true;
    for (const sg of toWrite) {
      results = new Map(results).set(sg.sgName, { kind: "writing" });
      const start = performance.now();
      try {
        await writeOne(sg);
        const durationMs = Math.round(performance.now() - start);
        results = new Map(results).set(sg.sgName, { kind: "ok", durationMs });
      } catch (err) {
        allOk = false;
        const message = err instanceof Error ? err.message : String(err);
        results = new Map(results).set(sg.sgName, { kind: "error", message });
      }
    }
    writing = false;

    if (allOk) {
      // Update the canonical app.identity so reads reflect the new
      // VIN. Done only on full success — partial writes leave the
      // car in a mixed state and showing the "new" VIN would lie.
      if (app.identity) {
        app.identity = { ...app.identity, vin: vinBody.toUpperCase() };
      }
      // Brief delay so the user sees the green checkmarks before
      // the dialog vanishes. Could also auto-close immediately;
      // 600ms feels deliberate without being annoying.
      setTimeout(() => {
        app.showFgnrEditor = false;
      }, 600);
    }
  }

  /** Retry a single failed ECU. Mirrors a slice of `commit`'s loop. */
  async function retry(sg: SgfamRow): Promise<void> {
    if (writing) return;
    writing = true;
    results = new Map(results).set(sg.sgName, { kind: "writing" });
    const start = performance.now();
    try {
      await writeOne(sg);
      const durationMs = Math.round(performance.now() - start);
      results = new Map(results).set(sg.sgName, { kind: "ok", durationMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results = new Map(results).set(sg.sgName, { kind: "error", message });
    }
    writing = false;
  }

  /**
   * Per-ECU write — the inner loop shared between `commit` and
   * `retry`. Mirrors the ZCS dialog's commit body but with the
   * value-map fanout for FAHRGESTELL_NR[1..18] and dispatching
   * the FGNR_SCHREIBEN cabimain job.
   */
  async function writeOne(sg: SgfamRow): Promise<void> {
    const chassis = app.chassis;
    if (!chassis) throw new Error("no chassis loaded");
    if (!sg.cabd || !sg.sgbd) throw new Error(`${sg.sgName} missing CABD or SGBD`);
    const ci =
      app.selectedModule?.codingIndex ??
      (await readCodingIndex(sg.sgbd, sg.cabd));
    if (typeof ci !== "number") {
      throw new Error("couldn't determine coding index from IDENT");
    }
    const physical = findPhysicalModule(chassis, sg.sgName, formatCi(ci));
    if (!physical) {
      throw new Error(
        `no SGAUSWAHL row for ${sg.sgName} + ${formatCi(ci)} on ${chassis.code}`,
      );
    }
    const cabd = await chassis.cabd.openModule(physical.moduleName, ci);
    const list = buildFunctionList(cabd, {
      keywords: {
        fsw: chassis.swtFsw?.byKeyId,
        psw: chassis.swtPsw?.byKeyId,
      },
    });
    const values = new Map<string, string>();
    for (let i = 0; i < 18; i++) {
      values.set(`FAHRGESTELL_NR[${i + 1}]`, fgnr[i]!);
    }
    const built = buildSlotsFromValues(list, { values });
    if (built.slots.length === 0) {
      throw new Error(
        `no FAHRGESTELL_NR FSWs in this CABD revision (skipped=${built.skipped.length})`,
      );
    }
    const wortBreite = list.memoryStructure === "BYTE" ? 1 : 2;
    const handle = await startNcsRuntime({
      cabdBasename: sg.cabd,
      sgbd: sg.sgbd,
    });
    try {
      handle.cabi.setNettoSlots(built.slots);
      await handle.cabi.CDHSetDataOrg(wortBreite, 0, 0);
      await handle.runCabimain("FGNR_SCHREIBEN");
      const status = handle.cabi.lastJobStatus;
      if (status !== "OKAY") {
        throw new Error(`JOB_STATUS=${status || "(missing)"}`);
      }
    } finally {
      await handle.dispose();
    }
  }

  /** Inline IDENT to read ID_COD_INDEX when the cached one isn't available. */
  async function readCodingIndex(sgbd: string, cabdBasename: string): Promise<number | null> {
    const handle = await startNcsRuntime({ cabdBasename, sgbd });
    try {
      await handle.cabi.CDHapiJob(sgbd, "IDENT", "", "");
      const ci = handle.cabi.findResult("ID_COD_INDEX");
      if (typeof ci === "number") return ci;
      if (typeof ci === "string") {
        const parsed = Number.parseInt(ci, 10);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    } finally {
      await handle.dispose();
    }
  }

  const selectedCount = $derived(selected.size);
  const allOk = $derived(
    results.size > 0 &&
      [...results.values()].every((s) => s.kind === "ok"),
  );
</script>

{#if app.showFgnrEditor}
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
      class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded border border-rule bg-surface shadow-2xl"
      role="document"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <header class="border-b border-divider px-4 py-3">
        <h2 class="text-sm font-bold uppercase tracking-wider text-muted">
          Edit VIN (FGNR)
        </h2>
        <p class="mt-0.5 text-xs text-faint">
          Writes the same VIN to every selected ECU. BMW's convention is
          that FAHRGESTELL_NR should agree across all modules that store it.
        </p>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-sm">
        <label class="text-xs text-muted">
          VIN <span class="text-faint">(17 chars)</span>
          <div class="mt-0.5 flex items-stretch gap-1">
            <input
              type="text"
              maxlength="17"
              class="min-w-0 flex-1 rounded border border-rule bg-base px-2 py-1 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
              bind:value={vinBody}
              spellcheck="false"
              autocomplete="off"
              disabled={writing}
            />
            <span
              class="inline-flex w-6 items-center justify-center rounded border border-divider bg-elevated px-1 font-mono text-sm text-muted"
              title="Mod-36 check char — auto-computed (= 18th char of FAHRGESTELL_NR)"
            >
              {vinCheck ?? "—"}
            </span>
          </div>
        </label>

        <div class="rounded border border-divider bg-base p-2 text-xs">
          <p class="mb-1 font-semibold uppercase tracking-wider text-faint">FAHRGESTELL_NR (computed)</p>
          <p class="font-mono text-foreground">{fgnr || "—"}</p>
        </div>

        <!-- Target ECU list — checkboxes pre-write, status pills during/post-write. -->
        <div class="rounded border border-divider bg-base p-2">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">
            Target ECUs
            {#if fgnrTargets !== undefined}
              · {fgnrTargets.length} found
              {#if !writing && results.size === 0}
                · {selectedCount} selected
              {/if}
            {/if}
          </p>
          {#if fgnrTargets === undefined}
            <p class="text-xs text-faint italic">
              Scanning {candidateSgs.length} identity-master ECU CABD{candidateSgs.length === 1 ? "" : "s"} for FAHRGESTELL_NR FSWs…
            </p>
          {:else if fgnrTargets.length === 0}
            <p class="text-xs text-rose-700 dark:text-rose-300">
              No ECU on <span class="font-mono">{app.chassis?.code}</span>
              declares <span class="font-mono">FAHRGESTELL_NR</span> in its CABD.
              VIN write isn't supported on this chassis through ncsx.
            </p>
          {:else}
            <ul class="space-y-1">
              {#each fgnrTargets as row (row.sgName)}
                {@const status = results.get(row.sgName)}
                <li class="flex items-center justify-between gap-2 text-xs">
                  <label class="flex min-w-0 flex-1 items-center gap-2 {writing || results.size > 0 ? 'cursor-default' : 'cursor-pointer'}">
                    {#if results.size === 0 && !writing}
                      <input
                        type="checkbox"
                        checked={selected.has(row.sgName)}
                        onchange={() => toggle(row.sgName)}
                      />
                    {:else if status?.kind === "ok"}
                      <span class="inline-flex h-4 w-4 items-center justify-center text-emerald-600 dark:text-emerald-400">✓</span>
                    {:else if status?.kind === "error"}
                      <span class="inline-flex h-4 w-4 items-center justify-center text-rose-600 dark:text-rose-400">✗</span>
                    {:else if status?.kind === "writing"}
                      <span class="inline-flex h-4 w-4 items-center justify-center text-amber-600 dark:text-amber-400">⟳</span>
                    {:else}
                      <span class="inline-flex h-4 w-4 items-center justify-center text-faint">·</span>
                    {/if}
                    <span class="min-w-0">
                      <span class="font-semibold text-foreground">{row.sgName}</span>
                      <span class="ml-2 font-mono text-faint">{row.sgbd}</span>
                      {#if status?.kind === "ok"}
                        <span class="ml-2 text-faint">({status.durationMs} ms)</span>
                      {:else if status?.kind === "writing"}
                        <span class="ml-2 text-faint italic">writing…</span>
                      {:else if status?.kind === "pending"}
                        <span class="ml-2 text-faint italic">queued</span>
                      {/if}
                    </span>
                  </label>
                  {#if status?.kind === "error"}
                    <button
                      class="rounded border border-divider px-2 py-0.5 text-xs text-muted hover:border-accent hover:bg-elevated disabled:opacity-40"
                      onclick={() => retry(row)}
                      disabled={writing}
                      title={status.message}
                    >
                      retry
                    </button>
                  {/if}
                </li>
                {#if status?.kind === "error"}
                  <li class="ml-6 text-xs text-rose-700 dark:text-rose-300 break-all">
                    {status.message}
                  </li>
                {/if}
              {/each}
            </ul>
          {/if}
        </div>

        <p class="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-muted">
          <span class="font-semibold">Heads up:</span> ECUs typically
          store only a SUBSET of the VIN (e.g. chars 11..17 — the
          production sequence). The rest stays where the chassis
          assumes them (<code class="font-mono">WBAAA00000</code>
          padding convention). Chars 13..17 must be digits in those
          slots — non-digits will be rejected by the SGBD.
        </p>

        {#if lengthError}
          <p class="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs">
            <span class="font-semibold">Invalid:</span> {lengthError}.
          </p>
        {/if}

        {#if writeError}
          <p class="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
            {writeError}
          </p>
        {/if}

        {#if allOk}
          <p class="rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300">
            All ECUs accepted the write. Dialog closing…
          </p>
        {/if}
      </div>

      <footer class="flex items-center justify-between gap-2 border-t border-divider bg-elevated/50 px-4 py-2">
        <span class="text-xs text-faint">
          {#if writing}
            writing…
          {:else if fgnrTargets === undefined}
            resolving targets…
          {:else if fgnrTargets.length === 0}
            no targets available
          {:else if results.size > 0}
            done · {[...results.values()].filter((s) => s.kind === "ok").length} ok / {[...results.values()].filter((s) => s.kind === "error").length} failed
          {:else}
            {selectedCount} of {fgnrTargets.length} selected
          {/if}
        </span>
        <div class="flex items-center gap-2">
          <button
            class="rounded border border-rule px-2 py-0.5 text-xs text-muted hover:bg-elevated hover:text-foreground"
            onclick={close}
            disabled={writing}
          >
            Close
          </button>
          <button
            class="rounded bg-accent px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
            onclick={commit}
            disabled={writing || fgnrTargets === undefined || fgnrTargets.length === 0 || selectedCount === 0 || connection.status.kind !== "connected" || lengthError !== null}
            title={connection.status.kind !== "connected"
              ? "Connect to the ECU first"
              : fgnrTargets === undefined
                ? "Resolving targets…"
                : fgnrTargets.length === 0
                  ? "No ECU stores FGNR on this chassis"
                  : selectedCount === 0
                    ? "Select at least one ECU"
                    : lengthError !== null
                      ? lengthError
                      : `Dispatch FGNR_SCHREIBEN to ${selectedCount} ECU${selectedCount === 1 ? "" : "s"}`}
          >
            {writing ? "Writing…" : `Write to ${selectedCount} selected`}
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}
