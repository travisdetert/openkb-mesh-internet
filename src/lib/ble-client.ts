// Renderer-side Bluetooth client for Meshtastic radios.
//
// Uses Chromium's WebBluetooth (no native bindings, rides on the OS BLE stack).
// Each session ties one BLE device to one connId in main. The renderer:
//   - calls requestDevice() from a user gesture
//   - connects to GATT, grabs the three Meshtastic characteristics
//   - subscribes to fromNum notifications and, on each notify, drains fromRadio
//     by repeated reads until the read returns empty
//   - writes each toRadio frame (one protobuf ToRadio per write) when main
//     asks via the bleTxFrame event
//   - reports gattserverdisconnected + read/write errors back to main
//
// Meshtastic GATT service spec:
//   service:   6ba1b218-15a8-461f-9fa8-5dcae273eafd
//   fromRadio: 2c55e69e-4993-11ed-b878-0242ac120002 (read)
//   toRadio:   f75c76d2-129e-4dad-a1dd-7866124401e7 (write)
//   fromNum:   ed9da18c-a800-4f66-a670-aa7547e34453 (notify)

const SERVICE_UUID    = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
const FROM_RADIO_UUID = '2c55e69e-4993-11ed-b878-0242ac120002';
const TO_RADIO_UUID   = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
const FROM_NUM_UUID   = 'ed9da18c-a800-4f66-a670-aa7547e34453';

/**
 * Progress events emitted during BLE setup. The UI uses these to show a
 * "what step are we on" line so the user isn't staring at a spinner.
 * They're also console.log'd so /tmp/openkb-mesh-internet.log captures
 * the full timeline of every pairing attempt.
 */
export type BleProgressPhase =
  | 'requesting-device'    // chooser open / scanning
  | 'device-picked'         // a device responded and was chosen
  | 'gatt-connecting'       // opening GATT
  | 'service-discovery'     // fetching the Meshtastic service
  | 'characteristics'       // grabbing fromRadio/toRadio/fromNum
  | 'subscribing'           // enabling notifications on fromNum
  | 'session-registered'    // told main to spin up a controller
  | 'draining-initial'      // pulling the first batch of FromRadio frames
  | 'connected'             // happy state — handshake will proceed in main
  | 'failed';

export interface BleProgress {
  phase: BleProgressPhase;
  deviceName?: string;
  connId?: string;
  framesDrained?: number;
  error?: string;
}

function log(phase: BleProgressPhase, extra?: object): void {
  // Tag every line so it's easy to grep /tmp/openkb-mesh-internet.log.
  const detail = extra ? ' ' + JSON.stringify(extra) : '';
  console.log(`[ble] ${phase}${detail}`);
}

interface BleSession {
  connId: string;
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  fromRadio: BluetoothRemoteGATTCharacteristic;
  toRadio: BluetoothRemoteGATTCharacteristic;
  fromNum: BluetoothRemoteGATTCharacteristic;
  /** Set when we've started tearing down so async callbacks bail. */
  closing: boolean;
}

const sessions = new Map<string, BleSession>(); // connId → session
let txFrameUnsubscribe: (() => void) | null = null;
let disconnectReqUnsubscribe: (() => void) | null = null;

function bytesToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Drain fromRadio repeatedly until the radio returns an empty buffer.
 * Each non-empty read = one FromRadio protobuf message which we hand off
 * to main for decoding. The radio queues these and we have to pull them
 * one at a time — there's no "give me everything" GATT primitive.
 */
async function drainFromRadio(session: BleSession): Promise<number> {
  let framesPulled = 0;
  for (let i = 0; i < 64; i++) { // safety cap per drain
    if (session.closing) return framesPulled;
    let value: DataView;
    try {
      value = await session.fromRadio.readValue();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ble] fromRadio read failed: ${msg}`);
      await window.mesh.bleError({ connId: session.connId, message: `fromRadio read failed: ${msg}` });
      return framesPulled;
    }
    if (value.byteLength === 0) return framesPulled; // queue empty
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    framesPulled++;
    await window.mesh.bleRxFrame({ connId: session.connId, bytes: bytesToBase64(bytes) });
  }
  console.warn(`[ble] drainFromRadio hit safety cap (64 frames) — radio may be very chatty`);
  return framesPulled;
}

/**
 * Main-side handler: write a ToRadio frame to the GATT characteristic.
 * Bound once on module init and routes by connId to the right session.
 */
async function handleTxFrame(p: { connId: string; bytes: string }): Promise<void> {
  const session = sessions.get(p.connId);
  if (!session) {
    console.warn(`[ble] tx frame for unknown session ${p.connId} (dropped)`);
    return; // session ended on our side
  }
  const payload = base64ToBytes(p.bytes);
  try {
    // .buffer can be a SharedArrayBuffer in some TS lib configs; copy into a
    // plain Uint8Array to make the BufferSource type happy.
    const arr = new Uint8Array(payload);
    await session.toRadio.writeValueWithoutResponse(arr.buffer as ArrayBuffer);
    console.log(`[ble] tx → ${session.connId} ${payload.length}b`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ble] toRadio write failed for ${session.connId}: ${msg}`);
    await window.mesh.bleError({ connId: p.connId, message: `toRadio write failed: ${msg}` });
  }
}

async function handleDisconnectRequest(p: { connId: string }): Promise<void> {
  const session = sessions.get(p.connId);
  if (!session) return;
  await closeSession(session);
}

async function closeSession(session: BleSession): Promise<void> {
  if (session.closing) return;
  session.closing = true;
  try { await session.fromNum.stopNotifications(); } catch { /* ignore */ }
  try { session.server.disconnect(); } catch { /* ignore */ }
  sessions.delete(session.connId);
}

