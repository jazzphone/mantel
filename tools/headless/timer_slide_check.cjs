'use strict';
// The Timer slide's check (tools/headless/timer_slide_check.py runs it; docs/phase21/TIMER-SLIDE.md "How each step is checked").
// Input on stdin: {origin, engines, shots, sizes}. Prints PASS/FAIL lines; exits 1 on any failure.
const PW = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
let fails = 0;
const say = (ok, what, detail) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok || detail === undefined ? '' : '   ' + JSON.stringify(detail).slice(0, 400))); };

const CASES = [
  ['one', 'Pasta:738:900', { rings: 0, last: false }],
  ['one-hours', 'Roast:9000:14400', { rings: 0, last: false }],
  ['two', 'Pasta:738:900,Oven:1520:2700', { rings: 1, last: false }],
  ['four', 'Pasta:738:900,Oven:1520:2700,Rice:2240:3000,Laundry:1390:2700:p', { rings: 3, last: false }],
  ['five', 'Pasta:738:900,Oven:1520:2700,Rice:2240:3000,Laundry:1390:2700:p,Bread:3000:3600', { rings: 3, more: true, last: false, fewer: 2 }],
  ['hours-subs', 'Pasta:738:900,Roast:9000:14400,Brisket:36000:43200', { rings: 2, last: false }],
  ['last', 'Pasta:48:900', { rings: 0, last: true }],
  ['last-many', 'Oven:22:2700,Pasta:48:900,Laundry:1390:2700', { rings: 2, last: true }],
  ['red', 'Pasta:8:900', { rings: 0, last: true, red: true }],
  ['long-name', 'A Very Long Timer Name That Goes On And On:738:900,Another Quite Long Timer Name Here:1500:2700', { rings: 1, last: false }],
  // A HOMEPOD'S TIMER (phase 28): the same slide and the same last minute; the HomePod's glyph, and it rings on the HomePod
  ['homepod-one', 'Pasta:738:900', { rings: 0, last: false, hp: 'hero' }, '&hp=0'],
  ['homepod-sub', 'Oven:300:900,Pasta:738:900,Rice:2240:3000', { rings: 2, last: false, hp: 'sub' }, '&hp=1'],
  ['homepod-last', 'Pasta:48:900', { rings: 0, last: true, hp: 'hero' }, '&hp=0']
];

// [tag, timers, rings, query]: Time's Up
const DONE = [['done-one', '', ['Pasta']], ['done-others', 'Oven:1520:2700,Rice:40:900', ['Pasta']], ['done-two', 'Laundry:37:2700', ['Pasta', 'Oven']],
  ['done-long', '', ['A Very Long Timer Name That Goes On And On']], ['done-silent', '', ['Pasta'], '&where=none'],
  ['done-homepod', 'Oven:1520:2700', ['Pasta'], '&hpring=1']];

