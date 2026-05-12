// Meshtastic protobuf codec — backed by the official @meshtastic/protobufs
// schemas + @bufbuild/protobuf. The packages are pure ESM, so we load them
// once at startup via dynamic import (CommonJS can't `require` ESM).

import type { fromBinary as FromBinary, toBinary as ToBinary, create as Create } from '@bufbuild/protobuf';

// `new Function` keeps TypeScript from rewriting `import()` to `require()`
// when emitting CommonJS.
const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

let Proto: any = null;
let fromBinary: typeof FromBinary | null = null;
let toBinary: typeof ToBinary | null = null;
let create: typeof Create | null = null;

export async function initCodec(): Promise<void> {
  if (Proto) return;
  const [proto, buf] = await Promise.all([
    dynImport('@meshtastic/protobufs'),
    dynImport('@bufbuild/protobuf'),
  ]);
  Proto = proto;
  fromBinary = buf.fromBinary;
  toBinary = buf.toBinary;
  create = buf.create;
}

function ensureReady(): void {
  if (!Proto || !fromBinary || !toBinary || !create) {
    throw new Error('protobuf-codec not initialized — call initCodec() first');
  }
}

// ---------------------------------------------------------------------------
// Public types — kept stable so the controller / IPC don't need to change.
// ---------------------------------------------------------------------------

export interface FromRadioMessage {
  id?: number;
  type: 'my_info' | 'node_info' | 'config' | 'channel' | 'packet' | 'config_complete' | 'metadata' | 'unknown';
  myInfo?: MyInfo;
  nodeInfo?: NodeInfo;
  packet?: MeshPacket;
  configCompleteId?: number;
  loraConfig?: LoRaConfigMsg;
  deviceConfig?: DeviceConfigMsg;
  positionConfig?: PositionConfigMsg;
  powerConfig?: PowerConfigMsg;
  networkConfig?: NetworkConfigMsg;
  displayConfig?: DisplayConfigMsg;
  bluetoothConfig?: BluetoothConfigMsg;
  mqttConfig?: MQTTConfigMsg;
  channel?: ChannelMsg;
  metadata?: DeviceMetadataMsg;
}

export interface DeviceConfigMsg {
  role: number;
  rebroadcastMode: number;
  nodeInfoBroadcastSecs: number;
  serialEnabled: boolean;
  buttonGpio: number;
  buzzerGpio: number;
  doubleTapAsButtonPress: boolean;
  ledHeartbeatDisabled: boolean;
  tzdef: string;
}
export interface PositionConfigMsg {
  positionBroadcastSecs: number;
  positionBroadcastSmartEnabled: boolean;
  fixedPosition: boolean;
  gpsUpdateInterval: number;
  positionFlags: number;
  gpsMode: number;
  broadcastSmartMinimumDistance: number;
  broadcastSmartMinimumIntervalSecs: number;
}
export interface PowerConfigMsg {
  isPowerSaving: boolean;
  onBatteryShutdownAfterSecs: number;
  adcMultiplierOverride: number;
  waitBluetoothSecs: number;
  sdsSecs: number;
  lsSecs: number;
  minWakeSecs: number;
}
export interface NetworkConfigMsg {
  wifiEnabled: boolean;
  wifiSsid: string;
  wifiPsk: string;
  ntpServer: string;
  ethEnabled: boolean;
  addressMode: number;
  rsyslogServer: string;
}
export interface DisplayConfigMsg {
  screenOnSecs: number;
  autoScreenCarouselSecs: number;
  compassNorthTop: boolean;
  flipScreen: boolean;
  units: number;
  oled: number;
  displaymode: number;
  headingBold: boolean;
  wakeOnTapOrMotion: boolean;
}
export interface BluetoothConfigMsg {
  enabled: boolean;
  mode: number;
  fixedPin: number;
}

/** Module-level MQTT config — broker, encryption, topic routing, optional public-map reporting. */
export interface MQTTConfigMsg {
  /** Master switch — when false the radio does not connect to any broker. */
  enabled: boolean;
  /** Broker address. Blank = use the default public broker at mqtt.meshtastic.org. */
  address: string;
  username: string;
  /** The password is write-only on the radio; reads come back blank. */
  password: string;
  /** When on, packets are encrypted with channel PSK before publishing (default). */
  encryptionEnabled: boolean;
  /** When on, the radio additionally publishes a JSON debug stream (unencrypted). */
  jsonEnabled: boolean;
  /** Use TLS on the broker connection. Required by some private brokers. */
  tlsEnabled: boolean;
  /** Topic prefix. Blank = "msh/". */
  root: string;
  /** When on, the radio proxies its MQTT stream through the connected client (no WiFi needed). */
  proxyToClientEnabled: boolean;
  /** When on, publishes the radio's position to the public Meshtastic map. */
  mapReportingEnabled: boolean;
  /** Map-reporting cadence in seconds. */
  mapReportPublishIntervalSecs?: number;
  /** Position precision for map publishes (bits — 0 = full, lower = coarser). */
  mapReportPositionPrecision?: number;
}

