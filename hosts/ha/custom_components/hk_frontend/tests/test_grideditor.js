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

steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  print(fail ? 'FAIL ' + fail + ' GRID EDITOR TESTS' : 'ALL ' + pass + ' GRID EDITOR TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); print('FAIL GRID EDITOR TESTS'); });
