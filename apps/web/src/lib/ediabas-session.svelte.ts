import { Ediabas, type EdiabasConfig } from '@emdzej/ediabasx-ediabas';
import {
  SerialInterface,
  WebSerialTransport,
  type WebSerialPortLike,
} from '@emdzej/ediabasx-interface-serial';
import { J2534Interface } from '@emdzej/ediabasx-interface-j2534';
import { WebSerialTransport as J2534WebSerialTransport } from '@emdzej/j2534-webserial';
import { GatewayClient } from '@emdzej/ediabasx-interfaces/client';
import { makeBrowserSgbdResolver } from './sgbd-resolver';
import { app } from './state.svelte';

/** Any transport `Ediabas` accepts — SerialInterface, J2534Interface, or GatewayClient. */
type AnyEdiabasTransport = EdiabasConfig['transport'];

/**
 * One ECU session: a connected `Ediabas` instance plus its underlying SerialInterface.
 * `disconnect()` tears the whole thing down so the next connection starts clean.
 */
export interface EdiabasSession {
  readonly ediabas: Ediabas;
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
 * Open a connection based on the user's `app.config.interface` setting:
 *
 *   - `webserial` — prompt for a Web Serial port, drive it as a
 *                   K+DCAN-style cable via SerialInterface.
 *   - `j2534`     — drive a Tactrix OpenPort 2.0 via J2534Interface
 *                   (uses Web Serial under the hood — same gesture
 *                   requirement; the port picker pops on connect).
 *   - `gateway`   — talk WebSocket to a remote ediabasx gateway.
 *
 * Sets `connection.session` on success, `connection.status = error` on
 * failure. Requires `app.install.ediabasEcu` to be set.
 */
export async function connect(): Promise<void> {
  if (!app.install?.ediabasEcu) {
    connection.status = {
      kind: 'error',
      message:
        'No EDIABAS/Ecu folder found in the install. Pick a BMW Standard Tools root that contains EDIABAS/Ecu.',
    };
    return;
  }

  connection.status = { kind: 'connecting' };

  try {
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
  const transport = new SerialInterface({
    port: 'webserial',
    baudRate: s.baudRate ?? 115200,
    dataBits: (s.dataBits ?? 8) as 7 | 8,
    parity: (s.parity ?? 'none') as 'none' | 'even' | 'odd',
    stopBits: (s.stopBits ?? 1) as 1 | 2,
    timeoutMs: s.timeoutMs ?? 5000,
    transport: new WebSerialTransport(port),
    probeAdapterOnConnect: s.probeAdapterOnConnect ?? true,
  });

  await startSession(transport as unknown as AnyEdiabasTransport, async () => {
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
  const transport = new J2534Interface({
    transport: { kind: 'instance', transport: j2534Transport },
    protocol: 'ds2',
    baudRate: 9600,
  });
  await startSession(transport as unknown as AnyEdiabasTransport, async () => {
    // J2534Interface.disconnect() closes its transport; no extra cleanup.
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
  // The remote ediabasx gateway owns the actual hardware link; we
  // just speak JSON-RPC over WebSocket to it.
  const client = new GatewayClient({ transport: 'websocket', url });
  await startSession(client as unknown as AnyEdiabasTransport, async () => {
    // GatewayClient.disconnect() handled by Ediabas.disconnect().
  }, `Gateway · ${url}`);
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

async function startSession(
  transport: AnyEdiabasTransport,
  closeTransport: () => Promise<void>,
  portInfo: string,
): Promise<void> {
  if (!app.install?.ediabasEcu) {
    throw new Error('No EDIABAS/Ecu folder found in the install.');
  }
  const ediabas = new Ediabas({
    ecuPath: '.',
    transport,
    loadSgbdResolver: makeBrowserSgbdResolver(app.install.ediabasEcu),
  });
  try {
    await ediabas.connect();
  } catch (err) {
    await closeTransport();
    throw err;
  }
  connection.session = {
    ediabas,
    disconnect: async () => {
      try {
        await ediabas.disconnect();
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
}
