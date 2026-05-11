import { contextBridge, ipcRenderer } from 'electron';

const api = {
  listPorts: () => ipcRenderer.invoke('mesh:listPorts'),
  connect: (portPath: string) => ipcRenderer.invoke('mesh:connect', portPath),
  disconnect: () => ipcRenderer.invoke('mesh:disconnect'),
  getState: () => ipcRenderer.invoke('mesh:getState'),
  getNodes: () => ipcRenderer.invoke('mesh:getNodes'),
  getMessages: () => ipcRenderer.invoke('mesh:getMessages'),
  sendText: (args: { text: string; to?: number; channel?: number; wantAck?: boolean }) =>
    ipcRenderer.invoke('mesh:sendText', args),
  sendTraceroute: (args: { to: number; channel?: number }) =>
    ipcRenderer.invoke('mesh:sendTraceroute', args),
  setOwner: (args: { longName: string; shortName: string }) =>
    ipcRenderer.invoke('mesh:setOwner', args),
  setLoraConfig:      (a: unknown) => ipcRenderer.invoke('mesh:setLoraConfig', a),
  setDeviceConfig:    (a: unknown) => ipcRenderer.invoke('mesh:setDeviceConfig', a),
  setPositionConfig:  (a: unknown) => ipcRenderer.invoke('mesh:setPositionConfig', a),
  setPowerConfig:     (a: unknown) => ipcRenderer.invoke('mesh:setPowerConfig', a),
  setNetworkConfig:   (a: unknown) => ipcRenderer.invoke('mesh:setNetworkConfig', a),
  setDisplayConfig:   (a: unknown) => ipcRenderer.invoke('mesh:setDisplayConfig', a),
  setBluetoothConfig: (a: unknown) => ipcRenderer.invoke('mesh:setBluetoothConfig', a),

  dbStats: () => ipcRenderer.invoke('mesh:dbStats'),
  pathLossSamples: (args?: { sinceMs?: number }) => ipcRenderer.invoke('mesh:pathLossSamples', args ?? {}),
  telemetryHistory: (args?: { sinceMs?: number }) => ipcRenderer.invoke('mesh:telemetryHistory', args ?? {}),
  links: () => ipcRenderer.invoke('mesh:links'),
  getTraces: () => ipcRenderer.invoke('mesh:getTraces'),

  onState: (cb: (s: unknown) => void) => {
    const fn = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('mesh:state', fn);
    return () => ipcRenderer.removeListener('mesh:state', fn);
  },
  onNode: (cb: (n: unknown) => void) => {
    const fn = (_e: unknown, n: unknown) => cb(n);
    ipcRenderer.on('mesh:node', fn);
    return () => ipcRenderer.removeListener('mesh:node', fn);
  },
  onMessage: (cb: (m: unknown) => void) => {
    const fn = (_e: unknown, m: unknown) => cb(m);
    ipcRenderer.on('mesh:message', fn);
    return () => ipcRenderer.removeListener('mesh:message', fn);
  },
  onMessageStatus: (cb: (m: unknown) => void) => {
    const fn = (_e: unknown, m: unknown) => cb(m);
    ipcRenderer.on('mesh:messageStatus', fn);
    return () => ipcRenderer.removeListener('mesh:messageStatus', fn);
  },
  onPacket: (cb: (p: unknown) => void) => {
    const fn = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('mesh:packet', fn);
    return () => ipcRenderer.removeListener('mesh:packet', fn);
  },
  onTelemetrySample: (cb: (s: unknown) => void) => {
    const fn = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('mesh:telemetrySample', fn);
    return () => ipcRenderer.removeListener('mesh:telemetrySample', fn);
  },
  onTracerouteSent: (cb: (t: unknown) => void) => {
    const fn = (_e: unknown, t: unknown) => cb(t);
    ipcRenderer.on('mesh:tracerouteSent', fn);
    return () => ipcRenderer.removeListener('mesh:tracerouteSent', fn);
  },
  onTracerouteResponse: (cb: (t: unknown) => void) => {
    const fn = (_e: unknown, t: unknown) => cb(t);
    ipcRenderer.on('mesh:tracerouteResponse', fn);
    return () => ipcRenderer.removeListener('mesh:tracerouteResponse', fn);
  },
  onTraceUpdate: (cb: (t: unknown) => void) => {
    const fn = (_e: unknown, t: unknown) => cb(t);
    ipcRenderer.on('mesh:traceUpdate', fn);
    return () => ipcRenderer.removeListener('mesh:traceUpdate', fn);
  },
};

contextBridge.exposeInMainWorld('mesh', api);