const measure = () => {
  const host = document.getElementById('host'), hr = host.getBoundingClientRect(), bad = [];
  const R = (e) => e.getBoundingClientRect();
  const meet = (a, b) => !!(a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5);
  const inside = (r) => r.left >= hr.left - 1 && r.top >= hr.top - 1 && r.right <= hr.right + 1 && r.bottom <= hr.bottom + 1;
  const ink = (el) => { const g = document.createRange(); g.selectNodeContents(el); return g.getBoundingClientRect(); };
  const words = [...host.querySelectorAll('.tm .tmdg,.tm .tmcs,.tm .tmeye,.tm .tmnm,.tm .tmsd,.tm .tmsn,.tm .tmse,.tm .k,.tm .v,.tm .tmlede,.tm .tmacts button')].filter((e) => e.textContent.trim() &&
    R(e).height > 0);
  const ring = host.querySelector('.tmrw'), read = host.querySelector('.tmread'), corner = [...host.querySelectorAll('.scs .ct,.scs .cl')];
  // (a name too long for its place is cut with an ellipsis: its box is what shows)
  const shows = (e) => (getComputedStyle(e).overflow === 'hidden' ? R(e) : ink(e));
  words.forEach((e) => { if (!inside(shows(e))) bad.push('off the screen: ' + e.className + ' ' + e.textContent); });
  [ring, read, ...host.querySelectorAll('.tmsb')].forEach((e) => { if (e && !inside(R(e))) bad.push('box off the screen: ' + e.className); });
  corner.forEach((c) => {
    const a = ink(c);
    if (meet(a, R(ring))) bad.push('corner on the ring: ' + c.textContent);
    words.forEach((w) => { if (meet(a, shows(w))) bad.push('corner on words: ' + c.textContent + ' / ' + w.textContent); });
  });
  if (meet(R(ring), R(read))) bad.push('the ring meets the words');
  // the big number stays inside its ring's hole (r 96 - w 22 / 2 = 85 of 110)
  const rr = R(ring), dg = ink(host.querySelector('.tmdg')), hole = rr.width * 85 / 110;
  if (dg.width > hole) bad.push('the number wider than its ring\'s hole: ' + Math.round(dg.width) + ' > ' + Math.round(hole));
  const smalls = [...host.querySelectorAll('.tmsbr')].filter((b) => b.querySelector('svg')), sds = [...host.querySelectorAll('.tmsd')];
  sds.forEach((s, i) => { const b = R(smalls[i]); if (ink(s).width > b.width * 68 / 110) bad.push('a small ring\'s number too wide: ' + s.textContent); });
  const nmr = host.querySelector('.tmnm'), subs = host.querySelector('.tmsubs');
  if (nmr && subs && meet(R(nmr), R(subs))) bad.push('the name on the small rings');
  return { bad, rings: smalls.length, more: !!host.querySelector('.tmsb.more'), last: host.querySelector('.tm').hasAttribute('last'), ok: window.__ok,
           stroke: (host.querySelector('.tmrw circle.arc') || { getAttribute() {} }).getAttribute('stroke'), names: window.__ctl.info().rows.map((r) => r.name) };
};

