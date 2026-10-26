// hk-detail.js, DRIVEN. test_detail.js pins the decisions in the source;
// this suite builds the real panels and the real sheet in the DOM shim and
// presses them: the lock's ring, the history entry, the hass feed, the
// artwork box, the thermostat's trend, the sensor chart's range, the
// unavailable state. Each case pins a defect that review found, reproduced
// here in jsc.
//
// The shim does not parse HTML and its innerHTML is write-only, so each
// element made here keeps the last string it was given (_html) and a
// classList that honors `force`; custom tags come out of createElement as
// their real classes. history and location are a small model with the one
// property that matters: back() is ASYNC (popstate fires later), as in a
// browser.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');

function __aug(el) {
  Object.defineProperty(el, 'innerHTML', { configurable: true,
    get: function () { return this._html || ''; },
    set: function (v) { this.children = []; this._html = String(v); this.__q = {}; } });
  return el;
}
(function () {
  var ce = document.createElement;
  var El0 = ce.call(document, 'div').constructor;
  document.createElement = function (t) {
    var K = customElements.get(String(t).toLowerCase());
    if (K) { var k = new K(); k.tagName = String(t).toUpperCase();
      if (!k.classList) k.classList = ce.call(document, 'div').classList;
      return k; }
    return __aug(ce.call(document, t));
  };
  El0.prototype.querySelector = function (sel) {
    this.__q = this.__q || {};
    if (!this.__q[sel]) { var e = __aug(new El0('stub')); e.__sel = sel; e.parentNode = this; this.__q[sel] = e; }
    return this.__q[sel];
  };
  El0.prototype.insertBefore = function (el, ref) {
    var i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? 0 : i, 0, el); el.parentNode = this; return el;
  };
  HTMLElement.prototype.querySelector = El0.prototype.querySelector;
  var as = HTMLElement.prototype.attachShadow;
  HTMLElement.prototype.attachShadow = function () { var r = as.apply(this, arguments); __aug(r); this.shadowRoot = r; return r; };
})();

// ---- history / location
var HIST = { stack: [{ state: null, url: 'http://ha/dashboard-kitchen/0' }], i: 0, pops: [] };
function resetHistory() { HIST.stack = [{ state: null, url: 'http://ha/dashboard-kitchen/0' }]; HIST.i = 0; HIST.pops = []; }
globalThis.location = {
  get href() { return HIST.stack[HIST.i].url; },
  get pathname() { return HIST.stack[HIST.i].url.replace(/^http:\/\/ha/, '').split('#')[0]; },
  get hash() { var u = HIST.stack[HIST.i].url, k = u.indexOf('#'); return k < 0 ? '' : u.slice(k); },
  host: 'ha'
};
globalThis.history = {
  get state() { return HIST.stack[HIST.i].state; },
  pushState: function (s, t, u) {
    HIST.stack = HIST.stack.slice(0, HIST.i + 1);
    HIST.stack.push({ state: s == null ? null : JSON.parse(JSON.stringify(s)), url: u }); HIST.i++;
  },
  replaceState: function (s, t, u) { HIST.stack[HIST.i] = { state: s == null ? null : s, url: u }; },
  back: function () {
    HIST.pops.push(function () { if (HIST.i > 0) { HIST.i--; dispatchEvent({ type: 'popstate' }); } });
  }
};
function flushPops() { var p = HIST.pops; HIST.pops = []; p.forEach(function (f) { f(); }); }

// ---- <home-assistant>, frames, the rest of a browser this file touches
var HA = { hass: null, shadowRoot: null };
document.querySelector = function (sel) { return sel === 'home-assistant' ? HA : null; };
document.body = document.createElement('body');
globalThis.matchMedia = function () { return { matches: false }; };
globalThis.WeakRef = globalThis.WeakRef || function (o) { this.deref = function () { return o; }; };
globalThis.requestAnimationFrame = function (fn) { __timers.push({ fn: fn, ms: 0, raf: true }); return __timers.length; };
// run (once) the queued timers that match; new ones queued meanwhile wait
function fire(pred) {
  var due = [];
  __timers.forEach(function (t, i) { if (t && pred(t)) { due.push(t); __timers[i] = null; } });
  due.forEach(function (t) { t.fn(); });
}
function frames() { fire(function (t) { return t.raf; }); }
// the open sheet's look at <home-assistant>: four times a second, not every frame
function polls() { fire(function (t) { return t.ms === 250; }); }

load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-detail.js');
var D = window.hkDetail, _ = D._, C = window.hkCards;

var pass = 0, fail = 0;
function ok(n, c, d) {
  if (c) { pass++; print('  PASS  ' + n); }
  else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); }
}
function drain() { for (var i = 0; i < 6; i++) drainMicrotasks(); }

var CALLS = [];
function house(map, stamp) {
  var states = {};
  Object.keys(map).forEach(function (id) {
    states[id] = { entity_id: id, state: map[id][0], attributes: map[id][1] || {},
                   last_updated: map[id][2] || stamp || 't1', last_changed: map[id][2] || stamp || 't1' };
  });
  // a dashboard panel for the pages these tests stand on (pop-ups answer only
  // on a dashboard), and one of HA's own pages that is not one
  return { states: states, entities: {}, devices: {}, areas: {},
           panels: { 'dashboard-kitchen': { component_name: 'lovelace' }, config: { component_name: 'config' } },
           callService: function (d, s, data) { CALLS.push(d + '.' + s); return Promise.resolve(); } };
}
function panel(tag, id, h, src) {
  var P = customElements.get(tag), p = new P();
  p.setConfig({ entity: id, kind: 'x', src: src || {}, glass: false });
  p.hass = h;
  return p;
}
function setState(p, id, state, attrs, stamp) {
  var h = Object.assign({}, p.hass, { states: Object.assign({}, p.hass.states) });
  h.states[id] = { entity_id: id, state: state, attributes: attrs, last_updated: stamp, last_changed: stamp };
  p.hass = h;
}

// =====================================================================
print('=== the ring: one press, one action, decided when the finger lands ===');
function press(tag, id, st0, attrs, during, holdMs) {
  __resetTimers(); CALLS = [];
  var p = panel(tag, id, house((function () { var m = {}; m[id] = [st0, attrs]; return m; })()));
  var b = p._root.querySelector('.lk'), ev = { pointerId: 1, preventDefault: function () {} };
  b._listeners.pointerdown.forEach(function (f) { f(ev); });
  if (holdMs >= 1000) fire(function (t) { return t.ms === 1000; });
  if (during) setState(p, id, during, attrs, 't2');
  b._listeners.pointerup.forEach(function (f) { f(ev); });
  fire(function (t) { return t.ms === 1000; });   // a timer that was canceled must not fire late
  return CALLS.slice();
}
var LOCK = { supported_features: 0 }, GARAGE = { supported_features: 11, device_class: 'garage' };
var r;
r = press('hk-detail-lock', 'lock.front', 'locked', LOCK, 'unlocked', 1000);
ok('lock: hold past the unlock, then let go -- exactly one call, unlock (never a second one that locks)',
   r.join() === 'lock.unlock', r);
r = press('hk-detail-lock', 'lock.front', 'locked', LOCK, null, 400);
ok('lock: let go before the ring fills -- nothing', r.length === 0, r);
r = press('hk-detail-lock', 'lock.front', 'unlocked', LOCK, null, 0);
ok('lock: a tap on an unlocked lock locks it', r.join() === 'lock.lock', r);
r = press('hk-detail-lock', 'lock.front', 'jammed', LOCK, null, 0);
ok('lock: a tap on a JAMMED lock retries locking (the safe direction)', r.join() === 'lock.lock', r);
r = press('hk-detail-lock', 'lock.front', 'jammed', LOCK, null, 1000);
ok('lock: a jammed lock is never unlocked by a hold', r.join() === 'lock.lock' || r.length <= 1 && r.indexOf('lock.unlock') === -1, r);
r = press('hk-detail-garage', 'cover.garage', 'closed', GARAGE, 'open', 1000);
ok('garage: hold, it reads open under the finger, let go -- exactly one open_cover (no close pulse)',
   r.join() === 'cover.open_cover', r);
