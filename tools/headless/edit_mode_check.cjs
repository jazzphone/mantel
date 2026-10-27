// Edit mode in a browser (edit_mode_check.py starts the server and says what each section checks).
// One engine at one size per run: Chromium drives a finger (CDP Input.dispatchTouchEvent), WebKit a mouse.
const assert = require('assert/strict');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const [W, H] = input.size.split('x').map(Number);
const PHONE = W < 768, FINGER = input.engine === 'chromium', S = input.screen;
const TAG = input.engine + ' ' + input.size;
const only = new Set(input.only);

// ------------------------------------------------------------------ in the page
const HELP = () => {
  window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
  window.menuSR = () => { const m = deep(document, '#hk-menu')[0]; return m && m.shadowRoot; };
  window.barSR = () => { const b = deep(document, '#hk-tabbar')[0]; return b && b.shadowRoot; };
  window.editBar = () => { const h = deep(document, '#hk-edit')[0]; return h && h.querySelector('.bar'); };
  window.editBtn = t => { const b = editBar(); return b && [...b.querySelectorAll('button')].find(x => x.textContent === t); };
  window.box = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  window.titles = list => list.map(i => i.title).join(',');
  window.gridWith = id => deep(document, 'hk-grid-card').find(g => g._e && [...g._e.children].some(k => k._config && k._config.entity === id) && g.getBoundingClientRect().height > 0);
  window.order = id => { const g = gridWith(id); return g ? [...g._e.children].map(k => k._config && k._config.entity).filter(Boolean) : null; };
  window.tileIn = id => [...gridWith(id)._e.children].find(k => k._config && k._config.entity === id);
  window.mid = el => { el.scrollIntoView({ block: 'center', inline: 'nearest' }); return box(el); };
  window.sceneRow = () => { const c = deep(document, 'hk-scenes-card').find(x => x.getBoundingClientRect().height > 0); const rc = c && deep(c, 'hk-row-card')[0]; return rc && rc.shadowRoot.querySelector('.row'); };
  window.rowKeys = () => [...sceneRow().children].filter(c => c._config).map(c => c._config.entity || (c._config.tap_action || {}).navigation_path);
  window.acc = () => window.hkSettings.get('accessories', {}) || {};
  window.menuRows = () => { const sr = menuSR(); return sr ? [...sr.querySelectorAll('.list .row span')].map(x => x.textContent) : []; };
  window.moreRows = () => { const sr = barSR(); return sr ? [...sr.querySelectorAll('.sheet .it span')].map(x => x.textContent) : []; };
  window.tabs = () => { const sr = barSR(); return sr ? [...sr.querySelectorAll('.pill .tab')].map(t => t.getAttribute('aria-label')).join(',') : ''; };
};

