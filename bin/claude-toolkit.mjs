#!/usr/bin/env node
// CLI for bootstrapping a repository with claude-toolkit or symlinking skills globally.
//
// Usage:
//   claude-toolkit init <target-dir> [--no-worktrees] [--ui] [--force]
//   claude-toolkit detach [<target-dir>]
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

/**
 * Non-destructively merges incoming `.claude/settings.json` hook and worktree
 * configuration into an existing settings object, deduplicating hooks by command.
 */
export function mergeSettings(existing, incoming) {
  const out = structuredClone(existing && typeof existing === 'object' ? existing : {});

  if (incoming?.hooks && typeof incoming.hooks === 'object') {
    out.hooks = out.hooks && typeof out.hooks === 'object' ? out.hooks : {};
    for (const [event, incomingGroups] of Object.entries(incoming.hooks)) {
      if (!Array.isArray(incomingGroups)) continue;
      const targetGroups = Array.isArray(out.hooks[event]) ? out.hooks[event] : [];
      for (const group of incomingGroups) {
        const matchGroup = targetGroups.find((g) => g.matcher === group.matcher);
        if (!matchGroup) {
          targetGroups.push(structuredClone(group));
        } else {
          matchGroup.hooks = Array.isArray(matchGroup.hooks) ? matchGroup.hooks : [];
          for (const h of group.hooks ?? []) {
            if (!matchGroup.hooks.some((existingHook) => existingHook.command === h.command)) {
              matchGroup.hooks.push(structuredClone(h));
            }
          }
        }
      }
      out.hooks[event] = targetGroups;
    }
  }

  if (incoming?.worktree && typeof incoming.worktree === 'object') {
    out.worktree = out.worktree && typeof out.worktree === 'object' ? out.worktree : {};
    if (incoming.worktree.baseRef && !out.worktree.baseRef) {
      out.worktree.baseRef = incoming.worktree.baseRef;
    }
    if (Array.isArray(incoming.worktree.symlinkDirectories)) {
      const dirs = Array.isArray(out.worktree.symlinkDirectories) ? [...out.worktree.symlinkDirectories] : [];
      for (const d of incoming.worktree.symlinkDirectories) {
        if (!dirs.includes(d)) dirs.push(d);
      }
      out.worktree.symlinkDirectories = dirs;
    }
  }

  return out;
}

/**
 * Parks a git repository's main checkout on a detached HEAD at its current commit
 * (or at `main` if `reanchorToMain` is true) when the working tree is clean, so
 * linked worktrees can check out `main` to merge.
 */
export function detachMainCheckout(targetDir, { reanchorToMain = false } = {}) {
  const root = path.resolve(targetDir);
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

  const rev = git('rev-parse', '--git-dir', '--git-common-dir');
  if (rev.status !== 0) return { detached: false, status: 'not-a-git-repo' };
  const [gitDir, commonDir] = rev.stdout.trim().split('\n');
  if (!gitDir || !commonDir || path.resolve(root, gitDir) !== path.resolve(root, commonDir)) {
    return { detached: false, status: 'not-main-checkout' };
  }

  if (git('rev-parse', '--verify', '-q', 'HEAD').status !== 0) {
    return { detached: false, status: 'no-commits' };
  }

  const branchRes = git('symbolic-ref', '--short', '-q', 'HEAD');
  const currentBranch = branchRes.status === 0 ? branchRes.stdout.trim() : null;
  if (!currentBranch && !reanchorToMain) {
    return { detached: true, status: 'already-detached' };
  }

  const dirty = git('status', '--porcelain');
  if (dirty.status !== 0 || dirty.stdout.trim() !== '') {
    return { detached: false, status: 'dirty', branch: currentBranch };
  }

  const switchArgs = reanchorToMain && git('rev-parse', '--verify', '-q', 'main').status === 0
    ? ['switch', '-q', '--detach', 'main']
    : ['switch', '-q', '--detach'];
  const sw = git(...switchArgs);
  if (sw.status !== 0) return { detached: false, status: 'switch-failed', error: sw.stderr.trim() };

  return { detached: true, status: 'detached', previousBranch: currentBranch };
}

