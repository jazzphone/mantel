// page_swipe_check.py's browser half: one engine at one size per run. Chromium's finger is CDP's
// (Input.dispatchTouchEvent), WebKit's pointer events with pointerType touch at the element under the point.
const assert = require('assert/strict');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const [W, H] = input.size.split('x').map(Number);
const FINGER = input.engine === 'chromium';
const TABLET = Math.min(W, H) >= 640;
// what each home supplies itself (the licensed font and glyphs): asked for, never served here
const HOMES_OWN = /\/hk\/(fonts\/SF-Pro\.(woff2|ttf)|iconset\/hk-glyphs\.js)$/;

// in the page: deep lookups, the page's state, a spot to swipe on
const HELP = () => {
  const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
  const deepAt = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
    return el;
  };
  const chain = (el) => { const out = []; while (el) { out.push(el); el = el.parentNode || el.host || null; } return out; };
  const view = () => hkShell.view(hkShell.viewSlot(hkCards.menu.panel()));
  window.__ps = {
    deep, deepAt,
    view,
    order: () => hkPageSwipe.order().map(i => ({ path: i.path, title: i.title })),
    where: () => location.pathname,
    // the tab with the highlight, and where its highlight is drawn (a transform: none at rest)
    here: () => {
      const sr = document.getElementById('hk-tabbar') && document.getElementById('hk-tabbar').shadowRoot;
      const t = sr && sr.querySelector('.tab.here');
      if (!t) return null;
      const m = new DOMMatrix(getComputedStyle(t, '::before').transform);
      return { label: t.getAttribute('aria-label'), x: m.m41, y: m.m42, sx: m.a, sy: m.d, pos: document.getElementById('hk-tabbar').getAttribute('data-pos') };
    },
    scrolled: () => Math.max(window.scrollY || 0, document.scrollingElement ? document.scrollingElement.scrollTop : 0, document.body.scrollTop || 0),
    tall: () => Math.max(document.scrollingElement.scrollHeight, document.body.scrollHeight) > innerHeight + 60,
    slotKids: () => { const v = view(); return v && v.parentNode ? [...v.parentNode.children].filter(k => k.localName !== 'div' || k.className === 'hk-swipe-ghost').length : 0; },
    ghost: () => !!document.querySelector('.hk-swipe-ghost') || deep(document, '.hk-swipe-ghost').length > 0,
    touchAction: () => getComputedStyle(view()).touchAction,
    // a point on the page whose element is the page's to swipe (not a control, not off the page), at xf of the width
    spot: (xf) => {
      const v = view();
      for (const dx of [0, 0.12, -0.12, 0.2, -0.2]) for (let yf = 0.3; yf <= 0.8; yf += 0.04) {
        const x = Math.round(innerWidth * (xf + dx)), y = Math.round(innerHeight * yf);
        const el = deepAt(x, y), c = chain(el);
        if (!el || c.indexOf(v) < 0 || hkDrag.sideways(c, v)) continue;
        // (not a pager, a view out of sight, or a header's chips that lie over the grid's cells)
        if (c.some(n => n.localName === 'hk-pager-card' || n.localName === 'hk-header-card' || (n.getAttribute && n.getAttribute('inert') !== null))) continue;
        return { x, y, at: el.localName + '.' + el.className };
      }
      return null;
    },
    // the first visible element matching sel, in the page shown (a view that is not inert)
    find: (sel, test) => {
      for (const e of deep(document, sel)) {
        const r = e.getBoundingClientRect();
        if (r.width < 20 || r.height < 12 || r.right < 30 || r.left > innerWidth - 30 || r.bottom < 20 || r.top > innerHeight - 20) continue;
        if (chain(e).some(n => n.getAttribute && n.getAttribute('inert') !== null)) continue;
        if (test && !test(e)) continue;
        return { tag: e.localName + '.' + e.className, l: r.left, r: r.right, t: r.top, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
      }
      return null;
    },
    grid: () => { const v = view(); return v && v.localName === 'hk-home-grid-view' ? v._view || 0 : null; },
    menuOpen: () => !!(window.hkMenu && hkMenu.isOpen && hkMenu.isOpen()),
    // why a swipe did nothing
    diag: () => { const s = hkPageSwipe._.state(); return { why: s.why, blocked: hkPageSwipe.blocked(), landing: !!s.L, gesture: s.G ? (s.G.live ? 'live' : 'waiting') : null, path: location.pathname }; },
  };
  // WebKit's finger: pointer events, pointerType touch, on what is under the point (each touch the target's own
  // until it ends, as a browser sends them)
  window.__finger = {
    t: null,
    ev(type, x, y) {
      return new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true,
                                      clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 });
    },
    down(x, y) { this.t = window.__ps.deepAt(x, y); this.t.dispatchEvent(this.ev('pointerdown', x, y)); },
    move(x, y) { if (this.t) this.t.dispatchEvent(this.ev('pointermove', x, y)); },
    up(x, y) {
      if (!this.t) return;
      const t = this.t; this.t = null;
      // (no click: a browser sends none after a finger that travelled)
      t.dispatchEvent(this.ev('pointerup', x, y));
    },
  };
};

