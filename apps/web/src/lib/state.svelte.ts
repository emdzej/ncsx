import type { Chassis } from "@emdzej/ncsx-chassis";
import type { FunctionList } from "@emdzej/ncsx-function-list";
import type { ZcsRead } from "@emdzej/ncsx-identity";
import type { SgfamRow } from "@emdzej/ncsx-text-tables";
import type { TranslationFile } from "@emdzej/ncsx-translations";
import { loadConfig, type WebConfig } from "./config";
import type { NcsxInstall } from "./daten-install";
import { getInstallSource, type InstallSource } from "./bundled-install";

/**
 * Result of reading the chassis-identity payload. FA and ZCS are
 * **structurally different** even though they encode the same information:
 *
 * - **FA** (post-E60-ish) is a single token string the SG hands back verbatim:
 *   `E46_#0306&N6SW%0354$167$1CA$205…`. Editing it = appending / removing tokens.
 * - **ZCS** (pre-FA chassis: E36/E38/E39/E46/E53) is **three fields** — `GM`
 *   (base-model code), `SA` (a hex-encoded bit-set indexed by `<BR>ZST.*`), `VN`
 *   (version-number). NCS Expert exposes them in the "Enter ZCS" dialog as separate
 *   text inputs; editing the bit-set means toggling bits per ZST.
 *
 * Both fields can be populated at once — many ECUs host both roles (E46
 * AKMB+KMB is the canonical example: same SGBD `C_KMB46`, separate
 * CABDs `A_AKMB46` / `A_KMB46`). Each read merges into the existing
 * identity instead of replacing it, with `faSource` / `zcsSource`
 * tracking which SGFAM row each payload came from so the editors can
 * dispatch writes against the matching CABD.
 *
 * VIN comes through on both paths (read separately via `FGNR_LESEN`).
 */
export interface VehicleIdentity {
  /** SGFAM row the FA payload was read from (drives FA_WRITE's CABD). */
  faSource?: SgfamRow;
  /** SGFAM row the ZCS payload was read from (drives ZCS_SCHREIBEN's CABD). */
  zcsSource?: SgfamRow;
  /** 17-character VIN string, or undefined when the SG didn't return one. */
  vin?: string;
  /** FA token string (FA-master SGs). */
  fa?: string;
  /** Structured ZCS payload (ZCS-master SGs). Raw bytes + GM/VN/coding-index. */
  zcs?: ZcsRead;
  /** Per-job JOB_STATUS (`OKAY` on success). */
  vinStatus?: string;
  faStatus?: string;
  zcsStatus?: string;
  /** EDIABAS-layer error text if all jobs failed entirely. */
  error?: string;
}

/**
 * Top-level UI states. `picker` is the landing screen; `browse-chassis` once an install
 * is mounted; `browse-modules` once a chassis is selected; `view-module` for a loaded
 * SG's catalog.
 */
export type AppView =
  | "picker"
  | "browse-chassis"
  | "browse-modules"
  | "view-module";

/**
 * How `SelectedModule.codingIndex` was determined. `auto` carries the
 * EDIABAS `JOB_STATUS` and raw hex from the live `CODIERINDEX_LESEN`
 * run so the UI can explain *why* a particular `.Cxx` was picked.
 * `manual` is when the user clicked a CI in the "Browse all coding
 * variants manually" list.
 */
export type ModuleResolution =
  | {
      kind: "auto";
      /** SGFAM row name we dispatched against (e.g. `KMB`). */
      sourceSg: string;
      /** Raw hex string the IPO published as `CODIERINDEX` (e.g. `08`). */
      codingIndexHex: string;
      /** Last EDIABAS `JOB_STATUS` from the IPO run (e.g. `OKAY`). */
      jobStatus: string;
    }
  | { kind: "manual" };

/**
 * Per-module ECU coordinates. Populated when the user picks a `.Cxx` from `ModuleList`,
 * so the `FunctionTree` knows which SGBD to talk to when reading from the bus and which
 * UMRSG to surface as the logical SG label.
 */
export interface SelectedModule {
  /** Physical SGNAME = `.Cxx` file basename (e.g. `KMB_E46`). */
  moduleName: string;
  /** Coding index byte (e.g. `0x06`). */
  codingIndex: number;
  /** EDIABAS module name to feed to `apiJob(sgbd, …)`. Picked from SGAUSWAHL. */
  sgbd: string | null;
  /** Logical SG (e.g. `KMB`); null if no matching SGAUSWAHL row was found. */
  umrsg: string | null;
  /** How we landed on this CI — auto-resolved from the ECU vs user-picked. */
  resolution: ModuleResolution;
}

