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

/**
 * Aggregated counters for the Device Lab panel. Reset implicitly on each
 * connect — callers can snapshot mid-session to compare over time.
 */
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

/**
 * Structured lifecycle events surfaced to the Device Lab timeline.
 * "kind" is wide enough to cover everything we currently log via console.
 */
export type DeviceEventKind =
  | 'open' | 'close' | 'reconnect-attempt' | 'reconnect-ok'
  | 'error' | 'reset' | 'frame-corrupt' | 'note';
export interface DeviceEvent {
  at: number;
  kind: DeviceEventKind;
  detail?: string;
}

/**
 * Hardware-reset recipe. ESP32 boards drive EN/IO0 via the USB-serial chip's
 * RTS/DTR lines; nRF52840 boards use a 1200-baud "touch" to trigger DFU; the
 * RP2040 BOOTSEL pin is hardware-only.
 */
export type ResetProfile =
  | 'esp32'              // pulse EN via RTS (classic auto-reset)
  | 'esp32-bootloader'   // classic_reset + IO0 low → ROM bootloader
  | 'nrf52-dfu'          // close, reopen at 1200 baud, close → Adafruit nRF52 DFU
  | 'rp2040-bootsel';    // instruction-only; not software-triggerable

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  // Device Lab plumbing — raw byte feed, structured event log, port stats.
  private rawCallback: ((chunk: Uint8Array, direction: 'rx' | 'tx') => void) | null = null;
  private eventCallback: ((evt: DeviceEvent) => void) | null = null;
  private stats: PortStats = freshStats();

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
    this.stats = freshStats();

    await this.openPort(portPath);
    this.stats.openedAt = Date.now();
    this.emitEvent({ kind: 'open', at: Date.now(), detail: portPath });
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

    this.rawCallback?.(new Uint8Array(frame), 'tx');
    this.stats.bytesOut += frame.length;
    this.stats.framesOut++;
    this.port.write(frame, (err) => {
      if (err) {
        this.stats.errorCount++;
        console.error(`[serial:${this.portPath}] write FAILED (${payload.length}b):`, err.message);
        this.emitEvent({ kind: 'error', at: Date.now(), detail: `tx failed: ${err.message}` });
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

  /** Subscribe to every raw byte chunk read from or written to the port. */
  onRaw(callback: (chunk: Uint8Array, direction: 'rx' | 'tx') => void): void {
    this.rawCallback = callback;
  }

  /** Subscribe to lifecycle events (open/close/reset/error/etc). */
  onEvent(callback: (evt: DeviceEvent) => void): void {
    this.eventCallback = callback;
  }

  getStats(): PortStats {
    return { ...this.stats };
  }

  /**
   * Trigger a hardware-level reset over USB-serial control lines.
   * - 'esp32' / 'esp32-bootloader': pulse EN/IO0 via RTS/DTR (works on
   *   CP210x, CH9102, FTDI, and native ESP32-S3 USB-CDC).
   * - 'nrf52-dfu': close, reopen at 1200 baud for 100 ms, close. The
   *   Adafruit nRF52840 bootloader watches for that exact sequence.
   * - 'rp2040-bootsel': not software-triggerable; throws with a hint.
   */
  async resetDevice(profile: ResetProfile): Promise<void> {
    if (profile === 'rp2040-bootsel') {
      throw new Error('RP2040 BOOTSEL is hardware-only — hold the BOOTSEL button, then plug USB in (or tap RUN/reset).');
    }
    if (profile === 'nrf52-dfu') {
      const path = this.portPath;
      if (!path) throw new Error('No port path on record to perform 1200-baud DFU touch.');
      this.explicitDisconnect = true; // suppress our own reconnect loop
      try { await this.closePort(); } catch { /* best-effort */ }
      await new Promise<void>((resolve, reject) => {
        const touch = new SerialPort({ path, baudRate: 1200, autoOpen: false });
        touch.open((err) => {
          if (err) return reject(new Error(`1200-baud touch failed: ${err.message}`));
          setTimeout(() => touch.close(() => resolve()), 120);
        });
      });
      this.emitEvent({ kind: 'reset', at: Date.now(), detail: 'nrf52-dfu (1200-baud touch)' });
      // Caller (manager) handles re-discovery — the device disappears for a
      // few seconds and may come back as a USB MSC drive instead.
      this.explicitDisconnect = false;
      return;
    }
    if (!this.port?.isOpen) throw new Error('Port not open — cannot toggle RTS/DTR.');
    if (profile === 'esp32') {
      // Classic ESP32 hard reset: drop RTS for ~100 ms.
      await this.setLines(false, true);   // EN low
      await sleepMs(100);
      await this.setLines(false, false);  // EN released
    } else if (profile === 'esp32-bootloader') {
      // Classic esptool reset-to-bootloader sequence.
      await this.setLines(false, true);   // RTS=1 → EN low (chip held in reset)
      await sleepMs(100);
      await this.setLines(true, false);   // DTR=1 → IO0 low, RTS=0 → EN high (boot from ROM)
      await sleepMs(50);
      await this.setLines(false, false);  // release both
    }
    this.emitEvent({ kind: 'reset', at: Date.now(), detail: profile });
  }

  private setLines(dtr: boolean, rts: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = this.port;
      if (!p) return reject(new Error('port not open'));
      p.set({ dtr, rts }, (err) => (err ? reject(err) : resolve()));
    });
  }

  private emitEvent(evt: DeviceEvent): void {
    this.eventCallback?.(evt);
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
        this.stats.bytesIn += chunk.length;
        this.stats.lastDataAt = Date.now();
        this.rawCallback?.(new Uint8Array(chunk), 'rx');
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.processBuffer();
      });

      port.on('error', (err: Error) => {
        this.stats.errorCount++;
        this.emitEvent({ kind: 'error', at: Date.now(), detail: err.message });
        this.emitError(err);
        this.attemptReconnect();
      });

      port.on('close', () => {
        this.emitEvent({ kind: 'close', at: Date.now(), detail: this.explicitDisconnect ? 'user disconnect' : 'unexpected' });
        if (!this.explicitDisconnect) {
          this.disconnectCallback?.();
          this.attemptReconnect();
        }
      });

      port.open((err) => {
        if (err) {
          reject(new Error(explainOpenError(portPath, err)));
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
        this.stats.framesCorrupt++;
        this.emitEvent({ kind: 'frame-corrupt', at: Date.now(), detail: `len=${payloadLength}` });
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
      this.stats.framesIn++;

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
    this.stats.reconnectCount = this.reconnectAttempts;
    this.emitEvent({ kind: 'reconnect-attempt', at: Date.now(), detail: `attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}` });
    this.port = null;
    this.buffer = Buffer.alloc(0);

    setTimeout(async () => {
      try {
        await this.openPort(this.portPath);
        this.emitEvent({ kind: 'reconnect-ok', at: Date.now() });
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

function freshStats(): PortStats {
  return {
    openedAt: null, lastDataAt: null,
    bytesIn: 0, bytesOut: 0,
    framesIn: 0, framesOut: 0, framesCorrupt: 0,
    errorCount: 0, reconnectCount: 0,
  };
}

function buildDescription(port: { manufacturer?: string; vendorId?: string; productId?: string }): string {
  const parts: string[] = [];
  if (port.manufacturer) parts.push(port.manufacturer);
  if (port.vendorId && port.productId) parts.push(`[${port.vendorId}:${port.productId}]`);
  return parts.join(' ') || 'Unknown device';
}

/**
 * Translate a raw serialport open error into something the user can act on.
 * The most common failure mode on Linux is EACCES because the invoking user
 * isn't in the `dialout` group; on macOS it's a stale port held by another
 * process; on Windows it's "Access is denied" for the same reason.
 */
function explainOpenError(portPath: string, err: NodeJS.ErrnoException): string {
  const raw = err.message || String(err);
  const code = err.code || '';
  const denied = code === 'EACCES' || /permission denied|access is denied/i.test(raw);
  const busy = code === 'EBUSY' || /resource busy|access is denied.*\(busy\)/i.test(raw);

  if (denied) {
    if (process.platform === 'linux') {
      return `Permission denied opening ${portPath}. On Linux, serial devices are restricted to the "dialout" group. Fix: run "sudo usermod -aG dialout $USER", then log out and back in (or run "newgrp dialout" in the shell that launches this app). Verify with "ls -l ${portPath}" — it should be owned by root:dialout.`;
    }
    if (process.platform === 'darwin') {
      return `Permission denied opening ${portPath}. Another process may hold the port, or macOS hasn't granted USB access yet. Close the official Meshtastic app / CLI / serial monitors and try again.`;
    }
    return `Permission denied opening ${portPath}. Close any other app that might hold the port (Meshtastic CLI, Arduino IDE, serial monitor) and retry.`;
  }

  if (busy) {
    return `${portPath} is busy — another process has it open. Close the official Meshtastic app, Arduino IDE, screen/minicom, or any other serial monitor and try again.`;
  }

  if (code === 'ENOENT') {
    return `${portPath} disappeared before we could open it. The radio may have unplugged or rebooted — click Rescan.`;
  }

  return `Failed to open ${portPath}: ${raw}`;
}
