# ADR-0002: Electron + React + Vite + TypeScript app shell

- **Status:** Accepted
- **Date:** 2026-05-02 *(backfilled 2026-06-14)*
- **Deciders:** Travis Detert

## Context

The app must talk to a Meshtastic radio over a **USB serial** cable — which needs Node-level
access to a serial port that a browser sandbox cannot grant — while also presenting a rich,
interactive UI (live map, charts, master/detail panels, educational visualizations). It's a
single-developer desktop app that should ship as an installable binary on macOS first, with
Windows and Linux to follow.

## Decision

Build a **desktop app on Electron 28**, with a **React 18** renderer bundled by **Vite 5**,
written end-to-end in **TypeScript**. The renderer builds to `dist/` and the main process
compiles separately via `tsconfig.electron.json` to `dist-electron/`.

## Alternatives considered

- **Web app + Web Serial API** — no native serial dependency, but Web Serial is
  Chromium-only, requires per-session user gesture to pick a port, can't run headless/native
  resets, and gives no place for a persistent local database.
- **Tauri** — lighter binary, but the serial + protobuf + native-SQLite stack is more mature
  on Node/Electron, and the BLE story (see ADR-0005) leans on Chromium's WebBluetooth.
- **Native (Swift/C++) app** — best footprint, far higher cost for one developer and throws
  away the web UI ecosystem the educational panels depend on.

## Consequences

- Full Node access in the main process for serial I/O, native SQLite, and OS integration.
- Two build targets (renderer via Vite, main via `tsc`) to keep in sync — captured in the
  `build` script.
- Larger binaries and an Electron security surface, which we contain via context isolation
  (see [ADR-0007](0007-context-isolated-ipc-bridge.md)).
- Native modules (`better-sqlite3`, `serialport`) must be rebuilt for Electron's ABI —
  handled by `electron-builder install-app-deps` in `postinstall`.
