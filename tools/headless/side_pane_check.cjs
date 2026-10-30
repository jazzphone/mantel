// side_pane_check.cjs: the browser side of side_pane_check.py (Playwright, the gallery's fictional house)
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const KINDS = ['clock', 'weather', 'calendar', 'now_playing', 'security', 'camera', 'timers', 'energy', 'climate', 'people', 'todo', 'notifications'];
const SIZES = ['tiny', 'less', 'more', 'full'];
(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const browser = await pw[input.engine].launch({ headless: true, timeout: 20000 });
  const fails = [], notes = [];
  const shot = async (page, name) => { if (input.shots) await page.screenshot({ path: input.shots + '/' + name + '.png' }); };
  // the pane's state, from the page: where it is, whether it scrolls, the page's margins
  const look = (page) => page.evaluate(() => {
    const p = document.querySelector('hk-side-pane[mode="dash"]');
    const de = document.documentElement, st = de.style;
    const out = { on: !!(p && p.hasAttribute('on')), side: p && p.getAttribute('side'), attr: de.getAttribute('hk-pane'),
                  l: st.getPropertyValue('--hk-pane-l'), r: st.getPropertyValue('--hk-pane-r'), b: st.getPropertyValue('--hk-pane-b') };
    if (out.on) {
      const r = p.getBoundingClientRect(), secs = p.shadowRoot.querySelector('.secs');
      out.rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      out.scrolls = secs.scrollHeight > secs.clientHeight + 1;
      out.kinds = [...secs.children].map((k) => (k.dataset.k || k.className) + (k.dataset.size ? ':' + k.dataset.size : ''));
    }
    return out;
  });
  for (const [W, H] of input.sizes) {
    const context = await browser.newContext({ viewport: { width: W, height: H } });
    await context.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
    await context.route('**/*', (route) => new URL(route.request().url()).origin === input.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    let cur = '';
    // (the browser's benign "ResizeObserver loop" note is no error, as the other checks have it)
    page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(cur + ': ' + e.message); });
    page.setDefaultTimeout(20000);
    const open = async (scr, view) => {
      cur = scr + '/' + (view || 'home');
      await page.goto(input.origin + '/' + scr + '/' + (view || 'home'));
      await page.waitForFunction(() => window.__mantelReady === true);
      await page.waitForTimeout(2500);
    };
    const tag = W + 'x' + H, phone = W < 640, upright = H > W;
    const want = (name, l, ok) => { if (!ok) fails.push(tag + ' ' + name + ': ' + JSON.stringify(l)); else notes.push(tag + ' ' + name + ' ok'); };
    for (const side of ['right', 'left']) {
      await open('pane-home-' + side);
      const l = await look(page);
      if (phone) want('home ' + side + ': never on a phone', l, !l.on && !l.attr);
      else if (upright) want('home ' + side + ': a band under the page', l, l.on && l.side === 'band' && l.b && !l.scrolls);
      else want('home ' + side + ': down its side, the grid beside it', l, l.on && l.side === side && l[side[0]] && !l.scrolls &&
                (side === 'right' ? l.rect[0] + l.rect[2] === W : l.rect[0] === 0));
      await shot(page, tag + '-home-' + side);
    }
    await open('pane-every-page');
    let l = await look(page);
    want('every page: Home', l, phone ? !l.on : l.on && !l.scrolls);
    await shot(page, tag + '-every-page-home');
    const views = await page.evaluate(() => (window.hkCards.menu.config().views || []).map((v) => v.path).filter(Boolean));
    const other = views.filter((v) => v !== 'home')[0];
    if (other) {
      await open('pane-every-page', other);
      l = await look(page);
      const margin = await page.evaluate(() => { const v = window.hkShell.viewSlot(window.hkCards.menu.panel()); return v ? v.style.marginRight : ''; });
      want('every page: ' + other + ', narrowed by the pane', [l, margin], phone ? !l.on : upright ? l.on && l.side === 'band' : l.on && margin === l.r);
      await shot(page, tag + '-every-page-' + other);
    }
    await open('pane-eight');
    l = await look(page);
    want('eight sections together: fitted, never scrolling', l, phone ? !l.on : l.on && !l.scrolls);
    if (l.on) notes.push(tag + ' eight drawn as ' + l.kinds.join(', '));
    await shot(page, tag + '-eight');
    for (const side of ['right', 'left']) {
      await open('pane-saver-' + side);
      await page.evaluate(() => window.hkSaver.preview(true));
      await page.waitForTimeout(3500);
      const s = await page.evaluate(() => {
        const host = document.querySelector('hk-screensaver') || [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.pane hk-side-pane'));
        const sp = host && host.shadowRoot && host.shadowRoot.querySelector('.pane hk-side-pane');
        const pane = host && host.shadowRoot && host.shadowRoot.querySelector('.pane');
        const r = pane && pane.getBoundingClientRect();
        return { saver: !!host, side: host && host.getAttribute('pside'), on: !!(sp && sp.hasAttribute('on')),
                 rect: r ? [Math.round(r.left), Math.round(r.width)] : null,
                 kinds: sp ? [...sp.shadowRoot.querySelectorAll('.secs > *')].map((k) => (k.dataset.k || '') + ':' + (k.dataset.size || '')) : [] };
      });
      want('screensaver ' + side + ': its own sections on its side', s, s.on && (side === 'left' ? s.side !== null && s.rect[0] === 0 : s.side === null && s.rect[0] + s.rect[1] === W));
      await shot(page, tag + '-saver-' + side);
      await page.evaluate(() => window.hkSaver.preview(false));
    }
    // EVERY SECTION ALONE AT EACH SIZE (a pane of its own, beside nothing), at the tablet's size only
    if (!phone && !upright) {
      await open('pane-none');
      for (const kind of KINDS) {
        for (const size of SIZES) {
          const got = await page.evaluate(([kind, size]) => {
            let el = document.getElementById('solo');
            if (!el) { el = window.hkSidePane.create('dash'); el.id = 'solo'; document.body.appendChild(el); }
            Object.assign(el.style, { left: '0px', top: '0px', bottom: '0px', width: '400px' });
            el.show({ list: [{ kind, size }], place: { kind: 'side', w: 400 }, side: 'left' });
            const secs = el.shadowRoot.querySelector('.secs'), k = secs.firstElementChild;
            return { k: k && (k.dataset.k + ':' + k.dataset.size), h: k ? Math.round(k.getBoundingClientRect().height) : 0, scrolls: secs.scrollHeight > secs.clientHeight + 1 };
          }, [kind, size]);
          want('alone ' + kind + ' ' + size, got, got.k === kind + ':' + size && got.h > 0 && !got.scrolls);
        }
        await page.waitForTimeout(300);
        if (input.shots) {
          // the four sizes of one kind side by side
          await page.evaluate((kind) => {
            document.querySelectorAll('.solo4').forEach((e) => e.remove());
            const S = ['tiny', 'less', 'more', 'full'];
            document.getElementById('solo').style.display = 'none';
            S.forEach((size, i) => {
              const el = window.hkSidePane.create('dash'); el.className = 'solo4'; document.body.appendChild(el);
              Object.assign(el.style, { left: (i * 295) + 'px', top: '0px', bottom: '0px', width: '290px' });
              el.show({ list: [{ kind, size }], place: { kind: 'side', w: 290 }, side: 'left' });
            });
          }, kind);
          await page.waitForTimeout(600);
          await shot(page, tag + '-alone-' + kind);
          await page.evaluate(() => { document.querySelectorAll('.solo4').forEach((e) => e.remove()); document.getElementById('solo').style.display = ''; });
        }
      }
    }
    if (errors.length) fails.push(tag + ' page errors: ' + errors.join(' | '));
    await context.close();
  }
  await browser.close();
  console.log(notes.join('\n'));
  if (fails.length) { console.log('\nFAILED:\n' + fails.join('\n')); process.exit(1); }
  console.log('\nside pane: all checks passed');
})().catch((e) => { console.error(e); process.exit(2); });
