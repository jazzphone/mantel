// Phase 2 P2.5 on a host with NO DETAIL AND NO TOASTS OF ITS OWN (Mantel; docs/phase2/SHEETS.md).
// Mantel's shell (web/shim/mantel-shell.js) is not part of the HA build, so a shell with the same
// answers is installed here before any HK module loads, as Mantel's home.js does: HK's own event
// names, its overlays in its own root, hostDetail/hostToast false. Pins: every more-info request is
// HK's (the generic sheet where there is no sheet of its own, sheets switched off, a request from
// outside a dashboard), its controls go through the client's action port, the admin link is hidden,
// toasts draw in HK's own layer, and HK's dialogs mount in the shell's root.
// (The client still comes from the HA client adapter of the prelude: the shell is what differs.)
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/sheet_harness.js');

var ROOT = document.createElement('div');
ROOT.id = 'hk-shell-root';
ROOT.got = [];
ROOT.dispatchEvent = function (e) { ROOT.got.push(e); dispatchEvent(e); return true; };
var MANTEL = {
  kind: 'mantel',
  root: function () { return ROOT; },
  overlayRoot: function () { return ROOT; },
  onDashboard: function () { return true; },
  isDashboard: function () { return true; },
  hostDetail: function () { return false; },
  openHostDetail: function () { return false; },
  hostToast: function () { return false; }
};
window.hkShell.use(MANTEL);

load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-detail.js');
load(HK_ROOT + '/frontend/shell/hk-overlays.js');
var D = window.hkDetail, _ = D._, C = window.hkCards, S = window.hkShell, O = window.hkOverlays;
var DASH = ['HK-TILE-CARD', 'DIV', 'HK-VIEW-CONTAINER'];
var MORE = 'hk-more-info';

print('=== the shell ===');
ok('HK\'s own event names', S.kind === 'mantel' && S.events.moreInfo === MORE && S.events.toast === 'hk-toast');
ok('no detail and no toasts of its own', S.hostDetail('scene.evening') === false && S.openHostDetail('scene.evening') === false && S.hostToast() === false);
ok('dialogRoot: the contract\'s default, the overlay root', S.dialogRoot() === ROOT);

print('\n=== more-info: every request is HK\'s ===');
var ATTRS = { friendly_name: 'Evening', icon: 'mdi:palette', entity_id: ['light.a'], mode: 'single',
              brightness_steps: 3, nested: { a: 1 }, empty: '', long: new Array(200).join('x') };
HA.hass = house({
  'light.a': ['on', { supported_color_modes: ['brightness'], brightness: 128 }],
  'scene.evening': ['2026-10-18T20:00:00+00:00', ATTRS],
  'remote.tv': ['on', { activity_list: ['TV', 'Music'] }],
  'script.goodnight': ['off', {}],
  'siren.hall': ['off', {}],
  'sun.sun': ['above_horizon', { elevation: 30, rising: true }],
  'weird.thing': ['unavailable', {}]
}, { admin: true });
resetHistory(); __resetTimers(); CALLS = [];
var e = request(MORE, 'scene.evening', DASH);
ok('a scene (no sheet of its own): taken, HK\'s generic sheet', e.taken && _.state().kind === 'generic' && _.state().panel.tagName === 'HK-DETAIL-GENERIC');
var g = _.state().panel;
ok('...mounted in the shell\'s overlay root (no host element)', _.state().el.parentNode === ROOT);
ok('...its state through client.formatEntityState', g._big.textContent === 'F:2026-10-18T20:00:00+00:00', g._big.textContent);
ok('...since when it last changed', /^Since /.test(g._since.textContent), g._since.textContent);
ok('...a long state steps down a size (a date and time)', g._big.classList.contains('long'));
var rows = g._gRows.map(function (r) { return r.key + '=' + r.name + '|' + r.value; });
ok('...its key attributes, named and formatted by the client (not the name, glyph, members, an object, an empty or a long value)',
   JSON.stringify(rows) === JSON.stringify(['mode=N:mode|V:single', 'brightness_steps=N:brightness_steps|V:3']), rows);
ok('...drawn as rows', g._gList.hidden === false && g._gList.children.length === 2 && g._gList.children[0].children[1].textContent === 'V:single');
ok('...a scene\'s one obvious control: Activate', g._gCtl.hidden === false && g._gCtl.textContent === 'Activate');
ok('...no "Open in Home Assistant" here, even for an admin (no host detail)', g._gHost.hidden === true);
g._gCtl.click();
ok('...Activate goes through the client\'s action port: scene.turn_on for this scene', CALLS.join() === 'scene.turn_on scene.evening', CALLS);
D.close(true);
e = request(MORE, 'light.a', DASH);
ok('a light: still its own sheet', e.taken && _.state().kind === 'light');
D.close(true);
e = request(MORE, 'sun.sun', ['DIV']);
ok('a request from outside a dashboard: still HK\'s (nobody else would answer)', e.taken && _.state().kind === 'generic');
D.close(true);
localStorage.setItem('hk-detail-off', '1');
e = request(MORE, 'light.a', DASH);
ok('sheets switched off: the generic sheet, even for a light (no host dialog to fall back on)', e.taken && _.state().kind === 'generic');
localStorage.removeItem('hk-detail-off');
D.close(true);
e = request(MORE, 'light.missing', DASH);
ok('an entity with no state: nothing to show, not taken', !e.taken && !_.state().el);

