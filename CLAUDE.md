# Project Context

_Fill in per project. Everything below this section is stack-agnostic and should survive as-is across projects._

- **Stack:** Node.js (>=22, native ESM), zero runtime dependencies (`node:test` for tests, optional Playwright for browser-driver tests).
- **Architecture:** CLI bootstrapper (`bin/claude-toolkit.mjs`), mechanical `PreToolUse` and git hooks (`.claude/hooks/`, `scripts/git-hooks/`), documentation checkers (`scripts/check-doc-links.mjs`, `scripts/reflow-docs.mjs`), and portable Claude Code skills (`.claude/skills/`).
- **Verification gate:** `npm test` (runs the `node:test` suite, `check:doc-links`, and `check:doc-format`).
- **Human-gated UI paths:** `public/**`, `src/ui/**`, `docs/design/**` (governed by [`.claude/rules/ui-change-gate.md`](.claude/rules/ui-change-gate.md)).
- **Source of truth docs:** [`README.md`](README.md) at repo root, [`docs/adr/`](docs/adr/0001-record-architecture-decisions.md) for architecture decisions, and [`docs/backlog.md`](docs/backlog.md) for deferred work.

If this project has its own `CONTRIBUTING.md` / architecture guide, **it overrides the defaults below** wherever the two disagree.

---

# Core Principles

