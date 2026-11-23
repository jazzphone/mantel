// laundry_check.py's browser half: the Laundry block at every size, its taps, its sheet, its room tile and chip, in WebKit and Chromium.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const ready = require('./grid_ready.cjs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const want = (part) => !input.only.length || input.only.includes(part);
const HOUSE = input.two ? 'two' : 'one';

const DEEP = `window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);`;

// every Laundry block on the page: its size, its words, and anything drawn past its plate's inset or cut short. The block is the KIT's card
// (hk-kit.js, round 12: one plate of absolutely placed parts): the drawing in an `.a` holding svg.hkla, the words `.kd` (the state in display
// type, Extra Large), `.kt` (a name, or a reading's value), `.kb` (what it is doing, the time, a reading's name), `.kl` (a machine's name,
// a step's name), a step a 6 px bar (an `.a` holding an `<i>` filled to how far it is), a reading a button.row followed by its value and
// name, a key a button.key, a machine's half a button.hit
function blocks() {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  return deep(document, 'hk-grid-laundry-card').map((c) => {
    const sr = c.shadowRoot, plate = sr.querySelector('hk-plate'), pb = box(plate), k = plate.offsetWidth ? pb.w / plate.offsetWidth : 1;
    const words = '.kd, .kt, .kb, .kl';
    // (a key keeps 8 design px from the plate's edge; the words and the drawing 4: a short cell's tile centers its drawing and words 5 or 6 px
    // from the edge, a line's box having leading around its ink; the drawing's heat lines and badge are inside its own box)
    const parts = [...sr.querySelectorAll(words + ', .key, .a:has(svg.hkla), .a:has(> i)')].filter((e) => e.getClientRects().length);
    const past = parts.filter((e) => {
      const b = box(e), inset = (e.matches('.key') ? 8 : 4) * k - 1;
      return b.l < pb.l + inset || b.t < pb.t + inset || b.r > pb.r - inset || b.b > pb.b - inset;
    }).map((e) => { const b = box(e); return e.className + ' ' + [b.l - pb.l, b.t - pb.t, pb.r - b.r, pb.b - b.b].map(Math.round).join(','); });
    const cut = [...sr.querySelectorAll(words)].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
    const text = (s) => [...sr.querySelectorAll(s)].filter((e) => e.getClientRects().length).map((e) => e.textContent);
    // the steps: each bar's fill, and the name under it (where it has room for one)
    const bars = [...sr.querySelectorAll('.a:has(> i)')].map((e) => ({ fill: e.firstElementChild.style.width, name: ((e.nextElementSibling || {}).className || '').includes('kl') ? e.nextElementSibling.textContent : '' }));
    // the readings under the steps: a row's value, then its name
    const rows = [...sr.querySelectorAll('button.row')].map((e) => [(e.nextElementSibling || e).textContent, ((e.nextElementSibling || e).nextElementSibling || e).textContent]);
    return { size: c.getAttribute('size'), past, cut, titles: text('.kd'), lines: text('.kb'), names: text('.kt, .kl, .kd'),
             steps: bars.map((x) => x.name).filter(Boolean), fills: bars.map((x) => x.fill), pills: text('.key'), arts: sr.querySelectorAll('svg.hkla').length, drawn: [...sr.querySelectorAll('svg.hkla')].map((e) => (e.getAttribute('class').match(/s-(\w+)/) || [])[1]),
             halves: sr.querySelectorAll('button.hit').length, rows,
             foot: Math.round(pb.b - Math.max(...parts.map((e) => box(e).b))) };
  });
}

// BREATHING ROOM (the owner, 2026-11-10: "the text is almost running into the Vacuum glyph"): in each block, the least clear space between
// a line of words and the drawing's ink -- the machine (its trimmed box), or the vacuum's glyph -- where the two face each other
function gaps(tag) {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  return deep(document, tag).map((c) => {
    const sr = c.shadowRoot, k = (() => { const p = sr.querySelector('hk-plate'); return p && p.offsetWidth ? p.getBoundingClientRect().width / p.offsetWidth : 1; })();
    const ink = [...sr.querySelectorAll('.art svg.hkla .mach, .art .hkva .gl')].filter((e) => e.getClientRects().length).map(box);
    const words = [...sr.querySelectorAll('*')].filter((e) => !e.closest('.art') && [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) && e.getClientRects().length).map(
      (e) => [e, box(e)]);
    let least = Infinity, who = '';
    ink.forEach((a) => words.forEach(([e, w]) => {
      const vo = Math.min(a.b, w.b) - Math.max(a.t, w.t), ho = Math.min(a.r, w.r) - Math.max(a.l, w.l);
      let d = null;
      if (vo > 0 && ho > 0) d = -1;                                   // (on top of each other)
      else if (vo > 0) d = Math.max(a.l - w.r, w.l - a.r);            // side by side
      else if (ho > 0) d = Math.max(a.t - w.b, w.t - a.b);            // one over the other
      if (d !== null && d / k < least) { least = d / k; who = e.textContent.trim().slice(0, 24); }
    }));
    return { size: c.getAttribute('size') || (c._config && c._config.size), least: least === Infinity ? null : Math.round(least), who };
  });
}