(async () => {
  for (const eng of input.engines) {
    const b = await PW[eng].launch();
    for (const [size, W, H] of input.sizes) {
      const ctx = await b.newContext({ viewport: { width: W, height: H } }), p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      for (const [tag, timers, want, q] of CASES) {
        await p.goto(`${input.origin}/timer_slide_harness.html?w=${W}&h=${H}&timers=${encodeURIComponent(timers)}${q || ''}`);
        await p.waitForFunction('window.__ready === true');
        const m = await p.evaluate(measure), t = `${eng} ${size} ${tag}`;
        say(m.ok === true, `${t}: it draws`);
        say(!m.bad.length, `${t}: everything on the screen, nothing on anything else`, m.bad);
        const rings = want.fewer && ['ipad', 'phone', 'side'].includes(size) ? want.fewer : want.rings;
        if (rings !== undefined && !(size === 'phone' && rings > 2)) say(m.rings === rings, `${t}: ${rings} small rings`, m.rings);
        if (want.more) say(m.more, `${t}: the rest as +N`);
        say(m.last === want.last, `${t}: the last minute's look ${want.last ? 'on' : 'off'}`, m.last);
        if (want.red) say(m.stroke === '#ff453a', `${t}: the ring red for its last ten seconds`, m.stroke);
        say(!m.names.includes('Nap'), `${t}: a House Timer never shows`, m.names);
        if (want.hp) {
          const hp = await p.evaluate(() => ({ lede: (document.querySelector('.tmread .tmlede') || {}).textContent || '', hero: !!document.querySelector('.tmread > .tmlede .tmhp'),
            sub: [...document.querySelectorAll('.tmsb .tmsn')].filter((n) => n.querySelector('.tmhp')).map((n) => n.textContent) }));
          if (want.hp === 'hero') say(hp.hero && hp.lede === 'Rings on the Kitchen HomePod.', `${t}: the HomePod's glyph, and it rings on the HomePod`, hp);
          else say(hp.sub.length === 1 && hp.sub[0] === 'Pasta' && !hp.hero, `${t}: the small ring's HomePod glyph`, hp);
        }
        if (input.shots && ['two', 'four', 'last-many', 'one', 'homepod-sub', 'homepod-last'].includes(tag)) await p.screenshot({ path: `${input.shots}/${eng}-${size}-${tag}.png` });
      }
      for (const [tag, timers, rings, q] of DONE) {
        await p.goto(`${input.origin}/timer_slide_harness.html?w=${W}&h=${H}&room=kitchen&timers=${encodeURIComponent(timers)}&rings=${encodeURIComponent(rings.join(','))}${q || ''}`);
        await p.waitForFunction('window.__ready === true');
        const m = await p.evaluate(measure), t = `${eng} ${size} ${tag}`;
        say(m.ok === true, `${t}: it draws`);
        say(!m.bad.length, `${t}: everything on the screen, nothing on anything else`, m.bad);
        const d = await p.evaluate(() => ({ done: document.querySelector('.tm').hasAttribute('done'), last: document.querySelector('.tm').hasAttribute('last'),
          text: document.querySelector('.tmread').innerText, stop: document.querySelector('.tmacts .stop').textContent, btn: document.querySelectorAll('.tmacts button').length }));
        say(d.done && !d.last, `${t}: Time's Up`, d);
        const hpr = /hpring/.test(q || '');
        say(d.stop === (rings.length > 1 ? 'Stop All' : 'Stop') && d.btn === (rings.length > 1 || hpr ? 1 : 3), `${t}: its buttons`, d);
        say(hpr ? /Ringing on the Kitchen HomePod\./.test(d.text) : q ? /Silent, as set/.test(d.text) : /Ringing on this tablet and the Kitchen speaker/.test(d.text), `${t}: it says where`, d.text);
        if (input.shots && ['done-others', 'done-two', 'done-homepod'].includes(tag)) await p.screenshot({ path: `${input.shots}/${eng}-${size}-${tag}.png` });
      }
      if (size === 'wall') {
        // A TAP: its buttons, and anywhere else stops the sound
        const base = `${input.origin}/timer_slide_harness.html?w=${W}&h=${H}&room=kitchen&rings=Pasta`;
        await p.goto(base);
        await p.waitForFunction('window.__ready === true');
        const taps = await p.evaluate(() => { const c = window.__ctl, out = [], at = (s) => { const r = document.querySelector(s).getBoundingClientRect();
          return [r.left + r.width / 2, r.top + r.height / 2]; };
          out.push(c.tap(...at('.tmacts [data-a=more]'))); out.push(c.tap(5, 5)); return { out, calls: window.__calls }; });
        say(taps.out.every(Boolean) && taps.calls[0][2].op === 'more' && taps.calls[0][2].entity_id === 'timer.hk_timer_40' && taps.calls[1][2].op === 'stop' && taps.calls[1][1] ===
          'quick_timer_ring', `${eng} a tap on Time's Up: +1 Min, and elsewhere Stop`, taps);
        // OVER A PAGE: the pop-up and the sound, in this tablet's room; Stop on it; gone when the ring is
        await p.goto(base);
        await p.waitForFunction('window.__ready === true');
        await p.mouse.click(5, 5);        // (a touch allows sound)
        const ring = await p.evaluate(async () => { window.__ring(['Pasta']); await new Promise((r) => setTimeout(r, 200)); const h = document.getElementById('hk-timer-ring'); const s = h &&
          h.shadowRoot; const st = window.hkTimerRing._.state();
          const text = s && s.querySelector('.pop') ? s.querySelector('.pop').innerText : null; const stop = s && s.querySelector('.stop'); if (stop) stop.click();
            const calls = window.__calls.slice(); window.__ring([]); await new Promise((r) => setTimeout(r, 100));
          return { text, st, calls, after: window.hkTimerRing._.state(), left: !!s.querySelector('.scrim') }; });
        say(/Pasta/.test(ring.text || '') && /Ringing on this tablet and the Kitchen speaker/.test(ring.text || ''), `${eng} over a page: Time's Up`, ring);
        say(ring.st.sounding === 'chime', `${eng} ...and its sound, in this tablet's room`, ring.st);
        say(ring.calls[0] && ring.calls[0][2].op === 'stop', `${eng} ...Stop on it stops it`, ring.calls);
        say(!ring.after.sounding && !ring.left, `${eng} ...gone with the ring, sound and all`, ring.after);
        for (const [room, hears, what] of [['office', false, "another room's tablet shows it and makes no sound"]]) {
          await p.goto(base.replace('room=kitchen', 'room=' + room));
          await p.waitForFunction('window.__ready === true');
          const s2 = await p.evaluate(async () => { window.__ring(['Pasta']); await new Promise((r) => setTimeout(r, 100));
            return { st: window.hkTimerRing._.state(), shown: !!document.getElementById('hk-timer-ring').shadowRoot.querySelector('.pop') }; });
          say(s2.shown && !!s2.st.sounding === hears, `${eng} ${what}`, s2);
        }
        await p.goto(base.replace('room=kitchen&', ''));
        await p.waitForFunction('window.__ready === true');
        const s3 = await p.evaluate(async () => { window.__ring(['Pasta']); await new Promise((r) => setTimeout(r, 100)); return window.hkTimerRing._.state(); });
        say(!s3.sounding, `${eng} a phone never plays it`, s3);
        await p.goto(`${input.origin}/timer_slide_harness.html?w=${W}&h=${H}&room=kitchen&lede=1&timers=${encodeURIComponent('Pasta:738:900')}`);
        await p.waitForFunction('window.__ready === true');
        say(/Rings on this tablet and the Kitchen speaker/.test(await p.evaluate(() => (window.__ring([]), document.querySelector('.tmread').innerText))) ,
          `${eng} before it ends, the slide says where it will ring`);
        // WHAT IT COSTS: nothing asks for a frame, the seconds move, and once it has left nothing ticks
        await p.goto(`${input.origin}/timer_slide_harness.html?w=${W}&h=${H}&timers=${encodeURIComponent('Pasta:30:900,Oven:1520:2700')}`);
        await p.waitForFunction('window.__ready === true');
        const a = await p.evaluate(() => ({ raf: window.__rafs(), dg: document.querySelector('.tmdg').textContent }));
        await p.waitForTimeout(2300);
        const c = await p.evaluate(() => ({ raf: window.__rafs(), dg: document.querySelector('.tmdg').textContent }));
        say(c.dg !== a.dg, `${eng} the number counts down`, [a.dg, c.dg]);
        say(c.raf === a.raf, `${eng} no animation frame asked for while it holds still`, [a.raf, c.raf]);
        const left = await p.evaluate(async () => { const before = document.querySelector('.tmdg'); window.__ctl.leave(); const t0 = before.textContent; await new Promise((r) => setTimeout(r, 1500));
          return [t0, before.textContent]; });
        say(left[0] === left[1], `${eng} once it has left, nothing ticks`, left);
        // it moved into its last minute with the slide up: the big look comes on by itself
        await p.goto(`${input.origin}/timer_slide_harness.html?w=${W}&h=${H}&timers=${encodeURIComponent('Pasta:61:900')}`);
        await p.waitForFunction('window.__ready === true');
        const before = await p.evaluate(() => document.querySelector('.tm').hasAttribute('last'));
        await p.waitForTimeout(2500);
        const after = await p.evaluate(() => document.querySelector('.tm').hasAttribute('last'));
        say(!before && after, `${eng} crossing into the last minute, the big look comes on`, [before, after]);
      }
      say(!errs.length, `${eng} ${size}: no page errors`, errs);
      await ctx.close();
    }
    await b.close();
  }
  console.log(fails ? `FAILED: ${fails}` : 'ALL TIMER SLIDE CHECKS PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
