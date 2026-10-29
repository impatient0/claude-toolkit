#!/usr/bin/env node
// CLI for bootstrapping a repository with claude-toolkit or symlinking skills globally.
//
// Usage:
//   claude-toolkit init <target-dir> [--no-worktrees] [--ui] [--force]
//   claude-toolkit install-global [--target <claude-home>] [--force]
//   claude-toolkit status [<target-dir>]

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  readdirSync,
  statSync,
  symlinkSync,
  lstatSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TOOLKIT_ROOT = path.resolve(import.meta.dirname, '..');

const SKILLS = [
  'wrap-up',
  'autonomous-slice',
  'backlog-audit',
  'doc-audit',
  'merge-to-main',
  'secure-credential-handoff',
  'browser-driver',
];

function copyRecursive(src, dest, { force = false, copied = [], skipped = [] } = {}) {
  if (statSync(src).isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), { force, copied, skipped });
    }
    return { copied, skipped };
  }
  if (existsSync(dest) && !force) {
    skipped.push(dest);
    return { copied, skipped };
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  const mode = statSync(src).mode;
  if (mode & 0o111) chmodSync(dest, 0o755);
  copied.push(dest);
  return { copied, skipped };
}

export function initRepo(targetDir, options = {}) {
  const { worktrees = true, ui = false, force = false } = options;
  const root = path.resolve(targetDir);
  mkdirSync(root, { recursive: true });

  const copied = [];
  const skipped = [];
  const place = (srcRel, destRel = srcRel) =>
    copyRecursive(path.join(TOOLKIT_ROOT, srcRel), path.join(root, destRel), { force, copied, skipped });

  // 1. Skills
  for (const skill of SKILLS) {
    place(`.claude/skills/${skill}`);
  }

  // 2. Hooks & settings
  place('.claude/.gitignore');
  place('.claude/hooks/guard-remote-mutation.mjs');
  if (worktrees) {
    place('.claude/hooks/guard-main-checkout-edits.mjs');
    place('.claude/hooks/guard-symlinked-node-modules.mjs');
    place('.claude/settings.json');
    place('scripts/git-hooks/pre-commit');
    place('scripts/git-hooks/pre-merge-commit');
  } else {
    place('templates/settings.minimal.json', '.claude/settings.json');
  }

  // 3. UI rule & mockup scaffold
  place('.claude/rules/ui-change-gate.md');
  if (ui) {
    place('templates/docs/design/mockup-scaffold.html', 'docs/design/mockup-scaffold.html');
    place('templates/driver-commands.example.mjs', '.claude/driver-commands.example.mjs');
  }

  // 4. Doc checkers & core docs
  place('scripts/check-doc-links.mjs');
  place('scripts/reflow-docs.mjs');
  const claudeDest = path.join(root, 'CLAUDE.md');
  if (!existsSync(claudeDest) || force) {
    const header = readFileSync(path.join(TOOLKIT_ROOT, 'templates/CLAUDE.md'), 'utf8').trimEnd();
    const full = readFileSync(path.join(TOOLKIT_ROOT, 'CLAUDE.md'), 'utf8');
    const splitAt = full.indexOf('\n---\n');
    const body = splitAt !== -1 ? full.slice(splitAt) : '';
    writeFileSync(claudeDest, `${header}${body}`);
    copied.push(claudeDest);
  } else {
    skipped.push(claudeDest);
  }
  place('docs/backlog.md');
  place('docs/adr/0001-record-architecture-decisions.md');

  // Ensure README.md exists and links to docs/adr/ and docs/backlog.md so check-doc-links passes immediately
  const readmePath = path.join(root, 'README.md');
  if (!existsSync(readmePath)) {
    const projectName = path.basename(root);
    writeFileSync(
      readmePath,
      `# ${projectName}\n\n## Documentation\n\n- [Architecture Decision Records](docs/adr/0001-record-architecture-decisions.md)\n- [Task Backlog](docs/backlog.md)\n`,
    );
    copied.push(readmePath);
  }

  // Wire git core.hooksPath if target is a git repository and worktrees are enabled
  let hooksConfigured = false;
  if (worktrees) {
    const gitCheck = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' });
    if (gitCheck.status === 0) {
      const cfg = spawnSync('git', ['config', 'core.hooksPath', 'scripts/git-hooks'], { cwd: root });
      hooksConfigured = cfg.status === 0;
    }
  }

  return { root, copied, skipped, hooksConfigured };
}

