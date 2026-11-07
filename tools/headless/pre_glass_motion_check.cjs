// pre_glass_motion_check.py's browser half: Pre-rendered glass (Blur and Bright Glass) over a moving wallpaper in
// WebKit -- the real detector and painter. Prints PASS / FAIL lines.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// what the glass wears now: its picture, how old, the cards' layers and the pinned tab bar
function state() {
  const deep = (r, sel) => { const out = [...r.querySelectorAll(sel)]; r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) out.push(...deep(e.shadowRoot, sel)); }); return out; };
  const G = window.hkGlass, pre = G && G._pre && G._pre.state(), S = window.hkSky;
  // (each layer's pictures, by the layer: one fading out beside the newest is fine)
  const byLayer = new Map();
  deep(document, '[data-hk-pre]').forEach((i) => { const L = i.parentNode; if (!byLayer.has(L)) byLayer.set(L, []); byLayer.get(L).push(i.getAttribute('data-src') || ''); });
  const imgs = [...byLayer.values()];
  const bar = deep(document, '#hk-tabbar')[0], pill = bar && bar.shadowRoot && bar.shadowRoot.querySelector('.pill');
  return { url: pre ? pre.url : null, at: pre ? pre.at : 0, drifting: !!(S && S.drifting && S.drifting()),
           wm: S && S.element && S.element() ? S.element().getAttribute('data-wm') : null,
           layers: imgs.length, layersNewest: imgs.length > 0 && !!pre && imgs.every((srcs) => srcs.indexOf(pre.url) >= 0),
           bar: pill ? (pill.style.background || '').indexOf(pre && pre.url) >= 0 : null,
           surfaces: surfaces(pre && pre.url) };
  // the persistent surfaces: wearing the newest picture, and no live blur left on them
  function surfaces(url) {
    const side = document.querySelector('hk-side-pane[mode="dash"]'), pane = side && side.shadowRoot && side.shadowRoot.querySelector('.pane');
    const menu = deep(document, '#hk-menu')[0], mat = menu && menu.shadowRoot && menu.shadowRoot.querySelector('.mat');
    const seen = window.__pgmSeen = window.__pgmSeen || [];
    if (url && seen[seen.length - 1] !== url) seen.push(url);
    const prev = seen[seen.length - 2];
    const one = (el) => { if (!el) return null; const cs = getComputedStyle(el), bf = cs.webkitBackdropFilter || cs.backdropFilter || 'none', bg = el.style.background || '';
                          return { newest: !!url && bg.indexOf(url) >= 0, recent: !!prev && bg.indexOf(prev) >= 0, live: bf !== 'none' }; };
    return { pane: one(pane), menu: one(mat), bar: one(pill) };
  }
}
// the picture's pixels, kept on the page under `key`; with `against`, how far they are from that one's (mean, max /255)
async function pixels(page, key, against) {
  return page.evaluate(async ([key, against]) => {
    const pre = window.hkGlass._pre.state(), im = new Image();
    im.src = pre.url; await im.decode();
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    window.__pgm = window.__pgm || {}; window.__pgm[key] = d;
    if (!against) return null;
    const o = window.__pgm[against]; if (!o || o.length !== d.length) return { mean: -1, max: -1 };
    let sum = 0, max = 0;
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) { const v = Math.abs(d[i + k] - o[i + k]); sum += v; if (v > max) max = v; }
    return { mean: +(sum / (d.length / 4 * 3)).toFixed(2), max };
  }, [key, against || null]);
}
// the pictures painted over `ms` with nothing touching the page
async function watch(page, ms) {
  const seen = new Set(); const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await page.evaluate(state); if (s.url) seen.add(s.url); await sleep(200); }
  return seen.size;
}
// the screen's Motion changed as the house would send it (hkSettings._apply with the stored payload, changed)
async function motion(page, path, m) {
  await page.evaluate(([path, m]) => {
    const p = JSON.parse(localStorage.getItem('hk_settings'));
    if (p.boards && p.boards[path]) p.boards[path].sky_wallpaper_motion = m;
    window.hkSettings._apply(p);
  }, [path, m]);
}

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (got === undefined ? '' : '  ' + JSON.stringify(got))); };
  try {
    for (const size of input.sizes) {
      const [width, height] = size.split('x').map(Number);
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, deviceScaleFactor: 1 });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => { if (!/^ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      for (const s of input.screens) {
        // (a phone has no room for a Side Pane and docks no menu: there they are not up, or blur live over the page)
        if (s.surface && width < 768) continue;
        const tag = size + ' ' + s.glass + ' ' + s.wall + (s.surface ? ' ' + s.surface : '');
        await page.goto(input.origin + '/' + s.path + '/home');
        await page.waitForFunction(() => window.__mantelReady === true && !!window.hkWallpapers, null, { timeout: 30000 });
        await require('./grid_ready.cjs')(page);
        await page.waitForFunction(() => { const p = window.hkGlass && window.hkGlass._pre && window.hkGlass._pre.state(); return p && p.url; }, null, { timeout: 20000 });
        await sleep(1500);
        if (input.shots) await page.screenshot({ path: input.shots + '/' + s.path + '-' + size + '.png' });
        const a = await page.evaluate(state);
        if (s.surface) {
          // (twice, a few seconds apart: each wears the picture of the moment, not the first one -- the newest or,
          // as it fades in, the one before it)
          const k = s.surface, what = k === 'pane' ? 'Side Pane' : 'docked menu';
          for (const when of ['now', 'later']) {
            if (when === 'later') await watch(page, 4500);
            const f = (await page.evaluate(state)).surfaces[k];
            say(f && (f.newest || f.recent) && !f.live, tag + ': the ' + what + ' wears the newest picture, no live blur (' + when + ')', f);
          }
          continue;
        }
        say(a.wm === 'fast' && a.drifting, tag + ': the moving wallpaper reads as drifting', { wm: a.wm, drifting: a.drifting });
        await pixels(page, 'first');
        const n = await watch(page, 7000);
        const b = await page.evaluate(state);
        const diff = await pixels(page, 'later', 'first');
        say(n >= 3, tag + ': a new picture every couple of seconds (7 s untouched)', { pictures: n });
        say(diff && diff.max >= 4, tag + ': ...and the newest differs from the first', diff);
        say(b.layers > 0 && b.layersNewest, tag + ': the cards\' glass wears the newest', { layers: b.layers, newest: b.layersNewest });
        say(b.surfaces.bar && (b.surfaces.bar.newest || b.surfaces.bar.recent) && !b.surfaces.bar.live, tag + ': ...and the tab bar its slice of it, no live blur', b.surfaces.bar);
        // MOTION OFF: painted again at once (the still frame), then left alone
        const before = (await page.evaluate(state)).url;
        await motion(page, s.path, 'off');
        await sleep(1500);
        const c = await page.evaluate(state);
        say(!c.wm && !c.drifting && c.url && c.url !== before, tag + ': Motion Off: painted again at once, not drifting', { wm: c.wm, drifting: c.drifting, repainted: c.url !== before });
        const still = await watch(page, 5000);
        say(still <= 1, tag + ': ...and no more pictures after it', { pictures: still });
        // MOTION SLOW: painted at once, followed again
        const off = (await page.evaluate(state)).url;
        await motion(page, s.path, 'slow');
        await sleep(1500);
        const d = await page.evaluate(state);
        say(d.wm === 'slow' && d.drifting && d.url !== off, tag + ': Motion Slow: painted at once and drifting again', { wm: d.wm, drifting: d.drifting, repainted: d.url !== off });
        const again = await watch(page, 5000);
        say(again >= 2, tag + ': ...followed again', { pictures: again });
      }
      say(!errors.length, size + ' no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await browser.close(); }
  process.exitCode = fails ? 1 : 0;
})();
