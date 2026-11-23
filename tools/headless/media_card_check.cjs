// media_card_check.py's browser half: the Now Playing block while its speaker's state keeps coming (the script pushes it).
const assert = require('assert/strict');
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const [W, H] = input.size.split('x').map(Number);
const TAG = input.engine + ' ' + input.size;
// what each home supplies itself (the licensed font and glyphs): asked for, never served here
const HOMES_OWN = /\/hk\/(fonts\/SF-Pro\.(woff2|ttf)|iconset\/hk-glyphs\.js)$/;
const say = (t) => console.error(TAG + ': ' + t);

const HELP = () => {
  const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
  const cell = (id) => deep(document, '.cell[data-id="' + id + '"]')[0];
  const np = (id) => deep(cell(id), 'hk-now-playing-card')[0];
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  window.__mc = {
    deep, cell, np, rect,
    // the time and the bar's end, as drawn (the kit's block, round 12: the progress `.npp` -- the elapsed time, the fill's end)
    now: (id) => {
      const c = cell(id), t = deep(c, '.npp .e')[0], f = deep(c, '.npp .trk > i')[0];
      return { time: t ? t.textContent.trim() : null, bar: f ? f.getBoundingClientRect().right : null };
    },
    // watches a block: its cover (the one button and picture), anything done to it, the card's draws
    watch: (id) => {
      const card = np(id), cv = card.shadowRoot.querySelector('.npc'), w = { img: cv.querySelector('img'), plate: card.shadowRoot.querySelector('hk-plate'), touched: 0, renders: 0, card };
      new MutationObserver((m) => { w.touched += m.length; }).observe(cv, { subtree: true, childList: true, attributes: true, characterData: true });
      const draw = card._render;
      const words = (c) => { const t = c._root.querySelector('hk-plate > .a.kt, hk-plate > .a.kd'); return t ? t.textContent : ''; };
      w.html = 0; w.titles = 0; let last = words(card);
      card._render = function () {
        w.renders++; const b = this._kitHtml, r = draw.apply(this, arguments);
        if (this._kitHtml !== b) w.html++;          // (the block's markup drawn again: the cover and the countdowns built afresh)
        const t = words(this); if (t !== last) { w.titles++; last = t; }
        return r;
      };
      (window.__mcw = window.__mcw || {})[id] = w;
    },
    watched: (id) => {
      const w = window.__mcw[id], r = np(id).shadowRoot, img = r.querySelector('.npc img');
      return { html: w.html, titles: w.titles, same: w.img === img && w.plate === r.querySelector('hk-plate') && np(id) === w.card, touched: w.touched, renders: w.renders };
    },
    // the song's title, the first line of words of the plate (a key's label is a span, not a box)
    title: (id) => { const t = np(id).shadowRoot.querySelector('hk-plate > .a.kt, hk-plate > .a.kd'); return t ? t.textContent : ''; },
    // the Side Pane's volume slider
    slider: () => { const p = document.querySelector('hk-side-pane[mode="dash"]'); return p && p.shadowRoot && p.shadowRoot.querySelector('input[data-act="vol"]'); },
    // the music sheet the cover opens (a detail sheet: found through the shadow roots, wherever the sheet put it)
    panel: () => deep(document, '.mpanel')[0],
    // every key's glyph: its ink's middle from its button's, in px (the kit's keys are filled, so no "bare": the centering is what
    // an inline icon on a line of text once got wrong, up to 1.7 px low)
    wells: () => deep(document, 'hk-now-playing-card').flatMap(c => [...c.shadowRoot.querySelectorAll('button.key[data-np]')].map(e => {
      const r = e.getBoundingClientRect(), paths = [...e.querySelectorAll('svg path')];
      let L = 1e9, T = 1e9, R = -1e9, B = -1e9;
      paths.forEach(x => { const q = x.getBoundingClientRect(); if (q.width) { L = Math.min(L, q.left); T = Math.min(T, q.top); R = Math.max(R, q.right); B = Math.max(B, q.bottom); } });
      return paths.length && R > L ? { at: c.getAttribute('size') + ' ' + e.getAttribute('data-np'), dx: (L + R) / 2 - (r.left + r.width / 2), dy: (T + B) / 2 - (r.top + r.height / 2) } : null;
    })).filter(Boolean)
  };
};

