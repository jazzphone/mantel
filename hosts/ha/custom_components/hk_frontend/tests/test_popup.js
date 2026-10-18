// hk-popup-card: the rules that decide when a pop-up sheet opens and closes.
//
// The DOM half (mounting the sheet) is verified in a real browser; what is
// asserted here is the part that decides WHEN -- the hash contract the doorbell
// and alarm automations drive, the trigger edge rules (Bubble Card's), and
// when close_action runs. Those are the behaviors a regression would break
// silently: a sheet that never opens, or a close_action that runs when it
// should not.
var DIR = HK_ROOT + '/tests/';
load(DIR + 'dom.js');

// --- a URL + window event bus the shim does not have ---
var L = {};
globalThis.addEventListener = function (t, f) { (L[t] = L[t] || []).push(f); };
globalThis.removeEventListener = function (t, f) { L[t] = (L[t] || []).filter(function (x) { return x !== f; }); };
globalThis.dispatchEvent = function (e) { (L[e.type] || []).slice().forEach(function (f) { f(e); }); };
location.href = 'http://ha/dashboard-kitchen/0'; location.hash = '';
function setUrl(u) { location.href = u; var i = u.indexOf('#'); location.hash = i < 0 ? '' : u.slice(i); }
globalThis.history = {
  state: null,
  pushState: function (s, t, u) { setUrl(u); },
  replaceState: function (s, t, u) { setUrl(u); }
};
function go(hash) {   // what a tablet's load_url / a tap does
  setUrl('http://ha/dashboard-kitchen/0' + hash);
  dispatchEvent(new CustomEvent('location-changed'));
}

// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
load(HK_ROOT + '/frontend/cards/hk-popup.js');

var pass = 0, fail = 0;
function ok(n, got, want) {
  if (got === want) { pass++; print('  PASS  ' + n + '   ' + JSON.stringify(got)); }
  else { fail++; print('  FAIL  ' + n + '\n          got  ' + JSON.stringify(got) +
                       '\n          want ' + JSON.stringify(want)); }
}
var P = customElements.get('hk-popup-card');
ok('registered', !!P, true);

function popup(cfg) {
  var c = new P();
  c.setConfig(Object.assign({ cards: [] }, cfg));
  c.shows = 0; c.acts = [];
  c._show = function () { this._open = true; this.shows++; };   // DOM half faked
  c._act = function (spec) { this.acts.push(spec); };
  Object.defineProperty(c, 'isConnected', { get: function () { return !!this._conn; } });
  c._conn = true; c.connectedCallback();
  hkGive(c, { states: {} });          // present, as it always is live
  (globalThis.__cards = globalThis.__cards || []).push(c);
  return c;
}
function st(s) { return { state: String(s) }; }

// ------------------------------------------------------------------ met()
print('=== conditions ===');
var met = hkPopup.met;
var S = { 'a': st('on'), 'n': st('3'), 'u': st('unknown') };
ok('state match', met([{ condition: 'state', entity: 'a', state: 'on' }], S), true);
ok('state list', met([{ condition: 'state', entity: 'a', state: ['off', 'on'] }], S), true);
ok('state miss', met([{ condition: 'state', entity: 'a', state: 'off' }], S), false);
ok('state_not', met([{ condition: 'state', entity: 'a', state_not: 'off' }], S), true);
ok('missing entity is not a match', met([{ condition: 'state', entity: 'zz', state: 'on' }], S), false);
ok('numeric above', met([{ condition: 'numeric_state', entity: 'n', above: 0 }], S), true);
ok('numeric below', met([{ condition: 'numeric_state', entity: 'n', below: 3 }], S), false);
ok('numeric on "unknown" is false, not NaN-true', met([{ condition: 'numeric_state', entity: 'u', below: 5 }], S), false);
// a page's say: an attribute on <html> (the Music page's hk-music-mini)
var deWas = document.documentElement;
ok('flag: no <html> at all is false', met([{ condition: 'flag', flag: 'hk-test-flag' }], S), false);
document.documentElement = deWas || document.createElement('html');
ok('flag: false while <html> has no such attribute', met([{ condition: 'flag', flag: 'hk-test-flag' }], S), false);
document.documentElement.setAttribute('hk-test-flag', '');
ok('flag: true while it has', met([{ condition: 'flag', flag: 'hk-test-flag' }, { condition: 'numeric_state', entity: 'n', above: 0 }], S), true);
document.documentElement.removeAttribute('hk-test-flag');
ok('flag: no name is false', met([{ condition: 'flag' }], S), false);
document.documentElement = deWas;
ok('or', met([{ condition: 'or', conditions: [
  { condition: 'state', entity: 'a', state: 'off' }, { condition: 'numeric_state', entity: 'n', above: 2 }] }], S), true);
