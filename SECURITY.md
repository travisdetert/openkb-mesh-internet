# Security Posture — openkb-mesh-internet

A local-first Electron desktop app that talks to a Meshtastic radio over USB
serial / BLE. It has no backend, no accounts, and makes no outbound network
calls of its own. The threat surface is local: device I/O, untrusted radio
data, the renderer/main IPC boundary, and a local database file.

## Sensitive data / secrets
- **No credentials or API keys.** The app authenticates to nothing.
- Mesh data (node IDs, positions, chat messages, telemetry) is stored
  unencrypted in a local SQLite DB at `~/.openkb-mesh-internet/mesh.sqlite`.
  Treat that file as containing potentially sensitive location/chat history;
  it never leaves the machine.
- No secrets are committed. Run `gitleaks` to keep it that way.

## External / untrusted inputs
- **The radio's protobuf stream is untrusted input.** Frames come off a serial
  cable or BLE characteristic and are attacker-influenceable (anyone on the
  mesh, or a malicious/faulty device). Decode defensively; never assume a frame
  is well-formed. Protobuf decode runs in the main process (ADR 0006).
- Serial port enumeration / device VID-PID strings are OS-provided but should
  still be treated as display data, not trusted commands.

## Network / IPC / process-exec / filesystem surfaces
- **IPC:** context-isolated preload bridge between renderer and main (ADR 0007).
  Keep the exposed surface minimal and validate every argument crossing it;
  the renderer must not be able to drive arbitrary main-process actions.
- **BLE in renderer, proxied to main** (ADR 0005) — review that proxy boundary
  when it changes.
- **Process exec:** npm scripts shell out (`pkill`/`pgrep` in stop/restart).
  Keep these patterns narrowly scoped; never interpolate untrusted input.
- **Filesystem:** writes the SQLite DB and a tail-able log under the user's home
  dir; no arbitrary path handling from untrusted input.
- **No inbound listeners, no outbound HTTP.** If that ever changes, re-review.

## Security-pass procedure
Run before the first push and whenever a change touches device I/O, the IPC
bridge, protobuf decode, process execution, filesystem paths, or dependencies:
- `/security-review` skill on the pending diff/branch.
- `gitleaks dir --no-banner .` — secret scan.
- `osv-scanner scan source --recursive .` plus `npm audit` — dependency CVEs
  (note the native modules: better-sqlite3, serialport).
- `semgrep --config auto` scoped to the changed paths (electron/ and src/).

Fix High/Critical before pushing; surface Medium/Low with a short note in the
PR/commit body. Record notable security tradeoffs as an ADR.

## Security passes
Append-only log. Each entry: date, scope (diff/branch/full), tools run, outcome.

> A full first security pass is still **due** — see PROJECT.md DoD. No dated
> entries yet; add one here the first time a pass runs.

## Accepted risks
Medium/Low items consciously deferred — what, why, and revisit-when.

- **Mesh history stored unencrypted** at `~/.openkb-mesh-internet/mesh.sqlite`
  (node IDs, positions, chat, telemetry). Accepted for a local-first, single-user
  desktop app with no accounts; the file never leaves the machine. Revisit if the
  app ever gains multi-user, sync, or export-to-cloud features.
