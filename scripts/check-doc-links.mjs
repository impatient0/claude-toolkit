#!/usr/bin/env node
// Fails if the documentation's internal link graph is broken, or if a committed
// doc leans on something that isn't committed.
//
// Six rules, all cheap:
//   1. Every relative Markdown link resolves to a file that exists — and, if it
//      carries a #fragment, to a heading that exists in that file.
//   2. Cross-references use relative Markdown links and nothing else. [[wiki-style]]
//      refs, glob paths like `docs/adr/0001-*.md`, and bare backticked doc paths like  check-doc-links:ignore
//      `docs/backlog.md` (unless struck through: ~~`docs/gone.md`~~) are banned.       check-doc-links:ignore
//   3. Every doc under docs/ is reachable by following links from an entry point
//      a cold session actually starts from (README.md, CLAUDE.md, a SKILL.md, or
//      a rule under .claude/rules/).
//   4. Every backticked path into the repo (`src/…`, `public/…`, `scripts/…`, etc.)
//      names a file that exists — or, when deliberately removed, is struck through:
//      ~~`scripts/gone.mjs`~~.
//   5. Published-Artifact links (claude.ai/code/artifact/...) appear only under a
//      trailing "References"/"Visual record" heading.
//   6. Code comments cite docs the same way docs do: a `docs/…md` path resolves,
//      a #fragment names a real heading, and glob paths are banned here too.
//
// Plus two byte-denominated size budgets:
//   - Epic indexes (`docs/epics/*.md`): max 8,000 bytes, and must state their own
//     deletion condition ("delete this file...").
//   - ADRs (`docs/adr/*.md`): max 24,000 bytes (chronological slice logs belong in
//     `docs/implementation-notes/`).
//
// Optional configuration via `.doclinksrc.json` at the repo root:
//   {
//     "docRoots": ["README.md", "CLAUDE.md", "docs", ".claude/skills", ".claude/rules"],
//     "codeRoots": ["src", "lib", "app", "public", "scripts", "tests", "bin"],
//     "repoPathPrefixes": ["src", "lib", "app", "public", "scripts", "tests", "db", "bin", "templates", ".github"],
//     "adrMaxBytes": 24000,
//     "epicMaxBytes": 8000
//   }
//
// Usage: node scripts/check-doc-links.mjs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DEFAULTS = {
  docRoots: ['README.md', 'CLAUDE.md', 'docs', '.claude/skills', '.claude/rules'],
  codeRoots: ['src', 'lib', 'app', 'pkg', 'cmd', 'internal', 'public', 'scripts', 'tests', 'test', 'bin'],
  repoPathPrefixes: [
    'src',
    'lib',
    'app',
    'pkg',
    'cmd',
    'internal',
    'public',
    'scripts',
    'tests',
    'test',
    'db',
    'bin',
    'templates',
    '.github',
  ],
  epicMaxBytes: 8_000,
  adrMaxBytes: 24_000,
};

function loadConfig() {
  if (!existsSync('.doclinksrc.json')) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync('.doclinksrc.json', 'utf8'));
    return {
      docRoots: Array.isArray(raw.docRoots) ? raw.docRoots : DEFAULTS.docRoots,
      codeRoots: Array.isArray(raw.codeRoots) ? raw.codeRoots : DEFAULTS.codeRoots,
      repoPathPrefixes: Array.isArray(raw.repoPathPrefixes) ? raw.repoPathPrefixes : DEFAULTS.repoPathPrefixes,
      epicMaxBytes: typeof raw.epicMaxBytes === 'number' ? raw.epicMaxBytes : DEFAULTS.epicMaxBytes,
      adrMaxBytes: typeof raw.adrMaxBytes === 'number' ? raw.adrMaxBytes : DEFAULTS.adrMaxBytes,
    };
  } catch {
    return DEFAULTS;
  }
}

const CFG = loadConfig();
const DOC_ROOTS = CFG.docRoots;

const isEntryPoint = (f) =>
  f === 'README.md' ||
  f === 'CLAUDE.md' ||
  f.endsWith('SKILL.md') ||
  f.startsWith(`.claude${path.sep}rules${path.sep}`);

const inReachabilityScope = (f) => f.startsWith(`docs${path.sep}`);
const EXTERNAL_OK_HEADINGS = /^#{1,6}\s+(references|visual record|links)\b/i;
const BARE_DOC_PATH = /`(?:docs|\.claude)\/[\w./-]+\.md(?:#[\w-]+)?`/g;

const escapedPrefixes = CFG.repoPathPrefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const REPO_PATH = new RegExp(`\`((?:${escapedPrefixes})\\/[\\w./-]+)\``, 'g');