ok('and', met([{ condition: 'and', conditions: [
  { condition: 'state', entity: 'a', state: 'on' }, { condition: 'numeric_state', entity: 'n', above: 5 }] }], S), false);
ok('unsupported type is false', met([{ condition: 'template', value_template: '{{ true }}' }], S), false);

// ------------------------------------------------------------ the hash
print('=== the hash contract (automations load ".../0#doorbell") ===');
go('');
var door = popup({ hash: '#doorbell' });
var alarm = popup({ hash: 'alarm', close_action: { action: 'none' } });   // bare hash normalised
ok('closed with no hash', door._open, undefined);
go('#doorbell');
ok('opens on #doorbell', door._open, true);
ok('  and ONLY that one', !!alarm._open, false);
go('');
ok('closes when the hash goes', door._open, false);
go('#alarm');
ok('a bare `alarm` in config still answers #alarm', alarm._open, true);
go('#doorbell');
ok('switching: alarm closes', alarm._open, false);
ok('  ...WITHOUT its close_action (as in Bubble Card: switching is not closing)', alarm.acts.length, 0);
go('');
go('#alarm'); go('#somethingelse');
ok('an unknown hash is a real close -> close_action runs', alarm.acts.length, 1);

print('=== opened by URL on page load ===');
go('#alarm');
var cold = popup({ hash: '#alarm' });
ok('a card connected while the hash is already set opens', cold._open, true);

// -------------------------------------------------------------- trigger
print('=== trigger edges (the #media widget) ===');
go('');
var T = [{ condition: 'state', entity: 'm', state: 'playing' }];
var media = popup({ hash: '#media', trigger: T, close_action: { action: 'perform-action' } });
media.hass = { states: { m: st('idle') } };
ok('false on load: stays shut, no hash', location.hash, '');
media.hass = { states: { m: st('playing') } };
ok('rising edge sets #media', location.hash, '#media');
ok('  which opens it', media._open, true);
media.hass = { states: { m: st('playing') } };
ok('no change, no churn', media.shows, 1);
media.hass = { states: { m: st('idle') } };
ok('falling edge (trigger_close default) removes the hash', location.hash, '');
ok('  closes', media._open, false);
ok('  and runs close_action, as Bubble Card does', media.acts.length, 1);

print('=== a client handed over directly (as Mantel does) drives the trigger the same way ===');
go('');
var direct = popup({ hash: '#direct', trigger: T });
direct.client = window.hkHostClient.from({ states: { m: st('idle') } });
ok('idle client: stays shut', location.hash, '');
direct.client = window.hkHostClient.from({ states: { m: st('playing') } });
ok('playing client: the rising edge sets the hash', location.hash, '#direct');
go('');

