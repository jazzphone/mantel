// side_strip_check.py's browser half: WebKit at the iPhone Duo's sizes, its strip stood in (--hk-safe-*).
const assert = require('assert/strict');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));

// what the page shows: the tab bar, the view and its room, the sky
function measure() {
  const host = document.getElementById('hk-tabbar'), sr = host && host.shadowRoot;
  const pill = sr && sr.querySelector('.pill'), pr = pill && pill.getBoundingClientRect();
  const view = document.querySelector('hk-view-container > hk-grid-view');
  const cs = getComputedStyle(view), root = view.shadowRoot.querySelector('#root');
  const kids = [...root.children].map(k => k.getBoundingClientRect()).filter(r => r.width > 0);
  const sky = document.getElementById('hk-sky'), sk = sky && sky.getBoundingClientRect();
  const more = sr && sr.querySelector('[data-sheet="more"]'), mr = more && more.getBoundingClientRect();
  return {
    W: innerWidth, H: innerHeight, strip: host && host.getAttribute('data-strip'), pos: host && host.getAttribute('data-pos'),
    rail: pr && { l: pr.left, r: pr.right, t: pr.top, b: pr.bottom },
    tabs: sr ? [...sr.querySelectorAll('.tab')].map(t => t.getAttribute('aria-label')) : [],
    padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight),
    left: Math.min(...kids.map(r => r.left)), right: Math.max(...kids.map(r => r.right)),
    sky: sk && { l: sk.left, w: sk.width },
    room: getComputedStyle(document.documentElement).getPropertyValue('--hk-tabbar-h').trim(),
    more: more && more.classList.contains('open') ? { l: mr.left, r: mr.right, t: mr.top, b: mr.bottom } : null,
  };
}

// THE DOCKED BAR (Now Playing / timers), found through the shadow roots: its box, its sheet and what is on it
function bar() {
  const deep = (r, sel) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(sel) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, sel) : [])]);
  const hkp = deep(document, '.hkp.dock')[0];
  if (!hkp) return null;
  const sheet = hkp.querySelector('.sheet'), sr = sheet.getBoundingClientRect();
  const R = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  // what is on the plate: the cards' boxes, then the art, the title and the controls inside the now-playing card
  const kids = [...sheet.children].filter(k => !k.hasAttribute('data-hk-glass-layer') && !k.classList.contains('x'));
  const np = deep(sheet, 'hk-now-playing-card')[0], inner = np && np.shadowRoot;
  const parts = inner ? ['.art', '.title', '.play', '.next', '.prev', '.brw', '.spk', '.meta'].map(q => inner.querySelector(q)).filter(e => e && e.getBoundingClientRect().width > 0) : [];
  const fill = ['::before', '::after'].map(q => { const c = getComputedStyle(sheet, q); return { w: parseFloat(c.width) || 0, bg: c.backgroundColor, content: c.content }; });
  const td = deep(sheet, 'hk-timer-strip-card')[0], tdr = td && td.shadowRoot && td.shadowRoot.querySelector('.sg');
  const tdp = deep(sheet, 'hk-timer-strip-card')[0];
  return { open: hkp.classList.contains('open'), fill, timer: tdr ? R(tdr) : null, timers: tdp ? R(tdp) : null, cls: hkp.className, box: R(hkp), sheet: R(sheet), kids: kids.map(R),
           content: parts.length ? Math.max(...parts.map(e => e.getBoundingClientRect().right)) : null,
           contentL: parts.length ? Math.min(...parts.map(e => e.getBoundingClientRect().left)) : null,
           pad: getComputedStyle(hkp).paddingRight, max: sheet.style.maxWidth };
}

function m0W(c) { return c.w; }

