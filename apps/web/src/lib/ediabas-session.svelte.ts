import { EmbeddedEdiabas, EdiabasClient } from '@emdzej/ediabasx-client';
import type { IEdiabas } from '@emdzej/ediabasx-core';
import {
  SerialInterface,
  WebSerialTransport,
  type WebSerialPortLike,
} from '@emdzej/ediabasx-interface-serial';
import { J2534Interface } from '@emdzej/ediabasx-interface-j2534';
import { WebSerialTransport as J2534WebSerialTransport } from '@emdzej/j2534-webserial';
import { GatewayClient } from '@emdzej/ediabasx-interfaces/client';
import { dial as dialConnect } from '@emdzej/swsrs-client';
import { makeBrowserSgbdResolver } from './sgbd-resolver';
import { app } from './state.svelte';

/**
 * One ECU session: a connected `IEdiabas` instance plus the teardown
 * thunk that closes whatever underlying transport / socket the
 * instance is using.
 *
 * Embedded mode wraps `EmbeddedEdiabas` (which wraps the inner
 * `Ediabas` class against a local interface — Web Serial / J2534 /
 * gateway). Client mode wraps `EdiabasClient` (JSON-RPC over
 * WebSocket — direct to a server, or via the Bimmerz Connect relay).
 * Both implement `IEdiabas`, so downstream code (cabi-provider,
 * runtime, identity readers) doesn't care which mode is active.
 */
export interface EdiabasSession {
  readonly ediabas: IEdiabas;
  disconnect(): Promise<void>;
}

export type ConnectionStatus =
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected'; portInfo: string }
  | { kind: 'error'; message: string };

interface EdiabasSessionState {
  status: ConnectionStatus;
  session: EdiabasSession | null;
}

/**
 * Top-level connection state. UI components import this directly and read
 * `connection.status` for the header pill, the Connect dialog, and the "Read from ECU"
 * gating. Mutations happen through `connect()` / `disconnect()` below.
 */
export const connection: EdiabasSessionState = $state({
  status: { kind: 'disconnected' },
  session: null,
});

/**
 * Minimal subset of `navigator.serial` matching what we actually call. Same pattern
 * inpax-web uses (lib.dom doesn't ship Web Serial types; we'd rather not add an
 * `@types/*` dep for one global).
 */
interface WebNavigatorSerial {
  requestPort(options?: {
    filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
  }): Promise<WebSerialPortLike>;
  getPorts(): Promise<WebSerialPortLike[]>;
}

function getNavigatorSerial(): WebNavigatorSerial | null {
  if (typeof navigator === 'undefined') return null;
  const serial = (navigator as unknown as { serial?: WebNavigatorSerial }).serial;
  return serial ?? null;
}

/**
 * Open a connection based on the user's `app.config.mode` + interface
 * setting:
 *
 *   - `embedded` + `webserial` — local Web Serial cable via SerialInterface.
 *   - `embedded` + `j2534`     — local Tactrix OpenPort 2.0 via J2534Interface.
 *   - `embedded` + `gateway`   — remote ediabasx gateway via WebSocket
 *                                (still embedded — we own the IEdiabas;
 *                                gateway only forwards the wire).
 *   - `client`   + `server`    — remote ediabasx-server, direct WebSocket.
 *   - `client`   + `connect`   — remote ediabasx-server via Bimmerz
 *                                Connect relay (sessionId.token from
 *                                `ediabasx serve --connect`).
 *
 * In `embedded` mode `app.install.ediabasEcu` is required (SGBD bytes
 * resolved client-side via the browser resolver). In `client` mode the
 * server owns the SGBD catalogue — no SGBD resolver needed here.
 */
