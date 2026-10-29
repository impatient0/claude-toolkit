# claude-toolkit

Portable Claude Code skills, mechanical `PreToolUse` and git guards, documentation graph linters, and a headless Playwright browser REPL.
Extracted from a production codebase after measuring where human time and agent mistakes actually went — see [`docs/field-notes.md`](docs/field-notes.md) for the trial logs and post-mortems behind each mechanism.

## Design Stance: Audience of One

This repository is built for its author first and published in case its mechanisms are useful to you.
If making a rule more universally appealing ever conflicts with keeping the author's own workflow sharp, universal appeal loses every time.
Nothing here is a speculative prompt template: every hook, skill, and check was added only after a simpler written rule failed in a real session and the failure was measured.
Where a default convention is opinionated (such as running every session in its own git worktree with the root checkout parked on a detached `HEAD`), the CLI provides flags (`--no-worktrees`) to opt out rather than watering down the default.

---

## Quick Start

### Option A: Install as a Native Claude Code Plugin

Register the repository via Claude Code's `/plugin` command to load all seven skills and the `PreToolUse` guards (`hooks/hooks.json`) without committing toolkit files into your project repository:

```text
/plugin marketplace add impatient0/claude-toolkit
/plugin install claude-toolkit@claude-toolkit
```

Or load a local clone directly for a single session:

```bash
claude --plugin-dir /path/to/claude-toolkit
```

The native plugin provides the 7 skills and the 3 `PreToolUse` hooks (`guard-remote-mutation.mjs`, `guard-main-checkout-edits.mjs`, and `guard-symlinked-node-modules.mjs`).
If you also want the repo-level git hooks (`scripts/git-hooks/`), the documentation linters (`scripts/check-doc-links.mjs` and `scripts/reflow-docs.mjs`), and scaffolded [`CLAUDE.md`](CLAUDE.md) / [`docs/backlog.md`](docs/backlog.md) files committed inside your project, use **Option B**.

### Option B: Bootstrap a Repository (Self-Contained in Git)

Run via `npx` directly from GitHub or from a local clone:

```bash
npx github:impatient0/claude-toolkit init /path/to/your-project
# or from a local clone:
node /path/to/claude-toolkit/bin/claude-toolkit.mjs init /path/to/your-project
```

What `init` does:
1. Copies the 7 skills into `.claude/skills/`, the UI gate rule into [`.claude/rules/ui-change-gate.md`](.claude/rules/ui-change-gate.md), and the `PreToolUse` hooks into `.claude/hooks/`.
2. **Merges** hook and worktree settings into `.claude/settings.json` non-destructively (preserving any existing `permissions`, `mcpServers`, or custom hooks).
3. Installs `scripts/check-doc-links.mjs`, `scripts/reflow-docs.mjs`, and `scripts/git-hooks/` (`pre-commit` and `pre-merge-commit`), and configures `git config core.hooksPath scripts/git-hooks`.
4. Creates [`CLAUDE.md`](CLAUDE.md) (with a `# Project Context` header ready to fill in), [`docs/backlog.md`](docs/backlog.md), and [`docs/adr/0001-record-architecture-decisions.md`](docs/adr/0001-record-architecture-decisions.md) if they don't exist yet.
5. If the repository's working tree is already clean, parks the main checkout on a detached `HEAD` so worktrees can merge into `main`; if uncommitted files are present (including the newly scaffolded files), commit them first and run `claude-toolkit detach`.

Flags:
- `--no-worktrees` — Install [`.claude/hooks/guard-remote-mutation.mjs`](.claude/hooks/guard-remote-mutation.mjs) and `templates/settings.minimal.json` without worktree isolation guards or git hooks.
- `--ui` — Also copy `templates/docs/design/mockup-scaffold.html` and `templates/driver-commands.example.mjs`.
- `--force` — Overwrite existing files in the target repository.

### Option C: Clone & Symlink Globally into `~/.claude/`

To symlink all seven skills and the `PreToolUse` hooks directly into `~/.claude/` from a local clone:

```bash
node /path/to/claude-toolkit/bin/claude-toolkit.mjs install-global
```

---

## How the Session-Per-Worktree Model Works

By default, this toolkit assumes parallel Claude Code sessions should never share a working copy:

1. **The main checkout (repository root) stays parked on a detached `HEAD` at `main`'s tip** (`claude-toolkit detach` or `git switch --detach main`) and is never edited directly.
   Why detached? Git refuses to check out `main` in a linked worktree if the root checkout is already sitting on `main`.
2. **Every session calls `EnterWorktree` before its first edit** and renames its branch to `feature/<slug>`, `fix/<slug>`, `docs/<slug>`, or `chore/<slug>`.
   If a session forgets and tries to edit a file in the root checkout, [`.claude/hooks/guard-main-checkout-edits.mjs`](.claude/hooks/guard-main-checkout-edits.mjs) denies the tool call and hands the agent the exact `EnterWorktree` instruction; if it uses a shell command (`sed -i`), `scripts/git-hooks/pre-commit` refuses the commit.
3. **Merging happens from inside the worktree via [`merge-to-main`](.claude/skills/merge-to-main/SKILL.md)** only when the user asks: the worktree runs `git switch main` (which acts as a natural lock across parallel sessions), tests the uncommitted merge, commits, and immediately runs `git switch --detach` to release `main`.

If you prefer a single-checkout workflow on a smaller repo, pass `--no-worktrees` to `claude-toolkit init`.

---

## What's Inside

