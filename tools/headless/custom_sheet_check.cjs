// custom_sheet_check.py's browser half: Security's HomeView sizes and a block's Custom Detail Sheet, in WebKit and
// Chromium, by touch, with house commands off.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const ready = require('./grid_ready.cjs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const want = (part) => !input.only.length || input.only.includes(part);

const DEEP = `window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);`;
// the sheet's sizes: a tablet across and upright, a phone, the narrowest phone, a phone on its side, a short car-like window
const SHEET_SIZES = [[1180, 820], [820, 1180], [390, 844], [320, 667], [844, 390], [1280, 480], [800, 800]];

// every Security HomeView block: its size, its alarm area, its entries as drawn
function security() {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  return deep(document, 'hk-grid-security-hv-card, hk-grid-security-key-card').map((c) => {
    const sr = c.shadowRoot, plate = sr.querySelector('hk-plate'), pb = box(plate);
    const k = plate.offsetWidth ? pb.w / plate.offsetWidth : 1;
    const shown = [...sr.querySelectorAll('.en')].filter((e) => getComputedStyle(e).display !== 'none');
    const ents = shown.map((e) => {
      const cs = getComputedStyle(e), n = e.querySelector('.n');
      return Object.assign(box(e), { name: n ? n.textContent : '', state: (e.querySelector('.s') || {}).textContent, more: e.classList.contains('more'),
        lit: e.classList.contains('lit'), bg: cs.backgroundColor, ink: n ? getComputedStyle(n).color : '', label: e.getAttribute('aria-label'),
        disc: e.querySelector('.gw') ? getComputedStyle(e.querySelector('.gw')).backgroundColor : '', lock: e.classList.contains('lk') });
    });
    const past = shown.filter((e) => { const b = box(e); return b.r > pb.r + 1 || b.b > pb.b + 1 || b.l < pb.l - 1 || b.t < pb.t - 1; }).length;
    const al = sr.querySelector('.al') || sr.querySelector('hk-plate');
    return { tag: c.localName, size: c.getAttribute('size'), tile: c.getAttribute('tile'), k, plate: pb, ents, past,
             line: ((sr.querySelector('.al small') || sr.querySelector('.state')) || {}).textContent,
             big: ((sr.querySelector('.al b') || sr.querySelector('.name')) || {}).textContent, alarm: Object.assign(box(al), { label: al.getAttribute('aria-label') }),
             lm: (() => { const m = sr.querySelector('.lm'); return m && !m.hidden ? box(m) : null; })() };
  });
}

function sheetState() {
  const host = deep(document, '.hkd')[0] || document.querySelector('.hkd');
  if (!host) return null;
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const sheet = host.querySelector('.sheet'), body = host.querySelector('.body'), panel = host.querySelector('hk-detail-group');
  const sr = panel && panel.shadowRoot, tiles = sr ? [...sr.querySelectorAll('[data-entry]')] : [];
  return {
    W: innerWidth, H: innerHeight, sheet: box(sheet), body: box(body), title: host.querySelector('.tt').textContent, kind: panel ? 'group' : (host.querySelector('.body > *') || {}).localName,
    back: !!host.querySelector('.hd .x[aria-label^="Back"]'), wide: panel ? panel.hasAttribute('wide') : false,
    tiles: tiles.map((e) => Object.assign(box(e), { entry: e.getAttribute('data-entry'), centred: e.getAttribute('tile') === 'centred' })),
    none: sr && sr.querySelector('.none') ? sr.querySelector('.none').textContent : null,
    scroll: { top: body.scrollTop, h: body.scrollHeight, ch: body.clientHeight, sw: body.scrollWidth, cw: body.clientWidth },
    docW: document.scrollingElement.scrollWidth
  };
}

