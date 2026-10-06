# ADR-0011: The app window stays on the app's own origin; links open in the system browser

- **Status:** Accepted — **Implemented — 2026-10-06**
- **Date:** 2026-10-06
- **Deciders:** Travis Detert (first security pass)

## Context

Chat text arrives from anyone on the mesh — on the default channel, anyone in
radio range or on the public MQTT bridge — and `SmartText` turns any http(s)
URL in it into a clickable `<a target="_blank">`. The main window had no
`setWindowOpenHandler` and no `will-navigate` guard.

The first security pass probed the built app (Playwright, local HTTP page):

- Clicking a `target="_blank"` link opened the remote page **inside an Electron
  window** — app chrome, no address bar. `rel="noreferrer"` kept the preload out
  of that popup (`window.mesh` was `undefined`), so it was a phishing surface,
  not an API leak.
- A **top-level navigation** of the main window kept the preload: the remote
  page saw `typeof window.mesh === 'object'` — the full bridge, including
  `setChannel`, `setMqttConfig`, `getChannelSetUrl` (channel keys), `reboot`,
  `purgeNodedb`, and `resetDevice`. No current link triggers that path, but
  nothing prevented it (a link dragged onto the window does).

```mermaid
flowchart LR
  msg["Chat text from the mesh"] --> st["SmartText linkifies URL"]
  st --> click{"User clicks / drags link"}
  click -->|"window.open"| woh["setWindowOpenHandler → deny"]
  click -->|"navigate main window"| wn{"will-navigate: app origin?"}
  wn -->|yes| stay["load in app"]
  wn -->|no| prevent["preventDefault"]
  woh --> ext{"http(s)?"}
  prevent --> ext
  ext -->|yes| browser["shell.openExternal → system browser"]
  ext -->|no| drop["dropped + logged"]
```

## Decision

The main window only ever shows the app itself (`file://` packaged, the Vite
dev-server URL in dev). Every `window.open` is denied, every navigation off the
app origin is prevented, and http(s) URLs from either path are handed to the
system browser via `shell.openExternal`. Any other scheme is dropped and logged.

## Alternatives considered

- **Strip links from chat** — safest, but links in chat are a real feature.
- **Allow popups with locked-down `webPreferences`** — keeps remote content
  wearing app chrome; the browser is the right place for the open web.
- **Rely on `rel="noreferrer"`** — protects only the popup path, and only for
  as long as every future link remembers it.

## Consequences

- Untrusted pages can no longer reach the preload bridge through the main window.
- Link clicks leave the app; that is intended.
- The dev/packaged origin check must be kept in step if the load path changes.
- Not covered here: the renderer has no Content-Security-Policy (tracked in
  SECURITY.md as the next hardening step).
