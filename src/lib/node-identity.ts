// Canonical helpers for formatting Meshtastic node identity.
//
// A node has up to four name-ish things:
//   - num        : 32-bit unsigned integer (the on-the-wire ID)
//   - id         : "!aabbccdd" string form of num (Meshtastic convention)
//   - shortName  : user-set 4-char nickname (e.g. "TRAV")
//   - longName   : user-set human-readable name (e.g. "Travis's HV3")
//
// Each component below was previously duplicated across NodesPanel,
// ChatPanel, DeliveryPanel, EventFeedPanel, and TraceroutePanel. Keep new
// callers using these helpers so the formatting stays consistent.

/** Full Meshtastic-style ID: "!aabbccdd" (8 hex digits). */
export function nodeIdHex(num: number): string {
  return '!' + (num >>> 0).toString(16).padStart(8, '0');
}

/** Short ID variant: "!ccdd" (last 4 hex digits). Used as a nickname
 *  fallback when shortName isn't set and we want something compact. */
export function nodeShortHex(num: number): string {
  return '!' + (num >>> 0).toString(16).padStart(8, '0').slice(-4);
}

/**
 * Best inline display name for a node — favours human-typed shortName,
 * falls back to the 4-char synthetic nickname. Use this for chips,
 * mentions, and table cells where space is tight.
 */
export function nodeDisplayName(nodes: { num: number; shortName?: string }[], num: number): string {
  const n = nodes.find((x) => x.num === num);
  return n?.shortName || nodeShortHex(num);
}

/**
 * Best long-form name for a node — longName, then shortName, then the
 * 4-char synthetic nickname. Use this for headers, full-row detail labels,
 * and other "this is who you're looking at" surfaces.
 */
export function nodeLongName(
  nodes: { num: number; shortName?: string; longName?: string }[],
  num: number,
): string {
  const n = nodes.find((x) => x.num === num);
  return n?.longName || n?.shortName || nodeShortHex(num);
}

/**
 * Stable per-node accent color. Uses the golden angle (137.508°) so that
 * sequential node numbers spread maximally around the hue wheel, giving
 * visually distinct colors for chart lines, chips, and map markers. Was
 * duplicated across Telemetry, Traceroute, Packet Sniffer, Link Budget,
 * and RSSI vs Distance panels.
 */
export function nodeColor(num: number): string {
  const hue = ((num >>> 0) * 137.508) % 360;
  return `hsl(${hue}, 65%, 65%)`;
}
