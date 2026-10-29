// check-doc-links:ignore-file
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HOOKS = path.resolve(import.meta.dirname, '../scripts/git-hooks');

function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'githooks-'));
  const main = path.join(root, 'repo');
  mkdirSync(main);
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
  };
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 'test@example.com');
  git(main, 'config', 'user.name', 'Test');
  git(main, 'config', 'core.hooksPath', 'hooks');
  for (const dir of [path.join(main, 'hooks')]) mkdirSync(dir, { recursive: true });
  for (const hook of ['pre-commit', 'pre-merge-commit']) {
    const dest = path.join(main, 'hooks', hook);
    copyFileSync(path.join(HOOKS, hook), dest);
    chmodSync(dest, 0o755);
  }
  writeFileSync(path.join(main, 'f.txt'), 'base\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '--no-verify', '-m', 'init');

  const worktree = path.join(root, 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'feature/x', worktree, 'main');
  for (const hook of ['pre-commit', 'pre-merge-commit']) {
    const dir = path.join(worktree, 'hooks');
    mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, hook);
    copyFileSync(path.join(HOOKS, hook), dest);
    chmodSync(dest, 0o755);
  }
  git(main, 'switch', '-q', '--detach');
  return { main, worktree, git };
}

function withRepo(fn) {
  const repo = makeRepo();
  try {
    fn(repo);
  } finally {
    rmSync(path.dirname(repo.main), { recursive: true, force: true });
  }
}

function change(dir, text) {
  writeFileSync(path.join(dir, 'f.txt'), text);
}

test('refuses a commit made in the main checkout', () => {
  withRepo(({ main, git }) => {
    change(main, 'edited by a shell command\n');
    git(main, 'add', '-A');
    const r = git(main, 'commit', '-m', 'from the main checkout');
    assert.equal(r.code, 1);
    assert.match(r.out, /refusing a commit in the main checkout/);
  });
});

test('allows a commit on a branch inside a worktree', () => {
  withRepo(({ worktree, git }) => {
    change(worktree, 'work\n');
    git(worktree, 'add', '-A');
    const r = git(worktree, 'commit', '-m', 'ordinary work');
    assert.equal(r.code, 0, r.out);
  });
});

test('refuses a plain commit, an amend, and a squash-merge commit on main', () => {
  withRepo(({ worktree, git }) => {
    git(worktree, 'switch', '-q', 'main');
    change(worktree, 'straight onto main\n');
    git(worktree, 'add', '-A');
    const plain = git(worktree, 'commit', '-m', 'on main');
    assert.equal(plain.code, 1);
    assert.match(plain.out, /refusing a commit directly on main/);

    const amend = git(worktree, 'commit', '--amend', '--no-edit');
    assert.equal(amend.code, 1);

    git(worktree, 'checkout', '--', '.');
    git(worktree, 'switch', '-q', 'feature/x');
    change(worktree, 'feature work\n');
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', 'feature');
    git(worktree, 'switch', '-q', 'main');
    git(worktree, 'merge', '--squash', 'feature/x');
    const squash = git(worktree, 'commit', '-m', 'squashed');
    assert.equal(squash.code, 1, squash.out);
  });
});

test('allows a clean merge onto main from inside a worktree', () => {
  withRepo(({ worktree, git }) => {
    change(worktree, 'feature work\n');
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', 'feature');
    git(worktree, 'switch', '-q', 'main');
    const r = git(worktree, 'merge', '--no-ff', 'feature/x', '-m', 'Merge feature/x');
    assert.equal(r.code, 0, r.out);
  });
});

test('allows the commit that concludes a conflicted merge', () => {
  withRepo(({ worktree, git }) => {
    change(worktree, 'from the branch\n');
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', 'branch side');
    git(worktree, 'switch', '-q', 'main');
    change(worktree, 'from main\n');
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '--no-verify', '-m', 'main side');
    const merge = git(worktree, 'merge', '--no-ff', 'feature/x', '-m', 'Merge feature/x');
    assert.notEqual(merge.code, 0, 'expected a conflicted merge');
    change(worktree, 'resolved\n');
    git(worktree, 'add', '-A');
    const concluded = git(worktree, 'commit', '--no-edit');
    assert.equal(concluded.code, 0, concluded.out);
  });
});

test('refuses a merge made in the main checkout', () => {
  withRepo(({ main, worktree, git }) => {
    change(worktree, 'feature work\n');
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', 'feature');
    git(worktree, 'switch', '-q', '--detach');
    git(main, 'switch', '-q', 'main');
    const r = git(main, 'merge', '--no-ff', 'feature/x', '-m', 'Merge feature/x');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /refusing a merge in the main checkout/);
  });
});

const CLICK_TARGET = '.claude/skills/browser-driver/click-target.mjs';
const CLICK_TEST = '.claude/skills/browser-driver/click-target.test.mjs';

function commitWithDriverCheck(worktree, git, staged, checkPasses) {
  const stubs = path.join(worktree, '..', 'stubs');
  mkdirSync(stubs, { recursive: true });
  writeFileSync(path.join(stubs, 'ldconfig'), '#!/bin/sh\necho "libasound.so.2 (libc6,x86-64) => /usr/lib/libasound.so.2"\n');
  chmodSync(path.join(stubs, 'ldconfig'), 0o755);
  const script = `require('fs').writeFileSync('driver-check-ran', ''); process.exit(${checkPasses ? 0 : 1})`;
  writeFileSync(
    path.join(worktree, 'package.json'),
    JSON.stringify({ scripts: { 'check:browser-driver': `node -e "${script}"` } }),
  );
  for (const file of staged) {
    mkdirSync(path.dirname(path.join(worktree, file)), { recursive: true });
    writeFileSync(path.join(worktree, file), '// changed\n');
  }
  git(worktree, 'add', '-A');
  const r = spawnSync('git', ['commit', '-m', 'work'], {
    cwd: worktree,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${stubs}${path.delimiter}${process.env.PATH}` },
  });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}`, ran: existsSync(path.join(worktree, 'driver-check-ran')) };
}

test('refuses a commit staging a click-resolution file when the driver check fails', () => {
  for (const file of [CLICK_TARGET, CLICK_TEST]) {
    withRepo(({ worktree, git }) => {
      const r = commitWithDriverCheck(worktree, git, [file], false);
      assert.equal(r.code, 1, r.out);
      assert.ok(r.ran, 'the driver check should have run');
      assert.match(r.out, /refusing a commit that changes browser-driver click resolution/);
    });
  }
});

test('allows a commit staging a click-resolution file when the driver check passes', () => {
  withRepo(({ worktree, git }) => {
    const r = commitWithDriverCheck(worktree, git, [CLICK_TARGET], true);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.ran, 'the driver check should have run');
  });
});

test('does not run the driver check for a commit that stages neither file', () => {
  withRepo(({ worktree, git }) => {
    const r = commitWithDriverCheck(worktree, git, ['.claude/skills/browser-driver/driver.mjs'], false);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.ran, false);
  });
});
