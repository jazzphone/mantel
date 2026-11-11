// hk-headers-security-vacuum.js - the security and cleaning headers.
//
// PART OF THE PAGE HEADERS (hk-headers.js). Not a card and not run on its own: it registers one
// function, which hk-headers.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkHeadersParts = window.hkHeadersParts || {})['hk-headers-security-vacuum'] = function (K) {
    var artOf = K.artOf, bars = K.bars, BARS_CSS = K.BARS_CSS, C = K.C, DAY = K.DAY, dur = K.dur, durHtml = K.durHtml,
        esc = K.esc, goneQuiet = K.goneQuiet, header = K.header, HeaderCard = K.HeaderCard, hm = K.hm, HOUR = K.HOUR,
        hourScrub = K.hourScrub, hs = K.hs, kindOf = K.kindOf, LOG_WORD = K.LOG_WORD, midnight = K.midnight,
        MIN = K.MIN, nameOf = K.nameOf, num = K.num, ownName = K.ownName, P = K.P, R = K.R, rowGlyph = K.rowGlyph,
        shortDur = K.shortDur, spans = K.spans, total = K.total, v = K.v, WAYS = K.WAYS, waysIn = K.waysIn,
        wayState = K.wayState, XP_KEY = K.XP_KEY;

    class HkSecurityOverviewCard extends HeaderCard {
      static get PART_CSS() {
        var B = C.BLUR;
        return [
          // the grid stretches the card to its row (the keypad's height, less
          // the card's own margins): no height of its own, or it would add them
          ':host{display:block;position:relative;min-height:var(--hk-sec-min,360px)}',
          '.col{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px}',
          'hk-plate.hd.shome{height:auto;flex:1 1 0;min-height:0;padding:20px;container-name:shome}',
          '.in{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,357px) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:22px}',
          'hk-plate.hd.care{height:auto;flex:none;padding:' + C.CARD.pad + ';flex-direction:row;align-items:center;gap:14px}',
          '.hi{display:flex;flex-direction:column;min-width:0;min-height:0}',
          '.hi .lab{' + C.labelCss('label-small') + '}',
          '.stage{flex:1 1 auto;min-height:0;box-sizing:border-box;padding:24px 0 34px;container-type:size;display:flex;align-items:center}',
          '.pic{position:relative;width:min(100cqw,calc(100cqh * var(--ar)));aspect-ratio:var(--ar);margin:0 auto}',
          '.pic img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 10px 18px rgba(0,0,0,.3))}',
          '.wire{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}',
          // a label: the Power page's chip material, small
          '.co{position:absolute;translate:-50% -50%;padding:6px 10px;border-radius:' + R.inner + 'px;white-space:nowrap;cursor:pointer;z-index:1;',
          '  background:' + v('float-plate') + ';-webkit-backdrop-filter:var(--hk-float-backdrop,' + B.medium + ');backdrop-filter:var(--hk-float-backdrop,' + B.medium + ');',
          '  border:1px solid ' + v('line') + ';box-shadow:0 6px 16px rgba(0,0,0,0.25);-webkit-tap-highlight-color:transparent}',
          '.co b{display:block;font-size:11px;font-weight:600}',
          '.co span{display:block;font-size:11px;color:' + v('ink-2') + ';margin-top:2px}',
          '.co.warn span{color:' + v('warn') + '}',
          '.ap{min-width:0;min-height:0;display:flex;flex-direction:column}',
          // EXPAND / COLLAPSE: every event a line of its own, or an open folded
          // into its close -- a small capsule after the count
          '.ap .ttl{align-items:center}',
          '.ap .ttl .cnt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:right}',
          '.xp{appearance:none;font:inherit;font-size:13px;font-weight:600;color:' + v('ink') + ';background:' + v('key') + ';',
          '  border:1px solid ' + v('line') + ';height:26px;padding:0 11px;border-radius:' + R.capsule('26px') + ';cursor:pointer;flex:none;',
          '  -webkit-tap-highlight-color:transparent;transition:transform .12s ease}',
          '.xp:active{transform:scale(0.97);background:' + v('key-strong') + '}',
          '.xp[aria-pressed=true]{background:' + v('key-strong') + '}',
          // (its edges: the sheet's shadows, BASE_CSS .hk-edge -- was a fade; pan-y: a sideways swipe over it is the page's, 2026-11-08)
          '.lst{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;scrollbar-width:none;padding-bottom:12px}',
          '.lst::-webkit-scrollbar{display:none}',
          '.ar{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid ' + v('line') + '}',
          '.ar:last-child{border-bottom:0}',
          '.ar .tx{flex:1;min-width:0}',
          // the row's glyph on its own, in its state's color (no well: the
          // user, 2026-10-16)
          '.ar .gl{--mdc-icon-size:20px;width:20px;height:20px;flex:none;display:flex;color:var(--a)}',
          '.ar b{display:block;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.ar .s{display:block;margin-top:3px;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.ar time{flex:none}',
          '.none{margin-top:12px;font-size:13px;color:' + v('ink-2') + '}',
          // device care
          '.care .tx{flex:1;min-width:0}',
          '.care .lab{' + C.labelCss('label-small') + ';margin-bottom:4px}',
          '.care b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.care p{margin:3px 0 0;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          // narrower (an iPad beside the keypad): the house over the activity
          '@container shome (max-width:600px){.in{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(150px,1.1fr) minmax(0,1fr);gap:6px}.stage{padding:6px 0 4px}}',
          '@container shome (max-width:420px){.co,.wire path{display:none}}',
          // a phone: the column takes its own height
          '@media (max-width:' + C.BP.phone + 'px){:host{height:auto;min-height:0}.col{position:static}',
          '  hk-plate.hd.shome{flex:none;height:560px}hk-plate.hd.care{min-height:0}}'
        ].join('');
      }
      _ids() { return this._watch || []; }
      // EXPANDED OR GROUPED: this screen's own choice (the browser's storage --
      // a tablet and a phone each keep theirs), grouped until asked
      _expanded() {
        if (this._xp === undefined) {
          try { this._xp = window.localStorage.getItem(XP_KEY) === '1'; } catch (e) { this._xp = false; }
        }
        return this._xp;
      }
      _setExpanded(on) {
        this._xp = !!on;
        try { window.localStorage.setItem(XP_KEY, on ? '1' : '0'); } catch (e) { /* private mode: for this page only */ }
        this.redraw();
      }
      _shell() {
        if (this._built) return;
        this._root.innerHTML = '<div class="col"><hk-plate class="hd shome" data-hk-role="card"></hk-plate><hk-plate class="hd care" data-hk-role="card"></hk-plate></div>';
        this._card = this._root.querySelector('.shome');
        this._care = this._root.querySelector('.care');
        var self = this;
        this._root.addEventListener('click', function (e) {
          var xp = e.target && e.target.closest ? e.target.closest('[data-expand]') : null;
          if (xp) { e.stopPropagation(); self._setExpanded(!self._expanded()); return; }
          // DEVICE CARE'S DETAILS, for more than one: the list the status
          // chips open (hk-detail.js openGroup), every one that needs looking
          // after, each opening its own sheet and coming back to the list
          var care = e.target && e.target.closest ? e.target.closest('[data-care]') : null;
          var D = window.hkDetail;
          if (care && D && D.openGroup && (self._careIds || []).length > 1) {
            e.stopPropagation();
            D.openGroup('Device Care', self._careIds.slice(), { icon: 'hk:alert-circle', color: P.yellow,
              resolve: function () { return self._careIds && self._careIds.length ? { title: 'Device Care', ids: self._careIds.slice() } : null; } });
            return;
          }
          var t = e.target && e.target.closest ? e.target.closest('[data-more]') : null;
          var id = t && t.getAttribute('data-more');
          if (!id) return;
          e.stopPropagation();
          window.hkShell.moreInfo(id, self);
        });
        this._built = true;
      }
      _render() {
        this._shell();
        var h = this.client, c = this._config || {}, self = this;
        if (!h) return;
        var cfg = header('security'), now = Date.now();
        var ways = waysIn(h, c, cfg);
        var wayIds = [];
        Object.keys(ways).forEach(function (k) { wayIds = wayIds.concat(ways[k]); });
        var alarm = c.alarm || hs('security.alarm', null);
        var activity = (c.locks || []).concat((c.garage || []).filter(function (id) { return id.indexOf('cover.') === 0; }), wayIds,
            c.doors || [], c.windows || [], c.leaks || [], alarm ? [alarm] : [])
          .filter(function (id, i, a) { return id && a.indexOf(id) === i && h.states[id]; });
        var careIds = (c.locks || []).concat(c.doors || [], c.windows || [], c.garage || [], c.leaks || []).filter(function (id, i, a) { return a.indexOf(id) === i && h.states[id]; });
        this._watch = activity.concat(careIds);
        // ---- the picture
        var base = c.art || '/hk/power-house/';
        if (base.slice(-1) !== '/') base += '/';
        if (this._art === undefined) { this._art = null; artOf(base, function (j) { self._art = j; self.redraw(); }); }
        var A = this._art || {}, L = (A.layers || {}).house, D = A.doors || {};
        var pic = '';
        if (L) {
          var lx = L[1], ly = L[2], lw = L[3], lh = L[4];
          var px = function (p) { return [p[0] - lx, p[1] - ly]; };
          var wire = '', tags = '';
          if (cfg.callouts !== false) {
            Object.keys(WAYS).forEach(function (k) {
              var d = D[k], ids = ways[k];
              if (!d || !d.at || !d.tag || !ids || !ids.length) return;
              var w = wayState(h, ids), at = px(d.at), tg = px(d.tag), col = w.warn ? v('warn') : P.mint;
              wire += '<path d="M' + tg[0] + ' ' + tg[1] + 'L' + at[0] + ' ' + at[1] + '" stroke="rgba(255,255,255,0.5)" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
                '<circle cx="' + at[0] + '" cy="' + at[1] + '" r="' + (lw / 70).toFixed(1) + '" fill="' + col + '" fill-opacity=".25"/>' +
                '<circle cx="' + at[0] + '" cy="' + at[1] + '" r="' + (lw / 128).toFixed(1) + '" fill="' + col + '"/>';
              tags += '<div class="co' + (w.warn ? ' warn' : '') + '" data-more="' + esc(w.main ? w.main.entity_id : ids[0]) + '" style="left:' +
                (tg[0] / lw * 100).toFixed(2) + '%;top:' + (tg[1] / lh * 100).toFixed(2) + '%"><b>' + esc(WAYS[k].name) + '</b><span>' + w.word +
                (w.t && now - w.t < DAY ? ' · ' + hm(w.t) : '') + '</span></div>';
            });
          }
          pic = '<div class="stage"><div class="pic" style="--ar:' + (lw / lh).toFixed(4) + '"><img src="' + esc(base + L[0]) + '" alt="" decoding="async">' +
            '<svg class="wire" viewBox="0 0 ' + lw + ' ' + lh + '" preserveAspectRatio="none" aria-hidden="true">' + wire + '</svg>' + tags + '</div></div>';
        }
        // ---- today's activity, from the logbook -- and, while today has been
        // quiet (just after midnight), the last day's, said to be yesterday's
        var m0 = midnight(), from = Math.min(m0, now - DAY);
        this._load('log', 2 * MIN, function () {
          return activity.length ? h.callWS({ type: 'logbook/get_events', start_time: new Date(from).toISOString(), entity_ids: activity }) : [];
        });
        var lastOf = {};
        var evs = (this._log || []).filter(function (e) {
          if (!e.entity_id || !LOG_WORD[e.state]) return false;
          // the same state said again (Home Assistant restarting) is not news;
          // nor is a leak sensor's "dry" that follows no leak (its first report
          // after a restart)
          var was = lastOf[e.entity_id], same = was === e.state;
          lastOf[e.entity_id] = e.state;
          if (e.state === 'off' && was !== 'on' && kindOf(h, e.entity_id, alarm) === 'leak') return false;
          return !same && e.when * 1000 >= from;
        });
        var today = evs.some(function (e) { return e.when * 1000 >= m0; });
        if (today) evs = evs.filter(function (e) { return e.when * 1000 >= m0; });
        evs.reverse();
        var rows = [], used = {}, seen = {}, expanded = this._expanded();
        var label = function (id) {
          // a name given in Settings is said as given; Home Assistant's loses its "Lock" / "Sensor"
          var own = ownName(id);
          var nm = own || nameOf(h, id).replace(/ (Lock|Entry|Door Input|Contact|Sensor)$/i, '');
          if (id === alarm) nm = 'Alarm';
          // a door contact reads as its way in ("Front Door", not "Front Door Entry") -- unless it was renamed
          if (!own && id.indexOf('binary_sensor.') === 0) Object.keys(ways).forEach(function (k) { if (ways[k].indexOf(id) >= 0) nm = WAYS[k].name; });
          return nm;
        };
        var forLong = function (ms) { return ms < MIN ? Math.max(1, Math.round(ms / 1000)) + ' seconds' : dur(ms).replace(/ min$/, ' minutes'); };
        evs.forEach(function (e, i) {
          if (used[i]) return;
          var id = e.entity_id, t = e.when * 1000, sub = '';
          var kind = kindOf(h, id, alarm);
          var pair = { off: 'on', closed: 'open', locked: 'unlocked' }[e.state];
          if (pair) {
            for (var j = i + 1; j < evs.length; j++) if (evs[j].entity_id === id) {
              if (evs[j].state === pair) {
                // grouped, the open or unlock is folded into this row;
                // expanded, it keeps a row of its own (this one still says how long)
                if (!expanded) used[j] = 1;
                sub = (e.state === 'locked' ? 'Unlocked for ' : kind === 'leak' ? 'Wet for ' : 'Open for ') + forLong(t - evs[j].when * 1000);
              }
              break;
            }
          } else if (id === alarm) {
            for (var q = i + 1; q < evs.length; q++) if (evs[q].entity_id === id) { sub = 'Previously ' + (LOG_WORD[evs[q].state] || evs[q].state); break; }
          }
          if (!sub && e.context_name) sub = 'by ' + e.context_name;
          var nm = label(id);
          if (kind === 'leak') nm = nm.replace(/ (Water )?Leak( Sensor)?( Moisture)?$/i, '');
          var word = kind === 'leak' ? (e.state === 'on' ? 'leak detected' : 'dry again') : LOG_WORD[e.state];
          var key = nm.replace(/ Door$/, '') + '|' + word + '|' + Math.round(t / MIN);
          if (seen[key]) return;
          seen[key] = 1;
          var g = rowGlyph(kind, e.state);
          rows.push('<div class="ar" data-more="' + esc(id) + '"><hk-icon class="gl" style="--a:' + g.color + '" icon="' + g.icon + '"></hk-icon>' +
            '<div class="tx"><b>' + esc(nm + ' ' + word) + '</b>' + (sub ? '<span class="s">' + esc(sub) + '</span>' : '') + '</div><time class="mi">' +
            (t < m0 ? 'Yesterday ' : '') + hm(t) + '</time></div>');
        });
        this._paint('<div class="in"><div class="hi"><div class="lab">Your Home</div>' + pic + '</div>' +
          '<div class="ap"><div class="ttl"><b>Recent Activity</b><span class="cnt">' +
            (!rows.length ? 'today' : today ? rows.length + ' today' : rows.length + (rows.length === 1 ? ' event' : ' events')) + '</span>' +
            (rows.length ? '<button class="xp" data-expand aria-pressed="' + expanded + '">' + (expanded ? 'Collapse' : 'Expand') + '</button>' : '') + '</div>' +
          (rows.length ? '<div class="hk-edge"><div class="lst">' + rows.join('') + '</div></div>' : '<div class="none">' +
            (this._log ? 'Nothing opened, unlocked or wet today.' : 'Reading today’s activity…') + '</div>') + '</div></div>');
        // ---- device care
        var quiet = careIds.filter(function (id) { return goneQuiet(h, id, now); });
        var low = [], lim = cfg.low_battery || 20, devs = {};
        careIds.forEach(function (id) { var e = h.entities && h.entities[id]; if (e && e.device_id) devs[e.device_id] = id; });
        var bats = this._bats;
        if (!bats || this._batsAt !== careIds.join(',')) {
          // the battery sensors on the care entities' own devices (once per
          // list: a walk of every entity)
          bats = this._bats = [];
          this._batsAt = careIds.join(',');
          if (h.entities) Object.keys(h.entities).forEach(function (id) {
            var e = h.entities[id], s = h.states[id];
            if (e.device_id && devs[e.device_id] && id.indexOf('sensor.') === 0 && s && s.attributes.device_class === 'battery') bats.push([id, devs[e.device_id]]);
          });
        }
        bats.forEach(function (b) {
          var s = h.states[b[0]], n = s && num(s.state);
          if (n != null && n <= lim) low.push({ id: b[0], n: n, of: b[1] });
        });
        this._watch = this._watch.concat(bats.map(function (b) { return b[0]; }));
        low.sort(function (a, b) { return a.n - b.n; });
        var item = null;
        if (low.length) {
          var dn = (h.devices && h.entities[low[0].id] && h.devices[h.entities[low[0].id].device_id]) || {};
          item = { id: low[0].id, icon: 'hk:battery-alert-variant-outline', b: (dn.name_by_user || dn.name || nameOf(h, low[0].of)) + ' battery · ' + Math.round(low[0].n) + '%',
                   p: low.length > 1 ? 'And ' + (low.length - 1) + ' more low. Replace soon to keep them reporting.' : 'Replace soon to keep it reporting.' };
        } else if (quiet.length) {
          item = { id: quiet[0], icon: 'hk:alert-circle', b: quiet.length + (quiet.length === 1 ? ' sensor isn’t reporting' : ' sensors aren’t reporting'),
                   p: quiet.slice(0, 3).map(function (id) { return nameOf(h, id).replace(/ (Water Leak Sensor.*|Sensor|Contact|Door Sensor)$/i, ''); }).join(', ') +
                      (quiet.length > 3 ? ' and ' + (quiet.length - 3) + ' more' : '') + ' — check power or signal.' };
        }
        // everything that needs looking after: the low batteries, then the quiet
        this._careIds = low.map(function (x) { return x.id; }).concat(quiet.filter(function (id) {
          return !low.some(function (x) { return x.of === id; });
        }));
        this._care.style.display = item ? '' : 'none';
        if (item) {
          if (low.length && quiet.length) item.p = item.p.replace(/\.$/, '') + ' · ' + quiet.length + (quiet.length === 1 ? ' sensor isn’t reporting.' : ' sensors aren’t reporting.');
          C.morph(this._care, '<div class="well" style="--a:' + P.yellow + '"><hk-icon icon="' + item.icon + '"></hk-icon></div><div class="tx"><div class="lab">Device Care</div><b>' + esc(item.b) +
            '</b><p>' + esc(item.p) + '</p></div>' +
            '<button class="pill"' + (this._careIds.length > 1 ? ' data-care' : '') + ' data-more="' + esc(item.id) + '">' + (this._careIds.length > 1 ? 'Show All' : 'Details') + '</button>');
        }
      }
    }

    // ================================================ THE UTILITY PAGES (2026-10-16)
    // Vacuums, Timers and Water open with header cards too
    // (hk_house/docs/PLAN-2026-10-16-utility-pages.md): the same material, the
    // same 240 px, the same three columns. Every figure is read from the house
    // -- the vacuums' own state history, the timers' deadlines, the Energy
    // settings' water meter, the valve -- and what cannot be known is said, not
    // guessed: a vacuum with no completion counter is "back on its dock", never
    // "completed"; an hour the meter has not reported is "No reading", never 0.
    function dayName(t) { return new Date(t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'long' })); }
    function dayShort(t) { return new Date(t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short' })); }
    // "Today · 9:42 AM", "Yesterday · 11:04 AM", "Tuesday · 2:18 PM"
    function whenText(t, now) {
      var d0 = midnight(now), d = midnight(t);
      var day = d === d0 ? 'Today' : d === midnight(d0 - HOUR * 12) ? 'Yesterday' :
        now - t < 6 * DAY ? dayName(t) : new Date(t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ month: 'short', day: 'numeric' }));
      return day + ' · ' + hm(t);
    }
    // the local midnight `k` days before today's (a calendar step: DST-safe)
    function daysBack(k, now) { var d = new Date(midnight(now)); d.setDate(d.getDate() - k); return d.getTime(); }
    function overlap(sp, a, b) {
      return sp.reduce(function (m, s) { return m + Math.max(0, Math.min(b, s[1]) - Math.max(a, s[0])); }, 0);
    }
    // compressed history -> [[t, state]]
    function pts(list) { return (list || []).map(function (x) { return [(x.lu || x.lc) * 1000, x.s]; }); }
    // a counter's steps up: [t, ...] wherever it rose
    function rises(list) {
      var out = [], last = null;
      pts(list).forEach(function (p) {
        var n = num(p[1]);
        if (n === null) return;
        if (last !== null && n > last) out.push(p[0]);
        last = n;
      });
      return out;
    }
    var VAC_OK = { no_error: 1, none: 1, ok: 1, unknown: 1, unavailable: 1, '': 1 };
    var RUN_GAP = 20 * MIN;           // back to the dock to wash or charge, then on: one run
    var SETTLE = 45 * MIN;            // how long after a run its outcome is looked for
    // THE RUNS of one vacuum: its `cleaning` spans, those less than RUN_GAP
    // apart joined (a mop wash, a recharge), each with how it ended:
    //   done      the vacuum's own success counter rose (a Roomba's missions)
    //   failed    its failure counter rose, or it reported an error
    //   canceled  its cancel counter rose
    //   docked    it went back to its dock with no error -- the most a vacuum
    //             without a counter can say: a run stopped early docks too
    //   stopped   it ended somewhere other than the dock
    //   running   it is cleaning now
    function vacRuns(v, H, now) {
      var s = pts(H[v.entity]);
      if (!s.length) return [];
      var sp = spans(s.map(function (p) { return [p[0], p[1]]; }), s[0][0], now, function (p) { return p[1] === 'cleaning'; });
      var runs = [];
      sp.forEach(function (x) {
        var r = runs[runs.length - 1];
        if (r && x[0] - r.end < RUN_GAP) { r.end = x[1]; r.parts.push(x); }
        else runs.push({ start: x[0], end: x[1], parts: [x] });
      });
      var ok = rises(H[v.success]), bad = rises(H[v.failed]), cut = rises(H[v.canceled]);
      var errs = pts(H[v.error]).filter(function (p) { return !VAC_OK[p[1]]; }).map(function (p) { return [p[0], p[1]]; });
      var within = function (list, a, b) { return list.some(function (t) { return t >= a && t <= b; }); };
      runs.forEach(function (r) {
        r.clean = total(r.parts);
        var a = r.start, b = r.end + SETTLE;
        var last = s[s.length - 1];
        if (r.end >= now - 1000 && last && last[1] === 'cleaning') { r.out = 'running'; return; }
        var err = errs.filter(function (p) { return p[0] >= a && p[0] <= b; })[0];
        var errState = s.some(function (p) { return p[1] === 'error' && p[0] >= a && p[0] <= b; });
        if (within(ok, r.end - 2 * MIN, b)) r.out = 'done';
        else if (within(bad, a, b)) r.out = 'failed';
        else if (within(cut, a, b)) r.out = 'canceled';
        else if (err || errState) { r.out = 'failed'; r.why = err ? String(err[1]).replace(/_/g, ' ') : ''; }
        else if (s.some(function (p) { return p[1] === 'docked' && p[0] >= r.end && p[0] <= b; })) r.out = 'docked';
        else r.out = 'stopped';
      });
      return runs;
    }
    var OUT_WORD = { done: 'Completed', failed: 'Error', canceled: 'Canceled', docked: 'Back on dock',
                     stopped: 'Stopped', running: 'Cleaning now' };
    function vacName(h, id) {
      return nameOf(h, id).replace(/\s*(robot\s*)?vacuum$/i, '') || nameOf(h, id);
    }
    // the vacuums' history, shared by the page's two cards: one ask
    var VACH = { key: null, at: 0, data: null, wait: null, cards: new Set() };
    function vacHistory(card, h, list) {
      VACH.cards.add(card);
      var ids = [];
      list.forEach(function (v) { [v.entity, v.success, v.failed, v.canceled, v.error].forEach(function (x) { if (x && ids.indexOf(x) < 0) ids.push(x); }); });
      var key = ids.join(','), now = Date.now();
      if ((VACH.key !== key || now - VACH.at > 5 * MIN) && !VACH.wait) {
        VACH.at = now;
        // a month asked; the recorder answers with what it keeps (14 days here)
        var from = daysBack(30, now);
        VACH.wait = h.callWS({ type: 'history/history_during_period', start_time: new Date(from).toISOString(),
          end_time: new Date(now).toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true,
          significant_changes_only: false }).then(function (r) {
          VACH.key = key; VACH.data = { from: from, H: r || {} }; VACH.wait = null;
          VACH.cards.forEach(function (c) { if (c.isConnected) c.redraw(); else VACH.cards.delete(c); });
        }, function (e) { VACH.wait = null; VACH.at = now - 4 * MIN; console.warn('[hk-headers] vacuum history', e); });
      }
      return VACH.key === key ? VACH.data : null;
    }

    // ------------------------------------------- VACUUMS: CLEANING THIS WEEK
    // The last seven days, a bar each: how long the vacuums cleaned, every
    // vacuum's time added together (two cleaning at once is twice the
    // cleaning). Mopping is cleaning: the vacuum's `cleaning` state, whatever
    // its mode. Against the seven days before, to the same hour -- left out
    // when the history does not reach back that far.
    class HkVacuumWeekCard extends HeaderCard {
      static get PART_CSS() {
        return BARS_CSS + [
          '.tot{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-top:10px;flex:none;min-width:0}',
          '.tot .cap{margin-top:4px}',
          '.cmp{font-size:13px;line-height:18px;color:' + v('ink-2') + ';text-align:right;min-width:0}',
          '.grow{flex:1;min-height:6px}',
          // EACH DAY ITS LETTER AND ITS TIME under its bar (Energy's Your Week)
          '.bl{height:28px}',
          '.bl span{display:flex;flex-direction:column;align-items:center;gap:4px}',
          '.bl span em{font-style:normal;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums}',
          '.bl span.now em{color:' + v('ink') + '}',
          // the foot: the readout, and which color is which vacuum
          '.ft{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;min-width:0}',
          '.ft .rd{margin-top:0;flex:1;min-width:0}',
          '.lg{display:flex;gap:12px;font-size:11px;font-weight:600;color:' + v('ink-2') + ';white-space:nowrap;flex:none}',
          '.lg span{display:flex;align-items:center;gap:5px}',
          '.lg i{width:8px;height:8px;border-radius:50%}',
          '@container (max-width:' + C.BP.cardSide + 'px){.lg{display:none}}'
        ].join('');
      }
      _list() { return ((this._config || {}).vacuums || []).filter(function (x) { return x && x.entity; }); }
      _ids() { return this._list().map(function (x) { return x.entity; }); }
      disconnectedCallback() { super.disconnectedCallback(); VACH.cards.delete(this); }
      _render() {
        this._shell('vweek');
        var h = this.client;
        if (!h) return;
        var list = this._list().filter(function (x) { return h.states[x.entity]; });
        var head0 = '<div class="ttl"><b>Cleaning This Week</b><span>Last 7 days</span></div>';
        if (!list.length) return this._paint(head0 + '<div class="wait">No vacuums</div>');
        var D = vacHistory(this, h, list), avail = Math.max(120, this._width());
        if (!D) return this._paint(head0 + '<div class="wait">Loading the week…</div>');
        var now = Date.now(), H = D.H;
        var per = list.map(function (v) {
          var s = pts(H[v.entity]);
          return { v: v, name: vacName(h, v.entity), first: s.length ? s[0][0] : Infinity,
                   sp: s.length ? spans(s, s[0][0], now, function (p) { return p[1] === 'cleaning'; }) : [] };
        });
        // AS MANY DAYS AS THE CARD HOLDS (2026-10-16, the user: the wider it
        // goes, the more days): a day each 58 px (its bar, its gap, "3h 54m"
        // under it), never fewer than seven, never more than the history has
        // (the recorder's keep: 14 days in this house) nor a month
        var first = Math.min.apply(null, per.map(function (p) { return p.first; }));
        var have = 1;
        while (have < 31 && daysBack(have, now) + MIN >= first) have++;
        var n = Math.max(7, Math.min(Math.floor((avail + 14) / 58), have, 31));
        var days = [];
        for (var k = n - 1; k >= 0; k--) {
          var a = daysBack(k, now), b = k ? daysBack(k - 1, now) : now;
          days.push({ a: a, b: b, by: per.map(function (p) { return overlap(p.sp, a, b); }),
                      known: per.some(function (p) { return p.first <= a + MIN; }) || k === 0 });
        }
        days.forEach(function (d) { d.t = d.by.reduce(function (x, y) { return x + y; }, 0); });
        var week = days.reduce(function (x, d) { return x + d.t; }, 0);
        var head = '<div class="ttl"><b>' + (n === 7 ? 'Cleaning This Week' : 'Cleaning by Day') + '</b><span>Last ' + n + ' days</span></div>';
        // the same number of days before, to this same hour, if the history reaches
        var pa = daysBack(2 * n - 1, now), pb = now - n * DAY, cmp = '';
        if (per.every(function (p) { return p.first <= pa + MIN; })) {
          var prev = per.reduce(function (x, p) { return x + overlap(p.sp, pa, pb); }, 0), diff = week - prev;
          var than = n === 7 ? ' than last week' : ' than the ' + n + ' days before';
          cmp = Math.abs(diff) < 5 * MIN ? 'About the same as' + (n === 7 ? ' last week' : ' the ' + n + ' days before') :
            dur(Math.abs(diff)) + (diff < 0 ? ' less' : ' more') + than;
        }
        // EACH VACUUM ITS COLOR, stacked: whose cleaning a day was
        var VC = ['purple', 'teal', 'orange', 'pink', 'blue'].map(function (k) { return 'rgba(' + C.PALETTE.chart[k].join(',') + ',0.8)'; });
        var last = n - 1;
        // more than a week: each day by its date too ("Sat 3"), the week's names repeating
        var lab = function (d, i) { return i === last ? 'Today' : dayShort(d.a) + (n > 7 ? ' ' + new Date(d.a).getDate() : ''); };
        var B = bars(days.map(function (d, i) {
          return { segs: per.map(function (pp, j) { return { v: d.by[j] / MIN, c: VC[j % VC.length] }; }), fut: !d.known,
                   label: lab(d, i) + '<em>' + (d.known ? (d.t < MIN ? '—' : shortDur(d.t)) : '·') + '</em>', now: i === last };
        }), avail, 48, 80);
        var legend = per.length > 1 ? '<div class="lg">' + per.map(function (pp, j) {
          return '<span><i style="background:' + VC[j % VC.length] + '"></i>' + esc(pp.name) + '</span>';
        }).join('') + '</div>' : '';
        this._nBars = n;
        this._nowI = last;
        this._rdRest = 'Hover or touch a day for its cleaning';
        var multi = list.length > 1;
        this._paint(head + '<div class="tot"><div><div class="big num">' + (week < MIN ? '0<u>min</u>' : durHtml(week)) + '</div>' +
          '<div class="cap">' + (multi ? 'Across your vacuums' : esc(per[0].name)) + '</div></div>' +
          (cmp ? '<div class="cmp">' + cmp + '</div>' : '') + '</div><div class="grow"></div>' +
          '<div class="bc">' + B.html + '</div><div class="ft"><div class="rd">' + this._rdRest + '</div>' + legend + '</div>');
        hourScrub(this, this._card.querySelector('.bc'), function (i) {
          var d = days[i], lab = i === last ? 'Today' : dayName(d.a) + (n > 7 ? ' ' + new Date(d.a).getDate() : '');
          if (!d.known) return lab + ' · No history';
          if (d.t < MIN) return lab + ' · No cleaning';
          return lab + ' · ' + dur(d.t) + (multi ? ' · ' + per.map(function (p, j) {
            return d.by[j] >= MIN ? p.name + ' ' + dur(d.by[j]) : null;
          }).filter(Boolean).join(', ') : '');
        }, 'Cleaning by day');
      }
    }

    // ---------------------------------------------- VACUUMS: LAST COMPLETED
    // Each vacuum's latest run: when, how long it cleaned, and how it ended,
    // in the words vacRuns allows. "Last Completed" only when every row is a
    // confirmed completion; otherwise "Last Runs".
    class HkVacuumLastCard extends HeaderCard {
      static get PART_CSS() {
        return [
          '.rows{flex:1;display:flex;flex-direction:column;justify-content:flex-start;margin-top:6px;min-height:0}',
          '.vr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:7px 0}',
          '.vr:last-child{padding-bottom:0}',
          '.vr+.vr{border-top:1px solid ' + v('line') + '}',
          '.vr b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.vr .s{display:block;margin-top:2px;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.vr .s em{font-style:normal;color:' + v('warn') + '}',
          '.vr strong{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}',
          '.more{margin-top:auto;font-size:13px;color:' + v('ink-2') + '}'
        ].join('');
      }
      _list() { return ((this._config || {}).vacuums || []).filter(function (x) { return x && x.entity; }); }
      _ids() { return this._list().map(function (x) { return x.entity; }); }
      disconnectedCallback() { super.disconnectedCallback(); VACH.cards.delete(this); }
      _render() {
        this._shell('vlast');
        var h = this.client;
        if (!h) return;
        var list = this._list().filter(function (x) { return h.states[x.entity]; });
        if (!list.length) return this._paint('<div class="ttl"><b>Last Runs</b></div><div class="wait">No vacuums</div>');
        var D = vacHistory(this, h, list);
        if (!D) return this._paint('<div class="ttl"><b>Last Runs</b></div><div class="wait">Loading…</div>');
        var now = Date.now();
        var rows = list.map(function (v) {
          var runs = vacRuns(v, D.H, now);
          var st = h.states[v.entity].state;
          // cleaning now: that, and the run before it
          var cur = runs.length && runs[runs.length - 1].out === 'running' ? runs.pop() : null;
          var last = runs[runs.length - 1] || null;
          return { v: v, name: vacName(h, v.entity), last: last, cur: cur, st: st, at: cur ? cur.start : last ? last.end : 0 };
        });
        var fit = 3, shown = rows.slice().sort(function (a, b) { return b.at - a.at; }).slice(0, fit);
        // in the page's order, the most recent three
        shown = rows.filter(function (r) { return shown.indexOf(r) >= 0; });
        var confirmed = shown.every(function (r) { return !r.cur && r.last && r.last.out === 'done'; });
        // the span the history covers (the recorder's keep)
        var f0 = Math.min.apply(null, list.map(function (v) { var p0 = pts(D.H[v.entity]); return p0.length ? p0[0][0] : now; }));
        var span = Math.max(1, Math.round((now - f0) / DAY)), spanText = span === 14 ? 'Past 2 weeks' : span === 7 ? 'Past week' : 'Past ' + span + ' days';
        var html = '<div class="ttl"><b>' + (confirmed ? 'Last Completed' : 'Last Runs') + '</b><span>' + spanText + '</span></div><div class="rows">' +
          shown.map(function (r) {
            var s, right = '';
            if (r.cur) { s = 'Cleaning now · since ' + hm(r.cur.start); right = shortDur(now - r.cur.start); }
            else if (r.last) {
              var w = OUT_WORD[r.last.out] + (r.last.why ? ': ' + r.last.why : '');
              s = esc(whenText(r.last.end, now)) + ' · ' + (r.last.out === 'failed' || r.last.out === 'stopped' ? '<em>' + esc(w) + '</em>' : esc(w));
              right = shortDur(r.last.clean);
            } else s = 'No runs in the ' + spanText.toLowerCase();
            return '<div class="vr" data-more="' + esc(r.v.entity) + '" role="button" tabindex="0"><div style="min-width:0"><b>' + esc(r.name) +
              '</b><span class="s">' + s + '</span></div><strong>' + right + '</strong></div>';
          }).join('') + '</div>' + (rows.length > fit ? '<div class="more">' + (rows.length - fit) + ' more on the page</div>' : '');
        this._paint(html);
        keyOpen(this);
      }
    }
    // Enter or Space on a row marked data-more opens it, as a tap does
    function keyOpen(card) {
      if (card._keyed || !card._card) return;
      card._keyed = true;
      card._card.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var t = e.target && e.target.closest ? e.target.closest('[data-more]') : null;
        if (!t) return;
        e.preventDefault();
        t.click();
      });
    }

    // --------------------------------------------- TIMERS: FINISHING ORDER
    // ONE LINE THROUGH NOW (2026-10-16, the user: show the timers before
    // too, and more than three): the timers that ended in the last day on the
    // left, dimmed, then a Now mark, then the running ones soonest first --
    // when each finishes and how long is left. An order, not a time scale: the
    // steps are equal. As many as the card's width holds (130 px each); the
    // running ones first, the most recent past ones in what is left. Paused
    // timers have no deadline: counted, not placed. With nothing running the
    // line is the day's timers, so the card still says something.
    // "Ended", never "finished": history cannot tell a timer that ran out from
    // one canceled.
    function timerLabel(h, t) {
      var st = h.states[t.entity] || {};
      var raw = t.label_entity ? ((h.states[t.label_entity] || {}).state || '') : '';
      var given = ['', 'unknown', 'unavailable'].indexOf(String(raw).trim()) >= 0 ? '' : String(raw).trim();
      return given || t.label || (st.attributes || {}).friendly_name || t.entity;
    }
    // the runs that ended: [{t, start, end, name}] from compressed history
    function timerRuns(list, H, h) {
      var out = [];
      list.forEach(function (t) {
        var s = pts(H[t.entity]), names = pts(t.label_entity ? H[t.label_entity] : null), start = null;
        s.forEach(function (p, i) {
          var on = p[1] === 'active' || p[1] === 'paused';
          if (on && start === null && i > 0) start = p[0];
          if (!on && start !== null) {
            // its name as it was while it ran (a quick timer's slot is renamed for each)
            var nm = null;
            names.forEach(function (q) { if (q[0] <= start + 5000) nm = q[1]; });
            var given = nm && ['unknown', 'unavailable', ''].indexOf(String(nm).trim()) < 0 ? String(nm).trim() : '';
            if (p[0] - start >= MIN) out.push({ t: t, start: start, end: p[0], name: given || t.label || nameOf(h, t.entity) });
            start = null;
          }
        });
      });
      return out.sort(function (a, b) { return a.end - b.end; });
    }
    var EV_MIN = 130;

    // what the shell and the later parts use of this one
    K.dayShort = dayShort; K.EV_MIN = EV_MIN; K.HkSecurityOverviewCard = HkSecurityOverviewCard;
    K.HkVacuumLastCard = HkVacuumLastCard; K.HkVacuumWeekCard = HkVacuumWeekCard; K.keyOpen = keyOpen;
    K.timerLabel = timerLabel; K.timerRuns = timerRuns; K.vacRuns = vacRuns;
  };
})();
