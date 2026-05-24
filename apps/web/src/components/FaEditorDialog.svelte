<script lang="ts">
  /**
   * FA editor — structured per-slot UI + multi-target write.
   *
   * BMW's FA wire format breaks down into typed constituents
   * (FA.PRG's FA_STREAM2STRUCT decodes them on read):
   *
   *   BR        chassis prefix       "E46_"     no marker (followed by `_`)
   *   C_DATE    production update    "0303"     `#`
   *   C_TYP     model variant        "BW32"     `*`
   *   LACK      paint code           "0A08"     `%`
   *   POLSTER   upholstery           "N6TT"     `&`
   *   ZUSBAU_*  build orders         "7531125"  `|`  (1+)
   *   SA_*      special equipment    "205"      `$`  (many)
   *
   * The dialog exposes one section per slot. The marker is determined
   * by SLOT, not by AT category — adding a code into the SA section
   * gets `$`, adding into TYPE gets `*`, regardless of what AT thinks
   * the category is. This is the only way to round-trip FA strings
   * without FA.PRG returning ERROR_UNKNOWN_CONSTIT — emitting `$BW32`
   * (SA marker on a type code) makes FA.PRG choke because the value
   * isn't an SA. The previous flat-chip UX hit this routinely.
   *
   * Dictionary availability per slot:
   *   C_DATE   AT Z-category #-prefix entries (sparse — ~4 per chassis)
   *   C_TYP    AT W-category type-shape codes (`^[A-Z]{2}[A-Z0-9]{2}$`)
   *   SA       AT W-category non-type codes (numeric + alpha-SA)
   *   LACK/POLSTER/ZUSBAU  — no dictionary, freehand text
   *
   * Multi-target ECU write: scans the chassis for IPOs that dispatch
   * FA_WRITE, lets the user pick which to write, runs sequentially
   * with per-ECU status pills. Same shape as FGNR/ZCS dialogs.
   */
  import { untrack } from "svelte";
  import type { AtRecord, SgfamRow } from "@emdzej/ncsx-text-tables";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { loadIpoBytes, startNcsRuntime } from "../lib/runtime.svelte";
  import { describeFaKeywordWithFallback } from "../lib/fa-describe";
  import WriteTargetList, { type WriteStatus } from "./WriteTargetList.svelte";

  type FaStruct = {
    /** Chassis prefix including trailing `_`, e.g. "E46_". Locked. */
    br: string;
    /** C_DATE without `#`, e.g. "0303". Empty when slot is absent. */
    date: string;
    /** C_TYP without `*`, e.g. "BW32". */
    typ: string;
    /** LACK (paint) without `%`. */
    lack: string;
    /** POLSTER (upholstery) without `&`. */
    polster: string;
    /** ZUSBAU sales orders without `|` markers. */
    zusbau: string[];
    /** SA codes without `$` markers, in source order. */
    sa: string[];
  };

  const EMPTY: FaStruct = {
    br: "", date: "", typ: "", lack: "", polster: "", zusbau: [], sa: [],
  };
  const MARKERS = "#*%&|$";

  /**
   * Parse a STANDARD_FA-shape string ("E46_#0303*BW32%0A08&N6TT|...$880")
   * into the typed struct. Marker chars classify each token; chars not
   * preceded by a marker (after the BR prefix) are silently dropped —
   * shouldn't happen on well-formed FAs.
   */
  function parseFa(raw: string): FaStruct {
    const out: FaStruct = {
      br: "", date: "", typ: "", lack: "", polster: "",
      zusbau: [], sa: [],
    };
    if (!raw) return out;
    let body = raw;
    const sep = body.indexOf("_");
    if (sep > 0) {
      out.br = body.slice(0, sep + 1);
      body = body.slice(sep + 1);
    }
    let i = 0;
    while (i < body.length) {
      const m = body[i];
      if (!m || !MARKERS.includes(m)) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < body.length && !MARKERS.includes(body[j]!)) j++;
      const v = body.slice(i + 1, j);
      switch (m) {
        case "#": out.date = v; break;
        case "*": out.typ = v; break;
        case "%": out.lack = v; break;
        case "&": out.polster = v; break;
        case "|": out.zusbau.push(v); break;
        case "$": out.sa.push(v); break;
      }
      i = j;
    }
    return out;
  }

  /** Inverse of parseFa — slot order matches what FA.PRG emits. */
  function emitFa(s: FaStruct): string {
    let out = s.br;
    if (s.date) out += "#" + s.date;
    if (s.typ) out += "*" + s.typ;
    if (s.lack) out += "%" + s.lack;
    if (s.polster) out += "&" + s.polster;
    for (const z of s.zusbau) if (z) out += "|" + z;
    for (const c of s.sa) if (c) out += "$" + c;
    return out;
  }

  // ---------- state ----------

  let original = $state<FaStruct>({ ...EMPTY, zusbau: [], sa: [] });
  let staged = $state<FaStruct>({ ...EMPTY, zusbau: [], sa: [] });
  let saSearch = $state("");
  let typSearch = $state("");
  let dateSearch = $state("");
  let writing = $state(false);
  let writeError = $state<string | null>(null);

  /** ECUs whose IPO dispatches FA_WRITE. undefined → scan in flight. */
  let faTargets = $state<SgfamRow[] | undefined>(undefined);
  /** sgNames the user has selected to write to. */
  let selected = $state(new Set<string>());
  /** Per-ECU status during/after a write run. */
  let results = $state(new Map<string, WriteStatus>());

  $effect(() => {
    if (!app.showFaEditor) {
      faTargets = undefined;
      selected = new Set();
      results = new Map();
      return;
    }
    untrack(() => {
      writeError = null;
      saSearch = ""; typSearch = ""; dateSearch = "";
      const parsed = parseFa(app.identity?.fa ?? "");
      original = parsed;
      staged = {
        ...parsed,
        zusbau: [...parsed.zusbau],
        sa: [...parsed.sa],
      };
      void resolveFaTargets();
    });
  });

  // ---------- dictionaries ----------

  type AtEntry = {
    code: string;
    category: string;
    comment: string;
    description: string | null;
  };

  function buildEntry(code: string, rec: AtRecord): AtEntry {
    return {
      code,
      category: rec.category,
      comment: rec.comment ?? "",
      description: describeFaKeywordWithFallback(code, app.translations?.entries),
    };
  }

  // Type-code shape: 2 letters followed by 2 alphanumerics (BW32, EP31,
  // BL91, AT11). N6TT / L7BA / 1CA don't match — they end up in the SA
  // picker, which is fine since the wire marker is set by slot, not AT.
  const TYP_RE = /^[A-Z]{2}[A-Z0-9]{2}$/;

  const dateOptions = $derived.by<AtEntry[]>(() => {
    if (!app.chassis?.at) return [];
    const out: AtEntry[] = [];
    for (const [code, rec] of app.chassis.at) {
      if (rec.category === "Z" && code.startsWith("#")) {
        out.push(buildEntry(code, rec));
      }
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  });

  const typOptions = $derived.by<AtEntry[]>(() => {
    if (!app.chassis?.at) return [];
    const out: AtEntry[] = [];
    for (const [code, rec] of app.chassis.at) {
      if (rec.category === "W" && TYP_RE.test(code)) {
        out.push(buildEntry(code, rec));
      }
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  });

  const saOptions = $derived.by<AtEntry[]>(() => {
    if (!app.chassis?.at) return [];
    const out: AtEntry[] = [];
    for (const [code, rec] of app.chassis.at) {
      if (
        rec.category === "W" &&
        !TYP_RE.test(code) &&
        !code.startsWith("#")
      ) {
        out.push(buildEntry(code, rec));
      }
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  });

  function filter(list: AtEntry[], q: string): AtEntry[] {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (e) =>
        e.code.toLowerCase().includes(s) ||
        e.comment.toLowerCase().includes(s) ||
        (e.description?.toLowerCase().includes(s) ?? false),
    );
  }
  const filteredDates = $derived(filter(dateOptions, dateSearch));
  const filteredTyps = $derived(filter(typOptions, typSearch));
  const filteredSas = $derived(filter(saOptions, saSearch));

  const stagedSaSet = $derived(new Set(staged.sa));

  // ---------- diff ----------

  type SlotChange = { slot: string; from: string; to: string };
  const slotChanges = $derived.by<SlotChange[]>(() => {
    const out: SlotChange[] = [];
    if (original.date !== staged.date)
      out.push({ slot: "Date", from: original.date, to: staged.date });
    if (original.typ !== staged.typ)
      out.push({ slot: "Type", from: original.typ, to: staged.typ });
    if (original.lack !== staged.lack)
      out.push({ slot: "Paint", from: original.lack, to: staged.lack });
    if (original.polster !== staged.polster)
      out.push({ slot: "Upholstery", from: original.polster, to: staged.polster });
    return out;
  });

  const zusbauChanges = $derived.by(() => {
    const oldSet = new Set(original.zusbau);
    const newSet = new Set(staged.zusbau);
    return {
      added: staged.zusbau.filter((z) => z && !oldSet.has(z)),
      removed: original.zusbau.filter((z) => !newSet.has(z)),
    };
  });

  const saChanges = $derived.by(() => {
    const oldSet = new Set(original.sa);
    const newSet = new Set(staged.sa);
    return {
      added: staged.sa.filter((c) => !oldSet.has(c)),
      removed: original.sa.filter((c) => !newSet.has(c)),
    };
  });

  const hasChanges = $derived(
    slotChanges.length > 0 ||
      zusbauChanges.added.length > 0 ||
      zusbauChanges.removed.length > 0 ||
      saChanges.added.length > 0 ||
      saChanges.removed.length > 0,
  );

  const stagedFaString = $derived(emitFa(staged));

  // ---------- slot edit helpers ----------

  function setDate(atCode: string): void {
    // AT stores date codes with `#` already in the key (e.g. "#0303");
    // the struct holds the value without the marker.
    staged.date = atCode.startsWith("#") ? atCode.slice(1) : atCode;
  }
  function clearDate(): void { staged.date = ""; }

  function setTyp(code: string): void { staged.typ = code; }
  function clearTyp(): void { staged.typ = ""; }

  function addSa(code: string): void {
    if (stagedSaSet.has(code)) return;
    staged.sa = [...staged.sa, code];
  }
  function removeSa(code: string): void {
    staged.sa = staged.sa.filter((c) => c !== code);
  }

  function addZusbau(): void {
    staged.zusbau = [...staged.zusbau, ""];
  }
  function updateZusbau(i: number, v: string): void {
    const next = [...staged.zusbau];
    next[i] = v;
    staged.zusbau = next;
  }
  function removeZusbau(i: number): void {
    staged.zusbau = staged.zusbau.filter((_, j) => j !== i);
  }

  // ---------- multi-target scan + write loop ----------

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

  async function resolveFaTargets(): Promise<void> {
    const chassis = app.chassis;
    if (!chassis) { faTargets = []; return; }
    faTargets = undefined;
    const matched: SgfamRow[] = [];
    const probes = candidateSgs.map(async (row) => {
      if (!row.cabd) return;
      try {
        const ipo = await loadIpoBytes(row.cabd);
        if (containsAscii(ipo, "FA_WRITE")) matched.push(row);
      } catch {
        // IPO missing or unreadable — can't be a write target.
      }
    });
    await Promise.all(probes);
    matched.sort((a, b) => a.sgName.localeCompare(b.sgName));
    faTargets = matched;
    selected = new Set(matched.map((r) => r.sgName));
    results = new Map();
  }

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
    app.showFaEditor = false;
  }

  async function commit(): Promise<void> {
    if (!app.chassis || !app.identity || !faTargets || faTargets.length === 0) return;
    if (!connection.session) {
      writeError = "Connect to the ECU first";
      return;
    }
    const toWrite = faTargets.filter((r) => selected.has(r.sgName));
    if (toWrite.length === 0) {
      writeError = "No ECUs selected";
      return;
    }
    const newFa = stagedFaString;
    const summary = [
      ...slotChanges.map((c) => `${c.slot}: ${c.from || "—"} → ${c.to || "—"}`),
      ...zusbauChanges.added.map((z) => `+order ${z}`),
      ...zusbauChanges.removed.map((z) => `−order ${z}`),
      saChanges.added.length > 0 ? `+${saChanges.added.length} SA` : "",
      saChanges.removed.length > 0 ? `−${saChanges.removed.length} SA` : "",
    ].filter(Boolean);
    const ok = window.confirm(
      `Write FA to ${toWrite.length} ECU${toWrite.length === 1 ? "" : "s"}: ` +
        toWrite.map((r) => r.sgName).join(", ") +
        `\n\n${summary.join("\n")}\n\nNew FA: ${newFa}\n\n` +
        `Partial failures leave the dialog open for retries.`,
    );
    if (!ok) return;

    writing = true;
    writeError = null;
    // Optimistic identity update — runtime's FA_WRITE branch reads
    // `app.identity.fa` to seed `FA_STREAM` inside runCabimain.
    const oldFa = app.identity.fa;
    app.identity.fa = newFa;

    const initial = new Map<string, WriteStatus>();
    for (const t of toWrite) initial.set(t.sgName, { kind: "pending" });
    results = initial;

    let okCount = 0;
    for (const sg of toWrite) {
      results = new Map(results).set(sg.sgName, { kind: "writing" });
      const start = performance.now();
      try {
        await writeOne(sg);
        const durationMs = Math.round(performance.now() - start);
        results = new Map(results).set(sg.sgName, { kind: "ok", durationMs });
        okCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results = new Map(results).set(sg.sgName, { kind: "error", message });
      }
    }
    writing = false;

    if (okCount === 0) {
      app.identity.fa = oldFa;
    } else if (okCount === toWrite.length) {
      setTimeout(() => { app.showFaEditor = false; }, 600);
    }
  }

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

  async function writeOne(sg: SgfamRow): Promise<void> {
    if (!sg.cabd || !sg.sgbd) throw new Error(`${sg.sgName} missing CABD or SGBD`);
    const handle = await startNcsRuntime({ cabdBasename: sg.cabd, sgbd: sg.sgbd });
    try {
      await handle.runCabimain("FA_WRITE");
      const status = handle.cabi.lastJobStatus;
      if (status !== "OKAY") {
        throw new Error(`JOB_STATUS=${status || "(missing)"}`);
      }
    } finally {
      await handle.dispose();
    }
  }

  const selectedCount = $derived(selected.size);
  const allOk = $derived(
    results.size > 0 && [...results.values()].every((s) => s.kind === "ok"),
  );
  const editingDisabled = $derived(writing || results.size > 0);
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
      <header class="border-b border-divider px-4 py-3">
        <h2 class="text-sm font-bold uppercase tracking-wider text-muted">
          Edit FA
        </h2>
        <p class="mt-0.5 text-xs text-faint">
          Each FA constituent (date / type / paint / upholstery / sales / SA)
          edits independently — markers are set by slot, not by AT category.
        </p>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-sm">
        <!-- Full FA preview -->
        <div>
          <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
            FA string
          </p>
          <p class="break-all rounded border border-divider bg-base p-2 font-mono text-xs text-foreground">
            {stagedFaString || "(empty)"}
          </p>
          {#if hasChanges}
            <div class="mt-2 space-y-1 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              {#each slotChanges as ch (ch.slot)}
                <p>
                  <span class="font-semibold">{ch.slot}:</span>
                  <span class="font-mono text-rose-700 dark:text-rose-300">{ch.from || "—"}</span>
                  →
                  <span class="font-mono text-emerald-700 dark:text-emerald-300">{ch.to || "—"}</span>
                </p>
              {/each}
              {#if zusbauChanges.added.length > 0}
                <p>
                  <span class="font-semibold">+orders:</span>
                  <span class="font-mono text-emerald-700 dark:text-emerald-300">{zusbauChanges.added.join(", ")}</span>
                </p>
              {/if}
              {#if zusbauChanges.removed.length > 0}
                <p>
                  <span class="font-semibold">−orders:</span>
                  <span class="font-mono text-rose-700 dark:text-rose-300">{zusbauChanges.removed.join(", ")}</span>
                </p>
              {/if}
              {#if saChanges.added.length > 0}
                <p>
                  <span class="font-semibold">+SA ({saChanges.added.length}):</span>
                  <span class="font-mono text-emerald-700 dark:text-emerald-300">{saChanges.added.join(", ")}</span>
                </p>
              {/if}
              {#if saChanges.removed.length > 0}
                <p>
                  <span class="font-semibold">−SA ({saChanges.removed.length}):</span>
                  <span class="font-mono text-rose-700 dark:text-rose-300">{saChanges.removed.join(", ")}</span>
                </p>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Chassis: locked -->
        <div class="grid grid-cols-[max-content_1fr] items-baseline gap-x-3 gap-y-1 rounded border border-divider bg-base p-2 text-xs">
          <span class="text-faint uppercase tracking-wider">Chassis</span>
          <span class="font-mono text-foreground">{staged.br || "—"}</span>
        </div>

        <!-- Date (C_DATE / #) — dictionary from AT Z-category -->
        <details class="rounded border border-divider bg-base" open={original.date !== staged.date}>
          <summary class="cursor-pointer px-2 py-1 text-xs">
            <span class="font-semibold uppercase tracking-wider text-faint">Date</span>
            <span class="ml-2 font-mono text-foreground">{staged.date ? `#${staged.date}` : "(none)"}</span>
            {#if original.date !== staged.date}
              <span class="ml-2 text-amber-700 dark:text-amber-300">changed</span>
            {/if}
            <span class="ml-2 text-faint">— production update revision</span>
          </summary>
          <div class="border-t border-divider p-2">
            <div class="mb-2 flex items-center gap-2 text-xs">
              <span class="text-faint">Current:</span>
              {#if staged.date}
                <span class="rounded border border-divider bg-elevated px-2 py-0.5 font-mono">#{staged.date}</span>
                <button
                  class="text-xs text-faint underline-offset-2 hover:text-rose-500 hover:underline disabled:opacity-40"
                  onclick={clearDate}
                  disabled={editingDisabled}
                >
                  clear
                </button>
              {:else}
                <span class="italic text-faint">(none)</span>
              {/if}
            </div>
            <input
              type="search"
              placeholder="Search date code or month/year…"
              bind:value={dateSearch}
              class="mb-1 w-full rounded border border-rule bg-surface px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
              disabled={editingDisabled}
            />
            <ul class="max-h-[10rem] overflow-y-auto rounded border border-divider text-xs">
              {#if filteredDates.length === 0}
                <li class="p-2 text-faint italic">No date codes in AT for this chassis.</li>
              {:else}
                {#each filteredDates as d (d.code)}
                  {@const valueWithoutHash = d.code.startsWith("#") ? d.code.slice(1) : d.code}
                  {@const isCurrent = staged.date === valueWithoutHash}
                  <li class="flex items-baseline justify-between gap-2 border-b border-divider/40 px-2 py-1 last:border-b-0">
                    <span class="flex items-baseline gap-2">
                      <span class="w-4 font-mono text-faint">{d.category}</span>
                      <span class="font-mono text-foreground">{d.code}</span>
                      {#if d.description}<span class="text-muted">— {d.description}</span>{:else if d.comment}<span class="text-faint italic">{d.comment}</span>{/if}
                    </span>
                    <button
                      class="rounded border border-divider px-2 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 {isCurrent ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'hover:border-accent hover:bg-elevated'}"
                      onclick={() => setDate(d.code)}
                      disabled={isCurrent || editingDisabled}
                    >
                      {isCurrent ? "✓ current" : "set"}
                    </button>
                  </li>
                {/each}
              {/if}
            </ul>
          </div>
        </details>

        <!-- Type (C_TYP / *) — dictionary from AT W-category type-shape -->
        <details class="rounded border border-divider bg-base" open={original.typ !== staged.typ}>
          <summary class="cursor-pointer px-2 py-1 text-xs">
            <span class="font-semibold uppercase tracking-wider text-faint">Type</span>
            <span class="ml-2 font-mono text-foreground">{staged.typ ? `*${staged.typ}` : "(none)"}</span>
            {#if original.typ !== staged.typ}
              <span class="ml-2 text-amber-700 dark:text-amber-300">changed</span>
            {/if}
            <span class="ml-2 text-faint">— model variant</span>
          </summary>
          <div class="border-t border-divider p-2">
            <div class="mb-2 flex items-center gap-2 text-xs">
              <span class="text-faint">Current:</span>
              {#if staged.typ}
                <span class="rounded border border-divider bg-elevated px-2 py-0.5 font-mono">*{staged.typ}</span>
                <button
                  class="text-xs text-faint underline-offset-2 hover:text-rose-500 hover:underline disabled:opacity-40"
                  onclick={clearTyp}
                  disabled={editingDisabled}
                >
                  clear
                </button>
              {:else}
                <span class="italic text-faint">(none)</span>
              {/if}
            </div>
            <input
              type="search"
              placeholder="Search type code or description…"
              bind:value={typSearch}
              class="mb-1 w-full rounded border border-rule bg-surface px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
              disabled={editingDisabled}
            />
            <ul class="max-h-[10rem] overflow-y-auto rounded border border-divider text-xs">
              {#if filteredTyps.length === 0}
                <li class="p-2 text-faint italic">No type codes match.</li>
              {:else}
                {#each filteredTyps as t (t.code)}
                  {@const isCurrent = staged.typ === t.code}
                  <li class="flex items-baseline justify-between gap-2 border-b border-divider/40 px-2 py-1 last:border-b-0">
                    <span class="flex items-baseline gap-2">
                      <span class="w-4 font-mono text-faint">{t.category}</span>
                      <span class="font-mono text-foreground">{t.code}</span>
                      {#if t.description}<span class="text-muted">— {t.description}</span>{:else if t.comment}<span class="text-faint italic">{t.comment}</span>{/if}
                    </span>
                    <button
                      class="rounded border border-divider px-2 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 {isCurrent ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'hover:border-accent hover:bg-elevated'}"
                      onclick={() => setTyp(t.code)}
                      disabled={isCurrent || editingDisabled}
                    >
                      {isCurrent ? "✓ current" : "set"}
                    </button>
                  </li>
                {/each}
              {/if}
            </ul>
          </div>
        </details>

        <!-- Paint + Upholstery — freehand text inputs (no AT dict) -->
        <div class="grid grid-cols-2 gap-2">
          <label class="rounded border border-divider bg-base p-2 text-xs">
            <span class="block text-faint uppercase tracking-wider">Paint <span class="text-muted normal-case">(freehand — no chassis dictionary)</span></span>
            <div class="mt-1 flex items-center gap-1">
              <span class="font-mono text-faint">%</span>
              <input
                type="text"
                bind:value={staged.lack}
                placeholder="0A08"
                class="min-w-0 flex-1 rounded border border-rule bg-surface px-2 py-1 font-mono text-xs text-foreground focus:border-accent focus:outline-none"
                disabled={editingDisabled}
              />
            </div>
            {#if original.lack !== staged.lack}
              <p class="mt-1 text-xs text-amber-700 dark:text-amber-300">was <span class="font-mono">{original.lack || "—"}</span></p>
            {/if}
          </label>
          <label class="rounded border border-divider bg-base p-2 text-xs">
            <span class="block text-faint uppercase tracking-wider">Upholstery <span class="text-muted normal-case">(freehand)</span></span>
            <div class="mt-1 flex items-center gap-1">
              <span class="font-mono text-faint">&</span>
              <input
                type="text"
                bind:value={staged.polster}
                placeholder="N6TT"
                class="min-w-0 flex-1 rounded border border-rule bg-surface px-2 py-1 font-mono text-xs text-foreground focus:border-accent focus:outline-none"
                disabled={editingDisabled}
              />
            </div>
            {#if original.polster !== staged.polster}
              <p class="mt-1 text-xs text-amber-700 dark:text-amber-300">was <span class="font-mono">{original.polster || "—"}</span></p>
            {/if}
          </label>
        </div>

        <!-- ZUSBAU sales orders — freehand text inputs -->
        <div class="rounded border border-divider bg-base p-2">
          <div class="mb-1 flex items-baseline justify-between gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-faint">
              Sales orders <span class="text-muted normal-case">(freehand — BMW order #s)</span>
            </span>
            <button
              class="text-xs text-faint underline-offset-2 hover:text-accent hover:underline disabled:opacity-40"
              onclick={addZusbau}
              disabled={editingDisabled}
            >
              + add
            </button>
          </div>
          {#if staged.zusbau.length === 0}
            <p class="text-xs text-faint italic">No sales orders staged.</p>
          {:else}
            <ul class="space-y-1">
              {#each staged.zusbau as z, i (i)}
                <li class="flex items-center gap-1">
                  <span class="font-mono text-faint text-xs">|</span>
                  <input
                    type="text"
                    value={z}
                    oninput={(e) => updateZusbau(i, (e.target as HTMLInputElement).value)}
                    placeholder="7531125"
                    class="min-w-0 flex-1 rounded border border-rule bg-surface px-2 py-1 font-mono text-xs text-foreground focus:border-accent focus:outline-none"
                    disabled={editingDisabled}
                  />
                  <button
                    class="text-xs text-faint hover:text-rose-500 disabled:opacity-40"
                    onclick={() => removeZusbau(i)}
                    disabled={editingDisabled}
                    title="Remove this order"
                    aria-label="Remove sales order"
                  >
                    ✕
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- SA codes — dictionary from AT W-category non-type -->
        <div class="rounded border border-divider bg-base p-2">
          <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
            SA codes <span class="text-muted normal-case">({staged.sa.length} staged)</span>
          </p>
          {#if staged.sa.length === 0}
            <p class="text-xs text-faint italic">No SA codes staged.</p>
          {:else}
            <ul class="mb-2 flex flex-wrap gap-1.5">
              {#each staged.sa as tok (tok)}
                {@const desc = describeFaKeywordWithFallback(tok, app.translations?.entries)}
                {@const rec = app.chassis?.at?.get(tok)}
                <li
                  class="flex items-baseline gap-1.5 rounded border border-divider bg-surface px-2 py-0.5 text-xs"
                  title={rec?.comment || desc || tok}
                >
                  <span class="font-mono text-faint">$</span>
                  <span class="font-mono text-foreground">{tok}</span>
                  {#if desc}<span class="text-faint">— {desc}</span>{/if}
                  <button
                    class="ml-1 text-faint hover:text-rose-500 disabled:opacity-40"
                    onclick={() => removeSa(tok)}
                    disabled={editingDisabled}
                    title="Remove {tok}"
                    aria-label="Remove {tok}"
                  >
                    ✕
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          <input
            type="search"
            placeholder="Search SA code or description…"
            bind:value={saSearch}
            class="mb-1 w-full rounded border border-rule bg-surface px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
            disabled={editingDisabled}
          />
          <ul class="max-h-[12rem] overflow-y-auto rounded border border-divider text-xs">
            {#if filteredSas.length === 0}
              <li class="p-2 text-faint italic">No codes match.</li>
            {:else}
              {#each filteredSas as c (c.code)}
                {@const present = stagedSaSet.has(c.code)}
                <li class="flex items-baseline justify-between gap-2 border-b border-divider/40 px-2 py-1 last:border-b-0">
                  <span class="flex items-baseline gap-2">
                    <span class="w-4 font-mono text-faint">{c.category}</span>
                    <span class="font-mono text-foreground">{c.code}</span>
                    {#if c.description}<span class="text-muted">— {c.description}</span>{:else if c.comment}<span class="text-faint italic">{c.comment}</span>{/if}
                  </span>
                  <button
                    class="rounded border border-divider px-2 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 {present ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'hover:border-accent hover:bg-elevated'}"
                    onclick={() => addSa(c.code)}
                    disabled={present || editingDisabled}
                  >
                    {present ? "✓ added" : "add"}
                  </button>
                </li>
              {/each}
            {/if}
          </ul>
        </div>

        <WriteTargetList
          targets={faTargets}
          {selected}
          {results}
          {writing}
          candidateCount={candidateSgs.length}
          scanFor="FA_WRITE dispatch"
          emptyMessage={`No IPO on ${app.chassis?.code ?? "this chassis"} dispatches FA_WRITE. FA write isn't supported on this chassis.`}
          onToggle={toggle}
          onRetry={retry}
          onSelectAll={() => {
            if (faTargets) selected = new Set(faTargets.map((r) => r.sgName));
          }}
          onSelectNone={() => {
            selected = new Set();
          }}
        />

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
          {:else if faTargets === undefined}
            resolving targets…
          {:else if faTargets.length === 0}
            no targets available
          {:else if results.size > 0}
            done · {[...results.values()].filter((s) => s.kind === "ok").length} ok / {[...results.values()].filter((s) => s.kind === "error").length} failed
          {:else if !hasChanges}
            no changes staged
          {:else}
            {slotChanges.length + zusbauChanges.added.length + zusbauChanges.removed.length} slot{slotChanges.length + zusbauChanges.added.length + zusbauChanges.removed.length === 1 ? "" : "s"} · {saChanges.added.length}+/{saChanges.removed.length}− SA · {selectedCount}/{faTargets.length} ECUs
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
            disabled={writing || !hasChanges || faTargets === undefined || faTargets.length === 0 || selectedCount === 0 || connection.status.kind !== "connected"}
            title={connection.status.kind !== "connected"
              ? "Connect to the ECU first"
              : faTargets === undefined
                ? "Resolving targets…"
                : faTargets.length === 0
                  ? "No ECU dispatches FA_WRITE on this chassis"
                  : !hasChanges
                    ? "Stage at least one change first"
                    : selectedCount === 0
                      ? "Select at least one ECU"
                      : `Dispatch FA_WRITE to ${selectedCount} ECU${selectedCount === 1 ? "" : "s"}`}
          >
            {writing ? "Writing…" : `Write to ${selectedCount} selected`}
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}
