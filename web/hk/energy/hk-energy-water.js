// hk-energy-water.js - the page's battery, water and tracking cards.
//
// PART OF THE ENERGY CARDS (hk-energy.js). Not a card and not run on its own: it registers one
// function, which hk-energy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkEnergyParts = window.hkEnergyParts || {})['hk-energy-water'] = function (K) {
    var barChart = K.barChart, colorOf = K.colorOf, daysFor = K.daysFor, EP = K.EP, esc = K.esc, fx = K.fx,
        glyphBattery = K.glyphBattery, glyphDrop = K.glyphDrop, HkEnergyBase = K.HkEnergyBase, hm = K.hm,
        hourName = K.hourName, HOURS = K.HOURS, kwh = K.kwh, MINI_CSS = K.MINI_CSS, moreAttr = K.moreAttr,
        period = K.period, rgba = K.rgba, RING = K.RING, SEC_CYCLE = K.SEC_CYCLE, sidePanel = K.sidePanel,
        slotLabel = K.slotLabel, slotName = K.slotName, slotsOf = K.slotsOf, sum = K.sum, unitOf = K.unitOf,
        vs = K.vs, whenOf = K.whenOf;

    // ------------------------------------------------- the house battery
    // Its level (Now) or what it took in (the other tabs) beside the glyph;
    // in, out and a usual day's charge; then each slot's charge (green) and
    // what the house drew from it (orange) stacked in one bar.
    class HkEnergyBatteryCard extends HkEnergyBase {
      static get PART_CSS() { return MINI_CSS; }
      _render() {
        this._shell('mini');
        var x = this._data(), p = period();
        if (x.wait) return this._paint('<div class="wait">Loading…</div>');
        var M = x.M, R = x.R, D = x.D, h = this.client;
        var hb = M.house, lvl = hb && h.states[hb.entity] ? Number(h.states[hb.entity].state) : NaN;
        var stored = hb && hb.label && h.states[hb.label] ? Number(h.states[hb.label].state) : NaN;
        var fill, big, cap;
        if (hb && hb.entity) this._card.setAttribute('data-more', hb.entity); else this._card.removeAttribute('data-more');
        // a level sensor that blips unknown keeps the card on its level ("—"),
        // not flipping to the period's kWh for a second
        if (p === 'now' && (isFinite(lvl) || (hb && hb.entity && h.states[hb.entity]))) {
          fill = isFinite(lvl) ? lvl / 100 : 0; big = (isFinite(lvl) ? Math.round(lvl) : '—') + '<u>%</u>';
          cap = isFinite(stored) ? fx(stored, 1) + ' kWh stored' : 'Its level now';
        } else {
          fill = isFinite(lvl) ? lvl / 100 : 0.5;
          big = kwh(R.into) + '<u>kWh in</u>';
          cap = R.out > 0.05 ? kwh(R.out) + ' kWh used by the house' : 'Nothing drawn: ready for an outage or the evening peak';
        }
        var trio = '<div class="trio">' +
          '<div><div class="k"><i style="background:#30d158"></i>In</div><div class="v">' + kwh(R.into) + '<u>kWh</u></div></div>' +
          '<div><div class="k"><i style="background:#ff9f0a"></i>Out</div><div class="v">' + kwh(R.out) + '<u>kWh</u></div></div>' +
          '<div><div class="k">Usual In</div><div class="v">' + kwh(R.typ.into) + '<u>a day</u></div></div></div>';
        var sl = slotsOf(R, D), bars = [], tips = [], tzb = window.hkStats && window.hkStats.tz();
        for (var k = 0; k < sl.count; k++) {
          var i = sl.idx[k], g = sl.ghosts[k];
          var nm = slotName(p, R, k, tzb);
          tips.push(i == null ? nm + ' \u00b7 not yet' + (g != null ? ' \u00b7 last time ' + kwh(vs(D.d, M.src.into, g)) + ' kWh in' : '')
            : nm + ' \u00b7 ' + kwh(vs(sl.ser, M.src.into, i)) + ' kWh in \u00b7 ' + kwh(vs(sl.ser, M.src.out, i)) + ' out');
          bars.push({ segs: i == null ? [] : [{ v: vs(sl.ser, M.src.into, i), c: '#30d158' }, { v: vs(sl.ser, M.src.out, i), c: '#ff9f0a' }],
                      ghost: i == null && g != null ? vs(D.d, M.src.into, g) + vs(D.d, M.src.out, g) : 0, ghostColor: '#ffffff', fut: i == null,
                      label: slotLabel(p, R, i, k, sl.count), now: k === sl.nowK });
        }
        var avail = (this._card.clientWidth || 324) - 44, wide = avail >= 560;
        if (!this._card.clientWidth) this._later();
        this._paint('<div class="ttl"><b>' + esc((hb && hb.name) || 'House Battery') + '</b><span>' + (p === 'now' ? 'now' : whenOf(p, R)) + '</span></div>' +
          '<div class="mb"><div class="mm"><div class="flow">' + glyphBattery(fill) + '<div><div class="big num">' + big + '</div><div class="cap">' + cap + '</div></div></div>' +
          '<div class="foot">' + (M.src.into.length ? barChart({ bars: bars, avail: wide ? avail - 236 : avail, H: 78, id: 'bt' }) : '') + '</div>' + trio + '</div>' +
          sidePanel([['<i style="background:#30d158"></i>In', kwh(R.into) + '<u>kWh</u>', p === 'now' || p === 'day' ? 'Charged today' : 'Charged ' + whenOf(p, R)],
                     ['<i style="background:#ff9f0a"></i>Out', kwh(R.out) + '<u>kWh</u>', 'Used by the house'],
                     ['Usual In', kwh(R.typ.into) + '<u>kWh</u>', 'A usual day\u2019s charge']]) + '</div>');
        this._scrubs(this._card.querySelector('.foot .bc'), tips, { nowI: sl.nowK, name: 'The battery by ' + (sl.count === 24 ? 'hour' : 'day') });
      }
    }

    // --------------------------------------------- water (or gas)
    // The tab's water against a usual amount, three figures, and the tab's
    // own bars: today by hour, the week's days, the month's days, with a
    // usual day dotted across them.
    class HkEnergyWaterCard extends HkEnergyBase {
      static get PART_CSS() { return MINI_CSS; }
      _render() {
        this._shell('mini');
        var x = this._data(), p = period(), kind = (this._config && this._config.source) === 'gas' ? 'gas' : 'water';
        if (x.wait) return this._paint('<div class="wait">Loading…</div>');
        var M = x.M, R = x.R, D = x.D, h = this.client, ids = M.src[kind].ids, tz = window.hkStats && window.hkStats.tz();
        var unit = unitOf(h, ids[0]) || (kind === 'water' ? 'gal' : '');
        var val = R[kind], typ = R.typ[kind] * R.n, color = kind === 'water' ? RING.water : RING.gas;
        if (ids[0]) this._card.setAttribute('data-more', ids[0]); else this._card.removeAttribute('data-more');
        var pace = typ > 0 ? val / (typ * R.pshare) : 1, pct = Math.round(100 * (pace - 1));
        var cap = typ <= 0 ? 'Learning your usual' : Math.abs(pct) < 12 ? 'About usual' + (p === 'now' || p === 'day' ? ' for this time of day' : '')
          : Math.abs(pct) + '% ' + (pct > 0 ? 'more' : 'less') + ' than usual' + (p === 'now' || p === 'day' ? ' by now' : '');
        var day = p === 'now' || p === 'day', sl = slotsOf(R, D), bars = [];
        var vals = sl.idx.map(function (i) { return i == null ? null : vs(sl.ser, ids, i); });
        for (var k = 0; k < sl.count; k++) {
          var i = sl.idx[k], z = vals[k], last = k === sl.nowK, g = sl.ghosts[k];
          bars.push({ segs: i != null ? [{ v: z, c: last ? color : rgba(color, 0.5) }] : [], now: last,
                      ghost: i == null && g != null ? vs(D.d, ids, g) : 0, ghostColor: '#ffffff', fut: i == null,
                      label: slotLabel(p, R, i, k, sl.count) });
          var nmw = slotName(p, R, k, tz);
          (this._tips = k ? this._tips : []).push(i == null ? nmw + ' \u00b7 not yet' + (g != null ? ' \u00b7 last time ' + fx(vs(D.d, ids, g), 0) + ' ' + unit : '')
            : nmw + ' \u00b7 ' + fx(z, z >= 10 ? 0 : 1) + ' ' + unit);
        }
        // the biggest slot, and its name
        var bi = -1;
        vals.forEach(function (z2, k2) { if (z2 != null && (bi < 0 || z2 > vals[bi])) bi = k2; });
        var bigName = bi < 0 ? '—' : day ? hourName(R.ax.h[sl.idx[bi]].t, tz)
          : new Date(R.ax.d[sl.idx[bi]].t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short', timeZone: tz }));
        var trio = '<div class="trio">' +
          '<div><div class="k">Usual</div><div class="v">' + fx(R.typ[kind], 0) + '<u>a day</u></div></div>' +
          '<div><div class="k">' + (day ? 'Busiest' : 'Biggest') + '</div><div class="v">' + bigName + '</div></div>' +
          '<div><div class="k">Used Then</div><div class="v">' + (bi >= 0 ? fx(vals[bi] || 0, 0) : '—') + '<u>' + esc(unit) + '</u></div></div></div>';
        var avail = (this._card.clientWidth || 324) - 44, wide = avail >= 560;
        if (!this._card.clientWidth) this._later();
        var when = whenOf(p, R);
        this._paint('<div class="ttl"><b>' + (kind === 'water' ? 'Water' : 'Gas') + '</b><span>' + (p === 'now' ? 'today so far' : when) + '</span></div>' +
          '<div class="mb"><div class="mm"><div class="flow">' + glyphDrop(color, kind === 'gas') + '<div><div class="big num">' + fx(val, val >= 10 ? 0 : 1) + '<u>' + esc(unit) + '</u></div>' +
          '<div class="cap">' + cap + '</div></div></div>' +
          '<div class="foot">' + barChart({ bars: bars, avail: wide ? avail - 236 : avail, H: 78, id: kind, usual: day ? 0 : R.typ[kind] }) + '</div>' + trio + '</div>' +
          sidePanel([['Usual', fx(R.typ[kind], 0) + '<u>' + esc(unit) + '</u>', 'A usual day'],
                     [day ? 'Busiest Hour' : 'Biggest Day', bigName, day ? 'Today' : when.charAt(0).toUpperCase() + when.slice(1)],
                     [day ? 'That Hour' : 'That Day', (bi >= 0 ? fx(vals[bi] || 0, 0) : '\u2014') + '<u>' + esc(unit) + '</u>', 'Used then']]) + '</div>');
        this._scrubs(this._card.querySelector('.foot .bc'), this._tips || [], { nowI: sl.nowK, name: (kind === 'water' ? 'Water' : 'Gas') + ' by ' + (day ? 'hour' : 'day') });
      }
    }

    // ------------------------------------------------------------ tracking
    // THE THINGS A HOUSE CHOSE TO FOLLOW (HK Settings -> Energy -> Tracking,
    // the plan's own daily bars): one row each, in columns -- its name and how
    // it compares with its usual, its figure for the tab, and its bars for the
    // tab (today by hour, the week's days, the month's days). A meter's kWh; a
    // runtime's hours, from its daily peak (hk-stats dailyPeak) and, by the
    // hour, from how far its counter rose.
    class HkEnergyTrackingCard extends HkEnergyBase {
      static get PART_CSS() {
        return MINI_CSS + [
          // (4 px in, on the page's edges as the cards beside it: DESIGN.md "Page edges")
          'hk-plate.ep.track{height:auto;padding:6px 22px;margin-left:4px;margin-right:4px;width:auto}',
          // TWO TO A LINE (the user's ask, 2026-10-21): each followed meter is a
          // cell -- its name and comparison over its figure, its bars the cell's
          // whole width beneath -- two side by side down to a card of
          // BP.cardSide (between an iPad mini held upright and a phone), one
          // below that. The card decides (.two, from its own width, the width
          // the bars are drawn to), not a container query that could disagree.
          // Before: two columns only from 1100 px, a name / figure / bars row
          // whose bars were drawn to a guess -- a card of 700-1000 px showed
          // one column with half its width empty.
          '.tl{display:grid;grid-template-columns:minmax(0,1fr);column-gap:40px}',
          '.tl.two{grid-template-columns:repeat(2,minmax(0,1fr))}.tl.two .tr:nth-child(2){border-top:0}',
          '.tr{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"n v" "c c";column-gap:16px;row-gap:10px;',
          '  align-items:center;padding:14px 0;border-top:1px solid ' + window.hkCards.v('line') + '}',
          '.tr:first-child{border-top:0}',
          '.tn{grid-area:n;min-width:0}.tv{grid-area:v;text-align:right}.tc{grid-area:c}',
          '.tn b{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.tn b i{width:10px;height:10px;border-radius:50%;flex:none}',
          '.tn span{display:block;margin-top:4px;padding-left:18px;font-size:13px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
          '.tn span b.up{display:inline;color:#ffb340}.tn span b.down{display:inline;color:#4cd964}',
          '.tv{font-size:24px;font-weight:700;letter-spacing:-0.5px;white-space:nowrap;font-variant-numeric:tabular-nums}',
          '.tv u{text-decoration:none;font-size:13px;font-weight:600;margin-left:3px;color:' + window.hkCards.v('ink-2') + '}',
          '.tc{min-width:0;display:flex;justify-content:flex-start}',
          '.tc .bc{align-items:flex-start}',
          // compact: no bars, just each meter's name and figure
          '.compact .tr{grid-template-areas:"n v";row-gap:0}.compact .tc{display:none}'
        ].join('');
      }
      getCardSize() { return 6; }
      // DRAWN AGAIN AT A NEW WIDTH (a window resized, a tablet turned, the side
      // menu opened): the bars are sized in px to the width they were drawn at,
      // and nothing else redraws this card when only its width changes
      _fitWidth(w) {
        var self = this;
        this._drawnW = w;
        if (this._fitRO || typeof ResizeObserver !== 'function' || !this._card) return;
        this._fitRO = new ResizeObserver(function () {
          var now = self._card ? self._card.clientWidth : 0;
          if (now && Math.abs(now - (self._drawnW || 0)) >= 8) self._later();
        });
        this._fitRO.observe(this._card);
      }
      _render() {
        this._shell('track');
        var x = this._data(), p = period(), h = this.client, S = window.hkStats;
        if (x.wait || !S) return this._paint('<div class="wait">Loading…</div>');
        var M = x.M, R = x.R, list = (M.P.usages || []).filter(function (u) { return u && (u.stat || u.entity); });
        if (!list.length) return this._paint('');
        var en = list.filter(function (u) { return !u.runtime; }).map(function (u) { return u.stat || u.entity; });
        var rt = list.filter(function (u) { return u.runtime; }).map(function (u) { return u.stat || u.entity; });
        // the same counts as the page's own, so these ride in its batches
        var nDays = daysFor(p, EP.back);
        var eh = en.length ? S.hourly(h, en, HOURS, this) : {}, ed = en.length ? S.daily(h, en, nDays, this) : {};
        var rh = rt.length ? S.hourly(h, rt, HOURS, this, { type: 'max' }) : {}, rd = rt.length ? S.dailyPeak(h, rt, nDays, this) : {};
        if (!eh || !ed || !rh || !rd) return this._paint('<div class="wait">Loading…</div>');
        var day = p === 'now' || p === 'day', nd = R.ax.d.length, typ = M.typical;
        // the bars are drawn to the cell's width: the card's, less its padding
        // (22 a side), halved with the gap between two cells
        var full = this._card.clientWidth || 1100, cw = full - 44, twoCol = full >= window.hkCards.BP.cardSide;
        var avail = Math.max(140, twoCol ? (cw - 40) / 2 : cw);
        if (!this._card.clientWidth) this._later();
        this._fitWidth(full);
        var val = function (a, i) { var q = a && a[i]; return q && typeof q.v === 'number' && isFinite(q.v) ? q.v : 0; };
        var rowTips = [];
        var rows = list.map(function (u, ui) {
          var id = u.stat || u.entity, isRt = !!u.runtime, color = colorOf(u.color, SEC_CYCLE[ui % SEC_CYCLE.length]);
          var dser = isRt ? rd[id] : ed[id], hser = isRt ? rh[id] : eh[id];
          // the slots of the tab
          var slots = [];
          if (day) {
            R.hToday.forEach(function (i, k) {
              var z = val(hser, i);
              // a runtime's counter: how far it rose in the hour (hour 0 still
              // holds yesterday's total for a moment, so it starts from nothing)
              if (isRt) z = k === 0 ? 0 : Math.max(0, z - val(hser, R.hToday[k - 1]));
              slots.push(z);
            });
          } else {
            R.slots.forEach(function (i) { slots.push(i == null ? null : val(dser, i)); });
          }
          var v = day ? val(dser, nd - 1) : sum(slots);
          // THE WEEK BEFORE, dimmed in front of this one: seven bars alone are a
          // narrow chart, and last week is what this one is read against
          var before = [];
          if (p === 'week' && R.prev) R.prev.idx.forEach(function (i) { before.push({ i: i, z: val(dser, i) }); });
          var tw = R.tw.map(function (j) { return val(dser, j); });
          var usualDay = tw.length ? sum(tw) / tw.length : 0;
          var k2 = v / Math.max(0.01, usualDay * R.n * R.pshare), pct = Math.round(100 * (k2 - 1));
          var cmp = usualDay < 0.01 ? 'Learning its usual' : Math.abs(pct) < 12 ? 'About usual' :
            '<b class="' + (pct > 0 ? 'up' : 'down') + '">' + (pct > 0 ? '↑ ' : '↓ ') + Math.abs(pct) + '%</b> vs usual';
          var shown = isRt ? hm(v) : kwh(v) + '<u>kWh</u>';
          var tz2 = S.tz(), fmtV = function (z) { return isRt ? hm(z) : kwh(z) + ' kWh'; };
          var tips = before.map(function (q) {
            return new Date(R.ax.d[q.i].t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short', month: 'short', day: 'numeric', timeZone: tz2 })) + ' \u00b7 ' +
              fmtV(q.z) + ' \u00b7 last week';
          });
          var bars = before.map(function (q) {
            return { segs: [{ v: q.z, c: rgba(color, 0.28) }], label: slotLabel('week', R, q.i, 0, 7, +R.ax.d[q.i].t) };
          });
          // the days to come: empty beside last week's own bars, last month's
          // same day in gray on a month
          var cnt = day ? 24 : slots.length;
          for (var b = 0; b < cnt; b++) {
            var has = day ? b < slots.length : slots[b] != null, last = day ? b === slots.length - 1 : b === R.todayK;
            var gi = !day && p === 'month' ? R.ghosts[b] : null;
            bars.push({ segs: has ? [{ v: slots[b], c: last ? color : rgba(color, 0.6) }] : [], now: last, fut: !has && !day,
                        ghost: gi != null ? val(dser, gi) : 0, ghostColor: '#ffffff',
                        label: slotLabel(p, R, day ? 0 : R.slots[b], b, cnt) });
            tips.push(slotName(p, R, b, tz2) + ' \u00b7 ' + (has ? fmtV(slots[b]) : 'not yet'));
          }
          rowTips.push({ tips: tips, nowI: before.length + (day ? slots.length - 1 : R.todayK), name: (u.name || id) + ' by ' + (day ? 'hour' : 'day') });
          return '<div class="tr"' + moreAttr(id) + '><div class="tn"><b><i style="background:' + color + '"></i>' + esc(u.name || id) + '</b><span>' + cmp + '</span></div>' +
            '<div class="tv">' + shown + '</div><div class="tc">' +
            barChart({ bars: bars, avail: avail, H: 44, id: 'tk' + ui, usual: day || isRt ? 0 : usualDay }) + '</div></div>';
        });
        this._card.classList.toggle('compact', !!(this._config && this._config.compact));
        this._paint('<div class="tl' + (twoCol ? ' two' : '') + '">' + rows.join('') + '</div>');
        // each row reads out in its own comparison line
        var self = this;
        this._card.querySelectorAll('.tr').forEach(function (row, ri) {
          var t = rowTips[ri], line = row.querySelector('.tn span');
          if (t) self._scrubs(row.querySelector('.tc .bc'), t.tips, { nowI: t.nowI, name: t.name, readout: function () { return line; }, rest: line ? line.innerHTML : '' });
        });
      }
    }

    // what the shell and the later parts use of this one
    K.HkEnergyBatteryCard = HkEnergyBatteryCard; K.HkEnergyTrackingCard = HkEnergyTrackingCard;
    K.HkEnergyWaterCard = HkEnergyWaterCard;
  };
})();