export function installGlobal(options = {}) {
  const claudeHome = path.resolve(options.target || path.join(os.homedir(), '.claude'));
  const force = Boolean(options.force);
  const skillsDir = path.join(claudeHome, 'skills');
  const hooksDir = path.join(claudeHome, 'hooks');
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  const linked = [];
  const skipped = [];

  for (const skill of SKILLS) {
    const src = path.join(TOOLKIT_ROOT, '.claude/skills', skill);
    const dest = path.join(skillsDir, skill);
    try {
      const st = lstatSync(dest);
      if (!force) {
        skipped.push(dest);
        continue;
      }
      if (st.isSymbolicLink() || st.isFile()) unlinkSync(dest);
    } catch {
      // dest does not exist
    }
    symlinkSync(src, dest, 'dir');
    linked.push(dest);
  }

  for (const hook of ['guard-remote-mutation.mjs', 'guard-main-checkout-edits.mjs', 'guard-symlinked-node-modules.mjs']) {
    const src = path.join(TOOLKIT_ROOT, '.claude/hooks', hook);
    const dest = path.join(hooksDir, hook);
    try {
      const st = lstatSync(dest);
      if (!force) {
        skipped.push(dest);
        continue;
      }
      if (st.isSymbolicLink() || st.isFile()) unlinkSync(dest);
    } catch {
      // dest does not exist
    }
    symlinkSync(src, dest, 'file');
    linked.push(dest);
  }

  return { claudeHome, linked, skipped };
}

export function statusRepo(targetDir = '.') {
  const root = path.resolve(targetDir);
  const skillsPresent = SKILLS.filter((s) => existsSync(path.join(root, '.claude/skills', s, 'SKILL.md')));
  const hooksPresent = [
    'guard-remote-mutation.mjs',
    'guard-main-checkout-edits.mjs',
    'guard-symlinked-node-modules.mjs',
  ].filter((h) => existsSync(path.join(root, '.claude/hooks', h)));
  const scriptsPresent = ['check-doc-links.mjs', 'reflow-docs.mjs'].filter((s) =>
    existsSync(path.join(root, 'scripts', s)),
  );
  let gitHooksPath = null;
  const gitCfg = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
  if (gitCfg.status === 0) gitHooksPath = gitCfg.stdout.trim();

  return {
    root,
    claudeMd: existsSync(path.join(root, 'CLAUDE.md')),
    backlogMd: existsSync(path.join(root, 'docs/backlog.md')),
    skillsPresent,
    hooksPresent,
    scriptsPresent,
    gitHooksPath,
  };
}

function printUsage() {
  console.log(`Usage:
  claude-toolkit init <target-dir> [--no-worktrees] [--ui] [--force]
  claude-toolkit install-global [--target ~/.claude] [--force]
  claude-toolkit status [<target-dir>]`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));

  if (!cmd || flags.has('--help') || flags.has('-h')) {
    printUsage();
    process.exit(0);
  }

  if (cmd === 'init') {
    const target = positional[1];
    if (!target) {
      console.error('claude-toolkit init: missing <target-dir>');
      printUsage();
      process.exit(1);
    }
    const res = initRepo(target, {
      worktrees: !flags.has('--no-worktrees'),
      ui: flags.has('--ui'),
      force: flags.has('--force'),
    });
    console.log(`Initialized ${res.root}:`);
    console.log(`  Copied: ${res.copied.length} file(s)`);
    if (res.skipped.length > 0) console.log(`  Skipped existing: ${res.skipped.length} file(s) (use --force to overwrite)`);
    if (res.hooksConfigured) console.log('  Configured git core.hooksPath -> scripts/git-hooks');
  } else if (cmd === 'install-global') {
    const targetIdx = args.indexOf('--target');
    const target = targetIdx !== -1 ? args[targetIdx + 1] : undefined;
    const res = installGlobal({ target, force: flags.has('--force') });
    console.log(`Installed global symlinks in ${res.claudeHome}:`);
    console.log(`  Linked: ${res.linked.length} item(s)`);
    if (res.skipped.length > 0) console.log(`  Skipped existing: ${res.skipped.length} item(s) (use --force to overwrite)`);
  } else if (cmd === 'status') {
    const st = statusRepo(positional[1] || '.');
    console.log(JSON.stringify(st, null, 2));
  } else {
    console.error(`Unknown command: ${cmd}`);
    printUsage();
    process.exit(1);
  }
}
