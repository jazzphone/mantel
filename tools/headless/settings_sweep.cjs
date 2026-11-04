'use strict';
// settings_sweep.py's browser half (phase 18, Part B): every page of HK Settings, at three sizes, in Chromium and WebKit.
// Reads one JSON request on stdin, writes each page's deep DOM text (shadow roots included) and a screenshot under
// request.out/<browser>/<size>/, and prints one JSON object on its last stdout line: {pages, crawled, errors, files}.
//
//   {origin, cookie, out, browsers: ["chromium","webkit"], sizes: ["1180x820",...], pages: ["/overview",...] | null,
//    limit: N | null, shots: true}
//
// `pages` null: the pages are CRAWLED (every `#/...` link a page offers, breadth first from the sidebar, in the first browser at the first
// size); a list: exactly those. The crawl is part of the proof: the page list of a tree must equal the other tree's.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pw = require(process.env.PLAYWRIGHT_PATH);
const req = JSON.parse(fs.readFileSync(0, 'utf8'));

// the page's deep DOM as text: tags with their attributes, text nodes, <style> as a hash, shadow roots under #shadow,
// the live value of a form control
const SERIALIZE = `(() => {
  const panel = document.querySelector('hk-settings-panel');
  if (!panel || !panel.shadowRoot) return null;
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const out = [];
  // (what a fictional house makes differently each time it is built: a person's id, the minute a sign-in ends, the server's port)
  const fix = (t) => String(t).replace(/\\b[0-9a-f]{32}\\b/g, '<id32>').replace(/\\b\\d{1,2}:\\d{2}(:\\d{2})?\\s?[AP]M\\b/g, '<time>').replace(/127\\.0\\.0\\.1:\\d+/g, '127.0.0.1:<port>');
  // (ids made from a counter that runs for the life of the page -- gh-401 -- by their order in this page's drawing instead)
  const ids = new Map();
  const norm = (v) => /^[a-z]+-\\d+$/.test(v) ? (ids.has(v) ? ids : ids.set(v, v.replace(/\\d+$/, '#' + (ids.size + 1)))).get(v) : v;
  const walk = (node, pad) => {
    if (node.nodeType === 3) { const t = fix(node.nodeValue.replace(/\\s+/g, ' ').trim()); if (t) out.push(pad + JSON.stringify(t)); return; }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      const tag = node.localName;
      if (tag === 'script') return;
      if (tag === 'style') { out.push(pad + '<style ' + node.textContent.length + ':' + hash(node.textContent) + '>'); return; }
      const attrs = [...node.attributes].map((a) => a.name + '=' + JSON.stringify(['id', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'for'].includes(a.name) ? norm(a.value) : fix(a.value))).sort().join(' ');
      let live = '';
      if ('value' in node && ['input', 'select', 'textarea'].includes(tag)) live += ' .value=' + JSON.stringify(fix(node.value));
      if ('checked' in node && tag === 'input') live += ' .checked=' + node.checked;
      out.push(pad + '<' + tag + (attrs ? ' ' + attrs : '') + live + '>');
      if (node.shadowRoot) { out.push(pad + '  #shadow'); for (const c of node.shadowRoot.childNodes) walk(c, pad + '    '); }
      for (const c of node.childNodes) walk(c, pad + '  ');
    } else for (const c of node.childNodes) walk(c, pad);
  };
  out.push('<hk-settings-panel ' + [...panel.attributes].map((a) => a.name + '=' + JSON.stringify(a.value)).sort().join(' ') + '>');
  walk(panel.shadowRoot, '  ');
  return out.join('\\n');
})()`;

const LINKS = `(() => {
  const panel = document.querySelector('hk-settings-panel');
  const out = new Set();
  const walk = (root) => {
    // (not a person's own page: its address holds an id that is new each time the house is built)
    for (const a of root.querySelectorAll('a[href^="#/"]')) if (!/[0-9a-f]{32}/.test(a.getAttribute('href'))) out.add(a.getAttribute('href').split('?')[0].replace(/^#/, ''));
    for (const e of root.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot);
  };
  if (panel && panel.shadowRoot) walk(panel.shadowRoot);
  return [...out];
})()`;

const slug = (p) => (p === '/' ? 'root' : p.replace(/^\//, '').replace(/[^A-Za-z0-9._-]+/g, '_')).slice(0, 150) || 'root';

async function open(browser, size) {
  const [w, h] = size.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: false, deviceScaleFactor: 1,
                                         reducedMotion: 'reduce', colorScheme: 'light' });
  await ctx.addCookies([{ name: 'mantel_session', value: req.cookie, url: req.origin }]);
  await ctx.route('**/*', (r) => new URL(r.request().url()).origin === req.origin ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(String(e.message).slice(0, 300)); });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(req.origin + '/settings#/overview');
  await page.waitForFunction(() => { const p = document.querySelector('hk-settings-panel'); return !!(p && p.ready && p.data); }, null, { timeout: 60000 });
  await page.waitForFunction(() => { const s = window.__hkSplitStarted || {}, d = window.__hkSplitDone || {}; return Object.keys(s).every((k) => d[k]); }, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  // (a row decides which of its words keeps its line by measuring them -- fitRow in hk-settings-kit.js -- so a page drawn before the
  // fonts were in can differ from one drawn after: every page is drawn after, and the first page is drawn once more)
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, errors, warm: async () => { await visit(page, '/check'); await visit(page, '/overview'); } };
}

// go to a page (a hash change inside the one loaded page) and wait until what it draws has stopped changing
async function visit(page, route) {
  await page.evaluate((r) => { location.hash = r; }, route);
  let last = null, same = 0;
  for (let i = 0; i < 80 && same < 4; i++) {
    await page.waitForTimeout(100);
    const now = await page.evaluate(SERIALIZE);
    if (now !== null && now === last) same++; else { same = 0; last = now; }
  }
  return last;
}

(async () => {
  const result = { pages: [], crawled: false, errors: {}, files: 0 };
  let pages = req.pages;
  const sizes = req.sizes;
  for (const bname of req.browsers) {
    const browser = await pw[bname].launch({ headless: true });
    try {
      for (let si = 0; si < sizes.length; si++) {
        const size = sizes[si];
        const { ctx, page, errors, warm } = await open(browser, size);
        await warm();
        const dir = path.join(req.out, bname, size);
        fs.mkdirSync(dir, { recursive: true });
        const keep = async (route, dom) => {
          fs.writeFileSync(path.join(dir, slug(route) + '.txt'), (dom === null ? '(no panel)' : dom) + '\n');
          // (a live preview is the dashboard itself, with its own sky and clock: masked, so a picture is the panel's)
          if (req.shots) await page.screenshot({ path: path.join(dir, slug(route) + '.png'), mask: [page.locator('iframe')] });
          result.files++;
        };
        if (!pages) {              // the crawl (the first browser at the first size): each page is kept as it is first visited
          const seen = new Set(), queue = ['/overview'];
          while (queue.length && (!req.limit || seen.size < req.limit)) {
            const route = queue.shift();
            if (seen.has(route)) continue;
            seen.add(route);
            await keep(route, await visit(page, route));
            for (const l of await page.evaluate(LINKS)) if (!seen.has(l) && !queue.includes(l)) queue.push(l);
          }
          pages = [...seen].sort();
          result.crawled = true;
        } else {
          for (const route of pages) await keep(route, await visit(page, route));
        }
        result.errors[bname + ' ' + size] = errors.slice(0, 20);
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
  result.pages = pages || [];
  console.log(JSON.stringify(result));
})().catch((err) => { console.error(String(err && err.stack || err)); process.exit(2); });