r = press('hk-detail-garage', 'cover.garage', 'closed', GARAGE, 'opening', 1000);
ok('garage: ...or reads opening -- still exactly one open_cover (no stop)', r.join() === 'cover.open_cover', r);
r = press('hk-detail-garage', 'cover.garage', 'open', GARAGE, null, 0);
ok('garage: a tap on an open door closes it', r.join() === 'cover.close_cover', r);
r = press('hk-detail-valve', 'valve.main', 'open', { supported_features: 3 }, null, 1000);
ok('valve: hold to close', r.join() === 'valve.close_valve', r);
// NOT REPORTED YET (a Z-Wave or Zigbee device after a restart): `unknown`
// takes commands, as in HA's own dialog -- the safe one
r = press('hk-detail-lock', 'lock.front', 'unknown', LOCK, null, 0);
ok('lock: unknown -- a tap locks it', r.join() === 'lock.lock', r);
r = press('hk-detail-lock', 'lock.front', 'unknown', LOCK, null, 1000);
ok('lock: unknown -- a hold never unlocks', r.indexOf('lock.unlock') === -1, r);
r = press('hk-detail-garage', 'cover.garage', 'unknown', GARAGE, null, 0);
ok('garage: unknown -- a tap closes it', r.join() === 'cover.close_cover', r);
// MOVING AS SOON AS IT IS SENT: an opener that only ever reports open and
// closed (most relay garages) still shows Opening… / Closing… at once, until
// Home Assistant reports anything new, the call fails, or a minute passes
(function () {
  function sheet(st0, fail) {
    __resetTimers(); CALLS = [];
    var h = house({ 'cover.garage': [st0, GARAGE] });
    if (fail) h.callService = function (d, s) { CALLS.push(d + '.' + s); return Promise.reject(new Error('refused')); };
    var p = panel('hk-detail-garage', 'cover.garage', h);
    var b = p._root.querySelector('.lk'), ev = { pointerId: 1, preventDefault: function () {} };
    return { p: p, word: function () { return p._big.textContent; }, busy: function () { return p._lk.classList.contains('busy'); },
      down: function () { b._listeners.pointerdown.forEach(function (f) { f(ev); }); },
      up: function () { b._listeners.pointerup.forEach(function (f) { f(ev); }); },
      hold: function () { this.down(); fire(function (t) { return t.ms === 1000; }); this.up(); } };
  }
  var g = sheet('closed');
  g.hold();
  ok('garage: a hold sent -- Opening… and the ring pulsing at once, before HA says anything',
     CALLS.join() === 'cover.open_cover' && g.word() === 'Opening…' && g.busy(), [CALLS, g.word()]);
  g.down(); g.up();
  ok('garage: a tap while it waits sends nothing (a stop on a relay opener would start a door that never moved)',
     CALLS.join() === 'cover.open_cover', CALLS);
  setState(g.p, 'cover.garage', 'open', GARAGE, 't2');
  ok('garage: Home Assistant reports open -- Open, no pulse', g.word() === 'Open' && !g.busy(), g.word());
  g.down(); g.up();
  ok('garage: ...then a tap closes, and Closing… shows at once', CALLS.slice(-1)[0] === 'cover.close_cover' &&
     g.word() === 'Closing…' && g.busy(), [CALLS, g.word()]);
  setState(g.p, 'cover.garage', 'closing', GARAGE, 't3');
  ok('garage: a real closing from HA is still Closing…, and now a tap stops it', g.word() === 'Closing…' && g.busy());
  g.down(); g.up();
  ok('garage: ...with stop_cover', CALLS.slice(-1)[0] === 'cover.stop_cover', CALLS);

  var t = sheet('closed');
  t.hold();
  fire(function (x) { return x.ms === 60000; });
  ok('garage: nothing from HA for a minute -- back to what HA says (Closed)', t.word() === 'Closed' && !t.busy(), t.word());

  var f = sheet('closed', true);
  f.hold();
  drain();
  ok('garage: the call refused -- back to Closed at once', f.word() === 'Closed' && !f.busy(), f.word());

  var o = sheet('opening');
  ok('garage: an opener that reports opening is unchanged -- Opening…, pulsing', o.word() === 'Opening…' && o.busy());
})();
r = press('hk-detail-valve', 'valve.main', 'unknown', { supported_features: 3 }, null, 1000);
ok('valve: unknown -- hold to close (the water off), never to open', r.join() === 'valve.close_valve', r);
r = press('hk-detail-lock', 'lock.front', 'unavailable', LOCK, null, 0);
ok('lock: unavailable -- nothing to send to', r.length === 0, r);
(function () {
  // someone else shut it during the hold: the press was for "close", and
  // the ring must not now OPEN the water
  __resetTimers(); CALLS = [];
  var attrs = { supported_features: 3 };
  var p = panel('hk-detail-valve', 'valve.main', house({ 'valve.main': ['open', attrs] }));
  var b = p._root.querySelector('.lk'), ev = { pointerId: 1, preventDefault: function () {} };
  b._listeners.pointerdown.forEach(function (f) { f(ev); });
  setState(p, 'valve.main', 'closed', attrs, 't2');
  fire(function (t) { return t.ms === 1000; });
  b._listeners.pointerup.forEach(function (f) { f(ev); });
  ok('valve: shut by someone else mid-hold -- the ring sends nothing (never the opposite)', CALLS.length === 0, CALLS);
})();
// A BUTTON: one tap presses it, no hold, no question
r = press('hk-detail-button', 'button.pc_wake_on_lan', 'unknown', {}, null, 0);
ok('button: a tap presses it', r.join() === 'button.press', r);
r = press('hk-detail-button', 'input_button.nap', 'unknown', {}, null, 0);
ok('input_button: a tap presses it, in its own domain', r.join() === 'input_button.press', r);
r = press('hk-detail-button', 'button.pc_wake_on_lan', 'unavailable', {}, null, 0);
ok('button: unavailable -- a tap sends nothing', r.length === 0, r);
(function () {
  __resetTimers(); CALLS = [];
  var p = panel('hk-detail-button', 'button.pc_wake_on_lan',
                house({ 'button.pc_wake_on_lan': ['unknown', { friendly_name: 'PC - Wake On Lan' }] }), { name: 'PC' });
  var big = p._root.querySelector('.big'), hint = p._root.querySelector('.hint'), b = p._root.querySelector('.lk');
  var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  var got = [big.textContent, hint.textContent];
  ok('wake on LAN: never pressed (unknown) reads Wake / Tap to wake', same(got, ['Wake', 'Tap to wake']), got);
  ok('...labelled for a screen reader', b.getAttribute('aria-label') === 'Wake PC', b.getAttribute('aria-label'));
  setState(p, 'button.pc_wake_on_lan', new Date(Date.now() - 1000).toISOString(), { friendly_name: 'PC - Wake On Lan' }, 't2');
  got = [big.textContent, b.classList.contains('busy'), hint.textContent];
  ok('...just pressed: Waking…, pulsing, and when', got[0] === 'Waking…' && got[1] === true && /^Last woken /.test(got[2]), got);
  setState(p, 'button.pc_wake_on_lan', new Date(Date.now() - 60000).toISOString(), { friendly_name: 'PC - Wake On Lan' }, 't3');
  got = [big.textContent, b.classList.contains('busy')];
  ok('...a minute later: Wake again, still', same(got, ['Wake', false]), got);
  var q = panel('hk-detail-button', 'input_button.nap', house({ 'input_button.nap': ['unknown', {}] }));
  ok('any other button reads Press', q._root.querySelector('.big').textContent === 'Press', q._root.querySelector('.big').textContent);
})();
(function () {
  __resetTimers(); CALLS = [];
  var asked = null, orig = C.confirmSheet;
  C.confirmSheet = function (text, go) { asked = { text: text, go: go }; };
  var p = panel('hk-detail-lock', 'lock.front', house({ 'lock.front': ['locked', LOCK] }), { name: 'Front Door' });
  var b = p._root.querySelector('.lk');
  b._listeners.keydown.forEach(function (f) { f({ key: 'Enter', preventDefault: function () {} }); });
  ok('keyboard: Enter on a locked lock asks first', asked && asked.text === 'Unlock Front Door?' && CALLS.length === 0, asked && asked.text);
  setState(p, 'lock.front', 'unlocked', LOCK, 't2');
  asked.go();
  ok('keyboard: a yes that lands after someone else unlocked it sends nothing', CALLS.length === 0, CALLS);
  C.confirmSheet = orig;
})();

// =====================================================================
print('\n=== which sheet ===');
var K = house({
  'cover.frunk': ['closed', { supported_features: 1, device_class: 'door' }],
  'cover.tilt': ['closed', { supported_features: 240, device_class: 'blind' }],
  'cover.gate': ['closed', { supported_features: 3, device_class: 'gate' }],
  'cover.window': ['closed', { supported_features: 3, device_class: 'window' }]
});
ok('a door cover (a frunk) is the ring, from hk-base\'s own DOOR_COVERS', D.kindOf(K, 'cover.frunk') === 'garage' &&
   C.DOOR_COVERS && C.DOOR_COVERS.door === 1 && C.neverToggles(K, 'cover.frunk'));
ok('a tilt-only blind falls through to HA\'s dialog', D.kindOf(K, 'cover.tilt') === null);
ok('a gate is the ring, a car window is buttons', D.kindOf(K, 'cover.gate') === 'garage' && D.kindOf(K, 'cover.window') === 'cover_buttons');
(function () {
  var p = panel('hk-detail-garage', 'cover.frunk', K);
  ok('a door cover draws a door, not a garage', p._glyph === 'hk:door-closed', p._glyph);
})();

// =====================================================================
print('\n=== unavailable, one way ===');
(function () {
  var U = house({
    'light.dead': ['unavailable', { supported_color_modes: ['color_temp', 'xy'] }],
    'cover.shade': ['unavailable', { supported_features: 15, device_class: 'shade' }],
    'cover.odd': ['unknown', { supported_features: 15 }],
    'fan.f': ['unavailable', { supported_features: 1, percentage_step: 25 }],
    'input_number.n': ['unavailable', { min: 0, max: 10, step: 1 }]
  });
  var l = panel('hk-detail-light', 'light.dead', U);
  ok('an unavailable light says so (not "Off") and its controls stand down', l._big.textContent === 'Unavailable' && l.hasAttribute('na'),
     l._big.textContent);
  var c = panel('hk-detail-cover', 'cover.shade', U);
  ok('an unavailable shade says so (not "Open" at 100 %)', c._big.textContent === 'Unavailable' && c.hasAttribute('na'), c._big.textContent);
  var o = panel('hk-detail-cover', 'cover.odd', U);
  ok('an UNKNOWN shade claims no position and still takes commands', o._big.textContent === '—' && !o.hasAttribute('na'), o._big.textContent);
  var f = panel('hk-detail-fan', 'fan.f', U);
  ok('an unavailable fan says so', f._big.textContent === 'Unavailable' && f.hasAttribute('na'), f._big.textContent);
  var n = panel('hk-detail-number', 'input_number.n', U);
  ok('an unavailable number says so', n._n.textContent === 'Unavailable' && n.hasAttribute('na'), n._n.textContent);
  setState(l, 'light.dead', 'on', { supported_color_modes: ['color_temp', 'xy'], brightness: 255 }, 't2');
  ok('...and comes back when it does', l._big.textContent === '100%' && !l.hasAttribute('na'), l._big.textContent);
})();

// =====================================================================
print('\n=== the sheet: hass, history, Escape ===');
var H0 = house({
  'light.a': ['on', { supported_color_modes: ['brightness'], brightness: 128 }],
  'sensor.t': ['71', { unit_of_measurement: '°F' }],
  'media_player.x': ['playing', { supported_features: 16389, volume_level: 0.3, media_title: 'A' }]
});
HA.hass = H0;
(function () {
  // the hub is only as fresh as the hk cards on screen
  var card = new (customElements.get('hk-detail-state'))();
  card.setConfig({ entity: 'sensor.t' });
  var stale = house({ 'sensor.t': ['60', {}] });
  card.hass = stale;
  ok('hkCards.client() prefers <home-assistant>\'s over whatever an hk card saw last', C.client() === window.hkHostClient.from(H0));
})();
resetHistory(); __resetTimers();
ok('open() takes the sheet', D.open('light.a', {}) === true && _.state().el);
var d1 = _.state();
ok('the entry carries this sheet\'s token', history.state && history.state.hkDetail === 'light.a' && history.state.hkTok === d1.tok, history.state);
ok('the panel stays out of the shared blur (glass: false)', d1.panel._config.glass === false &&
   (d1.panel.connectedCallback(), !window.__hkGlassCards.has(d1.panel)));
var H1 = house({ 'light.a': ['on', { supported_color_modes: ['brightness'], brightness: 255 }, 't2'],
                 'sensor.t': ['71', { unit_of_measurement: '°F' }],
                 'media_player.x': ['playing', { supported_features: 16389, volume_level: 0.3, media_title: 'A' }] });
HA.hass = H1;
frames();
frames(); frames(); frames();
ok('...no callback every frame: an open sheet does not keep the screen drawing', !__timers.some(function (t) { return t && t.raf; }));
polls();
ok('with no hk card on screen, the sheet still gets the new state from <home-assistant>', d1.panel.client === window.hkHAClient.from(H1) && d1.panel._big.textContent === '100%',
   d1.panel._big.textContent);
