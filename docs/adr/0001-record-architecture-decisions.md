# 1. Record architecture decisions

## Status

Accepted.

## Context

Session context is ephemeral while the repository is durable.
Decisions about module boundaries, data ownership, dependencies, and workflow gates get relitigated from memory once a project grows unless the tradeoffs and revisit triggers are recorded at the moment the decision is made.

## Decision

We record architectural decisions in numbered Markdown files under `docs/adr/` (`NNNN-slug.md`).

- **One decision per ADR.** Chronological per-slice implementation notes belong in `docs/implementation-notes/`, not appended to an ADR's Consequences section.
  `scripts/check-doc-links.mjs` enforces a 24,000-byte budget per ADR so decision documents stay concise enough for a cold session to read in full.
- **Reopening an accepted ADR requires explicit user authorisation.** If new work turns out to amend, supersede, or contradict an accepted ADR, the agent stops and raises it rather than writing a superseding ADR unilaterally (see [`CLAUDE.md`'s Error Handling & When to Stop](../../CLAUDE.md#error-handling--when-to-stop)).

## Consequences

- Every ADR under `docs/adr/` must be reachable by following relative Markdown links from [`README.md`](../../README.md), [`CLAUDE.md`](../../CLAUDE.md), or a skill, verified mechanically by `scripts/check-doc-links.mjs`.
