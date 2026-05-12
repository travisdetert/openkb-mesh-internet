import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { MeshManager } from './meshtastic/manager';
import { MeshDatabase } from './database';
import { initCodec } from './meshtastic/protobuf-codec';

process.on('uncaughtException', (err) => {
  if (err.message.includes('EPIPE') || err.message.includes('write after end')) return;
  console.error('Uncaught exception:', err);
});

let mainWindow: BrowserWindow | null = null;
let manager: MeshManager;
let db: MeshDatabase;

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
  manager = new MeshManager(db);
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
  ipcMain.handle('mesh:links', () => db.getLinks());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
