import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../.claude/hooks/guard-remote-mutation.mjs';

const ASK = [
  ['root ssh probe', 'ssh -o BatchMode=yes -o ConnectTimeout=8 root@92.51.47.17 "hostname" 2>&1'],
  ['ssh piped into crontab', "ssh -i ~/.ssh/deploy root@147.45.170.29 'cat <<EOF | crontab -'"],
  ['echo piped into ssh', 'echo "=== primary VPS ===" | ssh -i ~/.ssh/deploy root@147.45.170.29 "which rsync"'],
  ['rsync push to remote', "rsync -az -e 'ssh -i /root/.ssh/k' /opt/app/data/backups/ backup@92.51.47.17:"],
  ['bare crontab rewrite', 'crontab -l > /root/crontab.bak'],
  ['scp', 'scp ./file.db root@host:/backups/'],
  ['remote docker daemon', 'docker -H ssh://root@vps ps'],
  ['DOCKER_HOST env', 'DOCKER_HOST=ssh://vps docker compose up -d'],
  ['ssh inside bash -c', 'bash -c "ssh root@host hostname"'],
  ['ssh inside a command substitution', 'echo "$(ssh root@host date)"'],
  ['push to main', 'git push origin main'],
  ['push HEAD onto main', 'git push origin HEAD:main'],
  ['force push onto main', 'git push origin +feat:refs/heads/main'],
  ['delete main by refspec', 'git push origin :main'],
  ['delete main by flag', 'git push --delete origin main'],
  ['push every branch', 'git push --all origin'],
  ['bare push follows the current branch', 'git push'],
  ['push with a remote but no refspec', 'git push -u origin'],
  ['push of HEAD follows the current branch', 'git push -u origin HEAD'],
  ['push with a global option first', 'git -C /repo push origin main'],
  ['push after a cd', 'cd /repo && git push origin main'],
  ['push inside bash -c', 'bash -c "git push origin main"'],
  ['gh pr merge', 'gh pr merge 12 --squash'],
  ['gh workflow run', 'gh workflow run deploy.yml'],
  ['gh run rerun redeploys', 'gh run rerun 123'],
  ['gh secret set', 'gh secret set DEPLOY_SSH_KEY < key'],
  ['gh api with an explicit write method', 'gh api -X POST repos/o/r/merges'],
  ['gh api with a body defaults to POST', 'gh api repos/o/r/dispatches -f event_type=deploy'],
];

const PASS = [
  ['npm test', 'npm test > /tmp/test.log 2>&1; echo "exit=$?"'],
  ['ssh-keygen is local', 'ssh-keygen -t ed25519 -f /root/.ssh/newkey -N ""'],
  ['ssh-agent is local', 'eval "$(ssh-agent -s)"'],
  ['ssh-add is local', 'ssh-add ~/.ssh/deploy'],
  ['local docker compose', 'docker compose up -d'],
  ['listing the ssh dir', 'ls -la ~/.ssh/'],
  ['plain git commit', 'git add -A && git commit -m "fix: thing"'],
  [
    'commit message mentioning a piped ssh',
    'git commit -m "docs: note that `echo ... | ssh ...` pipelines are matched"',
  ],
  [
    'heredoc commit body mentioning ssh and crontab',
    ['git commit -m "$(cat <<\'EOF\'', 'fix: gate remote state mutation', '', 'ran 29 commands: echo x | ssh host, and crontab -l > bak', 'EOF', ')"'].join('\n'),
  ],
  ['grep for a literal in a file', "grep -n 'ssh ' ~/.ssh/config"],
  ['push of a named branch', 'git push -u origin chore/backlog-three-items'],
  ['push of a branch onto itself, then more', 'git push origin feat:feat && echo ok'],
  ['git stash push is local', 'git stash push -u -m my-tag'],
  ['git config naming push', 'git config push.default simple'],
  ['commit message mentioning a push to main', 'git commit -m "docs: never git push origin main or gh pr merge unasked"'],
  [
    'heredoc commit body mentioning a push to main',
    ['git commit -m "$(cat <<\'EOF\'', 'fix: guard pushes', '', 'git push origin main deploys; so does gh pr merge', 'EOF', ')"'].join('\n'),
  ],
  ['gh run watch', 'gh run watch 123 --exit-status'],
  ['gh variable list', 'gh variable list'],
  ['gh pr view', 'gh pr view 3'],
  ['gh api read', 'gh api repos/o/r/actions/runs'],
  ['gh api explicit GET with query fields', 'gh api -X GET search/issues -f q=x'],
  ['gh auth status', 'gh auth status'],
];

test('flags commands that mutate state outside the working tree', () => {
  for (const [label, command] of ASK) {
    assert.notEqual(decide(command), null, `expected ASK: ${label}`);
  }
});

test('leaves local work unprompted, including text that merely mentions remote tools', () => {
  for (const [label, command] of PASS) {
    assert.equal(decide(command), null, `expected PASS: ${label}`);
  }
});

test('fails open rather than wedging the session', () => {
  assert.equal(decide(''), null);
  assert.equal(decide(undefined), null);
});
