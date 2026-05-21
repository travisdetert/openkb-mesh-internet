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
  /** ms epoch of session start — used by the polling pump to decide
   *  how aggressively to poll fromRadio. */
  startedAt: number;
  /** Cancels the interval timer when the session closes. */
  pollTimer: ReturnType<typeof setTimeout> | null;
  /** Cumulative drain stats so log lines stay readable as traffic grows. */
  framesPulledTotal: number;
  /** Chained promise of the most recent GATT op. Chromium serializes
   *  all GATT operations per device — concurrent calls fail with "GATT
   *  operation already in progress". Every read/write chains onto this
   *  so the post-write drain, poll pump, and notification handler all
   *  share a single queue. */
  gattLock: Promise<unknown>;
  /** Set when we've started tearing down so async callbacks bail. */
  closing: boolean;
}

/**
 * Serialize a GATT operation on a session. Every read/write must go
 * through this — including the post-write drains, the poll pump's reads,
 * and the notification handler's drains. Chromium will throw "GATT
 * operation already in progress" if two run in parallel on the same
 * device.
 */
function withGatt<T>(session: BleSession, fn: () => Promise<T>): Promise<T> {
  const next = session.gattLock.then(fn, fn);
  session.gattLock = next.catch(() => { /* swallow so subsequent ops aren't poisoned */ });
  return next;
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
 *
 * `source` lets us tag the log line with what triggered the drain so we
 * can see at a glance whether responses are coming via notifications,
 * post-write probes, or the polling pump (some firmware never fires the
 * notification — polling is the only reliable signal there).
 */
async function drainFromRadio(session: BleSession, source: 'notify' | 'post-write' | 'poll' | 'initial'): Promise<number> {
  let framesPulled = 0;
  for (let i = 0; i < 64; i++) { // safety cap per drain
    if (session.closing) return framesPulled;
    let value: DataView;
    try {
      value = await withGatt(session, () => session.fromRadio.readValue());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ble] fromRadio read failed (${source}): ${msg}`);
      await window.mesh.bleError({ connId: session.connId, message: `fromRadio read failed: ${msg}` });
      return framesPulled;
    }
    if (value.byteLength === 0) {
      // Empty read = queue drained. Only log when this drain pulled
      // nothing AT ALL, so we can see "post-write drain returned empty"
      // patterns — that's the smoking gun for a wedged radio.
      if (framesPulled === 0 && source !== 'poll') {
        console.log(`[ble] ${source} drain ${session.connId}: queue empty`);
      }
      return framesPulled;
    }
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    framesPulled++;
    session.framesPulledTotal++;
    await window.mesh.bleRxFrame({ connId: session.connId, bytes: bytesToBase64(bytes) });
  }
  console.warn(`[ble] drainFromRadio hit safety cap (64 frames, ${source}) — radio may be very chatty`);
  return framesPulled;
}

/**
 * Polling pump. Some Meshtastic firmware (notably older nRF52 builds)
 * doesn't always emit a fromNum notification after processing wantConfig
 * — the response payloads are queued in fromRadio but we'd never go read
 * them if we relied on notifications alone. So we poll fromRadio on a
 * fixed cadence, aggressive for the first 15 seconds (when wantConfig
 * responses arrive) and relaxed afterwards. Reads against an empty
 * queue are cheap (one short GATT op) so the bandwidth cost is minor.
 */
function schedulePoll(session: BleSession): void {
  if (session.closing) return;
  const elapsed = Date.now() - session.startedAt;
  const intervalMs = elapsed < 15_000 ? 250 : 2_000;
  session.pollTimer = setTimeout(async () => {
    if (session.closing) return;
    const n = await drainFromRadio(session, 'poll');
    if (n > 0) console.log(`[ble] poll-drain ${session.connId}: pulled ${n} frame(s)`);
    schedulePoll(session);
  }, intervalMs);
}

/**
 * Main-side handler: write a ToRadio frame to the GATT characteristic.
 * Bound once on module init and routes by connId to the right session.
 *
 * After every successful write, we schedule two follow-up drains (at
 * 200ms and 800ms) — many firmware builds queue the response without
 * firing a fromNum notification, so a passive listener would never go
 * read it. The probes are cheap when the queue is empty and recover
 * sync when the queue is not.
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
    // writeValueWithResponse is more reliable than writeWithoutResponse —
    // it forces the radio's GATT stack to ACK the write before resolving,
    // so a silent drop surfaces as an error instead of looking successful.
    // Trade-off: ~5ms slower per write, which is negligible for handshake
    // bursts.
    await withGatt(session, () => session.toRadio.writeValueWithResponse(arr.buffer as ArrayBuffer));
    console.log(`[ble] tx → ${session.connId} ${payload.length}b`);
    setTimeout(() => { void drainFromRadio(session, 'post-write'); }, 200);
    setTimeout(() => { void drainFromRadio(session, 'post-write'); }, 800);
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
  if (session.pollTimer) { clearTimeout(session.pollTimer); session.pollTimer = null; }
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
  // Accept ALL nearby BLE devices so the chooser modal can show the
  // complete list — historically we filtered by service UUID + name
  // prefix, but some Meshtastic firmware (nRF52 in particular) only
  // includes the service UUID in the scan response (not the primary
  // advertising packet), and Chromium's services filter doesn't always
  // match scan-response data. The modal badges devices whose name looks
  // Meshtastic-ish, and the user picks which one to try. optionalServices
  // is still required so getPrimaryService(SERVICE_UUID) is reachable
  // after the GATT connection completes.
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
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
  const session: BleSession = {
    connId, device, server, fromRadio, toRadio, fromNum,
    startedAt: Date.now(),
    pollTimer: null,
    framesPulledTotal: 0,
    gattLock: Promise.resolve(),
    closing: false,
  };
  sessions.set(connId, session);

  // GATT disconnect handler — notify main so the controller can tear down.
  device.addEventListener('gattserverdisconnected', () => {
    if (session.closing) return;
    session.closing = true;
    if (session.pollTimer) { clearTimeout(session.pollTimer); session.pollTimer = null; }
    sessions.delete(connId);
    console.log(`[ble] gattserverdisconnected ${connId} (${deviceName}, ${session.framesPulledTotal} frames pulled total)`);
    void window.mesh.bleDisconnected({ connId, reason: 'gatt server disconnected' });
  });

  // Subscribe to fromNum, drain on every notification. We can't fully rely
  // on these — some firmware queues fromRadio without notifying — but when
  // they DO fire it's the fastest path.
  fromNum.addEventListener('characteristicvaluechanged', () => {
    if (session.closing) return;
    void drainFromRadio(session, 'notify').then((n) => {
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
  const initial = await drainFromRadio(session, 'initial');
  report({ phase: 'connected', deviceName, connId, framesDrained: initial });

  // Start the polling pump — runs alongside notifications so we don't
  // miss queued frames when the firmware doesn't notify.
  schedulePoll(session);

  return connId;
}
