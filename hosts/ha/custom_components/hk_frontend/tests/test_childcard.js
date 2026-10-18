// MAKE A CHILD CARD (Phase 2 P2.3): hkCards.createCard(config, client), the one way a container
// card (hk-row, the scenes row, the camera tiles) makes a card inside itself.
//
// WITH LOVELACE (HA: hkShell.tags.card is hui-card) the child is Lovelace's wrapper, made in exactly
// the order the containers used before -- created, given what goes with the client, preview off,
// the config, load() -- so HA's lazy loading and error cards are unchanged. WITHOUT LOVELACE the
// child is made directly by HK's view host (the same factory as a view's cards); with no view host
// either, an HK card by its tag and a note for anything else -- never a host element.
if (typeof HK_ROOT === 'undefined') throw new Error('HK_ROOT is not set -- run this through tests/run');
load(HK_ROOT + '/tests/dom.js');
var pass = 0, fail = 0;
function ok(name, c, d) { if (c) { pass++; print('  ok   ' + name); } else { fail++; print('  FAIL ' + name + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

// Lovelace's wrapper, recording what is done to it and in which order.
var made = [], steps = [];
var create0 = document.createElement;
document.createElement = function (tag) {
  var el = create0.call(document, tag), t = String(tag).toLowerCase();
  made.push(t);
  if (t === 'hui-card') {
    ['hass', 'client', 'preview', 'config'].forEach(function (k) {
      var v;
      Object.defineProperty(el, k, { configurable: true, get: function () { return v; },
                                     set: function (x) { v = x; steps.push(k); } });
    });
    el.load = function () { steps.push('load'); };
  }
  return el;
};
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
['hk-base', 'hk-row', 'hk-cameras'].forEach(function (f) { load(HK_ROOT + '/frontend/cards/' + f + '.js'); });
var C = window.hkCards;

var host = { states: {}, entities: {}, devices: {}, areas: {} }, client = window.hkHostClient.from(host);

// ------------------------------------------------------------------ with Lovelace (HA)
ok('HA\'s shell names Lovelace\'s card wrapper', window.hkShell.kind === 'ha' && window.hkShell.tags.card === 'hui-card' &&
   C.cardWrapper() === 'hui-card');
var cfg = { type: 'custom:hk-tile-card', entity: 'light.a' };
steps = []; made = [];
var el = C.createCard(cfg, client);
ok('with Lovelace: the child is hui-card', made.join() === 'hui-card' && el.tagName === 'hui-card', made);
ok('...made as before: HA\'s object (through the bridge), preview off, the config, load()',
   steps.join() === 'hass,preview,config,load' && el.hass === host && el.preview === false && el.config === cfg, steps);
steps = [];
var bare = C.createCard(cfg, null);
ok('...no client yet: nothing handed, the rest the same', steps.join() === 'preview,config,load' && bare.hass === undefined, steps);

var Row = customElements.get('hk-row-card');
steps = []; made = [];
var rowChild = Row.prototype._createCard.call({ client: client }, cfg);
ok('hk-row makes its children through it (hui-card in HA)', rowChild.tagName === 'hui-card' && steps.join() === 'hass,preview,config,load' &&
   rowChild.config === cfg, steps);
var Live = customElements.get('hk-camera-live-card');
steps = []; made = [];
var still = Live.prototype._card.call({ client: client, _config: { entity: 'camera.x' } }, false);
ok('a camera tile\'s picture card too, with the same config as before', still.tagName === 'hui-card' &&
   steps.join() === 'hass,preview,config,load' && still.config.type === 'picture-entity' && still.config.camera_view === 'auto' &&
   still.config.entity === 'camera.x' && still.config.aspect_ratio === '16x9' && still.config.fit_mode === 'cover' &&
   still.config.show_name === false && still.config.show_state === false, steps);

// hk-base's placement hint reads the wrapper through the shell (was: localName === 'hui-card')
ok('the placement hint asks the shell what Lovelace\'s card is', window.hkShell.is({ localName: 'hui-card' }, 'card') &&
   !window.hkShell.is({ localName: 'hk-row-card' }, 'card'));

// ------------------------------------------------------------------ without Lovelace
window.hkShell.use({ kind: 'test' });
ok('a host without Lovelace: no card wrapper', C.cardWrapper() === null);
var asked = [];
window.hkViewHost = { createCardElement: function (c, cl) { asked.push([c, cl]); var e = document.createElement('x-made'); e.made = c; return e; } };
made = []; steps = [];
var direct = C.createCard(cfg, client);
ok('...the child is made by HK\'s view host, with the config and the client', asked.length === 1 && asked[0][0] === cfg &&
   asked[0][1] === client && direct.made === cfg, asked.length);
ok('...no hui-card', made.indexOf('hui-card') < 0 && steps.length === 0, made);
var rowDirect = Row.prototype._createCard.call({ client: client }, cfg);
ok('...and hk-row\'s children too', rowDirect.made === cfg && asked.length === 2);

delete window.hkViewHost;
made = [];
var own = C.createCard({ type: 'custom:hk-spacer-card' }, client);
var note = C.createCard({ type: 'picture-entity', entity: 'camera.x' }, client);
ok('no view host either: an HK card by its tag', made[0] === 'hk-spacer-card' && typeof own.hkSetClient === 'function', made);
ok('...anything else a note, never Lovelace\'s card', note.tagName === 'div' && /picture-entity/.test(note.textContent) &&
   made.filter(function (t) { return /^hui-/.test(t); }).length === 0, made);

print('');
if (fail) { print('  FAIL ' + fail + ' CHILD CARD TESTS'); throw new Error('child card tests failed'); }
print('  ALL ' + pass + ' CHILD CARD TESTS PASS');