async function open(browser, screen) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: false });
  await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
  await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push('page error: ' + e.message); });
  page.on('console', m => {
    const url = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && !HOMES_OWN.test(url) && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text() + ' ' + url);
  });
  await page.goto(input.origin + '/' + screen + '/home');
  await page.waitForFunction(() => window.__mantelReady === true && window.hkPageSwipe && window.hkDrag && window.hkTabBar &&
                                   window.hkTabBar.pages && window.hkShell.view(window.hkShell.viewSlot(window.hkCards.menu.panel())),
                             null, { timeout: 30000 });
  await require('./grid_ready.cjs')(page);
  await page.evaluate(HELP);
  await page.waitForTimeout(2500);           // the cards, the fonts and the tab bar settle
  return { ctx, page, errors, cdp: null };
}
async function close(t, name) {
  assert.deepEqual(t.errors, [], name + ': no page or console errors');
  await t.ctx.close();
}
async function touch(t, type, x, y) {
  if (!t.cdp) t.cdp = await t.ctx.newCDPSession(t.page);
  await t.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
}
// a swipe from a to b; at `mid` (0..1 of the way) the finger rests while mid(t) looks
async function swipe(t, a, b, o = {}) {
  const steps = o.steps || 14, p = t.page, ms = o.ms || 16;
  const at = i => ({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps });
  if (FINGER) await touch(t, 'touchStart', a.x, a.y); else await p.evaluate(([x, y]) => __finger.down(x, y), [a.x, a.y]);
  for (let i = 1; i <= steps; i++) {
    const q = at(i);
    if (FINGER) await touch(t, 'touchMove', q.x, q.y); else await p.evaluate(([x, y]) => __finger.move(x, y), [q.x, q.y]);
    await p.waitForTimeout(ms);
    if (o.mid && i === Math.round(steps * (o.midAt || 0.4))) { if (!o.quick) await p.waitForTimeout(120); await o.mid(); }
  }
  if (FINGER) await touch(t, 'touchEnd'); else await p.evaluate(([x, y]) => __finger.up(x, y), [b.x, b.y]);
  await p.waitForTimeout(o.settle || 900);
}
const ps = (t, fn, arg) => t.page.evaluate(([f, a]) => window.__ps[f](a), [fn, arg]);
async function landed(t, want) {
  await t.page.waitForFunction(w => location.pathname === w, want, { timeout: 8000 }).catch(() => {});
  await t.page.waitForTimeout(700);
  return ps(t, 'where');
}
async function shot(t, name) {
  if (input.shots) await t.page.screenshot({ path: path.join(input.shots, input.engine + '-' + input.size + '-' + name + '.png') });
}
function sameTab(h, title, name) {
  assert(h && h.label === title, name + ': the highlight on ' + title + ', not ' + JSON.stringify(h));
  assert(Math.abs(h.x) < 0.5 && Math.abs(h.y) < 0.5 && Math.abs(h.sx - 1) < 0.01, name + ': the highlight at rest ' + JSON.stringify(h));
}
const left = (s) => ({ a: s, b: { x: s.x - W * 0.45, y: s.y + 4 } });
const right = (s) => ({ a: s, b: { x: s.x + W * 0.45, y: s.y + 4 } });