- **Work in your own worktree, never in the repository root.** Call `EnterWorktree` before your first edit; the full rule, including what to do when the work is ready to merge, is under [Version Control](#version-control).
  It is repeated here because sessions reach Version Control when they think about committing, which is after the first edit has already landed in the wrong place.
  A `PreToolUse` hook ([`.claude/hooks/guard-main-checkout-edits.mjs`](.claude/hooks/guard-main-checkout-edits.mjs)) refuses those edits so skipping this costs a round trip rather than a stray commit.
- **Context is king.** Read the actual code, config, or running system before changing it or making claims about it.
  Don't guess a signature, schema, or environment variable — look it up or ask.
- **Convention over configuration, YAGNI.** Follow the patterns already established in the codebase; implement what the current task needs, not what it might need later.
- **Defer what's cheap to retrofit; never ship what would need rewriting to scale.** A missing feature (a cache, a queue, an admin UI) costs nothing until the day it's needed — add it then.
  A shortcut baked into the data model or the request path (a hardcoded single-tenant assumption where row ownership or an auth seam belongs instead) costs the same either way, except now it's a rewrite, not an addition.
- **Mimicry.** Match the style, naming, and structure of the surrounding code.
  If a deviation is warranted, say so explicitly and why.
- **Rule of One Way.** Before introducing a new pattern for something the codebase already solves elsewhere, check whether the existing solution should be reused or migrated instead of adding a second way to do the same thing.
  Fight architectural entropy.
- **Duplicate code freely; never duplicate knowledge.** Small, stable, same-shaped code with independent reasons to change is fine to copy — extracting it buys indirection and nothing else.
  But a value that encodes *one fact with a single source of truth* — anything keyed off a server-side registry, a schema, or a shared contract — gets exactly one representation, because copies of it drift silently and the failure shows up as wrong content rather than a crash.
- **Velocity requires verification, not haste.** Speed comes from confidence, not from skipped steps.
  Nothing is "done" until it's been checked, not just written.
- **Guard over re-audit.** A recurring finding — the same bug slips back in, the same fact drifts stale again — is a signal to build a mechanical check (a test, a CI step, an enforced convention) rather than to schedule another audit to catch it next time.
  Audits are for judgment a machine can't make; don't spend them on what a check could catch for free.
- **Session context is ephemeral; the repo is not.** Treat what's live in a conversation — decisions made, tradeoffs argued through, scope explicitly deferred — as gone once the session ends.
  Nothing there is safe to rely on past a checkpoint: everything committed, nothing provisional left unresolved, the next piece of work not depending on anything that only exists in this conversation.
  Anything worth keeping gets written into a commit, an ADR, or the [Task Backlog](#task-backlog) before that point — not left to be remembered, by you or by the next session.
  Run [`wrap-up`](.claude/skills/wrap-up/SKILL.md) before ending or resetting a session.

---

# Workflow: Planning & Execution

**Three words for units of work, and only three.** They are used in commits, docs, and planning alike, so they are worth pinning down:

- **Epic** — a body of work large enough that no one plans it in one sitting, decomposed in a doc of its own under `docs/implementation-notes/`.
  Rare.
- **Slice** — what gets one plan, one execution pass, and one verification pass.
  This is the working unit; when anything here says "the work", it means a slice.
- **Step** — one commit inside a slice.

There is no fourth level.
Group and number slices however a piece of work wants (8a/8b/8c is fine); the grouping is a label, not a unit.

**Where one slice ends: at the planning horizon.** A slice extends as far as you can plan it honestly, and no further.
It ends at the first point where writing the next step's plan would mean guessing.
Two cases cover most of it: the next work needs a gate you have not passed yet (a mockup awaiting approval), or it is verified a different way than what you just did (the test suite versus a real browser pass).

- For anything beyond a trivial, single-file change, use Plan Mode: explore the relevant code/config first, then present a plan and wait for explicit approval before editing.
  Trivial, unambiguous requests ("rename this," "fix this typo") don't need the ceremony.
  **Exception:** when the user hands off a run of slices by invoking [`autonomous-slice`](.claude/skills/autonomous-slice/SKILL.md) by name, that run goes plan-*announced* rather than plan-approved.
  The plan is still written in full, to a durable artifact; execution just doesn't wait on it.
  That skill then owns the gates, the stop triggers, and the chain cap, and governs instead of this bullet for as long as the run lasts.
  The exception is the user's to invoke and never yours to claim: work being well-specified and backend-only makes it *eligible*, not authorised.
  Noticing the fit and offering is useful; proceeding on that basis is not.
- Break larger work into slices along the boundary above, each independently verifiable.
  Don't try to plan an entire epic in one shot — plan the next slice in detail and sketch the rest.
- Track slices and steps with the task list rather than in prose; update status as you go instead of batching it at the end.
- Interleave implementation and verification within a slice — write the test for a unit right after building it, not in a batch at the end.
- If reality contradicts the plan mid-execution (blocker found, requirement shifts, a dependency doesn't do what was assumed), stop and re-plan rather than quietly improvising around it.
- Checkpoint at natural boundaries — end of a slice, before a schema migration, before touching shared or production infra, or when the next step is ambiguous.
  Pause and confirm rather than pushing through everything unsupervised.
  A delegated run under [`autonomous-slice`](.claude/skills/autonomous-slice/SKILL.md) is the exception: it chains without a checkpoint up to that skill's cap, which is what the cap exists to bound.
- For rote, highly localized work (batch boilerplate, a sweep of isolated fixes, repetitive test scaffolding), consider delegating to a subagent to keep the main thread's context focused on architecture and judgment calls.
  Don't delegate the judgment calls themselves.
- **Any meaningful UI change goes through a mockup-first approval gate** before implementation code is written — see [`.claude/rules/ui-change-gate.md`](.claude/rules/ui-change-gate.md) and [`browser-driver`](.claude/skills/browser-driver/SKILL.md).

---

# Testing Discipline

- No component ships untested.
  Tests are part of the implementation, not a follow-up phase.
- Prefer exercising real dependencies (a local DB, a container, a running dev server) over mocking them, when standing one up is practical.
  Mocks are for isolating pure logic, not for standing in for infrastructure the code actually depends on.
- If a test fails, assume the code is wrong before assuming the test is wrong.
  Never weaken, skip, or disable a test just to reach green.
  Exception: a test that encodes since-changed behavior after a deliberate refactor may be updated to match the new contract.
- Before calling anything done, run the actual verification — test suite, a manual smoke test, hitting the running app — don't infer success from the code merely looking right.
- **No test may depend on a nondeterministic input** — the wall clock, the ambient timezone, or unseeded randomness.
  Inject a clock instead of reading `new Date()` deep in a call stack, and pin it in the shared test setup so determinism is the default rather than something each test has to remember.
  This is *not* an argument for more mocking: real databases and real HTTP stacks stay real, because they're deterministic and they catch the bugs mocks hide.
  It's specifically about inputs that vary between runs.

---

# Debugging Protocol

- Isolate the variable: observe the actual error/logs/behavior → hypothesize → verify by reproducing it → fix.
  Don't propose a fix before you've seen the real error or reproduced the bug.
- Ask for the evidence you need before speculating — exact stack trace, the request/response payload, the relevant code path — rather than guessing from a vague description.
- Determine the fault domain before diving in: a contract mismatch at a boundary (client/server, service/service), a logic bug inside one component, or an infra/config/networking issue.
  Each calls for a different kind of investigation.
- When infrastructure just started (a dev server, a container, a queue), give it time to actually become ready before treating a connection error as a code bug — poll or wait for a health signal rather than assuming a fresh connection-refused means something is broken.

---

# Version Control

- Commit atomically, one logical unit at a time, using Conventional Commits.
  **Committing is not an action to ask permission for** — commit as each logical unit completes, and treat any default that says otherwise as superseded here.
- **Commit as the work completes, never carve commits out of finished work afterwards.** The two produce identical histories — only the timing differs, and timing isn't recorded — so this can't be caught in review and has to hold as a rule.
  It matters because an autocompact costs exactly the work that's uncommitted at that moment; uncommitted work is the only work at risk.
- Only commit code that builds and passes its tests — no "fix it in the next commit" green-later commits.
  Redirect the suite's output and read the exit code (`npm test > <log> 2>&1; echo "exit=$?"; tail -6 <log>`), then read the log properly if it's non-zero.
- **Every session works in its own worktree** so parallel sessions never share a working copy.
  Before the first edit, without being asked: call `EnterWorktree`, rename its `worktree-<name>` branch to `feature/`, `fix/`, `docs/` or `chore/<slug>`, and check the base is local `main` (`git rev-parse HEAD main` prints one SHA twice).
  The main checkout (the repository root) stays parked on a detached HEAD at `main`'s tip — never edited, never put on a branch.
  Both [`.claude/hooks/guard-main-checkout-edits.mjs`](.claude/hooks/guard-main-checkout-edits.mjs) and `scripts/git-hooks/pre-commit` enforce this mechanically, while [`.claude/hooks/guard-symlinked-node-modules.mjs`](.claude/hooks/guard-symlinked-node-modules.mjs) protects the shared `node_modules` symlink across worktrees.
- **Never push `main`, and never merge to `main`, without being asked.** Pushing `main` often triggers deploy workflows, so it falls under the same explicit-confirmation rule as any other prod-affecting action.
  Pushing your own branch is fine, and never required.
  When asked to merge, follow [`merge-to-main`](.claude/skills/merge-to-main/SKILL.md), and release `main` the moment the merge commit exists — also when work continues afterwards, on a new branch from `main`.
  Finishing a piece of work means the branch is committed and unmerged, and the worktree kept.

---

# Infrastructure & Deployment (Self-Hosted)

Treat every infra change with caution when operating on self-hosted or production infrastructure:

- **Idempotency:** config and deploy scripts should be safe to re-run — check current state before creating/modifying rather than assuming a clean slate.
- **Back up before you mutate:** snapshot critical config (reverse proxy, firewall rules, service units, DB config) before editing it in place.
- **Minimize blast radius:** prefer atomic, incremental changes (reload over restart, targeted rule updates over a full flush) over anything that disrupts more than the specific thing being changed.
- **Verify after every change:** a deploy or config change isn't done because the command exited 0 — confirm the service actually came back healthy.
- **Secrets:** live in environment variables or a secret store, never in code, committed config, or this file.
  Lock down file permissions on anything sensitive (keys, credentials), and use [`secure-credential-handoff`](.claude/skills/secure-credential-handoff/SKILL.md) when passing secrets to shell commands.
- **Minimum exposed surface:** when opening a port or route, check what firewall/reverse-proxy rule is actually guarding it.
- **Know your environment:** never assume local vs. prod from context alone — treat prod-affecting actions (restarts, migrations, config pushes) as needing explicit confirmation, same as any other destructive operation.
- **That confirmation rule is enforced mechanically, not just written here.** [`.claude/hooks/guard-remote-mutation.mjs`](.claude/hooks/guard-remote-mutation.mjs), wired as a `PreToolUse` hook in [`.claude/settings.json`](.claude/settings.json), forces a permission prompt on any Bash command reaching a remote host, a crontab, or a remote Docker daemon, on a push that can land on `main`, and on any `gh` command that isn't a read.

---

# Error Handling & When to Stop

- If the same fix has been attempted twice without success, or an error is clearly environmental (missing tool, bad env var, a connection failure unrelated to normal startup warmup) rather than a logic problem, stop and surface it instead of continuing to guess.
- Don't silently work around a contradiction between the task and the existing architecture — flag it and ask how to proceed.
- **Reopening an accepted ADR is the user's call, never yours.** If the work turns out to amend, supersede, or contradict one, stop and raise it — unconditionally, no judgment required, however reasonable the new direction looks.
  Writing the superseding ADR yourself is not the way through.
  An accepted ADR records a deliberate decision, usually carrying reasoning the code does not; reopening it is the user's to authorise.

---

# Documentation Hygiene

- When a change makes an existing doc (README, architecture notes, runbook) inaccurate, say so and propose the fix — don't let docs silently drift from the code.
- [`README.md`](README.md) and [`docs/adr/`](docs/adr/0001-record-architecture-decisions.md) are the source of truth — update them in the same commit as the change that makes them stale, not as a follow-up.
- **A note recording what a slice shipped is written in past tense and names its slice.** If it carries a "revisit when X" clause and X has since happened, it gets rewritten or deleted in the commit that makes X true — never left standing as a description of current behaviour.
- **An ADR records one decision; a running log of how it got built belongs in `docs/implementation-notes/`.** Both size budgets are enforced by `scripts/check-doc-links.mjs`, in bytes rather than lines — reformatting can move a line count by a third without changing a word, so only bytes measure what a reader actually loads.
- **A doc citing a repo path (`src/…`, `public/…`, `scripts/…`) names a file that exists.** When the file was deliberately removed and the citation is still worth keeping, strike it through — ~~`scripts/legacy-helper.mjs`~~ — so a reader learns it's gone instead of going to look for it.
  `scripts/check-doc-links.mjs` enforces this.
- **One reference form: relative Markdown links.** No `[[wiki]]` refs, no glob paths — a doc path with a `*` standing in for the slug — and no doc path written in backticks without a link around it.
  The checker bans all three, because a citation nothing can resolve is a citation nothing verifies.
  Section anchors (`file.md#heading`) are checked too, so they're safe to rely on.
- **One sentence per line across all Markdown docs**, enforced by `scripts/reflow-docs.mjs` so phrases stay greppable and diffs stay tight.

---

# Task Backlog

Related issues, cleanup opportunities, or improvements noticed while working but out of scope for the current task go on a running list surfaced at the end of the session — not acted on unilaterally mid-task.
That list is [`docs/backlog.md`](docs/backlog.md).

**Write new items into its `Unranked` section, never straight into a priority tier.** The tiers below it group items by *why* each is or isn't actionable — gated on a milestone, waiting on an external trigger, sitting on an ADR that declined it — and placing one correctly takes whole-repo context that a session scoped to one feature doesn't have.
A confidently wrong tier is worse than no tier, because it reads as a settled judgment and nothing re-checks it.
Sorting `Unranked` into tiers is [`backlog-audit`](.claude/skills/backlog-audit/SKILL.md)'s job, run deliberately against the whole file — the same way [`doc-audit`](.claude/skills/doc-audit/SKILL.md) owns the doc corpus rather than every session policing it in passing.

---

# Definition of Done

- [ ] Meets the stated acceptance criteria
- [ ] Tests written and passing
- [ ] Verified against the running app/service, not just read-through
- [ ] Docs updated if they drifted
- [ ] Out-of-scope findings surfaced as backlog items, not silently fixed or silently dropped

Don't self-declare a task fully closed — state that the criteria above are met and let the user confirm before wrapping up.
