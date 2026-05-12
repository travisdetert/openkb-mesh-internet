/**
 * Lightweight text-time transforms for chat:
 *
 *   1. Emoji shortcodes:  ":tu:" → 👍
 *   2. Phrase macros:     ":eta 10:" → "ETA 10 min"
 *   3. Slash commands:    "/me waves" → "* travis waves"
 *
 * Plus detection helpers used at render time:
 *
 *   4. findCoords(text) — locate "37.123, -121.45" substrings
 *   5. findUrls(text)   — locate http(s) URLs
 *
 * All operations are pure functions of strings (or numbers/strings out) so
 * they're trivial to test and reason about. The React component that uses
 * findCoords/findUrls to render inline chips lives in SmartText.tsx.
 */

// ── Emoji shortcodes ──────────────────────────────────────────────────

const SHORTCODES: Record<string, string> = {
  ':tu:': '👍',  ':td:': '👎',  ':ok:': '👌',  ':fire:': '🔥',
  ':check:': '✓', ':x:': '✗',   ':warn:': '⚠️', ':heart:': '❤️',
  ':eyes:': '👀', ':wave:': '👋', ':tada:': '🎉', ':zzz:': '💤',
  ':laugh:': '😂', ':smile:': '🙂', ':wink:': '😉', ':sob:': '😭',
  ':rocket:': '🚀', ':100:': '💯', ':pray:': '🙏', ':star:': '⭐',
  ':sun:': '☀️', ':rain:': '🌧️', ':snow:': '❄️', ':bolt:': '⚡',
  ':car:': '🚗', ':boat:': '⛵', ':plane:': '✈️', ':bike:': '🚲',
  ':food:': '🍔', ':coffee:': '☕', ':beer:': '🍺', ':camp:': '🏕️',
  ':sos:': '🆘', ':med:': '⚕️', ':tools:': '🛠️', ':map:': '🗺️',
};

export function listShortcodes(): Array<{ code: string; emoji: string }> {
  return Object.entries(SHORTCODES).map(([code, emoji]) => ({ code, emoji }));
}

/**
 * Replace shortcode tokens with their emoji equivalents. Unknown codes
 * (e.g. `:foo:`) are left alone so the user sees what they typed instead
 * of a silent disappearance.
 */
export function expandShortcodes(text: string): string {
  return text.replace(/:[a-z0-9]+:/gi, (m) => SHORTCODES[m.toLowerCase()] ?? m);
}

// ── Phrase macros ─────────────────────────────────────────────────────
// Argument-bearing tokens that expand to longer canonical phrases. The
// argument capture is non-greedy so `:eta 10: rest` doesn't eat ": rest".

export function expandMacros(text: string): string {
  return text
    .replace(/:eta\s+(\d+)\s*:/gi, (_, n) => `ETA ${n} min`)
    .replace(/:at\s+([^:]+):/gi, (_, place) => `At ${place.trim()}`)
    .replace(/:in\s+(\d+)\s*:/gi, (_, n) => `In ${n} min`);
}

/** Convenience: run both expansions in the canonical order. */
export function expandSmartText(text: string): string {
  return expandShortcodes(expandMacros(text));
}

// ── Slash commands ────────────────────────────────────────────────────

export type SlashCommand =
  | { kind: 'me'; action: string }
  | { kind: 'position' }
  | { kind: 'help' }
  | { kind: 'shortcodes' }
  | { kind: 'unknown'; cmd: string };

/** Parse a slash command from the start of the text. Returns null if not one. */
export function parseSlashCommand(text: string): SlashCommand | null {
  if (!text.startsWith('/')) return null;
  const [cmdRaw, ...rest] = text.slice(1).split(' ');
  const cmd = cmdRaw.toLowerCase();
  const args = rest.join(' ');
  switch (cmd) {
    case 'me':         return { kind: 'me', action: args };
    case 'position':
    case 'pos':        return { kind: 'position' };
    case 'help':       return { kind: 'help' };
    case 'shortcodes':
    case 'emojis':     return { kind: 'shortcodes' };
    default:           return { kind: 'unknown', cmd };
  }
}

// ── Inline lat/lon detection ──────────────────────────────────────────
// Matches: 37.12345,-121.45 / 37.1, -121.4 / 37.12345, -121.45678
// Excludes integers (no decimal point) to avoid false positives on plain numbers.
// Validates lat ∈ [-90,90] and lon ∈ [-180,180] so "1000.0, 0.0" doesn't match.

const COORD_RE = /(-?\d{1,3}\.\d{1,7})\s*,\s*(-?\d{1,3}\.\d{1,7})/g;

export interface CoordMatch {
  start: number;
  end: number;
  lat: number;
  lon: number;
}

export function findCoords(text: string): CoordMatch[] {
  const out: CoordMatch[] = [];
  for (const m of text.matchAll(COORD_RE)) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && m.index !== undefined) {
      out.push({ start: m.index, end: m.index + m[0].length, lat, lon });
    }
  }
  return out;
}

// ── URL detection ─────────────────────────────────────────────────────
// Conservative: only http(s) URLs, terminated by whitespace or end of string.
// Doesn't try to be a full URL parser — false positives are inert (the user
// sees a "broken" link), false negatives just stay as plain text.

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/g;

export interface UrlMatch {
  start: number;
  end: number;
  url: string;
}

export function findUrls(text: string): UrlMatch[] {
  const out: UrlMatch[] = [];
  for (const m of text.matchAll(URL_RE)) {
    if (m.index !== undefined) {
      out.push({ start: m.index, end: m.index + m[0].length, url: m[0] });
    }
  }
  return out;
}
