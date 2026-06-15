# ADR-0006: Decode Meshtastic protobuf in the main process

- **Status:** Accepted
- **Date:** 2026-05-04 *(backfilled 2026-06-14)*
- **Deciders:** Travis Detert

## Context

Meshtastic speaks a protobuf wire format. We need to encode `ToRadio` and decode `FromRadio`
messages using the official schemas. The official `@meshtastic/protobufs` +
`@bufbuild/protobuf` packages are **pure ESM**, while the Electron main process is compiled to
**CommonJS** (`tsconfig.electron.json`) — and CommonJS can't `require()` ESM.

## Decision

Do all protobuf encode/decode in the **main process**, in
`electron/meshtastic/protobuf-codec.ts`, backed by the official schemas. Load the ESM
packages once at startup via **dynamic `import()`**, defeating TypeScript's CommonJS
down-emit with `new Function('s', 'return import(s)')` so the `import()` survives to runtime.
Decoded, structured records — not raw frames — cross the IPC bridge to the renderer.

## Alternatives considered

- **Decode in the renderer** — the serial bytes originate in main; shipping raw frames to the
  renderer just to decode them there duplicates the codec near both transports and the
  database, which also lives in main.
- **Switch the whole main process to ESM output** — broader blast radius across the Electron
  build, native-module interop, and tooling; the targeted dynamic-import shim is far less
  disruptive.
- **Hand-rolled / alternate protobuf runtime** — loses fidelity with upstream schema updates
  from `@meshtastic/protobufs`.

## Consequences

- One codec, co-located with the transports and the SQLite store that consume it.
- The renderer receives clean structured data and never touches protobuf, keeping the IPC
  surface (see [ADR-0007](0007-context-isolated-ipc-bridge.md)) high-level.
- The `new Function`/dynamic-import shim is a deliberate, commented hack tied to the
  CJS-can't-require-ESM constraint; if the main process ever moves to ESM, this can be
  removed.
