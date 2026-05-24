/**
 * Logger-category catalogue for the ncsx subsystem.
 *
 * Consumer apps (the ncsx-web Settings dialog, future tools that
 * bundle ncsx) iterate this array to build per-category controls
 * without hardcoding category names. Hints surface as tooltips /
 * sublabels.
 *
 * Living in `@emdzej/ncsx-chassis` rather than a dedicated package
 * because chassis is the canonical entry that every host app
 * already imports — keeps the catalogue close to the rest of the
 * ncsx surface without adding a new top-level package.
 *
 * Add an entry here whenever a new `getLogger("NCSX.*")` call site
 * lands that's worth exposing to end users. Internal-only categories
 * (test fixtures, dev scripts) stay out — they'd just clutter the
 * Settings UI.
 *
 * The hint must be one sentence; longer copy belongs in docs.
 */

import type { LogCategory } from "@emdzej/bimmerz-logger";

export const LOG_CATEGORIES: readonly LogCategory[] = [
  {
    name: "NCSX",
    hint: "Catch-all for the ncsx subsystem — overrides any unmatched subtree below.",
  },
  {
    name: "NCSX.cabi-provider",
    hint: "CDH* dispatch tap — every CABI call going through the inpax-cabi-provider.",
  },
  {
    name: "NCSX.web",
    hint: "Top-level web app — translations load, root-level lifecycle.",
  },
  {
    name: "NCSX.web.pwa",
    hint: "Service-worker registration / offline-ready lifecycle.",
  },
  {
    name: "NCSX.web.runtime",
    hint: "Per-module IPO runtime startup and VM errors.",
  },
  {
    name: "NCSX.web.process-ecu",
    hint: "ECU processing — read / write coding lifecycle.",
  },
  {
    name: "NCSX.web.cabi-syscalls",
    hint: "Per-slot CABI syscall dispatch traces + histogram ticks.",
  },
  {
    name: "NCSX.web.install-storage",
    hint: "IndexedDB persistence of the picked install folder handle.",
  },
  {
    name: "NCSX.web.chassis-list",
    hint: "Chassis-load warnings (missing optional DATEN file, malformed table, …).",
  },
  {
    name: "NCSX.web.ecu-list",
    hint: "FA→ASW resolution + per-row module-process state.",
  },
  {
    name: "NCSX.web.function-tree",
    hint: "Function tree view — JOB_ERMITTELN enumeration warnings.",
  },
];
