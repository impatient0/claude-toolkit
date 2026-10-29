// check-doc-links:ignore-file
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/check-doc-links.mjs');

function check(files, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'doclinks-'));
  try {
    for (const [rel, contents] of Object.entries(files)) {
      const full = path.join(root, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    if (options.git) {
      const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      git('add', '-A');
      git('commit', '-qm', 'fixture');
      if (options.blameIgnoreHead) {
        const head = git('rev-parse', 'HEAD').stdout.trim();
        writeFileSync(path.join(root, '.git-blame-ignore-revs'), `# reflow\n${head}\n`);
      }
    }
    const run = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
    return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function baseline() {
  return {
    'README.md': '# R\n\n- [ADR 1](docs/adr/0001-x.md)\n- [ADR 1 § Context](docs/adr/0001-x.md#context)\n',
    'CLAUDE.md': '# C\n',
    'docs/adr/0001-x.md': '# 1. X\n\n## Context\n\nBody.\n',
  };
}

test('the baseline corpus passes, so later failures are attributable', () => {
  const { ok, output } = check(baseline());
  assert.equal(ok, true, output);
});

test('rule 1: a relative link to a missing file fails', () => {
  const { ok, output } = check({
    ...baseline(),
    'README.md': '# R\n\n[gone](docs/adr/9999-nope.md)\n',
  });
  assert.equal(ok, false);
  assert.match(output, /broken relative link -> docs\/adr\/9999-nope\.md/);
});

test('rule 1: a #fragment naming no heading fails even though the file resolves', () => {
  const { ok, output } = check({
    ...baseline(),
    'README.md': '# R\n\n[bad anchor](docs/adr/0001-x.md#no-such-section)\n',
  });
  assert.equal(ok, false);
  assert.match(output, /has no heading "#no-such-section"/);
});

test('rule 1: heading slugs match GitHub, which does not collapse runs of spaces', () => {
  const corpus = (anchor) => ({
    ...baseline(),
    'README.md': `# R\n\n[to a slice](docs/adr/0001-x.md#${anchor})\n`,
    'docs/adr/0001-x.md': '# 1. X\n\n## Slice 5 — data layer\n\nBody.\n',
  });
  assert.equal(check(corpus('slice-5--data-layer')).ok, true);
  assert.equal(check(corpus('slice-5-data-layer')).ok, false);
});

test('rule 2: [[wiki]], glob paths, and bare backticked doc paths fail', () => {
  assert.equal(
    check({ ...baseline(), 'docs/adr/0001-x.md': '# 1. X\n\n## Context\n\nSee [[0001-x]].\n' }).ok,
    false,
  );
  assert.equal(
    check({ ...baseline(), 'docs/adr/0001-x.md': '# 1. X\n\n## Context\n\nSee `docs/adr/0001-*.md`.\n' }).ok,
    false,
  );
  assert.equal(
    check({ ...baseline(), 'docs/adr/0001-x.md': '# 1. X\n\n## Context\n\nSee `docs/adr/0001-x.md`.\n' }).ok,
    false,
  );
});

test('rule 3: a doc under docs/ that nothing links to fails', () => {
  const { ok, output } = check({
    ...baseline(),
    'docs/adr/0002-orphan.md': '# 2. Orphan\n\nNobody links here.\n',
  });
  assert.equal(ok, false);
  assert.match(output, /0002-orphan\.md: unreachable/);
});

test('rule 4: a cited repo path must exist unless struck through', () => {
  assert.equal(
    check({ ...baseline(), 'docs/adr/0001-x.md': '# 1. X\n\n## Context\n\nIn `src/nowhere.ts`.\n' }).ok,
    false,
  );
  assert.equal(
    check({ ...baseline(), 'docs/adr/0001-x.md': '# 1. X\n\n## Context\n\nIn ~~`src/nowhere.ts`~~.\n' }).ok,
    true,
  );
});

test('rule 6: code comments citing docs are verified across languages', () => {
  const pyFail = check({
    ...baseline(),
    'app/main.py': '# See docs/adr/9999-nope.md\nx = 1\n',
  });
  assert.equal(pyFail.ok, false);
  assert.match(pyFail.output, /app\/main\.py:1 cites docs\/adr\/9999-nope\.md/);
});

test('supports .doclinksrc.json overrides for custom project layouts', () => {
  const custom = check({
    ...baseline(),
    '.doclinksrc.json': JSON.stringify({ repoPathPrefixes: ['crates'], codeRoots: ['crates'] }),
    'docs/adr/0001-x.md': '# 1. X\n\n## Context\n\nSee `crates/core/lib.rs`.\n',
  });
  assert.equal(custom.ok, false);
  assert.match(custom.output, /cites `crates\/core\/lib\.rs`, which does not exist/);
});
