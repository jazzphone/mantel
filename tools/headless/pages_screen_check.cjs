// pages_screen_check.py's browser half: the Pages screen in WebKit at a tablet's and a phone's sizes.
const assert = require('assert/strict');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));

// what the page shows: the card's icons, widgets, dots and pill, the tab bar, whether the page scrolls
function measure() {
  const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
  const card = deep(document, 'hk-pages-screen-card')[0];
  const sr = card && card.shadowRoot;
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const apps = sr ? [...sr.querySelectorAll('.screen[data-s="0"] .app')].map(a => Object.assign(box(a.querySelector('.ic')), { name: a.querySelector('.nm').textContent })) : [];
  const bar = document.getElementById('hk-tabbar'), bsr = bar && bar.shadowRoot, pill = bsr && bsr.querySelector('.root.on .pill');
  const se = document.scrollingElement;
  return {
    W: innerWidth, H: innerHeight, card: card ? box(card) : null, apps,
    cols: new Set(apps.map(a => Math.round(a.l))).size, rows: new Set(apps.map(a => Math.round(a.t))).size,
    widgets: sr ? [...sr.querySelectorAll('.wd')].map(w => Object.assign(box(w), { kind: w.getAttribute('data-kind') })) : [],
    screens: sr ? sr.querySelectorAll('.screen').length : 0,
    homePill: !!(sr && sr.querySelector('.pill')), folder: !!(sr && sr.querySelector('[data-folder]')),
    tabs: bsr ? [...bsr.querySelectorAll('.root.on .tab')].map(t => t.getAttribute('aria-label')) : [],
    barTop: pill ? pill.getBoundingClientRect().top : null,
    scrolls: se.scrollHeight > innerHeight + 1,
  };
}

// THE SIDE PANE'S SECTIONS, stood in (Phase A2 draws them): what a weather and a clock section give, as the
// mock-up's widget
function standIn() {
  window.hkSidePane = { section(kind, size) {
    const el = document.createElement('div');
    el.style.cssText = 'height:100%;box-sizing:border-box;padding:22px 24px;color:#fff;font-family:inherit;' +
      (kind === 'weather' ? 'background:linear-gradient(180deg,#4aa3ff,#1d6fe0)' : 'background:linear-gradient(180deg,#3a3a3c,#1c1c1e)');
    el.innerHTML = kind === 'weather'
      ? '<div style="font:600 22px/1.2 inherit">Home</div><div style="font-size:92px;font-weight:400;letter-spacing:-3px;line-height:1;margin-top:6px">54°</div>' +
        '<div style="position:absolute;left:24px;bottom:22px;font-weight:600;font-size:19px;line-height:1.35">Clear<br>H:62° L:48°</div>'
      : '<div style="font-size:15px;font-weight:600;opacity:.7">' + size.toUpperCase() + ' CLOCK</div><div style="font-size:48px;font-weight:500">8:42</div>';
    el.style.position = 'relative';
    return el;
  } };
}

