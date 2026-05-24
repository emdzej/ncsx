<script lang="ts">
  import { padFgnrToVin } from "@emdzej/ncsx-identity";
  import { tokenizeFa, faToAsw } from "@emdzej/ncsx-fa-asw";
  import { selectEcus } from "@emdzej/ncsx-ecu-select";
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { startNcsRuntime, type RuntimeHandle } from "../lib/runtime.svelte";
  import { describeFaKeywordWithFallback } from "../lib/fa-describe";

  let reading = $state(false);
  /** SG the user is actively reading from — drives the per-row spinner. */
  let activeSgName = $state<string | null>(null);
  /** Toggle for the "Details" panel that breaks the FA into tokens. */
  let showDetails = $state(false);

  /**
   * Decoded FA: tokens with the FSW keywords each activates and the
   * community-translation lookup for those keywords. Empty when no
   * FA has been read or the chassis lacks an AT table. Pipeline:
   *
   *   1. `tokenizeFa(fa)` splits on FA delimiters → raw tokens.
   *   2. For each token, look up `chassis.at` to get the AT record's
   *      `fsws` list (the FSW keywords this code enables).
   *   3. For each FSW keyword, fall back through `chassis.swtAsw`
   *      (KEYID resolution — proves the AT record actually maps) and
   *      `app.translations` (English description).
   */
  const decodedFa = $derived.by<
    Array<{
      token: string;
      knownInAt: boolean;
      tokenDescription: string | null;
      atComment: string;
      fsws: Array<{ keyword: string; description: string | null }>;
    }>
  >(() => {
    if (!app.chassis || !app.identity?.fa) return [];
    const tokens = tokenizeFa(app.identity.fa);
    const tr = app.translations?.entries;
    return tokens.map((token) => {
      const rec =
        app.chassis!.at?.get(token) ??
        app.chassis!.at?.get(token.replace(/^0+/, ""));
      const tokenDescription = describeFaKeywordWithFallback(token, tr);
      if (!rec) {
        return {
          token,
          knownInAt: false,
          tokenDescription,
          atComment: "",
          fsws: [],
        };
      }
      const fsws = rec.fsws.map((fsw) => ({
        keyword: fsw,
        description: describeFaKeywordWithFallback(fsw, tr),
      }));
      return {
        token,
        knownInAt: true,
        tokenDescription,
        atComment: rec.comment ?? "",
        fsws,
      };
    });
  });

  /**
   * Decoded ZCS: the SA-bit set the ECU returned, mapped through the
   * chassis `<BR>ZST.000` table to (FSW, comment) pairs the user can
   * read. ZST rows carry a `saMask` (16-hex, 64-bit). A row is active
   * when every bit of its mask is set in the user's SA — same
   * membership test NCSEXPER uses internally when expanding ZCS to
   * the per-SG worklist. Rows are grouped by `saCode` so the user
   * sees one entry per shipped SA package, with its constituent FSWs
   * listed underneath.
   *
   * GM and VN aren't bit-decoded — they're scalar identifiers (model
   * code, version number) with no per-bit semantics.
   */
  const decodedZcs = $derived.by<
    Array<{
      saCode: string;
      comment: string;
      fsws: Array<{ keyword: string; description: string | null }>;
    }>
  >(() => {
    if (!app.chassis?.zst || !app.identity?.zcs?.sa) return [];
    const saHex = app.identity.zcs.sa.trim();
    if (saHex.length === 0) return [];
    let userSa: bigint;
    try {
      userSa = BigInt("0x" + saHex);
    } catch {
      return [];
    }
    const tr = app.translations?.entries;
    const grouped = new Map<
      string,
      {
        saCode: string;
        comment: string;
        fsws: Array<{ keyword: string; description: string | null }>;
        seenFsws: Set<string>;
      }
    >();
    for (const rec of app.chassis.zst.file.records) {
      if (!rec.saMask || /^0+$/.test(rec.saMask)) continue;
      let mask: bigint;
      try {
        mask = BigInt("0x" + rec.saMask);
      } catch {
        continue;
      }
      if (mask === 0n) continue;
      // A row contributes when every bit of its `saMask` is set in
      // the user's SA. Partial overlaps are ignored — NCSEXPER's
      // expansion only fires when the SA pattern includes the row's
      // full mask.
      if ((userSa & mask) !== mask) continue;
      const key = rec.saCode || `mask:${rec.saMask}`;
      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          saCode: rec.saCode,
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
      // Multiple rows with the same code may carry different comments
      // (e.g. one per marker variant). Prefer the first non-empty.
      if (!entry.comment && rec.comment) entry.comment = rec.comment;
    }
    return [...grouped.values()]
      .map(({ saCode, comment, fsws }) => ({ saCode, comment, fsws }))
      .sort((a, b) => a.saCode.localeCompare(b.saCode));
  });

  /** Cached SG-install summary for the Details panel footer. */
  const installSummary = $derived.by<{ total: number; installed: number } | null>(
    () => {
      if (!app.chassis || !app.identity?.fa) return null;
      try {
        const asw = faToAsw(app.identity.fa, { chassis: app.chassis });
        const installed = selectEcus(app.chassis, asw);
        return {
          total: app.chassis.sgfam.size,
          installed: installed.length,
        };
      } catch {
        return null;
      }
    },
  );

  /**
   * Identity-master SGs, grouped by SGBD. The same physical ECU often
   * appears in SGFAM as two rows with the same `sgbd` but different
   * `cabd`s — one carrying the FA-master flag, one the ZCS-master
   * flag (E46 `AKMB`/`KMB` both speak `C_KMB46`; `ALSZ`/`LSZ` both
   * speak `C_LSZA`). Merging by SGBD shows each ECU once with both
   * Read FA / Read ZCS buttons; clicking a button picks the matching
   * row so the IPO dispatcher under the right CABD runs.
   *
   * `primary` is the row we'd display the SG-name from — prefer the FA-master
   * (the "modern" personality) when both exist, else the lone one we have.
   */
  const identityMasters = $derived.by<
    Array<{
      sgbd: string;
      primary: SgfamRow;
      fa: SgfamRow | null;
      zcs: SgfamRow | null;
    }>
  >(() => {
    if (!app.chassis) return [];
    const groups = new Map<
      string,
      { sgbd: string; fa: SgfamRow | null; zcs: SgfamRow | null }
    >();
    for (const row of app.chassis.sgfam.values()) {
      if (row.fa !== 1 && row.zcs !== 1) continue;
      if (!row.sgbd) continue;
      let entry = groups.get(row.sgbd);
      if (!entry) {
        entry = { sgbd: row.sgbd, fa: null, zcs: null };
        groups.set(row.sgbd, entry);
      }
      if (row.fa === 1 && !entry.fa) entry.fa = row;
      if (row.zcs === 1 && !entry.zcs) entry.zcs = row;
    }
    return [...groups.values()]
      .map((g) => ({
        sgbd: g.sgbd,
        fa: g.fa,
        zcs: g.zcs,
        // FA-master takes display precedence — it's the personality
        // NCSEXPER uses for identity in modern dispatchers. Fall back
        // to the ZCS-master when no FA-master exists.
        primary: (g.fa ?? g.zcs) as SgfamRow,
      }))
      .sort((a, b) => a.primary.sgName.localeCompare(b.primary.sgName));
  });

  const canConnect = $derived(connection.status.kind === "connected");

  /**
   * Build a per-row CABI runtime. Mirrors NCSEXPER's "load A_<cabd>.ipo" step
   * — the IPO carries the per-CABD job-name mapping (e.g. `FGNR_LESEN` →
   * SGBD's `C_FG_LESEN`), so the right call to `apiJob` falls out of running
   * `cabimain(JOBNAME)` against that specific dispatcher.
   */
  async function withRuntime<T>(
    row: SgfamRow,
    fn: (handle: RuntimeHandle) => Promise<T>,
  ): Promise<T> {
    if (!row.cabd) throw new Error(`SGFAM row for ${row.sgName} has no CABD`);
    if (!row.sgbd) throw new Error(`SGFAM row for ${row.sgName} has no SGBD`);
    const handle = await startNcsRuntime({
      cabdBasename: row.cabd,
      sgbd: row.sgbd,
    });
    try {
      return await fn(handle);
    } finally {
      await handle.dispose();
    }
  }

  /**
   * Read VIN + FA via the IPO dispatcher. We invoke `cabimain("FGNR_LESEN")`
   * then `cabimain("FA_READ")` against the row's `A_*.ipo` — both contract
   * names verified against NCSEXPER (`FUN_00433a70("FGNR_LESEN", …)` /
   * `FUN_00433a70("FA_READ", …)`). The IPO routes them to `FgnrLesen` /
   * `AuftragLesen`, which call `apiJob` through our CDHapiJob override.
   * Results land on `handle.cabi.lastJob`.
   *
   * Jobs are sequential — the IPO mutates VM state per call, and we own the
   * VM for the duration of each `runCabimain`.
   *
   * Merging policy: an existing ZCS read on the same vehicle is preserved
   * (an FA read shouldn't blow away the ZCS the user just pulled from the
   * sibling personality on the same ECU). The new FA replaces the old one;
   * VIN replaces the old one too since it's read here.
   */
  async function onReadFaFromSg(row: SgfamRow): Promise<void> {
    if (!connection.session || reading || !row.sgbd || !row.cabd) return;
    reading = true;
    activeSgName = row.sgName;
    app.error = null;
    try {
      await withRuntime(row, async (h) => {
        await h.runCabimain("FGNR_LESEN");
        const rawFgnr = h.cabi.cabdPar("FAHRGESTELL_NR");
        const vinStatus = h.cabi.lastJobStatus;

        await h.runCabimain("FA_READ");
        const fa = h.cabi.cabdPar("FA_STREAM");
        const faStatus = h.cabi.lastJobStatus;

        const vin =
          typeof rawFgnr === "string" && rawFgnr ? padFgnrToVin(rawFgnr).vin : undefined;
        app.identity = {
          ...(app.identity ?? {}),
          faSource: row,
          vin,
          fa: typeof fa === "string" ? fa : undefined,
          vinStatus,
          faStatus,
        };
      });
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    } finally {
      reading = false;
      activeSgName = null;
    }
  }

  /**
   * Read VIN + ZCS via the IPO dispatcher. `cabimain("ZCS_LESEN")` routes to
   * the IPO's `ZcsLesen` handler which calls `apiJob` for the SGBD's
   * `ZCS_LESEN` and emits `GM_SCHLUESSEL` / `SA_SCHLUESSEL` / `VN_SCHLUESSEL`.
   *
   * Merging policy: see `onReadFaFromSg` — an existing FA payload is
   * preserved.
   */
  async function onReadZcsFromSg(row: SgfamRow): Promise<void> {
    if (!connection.session || reading || !row.sgbd || !row.cabd) return;
    reading = true;
    activeSgName = row.sgName;
    app.error = null;
    try {
      await withRuntime(row, async (h) => {
        await h.runCabimain("FGNR_LESEN");
        const rawFgnr = h.cabi.cabdPar("FAHRGESTELL_NR");
        const vinStatus = h.cabi.lastJobStatus;

        await h.runCabimain("ZCS_LESEN");
        const gm = h.cabi.cabdPar("GM_SCHLUESSEL");
        const sa = h.cabi.cabdPar("SA_SCHLUESSEL");
        const vn = h.cabi.cabdPar("VN_SCHLUESSEL");
        const zcsStatus = h.cabi.lastJobStatus;

        const vin =
          typeof rawFgnr === "string" && rawFgnr ? padFgnrToVin(rawFgnr).vin : undefined;
        const haveZcs =
          typeof gm === "string" &&
          typeof sa === "string" &&
          typeof vn === "string";

        app.identity = {
          ...(app.identity ?? {}),
          zcsSource: row,
          vin: typeof vin === "string" ? vin : undefined,
          zcs: haveZcs
            ? { gm: gm as string, sa: sa as string, vn: vn as string }
            : undefined,
          vinStatus,
          zcsStatus,
        };
      });
    } catch (err) {
      app.error = err instanceof Error ? err.message : String(err);
    } finally {
      reading = false;
      activeSgName = null;
    }
  }

  function clearIdentity(): void {
    app.identity = null;
  }

