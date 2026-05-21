import React, { useEffect, useState } from 'react';

interface BleDevice {
  deviceId: string;
  deviceName: string;
  alreadyOnUsb: boolean;
}

/**
 * Live BLE chooser. Subscribes to scan events from main and renders the
 * list of nearby BLE devices the moment Chromium reports them. Replaces
 * the previous auto-pick-and-hope flow that left the user staring at a
 * spinner with no idea what was happening.
 *
 * Lifecycle is fully reactive to main's scan state: it shows itself when
 * the first scan-update event arrives and hides itself when the scan
 * ends. The Bluetooth button in ConnectionWizard kicks off the underlying
 * requestDevice() — that's what causes main to start firing scan events.
 */
export function BleScanModal() {
  const [active, setActive] = useState(false);
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const offUpdate = window.mesh.onBleScanUpdate((p) => {
      setActive(true);
      setDevices(p.devices);
      setElapsedMs(p.elapsedMs);
    });
    const offEnded = window.mesh.onBleScanEnded(() => {
      setActive(false);
      setDevices([]);
      setElapsedMs(0);
    });
    return () => { offUpdate(); offEnded(); };
  }, []);

  // Local 1Hz tick so the elapsed-seconds label stays accurate even when
  // Chromium isn't firing new scan-update events.
  useEffect(() => {
    if (!active) return;
    const start = Date.now() - elapsedMs;
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  // Heuristic: name pattern that looks Meshtastic-ish. Default firmware
  // names start with "Meshtastic_" + last-4 of node id, but users do
  // customize, so we also accept names containing common chips/boards.
  // The point isn't to filter — it's to give the user a visual hint about
  // which row to click.
  const looksMeshtastic = (name: string) => /Meshtastic|mesh|^[A-Z]{2,4}_[A-F0-9]{4}$/i.test(name);

  const meshtasticCount = devices.filter((d) => looksMeshtastic(d.deviceName)).length;
  const elapsedS = Math.floor(elapsedMs / 1000);

  // Sort: Meshtastic-ish first (highest priority), then named devices,
  // then unnamed. Already-on-USB radios sink to the bottom since they're
  // disabled. Preserve OS discovery order within each bucket so the list
  // doesn't jitter as new advertisements arrive.
  const sorted = devices
    .map((d, i) => ({ d, i, meshy: looksMeshtastic(d.deviceName) }))
    .sort((a, b) => {
      if (a.d.alreadyOnUsb !== b.d.alreadyOnUsb) return a.d.alreadyOnUsb ? 1 : -1;
      if (a.meshy !== b.meshy) return a.meshy ? -1 : 1;
      const aNamed = a.d.deviceName.length > 0;
      const bNamed = b.d.deviceName.length > 0;
      if (aNamed !== bNamed) return aNamed ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.d);

  const pick = (deviceId: string) => {
    void window.mesh.bleScanPick(deviceId);
  };
  const cancel = () => {
    void window.mesh.bleScanCancel();
  };

  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-label="Bluetooth device chooser">
      <div className="ble-scan-modal">
        <div className="ble-scan-head">
          <h2 style={{ margin: 0, fontSize: 17 }}>Pick a Bluetooth radio</h2>
          <button className="ghost" onClick={cancel} aria-label="Cancel scan">Cancel</button>
        </div>
        <div className="ble-scan-meta">
          <span className="ble-scan-spinner" aria-hidden="true" />
          <span>
            Scanning… {elapsedS}s · {devices.length} device{devices.length === 1 ? '' : 's'} visible
            {meshtasticCount > 0 && <> · <strong style={{ color: 'var(--good)' }}>{meshtasticCount} look Meshtastic-ish</strong></>}
          </span>
        </div>

        {devices.length === 0 ? (
          <div className="ble-scan-empty">
            <p style={{ margin: '0 0 6px', fontSize: 13 }}>Nothing visible yet — common causes:</p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
              <li>The radio is paired to the official Meshtastic phone app — most firmware only allows <strong>one</strong> BLE client at a time. Force-quit / disconnect the phone app, then try again.</li>
              <li>Bluetooth is disabled on the radio. Plug in over USB once and check the BLE badge on the connection chip.</li>
              <li>Some firmware suppresses BLE advertising while a USB host is actively reading — unplug USB and rescan.</li>
              <li>macOS Bluetooth permission may not be granted to this app yet. Check <em>System Settings → Privacy &amp; Security → Bluetooth</em>.</li>
              <li>Radio is out of range or powered off.</li>
            </ul>
          </div>
        ) : (
          <ul className="ble-scan-list">
            {sorted.map((d) => {
              const meshy = looksMeshtastic(d.deviceName);
              return (
                <li key={d.deviceId}>
                  <button
                    className={'ble-scan-row' + (meshy ? ' meshy' : '') + (d.alreadyOnUsb ? ' usb-warn' : '')}
                    onClick={() => pick(d.deviceId)}
                    disabled={d.alreadyOnUsb}
                    title={d.alreadyOnUsb ? 'This radio is already attached over USB. Concurrent USB + BLE on the same chip can wedge firmware — disconnect USB first.' : undefined}
                  >
                    <div className="ble-scan-row-main">
                      <span className="ble-scan-row-name">{d.deviceName || <em style={{ color: 'var(--text-faint)' }}>(unnamed)</em>}</span>
                      {meshy && <span className="ble-scan-pill good">Meshtastic-ish</span>}
                      {d.alreadyOnUsb && <span className="ble-scan-pill warn">already on USB</span>}
                    </div>
                    <div className="ble-scan-row-id">{d.deviceId.slice(0, 24)}{d.deviceId.length > 24 ? '…' : ''}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="ble-scan-footer">
          Pick any row to connect. After a successful GATT handshake the radio will appear in the Connect chips like a USB radio.
          {elapsedS > 30 && devices.length === 0 && <> · Scan will auto-cancel at 60s.</>}
        </p>
      </div>
    </div>
  );
}
