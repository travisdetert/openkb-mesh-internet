import { EventEmitter } from 'events';
import { MeshtasticController, ConnectionState, NodeRecord, TextMessage, PacketTrace } from './controller';
import { MeshtasticSerialConnection, PortInfo, ResetProfile } from './serial-connection';
import { LoRaConfigEdit, MeshPacket, DeviceConfigMsg, PositionConfigMsg, PowerConfigMsg, NetworkConfigMsg, DisplayConfigMsg, BluetoothConfigMsg, MQTTConfigMsg, ChannelEdit } from './protobuf-codec';
import { MeshDatabase } from '../database';

/**
 * Manages N independent MeshtasticController instances so the app can talk
 * to multiple USB-attached radios simultaneously. Each controller is keyed
 * by a stable connection id; all events are re-emitted with that id stamped
 * onto the payload.
 */
export class MeshManager extends EventEmitter {
  private controllers = new Map<string, MeshtasticController>();
  private portToId = new Map<string, string>(); // portPath → connId
  private nextSeq = 1;
  private db: MeshDatabase | null;

  // ── Auto-connect state ────────────────────────────────────────────
  private autoConnectEnabled = true; // default ON; user can opt out in Connect tab
  private autoConnectTimer: NodeJS.Timeout | null = null;
  /** Ports the user explicitly disconnected. Don't auto-reopen them for
   *  AUTO_RECONNECT_QUIET_MS so we don't fight against an intentional close. */
  private recentlyClosed = new Map<string, number>();
  private static AUTO_CONNECT_POLL_MS = 5000;
  private static AUTO_RECONNECT_QUIET_MS = 60 * 1000;

  constructor(db: MeshDatabase | null = null) {
    super();
    this.db = db;
    this.startAutoConnectIfEnabled();
  }

  setAutoConnect(enabled: boolean): void {
    if (this.autoConnectEnabled === enabled) return;
    this.autoConnectEnabled = enabled;
    console.log(`[manager] auto-connect ${enabled ? 'enabled' : 'disabled'}`);
    if (enabled) this.startAutoConnectIfEnabled();
    else this.stopAutoConnect();
  }
  getAutoConnect(): boolean { return this.autoConnectEnabled; }

  private startAutoConnectIfEnabled(): void {
    if (!this.autoConnectEnabled || this.autoConnectTimer) return;
    // Fire an immediate poll on enable so the user doesn't wait 5s for the
    // first sweep to land.
    void this.pollForAutoConnect();
    this.autoConnectTimer = setInterval(() => {
      void this.pollForAutoConnect();
    }, MeshManager.AUTO_CONNECT_POLL_MS);
  }
  private stopAutoConnect(): void {
    if (this.autoConnectTimer) {
      clearInterval(this.autoConnectTimer);
      this.autoConnectTimer = null;
    }
  }

  /**
   * Conservative auto-connect: only opens ports whose VID/PID match a known
   * Meshtastic hardware family ("confirmed" confidence). Generic USB-serial
   * chips ("likely") are left alone — they could be Arduinos, GPS pucks,
   * other dev boards. Skipping them avoids hijacking those ports.
   */
  private async pollForAutoConnect(): Promise<void> {
    if (!this.autoConnectEnabled) return;
    let ports: PortInfo[];
    try {
      ports = await MeshtasticSerialConnection.listPorts();
    } catch (e) {
      console.warn('[manager] auto-connect port scan failed:', e);
      return;
    }
    const now = Date.now();
    // Garbage-collect recently-closed entries past their quiet window.
    for (const [path, ts] of this.recentlyClosed) {
      if (now - ts > MeshManager.AUTO_RECONNECT_QUIET_MS) this.recentlyClosed.delete(path);
    }
    for (const p of ports) {
      if (p.confidence !== 'confirmed') continue;
      if (this.portToId.has(p.path)) continue;
      if (this.recentlyClosed.has(p.path)) continue;
      console.log(`[manager] auto-connect opening ${p.path} (${p.description ?? p.chipFamily ?? 'confirmed'})`);
      try {
        await this.connect(p.path);
      } catch (e) {
        console.warn(`[manager] auto-connect to ${p.path} failed:`, e);
      }
    }
  }

