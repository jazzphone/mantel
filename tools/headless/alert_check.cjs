// alert_check.py's browser half: the Alert block at every size, its taps, and Show When choosing it, in WebKit and Chromium.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const ready = require('./grid_ready.cjs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const want = (part) => !input.only.length || input.only.includes(part);

const DEEP = `window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);`;
// (the kit's key, the only control shape: 64 tall at every size, hk-kit.js KH)
const KEY = 64;

// every Alert on the page: its size, its words, its parts, and anything drawn past its plate's inset. The block is the KIT's card (hk-kit.js,
// hk-alert.js _renderKit): one lit plate of absolutely placed parts -- the headline `.kt` over its line `.kb` (Small: the tile's `.ctn` over
// `.cts`), the camera's still in `.pic`, and the action the plate's foot key `button.key` ("Close It"), whose words are its own `.kt`
function alerts() {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  return deep(document, 'hk-grid-alert-card').map((c) => {
    const sr = c.shadowRoot, plate = sr.querySelector('hk-plate'), pb = box(plate), k = plate.offsetWidth ? pb.w / plate.offsetWidth : 1;
    const hl = sr.querySelector('.ctn, .kt'), sb = sr.querySelector('.cts, .kb'), go = sr.querySelector('button.key'), pic = sr.querySelector('.pic');
    const parts = [hl, sb, go, pic].filter((e) => e && e.getClientRects().length);
    // (a key and the picture keep 8 design px from the plate's edge; the words 4, a line's box having leading around its ink)
    const past = parts.filter((e) => {
      const b = box(e), inset = (e === hl || e === sb ? 4 : 8) * k - 1;
      return b.l < pb.l + inset || b.t < pb.t + inset || b.r > pb.r - inset || b.b > pb.b - inset;
    }).map((e) => { const b = box(e); return e.className + ' ' + [b.l - pb.l, b.t - pb.t, pb.r - b.r, pb.b - b.b].map(Math.round).join(','); });
    const still = pic ? deep(pic, 'img, canvas').some((i) => i.getBoundingClientRect().width > 10) : false;
    return { size: c.getAttribute('size'), k, title: hl ? hl.textContent : '', sub: sb ? sb.textContent : '', past,
             cut: !!(hl && hl.scrollWidth > hl.clientWidth + 1),
             go: go ? Object.assign(box(go), { text: go.textContent.trim(), label: go.getAttribute('aria-label') }) : null,
             pic: pic ? Object.assign(box(pic), { still }) : null, plate: pb };
  });
}

