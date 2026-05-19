/**
 * Result of one EDIABAS job call against an SG. Mirrors NCS Expert's "Execute job"
 * outcome — either the SG returned `JOB_STATUS = OKAY` (success) and we have the
 * decoded netto bytes, or something failed and we have a textual reason.
 */
export interface ApiJobResult {
  ok: boolean;
  /** Decoded `JOB_STATUS` result from the SG (or an error message on failure). */
  jobStatus: string;
  /** Raw netto-bytes payload when the job is a reader (e.g. `CODIERDATEN_LESEN`). */
  netto?: Uint8Array;
  /** When `ok === false`, the original error message from the EDIABAS layer. */
  error?: string;
}

/**
 * Minimal `Ediabas`-like surface our adapters need. Mirrors a useful subset of
 * `@emdzej/ediabasx-ediabas`'s `Ediabas` class so callers can pass a real instance, a
 * mock for tests, or any other compatible object.
 */
export interface EdiabasLike {
  /** Load the SGBD by basename (e.g. `KMBI_E60`). Idempotent for the same name. */
  loadSgbd(filename: string): Promise<void>;
  /** Execute a job; returns the SG's result sets. Throws on transport / job error. */
  executeJob(
    jobName: string,
    options?: { params?: string[]; timeout?: number },
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

/** Common EDIABAS job names — typed enum so we don't pass typos. */
export const Jobs = {
  /** Reads the SG's current coding (returns the netto buffer). */
  ReadCoding: 'CODIERDATEN_LESEN',
  /** Writes a new coding (overwrites the SG's netto). */
  WriteCoding: 'SG_CODIEREN',
  /** Reads the coding index of the SG. */
  ReadCodingIndex: 'CODIERINDEX_LESEN',
  /** Reads a JOB_STATUS-only ECU ping. */
  Identify: 'IDENTIFIKATION',
} as const;

export type JobName = (typeof Jobs)[keyof typeof Jobs] | (string & {});

export class WireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireError';
  }
}
