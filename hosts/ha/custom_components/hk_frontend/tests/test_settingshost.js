// THE HOST'S SETTINGS (panels/hk-settings.js, hkShell.settingsHost()).
//
// A host may put pages of its own beside HK's in the settings panel. In Home
// Assistant there is none: the panel draws, reads and says exactly what it
// always did, under its own name. With a host (here a fictional "Example"
// host, standing in for any other), its groups take their places in the
// sidebar, its addresses open its pages, its old addresses forward, its
// words replace HK's where it differs, and with `house: false` nothing of
// HK's own settings is read at all.
//
// Also the Preview button: narrower than a desk, a page with a preview offers
// it pinned at the top of the page, remembered in the browser.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run settingshost');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/panels/hk-settings-features.js');
var SRC = read(HK_ROOT + '/frontend/panels/hk-settings.js');
(0, eval)(SRC.replace('  var M = null, K = null, h = null, F = null;',
  '  var M = window.hkSettingsModel, K = window.hkSettingsKit, h = K.h, F = window.hkSettingsFeatures; F.use(K);'));

var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
var P = customElements.get('hk-settings-panel').prototype;
var EP = document.createElement('div').constructor.prototype;
var ap0 = EP.appendChild;
EP.appendChild = function (c) { return c ? ap0.call(this, c) : c; };
if (!EP.insertBefore) EP.insertBefore = function (c) { return this.appendChild(c); };
if (!EP.remove) EP.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
// (a text node: an element holding its text, for walk())
if (!document.createTextNode) document.createTextNode = function (t) { var e = document.createElement('#text'); e._text = String(t); return e; };
var DATA = { dashboards: [{ path: 'dashboard-kitchen', title: 'Kitchen', item: true }], boards: {}, settings: { sky: {}, look: {} },
             accessories: { entities: {} }, features: {}, popups: [], custom_pages: [], custom_chips: [] };
var ws = [];
var CLIENT = { states: {}, areas: {}, callWS: function (m) { ws.push(m); return Promise.resolve({}); } };

// A PAGE with the drawing it needs and nothing sent: `host` is what the shell answers
function page(host, data) {
  var hold = window.hkShell.settingsHost;
  window.hkShell.settingsHost = function () { return host; };
  var pg = Object.create(P);
  Object.defineProperty(pg, 'client', { value: CLIENT });
  pg.attrs = {}; pg.hasAttribute = HTMLElement.prototype.hasAttribute; pg.toggleAttribute = HTMLElement.prototype.toggleAttribute;
  pg.q = ''; pg.errors = {}; pg._narrow = false;
  pg.shadowRoot = { activeElement: null };
  pg.sideEl = document.createElement('nav');
  pg.data = data === undefined ? JSON.parse(JSON.stringify(DATA)) : data;
  pg.host();                                   // read once, as the page does when it starts
  window.hkShell.settingsHost = hold;
  return pg;
}
function texts(n) { return walk(n).map(function (e) { return e._text || ''; }).filter(Boolean); }
function side(pg) {
  P.paintSide.call(pg, []);
  // each group: its heading, then its rows' labels
  return walk(pg.sideEl).filter(function (e) { return e.tagName === 'section'; }).map(function (g) {
    var head = walk(g).filter(function (e) { return e.className === 'gh'; })[0];
    var rows = walk(g).filter(function (e) { return e.className === 't'; }).map(function (e) { return e._text; });
    return (head ? (head._text || texts(head).join('')) + ': ' : '') + rows.join(', ');
  });
}
var EXAMPLE_PAGES = [];
function example(o) {
  o = o || {};
  return {
    title: 'Example Settings', house: o.house !== false, screenBase: '/prefix',
    back: { label: 'Dashboard', href: '/prefix/home' },
    notes: { overview: 'Example keeps its own copy.', add_screen: 'Example can’t make screens.', screen_remove: 'Example can’t remove one.' },
    groups: function () {
      return [{ place: 'top', rows: [{ route: 'example/me', label: 'A Fictional Person', tile: ['mdi:account', '#888'] }] },
              { place: 'end', header: 'Example', rows: [{ route: 'example/people', label: 'People' }, { route: 'example/links', label: 'Links' }] }];
    },
    page: function (parts) {
      if (parts[0] !== 'example') return null;
      EXAMPLE_PAGES.push(parts.join('/'));
      return { title: 'Example ' + (parts[1] || 'me'), top: true, body: function () {} };
    },
    forward: function (path) { return path === 'people' ? 'example/people' : null; },
    first: function () { return o.house === false ? 'example/me' : null; },
    search: function () { return [{ label: 'People', route: 'example/people', where: 'Example', words: 'people' }]; }
  };
}

