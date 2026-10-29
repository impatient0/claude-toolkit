---
name: wrap-up
description: Checkpoint the current session before it ends or before starting a fresh one. Verifies git state is clean and pushed, surfaces anything decided or scoped in this conversation that isn't yet durable (a commit, an ADR, a README/Backlog entry, or the user's cross-session memory), checks that a cold session could actually reach it all, and flags anything that's cheaper to finish now than to pick up cold later. Use when the user says they're wrapping up, about to start a new session, or asks what's left before resetting. Never re-audits the doc corpus itself — see the doc-audit skill for that, separately.
---

The premise this exists for is [`CLAUDE.md`'s Core Principles](../../../CLAUDE.md#core-principles) ("Session context is ephemeral; the repo is not"): nothing in this conversation is safe to rely on once it ends, so before it does, make sure nothing load-bearing exists *only* here.
This is a check on this specific conversation, not on the documentation corpus — it needs the transcript, not a cold read of the repo.
If the docs themselves seem redundant or stale, that's the separate [`doc-audit`](../doc-audit/SKILL.md) skill; don't fold that in here, and don't run it as part of this by default (it's expensive and this needs to be cheap enough to run at the end of every session, not just the long ones).

## 1. Git state

```bash
git status --short
git branch --show-current
git log main..HEAD --oneline                 # anything unmerged?
git log origin/main..main --oneline          # anything unpushed?
git worktree list --porcelain                # every worktree, its branch, and any lock
git branch --merged main                     # branches already in main
```

