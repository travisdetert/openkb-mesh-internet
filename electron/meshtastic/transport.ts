// Transport abstraction so MeshtasticController can talk to either USB
// serial, Bluetooth LE, or (future) Wi-Fi/TCP without caring which.
//
// Each transport produces and consumes UNFRAMED ToRadio/FromRadio protobuf
// payloads — the Meshtastic 0x94 0xC3 framing is a serial-only concern and
// lives inside MeshtasticSerialConnection. BLE / TCP transports send each
// protobuf message as a discrete GATT write or TCP message.

/** Stats counters surfaced to the Device Lab panel. Some fields are
 *  serial-specific (framesCorrupt, reconnectCount) but a BLE transport
 *  can still report bytes / frames / errors honestly. */
export interface PortStats {
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

/** Lifecycle events used by the Device Lab timeline. */
export type DeviceEventKind =
  | 'open' | 'close' | 'reconnect-attempt' | 'reconnect-ok'
  | 'error' | 'reset' | 'frame-corrupt' | 'note';

export interface DeviceEvent {
  at: number;
  kind: DeviceEventKind;
  detail?: string;
}

/** Hardware reset profile. Only meaningful for serial (DTR/RTS or 1200-baud
 *  touch). BLE transports throw a "not supported" error. */
export type ResetProfile =
  | 'esp32'
  | 'esp32-bootloader'
  | 'nrf52-dfu'
  | 'rp2040-bootsel';

export type TransportKind = 'serial' | 'ble' | 'tcp';

/**
 * What MeshtasticController needs from any transport. Methods take/return
 * unframed payloads — adding/removing the serial framing is the transport's
 * responsibility.
 */
export interface MeshtasticTransport {
  /** Identifier for display ("serial", "ble", future "tcp"). */
  readonly kind: TransportKind;

  /** Open the underlying link. For serial this opens the port; for BLE
   *  it's mostly a no-op because the renderer has already established the
   *  GATT connection by the time the proxy transport gets called. */
  connect(endpoint: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  /** Send one ToRadio protobuf payload (the transport adds any framing). */
  sendToRadio(payload: Uint8Array): void;

  /** Subscribe to incoming FromRadio protobuf payloads (unframed). */
  onFromRadio(cb: (bytes: Uint8Array) => void): void;
  onDisconnect(cb: () => void): void;
  onReconnect(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
  /** Raw byte chunks for the Device Lab. Direction = which way they
   *  travelled. For BLE we report each GATT read/write as one chunk. */
  onRaw(cb: (chunk: Uint8Array, direction: 'rx' | 'tx') => void): void;
  /** Structured lifecycle events. */
  onEvent(cb: (evt: DeviceEvent) => void): void;

  getStats(): PortStats;
  /** Trigger a hardware reset / bootloader entry. Throws on BLE. */
  resetDevice(profile: ResetProfile): Promise<void>;
}

export function freshStats(): PortStats {
  return {
    openedAt: null, lastDataAt: null,
    bytesIn: 0, bytesOut: 0,
    framesIn: 0, framesOut: 0, framesCorrupt: 0,
    errorCount: 0, reconnectCount: 0,
  };
}
