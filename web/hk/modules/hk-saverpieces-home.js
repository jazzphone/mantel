// hk-saverpieces-home.js -- THE SCREENSAVER'S HOME PIECES (2026-11-02, phase 13, phase 1b, wave B:
// docs/phase13/GLANCE-SPEC.md, "Home"): security, doors, garage, climate, lights, vacuum, notify and package. One group, one
// file, loaded after hk-saverwidgets.js, which draws them: each piece is declared once (the plan's rule 1) with
// hkSaverWidgets.define() and drawn with the renderer's own classes and helpers (ring, inl, lines, ...), so it looks like the
// core pieces in every backdrop, ink and size. The few rules this group adds go through hkSaverWidgets.addCss, in `--u`, on
// the spacing scale (.4 .8 1.2 1.6 2.4 3.2).
//
// WHERE EACH READS (the survey, side-session-notes/phase13-glance-data-sources.md, items 4 to 7 and 13):
//   security  the alarm panel Status & Chips names (hkHeader.lists().alarm), else the first alarm_control_panel
//   doors     hkHeader.lists() doors and windows: the ones that are open ('on', as hkHeader.status() counts them) and their names
//   garage    hkHeader.lists().garage: open, opening and closing all count as not shut (a door halfway up is not "closed")
//   climate   Settings' features.thermostats (else every climate): current_temperature, temperature, hvac_action
//   lights    kinds.lights (else every light, as the Lights chip finds them) with state `on`
//   vacuum    kinds.vacuums (else every vacuum): its state; the battery, current room and error are SENSORS ON THE SAME DEVICE
//             (hk-sheet-vacuum.js deviceSensor(): the vacuum entity carries no battery_level), found by the registry
//   notify    a small shared store, below, fed by the window event `hk-house-event` (type notification) from the moment this
//             file loads; the last ten, with the time each arrived
//   package   the same events, kind package: shown for four hours after one
//
// THE RULES (SCREENSAVER-UNIFIED.md, "The rules every piece follows"): nothing animates and nothing blurs; one read per source,
// shared (the store; the vacuum's sensors found once per vacuum); a read never wakes a read (0.1.104) -- an arriving
// notification schedules ONE wake a moment later, coalesced, through the renderer's shared watcher list; data that is not there is a
// dash, never "closed" or "off" (the server hides what the wall tablet's role can't read: absent is the signal), and the
// "shows when..." pieces hide instead.
//
// THE DRAWING (PIECES-SPEC.md, "Spacing and alignment"): every circle has the renderer's ring track (7.5 wide, radius 43) and
// its label on the baseline 72, so the row's circles are one size; a glyph sits over the label, centered with it; figures
// are centered by their caps (ring()); nothing sits closer than 1.6 u to a backdrop's edge.
(function () {
  'use strict';
  var W = window.hkSaverWidgets;
  if (!W || !W.define || !W._) return;
  if (W._.home) return;                                         // loaded twice

  var H = W._;
  var esc = H.esc, num = H.num, clamp = H.clamp, cut = H.cut, deg = H.deg, tm = H.tm, ring = H.ring, inl = H.inl, lines = H.lines,
      DASH = H.DASH, DOT = H.DOT, ACC = H.ACC;
  var GROUP = 'Home';
  var HOUR = 3600000;

  // ------------------------------------------------------------ the look this group adds
  // Two rows of a rectangular piece (climate's zones, the notifications): 4.6 u each with .4 u between, so 1.7 u of the 13 u is
  // above and below them. A dot, the name (or title) taking what room there is, and the figure (or time) at the right.
  var CSS = [
    '.hksw .hm-rows{flex:1;min-width:0;display:flex;flex-direction:column;gap:calc(var(--u) * .4)}',
    '.hksw .hm-row{display:flex;align-items:center;gap:calc(var(--u) * 1.2);min-width:0;height:calc(var(--u) * 4.6);font-size:calc(var(--u) * 2.2);line-height:1.2}',
    '.hksw .hm-row .dot{margin-right:0}',
    '.hksw .hm-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:700}',
    '.hksw .hm-v{flex:none;font-size:calc(var(--u) * 2);font-weight:600;opacity:.85}'
  ].join('\n');
  if (W.addCss) W.addCss(CSS);

  // ------------------------------------------------------------ accents ([light ink, dark ink] pairs)
  var SLATE = ['#a9bdd6', '#56708f'];                           // disarmed: a gray-blue
  var BLUE = ['#7cc8ff', '#1f78b8'];                            // cooling, and a notification
  var TEAL = ['#6fd6cf', '#1b8a85'];                            // the vacuum
  var BULB = ['#ffd84d', '#b08600'];                            // lights: a warm yellow

  // ------------------------------------------------------------ small helpers
  function r200(v) { return Math.round(v * 200) / 200; }
  function usable(v) { return v !== undefined && v !== null && v !== 'unknown' && v !== 'unavailable' && v !== ''; }
  function stOf(X, id) { return id && X.st && X.st[id] ? X.st[id] : null; }
  function nameOf(s, id) {
    var n = s && s.attributes && s.attributes.friendly_name;
    if (n) return String(n);
    return String(id || '').split('.').slice(1).join(' ').replace(/_/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) || DASH;
  }
  function setting(path, fb) {
    var HS = window.hkSettings;
    try { var v = HS && typeof HS.get === 'function' ? HS.get(path, fb) : fb; return v === undefined ? fb : v; } catch (e) { return fb; }
  }
  // a domain's entities: the states, and the registry for a page the host has narrowed to what it reads (the side pane's domainIds)
  function domainIds(X, dom) {
    var seen = {}, out = [];
    [X.st || {}, (X.client && X.client.entities) || {}].forEach(function (o) {
      Object.keys(o).forEach(function (k) { if (k.indexOf(dom + '.') === 0 && !seen[k]) { seen[k] = 1; out.push(k); } });
    });
    return out.sort();
  }
  // a Status & Chips kind's entities (the Lights chip's own rule): the chosen list where Settings has kinds, else every one of the
  // domain that is not hidden, a helper or a group
  function kindIds(X, kind, dom) {
    var k = setting('kinds', null);
    if (k && typeof k === 'object' && Object.keys(k).length) { var l = setting('kinds.' + kind, []); return Array.isArray(l) ? l : []; }
    var ents = (X.client && X.client.entities) || {};
    return domainIds(X, dom).filter(function (id) {
      var e = ents[id] || {}, a = (X.st[id] && X.st[id].attributes) || {};
      return !(e.hidden || e.entity_category || Array.isArray(a.entity_id));
    });
  }
  // the header's lists (alarm, locks, doors, windows, garage), or null where the header is not loaded
  function lists() {
    var Hd = window.hkHeader;
    try { return Hd && typeof Hd.lists === 'function' ? Hd.lists() || null : null; } catch (e) { return null; }
  }
  function ids(list) { return Array.isArray(list) ? list.filter(function (x, i) { return typeof x === 'string' && list.indexOf(x) === i; }) : []; }

  // ------------------------------------------------------------ glyphs (24 x 24, drawn with the line of the renderer's own)
  var LN = ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  // (a glyph in a line of words: the renderer's .il sizes it to 1.15 em)
  function gl(inner) { return '<svg class="a" viewBox="0 0 24 24" aria-hidden="true"' + LN + '>' + inner + '</svg>'; }
  // (a glyph over a circle's label: 24 units scaled 1.5 and centered on the ring's middle, its top at 24 and its bottom at 54, so it and
  // the label on 72 stand centered together; thinner lines than a line of words has, as it is drawn larger)
  function ringed(inner, label) {
    var n = String(label).length, fs = n <= 5 ? 14 : n <= 7 ? 12 : 11;
    return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="a" cx="50" cy="50" r="43" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="7.5"/>' +
      '<g class="a" transform="translate(32 21) scale(1.5)"' + LN.replace('stroke-width="2"', 'stroke-width="1.7"') + '>' + inner + '</g>' +
      '<text x="50" y="72" text-anchor="middle" font-weight="600" font-size="' + fs + '">' + esc(label) + '</text></svg>';
  }
  var FILL = ' fill="currentColor" stroke="none"';
  // THE SIREN LIGHT, not a shield (2026-11-09, the owner: "Apple uses like an Alarm Bell style Glyph" -- "The siren light"; the blocks draw
  // Apple's alarm-light, hkCards.alarmGlyph): the dome on its base; armed, it glows and gives off rays; the alarm going, it glows more;
  // disarmed, the dome alone, struck through, as Apple's alarm-light-off
  var DOME = 'M7.8 17.5v-4.8a4.2 4.2 0 0 1 8.4 0v4.8z';
  function shield(k) {
    var base = '<path d="M5.5 20.5h13M6.5 20.5v-3h11v3"/>';
    if (k === 'disarmed') return base + '<path d="' + DOME + '"/><path d="M4 4.5l16 16"/>';
    var rays = '<path d="M12 2.8v2.2M5.3 5.6l1.5 1.5M18.7 5.6l-1.5 1.5M2.8 11.8h2.2M19 11.8h2.2"/>';
    return base + '<path d="' + DOME + '" fill="currentColor" fill-opacity="' + (k === 'alarm' ? '.45' : '.25') + '"/>' + rays;
  }
  // the garage: a house's outline over the ground, the door in it shut (slats across) or up (the top slat alone)
  function garage(open) {
    return '<path d="M3.5 20.5V9.2L12 3.5l8.5 5.7v11.3M2.5 20.5h19"/><path d="' + (open ? 'M7 12.5h10' : 'M7 12.5h10M7 15.5h10M7 18.5h10') + '"/>';
  }
  var BELL = '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.7a2 2 0 0 0 4 0"/>';
  var BOX = '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5L12 12l8.5-4.5M12 12v9"/>';
  function bulb(on) {
    return '<path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2h5.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"' + (on ? ' fill="currentColor" fill-opacity=".9"' : '') + '/><path d="M9.8 19h4.4M10.6 21.4h2.8"/>';
  }
  var ROBOT = '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M16.6 5.6l.9 1.4"/>';
  var FLAME = '<path d="M12 2.8c.5 3.2 5.4 5.6 5.4 10.6a5.4 5.4 0 0 1-10.8 0c0-2.2 1-3.6 2.2-4.9.2 1.5.9 2.4 1.8 2.8C10.2 8.6 10.8 5.4 12 2.8z"/>';
  var FLAKE = '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>';
  var THERMO = '<path d="M10 13.4V5.2a2 2 0 0 1 4 0v8.2a4 4 0 1 1-4 0z"/><path d="M12 10v6"/>';

  // ------------------------------------------------------------ SECURITY: the alarm's state
  //   [words, the label in the circle, how it stands]
  var ALARM = {
    armed_home: ['Armed Home', 'HOME', 'armed'], armed_away: ['Armed Away', 'AWAY', 'armed'], armed_night: ['Armed Night', 'NIGHT', 'armed'],
    armed_vacation: ['Armed Vacation', 'VACATION', 'armed'], arming: ['Arming', 'ARMING', 'armed'], disarmed: ['Disarmed', 'DISARMED', 'disarmed'],
    disarming: ['Disarming', 'DISARM', 'disarmed'], pending: ['Pending', 'PENDING', 'alarm'], triggered: ['Triggered', 'ALARM', 'alarm']
  };
  // the alarm panel's state: the one Status & Chips names, else the first alarm_control_panel; null while it is not there
  function alarmOf(X) {
    var L = lists(), id = L && typeof L.alarm === 'string' && L.alarm ? L.alarm : null;
    if (!id) id = domainIds(X, 'alarm_control_panel')[0] || null;
    var s = stOf(X, id), v = s ? String(s.state) : '';
    return usable(v) && ALARM[v] ? ALARM[v] : null;
  }
  var SEC_ACC = { armed: ACC.green, disarmed: SLATE, alarm: ACC.red };
  W.define('security', {
    name: 'Security', group: GROUP, wave: 'B', facts: ['security'], source: 'hkHeader', when: null,
    wakes: ['house'], pick: null, off: false, opts: {}, accent: function (s) { return SEC_ACC[s.k] || null; },
    shapes: {
      inline: {
        read: function (X) { var a = alarmOf(X); return a ? { text: a[0], k: a[2], gl: 1 } : { text: DASH, k: '' }; },
        draw: function (s) { return inl(s.gl ? gl(shield(s.k)) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Armed Away', k: 'armed', gl: 1 }
      },
      circular: {
        read: function (X) { var a = alarmOf(X); return a ? { word: a[1], k: a[2] } : { word: '', k: '' }; },
        draw: function (s) { return s.word ? ringed(shield(s.k), s.word) : ring({ main: DASH }); },
        sample: { word: 'AWAY', k: 'armed' }
      }
    }
  });

  // ------------------------------------------------------------ DOORS AND WINDOWS: what is open
  //   -> null where the header's lists are not there or none of the sensors can be read; else { open: [names], n, total }
  function doorsOf(X) {
    var L = lists();
    if (!L) return null;
    var seen = {}, open = [], known = 0, unknown = 0;
    ids(L.doors).concat(ids(L.windows)).forEach(function (id) {
      if (seen[id]) return;
      seen[id] = 1;
      var s = stOf(X, id), v = s ? s.state : undefined;
      if (!usable(v)) { unknown++; return; }
      known++;
      if (v === 'on') open.push(nameOf(s, id));
    });
    return known ? { open: open, n: open.length, total: known, unknown: unknown } : null;
  }
  function openOnly(X) { return X.opts.when === 'open'; }
  function doorsAcc(s) { return s.n == null ? null : s.n ? ACC.amber : ACC.green; }
  W.define('doors', {
    name: 'Doors and Windows', group: GROUP, wave: 'B', facts: ['doors'], source: 'hkHeader', when: null,
    wakes: ['house'], pick: null, off: false, opts: { when: ['always', 'open'] }, defaults: { when: 'always' }, accent: doorsAcc,
    shapes: {
      inline: {
        read: function (X) {
          var d = doorsOf(X);
          // (nothing open and a sensor unreadable is not "all closed"; a "when open" piece hides rather than guess)
          if (openOnly(X) && !(d && d.n)) return { off: true, text: '', n: null };
          if (!d || (!d.n && d.unknown)) return { text: DASH, n: null };
          return { text: d.n ? d.n + ' open' : 'All closed', n: d.n, gl: 1 };
        },
        draw: function (s) { return inl(s.gl ? '<i class="dot a"></i>' : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: '2 open', n: 2, gl: 1 }
      },
      circular: {
        // how many are open, the ring a fraction of all the sensors
        read: function (X) {
          var d = doorsOf(X);
          if (openOnly(X) && !(d && d.n)) return { off: true, main: DASH, n: null, frac: null };
          if (!d || (!d.n && d.unknown)) return { main: DASH, n: null, frac: null };
          return { main: String(d.n), n: d.n, frac: d.n ? r200(clamp(d.n / d.total, 0, 1)) : null };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: 'OPEN' }); },
        sample: { main: '2', n: 2, frac: 0.25 }
      },
      rectangular: {
        // OPEN, then the first two names (the second with how many more)
        read: function (X) {
          var d = doorsOf(X);
          if (openOnly(X) && !(d && d.n)) return { off: true, l1: 'Open', l2: '', l3: '', n: null };
          if (!d || (!d.n && d.unknown)) return { l1: 'Open', l2: DASH, l3: '', n: null };
          if (!d.n) return { l1: 'Open', l2: 'All closed', l3: '', n: 0 };
          return { l1: 'Open', l2: cut(d.open[0], 24), l3: d.n > 1 ? cut(d.open[1], d.n > 2 ? 20 : 24) + (d.n > 2 ? ' +' + (d.n - 2) : '') : '', n: d.n };
        },
        draw: function (s) { return lines(s.l1, s.l2, s.l3, s.n != null); },
        sample: { l1: 'Open', l2: 'Back Door', l3: 'Office Window', n: 2 }
      }
    }
  });

  // ------------------------------------------------------------ GARAGE
  //   -> null while no garage door can be read; else { open: n not shut, moving: 'opening' | 'closing' | '' (when one door moves), total }
  function garageOf(X) {
    var L = lists();
    if (!L) return null;
    var open = 0, known = 0, moving = '', unknown = 0;
    ids(L.garage).forEach(function (id) {
      var s = stOf(X, id), v = s ? s.state : undefined;
      if (!usable(v)) { unknown++; return; }
      known++;
      if (v === 'on' || v === 'open' || v === 'opening' || v === 'closing') { open++; moving = v === 'opening' || v === 'closing' ? v : ''; }
    });
    return known ? { open: open, moving: open === 1 ? moving : '', total: known, unknown: unknown } : null;
  }
  function garageSpec(X) {
    var g = garageOf(X);
    if (openOnly(X) && !(g && g.open)) return { off: true };
    if (!g || (!g.open && g.unknown)) return null;                // (a door that can't be read is not a shut one)
    return g;
  }
  function garageWords(g) {
    if (g.open > 1) return g.open + ' garage doors open';
    return g.open ? 'Garage ' + (g.moving || 'open') : 'Garage closed';
  }
  W.define('garage', {
    name: 'Garage', group: GROUP, wave: 'B', facts: ['garage'], source: 'hkHeader', when: null,
    wakes: ['house'], pick: null, off: false, opts: { when: ['always', 'open'] }, defaults: { when: 'always' },
    accent: function (s) { return s.k == null ? null : s.k ? ACC.amber : ACC.green; },
    shapes: {
      inline: {
        read: function (X) {
          var g = garageSpec(X);
          if (g && g.off) return { off: true, text: '', k: null };
          return g ? { text: garageWords(g), k: g.open ? 1 : 0, gl: 1 } : { text: DASH, k: null };
        },
        draw: function (s) { return inl(s.gl ? gl(garage(!!s.k)) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Garage open', k: 1, gl: 1 }
      },
      circular: {
        read: function (X) {
          var g = garageSpec(X);
          if (g && g.off) return { off: true, k: null, word: '' };
          return g ? { k: g.open ? 1 : 0, word: g.open ? 'OPEN' : 'CLOSED' } : { k: null, word: '' };
        },
        draw: function (s) { return s.word ? ringed(garage(!!s.k), s.word) : ring({ main: DASH }); },
        sample: { k: 1, word: 'OPEN' }
      }
    }
  });

  // ------------------------------------------------------------ CLIMATE
  //   the thermostats that answer, each { name, cur, tgt, kind ('heat' | 'cool' | ''), min, max }
  function zonesOf(X) {
    var list = setting('features.thermostats', []);
    if (!Array.isArray(list) || !list.length) list = domainIds(X, 'climate');
    var out = [];
    list.forEach(function (id) {
      var s = stOf(X, id);
      if (!s || !usable(s.state)) return;
      var a = s.attributes || {}, act = String(a.hvac_action || '').toLowerCase();
      var kind = act === 'heating' || act === 'preheating' ? 'heat' : act === 'cooling' || act === 'precooling' ? 'cool' : '';
      var tgt = num(a.temperature);
      // (heat/cool thermostats set a range: the side it is working toward)
      if (tgt == null) tgt = kind === 'heat' ? num(a.target_temp_low) : kind === 'cool' ? num(a.target_temp_high) : null;
      out.push({ name: nameOf(s, id), cur: num(a.current_temperature), tgt: tgt, kind: kind, min: num(a.min_temp), max: num(a.max_temp) });
    });
    return out;
  }
  // the one the single-figure shapes follow: the first at work, else the first with a reading
  function primaryZone(zs) {
    return zs.filter(function (z) { return z.kind; })[0] || zs.filter(function (z) { return z.cur != null; })[0] || zs[0] || null;
  }
  function celsius(X) { var us = ((X.client && X.client.config) || {}).unit_system || {}; return /C/.test(String(us.temperature || '')); }
  // the gauge's scale: the thermostat's own range, else 45 to 95 F (7 to 35 C)
  function span(X, z) {
    var c = celsius(X), lo = z.min != null ? z.min : c ? 7 : 45, hi = z.max != null ? z.max : c ? 35 : 95;
    return hi > lo ? [lo, hi] : c ? [7, 35] : [45, 95];
  }
  function climAcc(s) { return s.kind === 'heat' ? ACC.orange : s.kind === 'cool' ? BLUE : null; }
  // the target as a notch across the gauge's track (the gauge opens at the bottom: 135 degrees to 405)
  function notch(f) {
    var a = (135 + 270 * clamp(f, 0, 1)) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return '<line class="a" x1="' + (50 + 35.6 * c).toFixed(2) + '" y1="' + (50 + 35.6 * s).toFixed(2) + '" x2="' + (50 + 48.2 * c).toFixed(2) + '" y2="' + (50 + 48.2 * s).toFixed(2) +
      '" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>';
  }
  W.define('climate', {
    name: 'Climate', group: GROUP, wave: 'B', facts: ['climate'], source: 'features.thermostats', when: null,
    wakes: ['minute', 'house'], pick: null, off: false, opts: {}, accent: climAcc,
    shapes: {
      inline: {
        read: function (X) {
          var z = primaryZone(zonesOf(X));
          if (!z || (z.cur == null && !z.kind)) return { text: DASH, kind: '' };
          var to = z.tgt != null ? ' to ' + deg(z.tgt) : '';
          if (z.kind === 'heat') return { text: 'Heating' + to, kind: 'heat', gl: 'heat' };
          if (z.kind === 'cool') return { text: 'Cooling' + to, kind: 'cool', gl: 'cool' };
          return { text: 'Inside ' + deg(z.cur), kind: '', gl: 'idle' };
        },
        draw: function (s) { return inl(s.gl ? gl(s.gl === 'heat' ? FLAME : s.gl === 'cool' ? FLAKE : THERMO) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Heating to 70°', kind: 'heat', gl: 'heat' }
      },
      circular: {
        // the inside temperature along the thermostat's range, the target as a notch across the track, "→ 70°" under it
        read: function (X) {
          var z = primaryZone(zonesOf(X));
          if (!z || z.cur == null) return { main: DASH, sub: '', frac: null, tgt: null, kind: z ? z.kind : '' };
          var sp = span(X, z);
          return { main: deg(z.cur), sub: z.tgt != null ? '→ ' + deg(z.tgt) : 'INSIDE', kind: z.kind,
                   frac: r200(clamp((z.cur - sp[0]) / (sp[1] - sp[0]), 0, 1)), tgt: z.tgt != null ? r200(clamp((z.tgt - sp[0]) / (sp[1] - sp[0]), 0, 1)) : null };
        },
        draw: function (s) {
          var svg = ring({ gauge: true, frac: s.frac, main: s.main, sub: s.sub || null });
          return s.tgt != null ? svg.replace(/<\/svg>$/, notch(s.tgt) + '</svg>') : svg;
        },
        sample: { main: '68°', sub: '→ 70°', kind: 'heat', frac: 0.46, tgt: 0.5 }
      },
      rectangular: {
        // two zones, each its name and "68° → 70°"; one zone, the three lines
        read: function (X) {
          var zs = zonesOf(X).filter(function (z) { return z.cur != null || z.kind; });
          var row = function (z) { return { name: cut(z.name, 22), v: (z.cur == null ? DASH : deg(z.cur)) + (z.tgt != null ? ' → ' + deg(z.tgt) : ''), kind: z.kind }; };
          if (!zs.length) return { rows: [], kind: '' };
          // (the ones at work first, so two zones show what is happening)
          zs = zs.filter(function (z) { return z.kind; }).concat(zs.filter(function (z) { return !z.kind; })).slice(0, 2);
          var rows = zs.map(row);
          return { rows: rows, kind: zs[0].kind, one: zs.length === 1 ? { act: zs[0].kind === 'heat' ? 'Heating' : zs[0].kind === 'cool' ? 'Cooling' : 'Idle' } : null };
        },
        draw: function (s) {
          if (!s.rows.length) return lines('Climate', DASH, '');
          if (s.rows.length === 1) return lines(s.rows[0].name, s.rows[0].v, s.one.act, !!s.kind);
          return '<div class="hm-rows">' + s.rows.map(function (r) {
            return '<div class="hm-row"' + H.accStyle(r.kind === 'heat' ? ACC.orange : r.kind === 'cool' ? BLUE : null) + '><i class="dot a"></i><div class="hm-n">' + esc(r.name) + '</div><div class="hm-v">' + esc(r.v) + '</div></div>';
          }).join('') + '</div>';
        },
        sample: { rows: [{ name: 'Upstairs', v: '68° → 70°', kind: 'heat' }, { name: 'Downstairs', v: '71° → 72°', kind: '' }], kind: 'heat', one: null }
      }
    }
  });

  // ------------------------------------------------------------ LIGHTS ON
  //   -> null while none can be read; else { on, total }
  function lightsOf(X) {
    var on = 0, total = 0;
    kindIds(X, 'lights', 'light').forEach(function (id) {
      var s = stOf(X, id);
      if (!s || !usable(s.state)) return;
      total++;
      if (s.state === 'on') on++;
    });
    return total ? { on: on, total: total } : null;
  }
  W.define('lights', {
    name: 'Lights On', group: GROUP, wave: 'B', facts: ['lights'], source: 'kinds.lights', when: null,
    wakes: ['house'], pick: null, off: false, opts: {}, accent: function (s) { return s.on == null ? null : BULB; },
    shapes: {
      inline: {
        read: function (X) {
          var l = lightsOf(X);
          if (!l) return { text: DASH, on: null };
          return { text: l.on ? l.on + (l.on === 1 ? ' light on' : ' lights on') : 'All lights off', on: l.on, gl: 1 };
        },
        draw: function (s) { return inl(s.gl ? gl(bulb(s.on > 0)) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: '6 lights on', on: 6, gl: 1 }
      },
      circular: {
        read: function (X) {
          var l = lightsOf(X);
          return l ? { main: String(l.on), on: l.on, frac: r200(clamp(l.on / l.total, 0, 1)) } : { main: DASH, on: null, frac: null };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: 'LIGHTS' }); },
        sample: { main: '6', on: 6, frac: 0.3 }
      }
    }
  });

  // ------------------------------------------------------------ VACUUM: while it cleans, returns or is stuck
  var VAC_OK = ['no_error', 'none', 'ok', 'unknown', 'unavailable', ''];
  // the sensors on the vacuum's device (hk-sheet-vacuum.js deviceSensor(): the registry says which device each entity is on)
  function deviceSensor(X, id, test) {
    var ents = X.client && X.client.entities, me = ents && ents[id];
    if (!me || !me.device_id) return null;
    var hit = null;
    Object.keys(ents).some(function (k) {
      if (k.indexOf('sensor.') !== 0 || !ents[k] || ents[k].device_id !== me.device_id) return false;
      if (test(k, X.st[k])) { hit = k; return true; }
      return false;
    });
    return hit;
  }
  // (found once per vacuum while the registry is the same one: the scan is of every entity in the house)
  var VP = { ents: null, by: {} };
  function vacuumParts(X, id) {
    var ents = (X.client && X.client.entities) || null;
    if (VP.ents !== ents) { VP.ents = ents; VP.by = {}; }
    if (VP.by[id]) return VP.by[id];
    var oid = id.split('.').slice(1).join('.'), has = function (k) { return !!(X.st && X.st[k]); };
    var p = {
      battery: deviceSensor(X, id, function (k, s) { return !!(s && s.attributes && s.attributes.device_class === 'battery'); }),
      room: deviceSensor(X, id, function (k) { return /current_room$/.test(k); }),
      error: deviceSensor(X, id, function (k) { return /(operational|vacuum)_error$/.test(k); })
    };
    // (no registry: the sensors named for the vacuum)
    if (!p.battery) p.battery = ['sensor.' + oid + '_battery', 'sensor.' + oid + '_battery_level'].filter(has)[0] || null;
    if (!p.room) p.room = ['sensor.' + oid + '_current_room'].filter(has)[0] || null;
    if (!p.error) p.error = ['sensor.' + oid + '_error', 'sensor.' + oid + '_vacuum_error'].filter(has)[0] || null;
    return ents ? (VP.by[id] = p) : p;
  }
  function vacuumState(X, k) { var s = k && X.st ? X.st[k] : null; return s ? s.state : undefined; }
  // the vacuum worth showing: stuck first, then cleaning, then on its way home; null while all are docked, idle or can't be read
  var VRANK = { error: 0, cleaning: 1, returning: 2 };
  function vacuumOf(X) {
    var best = null;
    kindIds(X, 'vacuums', 'vacuum').forEach(function (id) {
      var s = stOf(X, id), v = s ? String(s.state) : '';
      if (!usable(v) || VRANK[v] === undefined) return;
      var p = vacuumParts(X, id), err = vacuumState(X, p.error), k = v;
      // (a running robot that reports a fault is stuck, whatever its state says)
      if (usable(err) && VAC_OK.indexOf(String(err).toLowerCase()) < 0) k = 'error';
      if (best && VRANK[best.k] <= VRANK[k]) return;
      var a = s.attributes || {}, bat = num(vacuumState(X, p.battery));
      if (bat == null) bat = num(a.battery_level);
      var room = vacuumState(X, p.room);
      best = { k: k, bat: bat, room: usable(room) && ['none', 'no_room'].indexOf(String(room).toLowerCase()) < 0 ? String(room) : '' };
    });
    return best;
  }
  W.define('vacuum', {
    name: 'Vacuum', group: GROUP, wave: 'B', facts: ['vacuum'], source: 'kinds.vacuums', when: 'while it cleans',
    wakes: ['house'], pick: null, off: false, opts: {}, accent: function (s) { return s.k === 'error' ? ACC.red : TEAL; },
    shapes: {
      inline: {
        read: function (X) {
          var v = vacuumOf(X);
          if (!v) return { off: true, text: '', k: '' };
          var room = cut(v.room.replace(/^the\s+/i, ''), 20);
          return { text: v.k === 'error' ? 'Vacuum stuck' : v.k === 'returning' ? 'Returning to dock' : room ? 'Vacuuming the ' + room : 'Vacuuming', k: v.k, gl: 1 };
        },
        draw: function (s) { return inl(s.gl ? gl(ROBOT) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Vacuuming the Kitchen', k: 'cleaning', gl: 1 }
      },
      circular: {
        // its battery, whole ring; the label says what it is doing
        read: function (X) {
          var v = vacuumOf(X);
          if (!v) return { off: true, main: DASH, sub: 'VAC', k: '', frac: null };
          return { main: v.bat == null ? DASH : Math.round(v.bat) + '%', sub: v.k === 'error' ? 'STUCK' : v.k === 'returning' ? 'RETURN' : 'CLEAN', k: v.k,
                   frac: v.bat == null ? null : r200(clamp(v.bat / 100, 0, 1)) };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: s.sub }); },
        sample: { main: '78%', sub: 'CLEAN', k: 'cleaning', frac: 0.78 }
      }
    }
  });

  // ------------------------------------------------------------ THE STORE: the house's notifications as they arrive
  //   `hk-house-event`, detail.type 'notification' ({ id, kind, title, message, ts }): kept from the moment this file loads (the
  //   screensaver calls hkSaverWidgets._.home.reset() as it starts, so "since" is since then). The last ten, with when each arrived;
  //   `total` counts all of them. A package is the same event with kind 'package': when the last was seen is kept apart, because a
  //   package is still at the door when the screensaver starts again.
  var KEEP = 10, PKG_MS = 4 * HOUR;
  var NS = { items: [], total: 0, since: Date.now(), pkg: null, wakeT: null };
  function wakeAll() {
    // (after a moment, never inside a read: the renderer's shared watcher list draws each piece that listens again)
    var list = (H.cal && H.cal.watchers) || [];
    list.slice().forEach(function (f) { try { f(); } catch (e) { /* that piece is gone */ } });
  }
  function schedule() {
    if (NS.wakeT || typeof setTimeout !== 'function') return;
    NS.wakeT = setTimeout(function () { NS.wakeT = null; wakeAll(); }, 120);
  }
  function add(n) {
    if (!n || n.type !== 'notification') return false;
    var at = Date.now();
    if (n.id != null && NS.items.some(function (x) { return x.id != null && String(x.id) === String(n.id); })) return false;
    NS.items.unshift({ id: n.id == null ? null : n.id, kind: String(n.kind || ''), title: String(n.title || '').trim(), message: String(n.message || '').trim(), ts: num(n.ts), at: at });
    if (NS.items.length > KEEP) NS.items.length = KEEP;
    NS.total++;
    if (n.kind === 'package') NS.pkg = at;
    schedule();
    return true;
  }
  function reset() {
    NS.items = []; NS.total = 0; NS.since = Date.now();
    schedule();
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('hk-house-event', function (ev) { try { add(ev && ev.detail); } catch (e) { /* not ours */ } });
  }
  // a notification's words: its title, else its message
  function wordsOf(n) { return n.title || n.message || 'Notification'; }

  // ------------------------------------------------------------ NOTIFICATIONS
  W.define('notify', {
    name: 'Notifications', group: GROUP, wave: 'B', facts: ['notify'], source: 'hk-house-event', when: 'when one has arrived',
    wakes: ['minute', 'house', 'calendar'], pick: null, off: false, opts: {}, accent: BLUE,
    shapes: {
      inline: {
        read: function (X) {
          var n = NS.items[0];
          return n ? { text: cut(wordsOf(n), 40), gl: 1 } : { off: true, text: '' };
        },
        draw: function (s) { return inl(gl(BELL), s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Front Door: Package delivered', gl: 1 }
      },
      circular: {
        read: function (X) { return NS.total ? { main: NS.total > 99 ? '99+' : String(NS.total) } : { off: true, main: DASH }; },
        draw: function (s) { return ring({ main: s.main, sub: 'NEW' }); },
        sample: { main: '3' }
      },
      rectangular: {
        // the latest two titles, each with the time it arrived; one, its three lines
        read: function (X) {
          var two = NS.items.slice(0, 2);
          if (!two.length) return { off: true, rows: [] };
          return { rows: two.map(function (n) { return { t: cut(wordsOf(n), 32), at: tm(new Date(n.at), X.h24, true), m: cut(n.message && n.title ? n.message : '', 40) }; }), n: NS.total };
        },
        draw: function (s) {
          if (s.rows.length === 1) return lines('New · ' + s.rows[0].at, s.rows[0].t, s.rows[0].m, true);
          return '<div class="hm-rows">' + s.rows.map(function (r) {
            return '<div class="hm-row"><i class="dot a"></i><div class="hm-n">' + esc(r.t) + '</div><div class="hm-v">' + esc(r.at) + '</div></div>';
          }).join('') + '</div>';
        },
        sample: { rows: [{ t: 'Front Door', at: '7:38 PM', m: '' }, { t: 'Dryer finished', at: '7:12 PM', m: '' }], n: 2 }
      }
    }
  });

  // ------------------------------------------------------------ PACKAGE
  function packageHere(X) { return NS.pkg != null && +X.now - NS.pkg < PKG_MS; }
  W.define('package', {
    name: 'Package', group: GROUP, wave: 'B', facts: ['package'], source: 'hk-house-event', when: 'for four hours after one',
    wakes: ['minute', 'house', 'calendar'], pick: null, off: false, opts: {}, accent: ACC.amber,
    shapes: {
      inline: {
        read: function (X) { return packageHere(X) ? { text: 'Package at the door', gl: 1 } : { off: true, text: '' }; },
        draw: function (s) { return inl(gl(BOX), s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Package at the door', gl: 1 }
      },
      circular: {
        read: function (X) { return packageHere(X) ? { word: 'PACKAGE' } : { off: true, word: '' }; },
        draw: function (s) { return ringed(BOX, s.word || 'PACKAGE'); },
        sample: { word: 'PACKAGE' }
      }
    }
  });

  // what the session wires: _.home.reset() as the screensaver starts. The rest is for the tests and the editor.
  W._.home = {
    reset: reset, add: add, since: function () { return NS.since; },
    notes: function () { return NS.items.slice(); }, count: function () { return NS.total; }, packageAt: function () { return NS.pkg; }
  };
  window.hkSaverPiecesHome = true;
})();
