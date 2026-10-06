<!--
  PROJECT.md — the project charter. One scannable file that answers
  "what is this, and how do we know when it's done?"
  Keep it short. Update Status / Now / Next as work lands.
  Status values: Idea · Building · Usable · Done · Parked · Abandoned
  (Parked = paused, will resume · Abandoned = terminal dead-end; record why + a post-mortem)
-->
# openkb-mesh-internet — Charter

**Status:** Usable
**Updated:** 2026-07-09

## Goal
A learn-by-doing Meshtastic console for tinkerers and ham/LoRa hobbyists. It
connects to a Meshtastic radio over USB serial (or BLE), decodes the protobuf
stream, and surfaces the live mesh — node list, map, chat, telemetry,
traceroutes, raw sniffer — next to explainer panels (link budget, RSSI/SNR,
coverage, antennas, LoRa CSS, mesh routing). The win: someone with a radio and
a cable can plug in and actually *understand* what their mesh is doing — power,
range, and routing — without reading the protobuf spec. Built as an Electron +
React desktop app with a local SQLite history store.

## Definition of Done
v1 is done when all of these are true.
- [x] Connect to a radio over USB serial and decode the live protobuf stream
- [x] Core mesh views work end-to-end: node list, map, chat, telemetry, traceroute, raw sniffer
- [x] BLE transport as an alternative to USB serial
- [x] Local SQLite history store persists mesh state across sessions
- [x] Explainer/learn panels for link budget, RSSI/SNR, coverage, antennas, LoRa, routing
- [x] Packaged desktop builds (macOS DMG; Windows/Linux configured)
- [ ] Cross-platform packaged builds verified on Windows and Linux (not just configured)
- [x] Runs/builds from a fresh checkout (README documents `npm install` / `npm start`)
- [x] Lint clean + build/compile/type-check passes (CI runs the same commands) —
      `npm run lint` (0 errors, 13 `exhaustive-deps` warnings) and `npm run build` are
      green; `.github/workflows/ci.yml` runs both on GitHub (`origin`)
- [ ] Security pass run; findings fixed or accepted (SECURITY.md) — first pass
      2026-10-06; navigation High fixed (ADR 0011); Electron 28 upgrade still open
- [x] Notable decisions recorded (docs/adr/ — 0001–0011)
- [x] Docs current: each subsystem documented + diagrammed, updated with the change —
      architecture (`docs/ARCHITECTURE.md`, Mermaid data-flow + sequence diagrams) and
      panels (`docs/PANELS.md`) documented; individual `src/lib` modules still undocumented

## Now / Next
- **Now:** Nothing actively in progress — telemetry power fixes (battery/voltage
  trust, ⚡ external-power + solar health, per-node voltage-trend chips,
  declining-voltage callouts, percentile congestion readouts, node detail drawer)
  landed on `telemetry-power-fixes`.
- **Next:** Upgrade Electron 28 → a supported major (open High from the first
  security pass), then add a renderer CSP; verify packaged Windows/Linux builds end-to-end on real hardware.
- **Later:** Per-module docs for `src/lib`; broaden explainer panels; richer
  traceroute/coverage visualizations; evaluate Zigbee/Thread hardware notes
  (see `docs/zigbee-thread-hardware.md`).

## Links
Decisions: `docs/adr/` · Security: `SECURITY.md` · Usage: `README.md`
