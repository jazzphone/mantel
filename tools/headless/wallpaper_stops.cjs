// wallpaper_stops.cjs -- measures each wallpaper's four stops off its drawn art (hk-wallpapers.js, 2026-10-30):
// the mean colour across the picture at the sky's stop heights (0, .42, .72, 1; a band 8 % tall around each),
// by day and by night, in WebKit. Prints a JSON table, {id: {day: [4], night: [4]}}, to paste into the module's
// LIST when a palette or a shape changes; with --check, exits 1 when the module's stops differ from the art by
// more than 6 (of 255) in any channel. PLAYWRIGHT_PATH names playwright-core.
//   PLAYWRIGHT_PATH=... node tools/headless/wallpaper_stops.cjs [--check]
//
// THE MOTION THEMES (2026-10-31) take any colour, so their stops are not a table: each band's mean is a fixed
// blend of the theme's shades plus its white stars (compositing is linear in the colours). --weights measures
// that blend once -- the still frame drawn with every shade black (the stars alone), then each shade white in
// turn -- and prints it to paste into the module's WEIGHTS. --check also draws every theme in every preset colour
// and a few others, by day and by night, and holds the stops the weights give to the art.
//   PLAYWRIGHT_PATH=... node tools/headless/wallpaper_stops.cjs --weights
const fs = require('fs');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const SRC = fs.readFileSync(path.join(__dirname, '../../web/hk/modules/hk-wallpapers.js'), 'utf8');
const WEIGHTS = process.argv.includes('--weights');

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let bad = 0;
  try {
    const page = await (await browser.newContext({ viewport: { width: 400, height: 400 } })).newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: SRC });
    const out = await page.evaluate(async (weights) => {
      const W = window.hkWallpapers, AT = [0, 0.42, 0.72, 1], HALF = 0.04;
      const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      const draw = (src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
      // the four bands' mean colours of a picture drawn at w x h
      const bands = async (src, w, h) => {
        const im = await draw(src);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const x = cv.getContext('2d'); x.drawImage(im, 0, 0, w, h);
        const d = x.getImageData(0, 0, w, h).data;
        return AT.map((f) => {
          const y0 = Math.max(0, Math.round((f - HALF) * h)), y1 = Math.min(h, Math.round((f + HALF) * h));
          const s = [0, 0, 0]; let n = 0;
          for (let y = y0; y < y1; y++) for (let i = y * w * 4; i < (y + 1) * w * 4; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; }
          return s.map((v) => v / n);
        });
      };
      const url = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const themes = W.list().filter((w) => w.theme);
      if (weights) {
        const res = {};
        for (const t of themes) {
          const K = W.colors(t.id, false).length, black = Array(K).fill('#000000');
          const c = {};
          for (const night of [false, true]) c[night ? 'night' : 'day'] = (await bands(url(W._frame(t.id, black, night)), 500, 350)).map((b) => +(b[0] / 255).toFixed(4));
          const w = AT.map(() => []);
          for (let k = 0; k < K; k++) {
            const P = black.slice(); P[k] = '#ffffff';
            (await bands(url(W._frame(t.id, P, false)), 500, 350)).forEach((b, i) => { w[i].push(+Math.max(0, b[0] / 255 - c.day[i]).toFixed(4)); });
          }
          res[t.id] = { w, c };
        }
        return { weights: res };
      }
      const res = {};
      for (const w of W.list().filter((x) => !x.theme)) {
        res[w.id] = { have: W.stops(w.id) };
        for (const night of [false, true]) res[w.id][night ? 'night' : 'day'] = (await bands(W.url(w.id, night), 400, 400)).map(hex);
      }
      // the themes, in every preset and a few colours of the owner's own (a white, a black, a bright yellow)
      const cols = W.COLORS.map((c) => c[0]).concat(['#ffffff', '#000000', '#ffee00']);
      for (const t of themes) {
        for (const col of cols) {
          const key = t.id + '@' + col;
          res[key] = { have: W.stops(t.id, col) };
          for (const night of [false, true]) res[key][night ? 'night' : 'day'] = (await bands(W.url(t.id, night, col), 500, 350)).map(hex);
        }
      }
      return res;
    }, WEIGHTS);
    if (WEIGHTS) { console.log(JSON.stringify(out.weights)); return; }
    const table = {};
    for (const [id, r] of Object.entries(out)) {
      if (!id.includes('@')) table[id] = { day: r.day, night: r.night };
      for (const k of ['day', 'night']) r[k].forEach((c, i) => {
        const h = r.have[k][i];
        if (typeof h !== 'string' || !/^#[0-9a-f]{6}$/.test(h)) { bad++; return; }
        for (let j = 1; j < 7; j += 2) {
          if (Math.abs(parseInt(c.slice(j, j + 2), 16) - parseInt(h.slice(j, j + 2), 16)) > 6) {
            bad++; if (id.includes('@')) console.error(id, k, i, 'art', c, 'stops', h);
            break;
          }
        }
      });
    }
    console.log(JSON.stringify(table, null, 1));
    if (process.argv.includes('--check')) { console.error(bad ? bad + ' stops differ from the art' : 'stops match the art'); process.exitCode = bad ? 1 : 0; }
  } finally { await browser.close(); }
})();
