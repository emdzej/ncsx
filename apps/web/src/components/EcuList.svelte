<script lang="ts">
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";
  import { getLogger } from "@emdzej/bimmerz-logger";
  import { faToAsw } from "@emdzej/ncsx-fa-asw";
  import { selectEcus } from "@emdzej/ncsx-ecu-select";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { processEcu, formatCi } from "../lib/process-ecu";

  const log = getLogger("NCSX.web.ecu-list");

  /**
   * Per-row state — what's happening with each SGFAM entry. Keyed by
   * `sgName` since that's the natural identity (`row.cabd` /
   * `row.sgbd` can be the same across logical SGs).
   *
   * Flow per row: `idle → reading → done | error`. `done` carries the
   * resolved CI + `.Cxx` filename so the user sees which variant got
   * auto-picked without having to jump to the FunctionTree view first.
   */
  type RowState =
    | { kind: "idle" }
    | { kind: "reading" }
    | { kind: "done"; ci: number; moduleName: string; sgbd: string }
    | { kind: "error"; message: string };

  let rowStates = $state<Record<string, RowState>>({});
  /** Active query string in the searchable combobox. */
  let query = $state("");
  /** Whether the dropdown panel is visible. */
  let open = $state(false);
  /**
   * When `true`, hide SGs whose FA-predicate doesn't evaluate against
   * the currently-read identity ASW — i.e. only show ECUs the car
   * actually has. Mirrors NCSEXPER's filtered selection. Off by
   * default so the user always sees the full chassis catalog on
   * cold start; flips on automatically once an FA/ZCS read has
   * populated `app.identity`.
   */
  let filterByFa = $state(false);
  const reading = $derived(
    Object.values(rowStates).some((s) => s.kind === "reading"),
  );
  const canConnect = $derived(connection.status.kind === "connected");

  /**
   * SGs the loaded chassis + currently-read FA say are installed in
   * the car. Pipeline:
   *
   *   FA string → `tokenizeFa` → `faToAsw` against chassis.at/SWTASW
   *     → AswSet → `selectEcus` walks SGAUSWAHL_* and evaluates each
   *       row's AUFTRAGSAUSDRUCK predicate against the ASW
   *
   * Returns a Set of UMRSG names (the logical SG identity that
   * matches `SgfamRow.sgName`). Empty Set when no FA has been read
   * yet — UI falls back to the unfiltered SGFAM list.
   */
  const installedUmrsgs = $derived.by<Set<string>>(() => {
    const out = new Set<string>();
    if (!app.chassis || !app.identity?.fa) return out;
    try {
      const asw = faToAsw(app.identity.fa, { chassis: app.chassis });
      const selected = selectEcus(app.chassis, asw);
      for (const sg of selected) out.add(sg.umrsg);
    } catch (err) {
      log.warn({ err }, "FA→ASW resolution failed");
    }
    return out;
  });
  const haveFaFilter = $derived(installedUmrsgs.size > 0);
  // Once a usable filter is available, default to "filtered" view so
  // the user lands on the SGs that are actually in the car.
  $effect(() => {
    if (haveFaFilter) filterByFa = true;
  });

  /**
   * SGFAM rows for the active chassis, alphabetically sorted. We show
   * every entry — not the FA/ZCS-master subset IdentityPanel uses —
   * because "Process ECU" is the whole-fleet coding entry point.
   */
  const rows = $derived.by<SgfamRow[]>(() => {
    if (!app.chassis) return [];
    return [...app.chassis.sgfam.values()].sort((a, b) =>
      a.sgName.localeCompare(b.sgName),
    );
  });

  /**
   * Rows matching the query *and* (optionally) the FA filter. When
   * `filterByFa` is on and the resolver succeeded, drop rows whose
   * UMRSG isn't in the car. The query then filters within whatever
   * subset remained.
   */
  const filtered = $derived.by<SgfamRow[]>(() => {
    const q = query.trim().toLowerCase();
    let pool = rows;
    if (filterByFa && haveFaFilter) {
      pool = pool.filter((r) => installedUmrsgs.has(r.sgName));
    }
    if (q.length === 0) return pool;
    return pool.filter(
      (r) =>
        r.sgName.toLowerCase().includes(q) ||
        (r.sgbd ?? "").toLowerCase().includes(q),
    );
  });

  async function onPick(row: SgfamRow): Promise<void> {
    if (!app.chassis || !connection.session || reading) return;
    if (!row.cabd || !row.sgbd) {
      rowStates[row.sgName] = {
        kind: "error",
        message: "SGFAM row missing CABD or SGBD",
      };
      return;
    }
    // Close the dropdown + pin the selection in the input so users
    // see what they just clicked while the read is in flight.
    open = false;
    query = row.sgName;
    rowStates[row.sgName] = { kind: "reading" };
    app.error = null;
    try {
      const res = await processEcu(app.chassis, row);
      if (res.ok && res.codingIndex !== undefined && res.moduleName && res.sgbd) {
        rowStates[row.sgName] = {
          kind: "done",
          ci: res.codingIndex,
          moduleName: res.moduleName,
          sgbd: res.sgbd,
        };
        // processEcu already flipped app.view → "view-module" on success.
      } else {
        rowStates[row.sgName] = {
          kind: "error",
          message: res.error ?? "Process failed",
        };
      }
    } catch (err) {
      rowStates[row.sgName] = {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Last-touched row state, for the inline result line under the
   * input. Most users only process one ECU at a time so a single
   * line is enough — we surface whichever row has the freshest
   * non-idle state.
   */
  const lastState = $derived.by<
    | { row: string; state: Exclude<RowState, { kind: "idle" }> }
    | undefined
  >(() => {
    for (const [name, s] of Object.entries(rowStates)) {
      if (s.kind !== "idle") return { row: name, state: s };
    }
    return undefined;
  });

  function onBlur(): void {
    // Slight delay so a click on a dropdown row registers before the
    // panel collapses (mousedown on the row fires after blur on the
    // input).
    setTimeout(() => {
      open = false;
    }, 150);
  }
</script>

<section class="rounded border border-divider bg-surface p-3">
  <div class="mb-2 flex items-baseline justify-between gap-2">
    <h3 class="text-sm font-semibold text-foreground">Process ECU</h3>
    <span class="text-xs text-faint">
      {#if filterByFa && haveFaFilter}
        {installedUmrsgs.size} in car · {rows.length} in {app.chassis?.code}
      {:else}
        {rows.length} SGs in {app.chassis?.code}
      {/if}
    </span>
  </div>

  {#if haveFaFilter}
    <label
      class="mb-2 flex items-center gap-2 text-xs text-muted"
      title="Filter by AUFTRAGSAUSDRUCK predicates evaluated against the FA-derived ASW (mirrors NCSEXPER's SG selection)"
    >
      <input type="checkbox" bind:checked={filterByFa} class="accent-accent" />
      <span>
        Only show SGs the FA says are installed
        <span class="text-faint">
          ({installedUmrsgs.size} / {rows.length})
        </span>
      </span>
    </label>
  {/if}

  {#if !canConnect}
    <p class="text-xs text-faint">Connect to the ECU to read its coding index.</p>
  {:else if rows.length === 0}
    <p class="text-xs text-faint">
      No SGs in <span class="font-mono">{app.chassis?.code}</span>'s SGFAM.
    </p>
  {:else}
    <div class="relative">
      <input
        type="search"
        placeholder="Type to filter, click to pick (e.g. KMB, LSZ, EWS)…"
        bind:value={query}
        onfocus={() => (open = true)}
        onblur={onBlur}
        disabled={reading}
        class="w-full rounded border border-rule bg-base px-3 py-1.5 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />

      {#if open && filtered.length > 0}
        <ul
          class="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded border border-divider bg-surface shadow-lg"
        >
          {#each filtered as row (row.sgName)}
            {@const disabled = !row.sgbd || !row.cabd}
            <li>
              <button
                type="button"
                class="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                onmousedown={(e) => {
                  e.preventDefault(); // keep input focus, drives onBlur timing
                  if (!disabled) onPick(row);
                }}
                {disabled}
                title={!row.sgbd
                  ? `SGFAM row for ${row.sgName} has no SGBD`
                  : !row.cabd
                    ? `SGFAM row for ${row.sgName} has no CABD`
                    : `Read CODIERINDEX from ${row.sgName} via ${row.sgbd}`}
              >
                <span class="font-semibold text-foreground">{row.sgName}</span>
                <span class="font-mono text-xs text-faint">{row.sgbd ?? "—"}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if open && filtered.length === 0}
        <div
          class="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-divider bg-surface px-3 py-2 text-xs text-faint shadow-lg"
        >
          No SGs match "{query}".
        </div>
      {/if}
    </div>

    {#if lastState}
      <p class="mt-2 text-xs">
        <span class="font-semibold text-foreground">{lastState.row}</span>
        {#if lastState.state.kind === "reading"}
          <span class="ml-2 text-faint">Reading…</span>
        {:else if lastState.state.kind === "done"}
          <span class="ml-2 text-green-600 dark:text-green-400">
            → {lastState.state.moduleName}.{formatCi(lastState.state.ci)}
          </span>
        {:else if lastState.state.kind === "error"}
          <span class="ml-2 text-red-600 dark:text-red-400">
            {lastState.state.message}
          </span>
        {/if}
      </p>
    {/if}
  {/if}
</section>
