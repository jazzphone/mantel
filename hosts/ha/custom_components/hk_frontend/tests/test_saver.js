// hk-saver.js: HK Frontend's photo screensaver -- its rules (config, who gets
// it, edge zones, how a photo fits, the deck) and the switch contract the
// house's tablet scripts rely on.
var DIR = HK_ROOT + '/';
load(DIR + 'tests/dom.js');

var pass = 0, fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}

// the page: a lovelace panel whose config asks for a screensaver
location.pathname = '/dashboard-kitchen/0';
location.search = '';
// A small element for what hk-saver.js builds (its own element, the photo
// layers, the info box): classes, styles, attributes, simple queries.
function Fake(tag) {
  this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.parentNode = null;
  var cls = this._cls = {};
  this.classList = { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; },
                     contains: function (c) { return !!cls[c]; } };
  var st = this.style = { setProperty: function (k, v) { st[k] = v; }, getPropertyValue: function (k) { return st[k] || ''; } };
  this.offsetWidth = 1; this._l = {};
}
Fake.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
Fake.prototype.insertBefore = function (c, ref) {
  c.parentNode = this; var i = ref ? this.children.indexOf(ref) : -1;
  if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; };
Fake.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, width: 0, height: 0 }; };
Fake.prototype.remove = function () {
  var p = this.parentNode; if (p) p.children = p.children.filter(function (x) { return x !== this; }, this); this.parentNode = null; };
Fake.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Fake.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
Fake.prototype.hasAttribute = function (k) { return k in this.attrs; };
// Exercise photo handoffs with actual load/decode promises. Without Image,
// the harness silently failed every photo and never tested a successful fade.
Object.defineProperty(Fake.prototype, 'src', {
  get: function () { return this.attrs.src || ''; },
  set: function (url) {
    this.attrs.src = String(url); this.complete = true;
    this.naturalWidth = 1280; this.naturalHeight = 800;
    var im = this;
    Promise.resolve().then(function () { if (im.src === url && im.onload) im.onload(); });
  }
});
Fake.prototype.decode = function () { return Promise.resolve(); };
globalThis.Image = function () { return new Fake('img'); };
Fake.prototype.addEventListener = function (t, f) { (this._l[t] = this._l[t] || []).push(f); };
Fake.prototype.attachShadow = function () { this.shadowRoot = new Fake('#shadow'); return this.shadowRoot; };
Object.defineProperty(Fake.prototype, 'className', { get: function () { return Object.keys(this._cls).join(' '); },
  set: function (v) { var c = this._cls; Object.keys(c).forEach(function (k) { delete c[k]; });
    String(v).split(/\s+/).filter(Boolean).forEach(function (k) { c[k] = 1; }); } });
function matches(e, sel) {
  var m = /^([a-z-]*)(?:\.([a-z-]+))?$/i.exec(sel);
  return m && (!m[1] || e.tagName === m[1].toUpperCase()) && (!m[2] || e.classList.contains(m[2]));
}
Fake.prototype.querySelectorAll = function (sel) {
  var out = [];
  (function w(n) { n.children.forEach(function (c) { if (matches(c, sel)) out.push(c); w(c); }); })(this);
  return out;
};
Fake.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
var __create = document.createElement;
document.createElement = function (t) {
  return /^(hk-screensaver|div|img|canvas|style|body)$/i.test(t) ? new Fake(t) : __create.call(document, t);
};
document.body = document.createElement('body');
if (!customElements.whenDefined) customElements.whenDefined = function () { return new Promise(function () {}); };
function walkFake(n, out) { out = out || []; (n.children || []).forEach(function (c) { out.push(c); walkFake(c, out); }); return out; }
var SW = 'input_boolean.wallpanel_screensaver_kitchen';
var calls = [];
var LOVELACE = { config: { views: [], hk_screensaver: {
  user: 'Kitchen Tablet', entity: SW, photos: 'media-source://media_source/local/photos',
  starts_after: 180, each_photo: 30, order: 'random', fill: true, zoom: false,
  cards: [{ type: 'custom:hk-clock-card' }] } } };
var lovelacePanel = { lovelace: LOVELACE };
var mainEl = { shadowRoot: { querySelector: function (s) { return s === 'ha-panel-lovelace' ? lovelacePanel : null; } } };
var visibilityStyle = { value: 'visible', priority: 'important',
  getPropertyValue: function () { return this.value; }, getPropertyPriority: function () { return this.priority; },
  setProperty: function (k, v, p) { this.value = v; this.priority = p || ''; },
  removeProperty: function () { this.value = ''; this.priority = ''; } };
var haRoot = { style: visibilityStyle, shadowRoot: { querySelector: function (s) { return s === 'home-assistant-main' ? mainEl : null; } } };
function hassWith(state, userName) {
  var st = {}; st[SW] = { entity_id: SW, state: state, attributes: {} };
  return { states: st, user: { name: userName || 'Kitchen Tablet' },
    callService: function (d, s, data) { calls.push(d + '.' + s + ' ' + data.entity_id); },
    callWS: function () { return Promise.resolve({ children: [] }); } };
}
haRoot.hass = hassWith('off');
document.querySelector = function (s) { return s === 'home-assistant' ? haRoot : null; };
document.hidden = false;
window.innerWidth = 1280;
// the client hub hk-base provides (hkCards.client/onClient), over the real HA
// adapter; the saver's own actions go through that client's action port (no
// host input is offered at all)
var hub = [];
window.hkCards = { onClient: function (fn) { hub.push(fn); return function () { hub = hub.filter(function (f) { return f !== fn; }); }; },
                   client: function () { return window.hkHAClient.from(haRoot.hass); } };
function push(h) { haRoot.hass = h; var c = window.hkHAClient.from(h); hub.slice().forEach(function (f) { f(c); }); }

load(DIR + 'frontend/modules/hk-saver.js');
var S = window.hkSaver, U = S._;
// THE RESUME CLOCK held still: no stop here comes after a frozen page,
// except where a test says so (the section on waking from one)
var T0 = 1e12; U.clock.now = function () { return T0; }; U.beat();
// THE BLACK OVER THE PHOTOS (goDark's dark path) is what most of the kiosk
// tests below exercise; the house's tablets now take the screensaver down
// under the black instead (tested on its own, further down)
U.darkUnderBlack(true);
// a stop's fade back runs after the dashboard is drawn (frames, then a hold):
// every timer twice, then what those set going, a few steps deep (two
// frames, the hold, then the fade's own timers) -- a pass runs only the
// timers there when it starts, and running every kept one again each step
// multiplies them (minutes)
function woke() {
  __runTimers();
  var from = __timers.length, list;
  __runTimers();
  for (var i = 0; i < 2; i++) {
    list = __timers.slice(from); from = __timers.length;
    list.filter(Boolean).forEach(function (t) { t.fn(); });
  }
}

print('=== config ===');
var c = U.readCfg({ user: 'T', entity: SW, starts_after: 0, each_photo: 20, order: 'sorted', fill: false, zoom: true,
                    cards: [{ type: 'custom:hk-clock-card' }, { type: 'custom:not-ours' }, { type: 'entities' }, null] });
ok('0 means only the switch starts it', c.starts_after === 0);
ok('options read as given', c.each_photo === 20 && c.order === 'sorted' && c.fill === false && c.zoom === true);
ok('only HK cards are drawn over the photos', c.cards.length === 1 && c.cards[0].type === 'custom:hk-clock-card', c.cards);
var d = U.readCfg({});
ok('defaults: 180 s, 30 s, random, filled, no zoom, the house photos',
   d.starts_after === 180 && d.each_photo === 30 && d.order === 'random' && d.fill && !d.zoom &&
   d.photos === 'media-source://media_source/local/photos' && d.entity === null);
ok('HK Frontend\'s own switch or the old input_boolean', U.readCfg({ entity: 'switch.kitchen_photo_screensaver' }).entity === 'switch.kitchen_photo_screensaver' &&
   U.readCfg({ entity: 'input_boolean.x' }).entity === 'input_boolean.x');
ok('...anything else is ignored', U.readCfg({ entity: 'light.x' }).entity === null);
ok('the calendar pane: off, two days, by default', d.calendar === false && d.calendar_days === 2);
ok('...on, with the days asked for (1 to 7)', U.readCfg({ calendar: true, calendar_days: 5 }).calendar === true &&
   U.readCfg({ calendar_days: 5 }).calendar_days === 5 && U.readCfg({ calendar_days: 30 }).calendar_days === 2);
ok('Fade Back: half a second by default; 0 (at once) to 5 s', d.fade_back === 500 && U.readCfg({ fade_back: 0 }).fade_back === 0 &&
   U.readCfg({ fade_back: 2000 }).fade_back === 2000 && U.readCfg({ fade_back: 9000 }).fade_back === 500 &&
   U.readCfg({ fade_back: 'x' }).fade_back === 500);
ok('nonsense timing falls back', U.readCfg({ starts_after: -5, each_photo: 'x' }).starts_after === 180 &&
   U.readCfg({ each_photo: 'x' }).each_photo === 30);
ok('no block, no screensaver', U.readCfg(null) === null && U.readCfg('x') === null);
// THE MUSIC: a slide, and the pane's
ok('the music: off by default, on only when asked', d.music_slide === false && d.music_pane === false &&
   U.readCfg({ music_slide: true, music_pane: true }).music_slide === true && U.readCfg({ music_pane: 'yes' }).music_pane === false);
ok('the pane is up for the calendar, the music, or both', !U.paneOf(d) && U.paneOf({ calendar: true }) && U.paneOf({ music_pane: true }) &&
   U.paneOf({ calendar: true, music_pane: true }) && !U.paneOf(null));
// THE SIDE PANE'S SCREENSAVER GROUP (2026-10-30, hk-sidepane.js): the pane
// reads the screen's side_pane_read; the older shape is drawn as it was
var SPX = function (saver, side, dash) {
  return { side: side || 'right', dashboard: dash || { show: 'off', sections: [] }, saver: saver };
};
var older = U.withPane({ calendar: false, music_pane: false }, SPX({ show: 'own', sections: [{ kind: 'calendar', days: 4 }, { kind: 'now_playing', when: 'active' }] }));
ok('the Side Pane: the calendar above, the music below -- the pane as it was', older.calendar === true && older.calendar_days === 4 &&
   older.music_pane === true && older.pane_list === null && older.pane_side === 'right');
var c2 = U.readCfg(older);
ok('...read so (and Pane Side right)', c2.calendar && c2.music_pane && c2.calendar_days === 4 && c2.pane_side === 'right' && c2.pane_list === null && U.paneOf(c2));
var own = U.withPane({ calendar: true, music_pane: true }, SPX({ show: 'own', sections: [{ kind: 'clock', size: 'tiny' }, { kind: 'calendar' }] }, 'left'));
ok('...any other sections: the Side Pane draws them, on its side; the older keys not read', own.calendar === false && own.music_pane === false &&
   JSON.stringify(own.pane_list) === '[{"kind":"clock","size":"tiny"},{"kind":"calendar"}]' && own.pane_side === 'left' && U.paneOf(U.readCfg(own)));
var same = U.withPane({}, SPX({ show: 'same', sections: [] }, 'right', { show: 'all', sections: [{ kind: 'now_playing', when: 'active' }] }));
ok('...Same as the Dashboard: Now Playing\'s old pane is the music in the pane', same.music_pane === true && same.calendar === false);
var off = U.withPane({ calendar: true }, SPX({ show: 'off', sections: [{ kind: 'clock' }] }));
ok('...Off: no pane at all', !U.paneOf(U.readCfg(off)));
var older2 = { calendar: true, music_pane: false };
ok('...no Side Pane in the settings (an older server): the screensaver\'s own keys, as before', U.withPane(older2, null) === older2);
ok('a slide among the photos: the forecast (Photos & Forecast)', U.slideOf({ show: 'both' }, false, '') === 'forecast' &&
   U.slideOf({ show: 'both' }, true, '') === 'forecast');
