// Optional per-project commands for `.claude/skills/browser-driver/driver.mjs`.
// Copy to `.claude/driver-commands.mjs` and customize for your app.

export function createCommands(ctx) {
  return {
    async login(args = '') {
      const page = ctx.getPage();
      if (!page) return console.log('ERROR: launch first');
      const sp = args.indexOf(' ');
      const username = sp === -1 ? process.env.TEST_USERNAME || 'admin' : args.slice(0, sp);
      const password = sp === -1 ? args || process.env.TEST_PASSWORD || '' : args.slice(sp + 1);
      await page.goto(`${ctx.baseUrl}/login`);
      await page.fill('#username', username);
      await page.fill('#password', password);
      await page.click('button[type="submit"]');
      console.log('login submitted, at', page.url());
    },

    async theme(mode) {
      const page = ctx.getPage();
      if (!page) return console.log('ERROR: launch first');
      await page.click(`[data-theme-choice="${mode}"]`);
      console.log('theme ->', mode);
    },
  };
}
