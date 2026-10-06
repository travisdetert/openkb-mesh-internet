# Security Posture — openkb-mesh-internet

A local-first Electron desktop app that talks to a Meshtastic radio over USB
serial / BLE. It has no backend and no accounts; its only outbound traffic is
map tiles (see below). The threat surface is local: device I/O, untrusted radio
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
- **Navigation:** the main window never leaves the app origin; links from chat
  open in the system browser (ADR 0011).
- **No inbound listeners.** The only outbound HTTP is map basemap tiles from
  CARTO (`basemaps.cartocdn.com`) and Esri (`server.arcgisonline.com`), fetched
  by the renderer when a map panel is open. If anything else is added, re-review.

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

### 2026-10-06 — first full pass (branch `telemetry-power-fixes`)
**Tools:** gitleaks (dir + git history), `npm audit`, osv-scanner, semgrep
(`--config auto` over `electron/` + `src/`), manual review of the Electron
security surface, and a Playwright probe of the built app.

| Finding | Severity | Outcome |
|---|---|---|
| Main window could navigate to a remote page that then gets the full `window.mesh` bridge; chat links opened remote pages in app windows | High | **Fixed** — ADR 0011, verified by probe |
| Electron 28.3.3 (end-of-life; ASAR-integrity bypass and transitive `extract-zip`, `@electron/get` advisories). It is a devDependency but it *is* the shipped runtime | High | **Open — next.** Upgrade to a supported major (fix line: ≥ 41.10.6) |
| Vite 5 / esbuild dev-server advisories (path traversal in `.map` handling; any site can query the dev server) | Moderate | Open — dev-only, never shipped; fix with the Vite major upgrade |
| No Content-Security-Policy on the renderer (Electron logs a warning) | Medium | Open — needs `img-src` for the tile hosts and a dev-mode allowance for HMR |
| Map tiles disclose the viewed area to CARTO / Esri | Low | Accepted — see below |
| 16 transitive dev/build-tool advisories (tar, xmldom, undici, …) | 1 Critical, rest High/Moderate | **Fixed** — `npm audit fix` (lockfile only) |
| gitleaks: 3 hits | — | False positives — Electron's own `resources.pak` inside gitignored `release/`; history clean |
| semgrep: 2 `path-join-resolve-traversal`, 4 `unsafe-formatstring` | — | False positives — paths and format strings are code constants |

Production dependencies (`npm audit --omit=dev`): 0 vulnerabilities.

## Accepted risks
Medium/Low items consciously deferred — what, why, and revisit-when.

- **Mesh history stored unencrypted** at `~/.openkb-mesh-internet/mesh.sqlite`
  (node IDs, positions, chat, telemetry). Accepted for a local-first, single-user
  desktop app with no accounts; the file never leaves the machine. Revisit if the
  app ever gains multi-user, sync, or export-to-cloud features.
- **Map tiles fetched from CARTO / Esri** reveal the map area being viewed (and
  so, roughly, where the user's mesh is) plus their IP to those providers.
  Accepted: the map is the point of those panels and there is no local tile
  source. Revisit if offline tiles are added.
