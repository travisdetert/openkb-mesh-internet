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
    /** Raw PSK bytes (0–32). Empty = open channel; 1 byte = default key. */
    psk: number[];
    uplinkEnabled: boolean;
    downlinkEnabled: boolean;
  }

  interface ChannelEdit {
    index: number;
    role: number;
    name: string;
    psk: number[];
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
  interface MQTTConfig {
    enabled: boolean;
    address: string;
    username: string;
    password: string;
    encryptionEnabled: boolean;
    jsonEnabled: boolean;
    tlsEnabled: boolean;
    root: string;
    proxyToClientEnabled: boolean;
    mapReportingEnabled: boolean;
    mapReportPublishIntervalSecs?: number;
    mapReportPositionPrecision?: number;
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
    mqttConfig?: MQTTConfig;
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

  interface ConnectionSummary {
    connId: string;
    state: ConnectionState;
    portPath?: string;
  }

  interface MeshAPI {
    listPorts: () => Promise<PortInfo[]>;
    listConnections: () => Promise<ConnectionSummary[]>;
    /** Returns the newly-opened connection's id. */
    connect: (portPath: string) => Promise<string>;
    disconnect: (connId: string) => Promise<void>;

    getState: (connId: string) => Promise<ConnectionState | null>;
    getNodes: (connId: string) => Promise<NodeRecord[]>;
    getMessages: (connId: string) => Promise<TextMessage[]>;
    getTraces: (connId: string) => Promise<PacketTrace[]>;

    sendText: (args: { connId: string; text: string; to?: number; channel?: number; wantAck?: boolean }) => Promise<TextMessage>;
    sendTraceroute: (args: { connId: string; to: number; channel?: number }) => Promise<{ packetId: number; sentAt: number }>;
    setOwner: (args: { connId: string; longName: string; shortName: string }) => Promise<void>;
    setLoraConfig:      (args: { connId: string; config: LoRaConfigEdit }) => Promise<void>;
    setDeviceConfig:    (args: { connId: string; config: DeviceConfig }) => Promise<void>;
    setPositionConfig:  (args: { connId: string; config: PositionConfig }) => Promise<void>;
    setPowerConfig:     (args: { connId: string; config: PowerConfig }) => Promise<void>;
    setNetworkConfig:   (args: { connId: string; config: NetworkConfig }) => Promise<void>;
    setDisplayConfig:   (args: { connId: string; config: DisplayConfig }) => Promise<void>;
    setBluetoothConfig: (args: { connId: string; config: BluetoothConfig }) => Promise<void>;
    setMqttConfig:      (args: { connId: string; config: MQTTConfig }) => Promise<void>;
    setChannel:         (args: { connId: string; channel: ChannelEdit }) => Promise<void>;
    getChannelSetUrl:   (connId: string) => Promise<string | null>;
    applyChannelSetUrl: (args: { connId: string; url: string }) => Promise<boolean>;
    /** Ask the radio to redump its nodeDB now (in addition to the 15-min auto-refresh). */
    refresh:            (connId: string) => Promise<void>;
    /** Timestamp (ms epoch) of the last completed nodeDB refresh, or 0. */
    lastRefreshAt:      (connId: string) => Promise<number>;
    /** Auto-connect to confirmed Meshtastic USB devices as they appear. */
    getAutoConnect:     () => Promise<boolean>;
    setAutoConnect:     (enabled: boolean) => Promise<void>;
    /** Serial port counters for the Device Lab panel. */
    getPortStats:       (connId: string) => Promise<PortStats | null>;
    /** Drive USB-serial control lines to reset / enter bootloader. */
    resetDevice:        (args: { connId: string; profile: ResetProfile }) => Promise<void>;

    dbStats: () => Promise<DbStats>;
    pathLossSamples: (args?: { connId?: string; sinceMs?: number }) => Promise<PathLossSample[]>;
    telemetryHistory: (args?: { sinceMs?: number }) => Promise<TelemetryHistoryRow[]>;
    links: () => Promise<LinkRow[]>;

    onState: (cb: (p: { connId: string; state: ConnectionState }) => void) => () => void;
    onNode: (cb: (p: { connId: string; node: NodeRecord }) => void) => () => void;
    onMessage: (cb: (p: { connId: string; message: TextMessage }) => void) => () => void;
    onMessageStatus: (cb: (p: { connId: string; message: TextMessage }) => void) => () => void;
    onPacket: (cb: (p: { connId: string; packet: MeshPacketLite }) => void) => () => void;
    onTelemetrySample: (cb: (p: { connId: string; sample: TelemetrySample }) => void) => () => void;
    onTracerouteSent: (cb: (p: { connId: string; trace: TracerouteSent }) => void) => () => void;
    onTracerouteResponse: (cb: (p: { connId: string; response: TracerouteResponse }) => void) => () => void;
    onTraceUpdate: (cb: (p: { connId: string; trace: PacketTrace }) => void) => () => void;
    onConnectionAdded: (cb: (p: { connId: string; portPath: string }) => void) => () => void;
    onConnectionRemoved: (cb: (p: { connId: string }) => void) => () => void;
    onSerialRaw: (cb: (p: { connId: string; direction: 'rx' | 'tx'; at: number; bytes: string }) => void) => () => void;
    onSerialEvent: (cb: (p: { connId: string; event: SerialEvent }) => void) => () => void;
  }

  type ResetProfile = 'esp32' | 'esp32-bootloader' | 'nrf52-dfu' | 'rp2040-bootsel';
  interface PortStats {
    openedAt: number | null;
    lastDataAt: number | null;
    bytesIn: number;
    bytesOut: number;
    framesIn: number;
    framesOut: number;
    framesCorrupt: number;
    errorCount: number;
    reconnectCount: number;
  }
  interface SerialEvent {
    at: number;
    kind: 'open' | 'close' | 'reconnect-attempt' | 'reconnect-ok' | 'error' | 'reset' | 'frame-corrupt' | 'note';
    detail?: string;
  }

  interface Window {
    mesh: MeshAPI;
  }
}

export {};
