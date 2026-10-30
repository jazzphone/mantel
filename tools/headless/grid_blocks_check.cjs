// Home Grid's editor makes room (grid_blocks_check.py starts the server; 2026-10-30, the owner on an iPad: "As I
// move the block, the tiles that become free, the tiles that get overlapped, move to those free spots").
// One engine per run: Chromium drives a finger (CDP Input.dispatchTouchEvent), WebKit a mouse, at an iPad's size.
//
//   - the Large camera carried onto the four small tiles: while it is held there, the four slide (in the preview
//     and their outlines) into the space it left, as they were, and the outline it would take is not red
//   - dropped: the draft is that layout, and the preview is drawn from it; one Undo puts every block back
//   - carried there again, then Escape, or let go off the grid: nothing changes, and every block is back
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
async function down(p, a) { if (FINGER) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] }); else { await p.mouse.move(a.x, a.y); await p.mouse.down(); } }
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
    assert.deepEqual(errors, [], 'no page or console errors');
    await ctx.close();
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL ' + TAG + ': ' + (e && e.stack || e)); process.exit(1); });
