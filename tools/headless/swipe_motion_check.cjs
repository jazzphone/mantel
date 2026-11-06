// swipe_motion_check.py's browser half: one engine at one size per run.
const assert = require('assert/strict');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const [W, H] = input.size.split('x').map(Number);
const CDP = input.engine === 'chromium';
const HOMES_OWN = /\/hk\/(fonts\/SF-Pro\.(woff2|ttf)|iconset\/hk-glyphs\.js)$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// IN THE PAGE: each frame, where everything in the slot is drawn, and where the finger is
const PROBE = () => {
  const deep = (r, s, out = []) => { for (const e of r.querySelectorAll('*')) { if (e.matches(s)) out.push(e); if (e.shadowRoot) deep(e.shadowRoot, s, out); } return out; };
  const deepAt = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
    return el;
  };
  const chain = (el) => { const out = []; while (el) { out.push(el); el = el.parentNode || el.host || null; } return out; };
  const slot = () => hkShell.viewSlot(hkCards.menu.panel());
  const view = () => hkShell.view(slot());
  const ids = new WeakMap(); let nextId = 1;
  const idOf = (el) => { if (!ids.has(el)) ids.set(el, nextId++); return ids.get(el); };
  const pagesOf = () => [...slot().children].filter(k => k.localName !== 'div' || /hk-swipe-ghost/.test(k.className));
  // what a page shows within the window: text, pictures, drawings
  const inSight = (root) => {
    let n = 0;
    const walk = (r) => {
      for (const e of r.children) {
        if (e.shadowRoot) walk(e.shadowRoot);
        if (e.children.length) { walk(e); continue; }
        if (!(e.textContent.trim() || /^(img|svg|canvas|path)$/.test(e.localName))) continue;
        const b = e.getBoundingClientRect();
        if (b.width && b.height && b.right > 0 && b.left < innerWidth && b.bottom > 0 && b.top < innerHeight) n++;
      }
    };
    if (root.shadowRoot) walk(root.shadowRoot);
    walk(root);
    return n;
  };
  const L = window.__m = {
    deep, deepAt, chain, slot, view, idOf, pagesOf, inSight, frames: [], on: false, finger: 0,
    start() {
      L.frames = []; L.on = true;
      const tick = (t) => {
        if (!L.on) return;
        const s = hkPageSwipe._.state();
        L.frames.push({ t, now: performance.now(), finger: L.finger, st: (s.G && s.G.live ? 'G' : '') + (s.A ? 'A' : '') + (s.L ? 'L' : ''), path: location.pathname,
                        pages: pagesOf().map(k => ({ id: idOf(k), ghost: k.classList.contains('hk-swipe-ghost'), x: k.getBoundingClientRect().left, o: +getComputedStyle(k).opacity, cur: k === view() })) });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    stop() { L.on = false; return L.frames; },
    spot(xf) {
      const v = view();
      for (const dx of [0, 0.12, -0.12, 0.2, -0.2]) for (let yf = 0.3; yf <= 0.8; yf += 0.04) {
        const x = Math.round(innerWidth * (xf + dx)), y = Math.round(innerHeight * yf), el = deepAt(x, y), c = chain(el);
        if (!el || (c.indexOf(v) < 0 && el !== slot()) || hkDrag.sideways(c, v)) continue;
        if (c.some(n => n.localName === 'hk-pager-card' || n.localName === 'hk-header-card' || (n.getAttribute && n.getAttribute('inert') !== null))) continue;
        return { x, y };
      }
      return { x: Math.round(innerWidth * xf), y: Math.round(innerHeight * 0.6) };
    },
    // what a swipe may leave behind: nothing
    rest() {
      const v = view(), st = v.getAttribute('style') || '', s = hkPageSwipe._.state(), kids = pagesOf();
      const e = deepAt(innerWidth / 2, innerHeight / 2);
      return { path: location.pathname, left: Math.round(v.getBoundingClientRect().left), stray: /(^|;\s*)(transform|position|will-change|opacity|overflow|max-height|pointer-events|transition)\s*:/.test(st),
               inert: v.hasAttribute('inert'), offstage: v.hasAttribute('data-hk-offstage'), busy: !!(s.G || s.A || s.L), pages: kids.length, ghosts: kids.filter(k => k.classList.contains('hk-swipe-ghost')).length,
               others: kids.filter(k => k !== v).every(k => k.hasAttribute('inert') && Math.abs(k.getBoundingClientRect().left) >= innerWidth - 2),
               level: kids.filter(k => k !== v).every(k => Math.abs(k.getBoundingClientRect().top - (v.getBoundingClientRect().top + (document.scrollingElement.scrollTop || 0))) <= 2),
               grounds: deep(document, '.hk-swipe-ground').length,
               // (the page, or the empty screen under a page shorter than it -- the view's own container, which a press
               // and a swipe treat as the page's: hk-pageswipe.js; Cameras on the fictional house, reached through More)
               hit: !!e && (chain(e).indexOf(v) >= 0 || (e.localName === 'hk-view-container' && e.contains(v))),
               at: e ? chain(e).slice(0, 6).map(n => (n.localName || '#') + (n.id ? '#' + n.id : '') + (n.className && n.className.baseVal === undefined && n.className ? '.' + String(n.className).split(' ')[0] : '')).join(' < ') : null };
    },
    // WebKit's finger: on what is under the point, each touch the target's own until it ends
    t: null,
    ev(type, x, y) { return new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: /up|cancel/.test(type) ? 0 : 1 }); },
    down(x, y) { L.t = deepAt(x, y) || document.body; L.t.dispatchEvent(L.ev('pointerdown', x, y)); },
    move(x, y) { if (L.t) L.t.dispatchEvent(L.ev('pointermove', x, y)); },
    up(x, y, type) { const t = L.t; if (t) { L.t = null; t.dispatchEvent(L.ev(type || 'pointerup', x, y)); } },
    play(pts, cancel) {
      return new Promise((res) => {
        const t0 = performance.now(); let i = 0;
        L.down(pts[0][1], pts[0][2]);
        const step = () => {
          const now = performance.now() - t0;
          while (i + 1 < pts.length && pts[i + 1][0] <= now) { i++; L.move(pts[i][1], pts[i][2]); }
          if (i + 1 >= pts.length) { const p = pts[pts.length - 1]; L.up(p[1], p[2], cancel ? 'pointercancel' : 'pointerup'); res(performance.now()); return; }
          setTimeout(step, 4);
        };
        setTimeout(step, 4);
      });
    },
  };
  document.addEventListener('pointermove', (e) => { L.finger = e.clientX; }, { capture: true, passive: true });
  document.addEventListener('pointerdown', (e) => { L.finger = e.clientX; }, { capture: true, passive: true });
};