const SIZES = [[1180, 820], [820, 1180], [390, 844]];
const CASES = [];
for (const [w, h] of SIZES) {
  CASES.push({ name: `${w}x${h}`, screen: input.screen, w, h, bar: false });
  CASES.push({ name: `${w}x${h}-bar`, screen: 'with-bar', w, h, bar: true });
  CASES.push({ name: `${w}x${h}-widgets`, screen: 'with-widgets', w, h, bar: false, widgets: true });
  CASES.push({ name: `${w}x${h}-widgets-bar`, screen: 'with-widgets-bar', w, h, bar: true, widgets: true });
}
const GRID = { '1180x820': [6, 3], '820x1180': [4, 5], '390x844': [4, 6] };

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  try {
    for (const c of CASES) {
      const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 2, hasTouch: true });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      if (c.widgets) await ctx.addInitScript(standIn);
      const page = await ctx.newPage();
      const errors = [];
      let phase = 'load';
      page.on('pageerror', e => errors.push(phase + ': ' + e.message));
      await page.goto(input.origin + '/' + c.screen + '/pages');
      try { await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 }); }
      catch (e) { throw new Error(c.name + ': the page never got ready (' + page.url() + '; errors ' + JSON.stringify(errors) + ')'); }
      await page.waitForFunction(() => {
        const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
        const card = deep(document, 'hk-pages-screen-card')[0];
        return !!(card && card.shadowRoot && card.shadowRoot.querySelector('.app'));
      }, null, { timeout: 20000 });
      await page.waitForTimeout(2000);            // the sky, the bar and the fonts settle
      phase = 'measured';
      const m = await page.evaluate(measure);
      const key = `${c.w}x${c.h}`, [cols, rows] = GRID[key];
      assert(m.apps.length >= 6, c.name + ' icons ' + m.apps.length);
      assert(m.folder, c.name + ': the Rooms folder');
      assert(m.cols <= cols && m.rows <= rows, c.name + ` grid ${m.cols} x ${m.rows}, want at most ${cols} x ${rows}`);
      if (!c.widgets && m.apps.length >= cols) assert.equal(m.cols, cols, c.name + ' columns');
      for (const a of m.apps) {
        assert(a.l >= 0 && a.r <= m.W && a.t >= 0 && a.b <= m.H, c.name + ' icon inside the window ' + JSON.stringify(a));
        if (m.barTop !== null) assert(a.b + 24 <= m.barTop, c.name + ' icon and its name clear of the tab bar ' + JSON.stringify(a) + ' bar ' + m.barTop);
      }
      assert(!m.scrolls, c.name + ': the page never scrolls');
      if (c.bar) {
        assert(!m.homePill, c.name + ': no Home pill beside the tab bar');
        assert.equal(m.tabs[0], 'Home'); assert.equal(m.tabs[1], 'Pages', c.name + ' tabs ' + m.tabs);
      } else {
        assert(m.homePill, c.name + ': the Home pill');
      }
      if (c.widgets) {
        const why = await page.evaluate(() => JSON.stringify(window.hkSettings.pagesScreen()));
        assert(m.widgets.length === 2 && m.widgets.some(w => w.kind === 'weather' && w.r > m.W * 0.6), c.name + ' widgets ' + JSON.stringify(m.widgets) + ' ' + why);
        for (const w of m.widgets) for (const a of m.apps) {
          const overlap = a.l < w.r && a.r > w.l && a.t < w.b && a.b > w.t;
          assert(!overlap, c.name + ' an icon under a widget ' + JSON.stringify([a, w]));
        }
      }
      if (input.shots) await page.screenshot({ path: path.join(input.shots, c.name + '.png') });
      // the folder opens and closes
      if (c.name === key) {
        await page.evaluate(() => {
          const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
          deep(document, 'hk-pages-screen-card')[0].shadowRoot.querySelector('[data-folder]').click();
        });
        await page.waitForTimeout(600);
        const opened = await page.evaluate(() => {
          const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
          const sr = deep(document, 'hk-pages-screen-card')[0].shadowRoot;
          return sr.querySelectorAll('.open .app').length;
        });
        assert(opened >= 4, c.name + ' the open folder\'s rooms ' + opened);
        if (input.shots) await page.screenshot({ path: path.join(input.shots, c.name + '-folder.png') });
        await page.evaluate(() => {
          const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
          deep(document, 'hk-pages-screen-card')[0].shadowRoot.querySelector('.open').click();
        });
        await page.waitForTimeout(300);
        phase = 'icon';
        // an icon opens its page; the pill goes Home
        // (Lights: opening Weather at 820 x 1180 logged a ResizeObserver loop from that page, 2026-10-30 --
        // not this one's to check)
        const first = m.apps.find(a => a.name === 'Lights') || m.apps[0];
        await page.mouse.click(first.l + first.w / 2, first.t + first.h / 2);
        await page.waitForTimeout(800);
        const went = await page.evaluate(() => location.pathname);
        assert(went !== '/' + c.screen + '/pages', c.name + ' a tap on ' + first.name + ' opened ' + went);
        phase = 'back';
        await page.goBack();
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
          const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
          deep(document, 'hk-pages-screen-card')[0].shadowRoot.querySelector('.pill').click();
        });
        await page.waitForTimeout(800);
        const home = await page.evaluate(() => location.pathname);
        assert(/\/(home|0)?$/.test(home), c.name + ' the pill went to ' + home);
      }
      assert.deepEqual(errors, [], c.name + ' page errors');
      console.log('PASS ' + c.name + `: ${m.apps.length} icons, ${m.cols} x ${m.rows}` + (m.widgets.length ? `, ${m.widgets.length} widgets` : '') +
                  (c.bar ? ', tabs ' + m.tabs.slice(0, 3).join(' / ') : ', Home pill'));
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