// a sheet opened from a sheet takes over its entry
var depth = HIST.stack.length;
D.open('sensor.t', {});
var d2 = _.state();
ok('a sheet opened from a sheet reuses the entry (no dead Back press left behind)', HIST.stack.length === depth &&
   history.state.hkDetail === 'sensor.t' && history.state.hkTok === d2.tok, { n: HIST.stack.length, st: history.state });
D.close(); flushPops();
ok('X goes back off our own entry, once', HIST.i === 0 && !_.state().el, HIST.i);
// Footer state follows both scroll and dynamic content, and is disposed
// with the sheet rather than leaving observers attached to old panes.
(function () {
  var RO0=globalThis.ResizeObserver,MO0=globalThis.MutationObserver,resize,mutation,rd=0,md=0;
  globalThis.ResizeObserver=function(cb){resize=cb;this.observe=function(){};this.disconnect=function(){rd++;};};
  globalThis.MutationObserver=function(cb){mutation=cb;this.observe=function(){};this.disconnect=function(){md++;};};
  try {
    D.open('sensor.t',{});
    var d=_.state(),body=d.sheet.querySelector('.body');
    body.scrollHeight=1000;body.clientHeight=500;body.scrollTop=0;resize();
    ok('footer: visible while more content remains below',d.sheet.hasAttribute('hk-scroll-more'));
    body.scrollTop=500;(body._listeners.scroll||[]).slice().forEach(function(f){f();});
    ok('footer: hidden at the bottom',!d.sheet.hasAttribute('hk-scroll-more'));
    body.scrollHeight=1200;mutation();
    ok('footer: new content below is noticed without scrolling',d.sheet.hasAttribute('hk-scroll-more'));
    body.scrollHeight=500;body.scrollTop=0;resize();
    ok('footer: hidden when a resize makes everything fit',!d.sheet.hasAttribute('hk-scroll-more'));
    var prior=rd;D.close();flushPops();
    ok('footer: closing removes listeners and disconnects both observers',rd===prior+1&&md===1&&(body._listeners.scroll||[]).length===0);
  } finally {globalThis.ResizeObserver=RO0;globalThis.MutationObserver=MO0;}
})();

// a pop-up opens over the sheet (hk-popup's setHash: pushState + location-changed)
resetHistory(); __resetTimers();
D.open('light.a', {});
history.pushState(null, '', 'http://ha/dashboard-kitchen/0#media');
dispatchEvent({ type: 'location-changed' });
flushPops();
ok('a pop-up\'s hash takes the sheet down, quietly', !_.state().el);
ok('...and leaves the pop-up\'s entry alone (it was going back off it: a dismissal)', location.hash === '#media' && HIST.i === 2,
   { hash: location.hash, i: HIST.i });
// even a pop-up that copies our state is not ours to go back from
resetHistory(); __resetTimers();
D.open('light.a', {});
var d3 = _.state();
history.pushState({ hkDetail: 'light.a', hkTok: 999 }, '', location.href);
D.close(); flushPops();
ok('X on an entry with another token does not go back', HIST.i === 2, HIST.i);
// a sheet opened from inside a pop-up keeps its hash
resetHistory(); __resetTimers();
history.pushState(null, '', 'http://ha/dashboard-kitchen/0#media');
D.open('light.a', {});
dispatchEvent({ type: 'location-changed' });
ok('a sheet opened over the pop-up\'s own hash stays up', !!_.state().el);
D.close(); flushPops();
ok('...and its X returns to the pop-up', location.hash === '#media' && !_.state().el, location.hash);
// Back and Escape
resetHistory(); __resetTimers();
D.open('light.a', {});
history.back(); flushPops();
ok('the Back button closes it', !_.state().el);
D.open('light.a', {});
dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation: function () {} });
flushPops();
ok('Escape closes it, and takes our entry with it', !_.state().el && HIST.i === 0, HIST.i);

// =====================================================================
print('\n=== interception ===');
function path(list) { return { composedPath: function () { return list; } }; }
function tag(t, cfg) { return { tagName: t, _config: cfg }; }
ok('taken from a dashboard', _.fromDashboard(path([tag('HUI-TILE-CARD'), tag('HA-PANEL-LOVELACE')])));
ok('taken from an hk pop-up beside the panel', _.fromDashboard(path([tag('HK-TILE-CARD'), tag('HOME-ASSISTANT')])));
ok('NOT from an hk card inside HA\'s card editor (an HA dialog)',
   !_.fromDashboard(path([tag('HK-TILE-CARD'), tag('HUI-CARD-PREVIEW'), tag('HA-DIALOG'), tag('HOME-ASSISTANT')])));
ok('NOT from HA\'s home panel (the Overview)', !_.fromDashboard(path([tag('HUI-TILE-CARD'), tag('HA-PANEL-HOME')])));
var pill = tag('HK-TILE-CARD', { entity: 'light.a', name: 'Lamp', icon: 'hk:lamp', icon_color: 'yellow' });
var row = tag('HK-ROW-CARD', { entity: 'switch.other', name: 'Row' });
ok('the source is the card showing THIS entity', _.sourceOf(path([pill, row]), 'light.a').name === 'Lamp');
ok('a container or another card\'s name never labels the sheet', !_.sourceOf(path([row]), 'light.a').name &&
   _.sourceOf(path([tag('HK-GRID-CARD', { name: 'Grid' }), pill]), 'light.a').name === 'Lamp');

// =====================================================================
print('\n=== the header glyph ===');
ok('near-white is every channel bright', _.nearWhite('rgba(255, 255, 255, 0.85)') && _.nearWhite('#fff') &&
   !_.nearWhite(C.PALETTE.icon.yellow) && !_.nearWhite(C.PALETTE.icon.mint) && !_.nearWhite('var(--x)'));
resetHistory(); __resetTimers();
D.open('media_player.x', { icon_color: 'rgba(255, 255, 255, 0.85)' });
ok('a playing speaker with a near-white pill draws a dark glyph in its well', _.state().icon.style.color === 'rgba(0,0,0,0.78)',
   _.state().icon.style.color);
D.close(true);

// =====================================================================
print('\n=== media ===');
(function () {
  __resetTimers();
  var M = house({ 'media_player.x': ['playing', { supported_features: 16389, entity_picture: '/api/media_player_proxy/x?1' }] });
  var p = panel('hk-detail-media', 'media_player.x', M);
  var art = p._e.art, first = art.children[0];
  var oldTimer = __timers.filter(function (t) { return t && t.ms === 6000; })[0];
  setState(p, 'media_player.x', 'playing', { supported_features: 16389, entity_picture: '/api/media_player_proxy/x?2' }, 't2');
  ok('a track change swaps in ONE new box (never two covers side by side)', art.children.length === 1 && art.children[0] !== first,
     art.children.length);
  var now = art.children[0];
  fire(function (t) { return t === oldTimer; });   // the OLD cover's timeout, which never loaded
  ok('the old cover\'s timeout cannot touch the new one', art.children[0] === now && now.children.length === 1 && now.children[0].tagName === 'img',
     { n: art.children.length, kids: now.children.length });
})();
(function () {
  var orig = window.hkMusic;
  window.hkMusic = { known: function (id) { return id === 'media_player.homepod'; }, setFocus: function () { return true; } };
  var M = house({ 'media_player.homepod': ['idle', { supported_features: 16389 }],
                  'media_player.volumio': ['idle', { supported_features: 16389 }] });
  var a = panel('hk-detail-media', 'media_player.homepod', M), b = panel('hk-detail-media', 'media_player.volumio', M);
  ok('Browse Music for a speaker Music plays to', a._e.acts.children.length === 1);
  ok('...and not for one it does not (a Volumio speaker)', b._e.acts.children.length === 0 && b._e.acts.hidden === true);
  window.hkMusic = orig;
})();

// =====================================================================
print('\n=== the thermostat ===');
(function () {
  var now = Date.now(), H24 = 24 * 3600000;
  var rows = [{ s: 'heat', a: { current_temperature: 118 }, lu: (now - 30 * 3600000) / 1000 },
              { s: 'heat', a: { current_temperature: 119 }, lu: (now - 2 * 3600000) / 1000 }];
  var live = { attributes: { current_temperature: 120 } };
  var t = _.trendOf(rows, now, live);
  ok('the trend is the entity\'s own reading, pinned at 24 h ago, closed by the live one',
     t.length === 3 && t[0].t === now - H24 && t[0].v === 118 && t[2].t === now && t[2].v === 120, t);
  ok('a climate that never reports hvac_action has no run time', !_.reportsAction(rows, live) &&
     _.reportsAction([{ a: { hvac_action: 'idle' } }], {}) && _.reportsAction([], { attributes: { hvac_action: 'heating' } }));
  var drawn = null;
  window.hkChart = { line: function (pts) { drawn = pts; return '<svg></svg>'; }, bars: function () { return '<svg></svg>'; } };
  var W = house({ 'climate.water_heater': ['heat', { current_temperature: 120, hvac_modes: ['off', 'heat'] }] });
  W.callWS = function () { var r = {}; r['climate.water_heater'] = rows; return Promise.resolve(r); };
  var p = panel('hk-detail-climate', 'climate.water_heater', W);
  drain();
  ok('its run-time row is hidden', p._root.querySelector('.run').hidden === true);
  ok('its trend is drawn from its own rows', drawn && drawn.length === 3 && drawn[drawn.length - 1].v === 120, drawn);
  var E = house({ 'climate.eco': ['heat_cool', { current_temperature: 75, hvac_action: 'idle' }] });
  E.callWS = function () { return Promise.resolve({ 'climate.eco': [] }); };
  var q = panel('hk-detail-climate', 'climate.eco', E);
  drain();
  ok('a thermostat that reports hvac_action keeps it', q._root.querySelector('.run').hidden === false);
})();
(function () {
  var now = Date.now();
  var rows = [{ s: 'heat', a: { hvac_action: 'idle' }, lu: (now - 10 * 60000) / 1000 }];
  var live = { attributes: { hvac_action: 'heating' }, last_updated: new Date(now - 4 * 60000).toISOString() };
  var r = _.runTimes(rows, now, live);
  ok('run time counts a start after the fetch from when it happened', Math.round(r.today / 60) === 4, r);
})();

