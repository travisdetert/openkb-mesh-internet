# Architecture Decision Records

This directory holds **Architecture Decision Records (ADRs)** — short documents that
capture an architecturally significant decision, the context that forced it, and the
consequences we accepted by making it.

We follow a lightweight [MADR](https://adr.github.io/madr/)-flavored format. The goal is
not ceremony; it's so that six months from now (or a new contributor on day one) can read
*why* the code is shaped the way it is without reverse-engineering it from commits.

## When to write one

Write an ADR when a decision:

- is hard or expensive to reverse (storage engine, process boundary, transport model), or
- shapes how multiple parts of the system fit together, or
- a future reader would otherwise ask "why on earth is it done this way?".

Skip it for routine, easily-reversible choices (a helper's name, a CSS tweak).

## How to add one

1. Copy [`template.md`](template.md) to `NNNN-short-title.md`, where `NNNN` is the next
   zero-padded number in sequence.
2. Fill it in. Keep it to a page or so.
3. Set the **Status** to `Proposed` while under discussion, `Accepted` once decided.
4. Never edit a decision's substance after it's `Accepted`. To change course, write a
   *new* ADR that supersedes it, and update the old one's status to
   `Superseded by [ADR-NNNN](NNNN-...md)`.
5. Add a row to the index below.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-electron-react-vite-typescript-shell.md) | Electron + React + Vite + TypeScript app shell | Accepted |
| [0003](0003-better-sqlite3-mesh-store.md) | better-sqlite3 for the local mesh store | Accepted |
| [0004](0004-pluggable-transport-abstraction.md) | Pluggable transport abstraction (serial / BLE / TCP) | Accepted |
| [0005](0005-webbluetooth-in-renderer-proxied-to-main.md) | WebBluetooth in the renderer, proxied to main | Accepted |
| [0006](0006-protobuf-decode-in-main-process.md) | Decode Meshtastic protobuf in the main process | Accepted |
| [0007](0007-context-isolated-ipc-bridge.md) | Context-isolated IPC bridge as the only renderer API | Accepted |
| [0008](0008-unified-tailable-log-file.md) | Unified, tail-able log file | Accepted |
| [0009](0009-panel-quality-bar.md) | A shared "quality bar" for panels | Accepted |

> ADRs 0002–0009 were **backfilled** on 2026-06-14 to document decisions already
> embodied in the codebase. The "Date" field in each records when the decision was
> effectively made; the records themselves were written after the fact.
