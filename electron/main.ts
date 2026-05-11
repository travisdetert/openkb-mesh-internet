import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { MeshtasticController } from './meshtastic/controller';
import { MeshDatabase } from './database';
import { initCodec } from './meshtastic/protobuf-codec';

process.on('uncaughtException', (err) => {
  if (err.message.includes('EPIPE') || err.message.includes('write after end')) return;
  console.error('Uncaught exception:', err);
});

let mainWindow: BrowserWindow | null = null;
let controller: MeshtasticController;
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
  controller = new MeshtasticController(db);
  createWindow();

  const broadcast = (channel: string, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  controller.on('state', (s) => broadcast('mesh:state', s));
  controller.on('node', (n) => broadcast('mesh:node', n));
  controller.on('message', (m) => broadcast('mesh:message', m));
  controller.on('message-status', (m) => broadcast('mesh:messageStatus', m));
  controller.on('packet', (p) => broadcast('mesh:packet', p));
  controller.on('trace-update', (t) => broadcast('mesh:traceUpdate', t));
  controller.on('telemetry-sample', (s) => broadcast('mesh:telemetrySample', s));
  controller.on('traceroute-sent', (t) => broadcast('mesh:tracerouteSent', t));
  controller.on('traceroute-response', (t) => broadcast('mesh:tracerouteResponse', t));

  ipcMain.handle('mesh:listPorts', () => MeshtasticController.listPorts());
  ipcMain.handle('mesh:connect', (_e, portPath: string) => controller.connect(portPath));
  ipcMain.handle('mesh:disconnect', () => controller.disconnect());
  ipcMain.handle('mesh:getState', () => controller.getState());
  ipcMain.handle('mesh:getNodes', () => controller.getNodes());
  ipcMain.handle('mesh:getMessages', () => controller.getMessages());
  ipcMain.handle('mesh:sendText', (_e, args: { text: string; to?: number; channel?: number; wantAck?: boolean }) => {
    return controller.sendText(args.text, { to: args.to, channel: args.channel, wantAck: args.wantAck });
  });
  ipcMain.handle('mesh:sendTraceroute', (_e, args: { to: number; channel?: number }) => {
    return controller.sendTraceroute(args.to, args.channel ?? 0);
  });
  ipcMain.handle('mesh:setOwner', (_e, args: { longName: string; shortName: string }) => {
    controller.setOwner(args.longName, args.shortName);
  });
  ipcMain.handle('mesh:setLoraConfig',      (_e, a: any) => controller.setLoraConfig(a));
  ipcMain.handle('mesh:setDeviceConfig',    (_e, a: any) => controller.setDeviceConfig(a));
  ipcMain.handle('mesh:setPositionConfig',  (_e, a: any) => controller.setPositionConfig(a));
  ipcMain.handle('mesh:setPowerConfig',     (_e, a: any) => controller.setPowerConfig(a));
  ipcMain.handle('mesh:setNetworkConfig',   (_e, a: any) => controller.setNetworkConfig(a));
  ipcMain.handle('mesh:setDisplayConfig',   (_e, a: any) => controller.setDisplayConfig(a));
  ipcMain.handle('mesh:setBluetoothConfig', (_e, a: any) => controller.setBluetoothConfig(a));

  ipcMain.handle('mesh:dbStats', () => db.getStats());
  ipcMain.handle('mesh:pathLossSamples', (_e, args: { sinceMs?: number } = {}) => {
    const myNum = controller.getState().myInfo?.myNodeNum ?? 0;
    if (!myNum) return [];
    const since = args.sinceMs ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
    return db.getPathLossSamples(myNum, since);
  });
  ipcMain.handle('mesh:telemetryHistory', (_e, args: { sinceMs?: number } = {}) => {
    const since = args.sinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
    return db.getRecentTelemetry(since);
  });
  ipcMain.handle('mesh:links', () => db.getLinks());
  ipcMain.handle('mesh:getTraces', () => controller.getTraces());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
