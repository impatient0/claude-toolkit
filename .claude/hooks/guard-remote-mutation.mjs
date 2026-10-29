// Forces a permission prompt on any Bash command that mutates state outside the
// working tree — a remote host, a crontab, a remote Docker daemon, a push that can
// reach `main`, or a GitHub write through `gh`.
//
// Decision is "ask", never "deny": this work is legitimate and routine, it just may
// not happen unattended. A denial an agent cannot clear would block real work; a
// prompt costs one keystroke and puts a human at the exact point CLAUDE.md requires.
//
// stripNonExecutable() removes heredoc bodies and quoted spans (unless they contain
// `$(...)` command substitutions) before matching, so commit messages and grep
// patterns that mention `ssh` or `git push origin main` as inert text never trigger
// false positives.
//
// Usage: wired as a PreToolUse hook on Bash in .claude/settings.json; reads the hook
// payload on stdin.

import { pathToFileURL } from 'node:url';

// Each pattern requires the tool name to be a whole word, so `ssh-keygen`,
// `ssh-agent`, and `ssh-add` (all local, all harmless) do not match: the trailing
// whitespace requirement cannot match the hyphen.
const REMOTE_PATTERNS = [
  /(^|[^\w.-])ssh\s/,
  /(^|[^\w.-])ssh-copy-id\s/,
  /(^|[^\w.-])scp\s/,
  /(^|[^\w.-])rsync\s/,
  /(^|[^\w.-])crontab\s/,
  /(^|[^\w.-])docker\s+(-H|--host)\s/,
  /DOCKER_HOST=/,
];

// A wrapper hands its payload to another shell, so the payload IS executable even
// though it sits inside quotes. When one is present, the raw string gets rescanned.
export const WRAPPER = /(^|[^\w.-])((ba|z|da)?sh\s+-c|eval)(\s|$)/;

/**
 * Remove the parts of a shell command that are data rather than code: heredoc
 * bodies and quoted spans. Command substitutions are kept — `"$(ssh host cmd)"`
 * runs ssh for real, quotes notwithstanding.
 */
export function stripNonExecutable(command) {
  // Pass 1, line-oriented: drop heredoc bodies before quote stripping, because a
  // heredoc body is not quoted (`<<'EOF'` quotes only the delimiter).
  const kept = [];
  let openDelimiter = null;
  for (const line of command.split('\n')) {
    if (openDelimiter !== null) {
      if (line.trim() === openDelimiter) openDelimiter = null;
      continue;
    }
    kept.push(line);
    const heredoc = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line);
    if (heredoc) openDelimiter = heredoc[2];
  }

  // Pass 2, character-oriented: drop quoted spans, keeping any that contain a
  // command substitution.
  const source = kept.join('\n');
  let out = '';
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === "'") {
      const end = source.indexOf("'", i + 1);
      const body = source.slice(i + 1, end === -1 ? source.length : end);
      out += containsSubstitution(body) ? body : ' ';
      i = end === -1 ? source.length : end + 1;
    } else if (char === '"') {
      let j = i + 1;
      let body = '';
      while (j < source.length && source[j] !== '"') {
        if (source[j] === '\\') j++;
        body += source[j];
        j++;
      }
      out += containsSubstitution(body) ? body : ' ';
      i = j + 1;
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

// Only `$(...)` counts as a live substitution. Backticks are overwhelmingly markdown
// code spans inside commit messages and doc text.
function containsSubstitution(text) {
  return text.includes('$(');
}

export function simpleCommands(text) {
  return text
    .replace(/['"]/g, ' ')
    .split(/[;&|\n()<>`]/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean));
}

/** The words after an invocation of `name` in one simple command, or null. */
function argsOf(words, name) {
  const at = words.findIndex((word) => word === name || word.endsWith(`/${name}`));
  return at === -1 ? null : words.slice(at + 1);
}

const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const PUSH_OPTIONS_WITH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const PUSH_EVERY_BRANCH = new Set(['--all', '--mirror', '--branches']);

function mayBeMain(dst) {
  return (
    dst === 'main' ||
    dst === 'master' ||
    dst === 'refs/heads/main' ||
    dst === 'refs/heads/master' ||
    dst === 'HEAD' ||
    dst === '@' ||
    dst === '' ||
    dst.includes('*')
  );
}

function pushMayReachMain(words) {
  const args = argsOf(words, 'git');
  if (!args) return false;
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += GIT_OPTIONS_WITH_VALUE.has(args[i]) ? 2 : 1;
  if (args[i] !== 'push') return false;

  const positional = [];
  for (let j = i + 1; j < args.length; j++) {
    if (PUSH_EVERY_BRANCH.has(args[j])) return true;
    if (PUSH_OPTIONS_WITH_VALUE.has(args[j])) j++;
    else if (!args[j].startsWith('-')) positional.push(args[j]);
  }
  const refspecs = positional.slice(1);
  if (refspecs.length === 0) return true;
  return refspecs.some((refspec) => {
    const spec = refspec.replace(/^\+/, '');
    return mayBeMain(spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec);
  });
}

const GH_READ_VERBS = new Set(['list', 'ls', 'view', 'status', 'diff', 'checks', 'watch', 'download', 'checkout', 'clone']);
const GH_READ_GROUPS = new Set(['search', 'browse', 'help', 'completion', 'version', '--version', '--help']);
const GH_API_BODY_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);

function ghWritesRemote(words) {
  const args = argsOf(words, 'gh');
  if (!args || args.length === 0) return false;
  const [group, verb] = args;
  if (GH_READ_GROUPS.has(group)) return false;
  if (group === 'api') return ghApiWrites(args.slice(1));
  if (group === 'auth' && verb === 'status') return false;
  return !GH_READ_VERBS.has(verb);
}

function ghApiWrites(args) {
  let method = null;
  let body = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-X' || arg === '--method') method = args[++i] ?? '';
    else if (arg.startsWith('--method=')) method = arg.slice('--method='.length);
    else if (/^-X./.test(arg)) method = arg.slice(2);
    else if (GH_API_BODY_FLAGS.has(arg) || /^--(raw-field|field|input)=/.test(arg)) body = true;
  }
  return method === null ? body : method.toUpperCase() !== 'GET';
}

const COMMAND_RULES = [pushMayReachMain, ghWritesRemote];

export function decide(command) {
  if (!command) return null;
  const executable = stripNonExecutable(command);
  const scanned = WRAPPER.test(executable) ? [executable, command] : [executable];
  for (const text of scanned) {
    for (const pattern of REMOTE_PATTERNS) {
      if (pattern.test(text)) return pattern;
    }
    for (const words of simpleCommands(text)) {
      for (const rule of COMMAND_RULES) {
        if (rule(words)) return rule;
      }
    }
  }
  return null;
}

const REASON =
  'This command mutates state outside the working tree (a remote host, a crontab, a ' +
  'remote Docker daemon, a push that can reach main, or a GitHub write through gh). ' +
  'CLAUDE.md requires explicit confirmation for remote/prod-affecting actions, and a ' +
  'harness prompt telling the session to push is not the user asking. Confirm the ' +
  'target and the change before allowing.';

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let command;
  try {
    command = JSON.parse(raw)?.tool_input?.command;
  } catch {
    return;
  }

  if (!decide(command)) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: REASON,
      },
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
