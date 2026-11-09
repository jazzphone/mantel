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
  const bar = document.getElementById('hk-tabbar'), tabs = bar && bar.shadowRoot && bar.shadowRoot.querySelector('.bar');
  const corner = [...r.querySelectorAll('.ptl > *, .ptr > *')].filter(seen).map(box);
  const words = [...r.querySelectorAll('.mu .mroom, .mu .mtitle, .mu .martist, .mu .mart, .mu .mprog, .mu .mctl, .mu .mvol')].filter(seen).map(box);
  return {
    card: box(card), tabs: box(tabs), vh: innerHeight, vw: innerWidth, title: (r.querySelector('.mu .mtitle') || {}).textContent || '',
    art: window.hkNowArt, skyArt: document.getElementById('hk-sky') && document.getElementById('hk-sky').style.getPropertyValue('--artO'),
    row: card.hasAttribute('murow'), up: card.hasAttribute('muup'), pane: card.hasAttribute('pane'),
    corner, cornerLeft: r.querySelectorAll('.ptl > *').length, cornerRight: r.querySelectorAll('.ptr > *').length,
    words, queue: [...r.querySelectorAll('.mu .mqr')].filter(seen).length,
    look: playerLook(r, { bar: '.mbar', pp: '.mpp svg', vol: '.mvt', buttons: '.mctl .mbtn' }),
    // THE TOUCH RULES, MEASURED (hk-np-strip.js check; 2026-11-09, the owner: a tap meant for play landed on the volume)
    strip: window.hkNpStrip.check(r.querySelector('.mu .hks'), { min: 44, line: r.querySelector('.mu .hksl') }),
    // (the ends since the owner's mockup 12h, 2026-11-09: Browse at the left, Up Next at the right)
    ends: [...r.querySelectorAll('.mu .hks .mctl > [data-act]')].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden').map((e) => e.getAttribute('data-act')),
    // THE THREE MARGINS (2026-11-09, the owner: the art's gap to the right edge as the column's to the left, and between them
    // the same): the column's to the left edge, the art's (or, beside the pane, the bars') to the right, the gap between
    margins: ((r) => { const q = s => r.querySelector(s), R = e => e.getBoundingClientRect(), body = R(q('.mu .mbody')), art = R(q('.mu .mart')), bar = R(q('.mu .mbar'));
      const st = q('.mu .mstage'), row = !!(st && getComputedStyle(st).display === 'grid'), k = (n) => Math.round(n * 10) / 10;
      if (row) return { row: true, left: k(art.left - body.left), right: k(body.right - bar.right), gap: k(R(q('.mu .mmeta')).left - art.right) };
      const col = R(q('.mu .mcol')); return { left: k(col.left - body.left), right: k(body.right - art.right), gap: k(art.left - col.right) }; })(r)
  };
}

// (player_look.js put into it here, in Node: the page takes the whole function from page.evaluate)
const measure = new Function('return ' + measureSrc.toString().replace('PLAYER_LOOK', '(' + require('./player_look.js').toString() + ')'))();

