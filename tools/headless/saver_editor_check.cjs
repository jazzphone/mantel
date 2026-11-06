// saver_editor_check.py's browser half: the Screensaver editor in WebKit, a finger's (touch) window at a wall tablet's size.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok ? '' : '  got ' + JSON.stringify(got))); };
  try {
    const [W, H] = input.size;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
    await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
    await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
    const shot = async (name) => { if (input.shots) await page.screenshot({ path: input.shots + '/' + name + '.png' }); };
    // the editor, found through the shadow roots
    const E = (fn, arg) => page.evaluate(`(() => {
      const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
      const ed = deep(document, 'hk-saver-editor')[0]; if (!ed || !ed.ui) return null;
      const sr = ed.shadowRoot, $ = (s) => sr.querySelector(s), $$ = (s) => [...sr.querySelectorAll(s)];
      return (${fn})(ed, sr, $, $$, ${JSON.stringify(arg === undefined ? null : arg)});
    })()`);
    const until = async (fn, arg, ms = 30000) => { let v; for (let t = 0; t < ms; t += 200) { v = await E(fn, arg); if (v) return v; await page.waitForTimeout(200); } return v; };
    const text = (s) => String(s || '').replace(/\s+/g, ' ').trim();

    await page.goto(input.origin + '/settings#/screens/' + input.screen + '/screensaver/editor');
    const up = await until((ed, sr, $, $$) => $$('.lk').length > 0 && $('.ov') && ed.looksHost, null, 40000);
    say(!!up, 'the editor opens, with its Looks', up);
    const gallery = await E((ed,sr,$,$$) => ({ visible: !!ed.galleryEl, count: $$('.catalog .design-card').length }));
    say(gallery && gallery.visible && gallery.count === 44, 'the gallery opens with all current Looks and faces plus new designs', gallery);
    await shot('00-gallery');
    await E((ed,sr,$) => { $('.design-gallery header .customize').click(); return true; });
    // the screensaver inside the frame has drawn its plan
    await until((ed) => { const s = ed.saver(); return s && s.layoutInfo && s.layoutInfo() && ed.live; }, null, 40000);
    await page.waitForTimeout(4000);

    // ---- the Looks
    const looks = await E((ed, sr, $, $$) => ({ n: $$('.lk').length, names: $$('.lk b').map((b) => b.textContent), on: $$('.lk[aria-pressed=true] b').map((b) => b.textContent),
                                                  thumbs: $$('.lk .th .sthumb').length }));
    say(looks.n === 10 && looks.names.join() === 'Photo Frame,Lock Screen,Forecast,Big Weather,Planted,Clock,Glance,Month,Day,Nightstand', 'ten Looks, in order', looks);
    say(looks.on.join() === 'Lock Screen', 'the screen\'s own Look is the one marked (Lock Screen)', looks.on);
    say(looks.thumbs >= 8, 'each Look is shown as its picture', looks.thumbs);
    await shot('01-looks');

    // ---- four sections in order
    const secs = await E((ed, sr, $, $$) => $$('aside.sidebar .sec h2').map((h) => h.textContent));
    say(secs.join() === 'Look,Info,Slides,Timing', 'the four sections, in order', secs);
    const words = await E((ed, sr, $, $$) => $('aside.sidebar').textContent);
    say(!/\bLayout\b/.test(words) && !/Mantel/.test(words), 'no "Layout" and no "Mantel" in the visible words', words.match(/.{20}\b(Layout|Mantel)\b.{10}/));
    const rowsLook = await E((ed, sr, $, $$) => $$('aside.sidebar .lbl .t').map((t) => t.textContent));
    say(['Background', 'Big', 'Face', 'Size', 'Position', 'Align', 'Depth', 'Shadow', 'Outline'].every((x) => rowsLook.includes(x)), 'the Landscape\'s Look section: Background, Big, Face, Size, Position, Align, Depth, Legibility', rowsLook);
    say(!rowsLook.includes('Darken') && !rowsLook.includes('Motion'), '...and no row that does nothing here (no Darken, no Motion)', rowsLook);
    const scrollTo = (n) => E((ed, sr, $, $$, n) => { const sb = $('aside.sidebar'), h = $$('aside.sidebar .sec')[n]; sb.scrollTop += h.getBoundingClientRect().top - sb.getBoundingClientRect().top - 4; return true; }, n);
    await scrollTo(0); await page.waitForTimeout(400); await shot('02-look');
    await scrollTo(1); await page.waitForTimeout(400); await shot('03-info');
    await scrollTo(2); await page.waitForTimeout(400); await shot('04-slides');
    await scrollTo(3); await page.waitForTimeout(400); await shot('05-timing');

    // ---- Info: the placed pieces, Ink, Color Accents, the row's one Size and where the row goes
    const info = await E((ed, sr, $, $$) => ({ rows: $$('.prow').map((r) => r.querySelector('.lbl .t').textContent), ink: !!$('[data-sk]') || true,
                                                 labels: $$('aside.sidebar .lbl .t').map((t) => t.textContent) }));
    say(info.rows.join() === 'Date,Weather,Readings,Timers,House Status,Music', 'Info lists what is placed, in its places\' order', info.rows);
    say(['Ink', 'Color Accents', 'Size', 'The Row Goes', 'Upright Screens'].every((x) => info.labels.includes(x)), 'Info: Ink, Color Accents, the row\'s Size and Where, Upright Screens', info.labels);

    // ---- a Look changes the Look only
    const keep = await E((ed) => JSON.stringify(ed.opts.layout.zones));
    await E((ed, sr, $, $$) => { $$('.lk').find((b) => b.querySelector('b').textContent === 'Month').click(); return true; });
    await page.waitForTimeout(600);
    const month = await E((ed, sr, $, $$) => ({ zones: JSON.stringify(ed.opts.layout.zones), show: ed.opts.show, big: ed.opts.layout.big, msg: ed.message.textContent,
                                                chips: $$('.prow .chip.warn').map((c) => c.textContent), on: $$('.lk[aria-pressed=true] b').map((b) => b.textContent) }));
    // (Month's page draws its own words: its Look leaves the big element to the face -- 'none')
    say(month.zones === keep && month.show === 'month' && month.big.kind === 'none', 'Month changes the background and the big element, and keeps every piece', month);
    say(month.on.join() === 'Month', '...and is the Look marked', month.on);
    say(/Month/.test(month.msg) && /stayed/.test(month.msg) && /wait/.test(month.msg), '...the message says what stayed and what waits', month.msg);
    say(month.chips.length >= 5 && month.chips.every((c) => /^Waits: Month has no (row|line)$/.test(c)), '...the pieces with no place wait in Info', month.chips);
    await scrollTo(1); await page.waitForTimeout(300); await shot('06-month-waits');
    // the selected Look again opens its page, with Start Over
    await E((ed, sr, $, $$) => { $$('.lk').find((b) => b.querySelector('b').textContent === 'Month').click(); return true; });
    await page.waitForTimeout(400);
    const lp = await E((ed, sr, $, $$) => ({ h: $('.insp-head h2').textContent, so: $$('aside.sidebar button').map((b) => b.textContent).filter((t) => /Start Over/.test(t)) }));
    say(lp && lp.h === 'Month' && lp.so.length === 1, 'tapping the selected Look opens its page, with Start Over from This Look', lp);
    // Start Over: an in-page confirmation, then the Look's own pieces
    await E((ed, sr, $, $$) => { $$('aside.sidebar button').find((b) => /Start Over/.test(b.textContent)).click(); return true; });
    await page.waitForTimeout(400);
    const dlg = await E((ed, sr, $) => { const d = $('.dlg'); return d ? d.textContent : null; });
    say(!!dlg && /Start Over/.test(dlg), 'Start Over asks first, in the page', dlg);
    await E((ed, sr, $) => { $('.dlg .db button.red, .dlg .db button.bold:not(.cx)').click(); return true; });
    await page.waitForTimeout(600);
    const so = await E((ed) => ({ zones: Object.keys(ed.opts.layout.zones).filter((z) => ed.opts.layout.zones[z].length).map((z) => z + ':' + ed.opts.layout.zones[z].map((w) => w.piece + '.' + w.shape).join('+')) }));
    say(so.zones.join() === 'bl:music.card,br:status.inline', 'Start Over from Month puts back Month\'s own pieces', so);
    await E((ed) => { ed.undo(); ed.undo(); ed.select(null); return true; });          // (back to the Lock Screen, the layout it had)
    await page.waitForTimeout(500);
    const back = await E((ed) => JSON.stringify(ed.opts.layout.zones));
    say(back === keep, 'Undo puts back what was placed', null);

    // ---- the Looks on a background that gains and loses rows
    await E((ed, sr, $, $$) => { $$('.lk').find((b) => b.querySelector('b').textContent === 'Photo Frame').click(); return true; });
    await page.waitForTimeout(500);
    const photo = await E((ed, sr, $, $$) => ({ rows: $$('aside.sidebar .lbl .t').map((t) => t.textContent), depth: ed.opts.layout.big.depth }));
    say(photo.rows.includes('Darken') && photo.rows.includes('Shadow') && photo.rows.includes('Depth') && photo.depth === 'behind', 'Photos: Darken, Depth (Behind) and Legibility', photo);
    await E((ed, sr, $, $$) => { $$('.lk').find((b) => b.querySelector('b').textContent === 'Clock').click(); return true; });
    await page.waitForTimeout(500);
    const clock = await E((ed, sr, $, $$) => ({ rows: $$('aside.sidebar .lbl .t').map((t) => t.textContent), why: $$('aside.sidebar .cell').filter((c) => /Behind needs Photos/.test(c.textContent)).length,
                                                depth: ed.opts.layout.big.depth }));
    say(clock.rows.includes('Pattern') && clock.rows.includes('Motion') && !clock.rows.includes('Shadow') && clock.why === 1 && clock.depth === 'front',
        'Moving Color: Pattern, Speed and Motion; no Legibility; Depth says why Behind isn\'t possible', clock);
    await E((ed, sr, $, $$) => { $$('.lk').find((b) => b.querySelector('b').textContent === 'Planted').click(); return true; });
    await page.waitForTimeout(500);
    const planted = await E((ed) => ({ face: ed.opts.clock_style, show: ed.opts.show, pos: ed.opts.layout.big.pos }));
    say(planted.face === 'planted' && planted.show === 'forecast' && planted.pos === 'ground', 'Planted is the Planted face on the Landscape', planted);
    await E((ed, sr, $, $$) => { $$('.lk').find((b) => b.querySelector('b').textContent === 'Lock Screen').click(); return true; });
    await page.waitForTimeout(500);
    say((await E((ed) => ed.opts.clock_style)) === 'classic', 'a Look without Planted takes the Planted face away', null);

    // ---- the library: grouped, searched, one entry per piece, from the glance catalog
    await E((ed) => { ed.q = ''; ed.search.value = ''; ed.pieces(); return true; });
    const lib = await E((ed, sr, $, $$) => ({ groups: $$('.pieces .gh').map((g) => g.textContent), n: $$('.pitem').length, names: $$('.pitem b').map((b) => b.textContent), samples: $$('.pitem .pv .hksw').length,
                                               pieces: Object.keys(window.hkSaverLayout.PIECES).length }));
    say(lib.groups.slice(0, 6).join() === 'Time and Calendar,Weather and Sky,Home,People and Travel,Energy,Media and Photos', 'the library is grouped as the glance catalog is', lib.groups);
    say(lib.n === lib.pieces && new Set(lib.names).size === lib.n, 'one entry per piece (' + lib.n + ')', lib);
    say(lib.samples >= lib.n - 2, 'each drawn from its sample', lib.samples);
    await E((ed, sr, $) => { $('.palette').scrollTop = $('.palette').scrollHeight / 3; return true; });
    await shot('07-library');
    await E((ed) => { ed.search.value = 'sensor'; ed.q = 'sensor'; ed.pieces(); return true; });
    const found = await E((ed, sr, $, $$) => $$('.pitem b').map((b) => b.textContent));
    say(found.includes('Any Sensor') && found.length < 10, 'the search finds Any Sensor', found);
    await E((ed) => { ed.search.value = ''; ed.q = ''; ed.pieces(); ed.palette.scrollTop = 0; return true; });

    // ---- a piece from the library, then a green place
    await E((ed, sr, $) => { $('.pitem[data-piece=moon]').click(); return true; });
    await page.waitForTimeout(400);
    const green = await E((ed, sr, $, $$) => $$('.ov .z.want').length);
    say(green > 0, 'a picked piece lights the green places it fits (' + green + ')', green);
    await shot('08-picked');
    const before = await E((ed) => ed.placed().length);
    await E((ed, sr, $) => { $('.ov .z.want').click(); return true; });
    await page.waitForTimeout(600);
    const added = await E((ed) => ({ n: ed.placed().length, sel: ed.sel, last: ed.placed().filter((p) => p.w.piece === 'moon').map((p) => p.z + '.' + p.w.shape) }));
    say(added.n === before + 1 && added.last.length === 1, 'the piece went into the green place (' + added.last + ') in the first shape that place takes', added);

    // ---- a piece's page
    const pg = await E((ed, sr, $, $$) => ({ head: $('.insp-head h2').textContent, tiles: $$('.shtile').map((t) => t.querySelector('b').textContent), drawn: $$('.shtile .hksw').length,
                                              labels: $$('aside.sidebar .lbl .t').map((t) => t.textContent), pressed: $$('.shtile[aria-checked=true] b').map((b) => b.textContent) }));
    say(pg.head === 'Moon' && pg.tiles.join() === 'Inline,Circular' && pg.drawn === 2, 'the piece\'s page: its shapes as tiles, each drawn', pg);
    say(['Backdrop', 'Color', 'Show'].every((x) => pg.labels.includes(x)) && (pg.labels.includes('Where') || pg.labels.includes('The Row Goes')) && (pg.labels.includes('Size') || pg.labels.includes('Its Own Size')), '...Size, Backdrop, Color, Show and Where', pg.labels);
    // a shape this place can't take moves it to the nearest place that can
    await E((ed, sr, $, $$) => { $$('.shtile').find((t) => t.querySelector('b').textContent === 'Inline').click(); return true; });
    await page.waitForTimeout(500);
    const moved = await E((ed) => ({ sel: ed.sel, msg: ed.message.textContent, w: ed.placed().filter((p) => p.w.piece === 'moon').map((p) => p.z + '.' + p.w.shape) }));
    say(moved.w.join() !== 'row.circular' && /moved/.test(moved.msg) && /inline/i.test(moved.w.join()), 'a shape the place can\'t take moves the piece, and says so', moved);
    await shot('09-piece');
    // Its Own Size is the row's: Weather is in the row
    await E((ed) => { ed.select('row:0'); return true; });
    await page.waitForTimeout(400);
    const own = await E((ed, sr, $, $$) => $$('aside.sidebar .lbl .t').map((t) => t.textContent));
    say(own.includes('Its Own Size') && !own.includes('Size'), 'in the row: Its Own Size (off: the row\'s size)', own);
    await E((ed, sr, $, $$) => { $$('aside.sidebar .cell').find((c) => /Its Own Size/.test(c.textContent)).querySelector('.sw').click(); return true; });
    await page.waitForTimeout(500);
    const own2 = await E((ed, sr, $, $$) => ({ size: ed.T().zones.row[0].size, labels: $$('aside.sidebar .lbl .t').map((t) => t.textContent) }));
    say(own2.size === 100 && own2.labels.includes('Size'), '...on: its Size appears (60 to 200)', own2);
    await E((ed) => { ed.undo(); return true; });
    // options: Readings' reading is a choice
    await E((ed) => { ed.select('row:1'); return true; });
    await page.waitForTimeout(400);
    const ro = await E((ed, sr, $, $$) => ({ labels: $$('aside.sidebar .lbl .t').map((t) => t.textContent), on: $$('aside.sidebar .seg [aria-checked=true]').map((b) => b.textContent) }));
    say(ro.labels.includes('Reading') && ro.on.includes('AQI'), 'Readings: its Reading is a choice, set to AQI', ro);

    // ---- Any Sensor: an entity picker, Show When
    await E((ed, sr, $) => { $('.pitem[data-piece=sensor]').click(); return true; });
    await E((ed, sr, $) => { $('.ov .z.want').click(); return true; });
    await page.waitForTimeout(600);
    const sensor = await E((ed, sr, $, $$) => ({ head: $('.insp-head h2').textContent, labels: $$('aside.sidebar .lbl .t').map((t) => t.textContent) }));
    say(sensor.head === 'Any Sensor' && ['Entity', 'Name', 'Show'].every((x) => sensor.labels.includes(x)), 'Any Sensor: Entity and Name options, Show', sensor);
    await E((ed, sr, $, $$) => { $$('aside.sidebar .cell').find((c) => c.querySelector('.t') && c.querySelector('.t').textContent === 'Entity').click(); return true; });
    await page.waitForTimeout(500);
    const pk = await E((ed, sr, $, $$) => ({ title: $('.insp-head h2').textContent, n: $$('.pk-list .cell').length, first: $$('.pk-list .cell .t').slice(0, 3).map((t) => t.textContent) }));
    say(pk.title === 'Entity' && pk.n > 3, 'the entity picker lists the house\'s entities', pk);
    await shot('10-entity-picker');
    const pick = await E((ed, sr, $, $$) => { const c = $$('.pk-list .cell').find((x) => /sensor\./.test(x.textContent)); const id = c && c.querySelector('small').textContent; c.click(); return id; });
    await page.waitForTimeout(500);
    const chosen = await E((ed) => ed.placed().filter((p) => p.w.piece === 'sensor').map((p) => p.w.opts && p.w.opts.entity));
    say(!!pick && chosen[0] === pick, 'picking one sets the piece\'s entity (' + pick + ')', chosen);
    // Show: When…
    await E((ed, sr, $, $$) => { $$('aside.sidebar .seg button').find((b) => b.textContent === 'When…').click(); return true; });
    await page.waitForTimeout(400);
    const wh = await E((ed, sr, $, $$) => ({ labels: $$('aside.sidebar .lbl .t').map((t) => t.textContent), ops: $$('aside.sidebar [role=radio]').map((b) => b.textContent).filter((t) => /^Is/.test(t)) }));
    say(['Entity', 'Condition', 'Value'].every((x) => wh.labels.includes(x)) && wh.ops.join() === 'Is,Is Not,Is Above,Is Below', 'Show When…: an entity, is / is not / is above / is below, a value', wh);
    await E((ed, sr, $, $$) => { $$('aside.sidebar .cell').filter((c) => c.querySelector('.t') && c.querySelector('.t').textContent === 'Entity')[1].click(); return true; });
    await page.waitForTimeout(400);
    await E((ed, sr, $, $$) => { $$('.pk-list .cell').find((x) => /light\./.test(x.textContent)).click(); return true; });
    await page.waitForTimeout(400);
    await E((ed, sr, $) => { const t = [...sr.querySelectorAll('aside.sidebar input.tx')].pop(); t.value = 'on'; t.dispatchEvent(new Event('blur')); return true; });
    await page.waitForTimeout(500);
    const show = await E((ed, sr, $, $$) => ({ show: ed.placed().filter((p) => p.w.piece === 'sensor')[0].w.show, foot: $$('aside.sidebar .gf').map((g) => g.textContent).filter((t) => /Shows when/.test(t)) }));
    say(!!show.show && show.show.op === 'is' && show.show.value === 'on' && show.foot.length === 1, 'the condition is written as { entity, op, value } and the page says it', show);
    await shot('11-show-when');


    // ---- Info's own rows: Ink, Color Accents, the row's one Size, where the row goes
    await E((ed) => { ed.select(null); return true; });
    await page.waitForTimeout(300);
    await E((ed, sr, $, $$) => { $$('aside.sidebar [role=radio]').find((b) => b.textContent === 'Black').click(); return true; });
    await page.waitForTimeout(300);
    await E((ed, sr, $, $$) => { $$('aside.sidebar .cell').find((c) => /Color Accents/.test(c.textContent)).querySelector('.sw').click(); return true; });
    await page.waitForTimeout(300);
    await E((ed, sr, $, $$) => { const r = $$('aside.sidebar .cell.slider').find((c) => /One size for the whole row/.test(c.textContent)).querySelector('input'); r.value = '80'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); return true; });
    await page.waitForTimeout(300);
    await E((ed, sr, $, $$) => { $$('aside.sidebar [role=radio]').find((b) => b.textContent === 'Along the Bottom').click(); return true; });
    await page.waitForTimeout(500);
    const inkL = await E((ed) => ({ ink: ed.opts.layout.ink, acc: ed.opts.layout.accents, rs: ed.opts.layout.row_size, at: ed.opts.layout.row_at }));
    say(inkL.ink === 'black' && inkL.acc === false && inkL.rs === 80 && inkL.at === 'bottom', 'Ink, Color Accents, the row\'s Size and where the row goes are written to the screen', inkL);
    await E((ed) => { ed.undo(); ed.undo(); ed.undo(); ed.undo(); return true; });

    // ---- the Look's own rows: a Background picked from the grid, a Face
    await E((ed, sr, $, $$) => { $$('aside.sidebar button.pvrow').find((b) => /Background/.test(b.textContent)).click(); return true; });
    await page.waitForTimeout(500);
    const bgs = await E((ed, sr, $, $$) => $$('aside.sidebar .pvgrid button .pvcap').map((c) => c.textContent));
    say(bgs.length === 11 && bgs[0] === 'Photos', 'Background: the eleven, each as a picture', bgs);
    await E((ed, sr, $, $$) => { $$('aside.sidebar .pvgrid button').find((b) => /Moving Color/.test(b.textContent)).click(); return true; });
    await page.waitForTimeout(500);
    const mc = await E((ed, sr, $, $$) => ({ show: ed.opts.show, bg: ed.opts.clock_bg, depth: ed.opts.layout.big.depth, rows: $$('aside.sidebar .lbl .t').map((t) => t.textContent) }));
    say(mc.show === 'clock' && mc.bg === 'aurora' && mc.depth === 'front' && mc.rows.includes('Motion') && mc.rows.includes('Position'), 'Moving Color picked: Behind gives way to In Front; Motion appears', mc);
    await E((ed, sr, $, $$) => { $$('aside.sidebar button.pvrow').find((b) => /Face/.test(b.textContent)).click(); return true; });
    await page.waitForTimeout(800);
    const faces = await E((ed, sr, $, $$) => $$('aside.sidebar .pvgrid button .pvcap').map((c) => c.textContent));
    say(faces.includes('Neon') && !faces.includes('Planted'), 'Face: every face, Planted only on the Landscape', faces);
    await E((ed, sr, $, $$) => { $$('aside.sidebar .pvgrid button').find((b) => /Neon/.test(b.textContent)).click(); return true; });
    await page.waitForTimeout(400);
    say((await E((ed) => ed.opts.clock_style)) === 'neon', 'a Face picked is the screen\'s clock_style', null);
    await E((ed) => { ed.undo(); ed.undo(); return true; });
    await page.waitForTimeout(300);

    // ---- a place tapped with nothing picked: what fits there, by group
    await E((ed, sr, $) => { $('.ov .z[data-zone=tl]').click(); return true; });
    await page.waitForTimeout(500);
    const zp = await E((ed, sr, $, $$) => ({ head: $('.insp-head h2').textContent, groups: $$('aside.sidebar .gh').map((g) => g.textContent), n: $$('aside.sidebar button.cell').length }));
    say(zp.head === 'Top Left' && zp.groups.includes('Weather and Sky') && zp.n > 30, 'a place tapped: the pieces that fit it, by group', zp);
    await E((ed) => { ed.select(null); return true; });

    // ---- a suggested default, named: Phone Alarm with a next-alarm sensor in the house
    await E((ed) => { ed.states()['sensor.pixel_next_alarm'] = { entity_id: 'sensor.pixel_next_alarm', state: '2026-11-03T06:30:00+00:00', attributes: { friendly_name: 'Pixel Next Alarm', device_class: 'timestamp' } }; return true; });
    await E((ed, sr, $) => { $('.pitem[data-piece=alarm]').click(); return true; });
    await E((ed, sr, $) => { $('.ov .z.want').click(); return true; });
    await page.waitForTimeout(600);
    const sg = await E((ed, sr, $, $$) => ({ head: $('.insp-head h2').textContent, vals: $$('aside.sidebar .cell .val').map((v) => v.textContent) }));
    say(sg.head === 'Phone Alarm' && sg.vals.includes('Suggested: Pixel Next Alarm'), 'an entity option names the suggested default: "Suggested: Pixel Next Alarm"', sg);
    await E((ed) => { ed.undo(); return true; });

    // ---- dragged with a mouse: from the library to a green place, and one piece on the screen to another place
    const box = async (sel) => page.evaluate((sel) => { const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
      const ed = deep(document, 'hk-saver-editor')[0], e = ed.shadowRoot.querySelector(sel); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
    const n0 = await E((ed) => ed.placed().length);
    await E((ed) => { ed.palette.scrollTop = 0; ed.q = 'Wind'; ed.search.value = 'Wind'; ed.pieces(); return true; });
    const from = await box('.pitem[data-piece=wind]');
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
    await page.waitForTimeout(300);
    const to = await box('.ov .z.want.plus, .ov .z.want');
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(600);
    const dr = await E((ed) => ({ n: ed.placed().length, w: ed.placed().filter((p) => p.w.piece === 'wind').map((p) => p.z) }));
    say(dr.n === n0 + 1 && dr.w.length === 1, 'dragged from the library onto a green place (' + dr.w + ')', dr);
    await E((ed) => { ed.undo(); ed.q = ''; ed.search.value = ''; ed.pieces(); ed.select(null); return true; });

    // ---- Upright Screens: Its Own, and the editor shows the upright screen
    await E((ed, sr, $, $$) => { $$('aside.sidebar [role=radio]').find((b) => b.textContent === 'Its Own').click(); return true; });
    await page.waitForTimeout(800);
    const upr = await E((ed) => ({ own: !!(ed.opts.layout.upright && ed.opts.layout.upright.zones), device: ed.device }));
    say(upr.own && upr.device === 1, 'Upright Screens: Its Own copies the sideways screen and shows iPad Upright', upr);
    await shot('14-upright');
    const upSave = await E((ed) => { const L = window.hkSaverLayout; return L.check(JSON.parse(JSON.stringify(ed.opts.layout))); });
    say(upSave === null, '...and the draft passes the write\'s check', upSave);
    await E((ed) => { ed.undo(); ed.device = 0; ed.devices(); ed.fit(); ed.redraw(); return true; });
    await page.waitForTimeout(400);

    // ---- See a Slide, Day / Night
    await E((ed) => { ed.select(null); return true; });
    await page.evaluate(() => { const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]); window.__slides = []; const ed = deep(document, 'hk-saver-editor')[0]; const S = ed.saver(); const pre = S.previewSlide, pn = S.previewNight; S.previewSlide = function (k) { window.__slides.push(k); return pre ? pre.apply(this, arguments) : undefined; }; S.previewNight = function (o) { window.__slides.push('night:' + o); return pn ? pn.apply(this, arguments) : undefined; }; });
    await E((ed, sr, $, $$) => { const s = $('.seeslide select'); s.value = 'music'; s.dispatchEvent(new Event('change')); return true; });
    await page.waitForTimeout(600);
    const sl = await E((ed, sr, $) => ({ under: $('.under').textContent, slide: ed.slide }));
    say(sl.slide === 'music' && /Music slide/.test(sl.under) && /Its corner adds Time, Date, Weather and House Status/.test(sl.under), 'See a Slide: Music, and the line under the screen says what its corner adds', sl);
    await page.waitForTimeout(3500);
    await shot('12-slide-music');
    await E((ed, sr, $, $$) => { $$('.pills button').find((b) => b.textContent === 'Night').click(); return true; });
    await page.waitForTimeout(400);
    const calls = await page.evaluate(() => window.__slides);
    say(calls.includes('music') && calls.includes('night:true'), 'the preview is asked for the slide and for night (hkSaver.previewSlide / previewNight)', calls);
    await page.waitForTimeout(3500);
    await shot('12-slide-night');
    await E((ed) => { ed.setSlide(''); ed.setNight(false); return true; });
    await page.waitForTimeout(300);

    // ---- Slides: toggles with See It, the Forecast's Classic / Big, How Often
    const slides = await E((ed, sr, $, $$) => ({ labels: $$('aside.sidebar .lbl .t').map((t) => t.textContent), see: $$('.seeit').length, subs: $$('aside.sidebar .lbl small').map((s) => s.textContent).filter((t) => /Its corner adds/.test(t)).length }));
    // (on the Landscape the forecast and the weather are the background: no row for them)
    say(['Music Full Screen', 'Home Energy'].every((x) => slides.labels.includes(x)) && slides.see === 2 && slides.subs === 2, 'Slides on the Landscape: Music and Home Energy, each with its corner and See It', slides);
    await E((ed) => { ed.change((o) => { Object.assign(o, { show: 'photos' }); }); ed.libraryMarks(); return true; });
    await page.waitForTimeout(300);
    const ph = await E((ed, sr, $, $$) => $$('aside.sidebar .lbl .t').map((t) => t.textContent));
    say(ph.includes('The Forecast') && ph.includes('Darken'), 'Photos: the forecast between photos is a slide', ph);
    await E((ed, sr, $, $$) => { $$('aside.sidebar .cell').find((c) => /The Forecast/.test(c.textContent)).querySelector('.sw').click(); return true; });
    await page.waitForTimeout(400);
    const fc = await E((ed, sr, $, $$) => ({ show: ed.opts.show, labels: $$('aside.sidebar .lbl .t').map((t) => t.textContent), seg: $$('aside.sidebar [role=radio]').map((b) => b.textContent).filter((t) => /Classic|Big/.test(t)), often: $$('aside.sidebar .lbl .t').includes && 1 }));
    say(fc.show === 'both' && fc.seg.filter((t) => /^(Classic|Big)$/.test(t)).join() === 'Classic,Big' && fc.labels.includes('How Often'), 'the forecast slide on: The Forecast Classic / Big and How Often', fc);
    await E((ed) => { ed.undo(); ed.undo(); return true; });

    // ---- Reset: an in-page confirmation, back to the screen before the editor
    await E((ed) => { ed.change((o) => { o.layout.zones.tr.push({ piece: 'status', shape: 'inline', back: 'none', color: 'auto' }); }); return true; });
    await E((ed, sr, $, $$) => { $$('aside.sidebar button').find((b) => /Reset…/.test(b.textContent)).click(); return true; });
    await page.waitForTimeout(400);
    const rd = await E((ed, sr, $) => { const d = $('.dlg'); return d ? d.textContent : null; });
    say(!!rd && /Reset/.test(rd), 'Reset asks first, in the page', rd);
    await E((ed, sr, $) => { $('.dlg .db button.red, .dlg .db button.bold:not(.cx)').click(); return true; });
    await page.waitForTimeout(500);
    say((await E((ed) => !ed.dirty())) === true, 'Reset: the screensaver as it was before the editor', null);

    // ---- Save: a v2 layout hk-saverlayout.js takes
    await E((ed) => { ed.change((o) => { o.layout.zones.tr.push({ piece: 'status', shape: 'inline', back: 'none', color: 'auto' }); }); return true; });
    const saved = await page.evaluate(async () => {
      const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
      const ed = deep(document, 'hk-saver-editor')[0]; let got = null;
      ed.panel.saverPutB = () => async (v) => { got = v; };
      ed.o.onSaved = () => {};
      await ed.save();
      const L = window.hkSaverLayout;
      return got && { v: got.layout.v, code: L.check(got.layout), clean: JSON.stringify(L.clean(got.layout)) === JSON.stringify(got.layout), n: ed.message.textContent };
    });
    say(!!saved && saved.v === 2 && saved.code === null && saved.clean, 'Save writes a v2 layout that passes hkSaverLayout.check', saved);

    // ---- the editor at a phone\'s window and sideways: the shapes bar has Phone Sideways
    const dev = await E((ed, sr, $, $$) => $$('.pills')[0].querySelectorAll('button').length ? [...$$('.pills')[0].querySelectorAll('button')].map((b) => b.textContent) : []);
    say(dev.join() === 'Wall Tablet,iPad Upright,Phone,Phone Sideways', 'above the screen: the four shapes', dev);
    await E((ed) => { ed.device = 3; ed.devices(); ed.fit(); ed.redraw(); ed.overlaySoon(); return true; });
    await page.waitForTimeout(3000);
    await shot('13-phone-sideways');
    await E((ed) => { ed.device = 0; ed.devices(); ed.fit(); ed.redraw(); ed.overlaySoon(); return true; });
    await page.waitForTimeout(1500);

    // ---- A CROWDED SCREEN (2026-11-02, the owner: "lots of overlapping elements on screen... hard for the user to
    // determine where to put something"): nothing drawn over the screen meets another -- the empty places, the pieces,
    // the ones another shows, the dotted ones with nothing to show -- with nothing picked, the band picked, and a piece
    // picked (its green places)
    await page.goto(input.origin + '/settings#/screens/' + input.crowd + '/screensaver/editor');
    await until((ed, sr, $, $$) => $$('.lk').length > 0 && $('.ov') && ed.looksHost, null, 40000);
    await E((ed,sr,$) => { if(ed.galleryEl) $('.design-gallery header .customize').click(); return true; });
    await until((ed) => { const s = ed.saver(); return s && s.layoutInfo && s.layoutInfo() && ed.live; }, null, 40000);
    await page.waitForTimeout(4000);
    const clashes = () => E((ed, sr, $, $$) => {
      const bs = $$('.ov .z, .ov .w').filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || '').slice(0, 40), l: r.left, t: r.top, r: r.right, b: r.bottom }; });
      const out = [];
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], b = bs[j]; if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) out.push([a.n, b.n]); }
      return { n: bs.length, out, claimed: $$('.ov .w.claimed').length };
    });
    const c0 = await clashes();
    say(c0.claimed >= 2 && !c0.out.length, 'a crowded screen: nothing on the screen meets anything else (' + c0.n + ' boxes, ' + c0.claimed + ' shown by the face)', c0);
    await shot('15-crowded');
    await E((ed) => { ed.select('bottom:0'); return true; });
    await page.waitForTimeout(800);
    const c1 = await clashes();
    say(!c1.out.length, '...with the band shown by the face picked', c1);
    await shot('16-crowded-band');
    await E((ed) => { ed.select(null); ed.pick = 'wind'; ed.redraw(); return true; });
    await page.waitForTimeout(800);
    const c2 = await clashes();
    say(!c2.out.length, '...with a piece picked, its green places', c2);
    await shot('17-crowded-pick');
    await E((ed) => { ed.pick = null; ed.redraw(); return true; });
    await page.waitForTimeout(500);
    // ---- A DROP GOES WHERE THE DRAGGED PIECE IS (the owner: "the cursor has to be on the box ... not the actual item
    // you are dragging"): let go with the pointer just outside a green place, the piece over it
    const nC = await E((ed) => ed.placed().length);
    await E((ed) => { ed.palette.scrollTop = 0; ed.q = 'Wind'; ed.search.value = 'Wind'; ed.pieces(); return true; });
    const f2 = await box('.pitem[data-piece=wind]');
    await page.mouse.move(f2.x, f2.y); await page.mouse.down(); await page.mouse.move(f2.x + 40, f2.y + 10, { steps: 4 });
    await page.waitForTimeout(300);
    const tgt = await E((ed, sr, $, $$) => { const z = $$('.ov .z.want').map((e) => [e, e.getBoundingClientRect()]).sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height)[0];
      if (!z) return null; const r = z[1]; return { zone: z[0].getAttribute('data-zone'), x: r.left - 12, y: r.top + r.height / 2 }; });
    if (tgt) { await page.mouse.move(tgt.x, tgt.y, { steps: 8 }); await page.waitForTimeout(150); }
    await page.mouse.up();
    await page.waitForTimeout(600);
    const d2 = await E((ed) => ed.placed().filter((p) => p.w.piece === 'wind').map((p) => p.z));
    say(!!tgt && d2.length === 1 && d2[0] === tgt.zone && (await E((ed) => ed.placed().length)) === nC + 1,
        'a drop lands where the dragged piece is, the pointer just outside the place (' + (tgt && tgt.zone) + ')', [tgt, d2]);
    await E((ed) => { ed.undo(); ed.q = ''; ed.search.value = ''; ed.pieces(); return true; });
    say(!errors.length, 'no page errors', errors.slice(0, 4));
    await ctx.close();
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