ok('...the music only while it plays', U.slideOf({ show: 'photos', music_slide: true }, true, '') === 'music' &&
   U.slideOf({ show: 'photos', music_slide: true }, false, 'music') === null);
ok('...both: they take turns', U.slideOf({ show: 'both', music_slide: true }, true, 'forecast') === 'music' &&
   U.slideOf({ show: 'both', music_slide: true }, true, 'music') === 'forecast' &&
   U.slideOf({ show: 'both', music_slide: true }, false, 'forecast') === 'forecast');
ok('...none asked for, none', U.slideOf({ show: 'photos' }, true, '') === null);
// HOME ENERGY (2026-10-14): a slide among the photos, taking its turn
ok('Home Energy: off by default; its keys checked', d.energy_slide === false && d.extra_music === false && d.extra_forecast === false &&
   d.extra_every === 5 && d.extra_for === 30 && d.energy_hide.length === 0 &&
   U.readCfg({ energy_slide: true }).energy_slide === true && U.readCfg({ energy_slide: 'yes' }).energy_slide === false &&
   U.readCfg({ extra_every: 0 }).extra_every === 5 && U.readCfg({ extra_every: 15 }).extra_every === 15 &&
   U.readCfg({ extra_for: 5 }).extra_for === 30 && U.readCfg({ extra_for: 120 }).extra_for === 120 &&
   JSON.stringify(U.readCfg({ energy_hide: ['cost', 3, 'yday'] }).energy_hide) === '["cost","yday"]' &&
   U.readCfg({ energy_hide: 'cost' }).energy_hide.length === 0);
var E3 = { show: 'both', music_slide: true, energy_slide: true };
ok('...the music, the forecast and Home Energy take turns, in that order', U.slideOf(E3, true, '', true) === 'music' &&
   U.slideOf(E3, true, 'music', true) === 'forecast' && U.slideOf(E3, true, 'forecast', true) === 'energy' &&
   U.slideOf(E3, true, 'energy', true) === 'music');
ok('...nothing playing: the forecast and Home Energy', U.slideOf(E3, false, 'forecast', true) === 'energy' &&
   U.slideOf(E3, false, 'energy', true) === 'forecast');
ok('...Home Energy without its numbers yet: skipped, not waited for', U.slideOf(E3, false, 'forecast', false) === 'forecast' &&
   U.slideOf({ show: 'photos', energy_slide: true }, false, '', false) === null);
ok('...Home Energy alone among the photos', U.slideOf({ show: 'photos', energy_slide: true }, false, 'energy', true) === 'energy');
// THE ADDITIONAL SCREENS over the forecast or the clock
ok('additional screens: only over the forecast or the clock', U.extrasOf({ show: 'photos', energy_slide: true, extra_music: true }).length === 0 &&
   U.extrasOf({ show: 'both', energy_slide: true }).length === 0 &&
   JSON.stringify(U.extrasOf({ show: 'forecast', energy_slide: true, extra_music: true, extra_forecast: true })) === '["music","energy"]');
ok('...the forecast only on Show: Clock, and not over the forecast\'s own sky',
   JSON.stringify(U.extrasOf({ show: 'clock', clock_bg: 'gradient', extra_forecast: true, extra_music: true, energy_slide: true })) === '["forecast","music","energy"]' &&
   U.extrasOf({ show: 'clock', clock_bg: 'forecast', extra_forecast: true }).length === 0 &&
   U.extrasOf({ show: 'clock', clock_bg: 'skyonly', extra_forecast: true }).length === 0);
ok('...the music not when it takes the screen anyway (Music First, the older music over the forecast)',
   U.extrasOf({ show: 'forecast', extra_music: true, music_first: true }).length === 0 &&
   U.extrasOf({ show: 'forecast', extra_music: true, music_slide: true }).length === 0);
// WEATHER (2026-10-14): among the photos, and over the clock -- not over the forecast
var W4 = { show: 'both', music_slide: true, weather_slide: true, energy_slide: true };
ok('Weather: off by default; checked', d.weather_slide === false && d.weather_hide.length === 0 &&
   U.readCfg({ weather_slide: true }).weather_slide === true && U.readCfg({ weather_slide: 1 }).weather_slide === false &&
   JSON.stringify(U.readCfg({ weather_hide: ['wind', 7] }).weather_hide) === '["wind"]');
ok('...the music, the forecast, the weather and Home Energy take turns, in that order',
   U.slideOf(W4, true, '', true, true) === 'music' && U.slideOf(W4, true, 'music', true, true) === 'forecast' &&
   U.slideOf(W4, true, 'forecast', true, true) === 'weather' && U.slideOf(W4, true, 'weather', true, true) === 'energy' &&
   U.slideOf(W4, true, 'energy', true, true) === 'music');
ok('...the weather without a reading yet: skipped', U.slideOf(W4, false, 'forecast', true, false) === 'energy');
ok('...an additional screen over the clock, not over the forecast',
   JSON.stringify(U.extrasOf({ show: 'clock', clock_bg: 'gradient', extra_forecast: true, weather_slide: true, energy_slide: true })) === '["forecast","weather","energy"]' &&
   JSON.stringify(U.extrasOf({ show: 'forecast', weather_slide: true, energy_slide: true })) === '["energy"]');
ok('...they take turns, round and round', U.turnOf(['forecast', 'music', 'energy'], ['forecast', 'energy'], '') === 'forecast' &&
   U.turnOf(['forecast', 'music', 'energy'], ['forecast', 'energy'], 'forecast') === 'energy' &&
   U.turnOf(['forecast', 'music', 'energy'], ['forecast', 'energy'], 'energy') === 'forecast' &&
   U.turnOf(['forecast', 'music', 'energy'], [], 'energy') === null);
ok('Music First: off by default, on only when asked', d.music_first === false && U.readCfg({ music_first: true }).music_first === true &&
   U.readCfg({ music_first: 1 }).music_first === false);
ok('song times read as m:ss', U.mmss(0) === '0:00' && U.mmss(65.7) === '1:05' && U.mmss(3725) === '1:02:05' && U.mmss(-3) === '0:00');

print('\n=== who gets it ===');
var cfg = U.readCfg({ user: 'Kitchen Tablet' });
ok('the tablet\'s own user', U.gate(cfg, 'Kitchen Tablet', ''));
ok('a desk (another user) never does', !U.gate(cfg, 'Desk User', ''));
ok('?hk_saver=off turns it off for the page', !U.gate(cfg, 'Kitchen Tablet', '?kiosk&hk_saver=off'));
ok('...and so does the tools\' old ?wp_enabled=false', !U.gate(cfg, 'Kitchen Tablet', '?kiosk&wp_enabled=false'));
ok('?hk_saver=force ignores the user (testing)', U.gate(cfg, 'Desk User', '?hk_saver=force'));
ok('no user configured: nobody', !U.gate(U.readCfg({}), 'Kitchen Tablet', ''));

print('\n=== edges and fit ===');
ok('left 15 % is previous', U.zoneOf(100, 1280) === 'previous');
ok('right 15 % is next', U.zoneOf(1200, 1280) === 'next');
ok('the middle dismisses', U.zoneOf(640, 1280) === null && U.zoneOf(200, 1280) === null);
var p = U.fitOf(1878, 2816, true);
ok('a portrait photo: whole, over a blurred copy', p.portrait && p.fit === 'contain' && p.backdrop);
var l = U.fitOf(2816, 1878, true);
ok('a landscape photo fills the screen, no copy needed', !l.portrait && l.fit === 'cover' && !l.backdrop);
var lw = U.fitOf(2816, 1878, false);
ok('Fill the Screen off: landscape whole too, over the copy', lw.fit === 'contain' && lw.backdrop);

// PORTRAIT AND LANDSCAPE PHOTOS, each their own (2026-10-13)
var pf = U.fitOf(1878, 2816, true, true);
ok('a portrait photo can fill the screen too, when asked', pf.portrait && pf.fit === 'cover' && !pf.backdrop);
ok('...and is whole otherwise, as always', U.fitOf(1878, 2816, true).fit === 'contain' && U.fitOf(1878, 2816, true, false).backdrop);
var c0 = U.readCfg({});
ok('defaults: a portrait whole, a landscape filling, both centered at 100%', !c0.portrait.fill && c0.landscape.fill &&
   c0.portrait.zoom === 100 && c0.portrait.x === 'center' && c0.landscape.y === 'center');
var cp = U.readCfg({ portrait_fill: true, portrait_zoom: 150, portrait_x: 'left', portrait_y: 'top', portrait_blur: 100, portrait_dim: 0, fill: false, landscape_y: 'nowhere', landscape_zoom: 900 });
ok('a portrait\u2019s own: fill, zoom, focus', cp.portrait.fill && cp.portrait.zoom === 150 && cp.portrait.x === 'left' && cp.portrait.y === 'top');
ok('...the landscape\u2019s Fill is the old fill; nonsense reads as the default', !cp.landscape.fill && cp.landscape.y === 'center' && cp.landscape.zoom === 100);
var lay = U.layoutOf(cp.portrait);
ok('the layout: focus Top Left, zoom 1.5 about it', lay.pos === '0% 0%' && lay.zoom === '1.5');
ok('...no dim, the heaviest blur', lay.dim === '1' && lay.small === 6);
ok('the blurred copy\u2019s size is its blur: 50% is the 24 px it always was', U.backdropSmall(50) === 24 && U.backdropSmall(0) === 96);
ok('...and the default dim is the 80% brightness it always had', U.layoutOf(c0.landscape).dim === '0.8');

// NIGHT MODE (2026-10-13)
var NC = U.readCfg({ clock_night: 'night', clock_night_from: '22:00', clock_night_to: '07:00' });
var at = function (h, m) { return new Date(2026, 9, 13, h, m); };
ok('Night Mode: at night, across midnight', U.nightNow(at(23, 30), NC) && U.nightNow(at(3, 0), NC) && U.nightNow(at(22, 0), NC));
ok('...and not by day, nor at its end', !U.nightNow(at(7, 0), NC) && !U.nightNow(at(15, 0), NC) && !U.nightNow(at(21, 59), NC));
ok('...a window inside one day', U.nightNow(at(14, 0), U.readCfg({ clock_night: 'night', clock_night_from: '13:00', clock_night_to: '15:00' })) &&
   !U.nightNow(at(16, 0), U.readCfg({ clock_night: 'night', clock_night_from: '13:00', clock_night_to: '15:00' })));