export async function connect(): Promise<void> {
  /* Idempotence — the auto-connect hook's `$effect` re-runs whenever
     any reactive state it reads changes, including our own
     `connection.status.kind`. Setting `.kind = 'connecting'` below
     is itself a reactive write, so without this guard the hook would
     re-enter `connect()` before the first attempt finishes, spinning
     up N parallel WebSockets (seen: ~20 sockets to `/rpc/ediabasx`
     from a single Connect). Matches the same guard inpax's
     `connect()` uses in `apps/web/src/lib/connection.svelte.ts`. */
  if (connection.status.kind === 'connecting') return;
  if (connection.status.kind === 'connected' && connection.session) return;

  connection.status = { kind: 'connecting' };

  try {
    if (app.config.mode === 'client') {
      if (app.config.connectionMethod === 'connect') {
        await connectBimmerzConnectImpl();
      } else {
        await connectServerImpl();  /* default: direct WebSocket */
      }
      return;
    }

    /* embedded mode — local cable. ediabasEcu folder is required so
       loadSgbd can find the bytes. */
    if (!app.install?.ediabasEcu) {
      throw new Error(
        'No EDIABAS/Ecu folder found in the install. Pick a BMW Standard Tools root that contains EDIABAS/Ecu.',
      );
    }

    if (app.config.interface === 'webserial') {
      await connectWebSerialImpl();
    } else if (app.config.interface === 'j2534') {
      await connectJ2534Impl();
    } else if (app.config.interface === 'gateway') {
      await connectGatewayImpl();
    } else {
      throw new Error(`Interface "${String(app.config.interface)}" not supported in the web app`);
    }
  } catch (err) {
    connection.status = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function connectWebSerialImpl(): Promise<void> {
  const serial = getNavigatorSerial();
  if (!serial) {
    throw new Error('Web Serial unavailable — use Chrome / Edge / Opera over HTTPS or localhost.');
  }

  let port: WebSerialPortLike;
  try {
    port = await serial.requestPort();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      // User cancelled — soft no-op, not an error.
      connection.status = { kind: 'disconnected' };
      return;
    }
    throw err;
  }

  // Pull serial params from the persisted config so Settings changes
  // survive reloads. Defaults match the K+DCAN-cable consensus that
  // inpax-web ships.
  const s = app.config.serial ?? {};
  const iface = new SerialInterface({
    port: 'webserial',
    baudRate: s.baudRate ?? 115200,
    dataBits: (s.dataBits ?? 8) as 7 | 8,
    parity: (s.parity ?? 'none') as 'none' | 'even' | 'odd',
    stopBits: (s.stopBits ?? 1) as 1 | 2,
    timeoutMs: s.timeoutMs ?? 5000,
    transport: new WebSerialTransport(port),
    probeAdapterOnConnect: s.probeAdapterOnConnect ?? true,
  });

  await startEmbeddedSession(iface, async () => {
    try {
      await (port as unknown as { close?: () => Promise<void> }).close?.();
    } catch {
      /* swallow */
    }
  }, portLabelFromWebSerial(port));
}

async function connectJ2534Impl(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) {
    throw new Error('Web Serial API not available — needs Chrome / Edge / Opera on desktop');
  }
  // J2534 via Tactrix OpenPort 2.0. The j2534-webserial transport pops
  // the Web Serial port picker inside its own `open()` (still inside
  // the user's Connect gesture). DS2 @ 9600 is the seed; the SGBD's
  // INITIALISIERUNG reconfigures via setCommParameter.
  const j2534Transport = new J2534WebSerialTransport();
  const iface = new J2534Interface({
    transport: { kind: 'instance', transport: j2534Transport },
    protocol: 'ds2',
    baudRate: 9600,
  });
  await startEmbeddedSession(iface, async () => {
    /* J2534Interface.disconnect() (via Ediabas.end()) closes its
       transport; no extra cleanup. */
  }, 'J2534 (OpenPort 2.0)');
}

async function connectGatewayImpl(): Promise<void> {
  const url = app.config.gateway?.url?.trim();
  if (!url) {
    throw new Error('Gateway URL is empty — set ws://host:port in Settings');
  }
  if (!/^wss?:\/\//i.test(url)) {
    throw new Error('Gateway URL must start with ws:// or wss://');
  }
  /* The remote ediabasx gateway owns the actual hardware link; we
     just speak the EDIABAS protocol over WebSocket to it. Treated as
     an "interface" from EmbeddedEdiabas's point of view — the
     IEdiabas itself runs locally and the gateway only forwards the
     wire. (Distinct from client mode below, where the IEdiabas
     itself lives on the remote.) */
  const iface = new GatewayClient({ transport: 'websocket', url });
  await startEmbeddedSession(iface, async () => {
    /* GatewayClient.disconnect() handled by Ediabas.end(). */
  }, `Gateway · ${url}`);
}

