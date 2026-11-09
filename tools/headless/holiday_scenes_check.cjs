'use strict';
// The Holiday slide's scene placement check (tools/headless/holiday_scenes_check.py runs it; docs/phase20/HOLIDAY-SLIDE.md
// "Tests"). Input on stdin: {origin, engines, shots, sizes}. Prints PASS/FAIL lines; exits 1 on any failure.
const PW = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
let fails = 0;
const say = (ok, what, detail) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok || detail === undefined ? '' : '   ' + JSON.stringify(detail).slice(0, 600))); };

// [tag, holiday, a date that puts it the given days away, the scene it wears, the days]
const CASES = [
  ['christmas', 'christmas', '2026-11-08', 'room', 47], ['halloween', 'halloween', '2026-10-18', 'haunt', 13],
  ['thanksgiving', 'thanksgiving', '2026-11-08', 'thanks', 18], ['newyear', 'newyear', '2026-12-08', 'newyear', 24],
  ['easter', 'easter', '2027-03-01', 'land', 27], ['thanks-day', 'thanksgiving', '2026-11-26', 'thanks', 0],
  ['newyear-day', 'newyear', '2027-01-01', 'newyear', 0], ['christmas-tomorrow', 'christmas', '2026-12-24', 'room', 1],
  ['halloween-104', 'halloween', '2026-07-19', 'haunt', 104], ['easter-day', 'easter', '2027-03-28', 'land', 0],
  ['christmas-outdoors', 'christmas', '2026-11-08', 'land', 47, '&out=christmas']];
const SIZES = input.sizes || [['wall', 1280, 800], ['pane', 880, 800], ['ipad', 820, 1180], ['phone', 390, 844], ['side', 844, 390]];

const measure = () => {
  const host = document.getElementById('host'), hr = host.getBoundingClientRect(), out = { bad: [] };
  const vis = (e) => e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none' ? e : null;
  const q = (s) => vis(host.querySelector(s));
  const R = (e) => e.getBoundingClientRect();
  // the letters themselves (a box around words holds room above and below them)
  const ink = (el) => { const rs = []; (function walk(n) { if (n.nodeType === 3) { if (n.textContent.trim()) { const g = document.createRange(); g.selectNodeContents(n); for (const r of g.getClientRects()) if (r.width > 0) rs.push(r); } return; }
    if (n.nodeType === 1 && getComputedStyle(n).display !== 'none') n.childNodes.forEach(walk); })(el);
    return rs.length ? { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) } : null; };
  const meet = (a, b) => !!(a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5);
  const inside = (a, b, slack) => a.left >= b.left - slack && a.right <= b.right + slack && a.top >= b.top - slack && a.bottom <= b.bottom + slack;
  // every live word inside its piece
  for (const [box, sel] of [['.scr', ['.big', '.osdl', '.osdd', '.osdt']], ['.stn', ['.big', '.e1', '.e3', '.e4', '.gr']], ['.chalk .cw', ['.c1', '.cbig', '.cg', '.c2', '.c3']], ['.flap .fin', ['.fr']]]) {
    const b = q(box); if (!b) continue;
    sel.forEach((s) => b.querySelectorAll(s).forEach((e) => { const r = ink(e); if (r && !inside(r, R(b), 1)) out.bad.push(s + ' outside ' + box + ' ' + [r.left - R(b).left, R(b).right - r.right, r.top - R(b).top, R(b).bottom - r.bottom].map(Math.round)); }));
  }
  // nothing live off the screen
  ['.num', '.hdl', '.dt', '.eye', '.hello', '.enfoot', '.tv', '.stn', '.vcr', '.chalk', '.flap'].forEach((s) => { const e = q(s); if (!e) return; const r = ink(e) || R(e);
    if (!inside(r, hr, 1)) out.bad.push(s + ' off the screen ' + [r.left - hr.left, hr.right - r.right, r.top - hr.top, hr.bottom - r.bottom].map(Math.round)); });
  host.querySelectorAll('.enfoot .its > div').forEach((d) => { const r = ink(d); if (r && r.right > hr.right + 1) out.bad.push('row item off the screen: ' + d.textContent); });
  // the corner and the row meet none of the slide's words
  const tl = q('.scs.tl'), tr = q('.scs.tr'), parts = ['.num', '.hdl', '.dt', '.eye', '.hello', '.enfoot', '.scr', '.stn .big', '.stn .e3', '.stn .e1', '.stn .e4', '.chalk .cw > *', '.flap .fin'].map(q).filter(Boolean);
  for (const c of [tl, tr]) if (c) parts.forEach((x) => { if (meet(ink(c), ink(x) || R(x))) out.bad.push('the corner ' + c.className + ' meets ' + x.className); });
  const f = q('.enfoot');
  // (the outdoor hero by its boxes, as the mock-up's check: a text range's box is the font's whole line, well below a
  // 300 px figure's ink; the scenes' words by their letters)
  if (f) ['.num', '.hdl', '.dt', '.hello', '.scr', '.stn .e4', '.chalk .cw', '.flap .fin'].map(q).filter(Boolean).forEach((x) => { const r = x.closest('.hlhero') ? R(x) : ink(x) || R(x); if (r.bottom > R(f).top + 1) out.bad.push(x.className + ' into the row'); });
  const n = q('.num'), w = q('.words'); if (n && w && !host.querySelector('.hl').hasAttribute('tall') && ink(n).right > ink(w).left + 1) out.bad.push('the number meets its words');
  const info = window.__ctl.info();
  // the window's glass clear of House Status
  if (info.win && tr) { const s = ink(tr), g = { left: hr.left + info.win.x, top: hr.top + info.win.y, right: hr.left + info.win.x + info.win.w, bottom: hr.top + info.win.y + info.win.h }; if (meet(s, g)) out.bad.push('the window behind House Status'); }
  // nothing floats: every floor-standing piece's feet at or above the scene's front edge
  if (info.feet) Object.keys(info.feet).forEach((k) => { if (info.feet[k] > info.foot + 1) out.bad.push(k + "'s feet below the front edge " + Math.round(info.feet[k]) + ' > ' + Math.round(info.foot)); });
  out.info = info;
  out.still = host.querySelector('.hl').hasAttribute('still');
  return out;
};