// what each home supplies from its own files and the fictional house has not (Apple's SF Pro and the glyphs:
// hk-icons.js, setup_check.py): their 404s are the only console errors allowed
const HOMES_OWN = /\/hk\/(fonts\/SF-Pro\.(woff2|ttf)|iconset\/hk-glyphs\.js)$/;
let browser;
async function open(path, cookies, more) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: FINGER, deviceScaleFactor: 1, ...(more || {}) });
  await ctx.addCookies(cookies.map(([name, value]) => ({ name, value, url: input.origin })));
  await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const errors = [];
  // (ResizeObserver's "loop completed with undelivered notifications" is the browser's notice that a layout
  // settled over two frames -- the menu's rows as they are rearranged -- not an error of the page's)
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push('page error: ' + e.message); });
  page.on('console', m => { if (m.type() === 'error' && !HOMES_OWN.test((m.location() && m.location().url) || '')) errors.push('console: ' + m.text() + (m.location() && m.location().url ? ' (' + m.location().url.replace(input.origin, '') + ')' : '')); });
  const t = { ctx, page, errors, cdp: null };
  await go(t, path);
  return t;
}
const OWNER = () => [['mantel_session', input.cookie]];
async function go(t, path) {
  await t.page.goto(input.origin + path);
  await t.page.waitForFunction(() => window.__mantelReady && window.hkEdit && window.hkMenu && window.hkEditMenu && window.hkEditPages
    && window.hkEdit.surfaces().includes('menu') && window.hkEdit.surfaces().includes('scenes-row'), null, { timeout: 20000 });
  await t.page.evaluate(HELP);
  await t.page.waitForTimeout(700);
}
async function close(t) {
  assert.deepEqual(t.errors, [], 'no page or console errors');
  await t.ctx.close();
}
async function touch(t, type, x, y) {
  if (!t.cdp) t.cdp = await t.ctx.newCDPSession(t.page);
  await t.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
}
// a pill carried: a finger held ~300 ms then moved (Chromium), or the mouse pressed and moved (WebKit)
async function carry(t, a, b, steps = 12) {
  const p = t.page;
  if (FINGER) {
    await touch(t, 'touchStart', a.x, a.y);
    await p.waitForTimeout(320);
    for (let i = 1; i <= steps; i++) { await touch(t, 'touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await p.waitForTimeout(25); }
    await p.waitForTimeout(150);
    await touch(t, 'touchEnd');
  } else {
    await p.mouse.move(a.x, a.y); await p.mouse.down();
    for (let i = 1; i <= steps; i++) { await p.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await p.waitForTimeout(25); }
    await p.waitForTimeout(150);
    await p.mouse.up();
  }
  await p.waitForTimeout(450);
}
// a tap (a finger in Chromium) on the box `fn` finds in the page
async function tap(t, fn, arg) {
  // asked twice: what `fn` scrolls into view (a menu's list scrolls smoothly) is measured where it came to rest
  await t.page.evaluate(fn, arg);
  await t.page.waitForTimeout(350);
  const at = await t.page.evaluate(fn, arg);
  assert(at, 'nothing to tap: ' + fn);
  if (FINGER) await t.page.touchscreen.tap(at.x, at.y); else await t.page.mouse.click(at.x, at.y);
  await t.page.waitForTimeout(450);
}
// the pill `from` carried onto the left part of the pill `to` (it goes before it), both scrolled into view first
async function carryBefore(t, from, to) {
  await t.page.evaluate(([a, b]) => {
    const ra = tileIn(a).getBoundingClientRect(), rb = tileIn(b).getBoundingClientRect();
    scrollBy(0, (ra.top + ra.bottom + rb.top + rb.bottom) / 4 - innerHeight / 2);
  }, [from, to]);
  await t.page.waitForTimeout(300);
  const [a, b] = await t.page.evaluate(([a, b]) => [box(tileIn(a)), box(tileIn(b))], [from, to]);
  await carry(t, a, { x: b.l + b.w * 0.2, y: b.y });
}
async function enterFromMenu(t) {
  if (await t.page.evaluate(() => !!window.hkTabBar && !!barSR() && !!barSR().querySelector('.pill .tab[data-t="more"]'))) {
    await tap(t, () => box(barSR().querySelector('.tab[data-t="more"]')));
    await t.page.waitForTimeout(300);
    await tap(t, () => { const e = barSR().querySelector('.sheet.open .it[data-k="e"]'); return e && (e.scrollIntoView({ block: 'center' }), box(e)); });
  } else {
    if (!(await t.page.evaluate(() => hkMenu.isOpen() || hkMenu.docked && hkMenu.docked()))) { await t.page.evaluate(() => hkMenu.open()); await t.page.waitForTimeout(500); }
    await tap(t, () => { const r = [...menuSR().querySelectorAll('.list .row')].find(x => x.textContent === 'Edit Page'); return r && (r.scrollIntoView({ block: 'center' }), box(r)); });
  }
  try { await t.page.waitForFunction(() => !!hkEdit.active() && !!editBar(), null, { timeout: 5000 }); }
  catch (e) {
    throw new Error('Edit Page did not begin Edit mode: ' + JSON.stringify(await t.page.evaluate(() => ({
      path: location.pathname, menu: menuRows(), menuOpen: hkMenu.isOpen(), tabs: tabs(), more: moreRows(),
      sheet: !!(barSR() && barSR().querySelector('.sheet.open')), offer: hkEdit.offer(hkCards.client()) }))));
  }
  await t.page.waitForTimeout(350);
}
async function done(t) {
  await tap(t, () => box(editBtn('Done')));
  await t.page.waitForFunction(() => !hkEdit.active(), null, { timeout: 10000 });
  await t.page.waitForTimeout(900);
}
async function shot(t, name) { if (input.shots) await t.page.screenshot({ path: input.shots + '/' + input.engine + '-' + input.size + '-' + name + '.png' }); }
const pass = (what) => console.log('PASS ' + TAG + ' ' + what);

// ------------------------------------------------------------------ who sees Edit
async function who() {
  const t = await open('/' + S + '/room-living-room', OWNER());
  const p = t.page;
  assert.equal(await p.evaluate(() => hkEdit.offer(hkCards.client())), true, 'an Owner is offered Edit on a room page');
  await enterFromMenu(t);
  assert.equal(await p.evaluate(() => editBar().querySelector('.t').textContent), 'Editing Living Room');
  await tap(t, () => box(editBtn('Cancel')));
  assert.equal(await p.evaluate(() => hkEdit.active()), null, 'Cancel leaves Edit mode');
  await close(t);
  // the tab bar's More
  const m = await open('/em-tabs/room-kitchen', OWNER());
  await enterFromMenu(m);
  assert.equal(await m.page.evaluate(() => editBar().querySelector('.t').textContent), 'Editing Kitchen', 'More\'s Edit Page');
  await m.page.evaluate(() => hkEdit.cancel());
  await close(m);
  // a Home Grid screen's Home: its own editor, no Edit Page; its other pages are offered it
  const g = await open('/em-grid/home', OWNER());
  assert.equal(await g.page.evaluate(() => hkEdit.offer(hkCards.client())), false, 'not on a Home Grid screen\'s Home');
  await g.page.evaluate(() => hkMenu.open()); await g.page.waitForTimeout(400);
  assert(!(await g.page.evaluate(() => menuRows())).includes('Edit Page'), 'no Edit Page row on the Home Grid');
  await go(g, '/em-grid/lights');
  assert.equal(await g.page.evaluate(() => hkEdit.offer(hkCards.client())), true, '...but on its Lights page');
  await close(g);
  // a Member, and the Owner at a wall tablet: never
  for (const [who, cookies] of [['a Member', [['mantel_session', input.member]]],
                                ['the Owner at a wall tablet', [['mantel_device', input.device], ['mantel_session', input.cookie]]]]) {
    for (const path of ['/' + S + '/room-living-room', '/em-tabs/room-kitchen']) {
      const x = await open(path, cookies);
      const me = await x.page.evaluate(() => fetch('/api/me').then(r => r.json()));
      if (who !== 'a Member') assert.equal(me.at_tablet, true, '/api/me says at a tablet');
      assert.equal(await x.page.evaluate(() => hkEdit.offer(hkCards.client()) || hkEdit.editAny(hkCards.client())), false, who + ': no Edit at ' + path);
      if (await x.page.evaluate(() => !!barSR() && !!barSR().querySelector('.tab[data-t="more"]'))) {
        await x.page.evaluate(() => barSR().querySelector('.tab[data-t="more"]').click()); await x.page.waitForTimeout(500);
        assert(!(await x.page.evaluate(() => moreRows())).includes('Edit Page'), who + ': no Edit Page in More');
      } else {
        await x.page.evaluate(() => hkMenu.open && hkMenu.open()); await x.page.waitForTimeout(400);
        assert(!(await x.page.evaluate(() => menuRows())).includes('Edit Page'), who + ': no Edit Page in the menu');
      }
      await close(x);
    }
  }
  pass('who: Edit Page in the menu and in More for an Owner; none for a Member, at a wall tablet, on a Home Grid\'s Home');
}

// ------------------------------------------------------------------ the Edit bar beside a tab bar
async function bar() {
  const cases = [['em-top', 'top'], ['em-tabs', 'bottom']].concat(PHONE ? [] : [['em-rail', 'left']]);
  for (const [screen, pos] of cases) {
    const t = await open('/' + screen + '/room-kitchen', OWNER());
    const p = t.page;
    await p.evaluate(() => hkEdit.enter(hkCards.client()));
    await p.waitForTimeout(600);
    const g = await p.evaluate(() => {
      const pill = barSR().querySelector('.pill'), eb = editBar();
      // the page's own title (the room's name in its header) and its first pills: below the bar
      const title = deep(document, '*').filter(e => !e.closest('#hk-edit') && e.children.length === 0 && e.textContent.trim() === 'Kitchen'
        && e.getBoundingClientRect().height > 0 && !(barSR() && barSR().contains(e))).map(box).sort((a, b) => a.t - b.t)[0];
      const grid = deep(document, 'hk-grid-card').filter(x => x.getBoundingClientRect().height > 0).map(box).sort((a, b) => a.t - b.t)[0];
      return { pos: hkTabBar._.state().pos, pill: box(pill), bar: box(eb), title, grid };
    });
    await shot(t, 'bar-' + pos);
    assert.equal(g.pos, pos === 'left' ? 'left' : pos, JSON.stringify(g));
    const overlap = !(g.bar.b <= g.pill.t || g.pill.b <= g.bar.t || g.bar.r <= g.pill.l || g.pill.r <= g.bar.l);
    assert(!overlap, 'the Edit bar is never over the tab bar (' + pos + '): ' + JSON.stringify(g));
    if (pos === 'top') {
      const above = g.pill.t, between = g.bar.t - g.pill.b;
      assert(Math.abs(between - above) <= 2.5, 'evenly spaced under a top tab bar: ' + JSON.stringify({ above, between }));
    } else {
      assert(g.bar.t <= 16 && g.bar.t >= 8, 'at the top, 10 px down: ' + JSON.stringify(g.bar));
    }
    assert(g.title && g.title.t >= g.bar.b + 4 && g.grid.t >= g.bar.b, 'the page goes down under the bar: ' + JSON.stringify(g));
    await p.evaluate(() => hkEdit.cancel());
    await p.waitForTimeout(300);
    const back = await p.evaluate(() => { const v = hkShell.view(); return v && v.style.getPropertyValue('margin-top'); });
    assert.equal(back, '', 'Cancel: the page back where it was');
    await close(t);
  }
  pass('bar: the Edit bar clear of the tab bar at the top (evenly spaced), the bottom' + (PHONE ? '' : ' and on a rail'));
}

// ------------------------------------------------------------------ a room page
const LR = ['light.living_room_lamps', 'light.living_room_ceiling', 'light.living_room_floor'];
async function room() {
  const t = await open('/' + S + '/room-living-room', OWNER());
  const p = t.page;
  const o0 = await p.evaluate(() => order('light.living_room_lamps'));
  const L0 = o0.filter(x => x.startsWith('light.'));
  assert.deepEqual(L0.slice().sort(), LR.slice().sort(), 'the Living Room\'s lights: ' + JSON.stringify(o0));
  await enterFromMenu(t);
  // A QUICK SWIPE over the pills scrolls the page and picks nothing up (a finger only: a hold is what lifts)
  if (FINGER) {
    const a = await p.evaluate(() => mid(tileIn('light.living_room_ceiling')));
    const y0 = await p.evaluate(() => scrollY);
    await touch(t, 'touchStart', a.x, a.y);
    for (let i = 1; i <= 8; i++) { await touch(t, 'touchMove', a.x, a.y - i * 30); await p.waitForTimeout(16); }
    await touch(t, 'touchEnd');
    await p.waitForTimeout(900);
    const s = await p.evaluate(y0 => ({ dy: scrollY - y0, carried: deep(document, '.hk-carried').length, order: order('light.living_room_lamps'),
                                        tall: document.scrollingElement.scrollHeight > innerHeight }), y0);
    assert(s.carried === 0 && JSON.stringify(s.order) === JSON.stringify(o0), 'a swipe lifts nothing: ' + JSON.stringify(s));
    if (s.tall) assert(s.dy > 40, 'a swipe scrolls the page: ' + JSON.stringify(s));
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
  }
  // the last light carried before the first
  await carryBefore(t, L0[2], L0[0]);
  const o1 = await p.evaluate(() => order('light.living_room_lamps'));
  const want = [L0[2], L0[0], L0[1]];
  assert.deepEqual(o1.filter(x => x.startsWith('light.')), want, 'carried: ' + JSON.stringify(o1));
  // the (now) last one made Tall with its badge
  const TALL = L0[1];
  const h0 = await p.evaluate(id => tileIn(id).getBoundingClientRect().height, TALL);
  await tap(t, id => { const s = tileIn(id).shadowRoot.querySelector('.hk-edit-size span:last-child'); return s && box(s); }, TALL);
  const h1 = await p.evaluate(id => tileIn(id).getBoundingClientRect().height, TALL);
  assert(h1 > h0 * 1.6, 'Tall at once: ' + h0 + ' -> ' + h1);
  await shot(t, 'room-editing');
  await done(t);
  await p.waitForFunction(w => ((acc().rooms || {}).living_room || []).filter(x => x.startsWith('light.')).join() === w.join()
    && (acc().entities[w[2]] || {}).size === 'tall', want, { timeout: 8000 });
  await p.waitForFunction(w => { const o = order('light.living_room_lamps'); return o && o.filter(x => x.startsWith('light.')).join() === w.join()
    && !deep(document, '.hk-editing').length; }, want, { timeout: 8000 });
  // drawn again from the saved order: the grid's own configuration (the strategy's, which Edit mode never touches)
  await p.waitForFunction(w => (gridWith(w[0])._config.cards || []).map(c => c.entity).filter(x => w.includes(x)).join() === w.join(), want, { timeout: 8000 });
  assert.equal(await p.evaluate(id => tileIn(id)._config.size, TALL), 'tall', 'drawn Tall');
  await go(t, '/' + S + '/room-living-room');
  assert.deepEqual((await p.evaluate(() => order('light.living_room_lamps'))).filter(x => x.startsWith('light.')), want, 'the saved order after a reload');
  await shot(t, 'room-saved');
  await close(t);
  pass('room: ' + (FINGER ? 'a quick swipe scrolls and lifts nothing; a held pill ' : 'a pill ') + 'carried, one made Tall, Done: the Tile Order and the size saved, the page drawn again');
}

// ------------------------------------------------------------------ Lights, Security, Favorites, Home's scenes row
async function pages() {
  const t = await open('/' + S + '/lights', OWNER());
  const p = t.page;
  await p.waitForFunction(() => !!gridWith('light.kitchen_pendants'));
  const k0 = await p.evaluate(() => order('light.kitchen_pendants'));
  assert(k0.length >= 2, JSON.stringify(k0));
  await enterFromMenu(t);
  assert.equal(await p.evaluate(() => editBar().querySelector('.n').textContent), 'Lights keep this order on their room pages too.');
  const last = k0[k0.length - 1];
  await carryBefore(t, last, k0[0]);
  const k1 = await p.evaluate(() => order('light.kitchen_pendants'));
  assert.equal(k1[0], last, 'Lights: carried ' + JSON.stringify(k1));
  await done(t);
  await p.waitForFunction(id => ((acc().rooms || {}).kitchen || [])[0] === id, last, { timeout: 8000 });
  // Security
  await go(t, '/' + S + '/security');
  await p.waitForFunction(() => !!gridWith('lock.front_door'));
  const s0 = await p.evaluate(() => order('lock.front_door'));
  assert(s0.length >= 2, JSON.stringify(s0));
  await enterFromMenu(t);
  const sl = s0[s0.length - 1];
  await carryBefore(t, sl, s0[0]);
  const s1 = await p.evaluate(() => order('lock.front_door'));
  assert.equal(s1[0], sl, 'Security: carried ' + JSON.stringify(s1));
  await done(t);
  await p.waitForFunction(w => JSON.stringify((acc().pages || {}).security) === JSON.stringify(w), s1, { timeout: 8000 });
  // Home: Favorites and the scenes row, in one session
  await go(t, '/' + S + '/home');
  await p.waitForFunction(() => !!gridWith('cover.garage_door') && !!sceneRow());
  const f0 = await p.evaluate(() => order('cover.garage_door'));
  const r0 = await p.evaluate(() => rowKeys());
  await enterFromMenu(t);
  assert.equal(await p.evaluate(() => deep(gridWith('cover.garage_door'), '.hk-edit-size').length), 0, 'no size badge on Favorites');
  await carryBefore(t, 'cover.garage_door', f0[0]);
  const f1 = await p.evaluate(() => order('cover.garage_door'));
  assert.equal(f1[0], 'cover.garage_door', 'Favorites: carried ' + JSON.stringify(f1));
  const lastScene = r0.filter(k => /^scene\./.test(k)).pop();
  const pa = await p.evaluate(id => { const c = [...sceneRow().children].find(c => c._config && c._config.entity === id); c.scrollIntoView({ block: 'center', inline: 'nearest' }); return box(c); }, lastScene);
  const pb = await p.evaluate(() => { const b = box(sceneRow().children[0]); return { x: b.l + 6, y: b.y }; });
  await carry(t, pa, pb, 16);
  const r1 = await p.evaluate(() => rowKeys());
  assert.equal(r1[0], lastScene, 'the scenes row: carried ' + JSON.stringify(r1));
  await shot(t, 'home-editing');
  await done(t);
  await p.waitForFunction(w => JSON.stringify(hkCards.menu.board().favorites) === JSON.stringify(w), f1, { timeout: 8000 });
  await p.waitForFunction(id => (hkCards.menu.board().scenes || [])[0] === id, lastScene, { timeout: 8000 });
  await p.waitForFunction(id => sceneRow() && rowKeys()[0] === id && !sceneRow().classList.contains('hk-editing'), lastScene, { timeout: 8000 });
  await close(t);
  pass('pages: one move each on Lights (the room\'s order), Security, Home\'s Favorites and its scenes row, saved and drawn');
}

// ------------------------------------------------------------------ the side menu, the tab bar and More
async function menu() {
  // THE SIDE MENU (docked on a tablet, opened on a phone)
  const t = await open('/em-menu/room-living-room', OWNER());
  let p = t.page;
  await enterFromMenu(t);
  if (PHONE) { await p.evaluate(() => hkMenu.open()); await p.waitForTimeout(500); }
  assert(await p.evaluate(() => menuSR().querySelectorAll('.row.ed .grip').length > 5), 'the menu\'s rows have handles');
  const c0 = (await p.evaluate(() => titles(hkEditMenu.model().categories))).split(',');
  // the last category carried to the first place: by its handle (a finger held on a phone)
  const path = await p.evaluate(tt => [...menuSR().querySelectorAll('.row.ed[data-sec="categories"]')].find(r => r.querySelector('span').textContent === tt).getAttribute('data-p'), c0[c0.length - 1]);
  const g = await p.evaluate(q => { const e = menuSR().querySelector('.row.ed[data-p="' + q + '"] .grip'); e.scrollIntoView({ block: 'center' }); return box(e); }, path);
  const f = await p.evaluate(() => box(menuSR().querySelector('.row.ed[data-sec="categories"]')));
  await carry(t, g, { x: g.x, y: f.t + 3 });
  const c1 = (await p.evaluate(() => titles(hkEditMenu.model().categories))).split(',');
  assert.equal(c1[0], c0[c0.length - 1], 'a category moved first: ' + c1);
  // one hidden with its switch
  const hide = c1[c1.length - 1];
  const hp = await p.evaluate(tt => [...menuSR().querySelectorAll('.row.ed[data-sec="categories"]')].find(r => r.querySelector('span').textContent === tt).getAttribute('data-p'), hide);
  await tap(t, q => { const e = menuSR().querySelector('.row.ed[data-p="' + q + '"] .sw'); e.scrollIntoView({ block: 'center' }); return box(e); }, hp);
  const c2 = await p.evaluate(() => titles(hkEditMenu.model().categories));
  assert(!c2.split(',').includes(hide), hide + ' hidden: ' + c2);
  if (PHONE) { await p.evaluate(() => hkMenu.close && hkMenu.close()); await p.waitForTimeout(400); }
  // the Room Order sheet: the Kitchen one place up
  await tap(t, () => box(editBtn('Rooms')));
  await p.waitForFunction(() => deep(document, '#hk-edit-rooms').length === 1);
  await p.waitForTimeout(300);
  const sheetRooms = () => p.evaluate(() => [...deep(document, '#hk-edit-rooms')[0].shadowRoot.querySelectorAll('.cell.li .lbl')].map(x => x.textContent.trim()));
  const sr0 = await sheetRooms();
  const ki = sr0.indexOf('Kitchen');
  assert(ki > 0, JSON.stringify(sr0));
  await shot(t, 'room-order');
  await tap(t, () => { const b = deep(document, '#hk-edit-rooms')[0].shadowRoot.querySelector('button[aria-label="Move Kitchen Up"]'); b.scrollIntoView({ block: 'center' }); return box(b); });
  const sr1 = await sheetRooms();
  assert.equal(sr1[ki - 1], 'Kitchen', 'Move Up: ' + sr1);
  await tap(t, () => box(deep(document, '#hk-edit-rooms')[0].shadowRoot.querySelector('.ok')));
  await p.waitForFunction(() => deep(document, '#hk-edit-rooms').length === 0);
  const expect = { cats: await p.evaluate(() => titles(hkEditMenu.model().categories)), rooms: await p.evaluate(() => titles(hkEditMenu.model().rooms)) };
  assert.equal(expect.rooms, sr1.join(','), 'the menu\'s rooms at once');
  await done(t);
  await go(t, '/em-menu/home');
  if (PHONE) { await p.evaluate(() => hkMenu.open()); await p.waitForTimeout(500); }
  const after = { cats: await p.evaluate(() => titles(hkEditMenu.model().categories)), rooms: await p.evaluate(() => titles(hkEditMenu.model().rooms)), rows: await p.evaluate(() => menuRows()) };
  assert.deepEqual({ cats: after.cats, rooms: after.rooms }, expect, 'after Done and a reload');
  assert(after.rows.join(',').includes(expect.cats) && after.rows.join(',').includes(expect.rooms) && !after.rows.includes(hide), 'the menu drawn so: ' + after.rows);
  await shot(t, 'menu-saved');
  await close(t);
  // THE TAB BAR AND MORE
  const u = await open('/em-tabs/room-kitchen', OWNER());
  p = u.page;
  await enterFromMenu(u);
  const t0 = (await p.evaluate(() => tabs())).split(',');
  const tabBox = l => p.evaluate(l => box([...barSR().querySelectorAll('.pill .tab')].find(t => t.getAttribute('aria-label') === l)), l);
  const sent = t0[2];
  await carry(u, await tabBox(sent), await tabBox('More'));
  const t1 = (await p.evaluate(() => tabs())).split(','), m1 = await p.evaluate(() => titles(hkTabBar._.state().more));
  assert(!t1.includes(sent) && m1.split(',').includes(sent), 'a tab dropped on More: ' + t1 + ' | ' + m1);
  await shot(u, 'tabs-editing');
  await done(u);
  await go(u, '/em-tabs/home');
  const t2 = await p.evaluate(() => tabs()), m2 = await p.evaluate(() => titles(hkTabBar._.state().more));
  const cats = await p.evaluate(() => titles(hkEditMenu.model().categories));
  assert.equal(t2, t1.join(','), 'the tab bar after Done and a reload');
  assert.equal(m2, m1, 'More after Done and a reload');
  // one list behind all three: the bar's tabs are the menu's first Categories; More holds its Top pages and
  // the Categories past the bar (a tab dropped on More goes to one or the other)
  const top = await p.evaluate(() => titles(hkEditMenu.model().top));
  const shown = t1.slice(1, -1), cl = cats.split(',');
  assert.equal(cl.slice(0, shown.length).join(','), shown.join(','), 'the bar is the menu\'s first Categories: ' + cats);
  assert.equal(m2, [top].concat(cl.slice(shown.length)).filter(Boolean).join(','), 'More is the menu\'s Top and the rest: ' + JSON.stringify({ top, cats, m2 }));
  assert(m2.split(',').includes(sent) && !t2.split(',').includes(sent), sent + ' stays in More: ' + m2);
  await close(u);
  pass('menu: a category moved, one hidden, the Room Order sheet\'s Move Up; a tab dropped on More -- the menu, the tab bar and More agree after Done and a reload');
}

// ------------------------------------------------------------------ Cancel
async function cancelled() {
  const t = await open('/' + S + '/room-kitchen', OWNER());
  const p = t.page;
  const o0 = await p.evaluate(() => order('light.kitchen_pendants'));
  const a0 = await p.evaluate(() => JSON.stringify(acc()));
  await enterFromMenu(t);
  await carryBefore(t, o0[o0.length - 1], o0[0]);
  await tap(t, id => { const s = tileIn(id).shadowRoot.querySelector('.hk-edit-size span:last-child'); return s && box(s); }, o0[0]);
  assert.notDeepEqual(await p.evaluate(() => order('light.kitchen_pendants')), o0, 'moved');
  await tap(t, () => box(editBtn('Cancel')));
  assert.equal(await p.evaluate(() => hkEdit.active()), null);
  assert.deepEqual(await p.evaluate(() => order('light.kitchen_pendants')), o0, 'Cancel: the order as it was');
  assert.equal(await p.evaluate(id => tileIn(id).getBoundingClientRect().height < 120 && !deep(document, '.hk-edit-size').length, o0[0]), true, 'Cancel: Regular again, no badges');
  await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => JSON.stringify(acc())), a0, 'nothing saved');
  await close(t);
  pass('cancel: a move and a size put back, nothing saved');
}

