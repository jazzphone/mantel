// hk-saverpieces-energy.js -- THE SCREENSAVER'S ENERGY GLANCE PIECES (2026-11-02, phase 13, phase 1b, wave B:
// docs/phase13/GLANCE-SPEC.md, "Energy"): grid and ev. One group, one file, loaded after hk-saverwidgets.js, which draws them:
// each piece is declared once (the plan's rule 1) with hkSaverWidgets.define() and drawn with the renderer's own classes and
// helpers (ring, inl), so it looks like the core pieces in every backdrop, ink and size. This file keeps no CSS of its own.
// (hk-saver-energy.js, the Home Energy slide, is another file and untouched.)
//
// WHERE EACH READS (the survey, side-session-notes/phase13-glance-data-sources.md, items 9 and 13): the Power page's plan,
// `hkSettings.get('energy').power` (hk_core/energy/power.py, what hk-strategy.js powerView() hands the Power cards), and the
// live states the screensaver already holds. Nothing here asks for the Energy page's sums (hkEnergy.summary), so there is no
// waker and nothing that can wake a read: a read is the plan, a few states, and arithmetic.
//
//   grid  (inline, circular)   the plan's `grid` and `grid_export` read as hk-energy.js's Home Power card reads them (pw():
//         hkChart.power(states, id, { watts: true, fallback: null }), one panel reports W and kW side by side): the grid sensor
//         is import, or signed (negative: export); a `grid_export` sensor, where there is one, is export. Under 50 W is idle
//         (what a "0.0 kW" would round from); the page's own 5 W floor is for its flow lines. `grid_status` reading `off` is
//         the grid down (a missing, unknown or unavailable status is no answer, never "down").
//         inline "Exporting 2.1 kW" / "Importing 0.8 kW" / "Grid idle" / "Grid down"; circular the kW, EXPORT or IMPORT under it,
//         a gauge to 5 kW (10 above 5, 20 above 10). Green exporting, amber importing, red down.
//   ev    (inline, circular)   the plan's `cars[]` (level, charging) and carsCharging(), mirrored from hk-energy.js (its charging
//         is a wall charger's live watts, else the car's own reading or state, else plugged in at home; a car away is not the
//         house's). The car shown is the one charging, else the first with a charge. inline "Car 80%, charging" / "Car 80%"
//         (the plan's name for the car where it has one); circular the charge in a ring, CHARGING or the car's name under it.
//         Green; blue while charging.
//
// No plan, no `power` section, no sensor, no car: a dash (data that is not there is not "nothing wrong").
// THE RULES: nothing animates and nothing blurs; one read of the plan per piece, no timer, nothing that wakes anything.
(function () {
  'use strict';
  var W = window.hkSaverWidgets;
  if (!W || !W.define || !W._) return;
  if (window.hkSaverPiecesEnergy) return;                       // loaded twice

  var _ = W._, clamp = _.clamp, cut = _.cut, ring = _.ring, inl = _.inl, DASH = _.DASH, ACC = _.ACC;
  var BLUE = ['#64b5ff', '#1f6fc4'];                            // charging: a clear blue (light ink, black ink)
  var IDLE_W = 50;                                              // under this a "kW" reads 0.0

  // a name cut short, without a space left before the ellipsis
  function short(s, n) { return cut(s, n).replace(/\s+\u2026$/, '\u2026'); }
  function r200(v) { return Math.round(v * 200) / 200; }

  // ------------------------------------------------------------ the Power page's plan
  //   -> its `power` section, or null (no Energy plan, or the Power page off)
  function planOf() {
    var HS = window.hkSettings, p = null;
    try { p = HS && typeof HS.get === 'function' ? HS.get('energy', null) : null; } catch (e) { p = null; }
    var w = p && typeof p === 'object' ? p.power : null;
    return w && typeof w === 'object' ? w : null;
  }
  // POWER IS READ WITH ITS UNIT (hk-energy.js pw()): watts, or null
  function pw(st, id) {
    if (!id) return null;
    var C = window.hkChart;
    if (C && typeof C.power === 'function') return C.power(st, id, { watts: true, fallback: null });
    var s = st[id], n = s ? Number(s.state) : NaN;
    if (!isFinite(n)) return null;
    return /^kW$/i.test((s.attributes || {}).unit_of_measurement || '') ? n * 1000 : n;
  }
  function numOf(st, id) {
    var s = id && st[id], n = s ? Number(s.state) : NaN;
    return s && s.state !== '' && isFinite(n) ? n : null;
  }
  function isOn(st, id) { var s = id && st[id]; return !!s && s.state === 'on'; }
  // NO READING IS NOT AN ANSWER: a missing, unknown or unavailable state is null, never 'off' or 'away' (hk-energy.js reading())
  function reading(st, id) {
    var s = id && st[id];
    return s && s.state !== '' && s.state !== 'unknown' && s.state !== 'unavailable' ? s.state : null;
  }

  // ------------------------------------------------------------ GRID
  //   -> { kind: 'export' | 'import' | 'idle' | 'down', kw } | null (no plan, or no grid reading)
  function gridOf(X) {
    var P = planOf(), st = X.st || {};
    if (!P) return null;
    if (P.grid_status && reading(st, P.grid_status) === 'off') return { kind: 'down', kw: 0 };
    // (hk-energy.js, the Home Power card: the grid signed or in two sensors)
    var g = pw(st, P.grid), gx = pw(st, P.grid_export);
    if (g == null && gx == null) return null;
    var imp = g == null ? 0 : Math.max(0, g), exp = gx != null ? Math.max(0, gx) : g != null && g < 0 ? -g : 0;
    if (exp >= IDLE_W && exp >= imp) return { kind: 'export', kw: exp / 1000 };
    if (imp >= IDLE_W) return { kind: 'import', kw: imp / 1000 };
    return { kind: 'idle', kw: 0 };
  }
  // one decimal under 100 kW: 2.1, 0.8, 12.4
  function kwText(kw) { return (Math.round(kw * 10) / 10).toFixed(1); }
  // the gauge's end: 5 kW, 10 above 5, 20 above 10
  function gridTop(kw) { return kw > 10 ? 20 : kw > 5 ? 10 : 5; }
  var BOLT = '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M13.4 2.6L5.4 13.4h5.3l-1 8 8-10.8h-5.3z"/></svg>';

  W.define('grid', {
    name: 'Grid', group: 'Energy', wave: 'B', facts: ['grid'], source: 'hkSettings energy.power', when: null,
    wakes: ['house'], pick: null, off: false, opts: {},
    accent: function (s) { return s.kind === 'export' ? ACC.green : s.kind === 'import' ? ACC.amber : s.kind === 'down' ? ACC.red : null; },
    shapes: {
      inline: {
        read: function (X) {
          var g = gridOf(X);
          if (!g) return { text: DASH, kind: null };
          var text = g.kind === 'export' ? 'Exporting ' + kwText(g.kw) + ' kW' : g.kind === 'import' ? 'Importing ' + kwText(g.kw) + ' kW' :
            g.kind === 'down' ? 'Grid down' : 'Grid idle';
          return { text: text, kind: g.kind, gl: 1 };
        },
        draw: function (s) { return inl(s.gl ? BOLT : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Exporting 2.1 kW', kind: 'export', gl: 1 }
      },
      circular: {
        // the kW, EXPORT or IMPORT under it, in a gauge to 5 kW
        read: function (X) {
          var g = gridOf(X);
          if (!g) return { main: DASH, sub: 'GRID', frac: null, kind: null };
          if (g.kind === 'down') return { main: DASH, sub: 'DOWN', frac: null, kind: 'down' };
          if (g.kind === 'idle') return { main: '0', sub: 'IDLE', frac: null, kind: 'idle' };
          return { main: kwText(g.kw), sub: g.kind === 'export' ? 'EXPORT' : 'IMPORT', frac: r200(clamp(g.kw / gridTop(g.kw), 0, 1)), kind: g.kind };
        },
        draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, sub: s.sub }); },
        sample: { main: '2.1', sub: 'EXPORT', frac: 0.42, kind: 'export' }
      }
    }
  });

  // ------------------------------------------------------------ EV
  // carsCharging() of hk-energy.js, mirrored (it is the card file's own): who is charging, and at what -> [{car, w}]. A wall
  // charger's watts are live (on the house's network), and a car's own reading (its maker's cloud, minutes behind) only says WHICH
  // car: the ones whose reading or state says charging, else the ones plugged in at home. Without chargers, each car's own.
  function carHome(st, k) { var r = k.home ? reading(st, k.home) : null; return r == null || r === 'home'; }
  function carsCharging(st, c) {
    var all = (c.cars || []).filter(Boolean), atHome = function (k) { return carHome(st, k); };
    var own = function (k) { return Math.max(0, pw(st, k.power) || 0); };
    var fixed = all.filter(function (k) { return k.charger; }), taken = fixed.map(function (k) { return k.charger; });
    var out = fixed.filter(function (k) { return atHome(k) || k.charger !== k.power; })
      .map(function (k) { return { car: atHome(k) ? k : null, w: Math.max(0, pw(st, k.charger) || 0) }; })
      .filter(function (x) { return x.w > 5; });
    var cars = all.filter(function (k) { return !k.charger; });
    // (the wall chargers: the plan's own, else the Energy plan's charging devices that are chargers -- hk-strategy.js powerView())
    var CHG = /wall.?connector|charger|evse|wallbox/i, B = c.battery || {}, chargers = Array.isArray(c.chargers) ? c.chargers.slice() : [];
    if (!chargers.length) (c.sections || []).forEach(function (s) {
      (s.items || []).forEach(function (i) {
        if (i && i.power && (CHG.test(i.power) || CHG.test(i.name || '')) && i.power !== B.charge && i.power !== B.discharge) chargers.push(i.power);
      });
    });
    chargers = chargers.filter(function (id) { return id && taken.indexOf(id) < 0; });
    return out.concat(guess(cars, chargers));
    function guess(cars, chargers) {
      if (!chargers.length) return cars.filter(function (k) { return atHome(k) && own(k) > 5; }).map(function (k) { return { car: k, w: own(k) }; });
      var live = chargers.map(function (id) { return Math.max(0, pw(st, id) || 0); }).filter(function (w) { return w > 5; }).sort(function (a, b) { return b - a; });
      if (!live.length) return [];
      var home = cars.filter(atHome);
      var saysCharging = function (k) {
        var s = k.state && st[k.state];
        return own(k) > 5 || (s && /^charging$/i.test(s.state));
      };
      var cands = home.filter(saysCharging).sort(function (a, b) { return own(b) - own(a); });
      if (!cands.length) cands = home.filter(function (k) { return k.plugged && isOn(st, k.plugged); });
      if (!cands.length) cands = home;
      return live.map(function (w, i) { return { car: cands[i] || (cands.length === 1 ? null : cands[0]) || null, w: w }; });
    }
  }
  // the car to show, with its charge: the one charging (the most watts), else the first with a charge reading, else the first
  //   -> { name, level (0..100 or null), charging } | null (no plan or no car)
  function carOf(X) {
    var P = planOf(), st = X.st || {};
    if (!P) return null;
    var cars = (Array.isArray(P.cars) ? P.cars : []).filter(function (k) { return k && typeof k === 'object' && k.level; });
    if (!cars.length) return null;
    var live = carsCharging(st, P).filter(function (x) { return x.car && cars.indexOf(x.car) >= 0; }).sort(function (a, b) { return b.w - a.w; });
    var car = live.length ? live[0].car : null;
    if (!car) car = cars.filter(function (k) { return numOf(st, k.level) != null; })[0] || cars[0];
    var v = numOf(st, car.level);
    return { name: String(car.name || '').replace(/\s+/g, ' ').trim(), level: v == null ? null : clamp(Math.round(v), 0, 100), charging: live.length > 0 && live[0].car === car };
  }
  var CAR = '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path fill-rule="evenodd" d="M5.4 9.6l1.1-2.7A2.2 2.2 0 0 1 8.5 5.5h7a2.2 2.2 0 0 1 2 1.4l1.1 2.7A2.1 2.1 0 0 1 20.4 11.6v5.2a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1H7.1v1a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1v-5.2A2.1 2.1 0 0 1 5.4 9.6zM8.1 7.5l-.8 2.1h9.4l-.8-2.1zM7.6 12.05a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 1 0 0-2.3zM16.4 12.05a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 1 0 0-2.3z"/></svg>';

  W.define('ev', {
    name: 'EV', group: 'Energy', wave: 'B', facts: ['ev'], source: 'hkSettings energy.power cars', when: null,
    wakes: ['house'], pick: null, off: false, opts: {},
    accent: function (s) { return s.charging ? BLUE : s.level == null ? null : ACC.green; },
    shapes: {
      inline: {
        // "Car 80%, charging" / "Car 80%" (the plan's name for the car where it has one)
        read: function (X) {
          var c = carOf(X);
          if (!c || c.level == null) return { text: DASH, level: null, charging: false };
          return { text: short(c.name || 'Car', 16) + ' ' + c.level + '%' + (c.charging ? ', charging' : ''), level: c.level, charging: c.charging, gl: 1 };
        },
        draw: function (s) { return inl(s.gl ? CAR : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Car 80%, charging', level: 80, charging: true, gl: 1 }
      },
      circular: {
        // the charge in a ring, CHARGING or the car's name under it
        read: function (X) {
          var c = carOf(X), nm = c && c.name ? short(c.name.toUpperCase(), 8) : 'CAR';
          if (!c || c.level == null) return { main: DASH, sub: nm, frac: null, level: null, charging: false };
          return { main: c.level + '%', sub: c.charging ? 'CHARGING' : nm, frac: r200(c.level / 100), level: c.level, charging: c.charging };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: s.sub }); },
        sample: { main: '80%', sub: 'CHARGING', frac: 0.8, level: 80, charging: true }
      }
    }
  });

  window.hkSaverPiecesEnergy = true;
})();
