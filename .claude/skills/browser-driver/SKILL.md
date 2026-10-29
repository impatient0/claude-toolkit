---
name: browser-driver
description: Drive a web application in a real headless Chromium browser via a persistent Playwright REPL under tmux. Use when asked to start the dev server and verify a UI change end-to-end, take screenshots across viewports and themes, click around and inspect DOM/geometry, or check console/page errors before committing.
---

Drive any web app in a real headless Chromium browser via `.claude/skills/browser-driver/driver.mjs` (Playwright, no Xvfb needed since it renders in a browser tab) and `.claude/skills/browser-driver/send.sh`.

All paths below are relative to the repo root.

## Prerequisites

Playwright's Chromium needs `libasound.so.2`, which minimal containers often lack by default.
If `ldconfig -p | grep libasound.so.2` finds nothing and you don't have non-interactive root, extract the `.deb` locally without root:

```bash
mkdir -p /tmp/playwright-libasound && cd /tmp/playwright-libasound
apt-get download libasound2t64
dpkg -x libasound2t64*.deb .
cd - >/dev/null
```

Verify the Chromium binary is present:

```bash
ls ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null || echo "not installed yet — see Setup"
```

## Setup

```bash
npm install                        # playwright as a devDependency
npx playwright install chromium    # always required explicitly (~184MB, one-time)
```

## Run

**Check nobody else is driving first.** If parallel sessions run in worktrees, confirm the tmux session and port are free:

```bash
tmux has-session -t browser-driver 2>/dev/null && echo "driver session exists"
```

Start your app on a disposable port (e.g. `3910`) so you don't collide with a human's running `npm run dev` on port `3000`.
Then launch the driver under tmux and talk to it exclusively via `send.sh`:

```bash
tmux new-session -d -s browser-driver -x 200 -y 50
tmux send-keys -t browser-driver 'export LD_LIBRARY_PATH=/tmp/playwright-libasound/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH DRIVER_BASE_URL=http://localhost:3910 && node .claude/skills/browser-driver/driver.mjs' Enter
.claude/skills/browser-driver/send.sh --wait-ready

.claude/skills/browser-driver/send.sh launch 30
.claude/skills/browser-driver/send.sh 'ss 01-home'
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`).
Stop with:

```bash
.claude/skills/browser-driver/send.sh quit
tmux kill-session -t browser-driver
```

### Sending commands: `send.sh`

`send.sh '<driver command>' [timeout-seconds]` sends one command, waits until the driver has finished it, and prints only that command's output.
Use it for every command, in place of `tmux send-keys` followed by `sleep` and `capture-pane`: that pattern re-prints the scrollback on every call, which wastes most of a driving session's tokens.
The default timeout is 20 seconds; pass a larger one for slow commands (`launch 30`, a heavy `nav`).

- The driver tags each line `send.sh` sends with `#<id>` and answers with `<<done <id>>>` once the command has finished, so the cut is exact and there is no fixed sleep.
- Output longer than 80 lines is cut with a footer saying how many lines were left out; set `SEND_MAX_LINES` to change the limit, or narrow the command with a selector.
- `PAGEERROR:` and `CONSOLE ERROR:` lines the page printed since the previous command are included at the top of the next command's output, so an error is never lost between calls.
- `send.sh --wait-ready [timeout-seconds]` blocks until the driver shows its prompt.
- `DRIVER_SESSION` (or `PATIENT_DRIVER_SESSION`) selects a tmux session other than `browser-driver`.

### Built-in commands

| command | what it does |
|---|---|
| `launch [path]` | open headless Chromium, go to `<base-url><path>` (defaults to `DRIVER_START_PATH` or `/`) |
| `nav <path>` | go to `<base-url><path>` |
| `viewport <width> <height>` | resize the browser viewport (e.g. `viewport 1200 900`) — see Verifying a UI change |
| `geom <css-sel>` | print the first match's real `getBoundingClientRect()` as JSON — pairs with `viewport` |
| `click-text <text>` | click the one visible button, link, tab or label whose rendered text is `<text>` (else the one that contains it), ignoring case — see below |
| `click <css-sel>` | click by selector and verify page/network effect |
| `fill <css-sel> <value>` | fill an input |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css-sel>` | wait up to 10s for a selector |
| `eval <js-expr>` | evaluate in the page, prints JSON |
| `text [css-sel]` | print `innerText` (body if no selector) |
| `ss [name]` | screenshot → `/tmp/shots/<name>.png` |
| `quit` | close the browser, exit |

### Project-specific commands (`.claude/driver-commands.mjs`)

If `.claude/driver-commands.mjs` exists in the project root, `driver.mjs` imports it automatically and merges its exported ` createCommands(ctx)` into the REPL.
Use this to add app-specific shortcuts like `login`, `theme`, or domain actions without forking `.claude/skills/browser-driver/driver.mjs`.

### What a click reports

`click-text` matches interactive elements only, and a match has to be unique.
It looks for a visible `button`, `a[href]`, `label`, `summary` or ARIA button, link, tab, menu item, switch or checkbox whose whole text equals `<text>`, then, failing that, one whose text contains it.
If more than one qualifies it clicks nothing and lists the candidates, so narrow the text or use `click <css-sel>`.
It does not use Playwright's `text=` selector, which matches any element containing the words, first in page order: on a confirm panel that is the prompt paragraph in front of the button, and the click "succeeds" without doing anything.

After `click` and `click-text` the driver compares the page before and after (URL, DOM, form state, and whether a fetch or navigation started).
`clicked X` means something changed.
`clicked X — WARNING: ...` means the click landed on something that did nothing: check the page state (`text`, `eval`) before trusting it.
A click that Playwright cannot deliver (an element covering the target) is an `ERROR:` naming the element in the way.

`npm run check:browser-driver` runs the fixture tests for click resolution in a real Chromium.

## Verifying a UI change

**Required, not optional, for any change touching layout, positioning, or CSS**: a pass at a real desktop width, in addition to the driver's default 480px mobile width.
A `position: fixed` element's box-model math can coincidentally match its non-fixed parent's at 480px even when the two use different `box-sizing` or padding assumptions, diverging only once `max-width` starts constraining the column on a wider viewport.

1. Resize with `viewport <w> <h>` to a real desktop width, e.g. `viewport 1200 900`.
2. For anything with its own centering, alignment, or a hand-set gap/margin value, use `geom <sel>` to compare real `getBoundingClientRect()` numbers against whatever it's supposed to align with — don't eyeball it against a screenshot.
3. Repeat at a couple of widths spanning any breakpoint involved, not just one — a mismatch that's linear in viewport width can look fine at both ends and still be wrong in between.
4. Check [`CLAUDE.md`'s Testing Discipline](../../../CLAUDE.md#testing-discipline) and verify console/page errors are clean before calling the slice done.
