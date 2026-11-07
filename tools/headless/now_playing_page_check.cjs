// now_playing_page_check.py's browser: each size in turn, the Now Playing page on its own and beside a Side Pane, then
// Home's swipe right to it.
const assert = require('assert/strict');
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));

// measured on the page (a function, not a string: the page's CSP refuses those)
function measureSrc() {
  const card = (function find(r) {
    for (const e of r.querySelectorAll('*')) {
      if (e.localName === 'hk-now-playing-page-card') return e;
      if (e.shadowRoot) { const f = find(e.shadowRoot); if (f) return f; }
    }
    return null;
  })(document);
  if (!card || !card.shadowRoot) return null;
  const r = card.shadowRoot, box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const seen = (e) => e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none';
  const playerLook = PLAYER_LOOK;
  const corner = [...r.querySelectorAll('.ptl > *, .ptr > *')].filter(seen).map(box);
  const words = [...r.querySelectorAll('.mu .mroom, .mu .mtitle, .mu .mart, .mu .mprog, .mu .mctl, .mu .mvol')].filter(seen).map(box);
  return {
    card: box(card), vh: innerHeight, vw: innerWidth, title: (r.querySelector('.mu .mtitle') || {}).textContent || '',
    row: card.hasAttribute('murow'), up: card.hasAttribute('muup'), pane: card.hasAttribute('pane'),
    corner, cornerLeft: r.querySelectorAll('.ptl > *').length, cornerRight: r.querySelectorAll('.ptr > *').length,
    words, queue: [...r.querySelectorAll('.mu .mqr')].filter(seen).length,
    look: playerLook(r, { bar: '.mbar', pp: '.mpp svg', vol: '.mvt', buttons: '.mctl .mbtn' })
  };
}

// (player_look.js put into it here, in Node: the page takes the whole function from page.evaluate)
const measure = new Function('return ' + measureSrc.toString().replace('PLAYER_LOOK', '(' + require('./player_look.js').toString() + ')'))();

