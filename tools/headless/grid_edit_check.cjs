// grid_edit_check.py's browser half: WebKit at one size per run, the mouse and a finger (pointer events with
// pointerType touch at the element under the point, as page_swipe_check.cjs drives WebKit's finger).
const assert = require('assert/strict');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const [W, H] = input.size.split('x').map(Number);
const TAG = 'webkit ' + input.size;
// what each home supplies itself (the licensed font and glyphs): asked for, never served here
const HOMES_OWN = /\/hk\/(fonts\/SF-Pro\.(woff2|ttf)|iconset\/hk-glyphs\.js)$/;

// ------------------------------------------------------------------ in the page
const HELP = () => {
  const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
  const deepAt = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
    return el;
  };
  const box = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const view = () => hkShell.view(hkShell.viewSlot(hkCards.menu.panel()));
  const cell = id => [...view()._root.children].find(c => c.getAttribute('data-id') === id);
  window.__ge = {
    deep, deepAt, box, view, cell,
    part: () => window.hkEditGrid && hkEditGrid.active(),
    grid: () => { const p = hkEditGrid.active(); return p ? JSON.parse(JSON.stringify(p.grid)) : null; },
    at: id => { const p = hkEditGrid.active(), it = p && p.grid.items.find(x => x.id === id); return it ? it.at.join(',') + ' ' + it.size : null; },
    shown: () => (view()._config.cards || []).filter(c => c.hk_cell).map(c => c.hk_cell.id + '@' + c.hk_cell.at.join(',') + ' ' + c.hk_cell.size).sort(),
    centre: id => box(cell(id)),
    // the middle of the cell at column c, row r (the view's own cellBox)
    cellAt: (c, r) => {
      const b = view().cellBox(), cw = (b.width - (b.cols - 1) * b.gap) / b.cols, ch = (b.height - (b.rows - 1) * b.gap) / b.rows;
      return { x: b.left + c * (cw + b.gap) + cw / 2, y: b.top + r * (ch + b.gap) + ch / 2 };
    },
    // the middle of the cells [c, r] to [c + w, r + h]: where a card w x h cells large is held to land on them
    blockAt: (c, r, w, h) => {
      const b = view().cellBox(), cw = (b.width - (b.cols - 1) * b.gap) / b.cols, ch = (b.height - (b.rows - 1) * b.gap) / b.rows;
      return { x: b.left + c * (cw + b.gap) + (w * cw + (w - 1) * b.gap) / 2, y: b.top + r * (ch + b.gap) + (h * ch + (h - 1) * b.gap) / 2 };
    },
    // a card being placed: where its outline is, whether it is the replacing kind, the blocks marked to go
    placing: () => {
      const pl = hkEditGrid.active() && hkEditGrid.active().placing;
      return pl ? { at: pl.at, shown: pl.target.style.display !== 'none', replace: pl.target.classList.contains('replace'),
                    going: [...view()._root.children].filter(c => c.classList.contains('hk-ge-going')).map(c => c.getAttribute('data-id')).sort() } : null;
    },
    btn: (id, cls) => { const b = cell(id) && cell(id).querySelector('.hk-ge .' + cls); return b ? box(b) : null; },
    covers: () => [...view()._root.children].filter(c => c.getAttribute('data-id')).map(c => {
      const cv = c.querySelector('.hk-ge');
      return { id: c.getAttribute('data-id'), cover: !!cv, x: !!(cv && cv.querySelector('.x')), sz: !!(cv && cv.querySelector('.sz')) };
    }),
    barBtn: t => { const h = deep(document, '#hk-edit')[0], b = h && [...h.querySelectorAll('.bar button')].find(x => x.textContent === t); return b ? box(b) : null; },
    barMsg: () => { const h = deep(document, '#hk-edit')[0], m = h && h.querySelector('.bar .m'); return m ? m.textContent : ''; },
    bar: () => { const h = deep(document, '#hk-edit')[0], b = h && h.querySelector('.bar'); return b ? box(b) : null; },
    sheet: () => { const h = document.getElementById('hk-edit-grid-sheet') || deep(document, '#hk-edit-grid-sheet')[0]; return h && h.shadowRoot; },
    sheetRow: sel => { const sr = __ge.sheet(), e = sr && sr.querySelector(sel); return e && !e.disabled ? (e.scrollIntoView({ block: 'center' }), box(e)) : null; },
    // the screen as saved (the feed's), for the board `b`
    saved: b => { const x = (hkSettings.get('boards', {}) || {})[b]; return x && x.home_grid ? x.home_grid.items.map(i => i.id + '@' + i.at.join(',') + ' ' + i.size).sort() : null; },
    target: () => !!view()._root.querySelector('.hk-ge-target'),
    rootBox: () => box(view()._root),
  };
  // WebKit's finger: pointer events, pointerType touch, on what is under the point (each touch the target's own
  // until it ends, as a browser sends them)
  window.__finger = {
    t: null,
    ev(type, x, y) {
      return new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true,
                                      clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 });
    },
    down(x, y) { this.t = deepAt(x, y); this.t.dispatchEvent(this.ev('pointerdown', x, y)); },
    move(x, y) { if (this.t) this.t.dispatchEvent(this.ev('pointermove', x, y)); },
    up(x, y) { if (!this.t) return; const t = this.t; this.t = null; t.dispatchEvent(this.ev('pointerup', x, y)); },
    // a tap: down and up where it is, then the click a browser sends after a finger that did not travel
    tap(x, y) {
      const t = deepAt(x, y);
      t.dispatchEvent(this.ev('pointerdown', x, y)); t.dispatchEvent(this.ev('pointerup', x, y));
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y }));
    },
  };
};

