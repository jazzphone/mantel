// HOME GRID'S EDITOR SAVES WHAT IT OPENED (panels/hk-grid-editor.js; SET-7,
// Mantel's second audit): the screen's version from panel/get (versions
// ["board/<path>"], Mantel's number or HK Frontend's digest, kept as it came)
// goes with Save and with Copy Layout To (the target's); a `conflict` -- the
// screen changed since -- asks "This screen changed since you opened it":
// Reload (the screen as it is now, the draft discarded) or Save Anyway (sent
// again without the version).
//
// The editor runs for real with its drawing stubbed out; the page is a
// recorder over a fictional screen. Nothing is sent anywhere.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run grideditor');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/modules/hk-drag.js');
load(HK_ROOT + '/frontend/panels/hk-grid-editor.js');

var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
function grid(id) {
  return { v: 1, cols: 6, rows: 4, frame: [1280, 800], band: true, items: [{ id: id, card: 'timers', size: 'S', at: [0, 0] }] };
}
function conflict() { return Object.assign(new Error('board/dashboard-hall changed meanwhile (now version 8)'), { code: 'conflict' }); }

// a page: its data as panel/get gave it, its saves recorded and answered from
// `answers` in turn, its reload the screen as someone else saved it
function page(answers, versions) {
  var pg = { sent: [], reloads: 0, attrs: {} };
  pg.data = { boards: { 'dashboard-hall': { home_style: 'grid', home_grid: grid('a1') }, 'dashboard-den': {} },
              versions: versions || { 'board/dashboard-hall': 7, 'board/dashboard-den': 'den-digest' } };
  pg.actions = function () {
    return { callWS: function (msg) {
      pg.sent.push(JSON.parse(JSON.stringify(msg)));
      var a = answers.shift();
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    } };
  };
  pg.reload = function () {
    pg.reloads++;
    pg.data = { boards: { 'dashboard-hall': { home_style: 'grid', home_grid: grid('theirs') }, 'dashboard-den': {} },
                versions: { 'board/dashboard-hall': 8, 'board/dashboard-den': 'den-digest-2' } };
    return Promise.resolve();
  };
  pg.hasAttribute = function () { return false; };
  return pg;
}
// the editor, configured as hk-settings.js does, its drawing stubbed; the
// alert answers `choice` (true: Save Anyway, false: Reload, null: dismissed)
function editor(pg, choice) {
  var E = customElements.get('hk-grid-editor'), ed = new E(), asked = [], saved = [];
  ed.configure({ panel: pg, path: 'dashboard-hall', board: pg.data.boards['dashboard-hall'], title: 'Hall',
                 onCancel: function () {}, onSaved: function () { saved.push(true); } });
  ed.K = Object.assign({}, window.hkSettingsKit, { confirm: function (root, o) { asked.push(o); return Promise.resolve(typeof choice === 'function' ? choice(o) : choice); } });
  ed.saveButton = {}; ed.undoButton = {}; ed.message = { textContent: '' };
  ['blocks', 'side', 'fit', 'preview'].forEach(function (k) { ed[k] = function () {}; });
  ed.asked = asked; ed.saved = saved;
  return ed;
}
function said(ed) { return ed.message.textContent; }

var steps = [];
function step(f) { steps.push(f); }

step(function () {                      // a plain save: the version it opened goes with it
  var pg = page([{ board: { home_style: 'grid' }, version: 9 }]), ed = editor(pg, true);
  ed.change(grid('mine'));
  return ed.save().then(function () {
    ok('Save sends the version it opened', pg.sent[0].expect_version, 7);
    ok('...for its own screen, with the layout', [pg.sent[0].type, pg.sent[0].dashboard, pg.sent[0].changes.home_grid.items[0].id],
       ['hk_frontend/board/set', 'dashboard-hall', 'mine']);
    ok('...and keeps the new version the answer gave', pg.data.versions['board/dashboard-hall'], 9);
    ok('...no alert, and it is saved', [ed.asked.length, ed.saved.length], [0, 1]);
  });
});

step(function () {                      // HK Frontend's digest, kept as it came
  var pg = page([{ board: {}, version: 'b2' }], { 'board/dashboard-hall': 'a1b2c3' }), ed = editor(pg, true);
  ed.change(grid('mine'));
  return ed.save().then(function () { ok('a text version is sent as it came', pg.sent[0].expect_version, 'a1b2c3'); });
});

step(function () {                      // an older host with no versions: sent as before
  var pg = page([{ board: {} }], {}), ed = editor(pg, true);
  ed.change(grid('mine'));
  return ed.save().then(function () { ok('no version known: none sent', 'expect_version' in pg.sent[0], false); });
});

step(function () {                      // conflict -> Save Anyway
  var pg = page([conflict(), { board: { home_style: 'grid' }, version: 10 }]), ed = editor(pg, true);
  ed.change(grid('mine'));
  return ed.save().then(function () {
    ok('a conflict asks', ed.asked.length, 1);
    ok('...in the screen\'s words', ed.asked[0] && ed.asked[0].message.indexOf('This screen changed since you opened it') === 0, true);
    ok('...offering Reload and Save Anyway', ed.asked[0] && [ed.asked[0].cancel, ed.asked[0].ok], ['Reload', 'Save Anyway']);
    ok('...and Escape is neither', ed.asked[0] && ed.asked[0].dismiss, null);
    ok('Save Anyway sends it again without the version', [pg.sent.length, 'expect_version' in (pg.sent[1] || {})], [2, false]);
    ok('...the same layout', pg.sent[1] && pg.sent[1].changes.home_grid.items[0].id, 'mine');
    ok('...and it is saved', [ed.saved.length, pg.data.versions['board/dashboard-hall']], [1, 10]);
  });
});

