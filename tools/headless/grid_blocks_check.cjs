// Home Grid's editor makes room (grid_blocks_check.py starts the server; 2026-10-30, the owner on an iPad: "As I
// move the block, the tiles that become free, the tiles that get overlapped, move to those free spots").
// One engine per run: Chromium drives a finger (CDP Input.dispatchTouchEvent), WebKit a mouse, at an iPad's size.
//
//   - the Large camera carried onto the four small tiles: while it is held there, the four slide (in the preview
//     and their outlines) into the space it left, as they were, and the outline it would take is not red
//   - dropped: the draft is that layout, and the preview is drawn from it; one Undo puts every block back
//   - carried there again, then Escape, or let go off the grid: nothing changes, and every block is back
//   - the card picker (2026-10-31): a size chip tapped shows that size's preview in its own shape; a card with no free
//     space dragged onto the full grid replaces the blocks it covers (marked and named while it is held, one Undo
//     brings them back); let go off the grid, nothing; with free cells the blocks make room and none is removed
const assert = require('assert/strict');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const [W, H] = input.size.split('x').map(Number);
const FINGER = input.engine === 'chromium', TAG = input.engine + ' ' + input.size;
// what each home supplies from its own files and the fictional house has not (edit_mode_check.cjs)
const HOMES_OWN = /\/hk\/(fonts\/SF-Pro\.(woff2|ttf)|iconset\/hk-glyphs\.js)$/;

const HELP = () => {
  window.ed = document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor');
  window.at = () => Object.fromEntries(ed.grid.items.map(i => [i.id, i.at.join(',')]));
  window.cell = id => ed.previewView.shadowRoot.querySelector('.cell[data-id="' + id + '"]');
  // a block's cell in the preview, in grid steps from the grid's corner (where it is drawn, translate and all)
  window.drawnAt = id => {
    // (the cell's box is in the preview's own px, which the overlay is placed in: style.left / top)
    const s = ed.step(), r = cell(id).getBoundingClientRect(), o = ed.overlay.style, z = { S: [1, 1], W: [2, 1], T: [1, 2], L: [2, 2] }[ed.grid.items.find(i => i.id === id).size];
    // (by its middle: the carried one is drawn a little larger)
    const x = r.left + r.width / 2 - parseFloat(o.left) - (z[0] * s[0] - (ed.cellGap || 10)) / 2, y = r.top + r.height / 2 - parseFloat(o.top) - (z[1] * s[1] - (ed.cellGap || 10)) / 2;
    return [Math.round(x / s[0] * 10) / 10 + 0, Math.round(y / s[1] * 10) / 10 + 0];          // (+ 0: never -0)
  };
  window.slid = () => ed.grid.items.filter(i => cell(i.id) && cell(i.id).style.translate).map(i => i.id).sort();
  // a point in the overlay: the middle of the cells [col, row] to [col + w, row + h]
  window.cellsAt = (col, row, w, h) => {
    const g = ed.overlay.getBoundingClientRect(), s = ed.step(), f = g.width / ed.overlay.clientWidth;
    return { x: g.left + (col + w / 2) * s[0] * f, y: g.top + (row + h / 2) * s[1] * f };
  };
};

let cdp;
async function down(p, a) { if (FINGER) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  else { await p.mouse.move(a.x, a.y); await p.mouse.down(); } }
async function to(p, a, b, steps = 14) {
  for (let i = 1; i <= steps; i++) {
    const x = a.x + (b.x - a.x) * i / steps, y = a.y + (b.y - a.y) * i / steps;
    if (FINGER) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); else await p.mouse.move(x, y);
    await p.waitForTimeout(20);
  }
}
async function up(p) { if (FINGER) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await p.mouse.up(); }
async function shot(p, name) {
  if (!input.shots) return;
  // (Arial for Apple's licensed fonts, which the fictional house hasn't got: grid_editor_smoke.py's)
  await p.screenshot({ path: input.shots + '/' + input.engine + '-' + input.size + '-reflow-' + name + '.png' });
}

