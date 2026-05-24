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

export type InterfaceType = "webserial" | "gateway";
export type SerialProtocol = "uart" | "kwp" | "isotp" | "tp20";
export type SerialInitMode = "fast" | "five-baud";

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

export function loadConfig(): WebConfig {
  if (typeof localStorage === "undefined") return structuredClone(DEFAULT_CONFIG);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw) as Partial<WebConfig>;
    // Coerce older / unknown interface values back to the default so the UI doesn't
    // show a phantom selection.
    const iface: InterfaceType =
      parsed.interface === "webserial" || parsed.interface === "gateway"
        ? parsed.interface
        : DEFAULT_CONFIG.interface;
    return {
      ...structuredClone(DEFAULT_CONFIG),
      ...parsed,
      interface: iface,
      serial: { ...DEFAULT_CONFIG.serial, ...parsed.serial },
      gateway: { ...DEFAULT_CONFIG.gateway, ...parsed.gateway },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: WebConfig): void {
  if (typeof localStorage === "undefined") return;
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
