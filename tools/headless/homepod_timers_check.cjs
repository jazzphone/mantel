'use strict';
// homepod_timers_check.py's browser half: HomePod timers on the Timers page, in its sheet and in Settings, WebKit and
// Chromium, by touch (docs/phase28/HOMEPOD-TIMERS.md).
const fs = require('fs');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const HP = input.homepods;            // label -> helper (Pasta: Kitchen, running; Timer: Bedroom, paused; Tea: a room not matched)
let fails = 0;
const say = (ok, what, detail) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok || detail === undefined ? '' : '   ' + JSON.stringify(detail).slice(0, 500))); };
const DEEP = `window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);`;

// every timer card on the Timers page: its name, sub-line, glyph and keys
function cards() {
  return deep(document, '.tc').filter((c) => c.getClientRects().length).map((c) => {
    const r = c.getBoundingClientRect(), head = c.querySelector('.head');
    const lines = head ? [...head.querySelectorAll('div')].filter((d) => !d.children.length).map((d) => d.textContent.trim()).filter(Boolean) : [];
    return { name: lines[0], sub: lines[1], glyph: (c.querySelector('.head hk-icon') || {}).getAttribute ? c.querySelector('.head hk-icon').getAttribute('icon') : null,
             keys: [...c.querySelectorAll('.tb')].map((b) => b.textContent.trim()), box: [r.left, r.top, r.right, r.bottom].map(Math.round) };
  });
}

