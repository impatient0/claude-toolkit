import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initRepo, installGlobal, statusRepo, mergeSettings, detachMainCheckout } from '../bin/claude-toolkit.mjs';

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

test('initRepo merges into an existing .claude/settings.json without clobbering user permissions or custom hooks', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolkit-merge-'));
  try {
    mkdirSync(path.join(dir, '.claude'), { recursive: true });
    const existing = {
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo custom-bash-hook' }],
          },
        ],
      },
    };
    writeFileSync(path.join(dir, '.claude/settings.json'), JSON.stringify(existing, null, 2));

    const res = initRepo(dir, { worktrees: true, force: false });
    assert.equal(res.merged.length, 1);

    const after = JSON.parse(readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
    assert.deepEqual(after.permissions, { allow: ['Bash(npm test)'] });
    const bashGroup = after.hooks.PreToolUse.find((g) => g.matcher === 'Bash');
    assert.equal(bashGroup.hooks.length, 3);
    assert.equal(bashGroup.hooks[0].command, 'echo custom-bash-hook');

    // Re-running mergeSettings is idempotent (no duplicate hook entries).
    const twice = mergeSettings(after, after);
    assert.equal(twice.hooks.PreToolUse.find((g) => g.matcher === 'Bash').hooks.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detachMainCheckout detaches a clean repo on main and warns without failing when dirty', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolkit-detach-'));
  try {
    const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(path.join(dir, 'README.md'), '# App\n');
    git('add', '-A');
    git('commit', '-qm', 'init');

    // Dirty tree: initRepo copies files, so working tree is dirty right after initRepo;
    // detachMainCheckout should report 'dirty' and leave branch on 'main'.
    const initRes = initRepo(dir, { worktrees: true });
    assert.equal(initRes.worktreeHead.status, 'dirty');
    assert.equal(git('symbolic-ref', '--short', '-q', 'HEAD').stdout.trim(), 'main');

    // Once committed and clean, detachMainCheckout parks HEAD detached at main.
    git('add', '-A');
    git('commit', '--no-verify', '-qm', 'chore: add claude-toolkit');
    const det = detachMainCheckout(dir, { reanchorToMain: true });
    assert.equal(det.detached, true);
    assert.equal(det.status, 'detached');
    assert.equal(det.previousBranch, 'main');
    assert.notEqual(git('symbolic-ref', '--short', '-q', 'HEAD').status, 0);
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