interface AppState {
  view: AppView;
  /** Persisted connection / interface config (interface type, baud, timeouts, …). */
  config: WebConfig;
  /** Whether the Settings dialog is open. */
  showSettings: boolean;
  /** Whether the FA edit dialog is open. */
  showFaEditor: boolean;
  /** Whether the ZCS edit dialog is open. */
  showZcsEditor: boolean;
  /** Whether the FGNR (VIN) edit dialog is open. */
  showFgnrEditor: boolean;
  /** Whether the About dialog is open. */
  showAbout: boolean;
  /** Whether the Bimmerz Connect session-token dialog is open. */
  showConnectSession: boolean;
  /**
   * Bimmerz Connect: transient session ID (not persisted). Set by
   * the connect-session dialog after the user pastes the
   * `sessionId.token` blob; cleared on disconnect. Lives outside
   * `config` because a session token shouldn't survive a reload —
   * the relay host re-prints it per session.
   */
  connectSessionId: string | null;
  /** Bimmerz Connect: transient initiator token (not persisted). */
  connectToken: string | null;
  install: NcsxInstall | null;
  /**
   * Where the currently-loaded install came from — FSA folder pick,
   * OPFS bundle import (reserved — not yet shipped), or remote VFS
   * URL. Reactive mirror of the localStorage marker
   * (`getInstallSource()`); the top-bar source pill reads from here
   * so the chip updates mid-session when the user switches sources
   * without reloading the page.
   */
  installSource: InstallSource | null;
  chassis: Chassis | null;
  /** Display label of the currently-viewed module (formatted as `KMB_E46.C06`). */
  selectedSg: string | null;
  /** Structured info for the currently-viewed module; null between picks. */
  selectedModule: SelectedModule | null;
  functionList: FunctionList | null;
  /**
   * VIN + FA read from a user-picked identity ECU (FA-master per SGFAM). Drives the
   * header display and feeds the upcoming FA/ZCS editors. Cleared on chassis change.
   */
  identity: VehicleIdentity | null;
  /**
   * Last `CODIERDATEN_LESEN` result for the currently-viewed module. UI
   * surfaces it as the "current coding" hex dump, drives the per-FSW
   * "currently coded" indicator in the FunctionTree, and feeds the
   * pending-edits splicer that builds the `pendingNetto` passed to
   * `processWriteCoding`.
   */
  lastReadNetto: Uint8Array | null;
  /**
   * Job names the currently-viewed SG declares via its `A_*.ipo`
   * `JOB_ERMITTELN` dispatcher. NCSEXPER's "Change job" dialog
   * (Image 5 in the design docs) renders this same list — we mirror
   * it so users can run any job the IPO exposes, not just the
   * read/write pair we wire explicitly. Cleared on module change.
   *
   * - `null`  → not yet enumerated (load pending or failed)
   * - `[]`    → ran but the IPO declared zero jobs (shouldn't happen
   *             on real IPOs but defensive)
   * - `[...]` → ordered list, first entry is conventionally
   *             `JOB_ERMITTELN` itself
   */
  availableJobs: string[] | null;
  /**
   * Community-maintained NCSDummy-style keyword→English dictionary. Loaded once on app
   * startup from `/translations.csv`; null until the fetch settles. UI components fall
   * back to raw keywords when the lookup is unavailable.
   */
  translations: TranslationFile | null;
  error: string | null;
  busy: boolean;
}

/**
 * Single shared `$state` object. Components import this directly and mutate it; Svelte's
 * runes-mode reactivity propagates the changes.
 */
export const app: AppState = $state({
  view: "picker",
  config: loadConfig(),
  showSettings: false,
  showFaEditor: false,
  showZcsEditor: false,
  showFgnrEditor: false,
  showAbout: false,
  showConnectSession: false,
  connectSessionId: null,
  connectToken: null,
  install: null,
  installSource: getInstallSource(),
  chassis: null,
  selectedSg: null,
  selectedModule: null,
  functionList: null,
  identity: null,
  lastReadNetto: null,
  availableJobs: null,
  translations: null,
  error: null,
  busy: false,
});