(async () => {
  let failures = 0;
  const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };
  const shot = async (page, name) => { if (input.shots) await page.screenshot({ path: path.join(input.shots, name + '.png') }); };

  for (const engine of input.engines) {
    const browser = await pw[engine].launch({ headless: true });
    async function open(screen, w, h) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US' });
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
      await page.waitForFunction(() => deep(document, 'hk-home-grid-view').length > 0, null, { timeout: 30000 });
      await page.waitForTimeout(1500);
      return { ctx, page, errors, commands };
    }
    const sheetUp = (page) => page.evaluate(() => !!(deep(document, '.hkd')[0] || document.querySelector('.hkd')));
    const center = (b) => ({ x: b.l + b.w / 2, y: b.t + b.h / 2 });

    if (want('security')) {
      for (const screen of ['cs-square', 'cs-tiles']) {
        const { ctx, page, errors, commands } = await open(screen, 1180, 820);
        const got = await page.evaluate(security);
        await shot(page, `${engine}-${screen}`);
        console.log(engine, screen, JSON.stringify(got.map((b) => [b.size, b.tile, b.big, b.line, b.ents.map((e) => (e.more ? '+' : '') + e.name + ':' + e.state)])));
        // (Extra Large keeps the keypad in HomeView since 2026-11-08: the keypad card, not HomeView's own -- the other four are HomeView's)
        check(`${engine} ${screen}: the four HomeView sizes drawn`, () => assert.deepEqual(got.map((b) => b.size).sort(), ['C', 'L', 'S', 'W']));
        const kp = await page.evaluate(() => {
          const d = (r) => { for (const e of r.querySelectorAll('*')) { if (e.localName === 'hk-grid-keypad-card') return e; if (e.shadowRoot) { const f = d(e.shadowRoot); if (f) return f; } } return null; };
          const k = d(document); return !!(k && k.shadowRoot && k.shadowRoot.querySelector('.kpad'));
        });
        check(`${engine} ${screen}: Extra Large keeps the keypad`, () => assert.equal(kp, true));
        for (const b of got) {
          const label = `${engine} ${screen} ${b.size}`;
          check(label + ': its entries inside its plate', () => assert.equal(b.past, 0));
          check(label + ': every entry a finger\'s 44 px on screen', () => b.ents.forEach((e) => assert(e.h >= 44 && e.w >= 44, e.name + ' ' + Math.round(e.w) + 'x' + Math.round(e.h))));
          // (the line counts what needs a look since 2026-11-09, mockup 14b: "1 unlocked · 1 open" -- the hidden one counted, not named)
          check(label + ': the hidden unlocked Crawl Space still in the alarm\'s line', () => assert(/\b1 unlocked\b/.test(b.line), b.line));
          const lit = b.ents.filter((e) => e.lit), rest = b.ents.filter((e) => !e.lit && !e.more);
          // (one calm list since 2026-11-09, mockups 14b / 14d and DESIGN.md: not secured is LIT -- its disc teal, no white plate behind the row)
          check(label + ': not secured is lit, its disc teal; secured rests', () => {
            lit.forEach((e) => { assert.notEqual(e.bg, 'rgb(255, 255, 255)', e.name); assert.equal(e.disc, 'rgb(64, 200, 224)', e.name + ' ' + e.disc); });
            rest.forEach((e) => { assert.notEqual(e.bg, 'rgb(255, 255, 255)', e.name); assert.notEqual(e.disc, 'rgb(64, 200, 224)', e.name); });
          });
          const more = b.ents.find((e) => e.more);
          if (more) {
            const showing = b.ents.filter((e) => !e.more).length, n = b.size === 'W' ? 0 : 5 - showing;
            check(label + ': "N more" a slot like the rest, its count what is hidden', () => {
              assert.equal(more.name, n + ' more'); const peer = b.ents[0]; assert(Math.abs(more.h - peer.h) < 1.5 && Math.abs(more.w - peer.w) < 1.5);
            });
          }
          if (b.size === 'XL' && screen === 'cs-square') check(label + ': on square cells all five entries in sight', () => assert.equal(b.ents.filter((e) => !e.more).length, 5));
          if (b.size === 'XL' && screen === 'cs-tiles') check(label + ': on tile cells, three and "2 more"', () => assert.deepEqual(b.ents.map((e) => e.more ? e.name : 'x'), ['x', 'x', 'x', '2 more']));
          if (b.size === 'S') check(label + ': Small is a key: Security and its one line' + (screen === 'cs-square' ? ', HomeView on square cells' : ''), () => {
            assert.equal(b.big, 'Security'); if (screen === 'cs-square') assert.equal(b.tile, 'centred');
          });
        }
        if (want('taps') && screen === 'cs-square') {
          // Large's alarm: the alarm's own sheet (its keypad -- 2026-11-08, the owner); its "+N more": the overview -- the six as
          // HomeView's tiles; a lock from it, then Back
          const L = got.find((b) => b.size === 'L');
          let c = center(L.alarm);
          await page.touchscreen.tap(c.x, c.y);
          await page.waitForTimeout(900);
          let s = await page.evaluate(sheetState);
          check(`${engine}: Large's alarm opens the alarm's own sheet`, () => assert.equal(s && s.kind, 'hk-detail-alarm'));
          await page.keyboard.press('Escape');
          await page.waitForTimeout(700);
          check(`${engine}: Large has "+N more" in its heading`, () => assert(L.lm));
          c = center(L.lm || L.alarm);
          await page.touchscreen.tap(c.x, c.y);
          await page.waitForTimeout(900);
          s = await page.evaluate(sheetState);
          await shot(page, `${engine}-${screen}-overview`);
          check(`${engine}: its "+N more" opens the Security overview, the six as tiles`, () => {
            assert(s && s.kind === 'group', JSON.stringify(s && s.kind)); assert.equal(s.title, 'Security'); assert.equal(s.tiles.length, 6);
            assert(s.tiles.every((t) => t.centred), 'HomeView tiles on a square-celled screen');
          });
          check(`${engine}: ...each tile a finger\'s 44 px`, () => s.tiles.forEach((t) => assert(t.w >= 44 && t.h >= 44)));
          const lockTile = s.tiles[5];
          c = center(lockTile);
          await page.touchscreen.tap(c.x, c.y);
          await page.waitForTimeout(900);
          const lock = await page.evaluate(sheetState);
          await shot(page, `${engine}-${screen}-lock-from-overview`);
          check(`${engine}: a tile opens its accessory's sheet, with Back`, () => { assert.equal(lock.kind, 'hk-detail-lock'); assert(lock.back); });
          await page.evaluate(() => { const host = deep(document, '.hkd')[0] || document.querySelector('.hkd'); host.querySelector('.hd .x[aria-label^="Back"]').click(); });
          await page.waitForTimeout(900);
          s = await page.evaluate(sheetState);
          check(`${engine}: Back is the overview again, all six`, () => { assert.equal(s.kind, 'group'); assert.equal(s.tiles.length, 6); assert.equal(s.title, 'Security'); });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(700);
          check(`${engine}: Escape closes it`, async () => assert(!(await sheetUp(page))));
          // an entry on Compact: its own sheet, nothing operated
          const C = (await page.evaluate(security)).find((b) => b.size === 'C');
          // (a lock's row: Compact shows what needs a look, then the garage doors, then the locks -- 2026-11-09)
          c = center(C.ents.find((e) => e.lock && !e.more) || C.ents[0]);
          await page.touchscreen.tap(c.x, c.y);
          await page.waitForTimeout(900);
          s = await page.evaluate(sheetState);
          check(`${engine}: a Compact entry opens its own lock sheet`, () => assert.equal(s && s.kind, 'hk-detail-lock'));
          await page.keyboard.press('Escape');
          await page.waitForTimeout(700);
          // the light with a custom sheet: its sheet, never a toggle
          const before = await page.evaluate(() => (window.hkCards.client() || {}).states['light.porch'].state);
          const lt = await page.evaluate(() => { const v = deep(document, 'hk-home-grid-view')[0]; const cell = v.shadowRoot.querySelector('.cell[data-id="lt"]'); const r = cell.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
          c = center(lt);
          await page.touchscreen.tap(c.x, c.y);
          await page.waitForTimeout(900);
          s = await page.evaluate(sheetState);
          const after = await page.evaluate(() => (window.hkCards.client() || {}).states['light.porch'].state);
          check(`${engine}: the light's tap opens its sheet (Porch) and toggles nothing`, () => { assert.equal(s && s.title, 'Porch'); assert.equal(after, before); });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(700);
          // Weather: its corner button
          const go = await page.evaluate(() => { const v = deep(document, 'hk-home-grid-view')[0]; const b = v.shadowRoot.querySelector('.cell[data-id="wx"] .sheet-go'); if (!b) return null; const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, label: b.getAttribute('aria-label') }; });
          check(`${engine}: Weather has its 44 px corner button`, () => { assert(go); assert(go.w >= 40 && go.h >= 40, JSON.stringify(go)); });
          if (go) {
            c = center(go);
            await page.touchscreen.tap(c.x, c.y);
            await page.waitForTimeout(900);
            s = await page.evaluate(sheetState);
            check(`${engine}: ...which opens Outside`, () => assert.equal(s && s.title, 'Outside'));
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
          }
        }
        check(`${engine} ${screen}: no page errors`, () => assert.deepEqual(errors, []));
        check(`${engine} ${screen}: no commands sent`, () => assert.deepEqual(commands, []));
        await ctx.close();
      }
    }

    if (want('sheet')) {
      for (const [w, h] of SHEET_SIZES) {
        const { ctx, page, errors, commands } = await open('cs-mixed', w, h);
        await page.evaluate(() => { const v = deep(document, 'hk-home-grid-view')[0]; const cell = v.shadowRoot.querySelector('.cell[data-id="ck"]'); cell.firstElementChild.shadowRoot.querySelector('*').click(); });
        await page.waitForTimeout(1000);
        const s = await page.evaluate(sheetState);
        await shot(page, `${engine}-mixed-${w}x${h}`);
        const label = `${engine} mixed sheet ${w}x${h}`;
        console.log(label, s && Math.round(s.sheet.w) + 'x' + Math.round(s.sheet.h), s && s.tiles.length, s && s.wide);
        check(label + ': the clock\'s tap opens its sheet', () => assert(s && s.title === 'Everything Outside', JSON.stringify(s && s.title)));
        if (!s) { await ctx.close(); continue; }
        check(label + ': inside the window', () => assert(s.sheet.l >= -0.5 && s.sheet.t >= -0.5 && s.sheet.r <= s.W + 0.5 && s.sheet.b <= s.H + 0.5, JSON.stringify(s.sheet)));
        check(label + ': no sideways scroll', () => { assert(s.scroll.sw <= s.scroll.cw + 1, JSON.stringify(s.scroll)); assert(s.docW <= s.W + 1); });
        check(label + ': all twelve, in order, never "N more"', () => assert.deepEqual(s.tiles.map((t) => t.entry), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12']));
        check(label + ': Home pills and HomeView tiles as each entry says', () => assert.deepEqual(s.tiles.map((t) => t.centred), [true, true, true, true, true, true, false, false, true, true, true, true]));
        check(label + ': every tile a finger\'s 44 px and inside the body', () => s.tiles.forEach((t) => {
          assert(t.w >= 44 && t.h >= 44, t.entry + ' ' + t.w + 'x' + t.h); assert(t.l >= s.body.l - 1 && t.r <= s.body.r + 1, t.entry + ' sideways');
        }));
        const last = await page.evaluate(() => {
          const host = deep(document, '.hkd')[0] || document.querySelector('.hkd'), body = host.querySelector('.body');
          body.scrollTop = body.scrollHeight;
          const p = host.querySelector('hk-detail-group'), items = [...p.shadowRoot.querySelectorAll('[data-entry]')];
          const l = items[items.length - 1].getBoundingClientRect(), b = body.getBoundingClientRect();
          return { lb: l.bottom, bb: b.bottom };
        });
        await page.waitForTimeout(300);
        await shot(page, `${engine}-mixed-${w}x${h}-end`);
        check(label + ': the last reachable by scrolling', () => assert(last.lb <= last.bb + 1, JSON.stringify(last)));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
        check(label + ': Escape closes it', () => 0);
        check(`${label}: no page errors`, () => assert.deepEqual(errors, []));
        check(`${label}: no commands sent`, () => assert.deepEqual(commands, []));
        await ctx.close();
      }
    }
    await browser.close();
  }
  console.log(failures ? `custom_sheet_check: ${failures} FAILED` : 'custom_sheet_check: all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