// =====================================================================
print('\n=== the water heater ===');
customElements.define('hk-control-card', function () { this.setConfig = function (c) { this.config = c; }; });
(function () {
  var W = house({ 'water_heater.wh': ['eco', { current_temperature: 118.5, temperature: 120 }] });
  var p = panel('hk-detail-water-heater', 'water_heater.wh', W);
  // a small thermostat: the setpoint on the dial, then what it is doing; the
  // tank reading is the first of the right column's readings
  var t = p._dl.querySelector('.t').textContent, r = p._root.querySelector('.r').textContent, tn = p._root.querySelector('.tn').textContent;
  ok('the ring shows the target and the mode, the readings the tank', t === '120°' && r === 'Eco' && tn === '119°', [t, r, tn]);
  ok('no away row where the heater has no away mode', p._away === null);
  // an ESPHome heater: five modes, one of them "off", and on/off
  var W2 = house({ 'water_heater.water_heater': ['eco', { current_temperature: 117.1, temperature: 120, min_temp: 110, max_temp: 140,
    target_temp_step: 1, operation_list: ['off', 'eco', 'electric', 'high_demand', 'heat_pump'], operation_mode: 'eco',
    away_mode: 'off', supported_features: 15 }] });
  var p2 = panel('hk-detail-water-heater', 'water_heater.water_heater', W2);
  // THE THERMOSTAT RING'S GESTURE: nothing until it is a drag, a scroll
  // puts it back, a tap sets on lift, one call on release
  (function () {
    var sent = [];
    p2._svc = function (d, s, data) { sent.push([s, data && data.temperature]); return Promise.resolve(true); };
    var dl = p2._dl, L = dl._listeners;
    dl.getBoundingClientRect = function () { return { left: 0, top: 0, width: 200, height: 172 }; };
    dl.setPointerCapture = dl.releasePointerCapture = function () {};
    var painted = [];
    var orig = p2._paintDial; p2._paintDial = function (t) { painted.push(t); return orig.call(p2, t); };
    var at = function (deg) { var r = deg * Math.PI / 180; return { clientX: 100 + 78 * Math.cos(r), clientY: 100 + 78 * Math.sin(r), pointerId: 1 }; };
    L.pointerdown.forEach(function (f) { f(at(270)); });                 // the top of the ring
    ok('a touch alone paints nothing and sends nothing', painted.length === 0 && sent.length === 0);
    L.pointercancel.forEach(function (f) { f({ pointerId: 1 }); });     // the sheet scrolled
    ok('a scroll that started on the dial puts it back and sends nothing',
       sent.length === 0 && painted.length === 1 && painted[0] === 120 && p2._drag === false, painted);
    painted.length = 0;
    L.pointerdown.forEach(function (f) { f(at(270)); });
    L.pointerup.forEach(function (f) { f(at(270)); });
    ok('a tap that does not travel sets that point on lift, once', sent.length === 1 && sent[0][0] === 'set_temperature', sent);
    sent.length = 0; painted.length = 0;
    L.pointerdown.forEach(function (f) { f(at(200)); });
    L.pointermove.forEach(function (f) { f(at(230)); });
    L.pointermove.forEach(function (f) { f(at(260)); });
    ok('a drag paints as it goes and sends nothing until it lets go', painted.length === 2 && sent.length === 0, [painted, sent]);
    L.pointerup.forEach(function (f) { f(at(260)); });
    ok('...then sends once, where it ended', sent.length === 1 && sent[0][1] === painted[painted.length - 1] && p2._drag === false, sent);
    p2._paintDial = orig;
  })();
  ok('"off" is the power button, not a fifth mode: four modes as a row, away and power present',
     p2._pw !== null && p2._away !== null && p2._mode === null && p2._seg !== null &&
     !/data-m="off"/.test(p2._root._html || p2._root.innerHTML) && /data-m="heat_pump"/.test(p2._root._html || p2._root.innerHTML));
  // the four modes are one row; power is its own row under them, as wide
  ok('the four modes are a row (High demand says Demand, Heat Pump is capitalized) and the power is its own full-width row under it', (function () {
    var html = p2._root._html || p2._root.innerHTML;
    // the modes are HK's segmented control (class "acts mseg")
    return /<div class="acts mseg" style="--n:4">/.test(html) && /<div class="pwr" style="--n:1"><button class="pw"/.test(html) &&
      html.indexOf('class="acts mseg"') < html.indexOf('class="pwr"') && p2._pw.querySelector('.pwl').textContent === 'Turn Off' &&
      />Demand<\/button>/.test(html) && !/High demand/.test(html) && />Heat Pump<\/button>/.test(html);
  })());
})();

// =====================================================================
print('\n=== the sensor chart ===');
(function () {
  var now = Date.now();
  ok('spanTo pins the start and closes at now', (function () {
    var s = _.spanTo([{ t: now - 7200000, v: 5 }, { t: now - 600000, v: 6 }], now - 3600000, now, 7);
    return s.length === 3 && s[0].t === now - 3600000 && s[0].v === 5 && s[2].t === now && s[2].v === 7;
  })());
  var one = [{ t: new Date(now - 3600000 - 60000), v: 97 }];   // HA's start row, fetched a minute ago
  var drawn = null;
  window.hkChart = { line: function (pts) { drawn = pts; return '<svg></svg>'; }, bars: function () { return '<svg></svg>'; } };
  window.hkStats = { history: function (h, id, hours) { return hours === 1 ? one : null; },
                     hourly: function () { return null; }, daily: function () { return null; }, release: function () { return false; } };
  var S = house({ 'sensor.bat': ['97', { unit_of_measurement: '%', device_class: 'battery' }] });
  var p = panel('hk-detail-sensor', 'sensor.bat', S);
  p._range = 'hour'; p.requestUpdate();
  ok('an hour with one row (an unchanged battery) is a line, not "No history"', drawn && drawn.length === 2 &&
     !/No history/.test(p._chart.innerHTML), p._chart.innerHTML);
  ok('...spanning the hour to Now', drawn && Math.abs(drawn[0].t - (now - 3600000)) < 5000 && Math.abs(drawn[1].t - Date.now()) < 5000);
  var calls = 0, big = [];
  for (var i = 0; i < 5000; i++) big.push({ t: new Date(now - 86400000 + i * 17000), v: i % 50 });
  window.hkStats.history = function (h, id, hours) { calls++; return big; };
  var ds = _.downsample, n = 0;
  p._range = 'day'; p.requestUpdate();
  var first = p._ser;
  setState(p, 'sensor.bat', '96', { unit_of_measurement: '%', device_class: 'battery' }, 't2');
  ok('a state push reuses the series\' downsample (not 11,000 points again every few seconds)', p._ser === first && first.ds.length <= 300);
  var E = house({ 'sensor.kwh': ['12', { unit_of_measurement: 'kWh', state_class: 'total_increasing', device_class: 'energy' }] });
  window.hkStats.hourly = function () { return []; };
  var e = panel('hk-detail-sensor', 'sensor.kwh', E);
  e.requestUpdate();                     // empty statistics: the history at once (no 2.6 s wait)
  // the stats row stays (dashes), so the sheet does not jump when a range
  // switch finds nothing -- and never a false "0 kWh"
  ok('an energy sensor with no statistics says so (never "0 kWh")', /No history/.test(e._chart.innerHTML) && !e._stats.hidden &&
     /—/.test(e._stats.innerHTML) && !/0 kWh/.test(e._stats.innerHTML), [e._chart.innerHTML, e._stats.innerHTML]);
})();

// =====================================================================
print('\n=== the vacuum ===');
(function () {
  var V = house({ 'vacuum.v': ['docked', { supported_features: 29212 }],
                  'sensor.v_battery': ['50', { device_class: 'battery', unit_of_measurement: '%' }] });
  V.entities = { 'vacuum.v': { device_id: 'd1' }, 'sensor.v_battery': { device_id: 'd1' } };
  var p = panel('hk-detail-vacuum', 'vacuum.v', V);
  ok('the battery chip reads the device\'s sensor', /50% battery/.test(p._chips.innerHTML), p._chips.innerHTML);
  setState(p, 'sensor.v_battery', '90', { device_class: 'battery', unit_of_measurement: '%' }, 't2');
  ok('a battery change alone moves the sheet (the signature reads the device\'s sensors, not the vacuum alone)', /90% battery/.test(p._chips.innerHTML), p._chips.innerHTML);
  // Clean Areas: a failed send keeps the picks
  var F = house({ 'vacuum.v': ['docked', { supported_features: 29212 }] });
  F.callService = function () { return Promise.reject(new Error('no')); };
  var q = panel('hk-detail-vacuum', 'vacuum.v', F);
  q._reach = [{ id: 'kitchen', name: 'Kitchen' }];
  q._pick = new Set(['kitchen']);
  q._view = 'areas'; q._built = false; q._render();
  q._goBtn._listeners.click.forEach(function (f) { f({}); });
  drain();
  ok('Clean Areas: a failed send keeps the rooms picked and says so', q._pick.size === 1 && /try again/.test(q._why.textContent),
     q._why.textContent);
})();

// =====================================================================
print('\n=== hk-stats: the raw history cache is bounded ===');
(function () {
  load(HK_ROOT + '/frontend/modules/hk-stats.js');
  var S = window.hkStats, realNow = Date.now, T = realNow.call(Date);
  Date.now = function () { return T; };
  var hass = { callApi: function () { return Promise.resolve([[{ state: '1', last_changed: new Date(T).toISOString() }]]); } };
  for (var i = 0; i < 30; i++) S.history(hass, 'sensor.s' + i, 24, null);
  drain();
  S.history(hass, 'sensor.s5', 24, null);       // read recently: kept
  T += 11 * 60000;
  S.history(hass, 'sensor.s5', 24, null);
  S.history(hass, 'sensor.new', 24, null);
  drain();
  var kept = 0;
  for (var j = 0; j < 30; j++) if (S.history(hass, 'sensor.s' + j, 24, null)) kept++;
  ok('past the bound, entries nobody read for ten minutes go', kept < 30, kept);
  ok('an entry still being read stays', !!S.history(hass, 'sensor.s5', 24, null));
  Date.now = realNow;
})();


