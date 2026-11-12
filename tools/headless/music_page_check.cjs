// music_page_check.py's browser: the Music page at each size, its player measured (hk-np-strip.js check, player_look.js).
const assert = require('assert/strict');
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
// measured on the page (a function, not a string: the page's CSP refuses those)
function measureSrc() {
  const card = (function find(r) {
    for (const e of r.querySelectorAll('*')) {
      if (e.localName === 'hk-music-card') return e;
      if (e.shadowRoot) { const f = find(e.shadowRoot); if (f) return f; }
    }
    return null;
  })(document);
  if (!card || !card.shadowRoot) return null;
  const r = card.shadowRoot, q = (s) => r.querySelector(s), R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const playerLook = PLAYER_LOOK, strip = q('.hks'), left = q('.left'), front = q('.front');
  const cols = q('.mu') && q('.mu').getAttribute('cols'), shown = (e) => e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none';
  const out = { cols, sheet: !!(left && left.classList.contains('sheetup')), card: R(card) };
  if (strip && window.hkNpStrip) {
    out.strip = window.hkNpStrip.check(strip, { min: 44, line: q('.ttl .hksl') });
    out.ends = [...r.querySelectorAll('.hks .mctl > [data-act]')].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden').map(
      (e) => e.getAttribute('data-act'));
    out.look = playerLook(r, { bar: '.mbar', pp: '.mpp svg', vol: '.mvt', buttons: '.hks .mbtn' });
    // (the column's margins either side: the strip's bars to the left section's edges)
    const L = R(left), bar = R(q('.hks .mbar'));
    out.margins = { left: Math.round((bar.l - L.l) * 10) / 10, right: Math.round((L.r - bar.r) * 10) / 10 };
  }
  const mini = q('.mini');
  if (shown(mini)) {
    const M = R(mini), th = R(q('.mini .th')), t = R(q('.mini .t'));
    out.mini = { pp: R(q('.mini .pp')), rb: R(q('.mini .rb')), edge: Math.round((th.l - M.l) * 10) / 10, gap: Math.round((t.l - th.r) * 10) / 10 };
  }
  return out;
}
const measure = new Function('return ' + measureSrc.toString().replace('PLAYER_LOOK', '(' + require('./player_look.js').toString() + ')'))();
(async () => {
  const browser = await pw[input.engine].launch({ headless: true });
  try {
    for (const [W, H] of input.sizes || [[1180, 820], [1280, 800], [820, 1180], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: W < 600 });
      await context.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await context.route('**/*', (route) => new URL(route.request().url()).origin === input.origin ? route.continue() : route.abort());
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (e) => { if (!/ResizeObserver loop|due to access control checks/.test(e.message)) errors.push(e.message); });
      await page.goto(`${input.origin}/${input.screen}/playmusic?hkglass=blur`);
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForFunction(() => !!customElements.get('hk-music-card'), null, { timeout: 15000 });
      await page.waitForTimeout(3000);
      const tag = `${W}x${H}`;
      let m = await page.evaluate(measure);
      assert(m, tag + ': no Music page card');
      if (m.cols === '1') {
        // A PHONE: the mini player at the foot, then the player as a sheet over the page
        if (input.shots) await page.screenshot({ path: `${input.shots}/${tag}-mini.png` });
        if (!input.only) {
          assert(m.mini, tag + ': the mini player ' + JSON.stringify(m));
          const n = m.mini;
          assert(n.pp.w >= 44 && n.pp.h >= 44 && n.rb.w >= 44 && n.rb.h >= 44 && n.pp.w > n.rb.w, tag + ': the mini player\'s targets, play / pause the bigger ' + JSON.stringify(n));
          assert(n.pp.l - n.rb.r >= 8 || n.rb.l - n.pp.r >= 8, tag + ': its two targets 8 px apart ' + JSON.stringify(n));
          assert(Math.abs(n.gap - n.edge) <= 1, tag + ': its cover as far from the song as from the edge ' + JSON.stringify(n));
        }
        await page.evaluate(() => { const c = (function find(r) { for (const e of r.querySelectorAll('*')) { if (e.localName === 'hk-music-card') return e;
          if (e.shadowRoot) { const f = find(e.shadowRoot); if (f) return f; } } return null; })(document); c._sheet(true); });
        await page.waitForTimeout(2500);
        m = await page.evaluate(measure);
      }
      if (input.shots) await page.screenshot({ path: `${input.shots}/${tag}-music.png` });
      if (!input.only) {
        assert(m.strip, tag + ': the player is the controls strip ' + JSON.stringify(m));
        assert(!m.strip.breaks.length && m.strip.gapTV >= 12 && m.strip.gapPT >= 12 && m.strip.gapL >= 12 && m.strip.targets.line[1] >= 43.5,
               tag + ': 44 px targets (the speaker line\'s too), play / pause the biggest, nothing overlapping, 12 px clear round the keys and the line ' + JSON.stringify(m.strip));
        // (the owner's mockup 12h, 2026-11-09: Browse at the row's left end, Up Next at its right; the speaker line opens the speakers)
        assert.deepEqual([m.ends[0], m.ends[m.ends.length - 1]], ['brw', 'queue'], tag + ': Browse left, Up Next right ' + JSON.stringify(m.ends));
        const card = page.locator('hk-music-card');
        await card.locator('.ttl .hksl').tap();
        await card.locator('.mpanel [data-p="speakers"]:not([hidden])').first().waitFor({ state: 'visible', timeout: 8000 });
        await page.waitForTimeout(700);
        if (input.shots) await page.screenshot({ path: `${input.shots}/${tag}-speakers.png` });
        // EACH ROOM ITS OWN VOLUME (2026-11-12, the owner's pick C; it was the Volume tab): no Volume tab; every room in the music a
        // row that fills to its level, All Speakers on top wherever two rooms or more play; every such row lets a vertical finger
        // scroll the list (touch-action pan-y); no glyph in a well
        const vt = await page.evaluate(() => {
          const deep = (r, sel) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(sel) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, sel) : [])]);
          const vol = deep(document, '.mpanel [data-p="speakers"] .mproom.vol');
          const wells = deep(document, '.mpanel .mproom .ri').filter((e) => { const b = getComputedStyle(e).backgroundColor; return b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent'; });
          return { tabs: deep(document, '.mpanel [data-tab]').map((t) => t.getAttribute('data-tab')), vol: vol.length,
                   all: deep(document, '.mpanel .mpall .mproom').length, wells: wells.length,
                   touch: [...new Set(vol.map((s) => getComputedStyle(s).touchAction))] };
        });
        assert(vt.tabs.indexOf('volume') < 0, tag + ': no Volume tab ' + JSON.stringify(vt));
        assert(vt.vol < 2 || vt.all === 1, tag + ': two rooms or more in the music, All Speakers on top ' + JSON.stringify(vt));
        assert(!vt.vol || vt.touch.length === 1 && vt.touch[0] === 'pan-y', tag + ': a vertical finger scrolls the rooms ' + JSON.stringify(vt));
        assert(!vt.wells, tag + ': the rooms\' glyphs bare, no wells ' + JSON.stringify(vt));
        if (input.players) {
          // PLAYING IN THE HOUSE (2026-11-12, mockup D): a row per stream; the page's own lit, the other with its own play / pause --
          // a tap on that pauses THAT player and the page stays where it is; a tap on the row hands the page to it
          await card.locator('.mpanel [data-k="close"]').first().tap();
          await page.waitForTimeout(900);
          const rows = () => page.evaluate(() => {
            const deep = (r, sel) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(sel) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, sel) : [])]);
            return deep(document, '.house .cx').map((e) => ({ on: e.classList.contains('on'), text: e.textContent, pp: !!e.querySelector('[data-ppk]'),
              wells: [...e.querySelectorAll('.pp')].filter((p) => { const b = getComputedStyle(p).backgroundColor; return b && b !== 'rgba(0, 0, 0, 0)'; }).length }));
          });
          const r0 = await rows();
          assert(r0.length === 2 && r0.filter((r) => r.on).length === 1 && r0.filter((r) => !r.on).every((r) => r.pp && !r.wells),
                 tag + ': two streams, the page\'s own lit, the other its own bare play / pause ' + JSON.stringify(r0));
          if (input.shots) await page.screenshot({ path: `${input.shots}/${tag}-players.png` });
          // (the fictional house answers a transport without acting on it: what is checked is the call -- that player, play / pause --
          // and that the page stayed on its own)
          const want = await page.evaluate(() => {
            const deep = (r, sel) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(sel) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, sel) : [])]);
            const c = deep(document, 'hk-music-card')[0], orig = c._callResp;
            window.__mpCalls = [];
            c._callResp = function (d, sv, data) { window.__mpCalls.push([d + '.' + sv, data]); return orig.apply(this, arguments); };
            return deep(document, '.house .cx:not(.on) [data-ppk]')[0].getAttribute('data-ppk');
          });
          await card.locator('.house .cx:not(.on) [data-ppk]').first().click();
          await page.waitForTimeout(600);
          const calls = await page.evaluate(() => window.__mpCalls);
          const r1 = await rows();
          assert(calls.length === 1 && calls[0][0] === 'hk_frontend.music_transport' && calls[0][1].player === want && calls[0][1].command === 'play_pause',
                 tag + ': its play / pause asks for that player alone ' + JSON.stringify({ want, calls }));
          assert(JSON.stringify(r1.map((r) => r.on)) === JSON.stringify(r0.map((r) => r.on)) && r1.find((r) => r.on).text === r0.find((r) => r.on).text,
                 tag + ': ...and the page stayed on its own ' + JSON.stringify({ r0, r1 }));
          await card.locator('.house .cx:not(.on) .t').first().click();
          await page.waitForTimeout(800);
          const r2 = await rows();
          assert(/Paper Lanterns/.test(r2.find((r) => r.on).text), tag + ': a tap on the row hands the page to it ' + JSON.stringify(r2));
        }
        if (input.group) {
          // ALL SPEAKERS KEEPS THE BALANCE: dragged a fifth of its width to the right, every room in the music goes up by the
          // same step from its own level (relative to where the pointer went down, never to where it is)
          const levels = () => page.evaluate(() => {
            const deep = (r, sel) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(sel) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, sel) : [])]);
            const all = deep(document, '.mpanel .mpall .mproom')[0], r = all && all.getBoundingClientRect();
            return { box: r ? [r.left, r.top, r.width, r.height] : null,
                     rooms: Object.fromEntries(deep(document, '.mpanel .mprooms .mproom.vol').map((e) => [e.getAttribute('data-room'), Number(e.style.getPropertyValue('--v'))])) };
          });
          const before = await levels();
          assert(before.box && Object.keys(before.rooms).length === 2, tag + ': two rooms in the music and All Speakers ' + JSON.stringify(before));
          if (input.shots) await page.screenshot({ path: `${input.shots}/${tag}-group.png` });
          const [x, y, w, h] = before.box;
          await page.mouse.move(x + w * 0.5, y + h / 2);
          await page.mouse.down();
          for (let i = 1; i <= 10; i++) await page.mouse.move(x + w * 0.5 + w * 0.02 * i, y + h / 2);
          await page.mouse.up();
          await page.waitForTimeout(300);
          const after = await levels();
          const d = Object.keys(before.rooms).map((k) => Math.round((after.rooms[k] - before.rooms[k]) * 100));
          assert(d.every((x) => x === d[0]) && d[0] >= 18 && d[0] <= 22, tag + ': every room up by the same fifth ' + JSON.stringify({ before, after, d }));
          if (input.shots) await page.screenshot({ path: `${input.shots}/${tag}-group-dragged.png` });
        }
        assert(!m.look.wells.length && m.look.above !== undefined && Math.abs(m.look.above - m.look.below) <= 3, tag + ': the player bare, the pause halfway ' + JSON.stringify(m.look));
        assert(Math.abs(m.margins.left - m.margins.right) <= 1, tag + ': the column\'s margins even ' + JSON.stringify(m.margins));
        console.log(`PASS ${input.engine} ${tag} (${m.cols} column${m.cols === '1' ? ', the sheet' : 's'}): targets ${JSON.stringify(m.strip.targets)}, keys to volume ${m.strip.gapTV} px, ` +
                    `progress to keys ${m.strip.gapPT} px, ${m.look.above} px above the pause and ${m.look.below} below, margins ${JSON.stringify(m.margins)}` +
                      (m.mini ? `, mini ${JSON.stringify(m.mini)}` : ''));
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('music_page_check: ' + (input.only ? 'shots taken' : 'passed'));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
