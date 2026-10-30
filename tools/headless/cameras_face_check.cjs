// The Cameras face in WebKit (cameras_face_check.py starts the server over the fictional home; 2026-10-30).
// One screen at one size per run:
//   - every face (hk-grid-cameras-card) has its tiles arranged to its block -- Full 3 x 3 (2 x 4 on a phone),
//     Full Width 4 x 2, Extra Large 3 x 2 -- each tile inside its cell, with its picture and its name;
//     the page does not scroll
//   - a doorbell ring (the house's notification): the doorbell's tile live in its place, ringed and LIVE, and
//     only one face's -- one live feed per tablet
//   - a tap on a tile opens that camera (its sheet)
const assert = require('assert/strict');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const [W, H] = input.size.split('x').map(Number);
const TAG = input.screen + ' ' + input.size;
// what each home supplies from its own files and the fictional house has not (edit_mode_check.cjs)
const HOMES_OWN = /\/hk\/(fonts\/SF-Pro\.(woff2|ttf)|iconset\/hk-glyphs\.js)$/;
const WANT = { F: W < 640 ? [2, 4] : [3, 3], XXL: [4, 2], XL: [3, 2] };

const FACES = () => {
  const all = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? all(e.shadowRoot, s) : [])]);
  return all(document, 'hk-grid-cameras-card').map(face => {
    const cell = face.parentElement, c = cell.getBoundingClientRect();
    // (null until each is defined: Mantel loads a card's file when a page first needs it)
    const mosaic = face.shadowRoot && all(face.shadowRoot, 'hk-camera-mosaic-card')[0], plate = mosaic && mosaic.shadowRoot && mosaic.shadowRoot.querySelector('.plate.grid');
    const tiles = plate ? [...plate.children] : [];
    const rects = tiles.map(t => t.getBoundingClientRect());
    const uniq = xs => [...new Set(xs.map(x => Math.round(x)))].length;
    return {
      id: cell.dataset.id, size: face.getAttribute('size'), n: tiles.length,
      cols: uniq(rects.map(r => r.left)), rows: uniq(rects.map(r => r.top)),
      inside: rects.every(r => r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1),
      fills: rects.length ? Math.round((Math.max(...rects.map(r => r.right)) - Math.min(...rects.map(r => r.left))) / c.width * 100) : 0,
      pictures: tiles.filter(t => t.querySelector('canvas.on, img.on')).length,
      names: tiles.map(t => (t.querySelector('.cn') || {}).textContent || ''),
      live: tiles.filter(t => t.classList.contains('on')).map(t => (t.querySelector('.cn') || {}).textContent),
      lv: tiles.filter(t => t.querySelector('.lv')).length,
      corner: tiles.length ? getComputedStyle(tiles[0]).borderRadius : ''
    };
  });
};

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
    await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push('page error: ' + e.message); });
    p.on('requestfailed', r => { if (!HOMES_OWN.test(new URL(r.url()).pathname)) errors.push('request failed: ' + r.url()); });
    p.setDefaultTimeout(20000);
    await p.goto(input.origin + '/' + input.screen + '/home');
    await p.waitForFunction(() => window.__mantelReady === true);
    // every face drawn, every tile with its picture
    await p.waitForFunction(new Function('const f = (' + FACES.toString() + ')(); return f.length > 0 && f.every(x => x.n > 0 && x.pictures === x.n);'));
    await p.waitForTimeout(600);
    const faces = await p.evaluate(FACES);
    for (const f of faces) {
      const want = WANT[f.size];
      assert.deepEqual([f.cols, f.rows], want, TAG + ' ' + f.id + ': arranged ' + f.cols + ' x ' + f.rows);
      assert.equal(f.n, f.id === 'six' ? 6 : want[0] * want[1], TAG + ' ' + f.id + ': tiles');
      assert.ok(f.inside, TAG + ' ' + f.id + ': a tile outside its cell');
      assert.ok(f.fills >= 98, TAG + ' ' + f.id + ': the tiles fill ' + f.fills + '% of the cell');
      assert.ok(f.names.every(Boolean), TAG + ' ' + f.id + ': a tile without its name');
      assert.equal(f.lv, 0, TAG + ' ' + f.id + ': live before any ring');
    }
    const scroll = await p.evaluate(() => { const s = document.scrollingElement; return [s.scrollWidth - innerWidth, s.scrollHeight - innerHeight]; });
    assert.ok(scroll[0] <= 1 && scroll[1] <= 1, TAG + ': the page scrolls ' + scroll);
    if (input.shots) await p.screenshot({ path: input.shots + '/' + input.screen + '-' + input.size + '.png' });
    // THE DOORBELL RINGS
    await p.evaluate(cam => window.dispatchEvent(new CustomEvent('hk-house-event', { detail: { type: 'notification', kind: 'doorbell', camera: cam } })), input.doorbell);
    await p.waitForFunction(new Function('return (' + FACES.toString() + ')().some(x => x.lv === 1);'));
    await p.waitForTimeout(800);
    const rung = await p.evaluate(FACES);
    assert.equal(rung.reduce((n, f) => n + f.lv, 0), 1, TAG + ': one live tile on the tablet, ' + JSON.stringify(rung.map(f => f.live)));
    const ringing = rung.find(f => f.lv === 1);
    assert.deepEqual(ringing.live, ['Doorbell'], TAG + ': the doorbell\'s tile is the live one');
    assert.equal(ringing.n, faces.find(f => f.id === ringing.id).n, TAG + ': live in its place, the others still there');
    if (input.shots) await p.screenshot({ path: input.shots + '/' + input.screen + '-' + input.size + '-ring.png' });
    // A TAP opens that camera
    await p.evaluate(() => { window.__opened = []; const S = window.hkShell, o = S.moreInfo.bind(S); S.moreInfo = (id, el) => { window.__opened.push(id); return o(id, el); }; });
    const target = await p.evaluateHandle(() => {
      const all = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? all(e.shadowRoot, s) : [])]);
      return all(document, '.plate.grid > .snap')[2];
    });
    await target.asElement().click();
    await p.waitForFunction(() => window.__opened.length === 1);
    const opened = await p.evaluate(() => window.__opened[0]);
    assert.match(opened, /^camera\./, TAG + ': a tap opened ' + opened);
    await p.waitForTimeout(1500);
    if (input.shots) await p.screenshot({ path: input.shots + '/' + input.screen + '-' + input.size + '-tap.png' });
    assert.deepEqual(errors, [], TAG + ': errors');
    console.log('PASS ' + TAG + ': ' + faces.map(f => f.id + ' ' + f.size + ' ' + f.cols + 'x' + f.rows + ' (' + f.n + ', corner ' + f.corner + ')').join('; ') +
                '; the doorbell live in ' + ringing.id + '; a tap opened ' + opened);
  } catch (e) {
    console.error('FAIL ' + TAG + ': ' + (e && e.message || e));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
