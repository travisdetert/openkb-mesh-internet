import { EventEmitter } from 'events';
import { MeshtasticSerialConnection, PortInfo } from './serial-connection';
import type { MeshtasticTransport } from './transport';
import {
  decodeFromRadio,
  encodeToRadio_WantConfig,
  encodeToRadio_SendText,
  encodeToRadio_SendTraceroute,
  encodeToRadio_BroadcastNodeInfo,
  encodeToRadio_Reboot,
  encodeToRadio_SetFavorite,
  encodeToRadio_NodedbReset,
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

/**
 * Diagnostic snapshot of the want_config handshake. Set while
 * `status === 'configuring'` and cleared once `config_complete` arrives.
 * The UI reads this to show liveness ("last frame 2s ago"), retry count,
 * and a manual "Retry now" button.
 */
export interface SyncStatus {
  /** ms epoch of when we entered `configuring`. */
  startedAt: number;
  /** ms epoch of the most-recent FromRadio frame observed during sync. */
  lastFrameAt: number;
  /** Number of times we've re-sent wantConfig because of a stall. */
  retries: number;
  /** Why sync ended (only set after we leave `configuring`). Useful for
   *  surfacing the failure mode in the disconnected-with-error state. */
  failure?: 'stall' | 'transport';
}

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
  sync?: SyncStatus;
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
  /** Outgoing-only: which node actually sent the Routing ack. If this
   *  equals `to`, the destination replied (high confidence delivered).
   *  Otherwise a relay closer to the destination acked on its behalf —
   *  the destination's decode is unconfirmed. */
  ackFromNode?: number;
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
 * Sync watchdog: how long we'll go without a single FromRadio frame
 * during `configuring` before assuming the wantConfig got dropped and
 * re-sending. Generous enough for a slow BLE handshake (the radio may
 * need to drop a previously-bonded peer before servicing us) but still
 * fast enough to recover from a single dropped frame on USB.
 */
const SYNC_STALL_MS = 20_000;
/** Maximum wantConfig re-sends before backing off to slow-retry mode. */
const SYNC_MAX_RETRIES = 5;
/**
 * After this much elapsed time we flag the connection with a stall
 * warning in the UI but keep the transport open and keep listening —
 * BLE radios sometimes take a full minute to start streaming and a
 * forced disconnect just makes the user wait through a fresh handshake.
 * The user can hit Retry now or Disconnect from the UI.
 */
const SYNC_SOFT_TIMEOUT_MS = 90_000;
/** Slow-retry cadence once we've hit max retries. Keeps re-sending
 *  wantConfig in case the radio finally wakes up. */
const SYNC_SLOW_RETRY_MS = 30_000;
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
  private conn: MeshtasticTransport;
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
  /** Sync watchdog state. Active during `configuring`; null otherwise. */
  private syncTimer: NodeJS.Timeout | null = null;
  private syncStartedAt = 0;
  private lastFrameAt = 0;
  private syncRetries = 0;

  /** `transport` is optional — defaults to a fresh serial connection so the
   *  legacy `connect(portPath)` flow keeps working. Manager passes in a BLE
   *  proxy transport for Bluetooth-backed controllers. */
  constructor(db: MeshDatabase | null = null, transport?: MeshtasticTransport) {
    super();
    this.db = db;
    this.conn = transport ?? new MeshtasticSerialConnection();
    this.conn.onFromRadio((bytes) => this.handleFromRadio(bytes));
    this.conn.onDisconnect(() => {
      this.stopHeartbeat();
      this.stopNodeRefresh();
      this.setState({ status: 'disconnected' });
    });
    this.conn.onReconnect(() => {
      // Serial reopened on its own — re-run the want_config handshake so the
      // radio resends nodeDB / config / channels. Goes through enterSync so
      // the watchdog protects this round too; otherwise a reconnect that
      // landed on a wedged radio would sit forever.
      setTimeout(() => this.enterSync(), RECONNECT_RECONFIG_DELAY_MS);
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
    this.enterSync(portPath);
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.stopNodeRefresh();
    this.exitSync();
    await this.conn.disconnect();
    this.setState({ status: 'disconnected' });
  }

  private requestConfig(): void {
    const configId = (Math.random() * 0xffffffff) >>> 0;
    this.enqueueToRadio(encodeToRadio_WantConfig(configId));
    this.lastRefreshAt = Date.now();
  }

  /**
   * Enter the `configuring` state with a fresh sync watchdog. Records
   * timestamps in ConnectionState.sync so the UI can render liveness.
   * Called from connect() and from the auto-reconnect path.
   */
  private enterSync(portPath?: string): void {
    this.exitSync();
    this.syncStartedAt = Date.now();
    this.lastFrameAt = Date.now();
    this.syncRetries = 0;
    this.setState({
      ...this.state,
      status: 'configuring',
      portPath: portPath ?? this.state.portPath,
      error: undefined,
      sync: { startedAt: this.syncStartedAt, lastFrameAt: this.lastFrameAt, retries: 0 },
    });
    this.requestConfig();
    this.armSyncWatchdog();
  }

  /** Stop the sync watchdog and clear the diagnostic snapshot. */
  private exitSync(failure?: SyncStatus['failure']): void {
    if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = null; }
    if (this.state.sync) {
      // If we're transitioning away from configuring, drop sync so the
      // UI stops rendering the progress card. The `ready` case below
      // does this explicitly; this handles disconnect / error paths.
      this.setState({
        ...this.state,
        sync: failure ? { ...this.state.sync, failure } : undefined,
      });
    }
  }

  /** Reset the watchdog window — called after every frame during sync. */
  private armSyncWatchdog(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.onSyncStall(), SYNC_STALL_MS);
  }

  /**
   * Stall handler — fires SYNC_STALL_MS after the last observed frame.
   *   • Under retry cap: re-send wantConfig and keep going.
   *   • Past retry cap, under soft timeout: keep listening + slow-retry.
   *   • Past soft timeout: surface a warning but DO NOT disconnect.
   *     BLE radios sometimes wake up after a minute and start streaming;
   *     a forced disconnect would just throw away the session.
   */
  private onSyncStall(): void {
    if (this.state.status !== 'configuring') return;
    const totalElapsed = Date.now() - this.syncStartedAt;

    // Soft warning state: stay configuring, surface the stall to the UI,
    // and slow-retry. The user can Retry now or Disconnect.
    if (totalElapsed >= SYNC_SOFT_TIMEOUT_MS) {
      const alreadyWarned = this.state.sync?.failure === 'stall';
      if (!alreadyWarned) {
        console.warn(`[controller] sync slow: ${Math.round(totalElapsed/1000)}s with no progress — keeping transport open, will keep retrying every ${SYNC_SLOW_RETRY_MS/1000}s. User can Retry now or Disconnect.`);
        this.setState({
          ...this.state,
          error: `Sync hasn't completed after ${Math.round(totalElapsed/1000)}s. The radio is still connected and we're retrying. Common BLE fixes: force-quit the official Meshtastic phone app (radios usually only allow one BLE client), or press the radio's physical button to wake it.`,
          sync: { ...this.state.sync!, failure: 'stall' },
        });
      }
      this.syncRetries++;
      console.warn(`[controller] slow retry ${this.syncRetries}: re-sending wantConfig`);
      this.requestConfig();
      this.setState({
        ...this.state,
        sync: { startedAt: this.syncStartedAt, lastFrameAt: this.lastFrameAt, retries: this.syncRetries, failure: 'stall' },
      });
      this.syncTimer = setTimeout(() => this.onSyncStall(), SYNC_SLOW_RETRY_MS);
      return;
    }

    // Within the active retry phase.
    if (this.syncRetries >= SYNC_MAX_RETRIES) {
      // Out of fast retries but not at soft timeout yet — just rearm
      // the watchdog so a late frame still resolves sync.
      this.armSyncWatchdog();
      return;
    }
    this.syncRetries++;
    console.warn(`[controller] sync stall — resending wantConfig (retry ${this.syncRetries}/${SYNC_MAX_RETRIES})`);
    this.setState({
      ...this.state,
      sync: { startedAt: this.syncStartedAt, lastFrameAt: this.lastFrameAt, retries: this.syncRetries },
    });
    this.requestConfig();
    this.armSyncWatchdog();
  }

  /**
   * Manual sync retry from the UI. Re-issues wantConfig and rearms the
   * watchdog. No-op outside `configuring`. Returns whether anything was
   * actually attempted.
   */
  retrySync(): boolean {
    if (this.state.status !== 'configuring') return false;
    this.syncRetries++;
    console.log(`[controller] manual sync retry (retry ${this.syncRetries})`);
    this.setState({
      ...this.state,
      sync: { startedAt: this.syncStartedAt, lastFrameAt: this.lastFrameAt, retries: this.syncRetries },
    });
    this.requestConfig();
    this.armSyncWatchdog();
    return true;
  }

  /**
   * Drop in-memory messages matching a conversation. The shared SQLite
   * row delete is done by the manager (so multi-radio runs only DELETE
   * once). Emits a `messages-cleared` event so the renderer can prune
   * its own state. Returns the row count removed.
   */
  clearConversationLocal(opts: { kind: 'channel' | 'dm'; channel?: number; peer?: number }): number {
    const my = this.state.myInfo?.myNodeNum;
    const before = this.messages.length;
    if (opts.kind === 'channel' && opts.channel !== undefined) {
      this.messages = this.messages.filter((m) => !(m.channel === opts.channel && m.to === 0xffffffff));
    } else if (opts.kind === 'dm' && opts.peer !== undefined && my !== undefined) {
      this.messages = this.messages.filter((m) =>
        !((m.from === my && m.to === opts.peer) || (m.from === opts.peer && m.to === my)),
      );
    }
    const removed = before - this.messages.length;
    if (removed > 0) this.emit('messages-cleared', { ...opts });
    return removed;
  }

  /** Drop every in-memory message. DB delete is the manager's job. */
  clearAllMessagesLocal(): number {
    const n = this.messages.length;
    this.messages = [];
    if (n > 0) this.emit('messages-cleared', { kind: 'all' });
    return n;
  }

  /** Public: ask the radio to redump its nodeDB now. Used by the Refresh button. */
  refresh(): void {
    console.log('[controller] manual refresh requested');
    this.requestConfig();
  }

  /**
   * Toggle a peer's favorite flag in this radio's nodeDB. Optimistically
   * updates the local record + emits a 'node' event so the UI reflects
   * the change immediately, then sends the admin message. The radio's
   * next NodeInfo broadcast will confirm the new state.
   */
  setFavoriteNode(nodeNum: number, favorite: boolean): boolean {
    const my = this.state.myInfo?.myNodeNum;
    if (!my) {
      console.warn('[controller] setFavoriteNode dropped — myNodeNum not yet known');
      return false;
    }
    console.log(`[controller] setFavoriteNode !${nodeNum.toString(16).padStart(8, '0')} = ${favorite}`);
    // Optimistic local update so the UI doesn't lag the click.
    const existing = this.nodes.get(nodeNum);
    if (existing) {
      const updated: NodeRecord = { ...existing, isFavorite: favorite };
      this.nodes.set(nodeNum, updated);
      this.emit('node', updated);
    }
    this.enqueueToRadio(encodeToRadio_SetFavorite(my, nodeNum, favorite));
    return true;
  }

  /**
   * Wipe the radio's nodeDB via admin message AND clear our local
   * in-memory record so the UI immediately reflects the empty state.
   * Peers will repopulate over time as NodeInfo broadcasts come in.
   * Returns false if myNodeNum isn't known yet.
   */
  purgeNodedb(): boolean {
    const my = this.state.myInfo?.myNodeNum;
    if (!my) {
      console.warn('[controller] purgeNodedb dropped — myNodeNum not yet known');
      return false;
    }
    console.log(`[controller] purgeNodedb on !${my.toString(16).padStart(8, '0')}`);
    this.enqueueToRadio(encodeToRadio_NodedbReset(my));
    // Clear local in-memory state too — keep "me" so the UI doesn't lose
    // its own identity. Firmware does the same internally.
    const me = this.nodes.get(my);
    this.nodes.clear();
    if (me) this.nodes.set(my, me);
    this.emit('nodedb-cleared', { myNum: my });
    return true;
  }

  /**
   * Tell the radio to reboot in `seconds`. Returns false if myNodeNum
   * isn't known yet (handshake not finished). Default 5s gives the host
   * time to see any final acks before the link drops; the radio then
   * comes back on USB after ~8–15s depending on chip family.
   */
  reboot(seconds: number = 5): boolean {
    const my = this.state.myInfo?.myNodeNum;
    if (!my) {
      console.warn('[controller] reboot dropped — myNodeNum not yet known');
      return false;
    }
    console.log(`[controller] reboot scheduled (${seconds}s) for !${my.toString(16).padStart(8, '0')}`);
    this.enqueueToRadio(encodeToRadio_Reboot(my, seconds));
    return true;
  }

  /**
   * Broadcast our own NodeInfo over the air with wantResponse=true. Peers
   * that hear us will update their nodeDB with our identity AND reply with
   * their own NodeInfo, which is the closest thing Meshtastic offers to an
   * "active scan." Returns false if we don't yet know who we are (handshake
   * incomplete).
   */
  broadcastNodeInfo(): boolean {
    const myNum = this.state.myInfo?.myNodeNum;
    if (!myNum) {
      console.warn('[controller] broadcastNodeInfo dropped — myNodeNum not yet known');
      return false;
    }
    const me = this.nodes.get(myNum);
    const packetId = (Math.random() * 0xffffffff) >>> 0;
    console.log(`[controller] broadcasting NodeInfo (from=${myNum} packetId=${packetId})`);
    this.enqueueToRadio(encodeToRadio_BroadcastNodeInfo({
      fromNum: myNum,
      id: me?.id,
      longName: me?.longName,
      shortName: me?.shortName,
      hwModel: me?.hwModel,
      macaddr: me?.macaddr,
      role: me?.role,
      packetId,
    }));
    return true;
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

  /**
   * Record a successful ack. `ackFromNode` is the radio that sent the
   * Routing reply — if it equals the original destination, we have high
   * confidence the message actually reached the recipient; if it's
   * something else, the ack came back through a relay and the
   * destination's actual decode is unconfirmed.
   */
  private resolvePending(id: number, ackFromNode?: number): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.pending.delete(id);
    entry.message.ackStatus = 'acked';
    entry.message.ackFromNode = ackFromNode;
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

    // Keep the sync watchdog fresh — any frame from the radio counts as
    // liveness, even if it's a packet unrelated to the handshake. Without
    // this, a chatty mesh could mask a missed config_complete because
    // we'd keep seeing packets but the sync card would never tick over.
    if (this.state.status === 'configuring') {
      this.lastFrameAt = Date.now();
      // Republish sync only on a meaningful gap so we don't spam state
      // updates on every received packet during a busy mesh.
      const lastPublished = this.state.sync?.lastFrameAt ?? 0;
      if (this.lastFrameAt - lastPublished > 500) {
        this.setState({
          ...this.state,
          sync: { startedAt: this.syncStartedAt, lastFrameAt: this.lastFrameAt, retries: this.syncRetries },
        });
      }
      this.armSyncWatchdog();
    }

    switch (msg.type) {
      case 'my_info':
        if (msg.myInfo) {
          // Merge rather than replace — myInfo and metadata both flow
          // into the same ConnectionState.myInfo object (myNodeNum from
          // here, capabilities + firmware version from metadata). Either
          // can arrive first.
          this.setState({ ...this.state, myInfo: { ...this.state.myInfo, ...msg.myInfo } });
        }
        break;

      case 'metadata':
        // DeviceMetadata is where the radio reports its real capabilities:
        // firmware version, has_wifi, has_bluetooth, has_ethernet, hw_model,
        // role. Merge into myInfo so the rest of the app sees a single
        // unified identity object. Without this branch the Bluetooth /
        // WiFi settings panels (which gate on myInfo.hasBluetooth /
        // hasWifi) would always think the radio lacks those capabilities.
        if (msg.metadata) {
          const meta = msg.metadata;
          const existing = this.state.myInfo;
          this.setState({
            ...this.state,
            myInfo: {
              myNodeNum: existing?.myNodeNum ?? 0,
              firmwareVersion: meta.firmwareVersion || existing?.firmwareVersion || '',
              hasWifi:        existing?.hasWifi      || meta.hasWifi,
              hasBluetooth:   existing?.hasBluetooth || meta.hasBluetooth,
              maxChannels:    existing?.maxChannels  ?? 8,
            },
          });
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
        if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = null; }
        this.setState({ ...this.state, status: 'ready', sync: undefined, error: undefined });
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
    // Spread-merge would overwrite a known shortName / longName / hwModel
    // with an empty / zero value when a partial NodeInfo arrives (e.g.
    // inline in a position-bearing packet whose User proto fields decoded
    // to empty defaults). For identity fields, only accept the new value
    // when it actually carries content — otherwise keep what we had.
    const hwModelEffective = info.hwModel || existing?.hwModel || 0;
    const merged: NodeRecord = {
      ...(existing ?? {
        firstHeard: now,
        packetCount: 0,
        hwModelName: lookupHwModel(hwModelEffective),
      }),
      ...info,
      longName:   info.longName  || existing?.longName  || '',
      shortName:  info.shortName || existing?.shortName || '',
      id:         info.id        || existing?.id        || '',
      macaddr:    info.macaddr   || existing?.macaddr   || '',
      hwModel:    hwModelEffective,
      hwModelName: lookupHwModel(hwModelEffective),
    };
    this.nodes.set(info.num, merged);
    this.emit('node', merged);

    if (this.db) {
      const ts = Date.now();
      // Persist the merged identity, not the raw incoming info — same reason
      // as the in-memory merge above.
      this.db.upsertNode(info.num, merged.longName, merged.shortName, merged.hwModel, ts);
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
      if (pkt.routing.errorReason === 0) this.resolvePending(pkt.requestId, pkt.from);
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
        snrTowards: pkt.traceroute.snrTowards,
        routeBack: pkt.traceroute.routeBack,
        snrBack: pkt.traceroute.snrBack,
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