// =====================================================================
print('\n=== accessory settings: the gear ===');
(function () {
  __resetTimers(); resetHistory();
  var WS = [];
  var h = house({ 'switch.coffee': ['off', { friendly_name: 'Kitchen Coffee' }],
                  'light.table': ['on', { friendly_name: 'Kitchen Table' }] });
  h.user = { is_admin: true };
  h.areas = { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, den: { area_id: 'den', name: 'Den' } };
  h.devices = { dv: { area_id: 'kitchen' } };
  h.entities = { 'switch.coffee': { device_id: 'dv' } };
  h.callWS = function (m) { WS.push(m); return Promise.resolve({}); };
  var saved = window.hkSettings;
  // ONE settings object, as hk-settings.js hands out: the pane must not write into it
  var LIVE = { entities: { 'switch.coffee': { name: 'Coffee', status: false } }, rooms: {} };
  window.hkSettings = { get: function (p, f) {
    if (p === 'accessories') return LIVE;
    if (p === 'boards') return { 'dashboard-kitchen': { favorites: ['lock.front'] } };
    return f; } };
  ok('an admin can edit; a tablet cannot', _.canEdit(h) && !_.canEdit({ user: { is_admin: false } }) && !_.canEdit({}));
  ok('the accessory\'s name, for this dashboard\'s sheet', _.accName('switch.coffee') === 'Coffee');
  HA.hass = h;
  D.open('switch.coffee', {});
  var sheet = _.state().el;
  ok('the gear shows for an admin', sheet.querySelector('.gear').hidden === false);
  D.close(true);
  var h2 = Object.assign({}, h, { user: { is_admin: false } });
  HA.hass = h2;
  D.open('switch.coffee', {});
  ok('...and not for a wall tablet', _.state().el.querySelector('.gear').hidden !== false);
  D.close(true);
  // a hand-written dashboard draws no favorites: the toggle is not offered
  var yaml = _.accessoryPane(h, 'switch.coffee', null, { generated: false });
  ok('Favorite on this dashboard: not on a hand-written dashboard', !/class="tg fav"/.test(yaml._html || yaml.innerHTML || ''));
  ok('...nor "As a favorite" for what is a favorite nowhere', /class="sec fav" hidden/.test(yaml._html || yaml.innerHTML || ''));
  // EDIT THIS PAGE (hk-edit.js): offered in the gear pane where hkEdit offers it
  var EDITS = [], CLOSED = 0, OFFER = false;
  window.hkEdit = { offer: function (x) { return OFFER && !!(x && x.user && x.user.is_admin); }, enter: function (x) { EDITS.push(x); return true; } };
  var noEdit = _.accessoryPane(h, 'switch.coffee', null, { generated: true });
  ok('Edit This Page: not where Edit mode is not offered', !/Edit This Page/.test(noEdit._html || ''));
  OFFER = true;
  var withEdit = _.accessoryPane(h, 'switch.coffee', null, { generated: true, close: function () { CLOSED++; } });
  ok('Edit This Page: in the gear pane where it is offered (an admin, a page with something to arrange)',
     /class="edpg"[^>]*>.*Edit This Page/.test(withEdit._html || ''));
  ok('...not on the settings page', !/Edit This Page/.test(_.accessoryPane(h, 'switch.coffee', null, { panel: true })._html || ''));
  withEdit.querySelector('.edpg')._listeners.click[0]({});
  ok('...a tap closes the sheet and starts Edit mode for this person', CLOSED === 1 && EDITS.length === 1 && !!EDITS[0].user.is_admin);
  delete window.hkEdit;
  var pane = _.accessoryPane(h, 'switch.coffee', null, { generated: true });
  var q = function (sel) { return pane.querySelector(sel); };
  ok('Favorite on this dashboard: offered on a generated one', /class="tg fav"/.test(pane._html || pane.innerHTML || ''));
  // WHERE IT SHOWS (Hidden Accessories): asked of the server as the pane opens
  // (each pane built here asks: keep this one's, so the writes below count from 1)
  WS.splice(0, WS.length - 1);
  ok('Where it shows asks the server what hides it', WS[0].type === 'hk_frontend/hidden/get' &&
     WS[0].entity_ids.length === 1 && WS[0].entity_ids[0] === 'switch.coffee', WS[0]);
  ok('...no Include in Status or Show on Home switches of their own any more',
     !/class="tg status"|class="tg home"/.test(pane._html || ''));
  ok('Favorite on this dashboard: from its item', q('.fav').checked === false);
  ok('the name field holds the house\'s name', q('.nm').value === 'Coffee' && q('.nm').placeholder === 'Kitchen Coffee');
  ok('the room is the device\'s', q('.room').value === 'kitchen');
  var shownTg = q('.row.wall').querySelector('.tg.shown');
  shownTg.checked = false; shownTg._listeners.change[0]();
  ok('Show in HK Frontend off: hidden everywhere, in one write', WS[1].type === 'hk_frontend/hidden/set' &&
     WS[1].everywhere === true && WS[1].entity_ids[0] === 'switch.coffee' && JSON.stringify(WS[1].places) === '{}', WS[1]);
  q('.fav').checked = true; q('.fav')._listeners.change[0]();
  ok('Favorite: the dashboard\'s own list', WS[2].type === 'hk_frontend/board/favorite' &&
     WS[2].dashboard === 'dashboard-kitchen' && WS[2].favorite === true);
  q('.room').value = 'kitchen'; q('.room')._listeners.change[0]();
  ok('choosing the device\'s own room follows the device again', WS[3].type === 'config/entity_registry/update' &&
     WS[3].area_id === null);
  q('.room').value = 'den'; q('.room')._listeners.change[0]();
  ok('...another room is the entity\'s own', WS[4].area_id === 'den');
  q('.nm').value = '  Coffee Maker '; q('.nm')._listeners.change[0]();
  ok('a name is saved trimmed, for the house', WS[5].name === 'Coffee Maker' && !('screen' in WS[5]));
  q('.here').checked = true; q('.nm')._listeners.change[0]();
  ok('...and with Only on this dashboard, for this one', WS[6].screen === 'dashboard-kitchen');
  // WHAT IT SAYS: a switch's names for On and Off, and a favorite's room line
  var ontx = q('.ontx'), fvr = q('.fvr');
  ok('a switch says what On and Off are called', !!ontx && !!q('.offtx'));
  var nWS = WS.length;
  ontx.value = ' Brewing '; ontx._listeners.change[0]();
  ok('...On is saved trimmed', WS.length === nWS + 1 && WS[nWS].on_text === 'Brewing', WS[nWS]);
  ontx.value = ''; ontx._listeners.change[0]();
  ok('...and empty is back to automatic', WS[nWS + 1].on_text === null, WS[nWS + 1]);
  ok('the room line as a favorite shows its room as the placeholder', !!fvr && fvr.placeholder === 'Kitchen', fvr && fvr.placeholder);
  WS.length = nWS;
  var btn = { dataset: { v: 'light' } };
  q('.seg.show')._listeners.click[0]({ target: { closest: function () { return btn; } } });
  ok('Show as: light', WS[7].show_as === 'light');
  var g = { dataset: { v: 'hk:coffee' } };
  q('.glyphs')._listeners.click[0]({ target: { closest: function () { return g; } } });
  ok('an icon', WS[8].icon === 'hk:coffee');
  ok('the glyphs offered follow Show as', _.glyphsFor('switch.coffee', 'light')[0] === 'lightbulb' &&
     _.glyphsFor('switch.coffee', null)[0] === 'power-socket-us');
  // AS A FAVORITE: a name, a glyph and what it controls with
  ok('as a favorite: the name starts empty, its placeholder the accessory\'s name',
     q('.fvn').value === '' && q('.fvn').placeholder === 'Coffee', q('.fvn').placeholder);
  q('.fvn').value = ' Morning Coffee '; q('.fvn')._listeners.change[0]();
  ok('...a favorite\'s name is saved trimmed', WS[9].fav_name === 'Morning Coffee' && WS[9].entity_id === 'switch.coffee', WS[9]);
  var fg = { dataset: { v: 'hk:lamp' } };
  q('.fvg')._listeners.click[0]({ target: { closest: function () { return fg; } } });
  ok('...its glyph there', WS[10].fav_icon === 'hk:lamp', WS[10]);
  var fs = { dataset: { v: '' } };
  q('.fvg')._listeners.click[0]({ target: { closest: function () { return fs; } } });
  ok('...Same: back to its icon', WS[11].fav_icon === null);
  ok('...the lights and switches it could be joined with are offered', q('.fvw').innerHTML.indexOf('light.table') > 0);
  q('.fvw').value = 'light.table'; q('.fvw')._listeners.change[0]();
  ok('...together with another light or switch', JSON.stringify(WS[12].fav_with) === '["light.table"]', WS[12]);
  ok('...and it leaves the list it was picked from', q('.fvw').innerHTML.indexOf('light.table') < 0);
  // Turning OFF "Only on this dashboard" gives the house's name back; the
  // per-screen name typed there must not be saved as the house's
  var n0 = WS.length;
  q('.nm').value = 'Kitchen Coffee Only';
  q('.here').checked = false; q('.here')._listeners.change[0]();
  ok('Only on this dashboard off: this dashboard\'s name goes', WS[n0].screen === 'dashboard-kitchen' && WS[n0].name === null, WS[n0]);
  drainMicrotasks();
  ok('...and the house\'s name is NOT overwritten', WS.length === n0 + 1, WS.slice(n0));
  ok('...the field shows the house\'s name again', q('.nm').value === 'Coffee Maker', q('.nm').value);
  // Reset asks first, in place; Cancel changes nothing
  var n1 = WS.length;
  q('.reset')._listeners.click[0]();
  ok('Reset asks first: nothing is sent yet', WS.length === n1 && q('.sure').hidden === false);
  q('.sure .no')._listeners.click[0]();
  ok('...Cancel sends nothing', WS.length === n1 && q('.sure').hidden === true);
  q('.reset')._listeners.click[0]();
  q('.sure .go')._listeners.click[0]();
  ok('...Reset clears every setting of the accessory', WS[n1] && WS[n1].name === null && WS[n1].color === null &&
     WS[n1].attribute === null && WS[n1].label === null && WS[n1].fav_with === null, WS[n1]);
  ok('...its tile size too', WS[n1] && WS[n1].size === null, WS[n1]);
  // TILE SIZE: Automatic, Regular or Tall, saved as chosen
  var n2 = WS.length, tall = { dataset: { v: 'tall' } }, autoS = { dataset: { v: '' } };
  q('.seg.size')._listeners.click[0]({ target: { closest: function () { return tall; } } });
  ok('Tile size: Tall', WS[n2] && WS[n2].size === 'tall' && WS[n2].entity_id === 'switch.coffee', WS[n2]);
  q('.seg.size')._listeners.click[0]({ target: { closest: function () { return autoS; } } });
  ok('...Automatic is no size of its own', WS[n2 + 1] && WS[n2 + 1].size === null, WS[n2 + 1]);
  ok('the pane never writes into the live settings (or the feed\'s answer looks like no change, and no screen redraws)',
     JSON.stringify(LIVE.entities['switch.coffee']) === '{"name":"Coffee","status":false}', LIVE.entities['switch.coffee']);
  window.hkSettings = saved;
})();