step(function () {                      // conflict -> Reload
  var pg = page([conflict()]), ed = editor(pg, false);
  ed.change(grid('mine'));
  return ed.save().then(function () {
    ok('Reload reads the settings again', [pg.reloads, pg.sent.length], [1, 1]);
    ok('...the draft is the screen as it is now', ed.grid.items[0].id, 'theirs');
    ok('...nothing left to save, nothing to undo', [ed.dirty(), ed.undoStack.length], [false, 0]);
    ok('...and the next Save sends the new version', ed.version, 8);
    ok('...not saved, and said', [ed.saved.length, /Reloaded/.test(said(ed))], [0, true]);
  });
});

step(function () {                      // conflict -> dismissed: the draft stays
  var pg = page([conflict()]), ed = editor(pg, null);
  ed.change(grid('mine'));
  return ed.save().then(function () {
    ok('dismissed: nothing sent again, nothing read, the draft kept', [pg.sent.length, pg.reloads, ed.grid.items[0].id, ed.dirty()],
       [1, 0, 'mine', true]);
  });
});

step(function () {                      // Copy Layout To: the target's version
  var pg = page([{ board: { home_style: 'grid' }, version: 'den-3' }]), ed = editor(pg, true);
  ed.change(grid('mine'));
  return ed.copyTo('dashboard-den').then(function () {
    ok('Copy Layout sends the target screen\'s version', [pg.sent[0].dashboard, pg.sent[0].expect_version], ['dashboard-den', 'den-digest']);
    ok('...and keeps its new one', pg.data.versions['board/dashboard-den'], 'den-3');
  });
});

step(function () {                      // Copy Layout To, conflict -> Save Anyway
  var pg = page([conflict(), { board: {}, version: 'den-4' }]), ed = editor(pg, function (o) { return o.ok === 'Copy Layout' ? true : true; });
  ed.change(grid('mine'));
  return ed.copyTo('dashboard-den').then(function () {
    var last = ed.asked[ed.asked.length - 1];
    ok('a copy\'s conflict asks too', last && [last.cancel, last.ok], ['Reload', 'Save Anyway']);
    ok('...Save Anyway copies again without the version', [pg.sent.length, 'expect_version' in (pg.sent[1] || {}), pg.sent[1] && pg.sent[1].dashboard],
       [2, false, 'dashboard-den']);
  });
});

step(function () {                      // Copy Layout To, conflict -> Reload: the draft stays
  var pg = page([conflict()]), ed = editor(pg, function (o) { return o.ok === 'Copy Layout'; });
  ed.change(grid('mine'));
  return ed.copyTo('dashboard-den').then(function () {
    ok('a copy\'s Reload reads again and keeps this screen\'s draft', [pg.reloads, pg.sent.length, ed.grid.items[0].id, ed.dirty()],
       [1, 1, 'mine', true]);
  });
});

step(function () {                      // the kit: what Escape answers
  var K = window.hkSettingsKit, root = document.createElement('div'), got = [];
  root.activeElement = null;
  var El = Object.getPrototypeOf(root);
  if (!El.focus) El.focus = function () {};
  var put = root.appendChild;          // the shim's elements have no remove(): the alert takes itself away
  root.appendChild = function (c) { c.remove = function () { root.removeChild(c); }; return put.call(root, c); };
  var a = K.confirm(root, { title: 'T', message: 'M', ok: 'Save Anyway', cancel: 'Reload', dismiss: null });
  var bd = root.children[root.children.length - 1];
  (bd._listeners.keydown || []).forEach(function (f) { f({ key: 'Escape', preventDefault: function () {} }); });
  return a.then(function (v) {
    got.push(v);
    var b = K.confirm(root, { title: 'T', message: 'M' });
    var bd2 = root.children[root.children.length - 1];
    (bd2._listeners.keydown || []).forEach(function (f) { f({ key: 'Escape', preventDefault: function () {} }); });
    return b;
  }).then(function (v) {
    got.push(v);
    ok('the kit\'s alert: Escape answers its dismiss, else false', got, [null, false]);
  });
});

step(function () {                      // FULL (F, 2026-10-30): the Cameras face's whole view
  var E = window.hkGridEditor, base = function (cols, rows, items) { return { v: 1, cols: cols, rows: rows, frame: [1280, 800], band: false, items: items || [] }; };
  var g = E.add(base(6, 4), 'cameras', 'F');
  ok('a Full block goes at the top left of an empty view', g && g.items[0].at, [0, 0]);
  ok('...and fills it: nothing else fits beside it', E.firstSpace(g, 'S'), null);
  ok('...a view with a block in it has no room for one', E.firstSpace(base(6, 4, [{ id: 'a1', card: 'timers', size: 'S', at: [5, 3] }]), 'F'), null);
  ok('...nor anywhere but [0, 0]', E.place(g, g.items[0].id, [1, 0]), null);
  ok('...a layout with a block beside it is not valid', E.valid(Object.assign(base(6, 4), { items: g.items.concat({ id: 'a1', card: 'timers', size: 'S', at: [5, 3] }) })), false);
  ok('...but another view may have its own', E.valid(Object.assign(base(6, 4), { views: 2, items: g.items.concat({ id: 'a1', card: 'timers', size: 'S', at: [0, 0], view: 1 }) })), true);
  ok('on a phone\'s 2 x 4 grid too', E.valid(Object.assign(base(2, 4), { items: [{ id: 'c1', card: 'cameras', size: 'F', at: [0, 0] }] })), true);
  ok('only the Cameras face has it', E.valid(Object.assign(base(6, 4), { items: [{ id: 'c1', card: 'camera', size: 'F', at: [0, 0] }] })), false);
});