let browser;
async function open(path, finger) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: finger });
  await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
  await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push('page error: ' + e.message); });
  page.on('console', m => {
    const url = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && !HOMES_OWN.test(url) && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text() + ' ' + url);
  });
  const t = { ctx, page, errors, finger };
  await go(t, path);
  return t;
}
async function go(t, path) {
  await t.page.goto(input.origin + path);
  await t.page.waitForFunction(() => window.__mantelReady === true && window.hkEdit && window.hkEditGrid && window.hkTabBar &&
    hkEdit.surfaces().includes('home-grid') && window.hkShell.view(window.hkShell.viewSlot(window.hkCards.menu.panel())), null, { timeout: 30000 });
  await require('./grid_ready.cjs')(t.page);
  await t.page.evaluate(HELP);
  // the grid editor's rules come while the page is up (offered Edit): Edit begins at once
  await t.page.waitForFunction(() => !!window.hkGridEditor, null, { timeout: 20000 });
  await t.page.waitForTimeout(2000);
}
async function close(t, what) {
  assert.deepEqual(t.errors, [], what + ': no page or console errors');
  await t.ctx.close();
}
const ge = (t, fn, ...a) => t.page.evaluate(([f, a]) => window.__ge[f](...a), [fn, a]);
async function tapAt(t, p) {
  assert(p, 'nothing to tap');
  if (t.finger) await t.page.evaluate(([x, y]) => __finger.tap(x, y), [p.x, p.y]);
  else await t.page.mouse.click(p.x, p.y);
  await t.page.waitForTimeout(450);
}
// a block carried from a to b: a finger held ~300 ms then moved, or the mouse pressed and moved; o.mid(t) looks
// part-way, o.escape presses Escape before letting go
async function carry(t, a, b, o = {}) {
  const p = t.page, steps = 14;
  if (t.finger) { await p.evaluate(([x, y]) => __finger.down(x, y), [a.x, a.y]); await p.waitForTimeout(320); }
  else { await p.mouse.move(a.x, a.y); await p.mouse.down(); }
  for (let i = 1; i <= steps; i++) {
    const x = a.x + (b.x - a.x) * i / steps, y = a.y + (b.y - a.y) * i / steps;
    if (t.finger) await p.evaluate(([x, y]) => __finger.move(x, y), [x, y]); else await p.mouse.move(x, y);
    await p.waitForTimeout(25);
    if (o.mid && i === steps - 3) await o.mid(t);
  }
  await p.waitForTimeout(200);
  if (o.escape) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
  if (t.finger) await p.evaluate(([x, y]) => __finger.up(x, y), [b.x, b.y]); else await p.mouse.up();
  await p.waitForTimeout(600);
}
async function shot(t, name) {
  if (input.shots) await t.page.screenshot({ path: input.shots + '/' + 'webkit-' + input.size + '-' + (t.finger ? 'finger' : 'mouse') + '-' + name + '.png' });
}
async function enterFromMore(t) {
  await tapAt(t, await t.page.evaluate(() => { const sr = document.getElementById('hk-tabbar').shadowRoot, m = sr.querySelector('.tab[data-t="more"]'); return m && __ge.box(m); }));
  await t.page.waitForTimeout(300);
  await tapAt(t, await t.page.evaluate(() => { const sr = document.getElementById('hk-tabbar').shadowRoot, e = sr.querySelector('.sheet.open .it[data-k="e"]'); return e && (e.scrollIntoView({ block: 'center' }), __ge.box(e)); }));
  await ready(t);
}
async function ready(t) {
  await t.page.waitForFunction(() => !!hkEdit.active() && !!hkEditGrid.active() && hkEditGrid.active().ready, null, { timeout: 8000 })
    .catch(async () => {
      throw new Error('Edit mode did not begin on the grid: ' + JSON.stringify(await t.page.evaluate(() => {
        const sr = document.getElementById('hk-tabbar') && document.getElementById('hk-tabbar').shadowRoot;
        return { path: location.pathname, active: !!hkEdit.active(), part: !!hkEditGrid.active(), offer: hkEdit.offer(hkCards.client()),
                 more: sr ? [...sr.querySelectorAll('.sheet .it')].map(i => i.dataset.k + ':' + i.textContent.trim()) : null,
                 open: !!(sr && sr.querySelector('.sheet.open')), view: __ge.view().localName, cv: hkEdit.currentView() && hkEdit.currentView().view.type };
      })) + ' ' + JSON.stringify(t.errors));
    });
  await t.page.waitForTimeout(700);
}
const pass = (what) => console.log('PASS ' + TAG + ' ' + what);

