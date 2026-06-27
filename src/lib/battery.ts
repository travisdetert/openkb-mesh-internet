// Battery-level helpers.
//
// Meshtastic firmware reports `batteryLevel` as an integer 0–100, plus the
// sentinel value 101 to mean "running on external power" — no battery, or a
// pack that's full and held on USB/solar. Rendering that raw shows a
// nonsensical "101%", so every display path routes through here instead.

export const BATTERY_POWERED = 101;

/** True when the radio reports external power (the 101 sentinel) rather than a
 *  real charge percentage. */
export function isExternalPower(level?: number): boolean {
  return level !== undefined && level >= BATTERY_POWERED;
}

/** Human label: "⚡ Ext" on external power, "58%" for a real reading, "—" when
 *  unknown. */
export function batteryLabel(level?: number): string {
  if (level === undefined) return '—';
  if (level >= BATTERY_POWERED) return '⚡ Ext';
  return `${level}%`;
}

/** Percentage clamped to 0–100 for bar widths, so the 101 sentinel doesn't
 *  overflow the track. */
export function batteryBarPct(level?: number): number {
  if (level === undefined) return 0;
  return Math.max(0, Math.min(100, level));
}
