/**
 * Approximate LoRa time-on-air estimator for chat-sized payloads.
 *
 * We use the Meshtastic preset's published 50-byte airtime as the reference
 * and scale linearly with payload size. That ignores the preamble's constant
 * cost, which slightly under-estimates very small messages, but it's plenty
 * good for "is this gonna take half a second or six seconds?" UI feedback.
 *
 * If we can't match the preset (e.g. radio is set to custom SF/BW/CR), we
 * fall back to a first-principles formula using bitrate.
 */

import { LORA_PRESETS } from '../data/lora-presets';

/** Per-message header + encryption + framing overhead (rough). */
const OVERHEAD_BYTES = 22;

/** Returns estimated time-on-air in seconds for a given text payload. */
export function estimateAirtimeSec(textBytes: number, presetName?: string, sf?: number, bw?: number): number {
  const payloadBytes = textBytes + OVERHEAD_BYTES;

  if (presetName) {
    const preset = LORA_PRESETS.find((p) => p.label === presetName || p.id === presetName);
    if (preset) {
      // Scale linearly off the 50-byte reference.
      return (payloadBytes / 50) * preset.airtimeSec_50byte;
    }
  }

  // Fallback: rough bitrate formula. Symbol time = 2^SF / BW (sec).
  // Effective bitrate ≈ SF * (BW / 2^SF) * 0.8 (coding-rate efficiency).
  if (sf && bw) {
    const symbolTime = Math.pow(2, sf) / bw;
    const bitrate = sf * (1 / symbolTime) * 0.8; // bits/sec
    return payloadBytes * 8 / bitrate;
  }

  // Last-resort default (LongFast, ~1 sec per 50 bytes).
  return (payloadBytes / 50) * 1.0;
}

/** UTF-8 byte length of a string — matters because Meshtastic limits BYTES not chars. */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Recommended soft / hard text limits in BYTES (UTF-8). */
export const SOFT_BYTE_LIMIT = 200;
export const HARD_BYTE_LIMIT = 230;