ok('...Always and Off', U.nightNow(at(12, 0), U.readCfg({ clock_night: 'always' })) && !U.nightNow(at(23, 0), U.readCfg({})));
// THE MOSAIC (2026-10-13)
[2, 3, 4, 5].forEach(function (n) {
  U.MOSAICS[n].forEach(function (L, li) {
    var area = L.reduce(function (a, c) { return a + c[2] * c[3]; }, 0);
    ok('mosaic ' + n + '.' + li + ': ' + n + ' cells filling the screen', L.length === n && Math.abs(area - 1) < 1e-9, [L.length, area]);
    ok('...none of them wider than 3.3:1 or taller than 1:2.4 on a 16:10 screen', L.every(function (c) { var r = (c[2] * 1600) / (c[3] * 1000); return r <= 3.3 && r >= 1 / 2.4; }));
  });
});
var seq = [0.1, 0.1], ri = 0, rnd = function () { return seq[ri++ % seq.length]; };
var a1 = U.mosaicPlan(3, 1600, 1000, rnd, -1), a2 = U.mosaicPlan(3, 1600, 1000, rnd, a1.idx);
ok('never the same layout twice running', a1.idx !== a2.idx, [a1.idx, a2.idx]);
var plan = { cells: [{ x: 0, y: 0, w: 0.6, h: 1, tall: false }, { x: 0.6, y: 0, w: 0.4, h: 0.5, tall: false }, { x: 0.6, y: 0.5, w: 0.4, h: 0.5, tall: false }] };
var tall3 = U.mosaicPlan(3, 1600, 1000, function () { return 0.6; }, -1);   // three columns: every cell tall
ok('three columns are tall cells', tall3.cells.every(function (c) { return c.tall; }));
var big = { cells: [{ x: 0, y: 0, w: 0.25, h: 1, tall: true }, { x: 0.25, y: 0, w: 0.75, h: 1, tall: false }] };
var as = U.mosaicAssign(big.cells, [false, true], 1600, 1000);
ok('the portrait goes in the tall cell, the landscape in the wide one', as[0] === 1 && as[1] === 0, as);
var as2 = U.mosaicAssign(tall3.cells, [false, false, false], 1600, 1000);
ok('...with no portraits, every cell still gets a photo, each once', as2.slice().sort().join() === '0,1,2', as2);
var cr = U.coverRect(4000, 3000, 400, 800, 0.5, 0, 1);
ok('a crop covers the cell: a landscape photo in a tall cell keeps its full height', Math.abs(cr.sh - 3000) < 1e-6 && Math.abs(cr.sw - 1500) < 1e-6 && Math.abs(cr.sx - 1250) < 1e-6, cr);
var cz = U.coverRect(3000, 4000, 800, 400, 0.5, 0, 2);
ok('...Focus Top, Zoom 200%: from the very top, half as much', cz.sy === 0 && Math.abs(cz.sw - 1500) < 1e-6, cz);
var c0 = U.readCfg({ photo_layout: 'mosaic', mosaic_count: 9, mosaic_gap: 'wide' });
ok('mosaic options read defensively', c0.mosaic && c0.mosaic_count === 3 && c0.mosaic_gap === 'thin' && c0.mosaic_change === 'one');
ok('images only', U.isImage({ media_class: 'image' }) && U.isImage({ media_content_type: 'image/jpeg' }) &&
   !U.isImage({ media_class: 'video', media_content_type: 'video/mp4' }) && !U.isImage(null));

print('\n=== the deck ===');
var items = []; for (var i = 0; i < 10; i++) items.push({ id: 'p' + i });
var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
var deck = new U.Deck('random', rnd); deck.set(items);
var seen = {}, dup = false, first = [];
for (i = 0; i < 10; i++) { var it = deck.next(); if (seen[it.id]) dup = true; seen[it.id] = 1; first.push(it.id); }
ok('random: every photo once before any repeats', !dup && Object.keys(seen).length === 10);
var lastOfRound = first[9], nextRound = deck.next();
ok('...and the next round never opens on the photo the last ended with', nextRound.id !== lastOfRound);
var sorted = new U.Deck('sorted'); sorted.set([{ id: 'b' }, { id: 'a' }, { id: 'c' }]);
ok('sorted: in order, round and round', [sorted.next(), sorted.next(), sorted.next(), sorted.next()]
   .map(function (x) { return x.id; }).join('') === 'abca');
var back = new U.Deck('sorted'); back.set([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
back.next(); back.next(); back.next();
ok('previous walks back through what was shown', back.previous().id === 'b' && back.previous().id === 'a');
ok('...and next steps forward again before drawing new ones', back.next().id === 'b' && back.next().id === 'c' && back.next().id === 'a');
ok('an empty folder shows nothing', new U.Deck('random').next() === null);
var same = new U.Deck('sorted'); same.set(items); same.next(); same.next(); same.set(items.slice());
ok('re-listing the same photos keeps the place in the round', same.next().id === 'p2');

print('\n=== the switch ===');
__runTimers();                                         // the module's first look at the page
push(hassWith('off'));
ok('the dashboard asks and this is the tablet: allowed, not running', S.stats().allowed && !S.running(), S.stats());
calls = [];
push(hassWith('on'));
ok('the house turning the switch ON starts it (the sleep script)', S.running() && S.stats().startedBy === 'switch');
ok('...and a start by the switch writes nothing back', calls.length === 0, calls);
ok('...a screensaver element is on the page', walkFake(document.body).some(function (e) { return e.tagName === 'HK-SCREENSAVER'; }));
ok('...the sky and the cards are told', window.__hkSaverEvents === undefined || true);
push(hassWith('off'));
ok('the house turning it OFF stops it (wake, the doorbell)', !S.running());
// NOT OVER LIVE TV (2026-10-21): hk-idle held (Live TV playing, a sheet
// open) -- the idle timer already waited; the switch turned on by an
// automation or the Sleep Screen now waits too
(function () {
  var idle0 = window.hkIdle;
  window.hkIdle = Object.assign({}, idle0 || {}, { held: function () { return ['live-tv']; } });
  push(hassWith('on'));
  ok('...but the switch ON does not start it over Live TV (hk-idle held)', !S.running(), S.stats());
  window.hkIdle = idle0;
  push(hassWith('on'));
  ok('...and it starts once the hold ends', S.running() && S.stats().startedBy === 'switch');
  push(hassWith('off'));
  ok('...(and stops again)', !S.running());
})();
(function () {
  // A HOST THAT ONLY READS (a client with no action transport): the
  // screensaver still runs from the client, and no switch write goes anywhere
  var client0 = window.hkCards.client, refused = 0;
  window.hkCards.client = function () {
    return window.hkClient.create({ states: haRoot.hass.states, user: haRoot.hass.user,
                                    refused: function () { refused++; } });
  };
  calls = [];
  S.start();
  ok('with no host input it still starts from the client, and writes no switch', S.running() && calls.length === 0 && refused === 1,
     { calls: calls, refused: refused });
  S.stop();
  window.hkCards.client = client0;
})();
calls = [];
S.start();
ok('a start by itself (hkSaver.start) turns the switch on', S.running() && calls.join() === 'input_boolean.turn_on ' + SW, calls);
push(hassWith('off'));
ok('...and its own write echoing back late does not stop it', S.running());
push(hassWith('on'));
calls = [];
// a touch in the middle of the screen
dispatchEvent({ type: 'pointerdown', clientX: 640, clientY: 400, pointerType: 'touch' });
ok('a touch in the middle stops it', !S.running());
ok('...turns the switch off', calls.join() === 'input_boolean.turn_off ' + SW, calls);
ok('...and swallows taps for a moment after', S.stats().blocking);
ok('each photo layer carries its own scrim for the forecast details (fades with its photo)',
   saverEl().shadowRoot.querySelectorAll('.ph').every(function (ph) { return !!ph.querySelector('.phscrim'); }));
var blockingHost = saverEl();
ok('wake retains visuals for the outgoing fade', !blockingHost.hasAttribute('released'));
ok('...and first stays over the dashboard, 99 % (waking), while it is drawn underneath',
   blockingHost.hasAttribute('waking') && blockingHost.style['--fade'] === '0ms', blockingHost.attrs);
ok('...the dashboard is shown again under it at once', visibilityStyle.value !== 'hidden');
__runTimersUnder(1); __runTimersUnder(1);
ok('...for two frames and more', blockingHost.hasAttribute('waking'));
__runTimersUnder(200);
ok('...then fades over Fade Back (500 ms)', !blockingHost.hasAttribute('on') && !blockingHost.hasAttribute('waking') &&
   blockingHost.style['--fade'] === '500ms', { attrs: blockingHost.attrs, fade: blockingHost.style['--fade'] });
__runTimersUnder(600);
ok('after the fade only the tap-catching host remains', saverEl() === blockingHost && blockingHost.hasAttribute('blocking') && blockingHost.hasAttribute('released') && blockingHost.shadowRoot.children.every(function (e) { return e.tagName === 'STYLE'; }), {attrs:blockingHost.attrs,children:blockingHost.shadowRoot.children.map(function(e){return e.tagName;}),same:saverEl()===blockingHost});
ok('releasing graphics preserves accidental-tap protection', S.stats().blocking && S.stats().cards === 0);
__runTimersUnder(600);
ok('...the finger still down: still swallowed (its lift and click would press what is under it)', S.stats().blocking);
dispatchEvent({ type: 'pointerup', pointerType: 'touch' }); T0 += 100; __runTimersUnder(2100);   // the fade over (its timer, 500 + FADE_LATE)
ok('...lifted, but the click a touch makes comes later: still swallowed', S.stats().blocking && saverEl() === blockingHost);
T0 += 400; __runTimersUnder(2100);
ok('...and a moment after, the dashboard takes taps again -- not 3 s of every tap ignored', !S.stats().blocking && saverEl() !== blockingHost);
push(hassWith('off'));
S.start();
var restartedHost = saverEl();
ok('restarting after visual cleanup builds fresh content', restartedHost !== blockingHost && !restartedHost.hasAttribute('released'));
__runTimersUnder(3200);
ok('the old stop timers cannot remove the restarted saver', S.running() && saverEl() === restartedHost && !restartedHost.hasAttribute('released'));
var shownBefore = S.stats().shown;
calls = [];
dispatchEvent({ type: 'pointerdown', clientX: 1250, clientY: 400, pointerType: 'touch' });
dispatchEvent({ type: 'touchstart', touches: [{ clientX: 1250 }] });
ok('a tap on the right edge keeps it on (next photo)', S.running() && calls.length === 0, calls);
S.stop();
ok('hkSaver.stop() takes it away without writing the switch', !S.running() && calls.length === 0, calls);
S.start(); S.stop(); S.start();
ok('started again while waking: covering again, not left at 99 %', S.running() && !saverEl().hasAttribute('waking'), saverEl().attrs);
drainMicrotasks(); drainMicrotasks(); drainMicrotasks();   // its first photo in: the fade may start
woke();
ok('...and the old wake\'s fade never takes it away', S.running() && saverEl().hasAttribute('on'), saverEl().attrs);
S.stop(); woke();

print('\n=== the cards over the photos keep their order, whenever they load ===');
(function () {
  var waits = {}, realGet = customElements.get, realWhen = customElements.whenDefined, realCreate = document.createElement;
  customElements.get = function (n) { return /^hk-(clock|weather-strip)-card$/.test(n) ? undefined : realGet.call(customElements, n); };
  customElements.whenDefined = function (n) { return new Promise(function (res) { waits[n] = res; }); };
  document.createElement = function (t) {
    if (/^hk-(clock|weather-strip)-card$/.test(t)) { var f = new Fake(t); f.setConfig = function () {}; return f; }
    return realCreate.call(document, t);
  };
  var c = S.config(), savedCards = c.cards;
  c.cards = [{ type: 'custom:hk-clock-card' }, { type: 'custom:hk-weather-strip-card' }];
  S.start();
  // hk-weather.js defines the weather strip first, then the clock
  waits['hk-weather-strip-card'](); waits['hk-clock-card']();
  drainMicrotasks(); drainMicrotasks();
  var info = saverEl().shadowRoot.querySelector('.info');
  var order = info.children.map(function (e) { return e.tagName; });
  ok('a page reloaded under the switch: the clock still above the weather', order.join() === 'HK-CLOCK-CARD,HK-WEATHER-STRIP-CARD', order);
  S.stop();
  c.cards = savedCards;
  customElements.get = realGet; customElements.whenDefined = realWhen; document.createElement = realCreate;
})();

print('\n=== a tap on the forecast details: the Weather page ===');
var pushed = [], navs = 0;
globalThis.history = { pushState: function (st, t, url) { pushed.push(url); location.pathname = url; } };
addEventListener('location-changed', function () { navs++; });
function withBand() {
  var r = saverEl().shadowRoot, box = r.querySelector('.fcband');
  if (!box) { box = new Fake('div'); box.className = 'fcband'; r.appendChild(box); }
  var el = new Fake('hk-weather-forecast-card');
  el.getBoundingClientRect = function () { return { left: 30, right: 1250, top: 500, bottom: 780, width: 1220, height: 280 }; };
  box.children = []; box.appendChild(el);
  saverEl().setAttribute('band', '');
}
var savedViews = lovelacePanel.lovelace.config.views;
lovelacePanel.lovelace.config.views = [{ path: '0' }, { path: 'weather' }];
var home = location.pathname;
S.start(); withBand(); pushed = []; navs = 0;
dispatchEvent({ type: 'pointerdown', clientX: 640, clientY: 600, pointerType: 'touch' });
ok('it wakes onto this dashboard\'s Weather page', !S.running() && pushed.join() === '/' + home.split('/')[1] + '/weather' && navs === 1, pushed);
location.pathname = home;
S.start(); withBand(); pushed = [];
dispatchEvent({ type: 'pointerdown', clientX: 1260, clientY: 600, pointerType: 'touch' });
ok('...on the edges too (the details run under them), not the next photo', !S.running() && pushed.length === 1, pushed);
location.pathname = home;
S.start(); withBand(); pushed = [];
dispatchEvent({ type: 'pointerdown', clientX: 640, clientY: 200, pointerType: 'touch' });
ok('a tap above them just closes it, where it was', !S.running() && pushed.length === 0, pushed);
S.start(); saverEl().removeAttribute('band'); pushed = [];
dispatchEvent({ type: 'pointerdown', clientX: 640, clientY: 600, pointerType: 'touch' });
ok('...as it does with no details showing', !S.running() && pushed.length === 0, pushed);
lovelacePanel.lovelace.config.views = [{ path: '0' }];
S.start(); withBand(); pushed = [];
dispatchEvent({ type: 'pointerdown', clientX: 640, clientY: 600, pointerType: 'touch' });
ok('a dashboard with no Weather page: it just closes', !S.running() && pushed.length === 0, pushed);
lovelacePanel.lovelace.config.views = savedViews;

print('\n=== HK Frontend\'s own switch, and touches ===');
var OWN = 'switch.kitchen_photo_screensaver', ws = [];
LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { entity: OWN });
lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
function hassOwn(state, userName) {
  var h = hassWith('off', userName); h.states[OWN] = { entity_id: OWN, state: state, attributes: {} };
  h.callWS = function (m) { ws.push(m); return Promise.resolve(m.type === 'media_source/browse_media' ? { children: [] } : {}); };
  return h;
}
location.pathname = '/dashboard-kitchen/0';
push(hassOwn('off')); __runTimers(); push(hassOwn('off'));
calls = [];
S.start();
ok('a start writes the screen\'s own switch (switch.turn_on)', calls.join() === 'switch.turn_on ' + OWN, calls);
push(hassOwn('on'));
S.stop();
calls = []; ws = [];
dispatchEvent({ type: 'pointerdown', clientX: 640, clientY: 400, pointerType: 'touch' });
dispatchEvent({ type: 'pointerdown', clientX: 640, clientY: 400, pointerType: 'touch' });
var touches = ws.filter(function (m) { return m.type === 'hk_frontend/screensaver/touch'; });
ok('a touch on the dashboard is reported, once per 10 s', touches.length === 1 && touches[0].dashboard === 'dashboard-kitchen', ws);
ws = []; location.search = '?hk_saver=force';
push(hassOwn('off', 'Desk User'));
dispatchEvent({ type: 'pointerdown', clientX: 640, clientY: 400, pointerType: 'touch' });
ok('...never from another user or a forced page', !ws.some(function (m) { return m.type === 'hk_frontend/screensaver/touch'; }), ws);
location.search = '';
push(hassOwn('off'));

print('\n=== a forced test page ===');
calls = []; location.search = '?hk_saver=force';
push(hassWith('off', 'Desk User'));
S.start();
ok('?hk_saver=force shows it for another user (testing)', S.running());
ok('...but never writes the house\'s switch', calls.length === 0, calls);
S.stop(); location.search = '';

print('\n=== a desk on the same dashboard ===');
calls = [];
push(hassWith('on', 'Desk User'));
__runTimers();
ok('another user: the switch turning on does NOT start it here', !S.running() && !S.stats().allowed);
S.start();
ok('...not even by hand', !S.running());
ok('...and it never writes the switch', calls.length === 0, calls);

print('\n=== the forecast (no photos, or chosen) ===');
var scenes = [], FULLY = { saver: false, on: true };
window.hkSky = { saverChanged: function () {}, scene: function (box) {
  var sc = { box: box, updates: 0, paused: null, destroyed: false,
             update: function () { this.updates++; }, pause: function (p) { this.paused = p; },
             destroy: function () { this.destroyed = true; }, landShown: function () { return 'land-fall-day.webp'; } };
  scenes.push(sc); return sc; } };
window.fully = { isInScreensaver: function () { return FULLY.saver; }, getScreenOn: function () { return FULLY.on; } };
function saverEl() { return walkFake(document.body).filter(function (e) { return e.tagName === 'HK-SCREENSAVER'; }).pop(); }
S.stop(); woke();
push(hassOwn('off'));
S.start();
drainMicrotasks(); drainMicrotasks();
ok('a folder with no photos: the forecast shows instead', S.stats().mode === 'forecast', S.stats());
ok('...over its own live sky (hkSky.scene), painted from the states', scenes.length === 1 && scenes[0].updates >= 1, scenes.length);
ok('...the element says so ([forecast]: no photo layers, band at the bottom)', saverEl() && 'forecast' in saverEl().attrs);
FULLY.saver = true; __runTimers();
ok('Fully\'s own (dark) screensaver: the sky holds still', scenes[0].paused === true, scenes[0].paused);
FULLY.saver = false; FULLY.on = false; __runTimers();
ok('...and with the screen off', scenes[0].paused === true);
FULLY.on = true; __runTimers();
ok('...and moves again when the screen is lit', scenes[0].paused === false, scenes[0].paused);
// KIOSK SATELLITE says so with window events (its API is promise-based)
T0 += 1000; U.beat(); dispatchEvent({ type: 'kiosksatellite:screensaverstart' }); __runTimers();
ok('Kiosk Satellite\'s own (Black) screensaver: the sky holds still', scenes[0].paused === true, scenes[0].paused);
dispatchEvent({ type: 'kiosksatellite:screensaverstop' }); __runTimers();
ok('...and moves again when it ends', scenes[0].paused === false, scenes[0].paused);
dispatchEvent({ type: 'kiosksatellite:screenoff' }); __runTimers();
ok('...holds still with its panel off', scenes[0].paused === true);
dispatchEvent({ type: 'kiosksatellite:screenon' }); __runTimers();
ok('...and moves when the panel is lit', scenes[0].paused === false);
dispatchEvent({ type: 'pointerdown', clientX: 1250, clientY: 400, pointerType: 'touch' });
ok('an edge tap on the forecast closes it (there is no next photo)', !S.running());
woke();
ok('...and the sky is let go', scenes[0].destroyed === true);

// Show: Forecast -- never even lists the photos
var withPhotos = { children: [{ title: 'a.jpg', media_class: 'image', media_content_type: 'image/jpeg', can_expand: false,
                                media_content_id: 'media-source://x/a.jpg' }] };
LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { show: 'forecast' });
lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
var hf = hassOwn('off');
hf.callWS = function (m) { ws.push(m); return Promise.resolve(m.type === 'media_source/browse_media' ? withPhotos :
  m.type === 'media_source/resolve_media' ? { url: 'photo-a.jpg' } : {}); };
