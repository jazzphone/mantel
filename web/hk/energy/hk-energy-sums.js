// hk-energy-sums.js - the Energy page's one state, its model and sums, and the words for a period.
//
// PART OF THE ENERGY CARDS (hk-energy.js). Not a card and not run on its own: it registers one
// function, which hk-energy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkEnergyParts = window.hkEnergyParts || {})['hk-energy-sums'] = function (K) {
    // =========================================================== THE ENERGY PAGE
    //
    // ONE PAGE, FOUR TABS: Now, Today, This Week, This Month
    //
    // POWER AND ENERGY ARE KEPT APART. Now reads POWER: the sensors' watts as
    // they change, and the last three hours from the recorder's five-minute
    // statistics. Today, This Week and This Month read ENERGY: the meters' kWh
    // from Home Assistant's long-term statistics -- the numbers its own Energy
    // dashboard shows, summed the way it sums them. Nothing here integrates
    // watts into kWh.
    //
    // THE SAME ACCOUNTING AS HOME ASSISTANT'S ENERGY DASHBOARD, so every figure
    // can be checked against it:
    //   the house used  = grid in - grid out + solar + battery out - battery in
    //   cost            = each source's cost statistic (stat_cost, or the cost
    //                     sensor energy/info names), less export compensation
    //   on a device     = the devices in HA's Energy settings, less any it marks
    //                     as inside another (included_in_stat)
    //   not on a device = the house used - on a device
    // A device HK adds by itself (an "extra") still has its tile, but is not
    // counted: HA's untracked figure does not count it either.
    //
    // ONE STATE FOR THE PAGE: window.hkEnergyPage. The tab and the lit section
    // are the page's, not a card's -- every card here, the section headings and
    // the tiles (hk-stat.js, `energy: true`) read them and are redrawn when
    // they change. The settings come from the feed (`energy`, the plan
    // features/energy/plan.py builds) and HA's own energy/get_prefs, so the
    // cards need no config of their own and work on any dashboard.
    var DAY = 864e5, HOUR = 36e5;
    var PERIODS = ['now', 'day', 'week', 'month'];
    var TAB_NAMES = { now: 'Now', day: 'Today', week: 'This Week', month: 'This Month' };
    // HK's palette by name (the Color settings' names), and each guessed
    // section's own color: its part of Where it went, and its tiles' lines
    var NAMED = { yellow: '#ffd60a', orange: '#ff9f0a', red: '#ff453a', pink: '#ff375f', purple: '#bf5af2',
                  blue: '#0a84ff', teal: '#40c8e0', mint: '#66d4cf', green: '#30d158', cyan: '#64d2ff', white: '#ffffff' };
    var SEC_COLOR = { hvac: '#5ac8fa', rooms: '#bf5af2', appliances: '#ff375f', outlets: '#ffd60a',
                      charging: '#30d158', other: '#64d2ff' };
    var SEC_CYCLE = ['#5ac8fa', '#bf5af2', '#ff375f', '#ffd60a', '#30d158', '#64d2ff', '#ff9f0a', '#66d4cf'];
    // THE RINGS' COLORS: Fitness's three, then the sun's and gas's
    var RING = { energy: '#ff9f0a', cost: '#30d158', water: '#64d2ff', solar: '#ffd60a', gas: '#ff6b3d' };
    var REST = 'rgba(255,255,255,0.28)';

    // A COLOR BY NAME IS HK'S, the same as on every tile (hk-base.js HUE)
    function colorOf(c, fallback) {
      if (!c) return fallback;
      var P = window.hkCards && window.hkCards.PALETTE && window.hkCards.PALETTE.chart, h = P && P[c];
      if (h && h.length === 3) return '#' + h.map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      return NAMED[c] || (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback);
    }
    function rgba(hex, a) {
      var n = parseInt(String(hex).slice(1), 16);
      if (!isFinite(n)) return hex;
      return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] || 0; return s; }
    function fx(v, d) {
      return (v || 0).toLocaleString(window.hkLocale.numTag(), { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    // a kWh figure at the precision its size deserves: 0.4, 33.0, 2,468
    function kwh(v) { return fx(v, Math.abs(v) >= 1000 ? 0 : 1); }
    function watts(w) {
      w = w || 0;
      return Math.abs(w) >= 1000 ? [fx(w / 1000, Math.abs(w) >= 10000 ? 1 : 2), 'kW'] : [fx(w, 0), 'W'];
    }
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    var EP = window.hkEnergyPage = window.hkEnergyPage || {
      period: null, back: 0, ws: 0, pick: null, ver: 0, cards: new Set(),
      prefs: null, info: null, prefsAt: 0, asking: false, cache: null
    };

    function plan() {
      var HS = window.hkSettings, p = HS && HS.get('energy', null);
      return p && typeof p === 'object' ? p : null;
    }
    // THE TAB. The plan's Opens On the first time, then whatever was chosen
    // last: going into a device's sheet and back keeps This Week.
    function period() {
      if (!EP.period) {
        var P = plan(), o = P && P.page && P.page.opens_on;
        EP.period = PERIODS.indexOf(o) >= 0 ? o : 'now';
      }
      return EP.period;
    }
    function wake() {
      EP.cards.forEach(function (c) {
        if (c.isConnected && c.redraw) c.redraw(); else EP.cards.delete(c);
      });
    }
    // A TAB OPENS ON THE PERIOD WE ARE IN; tapping the tab already open
    // brings a stepped-back week or month home
    function setPeriod(p) {
      if (PERIODS.indexOf(p) < 0 || (p === EP.period && !EP.back)) return;
      EP.period = p; EP.back = 0; EP.pick = null; EP.dayPick = null; EP.ver++; wake();
    }
    // STEPPING BACK through the weeks or months (‹ ›): half a year of weeks, a
    // year of months
    var MAX_BACK = { week: 26, month: 12 };
    function setBack(n) {
      var p = period(), cap = MAX_BACK[p] || 0;
      n = Math.max(0, Math.min(cap, n));
      if (n === (EP.back || 0)) return;
      EP.back = n; EP.dayPick = null; EP.ver++; wake();
    }
    // A SECTION LIT ON THE WHOLE PAGE (a part of Where it went, tapped);
    // tapping it again puts the page back
    function setPick(id) { EP.pick = EP.pick === id ? null : id; EP.ver++; wake(); }

    // HOME ASSISTANT'S ENERGY SETTINGS, once every ten minutes for the page.
    // energy/info is what names the cost sensors HA itself made for a source
    // priced by an entity or a number. Neither failing stops the page: without
    // them it is the plan's own meters.
    function prefs(client, card) {
      if (card) EP.cards.add(card);
      var fresh = EP.prefs && (Date.now() - EP.prefsAt) < 10 * 60e3;
      if (!fresh && !EP.asking && client && client.callWS) {
        EP.asking = true;
        Promise.all([
          client.callWS({ type: 'energy/get_prefs' }),
          client.callWS({ type: 'energy/info' }).catch(function () { return {}; })
        ]).then(function (r) {
          EP.prefs = r[0] || {}; EP.info = r[1] || {};
        }).catch(function (e) {
          console.warn('[hk-energy] energy/get_prefs failed; the page uses its plan alone', e);
          EP.prefs = EP.prefs || {}; EP.info = EP.info || {};
        }).then(function () {
          EP.prefsAt = Date.now(); EP.asking = false; EP.cache = null; EP.ver++; wake();
        });
      }
      return EP.prefs;
    }

    // EVERY METER BEHIND THE PAGE, BY WHAT IT IS (the newer source shape keeps
    // the meters on the grid source itself; the older one lists flow_from /
    // flow_to)
    function sourcesOf(pr, info) {
      var cs = (info && info.cost_sensors) || {};
      var out = { imp: [], exp: [], cost: [], comp: [], solar: [], into: [], out: [], battery: false,
                  water: { ids: [], cost: [] }, gas: { ids: [], cost: [] } };
      function costOf(stat, own) { return own || cs[stat] || null; }
      ((pr && pr.energy_sources) || []).forEach(function (s) {
        if (s.type === 'grid') {
          (s.flow_from && s.flow_from.length ? s.flow_from : [s]).forEach(function (f) {
            if (!f.stat_energy_from) return;
            out.imp.push(f.stat_energy_from);
            var c = costOf(f.stat_energy_from, f.stat_cost);
            if (c) out.cost.push(c);
          });
          (s.flow_to && s.flow_to.length ? s.flow_to : [s]).forEach(function (f) {
            if (!f.stat_energy_to) return;
            out.exp.push(f.stat_energy_to);
            var c = costOf(f.stat_energy_to, f.stat_compensation);
            if (c) out.comp.push(c);
          });
        } else if (s.type === 'solar') {
          if (s.stat_energy_from) out.solar.push(s.stat_energy_from);
        } else if (s.type === 'battery') {
          out.battery = true;
          if (s.stat_energy_to) out.into.push(s.stat_energy_to);
          if (s.stat_energy_from) out.out.push(s.stat_energy_from);
        } else if (s.type === 'water' || s.type === 'gas') {
          if (!s.stat_energy_from) return;
          out[s.type].ids.push(s.stat_energy_from);
          var c2 = costOf(s.stat_energy_from, s.stat_cost);
          if (c2) out[s.type].cost.push(c2);
        }
      });
      return out;
    }

    // THE PAGE'S MODEL: the plan's sections and tiles, HA's meters, and which
    // devices are counted. Rebuilt only when either input changes.
    function buildModel(P, pr, info) {
      var src = sourcesOf(pr, info), T = P.total || {};
      // Without HA's settings (a failed call, an older HA): the plan's own
      // whole-home meter and cost
      if (!src.imp.length && T.stat) {
        src.imp.push(T.stat);
        if (T.cost) src.cost.push(T.cost);
      }
      var inHA = {};
      ((pr && pr.device_consumption) || []).forEach(function (d) {
        if (d && d.stat_consumption) inHA[d.stat_consumption] = d.included_in_stat ? 'in' : 'top';
      });
      var useHA = Object.keys(inHA).length > 0, look = P.devices || {};
      var sections = [], devs = [], batts = [], seen = {};
      (P.sections || []).forEach(function (s, si) {
        var sec = { id: s.id, name: s.name, link: s.link || null,
                    color: colorOf(s.color, SEC_COLOR[s.id] || SEC_CYCLE[si % SEC_CYCLE.length]), items: [] };
        (s.items || []).forEach(function (it) {
          if (it.kind === 'battery') {
            var b = { key: it.key, sec: sec, name: it.name, entity: it.entity, house: !!it.house,
                      label: it.label || null, suffix: it.label_suffix || '' };
            batts.push(b); sec.items.push(b);
            return;
          }
          var rec = look[it.stat] || look[it.power] || {};
          var counted = !!it.stat && !seen[it.stat] &&
            (useHA ? inHA[it.stat] === 'top' : !rec.parent);
          if (it.stat) seen[it.stat] = true;
          var d = { key: it.key, sec: sec, name: it.name, icon: it.icon, color: it.color, stat: it.stat || null,
                    power: it.power || null, counted: counted, parent: rec.parent || null, runtime: it.runtime || null };
          devs.push(d); sec.items.push(d);
        });
        sections.push(sec);
      });
      // A DEVICE'S DAILY RUNTIME (an AC's hours today): the plan's own link, or
      // a daily bar of runtime whose name starts with the device's --
      // "Upstairs AC Runtime" is the Upstairs AC's
      var rts = (P.usages || []).filter(function (u) { return u && u.runtime && u.entity; });
      // "Downstairs HVAC Run Time" and "Downstairs AC" are the same thing
      var norm = function (x) {
        return String(x || '').toLowerCase().replace(/\b(run\s*time|runtime|daily|hours?)\b/g, ' ')
          .replace(/\b(hvac|a\/c|air\s*conditioner|air\s*conditioning|cooling)\b/g, 'ac').replace(/\s+/g, ' ').trim();
      };
      devs.forEach(function (d) {
        var it = d.runtime;
        if (!it) {
          var best = null;
          rts.forEach(function (u) {
            var n = norm(u.name), dn = norm(d.name);
            if (dn && (n === dn || n.indexOf(dn + ' ') === 0) && (!best || dn.length > best.len)) best = { id: u.stat || u.entity, len: dn.length };
          });
          it = best && best.id;
        }
        d.runtime = it || null;
      });
      var house = batts.filter(function (b) { return b.house; })[0] || null;
      var ids = [].concat(src.imp, src.exp, src.cost, src.comp, src.solar, src.into, src.out,
                          src.water.ids, src.water.cost, src.gas.ids, src.gas.cost);
      devs.forEach(function (d) { if (d.stat) ids.push(d.stat); });
      var powers = [T.power].concat(devs.map(function (d) { return d.power; })).filter(Boolean);
      function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
      var page = P.page || {};
      return {
        P: P, pr: pr, src: src, sections: sections, devs: devs, batts: batts, house: house,
        runtimes: uniq(devs.map(function (d) { return d.runtime; })),
        ids: uniq(ids), powers: uniq(powers), total: T,
        hasCost: src.cost.length > 0 || src.water.cost.length > 0 || src.gas.cost.length > 0 ||
                 typeof T.price === 'number',
        typical: [7, 14, 30].indexOf(page.typical) >= 0 ? page.typical : 30,
        highlights: page.highlights !== false,
        rings: page.rings || null
      };
    }
    function model(client, card) {
      var P = plan(), pr = prefs(client, card);
      if (!P || !pr) return null;
      if (!EP.cache || EP.cache.P !== P || EP.cache.pr !== pr) EP.cache = buildModel(P, pr, EP.info);
      return EP.cache;
    }

    // THE STATISTICS: one batched call each for the last 49 hours (today and
    // all of yesterday, for the shape of a usual day) and the last 63 days:
    // this month and all of last (the 31st after a 31-day month reaches back
    // 62 days), and the 30 before today for "usual". hk-stats wakes `card` when
    // they land. Null until both are here: a page drawn from half its numbers
    // would jump when the rest arrive.
    var HOURS = 49, DAYS = 63, FIVES = 37;
    // A STEPPED-BACK WEEK OR MONTH reaches further: that period, the one before
    // it, and the usual days before that -- in steps of 31 days, so a few steps
    // back share one request (every card asks for the same count)
    function daysFor(per, back) {
      if (!back || (per !== 'week' && per !== 'month')) return DAYS;
      var need = per === 'week' ? 7 * (back + 2) + 37 : 31 * (back + 2) + 31;
      return Math.max(DAYS, Math.ceil(need / 31) * 31);
    }
    function series(client, card, M) {
      var S = window.hkStats;
      if (!S || !M || !M.ids.length) return null;
      if (client) EP.ws = S.weekStart(client);
      var h = S.hourly(client, M.ids, HOURS, card), d = S.daily(client, M.ids, daysFor(period(), EP.back), card);
      return h && d ? { h: h, d: d } : null;
    }
    // EACH DAY'S RUNTIME of the devices that have one (hk-stats dailyPeak: the
    // day's highest reading of a counter that resets at midnight). Not waited
    // on: the page draws without it and adds it when it lands.
    function runtimes(client, card, M) {
      var S = window.hkStats;
      if (!S || !S.dailyPeak || !M || !M.runtimes.length) return null;
      return S.dailyPeak(client, M.runtimes, daysFor(period(), EP.back), card);
    }
    // hours as "1h 55m"
    function hm(h) {
      var m = Math.round((h || 0) * 60);
      return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
    }
    // THE LAST THREE HOURS OF EVERY POWER SENSOR ON THE PAGE, in one call
    function live(client, card, M) {
      var S = window.hkStats;
      if (!S || !S.fiveMinute || !M || !M.powers.length) return null;
      return S.fiveMinute(client, M.powers, FIVES, card);
    }
    function wattsNow(client, id) {
      var C = window.hkChart;
      if (!C || !client || !id) return null;
      return C.power(client.states, id, { watts: true, fallback: null });
    }

    // =============================================================== THE SUMS
    // Pure: the model, the statistics and a clock in; everything the cards draw
    // out. tests/test_energysums.js drives it with the house's real numbers.
    function axisOf(D, M) {
      for (var i = 0; i < M.ids.length; i++) {
        if (D.d[M.ids[i]] && D.h[M.ids[i]]) return { d: D.d[M.ids[i]], h: D.h[M.ids[i]] };
      }
      return null;
    }
    function v(ser, id, i) {
      var a = ser[id], p = a && a[i];
      return p && typeof p.v === 'number' && isFinite(p.v) ? p.v : 0;
    }
    function vs(ser, ids, i) { var s = 0; for (var k = 0; k < ids.length; k++) s += v(ser, ids[k], i); return s; }
    function homeAt(M, ser, i) {
      var s = M.src;
      return Math.max(0, vs(ser, s.imp, i) - vs(ser, s.exp, i) + vs(ser, s.solar, i) + vs(ser, s.out, i) - vs(ser, s.into, i));
    }
    function costAt(M, ser, i) {
      var s = M.src, grid = vs(ser, s.cost, i);
      // A COST SENSOR THAT STARTED OVER OR WAS NOT THERE (a running total that
      // reset in Home Assistant's own statistics, leaving one large negative
      // slot, or weeks with no rows at all): a slot whose grid
      // cost is missing, or fell below zero by more than any tariff pays to
      // import -- a dollar a kWh drawn -- is priced at the meter's own rate
      // from the rest of the series instead
      if (s.cost.length) {
        var drew = vs(ser, s.imp, i), gap = s.cost.some(function (id) { var q = ser[id] && ser[id][i]; return !q || typeof q.v !== 'number'; });
        if (drew > 0 && (gap || (grid < 0 && -grid > Math.max(1, drew)))) grid = drew * rateOf(M, ser);
      }
      var c = grid - vs(ser, s.comp, i) + vs(ser, s.water.cost, i) + vs(ser, s.gas.cost, i);
      if (!s.cost.length && typeof M.total.price === 'number') c += M.total.price * vs(ser, s.imp, i);
      return c;
    }
    // the grid's price per kWh over a series, from its slots that make sense
    // (kept per series array: hk-stats hands back new arrays when it refetches)
    var RATES = typeof WeakMap === 'function' ? new WeakMap() : null;
    function rateOf(M, ser) {
      var key = ser[M.src.cost[0]], got = RATES && key && RATES.get(key);
      if (got != null) return got;
      var c = 0, e = 0, n = key ? key.length : 0;
      for (var i = 0; i < n; i++) {
        var ci = vs(ser, M.src.cost, i), ei = vs(ser, M.src.imp, i), q = key[i];
        if (q && typeof q.v === 'number' && ci >= 0 && ei > 0) { c += ci; e += ei; }
      }
      var r = e > 0 ? c / e : (typeof M.total.price === 'number' ? M.total.price : 0);
      if (RATES && key) RATES.set(key, r);
      return r;
    }

    // THE AXIS INDEX of a day (an HA-local midnight): counted back from today,
    // then matched exactly. Below 0 is before the statistics begin.
    function dayIndex(ax, t) {
      var nd = ax.d.length, g = nd - 1 - Math.round((+ax.d[nd - 1].t - t) / DAY);
      for (var k = 0; k <= 2; k++) {
        if (ax.d[g + k] && +ax.d[g + k].t === t) return g + k;
        if (ax.d[g - k] && +ax.d[g - k].t === t) return g - k;
      }
      return g;
    }
    // WEEK AND MONTH ARE CALENDAR PERIODS (the user, 2026-10-12: "that is the
    // expectation I think most people have"): the week from the first day of
    // the week, the month from the 1st, `back` periods before this one.
    // Every day of the period is a slot -- the days still to come have no
    // index -- and the period before is read against it at the same point.
    function calc(M, D, per, now, RT, o) {
      o = o || {};
      var ax = axisOf(D, M);
      if (!ax) return null;
      now = now || Date.now();
      var nd = ax.d.length, today0 = +ax.d[nd - 1].t, yday0 = +ax.d[nd - 2].t;
      var hToday = [], hYday = [];
      ax.h.forEach(function (p, i) {
        var t = +p.t;
        if (t >= today0) hToday.push(i); else if (t >= yday0) hYday.push(i);
      });
      // HOW MUCH OF A USUAL DAY HAS GONE BY: yesterday's own shape, hour by
      // hour, up to this time of day (a house that uses most of its energy in
      // the evening is not "on pace" at noon). A first day with no yesterday:
      // the clock's share.
      var elapsed = Math.max(0, Math.min(1, (now - today0) / DAY));
      var yTot = sum(hYday.map(function (i) { return homeAt(M, D.h, i); }));
      var share = elapsed;
      if (yTot > 0.05) {
        var gone = 0, off = now - today0;
        hYday.forEach(function (i) {
          var into = off - (+ax.h[i].t - yday0);
          if (into >= HOUR) gone += homeAt(M, D.h, i);
          else if (into > 0) gone += homeAt(M, D.h, i) * into / HOUR;
        });
        share = gone / yTot;
      }
      share = Math.max(0.02, share);
      var day = per === 'now' || per === 'day', S = window.hkStats;
      var n = 1, idx = day ? hToday : [], slots = null, dates = null, ghosts = null, todayK = -1, whole = 0, days = 1;
      var back = day ? 0 : Math.max(0, o.back || 0), cur = back === 0, tw = [], pv = null, P0 = null;
      if (day) {
        for (var j = nd - 1 - M.typical; j < nd - 1; j++) if (j >= 0) tw.push(j);
      } else {
        P0 = S.period(per, back, now, o.ws || 0);
        var P1 = S.period(per, back + 1, now, o.ws || 0);
        var s0 = dayIndex(ax, P0.start), s1 = dayIndex(ax, P1.start);
        n = P0.len; slots = []; dates = []; ghosts = [];
        todayK = cur ? nd - 1 - s0 : -1;
        for (var k = 0, t = P0.start; k < n; k++, t = S.addDays(t, 1)) {
          var i = s0 + k, has = i >= 0 && i < nd;
          slots.push(has ? i : null); dates.push(t);
          if (has) idx.push(i);
          // a day still to come: the period before's same day, in gray
          var g = s1 + k;
          ghosts.push(!has && cur && k > todayK && k < P1.len && g >= 0 && g < nd ? g : null);
        }
        whole = cur ? todayK : n;
        days = cur ? whole + share : n;
        // the usual day: the days before today, or before a past period
        var u0 = cur ? nd - 1 : s0;
        for (var j2 = u0 - M.typical; j2 < u0; j2++) if (j2 >= 0) tw.push(j2);
        // THE PERIOD BEFORE, BY NOW: its first `whole` days and its matching
        // day as far as today has gone (there is no hourly history that far
        // back: that day's total times the share of a usual day gone by). A
        // day past its end -- the 31st against September -- is all of it.
        var pidx = [], wt = [];
        for (var q = 0; q < P1.len; q++) {
          var pi = s1 + q;
          if (pi < 0 || pi >= nd) continue;
          pidx.push(pi);
          wt.push(!cur || whole >= P1.len || q < whole ? 1 : q === whole ? share : 0);
        }
        var by = function (fn) { var a = 0; pidx.forEach(function (i3, x) { a += fn(i3) * wt[x]; }); return a; };
        var allOf = function (fn) { return sum(pidx.map(fn)); };
        pv = { start: P1.start, len: P1.len, idx: pidx, byNow: cur && whole < P1.len, complete: s1 >= 0, has: hasData(pidx),
               home: by(function (i3) { return homeAt(M, D.d, i3); }), cost: by(function (i3) { return costAt(M, D.d, i3); }),
               allHome: allOf(function (i3) { return homeAt(M, D.d, i3); }), allCost: allOf(function (i3) { return costAt(M, D.d, i3); }) };
      }
      var ser = day ? D.h : D.d, by2 = day ? 'h' : 'd';
      function hasData(list) {
        return list.some(function (i4) { return M.src.imp.concat(M.src.solar).some(function (id) { var q = D.d[id] && D.d[id][i4]; return q && typeof q.v === 'number'; }); });
      }
      // the share of the period gone by: R.n * R.pshare is the days gone
      var pshare = day ? share : days / n;
      var tot = function (ids) { return sum(idx.map(function (i) { return vs(ser, ids, i); })); };
      var home = sum(idx.map(function (i) { return homeAt(M, ser, i); }));
      var cost = sum(idx.map(function (i) { return costAt(M, ser, i); }));
      // A USUAL DAY: the mean of the days before today (The 30 Days Before, or
      // the plan's 7 or 14); for a past week or month, the days before it
      var usualOf = function (fn) { return tw.length ? sum(tw.map(fn)) / tw.length : 0; };
      var typ = {
        home: usualOf(function (i) { return homeAt(M, D.d, i); }),
        cost: usualOf(function (i) { return costAt(M, D.d, i); }),
        water: usualOf(function (i) { return vs(D.d, M.src.water.ids, i); }),
        gas: usualOf(function (i) { return vs(D.d, M.src.gas.ids, i); }),
        solar: usualOf(function (i) { return vs(D.d, M.src.solar, i); }),
        into: usualOf(function (i) { return vs(D.d, M.src.into, i); })
      };
      // a runtime is a day's figure: today's for Today and Now, the period's days otherwise
      var rtIdx = day ? [nd - 1] : idx;
      var rtOf = function (d) {
        var a = RT && d.runtime && RT[d.runtime];
        if (!a || a.length !== nd) return null;
        var val = 0;
        rtIdx.forEach(function (q2) { val += (a[q2] && typeof a[q2].v === 'number') ? a[q2].v : 0; });
        return { v: val, usual: usualOf(function (i) { return a[i] && typeof a[i].v === 'number' ? a[i].v : 0; }) };
      };
      var devices = M.devs.filter(function (d) { return d.stat || d.runtime; }).map(function (d) {
        return { d: d, v: d.stat ? tot([d.stat]) : 0, usual: d.stat ? usualOf(function (i) { return v(D.d, d.stat, i); }) : 0, rt: rtOf(d) };
      });
      var counted = devices.filter(function (r) { return r.d.counted && r.d.stat; });
      var onDevice = sum(counted.map(function (r) { return r.v; }));
      var secs = M.sections.map(function (s) {
        return { s: s, v: sum(counted.filter(function (r) { return r.d.sec === s; }).map(function (r) { return r.v; })) };
      });
      // WHERE THE PERIOD IS HEADING: today on its usual shape; a week or a
      // month, what is used so far and a usual day for each day left -- steady
      // on a Monday morning, where two days stretched over seven swing wildly
      var left = day ? 0 : n - days;
      return {
        ax: ax, per: per, by: by2, n: n, idx: idx, ser: ser, today0: today0, now: now,
        hToday: hToday, hYday: hYday, share: share, pshare: pshare,
        slots: slots, dates: dates, ghosts: ghosts, todayK: todayK, whole: whole, days: days,
        back: back, cur: cur, start: P0 ? P0.start : today0, prev: pv, tw: tw, has: day || hasData(idx),
        home: home, cost: cost, water: tot(M.src.water.ids), gas: tot(M.src.gas.ids),
        solar: tot(M.src.solar), into: tot(M.src.into), out: tot(M.src.out),
        typ: typ, devices: devices, counted: counted, onDevice: onDevice,
        untracked: Math.max(0, home - onDevice), secs: secs,
        proj: day ? home / pshare : home + typ.home * left, projCost: day ? cost / pshare : cost + typ.cost * left
      };
    }
    // THE SUMS ONCE PER TAB, NOT ONCE PER CARD: thirty tiles and seven cards
    // all ask for the same period. Kept while the statistics are the same
    // arrays (hk-stats hands back the same ones until it refetches), the same
    // runtimes, the same plan, the same period, and the same minute.
    function calcFor(M, D, per, RT) {
      var a0 = M.ids[0], o = { back: EP.back || 0, ws: EP.ws || 0 };
      var key = [per, o.back, o.ws, Math.floor(Date.now() / 60e3)].join('|');
      var m = EP.memo;
      if (m && m.key === key && m.M === M && m.d === D.d[a0] && m.h === D.h[a0] &&
          m.rt === (RT && M.runtimes[0] ? RT[M.runtimes[0]] : null)) return m.R;
      var R = calc(M, D, per, null, RT, o);
      EP.memo = { key: key, M: M, d: D.d[a0], h: D.h[a0], rt: RT && M.runtimes[0] ? RT[M.runtimes[0]] : null, R: R };
      return R;
    }
    // THE SCREENSAVER'S HOME ENERGY (2026-10-14, hk-saver-energy.js): today so
    // far and the month so far, from this page's own model and sums -- so the
    // two never disagree -- plus THE HOUR STILL OPEN. Home Assistant closes an
    // hour's statistics only once it is over (measured: at 13:20 the hourly
    // and daily buckets end at 13:00, the five-minute ones at 13:20), so the
    // five-minute changes since the last closed hour are added to today and
    // the month. House meters load first; measured top-level circuits load separately
    // for the optional explanation, through the same batched statistics cache.
    // null until it all has arrived; `waker` (requestUpdate / redraw, as a
    // card has them) is woken as each part lands.
    var OPEN_FIVES = 14;
    function houseIds(M) {
      var s = M.src;
      return [].concat(s.imp, s.exp, s.cost, s.comp, s.solar, s.into, s.out, s.water.ids, s.water.cost, s.gas.ids, s.gas.cost)
        .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    }
    function hasV(ser, ids, i) {
      return ids.some(function (id) { var q = ser[id] && ser[id][i]; return q && typeof q.v === 'number'; });
    }
    // the five-minute changes after the last closed hour, to the last closed
    // five minutes: what each adds, and when that is up to
    function openHour(M, D, F, T) {
      var ax = T.ax, meters = M.src.imp.concat(M.src.solar), z = { home: 0, cost: 0, water: 0, gas: 0, solar: 0, upTo: 0 };
      var covered = T.today0;
      for (var i = ax.h.length - 1; i >= 0; i--) {
        if (+ax.h[i].t >= T.today0 && hasV(D.h, meters, i)) { covered = +ax.h[i].t + HOUR; break; }
      }
      z.upTo = covered;
      var fa = F && meters.map(function (id) { return F[id]; }).filter(Boolean)[0];
      if (!fa) return z;
      for (var j = 0; j < fa.length; j++) {
        var t = +fa[j].t;
        if (t < covered || !hasV(F, meters, j)) continue;
        z.home += homeAt(M, F, j); z.cost += costAt(M, F, j);
        z.water += vs(F, M.src.water.ids, j); z.gas += vs(F, M.src.gas.ids, j); z.solar += vs(F, M.src.solar, j);
        z.upTo = Math.max(z.upTo, t + 3e5);
      }
      return z;
    }
    // HOW MUCH OF A USUAL DAY HAS GONE BY at `off` past midnight, by
    // yesterday's own shape (calc's share, for any meter): [share, yesterday by then]
    function byNow(D, T, off, fn) {
      var all = 0, gone = 0, yday0 = T.today0 - DAY;
      T.hYday.forEach(function (i) {
        var x = fn(D.h, i), into = off - (+T.ax.h[i].t - yday0);
        all += x;
        if (into >= HOUR) gone += x; else if (into > 0) gone += x * into / HOUR;
      });
      return [all > 0.05 ? Math.max(0.02, gone / all) : Math.max(0.02, Math.min(1, off / DAY)), all > 0.05 ? gone : null];
    }
    // Attribution uses measured top-level circuits, at the SAME cutoff as the
    // house total. Missing buckets/history suppress it; child circuits never
    // count twice. Usual by now follows each circuit's own yesterday shape,
    // just as the house comparison does, against its preceding-days mean.
    function contributor(M, D, F, T, cutoff, extra) {
      if (!(extra > 0.5) || !F) return null;
      var groups = {}, complete = function (ser, id, ix, axis) {
        return ix.length && ix.every(function (i) { var q = ser[id] && ser[id][i]; return q && typeof q.v === 'number' && +q.t === +axis[i].t; });
      };
      M.devs.filter(function (d) { return d.counted && d.stat; }).forEach(function (d) {
        var ix = T.hToday.filter(function (i) { return +T.ax.h[i].t + HOUR <= cutoff; });
        // Only closed hourly buckets; the current open hour comes from fives.
        if (ix.some(function (i) { return !hasV(D.h, M.src.imp.concat(M.src.solar), i); })) return;
        if (!complete(D.h, d.stat, ix, T.ax.h) || !complete(D.h, d.stat, T.hYday, T.ax.h) || !complete(D.d, d.stat, T.tw, T.ax.d)) return;
        var rows = F[d.stat], start = ix.length ? +T.ax.h[ix[ix.length - 1]].t + HOUR : T.today0;
        if (!rows) return;
        var tail = rows.filter(function (q) { return +q.t >= start && +q.t < cutoff; });
        if (cutoff > start && (tail.length !== Math.round((cutoff - start) / 3e5) || tail.some(function (q) { return typeof q.v !== 'number'; }))) return;
        var shape = byNow(D, T, cutoff - T.today0, function (ser, i) { return v(ser, d.stat, i); });
        if (shape[1] == null) return;
        var usual = sum(T.tw.map(function (i) { return v(D.d, d.stat, i); })) / T.tw.length * shape[0];
        var used = sum(ix.map(function (i) { return v(D.h, d.stat, i); })) + sum(tail.map(function (q) { return q.v; }));
        var cooling = /\b(cooling|ac|a\/c|air condition(?:er|ing))\b/i.test(d.name), key = cooling ? 'cooling' : d.stat;
        var g = groups[key] || (groups[key] = { name: cooling ? 'extra cooling' : d.name + ' using more', extra: 0 });
        g.extra += used - usual;
      });
      var ranked = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a,b) { return b.extra - a.extra; });
      var best = ranked[0];
      // "Mostly" needs a majority of the net increase and a clear lead.
      return best && best.extra >= extra * 0.6 && best.extra >= 0.5 && (!ranked[1] || best.extra >= ranked[1].extra * 1.5) ? best : null;
    }
    var RING_NAME = { energy: 'Energy', cost: 'Cost', solar: 'Solar', water: 'Water', gas: 'Gas' };
    function summary(client, waker, now) {
      var S = window.hkStats, M = model(client, waker);
      if (!S || !M || !client) return null;
      var ids = houseIds(M);
      if (!ids.length) return null;
      var h = S.hourly(client, ids, HOURS, waker), d = S.daily(client, ids, DAYS, waker);
      var F = S.fiveMinute(client, ids, OPEN_FIVES, waker, { type: 'change' });
      if (!h || !d) return null;
      var D = { h: h, d: d };
      now = now || Date.now();
      var T = calc(M, D, 'day', now), Mo = calc(M, D, 'month', now, null, { back: 0, ws: S.weekStart(client) });
      if (!T || !Mo) return null;
      var o = openHour(M, D, F, T), off = o.upTo - T.today0;
      var eBy = byNow(D, T, off, function (ser, i) { return homeAt(M, ser, i); });
      var today = { energy: T.home + o.home, cost: T.cost + o.cost, water: T.water + o.water, gas: T.gas + o.gas, solar: T.solar + o.solar };
      var share = { energy: eBy[0], cost: eBy[0], solar: byNow(D, T, off, function (ser, i) { return vs(ser, M.src.solar, i); })[0],
                    water: byNow(D, T, off, function (ser, i) { return vs(ser, M.src.water.ids, i); })[0],
                    gas: byNow(D, T, off, function (ser, i) { return vs(ser, M.src.gas.ids, i); })[0] };
      var typ = { energy: T.typ.home, cost: T.typ.cost, water: T.typ.water, gas: T.typ.gas, solar: T.typ.solar };
      var all = { energy: true, cost: M.hasCost, solar: M.src.solar.length > 0, water: M.src.water.ids.length > 0, gas: M.src.gas.ids.length > 0 };
      var want = Array.isArray(M.rings) && M.rings.length ? M.rings : ['energy', 'cost', 'solar', 'water', 'gas'];
      var unit = function (k) { return k === 'cost' ? '' : k === 'water' || k === 'gas' ? unitOf(client, M.src[k].ids[0]) : 'kWh'; };
      var rings = want.filter(function (k) { return all[k]; }).slice(0, 4).map(function (k) {
        return { key: k, name: RING_NAME[k], c: RING[k], v: today[k], typ: typ[k], tick: share[k], unit: unit(k) };
      });
      var devIds = M.devs.filter(function (d) { return d.counted && d.stat; }).map(function (d) { return d.stat; });
      var dh = S.hourly(client, devIds, HOURS, waker), dd = S.daily(client, devIds, DAYS, waker);
      var df = S.fiveMinute(client, devIds, OPEN_FIVES, waker, { type: 'change' });
      var cause = dh && dd ? contributor(M, { h: Object.assign({}, h, dh), d: Object.assign({}, d, dd) }, df, T, o.upTo, today.energy - typ.energy * eBy[0]) : null;
      var receiptTimes = S.freshness ? [S.freshness(h), S.freshness(d), F && S.freshness(F)].filter(Boolean) : [];
      var receivedAt = receiptTimes.length ? Math.min.apply(null, receiptTimes) : null;
      var mo = { energy: Mo.home + o.home, cost: Mo.cost + o.cost, water: Mo.water + o.water, gas: Mo.gas + o.gas, solar: Mo.solar + o.solar };
      var bat = M.house && client.states[M.house.entity], bl = bat ? Number(bat.state) : NaN;
      // THE PERIODS' RINGS (2026-10-31, the Energy Rings block): today, this
      // week and this month so far, each against a usual one -- a usual day for
      // each of its days -- with its dot where a usual one would be by now
      // (the days gone, and today's share of a usual day). The week is calc's
      // own calendar week, as the page's This Week tab; the open hour is added
      // to each, as it is to today and the month. Where each is heading: what
      // is used so far, and a usual day for what is left of it.
      var Wk = calc(M, D, 'week', now, null, { back: 0, ws: S.weekStart(client) });
      var keys = rings.map(function (r) { return r.key; });
      var periods = {};
      [['day', T, today, 'Today'], ['week', Wk, null, 'This week'], ['month', Mo, mo, MONTHS[S.fields(Mo.start).month - 1]]].forEach(function (x) {
        var R = x[1];
        if (!R) return;
        var so = x[2] || { energy: R.home + o.home, cost: R.cost + o.cost, water: R.water + o.water, gas: R.gas + o.gas, solar: R.solar + o.solar };
        var n = x[0] === 'day' ? 1 : R.n, gone = x[0] === 'day' ? 0 : R.whole;
        var left = Math.max(0, n - gone - eBy[0]);
        periods[x[0]] = {
          name: x[3], n: n,
          rings: keys.map(function (k) {
            return { key: k, name: RING_NAME[k], c: RING[k], v: so[k], typ: typ[k] * n, tick: (gone + share[k]) / n, unit: unit(k) };
          }),
          heading: { energy: so.energy + typ.energy * left, cost: M.hasCost && R.cur !== false ? so.cost + typ.cost * left : null }
        };
      });
      return {
        periods: periods,
        asOf: o.upTo, receivedAt: receivedAt, hasFives: !!F, contributor: cause, today0: T.today0, rings: rings, typ: typ, today: today, usualByNow: typ.energy * eBy[0],
        yday: eBy[1], month: mo, monthName: MONTHS[S.fields(Mo.start).month - 1],
        // where the month's cost is heading: so far, and a usual day for each day left
        projCost: M.hasCost && Mo.cur ? mo.cost + T.typ.cost * Math.max(0, Mo.n - Mo.whole - eBy[0]) : null,
        hasCost: M.hasCost, power: wattsNow(client, M.total.power), battery: isFinite(bl) ? bl : null,
        money: function (v, dd) { var C = window.hkCards; return C && C.money ? C.money(client, v, dd) : '$' + fx(v, dd); }
      };
    }
    // RESTART A BUILD ANIMATION WITHOUT A LAYOUT PER CARD: every card and tile
    // drawn in this turn is collected, then one reflow restarts them all
    var animQ = [];
    function restartAnim(el, cls) {
      if (!animQ.length) {
        Promise.resolve().then(function () {
          var q = animQ; animQ = [];
          q.forEach(function (x) { x[0].classList.remove(x[1]); });
          void document.documentElement.offsetWidth;
          q.forEach(function (x) { x[0].classList.add(x[1]); });
        });
      }
      animQ.push([el, cls]);
    }
    // ONE SECTION'S (or the house's) use in one slot of a period
    function slotOf(M, R, ser, i, sec) {
      if (!sec) return homeAt(M, ser, i);
      return sum(R.counted.filter(function (r) { return r.d.sec === sec; }).map(function (r) { return v(ser, r.d.stat, i); }));
    }
    function usualOfSec(R, sec) {
      if (!sec) return R.typ.home;
      return sum(R.counted.filter(function (r) { return r.d.sec === sec; }).map(function (r) { return r.usual; }));
    }

    // the calendar's chevrons (hk-calendar.js IC.left / IC.right)
    var CHEV_L =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 ' +
      '7"/></svg>';
    var CHEV_R =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 ' +
      '7"/></svg>';
    // ---- what stood out, in words
    var GLY = {
      clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      up: '<path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
      down: '<path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
      bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/>',
      batt:
        '<rect x="3" y="7" width="16" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5.5" y="9.5" width="8" height="5" rx="1" fill="currentColor"/><rect x="20" ' +
        'y="10" width="2" height="4" rx="1" fill="currentColor"/>',
      car: '<path d="M5 16v2M19 16v2M4 13l2-5h12l2 5v3H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
      coin:
        '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.4.8-2.4 1.8 0 2.6 5 1.4 5 4 0 1-1.1 1.8-2.6 1.8-1.2 ' +
        '0-2.2-.5-2.7-1.3M12 6.5v11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
      sun:
        '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round"/>'
    };
    // ---- the period in words: "this week", "last week", "the week of
    // Sep 27", "in August"; its title, "Last Week", "Week of Sep 27", "August";
    // and its dates, "Oct 11 – 17", "Sep 27 – Oct 3", "Oct 1 – 31"
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    function dateShort(t, tz) { return new Date(t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ month: 'short', day: 'numeric', timeZone: tz })); }
    function monthOf(t) {
      var S = window.hkStats, f = S.fields(t), y = S.fields(Date.now()).year;
      return MONTHS[f.month - 1] + (f.year !== y ? ' ' + f.year : '');
    }
    function rangeText(start, len, tz) {
      var S = window.hkStats, end = S.addDays(start, len - 1), a = S.fields(start), b = S.fields(end);
      return dateShort(start, tz) + ' \u2013 ' + (a.month === b.month ? b.day : dateShort(end, tz)) +
        (b.year !== S.fields(Date.now()).year ? ', ' + b.year : '');
    }
    function titleOf(per, back, start, tz) {
      if (!back || (per !== 'week' && per !== 'month')) return TAB_NAMES[per];
      if (back === 1) return per === 'week' ? 'Last Week' : 'Last Month';
      return per === 'week' ? 'Week of ' + dateShort(start, tz) : monthOf(start);
    }
    function whenOf(per, R) {
      if (per !== 'week' && per !== 'month') return 'today';
      var back = R ? R.back : (EP.back || 0);
      if (!back) return per === 'week' ? 'this week' : 'this month';
      if (back === 1) return per === 'week' ? 'last week' : 'last month';
      return per === 'week' ? 'the week of ' + dateShort(R.start, window.hkStats.tz()) : 'in ' + monthOf(R.start);
    }
    function hourName(t, tz) { return new Date(t).toLocaleTimeString(window.hkLocale.tag(), window.hkLocale.clock({ hour: 'numeric', timeZone: tz })); }
    function dayName(t, tz) { return new Date(t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'long', month: 'short', day: 'numeric', timeZone: tz })); }

    function highlights(M, R, client, money) {
      var out = [], tz = window.hkStats && window.hkStats.tz(), when = whenOf(R.per, R);
      if (R.per === 'now') {
        var T = M.total, wNow = wattsNow(client, T.power);
        var live = M.devs.filter(function (d) { return d.counted && d.power; })
          .map(function (d) { return { d: d, w: Math.max(0, wattsNow(client, d.power) || 0) }; })
          .sort(function (a, b) { return b.w - a.w; });
        var top3 = live.slice(0, 3).filter(function (r) { return r.w >= 5; });
        if (top3.length && wNow > 0) {
          out.push({ more: T.power, ic: GLY.bolt, c: '#ff9f0a', t: '<b>' + top3.map(function (r) { return esc(r.d.name); }).join(', ') +
            '</b> ' + (top3.length > 1 ? 'are' : 'is') + ' drawing ' + fx(Math.min(100, 100 * sum(top3.map(function (r) { return r.w; })) / wNow), 0) + '% of it.' });
        }
        var run = live.filter(function (r) { return r.w >= 1000; })[0];
        if (run) out.push({ more: run.d.power || run.d.stat, ic: GLY.up, c: '#5ac8fa', t: '<b>' + esc(run.d.name) + ' is running</b> at ' + watts(run.w).join(' ') + '.' });
        var hb = M.house, hs = hb && client.states[hb.entity];
        if (hs && isFinite(Number(hs.state))) {
          var ls = hb.label && client.states[hb.label];
          out.push({ more: hb.entity, ic: GLY.batt, c: '#30d158', t: '<b>The house battery is at ' + Math.round(Number(hs.state)) + '%</b>' +
            (ls && isFinite(Number(ls.state)) ? ', ' + fx(Number(ls.state), 1) + ' kWh stored.' : '.') });
        }
        var cars = M.batts.filter(function (b) { return !b.house; }).map(function (b) {
          var s = client.states[b.entity], l = b.label && client.states[b.label];
          if (!s || !isFinite(Number(s.state))) return null;
          return '<b>' + esc(b.name) + '</b> ' + Math.round(Number(s.state)) + '%' +
            (l && isFinite(Number(l.state)) ? ' · ' + fx(Number(l.state), 0) + ' ' + esc((l.attributes || {}).unit_of_measurement || '') : '');
        }).filter(Boolean);
        if (cars.length) out.push({ more: (M.batts.filter(function (b) { return !b.house; })[0] || {}).entity, ic: GLY.car, c: '#64d2ff', t: cars.join(', ') + '.' });
        if (R.solar > 0.05) out.push({ more: M.src.solar[0], ic: GLY.sun, c: '#ffd60a', t: '<b>The sun</b> has made ' + kwh(R.solar) + ' kWh today.' });
      } else {
        if (R.by === 'h') {
          var busiest = R.idx.slice().sort(function (a, b) { return homeAt(M, R.ser, b) - homeAt(M, R.ser, a); })[0];
          if (busiest != null && homeAt(M, R.ser, busiest) > 0.05) {
            var topIn = R.counted.slice().sort(function (a, b) { return v(R.ser, b.d.stat, busiest) - v(R.ser, a.d.stat, busiest); })[0];
            out.push({ more: M.total.stat, ic: GLY.clock, c: '#ff9f0a', t: '<b>' + hourName(R.ax.h[busiest].t, tz) + ' was the busiest hour</b>: ' +
              kwh(homeAt(M, R.ser, busiest)) + ' kWh' + (topIn && v(R.ser, topIn.d.stat, busiest) > 0.05 ? ', most of it ' + esc(topIn.d.name) : '') + '.' });
          }
        } else {
          var big = R.idx.slice().sort(function (a, b) { return homeAt(M, R.ser, b) - homeAt(M, R.ser, a); })[0];
          if (big != null) out.push({ more: M.total.stat, ic: GLY.clock, c: '#ff9f0a', t: '<b>' + dayName(R.ax.d[big].t, tz) + ' used the most</b>: ' +
            fx(homeAt(M, R.ser, big), 0) + ' kWh.' });
        }
        var above = R.devices.filter(function (r) { return r.usual > 0.4; }).map(function (r) {
          return { r: r, k: r.v / Math.max(0.05, r.usual * R.n * R.pshare) };
        }).sort(function (a, b) { return b.k - a.k; })[0];
        if (above && above.k > 1.15) {
          out.push({ more: above.r.d.power || above.r.d.stat, ic: GLY.up, c: '#ff375f', t: '<b>' + esc(above.r.d.name) + '</b> is running <b>' + Math.round(100 * (above.k - 1)) +
            '% above</b> its usual' + (R.per === 'day' ? ' for this time of day' : '') + '.' });
        }
        // AN AC THAT RAN WELL OFF ITS USUAL
        var ran = R.devices.filter(function (r) { return r.rt && r.rt.usual > 0.1; }).map(function (r) {
          return { r: r, k: r.rt.v / Math.max(0.01, r.rt.usual * R.n * R.pshare) };
        }).sort(function (a, b) { return Math.abs(b.k - 1) - Math.abs(a.k - 1); })[0];
        if (ran && Math.abs(ran.k - 1) >= 0.25) {
          var pc = Math.round(100 * Math.abs(ran.k - 1));
          out.push({ more: ran.r.d.runtime, ic: GLY.clock, c: '#5ac8fa', t: '<b>' + esc(ran.r.d.name) + ' ran ' + hm(ran.r.rt.v) + '</b> ' + when + ', ' + pc + '% ' +
            (ran.k > 1 ? 'more' : 'less') + ' than usual' + (R.per === 'day' ? ' by now' : '') + '.' });
        }
        if (M.src.battery || M.src.into.length) {
          out.push({ more: M.house && M.house.entity, ic: GLY.batt, c: '#30d158', t: '<b>The house battery</b> charged ' + kwh(R.into) + ' kWh ' + when +
            (R.out > 0.05 ? ' and gave back ' + kwh(R.out) + ' kWh' : ', and the house hasn’t drawn on it') + '.' });
        }
        var bySec = R.secs.slice().sort(function (a, b) { return b.v - a.v; })[0];
        if (bySec && bySec.v > 0.05 && R.home > 0.05) {
          out.push({ sec: bySec.s.id, ic: GLY.coin, c: bySec.s.color, t: '<b>' + esc(bySec.s.name) + '</b> used the most ' + when + ': ' +
            fx(Math.min(100, 100 * bySec.v / R.home), 0) + '% of the house.' });
        }
        if (out.length < 4 && M.hasCost && R.per !== 'day') {
          var days = Math.max(1, R.days);
          out.splice(1, 0, { ic: GLY.coin, c: '#30d158', t: '<b>' + money(R.cost / days, 2) + ' a day</b> ' + when +
            ', against a usual ' + money(R.typ.cost, 2) + '.' });
        }
        if (out.length < 4 && R.solar > 0.05) {
          out.push({ more: M.src.solar[0], ic: GLY.sun, c: '#ffd60a', t: '<b>The sun</b> made ' + kwh(R.solar) + ' kWh ' + when + '.' });
        }
      }
      return out.slice(0, 4);
    }
    function unitOf(client, id) {
      var s = id && client && client.states[id];
      return (s && s.attributes && s.attributes.unit_of_measurement) || '';
    }

    // what the shell and the later parts use of this one
    K.axisOf = axisOf; K.buildModel = buildModel; K.calc = calc; K.calcFor = calcFor; K.CHEV_L = CHEV_L;
    K.CHEV_R = CHEV_R; K.colorOf = colorOf; K.contributor = contributor; K.costAt = costAt; K.dayName = dayName;
    K.daysFor = daysFor; K.EP = EP; K.esc = esc; K.fx = fx; K.GLY = GLY; K.highlights = highlights; K.hm = hm;
    K.homeAt = homeAt; K.HOUR = HOUR; K.hourName = hourName; K.HOURS = HOURS; K.kwh = kwh; K.live = live;
    K.MAX_BACK = MAX_BACK; K.model = model; K.monthOf = monthOf; K.NAMED = NAMED; K.period = period;
    K.PERIODS = PERIODS; K.plan = plan; K.rangeText = rangeText; K.REST = REST; K.restartAnim = restartAnim;
    K.rgba = rgba; K.RING = RING; K.runtimes = runtimes; K.SEC_CYCLE = SEC_CYCLE; K.series = series;
    K.setBack = setBack; K.setPeriod = setPeriod; K.setPick = setPick; K.slotOf = slotOf; K.sourcesOf = sourcesOf;
    K.sum = sum; K.summary = summary; K.TAB_NAMES = TAB_NAMES; K.titleOf = titleOf; K.unitOf = unitOf;
    K.usualOfSec = usualOfSec; K.v = v; K.vs = vs; K.watts = watts; K.wattsNow = wattsNow; K.whenOf = whenOf;
  };
})();
