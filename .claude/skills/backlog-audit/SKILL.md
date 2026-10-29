---
name: backlog-audit
description: Sort docs/backlog.md's Unranked section into priority tiers, and re-validate the tiers already placed. Use when the user asks to triage, re-prioritise, or excavate the backlog, asks what to work on next, or says the backlog has drifted or grown unsorted. Not for adding a single item — that goes straight into Unranked with no audit. Not run automatically or on a schedule; invoked by judgment, typically when Unranked has accumulated or a gate that was blocking several items has lifted.
---

Works best cold, with no assumed session history — read the repo as it stands.
A tier placement has to be justifiable from the written record, because the next session that reads it will have nothing else.
If the reason an item sits where it does exists only in a conversation, it isn't a placement, it's a memory.

This skill sorts and re-validates.
**It never executes backlog items** — deciding what to do and doing it are different judgment calls, and conflating them is how a triage pass turns into an unplanned slice.
Finish by reporting; let the user pick.

## 1. Why the tiers exist, and what they are

[`docs/backlog.md`](../../../docs/backlog.md) groups items by **why each is or isn't actionable**, not by a numeric rank.
Numbers force false precision (is slot 3 really above slot 5?) and forget the reason, which is the part that goes stale and the part a reader actually needs.

| Tier | What lands here |
|---|---|
| `Unranked` | Everything on arrival. The landing zone; this skill's input. |
| `Do next` | Unblocked, high value-to-cost, and nothing about it is waiting. Keep it short — a tier holding a third of the list is not a recommendation. |
| `Ready, unblocked` | Well-defined and actionable, but not the next thing you'd reach for. |
| `Gated on an in-flight milestone` | Doing this now would produce something an active redesign or migration *discards* rather than adapts. Narrow by design — see step 4's rule 3. |
| `Needs a decision, not just effort` | The work is understood; what it should *do* is not settled, and code-reading won't settle it. |
| `Waiting on an external trigger` | Nothing to do until something outside the item changes. The trigger is named in the item. |
| `Not sanctioned without explicit authorisation` | Sits on an accepted ADR that weighed the work and declined it. |

Within a tier, order carries no meaning — don't spend the audit ranking inside one.

## 2. Read the whole file first, then the gates it depends on

Tiering an item against the other items is the entire job, so partial reads produce confident nonsense.

```bash
wc -c docs/backlog.md
grep -n '^## \|^- ' docs/backlog.md    # structure and item starts
```

Read [`docs/backlog.md`](../../../docs/backlog.md) in full.
Then read whatever the tier boundaries turn on, because these are the facts that move items between tiers and they live outside the backlog:

- Any milestone or handoff doc an item is gated on.
- Any ADR under `docs/adr/` an item cites (step 3).

## 3. Before tiering anything: the ADR-rejection check

**Run this on every Unranked item that cites an ADR, before deciding where it goes.** An item sitting on a deliberately-declined decision belongs in `Not sanctioned`, and no other tier is correct for it — so this check gates placement rather than following it.

The failure it exists to catch is specific: an item reads as ordinary work while the ADR it cites weighed and declined that exact scope, inviting an agent to implement it and write a superseding ADR to make room.

For each ADR-citing item, read the cited ADR **in full** — not its title, not a grep of it — and sort the citation into one of three:

- **The ADR prescribes this work** → an ordinary tier.
- **The ADR states it as an accepted tradeoff, and the item says so** → ordinary tier, usually `Waiting on an external trigger` with the revisit condition named.
- **The ADR weighed this exact scope and declined it** → `Not sanctioned`, and add one sentence to the item saying so outright.

The label matters more than the tier: it sits in the item an agent actually reads, where a stop trigger in some other document may already have been passed.

An item citing no ADR is not exempt from thought — ask whether one *should* govern it, especially anything touching auth, persistence, or module boundaries.

## 4. Place each Unranked item

For each, in order of what most constrains it:

1. **Is it sanctioned?** Step 3 answers this.
   If not, it goes to `Not sanctioned` and you're done.
2. **Is it waiting on something external?** A named upstream issue, an unbuilt feature it depends on, a threshold ("if the list grows past…").
   If the trigger can be stated in one clause, it belongs in `Waiting on an external trigger` — and if it can't, the item is probably under-specified, which is itself the finding.
