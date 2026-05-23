import { Ediabas } from '@emdzej/ediabasx-ediabas';
import {
  SerialInterface,
  WebSerialTransport,
  type WebSerialPortLike,
} from '@emdzej/ediabasx-interface-serial';
import { makeBrowserSgbdResolver } from './sgbd-resolver';
import { app } from './state.svelte';

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
 * gating. Mutations happen through `connectWebSerial()` / `disconnect()` below.
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
 * Prompt the user for a Web Serial port, set up the `Ediabas` stack against it, and
 * stash the resulting session on `connection.session`. Bails with an error status if the
 * user cancels the port picker or the cable doesn't probe.
 *
 * Requires `app.install.ediabasEcu` to be available (the SGBD-resolver root).
 */
export async function connectWebSerial(): Promise<void> {
  if (!app.install?.ediabasEcu) {
    connection.status = {
      kind: 'error',
      message:
        'No EDIABAS/Ecu folder found in the install. Pick a BMW Standard Tools root that contains EDIABAS/Ecu.',
    };
    return;
  }
  const serial = getNavigatorSerial();
  if (!serial) {
    connection.status = {
      kind: 'error',
      message: 'Web Serial unavailable — use Chrome / Edge / Opera over HTTPS or localhost.',
    };
    return;
  }

  connection.status = { kind: 'connecting' };
  let port: WebSerialPortLike | undefined;
  try {
    port = await serial.requestPort();
  } catch (err) {
    // User cancelled — treat as a soft no-op, not a permanent error.
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      connection.status = { kind: 'disconnected' };
      return;
    }
    connection.status = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }
  if (!port) {
    connection.status = { kind: 'disconnected' };
    return;
  }

  try {
    // Pull serial params from the persisted config so Settings changes survive
    // reloads. Defaults match the K+DCAN-cable consensus that inpax-web ships.
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
    const ediabas = new Ediabas({
      ecuPath: '.',
      transport,
      loadSgbdResolver: makeBrowserSgbdResolver(app.install.ediabasEcu),
    });
    await ediabas.connect();

    // `getInfo()` is part of the real Web Serial spec but isn't on WebSerialPortLike's
    // minimal contract — cast to read it best-effort for the connected-status label.
    const info =
      (port as unknown as { getInfo?: () => { usbVendorId?: number; usbProductId?: number } }).getInfo?.() ?? {};
    const portLabel =
      info.usbVendorId !== undefined
        ? `USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`
        : 'Serial port';

    const portRef = port;
    connection.session = {
      ediabas,
      disconnect: async () => {
        try {
          await ediabas.disconnect();
        } catch {
          /* swallow — best-effort */
        }
        try {
          await (portRef as unknown as { close?: () => Promise<void> }).close?.();
        } catch {
          /* swallow */
        }
      },
    };
    connection.status = { kind: 'connected', portInfo: portLabel };
  } catch (err) {
    try {
      await (port as unknown as { close?: () => Promise<void> }).close?.();
    } catch {
      /* swallow */
    }
    connection.status = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Tear down the current session, if any. Idempotent. */
export async function disconnect(): Promise<void> {
  if (connection.session) {
    await connection.session.disconnect();
  }
  connection.session = null;
  connection.status = { kind: 'disconnected' };
}