export interface MyInfo {
  myNodeNum: number;
  firmwareVersion: string;
  hasWifi: boolean;
  hasBluetooth: boolean;
  maxChannels: number;
}

export interface DeviceMetadataMsg {
  firmwareVersion: string;
  hasWifi: boolean;
  hasBluetooth: boolean;
  hasEthernet: boolean;
  hwModel: number;
  role: number;
}

export interface LoRaConfigMsg {
  usePreset: boolean;
  modemPreset: number;
  modemPresetName: string;
  bandwidth: number;
  spreadFactor: number;
  codingRate: number;
  region: number;
  regionName: string;
  hopLimit: number;
  txEnabled: boolean;
  txPower: number;
  channelNum: number;
  overrideDutyCycle: boolean;
  sx126xRxBoostedGain: boolean;
  overrideFrequency: number;
}

export interface ChannelMsg {
  index: number;
  role: number;
  roleName: string;
  name: string;
  pskLength: number;
  /** Raw PSK bytes (0–32 bytes). Travels to the renderer as a number array via IPC. */
  psk: number[];
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
}

/** Editable payload for SetChannel — fields here mirror what the radio accepts. */
export interface ChannelEdit {
  index: number;
  role: number; // 0=disabled, 1=primary, 2=secondary
  name: string;
  psk: number[];
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
}

export interface NodeInfo {
  num: number;
  id?: string;
  longName: string;
  shortName: string;
  macaddr: string;
  hwModel: number;
  role?: number;
  lat?: number;
  lon?: number;
  altitude?: number;
  batteryLevel?: number;
  voltage?: number;
  channelUtilization?: number;
  airUtilTx?: number;
  lastHeard?: number;
  snr?: number;
  hopsAway?: number;
  channel?: number;
  viaMqtt?: boolean;
  isFavorite?: boolean;
}

