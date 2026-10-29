#!/usr/bin/env node
// Normalizes every committed Markdown doc to **one sentence per line**.
//
// Why one sentence per line:
//   - Hard-wrapping mid-sentence makes docs un-greppable: any phrase distinctive
//     enough to search for is long enough to straddle a line break, so a
//     line-oriented tool cannot see it.
//   - One paragraph per line makes a one-word fix show up as a whole changed
//     paragraph in `git diff`. Per-sentence keeps diffs tight and still lets any
//     within-sentence phrase be found by plain grep.
//   - Rendering is unaffected either way — Markdown joins consecutive non-blank
//     lines into one paragraph.
//
// Usage:
//   node scripts/reflow-docs.mjs           rewrite every doc in place
//   node scripts/reflow-docs.mjs --check   exit 1 if any doc is not canonical

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_DOC_ROOTS = ['README.md', 'CLAUDE.md', 'docs', '.claude/skills', '.claude/rules', 'templates'];

function loadDocRoots() {
  if (existsSync('.doclinksrc.json')) {
    try {
      const cfg = JSON.parse(readFileSync('.doclinksrc.json', 'utf8'));
      if (Array.isArray(cfg.docRoots)) return cfg.docRoots;
    } catch {
      // Fall back to defaults on invalid config
    }
  }
  return DEFAULT_DOC_ROOTS;
}

const ABBREVIATIONS = ['e.g.', 'i.e.', 'cf.', 'vs.', 'etc.', 'Dr.', 'Mr.', 'Ms.', 'St.', 'approx.'];

function walk(target, out = []) {
  if (!existsSync(target)) return out;
  if (statSync(target).isFile()) {
    if (target.endsWith('.md')) out.push(target);
    return out;
  }
  for (const entry of readdirSync(target)) walk(path.join(target, entry), out);
  return out;
}

function isStructural(line) {
  return (
    line.trim() === '' ||
    /^\s*#{1,6}\s/.test(line) || // heading
    /^\s*\|/.test(line) || // table row
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line) || // rule, and YAML frontmatter's ---
    /^\s*```/.test(line) // fence
  );
}

function listMarker(line) {
  const m = /^(\s*)([-*]|\d+\.)\s+/.exec(line);
  return m ? { indent: m[1], continuation: ' '.repeat(m[0].length) } : null;
}

function insideEmphasis(text) {
  const bare = text.replace(/`[^`]*`/g, '');
  const bold = (bare.match(/\*\*/g) ?? []).length;
  const under = (bare.match(/(?<!\w)_|_(?!\w)/g) ?? []).length;
  return bold % 2 !== 0 || under % 2 !== 0;
}

function splitSentences(text) {
  const out = [];
  let start = 0;
  let depth = 0;
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '`') inCode = !inCode;
    if (inCode) continue;
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    if (ch !== '.' && ch !== ':' && ch !== ';') continue;
    if (text[i + 1] !== ' ') continue;

    const before = text.slice(start, i + 1);
    if (ABBREVIATIONS.some((a) => before.endsWith(a))) continue;
    if (ch === '.' && /(^|\s)[A-Z]$/.test(text.slice(0, i))) continue;
    if (insideEmphasis(text.slice(0, i + 1))) continue;

    const rest = text.slice(i + 2);
    if (!/^[A-Z(`*_["'\d]/.test(rest)) continue;
    if (before.trim().length < 2 || rest.trim().length === 0) continue;

    out.push(text.slice(start, i + 1).trim());
    start = i + 2;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.length > 0 ? out : [text.trim()];
}

export function reflow(source) {
  const lines = source.split('\n');
  const out = [];
  let inFence = false;
  let inFrontmatter = false;
  let buffer = null;

  const flush = () => {
    if (!buffer) return;
    const sentences = splitSentences(buffer.text);
    sentences.forEach((s, i) => out.push((i === 0 ? buffer.prefix : buffer.continuation) + s));
    buffer = null;
  };

  lines.forEach((line, i) => {
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      out.push(line);
      return;
    }
    if (inFrontmatter) {
      out.push(line);
      if (line.trim() === '---') inFrontmatter = false;
      return;
    }

    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      out.push(line);
      return;
    }
    if (inFence) {
      out.push(line);
      return;
    }

    const quote = /^(\s*>\s?)(.*)$/.exec(line);
    if (quote) {
      const [, prefix, content] = quote;
      if (content.trim() === '') {
        flush();
        out.push(line);
        return;
      }
      if (buffer && buffer.prefix.includes('>')) {
        buffer.text += ` ${content.trim()}`;
        return;
      }
      flush();
      buffer = { text: content.trim(), prefix, continuation: prefix };
      return;
    }

    if (isStructural(line)) {
      flush();
      out.push(line);
      return;
    }

    const marker = listMarker(line);
    if (marker) {
      flush();
      const markerText = /^(\s*(?:[-*+]|\d+\.)\s+)/.exec(line)[1];
      buffer = {
        text: line.slice(markerText.length).trim(),
        prefix: markerText,
        continuation: marker.continuation,
      };
      return;
    }

    if (buffer) {
      buffer.text += ` ${line.trim()}`;
      return;
    }

    const indent = line.slice(0, line.length - line.trimStart().length);
    buffer = { text: line.trim(), prefix: indent, continuation: indent };
  });
  flush();

  return out.join('\n');
}

if (import.meta.filename === process.argv[1]) {
  const checkOnly = process.argv.includes('--check');
  const docs = loadDocRoots().flatMap((root) => walk(root));
  const offenders = [];
  let changed = 0;

  for (const file of docs) {
    const before = readFileSync(file, 'utf8');
    const after = reflow(before);
    if (before === after) continue;
    if (checkOnly) offenders.push(file);
    else {
      writeFileSync(file, after);
      changed++;
    }
  }

  if (checkOnly && offenders.length > 0) {
    console.error('check-doc-format: these docs are not in canonical form (one sentence per line):\n');
    for (const f of offenders) console.error(`  ${f}`);
    console.error('\nRun: node scripts/reflow-docs.mjs');
    process.exit(1);
  }

  console.log(
    checkOnly
      ? `check-doc-format: ${docs.length} docs, all one sentence per line. OK.`
      : `reflow-docs: reflowed ${changed} of ${docs.length} docs.`,
  );
}