async function open(browser, screen, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
  await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push('page error: ' + e.message); });
  page.on('console', m => {
    const url = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && !HOMES_OWN.test(url) && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text() + ' ' + url);
  });
  await page.addInitScript(PROBE);
  await page.goto(input.origin + '/' + screen + '/home');
  await page.waitForFunction(() => window.__mantelReady === true && window.hkPageSwipe && window.hkDrag && window.hkTabBar && window.hkTabBar.pages && hkShell.view(hkShell.viewSlot(hkCards.menu.panel())), null, { timeout: 45000 });
  const t = { ctx, page, errors, cdp: CDP ? await ctx.newCDPSession(page) : null };
  await ready(t);
  return t;
}
// the page beside this one is ready: a real page in the slot (the point of the swipe's quiet-moment work), or give up and let the section say so
async function ready(t) { await t.page.waitForFunction(() => { const s = hkPageSwipe._.state(); return !s.G && !s.A && !s.L && __m.pagesOf().length >= 2 && __m.pagesOf().length <= 3; }, null, { timeout: 15000 }).catch(() => {}); await sleep(400); }
const close = async (t, name) => { assert.deepEqual(t.errors, [], name + ': no page or console errors'); await t.ctx.close(); };
const spot = (t, dir) => t.page.evaluate(xf => __m.spot(xf), dir < 0 ? 0.65 : 0.35);
const rest = (t) => t.page.evaluate(() => __m.rest());
const where = (t) => t.page.evaluate(() => location.pathname);
function pathOf(a, segs) {
  const out = [[0, a.x, a.y]]; let t0 = 0, x0 = 0;
  for (const s of segs) { const n = Math.max(1, Math.round(s.ms / 8)); for (let i = 1; i <= n; i++) out.push([t0 + (s.ms * i) / n, a.x + x0 + ((s.dx - x0) * i) / n, a.y]); t0 += s.ms; x0 = s.dx; }
  return out;
}
async function down(t, x, y) { if (t.cdp) await t.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); else await t.page.evaluate(([a, b]) => __m.down(a, b), [x, y]); }
async function move(t, x, y) { if (t.cdp) await t.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); else await t.page.evaluate(([a, b]) => __m.move(a, b), [x, y]); }
async function up(t, x, y) { if (t.cdp) await t.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await t.page.evaluate(([a, b]) => __m.up(a, b), [x, y]); }
async function play(t, pts, cancel) {
  if (!t.cdp) return t.page.evaluate(([p, c]) => __m.play(p, c), [pts, !!cancel]);
  const t0 = Date.now();
  await down(t, pts[0][1], pts[0][2]);
  for (let i = 1; i < pts.length; i++) { const w = pts[i][0] - (Date.now() - t0); if (w > 1) await sleep(w); await move(t, pts[i][1], pts[i][2]); }
  await t.cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  return t.page.evaluate(() => performance.now());
}
// a swipe, watched
async function swipe(t, segs, o = {}) {
  const dir = segs.find(s => s.dx).dx, s = o.at || await spot(t, dir);
  const id = await t.page.evaluate(() => __m.idOf(__m.view()));
  await t.page.evaluate(() => __m.start());
  const liftedAt = await play(t, pathOf(s, segs), o.cancel);
  await sleep(o.after === undefined ? 1000 : o.after);
  const frames = await t.page.evaluate(() => __m.stop());
  return { s, id, frames, liftedAt, W };
}
const seriesOf = (w, id) => w.frames.map(f => { const k = f.pages.find(p => p.id === id); return k ? { t: f.t, now: f.now, x: k.x, st: f.st, finger: f.finger, o: k.o } : null; }).filter(Boolean);
// WHILE THE FINGER IS DOWN: the page against the finger. A constant offset is the swipe's start; what moves is an error.
function tracksFinger(w, name) {
  const live = seriesOf(w, w.id).filter(p => p.st === 'G');
  assert(live.length >= 3, name + ': frames of the page following the finger ' + live.length);
  const off = live.map(p => p.x - (p.finger - w.s.x)), spread = Math.max(...off) - Math.min(...off);
  assert(spread <= 1.5, name + ': the page keeps with the finger, frame by frame (spread ' + spread.toFixed(1) + ' px)');
  assert(Math.abs(live[0].x) <= Math.abs(live[0].finger - w.s.x), name + ': no jump as it begins ' + JSON.stringify(live[0]));
}
// AFTER THE LIFT: one way, never back; no frame-to-frame leap past the fastest a finger is taken up at
function settlesSmoothly(w, target, name) {
  let after = seriesOf(w, w.id).filter(p => p.now >= w.liftedAt - 1);
  // (as far as it can be seen: a page that has left the screen goes on to wait past its edge, park)
  const gone = after.findIndex(p => Math.abs(p.x) >= w.W - 0.5);
  if (gone >= 0) after = after.slice(0, gone + 1);
  assert(after.length >= 3, name + ': frames after the lift');
  const sign = Math.sign(target - after[0].x);
  let peak = 0, pi = 0, home = false;
  for (let i = 1; i < after.length; i++) {
    const d = after[i].x - after[i - 1].x;
    // (a finger going the other way carries it on a little first; once it is coming home, it comes home)
    if (sign && d * sign > 0.5) home = true;
    assert(!(home && d * sign < -1.5), name + ': it never turns back as it settles ' + JSON.stringify([after[i - 1].x, after[i].x]));
    const dt = after[i].t - after[pi].t;
    if (dt >= 12) { peak = Math.max(peak, Math.abs(after[i].x - after[pi].x) / dt); pi = i; }
  }
  assert(peak <= 8.5, name + ': no leap: the fastest it goes is ' + peak.toFixed(1) + ' px/ms');
  // ...and it goes on at the finger's speed, not off from it: over the first frames, not much past what it was doing
  const before = seriesOf(w, w.id).filter(p => p.st === 'G' && p.now >= w.liftedAt - 80);
  let firstFrame = null;
  for (let i = 1; i < after.length; i++) { const dt = after[i].t - after[0].t; if (dt >= 12) { firstFrame = dt <= 40 ? Math.abs(after[i].x - after[0].x) / dt : null; break; } }
  const was = before.length > 1 ? Math.abs(before[before.length - 1].x - before[0].x) / Math.max(1, before[before.length - 1].t - before[0].t) : 0;
  if (firstFrame !== null) assert(firstFrame <= was + 3.2, name + ': it leaves at about the finger\'s speed: ' + was.toFixed(2) + ' then ' + firstFrame.toFixed(2) + ' px/ms');
  const end = after[after.length - 1].x;
  if (gone >= 0) assert(Math.abs(end) >= w.W - 0.5, name + ': it goes all the way off the screen, not to ' + end);
  else assert(Math.abs(end - target) <= 1.5 || (seriesOf(w, w.id).slice(-1)[0] || {}).x === undefined, name + ': it ends at ' + target + ', not ' + end);
}
function isClean(r, name) {
  assert.equal(r.left, 0, name + ': the page is on the screen ' + JSON.stringify(r));
  assert(!r.stray && !r.inert && !r.offstage, name + ': nothing left on the page ' + JSON.stringify(r));
  assert(!r.busy && !r.ghosts && !r.grounds, name + ': nothing left going ' + JSON.stringify(r));
  assert(r.hit, name + ': the page takes the next touch ' + JSON.stringify(r));
  assert(r.others, name + ': what waits beside it is out of sight and inert ' + JSON.stringify(r));
  assert(r.level, name + ': what waits beside it is level with it ' + JSON.stringify(r));
  assert(r.pages <= 3, name + ': the page and at most its two neighbors in the slot ' + JSON.stringify(r));
}
// HOW MUCH THE PIXELS SHOW in a part of a screenshot: edges, not colors (the sky alone is smooth; a title on it is a few)
async function inkIn(t, png, rect) {
  const p = t.inkPage || (t.inkPage = await t.ctx.newPage());
  return p.evaluate(async ([b64, r]) => {
    const im = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = new OffscreenCanvas(r.w, r.h), g = c.getContext('2d');
    g.drawImage(im, -r.x, -r.y);
    const d = g.getImageData(0, 0, r.w, r.h).data;
    let edges = 0;
    for (let y = 0; y < r.h; y += 2) for (let x = 0; x + 1 < r.w; x++) { const i = (y * r.w + x) * 4; if (Math.abs(d[i] - d[i + 4]) + Math.abs(d[i + 1] - d[i + 5]) + Math.abs(d[i + 2] - d[i + 6]) > 60) edges++; }
    return edges / (r.w * r.h / 2);
  }, [png.toString('base64'), rect]);
}
async function holdThen(t, dir, fn, travel = 0.42) {
  const s = await spot(t, dir), pts = pathOf(s, [{ ms: 200, dx: W * travel * dir }]);
  await down(t, pts[0][1], pts[0][2]);
  for (const p of pts.slice(1)) { await move(t, p[1], p[2]); await sleep(5); }
  await sleep(120);
  const r = await fn();
  return { s, end: pts[pts.length - 1], r };
}