// ---- the Square screen, Cell Shape and the HomeView-style starters (2026-10-30, HOMEVIEW-LOOK.md Phase A)
step(function () {
  var GE = window.hkGridEditor, T = GE.SCREEN_TYPES;
  ok('every screen type names its cells; Square is the one with square cells', T.map(function (t) { return t[0] + ':' + t[6]; }).join(),
     'phone_portrait:tile,phone_landscape:tile,tablet_portrait:tile,tablet_landscape:tile,large_tablet:tile,car:tile,square:square');
  ok('...Square: 3 x 3, no band, an 800 x 800 preview', JSON.stringify(T[T.length - 1].slice(1, 6)), JSON.stringify(['Square', 3, 3, false, [800, 800]]));
  var sq = { v: 1, cols: 3, rows: 3, frame: [800, 800], band: false, cell: 'square', screen: 'square', items: [] };
  ok('a square screen\'s grid is the Square type', GE.screenTypeOf(sq), 'square');
  ok('...a 3 x 3 of square cells on another screen is not (Home with Pane\'s grid is one)', GE.screenTypeOf(Object.assign({}, sq, { screen: undefined })), 'custom');
  ok('...square cells on a wide tablet are still its type', GE.screenTypeOf({ cols: 6, rows: 4, band: true, cell: 'square' }), 'tablet_landscape');
  ok('the preview\'s scale reads the cells: a Square screen at full size', GE.scaleAt(sq, [800, 800]), 1);
  ok('...6 x 4 square, band off, on a landscape tablet: 1295.4 x 877.4 at 0.91',
     Math.round(GE.scaleAt({ cols: 6, rows: 4, band: false, cell: 'square' }, [1180, 820]) * 1000), 911);
  ok('...6 x 4 tiles as before', Math.round(GE.scaleAt({ cols: 6, rows: 4, band: true }, [1280, 800]) * 1000), Math.round(Math.min(1, 1280 / 1280.4, 800 / (4 * 150 + 30 + 54.4 + 70)) * 1000));

  var pg = page([]), ed = editor(pg, true);
  ed.change({ v: 1, cols: 6, rows: 4, frame: [1280, 800], band: true, items: [{ id: 'a', card: 'timers', size: 'S', at: [4, 2] }, { id: 'b', card: 'clock', size: 'L', at: [0, 0] }] });
  ed.cellShape('square');
  ok('Cell Shape: Square, every block where it was', [ed.grid.cell, JSON.stringify(ed.grid.items.map(function (i) { return i.at; }))], ['square', '[[4,2],[0,0]]']);
  ed.cellShape('tile');
  ok('...and Tile again is no key, the blocks still there', ['cell' in ed.grid, JSON.stringify(ed.grid.items.map(function (i) { return i.at; }))], [false, '[[4,2],[0,0]]']);
  return ed.screenType('square').then(function () {
    var g = ed.grid;
    ok('choosing Square: 3 x 3, no band, square cells, Fill the Screen, its preview', [g.cols, g.rows, g.band, g.cell, g.screen, g.grow, JSON.stringify(g.frame)],
       [3, 3, false, 'square', 'square', true, '[800,800]']);
    return ed.screenType('tablet_landscape');
  }).then(function () {
    ok('...another type takes its own cells and is no square screen', ['cell' in ed.grid, 'screen' in ed.grid, ed.grid.cols], [false, false, 6]);
  });
});

