/**
 * Persist the user's NCSEXPER DATEN folder choice between sessions.
 *
 * `FileSystemDirectoryHandle` is structured-cloneable but NOT JSON-serialisable, so we
 * use IndexedDB (one tiny single-record key/value store) instead of `localStorage`. The
 * handle itself is preserved; the file *access permission* is not — browsers drop
 * permissions across reloads for security. On startup we `queryPermission({ mode:
 * "read" })` and, if it returns `"granted"`, the handle is usable directly. If it
 * returns `"prompt"`, a user gesture (the "Continue with last folder" button) calls
 * `requestPermission` to re-grant.
 *
 * Chromium-only: the FileSystem Access API + persistent handles are part of the same
 * WICG spec the rest of ncsx-web depends on. Firefox / Safari users are blocked earlier
 * by `isFileSystemAccessSupported()`.
 *
 * Lifted from `inpax/apps/inpax-web/src/lib/install-storage.ts` — same pattern; rename
 * of the database to `ncsx-web` so the two apps coexist without colliding.
 */

import { getLogger } from "@emdzej/bimmerz-logger";

const log = getLogger("NCSX.web.install-storage");

const DB_NAME = "ncsx-web";
const DB_VERSION = 1;
const STORE_NAME = "install";
const RECORD_KEY = "root";

type PermissionState = "granted" | "denied" | "prompt";

type HandleWithPermissions = {
  queryPermission?: (desc?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
  requestPermission?: (desc?: {
    mode?: "read" | "readwrite";
  }) => Promise<PermissionState>;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveInstallHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).put(handle, RECORD_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch (err) {
    log.warn({ err }, "save failed");
  }
}

export async function loadInstallHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
        req.onsuccess = () =>
          resolve((req.result as FileSystemDirectoryHandle) ?? null);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    return handle;
  } catch (err) {
    log.warn({ err }, "load failed");
    return null;
  }
}

export async function clearInstallHandle(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch (err) {
    log.warn({ err }, "clear failed");
  }
}

export async function queryHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const h = handle as unknown as HandleWithPermissions;
  if (!h.queryPermission) return "prompt";
  try {
    return await h.queryPermission({ mode: "read" });
  } catch {
    return "prompt";
  }
}

export async function requestHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const h = handle as unknown as HandleWithPermissions;
  if (!h.requestPermission) return "prompt";
  try {
    return await h.requestPermission({ mode: "read" });
  } catch {
    return "denied";
  }
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/* ── Remote install URL ──────────────────────────────────────────── */

import { isEmbedded, embeddedEndpoints } from "./embedded";

/**
 * Persisted URL for a remote install — a tree of `index.json` files
 * served via HTTP and walked by `HttpDirectory` from
 * `@emdzej/bimmerz-vfs`. Stored in localStorage (URLs are short
 * strings, no need for IndexedDB) and restored on app boot the same
 * way the FSA handle is.
 *
 * In embedded builds the URL is build-time fixed to the dongle's
 * `${origin}/data`: save+clear become no-ops (the embedded boot path
 * mounts unconditionally), and load returns the dongle endpoint so
 * the top-bar source pill's tooltip resolves without every call
 * site having to branch on `isEmbedded`.
 *
 * The session-blob equivalent for client mode (`sessionId.token`)
 * stays transient on `app.connectSessionId` — that's a credential.
 * A remote install URL is just a location pointer, safe to persist.
 */
const REMOTE_URL_KEY = "ncsx.web.install.remoteUrl";

export function saveRemoteInstallUrl(url: string): void {
  if (isEmbedded) return;
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(REMOTE_URL_KEY, url);
}

export function loadRemoteInstallUrl(): string | null {
  if (isEmbedded) return embeddedEndpoints().installHttpBase;
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(REMOTE_URL_KEY);
}

export function clearRemoteInstallUrl(): void {
  if (isEmbedded) return;
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(REMOTE_URL_KEY);
}
