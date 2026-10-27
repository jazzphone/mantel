// Edit mode in the scratch HA (edit_check.py says what it checks). The browser reaches 127.0.0.1:8124 only.
const assert = require('assert/strict');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const S = input.screen, E = input.engine, FINGER = E === 'chromium';

const HELP = () => {
  window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
  window.menuSR = () => { const m = deep(document, '#hk-menu')[0]; return m && m.shadowRoot; };
  window.editBar = () => { const h = deep(document, '#hk-edit')[0]; return h && h.querySelector('.bar'); };
  window.editBtn = t => { const b = editBar(); return b && [...b.querySelectorAll('button')].find(x => x.textContent === t); };
  window.box = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  window.titles = list => list.map(i => i.title).join(',');
  window.gridWith = id => deep(document, 'hk-grid-card').find(g => g._e && [...g._e.children].some(k => k._config && k._config.entity === id) && g.getBoundingClientRect().height > 0);
  window.order = id => { const g = gridWith(id); return g ? [...g._e.children].map(k => k._config && k._config.entity).filter(Boolean) : null; };
  window.tileIn = id => [...gridWith(id)._e.children].find(k => k._config && k._config.entity === id);
  window.menuRows = () => { const sr = menuSR(); return sr ? [...sr.querySelectorAll('.list .row span')].map(x => x.textContent) : []; };
  window.panel = () => hkCards.client().callWS({ type: 'hk_frontend/panel/get' });
};

