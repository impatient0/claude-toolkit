---
paths:
  - "public/**"
  - "src/ui/**"
  - "docs/design/**"
---

# The UI change gate: mockup first

**For any meaningful UI change** (a new component, a new page, a redesigned existing one — not a copy tweak or a one-line style fix): mock it first as a standalone HTML Artifact, built with real content in both themes and the states that actually matter (empty, error, locked/disabled, etc.), and get it explicitly approved before writing implementation code.
Iterate on the mockup itself — cheap to change — not on the shipped page.
Once approved, implement to match it, then verify the actual rendered result in a real browser before calling the slice done (see [`browser-driver`'s Verifying a UI change section](../skills/browser-driver/SKILL.md#verifying-a-ui-change) and [`CLAUDE.md`'s Testing Discipline](../../CLAUDE.md#testing-discipline) — this adds an approval gate *before* implementation even starts, on top of that).
Mockup → iterate → approve → implement → verify, in that order, every time.
When authoring a mockup from a scaffold, copy the app's real CSS tokens and rules out of the live stylesheet at authoring time rather than reconstructing them from memory.