print('\n=== Home Assistant: no host, nothing of one ===');
(function () {
  ok('the shell answers no host by default', window.hkShell.settingsHost(), null);
  ok('...and the shell is Home Assistant\'s', window.hkShell.kind, 'ha');
  ok('...whose menu has no host page', window.hkShell.hostMenu(), []);
  var pg = page(window.hkShell.settingsHost());
  ok('the page knows no host', pg.host(), null);
  ok('its name is HK Settings', pg.title(), 'HK Settings');
  ok('no host words', [pg.hostNote('overview'), pg.hostNote('add_screen'), pg.hostNote('screen_remove')], [null, null, null]);
  ok('a screen\'s address is HA\'s own', pg.hostScreenBase(), '');
  var s = side(pg);
  ok('the sidebar: HK\'s groups only', s.slice(0, 3), ['Overview', 'Screens: Kitchen, Add Screen', s[2]]);
  ok('...ending with System', s[s.length - 1].indexOf('System:') === 0, true);
  ok('...and its title', texts(pg.sideEl).indexOf('HK Settings') >= 0, true);
  ok('...with no host\'s way out', walk(pg.sideEl).filter(function (e) { return e.className === 'hostback'; }).length, 0);
  ok('no host\'s address is a page: Overview', pg.resolve(['example', 'people']).title, 'Overview');
  ok('...and nothing was asked of a host', EXAMPLE_PAGES, []);
  // what the panel draws never names another host
  ok('the panel\'s source names no host of its own', /mantel/i.test(SRC), false);
})();

print('\n=== a host with pages of its own ===');
(function () {
  var pg = page(example());
  ok('the page takes the host\'s name', pg.title(), 'Example Settings');
  var s = side(pg);
  ok('the host\'s top group first, before Overview', s.slice(0, 2), ['A Fictional Person', 'Overview']);
  ok('...its other groups after System', s.slice(-2), [s[s.length - 2], 'Example: People, Links']);
  ok('...System just before them', s[s.length - 2].indexOf('System:') === 0, true);
  ok('the host\'s way out over the title', walk(pg.sideEl).filter(function (e) { return e.className === 'hostback'; }).length, 1);
  ok('its address is its page', pg.resolve(['example', 'links']).title, 'Example links');
  ok('HK\'s own addresses stay HK\'s', pg.resolve(['overview']).title, 'Overview');
  ok('its words on HK\'s pages', [pg.hostNote('overview'), pg.hostNote('add_screen')], ['Example keeps its own copy.', 'Example can’t make screens.']);
  var add = pg.p_add([]), box = document.createElement('div');
  add.body(box);
  ok('Add Screen says the host\'s why, and offers nothing', [add.title, texts(box)], ['Add Screen', ['Example can’t make screens.']]);
  ok('a screen\'s address under the host\'s prefix', pg.hostScreenBase(), '/prefix');
  pg.q = 'peop';
  var r = texts(pg.searchResults());
  ok('search finds the host\'s pages too', r.indexOf('People') >= 0 && r.indexOf('Example') >= 0, true);
})();

print('\n=== an old address of the host\'s forwards ===');
(function () {
  var pg = page(example()), replaced = [];
  if (typeof history === 'undefined') globalThis.history = { replaceState: function () {} };
  if (typeof location === 'undefined') globalThis.location = { hash: '' };
  var was = history.replaceState;
  history.replaceState = function (s, t, u) { replaced.push(u); };
  location.hash = '#/people';
  pg.hist = []; pg.from = {}; pg.render = function () {};
  pg.onHash();
  history.replaceState = was;
  ok('#/people opens where the host says it is now', replaced, ['#/example/people']);
})();