push(hf); dispatchEvent({ type: 'location-changed' }); __runTimers();
ws = []; scenes = [];
ok('Show: Forecast is read from the config', S.config() && S.config().show === 'forecast', S.config());
S.start(); drainMicrotasks();
ok('Show: Forecast goes straight to the forecast', S.stats().mode === 'forecast' && scenes.length === 1, S.stats());
ok('...without listing the photos at all', !ws.some(function (m) { return m.type === 'media_source/browse_media'; }), ws);
S.stop(); woke();
ok('...and a restart after it starts clean (one sky, not two)', (S.start(), drainMicrotasks(), scenes.length === 2 && scenes[0].destroyed));
S.stop(); woke();
LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { show: 'photos' });
lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
push(hf); dispatchEvent({ type: 'location-changed' }); __runTimers(); scenes = [];
S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
ok('Show: Photos with photos in the folder: the photos, no forecast', S.stats().mode === 'photos' && scenes.length === 0, S.stats());
// STARTED AGAIN BEFORE THE STOP'S TEARDOWN: the host is reused with its last
// photo still on top; the new first photo must take over from it, not sit
// under it (or beside it, both opaque)
function topPhotos() { return saverEl().shadowRoot.querySelectorAll('.ph').filter(function (p) { return p.classList.contains('top'); }); }
var keptHost = saverEl(), lastShown = topPhotos()[0];
S.stop(); S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); __runTimersUnder(1);
ok('a restart within the stop\'s fade reuses the host, and only the new photo is on top', saverEl() === keptHost &&
   topPhotos().length === 1 && topPhotos()[0] !== lastShown && !lastShown.querySelector('img.fg').src, topPhotos().length);
S.stop(); woke();
// LANDSCAPES (1.8.1): Behind the Clock: Landscapes -- HK's own photos from
// /hk/landscapes/index.json, never the house's folder; a file that isn't a
// plain image name is skipped. (Few full timer runs here: every
// __runTimers() runs each kept timer again and about doubles them, and
// this block's three took the harness from ~8.6 to ~277 million, which
// GitHub's runner did not survive -- 1.8.1's first CI.)
var fetched = [];
var fetchWas = globalThis.fetch;
globalThis.fetch = function (u) { fetched.push(u); return Promise.resolve({ json: function () {
  return Promise.resolve({ photos: [{ file: '01.webp', title: 'A lake' }, { file: '../evil.js' }] }); } }); };
LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { show: 'clock', clock_bg: 'landscapes' });
lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
push(hf); dispatchEvent({ type: 'location-changed' }); __runTimersUnder(1000); scenes = []; ws = [];
ok('Landscapes is read', S.config().clock_bg === 'landscapes', S.config());
S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
ok('...its list from /hk/landscapes/index.json, not the photo folder', fetched[0] === '/hk/landscapes/index.json' &&
   !ws.some(function (m) { return /media_source/.test(m.type); }), { fetched: fetched, ws: ws });
ok('...one landscape (the bad name skipped), shown behind the clock', S.stats().photos === 1 &&
   topPhotos().length === 1 && topPhotos()[0].querySelector('img.fg').src === '/hk/landscapes/01.webp' && 'ckphotos' in saverEl().attrs, S.stats());
__runTimersUnder(3200);
dispatchEvent({ type: 'pointerdown', clientX: 1250, clientY: 400, pointerType: 'touch' });
ok('an edge tap on the clock over the Landscapes wakes it (no step to the next photo)', !S.running());
globalThis.fetch = fetchWas;
LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { show: 'photos', clock_bg: 'gradient' });
lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
// Photos & Forecast: the forecast as a slide every few photos
LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { show: 'both', forecast_every: 3, fallback: true });
lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
push(hf); dispatchEvent({ type: 'location-changed' }); __runTimers(); scenes = [];
ok('Photos & Forecast is read, with how often', S.config().show === 'both' && S.config().forecast_every === 3, S.config());
var covers = [];
function recordCover() { covers.push({ hidden: visibilityStyle.value === 'hidden', covered: S.covered() }); }
addEventListener('hk-saver-covered', recordCover);
var scrolled = [];
window.scrollTo = function (o) { scrolled.push(o); };
S.start(); S.stop(); __runTimersUnder(3200);
ok('dismissing during the entrance cancels the covered notification', covers.length === 0 && !S.covered());
ok('...and the page is not scrolled under somebody who is still looking', scrolled.length === 0, scrolled);
S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
ok('the entrance keeps cameras visible until fully covered', !S.covered() && covers.length === 0);
ok('...and the page keeps its scroll until then', scrolled.length === 0, scrolled);
ok('...it starts with the photos', S.stats().mode === 'photos' && !S.stats().forecastSlide && scenes.length === 0, S.stats());
U.slide.since(3); U.slide.schedule(); __runTimers();
ok('after forecast_every photos the forecast fades in as a slide', S.stats().forecastSlide === true && scenes.length === 1, S.stats());
ok('...over the photos ([fcslide]), its sky moving', 'fcslide' in saverEl().attrs && scenes[0].paused === false, scenes[0].paused);
ok('...WITH its forecast details (the band) -- they were missing from the slide', 'band' in saverEl().attrs && S.stats().band, saverEl().attrs);
ok('...and the count starts again', S.stats().sinceForecast === 0);
var photoRoot = saverEl().shadowRoot;
var forecastLayer = photoRoot.querySelector('.fc');
var outgoingPhoto = photoRoot.querySelectorAll('.ph').filter(function (p) { return p.classList.contains('top'); })[0];
ok('real photos have loaded in this test', S.stats().shown > 0 && outgoingPhoto.querySelector('img.fg').src === 'photo-a.jpg');
ok('photo to forecast keeps the outgoing photo opaque beneath the incoming forecast',
   outgoingPhoto.classList.contains('top') && outgoingPhoto.style.zIndex === '1' &&
   forecastLayer.classList.contains('top') && forecastLayer.style.zIndex === '2');