async function page(browser, path) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !HOMES_OWN.test(m.location().url || '') && !/404|Not Found/.test(m.text())) errors.push(m.text()); });
  await p.goto(input.origin + path);
  return { p, ctx, errors };
}
async function home(browser) {
  const t = await page(browser, '/' + input.screen + '/home');
  await t.p.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
  await t.p.evaluate(HELP);
  await t.p.waitForFunction(() => ['album', 'plain', 'wide', 'small', 'cond'].every(id => { try { return !!__mc.title(id); } catch (e) { return false; } }),
    null, { timeout: 20000 });
  return t;
}

// ---- FLICKER: the bar and the time move and the card draws again; the cover is never touched (the Home Grid's block is the kit's since round 12:
// the cover is a picture on a button over the plate's own dark surface, no blurred copy behind it; the docked bar keeps the blurred one)
async function flicker(browser) {
  const { p, ctx, errors } = await home(browser);
  await p.waitForFunction(() => ['album', 'wide', 'small', 'cond'].every(id => { const i = __mc.np(id).shadowRoot.querySelector('.npc img'); return !!(i && i.complete && i.naturalWidth > 0); }), null,
    { timeout: 20000 });
  for (const id of ['album', 'wide', 'small', 'cond']) {
    assert.equal(await p.evaluate((i) => !!__mc.np(i).shadowRoot.querySelector('.bg'), id), false, id + ': the kit\'s block has no blurred cover behind it');
  }
  // the docked bar's: only in WebKit, where it flickered (a page scrolls under it: a layer would blur every frame on Android)
  const bar = await p.evaluate(() => {
    const el = hkCards.createCard({ type: 'custom:hk-now-playing-card', bar: true, music: true, entity: 'media_player.living_room' }, hkCards.client());
    el.style.cssText = 'position:fixed;left:0;bottom:0;width:800px;height:100px'; document.body.appendChild(el);
    return new Promise((done) => { let n = 0; const look = () => { const i = el.shadowRoot && el.shadowRoot.querySelector('.bg img');
      if (i || n++ > 200) { const v = i ? getComputedStyle(i).willChange : null; el.remove(); done(v); } else setTimeout(look, 25); }; look(); });
  });
  assert.equal(bar, input.engine === 'webkit' ? 'transform' : 'auto', 'the docked bar\'s cover');
  for (const id of ['album', 'plain', 'cond']) await p.evaluate((i) => __mc.watch(i), id);
  const box = await p.evaluate(() => __mc.rect(__mc.np('album').shadowRoot.querySelector('[data-np=pp]')));
  const seen = { album: [], plain: [], cond: [] }, titles = new Set();
  for (let i = 0; i < 26; i++) {
    for (const id of Object.keys(seen)) seen[id].push(await p.evaluate((b) => __mc.now(b), id));
    titles.add(await p.evaluate(() => __mc.title('album')));
    // a pointer going over the transport repainted it as a tick does (the second recording)
    await p.mouse.move(box.x + box.w / 2 + (i % 2 ? 60 : 0), box.y + box.h / 2);
    await p.waitForTimeout(250);
  }
  for (const id of Object.keys(seen)) {
    const times = new Set(seen[id].map(s => s.time)), bars = seen[id].map(s => s.bar);
    assert.ok(times.size >= 4, id + ': the time moved on: ' + [...times].join(' '));
    assert.ok(bars[bars.length - 1] > bars[0], id + ': the progress bar moved on: ' + bars[0] + ' to ' + bars[bars.length - 1]);
    bars.forEach((b, i) => assert.ok(i === 0 || b >= bars[i - 1] - 0.5, id + ': the progress bar never went back'));
    const w = await p.evaluate((b) => __mc.watched(b), id);
    assert.ok(w.renders >= 3, id + ': the card drew each push: ' + w.renders);
    // a push that moves only the position draws nothing again; a new title is a new song, and the block is drawn afresh for it
    assert.ok(w.html <= w.titles, id + ': the block was built again by something other than a new song: ' + w.html + ' times, ' + w.titles + ' new titles');
    if (!w.titles) assert.ok(w.same, id + ': the same card, plate and cover element all along');
    assert.equal(w.touched, 0, id + ': nothing done to the cover across ' + w.renders + ' draws');
  }
  const wells = await p.evaluate(() => __mc.wells());
  // (the kit's keys: Play / Pause on every size, Next on all but Small, Previous on Large and Extra Large; Browse and Speakers are the sheet's)
  assert.ok(wells.length >= 8, 'glyphs measured: ' + wells.length);
  for (const w of wells) assert.ok(Math.abs(w.dx) < 0.3 && Math.abs(w.dy) < 0.3, w.at + ': the glyph centered in its key (' + w.dx.toFixed(2) + ', ' + w.dy.toFixed(2) + ' px)');
  assert.ok(titles.size >= 2, 'a new title reached the card: ' + [...titles].join(', '));
  assert.deepEqual(errors, [], 'page errors');
  say('the time and bar move, the card draws each push, the cover is untouched; ' + wells.length + ' key glyphs centered in their keys');
  if (input.shots) { fs.mkdirSync(input.shots, { recursive: true }); await p.screenshot({ path: input.shots + '/media-card-' + input.engine + '-' + input.size + '.png' }); }
  await ctx.close();
}