print('\n=== the host\'s pages only (house: false) ===');
(function () {
  EXAMPLE_PAGES.length = 0;
  ws.length = 0;
  var pg = page(example({ house: false }), null);
  pg.hostOnly = true;
  var s = side(pg);
  ok('the sidebar: the host\'s groups, none of HK\'s', s, ['A Fictional Person', 'Example: People, Links']);
  ok('an empty address opens the host\'s first page', pg.rootPage().title, 'Example me');
  ok('HK\'s own addresses open it too, reading nothing', pg.resolve(['screens', 'dashboard-kitchen']).title, 'Example me');
  pg.q = 'kitchen';
  ok('search knows only the host\'s pages', texts(pg.searchResults()).join(' ').indexOf('Kitchen'), -1);
  ok('nothing was asked of the house', ws, []);
  // the page's start: with house: false it never reads HK's settings
  var src = SRC.slice(SRC.indexOf('    async boot()'), SRC.indexOf('    measure()'));
  ok('boot: the host\'s pages only stop before reload()', src.indexOf('if (this.hostOnly) {') < src.indexOf('await this.reload()'), true);
  ok('render draws a page with no data of HK\'s', SRC.indexOf('if (!this.ready || (!this.data && !this.hostOnly)) return;') > 0, true);
})();

print('\n=== the Preview button ===');
(function () {
  localStorage.removeItem('hk-preview-pinned');
  var pg = page(null);
  pg.bar = document.createElement('div');
  // (the stub DOM's selectors stand alone: this one finds the bar's own button, or nothing)
  pg.bar.querySelector = function (sel) {
    return sel === '.pvtoggle' ? walk(pg.bar).filter(function (e) { return e !== pg.bar && e.className === 'pvtoggle'; })[0] || null : null;
  };
  pg.render = function () { pg.rendered = (pg.rendered || 0) + 1; };
  pg.previewButton(false, false);
  ok('a page with no preview: no button', walk(pg.bar).filter(function (e) { return e.className === 'pvtoggle'; }).length, 0);
  pg.previewButton(true, false);
  var b = walk(pg.bar).filter(function (e) { return e.className === 'pvtoggle'; })[0];
  ok('a page with one: the button, not pressed', [!!b, b && b.getAttribute('aria-pressed'), b && b.getAttribute('aria-label')], [true, 'false', 'Pin Preview']);
  ok('...a pin and the word Pin (an eye alone said nothing)', [texts(b).join(' '), SRC.indexOf("b.appendChild(K.icon('mdi:pin', ''));") > 0], ['Pin', true]);
  b.click();
  ok('pressed: pinned, remembered, drawn again', [localStorage.getItem('hk-preview-pinned'), pg.rendered], ['1', 1]);
  pg.previewButton(true, true);
  ok('...and it says so', [b.getAttribute('aria-pressed'), b.getAttribute('aria-label'), texts(b).join(' ')], ['true', 'Pin Preview', 'Pinned']);
  b.click();
  ok('pressed again: let go', localStorage.getItem('hk-preview-pinned'), null);
  pg.previewButton(false, false);
  ok('a page without a preview takes it away', walk(pg.bar).filter(function (e) { return e.className === 'pvtoggle'; }).length, 0);
  ok('pinned, it is drawn at the top of the page, before the title', SRC.indexOf("pcol.classList.add('pin'); this._pv.pinned = true; this.pageEl.insertBefore(pcol, head);") > 0, true);
  ok('a desk-wide window keeps it beside the page, with no button', SRC.indexOf("this.previewButton(!xwide && !!pg.preview, pinned);") > 0, true);
})();

print('\n=== a host\'s own groups on a wall tablet\'s page (extend) ===');
(function () {
  var TAB = { tablets: { living_room: { name: 'Living Room', screen: 'dashboard-kitchen', app: 'kiosk_satellite', sleep: {}, parts: {} } } };
  function tabletPage(host) {
    var pg = page(host, Object.assign(JSON.parse(JSON.stringify(DATA)), TAB));
    var c = document.createElement('div');
    pg.resolve(['house', 'tablets', 'living_room']).body(c);
    return c;
  }
  var asked = [];
  var x = example();
  x.extend = function (where, c, ctx) {
    asked.push([where, ctx]);
    var g = document.createElement('section'); g._text = 'The host’s own group'; c.appendChild(g);
  };
  var c = tabletPage(x);
  ok('the host is asked on a tablet\'s page, with the tablet', asked, [['tablet', { tablet: 'living_room', name: 'Living Room', app: 'kiosk_satellite' }]]);
  ok('...and what it draws is on the page', texts(c).indexOf('The host’s own group') >= 0, true);
  var y = example(); y.extend = function () { throw new Error('a host that fails'); };
  ok('a host that throws leaves HK\'s page whole', texts(tabletPage(y)).indexOf('Setup') >= 0, true);
  ok('a host without extend: HK\'s page alone', texts(tabletPage(example())).indexOf('Setup') >= 0, true);
  ok('Home Assistant (no host): HK\'s page alone', texts(tabletPage(null)).indexOf('The host’s own group') < 0, true);
})();

