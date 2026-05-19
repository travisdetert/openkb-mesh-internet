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
  reboot:             (args: { connId: string; seconds?: number }) => ipcRenderer.invoke('mesh:reboot', args),
  purgeNodedb:        (connId: string) => ipcRenderer.invoke('mesh:purgeNodedb', connId),
  setFavoriteNode:    (args: { connId: string; nodeNum: number; favorite: boolean }) => ipcRenderer.invoke('mesh:setFavoriteNode', args),
  clearConversation:  (args: { kind: 'channel' | 'dm'; channel?: number; myNum?: number; peer?: number }) => ipcRenderer.invoke('mesh:clearConversation', args),
  clearAllMessages:   () => ipcRenderer.invoke('mesh:clearAllMessages'),
  // Antenna overrides — per-node app-side metadata. Meshtastic's wire
  // protocol has no antenna field, so user-supplied dBi (e.g. for a swap
  // from a 2 dBi rubber duck to a 5 dBi fibreglass omni) lives here and
  // feeds the Link Budget / Coverage / Peer Check math.
  listAntennaOverrides: () => ipcRenderer.invoke('mesh:listAntennaOverrides'),
  setAntennaOverride:   (args: { nodeNum: number; dbi: number; notes: string }) => ipcRenderer.invoke('mesh:setAntennaOverride', args),
  clearAntennaOverride: (nodeNum: number) => ipcRenderer.invoke('mesh:clearAntennaOverride', nodeNum),
  // Owned-devices / owned-antennas rosters. App-side metadata — totally
  // independent of what the radio reports. Drives Device DB & Antenna DB
  // 'Owned' filters and seeds the per-node antenna-override picker.
  listOwnedDevices: () => ipcRenderer.invoke('mesh:listOwnedDevices'),
  setOwnedDevice:   (args: { hwModel: number; quantity: number; notes: string }) => ipcRenderer.invoke('mesh:setOwnedDevice', args),
  clearOwnedDevice: (hwModel: number) => ipcRenderer.invoke('mesh:clearOwnedDevice', hwModel),
  listOwnedAntennas: () => ipcRenderer.invoke('mesh:listOwnedAntennas'),
  setOwnedAntenna:   (args: { antennaId: string; quantity: number; notes: string }) => ipcRenderer.invoke('mesh:setOwnedAntenna', args),
  clearOwnedAntenna: (antennaId: string) => ipcRenderer.invoke('mesh:clearOwnedAntenna', antennaId),
  // ── BLE bridge ──────────────────────────────────────────────────────
  bleStartSession:    (deviceName: string) => ipcRenderer.invoke('mesh:bleStartSession', deviceName),
  bleRxFrame:         (args: { connId: string; bytes: string }) => ipcRenderer.invoke('mesh:bleRxFrame', args),
  bleDisconnected:    (args: { connId: string; reason?: string }) => ipcRenderer.invoke('mesh:bleDisconnected', args),
  bleError:           (args: { connId: string; message: string }) => ipcRenderer.invoke('mesh:bleError', args),
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
  onMessagesCleared: (cb: (p: { connId: string; info: { kind: 'channel' | 'dm' | 'all'; channel?: number; peer?: number } }) => void) => {
    const fn = (_e: unknown, p: { connId: string; info: { kind: 'channel' | 'dm' | 'all'; channel?: number; peer?: number } }) => cb(p);
    ipcRenderer.on('mesh:messagesCleared', fn);
    return () => ipcRenderer.removeListener('mesh:messagesCleared', fn);
  },
  onNodedbCleared: (cb: (p: { connId: string; myNum: number }) => void) => {
    const fn = (_e: unknown, p: { connId: string; myNum: number }) => cb(p);
    ipcRenderer.on('mesh:nodedbCleared', fn);
    return () => ipcRenderer.removeListener('mesh:nodedbCleared', fn);
  },
  onAntennaOverrideChanged: (cb: (p: { nodeNum: number; dbi: number | null; notes: string }) => void) => {
    const fn = (_e: unknown, p: { nodeNum: number; dbi: number | null; notes: string }) => cb(p);
    ipcRenderer.on('mesh:antennaOverrideChanged', fn);
    return () => ipcRenderer.removeListener('mesh:antennaOverrideChanged', fn);
  },
  onOwnedDeviceChanged: (cb: (p: { hwModel: number; quantity: number; notes: string }) => void) => {
    const fn = (_e: unknown, p: { hwModel: number; quantity: number; notes: string }) => cb(p);
    ipcRenderer.on('mesh:ownedDeviceChanged', fn);
    return () => ipcRenderer.removeListener('mesh:ownedDeviceChanged', fn);
  },
  onOwnedAntennaChanged: (cb: (p: { antennaId: string; quantity: number; notes: string }) => void) => {
    const fn = (_e: unknown, p: { antennaId: string; quantity: number; notes: string }) => cb(p);
    ipcRenderer.on('mesh:ownedAntennaChanged', fn);
    return () => ipcRenderer.removeListener('mesh:ownedAntennaChanged', fn);
  },
  // Main process asks renderer to push one ToRadio frame over GATT.
  onBleTxFrame: (cb: (p: { connId: string; bytes: string }) => void) => {
    const fn = (_e: unknown, p: { connId: string; bytes: string }) => cb(p);
    ipcRenderer.on('mesh:bleTxFrame', fn);
    return () => ipcRenderer.removeListener('mesh:bleTxFrame', fn);
  },
  // Main asks renderer to close GATT (manager-initiated disconnect).
  onBleDisconnectRequest: (cb: (p: { connId: string }) => void) => {
    const fn = (_e: unknown, p: { connId: string }) => cb(p);
    ipcRenderer.on('mesh:bleDisconnectRequest', fn);
    return () => ipcRenderer.removeListener('mesh:bleDisconnectRequest', fn);
  },
};

contextBridge.exposeInMainWorld('mesh', api);