// ---- BACKGROUND (the block's option -- the owner, 2026-11-23: "Can you fix it so it works? Blurred Album or Card?"): Blurred Album, the
// default, is the cover full-bleed behind it all, blurred, on the cover's own dark surface (white words); Card is the look's own plate -- no
// blurred cover, the look's own ink (dark on Flat Light)
async function background(browser) {
  const { p, ctx, errors } = await home(browser);
  // every element read below, drawn first (under a full run's load the blocks came in on their own, after the players, 2026-11-05)
  await p.waitForFunction(() => {
    try {
      const sh = (id) => __mc.np(id).shadowRoot, img = sh('album').querySelector('.npbg img');
      return !!(__mc.deep(__mc.cell('music'), 'hk-plate.mu')[0] && sh('album').querySelector('hk-plate.kit.mu') && img && img.complete && img.naturalWidth > 0 &&
                sh('plain').querySelector('hk-plate.kit.npcard') && sh('plain').querySelector('.a.kt') && sh('plain').querySelector('[data-np=pp] svg') &&
                sh('plain').querySelector('.npc img'));
    } catch (e) { return false; }
  }, null, { timeout: 20000 });
  const got = await p.evaluate(() => {
    const sh = (id) => __mc.np(id).shadowRoot, cs = (e) => getComputedStyle(e), bi = sh('album').querySelector('.npbg img');
    return { albumBlur: cs(bi).filter, albumLayer: cs(bi).willChange, albumDim: +cs(bi).opacity, albumFlat: __mc.np('album').hasAttribute('hk-flat'), plainBg: !!sh('plain').querySelector('.npbg'),
      plainMu: !!sh('plain').querySelector('hk-plate.kit.mu'),
             coverStill: !!sh('plain').querySelector('.npc img') && !!sh('album').querySelector('.npc img'),
             albumTitle: cs(sh('album').querySelector('.a.kt, .a.kd')).color, title: cs(sh('plain').querySelector('.a.kt')).color,
             glyphShadow: cs(sh('plain').querySelector('[data-np=pp] svg')).filter };
  });
  // Flat draws no blur: the cover sharp and very dim instead (the owner, 2026-11-23: "Flat is just suppose to really dim the art work, no blur")
  if (got.albumFlat) assert.ok(got.albumBlur === 'none' && got.albumDim <= 0.35, 'Blurred Album on Flat: the cover sharp and very dim: ' + got.albumBlur + ' ' + got.albumDim);
  else assert.ok(/blur\(/.test(got.albumBlur) && got.albumLayer === 'transform', 'Blurred Album: the cover blurred behind it, on a layer of its own: ' + got.albumBlur + ' ' + got.albumLayer);
  assert.equal(got.plainBg || got.plainMu, false, 'Card: no blurred cover, not the music surface');
  assert.ok(got.coverStill, 'the cover itself stays on both');
  assert.equal(got.glyphShadow, 'none');
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
  assert.ok(lum(got.albumTitle) > 0.9, 'Blurred Album: white words: ' + got.albumTitle);
  // Card's words are the look's: dark on Flat Light, light on glass
  assert.ok(input.mode === 'light' ? lum(got.title) < 0.5 : lum(got.title) > 0.85, 'Card: the look\'s own ink' + (input.mode === 'light' ? ' on Flat Light' : '') + ': ' + got.title);
  assert.deepEqual(errors, [], 'page errors');
  say('Blurred Album: the cover ' + (got.albumFlat ? 'sharp and dim (' + got.albumDim + ') on Flat' : 'blurred') + ' behind the block; Card: the look\'s plate and ink' +
    (input.mode === 'light' ? ' (Flat Light, title ' + got.title + ')' : ''));
  if (input.shots) { fs.mkdirSync(input.shots, { recursive: true }); await p.screenshot({ path: input.shots + '/media-card-' + input.mode + '-' + input.engine + '-' + input.size + '.png' }); }
  await ctx.close();
}

async function pane(browser) {
  const t = await page(browser, '/media-pane/home'), p = t.p;
  await p.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
  await p.evaluate(HELP);
  await p.waitForFunction(() => !!__mc.slider(), null, { timeout: 20000 });
  const vols = () => p.evaluate(() => ['media_player.living_room', 'media_player.kitchen'].map(k => hkCards.client().states[k].attributes.volume_level));
  // the pane shows the group's level: the rooms' average (30% and 60%)
  assert.equal(await p.evaluate(() => __mc.slider().value), '45', 'the group\'s level on the slider');
  const r = await p.evaluate(() => { const q = __mc.slider().getBoundingClientRect(); return { x: q.x, y: q.y + q.height / 2, w: q.width }; });
  const from = r.x + r.w * 0.45, to = r.x + r.w * 0.8;
  await p.mouse.move(from, r.y); await p.mouse.down();
  for (let k = 1; k <= 12; k++) { await p.mouse.move(from + (to - from) * k / 12, r.y); await p.waitForTimeout(40); }
  await p.mouse.up();
  await p.waitForFunction(() => ['media_player.living_room', 'media_player.kitchen'].every(k => Math.abs(hkCards.client().states[k].attributes.volume_level - 0.8) < 0.04), null, { timeout: 10000 })
    .catch(async () => assert.fail('the Side Pane\'s volume sets every room of the group: ' + JSON.stringify(await vols())));
  say('the Side Pane\'s volume on a group sets both rooms: ' + JSON.stringify(await vols()));
  // THE MUSIC SHEET, opened by the block's cover (round 12: Browse / Queue / Speakers, the screensaver panel's own tabs), with playlists that have covers
  // (stood in) and one that hasn't
  await p.evaluate(() => {
    const pic = (h) => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = 'hsl(' + h + ',70%,50%)'; x.fillRect(0, 0, 64, 64);
      return c.toDataURL(); };
    hkMusic.playlists = () => [{ name: 'Favorites Mix', icon: 'hk:star-fill', key: 'a', image: pic(10) }, { name: 'Country', icon: 'hk:guitar-acoustic', key: 'b', image: null },
                               { name: 'Your Essentials', icon: 'mdi:playlist-music', key: 'c', image: pic(270) }];
  });
  const cvr = await p.evaluate(() => __mc.rect(__mc.np('album').shadowRoot.querySelector('[data-np=cover]')));
  await p.mouse.click(cvr.x + cvr.w / 2, cvr.y + cvr.h / 2);
  // (it opens on Queue while a song plays; its three tabs at the top)
  await p.waitForFunction(() => { const m = __mc.panel(); return !!m && [...m.querySelectorAll('.mptabs [data-tab]')].map(t => t.textContent).join() === 'Browse,Queue,Speakers' &&
    m.querySelector('.mptabs .on').textContent === 'Queue'; }, null, { timeout: 15000 });
  await p.evaluate(() => __mc.panel().querySelector('.mptabs [data-tab="browse"]').click());
  await p.waitForFunction(() => { const m = __mc.panel(); return !!m && m.querySelectorAll('.mppill').length === 3; }, null, { timeout: 15000 });
  const got = await p.evaluate(() => {
    const m = __mc.panel(), pills = [...m.querySelectorAll('.mppill')];
    return { pills: pills.map(x => ({ cover: !!(x.querySelector('.th') && x.querySelector('.th').style.backgroundImage), tile: !!x.querySelector('.th.gl hk-icon'),
                                      whole: x.querySelector('span').scrollHeight <= x.querySelector('span').clientHeight + 1,
                                      left: Math.round(x.querySelector('span').getBoundingClientRect().left - x.getBoundingClientRect().left) })) };
  });
  assert.deepEqual(got.pills.map(x => [x.cover, x.tile]), [[true, false], [false, true], [true, false]], 'covers, and a glyph on a tile where there is none');
  got.pills.forEach((x, i) => assert.ok(x.whole, 'pill ' + i + ': its whole name'));
  assert.ok(new Set(got.pills.map(x => x.left)).size === 1, 'every name starts on one line: ' + got.pills.map(x => x.left));
  // roomy on a tablet (2026-11-23, the owner: "we could probably make it wider/bigger too"): 740 wide (never past the screen less 32) and the panel's own wide layout
  const box = await p.evaluate(() => { const sh = __mc.deep(document, '.hkd .sheet')[0].getBoundingClientRect();
    return { w: Math.round(sh.width), h: Math.round(sh.height), wide: __mc.panel().hasAttribute('wide') }; });
  if (W >= 1000) assert.ok(box.w > 520 && box.wide && box.h > 680, 'the music sheet is roomy on a tablet: ' + JSON.stringify(box));
  // (the screensaver's own panel draws its background blurred, and that is the saver check's; the sheet takes none behind it -- hk-media-npsheet.js)
  assert.deepEqual(t.errors, [], 'page errors');
  say('the music sheet from the cover: Browse, Queue and Speakers, covers and whole names in Browse');
  if (input.shots) { fs.mkdirSync(input.shots, { recursive: true }); await p.screenshot({ path: input.shots + '/media-card-pane-' + input.engine + '-' + input.size + '.png' }); }
  await t.ctx.close();
}

