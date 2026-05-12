// Meshtastic serial connection — USB serial framing and device communication

import { SerialPort } from 'serialport';
import { classifyPort, type ChipFamily, type Confidence } from './device-database';

export interface PortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  description?: string;
  /** confirmed > likely > possible > unknown — drives UI grouping. */
  confidence: Confidence;
  /** Chip family if we could classify; absent for unknown ports. */
  chipFamily?: ChipFamily;
}

// Meshtastic serial frame constants
const MAGIC_BYTE_1 = 0x94;
const MAGIC_BYTE_2 = 0xC3;
const MAX_FRAME_SIZE = 512;
const FRAME_HEADER_SIZE = 4; // 2 magic + 2 length
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 3;

export class MeshtasticSerialConnection {
  private port: SerialPort | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private portPath: string = '';
  private explicitDisconnect = false;
  private reconnectAttempts = 0;

  private fromRadioCallback: ((bytes: Uint8Array) => void) | null = null;
  private disconnectCallback: (() => void) | null = null;
  private reconnectCallback: (() => void) | null = null;
  private errorCallback: ((err: Error) => void) | null = null;

  /**
   * Enumerate every serial port and classify each one. Returns confirmed,
   * likely, possible, and unknown ports together — the UI decides what to
   * show. The protobuf handshake is the ground truth for "is this Meshtastic";
   * this list just helps surface candidates a user might want to try.
   *
   * Sorted by confidence so confirmed devices come first.
   */
  static async listPorts(): Promise<PortInfo[]> {
    const allPorts = await SerialPort.list();
    const order: Record<Confidence, number> = { confirmed: 0, likely: 1, possible: 2, unknown: 3 };

    const out: PortInfo[] = allPorts.map((port) => {
      const match = classifyPort({
        vid: port.vendorId,
        pid: port.productId,
        path: port.path,
      });
      return {
        path: port.path,
        manufacturer: port.manufacturer,
        vendorId: port.vendorId,
        productId: port.productId,
        description: match.description || buildDescription(port),
        confidence: match.confidence,
        chipFamily: match.chipFamily,
      };
    });

    // Drop pure-unknown ports that don't even match a path pattern — those
    // are usually motherboard/internal serial ports a user should never try.
    const filtered = out.filter(p => p.confidence !== 'unknown');

    filtered.sort((a, b) => order[a.confidence] - order[b.confidence]);
    return filtered;
  }

  constructor() {
    // Instance starts disconnected — call connect() with a port path
  }

  async connect(portPath: string): Promise<void> {
    if (this.port?.isOpen) {
      throw new Error(`Already connected to ${this.portPath}`);
    }

    this.portPath = portPath;
    this.explicitDisconnect = false;
    this.reconnectAttempts = 0;
    this.buffer = Buffer.alloc(0);

    await this.openPort(portPath);
  }

  async disconnect(): Promise<void> {
    this.explicitDisconnect = true;
    await this.closePort();
    this.buffer = Buffer.alloc(0);
    this.fromRadioCallback = null;
    this.disconnectCallback = null;
    this.reconnectCallback = null;
    this.errorCallback = null;
  }

  isConnected(): boolean {
    return this.port !== null && this.port.isOpen;
  }

  /**
   * Frame and send a protobuf payload to the radio.
   * Frame format: [0x94, 0xC3, lengthMSB, lengthLSB, ...payload]
   */
  sendToRadio(payload: Uint8Array): void {
    if (!this.port || !this.port.isOpen) {
      this.emitError(new Error('Cannot send: serial port is not open'));
      return;
    }

    if (payload.length > MAX_FRAME_SIZE) {
      this.emitError(new Error(`Payload too large: ${payload.length} bytes (max ${MAX_FRAME_SIZE})`));
      return;
    }

    const frame = Buffer.alloc(FRAME_HEADER_SIZE + payload.length);
    frame[0] = MAGIC_BYTE_1;
    frame[1] = MAGIC_BYTE_2;
    frame.writeUInt16BE(payload.length, 2);
    frame.set(payload, FRAME_HEADER_SIZE);

    this.port.write(frame, (err) => {
      if (err) {
        console.error(`[serial:${this.portPath}] write FAILED (${payload.length}b):`, err.message);
        this.emitError(new Error(`Serial write failed: ${err.message}`));
      } else {
        // Log everything except heartbeats (4-byte frames) — those are too noisy.
        if (payload.length > 6) {
          console.log(`[serial:${this.portPath}] wrote ${payload.length}b: ${Buffer.from(payload.slice(0, 20)).toString('hex')}${payload.length > 20 ? '…' : ''}`);
        }
      }
    });
  }

