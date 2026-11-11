// house_status_check.py's browser half: House Status's blocks and sheet, in WebKit and Chromium, by touch.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const ready = require('./grid_ready.cjs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const want = (part) => !input.only.length || input.only.includes(part);

const DEEP = `window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);`;
// the sheet's sizes: the tablets across and upright, the phones, a phone on its side, and either side of the
// thresholds (640 wide: a phone; 500 tall: a short window)
const SHEET_SIZES = [[1180, 820], [1280, 800], [1366, 1024], [800, 1280], [820, 1180], [320, 667], [375, 667], [390, 844],
                     [667, 375], [844, 390], [640, 900], [641, 900], [900, 500], [900, 501], [1280, 720]].filter(([w, h]) => !(input.sizes || []).length || input.sizes.includes(w + 'x' + h));

// every block on the page: its size, what it draws, how its parts sit
function blocks() {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  return deep(document, 'hk-house-status-card').map((c) => {
    const sr = c.shadowRoot, plate = sr.querySelector('hk-plate'), pb = box(plate);
    // (the view scales its grid to the window: a block's px in its own measure)
    const k = plate.offsetWidth ? pb.w / plate.offsetWidth : 1;
    const secs = [...sr.querySelectorAll('.ln')].map((s) => {
      const v = s.querySelector('.v'), nm = s.querySelector('.nm');
      return Object.assign(box(s), { tag: s.tagName, name: nm ? nm.textContent : '', value: v ? v.textContent.replace(/\s+/g, ' ').trim() : '',
        detail: s.querySelector('.dt') ? s.querySelector('.dt').textContent : null,
        cut: !!(v && v.scrollWidth > v.clientWidth + 1), label: s.getAttribute('aria-label') });
    });
    const more = sr.querySelector('.sm-k'), all = sr.querySelector('.sm-s');
    const reach = more ? parseFloat(getComputedStyle(more, '::after').height) * k : 0;
    // the parts' ink: nothing drawn past the plate's inside
    const pad = parseFloat(getComputedStyle(plate).paddingLeft) || 0;
    // (2026-11-09: the lines are in one list that scrolls, so the list's box is what must lie inside, not a line scrolled out of it)
    const past = [...sr.querySelectorAll('.ls, .sm-h, .sm-k, .sm-s, .hl')].filter((e) => {
      const b = box(e), p = pad * k; return b.r > pb.r - p + 1 || b.b > pb.b - p + 1 || b.l < pb.l + p - 1 || b.t < pb.t + p - 1;
    }).map((e) => { const b = box(e); return e.className + ' ' + [b.l - pb.l, b.t - pb.t, pb.r - b.r, pb.b - b.b].map(Math.round).join(','); });
    // THE LIST (2026-11-09, the owner: "maybe have a vertical scroll within the card"): it scrolls where its lines do not fit, and its last line is
    // reachable; the fade (`more`) wears while there is more below
    const ls = sr.querySelector('.ls.sc');
    let sc = null;
    if (ls) {
      const before = { sh: ls.scrollHeight, ch: ls.clientHeight, more: ls.classList.contains('more'), role: ls.getAttribute('role'), oy: getComputedStyle(ls).overflowY,
        ta: getComputedStyle(ls).touchAction };
      ls.scrollTop = ls.scrollHeight;
      ls.dispatchEvent(new Event('scroll'));
      const rows = ls.querySelectorAll('.ln'), last = rows[rows.length - 1], lb = last ? last.getBoundingClientRect() : null, lr = ls.getBoundingClientRect();
      sc = Object.assign(before, { endMore: ls.classList.contains('more'), lastIn: !last || (lb.bottom <= lr.bottom + 1 && lb.top >= lr.top - 1), rows: rows.length });
      ls.scrollTop = 0; ls.dispatchEvent(new Event('scroll'));
    }
    return { size: c.getAttribute('size'), k, plate: pb, secs, sc, more: more ? Object.assign(box(more), { text: more.textContent.trim(), reach }) : null,
             small: all ? Object.assign(box(all), { text: all.textContent.replace(/\s+/g, ' ').trim() }) : null, past,
             density: (sr.querySelector('.hl') || { textContent: '' }).textContent.trim() };
  });
}

