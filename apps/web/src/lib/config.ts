/**
 * localStorage-backed connection config. Mirrors inpax-web's
 * `apps/inpax-web/src/lib/config.ts` so the two apps stay in sync once we wire ncsx's
 * runtime through the same inpax interpreter.
 *
 * Two interfaces are practical in a browser:
 *
 *   - `webserial` drives a local USB cable directly via the Web Serial API.
 *   - `gateway`   talks to a remote `ediabasx gateway --transport websocket`
 *                 server, which in turn drives the real cable on its side.
 *
 * Simulation / raw `serial` / `kdcan` / `enet` are intentionally absent — they require
 * Node-only APIs that browsers don't expose.
 *
 * Install paths (NCSEXPER/DATEN, EDIABAS/Ecu, SGDAT) come from the user's directory
 * picker and live on `app.install` separately — they're per-install, not per-machine.
 */

import { isEmbedded, embeddedEndpoints } from "./embedded";

export type InterfaceType = "webserial" | "j2534" | "gateway";
export type SerialProtocol = "uart" | "kwp" | "isotp" | "tp20";
export type SerialInitMode = "fast" | "five-baud";

/**
 * High-level top-of-stack mode. Picks who owns the IEdiabas:
 *
 *   - `embedded` — IEdiabas lives in the browser (EmbeddedEdiabas
 *     wrapping the inner Ediabas class against a local interface).
 *     Requires a local install (EDIABAS/Ecu folder) for SGBD bytes.
 *   - `client`   — IEdiabas lives on a remote ediabasx-server. The
 *     browser holds an `EdiabasClient` (JSON-RPC) that forwards calls
 *     over WebSocket. SGBDs live on the server; the install is still
 *     needed locally for NCSEXPER/DATEN + SGDAT (chassis catalogue +
 *     A_*.ipo dispatchers — those run in-browser regardless of mode).
 *
 * `gateway` (under the `embedded` umbrella) is a third axis — local
 * IEdiabas but the wire goes over WebSocket to an ediabasx gateway
 * driving the cable. Don't confuse with `client` + `server`: in
 * `gateway` mode the EDIABAS bytecode runs locally and only the wire
 * frames are forwarded; in `client` mode the entire EDIABAS runtime
 * (SGBD loading + bytecode interpretation) is on the remote.
 */
export type ConnectionMode = "embedded" | "client";

/**
 * Client-mode connection method — direct WebSocket vs Bimmerz
 * Connect relay. Values match `@emdzej/ediabasx-web-ui`'s
 * `ClientConnectionMethod` so the shared `ServerConfigPanel` /
 * `ConnectConfigPanel` bind against `app.config` without an adapter.
 */
export type ClientConnectionMethod = "direct" | "connect";

/**
 * One of the bimmerz-logger levels. Inlined here (rather than imported
 * from `@emdzej/bimmerz-logger`) so this file stays a pure config-
 * shape definition with no library dependency — the wiring layer in
 * `main.ts` and `logger-wiring.ts` is what actually pulls in
 * bimmerz-logger.
 */
export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

export const LOG_LEVELS: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
];

/**
 * Persisted logger configuration. Mirrors `@emdzej/bimmerz-logger`'s
 * `LoggerConfig` minus the sink (the web app always uses the console
 * sink — no Node-style pino transport surface in the browser).
 *
 * Keys (category names) are dot-separated paths from `LOG_CATEGORIES`
 * exports — `@emdzej/ncsx-chassis`'s NCSX.* tree plus the bundled
 * `@emdzej/inpax-interpreter` INPAX.* tree plus
 * `@emdzej/ediabasx-ediabas` EDIABASX.* tree. The Settings dialog
 * iterates the union, so adding a category in any upstream library
 * automatically shows up here.
 */
export interface WebLoggerConfig {
  level?: LogLevel;
  categories?: Record<string, LogLevel>;
}

export interface WebConfig {
  /** Top-level mode — embedded vs client. Defaults to `embedded`. */
  mode: ConnectionMode;
  /** Client-mode submode — direct WebSocket vs Bimmerz Connect relay. */
  connectionMethod?: ClientConnectionMethod;
  /**
   * Client mode: direct WebSocket URL to an `ediabasx-server`. Used when
   * `mode === "client"` and `connectionMethod === "server"`.
   */
  serverUrl?: string;
  /**
   * Client mode: Bimmerz Connect relay URL. Defaults to
   * `wss://connect.bimmerz.app` if unset.
   *
   * The session blob (`sessionId.token`) is NOT persisted — it's
   * transient per-session and lives on `app.connectSessionId` /
   * `app.connectToken`. Mirrors inpax-web; tokens don't survive
   * reload so a stolen browser profile can't reconnect.
   */
  connectRelayUrl?: string;

