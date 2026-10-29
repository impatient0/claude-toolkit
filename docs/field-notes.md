# Field Notes — The Measurements Behind the Rules

Every skill, hook, and linter in this repository exists because a simpler version failed in a real session and the failure was measured.
This document preserves those measurements so the rules in [`CLAUDE.md`](../CLAUDE.md), the skills under `.claude/skills/`, and the guards under `.claude/hooks/` don't read as arbitrary personal preference—and so a future pass doesn't simplify away a load-bearing check after forgetting what it caught.

---

## 1. The Asymmetry Between Backend and UI Work

Across a 20-slice, 86-commit feature epic backed by 340 automated tests, a typechecker, and static linters, slices split roughly evenly between backend/data work and UI work.
Recorded defects did not split evenly at all:

| Slice Class | Slices | Recorded Bugs | How They Were Caught |
|---|---|---|---|
| Backend / data | 9 | 1 | An existing regression test, before the slice shipped |
| UI | 10 | ~16 | Human review, a real browser, or a mockup gate — every one of them |
| Mixed | 1 | 0 | Verified in both the test suite and a headless browser |

Two conclusions fell out of that table:

1. **Uniform ceremony wastes human attention on the half where it catches nothing.** Running full manual plan-approval ceremony on a backend/data slice behind a green test suite cost 20 approval round-trips and changed the plan once or twice.
   Moving well-specified backend slices to plan-*announced* execution via [`autonomous-slice`](../.claude/skills/autonomous-slice/SKILL.md) recovers those round-trips while keeping every UI gate intact.
