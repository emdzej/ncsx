import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";

// Surface package.json version in the app UI without bundling the whole manifest. Vite's
// `define` replaces the identifier at build time, so the production bundle just contains
// the string literal (e.g. "0.0.1"). The dev server picks up changes on Vite restart.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string; dependencies?: Record<string, string> };

// Strip the leading `^` / `~` from a semver range so the About dialog shows a clean
// `0.2.7` instead of `^0.2.7`. Falls back to the raw string if the leading char isn't
// a known range marker.
function cleanSemver(range: string | undefined): string {
  if (!range) return "(unknown)";
  return range.replace(/^[\^~]/, "");
}

const ediabasxVersion = cleanSemver(pkg.dependencies?.["@emdzej/ediabasx-ediabas"]);
const inpaxVersion = cleanSemver(pkg.dependencies?.["@emdzej/inpax-interpreter"]);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __EDIABASX_VERSION__: JSON.stringify(ediabasxVersion),
    __INPAX_VERSION__: JSON.stringify(inpaxVersion),
  },
  plugins: [
    svelte(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "NCSX",
        short_name: "NCSX",
        description:
          "BMW NCS Expert coding in the browser — edit TRC/MAN files via a friendly checkbox UI over Web Serial.",
        theme_color: "#2563eb",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: {
    // 5173 is the Vite default — ediabasx-web uses it, inpax-web uses 5174.
    // ncsx-web takes 5175 so all three can dev concurrently.
    port: 5175,
  },
  // Workspace packages compile to `NodeNext` ESM. Vite's CommonJS analyser trips over a
  // few re-export shapes unless we pre-bundle them; same pattern ediabasx-web + inpax-web
  // use.
  optimizeDeps: {
    include: [
      "@emdzej/ncsx-daten",
      "@emdzej/ncsx-text-tables",
      "@emdzej/ncsx-chassis",
      "@emdzej/ncsx-function-list",
      "@emdzej/ncsx-options",
      "@emdzej/ncsx-trace",
      "@emdzej/ncsx-cabd",
      "@emdzej/ncsx-ecu-select",
      "@emdzej/ncsx-fa-asw",
      "@emdzej/ncsx-identity",
      "@emdzej/ncsx-inpax-cabi-provider",
      "@emdzej/ncsx-pfl",
      "@emdzej/ncsx-predicate",
      "@emdzej/ncsx-translations",
      // EDIABAS stack — mirror inpax-web's optimizeDeps. The `/client` subpath is the
      // browser-safe slice of @emdzej/ediabasx-interfaces (skips node:net/http/ws).
      "@emdzej/ediabasx-ediabas",
      "@emdzej/ediabasx-interface-base",
      "@emdzej/ediabasx-interface-serial",
      "@emdzej/ediabasx-interfaces/client",
      "@emdzej/inpax-core",
      "@emdzej/inpax-dispatcher",
      "@emdzej/inpax-ediabasx-provider",
      "@emdzej/inpax-interfaces",
      "@emdzej/inpax-interpreter",
      "@emdzej/inpax-parser",
      "@emdzej/inpax-providers",
      "@emdzej/inpax-ui-provider-core",
    ],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /packages\//],
      transformMixedEsModules: true,
    },
  },
});
