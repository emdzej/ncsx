import type { ChassisSource } from "@emdzej/ncsx-chassis";
import type { VirtualDirectory } from "@emdzej/bimmerz-vfs";
import { listFiles } from "@emdzej/bimmerz-vfs";

/**
 * `ChassisSource` backed by a `@emdzej/bimmerz-vfs` `VirtualDirectory`.
 * One adapter handles every install backing:
 *
 *   • `FsaDirectory` — wraps a user-picked
 *     `FileSystemDirectoryHandle` (Web Serial cable + local install
 *     on disk, or OPFS-stored bundle import).
 *   • `HttpDirectory` — wraps a remote install served via
 *     `bimmerz data index` (a tree of `index.json` listings).
 *
 * Path lookups stay case-insensitive at every segment (real NCSEXPER
 * installs mix `E46`/`e46` casings rsync'd between Windows / macOS /
 * Linux), but the case-insensitivity now lives in the VFS layer
 * (`drillPath`) rather than here. This file is glue.
 */
export function virtualDirectoryChassisSource(
  root: VirtualDirectory,
): ChassisSource {
  return {
    async read(path) {
      const file = await resolveFile(root, path);
      return file.arrayBuffer().then((b) => new Uint8Array(b));
    },
    async exists(path) {
      try {
        await resolveFile(root, path);
        return true;
      } catch {
        return false;
      }
    },
    async list(dir) {
      const handle = dir === "" ? root : await resolveDir(root, dir);
      const entries = await listFiles(handle);
      return entries.map((e) => e.name);
    },
  };
}

/**
 * Old FSA-shaped entry point kept as a thin wrapper for callers that
 * still hand us a `FileSystemDirectoryHandle`. Internally builds an
 * `FsaDirectory` and delegates. Once all call sites pass
 * `VirtualDirectory` we can drop this.
 *
 * @deprecated Prefer {@link virtualDirectoryChassisSource} with an
 * explicit `FsaDirectory(handle)` so the FS-source picker can
 * branch on the VFS shape.
 */
export function fileSystemAccessChassisSource(): never {
  throw new Error(
    "fileSystemAccessChassisSource was removed in the VFS migration. " +
      "Wrap the handle with `new FsaDirectory(handle)` from @emdzej/bimmerz-vfs " +
      "and pass it to `virtualDirectoryChassisSource`.",
  );
}

/* ── path resolution ─────────────────────────────────────────────── */

async function resolveDir(
  root: VirtualDirectory,
  path: string,
): Promise<VirtualDirectory> {
  const segments = path.split(/[\\/]/).filter((s) => s.length > 0);
  let current = root;
  for (const segment of segments) {
    const next = await current.dir(segment);
    if (!next) throw new Error(`directory not found: ${segment}`);
    current = next;
  }
  return current;
}

async function resolveFile(
  root: VirtualDirectory,
  path: string,
) {
  const segments = path.split(/[\\/]/).filter((s) => s.length > 0);
  if (segments.length === 0) throw new Error("empty path");
  const fileName = segments[segments.length - 1]!;
  const dirPath = segments.slice(0, -1).join("/");
  const dir = dirPath === "" ? root : await resolveDir(root, dirPath);
  const file = await dir.file(fileName);
  if (!file) throw new Error(`file not found: ${fileName}`);
  return file;
}
