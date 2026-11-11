'use strict';
// split_race_check.py's browser half: each page loaded as it is and with the part files held back, in each engine.
const path = require('path');
const pw = require(path.join(process.env.PLAYWRIGHT_PATH, 'index.js'));

const READY = {
  settings: () => { const p = document.querySelector('hk-settings-panel'); return !!(p && p.ready && p.data); },
  saver: () => !!(window.hkSaver),
};

// every hk-* tag in the page, shadow roots included, that is not a defined element
function undefinedTags() {
  const out = new Set();
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      const t = el.localName;
      if (t.startsWith('hk-') && !customElements.get(t)) out.add(t);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return [...out].sort();
}

function partsDone() {
  const s = window.__hkSplitStarted || {}, d = window.__hkSplitDone || {};
  return Object.keys(s).every((k) => d[k]);
}

// the control: a loader's promise goes nowhere, so nothing can wait for it
const NO_READY = `Object.defineProperty(window, '__hkSplitReady', { get() { return {}; }, set() {}, configurable: false });`;

async function one(browser, spec, key, url, delayed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'mantel_session', value: spec.cookie, url: spec.origin }]);
  if (spec.noReady) await ctx.addInitScript(NO_READY);
  const page = await ctx.newPage();
  const errors = [];
  const norm = (s) => String(s).replace(/\?[^ )'"]*/g, '?…').replace(/:\d+:\d+/g, '').slice(0, 200);
  page.on('pageerror', (e) => errors.push('pageerror: ' + norm(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + norm(m.text())); });
  if (delayed) {
    const re = new RegExp('/hk/(' + spec.folders.join('|') + ')/[^/?]+\\.js');
    await page.route((u) => re.test(u.pathname), async (route) => {
      await new Promise((r) => setTimeout(r, spec.delay));
      await route.continue();
    });
  }
  const out = { errors, drawn: false, undefined: [], shells: [] };
  try {
    await page.goto(spec.origin + url);
    const ready = READY[key];
    if (ready) await page.waitForFunction(ready, null, { timeout: 30000, polling: 20 });
    else await page.waitForFunction(() => window.__mantelMarks && window.__mantelMarks.rendered !== undefined, null, { timeout: 30000 });
    out.drawn = true;
    await page.waitForFunction(partsDone, null, { timeout: 30000, polling: 20 });
    await page.waitForTimeout(1500);
    out.undefined = await page.evaluate(undefinedTags);
    out.shells = await page.evaluate(() => Object.keys(window.__hkSplitStarted || {}).sort());
  } catch (e) {
    errors.push('load: ' + String(e.message || e).split('\n')[0].slice(0, 160));
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
      await one(browser, spec, key, url, false);            // the server warmed, not counted
      res[key + '-' + engine] = { plain: await one(browser, spec, key, url, false), delayed: await one(browser, spec, key, url, true) };
    }
    await browser.close();
  }
  process.stdout.write(JSON.stringify(res) + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
