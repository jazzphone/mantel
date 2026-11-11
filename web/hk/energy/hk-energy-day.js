// hk-energy-day.js - the Your Day card, the bar chart and the small glyphs and CSS the cards share.
//
// PART OF THE ENERGY CARDS (hk-energy.js). Not a card and not run on its own: it registers one
// function, which hk-energy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkEnergyParts = window.hkEnergyParts || {})['hk-energy-day'] = function (K) {
    var costAt = K.costAt, dayName = K.dayName, EP = K.EP, esc = K.esc, fx = K.fx, HkEnergyBase = K.HkEnergyBase,
        homeAt = K.homeAt, hourName = K.hourName, kwh = K.kwh, monthOf = K.monthOf, moreAttr = K.moreAttr,
        period = K.period, REST = K.REST, rgba = K.rgba, RING = K.RING, slotName = K.slotName, slotOf = K.slotOf,
        sum = K.sum, usualOfSec = K.usualOfSec, v = K.v;

    // --------------------------------------------- the period's shape
    // The day as a clock (Now: so far), the week as bars against a usual day,
    // the month as a calendar in five steps against a usual day. Wider than a
    // column (no battery or water beside it), it adds the period's figures.
    var STEPS = [[0.80, 'rgba(48,209,88,0.85)', 'Well below'], [0.93, 'rgba(48,209,88,0.42)', 'Below'],
                 [1.07, 'rgba(255,255,255,0.16)', 'Usual'], [1.20, 'rgba(255,159,10,0.75)', 'Above'],
                 [Infinity, 'rgba(255,69,58,0.92)', 'Well above']];
    function stepOf(r) { for (var i = 0; i < STEPS.length; i++) if (r < STEPS[i][0]) return STEPS[i]; return STEPS[4]; }
    class HkEnergyDayCard extends HkEnergyBase {
      static get PART_CSS() {
        return [
          'hk-plate.ep.shape{--hk-ep-h:340px}',
          // PACKED, NOT STRETCHED: in one column the chart fills the card; wider,
          // the chart keeps its own width (--mw), the figures sit beside it, and
          // the devices that used the most take what is left
          '.body{flex:1;display:flex;gap:24px;min-height:0;align-items:stretch}',
          '.main{flex:1;display:flex;flex-direction:column;min-width:0}',
          '@container (min-width:' + window.hkCards.BP.cardList + 'px){.main{flex:0 0 var(--mw,260px)}}',
          // WIDER THAN A COLUMN IT SAYS MORE (the battery and water absent):
          // from two columns the period's figures beside the chart, from three
          // the devices that used the most as well
          '.side{display:none;width:190px;flex:none;flex-direction:column;justify-content:center;gap:14px;',
          '  border-left:1px solid ' + window.hkCards.v('line') + ';padding-left:22px}',
          '@container (min-width:' + window.hkCards.BP.cardSide + 'px){.side{display:flex}}',
          // ONE COLUMN: the period's three figures under the chart, as the
          // battery and water cards have theirs (the side panel says them wider)
          '.mt{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px;padding-top:12px;flex:none;',
          '  border-top:1px solid ' + window.hkCards.v('line') + '}',
          '.mt .k{font-size:11px;letter-spacing:0.4px;overflow:hidden;text-overflow:ellipsis}',
          '.mt .v{font-size:17px;font-weight:700;letter-spacing:-0.3px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
          '.mt .v u{text-decoration:none;font-size:12px;font-weight:600;margin-left:2px;color:' + window.hkCards.v('ink-2') + '}',
          '@container (min-width:' + window.hkCards.BP.cardSide + 'px){.mt{display:none}}',
          '.clock.small{max-width:200px;padding-top:4px}',
          '@container (min-width:' + window.hkCards.BP.cardSide + 'px){.clock.small{max-width:240px;padding-top:10px}}',
          '.wk.small{padding-top:12px}',
          '.cal.small{margin-top:12px;grid-auto-rows:minmax(16px,26px)}',
          '@container (min-width:' + window.hkCards.BP.cardSide + 'px){.wk.small{padding-top:22px}.cal.small{grid-auto-rows:minmax(16px,30px)}}',
          '.side .big{font-size:22px;margin-top:5px}',
          '.most{display:none;flex:1;min-width:0;flex-direction:column;gap:12px;',
          '  border-left:1px solid ' + window.hkCards.v('line') + ';padding-left:22px}',
          '@container (min-width:' + window.hkCards.BP.cardList + 'px){.most{display:flex}}',
          // EVERY DEVICE, MOST FIRST, scrolling inside the card; the last row
          // fades so it reads as more below. Two columns across a whole row.
          // (its edges: the sheet's shadows, BASE_CSS .hk-edge -- was a fade)
          '.ml{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;display:flex;flex-direction:column;gap:12px;',
          '  padding:2px 6px 18px 0;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.25) transparent}',
          '@container (min-width:' + window.hkCards.BP.cardTwo + 'px){.ml{display:grid;grid-template-columns:1fr 1fr;column-gap:28px;row-gap:12px;align-content:start}}',
          '.most .mh{font-size:13px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;color:' + window.hkCards.v('ink-2') + '}',
          '.mr{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;row-gap:5px;align-items:baseline}',
          '.mr b{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.mr span{font-size:13px;color:' + window.hkCards.v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
          '.mr i{grid-column:1/-1;display:block;height:6px;border-radius:3px;background:' + window.hkCards.v('key') + ';overflow:hidden}',
          '.mr i em{display:block;height:100%;border-radius:3px}',
          '.clock{width:100%;max-width:240px;height:auto;margin:auto;padding-top:10px}',
          '.wk{margin:auto;padding-top:22px;display:flex;flex-direction:column;align-items:center}',
          '.wk .bc{display:flex;flex-direction:column;align-items:center}',
          '.wk .bl{position:relative;height:30px;margin-top:8px}',
          '.wk .bl span{position:absolute;top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px;',
          '  font-size:12px;font-weight:600;line-height:1;color:' + window.hkCards.v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
          '.wk .bl span b{font-weight:600;color:' + window.hkCards.v('ink-3') + '}',
          '.wk .bl span.now,.wk .bl span.now b{color:' + window.hkCards.v('ink') + '}',
          // THE MONTH FITS ITS CARD (2026-10-16, the user: a day tapped pushed
          // the figures out of the card): its weeks are at most 30 px and give
          // way when the card is short -- six weeks, the day's line on two
          // lines -- rather than the figures under them
          '.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:auto;grid-auto-rows:minmax(16px,30px);gap:5px;',
          '  margin:auto 0;width:100%;max-width:300px;align-self:center;flex:0 1 auto;min-height:0}',
          // (the card's name whole; the line beside it gives way first)
          '.ttl b{flex:none}.ttl span{min-width:0;overflow:hidden;text-overflow:ellipsis}',
          '.cal .dh{font-size:11px;font-weight:600;line-height:1;color:' + window.hkCards.v('ink-3') + ';text-align:center;padding-bottom:3px}',
          '.cal .c{min-height:0;border-radius:8px;display:grid;place-items:center;font-size:12px;font-weight:600;line-height:1;color:#fff;',
          '  text-shadow:0 1px 1px rgba(0,0,0,0.25);font-variant-numeric:tabular-nums}',
          '.cal .c.out{background:none}',
          // a day still to come: outlined, quiet, nothing to tap yet
          '.cal .c.fut{background:none;box-shadow:inset 0 0 0 1px ' + window.hkCards.v('line') + ';color:' + window.hkCards.v('ink-3') + ';text-shadow:none}',
          '.cal .c.today{box-shadow:inset 0 0 0 1.5px #fff}',
          'button.c{border:0;padding:0;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .15s ease}',
          'button.c:active{transform:scale(0.92)}',
          '.cal .c.sel{box-shadow:0 0 0 2px #fff,0 4px 12px rgba(0,0,0,0.35);transform:scale(1.08);position:relative;z-index:1}',
          '.leg.dayl{color:' + window.hkCards.v('ink-2') + ';font-size:13px}',
          '.leg.dayl b{color:' + window.hkCards.v('ink') + ';font-weight:600}',
          '.leg{display:flex;align-items:center;flex-wrap:wrap;gap:6px;row-gap:8px;margin-top:14px;font-size:12px;line-height:1;color:' + window.hkCards.v('ink-3') + ';flex:none;',
          '  width:100%;max-width:300px;align-self:center}',
          '.leg i{width:16px;height:10px;border-radius:3px}',
          '.leg i.dash{width:18px;height:0;border-radius:0;border-top:1.5px dashed rgba(255,255,255,0.6)}',
          '.leg .li{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;margin-right:8px}',
          '.leg .gr{flex:1}',
          '@media (max-width:' + window.hkCards.BP.phone + 'px){hk-plate.ep.shape{--hk-ep-h:330px}}'
        ].join('');
      }
      _render() {
        this._shell('shape');
        var x = this._data(), p = period();
        if (x.wait) return this._paint('<div class="wait">Loading…</div>');
        var M = x.M, R = x.R, D = x.D, tz = window.hkStats && window.hkStats.tz();
        var sec = EP.pick ? M.sections.filter(function (s) { return s.id === EP.pick; })[0] : null;
        var pc = sec ? sec.color : RING.energy, name = sec ? sec.name : null, us = usualOfSec(R, sec);
        var main = '', ttlR = '', side = [];
        this._scrubT = null;
        if (p === 'now' || p === 'day') {
          // 24 hours around a dial, midnight at the top, this hour brightest
          var dayIdx = R.hToday, vals = dayIdx.map(function (i) { return slotOf(M, R, D.h, i, sec); });
          var mx = Math.max.apply(null, vals.concat([0.1])), cx = 150, cy = 150, r0 = 58, r1 = 128, svg = '';
          var pt = function (a, r) { return (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1); };
          var wedge = function (a0, a1, rr) { return 'M' + pt(a0, r0) + ' L' + pt(a0, rr) + ' A' + rr + ' ' + rr + ' 0 0 1 ' + pt(a1, rr) + ' L' + pt(a1, r0) + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' +
            pt(a0, r0) + 'Z'; };
          for (var hh = 0; hh < 24; hh++) {
            var a0 = (hh / 24) * 2 * Math.PI - Math.PI / 2 + 0.02, a1 = ((hh + 1) / 24) * 2 * Math.PI - Math.PI / 2 - 0.02;
            svg += '<path d="' + wedge(a0, a1, r1) + '" fill="' + window.hkCards.v('key') + '"/>';
            if (hh < vals.length) {
              svg += '<path class="gw" data-i="' + hh + '" style="--i:' + hh + '" d="' + wedge(a0, a1, r0 + (r1 - r0) * Math.max(0.04, vals[hh] / mx)) + '" fill="' + pc + '" fill-opacity="' +
                (hh === vals.length - 1 ? 1 : 0.82) + '"/>';
            }
          }
          [['12 AM', 0], ['6 AM', 6], ['12 PM', 12], ['6 PM', 18]].forEach(function (l) {
            var a = (l[1] / 24) * 2 * Math.PI - Math.PI / 2;
            svg += '<text x="' + (cx + (r1 + 16) * Math.cos(a)).toFixed(1) + '" y="' + (cy + (r1 + 16) * Math.sin(a) + 4).toFixed(1) +
              '" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" opacity="0.4">' + l[0] + '</text>';
          });
          var so = sum(vals);
          svg += '<text x="150" y="146" text-anchor="middle" font-size="26" font-weight="700" fill="currentColor">' + kwh(so) + '</text>' +
            '<text x="150" y="166" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor" opacity="0.68">kWh so far</text>';
          main = '<svg class="clock small" viewBox="-14 -14 328 328" aria-label="Today by hour">' + svg + '</svg>';
          // the dial reads out by the hour under the pointer: its angle
          this._scrubT = { sel: '.clock', nowI: vals.length - 1, name: 'Today by hour',
            tips: Array.apply(null, Array(24)).map(function (_, k) {
              var nm = slotName(p, R, k, tz);
              return k < vals.length ? nm + ' \u00b7 ' + kwh(vals[k]) + ' kWh' + (k === vals.length - 1 ? ' so far' : '') : nm + ' \u00b7 not yet';
            }),
            index: function (x, y, box) {
              var r = box.getBoundingClientRect(), cx = r.left + r.width * (164 / 328), cy = r.top + r.height * (164 / 328);
              var a = Math.atan2(y - cy, x - cx) + Math.PI / 2;
              if (a < 0) a += 2 * Math.PI;
              return Math.floor(a / (2 * Math.PI) * 24) % 24;
            } };
          ttlR = p === 'now' ? 'so far, by hour' : 'hour by hour';
          var bi = vals.indexOf(Math.max.apply(null, vals)), qi = -1, qv = Infinity;
          vals.forEach(function (z, i) { if (i < vals.length - 1 && z < qv) { qv = z; qi = i; } });
          if (bi >= 0 && vals[bi] > 0) side.push(['Busiest Hour', hourName(R.ax.h[dayIdx[bi]].t, tz), kwh(vals[bi]) + ' kWh', 'Busiest']);
          if (qi >= 0) side.push(['Quietest Hour', hourName(R.ax.h[dayIdx[qi]].t, tz), kwh(qv) + ' kWh', 'Quietest']);
          side.push(['A Usual Day by Now', kwh(us * R.share) + '<u>kWh</u>', 'Today ' + kwh(so) + ' kWh', 'Usual']);
        } else if (p === 'week') {
          // HK's bars, each day stacked by section in its color (the lit
          // section alone when one is), what is on no device on top in gray,
          // and today's still-to-come as a ghost. A DAY STILL TO COME is last
          // week's same day in gray (the user, 2026-10-12: it keeps the week
          // starting on its first day and still shows last week's).
          var wsl = R.slots, F = window.hkStats.fields;
          var wv = wsl.map(function (i) { return i == null ? null : slotOf(M, R, D.d, i, sec); });
          var avW = Math.min(300, (this._card.clientWidth || 360) - 44);
          if (!this._card.clientWidth) this._later();
          var anyGhost = false;
          var wbars = wsl.map(function (i, k) {
            var letter = 'SMTWTFS'[F(R.dates[k]).weekday], g = R.ghosts[k];
            if (i == null) {
              var gv = g == null ? 0 : slotOf(M, R, D.d, g, sec);
              if (g != null) anyGhost = true;
              return { segs: [], ghost: gv, ghostColor: '#ffffff', fut: true, label: '<b>' + letter + '</b>' + (g == null ? '\u00b7' : fx(gv, 0)) };
            }
            var segs = sec ? [{ v: wv[k], c: pc }] : M.sections.map(function (s4) {
              return { v: slotOf(M, R, D.d, i, s4), c: s4.color };
            }).concat([{ v: Math.max(0, homeAt(M, D.d, i) - sum(M.sections.map(function (s5) { return slotOf(M, R, D.d, i, s5); }))), c: REST }]);
            var today = k === R.todayK;
            return { segs: segs, now: today, ghost: today ? us : 0, ghostColor: pc, label: '<b>' + letter + '</b>' + fx(wv[k], 0) };
          });
          var oneCol = (this._card.clientWidth || 360) < 560;
          this._scrubT = { sel: '.wk .bc', nowI: R.todayK, name: 'This week by day', tips: wsl.map(function (i, k) {
            var nm = slotName(p, R, k, tz), g2 = R.ghosts[k];
            if (i == null) return nm + ' \u00b7 not yet' + (g2 != null ? ' \u00b7 last week ' + fx(slotOf(M, R, D.d, g2, sec), 0) + ' kWh' : '');
            var pct = us > 0 ? Math.round(100 * (wv[k] / (us * (k === R.todayK ? R.share : 1)) - 1)) : 0;
            return nm + ' \u00b7 ' + fx(wv[k], 0) + ' kWh' + (k === R.todayK ? ' so far' : '') +
              (us > 0 ? ' \u00b7 ' + (Math.abs(pct) < 7 ? 'about usual' : Math.abs(pct) + '% ' + (pct > 0 ? 'above' : 'below') + ' usual') : '');
          }) };
          main = '<div class="wk small">' + barChart({ bars: wbars, avail: avW, H: oneCol ? 108 : 150, usual: us, id: 'wk' }) + '</div>' +
            '<div class="leg"><span class="li"><i class="dash"></i>A usual day: ' + fx(us, 0) + ' kWh</span>' +
            (R.cur ? '<span class="li"><i style="background:' + rgba(pc, 0.16) + '"></i>Today, still to come</span>' : '') +
            (anyGhost ? '<span class="li"><i style="background:rgba(255,255,255,0.16)"></i>Last week</span>' : '') + '</div>';
          ttlR = 'kWh a day';
          var have = [], wholeK = [];
          wsl.forEach(function (i, k) { if (i != null) { have.push(k); if (k !== R.todayK) wholeK.push(k); } });
          var pickBy = function (list, big) {
            return list.reduce(function (a, k) { return a < 0 || (big ? wv[k] > wv[a] : wv[k] < wv[a]) ? k : a; }, -1);
          };
          var wb = pickBy(have, true), wq = wholeK.length >= 2 ? pickBy(wholeK, false) : -1;
          var dayOf = function (k) { return dayName(R.dates[k], tz).split(',')[0]; };
          if (wb >= 0 && wv[wb] > 0) side.push(['Biggest Day', dayOf(wb), fx(wv[wb], 0) + ' kWh', 'Biggest']);
          else side.push(['Biggest Day', '\u2014', 'Not a day in yet', 'Biggest']);
          if (wq >= 0) side.push(['Quietest Day', dayOf(wq), fx(wv[wq], 0) + ' kWh', 'Quietest']);
          else side.push(['Quietest Day', '\u2014', 'Two whole days first', 'Quietest']);
          var spent = sum(have.map(function (k) { return wv[k]; }));
          side.push(['A Day ' + (R.cur ? 'This Week' : R.back === 1 ? 'Last Week' : 'That Week'),
            R.cur && R.whole === 0 ? '\u2014' : fx(spent / Math.max(1, R.days), 0) + '<u>kWh</u>', 'Usually ' + fx(us, 0) + ' kWh', 'A Day']);
        } else {
          // THE MONTH ITSELF, its rows starting on the first day of the week;
          // the days still to come outlined (nothing to tap yet)
          var md = R.slots, F2 = window.hkStats.fields, w0 = EP.ws || 0, cells = '';
          for (var c0 = 0; c0 < 7; c0++) cells += '<div class="dh">' + 'SMTWTFS'[(w0 + c0) % 7] + '</div>';
          var first = (F2(R.dates[0]).weekday - w0 + 7) % 7;
          for (var e2 = 0; e2 < first; e2++) cells += '<div class="c out"></div>';
          var hi = 0, lo = 0, gone = [];
          md.forEach(function (i, k) {
            var dn = F2(R.dates[k]).day;
            if (i == null) { cells += '<div class="c fut">' + dn + '</div>'; return; }
            var z = slotOf(M, R, D.d, i, sec), today = k === R.todayK, exp = us * (today ? R.share : 1);
            var st2 = stepOf(exp > 0 ? z / exp : 1);
            if (!today) { gone.push(i); if (st2[2].indexOf('above') >= 0) hi++; else if (st2[2].indexOf('elow') >= 0) lo++; }
            var dlab = new Date(R.dates[k]).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })) + ' \u00b7 ' +
              fx(z, 0) + ' kWh' + (today ? ' so far' : '') + ' \u00b7 ' + st2[2].toLowerCase() + ' usual';
            cells += '<button class="c gp' + (today ? ' today' : '') + (EP.dayPick === i ? ' sel' : '') + '" data-day="' + i + '" aria-label="' + esc(dlab) + '" title="' + fx(z, 0) + ' kWh · ' +
              st2[2] + (today ? ' so far' : '') +
              '" style="--i:' + k + ';background:' + st2[1] + '">' + dn + '</button>';
          });
          // A DAY TAPPED: its own line in place of the legend, its figures, its devices
          var pick = EP.dayPick != null && md.indexOf(EP.dayPick) >= 0 ? EP.dayPick : null;
          if (pick != null) {
            var pz = slotOf(M, R, D.d, pick, sec), pexp = us * (md.indexOf(pick) === R.todayK ? R.share : 1);
            var ppct = pexp > 0 ? Math.round(100 * (pz / pexp - 1)) : 0, pcost = costAt(M, D.d, pick);
            var pname = new Date(R.ax.d[pick].t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }));
            main = '<div class="cal small">' + cells + '</div><div class="leg dayl"><span class="li"><b>' + pname + '</b></span><span class="li">' + fx(pz, 0) + ' kWh \u00b7 ' +
              (Math.abs(ppct) < 7 ? 'about usual' : Math.abs(ppct) + '% ' + (ppct > 0 ? 'above' : 'below') + ' usual') +
              (M.hasCost && !sec ? ' \u00b7 ' + this._money(pcost, 2) : '') + '</span></div>';
          } else {
            main = '<div class="cal small">' + cells + '</div><div class="leg"><span class="li">Less ' + STEPS.map(function (s2) { return '<i style="background:' + s2[1] + '"></i>'; }).join('') +
              ' More</span><span class="gr"></span><span class="li">Usual: ' + fx(us, 0) + ' kWh</span></div>';
          }
          ttlR = pick != null ? 'tap it again for the month' : 'against a usual day';
          var mv = gone.map(function (i) { return slotOf(M, R, D.d, i, sec); }), mb = mv.indexOf(Math.max.apply(null, mv));
          if (mb >= 0) side.push(['Biggest Day', new Date(R.ax.d[gone[mb]].t).toLocaleDateString(window.hkLocale.tag(),
            window.hkLocale.zoned({ weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })),
            fx(mv[mb], 0) + ' kWh', 'Biggest']);
          else side.push(['Biggest Day', '\u2014', 'Not a whole day yet', 'Biggest']);
          // the whole days gone: "of 11" on the 12th, a month's own length once past
          side.push(['Days Above Usual', gone.length ? String(hi) : '\u2014', 'of ' + gone.length + ', red and orange', 'Above Usual']);
          side.push(['Days Below Usual', gone.length ? String(lo) : '\u2014', 'of ' + gone.length + ', green', 'Below Usual']);
          if (pick != null) {
            side = [['That Day', pname, 'Tap it again for the month', 'Day'],
                    ['Used', fx(pz, 0) + '<u>kWh</u>', 'A usual day ' + fx(us, 0) + ' kWh', 'Used'],
                    M.hasCost && !sec ? ['Cost', this._money(pcost, 2), 'A usual day ' + this._money(R.typ.cost, 2), 'Cost']
                                      : ['Against Usual', (ppct > 0 ? '+' : '') + ppct + '<u>%</u>', '', 'vs Usual']];
          }
        }
        // the same figures, short, for one column
        var trio = side.slice(0, 3).map(function (s6) {
          var v6 = String(s6[1]);
          if (p === 'month' && /,/.test(v6)) v6 = v6.split(', ')[1];          // "Sun, Sep 13" -> "Sep 13"
          return '<div><div class="k">' + esc(s6[3] || s6[0]) + '</div><div class="v">' + v6 + '</div></div>';
        }).join('');
        if (trio) main += '<div class="mt">' + trio + '</div>';
        var defName = p === 'week' ? 'Your Week' : p === 'month' ? 'Your Month' : 'Your Day';
        // THE DEVICES THAT USED THE MOST in the period (in the lit section, if
        // one is), each in its section's color
        var dayOnly = p === 'month' && EP.dayPick != null && R.idx.indexOf(EP.dayPick) >= 0;
        var top = R.counted.map(function (r) { return dayOnly ? { d: r.d, v: v(D.d, r.d.stat, EP.dayPick) } : r; })
          .filter(function (r) { return (!sec || r.d.sec === sec) && r.v > 0.05; })
          .sort(function (a, b) { return b.v - a.v; });
        var tmax = top.length ? top[0].v : 1;
        var Wk = p === 'week' ? 'Week' : 'Month';
        var most = '<div class="mh">Most Used ' + (dayOnly ? 'That Day' : p === 'now' || p === 'day' ? 'Today' : R.cur ? 'This ' + Wk :
          R.back === 1 ? 'Last ' + Wk : p === 'week' ? 'That Week' : 'in ' + esc(monthOf(R.start))) +
          ' \u00b7 ' + top.length + '</div><div class="hk-edge"><div class="ml">' +
          top.map(function (r) {
            return '<div class="mr"' + moreAttr(r.d.power || r.d.stat) + '><b>' + esc(r.d.name) + '</b><span>' + kwh(r.v) + ' kWh</span><i><em style="width:' +
              (100 * r.v / tmax).toFixed(1) + '%;background:' + r.d.sec.color + '"></em></i></div>';
          }).join('') + '</div></div>';
        var mw = p === 'month' ? 300 : 260;
        this._paint('<div class="ttl"><b>' + esc(name || defName) + '</b><span>' + ttlR + '</span></div><div class="body" style="--mw:' + mw + 'px"><div class="main">' + main +
          '</div><div class="side">' + side.map(function (s3) {
            return '<div><div class="k">' + esc(s3[0]) + '</div><div class="big num">' + s3[1] + '</div><div class="cap">' + esc(s3[2]) + '</div></div>';
          }).join('') + '</div>' + (top.length ? '<div class="most">' + most + '</div>' : '') + '</div>');
        var self = this, sc = this._scrubT;
        if (sc) this._scrubs(this._card.querySelector(sc.sel), sc.tips, { nowI: sc.nowI, name: sc.name, index: sc.index });
        // THE MONTH: a day's cell reads out on hover or focus; a tap still picks it
        if (p === 'month' && !this._calRead) {
          this._calRead = true;
          var cardEl = this._card;
          var say = function (b) {
            var sp = cardEl.querySelector('.ttl span');
            if (!sp) return;
            if (!b) { if (sp._rest != null) { sp.textContent = sp._rest; sp._rest = null; } return; }
            if (sp._rest == null) sp._rest = sp.textContent;
            sp.textContent = b.getAttribute('aria-label') || b.getAttribute('title') || '';
          };
          cardEl.addEventListener('pointerover', function (e) { if (e.pointerType === 'mouse') say(e.target.closest && e.target.closest('.cal .c[data-day]')); });
          cardEl.addEventListener('pointerout', function (e) { if (e.pointerType === 'mouse' && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.cal .c[data-day]'))) say(
            null); });
          cardEl.addEventListener('focusin', function (e) { say(e.target.closest && e.target.closest('.cal .c[data-day]')); });
          cardEl.addEventListener('focusout', function () { say(null); });
        }
        this._card.querySelectorAll('.cal .c[data-day]').forEach(function (b) {
          if (b._hkBound) return;
          b._hkBound = true;
          b.addEventListener('click', function (e) {
            e.stopPropagation();
            var i = Number(b.getAttribute('data-day'));
            EP.dayPick = EP.dayPick === i ? null : i;
            self.redraw();
          });
        });
      }
    }

    // ------------------------------------------------------- one bar chart
    // HK's bars, wherever a card draws a row of them: at most 20 px wide with a
    // gap of 0.42 of a bar, the chart only as wide as its bars (narrower bars
    // when there are more than its width holds, never wider ones). Each bar is
    // a stack of parts; `ghost` is how much of a usual slot is still to come;
    // `usual` draws a dotted line; labels sit centered under their bars.
    // `floor` (a temperature, never energy): bars rise from it, not from zero.
    function barChart(o) {
      var bars = o.bars, n = bars.length, H = o.H || 96, avail = Math.max(60, o.avail || 280);
      var bw = Math.max(3, Math.min(20, avail / (n + (n - 1) * 0.42))), gap = bw * 0.42, W = n * bw + (n - 1) * gap;
      var fl = o.floor || 0;
      if (fl) {
        bars = bars.map(function (b) {
          return Object.assign({}, b, { segs: b.segs.map(function (g) { return { v: Math.max(0, g.v - fl), c: g.c }; }) });
        });
        o = Object.assign({}, o, { usual: o.usual ? Math.max(0, o.usual - fl) : 0 });
      }
      var mx = o.max || 0;
      bars.forEach(function (b) {
        var t = sum(b.segs.map(function (g) { return g.v; }));
        if (t > mx) mx = t;
        if (b.ghost && b.ghost > mx) mx = b.ghost;
      });
      if (o.usual && o.usual * 1.08 > mx) mx = o.usual * 1.08;
      mx = mx || 1;
      var rx = Math.min(4, bw / 3), svg = '', labs = '';
      bars.forEach(function (b, i) {
        var x0 = i * (bw + gap), y = H;
        if (b.ghost) {
          var gh = H * b.ghost / mx;
          svg += '<rect data-i="' + i + '" x="' + x0.toFixed(1) + '" y="' + (H - gh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + gh.toFixed(1) + '" rx="' + rx.toFixed(1) + '" fill="' +
            rgba(b.ghostColor || '#ffffff', 0.16) + '"/>';
        }
        var tot = sum(b.segs.map(function (g) { return g.v; }));
        if (tot <= 0) {
          svg += '<rect data-i="' + i + '" x="' + x0.toFixed(1) + '" y="' + (H - 3) + '" width="' + bw.toFixed(1) + '" height="3" rx="1.5" fill="' + window.hkCards.v('key') + '"/>';
        } else {
          // the stack, drawn as one rounded bar: each part clipped from it
          var g0 = '<g class="gr2" data-i="' + i + '" style="--i:' + i + '">', hTot = Math.max(3, H * tot / mx), top = H - hTot;
          var cid = 'c' + (o.id || 'b') + i;
          g0 += '<clipPath id="' + cid + '"><rect x="' + x0.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hTot.toFixed(1) + '" rx="' + rx.toFixed(1) +
            '"/></clipPath>';
          b.segs.forEach(function (g) {
            if (g.v <= 0) return;
            var hh = hTot * g.v / tot;
            y -= hh;
            g0 += '<rect clip-path="url(#' + cid + ')" x="' + x0.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (hh + 0.5).toFixed(1) + '" fill="' + g.c + '"' +
              (b.dim ? ' fill-opacity="0.5"' : '') + '/>';
          });
          svg += g0 + '</g>';
        }
        if (b.label) labs += '<span class="' + (b.now ? 'now' : b.fut ? 'fut' : '') + '" style="left:' + (x0 + bw / 2).toFixed(1) + 'px">' + b.label + '</span>';
      });
      if (o.usual) {
        var uy = (H - H * o.usual / mx).toFixed(1);
        svg += '<path d="M-4 ' + uy + 'H' + (W + 4).toFixed(1) + '" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.5" stroke-dasharray="2 4"/>';
      }
      return '<div class="bc"><svg width="' + W.toFixed(1) + '" height="' + H + '" viewBox="0 0 ' + W.toFixed(1) + ' ' + H + '" style="overflow:visible">' + svg + '</svg>' +
        (labs ? '<div class="bl" style="width:' + W.toFixed(1) + 'px">' + labs + '</div>' : '') + '</div>';
    }
    // the bars' labels for a period: hours at 12 AM / 6 / 12 PM / 6, a week's
    // day letters, a month's every seventh date
    // the bars' labels for a period: hours at 12 AM / 6 / 12 PM / 6, a week's
    // day letters, a month's 1st, 8th, 15th, 22nd and 29th -- each under its
    // own day, the days still to come too (`t` names another day's bar)
    function slotLabel(per, R, i, k, count, t) {
      if (per === 'now' || per === 'day') return ['12a', '', '', '', '', '', '6a', '', '', '', '', '', '12p', '', '', '', '', '', '6p', '', '', '', '', ''][k] || '';
      var f = window.hkStats.fields(t != null ? t : R.dates[k]);
      if (per === 'week') return 'SMTWTFS'[f.weekday];
      return (f.day - 1) % 7 === 0 ? String(f.day) : '';
    }
    // the period's slots for a source: today's 24 hours (the future empty), or
    // every day of the week or month (those still to come without an index,
    // each with last period's same day for its gray)
    function slotsOf(R, D) {
      var day = R.per === 'now' || R.per === 'day';
      return day ? { ser: D.h, idx: R.hToday, count: 24, nowK: R.hToday.length - 1, ghosts: [] }
                 : { ser: D.d, idx: R.slots, count: R.n, nowK: R.todayK, ghosts: R.ghosts };
    }
    // ONE GLYPH BOX for the battery and the drop: 56 x 72, so neither card's
    // figures start lower or further in than the other's
    function glyphBattery(fill) {
      return '<svg class="gl" width="56" height="72" viewBox="0 0 56 72" aria-hidden="true"><rect x="20" y="2" width="16" height="6" rx="2.5" fill="currentColor" opacity=".35"/>' +
        '<rect x="6" y="8" width="44" height="62" rx="11" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2.5"/>' +
        '<rect x="11" y="' + (13 + 52 * (1 - fill)).toFixed(1) + '" width="34" height="' + (52 * fill).toFixed(1) + '" rx="7" fill="#30d158"/>' +
        '<path d="M30.5 27 23 41h6l-1.5 10 8-14h-6z" fill="#fff" opacity=".9"/></svg>';
    }
    function glyphDrop(color, gas) {
      return '<svg class="gl" width="56" height="72" viewBox="0 0 56 72" aria-hidden="true">' + (gas
        ? '<path d="M28 6c2.5 9 14 16 14 31a14 14 0 0 1-28 0c0-7 5-12 7-17 0 5 2.5 7 5 7 0-7 0-14 2-21z" fill="' + color + '"/>'
        : '<path d="M28 6s20 22 20 37a20 20 0 0 1-40 0C8 28 28 6 28 6z" fill="' + color +
          '"/><path d="M18 45a10 10 0 0 0 10 10" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/>') +
        '</svg>';
    }
    var MINI_CSS = [
      'hk-plate.ep.mini{--hk-ep-h:340px}',
      '.flow{display:flex;align-items:center;gap:14px;margin-top:12px;flex:none}',
      '.flow .gl{flex:none}',
      '.flow .big{line-height:1}',
      '.flow .cap{margin-top:5px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}',
      // three small figures in a row, under the big one
      '.trio{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px;padding-top:12px;flex:none;',
      '  border-top:1px solid ' + window.hkCards.v('line') + '}',
      '.trio .k{font-size:11px;letter-spacing:0.4px;gap:5px;overflow:hidden;text-overflow:ellipsis}',
      '.trio .k i{width:8px;height:8px}',
      '.trio .v{font-size:17px;font-weight:700;letter-spacing:-0.3px;margin-top:4px;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.trio .v u{text-decoration:none;font-size:12px;font-weight:600;margin-left:2px;color:' + window.hkCards.v('ink-2') + '}',
      // the chart in the room between the figure and the three figures, which
      // sit at the foot on the same line as Your Day's
      '.foot{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-top:12px}',
      '.bc{display:flex;flex-direction:column;align-items:center}',
      '.bl{position:relative;height:12px;margin-top:6px}',
      '.bl span{position:absolute;top:0;transform:translateX(-50%);font-size:11px;font-weight:600;line-height:1;white-space:nowrap;',
      '  color:' + window.hkCards.v('ink-3') + '}',
      '.bl span.now{color:' + window.hkCards.v('ink') + '}',
      // WIDE (the same width Your Day's side panel appears at): the headline
      // and the chart on the left, the three figures stacked on the right
      // behind the same divider, so the row's three cards change together
      '.mb{flex:1;display:flex;gap:24px;min-height:0}',
      '.mm{flex:1;display:flex;flex-direction:column;min-width:0}',
      '.ms{display:none;width:190px;flex:none;flex-direction:column;justify-content:center;gap:14px;',
      '  border-left:1px solid ' + window.hkCards.v('line') + ';padding-left:22px}',
      '.ms .big{font-size:22px;margin-top:5px}',
      '@container (min-width:' + window.hkCards.BP.cardSide + 'px){.ms{display:flex}.trio{display:none}}',
      '@media (max-width:' + window.hkCards.BP.phone + 'px){hk-plate.ep.mini{--hk-ep-h:330px}}'
    ].join('');
    // the side panel's three figures: [label, value, note]
    function sidePanel(items) {
      return '<div class="ms">' + items.map(function (x) {
        return '<div><div class="k">' + x[0] + '</div><div class="big num">' + x[1] + '</div><div class="cap">' + esc(x[2]) + '</div></div>';
      }).join('') + '</div>';
    }

    // what the shell and the later parts use of this one
    K.barChart = barChart; K.glyphBattery = glyphBattery; K.glyphDrop = glyphDrop;
    K.HkEnergyDayCard = HkEnergyDayCard; K.MINI_CSS = MINI_CSS; K.sidePanel = sidePanel; K.slotLabel = slotLabel;
    K.slotsOf = slotsOf;
  };
})();