async function bar(browser) {
  const t = await open(browser, 'ps-bar'), order = await ps(t, 'order');
  assert(order.length >= 3, 'bar: the tabs\' pages ' + JSON.stringify(order));
  sameTab(await ps(t, 'here'), order[0].title, 'bar at Home');
  assert.equal(await ps(t, 'touchAction'), 'pan-y pinch-zoom', 'bar: the page says pan-y');
  // on a tile: Home's favorites, the rightmost
  const fav = await t.page.evaluate(() => {
    const all = __ps.deep(document, 'hk-favorite-card').map(e => e.getBoundingClientRect()).filter(r => r.width > 20 && r.top > 0 && r.bottom < innerHeight);
    all.sort((p, q) => q.left - p.left);
    return all.length ? { x: Math.min((all[0].left + all[0].right) / 2, innerWidth - 40), y: (all[0].top + all[0].bottom) / 2 } : null;
  }) || await ps(t, 'spot', 0.7);
  assert(fav, 'bar: a tile to swipe on');
  let mid = null;
  const s1 = left(fav);
  await swipe(t, s1.a, s1.b, { mid: async () => { mid = { kids: await ps(t, 'slotKids'), here: await ps(t, 'here') }; await shot(t, 'bar-mid'); } });
  assert(mid.kids >= 2, 'bar: the next page beside it mid-swipe ' + JSON.stringify(mid));
  assert(mid.here && (mid.here.x > 2 || mid.here.y > 2), 'bar: the highlight on its way mid-swipe ' + JSON.stringify(mid.here));
  assert.equal(await landed(t, order[1].path), order[1].path, 'bar: a swipe on a tile turns the page');
  sameTab(await ps(t, 'here'), order[1].title, 'bar after the swipe');
  await shot(t, 'bar-after');
  // back: Home is held by the view host, so it slides in as itself
  const s2 = await ps(t, 'spot', 0.3);
  assert(s2, 'bar: a spot on ' + order[1].title);
  let back = null;
  const r2 = right(s2);
  await swipe(t, r2.a, r2.b, { mid: async () => { back = { ghost: await ps(t, 'ghost'), kids: await ps(t, 'slotKids') }; } });
  assert(back.kids >= 2 && !back.ghost, 'bar: Home slides in as itself ' + JSON.stringify([back, s2, await ps(t, 'diag')]));
  assert.equal(await landed(t, order[0].path), order[0].path, 'bar: and back');
  sameTab(await ps(t, 'here'), order[0].title, 'bar back at Home');
  // the scenes row scrolls sideways: its own
  const row = await t.page.evaluate(() => {
    for (const c of __ps.deep(document, 'hk-scenes-card')) {
      const sc = [c, ...__ps.deep(c.shadowRoot || c, '*')].find(e => e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX));
      if (!sc) continue;
      sc.scrollIntoView({ block: 'center' });
      const r = sc.getBoundingClientRect();
      return { x: Math.min(r.right - 40, innerWidth - 50), y: (r.top + r.bottom) / 2, scrolls: true };
    }
    return null;
  });
  assert(row && row.scrolls, 'bar: the scenes row scrolls sideways here');
  await t.page.waitForTimeout(400);
  const rr = left(row);
  rr.b.x = Math.max(40, rr.b.x);
  await swipe(t, rr.a, rr.b);
  assert.equal(await ps(t, 'where'), order[0].path, 'bar: a swipe on the scenes row is the row\'s');
  // up and down still scrolls (a finger: the browser's own scroll)
  await t.page.evaluate(() => window.scrollTo(0, 0));
  if (FINGER && await ps(t, 'tall')) {
    const sp = await ps(t, 'spot', 0.5);
    await swipe(t, { x: sp.x, y: H * 0.75 }, { x: sp.x + 6, y: H * 0.3 }, { steps: 10 });
    assert((await ps(t, 'scrolled')) > 40, 'bar: an up-and-down swipe still scrolls the page');
    assert.equal(await ps(t, 'where'), order[0].path, 'bar: ...and turns nothing');
  }
  await close(t, 'bar');
  return order[1].title;
}