export interface MeshPacket {
  from: number;
  to: number;
  id: number;
  channel: number;
  hopLimit: number;
  hopStart: number;
  wantAck: boolean;
  rxTime: number;
  rxSnr: number;
  rxRssi: number;
  viaMqtt: boolean;
  portnum?: number;
  payloadBytes?: Uint8Array;
  /** When set, this packet was an encrypted blob we couldn't read (no key for that channel). */
  encrypted?: boolean;
  /** Data.requestId — set when the packet is replying to one of our previous packets. */
  requestId?: number;
  text?: string;
  position?: { lat: number; lon: number; altitude: number; time: number; precisionBits?: number };
  nodeInfo?: { id?: string; longName: string; shortName: string; hwModel: number; macaddr: string; role?: number };
  telemetry?: {
    batteryLevel?: number;
    voltage?: number;
    channelUtilization?: number;
    airUtilTx?: number;
    uptimeSeconds?: number;
    temperature?: number;
    humidity?: number;
    barometricPressure?: number;
    chPower?: number;
    chCurrent?: number;
    numOnlineNodes?: number;
    numTotalNodes?: number;
  };
  routing?: { errorReason: number };
  traceroute?: { route: number[] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODEM_PRESETS: Record<number, string> = {
  0: 'LongFast', 1: 'LongSlow', 2: 'VeryLongSlow', 3: 'MediumSlow', 4: 'MediumFast',
  5: 'ShortSlow', 6: 'ShortFast', 7: 'LongModerate', 8: 'ShortTurbo',
};

const REGIONS: Record<number, string> = {
  0: 'UNSET', 1: 'US', 2: 'EU_433', 3: 'EU_868', 4: 'CN', 5: 'JP', 6: 'ANZ', 7: 'KR',
  8: 'TW', 9: 'RU', 10: 'IN', 11: 'NZ_865', 12: 'TH', 13: 'LORA_24', 14: 'UA_433',
  15: 'UA_868', 16: 'MY_433', 17: 'MY_919', 18: 'SG_923',
};

const CHANNEL_ROLES: Record<number, string> = {
  0: 'DISABLED', 1: 'PRIMARY', 2: 'SECONDARY',
};

function macToHex(m: Uint8Array | undefined): string {
  if (!m || m.length === 0) return '';
  return Array.from(m).map((b) => b.toString(16).padStart(2, '0')).join(':');
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export function decodeFromRadio(bytes: Uint8Array): FromRadioMessage {
  ensureReady();
  const msg = fromBinary!(Proto.Mesh.FromRadioSchema, bytes) as any;
  const variant = msg.payloadVariant;
  const out: FromRadioMessage = { type: 'unknown', id: msg.id };
  if (!variant) return out;

  switch (variant.case) {
    case 'myInfo': {
      const m = variant.value;
      out.type = 'my_info';
      out.myInfo = {
        myNodeNum: m.myNodeNum,
        firmwareVersion: '',
        hasWifi: false,
        hasBluetooth: false,
        maxChannels: 8,
      };
      break;
    }
    case 'nodeInfo': {
      out.type = 'node_info';
      out.nodeInfo = mapNodeInfo(variant.value);
      break;
    }
    case 'config': {
      const cfg = variant.value;
      const sub = cfg.payloadVariant;
      if (!sub) break;
      out.type = 'config';
      switch (sub.case) {
        case 'lora':      out.loraConfig = mapLoRaConfig(sub.value); break;
        case 'device':    out.deviceConfig = mapDeviceConfig(sub.value); break;
        case 'position':  out.positionConfig = mapPositionConfig(sub.value); break;
        case 'power':     out.powerConfig = mapPowerConfig(sub.value); break;
        case 'network':   out.networkConfig = mapNetworkConfig(sub.value); break;
        case 'display':   out.displayConfig = mapDisplayConfig(sub.value); break;
        case 'bluetooth': out.bluetoothConfig = mapBluetoothConfig(sub.value); break;
      }
      break;
    }
    case 'moduleConfig': {
      const mc = variant.value;
      const sub = mc.payloadVariant;
      if (!sub) break;
      // We use the 'config' type marker so downstream consumers don't need a
      // new branch — the controller dispatches on which field is populated.
      out.type = 'config';
      if (sub.case === 'mqtt') {
        out.mqttConfig = mapMqttConfig(sub.value);
      }
      // Other ModuleConfig variants (serial, telemetry, store_forward, etc.)
      // are intentionally ignored for now.
      break;
    }
    case 'channel': {
      out.type = 'channel';
      out.channel = mapChannel(variant.value);
      break;
    }
    case 'packet': {
      out.type = 'packet';
      out.packet = mapMeshPacket(variant.value);
      break;
    }
    case 'configCompleteId': {
      out.type = 'config_complete';
      out.configCompleteId = variant.value;
      break;
    }
    case 'metadata': {
      const md = variant.value;
      out.type = 'metadata';
      out.metadata = {
        firmwareVersion: md.firmwareVersion ?? '',
        hasWifi: !!md.hasWifi,
        hasBluetooth: !!md.hasBluetooth,
        hasEthernet: !!md.hasEthernet,
        hwModel: typeof md.hwModel === 'number' ? md.hwModel : 0,
        role: typeof md.role === 'number' ? md.role : 0,
      };
      // Backfill MyInfo-style fields if the controller asks for them later.
      out.myInfo = {
        myNodeNum: 0,
        firmwareVersion: out.metadata.firmwareVersion,
        hasWifi: out.metadata.hasWifi,
        hasBluetooth: out.metadata.hasBluetooth,
        maxChannels: 8,
      };
      break;
    }
    default:
      // queueStatus, moduleConfig, log_record, fileInfo, clientNotification, etc.
      break;
  }
  return out;
}

function mapNodeInfo(n: any): NodeInfo {
  const out: NodeInfo = {
    num: n.num,
    longName: '',
    shortName: '',
    macaddr: '',
    hwModel: 0,
  };
  if (n.user) {
    out.id = n.user.id ?? '';
    out.longName = n.user.longName ?? '';
    out.shortName = n.user.shortName ?? '';
    out.macaddr = macToHex(n.user.macaddr);
    out.hwModel = typeof n.user.hwModel === 'number' ? n.user.hwModel : 0;
    if (typeof n.user.role === 'number') out.role = n.user.role;
  }
  if (n.position) {
    if (typeof n.position.latitudeI === 'number') out.lat = n.position.latitudeI / 1e7;
    if (typeof n.position.longitudeI === 'number') out.lon = n.position.longitudeI / 1e7;
    if (typeof n.position.altitude === 'number') out.altitude = n.position.altitude;
    if (typeof n.position.precisionBits === 'number' && n.position.precisionBits > 0) {
      (out as any).posPrecisionBits = n.position.precisionBits;
    }
  }
  if (n.deviceMetrics) {
    if (typeof n.deviceMetrics.batteryLevel === 'number') out.batteryLevel = n.deviceMetrics.batteryLevel;
    if (typeof n.deviceMetrics.voltage === 'number') out.voltage = n.deviceMetrics.voltage;
    if (typeof n.deviceMetrics.channelUtilization === 'number') out.channelUtilization = n.deviceMetrics.channelUtilization;
    if (typeof n.deviceMetrics.airUtilTx === 'number') out.airUtilTx = n.deviceMetrics.airUtilTx;
  }
  if (typeof n.snr === 'number') out.snr = n.snr;
  if (typeof n.lastHeard === 'number') out.lastHeard = n.lastHeard;
  if (typeof n.channel === 'number') out.channel = n.channel;
  if (typeof n.hopsAway === 'number') out.hopsAway = n.hopsAway;
  if (typeof n.viaMqtt === 'boolean') out.viaMqtt = n.viaMqtt;
  if (typeof n.isFavorite === 'boolean') out.isFavorite = n.isFavorite;
  return out;
}

function mapLoRaConfig(c: any): LoRaConfigMsg {
  return {
    usePreset: !!c.usePreset,
    modemPreset: c.modemPreset ?? 0,
    modemPresetName: MODEM_PRESETS[c.modemPreset] ?? `unknown(${c.modemPreset})`,
    bandwidth: c.bandwidth ?? 0,
    spreadFactor: c.spreadFactor ?? 0,
    codingRate: c.codingRate ?? 0,
    region: c.region ?? 0,
    regionName: REGIONS[c.region] ?? `unknown(${c.region})`,
    hopLimit: c.hopLimit ?? 0,
    txEnabled: c.txEnabled ?? true,
    txPower: c.txPower ?? 0,
    channelNum: c.channelNum ?? 0,
    overrideDutyCycle: !!c.overrideDutyCycle,
    sx126xRxBoostedGain: !!c.sx126xRxBoostedGain,
    overrideFrequency: c.overrideFrequency ?? 0,
  };
}

function mapDeviceConfig(c: any): DeviceConfigMsg {
  return {
    role: c.role ?? 0,
    rebroadcastMode: c.rebroadcastMode ?? 0,
    nodeInfoBroadcastSecs: c.nodeInfoBroadcastSecs ?? 10800,
    serialEnabled: !!c.serialEnabled,
    buttonGpio: c.buttonGpio ?? 0,
    buzzerGpio: c.buzzerGpio ?? 0,
    doubleTapAsButtonPress: !!c.doubleTapAsButtonPress,
    ledHeartbeatDisabled: !!c.ledHeartbeatDisabled,
    tzdef: c.tzdef ?? '',
  };
}
function mapPositionConfig(c: any): PositionConfigMsg {
  return {
    positionBroadcastSecs: c.positionBroadcastSecs ?? 900,
    positionBroadcastSmartEnabled: !!c.positionBroadcastSmartEnabled,
    fixedPosition: !!c.fixedPosition,
    gpsUpdateInterval: c.gpsUpdateInterval ?? 30,
    positionFlags: c.positionFlags ?? 0,
    gpsMode: c.gpsMode ?? 0,
    broadcastSmartMinimumDistance: c.broadcastSmartMinimumDistance ?? 0,
    broadcastSmartMinimumIntervalSecs: c.broadcastSmartMinimumIntervalSecs ?? 0,
  };
}
function mapPowerConfig(c: any): PowerConfigMsg {
  return {
    isPowerSaving: !!c.isPowerSaving,
    onBatteryShutdownAfterSecs: c.onBatteryShutdownAfterSecs ?? 0,
    adcMultiplierOverride: c.adcMultiplierOverride ?? 0,
    waitBluetoothSecs: c.waitBluetoothSecs ?? 60,
    sdsSecs: c.sdsSecs ?? 0,
    lsSecs: c.lsSecs ?? 300,
    minWakeSecs: c.minWakeSecs ?? 10,
  };
}
function mapNetworkConfig(c: any): NetworkConfigMsg {
  return {
    wifiEnabled: !!c.wifiEnabled,
    wifiSsid: c.wifiSsid ?? '',
    wifiPsk: c.wifiPsk ?? '',
    ntpServer: c.ntpServer ?? '',
    ethEnabled: !!c.ethEnabled,
    addressMode: c.addressMode ?? 0,
    rsyslogServer: c.rsyslogServer ?? '',
  };
}
function mapDisplayConfig(c: any): DisplayConfigMsg {
  return {
    screenOnSecs: c.screenOnSecs ?? 0,
    autoScreenCarouselSecs: c.autoScreenCarouselSecs ?? 0,
    compassNorthTop: !!c.compassNorthTop,
    flipScreen: !!c.flipScreen,
    units: c.units ?? 0,
    oled: c.oled ?? 0,
    displaymode: c.displaymode ?? 0,
    headingBold: !!c.headingBold,
    wakeOnTapOrMotion: !!c.wakeOnTapOrMotion,
  };
}
function mapBluetoothConfig(c: any): BluetoothConfigMsg {
  return {
    enabled: !!c.enabled,
    mode: c.mode ?? 0,
    fixedPin: c.fixedPin ?? 123456,
  };
}

function mapMqttConfig(c: any): MQTTConfigMsg {
  return {
    enabled: !!c.enabled,
    address: c.address ?? '',
    username: c.username ?? '',
    password: c.password ?? '',
    encryptionEnabled: !!c.encryptionEnabled,
    jsonEnabled: !!c.jsonEnabled,
    tlsEnabled: !!c.tlsEnabled,
    root: c.root ?? '',
    proxyToClientEnabled: !!c.proxyToClientEnabled,
    mapReportingEnabled: !!c.mapReportingEnabled,
    mapReportPublishIntervalSecs: c.mapReportSettings?.publishIntervalSecs,
    mapReportPositionPrecision: c.mapReportSettings?.positionPrecision,
  };
}

function mapChannel(c: any): ChannelMsg {
  const psk: Uint8Array | undefined = c.settings?.psk;
  return {
    index: c.index ?? 0,
    role: c.role ?? 0,
    roleName: CHANNEL_ROLES[c.role] ?? `unknown(${c.role})`,
    name: c.settings?.name ?? '',
    pskLength: psk?.length ?? 0,
    psk: psk ? Array.from(psk) : [],
    uplinkEnabled: !!c.settings?.uplinkEnabled,
    downlinkEnabled: !!c.settings?.downlinkEnabled,
  };
}

function mapMeshPacket(p: any): MeshPacket {
  const pkt: MeshPacket = {
    from: p.from ?? 0,
    to: p.to ?? 0,
    id: p.id ?? 0,
    channel: p.channel ?? 0,
    hopLimit: p.hopLimit ?? 0,
    hopStart: p.hopStart ?? 0,
    wantAck: !!p.wantAck,
    rxTime: p.rxTime ?? 0,
    rxSnr: typeof p.rxSnr === 'number' ? p.rxSnr : 0,
    rxRssi: typeof p.rxRssi === 'number' ? p.rxRssi : 0,
    viaMqtt: !!p.viaMqtt,
  };

  const variant = p.payloadVariant;
  if (variant?.case === 'decoded') {
    const data = variant.value;
    pkt.portnum = data.portnum;
    if (typeof data.requestId === 'number' && data.requestId !== 0) pkt.requestId = data.requestId;
    const payload = data.payload instanceof Uint8Array ? data.payload : new Uint8Array(data.payload ?? []);
    pkt.payloadBytes = payload;
    decodeAppPayload(pkt, data.portnum, payload);
  } else if (variant?.case === 'encrypted') {
    pkt.encrypted = true;
  }
  return pkt;
}

function decodeAppPayload(pkt: MeshPacket, portnum: number, payload: Uint8Array): void {
  ensureReady();
  // Numeric port enum values from meshtastic/portnums.proto
  const TEXT = 1, POSITION = 3, NODEINFO = 4, ROUTING = 5, TELEMETRY = 67, TRACEROUTE = 70;
  try {
    switch (portnum) {
      case TEXT:
        pkt.text = new TextDecoder().decode(payload);
        break;
      case POSITION: {
        const pos = fromBinary!(Proto.Mesh.PositionSchema, payload) as any;
        pkt.position = {
          lat: typeof pos.latitudeI === 'number' ? pos.latitudeI / 1e7 : 0,
          lon: typeof pos.longitudeI === 'number' ? pos.longitudeI / 1e7 : 0,
          altitude: pos.altitude ?? 0,
          time: pos.time ?? 0,
          precisionBits: typeof pos.precisionBits === 'number' && pos.precisionBits > 0 ? pos.precisionBits : undefined,
        };
        break;
      }
      case NODEINFO: {
        const u = fromBinary!(Proto.Mesh.UserSchema, payload) as any;
        pkt.nodeInfo = {
          id: u.id ?? '',
          longName: u.longName ?? '',
          shortName: u.shortName ?? '',
          macaddr: macToHex(u.macaddr),
          hwModel: typeof u.hwModel === 'number' ? u.hwModel : 0,
          role: typeof u.role === 'number' ? u.role : 0,
        };
        break;
      }
      case ROUTING: {
        const r = fromBinary!(Proto.Mesh.RoutingSchema, payload) as any;
        const variant = r.variant;
        // Routing.variant case names in protobuf-es are camelCase: routeRequest, routeReply, errorReason.
        let errorReason = 0;
        if (variant?.case === 'errorReason') errorReason = variant.value;
        pkt.routing = { errorReason };
        break;
      }
      case TELEMETRY: {
        const t = fromBinary!(Proto.Telemetry.TelemetrySchema, payload) as any;
        const v = t.variant;
        if (v?.case === 'deviceMetrics') {
          const dm = v.value;
          pkt.telemetry = {
            batteryLevel: dm.batteryLevel,
            voltage: dm.voltage,
            channelUtilization: dm.channelUtilization,
            airUtilTx: dm.airUtilTx,
            uptimeSeconds: dm.uptimeSeconds,
          };
        } else if (v?.case === 'environmentMetrics') {
          const em = v.value;
          pkt.telemetry = {
            temperature: em.temperature,
            humidity: em.relativeHumidity,
            barometricPressure: em.barometricPressure,
          };
        } else if (v?.case === 'powerMetrics') {
          const pm = v.value;
          pkt.telemetry = {
            voltage: pm.ch1Voltage,
            chPower: pm.ch1Current,
          };
        } else if (v?.case === 'localStats') {
          const ls = v.value;
          pkt.telemetry = {
            uptimeSeconds: ls.uptimeSeconds,
            channelUtilization: ls.channelUtilization,
            airUtilTx: ls.airUtilTx,
            numOnlineNodes: ls.numOnlineNodes,
            numTotalNodes: ls.numTotalNodes,
          };
        } else {
          pkt.telemetry = {};
        }
        break;
      }
      case TRACEROUTE: {
        const rd = fromBinary!(Proto.Mesh.RouteDiscoverySchema, payload) as any;
        pkt.traceroute = { route: Array.isArray(rd.route) ? rd.route : [] };
        break;
      }
    }
  } catch {
    // Bad/short payload — leave fields unset rather than throw
  }
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

const PORTNUM_TEXT_MESSAGE = 1;
const PORTNUM_TRACEROUTE = 70;

export function encodeToRadio_WantConfig(configId: number): Uint8Array {
  ensureReady();
  const msg = create!(Proto.Mesh.ToRadioSchema, {
    payloadVariant: { case: 'wantConfigId', value: configId },
  });
  return toBinary!(Proto.Mesh.ToRadioSchema, msg);
}

/**
 * Build a text MeshPacket with the supplied id. Caller picks the id so it can
 * track ack status against incoming Routing.requestId.
 */
export function encodeToRadio_SendText(args: {
  text: string;
  to: number;
  channel: number;
  wantAck: boolean;
  id: number;
}): Uint8Array {
  ensureReady();
  const data = create!(Proto.Mesh.DataSchema, {
    portnum: PORTNUM_TEXT_MESSAGE,
    payload: new TextEncoder().encode(args.text),
  });
  const packet = create!(Proto.Mesh.MeshPacketSchema, {
    to: args.to,
    channel: args.channel,
    wantAck: args.wantAck,
    id: args.id,
    payloadVariant: { case: 'decoded', value: data },
  });
  const msg = create!(Proto.Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: packet },
  });
  return toBinary!(Proto.Mesh.ToRadioSchema, msg);
}

export function encodeToRadio_SendTraceroute(to: number, channel: number, packetId: number): Uint8Array {
  ensureReady();
  const data = create!(Proto.Mesh.DataSchema, {
    portnum: PORTNUM_TRACEROUTE,
    payload: new Uint8Array(0),
    wantResponse: true,
  });
  const packet = create!(Proto.Mesh.MeshPacketSchema, {
    to,
    channel,
    wantAck: true,
    id: packetId,
    payloadVariant: { case: 'decoded', value: data },
  });
  const msg = create!(Proto.Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: packet },
  });
  return toBinary!(Proto.Mesh.ToRadioSchema, msg);
}