3. **Would the deliverable itself be discarded by an in-flight milestone?** Ask what the upcoming milestone or redesign would actually do to the finished work:
   *discard* it → `Gated on an in-flight milestone`; merely *restyle or adapt* it → tier on its merits.
   A rename, a migration, a structure refactor, a process fix, and a bug in state or behaviour all survive a visual redesign untouched, however many frontend files they touch.
4. **Is what it should do actually settled?** If the item's own text contains a genuine open question, it's `Needs a decision`, however clear the implementation would be.
5. **What's left is actionable** — split between `Do next` and `Ready, unblocked` on value-to-cost and on whether anything about it expires.
   An item with a stated deadline signal outranks one without.

Write the placement's *reason* into the item if it isn't already legible from its text.
A tier heading plus an item that doesn't explain why it's under that heading is the stale-judgment problem this structure exists to avoid.

## 5. Re-validate the tiers that were already placed

This is the half that's easy to skip and is usually where the findings are.
The `Tiers below last triaged` date at the top of the file says how much drift to expect — **the audit's first job is checking whether its own previous output is still true.**

Walk every already-tiered item and ask two things, not one:
*has the reason it sits here changed?* — and *was that reason ever right?* A placement is a judgment someone made on one day, and nothing else in this process ever re-examines one; if this step only checks whether the world moved, a wrong placement is permanent by construction.

- **`Waiting on an external trigger`** — has the trigger fired? Check the actual upstream or repo state, don't take the item's word for it.
  A fired trigger promotes the item.
- **`Gated on an in-flight milestone`** — *has the gate moved?* And *does this item still meet step 4's rule 3 at all?* Re-run that test on every item in the tier, every pass.
- **`Needs a decision`** — was the decision made since, in an ADR, a commit message, or a design doc? If so it's now ordinary work, and the decision needs citing in the item.
- **`Not sanctioned`** — unchanged unless the user has explicitly authorised reopening.
  **Never promote one of these on your own judgment**, however reasonable the case looks.
  If the case for reopening looks strong, that's a line in the report, not an edit.
- **`Do next` / `Ready, unblocked`** — is it still unblocked, and does it still exist? An item can be quietly resolved by unrelated work; verify against the code, not the prose.

**A gate that has not moved across several passes is a prompt, not a resting state.** The longer a gate sits, the more items accumulate behind it and the less any of them has been re-read — so a long-stationary gate earns a full re-derivation of its tier from scratch, not another status check.

Also check the reverse direction: an item can *demote*.
Work that shipped since may have introduced a gate that didn't exist when the item was placed.

## 6. Items that are done, obsolete, or were never work

Three different outcomes, three different fates — don't collapse them into deletion:

- **Done** — remove it.
  The commit that did the work is the record.
- **Obsolete** (real once, overtaken by other work) — move it to `Reviewed and deliberately not carried forward`, struck through, with one sentence on what overtook it.
  [`CLAUDE.md`'s Documentation Hygiene](../../../CLAUDE.md#documentation-hygiene) is explicit that a stale claim shouldn't just vanish; a reader who remembers the item needs to learn it's gone and why.
- **Examined and judged not to be a work item** — same section, not struck through.

The `~~struck~~` marker is load-bearing:
`scripts/check-doc-links.mjs` reads it to allow a citation to a path that no longer exists.

## 7. Verify, then report

Run the project's verification gate (including `scripts/check-doc-links.mjs` and `scripts/reflow-docs.mjs --check`).
A reorganisation should move no item's text — if you moved items without rewriting them, confirm it:

```bash
git show HEAD:docs/backlog.md | grep -v '^#' | grep -v '^$' | sort > /tmp/old.txt
grep -v '^#' docs/backlog.md | grep -v '^$' | sort > /tmp/new.txt
diff /tmp/old.txt /tmp/new.txt    # only intended prose changes should appear
```

Update the `Tiers below last triaged` date and commit SHA in the same commit — a triage whose date says it happened earlier is worse than an undated one, because it invites trust it hasn't earned.

Then report:

- **What moved, and why** — per item, the tier it left and the reason that changed.
  This is the finding list; a pass that moved nothing should say so plainly rather than manufacturing movement.
- **What fired** — triggers that have come true since the last audit, since these are the promotions the user most needs to know about.
- **What's now in `Do next`**, and the honest reason it's there.
- **Anything under-specified** — items whose text couldn't justify any tier.
  These need the user, not another audit.

Suggest a next item or batch conversationally.
**Don't write that suggestion into the repo** — it's re-derivable from the tiers at any time, so committing it just creates a second thing to go stale, which is the failure this whole structure exists to avoid.