// ------------------------------------------------------------------ someone else's change meanwhile
async function conflict() {
  const t = await open('/' + S + '/room-kitchen', OWNER());
  const p = t.page;
  const other = await t.ctx.newPage();                // another window of the same Owner
  await other.goto(input.origin + '/' + S + '/home');
  await other.waitForFunction(() => window.__mantelReady && window.hkCards && hkCards.client());
  const o0 = await p.evaluate(() => order('light.kitchen_pendants'));
  await enterFromMenu(t);
  await carryBefore(t, o0[o0.length - 1], o0[0]);
  const want = await p.evaluate(() => order('light.kitchen_pendants'));
  await p.waitForTimeout(400);                       // (the versions read as Edit began)
  await other.evaluate(() => hkCards.client().actions.callWS({ type: 'hk_frontend/accessory/set', entity_id: 'light.porch', name: 'Porch Lantern' }));
  await tap(t, () => box(editBtn('Done')));
  await p.waitForFunction(() => deep(document, '#hk-confirm[data-open]').length === 1, null, { timeout: 8000 });
  const ask = await p.evaluate(() => { const c = deep(document, '#hk-confirm')[0]; return [c.querySelector('.txt').textContent, c.querySelector('[data-no]').textContent, c.querySelector('[data-yes]').textContent]; });
  assert.deepEqual(ask, ['This page changed since you started editing', 'Reload', 'Save Anyway']);
  assert(await p.evaluate(() => !!hkEdit.active()), 'still editing while it asks');
  await shot(t, 'conflict');
  await tap(t, () => box(deep(document, '#hk-confirm [data-yes]')[0]));
  await p.waitForFunction(() => !hkEdit.active(), null, { timeout: 8000 });
  await p.waitForFunction(w => JSON.stringify(((acc().rooms || {}).kitchen || []).filter(x => w.includes(x))) === JSON.stringify(w)
    && (acc().entities['light.porch'] || {}).name === 'Porch Lantern', want, { timeout: 8000 });
  // the screen changed meanwhile (Favorites, from the other window): Reload shows theirs
  await go(t, '/' + S + '/home');
  await p.waitForFunction(() => !!gridWith('cover.garage_door'));
  const f0 = await p.evaluate(() => order('cover.garage_door'));
  await enterFromMenu(t);
  await carryBefore(t, f0[f0.length - 1], f0[0]);
  await p.waitForTimeout(400);
  const theirs = f0.slice().reverse();
  await other.evaluate(([dash, favs]) => hkCards.client().actions.callWS({ type: 'hk_frontend/board/set', dashboard: dash, changes: { favorites: favs } }), [S, theirs]);
  await tap(t, () => box(editBtn('Done')));
  await p.waitForFunction(() => deep(document, '#hk-confirm[data-open]').length === 1, null, { timeout: 8000 });
  await tap(t, () => box(deep(document, '#hk-confirm [data-no]')[0]));
  await p.waitForFunction(() => !hkEdit.active(), null, { timeout: 8000 });
  await p.waitForFunction(w => JSON.stringify(order('cover.garage_door')) === JSON.stringify(w), theirs, { timeout: 8000 });
  await other.close();
  await close(t);
  pass('conflict: the accessories changed meanwhile -- Save Anyway saves; the screen changed meanwhile -- Reload shows theirs');
}

