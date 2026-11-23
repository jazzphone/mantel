// house_twin.py's browser half: each screen's page at the tablet's size, one screenshot each (stdin: the spec as JSON).
const pw = require(process.env.PLAYWRIGHT_PATH);
const spec = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const browser = await pw[spec.engine].launch();
  const opts = { viewport: { width: spec.w, height: spec.h }, deviceScaleFactor: 2 };
  if (spec.screen) opts.screen = { width: spec.screen[0], height: spec.screen[1] };
  if (spec.mobile) {                        // Safari on an iPhone (a HomeView's Safari says the same): its user agent, touch
    Object.assign(opts, { hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1' });
    opts.isMobile = true;                   // the meta viewport honored, as Safari does
  }
  const ctx = await browser.newContext(opts);
  await ctx.addCookies([{ name: 'mantel_session', value: spec.cookie, url: spec.origin }]);
  if (spec.init) await ctx.addInitScript(spec.init);      // the features the house has, stood in on the page (home_grid_audit.feed_script)
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const s of spec.screens) {
    await page.goto(spec.origin + '/' + s + '/' + spec.path);
    await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);                 // pictures, fonts, the sky and the glass settle
    if (spec.js) {
      const got = await page.evaluate('(async () => { ' + spec.js + ' })()');
      // (--insets: one line a block, "UNEVEN" where top and bottom or left and right differ by more than 4 px, or the margins above and
      // below are wider than at the sides)
      if (Array.isArray(got) && got.every((x) => typeof x === 'string' && x.split(' ').length === 6)) {
        for (const line of got) {
          const [t, r, b, l] = line.split(' ')[5].split('/').map(Number), side = Math.min(l, r), vert = Math.min(t, b);
          const uneven = Math.abs(t - b) > 4 || Math.abs(l - r) > 4 || vert - side > 4;
          console.log('house_twin: ' + s + ' ' + (uneven ? 'UNEVEN ' : 'even   ') + line);
        }
      } else console.log('house_twin: js -> ' + JSON.stringify(got));
      await page.waitForTimeout(1200);
    }
    const file = spec.shots + '/' + s.replace(/[^\w-]+/g, '_') + '-' + spec.path.replace(/\W+/g, '_') + '-' + spec.engine + '-' + spec.w + 'x' + spec.h + (spec.tag ? '-' + spec.tag : '') + '.png';
    await page.screenshot({ path: file });
    console.log('house_twin: ' + file);
    for (const id of (spec.sheets || {})[s] || []) {        // each block's sheet (--sheets): opened as a tap opens it, shot, closed
      const ok = await page.evaluate((i) => { try { window.hkShell.moreInfo(i); return true; } catch (e) { return String(e); } }, id);
      await page.waitForTimeout(1600);
      const sf = spec.shots + '/' + s.replace(/[^\w-]+/g, '_') + '-sheet-' + id.replace(/[^\w-]+/g, '_') + '-' + spec.engine + '.png';
      await page.screenshot({ path: sf });
      console.log('house_twin: ' + (ok === true ? '' : 'sheet ' + id + ' ' + ok + ' ') + sf);
      await page.evaluate(() => { try { window.hkDetail && window.hkDetail.close(); } catch (e) {} });
      await page.waitForTimeout(600);
    }
  }
  if (errors.length) console.log('house_twin: page errors:\n  ' + [...new Set(errors)].slice(0, 8).join('\n  '));
  await browser.close();
})();
