/**
 * Minimal `Ediabas`-like surface our adapters need. Mirrors a useful subset of
 * `@emdzej/ediabasx-ediabas`'s `Ediabas` class so callers can pass a real instance, a
 * mock for tests, or any other compatible object.
 *
 * `@emdzej/ncsx-wire` used to host wire-direct `apiJob` helpers (`readCoding`,
 * `applyCodingPlan`, etc.) for the early bring-up. Those bypassed the per-CABD
 * `A_*.ipo` dispatcher and were retired once
 * `@emdzej/ncsx-inpax-cabi-provider` + the orchestrator in
 * `apps/ncsx-web/src/lib/process-ecu.ts` covered the full IPO path for both
 * read and write. The package now exists purely to publish these shared
 * Ediabas-shape types — `@emdzej/ncsx-identity` and
 * `@emdzej/ncsx-inpax-cabi-provider` consume them.
 */
export interface EdiabasLike {
  /** Load the SGBD by basename (e.g. `KMBI_E60`). Idempotent for the same name. */
  loadSgbd(filename: string): Promise<void>;
  /**
   * Execute a job; returns the SG's result sets. Throws on transport / job error.
   *
   * `params` accepts both strings and `Uint8Array` since `ediabasx` 0.2.4:
   * a `Uint8Array` lands in the BEST2 interpreter's `binaryPayload`
   * (read by `pary` / `parb` / `parw` / `parl` / `parr`), a `string`
   * goes into the indexed-param slots (read by `pari` / `pars`). NCS
   * coding jobs like `C_S_LESEN` / `C_S_SCHREIBEN` need the binary
   * channel for their CABI request packet.
   */
  executeJob(
    jobName: string,
    options?: { params?: (string | Uint8Array)[]; timeout?: number },
  ): Promise<EdiabasJobResultLike[][]>;
  /** Whether the cable is currently connected. */
  isConnected(): boolean;
}

/**
 * One named result inside an `executeJob` response set. Mirrors `EdiabasJobResult` from
 * `@emdzej/ediabasx-ediabas` minus the `unit` / `comment` fields we don't use.
 */
export interface EdiabasJobResultLike {
  name: string;
  type: string;
  value: unknown;
}
