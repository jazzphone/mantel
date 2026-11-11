// hk-headers-timers-water.js - the timers and water headers.
//
// PART OF THE PAGE HEADERS (hk-headers.js). Not a card and not run on its own: it registers one
// function, which hk-headers.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkHeadersParts = window.hkHeadersParts || {})['hk-headers-timers-water'] = function (K) {
    var bars = K.bars, BARS_CSS = K.BARS_CSS, C = K.C, COOL = K.COOL, DAY = K.DAY, dayShort = K.dayShort, dur = K.dur,
        esc = K.esc, EV_MIN = K.EV_MIN, HeaderCard = K.HeaderCard, hm = K.hm, HOUR = K.HOUR,
        HOUR_LABELS = K.HOUR_LABELS, hourScrub = K.hourScrub, keyOpen = K.keyOpen, midnight = K.midnight, MIN = K.MIN,
        P = K.P, R = K.R, timerLabel = K.timerLabel, timerRuns = K.timerRuns, v = K.v;

    class HkTimersOrderCard extends HeaderCard {
      static get PART_CSS() {
        return [
          '.sub{font-size:13px;color:' + v('ink-2') + ';margin-top:6px}',
          '.tl{flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-height:0}',
          '.evs{display:grid;grid-auto-flow:column;gap:18px}',
          '.ev{min-width:0;cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:8px}',
          '.ev.past{opacity:.55}',
          '.ev:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:3px}',
          '.ev time,.ev .in{display:block;font-size:13px;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.ev b{display:block;margin:4px 0;font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          // THE LINE: a dot per timer at its column's start -- the past ones
          // hollow, the running ones in the timers' color -- and Now between
          '.ln{position:relative;height:9px;margin-top:12px}',
          '.ln:before{content:"";position:absolute;left:0;right:0;top:4px;border-top:2px solid ' + v('line-strong') + '}',
          '.ln i{position:absolute;top:0;width:9px;height:9px;border-radius:50%;box-sizing:border-box;background:var(--tint)}',
          '.ln i.past{background:none;border:2px solid ' + v('mark') + '}',
          '.ln em{position:absolute;top:-4px;width:2px;height:17px;margin-left:-1px;background:' + v('ink') + '}',
          '.ft{position:relative;height:16px;margin-top:8px;font-size:13px;color:' + v('ink-2') + ';white-space:nowrap}',
          '.ft span{position:absolute;top:0}',
          '.ft .nw{color:' + v('ink') + ';font-weight:600}',
          '.none{margin:auto 0;font-size:15px;color:' + v('ink-2') + '}'
        ].join('');
      }
      _list() { return (this._config || {}).timers || []; }
      _ids() {
        var out = [];
        this._list().forEach(function (t) { out.push(t.entity); if (t.label_entity) out.push(t.label_entity); });
        return out;
      }
      _render() {
        this._shell('tord');
        var h = this.client, self = this;
        if (!h) return;
        var tint = (this._config || {}).tint || P.orange, now = Date.now();
        this._card.style.setProperty('--tint', tint);
        var all = this._list().filter(function (t) { return h.states[t.entity]; });
        // THE DAY BEFORE: asked every 5 minutes, and again whenever a timer
        // starts or stops (so one that just ended joins the line at once)
        var key = all.map(function (t) { return t.entity + ':' + h.states[t.entity].state; }).join(',');
        if (this._pastKey !== key) { this._pastKey = key; if (this._at) this._at.past = 0; }
        if (all.length) {
          var pm = (this._config || {}).past, ids = this._ids().filter(function (id) {
            return h.states[id] && (!Array.isArray(pm) || !pm.length || pm.indexOf(id) >= 0 || /^input_text\./.test(id));
          });
          this._load('past', 5 * MIN, function () {
            return h.callWS({ type: 'history/history_during_period', start_time: new Date(Date.now() - DAY).toISOString(),
              end_time: new Date().toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true,
              significant_changes_only: false });
          });
        }
        var run = all.filter(function (t) { return h.states[t.entity].state === 'active'; }).map(function (t) {
          var end = Date.parse((h.states[t.entity].attributes || {}).finishes_at);
          return { t: t, end: isFinite(end) ? end : null, name: timerLabel(h, t) };
        }).filter(function (x) { return x.end !== null; }).sort(function (a, b) { return a.end - b.end; });
        var paused = all.filter(function (t) { return h.states[t.entity].state === 'paused'; }).length;
        // the past is the timers people start themselves (the quick timers and
        // the House Timers: `past`), not the automations' that cycle all day
        var mine = (this._config || {}).past;
        var pastList = Array.isArray(mine) && mine.length ? all.filter(function (t) { return mine.indexOf(t.entity) >= 0; }) : all;
        var past = this._past ? timerRuns(pastList, this._past, h) : [];
        var head = '<div class="ttl"><b>Finishing Order</b><span>' + (run.length ? run.length + ' running' : 'None running') +
          (paused ? ' · ' + paused + ' paused' : '') + '</span></div>';
        if (!run.length && !past.length) {
          return this._paint(head + '<div class="none">' + (this._past || !all.length ? 'Nothing has run in the last day.' : 'Loading the day…') +
            (paused ? ' ' + paused + ' paused below.' : ' Start one here or from House Timers.') + '</div>');
        }
        var w = this._width(), fit = Math.max(1, Math.min(6, Math.floor(((w || 680) + 18) / (EV_MIN + 18))));
        var up = run.slice(0, fit), rest = run.length - up.length;
        var back = past.slice(Math.max(0, past.length - (fit - up.length)));
        if (fit - up.length <= 0) back = [];
        var shown = back.map(function (x) { return { x: x, past: true }; }).concat(up.map(function (x) { return { x: x }; }));
        var n = shown.length, cols = Math.max(n, Math.min(fit, 4));
        var left = function (x) { var ms = x.end - now; return ms < MIN ? 'Under a minute' : 'In ' + dur(ms); };
        var ago = function (x) { return 'Ran ' + dur(x.end - x.start); };
        var when = function (t) { return midnight(t) === midnight(now) ? hm(t) : dayShort(t) + ' ' + hm(t); };
        // the columns' starts, as fractions of the line: equal steps
        var at = function (i) { return 'calc(' + i + ' * (100% + 18px) / ' + cols + ')'; };
        // nothing after it: Now ends the line
        var nowAt = back.length === n ? '100%' : back.length ? 'calc(' + back.length + ' * (100% + 18px) / ' + cols + ' - 9px)' : '0px';
        var sub = run.length ? (back.length ? 'Earlier, then what finishes next' : 'What finishes next') : 'Nothing running · the last day’s timers';
        var foot = rest ? rest + ' more in Running below' : '';
        this._paint(head + '<div class="sub">' + sub + '</div><div class="tl"><div class="evs" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' +
          shown.map(function (e) {
            var x = e.x;
            return e.past
              ? '<div class="ev past" data-more="' + esc(x.t.entity) + '" role="button" tabindex="0" aria-label="' +
                  esc(x.name + ', ended ' + when(x.end) + ', ' + ago(x)) + '"><time>Ended ' + when(x.end) + '</time><b>' + esc(x.name) +
                  '</b><span class="in">' + ago(x) + '</span></div>'
              : '<div class="ev" data-more="' + esc(x.t.entity) + '" role="button" tabindex="0" aria-label="' +
                  esc(x.name + ', finishes ' + hm(x.end) + ', ' + left(x)) + '"><time>' + hm(x.end) + '</time><b>' + esc(x.name) +
                  '</b><span class="in">' + left(x) + '</span></div>';
          }).join('') + '</div><div class="ln" aria-hidden="true">' + shown.map(function (e, i) {
            return '<i class="' + (e.past ? 'past' : '') + '" style="left:' + at(i) + '"></i>';
          }).join('') + '<em style="left:' + nowAt + '"></em></div><div class="ft"><span class="nw" style="left:' + nowAt +
          ';transform:translateX(' + (back.length === n ? '-100%' : back.length ? '-50%' : '0') + ')">Now</span>' +
          (foot ? '<span style="right:0">' + foot + '</span>' : '') + '</div></div>');
        keyOpen(this);
      }
    }

    // ------------------------------------------------ TIMERS: START A TIMER
    // The six quick durations, three across, and Create a Timer -- the
    // keypad, a name and its quick names in a sheet (hk-timer-new-card,
    // `layout: sheet`). Both through the quick-timer helpers, which answer
    // whether a timer started (all four slots busy says so).
    function minsLabel(m) {
      return m < 60 ? m + ' min' : (m % 60 ? Math.floor(m / 60) + ' hr ' + (m % 60) + ' min' : (m / 60) + ' hr');
    }
    function minsHms(m) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(Math.floor(m / 60)) + ':' + p(m % 60) + ':00'; }
    class HkTimersStartCard extends HeaderCard {
      static get PART_CSS() {
        return [
          '.ttl .hk-status{margin:0;min-height:0;font-size:13px;line-height:20px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.qs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:40px;gap:10px;margin-top:14px}',
          // the 40 px capsule of the selectable pills (hk-base .pill), on the
          // card's plate as a key, not as glass of its own
          '.qk{appearance:none;font:inherit;height:40px;border-radius:' + R.capsule('40px') + ';border:1px solid ' + v('line') + ';background:' + v('key') + ';',
          '  color:' + v('ink') + ';' + C.PILL_LABEL + ';cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px;',
          '  -webkit-tap-highlight-color:transparent;transition:transform ' + C.DUR.press + ' ease}',
          '.qk:active{transform:scale(0.96);background:' + v('key-strong') + '}',
          '.qk:disabled{opacity:.45;cursor:default}',
          '.mk{display:flex;align-items:center;gap:14px;margin-top:auto;min-width:0}',
          '.mk .new{flex:none;background:' + C.SELECTED_BG + ';color:' + C.SELECTED_TEXT + ';border-color:transparent;padding:0 18px;display:flex;align-items:center;gap:6px}',
          '.mk .new hk-icon{--mdc-icon-size:18px;width:18px;height:18px;display:flex}',
          // (the hint on one line, or not at all: in a narrow card it wrapped
          // to three beside the button)
          '.mk small{font-size:13px;line-height:17px;color:' + v('ink-2') + ';min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '@container (max-width:380px){.mk small{display:none}}',
          // FLAT: set into the card, as the presets are -- stone, not a white
          // button on the ivory (DESIGN.md "Raised or set in", 2026-10-17)
          ':host([hk-flat]) .mk .new{background:' + v('key') + ';color:' + v('ink') + ';border-color:' + v('line') + '}',
          'button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
          '@media (prefers-reduced-motion: reduce){.qk,.qk:active{transition:none;transform:none}}'
        ].join('');
      }
      _ids() { return []; }
      _presets() { return ((this._config || {}).presets || [5, 10, 15, 20, 30, 60]).slice(0, 6); }
      _script(key, dflt) {
        var ent = (this._config || {})[key] || dflt;
        return ent.indexOf('.') === -1 ? ['script', ent] : ent.split('.');
      }
      _quick(m) {
        var self = this, p = this._script('quick_script', 'script.quick_timer_start'), label = minsLabel(m);
        if (!this.client.states[p.join('.')]) { this._setStatus('failed', 'The quick-timer helpers are not installed.'); return this.redraw(); }
        if (!this._begin('Starting ' + label + '…')) return;
        this._callResp(p[0], p[1], { duration: minsHms(m) }).then(function (r) {
          self._end();
          if (!r.ok) self._setStatus('failed', 'Could not reach Home Assistant.');
          else if (r.response && r.response.started === false) self._setStatus('warn', 'Too many timers are running.');
          else self._setStatus('sent', 'Started ' + label, 4000);
          self.redraw();
        });
      }
      _create() {
        var c = this._config || {}, D = window.hkDetail;
        if (!D || !D.open) return;
        D.open(null, { name: 'New Timer', icon: 'mdi:timer-plus-outline', icon_color: c.tint || P.orange },
          // glass: false -- the sheet is its own blur; a card in the page's
          // shared blur would have the page's layer cut to its shape and drawn
          // under the sheet as a solid box
          { cards: { cards: [{ type: 'custom:hk-timer-new-card', layout: 'sheet', glass: false, close_on_start: true, tint: c.tint,
            create_script: c.create_script || 'script.quick_timer_create', name_chips: (c.name_chips || []).slice(0, 6) }] } });
      }
      _render() {
        this._shell('tstart');
        var h = this.client, self = this;
        if (!h) return;
        var st = this._hkStatus, busy = !!this._busy;
        this._paint('<div class="ttl"><b>Start a Timer</b><div class="hk-status" role="status" aria-live="polite"' +
          (st ? ' data-kind="' + st.kind + '">' + esc(st.text) : '>') + '</div></div>' +
          '<div class="qs">' + this._presets().map(function (m) {
            return '<button class="qk" data-q="' + m + '" aria-label="Start a ' + minsLabel(m) + ' timer"' + (busy ? ' disabled' : '') + '>' + minsLabel(m) + '</button>';
          }).join('') + '</div><div class="mk"><button class="qk new" data-new><hk-icon icon="mdi:plus"></hk-icon>Create a Timer</button>' +
          '<small>Choose a name &amp; duration</small></div>');
        if (!this._wired) {
          this._wired = true;
          this._card.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('button') : null;
            if (!b || b.disabled) return;
            if (b.hasAttribute('data-new')) self._create();
            else if (b.hasAttribute('data-q')) self._quick(+b.getAttribute('data-q'));
          });
        }
      }
    }

    // ------------------------------------------ WATER: THROUGH THE DAY
    // The water meter Home Assistant's Energy settings name (energy/get_prefs,
    // its water sources), hour by hour since midnight from the recorder's
    // statistics; this hour so far from its five-minute statistics. An hour
    // with no statistic is "No reading", never zero. Against yesterday to
    // the same time, when yesterday's hours are all there. No meter: no card.
    // `meter:` (HK Settings -> Pages -> Water) names one instead.
    var WATER = { src: null, wait: null };
    function waterSources(card, h) {
      if (WATER.src) return WATER.src;
      if (!WATER.wait && h.callWS) {
        WATER.wait = h.callWS({ type: 'energy/get_prefs' }).then(function (pr) {
          var ids = [];
          ((pr && pr.energy_sources) || []).forEach(function (s) { if (s.type === 'water' && s.stat_energy_from) ids.push(s.stat_energy_from); });
          WATER.src = { ids: ids };
        }, function () { WATER.src = { ids: [] }; }).then(function () { WATER.wait = null; card.redraw(); });
      }
      return null;
    }
    function amount(x) { return x < 10 ? (Math.round(x * 10) / 10).toString() : Math.round(x).toLocaleString(window.hkLocale.numTag()); }
    class HkWaterDayCard extends HeaderCard {
      static get PART_CSS() {
        return BARS_CSS + [
          ':host([hidden]){display:none}',
          '.tot{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-top:10px;flex:none;min-width:0}',
          '.tot .big{cursor:pointer}',
          '.cmp{font-size:13px;line-height:18px;color:' + v('ink-2') + ';text-align:right}',
          '.grow{flex:1;min-height:6px}'
        ].join('');
      }
      _ids() { return []; }
      _render() {
        this._shell('wday');
        var h = this.client;
        if (!h) return;
        var head = '<div class="ttl"><b>Water Through the Day</b><span>Hourly</span></div>';
        // a meter chosen on HK Settings -> Pages -> Water wins over the
        // Energy settings' own
        var own = (this._config || {}).meter;
        var src = own ? { ids: [own] } : waterSources(this, h);
        if (!src) return this._paint(head + '<div class="wait">Loading today…</div>');
        var ids = src.ids.filter(function (id) { return h.states[id] || /:/.test(id); });
        this.toggleAttribute('hidden', !ids.length);
        if (!ids.length) return this._paint('');
        var S = window.hkStats;
        if (!S) return this._paint(head + '<div class="wait">Loading today…</div>');
        var hr48 = S.hourly(h, ids, 48, this), fm = S.fiveMinute(h, ids, 13, this, { type: 'change' });
        if (!hr48) return this._paint(head + '<div class="wait">Loading today…</div>');
        var sum = function (series, i) {
          var got = false, t = 0;
          ids.forEach(function (id) { var r = series[id] && series[id][i]; if (r && r.v != null) { got = true; t += r.v; } });
          return got ? t : null;
        };
        var first = hr48[ids[0]] || [], n = first.length, now = Date.now();
        // today's hours: from the bucket at HA's midnight to the one we are in
        var start = -1;
        for (var i = n - 1; i >= 0; i--) { if (S.fields(first[i].t).hour === 0) { start = i; break; } }
        if (start < 0) start = Math.max(0, n - 24);
        var today = [], yday = [];
        for (var j = start; j < n; j++) today.push({ t: first[j].t, v: sum(hr48, j) });
        for (var y = Math.max(0, start - 24); y < start; y++) yday.push({ t: first[y].t, v: sum(hr48, y) });
        // the open hour: its closed five-minute buckets
        var cur = today[today.length - 1], hourStart = +cur.t, part = null;
        if (fm) {
          var f0 = fm[ids[0]] || [];
          f0.forEach(function (r, k) {
            if (+r.t < hourStart) return;
            var x = sum(fm, k);
            if (x != null) part = (part || 0) + x;
          });
        }
        cur.v = part;
        cur.open = true;
        var nowK = today.length - 1;
        var got = today.filter(function (x) { return x.v != null; });
        var tot = got.reduce(function (a, x) { return a + x.v; }, 0);
        var st0 = h.states[ids[0]], unit = (st0 && st0.attributes.unit_of_measurement) || '';
        // yesterday to this minute: its whole hours before this one, and the
        // same part of this hour
        var cmp = '';
        var frac = Math.min(1, (now - hourStart) / HOUR);
        if (yday.length >= nowK + 1 && yday.slice(0, nowK + 1).every(function (x) { return x.v != null; })) {
          var yv = yday.slice(0, nowK).reduce(function (a, x) { return a + x.v; }, 0) + yday[nowK].v * frac;
          if (yv > 0.5) {
            var pct = Math.round((tot - yv) / yv * 100);
            cmp = Math.abs(pct) < 5 ? 'About the same as<br>yesterday at this time'
              : Math.abs(pct) + '% ' + (pct < 0 ? 'below' : 'above') + ' yesterday<br>at this time';
          }
        }
        var B = bars(today.map(function (x, k) {
          var hr = S.fields(x.t).hour;
          return { segs: [{ v: x.v || 0, c: COOL }], fut: x.v == null, label: HOUR_LABELS[hr], now: k === nowK };
        }).concat(Array.apply(null, Array(Math.max(0, 24 - today.length))).map(function (_, k) {
          var hr = (S.fields(cur.t).hour + k + 1) % 24;
          return { segs: [{ v: 0, c: COOL }], fut: true, label: HOUR_LABELS[hr] };
        })), Math.max(120, this._width()), 56, true);
        this._nBars = 24;
        this._nowI = nowK;
        this._rdRest = 'Hover or touch an hour for its water';
        this._paint(head + '<div class="tot"><div class="big num" data-more="' + esc(/:/.test(ids[0]) ? '' : ids[0]) + '">' + amount(tot) +
          '<u>' + esc(unit) + ' today</u></div>' + (cmp ? '<div class="cmp">' + cmp + '</div>' : '') + '</div><div class="grow"></div>' +
          '<div class="bc">' + B.html + '</div><div class="rd">' + this._rdRest + '</div>');
        hourScrub(this, this._card.querySelector('.bc'), function (k) {
          var x = today[k], lab;
          if (!x) { var hr = (S.fields(cur.t).hour + (k - nowK)) % 24; return (hr % 12 || 12) + ' ' + (hr < 12 ? 'AM' : 'PM') + ' · Not yet'; }
          var hh = S.fields(x.t).hour;
          lab = (hh % 12 || 12) + ' ' + (hh < 12 ? 'AM' : 'PM');
          if (x.open) return lab + ' so far · ' + (x.v == null ? 'No reading yet' : amount(x.v) + ' ' + unit);
          return lab + ' · ' + (x.v == null ? 'No reading' : amount(x.v) + ' ' + unit);
        }, 'Water by hour');
      }
    }

    // ------------------------------------------- WATER: THE MAIN SUPPLY
    // The supply valve from above: a fine ring, its ports, and a quarter-turn
    // handle -- along the pipe when open, across it when closed -- beside the
    // state in words, and the On / Off control under them. Behind the whole
    // card, while the supply is confirmed open, three translucent waves drift
    // across each other: a sign the supply is on, never a measure of flow.
    // Opening, closing, unknown and unavailable are said as they are; the
    // waves wait for Home Assistant to confirm Open. A change asks first.
    // The water's colors are the card's art (DESIGN.md rule 4), named here.
    var WAVES = { back: '#9ae1eb', middle: '#42a8d6', front: '#238fb9', wash: 'linear-gradient(155deg,rgba(69,152,183,0.04),rgba(36,138,192,0.14))' };
    var WAVE_PATHS = [
      ['back', 'M0 120C100 120 120 64 240 64S440 120 600 120C700 120 720 64 840 64S1040 120 1200 120V240H0Z'],
      ['middle', 'M0 95C100 95 180 143 300 143S500 95 600 95C700 95 780 143 900 143S1100 95 1200 95V240H0Z'],
      ['front', 'M0 110C100 110 160 75 300 75S480 110 600 110C700 110 760 75 900 75S1080 110 1200 110V240H0Z']];
    var PENDING_MS = 90e3;
    function supplyState(st) {
      if (!st) return 'unavailable';
      var s = st.state, d = st.entity_id.split('.')[0];
      if (d === 'switch' || d === 'input_boolean') return s === 'on' ? 'open' : s === 'off' ? 'closed' : s === 'unavailable' ? 'unavailable' : 'unknown';
      return { open: 'open', closed: 'closed', opening: 'opening', closing: 'closing', unavailable: 'unavailable' }[s] || 'unknown';
    }
    class HkWaterSupplyCard extends HeaderCard {
      static get PART_CSS() {
        var E = C.EASE, U = C.DUR;
        return [
          'hk-plate.hd.supply{position:relative;isolation:isolate}',
          '.wash{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;border-radius:inherit;background:' + WAVES.wash + ';',
          '  opacity:0;transition:opacity ' + U.standard + ' ' + E.standard + '}',
          '.on .wash{opacity:1}',
          '.wave{position:absolute;top:0;left:0;width:200%;height:100%;max-width:none;animation:hkw-drift 25s linear infinite;animation-play-state:paused}',
          '.wave.back{fill:' + WAVES.back + ';opacity:.14;animation-duration:31s;animation-delay:-7s}',
          '.wave.middle{fill:' + WAVES.middle + ';opacity:.19;animation-duration:25s;animation-direction:reverse;animation-delay:-16s}',
          '.wave.front{fill:' + WAVES.front + ';opacity:.16;animation-duration:21s;animation-delay:-3s}',
          '.on:not(.still) .wave{animation-play-state:running;will-change:transform}',
          '@keyframes hkw-drift{to{transform:translateX(-50%)}}',
          '.fg{position:relative;z-index:1;display:flex;flex-direction:column;flex:1;min-height:0}',
          '.ttl .hk-status{margin:0;min-height:0;font-size:13px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.sc{display:grid;grid-template-columns:88px minmax(0,1fr);gap:20px;align-items:center;margin-top:12px;cursor:pointer}',
          '.vi{width:88px;height:88px;overflow:hidden}',
          '.vi svg{display:block;width:88px;height:88px}',
          '.vi .ring{fill:none;stroke:' + v('mark') + ';stroke-width:1}',
          '.vi .port{stroke:' + v('glyph') + ';stroke-opacity:.6;stroke-width:2;stroke-linecap:round}',
          '.vi .tick{stroke:' + v('mark') + ';stroke-width:1}',
          '.vi .hub{fill:' + v('key') + ';stroke:' + v('line-strong') + ';stroke-width:1}',
          '.vi .hd{transform-box:view-box;transform-origin:44px 44px;transform:rotate(-90deg);transition:transform ' + U.standard + ' ' + E.standard + '}',
          '.vi .hd path{stroke:' + v('glyph') + ';stroke-width:4;stroke-linecap:round}',
          '.vi .hd circle{fill:' + v('key-strong') + ';stroke:' + v('glyph') + ';stroke-width:2}',
          '.open .vi .hd{transform:rotate(0deg)}',
          '.open .vi .hd path,.open .vi .hd circle{stroke:' + WAVES.back + '}',
          '.moving .vi .hd{transform:rotate(-45deg)}',
          '.lost .vi .hd{opacity:0}',
          '.vw{min-width:0}',
          '.vw strong{display:block;' + C.figureCss('figure') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.vw small{display:flex;align-items:center;gap:7px;margin-top:6px;font-size:13px;line-height:18px;color:' + v('ink-2') + '}',
          '.vw small i{width:6px;height:6px;border-radius:50%;flex:none;background:' + v('mark') + '}',
          '.open .vw small i{background:' + WAVES.back + '}',
          // THE TWO-POSITION CONTROL: the segmented control's well, its
          // selected half the shared near-white
          '.sw{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin-top:auto;border-radius:' + R.capsule('48px') + ';',
          '  background:' + v('key') + ';border:1px solid ' + v('line') + '}',
          '.sw button{appearance:none;font:inherit;height:38px;border:0;border-radius:' + R.capsule('38px') + ';background:none;color:' + v('ink') + ';',
          '  ' + C.PILL_LABEL + ';cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color ' + U.fade + ' ease}',
          '.sw button[aria-pressed="true"]{background:' + C.SELECTED_BG + ';color:' + C.SELECTED_TEXT + '}',
          '.sw button:disabled{cursor:default;color:' + v('ink-3') + '}',
          '.sw button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
          '@media (prefers-reduced-motion: reduce){',
          '  .wave{animation:none!important;will-change:auto}',
          '  .wash,.vi .hd,.sw button{transition:none}}'
        ].join('');
      }
      _ids() { var c = this._config || {}; return c.entity ? [c.entity] : []; }
      _sigOf() { return super._sigOf() + '|' + (this._pend ? this._pend.to : '') + '|' + (this._hkStatus ? this._hkStatus.text : '') + '|' + !!this._busy; }
      disconnectedCallback() {
        super.disconnectedCallback();
        if (this._io) { this._io.disconnect(); this._io = null; }
        clearTimeout(this._pendT);
      }
      // PAUSED OFF SCREEN: the waves run only while the card can be seen
      _watch() {
        if (this._io || typeof IntersectionObserver !== 'function' || !this._card) return;
        var self = this;
        this._io = new IntersectionObserver(function (en) {
          self._card.classList.toggle('still', !en[en.length - 1].isIntersecting);
        });
        this._io.observe(this._card);
      }
      _send(open) {
        var self = this, id = this._config.entity, d = id.split('.')[0];
        var svc = d === 'valve' ? (open ? 'open_valve' : 'close_valve') : (open ? 'turn_on' : 'turn_off');
        if (!this._begin(open ? 'Opening…' : 'Closing…')) return;
        this._pend = { to: open ? 'open' : 'closed', at: Date.now() };
        clearTimeout(this._pendT);
        this._pendT = setTimeout(function () {
          if (!self._pend) return;
          self._pend = null;
          self._setStatus('warn', 'The valve has not answered');
          self.redraw();
        }, PENDING_MS);
        this._call(d === 'valve' ? 'valve' : 'homeassistant', d === 'valve' ? svc : svc, { entity_id: id }).then(function (ok) {
          self._end();
          if (!ok) {
            self._pend = null;
            clearTimeout(self._pendT);
            self._setStatus('failed', 'Could not reach Home Assistant');
          } else self._setStatus(null);
          self.redraw();
        });
      }
      _ask(open) {
        var self = this, name = (this._config && this._config.name) || 'the main water supply';
        if (C.confirmSheet) {
          C.confirmSheet(open ? 'Turn ' + name + ' back on?' : 'Shut off ' + name + '?', function () { self._send(open); },
            { yes: open ? 'Turn On' : 'Shut Off', destructive: !open,
              detail: open ? 'Water will flow to the house again.' : 'No water will reach the house until it is turned back on.' });
        } else this._send(open);
      }
      _render() {
        this._shell('supply');
        var h = this.client, c = this._config || {}, self = this;
        if (!h) return;
        var st = h.states[c.entity], s = supplyState(st);
        // a command sent and not yet answered: said as on its way, until the
        // valve reports where it is
        if (this._pend && (s === this._pend.to || Date.now() - this._pend.at > PENDING_MS)) { this._pend = null; clearTimeout(this._pendT); }
        var pend = this._pend, show = pend && s !== 'opening' && s !== 'closing' ? (pend.to === 'open' ? 'opening' : 'closing') : s;
        var WORD = { open: ['Open', 'Supply enabled'], closed: ['Closed', 'Supply shut off'],
                     opening: ['Opening…', pend ? 'Sent · waiting for the valve' : 'Waiting for the valve'],
                     closing: ['Closing…', pend ? 'Sent · waiting for the valve' : 'Waiting for the valve'],
                     unknown: ['Unknown', 'The valve has not reported'], unavailable: ['Unavailable', 'Can’t reach the valve'] }[show];
        var cls = (show === 'open' ? 'open on' : show === 'closed' ? 'closed' : show === 'unavailable' || show === 'unknown' ? 'lost' : 'moving');
        this._card.className = 'hd supply ' + cls + (this._card.classList.contains('still') ? ' still' : '') + (this._card.classList.contains('anim') ? ' anim' : '');
        var off = s === 'unavailable' || !!pend || !!this._busy, stt = this._hkStatus;
        var title = c.title || 'Main Water Supply';
        this._paint('<div class="wash" aria-hidden="true">' + WAVE_PATHS.map(function (p) {
            return '<svg class="wave ' + p[0] + '" viewBox="0 0 1200 240" preserveAspectRatio="none" focusable="false"><path d="' + p[1] + '"/></svg>';
          }).join('') + '</div>' +
          '<div class="fg"><div class="ttl"><b>' + esc(title) + '</b><div class="hk-status" role="status" aria-live="polite"' +
          (stt && stt.kind !== 'pending' ? ' data-kind="' + stt.kind + '">' + esc(stt.text) : '>') + '</div></div>' +
          '<div class="sc" data-more="' + esc(c.entity) + '"><div class="vi"><svg viewBox="0 0 88 88" role="img" aria-label="' +
          (show === 'open' ? 'Valve handle along the pipe: open' : show === 'closed' ? 'Valve handle across the pipe: closed' : 'Valve position not confirmed') + '">' +
          '<circle class="ring" cx="44" cy="44" r="34"/><path class="port" d="M2 44H17M71 44H86"/><path class="tick" d="M44 5V9M44 79V83"/>' +
          '<circle class="hub" cx="44" cy="44" r="22"/><g class="hd"><path d="M24 44H64"/><circle cx="44" cy="44" r="4"/></g></svg></div>' +
          '<div class="vw"><strong>' + WORD[0] + '</strong><small><i></i>' + WORD[1] + '</small></div></div>' +
          '<div class="sw" role="group" aria-label="' + esc(title) + '">' +
          '<button data-v="off" aria-pressed="' + (s === 'closed') + '"' + (off ? ' disabled' : '') + '>Off</button>' +
          '<button data-v="on" aria-pressed="' + (s === 'open') + '"' + (off ? ' disabled' : '') + '>On</button></div></div>');
        this._watch();
        if (!this._wired) {
          this._wired = true;
          this._card.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('.sw button') : null;
            if (!b || b.disabled) return;
            var want = b.getAttribute('data-v') === 'on', now = supplyState((self.client || {}).states[self._config.entity]);
            if ((want && now === 'open') || (!want && now === 'closed')) return;
            self._ask(want);
          });
        }
      }
    }

    // ------------------------------------------------------------ register
    var HEIGHT = [{ name: 'height', selector: { text: {} } }];

    // what the shell and the later parts use of this one
    K.HEIGHT = HEIGHT; K.HkTimersOrderCard = HkTimersOrderCard; K.HkTimersStartCard = HkTimersStartCard;
    K.HkWaterDayCard = HkWaterDayCard; K.HkWaterSupplyCard = HkWaterSupplyCard; K.supplyState = supplyState;
  };
})();
