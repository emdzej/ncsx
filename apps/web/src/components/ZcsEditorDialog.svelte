<script lang="ts">
  import { untrack } from "svelte";
  import { findSgsByFlag } from "@emdzej/ncsx-chassis";
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
  import { startNcsRuntime } from "../lib/runtime.svelte";
  import { describeFaKeywordWithFallback } from "../lib/fa-describe";
  import { findPhysicalModule, formatCi } from "../lib/process-ecu";
  import { buildZcsSlots } from "../lib/zcs-slots";

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
    if (!app.showZcsEditor) return;
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
    });
  });

  /**
   * ZCSUT record for the SG we're writing to. Pulled from the chassis
   * `<BR>ZCSUT.000` index. May be null when:
   *   - The chassis is FA-master (no ZCSUT file ships).
   *   - The chassis ships ZCSUT but doesn't list this SG.
   *   - We don't have a target SG resolved yet.
   * When null, GM/VN render as free-text inputs (the pre-ZCSUT UX).
   */
  const zcsutRecord = $derived.by(() => {
    const ecuName = targetSg?.sgName;
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

  /**
   * Pick a SG to dispatch ZCS_SCHREIBEN against. Prefer the SG the ZCS
   * was read from (so we hit the same ECU with the matching CABD);
   * fall back to the first ZCS-master SGFAM row.
   */
  const targetSg = $derived.by<SgfamRow | null>(() => {
    if (!app.chassis) return null;
    if (app.identity?.zcsSource) return app.identity.zcsSource;
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
    // Belt-and-braces — the Write button is already disabled when
    // `lengthError` is set, but a bug elsewhere could let the user
    // hit Enter on a focused input and bypass the disabled state.
    if (lengthError) {
      writeError = lengthError;
      return;
    }
    const ok = window.confirm(
      `Write ZCS to ${targetSg.sgName} (${targetSg.sgbd})?\n\n` +
        `GM=${appliedGm}, SA=${appliedSa}, VN=${appliedVn}\n\n` +
        `Check digits computed; M36 algorithm = NCSEXPER's CalcMod36CheckSum.\n` +
        `Dispatches ZCS_SCHREIBEN through ${targetSg.cabd}.IPO.`,
    );
    if (!ok) return;
    writing = true;
    writeError = null;
    const oldZcs = app.identity.zcs;
    // Push body+check (the IPO's seed in runtime.svelte.ts reads from
    // these cabd-par values verbatim — the SGBD validates the check
    // on the receiving end).
    app.identity.zcs = { ...oldZcs, gm: appliedGm, sa: appliedSa, vn: appliedVn };
    try {
      // Resolve the ECU's current coding index — needed to pick the
      // right `.Cxx` (different CIs put ZCS at different WORTADRs).
      // Prefer the cached value from a prior module-pick; fall back
      // to running IDENT here so the dialog works without the user
      // visiting the module list first.
      const chassis = app.chassis;
      const ci =
        app.selectedModule?.codingIndex ??
        (await readCodingIndex(targetSg.sgbd));
      if (typeof ci !== "number") {
        throw new Error(
          `Couldn't determine the ECU's coding index — IDENT didn't return ID_COD_INDEX`,
        );
      }

      // Resolve the physical CABD module name from SGAUSWAHL + open
      // the matching `.Cxx`. The opened DatenFile holds the
      // `CODIERDATENBLOCK` row that buildZcsSlots reads to find the
      // ZCS base address.
      const physical = findPhysicalModule(chassis, targetSg.sgName, formatCi(ci));
      if (!physical) {
        throw new Error(
          `No SGAUSWAHL row matches ${targetSg.sgName} + ${formatCi(ci)} — chassis ${chassis.code} doesn't ship this variant`,
        );
      }
      const cabd = await chassis.cabd.openModule(physical.moduleName, ci);

      // Build the 20-byte slot table (GM body + check, SA body +
      // check, VN body + check) at the ZCS base address from
      // CODIERDATENBLOCK. Anchor: docs/zcs-write.md §3.
      const built = buildZcsSlots(cabd, appliedGm, appliedSa, appliedVn);
      if (!built.ok) {
        throw new Error(`buildZcsSlots: ${built.error}`);
      }

      // SPEICHERORG → wortBreite (1 for BYTE, 2 for WORD*). Matches
      // processWriteCoding's derivation for SG_CODIEREN.
      const memStructure = readSpeicherorgStructure(cabd);
      const wortBreite = memStructure === "BYTE" ? 1 : 2;

      const handle = await startNcsRuntime({
        cabdBasename: targetSg.cabd,
        sgbd: targetSg.sgbd,
      });
      try {
        handle.cabi.setNettoSlots(built.slots);
        await handle.cabi.CDHSetDataOrg(wortBreite, 0, 0);
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

  /**
   * Fallback CI-reader. Spins up a minimal runtime just for the IDENT
   * call and pulls `ID_COD_INDEX` from the result. Used when the user
   * hits Write ZCS without having selected a module first (so
   * `app.selectedModule.codingIndex` isn't populated).
   */
  async function readCodingIndex(sgbd: string): Promise<number | null> {
    if (!targetSg?.cabd) return null;
    const handle = await startNcsRuntime({
      cabdBasename: targetSg.cabd,
      sgbd,
    });
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
            disabled={writing || !hasChanges || !targetSg || connection.status.kind !== "connected" || lengthError !== null}
            title={connection.status.kind !== "connected"
              ? "Connect to the ECU first"
              : !targetSg
                ? "No ZCS-master SG available"
                : !hasChanges
                  ? "Stage at least one change first"
                  : lengthError !== null
                    ? lengthError
                    : "Dispatch ZCS_SCHREIBEN"}
          >
            {writing ? "Writing…" : "Write ZCS"}
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}