  static listPorts(): Promise<PortInfo[]> {
    return MeshtasticSerialConnection.listPorts();
  }

  /** Open a serial port and return the new connection's id. Idempotent on path. */
  async connect(portPath: string): Promise<string> {
    // If we already have a connection on this port, just return it.
    const existing = this.portToId.get(portPath);
    if (existing && this.controllers.has(existing)) return existing;

    const id = `conn-${this.nextSeq++}`;
    const controller = new MeshtasticController(this.db);

    // Forward every per-controller event with the connId stamped on it.
    controller.on('state', (state: ConnectionState) => {
      this.emit('state', { connId: id, state });
      // Unexpected port close (cable unplugged, device reset, etc.). Treat
      // it as terminal: drop the controller and tell the UI the connection
      // is gone, otherwise the ghost row sticks around forever and the
      // replug shows up as a *new* connId next to it.
      //
      // By the time we get here, the serial layer has already exhausted its
      // internal reconnect attempts — see MeshtasticSerialConnection.
      // attemptReconnect, which only fires the disconnect callback after
      // MAX_RECONNECT_ATTEMPTS. So this branch represents "really gone".
      if (state.status === 'disconnected' && this.controllers.get(id) === controller) {
        if (this.portToId.get(portPath) === id) this.portToId.delete(portPath);
        this.controllers.delete(id);
        // Force-close the underlying port and suppress any future reconnect.
        // Without this, an in-flight reconnect timer scheduled before the
        // give-up branch fired could still try to reopen the port after
        // we've forgotten about this connection.
        void controller.disconnect().catch(() => { /* best-effort cleanup */ });
        this.emit('connection-removed', { connId: id });
        // NOTE: not adding to recentlyClosed — we *want* auto-connect to
        // grab the device again as soon as it reappears on the bus.
      }
    });
    controller.on('node', (node: NodeRecord) => this.emit('node', { connId: id, node }));
    controller.on('message', (message: TextMessage) => this.emit('message', { connId: id, message }));
    controller.on('message-status', (message: TextMessage) => this.emit('message-status', { connId: id, message }));
    controller.on('packet', (packet: MeshPacket) => this.emit('packet', { connId: id, packet }));
    controller.on('telemetry-sample', (sample: unknown) => this.emit('telemetry-sample', { connId: id, sample }));
    controller.on('traceroute-sent', (trace: unknown) => this.emit('traceroute-sent', { connId: id, trace }));
    controller.on('traceroute-response', (response: unknown) => this.emit('traceroute-response', { connId: id, response }));
    controller.on('trace-update', (trace: PacketTrace) => this.emit('trace-update', { connId: id, trace }));
    controller.on('serial-raw', (payload: { chunk: Uint8Array; direction: 'rx' | 'tx' }) => {
      // Hand the raw chunk to the renderer as a base64 string — Uint8Array
      // serializes poorly across IPC and base64 is compact enough for a few
      // KB/s of traffic.
      this.emit('serial-raw', {
        connId: id,
        direction: payload.direction,
        at: Date.now(),
        // toString('base64') over a Uint8Array first goes through Buffer.from
        bytes: Buffer.from(payload.chunk).toString('base64'),
      });
    });
    controller.on('serial-event', (evt: unknown) => {
      this.emit('serial-event', { connId: id, event: evt });
    });

    this.controllers.set(id, controller);
    this.portToId.set(portPath, id);
    this.emit('connection-added', { connId: id, portPath });

    try {
      await controller.connect(portPath);
    } catch (err) {
      // Roll back registration on failure to open.
      this.controllers.delete(id);
      this.portToId.delete(portPath);
      this.emit('connection-removed', { connId: id });
      throw err;
    }
    return id;
  }

  async disconnect(connId: string): Promise<void> {
    const controller = this.controllers.get(connId);
    if (!controller) return;
    // Drop from the registry *before* awaiting the close. The controller
    // emits state='disconnected' while shutting down and our state listener
    // would otherwise see it and run the unexpected-disconnect cleanup
    // path in parallel (double connection-removed events).
    this.controllers.delete(connId);
    for (const [path, id] of this.portToId) {
      if (id === connId) {
        this.recentlyClosed.set(path, Date.now());
        this.portToId.delete(path);
        break;
      }
    }
    await controller.disconnect();
    this.emit('connection-removed', { connId });
  }