When the project uses session worktrees (see [`CLAUDE.md`'s Version Control](../../../CLAUDE.md#version-control)), check all worktrees, not only this session's, since a stale one costs whoever runs into it next:

- **A worktree whose branch is already merged into `main`** — a cleanup candidate, left behind by a session that merged without finishing [`merge-to-main`](../merge-to-main/SKILL.md)'s step 4a.
- **Any worktree holding `main`** (`branch refs/heads/main` in the porcelain output) — it blocks every other session's merge, and should never outlive one.
- **A `locked` worktree whose session is gone** — the lock line names a pid;
  `ps -p <pid>` says whether it still runs.
- **The main checkout's HEAD isn't `main`'s tip** — new worktrees would start from an old `main`.

Surface whatever's found plainly — uncommitted changes, an unmerged branch, commits sitting unpushed, and any of the worktree states above.
Don't merge, push, or discard anything unilaterally; this step's job is visibility, not action.
The existing confirm-before-risky-action rules still apply in full.

## 2. Verification is still actually green

Don't assume "tests passed a few commits ago" still holds.
Re-run the project's actual verification gate — specified in [`CLAUDE.md`'s Project Context](../../../CLAUDE.md#project-context) (e.g. `npm test`) — against the current tree, not the diff you remember writing.

## 3. Scan the conversation for anything decided but not yet durable

Read back through this session for things that were agreed, ruled out, or scoped, and check each one against what's actually committed — don't assume coverage without checking:

- An explicit "don't touch X" or "leave Y as-is" — a deliberate non-change isn't in any commit diff since nothing about it was edited, so it only survives if written into a Backlog entry or ADR before the session ends.
- A rejected alternative and why — stops the same idea from being silently re-proposed in a future session.
- A scoping decision ("we're doing A now, B is explicitly out of scope").
- Anything the user pushed back on or corrected — if it changed the approach taken, it should be visible in why the code/docs look the way they do, not just in this transcript.

## 4. Route each item to where it actually belongs

Not everything undocumented belongs in the same place:

- **A project fact, decision, or piece of deferred work** → a commit message, an ADR under `docs/adr/` (if it's an architectural choice with real tradeoffs), or [`docs/backlog.md`](../../../docs/backlog.md) (if it's scoped-out work).
  A backlog entry goes in that file's `Unranked` section, never straight into a priority tier — a wrap-up knows this session, which is exactly the context that can't place an item against the rest of the list.
  Sorting it later is [`backlog-audit`](../backlog-audit/SKILL.md)'s job; leaving it unranked is the correct outcome here, not an unfinished one.
- **Something about how to work with this specific user** — a collaboration preference, a validated judgment call that isn't really about this codebase — doesn't belong in a repo file at all, even `CLAUDE.md`.
  `CLAUDE.md` is project documentation anyone maintaining this codebase would read; this instead belongs in the assistant's own cross-session memory.
  Don't write user-preference content into project docs to make it survive — it survives in the right place already.

## 4b. Reachability: could a cold session actually *find* it?

Writing something down and making it findable are different things, and this step exists because that gap costs real work whenever a resumption note or decision lands in a session-scoped scratch directory (`/tmp/claude-.../scratchpad/` or `~/.claude/plans/`) that no later session ever opens.

So, for anything step 4 just routed, and anything this session leaned on, run the link and reachability checker if present:

```bash
node scripts/check-doc-links.mjs
```

That covers the mechanical part.
The judgment part it can't check:

- **Would a fresh session reach this starting from [`README.md`](../../../README.md) or [`CLAUDE.md`](../../../CLAUDE.md) alone, following links?** If the only route is knowing a path in advance, it isn't reachable.
  Files under `/tmp`, the scratchpad, or `~/.claude/plans/` never count as reachable — they're per-session by construction.
- **Is any decision recorded *only* in a mockup or an external artifact?** A link to an HTML file is not a record of what it settled.
  The rule it established belongs in prose (a design spec for visual rules, an ADR for architectural ones); the artifact is evidence for a decision already written down, never the sole copy of it.
- **Did this session publish an Artifact that no committed doc references?** If it's worth keeping, add it to the relevant References/Visual record block.
  If it isn't, say so plainly rather than leaving it dangling.
- **Is there an in-flight epic whose index is now stale?** Update the status line and links while the context is still here.

## 5. Triage: finish now, or safe to defer?

For each item from step 3 that isn't yet durable, judge whether deferring it actually costs something, rather than defaulting to "add a Backlog line and move on":

**Recommend finishing now** when:
- It's a real, live bug that surfaced incidentally — not what the session set out to do, but genuine and cheap to fix while it's in view.
  Deferring risks it being forgotten entirely, since nothing prompted its discovery in the first place.
- Acting on it depends on reasoning that was expensive to build this session — a specific investigation, a call stack traced through several files, a nuanced judgment call worked out through back-and-forth — where a Backlog line would compress that reasoning down to a sentence and a future cold session would have to substantially redo the work to act on it.
  If writing the item down properly would take nearly as long as just fixing it, that's a strong signal to just fix it.
- It's small enough that the overhead of a future session re-establishing context to do it at all exceeds the cost of doing it now.

**Safe to defer** when:
- It's independently scoped and doesn't depend on anything discovered this session specifically — a cold session could pick it up from the Backlog entry alone with nothing lost.
- It's large enough to deserve its own planning pass regardless (per [`CLAUDE.md`'s Workflow section](../../../CLAUDE.md#workflow-planning--execution)) — don't rush something in just because this session happens to be the one that noticed it.

Present anything flagged "finish now" as a recommendation with the reasoning above attached, not a decision already made — this is scope the user didn't originally ask for, so it needs the same explicit go-ahead as any other out-of-scope finding.

## 6. Close with a clear go/no-go, not just a list

End with either "clean — everything's committed, nothing provisional left, safe to reset" or an explicit list of what's still only in this conversation and where each item is headed.
If it's been a while, or a lot of ground, since the last [`doc-audit`](../doc-audit/SKILL.md) run, say so as a suggestion — don't run it automatically.
The same goes for [`backlog-audit`](../backlog-audit/SKILL.md) when this session has added to `Unranked`, or when the backlog's own `last triaged` date has gone stale: suggest it, don't run it.

"Clean" has to mean reachable, not just written.
State the entry point explicitly — the file a cold session should open first, reachable from [`README.md`](../../../README.md) — rather than asserting that the information exists somewhere.
