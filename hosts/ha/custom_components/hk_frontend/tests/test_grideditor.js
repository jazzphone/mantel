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

steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  print(fail ? 'FAIL ' + fail + ' GRID EDITOR TESTS' : 'ALL ' + pass + ' GRID EDITOR TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); print('FAIL GRID EDITOR TESTS'); });