  /** Snapshot of every active connection's current state. */
  listConnections(): Array<{ connId: string; state: ConnectionState; portPath?: string }> {
    return Array.from(this.controllers.entries()).map(([connId, c]) => {
      const state = c.getState();
      return { connId, state, portPath: state.portPath };
    });
  }

  getState(connId: string): ConnectionState | null {
    return this.controllers.get(connId)?.getState() ?? null;
  }
  getNodes(connId: string): NodeRecord[] {
    return this.controllers.get(connId)?.getNodes() ?? [];
  }
  getMessages(connId: string): TextMessage[] {
    return this.controllers.get(connId)?.getMessages() ?? [];
  }
  getTraces(connId: string): PacketTrace[] {
    return this.controllers.get(connId)?.getTraces() ?? [];
  }

  // ─── Outbound commands ──────────────────────────────────────────────
  sendText(connId: string, text: string, opts: { to?: number; channel?: number; wantAck?: boolean }): TextMessage | null {
    const c = this.controllers.get(connId);
    if (!c) return null;
    return c.sendText(text, opts);
  }
  sendTraceroute(connId: string, to: number, channel: number = 0): { packetId: number; sentAt: number } | null {
    const c = this.controllers.get(connId);
    if (!c) return null;
    return c.sendTraceroute(to, channel);
  }
  setOwner(connId: string, longName: string, shortName: string): void {
    this.controllers.get(connId)?.setOwner(longName, shortName);
  }
  setLoraConfig(connId: string, lora: LoRaConfigEdit): void {
    this.controllers.get(connId)?.setLoraConfig(lora);
  }
  setDeviceConfig(connId: string, c: DeviceConfigMsg): void {
    this.controllers.get(connId)?.setDeviceConfig(c);
  }
  setPositionConfig(connId: string, c: PositionConfigMsg): void {
    this.controllers.get(connId)?.setPositionConfig(c);
  }
  setPowerConfig(connId: string, c: PowerConfigMsg): void {
    this.controllers.get(connId)?.setPowerConfig(c);
  }
  setNetworkConfig(connId: string, c: NetworkConfigMsg): void {
    this.controllers.get(connId)?.setNetworkConfig(c);
  }
  setDisplayConfig(connId: string, c: DisplayConfigMsg): void {
    this.controllers.get(connId)?.setDisplayConfig(c);
  }
  setBluetoothConfig(connId: string, c: BluetoothConfigMsg): void {
    this.controllers.get(connId)?.setBluetoothConfig(c);
  }
  setMqttConfig(connId: string, c: MQTTConfigMsg): void {
    this.controllers.get(connId)?.setMqttConfig(c);
  }
  setChannel(connId: string, c: ChannelEdit): void {
    this.controllers.get(connId)?.setChannel(c);
  }
  /** Trigger an on-demand nodeDB resync. */
  refresh(connId: string): void {
    this.controllers.get(connId)?.refresh();
  }
  /** Last successful refresh (ms epoch), or 0 if not yet synced. */
  getLastRefreshAt(connId: string): number {
    return this.controllers.get(connId)?.getLastRefreshAt() ?? 0;
  }
  /** Snapshot of serial port counters for the Device Lab panel. */
  getPortStats(connId: string) {
    return this.controllers.get(connId)?.getPortStats() ?? null;
  }
  /**
   * Drive RTS/DTR (or do a 1200-baud touch on nRF52) to reset / enter
   * bootloader. The renderer surfaces this in the Device Lab when a board
   * is wedged or about to be flashed.
   */
  resetDevice(connId: string, profile: ResetProfile): Promise<void> {
    const c = this.controllers.get(connId);
    if (!c) throw new Error(`No connection ${connId}`);
    return c.resetDevice(profile);
  }
  getChannelSetUrl(connId: string): string | null {
    return this.controllers.get(connId)?.getChannelSetUrl() ?? null;
  }
  applyChannelSetUrl(connId: string, url: string): boolean {
    return this.controllers.get(connId)?.applyChannelSetUrl(url) ?? false;
  }
}
