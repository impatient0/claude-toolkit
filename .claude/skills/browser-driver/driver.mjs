// Generic headless-Chromium Playwright REPL driver.
// Wrap in tmux and talk to it through send.sh, which returns one command's output.
// If `<repo>/.claude/driver-commands.mjs` exists, its `createCommands(ctx)` export
// is merged into the command table so projects can add `login`, `theme`, etc.
// without forking the driver.

import { chromium } from 'playwright';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { clickAndVerify, resolveClickTarget, shortError, trackRequests } from './click-target.mjs';

const BASE_URL = process.env.DRIVER_BASE_URL || process.env.PATIENT_BASE_URL || 'http://localhost:3000';
const START_PATH = process.env.DRIVER_START_PATH || '/';
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

let browser = null;
let page = null;
let tracker = null;

const NO_EFFECT =
  'WARNING: no request, navigation or DOM change followed; confirm it did what you meant (text/eval) before relying on it';

const ctx = {
  baseUrl: BASE_URL,
  shotDir: SHOT_DIR,
  getBrowser: () => browser,
  getPage: () => page,
  getTracker: () => tracker,
  clickAndVerify,
  resolveClickTarget,
  shortError,
};

const COMMANDS = {
  async launch(argPath) {
    if (browser) return console.log('already launched');
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const context = await browser.newContext({
      viewport: { width: 480, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    page = await context.newPage();
    tracker = trackRequests(page);
    page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
    });
    const targetPath = argPath ? argPath.trim() : START_PATH;
    await page.goto(`${BASE_URL}${targetPath}`);
    console.log('launched. at', page.url());
  },

  async viewport(args) {
    if (!page) return console.log('ERROR: launch first');
    const [w, h] = args.split(/\s+/).map(Number);
    if (!w || !h) return console.log('usage: viewport <width> <height>');
    await page.setViewportSize({ width: w, height: h });
    console.log('viewport ->', w, 'x', h);
  },

  async geom(sel) {
    if (!page) return console.log('ERROR: launch first');
    const rect = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const { x, y, width, height, top, right, bottom, left } = el.getBoundingClientRect();
      return { x, y, width, height, top, right, bottom, left };
    }, sel);
    console.log(rect === null ? `no match: ${sel}` : JSON.stringify(rect));
  },

  async nav(urlPath) {
    if (!page) return console.log('ERROR: launch first');
    await page.goto(`${BASE_URL}${urlPath}`);
    console.log('at', page.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, `${name || `ss-${Date.now()}`}.png`);
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      const moved = await clickAndVerify(page, tracker, () => page.click(sel, { timeout: 5000 }));
      console.log(moved ? `clicked ${sel}` : `clicked ${sel} — ${NO_EFFECT}`);
    } catch (e) {
      console.log('ERROR:', shortError(e));
    }
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const { el, error } = await resolveClickTarget(page, text);
    if (error) return console.log(`ERROR: click-text "${text}": ${error} — narrow the text or use click <css-sel>`);
    try {
      const moved = await clickAndVerify(page, tracker, () => el.click({ timeout: 5000 }));
      console.log(moved ? `clicked text: ${text}` : `clicked text: ${text} — ${NO_EFFECT}`);
    } catch (e) {
      console.log('ERROR:', shortError(e));
    } finally {
      await el.dispose();
    }
  },

  async fill(args) {
    if (!page) return console.log('ERROR: launch first');
    const sp = args.indexOf(' ');
    if (sp === -1) return console.log('usage: fill <css-sel> <value>');
    await page.fill(args.slice(0, sp), args.slice(sp + 1));
    console.log('filled', args.slice(0, sp));
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 20 });
  },

  async press(key) {
    if (page) await page.keyboard.press(key);
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(
      await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null),
    );
  },

  async quit() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    page = null;
  },

  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '));
  },
};

const customPath = path.resolve('.claude/driver-commands.mjs');
if (fs.existsSync(customPath)) {
  try {
    const mod = await import(pathToFileURL(customPath).href);
    const extra = typeof mod.createCommands === 'function' ? mod.createCommands(ctx) : mod.default;
    if (extra && typeof extra === 'object') Object.assign(COMMANDS, extra);
  } catch (e) {
    console.log('WARNING: failed to load .claude/driver-commands.mjs:', e.message);
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' });

async function execute(trimmed) {
  const sp = trimmed.indexOf(' ');
  const cmd = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const rest = sp === -1 ? '' : trimmed.slice(sp + 1);
  if (!cmd) return;
  const fn = COMMANDS[cmd];
  if (!fn) return console.log('unknown:', cmd, '— try: help');
  try {
    await fn(rest);
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

async function runLine(line) {
  let trimmed = line.trim();
  const tagged = trimmed.match(/^#(\w+) ?/);
  if (tagged) trimmed = trimmed.slice(tagged[0].length).trim();
  await execute(trimmed);
  if (tagged) console.log(`<<done ${tagged[1]}>>`);
  if (trimmed === 'quit') {
    rl.close();
    process.exit(0);
    return;
  }
  rl.prompt();
}

let queue = Promise.resolve();
rl.on('line', (line) => {
  queue = queue.then(() => runLine(line));
});
rl.on('close', () => {
  queue = queue.then(() => COMMANDS.quit()).then(() => process.exit(0));
});

console.log('browser driver — "help" for commands, "launch" to start');
rl.prompt();