__runTimersUnder(3200);
ok('after the forecast fade, the old photo is released', !outgoingPhoto.classList.contains('top') && !outgoingPhoto.querySelector('img.fg').src);
ok('the fully covered dashboard releases its paint layers', visibilityStyle.value === 'hidden');
ok('camera teardown is notified only after the dashboard is hidden', covers.length === 1 && covers[0].hidden && covers[0].covered);
ok('...and the page goes back to its top then, unseen (the sleep script\'s javascript: scroll, retired)',
   scrolled.length === 1 && scrolled[0] && scrolled[0].top === 0, scrolled);
delete window.scrollTo;
removeEventListener('hk-saver-covered', recordCover);

dispatchEvent({ type: 'pointerdown', clientX: 1250, clientY: 400, pointerType: 'touch' });
// Keep the forecast visible while the photo loads, then fade the new
// photo above it instead of exposing an occluded photo underneath.
ok('an edge tap on the forecast slide keeps the forecast up while the next photo loads', S.stats().forecastSlide === true, S.stats());
drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
ok('...then goes on to the next photo, still on', S.running() && !S.stats().forecastSlide, S.stats());
ok('...and the band goes with it (not over the photos by default)', !('band' in saverEl().attrs), saverEl().attrs);
var incomingPhoto = photoRoot.querySelectorAll('.ph').filter(function (p) { return p.classList.contains('top'); })[0];
ok('forecast to photo keeps the forecast opaque until the photo has faded in above it',
   forecastLayer.classList.contains('top') && forecastLayer.style.zIndex === '1' && incomingPhoto.style.zIndex === '2');
__runTimersUnder(3200);
ok('the forecast is hidden only after the photo fade completes', !forecastLayer.classList.contains('top') && incomingPhoto.classList.contains('top'));
ok('the incoming photo is not erased by cleanup', incomingPhoto.querySelector('img.fg').src === 'photo-a.jpg');

__runTimersUnder(3200);
ok('...and the forecast\'s sky holds still until it comes back', scenes[0].paused === true, scenes[0].paused);
U.slide.show();
ok('it comes back on the same layer (one sky, built once)', S.stats().forecastSlide && scenes.length === 1 && !scenes[0].destroyed, scenes.length);
var photoWS = hf.callWS, failedBefore = S.stats().failed;
hf.callWS = function (m) { return m.type === 'media_source/resolve_media' ? Promise.reject(new Error('offline')) : photoWS(m); };
S.next(); drainMicrotasks();
ok('three failed photo loads leave the forecast and its details visible', S.stats().forecastSlide && S.stats().band && S.stats().failed === failedBefore + 3);
hf.callWS = photoWS;
S.stop();
ok('stopping restores the dashboard visibility and its previous priority immediately', visibilityStyle.value === 'visible' && visibilityStyle.priority === 'important');
ok('stopping clears the covered state', !S.covered());

woke();
ok('...and is let go with the screensaver', scenes[0].destroyed === true);

// THE FADE WAITS FOR THE FIRST PHOTO (2026-10-09): until it is decoded,
// painted and two frames drawn, the screensaver is only [prep] -- drawn,
// too faint to see -- so the tablet rasters it before anyone sees it; the
// host's black never shows through a photo not yet drawn
// (a clean slate of timers: by here the harness has ~147,000 kept ones, and
// running them all again multiplies them)
__timers.length = 0;
var hostLoad = hf.callWS, pending = [];
hf.callWS = function (m) { return m.type === 'media_source/resolve_media' ? new Promise(function (r) { pending.push(r); }) : hostLoad(m); };
S.start(); __runTimersUnder(1000); __runTimersUnder(1000);
ok('started, its first photo still loading: ready but not fading in', S.running() && saverEl().hasAttribute('prep') && !saverEl().hasAttribute('on'),
   saverEl().attrs);
hf.callWS = hostLoad;
pending.forEach(function (r) { r({ url: 'photo-late.jpg' }); }); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
__runTimersUnder(1); __runTimersUnder(1);
ok('...the photo in and two frames drawn: the fade starts', saverEl().hasAttribute('on') && !saverEl().hasAttribute('prep'), saverEl().attrs);
S.stop(); woke();
hf.callWS = function (m) { return m.type === 'media_source/resolve_media' ? new Promise(function () {}) : hostLoad(m); };
S.start(); __runTimersUnder(1600); __runTimersUnder(1); __runTimersUnder(1);
ok('a photo that never comes: it fades in anyway, by ENTRANCE_MAX', saverEl().hasAttribute('on') && !saverEl().hasAttribute('prep'), saverEl().attrs);
hf.callWS = hostLoad;
S.stop(); woke();
ok('stopped: nothing left getting ready', !saverEl() || !saverEl().hasAttribute('prep'));
// WOKEN FROM A FROZEN PAGE (Kiosk Satellite's Black screensaver stops the
// tablet drawing and running the page): the stop that arrives as it comes
// back shows no stale photo -- plain black, the dashboard drawn under it, then
// the fade back to it
S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); __runTimersUnder(1); __runTimersUnder(1);
ok('a normal stop (the page running all along) is the usual fade, no black', (function () { S.stop(); return !saverEl().hasAttribute('dark'); })());
woke(); __timers.length = 0;
S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); __runTimersUnder(1); __runTimersUnder(1);
T0 += 60000;                       // a minute frozen: no heartbeat
ok('the page frozen a minute: it knows it has just come back', U.justResumed());
S.stop();
ok('...so the stop is plain black over the dashboard at once (no stale photo), still covering it while it draws',
   saverEl().hasAttribute('dark') && saverEl().hasAttribute('on') && saverEl().hasAttribute('waking'), saverEl().attrs);
__runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(200);
ok('...then fades away to it', !saverEl().hasAttribute('on'), saverEl().attrs);
U.beat(); T0 += 1000; U.beat(); T0 += 1000; U.beat(); T0 += 1000; U.beat();
ok('the heartbeat steady again for 3 s: the page is no longer just back', !U.justResumed());
__runTimersUnder(1000);
// UNDER THE KIOSK'S BLACK, BLACK: the frame the tablet keeps (and shows as
// the black comes down) is plain black, never the photos
woke(); __timers.length = 0;
S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); __runTimersUnder(1); __runTimersUnder(1);
T0 += 1000; U.beat(); dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
ok('the kiosk\'s Black screensaver goes up: plain black at once, no fade', saverEl().hasAttribute('dark') && saverEl().hasAttribute('on') &&
   saverEl().style.getPropertyValue('--fade') === '0ms', saverEl().attrs);
ok('...the dashboard not hidden under it (it would be drawn again from nothing at the wake)', !S.covered());
dispatchEvent({ type: 'kiosksatellite:screensaverstop' });
S.stop();                            // the house's wake: photos off under the black
ok('...the wake: still black over the dashboard while it draws', saverEl().hasAttribute('dark') && saverEl().hasAttribute('waking') && !S.covered(),
   saverEl().attrs);
__runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(200);
ok('...then the fade from black to the dashboard (the photos never shown)', !saverEl().hasAttribute('on') && !saverEl().hasAttribute('undark'),
   saverEl().attrs);
woke(); __timers.length = 0;
// THE WAKE GOES ON FROM THE FRAME THE TABLET LAST DREW: under the kiosk's
// black the page runs but nothing is drawn (frames held here), and as it
// comes back the tablet shows that last frame first
var realRAF = globalThis.requestAnimationFrame, heldFrames = [];
function holdFrames() { globalThis.requestAnimationFrame = function (f) { heldFrames.push(f); return heldFrames.length; }; }
function drawAgain() { globalThis.requestAnimationFrame = realRAF; heldFrames.splice(0).forEach(function (f) { f(); }); }
function photosUp() { S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); __runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(1); }
// last drawn: black (the photos up, then the kiosk's black -- the sleep)
photosUp(); woke(); __timers.length = 0;
T0 += 1000; U.beat(); dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
__runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(1);     // the black drawn, and shown
holdFrames();
S.stop();                              // the house's wake: photos off under the black
__runTimersUnder(700); __runTimersUnder(700); __runTimersUnder(5000);
ok('last drawn black, stopped where nothing is drawn: plain black, no fade however long', saverEl().hasAttribute('dark') && saverEl().hasAttribute('on'),
   saverEl().attrs);
ok('...the dashboard hidden under the photos stays hidden while nothing is drawn', visibilityStyle.value === 'hidden', visibilityStyle);
dispatchEvent({ type: 'kiosksatellite:screensaverstop' });
drawAgain();
ok('...drawn again: the dashboard not shown yet -- the black is being drawn again first', visibilityStyle.value === 'hidden', visibilityStyle);
__runTimersUnder(1); __runTimersUnder(1);
ok('...two frames on: the dashboard shown, under the black', visibilityStyle.value !== 'hidden' && saverEl().hasAttribute('on') && saverEl().hasAttribute('dark'),
   visibilityStyle);
__runTimersUnder(1); __runTimersUnder(1);
ok('...still black over the dashboard while it draws (WAKE.lit)', saverEl().hasAttribute('on') && saverEl().hasAttribute('waking'), saverEl().attrs);
__runTimersUnder(401);
ok('...then the fade from black to the dashboard', !saverEl().hasAttribute('on'), saverEl().attrs);
woke(); __timers.length = 0;
// THE SCREENSAVER GOES WHEN ITS FADE HAS ENDED, not on a timer of the
// fade's length (a late-starting fade was cut short)
photosUp(); woke(); __timers.length = 0;
S.stop(); __runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(200); __runTimersUnder(600);
var fading = saverEl();
ok('the fade back under way past its length: the screensaver still there', fading && fading.parentNode && !fading.hasAttribute('on'), fading && fading.attrs);
(fading._l.transitionend || []).forEach(function (f) { f({ target: fading, propertyName: 'opacity' }); });
ok('...gone once the fade has ended', !saverEl());
woke(); __timers.length = 0;
// the black begun on a frame and never shown (the tablet stopped drawing
// mid-frame): not counted -- the wake goes on from the photos
photosUp(); woke(); __timers.length = 0;
holdFrames();
T0 += 1000; U.beat(); dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
heldFrames.shift()();
S.stop();
__runTimersUnder(700); __runTimersUnder(700);
ok('stopped under the black: nothing at all until it ends', saverEl().hasAttribute('dark') && saverEl().hasAttribute('on'), saverEl().attrs);
dispatchEvent({ type: 'kiosksatellite:screensaverstop' });
ok('the black begun on one frame only: still the photos as it comes back, no blink to black', !saverEl().hasAttribute('dark') && saverEl().hasAttribute('on'),
   saverEl().attrs);