let browser;
async function open(tokens, path) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: FINGER, deviceScaleFactor: 1 });
  const origin = new URL(input.base).origin;
  await ctx.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  await ctx.addInitScript(t => { try { localStorage.setItem('hassTokens', t); } catch (e) { /* */ } }, JSON.stringify(tokens));
  await ctx.addInitScript(HELP);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push('page error: ' + e.message); });
  // the saves as HA's WebSocket carries them, and their answers (HA may send several in one frame)
  const ws = { out: {}, back: {} };
  page.on('websocket', w => {
    const each = (f, fn) => { try { [].concat(JSON.parse(f.payload)).forEach(fn); } catch (e) { /* not JSON */ } };
    w.on('framesent', f => each(f, m => { if (/^hk_frontend\/(accessory|board|settings)\/(set|order)$/.test(m.type || '')) ws.out[m.id] = m; }));
    w.on('framereceived', f => each(f, m => { if (m.type === 'result' && ws.out[m.id]) ws.back[m.id] = m; }));
  });
  const t = { ctx, page, errors, cdp: null, ws };
  await go(t, path);
  return t;
}
async function go(t, path) {
  await t.page.goto(input.base + path);
  await t.page.waitForFunction(() => window.hkEdit && window.hkEditMenu && window.hkCards && hkCards.client && hkCards.client()
    && hkEdit.surfaces().includes('menu') && deep(document, 'hk-grid-card').length > 0, null, { timeout: 60000 });
  await t.page.evaluate(HELP);
  await t.page.waitForTimeout(1500);
}
async function touch(t, type, x, y) {
  if (!t.cdp) t.cdp = await t.ctx.newCDPSession(t.page);
  await t.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
}
async function carry(t, a, b, steps = 12) {
  const p = t.page;
  if (FINGER) {
    await touch(t, 'touchStart', a.x, a.y); await p.waitForTimeout(320);
    for (let i = 1; i <= steps; i++) { await touch(t, 'touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await p.waitForTimeout(25); }
    await p.waitForTimeout(150); await touch(t, 'touchEnd');
  } else {
    await p.mouse.move(a.x, a.y); await p.mouse.down();
    for (let i = 1; i <= steps; i++) { await p.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await p.waitForTimeout(25); }
    await p.waitForTimeout(150); await p.mouse.up();
  }
  await p.waitForTimeout(450);
}
async function tap(t, fn, arg) {
  await t.page.evaluate(fn, arg);
  await t.page.waitForTimeout(350);
  const at = await t.page.evaluate(fn, arg);
  assert(at, 'nothing to tap: ' + fn);
  if (FINGER) await t.page.touchscreen.tap(at.x, at.y); else await t.page.mouse.click(at.x, at.y);
  await t.page.waitForTimeout(450);
}
const shot = (t, name) => t.page.screenshot({ path: input.shots + '/edit-' + E + '-' + name + '.png' });

(async () => {
  browser = await pw[E].launch({ headless: true, ...(E === 'chromium' ? { executablePath: input.chrome } : {}) });
  try {
    // ---------------------------------------------------------------- an HA admin
    const t = await open(input.owner, '/' + S + '/room-office');
    const p = t.page;
    const before = await p.evaluate(() => panel());
    const L0 = await p.evaluate(() => order('light.office_rgbw_lights'));
    assert(L0 && L0.length >= 2 && L0.includes('light.ceiling_lights'), 'the Office\'s two lights in one group: ' + JSON.stringify(L0));
    assert.equal(await p.evaluate(() => hkEdit.offer(hkCards.client())), true, 'an admin is offered Edit');
    if (!(await p.evaluate(() => hkMenu.isOpen()))) { await p.evaluate(() => hkMenu.open()); await p.waitForTimeout(600); }
    assert((await p.evaluate(() => menuRows())).includes('Edit Page'), 'Edit Page in HK\'s menu: ' + JSON.stringify(await p.evaluate(() => menuRows())));
    await tap(t, () => { const r = [...menuSR().querySelectorAll('.list .row')].find(x => x.textContent === 'Edit Page'); return r && (r.scrollIntoView({ block: 'center' }), box(r)); });
    await p.waitForFunction(() => !!hkEdit.active() && !!editBar(), null, { timeout: 8000 });
    await p.waitForTimeout(500);
    await shot(t, 'entered');
    // the bar under Home Assistant's own header (when it shows), and the page's title under the bar
    const lay = await p.evaluate(() => {
      const tb = hkShell.toolbar(), tr = tb && tb.getBoundingClientRect();
      const title = deep(document, '*').filter(e => !e.closest('#hk-edit') && e.children.length === 0 && e.textContent.trim() === 'Office'
        && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().top > (tr ? tr.bottom : 0)).map(box).sort((a, b) => a.t - b.t)[0];
      return { header: tr && tr.height > 0 ? { t: tr.top, b: tr.bottom } : null, bar: box(editBar()), title };
    });
    if (lay.header) assert(lay.bar.t >= lay.header.b + 4, 'the Edit bar under HA\'s header: ' + JSON.stringify(lay));
    assert(lay.title && lay.title.t >= lay.bar.b, 'the page\'s title under the Edit bar: ' + JSON.stringify(lay));
    // the last light before the first, and the (then) last one Tall (or Regular)
    await p.evaluate(([a, b]) => { const ra = tileIn(a).getBoundingClientRect(), rb = tileIn(b).getBoundingClientRect(); scrollBy(0, (ra.top + rb.bottom) / 2 - innerHeight / 2); }, [L0[L0.length - 1], L0[0]]);
    await p.waitForTimeout(300);
    const [a, b] = await p.evaluate(([a, b]) => [box(tileIn(a)), box(tileIn(b))], [L0[L0.length - 1], L0[0]]);
    await carry(t, a, { x: b.l + b.w * 0.2, y: b.y });
    const L1 = await p.evaluate(() => order('light.office_rgbw_lights'));
    assert.equal(L1[0], L0[L0.length - 1], 'carried: ' + JSON.stringify(L1));
    // (the scratch HA keeps what an earlier run saved: the size goes the other way from what it is now)
    const TALL = L1[L1.length - 1];
    const wasTall = await p.evaluate(id => tileIn(id).shadowRoot.querySelector('.hk-edit-size span:last-child').classList.contains('on'), TALL);
    const SIZE = wasTall ? 'regular' : 'tall';
    await tap(t, ([id, n]) => { const s = tileIn(id).shadowRoot.querySelector('.hk-edit-size span:nth-child(' + n + ')'); return s && box(s); }, [TALL, wasTall ? 1 : 2]);
    // the menu: the last category first; the Room Order sheet: the last room one place up
    const docked = await p.evaluate(() => !!menuSR() && menuSR().querySelectorAll('.row.ed').length > 0);
    if (!docked) { await p.evaluate(() => hkMenu.open()); await p.waitForTimeout(600); }
    const c0 = (await p.evaluate(() => titles(hkEditMenu.model().categories))).split(',');
    const cp = await p.evaluate(tt => [...menuSR().querySelectorAll('.row.ed[data-sec="categories"]')].find(r => r.querySelector('span').textContent === tt).getAttribute('data-p'), c0[c0.length - 1]);
    const g = await p.evaluate(q => { const e = menuSR().querySelector('.row.ed[data-p="' + q + '"] .grip'); e.scrollIntoView({ block: 'center' }); return box(e); }, cp);
    await p.waitForTimeout(300);
    const f = await p.evaluate(() => box(menuSR().querySelector('.row.ed[data-sec="categories"]')));
    await carry(t, await p.evaluate(q => box(menuSR().querySelector('.row.ed[data-p="' + q + '"] .grip')), cp), { x: g.x, y: f.t + 3 });
    const c1 = (await p.evaluate(() => titles(hkEditMenu.model().categories))).split(',');
    assert.equal(c1[0], c0[c0.length - 1], 'a category moved first: ' + c1);
    if (!docked) { await p.evaluate(() => hkMenu.close && hkMenu.close()); await p.waitForTimeout(400); }
    await tap(t, () => box(editBtn('Rooms')));
    await p.waitForFunction(() => deep(document, '#hk-edit-rooms').length === 1);
    await p.waitForTimeout(300);
    const rooms0 = await p.evaluate(() => [...deep(document, '#hk-edit-rooms')[0].shadowRoot.querySelectorAll('.cell.li .lbl')].map(x => x.textContent.trim()));
    const up = rooms0[rooms0.length - 1];
    await tap(t, n => { const b = deep(document, '#hk-edit-rooms')[0].shadowRoot.querySelector('button[aria-label="Move ' + n + ' Up"]'); b.scrollIntoView({ block: 'center' }); return box(b); }, up);
    const rooms1 = await p.evaluate(() => [...deep(document, '#hk-edit-rooms')[0].shadowRoot.querySelectorAll('.cell.li .lbl')].map(x => x.textContent.trim()));
    console.log('  ' + E + ' Room Order', JSON.stringify(rooms0), '->', JSON.stringify(rooms1));
    assert.equal(rooms1[rooms1.length - 2], up, 'Move Up: ' + rooms1);
    await tap(t, () => box(deep(document, '#hk-edit-rooms')[0].shadowRoot.querySelector('.ok')));
    const saves = await p.evaluate(() => hkEdit.active().saves().map(s => [s.doc, s.msg.type]));
    console.log('  ' + E + ' saves', JSON.stringify(saves));
    await shot(t, 'arranged');
    // Done: each with its version
    t.ws.out = {}; t.ws.back = {};
    await tap(t, () => box(editBtn('Done')));
    await p.waitForFunction(() => !hkEdit.active(), null, { timeout: 15000 });
    await p.waitForTimeout(500);
    const sent = Object.values(t.ws.out).map(m => ({ type: m.type, v: m.expect_version, ok: !!(t.ws.back[m.id] || {}).success,
                                                     err: ((t.ws.back[m.id] || {}).error || {}).code }));
    console.log('  ' + E + ' sent', JSON.stringify(sent));
    assert(sent.length >= 3 && sent.every(s => s.ok && s.v != null), 'every save sent with its version and taken: ' + JSON.stringify(sent));
    assert(sent.some(s => s.type === 'hk_frontend/settings/set'), 'All Screens\' room order (settings/set, versions["house"])');
    await p.waitForTimeout(1500);
    const after = await p.evaluate(() => panel());
    const office = ((after.accessories || {}).rooms || {}).office || [];
    assert.deepEqual(office.filter(x => L1.includes(x)), L1, 'panel/get: the Office\'s Tile Order ' + JSON.stringify(office));
    assert.equal(((after.accessories.entities || {})[TALL] || {}).size, SIZE, 'panel/get: ' + TALL + ' ' + SIZE);
    const board = after.boards[S] || {};
    const roomOrder = (after.settings.rooms || {}).order || [];
    console.log('  ' + E + ' panel/get', JSON.stringify({ office, pages: board.pages, rooms: roomOrder, menu: (after.settings.rooms || {}).menu }));
    assert(Array.isArray(board.pages) && board.pages.length > 0, 'panel/get: the screen\'s page order');
    assert.equal((after.settings.rooms || {}).menu, 'order', 'panel/get: the menu\'s rooms in the room order');
    assert.notEqual(after.versions.house, before.versions.house, 'the house settings\' version moved on');
    // drawn again from what was saved
    await p.waitForFunction(w => { const g = gridWith(w[0]); return g && (g._config.cards || []).map(c => c.entity).filter(x => w.includes(x)).join() === w.join() && !deep(document, '.hk-editing').length; }, L1, { timeout: 15000 });
    await go(t, '/' + S + '/room-office');
    assert.deepEqual(await p.evaluate(() => order('light.office_rgbw_lights')), L1, 'after a reload');
    if (!(await p.evaluate(() => hkMenu.isOpen()))) { await p.evaluate(() => hkMenu.open()); await p.waitForTimeout(600); }
    assert.equal(await p.evaluate(() => titles(hkEditMenu.model().rooms)), rooms1.join(','), 'the menu\'s rooms as saved');
    const rows = await p.evaluate(() => menuRows());
    assert(rows.indexOf(c1[0]) >= 0 && rows.indexOf(c1[0]) < rows.indexOf(c1[1]), 'the menu as saved: ' + rows);
    await shot(t, 'saved');
    assert.deepEqual(t.errors, [], 'no page errors');
    await t.ctx.close();
    console.log('PASS ' + E + ' admin: Edit Page in the menu, a pill carried and resized, a category and a room moved, Done -- saved with versions (panel/get), drawn again');
    // ---------------------------------------------------------------- a user who is not an admin
    const m = await open(input.member, '/' + S + '/room-office');
    assert.equal(await m.page.evaluate(() => hkEdit.offer(hkCards.client()) || hkEdit.editAny(hkCards.client())), false, 'no Edit for a plain user');
    if (!(await m.page.evaluate(() => hkMenu.isOpen()))) { await m.page.evaluate(() => hkMenu.open()); await m.page.waitForTimeout(600); }
    const mr = await m.page.evaluate(() => menuRows());
    assert(mr.length > 3 && !mr.includes('Edit Page'), 'no Edit Page in a plain user\'s menu: ' + mr);
    assert.deepEqual(m.errors, [], 'no page errors');
    await m.ctx.close();
    console.log('PASS ' + E + ' plain user: no Edit Page');
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL ' + E + ': ' + (e && e.stack || e)); process.exit(1); });