print('=== a bar arriving with its page opens in place; one coming up on it slides ===');
// (_show reads _settled: false = part of the page appearing -> no slide)
go('');
var arr = popup({ hash: '#media', trigger: T, modal: false, dismissable: true });   // as the bar is
arr._show = function () { this._open = true; this.shows++; this.inPlace = !this._settled; };
arr.hass = { states: { m: st('playing') } };
ok('wanted when the page appears (back to Home, music on): in place', arr.inPlace, true);
arr.hass = { states: { m: st('idle') } };
arr.hass = { states: { m: st('playing') } };
ok('music starting while the page is up: slides', arr.inPlace, false);
arr._conn = false; arr.disconnectedCallback(); go('');
arr._conn = true; arr.connectedCallback();
arr.hass = { states: { m: st('playing') } };
ok('the page shown again with the music still on: in place again', arr.inPlace, true);
arr._conn = false; arr.disconnectedCallback(); go('');

print('=== first evaluation never closes a sheet opened by URL ===');
go('#media');
var m2 = popup({ hash: '#media', trigger: T });
m2.hass = { states: { m: st('idle') } };
ok('tablet loaded "#media" while nothing plays: still open', m2._open, true);
m2.hass = { states: { m: st('playing') } };
m2.hass = { states: { m: st('idle') } };
ok('a LATER falling edge does close it', m2._open, false);

print('=== trigger_close: false ===');
go('');
var m3 = popup({ hash: '#media', trigger: T, trigger_close: false });
m3.hass = { states: { m: st('idle') } };
m3.hass = { states: { m: st('playing') } };
m3.hass = { states: { m: st('idle') } };
ok('falling edge leaves it open', m3._open, true);

print('=== leaving the view ===');
go('#doorbell');
var d2 = popup({ hash: '#doorbell', close_action: { action: 'x' } });
d2._conn = false; d2.disconnectedCallback();
ok('disconnect takes the sheet down', d2._open, false);
ok('  without close_action -- nobody closed it', d2.acts.length, 0);
ok('  and stops listening', (L['location-changed'] || []).indexOf(d2._onLoc), -1);

// ================================================== the #media bar
var T0 = 1000000000000, NOW = T0;
Date.now = function () { return NOW; };
function later(sec) { NOW += sec * 1000; }
function sts(sel, player, timers) {
  var o = { 'input_select.media_player_selection': st(sel), 'sensor.running_quick_timers': st(timers || 0) };
  o['media_player.kitchen'] = st(player.kitchen || 'idle');
  o['media_player.loft'] = st(player.loft || 'idle');
  return o;
}
var MEDIA = {
  hash: '#media', dismissable: true, trigger_close: true,
  dismiss_scope: [{ entity: 'input_select.media_player_selection' },
                  { entity: 'sensor.running_quick_timers', above: 0 }],
  trigger: [{ condition: 'or', conditions: [
    { condition: 'numeric_state', entity: 'sensor.running_quick_timers', above: 0 },
    { condition: 'state', entity_from: { selector: 'input_select.media_player_selection',
      map: { Kitchen: 'media_player.kitchen', Loft: 'media_player.loft' } },
      state: 'playing', grace: 20 }] }]
};
function reset() {
  // One media sheet per dashboard in real life: take earlier test cards off
  // the page, or they answer the same hash with stale state.
  (globalThis.__cards || []).forEach(function (c) { if (c._conn) { c._conn = false; c.disconnectedCallback(); } });
  globalThis.__cards = [];
  go(''); try { localStorage.clear(); } catch (e) {} for (var k in hkPopup._GRACE) delete hkPopup._GRACE[k]; }

print('=== entity_from: follows the SELECTED speaker ===');
reset();
var m = popup(MEDIA);
m.hass = { states: sts('Kitchen', { loft: 'playing' }) };
ok('another speaker playing: no widget', location.hash, '');
m.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('the selected speaker playing: opens', m._open, true);