// ------------------------------------------------------------------ the 6 x 4 grid, every change, Done
async function tiles(inp) {
  const board = 'ge-tiles-' + inp, t = await open('/' + board + '/home', inp === 'finger'), p = t.page, how = inp;
  assert.equal(await p.evaluate(() => hkEdit.offer(hkCards.client())), true, 'an Owner is offered Edit on a Home Grid\'s Home');
  const before = await ge(t, 'shown');
  await enterFromMore(t);
  assert.equal(await p.evaluate(() => __ge.deep(document, '#hk-edit')[0].querySelector('.t').textContent), 'Editing Home');
  const covers = await ge(t, 'covers');
  assert.equal(covers.length, 7, 'every block drawn');
  assert(covers.every(c => c.cover && c.x), 'every block has its cover and its minus: ' + JSON.stringify(covers));
  assert.deepEqual(covers.filter(c => c.sz).map(c => c.id).sort(), ['cam', 'clock', 'lock', 'np', 'thermo', 'timers', 'weather'], 'a size where the card has more than one (an Accessory has Small, Wide and Tall since 2026-11-07)');
  const bar = await ge(t, 'bar'), rb = await ge(t, 'rootBox');
  assert(bar.b <= rb.t + 2, 'the grid fits under the Edit bar: ' + JSON.stringify([bar, rb]));
  const tb = await p.evaluate(() => { const sr = document.getElementById('hk-tabbar').shadowRoot, pill = sr && sr.querySelector('.pill'); return pill ? __ge.box(pill) : null; });
  if (tb && tb.t > H / 2) assert(rb.b <= tb.t + 2, '...and above the tab bar: ' + JSON.stringify([rb, tb]));
  await shot(t, 'tiles-edit');

  // carried to an empty cell; its outline shows where while it is held
  let saw = false;
  await carry(t, await ge(t, 'centre', 'timers'), await ge(t, 'cellAt', 4, 3), { mid: async () => { saw = await ge(t, 'target'); await shot(t, 'tiles-carry'); } });
  assert(saw, 'the outline shows where it would go');
  assert.equal(await ge(t, 'at', 'timers'), '4,3 S', 'Timers carried to an empty cell (' + how + ')');
  assert.equal(await ge(t, 'target'), false, 'the outline goes with the drop');
  // carried onto another, which makes room
  await carry(t, await ge(t, 'centre', 'lock'), await ge(t, 'cellAt', 0, 0));
  assert.equal(await ge(t, 'at', 'lock'), '0,0 S', 'Lock Up carried onto the clock');
  assert.notEqual((await ge(t, 'at', 'clock')).split(' ')[0], '0,0', '...which made room');
  assert.equal(await p.evaluate(() => hkGridEditor.valid(hkEditGrid.active().grid)), true, '...the layout valid');
  // a size from the badge's sheet
  await tapAt(t, await ge(t, 'btn', 'clock', 'sz'));
  await p.waitForFunction(() => !!__ge.sheet(), null, { timeout: 5000 });
  await shot(t, 'tiles-size');
  await tapAt(t, await ge(t, 'sheetRow', '[data-size="W"]'));
  assert.equal((await ge(t, 'at', 'clock')).split(' ')[1], 'W', 'the clock made Wide');
  assert.equal(await p.evaluate(() => !!__ge.sheet()), false, 'the sheet closed');
  // removed
  await tapAt(t, await ge(t, 'btn', 'cam', 'x'));
  assert.equal(await ge(t, 'at', 'cam'), null, 'the camera removed');
  assert.equal(await ge(t, 'barMsg'), 'Camera removed. Cancel puts it back.');
  // added
  await tapAt(t, await ge(t, 'barBtn', 'Add'));
  await p.waitForFunction(() => !!__ge.sheet(), null, { timeout: 5000 });
  await shot(t, 'tiles-add');
  await tapAt(t, await ge(t, 'sheetRow', '.chip[data-card="scenes"][data-size="W"]'));
  const added = await p.evaluate(() => hkEditGrid.active().grid.items.filter(i => i.card === 'scenes').map(i => i.size));
  assert.deepEqual(added, ['W'], 'a Scenes block added');
  await shot(t, 'tiles-arranged');
  // Done: saved as arranged, drawn the same after a reload
  const want = await p.evaluate(() => hkEditGrid.active().grid.items.map(i => i.id + '@' + i.at.join(',') + ' ' + i.size).sort());
  await tapAt(t, await ge(t, 'barBtn', 'Done'));
  await p.waitForFunction(() => !hkEdit.active(), null, { timeout: 10000 });
  await p.waitForFunction(([b, w]) => JSON.stringify(__ge.saved(b)) === JSON.stringify(w), [board, want], { timeout: 15000 })
    .catch(async () => { throw new Error('not saved as arranged: ' + JSON.stringify([await ge(t, 'saved', board), want])); });
  assert.equal(await p.evaluate(() => __ge.deep(document, '.hk-ge').length), 0, 'the covers are gone');
  await p.waitForTimeout(1500);
  await shot(t, 'tiles-done');
  assert.notDeepEqual(want, before.map(s => s.replace(/@/, '@')), 'the layout changed');
  await go(t, '/' + board + '/home');
  assert.deepEqual(await ge(t, 'shown'), want.map(s => s), 'after a reload, drawn as saved');
  await close(t, 'tiles ' + how);
  pass('tiles (' + how + '): Edit from More; carried to a free cell and onto another, made Wide, removed, added; Done saved and drawn after a reload');
}

