import { EventEmitter } from 'events';
import { MeshtasticSerialConnection, PortInfo } from './serial-connection';
import {
  decodeFromRadio,
  encodeToRadio_WantConfig,
  encodeToRadio_SendText,
  encodeToRadio_SendTraceroute,
  encodeToRadio_Heartbeat,
  encodeToRadio_SetOwner,
  encodeToRadio_SetLoraConfig,
  encodeToRadio_SetDeviceConfig,
  encodeToRadio_SetPositionConfig,
  encodeToRadio_SetPowerConfig,
  encodeToRadio_SetNetworkConfig,
  encodeToRadio_SetDisplayConfig,
  encodeToRadio_SetBluetoothConfig,
  encodeToRadio_SetMqttConfig,
  encodeToRadio_SetChannel,
  encodeChannelSetUrl,
  decodeChannelSetUrl,
  ChannelEdit,
  LoRaConfigEdit,
  MyInfo,
  NodeInfo,
  MeshPacket,
  LoRaConfigMsg,
  ChannelMsg,
  DeviceConfigMsg,
  PositionConfigMsg,
  PowerConfigMsg,
  NetworkConfigMsg,
  DisplayConfigMsg,
  BluetoothConfigMsg,
  MQTTConfigMsg,
} from './protobuf-codec';
import { lookupHwModel } from './device-database';
import { MeshDatabase } from '../database';

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'configuring' | 'ready';
  portPath?: string;
  myInfo?: MyInfo;
  loraConfig?: LoRaConfigMsg;
  deviceConfig?: DeviceConfigMsg;
  positionConfig?: PositionConfigMsg;
  powerConfig?: PowerConfigMsg;
  networkConfig?: NetworkConfigMsg;
  displayConfig?: DisplayConfigMsg;
  bluetoothConfig?: BluetoothConfigMsg;
  mqttConfig?: MQTTConfigMsg;
  channels?: ChannelMsg[];
  error?: string;
}

export interface NodeRecord extends NodeInfo {
  hwModelName: string;
  rssi?: number;
  snr?: number;
  hopsAway?: number;
  firstHeard: number;
  packetCount: number;
}

export interface TextMessage {
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
  /** Outgoing-only: ack lifecycle. 'received' for inbound, 'pending'/'acked'/'failed' for our sends. */
  ackStatus?: 'received' | 'pending' | 'acked' | 'failed';
  /** Outgoing-only: when failed, the meshtastic Routing.errorReason number (3 = local timeout). */
  ackError?: number;
  /** Outgoing-only: timestamp we handed it to the radio (ms). */
  sentAt?: number;
}

export interface RawPacketEvent {
  rawBytes: Uint8Array;
  decoded: MeshPacket;
  receivedAt: number;
}

export type TraceEventKind = 'sent' | 'echo' | 'relay' | 'ack' | 'nak' | 'timeout';

export interface TraceEvent {
  ts: number;
  kind: TraceEventKind;
  fromNode?: number;
  rssi?: number;
  snr?: number;
  hopStart?: number;
  hopLimit?: number;
  errorReason?: number;
}

export interface PacketTrace {
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

const BROADCAST_ADDR = 0xffffffff;

interface PendingSend {
  id: number;
  message: TextMessage;
  timeout: NodeJS.Timeout;
}

const HEARTBEAT_MS = 5 * 60 * 1000;
const ACK_TIMEOUT_MS = 60 * 1000;
const RECONNECT_RECONFIG_DELAY_MS = 500;
/**
 * How often to ask the radio for a fresh nodeDB dump. Meshtastic's design is
 * push-only — peers' NodeInfo arrives when *they* decide to broadcast (~3 hr
 * default), and our app sits passively in between. A periodic re-sync catches
 * cases where the radio's USB stream stalls silently or where peers were heard
 * while our local state drifted. 15 minutes is a balance between freshness
 * and not flooding ourselves with redundant NodeInfo replays.
 */
const NODE_REFRESH_MS = 15 * 60 * 1000;

export class MeshtasticController extends EventEmitter {
  private conn: MeshtasticSerialConnection;
  private state: ConnectionState = { status: 'disconnected' };
  private nodes = new Map<number, NodeRecord>();
  private messages: TextMessage[] = [];
  private packetLog: RawPacketEvent[] = [];
  private maxPacketLog = 500;
  private db: MeshDatabase | null;
  private pending = new Map<number, PendingSend>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private nodeRefreshTimer: NodeJS.Timeout | null = null;
  /** Wall-clock time (ms) of the last completed nodeDB resync. */
  private lastRefreshAt: number = 0;
  private outQueue: Uint8Array[] = [];
  private outFlushScheduled = false;
  /** In-memory ring of recent outgoing packet traces, keyed by packetId. */
  private traces = new Map<number, PacketTrace>();
  private maxTraces = 100;

