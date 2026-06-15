# ADR-0004: Pluggable transport abstraction (serial / BLE / TCP)

- **Status:** Accepted
- **Date:** 2026-05-20 *(backfilled 2026-06-14)*
- **Deciders:** Travis Detert

## Context

A Meshtastic radio can be reached over **USB serial**, **Bluetooth LE**, or **Wi-Fi/TCP**.
Each link has a different framing and lifecycle: serial wraps payloads in the `0x94 0xC3`
frame and supports hardware resets (DTR/RTS, 1200-baud touch); BLE and TCP send each
protobuf message as a discrete GATT write / TCP message and can't do a hardware reset. The
controller that drives the Meshtastic protocol shouldn't care which link is underneath.

## Decision

Define a **`MeshtasticTransport` interface** (`electron/meshtastic/transport.ts`) that
exchanges **unframed `ToRadio`/`FromRadio` protobuf payloads**. Framing is the transport's
private responsibility — it lives inside `MeshtasticSerialConnection` and does not exist for
BLE/TCP. `MeshtasticController` talks only to the interface. A `TransportKind` of
`'serial' | 'ble' | 'tcp'` tags each implementation; link-specific capabilities (e.g.
`ResetProfile`) are part of the contract and simply throw "not supported" where they don't
apply.

## Alternatives considered

- **Bake serial assumptions into the controller** — fastest to write first, but every BLE/TCP
  feature would then fight the framing logic; the `0x94 0xC3` frame would leak everywhere.
- **Separate controllers per transport** — duplicates all the protocol/state-machine logic
  three times and drifts out of sync.

## Consequences

- BLE (see [ADR-0005](0005-webbluetooth-in-renderer-proxied-to-main.md)) and a future TCP
  transport drop in without touching controller logic.
- A shared `PortStats` / `DeviceEvent` vocabulary powers the Device Lab panel uniformly
  across links, even though some fields (`framesCorrupt`, `reconnectCount`) are
  serial-only and reported as honest zeros elsewhere.
- The contract carries some serial-shaped concepts (reset profiles, frame counters) that are
  inert for other transports — a small leakage we accept for one uniform interface.
- TCP is declared in the type union but **not yet implemented**; the abstraction reserves the
  seat.
