# ADR-0005: WebBluetooth in the renderer, proxied to main

- **Status:** Accepted
- **Date:** 2026-05-26 *(backfilled 2026-06-14)*
- **Deciders:** Travis Detert

## Context

We want BLE connectivity to radios without taking on a native BLE binding (e.g. `noble`),
which is notoriously brittle across macOS/Windows/Linux and adds another native module to
build and ship. Electron's Chromium already ships a stable **WebBluetooth** stack — but it
runs in the **renderer**, while `MeshtasticController` and every other transport live in the
**main** process (see [ADR-0004](0004-pluggable-transport-abstraction.md)).

## Decision

Let the **renderer own the actual WebBluetooth GATT connection**. In main, implement a
**`BleProxyTransport`** that satisfies `MeshtasticTransport` but holds no native BLE handle:
its `sendToRadio` emits a `write-request` event that the manager forwards to the renderer
over IPC, and inbound `FromRadio` frames arriving from the renderer over IPC are pushed in
via `ingestFromRadio()`. To the controller it looks like any other transport. One proxy
transport exists per connected BLE device, keyed by `connId`.

```
renderer (WebBluetooth)
     │ ipc: mesh:bleRxFrame ──────────────► ingestFromRadio()
     │ ipc: mesh:bleDisconnected ─────────► signalDisconnect()
     ▲
     │ ipc: mesh:bleTxFrame ◄── manager forwards from 'write-request'
     │ ipc: mesh:bleDisconnectRequest ◄──── 'disconnect-request'
```

## Alternatives considered

- **Native BLE binding in main (`noble`/`abandonware`)** — cross-platform pain, another
  native module to rebuild per Electron ABI, and a worse maintenance story than riding
  Chromium's stack.
- **Move the whole controller into the renderer for BLE** — would split protocol logic across
  processes by transport and break the single-controller model in ADR-0004.

## Consequences

- No native BLE dependency; BLE rides Chromium's maintained WebBluetooth implementation.
- The controller stays transport-agnostic — BLE is "just another transport."
- Cost: a BLE session's bytes cross the IPC boundary twice (renderer ⇆ main), and the main
  process depends on the renderer being alive to move BLE traffic. Device selection and the
  scan banner are necessarily renderer-driven.
- Hardware reset is unavailable over BLE (per the transport contract), so reboot flows fall
  back to the in-protocol reboot path.
