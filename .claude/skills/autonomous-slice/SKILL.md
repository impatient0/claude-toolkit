---
name: autonomous-slice
description: Runs a handed-off sequence of already-specified slices to completion without the user present — a plan artifact and verification pass per slice, a commit per step, stop triggers throughout, and a report at the cap. For delegated, unattended, multi-slice work: an epic's run of backend slices, or a batch of items specified well enough to execute without guessing. Not for a single fix with the user sitting there, where a checkpoint is cheap and Plan Mode is better; never for human-gated UI paths. Invoke it only when the user asks for it by name — if work looks like it fits, say so and offer, because granting yourself autonomy is the one thing this protocol does not authorise.
---

This is not Plan Mode, and the two never compete.

Plan Mode is a harness state: if it is active, `ExitPlanMode` is the only way out and it blocks until the user answers.
That is a hard constraint, always detectable, and it always wins — if the harness has gated you, honour the gate and stop reading here.
This skill applies only in the ordinary ungated state, and it replaces "write a plan and wait" with "write a plan, announce it, and proceed" for the narrow class of work that qualifies below.

## Scope: delegated, unattended, multi-slice runs

Everything below is specific to that case, and the four things this protocol provides are worth naming because each one is worthless without it: collapsing a run of approval round-trips into one handover and one report; deciding when to stop with nobody watching; keeping the work recoverable if an autocompact lands mid-run; and attributing choices nobody saw being made.

None of that applies to one well-defined fix with the user present and responsive.
There the checkpoint is cheap, Plan Mode actually blocks where this only announces, and a plan artifact is pure overhead.

**The user grants this; you do not.** Authority to skip the approval gate comes from the user invoking the skill by name, and from nothing else — not from a backlog item being well-written, and not from the user having said "go ahead" about the work itself.
Noticing that a job fits is useful, so say so and offer.
Invoking on your own initiative is the one move this protocol does not authorise, because deciding to skip a human checkpoint is exactly the decision that should not be self-granted: qualification would stop being a test and start being a thing to satisfy, since passing it is rewarded with freedom.

All paths below are relative to the repo root.

## 1. Does this slice qualify?

Both gates must pass.
They answer different questions and neither substitutes for the other.