step(function () {
  var GE = window.hkGridEditor, S = GE.SQUARE_STARTERS;
  var house = { climate: 'climate.den', scenes: ['scene.arrive', 'scene.good_night', 'scene.movie'], lock: 'lock.front_door',
                light: ['light.entry'], fan: ['fan.bedroom'], more: ['light.porch', 'cover.shades'], weather: true, camera: true };
  var base = { v: 1, cols: 3, rows: 3, frame: [800, 800], band: false, cell: 'square', screen: 'square', items: [] };
  var hv = GE.squareStarter(S.square[0], base, house), by = function (g) { return g.items.map(function (i) { return i.card + ':' + i.size + '@' + i.at.join(','); }).join(' '); };
  ok('Square: HomeView-style -- the thermostat L, the clock, two scenes, the lock and the lights', by(hv),
     'thermostat:L@0,0 clock:S@2,0 scene:S@2,1 scene:S@0,2 accessory:S@1,2 accessory:S@2,2');
  ok('...a valid layout, square cells on a square screen', [GE.valid(hv), hv.cell, hv.screen, hv.cols, hv.rows, hv.band], [true, 'square', 'square', 3, 3, false]);
  var th = hv.items[0], ck = hv.items[1];
  ok('...the room\'s thermostat in Big Number, Analog Numbers bare', [th.opts.entity, th.opts.style, ck.opts.clock_style, ck.bare], ['climate.den', 'big', 'numbers', true]);
  ok('...the tiles centred, filled from the house', hv.items.slice(2).map(function (i) { return i.tile + ':' + (i.opts.scene || i.opts.entity); }).join(),
     'centred:scene.arrive,centred:scene.good_night,centred:lock.front_door,centred:light.entry');
  ok('nothing in the house: only the clock (a block with nothing to show is left out)', by(GE.squareStarter(S.square[0], base, { scenes: [], light: [], fan: [], more: [] })), 'clock:S@2,0');
  var land = GE.squareStarter(S.tablet_landscape[1], { v: 1, cols: 6, rows: 4, frame: [1180, 820], band: true, items: [] }, house);
  ok('Tablet, Landscape: Square, 6 x 4, square cells, no band, no square screen', [land.cols, land.rows, land.band, land.cell, 'screen' in land, GE.valid(land)],
     [6, 4, false, 'square', false, true]);
  ok('...its description says the text is smaller', /smaller/.test(S.tablet_landscape[1][2]), true);
  ok('...the thermostat, clock, weather, camera, the lock and lights and a fan', ['thermostat', 'clock', 'weather', 'camera'].every(function (c) {
    return land.items.some(function (i) { return i.card === c; }); }) && land.items.filter(function (i) { return i.tile === 'centred'; }).length === 7, true);
  // HOME WITH PANE, first on a landscape tablet: a 3 x 3 filling the height beside the screen's Side Pane
  ok('Tablet, Landscape: Home with Pane first, then Square, 6 x 4', S.tablet_landscape.map(function (c) { return c[0]; }).join(), 'sq_pane,sq_6x4');
  var hp = GE.squareStarter(S.tablet_landscape[0], { v: 1, cols: 6, rows: 4, frame: [1180, 820], band: true, items: [] }, house);
  ok('...3 x 3 square cells, no band, Fill the Screen, no square screen, valid', [hp.cols, hp.rows, hp.cell, hp.band, hp.grow, 'screen' in hp, GE.valid(hp)],
     [3, 3, 'square', false, true, false, true]);
  ok('...the thermostat L in Big Number and the clock, then scenes, the lock, the lights', by(hp), 'thermostat:L@0,0 clock:S@2,0 scene:S@2,1 scene:S@0,2 accessory:S@1,2 accessory:S@2,2');
  var want = GE.paneForStarter(S.tablet_landscape[0], { side_pane: { side: 'left' }, side_pane_read: { dashboard: { show: 'off' } } });
  ok('...it turns the screen\'s Side Pane on for Home (Weather, Calendar, Now Playing while it plays), its own side kept',
     [want && want.side, want && want.dashboard.show, want && want.dashboard.sections.map(function (x) { return x.kind + (x.when ? ':' + x.when : ''); }).join()],
     ['left', 'home', 'weather,calendar,now_playing:active']);
  ok('...not when the screen already shows a pane on Home or every page', [GE.paneForStarter(S.tablet_landscape[0], { side_pane_read: { dashboard: { show: 'all' } } }),
     GE.paneForStarter(S.tablet_landscape[0], { side_pane_read: { dashboard: { show: 'home' } } })], [null, null]);
  // COLUMNS on square cells (2026-10-30): 2 to 6; the rows come from the height, and the columns that fit at full size
  // beside the Side Pane are said (more, and the grid gets smaller)
  ok('the columns offered', GE.COLS, [6, 5, 4, 3, 2]);
  var SQ = { cell: 'square', rows: 4, band: false, grow: true, frame: [1180, 820] }, PANE = { side_pane_read: { dashboard: { show: 'home' } } };
  ok('4 rows on a 1180 x 820 tablet beside the pane: 3 columns at full size (3.8 fit); without it, 5; a 1366 x 1024 (its cells grown to fill the height), 3 and 5',
    [GE.fullColumns(SQ, PANE), GE.fullColumns(SQ, {}), GE.fullColumns(Object.assign({}, SQ, { frame: [1366, 1024] }), PANE), GE.fullColumns(Object.assign({}, SQ, { frame: [1366, 1024] }), {})],
    [3, 5, 3, 5]);
  ok('...and no other starter asks for it', GE.paneForStarter(S.tablet_landscape[1], { side_pane_read: { dashboard: { show: 'off' } } }), null);
  var por = GE.squareStarter(S.tablet_portrait[0], { v: 1, cols: 3, rows: 6, frame: [820, 1180], band: true, items: [] }, house);
  var ph = GE.squareStarter(S.phone_portrait[0], { v: 1, cols: 2, rows: 5, frame: [390, 844], band: false, items: [] }, house);
  ok('Tablet, Portrait: Square, 3 x 5; Phone, Portrait: Square, 2 x 4 with the thermostat Tall', [por.cols, por.rows, GE.valid(por), ph.cols, ph.rows, GE.valid(ph), ph.items[0].size],
     [3, 5, true, 2, 4, true, 'T']);

  // filled from the house: the tablet's room first, the front door's lock
  var pg = page([]), ed = editor(pg, true);
  pg.client = { states: { 'climate.hall': { state: 'heat', attributes: {} }, 'climate.den': { state: 'heat', attributes: {} },
    'lock.back_door': { state: 'locked', attributes: { friendly_name: 'Back Door' } }, 'lock.side': { state: 'locked', attributes: { friendly_name: 'Front Door Lock' } },
    'light.a_hall': { state: 'off', attributes: {} }, 'light.den_lamp': { state: 'on', attributes: {} }, 'fan.den': { state: 'off', attributes: {} },
    'scene.arrive': { state: 'scening', attributes: {} }, 'weather.home': { state: 'sunny', attributes: {} } },
    entities: { 'climate.den': { area_id: 'den' }, 'light.den_lamp': { area_id: 'den' }, 'light.a_hall': { area_id: 'hall' } }, devices: {},
    areas: { den: { name: 'Den' }, hall: { name: 'Hall' } } };
  pg.data.tablets = { t1: { screen: 'dashboard-hall', room: 'den' } };
  var hh = ed.squareHouse();
  ok('the house: the tablet\'s room\'s thermostat and lights, the front door\'s lock', [hh.climate, hh.lock, hh.light[0], hh.fan[0], hh.weather, hh.camera],
     ['climate.den', 'lock.side', 'light.den_lamp', 'fan.den', true, false]);
});

