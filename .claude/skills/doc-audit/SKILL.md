---
name: doc-audit
description: Review this project's documentation (README.md, CLAUDE.md, docs/adr/, docs/design/, .claude/skills/) for redundancy, staleness, and archaeology, and fix what's genuinely wrong. Use when the user asks to audit, clean up, or reduce documentation, or says the docs feel bloated, repetitive, or out of date. Not for a single doc's typo fix. Not run automatically or on a schedule — invoked by judgment, when the docs actually feel like they've drifted, typically after a chunk of related feature work has landed.
---

Works best cold, with no assumed session history — read only the repo as it stands.
That's not a limitation to work around; it's the actual test of whether the docs are self-sufficient, which is the property this whole exercise exists to protect.
Don't reach for prior conversation context about "why this doc says what it says" — if that reasoning matters, it should be recoverable from the doc, the commit that wrote it, or the code, not from memory.

## 1. Inventory, in tokens and in sections — not just files

Measure before opening anything.
Where the effort goes is a measurement, not a hunch:

```bash
# What the corpus costs to read, by file.
find . -name "*.md" -not -path "./node_modules/*" -not -path "./.git/*" \
  | xargs wc -c | sort -rn | awk '{printf "%8d chars ~%6d tok  %s\n", $1, $1/4, $2}'

# For the two or three largest: where the mass actually sits inside them.
awk '/^#{2,3} /{if(h)printf "%4d  %s\n", len, h; h=$0; len=0; next}{len++}END{printf "%4d  %s\n", len, h}' <file>
```

Line counts alone are the wrong unit, because the cost this audit exists to control is what a *reader* loads.
Two files at 30% of the corpus is a finding before you've opened either.
This is why the size budgets in `scripts/check-doc-links.mjs` are denominated in bytes: reflowing a corpus to one sentence per line moves line counts by 26–38% and byte counts by under 1%, so only bytes track content rather than formatting.

The per-section breakdown is the part that pays: a single `## Consequences` section holding hundreds of lines of append-only slice logs is invisible from a file-level count.

Then read them all in full.
Length alone still isn't a finding — a long ADR can be entirely load-bearing — but now you know where to look hard.

## 1b. Is this one document, or two wearing one name?

Before judging any long file as bloated, ask what *kind* of content each section is, and whether one kind grows on a different clock from the rest:

- Does one section grow **monotonically with time** — a slice log, a changelog, a list of incidents — while the rest is stable prose that gets *edited* rather than appended to?
- Would a reader arriving for section A have any use for section B?

Two yeses means it's two documents, and no amount of tightening the prose fixes it — a reader loads whole files, so precise cross-references don't help either.
Split it, give the growing half its own home that is *allowed* to grow (`docs/implementation-notes/`), and point the references at anchors in the new file.

## 2. Cross-reference, don't trust a doc's claim about itself

For every fact stated as settled ("this supersedes X," "duplicated in two places," "see ADR N for the fix"), verify it against the actual repo instead of taking the doc's word for it:

- `grep` for the constant, filename, or convention the doc names.
  A doc claiming "duplicated between A and B" should be checked against A and B directly — the duplication may have grown to three places, or shrunk to zero, since that sentence was written.
- Check that anything a doc says was deleted is actually gone (`git log --diff-filter=D --name-only | grep <name>`), and that nothing still points at it.
- If a doc claims another file was "updated in the same commit," check that commit's diff.
  Claims like this drift the moment only half the change actually lands.
- For anything describing running code or a live component, read the actual source, not just the doc describing it.

## 3. Redundancy has two different shapes — treat them differently

**Duplicated text** (the same fact stated twice in different files or sections) is worth cutting only when it's pure repetition with no new information in the second copy — point the second occurrence at the first rather than deleting context outright.