(async () => {
  const browser = await pw[input.engine].launch({ headless: true, ...(FINGER ? { executablePath: input.chrome } : {}) });
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: FINGER, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
    await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
    const p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push('page error: ' + e.message); });
    p.on('console', m => { if (m.type() === 'error' && !HOMES_OWN.test((m.location() && m.location().url) || '')) errors.push('console: ' + m.text()); });
    if (FINGER) cdp = await ctx.newCDPSession(p);
    await p.goto(input.origin + '/settings#/screens/' + input.screen + '/home-grid');
    await p.waitForFunction(() => { const e = document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor'); return !!(e && e.ui && e.grid); }, null, { timeout: 30000 });
    await p.evaluate(HELP);
    await p.waitForFunction(() => ed.previewView && ed.previewView.isConnected && !ed.box.hasAttribute('data-loading') && !!cell('camera'), null, { timeout: 60000 });
    await p.waitForTimeout(1500);
    const start = await p.evaluate(() => at());
    assert.equal(await p.evaluate(() => ed.stage.querySelector('.note').textContent.includes('others make room')), true, 'the note says blocks make room');

    // 1. the camera onto the four small tiles, held there
    const from = await p.evaluate(() => cellsAt(2, 0, 2, 2)), onto = await p.evaluate(() => cellsAt(0, 2, 2, 2));
    await down(p, from);
    // (most of the way, and a shot while the others are still sliding)
    const most = { x: from.x + (onto.x - from.x) * 0.8, y: from.y + (onto.y - from.y) * 0.8 };
    await to(p, from, most, 11);
    await p.waitForTimeout(90);
    await shot(p, 'sliding');
    await to(p, most, onto, 3);
    await p.waitForTimeout(400);                      // (the 200 ms slide, finished)
    const mid = await p.evaluate(() => ({ slid: slid(), bad: ed.overlay.querySelector('.ghost')?.classList.contains('bad'),
      ghost: !!ed.overlay.querySelector('.ghost'), draft: at(),
      drawn: Object.fromEntries(['coffee', 'fire', 'tread', 'lights', 'cal'].map(id => [id, drawnAt(id)])) }));
    assert.deepEqual(mid.draft, start, 'nothing in the draft changes before the drop');
    assert.equal(mid.ghost && !mid.bad, true, 'the outline where it would land, not red');
    assert.deepEqual(mid.slid, ['camera', 'coffee', 'fire', 'lights', 'tread'], 'the carried camera and the four small tiles are moved in the preview');
    assert.deepEqual(mid.drawn, { coffee: [2, 0], fire: [3, 0], tread: [2, 1], lights: [3, 1], cal: [2, 2] },
      'the four drawn in the space the camera left, as they were (the calendar where it was)');
    await shot(p, 'mid');
    await up(p);
    await p.waitForFunction(() => at().camera === '0,2', null, { timeout: 5000 });
    const after = await p.evaluate(() => at());
    assert.deepEqual(after, { ...start, camera: '0,2', coffee: '2,0', fire: '3,0', tread: '2,1', lights: '3,1' }, 'dropped: the layout it showed');
    // the preview drawn again from the draft: its cells where the blocks are, none still sliding
    await p.waitForFunction(() => ed.previewView._config.cards.find(c => c.hk_cell?.id === 'coffee').hk_cell.at.join() === '2,0' && !slid().length, null, { timeout: 10000 });
    await p.waitForTimeout(800);
    const drawn = await p.evaluate(() => Object.fromEntries(ed.grid.items.map(i => [i.id, drawnAt(i.id).join(',')])));
    assert.deepEqual(drawn, after, 'the preview draws each block where the draft has it');
    // every outline over its cell again
    assert(await p.evaluate(() => [...ed.overlay.querySelectorAll('.block')].every(b => {
      const r = b.getBoundingClientRect(), c = cell(b.dataset.id).getBoundingClientRect(), fr = ed.iframe.getBoundingClientRect(), k = fr.width / ed.iframe.clientWidth;
      return Math.abs(r.left - (fr.left + c.left * k)) < 3 && Math.abs(r.top - (fr.top + c.top * k)) < 3;
    })), 'every outline over its cell');
    await shot(p, 'after');
    console.log('PASS ' + TAG + ' the camera carried onto four small tiles: they slide into the space it left, and the drop keeps it');

    // 2. one Undo: the whole layout back
    assert.equal(await p.evaluate(() => ed.undoStack.length), 1, 'one step to undo');
    await p.evaluate(() => ed.undoButton.click());
    assert.deepEqual(await p.evaluate(() => at()), start, 'Undo puts every block back');
    await p.waitForFunction(() => ed.previewView._config.cards.find(c => c.hk_cell?.id === 'coffee').hk_cell.at.join() === '0,2', null, { timeout: 10000 });
    console.log('PASS ' + TAG + ' one Undo puts every block back');

    // 3. Escape while held there, and a drop off the grid: nothing changes, everything back
    await p.waitForTimeout(800);
    const from2 = await p.evaluate(() => cellsAt(2, 0, 2, 2)), onto2 = await p.evaluate(() => cellsAt(0, 2, 2, 2));
    await down(p, from2);
    await to(p, from2, onto2);
    await p.waitForTimeout(300);
    assert.equal((await p.evaluate(() => slid())).length, 5, 'held over the small tiles: they slide');
    await p.keyboard.press('Escape');
    await up(p);
    await p.waitForTimeout(500);
    assert.deepEqual(await p.evaluate(() => [at(), slid(), !!ed.overlay.querySelector('.ghost'), ed.undoStack.length]), [start, [], false, 0], 'Escape: all back');
    const off = await p.evaluate(() => { const r = ed.overlay.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 40 }; });
    await down(p, from2);
    await to(p, from2, onto2, 8);
    await to(p, onto2, off, 8);
    await p.waitForTimeout(300);
    assert.deepEqual(await p.evaluate(() => slid()), ['camera'], 'off the grid: only the carried block is out of place');
    await up(p);
    await p.waitForTimeout(500);
    assert.deepEqual(await p.evaluate(() => [at(), slid(), ed.undoStack.length, /does not fit/.test(ed.message.textContent)]), [start, [], 0, false],
      'let go off the grid: nothing changes, and no refusal said');
    console.log('PASS ' + TAG + ' Escape, or letting go off the grid, puts everything back');

    // 4. THE PICKER (2026-10-31, the owner: choosing a size left the preview on Small; a card with no room could not be
    // dragged onto the grid). A size chip chosen: the preview is that size's shape, as the grid draws it.
    await p.evaluate(() => {
      window.rowAt = k => { const e = ed.palette.querySelector('[data-card=' + k + ']'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect();
        return { x: r.x + 30, y: r.y + 20 }; };
      window.chipAt = (k, s) => { const e = ed.palette.querySelector('[data-card=' + k + '] .chip[data-size=' + s + ']'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
      window.drawnSize = () => { const f = ed.palette.querySelector('[data-preview-card] iframe'); return f && { w: parseFloat(f.style.width), h: parseFloat(f.style.height) }; };
      window.going = () => [...ed.overlay.querySelectorAll('.block.going')].map(b => b.dataset.id).sort();
    });
    async function tap(a) { await down(p, a); await up(p); await p.waitForTimeout(250); }
    const sized = s => p.waitForFunction(z => { const f = ed.palette.querySelector('[data-preview-card] iframe'); const c = f && f.contentWindow && f.contentWindow.galleryCard; return !!c &&
      c.getAttribute('size') === z && !!c.shadowRoot; }, s, { timeout: 40000 });
    const cellUnit = await p.evaluate(() => { const u = hkGridCatalog.CELLS[ed.grid.cell === 'square' ? 'square' : 'tile']; return { w: u.w, h: u.h, gap: u.gap }; });
    const SZ = { S: [1, 1], W: [2, 1], T: [1, 2], L: [2, 2], XL: [3, 2] }, SAYS = { S: 'Small', W: 'Wide', T: 'Tall', L: 'Large', XL: 'Extra Large' };
    // open Weather's row with a tap on the row itself, then choose each size with a tap on its chip
    await tap(await p.evaluate(() => rowAt('weather')));
    await p.waitForFunction(() => ed.pickerCard === 'weather', null, { timeout: 5000 });
    for (const sz of ['W', 'T', 'L', 'XL', 'S']) {
      await tap(await p.evaluate(s => chipAt('weather', s), sz));
      assert.equal(await p.evaluate(() => ed.pickerCard), 'weather', 'a chip tapped keeps the row open (' + sz + ')');
      assert.equal(await p.evaluate(() => ed.paletteSizes.weather), sz, 'the chip tapped is the size chosen');
      await sized(sz);
      const w = cellUnit.w * SZ[sz][0] + cellUnit.gap * (SZ[sz][0] - 1), h = cellUnit.h * SZ[sz][1] + cellUnit.gap * (SZ[sz][1] - 1);
      const got = await p.evaluate(() => {
        const b = ed.palette.querySelector('[data-preview-card]'), f = b.querySelector('iframe'), c = f.contentWindow.galleryCard.getBoundingClientRect();
        return { ...drawnSize(), box: b.dataset.previewSize, pressed: [...ed.palette.querySelectorAll('[data-card=weather] .chip[aria-pressed=true]')].map(x => x.dataset.size),
                 add: ed.palette.querySelector('.catalog-add').textContent, boxW: b.clientWidth, boxH: b.clientHeight, cardW: c.width, cardH: c.height };
      });
      assert.deepEqual([got.w, got.h, got.box, got.pressed], [w, h, sz, [sz]], 'the preview is ' + sz + '\'s shape, as the grid draws it');
      assert(Math.abs(got.cardW / got.cardH - w / h) < 0.02, 'the card inside is that shape: ' + JSON.stringify(got));
      assert(Math.abs(got.boxH / got.boxW - h / w) < 0.02 || got.boxW > w, 'its box the same shape, scaled to fit: ' + JSON.stringify(got));
      assert(got.add.includes(SAYS[sz]) || /No room/.test(got.add), 'Add says the size: ' + got.add);
      await shot(p, 'picker-' + sz);
    }
    console.log('PASS ' + TAG + ' a size chip tapped: the preview is that size, in its own shape (Wide, Tall, Large, Extra Large, Small)');

    // a card with no free space dragged onto the full grid: it replaces the blocks it covers
    await tap(await p.evaluate(() => chipAt('weather', 'L')));
    await sized('L');
    const full = await p.evaluate(() => ['S', 'W', 'T', 'L', 'XL'].map(z => hkGridEditor.firstSpace(ed.grid, z)));
    assert.deepEqual(full, [null, null, null, null, null], 'this grid has no free space for any size');
    assert.match(await p.evaluate(() => ed.palette.querySelector('.pal-detail').textContent), /drag the card onto the grid to replace the blocks it covers/, 'the picker says it can still be dragged');
    assert.equal(await p.evaluate(() => ed.palette.querySelector('.catalog-add').disabled), true, '...and Add itself is off');
    const dragFrom = await p.evaluate(() => rowAt('weather')), dragTo = await p.evaluate(() => cellsAt(0, 2, 2, 2)), aside = { x: dragFrom.x + 40, y: dragFrom.y };
    const noteBefore = await p.evaluate(() => ed.stage.querySelector('.note').textContent), noteHeight = await p.evaluate(() => ed.stage.querySelector('.note').getBoundingClientRect().height);
    await down(p, dragFrom);
    await to(p, dragFrom, aside, 4);
    await to(p, aside, dragTo, 14);
    await p.waitForTimeout(350);
    const held = await p.evaluate(() => {
      const n = ed.stage.querySelector('.note'), g = ed.overlay.querySelector('.ghost');
      return { replace: g && g.classList.contains('replace'), bad: g && g.classList.contains('bad'), going: going(), note: n.textContent, warn: n.classList.contains('warn'),
        noteH: n.getBoundingClientRect().height,
               draft: at(), washed: [...ed.overlay.querySelectorAll('.block.going')].every(b => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)') };
    });
    assert.equal(held.replace && !held.bad, true, 'held over blocks with no room: the outline is the replacing one, not "no"');
    assert.deepEqual(held.going, ['coffee', 'fire', 'lights', 'tread'], 'the four small tiles it covers are marked to go');
    assert.equal(held.washed, true, '...washed, not just named');
    assert.match(held.note, /^Dropping here replaces 4 blocks\. Undo puts them back\.$/, 'the hint line says so in words');
    assert.equal(held.warn, true, '...in the warning color');
    assert.equal(held.noteH, noteHeight, 'the hint keeps its height: the screen does not rescale under the hand');
    assert.deepEqual(held.draft, start, 'nothing in the draft changes while it is held');
    await shot(p, 'picker-held-over');
    await up(p);
    await p.waitForFunction(() => ed.grid.items.some(i => i.card === 'weather' && i.at.join() === '0,2' && i.size === 'L' && i.id === 'b1'), null, { timeout: 5000 });
    const dropped = await p.evaluate(() => ({ ids: ed.grid.items.map(i => i.id).sort(), undo: ed.undoStack.length, msg: ed.message.textContent, note: ed.stage.querySelector('.note').textContent,
      noteStyle: ed.stage.querySelector('.note').getAttribute('style') || '', valid: hkGridEditor.valid(ed.grid) }));
    assert.deepEqual(dropped.ids, Object.keys(start).filter(id => !['coffee', 'fire', 'lights', 'tread'].includes(id)).concat(['b1']).sort(), 'the four are gone and the card took their cells');
    assert.equal(dropped.valid && dropped.undo === 1, true, '...a valid layout, one step to undo');
    assert.match(dropped.msg, /^4 blocks were replaced by Weather\. Undo/, '...and the editor says what went');
    assert.equal(dropped.note, noteBefore, '...the hint line as it was');
    assert.equal(/height|overflow/.test(dropped.noteStyle), false, '...its height free again');
    await p.waitForFunction(() => ed.previewView._config.cards.some(c => c.hk_cell && c.hk_cell.id === 'b1') && !slid().length, null, { timeout: 10000 });
    await p.waitForTimeout(600);
    await shot(p, 'picker-replaced');
    await p.evaluate(() => ed.undoButton.click());
    assert.deepEqual(await p.evaluate(() => at()), start, 'one Undo puts all four back, and the new card away');
    await p.waitForFunction(() => ed.previewView._config.cards.find(c => c.hk_cell && c.hk_cell.id === 'coffee') && !ed.previewView._config.cards.some(c => c.hk_cell && c.hk_cell.id === 'b1'), null,
      { timeout: 10000 });
    console.log('PASS ' + TAG + ' a card dragged onto a full grid: the blocks it covers marked and named while held, replaced when dropped, one Undo brings them back');

    // ...let go off the grid: nothing changes, the blocks and the hint as they were
    await p.waitForTimeout(800);
    const away = await p.evaluate(() => { const r = ed.overlay.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 40 }; });
    const from3 = await p.evaluate(() => rowAt('weather')), aside3 = { x: from3.x + 40, y: from3.y };
    await down(p, from3);
    await to(p, from3, aside3, 4);
    await to(p, aside3, dragTo, 10);
    await p.waitForTimeout(250);
    assert.equal((await p.evaluate(() => going())).length, 4, 'held over them again');
    await to(p, dragTo, away, 8);
    await p.waitForTimeout(250);
    assert.deepEqual(await p.evaluate(() => [going(), !!ed.overlay.querySelector('.ghost'), ed.stage.querySelector('.note').textContent]), [[], false, noteBefore],
      'carried off the grid: nothing marked, the hint as it was');
    await up(p);
    await p.waitForTimeout(400);
    assert.deepEqual(await p.evaluate(() => [at(), ed.undoStack.length]), [start, 0], 'let go off the grid: nothing placed, nothing to undo');

    // ...with room to spare the others make room, and nothing is removed
    await p.evaluate(() => { ed.remove('morning'); ed.remove('relax'); });
    await p.waitForFunction(() => !ed.previewView._config.cards.some(c => c.hk_cell && c.hk_cell.id === 'morning'), null, { timeout: 10000 });
    await p.waitForTimeout(800);
    await tap(await p.evaluate(() => chipAt('weather', 'S')));
    await sized('S');
    const from4 = await p.evaluate(() => rowAt('weather')), aside4 = { x: from4.x + 40, y: from4.y }, onCoffee = await p.evaluate(() => cellsAt(0, 2, 1, 1));
    await down(p, from4);
    await to(p, from4, aside4, 4);
    await to(p, aside4, onCoffee, 14);
    await p.waitForTimeout(400);
    const room = await p.evaluate(() => ({ replace: ed.overlay.querySelector('.ghost') && ed.overlay.querySelector('.ghost').classList.contains('replace'), going: going(), slid: slid() }));
    assert.deepEqual([room.replace, room.going, room.slid.includes('coffee')], [false, [], true], 'with free cells elsewhere: the tile under it slides aside, none is marked to go');
    await up(p);
    await p.waitForFunction(() => ed.grid.items.some(i => i.id === 'b1'), null, { timeout: 5000 });
    assert.deepEqual(await p.evaluate(() => [ed.grid.items.length, ed.grid.items.some(i => i.id === 'coffee'), at().b1, hkGridEditor.valid(ed.grid)]), [10, true, '0,2', true],
      'dropped: all there, the tile moved, the card in its place');
    await p.evaluate(() => { ed.undo(); ed.undo(); ed.undo(); });
    assert.deepEqual(await p.evaluate(() => at()), start, 'three Undos: every block back');
    console.log('PASS ' + TAG + ' a card dragged off the grid changes nothing; with free cells the blocks make room and none is removed');
    assert.deepEqual(errors, [], 'no page or console errors');
    await ctx.close();
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL ' + TAG + ': ' + (e && e.stack || e)); process.exit(1); });
