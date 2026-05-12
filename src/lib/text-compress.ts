/**
 * DEFLATE-then-base64 compression for chat payloads. Layered above the
 * chunking primitive so a long compressed message can still ride across
 * multiple packets.
 *
 * Wire format: a message that starts with the COMPRESS_PREFIX has its
 * remainder base64-decoded → DEFLATE-inflated → UTF-8 text. Anything
 * not starting with the prefix is passed through as raw text.
 *
 * We use base64 (33% inflation) instead of base91 for simplicity and
 * standard-library support. DEFLATE on English text typically saves
 * 40-60%, so net savings are 7-27% per message — adding up to fewer
 * chunks per send and more air-time headroom.
 *
 * Always-safer policy: if compressing+encoding makes the payload bigger,
 * we skip compression and send the raw text. The receiver detects this
 * because it would never start with the prefix.
 */

const COMPRESS_PREFIX = '\x01Z|';
const MIN_BYTES_TO_ATTEMPT = 80; // not worth even trying below this — DEFLATE overhead alone is ~5-10 B

export function isCompressed(text: string): boolean {
  return text.startsWith(COMPRESS_PREFIX);
}

export interface CompressionResult {
  /** The payload to actually transmit — either the compressed-with-prefix string or the original text. */
  payload: string;
  /** Bytes the raw text would occupy on the wire. */
  rawBytes: number;
  /** Bytes the chosen payload occupies on the wire. */
  wireBytes: number;
  /** True if compression won and we're using the compressed form. */
  used: boolean;
}

export async function maybeCompress(text: string): Promise<CompressionResult> {
  const rawBytes = new TextEncoder().encode(text).length;
  if (rawBytes < MIN_BYTES_TO_ATTEMPT) {
    return { payload: text, rawBytes, wireBytes: rawBytes, used: false };
  }
  try {
    const compressed = await deflateRaw(new TextEncoder().encode(text));
    const b64 = bytesToBase64(compressed);
    const candidate = COMPRESS_PREFIX + b64;
    const candidateBytes = new TextEncoder().encode(candidate).length;
    if (candidateBytes < rawBytes) {
      return { payload: candidate, rawBytes, wireBytes: candidateBytes, used: true };
    }
  } catch {
    /* fall through to raw */
  }
  return { payload: text, rawBytes, wireBytes: rawBytes, used: false };
}

export async function maybeDecompress(text: string): Promise<string> {
  if (!isCompressed(text)) return text;
  try {
    const b64 = text.slice(COMPRESS_PREFIX.length);
    const bytes = base64ToBytes(b64);
    const inflated = await inflateRaw(bytes);
    return new TextDecoder().decode(inflated);
  } catch {
    return text;
  }
}

// ── helpers ──────────────────────────────────────────────────────────

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  // TS's strict typing now distinguishes Uint8Array<ArrayBuffer> from
  // Uint8Array<ArrayBufferLike>; the stream APIs accept the former. Cast.
  writer.write(input as BufferSource);
  writer.close();
  return readAllChunks(cs.readable.getReader());
}

async function inflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(input as BufferSource);
  writer.close();
  return readAllChunks(ds.readable.getReader());
}

async function readAllChunks(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // String.fromCharCode is safe up to ~100k chars; our payloads are < 4KB.
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
