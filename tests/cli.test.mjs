import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initRepo, installGlobal, statusRepo } from '../bin/claude-toolkit.mjs';

test('initRepo scaffolds a self-contained project that passes both check-doc-links and reflow-docs immediately', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolkit-init-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    const res = initRepo(dir, { worktrees: true, ui: true });
    assert.equal(res.hooksConfigured, true);
    assert.ok(existsSync(path.join(dir, 'CLAUDE.md')));
    assert.ok(existsSync(path.join(dir, 'README.md')));
    assert.ok(existsSync(path.join(dir, 'docs/backlog.md')));
    assert.ok(existsSync(path.join(dir, 'docs/design/mockup-scaffold.html')));
    assert.ok(existsSync(path.join(dir, '.claude/skills/wrap-up/SKILL.md')));
    assert.ok(existsSync(path.join(dir, '.claude/hooks/guard-remote-mutation.mjs')));

    const st = statusRepo(dir);
    assert.equal(st.skillsPresent.length, 7);
    assert.equal(st.hooksPresent.length, 3);
    assert.equal(st.gitHooksPath, 'scripts/git-hooks');

    const linkCheck = spawnSync(process.execPath, ['scripts/check-doc-links.mjs'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(linkCheck.status, 0, `${linkCheck.stdout}${linkCheck.stderr}`);

    const formatCheck = spawnSync(process.execPath, ['scripts/reflow-docs.mjs', '--check'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(formatCheck.status, 0, `${formatCheck.stdout}${formatCheck.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('initRepo with --no-worktrees installs minimal settings and skips worktree hooks', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolkit-minimal-'));
  try {
    initRepo(dir, { worktrees: false });
    const st = statusRepo(dir);
    assert.deepEqual(st.hooksPresent, ['guard-remote-mutation.mjs']);
    assert.equal(st.skillsPresent.length, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installGlobal symlinks skills and hooks into target ~/.claude directory', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolkit-global-'));
  try {
    const res = installGlobal({ target: dir });
    assert.equal(res.linked.length, 10);
    assert.ok(lstatSync(path.join(dir, 'skills/wrap-up')).isSymbolicLink());
    assert.ok(lstatSync(path.join(dir, 'hooks/guard-remote-mutation.mjs')).isSymbolicLink());

    const second = installGlobal({ target: dir, force: false });
    assert.equal(second.skipped.length, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
