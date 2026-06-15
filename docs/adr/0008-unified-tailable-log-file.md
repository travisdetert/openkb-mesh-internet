# ADR-0008: Unified, tail-able log file

- **Status:** Accepted
- **Date:** 2026-05-13 *(backfilled 2026-06-14)*
- **Deciders:** Travis Detert

## Context

Debugging an Electron app that splits work across a main process and a renderer is slow when
errors are scattered — renderer errors hide in DevTools, main-process logs go to whatever
terminal (if any) launched the app. Across many launch methods (`npm start`, packaged app,
double-click) there's no single place to watch what the app is doing.

This mirrors a standing global preference: every Electron app should funnel logs into one
tail-able file.

## Decision

Funnel **all** logs into a single fixed file, **`/tmp/openkb-mesh-internet.log`**:

1. Tee the main process's `stdout`/`stderr` to the file via
   `fs.createWriteStream(LOG_PATH, { flags: 'a' })`, wrapping the writers.
2. Forward renderer console output to main stdout (and thus the file) with
   `mainWindow.webContents.on('console-message', ...)`, tagging each line
   `[renderer error]` / `[renderer warn]` / `[renderer]` by level.

Result: `tail -f /tmp/openkb-mesh-internet.log` shows main and renderer output together,
regardless of how the app was launched.

## Alternatives considered

- **DevTools only** — requires the user to open DevTools and copy/paste; no main-process
  visibility; useless for the packaged app.
- **`electron-log` to the OS log dir** — fine, but a fixed `/tmp` path is trivially
  tail-able during development and needs no extra dependency.

## Consequences

- One command (`tail -f /tmp/openkb-mesh-internet.log`) for the whole debugging feedback
  loop; no asking the user to read DevTools.
- The file lives in `/tmp` (dev-friendly, cleared on reboot) and **appends** — it grows
  within a session and is not rotated, acceptable for a dev/diagnostic log.
- New code should log through `console.*` in either process and trust it lands in the file.