print('=== grace: rides out a track change ===');
later(5); m.hass = { states: sts('Kitchen', { kitchen: 'paused' }) };
ok('5 s after it stops: still open', m._open, true);
later(10); m.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('resumes inside the window: still open', m._open, true);
later(1); m.hass = { states: sts('Kitchen', { kitchen: 'idle' }) };
later(21); m.hass = { states: sts('Kitchen', { kitchen: 'idle' }) };
ok('21 s after stopping: closed', m._open, false);
ok('  by the trigger, so NOT recorded as a dismissal', localStorage.getItem('hk-popup-dismissed#media'), null);

print('=== grace fires with no further state change ===');
reset(); __resetTimers();
var g = popup(MEDIA);
g.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
g.hass = { states: sts('Kitchen', { kitchen: 'idle' }) };
ok('open inside the window', g._open, true);
later(21); __runTimers();
ok('the scheduled re-check closes it at the end of the window', g._open, false);

print('=== a stop the page never saw gets no grace ===');
reset();
var cold = popup(MEDIA);
cold.hass = { states: sts('Kitchen', { kitchen: 'idle' }) };
ok('loaded while stopped: stays shut', location.hash, '');

// THE BAR THAT WOULD NOT GO AWAY. A page loaded with #media already in its
// URL and nothing playing must still close. The first evaluation deliberately
// refuses to close (so a hash the URL meant is not slammed shut before its
// state arrives), and the gate in `set hass` blocks every later push because
// an idle house moves no trigger entity, so no push ever looks again.
//
// The grace is a DELAY, so the second look has to happen on the clock
// alone, with no state change at all. That is what this asserts.
print('=== loaded AT #media with nothing playing: closes itself ===');
reset(); __resetTimers();
go('#media');
var stale = popup(MEDIA);
stale.hass = { states: sts('Kitchen', { kitchen: 'idle' }) };
ok('the URL opened it', stale._open, true);
stale.hass = { states: sts('Kitchen', { kitchen: 'idle' }) };   // gate blocks: nothing moved
ok('  still open a push later (the grace has not expired)', stale._open, true);
later(6); __runTimers();
ok('the scheduled re-check closes it', stale._open, false);
ok('  and the hash is cleared', location.hash, '');
ok('  not recorded as a dismissal', localStorage.getItem('hk-popup-dismissed#media'), null);

print('=== ...but a URL hash whose trigger DOES come true is kept ===');
reset(); __resetTimers();
go('#media');
var warm = popup(MEDIA);
warm.hass = { states: sts('Kitchen', { kitchen: 'idle' }) };
ok('open on arrival', warm._open, true);
later(2); warm.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
later(6); __runTimers();
ok('music started inside the grace: stays open', warm._open, true);

print('=== dismissal: this screen only, this session only ===');
reset();
var d = popup(MEDIA);
d.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
go('');                                           // tap outside
ok('closed by hand', d._open, false);
ok('  recorded', !!localStorage.getItem('hk-popup-dismissed#media'), true);
later(30); d.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('music still playing: stays dismissed (no 30 s comeback)', d._open, false);

print('=== ...survives a page reload ===');
d._conn = false; d.disconnectedCallback();       // the page unloads
var reloaded = popup(MEDIA);                      // a fresh card, same storage
later(3); reloaded.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('reloaded 3 s later: still dismissed', !!reloaded._open, false);

print('=== ...and ends when the session does ===');
later(1); reloaded.hass = { states: sts('Loft', { kitchen: 'playing', loft: 'playing' }) };
ok('another speaker selected (scope changed): reopens', reloaded._open, true);
go('');
ok('dismissed again', reloaded._open, false);
later(1); reloaded.hass = { states: sts('Loft', { loft: 'playing' }, 1) };
ok('a timer starts: reopens', reloaded._open, true);
go('');
later(1); reloaded.hass = { states: sts('Loft', { loft: 'idle' }, 0) };
later(25); reloaded.hass = { states: sts('Loft', { loft: 'idle' }, 0) };
ok('playback ended: dismissal cleared', localStorage.getItem('hk-popup-dismissed#media'), null);
later(5); reloaded.hass = { states: sts('Loft', { loft: 'playing' }) };
ok('next session opens again', reloaded._open, true);

