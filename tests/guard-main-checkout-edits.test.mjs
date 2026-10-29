import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../.claude/hooks/guard-main-checkout-edits.mjs';

const MAIN = '/home/u/projects/app';
const WORKTREE = `${MAIN}/.claude/worktrees/some-slice`;

const inMainCheckout = () => ({ toplevel: MAIN, commonDir: `${MAIN}/.git` });
const inWorktree = () => ({ toplevel: WORKTREE, commonDir: `${MAIN}/.git` });
const noRepo = () => null;

test('refuses an edit in the main checkout', () => {
  assert.match(decide(`${MAIN}/README.md`, inMainCheckout), /main checkout/);
  assert.match(decide(`${MAIN}/src/server.ts`, inMainCheckout), /EnterWorktree/);
});

test('allows an edit inside a worktree, including one under .claude/', () => {
  assert.equal(decide(`${WORKTREE}/README.md`, inWorktree), null);
  assert.equal(decide(`${WORKTREE}/.claude/settings.json`, inWorktree), null);
});

test('allows paths outside any repository — scratchpad, memory, /tmp', () => {
  assert.equal(decide('/tmp/claude-1000/scratch/notes.md', noRepo), null);
  assert.equal(decide('/home/u/.claude/projects/x/memory/thing.md', noRepo), null);
});

test('fails open rather than wedging every edit', () => {
  assert.equal(decide('', inMainCheckout), null);
  assert.equal(decide(undefined, inMainCheckout), null);
  assert.equal(decide(`${MAIN}/README.md`, () => ({ toplevel: '', commonDir: '' })), null);
  assert.equal(
    decide(`${MAIN}/README.md`, () => {
      throw new Error('git missing');
    }),
    null,
  );
});

test('a trailing slash or a relative segment does not smuggle an edit past it', () => {
  assert.match(decide(`${MAIN}/docs/../README.md`, inMainCheckout), /main checkout/);
  assert.match(decide(`${MAIN}//README.md`, inMainCheckout), /main checkout/);
});
