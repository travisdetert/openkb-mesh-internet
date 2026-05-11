/// <reference types="vite/client" />

declare global {
  type PortConfidence = 'confirmed' | 'likely' | 'possible' | 'unknown';

  interface PortInfo {
    path: string;
    manufacturer?: string;
    vendorId?: string;
    productId?: string;
    description?: string;
    confidence: PortConfidence;
    chipFamily?: string;
  }

  interface MyInfo {
    myNodeNum: number;
    firmwareVersion: string;
    hasWifi: boolean;
    hasBluetooth: boolean;
    maxChannels: number;
  }

  interface LoRaConfig {
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

  interface MeshChannel {
    index: number;
    role: number;
    roleName: string;
    name: string;
    pskLength: number;
    uplinkEnabled: boolean;
    downlinkEnabled: boolean;
  }

  interface DeviceConfig {
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
  interface PositionConfig {
    positionBroadcastSecs: number;
    positionBroadcastSmartEnabled: boolean;
    fixedPosition: boolean;
    gpsUpdateInterval: number;
    positionFlags: number;
    gpsMode: number;
    broadcastSmartMinimumDistance: number;
    broadcastSmartMinimumIntervalSecs: number;
  }
  interface PowerConfig {
    isPowerSaving: boolean;
    onBatteryShutdownAfterSecs: number;
    adcMultiplierOverride: number;
    waitBluetoothSecs: number;
    sdsSecs: number;
    lsSecs: number;
    minWakeSecs: number;
  }
  interface NetworkConfig {
    wifiEnabled: boolean;
    wifiSsid: string;
    wifiPsk: string;
    ntpServer: string;
    ethEnabled: boolean;
    addressMode: number;
    rsyslogServer: string;
  }
  interface DisplayConfig {
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
  interface BluetoothConfig {
    enabled: boolean;
    mode: number;
    fixedPin: number;
  }

  interface ConnectionState {
    status: 'disconnected' | 'connecting' | 'configuring' | 'ready';
    portPath?: string;
    myInfo?: MyInfo;
    loraConfig?: LoRaConfig;
    deviceConfig?: DeviceConfig;
    positionConfig?: PositionConfig;
    powerConfig?: PowerConfig;
    networkConfig?: NetworkConfig;
    displayConfig?: DisplayConfig;
    bluetoothConfig?: BluetoothConfig;
    channels?: MeshChannel[];
    error?: string;
  }

  interface NodeRecord {
    num: number;
    id?: string;
    longName: string;
    shortName: string;
    macaddr: string;
    hwModel: number;
    hwModelName: string;
    role?: number;
    lat?: number;
    lon?: number;
    altitude?: number;
    /** Position precision in bits (Meshtastic Position.precision_bits). 0/undefined = full precision. */
    posPrecisionBits?: number;
    batteryLevel?: number;
    voltage?: number;
    channelUtilization?: number;
    airUtilTx?: number;
    lastHeard?: number;
    snr?: number;
    rssi?: number;
    hopsAway?: number;
    channel?: number;
    viaMqtt?: boolean;
    isFavorite?: boolean;
    firstHeard: number;
    packetCount: number;
  }

  interface TextMessage {
    id: number;
    from: number;
    to: number;
    channel: number;
    text: string;
    rxTime: number;
    rxRssi: number;
    rxSnr: number;
    hopStart: number;
    hopLimit: number;
    /** 'received' for inbound; 'pending'/'acked'/'failed' for our sends. */
    ackStatus?: 'received' | 'pending' | 'acked' | 'failed';
    /** When failed, the Meshtastic Routing.Error code. 3 = TIMEOUT (also used for our local 60s timer). */
    ackError?: number;
    sentAt?: number;
  }

  interface MeshPacketLite {
    from: number;
    to: number;
    id: number;
    channel: number;
    hopLimit: number;
    hopStart: number;
    rxTime: number;
    rxSnr: number;
    rxRssi: number;
    viaMqtt?: boolean;
    portnum?: number;
    encrypted?: boolean;
    requestId?: number;
    text?: string;
    position?: { lat: number; lon: number; altitude: number; time: number; precisionBits?: number };
    nodeInfo?: { id?: string; longName: string; shortName: string; hwModel: number; macaddr: string; role?: number };
    telemetry?: { batteryLevel?: number; voltage?: number; channelUtilization?: number; airUtilTx?: number; uptimeSeconds?: number; temperature?: number; humidity?: number };
    routing?: { errorReason: number };
    traceroute?: { route: number[] };
  }

  interface TelemetrySample {
    nodeId: number;
    timestamp: number;
    channelUtilization: number;
    airUtilTx: number;
    batteryLevel: number;
    voltage: number;
  }

  interface TracerouteSent {
    packetId: number;
    to: number;
    sentAt: number;
  }

  interface TracerouteResponse {
    from: number;
    to: number;
    route: number[];
    rxRssi: number;
    rxSnr: number;
    hopStart: number;
    hopLimit: number;
    receivedAt: number;
  }

  interface DbStats {
    nodes: number;
    positions: number;
    telemetry: number;
    messages: number;
    packets: number;
    traceroutes: number;
    links: number;
    dbPath: string;
  }

  interface PathLossSample {
    fromNum: number;
    rssi: number;
    snr: number;
    hopsAway: number;
    lat: number;
    lon: number;
    ts: number;
  }

  interface TelemetryHistoryRow {
    node_num: number;
    battery: number;
    voltage: number;
    chan_util: number;
    air_util_tx: number;
    ts: number;
  }

  interface LinkRow {
    a_num: number;
    b_num: number;
    rssi_min: number;
    rssi_max: number;
    snr_avg: number;
    count: number;
    last_ts: number;
  }

  type TraceEventKind = 'sent' | 'echo' | 'relay' | 'ack' | 'nak' | 'timeout';
  interface TraceEvent {
    ts: number;
    kind: TraceEventKind;
    fromNode?: number;
    rssi?: number;
    snr?: number;
    hopStart?: number;
    hopLimit?: number;
    errorReason?: number;
  }
  interface PacketTrace {
    packetId: number;
    from: number;
    to: number;
    channel: number;
    text?: string;
    wantAck: boolean;
    sentAt: number;
    finalStatus: 'pending' | 'acked' | 'failed';
    events: TraceEvent[];
  }

  interface LoRaConfigEdit {
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

  interface MeshAPI {
    listPorts: () => Promise<PortInfo[]>;
    connect: (portPath: string) => Promise<void>;
    disconnect: () => Promise<void>;
    getState: () => Promise<ConnectionState>;
    getNodes: () => Promise<NodeRecord[]>;
    getMessages: () => Promise<TextMessage[]>;
    sendText: (args: { text: string; to?: number; channel?: number; wantAck?: boolean }) => Promise<TextMessage>;
    sendTraceroute: (args: { to: number; channel?: number }) => Promise<{ packetId: number; sentAt: number }>;
    setOwner: (args: { longName: string; shortName: string }) => Promise<void>;
    setLoraConfig:      (args: LoRaConfigEdit) => Promise<void>;
    setDeviceConfig:    (args: DeviceConfig) => Promise<void>;
    setPositionConfig:  (args: PositionConfig) => Promise<void>;
    setPowerConfig:     (args: PowerConfig) => Promise<void>;
    setNetworkConfig:   (args: NetworkConfig) => Promise<void>;
    setDisplayConfig:   (args: DisplayConfig) => Promise<void>;
    setBluetoothConfig: (args: BluetoothConfig) => Promise<void>;
    dbStats: () => Promise<DbStats>;
    pathLossSamples: (args?: { sinceMs?: number }) => Promise<PathLossSample[]>;
    telemetryHistory: (args?: { sinceMs?: number }) => Promise<TelemetryHistoryRow[]>;
    links: () => Promise<LinkRow[]>;
    getTraces: () => Promise<PacketTrace[]>;
    onState: (cb: (s: ConnectionState) => void) => () => void;
    onNode: (cb: (n: NodeRecord) => void) => () => void;
    onMessage: (cb: (m: TextMessage) => void) => () => void;
    onMessageStatus: (cb: (m: TextMessage) => void) => () => void;
    onPacket: (cb: (p: MeshPacketLite) => void) => () => void;
    onTelemetrySample: (cb: (s: TelemetrySample) => void) => () => void;
    onTracerouteSent: (cb: (t: TracerouteSent) => void) => () => void;
    onTracerouteResponse: (cb: (t: TracerouteResponse) => void) => () => void;
    onTraceUpdate: (cb: (t: PacketTrace) => void) => () => void;
  }

  interface Window {
    mesh: MeshAPI;
  }
}

export {};