const CASES = [
  // the Duo folded: its outer display, the strip 84 at its right
  { name: 'outer', screen: input.screen, w: 466, h: 678, safe: { right: 84, bottom: 20 }, strip: true, reserve: 0.45, more: true },
  // the Duo open, held sideways: its inner display
  { name: 'inner', screen: input.screen, w: 1000, h: 703, safe: { right: 84, bottom: 20 }, strip: true, reserve: 0.35, more: true },
  // Use the Side Strip off (the screen's own)
  { name: 'off', screen: 'no-strip', w: 466, h: 678, safe: { right: 84, bottom: 20 }, strip: false },
  // a tablet with a right-hand rail of its own, no side inset: nothing of the strip's is drawn
  { name: 'rail', screen: 'rail', w: 1280, h: 800, safe: {}, strip: false, rail: 'right' },
  // a phone held sideways, its Dynamic Island at one side: 62 at both
  { name: 'turned', screen: input.screen, w: 874, h: 402, safe: { left: 62, right: 62, bottom: 21 }, strip: false },
];

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  try {
    for (const c of CASES) {
      const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 2, hasTouch: true });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      // the strip, stood in: the page reads its insets through these first (hk-base.js SAFE)
      // (a stylesheet of its own: the page writes <html>'s style attribute as it starts)
      await ctx.addInitScript(safe => {
        const css = ':root{' + Object.keys(safe).map(k => '--hk-safe-' + k + ':' + safe[k] + 'px').join(';') + '}';
        const put = () => {
          if (document.getElementById('hk-safe-stand-in') || !document.head) return !!document.head;
          const st = document.createElement('style');
          st.id = 'hk-safe-stand-in'; st.textContent = css;
          document.head.appendChild(st);
          return true;
        };
        if (!put()) document.addEventListener('DOMContentLoaded', put);
      }, c.safe);
      const page = await ctx.newPage();
      const errors = [];
      // (a ResizeObserver notice is the browser's, not a page fault)
      page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      await page.goto(input.origin + '/' + c.screen + '/home');
      await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
      await require('./grid_ready.cjs')(page);
      await page.waitForFunction(() => {
        const h = document.getElementById('hk-tabbar');
        return !!(h && h.shadowRoot && h.shadowRoot.querySelector('.root.on') && document.getElementById('hk-sky'));
      }, null, { timeout: 20000 });
      await page.waitForTimeout(2500);            // the sky, the cards and the fonts settle
      // THE DOCKED BAR: the fictional house's living room is playing, so the Now Playing bar comes up by itself
      let b = null;
      for (let i = 0; i < 40 && !(b && b.open); i++) { b = await page.evaluate(bar); if (!(b && b.open)) await page.waitForTimeout(500); }
      await page.waitForTimeout(800);
      b = await page.evaluate(bar);
      if (input.shots) await page.screenshot({ path: path.join(input.shots, c.name + '-bar.png') });
      assert(b && b.open, c.name + ' the docked bar did not come up');
      assert(b.sheet.l <= 0.5 && b.sheet.r >= m0W(c) - 0.5, c.name + ' the bar spans the screen ' + JSON.stringify(b.sheet));
      assert(b.content !== null && b.content <= c.w - (c.safe.right || 0) + 0.5 && b.contentL >= (c.safe.left || 0) - 0.5,
             c.name + ' the bar\'s content clear of the side areas ' + JSON.stringify(b));
      for (const k of b.kids.filter(k => k.w > 0)) {
        assert(k.r <= c.w - (c.safe.right || 0) + 0.5 && k.l >= (c.safe.left || 0) - 0.5, c.name + ' a card on the bar ' + JSON.stringify(k));
      }
      if (b.timer) assert(b.timer.r <= c.w - (c.safe.right || 0) + 0.5, c.name + ' the timers clear ' + JSON.stringify(b.timer));
      // the plate under the safe areas: the bar's own colour, as wide as the inset
      assert(Math.abs(b.fill[1].w - (c.safe.right ? c.safe.right + 1 : 0)) < 0.5 && Math.abs(b.fill[0].w - (c.safe.left ? c.safe.left + 1 : 0)) < 0.5,
             c.name + ' the plate under the side areas ' + JSON.stringify(b.fill));
      assert(b.fill[1].w === 0 || b.fill[1].bg === 'rgb(22, 23, 26)', c.name + ' plate colour ' + JSON.stringify(b.fill));
      const m = await page.evaluate(measure);
      const R = c.safe.right || 0, L = c.safe.left || 0;
      // the sky under everything, the strip included
      assert(m.sky && m.sky.l <= 0 && m.sky.w >= m.W, c.name + ' sky ' + JSON.stringify(m.sky));
      // the page's content clear of the side safe areas
      assert(m.padR === R && m.padL === L, c.name + ' view padding ' + JSON.stringify(m));
      assert(m.right <= m.W - R + 0.5 && m.left >= L - 0.5, c.name + ' content inside ' + JSON.stringify(m));
      if (c.strip) {
        assert.equal(m.strip, 'right', c.name + ' strip');
        assert.equal(m.pos, 'right');
        assert(m.rail.l >= m.W - R - 0.5 && m.rail.r <= m.W + 0.5 - 6, c.name + ' rail in the strip ' + JSON.stringify(m.rail));
        assert(m.rail.t >= m.H * c.reserve - 0.5, c.name + ' rail below the reserve ' + JSON.stringify(m.rail));
        assert(m.rail.b <= (b ? b.sheet.t : m.H - 16) + 0.5 && m.rail.b >= (b ? b.sheet.t : m.H) - 40, c.name + ' rail on the foot ' + JSON.stringify(m.rail));
        assert(m.tabs[0] === 'Home' && m.tabs[m.tabs.length - 1] === 'More' && m.tabs.length >= 3, c.name + ' tabs ' + m.tabs);
        assert.equal(m.room, '', c.name + ': no room at the foot for a bar');
      } else if (c.rail) {
        // a rail of the tablet's own: the docked bar is the whole width, under the rail's column, the rail above it
        assert(!m.strip && m.pos === c.rail, c.name + ' the rail ' + JSON.stringify(m));
        assert(m.rail.b <= b.sheet.t + 0.5, c.name + ' the rail above the bar ' + JSON.stringify([m.rail, b.sheet]));
        assert(b.sheet.l === 0 && b.sheet.r === c.w && b.kids.filter(k => k.w > 0).every(k => k.l === 0 && k.r === c.w),
               c.name + ' the bar as it was ' + JSON.stringify(b));
      } else {
        assert(!m.strip && m.pos === 'bottom', c.name + ' the bar ' + JSON.stringify(m));
        assert(m.rail.r <= m.W - R - 21 + 0.5 && m.rail.l >= L + 21 - 0.5, c.name + ' bar inside ' + JSON.stringify(m.rail));
        assert(m.room !== '', c.name + ': room at the foot for the bar');
      }
      if (input.shots) await page.screenshot({ path: path.join(input.shots, c.name + '.png') });
      if (c.more) {
        await page.evaluate(() => document.getElementById('hk-tabbar').shadowRoot.querySelector('.tab[data-t="more"]').click());
        await page.waitForTimeout(600);
        const mm = await page.evaluate(measure);
        assert(mm.more && mm.more.r <= mm.W - R - 8 + 0.5 && mm.more.l >= -0.5 && mm.more.b <= mm.H - 16 + 0.5,
               c.name + ' More beside the strip ' + JSON.stringify(mm.more));
        if (input.shots) await page.screenshot({ path: path.join(input.shots, c.name + '-more.png') });
      }
      assert.deepEqual(errors, [], c.name + ' page errors');
      console.log('PASS ' + c.name + ' (' + c.w + 'x' + c.h + '): ' + (c.strip ? 'rail in the strip, ' + m.tabs.join(' / ') : 'bar at ' + m.pos) +
                  '; content ' + Math.round(m.left) + '-' + Math.round(m.right) + ' of ' + m.W);
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
