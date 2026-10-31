// saver_shows_check.py's browser half: each screen's screensaver, started as the house starts it, and its face.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok ? '' : '  got ' + JSON.stringify(got))); };
  try {
    for (const [screen, want] of Object.entries(input.shows)) {
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      await page.goto(input.origin + '/' + screen + '/home');
      await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
      await page.waitForTimeout(2000);
      const started = await page.evaluate(() => !!(window.hkSaver && window.hkSaver.preview && (window.hkSaver.preview(true), true)));
      await page.waitForTimeout(4000);
      const got = await page.evaluate(() => {
        const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
        const host = document.querySelector('hk-screensaver') || deep(document, '[ckface],[fcbig]')[0] ||
          [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
        return host ? { face: host.getAttribute('ckface'), big: host.hasAttribute('fcbig') } : null;
      });
      const ok = !!got && (want === 'big' ? got.big : want ? got.face === want : !got.face && !got.big);
      say(started && ok, screen + ': the screensaver draws ' + (want || 'the classic forecast'), got);
      say(!errors.length, screen + ': no page errors', errors.slice(0, 3));
      if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '.png' });
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? 'FAIL: ' + fails : 'saver shows: all checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
