/**
 * Voice-message capture, encode, and playback.
 *
 * For now we use the browser's built-in `MediaRecorder` to encode mic audio
 * directly to Opus (Opus/WebM container at the lowest supported bitrate,
 * usually 6 kbps). This is way bigger than a real Codec2 build would be
 * (~6× more bytes per second than Codec2-700C) but is zero-dependency,
 * works today, and gives us the full pipeline. The swap to a WASM Codec2
 * later only changes the encode/decode functions — everything else
 * (chunking, content-type framing, UI, playback) stays the same.
 *
 * Wire format for `\x01V|` voice payloads, after the typed-payload prefix:
 *
 *   byte 0        mime-type code (see MIME_CODES below)
 *   byte 1        duration (ms) low byte
 *   byte 2        duration (ms) high byte   (0–65 535 ms cap)
 *   bytes 3..N    encoded audio bytes (Opus, etc.)
 */

export const VOICE_BITRATE_BPS = 6000; // minimum browser-supported Opus rate
export const VOICE_MAX_MS = 8000;       // hard cap so chunks stay reasonable

const HEADER_SIZE = 3;

const MIME_CODES: Record<number, string> = {
  0: 'audio/webm; codecs=opus',
  1: 'audio/webm',
  2: 'audio/ogg; codecs=opus',
  3: 'audio/mp4',
  // 0xFF reserved for "unknown — try webm"
};

function codeFor(mime: string): number {
  for (const [code, m] of Object.entries(MIME_CODES)) {
    if (mime.startsWith(m.split(';')[0].trim())) return Number(code);
  }
  return 0xff;
}

export interface VoiceClip {
  /** Raw encoded audio bytes (without the wire header). */
  audio: Uint8Array;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Mime type returned by the MediaRecorder (informational). */
  mimeType: string;
}

/** Pack a captured clip into the wire-format bytes for `sendPayload`. */
export function packVoice(clip: VoiceClip): Uint8Array {
  const ms = Math.min(0xffff, Math.max(0, Math.round(clip.durationMs)));
  const out = new Uint8Array(HEADER_SIZE + clip.audio.length);
  out[0] = codeFor(clip.mimeType);
  out[1] = ms & 0xff;
  out[2] = (ms >> 8) & 0xff;
  out.set(clip.audio, HEADER_SIZE);
  return out;
}

/** Reverse of packVoice — extract the clip from wire bytes. */
export function unpackVoice(bytes: Uint8Array): VoiceClip | null {
  if (bytes.length < HEADER_SIZE) return null;
  const code = bytes[0];
  const durationMs = bytes[1] | (bytes[2] << 8);
  const mimeType = MIME_CODES[code] ?? 'audio/webm; codecs=opus';
  return {
    audio: bytes.slice(HEADER_SIZE),
    durationMs,
    mimeType,
  };
}

// ── Recorder ─────────────────────────────────────────────────────────

/**
 * Microphone-to-Opus recorder. Lifecycle: start() → (running) → stop() →
 * { audio, durationMs, mimeType }. Cleans up the mic stream automatically.
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private parts: BlobPart[] = [];
  private startedAt = 0;
  private timeoutHandle: number | null = null;

  /** Begin capturing. The optional onAutoStop fires if the max duration is hit. */
  async start(opts?: { onAutoStop?: () => void }): Promise<void> {
    if (this.recorder) throw new Error('Recorder is already running');

    // getUserMedia surfaces useful errors (NotAllowedError, NotFoundError) —
    // log them so the calling code can show a meaningful message.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as Error)?.name || 'unknown';
      const msg = (err as Error)?.message || String(err);
      console.error(`[voice] getUserMedia failed: ${name}: ${msg}`);
      throw err;
    }
    console.log(`[voice] got stream, tracks=${this.stream.getAudioTracks().length}`,
      this.stream.getAudioTracks().map((t) => ({ label: t.label, enabled: t.enabled, muted: t.muted, readyState: t.readyState })));

    this.parts = [];
    this.startedAt = Date.now();

    const mimeType = pickSupportedMime();
    console.log(`[voice] using mimeType="${mimeType}", bitrate=${VOICE_BITRATE_BPS}`);
    this.recorder = new MediaRecorder(this.stream, mimeType
      ? { mimeType, audioBitsPerSecond: VOICE_BITRATE_BPS }
      : { audioBitsPerSecond: VOICE_BITRATE_BPS });
    this.recorder.ondataavailable = (e) => {
      console.log(`[voice] dataavailable: ${e.data.size} B`);
      if (e.data.size > 0) this.parts.push(e.data);
    };
    this.recorder.onerror = (e) => console.error('[voice] recorder error:', e);
    // Request data every 500 ms so we can see capture progress in logs.
    this.recorder.start(500);
    console.log(`[voice] recorder.start() called, state=${this.recorder.state}`);

    if (opts?.onAutoStop) {
      this.timeoutHandle = window.setTimeout(() => {
        if (this.recorder?.state === 'recording') {
          opts.onAutoStop!();
        }
      }, VOICE_MAX_MS);
    }
  }

  /** End capture, return the captured clip. */
  async stop(): Promise<VoiceClip> {
    if (!this.recorder) throw new Error('Recorder is not running');
    const r = this.recorder;
    const duration = Date.now() - this.startedAt;
    return new Promise<VoiceClip>((resolve, reject) => {
      r.onstop = async () => {
        try {
          const mimeType = r.mimeType || 'audio/webm; codecs=opus';
          const blob = new Blob(this.parts, { type: mimeType });
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          console.log(`[voice] stopped: ${bytes.length} B in ${duration} ms across ${this.parts.length} chunks`);
          if (bytes.length === 0) {
            console.warn('[voice] captured zero bytes — likely mic permission/access issue');
          }
          resolve({ audio: bytes, durationMs: duration, mimeType });
        } catch (err) {
          reject(err);
        } finally {
          this.cleanup();
        }
      };
      r.stop();
    });
  }

  /** Discard the in-progress recording. */
  cancel(): void {
    try {
      if (this.recorder?.state === 'recording') this.recorder.stop();
    } catch { /* ignore */ }
    this.cleanup();
  }

  isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  private cleanup(): void {
    if (this.timeoutHandle) { clearTimeout(this.timeoutHandle); this.timeoutHandle = null; }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.parts = [];
  }
}

function pickSupportedMime(): string {
  const candidates = [
    'audio/webm; codecs=opus',
    'audio/webm',
    'audio/ogg; codecs=opus',
    'audio/mp4',
  ];
  // MediaRecorder.isTypeSupported is the right gate for getUserMedia output.
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}
