// Writes references/ for ARTWORK-REQUEST.md from the mock-up: placements.json (where each piece sits, in CSS px, at each
// screen size), the mock-up's own pictures, and the same pictures with each piece's box and name drawn on them.
//   PLAYWRIGHT_PATH=/path/to/playwright-core node make_references.cjs
const { webkit } = require(process.env.PLAYWRIGHT_PATH), http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../..'), OUT = path.join(__dirname, 'references');
fs.mkdirSync(path.join(OUT, 'mock'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'annotated'), { recursive: true });
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
  fs.readFileSync(ROOT + '/docs/phase20/mockup/holiday-slide.html', 'utf8') + '</body></html>';
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/') { r.setHeader('content-type', 'text/html'); return r.end(html); }
  const f = ROOT + '/web/hk' + u;
  if (u.startsWith('/sky/') && fs.existsSync(f)) { r.setHeader('content-type', f.endsWith('.webp') ? 'image/webp' : f.endsWith('.png') ? 'image/png' : 'application/json'); return r.end(fs.readFileSync(f)); }
  r.statusCode = 404; r.end();
}).listen(0, async () => {
  const b = await webkit.launch(), p = await (await b.newContext({ viewport: { width: 2200, height: 1700 } })).newPage();
  await p.goto(`http://127.0.0.1:${srv.address().port}/`); await p.waitForTimeout(1500);
  // shown at full size, whatever the page around it
  await p.addStyleTag({ content: '.rail,.lower,h1,.lead,.under{display:none!important}.top{display:block!important}.wrap{max-width:none}' });
  const all = {};
  for (const [scene, id, days] of [['room', 'christmas', 47], ['haunt', 'halloween', 13]]) {
    all[scene] = {};
    for (let i = 0; i < 5; i++) {
      const dev = await p.evaluate(([id, days, i]) => { const H = window.__holiday, x = H.HOL.find((y) => y.id === id); H.set({ h: x, days, light: x.light, dev: H.DEV[i], tsz: 100, themed: true }); return H.DEV[i]; }, [id, days, i]);
      await p.waitForTimeout(1800);
      all[scene][dev[0]] = { w: dev[2], h: dev[3], z: await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#stage')).getPropertyValue('--z'))), ...(await p.evaluate(() => window.__holiday.place())) };
      const el = await p.$('#frame');
      await el.screenshot({ path: `${OUT}/mock/${scene}-${dev[0]}.png` });
      await p.evaluate((pl) => {
        const st = document.querySelector('#stage'), o = document.createElement('div'); o.id = 'ann'; o.style.cssText = 'position:absolute;inset:0;z-index:99;pointer-events:none';
        const col = ['#ff3b30', '#ffd60a', '#30d158', '#64d2ff', '#bf5af2', '#ff9f0a', '#ffffff'], Z = 0;
        let n = 0;
        const box = (name, r) => { if (!r) return; const c = col[n++ % col.length], d = document.createElement('div'); d.style.cssText = `position:absolute;left:${r[0]}px;top:${r[1]}px;width:${r[2]}px;height:${r[3]}px;border:2px solid ${c};box-sizing:border-box`; d.innerHTML = `<span style="position:absolute;left:0;top:0;font:700 13px/1.3 sans-serif;background:${c};color:#000;padding:0 4px;white-space:nowrap">${name}</span>`; o.appendChild(d); };
        Object.keys(pl).forEach((k) => { const v = pl[k]; if (Array.isArray(v) && Array.isArray(v[0])) v.forEach((q, i) => box(k + ' ' + (i + 1), q)); else if (Array.isArray(v)) box(k, v); else if (typeof v === 'number') box(k + ' line', [0, v, st.offsetWidth, 2]); });
        st.appendChild(o);
      }, all[scene][dev[0]]);
      await el.screenshot({ path: `${OUT}/annotated/${scene}-${dev[0]}.png` });
      await p.evaluate(() => document.querySelector('#ann').remove());
    }
  }
  const round = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
  fs.writeFileSync(OUT + '/placements.json', JSON.stringify(round(all), null, 1));
  await b.close(); srv.close();
  console.log('wrote references/placements.json, mock/ and annotated/');
});
