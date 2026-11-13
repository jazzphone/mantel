// home_sheet_check.py's browser half: the Home block and its sheet, in WebKit and Chromium, by touch.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const ready = require('./grid_ready.cjs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const want = (part) => !input.only.length || input.only.includes(part);

const DEEP = `window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);`;
// the sheet's sizes: the wall tablet, an iPad across and upright, a 1024 px window (four across), a phone
const SHEET_SIZES = [[1280, 800], [1180, 820], [1024, 768], [820, 1180], [390, 844]].filter(([w, h]) => !(input.sizes || []).length || input.sizes.includes(w + 'x' + h));

// every Home block on the page: its size, what it draws, how its parts sit
function blocks() {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  return deep(document, 'hk-home-block-card').map((c) => {
    const sr = c.shadowRoot, plate = sr.querySelector('hk-plate'), pb = box(plate);
    const k = plate.offsetWidth ? pb.w / plate.offsetWidth : 1;
    const pad = parseFloat(getComputedStyle(plate).paddingLeft) || 0;
    // nothing drawn past the plate's inside (a list's box, not a line scrolled out of it)
    const past = [...sr.querySelectorAll('.ls, .sm-h, .hl, .snt, .cp, .hw, .hh, .hs')].filter((e) => {
      if (!e.getClientRects().length) return false;
      const b = box(e), p = pad * k; return b.r > pb.r - p + 1 || b.b > pb.b - p + 1 || b.l < pb.l + p - 1 || b.t < pb.t + p - 1;
    }).map((e) => { const b = box(e); return e.className + ' ' + [b.l - pb.l, b.t - pb.t, pb.r - b.r, pb.b - b.b].map(Math.round).join(','); });
    const lines = [...sr.querySelectorAll('.ln')].map((s) => Object.assign(box(s), { name: (s.querySelector('.nm') || {}).textContent,
      i: s.getAttribute('data-i'), r: s.getAttribute('data-r'), label: s.getAttribute('aria-label') }));
    const pills = [...sr.querySelectorAll('.cp .sm-k')].map((s) => Object.assign(box(s), { text: s.textContent.trim() }));
    const shown = (sel) => { const e = sr.querySelector(sel); return !!(e && e.getClientRects().length); };
    return { size: c.getAttribute('size'), tile: c.getAttribute('tile'), k, plate: pb, past, lines, pills,
             glyph: shown('.hs .g') ? 'bare' : shown('.well .g') ? 'well' : shown('.hw .g') ? 'wide' : null,
             text: plate.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) };
  });
}

function sheetState() {
  const host = document.querySelector('.hkd');
  if (!host) return null;
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const sheet = host.querySelector('.sheet'), body = host.querySelector('.body'), hd = host.querySelector('.hd');
  const panel = host.querySelector('hk-detail-home'), sr = panel && panel.shadowRoot;
  const types = sr ? [...sr.querySelectorAll('.col > *')].map((e) => e.tagName.toLowerCase()) : [];
  const kinds = sr ? deep(sr, '*').map((e) => e.tagName.toLowerCase()).filter((t) => /^hk-(chips|camera-mosaic|scenes|header|popup|now-playing|heading|title)/.test(t)) : [];
  const back = hd.querySelector('.hk-home-back');
  return {
    W: innerWidth, H: innerHeight, sheet: box(sheet), body: box(body), title: host.querySelector('.tt').textContent, panel: !!panel,
    back: back ? Object.assign(box(back), { text: back.textContent.trim() }) : null, x: box(hd.querySelector('.x:not(.hk-home-back)')),
    types, kinds: [...new Set(kinds)],
    // how many pills a row holds: the most tracks of the sheet's pill grids (they auto-fill the column), inside the body
    ...(() => {
      if (!sr) return { across: 0, pills: [] };
      const bb = body.getBoundingClientRect();
      const counts = deep(sr, '*').filter((e) => e.getClientRects().length && getComputedStyle(e).display === 'grid').map((e) => {
        const r = e.getBoundingClientRect();
        if (r.left < bb.left - 6 || r.right > bb.right + 6) return 0;
        const t = getComputedStyle(e).gridTemplateColumns.split(' ').filter((x) => parseFloat(x) >= 120);
        return t.length;
      });
      return { across: counts.length ? Math.max(...counts) : 0, pills: [...new Set(counts)] };
    })(),
    scroll: { top: body.scrollTop, h: body.scrollHeight, ch: body.clientHeight, sw: body.scrollWidth, cw: body.clientWidth },
    docW: document.scrollingElement.scrollWidth,
    focus: (() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a ? a.tagName + '.' + a.className : null; })()
  };
}

