import "./app.css";
import App from "./App.svelte";
import { mount } from "svelte";
import { getLogger } from "@emdzej/bimmerz-logger";
import { loadConfig } from "./lib/config";
import { applyLoggerConfig } from "./lib/logger-wiring";
import { isEmbedded } from "./lib/embedded";

// Apply the persisted bimmerz-logger config before mount so component-
// init log calls land at the user's chosen level / categories. The
// Settings dialog re-applies on change — handles are proxies, so
// existing logger handles pick up new config instantly on the next
// emit, no component refresh needed.
applyLoggerConfig(loadConfig().logging);

const log = getLogger("NCSX.web.pwa");

const target = document.getElementById("app");
if (!target) {
  throw new Error("Missing #app mount point");
}

mount(App, { target });

// Register the service worker. `autoUpdate` mode: new builds activate after the next
// reload — no user-facing prompt needed.
//
// Skipped in the embedded build — vite.config.ts drops the PWA plugin
// entirely there, so `virtual:pwa-register` doesn't resolve. The
// dynamic import gated by `!isEmbedded` (compile-time constant)
// tree-shakes out of the embedded bundle.
if (!isEmbedded) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({
      onRegisteredSW(swUrl) {
        log.info({ swUrl }, "service worker registered");
      },
      onOfflineReady() {
        log.info("offline-ready");
      },
    });
  });
}
