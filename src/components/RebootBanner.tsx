import type { RebootEntry } from '../hooks/MeshContext';

/**
 * App-wide banner shown while one or more radios are mid-reboot, using the
 * same top-of-window strip pattern as the BLE scan banner. App re-renders
 * once a second while reboots are pending, so the countdown stays live; the
 * entry (and this banner) clears automatically when the radio re-enumerates.
 *
 * Wording mirrors the sidebar's per-radio reboot rows: a 5s pre-reboot
 * countdown, then "restarting · Ns" until it comes back.
 */
export function RebootBanner({ reboots, now }: { reboots: Record<string, RebootEntry>; now: number }) {
  const entries = Object.values(reboots);
  if (entries.length === 0) return null;

  const labelFor = (e: RebootEntry, num: string) =>
    e.shortName || e.longName || e.portPath?.split('/').pop() || `!${parseInt(num, 10).toString(16).padStart(8, '0')}`;

  let text: string;
  if (entries.length === 1) {
    const [num, e] = Object.entries(reboots)[0];
    const elapsed = Math.floor((now - e.startedAt) / 1000);
    const remaining = Math.max(0, 5 - elapsed);
    const phase = remaining > 0 ? `rebooting in ${remaining}s…` : `restarting · ${elapsed}s`;
    text = `Reboot · ${labelFor(e, num)} ${phase}`;
  } else {
    text = `Rebooting ${entries.length} radios…`;
  }

  return (
    <div className="reboot-banner" role="status">
      <span className="reboot-banner-spinner" aria-hidden />
      <span className="reboot-banner-text">{text}</span>
      <span className="reboot-banner-hint">auto-reconnects when it returns</span>
    </div>
  );
}