// EVERY BLOCK THE CATALOG HAS IS IN THE PICKER (2026-10-31, the owner: On Now, To-do and Energy Rings, added that
// morning, were not in the card list): the list is drawn from GROUPS, and Edit mode's Add reads the same, so a block in
// the catalog and not in GROUPS was offered nowhere. Each key needs a place in a group, a name, a description and a
// glyph; a key that is meant to stay out of the picker goes in INTERNAL below, with its reason.
step(function () {
  var GE = window.hkGridEditor, cat = window.hkGridCatalog.table(), keys = Object.keys(cat);
  var INTERNAL = {};                // catalog key -> why it is not offered ({} today: every block is a card to add)
  var listed = [];
  GE.GROUPS.forEach(function (g) { g[1].forEach(function (k) { listed.push(k); }); });
  ok('every catalog key but the internal ones is in a group of the picker', keys.filter(function (k) { return !INTERNAL[k] && listed.indexOf(k) < 0; }), []);
  ok('...no group names a key the catalog has not (an old name left behind)', listed.filter(function (k) { return !cat[k]; }), []);
  ok('...none is in two groups', listed.filter(function (k, i) { return listed.indexOf(k) !== i; }), []);
  ok('...an internal key is one the catalog has, and gives its reason', Object.keys(INTERNAL).filter(function (k) { return !cat[k] || !INTERNAL[k]; }), []);
  var offered = keys.filter(function (k) { return !INTERNAL[k]; });
  ok('each has a name', offered.filter(function (k) { return !GE.NAMES[k] || typeof GE.NAMES[k] !== 'string'; }), []);
  ok('...a description', offered.filter(function (k) { return !GE.DESCRIPTIONS[k] || typeof GE.DESCRIPTIONS[k] !== 'string'; }), []);
  ok('...and a glyph (MDI or the house\'s own)', offered.filter(function (k) { return !/^(mdi|hk):[a-z0-9-]+$/.test(GE.GLYPHS[k] || ''); }), []);
  ok('...and names, descriptions and glyphs for nothing else', [Object.keys(GE.NAMES), Object.keys(GE.DESCRIPTIONS), Object.keys(GE.GLYPHS)].map(function (o) {
    return o.filter(function (k) { return !cat[k]; }); }), [[], [], []]);
  var groupOf = function (k) { return GE.GROUPS.filter(function (g) { return g[1].indexOf(k) >= 0; }).map(function (g) { return g[0]; })[0]; };
  ok('the widget blocks are where the owner would look: On Now with the lights, To-do with Info, Energy Rings beside Power and Water',
     [groupOf('on_now'), groupOf('todo'), groupOf('energy_rings'), GE.GROUPS.filter(function (g) { return g[0] === 'Info'; })[0][1].join().match(/power,energy_rings,water/) !== null],
     ['Rooms & Lights', 'Info', 'Info', true]);
  ok('...US spelling in what the picker says', offered.filter(function (k) { return /favour|colour|centre|grey/i.test(GE.NAMES[k] + ' ' + GE.DESCRIPTIONS[k]); }), []);
});

