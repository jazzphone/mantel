// Every block opens something when tapped, in WebKit (block_taps_check.py starts the server over the fictional home;
// 2026-10-31, the owner's note on 0.1.94, item 29). One screen at one size per run: each block of the Home Grid is
// tapped where its plate is empty -- a lattice of points in its cell, those whose element, and every element above it,
// is no control -- and where each tap went is read from the shell: a page (hkShell.navigate), an entity's sheet
// (hk-more-info, what hkShell.moreInfo sends), a detail sheet (hkDetail.open) or the tab bar's More (hkTabBar.open).
// Nothing is let through, so the screen stays as it is for the next tap. Prints one JSON line per block.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const [W, H] = input.size.split('x').map(Number);

// WHERE A TAP GOES, recorded: set up before the page's own scripts (the detail module and the tab bar arrive later)
const HOOKS = `(() => {
  window.__taps = [];
  const rec = (...a) => window.__taps.push(a);
  const watch = (name, fix) => { let v; Object.defineProperty(window, name, { configurable: true, get() { return v; }, set(x) { v = x; try { fix(x); } catch (e) { /* not yet */ } } }); };
  watch('hkDetail', d => { if (d && !d.__taps) { d.__taps = true; d.open = function (id) { rec('detail', String(id)); return true; }; d.openGroup = function (t) { rec('group', String(t)); return true; }; } });
  watch('hkTabBar', b => { if (b && !b.__taps) { b.__taps = true; b.open = function (w) { rec('tabbar', String(w)); return true; }; } });
  watch('hkShell', s => { if (s && !s.__taps) { s.__taps = true; s.navigate = function (p) { rec('navigate', String(p)); }; } });
  window.addEventListener('click', e => { window.__path = e.composedPath().slice(0, 12).map(n => (n.localName || n.nodeName) + (n.className && n.className.baseVal === undefined ? '.' + String(n.className).split(' ')[0] : '') + (n.getAttribute && n.getAttribute('role') ? '[' + n.getAttribute('role') + ']' : '')); setTimeout(() => { window.__prevented = e.defaultPrevented; }); }, true);
  window.addEventListener('hk-more-info', e => { rec('moreInfo', String(e.detail && e.detail.entityId)); e.stopImmediatePropagation(); }, true);
})()`;

// the cells and their plates' empty points, measured in the page
const PLATE_POINTS = (n) => {
  const CONTROL = 'button,a,input,select,textarea,summary,[role=button],[role=slider],[role=switch],[role=checkbox],[role=link],[role=menuitem],[data-more],[data-hk-control],[data-notap],.ring,hk-tile-card,hk-light-card,hk-fan-card,hk-cover-card,hk-scene-card,hk-tall-card,hk-favorite-card,hk-climate-card,hk-climate-tall-card,hk-toggle-card';
  const all = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? all(e.shadowRoot, s) : [])]);
  const deepest = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) { const i = el.shadowRoot.elementFromPoint(x, y); if (!i || i === el) break; el = i; }
    return el;
  };
  const above = (el) => { const out = []; while (el) { out.push(el); el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null; } return out; };
  return all(document, '.cell[data-id]').map(cell => {
    const r = cell.getBoundingClientRect(), card = cell.firstElementChild;
    const pts = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = r.left + r.width * (i + 0.5) / n, y = r.top + r.height * (j + 0.5) / n;
      const el = deepest(x, y);
      if (!el) continue;
      const chain = above(el);
      // (inside this cell, and no control among the elements above the point)
      if (!chain.includes(cell)) continue;
      const ctl = chain.find(e => e.matches && e.matches(CONTROL));
      pts.push({ x: Math.round(x), y: Math.round(y), control: ctl ? (ctl.localName + (ctl.className ? '.' + String(ctl.className).split(' ')[0] : '')) : null,
                 on: el.localName + (el.className && el.className.baseVal === undefined ? '.' + String(el.className).split(' ')[0] : '') });
    }
    const box = cell.getBoundingClientRect();
    return { id: cell.dataset.id, tag: card ? card.localName : null, size: card && card.getAttribute('size'), w: Math.round(box.width), h: Math.round(box.height), pts };
  });
};