**Duplicated knowledge** is the sharper problem: a value or fact that has one true source but is described, or worse, *implemented*, in more than one place, so the copies can silently drift out of sync.
If an audit finds this in code (not just docs), see [`CLAUDE.md`'s Core Principles](../../../CLAUDE.md#core-principles) ("Duplicate code freely; never duplicate knowledge") — the fix belongs in the code, not just in the prose describing it.
A doc that carefully explains a duplication is not a substitute for removing the duplication.

**How to actually find it**, rather than noticing it by luck: take any rule that reads as load-bearing, pick its most distinctive phrase or identifier, and count where it appears.

For a **single identifier** — a constant, a filename, a class name — plain grep is enough, because a token never wraps:

```bash
grep -rln "SOME_IDENTIFIER" README.md CLAUDE.md docs .claude --include=*.md
```

For a **multi-word phrase**, one sentence per line means a phrase inside a sentence sits on one line, but a phrase spanning a sentence boundary can still wrap across lines.
Match against the whole file instead, recovering the line number from the match offset:

```bash
mdgrep() {  # usage: mdgrep 'a perl regex, / and . unescaped'
  find README.md CLAUDE.md docs .claude -name '*.md' -print0 \
  | xargs -0 perl -0777 -ne 'while (/'"$1"'/gs) {
      my ($m, $s) = ($&, $-[0]);
      my $n = () = substr($_, 0, $s) =~ /\n/g;
      $m =~ s/\s+/ /g;
      print "$ARGV:".($n+1).": $m\n" }'
}
```

More than two hits is a prompt to look, not a verdict.
Read each hit in context and sort it: a passing mention of a cost or a tracked gap in [`docs/backlog.md`](../../../docs/backlog.md) is legitimate overlap.
What you're hunting is a second full statement of a rule that a reader could follow *instead of* the first, and that nothing keeps in sync with it.

The same sweep finds retold anecdotes.
One incident explained at length in four places costs ~8 lines each time; it belongs in the one doc where it justifies a rule, cited from the rest.

## 3b. Run the mechanical checks — then check the checker

```bash
node scripts/check-doc-links.mjs
```

Green here means the link graph resolves, every doc under `docs/` is reachable, no banned reference form is in use, and no ADR or epic index is over budget.
That is the part you don't need to audit by hand.

**Then distrust it.** A guard nobody exercises rots exactly like a doc does.
Confirm the project's test suite for `scripts/check-doc-links.mjs` still covers every rule the script enforces, or build a throwaway corpus in `/tmp` that violates each rule deliberately and confirm each rule fires.

## 3c. Reference hygiene

This setup settles on **one form: relative Markdown links**, with section anchors checked.
`[[wiki]]` refs, glob paths and doc paths in backticks are all banned mechanically by `scripts/check-doc-links.mjs`.

The real work here is watching for unlinked prose references:

- "see the design spec" or "see that ADR's own note" with no link at all;
- a reference to a section by title rather than by anchor.

Use `mdgrep` from step 3 to locate them:

```bash
mdgrep "[Ss]ee (?:the |that )?[a-z ]*(?:spec|ADR|README)(?:.s)?[^.]{0,40}"
```

The sorting rule is **whether the thing named can rot**.
"See ADR 0001" needs no link: an ADR number is a stable identifier, assigned once and never reused.
"The design spec's Tabs entry" is fragile, because a section title is prose and changes without ceremony.
Convert the second kind; leave the first alone.

## 4. Categorize before touching anything

For each candidate, decide which bucket it's actually in — don't default to cutting:

- **Genuine redundancy** — the same fact, no new information, safe to collapse to a pointer.
- **Staleness** — no longer true, contradicts the code or another doc.
- **Archaeology** — accurate, but about something that no longer exists and wouldn't change any future decision (a deleted scaffold, a one-off session note, "how a past slice happened to be done" rather than a reusable constraint).
- **Load-bearing depth** — long, but every sentence is doing real work (a rejected-alternatives list, a non-obvious tradeoff).
  Leave these alone even if they're the longest thing in the file.
  The goal is "monitor and remove redundancy," not "compress at all costs" — say so plainly if a file turns out to have nothing worth cutting.

## 5. Fix, then verify against the running thing, not just the diff

A doc fix isn't done because the new prose reads correctly.
Run the project's test and doc verification gate (`npm test`, or `node scripts/check-doc-links.mjs && node scripts/reflow-docs.mjs --check`), and for anything UI-visible, run a real browser pass via [`browser-driver`](../browser-driver/SKILL.md).

## 6. If a finding is the kind that could recur, don't just fix it once

If a fix here is the second or third time the same class of drift has been caught by an audit rather than caught automatically, that's [`CLAUDE.md`'s Core Principles](../../../CLAUDE.md#core-principles) ("Guard over re-audit") firing — build a CI check or a test instead of relying on the next audit to catch it again.

**Spend the audit's judgement on what a machine can't check.** These classes are already guarded by `scripts/check-doc-links.mjs` and `scripts/reflow-docs.mjs`:

| Guarded | By |
|---|---|
| Broken relative links, and bad section anchors | `check-doc-links` rule 1 |
| `[[wiki]]` refs, glob paths, and a `docs/…md` path in backticks instead of a link | `check-doc-links` rule 2 |
| A doc under `docs/` nothing links to | `check-doc-links` rule 3 |
| A doc citing a repo path that no longer exists (unless struck through) | `check-doc-links` rule 4 |
| Artifact links load-bearing in prose | `check-doc-links` rule 5 |
| A code comment citing a `docs/…md` path or anchor that doesn't resolve, or a glob path | `check-doc-links` rule 6 |
| An ADR over 24,000 bytes, an epic index over 8,000 | `check-doc-links` size budgets |
| A dangling SHA in `.git-blame-ignore-revs` | `check-doc-links` |
| An epic index with no stated deletion condition | `check-doc-links` epic guard |
| A doc not written one sentence per line | `reflow-docs --check` |

What is left needs a reader: whether a claim is still *true* of the code (step 2), whether a long section is dense or bloated (step 4), whether two statements of a rule are one restatement or two audiences (step 3), and whether a file has quietly become two documents (step 1b).

## 7. Report, don't silently rewrite

Findings that are genuinely a judgment call (is this ADR long because it's dense, or because it's bloated?) go to the user before editing, not after — same as any other ambiguous scope call.
Findings that are unambiguous (a provably dead cross-reference, a fact contradicted by the code) can be fixed directly, but say what was found and why in the commit message, not just in the diff.