// A BLOCK'S CUSTOM DETAIL SHEET (2026-11-07): When Tapped, the sheet's settings and its entries, bulk Add, Duplicate,
// Copy from Another Block, Remove Sheet -- each a change of the draft, every copy independent of what it came from.
// The panel's rows are read as the kit is handed them (each row its options), and answered as a person would.
step(function () {
  var pg = page([]);
  pg.client = { states: { 'lock.front': { attributes: { friendly_name: 'Front Door' } }, 'lock.back': { attributes: { friendly_name: 'Back Door' } },
                          'cover.garage': { attributes: { friendly_name: 'Garage Door' } }, 'alarm_control_panel.house': { attributes: { friendly_name: 'Alarm' } } } };
  pg.data.boards['dashboard-den'] = { home_style: 'grid', home_grid: { v: 1, cols: 6, rows: 4, frame: [1280, 800], band: true, items: [
    { id: 'd1', card: 'clock', size: 'S', at: [0, 0], interaction: { tap: 'custom_sheet',
      custom_sheet: { v: 1, title: 'Den Doors', entries: [{ id: 'e1', entity: 'lock.back', name: 'Patio' }] } } }] } };
  pg.data.dashboards = [{ path: 'dashboard-den', title: 'Den' }, { path: 'dashboard-hall', title: 'Hall' }];
  var ed = editor(pg, true);
  ed.load(pg.data.boards['dashboard-hall']);
  var rows = [], K0 = ed.K;
  var rec = function (kind) { return function (o) { var r = Object.assign({ kind: kind }, o); rows.push(r); return r; }; };
  ed.K = Object.assign({}, K0, { select: rec('select'), seg: rec('seg'), text: rec('text'), button: rec('button'), check: rec('check'), info: rec('info'),
                                 toggle: rec('toggle'), group: function (o, r) { return { group: o, rows: r }; } });
  ed.sidebar = { appendChild: function () {} };
  var item = function () { return ed.grid.items.find(function (x) { return x.id === 'a1'; }); };
  var draw = function () { rows.length = 0; ed.sheetGroup(item()); return rows; };
  var row = function (label) { return draw().filter(function (r) { return r.label === label; })[0]; };
  ok('a block starts with its own tap', row('When Tapped').value, 'default');
  row('When Tapped').onChange('custom_sheet');
  ok('Custom Detail Sheet: an empty sheet, on', item().interaction, { tap: 'custom_sheet', custom_sheet: { v: 1, entries: [] } });
  ok('...which says it needs an accessory before it can be saved', draw().some(function (r) { return r.kind === 'info' && r.label === 'Add an accessory'; }), true);
  row('Add Accessories…').onClick();
  draw().filter(function (r) { return r.kind === 'check' && (r.label === 'Garage Door' || r.label === 'Front Door'); }).forEach(function (r) { r.onClick(true); });
  row('Add 2 Accessories').onClick();
  ok('Add puts the ticked ones in at once, in the list\'s order, each its own id', item().interaction.custom_sheet.entries,
     [{ id: 'e1', entity: 'lock.front' }, { id: 'e2', entity: 'cover.garage' }]);
  row('Title').onCommit('Security');
  row('Tile Style').onChange('centred');
  ok('the sheet\'s title and its tile style', [item().interaction.custom_sheet.title, item().interaction.custom_sheet.tile_style], ['Security', 'centred']);
  row('Header Icon').onCommit('javascript:alert(1)');
  ok('an icon that is no set and name is refused', item().interaction.custom_sheet.icon, undefined);
  // an entry's look, then Duplicate
  ed.sheetEntry = 'e1';
  row('Name').onCommit('Front');
  row('Color').onChange('teal');
  rows.length = 0; ed.sheetGroup(item());
  rows.filter(function (r) { return r.label === 'Duplicate'; })[0].onClick();
  var es = item().interaction.custom_sheet.entries;
  ok('Duplicate: right after it, a new id, the same accessory and look', es.map(function (e) { return [e.id, e.entity, e.name || '', e.color || '']; }),
     [['e1', 'lock.front', 'Front', 'teal'], ['e3', 'lock.front', 'Front', 'teal'], ['e2', 'cover.garage', '', '']]);
  ed.sheetEntry = 'e3';
  row('Name').onCommit('Front Battery');
  ok('...and a copy: changing it leaves the first as it was', item().interaction.custom_sheet.entries.map(function (e) { return e.name || ''; }), ['Front', 'Front Battery', '']);
  rows.length = 0; ed.sheetGroup(item());
  rows.filter(function (r) { return r.label === 'Move Up'; })[2].onClick();
  ok('Move Up: the order is the sheet\'s, ids kept', item().interaction.custom_sheet.entries.map(function (e) { return e.id; }), ['e1', 'e2', 'e3']);
  ed.sheetEntry = 'e1';
  row('Reset Look').onClick();
  ok('Reset Look takes the entry\'s own look away, nothing resolved stored in its place', item().interaction.custom_sheet.entries[0], { id: 'e1', entity: 'lock.front' });
  // back to the block's own tap: the sheet kept as a draft
  row('When Tapped').onChange('default');
  ok('the block\'s own tap again keeps the sheet as a draft', [item().interaction.tap, item().interaction.custom_sheet.entries.length], ['default', 3]);
  row('When Tapped').onChange('custom_sheet');
  // Duplicate Block: the sheet goes with it, its entries new ids, and is its own
  ed.duplicate('a1');
  var dup = ed.grid.items[ed.grid.items.length - 1];
  ok('Duplicate Block: a block of its own in the first free place, its sheet with it', [dup.id !== 'a1', dup.at, dup.interaction.custom_sheet.entries.length, dup.interaction.custom_sheet.title],
    [true, [1, 0], 3, 'Security']);
  dup.interaction.custom_sheet.entries[0].name = 'Changed';
  ok('...and a copy, not a link', item().interaction.custom_sheet.entries[0].name, undefined);
  // Copy Sheet From: another screen's block, by its screen, card and title
  var from = row('Copy Sheet From');
  var den = from.options.filter(function (o) { return /Den · Clock · Den Doors/.test(o[1]); })[0];
  ok('Copy Sheet From names the screen, the card and the sheet', !!den, true);
  return Promise.resolve(from.onChange(den[0])).then(function () {
    ok('...and copies it, every entry a new id', item().interaction.custom_sheet, { v: 1, title: 'Den Doors', entries: [{ id: 'e1', entity: 'lock.back', name: 'Patio' }] });
    item().interaction.custom_sheet.entries[0].name = 'Mine';
    ok('...never linked to the one it came from', pg.data.boards['dashboard-den'].home_grid.items[0].interaction.custom_sheet.entries[0].name, 'Patio');
    row('Remove Sheet').onClick();
    ok('Remove Sheet takes it away: the block as it was', item().interaction, undefined);
    ok('a draft that holds a sheet is still a valid layout', window.hkGridEditor.valid(ed.grid), true);
  });
});

// COMPACT (2026-11-07): Security's HomeView's 3 x 1, a size no other card has, and no old Security block
step(function () {
  var GE = window.hkGridEditor, g = { v: 1, cols: 6, rows: 4, frame: [1280, 800], band: true, items: [] };
  ok('Compact is three columns by one row', window.hkGridCatalog.SIZES.C, [3, 1]);
  ok('...named Compact', [GE.SIZE_NAMES.C, GE.SIZE_SHORT.C], ['Compact', 'Compact']);
  g.items = [{ id: 'a', card: 'security', size: 'C', at: [0, 0], opts: { presentation: 'homeview' } }];
  ok('Security\'s HomeView at Compact is a valid layout', GE.valid(g), true);
  g.items = [{ id: 'a', card: 'security', size: 'C', at: [0, 0] }];
  ok('...an old Security block at Compact is not', GE.valid(g), false);
});

