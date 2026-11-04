// art_fallback_check.cjs: the browser side of art_fallback_check.py (Playwright, WebKit, the gallery's fictional house).
// One scenario per run. Every picture address the house hands out (a speaker's cover, a person's face) is stood in
// for: refused with a 404 ("bad"), or answered once and then refused ("good-then-bad"). It fails when a VISIBLE
// <img> in any shadow tree has no picture (complete and naturalWidth > 0 is the test: a broken-image "?" is neither).
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
// a 2 x 2 PNG: enough to be a picture
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVQI12P4z8Dwn4EBDAAAJAUCAGAuSX0AAAAASUVORK5CYII=', 'base64');

// every <img> that can be seen, in every shadow tree: has a box, is not display:none / hidden, is in the window
const VISIBLE_IMGS = () => {
  const out = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.localName === 'img') {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        let hidden = r.width < 1 || r.height < 1 || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
        for (let p = el; p && !hidden; p = p.parentElement || (p.getRootNode && p.getRootNode().host)) {
          if (p.nodeType === 1 && (getComputedStyle(p).display === 'none')) hidden = true;
        }
        if (!hidden && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) {
          out.push({ src: (el.getAttribute('src') || '').slice(0, 60), ph: el.getAttribute('data-ph'), ok: el.complete && el.naturalWidth > 0,
                     w: el.naturalWidth, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                     host: (el.getRootNode().host || {}).localName || '' });
        }
      }
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return out;
};

(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const browser = await pw[input.engine].launch({ headless: true, timeout: 20000 });
  const fails = [], notes = [];
  let bad = true;                     // whether the stood-in addresses answer 404 now
  for (const [W, H] of input.sizes) {
    const tag = input.scenario + ' ' + W + 'x' + H;
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await context.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== input.origin) return route.abort();
      if (u.pathname.startsWith('/__art/')) {
        return bad ? route.fulfill({ status: 404, body: 'no' }) : route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      }
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
    page.setDefaultTimeout(20000);
    for (const view of input.views) {
      const name = tag + ' ' + view.screen + '/' + view.view;
      bad = input.art === 'bad';
      await page.goto(input.origin + '/' + view.screen + '/' + view.view);
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForTimeout(3500);
      const imgs = await page.evaluate(`(${VISIBLE_IMGS.toString()})()`);
      const broken = imgs.filter((i) => !i.ok);
      const fell = imgs.filter((i) => i.ph && /^data:image\/svg/.test(i.src));
      if (broken.length) fails.push(name + ': ' + broken.length + ' picture(s) with no image: ' + JSON.stringify(broken.slice(0, 4)));
      else notes.push(name + ': ' + imgs.length + ' visible image(s), all drawn; ' + fell.length + ' on the placeholder');
      if (input.art === 'bad' && view.expectFallback && W >= 640 && !fell.length && !view.expectNone) {
        fails.push(name + ': nothing fell back to a placeholder, so the check did not exercise the guard');
      }
      if (view.expectNone) {
        // an unavailable player has no picture at all: the block draws its own note, no <img> for the cover
        const np = await page.evaluate(() => {
          const out = [];
          const walk = (root) => { for (const el of root.querySelectorAll('*')) {
            if (el.localName === 'hk-now-playing-card' && el.shadowRoot) {
              const a = el.shadowRoot.querySelector('.art');
              out.push({ img: !!(a && a.querySelector('img')), none: !!(a && a.querySelector('.none')) });
            }
            if (el.shadowRoot) walk(el.shadowRoot); } };
          walk(document); return out;
        });
        if (!np.length) fails.push(name + ': no Now Playing card on the screen');
        np.forEach((n) => { if (n.img || !n.none) fails.push(name + ': an unavailable player shows ' + JSON.stringify(n)); });
        notes.push(name + ': Now Playing blocks with the note and no picture: ' + np.length);
      }
      if (input.art === 'good-then-bad' && view.screen === input.views[0].screen) {
        // the pictures loaded once (the thumbnails are kept); now the next version of each cannot be had
        const kept = await page.evaluate(() => { try { return Object.keys(JSON.parse(localStorage.getItem('hk-snap-v1') || '{}')).filter((k) => k.indexOf('art:') === 0).length; } catch (e) { return -1; } });
        await page.evaluate(() => {
          try { window.hkCards.snapCache._flush(); } catch (e) { /* none */ }
        });
        bad = true;
        const re = await page.evaluate(() => {
          const imgs = [];
          const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.localName === 'img' && el.getAttribute('data-ph')) imgs.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
          walk(document);
          imgs.forEach((el) => { const s = el.getAttribute('src'); if (/__art\//.test(s)) el.setAttribute('src', s.replace(/[?].*$/, '') + '?v=2'); });
          return imgs.length;
        });
        await page.waitForTimeout(3500);
        const after = await page.evaluate(`(${VISIBLE_IMGS.toString()})()`);
        const kindOf = (i) => (/^data:image\/jpeg/.test(i.src) ? 'last-good' : /^data:image\/svg/.test(i.src) ? 'placeholder' : 'other:' + i.src);
        const kind = after.filter((i) => i.ph).map((i) => i.ph + ':' + kindOf(i));
        // a cover whose next version fails is the note, NEVER the last cover; a face keeps its last good one
        const wrong = after.filter((i) => i.ph && i.ph !== 'av' && kindOf(i) !== 'placeholder');
        const brk = after.filter((i) => !i.ok);
        if (brk.length) fails.push(name + ' (next version refused): ' + JSON.stringify(brk.slice(0, 4)));
        else if (wrong.length) fails.push(name + ' (next version refused): a cover is not the note: ' + JSON.stringify(wrong.slice(0, 3)));
        else if (kind.some((k) => k.startsWith('av:')) && !kind.includes('av:last-good')) fails.push(name + ' (next version refused): no last-good picture shown; kept=' + kept + ' re-asked=' + re + ' got ' + JSON.stringify(kind));
        else notes.push(name + ' (next version refused): ' + kind.join(',') + ' (kept ' + kept + ')');
        bad = false;
      }
      if (input.shots) await page.screenshot({ path: input.shots + '/' + input.scenario + '-' + view.screen + '-' + W + 'x' + H + '.png' });
    }
    if (errors.length) fails.push(tag + ': page errors ' + JSON.stringify(errors.slice(0, 3)));
    await context.close();
  }
  await browser.close();
  console.log(notes.join('\n'));
  if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
  console.log('PASS: ' + input.scenario);
})().catch((e) => { console.error(e); process.exit(1); });