(async () => {
  let failures = 0;
  const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };
  const shot = async (page, name) => { if (input.shots) await page.screenshot({ path: path.join(input.shots, name + '.png') }); };
  const move = async (states) => {
    const r = await fetch(input.origin + '/__alert_check/move?s=' + encodeURIComponent(JSON.stringify(states)), { headers: { cookie: 'mantel_session=' + input.cookie } });
    assert.equal(r.status, 200, 'the house did not move: ' + r.status);
  };

  for (const engine of input.engines) {
    const browser = await pw[engine].launch({ headless: true });
    async function open(screen, sel) {
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US' });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage();
      const errors = [], commands = [];
      page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|aborted|net::|WebSocket/.test(m.text())) errors.push('console: ' + m.text()); });
      page.on('websocket', (ws) => ws.on('framesent', (f) => { if (/"type"\s*:\s*"command"/.test(String(f.payload))) commands.push(String(f.payload).slice(0, 200)); }));
      for (let attempt = 0; ; attempt++) {
        await page.goto(input.origin + '/' + screen + '/home', { waitUntil: 'commit' });
        try { await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 }); break; }
        catch (e) { if (attempt >= 1) throw new Error(screen + ': the page never got ready'); }
      }
      await ready(page);
      await page.evaluate(DEEP);
      await page.waitForFunction((sel) => deep(document, sel).length > 0 && deep(document, sel).every((c) => c.shadowRoot && c.shadowRoot.querySelector('hk-plate')), sel, { timeout: 30000 });
      await page.waitForTimeout(1500);
      // what a tap opens, said and not opened: the sheets themselves are other checks'
      await page.evaluate(() => { window.__info = []; window.hkShell.moreInfo = (id) => { window.__info.push(id); }; });
      return { ctx, page, errors, commands };
    }

    if (want('sizes')) {
      for (const [screen, cam] of [['al-square', true], ['al-tiles', true], ['al-nocam', false]]) {
        const { ctx, page, errors, commands } = await open(screen, 'hk-grid-alert-card');
        await page.waitForTimeout(cam ? 1500 : 200);                 // (the stills come in)
        const got = await page.evaluate(alerts);
        await shot(page, `${engine}-${screen}`);
        console.log(engine, screen, JSON.stringify(got.map((b) => [b.size, b.title, b.sub, b.go && b.go.text, b.pic && [Math.round(b.pic.w / b.k), Math.round(b.pic.h / b.k), b.pic.still]])));
        check(`${engine} ${screen}: eight alerts`, () => assert.equal(got.length, 8));
        for (const b of got) {
          const garage = b.title === 'Garage Still Open', label = `${engine} ${screen} ${b.size} ${garage ? 'garage' : 'laundry'}`;
          check(label + ': drawn inside its plate', () => assert(!b.past.length, JSON.stringify(b.past)));
          check(label + ': the headline whole', () => assert(!b.cut, b.title));
          if (garage) {
            check(label + ': the line counts from when the door opened', () => assert(/^Open for 2[34] min$/.test(b.sub), b.sub));
            if (b.size === 'S') check(label + ': Small has no key (its plate is the action)', () => assert.equal(b.go, null));
            else check(label + ': one action, a key tall, saying Close It', () => {
              assert(b.go && /^Close It$/.test(b.go.text), JSON.stringify(b.go));
              assert(Math.abs(b.go.h / b.k - KEY) < 1, b.go.h / b.k);
              assert(/opens its controls/.test(b.go.label), b.go.label);
            });
            // (the kit's Small is the lit tile and its Wide a header over its key: neither has room for the camera's still)
            if (cam && b.size !== 'S' && b.size !== 'W') check(label + ': its picture, with a still', () => assert(b.pic && b.pic.still, JSON.stringify(b.pic)));
            else if (cam) check(label + ': no room for the picture (Small is the tile, Wide a header over its key)', () => assert.equal(b.pic, null));
            else check(label + ': no camera, no picture, the words and the action stay', () => assert(!b.pic && b.title && (b.size === 'S' || b.go), JSON.stringify(b)));
          } else {
            check(label + ': an unavailable camera is no picture', () => assert.equal(b.pic, null));
            check(label + ': its own words, and how long', () => assert(/^Cycle complete · /.test(b.sub), b.sub));
            check(label + ': no action of its own', () => assert.equal(b.go, null));
          }
        }
        check(`${engine} ${screen}: no page errors`, () => assert(!errors.length, errors.join(' | ')));
        check(`${engine} ${screen}: not one command`, () => assert(!commands.length, commands.join(' | ')));
        await ctx.close();
      }
    }

    if (want('taps')) {
      const { ctx, page, errors, commands } = await open('al-square', 'hk-grid-alert-card');
      await page.waitForTimeout(1500);
      const center = (size, sel, title) => page.evaluate(([size, sel, title]) => {
        const c = deep(document, 'hk-grid-alert-card').find((x) => x.getAttribute('size') === size && x.shadowRoot.querySelector('.ctn, .kt').textContent === title);
        const r = c.shadowRoot.querySelector(sel).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      }, [size, sel, title]);
      const tap = async (size, sel, title) => {
        await page.evaluate(() => { window.__info = []; });
        const [x, y] = await center(size, sel, title || 'Garage Still Open');
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(500);
        return page.evaluate(() => window.__info.slice());
      };
      for (const size of ['W', 'T', 'L', 'XL']) {
        const went = await tap(size, 'button.key');
        check(`${engine} ${size}: the action opens the garage door's own controls, once`, () => assert.deepEqual(went, ['cover.garage_door']));
        // (Wide, the kit's header over its key, has no room for the still)
        if (size !== 'W') {
          const pic = await tap(size, '.pic');
          check(`${engine} ${size}: the picture opens the camera, once`, () => assert.deepEqual(pic, ['camera.garage']));
        }
        const plate = await tap(size, '.kt');
        check(`${engine} ${size}: the plate opens the door's sheet`, () => assert.deepEqual(plate, ['cover.garage_door']));
      }
      const small = await tap('S', '.ctn');
      check(`${engine} S: Small's plate is the action`, () => assert.deepEqual(small, ['cover.garage_door']));
      const lp = await tap('L', '.kt', 'Laundry Ready');
      check(`${engine} laundry L: without an action or a still, the plate opens the washer's sheet`, () => assert.deepEqual(lp, ['sensor.washer_job_state']));
      check(`${engine} taps: no page errors`, () => assert(!errors.length, errors.join(' | ')));
      check(`${engine} taps: not one command`, () => assert(!commands.length, commands.join(' | ')));
      await ctx.close();
    }

    if (want('rules')) {
      const { ctx, page, errors, commands } = await open('al-rules', 'hk-house-status-card');
      // what each House Status block shows now: 'status', or an alert's headline, or another card
      const shown = () => page.evaluate(() => deep(document, 'hk-grid-conditional-card').map((c) => {
        const a = deep(c.shadowRoot || c, 'hk-grid-alert-card')[0], h = deep(c.shadowRoot || c, 'hk-house-status-card')[0];
        return a ? a.shadowRoot.querySelector('.ctn, .kt').textContent : h ? 'status' : 'other';
      }));
      const until = async (want, what) => {
        try { await page.waitForFunction((w) => JSON.stringify(deep(document, 'hk-grid-conditional-card').map((c) => {
          const a = deep(c.shadowRoot || c, 'hk-grid-alert-card')[0], h = deep(c.shadowRoot || c, 'hk-house-status-card')[0];
          return a && a.shadowRoot && a.shadowRoot.querySelector('.ctn, .kt') ? a.shadowRoot.querySelector('.ctn, .kt').textContent : h ? 'status' : 'other';
        })) === JSON.stringify(w), want, { timeout: 10000 }); } catch (e) { /* said below */ }
        const got = await shown();
        check(`${engine} rules: ${what}`, () => assert.deepEqual(got, want));
      };
      await until(['status', 'status'], 'House Status by default');
      await move({ 'binary_sensor.garage_door_open_too_long': 'on' });
      await until(['Garage Still Open', 'Garage Still Open'], 'the garage open too long: its alert, in both blocks\' places');
      await page.waitForTimeout(800);
      await shot(page, `${engine}-al-rules-garage`);
      await move({ 'sensor.washer_job_state': 'finish' });
      await page.waitForTimeout(800);
      await until(['Garage Still Open', 'Garage Still Open'], 'the laundry done too: still the garage (first match wins)');
      await move({ 'binary_sensor.garage_door_open_too_long': 'off' });
      await until(['Laundry Ready', 'Laundry Ready'], 'the garage closed: the laundry\'s');
      await page.waitForTimeout(800);
      await shot(page, `${engine}-al-rules-laundry`);
      await move({ 'sensor.washer_job_state': 'none' });
      await until(['status', 'status'], 'the laundry emptied: House Status again');
      check(`${engine} rules: no page errors`, () => assert(!errors.length, errors.join(' | ')));
      check(`${engine} rules: not one command`, () => assert(!commands.length, commands.join(' | ')));
      await ctx.close();
    }
    await browser.close();
  }
  console.log(failures ? failures + ' failed' : 'alert_check: all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