  constructor(db: MeshDatabase | null = null) {
    super();
    this.db = db;
    this.conn = new MeshtasticSerialConnection();
    this.conn.onFromRadio((bytes) => this.handleFromRadio(bytes));
    this.conn.onDisconnect(() => {
      this.stopHeartbeat();
      this.stopNodeRefresh();
      this.setState({ status: 'disconnected' });
    });
    this.conn.onReconnect(() => {
      // Serial reopened on its own — re-run the want_config handshake so the
      // radio resends nodeDB / config / channels.
      setTimeout(() => this.requestConfig(), RECONNECT_RECONFIG_DELAY_MS);
    });
    this.conn.onError((err) => this.setState({ ...this.state, error: err.message }));
    // Forward Device Lab telemetry up to the manager which broadcasts via IPC.
    this.conn.onRaw((chunk, direction) => this.emit('serial-raw', { chunk, direction }));
    this.conn.onEvent((evt) => this.emit('serial-event', evt));

    // Hydrate messages from the shared DB so the chat history is visible
    // pre-connect. We intentionally do NOT hydrate nodes from the DB: that
    // would seed every controller with the union of nodes that every radio
    // in the app has ever heard, making each per-radio nodeDB count
    // identical and meaningless. Each controller's nodes are built up
    // strictly from its own wantConfig handshake + live packets, so
    // `getNodes()` reflects what *this* radio actually knows.
    if (this.db) {
      const recentMsgs = this.db.getRecentMessages(200);
      this.messages = recentMsgs.map((m) => ({
        id: m.id, from: m.from_num, to: m.to_num, channel: m.channel, text: m.text,
        rxTime: Math.floor(m.ts / 1000), rxRssi: m.rssi, rxSnr: m.snr,
        hopStart: m.hop_start, hopLimit: m.hop_limit,
      }));
    }
  }

  static listPorts(): Promise<PortInfo[]> {
    return MeshtasticSerialConnection.listPorts();
  }

  getState(): ConnectionState {
    return this.state;
  }

