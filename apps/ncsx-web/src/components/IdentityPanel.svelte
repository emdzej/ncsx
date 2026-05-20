<script lang="ts">
  import { findSgsByFlag } from "@emdzej/ncsx-chassis";
  import { padFgnrToVin } from "@emdzej/ncsx-identity";
  import type { SgfamRow } from "@emdzej/ncsx-text-tables";
  import { app } from "../lib/state.svelte";
  import { connection } from "../lib/ediabas-session.svelte";
  import { startNcsRuntime, type RuntimeHandle } from "../lib/runtime.svelte";

  let reading = $state(false);
  /** SG the user is actively reading from — drives the per-row spinner. */
  let activeSgName = $state<string | null>(null);

  /**
   * FA-master SGs (SGFAM `FA=1`) — modern chassis. On E46 that's typically AKMB + ALSZ;
   * on F-series it'll be ZGW or CAS4. Sort alphabetically for stable display.
   */
  const faMasters = $derived.by<SgfamRow[]>(() => {
    if (!app.chassis) return [];
    return findSgsByFlag(app.chassis.sgfam, "fa")
      .slice()
      .sort((a, b) => a.sgName.localeCompare(b.sgName));
  });

  /**
   * ZCS-master SGs (SGFAM `ZCS=1`) — pre-FA chassis (E36/E38/E39/E46/E53). Reading
   * returns structured GM/SA/VN bytes; decoding the SA bit-set into named codes needs
   * the chassis-side `<BR>ZST.*` table and isn't wired yet (assumption A6).
   */
  const zcsMasters = $derived.by<SgfamRow[]>(() => {
    if (!app.chassis) return [];
    return findSgsByFlag(app.chassis.sgfam, "zcs")
      .slice()
      .sort((a, b) => a.sgName.localeCompare(b.sgName));
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
          source: row,
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
   * The SA-bit decoding via `<BR>ZST.*` is a separate package (assumption A6).
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
          source: row,
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
      <button
        class="text-xs text-faint underline-offset-2 hover:text-muted hover:underline"
        onclick={clearIdentity}
      >
        clear
      </button>
    {/if}
  </div>

  {#if app.identity}
    {@const id = app.identity}
    <div class="space-y-1 text-xs">
      <div class="flex gap-2">
        <span class="w-12 font-mono text-faint">VIN</span>
        <span class="font-mono text-foreground">
          {id.vin ?? "—"}
          {#if !id.vin && id.vinStatus}
            <span class="text-faint">({id.vinStatus})</span>
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
              <div class="mt-0.5 text-faint italic">
                SA bit-set decoding (via <span class="font-mono">{app.chassis?.code}ZST.*</span>)
                — not yet wired
              </div>
            {:else}
              — <span class="text-faint">({id.zcsStatus})</span>
            {/if}
          </div>
        </div>
      {/if}

      <p class="pt-1 font-sans text-faint">
        read from <span class="font-mono">{id.source.sgName}</span> ({id.source.sgbd})
      </p>
    </div>
  {:else}
    {#if !canConnect}
      <p class="text-xs text-faint">Connect to the ECU to read FA / ZCS / VIN.</p>
    {:else if faMasters.length === 0 && zcsMasters.length === 0}
      <p class="text-xs text-faint">
        No identity-master SGs found in <span class="font-mono">{app.chassis?.code}</span>'s
        SGFAM. Check the chassis loaded correctly.
      </p>
    {:else}
      <p class="mb-2 text-xs text-faint">Pick an ECU to read its identity payload.</p>

      {#if faMasters.length > 0}
        <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
          FA-master · {faMasters.length}
        </p>
        <ul class="mb-3 space-y-1">
          {#each faMasters as row (row.sgName)}
            <li class="flex items-baseline justify-between gap-2 text-sm">
              <span>
                <span class="font-semibold text-foreground">{row.sgName}</span>
                <span class="ml-2 font-mono text-xs text-faint">{row.sgbd}</span>
              </span>
              <button
                class="rounded border border-divider bg-base px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                onclick={() => onReadFaFromSg(row)}
                disabled={reading || !row.sgbd}
                title={row.sgbd
                  ? `Read FA + VIN from ${row.sgName} via ${row.sgbd}`
                  : `SGFAM row for ${row.sgName} has no SGBD`}
              >
                {activeSgName === row.sgName ? "Reading…" : "Read FA"}
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if zcsMasters.length > 0}
        <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-faint">
          ZCS-master · {zcsMasters.length}
        </p>
        <ul class="space-y-1">
          {#each zcsMasters as row (row.sgName)}
            <li class="flex items-baseline justify-between gap-2 text-sm">
              <span>
                <span class="font-semibold text-foreground">{row.sgName}</span>
                <span class="ml-2 font-mono text-xs text-faint">{row.sgbd}</span>
              </span>
              <button
                class="rounded border border-divider bg-base px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                onclick={() => onReadZcsFromSg(row)}
                disabled={reading || !row.sgbd}
                title={row.sgbd
                  ? `Read raw ZCS + VIN from ${row.sgName} via ${row.sgbd}`
                  : `SGFAM row for ${row.sgName} has no SGBD`}
              >
                {activeSgName === row.sgName ? "Reading…" : "Read ZCS"}
              </button>
            </li>
          {/each}
        </ul>
        <p class="mt-2 text-xs text-faint italic">
          ZCS read returns raw bytes; SA bit-set decoding via
          <span class="font-mono">{app.chassis?.code}ZST.*</span> is pending — see
          <span class="font-mono">docs/assumptions.md</span> A6.
        </p>
      {/if}
    {/if}
  {/if}
</section>