</script>

<section class="rounded border border-divider bg-surface p-3">
  <div class="mb-2 flex items-baseline justify-between gap-2">
    <h3 class="text-sm font-semibold text-foreground">Vehicle identity</h3>
    {#if app.identity}
      <div class="flex items-center gap-3">
        {#if app.identity.fa || app.identity.zcs}
          <button
            class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
            onclick={() => (showDetails = !showDetails)}
          >
            {showDetails ? "hide details" : "details"}
          </button>
        {/if}
        {#if app.identity.fa}
          <button
            class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
            onclick={() => (app.showFaEditor = true)}
            title="Edit FA — add or remove FA tokens, then write FA_WRITE to the ECU"
          >
            edit FA
          </button>
        {/if}
        {#if app.identity.zcs}
          <button
            class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
            onclick={() => (app.showZcsEditor = true)}
            title="Edit ZCS — toggle SA bits / change GM/VN, then write ZCS_SCHREIBEN to the ECU"
          >
            edit ZCS
          </button>
        {/if}
        <button
          class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
          onclick={clearIdentity}
        >
          clear
        </button>
      </div>
    {/if}
  </div>

  {#if app.identity}
    {@const id = app.identity}
    <div class="space-y-1 text-xs">
      <div class="flex gap-2">
        <span class="w-12 font-mono text-faint">VIN</span>
        <span class="font-mono text-foreground">
          {#if id.vin}
            {@const vin = id.vin}
            {@const prefix = vin.length > 7 ? vin.slice(0, -7) : ""}
            {@const tail = vin.length > 7 ? vin.slice(-7) : vin}
            <!--
              The last 7 chars are the production-sequential portion of
              the VIN — the "real" identifier that NCS tools display
              prominently. Bolding it makes it easy to read past the
              WBAAA00000 placeholder padFgnrToVin prepends to the 7-char
              FGNR returned by the ECU.
            -->
            {#if prefix}<span class="text-faint">{prefix}</span>{/if}<span
              class="font-bold">{tail}</span>
          {:else}
            —
            {#if id.vinStatus}
              <span class="text-faint">({id.vinStatus})</span>
            {/if}
          {/if}
        </span>
      </div>

      {#if id.fa !== undefined || id.faStatus !== undefined}
        <div class="flex gap-2">
          <span class="w-12 font-mono text-faint">FA</span>
          <span class="break-all font-mono text-foreground">
            {id.fa ?? "—"}
            {#if !id.fa && id.faStatus}
              <span class="text-faint">({id.faStatus})</span>
            {/if}
          </span>
        </div>
      {/if}

      {#if id.zcs !== undefined || id.zcsStatus !== undefined}
        <div class="flex gap-2">
          <span class="w-12 font-mono text-faint">ZCS</span>
          <div class="font-mono text-foreground">
            {#if id.zcs}
              <div>GM <span class="ml-1 text-foreground">{id.zcs.gm}</span></div>
              <div class="break-all">
                SA <span class="ml-1 text-foreground">{id.zcs.sa}</span>
              </div>
              <div>VN <span class="ml-1 text-foreground">{id.zcs.vn}</span></div>
            {:else}
              — <span class="text-faint">({id.zcsStatus})</span>
            {/if}
          </div>
        </div>
      {/if}

      <p class="pt-1 font-sans text-faint">
        {#if id.faSource && id.zcsSource}
          FA from <span class="font-mono">{id.faSource.sgName}</span> · ZCS from
          <span class="font-mono">{id.zcsSource.sgName}</span>
          ({id.faSource.sgbd === id.zcsSource.sgbd ? id.faSource.sgbd : `${id.faSource.sgbd} / ${id.zcsSource.sgbd}`})
        {:else if id.faSource}
          read from <span class="font-mono">{id.faSource.sgName}</span> ({id.faSource.sgbd})
        {:else if id.zcsSource}
          read from <span class="font-mono">{id.zcsSource.sgName}</span> ({id.zcsSource.sgbd})
        {/if}
      </p>
    </div>

    {#if showDetails && id.fa}
      <!--
        Decoded FA panel — shows each token in the FA string with the
        FSWs that token activates per the chassis `<BR>AT.000` table
        and any community-provided English description. Resolution
        chain documented on `decodedFa`'s `$derived` above.
      -->
      <div class="mt-3 rounded border border-divider bg-base p-2 text-xs">
        <div class="mb-2 flex items-baseline justify-between gap-2 text-faint">
          <span class="font-semibold uppercase tracking-wider">
            Decoded FA · {decodedFa.length} token{decodedFa.length === 1 ? "" : "s"}
          </span>
          {#if installSummary}
            <span>
              {installSummary.installed} / {installSummary.total} SGs installed
            </span>
          {/if}
        </div>
        {#if decodedFa.length === 0}
          <p class="text-faint italic">
            Couldn't tokenize the FA string. The raw string is shown above.
          </p>
        {:else}
          <ul class="space-y-1.5">
            {#each decodedFa as t (t.token)}
              <li class="border-b border-divider/40 pb-1 last:border-b-0 last:pb-0">
                <div class="flex items-baseline gap-2">
                  <span class="font-mono text-foreground">{t.token}</span>
                  {#if t.tokenDescription}
                    <span class="text-muted">— {t.tokenDescription}</span>
                  {/if}
                  {#if !t.knownInAt}
                    <span class="text-faint italic">
                      (not in <span class="font-mono">{app.chassis?.code}AT.000</span>)
                    </span>
                  {:else if t.fsws.length === 0}
                    <span class="text-faint italic">— no FSWs mapped</span>
                  {/if}
                </div>
                {#if t.atComment}
                  <!--
                    Trailing comment on the AT record (e.g. `//Stand
                    PU03_06`). Often gives the production-schedule
                    context BMW added the entry for.
                  -->
                  <p class="ml-3 mt-0.5 text-faint italic">
                    {t.atComment}
                  </p>
                {/if}
                {#if t.fsws.length > 0}
                  <ul class="ml-3 mt-0.5 space-y-0.5">
                    {#each t.fsws as f (f.keyword)}
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
          </ul>
        {/if}
      </div>
    {/if}

    {#if showDetails && id.zcs}
      <!--
        Decoded ZCS panel — ZCS-master chassis (E36/E38/E39/E46/E53)
        encode the SA bit-set as a 16-hex-char field. Each ZST row
        with a non-zero `saMask` whose bits are fully present in the
        user's SA is shown as one active code with its FSWs listed
        underneath (same shape as the decoded-FA panel above). GM/VN
        are scalar identifiers — already rendered raw above; no
        bit-decoding needed.
      -->
      <div class="mt-3 rounded border border-divider bg-base p-2 text-xs">
        <div class="mb-2 flex items-baseline justify-between gap-2 text-faint">
          <span class="font-semibold uppercase tracking-wider">
            Decoded ZCS · {decodedZcs.length} active code{decodedZcs.length === 1 ? "" : "s"}
          </span>
          {#if app.chassis}
            <span>
              from <span class="font-mono">{app.chassis.code}ZST.*</span>
            </span>
          {/if}
        </div>
        {#if !app.chassis?.zst}
          <p class="text-faint italic">
            Chassis <span class="font-mono">{app.chassis?.code}</span> ships no
            <span class="font-mono">ZST</span> table — can't decode SA bits.
          </p>
        {:else if decodedZcs.length === 0}
          <p class="text-faint italic">
            No <span class="font-mono">ZST</span> rows matched the SA bit-set.
            Either the chassis SA pattern is unknown to this DATEN release, or
            the ECU returned an empty SA.
          </p>
        {:else}
          <ul class="space-y-1.5">
            {#each decodedZcs as t (t.saCode)}
              <li class="border-b border-divider/40 pb-1 last:border-b-0 last:pb-0">
                <div class="flex items-baseline gap-2">
                  <span class="font-mono text-foreground">{t.saCode}</span>
                  {#if t.fsws.length === 0}
                    <span class="text-faint italic">— no FSWs mapped</span>
                  {/if}
                </div>
                {#if t.comment}
                  <p class="ml-3 mt-0.5 text-faint italic">
                    {t.comment}
                  </p>
                {/if}
                {#if t.fsws.length > 0}
                  <ul class="ml-3 mt-0.5 space-y-0.5">
                    {#each t.fsws as f (f.keyword)}
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
          </ul>
        {/if}
      </div>
    {/if}
  {:else}
    {#if !canConnect}
      <p class="text-xs text-faint">Connect to the ECU to read FA / ZCS / VIN.</p>
    {:else if identityMasters.length === 0}
      <p class="text-xs text-faint">
        No identity-master SGs found in <span class="font-mono">{app.chassis?.code}</span>'s
        SGFAM. Check the chassis loaded correctly.
      </p>
    {:else}
      <p class="mb-2 text-xs text-faint">
        Identity-master ECUs · {identityMasters.length} — pick an operation per ECU.
      </p>
      <ul class="space-y-1">
        {#each identityMasters as g (g.sgbd)}
          {@const label = g.fa && g.zcs && g.fa.sgName !== g.zcs.sgName
            ? `${g.fa.sgName} / ${g.zcs.sgName}`
            : g.primary.sgName}
          {@const faRow = g.fa}
          {@const zcsRow = g.zcs}
          {@const activeOnThisGroup =
            activeSgName !== null &&
            (activeSgName === faRow?.sgName || activeSgName === zcsRow?.sgName)}
          <li class="flex items-baseline justify-between gap-2 text-sm">
            <span>
              <span class="font-semibold text-foreground">{label}</span>
              <span class="ml-2 font-mono text-xs text-faint">{g.sgbd}</span>
            </span>
            <span class="flex gap-1.5">
              <button
                class="rounded border border-divider bg-base px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
                onclick={() => faRow && onReadFaFromSg(faRow)}
                disabled={reading || faRow === null || !faRow.cabd}
                title={faRow
                  ? `Read FA + VIN from ${faRow.sgName} via ${faRow.sgbd} (${faRow.cabd}.IPO)`
                  : `${g.sgbd} has no FA-master personality in SGFAM`}
              >
                {activeOnThisGroup && activeSgName === faRow?.sgName ? "Reading…" : "Read FA"}
              </button>
              <button
                class="rounded border border-divider bg-base px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
                onclick={() => zcsRow && onReadZcsFromSg(zcsRow)}
                disabled={reading || zcsRow === null || !zcsRow.cabd}
                title={zcsRow
                  ? `Read raw ZCS + VIN from ${zcsRow.sgName} via ${zcsRow.sgbd} (${zcsRow.cabd}.IPO)`
                  : `${g.sgbd} has no ZCS-master personality in SGFAM`}
              >
                {activeOnThisGroup && activeSgName === zcsRow?.sgName ? "Reading…" : "Read ZCS"}
              </button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
