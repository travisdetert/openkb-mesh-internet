// Bluetooth transport for MeshtasticController, proxied to the renderer.
//
// The renderer owns the actual WebBluetooth GATT connection (so we can
// avoid native BLE bindings in main and ride on Chromium's stable stack).
// This class lives in the main process and looks like any other transport
// to MeshtasticController, but its sendToRadio just emits an event that
// the manager forwards to the renderer over IPC. Inbound FromRadio frames
// arriving from the renderer over IPC are pushed in via ingestFromRadio().
//
//   renderer (WebBluetooth)
//        │ ipc: mesh:bleRxFrame ──────────────► ingestFromRadio()
//        │ ipc: mesh:bleDisconnected ─────────► signalDisconnect()
//        ▲
//        │ ipc: mesh:bleTxFrame ◄── manager forwards from 'write-request'
//        │ ipc: mesh:bleDisconnectRequest ◄──── 'disconnect-request'
//
// One transport per connected BLE device. The manager keys these by connId.

import { EventEmitter } from 'events';
import {
  type MeshtasticTransport,
  type PortStats,
  type DeviceEvent,
  type ResetProfile,
  type TransportKind,
  freshStats,
} from './transport';

export class BleProxyTransport extends EventEmitter implements MeshtasticTransport {
  readonly kind: TransportKind = 'ble';
  private connected = false;
  private deviceName = '';

  private fromRadioCb: ((b: Uint8Array) => void) | null = null;
  private disconnectCb: (() => void) | null = null;
  private reconnectCb: (() => void) | null = null;
  private errorCb: ((err: Error) => void) | null = null;
  private rawCb: ((chunk: Uint8Array, dir: 'rx' | 'tx') => void) | null = null;
  private eventCb: ((evt: DeviceEvent) => void) | null = null;

  private stats: PortStats = freshStats();

  /**
   * For BLE, "connect" means "the renderer has finished its GATT handshake
   * and is now ready to relay frames". We don't open anything ourselves.
   * `endpoint` is a display label (BLE device name).
   */
  async connect(endpoint: string): Promise<void> {
    this.deviceName = endpoint;
    this.connected = true;
    this.stats = freshStats();
    this.stats.openedAt = Date.now();
    this.eventCb?.({ at: Date.now(), kind: 'open', detail: `ble:${endpoint}` });
  }

  /**
   * Internal disconnect. Tells the renderer to close GATT (via the
   * 'disconnect-request' event the manager forwards), then marks itself
   * as no longer connected. Safe to call when already disconnected.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.eventCb?.({ at: Date.now(), kind: 'close', detail: 'user disconnect' });
    this.emit('disconnect-request');
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send one ToRadio protobuf payload. We don't have a port to write into —
   * we emit a 'write-request' event that the manager forwards to the
   * renderer over IPC, and the renderer does the actual GATT write.
   */
  sendToRadio(payload: Uint8Array): void {
    if (!this.connected) {
      this.errorCb?.(new Error('BLE transport not connected — cannot send'));
      return;
    }
    this.stats.bytesOut += payload.length;
    this.stats.framesOut++;
    this.rawCb?.(payload, 'tx');
    this.emit('write-request', payload);
  }

  /** Called by the manager when the renderer pushes a FromRadio frame. */
  ingestFromRadio(payload: Uint8Array): void {
    this.stats.bytesIn += payload.length;
    this.stats.framesIn++;
    this.stats.lastDataAt = Date.now();
    this.rawCb?.(payload, 'rx');
    this.fromRadioCb?.(payload);
  }

  /**
   * Called by the manager when the renderer reports the GATT link has
   * dropped. We fire the controller's disconnect callback so it tears
   * down the same way it would for a serial-side unplug.
   */
  signalDisconnect(reason?: string): void {
    if (!this.connected) return;
    this.connected = false;
    this.eventCb?.({ at: Date.now(), kind: 'close', detail: reason || 'remote' });
    this.disconnectCb?.();
  }

  /** Called by the manager when the renderer reports a write error. */
  signalError(message: string): void {
    this.stats.errorCount++;
    this.eventCb?.({ at: Date.now(), kind: 'error', detail: message });
    this.errorCb?.(new Error(message));
  }

  onFromRadio(cb: (bytes: Uint8Array) => void): void { this.fromRadioCb = cb; }
  onDisconnect(cb: () => void): void { this.disconnectCb = cb; }
  onReconnect(cb: () => void): void { this.reconnectCb = cb; }
  onError(cb: (err: Error) => void): void { this.errorCb = cb; }
  onRaw(cb: (chunk: Uint8Array, dir: 'rx' | 'tx') => void): void { this.rawCb = cb; }
  onEvent(cb: (evt: DeviceEvent) => void): void { this.eventCb = cb; }

  getStats(): PortStats {
    return { ...this.stats };
  }

  async resetDevice(_profile: ResetProfile): Promise<void> {
    throw new Error('Hardware reset is not available over Bluetooth — connect via USB to enter the bootloader.');
  }
}
