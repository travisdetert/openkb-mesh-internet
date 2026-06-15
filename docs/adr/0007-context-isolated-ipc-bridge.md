# ADR-0007: Context-isolated IPC bridge as the only renderer API

- **Status:** Accepted
- **Date:** 2026-05-02 *(backfilled 2026-06-14)*
- **Deciders:** Travis Detert

## Context

The renderer needs to reach privileged capabilities that live in main — serial ports, the
SQLite store, protobuf decode, OS integration. Exposing Node directly to the renderer
(`nodeIntegration: true`) is the classic Electron security footgun: any rendered content or
dependency could touch the filesystem and serial hardware.

## Decision

Run the renderer with **`contextIsolation: true`** and **`nodeIntegration: false`**. All
main-process capability is exposed through a single, explicit **`contextBridge`** surface in
`electron/preload.ts` — `contextBridge.exposeInMainWorld('mesh', api)` — typed in
`src/global.d.ts`. The renderer calls only `window.mesh.*`; it never sees `ipcRenderer`,
`require`, or Node globals.

## Alternatives considered

- **`nodeIntegration: true`** — simplest wiring, unacceptable security posture for an app
  that opens serial ports and writes the filesystem.
- **Expose raw `ipcRenderer`** — leaks the whole channel namespace and invites ad-hoc,
  untyped messages; a curated `mesh` API keeps the contract small and reviewable.

## Consequences

- The `window.mesh` bridge is *the* API contract between processes — every new capability is
  an explicit, typed addition in `preload.ts` + `global.d.ts`, which keeps the surface
  auditable.
- Slightly more boilerplate per feature (define channel, expose method, type it) — accepted
  as the cost of a hardened boundary.
- The renderer stays incapable of direct hardware/filesystem access, which bounds the blast
  radius of any renderer-side bug or dependency.
