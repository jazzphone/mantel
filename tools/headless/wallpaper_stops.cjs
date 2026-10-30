// wallpaper_stops.cjs -- measures each wallpaper's four stops off its drawn art (hk-wallpapers.js, 2026-10-30):
// the mean colour across the picture at the sky's stop heights (0, .42, .72, 1; a band 8 % tall around each),
// by day and by night, in WebKit. Prints a JSON table, {id: {day: [4], night: [4]}}, to paste into the module's
// LIST when a palette or a shape changes; with --check, exits 1 when the module's stops differ from the art by
// more than 6 (of 255) in any channel. PLAYWRIGHT_PATH names playwright-core.
//   PLAYWRIGHT_PATH=... node tools/headless/wallpaper_stops.cjs [--check]
const fs = require('fs');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const SRC = fs.readFileSync(path.join(__dirname, '../../web/hk/modules/hk-wallpapers.js'), 'utf8');

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let bad = 0;
  try {
    const page = await (await browser.newContext({ viewport: { width: 400, height: 400 } })).newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: SRC });
    const out = await page.evaluate(async () => {
      const W = window.hkWallpapers, N = 400, AT = [0, 0.42, 0.72, 1], HALF = 0.04;
      const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      const draw = (src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
      const res = {};
      for (const w of W.list()) {
        res[w.id] = {};
        for (const night of [false, true]) {
          const im = await draw(W.url(w.id, night));
          const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
          const x = cv.getContext('2d'); x.drawImage(im, 0, 0, N, N);
          const d = x.getImageData(0, 0, N, N).data;
          res[w.id][night ? 'night' : 'day'] = AT.map((f) => {
            const y0 = Math.max(0, Math.round((f - HALF) * N)), y1 = Math.min(N, Math.round((f + HALF) * N));
            const s = [0, 0, 0]; let n = 0;
            for (let y = y0; y < y1; y++) for (let i = y * N * 4; i < (y + 1) * N * 4; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; }
            return hex(s.map((v) => v / n));
          });
        }
        try { res[w.id].have = W.stops(w.id); } catch (e) { res[w.id].have = { day: [], night: [] }; }
      }
      return res;
    });
    const table = {};
    for (const [id, r] of Object.entries(out)) {
      table[id] = { day: r.day, night: r.night };
      for (const k of ['day', 'night']) r[k].forEach((c, i) => {
        const h = r.have[k][i];
        if (typeof h !== 'string' || !/^#[0-9a-f]{6}$/.test(h)) { bad++; return; }
        for (let j = 1; j < 7; j += 2) if (Math.abs(parseInt(c.slice(j, j + 2), 16) - parseInt(h.slice(j, j + 2), 16)) > 6) { bad++; break; }
      });
    }
    console.log(JSON.stringify(table, null, 1));
    if (process.argv.includes('--check')) { console.error(bad ? bad + ' stops differ from the art' : 'stops match the art'); process.exitCode = bad ? 1 : 0; }
  } finally { await browser.close(); }
})();
