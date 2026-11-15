'use strict';
// WAITING ON THE PAGE, NOT THE CLOCK, for a Playwright check of a dashboard (2026-11-15, the owner: "it takes 15-20min for
// these checks"; saver_shows_check.cjs has had its own since 2026-11-02). side_pane_check.cjs was 254 s at a tablet's
// size, 221 s of them fixed waits: 2.5 s after every page it opened, whether the page had been still for two seconds or
// not. A check that reads what a page ENDS on has to wait until it is there -- and no longer.
//
//   const settle = require('./settle.cjs')(page);      // once per page: it counts the page's requests from here on
//   await settle(2500);                                // returns when the page is still, and never later than 2.5 s
//   await settle(3500, { quiet: 800, floor: 400 });    // still for 800 ms; not before 400 ms
//   await settle.loaded(2500);                         // right after a page loaded and is ready (below)
//
// STILL: nothing in flight on the network, none ended and nothing from the hub in the last `quiet` ms, the fonts in, every <img> loaded, no
// animation or transition that ends still running (one that loops is not waited for: a sky, a clock's colon), and what
// is drawn the same for `quiet` ms -- how many elements there are (through every shadow root), where the Side Pane is and
// what it wears, the page's own margins. Not its words: a clock and a countdown change every second, by themselves.
// The ceiling is the fixed wait it replaces, so a page that never goes still costs what it did.
//
//   HK_SETTLE=fixed   the old waits (every settle is its ceiling): to tell a check's failure from this file's
//   HK_SETTLE=probe   waits out each ceiling and says when the page was still and whether anything changed after it
const MODE = process.env.HK_SETTLE || 'quiet';
const still = () => {
  let n = 0, imgs = 0;
  const walk = (root) => {
    for (const e of root.querySelectorAll('*')) {
      n++;
      if (e.localName === 'img' && e.getAttribute('src') && !e.complete) imgs++;
      if (e.shadowRoot) walk(e.shadowRoot);
    }
  };
  walk(document);
  const de = document.documentElement;
  const panes = [...document.querySelectorAll('hk-side-pane')].map((p) => {
    const r = p.getBoundingClientRect();
    return [p.getAttribute('mode'), p.hasAttribute('on'), p.getAttribute('side'), p.getAttribute('look'), p.getAttribute('hk-flat'), p.hasAttribute('arted'),
            Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',');
  });
  const busy = (document.getAnimations ? document.getAnimations() : []).filter((a) => {
    if (a.playState !== 'running' || !a.effect || !a.effect.getComputedTiming) return false;
    return isFinite(a.effect.getComputedTiming().endTime);
  }).length;
  return { key: [n, panes.join('/'), de.getAttribute('hk-pane'), de.style.getPropertyValue('--hk-pane-l'), de.style.getPropertyValue('--hk-pane-r'),
                 de.style.getPropertyValue('--hk-pane-b'), de.scrollWidth, location.pathname + location.hash].join('#'),
           imgs, busy, fonts: document.fonts ? document.fonts.status : 'loaded' };
};

module.exports = function settler(page, { quiet: QUIET = 500, poll: POLL = 100 } = {}) {
  let inflight = 0, net = Date.now();
  page.on('request', () => { inflight++; net = Date.now(); });
  const done = () => { inflight = Math.max(0, inflight - 1); net = Date.now(); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  // (what the hub sends counts: a screen's own settings come down the socket after the page is ready, and change what
  // a tap does without changing one element -- a Now Playing section set to flip opened as a drawer, 1 run in 2)
  page.on('websocket', (ws) => ws.on('framereceived', () => { net = Date.now(); }));
  // (a page that has gone somewhere else took its unanswered requests with it)
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) { inflight = 0; net = Date.now(); } });
  async function settle(ceiling, { quiet: Q = QUIET, floor = 0 } = {}) {
    if (MODE === 'fixed') return page.waitForTimeout(ceiling);
    const where = ((new Error().stack.split('\n')[2] || '').match(/:(\d+):\d+\)?$/) || [])[1];
    const t0 = Date.now();
    let last = null, since = t0, quietAt = null, changed = 0, why = '';
    for (;;) {
      const now = Date.now(), f = await page.evaluate(still).catch(() => null);
      if (!f || f.key !== last) {
        if (MODE === 'probe' && quietAt !== null && last && f) console.log('SETTLE-CHANGE line ' + where + ' at ' + (now - t0) + ': ' + last + ' -> ' + f.key);
        last = f && f.key; since = now; changed = now - t0;
      }
      why = !f ? 'no page' : f.busy ? f.busy + ' animating' : f.imgs ? f.imgs + ' pictures loading' : f.fonts !== 'loaded' ? 'fonts'
        : inflight ? inflight + ' requests' : now - net < Q ? 'network' : now - since < Q ? 'changing' : now - t0 < floor ? 'floor' : '';
      if (!why && quietAt === null) quietAt = now - t0;
      if ((!why && MODE !== 'probe') || now - t0 >= ceiling) break;
      await page.waitForTimeout(POLL);
    }
    if (MODE === 'probe') console.log('SETTLE line ' + where + ' ceiling ' + ceiling + ' still at ' + quietAt + ' last change ' + changed + (quietAt === null ? ' (' + why + ')' : ''));
  }
  // A PAGE JUST LOADED. A second and a half after it loads, a dashboard arms the swipe and makes the pages on either
  // side of this one (hk-pageswipe.js: its last line of start-up) -- some 250 elements, long after the page looked
  // still, which is what the fixed 2.5 s after every load was really waiting for. The page's own two calls are made
  // now instead (both are its public ones, and both do nothing a second time), then it is waited for like any other:
  // the same page, the same neighbors, without the timer.
  settle.loaded = async function loaded(ceiling, opts) {
    if (MODE !== 'fixed') await page.evaluate(() => { const P = window.hkPageSwipe; if (P && P.arm && P.plan) { P.arm(); P.plan(); } }).catch(() => {});
    return settle(ceiling, opts);
  };
  return settle;
};
