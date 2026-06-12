/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;
declare const __EDIABASX_VERSION__: string;
declare const __INPAX_VERSION__: string;
/**
 * `true` when the SPA was built with `vite --mode embedded` (the
 * dongle scenario — SPA served at `/ncsx/`, talks back to the same
 * origin for IEdiabas + install VFS). `false` for the regular
 * browser build. Vite's `define` replaces this at build time so
 * dead code under `if (!__EMBEDDED__)` tree-shakes out.
 */
declare const __EMBEDDED__: boolean;