// SHOW WHEN's SOLAR WINDOW (2026-11-10): From and Until, each A Time or Sunrise / Sunset with an offset in minutes; the
// window the screen would open now or next, from Home Assistant's sun.sun -- or that it can't tell without it
step(function () {
  var pg = page([]);
  pg.client = { states: {} };
  var ed = editor(pg, true);
  ed.load(pg.data.boards['dashboard-hall']);
  var rows = [], K0 = ed.K;
  var rec = function (kind) { return function (o) { var r = Object.assign({ kind: kind }, o); rows.push(r); return r; }; };
  ed.K = Object.assign({}, K0, { select: rec('select'), seg: rec('seg'), text: rec('text'), button: rec('button'), check: rec('check'), info: rec('info'),
                                 toggle: rec('toggle'), group: function (o, r) { return { group: o, rows: r }; } });
  ed.sidebar = { appendChild: function () {} };
  var item = function () { return ed.grid.items.find(function (x) { return x.id === 'a1'; }); };
  var draw = function () { rows.length = 0; ed.conditions(item()); return rows; };
  var rows_ = function (label) { return draw().filter(function (r) { return r.label === label; }); };
  ok('Solar Window is one of the conditions offered', rows_('Add Rule').length === 1 && window.hkGridCatalog.CONDITIONS.indexOf('solar_window') >= 0, true);
  rows_('Add Rule')[0].onClick();
  var when = rows_('When')[0];
  ok('...named A Solar Window', when.options.filter(function (o) { return o[0] === 'solar_window'; })[0][1], 'A Solar Window');
  when.onChange('solar_window');
  var cond = function () { return item().rules[0].when.all[0]; };
  ok('a new Solar Window: from 15 minutes before sunset until 10 PM', cond(), { kind: 'solar_window', from: { sun: 'sunset', offset: -15 }, to: { at: '22:00' } });
  ok('...its rows: From, its Offset, Until, its Time', [rows_('From')[0].value, rows_('Offset')[0].value, rows_('Until')[0].value, rows_('Time')[0].value], ['sunset', -15, 'at', '22:00']);
  ok('...and with no sun.sun, that the screen can\'t tell (the rule won\'t hold)', draw().some(function (r) { return r.kind === 'info' && r.label === 'Can’t Tell Now'; }), true);
  // the morning: an hour before sunrise until half an hour after it
  rows_('From')[0].onChange('sunrise');
  ok('From Sunrise keeps its offset', cond().from, { sun: 'sunrise', offset: -15 });
  rows_('Offset')[0].onCommit('-60');
  rows_('Until')[0].onChange('sunrise');
  rows_('Offset')[1].onCommit('+30');
  ok('the morning: from Sunrise −60 until Sunrise +30', cond(), { kind: 'solar_window', from: { sun: 'sunrise', offset: -60 }, to: { sun: 'sunrise', offset: 30 } });
  rows_('Offset')[0].onCommit('−45');
  ok('...a typed minus sign (−) reads as one', cond().from, { sun: 'sunrise', offset: -45 });
  rows_('Offset')[0].onCommit('400');
  rows_('Offset')[0].onCommit('soon');
  ok('...past six hours, or not a number, is not taken', cond().from, { sun: 'sunrise', offset: -45 });
  rows_('Until')[0].onChange('at');
  rows_('Time')[0].onCommit('06:30');
  ok('Until A Time', cond().to, { at: '06:30' });
  // with the sun: what the screen would do now
  var now = Date.now(), H = 3600000;
  pg.client.states = { 'sun.sun': { state: 'above_horizon', attributes: { next_rising: new Date(now + 2 * H).toISOString(), next_setting: new Date(now + 12 * H).toISOString() } } };
  ok('with sun.sun: the window it opens next, or that it is open', draw().some(function (r) { return r.kind === 'info' && (r.label === 'Opens Next' || r.label === 'Open Now') && !!r.value; }), true);
  ok('the layout with a Solar Window is valid', window.hkGridEditor.valid(ed.grid), true);
});

