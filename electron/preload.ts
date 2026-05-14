import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // ── connections ─────────────────────────────────────────────────────
  listPorts: () => ipcRenderer.invoke('mesh:listPorts'),
  listConnections: () => ipcRenderer.invoke('mesh:listConnections'),
  connect: (portPath: string) => ipcRenderer.invoke('mesh:connect', portPath),
  disconnect: (connId: string) => ipcRenderer.invoke('mesh:disconnect', connId),

  // ── per-connection queries ──────────────────────────────────────────
  getState: (connId: string) => ipcRenderer.invoke('mesh:getState', connId),
  getNodes: (connId: string) => ipcRenderer.invoke('mesh:getNodes', connId),
  getMessages: (connId: string) => ipcRenderer.invoke('mesh:getMessages', connId),
  getTraces: (connId: string) => ipcRenderer.invoke('mesh:getTraces', connId),

  // ── per-connection commands ─────────────────────────────────────────
  sendText: (args: { connId: string; text: string; to?: number; channel?: number; wantAck?: boolean }) =>
    ipcRenderer.invoke('mesh:sendText', args),
  sendTraceroute: (args: { connId: string; to: number; channel?: number }) =>
    ipcRenderer.invoke('mesh:sendTraceroute', args),
  setOwner: (args: { connId: string; longName: string; shortName: string }) =>
    ipcRenderer.invoke('mesh:setOwner', args),
  setLoraConfig:      (args: { connId: string; config: unknown }) => ipcRenderer.invoke('mesh:setLoraConfig', args),
  setDeviceConfig:    (args: { connId: string; config: unknown }) => ipcRenderer.invoke('mesh:setDeviceConfig', args),
  setPositionConfig:  (args: { connId: string; config: unknown }) => ipcRenderer.invoke('mesh:setPositionConfig', args),
  setPowerConfig:     (args: { connId: string; config: unknown }) => ipcRenderer.invoke('mesh:setPowerConfig', args),
  setNetworkConfig:   (args: { connId: string; config: unknown }) => ipcRenderer.invoke('mesh:setNetworkConfig', args),
  setDisplayConfig:   (args: { connId: string; config: unknown }) => ipcRenderer.invoke('mesh:setDisplayConfig', args),
  setBluetoothConfig: (args: { connId: string; config: unknown }) => ipcRenderer.invoke('mesh:setBluetoothConfig', args),
  setMqttConfig:      (args: { connId: string; config: unknown }) => ipcRenderer.invoke('mesh:setMqttConfig', args),
  setChannel:         (args: { connId: string; channel: unknown }) => ipcRenderer.invoke('mesh:setChannel', args),
  getChannelSetUrl:   (connId: string) => ipcRenderer.invoke('mesh:getChannelSetUrl', connId),
  applyChannelSetUrl: (args: { connId: string; url: string }) => ipcRenderer.invoke('mesh:applyChannelSetUrl', args),
  refresh:            (connId: string) => ipcRenderer.invoke('mesh:refresh', connId),
  lastRefreshAt:      (connId: string) => ipcRenderer.invoke('mesh:lastRefreshAt', connId),
  broadcastNodeInfo:  (connId: string) => ipcRenderer.invoke('mesh:broadcastNodeInfo', connId),
  getAutoConnect:     () => ipcRenderer.invoke('mesh:getAutoConnect'),
  setAutoConnect:     (enabled: boolean) => ipcRenderer.invoke('mesh:setAutoConnect', enabled),
  getPortStats:       (connId: string) => ipcRenderer.invoke('mesh:getPortStats', connId),
  resetDevice:        (args: { connId: string; profile: 'esp32' | 'esp32-bootloader' | 'nrf52-dfu' | 'rp2040-bootsel' }) =>
    ipcRenderer.invoke('mesh:resetDevice', args),

  // ── shared / DB ─────────────────────────────────────────────────────
  dbStats: () => ipcRenderer.invoke('mesh:dbStats'),
  pathLossSamples: (args?: { connId?: string; sinceMs?: number }) => ipcRenderer.invoke('mesh:pathLossSamples', args ?? {}),
  telemetryHistory: (args?: { sinceMs?: number }) => ipcRenderer.invoke('mesh:telemetryHistory', args ?? {}),
  links: () => ipcRenderer.invoke('mesh:links'),

  // ── event streams (all payloads now carry connId) ───────────────────
  onState: (cb: (p: { connId: string; state: unknown }) => void) => {
    const fn = (_e: unknown, p: { connId: string; state: unknown }) => cb(p);
    ipcRenderer.on('mesh:state', fn);
    return () => ipcRenderer.removeListener('mesh:state', fn);
  },
  onNode: (cb: (p: { connId: string; node: unknown }) => void) => {
    const fn = (_e: unknown, p: { connId: string; node: unknown }) => cb(p);
    ipcRenderer.on('mesh:node', fn);
    return () => ipcRenderer.removeListener('mesh:node', fn);
  },
  onMessage: (cb: (p: { connId: string; message: unknown }) => void) => {
    const fn = (_e: unknown, p: { connId: string; message: unknown }) => cb(p);
    ipcRenderer.on('mesh:message', fn);
    return () => ipcRenderer.removeListener('mesh:message', fn);
  },
  onMessageStatus: (cb: (p: { connId: string; message: unknown }) => void) => {
    const fn = (_e: unknown, p: { connId: string; message: unknown }) => cb(p);
    ipcRenderer.on('mesh:messageStatus', fn);
    return () => ipcRenderer.removeListener('mesh:messageStatus', fn);
  },
  onPacket: (cb: (p: { connId: string; packet: unknown }) => void) => {
    const fn = (_e: unknown, p: { connId: string; packet: unknown }) => cb(p);
    ipcRenderer.on('mesh:packet', fn);
    return () => ipcRenderer.removeListener('mesh:packet', fn);
  },
  onTelemetrySample: (cb: (p: { connId: string; sample: unknown }) => void) => {
    const fn = (_e: unknown, p: { connId: string; sample: unknown }) => cb(p);
    ipcRenderer.on('mesh:telemetrySample', fn);
    return () => ipcRenderer.removeListener('mesh:telemetrySample', fn);
  },
  onTracerouteSent: (cb: (p: { connId: string; trace: unknown }) => void) => {
    const fn = (_e: unknown, p: { connId: string; trace: unknown }) => cb(p);
    ipcRenderer.on('mesh:tracerouteSent', fn);
    return () => ipcRenderer.removeListener('mesh:tracerouteSent', fn);
  },
  onTracerouteResponse: (cb: (p: { connId: string; response: unknown }) => void) => {
    const fn = (_e: unknown, p: { connId: string; response: unknown }) => cb(p);
    ipcRenderer.on('mesh:tracerouteResponse', fn);
    return () => ipcRenderer.removeListener('mesh:tracerouteResponse', fn);
  },
  onTraceUpdate: (cb: (p: { connId: string; trace: unknown }) => void) => {
    const fn = (_e: unknown, p: { connId: string; trace: unknown }) => cb(p);
    ipcRenderer.on('mesh:traceUpdate', fn);
    return () => ipcRenderer.removeListener('mesh:traceUpdate', fn);
  },
  onConnectionAdded: (cb: (p: { connId: string; portPath: string }) => void) => {
    const fn = (_e: unknown, p: { connId: string; portPath: string }) => cb(p);
    ipcRenderer.on('mesh:connectionAdded', fn);
    return () => ipcRenderer.removeListener('mesh:connectionAdded', fn);
  },
  onSerialRaw: (cb: (p: { connId: string; direction: 'rx' | 'tx'; at: number; bytes: string }) => void) => {
    const fn = (_e: unknown, p: { connId: string; direction: 'rx' | 'tx'; at: number; bytes: string }) => cb(p);
    ipcRenderer.on('mesh:serialRaw', fn);
    return () => ipcRenderer.removeListener('mesh:serialRaw', fn);
  },
  onSerialEvent: (cb: (p: { connId: string; event: { at: number; kind: string; detail?: string } }) => void) => {
    const fn = (_e: unknown, p: { connId: string; event: { at: number; kind: string; detail?: string } }) => cb(p);
    ipcRenderer.on('mesh:serialEvent', fn);
    return () => ipcRenderer.removeListener('mesh:serialEvent', fn);
  },
  onConnectionRemoved: (cb: (p: { connId: string }) => void) => {
    const fn = (_e: unknown, p: { connId: string }) => cb(p);
    ipcRenderer.on('mesh:connectionRemoved', fn);
    return () => ipcRenderer.removeListener('mesh:connectionRemoved', fn);
  },
};

contextBridge.exposeInMainWorld('mesh', api);