async function grid(browser) {
  const t = await open(browser, 'ps-grid'), order = await ps(t, 'order');
  assert.equal(await ps(t, 'grid'), 0, 'grid: on its first view');
  await shot(t, 'grid');
  // a block that swipes its pages (the rooms)
  const pager = await ps(t, 'find', 'hk-pager-card');
  assert(pager, 'grid: a pager block');
  const pg = await t.page.evaluate(() => __ps.deep(document, 'hk-pager-card').filter(p => (p._pages || []).length > 1).map(p => {
    const r = p.getBoundingClientRect(); return { x: r.right - Math.min(30, r.width / 4), y: (r.top + r.bottom) / 2, w: r.width };
  }).filter(p => p.x > 40 && p.x < innerWidth - 40)[0]);
  assert(pg, 'grid: a pager block with pages');
  await swipe(t, pg, { x: Math.max(30, pg.x - pg.w * 0.7), y: pg.y + 2 });
  assert(await ps(t, 'where') === order[0].path && await ps(t, 'grid') === 0, 'grid: a swipe on a pager block is the block\'s');
  // a slider, a ring or a control that drags
  const sl = await ps(t, 'find', 'input[type="range"],[role="slider"],.ring,[data-hk-control]');
  if (sl) {
    await swipe(t, { x: sl.cx, y: sl.cy }, { x: Math.max(30, sl.cx - W * 0.3), y: sl.cy + 2 });
    const after = [await ps(t, 'where'), await ps(t, 'grid')];
    assert(after[0] === order[0].path && after[1] === 0, 'grid: a swipe on a slider is the slider\'s ' + JSON.stringify([sl, after]));
  } else console.log('  (grid: no slider on screen at this size)');
  // a tile: the views first
  const s = await ps(t, 'spot', 0.62);
  assert(s, 'grid: a spot on a tile');
  const g1 = left(s);
  await swipe(t, g1.a, g1.b);
  assert(await ps(t, 'where') === order[0].path && await ps(t, 'grid') === 1, 'grid: a swipe turns its views first ' + JSON.stringify([s, await ps(t, 'grid'), await ps(t, 'diag')]));
  const s2 = await ps(t, 'spot', 0.62) || s;
  const g2 = left(s2);
  await swipe(t, g2.a, g2.b, { mid: () => shot(t, 'grid-past-mid') });
  assert.equal(await landed(t, order[1].path), order[1].path, 'grid: past its last view, on to the next page');
  sameTab(await ps(t, 'here'), order[1].title, 'grid: the next page\'s tab');
  const s3 = await ps(t, 'spot', 0.3);
  const g3 = right(s3);
  await swipe(t, g3.a, g3.b);
  assert.equal(await landed(t, order[0].path), order[0].path, 'grid: and back');
  assert.equal(await ps(t, 'grid'), 1, 'grid: back from the next page lands on the last view');
  await shot(t, 'grid-back');
  await close(t, 'grid');
}

async function rail(browser) {
  const t = await open(browser, 'ps-rail'), order = await ps(t, 'order');
  const h0 = await ps(t, 'here');
  assert(h0 && h0.pos === 'left', 'rail: the bar is a rail ' + JSON.stringify(h0));
  const s = await ps(t, 'spot', 0.7);
  let mid = null;
  const r1 = left(s);
  await swipe(t, r1.a, r1.b, { mid: async () => { mid = await ps(t, 'here'); await shot(t, 'rail-mid'); } });
  assert(mid && mid.y > 2 && Math.abs(mid.x) < 0.5, 'rail: the highlight follows down the rail ' + JSON.stringify(mid));
  assert.equal(await landed(t, order[1].path), order[1].path, 'rail: the page turns');
  sameTab(await ps(t, 'here'), order[1].title, 'rail after');
  await close(t, 'rail');
}

async function menu(browser) {
  const t = await open(browser, 'ps-menu'), order = await ps(t, 'order');
  assert(order.length >= 2 && !(await t.page.evaluate(() => hkTabBar._.state().on)), 'menu: no tab bar, the menu\'s order ' + JSON.stringify(order));
  const y = Math.round(H * 0.55);
  if (FINGER) await swipe(t, { x: 8, y }, { x: Math.min(W * 0.6, 340), y: y + 6 }, { steps: 12 });
  else {
    await t.page.mouse.move(8, y); await t.page.mouse.down();
    for (let i = 1; i <= 12; i++) { await t.page.mouse.move(8 + (Math.min(W * 0.6, 340) - 8) * i / 12, y + i / 2); await t.page.waitForTimeout(16); }
    await t.page.mouse.up(); await t.page.waitForTimeout(900);
  }
  assert(await ps(t, 'menuOpen'), 'menu: a swipe from the left 24 px opens the menu');
  assert.equal(await ps(t, 'where'), order[0].path, 'menu: ...and turns no page');
  await shot(t, 'menu-open');
  await t.page.evaluate(() => hkMenu.close(true));
  await t.page.waitForTimeout(700);
  const s = await ps(t, 'spot', 0.7);
  const m1 = left(s);
  await swipe(t, m1.a, m1.b);
  assert.equal(await landed(t, order[1].path), order[1].path, 'menu: with no tab bar, On: the menu\'s next page');
  await close(t, 'menu');
}

async function off(browser) {
  const t = await open(browser, 'ps-off'), order = await ps(t, 'order');
  assert.notEqual(await ps(t, 'touchAction'), 'pan-y pinch-zoom', 'off: the page keeps its own pan');
  const s = await ps(t, 'spot', 0.7);
  const o1 = left(s);
  await swipe(t, o1.a, o1.b);
  assert.equal(await ps(t, 'where'), order[0].path, 'off: Swipe Between Pages Off turns nothing');
  await close(t, 'off');
}

