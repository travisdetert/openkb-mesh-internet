import React, { useMemo } from 'react';
import type { TabId } from '../TopNav';
import { useMeshContext } from '../../hooks/MeshContext';

interface Props {
  go: (id: TabId) => void;
}

/**
 * Phase-2 placeholder. The flow this panel will support, once esptool-js +
 * the GitHub releases fetcher land:
 *   1. Probe chip family + flash size via esptool synchronisation
 *   2. Match the radio's reported HW model to a Meshtastic release artifact
 *   3. Download the .bin (ESP32) or .uf2 (nRF52/RP2040)
 *   4. Drive the device into bootloader (DTR/RTS for ESP32, 1200-touch for nRF52)
 *   5. Flash with progress, verify, hard reset, re-handshake
 *
 * For now: surface what we already know about the radio so the user can plan,
 * and link out to the official Meshtastic releases page.
 */
export function FirmwarePanel({ go }: Props) {
  const { connections, activeConnId } = useMeshContext();
  const active = useMemo(
    () => connections.find((c) => c.connId === activeConnId) ?? connections[0] ?? null,
    [connections, activeConnId],
  );

  const my = active?.state.myInfo?.myNodeNum;
  const myNode = my && active ? active.nodes.find((n) => n.num === my) : undefined;
  const fw = active?.state.myInfo?.firmwareVersion ?? 'unknown';
  const hw = myNode?.hwModelName ?? 'unknown';

  const releaseUrl = 'https://github.com/meshtastic/firmware/releases/latest';

  return (
    <div className="page">
      <h1 className="page-title">Firmware</h1>
      <p className="page-sub">
        Diagnose, flash, and recover Meshtastic radios. Phase 1 of this panel lists what we know about the connected hardware; flashing lands as Phase 2 once we integrate <code>esptool-js</code> and the GitHub releases fetcher.
      </p>

      {!active && (
        <div className="info-card">
          <p style={{ margin: 0 }}>Connect a radio first. The flashing flow drives the same USB-serial port that the live connection uses, so we'll close the protobuf session before kicking off a flash.</p>
        </div>
      )}

      {active && (
        <>
          <div className="card">
            <div className="card-head-row">
              <h3 style={{ margin: 0 }}>This radio</h3>
              <button className="card-edit-link" onClick={() => go('device-lab')}>Open Device Lab →</button>
            </div>
            <dl className="kv kv-tight">
              <dt>Connection</dt><dd>{active.connId}{active.portPath ? ` · ${active.portPath}` : ''}</dd>
              <dt>Status</dt><dd>{active.state.status}</dd>
              <dt>Hardware</dt><dd>{hw}</dd>
              <dt>Firmware</dt><dd>{fw}</dd>
              <dt>Node</dt><dd>{my ? '!' + my.toString(16).padStart(8, '0') : '—'}</dd>
            </dl>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
              When flashing lands, this card becomes the launch point: detect chip family via <code>esptool-js</code> synchronisation, pick a release artifact, drive the bootloader, write the binary, verify, and reboot — all without leaving the app.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>What this panel will do</h3>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              <li><strong>Probe.</strong> Reset into bootloader, sync with the chip, read its identity (chip family, flash size, MAC, eFuse).</li>
              <li><strong>Match.</strong> Map the radio's <code>hw_model</code> to a Meshtastic release artifact (<code>firmware-tlora-v2-1-1.6-X.Y.Z.bin</code>, <code>nrf52-rak4631-X.Y.Z.uf2</code>, etc.) from the <a href={releaseUrl} target="_blank" rel="noreferrer">official releases</a>.</li>
              <li><strong>Download.</strong> Fetch the binary, verify the SHA, cache it locally for repeated reflashes.</li>
              <li><strong>Flash.</strong> Stream it to the device with progress + ETA. ESP32 uses <code>esptool-js</code>; nRF52 uses the UF2 mass-storage drop; RP2040 likewise.</li>
              <li><strong>Verify &amp; reboot.</strong> Confirm the write, reset out of bootloader, wait for the protobuf handshake to come back up.</li>
              <li><strong>Recover.</strong> If a flash fails mid-write, the device will be left in bootloader mode — retrying from there is safe and is the canonical "brick recovery."</li>
            </ol>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Until Phase 2 ships</h3>
            <p style={{ margin: '0 0 8px', color: 'var(--text-dim)' }}>
              Use the <strong>Device Lab</strong> tab to drive the radio into bootloader mode, then flash it from the command line with the official tooling:
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              <li><strong>ESP32:</strong> <code>esptool.py --port {active.portPath ?? '/dev/tty.usbmodemXXX'} write_flash 0x0 firmware.bin</code> (Device Lab → <em>⤓ Bootloader (ESP32)</em> first)</li>
              <li><strong>nRF52 (UF2):</strong> Device Lab → <em>⤓ DFU (nRF52, 1200-baud)</em>, then drag the <code>.uf2</code> onto the USB drive that appears.</li>
              <li><strong>RP2040:</strong> Hold the BOOTSEL button while plugging the USB cable, then drag the <code>.uf2</code> onto the drive.</li>
            </ul>
            <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
              Releases live at <a href={releaseUrl} target="_blank" rel="noreferrer">{releaseUrl}</a>. Match the file name against your hardware before flashing — the wrong build will brick a device (recoverable, but tedious).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