print('=== a stale record (screen away for hours) is ignored ===');
reset();
localStorage.setItem('hk-popup-dismissed#media', JSON.stringify({ sig: 'Kitchen|0', seen: NOW - 6 * 3600 * 1000 }));
var st6 = popup(MEDIA);
st6.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('hours-old dismissal does not suppress a new session', st6._open, true);

print('=== level, not edge: back from a subview it reopens ===');
reset();
var lv = popup(MEDIA);
lv.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
lv._conn = false; lv.disconnectedCallback();      // went to the Lights page
setUrl('http://ha/dashboard-kitchen/0');          // came back with no hash
lv._conn = true; lv.connectedCallback();
lv.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('open again without any state change', lv._open, true);

print('=== it never takes the screen from another sheet ===');
reset();
var al = popup({ hash: '#alarm' });
go('#alarm');
var mm = popup(MEDIA);
mm.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('#alarm open: #media waits', location.hash, '#alarm');

// A POP-UP ITEM's hash (hk-detail.js's router) is another sheet
// too: no YAML card claims it, so HASHES never hears of it.
print('=== ...nor from a pop-up item (the router owns the hash) ===');
reset();
window.hkDetail = { answers: function (h) { return h === '#frontgate'; } };
go('#frontgate');                                   // a tablet loads ".../0#frontgate"
var mi = popup(MEDIA);
mi.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('loaded at an item\'s hash with music playing: the bar waits', location.hash, '#frontgate');
reset();
var mr = popup(MEDIA);
mr.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('the bar is up', mr._open, true);
go('#frontgate');                                   // the doorbell rings
ok('the ring takes the screen', location.hash, '#frontgate');
later(1); mr.hass = { states: sts('Kitchen', { kitchen: 'playing' }, 1) };   // a quick timer starts
ok('a timer starting does not take the hash back', location.hash, '#frontgate');
reset();
var mc = popup(MEDIA);
mc.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
go('#frontgate');                                   // a ring while the bar is up
ok('the ring is not the user dismissing the bar', localStorage.getItem('hk-popup-dismissed#media'), null);
go('');                                             // the doorbell sheet closes
later(1); mc.hass = { states: sts('Kitchen', { kitchen: 'playing' }, 1) };   // the next change
ok('so the bar comes back', mc._open, true);
delete window.hkDetail;

print('=== storage blocked (private window / site data off) ===');
reset(); globalThis.__lsThrows = true;
var pw = popup(MEDIA);
pw.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('still opens', pw._open, true);
go('');
later(5); pw.hass = { states: sts('Kitchen', { kitchen: 'playing' }) };
ok('dismissal still holds for the page, in memory', pw._open, false);
globalThis.__lsThrows = false;

print('=== the glass layer takes no part in the sheet\'s spacing ===');
var psrc = readFile(HK_ROOT + '/frontend/cards/hk-popup.js');
// hk-glass.js inserts its frost layer FIRST in the sheet; a plain `*+*` would
// give the first card 8px the moment the layer arrives and move the pills off it.
ok('the 8px gap is between cards, never after the layer',
   /\.sheet>:not\(\[data-hk-glass-layer\]\):not\(\.x\)~:not\(\[data-hk-glass-layer\]\):not\(\.x\)\{margin-top:8px\}/.test(psrc) &&
   !/\.sheet>\*\+\*/.test(psrc), true);

print('=== auto_close counts from the last touch ===');
// Counted from the open, the doorbell sheet would shut 60 s in, mid-reply.
ok('the open arms the timer through _armAuto', /this\._armAuto\(\);\n\s*kidsReady\.catch/.test(psrc), true);
ok('a pointerdown anywhere in the sheet (capture) re-arms it',
   /sheet\.addEventListener\('pointerdown', function \(\) \{ self\._armAuto\(\); \}, true\)/.test(psrc), true);