function sheetState() {
  const host = [...document.querySelectorAll('*')].concat(deep(document, '.hkd')).find((e) => e.classList && e.classList.contains('hkd'));
  if (!host) return null;
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const sheet = host.querySelector('.sheet'), body = host.querySelector('.body'), hd = host.querySelector('.hd');
  const panel = host.querySelector('hk-house-status-sheet'), sr = panel && panel.shadowRoot;
  const items = sr ? [...sr.querySelectorAll('.row, .pn')] : [];
  return {
    W: innerWidth, H: innerHeight, sheet: box(sheet), hd: box(hd), body: box(body), title: host.querySelector('.tt').textContent,
    x: box(host.querySelector('.x')), mode: panel ? panel.getAttribute('mode') : null,
    items: items.map((e) => Object.assign(box(e), { cls: e.className, name: (e.querySelector('.nm') || {}).textContent, tag: e.tagName })),
    scroll: { top: body.scrollTop, h: body.scrollHeight, ch: body.clientHeight, sw: body.scrollWidth, cw: body.clientWidth },
    note: sr && sr.querySelector('.note') ? sr.querySelector('.note').textContent : null,
    focus: (() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a ? a.tagName + '.' + a.className : null; })(),
    docW: document.scrollingElement.scrollWidth
  };
}