(async () => {
  const browser = await pw[input.engine].launch({ headless: true });
  try {
    for (const [W, H] of input.sizes || [[1180, 820], [1280, 800], [1366, 1024], [1920, 1080], [820, 1180], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: false });
      await context.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await context.route('**/*', (route) => new URL(route.request().url()).origin === input.origin ? route.continue() : route.abort());
      const page = await context.newPage(), errors = [];
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('BROWSER:', m.text()); });
      page.on('pageerror', (e) => { if (!/ResizeObserver loop|due to access control checks/.test(e.message)) errors.push(e.message); });
      const open = async (screen, view) => {
        await page.goto(`${input.origin}/${screen}/${view}?hkglass=blur`);
        await page.waitForFunction(() => window.__mantelReady === true);
        await require('./grid_ready.cjs')(page);
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
        assert(m.art && Number(m.skyArt) > 0, tag + ': the cover supplies the page background ' + JSON.stringify([m.art, m.skyArt]));
        assert(m.cornerLeft >= 3 && m.cornerRight >= 1, tag + ': the corner (time, date, weather; status) ' + JSON.stringify(m));
        assert(m.card.b <= m.vh + 1 && m.card.h >= 300, tag + ': the page as tall as the screen leaves it ' + JSON.stringify(m.card));
        if (m.tabs && m.tabs.t > m.vh / 2) assert(m.card.b <= m.tabs.t, tag + ': the music clears the tab bar ' + JSON.stringify([m.card, m.tabs]));
        const low = Math.max(...m.corner.filter((c) => c.l < m.card.l + m.card.w / 2).map((c) => c.b));
        for (const w of m.words) {
          assert(w.b <= m.card.b + 1 && w.l >= m.card.l - 1 && w.r <= m.card.r + 1, tag + ': the music inside the page ' + JSON.stringify([w, m.card]));
          if (w.l < m.card.l + m.card.w / 2 && w.r > m.card.l) assert(w.t >= low - 1, tag + ': the music under the corner ' + JSON.stringify([w, low]));
        }
        assert(!m.look.wells.length && m.look.above !== undefined && Math.abs(m.look.above - m.look.below) <= 3, tag + ': the player bare, the pause halfway ' + JSON.stringify(m.look));
        assert(!m.strip.breaks.length && m.strip.gapTV >= 12 && m.strip.gapPT >= 12 && m.strip.gapL >= 12 && m.strip.targets.line[1] >= 43.5, tag + ': 44 px targets (the speaker line\'s too), nothing overlapping, 12 px clear round the keys and the line ' + JSON.stringify(m.strip));
        assert.deepEqual([m.ends[0], m.ends[m.ends.length - 1]], ['brw', 'queue'], tag + ': Browse at the row\'s left end, Up Next at its right ' + JSON.stringify(m.ends));
        if (!m.up) assert(Math.abs(m.margins.left - m.margins.right) <= 1 && Math.abs(m.margins.gap - m.margins.left) <= 1, tag + ': one margin left, right and between ' + JSON.stringify(m.margins));
        if (screen === 'np-pane') {
          assert(m.pane && m.row, tag + ': beside the pane, the cover and the song side by side ' + JSON.stringify(m));
          assert(m.queue >= 1, tag + ': Up Next beside the cover ' + m.queue);
        }
        const ink = await require('./corner_look.cjs')(page, 'hk-now-playing-page-card:visible .ptl', input.python);
        const xs = ink.map(r=>r.left);
        assert(xs.length === 3 && xs.every(x=>x!==null) && Math.max(...xs)-Math.min(...xs)<=(ink.some(r=>parseFloat(r.font)<14)?2:1), tag+': corner ink aligned '+JSON.stringify(ink));
        assert(!m.look.volumeEdges || m.look.volumeEdges.every(x=>Math.abs(x)<=1), tag+': volume row ends aligned '+JSON.stringify(m.look));
        if (input.shots) await page.screenshot({ path: `${input.shots}/${W}x${H}-${screen}.png` });
        console.log(`PASS ${input.engine} ${tag}: the song under the corner, the player bare and even` + (screen === 'np-pane' ? ', Up Next beside the cover' : '') +
                    ` (targets ${JSON.stringify(m.strip.targets)}, keys to volume ${m.strip.gapTV} px, progress to keys ${m.strip.gapPT} px, the speaker line to a control ${m.strip.gapL} px; margins ${JSON.stringify(m.margins)})`);
        const card = page.locator('hk-now-playing-page-card:visible');
        // (the speaker line opens the speakers, as the Speakers key it replaced did; Browse and Up Next their tabs)
        for (const [sel, tab] of [['.mu .hksl', 'speakers'], ['.mu .hks .mbtn[data-act="brw"]', 'browse'], ['.mu .hks .mbtn[data-act="queue"]', 'queue']]) {
          await card.locator(sel).tap();
          await card.locator(`.mpanel.up [data-p="${tab}"]:not([hidden])`).waitFor({ state: 'visible' });
          await page.waitForTimeout(700);
          const pb = await card.locator('.mpanel.up').boundingBox();
          assert(pb && pb.x >= m.card.l - 1 && pb.x + pb.width <= m.card.r + 1 && pb.y >= m.card.t - 1 && pb.y + pb.height <= m.card.b + 1, tag + ': the music panel stays inside the page ' + JSON.stringify(pb));
          if (input.shots && tab === 'speakers') await page.screenshot({ path: `${input.shots}/${W}x${H}-${screen}-speakers.png` });
          await card.locator('.mpanel.up [data-k="close"]').tap();
          await card.locator('.mpanel').waitFor({ state: 'detached' });
        }

      }
      // SWIPE RIGHT ON HOME: Now Playing first, before Home; a finger's swipe right lands there
      {
        await open('np-full', 'home');
        await page.waitForTimeout(1500);
        const order = await page.evaluate(() => window.hkPageSwipe.order().map((it) => it.path));
        assert(/\/now-playing$/.test(order[0] || '') && /\/home$/.test(order[1] || ''), `${W}x${H}: Now Playing before Home ` + JSON.stringify(order.slice(0, 3)));
        // (a finger: pointer events, pointerType touch, on what is under the point -- page_swipe_check.cjs's)
        // (on one of Home's tiles, the leftmost, as page_swipe_check.cjs starts its swipes: inside the page's view)
        const spot = async (right) => page.evaluate((right) => {
          const view = hkShell.view(hkShell.viewSlot(hkCards.menu.panel()));
          const chain = (e) => { const c = []; while (e) { c.push(e); e = e.parentNode || e.host; } return c; };
          for (const xf of (right ? [0.25, 0.37, 0.45] : [0.75, 0.63, 0.55])) for (let yf = 0.3; yf <= 0.8; yf += 0.04) {
            const x = Math.round(innerWidth * xf), y = Math.round(innerHeight * yf);
            let e = document.elementFromPoint(x, y);
            while (e && e.shadowRoot) { const n = e.shadowRoot.elementFromPoint(x, y); if (!n || n === e) break; e = n; }
            const c = chain(e);
            if (e && c.includes(view) && !hkDrag.sideways(c, view) && !c.some(n => n.localName === 'hk-pager-card' || n.localName === 'hk-header-card' || (n.hasAttribute && n.hasAttribute('inert')))) return { x, y };
          }
          return null;
        }, right);
        const at0 = await spot(true);
        assert(at0, 'a spot on the active page to swipe');
        const y = Math.round(at0.y), x0 = Math.round(at0.x);
        await page.evaluate(() => {
          const deepAt = (x, y) => { let e = document.elementFromPoint(x, y); while (e && e.shadowRoot) { const n = e.shadowRoot.elementFromPoint(x, y); if (!n || n === e) break; e = n; } return e; };
          const ev = (type, x, y) => new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true,
                                                               clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 });
          window.__finger = { down(x, y) { this.t = deepAt(x, y); this.t.dispatchEvent(ev('pointerdown', x, y)); },
                              move(x, y) { this.t.dispatchEvent(ev('pointermove', x, y)); }, up(x, y) { this.t.dispatchEvent(ev('pointerup', x, y)); } };
        });
        const cdp = input.engine === 'chromium' ? await context.newCDPSession(page) : null;
        const finger = async (type, x, y) => {
          if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type], touchPoints: type === 'up' ? [] : [{ x, y }] });
          else await page.evaluate(([type, x, y]) => window.__finger[type](x, y), [type, x, y]);
        };
        const swipe = async (p, dir) => {
          await finger('down', p.x, p.y);
          for (let i = 1; i <= 14; i++) { await finger('move', Math.round(p.x + dir * W * 0.035 * i), p.y); await page.waitForTimeout(16); }
          await finger('up', Math.round(p.x + dir * W * 0.49), p.y);
        };
        await swipe({ x: x0, y }, 1);
        await page.waitForFunction(() => /\/now-playing$/.test(location.pathname), null, { timeout: 5000 }).catch(() => {});
        const at = await page.evaluate(() => location.pathname);
        if (!/\/now-playing$/.test(at)) console.log('swipe:', JSON.stringify(await page.evaluate(() => { const s = hkPageSwipe._.state(); const it = hkPageSwipe.order(); let nb = null; try { nb = hkPageSwipe._.neighbors(it, location.pathname, (x, p) => x.path === p); nb = nb && { prev: nb.prev && nb.prev.path, next: nb.next && nb.next.path }; } catch (e) { nb = String(e); } return { why: s.why, blocked: hkPageSwipe.blocked(), G: !!s.G, L: !!s.L, nb, order: it.map((i) => i.path).slice(0, 3) }; })));
        assert(/\/now-playing$/.test(at), `${W}x${H}: a swipe right on Home lands on Now Playing (at ${at})`);
        await ready();
        const back = await spot(false);
        assert(back, 'a spot on Now Playing to swipe back');
        await swipe(back, -1);
        await page.waitForFunction(() => /\/home$/.test(location.pathname), null, { timeout: 8000 });
        console.log(`PASS ${input.engine} ${W}x${H}: Home swipes to Now Playing and back`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('now_playing_page_check: passed');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