drawAgain(); __runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(401);
ok('...then the fade', !saverEl().hasAttribute('on'), saverEl().attrs);
woke(); __timers.length = 0;
// last drawn: the photos (a page loaded under the black never heard it)
photosUp(); woke(); __timers.length = 0;
holdFrames();
S.stop();
__runTimersUnder(700); __runTimersUnder(700);
ok('last drawn the photos: no cut to black -- the photos it shows, then the fade', !saverEl().hasAttribute('dark') && saverEl().hasAttribute('on'),
   saverEl().attrs);
drawAgain(); __runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(1); __runTimersUnder(401);
ok('...the fade once it is drawn again', !saverEl().hasAttribute('on'), saverEl().attrs);
woke(); __timers.length = 0;
// THE DEFAULT ON THE TABLETS: under the kiosk's black the screensaver is
// taken down, whatever it was showing -- the dashboard, drawn there, is what
// the tablet wakes onto
U.darkUnderBlack(false);
photosUp(); T0 += 5000; U.beat();
dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
ok('photos up for a while, then the black: the screensaver taken down at once (the dashboard back under the black)',
   !S.running() && !saverEl(), saverEl() && saverEl().attrs);
ok('...the dashboard shown again, not left hidden', visibilityStyle.value !== 'hidden', visibilityStyle);
dispatchEvent({ type: 'kiosksatellite:screensaverstop' }); woke(); __timers.length = 0;
U.darkUnderBlack(true);
// NOTHING TURNS UNDER A BLACK (2026-10-29): kept up (dark) under the black,
// the photos' timer is not armed -- no next photo for a screen nobody sees --
// and arms again when the black ends
woke(); __timers.length = 0;
photosUp(); T0 += 5000; U.beat();
dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
(function () {
  var n0 = S.stats().shown;
  ok('kept up under the black: dark, still on', S.running() && saverEl().hasAttribute('dark'), saverEl() && saverEl().attrs);
  U.slide.schedule();                                  // asked for, as a photo ending would
  for (var i = 0; i < 4; i++) { __runTimers(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); }
  ok('...no photo is turned under the black', S.stats().shown === n0, [n0, S.stats().shown]);
  dispatchEvent({ type: 'kiosksatellite:screensaverstop' });
  for (var j = 0; j < 4; j++) { __runTimers(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); }
  ok('...and the black ending runs the photos again', S.stats().shown > n0, [n0, S.stats().shown]);
})();
woke(); __timers.length = 0;
// OUR OWN CURTAIN: black over the page while the kiosk's black is up, and
// away only once the page has drawn as it comes down
woke(); __timers.length = 0;
function curtainEl() { return walkFake(document.body).filter(function (e) { return e.attrs && 'data-hk-curtain' in e.attrs; })[0]; }
dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
ok('the kiosk\'s black goes up: our curtain over everything, opaque', curtainEl() && curtainEl().style.opacity === '1' &&
   curtainEl().style.zIndex === '2147483647' && curtainEl().style.position === 'fixed', curtainEl() && curtainEl().style);
holdFrames();
dispatchEvent({ type: 'kiosksatellite:screensaverstop' });
__runTimersUnder(1000);
ok('the black comes down, no frame drawn yet: the curtain stays', curtainEl() && curtainEl().style.opacity === '1');
drawAgain(); __runTimersUnder(1); __runTimersUnder(1);
ok('...two frames: still up for CURTAIN_HOLD', curtainEl() && curtainEl().style.opacity === '1');
__runTimersUnder(301);
ok('...then it fades away', curtainEl() && curtainEl().style.opacity === '0' && /opacity 450ms/.test(curtainEl().style.transition));
__runTimersUnder(600);
ok('...and is gone after the fade', !curtainEl());
holdFrames();
dispatchEvent({ type: 'kiosksatellite:screensaverstart' }); dispatchEvent({ type: 'kiosksatellite:screensaverstop' });
__runTimersUnder(2100);
ok('frames that never come: faded by CURTAIN_MAX all the same', !curtainEl() || curtainEl().style.opacity === '0');
drawAgain(); woke(); __timers.length = 0;

// BLACK SCREEN: HK FRONTEND -- the screen's black is this page's own: the
// curtain, the backlight down (Kiosk Satellite's page API), said to the
// house; off, the backlight comes back with the curtain's fade; a tap wakes
// it here. Only on the screen's tablet.
(function () {
  woke(); __timers.length = 0;
  var SEG = String(location.pathname).split('/')[1] || '', BLK = 'switch.kitchen_black_screen', boards = {};
  boards[SEG] = { black_screen: 'hk', black_switch: BLK };
  var savedHS = window.hkSettings;
  window.hkSettings = { get: function (p, f) { return p === 'boards' ? boards : f; }, onChange: function () {} };
  var lights = [], bright = 0.68;
  window.kioskSatellite = {
    getBrightness: function () { return Promise.resolve(bright); },
    setBrightness: function (v) { lights.push(v); bright = v; return Promise.resolve(true); }
  };
  var sent = [], said = [];
  addEventListener('hk-black', function (e) { said.push(e.detail && e.detail.on); });
  function hassBlack(state, brightness, userName) {
    var h = hassOwn('off', userName);
    h.states[BLK] = { entity_id: BLK, state: state, attributes: { brightness: brightness == null ? null : brightness } };
    h.callWS = function (m) { sent.push(m); return Promise.resolve({}); };
    return h;
  }
  function curtainEl() { return walkFake(document.body).filter(function (e) { return e.attrs && 'data-hk-curtain' in e.attrs; })[0]; }
  function settle() { for (var i = 0; i < 4; i++) { __runTimersUnder(1); drainMicrotasks(); } }

  push(hassBlack('on', 174, 'Someone at a desk')); settle();
  ok('another user showing the same screen: never black', !curtainEl() && lights.length === 0, lights);

  var saidBefore = said.length;
  push(hassBlack('on', 174)); settle();
  ok('the sky and the camera strip not told before the curtain has been drawn (two frames)', said.length === saidBefore, said);
  __runTimersUnder(60); settle();
  ok('the switch on, on the screen\'s tablet: the curtain up, catching taps', curtainEl() && curtainEl().style.opacity === '1' &&
     curtainEl().style.pointerEvents === 'auto', curtainEl() && curtainEl().style);
  ok('...the backlight down to its lowest once it is drawn (setBrightness(0))', lights[lights.length - 1] === 0, lights);
  ok('...the brightness before kept for the wake, and the house told it is black',
     localStorage.getItem('hk-black-bright') === '0.68' && localStorage.getItem('hk-black') === SEG &&
     sent.some(function (m) { return m.type === 'hk_frontend/screensaver/black' && m.black === true && m.dashboard === SEG; }), sent);
  ok('...the sky and the camera strip told to rest (hk-black, on)', said[said.length - 1] === true, said);

  // THE HOUSE RESTARTED UNDER THE BLACK (2026-10-21): the black comes again, unconfirmed, while this page is
  // already black -- it says so again (else the house falls back to the kiosk's own screensaver), and
  // touches nothing else
  var acks = function () { return sent.filter(function (m) { return m.type === 'hk_frontend/screensaver/black' && m.black === true; }).length; };
  var acked = acks(), lit0 = lights.length;
  var hu = hassBlack('on', 174); hu.states[BLK].attributes.confirmed = false;
  push(hu); settle(); T0 += 3100; push(hu); settle();
  ok('the black again, unconfirmed, while already black: the page says it is black again', acks() > acked, sent);
  ok('...and the backlight is not touched for it', lights.length === lit0, lights);
  var hc = hassBlack('on', 174); hc.states[BLK].attributes.confirmed = true;
  var acked2 = acks(); push(hc); settle(); T0 += 3100; push(hc); settle();
  ok('...once confirmed, it is not said again', acks() === acked2, sent);

  lights = []; push(hassBlack('off', 200)); settle();
  ok('the switch off: the curtain stays a moment (CURTAIN_HOLD_HK) ...', curtainEl() && curtainEl().style.opacity === '1');
  __runTimersUnder(61); settle();
  ok('...then fades', curtainEl() && curtainEl().style.opacity === '0', curtainEl() && curtainEl().style.opacity);
  __runTimersUnder(400); settle();
  ok('...with the backlight ramping up to the house\'s wake brightness (200 of 255)', lights.length >= 5 &&
     Math.abs(lights[lights.length - 1] - 200 / 255) < 0.01 && lights[0] < lights[lights.length - 1], lights);
  __runTimersUnder(600);
  ok('...and is gone; nothing kept for a reload', !curtainEl() && localStorage.getItem('hk-black') === null);
  ok('...the sky and the camera strip told it is over (hk-black, off)', said[said.length - 1] === false, said);

  // a tap wakes it here
  sent = []; lights = []; woke(); __timers.length = 0;
  var before = bright;
  push(hassBlack('on', null)); settle();
  var c = curtainEl();
  (c._l.pointerdown || []).forEach(function (f) { f({ type: 'pointerdown', preventDefault: function () {}, stopPropagation: function () {} }); });
  settle();
  ok('a tap on the curtain: awake at once, the house told (black: false)', sent.some(function (m) { return m.type === 'hk_frontend/screensaver/black' && m.black === false; }), sent);
  ok('...and touched (the screen in use)', sent.some(function (m) { return m.type === 'hk_frontend/screensaver/touch'; }), sent);
  push(hassBlack('on', null)); settle(); __runTimersUnder(61); settle();
  ok('...the switch still on for a moment (on its way off): it stays awake', curtainEl() && curtainEl().style.opacity === '0', curtainEl() && curtainEl().style.opacity);
  __runTimersUnder(400); settle();
  ok('...the backlight back to what it was before the black (no brightness from the house)', Math.abs(lights[lights.length - 1] - before) < 0.01, [before, lights]);
  push(hassBlack('off', null)); woke(); __timers.length = 0;

  // a page reloaded while black: hk-settings.js put up a cover; taken over
  T0 += 7000; U.beat();                      // past the tap's hold (HK_WOKE_HOLD)
  var cover = new Fake('div'); cover.id = 'hk-black-boot'; document.body.appendChild(cover);
  document.getElementById = function (id) { return walkFake(document.body).filter(function (e) { return e.id === id; })[0] || null; };
  push(hassBlack('on', 174)); settle();
  ok('reloaded while black: the boot cover gives way to the curtain', !document.getElementById('hk-black-boot') && curtainEl());
  push(hassBlack('off', 174)); settle(); __runTimersUnder(61); __runTimersUnder(600); woke(); __timers.length = 0;
  delete document.getElementById;

  // the house's fallback: Kiosk's black up as well -- HK's ending is not
  // the end; the backlight comes up as the kiosk's comes down
  push(hassBlack('on', 120)); settle();
  dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
  lights = []; push(hassBlack('off', 120)); settle(); __runTimersUnder(61); __runTimersUnder(600); settle();
  ok('HK\'s black off under the kiosk\'s: still black, the backlight left down', curtainEl() && curtainEl().style.opacity === '1' && lights.length === 0, lights);
  dispatchEvent({ type: 'kiosksatellite:screensaverstop' }); settle();
  __runTimersUnder(61); settle(); __runTimersUnder(400); settle();
  ok('...the kiosk\'s off too: the curtain fades and the backlight ramps to the house\'s 120', lights.length >= 5 &&
     Math.abs(lights[lights.length - 1] - 120 / 255) < 0.01, lights);
  __runTimersUnder(600); woke(); __timers.length = 0;

  // A RELOAD UNDER THE BLACK, its settings still arriving (the Loft,
  // 2026-10-09: the cover faded at once, the dashboard showed, the page went
  // black again -- and that black had no curtain)
  document.getElementById = function (id) { return walkFake(document.body).filter(function (e) { return e.id === id; })[0] || null; };
  var liveSettings = window.hkSettings, notYet = { get: function (p, f) { return p === 'boards' ? {} : f; }, live: false, onChange: function () {} };
  window.hkSettings = notYet;
  var cover2 = new Fake('div'); cover2.id = 'hk-black-boot'; document.body.appendChild(cover2);
  sent = []; lights = []; U.hkFresh();     // a page just loaded
  push(hassBlack('on', 174)); settle(); __runTimersUnder(600); settle();
  ok('reloaded under the black, the screen\'s settings not in yet: the cover stays, nothing decided',
     document.getElementById('hk-black-boot') === cover2 && !curtainEl() && sent.length === 0 && lights.length === 0,
     { cover: !!document.getElementById('hk-black-boot'), sent: sent, lights: lights });
  window.hkSettings = liveSettings;
  push(hassBlack('on', 174)); settle();
  var c2 = curtainEl();
  ok('...in: black -- the page\'s own curtain, the cover gone', c2 && c2 !== cover2 && !document.getElementById('hk-black-boot') &&
     c2.style.opacity === '1' && sent.some(function (m) { return m.type === 'hk_frontend/screensaver/black' && m.black === true; }));
  lights = []; push(hassBlack('off', 174)); settle(); __runTimersUnder(61); settle(); __runTimersUnder(400); settle();
  ok('...and the wake: faded, the backlight ramped to 174', curtainEl() && curtainEl().style.opacity === '0' &&
     lights.length >= 5 && Math.abs(lights[lights.length - 1] - 174 / 255) < 0.01, lights);
  __runTimersUnder(600); woke(); __timers.length = 0;

  // a reload whose black ended while it loaded: the cover is swapped for a
  // curtain that fades -- the cover itself is never the curtain (its id and
  // its 30 s backstop would take a later black's curtain away)
  T0 += 7000; U.beat();
  cover2 = new Fake('div'); cover2.id = 'hk-black-boot'; document.body.appendChild(cover2);
  window.hkSettings = notYet; push(hassBlack('off', 150)); settle();
  window.hkSettings = liveSettings; lights = [];
  U.hkFresh();                               // a page just loaded
  push(hassBlack('off', 150)); settle();
  var c3 = curtainEl();
  ok('reloaded, the black ended meanwhile: the cover swapped for a curtain', c3 && c3 !== cover2 && !document.getElementById('hk-black-boot'));
  __runTimersUnder(1); settle(); __runTimersUnder(400); settle();
  ok('...which fades, the backlight coming back to the house\'s 150 with it', lights.length >= 5 &&
     Math.abs(lights[lights.length - 1] - 150 / 255) < 0.01, lights);
  __runTimersUnder(600); settle();
  push(hassBlack('on', 150)); settle();
  ok('...a later black: its curtain up, and it stays (not taken for the cover)', curtainEl() && curtainEl().style.opacity === '1');
  push(hassBlack('off', 150)); settle(); __runTimersUnder(61); __runTimersUnder(600); woke(); __timers.length = 0;
  delete document.getElementById;

  boards[SEG].black_screen = 'kiosk'; sent = [];
  push(hassBlack('on', 174)); settle();
  ok('Black Screen: Kiosk Satellite -- the switch is not this page\'s to follow', !curtainEl() && sent.length === 0, sent);
  push(hassBlack('off', 174)); settle();
  delete window.kioskSatellite;
  if (savedHS) window.hkSettings = savedHS; else delete window.hkSettings;
  localStorage.removeItem('hk-black-bright');
  push(hf); woke(); __timers.length = 0;
})();

