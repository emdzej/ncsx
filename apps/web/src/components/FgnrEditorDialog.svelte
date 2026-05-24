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
  import { mod36Checksum } from "@emdzej/ncsx-identity";
  import { buildFunctionList } from "@emdzej/ncsx-function-list";
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { loadIpoBytes, startNcsRuntime } from "../lib/runtime.svelte";
  import { findPhysicalModule, formatCi } from "../lib/process-ecu";
  import WriteTargetList, { type WriteStatus } from "./WriteTargetList.svelte";

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

  /**
   * Candidate rows — every SGFAM entry with a CABD+SGBD, regardless
   * of identity-master flags. The FAHRGESTELL_NR FSW set isn't
   * confined to FA/ZCS-master ECUs on every chassis (e.g. E46 LSZ
   * has FA=0 / ZCS=0 in SGFAM but still stores the VIN in its
   * coding region). Filtering by flag misses those — the only
   * reliable check is "does this ECU's CABD declare FAHRGESTELL_NR
   * FSWs", which `resolveFgnrTargets` does.
   *
   * Cost: ~30 parallel CABD loads on a typical chassis, each a
   * small file read + parse (CabdLoader caches both the directory
   * listing and the parsed DatenFiles). The user-visible scan
   * completes in ~50-100ms after the first open.
   */
  const candidateSgs = $derived.by<SgfamRow[]>(() => {
    if (!app.chassis) return [];
    const seen = new Set<string>();
    const out: SgfamRow[] = [];
    for (const row of app.chassis.sgfam.values()) {
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
  /**
   * Scan candidates by probing their IPO file for the
   * "FGNR_SCHREIBEN" jobname string. The string appears in any IPO
   * that dispatches that jobname — regardless of write style. Two
   * styles in the wild:
   *
   *   - Slot-driven (KMB_E46): IPO's Cod uses
   *     `CDHGetFswDataFromCbd("FAHRGESTELL_NR")` to load FSW
   *     metadata from CABD, then writes via the slot-table-driven
   *     C_S_AUFTRAG. Requires CABD to declare FAHRGESTELL_NR[*]
   *     FSWs. Host needs to call setNettoSlots() before dispatch.
   *
   *   - Param-driven (LSZ, EWS, likely others): IPO's Cod uses
   *     `CDHGetCabdPar("FAHRGESTELL_NR")` to read the host-seeded
   *     value directly, passes it to C_FG_AUFTRAG as a single
   *     string parameter. No CABD FSWs needed; no slot-table
   *     needed. Host just calls runCabimain — the cabd-par seed
   *     is already done by `runtime.svelte.ts`.
   *
   * `writeOne` below detects which style to use by checking the
   * built slot list — empty slots → fall back to param-driven path
   * (just runCabimain, no setNettoSlots).
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
      if (!row.cabd) return;
      try {
        // Load the IPO bytes once and string-search for the jobname.
        // Much cheaper than parsing the full IPO + walking cabimain.
        // BMW's IPOs store string constants as null-terminated
        // ASCII in the constants section, so a UTF-8 byte search
        // catches them verbatim.
        const ipo = await loadIpoBytes(row.cabd);
        if (containsAscii(ipo, "FGNR_SCHREIBEN")) matched.push(row);
      } catch {
        // IPO load failed (file missing, source error). Skip — this
        // ECU's IPO either doesn't exist on disk or can't be read,
        // so it can't be a write target anyway.
      }
    });
    await Promise.all(probes);
    matched.sort((a, b) => a.sgName.localeCompare(b.sgName));
    fgnrTargets = matched;
    selected = new Set(matched.map((r) => r.sgName));
    results = new Map();
  }

  /**
   * Byte-search a Uint8Array for an ASCII substring. IPO string
   * constants are stored as plain ASCII so encoding the needle as
   * UTF-8 char codes and Boyer-Moore-Horspool-or-naive-search the
   * haystack works. Naive search is fine here — IPOs are < 1 MB
   * and the needle is short (e.g. "FGNR_SCHREIBEN" = 14 bytes), so
   * worst-case O(n*m) is ~14 MB ops on a 1 MB IPO. Imperceptible.
   */
  function containsAscii(haystack: Uint8Array, needle: string): boolean {
    if (needle.length === 0) return true;
    const target = new Uint8Array(needle.length);
    for (let i = 0; i < needle.length; i++) target[i] = needle.charCodeAt(i);
    const end = haystack.length - needle.length;
    outer: for (let i = 0; i <= end; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== target[j]) continue outer;
      }
      return true;
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
    // Run IDENT against THIS ECU — NOT app.selectedModule's CI. In a
    // multi-target write each ECU has its own coding index; using the
    // selected-module CI across the board would open the wrong .Cxx
    // for every ECU except the one the user happened to have selected
    // (e.g. CI=8 for KMB might be 0x34 for LSZ). The IDENT round trip
    // is cheap (~50-100ms) and is the only way to know the live CI per
    // ECU.
    const ci = await readCodingIndex(sg.sgbd, sg.cabd);
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
    // Build slots if the CABD declares FAHRGESTELL_NR FSWs (slot-
    // driven IPO style, e.g. KMB). Empty slot list is fine — means
    // this is a param-driven IPO (LSZ, EWS) that reads the value
    // straight from the FAHRGESTELL_NR cabd-par (already seeded by
    // runtime.svelte.ts).
    const built = buildSlotsFromValues(list, { values });
    const wortBreite = list.memoryStructure === "BYTE" ? 1 : 2;
    const handle = await startNcsRuntime({
      cabdBasename: sg.cabd,
      sgbd: sg.sgbd,
    });
    try {
      if (built.slots.length > 0) {
        handle.cabi.setNettoSlots(built.slots);
        await handle.cabi.CDHSetDataOrg(wortBreite, 0, 0);
      }
      // For param-driven IPOs, the FAHRGESTELL_NR cabd-par seed in
      // runtime.svelte.ts's FGNR_SCHREIBEN branch is the data
      // channel — but it reads from `app.identity.vin`. We need to
      // make sure that holds the value the user just typed BEFORE
      // the dispatch. Set it on the cabi-provider directly so the
      // dispatch picks it up without needing to mutate the global
      // identity (which we only update on full-success).
      await handle.cabi.CDHSetCabdPar(
        "FAHRGESTELL_NR",
        fgnr,
      );
      await handle.runCabimain("FGNR_SCHREIBEN");
      const status = handle.cabi.lastJobStatus;
      if (status !== "OKAY") {
        throw new Error(`JOB_STATUS=${status || "(missing)"}`);
      }
    } finally {
      await handle.dispose();
    }
  }

  /**
   * Inline IDENT to read ID_COD_INDEX. The SGBD reports it as the hex
   * digits that appear in the CABD filename (e.g. "34" for LSZ.C34),
   * not the decimal byte value — so parse as base 16. KMB.C08 happens
   * to be ambiguous (8 = 0x08), but LSZ.C34 makes the difference
   * visible: decoded as decimal we'd look up "C22" and miss.
   */
  async function readCodingIndex(sgbd: string, cabdBasename: string): Promise<number | null> {
    const handle = await startNcsRuntime({ cabdBasename, sgbd });
    try {
      await handle.cabi.CDHapiJob(sgbd, "IDENT", "", "");
      const raw = handle.cabi.findResult("ID_COD_INDEX");
      const digits = typeof raw === "number" ? raw.toString() : typeof raw === "string" ? raw.trim() : "";
      if (!digits) return null;
      const parsed = Number.parseInt(digits, 16);
      return Number.isFinite(parsed) ? parsed : null;
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

        <WriteTargetList
          targets={fgnrTargets}
          {selected}
          {results}
          {writing}
          candidateCount={candidateSgs.length}
          scanFor="FGNR_SCHREIBEN dispatch"
          emptyMessage={`No IPO on ${app.chassis?.code ?? "this chassis"} dispatches FGNR_SCHREIBEN. VIN write isn't supported on this chassis.`}
          onToggle={toggle}
          onRetry={retry}
          onSelectAll={() => {
            if (fgnrTargets) selected = new Set(fgnrTargets.map((r) => r.sgName));
          }}
          onSelectNone={() => {
            selected = new Set();
          }}
        />

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
