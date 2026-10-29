# Project Context

_Fill in per project. Everything below this section is stack-agnostic and should survive as-is across projects._

- **Stack:** _Fill in backend, frontend, database, and runtime._
- **Architecture:** _Fill in module layout and layering rules._
- **Verification gate:** `npm test` _(or the project's test and linter command)_.
- **Human-gated UI paths:** `public/**`, `src/ui/**`, `docs/design/**` (governed by [`.claude/rules/ui-change-gate.md`](.claude/rules/ui-change-gate.md)).
- **Environments:** `local` vs. `prod` — _describe how to tell which environment a session is looking at._
- **Source of truth docs:** [`README.md`](README.md) at repo root, [`docs/adr/`](docs/adr/0001-record-architecture-decisions.md) for architecture decisions, and [`docs/backlog.md`](docs/backlog.md) for deferred work.

If this project has its own `CONTRIBUTING.md` / architecture guide, **it overrides the defaults below** wherever the two disagree.