// SHOW WHEN TAKES TEN RULES (2026-11-10; four before): Add Rule to ten and no further, each rule's header its place,
// a rule past the fourth set, previewed, moved up and down and removed; Preview a menu past four; valid() as hk_core
step(function () {
  var pg = page([]);
  pg.client = { states: {} };
  var ed = editor(pg, true);
  ed.load(pg.data.boards['dashboard-hall']);
  var rows = [], groups = [], K0 = ed.K, previews = 0;
  var rec = function (kind) { return function (o) { var r = Object.assign({ kind: kind }, o); rows.push(r); return r; }; };
  ed.K = Object.assign({}, K0, { select: rec('select'), seg: rec('seg'), text: rec('text'), button: rec('button'), check: rec('check'), info: rec('info'),
                                 toggle: rec('toggle'), group: function (o, r) { groups.push(o); return { group: o, rows: r }; } });
  ed.sidebar = { appendChild: function () {} };
  ed.preview = function () { previews++; };
  var item = function () { return ed.grid.items.find(function (x) { return x.id === 'a1'; }); };
  var draw = function () { rows.length = 0; groups.length = 0; ed.conditions(item()); return rows; };
  var rows_ = function (label) { return draw().filter(function (r) { return r.label === label; }); };
  var G = window.hkGridCatalog, kinds = function () { return item().rules.map(function (r) { return r.when.all[0].kind; }); };
  ok('the editor\'s numbers are hk_core\'s', [G.RULES_MAX, G.CONDITIONS_MAX], [10, 3]);
  var adds = 0;
  while (rows_('Add Rule')[0] && !rows_('Add Rule')[0].disabled && adds < 20) { rows_('Add Rule')[0].onClick(); adds++; }
  ok('Add Rule adds ten, then is unavailable', [adds, item().rules.length, rows_('Add Rule')[0].disabled], [10, 10, true]);
  rows_('Add Rule')[0].onClick();
  ok('...a tap on it then adds nothing', item().rules.length, 10);
  draw();
  ok('...and says the block is full', groups.some(function (g) { return /up to 10 rules/.test(g.footer || ''); }), true);
  ok('each rule\'s header says where it stands', groups.filter(function (g) { return /^Rule \d+ of 10 · /.test(g.header || ''); }).map(function (g) { return +/^Rule (\d+)/.exec(g.header)[1]; }),
     [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // the seventh rule: its condition, a second one and a third, and no fourth
  var whens = function () { return rows_('When'); };
  whens()[6].onChange('after_sunset');
  ok('the seventh rule\'s condition changes, the others stay', kinds().join(),
    'music_playing,music_playing,music_playing,music_playing,music_playing,music_playing,after_sunset,music_playing,music_playing,music_playing');
  var also = function () { return rows_('And Also'); };
  also()[6].onChange('alarm_armed');
  also()[6].onChange('timer_running');
  ok('...takes three conditions', item().rules[6].when.all.map(function (c) { return c.kind; }), ['after_sunset', 'alarm_armed', 'timer_running']);
  ok('...and offers no fourth', also().length, 9);
  // the tenth: previewed from its own rows and from Preview, a menu with each rule's card
  var preview = rows_('Preview')[0];
  ok('ten rules: Preview is a menu of Live, Default and each rule', [preview.kind, preview.options.length, preview.options[11][0], /^Rule 10: /.test(preview.options[11][1])],
    ['select', 12, '9', true]);
  preview.onChange('9');
  ok('...the tenth previews, and its card is the one being set', [ed.conditionPreview, ed.editing, previews > 0], [9, 9, true]);
  var edits = draw().filter(function (r) { return /^Edit .* Settings$/.test(r.label); });
  ok('...its Edit Settings is the one already open', edits.map(function (r) { return !!r.disabled; }).indexOf(true), 9);
  edits[4].onClick();
  ok('Edit Settings on the fifth previews the fifth', [ed.conditionPreview, ed.editing], [4, 4]);
  // move the seventh up to the first, and down to the last
  var mark = function () { return item().rules.map(function (r) { return r.when.all.length; }).indexOf(3); };
  for (var k = 0; k < 6; k++) rows_('Move Rule Up')[mark()].onClick();
  ok('Move Rule Up takes the seventh to the first', mark(), 0);
  ok('...the first has no Move Rule Up, the last no Move Rule Down', [rows_('Move Rule Up')[0].disabled, rows_('Move Rule Down')[9].disabled, rows_('Move Rule Down')[0].disabled],
    [true, true, false]);
  for (k = 0; k < 9; k++) rows_('Move Rule Down')[mark()].onClick();
  ok('Move Rule Down takes it to the tenth', [mark(), item().rules.length], [9, 10]);
  ed.editing = 8;
  rows_('Move Rule Down')[8].onClick();
  ok('...the card being set moves with its rule', [ed.editing, mark()], [9, 8]);
  // remove the ninth, then the tenth
  rows_('Remove Rule')[8].onClick();
  ok('Remove Rule on the ninth leaves nine, the others in order', [item().rules.length, mark()], [9, -1]);
  ok('...and Add Rule is back', rows_('Add Rule')[0].disabled, false);
  rows_('Remove Rule')[8].onClick();
  ok('...then eight', item().rules.length, 8);
  draw();
  ok('past four Preview is still a menu; four or fewer, the segments as before', rows_('Preview')[0].kind, 'select');
  while (item().rules.length > 4) rows_('Remove Rule')[4].onClick();
  ok('...four rules: Live, Default, Rule 1 to Rule 4', [rows_('Preview')[0].kind, rows_('Preview')[0].options.map(function (o) { return o[1]; })],
    ['seg', ['Live', 'Default', 'Rule 1', 'Rule 2', 'Rule 3', 'Rule 4']]);
  ok('the layout with its rules is valid', window.hkGridEditor.valid(ed.grid), true);
  // valid(), as hk_core: ten rules, three conditions a rule
  var GE = window.hkGridEditor, block = function (rules) { return { v: 1, cols: 6, rows: 4, frame: [1280, 800], band: true,
    items: [{ id: 'b', card: 'calendar', size: 'L', at: [0, 0], rules: rules }] }; };
  var rule = function (n) { var all = []; for (var j = 0; j < n; j++) all.push({ kind: 'music_playing' }); return { when: { all: all }, card: 'clock' }; };
  var many = function (n, c) { var out = []; for (var j = 0; j < n; j++) out.push(rule(c || 1)); return out; };
  ok('valid: ten rules', GE.valid(block(many(10))), true);
  ok('...not eleven', GE.valid(block(many(11))), false);
  ok('valid: three conditions', GE.valid(block(many(10, 3))), true);
  ok('...not four', GE.valid(block(many(1, 4))), false);
  ok('...nor none, nor an empty list', [GE.valid(block([rule(0)])), GE.valid(block([]))], [false, false]);
  ok('...a block without rules as before', GE.valid(grid('a1')), true);
});

steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  print(fail ? 'FAIL ' + fail + ' GRID EDITOR TESTS' : 'ALL ' + pass + ' GRID EDITOR TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); print('FAIL GRID EDITOR TESTS'); });