  /** Embedded mode: which local EDIABAS comm interface drives the cable. */
  interface: InterfaceType;
  serial?: {
    baudRate?: number;
    dataBits?: 7 | 8;
    parity?: "none" | "even" | "odd";
    stopBits?: 1 | 2;
    protocol?: SerialProtocol;
    initMode?: SerialInitMode;
    /** Hex string for readability — parsed at use site. */
    testerCanId?: string;
    ecuCanId?: string;
    timeoutMs?: number;
    /**
     * Run the K+DCAN adapter probe on connect. Defaults to `true`. Disable when
     * working with a passthrough FTDI cable that doesn't speak the probe telegrams
     * — the probe will time out and the connection falls back, but it slows startup.
     */
    probeAdapterOnConnect?: boolean;
  };
  gateway?: {
    /**
     * Full WebSocket URL of the remote ediabasx gateway, e.g. `ws://192.168.1.50:6801`
     * or `wss://gateway.example.com/ediabasx`. CLI default is `ws://localhost:6801`.
     */
    url?: string;
  };
  /** Logger settings — applied via `configureLogger()` at boot + on Settings save. */
  logging?: WebLoggerConfig;
}

const STORAGE_KEY = "ncsx.web.config.v1";

const DEFAULT_CONFIG: WebConfig = {
  mode: "embedded",
  connectionMethod: "direct",
  serverUrl: "ws://localhost:6802",
  connectRelayUrl: "wss://connect.bimmerz.app",
  interface: "webserial",
  serial: {
    baudRate: 115200,
    dataBits: 8,
    parity: "none",
    stopBits: 1,
    // K+DCAN cable defaults — most BMW INPA users land here. KWP2000 is the K-line
    // protocol; UART is the framing the cable presents over Web Serial. The
    // interpreter speaks higher-level BEST2 opcodes that compose either depending
    // on the SGBD.
    protocol: "uart",
    initMode: "fast",
    timeoutMs: 5000,
    probeAdapterOnConnect: true,
  },
  gateway: {
    url: "ws://localhost:6801",
  },
  logging: {
    level: "info",
  },
};

/**
 * Connection fields the embedded build owns at compile/boot time —
 * the user can't change these on the dongle. Other persisted prefs
 * (theme, logging, UI) flow through the regular localStorage merge.
 *
 * `serverUrl` is derived from `window.location.origin` so the same
 * embedded artefact works regardless of which IP/host the dongle is
 * reachable at.
 */
function embeddedConnectionOverrides(): Pick<
  WebConfig,
  "mode" | "connectionMethod" | "serverUrl"
> {
  return {
    mode: "client",
    connectionMethod: "direct",
    serverUrl: embeddedEndpoints().serverWsUrl,
  };
}

export function loadConfig(): WebConfig {
  if (typeof localStorage === "undefined") {
    return isEmbedded
      ? { ...structuredClone(DEFAULT_CONFIG), ...embeddedConnectionOverrides() }
      : structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const base = !raw
      ? structuredClone(DEFAULT_CONFIG)
      : (() => {
          const parsed = JSON.parse(raw) as Partial<WebConfig>;
          /* Coerce older / unknown interface values back to the default so
             the UI doesn't show a phantom selection. */
          const iface: InterfaceType =
            parsed.interface === "webserial" ||
            parsed.interface === "j2534" ||
            parsed.interface === "gateway"
              ? parsed.interface
              : DEFAULT_CONFIG.interface;
          const mode: ConnectionMode =
            parsed.mode === "embedded" || parsed.mode === "client"
              ? parsed.mode
              : DEFAULT_CONFIG.mode;
          const connectionMethod: ClientConnectionMethod =
            parsed.connectionMethod === "direct" ||
            parsed.connectionMethod === "connect"
              ? parsed.connectionMethod
              : DEFAULT_CONFIG.connectionMethod!;
          return {
            ...structuredClone(DEFAULT_CONFIG),
            ...parsed,
            mode,
            connectionMethod,
            interface: iface,
            serial: { ...DEFAULT_CONFIG.serial, ...parsed.serial },
            gateway: { ...DEFAULT_CONFIG.gateway, ...parsed.gateway },
          };
        })();
    /* In embedded builds the connection fields are dongle-owned —
       the persisted mode/serverUrl are stale junk (dongle's IP can
       change between sessions). Override on every load; leave
       theme/logging/UI prefs intact. */
    if (isEmbedded) {
      return { ...base, ...embeddedConnectionOverrides() };
    }
    return base;
  } catch {
    return isEmbedded
      ? { ...structuredClone(DEFAULT_CONFIG), ...embeddedConnectionOverrides() }
      : structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: WebConfig): void {
  if (typeof localStorage === "undefined") return;
  /* Save the full object even in embedded mode — the connection
     fields will be re-overridden on next load, so leaving them in
     storage is harmless drift. Keeps saveConfig idempotent. */
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function resetConfig(): WebConfig {
  if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  return structuredClone(DEFAULT_CONFIG);
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

/**
 * Mixed-content blocking: when the page itself is loaded over HTTPS, browsers refuse
 * to open a plain `ws://` WebSocket. UI components surface this so the user understands
 * why "Connect" fails before clicking.
 */
export function isSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true;
}