export function encodeToRadio_Heartbeat(): Uint8Array {
  ensureReady();
  const heartbeat = create!(Proto.Mesh.HeartbeatSchema, {});
  const msg = create!(Proto.Mesh.ToRadioSchema, {
    payloadVariant: { case: 'heartbeat', value: heartbeat },
  });
  return toBinary!(Proto.Mesh.ToRadioSchema, msg);
}

/**
 * Send our local User (long/short name) so neighbors can label us. The radio
 * accepts this as an admin message wrapped in MeshPacket on the admin port,
 * but newer firmware also accepts a plain ToRadio.setOwner. We use the admin
 * route via SetOwner inside AdminMessage for max compatibility.
 */
const PORTNUM_ADMIN = 6;

export interface LoRaConfigEdit {
  usePreset: boolean;
  modemPreset: number;
  bandwidth: number;
  spreadFactor: number;
  codingRate: number;
  region: number;
  hopLimit: number;
  txEnabled: boolean;
  txPower: number;
  channelNum: number;
  overrideDutyCycle: boolean;
  sx126xRxBoostedGain: boolean;
  overrideFrequency: number;
  ignoreMqtt?: boolean;
}

/**
 * Send a SetConfig admin message to update the radio's LoRa config.
 * The device will typically reboot after applying — reconnect in ~10s.
 *
 * `to` MUST be the radio's own node number. Meshtastic firmware drops admin
 * messages with to=0 (broadcast/unset) — they look like remote admin and fail
 * the local-admin exemption check.
 */
