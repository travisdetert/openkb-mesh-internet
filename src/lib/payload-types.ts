/**
 * Typed payloads riding inside chat-text packets.
 *
 * Every "non-text" message we send through Meshtastic's text portnum is
 * encoded as `\x01<type-code>|<payload-bytes-as-base64>`. The receiver
 * decodes this AFTER chunking-reassembly and AFTER decompression — so any
 * type can also be compressed if it helps (deflate wraps the typed marker).
 *
 * Stock Meshtastic clients (T-Deck, official app) will display the markers
 * as text gibberish. They're an openkb-mesh-internet-only convention.
 *
 * Adding a new content type: add the code in TYPE_CODES, extend the
 * DecodedPayload union, add encode/decode branches.
 */

const TYPE_PREFIX = '\x01';
const SEP = '|';

const TYPE_CODES = {
  position: 'P',
  waypoint: 'W',
  voice: 'V',
  image: 'I',
  gpx: 'G',
} as const;

type TypeCode = (typeof TYPE_CODES)[keyof typeof TYPE_CODES];
const CODE_TO_TYPE: Record<string, keyof typeof TYPE_CODES> = Object.fromEntries(
  Object.entries(TYPE_CODES).map(([k, v]) => [v, k as keyof typeof TYPE_CODES]),
);

// ── Concrete payload types ───────────────────────────────────────────

export interface PositionPayload {
  type: 'position';
  /** Decimal degrees, ~7-digit precision. */
  lat: number;
  lon: number;
  /** Meters, optional. */
  alt?: number;
  /** Optional one-line caption ("at the trailhead"). */
  caption?: string;
}

export interface WaypointPayload {
  type: 'waypoint';
  name: string;
  lat: number;
  lon: number;
  /** Optional one-line description. */
  description?: string;
}

export interface VoiceStub  { type: 'voice';  bytes: Uint8Array; durationMs?: number; /* Codec2 frames, decoded by future module */ }
export interface ImageStub  { type: 'image';  bytes: Uint8Array; width?: number; height?: number; /* 1-bit dithered bitmap */ }
export interface GpxStub    { type: 'gpx';    bytes: Uint8Array; /* delta-encoded point chain */ }
export interface TextPayload { type: 'text'; text: string }

export type DecodedPayload = TextPayload | PositionPayload | WaypointPayload | VoiceStub | ImageStub | GpxStub;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Encode a typed payload to the wire string that goes through chunking +
 * compression + the text portnum. Plain-text payloads pass through with no
 * marker, preserving backwards compatibility with un-upgraded clients.
 */
export function encodePayload(p: DecodedPayload): string {
  if (p.type === 'text') return p.text;
  if (p.type === 'position') return encodePosition(p);
  if (p.type === 'waypoint') return encodeWaypoint(p);
  if (p.type === 'voice') return encodeBinary(TYPE_CODES.voice, p.bytes);
  if (p.type === 'image') return encodeBinary(TYPE_CODES.image, p.bytes);
  if (p.type === 'gpx')   return encodeBinary(TYPE_CODES.gpx,   p.bytes);
  // Exhaustive — TS should catch a missing branch here.
  return '';
}

/**
 * Decode whatever came out of decompression + assembly. If the text doesn't
 * carry a known type marker, it's just plain text.
 */
export function decodePayload(text: string): DecodedPayload {
  if (!text.startsWith(TYPE_PREFIX)) return { type: 'text', text };
  if (text.length < 4 || text[2] !== SEP) return { type: 'text', text };
  const code = text[1];
  const body = text.slice(3);
  const kind = CODE_TO_TYPE[code];
  if (!kind) return { type: 'text', text };
  try {
    if (kind === 'position') return decodePosition(body) ?? { type: 'text', text };
    if (kind === 'waypoint') return decodeWaypoint(body) ?? { type: 'text', text };
    if (kind === 'voice' || kind === 'image' || kind === 'gpx') {
      return { type: kind, bytes: base64ToBytes(body) } as DecodedPayload;
    }
  } catch {
    /* fall through to text */
  }
  return { type: 'text', text };
}

/** Convenience: check whether a wire string starts with a known type marker. */
export function isTyped(text: string): boolean {
  if (!text.startsWith(TYPE_PREFIX) || text.length < 4 || text[2] !== SEP) return false;
  return text[1] in CODE_TO_TYPE;
}

// ── Position encoding ────────────────────────────────────────────────
// 12 bytes core (lat, lon, alt as 3× int32 little-endian, with lat/lon
// in 10^7-degree units to match Meshtastic's Position proto). An optional
// UTF-8 caption follows. Base64 of the whole thing is the body.

function encodePosition(p: PositionPayload): string {
  const captionBytes = p.caption ? new TextEncoder().encode(p.caption) : new Uint8Array(0);
  const buf = new Uint8Array(12 + captionBytes.length);
  const view = new DataView(buf.buffer);
  view.setInt32(0,  Math.round(p.lat * 1e7), true);
  view.setInt32(4,  Math.round(p.lon * 1e7), true);
  view.setInt32(8,  p.alt !== undefined ? Math.round(p.alt) : 0, true);
  buf.set(captionBytes, 12);
  return TYPE_PREFIX + TYPE_CODES.position + SEP + bytesToBase64(buf);
}

function decodePosition(body: string): PositionPayload | null {
  const bytes = base64ToBytes(body);
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lat = view.getInt32(0, true) / 1e7;
  const lon = view.getInt32(4, true) / 1e7;
  const alt = view.getInt32(8, true);
  const caption = bytes.length > 12 ? new TextDecoder().decode(bytes.subarray(12)) : undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { type: 'position', lat, lon, alt: alt !== 0 ? alt : undefined, caption };
}

// ── Waypoint encoding ────────────────────────────────────────────────
// 8 bytes lat+lon, then a length-prefixed UTF-8 name, then optional UTF-8
// description.

function encodeWaypoint(p: WaypointPayload): string {
  const nameBytes = new TextEncoder().encode(p.name.slice(0, 64));
  const descBytes = p.description ? new TextEncoder().encode(p.description) : new Uint8Array(0);
  const buf = new Uint8Array(8 + 1 + nameBytes.length + descBytes.length);
  const view = new DataView(buf.buffer);
  view.setInt32(0, Math.round(p.lat * 1e7), true);
  view.setInt32(4, Math.round(p.lon * 1e7), true);
  buf[8] = nameBytes.length & 0xff;
  buf.set(nameBytes, 9);
  buf.set(descBytes, 9 + nameBytes.length);
  return TYPE_PREFIX + TYPE_CODES.waypoint + SEP + bytesToBase64(buf);
}

function decodeWaypoint(body: string): WaypointPayload | null {
  const bytes = base64ToBytes(body);
  if (bytes.length < 9) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lat = view.getInt32(0, true) / 1e7;
  const lon = view.getInt32(4, true) / 1e7;
  const nameLen = bytes[8];
  if (bytes.length < 9 + nameLen) return null;
  const name = new TextDecoder().decode(bytes.subarray(9, 9 + nameLen));
  const description = bytes.length > 9 + nameLen ? new TextDecoder().decode(bytes.subarray(9 + nameLen)) : undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { type: 'waypoint', name, lat, lon, description };
}

// ── Binary stubs (voice / image / gpx) ───────────────────────────────

function encodeBinary(code: TypeCode, bytes: Uint8Array): string {
  return TYPE_PREFIX + code + SEP + bytesToBase64(bytes);
}

// ── base64 helpers (same as text-compress for now; move to a shared
// util when we add a third user) ────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
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
