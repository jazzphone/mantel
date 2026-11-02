// hk-saverpieces-sensor.js -- THE SCREENSAVER'S ANY SENSOR GLANCE PIECE (2026-11-02, phase 13, phase 1b, wave C:
// docs/phase13/GLANCE-SPEC.md, "Wave C" and "Options beyond choices"): one piece, `sensor`, in its own group. One group, one
// file, loaded after hk-saverwidgets.js, which draws it: the piece is declared once (the plan's rule 1) with
// hkSaverWidgets.define() and drawn with the renderer's own classes and helpers (ring, inl), so it looks like the core pieces
// in every backdrop, ink and size. Its CSS is one small block on the spacing scale (rectangular's two rows).
//
// THE OWNER PICKS THE ENTITY (opts.entity, and opts.entity2 for the rectangular shape's second row): any sensor,
// binary_sensor, input_number, number, input_boolean, switch, climate, lock, cover or device_tracker the screen may read. There
// is no suggestion: with nothing picked the piece draws a dash and the editor asks for one. opts.name (words, 1 to 40) is the
// name it goes by, else the entity's friendly name; opts.min and opts.max (words that are numbers) are the circular ring's ends.
//
//   inline        a glyph, then "<name> <state>": "Pool 78°", "Freezer 2°", "Mailbox Open", "Front Door Locked"
//   circular      a numeric state ringed between min and max: the value (with its unit when it is short, else the unit under
//                 it), the name (8 letters at most, capitals) on the label's baseline. A state that is words: the words (a
//                 little smaller, the ring's own sizing), the ring's track alone.
//   rectangular   the two sensors, each a row: its name at the left, its state at the right (the World Clock's rows)
//
// HOW A STATE IS PUT IN WORDS (hk-tile.js's label modes and hk-sheet-sensor.js's BIN_WORDS, which are private to those files and
// not on the tablet's page, mirrored here): a number is rounded to what a glance can read (degrees and percents whole; else the
// entity's suggested_display_precision, else 0 decimals from 100 up, 1 from 10, 2 below, trailing zeros dropped, thousands
// grouped) and takes its unit ("78°", "45%", "2.1 kW"; a temperature or humidity or battery with no unit gets its usual); a
// binary_sensor says what its device_class says (door/window/garage/opening Closed or Open, motion/occupancy Clear or Detected,
// moisture Dry or Wet, lock Locked or Unlocked, battery Normal or Low...), else Off or On; a switch or input_boolean On or Off; a
// device_tracker Home, Away or its zone; a climate its current temperature; a cover its position when it is part way; a
// timestamp its time; anything else its state in Title Case. unknown and unavailable are a dash, never a word.
//
// THE GLYPH is our own inline SVG (the renderer draws only that): the entity's `icon` when it is an mdi name with a glyph here,
// else its device_class, else its domain, else a dot. The color follows the device class: a temperature by its value, a battery
// green to red by its level, power amber, a door or lock amber when open or unlocked and green when shut, the alerts (smoke, gas,
// leak...) red while tripped; anything else is the screen's ink.
// THE RULES: nothing animates and nothing blurs; no timer, nothing that wakes a read. Reading is a few states and arithmetic.
(function () {
  'use strict';
  var W = window.hkSaverWidgets;
  if (!W || !W.define || !W._) return;
  if (W._.sensor) return;                                       // loaded twice

  var _ = W._, clamp = _.clamp, cut = _.cut, ring = _.ring, inl = _.inl, num = _.num, esc = _.esc, DASH = _.DASH, ACC = _.ACC, accStyle = _.accStyle;
  var GREEN = ACC.green, AMBER = ACC.amber, RED = ACC.red, ORANGE = ACC.orange, YELLOW = ACC.yellow;

  var GROUP = 'Any Sensor';
  var DOMAINS = 'entity:sensor,binary_sensor,input_number,number,input_boolean,switch,climate,lock,cover,device_tracker';

  // ------------------------------------------------------------ the look this group adds (--u, the spacing scale: .4 .8 1.2 1.6 2.4 3.2)
  // Rectangular: two rows of 4.6 u with .4 u between (World Clock's), a name at the left and its state at the right, figures
  // tabular (the renderer sets it), so a reading never jitters. The state never takes more than 60% of the row.
  var CSS = [
    '.hksw .sxc{flex:1;min-width:0;display:flex;flex-direction:column;gap:calc(var(--u) * .4)}',
    '.hksw .sxr{display:flex;align-items:center;gap:calc(var(--u) * 1.2);min-width:0;height:calc(var(--u) * 4.6)}',
    '.hksw .sxr .sxn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:calc(var(--u) * 2.2);line-height:1.2;font-weight:700}',
    '.hksw .sxr .sxv{flex:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;text-align:right;font-size:calc(var(--u) * 2.8);line-height:1.2;font-weight:700}',
    '.hksw .sxr .sxv small{font-size:calc(var(--u) * 1.6);font-weight:600;opacity:.8;margin-left:calc(var(--u) * .4)}'
  ].join('\n');
  if (W.addCss) W.addCss(CSS);

  // ------------------------------------------------------------ small helpers
  function r200(v) { return Math.round(v * 200) / 200; }
  // (an entity's device_class is its own words: 'constructor' is not a key of these tables)
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function titled(s) {
    return String(s == null ? '' : s).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/(^|\s)[a-z]/g, function (c) { return c.toUpperCase(); });
  }
  // a name cut short, without a space left before the ellipsis
  function short(s, n) { return cut(s, n).replace(/\s+\u2026$/, '\u2026'); }
  // an entity's name when it has none: its id's words
  function idName(id) { return titled(String(id || '').split('.').slice(1).join(' ')) || DASH; }
  // the label under a ring: 8 letters at most, in capitals -- whole words while they fit, else the first word cut
  function tag(name) {
    var s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().toUpperCase();
    if (s.length <= 8) return s;
    var out = '';
    s.split(' ').some(function (w) {
      var t = out ? out + ' ' + w : w;
      if (t.length > 8) return true;
      out = t;
      return false;
    });
    return out || cut(s, 8);
  }

  // ------------------------------------------------------------ the words
  // a binary_sensor's states by device_class: [off, on] (hk-sheet-sensor.js BIN_WORDS, with the alerts and a few more)
  var BIN = {
    door: ['Closed', 'Open'], window: ['Closed', 'Open'], garage_door: ['Closed', 'Open'], opening: ['Closed', 'Open'],
    moisture: ['Dry', 'Wet'], motion: ['Clear', 'Detected'], occupancy: ['Clear', 'Detected'], presence: ['Away', 'Home'],
    lock: ['Locked', 'Unlocked'], smoke: ['Clear', 'Detected'], gas: ['Clear', 'Detected'], carbon_monoxide: ['Clear', 'Detected'],
    safety: ['Safe', 'Unsafe'], tamper: ['Clear', 'Tampered'], problem: ['OK', 'Problem'], connectivity: ['Disconnected', 'Connected'],
    plug: ['Unplugged', 'Plugged In'], power: ['Off', 'On'], battery: ['Normal', 'Low'], battery_charging: ['Not Charging', 'Charging'],
    cold: ['Normal', 'Cold'], heat: ['Normal', 'Hot'], light: ['No Light', 'Light'], moving: ['Stopped', 'Moving'], running: ['Stopped', 'Running'],
    sound: ['Clear', 'Detected'], vibration: ['Clear', 'Detected']
  };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // a number the way a glance reads it
  function numText(n, prec, whole) {
    var d = whole ? 0 : prec != null && prec >= 0 && prec <= 6 ? Math.floor(prec) : Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
    var s = n.toFixed(d);
    if (!whole && prec == null && s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    if (/^-0(\.0+)?$/.test(s) || s === '-0') s = s.slice(1);
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }
  // an instant in words: a time today, the weekday and time after, a date as "Nov 2"
  function instant(raw, dc, X) {
    var t = Date.parse(raw);
    if (!isFinite(t)) return null;
    var d = new Date(t), now = X.now instanceof Date ? X.now : new Date();
    if (dc === 'date') return MONTHS[d.getMonth()] + ' ' + d.getDate();
    var tm = _.tm(d, X.h24, true), same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return same ? tm : DAYS[d.getDay()] + ' ' + tm;
  }

  // ------------------------------------------------------------ one entity, read
  //   -> { id, dom, dc, name, ok, raw, n (a number or null), v (its figure or words), unit ('°', '%', another or ''), tight (the
  //        unit hugs the figure), celsius, open (a lock or door: not shut), icon }
  function infoOf(X, id, nameOpt) {
    var st = X.st || {}, s = id && st[id] && typeof st[id] === 'object' ? st[id] : null, a = (s && s.attributes && typeof s.attributes === 'object' ? s.attributes : {});
    var dom = String(id || '').split('.')[0], dc = String(a.device_class || ''), raw = s && s.state != null ? String(s.state) : '';
    var name = String(nameOpt || '').replace(/\s+/g, ' ').trim() || String(a.friendly_name || '').replace(/\s+/g, ' ').trim() || idName(id);
    var i = { id: id, dom: dom, dc: dc, name: name, ok: !!s && raw !== '' && raw !== 'unknown' && raw !== 'unavailable', raw: raw, n: null, v: DASH, unit: '', tight: false, celsius: false, open: false, icon: String(a.icon || '') };
    var us = ((X.client && X.client.config) || {}).unit_system || {};
    var unit = String(a.unit_of_measurement || '');
    if (dom === 'climate') unit = String(us.temperature || '°F');
    if (!unit) unit = dc === 'temperature' ? String(us.temperature || '°F') : dc === 'humidity' || dc === 'battery' || (dc === 'moisture' && dom === 'sensor') ? '%' : '';
    var deg = /^°[CF]?$/.test(unit);
    i.celsius = deg && /C/.test(unit);
    i.unit = deg ? '°' : unit;
    i.tight = i.unit === '°' || i.unit === '%';
    if (!i.ok) return i;

    // a number: a sensor, input_number or number's state; a climate's current temperature; a cover's position part way
    var pos = null;
    if (dom === 'climate') i.n = num(a.current_temperature);
    else if (dom === 'cover') { pos = num(a.current_position); if (pos != null && pos > 0 && pos < 100) { i.n = Math.round(pos); i.unit = '%'; i.tight = true; } }
    else if ((dom === 'sensor' || dom === 'input_number' || dom === 'number') && dc !== 'timestamp' && dc !== 'date' && dc !== 'enum') i.n = num(raw);
    if (i.n != null) {
      var prec = num(a.suggested_display_precision);
      i.v = numText(i.n, prec, i.tight);
      return i;
    }
    i.unit = ''; i.tight = false;

    // words
    if (dom === 'binary_sensor') {
      var w = has(BIN, dc) ? BIN[dc] : ['Off', 'On'];
      i.v = raw === 'on' ? w[1] : raw === 'off' ? w[0] : titled(raw);
      i.open = raw === 'on' && dc === 'lock';
    } else if (dom === 'switch' || dom === 'input_boolean') {
      i.v = raw === 'on' ? 'On' : raw === 'off' ? 'Off' : titled(raw);
    } else if (dom === 'device_tracker') {
      i.v = raw === 'home' ? 'Home' : raw === 'not_home' ? 'Away' : titled(raw);
    } else if (dom === 'lock') {
      i.v = titled(raw);
      i.open = raw !== 'locked';
    } else if (dom === 'sensor' && (dc === 'timestamp' || dc === 'date')) {
      i.v = instant(raw, dc, X) || titled(raw);
    } else {
      i.v = titled(raw);
    }
    return i;
  }
  // the figure and its unit as one string: "78°", "45%", "2.1 kW", "Open"
  function fullText(i) { return !i.ok ? DASH : i.unit ? (i.tight ? i.v + i.unit : i.v + ' ' + i.unit) : i.v; }

  // ------------------------------------------------------------ the glyph
  var LINE = ' fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
  var GLYPH = {
    thermo: '<path d="M9.8 4.4a2.2 2.2 0 0 1 4.4 0v7.1a4.6 4.6 0 1 1-4.4 0z"/>',
    drop: '<path d="M12 3c3.4 4.2 5.8 7.2 5.8 10.2a5.8 5.8 0 0 1-11.6 0C6.2 10.2 8.6 7.2 12 3z"/>',
    battery: '<path fill-rule="evenodd" d="M5.4 6.8h10.6a2.2 2.2 0 0 1 2.2 2.2v6a2.2 2.2 0 0 1-2.2 2.2H5.4A2.2 2.2 0 0 1 3.2 15V9a2.2 2.2 0 0 1 2.2-2.2zm.2 1.8a.6.6 0 0 0-.6.6v5.6c0 .3.3.6.6.6h10.2c.3 0 .6-.3.6-.6V9.2a.6.6 0 0 0-.6-.6z"/>' +
      '<path d="M6.4 10h5.6v4.4H6.4zM19.2 10.6h.6a.9.9 0 0 1 .9.9v1a.9.9 0 0 1-.9.9h-.6z"/>',
    bolt: '<path d="M13.4 2.6L5.4 13.4h5.3l-1 8 8-10.8h-5.3z"/>',
    door: '<path fill-rule="evenodd" d="M6.4 19.8V4.4a1.6 1.6 0 0 1 1.6-1.6h8a1.6 1.6 0 0 1 1.6 1.6v15.4h1.6a.8.8 0 0 1 0 1.6H4.8a.8.8 0 0 1 0-1.6zM14.2 10.8a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>',
    window: '<path fill-rule="evenodd" d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5zM5.3 5.3h5.9v5.9H5.3zM12.8 5.3h5.9v5.9h-5.9zM5.3 12.8h5.9v5.9H5.3zM12.8 12.8h5.9v5.9h-5.9z"/>',
    garage: '<path fill-rule="evenodd" d="M12 3.2L2.6 9.4v11.4h18.8V9.4zM6 12.2h12v8.6H6zM7.2 13.6h9.6v1.4H7.2zM7.2 16.2h9.6v1.4H7.2zM7.2 18.8h9.6v1.4H7.2z"/>',
    motion: '<circle cx="7.4" cy="12" r="2.4"/><path d="M12.4 8a5.6 5.6 0 0 1 0 8M16.2 5a10 10 0 0 1 0 14"' + LINE + ' stroke-width="2"/>',
    mail: '<rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2.4"' + LINE + ' stroke-width="1.8"/><path d="M4 7.6l8 6 8-6"' + LINE + ' stroke-width="1.8"/>'
  };
  // (the lock's body and shackle are the renderer's own lock glyph: its shackle lifted when not shut)
  function lockGlyph(open) {
    return '<path d="M6 10h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/>' +
      '<path d="' + (open ? 'M8 10V7a4 4 0 0 1 7.6-1.7' : 'M8 10V7a4 4 0 0 1 8 0v3') + '"' + LINE + ' stroke-width="2.2"/>';
  }
  function glyph(key, open) {
    if (!key || key === 'dot') return '<i class="dot a"></i>';
    var g = key === 'lock' ? lockGlyph(open) : GLYPH[key];
    return g ? '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' + g + '</svg>' : '<i class="dot a"></i>';
  }
  // an mdi icon name's words -> a glyph (whole words of the name: a mailbox icon's name has "mailbox"; a block icon's has no "lock")
  function words(list) { return new RegExp('(?:^|-)(?:' + list + ')(?:-|$)'); }
  var ICONS = [
    [words('thermometer|temperature|thermostat'), 'thermo'], [words('water|humidity|drop|raindrop'), 'drop'], [words('battery'), 'battery'],
    [words('flash|lightning|power|current|sine|solar'), 'bolt'], [words('garage'), 'garage'], [words('window'), 'window'],
    [words('door|gate'), 'door'], [words('motion|walk|run|radar'), 'motion'], [words('lock'), 'lock'], [words('mailbox|mail|email|envelope'), 'mail']
  ];
  var BY_CLASS = {
    temperature: 'thermo', cold: 'thermo', heat: 'thermo', humidity: 'drop', moisture: 'drop', battery: 'battery', battery_charging: 'battery',
    power: 'bolt', energy: 'bolt', current: 'bolt', voltage: 'bolt', apparent_power: 'bolt', reactive_power: 'bolt', power_factor: 'bolt', plug: 'bolt',
    door: 'door', opening: 'door', gate: 'door', garage_door: 'garage', garage: 'garage', window: 'window',
    motion: 'motion', occupancy: 'motion', presence: 'motion', moving: 'motion', lock: 'lock'
  };
  function glyphKey(i) {
    var ic = i.icon.toLowerCase();
    if (ic.indexOf('mdi:') === 0) {
      var name = ic.slice(4);
      for (var k = 0; k < ICONS.length; k++) if (ICONS[k][0].test(name)) return ICONS[k][1];
    }
    if (has(BY_CLASS, i.dc)) return BY_CLASS[i.dc];
    if (i.dom === 'lock') return 'lock';
    if (i.dom === 'climate') return 'thermo';
    if (i.dom === 'cover') return 'window';
    if (/^°/.test(i.unit)) return 'thermo';
    return 'dot';
  }

  // ------------------------------------------------------------ the color, by device class
  // a battery runs red when low, through orange and yellow, to green
  var BAT = [[10, RED[0], RED[1]], [25, ORANGE[0], ORANGE[1]], [45, YELLOW[0], YELLOW[1]], [70, GREEN[0], GREEN[1]]];
  var ALERTS = { smoke: 1, gas: 1, carbon_monoxide: 1, moisture: 1, problem: 1, safety: 1, tamper: 1 };
  var SHUT = { door: 1, window: 1, garage_door: 1, opening: 1, lock: 1 };
  var POWERS = { power: 1, energy: 1, current: 1, voltage: 1, apparent_power: 1, reactive_power: 1, power_factor: 1 };
  var COVERS = { door: 1, garage: 1, gate: 1, window: 1 };
  // -> a [light, dark] pair, or null (the screen's ink)
  function accentOf(i) {
    if (!i.ok) return null;
    var dc = i.dc, on = i.raw === 'on';
    if (i.dom === 'lock') return i.raw === 'locked' ? GREEN : i.raw === 'jammed' ? RED : AMBER;
    if (i.dom === 'cover') return has(COVERS, dc) ? (i.raw === 'closed' ? GREEN : AMBER) : null;
    if (i.dom === 'binary_sensor') {
      if (has(SHUT, dc)) return on ? AMBER : GREEN;
      if (has(ALERTS, dc)) return on ? RED : null;
      if (dc === 'battery') return on ? RED : GREEN;
      if (dc === 'power') return AMBER;
      return null;
    }
    if (i.n == null) return null;
    if (dc === 'temperature' || (!dc && /^°/.test(i.unit)) || i.dom === 'climate') return _.tempAcc(Math.round(i.celsius ? i.n * 9 / 5 + 32 : i.n));
    if (dc === 'battery') return _.ramp(BAT, i.n);
    if (has(POWERS, dc)) return AMBER;
    return null;
  }

  // ------------------------------------------------------------ the ring's ends
  // temperature 32 to 100 °F or 0 to 40 °C, a percent 0 to 100, an input_number or number its own min and max, a thermostat its own
  // range; else 0 to 100. opts.min and opts.max (words that are numbers) win where they make a range
  function defaultRange(i, X) {
    var a = (X.st[i.id] && X.st[i.id].attributes) || {};
    var lo = null, hi = null;
    if (i.dom === 'climate') { lo = num(a.min_temp); hi = num(a.max_temp); }
    else if (i.dom === 'input_number' || i.dom === 'number') { lo = num(a.min); hi = num(a.max); }
    if (lo != null && hi != null && hi > lo) return [lo, hi];
    if (i.dc === 'temperature' || i.dom === 'climate' || (!i.dc && /^°/.test(i.unit))) return i.celsius ? [0, 40] : [32, 100];
    return [0, 100];
  }
  function rangeOf(i, X) {
    var d = defaultRange(i, X), lo = num(String(X.opts.min == null ? '' : X.opts.min).trim()), hi = num(String(X.opts.max == null ? '' : X.opts.max).trim());
    if (lo == null) lo = d[0];
    if (hi == null) hi = d[1];
    return hi > lo ? [lo, hi] : d;
  }

  // ------------------------------------------------------------ SENSOR
  function entityOf(X, key) { var id = X.opts && X.opts[key]; return typeof id === 'string' ? id : ''; }
  var TEMP78 = _.tempAcc(78);

  W.define('sensor', {
    name: 'Any Sensor', group: GROUP, wave: 'C', facts: ['sensor'], source: 'any entity the screen may read', when: null,
    wakes: ['house'], pick: null, off: false,
    opts: { entity: DOMAINS, entity2: DOMAINS, name: 'text', min: 'text', max: 'text' }, defaults: { entity: '', entity2: '', name: '', min: '', max: '' },
    accent: function (s) { return s.a || null; },
    shapes: {
      inline: {
        // "Pool 78°", "Mailbox Open", "Front Door Locked": the glyph, the name, the state with its unit
        read: function (X) {
          var id = entityOf(X, 'entity');
          if (!id) return { text: DASH };
          var i = infoOf(X, id, X.opts.name);
          return { text: short(i.name, 22) + ' ' + short(fullText(i), 24), gl: glyphKey(i), open: i.open ? 1 : 0, a: accentOf(i) };
        },
        draw: function (s) { return inl(s.gl ? glyph(s.gl, s.open) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Pool 78°', gl: 'thermo', open: 0, a: TEMP78 }
      },
      circular: {
        // a number ringed between min and max, its name under it; words stand in the ring with the track alone
        read: function (X) {
          var id = entityOf(X, 'entity');
          if (!id) return { main: DASH, sub: 'SENSOR', frac: null, a: null };
          var i = infoOf(X, id, X.opts.name), nm = tag(i.name);
          if (!i.ok) return { main: DASH, sub: nm, frac: null, a: null };
          if (i.n == null) return { main: cut(i.v, 9), sub: nm, frac: null, a: accentOf(i) };
          var r = rangeOf(i, X), frac = r200(clamp((i.n - r[0]) / (r[1] - r[0]), 0, 1));
          // (the unit stays with the figure while the two fit a ring's figure -- "78°", "45%", "230W" -- else it goes under it)
          if (!i.unit || i.tight || (i.v + i.unit).length <= 4) return { main: i.v + i.unit, sub: nm, frac: frac, a: accentOf(i) };
          return { main: i.v, sub: cut(i.unit, 8), frac: frac, a: accentOf(i) };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: s.sub }); },
        sample: { main: '78°', sub: 'POOL', frac: 0.68, a: TEMP78 }
      },
      rectangular: {
        // the two sensors: a name at the left, a state at the right (the World Clock's rows)
        read: function (X) {
          var ids = [entityOf(X, 'entity'), entityOf(X, 'entity2')], rows = [];
          ids.forEach(function (id, k) {
            if (!id) return;
            var i = infoOf(X, id, k === 0 ? X.opts.name : ''), ok = i.ok;
            rows.push({ n: i.name, v: ok ? i.v : DASH, u: ok ? i.unit : '', t: ok && i.tight ? 1 : 0, a: accentOf(i) });
          });
          return { rows: rows.length ? rows : [{ n: 'Sensor', v: DASH, u: '', t: 0, a: null }] };
        },
        draw: function (s) {
          return '<div class="sxc">' + s.rows.map(function (r) {
            return '<div class="sxr"><div class="sxn">' + esc(r.n) + '</div><div class="sxv a"' + accStyle(r.a) + '>' + esc(r.v) +
              (r.u ? (r.t ? esc(r.u) : '<small>' + esc(r.u) + '</small>') : '') + '</div></div>';
          }).join('') + '</div>';
        },
        sample: { rows: [{ n: 'Pool', v: '78', u: '°', t: 1, a: TEMP78 }, { n: 'Front Door', v: 'Locked', u: '', t: 0, a: GREEN }] }
      }
    }
  });

  // (for the tests, and a caller that wants the piece's reading)
  W._.sensor = { info: infoOf, text: fullText, glyphKey: glyphKey, accentOf: accentOf, tag: tag, numText: numText, CSS: CSS };
})();