export function encodeToRadio_SetLoraConfig(to: number, lora: LoRaConfigEdit): Uint8Array {
  ensureReady();
  const loraMsg = create!(Proto.Config.Config_LoRaConfigSchema, {
    usePreset: lora.usePreset,
    modemPreset: lora.modemPreset,
    bandwidth: lora.bandwidth,
    spreadFactor: lora.spreadFactor,
    codingRate: lora.codingRate,
    region: lora.region,
    hopLimit: lora.hopLimit,
    txEnabled: lora.txEnabled,
    txPower: lora.txPower,
    channelNum: lora.channelNum,
    overrideDutyCycle: lora.overrideDutyCycle,
    sx126xRxBoostedGain: lora.sx126xRxBoostedGain,
    overrideFrequency: lora.overrideFrequency,
    ignoreMqtt: lora.ignoreMqtt ?? false,
  });
  const config = create!(Proto.Config.ConfigSchema, {
    payloadVariant: { case: 'lora', value: loraMsg },
  });
  const admin = create!(Proto.Admin.AdminMessageSchema, {
    payloadVariant: { case: 'setConfig', value: config },
  });
  const data = create!(Proto.Mesh.DataSchema, {
    portnum: PORTNUM_ADMIN,
    payload: toBinary!(Proto.Admin.AdminMessageSchema, admin),
    wantResponse: false,
  });
  const packet = create!(Proto.Mesh.MeshPacketSchema, {
    to,
    wantAck: false,
    id: (Math.random() * 0xffffffff) >>> 0,
    payloadVariant: { case: 'decoded', value: data },
  });
  const msg = create!(Proto.Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: packet },
  });
  return toBinary!(Proto.Mesh.ToRadioSchema, msg);
}