print('=== hashes(): the pop-ups on the page NOW ===');
// The alarm's detail tap asks this whether #alarm can open here. A list of
// every hash ever configured would say yes on the Alarm page and on subviews,
// and the tap would push a hash nothing answers.
reset();
var ha1 = popup({ hash: '#alarm' }), hd1 = popup({ hash: '#doorbell' });
ok('both on the page', hkPopup.hashes().sort().join(','), '#alarm,#doorbell');
ha1._conn = false; ha1.disconnectedCallback();
ok('a view that left takes its hash with it', hkPopup.hashes().join(','), '#doorbell');
ok('...though the close logic still knows the hash exists', /HASHES\[this\._hash\] = true/.test(psrc), true);
ha1._conn = true; ha1.connectedCallback();
ok('back on the page, back in the list', hkPopup.hashes().sort().join(','), '#alarm,#doorbell');
var ha2 = popup({ hash: '#alarm' });          // the same file in two views
ha2._conn = false; ha2.disconnectedCallback();
ok('a second copy leaving does not remove the first', hkPopup.hashes().indexOf('#alarm') !== -1, true);
hd1.setConfig({ hash: '#other', cards: [] });
ok('re-configured on the page: the new hash, not the old', hkPopup.hashes().sort().join(','), '#alarm,#other');

print('=== open(): no second entry for the sheet that is already up ===');
reset();
var pushes = 0, pushed = [], realPush = history.pushState;
history.pushState = function (s, t, u) { pushes++; pushed.push(s); realPush(s, t, u); };
history.state = { hkDetail: 'lock.front_door', hkTok: 1 };   // a detail sheet's entry
hkPopup.open('alarm');
ok('opens by hash', location.hash, '#alarm');
ok('the new entry does NOT inherit the detail sheet\'s state', pushed[0], null);
hkPopup.open('#alarm');
ok('asking again pushes nothing', pushes, 1);
history.pushState = realPush; history.state = null;


// THE EDITOR'S FIELDS, by name (sections and grids flattened)
function editorFields(tag) {
  var K = customElements.get(tag), p = K.getConfigElement(),
      EC = customElements.get(String(p.tagName).toLowerCase());
  var ed = new EC();
  if (!ed.appendChild) ed.appendChild = function () {};
  ed.setConfig({});
  var out = {};
  (function walk(s) { (s || []).forEach(function (f) { if (f.schema) walk(f.schema); else out[f.name] = f; }); })(ed._form.schema);
  return out;
}

print('\n=== its editor ===');
var PF = editorFields('hk-popup-card');
ok('Cards is not required (Detail can stand in)', !!PF.cards.required, false);
ok('...and says so', /Detail/.test(PF.cards.helper), true);
ok('Detail: an entity', PF.detail && JSON.stringify(PF.detail.selector), '{"entity":{}}');
ok('Dock at the Bottom', PF.dock && PF.dock.label, 'Dock at the Bottom');
ok('Modal, shown on while unset', PF.modal && PF.modal.default, true);
ok('Close Button', PF.close_button && JSON.stringify(PF.close_button.selector), '{"boolean":{}}');
ok('Maximum Width', PF.max_width && JSON.stringify(PF.max_width.selector), '{"text":{}}');
var PC = customElements.get('hk-popup-card');
var pd = new PC();
var threw = false;
try { pd.setConfig({ hash: '#x', detail: 'light.a' }); } catch (e) { threw = true; }
ok('a pop-up with Detail and no Cards is a valid config', threw, false);
var PG = customElements.get('hk-popup-group-card');
ok('the pop-up group takes no space, so asks for none', new PG().getCardSize(), 0);

// auto_close and the sheet's mount/animation are checked in the browser --
// they are timers and DOM, which this shim does not model faithfully.

print(fail ? ('  ' + fail + ' FAILED') : ('  ALL ' + pass + ' POPUP TESTS PASS'));