2. **"Fresh eyes verify better" fails when the instrumentation is blind.** One UI slice landed with four visual defects (a broken selector after a type change, an input fighting its own padding, a CSS specificity collision, and a hand-guessed gap) even though the implementing agent's headless browser check **ran and passed**.
   A separate verifier subagent using the same default 480px mobile viewport would have passed it too: a `position: fixed` element's box-model math can coincidentally match its flow parent's at 480px and diverge only once `max-width` starts constraining the column on a wider viewport.
   That is why [`browser-driver`](../.claude/skills/browser-driver/SKILL.md#verifying-a-ui-change) requires a desktop-width pass (`viewport 1200 900`) and real `getBoundingClientRect()` measurements (`geom <sel>`) rather than eyeballing a narrow screenshot.

---

## 2. Why Written Rules Fail Without Mechanical Guards

Three times across real sessions, a rule was written clearly in [`CLAUDE.md`](../CLAUDE.md), loaded into the session's context before the first tool call, and ignored anyway.
All three failures shared one shape:
**the instruction was present in the document and absent at the moment of action.**

### Failure A: Editing the main checkout instead of entering a worktree

To test whether a fresh session follows `CLAUDE.md` into a worktree unprompted:

- **Three headless probes passed** — because all three prompts ended with *"commit it"*, which sent the session to `CLAUDE.md`'s Version Control section before editing.
  The probes were leading the witness.
- **A real interactive session failed.** Given a task that didn't mention committing, the session read `package.json`, edited `README.md` directly in the main checkout, ran two checkers, and stopped.
- **The same prompt run headless reproduced the failure, then self-corrected** only when a later `git status` happened to reveal the stray edit:
  *"I made this edit directly on the main checkout, which should stay untouched on detached HEAD per this repo's worktree convention.
  Let me correct that."*

Placing [`.claude/hooks/guard-main-checkout-edits.mjs`](../.claude/hooks/guard-main-checkout-edits.mjs) as a `PreToolUse` `deny` hook on `Edit|Write|NotebookEdit` delivers that exact self-correction *at the first edit* rather than after it.
Shell-written edits (`sed -i`, heredocs) bypass `Edit|Write`, so `scripts/git-hooks/pre-commit` and `scripts/git-hooks/pre-merge-commit` form the second layer at commit time.

### Failure B: Unattended remote state mutation

During a backlog-clearing session running in auto mode, the agent executed **29 remote-touching commands** — root SSH to two hosts, creating a user, installing an SSH key, and rewriting a crontab — with zero permission prompts.
[`autonomous-slice`](../.claude/skills/autonomous-slice/SKILL.md) screened for frontend files (Gate A) and for a written specification (Gate B), and a well-specified infrastructure task passed both cleanly.

[`.claude/hooks/guard-remote-mutation.mjs`](../.claude/hooks/guard-remote-mutation.mjs) forces a permission prompt (`ask`, never `deny`, since the work is legitimate when supervised) on `ssh`, `scp`, `rsync`, `crontab`, `docker -H`, `git push` to `main`, and non-read `gh` commands.
Its first version scanned raw command strings and immediately false-positived on the commit that introduced it, because the commit message quoted `echo ... | ssh ...` as an example.
`stripNonExecutable()` drops heredoc bodies first and quoted spans second (unless they contain `$(...)`), eliminating false positives on commit messages and `grep` invocations.

### Failure C: `npm ci` over a shared worktree symlink

When `.claude/settings.json` sets `worktree.symlinkDirectories: ["node_modules"]`, every worktree shares the main checkout's `node_modules` with zero install time.
However, `npm ci` empties the target directory a symlink points to *before* replacing the symlink with a real directory — so running `npm ci` inside one worktree left that worktree fine and silently wiped the main checkout's `node_modules` for every other worktree.
[`.claude/hooks/guard-symlinked-node-modules.mjs`](../.claude/hooks/guard-symlinked-node-modules.mjs) denies `npm`/`pnpm`/`yarn`/`bun` installs while `node_modules` is a symlink and hands the agent the exact recovery command (`rm node_modules` as its own step, then install).

---

## 3. Trial Findings from [`autonomous-slice`](../.claude/skills/autonomous-slice/SKILL.md)

### Speech-act triggers vs. world-state triggers

In the first two trials of `autonomous-slice`, the agent read `CLAUDE.md` 16 and 24 times and **never invoked the skill (`0/2`)**.
The skill's description said *"use when starting a slice whose intended behaviour is already written down"* — a state of the world requiring three inferences with no specific moment forcing the check.
[`wrap-up`](../.claude/skills/wrap-up/SKILL.md), by contrast, always fired reliably because it keyed on a **speech act** (*"use when the user says…"*).
Rewriting `autonomous-slice` to key on explicit user invocation took trigger reliability from `0/2` to **`3/3`**, and also solved the authority problem: an agent should never grant itself permission to skip human checkpoints.

### Why confidence sorting fails, and what works instead

During a two-slice unattended run (roughly an hour of execution, surviving a mid-run autocompact via the plan artifact's base SHA), the agent recorded 15 unmandated calls (`Unmandated-call:` git trailers).
Post-run review found **3 of the 15 calls were wrong** (an OAuth metadata URL, missing output schemas, and an archive tool without a restore counterpart).

All three wrong calls were written in the plan artifact in a completely confident register (*"chosen because it's the one that actually resolves"*, *"matching the repository's own missing method"*).
Asking an agent *"how confident are you?"* flags `0/3`, because a blind spot is by definition a choice where the agent didn't see the second direction.

Sorting all 15 calls by a mechanical question — **does the call's justification cite the specification, or does it reach for what the existing codebase already does?** — split the 15 calls into 5 that cited existing code and 10 that cited the spec.
All 3 defects were in the 5 flagged calls (**`3/3` recall** while flagging only a third of the list).
That question is now Step 6's first self-review test in [`autonomous-slice`](../.claude/skills/autonomous-slice/SKILL.md#6-the-chain-cap).

---

## 4. Worktree Mechanics: Why [`merge-to-main`](../.claude/skills/merge-to-main/SKILL.md) Uses Its Exact Order

Testing git worktrees and Claude Code's `EnterWorktree`/`ExitWorktree` tools across throwaway clones surfaced five non-obvious constraints:

| Probe | What Happened | Resulting Rule |
|---|---|---|
| Main checkout holds `main` while worktree runs `git switch main` | Fails: `fatal: 'main' is already used by worktree` | Park the main checkout on a detached HEAD (`git switch --detach main`); `git switch main` inside a worktree then acts as a natural mutex across parallel sessions |
| `.gitignore` lists `node_modules/` (with trailing slash) | `git status` shows `?? node_modules` in every worktree because a trailing slash matches only a directory, not a symlink | List `node_modules` without a trailing slash in `.gitignore` |
| Worktree merges into `main`, then calls `ExitWorktree(remove)` | Refused: `ExitWorktree` counts commits from the worktree's creation base, so merged commits still look unmerged and would require `discard_changes: true` | Always call `ExitWorktree(keep)`, re-anchor the main checkout (`git switch --detach main`), then run `git worktree remove` and `git branch -d` |
| `git branch -d <branch>` run before re-anchoring the main checkout | Refused ("not fully merged") because `git branch -d` checks against `HEAD`, which is still the old detached commit | Re-anchor the main checkout to the new `main` *before* `git branch -d` |
| Checking `MERGE_HEAD` inside `pre-merge-commit` | `MERGE_HEAD` does not exist yet when `pre-merge-commit` runs | Put the "no direct commits on `main` unless `MERGE_HEAD` exists" check in `pre-commit`, and only the "not in main checkout" check in `pre-merge-commit` |

---

## 5. Documentation as a Checked Graph

1. **Cold-session reachability (`scripts/check-doc-links.mjs` Rule 3):** During a multi-slice epic, the epic's master slice index was written to a session-scoped scratch directory (`/tmp/claude-.../scratchpad/`).
   Fourteen session directories existed; only one held the file, so every subsequent session started blind to it and silently reverted a settled visual decision.
   Even worse, an earlier version of [`wrap-up`](../.claude/skills/wrap-up/SKILL.md) reported that "everything is documented" because the file existed on disk.
   Rule 3 now walks relative links starting from [`README.md`](../README.md), [`CLAUDE.md`](../CLAUDE.md), `.claude/skills/`, and `.claude/rules/`, failing the test suite if any file under `docs/` is unreachable.
2. **One sentence per line (`scripts/reflow-docs.mjs`):** Hard-wrapping Markdown at 80–90 columns caused multi-word phrases (`See the design spec's / Tabs entry`) to straddle line breaks, making them invisible to line-oriented `grep` during audits.
   Normalizing to one sentence per line keeps every within-sentence phrase on a single line for `grep` while keeping `git diff` tight (unlike one paragraph per line).
   Reflowing an entire project corpus changed line counts by 26–38% while changing byte counts by under 1%, which is why ADR and epic-index size budgets in `scripts/check-doc-links.mjs` are denominated in **bytes**, not lines.
