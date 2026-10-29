// Refuses `npm` / `pnpm` / `yarn` / `bun` install commands in a directory whose
// `node_modules` is a symlink, which is what every new worktree gets when
// `worktree.symlinkDirectories` in .claude/settings.json links it to the main
// checkout's node_modules.
//
// Why this exists mechanically: `npm ci` removes the contents of whatever
// `node_modules` resolves to, then replaces the link with a real directory and
// installs there — wiping the main checkout's shared `node_modules` for every other
// worktree. `npm install` (and `pnpm` / `yarn` / `bun` install/add) writes or
// relinks this branch's dependencies into the shared directory.
//
// Decision is "deny": the fix is entirely the agent's to take (`rm node_modules` as
// its own command, then run the package manager again).
//
// Usage: wired as a PreToolUse hook on Bash in .claude/settings.json.

import { lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WRAPPER, simpleCommands, stripNonExecutable } from './guard-remote-mutation.mjs';

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

const INSTALL_VERBS = new Set([
  'ci',
  'clean-install',
  'ic',
  'install',
  'i',
  'add',
  'install-ci-test',
  'cit',
  'install-test',
  'it',
]);

const OPTIONS_WITH_VALUE = new Set([
  '--prefix',
  '-C',
  '--dir',
  '--cwd',
  '--registry',
  '--workspace',
  '-w',
  '--cache',
  '--loglevel',
  '--userconfig',
]);

function commandWords(words) {
  let at = 0;
  while (at < words.length && /^[A-Za-z_]\w*=/.test(words[at])) at++;
  const rest = words.slice(at);
  if (/(^|\/)(ba|z|da)?sh$/.test(rest[0] ?? '') && rest[1] === '-c') return rest.slice(2);
  if (rest[0] === 'eval') return rest.slice(1);
  return rest;
}

function whichManager(word) {
  if (!word) return null;
  if (PACKAGE_MANAGERS.has(word)) return word;
  for (const pm of PACKAGE_MANAGERS) {
    if (word.endsWith(`/${pm}`)) return pm;
  }
  return null;
}

function installTarget(words) {
  const [first, ...args] = commandWords(words);
  const pm = whichManager(first);
  if (!pm) return null;

  if (args.includes('-g') || args.includes('--global') || args[0] === 'global') return null;

  let at = 0;
  let prefix = '';
  while (at < args.length && args[at].startsWith('-')) {
    const flag = args[at];
    if (flag === '--prefix' || flag === '-C' || flag === '--dir' || flag === '--cwd') {
      prefix = args[at + 1] ?? '';
    } else if (/^--(prefix|dir|cwd)=/.test(flag)) {
      prefix = flag.slice(flag.indexOf('=') + 1);
    }
    at += OPTIONS_WITH_VALUE.has(flag) ? 2 : 1;
  }

  const verb = args[at];
  // Bare `yarn` with no verb runs `yarn install`.
  const isBareYarnInstall = pm === 'yarn' && verb === undefined;
  if (!isBareYarnInstall && !INSTALL_VERBS.has(verb)) return null;

  for (let i = at + 1; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--prefix' || flag === '-C' || flag === '--dir' || flag === '--cwd') {
      prefix = args[i + 1] ?? '';
    } else if (/^--(prefix|dir|cwd)=/.test(flag)) {
      prefix = flag.slice(flag.indexOf('=') + 1);
    }
  }
  return prefix;
}

function symlinkTarget(dir) {
  try {
    const modules = path.join(dir, 'node_modules');
    return lstatSync(modules).isSymbolicLink() ? readlinkSync(modules) : null;
  } catch {
    return null;
  }
}

function reason(target) {
  return (
    `node_modules here is a symlink to ${target}, which worktree.symlinkDirectories in ` +
    '.claude/settings.json creates so every worktree shares one install. npm ci empties the ' +
    'directory a symlink points at and then replaces the link with a real directory, so ' +
    'running it here wipes the node_modules every other worktree uses; npm/pnpm/yarn/bun install ' +
    "writes this branch's dependencies into that shared directory. Un-symlink first, as its own " +
    'command: `rm node_modules` (the link itself, no trailing slash, and no -r). Then run ' +
    'the install command again, and it installs into this worktree alone. See CLAUDE.md#version-control.'
  );
}

export function decide(command, cwd, linkTarget = symlinkTarget) {
  if (!command || !cwd) return null;
  const executable = stripNonExecutable(command);
  const scanned = WRAPPER.test(executable) ? [executable, command] : [executable];
  for (const text of scanned) {
    for (const words of simpleCommands(text)) {
      const prefix = installTarget(words);
      if (prefix === null) continue;
      const target = linkTarget(path.resolve(cwd, prefix));
      if (target) return reason(target);
    }
  }
  return null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  const refusal = decide(payload?.tool_input?.command, payload?.cwd ?? process.cwd());
  if (!refusal) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: refusal,
      },
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