print('\n=== a host\'s own groups on a screen\'s page (extend) ===');
(function () {
  function screenPage(host) {
    var pg = page(host, Object.assign(JSON.parse(JSON.stringify(DATA)), { boards: { 'dashboard-kitchen': { categories: [], menu_top: [] } } }));
    pg.setAttribute('wide', '');                 // (a desk-wide page: its preview beside it, no Open Screen row)
    var c = document.createElement('div');
    pg.resolve(['screens', 'dashboard-kitchen']).body(c);
    return c;
  }
  var asked = [];
  var x = example();
  x.extend = function (where, c, ctx) {
    asked.push([where, ctx]);
    var g = document.createElement('section'); g._text = 'The host’s own group'; c.appendChild(g);
  };
  var c = screenPage(x), t = texts(c);
  ok('the host is asked on a screen\'s page, with the screen', asked, [['screen', { screen: 'dashboard-kitchen', title: 'Kitchen' }]]);
  ok('...and what it draws follows This Device', t.indexOf('The host’s own group') > t.indexOf('This Device'), true);
  var y = example(); y.extend = function () { throw new Error('a host that fails'); };
  ok('a host that throws leaves HK\'s page whole', texts(screenPage(y)).indexOf('Copy Settings From…') >= 0, true);
  ok('Home Assistant (no host): HK\'s page alone', texts(screenPage(null)).indexOf('The host’s own group') < 0, true);
})();

print('\n=== a tablet\'s Reload, Clear Cache ... (press): HA\'s buttons, or the host\'s own parts ===');
(function () {
  function drain() { for (var i = 0; i < 8; i++) drainMicrotasks(); }
  var calls = [], alerts = [], said = [];
  var K = window.hkSettingsKit, hold = K.confirm;
  K.confirm = function (root, o) { alerts.push([o.title, o.message, o.cancel]); return Promise.resolve(true); };
  function pg0(host, answer) {
    var pg = page(host);
    pg.announce = function (t) { said.push(t); };
    pg.client.actions = { callService: function (d, s, data) { calls.push([d, s, data]); return answer || Promise.resolve(); } };
    return pg;
  }
  var got = [];
  pg0(null).press(['button.kitchen_kiosk_reload_page', null], 'Reload').then(function (v) { got.push(v); });
  drain();
  ok('Home Assistant (no host): the kiosk app\'s buttons, pressed', [calls, got], [[['button', 'press', { entity_id: ['button.kitchen_kiosk_reload_page'] }]], [true]]);
  var asked = [], x = example();
  x.press = function (ids, panel) { asked.push([ids, !!panel]); return Promise.resolve(); };
  calls = []; got = [];
  pg0(x).press(['example:kitchen:reload'], 'Reload').then(function (v) { got.push(v); });
  drain();
  ok('a host\'s own parts go to the host, not to Home Assistant', [asked, calls, got], [[[['example:kitchen:reload'], true]], [], [true]]);
  var y = example(); y.press = function () { return null; };
  calls = [];
  pg0(y).press(['button.x_reload_page']);
  drain();
  ok('a host that answers null leaves them to Home Assistant', calls.length, 1);
  var z = example(); z.press = function () { return Promise.reject(new Error('Commands are off here.')); };
  got = []; said = [];
  pg0(z).press(['example:kitchen:reload'], 'Reload').then(function (v) { got.push(v); });
  drain();
  ok('a refusal is said, in an alert with OK alone', [got, alerts, said], [[false], [['Couldn’t Reload', 'Commands are off here.', false]], ['Couldn’t: Commands are off here.']]);
  alerts = []; got = [];
  pg0(null, Promise.reject({ message: 'Home Assistant refused it.' })).press(['button.x'], 'Restart the App').then(function (v) { got.push(v); });
  drain();
  ok('...and Home Assistant\'s too', [got, alerts], [[false], [['Couldn’t Restart the App', 'Home Assistant refused it.', false]]]);
  K.confirm = hold;
})();

print(fail ? 'FAIL ' + fail + ' SETTINGS HOST TESTS' : 'ALL ' + pass + ' SETTINGS HOST TESTS PASS');
if (fail) throw new Error('settings host tests failed');