// THE SPIN CONTROL (the accessory's `anim`): offered on a fan's gear, saved as
// Automatic / Spin / Still, and NOT on a non-fan.
(function () {
  __resetTimers(); resetHistory();
  var WS = [];
  var h = house({ 'fan.den': ['on', { friendly_name: 'Den Fan' }] });
  h.user = { is_admin: true };
  h.areas = { den: { area_id: 'den', name: 'Den' } };
  h.entities = { 'fan.den': { area_id: 'den' } };
  h.callWS = function (m) { if (m.type !== 'hk_frontend/hidden/get') WS.push(m); return Promise.resolve({}); };   // Where it shows' read is not a write
  var saved = window.hkSettings;
  window.hkSettings = { get: function (p, f) {
    if (p === 'accessories') return { entities: { 'fan.den': { anim: 'none' } }, rooms: {} };
    if (p === 'boards') return {};
    return f; } };
  var pane = _.accessoryPane(h, 'fan.den', null, { generated: true });
  var html = pane._html || pane.innerHTML || '';
  ok("a fan's gear offers the Spinning control", /class="seg spin"/.test(html), html.slice(0, 120));
  var spin = pane.querySelector('.seg.spin');
  var pick = function (v) { spin._listeners.click[0]({ target: { closest: function () { return { dataset: { v: v } }; } } }); };
  pick('none');
  ok('Still saves anim none (keep a chosen icon from spinning)', WS[0].type === 'hk_frontend/accessory/set' &&
     WS[0].entity_id === 'fan.den' && WS[0].anim === 'none', WS[0]);
  pick('spin');
  ok('Spin saves anim spin (said explicitly)', WS[1].anim === 'spin', WS[1]);
  pick('');
  ok('Automatic clears it back to its kind', WS[2].anim === null, WS[2]);
  // a non-fan: the section is not drawn at all
  window.hkSettings = { get: function (p, f) {
    if (p === 'accessories') return { entities: {}, rooms: {} };
    if (p === 'boards') return {};
    return f; } };
  var other = house({ 'switch.coffee': ['off', { friendly_name: 'Coffee' }] });
  other.user = { is_admin: true }; other.areas = {}; other.entities = {}; other.callWS = function () { return Promise.resolve({}); };
  var coffee = _.accessoryPane(other, 'switch.coffee', null, { generated: true });
  // a switch: built, but hidden until Show As makes it a fan -- and back
  ok("a switch's gear keeps it hidden", /class="spinrow" hidden/.test(coffee._html || coffee.innerHTML || ''));
  var row = coffee.querySelector('.spinrow');
  var asFan = { dataset: { v: 'fan' } }, asLight = { dataset: { v: 'light' } };
  coffee.querySelector('.seg.show')._listeners.click[0]({ target: { closest: function () { return asFan; } } });
  ok('...shown the moment Show As is Fan, no reopening', row.hidden === false);
  coffee.querySelector('.seg.show')._listeners.click[0]({ target: { closest: function () { return asLight; } } });
  ok('...and hidden again for Light', row.hidden === true);
  window.hkSettings = saved;
})();

