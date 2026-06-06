import { parseDatenFile } from "@emdzej/ncsx-daten";
import type { ChassisSource } from "@emdzej/ncsx-chassis";
import type { VirtualDirectory } from "@emdzej/bimmerz-vfs";
import { drillPath } from "@emdzej/bimmerz-vfs";
import { virtualDirectoryChassisSource } from "./fs-chassis-source";

/**
 * The two subsystems ncsx actually uses out of a BMW Standard Tools install:
 *
 *   <root>/
 *     NCSEXPER/          coding ─── DATEN, PFL, SGDAT, CFGDAT, WORK
 *     EDIABAS/           wire   ─── Bin (EDIABAS.INI), Ecu (.prg/.grp SGBDs)
 *
 * The user picks the install root and we drill case-insensitively for each
 * canonical subdirectory. Missing subdirectories are surfaced to the UI rather
 * than treated as hard failures.
 *
 * All directories are typed as `VirtualDirectory` from `@emdzej/bimmerz-vfs`,
 * so the same code works for three backing sources:
 *
 *   • Local folder picked via `showDirectoryPicker` → `FsaDirectory`
 *   • OPFS-imported ZIP bundle → `FsaDirectory` rooted at the bundle dir
 *   • Remote install served by `bimmerz data index` → `HttpDirectory`
 */
export interface NcsxInstall {
  /** The root the user picked / imported / mounted. */
  root: VirtualDirectory;

  // ── NCSEXPER subsystem (coding) ───────────────────────────────────────────
  /** `<root>/NCSEXPER/DATEN` — chassis DATEN tree (required for coding). */
  daten: VirtualDirectory | null;
  /** `<root>/NCSEXPER/SGDAT` — per-SG BEST scripts (`.ipo` files). */
  ncsSgdat: VirtualDirectory | null;
  /** `<root>/NCSEXPER/CFGDAT` — COAPI.INI, NCSEXPER.INI etc. */
  ncsCfgdat: VirtualDirectory | null;
  /** `<root>/NCSEXPER/PFL` — `.pfl` profile files. */
  pfl: VirtualDirectory | null;
  /** `<root>/NCSEXPER/WORK` — where TRC/MAN files traditionally live. */
  ncsWork: VirtualDirectory | null;

  // ── EDIABAS subsystem (wire / ECU access) ─────────────────────────────────
  /** `<root>/EDIABAS/Ecu` — SGBD `.prg` / `.grp` files. */
  ediabasEcu: VirtualDirectory | null;
  /** `<root>/EDIABAS/Bin` — EDIABAS.INI + interface DLLs (not needed in browser). */
  ediabasBin: VirtualDirectory | null;

  // ── Derived: chassis catalogue (from BR_REF.DAT under daten) ──────────────
  /** Chassis codes listed in BR_REF.DAT, e.g. ["E36", "E46", "E60", …]. */
  chassisCodes: string[];

  // ── Adapter ───────────────────────────────────────────────────────────────
  /**
   * `ChassisSource` rooted at `daten`, ready to feed `loadChassis()`. Lazily
   * built so we don't reach into the daten handle if it's null.
   */
  datenSource: ChassisSource | null;
}

export class NcsxInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NcsxInstallError";
  }
}

/** Whether the install has the minimum needed to start coding (DATEN with a parseable BR_REF). */
export function isCodingReady(install: NcsxInstall): boolean {
  return install.daten !== null && install.chassisCodes.length > 0;
}

/** Whether the install has what we'll need for the wire layer (EDIABAS Ecu). */
export function isWireReady(install: NcsxInstall): boolean {
  return install.ediabasEcu !== null;
}

/**
 * Discover the install layout under `root`. Drills case-insensitively for each
 * canonical subdirectory via VFS's `drillPath` (so the same code handles
 * Windows-cased dumps, rsync'd lowercased trees, and remote installs whose
 * `index.json` preserves the on-disk casing). Falls back to "the user picked
 * NCSEXPER directly" if there's no NCSEXPER subfolder but there *is* a DATEN
 * one — convenience for folks who copy just the NCSEXPER tree.
 */
export async function discoverNcsxInstall(
  root: VirtualDirectory,
): Promise<NcsxInstall> {
  const [
    daten,
    ncsSgdat,
    ncsCfgdat,
    pfl,
    ncsWork,
    ediabasEcu,
    ediabasBin,
  ] = await Promise.all([
    /* drillPath takes VARIADIC segments, not a slash-joined path —
       passing "NCSEXPER/DATEN" would look for a single directory
       literally named "NCSEXPER/DATEN". Spread the segments. */
    drillPath(root, "NCSEXPER", "DATEN"),
    drillPath(root, "NCSEXPER", "SGDAT"),
    drillPath(root, "NCSEXPER", "CFGDAT"),
    drillPath(root, "NCSEXPER", "PFL"),
    drillPath(root, "NCSEXPER", "WORK"),
    drillPath(root, "EDIABAS", "Ecu"),
    drillPath(root, "EDIABAS", "Bin"),
  ]);

  /* Fallback: user picked NCSEXPER directly (no NCSEXPER subdir, but
     DATEN at root level). */
  let resolvedDaten = daten;
  let resolvedNcsSgdat = ncsSgdat;
  let resolvedNcsCfgdat = ncsCfgdat;
  let resolvedPfl = pfl;
  let resolvedNcsWork = ncsWork;
  if (!resolvedDaten) {
    const datenDirect = await drillPath(root, "DATEN");
    if (datenDirect) {
      resolvedDaten = datenDirect;
      resolvedNcsSgdat ??= await drillPath(root, "SGDAT");
      resolvedNcsCfgdat ??= await drillPath(root, "CFGDAT");
      resolvedPfl ??= await drillPath(root, "PFL");
      resolvedNcsWork ??= await drillPath(root, "WORK");
    }
  }
  /* Or: user picked the DATEN folder itself (BR_REF.DAT directly at root). */
  if (!resolvedDaten && (await root.file("BR_REF.DAT"))) {
    resolvedDaten = root;
  }

  if (!resolvedDaten) {
    throw new NcsxInstallError(
      `Couldn't find BR_REF.DAT under "${root.name}". Point us at the BMW Standard ` +
        `Tools install root (the folder containing NCSEXPER/, EDIABAS/, EC-APPS/), ` +
        `at NCSEXPER/ directly, or at a remote install index URL.`,
    );
  }

  const datenSource = virtualDirectoryChassisSource(resolvedDaten);
  const chassisCodes = await readChassisCodes(datenSource);

  return {
    root,
    daten: resolvedDaten,
    ncsSgdat: resolvedNcsSgdat,
    ncsCfgdat: resolvedNcsCfgdat,
    pfl: resolvedPfl,
    ncsWork: resolvedNcsWork,
    ediabasEcu,
    ediabasBin,
    chassisCodes,
    datenSource,
  };
}

/**
 * Read BR_REF.DAT under the daten root and extract the chassis-code list from
 * the `BR_ZEILE` block.
 */
async function readChassisCodes(source: ChassisSource): Promise<string[]> {
  try {
    const bytes = await source.read("BR_REF.DAT");
    const file = parseDatenFile(bytes);
    const brZeile = file.blocks.find((b) => b.name === "BR_ZEILE");
    if (!brZeile) return [];
    const out: string[] = [];
    for (const row of brZeile.rows) {
      for (const value of Object.values(row)) {
        if (typeof value === "string" && value.length > 0) {
          out.push(value);
          break;
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
