// sheet_review.py's browser: WebKit, each size in turn, each sheet opened, measured, shot and closed.
// One JSON line a sheet on stdout: {size, name, m}.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));

// measured inside the open sheet (a function: the page's CSP allows no string evaluation)
function measure() {
  const kids = (n) => [...n.children, ...(n.shadowRoot ? n.shadowRoot.children : [])];
  const all = (n) => kids(n).flatMap((e) => [e, ...all(e)]);
  const host = all(document.body).find((e) => e.classList && e.classList.contains('hkd') && e.classList.contains('open'));
  if (!host) return null;
  const sheet = host.querySelector('.sheet'), body = host.querySelector('.body'), x = host.querySelector('.x');
  const r = sheet.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, sc = getComputedStyle(sheet), bb = body.getBoundingClientRect();
  // what it draws, against the sheet's own padding across and the body's top and foot (the body may reach into the padding)
  const b = { left: r.left + parseFloat(sc.paddingLeft), right: r.right - parseFloat(sc.paddingRight), top: bb.top, bottom: bb.bottom };
  const shown = (e) => { const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.opacity !== '0' && cs.display !== 'none'; };
  const SKIP = /^(style|script|template|slot|link)$/, LEAF = /^(svg|canvas|img|video|hk-icon|input|ha-icon)$/;
  const name = (e) => e.localName + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '');
  // what it draws: the leaves (an element with nothing in it, or a picture), cut to the body
  let u = null; const wide = [];
  const walk = (e) => {
    if (SKIP.test(e.localName) || !shown(e)) return;
    const k = LEAF.test(e.localName) ? [] : kids(e).filter((c) => !SKIP.test(c.localName));
    k.forEach(walk);
    // (a box counts where it paints -- a card's plate, a track -- not only what is innermost)
    const cs = getComputedStyle(e);
    const paints = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0;
    if (k.length && !paints) return;
    const q = e.getBoundingClientRect();
    if (q.width < 1 || q.height < 1 || q.right <= b.left || q.left >= b.right || q.bottom <= b.top || q.top >= b.bottom) return;
    // (a bare sheet, the camera's, is the picture to every edge)
    if (!sheet.classList.contains('bare') && (q.left < r.left + 12 || q.right > r.right - 12)) wide.push(name(e));
    const c = [Math.max(q.left, b.left), Math.max(q.top, b.top), Math.min(q.right, b.right), Math.min(q.bottom, b.bottom)];
    u = u ? [Math.min(u[0], c[0]), Math.min(u[1], c[1]), Math.max(u[2], c[2]), Math.max(u[3], c[3])] : c;
  };
  kids(body).forEach(walk);
  // the controls, and any a finger could miss
  const small = [];
  all(sheet).forEach((e) => {
    if (!e.matches || !e.matches('button,[role=button],[role=switch],[role=slider],[role=radio],[role=tab],input:not([type=hidden]),select,a[href]')) return;
    if (!shown(e)) return;
    let q = e.getBoundingClientRect();
    if (q.width < 1 || q.height < 1) return;
    // (a tap area past the element: an ::after laid over it, inset by minus so much)
    const af = getComputedStyle(e, '::after');
    if (af.content !== 'none' && af.position === 'absolute') {
      const o = -Math.min(0, parseFloat(af.top) || 0, parseFloat(af.left) || 0);
      if (o) q = { width: q.width + 2 * o, height: q.height + 2 * o };
    }
    // (a long slider's 28 pt track is a 28 pt finger's along its whole length, as iOS's are)
    const long = Math.max(q.width, q.height) >= 120 && Math.min(q.width, q.height) >= 24;
    if (Math.min(q.width, q.height) < 30 && !long) small.push(name(e) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
  });
  const xr = x && x.getBoundingClientRect();
  return {
    sheet: [r.left | 0, r.top | 0, r.width | 0, r.height | 0],
    inside: r.left >= 7 && r.top >= 7 && r.right <= vw - 7 && r.bottom <= vh - 7,
    scroll: body.scrollHeight - body.clientHeight,
    wide: [...new Set(wide)].slice(0, 4),
    small: [...new Set(small)].slice(0, 4),
    x: xr ? [Math.round(r.right - xr.right), Math.round(xr.top - r.top)] : null,
    lr: u ? [Math.round(u[0] - b.left), Math.round(b.right - u[2])] : null,
    pad: [parseFloat(sc.paddingLeft), parseFloat(sc.paddingRight)], xright: xr ? Math.round(r.right - xr.right) : null,
    tb: u ? [Math.round(u[1] - b.top), Math.round(b.bottom - u[3])] : null,
  };
}

function openSheet(id) {
  if (id !== 'event') { window.hkDetail.open(id); return; }
  const s = new Date(); s.setHours(19, 0, 0, 0);
  window.hkDetail.open('calendar.family', null, { event: { cal: 'calendar.family', uid: 'u1', title: 'Dinner with the Riveras',
    desc: 'Bring dessert', loc: 'Riverside Grill', allDay: false, start: s, end: new Date(+s + 36e5), key: 'k' } });
}
(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  try {
    for (const size of input.sizes) {
      const [width, height] = size.split('x').map(Number);
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, deviceScaleFactor: +(process.env.DPR || 1) });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(input.origin + '/' + input.screen + '/home');
      await page.waitForFunction(() => window.__mantelReady === true && !!window.hkDetail, null, { timeout: 30000 });
      // headless WebKit draws no backdrop blur: the frost Safari gives the sheet stood in for, so the
      // page behind does not show through the shots
      await page.evaluate(() => { const css = new CSSStyleSheet();
        css.replaceSync('.hkd .sheet{background:rgba(44,44,50,.96)!important}');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, css]; });
      await page.waitForTimeout(1500);
      for (const [name, id] of input.sheets) {
        let m = null;
        for (let t = 0; t < 2 && !m; t++) {           // a sheet still closing refuses the next: once more
          await page.evaluate(openSheet, id);
          await page.waitForTimeout(1300 + t * 800);
          m = await page.evaluate(measure);
        }
        if (input.shots) await page.screenshot({ path: input.shots + '/' + size + '-' + name + '.png' });
        process.stdout.write(JSON.stringify({ size, name, m }) + '\n');
        await page.evaluate(() => window.hkDetail.close && window.hkDetail.close());
        await page.waitForFunction(() => {
          const kids = (n) => [...n.children, ...(n.shadowRoot ? n.shadowRoot.children : [])];
          const all = (n) => kids(n).flatMap((e) => [e, ...all(e)]);
          return !all(document.body).some((e) => e.classList && e.classList.contains('hkd') && e.classList.contains('open'));
        }, null, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(700);
      }
      if (errors.length) console.log('page errors at ' + size + ': ' + errors.slice(0, 3).join(' | '));
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.log(String(e && e.stack || e)); process.exit(1); });
