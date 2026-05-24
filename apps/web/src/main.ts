import "./app.css";
import App from "./App.svelte";
import { mount } from "svelte";
import { registerSW } from "virtual:pwa-register";
import { getLogger } from "@emdzej/bimmerz-logger";
import { loadConfig } from "./lib/config";
import { applyLoggerConfig } from "./lib/logger-wiring";

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
registerSW({
  onRegisteredSW(swUrl) {
    log.info({ swUrl }, "service worker registered");
  },
  onOfflineReady() {
    log.info("offline-ready");
  },
});
