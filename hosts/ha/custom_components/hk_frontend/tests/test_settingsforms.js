// Phase 2 P2.4: THE HK SETTINGS PANEL DRAWS WITH HK'S OWN CONTROLS.
//
// The panel's YAML pages (a custom page's content, a pop-up's cards, a custom
// chip, a screensaver's / kiosk plugin's options) used Home Assistant's
// ha-yaml-editor, loaded through a hidden ha-form; the sidebar button on a
// narrow window was HA's ha-menu-button. Now:
//   - the YAML editor is the kit's (hkSettingsKit.yaml), with the kit's own
//     YAML reader and writer (what js-yaml read in that editor);
//   - the sidebar button is the host shell's (hkShell.menuButton): HA's own
//     element in HA (made in hk-ha-shell.js), none in Mantel.
// What each YAML page SAVES is pinned here: the same messages, paths and
// bodies through client.actions as before (this suite's message cases were
// run against the panel before the change, with a stand-in for HA's editor
// handing over what it parsed, and gave the same).
//
// Every host here is a recorder over fictional entities. Nothing is sent.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run settingsforms');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/panels/hk-settings-features.js');
var SRC = read(HK_ROOT + '/frontend/panels/hk-settings.js');
var KIT_SRC = read(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
// which elements the page asks the registry for while it draws
var asked = [], _get = customElements.get;
customElements.get = function (n) { asked.push(n); return _get.call(customElements, n); };
(0, eval)(SRC.replace('  var M = null, K = null, h = null, F = null;',
  '  var M = window.hkSettingsModel, K = window.hkSettingsKit, h = K.h, F = window.hkSettingsFeatures; F.use(K);'));

// (the stub DOM, enough for a YAML page: a group's cells replaced by the box)
var EP = document.createElement('div').constructor.prototype;
EP.replaceWith = function (n) { if (this.parentNode) this.parentNode.replaceChild(n, this); };
// (its innerHTML makes no nodes: a chevron's svg comes back undefined)
var ap0 = EP.appendChild;
EP.appendChild = function (c) { return c ? ap0.call(this, c) : c; };
// a class selector finds a real descendant first (the stub DOM's selectors otherwise stand alone)
var q0 = EP.querySelector;
EP.querySelector = function (sel) {
  var m = /^\.([\w-]+)$/.exec(sel);
  if (m) {
    var hit = walk(this).filter(function (e) { return typeof e.className === 'string' && (' ' + e.className + ' ').indexOf(' ' + m[1] + ' ') >= 0; })[0];
    if (hit) return hit;
  }
  return q0.call(this, sel);
};
if (!('classList' in EP)) {
  Object.defineProperty(EP, 'classList', { get: function () {
    var el = this, has = function (c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') >= 0; };
    return { contains: has, add: function (c) { if (!has(c)) el.className = (el.className ? el.className + ' ' : '') + c; },
             remove: function (c) { el.className = (' ' + el.className + ' ').replace(' ' + c + ' ', ' ').trim(); },
             toggle: function (c, on) { if (on === undefined ? !has(c) : on) this.add(c); else this.remove(c); } };
  } });
}
if (!document.createTextNode) document.createTextNode = function (t) { var e = document.createElement('#text'); e.textContent = String(t); return e; };

var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
function drain() { for (var i = 0; i < 20; i++) drainMicrotasks(); }
function fire(el, type, ev) { (el._listeners[type] || []).slice().forEach(function (f) { f(ev || {}); }); }
var K = window.hkSettingsKit, Y = K.yamlParse, D = K.yamlDump;
function err(text) { try { Y(text); return null; } catch (e) { return e.message; } }

print('=== the kit reads YAML as HA\'s editor (js-yaml) read it ===');
ok('a chip, as the Custom Chip page\'s example writes it',
   Y('type: custom:hk-status-chip-card\nentity: sensor.home_battery_level\nname: House Battery\nicon: hk:home-battery\n' +
     'icon_color: green\ntap_action:\n  action: navigate\n  navigation_path: ./power'),
   { type: 'custom:hk-status-chip-card', entity: 'sensor.home_battery_level', name: 'House Battery', icon: 'hk:home-battery',
     icon_color: 'green', tap_action: { action: 'navigate', navigation_path: './power' } });
ok('a pop-up\'s cards: a list of mappings',
   Y('- type: custom:hk-heading-card\n  name: Garage\n- type: tile\n  entity: cover.garage_door'),
   [{ type: 'custom:hk-heading-card', name: 'Garage' }, { type: 'tile', entity: 'cover.garage_door' }]);
ok('a list under its key at the key\'s indent, then the next key', Y('cards:\n- a\n- b\nmax: 3'), { cards: ['a', 'b'], max: 3 });
ok('nested lists and mappings, a "- - " line',
   Y('a:\n  - name: x\n    items:\n      - 1\n      - - 2\n        - 3\n  - name: y'),
   { a: [{ name: 'x', items: [1, [2, 3]] }, { name: 'y' }] });
ok('the core schema: null, bools, ints (hex, octal, _), floats, .inf; a quoted number is a string',
   Y('a: ~\nb:\nc: True\nd: false\ne: 0x1F\nf: 0o17\ng: 1_000\nh: -1.5e3\ni: .5\nj: -.inf\nk: \'12\'\nl: "on"\nm: on'),
   { a: null, b: null, c: true, d: false, e: 31, f: 15, g: 1000, h: -1500, i: 0.5, j: -Infinity, k: '12', l: 'on', m: 'on' });
ok('...NaN', isNaN(Y('x: .nan').x), true);
ok('a timestamp: the ISO string it was sent as (js-yaml made a Date)',
   Y('d: 2026-10-18\nt: 2026-10-18 07:30:00 +02:00'), { d: '2026-10-18T00:00:00.000Z', t: '2026-10-18T05:30:00.000Z' });
ok('plain text with colons, a URL, a time in quotes', Y('u: http://x.local:8123/a\nc: a:b\nt: \'12:30\''),
   { u: 'http://x.local:8123/a', c: 'a:b', t: '12:30' });
ok('comments: a line, after a value, never inside quotes', Y('# top\na: 1 # one\nb: \'x # y\' # z\nc: "p#q"'), { a: 1, b: 'x # y', c: 'p#q' });
ok('quoted scalars: escapes, \'\' in single quotes', Y('a: "t\\tn\\n\\u00e9\\x41"\nb: \'it\'\'s\''), { a: 't\tn\n\u00e9A', b: "it's" });
ok('quoted and plain scalars over several lines fold', Y('a: "one\n  two\n\n  three"\nb: \'x\n  y\'\nc: plain\n  more'),
   { a: 'one two\nthree', b: 'x y', c: 'plain more' });
ok('...a double-quoted line ending in an escape runs on', Y('a: "one \\\n  two"\nb: "x\\\\\n  y"'), { a: 'one two', b: 'x\\ y' });
ok('| keeps its lines; |- strips the last break; |+ keeps them all',
   Y('a: |\n  one\n  two\n\nb: |-\n  s\nc: |+\n  k\n\nd: 1'), { a: 'one\ntwo\n', b: 's', c: 'k\n\n', d: 1 });
ok('> folds, more-indented lines kept as they are', Y('a: >\n  one\n  two\n\n  para\n    code\n  back\n'),
   { a: 'one two\npara\n  code\nback\n' });
ok('an indentation indicator', Y('a: |2\n    two extra\n  base\n'), { a: '  two extra\nbase\n' });
ok('flow collections, over lines too, and JSON', Y('a: [1, [2], {b: c}]\nm: {x: 1,\n  y: 2}\nj: {"k": [true, null]}'),
   { a: [1, [2], { b: 'c' }], m: { x: 1, y: 2 }, j: { k: [true, null] } });
ok('a whole document in JSON', Y('{"type": "tile", "entity": "light.porch"}'), { type: 'tile', entity: 'light.porch' });
ok('anchors, aliases and a << merge (explicit keys win)', Y('b: &b\n  x: 1\n  y: 2\nd:\n  <<: *b\n  y: 3\nl: [*b]'),
   { b: { x: 1, y: 2 }, d: { x: 1, y: 3 }, l: [{ x: 1, y: 2 }] });
ok('quoted and number keys are strings', Y('"a b": 1\n\'c\': 2\n3: three\nnull: n'), { 'a b': 1, c: 2, '3': 'three', 'null': 'n' });
ok('a document marker and its end', Y('---\na: 1\n...\n'), { a: 1 });
ok('a scalar document is that scalar; a comment alone is nothing (undefined, as js-yaml)', [Y('hello there'), Y('# c') === undefined],
   ['hello there', true]);
ok('core tags', Y('a: !!str 12\nb: !!int "7"\nc: !!float 1'), { a: '12', b: 7, c: 1 });

print('\n=== ...and refuses what js-yaml refused, saying where ===');
ok('a duplicated key', err('a: 1\na: 2'), 'duplicated mapping key "a" (line 2)');
ok('a tab as indent', err('a:\n\tb: 1'), 'a tab cannot indent (line 2)');
ok('an unknown tag (!secret, !include: HA\'s editor refused them too)', err('a: !secret pw'), 'unknown tag !secret (line 1)');
ok('a key out of line', err('a:\n  b: 1\n c: 2'), 'bad indentation of a mapping entry (line 3)');
ok('a value with a key under it', err('a: 1\n  b: 2'), 'bad indentation of a mapping entry or a sequence item (line 2)');
ok('an unclosed quote', err("a: 'open"), 'a quoted string is not closed (line 1)');
ok('an unclosed flow collection', err('a: [1, 2'), 'a flow collection is not closed (line 1)');
ok('an alias with no anchor', err('a: *nope'), 'unidentified alias "nope" (line 1)');
ok('a list item after a mapping', err('a: 1\n- b'), 'unexpected text (line 2)');
ok('a bad escape', err('a: "\\q"'), 'an unknown escape \\q (line 1)');

print('\n=== the kit writes YAML that reads back as the same value ===');
ok('a card: block style, two spaces, keys in order', D({ type: 'tile', entity: 'light.porch', tap_action: { action: 'more-info' },
                                                        features: [{ type: 'light-brightness' }], tags: ['a', 'b'], none: {}, list: [] }),
   'type: tile\nentity: light.porch\ntap_action:\n  action: more-info\nfeatures:\n  - type: light-brightness\ntags:\n  - a\n  - b\nnone: {}\nlist: []\n');
ok('a list of cards', D([{ type: 'a', size: 1 }, [1, 2]]), '- type: a\n  size: 1\n- - 1\n  - 2\n');
ok('...a key YAML 1.1 read as a bool is quoted, as js-yaml writes it', D({ n: 1, on: 2 }), '"n": 1\n"on": 2\n');
ok('strings quoted only where they would read back as something else',
   D({ a: '12', b: 'true', c: 'on', d: '', e: 'x: y', f: 'a #b', g: ' pad', h: 'custom:hk-card', i: "it's", j: '- x', k: '-x', l: null, m: 1.5 }),
   'a: "12"\nb: "true"\nc: "on"\nd: ""\ne: "x: y"\nf: "a #b"\ng: " pad"\nh: custom:hk-card\ni: it\'s\nj: "- x"\nk: -x\nl: null\nm: 1.5\n');
ok('a multi-line string as a | block, its trailing breaks as chomping', D({ a: 'one\ntwo', b: 'x\n', c: 'y\n\n' }),
   'a: |-\n  one\n  two\nb: |\n  x\nc: |+\n  y\n\n');
(function () {
  var strange = ['', ' ', 'a\n b', '\n  lead', 'tab\there', '\u2028', '\u0001', '*a', '&a', '!t', '%x', '@x', '`x', '...', '---', '<<',
                 '.inf', '1e5', '0o7', '+1', 'yes', 'No', 'Null', '~', '[x', '{x', 'x]', 'é 漢', '\\', '"q"', "'s'", 'a\n  \nb', 'a\n\n\n'];
  var v = { list: strange, map: {} };
  strange.forEach(function (s) { v.map[s] = s; });
  ok('strange strings, as values and as keys, read back unchanged', Y(D(v)), v);
  ok('numbers and specials', Y(D({ n: [-0.5, 1e21, Infinity, -Infinity, 0, -3] })), { n: [-0.5, 1e21, Infinity, -Infinity, 0, -3] });
})();

print('\n=== the kit\'s YAML editor ===');
(function () {
  var seen = [];
  var box = K.yaml({ value: { type: 'tile', entity: 'light.porch' }, label: 'Card', fk: 'card:yaml', onChange: function (v, valid) { seen.push([v, valid]); } });
  var ta = box.textarea;
  ok('a text field of its own (no host element), named', [ta.tagName, ta.getAttribute('aria-label'), ta.getAttribute('data-fk')],
     ['textarea', 'Card', 'card:yaml']);
  ok('the value written out to begin with', ta.value, 'type: tile\nentity: light.porch\n');
  ok('...nothing for an empty one (as HA\'s editor)', [K.yaml({ value: {}, onChange: function () {} }).textarea.value,
                                                     K.yaml({ value: [], onChange: function () {} }).textarea.value], ['', '']);
  ta.value = 'type: tile\nentity: light.kitchen\n'; fire(ta, 'input');
  ok('each change read back: (value, valid)', seen.pop(), [{ type: 'tile', entity: 'light.kitchen' }, true]);
  ta.value = ''; fire(ta, 'input');
  ok('empty text is {}', seen.pop(), [{}, true]);
  ta.value = 'a: [1'; fire(ta, 'input');
  var last = seen.pop();
  ok('a mistake: (undefined, false)', [last[0] === undefined, last[1]], [true, false]);
  var msg = box.children[1];
  ok('...said under it, by line, and marked', [msg.textContent, ta.getAttribute('aria-invalid'), box.className, box.valid],
     ['a flow collection is not closed (line 1)', 'true', 'codebox bad', false]);
  ok('...the field says where its message is', ta.getAttribute('aria-describedby') === msg.getAttribute('id'), true);
  ta.value = 'a: [1]'; fire(ta, 'input');
  ok('mended: valid again, the message gone', [seen.pop(), msg.textContent, box.className, ta.getAttribute('aria-invalid')],
     [[{ a: [1] }, true], '', 'codebox', 'false']);
  ok('the kit\'s CSS draws it', /\.codebox textarea\{/.test(K.CSS) && /\.codebox \.codeerr\{/.test(K.CSS), true);
})();

// ---------------------------------------------------------- the panel
var P = customElements.get('hk-settings-panel').prototype;
var STATES = { 'light.porch': { entity_id: 'light.porch', state: 'off', attributes: { friendly_name: 'Porch' } } };
function response(status, body) {
  return { ok: status >= 200 && status < 300, status: status,
           headers: { get: function (k) { return String(k).toLowerCase() === 'content-type' ? 'application/json' : null; } },
           json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } };
}
// HA's frontend object, recording each callWS message and each fetchWithAuth (a config flow's step)
function recorder() {
  var rec = { ws: [], flows: [] };
  rec.hass = {
    states: STATES, entities: {}, devices: {}, areas: {}, config: {}, themes: {}, user: { is_admin: true },
    callWS: function (msg) { rec.ws.push(msg); return Promise.resolve({ ok: true }); },
    fetchWithAuth: function (path, init) {
      rec.flows.push([path, init.method, init.body ? JSON.parse(init.body) : null]);
      return Promise.resolve(response(200, init.method === 'POST' && /flow$/.test(path) ? { flow_id: 'f1', step_id: 'init' } : { type: 'create_entry' }));
    },
    callService: function () { throw new Error('no service call is expected here'); }
  };
  return rec;
}
function mantel() {
  var m = { refused: [], reached: [] };
  m.client = window.hkClient.create({ states: STATES, entities: {}, devices: {}, areas: {},
    callWS: function (msg) { m.reached.push(msg); return Promise.resolve({}); },
    refused: function (d) { m.refused.push(d.kind + ' ' + d.what); } });
  return m;
}
function page(client) {
  var pg = Object.create(P);
  Object.defineProperty(pg, 'client', { value: client });
  pg.errors = {}; pg.said = []; pg.statuses = []; pg.backs = [];
  pg.data = {
    entry_id: 'entry1', dashboards: [], boards: {}, settings: { sky: {}, look: {} }, chip_kinds: ['lights'],
    custom_chips: [{ key: 'battery', name: 'House Battery', after: 'end', card: { type: 'custom:hk-status-chip-card', entity: 'sensor.battery' } }],
    custom_pages: [{ path: 'garage', title: 'Garage', icon: 'mdi:garage', view: { cards: [] }, item: 'sub-page', used_on: [] }],
    popups: [{ hash: 'garage', name: 'Garage', kind: 'cards', cards: [{ type: 'tile', entity: 'cover.garage_door' }], icon: 'mdi:garage',
               width: 'narrow', close_after: 60, dashboards: ['dashboard-a'], item: 'sub-pop' }]
  };
  pg.render = function () {}; pg.soon = function () {};
  pg.status = function (s) { pg.statuses.push(s); };
  pg.announce = function (t) { pg.said.push(t); };
  pg.reload = function () { return Promise.resolve(); };
  pg.back = function (hash) { pg.backs.push(hash); };
  return pg;
}
function open(pg, route) {
  var c = document.createElement('div');
  asked.length = 0;
  P.resolve.call(pg, route.split('/')).body(c);
  drain();
  return c;
}
function editorIn(c) { return walk(c).filter(function (e) { return e.tagName === 'textarea' || e.tagName === 'ha-yaml-editor'; })[0]; }
function type(c, text) { var ta = editorIn(c); ta.value = text; fire(ta, 'input'); }
function button(c, label) {
  return walk(c).filter(function (e) { return e.tagName === 'button' && walk(e).some(function (x) { return x._text === label; }); })[0];
}
var HA_FORMS = /^(ha-form|ha-yaml-editor|ha-code-editor|ha-selector|ha-entity-picker|ha-textfield|ha-switch|ha-menu-button)$/i;

print('\n=== a YAML page draws with the kit\'s editor, no HA element ===');
(function () {
  var rec = recorder(), pg = page(window.hkHostClient.from(rec.hass));
  var c = open(pg, 'pages/garage/content');
  var ed = editorIn(c);
  ok('the editor is the kit\'s text field', [ed && ed.tagName, ed && ed.className], ['textarea', 'code']);
  ok('...holding the page\'s view as YAML', ed.value, 'cards: []\n');
  ok('no HA form element is drawn', walk(c).filter(function (e) { return HA_FORMS.test(e.tagName); }).length, 0);
  ok('...nor asked for (no hidden ha-form loading HA\'s editor)', asked.filter(function (n) { return HA_FORMS.test(n); }), []);
  ok('the panel\'s source names none of them', /'ha-(form|yaml-editor|menu-button|entity-picker|selector|textfield|switch|code-editor)'/.test(SRC), false);
  ok('...nor loads the frontend\'s card helpers for them', /loadCardHelpers/.test(SRC), false);
  ok('the kit names no host element, not even an icon (it draws hk-icon)', (KIT_SRC.match(/'ha-[a-z-]+'/g) || []), []);
})();

print('\n=== what each YAML page saves (the same as with HA\'s editor) ===');
(function () {
  // A CUSTOM PAGE'S CONTENT: its flow, the view as written
  var rec = recorder(), pg = page(window.hkHostClient.from(rec.hass));
  var c = open(pg, 'pages/garage/content');
  type(c, 'type: sections\nmax_columns: 3\ncards:\n  - type: tile\n    entity: light.porch # the porch\n');
  button(c, 'Save').click(); drain();
  ok('a page\'s content: its item\'s flow, then the title, the view as written and the icon', rec.flows, [
    ['/api/config/config_entries/subentries/flow', 'POST', { handler: ['entry1', 'page'], subentry_id: 'sub-page' }],
    ['/api/config/config_entries/subentries/flow/f1', 'POST',
     { title: 'Garage', view: { type: 'sections', max_columns: 3, cards: [{ type: 'tile', entity: 'light.porch' }] }, icon: 'mdi:garage' }]]);
  ok('...and says Saved', pg.statuses, ['saving', 'saved']);
  // emptied: {} (HA's editor gave {} for empty text)
  rec.flows.length = 0; pg.statuses.length = 0;
  c = open(pg, 'pages/garage/content');
  type(c, '');
  button(c, 'Save').click(); drain();
  ok('emptied: the view is {}', rec.flows[1][2].view, {});
  // not a mapping (a word): {} as before
  rec.flows.length = 0;
  c = open(pg, 'pages/garage/content');
  type(c, 'just words');
  button(c, 'Save').click(); drain();
  ok('a scalar is no options: {}', rec.flows[1][2].view, {});
  // a mistake: nothing saved, the page says so
  rec.flows.length = 0;
  c = open(pg, 'pages/garage/content');
  type(c, 'cards: [');
  button(c, 'Save').click(); drain();
  ok('a mistake: nothing is sent, and it is said', [rec.flows.length, pg.said.pop()], [0, 'The YAML has a mistake.']);
})();
(function () {
  // A POP-UP'S CARDS: the pop-up's flow with every value it keeps
  var rec = recorder(), pg = page(window.hkHostClient.from(rec.hass));
  var c = open(pg, 'popups/garage/cards');
  ok('the pop-up\'s cards written out', editorIn(c).value, '- type: tile\n  entity: cover.garage_door\n');
  type(c, '- type: custom:hk-heading-card\n  name: Garage\n- type: tile\n  entity: cover.garage_door\n');
  button(c, 'Save').click(); drain();
  ok('a pop-up\'s cards: its item\'s flow, then its values with the cards as written', rec.flows, [
    ['/api/config/config_entries/subentries/flow', 'POST', { handler: ['entry1', 'popup'], subentry_id: 'sub-pop' }],
    ['/api/config/config_entries/subentries/flow/f1', 'POST',
     { name: 'Garage', close_after: 60, dashboards: ['dashboard-a'],
       cards: [{ type: 'custom:hk-heading-card', name: 'Garage' }, { type: 'tile', entity: 'cover.garage_door' }], icon: 'mdi:garage', width: 'narrow' }]]);
  // one card, not in a list: a list of it (the page's own rule)
  rec.flows.length = 0;
  c = open(pg, 'popups/garage/cards');
  type(c, '{"type": "tile", "entity": "light.porch"}');
  button(c, 'Save').click(); drain();
  ok('one card written alone (here as JSON): a list of it', rec.flows[1][2].cards, [{ type: 'tile', entity: 'light.porch' }]);
})();
(function () {
  // A CUSTOM CHIP: chip/save on the action port, the card as written; the draft kept on the page
  var rec = recorder(), pg = page(window.hkHostClient.from(rec.hass));
  var c = open(pg, 'chips/battery');
  ok('the chip\'s card written out', editorIn(c).value, 'type: custom:hk-status-chip-card\nentity: sensor.battery\n');
  type(c, 'type: custom:hk-status-chip-card\nentity: sensor.battery\nicon_color: green\n');
  ok('a valid change is the page\'s draft (kept over a redraw)', pg._chipForms.battery.card,
     { type: 'custom:hk-status-chip-card', entity: 'sensor.battery', icon_color: 'green' });
  type(c, 'type: [');
  ok('...a mistake is not', pg._chipForms.battery.card.icon_color, 'green');
  c = open(pg, 'chips/battery');
  ok('a redraw shows the draft', editorIn(c).value, 'type: custom:hk-status-chip-card\nentity: sensor.battery\nicon_color: green\n');
  button(c, 'Save Chip').click(); drain();
  ok('chip/save through the action port, the card as written', rec.ws, [{ type: 'hk_frontend/chip/save', name: 'House Battery', after: 'end',
     card: { type: 'custom:hk-status-chip-card', entity: 'sensor.battery', icon_color: 'green' }, key: 'battery' }]);
})();
(function () {
  // MANTEL: the same save is refused at the port; nothing reaches the host
  var m = mantel(), pg = page(m.client);
  var c = open(pg, 'pages/garage/content');
  type(c, 'cards: []\n');
  button(c, 'Save').click(); drain();
  ok('Mantel: the page\'s flow refused at the port, nothing reached', [m.refused, m.reached],
     [['http POST /api/config/config_entries/subentries/flow'], []]);
  ok('...the page says it couldn\'t', pg.statuses, ['saving', 'error']);
})();

print('\n=== the sidebar button is the host shell\'s ===');
(function () {
  var calls = [], was = window.hkShell.menuButton, btn = { fake: true };
  window.hkShell.menuButton = function (el, o) { calls.push([el, Object.keys(o)]); return was.apply(window.hkShell, arguments); };
  var pg = Object.create(P);
  pg.attrs = {}; pg.hasAttribute = HTMLElement.prototype.hasAttribute; pg.toggleAttribute = HTMLElement.prototype.toggleAttribute;
  pg.boot = function () {}; pg._menuBtn = btn;
  var fe = { states: {}, themes: {} };
  pg.hass = fe;
  ok('a new client: the shell hands it to the button', [calls[0][0] === btn, calls[0][1]], [true, ['client']]);
  ok('...in HA, the frontend\'s object', btn.hass === fe, true);
  pg.narrow = true;
  ok('narrow: the shell hands it on', [calls[1][1], btn.narrow], [['narrow'], true]);
  window.hkShell.menuButton = was;
  // the sidebar draws the button only where the host has one
  var side = function (shell) {
    var p2 = Object.create(P), hold = window.hkShell.menuButton;
    window.hkShell.menuButton = shell;
    Object.defineProperty(p2, 'client', { value: window.hkHostClient.from(fe) });
    p2.attrs = {}; p2.hasAttribute = function () { return false; };
    p2._narrow = true; p2.q = ''; p2.errors = {};
    p2.shadowRoot = { activeElement: null };
    p2.sideEl = document.createElement('nav');
    p2.data = { dashboards: [], boards: {}, settings: { sky: {}, look: {} }, accessories: { entities: {} }, features: {}, popups: [], custom_pages: [], custom_chips: [] };
    try { P.paintSide.call(p2, []); } catch (e) { /* the rest of the sidebar needs more than this stub */ }
    window.hkShell.menuButton = hold;
    var head = walk(p2.sideEl).filter(function (e) { return e.className === 'sidehead' || e.className === 'sidehead menubtn'; })[0];
    return head ? head.className + ':' + head.children.map(function (e) { return e.tagName; }).join(',') : 'no head';
  };
  ok('a host with a sidebar: its button first in the sidebar\'s head', side(function () { return document.createElement('x-host-menu'); }),
     'sidehead menubtn:x-host-menu,h1');
  ok('a host with none (Mantel): just the title', side(function () { return null; }), 'sidehead:h1');
})();

print(fail ? 'FAIL ' + fail + ' SETTINGS FORMS TESTS' : 'ALL ' + pass + ' SETTINGS FORMS TESTS PASS');
if (fail) throw new Error('settings forms tests failed');