  onFromRadio(callback: (bytes: Uint8Array) => void): void {
    this.fromRadioCallback = callback;
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }

  onReconnect(callback: () => void): void {
    this.reconnectCallback = callback;
  }

  onError(callback: (err: Error) => void): void {
    this.errorCallback = callback;
  }

  // --- Internal methods ---

  private async openPort(portPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const port = new SerialPort({
        path: portPath,
        baudRate: 115200,
        autoOpen: false,
      });

      port.on('data', (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.processBuffer();
      });

      port.on('error', (err: Error) => {
        this.emitError(err);
        this.attemptReconnect();
      });

      port.on('close', () => {
        if (!this.explicitDisconnect) {
          this.disconnectCallback?.();
          this.attemptReconnect();
        }
      });

      port.open((err) => {
        if (err) {
          reject(new Error(`Failed to open ${portPath}: ${err.message}`));
          return;
        }
        this.port = port;
        resolve();
      });
    });
  }

  private async closePort(): Promise<void> {
    if (!this.port) return;

    return new Promise<void>((resolve) => {
      if (!this.port!.isOpen) {
        this.port = null;
        resolve();
        return;
      }

      this.port!.close((err) => {
        if (err) {
          // Best effort — port may already be closed
          this.emitError(new Error(`Error closing port: ${err.message}`));
        }
        this.port = null;
        resolve();
      });
    });
  }

  /**
   * Process accumulated buffer looking for complete Meshtastic frames.
   *
   * Frame layout:
   *   [0x94] [0xC3] [lenMSB] [lenLSB] [payload...]
   */
  private processBuffer(): void {
    while (this.buffer.length >= FRAME_HEADER_SIZE) {
      // Scan for magic bytes
      const magicIndex = this.findMagicBytes();
      if (magicIndex === -1) {
        // No magic found — keep last byte in case it's the start of a split magic
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.subarray(this.buffer.length - 1);
        }
        return;
      }

      // Discard any bytes before the magic
      if (magicIndex > 0) {
        this.buffer = this.buffer.subarray(magicIndex);
      }

      // Need at least the full header to read length
      if (this.buffer.length < FRAME_HEADER_SIZE) {
        return;
      }

      const payloadLength = this.buffer.readUInt16BE(2);

      // Corrupt frame — skip past these magic bytes and rescan
      if (payloadLength > MAX_FRAME_SIZE || payloadLength === 0) {
        this.buffer = this.buffer.subarray(2);
        continue;
      }

      const totalFrameSize = FRAME_HEADER_SIZE + payloadLength;

      // Not enough data yet for the full frame
      if (this.buffer.length < totalFrameSize) {
        return;
      }

      // Extract the payload and deliver it
      const payload = new Uint8Array(this.buffer.subarray(FRAME_HEADER_SIZE, totalFrameSize));
      this.buffer = this.buffer.subarray(totalFrameSize);

      this.fromRadioCallback?.(payload);
    }
  }

  private findMagicBytes(): number {
    for (let i = 0; i <= this.buffer.length - 2; i++) {
      if (this.buffer[i] === MAGIC_BYTE_1 && this.buffer[i + 1] === MAGIC_BYTE_2) {
        return i;
      }
    }
    return -1;
  }

  private attemptReconnect(): void {
    if (this.explicitDisconnect) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emitError(new Error(`Gave up reconnecting to ${this.portPath} after ${MAX_RECONNECT_ATTEMPTS} attempts`));
      this.disconnectCallback?.();
      return;
    }

    this.reconnectAttempts++;
    this.port = null;
    this.buffer = Buffer.alloc(0);

    setTimeout(async () => {
      try {
        await this.openPort(this.portPath);
        this.reconnectAttempts = 0;
        this.reconnectCallback?.();
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
        this.attemptReconnect();
      }
    }, RECONNECT_DELAY_MS);
  }

  private emitError(err: Error): void {
    this.errorCallback?.(err);
  }
}

function buildDescription(port: { manufacturer?: string; vendorId?: string; productId?: string }): string {
  const parts: string[] = [];
  if (port.manufacturer) parts.push(port.manufacturer);
  if (port.vendorId && port.productId) parts.push(`[${port.vendorId}:${port.productId}]`);
  return parts.join(' ') || 'Unknown device';
}
