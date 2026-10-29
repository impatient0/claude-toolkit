# claude-toolkit

Portable Claude Code skills, mechanical `PreToolUse` and git guards, documentation linters, and a headless Playwright browser REPL.
Extracted so any project can get the full workflow with one bootstrap command or global symlinks.

## What's Inside

### 1. Skills (`.claude/skills/`)

- [`wrap-up`](.claude/skills/wrap-up/SKILL.md) — End-of-session checkpoint: verifies git and worktree state, re-runs the project's test gate, scans the conversation for undocumented decisions/rejections/scope cuts, routes them to commits, ADRs, [`docs/backlog.md`](docs/backlog.md), or cross-session memory, checks cold-session reachability, and triages finish-now vs. safe-to-defer items.
- [`autonomous-slice`](.claude/skills/autonomous-slice/SKILL.md) — Runs a delegated sequence of backend/non-UI slices to completion without the user present: checks Gate A (no human-gated UI paths) and Gate B (written specification citation), enforces five stop triggers, writes an external plan artifact with base SHA for autocompact recovery, commits per step with `Unmandated-call:` trailers, and pauses at a 3-slice chain cap with a self-reviewed attribution report.
- [`backlog-audit`](.claude/skills/backlog-audit/SKILL.md) — Sorts `Unranked` items in [`docs/backlog.md`](docs/backlog.md) into actionability tiers (`Do next`, `Ready, unblocked`, `Gated on an in-flight milestone`, `Needs a decision`, `Waiting on an external trigger`, `Not sanctioned`), runs the ADR-rejection check before placement, and re-validates existing tiers against drift.
- [`doc-audit`](.claude/skills/doc-audit/SKILL.md) — Token and section-level documentation audit: detects files that have quietly become two documents (stable decisions vs. monotonic slice logs), finds duplicated knowledge across wrapped sentences, and verifies claims against live code.
- [`merge-to-main`](.claude/skills/merge-to-main/SKILL.md) — Safe merge procedure for the session-per-worktree convention: takes `main` as a lock, runs the verification suite on the uncommitted merge, commits, detaches `main` immediately, and cleans up the worktree.
- [`secure-credential-handoff`](.claude/skills/secure-credential-handoff/SKILL.md) — Pattern for passing secrets into Claude's non-interactive Bash tool calls via a mode-`0600` env file without exposing plaintext in the transcript.
- [`browser-driver`](.claude/skills/browser-driver/SKILL.md) — Persistent headless Chromium REPL (`.claude/skills/browser-driver/driver.mjs`) driven over tmux via `.claude/skills/browser-driver/send.sh`, with unambiguous interactive click resolution (`.claude/skills/browser-driver/click-target.mjs`), DOM/network settle verification, multi-viewport geometry inspection (`viewport`, `geom`), and optional per-project commands via `templates/driver-commands.example.mjs`.

### 2. Mechanical Guards (`.claude/hooks/` & `scripts/git-hooks/`)

- [`.claude/hooks/guard-remote-mutation.mjs`](.claude/hooks/guard-remote-mutation.mjs) — `PreToolUse` Bash hook that prompts (`ask`) before any command that mutates state outside the working tree (`ssh`, `scp`, `rsync`, `crontab`, `docker -H`, `git push` to `main`, or non-read `gh` calls), while ignoring quoted strings and heredoc commit bodies.
- [`.claude/hooks/guard-main-checkout-edits.mjs`](.claude/hooks/guard-main-checkout-edits.mjs) — `PreToolUse` Edit/Write hook that refuses (`deny`) file edits in the root checkout when using session worktrees, instructing the session to call `EnterWorktree`.
- [`.claude/hooks/guard-symlinked-node-modules.mjs`](.claude/hooks/guard-symlinked-node-modules.mjs) — `PreToolUse` Bash hook that refuses (`deny`) `npm ci` / `npm install` inside a worktree whose `node_modules` is a shared symlink.
- `scripts/git-hooks/pre-commit` and `scripts/git-hooks/pre-merge-commit` — Git hooks that refuse shell-made commits or merges in the main checkout, refuse direct commits onto `main` outside a merge, and run browser-driver click-target tests when `.claude/skills/browser-driver/click-target.mjs` is staged.

### 3. Documentation Linters (`scripts/`)

- `scripts/check-doc-links.mjs` — Enforces six rules across Markdown docs and code comments: relative links and `#fragment` headings resolve, `[[wiki]]` refs/globs/bare backticked doc paths are banned, every doc under `docs/` is reachable from [`README.md`](README.md), [`CLAUDE.md`](CLAUDE.md), a skill, or `.claude/rules/`, cited repo paths exist or are `~~struck~~`, Artifact links stay under `References`/`Visual record`, and ADRs ([`docs/adr/0001-record-architecture-decisions.md`](docs/adr/0001-record-architecture-decisions.md)) and epic indexes stay within byte budgets.
- `scripts/reflow-docs.mjs` — Normalizes Markdown files to one sentence per line (`--check` in CI/tests) so multi-word phrases stay greppable and git diffs stay tight.

## Usage

### Bootstrap a Repository (Self-Contained in Git)

```bash
node /home/impatient0/projects/claude-toolkit/bin/claude-toolkit.mjs init /path/to/your-project
```

Options:
- `--no-worktrees` — Install `guard-remote-mutation.mjs` and `templates/settings.minimal.json` without worktree isolation guards or git hooks.
- `--ui` — Also copy `templates/docs/design/mockup-scaffold.html` and `templates/driver-commands.example.mjs`.
- `--force` — Overwrite existing files in the target repository.

After initializing, fill in the top `# Project Context` section of [`CLAUDE.md`](CLAUDE.md) for the target project.

### Install Globally into `~/.claude/`

To make all seven skills and the `PreToolUse` hooks available in every project via symlinks without copying them into a repository:

```bash
node /home/impatient0/projects/claude-toolkit/bin/claude-toolkit.mjs install-global
```

## Testing

```bash
npm test
```

`npm test` runs the full `node:test` suite (`tests/guard-remote-mutation.test.mjs`, `tests/guard-main-checkout-edits.test.mjs`, `tests/guard-symlinked-node-modules.test.mjs`, `tests/gitHooks.test.mjs`, `tests/reflowDocs.test.mjs`, `tests/checkDocLinks.test.mjs`, `tests/cli.test.mjs`), followed by `scripts/check-doc-links.mjs` and `scripts/reflow-docs.mjs --check`.