(async () => {
  let failures = 0;
  const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };
  const shot = async (page, name) => { if (input.shots) await page.screenshot({ path: path.join(input.shots, name + '.png') }); };

  for (const engine of input.engines) {
    const browser = await pw[engine].launch({ headless: true });
    async function open(screen, w, h, opts) {
      opts = opts || {};
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US',
                                             reducedMotion: opts.reduce ? 'reduce' : 'no-preference' });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage();
      const errors = [], commands = [];
      page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|aborted|net::|WebSocket/.test(m.text())) errors.push('console: ' + m.text()); });
      // NOT ONE COMMAND: every frame the page sends on its sockets is read
      page.on('websocket', (ws) => ws.on('framesent', (f) => { if (/"type"\s*:\s*"command"/.test(String(f.payload))) commands.push(String(f.payload).slice(0, 200)); }));
      for (let attempt = 0; ; attempt++) {
        await page.goto(input.origin + '/' + screen + '/home', { waitUntil: 'commit' });
        try { await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 }); break; }
        catch (e) { if (attempt >= 1) throw new Error(screen + ': the page never got ready'); }
      }
      await ready(page);
      await page.evaluate(DEEP);
      await page.waitForFunction(() => deep(document, 'hk-home-block-card').length >= 6 &&
        deep(document, 'hk-home-block-card').every((c) => c.shadowRoot && c.shadowRoot.querySelector('hk-plate > *')), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      // every page change the screen is asked for
      await page.evaluate(() => {
        window.__went = [];
        const sh = window.hkShell, nav = sh.navigate.bind(sh);
        sh.navigate = (p) => { window.__went.push(p); return nav(p); };
      });
      return { ctx, page, errors, commands };
    }
    const tapIn = (page, size, sel, nth) => page.evaluate(([size, sel, nth]) => {
      const c = deep(document, 'hk-home-block-card').find((x) => x.getAttribute('size') === size);
      const els = [...c.shadowRoot.querySelectorAll(sel)], el = typeof nth === 'string' ? els.find((e) => (e.getAttribute('aria-label') || '').startsWith(nth)) : els[nth || 0];
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: el.getAttribute('aria-label') };
    }, [size, sel, nth]);
    // a part of the open sheet's body (in its cards' shadow roots), by selector and text
    const tapSheet = (page, sel, text) => page.evaluate(([sel, text]) => {
      const p = document.querySelector('.hkd hk-detail-home');
      const words = (e) => ((e.shadowRoot ? e.shadowRoot.textContent : '') + e.textContent).replace(/\s+/g, ' ').trim();
      const el = deep(p.shadowRoot, sel).find((e) => !text || words(e).startsWith(text));
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + 40, y: r.top + r.height / 2, text: words(el).slice(0, 40) };
    }, [sel, text]);
    const settle = (page) => page.waitForTimeout(700);
    const st = (page) => page.evaluate(sheetState);
    const went = (page) => page.evaluate(() => window.__went.slice());

    if (want('blocks')) {
      for (const screen of ['home-sq', 'home-tiles']) {
        const { ctx, page, errors, commands } = await open(screen, 1280, 800);
        const got = await page.evaluate(blocks);
        await shot(page, `${engine}-${screen}-blocks`);
        console.log(engine, screen, JSON.stringify(got.map((b) => [b.size, b.glyph, b.text.slice(0, 80), b.lines.length, b.pills.map((p) => p.text)])));
        for (const b of got) {
          const label = `${engine} ${screen} ${b.size}`;
          check(label + ': drawn inside its plate', () => assert(!b.past.length, JSON.stringify(b.past)));
          check(label + ': every line a finger tall', () => b.lines.forEach((s) => assert(s.h / b.k >= 55.5, s.name + ' ' + s.h / b.k)));
          if (b.size === 'S') check(label + ': the glyph, bare in Centered, in its well in Home', () => assert.equal(b.glyph, screen === 'home-sq' ? 'bare' : 'well'));
          if (b.size === 'T' || b.size === 'XL') check(label + ': the categories as lines', () => assert(b.lines.some((l) => l.i != null), JSON.stringify(b.lines)));
          if (b.size === 'L' || b.size === 'XL') check(label + ': the rooms as lines', () => assert(b.lines.filter((l) => l.r).length >= 5, JSON.stringify(b.lines.map((l) => l.name))));
          if (b.size === 'L') check(label + ': the categories as standard pills, 40 px',
            () => assert(b.pills.length >= 3 && b.pills.every((p) => Math.abs(p.h / b.k - 40) < 1), JSON.stringify(b.pills)));
        }
        if (screen === 'home-sq') {
          // TAPS: the plate opens the sheet, a room the sheet at that room, a category its own page (its chip's tap, as House
          // Status's -- the owner, 2026-11-12: a category's page in the sheet was "not the best place for it")
          let t = await tapIn(page, 'S', 'hk-plate');
          // PRESSED: the block answers the finger, a touch smaller and darker while held, as every block that is a way in
          await page.mouse.move(t.x, t.y);
          await page.mouse.down();
          await page.waitForTimeout(90);
          const held = await page.evaluate(() => {
            const p = deep(document, 'hk-home-block-card').find((x) => x.getAttribute('size') === 'S').shadowRoot.querySelector('hk-plate');
            const cs = getComputedStyle(p);
            return { transform: cs.transform, filter: cs.filter, role: p.getAttribute('role'), tab: p.getAttribute('tabindex') };
          });
          await page.mouse.up();
          await settle(page);
          check(`${engine} Small presses under the finger, and is a button`, () => {
            assert(held.transform !== 'none' && /brightness/.test(held.filter), JSON.stringify(held));
            assert(held.role === 'button' && held.tab === '0', JSON.stringify(held));
          });
          let s = await st(page);
          check(`${engine} Small opens the sheet at Home`, () => assert(s && s.panel && !s.back, JSON.stringify(s)));
          await page.keyboard.press('Escape');
          await settle(page);
          t = await tapIn(page, 'L', '.ln[data-r]', 'Kitchen');
          await page.touchscreen.tap(t.x, t.y);
          await settle(page);
          s = await st(page);
          check(`${engine} Large's Kitchen opens the sheet at the Kitchen (${t.name})`, () => assert(s && s.title === 'Kitchen' && s.back, JSON.stringify(s)));
          await page.keyboard.press('Escape');
          await settle(page);
          s = await st(page);
          check(`${engine} ...Escape there goes back to Home`, () => assert(s && !s.back && s.title !== 'Kitchen', JSON.stringify(s)));
          await page.keyboard.press('Escape');
          await settle(page);
          const gone = await st(page);
          check(`${engine} ...and Escape at Home closes it`, () => assert.equal(gone, null));
          let w = await went(page);
          check(`${engine} ...the screen still where it was`, () => assert.deepEqual(w, []));
          t = await tapIn(page, 'XL', '.ln[data-i]', 'Lights');
          await page.touchscreen.tap(t.x, t.y);
          await settle(page);
          s = await st(page);
          w = await went(page);
          check(`${engine} Extra Large's Lights goes to the Lights page, once, and opens no sheet (${t.name})`,
            () => { assert.deepEqual(w, ['/home-sq/lights']); assert.equal(s, null); });
          await page.goBack();
          await page.waitForFunction(() => deep(document, 'hk-home-block-card').length >= 6, null, { timeout: 15000 });
          await settle(page);
          await page.evaluate(() => { window.__went.length = 0; });
          t = await tapIn(page, 'L', '.cp .sm-k', 'Security');
          await page.touchscreen.tap(t.x, t.y);
          await settle(page);
          s = await st(page);
          w = await went(page);
          check(`${engine} Large's Security pill goes to the Security page (${t.name})`, () => { assert.deepEqual(w, ['/home-sq/security']); assert.equal(s, null); });
        }
        check(`${engine} ${screen}: no errors`, () => assert.deepEqual(errors, []));
        check(`${engine} ${screen}: no command sent`, () => assert.deepEqual(commands, []));
        await ctx.close();
      }
    }

    if (want('sheet')) {
      for (const [w, h] of SHEET_SIZES) {
        const { ctx, page, errors, commands } = await open('home-sq', w, h);
        const sz = w + 'x' + h;
        await page.evaluate(() => window.hkHomeBlock.openSheet('home'));
        await settle(page);
        let s = await st(page);
        await shot(page, `${engine}-sheet-${sz}-home`);
        console.log(engine, sz, JSON.stringify({ title: s.title, sheet: s.sheet, types: s.types, kinds: s.kinds }));
        check(`${engine} ${sz}: the sheet inside the window, no sideways scroll`, () => {
          assert(s.sheet.l >= -0.5 && s.sheet.t >= -0.5 && s.sheet.r <= s.W + 0.5 && s.sheet.b <= s.H + 0.5, JSON.stringify(s.sheet));
          assert(s.scroll.sw <= s.scroll.cw + 1 && s.docW <= s.W + 1, JSON.stringify(s.scroll));
        });
        // FIVE PILLS ACROSS where the window holds them, at the one sheet height (2026-11-12); fewer, whole, where it does not
        const across = { 1280: 5, 1180: 5, 1024: 4, 820: 3, 390: 2 }[w];
        if (w >= 1180) check(`${engine} ${sz}: five pills wide, 1070 x 680`, () => assert(Math.abs(s.sheet.w - 1070) <= 2 && Math.abs(s.sheet.h - 680) <= 2, JSON.stringify(s.sheet)));
        check(`${engine} ${sz}: ${across} pills across, whole`, () => assert.equal(s.across, across, JSON.stringify(s.pills)));
        check(`${engine} ${sz}: the generated Home's list -- the chips, the camera mosaic, Scenes, the rooms -- no clock, no pop-ups`, () => {
          ['hk-chips-card', 'hk-camera-mosaic-card', 'hk-scenes-card', 'hk-heading-card'].forEach((k) => assert(s.kinds.includes(k), k + ' ' + JSON.stringify(s.kinds)));
          ['hk-header-card', 'hk-popup-card', 'hk-now-playing-card'].forEach((k) => assert(!s.kinds.includes(k), k + ' ' + JSON.stringify(s.kinds)));
        });
        // a room's heading: the room inside the sheet, the back key, an accessory and back, Escape and the Home key back
        let t = await tapSheet(page, 'hk-heading-card', 'Kitchen');
        if (t) {
          await page.touchscreen.tap(t.x, t.y);
          await settle(page);
          s = await st(page);
          await shot(page, `${engine}-sheet-${sz}-kitchen`);
          check(`${engine} ${sz}: a room's heading opens the room inside the sheet, a Home key beside it`,
            () => assert(s && s.title === 'Kitchen' && s.back && s.back.text === 'Home', JSON.stringify(s)));
          check(`${engine} ${sz}: ...the back key before the title, inside the sheet`, () => assert(s.back.l >= s.sheet.l && s.back.r <= s.sheet.r && s.back.r < s.x.l, JSON.stringify([s.back, s.x])));
          // an accessory from the inner page, and back to that page
          await page.evaluate(() => window.hkShell.moreInfo('light.kitchen_pendants'));
          await settle(page);
          const acc = await st(page);
          await page.evaluate(() => { const b = document.querySelector('.hkd .hd .x[aria-label="Back"]'); if (b) b.click(); });
          await settle(page);
          s = await st(page);
          check(`${engine} ${sz}: an accessory opened there comes back to the Kitchen (${acc && acc.title})`, () => assert(s && s.title === 'Kitchen' && s.back, JSON.stringify(s)));
          await page.touchscreen.tap(s.back.l + s.back.w / 2, s.back.t + s.back.h / 2);
          await settle(page);
          s = await st(page);
          check(`${engine} ${sz}: Home goes back`, () => assert(s && !s.back && s.kinds.includes('hk-chips-card'), JSON.stringify(s)));
        } else check(`${engine} ${sz}: a Kitchen heading in the sheet`, () => assert.fail('none'));
        let wnt = await went(page);
        check(`${engine} ${sz}: ...the screen still where it was`, () => assert.deepEqual(wnt, []));
        // a chip: the screen's own page, and the sheet goes
        t = await page.evaluate(() => {
          const p = document.querySelector('.hkd hk-detail-home'), row = deep(p.shadowRoot, 'hk-chips-card')[0];
          const el = deep(row.shadowRoot || row, '*').find((e) => /Security/.test(e.getAttribute && (e.getAttribute('aria-label') || '')) && e.getClientRects().length) ||
            deep(row.shadowRoot || row, '*').find((e) => e.children.length === 0 && /^Security/.test(e.textContent.trim()));
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.touchscreen.tap(t.x, t.y);
        await settle(page);
        s = await st(page);
        wnt = await went(page);
        check(`${engine} ${sz}: the Security chip goes to the Security page and the sheet goes`, () => { assert.deepEqual(wnt, ['/home-sq/security']); assert.equal(s, null); });
        // Cameras: the same, from the sheet opened again
        await page.evaluate(() => { window.__went.length = 0; window.hkHomeBlock.openSheet('home'); });
        await settle(page);
        t = await tapSheet(page, 'hk-heading-card', 'Cameras');
        if (t) {
          await page.touchscreen.tap(t.x, t.y);
          await settle(page);
          s = await st(page);
          wnt = await went(page);
          check(`${engine} ${sz}: Cameras goes to the Cameras page and the sheet goes`, () => { assert.deepEqual(wnt, ['/home-sq/cameras']); assert.equal(s, null); });
        } else check(`${engine} ${sz}: a Cameras heading in the sheet`, () => assert.fail('none'));
        // Escape at Home closes it
        await page.evaluate(() => window.hkHomeBlock.openSheet('home'));
        await settle(page);
        await page.keyboard.press('Escape');
        await settle(page);
        const gone = await st(page);
        check(`${engine} ${sz}: Escape at Home closes the sheet`, () => assert.equal(gone, null));
        check(`${engine} ${sz}: no errors`, () => assert.deepEqual(errors, []));
        check(`${engine} ${sz}: no command sent`, () => assert.deepEqual(commands, []));
        await ctx.close();
      }
      // REDUCE MOTION: the page fades in place (no slide)
      const { ctx, page } = await open('home-sq', 1280, 800, { reduce: true });
      await page.evaluate(() => window.hkHomeBlock.openSheet('home'));
      await settle(page);
      await page.evaluate(() => {
        window.__anims = [];
        const orig = Element.prototype.animate;
        Element.prototype.animate = function (k, o) { window.__anims.push(JSON.stringify(k)); return orig.call(this, k, o); };
      });
      await page.evaluate(() => document.querySelector('.hkd hk-detail-home')._go('room-kitchen'));
      await settle(page);
      const anims = await page.evaluate(() => window.__anims.slice());
      check(`${engine} Reduce Motion: a fade, no slide`, () => assert(anims.some((a) => /opacity/.test(a)) && !anims.some((a) => /translate/.test(a)), JSON.stringify(anims)));
      // the car's screen: still the generated Home in the sheet, not the car's
      await ctx.close();
      const car = await open('home-car', 1280, 800);
      await car.page.evaluate(() => window.hkHomeBlock.openSheet('home'));
      await settle(car.page);
      const cs = await st(car.page);
      check(`${engine} a car's screen: the sheet has the rooms`, () => assert(cs && cs.kinds.includes('hk-heading-card') && cs.types.length > 4, JSON.stringify(cs)));
      await car.ctx.close();
    }
    // THE SHEET OPTION (hk-home-block.js LOOKS): Same as Screen wears the screen's look, Solid no blur at all, Glass the dark glass;
    // either takes the cards out of the shared blur; a Flat screen's sheet is Flat whatever it says
    if (want('look')) {
      const sheetLook = () => {
        const host = document.querySelector('.hkd'), sheet = host.querySelector('.sheet'), cs = getComputedStyle(sheet);
        const blur = (e) => { const c = getComputedStyle(e); const f = c.backdropFilter || c.webkitBackdropFilter || 'none'; return f !== 'none' && f !== ''; };
        const panel = host.querySelector('hk-detail-home');
        const inner = deep(panel.shadowRoot, '*').filter((e) => e.getClientRects().length && blur(e));
        return { look: sheet.getAttribute('data-hk-look'), bg: cs.backgroundColor, sheetBlur: blur(sheet), flat: host.hasAttribute('hk-flat'),
                 innerBlur: inner.length, layers: host.querySelectorAll('[data-hk-glass-layer]').length + deep(panel.shadowRoot, '[data-hk-glass-layer]').length,
                 // (what blurs, when anything does)
                 blurs: [...new Set(inner.map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') || '') + '<' +
                   ((e.getRootNode().host || {}).tagName || '').toLowerCase()))].slice(0, 8) };
      };
      for (const screen of ['home-bright', 'home-flat']) {
        const { ctx, page, errors, commands } = await open(screen, 1280, 800);
        const got = {};
        for (const [name, size, nth] of [['screen', 'XL', 0], ['solid', 'S', 0], ['glass', 'S', 1]]) {
          await page.evaluate(([size, nth]) => deep(document, 'hk-home-block-card').filter((c) => c.getAttribute('size') === size)[nth]._open('home'), [size, nth]);
          await page.waitForTimeout(1500);
          await page.evaluate(DEEP);
          got[name] = await page.evaluate(sheetLook);
          await shot(page, `${engine}-${screen}-sheet-${name}`);
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.querySelector('.hkd'), null, { timeout: 5000 }).catch(() => {});
        }
        console.log(engine, screen, JSON.stringify(got));
        if (screen === 'home-bright') {
          check(`${engine} Bright Glass, Same as Screen: Bright's white glass, its own look, its cards on the shared blur`,
            () => assert(!got.screen.look && got.screen.sheetBlur && got.screen.layers > 0, JSON.stringify(got.screen)));
          check(`${engine} ...Solid: the near-solid plate, no blur in the sheet at all`, () => assert(got.solid.look === 'solid' && got.solid.bg === 'rgba(24, 24, 28, 0.93)' &&
            !got.solid.sheetBlur && got.solid.innerBlur === 0 && got.solid.layers === 0, JSON.stringify(got.solid)));
          check(`${engine} ...Glass: the dark glass, one blur (the sheet's)`, () => assert(got.glass.look === 'glass' && got.glass.bg === 'rgba(28, 28, 32, 0.52)' &&
            got.glass.sheetBlur && got.glass.innerBlur === 0 && got.glass.layers === 0, JSON.stringify(got.glass)));
          check(`${engine} ...and the three differ from Bright's own`, () => assert(got.screen.bg !== got.glass.bg && got.screen.bg !== got.solid.bg, JSON.stringify(got)));
        } else {
          check(`${engine} Flat: the sheet is Flat whatever the block says`, () => assert(['screen', 'solid', 'glass'].every((k) => got[k].flat && !got[k].look && !got[k].sheetBlur) &&
            got.solid.bg === got.screen.bg && got.glass.bg === got.screen.bg, JSON.stringify(got)));
        }
        check(`${engine} ${screen}: no errors`, () => assert.deepEqual(errors, []));
        check(`${engine} ${screen}: no command sent`, () => assert.deepEqual(commands, []));
        await ctx.close();
      }
    }
    await browser.close();
  }
  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
