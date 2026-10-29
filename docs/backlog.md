# Backlog

Noticed while building, out of scope at the time.
Nothing here is scheduled; the list exists so a thing noticed once doesn't have to be noticed again, and so a cold session can pick an item up without the context that produced it.

This file is allowed to grow; items come out when they're done, or when they're found not to apply.

**A new item goes in [Unranked](#unranked), never straight into a tier.** Placing one correctly means knowing what else is on the list and what gates it — an in-flight milestone, an unmet precondition, an accepted ADR — which is whole-repo context a session scoped to one feature does not have, and a confidently wrong tier is worse than no tier.
Sorting Unranked is the [`backlog-audit`](../.claude/skills/backlog-audit/SKILL.md) skill's job, run deliberately against the whole file.

The tiers group by *why* an item is or isn't actionable rather than by a numeric rank, because that is the part that goes stale and the part a reader needs.
Within a tier, order carries no meaning.

Placements age: a tier is a judgment made on one day about what else was true that day, so treat a stale date as a reason to re-run the audit rather than to trust the order.

_Tiers below last triaged: 2026-10-29._

## Unranked

New items land here.
Empty is the normal state right after an audit, not a sign nothing is being noticed.

## Do next

Unblocked, high value-to-cost, and nothing about it is waiting.

## Ready, unblocked

Well-defined and actionable, but not the next thing you'd reach for.

## Gated on an in-flight milestone

Doing this now would produce something an active redesign or migration discards rather than adapts.

## Needs a decision, not just effort

The work is understood; what it should do is not settled, and code-reading won't settle it.

## Waiting on an external trigger

Nothing to do until something outside the item changes.

## Not sanctioned without explicit authorisation

Sits on an accepted ADR that weighed the work and declined it.

## Reviewed and deliberately not carried forward

Items that were overtaken by other work (struck through with one sentence on what overtook them) or examined and judged not to be work items.