// ------------------------------------------------------------------ a full grid: a card placed over the blocks it replaces
async function replace(inp) {
  const board = 'ge-full-' + inp, t = await open('/' + board + '/home', inp === 'finger'), p = t.page, how = inp;
  await enterFromMore(t);
  const items = () => p.evaluate(() => hkEditGrid.active().grid.items.map(i => i.id + '@' + i.at.join(',') + ' ' + i.size).sort());
  const start = await items(), shown0 = await ge(t, 'shown');
  assert.equal(start.length, 11, 'the grid is full of blocks');
  assert.equal(await p.evaluate(() => ['S', 'W', 'T', 'L', 'XL'].map(z => hkGridEditor.firstSpace(hkEditGrid.active().grid, z)).every(x => x === null)), true, 'no free space for any size');
  // Add: the Large Camera has no free space, and its chip is still there to choose
  const choose = async () => {
    await tapAt(t, await ge(t, 'barBtn', 'Add'));
    await p.waitForFunction(() => !!__ge.sheet(), null, { timeout: 5000 });
    const chip = await p.evaluate(() => { const c = __ge.sheet().querySelector('.chip[data-card="camera"][data-size="L"]'); return c && { replace: c.hasAttribute('data-replace'), disabled: c.disabled, title: c.title }; });
    assert.deepEqual([chip && chip.replace, chip && chip.disabled], [true, false], 'a size with no free space is offered, marked as one that replaces: ' + JSON.stringify(chip));
    assert.match(chip.title, /place it over the blocks it replaces/);
    return chip;
  };
  await choose();
  await shot(t, 'replace-add');
  await tapAt(t, await ge(t, 'sheetRow', '.chip[data-card="camera"][data-size="L"]'));
  assert.equal(await p.evaluate(() => !__ge.sheet()), true, 'the sheet closed');
  assert.match(await ge(t, 'barMsg'), /^Drag the new Large Camera over the grid, onto the blocks it should replace, and let go\. Escape cancels\.$/, 'the bar says what to do');
  const over = await ge(t, 'blockAt', 0, 2, 2, 2);
  // held over the lock, Timers and Scenes. A mouse's pointer is enough; a finger goes down on the grid and moves there.
  const hold = async () => {
    if (t.finger) { await p.evaluate(([x, y]) => __finger.down(x, y), [over.x + 120, over.y]); for (let i = 1; i <= 8; i++) { await p.evaluate(([x, y]) => __finger.move(x, y), [over.x + 120 - 120 * i / 8, over.y]); await p.waitForTimeout(25); } }
    else { await p.mouse.move(over.x + 120, over.y); for (let i = 1; i <= 8; i++) { await p.mouse.move(over.x + 120 - 120 * i / 8, over.y); await p.waitForTimeout(25); } }
    await p.waitForTimeout(350);
  };
  await hold();
  const held = await ge(t, 'placing');
  assert.deepEqual([held.at, held.shown, held.replace, held.going], [[0, 2], true, true, ['lock', 'scenes', 'timers']], 'held over them: the outline is red, and the three they would replace are dimmed');
  assert.equal(await ge(t, 'barMsg'), 'The Large Camera replaces Action, Timers and Scenes here. Cancel puts them back.', 'the bar names them');
  assert.deepEqual(await items(), start, 'nothing is changed while it is held');
  assert.equal(await p.evaluate(() => getComputedStyle(__ge.cell('lock')).opacity), '0.45', 'the dimmed block is dimmed');
  await shot(t, 'replace-held');
  // Escape: given up, every block as it was
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  if (t.finger) await p.evaluate(([x, y]) => __finger.up(x, y), [over.x, over.y]); else await p.mouse.move(over.x, over.y - 400);
  await p.waitForTimeout(300);
  assert.deepEqual([await ge(t, 'placing'), await items(), await ge(t, 'barMsg'), await p.evaluate(() => !!hkEdit.active())], [null, start, 'Cancelled.', true], 'Escape: nothing placed, Edit mode goes on');
  assert.deepEqual(await ge(t, 'shown'), shown0, '...every block drawn where it was');
  // the drop
  await choose();
  await tapAt(t, await ge(t, 'sheetRow', '.chip[data-card="camera"][data-size="L"]'));
  await hold();
  if (t.finger) await p.evaluate(([x, y]) => __finger.up(x, y), [over.x, over.y]);
  else { await p.mouse.down(); await p.mouse.up(); }
  await p.waitForTimeout(700);
  const placed = await items();
  assert.deepEqual(placed, start.filter(s => !/^(lock|timers|scenes)@/.test(s)).concat(['b1@0,2 L']).sort(), 'dropped: the three are gone, the Camera took their cells, nothing else moved (' + how + ')');
  assert.equal(await ge(t, 'barMsg'), 'Action, Timers and Scenes were replaced by Camera. Cancel puts them back.');
  assert.deepEqual(await ge(t, 'placing'), null, 'placing is over');
  assert.equal(await p.evaluate(() => hkGridEditor.valid(hkEditGrid.active().grid)), true, '...the layout valid');
  assert.deepEqual((await ge(t, 'shown')).filter(x => /^(lock|timers|scenes|b1)@/.test(x)), ['b1@0,2 L'], '...the page shows it');
  assert.equal(await p.evaluate(() => [...__ge.view()._root.children].filter(c => c.classList.contains('hk-ge-going')).length), 0, '...nothing left dimmed');
  await shot(t, 'replace-dropped');
  // Cancel: all back
  await tapAt(t, await ge(t, 'barBtn', 'Cancel'));
  await p.waitForFunction(() => !hkEdit.active(), null, { timeout: 5000 });
  assert.deepEqual(await ge(t, 'shown'), shown0, 'Cancel: the page as it was, the three blocks back');
  assert.deepEqual(await ge(t, 'saved', board), start.map(x => x), '...nothing saved');
  // again, and Done keeps it
  await enterFromMore(t);
  await choose();
  await tapAt(t, await ge(t, 'sheetRow', '.chip[data-card="camera"][data-size="L"]'));
  await hold();
  if (t.finger) await p.evaluate(([x, y]) => __finger.up(x, y), [over.x, over.y]);
  else { await p.mouse.down(); await p.mouse.up(); }
  await p.waitForTimeout(700);
  const want = await items();
  assert.equal(want.length, 9, 'replaced again');
  await tapAt(t, await ge(t, 'barBtn', 'Done'));
  await p.waitForFunction(() => !hkEdit.active(), null, { timeout: 10000 });
  await p.waitForFunction(([b, w]) => JSON.stringify(__ge.saved(b)) === JSON.stringify(w), [board, want], { timeout: 15000 })
    .catch(async () => { throw new Error('not saved as arranged: ' + JSON.stringify([await ge(t, 'saved', board), want])); });
  await close(t, 'replace ' + how);
  pass('replace (' + how + '): a full grid still offers the card; held over blocks they are dimmed and named, Escape gives up, the drop replaces them, Cancel puts them back, Done saves');
}

