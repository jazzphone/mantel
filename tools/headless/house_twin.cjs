// house_twin.py's browser half: each screen's page at the tablet's size, one screenshot each (stdin: the spec as JSON).
const pw = require(process.env.PLAYWRIGHT_PATH);
const spec = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const browser = await pw[spec.engine].launch();
  const ctx = await browser.newContext({ viewport: { width: spec.w, height: spec.h }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'mantel_session', value: spec.cookie, url: spec.origin }]);
  if (spec.init) await ctx.addInitScript(spec.init);      // the features the house has, stood in on the page (home_grid_audit.feed_script)
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const s of spec.screens) {
    await page.goto(spec.origin + '/' + s + '/' + spec.path);
    await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);                 // pictures, fonts, the sky and the glass settle
    if (spec.js) { console.log('house_twin: js -> ' + JSON.stringify(await page.evaluate('(async () => { ' + spec.js + ' })()'))); await page.waitForTimeout(1200); }
    const file = spec.shots + '/' + s + '-' + spec.path.replace(/\W+/g, '_') + '-' + spec.engine + '-' + spec.w + 'x' + spec.h + (spec.tag ? '-' + spec.tag : '') + '.png';
    await page.screenshot({ path: file });
    console.log('house_twin: ' + file);
  }
  if (errors.length) console.log('house_twin: page errors:\n  ' + [...new Set(errors)].slice(0, 8).join('\n  '));
  await browser.close();
})();