**Gate A — verification.** Will the change touch any human-gated UI paths (as listed in [`CLAUDE.md`'s Project Context](../../../CLAUDE.md#project-context), e.g. `public/` or frontend directories)?

```bash
git status --short    # and think ahead: will the planned work touch human-gated UI paths?
```

If yes, this skill does not apply.
Frontend/UI work keeps every gate it has: mockup first, explicit approval, then the wide-viewport browser pass in [`browser-driver`](../browser-driver/SKILL.md#verifying-a-ui-change).
That is where visual and layout bugs actually live, and the ceremony there is load-bearing.

If no, the automated verification suite is the gate and Gate B decides the rest.

**Gate B — definition.** Can you name the file and section that says what this slice should do?

This is not a permission test.
Permission was settled the moment the user invoked the skill, and re-asking it here would only invite you to talk yourself into it.
The question is narrower and entirely factual:
**is this slice specified well enough to build without guessing, or are you about to invent scope with nobody watching?**

Not "are you confident," which is the question an agent cannot answer honestly about its own blind spots — a judgment mistake *is* failing to notice a choice existed.
The test is a citation: an ADR under `docs/adr/`, a section of [`docs/backlog.md`](../../../docs/backlog.md), a design doc, a brief the user wrote, or a decision recorded earlier in this same conversation.
Write the citation into the plan artifact.
If you cannot produce one, stop and ask.
The work is not blocked on approval; it is blocked on definition, which is a different thing and the user is the only source for it.

**Re-run this for every slice in the chain, not once at the start.** It matters least on slice one, where the user just handed the work over and is still nearby, and most on slice three, where the last human read of the plan is two slices behind you.
That is the whole reason the chain is capped rather than open-ended — see section 6.

## 2. Stop triggers

**Section 1's gates decide whether a slice starts; these decide whether it keeps going.** A different mechanism, not a second opinion on the same question — passing both gates cleanly is not evidence against tripping one of these on the fourth commit.
They stay live for the whole slice: stop and raise the question the moment the work turns on any of them, whenever that is.

Three are often visible in the task before any code is written, which is the cheapest time to catch them.
That is a note on where they are easy to spot, not on when they apply — a trigger that surfaces mid-execution is the ordinary case rather than an edge one, and "it didn't come up at the start" settles nothing.

- **A decision with a steady state** — one that is buildable, testable, green, and wrong in a way that only shows after many iterations.
  Anything whose real question is "what does this look like long-run."
- **A decision encoding a value judgment about the user.** No amount of code-reading produces product taste.
- **A decision where the data means something other than what it says.** These are where an agent is most confidently wrong, because the surface reading is coherent.
- **A decision that contradicts an accepted ADR.** Unconditional stop, no judgment required.
  [`CLAUDE.md`'s Error Handling & When to Stop](../../../CLAUDE.md#error-handling--when-to-stop) owns this rule and it binds in every session; it is repeated here, and again in section 4, because it cannot be evaluated until research is already underway — you do not learn an ADR is in the way until you have read it.
- **Work that mutates state outside the working tree.** A remote host, a crontab, a container runtime, DNS — anything whose effect outlives `git checkout`.
  Unconditional stop, and the one trigger neither gate can reach:
  Gate A asks about UI paths and Gate B asks whether the work is *defined*, so a well-specified backlog item that happens to reconfigure a remote host passes both cleanly.
  [`.claude/hooks/guard-remote-mutation.mjs`](../../hooks/guard-remote-mutation.mjs) forces a permission prompt on these mechanically; this trigger is the half that still holds if the hook is ever disabled or evaded.

Stopping is a normal move and costs one message.
Proceeding wrongly costs a slice plus the rework.
Tune accordingly.

## 3. Write the plan artifact

Plans live outside the repo, because they are snapshots rather than maintained documents and the doc corpus's rules (reachability, byte budgets, struck-path markers) all assume maintenance.
Name the file for its content, not for the session — writing one file per *session* silently overwrites every plan after the first.

```bash
PROJ_SLUG=$(git rev-parse --show-toplevel | tr '/' '-')
mkdir -p ~/.claude/projects/"$PROJ_SLUG"/plans
# then write: <that dir>/YYYY-MM-DD-<content-slug>.md
```

The artifact must carry:

- **The base commit SHA**, from `git rev-parse HEAD`, on its own line near the top.
  This is what makes the plan recoverable after an autocompact — see section 7.
- **The Gate B citation** — file and section.
- **Enumerated steps**, each naming the commit it is expected to produce.
  One step, one commit.
- **An "Unmandated calls" section**, empty at first, appended to during execution — see section 5.

Announce the plan in the conversation.
Do not wait for a reply.

## 4. Execute

**Before writing anything: if the work turns out to amend, supersede, or contradict an accepted ADR, stop and raise it.** This is section 2's fourth trigger, repeated here because it is the only one that cannot honestly be evaluated up front — you do not discover an ADR is in the way until you have read it, and that happens during research, after qualification is behind you.

Writing the superseding ADR yourself is not the way through.
An accepted ADR records a decision someone made deliberately, usually with reasoning the code does not carry; reopening it is theirs to authorise, not yours to route around by writing a newer ADR that wins on number.

**Worktree first (when session worktrees are enabled).** Per [`CLAUDE.md`'s Version Control](../../../CLAUDE.md#version-control), if this session isn't in a worktree yet, call `EnterWorktree` before editing anything, then:

```bash
git branch -m "$(git branch --show-current)" feature/<slug>    # or fix/, docs/, chore/
git rev-parse HEAD main                                          # must print the same SHA twice
```

**Commit on completing each planned step**, not in a batch afterwards.
This is the single most important rule in this skill and it cannot be audited after the fact: committing as you go and carving commits at the end produce identical histories, differing only in timing, and timing is not recorded anywhere.
The reason it matters is blast radius — an autocompact costs you exactly the work that is currently uncommitted, so uncommitted work is the only work at risk.
Commit authority here is explicit and unconditional: do not ask.

**If the step involved a call the cited source did not specify, that commit carries an `Unmandated-call:` trailer** — written here, as you commit, not reconstructed afterwards:

```
Unmandated-call: <one line — what was chosen, and what the record was silent about>
```

Recording it in the plan artifact alone is not enough, and the difference is not bookkeeping: plan artifacts live outside the repo, so the trailer is the only surface that survives alongside the code and the only one `git log --grep` can reach.
Section 5 has the threshold for what clears the bar; what belongs here is the mechanical half — the trailer goes on this commit, now.

Every commit builds and passes the project's verification suite first.
Redirect the output rather than reading it in full when green:

```bash
LOG=/tmp/verify-<step>.log
npm test > "$LOG" 2>&1; echo "exit=$?"; tail -6 "$LOG"
```

On a non-zero exit, read the log — properly, not in summary.
[`CLAUDE.md`'s Debugging Protocol](../../../CLAUDE.md#debugging-protocol) requires seeing the real error before proposing a fix, and the full output is sitting on disk for exactly that.

**Never push, and never merge to `main`.** Pushing or merging `main` is the user's call.
Finish with the branch committed, unmerged, and unpushed, and the worktree kept.

## 5. Record unmandated calls

Attribution is not recorded for every decision — a decision the user made is already attributed by the discussion having happened.
What gets recorded is the exception:
**you chose, and nothing in the Gate B citation specified it.**

The threshold is a choice that was not specified by the cited source **and** is either non-trivial to reverse or visible to the user.
Schema shape, error semantics, default values, and anything setting a precedent the next slice will copy — those count.
Naming and local structure do not.

Its real value is not the audit trail; it is that having to write the line raises the question in the moment, which is the only time it is cheaply answerable.
Three surfaces, each with a different reader:

1. **The plan artifact's "Unmandated calls" section**, written when the call is made.
   This is what the chain report aggregates from.
2. **A commit trailer** on the commit that implements it, so the set stays greppable across history:

   ```
   Unmandated-call: <one line — what was chosen, and what the record was silent about>
   ```

3. **A sentence in the ADR**, when the call turns out to be architectural.
   That is not extra work — such a call was getting an ADR regardless.

## 6. The chain cap

**A slice is what gets one plan, one execution pass, and one verification pass**, and it ends at the planning horizon — as far as you can plan honestly, and no further.
[`CLAUDE.md`'s Workflow section](../../../CLAUDE.md#workflow-planning--execution) owns that definition; this section only counts them.
The practical test is whether writing the next step's plan would mean guessing: if it would, the slice ends and the next one begins with its own plan artifact, its own Gate B citation, and its own verification.
The two usual reasons are a gate you have not passed yet (a mockup awaiting approval) and a change in how the work is verified (`npm test` versus a browser pass).

Do not split work that is fully plannable up front just to make more slices.
Six mechanical extractions all verified the same way are one slice with six steps, not three slices — that produces identical suite runs against arbitrary subsets, which is ceremony without information.

Chain at most **three** completed slices, then stop before starting a fourth.
Count completed ones only; never stop mid-slice.
Three is the default, not a ceiling: the user sets the bound at handover, so "run the whole epic" or "do all six" moves it.
What they cannot do is remove it — a stated bound of six still forces a report at six, and it is the report that does the work.

**The cap is a feedback interval, not a permission bound.** Every other chain break (a stop trigger, a missing Gate B citation, the same fix failing twice) is content-dependent — it fires when something has visibly gone wrong.
The number is the only bound that fires when nothing *appears* wrong, which is the case that matters, because Gate B is a self-graded test and a self-graded test cannot detect that it is grading itself wrong.
Only a human reading the report can, and the cap is what guarantees that read happens within bounded work rather than whenever the agent decides it is finished.

**Before writing the report, re-read every unmandated call you recorded and assess it as a set.** Collecting them is not reviewing them: a flat list mixes "unspecified, but this was the only reasonable option" with "this should have been discussed and I picked something to keep moving," and the second kind is a deferred decision — a stop trigger that got dismissed — rather than a documentation entry.

Three questions, each answerable by re-reading what you already wrote.
None of them asks how confident you are:

1. **Does this call's own justification cite the specification, or the existing code?** Reaching for what the codebase already does, in place of what the cited source requires, is the clearest signature of a call that may be wrong.
2. **Did you consider stopping on this and decide not to?** A fact about what happened rather than a judgment about the outcome, and a yes means it belonged in section 2.
3. **Has anything since contradicted it?** A later step, a test result, a later call that assumed otherwise.

The review has to change something to have run: flag a call, reorder the list, or propose a correction.
"They all look fine" is a failed review rather than a clean result — if that is genuinely the outcome, say which question each call survived and how.

At the cap, report:

- **What changed** — per slice, with the commit range.
- **How it was verified**, including a concrete recipe the user can run to confirm by hand.
  Not "tests pass" — the actual command, endpoint, or query.
- **What was deferred**, and where it was written down.
- **What was surprising.**
- **Unmandated calls**, ordered by the review above rather than by when they were made — anything flagged first, each with the question that flagged it, and any correction you are proposing.

Then wait.

## 7. Recovering after an autocompact

You cannot see how full your context is and you cannot compact deliberately, so treat an autocompact as a certainty rather than a risk and make it survivable.
The plan artifact holds intent; git holds progress.
Neither needs session memory:

```bash
PROJ_SLUG=$(git rev-parse --show-toplevel | tr '/' '-')
PLAN=~/.claude/projects/"$PROJ_SLUG"/plans/<the-plan>.md
git log <base-sha>..HEAD --oneline    # base SHA is in the plan artifact
```

Diff the commits against the plan's enumerated steps and resume at the first step with no commit against it.
If the git ledger is genuinely ambiguous, the full session transcript persists as `<session-uuid>.jsonl` under `~/.claude/projects/`; reading it back is expensive, so treat it as a fallback, not the mechanism.