// THE KITCHEN TABLET (2026-11-02, the owner's video: "swiping between pages should be really smooth and really fun"):
// on the Calendar the Now Playing bar came up and every swipe after it was refused -- the Calendar's months turned
// instead -- and the bar came up there only the first time
async function kitchen(browser) {
  const t = await open(browser, 'ps-kitchen'), order = await ps(t, 'order'), paths = order.map(o => o.path);
  const at = (p) => paths.findIndex(x => /\/(pages|calendar)$/.test(x) && x.endsWith('/' + p));
  assert(at('pages') === 1 && at('calendar') === 2 && paths.length >= 4, 'kitchen: Home, Pages, Calendar and on ' + JSON.stringify(paths));
  // (the bar up: its address, and its docked sheet open on the screen)
  const bar = () => t.page.evaluate(() => ({ hash: location.hash, open: __ps.deep(document, '.hkp.dock.open').length }));
  const barUp = () => t.page.waitForFunction(() => location.hash === '#media' && __ps.deep(document, '.hkp.dock.open').length > 0, null, { timeout: 8000 })
    .then(() => true, () => false);
  const month = () => t.page.evaluate(() => { const c = __ps.deep(document, 'hk-calendar-card').find(e => e.isConnected && e._day); return c ? c._day.getFullYear() * 12 + c._day.getMonth() : null; });
  const go = async (dir, want, name, o) => {
    const s = await ps(t, 'spot', 0.3);
    assert(s, 'kitchen: a spot to swipe on (' + name + ')');
    const sw = dir < 0 ? left(s) : right(s);
    await swipe(t, sw.a, sw.b, o);
    assert.equal(await landed(t, want), want, 'kitchen: ' + name + ' ' + JSON.stringify([await ps(t, 'diag'), await bar()]));
  };
  await go(-1, paths[1], 'Home to the Pages screen');
  await go(-1, paths[2], 'the Pages screen to the Calendar');
  assert(await barUp(), 'kitchen: the Now Playing bar comes up on the Calendar ' + JSON.stringify(await bar()));
  await shot(t, 'kitchen-calendar-bar');
  const m0 = await month();
  assert(m0 !== null, 'kitchen: the Calendar\'s month');
  // the finger's own element drawn away mid-swipe (the Calendar draws itself again as the bar makes room): still a swipe
  await t.page.evaluate(() => { window.__victim = null; });
  const s3 = await ps(t, 'spot', 0.3), sw3 = left(s3);
  await t.page.evaluate(([x, y]) => { window.__victim = __ps.deepAt(x, y); }, [s3.x, s3.y]);
  await swipe(t, sw3.a, sw3.b, { mid: () => t.page.evaluate(() => { if (window.__victim) window.__victim.remove(); }) });
  assert.equal(await landed(t, paths[3]), paths[3], 'kitchen: a swipe on the Calendar, under the bar, its element drawn away, turns the page ' +
               JSON.stringify([await ps(t, 'diag'), await bar()]));
  await go(1, paths[2], 'back to the Calendar');
  assert.equal(await month(), m0, 'kitchen: the swipes turned pages, not the Calendar\'s month');
  assert(await barUp(), 'kitchen: back on the Calendar, the bar is up again ' + JSON.stringify(await bar()));
  // a quick short flick: 13% of the width in five quick moves (short of a fifth: its speed turns it)
  const s5 = await ps(t, 'spot', 0.3);
  await swipe(t, s5, { x: s5.x + W * 0.13, y: s5.y + 2 }, { steps: 5, ms: 8 });
  assert.equal(await landed(t, paths[1]), paths[1], 'kitchen: a quick short flick turns the page ' + JSON.stringify(await ps(t, 'diag')));
  await close(t, 'kitchen');
}

(async () => {
  const browser = await pw[input.engine].launch({ headless: true, ...(input.engine === 'chromium' ? { executablePath: input.chrome } : {}) });
  let failed = 0;
  const run = async (name, fn) => {
    try { const said = await fn(browser); console.log('PASS ' + input.engine + ' ' + input.size + ' ' + name + (said ? ' (' + said + ')' : '')); }
    catch (e) { failed++; console.log('FAIL ' + input.engine + ' ' + input.size + ' ' + name + ': ' + (e && e.message)); }
  };
  try {
    await run('bar', bar);
    await run('grid', grid);
    if (TABLET && W > H) await run('rail', rail);
    if (TABLET && W > H) await run('kitchen', kitchen);
    await run('menu', menu);
    await run('off', off);
  } finally { await browser.close(); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
