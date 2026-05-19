<script lang="ts">
  import type {
    FunctionItem,
    FunctionListItem,
    Parameter,
    PropertyItem,
    UnoccupiedItem,
  } from "@emdzej/ncsx-function-list";
  import {
    applyPswToNetto,
    decodeCurrentPsw,
  } from "@emdzej/ncsx-function-list";
  import type { CodingPlan } from "@emdzej/ncsx-coder";
  import { applyCodingPlan, readCoding } from "@emdzej/ncsx-wire";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";

  let filter = $state("");
  let reading = $state(false);
  let applying = $state(false);

  /**
   * Pending PSW changes keyed by FSW id. Empty after every Read/Apply — we only keep
   * entries where the user actively picked something different from the SG's current
   * coding, so we can drive the "N pending" badge without scanning the whole netto.
   */
  let targets = $state<Record<number, number>>({});

  /** Translation lookup (or undefined while the CSV is still loading). */
  const tr = $derived(app.translations?.entries);

  function describe(keyword: string): { keyword: string; translation: string | null } {
    const t = tr?.get(keyword);
    return { keyword, translation: t && t !== "" ? t : null };
  }

  const items = $derived(app.functionList?.items ?? []);
  const filtered = $derived(
    filter.length === 0
      ? items
      : items.filter((item) => matchesFilter(item, filter.toLowerCase())),
  );

  function matchesFilter(item: FunctionListItem, q: string): boolean {
    if (item.kind === "function") {
      if (item.fswKeyword.toLowerCase().includes(q)) return true;
      if ((tr?.get(item.fswKeyword) ?? "").toLowerCase().includes(q)) return true;
      return item.parameters.some(
        (p) =>
          p.pswKeyword.toLowerCase().includes(q) ||
          (tr?.get(p.pswKeyword) ?? "").toLowerCase().includes(q),
      );
    }
    if (item.kind === "property") {
      return (
        item.fswKeyword.toLowerCase().includes(q) ||
        (tr?.get(item.fswKeyword) ?? "").toLowerCase().includes(q)
      );
    }
    if (item.kind === "group") {
      return (
        item.description.toLowerCase().includes(q) ||
        (tr?.get(item.description) ?? "").toLowerCase().includes(q)
      );
    }
    return false;
  }

  const stats = $derived({
    functions: items.filter((i) => i.kind === "function").length,
    properties: items.filter((i) => i.kind === "property").length,
    unoccupied: items.filter((i) => i.kind === "unoccupied").length,
    groups: items.filter((i) => i.kind === "group").length,
  });

  /** Look up a FunctionItem by FSW id — used by the pending-edits summary. */
  const fnByFsw = $derived.by(() => {
    const map = new Map<number, FunctionItem>();
    for (const it of items) {
      if (it.kind === "function") map.set(it.fsw, it);
    }
    return map;
  });

  /**
   * The PSW currently coded on the ECU for each FSW. Computed once per netto-read so
   * every row can show the right "current" indicator without re-running the decode each
   * render. `null` entries mean the netto is too short for that FSW's slot or the SG
   * is sitting on a custom value not in the PSW enumeration.
   */
  const currentPswByFsw = $derived.by(() => {
    const map = new Map<number, Parameter | null>();
    const netto = app.lastReadNetto;
    if (!netto) return map;
    for (const it of items) {
      if (it.kind === "function") map.set(it.fsw, decodeCurrentPsw(it, netto));
    }
    return map;
  });

  /**
   * Netto bytes after every pending edit is spliced in — what we'd send if the user
   * hit Apply right now. `null` when nothing has been read yet (Apply is gated on this).
   */
  const pendingNetto = $derived.by(() => {
    if (!app.lastReadNetto) return null;
    let netto = app.lastReadNetto;
    for (const [fswStr, psw] of Object.entries(targets)) {
      const fsw = Number(fswStr);
      const item = fnByFsw.get(fsw);
      if (!item) continue;
      const param = item.parameters.find((p) => p.psw === psw);
      if (!param) continue;
      netto = applyPswToNetto(item, param, netto);
    }
    return netto;
  });

  /** Concrete list of edits the user has lined up — used for the confirm dialog. */
  const pendingEdits = $derived.by(() => {
    const out: Array<{
      item: FunctionItem;
      from: Parameter | null;
      to: Parameter;
    }> = [];
    for (const [fswStr, psw] of Object.entries(targets)) {
      const fsw = Number(fswStr);
      const item = fnByFsw.get(fsw);
      if (!item) continue;
      const to = item.parameters.find((p) => p.psw === psw);
      if (!to) continue;
      out.push({ item, from: currentPswByFsw.get(fsw) ?? null, to });
    }
    return out;
  });

  /** Bytes that differ between read-back netto and pending netto. Drives the diff list. */
  const byteDiff = $derived.by(() => {
    const before = app.lastReadNetto;
    const after = pendingNetto;
    if (!before || !after) return [];
    const out: Array<{ offset: number; before: number; after: number }> = [];
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) {
      const a = before[i] ?? 0;
      const b = after[i] ?? 0;
      if (a !== b) out.push({ offset: i, before: a, after: b });
    }
    return out;
  });

  function setTarget(item: FunctionItem, param: Parameter): void {
    const current = currentPswByFsw.get(item.fsw);
    if (current && current.psw === param.psw) {
      // Clicking the current PSW clears the edit — nothing to write.
      delete targets[item.fsw];
    } else {
      targets[item.fsw] = param.psw;
    }
  }

  function discardEdits(): void {
    targets = {};
  }

  function back(): void {
    app.functionList = null;
    app.selectedSg = null;
    app.selectedModule = null;
    app.lastReadNetto = null;
    targets = {};
    app.view = "browse-modules";
  }

  const canRead = $derived(
    connection.status.kind === "connected" && app.selectedModule?.sgbd != null,
  );

  const canApply = $derived(
    connection.status.kind === "connected" &&
      app.selectedModule?.sgbd != null &&
      pendingNetto != null &&
      pendingEdits.length > 0,
  );

  async function onReadFromEcu(): Promise<void> {
    if (!connection.session || !app.selectedModule?.sgbd) return;
    reading = true;
    app.error = null;
    try {
      const result = await readCoding(connection.session.ediabas, app.selectedModule.sgbd);
      if (!result.ok) {
        app.error = `Read failed: ${result.error ?? result.jobStatus}`;
        return;
      }
      app.lastReadNetto = result.netto ?? null;
      targets = {}; // discard any pending edits — the new netto might already have them
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    } finally {
      reading = false;
    }
  }

  /**
   * Build a minimal CodingPlan (only `sgbd`, `sgName`, `netto`, `jobName` are required by
   * `wire.applyCodingPlan`) and hand it to the ECU. After the SG accepts it we re-read the
   * netto so the UI reflects what's actually on the bus — and so a stuck-at-old-value SG
   * shows up immediately instead of silently looking applied.
   */
  async function onApplyToEcu(): Promise<void> {
    if (!connection.session || !pendingNetto || !app.selectedModule?.sgbd) return;
    const summary = pendingEdits
      .map(
        (e) =>
          `  ${e.item.fswKeyword || `FSW#${e.item.fsw}`}: ${
            e.from?.pswKeyword || "(unknown)"
          } → ${e.to.pswKeyword || `PSW#${e.to.psw}`}`,
      )
      .join("\n");
    const ok = window.confirm(
      `Write ${pendingEdits.length} change(s) to ${app.selectedModule.sgbd}?\n\n${summary}\n\nThis will issue SG_CODIEREN.`,
    );
    if (!ok) return;
    applying = true;
    app.error = null;
    try {
      const plan: CodingPlan = {
        sgName: app.selectedModule.moduleName,
        umrsg: app.selectedModule.umrsg ?? "",
        sgbd: app.selectedModule.sgbd,
        cabd: "",
        cbd: `C${app.selectedModule.codingIndex.toString(16).padStart(2, "0").toUpperCase()}`,
        jobName: "SG_CODIEREN",
        netto: pendingNetto,
        applied: [],
        skipped: [],
        source: "SGBD",
      };
      const result = await applyCodingPlan(connection.session.ediabas, plan);
      if (!result.ok) {
        app.error = `Write failed: ${result.error ?? result.jobStatus}`;
        return;
      }
      targets = {};
      const refresh = await readCoding(
        connection.session.ediabas,
        app.selectedModule.sgbd,
      );
      if (refresh.ok) app.lastReadNetto = refresh.netto ?? null;
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    } finally {
      applying = false;
    }
  }

  const fmtAddr = (n: number): string => n.toString(16).toUpperCase().padStart(8, "0");
  const fmtByte = (b: number): string => b.toString(16).toUpperCase().padStart(2, "0");
  const fmtMask = (m: Uint8Array): string => Array.from(m, fmtByte).join(" ");
  const fmtData = (d: Uint8Array): string => Array.from(d, fmtByte).join(" ");

  function propertySummary(item: PropertyItem | UnoccupiedItem): string {
    return `${fmtAddr(item.address)} · len ${item.length} · mask ${fmtMask(item.mask)}`;
  }
</script>

<div class="mx-auto max-w-5xl p-6">
  <div class="mb-4 flex items-baseline justify-between gap-2">
    <div>
      <h2 class="text-2xl font-bold text-foreground">{app.selectedSg}</h2>
      <p class="mt-1 text-xs text-faint">
        {app.functionList?.memoryStructure} ·
        {stats.functions} functions ·
        {stats.properties} properties ·
        {stats.unoccupied} unoccupied ·
        {stats.groups} groups
      </p>
    </div>
    <div class="flex items-center gap-3">
      <button
        class="rounded border border-divider bg-surface px-2 py-1 text-xs text-muted transition hover:border-accent hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
        onclick={onReadFromEcu}
        disabled={!canRead || reading || applying}
        title={canRead
          ? `Issue CODIERDATEN_LESEN against ${app.selectedModule?.sgbd}`
          : connection.status.kind !== "connected"
            ? "Connect to ECU first"
            : "No SGBD resolved for this module"}
      >
        {reading ? "Reading…" : "Read from ECU"}
      </button>
      <button
        class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
        onclick={back}
      >
        ← back to modules
      </button>
    </div>
  </div>

  <input
    type="search"
    placeholder="Filter — keyword or English (e.g. KEYCARDREADER, enabled)"
    bind:value={filter}
    class="mb-4 w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
  />

  {#if pendingEdits.length > 0}
    <section
      class="mb-4 rounded border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-foreground"
    >
      <div class="mb-2 flex items-baseline justify-between gap-2">
        <span class="font-semibold">
          {pendingEdits.length} pending change{pendingEdits.length === 1 ? "" : "s"} · {byteDiff.length}
          byte{byteDiff.length === 1 ? "" : "s"} differ
        </span>
        <div class="flex items-center gap-2">
          <button
            class="rounded border border-amber-500/60 bg-amber-500/20 px-2 py-0.5 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            onclick={onApplyToEcu}
            disabled={!canApply || applying || reading}
            title={canApply
              ? `Issue SG_CODIEREN against ${app.selectedModule?.sgbd}`
              : connection.status.kind !== "connected"
                ? "Connect to ECU first"
                : "Read the SG first so we have a current netto"}
          >
            {applying ? "Writing…" : "Apply to ECU"}
          </button>
          <button
            class="text-faint underline-offset-2 hover:text-muted hover:underline"
            onclick={discardEdits}
          >
            discard
          </button>
        </div>
      </div>
      <ul class="space-y-0.5 font-mono">
        {#each byteDiff as d (d.offset)}
          <li>
            <span class="text-faint">{fmtAddr(d.offset)}</span> · {fmtByte(d.before)}
            <span class="text-faint">→</span>
            <span class="font-semibold text-foreground">{fmtByte(d.after)}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <p class="mb-2 text-xs text-faint">
    {app.lastReadNetto
      ? "Click a PSW to stage an edit. Apply writes SG_CODIEREN."
      : "Read from the ECU to see current state and enable editing."}
  </p>

  <ul class="space-y-1">
    {#each filtered as item, i (i)}
      {#if item.kind === "function"}
        {@const fn = describe(item.fswKeyword || `FSW #${item.fsw}`)}
        {@const current = currentPswByFsw.get(item.fsw)}
        {@const targetPsw = targets[item.fsw]}
        {@const pending = targetPsw !== undefined}
        <li
          class="rounded border px-3 py-2 {pending
            ? 'border-amber-500/60 bg-amber-500/5'
            : 'border-divider bg-surface'}"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-semibold text-foreground">
              {#if pending}<span class="mr-1 text-amber-500" title="pending edit">★</span>{/if}
              {fn.keyword}{#if fn.translation}
                <span class="ml-2 text-xs font-normal text-faint">— {fn.translation}</span>
              {/if}
            </span>
            <span class="text-xs text-faint">
              {fmtAddr(item.address)} · len {item.length} · mask {fmtMask(item.mask)}
            </span>
          </div>
          <ul class="ml-4 mt-1 space-y-0.5">
            {#each item.parameters as p, pi (pi)}
              {@const param = describe(p.pswKeyword || `PSW #${p.psw}`)}
              {@const isCurrent = current?.psw === p.psw}
              {@const isTarget = pending ? targetPsw === p.psw : isCurrent}
              <li class="flex items-baseline justify-between gap-2 text-sm">
                <button
                  type="button"
                  class="flex items-baseline gap-1.5 text-left {isTarget
                    ? 'text-foreground'
                    : 'text-muted'} hover:text-foreground disabled:cursor-not-allowed disabled:hover:text-muted"
                  onclick={() => setTarget(item, p)}
                  disabled={!app.lastReadNetto}
                  title={app.lastReadNetto
                    ? isCurrent
                      ? "Currently coded — click again to clear a pending edit"
                      : "Stage this PSW"
                    : "Read from the ECU first"}
                >
                  <span class="inline-block w-3 text-center" aria-hidden="true">
                    {isTarget ? "●" : "○"}
                  </span>
                  <span>
                    {param.keyword}{#if param.translation}
                      <span class="ml-1 text-xs text-faint">— {param.translation}</span>
                    {/if}
                    {#if isCurrent && pending}
                      <span class="ml-1 text-xs text-faint">(current)</span>
                    {/if}
                  </span>
                </button>
                <span class="text-xs text-faint">{fmtData(p.data)}</span>
              </li>
            {/each}
            {#if current === null && app.lastReadNetto}
              <li class="text-xs text-faint">
                ⚠ netto value doesn't match any enumerated PSW — manual coding history
              </li>
            {/if}
          </ul>
        </li>
      {:else if item.kind === "property"}
        {@const prop = describe(item.fswKeyword || `PROPERTY #${item.fsw}`)}
        <li class="rounded border border-divider bg-surface px-3 py-2">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-semibold text-foreground">
              {prop.keyword}{#if prop.translation}
                <span class="ml-2 text-xs font-normal text-faint">— {prop.translation}</span>
              {/if}
            </span>
            <span class="text-xs text-faint">{propertySummary(item)} · unit {item.unit || "h"}</span>
          </div>
        </li>
      {:else if item.kind === "unoccupied"}
        <li class="rounded border border-divider bg-surface/60 px-3 py-1 text-xs text-faint">
          ⟨unoccupied⟩ {propertySummary(item)}
        </li>
      {:else if item.kind === "group"}
        {@const g = describe(item.description)}
        <li class="mt-3 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
          {item.groupKind} · {g.keyword}{#if g.translation}
            <span class="ml-1 normal-case font-normal text-faint">— {g.translation}</span>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>

  {#if filtered.length === 0}
    <p class="mt-4 text-sm text-faint">No items match "{filter}".</p>
  {/if}

  {#if app.lastReadNetto}
    <section class="mt-6 rounded border border-divider bg-surface p-3 text-xs">
      <div class="mb-2 flex items-baseline justify-between gap-2">
        <span class="font-semibold text-foreground">
          Current ECU netto ({app.lastReadNetto.length} bytes)
        </span>
        <span class="text-faint">
          {app.selectedModule?.sgbd} · CODIERDATEN_LESEN
        </span>
      </div>
      <pre class="overflow-x-auto whitespace-pre-wrap break-all font-mono text-faint">{
        Array.from(app.lastReadNetto, (b) =>
          b.toString(16).toUpperCase().padStart(2, "0"),
        )
          .reduce<string[]>((rows, byte, i) => {
            if (i % 16 === 0) rows.push("");
            rows[rows.length - 1] += (i % 16 === 0 ? "" : " ") + byte;
            return rows;
          }, [])
          .map((row, i) =>
            `${(i * 16).toString(16).toUpperCase().padStart(8, "0")}  ${row}`,
          )
          .join("\n")
      }</pre>
    </section>
  {/if}
</div>
