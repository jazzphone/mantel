'use strict';
// first_load.py's browser half: each page loaded cold --runs times in each engine, a fresh context each time.
const path = require('path');
const pw = require(path.join(process.env.PLAYWRIGHT_PATH, 'index.js'));

const READY = {
  settings: () => { const p = document.querySelector('hk-settings-panel'); return !!(p && p.ready && p.data); },
  saver: () => !!(window.hkSaver),
};

function partsDone() {
  const s = window.__hkSplitStarted || {}, d = window.__hkSplitDone || {};
  return Object.keys(s).every((k) => d[k]);
}

async function one(browser, spec, key, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'mantel_session', value: spec.cookie, url: spec.origin }]);
  const page = await ctx.newPage();
  let requests = 0;
  const errors = [];
  page.on('request', () => { requests++; });
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  const out = { errors };
  try {
    await page.goto(spec.origin + url);
    const ready = READY[key];
    if (ready) {
      await page.waitForFunction(ready, null, { timeout: 20000, polling: 10 });
      out.draw_ms = await page.evaluate(() => Math.round(performance.now()));
    } else {
      await page.waitForFunction(() => window.__mantelMarks && window.__mantelMarks.rendered !== undefined, null, { timeout: 20000 });
      out.draw_ms = await page.evaluate(() => window.__mantelMarks.module_start + window.__mantelMarks.rendered);
    }
    await page.waitForFunction(partsDone, null, { timeout: 20000, polling: 10 });
    out.parts_ms = await page.evaluate(() => Math.round(performance.now()));
    out.requests = requests;
  } catch (e) {
    errors.push('load: ' + String(e.message || e).slice(0, 160));
  }
  await ctx.close();
  return out;
}

(async () => {
  let input = '';
  for await (const c of process.stdin) input += c;
  const spec = JSON.parse(input);
  const res = {};
  for (const engine of spec.engines) {
    const browser = await pw[engine].launch();
    for (const [key, url] of Object.entries(spec.pages)) {
      const loads = [];
      await one(browser, spec, key, url);                // a first load to warm the server, not counted
      for (let i = 0; i < spec.runs; i++) loads.push(await one(browser, spec, key, url));
      res[key + '-' + engine] = loads;
    }
    await browser.close();
  }
  process.stdout.write(JSON.stringify(res) + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
