import "./app.css";
import App from "./App.svelte";
import { mount } from "svelte";
import { registerSW } from "virtual:pwa-register";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Missing #app mount point");
}

mount(App, { target });

// Register the service worker. `autoUpdate` mode: new builds activate after the next
// reload — no user-facing prompt needed.
registerSW({
  onRegisteredSW(swUrl) {
    if (typeof console !== "undefined") {
      console.info(`[pwa] service worker registered at ${swUrl}`);
    }
  },
  onOfflineReady() {
    if (typeof console !== "undefined") {
      console.info("[pwa] offline-ready");
    }
  },
});
