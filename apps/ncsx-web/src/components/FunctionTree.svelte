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
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { processReadCoding, processWriteCoding } from "../lib/process-ecu";
  import { downloadFswPsw, downloadNettodatTrc, parseFswPswMan } from "../lib/fsw-psw-trc";

  let filter = $state("");
  let reading = $state(false);
  let applying = $state(false);
  /**
   * Transient post-read confirmation. Set after a successful Read /
   * Apply-then-readback so the user gets explicit feedback that the
   * job completed (the FunctionList re-renders quietly otherwise).
   * Auto-clears after a few seconds so the banner doesn't linger
   * past its relevance.
   */
  let readStatus = $state<{ kind: "read" | "apply"; summary: string } | null>(
    null,
  );
  let readStatusTimer: ReturnType<typeof setTimeout> | null = null;

  function flashReadStatus(kind: "read" | "apply", summary: string): void {
    readStatus = { kind, summary };
    if (readStatusTimer) clearTimeout(readStatusTimer);
    readStatusTimer = setTimeout(() => {
      readStatus = null;
      readStatusTimer = null;
    }, 6000);
  }

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

  /**
   * Set of every byte address the CABD declares — flattened from
   * FunctionList items the same way `processReadCoding`'s
   * `flattenSlots` does it. Used to highlight which bytes in the raw
   * netto dump came from the SGBD (bold) vs which are deliveryState
   * filler (faint). Recomputed when the FunctionList changes.
   */
  const codingAddresses = $derived.by<Set<number>>(() => {
    const out = new Set<number>();
    if (!app.functionList) return out;
    for (const item of app.functionList.items) {
      for (let off = 0; off < item.length; off++) {
        out.add(item.address + off);
      }
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

  /**
   * Hidden file input — clicked programmatically by the Import button.
   * `bind:this` instead of an `id` so multiple FunctionTree instances
   * on the same page don't collide on the DOM id.
   */
  let manFileInput = $state<HTMLInputElement | null>(null);

  /**
   * Load FSW_PSW.MAN edits into the pending-targets map. Merges with
   * any existing staged edits (the user can hit "discard" first for a
   * clean import). Pairs the parser couldn't resolve are surfaced as
   * a warning toast so it's clear what got skipped — typically caused
   * by a MAN file from a different chassis / CABD variant.
   */
  async function onImportMan(ev: Event): Promise<void> {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the input value so picking the same file twice in a row
    // still fires `change` — without this the second click is a no-op.
    input.value = "";
    if (!file || !app.functionList) return;
    try {
      const text = await file.text();
      const { targets: imported, warnings } = parseFswPswMan(text, app.functionList);
      const importedCount = Object.keys(imported).length;
      if (importedCount === 0 && warnings.length === 0) {
        app.error = `Imported "${file.name}" but it had no FSW/PSW pairs`;
        return;
      }
      // Merge — keep existing user edits, overlay file's edits on top
      // for any FSW the file mentions. NCSEXPER's MAN-load is "apply
      // these on top of current state" semantics.
      targets = { ...targets, ...imported };
      const warnSummary =
        warnings.length > 0
          ? ` · ${warnings.length} skipped (${warnings.slice(0, 3).join("; ")}${warnings.length > 3 ? "; …" : ""})`
          : "";
      flashReadStatus(
        "read",
        `Imported ${importedCount} edit${importedCount === 1 ? "" : "s"} from ${file.name}${warnSummary}`,
      );
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    }
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

  /**
   * Read CODIERDATEN through the per-CABD IPO's `Lesen` dispatcher
   * (matching NCSEXPER), not a direct `apiJob(sgbd, "CODIERDATEN_LESEN")`.
   * The IPO drives the full IDENT → C_S_LESEN → CODIER_DATEN flow and
   * honours any per-CABD nuances (auth gates, CI lookups). We need
   * both the SGFAM row (for the `A_*.ipo` basename) and the resolved
   * SGBD (CI-specific via SGAUSWAHL) — `selectedModule.umrsg` keys the
   * SGFAM row and `selectedModule.sgbd` is the right SGBD for this CI.
   */
  async function onReadFromEcu(): Promise<void> {
    if (
      !connection.session ||
      !app.selectedModule?.sgbd ||
      !app.chassis ||
      !app.functionList
    )
      return;
    const umrsg = app.selectedModule.umrsg;
    const row = umrsg ? app.chassis.sgfam.get(umrsg) : undefined;
    if (!row) {
      app.error = `No SGFAM row for ${umrsg ?? "selected SG"} — can't dispatch via the per-CABD IPO`;
      return;
    }
    reading = true;
    app.error = null;
    try {
      const result = await processReadCoding(
        row,
        app.selectedModule.sgbd,
        app.functionList,
      );
      if (!result.ok) {
        app.error = `Read failed: ${result.error ?? result.jobStatus ?? "(no status)"}`;
        return;
      }
      app.lastReadNetto = result.netto ?? null;
      targets = {};
      // Count active FSWs in the freshly-read netto so the user sees
      // not just "bytes read" but how many real coding decisions are
      // visible. `decodeCurrentPsw` returns null for FSWs the netto
      // doesn't match (rare, but counted separately so a malformed
      // read is obvious).
      let active = 0;
      let unmatched = 0;
      if (result.netto) {
        for (const it of items) {
          if (it.kind !== "function") continue;
          if (decodeCurrentPsw(it, result.netto) === null) unmatched++;
          else active++;
        }
      }
      const sgbd = app.selectedModule.sgbd;
      const len = result.netto?.length ?? 0;
      flashReadStatus(
        "read",
        `Read complete — ${len} bytes from ${sgbd} · ${active} FSW${active === 1 ? "" : "s"} decoded${unmatched > 0 ? `, ${unmatched} unmatched` : ""}`,
      );
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    } finally {
      reading = false;
    }
  }

  /**
   * Apply pending PSW edits through the IPO's `Cod` dispatcher (job
   * `SG_CODIEREN`). The per-CABD A_*.ipo handles the multi-step
   * write protocol: BinBufCreate → IDENT → assembles a C_S_SCHREIBEN
   * (or C_S_AUFTRAG "write+verify") request from the slot table
   * with the pending byte values, sends it, checks JOB_STATUS,
   * optionally runs C_CHECKSUM. We pre-seed the slot table with
   * `pendingNetto` so CDHGetApiJobData's request packet carries the
   * right bytes-to-write in its scratchpad (offset 0x16+) — see the
   * write-mode branch of `CDHGetApiJobData` in
   * `@emdzej/ncsx-inpax-cabi-provider`.
   *
   * `processWriteCoding` auto-re-reads after success so the netto
   * the user sees reflects any auto-checksum / mirror-byte updates
   * the SGBD applied during the write.
   */
  async function onApplyToEcu(): Promise<void> {
    if (
      !connection.session ||
      !pendingNetto ||
      !app.selectedModule?.sgbd ||
      !app.functionList ||
      !app.chassis
    )
      return;
    const umrsg = app.selectedModule.umrsg;
    const row = umrsg ? app.chassis.sgfam.get(umrsg) : undefined;
    if (!row) {
      app.error = `No SGFAM row for ${umrsg ?? "selected SG"} — can't dispatch SG_CODIEREN via the per-CABD IPO`;
      return;
    }
    const summary = pendingEdits
      .map(
        (e) =>
          `  ${e.item.fswKeyword || `FSW#${e.item.fsw}`}: ${
            e.from?.pswKeyword || "(unknown)"
          } → ${e.to.pswKeyword || `PSW#${e.to.psw}`}`,
      )
      .join("\n");
    const ok = window.confirm(
      `Write ${pendingEdits.length} change(s) to ${app.selectedModule.sgbd}?\n\n${summary}\n\nThis will dispatch SG_CODIEREN through ${row.cabd}.IPO.`,
    );
    if (!ok) return;
    applying = true;
    app.error = null;
    try {
      const result = await processWriteCoding(
        row,
        app.selectedModule.sgbd,
        app.functionList,
        pendingNetto,
        // Pass the pre-edit netto so the orchestrator can restrict
        // writes to bytes that actually changed — minimises the
        // chance the ECU rejects on an auto-recomputed byte (e.g.
        // checksum) we didn't refresh.
        { lastReadNetto: app.lastReadNetto ?? undefined },
      );
      if (!result.ok) {
        app.error = `Write failed: ${result.error ?? result.jobStatus ?? "(no status)"}`;
        return;
      }
      targets = {};
      if (result.verifiedNetto) {
        app.lastReadNetto = result.verifiedNetto;
      }
      const verifiedLen = result.verifiedNetto?.length;
      flashReadStatus(
        "apply",
        `Apply complete — wrote ${pendingEdits.length} edit${pendingEdits.length === 1 ? "" : "s"} to ${app.selectedModule.sgbd}${verifiedLen !== undefined ? ` · re-read ${verifiedLen} bytes` : ""}`,
      );
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

  /**
   * Slice the freshly-read netto at the FSW's window and format as hex.
   * Returns `"—"` when the netto hasn't been read yet or is too short
   * for this FSW (incomplete read). Lets the user eyeball the bytes
   * that `decodeCurrentPsw` is matching against — handy when an FSW
   * decodes to an unexpected PSW or `null` (no enumerated match).
   */
  function nettoSliceFor(item: FunctionItem): string {
    const netto = app.lastReadNetto;
    if (!netto) return "—";
    const end = item.address + item.length;
    if (netto.length < end) return "—";
    return fmtData(netto.subarray(item.address, end));
  }

  /**
   * Apply the FSW's mask to the netto slice — same bits
   * `decodeCurrentPsw` compares. Bits outside the mask are zeroed
   * so users see the EXACT bytes the matcher sees (which can
   * differ from the raw netto when sibling FSWs share bytes).
   */
  function nettoMaskedFor(item: FunctionItem): string {
    const netto = app.lastReadNetto;
    if (!netto) return "—";
    const end = item.address + item.length;
    if (netto.length < end) return "—";
    const out = new Uint8Array(item.length);
    for (let i = 0; i < item.length; i++) {
      out[i] = (netto[item.address + i] ?? 0) & (item.mask[i] ?? 0);
    }
    return fmtData(out);
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
      {#if app.selectedModule?.resolution.kind === "auto"}
        {@const r = app.selectedModule.resolution}
        <!--
          Explain why THIS .Cxx was picked. The user dispatched
          `CODIERINDEX_LESEN` against `r.sourceSg`; the IPO returned
          the raw hex `r.codingIndexHex`; we mapped that to the .Cxx
          via SGAUSWAHL. Status is the EDIABAS JOB_STATUS so users
          can spot a degraded read (`OKAY` vs `ERROR_*`).
        -->
        <p class="mt-1 text-xs text-faint">
          Auto-selected via
          <span class="font-mono text-muted">CODIERINDEX_LESEN</span>
          on
          <span class="font-mono text-muted">{r.sourceSg}</span>
          → CODIERINDEX =
          <span class="font-mono text-muted">0x{r.codingIndexHex}</span>
          · status
          <span
            class="font-mono {r.jobStatus === 'OKAY'
              ? 'text-green-600 dark:text-green-400'
              : 'text-muted'}"
          >
            {r.jobStatus || "(unknown)"}
          </span>
        </p>
      {:else if app.selectedModule?.resolution.kind === "manual"}
        <p class="mt-1 text-xs text-faint">
          Manually selected — no <span class="font-mono text-muted">CODIERINDEX_LESEN</span>
          run.
        </p>
      {/if}
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
        class="rounded border border-divider bg-surface px-2 py-1 text-xs text-muted transition hover:border-accent hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
        onclick={() => {
          if (app.functionList && app.lastReadNetto)
            downloadFswPsw("trc", app.functionList, app.lastReadNetto);
        }}
        disabled={!app.functionList || !app.lastReadNetto}
        title={app.lastReadNetto
          ? "Download FSW_PSW.TRC — full snapshot of currently-active FSW/PSW pairs (same format NCSEXPER's coapiTraceFswPsw writes to WORK/)"
          : "Read from the ECU first — TRC mirrors the post-read FSW/PSW state"}
      >
        Export FSW_PSW.TRC
      </button>
      <button
        class="rounded border border-divider bg-surface px-2 py-1 text-xs text-muted transition hover:border-accent hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
        onclick={() => {
          if (app.functionList) downloadFswPsw("man", app.functionList, targets);
        }}
        disabled={!app.functionList || pendingEdits.length === 0}
        title={pendingEdits.length > 0
          ? "Download FSW_PSW.MAN — staged edits only, in NCSdummy's manipulation format. Drop into NCSEXPER's WORK/ and set [FSWPSW].FswPswLeseDatei=FSW_PSW.MAN to have NCSEXPER apply these before SG_CODIEREN."
          : "Stage at least one PSW edit first"}
      >
        Export FSW_PSW.MAN
      </button>
      <!--
        Hidden file input pretends to be a normal button via the
        adjacent `<button>` that calls `.click()`. Keeps the styling
        consistent with the other toolbar buttons (file inputs are
        notoriously hard to theme cross-browser).
      -->
      <input
        type="file"
        accept=".MAN,.man,.txt,text/plain"
        class="hidden"
        bind:this={manFileInput}
        onchange={onImportMan}
      />
      <button
        class="rounded border border-divider bg-surface px-2 py-1 text-xs text-muted transition hover:border-accent hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
        onclick={() => manFileInput?.click()}
        disabled={!app.functionList}
        title={app.functionList
          ? "Import FSW_PSW.MAN — pick a previously-exported MAN file (or one written by NCSEXPER / NCSdummy) and stage every FSW/PSW pair it contains as a pending edit. Existing staged edits are kept; the file's pairs overlay them by FSW id."
          : "Load a module first"}
      >
        Import FSW_PSW.MAN
      </button>
      <button
        class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
        onclick={back}
      >
        ← back to modules
      </button>
    </div>
  </div>

  {#if readStatus}
    <div
      class="mb-4 flex items-baseline justify-between gap-2 rounded border border-green-500/50 bg-green-500/10 px-3 py-2 text-xs text-foreground"
      role="status"
    >
      <span>
        <span class="font-semibold">
          {readStatus.kind === "read" ? "✓ Read complete" : "✓ Apply complete"}
        </span>
        <span class="ml-2 text-faint">
          {readStatus.summary.replace(/^Read complete — |^Apply complete — /, "")}
        </span>
      </span>
      <button
        class="text-faint underline-offset-2 hover:text-muted hover:underline"
        onclick={() => (readStatus = null)}
      >
        dismiss
      </button>
    </div>
  {/if}

  {#if app.lastReadNetto}
    {@const netto = app.lastReadNetto}
    <!--
      Raw netto inspector — the bytes the SGBD just handed back, with
      no decoding. Folded by default so it doesn't dominate the screen
      but is one click away when a PSW decodes to an unexpected value.
      Mirrors NCSDummy's `Nettodata` panel.

      Bytes whose address is in `codingAddresses` (declared by the
      CABD) render bold in the brighter foreground colour — those are
      what the IPO actually requested from the SGBD. Faint bytes are
      filler from `FunctionList.deliveryState` for addresses outside
      the slot table; they're not real ECU data.
    -->
    <details class="mb-4 rounded border border-divider bg-surface text-xs">
      <summary class="flex cursor-pointer select-none items-baseline justify-between gap-2 px-3 py-2">
        <span>
          <span class="font-semibold text-foreground">Raw netto</span>
          <span class="ml-2 text-faint">
            {netto.length} bytes · {codingAddresses.size} from ECU (bold) ·
            rest is deliveryState filler · from {app.selectedModule?.sgbd}
          </span>
        </span>
        <button
          class="rounded border border-divider bg-base px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:bg-elevated"
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            downloadNettodatTrc(netto, codingAddresses);
          }}
          title="Download NETTODAT.TRC — same B <addr>,<count>,<words>… format NCSEXPER's coapiTraceNettoData writes to WORK/. Only the bytes actually requested from the ECU (bold above) are dumped; deliveryState filler is omitted."
        >
          Export NETTODAT.TRC
        </button>
      </summary>
      <pre class="overflow-x-auto border-t border-divider/60 px-3 py-2 font-mono">{#each Array(Math.ceil(netto.length / 16)) as _, row (row)}{@const base = row * 16}<span class="text-faint">{base.toString(16).toUpperCase().padStart(8, "0")}</span>  {#each Array(Math.min(16, netto.length - base)) as _, col (col)}{@const i = base + col}{#if codingAddresses.has(i)}<span class="font-bold text-foreground">{netto[i]!.toString(16).toUpperCase().padStart(2, "0")}</span>{:else}<span class="text-faint">{netto[i]!.toString(16).toUpperCase().padStart(2, "0")}</span>{/if}{col < Math.min(15, netto.length - base - 1) ? " " : ""}{/each}
{/each}</pre>
    </details>
  {/if}

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
          {#if app.lastReadNetto}
            <!--
              Netto slice the matcher actually compares against. Showing
              both raw (everything at this addr/len) and masked (raw &
              mask, the same bits decodeCurrentPsw compares to each
              PSW's `data`) helps users see exactly *why* a PSW
              matched — or didn't. Bytes themselves rendered bold so
              they're easy to read against the labels.
            -->
            <p class="mt-0.5 font-mono text-xs text-faint">
              netto: <span class="font-bold text-foreground">{nettoSliceFor(item)}</span>
              <span class="ml-2">masked: <span class="font-bold text-foreground">{nettoMaskedFor(item)}</span></span>
            </p>
          {/if}
          <ul class="ml-4 mt-1 max-h-64 space-y-0.5 overflow-y-auto pr-1">
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
                <span class="font-mono text-xs text-faint" title="PSW's expected masked data — matches when (netto & mask) === this">
                  {fmtData(p.data)}
                </span>
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
</div>
