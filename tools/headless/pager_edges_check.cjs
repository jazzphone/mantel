'use strict';
// pager_edges_check.py's browser half: in WebKit, each look's screen at each size, the Lock block at rest and then held
// partway through a swipe; writes the two screenshots and prints one JSON line per look and size for the script to judge.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));

const FIND = () => {
  window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
  window.pagerOf = (id) => { const c = deep(document, '.cell[data-id="' + id + '"]')[0]; return c ? c.querySelector('hk-pager-card') : null; };
  // a finger: pointer events, pointerType touch, on what it went down on until it lifts (swipe_motion_check.cjs)
  window.__finger = {
    t: null,
    ev(type, x, y) { return new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: /up|cancel/.test(type) ? 0 : 1 }); },
    down(t, x, y) { this.t = t; t.dispatchEvent(this.ev('pointerdown', x, y)); },
    move(x, y) { this.t.dispatchEvent(this.ev('pointermove', x, y)); },
    up(x, y) { const t = this.t; this.t = null; t.dispatchEvent(this.ev('pointerup', x, y)); },
  };
};

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  try {
    for (const size of input.sizes) {
      const [W, H] = size.split('x').map(Number);
      for (const s of input.screens) {
        const tag = s.look + '-' + size;
        const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
        await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
        await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
        const page = await ctx.newPage();
        page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) console.log('FAIL ' + tag + ' page error: ' + e.message); });
        await page.goto(input.origin + '/' + s.screen + '/home');
        await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 60000 });
        await require('./grid_ready.cjs')(page);
        await page.evaluate(FIND);
        await page.waitForFunction(() => { const p = pagerOf('lock'); return !!(p && p._pages && p._pages.length === 2 && p._els && p._els[0]); }, null, { timeout: 45000 });
        // (the look's fonts, the plates' first draw, the shared frost: settled)
        await page.waitForTimeout(2500);
        const at = await page.evaluate(() => {
          const p = pagerOf('lock'), r = p.getBoundingClientRect();
          return { rect: { x: r.x, y: r.y, w: r.width, h: r.height },
                   gap: (parseFloat(getComputedStyle(p).getPropertyValue('--g-gap')) || 10) * (r.width / (p.offsetWidth || r.width)) };
        });
        await page.evaluate(() => { const p = pagerOf('lock'); p.scrollIntoView({ block: 'center' }); });
        await page.waitForTimeout(400);
        Object.assign(at, await page.evaluate(() => { const r = pagerOf('lock').getBoundingClientRect(); return { rect: { x: r.x, y: r.y, w: r.width, h: r.height } }; }));
        const rest = input.out + '/' + tag + '-rest.png', mid = input.out + '/' + tag + '-mid.png';
        await page.screenshot({ path: rest });
        // held partway: two fifths of a block to the left
        const x0 = at.rect.x + at.rect.w * 0.8, y0 = at.rect.y + at.rect.h * 0.45;
        await page.evaluate(([x, y]) => __finger.down(pagerOf('lock').shadowRoot.querySelector('.page'), x, y), [x0, y0]);
        for (let i = 1; i <= 12; i++) {
          await page.evaluate(([x, y]) => __finger.move(x, y), [x0 - at.rect.w * 0.4 * i / 12, y0]);
          await page.waitForTimeout(16);
        }
        await page.waitForTimeout(300);
        await page.screenshot({ path: mid });
        const held = await page.evaluate(() => {
          const p = pagerOf('lock'), q = p.shadowRoot.querySelector('.pager'), r = p.getBoundingClientRect();
          const out0 = p._slots[0], plate = deep(out0, 'hk-plate')[0];   // (the block's plate: the first in the page)
          const pr = out0.getBoundingClientRect();
          return { frame: getComputedStyle(p, '::before').content, clip: getComputedStyle(q.querySelector('.win') || q).overflowX,
                   whole: Math.abs(pr.width - r.width) < 1 && pr.right < r.right - 1 && !!plate && parseFloat(getComputedStyle(plate).borderTopLeftRadius) > 4 };
        });
        await page.evaluate(([x, y]) => __finger.up(x, y), [x0 - at.rect.w * 0.4, y0]);
        await page.waitForTimeout(1500);
        const after = await page.evaluate(() => {
          const p = pagerOf('lock'), q = p.shadowRoot.querySelector('.pager'), r = p.getBoundingClientRect(), pr = p._slots[1].getBoundingClientRect();
          return { rested: getComputedStyle(q.querySelector('.win') || q).overflowX, landed: p._index === 1 && Math.abs(pr.left - r.left) < 1 };
        });
        console.log(JSON.stringify({ look: s.look, size, rest, mid, rect: at.rect, gap: at.gap, state: Object.assign(held, after) }));
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL pager_edges_check: ' + (e && e.stack || e)); process.exit(1); });
