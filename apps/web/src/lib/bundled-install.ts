/**
 * Install-source marker for the top-bar pill — which of the three
 * tile paths the currently-mounted install came from. Mirrors the
 * `bundled-install.ts` shape in inpax-web (minus the OPFS bundle
 * import flow, which ncsx doesn't ship yet — `"bundled"` is reserved
 * for the future bimmerz-bundler ZIP path).
 *
 * Persisted to localStorage so the source is known across reloads.
 * The pill component reads from reactive `app.installSource` (mirror
 * of this marker) so mid-session switches re-render without a reload.
 */

const STORAGE_KEY = "ncsx.web.install.source";

/**
 * Tagged-union describing where the install came from. The pill UI
 * branches on `.source`; the extra fields (importedAt / fileCount /
 * bytes) live on `"bundled"` for the eventual ZIP-import flow.
 */
export type InstallSource =
  | { source: "fs-access" }
  | {
      source: "bundled";
      /** ISO timestamp of the import (for the tooltip). */
      importedAt: string;
      /** Total file count after extracting the bundle. */
      fileCount: number;
      /** Total uncompressed bytes (for sanity-check display). */
      bytes: number;
    }
  | { source: "remote" };

export function getInstallSource(): InstallSource | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as InstallSource;
    /* Trust-but-verify: discard anything we don't recognise so a
       future schema bump doesn't crash the pill. */
    if (
      parsed.source === "fs-access" ||
      parsed.source === "bundled" ||
      parsed.source === "remote"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function setInstallSource(source: InstallSource): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
}

export function clearInstallSource(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
