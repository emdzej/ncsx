/**
 * Filesystem abstraction. The chassis loader speaks only through this interface so it can
 * run against a real DATEN tree, an in-memory test fixture, or (later) a browser-side
 * HTTP-backed shim — without any code changes.
 *
 * Paths are expected to be **relative to the source's root**. The source is responsible for
 * joining them with whatever absolute prefix it tracks internally. Path separators in the
 * NCSEXPER world are Windows-style backslashes (e.g. `e46\\E46DST.000`); the node adapter
 * normalises them to POSIX before passing to `fs/promises`.
 */
export interface ChassisSource {
  /** Read a file's bytes. Should reject on ENOENT (callers decide whether that's fatal). */
  read(path: string): Promise<Uint8Array>;
  /** Cheap existence probe. */
  exists(path: string): Promise<boolean>;
  /** Best-effort directory listing (used by the lazy CABD loader to find `*.Cxx`). */
  list(dir: string): Promise<string[]>;
}
