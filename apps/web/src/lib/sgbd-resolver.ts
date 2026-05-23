/**
 * Loader function for `@emdzej/ediabasx-ediabas`'s `loadSgbdResolver` config slot. Given
 * an SGBD short name (`KMBI_E60`, `KOMBI46R`, …), returns the bytes + resolved filename
 * of the matching `.prg` or `.grp` file from the user-picked EDIABAS/Ecu directory.
 *
 * Mirrors `makeBrowserSgbdResolver` from `@emdzej/inpax-web-provider`. Re-inlined here
 * so we don't pull the full Svelte-source UI provider package for a 30-line file lookup.
 *
 * Case-insensitive, tolerates real-world rsync'd installs where Windows-cased filenames
 * get mangled.
 */
export function makeBrowserSgbdResolver(
  ecuDir: FileSystemDirectoryHandle,
): (filename: string) => Promise<{ bytes: Uint8Array; name: string }> {
  return async (filename) => {
    // Ediabas may pass either `KMBI_E60` or `KMBI_E60.prg` depending on context — accept
    // both. If there's no extension, try `.prg` then `.grp`.
    const lower = filename.toLowerCase();
    const targets = new Set<string>();
    if (lower.endsWith('.prg') || lower.endsWith('.grp')) {
      targets.add(lower);
    } else {
      targets.add(`${lower}.prg`);
      targets.add(`${lower}.grp`);
    }
    for await (const [entryName, entry] of ecuDir.entries()) {
      if (entry.kind !== 'file') continue;
      if (!targets.has(entryName.toLowerCase())) continue;
      const file = await (entry as FileSystemFileHandle).getFile();
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: entryName,
      };
    }
    throw new Error(`SGBD not found in EDIABAS/Ecu: ${filename}`);
  };
}