(async () => {
  let failures = 0;
  const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };
  const shot = async (page, name) => { if (input.shots) await page.screenshot({ path: path.join(input.shots, name + '.png') }); };

  for (const engine of input.engines) {
    const browser = await pw[engine].launch({ headless: true });
    async function open(screen, w, h, touch) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: touch !== false, locale: 'en-US' });
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
      await page.waitForFunction(() => deep(document, 'hk-house-status-card').length >= 6 &&
        deep(document, 'hk-house-status-card').every((c) => c.shadowRoot && c.shadowRoot.querySelector('.ln, .sm-s, .none')), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      return { ctx, page, errors, commands };
    }

    if (want('blocks')) {
      for (const screen of ['hs-six', 'hs-all', 'hs-tiles']) {
        const { ctx, page, errors, commands } = await open(screen, 1180, 820);
        const got = await page.evaluate(blocks);
        await shot(page, `${engine}-${screen}-blocks`);
        console.log(engine, screen, JSON.stringify(got.map((b) => [b.size, b.density, b.secs.map((s) => s.name + ':' + s.value), b.more && b.more.text, b.small && b.small.text])));
        for (const b of got) {
          const label = `${engine} ${screen} ${b.size}`;
          check(label + ': drawn inside its plate', () => assert(!b.past.length, JSON.stringify(b.past)));
          check(label + ': every section a finger tall', () => b.secs.forEach((s) => assert(s.h / b.k >= 55.5, s.name + ' ' + s.h / b.k)));
          if (b.sc) {
            check(label + ': a list of rows, contained, by finger (role=list, overflow-y, pan-y)',
              () => assert(b.sc.role === 'list' && /auto|scroll/.test(b.sc.oy) && b.sc.ta === 'pan-y', JSON.stringify(b.sc)));
            check(label + ': it scrolls where its rows do not fit, to the last row, and the fade goes at the foot', () => {
              assert(b.sc.lastIn, JSON.stringify(b.sc));
              assert(b.sc.sh > b.sc.ch + 4 ? b.sc.more && !b.sc.endMore : !b.sc.more, JSON.stringify(b.sc));
            });
          }
        }
        if (screen === 'hs-six') {
          // TAPS: a section goes to its chip's page, once; "+N more" and Small open the sheet; a row of the sheet
          // goes to its page and takes the sheet down; the keyboard's Escape gives the focus back to what opened it
          await page.evaluate(() => {
            window.__went = [];
            const sh = window.hkShell, nav = sh.navigate.bind(sh);
            sh.navigate = (p) => { window.__went.push(p); return nav(p); };
          });
          const tapIn = async (size, sel, nth) => page.evaluate(([size, sel, nth]) => {
            const c = deep(document, 'hk-house-status-card').find((x) => x.getAttribute('size') === size);
            const el = [...c.shadowRoot.querySelectorAll(sel)][nth || 0], r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: el.getAttribute('aria-label') };
          }, [size, sel, nth]);
          const sheetUp = () => page.evaluate(() => deep(document, 'hk-house-status-sheet').length > 0);
          let t = await tapIn('XL', '.ln', 4);                    // Lights
          await page.touchscreen.tap(t.x, t.y);
          await page.waitForTimeout(800);
          let went = await page.evaluate(() => window.__went.slice());
          let up = await sheetUp();
          check(`${engine} ${screen}: Lights goes to the Lights page, once (${t.name})`, () => assert.deepEqual(went, ['/' + screen + '/lights']));
          check(`${engine} ${screen}: ...and opens no sheet`, () => assert(!up));
          await page.goBack();
          await page.waitForFunction(() => deep(document, 'hk-house-status-card').length >= 6, null, { timeout: 15000 });
          await page.waitForTimeout(800);
          await page.evaluate(() => { window.__went.length = 0; });
          t = await tapIn('W', '.hl');
          await page.touchscreen.tap(t.x, t.y);
          await page.waitForTimeout(800);
          up = await sheetUp();
          check(`${engine} ${screen}: the headline (the plate's tap) opens the sheet`, () => assert(up));
          went = await page.evaluate(() => window.__went.slice());
          check(`${engine} ${screen}: ...no navigation`, () => assert.deepEqual(went, []));
          // this screen has no Energy page: Power is a readout there, no button and no chevron (never a made-up page)
          const power = await page.evaluate(() => {
            const p = deep(document, 'hk-house-status-sheet')[0], b = [...p.shadowRoot.querySelectorAll('[data-i]')].find((e) => /^Power/.test(e.getAttribute('aria-label')));
            return { tag: b.tagName, chevron: !!b.querySelector('.ch') };
          });
          check(`${engine} ${screen}: Power with no Energy page is a readout`, () => assert.deepEqual(power, { tag: 'DIV', chevron: false }));
          // a row of the sheet: Lights -> the Lights page, the sheet gone
          const row = await page.evaluate(() => {
            const p = deep(document, 'hk-house-status-sheet')[0], b = [...p.shadowRoot.querySelectorAll('[data-i]')].find((e) => /^Lights/.test(e.getAttribute('aria-label')));
            const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          });
          await page.touchscreen.tap(row.x, row.y);
          await page.waitForTimeout(900);
          went = await page.evaluate(() => window.__went.slice());
          up = await sheetUp();
          check(`${engine} ${screen}: the sheet's Lights goes to Lights, once, and the sheet goes`, () => {
            assert.deepEqual(went, ['/' + screen + '/lights']); assert(!up);
          });
          await page.goBack();
          await page.waitForFunction(() => deep(document, 'hk-house-status-card').length >= 6, null, { timeout: 15000 });
          await page.waitForTimeout(800);
          // Small, by the keyboard: focus it, Enter, Escape -> the focus is back on it
          await page.evaluate(() => { const c = deep(document, 'hk-house-status-card').find((x) => x.getAttribute('size') === 'S'); c.shadowRoot.querySelector('.sm-s').focus(); });
          await page.keyboard.press('Enter');
          await page.waitForTimeout(800);
          up = await sheetUp();
          check(`${engine} ${screen}: Small opens the sheet (the keyboard's Enter)`, () => assert(up));
          const inSheet = await page.evaluate(() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
            return !!(a && a.closest && a.closest('.sheet')); });
          check(`${engine} ${screen}: ...the focus goes into the sheet`, () => assert(inSheet));
          await page.keyboard.press('Escape');
          await page.waitForTimeout(600);
          const back = await page.evaluate(() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a ? a.className :
            null; });
          up = await sheetUp();
          check(`${engine} ${screen}: Escape closes it, the focus back on Small`, () => { assert(!up); assert(/(^| )sm-s( |$)/.test(back || ''), 'got ' + back); });
        }
        check(`${engine} ${screen}: no page errors`, () => assert.deepEqual(errors, []));
        check(`${engine} ${screen}: no commands sent`, () => assert.deepEqual(commands, []));
        await ctx.close();
      }
    }

    if (want('sheet')) {
      for (const [w, h] of SHEET_SIZES) {
        for (const screen of ['hs-six', 'hs-all']) {
          const { ctx, page, errors, commands } = await open(screen, w, h);
          await page.evaluate(() => window.hkHouseStatus.open());
          await page.waitForFunction(() => { const p = deep(document, 'hk-house-status-sheet')[0]; return p && p.shadowRoot.querySelector('.row, .pn, .none'); }, null, { timeout: 15000 });
          await page.waitForTimeout(700);
          const s = await page.evaluate(sheetState);
          await shot(page, `${engine}-${screen}-sheet-${w}x${h}`);
          const label = `${engine} ${screen} sheet ${w}x${h}`;
          console.log(label, s.mode, Math.round(s.sheet.w) + 'x' + Math.round(s.sheet.h), s.items.length);
          check(label + ': inside the window', () => { assert(s.sheet.l >= 0 && s.sheet.t >= 0 && s.sheet.r <= s.W && s.sheet.b <= s.H, JSON.stringify(s.sheet)); });
          check(label + ': no sideways scroll', () => { assert(s.scroll.sw <= s.scroll.cw + 1, JSON.stringify(s.scroll)); assert(s.docW <= s.W + 1); });
          check(label + ': every item a finger tall and inside the body', () => s.items.forEach((it) => {
            assert(it.h >= 44, it.name + ' ' + it.h); assert(it.l >= s.body.l - 1 && it.r <= s.body.r + 1, it.name + ' sideways');
          }));
          // the last reachable: scrolled to the end, it is inside the body
          const last = await page.evaluate(() => {
            const host = deep(document, '.hkd')[0] || document.querySelector('.hkd'), body = host.querySelector('.body');
            body.scrollTop = body.scrollHeight;
            const p = deep(document, 'hk-house-status-sheet')[0], items = [...p.shadowRoot.querySelectorAll('.row, .pn')];
            const l = items[items.length - 1].getBoundingClientRect(), b = body.getBoundingClientRect(), hd = host.querySelector('.hd').getBoundingClientRect();
            return { lb: l.bottom, bb: b.bottom, hdTop: hd.top };
          });
          check(label + ': the last item reachable, the header still in place', () => {
            assert(last.lb <= last.bb + 1, JSON.stringify(last)); assert(Math.abs(last.hdTop - s.hd.t) < 1, JSON.stringify(last));
          });
          if (s.items.length && w >= 900 && h >= 640) check(label + ': wide panels', () => assert.equal(s.mode, 'panels'));
          if (w <= 640) check(label + ': a phone sheet of rows', () => assert.equal(s.mode, 'rows'));
          if (screen === 'hs-all') check(label + ': the card it can\'t read is named', () => assert(/Garden Glance/.test(s.note || ''), s.note));
          // Escape closes it
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
          const gone = await page.evaluate(() => !deep(document, 'hk-house-status-sheet').length);
          check(label + ': Escape closes it', () => assert(gone));
          check(label + ': no page errors', () => assert.deepEqual(errors, []));
          check(label + ': no commands sent', () => assert.deepEqual(commands, []));
          await ctx.close();
        }
      }
    }
    await browser.close();
  }
  console.log(failures ? failures + ' failed' : 'house_status_check: all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
