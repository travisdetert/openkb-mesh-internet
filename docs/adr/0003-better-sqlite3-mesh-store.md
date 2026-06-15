# ADR-0003: better-sqlite3 for the local mesh store

- **Status:** Accepted
- **Date:** 2026-05-04 *(backfilled 2026-06-14)*
- **Deciders:** Travis Detert

## Context

The mesh produces a continuous stream of packets, node-info updates, telemetry samples,
positions, and traceroutes that the app must persist and query — for history charts, RSSI
vs. distance scatter plots, coverage heatmaps, and trace comparison over time. The data is
local-only (one user, one machine), relational in shape, and needs ad-hoc queries. It must
survive app restarts and be reasonably queryable without a server.

## Decision

Use **`better-sqlite3`** (synchronous, native) in the main process as the single store. The
database lives at **`~/.openkb-mesh-internet/mesh.sqlite`** — outside the app bundle so it
persists across reinstalls and upgrades.

## Alternatives considered

- **`node-sqlite3` (async)** — callback/promise API adds concurrency complexity for no gain;
  our writes are short and run in the main process, where synchronous calls are simpler and
  measurably faster for this workload.
- **A JSON/NDJSON file or `lowdb`** — no real query engine; the analytics panels need
  `GROUP BY` / time-range / join-style queries that would be painful to hand-roll.
- **An embedded server DB (Postgres/DuckDB)** — overkill for single-user local data and adds
  a process or heavyweight dependency to ship.

## Consequences

- Simple, synchronous, fast queries directly from the main process; no async plumbing around
  storage.
- `better-sqlite3` is a **native module** — it must be rebuilt against Electron's ABI
  (`electron-builder install-app-deps`), and this couples us to that toolchain.
- Synchronous calls block the main thread; acceptable because individual statements are tiny,
  but bulk operations must stay batched/transactional to avoid jank.
- Storing under the home dir (not `app.getPath('userData')`) keeps the path stable and
  human-findable, at the cost of not following each OS's conventional app-data location.
