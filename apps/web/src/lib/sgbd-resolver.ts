/**
 * Loader function for `@emdzej/ediabasx-ediabas`'s `loadSgbdResolver`
 * config slot. Given an SGBD short name (`KMBI_E60`, `KOMBI46R`, …),
 * returns the bytes + resolved filename of the matching `.prg` or
 * `.grp` file from the user-picked EDIABAS/Ecu directory.
 *
 * Backed by `@emdzej/bimmerz-vfs`'s `VirtualDirectory` so the same
 * resolver works for local FSA picks, OPFS bundle imports, and
 * remote `bimmerz data index`-served installs without branching at
 * the call site.
 *
 * Case-insensitive at every step — `dir.file(name)` is documented
 * as case-insensitive on the VFS contract, and we probe both
 * `.prg` and `.grp` extensions when the caller passes a bare name.
 * Mirrors the inpax-web-provider's `makeBrowserSgbdResolver` —
 * re-inlined here so we don't pull the full Svelte-source UI
 * provider package for a small file lookup.
 */
import type { VirtualDirectory } from "@emdzej/bimmerz-vfs";

export function makeBrowserSgbdResolver(
  ecuDir: VirtualDirectory,
): (filename: string) => Promise<{ bytes: Uint8Array; name: string }> {
  return async (filename) => {
    /* Ediabas may pass either `KMBI_E60` or `KMBI_E60.prg`/.grp.
       Accept both. If there's no extension, probe `.prg` first
       (the common case — a regular variant), then `.grp` (the
       group file that triggers IDENT + swap). */
    const lower = filename.toLowerCase();
    const candidates: string[] = [];
    if (lower.endsWith(".prg") || lower.endsWith(".grp")) {
      candidates.push(filename);
      /* Also try the swapped extension — some BMW SGBDs reference
         a variant by its `.prg` name when an explicit `.grp` would
         also resolve. Native EDIABAS does the same swap on
         `ResolveSgbdFile`. */
      candidates.push(
        lower.endsWith(".prg")
          ? `${filename.slice(0, -4)}.grp`
          : `${filename.slice(0, -4)}.prg`,
      );
    } else {
      candidates.push(`${filename}.prg`, `${filename}.grp`);
    }
    for (const candidate of candidates) {
      const file = await ecuDir.file(candidate);
      if (!file) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      /* Preserve the on-disk filename (in case of casing
         differences) so `prgPath` / `VARIANTE` seeding stays
         consistent with what the user's install actually
         contains. The VirtualFile's `name` reflects the
         underlying entry. */
      return { bytes, name: file.name };
    }
    throw new Error(`SGBD not found in EDIABAS/Ecu: ${filename}`);
  };
}
