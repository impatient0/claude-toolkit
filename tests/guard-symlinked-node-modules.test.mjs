import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../.claude/hooks/guard-symlinked-node-modules.mjs';

const MAIN = '/home/u/projects/app';
const WORKTREE = `${MAIN}/.claude/worktrees/some-slice`;
const OTHER = `${MAIN}/.claude/worktrees/other-slice`;

const linked = () => `${MAIN}/node_modules`;
const real = () => null;
const linkedOnlyInOther = (dir) => (dir === OTHER ? `${MAIN}/node_modules` : null);

const DENY = [
  ['npm ci', 'npm ci'],
  ['npm install', 'npm install'],
  ['npm i', 'npm i'],
  ['npm add a package', 'npm add left-pad'],
  ['npm install with flags', 'npm install --omit=dev --no-audit'],
  ['npm clean-install', 'npm clean-install'],
  ['npm ic', 'npm ic'],
  ['npm cit', 'npm cit'],
  ['npm install-ci-test', 'npm install-ci-test'],
  ['a flag before the verb', 'npm --silent ci'],
  ['an option value before the verb', 'npm --registry https://registry.npmjs.org ci'],
  ['output redirected', 'npm ci > /tmp/ci.log 2>&1; echo exit=$?'],
  ['after another command', 'git status && npm ci'],
  ['behind an environment assignment', 'CI=true npm ci'],
  ['a full path to npm', './node_modules/.bin/npm ci'],
  ['inside bash -c', 'bash -c "npm ci"'],
  ['inside eval', 'eval "npm install"'],
  ['inside a command substitution', 'echo "$(npm ci)"'],
  ['pnpm install', 'pnpm install'],
  ['pnpm i', 'pnpm i --frozen-lockfile'],
  ['pnpm add', 'pnpm add zod'],
  ['yarn install', 'yarn install --immutable'],
  ['yarn add', 'yarn add zod'],
  ['bare yarn (runs install)', 'yarn'],
  ['bun install', 'bun install'],
  ['bun i', 'bun i'],
  ['bun add', 'bun add zod'],
];

const ALLOW = [
  ['npm test', 'npm test'],
  ['npm run build', 'npm run build'],
  ['npm audit', 'npm audit --omit=dev'],
  ['npm ls', 'npm ls'],
  ['npm view', 'npm view fastify version'],
  ['a global install', 'npm install -g npm@12'],
  ['a global install, long flag', 'npm install --global npm@12'],
  ['pnpm test', 'pnpm test'],
  ['pnpm add -g', 'pnpm add -g typescript'],
  ['yarn test', 'yarn test'],
  ['yarn global add', 'yarn global add typescript'],
  ['bun test', 'bun test'],
  ['bun add -g', 'bun add -g typescript'],
  ['echo mentioning npm ci', 'echo npm ci'],
  ['grep for npm ci', 'grep -rn "npm ci" docs/'],
  ['a commit message quoting it', 'git commit -m "docs: npm ci empties the shared node_modules"'],
  [
    'a heredoc commit message quoting it',
    "git commit -m \"$(cat <<'EOF'\nfix: guard npm ci in a symlinked worktree\n\nnpm ci\nnpm install\nEOF\n)\"",
  ],
  ['a different tool with an install verb', 'pip install requests'],
  ['an unrelated command', 'ls -la'],
];

for (const [name, command] of DENY) {
  test(`refuses ${name}`, () => {
    const refusal = decide(command, WORKTREE, linked);
    assert.match(refusal, /symlink/);
    assert.match(refusal, /rm node_modules/);
    assert.match(refusal, new RegExp(`${MAIN}/node_modules`));
  });
}

for (const [name, command] of ALLOW) {
  test(`allows ${name}`, () => {
    assert.equal(decide(command, WORKTREE, linked), null);
  });
}

test('allows npm ci once node_modules is a real directory, or absent', () => {
  assert.equal(decide('npm ci', MAIN, real), null);
  assert.equal(decide('npm install', WORKTREE, real), null);
});

test('follows --prefix, -C, --dir, and --cwd to the directory the package manager will act on', () => {
  assert.match(decide(`npm ci --prefix ${OTHER}`, WORKTREE, linkedOnlyInOther), /symlink/);
  assert.match(decide(`npm --prefix=${OTHER} install`, WORKTREE, linkedOnlyInOther), /symlink/);
  assert.match(decide(`npm -C ${OTHER} ci`, WORKTREE, linkedOnlyInOther), /symlink/);
  assert.match(decide(`pnpm --dir ${OTHER} install`, WORKTREE, linkedOnlyInOther), /symlink/);
  assert.match(decide(`yarn --cwd ${OTHER} install`, WORKTREE, linkedOnlyInOther), /symlink/);
  assert.match(decide(`bun --cwd=${OTHER} install`, WORKTREE, linkedOnlyInOther), /symlink/);
  assert.equal(decide(`npm ci --prefix ${MAIN}`, WORKTREE, linkedOnlyInOther), null);
  assert.equal(decide('npm ci', WORKTREE, linkedOnlyInOther), null);
});

test('resolves a relative --prefix against the cwd', () => {
  assert.match(decide('npm ci --prefix ../other-slice', WORKTREE, linkedOnlyInOther), /symlink/);
});

test('fails open rather than wedging every Bash call', () => {
  assert.equal(decide('', WORKTREE, linked), null);
  assert.equal(decide(undefined, WORKTREE, linked), null);
  assert.equal(decide('npm ci', '', linked), null);
  assert.equal(decide('npm ci', undefined, linked), null);
});
