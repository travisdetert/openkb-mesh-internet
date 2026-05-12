# openkb-mesh-internet

A learn-by-doing Meshtastic console: connect over USB, watch the mesh, understand power and range.

Talks to a [Meshtastic](https://meshtastic.org/) radio over a USB serial cable, decodes the protobuf stream, and surfaces what's happening on the mesh — node list, map, chat, telemetry, traceroutes, raw sniffer — alongside explainer panels for link budget, RSSI/SNR, coverage, antennas, LoRa CSS, and mesh routing. Built with Electron + React.

## Requirements

- Node.js 20+
- A Meshtastic radio with a USB-serial connection (CP2102, CH340, native ESP32-S3, RP2040, nRF52, etc.)
- A USB **data** cable — charge-only cables won't enumerate the device

## Quick start

```bash
npm install     # also rebuilds better-sqlite3 for Electron
npm start       # builds and launches the app
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server only (no Electron shell) |
| `npm run build` | Type-check + production build of renderer and main |
| `npm run stop` | Kill any running instance |
| `npm run restart` | Stop and start again |

The app stores its SQLite mesh database at `~/.openkb-mesh-internet/mesh.sqlite`.

## Connecting a radio

Plug the radio in, open the app, and use the Connect panel. The wizard enumerates serial ports and classifies each:

- **✓ confirmed** — VID/PID matches a known Meshtastic board
- **◯ likely** — USB-serial chip family commonly used by Meshtastic hardware
- **·** possibly — generic serial port; the protobuf handshake will confirm

### Linux — you must be in the `dialout` group

On Linux, serial devices (`/dev/ttyUSB*`, `/dev/ttyACM*`) are owned by `root:dialout` and not world-writable. If your user isn't in `dialout`, opening the port fails with `EACCES` / *permission denied*.

Fix once, per machine:

```bash
sudo usermod -aG dialout $USER
```

Then **log out and back in** (or run `newgrp dialout` in the shell that launches the app) so the new group takes effect. Verify with:

```bash
ls -l /dev/ttyACM0     # should show root dialout
groups                 # should include dialout
```

Some distros (Arch, openSUSE) use `uucp` instead of `dialout` — check the group on `/dev/ttyACM0` and swap accordingly.

### macOS

Most boards work out of the box. Ports appear as `/dev/cu.usbmodem*` or `/dev/cu.usbserial*`. For older CP2102/CH340 boards you may need the vendor driver from Silicon Labs / WCH. If the port shows up but won't open, another app (the official Meshtastic app/CLI, Arduino IDE, a serial monitor) is probably holding it — close it and retry.

### Windows

Boards using a CP2102 or CH340 may need the vendor driver from Silicon Labs / WCH before they appear as a `COM*` port. Native-USB boards (ESP32-S3, RP2040, nRF52) generally enumerate without a driver. "Access is denied" means another process has the port open.

## Troubleshooting

**No serial ports detected.** The OS itself doesn't see a USB-serial device. Check:
- Cable is a *data* cable, not charge-only (most common cause)
- Try a different USB port, ideally directly on the machine (not through an unpowered hub)
- On Linux/macOS: `lsusb` (Linux) or System Information → USB (macOS) should list the radio
- ESP32-S3 native USB can take 1–2 seconds to enumerate after plug-in — click Rescan

**Permission denied opening /dev/tty…** Linux: see the `dialout` group instructions above. macOS/Windows: another process is holding the port — close any Meshtastic CLI, Arduino IDE, or serial monitor and retry.

**Port is busy.** Same root cause as permission denied on macOS/Windows — another process owns the port. Includes prior instances of this app that didn't shut down cleanly; `npm run stop` will clear them.

**Port disappeared during connect.** The radio rebooted or the cable disconnected mid-handshake. Click Rescan.

## Repo layout

```
electron/         Electron main process — serial I/O, protobuf decode, IPC, SQLite
src/              React renderer — panels, wizard, learn pages
docs/             Topic write-ups (cross-country hop limits, panels plan)
```

## More reading

- [`docs/cross-country-and-hop-limits.md`](docs/cross-country-and-hop-limits.md) — why the mesh can't carry traffic from California to New York
- [`docs/PANELS_PLAN.md`](docs/PANELS_PLAN.md) — internal quality bar for panels
