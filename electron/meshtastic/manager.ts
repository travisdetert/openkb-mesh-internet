import { EventEmitter } from 'events';
import { MeshtasticController, ConnectionState, NodeRecord, TextMessage, PacketTrace } from './controller';
import { MeshtasticSerialConnection, PortInfo } from './serial-connection';
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

  constructor(db: MeshDatabase | null = null) {
    super();
    this.db = db;
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
      // If the port closed unexpectedly and we're tracking it, drop the mapping.
      if (state.status === 'disconnected') {
        this.portToId.delete(portPath);
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
    await controller.disconnect();
    // Find the portPath for this connection
    for (const [path, id] of this.portToId) {
      if (id === connId) { this.portToId.delete(path); break; }
    }
    this.controllers.delete(connId);
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
  getChannelSetUrl(connId: string): string | null {
    return this.controllers.get(connId)?.getChannelSetUrl() ?? null;
  }
  applyChannelSetUrl(connId: string, url: string): boolean {
    return this.controllers.get(connId)?.applyChannelSetUrl(url) ?? false;
  }
}