const STRUCK = (line, start, end) =>
  line.slice(Math.max(0, start - 2), start) === '~~' && line.slice(end, end + 2) === '~~';

const EPIC_MAX_BYTES = CFG.epicMaxBytes;
const ADR_MAX_BYTES = CFG.adrMaxBytes;

const failures = [];

function walk(target, out = [], keep = (f) => f.endsWith('.md')) {
  if (!existsSync(target)) return out;
  if (statSync(target).isFile()) {
    if (keep(target)) out.push(target);
    return out;
  }
  for (const entry of readdirSync(target)) walk(path.join(target, entry), out, keep);
  return out;
}

const CODE_ROOTS = CFG.codeRoots;
const isCodeFile = (f) =>
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|sql|css|sh)$/.test(f) && !f.includes(`public${path.sep}vendor`);
const DOC_CITATION = /docs\/[\w.*/-]*\.md(#[\w-]+)?/g;
const IGNORE_MARKER = 'check-doc-links:ignore';
const IGNORE_FILE_MARKER = 'check-doc-links:ignore-file';

function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}

const slugCache = new Map();
function slugsFor(file) {
  if (!slugCache.has(file)) {
    const slugs = new Set();
    let inFence = false;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence) continue;
      const m = /^#{1,6}\s+(.*)$/.exec(line);
      if (m) slugs.add(slugify(m[1]));
    }
    slugCache.set(file, slugs);
  }
  return slugCache.get(file);
}

const docs = DOC_ROOTS.flatMap((root) => walk(root));
const linksOut = new Map(docs.map((f) => [f, new Set()]));

for (const file of docs) {
  const source = readFileSync(file, 'utf8');
  if (source.includes(IGNORE_FILE_MARKER)) continue;
  const lines = source.split('\n');
  const dir = path.dirname(file);

  let inReferences = false;
  let inFence = false;

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    if (/^\s*```/.test(rawLine)) inFence = !inFence;
    if (inFence) return;
    if (rawLine.includes(IGNORE_MARKER)) return;
    if (/^#{1,6}\s/.test(rawLine)) inReferences = EXTERNAL_OK_HEADINGS.test(rawLine);

    const line = rawLine.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));

    // Rule 1 — relative markdown links resolve, fragment included.
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = m[1].trim();
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [rawPath, fragment] = href.split('#');
      const target = rawPath ? path.resolve(dir, rawPath) : path.resolve(file);
      if (!existsSync(target)) {
        failures.push(`${file}:${lineNo} broken relative link -> ${href}`);
        continue;
      }
      const rel = path.relative('.', target);
      const isMarkdownFile = statSync(target).isFile() && rel.endsWith('.md');
      if (rawPath && isMarkdownFile && linksOut.has(file)) linksOut.get(file).add(rel);
      if (fragment && isMarkdownFile && !slugsFor(rel).has(fragment)) {
        failures.push(
          `${file}:${lineNo} link -> ${href} resolves, but ${rel} has no heading "#${fragment}"`,
        );
      }
    }

    // Rule 2 — one reference form.
    for (const m of line.matchAll(/\[\[([^\]]+)\]\]/g)) {
      failures.push(
        `${file}:${lineNo} [[${m[1].trim()}]] is a wiki-style reference — it renders as ` +
          'literal text on GitHub and resolves in no editor. Use a relative Markdown ' +
          'link, e.g. [ADR 0001](0001-record-architecture-decisions.md).',
      );
    }
    for (const m of rawLine.matchAll(/docs\/[\w-]+\/[\w-]*\*[\w-]*\.md/g)) {
      failures.push(
        `${file}:${lineNo} "${m[0]}" is a glob path — nothing resolves it, so nothing ` +
          'checks it. Use the full relative Markdown link instead.',
      );
    }

    for (const m of rawLine.matchAll(BARE_DOC_PATH)) {
      const [start, end] = [m.index, m.index + m[0].length];
      const isLinkText = rawLine[start - 1] === '[' && rawLine.slice(end, end + 2) === '](';
      if (isLinkText || STRUCK(rawLine, start, end)) continue;
      failures.push(
        `${file}:${lineNo} ${m[0]} is a doc path in backticks, not a link — nothing ` +
          'checks it, and a rename breaks it silently. Use a relative Markdown link, ' +
          'with a #fragment if it names a section.',
      );
    }

    // Rule 4 — a cited repo path exists, or the citation is struck through.
    for (const m of rawLine.matchAll(REPO_PATH)) {
      const cited = m[1].replace(/[.,;:]$/, '');
      if (existsSync(cited) || STRUCK(rawLine, m.index, m.index + m[0].length)) continue;
      failures.push(
        `${file}:${lineNo} cites \`${cited}\`, which does not exist. Fix the path, or — ` +
          `if the file was deliberately removed — strike the citation through (~~\`${cited}\`~~) ` +
          "so a reader isn't sent looking for it.",
      );
    }

    // Rule 5 — artifact links stay out of load-bearing prose.
    if (!inReferences && /claude\.ai\/code\/artifact\//.test(line)) {
      failures.push(
        `${file}:${lineNo} Artifact link outside a References/Visual record section — ` +
          'move it there, and make sure whatever it settled is written as prose in a ' +
          'committed doc rather than living only in the mockup',
      );
    }
  });
}