// Generic admin-message wrapper: takes the variant tag + value, builds the
// AdminMessage + Data + MeshPacket + ToRadio chain. Used by every setConfig
// helper below. `to` MUST be the local node's number (self-admin); the firmware
// drops admin messages addressed to to=0.
function wrapAdminConfig(to: number, variantCase: string, configInner: any): Uint8Array {
  ensureReady();
  const config = create!(Proto.Config.ConfigSchema, {
    payloadVariant: { case: variantCase, value: configInner },
  });
  const admin = create!(Proto.Admin.AdminMessageSchema, {
    payloadVariant: { case: 'setConfig', value: config },
  });
  const data = create!(Proto.Mesh.DataSchema, {
    portnum: PORTNUM_ADMIN,
    payload: toBinary!(Proto.Admin.AdminMessageSchema, admin),
    wantResponse: false,
  });
  const packet = create!(Proto.Mesh.MeshPacketSchema, {
    to,
    wantAck: false,
    id: (Math.random() * 0xffffffff) >>> 0,
    payloadVariant: { case: 'decoded', value: data },
  });
  const msg = create!(Proto.Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: packet },
  });
  return toBinary!(Proto.Mesh.ToRadioSchema, msg);
}

export function encodeToRadio_SetDeviceConfig(to: number, c: DeviceConfigMsg): Uint8Array {
  ensureReady();
  return wrapAdminConfig(to, 'device', create!(Proto.Config.Config_DeviceConfigSchema, c as any));
}
export function encodeToRadio_SetPositionConfig(to: number, c: PositionConfigMsg): Uint8Array {
  ensureReady();
  return wrapAdminConfig(to, 'position', create!(Proto.Config.Config_PositionConfigSchema, c as any));
}
export function encodeToRadio_SetPowerConfig(to: number, c: PowerConfigMsg): Uint8Array {
  ensureReady();
  return wrapAdminConfig(to, 'power', create!(Proto.Config.Config_PowerConfigSchema, c as any));
}
export function encodeToRadio_SetNetworkConfig(to: number, c: NetworkConfigMsg): Uint8Array {
  ensureReady();
  return wrapAdminConfig(to, 'network', create!(Proto.Config.Config_NetworkConfigSchema, c as any));
}
export function encodeToRadio_SetDisplayConfig(to: number, c: DisplayConfigMsg): Uint8Array {
  ensureReady();
  return wrapAdminConfig(to, 'display', create!(Proto.Config.Config_DisplayConfigSchema, c as any));
}
export function encodeToRadio_SetBluetoothConfig(to: number, c: BluetoothConfigMsg): Uint8Array {
  ensureReady();
  return wrapAdminConfig(to, 'bluetooth', create!(Proto.Config.Config_BluetoothConfigSchema, c as any));
}

