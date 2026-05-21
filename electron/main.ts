import { app, BrowserWindow, ipcMain, session, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import { MeshManager } from './meshtastic/manager';
import { MeshDatabase } from './database';
import { initCodec } from './meshtastic/protobuf-codec';

// Tee main process stdout/stderr (and the forwarded renderer console below)
// to a fixed log file so debugging doesn't require opening DevTools. The
// renderer console-message forwarder writes through console.log → stdout,
// so all three streams land in this one file. `tail -f` to watch live.
const LOG_PATH = '/tmp/openkb-mesh-internet.log';
try {
  const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: any, ...args: any[]) => {
    try { logStream.write(chunk); } catch { /* file gone, ignore */ }
    return origStdout(chunk, ...args);
  }) as any;
  process.stderr.write = ((chunk: any, ...args: any[]) => {
    try { logStream.write(chunk); } catch { /* file gone, ignore */ }
    return origStderr(chunk, ...args);
  }) as any;
  console.log(`[main] log tee → ${LOG_PATH} pid=${process.pid}`);
} catch (e) {
  console.warn(`[main] could not open log file ${LOG_PATH}:`, e);
}

process.on('uncaughtException', (err) => {
  if (err.message.includes('EPIPE') || err.message.includes('write after end')) return;
  console.error('Uncaught exception:', err);
});

let mainWindow: BrowserWindow | null = null;
let manager: MeshManager;
let db: MeshDatabase;

// Active BLE chooser. Chromium's select-bluetooth-device event fires
// repeatedly during a scan with a growing deviceList; we cache the
// most-recent callback so the renderer (or a timeout) can resolve it
// later when the user actually picks. Lives at module scope so the IPC
// handlers in app.whenReady can resolve it.
type BleScanEntry = { deviceId: string; deviceName: string; alreadyOnUsb: boolean };
let bleScan: {
  callback: (deviceId: string) => void;
  latestDevices: BleScanEntry[];
  timeoutId: NodeJS.Timeout | null;
  startedAt: number;
} | null = null;
const BLE_SCAN_TIMEOUT_MS = 60_000;