// BLACK WHILE IT WAS STILL STARTING (a real sleep: the photos on 0.1-0.2 s
// before the black): taken back, as if it had never begun
photosUp();
dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
ok('black within SHOWN_MIN of the photos showing: the start taken back -- the dashboard, as the tablet last showed it',
   !S.running() && !saverEl(), saverEl() && saverEl().attrs);
dispatchEvent({ type: 'kiosksatellite:screensaverstop' }); woke(); __timers.length = 0;
var heldPhoto = hf.callWS;
hf.callWS = function (m) { return m.type === 'media_source/resolve_media' ? new Promise(function () {}) : heldPhoto(m); };
S.start(); __runTimersUnder(1);
ok('(a start still getting ready, its photo not in yet)', S.running() && saverEl().hasAttribute('prep'));
T0 += 1000; U.beat(); dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
ok('...black: taken back too, however long it has been getting ready', !S.running() && !saverEl());
hf.callWS = heldPhoto;
dispatchEvent({ type: 'kiosksatellite:screensaverstop' }); woke(); __timers.length = 0;
// NOTHING STARTS UNDER THE BLACK (the house's sleep: the photos on and the
// black up together). Started and turned black there, the tablet still
// showed the dashboard it last drew -- and the wake blinked through black.
holdFrames();
T0 += 1000; U.beat(); dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
ok('the photos turned on under the black: not started -- nothing under it changes', !S.running() && (!saverEl() || !saverEl().hasAttribute('on')));
push(hassOwn('on'));
ok('...not by the switch either', !S.running());
dispatchEvent({ type: 'kiosksatellite:screensaverstop' });
push(hassOwn('on'));
ok('the black ends, the switch still on: not at once (the house turns them off within 2 s of a tap)', !S.running());
T0 += 3000; __runTimersUnder(2600);
ok('...but once LIT_GRACE is up and they are still wanted, they start', S.running());
drawAgain(); S.stop(); push(hassOwn('off')); woke(); __timers.length = 0;
push(hf);                              // back to the connection with photos
woke(); __timers.length = 0;
photosUp();
T0 += 1000; U.beat(); dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
dispatchEvent({ type: 'kiosksatellite:screensaverstop' });
__runTimersUnder(2400);
ok('a tap ends the black, the photos still wanted: black a moment longer (the house may yet stop it)', saverEl().hasAttribute('dark'), saverEl().attrs);
__runTimersUnder(2600);
ok('...then the photos drawn again under the black', saverEl().hasAttribute('undark') && saverEl().hasAttribute('dark'), saverEl().attrs);
__runTimersUnder(1); __runTimersUnder(1);
ok('...and the black fades off them', !saverEl().hasAttribute('dark') && !saverEl().hasAttribute('undark') && saverEl().hasAttribute('on') &&
   saverEl().style.getPropertyValue('--blk') === '600ms', saverEl().attrs);
S.stop(); woke(); __timers.length = 0;
T0 += 1000; U.beat(); dispatchEvent({ type: 'kiosksatellite:screensaverstart' });
ok('the kiosk\'s black over the dashboard: nothing to darken', !S.running());
dispatchEvent({ type: 'kiosksatellite:screensaverstop' });
ok('stopped: nothing left dark', !saverEl() || !saverEl().hasAttribute('dark'));


// FORECAST DETAILS: off on the forecast; on over the photos
LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { show: 'both', forecast_every: 3, band: false, band_photos: true });
lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
push(hf); dispatchEvent({ type: 'location-changed' }); __runTimers(); scenes = [];
ok('the details settings are read', S.config().band === false && S.config().band_photos === true, S.config());
S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
ok('Forecast Details over the photos: the band shows with the photos', S.stats().mode === 'photos' && 'band' in saverEl().attrs, saverEl().attrs);
U.slide.show();
ok('Forecast Details off on the forecast: the slide is the sky and the land alone', S.stats().forecastSlide && !('band' in saverEl().attrs), saverEl().attrs);
U.slide.hide();
ok('...and back over the photos, the band again', 'band' in saverEl().attrs);
S.stop(); woke();

// Forecast When There Are No Photos: off -- a dark screen, as before 1.3
LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { show: 'photos', fallback: false });
lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
push(hassOwn('off')); dispatchEvent({ type: 'location-changed' }); __runTimers(); scenes = [];
ok('the fallback setting is read', S.config() && S.config().fallback === false, S.config());
S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks();
ok('fallback off and no photos: no forecast, the screen stays dark', S.running() && S.stats().mode === 'photos' && scenes.length === 0, S.stats());
S.stop(); woke();

print('\n=== an existing dashboard: the block from its screen\'s HK settings ===');
var BOARD_B = { screensaver: true, tablet_user: 'Kitchen Tablet', screensaver_engine: 'hk',
                screensaver_options: { show: 'forecast' } }, asked = [];
window.hkSettings = { get: function (p, f) { return p === 'boards' ? { 'dashboard-kitchen': BOARD_B } : f; },
                      lovelacePanel: function () { return true; } };
window.hkStrategy = { saverBlock: function (h, b) {
  asked.push(b);
  return b.screensaver ? { user: b.tablet_user, entity: OWN, show: b.screensaver_options.show, cards: [] } : null; } };
lovelacePanel.lovelace = { config: { views: [] } };
// signed in as someone else: the config is read, the screensaver never starts
push(hassOwn('off', 'Desk')); dispatchEvent({ type: 'location-changed' }); __runTimers();
ok('no hk_screensaver in its config: the screen\'s settings make it', S.config() && S.config().user === 'Kitchen Tablet' &&
   S.config().show === 'forecast' && asked.length > 0 && asked[0] === BOARD_B, S.config());
var before = S.config();
dispatchEvent({ type: 'location-changed' }); __runTimers();
ok('...the same settings again: the same config kept (compared as written, not as a new object)', S.config() === before);
BOARD_B.screensaver_options = { show: 'both' };
dispatchEvent({ type: 'location-changed' }); __runTimers();
ok('...and a change to them is picked up', S.config() && S.config().show === 'both', S.config());
lovelacePanel.lovelace = { config: { views: [], hk_screensaver: Object.assign({}, LOVELACE.config.hk_screensaver, { user: 'YAML User' }) } };
dispatchEvent({ type: 'location-changed' }); __runTimers();
ok('its own YAML\'s hk_screensaver wins over its settings', S.config() && S.config().user === 'YAML User', S.config());
lovelacePanel.lovelace = { config: { views: [], wallpanel: { enabled: true } } };
dispatchEvent({ type: 'location-changed' }); __runTimers();
ok('...and so does a WallPanel block: no HK screensaver there', S.config() === null, S.config());
BOARD_B.screensaver = false;
lovelacePanel.lovelace = { config: { views: [] } };
dispatchEvent({ type: 'location-changed' }); __runTimers();
ok('Photo Screensaver off in its settings: none', S.config() === null, S.config());
// A PREVIEW ASKED FOR BEFORE THERE IS A CONFIG (the settings page's frame,
// its dashboard still loading) starts once the config arrives
BOARD_B.screensaver = true;
lovelacePanel.lovelace = {};
dispatchEvent({ type: 'location-changed' }); __runTimers();
S.preview(true); __runTimers();
var early = S.running();
lovelacePanel.lovelace = { config: { views: [] } };
dispatchEvent({ type: 'location-changed' }); __runTimers(); __runTimers(); drainMicrotasks(); drainMicrotasks();
ok('a preview asked for before the config: nothing yet, then it starts once the config is there', !early && S.running() &&
   S.stats().startedBy === 'preview', [early, S.stats()]);
S.preview(false); __runTimers();
ok('...and stops with the preview', !S.running());
delete window.hkSettings; delete window.hkStrategy;

