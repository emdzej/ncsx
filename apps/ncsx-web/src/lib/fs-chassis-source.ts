import type { ChassisSource } from "@emdzej/ncsx-chassis";

/**
 * Browser-side `ChassisSource` backed by a `FileSystemDirectoryHandle` from
 * `window.showDirectoryPicker()`. Path lookups are case-insensitive at every segment so
 * `e46/E46DST.000` resolves regardless of how the file system reports the casing — real
 * NCSEXPER installs frequently mix `E46` (Windows) with `e46` (rsync'd to macOS / Linux).
 *
 * The handle tree is cached lazily to avoid re-listing the root directory for every read.
 */
export function fileSystemAccessChassisSource(
  root: FileSystemDirectoryHandle,
): ChassisSource {
  return {
    async read(path) {
      const handle = await resolveFileHandle(root, path);
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    },
    async exists(path) {
      try {
        await resolveFileHandle(root, path);
        return true;
      } catch {
        return false;
      }
    },
    async list(dir) {
      const handle = dir === "" ? root : await resolveDirHandle(root, dir);
      const out: string[] = [];
      for await (const [name] of handle.entries()) out.push(name);
      return out;
    },
  };
}

/**
 * Drill into the directory tree case-insensitively. Throws if any segment doesn't exist
 * or has the wrong kind.
 */
async function resolveDirHandle(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const segments = path.split(/[\\/]/).filter((s) => s.length > 0);
  let current: FileSystemDirectoryHandle = root;
  for (const segment of segments) {
    current = await findDirectory(current, segment);
  }
  return current;
}

async function resolveFileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemFileHandle> {
  const segments = path.split(/[\\/]/).filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error("empty path");
  }
  const fileName = segments[segments.length - 1]!;
  const dirPath = segments.slice(0, -1).join("/");
  const dir = dirPath === "" ? root : await resolveDirHandle(root, dirPath);
  return findFile(dir, fileName);
}

async function findDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  const target = name.toLowerCase();
  for await (const [entryName, handle] of parent.entries()) {
    if (entryName.toLowerCase() === target && handle.kind === "directory") {
      return handle as FileSystemDirectoryHandle;
    }
  }
  throw new Error(`directory not found: ${name}`);
}

async function findFile(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemFileHandle> {
  const target = name.toLowerCase();
  for await (const [entryName, handle] of parent.entries()) {
    if (entryName.toLowerCase() === target && handle.kind === "file") {
      return handle as FileSystemFileHandle;
    }
  }
  throw new Error(`file not found: ${name}`);
}
