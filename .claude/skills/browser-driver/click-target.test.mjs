// Real Chromium against small fixture pages. Not part of `npm test` (CI has no browser); run it
// with `npm run check:browser-driver`, with LD_LIBRARY_PATH set as SKILL.md's Prerequisites say.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { clickAndVerify, resolveClickTarget, shortError, trackRequests } from './click-target.mjs';

let browser;
let page;
let tracker;

before(async () => {
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  page = await (await browser.newContext()).newPage();
  tracker = trackRequests(page);
});
after(() => browser?.close());

async function tagOf(text) {
  const { el, error } = await resolveClickTarget(page, text);
  if (error) return error;
  const tag = await el.evaluate((e) => e.tagName);
  await el.dispose();
  return tag;
}

test('picks the button, not the paragraph that comes first and contains the same words', async () => {
  await page.setContent(`
    <p>Undo logging <strong>Daily mobility flow</strong>? Today's rounds are deleted.</p>
    <button>Cancel</button><button onclick="window.hit = (window.hit || 0) + 1">Undo</button>`);
  assert.equal(await tagOf('UNDO'), 'BUTTON');
  const { el } = await resolveClickTarget(page, 'UNDO');
  await el.click();
  assert.equal(await page.evaluate(() => window.hit), 1);
});

test('picks the button over a heading with the same text', async () => {
  await page.setContent('<h2>Create exercise</h2><button>Create exercise</button>');
  assert.equal(await tagOf('CREATE EXERCISE'), 'BUTTON');
});

test('matches the rendered text, so a CSS-uppercased label is found by what the agent saw', async () => {
  await page.setContent('<button style="text-transform:uppercase">Unlog this workout</button>');
  assert.equal(await tagOf('UNLOG THIS WORKOUT'), 'BUTTON');
  assert.equal(await tagOf('unlog this workout'), 'BUTTON');
});

test('falls back to containing text for a composite control, when that is unique', async () => {
  await page.setContent('<p>Daily mobility flow is on today</p><button>Daily mobility flow<br><small>Every day</small></button>');
  assert.equal(await tagOf('Daily mobility'), 'BUTTON');
});

test('a whole-text match wins over other controls that merely contain the text', async () => {
  await page.setContent('<button>Save</button><button>Save and close</button>');
  assert.equal(await tagOf('Save'), 'BUTTON');
});

test('two equally good matches are an error listing both, not a silent first-match pick', async () => {
  await page.setContent('<button>Archive</button><a href="#x">Archive</a>');
  const msg = await tagOf('Archive');
  assert.match(msg, /^2 whole text matches: <button> "archive"; <a> "archive"$/);
});

test('a long candidate list is cut after six, saying how many were left out', async () => {
  await page.setContent(Array.from({ length: 9 }, () => '<button>Item</button>').join(''));
  const msg = await tagOf('Item');
  assert.match(msg, /^9 whole text matches: (<button> "item"; ){5}<button> "item"; … and 3 more$/);
});

test('an element that is not visible, or has nothing interactive, does not match', async () => {
  await page.setContent('<p>Delete</p><button style="display:none">Delete</button>');
  assert.match(await tagOf('Delete'), /^no visible button/);
});

test('clickAndVerify: a DOM change is an effect', async () => {
  await page.setContent('<button onclick="this.textContent = \'done\'">go</button>');
  assert.equal(await clickAndVerify(page, tracker, () => page.click('button')), true);
});

test('clickAndVerify: a request with no DOM change is an effect', async () => {
  await page.route('**/ping', (r) => r.fulfill({ body: 'ok' }));
  await page.setContent('<button onclick="fetch(\'http://localhost/ping\')">go</button>');
  assert.equal(await clickAndVerify(page, tracker, () => page.click('button')), true);
});

test('clickAndVerify: a click that changes nothing and sends nothing is reported as no effect', async () => {
  await page.setContent('<p id=p>Undo logging</p>');
  assert.equal(await clickAndVerify(page, tracker, () => page.click('#p')), false);
});

test('shortError keeps the first line and the element that blocked the click', () => {
  const e = new Error(
    'page.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting\n  - <div class="x">…</div> intercepts pointer events\n  - retrying',
  );
  assert.equal(shortError(e), 'page.click: Timeout 5000ms exceeded. - <div class="x">…</div> intercepts pointer events');
});