async function connectServerImpl(): Promise<void> {
  const url = app.config.serverUrl?.trim();
  if (!url) {
    throw new Error('Server URL is empty — set ws://host:port in Settings');
  }
  if (!/^wss?:\/\//i.test(url)) {
    throw new Error('Server URL must start with ws:// or wss://');
  }
  /* Direct WebSocket to an ediabasx-server. The server owns the
     cable + SGBDs; we just speak JSON-RPC to it. */
  const client = new EdiabasClient({ transport: 'websocket', url });
  try {
    await client.init();
  } catch (err) {
    /* Make sure the socket is torn down before bubbling the error
       so a re-Connect doesn't hit a stale half-open connection. */
    try {
      await client.end();
    } catch { /* swallow */ }
    throw err;
  }
  connection.session = {
    ediabas: client,
    disconnect: async () => {
      try {
        await client.end();
      } catch { /* swallow */ }
    },
  };
  connection.status = { kind: 'connected', portInfo: `Server · ${url}` };
}

async function connectBimmerzConnectImpl(): Promise<void> {
  const sessionId = app.connectSessionId?.trim() ?? '';
  const token = app.connectToken?.trim() ?? '';
  if (!sessionId || !token) {
    /* No token paste yet — pop the dialog and bail. The dialog
       calls back into connect() once the user submits, at which
       point we hit the dial path below. */
    connection.status = { kind: 'disconnected' };
    app.showConnectSession = true;
    return;
  }
  const relayUrl = app.config.connectRelayUrl?.trim() || 'wss://connect.bimmerz.app';
  /* Dial the relay, get a tunnelled WebSocket, hand it to
     EdiabasClient. The relay forwards bytes between the dialing
     client (us) and the host that called `ediabasx serve --connect`. */
  const peer = await dialConnect({ relayURL: relayUrl, sessionId, token });
  const client = new EdiabasClient({ transport: 'websocket', socket: peer.socket });
  try {
    await client.init();
  } catch (err) {
    try {
      await client.end();
    } catch { /* swallow */ }
    throw err;
  }
  connection.session = {
    ediabas: client,
    disconnect: async () => {
      try {
        await client.end();
      } catch { /* swallow */ }
    },
  };
  connection.status = {
    kind: 'connected',
    portInfo: `Bimmerz Connect · ${relayUrl}`,
  };
}

function portLabelFromWebSerial(port: WebSerialPortLike): string {
  // `getInfo()` is part of the real Web Serial spec but isn't on
  // WebSerialPortLike's minimal contract — cast to read it best-effort.
  const info =
    (port as unknown as { getInfo?: () => { usbVendorId?: number; usbProductId?: number } }).getInfo?.() ?? {};
  return info.usbVendorId !== undefined
    ? `USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`
    : 'Serial port';
}

/**
 * Build an `EmbeddedEdiabas` over the supplied interface and stash it
 * on `connection.session`. The IEdiabas owns SGBD loading + IDENT
 * bootstrap + the run-loop; we just wire the EDIABAS/Ecu resolver to
 * read SGBD bytes out of the user-picked install folder.
 */
async function startEmbeddedSession(
  iface: ConstructorParameters<typeof EmbeddedEdiabas>[0]['interface'],
  closeTransport: () => Promise<void>,
  portInfo: string,
): Promise<void> {
  if (!app.install?.ediabasEcu) {
    throw new Error('No EDIABAS/Ecu folder found in the install.');
  }
  const ediabas = new EmbeddedEdiabas({
    sgbdPath: '.',
    interface: iface,
    loadSgbdResolver: makeBrowserSgbdResolver(app.install.ediabasEcu),
  });
  try {
    await ediabas.init();
  } catch (err) {
    await closeTransport();
    throw err;
  }
  connection.session = {
    ediabas,
    disconnect: async () => {
      try {
        await ediabas.end();
      } catch {
        /* swallow — best-effort */
      }
      await closeTransport();
    },
  };
  connection.status = { kind: 'connected', portInfo };
}

/** Tear down the current session, if any. Idempotent. */
export async function disconnect(): Promise<void> {
  if (connection.session) {
    await connection.session.disconnect();
  }
  connection.session = null;
  connection.status = { kind: 'disconnected' };
  /* Clear the transient Bimmerz Connect session — the relay host
     prints a fresh `sessionId.token` per session, so a stale token
     in memory would just fail to dial next time. Forces the user
     through the dialog again, which is the safe default. */
  app.connectSessionId = null;
  app.connectToken = null;
}
