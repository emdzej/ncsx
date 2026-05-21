import { parseDatenFile } from "@emdzej/ncsx-daten";
import type { ChassisSource } from "@emdzej/ncsx-chassis";
import { fileSystemAccessChassisSource } from "./fs-chassis-source";

/**
 * The two subsystems ncsx actually uses out of a BMW Standard Tools install:
 *
 *   <root>/
 *     NCSEXPER/          coding ─── DATEN, PFL, SGDAT, CFGDAT, WORK
 *     EDIABAS/           wire   ─── Bin (EDIABAS.INI), Ecu (.prg/.grp SGBDs)
 *
 * EC-APPS/INPA/ also exists in real installs (INPA diagnostic IPOs) but ncsx
 * doesn't consume it — our IPO flow runs `A_*.ipo` dispatchers from
 * `NCSEXPER/SGDAT/`, not INPA's diag scripts. Kept out of the discovery so the
 * UI doesn't suggest we'd use it.
 *
 * The user picks the install root and we drill case-insensitively for each
 * canonical subdirectory. Missing subdirectories are surfaced to the UI rather
 * than treated as hard failures.
 */
export interface NcsxInstall {
  /** The directory the user picked via showDirectoryPicker. */
  root: FileSystemDirectoryHandle;

  // ── NCSEXPER subsystem (coding) ───────────────────────────────────────────
  /** `<root>/NCSEXPER/DATEN` — chassis DATEN tree (required for coding). */
  daten: FileSystemDirectoryHandle | null;
  /** `<root>/NCSEXPER/SGDAT` — per-SG BEST scripts (`.ipo` files). */
  ncsSgdat: FileSystemDirectoryHandle | null;
  /** `<root>/NCSEXPER/CFGDAT` — COAPI.INI, NCSEXPER.INI etc. */
  ncsCfgdat: FileSystemDirectoryHandle | null;
  /** `<root>/NCSEXPER/PFL` — `.pfl` profile files. */
  pfl: FileSystemDirectoryHandle | null;
  /** `<root>/NCSEXPER/WORK` — where TRC/MAN files traditionally live. */
  ncsWork: FileSystemDirectoryHandle | null;

  // ── EDIABAS subsystem (wire / ECU access) ─────────────────────────────────
  /** `<root>/EDIABAS/Ecu` — SGBD `.prg` / `.grp` files. */
  ediabasEcu: FileSystemDirectoryHandle | null;
  /** `<root>/EDIABAS/Bin` — EDIABAS.INI + interface DLLs (not needed in browser). */
  ediabasBin: FileSystemDirectoryHandle | null;

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
 * canonical subdirectory. Falls back to "the user picked NCSEXPER directly" if
 * there's no NCSEXPER subfolder but there *is* a DATEN one — convenience for
 * folks who copy just the NCSEXPER tree.
 */
export async function discoverNcsxInstall(
  root: FileSystemDirectoryHandle,
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
    drill(root, ["NCSEXPER", "DATEN"]),
    drill(root, ["NCSEXPER", "SGDAT"]),
    drill(root, ["NCSEXPER", "CFGDAT"]),
    drill(root, ["NCSEXPER", "PFL"]),
    drill(root, ["NCSEXPER", "WORK"]),
    drill(root, ["EDIABAS", "Ecu"]),
    drill(root, ["EDIABAS", "Bin"]),
  ]);

  // Fallback: user picked NCSEXPER directly (no NCSEXPER subdir, but DATEN at root level).
  let resolvedDaten = daten;
  let resolvedNcsSgdat = ncsSgdat;
  let resolvedNcsCfgdat = ncsCfgdat;
  let resolvedPfl = pfl;
  let resolvedNcsWork = ncsWork;
  if (!resolvedDaten) {
    const datenDirect = await drill(root, ["DATEN"]);
    if (datenDirect) {
      resolvedDaten = datenDirect;
      resolvedNcsSgdat ??= await drill(root, ["SGDAT"]);
      resolvedNcsCfgdat ??= await drill(root, ["CFGDAT"]);
      resolvedPfl ??= await drill(root, ["PFL"]);
      resolvedNcsWork ??= await drill(root, ["WORK"]);
    }
  }
  // Or: user picked the DATEN folder itself (BR_REF.DAT directly at root).
  if (!resolvedDaten && (await hasEntry(root, "BR_REF.DAT", "file"))) {
    resolvedDaten = root;
  }

  if (!resolvedDaten) {
    throw new NcsxInstallError(
      `Couldn't find BR_REF.DAT under "${root.name}". Point us at the BMW Standard ` +
        `Tools install root (the folder containing NCSEXPER/, EDIABAS/, EC-APPS/) or at ` +
        `NCSEXPER/ directly.`,
    );
  }

  const datenSource = fileSystemAccessChassisSource(resolvedDaten);
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

/**
 * Drill down a multi-segment path case-insensitively. Returns null if any
 * segment doesn't exist. Real installs vary on segment casing depending on
 * which OS the files were last touched.
 */
async function drill(
  start: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle | null> {
  let current: FileSystemDirectoryHandle = start;
  for (const segment of segments) {
    const target = segment.toLowerCase();
    let found: FileSystemDirectoryHandle | null = null;
    for await (const [name, entry] of current.entries()) {
      if (entry.kind === "directory" && name.toLowerCase() === target) {
        found = entry as FileSystemDirectoryHandle;
        break;
      }
    }
    if (!found) return null;
    current = found;
  }
  return current;
}

async function hasEntry(
  handle: FileSystemDirectoryHandle,
  name: string,
  kind: "file" | "directory",
): Promise<boolean> {
  const target = name.toLowerCase();
  for await (const [entryName, entry] of handle.entries()) {
    if (entryName.toLowerCase() === target && entry.kind === kind) return true;
  }
  return false;
}
