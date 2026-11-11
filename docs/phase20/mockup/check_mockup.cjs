// The mock-up's own layout check (the plan's "scene placement test" ports its idea): every holiday at every screen size in
// WebKit (or Chromium), screenshots into OUT, and a list of overlaps, words outside their piece and page errors.
//   PLAYWRIGHT_PATH=/path/to/playwright-core node docs/phase20/mockup/check_mockup.cjs OUT [chromium]
const { webkit, chromium } = require(process.env.PLAYWRIGHT_PATH);
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '../../..'), OUT = process.argv[2], ENGINE = process.argv[3] === 'chromium' ? chromium : webkit;
const page0 = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' +
  fs.readFileSync(ROOT + '/docs/phase20/mockup/holiday-slide.html', 'utf8') + '</body></html>';
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/') { r.setHeader('content-type', 'text/html'); return r.end(page0); }
  const f = ROOT + '/web/hk/' + u.replace(/^\/+/, '');
  const sf = ROOT + '/docs/phase20/mockup' + u;
  if (u.startsWith('/scenes/') && fs.existsSync(sf)) { r.setHeader('content-type', 'image/webp'); return r.end(fs.readFileSync(sf)); }
  if (u.startsWith('/sky/') && fs.existsSync(f)) { r.setHeader('content-type', f.endsWith('.webp') ? 'image/webp' : f.endsWith('.png') ? 'image/png' : 'application/json');
    return r.end(fs.readFileSync(f)); }
  r.statusCode = 404; r.end();
}).listen(0, async () => {
  const port = srv.address().port, b = await ENGINE.launch(), ctx = await b.newContext({ viewport: { width: 1500, height: 1250 }, deviceScaleFactor: 1 }), p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://127.0.0.1:${port}/`); await p.waitForTimeout(1500);
  const bad = [];
  const shot = async (name) => { const el = await p.$('#frame'); await el.screenshot({ path: `${OUT}/${name}.png` }); };
  const check = (tag) => p.evaluate((tag) => {
    const st = document.querySelector('#stage'), sr = st.getBoundingClientRect(), out = [];
    const vis = (s) => { const e = document.querySelector(s); return e && e.offsetParent !== null && e.getBoundingClientRect().height > 0 ? e : null; };
    const R = (e) => e.getBoundingClientRect();
    const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const ins = (s) => { const e = vis(s); if (!e) return; const r = R(e); if (r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - 1 || r.bottom > sr.bottom + 1) out.push(s +
      ' off screen ' + [r.left - sr.left, r.right - sr.left, r.top - sr.top, r.bottom - sr.top].map(Math.round)); };
    ['.num', '.hl', '.dt', '.eye', '.hello', '.enfoot', '.scs.tl', '.scs.tr', '.tv', '.stn', '.vcr', '.chalk', '.flap'].forEach(ins);
    for (const [box, sel] of [['.scr', ['.big', '.osdl', '.osdd']], ['.stn', ['.big', '.e1', '.e3', '.e4', '.gr']], ['.chalk .cw', ['.c1', '.cbig', '.cg', '.c2', '.c3']], ['.flap .fin', ['.fr']]]) {
      const b = vis(box); if (b) sel.forEach((q) => b.querySelectorAll(q).forEach(
      (e) => { const r = R(e), o = R(b); if (r.left < o.left - 1 || r.right > o.right + 1 || r.top < o.top - 1 || r.bottom > o.bottom + 1) out.push(q + ' outside ' + box + ' ' +
      [r.left - o.left, o.right - r.right, r.top - o.top, o.bottom - r.bottom].map(Math.round)); })); }
    document.querySelectorAll('.enfoot .its > div').forEach((d) => { const r = R(d); if (r.right > sr.right + 1) out.push('foot item off ' + d.textContent); });
    const tl = vis('.scs.tl'), tr = vis('.scs.tr'), parts = ['.num', '.hl', '.dt', '.eye', '.hello', '.enfoot', '.tv', '.stn', '.chalk', '.flap'].map(vis).filter(Boolean);
    [tl, tr].forEach((c) => { if (c && R(c).height) parts.forEach((x) => { if (meet(R(c), R(x))) out.push('corner ' + c.className + ' meets ' + x.className); }); });
    const f = vis('.enfoot'); if (f && f.childNodes.length) ['.num', '.hl', '.dt', '.hello'].map(vis).filter(Boolean).forEach(
      (x) => { if (R(x).bottom > R(f).top + 1) out.push(x.className + ' into the row'); });
    const n = vis('.num'), w = vis('.words'); if (n && w && !document.querySelector('#slide').hasAttribute('tall') && R(n).right > R(w).left + 1) out.push('number meets words');
    return out.map((x) => tag + ': ' + x);
  }, tag);
  // every holiday at the wall tablet
  for (const h of await p.evaluate(() => window.__holiday.HOL.map((x) => x.id))) {
    await p.evaluate((h) => { const H = window.__holiday, x = H.HOL.find((y) => y.id === h); H.set({ h: x, days: x.days, light: x.light, dev: H.DEV[0] }); }, h);
    await p.waitForTimeout(h === 'christmas' ? 9000 : 3500);
    await shot('wall-' + h); bad.push(...await check('wall ' + h));
  }
  // Christmas, the long name and three figures at every size, the corner at its largest
  for (let i = 0; i < 5; i++) {
    const dn = (await p.evaluate((i) => window.__holiday.DEV[i][0], i));
    for (const [tag, id, days] of [['n', 'christmas', 47], ['hn', 'halloween', 13], ['tn', 'thanksgiving', 18], ['nn', 'newyear', 54], ['tday', 'thanksgiving', 0], ['nday', 'newyear', 0],
      ['tom', 'christmas', 1], ['h100', 'halloween', 104]]) {
      await p.evaluate(([i, id, days]) => { const H = window.__holiday, x = H.HOL.find((y) => y.id === id); H.set({ h: x, days, light: x.light, dev: H.DEV[i], tsz: 250 });
        document.querySelector('#tsz').value = 250; }, [i, id, days]);
      await p.waitForTimeout(['n', 'hn', 'tn', 'nn', 'tday', 'nday'].includes(tag) ? 3500 : 500);
      if (['n', 'hn', 'tn', 'nn', 'tday', 'nday'].includes(tag)) await shot(dn + '-' + tag);
      bad.push(...await check(dn + ' ' + tag));
    }
  }
  await p.evaluate(() => { const H = window.__holiday; H.set({ h: H.HOL[0], days: 47, light: 'night', dev: H.DEV[0], tsz: 100, fx: 'off' }); });
  await p.waitForTimeout(500); await shot('off');
  await p.evaluate(() => { const H = window.__holiday; H.set({ fx: 'full' }); });
  // the real controls: Outdoors and back, the replay, the effects
  await p.evaluate(() => { const H = window.__holiday; H.set({ h: H.HOL[0], days: 47, light: 'night', dev: H.DEV[0], themed: true }); });
  const clickT = (sel, txt) => p.evaluate(([sel, txt]) => { const b = [...document.querySelectorAll(sel + ' button')].find((x) => x.textContent === txt); if (!b) throw new Error('no button ' + txt);
    b.click(); }, [sel, txt]);
  const state = () => p.evaluate(() => ({ scene: document.querySelector('#slide').getAttribute('scene'), tv: !!document.querySelector('.tv'), stn: !!document.querySelector('.stn'),
    hero: document.querySelector('.hero').textContent.slice(0, 24), lightHidden: document.querySelector('#lightRow').hidden, power: !!document.querySelector('.tv.power') }));
  const log = {}; log.room = await state();
  await clickT('#sceneSeg', 'Outdoors'); await p.waitForTimeout(400); log.outdoors = await state(); await shot('switch-out');
  await clickT('#sceneSeg', '90s Living Room'); await p.waitForTimeout(400); log.back = await state();
  await p.click('#replay'); await p.waitForTimeout(150); log.replay = await state();
  await p.waitForTimeout(2600); log.num = await p.evaluate(() => document.querySelector('#num').textContent);
  await clickT('#fxSeg', 'Off'); await p.waitForTimeout(300); await shot('room-off'); await clickT('#fxSeg', 'Full');
  await p.evaluate(() => { const H = window.__holiday; H.set({ h: H.HOL.find((x) => x.id === 'halloween'), days: 13, light: 'night' }); }); await p.waitForTimeout(300); log.haunt = await state();
  await p.evaluate(() => { const H = window.__holiday; H.set({ h: H.HOL[0], days: 47, light: 'night' }); }); await p.waitForTimeout(800);
  console.log(JSON.stringify(log));
  await p.screenshot({ path: OUT + '/page.png', fullPage: true });
  console.log(JSON.stringify({ errs, bad }, null, 1));
  await b.close(); srv.close();
});