(async () => {
  let failures = 0;
  const check = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };
  const shot = async (page, name) => { if (input.shots) await page.screenshot({ path: path.join(input.shots, name + '.png') }); };

  for (const engine of input.engines) {
    const browser = await pw[engine].launch({ headless: true });
    async function open(screen, sel, size, page_) {
      const ctx = await browser.newContext({ viewport: size || { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US' });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage();
      const errors = [], commands = [];
      page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|aborted|net::|WebSocket/.test(m.text())) errors.push('console: ' + m.text()); });
      page.on('websocket', (ws) => ws.on('framesent', (f) => { if (/"type"\s*:\s*"command"/.test(String(f.payload))) commands.push(String(f.payload).slice(0, 200)); }));
      for (let attempt = 0; ; attempt++) {
        await page.goto(input.origin + '/' + screen + '/' + (page_ || 'home'), { waitUntil: 'commit' });
        try { await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 }); break; }
        catch (e) { if (attempt >= 1) throw new Error(screen + ': the page never got ready'); }
      }
      await ready(page);
      await page.evaluate(DEEP);
      await page.waitForFunction((sel) => deep(document, sel).length > 0, sel, { timeout: 30000 });
      await page.waitForTimeout(1500);
      return { ctx, page, errors, commands };
    }

    if (want('sizes')) {
      for (const screen of ['la-square', 'la-tiles']) {
        const { ctx, page, errors, commands } = await open(screen, 'hk-grid-laundry-card');
        const got = await page.evaluate(blocks);
        await shot(page, `${engine}-${HOUSE}-${screen}`);
        console.log(engine, HOUSE, screen, JSON.stringify(got.map((b) => [b.size, b.titles, b.lines, b.fills.length, b.pills, b.foot])));
        check(`${engine} ${HOUSE} ${screen}: five blocks`, () => assert.equal(got.length, 5));
        for (const b of got) {
          const label = `${engine} ${HOUSE} ${screen} ${b.size}`;
          check(label + ': drawn inside its plate', () => assert(!b.past.length, JSON.stringify(b.past)));
          check(label + ': no words cut short', () => assert(!b.cut.length, JSON.stringify(b.cut)));
          if (!input.two) {
            // (one machine: the plate is the machine, drawn by what it does -- the drawing's own state class -- and named. Where a line has no room
            // for "Drying · 24 min left" (Tall) the card says the short "24 min left", the drawing still drying)
            check(label + ': the washer-dryer, drying', () => assert(b.arts === 1 && b.names.includes('Washer') && b.drawn[0] === 'drying', JSON.stringify(b)));
            check(label + ': how long', () => assert(b.lines.some((s) => /(^|\u00B7 )(1[89]|2[0-4]) min left$/.test(s)), JSON.stringify(b.lines)));
            // Wash, Rinse and Spin done whole, Dry half (the one it is in); a name under each bar where the block has room (Large and Extra Large)
            if (b.size !== 'S') check(label + ': its four steps, Dry now', () => {
              assert.deepEqual(b.fills, ['100%', '100%', '100%', '50%']);
              if (b.size === 'L' || b.size === 'XL') assert.deepEqual(b.steps, ['Wash', 'Rinse', 'Spin', 'Dry']);
            });
            check(label + ': no keys while remote control is off', () => assert.deepEqual(b.pills, []));
            // (THIS LOAD'S POWER, 2026-11-10, now a reading of the kit's Extra Large (hkLaundry.facts: "Cycle", then "Power"): the circuit's watts
            // in a row where the block has the room for it -- the square cell's. The kit's card has no graph of the load's watts, and Large
            // has no readings: its words, steps and keys only.)
            if (b.size === 'XL') check(label + ': this load\'s power, its watts, and the cycle\'s settings under the finish', () => {
              assert.deepEqual(b.rows[0], ['Cold \u00B7 Extra High Spin \u00B7 Normal Soil', 'Cycle']);
              if (screen === 'la-square') assert.deepEqual(b.rows[1], ['1,840 W', 'Power']);
            });
          } else if (b.size === 'S') {
            check(label + ': the one done soonest, and +1', () => assert(b.arts === 1 && b.names.includes('Washer') && b.lines.some((s) => /(^|\u00B7 )[3-7] min left$/.test(s)), JSON.stringify(b)));
          } else {
            check(label + ': both machines, each its own half', () => assert(b.arts === 2 && b.halves === 2 && b.names.includes('Washer') && b.names.includes('Dryer'), JSON.stringify(b)));
          }
        }
        check(`${engine} ${HOUSE} ${screen}: no page errors`, () => assert(!errors.length, errors.join(' | ')));
        check(`${engine} ${HOUSE} ${screen}: not one command`, () => assert(!commands.length, commands.join(' | ')));
        await ctx.close();
      }
    }

    if (want('taps') || want('sheet')) {
      for (const view of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
        const phone = view.width < 640;
        const { ctx, page, errors, commands } = await open('la-square', 'hk-grid-laundry-card', view);
        // a tap on the Large block (on two machines, on the second's half): the laundry sheet, at the sheets' own size
        const at = await page.evaluate((two) => {
          const c = deep(document, 'hk-grid-laundry-card').find((x) => x.getAttribute('size') === (two ? 'L' : 'L'));
          c.scrollIntoView({ block: 'center' });
          const el = two ? c.shadowRoot.querySelectorAll('button.hit')[1] : c.shadowRoot.querySelector('.kt, .kl, .kd');
          const r = el.getBoundingClientRect();
          return [r.left + r.width / 2, r.top + r.height / 2];
        }, input.two);
        await page.touchscreen.tap(at[0], at[1]);
        try { await page.waitForFunction(() => deep(document, 'hk-detail-laundry').length > 0, null, { timeout: 8000 }); } catch (e) { /* said below */ }
        await page.waitForTimeout(2500);
        const sh = await page.evaluate(() => {
          const p = deep(document, 'hk-detail-laundry')[0];
          if (!p) return null;
          const sheet = p.closest('.sheet') || p.getRootNode().host && p.getRootNode().querySelector('.sheet');
          const box = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width),
            h: Math.round(r.height) }; };
          const sr = p.shadowRoot, lft = sr.querySelector('.lft'), rgt = sr.querySelector('.rgt');
          const cut = [...sr.querySelectorAll('.big, .muted, .rows b, .seg button, .trk .lb')].filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
          return { wide: p.hasAttribute('wide'), sheet: sheet ? box(sheet) : null, lft: box(lft), rgt: box(rgt), panel: box(p),
                   big: sr.querySelector('.big').textContent, seg: [...sr.querySelectorAll('.seg button')].map((b) => [b.textContent, b.classList.contains('on')]),
                   steps: [...sr.querySelectorAll('.trk .lb')].map((e) => e.textContent), rows: [...sr.querySelectorAll('.rows .r')].map((e) => e.textContent),
                   keys: [...sr.querySelectorAll('.keys .btn')].map((b) => [b.textContent, b.disabled]), why: sr.querySelector('.why').hidden ? '' : sr.querySelector('.why').textContent, cut };
        });
        await shot(page, `${engine}-${HOUSE}-sheet-${view.width}`);
        console.log(engine, HOUSE, 'sheet', view.width, JSON.stringify(sh));
        const label = `${engine} ${HOUSE} sheet at ${view.width}`;
        check(label + ': a tap on the block opens the laundry sheet', () => assert(sh));
        if (sh) {
          check(label + ': no words cut short', () => assert(!sh.cut.length, JSON.stringify(sh.cut)));
          if (!phone) {
            check(label + ': the Wide sheet (820) at the one sheet height (680)', () => {
              assert(sh.sheet, 'no sheet');
              assert(sh.wide, 'not two columns');
              assert(Math.abs(sh.sheet.h - 680) <= 2, 'height ' + sh.sheet.h);
              assert(Math.abs(sh.sheet.w - 820) <= 2, 'width ' + sh.sheet.w);
            });
            check(label + ': the two columns share their top and foot', () => {
              assert(Math.abs(sh.lft.t - sh.rgt.t) <= 1 && Math.abs(sh.lft.b - sh.rgt.b) <= 1, JSON.stringify([sh.lft, sh.rgt]));
            });
          } else {
            check(label + ': one column on a phone', () => assert(!sh.wide && sh.rgt.t >= sh.lft.b - 1, JSON.stringify([sh.lft, sh.rgt])));
          }
          if (input.two) {
            check(label + ': the machine tapped, and a switch to the other', () => assert.deepEqual(sh.seg, [['Washer', false], ['Dryer', true]]));
            check(label + ': the dryer drying, its two steps', () => assert(sh.big === 'Drying' && sh.steps.join() === 'Dry,Cool', JSON.stringify(sh)));
          } else {
            check(label + ': drying, its steps, its readings', () => assert(sh.big === 'Drying' && sh.steps.join() === 'Wash,Rinse,Spin,Dry' && sh.rows.some((r) => /Remote ControlOff/.test(r)),
              JSON.stringify(sh)));
            check(label + ': Pause and Stop dimmed, and why', () => assert(sh.keys.length === 2 && sh.keys.every((k) => k[1]) && /Remote Control/.test(sh.why), JSON.stringify([sh.keys, sh.why])));
          }
        }
        check(`${label}: no page errors`, () => assert(!errors.length, errors.join(' | ')));
        check(`${label}: not one command`, () => assert(!commands.length, commands.join(' | ')));
        await ctx.close();
      }
    }

    if (want('gaps')) {
      for (const [screen, tag] of [['la-square', 'hk-grid-laundry-card'], ['la-tiles', 'hk-grid-laundry-card'], ['la-vac', 'hk-vacuum-card, hk-grid-vacuum-card']]) {
        const { ctx, page, errors } = await open(screen, tag.split(',')[0]);
        await page.evaluate('window.gaps = ' + gaps.toString());
        const got = await page.evaluate((t) => t.split(', ').flatMap((x) => gaps(x)), tag);
        await shot(page, `${engine}-${HOUSE}-${screen}-gaps`);
        console.log(engine, HOUSE, screen, 'gaps', JSON.stringify(got));
        for (const g of got) {
          if (g.least === null) continue;                            // (no drawing at this size)
          check(`${engine} ${HOUSE} ${screen} ${g.size}: 14 px or more between the words and the drawing`, () => assert(g.least >= 14, g.least + ' px from "' + g.who + '"'));
        }
        check(`${engine} ${HOUSE} ${screen}: no page errors`, () => assert(!errors.length, errors.join(' | ')));
        await ctx.close();
      }
    }

    if (want('room')) {
      const { ctx, page, errors, commands } = await open('la-room', 'hk-tall-card[data-laundry], hk-tall-card', null, 'laundry');
      const got = await page.evaluate(() => deep(document, 'hk-tall-card').filter((c) => (c._config || {}).label_mode === 'laundry').map((c) => {
        const sr = c.shadowRoot;
        return { name: (c._config || {}).name, text: (sr.textContent || '').replace(/\s+/g, ' ').trim(), animated: !!sr.querySelector('svg.hkla'),
                 icon: (sr.querySelector('hk-state-icon, hk-icon') || {}).getAttribute ? (sr.querySelector('hk-icon') || sr.querySelector('hk-state-icon')).getAttribute('icon') : null };
      }));
      const chip = await page.evaluate(() => deep(document, '[data-kind="laundry"], .chip').map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter((t) => /Laundry|min|Done/.test(t)));
      await page.evaluate(() => { const t = deep(document, 'hk-tall-card').find((c) => (c._config || {}).label_mode === 'laundry'); if (t) t.scrollIntoView({ block: 'center' }); });
      await page.waitForTimeout(600);
      await shot(page, `${engine}-${HOUSE}-room`);
      console.log(engine, HOUSE, 'room', JSON.stringify(got), JSON.stringify(chip.slice(0, 3)));
      check(`${engine} ${HOUSE} room: a tile for each machine`, () => assert.equal(got.length, input.two ? 2 : 1, JSON.stringify(got)));
      check(`${engine} ${HOUSE} room: the house glyph, still (no drawing on a tile)`, () => assert(got.every((t) => !t.animated), JSON.stringify(got)));
      check(`${engine} ${HOUSE} room: no page errors`, () => assert(!errors.length, errors.join(' | ')));
      check(`${engine} ${HOUSE} room: not one command`, () => assert(!commands.length, commands.join(' | ')));
      await ctx.close();
    }
    await browser.close();
  }
  console.log(failures ? failures + ' failed' : 'laundry_check (' + HOUSE + '): all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