### 1. Skills (`.claude/skills/`)

- [`wrap-up`](.claude/skills/wrap-up/SKILL.md) — End-of-session checkpoint: verifies git and worktree state, re-runs the project's test gate, scans the conversation for undocumented decisions, rejected alternatives, and deliberate non-changes, routes them to commits, ADRs, [`docs/backlog.md`](docs/backlog.md), or cross-session memory, checks cold-session reachability, and triages finish-now vs. safe-to-defer items.
- [`autonomous-slice`](.claude/skills/autonomous-slice/SKILL.md) — Runs a delegated sequence of backend/non-UI slices to completion without the user present: checks Gate A (no human-gated UI paths) and Gate B (written specification citation), enforces five stop triggers, writes an external plan artifact with base SHA for autocompact recovery, commits per step with `Unmandated-call:` trailers, and pauses at a 3-slice chain cap with a self-reviewed attribution report.
- [`backlog-audit`](.claude/skills/backlog-audit/SKILL.md) — Sorts `Unranked` items in [`docs/backlog.md`](docs/backlog.md) into actionability tiers (`Do next`, `Ready, unblocked`, `Gated on an in-flight milestone`, `Needs a decision`, `Waiting on an external trigger`, `Not sanctioned`), runs the ADR-rejection check before placement, and re-validates existing tiers against drift.
- [`doc-audit`](.claude/skills/doc-audit/SKILL.md) — Token and section-level documentation audit: detects files that have quietly become two documents (stable decisions vs. monotonic slice logs), finds duplicated knowledge across wrapped sentences, and verifies claims against live code.
- [`merge-to-main`](.claude/skills/merge-to-main/SKILL.md) — Safe merge procedure for the session-per-worktree convention: takes `main` as a lock, runs the verification suite on the uncommitted merge, commits, detaches `main` immediately, and cleans up the worktree.
- [`secure-credential-handoff`](.claude/skills/secure-credential-handoff/SKILL.md) — Pattern for passing secrets into Claude's non-interactive Bash tool calls via a mode-`0600` env file without exposing plaintext in the transcript.
- [`browser-driver`](.claude/skills/browser-driver/SKILL.md) — Persistent headless Chromium REPL (`.claude/skills/browser-driver/driver.mjs`) driven over tmux via `.claude/skills/browser-driver/send.sh`, with unambiguous interactive click resolution (`.claude/skills/browser-driver/click-target.mjs`), DOM/network settle verification, multi-viewport geometry inspection (`viewport`, `geom`), and optional per-project commands via `templates/driver-commands.example.mjs`.

### 2. Mechanical Guards (`.claude/hooks/` & `scripts/git-hooks/`)

- [`.claude/hooks/guard-remote-mutation.mjs`](.claude/hooks/guard-remote-mutation.mjs) — `PreToolUse` Bash hook that prompts (`ask`) before any command that mutates state outside the working tree (`ssh`, `scp`, `rsync`, `crontab`, `docker -H`, `git push` to `main`, or non-read `gh` calls), while ignoring quoted strings and heredoc commit bodies.
- [`.claude/hooks/guard-main-checkout-edits.mjs`](.claude/hooks/guard-main-checkout-edits.mjs) — `PreToolUse` Edit/Write hook that refuses (`deny`) file edits in the root checkout when using session worktrees.
- [`.claude/hooks/guard-symlinked-node-modules.mjs`](.claude/hooks/guard-symlinked-node-modules.mjs) — `PreToolUse` Bash hook that refuses (`deny`) `npm` / `pnpm` / `yarn` / `bun` installs inside a worktree whose `node_modules` is a shared symlink.
- `scripts/git-hooks/pre-commit` and `scripts/git-hooks/pre-merge-commit` — Git hooks that refuse shell-made commits or merges in the main checkout, refuse direct commits onto `main` outside a merge, and run browser-driver click-target tests when `.claude/skills/browser-driver/click-target.mjs` is staged.

### 3. Documentation Linters (`scripts/`)

- `scripts/check-doc-links.mjs` — Enforces six rules across Markdown docs and code comments: relative links and `#fragment` headings resolve, `[[wiki]]` refs/globs/bare backticked doc paths are banned, every doc under `docs/` is reachable from [`README.md`](README.md), [`CLAUDE.md`](CLAUDE.md), a skill, or `.claude/rules/`, cited repo paths exist or are `~~struck~~`, Artifact links stay under `References`/`Visual record`, and ADRs ([`docs/adr/0001-record-architecture-decisions.md`](docs/adr/0001-record-architecture-decisions.md)) and epic indexes stay within byte budgets.
  Supports optional `.doclinksrc.json` overrides for custom directory layouts.
- `scripts/reflow-docs.mjs` — Normalizes Markdown files to one sentence per line (`--check` in CI/tests) so multi-word phrases stay greppable and git diffs stay tight.

---

## Testing

```bash
npm test
```

`npm test` runs the full `node:test` suite (`tests/guard-remote-mutation.test.mjs`, `tests/guard-main-checkout-edits.test.mjs`, `tests/guard-symlinked-node-modules.test.mjs`, `tests/gitHooks.test.mjs`, `tests/reflowDocs.test.mjs`, `tests/checkDocLinks.test.mjs`, `tests/cli.test.mjs`), followed by `scripts/check-doc-links.mjs` and `scripts/reflow-docs.mjs --check`.
To run the real-Chromium fixture tests for `.claude/skills/browser-driver/click-target.mjs`, run `npm run check:browser-driver`.
