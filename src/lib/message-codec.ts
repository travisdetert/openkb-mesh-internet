/**
 * Multi-packet message encoding/decoding for Meshtastic chat.
 *
 * Meshtastic's text portnum is capped at ~230 bytes per packet. To send longer
 * messages (notes, URLs, voice/image data later), we split into chunks and
 * mark each one with a small header so the receiver can reassemble. The
 * header is plain printable + an unobtrusive control prefix so it's compact
 * and unlikely to collide with anyone's actual chat text.
 *
 * Header format (per chunk):
 *
 *   \x02CK<id>:<n>/<total>:<content>
 *
 *   \x02CK  Three-byte marker — STX, 'C', 'K'. STX (0x02) almost never appears
 *           in real chat traffic, so the marker is a strong signal.
 *   <id>    4 hex chars — disambiguates concurrent multi-chunk messages.
 *   <n>     1-3 digit 1-based chunk index.
 *   <total> 1-3 digit total chunk count.
 *
 * The header is ~14 bytes, so each chunk's payload budget is ~216 bytes.
 *
 * Stock Meshtastic clients (T-Deck, official app) will display the raw text
 * including the marker — they don't know how to reassemble. This format is
 * specific to clients that opt in (this app, future openkb-mesh clients).
 */

const CHUNK_MARKER = '\x02CK';
const MAX_BYTES_PER_CHUNK = 200; // payload budget per chunk (leaves room for header + safety margin)
const HEADER_OVERHEAD = 16;       // approx \x02CK<4hex>:<3digit>/<3digit>:

/** Hard upper bound on chunked message size (in chunks). Keeps duty cycle sane. */
export const MAX_CHUNKS = 20;

export interface ChunkPlan {
  /** Chunks ready to send, in order. Each is a full Meshtastic text payload. */
  chunks: string[];
  /** Unique blob id (4 hex chars). */
  id: string;
  /** Estimated total bytes across all chunks (including headers). */
  totalBytes: number;
}

/**
 * Split a text into chunks. Returns a ChunkPlan with N pre-encoded chunk
 * payloads. If the input fits in a single packet (no chunking needed),
 * returns a single-chunk plan (still wrapped with the marker, so the
 * receiver knows to strip — alternatively the caller can skip chunking
 * for short texts and send raw).
 */
export function chunkText(text: string, opts?: { maxBytesPerChunk?: number; idOverride?: string }): ChunkPlan {
  const max = Math.max(50, (opts?.maxBytesPerChunk ?? MAX_BYTES_PER_CHUNK));
  const id = opts?.idOverride ?? Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  const enc = new TextEncoder();

  // Greedy character-by-character expansion respecting the UTF-8 byte budget.
  // We never split a UTF-8 multi-byte codepoint in the middle.
  const parts: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let lastFit = pos + 1;
    let end = pos + 1;
    while (end <= text.length) {
      // Skip if we're in the middle of a surrogate pair
      if (end < text.length) {
        const code = text.charCodeAt(end);
        if (code >= 0xDC00 && code <= 0xDFFF) {
          end++;
          continue;
        }
      }
      const bytes = enc.encode(text.slice(pos, end)).length;
      if (bytes > max) break;
      lastFit = end;
      end++;
    }
    parts.push(text.slice(pos, lastFit));
    pos = lastFit;
  }

  const total = Math.min(parts.length, MAX_CHUNKS);
  const chunks = parts.slice(0, total).map((p, i) => `${CHUNK_MARKER}${id}:${i + 1}/${total}:${p}`);
  const totalBytes = chunks.reduce((sum, c) => sum + enc.encode(c).length, 0);
  return { chunks, id, totalBytes };
}

export interface ParsedChunk {
  id: string;
  index: number; // 1-based
  total: number;
  content: string;
}

const PARSE_RE = /^([0-9a-fA-F]+):(\d+)\/(\d+):/;