/**
 * Send a SetModuleConfig (mqtt variant) admin message. Unlike the per-Config
 * setters above, MQTT lives under ModuleConfig — the admin payload variant is
 * `setModuleConfig` rather than `setConfig`.
 *
 * `to` MUST be the radio's own node number; see encodeToRadio_SetLoraConfig.
 */
export function encodeToRadio_SetMqttConfig(to: number, c: MQTTConfigMsg): Uint8Array {
  ensureReady();
  const mapReportSettings = (c.mapReportPublishIntervalSecs || c.mapReportPositionPrecision)
    ? create!(Proto.ModuleConfig.ModuleConfig_MapReportSettingsSchema, {
        publishIntervalSecs: c.mapReportPublishIntervalSecs ?? 0,
        positionPrecision: c.mapReportPositionPrecision ?? 0,
      })
    : undefined;
  const mqttInner = create!(Proto.ModuleConfig.ModuleConfig_MQTTConfigSchema, {
    enabled: c.enabled,
    address: c.address,
    username: c.username,
    password: c.password,
    encryptionEnabled: c.encryptionEnabled,
    jsonEnabled: c.jsonEnabled,
    tlsEnabled: c.tlsEnabled,
    root: c.root,
    proxyToClientEnabled: c.proxyToClientEnabled,
    mapReportingEnabled: c.mapReportingEnabled,
    ...(mapReportSettings ? { mapReportSettings } : {}),
  });
  const moduleConfig = create!(Proto.ModuleConfig.ModuleConfigSchema, {
    payloadVariant: { case: 'mqtt', value: mqttInner },
  });
  const admin = create!(Proto.Admin.AdminMessageSchema, {
    payloadVariant: { case: 'setModuleConfig', value: moduleConfig },
  });
  const data = create!(Proto.Mesh.DataSchema, {
    portnum: PORTNUM_ADMIN,
    payload: toBinary!(Proto.Admin.AdminMessageSchema, admin),
    wantResponse: false,
  });
  const packet = create!(Proto.Mesh.MeshPacketSchema, {
    to,
    wantAck: false,
    id: (Math.random() * 0xffffffff) >>> 0,
    payloadVariant: { case: 'decoded', value: data },
  });
  const msg = create!(Proto.Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: packet },
  });
  return toBinary!(Proto.Mesh.ToRadioSchema, msg);
}

/**
 * Send a SetChannel admin message. Writes a single channel slot (0–7) with the
 * supplied settings + role. The radio applies the change immediately and emits
 * a fresh Channel back; no reboot needed for channel edits.
 *
 * `to` MUST be the radio's own node number; see encodeToRadio_SetLoraConfig.
 */
