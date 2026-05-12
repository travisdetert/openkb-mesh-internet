/**
 * Helpers that mirror what the Meshtastic firmware itself computes when it
 * stamps each transmitted packet with a channel identifier. Two radios on the
 * "same" channel by name + PSK will compute the same hash; receivers use that
 * hash to decide which channel slot's PSK to try for decryption.
 *
 * Source: meshtastic-firmware/src/mesh/Channels.cpp `generateHash`.
 *   hash = xorBytes(name) ^ xorBytes(psk)   (folded to 8 bits)
 */

function xorFold(bytes: ArrayLike<number>): number {
  let out = 0;
  for (let i = 0; i < bytes.length; i++) out ^= bytes[i] & 0xff;
  return out & 0xff;
}

/** Compute the 8-bit channel hash for a given name + PSK byte array. */
export function channelHash(name: string, psk: number[]): number {
  const nameBytes = new TextEncoder().encode(name);
  return (xorFold(nameBytes) ^ xorFold(psk)) & 0xff;
}

/** Format an 8-bit channel hash as a 2-char uppercase hex string. */
export function channelHashHex(hash: number): string {
  return (hash & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Short human-friendly fingerprint of a PSK — the first 4 and last 2 bytes in
 * hex. NOT cryptographically meaningful; just enough to spot two visually
 * identical keys at a glance.
 */
export function pskFingerprint(psk: number[]): string {
  if (psk.length === 0) return 'open';
  if (psk.length === 1 && psk[0] === 0x01) return 'default';
  if (psk.length < 6) return psk.map((b) => b.toString(16).padStart(2, '0')).join('');
  const head = psk.slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
  const tail = psk.slice(-2).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${head}…${tail}`;
}

export function pskLabel(len: number): string {
  if (len === 0) return 'open (no PSK)';
  if (len === 1) return 'default key';
  if (len === 16) return 'AES-128';
  if (len === 32) return 'AES-256';
  return `${len}-byte custom`;
}
