# ADR-0010: An in-memory event bus with a concept-translation seam

- **Status:** Accepted
- **Date:** 2026-05-04 *(backfilled 2026-07-09)*
- **Deciders:** Travis

## Context

The renderer has two very different kinds of consumer for the same live mesh
data. The **mesh panels** (nodes, map, chat, telemetry, traceroute) want
protocol-shaped records they can render directly, and they get those as React
state driven by the `window.mesh.on*` IPC events (ADR-0007). The **learn /
event-sourced panels** (the event feed, the concept views) want something
different: a uniform stream of typed "something happened" events they can filter,
count, and replay — *"show me every position-beacon in the last minute"* —
without knowing anything about Meshtastic protobufs.

Wiring every learn panel directly to the IPC events would spread protocol
details (`MeshPacket`, node-record shapes, `0xffffffff` broadcast sentinels)
across the whole UI, and would give late-mounting panels no way to see events
that arrived before they subscribed. The app also wants to stay conceptually
honest that this is *one instance of an event-sourced network*, not a
Meshtastic-only viewer.

## Decision

Add a tiny in-memory pub/sub **bus** (`src/bus.ts`) that carries typed
`BusEvent`s keyed by `Update`/`Topic` concept slugs, and put a single
**translator** (`src/concepts/translators/meshtastic.ts`) at the seam where
protocol-native shapes become `BusEvent`s. The `useMesh` hook is the one place
that both updates React state *and* calls the translator; everything downstream
of the bus speaks concept vocabulary, never protobuf. The bus keeps a 500-event
ring buffer so late subscribers can replay recent history via `bus.history()`.

## Alternatives considered

- **Panels subscribe to `window.mesh.on*` directly** — no extra layer, but every
  learn panel re-implements protocol coercion, there's no replay for late
  subscribers, and the "event-sourced network" framing is lost.
- **A full state manager (Redux/Zustand) as the single source** — heavier, and it
  models *current state* well but *streams of events* poorly; the learn panels
  fundamentally want the event log, not a snapshot.
- **A real event-sourcing store / persisted log in the renderer** — over-built for
  a single-process desktop app; SQLite in main (ADR-0003) already owns durable
  history. The bus only needs a short in-memory window.

## Consequences

- Protocol details are confined to the translator; the rest of the renderer
  depends only on concept slugs, so adding a second protocol later means writing
  a new translator, not touching panels.
- Late subscribers can replay the last 500 events; a bad subscriber can't break
  the bus (handlers are wrapped in try/catch).
- There are now **two** representations of the same data in the renderer (React
  state for mesh panels, bus events for learn panels), both fed from `useMesh`.
  That duplication is deliberate but must stay in sync at the one seam — if a new
  event type is added, it needs both a state path and a translator path.
- The ring buffer is capped at 500 events and is not durable; anything needing
  real history reads SQLite via IPC, not the bus.