export function encodeToRadio_SetChannel(to: number, ch: ChannelEdit): Uint8Array {
  ensureReady();
  const settings = create!(Proto.Channel.ChannelSettingsSchema, {
    name: ch.name,
    psk: new Uint8Array(ch.psk),
    uplinkEnabled: ch.uplinkEnabled,
    downlinkEnabled: ch.downlinkEnabled,
  });
  const channel = create!(Proto.Channel.ChannelSchema, {
    index: ch.index,
    role: ch.role,
    settings,
  });
  const admin = create!(Proto.Admin.AdminMessageSchema, {
    payloadVariant: { case: 'setChannel', value: channel },
  });
  const data = create!(Proto.Mesh.DataSchema, {
    portnum: PORTNUM_ADMIN,
    payload: toBinary!(Proto.Admin.AdminMessageSchema, admin),
    wantResponse: false,
  });
  const packet = create!(Proto.Mesh.MeshPacketSchema, {
    to,
    wantAck: false,
    id: (Math.random() * 0xffffffff) >>> 0,
    payloadVariant: { case: 'decoded', value: data },
  });
  const msg = create!(Proto.Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: packet },
  });
  return toBinary!(Proto.Mesh.ToRadioSchema, msg);
}

/**
 * Encode an entire ChannelSet (channels + LoRa config) into the standard
 * meshtastic.org/e/# share URL. Mirrors the upstream "channel URL" format.
 */
export function encodeChannelSetUrl(channels: Array<{ name: string; psk: number[]; uplinkEnabled: boolean; downlinkEnabled: boolean }>, lora: LoRaConfigMsg): string {
  ensureReady();
  const settings = channels.map((c) =>
    create!(Proto.Channel.ChannelSettingsSchema, {
      name: c.name,
      psk: new Uint8Array(c.psk),
      uplinkEnabled: c.uplinkEnabled,
      downlinkEnabled: c.downlinkEnabled,
    }),
  );
  const loraConfig = create!(Proto.Config.Config_LoRaConfigSchema, {
    usePreset: lora.usePreset,
    modemPreset: lora.modemPreset,
    bandwidth: lora.bandwidth,
    spreadFactor: lora.spreadFactor,
    codingRate: lora.codingRate,
    region: lora.region,
    hopLimit: lora.hopLimit,
    txEnabled: lora.txEnabled,
    txPower: lora.txPower,
    channelNum: lora.channelNum,
    overrideDutyCycle: false,
    sx126xRxBoostedGain: lora.sx126xRxBoostedGain,
    overrideFrequency: lora.overrideFrequency,
  });
  const channelSet = create!(Proto.AppOnly.ChannelSetSchema, {
    settings,
    loraConfig,
  });
  const bytes = toBinary!(Proto.AppOnly.ChannelSetSchema, channelSet);
  // base64url (RFC 4648), no padding — same format Meshtastic uses.
  const b64 = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `https://meshtastic.org/e/#${b64}`;
}

/** Decode a meshtastic.org/e/# share URL into its constituent channels + LoRa config. */
export function decodeChannelSetUrl(url: string): { channels: Array<{ name: string; psk: number[]; uplinkEnabled: boolean; downlinkEnabled: boolean }>; lora: LoRaConfigMsg | undefined } | null {
  ensureReady();
  const idx = url.indexOf('#');
  if (idx === -1) return null;
  let b64 = url.slice(idx + 1).trim();
  // Strip any query string after the fragment.
  b64 = b64.split('?')[0].split('&')[0];
  // base64url → standard base64
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  // Re-pad
  while (b64.length % 4) b64 += '=';
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
  let decoded: any;
  try {
    decoded = fromBinary!(Proto.AppOnly.ChannelSetSchema, bytes);
  } catch {
    return null;
  }
  const channels = (decoded.settings ?? []).map((s: any) => ({
    name: s.name ?? '',
    psk: s.psk ? Array.from(s.psk as Uint8Array) : [],
    uplinkEnabled: !!s.uplinkEnabled,
    downlinkEnabled: !!s.downlinkEnabled,
  }));
  const lora = decoded.loraConfig ? mapLoRaConfig(decoded.loraConfig) : undefined;
  return { channels, lora };
}

export function encodeToRadio_SetOwner(to: number, args: { longName: string; shortName: string; }): Uint8Array {
  ensureReady();
  const user = create!(Proto.Mesh.UserSchema, {
    longName: args.longName,
    shortName: args.shortName,
  });
  const admin = create!(Proto.Admin.AdminMessageSchema, {
    payloadVariant: { case: 'setOwner', value: user },
  });
  const data = create!(Proto.Mesh.DataSchema, {
    portnum: PORTNUM_ADMIN,
    payload: toBinary!(Proto.Admin.AdminMessageSchema, admin),
    wantResponse: false,
  });
  const packet = create!(Proto.Mesh.MeshPacketSchema, {
    to,
    wantAck: false,
    id: (Math.random() * 0xffffffff) >>> 0,
    payloadVariant: { case: 'decoded', value: data },
  });
  const msg = create!(Proto.Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: packet },
  });
  return toBinary!(Proto.Mesh.ToRadioSchema, msg);
}
