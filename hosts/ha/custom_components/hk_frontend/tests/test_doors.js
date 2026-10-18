// The Doors & Windows page: stateful glyphs, and the iconset entries they need.
//
// A tile with a static `icon:` draws every door and window as OPEN, whatever
// its state. The card is not where this fails -- hk-tile's `icon_states` map
// resolves a state to a glyph, as the garage tiles use it -- but the page is
// only right if the iconset has the closed glyphs it asks for.
//
// So this suite pins BOTH halves -- the card resolving a state to a glyph, and
// the iconset actually having the glyph the page asks for. Either one alone
// passes while the page is still wrong.
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }

load(root + '/tests/dom.js');
['hk-base', 'hk-tile'].forEach(function (n) { load(root + '/frontend/cards/' + n + '.js'); });

function card(tag, cfg) {
  var c = Object.create(customElements.get(tag).prototype);
  c._config = cfg; hkGive(c, { states: {} }); return c;
}
function state(s) { return { state: s, attributes: {} }; }

// --- the card half -------------------------------------------------------
var door = card('hk-tile-card', {
  icon: 'hk:door-open',
  icon_states: { 'off': 'hk:door-closed' },
  label_mode: 'open_closed'
});
check('open door keeps the open glyph', door._icon(state('on')) === 'hk:door-open');
check('closed door swaps to the closed glyph', door._icon(state('off')) === 'hk:door-closed');
// A sensor that cannot report must not claim CLOSED -- the glyph falls back to
// the default (open) while the label says Unavailable, so the tile never reads
// as reassuring. Same rule as the all-clear banner on this page.
check('unavailable door does not read as closed', door._icon(state('unavailable')) === 'hk:door-open');
check('unknown door does not read as closed', door._icon(state('unknown')) === 'hk:door-open');

var win = card('hk-tile-card', {
  icon: 'hk:window-open-variant',
  icon_states: { 'off': 'hk:window-closed-variant' }
});
check('open window keeps the open glyph', win._icon(state('on')) === 'hk:window-open-variant');
check('closed window swaps', win._icon(state('off')) === 'hk:window-closed-variant');

// YAML 1.1 reads a BARE `off:` key as the boolean false, which would leave the
// map keyed on something no state ever equals -- a silent no-op that looks
// exactly like a working config. The page quotes it; this pins what happens if
// someone unquotes it, so the failure is loud here rather than invisible there.
var unquoted = card('hk-tile-card', { icon: 'hk:door-open', icon_states: { false: 'hk:door-closed' } });
check('a boolean-false key cannot match a state', unquoted._icon(state('off')) === 'hk:door-open');

// --- the iconset half ----------------------------------------------------
// Loading the REAL file, because a grep cannot prove the JS parses or that the
// entry resolves.
globalThis.window = globalThis;
window.console = { info: function () {}, warn: function () {}, error: function () {} };
window.setInterval = function () { return 0; };
window.setTimeout = function () { return 0; };
window.clearInterval = function () {};
window.addEventListener = function () {};
globalThis.document = { querySelectorAll: function () { return []; }, addEventListener: function () {}, hidden: false };
customElements.whenDefined = function () { return Promise.resolve(); };
// The glyph DATA is Apple's and does not ship with the integration (see
// frontend/iconset/hk-icons.js). A home's own copy is checked when tests/run is
// given its files folder (HK_FILES=...); otherwise a fixture with stand-in
// paths proves the loader: registration, the alias, the two-tone split.
var glyphs = (typeof HK_FILES === 'string' && HK_FILES) ? HK_FILES + '/iconset/hk-glyphs.js'
                                                       : root + '/tests/fixtures/glyph-rectangles.js';
load(glyphs);
load(root + '/frontend/iconset/hk-icons.js');

var NEEDED = ['door-open', 'door-closed', 'window-open-variant', 'window-closed-variant',
              'garage', 'garage-open'];
var got = {};
Promise.all(NEEDED.map(function (n) {
  return Promise.resolve(window.customIconsets.hk(n)).then(function (v) { got[n] = v; });
})).then(function () {
  NEEDED.forEach(function (n) {
    var v = got[n];
    check('hk:' + n + ' resolves to a path', !!(v && v.path && v.path.indexOf('M ') === 0));
  });
  // The alias is a REFERENCE, not a copy, so it can never drift from the entry
  // it points at. Identity, not equality -- a copied string would pass an
  // equality check today and silently diverge the first time one is edited.
  return Promise.resolve(window.customIconsets.hk('door-closed-lock')).then(function (lock) {
    check('door-closed IS door-closed-lock, not a copy of it',
          got['door-closed'].path === lock.path);
    // Each pair must be two DIFFERENT drawings, or the swap is invisible.
    check('the door pair differs', got['door-open'].path !== got['door-closed'].path);
    check('the window pair differs', got['window-open-variant'].path !== got['window-closed-variant'].path);
    check('the garage pair differs', got['garage'].path !== got['garage-open'].path);
    print(fail ? 'FAIL ' + fail + ' DOOR TESTS' : 'ALL ' + pass + ' DOOR TESTS PASS');
  });
});