// ------------------------------------------------------------------ the Square screen, from a sheet, Cancel
async function square(inp) {
  const board = 'ge-square-' + inp, t = await open('/' + board + '/home', inp === 'finger'), p = t.page;
  const before = await ge(t, 'shown'), saved0 = await ge(t, 'saved', board);
  await p.evaluate(() => window.hkDetail.open('light.living_room_lamps'));
  await p.waitForTimeout(900);
  await tapAt(t, await p.evaluate(() => { const g = __ge.deep(document, '.hkd .gear').find(x => !x.hidden && x.getBoundingClientRect().width > 0); return g && __ge.box(g); }));
  await p.waitForTimeout(700);
  const note = await p.evaluate(() => { const n = __ge.deep(document, '.editpg .note')[0]; return n ? n.textContent : null; });
  assert.equal(note, 'Drag the blocks into place, change their sizes, remove them or add more.', 'the sheet says what Edit does here');
  await tapAt(t, await p.evaluate(() => { const b = __ge.deep(document, '.edpg').find(x => x.getBoundingClientRect().width > 0); return b && (b.scrollIntoView({ block: 'center' }), __ge.box(b)); }));
  await ready(t);
  assert.equal((await ge(t, 'covers')).length, 4, 'every block covered');
  await shot(t, 'square-edit');
  await carry(t, await ge(t, 'centre', 'lamps'), await ge(t, 'cellAt', 1, 2));
  assert.equal(await ge(t, 'at', 'lamps'), '1,2 S', 'the lamps carried to the free square');
  await shot(t, 'square-moved');
  await tapAt(t, await ge(t, 'barBtn', 'Cancel'));
  await p.waitForFunction(() => !hkEdit.active(), null, { timeout: 5000 });
  assert.deepEqual(await ge(t, 'shown'), before, 'Cancel: the page as it was');
  assert.equal(await p.evaluate(() => __ge.cell('lamps').style.gridColumn), '3 / span 1', '...the lamps in their own cell');
  await p.waitForTimeout(800);
  assert.deepEqual(await ge(t, 'saved', board), saved0, '...nothing saved');
  await close(t, 'square ' + inp);
  pass('square (' + inp + '): Edit This Page from an accessory\'s sheet; a block carried; Cancel put it back, nothing saved');
}

