# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-06-14
- **Deciders:** Travis Detert

## Context

This project has accumulated several non-obvious architectural choices — a transport
abstraction that hides serial vs. BLE, WebBluetooth living in the renderer rather than
main, a synchronous native SQLite store, protobuf decode in the main process. Today the
*why* behind these lives only in commit messages, code comments, and one roadmap doc
(`docs/PANELS_PLAN.md`). That's fragile: rationale gets lost, and decisions get silently
re-litigated or accidentally undone.

## Decision

We will keep **Architecture Decision Records** in `docs/adr/`, one Markdown file per
decision, numbered sequentially, following the lightweight MADR-flavored format described
in [`README.md`](README.md). Accepted ADRs are immutable; we supersede rather than edit.

## Alternatives considered

- **A single `DECISIONS.md` file** — simpler, but it grows into an unscannable wall and
  loses the one-decision-per-unit discipline that makes superseding clean.
- **Rely on commit messages / PR descriptions** — already what we have; rationale is
  scattered and unsearchable, and squashes lose it.
- **A wiki / external tool** — adds a dependency outside the repo; decisions should travel
  with the code and be reviewable in the same PR that implements them.

## Consequences

- New architecturally significant changes should land with an ADR in the same PR.
- There's a small, accepted overhead per decision; we keep records short to manage it.
- We seed the directory by backfilling the major decisions already in the codebase
  (ADR-0002 through ADR-0009) so the record reflects reality from day one.