(async () => {
  for (const engine of input.engines) {
    const browser = await pw[engine].launch({ headless: true });
    for (const [size, W, H] of input.sizes) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US' });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage(), errors = [], sent = [];
      page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|aborted|net::|WebSocket/.test(m.text())) errors.push('console: ' + m.text()); });
      page.on('websocket', (ws) => ws.on('framesent', (f) => { const t = String(f.payload); if (/"type"\s*:\s*"command"/.test(t)) sent.push(JSON.parse(t)); }));
      const t = `${engine} ${size}`;
      await page.request.get(input.origin + '/__check/flip?broken=0');
      await page.goto(input.origin + '/' + input.screen + '/timers', { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
      await page.evaluate(DEEP);
      const got = await page.waitForFunction(() => deep(document, '.tc').filter((c) => c.getClientRects().length).length >= 4, null, { timeout: 30000 }).then(() => true, () => false);
      say(got, `${t}: the Timers page draws the four timers`);
      await page.waitForTimeout(800);
      const cs = await page.evaluate(cards), by = (n) => cs.find((c) => c.name === n) || {};
      say(by('Pasta').glyph === 'hk:homepod' && /Running · Kitchen HomePod/.test(by('Pasta').sub || ''), `${t}: a HomePod's card wears its glyph and says where it rings`, by('Pasta'));
      say(JSON.stringify(by('Pasta').keys) === '["Pause","Cancel"]', `${t}: ...Pause and Cancel only`, by('Pasta').keys);
      say(JSON.stringify(by('Timer').keys) === '["Resume","Cancel"]' && /Paused · Bedroom HomePod mini/.test(by('Timer').sub || ''), `${t}: a paused one: Resume and Cancel`, by('Timer'));
      say(/Sunroom HomePod/.test(by('Tea').sub || ''), `${t}: a Home app room Mantel doesn't have is shown by its own name`, by('Tea'));
      say(by('Oven').keys && by('Oven').keys.length === 4 && by('Oven').glyph !== 'hk:homepod', `${t}: Mantel's own timer keeps its four keys`, by('Oven'));
      const docW = await page.evaluate(() => document.scrollingElement.scrollWidth);
      say(docW <= W && cs.every((c) => c.box[0] >= 0 && c.box[2] <= W + 0.5), `${t}: nothing past the window`, { docW, boxes: cs.map((c) => c.box) });
      if (input.shots) await page.screenshot({ path: path.join(input.shots, `${engine}-${size}-timers.png`) });
      // PAUSE: to the reader, through the gateway, with its HomePod, row and label
      // a key's middle, once it holds still (the page may still be scrolling it into view), then a finger on it
      const tap = async (name, key) => {
        const where = () => page.evaluate(([name, key]) => { const c = deep(document, '.tc').find((x) => x.getClientRects().length && x.querySelector('.head').textContent.includes(name));
          const b = [...c.querySelectorAll('.tb')].find((x) => x.textContent.trim() === key); const r = b.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), in: r.top >= 0 && r.bottom <= innerHeight }; }, [name, key]);
        await page.evaluate(([name, key]) => { const c = deep(document, '.tc').find((x) => x.getClientRects().length && x.querySelector('.head').textContent.includes(name));
          [...c.querySelectorAll('.tb')].find((x) => x.textContent.trim() === key).scrollIntoView({ block: 'center' }); }, [name, key]);
        let at = await where();
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(150);
          const now = await where();
          if (now.x === at.x && now.y === at.y && now.in) break;
          at = now;
        }
        await page.touchscreen.tap(at.x, at.y);
        await page.waitForTimeout(400);
      };
      // what the stand-in reader was sent since `from`, once `n` have come (a command can take a while under load)
      const sentSince = async (from, n) => {
        for (let i = 0; i < 40; i++) {
          const got = (await (await page.request.get(input.origin + '/__check/posts')).json()).slice(from);
          if (got.length >= n) return got;
          await page.waitForTimeout(250);
        }
        return (await (await page.request.get(input.origin + '/__check/posts')).json()).slice(from);
      };
      const before = (await (await page.request.get(input.origin + '/__check/posts')).json()).length;
      await tap('Pasta', 'Pause');
      await sentSince(before, 1);
      await tap('Timer', 'Cancel');
      const posts = await sentSince(before, 2);
      const frames = sent.filter((f) => f.domain === 'timer').map((f) => [f.service, (f.target || {}).entity_id || (f.data || {}).entity_id]);
      say(JSON.stringify(frames) === JSON.stringify([['pause', HP.Pasta], ['cancel', HP.Timer]]), `${t}: the keys send the HomePod's pause and cancel`, frames);
      say(posts.length === 2 && posts[0][1].action === 'pause' && posts[0][1].id === 't-pasta' &&
          posts[1][1].action === 'cancel' && posts[1][1].tile === 'Bedroom-HomePod-mini-TileCell', `${t}: ...and they reach the reader`, posts);
      // THE ALARMS, under Running: each row, its switch, and Edit's Delete after its confirmation
      const alarms = await page.evaluate(() => deep(document, '.al .ar').filter((r) => r.getClientRects().length).map((r) => ({
        time: r.querySelector('.at').textContent, words: r.querySelector('.as').textContent, on: (r.querySelector('.sw') || {}).checked, off: r.classList.contains('off') })));
      say(alarms.length === 2 && alarms[0].time === '6:30AM' && alarms[0].on === true && /Bedroom HomePod mini · Weekdays/.test(alarms[0].words) &&
          alarms[1].time === '9:00PM' && alarms[1].on === false && alarms[1].off, `${t}: the alarms: time, where, on or off`, alarms);
      const at = (sel, i) => page.evaluate(([sel, i]) => { const e = deep(document, sel).filter((x) => x.getClientRects().length)[i || 0]; e.scrollIntoView({ block: 'center' });
        const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: [r.left, r.right] }; }, [sel, i]);
      const abefore = (await (await page.request.get(input.origin + '/__check/posts')).json()).length;
      const sw = await at('.al .sw', 1);
      say(sw.r[1] <= W, `${t}: the switch inside the window`, sw);
      await page.touchscreen.tap(sw.x, sw.y);
      await sentSince(abefore, 1);
      const ed = await at('.al .ed');
      await page.touchscreen.tap(ed.x, ed.y);
      await page.waitForTimeout(300);
      const mi = await at('.al .mi', 0);
      await page.touchscreen.tap(mi.x, mi.y);
      const yes = await page.waitForFunction(() => { const s = document.getElementById('hk-confirm'); return s && s.hasAttribute('data-open') ? s.textContent : null; }, null,
        { timeout: 5000 }).then((h) => h.jsonValue(), () => null);
      say(/Delete the 6:30 AM Alarm\?/.test(yes || '') && /Bedroom HomePod mini/.test(yes || ''), `${t}: Delete asks first`, yes);
      if (input.shots) await page.screenshot({ path: path.join(input.shots, `${engine}-${size}-alarm-delete.png`) });
      await page.evaluate(() => document.querySelector('#hk-confirm [data-yes]').click());
      const aposts = (await sentSince(abefore, 2)).filter((p) => p[0] === '/alarm');
      say(aposts.length === 2 && aposts[0][1].action === 'on' && aposts[0][1].time === '9:00 PM' && aposts[1][1].action === 'delete' && aposts[1][1].time === '6:30 AM',
        `${t}: the switch and Delete reach the reader`, aposts);
      await page.evaluate(() => { const b = deep(document, '.al .ed')[0]; if (b && b.textContent === 'Done') b.click(); });
      // ITS SHEET: the head's tap
      const head = await page.evaluate(() => { const c = deep(document, '.tc').find((x) => x.getClientRects().length && x.querySelector('.head').textContent.includes('Pasta'));
        const h = c.querySelector('.head'); h.scrollIntoView({ block: 'center' }); const r = h.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
      await page.touchscreen.tap(head.x, head.y);
      const sheet = await page.waitForFunction(() => { const p = deep(document, 'hk-detail-timer')[0]; return p && p.shadowRoot && p.shadowRoot.querySelector('.cmds button') ? true : null; },
        null, { timeout: 8000 }).then(() => true, () => false);
      const sh = sheet ? await page.evaluate(() => { const p = deep(document, 'hk-detail-timer')[0].shadowRoot;
        return { keys: [...p.querySelectorAll('.cmds button')].map((b) => b.textContent.trim()), words: (p.querySelector('.dial .w') || {}).textContent }; }) : null;
      say(sh && JSON.stringify(sh.keys) === '["Pause","Cancel"]' && /Kitchen HomePod/.test(sh.words || ''), `${t}: its sheet: Pause and Cancel, and where it rings`, sh);
      if (input.shots && sheet) await page.screenshot({ path: path.join(input.shots, `${engine}-${size}-sheet.png`) });
      // closed again (Escape once the sheet has its focus; a second if the first came too soon)
      const sheetUp = () => page.evaluate(() => deep(document, 'hk-detail-timer').some((e) => e.getClientRects().length));
      for (let i = 0; i < 3 && await sheetUp(); i++) {
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !deep(document, 'hk-detail-timer').some((e) => e.getClientRects().length), null, { timeout: 3000 }).catch(() => null);
      }
      say(!(await sheetUp()), `${t}: its sheet closes`);
      // THE READER DOWN: the page says so
      await page.request.get(input.origin + '/__check/flip?broken=1');
      const down = await page.waitForFunction(() => deep(document, '.hp-down').some((e) => e.getClientRects().length && e.textContent === 'HomePod timers unavailable'), null,
        { timeout: 8000 }).then(() => true, () => false);
      say(down, `${t}: the reader down: "HomePod timers unavailable"`);
      if (input.shots) await page.screenshot({ path: path.join(input.shots, `${engine}-${size}-down.png`) });
      await page.request.get(input.origin + '/__check/flip?broken=0');
      // RINGING ON ITS HOMEPOD (2026-11-13, the house's kitchen): Done and Stop on its card, Time's Up over the page, Stop to the reader
      {
        const rung = await (await page.request.get(input.origin + '/__check/ring?on=1')).json();
        say(rung.ringing.length === 1, `${t}: the stand-in's Pasta rings`, rung);
        const pop = await page.waitForFunction(() => { const h = document.getElementById('hk-timer-ring'), s = h && h.shadowRoot, p = s && s.querySelector('.pop');
          return p ? { text: p.innerText, keys: [...p.querySelectorAll('.acts button')].map((b) => b.textContent) } : null; }, null, { timeout: 8000 }).then((h) => h.jsonValue(), () => null);
        say(pop && /Pasta/.test(pop.text) && /Ringing on the Kitchen HomePod\./.test(pop.text) && JSON.stringify(pop.keys) === '["Stop"]', `${t}: Time's Up: where it rings, Stop alone`, pop);
        if (input.shots) await page.screenshot({ path: path.join(input.shots, `${engine}-${size}-ringing.png`) });
        await page.evaluate(() => { const h = document.getElementById('hk-timer-ring'); const s = h.shadowRoot.querySelector('.scrim'); if (s) s.remove(); });
        const card = await page.evaluate(cards).then((cs) => cs.find((c) => c.name === 'Pasta'));
        say(card && /^Ringing · Kitchen HomePod/.test(card.sub || '') && JSON.stringify(card.keys) === '["Stop"]', `${t}: its card: Ringing, Stop alone`, card);
        // its sheet, while it rings: Done, where it rings, Stop alone
        const hd2 = await page.evaluate(() => { const c = deep(document, '.tc').find((x) => x.getClientRects().length && x.querySelector('.head').textContent.includes('Pasta'));
          const h = c.querySelector('.head'); h.scrollIntoView({ block: 'center' }); const r = h.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
        await page.waitForTimeout(300);
        await page.touchscreen.tap(hd2.x, hd2.y);
        const rs = await page.waitForFunction(() => { const p = deep(document, 'hk-detail-timer')[0], s = p && p.shadowRoot;
          return s && s.querySelector('.cmds button') ? { keys: [...s.querySelectorAll('.cmds button')].map((b) => b.textContent.trim()), words: (s.querySelector('.dial .w') || {}).textContent,
            cd: (s.querySelector('.dial .cd') || {}).textContent } : null; }, null, { timeout: 8000 }).then((h) => h.jsonValue(), () => null);
        say(rs && JSON.stringify(rs.keys) === '["Stop"]' && /Ringing on the Kitchen HomePod/.test(rs.words || '') && rs.cd === 'Done', `${t}: its sheet while it rings: Done, Stop alone`, rs);
        if (input.shots) await page.screenshot({ path: path.join(input.shots, `${engine}-${size}-ringing-sheet.png`) });
        for (let i = 0; i < 3 && await sheetUp(); i++) {
          await page.waitForTimeout(500);
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !deep(document, 'hk-detail-timer').some((e) => e.getClientRects().length), null, { timeout: 3000 }).catch(() => null);
        }
        const before2 = (await (await page.request.get(input.origin + '/__check/posts')).json()).length;
        await tap('Pasta', 'Stop');
        const stops = await sentSince(before2, 1);
        say(stops.length === 1 && stops[0][0] === '/timer' && stops[0][1].action === 'stop' && stops[0][1].id === 't-pasta', `${t}: Stop reaches the reader, by its id`, stops);
        await page.request.get(input.origin + '/__check/ring?on=0');
      }
      // SETTINGS > TIMERS: the reader's state and the rooms
      if (size === 'wall') {
        await page.goto(input.origin + '/settings#/page/timers', { waitUntil: 'commit' });
        await page.waitForLoadState('domcontentloaded');
        await page.evaluate(DEEP);
        const txt = await page.waitForFunction(() => { if (!window.deep) return null; const t = deep(document, '*').map((e) => e.shadowRoot ? e.shadowRoot.textContent : '').join(' ') +
          document.body.textContent;
          return /HomePod Timers/.test(t) && /HomePod Rooms/.test(t) ? t.replace(/\s+/g, ' ') : null; }, null, { timeout: 20000 }).then((h) => h.jsonValue(), () => '');
        say(/Reader\s*Reading/.test(txt) && /1 Not Matched/.test(txt), `${t}: Settings > Timers: the reader reading, one room not matched`,
          txt.slice(txt.indexOf('HomePod Timers'), txt.indexOf('HomePod Timers') + 300));
        if (input.shots) await page.screenshot({ path: path.join(input.shots, `${engine}-${size}-settings.png`), fullPage: true });
      }
      say(!errors.length, `${t}: no page errors`, errors);
      await ctx.close();
    }
    await browser.close();
  }
  console.log(fails ? `FAILED: ${fails}` : 'ALL HOMEPOD TIMER CHECKS PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
