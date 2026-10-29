// Refuses an Edit/Write aimed at the main checkout when using the session-per-worktree
// convention (see CLAUDE.md#version-control).
//
// Decision is "deny", where guard-remote-mutation.mjs deliberately only asks: here the
// fix — enter a worktree — is entirely the agent's to take, and the reason text below
// hands it the exact instruction.
//
// Bash-written edits (`sed -i`, a heredoc) are invisible here; scripts/git-hooks/
// catches those at commit time instead.
//
// Usage: wired as a PreToolUse hook on Edit|Write|NotebookEdit in .claude/settings.json.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REASON =
  'This path is in the main checkout, which stays parked on a detached HEAD and is ' +
  'never edited — see CLAUDE.md#version-control. Call EnterWorktree, rename ' +
  'the generated branch to feature/, fix/, docs/ or chore/<slug>, check the base is ' +
  'local main, and make the edit there instead.';

/** The closest ancestor that exists, since a Write may target a file that doesn't yet. */
function nearestExistingDir(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  while (!existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return dir;
}

/**
 * Ask git where this path lives. Returns null for anything that isn't a working
 * tree — the scratchpad, ~/.claude, a machine with no git — which is always allowed.
 */
function locate(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [toplevel, commonDir] = out.trim().split('\n');
    if (!toplevel || !commonDir) return null;
    return { toplevel, commonDir: path.resolve(dir, commonDir) };
  } catch {
    return null;
  }
}

/**
 * The main checkout is the working tree whose own directory holds the common git
 * dir: <repo>/.git. A linked worktree's common dir points back at the main
 * checkout instead, so the two differ and the edit is allowed.
 */
export function decide(
  filePath,
  resolve = (p) => {
    const dir = nearestExistingDir(p);
    return dir === null ? null : locate(dir);
  },
) {
  if (!filePath) return null;
  let found;
  try {
    found = resolve(filePath);
  } catch {
    return null;
  }
  if (!found) return null;
  const { toplevel, commonDir } = found;
  if (!toplevel || !commonDir) return null;
  return path.resolve(toplevel) === path.resolve(path.dirname(commonDir)) ? REASON : null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let filePath;
  try {
    filePath = JSON.parse(raw)?.tool_input?.file_path;
  } catch {
    return;
  }

  if (!decide(filePath)) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: REASON,
      },
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