(async () => {
  for (const eng of input.engines) {
    let browser = await PW[eng].launch();
    const errors = [];
    const open = async (q, W, H) => {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(input.origin + '/holiday_harness.html?' + q + '&w=' + W + '&h=' + H);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      return page;
    };
    // THE ART: every scene's pieces load (until they have, a scene shows its outdoor version)
    {
      const page = await open('hol=christmas&date=2026-11-08', 1280, 800);
      const art = await page.evaluate(async () => { const S = window.hkHolidayScenes, out = {};
        for (const sc of Object.keys(S.PIECES)) out[sc] = await new Promise((res) => S.load(sc, res));
        return out; });
      say(Object.values(art).every(Boolean), eng + ': every scene’s pieces load', art);
      await page.close();
    }
    for (const [sn, W, H] of SIZES) {
      // (a fresh browser for each size: after some 250 pages in one, WebKit stopped answering a page load on a Mac short of memory)
      await browser.close();
      browser = await PW[eng].launch();
      for (const [tag, hol, date, scene, days, extra] of CASES) {
        for (const tsz of [100, 250]) {
          const name = eng + ' ' + sn + ' ' + tag + ' corner ' + tsz + '%';
          const page = await open('hol=' + hol + '&date=' + date + '&tsz=' + tsz + (extra || ''), W, H);
          const m = await page.evaluate(measure);
          say(m.info.id === hol && m.info.days === days && m.info.scene === scene, name + ': ' + hol + ', ' + days + ' days, in ' + scene, [m.info.id, m.info.days, m.info.scene]);
          say(!m.bad.length, name + ': every word in its place, the corner and the row clear, nothing floats', m.bad);
          say(m.info.running && m.info.fx === 'full', name + ': its effects run while it is up', [m.info.running, m.info.fx]);
          if (input.shots && tsz === 100) await page.screenshot({ path: input.shots + '/' + eng + '-' + sn + '-' + tag + '.png' });
          await page.close();
        }
      }
    }
    // EFFECTS OFF, REDUCE MOTION (the sky's Animations off): one still picture, no loop
    for (const q of ['hol=christmas&date=2026-11-08&fx=off', 'hol=thanksgiving&date=2026-11-08&still=1', 'hol=easter&date=2027-03-01&fx=off']) {
      const page = await open(q, 1280, 800);
      const m = await page.evaluate(() => ({ info: window.__ctl.info(), still: document.querySelector('.hl').hasAttribute('still') }));
      await page.waitForTimeout(400);
      const pend = await page.evaluate(() => window.__pending());
      say(!m.info.running && m.info.fx === 'off' && m.still && pend === 0, eng + ' ' + q + ': one still picture, no animation frame waiting', [m.info.running, m.info.fx, m.still, pend]);
      if (input.shots) await page.screenshot({ path: input.shots + '/' + eng + '-still-' + q.split('&')[0].slice(4) + '.png' });
      await page.close();
    }
    // THE LEAK CHECK: 20 turns (drawn, arrived, left), then nothing grew and nothing is left running
    for (const hol of [['christmas', '2026-11-08'], ['newyear', '2026-12-08'], ['easter', '2027-03-01']]) {
      const page = await open('hol=' + hol[0] + '&date=' + hol[1], 1280, 800);
      const before = await page.evaluate(() => ({ layers: document.querySelectorAll('.hl').length, canvases: [...document.querySelectorAll('.hl canvas')].map((c) => c.width + 'x' + c.height).join(), kids: document.querySelector('.hl').children.length }));
      for (let i = 0; i < 20; i++) {
        await page.evaluate(() => { const c = window.__ctl; c.leave(); c.draw(null); c.arrived(); });
        await page.waitForTimeout(60);
      }
      await page.evaluate(() => window.__ctl.leave());
      await page.waitForTimeout(3600);
      const after = await page.evaluate(() => ({ layers: document.querySelectorAll('.hl').length, canvases: [...document.querySelectorAll('.hl canvas')].map((c) => c.width + 'x' + c.height).join(), kids: document.querySelector('.hl').children.length, running: window.__ctl.info().running, pending: window.__pending() }));
      say(after.layers === before.layers && after.canvases === before.canvases && after.kids === before.kids, eng + ' ' + hol[0] + ': after 20 turns, the same layer and canvases', [before, after]);
      say(!after.running && after.pending === 0, eng + ' ' + hol[0] + ': ...and once it has left, no loop and no animation frame waiting', after);
      await page.close();
    }
    say(!errors.length, eng + ': no page errors', errors.slice(0, 4));
    await browser.close();
  }
  console.log(fails ? 'holiday scenes: ' + fails + ' failed' : 'holiday scenes: all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