print('\n=== the generic sheet\'s controls ===');
function gp(id, h) {
  var P = customElements.get('hk-detail-generic'), p = new P();
  p.setConfig({ entity: id, kind: 'generic', src: {}, glass: false });
  p.hass = h;
  return p;
}
var H = HA.hass;
CALLS = [];
var r = gp('remote.tv', H);
ok('a short state keeps the big size', !r._big.classList.contains('long'));
ok('a remote that is on: Turn Off, lit',r._gCtl.hidden === false && r._gCtl.textContent === 'Turn Off' && r._gCtl.classList.contains('on'));
r._gCtl.click();
ok('...homeassistant.toggle through the action port', CALLS.join() === 'homeassistant.toggle remote.tv', CALLS);
ok('...a list attribute through the formatter', r._gRows[0].value === 'V:TV,Music', r._gRows);
ok('a script: Run (script.turn_on)', gp('script.goodnight', H)._gCtl.textContent === 'Run' &&
   JSON.stringify(_.genericControl(null, 'script.goodnight', H.states['script.goodnight'])) === JSON.stringify({ kind: 'run', label: 'Run', domain: 'script', service: 'turn_on' }));
ok('a siren: no control (HK never one-tap toggles one)', gp('siren.hall', H)._gCtl.hidden === true);
ok('the sun: no control, its lines', gp('sun.sun', H)._gCtl.hidden === true && gp('sun.sun', H)._gRows.length === 2);
var w = gp('weird.thing', H);
ok('unavailable: says so, no lines', w._big.textContent === 'Unavailable' && w._gList.hidden === true && w._gCtl.hidden === true);
CALLS = [];
var asked = null, orig = C.confirmSheet;
C.confirmSheet = function (text, go) { asked = { text: text, go: go }; };
var cp = new (customElements.get('hk-detail-generic'))();
cp.setConfig({ entity: 'scene.evening', kind: 'generic', src: { confirmation: { text: 'Really?' } }, glass: false });
cp.hass = H;
cp._gCtl.click();
ok('a tile\'s confirmation is asked first', asked && asked.text === 'Really?' && CALLS.length === 0);
asked.go();
ok('...and a yes acts', CALLS.join() === 'scene.turn_on scene.evening', CALLS);
C.confirmSheet = orig;
// the same sheet on a host that has a detail of its own: the link, for an admin only
S.use(Object.assign({}, MANTEL, { hostDetail: function () { return true; } }));
ok('on a host with a detail of its own, an admin gets the link', gp('sun.sun', H)._gHost.hidden === false);
ok('...not anyone else', gp('sun.sun', house({ 'sun.sun': ['above_horizon', {}] }, { admin: false }))._gHost.hidden === true);
S.use(MANTEL);

print('\n=== toasts: HK\'s own layer ===');
__resetTimers();
var ev = S.toast({ message: 'Playing Jazz' });
ok('hkShell.toast: HK\'s event from the shell\'s root', ev && ev.type === 'hk-toast' && ROOT.got[ROOT.got.length - 1] === ev);
var cur = O.current();
ok('...drawn in HK\'s toast layer', cur && cur.detail.message === 'Playing Jazz' && cur.el.children[0].textContent === 'Playing Jazz');
var layer = O._.layer();
ok('...the layer in the shell\'s root, a polite live region', layer.parentNode === ROOT && layer.id === 'hk-toasts' && layer.getAttribute('aria-live') === 'polite');
ok('...gone after 3 s', __timers.some(function (t) { return t && t.ms === 3000; }));
fire(function (t) { return t.ms === 3000; });
ok('...and gone', O.current() === null);
var done = 0;
S.toast({ message: 'Removed', action: { text: 'Undo', action: function () { done++; } }, duration: 10000 });
var t = O.current().el, btn = t.children[1];
ok('an action is a button with its words', btn.textContent === 'Undo');
btn.click();
ok('...pressed: done, and the toast goes', done === 1 && O.current() === null);
S.toast({ message: 'One' });
S.toast({ message: 'Two' });
ok('one at a time: a new toast replaces the one showing', O.current().detail.message === 'Two' && layer.children.filter(function (c) { return c.className === 'toast'; }).length === 1);
S.toast({ message: 'Stays', duration: -1 });
ok('duration -1: stays, with a Dismiss button', O.current().el.children[1].getAttribute('aria-label') === 'Dismiss');
O.dismiss();
dispatchEvent({ type: 'hk-toast', detail: { message: 'handled' }, defaultPrevented: true });
ok('a toast someone already handled (defaultPrevented) is not drawn again', O.current() === null);
ok('a toast with no message is nothing', O.toast({}) === null && O.current() === null);
S.use(Object.assign({}, MANTEL, { hostToast: function () { return true; } }));
S.toast({ message: 'host' });
ok('on a host that draws its own toasts, HK\'s layer stays out', O.current() === null);
S.use(MANTEL);

print('\n=== confirmations: HK\'s own dialogs in the shell\'s root ===');
var sheet = C.confirmSheet('Turn off the circuit?', function () {});
ok('the confirm sheet mounts in the shell\'s root', sheet.parentNode === ROOT && sheet.id === 'hk-confirm');
ok('the choose sheet too', C.chooseSheet('Which?', [{ name: 'A' }], function () {}).parentNode === ROOT);

sheetResult('SHEETS (MANTEL)');
