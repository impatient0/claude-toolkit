// Click resolution and effect-checking for driver.mjs, kept apart so the fixture test can load it
// without starting the REPL.
//
// Why not Playwright's `text=` selector: it is a case-insensitive *substring* match that takes the
// first hit in DOM order, and that hit is often not the control.

const INTERACTIVE = [
  'button',
  'a[href]',
  '[role=button]',
  '[role=link]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=switch]',
  '[role=checkbox]',
  'summary',
  'label',
  'input[type=submit]',
  'input[type=button]',
].join(',');

// Resolves to one visible interactive element, or says why not. Two tiers, each needing a unique
// hit: the element's whole text equals `text`, else it contains it. Both ignore case and
// whitespace and read the rendered text, so a CSS-uppercased label matches what the agent saw.
export async function resolveClickTarget(page, text) {
  const handle = await page.evaluateHandle(
    ({ text, INTERACTIVE }) => {
      const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
      const want = norm(text);
      const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const cands = [...document.querySelectorAll(INTERACTIVE)]
        .filter(visible)
        .map((el) => ({ el, label: norm(el.innerText || el.getAttribute('aria-label') || el.value || '') }));
      const describe = (c) => `<${c.el.tagName.toLowerCase()}> "${c.label.slice(0, 60)}"`;
      for (const [tier, test] of [
        ['whole text', (c) => c.label === want],
        ['containing text', (c) => c.label.includes(want)],
      ]) {
        const hits = cands.filter(test);
        if (hits.length === 1) return hits[0].el;
        if (hits.length > 1) {
          const more = hits.length > 6 ? `; … and ${hits.length - 6} more` : '';
          return { error: `${hits.length} ${tier} matches: ${hits.slice(0, 6).map(describe).join('; ')}${more}` };
        }
      }
      return { error: 'no visible button, link, tab or label with that text' };
    },
    { text, INTERACTIVE },
  );
  const el = handle.asElement();
  if (el) return { el };
  const { error } = await handle.jsonValue();
  await handle.dispose();
  return { error };
}

// Whatever a click should change if it worked: the URL, the DOM, form control state.
export async function pageSignature(page) {
  try {
    return await page.evaluate(() => {
      const controls = [...document.querySelectorAll('input,textarea,select')]
        .map((e) => (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value))
        .join(',');
      const s = `${document.body.innerHTML}|${controls}`;
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return `${location.href}|${s.length}|${h}`;
    });
  } catch {
    return `navigating|${Date.now()}`;
  }
}

// Playwright errors carry a 40-line call log; the first line and the element that intercepted
// the pointer are the two things worth reading.
export function shortError(e) {
  const lines = e.message.split('\n');
  const blocker = lines.filter((l) => /intercepts pointer events/.test(l)).pop();
  return blocker ? `${lines[0]} ${blocker.trim()}` : lines[0];
}

// Runs `doClick`, then reports whether anything happened: a request started, or the URL/DOM/form
// state moved. Waits briefly for a first sign, and once there is one lets it finish (requests in
// flight, DOM still moving) so the next command reads a settled page.
export async function clickAndVerify(page, tracker, doClick) {
  const before = { sig: await pageSignature(page), seen: tracker.seen };
  await doClick();
  const changed = async () => tracker.seen > before.seen || (await pageSignature(page)) !== before.sig;
  const start = Date.now();
  let moved = false;
  while (!moved && Date.now() - start < 600) {
    await page.waitForTimeout(50);
    moved = await changed();
  }
  if (moved) {
    let last = await pageSignature(page);
    let quietSince = Date.now();
    const settleStart = Date.now();
    while (Date.now() - settleStart < 2000) {
      await page.waitForTimeout(50);
      const now = await pageSignature(page);
      if (now !== last || tracker.inflight > 0) {
        last = now;
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= 150) break;
    }
  }
  return moved;
}

// Counts the requests a click can cause (navigation, fetch, XHR) so "nothing was sent" is
// observable even when the response leaves the DOM unchanged.
export function trackRequests(page) {
  const tracker = { seen: 0, inflight: 0 };
  const counted = (r) => ['document', 'fetch', 'xhr'].includes(r.resourceType());
  page.on('request', (r) => {
    if (counted(r)) {
      tracker.seen++;
      tracker.inflight++;
    }
  });
  const done = (r) => {
    if (counted(r)) tracker.inflight = Math.max(0, tracker.inflight - 1);
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return tracker;
}