// ARRANGE: a tile moved left or right among the tiles it sits with; what is
// not on show there keeps its place in the saved order
(function () {
  var mv = _.arrangeMove;
  var r = mv(['a', 'b', 'c'], ['x', 'a', 'y', 'b', 'c'], 'b', -1);
  ok('Move Left: it swaps with the tile before it', r.visible.join() === 'b,a,c', r);
  ok('...and the others in the saved order keep their places', r.full.join() === 'x,b,y,a,c', r);
  r = mv(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', 1);
  ok('Move Right: with the tile after it (the end of a row wraps: it is reading order)', r.visible.join() === 'a,c,b' && r.full.join() === 'a,c,b');
  ok('nothing further left than the first, or right than the last',
     mv(['a', 'b'], ['a', 'b'], 'a', -1) === null && mv(['a', 'b'], ['a', 'b'], 'b', 1) === null);
  // a room page lists its lights A to Z until the room has an order of its
  // own: the move saves the lights in the order just seen
  r = mv(['l1', 'l2'], ['l2', 'fan', 'l1'], 'l1', 1);
  ok('...lights shown A to Z keep the order just seen once saved', r.visible.join() === 'l2,l1' && r.full.join() === 'l2,fan,l1', r);
  // read off the page: the tile, its neighbours, where it lives
  var kid = function (e, place, extra) { return { _config: Object.assign({ entity: e, name: e.toUpperCase(), hk_place: place }, extra || {}) }; };
  var row = { children: [] };
  var P = { area: 'kitchen', group: 'Lights' };
  row.children = [kid('light.a', P), kid('light.b', P, { size: 'tall' }), kid('light.c', P)];
  row.children.forEach(function (k) { k.parentNode = row; });
  var h = { states: {}, areas: { kitchen: { name: 'Kitchen' } } };
  var a = _.arrangeOf(h, 'light.b', row.children[1]);
  ok('Arrange reads its neighbours off the page, in order', !!a && a.visible.join() === 'light.a,light.b,light.c' && a.area === 'kitchen', a);
  ok('...a tall tile is tall in the small copy', a && a.look['light.b'].tall === true && a.look['light.a'].tall === false);
  ok('...and says in plain words what it moves among', a && a.note === 'Moves it among the lights in the Kitchen.', a && a.note);
  var lone = { children: [] }; lone.children = [kid('light.z', P)]; lone.children[0].parentNode = lone;
  ok('nothing to arrange (alone, or a tile with no place): no Arrange', _.arrangeOf(h, 'light.z', lone.children[0]) === null &&
     _.arrangeOf(h, 'light.a', { _config: { entity: 'light.a' }, parentNode: row }) === null);
  // A CATEGORY PAGE'S TILE (hk-strategy.js hk_place with `page`, for Edit
  // mode): its room and group are known, but the sheet's Arrange stays the
  // room pages' and Home's -- Edit mode arranges the category pages
  var CP = { area: 'kitchen', group: 'Lights', page: 'lights' }, cat = { children: [] };
  cat.children = [kid('light.a', CP), kid('light.b', CP)];
  cat.children.forEach(function (k) { k.parentNode = cat; });
  ok('a category page\'s tile (its place has a page): no Arrange in the sheet', _.arrangeOf(h, 'light.a', cat.children[0]) === null);
  var SP = { page: 'security' }, sec = { children: [] };
  sec.children = [kid('lock.a', SP), kid('lock.b', SP)];
  sec.children.forEach(function (k) { k.parentNode = sec; });
  ok('...nor on Security\'s (a page order, no room)', _.arrangeOf(h, 'lock.a', sec.children[0]) === null);
  var favRow = { children: [] }, F = { fav: true };
  favRow.children = [kid('lock.front', F), kid('light.a', F)];
  favRow.children.forEach(function (k) { k.parentNode = favRow; });
  var savedHS = window.hkSettings;
  window.hkSettings = { get: function (p, f) { return p === 'boards' ? { 'dashboard-kitchen': { favorites: ['lock.front', 'gone.x', 'light.a'] } } : f; } };
  var fv = _.arrangeOf(h, 'light.a', favRow.children[1]);
  ok('Favorites: this screen\'s list, moved as seen', !!fv && fv.fav && fv.full.join() === 'lock.front,gone.x,light.a' &&
     _.arrangeMove(fv.visible, fv.full, 'light.a', -1).full.join() === 'light.a,gone.x,lock.front', fv);
  window.hkSettings = savedHS;
})();

// SEARCH EVERY ICON: the hk: glyphs first, then Home Assistant's Material
// icons by name or keyword -- less those with an hk: twin
(function () {
  var MDI = [{ name: 'fan', keywords: ['home automation'] }, { name: 'ceiling-fan-light', keywords: [] },
             { name: 'hamburger', keywords: ['food', 'burger'] }, { name: 'fan-off', keywords: [] }];
  var a = _.glyphSearch('fan', MDI);
  ok('a word finds the hk: glyphs', a.hk.some(function (x) { return x.v === 'hk:ceiling-fan'; }) &&
     a.hk.every(function (x) { return /fan/.test(x.v); }), a.hk);
  ok('...then the Material ones, without an hk: twin', a.mdi.map(function (x) { return x.v; }).join() === 'mdi:fan-off', a.mdi);
  ok('a keyword finds a Material icon', _.glyphSearch('burger', MDI).mdi[0].v === 'mdi:hamburger');
  var M2 = [{ name: 'unicorn', keywords: ['fantasy'] }, { name: 'fan-alert', keywords: [] }];
  ok('...a name match comes before a keyword that only begins with the word',
     _.glyphSearch('fan', M2).mdi.map(function (x) { return x.v; }).join() === 'mdi:fan-alert,mdi:unicorn');
  ok('every word must match', _.glyphSearch('ceiling light fan', MDI).hk.map(function (x) { return x.v; }).join() === 'hk:ceiling-fan-light');
  ok('each kind is offered Apple\'s Home glyphs', _.glyphsFor('fan.x', null).indexOf('ceiling-fan') >= 0 &&
     _.glyphsFor('cover.x', null).indexOf('curtains') >= 0 && _.glyphsFor('climate.x', null)[0] === 'thermostat');
})();


// =====================================================================
print('\n=== pop-ups: a hash opens one, Show pop-up asks for one ===');
(function () {
  __resetTimers(); resetHistory();
  var saved = window.hkSettings, savedP = window.hkPopup;
  var POPS = [{ hash: 'doorbell', name: 'Doorbell', kind: 'camera', entity: 'camera.fd', dashboards: [] },
              { hash: 'gate', name: 'Gate', kind: 'accessories', entities: ['light.a'], dashboards: ['dashboard-other'] }];
  window.hkSettings = { get: function (p, f) { return p === 'popups' ? POPS : f; }, onChange: function () {} };
  ok('a hash names a pop-up on this dashboard', !!_.popupFor('#doorbell') && _.popupFor('doorbell').name === 'Doorbell');
  ok('...not one kept to other dashboards', _.popupFor('#gate') === null);
  ok('...not an unknown one', _.popupFor('#nope') === null);
  window.hkPopup = { hashes: function () { return ['#doorbell']; } };
  ok('a YAML hk-popup-card claiming the hash wins', _.openPopup('#doorbell') === false);
  window.hkPopup = savedP;
  var h = house({ 'light.a': ['on', {}] });
  h.user = { id: 'u1', is_admin: false };
  HA.hass = h;
  // Show pop-up: this screen (dashboard-kitchen, user u1) is asked, or not
  ok('asked with no lists: the hash is set', _.asked({ detail: { type: 'popup', popup: 'doorbell' } }) === true &&
     location.hash === '#doorbell');
  resetHistory();
  ok('...not when kept to another dashboard', _.asked({ detail: { type: 'popup', popup: 'doorbell',
     dashboards: ['dashboard-den'] } }) === false && location.hash === '');
  ok('...not when kept to another user', _.asked({ detail: { type: 'popup', popup: 'doorbell',
     users: ['u2'] } }) === false);
  ok('...yes for this user on this dashboard', _.asked({ detail: { type: 'popup', popup: 'doorbell',
     users: ['u1'], dashboards: ['dashboard-kitchen'] } }) === true);
  ok('...never for a pop-up this dashboard does not have', _.asked({ detail: { type: 'popup', popup: 'gate' } }) === false);
  // only on a dashboard; a hidden page holds it
  resetHistory();
  history.pushState(null, '', 'http://ha/config/integrations');
  ok('not on one of HA\'s own pages (Settings): no hash, no sheet',
     _.onDashboard() === false && _.asked({ detail: { type: 'popup', popup: 'doorbell' } }) === false && location.hash === '');
  history.pushState(null, '', 'http://ha/dashboard-kitchen/0');
  var vis = document.visibilityState, vl = (document.__l || {}).visibilitychange || [];
  document.visibilityState = 'hidden';
  ok('a hidden page does not take it now', _.asked({ detail: { type: 'popup', popup: 'doorbell' } }) === false &&
     location.hash === '');
  document.visibilityState = 'visible';
  ((document.__l || {}).visibilitychange || vl).forEach(function (f) { f({}); });
  ok('...and opens it when it becomes visible (a tablet screen waking for the doorbell)', location.hash === '#doorbell');
  document.visibilityState = vis;
  window.hkSettings = saved;
  resetHistory();
})();


// =====================================================================
print('\n=== a pop-up sheet goes with its hash; any sheet covers the page ===');
(function () {
  __resetTimers(); resetHistory();
  var saved = window.hkSettings;
  window.hkSettings = { get: function (p, f) {
    return p === 'popups' ? [{ hash: 'gate', name: 'Gate', kind: 'accessories', entities: ['light.a'], dashboards: [], close_after: 60 }] : f; },
    onChange: function () {} };
  HA.hass = house({ 'light.a': ['on', {}] });
  window.hkPopupCover = 0;
  history.pushState(null, '', 'http://ha/dashboard-kitchen/0#gate');
  // (the shim cannot build a group sheet: a plain one, marked as the pop-up's)
  D.open('light.a', {}, { hashed: true });
  _.state().popup = 'gate';
  ok('the pop-up opens for its hash', !!_.state().el && _.state().popup === 'gate');
  ok('...and covers the page (the camera strip pauses)', window.hkPopupCover === 1);
  // ASKED AGAIN WHILE UP (an automation asking every minute, say): the same
  // sheet stays, no history entry is added, its Close after starts again
  HA.hass.user = { id: 'u1', is_admin: false };
  var el0 = _.state().el, depth = HIST.stack.length;
  _.state().autoMs = 3600000;
  __resetTimers();
  ok('asked again while it is up: still answered', _.asked({ detail: { type: 'popup', popup: 'gate' } }) === true);
  ok('...the same sheet, not closed and reopened (a code being typed stays)', _.state().el === el0);
  ok('...no second history entry', HIST.stack.length === depth, HIST.stack.length + ' vs ' + depth);
  ok('...and its Close after runs again from now',
     __timers.filter(Boolean).some(function (t) { return t.ms === 3600000; }));
  // CLOSE POP-UP (the alarm cleared): only the sheet that IS that pop-up, and
  // only on the screens asked
  ok('close asked for another pop-up: this sheet stays',
     _.asked({ detail: { type: 'popup_close', popup: 'doorbell' } }) === false && _.state().el === el0);
  ok('...kept to another dashboard: stays',
     _.asked({ detail: { type: 'popup_close', popup: 'gate', dashboards: ['dashboard-den'] } }) === false && _.state().el === el0);
  ok('...kept to another user: stays',
     _.asked({ detail: { type: 'popup_close', popup: 'gate', users: ['u2'] } }) === false && _.state().el === el0);
  ok('close asked for this one, here: the sheet goes',
     _.asked({ detail: { type: 'popup_close', popup: 'gate', dashboards: ['dashboard-kitchen'] } }) === true && !_.state().el);
  ok('...the page is uncovered', window.hkPopupCover === 0);
  ok('...and the hash goes with it, so a reload does not bring it back', location.hash !== '#gate', location.hash);
  // and the case the rest of this test covers: the hash leaving closes it too
  history.pushState(null, '', 'http://ha/dashboard-kitchen/0#gate');
  D.open('light.a', {}, { hashed: true });
  _.state().popup = 'gate';
  history.pushState(null, '', 'http://ha/dashboard-kitchen/0');
  dispatchEvent({ type: 'location-changed' });
  ok('the hash leaves: the sheet goes (an automation asking again opens it fresh)', !_.state().el);
  ok('...and uncovers the page', window.hkPopupCover === 0);
  window.hkSettings = saved;
  resetHistory();
})();

print('\n=== an unavailable camera is said, not black ===');
(function () {
  var H = house({ 'camera.gone': ['unavailable', {}] });
  var p = panel('hk-detail-camera', 'camera.gone', H);
  var kids = p._root.children || [];
  ok('an unavailable camera draws a placeholder, no stream card',
     !!p._naEl && p._naEl.className === 'na' && p._naEl.parentNode === p._root && !p._card, kids.length);
  H.states['camera.gone'] = { entity_id: 'camera.gone', state: 'idle', attributes: {}, last_updated: 't2', last_changed: 't2' };
  p.hass = Object.assign({}, H);
  ok('...and swaps to the stream when it comes back', !p._naEl && typeof p._na === 'function');
  // ...and the other way: a camera that goes away WHILE its sheet is open
  // loses its stream card (dead video and the message used to stack)
  var card = p._card;
  H.states['camera.gone'] = { entity_id: 'camera.gone', state: 'unavailable', attributes: {}, last_updated: 't3', last_changed: 't3' };
  p.hass = Object.assign({}, H);
  ok('a camera gone while open: the stream card leaves, the placeholder alone remains',
     !!card && !p._card && card.parentNode !== p._root && !!p._naEl && p._naEl.parentNode === p._root);
})();

print('\n=== Climate category sheets ===');
(function () {
  D.close(true); resetHistory(); __resetTimers();
  var h = house({ 'sensor.den_t': ['71', { friendly_name: 'Den Temperature', unit_of_measurement: '°F' }],
                  'sensor.bedroom_t': ['80', { friendly_name: 'Bedroom Temperature', unit_of_measurement: '°F' }] });
  h.areas = { den: { name: 'Den' }, bedroom: { name: 'Bedroom' } };
  h.entities = { 'sensor.den_t': { area_id: 'den' }, 'sensor.bedroom_t': { area_id: 'bedroom' } };
  HA.hass = h;
  C.hass = function () { return HA.hass; };
  var originalCreate = C.create;
  C.create = function (cfg) { var el = document.createElement('div'); el.config = cfg; return el; };
  var members = ['sensor.den_t', 'sensor.bedroom_t'];
  function resolve() { return { ids: members.slice(), title: 'Temperature', value: members.length === 2 ? '71–80°' : members.length ? '80°' : 'No accessories' }; }
  ok('a Climate category opens as a sheet', D.openGroup('Temperature', members, { kind: 'temperature', climate: {}, resolve: resolve }));
  var group = D._.state().panel, listColor = D._.state().icon.style.color;
  ok('each sensor is a room-labelled reading pill', group._kids[0].config.room === 'Den' &&
    group._kids[0].config.label_mode === 'climate_temperature' && group._kids[1].config.room === 'Bedroom' &&
    group._kids[0].config.layout === 'favourite' && group._kids[0].config.size === 'regular');
  ok('the popup displays the same range as the row', group._summary.textContent === '71–80°');
  ok('every nested reading pill uses the sheet blur without joining shared glass',
    group._kids.every(function (el) { return el.config.glass === false; }));
  var kid = group._kids[0];
  // as in the frontend, the root element holds each new object the panel is
  // pushed (the sheet follows the host's current client)
  function pushRoot(x) { HA.hass = x; group.hass = x; }
  pushRoot(Object.assign({}, h));
  ok('ordinary state pushes keep the pill instances', group._kids[0] === kid);
  // THE LIST IS NOT WORKED OUT AGAIN ON EVERY PUSH: an unrelated state
  // change only hands the pills hass; a member's, or a registry change, does
  var asked = 0, realResolve = resolve;
  group._config.resolve = function (x) { asked++; return realResolve(x); };
  var pushed = 0, kidHass = kid.hass;
  h.states['light.elsewhere'] = { entity_id: 'light.elsewhere', state: 'on', attributes: {}, last_updated: 'u1' };
  pushRoot(Object.assign({}, h));
  ok('an unrelated state change does not resolve the list again', asked === 0, asked);
  ok('...but the pills still get the new hass', kid.hass !== kidHass && group._kids[0] === kid);
  h.states['sensor.den_t'] = Object.assign({}, h.states['sensor.den_t'], { state: '72', last_updated: 'u2' });
  pushRoot(Object.assign({}, h));
  ok('a member\'s change does', asked === 1, asked);
  members = ['sensor.bedroom_t'];
  h.entities = Object.assign({}, h.entities);            // the entity registry moved
  pushRoot(Object.assign({}, h));
  ok('membership and the summary update while the popup is open', group._kids.length === 1 && group._summary.textContent === '80°');
  group._config.resolve = realResolve;
  ok('a pill opens its sensor details', D.open('sensor.bedroom_t', {}));
  ok('device details retain the parent Climate category', D._.state().returnGroup.kind === 'temperature' && HIST.i === 1);
  D.close();
  ok('closing device details returns to the live category without another history entry', D._.state().kind === 'group' && HIST.i === 1);
  D.open('sensor.bedroom_t', {}); history.back(); flushPops();
  ok('browser Back from a device returns to the category', D._.state().kind === 'group' && HIST.i === 1);
  ok('...with the list\'s own glyph colour, not the gray fallback', listColor && D._.state().icon.style.color === listColor,
     [listColor, D._.state().icon.style.color]);
  D.open('sensor.bedroom_t', {});
  var auto = D._.state().auto; __timers[auto - 1].fn(); flushPops();
  ok('left to idle, a device opened from a category closes with it (one timeout, not two)', !D._.state().el && HIST.i === 0);
  D.openGroup('Temperature', members, { kind: 'temperature', climate: {}, resolve: resolve });
  D.open('sensor.bedroom_t', {}); members = []; D.close();
  ok('removing the last member still returns to a dismissible empty category', D._.state().kind === 'group' && D._.state().panel._kids.length === 0);
  D.close(); flushPops();
  ok('closing the category returns to the page with no leftover history', !D._.state().el && HIST.i === 0);
  C.create = originalCreate;
})();

print('\n=== the Energy page, from an accessory\'s gear and its sheet ===');
(function () {
  D.close(true); __resetTimers(); resetHistory();
  var WS = [];
  var h = house({ 'sensor.fridge_w': ['120', { friendly_name: 'Fridge Power', unit_of_measurement: 'W', device_class: 'power' }] });
  h.user = { is_admin: true }; h.areas = {}; h.entities = {}; h.devices = {};
  h.callWS = function (m) { if (m.type !== 'hk_frontend/hidden/get') WS.push(m); return Promise.resolve({}); };   // Where it shows' read is not a write
  var saved = window.hkSettings;
  var PLAN = { names: { fridge: 'Fridge' }, devices: { 'sensor.fridge_w': { key: 'fridge', name: 'Fridge', power: 'sensor.fridge_w' } },
               sections: [{ id: 'rooms', name: 'Rooms', items: [{ key: 'other' }] }, { id: 'kitchen', name: 'Kitchen', items: [] }] };
  window.hkSettings = { get: function (p, f) {
    if (p === 'accessories') return { entities: {}, rooms: {} };
    if (p === 'energy') return PLAN;
    return f; } };
  var pane = _.accessoryPane(h, 'sensor.fridge_w', null, { generated: true });
  var ens = pane.querySelector('.ens'), enh = pane.querySelector('.enh');
  var paneHtml = pane._html || pane.innerHTML || '';
  ok('a hidden device: Hidden, and Show there off', !!ens && !!enh && /<option value="" selected>Hidden<\/option>/.test(paneHtml) &&
     !/class="tg enh"[^>]* checked/.test(paneHtml));
  ens.value = 'kitchen'; ens._listeners.change[0]();
  ok('a section chosen: ONE move, by the server, in the sections as stored',
     WS.length === 1 && WS[0].type === 'hk_energy/device/section' && WS[0].key === 'fridge' && WS[0].section === 'kitchen', WS);
  ok('...and it shows there', enh.checked === true);
  window.hkSettings = saved;
  // ITS COST in the house's currency
  ok('dollars by default', /^\$?1\.24$|1\.24/.test(_.money({ config: {} }, 1.239, 2)), _.money({ config: {} }, 1.239, 2));
  var eur = _.money({ config: { currency: 'EUR' } }, 1.239, 2);
  ok('the house\'s own currency, not a dollar sign', eur.indexOf('$') < 0 && /1[.,]24/.test(eur) && /€|EUR/.test(eur), eur);
  ok('a currency the browser cannot name is its code', /XYZ|¤/.test(_.money({ config: { currency: 'XYZ' } }, 2, 2)));
})();

// =====================================================================
print('\n=== the person sheet ===');
(function () {
  load(HK_ROOT + '/frontend/cards/hk-person.js');
  var h = house({ 'person.alex': ['home', { device_trackers: ['device_tracker.alex_phone'] }], 'person.sam': ['not_home', {}],
                  'device_tracker.alex_phone': ['home', {}], 'sensor.alex_phone_battery': ['80', { device_class: 'battery', unit_of_measurement: '%' }],
                  'sensor.noise': ['1', {}] });
  h.entities = { 'device_tracker.alex_phone': { device_id: 'd1' }, 'sensor.alex_phone_battery': { device_id: 'd1' } };
  var p = panel('hk-detail-person', 'person.alex', h);
  var sig = p._sigOf(), memo = p._depsMemo;
  ok('person: the people and the phone battery found once', memo && memo.people.length === 2 && memo.bat === 'sensor.alex_phone_battery', memo);
  var h2 = Object.assign({}, h, { states: Object.assign({}, h.states, { 'sensor.noise': { entity_id: 'sensor.noise', state: '2', attributes: {} } }) });
  p.hass = h2;
  ok('person: an unrelated update -- the same lookup (no walk over every state), the same signature', p._depsMemo === memo && p._sigOf() === sig);
  var h3 = Object.assign({}, h2, { states: Object.assign({}, h2.states, { 'sensor.alex_phone_battery': { entity_id: 'sensor.alex_phone_battery', state: '79', attributes: { device_class: 'battery', unit_of_measurement: '%' } } }) });
  p.hass = h3;
  ok('person: the phone battery moving still redraws', p._sigOf() !== sig);
  var h4 = Object.assign({}, h3, { states: Object.assign({}, h3.states, { 'person.sam': { entity_id: 'person.sam', state: 'home', attributes: {} } }) });
  p.hass = h4;
  ok('person: another person coming home too', p._sigOf().indexOf('home,home') >= 0);
})();

// =====================================================================
print('\n=== the automation sheet ===');
(function () {
  load(HK_ROOT + '/frontend/cards/hk-headers.js');
  var morph0 = window.hkCards.morph;
  window.hkCards.morph = function (el, html) { el.innerHTML = html; };    // (the shim's elements have no child nodes)
  CALLS = [];
  var WS = [], SUBS = [];
  var h = house({ 'automation.porch': ['on', { friendly_name: 'Lighting - Front Yard - Porch Lights', last_triggered: new Date().toISOString() }] });
  h.callWS = function (m) { WS.push(m); return Promise.resolve([]); };
  h.connection = { subscribeMessage: function (cb, m) { SUBS.push({ cb: cb, m: m }); return Promise.resolve(function () {}); } };
  var p = panel('hk-detail-automation', 'automation.porch', h);
  ok('automation: its own sheet for the kind', window.hkDetail.kindOf(h, 'automation.porch') === 'automation');
  ok('automation: the last week asked of the logbook, once', WS.length === 1 && WS[0].type === 'logbook/get_events' && WS[0].entity_ids[0] === 'automation.porch', WS);
  ok('automation: what is paused, subscribed', SUBS.some(function (x) { return x.m.type === 'hk_frontend/snooze/subscribe'; }));
  var run = p._root.querySelector('.run');
  run._listeners.click.forEach(function (f) { f({}); });
  ok('automation: Run Now triggers it', CALLS.indexOf('automation.trigger') >= 0, CALLS);
  var seg = p._root.querySelector('.seg');
  function pick(m) { CALLS = []; seg._listeners.click.forEach(function (f) { f({ target: { closest: function () { return { getAttribute: function () { return m; } }; } } }); }); return CALLS.slice(); }
  ok('automation: Off Today pauses it until midnight', pick('today')[0] === 'hk_frontend.pause_automation');
  ok('automation: Off turns it off', pick('off')[0] === 'automation.turn_off');
  ok('automation: On turns it on', pick('on')[0] === 'automation.turn_on');
  SUBS.filter(function (x) { return x.m.type === 'hk_frontend/snooze/subscribe'; })[0].cb({ until: { 'automation.porch': new Date(Date.now() + 3600e3).toISOString() } });
  ok('automation: On while paused resumes it (the pause forgotten)', pick('on')[0] === 'hk_frontend.resume_automation');
  ok('automation: on, its line is its area and group', p._root.querySelector('.note').textContent === 'Front Yard · Lighting');
  setState(p, 'automation.porch', 'off', { friendly_name: 'Lighting - Front Yard - Porch Lights' }, 't3');
  ok('automation: paused, the line says when it comes back', /Back on at midnight/.test(p._root.querySelector('.note').textContent || ''), p._root.querySelector('.note').textContent);
  window.hkCards.morph = morph0;
})();

print('\n=== the sheet reads through the client (Phase 1 slice 5) ===');
(function () {
  D.close(true); flushPops(); resetHistory(); __resetTimers(); CALLS = [];
  var HC = window.hkHAClient;
  var h = house({ 'light.c': ['on', { supported_color_modes: ['brightness'], brightness: 128, friendly_name: 'Lamp' }, 'c1'] });
  HA.hass = h;
  ok('a sheet opens from the current client', D.open('light.c', {}) === true);
  var d = _.state();
  ok('it was fed the client, never the host object', d.fed === HC.from(h) && d.fed !== h);
  ok('its panel reads through that client', d.panel.client === HC.from(h) && d.panel._stateObj === h.states['light.c']);
  // Phase 1 slice 6: its controls act through the client's action port, so
  // the panel is shown the client alone (no host input, no bridge)
  ok('its panel is shown the client alone, no host input', d.panel.hass == null && d.panel.client.actions === HC.from(h).actions);
  ok('the header icon was bound through the client (the adapter hands the icon its host)', d.icon.stateObj === h.states['light.c'] && d.icon.hass === h);
  var h2 = house({ 'light.c': ['on', { supported_color_modes: ['brightness'], brightness: 255, friendly_name: 'Lamp' }, 'c2'] });
  HA.hass = h2;
  polls();
  ok('the 250 ms look follows the host adapter\'s current client', d.fed === HC.from(h2) && d.panel.client === HC.from(h2) && d.panel._big.textContent === '100%',
     d.panel._big.textContent);
  var seen = d.fed, h3 = house({ 'light.c': ['off', { supported_color_modes: ['brightness'], friendly_name: 'Lamp' }, 'c3'] });
  var card = new (customElements.get('hk-detail-state'))();
  card.setConfig({ entity: 'sensor.none' });
  HA.hass = h3; card.hass = h3;
  ok('a new client on the hub reaches the open sheet at once (onClient)', d.fed === HC.from(h3) && d.fed !== seen);
  d.panel._svc('light', 'turn_off');
  ok('its controls act through the client\'s action port, reaching the same host', CALLS.join() === 'light.turn_off', CALLS);
  D.close(true); flushPops();

  // A CLIENT WITH NO HOST INPUT (a host that only reads): the sheet still
  // shows, read-only -- nothing to send a service call through
  CALLS = [];
  var states = { 'light.ro': { entity_id: 'light.ro', state: 'on', last_updated: 'r1', last_changed: 'r1',
    attributes: { supported_color_modes: ['brightness'], brightness: 64, friendly_name: 'Read Only' } } };
  var icons = 0;
  var ro = window.hkClient.create({ states: states, entities: {}, devices: {}, areas: {}, user: { is_admin: false },
    bindStateIcon: function (el, st) { icons++; el.stateObj = st; } });
  var cur0 = window.hkHostClient.current, hass0 = C.hass;
  window.hkHostClient.current = function () { return ro; };
  C.hass = function () { return null; };
  try {
    ok('a read-only client opens a sheet', D.open('light.ro', {}) === true);
    var r = _.state();
    ok('...whose panel reads the client and holds no host input', r.panel.client === ro && r.panel.hass == null &&
       r.panel._stateObj === states['light.ro']);
    ok('...with its icon bound by the client\'s own port', icons > 0 && r.icon.stateObj === states['light.ro'] && !r.icon.hass);
    r.panel._svc('light', 'turn_off');
    ok('...and its controls send nothing', CALLS.length === 0, CALLS);
    D.close(true); flushPops();
  } finally { window.hkHostClient.current = cur0; C.hass = hass0; }

  // the day's timeline is a REST read through the client (GET only)
  var asked = [];
  var rest = HC.from({ states: {}, callApi: function (m, path) { asked.push(m + ' ' + path.split('?')[0].split('/').slice(0, 2).join('/')); return Promise.resolve([[]]); } });
  _.dayRows(rest, 'binary_sensor.door');
  ok('the sheet\'s timeline asks the client for a GET of the recorder\'s history', asked.join() === 'GET history/period', asked);
})();

print('\n' + (fail ? 'FAIL ' + fail + ' DETAIL BEHAVIOUR TESTS' : 'ALL ' + pass + ' DETAIL BEHAVIOUR TESTS PASS'));
if (fail) throw new Error('detail behaviour tests failed');