// ---- THE EDITOR: every card of a block with rules can be set
const RULE = { all: [{ kind: 'after_sunset' }] };
async function editor(browser) {
  const { p, ctx, errors } = await page(browser, '/settings#/screens/' + input.screen + '/home-grid');
  await p.waitForFunction(() => { const e = document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor'); return !!e?.previewView?.isConnected; }, null,
    { timeout: 30000 });
  await p.evaluate(() => {
    window.ed = document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor');
    window.row = (label) => [...ed.sidebar.querySelectorAll('.cell')].find(e => e.querySelector('.t')?.textContent === label);
    window.labels = (group) => { const g = [...ed.sidebar.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent === group); return g ?
      [...g.parentElement.querySelectorAll('.cell .t')].map(t => t.textContent) : []; };
    window.head = () => ed.sidebar.querySelector('.insp-head h2').textContent;
    window.shownCard = (id) => { const c = ed.previewView.cards.find(c => c.localName === 'hk-grid-conditional-card' && c._config.item.id === id); return c && c._child && c._child.localName; };
  });
  // with the mouse, as the owner does: the block opens on the card on screen (Now Playing: the preview's speakers play)
  await p.waitForFunction(() => shownCard('cond') === 'hk-now-playing-card', null, { timeout: 20000 });
  const b = await p.evaluate(() => { const r = ed.overlay.querySelector('[data-id=cond]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(b.x, b.y);
  await p.waitForFunction(() => ed.selected === 'cond' && !!ed.sidebar.querySelector('.insp-head'), null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => head()), 'Now Playing');
  assert.equal(await p.evaluate(() => row('Settings For').querySelector('select').value), '0');
  assert.ok(await p.evaluate(() => !!row('Background')), 'Now Playing\'s Background is offered');
  // Card: in the rule (what is stored), and the preview draws the block on the look's own plate
  await p.evaluate(() => [...row('Background').querySelectorAll('button')].find(x => x.textContent === 'Card').click());
  assert.deepEqual(await p.evaluate(() => { const i = ed.grid.items.find(x => x.id === 'cond'); return [i.rules[0].opts.background, (i.opts || {}).background || null]; }), ['card', null]);
  await p.waitForFunction(() => { const c = ed.previewView.cards.find(c => c.localName === 'hk-grid-conditional-card' && c._config.item.id === 'cond');
    return c?._child?.shadowRoot?.querySelector('hk-plate.kit.npcard'); }, null, { timeout: 15000 });
  // Blurred Album takes the key away again, and back to Card
  await p.evaluate(() => [...row('Background').querySelectorAll('button')].find(x => x.textContent === 'Blurred Album').click());
  assert.equal(await p.evaluate(() => 'background' in (ed.grid.items.find(x => x.id === 'cond').rules[0].opts || {})), false, 'the default is saved as nothing');
  await p.evaluate(() => [...row('Background').querySelectorAll('button')].find(x => x.textContent === 'Card').click());
  // the block's own card: Settings For, its options and its preview
  await p.evaluate(() => { const s = row('Settings For').querySelector('select'); s.value = '-1'; s.dispatchEvent(new Event('change')); });
  assert.equal(await p.evaluate(() => head()), 'Music');
  assert.ok(await p.evaluate(() => !!row('Shows') && !row('Background')), 'Music\'s own options');
  await p.waitForFunction(() => shownCard('cond') !== 'hk-now-playing-card', null, { timeout: 15000 });
  assert.equal(await p.evaluate(() => ed.conditionPreview), -1, 'the preview follows');
  // another block: a rule's Sky Background, and its rule's Edit button
  await p.evaluate(() => ed.select('cond2'));
  await p.evaluate(() => [...ed.sidebar.querySelectorAll('button')].find(x => x.textContent === 'Edit Weather Settings').click());
  assert.equal(await p.evaluate(() => head()), 'Weather');
  await p.evaluate(() => row('Sky Background').querySelector('button, input').click());
  assert.equal(await p.evaluate(() => ed.grid.items.find(x => x.id === 'cond2').rules[0].opts.sky), true);
  // removing the rule being set falls back to the block's own card (Undo puts it back)
  await p.evaluate(() => [...ed.sidebar.querySelectorAll('button')].find(x => x.textContent === 'Remove Rule').click());
  assert.equal(await p.evaluate(() => head()), 'Clock');
  await p.evaluate(() => ed.undo());
  // EVERY CARD AS A RULE offers what it offers as a block's own (the two compared in the same place)
  const compare = await p.evaluate(async (when) => {
    const G = ed.iframe.contentWindow.hkGridCatalog, out = [];
    const before = JSON.parse(JSON.stringify(ed.grid));
    for (const key of Object.keys(G.table()).filter(k => G.table()[k].sizes.includes('W'))) {
      ed.select('music');
      ed.update('music', { card: key, opts: null, pages: null, rules: null });
      const own = window.labels('CONTENT').length ? window.labels('CONTENT') : window.labels('Content');
      ed.update('music', { card: 'music', rules: [{ when, card: key }] });
      ed.editing = 0; ed.side();
      const asRule = window.labels('CONTENT').length ? window.labels('CONTENT') : window.labels('Content');
      out.push([key, own.join('|'), asRule.join('|'), head() === ed.constructor.name ? '' : head()]);
    }
    ed.change(before); ed.select(null);
    return out;
  }, RULE);
  assert.ok(compare.length >= 12, 'cards compared: ' + compare.length);
  for (const [key, own, asRule] of compare) { assert.ok(own.length > 0, key + ' has its rows'); assert.equal(asRule, own, key + ' as a rule offers what it offers as a block'); }
  // Save: hk_core takes it (the script reads what was stored), and the screen draws it
  await p.waitForFunction(() => ed.grid.items.find(x => x.id === 'cond').rules[0].opts.background === 'card');
  await p.evaluate(() => ed.save());
  await p.waitForFunction(() => !ed.isConnected, null, { timeout: 15000 });
  assert.deepEqual(errors, [], 'page errors');
  say('Settings For sets each card of a block with rules; ' + compare.length + ' cards offer the same rows as a rule; Save accepted');
  await ctx.close();
  const after = await home(browser);
  // the rule's Card, saved, is what the screen draws
  await after.p.waitForFunction(() => __mc.np('cond').shadowRoot.querySelector('hk-plate.kit.npcard'), null, { timeout: 15000 });
  await after.ctx.close();
}

// ---- --pixels: the page held for real frames; the script takes them (a window it can capture)
async function hold(browser) {
  const { p } = await home(browser);
  await p.waitForFunction(() => ['album', 'cond'].every(id => { const i = __mc.np(id).shadowRoot.querySelector('.npc img'); return !!(i && i.complete && i.naturalWidth > 0); }), null,
    { timeout: 20000 });
  await p.evaluate(() => { __mc.watch('album'); __mc.watch('cond'); });
  await p.waitForTimeout(1500);
  const now = () => p.evaluate(() => Object.fromEntries(['album', 'cond'].map(id => [id, { ...__mc.now(id), renders: window.__mcw[id].renders, same: __mc.watched(id).same }])));
  const r = await p.evaluate(() => Object.fromEntries(['album', 'cond'].map(id => [id, { tile: __mc.rect(__mc.cell(id)), moving: __mc.rect(__mc.np(id).shadowRoot.querySelector('.npp')) }])));
  const play = await p.evaluate(() => __mc.rect(__mc.np('cond').shadowRoot.querySelector('[data-np=pp]')));
  console.log(JSON.stringify({ rects: r, now: await now() }));
  // a pointer going over the transport now and again (the second recording), until the script has its frames
  const end = Date.now() + (input.seconds - 12) * 1000; let k = 0;
  while (Date.now() < end) {
    await p.waitForTimeout(1200); k++;
    await p.mouse.move(play.x + play.w / 2 + (k % 2 ? 0 : 60), play.y + play.h / 2);
    if (k === 10) console.log(JSON.stringify({ now: await now() }));
  }
}

(async () => {
  const browser = await pw[input.engine].launch({ headless: input.mode !== 'hold' });
  try {
    if (input.mode === 'hold') { await hold(browser); return; }
    if (input.mode === 'light') { await background(browser); return; }
    if (input.mode === 'pane') { await pane(browser); return; }
    await flicker(browser);
    await background(browser);
    // (the Home Grid editor is desktop-first: a window this narrow gets its note instead)
    if (W >= 1180) await editor(browser);
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAIL ' + TAG + ': ' + (e && e.stack || e)); process.exit(1); });