(async () => {
  const browser = await pw[input.engine].launch({ headless: true });
  try {
    for (const [W, H] of input.sizes || [[1180, 820], [1366, 1024], [1920, 1080], [820, 1180], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
      await context.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await context.route('**/*', (route) => new URL(route.request().url()).origin === input.origin ? route.continue() : route.abort());
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => { if (!/ResizeObserver loop|due to access control checks/.test(e.message)) errors.push(e.message); });
      const open = async (screen, view) => {
        await page.goto(`${input.origin}/${screen}/${view}?hkglass=blur`);
        await page.waitForFunction(() => window.__mantelReady === true);
      };
      const ready = async () => {
        await page.waitForFunction(() => !!customElements.get('hk-now-playing-page-card'), null, { timeout: 15000 });
        await page.waitForTimeout(3000);
        const m = await page.evaluate(measure);
        assert(m, 'no Now Playing page card');
        return m;
      };
      for (const screen of ['np-full', ...(W > H && W >= 1000 ? ['np-pane'] : [])]) {
        await open(screen, 'now-playing');
        const m = await ready();
        const tag = `${W}x${H} ${screen}`;
        // the song, under the corner, the whole page in the screen
        assert(m.title && m.title !== 'Not Playing', tag + ': the song shown ' + JSON.stringify(m.title));
        assert(m.cornerLeft >= 3 && m.cornerRight >= 1, tag + ': the corner (time, date, weather; status) ' + JSON.stringify(m));
        assert(m.card.b <= m.vh + 1 && m.card.h >= 300, tag + ': the page as tall as the screen leaves it ' + JSON.stringify(m.card));
        const low = Math.max(...m.corner.filter((c) => c.l < m.card.l + m.card.w / 2).map((c) => c.b));
        for (const w of m.words) {
          assert(w.b <= m.card.b + 1 && w.l >= m.card.l - 1 && w.r <= m.card.r + 1, tag + ': the music inside the page ' + JSON.stringify([w, m.card]));
          if (w.l < m.card.l + m.card.w / 2 && w.r > m.card.l) assert(w.t >= low - 1, tag + ': the music under the corner ' + JSON.stringify([w, low]));
        }
        assert(!m.look.wells.length && m.look.above !== undefined && Math.abs(m.look.above - m.look.below) <= 3, tag + ': the player bare, the pause halfway ' + JSON.stringify(m.look));
        if (screen === 'np-pane') {
          assert(m.pane && m.row, tag + ': beside the pane, the cover and the song side by side ' + JSON.stringify(m));
          assert(m.queue >= 1, tag + ': Up Next beside the cover ' + m.queue);
        }
        if (input.shots) await page.screenshot({ path: `${input.shots}/${W}x${H}-${screen}.png` });
        console.log(`PASS ${input.engine} ${tag}: the song under the corner, the player bare and even` + (screen === 'np-pane' ? ', Up Next beside the cover' : ''));
      }
      // SWIPE RIGHT ON HOME: Now Playing first, before Home; a finger's swipe right lands there
      if (W > H) {
        await open('np-full', 'home');
        await page.waitForTimeout(1500);
        const order = await page.evaluate(() => window.hkPageSwipe.order().map((it) => it.path));
        assert(/\/now-playing$/.test(order[0] || '') && /\/home$/.test(order[1] || ''), `${W}x${H}: Now Playing before Home ` + JSON.stringify(order.slice(0, 3)));
        // (a finger: pointer events, pointerType touch, on what is under the point -- page_swipe_check.cjs's)
        // (on one of Home's tiles, the leftmost, as page_swipe_check.cjs starts its swipes: inside the page's view)
        const at0 = await page.evaluate(() => {
          const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
          const all = deep(document, 'hk-favorite-card').map((e) => e.getBoundingClientRect()).filter((r) => r.width > 20 && r.top > 0 && r.bottom < innerHeight);
          all.sort((p, q) => p.left - q.left);
          return all.length ? { x: Math.max(40, (all[0].left + all[0].right) / 2), y: (all[0].top + all[0].bottom) / 2 } : { x: innerWidth * 0.2, y: innerHeight * 0.5 };
        });
        const y = Math.round(at0.y), x0 = Math.round(at0.x);
        await page.evaluate(() => {
          const deepAt = (x, y) => { let e = document.elementFromPoint(x, y); while (e && e.shadowRoot) { const n = e.shadowRoot.elementFromPoint(x, y); if (!n || n === e) break; e = n; } return e; };
          const ev = (type, x, y) => new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true,
                                                               clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 });
          window.__finger = { down(x, y) { this.t = deepAt(x, y); this.t.dispatchEvent(ev('pointerdown', x, y)); },
                              move(x, y) { this.t.dispatchEvent(ev('pointermove', x, y)); }, up(x, y) { this.t.dispatchEvent(ev('pointerup', x, y)); } };
        });
        await page.evaluate(([x, y]) => window.__finger.down(x, y), [x0, y]);
        for (let i = 1; i <= 14; i++) { await page.evaluate(([x, y]) => window.__finger.move(x, y), [Math.round(x0 + W * 0.04 * i), y]); await page.waitForTimeout(16); }
        await page.evaluate(([x, y]) => window.__finger.up(x, y), [Math.round(x0 + W * 0.56), y]);
        await page.waitForFunction(() => /\/now-playing$/.test(location.pathname), null, { timeout: 5000 }).catch(() => {});
        const at = await page.evaluate(() => location.pathname);
        if (!/\/now-playing$/.test(at)) console.log('swipe:', JSON.stringify(await page.evaluate(() => { const s = hkPageSwipe._.state(); const it = hkPageSwipe.order(); let nb = null; try { nb = hkPageSwipe._.neighbors(it, location.pathname, (x, p) => x.path === p); nb = nb && { prev: nb.prev && nb.prev.path, next: nb.next && nb.next.path }; } catch (e) { nb = String(e); } return { why: s.why, blocked: hkPageSwipe.blocked(), G: !!s.G, L: !!s.L, nb, order: it.map((i) => i.path).slice(0, 3) }; })));
        assert(/\/now-playing$/.test(at), `${W}x${H}: a swipe right on Home lands on Now Playing (at ${at})`);
        await ready();
        console.log(`PASS ${input.engine} ${W}x${H}: Swipe Right on Home goes to Now Playing`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('now_playing_page_check: passed');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