(async () => {
  const browser = await pw[input.engine || 'webkit'].launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: !!input.touch });
    await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
    await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
    await ctx.addInitScript(HOOKS);
    if (input.feed) await ctx.addInitScript(input.feed);
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push('page error: ' + e.message); });
    p.setDefaultTimeout(20000);
    const open = async () => {
      await p.goto(input.origin + '/' + input.screen + '/home');
      await p.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(p);
      await p.waitForFunction(() => {
        const d = (r) => { for (const e of r.querySelectorAll('*')) { if (e.localName === 'hk-home-grid-view') return e; if (e.shadowRoot) { const f = d(e.shadowRoot); if (f) return f; } } return null; };
        const v = d(document); return v && v.shadowRoot.querySelectorAll('.cell').length > 0;
      });
      await p.waitForTimeout(2500);
      // (the shell's navigate is Mantel's, set up with the page: held back like the rest)
      await p.evaluate(() => { const s = window.hkShell; if (s) s.navigate = (path) => window.__taps.push(['navigate', String(path)]); });
      // (a to-do list opens over the page, and the side menu is the page's own: noted as they open)
      await p.evaluate(() => {
        const T = customElements.get('hk-todo-card'); if (T) T.prototype._open = function (eid) { window.__taps.push(['list', String(eid)]); };
        const b = window.hkTabBar; if (b) b.open = function (w) { window.__taps.push(['tabbar', String(w)]); return true; };
        const m = window.hkMenu; if (m) m.open = function () { window.__taps.push(['menu', 'open']); };
      });
      console.log('PAGES ' + JSON.stringify(await p.evaluate(() => { try { return (window.hkCards.menu.config().views || []).map(v => v.path); } catch (e) { return []; } })));
    };
    await open();
    // A TAP THAT OPENED SOMETHING OVER THE PAGE (a channel played full screen, the Speakers panel) covers the blocks
    // left to tap: put away with Escape, else the page made again
    const UNDER = (id, x, y) => {
      const all = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? all(e.shadowRoot, s) : [])]);
      let el = document.elementFromPoint(x, y);
      while (el && el.shadowRoot) { const i = el.shadowRoot.elementFromPoint(x, y); if (!i || i === el) break; el = i; }
      const cell = all(document, '.cell[data-id="' + id + '"]')[0];
      for (; el; el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null) if (el === cell) return true;
      return false;
    };
    const clear = async (id, x, y) => {
      if (await p.evaluate(new Function('a', 'return (' + UNDER.toString() + ')(a[0], a[1], a[2]);'), [id, x, y])) return;
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      if (await p.evaluate(new Function('a', 'return (' + UNDER.toString() + ')(a[0], a[1], a[2]);'), [id, x, y])) return;
      await open();
    };
    const cells = await p.evaluate(`(${PLATE_POINTS.toString()})(${input.lattice || 7})`);
    for (const c of cells) {
      const res = [];
      for (const pt of c.pts) {
        if (pt.control) { res.push({ ...pt, went: null }); continue; }
        await clear(c.id, pt.x, pt.y);
        await p.evaluate(() => { window.__taps.length = 0; });
        await p.mouse.click(pt.x, pt.y);
        await p.waitForTimeout(60);
        const went = await p.evaluate(() => window.__taps.slice());
        res.push({ ...pt, went: went.map(w => w.join(':')), ...(input.debug && !went.length ? { path: await p.evaluate(() => window.__path) } : {}) });
      }
      // a block that is all control (Small ones whose plate is the button): its middle, to see what that does
      if (!res.some(r => r.control === null)) {
        const box = await p.evaluate((id) => {
          const all = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? all(e.shadowRoot, s) : [])]);
          const cell = all(document, '.cell[data-id="' + id + '"]')[0], r = cell.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }, c.id);
        await clear(c.id, box.x, box.y);
        await p.evaluate(() => { window.__taps.length = 0; });
        await p.mouse.click(box.x, box.y);
        await p.waitForTimeout(60);
        const went = await p.evaluate(() => window.__taps.slice());
        res.push({ ...box, control: null, centre: true, on: 'centre', went: went.map(w => w.join(':')) });
      }
      // THE PARTS (2026-11-08, `--parts`): each part of the block that stands for something -- On Now's kinds, House
      // Status's sections, Everything's "+N" -- tapped in its middle, and where it went
      const parts = [];
      if (input.parts) {
        const at = await p.evaluate(([id, sel]) => {
          const all = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? all(e.shadowRoot, s) : [])]);
          const cell = all(document, '.cell[data-id="' + id + '"]')[0];
          return cell ? all(cell, sel).map(e => { const r = e.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height),
                     what: e.getAttribute('data-open-kind') || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30) }; }) : [];
        }, [c.id, input.parts]);
        for (const pt of at) {
          await clear(c.id, pt.x, pt.y);
          await p.evaluate(() => { window.__taps.length = 0; });
          await p.mouse.click(pt.x, pt.y);
          await p.waitForTimeout(60);
          parts.push({ ...pt, went: (await p.evaluate(() => window.__taps.slice())).map(w => w.join(':')) });
        }
      }
      console.log('CELL ' + JSON.stringify({ screen: input.screen, size: input.size, id: c.id, tag: c.tag, bsize: c.size, w: c.w, h: c.h, pts: res, parts }));
      if (input.shots && c.id === (input.shotOf || '')) await p.screenshot({ path: input.shots + '/' + input.screen + '-' + c.id + '.png' });
    }
    if (input.shots) await p.screenshot({ path: input.shots + '/' + input.screen + '-' + input.size + '.png' });
    for (const e of errors) console.log('ERROR ' + e);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