export function parseChunk(text: string): ParsedChunk | null {
  if (!text.startsWith(CHUNK_MARKER)) return null;
  const rest = text.slice(CHUNK_MARKER.length);
  const m = rest.match(PARSE_RE);
  if (!m) return null;
  const id = m[1].toLowerCase();
  const index = parseInt(m[2], 10);
  const total = parseInt(m[3], 10);
  const content = rest.slice(m[0].length);
  if (!index || !total || index > total || total > MAX_CHUNKS) return null;
  return { id, index, total, content };
}

export function isChunk(text: string): boolean {
  return text.startsWith(CHUNK_MARKER);
}

/**
 * Group an arbitrary list of TextMessage-like objects into "blobs" — partial
 * or complete multi-chunk messages — plus pass-through singletons for normal
 * unchunked text.
 *
 * The result lists each message in the order of its FIRST chunk's arrival
 * (or the message's own arrival, for non-chunked).
 */
export interface AssembledMessage<M extends { text: string }> {
  /** All chunks that make up this message (or just the single message for non-chunked). */
  parts: M[];
  /** The most recent chunk's slot (for sorting). */
  representative: M;
  /** True when every expected chunk has arrived. */
  complete: boolean;
  /** Assembled text — for complete chunked messages, this is the joined content. For incomplete, the parts already received in order. For non-chunked, just the text. */
  text: string;
  /** True if this message came from > 1 chunk. */
  chunked: boolean;
  /** Total expected chunks (or 1 for non-chunked). */
  total: number;
  /** Number of chunks actually received. */
  received: number;
  /** Blob id, only set for chunked. */
  id?: string;
}

export function assembleMessages<M extends { id: number; from: number; text: string }>(
  messages: M[],
): Array<AssembledMessage<M>> {
  type Key = string;
  // Key by (from, blob id) — same id across different senders is treated as
  // separate blobs, which is what we want for cross-talk safety.
  const groups = new Map<Key, { parts: Map<number, M>; total: number; firstSeenIdx: number }>();
  const singletons: Array<{ idx: number; m: M }> = [];

  messages.forEach((m, idx) => {
    const parsed = parseChunk(m.text);
    if (parsed) {
      const key = `${m.from}:${parsed.id}`;
      const g = groups.get(key) ?? { parts: new Map<number, M>(), total: parsed.total, firstSeenIdx: idx };
      g.parts.set(parsed.index, m);
      g.total = Math.max(g.total, parsed.total);
      groups.set(key, g);
    } else {
      singletons.push({ idx, m });
    }
  });

  // Build the output array preserving order by firstSeenIdx (groups) or idx (singletons).
  const entries: Array<{ idx: number; assembled: AssembledMessage<M> }> = [];

  for (const [, g] of groups) {
    const indices = Array.from(g.parts.keys()).sort((a, b) => a - b);
    const partsOrdered = indices.map((i) => g.parts.get(i)!);
    const complete = indices.length === g.total && indices[0] === 1 && indices[indices.length - 1] === g.total;
    const text = complete
      ? partsOrdered.map((p) => parseChunk(p.text)!.content).join('')
      : partsOrdered.map((p) => parseChunk(p.text)!.content).join('') + (complete ? '' : ` …[${g.total - indices.length} chunk${g.total - indices.length === 1 ? '' : 's'} missing]`);
    const representative = partsOrdered[partsOrdered.length - 1];
    entries.push({
      idx: g.firstSeenIdx,
      assembled: {
        parts: partsOrdered,
        representative,
        complete,
        text,
        chunked: true,
        total: g.total,
        received: indices.length,
        id: parseChunk(partsOrdered[0].text)?.id,
      },
    });
  }
  for (const { idx, m } of singletons) {
    entries.push({
      idx,
      assembled: {
        parts: [m],
        representative: m,
        complete: true,
        text: m.text,
        chunked: false,
        total: 1,
        received: 1,
      },
    });
  }

  entries.sort((a, b) => a.idx - b.idx);
  return entries.map((e) => e.assembled);
}