// ------------------------------------------------------------------ Reduce Motion: the frames
// no wiggle; each pill framed evenly on every side, round what it paints (a room's pill runs 8px past its
// element: an outline of the element missed its right edge), a Tall one too
async function still() {
  const t = await open('/' + S + '/home', OWNER(), { reducedMotion: 'reduce' });
  const p = t.page;
  await enterFromMenu(t);
  const bad = await p.evaluate(() => deep(document, '[data-hk-edit]').filter(e => e.getBoundingClientRect().height > 0).map(e => {
    const f = e.shadowRoot && e.shadowRoot.querySelector('.hk-edit-frame');
    if (!f) return (e._config && e._config.entity) + ': no frame';
    if (getComputedStyle(e).animationName !== 'none') return e._config.entity + ': still wiggles';
    const fr = f.getBoundingClientRect(), skip = new Set([f, ...e.shadowRoot.querySelectorAll('.hk-edit-size, style')]);
    const ks = [...e.shadowRoot.children].filter(k => !skip.has(k)).map(k => k.getBoundingClientRect()).filter(r => r.width && r.height);
    const gaps = [Math.min(...ks.map(r => r.left)) - fr.left, Math.min(...ks.map(r => r.top)) - fr.top,
                  fr.right - Math.max(...ks.map(r => r.right)), fr.bottom - Math.max(...ks.map(r => r.bottom))];
    return gaps.every(g => Math.abs(g - 5) <= 1) ? null : (e._config && e._config.entity) + ': gaps ' + gaps.map(Math.round).join(',');
  }).filter(Boolean));
  assert.deepEqual(bad, [], 'every pill framed 5px outside what it paints');
  const n = await p.evaluate(() => deep(document, '.hk-edit-frame').length);
  assert(n > 5, 'frames drawn: ' + n);
  await p.evaluate(() => hkEdit.cancel());
  assert.equal(await p.evaluate(() => deep(document, '.hk-edit-frame').length), 0, 'Cancel takes the frames away');
  await close(t);
  pass('still: with Reduce Motion no wiggle, and ' + n + ' pills framed evenly round what they paint');
}
// FROSTED (look.glass = blur): the frost is one shared layer cut to the pills' shapes (hk-glass.js). A carried pill
// moves by transform, and on an iPad a cut-out re-cut every frame still trailed it; so while carried it leaves the
// layer and its plate blurs behind itself (hkGlass.carry), and after the drop it is back in the layer
async function frost() {
  const t = await open('/em-frost/room-living-room', OWNER());
  const p = t.page;
  await p.waitForFunction(() => hkGlass.stats().active && hkGlass.stats().rects > 3, null, { timeout: 10000 });
  await enterFromMenu(t);
  await p.evaluate(() => {
    // the frost's cut-outs on screen, from each layer's path (rrect: M x+r,y H x+w-r A r,r 0 0 1 x+w,y+r V ... )
    window.cutouts = () => deep(document, '[data-hk-glass-layer]').flatMap(L => {
      const b = L.getBoundingClientRect(), d = L.getAttribute('data-path') || '';
      return (d.match(/M[^Z]*Z/g) || []).map(sp => {
        const n = sp.match(/-?[\d.]+/g).map(Number);
        return { l: b.left + n[0] - n[3], t: b.top + n[1], r: b.left + n[8], b: b.top + n[17] };
      });
    });
    window.plateOf = el => [...el.shadowRoot.querySelectorAll('*')].find(x => getComputedStyle(x).getPropertyValue('--hk-glass-surface').trim() === '1');
    window.ownBlur = el => { const s = getComputedStyle(plateOf(el)); return (s.backdropFilter || s.webkitBackdropFilter || 'none') !== 'none'; };
    window.offBy = el => {
      const r = plateOf(el).getBoundingClientRect();
      return Math.min(...cutouts().map(c => Math.max(Math.abs(c.l - r.left), Math.abs(c.t - r.top), Math.abs(c.r - r.right), Math.abs(c.b - r.bottom))));
    };
  });
  // an OFF light: an on pill's plate is opaque white, with no blur of its own to show
  const id = await p.evaluate(() => order('light.living_room_lamps').find(x => x.startsWith('light.') && (tileIn(x).hass.states[x] || {}).state === 'off'));
  assert(id, 'an off light in the Living Room');
  const a = await p.evaluate(id => mid(tileIn(id)), id);
  assert(await p.evaluate(id => offBy(tileIn(id)), id) < 1.5, 'the frost under the pill before it is carried');
  assert(!(await p.evaluate(id => ownBlur(tileIn(id)), id)), 'no blur of its own before it is carried');
  const b = { x: a.x + 60, y: a.y + 90 }, steps = 8;
  if (FINGER) { await touch(t, 'touchStart', a.x, a.y); await p.waitForTimeout(320); }
  else { await p.mouse.move(a.x, a.y); await p.mouse.down(); }
  const off = [];
  for (let i = 1; i <= steps; i++) {
    const x = a.x + (b.x - a.x) * i / steps, y = a.y + (b.y - a.y) * i / steps;
    if (FINGER) await touch(t, 'touchMove', x, y); else await p.mouse.move(x, y);
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    off.push(await p.evaluate(id => ({ own: ownBlur(tileIn(id)), cut: offBy(tileIn(id)) }), id));
    if (i === steps - 2) await shot(t, 'frost-carried');
  }
  assert.equal(await p.evaluate(() => deep(document, '.hk-carried').length), 1, 'a pill carried');
  if (FINGER) await touch(t, 'touchEnd'); else await p.mouse.up();
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => deep(document, '[data-hk-edit]').filter(e => e.getBoundingClientRect().height > 0 && plateOf(e))
    .map(e => ({ own: ownBlur(e), cut: offBy(e) })));
  // (no cut-out within 1.5 px of where the carried pill is: the layer has none left behind for it either)
  assert(off.every(o => o.own && o.cut > 1.5), 'the carried pill blurs behind itself, out of the shared layer: ' + JSON.stringify(off));
  assert(after.every(o => !o.own && o.cut < 1.5), 'after the drop every pill is on its cut-out again: ' + JSON.stringify(after));
  await p.evaluate(() => hkEdit.cancel());
  await close(t);
  pass('frost: on a Frosted screen a carried pill blurs behind itself (' + steps + ' moves) and every pill is on the shared frost after the drop');
}

(async () => {
  browser = await pw[input.engine].launch({ headless: true, ...(input.engine === 'chromium' ? { executablePath: input.chrome } : {}) });
  try {
    for (const [name, fn] of [['who', who], ['bar', bar], ['room', room], ['pages', pages], ['menu', menu], ['cancel', cancelled], ['conflict', conflict], ['still', still], ['frost', frost]]) {
      if (only.has(name)) await fn();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL ' + TAG + ': ' + (e && e.stack || e)); process.exit(1); });