export function initRepo(targetDir, options = {}) {
  const { worktrees = true, ui = false, force = false } = options;
  const root = path.resolve(targetDir);
  mkdirSync(root, { recursive: true });

  const copied = [];
  const skipped = [];
  const merged = [];
  const place = (srcRel, destRel = srcRel) =>
    copyRecursive(path.join(TOOLKIT_ROOT, srcRel), path.join(root, destRel), { force, copied, skipped });

  // 1. Skills
  for (const skill of SKILLS) {
    place(`.claude/skills/${skill}`);
  }

  // 2. Hooks & settings (non-destructive merge if .claude/settings.json already exists)
  place('.claude/.gitignore');
  place('.claude/hooks/guard-remote-mutation.mjs');
  const templateSettingsRel = worktrees ? '.claude/settings.json' : 'templates/settings.minimal.json';
  const incomingSettings = JSON.parse(readFileSync(path.join(TOOLKIT_ROOT, templateSettingsRel), 'utf8'));
  const settingsDest = path.join(root, '.claude/settings.json');
  mkdirSync(path.dirname(settingsDest), { recursive: true });

  if (existsSync(settingsDest) && !force) {
    try {
      const existingSettings = JSON.parse(readFileSync(settingsDest, 'utf8'));
      const combined = mergeSettings(existingSettings, incomingSettings);
      writeFileSync(settingsDest, `${JSON.stringify(combined, null, 2)}\n`);
      merged.push(settingsDest);
    } catch {
      skipped.push(settingsDest);
    }
  } else {
    writeFileSync(settingsDest, `${JSON.stringify(incomingSettings, null, 2)}\n`);
    copied.push(settingsDest);
  }

  if (worktrees) {
    place('.claude/hooks/guard-main-checkout-edits.mjs');
    place('.claude/hooks/guard-symlinked-node-modules.mjs');
    place('scripts/git-hooks/pre-commit');
    place('scripts/git-hooks/pre-merge-commit');
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

  // Wire git core.hooksPath and park clean main checkout on detached HEAD if worktrees are enabled
  let hooksConfigured = false;
  let worktreeHead = null;
  if (worktrees) {
    const gitCheck = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' });
    if (gitCheck.status === 0) {
      const cfg = spawnSync('git', ['config', 'core.hooksPath', 'scripts/git-hooks'], { cwd: root });
      hooksConfigured = cfg.status === 0;
      worktreeHead = detachMainCheckout(root);
    }
  }

  return { root, copied, merged, skipped, hooksConfigured, worktreeHead };
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
  claude-toolkit detach [<target-dir>]
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
    if (res.merged.length > 0) console.log(`  Merged existing: ${res.merged.length} file(s)`);
    if (res.skipped.length > 0) console.log(`  Skipped existing: ${res.skipped.length} file(s) (use --force to overwrite)`);
    if (res.hooksConfigured) console.log('  Configured git core.hooksPath -> scripts/git-hooks');
    if (res.worktreeHead?.status === 'detached') {
      console.log(`  Parked main checkout on detached HEAD (was on branch '${res.worktreeHead.previousBranch}')`);
    } else if (res.worktreeHead?.status === 'dirty') {
      console.log(
        `  Note: main checkout is on branch '${res.worktreeHead.branch}' with uncommitted files. ` +
          'Once committed, run "claude-toolkit detach" (or "git switch --detach main") so worktrees can merge into main.',
      );
    }
  } else if (cmd === 'detach') {
    const target = positional[1] || '.';
    const res = detachMainCheckout(target, { reanchorToMain: true });
    if (res.detached) {
      console.log(`Main checkout at ${path.resolve(target)} is now parked on detached HEAD (${res.status}).`);
    } else {
      console.error(`Could not detach main checkout (${res.status}).`);
      process.exit(1);
    }
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