/**
 * Initialize the renderer's BLE bridge. Subscribes to main's tx-frame and
 * disconnect-request events. Idempotent — call once at app start.
 */
export function initBleBridge(): void {
  if (txFrameUnsubscribe) return; // already initialized
  txFrameUnsubscribe = window.mesh.onBleTxFrame((p) => { void handleTxFrame(p); });
  disconnectReqUnsubscribe = window.mesh.onBleDisconnectRequest((p) => { void handleDisconnectRequest(p); });
}

/**
 * User-gesture entry point. Pops the OS Bluetooth chooser, lets the user
 * pick a Meshtastic radio, then drives the GATT connection. Returns the
 * connId once the session is registered with main.
 *
 * Throws if WebBluetooth is unavailable, the user cancels the chooser, the
 * GATT connection fails, or the device doesn't expose the Meshtastic
 * service. Caller is expected to surface these as user-facing errors.
 *
 * Pass `onProgress` to receive structured phase updates so the UI can show
 * "what step are we on" instead of a blank spinner. Every phase is also
 * console.log'd so the log file captures the full timeline.
 */
export async function connectBluetoothDevice(onProgress?: (p: BleProgress) => void): Promise<string> {
  const report = (p: BleProgress) => { onProgress?.(p); log(p.phase, p); };

  if (!('bluetooth' in navigator)) {
    const err = 'WebBluetooth is not available in this build. macOS/Windows/Linux should support it, but the OS may have Bluetooth disabled.';
    report({ phase: 'failed', error: err });
    throw new Error(err);
  }

  report({ phase: 'requesting-device' });
  // Match on EITHER the Meshtastic service UUID OR the default device-name
  // prefix. Some firmware (nRF52 especially) fits the service UUID into the
  // scan response instead of the main advertising packet, and Chromium's
  // services-filter doesn't always match scan-response data — so we also
  // accept any device whose advertised name starts with "Meshtastic" as a
  // fallback. optionalServices makes the GATT service reachable after
  // connecting via the name-prefix path.
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [SERVICE_UUID] },
        { namePrefix: 'Meshtastic' },
      ],
      optionalServices: [SERVICE_UUID],
    });
  } catch (err) {
    // requestDevice rejects with NotFoundError on cancel — propagate so
    // the UI can swallow that case without surfacing it as an error.
    const msg = err instanceof Error ? err.message : String(err);
    report({ phase: 'failed', error: msg });
    throw err;
  }
  if (!device.gatt) {
    const err = 'Selected device has no GATT server';
    report({ phase: 'failed', error: err });
    throw new Error(err);
  }
  const deviceName = device.name || device.id || 'BLE radio';
  report({ phase: 'device-picked', deviceName });

  report({ phase: 'gatt-connecting', deviceName });
  let server: BluetoothRemoteGATTServer;
  try {
    server = await device.gatt.connect();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report({ phase: 'failed', deviceName, error: `GATT connect failed: ${msg}` });
    throw new Error(`GATT connect failed: ${msg}`);
  }

  report({ phase: 'service-discovery', deviceName });
  let service: BluetoothRemoteGATTService;
  try {
    service = await server.getPrimaryService(SERVICE_UUID);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report({ phase: 'failed', deviceName, error: `Meshtastic service not found: ${msg}` });
    try { server.disconnect(); } catch { /* ignore */ }
    throw new Error(`Meshtastic service not found on this device: ${msg}`);
  }

  report({ phase: 'characteristics', deviceName });
  let fromRadio: BluetoothRemoteGATTCharacteristic;
  let toRadio: BluetoothRemoteGATTCharacteristic;
  let fromNum: BluetoothRemoteGATTCharacteristic;
  try {
    [fromRadio, toRadio, fromNum] = await Promise.all([
      service.getCharacteristic(FROM_RADIO_UUID),
      service.getCharacteristic(TO_RADIO_UUID),
      service.getCharacteristic(FROM_NUM_UUID),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report({ phase: 'failed', deviceName, error: `Characteristics missing: ${msg}` });
    try { server.disconnect(); } catch { /* ignore */ }
    throw new Error(`Required Meshtastic characteristics missing: ${msg}`);
  }

  const connId = await window.mesh.bleStartSession(deviceName);
  report({ phase: 'session-registered', deviceName, connId });
  const session: BleSession = { connId, device, server, fromRadio, toRadio, fromNum, closing: false };
  sessions.set(connId, session);

  // GATT disconnect handler — notify main so the controller can tear down.
  device.addEventListener('gattserverdisconnected', () => {
    if (session.closing) return;
    session.closing = true;
    sessions.delete(connId);
    console.log(`[ble] gattserverdisconnected ${connId} (${deviceName})`);
    void window.mesh.bleDisconnected({ connId, reason: 'gatt server disconnected' });
  });

  // Subscribe to fromNum, drain on every notification. The radio also fires
  // an initial notification once notifications are enabled, so we'll catch
  // any already-queued FromRadio frames without needing a separate trigger.
  fromNum.addEventListener('characteristicvaluechanged', () => {
    if (session.closing) return;
    void drainFromRadio(session).then((n) => {
      if (n > 0) console.log(`[ble] notify→drain ${connId} pulled ${n} frame${n === 1 ? '' : 's'}`);
    });
  });
  report({ phase: 'subscribing', deviceName, connId });
  try {
    await fromNum.startNotifications();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report({ phase: 'failed', deviceName, connId, error: `startNotifications failed: ${msg}` });
    try { server.disconnect(); } catch { /* ignore */ }
    throw new Error(`Could not subscribe to fromNum: ${msg}`);
  }

  report({ phase: 'draining-initial', deviceName, connId });
  const initial = await drainFromRadio(session);
  report({ phase: 'connected', deviceName, connId, framesDrained: initial });

  return connId;
}
