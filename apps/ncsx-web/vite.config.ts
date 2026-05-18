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
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
      "@emdzej/ncsx-coder",
      "@emdzej/ncsx-ecu-select",
      "@emdzej/ncsx-fa-asw",
      "@emdzej/ncsx-pfl",
      "@emdzej/ncsx-predicate",
      "@emdzej/ncsx-translations",
    ],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /packages\//],
      transformMixedEsModules: true,
    },
  },
});