print('\n=== a host with no Lovelace (Mantel): the config from the shell ===');
(function () {
  var SH = window.hkShell, P = SH.panel, D = SH.dashboardConfig;
  var block = Object.assign({}, LOVELACE.config.hk_screensaver, { entity: OWN }), shellCfg = { views: [], hk_screensaver: block };
  var saved = lovelacePanel.lovelace;
  lovelacePanel.lovelace = undefined;
  SH.panel = function () { return document.body; };
  SH.dashboardConfig = function () { return shellCfg; };
  location.pathname = '/dashboard-kitchen/0'; location.search = '';
  push(hassOwn('off')); dispatchEvent({ type: 'location-changed' }); __runTimers();
  ok('the panel has no lovelace: the shell\'s config is read', S.config() && S.config().entity === OWN, S.config());
  ws = []; U.touchFresh();
  dispatchEvent({ type: 'pointerdown', clientX: 640, clientY: 400, pointerType: 'touch' });
  ok('...and a touch on the dashboard is told', ws.some(function (m) { return m.type === 'hk_frontend/screensaver/touch'; }), ws);
  // the strategy ran before the tablet's switch was there: the block names none; the settings make it again
  var BOARD_M = { screensaver: true, tablet_user: 'Kitchen Tablet', screensaver_engine: 'hk' }, made = 0;
  window.hkSettings = { get: function (p, f) { return p === 'boards' ? { 'dashboard-kitchen': BOARD_M } : f; },
                        lovelacePanel: function () { return true; } };
  window.hkStrategy = { saverBlock: function (h, b) { made++; return Object.assign({}, block, { entity: OWN, user: b.tablet_user }); } };
  shellCfg = { views: [], hk_screensaver: Object.assign({}, block, { entity: null }) };
  push(hassOwn('off')); dispatchEvent({ type: 'location-changed' }); __runTimers();
  ok('...a block made with no switch: the settings make it again, with the switch', made > 0 && S.config() && S.config().entity === OWN, S.config());
  // in Home Assistant the panel's own config is the authority, as before
  SH.dashboardConfig = D; SH.panel = P;
  lovelacePanel.lovelace = { config: { views: [], hk_screensaver: Object.assign({}, block, { entity: null }) } };
  made = 0;
  push(hassOwn('off')); dispatchEvent({ type: 'location-changed' }); __runTimers();
  ok('...a Lovelace panel\'s block is read as written (never made again)', made === 0 && S.config() && S.config().entity === null, S.config());
  lovelacePanel.lovelace = saved;
  delete window.hkSettings; delete window.hkStrategy;
  push(hassOwn('off')); dispatchEvent({ type: 'location-changed' }); __runTimers();
})();


print('\n=== a host with photos of its own: photoSource and listPhotos ===');
(function () {
  var SH = window.hkShell, PS = SH.photoSource, LP = SH.listPhotos;
  ok('this host has no photos of its own (both null)', SH.photoSource('media-source://x') === null && SH.listPhotos('media-source://x') === null);
  var asked = [], resolved = [];
  SH.photoSource = function () { return 'host-album://one'; };
  SH.listPhotos = function (src) {
    asked.push(src);
    return src === 'host-album://one' ? Promise.resolve([{ id: 'p1', title: 'One', url: '/photos/p1.jpg' }, { id: 'p2', url: '/photos/p2.jpg' }, { id: 'bad' }]) : null;
  };
  LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { show: 'photos' });
  lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
  var hp = hassOwn('off');
  hp.callWS = function (m) { ws.push(m); if (m.type === 'media_source/resolve_media') resolved.push(m); return Promise.resolve({ children: [] }); };
  ws = [];
  push(hp); S.photosChanged(); dispatchEvent({ type: 'location-changed' }); __runTimers();
  ok('the host\'s album for this screen is its source', S.config() && S.config().photos === 'host-album://one', S.config());
  S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); __runTimersUnder(1);
  ok('...listed by the host, never walked as a media folder', asked.indexOf('host-album://one') >= 0 &&
     !ws.some(function (m) { return m.type === 'media_source/browse_media'; }), [asked, ws]);
  ok('...its photos with an address (the one without skipped)', S.stats().photos === 2, S.stats());
  var shownImg = topPhotos()[0] && topPhotos()[0].querySelector('img.fg');
  // (stats().last is the photo's title, else its id; the deck is shuffled, so either photo may come first)
  ok('...shown from their own address, never resolved', /^(One|host\/p2)$/.test(S.stats().last || '') && shownImg &&
     /^\/photos\/p[12]\.jpg$/.test(shownImg.src) && resolved.length === 0, [S.stats().last, shownImg && shownImg.src, resolved]);
  S.stop(); woke();
  SH.photoSource = PS; SH.listPhotos = LP;
  S.photosChanged(); push(hassOwn('off')); dispatchEvent({ type: 'location-changed' }); __runTimers();
  ok('without it: the house\'s folder again', S.config() && S.config().photos === 'media-source://media_source/local/photos', S.config());
})();

// 2026-10-29: photos sized to the screen, and the decoded photo let go
print('\n=== a host that lists a photo in more than one size ===');
(function () {
  var I = window.hkSaver && window.hkSaver._ || null;
  if (!I || !I.photoUrl) { ok('photoUrl is exposed for tests', false); return; }
  var vs = I.cleanVariants({ variants: [[2560, '/p/screen'], [1280, '/p/mid'], ['x', '/bad'], [640], [900, ''], null] });
  ok('cleanVariants keeps the sound ones, smallest first', JSON.stringify(vs) === '[[1280,"/p/mid"],[2560,"/p/screen"]]', vs);
  ok('...none for an item without them', I.cleanVariants({}).length === 0 && I.cleanVariants(null).length === 0 && I.cleanVariants({ variants: 'x' }).length === 0);
  var it = { url: '/p/own', variants: vs };
  ok('a 1280 px tablet at ratio 1: the 1280 px copy', I.photoUrl(it, 1280, 1) === '/p/mid');
  ok('a 1024 px iPad at ratio 2: the 2560 px copy', I.photoUrl(it, 1024, 2) === '/p/screen');
  ok('a phone at ratio 3 (capped at 2): the 2560 px copy', I.photoUrl(it, 844, 3) === '/p/screen' && I.photoUrl(it, 844, 2) === '/p/screen');
  ok('a small window at ratio 1: the smallest copy', I.photoUrl(it, 800, 1) === '/p/mid');
  ok('a 4K screen: the largest there is', I.photoUrl(it, 3840, 2) === '/p/screen');
  ok('a little under the copy still takes it (a 1366 px laptop)', I.photoUrl(it, 1366, 1) === '/p/mid');
  ok('without variants: the item\'s own address', I.photoUrl({ url: '/p/own' }, 1280, 1) === '/p/own');
  // Keep in View is the same on a smaller copy: faces and the focus are fractions of a photo of the same shape
  var item = { faces: [[0.6, 0.2, 0.1, 0.15]] };
  var a = I.faceWindow(item, 2560, 1440, 1280, 800, 1), b = I.faceWindow(item, 1280, 720, 1280, 800, 1);
  ok('...the face window is the same at either size', a && b && Math.abs(a.fx - b.fx) < 1e-9 && Math.abs(a.fy - b.fy) < 1e-9, [a, b]);
  // the saver loads the copy closest to its screen
  var SH = window.hkShell, PS = SH.photoSource, LP = SH.listPhotos, W0 = window.innerWidth, H0 = window.innerHeight, R0 = window.devicePixelRatio;
  var made = [], RealImage = globalThis.Image;
  globalThis.Image = function () { var im = RealImage(); made.push(im); return im; };
  SH.photoSource = function () { return 'host-album://sized'; };
  SH.listPhotos = function (src) {
    return src === 'host-album://sized' ? Promise.resolve([{ id: 's1', title: 'Sized', url: '/photos/s1/screen', variants: [[1280, '/photos/s1/mid'], [2560, '/photos/s1/screen']] }]) : null;
  };
  LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { show: 'photos', zoom: false, mosaic: false });
  lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
  var hp = hassOwn('off');
  hp.callWS = function (m) { ws.push(m); return Promise.resolve({ children: [] }); };
  function shownWith(w, h, r) {
    window.innerWidth = w; window.innerHeight = h; window.devicePixelRatio = r;
    made = []; ws = [];
    push(hp); S.photosChanged(); dispatchEvent({ type: 'location-changed' }); __runTimers();
    S.start(); drainMicrotasks(); drainMicrotasks(); drainMicrotasks(); __runTimersUnder(1);
    var fg = topPhotos()[0] && topPhotos()[0].querySelector('img.fg');
    return { fg: fg && fg.src, loaded: made.length && made[0] };
  }
  var tab = shownWith(1280, 800, 1);
  ok('a wall tablet (1280 x 800): the layer shows the 1280 px copy', tab.fg === '/photos/s1/mid', tab.fg);
  ok('...and the Image that sized it let go once it was drawn', tab.loaded && !tab.loaded.attrs.src && tab.loaded.onload === null, tab.loaded && tab.loaded.attrs);
  S.stop(); woke();
  var pad = shownWith(1194, 834, 2);
  ok('an iPad at ratio 2: the 2560 px copy', pad.fg === '/photos/s1/screen', pad.fg);
  S.stop(); woke();
  // REDUCE MOTION (2026-10-29): Slow Zoom is the one motion a photo has; a device that asks for reduced motion gets
  // the still frame (the crossfade is a transition the same query switches off in CSS)
  LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { zoom: true });
  lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
  var realMM = globalThis.matchMedia, reduce = false;
  globalThis.matchMedia = function (q) { return { matches: /prefers-reduced-motion/.test(q) && reduce }; };
  ok('reducedMotion: not asked for', I.reducedMotion() === false);
  var zoomed = shownWith(1280, 800, 1) && topPhotos()[0];
  ok('Slow Zoom on, motion allowed: the photo zooms (and the host says so)', zoomed && zoomed.classList.contains('zoom') && saverEl().attrs.zoom !== undefined, zoomed && zoomed.className);
  S.stop(); __resetTimers();
  reduce = true;
  ok('reducedMotion: the device asks', I.reducedMotion() === true);
  var still = shownWith(1280, 800, 1) && topPhotos()[0];
  ok('...asked to reduce motion: the same photo does not zoom, and the host holds no layer for it',
     still && !still.classList.contains('zoom') && saverEl().attrs.zoom === undefined, still && still.className);
  ok('...the static frame stays', !!(still && still.querySelector('img.fg') && still.querySelector('img.fg').src));
  S.stop(); __resetTimers();
  reduce = false;
  globalThis.matchMedia = realMM;
  LOVELACE.config.hk_screensaver = Object.assign({}, LOVELACE.config.hk_screensaver, { zoom: false });
  lovelacePanel.lovelace = { config: { views: [], hk_screensaver: LOVELACE.config.hk_screensaver } };
  var rel = { img: new Fake('img'), w: 10, h: 10 }; rel.img.src = '/x.jpg';
  I.releasePh(rel);
  ok('releasePh drops the source and the reference, not the size', rel.img === null && rel.w === 10);
  I.releasePh(rel); I.releasePh(null);
  ok('...and is safe to call again, or with nothing', true);
  window.innerWidth = W0; window.innerHeight = H0; window.devicePixelRatio = R0;
  globalThis.Image = RealImage;
  SH.photoSource = PS; SH.listPhotos = LP;
  S.photosChanged(); push(hassOwn('off')); dispatchEvent({ type: 'location-changed' }); __runTimers();
})();

// 2026-10-13: the clock's text over photos, and the mosaic's line colors
(function () {
  var I = window.hkSaver && window.hkSaver._ || null;
  if (!I || !I.ckFx) { ok('the clock text effects are exposed for tests', false); return; }
  ok('no shadow, no outline: no filter', I.ckFx({ clock_text_shadow: 0, clock_text_outline: 0 }) === 'none');
  var f = I.ckFx({ clock_text_shadow: 40, clock_text_outline: 0 });
  ok('Shadow alone: one soft drop shadow', (f.match(/drop-shadow/g) || []).length === 1 && /rgba\(0,0,0,/.test(f));
  f = I.ckFx({ clock_text_shadow: 0, clock_text_outline: 100 });
  ok('Outline: four hard shadows, 3 px out', (f.match(/drop-shadow/g) || []).length === 4 && /3px 0px 0 /.test(f) && /-3px/.test(f));
  ok('the line colors', I.MOSAIC_COLORS.black === '#000000' && !!I.MOSAIC_COLORS.cream && Object.keys(I.MOSAIC_COLORS).length === 6);
})();
print('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' SAVER TESTS PASS');
if (fail) throw new Error(fail + ' failed');
