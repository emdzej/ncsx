<script lang="ts">
  import { untrack } from "svelte";
  import {
    formatGm,
    formatSa,
    formatVn,
    stripGmCheck,
    stripSaCheck,
    stripVnCheck,
  } from "@emdzej/ncsx-identity";
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { loadIpoBytes, startNcsRuntime } from "../lib/runtime.svelte";
  import { describeFaKeywordWithFallback } from "../lib/fa-describe";
  import { findPhysicalModule, formatCi } from "../lib/process-ecu";
  import { buildZcsSlots } from "../lib/zcs-slots";
  import WriteTargetList, { type WriteStatus } from "./WriteTargetList.svelte";

  /**
   * Local edit state — BODY ONLY for all three fields. The trailing
   * Mod-36 check char is dropped on dialog open (via stripGmCheck /
   * stripSaCheck / stripVnCheck) and re-computed automatically on
   * write (via formatGm / formatSa / formatVn). The user never sees
   * or edits the check digit directly — it's surfaced as read-only
   * text to the right of each input.
   *
   * Body lengths: GM=8, SA=16, VN=10. The full value with check
   * lives in `app.identity.zcs.gm/sa/vn` and is computed by
   * `appliedGm` / `appliedSa` / `appliedVn` below.
   */
  let gm = $state("");
  let saHex = $state("");
  let vn = $state("");
  let search = $state("");
  let writing = $state(false);
  let writeError = $state<string | null>(null);

  /**
   * ECUs whose IPO dispatches ZCS_SCHREIBEN. Discovered by byte-search
   * over candidate IPOs on dialog open. `undefined` while the scan is
   * in flight, `[]` if nothing matches (chassis doesn't support ZCS
   * write), or a populated array.
   *
   * Mirrors the FGNR / FA dialogs' multi-target shape: ZCS values live
   * on multiple ECUs (often KMB + LCM + IKE), and BMW expects them to
   * agree. Writing to only one leaves the car inconsistent.
   */
  let zcsTargets = $state<SgfamRow[] | undefined>(undefined);
  /** sgNames the user has selected to write to. Defaults to all targets. */
  let selected = $state(new Set<string>());
  /** Per-ECU status during/after a write run. */
  let results = $state(new Map<string, WriteStatus>());

  /**
   * Computed check char for each field, OR null when the body is
   * the wrong length (so we can't run the M36 algorithm). Rendered
   * to the right of each input.
   */
  const gmCheck = $derived.by<string | null>(() => {
    try {
      return formatGm(gm).slice(-1);
    } catch {
      return null;
    }
  });
  const saCheck = $derived.by<string | null>(() => {
    try {
      return formatSa(saHex).slice(-1);
    } catch {
      return null;
    }
  });
  const vnCheck = $derived.by<string | null>(() => {
    try {
      return formatVn(vn).slice(-1);
    } catch {
      return null;
    }
  });

  /** body + computed check, ready for ZCS_SCHREIBEN. */
  const appliedGm = $derived(gmCheck !== null ? gm.toUpperCase() + gmCheck : "");
  const appliedSa = $derived(saCheck !== null ? saHex.toUpperCase() + saCheck : "");
  const appliedVn = $derived(vnCheck !== null ? vn.toUpperCase() + vnCheck : "");

  // Populate local state ONLY on dialog open — `untrack` reads the
  // identity without making them effect dependencies, so the
  // optimistic-update-then-revert dance commit() does on a failed
  // write doesn't clobber the user's in-flight edits. Without this,
  // every write failure visibly reverts GM/SA/VN back to the read
  // values — frustrating when you wanted to retry.
  $effect(() => {
    if (!app.showZcsEditor) {
      zcsTargets = undefined;
      selected = new Set();
      results = new Map();
      return;
    }
    untrack(() => {
      writeError = null;
      search = "";
      // Strip the trailing check char on open so the inputs hold
      // body-only. If the IPO returned a non-canonical length, fall
      // back to the raw value — the user can still edit.
      const z = app.identity?.zcs;
      try {
        gm = z?.gm ? stripGmCheck(z.gm) : "";
      } catch {
        gm = z?.gm ?? "";
      }
      try {
        saHex = z?.sa ? stripSaCheck(z.sa) : "";
      } catch {
        saHex = z?.sa ?? "";
      }
      try {
        vn = z?.vn ? stripVnCheck(z.vn) : "";
      } catch {
        vn = z?.vn ?? "";
      }
      void resolveZcsTargets();
    });
  });

  /**
   * Candidate rows — every SGFAM entry with a CABD+SGBD. Filtering by
   * `zcs=1` flag would miss IPOs that dispatch ZCS_SCHREIBEN without
   * being flagged as ZCS-masters; the IPO byte-search below is the
   * authoritative filter.
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
   * Scan candidates by probing their IPO file for the
   * "ZCS_SCHREIBEN" jobname string. The string appears in any IPO that
   * dispatches that jobname, regardless of slot-driven vs param-driven
   * write style — KMB on E46 ships slot-driven ZCS through
   * `C_S_AUFTRAG`; the byte-search catches it uniformly with anything
   * that uses C_FG_AUFTRAG-style param dispatch.
   */
  async function resolveZcsTargets(): Promise<void> {
    const chassis = app.chassis;
    if (!chassis) {
      zcsTargets = [];
      return;
    }
    zcsTargets = undefined;
    const matched: SgfamRow[] = [];
    const probes = candidateSgs.map(async (row) => {
      if (!row.cabd) return;
      try {
        const ipo = await loadIpoBytes(row.cabd);
        if (containsAscii(ipo, "ZCS_SCHREIBEN")) matched.push(row);
      } catch {
        // IPO missing or unreadable — can't be a write target.
      }
    });
    await Promise.all(probes);
    matched.sort((a, b) => a.sgName.localeCompare(b.sgName));
    zcsTargets = matched;
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

  function toggleTarget(sgName: string): void {
    const next = new Set(selected);
    if (next.has(sgName)) next.delete(sgName);
    else next.add(sgName);
    selected = next;
  }

  /**
   * ZCSUT record for the SG we'll use as the GM/VN dropdown source.
   * ZCS values themselves are universal across the ECUs we write to,
   * but each ECU's ZCSUT entry catalogues which (GM, VN) templates it
   * supports. We key off the SG the ZCS was originally read from
   * (`zcsSource`) — that's the ECU whose dictionary is most relevant
   * to the values currently in the inputs. Falls back to the first
   * write target when the source isn't recorded (e.g. the user opened
   * the dialog before any read).
   */
  const zcsutSourceSg = $derived(
    app.identity?.zcsSource ?? zcsTargets?.[0] ?? null,
  );
  const zcsutRecord = $derived.by(() => {
    const ecuName = zcsutSourceSg?.sgName;
    if (!ecuName) return null;
    return app.chassis?.zcsut?.bySg.get(ecuName) ?? null;
  });

  /**
   * Distinct GM patterns from every ZCSUT group for this SG. Sorted
   * with the all-wildcards pattern (`????????`) last so the more
   * specific patterns are at the top of the dropdown.
   *
   * Returns `[]` (→ template renders the free-text input) when the
   * only pattern is all-wildcards — that's the chassis saying "no
   * model-code constraint on this SG", which gives the dropdown
   * nothing actionable to offer beyond the user's current value.
   * Most pre-FA ECUs on E46 (KMB, EWS, ALSZ, …) are in this bucket;
   * ABG / IHK are the rare exceptions with multiple prefixes.
   */
  const gmOptions = $derived.by<string[]>(() => {
    if (!zcsutRecord) return [];
    const set = new Set<string>();
    for (const group of zcsutRecord.groups) {
      for (const m of group.masks) set.add(m.gm);
    }
    if (set.size === 0) return [];
    if (set.size === 1) {
      const only = [...set][0];
      if (only && /^\?+$/.test(only)) return [];
    }
    return [...set].sort((a, b) => {
      const aw = a.split("?").length - 1;
      const bw = b.split("?").length - 1;
      if (aw !== bw) return aw - bw; // fewer wildcards first
      return a.localeCompare(b);
    });
  });

  /**
   * Distinct VN hex values. Same "drop the dropdown when there's only
   * one option and it's all-zeros" heuristic — all-zeros means
   * uncoded/default, and the user's current value is already shown,
   * so the dropdown adds nothing.
   */
  const vnOptions = $derived.by<string[]>(() => {
    if (!zcsutRecord) return [];
    const set = new Set<string>();
    for (const group of zcsutRecord.groups) {
      for (const m of group.masks) set.add(m.vnHex);
    }
    if (set.size === 0) return [];
    if (set.size === 1) {
      const only = [...set][0];
      if (only && /^0+$/.test(only)) return [];
    }
    return [...set].sort();
  });

  /**
   * Did the user pick a (GM, VN) combo that matches an UMRECHNUNG
   * conversion rule for the read value? Surfaces the migration hint
   * — e.g. "From this old version, NCSEXPER would migrate to GMNEU /
   * VNNEU". We don't apply the conversion (the IPO does, at write
   * time); we just show it.
   *
   * Matches on body only — strips any trailing check digit from the
   * read GM (9 chars: 8 body + 1 Mod-36 check) before comparing.
   */
  const migrationHint = $derived.by<{
    fromGm: string;
    fromVn: string;
    toGm: string;
    toVn: string;
  } | null>(() => {
    if (!zcsutRecord) return null;
    const oldGm = (app.identity?.zcs?.gm ?? "").slice(0, 8);
    const oldVn = (app.identity?.zcs?.vn ?? "").slice(0, 10);
    for (const group of zcsutRecord.groups) {
      for (const c of group.conversions) {
        if (
          c.gmOld === oldGm &&
          c.vnOldHex.toUpperCase() === oldVn.toUpperCase() &&
          (c.gmNew !== c.gmOld || c.vnNewHex !== c.vnOldHex)
        ) {
          return {
            fromGm: c.gmOld,
            fromVn: c.vnOldHex,
            toGm: c.gmNew,
            toVn: c.vnNewHex,
          };
        }
      }
    }
    return null;
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
    saHex = saBigIntToHex(next, saHex.length || 16);
  }

  // Pad a bigint to a fixed-width uppercase hex string. Local helper —
  // distinct from the imported `formatSa` (M36 check-appender) above.
  function saBigIntToHex(value: bigint, width: number): string {
    const hex = value.toString(16).toUpperCase();
    return hex.padStart(width, "0");
  }

  /** Bits set in stagedSa that don't correspond to any known ZST code. */
  const unknownBits = $derived.by(() => {
    let known = 0n;
    for (const e of saEntries) known |= e.maskBig;
    const orphan = stagedSaBig & ~known;
    if (orphan === 0n) return null;
    return saBigIntToHex(orphan, saHex.length || 16);
  });

  const original = $derived(app.identity?.zcs);
  /**
   * `hasChanges` compares body-only forms — strip any trailing check
   * from the original before comparing to our (body-only) local
   * state. A pure "re-write the same value" still counts as
   * no-change, even though the IPO would happily accept it.
   */
  const hasChanges = $derived.by(() => {
    if (!original) return false;
    let origGm: string;
    let origSa: string;
    let origVn: string;
    try {
      origGm = stripGmCheck(original.gm);
    } catch {
      origGm = original.gm.trim().toUpperCase();
    }
    try {
      origSa = stripSaCheck(original.sa);
    } catch {
      origSa = original.sa.trim().toUpperCase();
    }
    try {
      origVn = stripVnCheck(original.vn);
    } catch {
      origVn = original.vn.trim().toUpperCase();
    }
    return (
      gm.trim().toUpperCase() !== origGm ||
      saHex.trim().toUpperCase() !== origSa ||
      vn.trim().toUpperCase() !== origVn
    );
  });

  /**
   * Length-validate the three staged ZCS fields against the lengths
   * NCSEXPER's CDHZcs_ValidateAndAppend (FUN_00449fb0) length-checks
   * with via FUN_00449db0: GM=9 (8 body + 1 check char), SA=17
   * (16 + 1), VN=11 (10 + 1). The SGBD itself does its own checksum
   * validation downstream; the length check is the cheap client-side
   * pre-flight that catches the obvious truncation/typo cases before
   * a write attempt burns through the ECU's coding-write counter.
   *
   * Returns null when all three are well-formed, or a human message
   * when something's off. The Write button disables on non-null.
   */
  // Body-length validator. The check char is computed automatically
  // — we only validate the user-entered body lengths against the
  // canonical sizes (GM=8, SA=16, VN=10). When the inputs are
  // wrong-length, `gmCheck` / `saCheck` / `vnCheck` evaluate to null
  // (formatX throws), which means the body display shows "—" and
  // the Write button gates off via `lengthError`.
  const lengthError = $derived.by<string | null>(() => {
    const errs: string[] = [];
    if (gm.trim().length !== 8) {
      errs.push(`GM body must be 8 chars, got ${gm.trim().length}`);
    }
    if (saHex.trim().length !== 16) {
      errs.push(`SA body must be 16 chars, got ${saHex.trim().length}`);
    }
    if (vn.trim().length !== 10) {
      errs.push(`VN body must be 10 chars, got ${vn.trim().length}`);
    }
    return errs.length === 0 ? null : errs.join("; ");
  });

  function close(): void {
    if (writing) return;
    app.showZcsEditor = false;
  }

  async function commit(): Promise<void> {
    if (!app.chassis || !app.identity?.zcs || !zcsTargets || zcsTargets.length === 0) return;
    if (!connection.session) {
      writeError = "Connect to the ECU first";
      return;
    }
    // Belt-and-braces — the Write button is already disabled when
    // `lengthError` is set, but a bug elsewhere could let the user
    // hit Enter on a focused input and bypass the disabled state.
    if (lengthError) {
      writeError = lengthError;
      return;
    }
    const toWrite = zcsTargets.filter((r) => selected.has(r.sgName));
    if (toWrite.length === 0) {
      writeError = "No ECUs selected";
      return;
    }
    const ok = window.confirm(
      `Write ZCS to ${toWrite.length} ECU${toWrite.length === 1 ? "" : "s"}: ` +
        toWrite.map((r) => r.sgName).join(", ") +
        `\n\nGM=${appliedGm}, SA=${appliedSa}, VN=${appliedVn}\n\n` +
        `Each ECU runs ZCS_SCHREIBEN with its own coding-index (IDENT\n` +
        `per ECU). Partial failures leave the dialog open for retries.`,
    );
    if (!ok) return;

    writing = true;
    writeError = null;
    // Optimistic identity update — runtime.svelte.ts seeds
    // GM/SA/VN_SCHLUESSEL from `app.identity.zcs` inside runCabimain.
    // Without updating it first, the runtime auto-seed clobbers any
    // explicit cabd-par with the OLD values. Revert on total failure;
    // partial leaves the new values visible (matches what some ECUs
    // now hold).
    const oldZcs = app.identity.zcs;
    const newZcs = { ...oldZcs, gm: appliedGm, sa: appliedSa, vn: appliedVn };
    app.identity.zcs = newZcs;

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
      app.identity.zcs = oldZcs;
    } else if (okCount === toWrite.length) {
      setTimeout(() => { app.showZcsEditor = false; }, 600);
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

  /**
   * Per-ECU ZCS write. Always runs IDENT against THIS ECU — using a
   * cached coding-index from another ECU (e.g. `app.selectedModule`)
   * would open the wrong `.Cxx` here (CI=8 for KMB might be 0x34 for
   * LSZ). The IDENT round-trip is cheap.
   */
  async function writeOne(sg: SgfamRow): Promise<void> {
    const chassis = app.chassis;
    if (!chassis) throw new Error("no chassis loaded");
    if (!sg.cabd || !sg.sgbd) throw new Error(`${sg.sgName} missing CABD or SGBD`);

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

    // Build the 20-byte slot table (GM body + check, SA body + check,
    // VN body + check) at the ZCS base address from CODIERDATENBLOCK.
    // Anchor: docs/zcs-write.md §3.
    const built = buildZcsSlots(cabd, appliedGm, appliedSa, appliedVn);
    if (!built.ok) {
      throw new Error(`buildZcsSlots: ${built.error}`);
    }

    // SPEICHERORG → wortBreite (1 for BYTE, 2 for WORD*).
    const memStructure = readSpeicherorgStructure(cabd);
    const wortBreite = memStructure === "BYTE" ? 1 : 2;

    const handle = await startNcsRuntime({
      cabdBasename: sg.cabd,
      sgbd: sg.sgbd,
    });
    try {
      handle.cabi.setNettoSlots(built.slots);
      await handle.cabi.CDHSetDataOrg(wortBreite, 0, 0);
      await handle.runCabimain("ZCS_SCHREIBEN");
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
   * not the decimal byte value — so parse as base 16.
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
    results.size > 0 && [...results.values()].every((s) => s.kind === "ok"),
  );
  const editingDisabled = $derived(writing || results.size > 0);

  /** Read `SPEICHERORG.STRUKTUR` ("BYTE" / "WORDMSB" / "WORDLSB"). */
  function readSpeicherorgStructure(cabd: import("@emdzej/ncsx-daten").DatenFile): string {
    for (const row of cabd.rowsInOrder) {
      if (row.block.name !== "SPEICHERORG") continue;
      const s = row.values.STRUKTUR;
      if (typeof s === "string") return s;
    }
    return "BYTE";
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
          <p class="mt-0.5 text-xs text-faint">
            Writes the same GM/SA/VN to every selected ECU via ZCS_SCHREIBEN.
          </p>
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
        <!--
          GM / SA / VN. GM and VN come from <BR>ZCSUT.000's MASKE rows
          as a per-SG catalogue of valid templates when the chassis
          ships ZCSUT; otherwise fall back to free-text. SA stays on
          the ZST bit-picker below regardless.
        -->
        <!--
          GM / SA / VN use HTML5 combobox (`<input list>` +
          `<datalist>`) when the chassis ships ZCSUT options: free
          typing always available, catalogue values shown as
          autocomplete suggestions. Lets the user rebuild a
          corrupted GM/VN from scratch (typing the body straight)
          while still discovering the valid templates from the
          dropdown arrow.
        -->
        <!--
          Body-only inputs. The Mod-36 check char is computed live and
          shown read-only to the right of each input — never edited
          directly. The full body+check value is what gets shipped to
          the IPO (computed via formatGm/formatSa/formatVn from
          @emdzej/ncsx-identity). M36 algorithm + per-key prefixes
          (C1/C2/C3) traced from NCSEXPER (FUN_0043e9d0 +
          FUN_00409f60's strncmp tests).
        -->
        <div class="grid grid-cols-3 gap-3">
          <label class="text-xs text-muted">
            GM <span class="text-faint">(8 chars)</span>
            <div class="mt-0.5 flex items-stretch gap-1">
              <input
                type="text"
                list={gmOptions.length > 0 ? "gm-options" : undefined}
                maxlength="8"
                class="min-w-0 flex-1 rounded border border-rule bg-base px-2 py-1 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
                bind:value={gm}
                spellcheck="false"
                autocomplete="off"
                disabled={editingDisabled}
              />
              <span
                class="inline-flex w-6 items-center justify-center rounded border border-divider bg-elevated px-1 font-mono text-sm text-muted"
                title="Mod-36 check char — auto-computed"
              >
                {gmCheck ?? "—"}
              </span>
            </div>
            {#if gmOptions.length > 0}
              <datalist id="gm-options">
                {#each gmOptions as opt (opt)}
                  <option value={opt}></option>
                {/each}
              </datalist>
            {/if}
          </label>
          <label class="col-span-2 text-xs text-muted">
            SA <span class="text-faint">(16 chars — hex bit-set)</span>
            <div class="mt-0.5 flex items-stretch gap-1">
              <input
                type="text"
                maxlength="16"
                class="min-w-0 flex-1 rounded border border-rule bg-base px-2 py-1 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
                bind:value={saHex}
                spellcheck="false"
                autocomplete="off"
                disabled={editingDisabled}
              />
              <span
                class="inline-flex w-6 items-center justify-center rounded border border-divider bg-elevated px-1 font-mono text-sm text-muted"
                title="Mod-36 check char — auto-computed"
              >
                {saCheck ?? "—"}
              </span>
            </div>
          </label>
          <label class="text-xs text-muted">
            VN <span class="text-faint">(10 chars)</span>
            <div class="mt-0.5 flex items-stretch gap-1">
              <input
                type="text"
                list={vnOptions.length > 0 ? "vn-options" : undefined}
                maxlength="10"
                class="min-w-0 flex-1 rounded border border-rule bg-base px-2 py-1 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
                bind:value={vn}
                spellcheck="false"
                autocomplete="off"
                disabled={editingDisabled}
              />
              <span
                class="inline-flex w-6 items-center justify-center rounded border border-divider bg-elevated px-1 font-mono text-sm text-muted"
                title="Mod-36 check char — auto-computed"
              >
                {vnCheck ?? "—"}
              </span>
            </div>
            {#if vnOptions.length > 0}
              <datalist id="vn-options">
                {#each vnOptions as opt (opt)}
                  <option value={opt}></option>
                {/each}
              </datalist>
            {/if}
          </label>
        </div>

        {#if lengthError}
          <!--
            Length is the cheapest validation we have without the full
            check-digit algorithm — NCSEXPER's CDHZcs validator (FUN_00449fb0)
            length-checks before doing anything else, so a wrong length is
            guaranteed to fail. Surfacing it here saves a write attempt.
          -->
          <p class="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-xs">
            <span class="font-semibold">Invalid length:</span> {lengthError}.
            Check chars compute automatically; you only enter the bodies.
          </p>
        {/if}

        {#if migrationHint}
          <!--
            The chassis ZCSUT declares an UMRECHNUNG rule that maps the
            value just read to a newer canonical form. NCSEXPER would
            apply this transparently at write time; we surface it so
            the user understands what'll actually land on the ECU even
            if they don't pick the new values manually.
          -->
          <p class="rounded border border-sky-500/40 bg-sky-500/10 p-2 text-xs">
            <span class="font-semibold">Migration available:</span>
            ZCSUT lists a conversion from
            <span class="font-mono">{migrationHint.fromGm}</span>/<span
              class="font-mono">{migrationHint.fromVn}</span
            >
            → <span class="font-mono">{migrationHint.toGm}</span>/<span
              class="font-mono">{migrationHint.toVn}</span
            >. Select these in the dropdowns to apply.
          </p>
        {/if}

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
            disabled={editingDisabled}
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
                      disabled={editingDisabled}
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

        <WriteTargetList
          targets={zcsTargets}
          {selected}
          {results}
          {writing}
          candidateCount={candidateSgs.length}
          scanFor="ZCS_SCHREIBEN dispatch"
          emptyMessage={`No IPO on ${app.chassis?.code ?? "this chassis"} dispatches ZCS_SCHREIBEN. ZCS write isn't supported on this chassis.`}
          onToggle={toggleTarget}
          onRetry={retry}
          onSelectAll={() => {
            if (zcsTargets) selected = new Set(zcsTargets.map((r) => r.sgName));
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
          {:else if zcsTargets === undefined}
            resolving targets…
          {:else if zcsTargets.length === 0}
            no targets available
          {:else if results.size > 0}
            done · {[...results.values()].filter((s) => s.kind === "ok").length} ok / {[...results.values()].filter((s) => s.kind === "error").length} failed
          {:else if !hasChanges}
            no changes staged
          {:else}
            {selectedCount} of {zcsTargets.length} selected
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
            disabled={writing || !hasChanges || zcsTargets === undefined || zcsTargets.length === 0 || selectedCount === 0 || connection.status.kind !== "connected" || lengthError !== null}
            title={connection.status.kind !== "connected"
              ? "Connect to the ECU first"
              : zcsTargets === undefined
                ? "Resolving targets…"
                : zcsTargets.length === 0
                  ? "No ECU dispatches ZCS_SCHREIBEN on this chassis"
                  : !hasChanges
                    ? "Stage at least one change first"
                    : selectedCount === 0
                      ? "Select at least one ECU"
                      : lengthError !== null
                        ? lengthError
                        : `Dispatch ZCS_SCHREIBEN to ${selectedCount} ECU${selectedCount === 1 ? "" : "s"}`}
          >
            {writing ? "Writing…" : `Write to ${selectedCount} selected`}
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}
