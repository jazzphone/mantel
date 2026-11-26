// @ts-check
// hk-hv-home.js -- AN APPLE HOMEVIEW'S HOUSE PAGES (docs/phase36/PLAN.md, 2026-11-26): Lights, Climate, Doors & Windows and Water,
// each drawn for the HomeView from the page the build made (hk-hv.js: the kit, the frame, harvest()).
//
//   hk-hv-climate-card   the thermostats (a big number, keys at the foot), the rooms' readings, fans and blinds
//   hk-hv-doors-card     what is open (how long), then the closed doors and windows, then the garage door
//   hk-hv-water-card     today's use, the main valve, the leak sensors, this week
//   hk-hv-lights-card    what's on first, as levels you drag; then every room (a tap opens its lights on the same frame);
//                        then the screen's scenes. All Off is the page's one action.
(function () {
  'use strict';
  if (window.hkHvHome) return;                     // double-load guard
  window.hkHvHome = { version: '1.0.0' };

  function whenKit(/** @type {(H: any) => void} */ fn) {
    if (window.hkHV && window.hkHV.ready) return fn(window.hkHV);
    window.addEventListener('hk-hv-ready', function () { fn(window.hkHV); }, { once: true });
    if (window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-hv.js');
  }

  whenKit(function (H) {
  if (window.hkHvHome.ready) return;
  window.hkHvHome.ready = true;
  var esc = H.esc;

  // the Wide levels first, then the Small tiles, each in its own order: two Wides to a row and the Smalls four to one, so the
  // grid has no holes and a room's lights stay together within each kind
  /** @param {any[]} xs */
  function H_levelsFirst(xs) { return xs.filter(function (x) { return x.lv; }).concat(xs.filter(function (x) { return !x.lv; })); }

  // ------------------------------------------------------------------ LIGHTS
  // ON NOW: every light that is on, a Wide level each (a switch drawn as a light, which has no level, a lit Small tile), in
  // the page's own order (its rooms, then each room's). ROOMS: one tile each, lit while any of its lights is; a tap opens
  // the room's lights. SCENES: the screen's own scenes (its Scenes row), run with a tap.
  class HvLights extends H.Page {
    /** @param {string} id */
    _item(id) {
      var t = this.h.byId[id], st = this.st(id), on = H.isOn(st), lv = H.levelNow(this, id, st);
      return { id: id, t: t, st: st, on: lv ? lv.pct > 0 : on, lv: lv };
    }
    /** @param {any} x @param {string} sub */
    _piece(x, sub) {
      var cfg = x.t.cfg, icon = H.iconOf(cfg, x.st), name = cfg.name || (x.st && x.st.attributes.friendly_name) || x.id;
      if (x.lv) {
        return H.level({ id: x.id, name: name, sub: sub, icon: icon, color: H.glyphColor(cfg, x.st, x.on), fill: H.fillOf(x.st), pct: x.lv.pct, lit: x.on,
                         word: x.on ? x.lv.pct + '%' : 'Off' });
      }
      return H.tile({ id: x.id, name: name, sub: x.on ? sub : 'Off', icon: icon, color: H.glyphColor(cfg, x.st, x.on), lit: x.on, gact: 'toggle' });
    }
    // the pieces in rows: the Wide ones two to a row, the Small ones filling the gaps (the grid packs them)
    /** @param {any[]} xs @param {(x: any) => string} sub */
    _grid(xs, sub) { return '<div class="grid">' + H_levelsFirst(xs).map(function (/** @type {any} */ x) { return this._piece(x, sub(x)); }, this).join('') + '</div>'; }
    draw() {
      var self = this, groups = this.h.groups.filter(function (/** @type {any} */ g) { return g.ids.length; });
      var rooms = groups.map(function (/** @type {any} */ g) { return { name: g.name || 'Lights', items: g.ids.map(function (/** @type {string} */ id) { return self._item(id); }) }; });
      var deep = this.deep();
      if (deep && deep.room != null) {
        var r = rooms.filter(function (x) { return x.name === deep.room; })[0];
        if (r) return this._room(r);
      }
      var on = [];
      rooms.forEach(function (r) { r.items.forEach(function (x) { if (x.on) on.push({ x: x, room: r.name }); }); });
      var litRooms = rooms.filter(function (r) { return r.items.some(function (x) { return x.on; }); }).length;
      var out = H.head({ title: (this._config || {}).title || 'Lights',
        sum: on.length ? '<b>' + on.length + ' On</b> · ' + litRooms + (litRooms === 1 ? ' room' : ' rooms') : 'All Off',
        right: on.length ? H.cap({ g: H.svg('power', 18), t: 'All Off', act: 'alloff' }) : '' });
      if (on.length) {
        out += '<div class="grid">' + H_levelsFirst(on.map(function (o) { return Object.assign({ room: o.room }, o.x); }))
          .map(function (/** @type {any} */ x) { return self._piece(x, x.room); }).join('') + '</div>';
      }
      if (rooms.length) {
        out += on.length ? H.section('Rooms') : '';
        out += '<div class="grid">' + rooms.map(function (r, i) {
          var n = r.items.filter(function (x) { return x.on; }).length;
          return H.tile({ id: '', name: r.name, sub: n ? n + ' On' : 'Off', icon: 'hk:lightbulb', color: n ? H.DEEP.yellow : 'var(--hk-ink-3, rgba(255,255,255,.42))',
                          lit: n > 0, act: 'room', data: { k: i } });
        }).join('') + '</div>';
      } else {
        out += '<div class="pl quiet">No lights on this screen. Add them in ' + H.esc(H.where('Accessories')) + '.</div>';
      }
      var scenes = ((this._config || {}).extra || {}).scenes || [];
      if (scenes.length) {
        out += H.section('Scenes');
        out += '<div class="grid">' + scenes.map(function (/** @type {string} */ id) {
          var st = self.st(id), a = (st && st.attributes) || {};
          return H.tile({ id: id, name: a.friendly_name || id, sub: 'Scene', icon: a.icon || 'hk:palette', color: H.hue('purple'), act: 'run' });
        }).join('') + '</div>';
      }
      this._rooms = rooms;
      return out;
    }
    /** @param {any} r */
    _room(r) {
      var n = r.items.filter(function (/** @type {any} */ x) { return x.on; }).length;
      this._rooms = this._rooms || [];
      return H.head({ title: r.name, back: true, sum: n ? '<b>' + n + ' On</b>' : 'All Off',
                      right: n ? H.cap({ g: H.svg('power', 18), t: 'All Off', act: 'alloff', data: { room: r.name } }) : '' }) +
        this._grid(r.items, function (/** @type {any} */ x) { return x.on ? 'On' : 'Off'; });
    }
    /** @param {string} act @param {any} el */
    act(act, el) {
      if (act === 'room') {
        var r = (this._rooms || [])[Number(el.getAttribute('data-k'))];
        if (r) this.deep({ room: r.name });
        return true;
      }
      if (act === 'alloff') {
        var room = el.getAttribute('data-room'), self = this, ids = [];
        (this._rooms || []).forEach(function (/** @type {any} */ r) {
          if (room && r.name !== room) return;
          r.items.forEach(function (/** @type {any} */ x) { if (x.on) ids.push(x.id); });
        });
        if (!ids.length) return true;
        var lights = ids.filter(function (id) { return id.indexOf('light.') === 0; }), rest = ids.filter(function (id) { return id.indexOf('light.') !== 0; });
        if (lights.length) self._call('light', 'turn_off', { entity_id: lights });
        if (rest.length) self._call('homeassistant', 'turn_off', { entity_id: rest });
        return true;
      }
      return false;
    }
  }
  H.register('hk-hv-lights-card', HvLights, 'HK HomeView Lights', 'The Lights page on an Apple HomeView: what is on, every room, the scenes.');

  // ------------------------------------------------------------------ SHARED BY THE PAGES BELOW
  var C = H.C, P = H.P, V = C.v;
  // a name that says only what the thing is ("Fan", "Blinds"): its room is the better name
  var GENERIC = /^(\w+ )?(fans?|blinds?|shades?|curtains?|shutters?|awnings?|humidifiers?)$/i;
  var COOL_FILL = '#cdeefa';
  /** @param {any} x */
  function num(x) { if (x == null || x === '') return null; var n = Number(x); return isFinite(n) ? n : null; }
  /** @param {any} st */
  function gone(st) { return !st || st.state === 'unavailable' || st.state === 'unknown'; }
  /** @param {any} card @param {string} id */
  function roomOf(card, id) {
    var c = card.client || {}, e = (c.entities || {})[id] || {}, d = (c.devices || {})[e.device_id] || {}, a = e.area_id || d.area_id;
    return (a && c.areas && c.areas[a] && c.areas[a].name) || '';
  }
  /** @param {any} t @param {any} st */
  function nameOf(t, st) { return (t.cfg && t.cfg.name) || (st && st.attributes && st.attributes.friendly_name) || t.id; }
  // a page's own timers (a held setting, the minute a "4 min" is read at), cleared when the page leaves
  /** @param {any} card @param {number} ms */
  function later(card, ms) {
    card._tm = card._tm || [];
    var t = setTimeout(function () {
      var i = card._tm.indexOf(t);
      if (i >= 0) card._tm.splice(i, 1);
      if (card.isConnected) card.redraw();
    }, Math.max(30, ms));
    card._tm.push(t);
  }
  // the page's one clock, for the words that say how long: drawn again at the next minute while `on`
  /** @param {any} card @param {boolean} on */
  function minuteClock(card, on) {
    if (!on) { if (card._mc) { clearTimeout(card._mc); card._mc = null; } return; }
    if (card._mc) return;
    card._mc = setTimeout(function () { card._mc = null; if (card.isConnected) card.redraw(); }, 60400 - (Date.now() % 60000));
  }
  // a number with its sign of degrees: whole, or a tenth where the step is finer than 1
  /** @param {number} x @param {number} step */
  function deg(x, step) { return (step < 1 && Math.round(x) !== x ? x.toFixed(1) : String(Math.round(x))) + '°'; }
  /** @param {number} x */
  function amount(x) { return x < 10 ? String(Math.round(x * 10) / 10) : Math.round(x).toLocaleString(); }
  /** @param {number} ms */
  function span(ms) {
    var m = Math.max(1, Math.floor(ms / 60000));
    if (m < 60) return m + ' min';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' hr';
    var d = Math.round(h / 24);
    return d + (d === 1 ? ' day' : ' days');
  }
  // the page base the three below share: nothing stays running when it goes
  class HvHome extends H.Page {
    disconnectedCallback() {
      super.disconnectedCallback();
      (this._tm || []).forEach(clearTimeout);
      this._tm = [];
      minuteClock(this, false);
      Object.keys(this._sendT || {}).forEach(function (/** @type {string} */ k) { clearTimeout(/** @type {any} */ (this._sendT)[k]); }, this);
      this._sendT = {};
    }
  }

  var HOME_CSS = [
    // CLIMATE: a thermostat's plate (the number, the keys at its foot)
    '.thermo{display:flex;flex-direction:column;padding:' + P(14) + ' ' + P(14) + ' ' + P(14) + ' ' + P(16) + '}',
    '.thermo .top{display:flex;align-items:center;gap:' + P(7) + ';min-width:0;white-space:nowrap;font-size:' + P(14) + ';font-weight:600}',
    '.thermo .top .st{font-size:' + P(14) + ';overflow:visible}',
    '.thermo .mid{flex:1;display:grid;place-items:center;min-height:0}',
    '.thermo .giant{font-size:' + P(76) + ';letter-spacing:' + P(-3) + ';padding-left:' + P(14) + '}',
    '.thermo .giant.word{font-size:' + P(46) + ';letter-spacing:' + P(-1.5) + ';padding-left:0;color:' + V('ink-2') + '}',
    '.thermo .foot{display:flex;align-items:center;justify-content:space-between;gap:' + P(6) + '}',
    '.thermo .ctr{flex:1;min-width:0;text-align:center}',
    '.key.k46{width:' + P(46) + ';height:' + P(46) + '}',
    '.key[disabled]{opacity:.35;pointer-events:none}',
    '.rng{display:flex;align-items:flex-start;justify-content:center;gap:' + P(8) + '}',
    '.rng .dash{font-size:' + P(40) + ';font-weight:500;color:' + V('ink-3') + ';line-height:' + P(54) + '}',
    '.half{display:flex;flex-direction:column;align-items:center;gap:' + P(2) + ';padding:' + P(2) + ' ' + P(6) + ';border-radius:' + P(12) + ';opacity:.5}',
    '.half.sel{opacity:1;background:' + V('key') + '}',
    '.half .n{font-size:' + P(54) + ';font-weight:500;letter-spacing:' + P(-2) + ';line-height:' + P(58) + ';font-variant-numeric:tabular-nums}',
    '.half .l{font-size:' + P(12) + ';font-weight:600;letter-spacing:' + P(0.3) + ';text-transform:uppercase;color:' + V('ink-2') + '}',
    // CLIMATE'S ROOMS: the name, its humidity, its temperature
    '.rdl{padding:' + P(4) + ' 0}',
    '.rd{display:flex;align-items:center;gap:' + P(12) + ';width:100%;height:' + P(52) + ';padding:0 ' + P(14) + ' 0 ' + P(18) + ';border-top:1px solid ' + V('line') + ';text-align:left}',
    '.rd:first-child{border-top-color:transparent}',
    '.rd .nm{flex:1;min-width:0}',
    '.rd .hum{width:' + P(52) + ';text-align:right;font-size:' + P(15) + ';font-weight:500;color:' + V('ink-2') + ';font-variant-numeric:tabular-nums}',
    '.rd .tmp{width:' + P(48) + ';text-align:right;font-size:' + P(17) + ';font-weight:600;font-variant-numeric:tabular-nums}',
    // A PLATE WITH A GLYPH, WORDS AND A CAPSULE (the garage door, the main valve)
    '.gar{display:flex;align-items:center;gap:' + P(13) + ';padding:0 ' + P(14) + ' 0 ' + P(20) + '}',
    '.gar .mid{flex:1;min-width:0}',
    '.gar .nm{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.gar.tall{flex-direction:column;align-items:flex-start;justify-content:center;gap:' + P(6) + ';padding:' + P(18) + ' ' + P(20) + '}',
    '.gar.tall .cap{margin-top:' + P(10) + '}',
    // WATER'S LIST BESIDE THE VALVE: a leak is a lit row, which is a little taller than its neighbors, so it trims its margin
    '.wtl .rw.lit{margin:' + P(1) + ' 0;min-height:' + P(50) + '}',
    '.lk{color:#e0352b;font-weight:700}',
    // WATER'S DAY: the figure, how it compares, the hours
    '.wuse{display:flex;flex-direction:column;padding:' + P(18) + ' ' + P(20) + ' ' + P(22) + '}',
    '.wuse .big{display:flex;align-items:baseline;gap:' + P(6) + ';margin-top:' + P(6) + '}',
    '.wuse .giant{font-size:' + P(72) + '}',
    '.wuse .foot{margin-top:auto}',
    '.wb{display:flex;align-items:flex-end;gap:' + P(3) + ';height:' + P(70) + '}',
    '.wb i{flex:1;min-width:0;border-radius:' + P(2) + ';background:linear-gradient(180deg,#8fd3f0,#32ade6);min-height:' + P(2) + '}',
    '.wb i.fut{background:rgba(255,255,255,.14)}',
    '.wax{display:flex;justify-content:space-between;margin-top:' + P(6) + ';font-size:' + P(11) + ';font-weight:600;color:' + V('ink-2') + '}',
    // THIS WEEK: a bar a day
    '.wk{padding:' + P(18) + ' ' + P(20) + ' ' + P(14) + '}',
    '.wkb{display:flex;justify-content:space-between;align-items:flex-end;height:' + P(150) + ';padding:0 ' + P(10) + '}',
    '.wkc{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;width:' + P(44) + '}',
    '.wkc .v{font-size:' + P(12) + ';font-weight:600;color:' + V('ink-2') + ';font-variant-numeric:tabular-nums;margin-bottom:' + P(5) + '}',
    '.wkc .bar{width:' + P(22) + ';border-radius:' + P(5) + ' ' + P(5) + ' ' + P(2) + ' ' + P(2) + ';background:linear-gradient(180deg,#8fd3f0,#32ade6);min-height:' + P(3) + '}',
    '.wkc .dn{font-size:' + P(11) + ';font-weight:600;letter-spacing:' + P(0.4) + ';text-transform:uppercase;color:' + V('ink-2') + ';margin-top:' + P(7) + '}',
    '.wkc.now .bar{background:#fff}.wkc.now .dn,.wkc.now .v{color:' + V('ink') + '}'
  ].join('\n');

  // ------------------------------------------------------------------ CLIMATE
  // THE THERMOSTATS: two to a row, a plate two rows tall each: what it is doing, the target as the one big number, and the keys
  // (down, up) at its foot; the plate opens the thermostat's sheet. In heat/cool the number is the range, and the keys move the
  // side last touched (the low one until one is). A step is the thermostat's own target_temp_step, held on the face and sent
  // 600 ms after the last tap, as the Wide block's. ROOMS: the readings of the screen's rooms, one list. FANS, BLINDS: Wide
  // levels for what runs from 0 to 100, Small tiles for the rest.
  var MODE_NAME = { heat: 'Heat', cool: 'Cool', heat_cool: 'Auto', auto: 'Auto', off: 'Off', dry: 'Dry', fan_only: 'Fan Only' };
  /** @param {any} a */
  function stepOf(a) {
    var n = num(a && a.target_temp_step);
    if (n && n > 0) return n;
    return /C/.test((window.hkLocale && window.hkLocale.units && window.hkLocale.units().temp) || '') ? 0.5 : 1;
  }
  class HvClimate extends HvHome {
    constructor() { super(); this._pick = {}; this._hold = {}; this._sendT = {}; }
    static get CSS() { return H.CSS + HOME_CSS; }
    // the target as it is shown: what the thermostat says, or what a step just set (held until it answers or 8 s pass)
    /** @param {string} id @param {any} a @param {string} mode */
    _target(id, a, mode) {
      var lo = num(a.target_temp_low), hi = num(a.target_temp_high), one = num(a.temperature);
      var range = mode === 'heat_cool' && lo != null && hi != null, hd = this._hold[id];
      if (hd && Date.now() >= hd.until) { delete this._hold[id]; hd = null; }
      if (hd) {
        var took = hd.which === 'single' ? one === hd.single : (lo === hd.lo && hi === hd.hi);
        if (took) { delete this._hold[id]; hd = null; }
        else if (hd.which === 'single') one = hd.single;
        else { lo = hd.lo; hi = hd.hi; }
      }
      return { lo: lo, hi: hi, one: one, range: range };
    }
    /** @param {any} cfg */
    _thermo(cfg) {
      var id = cfg.entity, st = this.st(id), a = (st && st.attributes) || {}, mode = st ? st.state : 'unavailable', off = gone(st);
      var name = String(cfg.name || a.friendly_name || id).replace(/\s+thermostat$/i, '') || id, step = stepOf(a), t = this._target(id, a, mode);
      var act = a.hvac_action, word, color = V('ink-2'), icon = 'mdi:fire';
      if (off) word = 'No Response';
      else if (mode === 'off') { word = 'Off'; icon = 'mdi:power'; }
      else if (act === 'heating') { word = 'Heating'; color = H.HUES.orange; }
      else if (act === 'cooling') { word = 'Cooling'; color = H.HUES.blue; icon = 'mdi:snowflake'; }
      else if (act === 'idle') word = 'Idle';
      else if (act) word = H.sentence(act);
      else word = MODE_NAME[mode] || H.sentence(mode);
      if (!off && mode !== 'off' && icon === 'mdi:fire' && (mode === 'cool' || (act !== 'heating' && mode === 'cool'))) icon = 'mdi:snowflake';
      if (!off && mode !== 'off' && (mode === 'heat_cool' || mode === 'auto') && act !== 'heating' && act !== 'cooling') icon = 'mdi:thermometer';
      var cur = num(a.current_temperature);
      var top = '<div class="top">' + H.glyph(icon, 16, color) + '<span style="color:' + color + (word === 'Idle' || word === 'Off' ? ';color:' + V('ink') : '') + '">' + esc(word) + '</span>' +
        (cur != null && !off ? '<span class="st">· ' + deg(cur, step) + ' now</span>' : '') + '</div>';
      var big;
      if (off) big = '<div class="giant word">—</div>';
      else if (mode === 'off') big = '<div class="giant word">Off</div>';
      else if (t.range) {
        var side = this._pick[id] === 'high' ? 'high' : 'low';
        big = '<div class="rng"><button class="half' + (side === 'low' ? ' sel' : '') + '" data-act="pick" data-id="' + esc(id) + '" data-side="low" aria-label="Heat to ' +
          esc(deg(/** @type {number} */ (t.lo), step)) + '"><span class="n">' + esc(deg(/** @type {number} */ (t.lo), step).replace('°', '')) + '</span><span class="l">Heat</span></button>' +
          '<span class="dash">–</span><button class="half' + (side === 'high' ? ' sel' : '') + '" data-act="pick" data-id="' + esc(id) + '" data-side="high" aria-label="Cool to ' +
          esc(deg(/** @type {number} */ (t.hi), step)) + '"><span class="n">' + esc(deg(/** @type {number} */ (t.hi), step).replace('°', '')) + '</span><span class="l">Cool</span></button></div>';
      } else if (t.one != null) big = '<div class="giant num">' + esc(deg(t.one, step)) + '</div>';
      else big = '<div class="giant word">—</div>';
      var can = !off && mode !== 'off' && (t.range || t.one != null);
      var foot = '<div class="foot">' + H.key({ g: H.chev('down', 22), label: 'Lower ' + name, cls: 'k46', act: 'step', data: { id: id, d: -1 }, off: !can }) +
        '<div class="ctr"><div class="nm">' + esc(name) + '</div><div class="st">' + esc(off ? 'No Response' : t.range ? 'Auto' : MODE_NAME[mode] || H.sentence(mode)) + '</div></div>' +
        H.key({ g: H.chev('up', 22), label: 'Raise ' + name, cls: 'k46', act: 'step', data: { id: id, d: 1 }, off: !can }) + '</div>';
      return '<div class="pl c2 r2 thermo" role="group" data-act="sheet" data-id="' + esc(id) + '" aria-label="' + esc(name) + '">' + top + '<div class="mid">' + big + '</div>' + foot + '</div>';
    }
    // the readings by room: { name, t, hu, id } sorted by name, from the lists the strategy handed over (extra.readings)
    /** @param {any} rd */
    _readings(rd) {
      var self = this, by = /** @type {any} */ ({});
      this._unitC = null;
      /** @param {string} id @param {boolean} temp */
      function put(id, temp) {
        var st = self.st(id);
        if (!st) return;
        var a = st.attributes || {}, climate = id.indexOf('climate.') === 0;
        var v = climate ? num(temp ? a.current_temperature : a.current_humidity) : (gone(st) ? null : num(st.state));
        if (temp && !climate && a.unit_of_measurement && self._unitC == null) self._unitC = /C/.test(String(a.unit_of_measurement));
        var room = roomOf(self, id) || a.friendly_name || id, r = by[room] || (by[room] = { name: room, t: null, hu: null, id: '' });
        if (!r.id) r.id = id;
        if (temp) { if (r.t == null) { r.t = v; if (v != null) r.id = id; } }
        else if (r.hu == null) r.hu = v;
      }
      (rd.temperature || []).forEach(function (/** @type {string} */ id) { put(id, true); });
      (rd.humidity || []).forEach(function (/** @type {string} */ id) { put(id, false); });
      return Object.keys(by).map(function (k) { return by[k]; }).sort(function (/** @type {any} */ x, /** @type {any} */ y) { return x.name < y.name ? -1 : x.name > y.name ? 1 : 0; });
    }
    // a fan, a blind, a humidifier: a level where it has one (a Wide), else a Small tile
    /** @param {any} t @param {boolean} blind */
    _piece(t, blind) {
      var id = t.id, st = this.st(id), lv = H.levelNow(this, id, st), on = lv ? lv.pct > 0 : H.isOn(st);
      var raw = nameOf(t, st), room = t.group || '', name = GENERIC.test(raw) && room ? room : raw, icon = H.iconOf(t.cfg, st), color = H.glyphColor(t.cfg, st, on);
      if (lv) {
        return H.level({ id: id, name: name, sub: H.word(st), icon: icon, color: color, fill: COOL_FILL, pct: lv.pct, lit: on, word: on ? lv.pct + '%' : '' });
      }
      return H.tile({ id: id, name: name, sub: H.word(st), icon: icon, color: color, lit: on, gact: 'toggle' });
    }
    /** @param {any[]} ts @param {boolean} blind */
    _group(ts, blind) {
      var self = this;
      var items = ts.map(function (t) {
        var st = self.st(t.id), lv = H.levelNow(self, t.id, st);
        return { t: t, lv: lv, on: lv ? lv.pct > 0 : H.isOn(st) };
      });
      return { on: items.filter(function (x) { return x.on; }).length,
               html: '<div class="grid">' + H_levelsFirst(items).map(function (x) { return self._piece(x.t, blind); }).join('') + '</div>' };
    }
    draw() {
      var self = this, h = this.h, cfg = this._config || {}, extra = cfg.extra || {};
      var seen = /** @type {any} */ ({});
      var thermos = H.cardsOf(h, 'hk-thermostat-card').filter(function (c) { if (!c.entity || seen[c.entity]) return false; seen[c.entity] = 1; return true; });
      var rooms = this._readings(extra.readings || {});
      var fans = h.tiles.filter(function (/** @type {any} */ t) { return t.id.indexOf('fan.') === 0; });
      var hums = h.tiles.filter(function (/** @type {any} */ t) { return t.id.indexOf('humidifier.') === 0; });
      var blinds = h.tiles.filter(function (/** @type {any} */ t) { return t.id.indexOf('cover.') === 0; });
      // (the readings' own unit, else the locale's)
      var metric = this._unitC != null ? this._unitC : /C/.test((window.hkLocale && window.hkLocale.units && window.hkLocale.units().temp) || '');
      // THE LINE UNDER THE TITLE: the house's temperature (its rooms', else its thermostats') and what it is outside
      var temps = rooms.filter(function (/** @type {any} */ r) { return r.t != null; }).map(function (/** @type {any} */ r) { return r.t; });
      if (!temps.length) thermos.forEach(function (c) { var a = (self.st(c.entity) || { attributes: {} }).attributes, n = num(a.current_temperature); if (n != null) temps.push(n); });
      if (metric && temps.some(function (x) { return x > 45; })) metric = false;     // (a Celsius reading is never that warm)
      var outCfg = H.cardOf(h, 'hk-climate-outside-card'), wst = outCfg && outCfg.weather ? this.st(outCfg.weather) : null, out = wst ? num(wst.attributes.temperature) : null;
      var sum = '';
      if (temps.length) sum = '<b>' + Math.round(temps.reduce(function (x, y) { return x + y; }, 0) / temps.length) + '°</b> inside' + (out != null ? ' · ' + Math.round(out) + '° out' : '');
      else if (out != null) sum = Math.round(out) + '° out';
      var html = H.head({ title: cfg.title || 'Climate', sum: sum });
      if (thermos.length) html += '<div class="grid">' + thermos.map(function (c) { return self._thermo(c); }).join('') + '</div>';
      if (rooms.length) {
        var lo = Math.min.apply(null, temps), hi = Math.max.apply(null, temps);
        html += H.section('Rooms', temps.length ? (Math.round(lo) === Math.round(hi) ? Math.round(lo) + '°' : Math.round(lo) + '–' + Math.round(hi) + '°') : '');
        html += '<div class="pl rdl">' + rooms.map(function (/** @type {any} */ r) {
          var cold = r.t != null && r.t < (metric ? 13 : 55), hot = r.t != null && r.t > (metric ? 27 : 80);
          return '<button class="rd" data-act="sheet" data-id="' + esc(r.id) + '"><span class="nm">' + esc(r.name) + '</span><span class="hum">' + (r.hu != null ? Math.round(r.hu) + '%' : '') +
            '</span><span class="tmp"' + (cold ? ' style="color:' + H.HUES.blue + '"' : hot ? ' style="color:' + H.HUES.orange + '"' : '') + '>' + (r.t != null ? Math.round(r.t) + '°' : '') +
              '</span></button>';
        }).join('') + '</div>';
      }
      if (fans.length) { var f = this._group(fans, false); html += H.section('Fans', f.on ? f.on + ' On' : 'All Off') + f.html; }
      if (hums.length) { var u = this._group(hums, false); html += H.section('Humidifiers', u.on ? u.on + ' On' : 'All Off') + u.html; }
      if (blinds.length) { var b = this._group(blinds, true); html += H.section('Blinds', b.on ? b.on + ' Open' : 'All Closed') + b.html; }
      if (!thermos.length && !rooms.length && !fans.length && !hums.length && !blinds.length) {
        html += '<div class="pl quiet">Nothing on this screen. Add thermostats, fans and blinds in ' + H.esc(H.where('Accessories')) + '.</div>';
      }
      return html;
    }
    // a step of the target (dir 1 or -1): by the thermostat's step, inside its range, the two ends never crossing; held on the face,
    // sent 600 ms after the last
    /** @param {string} id @param {number} dir */
    _step(id, dir) {
      var st = this.st(id), self = this;
      if (gone(st)) return;
      var a = st.attributes || {}, mode = st.state, step = stepOf(a);
      if (mode === 'off') return;
      var min = num(a.min_temp), max = num(a.max_temp);
      /** @param {number} x */
      var snap = function (x) { x = Math.round(x / step) * step; if (min != null) x = Math.max(min, x); if (max != null) x = Math.min(max, x); return Math.round(x * 100) / 100; };
      var t = this._target(id, a, mode), hold;
      if (t.range) {
        var lo = /** @type {number} */ (t.lo), hi = /** @type {number} */ (t.hi), side = this._pick[id] === 'high' ? 'high' : 'low';
        if (side === 'high') hi = Math.max(snap(hi + dir * step), lo + step);
        else lo = Math.min(snap(lo + dir * step), hi - step);
        hold = { which: side, lo: lo, hi: hi, until: Date.now() + 8000 };
      } else {
        if (t.one == null) return;
        hold = { which: 'single', single: snap(t.one + dir * step), until: Date.now() + 8000 };
      }
      this._hold[id] = hold;
      this.redraw();
      later(this, 8050);
      clearTimeout(this._sendT[id]);
      this._sendT[id] = setTimeout(function () {
        delete self._sendT[id];
        var d = self._hold[id];
        if (!d) return;
        d.until = Date.now() + 8000;
        later(self, 8050);
        self._call('climate', 'set_temperature', Object.assign({ entity_id: id }, d.which === 'single' ? { temperature: d.single } : { target_temp_low: d.lo, target_temp_high: d.hi }));
      }, 600);
    }
    /** @param {string} act @param {any} el */
    act(act, el) {
      var id = el.getAttribute('data-id') || '';
      if (act === 'pick') { this._pick[id] = el.getAttribute('data-side') === 'high' ? 'high' : 'low'; this.redraw(); return true; }
      if (act === 'step') { this._step(id, Number(el.getAttribute('data-d')) || 0); return true; }
      return false;
    }
  }
  H.register('hk-hv-climate-card', HvClimate, 'HK HomeView Climate', 'The Climate page on an Apple HomeView: the thermostats, every room\'s readings, the fans and the blinds.');

  // ------------------------------------------------------------------ DOORS & WINDOWS
  // WHAT IS OPEN FIRST, lit, with how long (longest first); then the doors and the windows that are closed, each a list; then the
  // garage door, a tile with its Open / Close capsule (Security's list has its own: only a house that puts one here sees it).
  class HvDoors extends HvHome {
    static get CSS() { return H.CSS + HOME_CSS; }
    /** @param {any} t */
    _item(t) {
      var st = this.st(t.id), a = (st && st.attributes) || {}, d = t.id.split('.')[0], dc = a.device_class;
      var garage = (d === 'cover' && (dc === 'garage' || dc === 'gate')) || dc === 'garage_door' || /garage/i.test(t.group || '');
      var kind = garage ? 'garage' : t.group === 'Windows' ? 'window' : t.group === 'Doors' ? 'door' : dc === 'window' ? 'window' : 'door';
      var open = !gone(st) && H.isOn(st), name = nameOf(t, st), room = t.cfg.room || '';
      var since = open && st.last_changed ? Date.now() - new Date(st.last_changed).getTime() : 0;
      var ico = t.cfg.icon_states && t.cfg.icon_states.off && !open ? t.cfg.icon_states.off : H.iconOf(t.cfg, st);
      return { id: t.id, st: st, kind: kind, open: open, lost: gone(st), name: name, sub: room && name.toLowerCase().indexOf(room.toLowerCase()) < 0 ? room : '',
               since: since, icon: ico, cover: d === 'cover' };
    }
    /** @param {any} x */
    _row(x) {
      var val = x.lost ? 'No Response' : x.open ? (x.st.state === 'opening' ? 'Opening' : x.st.state === 'closing' ? 'Closing' : 'Open' + (x.since ? ' ' + span(x.since) : '')) : 'Closed';
      return H.row({ icon: x.icon, color: x.open ? H.DEEP.teal : x.lost ? V('ink-3') : V('ink'), name: x.name, sub: x.sub, val: esc(val), lit: x.open, act: 'sheet', data: { id: x.id } });
    }
    /** @param {any} x */
    _garage(x) {
      var st = x.st, s = st ? st.state : '', moving = s === 'opening' || s === 'closing';
      var word = x.lost ? 'No Response' : moving ? H.sentence(s) : x.open ? 'Open' + (x.since ? ' ' + span(x.since) : '') : 'Closed';
      var cap = x.cover && !x.lost ? H.cap({ t: moving ? H.sentence(s) + '…' : x.open ? 'Close' : 'Open', act: 'garage', data: { id: x.id, to: x.open ? 'close' : 'open' }, off: moving }) : '';
      return '<div class="pl c2 gar' + (x.open ? ' lit' : '') + '" data-act="sheet" data-id="' + esc(x.id) + '" role="group" aria-label="' + esc(x.name) + '">' +
        H.glyph(x.icon || 'hk:garage', 30, x.open ? H.DEEP.teal : V('ink')) + '<div class="mid"><div class="nm">' + esc(x.name) + '</div><div class="st">' + esc(word) + '</div></div>' + cap +
          '</div>';
    }
    draw() {
      var self = this, cfg = this._config || {}, items = this.h.tiles.map(function (/** @type {any} */ t) { return self._item(t); });
      var open = items.filter(function (x) { return x.open; }).sort(function (x, y) { return y.since - x.since; });
      var lostN = items.filter(function (x) { return x.lost; }).length;
      var sum = open.length ? '<span class="warn">' + open.length + ' Open</span>' : items.length ? '<b>All Closed</b>' : '';
      if (lostN && items.length) sum += ' · ' + lostN + ' No Response';
      var html = H.head({ title: cfg.title || 'Doors & Windows', sum: sum });
      if (open.length) html += H.list(open.map(function (x) { return self._row(x); }));
      /** @param {string} title @param {string} kind */
      var section = function (title, kind) {
        var all = items.filter(function (x) { return x.kind === kind; }), shut = all.filter(function (x) { return !x.open; });
        if (!shut.length) return '';
        var left = all.length - shut.length;
        return H.section(title, left ? shut.length + ' Closed' : 'All Closed') + H.list(shut.map(function (x) { return self._row(x); }));
      };
      html += section('Doors', 'door') + section('Windows', 'window');
      var gar = items.filter(function (x) { return x.kind === 'garage'; });
      if (gar.length) html += H.section('Garage') + '<div class="grid">' + gar.map(function (x) { return self._garage(x); }).join('') + '</div>';
      if (!items.length) html += '<div class="pl quiet">No doors or windows on this screen. Add them in ' + H.esc(H.where('Accessories')) + '.</div>';
      minuteClock(this, open.length > 0 || gar.some(function (x) { return x.open; }));
      return html;
    }
    /** @param {string} act @param {any} el */
    act(act, el) {
      if (act !== 'garage') return false;
      var id = el.getAttribute('data-id') || '', to = el.getAttribute('data-to'), self = this;
      var go = function () { self._call('cover', to === 'open' ? 'open_cover' : 'close_cover', { entity_id: id }); };
      var st = this.st(id), name = (st && st.attributes && st.attributes.friendly_name) || 'the garage door';
      if (to === 'open' && C.confirmSheet) C.confirmSheet('Open ' + name + '?', go, { yes: 'Open', detail: 'The door will open.' });
      else go();
      return true;
    }
  }
  H.register('hk-hv-doors-card', HvDoors, 'HK HomeView Doors & Windows', 'The Doors & Windows page on an Apple HomeView: what is open, the doors, the windows, the garage.');

  // ------------------------------------------------------------------ WATER
  // TODAY'S USE with its hours (the Energy settings' water meter, or the page's own, read as the page's Water Through the Day card
  // reads it), the main valve with Close / Open, and the first leak sensors; then THIS WEEK, then the rest of the sensors. No
  // meter: the valve and the sensors lead. A leak is a lit red row and sorts first.
  var WATER = /** @type {any} */ ({ src: null, wait: null });
  // the meters Home Assistant's Energy settings name (its water sources), asked once
  /** @param {any} card */
  function waterMeters(card) {
    if (WATER.src) return WATER.src;
    var c = card.client;
    if (!WATER.wait && c && c.callWS) {
      WATER.wait = c.callWS({ type: 'energy/get_prefs' }).then(function (/** @type {any} */ pr) {
        var ids = /** @type {string[]} */ ([]);
        ((pr && pr.energy_sources) || []).forEach(function (/** @type {any} */ s) { if (s.type === 'water' && s.stat_energy_from) ids.push(s.stat_energy_from); });
        WATER.src = { ids: ids };
      }, function () { WATER.src = { ids: [] }; }).then(function () { WATER.wait = null; card.redraw(); });
    }
    return null;
  }
  // a water glyph at rest: its blue, or the screen's white when its Icons are White
  function rest() { return H.whiteGlyphs && H.whiteGlyphs() ? V('ink') : H.HUES.cyan; }
  // the valve's state: open, closed, opening, closing, unavailable
  /** @param {any} st */
  function valveState(st) {
    if (!st) return 'unavailable';
    var s = st.state, d = st.entity_id.split('.')[0];
    if (d === 'switch' || d === 'input_boolean') return s === 'on' ? 'open' : s === 'off' ? 'closed' : s === 'unavailable' ? 'unavailable' : 'unknown';
    return ({ open: 'open', closed: 'closed', opening: 'opening', closing: 'closing', unavailable: 'unavailable' })[s] || 'unknown';
  }
  class HvWater extends HvHome {
    constructor() { super(); this._vp = {}; }
    static get CSS() { return H.CSS + HOME_CSS; }
    // today's hours and the week, from the recorder: null while it loads (the plate says so), 0 meters: no usage at all
    /** @param {string[]} ids */
    _usage(ids) {
      var S = window.hkStats, c = this.client;
      if (!S) return null;
      var hr48 = S.hourly(c, ids, 48, this), fm = S.fiveMinute(c, ids, 13, this, { type: 'change' });
      if (!hr48) return null;
      /** @param {any} series @param {number} i */
      var sum = function (series, i) {
        var got = false, t = 0;
        ids.forEach(function (/** @type {string} */ id) { var r = series[id] && series[id][i]; if (r && r.v != null) { got = true; t += r.v; } });
        return got ? t : null;
      };
      var first = hr48[ids[0]] || [], n = first.length, now = Date.now(), start = -1, i;
      for (i = n - 1; i >= 0; i--) { if (S.fields(first[i].t).hour === 0) { start = i; break; } }
      if (start < 0) start = Math.max(0, n - 24);
      var today = [], yday = [];
      for (var j = start; j < n; j++) today.push({ t: first[j].t, v: sum(hr48, j) });
      for (var y = Math.max(0, start - 24); y < start; y++) yday.push({ t: first[y].t, v: sum(hr48, y) });
      if (!today.length) return null;
      var cur = today[today.length - 1], hourStart = +cur.t, part = null;
      if (fm) {
        (fm[ids[0]] || []).forEach(function (/** @type {any} */ r, /** @type {number} */ k) {
          if (+r.t < hourStart) return;
          var x = sum(fm, k);
          if (x != null) part = (part || 0) + x;
        });
      }
      cur.v = part;
      var nowK = today.length - 1, tot = today.reduce(function (a, x) { return a + (x.v || 0); }, 0), yv = null;
      if (yday.length >= nowK + 1 && yday.slice(0, nowK + 1).every(function (x) { return x.v != null; })) {
        yv = yday.slice(0, nowK).reduce(function (a, x) { return a + (x.v || 0); }, 0) + /** @type {number} */ (yday[nowK].v) * Math.min(1, (now - hourStart) / 36e5);
      }
      // the week: 14 days (this one and the 7 before), the last seven drawn, the seven before for the comparison
      var dd = S.daily(c, ids, 14, this), week = null;
      if (dd && dd[ids[0]] && dd[ids[0]].length >= 7) {
        var rows = dd[ids[0]].map(function (/** @type {any} */ r, /** @type {number} */ k) { return { t: r.t, v: sum(dd, k) }; });
        week = { days: rows.slice(-7), prev: rows.length >= 14 ? rows.slice(-14, -7) : null };
      }
      return { today: today, yday: yday, nowK: nowK, tot: tot, yv: yv, week: week };
    }
    /** @param {any} u @param {string} unit */
    _usePlate(u, unit) {
      if (!u) return '<div class="pl c2 r3 wuse"><div class="lbl">Today</div><div class="st" style="margin-top:' + P(8) + '">Loading today…</div></div>';
      var max = 0, k;
      for (k = 0; k < 24; k++) {
        var v = k <= u.nowK ? (u.today[k] && u.today[k].v) : (u.yday[k] && u.yday[k].v);
        if (v != null && v > max) max = v;
      }
      var bars = '';
      for (k = 0; k < 24; k++) {
        var fut = k > u.nowK, x = fut ? (u.yday[k] && u.yday[k].v) : (u.today[k] && u.today[k].v);
        bars += '<i' + (fut ? ' class="fut"' : '') + ' style="height:' + (x != null && max > 0 ? Math.max(3, Math.round(x / max * 100)) : 3) + '%"></i>';
      }
      var cmp = '';
      if (u.yv != null && u.yv > 0.5) {
        var diff = u.tot - u.yv;
        cmp = Math.abs(diff) / u.yv < 0.05 ? 'About the same as yesterday' : amount(Math.abs(diff)) + (unit ? ' ' + unit : '') + (diff < 0 ? ' less' : ' more') + ' than yesterday so far';
      }
      return '<div class="pl c2 r3 wuse"><div class="lbl">Today</div><div class="big"><div class="giant">' + esc(amount(u.tot)) + '</div><div class="hl ink2">' + esc(unit) + '</div></div>' +
        (cmp ? '<div class="st" style="font-size:' + P(15) + ';white-space:normal">' + esc(cmp) + '</div>' : '') +
        '<div class="foot"><div class="wb" role="img" aria-label="Water by hour today">' + bars + '</div><div class="wax"><span>12 AM</span><span>12 PM</span><span>11 PM</span></div></div></div>';
    }
    /** @param {any} w @param {string} unit */
    _weekPlate(w, unit) {
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], S = window.hkStats, max = 0;
      w.days.forEach(function (/** @type {any} */ d) { if (d.v != null && d.v > max) max = d.v; });
      var cols = w.days.map(function (/** @type {any} */ d, /** @type {number} */ i) {
        var now = i === w.days.length - 1, v = d.v;
        return '<div class="wkc' + (now ? ' now' : '') + '"><div class="v">' + (v != null ? esc(amount(v)) : '—') + '</div><div class="bar" style="height:' +
          P(v != null && max > 0 ? Math.max(3, 110 * v / max) : 3) +
          '"></div><div class="dn">' + (now ? 'Today' : days[S.fields(d.t).weekday]) + '</div></div>';
      }).join('');
      var tot = w.days.reduce(function (/** @type {number} */ a, /** @type {any} */ d) { return a + (d.v || 0); }, 0), line = amount(tot) + (unit ? ' ' + unit : '');
      var pv = w.prev && w.prev.every(function (/** @type {any} */ d) { return d.v != null; }) ? w.prev.reduce(function (/** @type {number} */ a, /** @type {any} */ d) { return a + d.v; }, 0) : 0;
      if (pv > 0.5) {
        var pct = Math.round((tot - pv) / pv * 100);
        line += ' · ' + (Math.abs(pct) < 5 ? 'About the same as the week before' : Math.abs(pct) + '% ' + (pct < 0 ? 'under' : 'over') + ' the week before');
      }
      return H.section('This Week', line) + '<div class="pl wk"><div class="wkb">' + cols + '</div></div>';
    }
    // the main valve: a plate with the state and the one capsule (a close asks first: no water reaches the house)
    /** @param {any} cfg @param {string} cls */
    _valve(cfg, cls) {
      var id = cfg.entity, st = this.st(id), s = valveState(st), pend = this._vp[id];
      if (pend && (s === pend.to || Date.now() > pend.until)) { delete this._vp[id]; pend = null; }
      var show = pend && s !== 'opening' && s !== 'closing' ? (pend.to === 'open' ? 'opening' : 'closing') : s;
      var word = ({ open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…', unknown: 'No Response', unavailable: 'No Response' })[show];
      var name = String(cfg.title || (st && st.attributes.friendly_name) || 'Main Water Supply').replace(/\s+valve$/i, '') || 'Main Water Supply';
      var cap = H.cap({ t: show === 'open' ? 'Close' : show === 'closed' ? 'Open' : word, act: 'valve', data: { id: id, to: show === 'open' ? 'closed' : 'open' }, off: show !== 'open' && show !==
        'closed', cls: cls === 'tall' ? 'lg' : '' });
      return '<div class="pl ' + (cls === 'tall' ? 'c2 r3' : 'c2') + ' gar' + (cls === 'tall' ? ' tall' : '') + '" data-act="sheet" data-id="' + esc(id) + '" role="group" aria-label="' + esc(name) +
        '">' +
        H.glyph('hk:valve', cls === 'tall' ? 44 : 30, rest()) + '<div class="mid"><div class="nm">' + esc(name) + '</div><div class="st">' + esc(word) + '</div></div>' + cap + '</div>';
    }
    // a leak sensor as a row: red and lit while it reports a leak
    /** @param {any} x */
    _row(x) {
      var val = x.leak ? '<span class="lk">Leak</span>' : x.lost ? 'No Report' : 'Dry';
      return H.row({ icon: x.icon, color: x.leak ? H.DEEP.red : rest(), name: x.name, sub: x.sub, val: val, lit: x.leak, act: 'sheet', data: { id: x.id } });
    }
    draw() {
      var self = this, h = this.h, cfg = this._config || {};
      var supply = H.cardOf(h, 'hk-water-supply-card'), dayCfg = H.cardOf(h, 'hk-water-day-card');
      var sensors = h.tiles.filter(function (/** @type {any} */ t) { return t.group !== 'Valves'; }).map(function (/** @type {any} */ t) {
        var st = self.st(t.id), room = t.group || '', name = nameOf(t, st).replace(/\s+(water\s+)?leak(\s+sensor)?$|\s+sensor$/i, '') || nameOf(t, st);
        return { id: t.id, name: name, sub: room && name.toLowerCase().indexOf(room.toLowerCase()) < 0 ? room : '', icon: H.iconOf(t.cfg, st), leak: !!st && st.state === 'on', lost: gone(st) };
      });
      // (a leak first; the rest as the page has them)
      sensors = sensors.filter(function (x) { return x.leak; }).concat(sensors.filter(function (x) { return !x.leak; }));
      var valves = h.tiles.filter(function (/** @type {any} */ t) { return t.group === 'Valves'; });
      var leaks = sensors.filter(function (x) { return x.leak; });
      // THE USE: the page's meter, else the Energy settings'; none, none
      var ids = /** @type {string[]|null} */ (null), unit = '', u = null;
      if (dayCfg) {
        ids = dayCfg.meter ? [dayCfg.meter] : (WATER.src ? WATER.src.ids : waterMeters(this) && WATER.src.ids);
        if (ids) ids = ids.filter(function (id) { return self.client.states[id] || /:/.test(id); });
        if (ids && ids.length) {
          var ms = this.st(ids[0]);
          unit = (ms && ms.attributes.unit_of_measurement) || '';
          u = this._usage(ids);
        }
      }
      var hasUse = !!dayCfg && (!ids || ids.length > 0);
      var lead = leaks.length ? '<span class="bad">' + (leaks.length === 1 ? 'Leak: ' + esc(leaks[0].name) : leaks.length + ' Leaks') + '</span>'
        : sensors.length ? '<b>All Dry</b>' : supply ? '<b>Valve ' + H.sentence(valveState(this.st(supply.entity))) + '</b>' : '';
      var sum = lead + (u ? ' · ' + esc(amount(u.tot)) + (unit ? ' ' + esc(unit) : '') + ' today' : '');
      var html = H.head({ title: cfg.title || 'Water', sum: sum });
      var shown = 0;
      if (hasUse) {
        // THE FIRST SCREEN: the day on the left, the valve and the first sensors beside it (4 rows with the valve, 6 without)
        var rowsN = supply ? 4 : 6;
        shown = Math.min(rowsN, sensors.length);
        html += '<div class="grid">' + this._usePlate(u, unit);
        if (supply) html += this._valve(supply, sensors.length ? '' : 'tall');
        if (shown) html += H.list(sensors.slice(0, shown).map(function (x) { return self._row(x); }), 'wtl ' + (supply ? 'c2 r2' : 'c2 r3'));
        html += '</div>';
      } else {
        if (supply) html += '<div class="grid">' + this._valve(supply, '').replace('class="pl c2 gar', 'class="pl c4 gar') + '</div>';
        if (sensors.length) html += (supply ? H.section('Leak Sensors', sensors.length + (sensors.length === 1 ? ' Sensor' : ' Sensors')) : '') +
          H.list(sensors.map(function (x) { return self._row(x); }), 'wtl');
        shown = sensors.length;
      }
      if (u && u.week) html += this._weekPlate(u.week, unit);
      var rest = sensors.slice(shown);
      if (rest.length) {
        var wet = rest.filter(function (x) { return x.leak; }).length;
        html += H.section('Leak Sensors', rest.length + ' more' + (wet ? ' · ' + wet + (wet === 1 ? ' leak' : ' leaks') : ' · all dry')) +
          H.list(rest.map(function (x) { return self._row(x); }), 'wtl');
      }
      if (valves.length) {
        html += H.section('Valves') + H.list(valves.map(function (/** @type {any} */ t) {
          var st = self.st(t.id);
          return H.row({ icon: H.iconOf(t.cfg, st), color: rest(), name: nameOf(t, st), sub: t.group === 'Valves' ? '' : t.group || '', val: esc(H.word(st)), act: 'sheet', data: { id: t.id } });
        }));
      }
      if (!supply && !sensors.length && !valves.length && !hasUse) html += '<div class="pl quiet">No water accessories on this screen. Add them in ' + H.esc(H.where('Accessories')) + '.</div>';
      return html;
    }
    /** @param {string} act @param {any} el */
    act(act, el) {
      if (act !== 'valve') return false;
      var id = el.getAttribute('data-id') || '', open = el.getAttribute('data-to') === 'open', self = this, d = id.split('.')[0];
      var go = function () {
        self._vp[id] = { to: open ? 'open' : 'closed', until: Date.now() + 90000 };
        self.redraw();
        later(self, 90100);
        var done = d === 'valve' ? self._call('valve', open ? 'open_valve' : 'close_valve', { entity_id: id }) : self._call(d, open ? 'turn_on' : 'turn_off', { entity_id: id });
        done.then(function (/** @type {boolean} */ ok) { if (!ok) { delete self._vp[id]; self.redraw(); } });
      };
      if (C.confirmSheet) {
        C.confirmSheet(open ? 'Turn the main water supply back on?' : 'Shut off the main water supply?', go,
          { yes: open ? 'Turn On' : 'Shut Off', destructive: !open, detail: open ? 'Water will flow to the house again.' : 'No water will reach the house until it is turned back on.' });
      } else go();
      return true;
    }
  }
  H.register('hk-hv-water-card', HvWater, 'HK HomeView Water', 'The Water page on an Apple HomeView: today\'s use, the main valve, the leak sensors and the week.');

  window.hkHvHome.Climate = HvClimate;
  window.hkHvHome.Doors = HvDoors;
  window.hkHvHome.Water = HvWater;
  window.hkHvHome.Lights = HvLights;
  });
})();