// ------------------------------------------------------------------ beside the Side Pane, Escape, Done
async function pane(inp) {
  const board = 'ge-pane-' + inp, t = await open('/' + board + '/home', inp === 'finger'), p = t.page;
  const paneBox = () => p.evaluate(() => { const s = document.querySelector('hk-side-pane[mode="dash"]'); return s && s.hasAttribute('on') ? __ge.box(s) : null; });
  const pb0 = await paneBox(), rb0 = await ge(t, 'rootBox');
  // (beside it on a tablet held sideways, above it where the pane is a band under the page)
  const clear = (rb, pb) => rb.r <= pb.l + 1 || rb.l >= pb.r - 1 || rb.b <= pb.t + 1;
  if (pb0) assert(clear(rb0, pb0), 'the grid clear of the pane before Edit: ' + JSON.stringify([rb0, pb0]));
  await enterFromMore(t);
  const pb = await paneBox(), rb = await ge(t, 'rootBox');
  if (pb0) {
    assert(pb, 'the Side Pane stays while the grid is edited');
    assert(clear(rb, pb), 'the grid clear of the pane while it is edited: ' + JSON.stringify([rb, pb]));
  }
  await shot(t, 'pane-edit');
  await carry(t, await ge(t, 'centre', 'p5'), await ge(t, 'cellAt', 2, 2), { escape: true });
  assert.equal(await ge(t, 'at', 'p5'), '0,2 S', 'Escape while it is held puts it back');
  assert(await p.evaluate(() => !!hkEdit.active()), '...and Edit mode goes on');
  await carry(t, await ge(t, 'centre', 'p5'), await ge(t, 'cellAt', 2, 2));
  assert.equal(await ge(t, 'at', 'p5'), '2,2 S', 'Timers carried beside the security block');
  const want = await p.evaluate(() => hkEditGrid.active().grid.items.map(i => i.id + '@' + i.at.join(',') + ' ' + i.size).sort());
  await tapAt(t, await ge(t, 'barBtn', 'Done'));
  await p.waitForFunction(() => !hkEdit.active(), null, { timeout: 10000 });
  await p.waitForFunction(([b, w]) => JSON.stringify(__ge.saved(b)) === JSON.stringify(w), [board, want], { timeout: 15000 });
  await p.waitForTimeout(1200);
  await shot(t, 'pane-done');
  await close(t, 'pane ' + inp);
  pass('pane (' + inp + '): ' + (pb0 ? 'the Side Pane beside the grid while editing; ' : 'no Side Pane at this size; ') + 'Escape put a carried block back; Done saved');
}

(async () => {
  browser = await pw.webkit.launch({ headless: true });
  try {
    for (const inp of input.inputs) {
      await tiles(inp);
      await replace(inp);
      await square(inp);
      await pane(inp);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL ' + TAG + ': ' + (e && e.stack || e)); process.exit(1); });
