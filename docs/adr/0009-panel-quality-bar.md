# ADR-0009: A shared "quality bar" for panels

- **Status:** Accepted
- **Date:** 2026-05-26 *(backfilled 2026-06-14)*
- **Deciders:** Travis Detert

## Context

The app is a growing set of Live and Learn panels (Telemetry, Traceroute, Sniffer, Link
Budget, Coverage, Mesh Routing, …). Without a shared standard, panels drift into
inconsistent interaction models — some have detail drawers, some don't; some export CSV,
some don't; some poll, some are live. That inconsistency is both a UX problem and a source of
duplicated, divergent code.

## Decision

Adopt the **quality bar set by the Map and Nodes panels** as the standard every panel aspires
to, documented in [`../PANELS_PLAN.md`](../PANELS_PLAN.md). The bar: master/detail layout,
`Live / Data / Settings`-style subnav where it helps, CSV export for tabular data, real-time
data via live IPC events (not polling), cross-panel actions (Message / Traceroute /
Jump-to-Node), inline diagnostic copy, stale/fresh visualization, hover tooltips, and
active-state highlighting.

## Alternatives considered

- **Let each panel define its own UX** — faster per panel, but produces an incoherent app and
  rampant copy-paste of subnav / CSV / node-naming logic.
- **A heavy shared component framework up front** — premature; the bar is a *standard* first,
  with shared components (`Subnav`, `csv.ts`, `nodes.ts`, extracted Map components) extracted
  as the duplication becomes real (see the refactor candidates in `PANELS_PLAN.md`).

## Consequences

- A clear, written definition of "done" for any panel, and an execution roadmap (Phases A–D).
- Identifies shared modules worth extracting (Map tiles/projection, `Subnav`, CSV helper,
  node-naming helpers) so panels converge instead of duplicating.
- The bar is aspirational, not a gate — existing panels are brought up to it incrementally,
  and the Phase B/C boundary is intentionally fluid.
- `PANELS_PLAN.md` remains the living roadmap; this ADR records *why* the bar exists and that
  it's the agreed standard.