const SECTIONS = {
  // WHAT COMES IN IS THE PAGE, not its title: never visited, held, and on a tablet the slow-tablet ladder has flagged
  async content(b) {
    const t = await open(b, 'ps-bar'), order = await t.page.evaluate(() => hkPageSwipe.order().map(i => i.path));
    const incoming = { x: Math.round(W * 0.58), y: 0, w: Math.round(W * 0.42), h: Math.round(H * 0.8) };
    const check = async (name, wantPage) => {
      const h = await holdThen(t, -1, async () => {
        const seen = await t.page.evaluate(() => { const p = __m.pagesOf().filter(k => k !== __m.view()); const q = p.find(k => { const l = k.getBoundingClientRect().left; return l > 0 && l < innerWidth; }); return q ? { ghost: q.classList.contains('hk-swipe-ghost'), shows: __m.inSight(q), inert: q.hasAttribute('inert') } : null; });
        const png = await t.page.screenshot({ type: 'png' });
        if (input.shots) require('fs').writeFileSync(path.join(input.shots, input.engine + '-' + input.size + '-' + name + '.png'), png);
        return { seen, ink: await inkIn(t, png, incoming) };
      });
      await up(t, h.end[1], h.end[2]);
      await sleep(900);
      assert(h.r.seen, name + ': a page beside it');
      assert(!h.r.seen.ghost, name + ': the real page, not a stand-in ' + JSON.stringify(h.r));
      assert(h.r.seen.shows >= 8, name + ': it has its contents in sight, mid-drag ' + JSON.stringify(h.r));
      assert(h.r.ink >= 0.012, name + ': and they are on the screen, in its pixels ' + JSON.stringify(h.r));
      assert.equal(await where(t), wantPage, name + ': lands on it');
      isClean(await rest(t), name);
    };
    await check('never-visited', order[1]);
    await ready(t);
    await check('never-visited-2', order[2]);
    // back and forward over what is now held, with the ladder's flag up
    await swipe(t, [{ ms: 300, dx: W * 0.42 }]); await swipe(t, [{ ms: 300, dx: W * 0.42 }]);
    await ready(t);
    await t.page.evaluate(() => { const seg = location.pathname.split('/')[1]; hkFps.latest = () => ({ fps: 30, at: Date.now(), screen: seg }); });
    assert(await t.page.evaluate(() => hkPageSwipe._.slow()), 'the ladder has flagged it');
    await check('flagged-tablet', order[1]);
    await close(t, 'content');
  },
  // WITH THE FINGER, EACH WAY, AND ON
  async follows(b) {
    const t = await open(b, 'ps-bar'), order = await t.page.evaluate(() => hkPageSwipe.order().map(i => i.path));
    let w = await swipe(t, [{ ms: 700, dx: W * -0.42 }]);
    tracksFinger(w, 'slow drag');
    settlesSmoothly(w, -seriesOf(w, w.id).slice(-1)[0].x === 0 ? 0 : seriesOf(w, w.id).slice(-1)[0].x, 'slow drag');
    assert.equal(await where(t), order[1], 'slow drag lands');
    isClean(await rest(t), 'slow drag');
    await ready(t);
    w = await swipe(t, [{ ms: 110, dx: W * 0.3 }]);
    settlesSmoothly(w, seriesOf(w, w.id).slice(-1)[0].x, 'flick');
    assert.equal(await where(t), order[0], 'a flick lands past a short drag');
    isClean(await rest(t), 'flick');
    await ready(t);
    // reversing stays continuous: back near where it began, it goes back
    w = await swipe(t, [{ ms: 280, dx: W * -0.4 }, { ms: 260, dx: W * -0.04 }]);
    tracksFinger(w, 'reversed');
    assert.equal(await where(t), order[0], 'reversed: stays');
    isClean(await rest(t), 'reversed');
    // past a fifth but flicked back: back, the way the finger was going
    w = await swipe(t, [{ ms: 280, dx: W * -0.7 }, { ms: 60, dx: W * -0.36 }], { at: { x: Math.round(W * 0.85), y: Math.round(H * 0.55) } });
    const last = seriesOf(w, w.id).filter(p => p.now >= w.liftedAt);
    assert.equal(await where(t), order[0], 'flicked back from past a fifth: stays ' + JSON.stringify(last.slice(0, 3).map(p => p.x)));
    settlesSmoothly(w, 0, 'flicked back');
    isClean(await rest(t), 'flicked back');
    // held still, then let go: past a fifth, it lands, from rest
    w = await swipe(t, [{ ms: 240, dx: W * -0.3 }, { ms: 500, dx: W * -0.3 }]);
    assert.equal(await where(t), order[1], 'held and let go past a fifth: lands');
    isClean(await rest(t), 'held');
    await ready(t);
    // short and slow: back
    w = await swipe(t, [{ ms: 500, dx: W * 0.1 }]);
    assert.equal(await where(t), order[1], 'short and slow: stays');
    settlesSmoothly(w, 0, 'short and slow');
    isClean(await rest(t), 'short');
    // the browser takes it: back
    w = await swipe(t, [{ ms: 240, dx: W * -0.35 }], { cancel: true });
    assert.equal(await where(t), order[1], 'cancelled: stays');
    settlesSmoothly(w, 0, 'cancelled');
    isClean(await rest(t), 'cancelled');
    // the first page's edge: a third of the travel, and back
    await swipe(t, [{ ms: 200, dx: W * 0.4 }]);
    await ready(t);
    assert.equal(await where(t), order[0], 'back at Home');
    w = await swipe(t, [{ ms: 300, dx: W * 0.42 }]);
    const edge = seriesOf(w, w.id).filter(p => p.st === 'G').slice(-1)[0];
    assert(Math.abs(edge.x - (edge.finger - w.s.x - 10) / 3) < 3, 'the first page gives a third ' + JSON.stringify(edge));
    settlesSmoothly(w, 0, 'edge');
    isClean(await rest(t), 'edge');
    await close(t, 'follows');
  },
  // A NEW FINGER ON A PAGE STILL SETTLING: it is caught where it is, and nothing queued overwrites what it does next
  async interrupted(b) {
    for (const delay of [30, 120, 230, 400]) {
      const t = await open(b, 'ps-bar'), order = await t.page.evaluate(() => hkPageSwipe.order().map(i => i.path));
      const a = { x: Math.round(W * 0.7), y: Math.round(H * 0.55) };
      const id = await t.page.evaluate(() => __m.idOf(__m.view()));
      await t.page.evaluate(() => __m.start());
      await play(t, pathOf(a, [{ ms: 100, dx: W * -0.3 }]));
      await sleep(delay);
      const pressedAt = await t.page.evaluate(() => performance.now());
      await play(t, pathOf(a, [{ ms: 180, dx: W * -0.22 }]));
      await sleep(1100);
      const frames = await t.page.evaluate(() => __m.stop());
      const name = 'a finger ' + delay + ' ms into a settle';
      const here = order.indexOf(await where(t));
      assert(here >= 1 && here <= 2, name + ': it lands one or two pages on ' + await where(t));
      isClean(await rest(t), name);
      assert(!frames.some(f => f.st.indexOf('L') >= 0), name + ': never left waiting on a page');
      // ...and a catch that landed a page leaves what comes next level with it, finger still down
      await play(t, pathOf(a, [{ ms: 100, dx: W * -0.3 }]));
      await sleep(Math.min(delay, 200));
      const b1 = pathOf(a, [{ ms: 60, dx: W * -0.2 }]);
      await down(t, b1[0][1], b1[0][2]);
      for (const q of b1.slice(1)) { await move(t, q[1], q[2]); await sleep(5); }
      await sleep(50);
      const lv = await t.page.evaluate(() => { const v = __m.view(), s = hkPageSwipe._.state().ST; const k = [...__m.pagesOf()].filter(e => e !== (s ? s.view : v)); const y = (s ? s.view : v).getBoundingClientRect().top; return k.map(e => Math.round(e.getBoundingClientRect().top - y)); });
      await up(t, b1[b1.length - 1][1], b1[b1.length - 1][2]);
      await sleep(900);
      assert(lv.every(d => Math.abs(d) <= 2), name + ': the pages level with each other in a caught swipe ' + JSON.stringify(lv));
      // no leap as it is caught: the moved page's steps stay within the finger's and the spring's
      const se = frames.map(f => { const k = f.pages.find(p => p.id === id); return k ? { x: k.x, now: f.now, t: f.t } : null; }).filter(Boolean).filter(p => p.now >= pressedAt - 34 && p.now <= pressedAt + 34);
      for (let i = 1; i < se.length; i++) assert(Math.abs(se[i].x - se[i - 1].x) <= Math.max(140, (se[i].t - se[i - 1].t) * 8.5), name + ': no leap at the press ' + JSON.stringify(se.map(p => Math.round(p.x))));
      await close(t, name);
    }
    // a tap on a settling page lets it go on to where it was going
    const t = await open(b, 'ps-bar'), order = await t.page.evaluate(() => hkPageSwipe.order().map(i => i.path));
    const a = { x: Math.round(W * 0.7), y: Math.round(H * 0.55) };
    await play(t, pathOf(a, [{ ms: 100, dx: W * -0.3 }]));
    await sleep(60);
    await down(t, a.x, a.y); await sleep(60); await up(t, a.x, a.y);
    await sleep(1100);
    assert.equal(await where(t), order[1], 'a tap mid-settle: it goes on');
    isClean(await rest(t), 'a tap mid-settle');
    await close(t, 'tap mid-settle');
  },
  // FLICK, FLICK, FLICK: through the pages and back, not waiting for any of them
  async rapid(b) {
    const t = await open(b, 'ps-bar'), order = await t.page.evaluate(() => hkPageSwipe.order().map(i => i.path));
    const gone = [];
    const flick = async (dir) => { await play(t, pathOf({ x: Math.round(W * (dir < 0 ? 0.7 : 0.3)), y: Math.round(H * 0.55) }, [{ ms: 90, dx: W * 0.32 * dir }])); await sleep(150); gone.push(await where(t)); };
    for (let i = 0; i < order.length + 1; i++) await flick(-1);
    await ready(t);
    const far = await where(t);
    assert(order.indexOf(far) >= 2, 'rapid: flicks went on through the pages ' + JSON.stringify(gone));
    isClean(await rest(t), 'rapid, forward');
    for (let i = 0; i < order.length + 1; i++) await flick(1);
    await ready(t);
    assert.equal(await where(t), order[0], 'rapid: and back to the first ' + JSON.stringify(gone));
    isClean(await rest(t), 'rapid, back');
    await close(t, 'rapid');
  },
  // SWIPE AFTER SWIPE: what is in the document stays what it was
  async repeated(b) {
    const t = await open(b, 'ps-bar');
    const count = () => t.page.evaluate(() => __m.deep(document, '*').length);
    await swipe(t, [{ ms: 200, dx: W * -0.36 }]); await ready(t); await swipe(t, [{ ms: 200, dx: W * 0.36 }]); await ready(t);
    const before = await count();
    for (let i = 0; i < 16; i++) { await swipe(t, [{ ms: 180, dx: W * (i % 2 ? 0.36 : -0.36) }], { after: 560 }); }
    await ready(t);
    isClean(await rest(t), 'repeated');
    const after = await count();
    assert(after <= before * 1.05 + 30, 'repeated: nothing piles up ' + JSON.stringify([before, after]));
    await close(t, 'repeated');
  },
  // THE WINDOW CHANGES UNDER A SWIPE
  async window(b) {
    const t = await open(b, 'ps-bar'), order = await t.page.evaluate(() => hkPageSwipe.order().map(i => i.path));
    const under = async (name, fn) => {
      const h = await holdThen(t, -1, fn);
      await sleep(500);
      await up(t, h.end[1], h.end[2]);
      await sleep(1000);
      assert.equal(await where(t), order[0], name + ': back where it was');
      isClean(await rest(t), name);
      await ready(t);
    };
    await under('resized', () => t.page.setViewportSize({ width: W - 40, height: H }));
    await t.page.setViewportSize({ width: W, height: H }); await sleep(500); await ready(t);
    await under('turned', () => t.page.setViewportSize({ width: H, height: W }));
    await t.page.setViewportSize({ width: W, height: H }); await sleep(500); await ready(t);
    const hide = () => t.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await under('hidden', hide);
    await under('back button', () => t.page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate'))));
    // hidden as it settles: it ends now, and where it was going
    await play(t, pathOf({ x: Math.round(W * 0.7), y: Math.round(H * 0.55) }, [{ ms: 100, dx: W * -0.32 }]));
    await hide();
    await sleep(800);
    assert.equal(await where(t), order[1], 'hidden mid-settle: it lands');
    isClean(await rest(t), 'hidden mid-settle');
    await ready(t);
    // the neighbors sit at the new width after a resize
    await t.page.setViewportSize({ width: W - 60, height: H });
    await sleep(900);
    // (at rest past the window's edge, laid out at the page's new width: 2026-11-05, a width away was on the screen beside
    // the Side Pane, and one laid out at a stale width drew itself again after it landed)
    const rw = await t.page.evaluate(() => { const v = __m.view().getBoundingClientRect().width; return __m.pagesOf().filter(k => k !== __m.view()).map(k => { const r = k.getBoundingClientRect(); return { out: r.right <= 0 || r.left >= innerWidth, w: Math.round(r.width), v: Math.round(v) }; }); });
    assert(rw.length && rw.every(k => k.out && Math.abs(k.w - k.v) <= 2), 'the neighbors out of sight, at the new width ' + JSON.stringify(rw));
    await t.page.setViewportSize({ width: W, height: H }); await sleep(500);
    const w = await swipe(t, [{ ms: 300, dx: W * -0.4 }]);
    assert.equal(await where(t), order[2], 'and the next swipe still works');
    isClean(await rest(t), 'after all that');
    void w;
    await close(t, 'window');
  },
  // WHAT WAITS BESIDE THE PAGE ISN'T THE PAGE
  async offstage(b) {
    const t = await open(b, 'ps-bar'), order = await t.page.evaluate(() => hkPageSwipe.order().map(i => i.path));
    const said = await t.page.evaluate(async () => {
      const heard = [];
      window.addEventListener('hk-view-ready', (e) => heard.push(e.detail.view === __m.view()));
      const n = __m.pagesOf().filter(k => k !== __m.view());
      return { waiting: n.length, inert: n.every(k => k.hasAttribute('inert') && k.getAttribute('aria-hidden') === 'true' && k.hasAttribute('data-hk-offstage')), noTab: !n.some(k => k.contains(document.activeElement)) };
    });
    assert(said.waiting >= 1 && said.inert && said.noTab, 'offstage: inert, hidden from a reader, and off stage ' + JSON.stringify(said));
    // shown by a tab, it is simply the page; what it was is gone
    await t.page.evaluate((p) => hkShell.navigate(p), order[1]);
    await sleep(900);
    assert.equal(await where(t), order[1], 'a tab: the page beside it');
    isClean(await rest(t), 'a tab');
    await ready(t);
    // a page far away, then back: nothing left over
    await t.page.evaluate((p) => hkShell.navigate(p), order[order.length - 1]);
    await sleep(900);
    isClean(await rest(t), 'a tab far away');
    await ready(t);
    // Edit mode has no neighbors, and a new config takes them with it
    const kept = await t.page.evaluate(async () => {
      const H = hkViewHost.live(), before = __m.pagesOf().length;
      await H.reconfigure(JSON.parse(JSON.stringify(H.config)));
      return { before, right: __m.pagesOf().length };
    }).catch((e) => ({ threw: String(e) }));
    assert(!kept.threw, 'reconfigure ' + JSON.stringify(kept));
    await ready(t);
    isClean(await rest(t), 'a new config');
    await close(t, 'offstage');
  },
  // REDUCE MOTION: nothing follows; the two pages cross-fade
  async reduced(b) {
    const t = await open(b, 'ps-bar', { reduced: true }), order = await t.page.evaluate(() => hkPageSwipe.order().map(i => i.path));
    const w = await swipe(t, [{ ms: 280, dx: W * -0.42 }]);
    const moved = w.frames.some(f => f.pages.some(p => p.cur && Math.abs(p.x) > 1));
    assert(!moved, 'reduced: nothing moves');
    const both = w.frames.filter(f => f.pages.filter(p => p.o > 0.05 && p.o < 0.95 && Math.abs(p.x) < 1).length === 2);
    assert(both.length >= 1, 'reduced: both pages on the screen in the fade, not a dip to the sky ' + JSON.stringify(w.frames.slice(-40).map(f => f.pages.map(p => [Math.round(p.x), +p.o.toFixed(2)]))));
    assert.equal(await where(t), order[1], 'reduced: lands');
    isClean(await rest(t), 'reduced');
    await close(t, 'reduced');
  },
  // A HOME GRID: its views go first, the hand-off doesn't jump, back lands on the last view
  async grid(b) {
    const t = await open(b, 'ps-grid'), order = await t.page.evaluate(() => hkPageSwipe.order().map(i => i.path));
    const view = () => t.page.evaluate(() => __m.view()._view);
    const s = await t.page.evaluate(() => __m.spot(0.62));
    await swipe(t, [{ ms: 300, dx: W * -0.42 }], { at: s });
    assert.equal(await view(), 1, 'grid: its views first');
    assert.equal(await t.page.evaluate(() => { const v = __m.view(); return v._root.style.getPropertyValue('--drag'); }), '', 'grid: nothing left on the grid');
    await ready(t);
    const w = await swipe(t, [{ ms: 400, dx: W * -0.42 }], { at: await t.page.evaluate(() => __m.spot(0.62)) });
    assert.equal(await where(t), order[1], 'grid: past its last view, on to the next page');
    tracksFinger(w, 'grid hand-off');
    isClean(await rest(t), 'grid hand-off');
    await ready(t);
    await swipe(t, [{ ms: 400, dx: W * 0.42 }]);
    assert.equal(await where(t), order[0], 'grid: and back');
    assert.equal(await view(), 1, 'grid: back lands on its last view');
    isClean(await rest(t), 'grid back');
    // a view flicked back goes back
    await ready(t);
    await swipe(t, [{ ms: 240, dx: W * 0.7 }, { ms: 60, dx: W * 0.36 }], { at: await t.page.evaluate(() => __m.spot(0.15)) });
    assert.equal(await view(), 1, 'grid: a view flicked back stays');
    await close(t, 'grid');
  },
  // A BLOCK THAT SWIPES ITS PAGES: on its page at rest, however it got there
  async pager(b) {
    const t = await open(b, 'ps-grid');
    // (a block whose page doesn't scroll sideways inside itself at that point: that is the browser's own pan)
    const info = () => t.page.evaluate(() => {
      const fine = (q) => { const r = q.getBoundingClientRect(), x = r.right - Math.min(40, r.width / 4), y = (r.top + r.bottom) / 2, e = __m.deepAt(x, y); return e && __m.chain(e).indexOf(q) >= 0 && !__m.chain(e).some(n => n.classList && n.classList.contains('tiles')); };
      window.__mp = window.__mp || __m.deep(document, 'hk-pager-card').filter(q => (q._pages || []).length > 1 && !__m.chain(q).some(n => n.getAttribute && n.getAttribute('inert') !== null)).filter(fine)[0];
      const p = window.__mp; if (!p) return null;
      const r = p.getBoundingClientRect();
      return { x: r.right - Math.min(40, r.width / 4), y: (r.top + r.bottom) / 2, w: r.width, i: p._index, left: p._track.scrollLeft, want: p._pageLeft(p._index), glide: !!p._glide };
    });
    let p = await info();
    assert(p, 'pager: a block with pages');
    await play(t, pathOf(p, [{ ms: 300, dx: -0.6 * p.w }]));
    await sleep(900);
    let q = await info();
    assert.equal(q.i, 1, 'pager: a drag past a fifth turns it');
    assert(Math.abs(q.left - q.want) <= 0.6 && !q.glide, 'pager: at rest on its page ' + JSON.stringify(q));
    await play(t, pathOf(q, [{ ms: 90, dx: -0.1 * q.w }, { ms: 50, dx: 0 }]));
    await sleep(900);
    let r = await info();
    assert.equal(r.i, 1, 'pager: flicked back, it stays ' + JSON.stringify(r));
    await play(t, pathOf(r, [{ ms: 70, dx: 0.3 * r.w }]));
    await sleep(120);
    r = await info();
    await down(t, r.x, r.y); await sleep(30);
    const caught = await info();
    assert(!caught.glide, 'pager: a finger stops it where it is');
    await up(t, r.x, r.y);
    await sleep(900);
    r = await info();
    assert(Math.abs(r.left - r.want) <= 0.6, 'pager: at rest on its page after all that ' + JSON.stringify(r));
    await close(t, 'pager');
  },
};

(async () => {
  const browser = await pw[input.engine].launch({ headless: true });
  let failed = 0;
  const only = input.only ? input.only.split(',') : null;
  try {
    for (const name of Object.keys(SECTIONS)) {
      if (only && only.indexOf(name) < 0) continue;
      try { await SECTIONS[name](browser); console.log('PASS ' + input.engine + ' ' + input.size + ' ' + name); }
      catch (e) { failed++; console.log('FAIL ' + input.engine + ' ' + input.size + ' ' + name + ': ' + String(e && e.message).slice(0, 700)); }
    }
  } finally { await browser.close(); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
