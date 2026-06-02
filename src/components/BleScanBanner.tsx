import { useBleScan } from './BleScanModal';

/**
 * App-wide banner pinned to the top of the window while a Bluetooth scan is
 * running. The interactive device picker still lives in the Connect panel —
 * this is just the always-visible "we're scanning" status + a Cancel, so the
 * user isn't stranded on another tab wondering why nothing's happening.
 */
export function BleScanBanner() {
  const { active, devices, elapsedMs } = useBleScan();
  if (!active) return null;

  const secs = Math.floor(elapsedMs / 1000);
  const found = devices.length;

  return (
    <div className="ble-scan-banner" role="status">
      <span className="ble-scan-banner-spinner" aria-hidden />
      <span className="ble-scan-banner-icon">📶</span>
      <span className="ble-scan-banner-text">
        Scanning for Bluetooth radios… <span className="ble-scan-banner-secs">{secs}s</span>
        {found > 0 && <span className="ble-scan-banner-count"> · {found} found — pick one in Connect</span>}
      </span>
      <button
        className="ble-scan-banner-cancel"
        onClick={() => window.mesh.bleScanCancel()}
      >
        Cancel
      </button>
    </div>
  );
}