  getNodes(): NodeRecord[] {
    return Array.from(this.nodes.values()).sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0));
  }

  getMessages(): TextMessage[] {
    return [...this.messages];
  }

  getPacketLog(): RawPacketEvent[] {
    return [...this.packetLog];
  }

  getTraces(): PacketTrace[] {
    return Array.from(this.traces.values()).sort((a, b) => b.sentAt - a.sentAt);
  }

  getPortStats() {
    return this.conn.getStats();
  }

  resetDevice(profile: import('./serial-connection').ResetProfile): Promise<void> {
    return this.conn.resetDevice(profile);
  }

  private appendTraceEvent(packetId: number, ev: TraceEvent): void {
    const t = this.traces.get(packetId);
    if (!t) return;
    t.events.push(ev);
    if (ev.kind === 'ack') t.finalStatus = 'acked';
    if (ev.kind === 'nak' || ev.kind === 'timeout') t.finalStatus = 'failed';
    this.emit('trace-update', t);
  }

  private startTrace(t: PacketTrace): void {
    this.traces.set(t.packetId, t);
    // Trim oldest beyond the cap
    if (this.traces.size > this.maxTraces) {
      const sorted = Array.from(this.traces.entries()).sort((a, b) => a[1].sentAt - b[1].sentAt);
      const drop = this.traces.size - this.maxTraces;
      for (let i = 0; i < drop; i++) this.traces.delete(sorted[i][0]);
    }
    this.emit('trace-update', t);
  }

  async connect(portPath: string): Promise<void> {
    this.setState({ status: 'connecting', portPath });
    await this.conn.connect(portPath);
    this.setState({ status: 'configuring', portPath });
    this.requestConfig();
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.stopNodeRefresh();
    await this.conn.disconnect();
    this.setState({ status: 'disconnected' });
  }

  private requestConfig(): void {
    const configId = (Math.random() * 0xffffffff) >>> 0;
    this.enqueueToRadio(encodeToRadio_WantConfig(configId));
    this.lastRefreshAt = Date.now();
  }

  /** Public: ask the radio to redump its nodeDB now. Used by the Refresh button. */
  refresh(): void {
    console.log('[controller] manual refresh requested');
    this.requestConfig();
  }

  /** When was the most recent nodeDB resync (manual or scheduled)? Wall-clock ms. */
  getLastRefreshAt(): number {
    return this.lastRefreshAt;
  }

  private startNodeRefresh(): void {
    this.stopNodeRefresh();
    this.nodeRefreshTimer = setInterval(() => {
      if (this.state.status !== 'ready') return;
      console.log('[controller] scheduled nodeDB refresh');
      this.requestConfig();
    }, NODE_REFRESH_MS);
  }

  private stopNodeRefresh(): void {
    if (this.nodeRefreshTimer) {
      clearInterval(this.nodeRefreshTimer);
      this.nodeRefreshTimer = null;
    }
  }

  /**
   * Send a text message. The radio assigns reception delivery, but we pick the
   * packet id locally so we can match the eventual Routing-ack back to it.
   */
  sendText(text: string, opts: { to?: number; channel?: number; wantAck?: boolean } = {}): TextMessage {
    const to = opts.to ?? BROADCAST_ADDR;
    const channel = opts.channel ?? 0;
    // Default wantAck=true for DMs (anything not broadcast). Broadcasts use
    // implicit acks which we don't track per-recipient.
    const wantAck = opts.wantAck ?? (to !== BROADCAST_ADDR);
    const id = (Math.random() * 0xffffffff) >>> 0;
    const myNum = this.state.myInfo?.myNodeNum ?? 0;
    const now = Date.now();

    const local: TextMessage = {
      id,
      from: myNum,
      to,
      channel,
      text,
      rxTime: Math.floor(now / 1000),
      rxRssi: 0,
      rxSnr: 0,
      hopStart: 0,
      hopLimit: 0,
      ackStatus: wantAck ? 'pending' : 'acked',
      sentAt: now,
    };
    this.messages.push(local);
    this.emit('message', local);

    if (this.db) {
      this.db.insertMessage({
        id, fromNum: myNum, toNum: to, channel,
        text, rssi: 0, snr: 0, hopStart: 0, hopLimit: 0, ts: now,
      });
    }

    // Start a trace so the Delivery panel can show propagation in real time.
    this.startTrace({
      packetId: id, from: myNum, to, channel, text, wantAck,
      sentAt: now, finalStatus: 'pending',
      events: [{ ts: now, kind: 'sent' }],
    });

    this.enqueueToRadio(encodeToRadio_SendText({ text, to, channel, wantAck, id }));

    if (wantAck) {
      const timeout = setTimeout(() => this.failPending(id, 'timeout'), ACK_TIMEOUT_MS);
      this.pending.set(id, { id, message: local, timeout });
    }
    return local;
  }

  /**
   * Local-admin messages MUST be addressed to the radio's own node number,
   * not to=0 (broadcast/unset). The firmware drops admin packets that don't
   * pass the local-admin exemption check, and `to=0` doesn't pass.
   */
  private myNumForAdmin(): number | null {
    const my = this.state.myInfo?.myNodeNum;
    if (!my) {
      console.warn('[controller] admin send dropped — myNodeNum not yet known. Wait for the radio to finish syncing.');
      return null;
    }
    return my;
  }

  setOwner(longName: string, shortName: string): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetOwner(to, { longName, shortName }));
  }

  setLoraConfig(lora: LoRaConfigEdit): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetLoraConfig(to, lora));
  }
  setDeviceConfig(c: DeviceConfigMsg): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetDeviceConfig(to, c));
  }
  setPositionConfig(c: PositionConfigMsg): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetPositionConfig(to, c));
  }
  setPowerConfig(c: PowerConfigMsg): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetPowerConfig(to, c));
  }
  setNetworkConfig(c: NetworkConfigMsg): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetNetworkConfig(to, c));
  }
  setDisplayConfig(c: DisplayConfigMsg): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetDisplayConfig(to, c));
  }
  setBluetoothConfig(c: BluetoothConfigMsg): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetBluetoothConfig(to, c));
  }
  setMqttConfig(c: MQTTConfigMsg): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetMqttConfig(to, c));
  }
  setChannel(c: ChannelEdit): void {
    const to = this.myNumForAdmin(); if (!to) return;
    this.enqueueToRadio(encodeToRadio_SetChannel(to, c));
  }
  /**
   * Build the standard meshtastic.org/e/# URL for the current channel set +
   * LoRa config. Returns null if either is missing.
   */
  getChannelSetUrl(): string | null {
    if (!this.state.loraConfig || !this.state.channels) return null;
    const settings = this.state.channels
      .filter((c) => c.role !== 0)
      .map((c) => ({ name: c.name, psk: c.psk, uplinkEnabled: c.uplinkEnabled, downlinkEnabled: c.downlinkEnabled }));
    return encodeChannelSetUrl(settings, this.state.loraConfig);
  }
  /** Apply a parsed channel-set URL: writes each channel + LoRa config to the radio. */
  applyChannelSetUrl(url: string): boolean {
    const parsed = decodeChannelSetUrl(url);
    if (!parsed) return false;
    const to = this.myNumForAdmin(); if (!to) return false;
    parsed.channels.forEach((c, i) => {
      this.enqueueToRadio(encodeToRadio_SetChannel(to, {
        index: i,
        role: i === 0 ? 1 : 2,
        name: c.name,
        psk: c.psk,
        uplinkEnabled: c.uplinkEnabled,
        downlinkEnabled: c.downlinkEnabled,
      }));
    });
    if (parsed.lora) {
      this.enqueueToRadio(encodeToRadio_SetLoraConfig(to, {
        usePreset: parsed.lora.usePreset,
        modemPreset: parsed.lora.modemPreset,
        bandwidth: parsed.lora.bandwidth,
        spreadFactor: parsed.lora.spreadFactor,
        codingRate: parsed.lora.codingRate,
        region: parsed.lora.region,
        hopLimit: parsed.lora.hopLimit,
        txEnabled: parsed.lora.txEnabled,
        txPower: parsed.lora.txPower,
        channelNum: parsed.lora.channelNum,
        overrideDutyCycle: false,
        sx126xRxBoostedGain: parsed.lora.sx126xRxBoostedGain,
        overrideFrequency: parsed.lora.overrideFrequency,
      }));
    }
    return true;
  }

  // ── Outbound queue ────────────────────────────────────────────────────────
  // Tiny FIFO so a burst of UI sends doesn't outrun the radio's USB buffer.
  // We flush one frame per microtask; the radio's own queue depth handles the
  // air-side timing.
  private enqueueToRadio(bytes: Uint8Array): void {
    this.outQueue.push(bytes);
    if (this.outFlushScheduled) return;
    this.outFlushScheduled = true;
    queueMicrotask(() => this.flushOutQueue());
  }

  private flushOutQueue(): void {
    this.outFlushScheduled = false;
    while (this.outQueue.length > 0) {
      const next = this.outQueue.shift()!;
      this.conn.sendToRadio(next);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      try { this.enqueueToRadio(encodeToRadio_Heartbeat()); } catch { /* ignore */ }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Mark a pending send failed. `reason` is either 'timeout' (our 60-second
   * client-side timer) or a Meshtastic Routing.Error code from the radio.
   */
  private failPending(id: number, reason: 'timeout' | number): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.pending.delete(id);
    entry.message.ackStatus = 'failed';
    // Routing.Error.TIMEOUT is 3 — reuse it for our local timeout so the renderer
    // doesn't need to special-case anything.
    entry.message.ackError = reason === 'timeout' ? 3 : reason;
    this.emit('message-status', entry.message);
    // Mirror to trace if not already recorded (an explicit nak appends 'nak'
    // earlier; this only fires for our local 60s timeout).
    if (reason === 'timeout' && this.traces.has(id)) {
      this.appendTraceEvent(id, { ts: Date.now(), kind: 'timeout', errorReason: 3 });
    }
  }

  private resolvePending(id: number): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.pending.delete(id);
    entry.message.ackStatus = 'acked';
    this.emit('message-status', entry.message);
  }

  sendTraceroute(to: number, channel: number = 0): { packetId: number; sentAt: number } {
    const packetId = (Math.random() * 0xffffffff) >>> 0;
    const sentAt = Date.now();
    this.enqueueToRadio(encodeToRadio_SendTraceroute(to, channel, packetId));
    this.emit('traceroute-sent', { packetId, to, sentAt });
    if (this.db) {
      const myNum = this.state.myInfo?.myNodeNum ?? 0;
      this.db.insertTracerouteRequest(packetId, myNum, to, sentAt);
    }
    return { packetId, sentAt };
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    this.emit('state', next);
  }

  private handleFromRadio(bytes: Uint8Array): void {
    const msg = decodeFromRadio(bytes);

    switch (msg.type) {
      case 'my_info':
        if (msg.myInfo) {
          this.setState({ ...this.state, myInfo: msg.myInfo });
        }
        break;

      case 'node_info':
        if (msg.nodeInfo) this.upsertNode(msg.nodeInfo);
        break;

      case 'config': {
        const patch: Partial<ConnectionState> = {};
        if (msg.loraConfig) patch.loraConfig = msg.loraConfig;
        if (msg.deviceConfig) patch.deviceConfig = msg.deviceConfig;
        if (msg.positionConfig) patch.positionConfig = msg.positionConfig;
        if (msg.powerConfig) patch.powerConfig = msg.powerConfig;
        if (msg.networkConfig) patch.networkConfig = msg.networkConfig;
        if (msg.displayConfig) patch.displayConfig = msg.displayConfig;
        if (msg.bluetoothConfig) patch.bluetoothConfig = msg.bluetoothConfig;
        if (msg.mqttConfig) patch.mqttConfig = msg.mqttConfig;
        if (Object.keys(patch).length > 0) this.setState({ ...this.state, ...patch });
        break;
      }

      case 'channel':
        if (msg.channel) {
          const channels = [...(this.state.channels ?? [])];
          const idx = channels.findIndex((c) => c.index === msg.channel!.index);
          if (idx >= 0) channels[idx] = msg.channel;
          else channels.push(msg.channel);
          channels.sort((a, b) => a.index - b.index);
          this.setState({ ...this.state, channels });
        }
        break;

      case 'config_complete':
        this.setState({ ...this.state, status: 'ready' });
        this.startHeartbeat();
        this.startNodeRefresh();
        this.lastRefreshAt = Date.now();
        break;

      case 'packet':
        if (msg.packet) this.handlePacket(msg.packet, bytes);
        break;
    }
  }

  private upsertNode(info: NodeInfo): void {
    const existing = this.nodes.get(info.num);
    const now = Math.floor(Date.now() / 1000);
    const merged: NodeRecord = {
      ...(existing ?? {
        firstHeard: now,
        packetCount: 0,
        hwModelName: lookupHwModel(info.hwModel),
      }),
      ...info,
      hwModelName: lookupHwModel(info.hwModel),
    };
    this.nodes.set(info.num, merged);
    this.emit('node', merged);

    if (this.db) {
      const ts = Date.now();
      this.db.upsertNode(info.num, info.longName ?? '', info.shortName ?? '', info.hwModel ?? 0, ts);
      if (info.lat !== undefined && info.lon !== undefined && (info.lat !== 0 || info.lon !== 0)) {
        this.db.insertPosition(info.num, info.lat, info.lon, info.altitude ?? 0, ts);
      }
      if (info.batteryLevel !== undefined || info.voltage !== undefined ||
          info.channelUtilization !== undefined || info.airUtilTx !== undefined) {
        this.db.insertDeviceTelemetry(
          info.num,
          info.batteryLevel ?? 0,
          info.voltage ?? 0,
          info.channelUtilization ?? 0,
          info.airUtilTx ?? 0,
          ts,
        );
      }
    }
  }

  private handlePacket(pkt: MeshPacket, raw: Uint8Array): void {
    const now = Date.now();

    this.packetLog.push({ rawBytes: raw, decoded: pkt, receivedAt: now });
    if (this.packetLog.length > this.maxPacketLog) this.packetLog.shift();
    this.emit('packet', pkt);

    // Trace echo/relay: if this packet shares an id with one we recently sent,
    // it's either the radio echoing our own TX (from === me) or another node
    // rebroadcasting (implicit ack — they heard us and are spreading our packet).
    if (pkt.id && this.traces.has(pkt.id)) {
      const myNum = this.state.myInfo?.myNodeNum ?? 0;
      if (pkt.from === myNum) {
        this.appendTraceEvent(pkt.id, { ts: now, kind: 'echo' });
      } else {
        this.appendTraceEvent(pkt.id, {
          ts: now, kind: 'relay',
          fromNode: pkt.from,
          rssi: pkt.rxRssi,
          snr: pkt.rxSnr,
          hopStart: pkt.hopStart,
          hopLimit: pkt.hopLimit,
        });
      }
    }

    if (this.db) {
      this.db.insertPacket({
        id: pkt.id, fromNum: pkt.from, toNum: pkt.to, portnum: pkt.portnum ?? 0,
        rssi: pkt.rxRssi, snr: pkt.rxSnr,
        hopStart: pkt.hopStart, hopLimit: pkt.hopLimit, ts: now,
      });
      this.db.touchNodeLastSeen(pkt.from, now);
      const myNum = this.state.myInfo?.myNodeNum;
      if (myNum && (pkt.hopStart - pkt.hopLimit) === 0 && pkt.rxRssi !== 0) {
        // Direct (hop 0) reception → record link between our node and sender
        this.db.observeLink(myNum, pkt.from, pkt.rxRssi, pkt.rxSnr, now);
      }
    }

    const node = this.nodes.get(pkt.from);
    if (node) {
      node.packetCount += 1;
      node.lastHeard = Math.floor(now / 1000);
      if (pkt.rxRssi !== 0) node.rssi = pkt.rxRssi;
      if (pkt.rxSnr !== 0) node.snr = pkt.rxSnr;
      if (pkt.hopStart && pkt.hopLimit) node.hopsAway = pkt.hopStart - pkt.hopLimit;
      this.nodes.set(pkt.from, node);
      this.emit('node', node);
    }

    if (pkt.text) {
      // Skip echoes of our own outgoing message (same id, from us). The local
      // copy was already added in sendText().
      const myNum = this.state.myInfo?.myNodeNum ?? 0;
      const isOwnEcho = pkt.from === myNum && this.messages.some((m) => m.id === pkt.id && m.from === myNum);
      if (!isOwnEcho) {
        const tm: TextMessage = {
          id: pkt.id,
          from: pkt.from,
          to: pkt.to,
          channel: pkt.channel,
          text: pkt.text,
          rxTime: pkt.rxTime,
          rxRssi: pkt.rxRssi,
          rxSnr: pkt.rxSnr,
          hopStart: pkt.hopStart,
          hopLimit: pkt.hopLimit,
          ackStatus: 'received',
        };
        this.messages.push(tm);
        this.emit('message', tm);
        if (this.db) {
          this.db.insertMessage({
            id: tm.id, fromNum: tm.from, toNum: tm.to, channel: tm.channel,
            text: tm.text, rssi: tm.rxRssi, snr: tm.rxSnr,
            hopStart: tm.hopStart, hopLimit: tm.hopLimit, ts: now,
          });
        }
      }
    }

    // Routing-app responses carry the original packet's id in requestId. Treat
    // errorReason=0 (NONE) as ack and anything non-zero as nack with the radio's
    // own enum code threaded through.
    if (pkt.routing && pkt.requestId) {
      this.appendTraceEvent(pkt.requestId, {
        ts: now,
        kind: pkt.routing.errorReason === 0 ? 'ack' : 'nak',
        fromNode: pkt.from,
        rssi: pkt.rxRssi,
        snr: pkt.rxSnr,
        errorReason: pkt.routing.errorReason,
      });
      if (pkt.routing.errorReason === 0) this.resolvePending(pkt.requestId);
      else this.failPending(pkt.requestId, pkt.routing.errorReason);
    }

    if (pkt.nodeInfo && pkt.from) {
      this.upsertNode({
        num: pkt.from,
        id: pkt.nodeInfo.id,
        longName: pkt.nodeInfo.longName,
        shortName: pkt.nodeInfo.shortName,
        macaddr: pkt.nodeInfo.macaddr,
        hwModel: pkt.nodeInfo.hwModel,
        role: pkt.nodeInfo.role,
      });
    }

    if (pkt.position && pkt.from) {
      const existing = this.nodes.get(pkt.from);
      if (existing) {
        existing.lat = pkt.position.lat;
        existing.lon = pkt.position.lon;
        existing.altitude = pkt.position.altitude;
        if (pkt.position.precisionBits !== undefined) (existing as any).posPrecisionBits = pkt.position.precisionBits;
        this.nodes.set(pkt.from, existing);
        this.emit('node', existing);
      }
      if (this.db && (pkt.position.lat !== 0 || pkt.position.lon !== 0)) {
        this.db.insertPosition(pkt.from, pkt.position.lat, pkt.position.lon, pkt.position.altitude ?? 0, now);
      }
    }

    if (pkt.telemetry && pkt.from) {
      const t = pkt.telemetry;
      const existing = this.nodes.get(pkt.from);
      if (existing) {
        if (t.batteryLevel !== undefined) existing.batteryLevel = t.batteryLevel;
        if (t.voltage !== undefined) existing.voltage = t.voltage;
        if (t.channelUtilization !== undefined) existing.channelUtilization = t.channelUtilization;
        if (t.airUtilTx !== undefined) existing.airUtilTx = t.airUtilTx;
        this.nodes.set(pkt.from, existing);
        this.emit('node', existing);
      }
      this.emit('telemetry-sample', {
        nodeId: pkt.from,
        timestamp: now,
        channelUtilization: t.channelUtilization ?? 0,
        airUtilTx: t.airUtilTx ?? 0,
        batteryLevel: t.batteryLevel ?? 0,
        voltage: t.voltage ?? 0,
      });
      if (this.db && (t.batteryLevel !== undefined || t.voltage !== undefined ||
          t.channelUtilization !== undefined || t.airUtilTx !== undefined)) {
        this.db.insertDeviceTelemetry(
          pkt.from,
          t.batteryLevel ?? 0,
          t.voltage ?? 0,
          t.channelUtilization ?? 0,
          t.airUtilTx ?? 0,
          now,
        );
      }
    }

    if (pkt.traceroute && pkt.from) {
      this.emit('traceroute-response', {
        from: pkt.from,
        to: pkt.to,
        route: pkt.traceroute.route,
        rxRssi: pkt.rxRssi,
        rxSnr: pkt.rxSnr,
        hopStart: pkt.hopStart,
        hopLimit: pkt.hopLimit,
        receivedAt: now,
      });
      if (this.db) {
        const myNum = this.state.myInfo?.myNodeNum ?? 0;
        this.db.updateTracerouteResponse(pkt.from, myNum, pkt.traceroute.route, pkt.rxRssi, pkt.rxSnr, now);
        // Each adjacent pair in (me, route..., target) is an observed link
        const chain = [myNum, ...pkt.traceroute.route, pkt.from].filter(Boolean);
        for (let i = 0; i < chain.length - 1; i++) {
          this.db.observeLink(chain[i], chain[i + 1], 0, 0, now);
        }
      }
    }
  }
}