function endBleScan(deviceId: string, reason: 'picked' | 'cancelled' | 'timeout') {
  if (!bleScan) return;
  if (bleScan.timeoutId) clearTimeout(bleScan.timeoutId);
  const cb = bleScan.callback;
  bleScan = null;
  try { cb(deviceId); }
  catch (e) { console.warn('[ble] scan callback threw:', e); }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mesh:bleScanEnded', { reason, deviceId });
  }
  console.log(`[ble] scan ended: ${reason}${deviceId ? ` (deviceId=${deviceId})` : ''}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
    mainWindow?.focus();
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }
  });

  // Forward renderer console messages to the main process stdout so we can
  // tail /tmp/electron.log and see [voice], [main], and serial-write lines
  // in one stream. Level 0=verbose, 1=info, 2=warning, 3=error.
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = level === 3 ? '[renderer error]' : level === 2 ? '[renderer warn]' : '[renderer]';
    console.log(`${tag} ${message}`);
  });

  // WebBluetooth in Electron has no built-in chooser UI — we MUST register
  // this listener and pick a deviceId ourselves or `requestDevice()` hangs
  // until the renderer's promise times out with nothing visible. Strategy:
  // forward the live deviceList to the renderer (BleScanModal renders it),
  // and wait for the user to pick via the bleScanPick IPC handler. A 60s
  // hard timeout protects against scans that never resolve.
  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    const usbNames = new Set(manager?.usbConnectedIdentities() ?? []);
    const annotated: BleScanEntry[] = deviceList.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName || '',
      alreadyOnUsb: usbNames.has(d.deviceName || ''),
    }));

    if (!bleScan) {
      bleScan = { callback, latestDevices: annotated, timeoutId: null, startedAt: Date.now() };
      bleScan.timeoutId = setTimeout(() => endBleScan('', 'timeout'), BLE_SCAN_TIMEOUT_MS);
      console.log('[ble] scan started');
    } else {
      // Chromium re-fires this event as the scan grows. The latest callback
      // is what we should resolve when the user finally picks — older ones
      // become no-ops as soon as a more recent fire arrives.
      bleScan.callback = callback;
      bleScan.latestDevices = annotated;
    }
    const elapsed = Date.now() - bleScan.startedAt;
    console.log(`[ble] scan: ${annotated.length} device(s) visible (${Math.round(elapsed / 1000)}s elapsed)`);
    mainWindow?.webContents.send('mesh:bleScanUpdate', { devices: annotated, elapsedMs: elapsed });
  });
}

app.on('activate', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

app.whenReady().then(async () => {
  await initCodec();
  db = new MeshDatabase();
  console.log('[mesh-internet] db ready at', db.getDbPath());

  // Auto-prune messages older than 30 days on startup. Keeps the SQLite
  // file from growing forever without surprising the user — most chat
  // history past a month is just clutter for a "what did they just say"
  // style app. Per-conversation and clear-all buttons handle the rest.
  try {
    const MAX_AGE_DAYS = 30;
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
    const pruned = db.pruneMessagesOlderThan(cutoff);
    if (pruned > 0) console.log(`[mesh-internet] pruned ${pruned} message(s) older than ${MAX_AGE_DAYS} days`);
  } catch (e) {
    console.warn('[mesh-internet] message prune failed:', e);
  }
  manager = new MeshManager(db);

  // ── Media permissions for voice messages ──────────────────────────
  // By default, Electron denies getUserMedia() — the call may even
  // succeed with an empty/silent stream depending on platform. We
  // grant 'media' permission to our own renderer here. On macOS we
  // additionally trigger the system mic-access prompt up-front so the
  // first record click doesn't fail silently.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') {
      callback(true);
    } else {
      callback(false);
    }
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'mediaKeySystem';
  });

  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[mesh-internet] mic access status: ${status}`);
    if (status === 'not-determined') {
      try {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        console.log(`[mesh-internet] mic access asked, granted=${granted}`);
      } catch (e) {
        console.warn('[mesh-internet] askForMediaAccess failed:', e);
      }
    }
  }

  createWindow();

  const broadcast = (channel: string, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  // Forward every per-connection event with the connId stamped on it.
  manager.on('state', (p) => broadcast('mesh:state', p));
  manager.on('node', (p) => broadcast('mesh:node', p));
  manager.on('message', (p) => broadcast('mesh:message', p));
  manager.on('message-status', (p) => broadcast('mesh:messageStatus', p));
  manager.on('packet', (p) => broadcast('mesh:packet', p));
  manager.on('telemetry-sample', (p) => broadcast('mesh:telemetrySample', p));
  manager.on('traceroute-sent', (p) => broadcast('mesh:tracerouteSent', p));
  manager.on('traceroute-response', (p) => broadcast('mesh:tracerouteResponse', p));
  manager.on('trace-update', (p) => broadcast('mesh:traceUpdate', p));
  manager.on('connection-added', (p) => broadcast('mesh:connectionAdded', p));
  manager.on('connection-removed', (p) => broadcast('mesh:connectionRemoved', p));
  manager.on('serial-raw', (p) => broadcast('mesh:serialRaw', p));
  manager.on('serial-event', (p) => broadcast('mesh:serialEvent', p));
  manager.on('messages-cleared', (p) => broadcast('mesh:messagesCleared', p));
  manager.on('nodedb-cleared',  (p) => broadcast('mesh:nodedbCleared', p));
  // BLE bridge: main asks renderer to write a frame to toRadio, and asks
  // renderer to close GATT on manager-initiated disconnect.
  manager.on('ble-tx-frame', (p) => broadcast('mesh:bleTxFrame', p));
  manager.on('ble-disconnect-request', (p) => broadcast('mesh:bleDisconnectRequest', p));

  // ── IPC handlers ──────────────────────────────────────────────────
  ipcMain.handle('mesh:listPorts', () => MeshManager.listPorts());
  ipcMain.handle('mesh:listConnections', () => manager.listConnections());
  ipcMain.handle('mesh:connect', (_e, portPath: string) => manager.connect(portPath));
  ipcMain.handle('mesh:disconnect', (_e, connId: string) => manager.disconnect(connId));
  ipcMain.handle('mesh:getState', (_e, connId: string) => manager.getState(connId));
  ipcMain.handle('mesh:getNodes', (_e, connId: string) => manager.getNodes(connId));
  ipcMain.handle('mesh:getMessages', (_e, connId: string) => manager.getMessages(connId));
  ipcMain.handle('mesh:getTraces', (_e, connId: string) => manager.getTraces(connId));

  ipcMain.handle('mesh:sendText', (_e, args: { connId: string; text: string; to?: number; channel?: number; wantAck?: boolean }) => {
    const dest = args.to === undefined ? `ch${args.channel ?? 0} (broadcast)` : `!${(args.to >>> 0).toString(16).padStart(8, '0')}`;
    console.log(`[main] sendText → conn=${args.connId} dest=${dest} wantAck=${args.wantAck ?? (args.to !== undefined)} text="${args.text.slice(0, 60)}"`);
    return manager.sendText(args.connId, args.text, { to: args.to, channel: args.channel, wantAck: args.wantAck });
  });
  ipcMain.handle('mesh:sendTraceroute', (_e, args: { connId: string; to: number; channel?: number }) => {
    return manager.sendTraceroute(args.connId, args.to, args.channel ?? 0);
  });
  ipcMain.handle('mesh:setOwner', (_e, args: { connId: string; longName: string; shortName: string }) => {
    manager.setOwner(args.connId, args.longName, args.shortName);
  });
  ipcMain.handle('mesh:setLoraConfig',      (_e, args: { connId: string; config: any }) => {
    console.log('[main] setLoraConfig →', args.connId, JSON.stringify(args.config));
    manager.setLoraConfig(args.connId, args.config);
  });
  ipcMain.handle('mesh:setDeviceConfig',    (_e, args: { connId: string; config: any }) => manager.setDeviceConfig(args.connId, args.config));
  ipcMain.handle('mesh:setPositionConfig',  (_e, args: { connId: string; config: any }) => manager.setPositionConfig(args.connId, args.config));
  ipcMain.handle('mesh:setPowerConfig',     (_e, args: { connId: string; config: any }) => manager.setPowerConfig(args.connId, args.config));
  ipcMain.handle('mesh:setNetworkConfig',   (_e, args: { connId: string; config: any }) => manager.setNetworkConfig(args.connId, args.config));
  ipcMain.handle('mesh:setDisplayConfig',   (_e, args: { connId: string; config: any }) => manager.setDisplayConfig(args.connId, args.config));
  ipcMain.handle('mesh:setBluetoothConfig', (_e, args: { connId: string; config: any }) => manager.setBluetoothConfig(args.connId, args.config));
  ipcMain.handle('mesh:setMqttConfig',      (_e, args: { connId: string; config: any }) => manager.setMqttConfig(args.connId, args.config));
  ipcMain.handle('mesh:setChannel',         (_e, args: { connId: string; channel: any }) => manager.setChannel(args.connId, args.channel));
  ipcMain.handle('mesh:getChannelSetUrl',   (_e, connId: string) => manager.getChannelSetUrl(connId));
  ipcMain.handle('mesh:applyChannelSetUrl', (_e, args: { connId: string; url: string }) => manager.applyChannelSetUrl(args.connId, args.url));
  ipcMain.handle('mesh:bleStartSession',    async (_e, deviceName: string) => {
    console.log(`[ble] bleStartSession deviceName="${deviceName}"`);
    const id = await manager.connectBle(deviceName);
    console.log(`[ble] bleStartSession → connId=${id}`);
    return id;
  });
  // Renderer → main: the BleScanModal lets the user pick or cancel during
  // the live scan; these handlers resolve the cached select-bluetooth-device
  // callback so requestDevice() in the renderer can finally return.
  ipcMain.handle('mesh:bleScanPick',   (_e, deviceId: string) => endBleScan(deviceId, 'picked'));
  ipcMain.handle('mesh:bleScanCancel', () => endBleScan('', 'cancelled'));
  ipcMain.handle('mesh:retrySync',     (_e, connId: string) => manager.retrySync(connId));
  // Throttled byte counter per connId so we get one log line per second of
  // sustained traffic instead of one per frame.
  const bleRxTotals = new Map<string, { bytes: number; frames: number; sinceLogged: number }>();
  ipcMain.handle('mesh:bleRxFrame',         (_e, args: { connId: string; bytes: string }) => {
    const buf = Buffer.from(args.bytes, 'base64');
    manager.ingestBleFrame(args.connId, buf);
    const totals = bleRxTotals.get(args.connId) ?? { bytes: 0, frames: 0, sinceLogged: Date.now() };
    totals.bytes += buf.length;
    totals.frames += 1;
    if (Date.now() - totals.sinceLogged > 1000) {
      console.log(`[ble] rx ${args.connId}: ${totals.frames}f / ${totals.bytes}B in the last ${((Date.now() - totals.sinceLogged) / 1000).toFixed(1)}s`);
      totals.bytes = 0; totals.frames = 0; totals.sinceLogged = Date.now();
    }
    bleRxTotals.set(args.connId, totals);
  });
  ipcMain.handle('mesh:bleDisconnected',    (_e, args: { connId: string; reason?: string }) => {
    console.log(`[ble] bleDisconnected ${args.connId} reason="${args.reason ?? ''}"`);
    bleRxTotals.delete(args.connId);
    manager.signalBleDisconnect(args.connId, args.reason);
  });
  ipcMain.handle('mesh:bleError',           (_e, args: { connId: string; message: string }) => {
    console.warn(`[ble] bleError ${args.connId}: ${args.message}`);
    manager.signalBleError(args.connId, args.message);
  });
  ipcMain.handle('mesh:refresh',            (_e, connId: string) => manager.refresh(connId));
  ipcMain.handle('mesh:broadcastNodeInfo',  (_e, connId: string) => manager.broadcastNodeInfo(connId));
  ipcMain.handle('mesh:reboot',             (_e, args: { connId: string; seconds?: number }) => {
    console.log(`[main] reboot → ${args.connId} (${args.seconds ?? 5}s)`);
    return manager.reboot(args.connId, args.seconds ?? 5);
  });
  ipcMain.handle('mesh:purgeNodedb',        (_e, connId: string) => {
    console.log(`[main] purgeNodedb → ${connId}`);
    return manager.purgeNodedb(connId);
  });
  ipcMain.handle('mesh:setFavoriteNode',    (_e, args: { connId: string; nodeNum: number; favorite: boolean }) => {
    console.log(`[main] setFavoriteNode → ${args.connId} !${args.nodeNum.toString(16).padStart(8, '0')} = ${args.favorite}`);
    return manager.setFavoriteNode(args.connId, args.nodeNum, args.favorite);
  });
  ipcMain.handle('mesh:clearConversation', (_e, args: { kind: 'channel' | 'dm'; channel?: number; myNum?: number; peer?: number }) => {
    const removed = manager.clearConversation(args);
    console.log(`[main] clearConversation ${JSON.stringify(args)} → ${removed} removed`);
    return removed;
  });
  ipcMain.handle('mesh:clearAllMessages', () => {
    const removed = manager.clearAllMessages();
    console.log(`[main] clearAllMessages → ${removed} removed`);
    return removed;
  });
  ipcMain.handle('mesh:listAntennaOverrides', () => db.listAntennaOverrides());
  ipcMain.handle('mesh:setAntennaOverride', (_e, args: { nodeNum: number; dbi: number; notes: string }) => {
    db.setAntennaOverride(args.nodeNum, args.dbi, args.notes ?? '', Date.now());
    broadcast('mesh:antennaOverrideChanged', { nodeNum: args.nodeNum, dbi: args.dbi, notes: args.notes ?? '' });
  });
  ipcMain.handle('mesh:clearAntennaOverride', (_e, nodeNum: number) => {
    const ok = db.clearAntennaOverride(nodeNum);
    if (ok) broadcast('mesh:antennaOverrideChanged', { nodeNum, dbi: null, notes: '' });
    return ok;
  });
  // Owned-devices roster (per-hwModel ownership of radio models).
  ipcMain.handle('mesh:listOwnedDevices', () => db.listOwnedDevices());
  ipcMain.handle('mesh:setOwnedDevice', (_e, args: { hwModel: number; quantity: number; notes: string }) => {
    db.setOwnedDevice(args.hwModel, args.quantity, args.notes ?? '', Date.now());
    broadcast('mesh:ownedDeviceChanged', { hwModel: args.hwModel, quantity: args.quantity, notes: args.notes ?? '' });
  });
  ipcMain.handle('mesh:clearOwnedDevice', (_e, hwModel: number) => {
    const ok = db.clearOwnedDevice(hwModel);
    if (ok) broadcast('mesh:ownedDeviceChanged', { hwModel, quantity: 0, notes: '' });
    return ok;
  });
  // Owned-antennas roster (per-catalog-id ownership). antennaId is an
  // app-side identifier from src/lib/antenna-catalog.ts.
  ipcMain.handle('mesh:listOwnedAntennas', () => db.listOwnedAntennas());
  ipcMain.handle('mesh:setOwnedAntenna', (_e, args: { antennaId: string; quantity: number; notes: string }) => {
    db.setOwnedAntenna(args.antennaId, args.quantity, args.notes ?? '', Date.now());
    broadcast('mesh:ownedAntennaChanged', { antennaId: args.antennaId, quantity: args.quantity, notes: args.notes ?? '' });
  });
  ipcMain.handle('mesh:clearOwnedAntenna', (_e, antennaId: string) => {
    const ok = db.clearOwnedAntenna(antennaId);
    if (ok) broadcast('mesh:ownedAntennaChanged', { antennaId, quantity: 0, notes: '' });
    return ok;
  });
  ipcMain.handle('mesh:lastRefreshAt',      (_e, connId: string) => manager.getLastRefreshAt(connId));
  ipcMain.handle('mesh:getAutoConnect',     () => manager.getAutoConnect());
  ipcMain.handle('mesh:setAutoConnect',     (_e, enabled: boolean) => manager.setAutoConnect(enabled));
  ipcMain.handle('mesh:getPortStats',       (_e, connId: string) => manager.getPortStats(connId));
  ipcMain.handle('mesh:resetDevice',        (_e, args: { connId: string; profile: 'esp32' | 'esp32-bootloader' | 'nrf52-dfu' | 'rp2040-bootsel' }) => {
    console.log(`[main] resetDevice → ${args.connId} (${args.profile})`);
    return manager.resetDevice(args.connId, args.profile);
  });

  // ── DB / shared (not per-connection) ──────────────────────────────
  ipcMain.handle('mesh:dbStats', () => db.getStats());
  ipcMain.handle('mesh:pathLossSamples', (_e, args: { connId?: string; sinceMs?: number } = {}) => {
    // myNum here is needed for the join. Use the requested connection's
    // myNum if provided, otherwise the first active connection's.
    let myNum: number | undefined;
    if (args.connId) myNum = manager.getState(args.connId)?.myInfo?.myNodeNum;
    if (!myNum) {
      const first = manager.listConnections()[0];
      myNum = first?.state.myInfo?.myNodeNum;
    }
    if (!myNum) return [];
    const since = args.sinceMs ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
    return db.getPathLossSamples(myNum, since);
  });
  ipcMain.handle('mesh:telemetryHistory', (_e, args: { sinceMs?: number } = {}) => {
    const since = args.sinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
    return db.getRecentTelemetry(since);
  });
  ipcMain.handle('mesh:positionTrails', (_e, args: { sinceMs?: number } = {}) => {
    const since = args.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
    return db.getRecentPositionTrails(since);
  });
  ipcMain.handle('mesh:links', () => db.getLinks());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