// Rule 6 — a doc citation in code resolves, exactly as one in a doc does.
for (const file of CODE_ROOTS.flatMap((root) => walk(root, [], isCodeFile))) {
  const source = readFileSync(file, 'utf8');
  if (source.includes(IGNORE_FILE_MARKER)) continue;
  source.split('\n').forEach((line, i) => {
    if (line.includes(IGNORE_MARKER)) return;
    for (const m of line.matchAll(DOC_CITATION)) {
      const [cited, fragment] = [m[0], m[1]];
      const target = fragment ? cited.slice(0, -fragment.length) : cited;
      if (target.includes('*')) {
        failures.push(
          `${file}:${i + 1} "${target}" is a glob path — nothing resolves it, so nothing ` +
            'checks it. Use the full path, e.g. docs/adr/0001-record-architecture-decisions.md.',
        );
        continue;
      }
      if (!existsSync(target)) {
        failures.push(
          `${file}:${i + 1} cites ${target}, which does not exist. A comment is where a ` +
            'reader is most likely to follow a reference — fix the path or drop it.',
        );
        continue;
      }
      if (fragment && !slugsFor(target).has(fragment.slice(1))) {
        failures.push(
          `${file}:${i + 1} cites ${cited}, but ${target} has no heading "${fragment}".`,
        );
      }
    }
  });
}

// Rule 3 — every doc under docs/ is reachable from somewhere a cold session starts.
const reached = new Set(docs.filter(isEntryPoint));
const queue = [...reached];
while (queue.length > 0) {
  for (const next of linksOut.get(queue.pop()) ?? []) {
    if (!reached.has(next)) {
      reached.add(next);
      queue.push(next);
    }
  }
}
for (const file of docs) {
  if (!inReachabilityScope(file) || reached.has(file)) continue;
  failures.push(
    `${file}: unreachable — no chain of links from README.md, CLAUDE.md or a skill ` +
      'reaches it, so a cold session can only find it by already knowing the path. ' +
      'Link it from whichever doc a reader would be holding when they need it.',
  );
}

function overBudget(file, max, what, fix) {
  const bytes = Buffer.byteLength(readFileSync(file));
  if (bytes > max) {
    failures.push(
      `${file}: ${bytes} bytes (~${Math.round(bytes / 4)} tokens) exceeds the ${max}-byte ` +
        `budget for ${what} — ${fix}`,
    );
  }
}

for (const file of docs.filter((f) => f.includes(`docs${path.sep}epics${path.sep}`))) {
  overBudget(
    file,
    EPIC_MAX_BYTES,
    'an epic index',
    'it should hold status and links, not reasoning. Move the prose into an ADR.',
  );
  if (!/delete this file/i.test(readFileSync(file, 'utf8'))) {
    failures.push(
      `${file}: an epic index must state the condition under which it gets deleted, ` +
        "so it can't outlive the work it tracks.",
    );
  }
}

if (existsSync('.git-blame-ignore-revs')) {
  const revs = readFileSync('.git-blame-ignore-revs', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const git = spawnSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' });
  if (git.status === 0) {
    for (const rev of revs) {
      const found = spawnSync('git', ['cat-file', '-e', `${rev}^{commit}`]);
      if (found.status !== 0) {
        failures.push(
          `.git-blame-ignore-revs: ${rev} is not a commit in this repository — ` +
            'a rebase or amend orphaned it, and blame.ignoreRevsFile is now silently ' +
            'ignoring nothing. Replace it with the rewritten commit, or drop the line.',
        );
      }
    }
  }
}

for (const file of docs.filter((f) => f.startsWith(`docs${path.sep}adr${path.sep}`))) {
  overBudget(
    file,
    ADR_MAX_BYTES,
    'an ADR',
    'per-slice implementation notes belong in docs/implementation-notes/, which is ' +
      'allowed to grow. An ADR that has become a changelog costs every reader sent ' +
      'there for one section.',
  );
}

if (failures.length > 0) {
  console.error('check-doc-links: the documentation link graph has gaps:\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error(`\n${failures.length} problem(s).`);
  process.exit(1);
}

console.log(`check-doc-links: ${docs.length} docs, all internal links resolve. OK.`);
