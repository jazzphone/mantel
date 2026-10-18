// hk-charts.js - the drawing half of the pop-up charts.
//
// SINCE THE DESIGN CONSOLIDATION (2026-10-12) the cards outside the sheets --
// hk-usage-card, hk-trace-card, hk-battery-strip-card -- draw with the Energy
// page's own charts (hk-energy.js barChart / lineSvg) and only read their
// data here (usage(), recent(), power()). bars() and line() stay for the
// detail sheets' graphs; capsule() and usage()'s own bars were retired.
//
// Pure geometry: hand it numbers, get back a markup string. It never touches
// hass and never fetches anything -- hk-stats.js owns the data, this owns the
// picture, and a card wires the two together in three lines instead of pasting
// sixty lines of maths into every template.
//
// WHY THIS IS HTML AND NOT SVG
// SVG with preserveAspectRatio="none" would let a chart fill whatever width
// its card happens to be, but it stretches the ENTIRE coordinate system --
// including the glyphs -- so every date and time label comes out
// horizontally smeared.
// The fix is not a different aspect-ratio value: uniform scaling would make
// the chart's height follow its width, which is just as wrong in a fixed-height
// tile.
//
// Everything drawn here is rectangles, straight lines and text. HTML does all
// three natively, resolution-independently, with no coordinate system to
// distort -- and the text then inherits SF Pro from the card instead of the
// SVG default. So: percentage-width divs, absolutely positioned rules and
// labels. No viewBox anywhere.
//
// Strings are returned because the cards render them as HTML (morph()).
//
// MEASURED OFF the Home app -- a screenshot of its energy chart, sampled rather than eyeballed:
//   prior-period bar      #48484a
//   current-period bar    vertical gradient #f4b865 -> #f1a252
//   current average line  #f4b562 dotted
//   prior average line    #9c9ca1 dotted
//   inset track / cell    #3e3e40
//   "good window" fill    #65db7c
//   bar : column pitch    0.70  (27.2px bar on a 39.0px pitch)
//   series split          7 days against the preceding 7
//
// NOTE ON THE ORANGE: the Home app's chart orange (#f1a252) is markedly softer than
// the house icon orange (#ff9f0a, hkCards.PALETTE in cards/hk-base.js).
// They are not interchangeable -- a large filled area at icon saturation
// glares. Fills use the chart ramp here, glyphs keep the nameMap.
(function () {
  'use strict';

  var C = {
    // The prior period is RECESSED, not a fixed gray. #48484a, measured off
    // the Home app, is right on a dark #323232 plate; on the light-glass
    // plate it lands within ~21 total channel steps of the background and the
    // comparison half of every chart disappears. A translucent black tracks
    // whatever plate it is on -- clearly darker on glass AND still distinct
    // on the dark plate -- so it cannot silently vanish when the surface
    // changes.
    prior: 'rgba(0, 0, 0, 0.32)',
    curHi: '#f4b865',
    curLo: '#f1a252',
    avgCur: '#f4b562',
    avgPrior: '#9c9ca1',
    track: '#3e3e40',
    good: '#65db7c',
    now: 'rgba(255,255,255,0.95)',
    dim: 'rgba(255,255,255,0.45)'
  };

  // The house palette's `chart` variant (hkCards.PALETTE, cards/hk-base.js):
  // the icon hues as rgb triples, so a chart and the glyph above it are the
  // same color family. Read at call time -- this module loads in parallel
  // with the card files, and only hk cards call it, which cannot exist before
  // hk-base.js has run.
  function hues() { return window.hkCards.PALETTE.chart; }

  // Icon colors are too hot for a large filled area -- that is exactly why
  // the Home app's chart orange (#f1a252) is softer than its icon orange (#ff9f0a).
  // Rather than hand-pick a second palette and let the two drift, derive it:
  // lighten toward white, then take a little brightness off. Checked against
  // the measured pair -- orange yields #f5b451 / #f2a733 against the Home app's
  // #f4b865 / #f1a252, i.e. the same transform Apple applied.
  function soften(rgb, mix, dim) {
    return 'rgb(' + rgb.map(function (c) {
      return Math.round((c + (255 - c) * mix) * dim);
    }).join(',') + ')';
  }

  function ramp(name) {
    var NAME = hues();
    var rgb = NAME[String(name || '').toLowerCase()] || NAME.orange;
    return {
      hi:  soften(rgb, 0.34, 0.96),   // gradient top
      lo:  soften(rgb, 0.21, 0.95),   // gradient bottom
      avg: soften(rgb, 0.27, 0.97)    // the dotted rule and the labels
    };
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function finite(v) { return typeof v === 'number' && isFinite(v); }

  // Hours as "11h 21m". Used by opts.format:'hm' -- a NAMED format rather than
  // a formatter function, because these options are declared in dashboard
  // config and YAML cannot carry a function.
  //
  // Rounds to the minute BEFORE splitting, so 11.999 h renders "12h" and never
  // "11h 60m". Drops the hours when there are none ("34m") and the minutes
  // when they are zero ("12h"), which is how a duration is normally written.
  function fmtHM(h) {
    if (!finite(h)) return '--';
    var neg = h < 0;
    var total = Math.round(Math.abs(h) * 60);
    var hh = Math.floor(total / 60), mm = total % 60;
    var out = hh ? (hh + 'h' + (mm ? ' ' + mm + 'm' : '')) : (mm + 'm');
    return (neg ? '\u2212' : '') + out;
  }

  // Label type, shared by every chart so the pop-ups agree. Kept here rather
  // than in the cards because these labels live inside a generated markup
  // blob.
  var LABEL = 'font-size:11px; font-weight:600; letter-spacing:0.1px; ' +
              'line-height:1; white-space:nowrap;';

  // -------------------------------------------------------------------------
  // bars(data, opts) -- the Home app's Usages chart.
  //
  // data : [{t: Date, v: number|null}] oldest first, from hkStats.daily()
  // opts : { split }     index where the current period starts. Default is
  //                      half the series, the 7-vs-7 the Home app uses.
  //        { height }    plot height in px, default 78
  //        { labels }    false to drop the date row
  //        { avg }       false to drop the dotted average lines
  //        { baseline }  'min' to float the floor (see below)
  //        { fmtLabel }  Date -> string
  //        { max }       the top of the scale, for a caller drawing its own
  //                      value axis (a round number at or above the data)
  // -------------------------------------------------------------------------
  function bars(data, opts) {
    opts = opts || {};
    if (!data || !data.length) return '';

    var n = data.length;
    var split = opts.split == null ? Math.ceil(n / 2) : opts.split;
    var plotH = opts.height == null ? 78 : opts.height;

    var vals = data.map(function (d) { return finite(d.v) ? d.v : null; });
    var max = 0, min = Infinity;
    vals.forEach(function (v) {
      if (v == null) return;
      if (v > max) max = v;
      if (v < min) min = v;
    });
    // a day still to come can carry last period's same day (`ghost`), drawn
    // recessed like the prior period; it counts toward the scale
    data.forEach(function (d) { if (d && finite(d.ghost) && d.ghost > max) max = d.ghost; });
    if (max <= 0) max = 1;
    if (finite(opts.max) && opts.max >= max) max = opts.max;

    // Energy starts at zero: a bar IS the quantity, and a floating baseline
    // would misstate it. Temperature does not -- fourteen days between 80 and
    // 85 degrees drawn from zero is fourteen identical bars. baseline:'min'
    // drops the floor just under the smallest value so the variation is
    // legible, with 35% headroom so the shortest bar is still a bar.
    var base = 0;
    if (opts.baseline === 'min' && isFinite(min)) {
      base = min - (max - min) * 0.35;
      if (max - base < 1e-6) base = min - 1;
    }
    var span = Math.max(1e-6, max - base);

    // The prior period stays gray in every chart. It is the reference, and
    // coloring it too would leave nothing to read the comparison against.
    var R = opts.ramp || { hi: C.curHi, lo: C.curLo, avg: C.avgCur };

    var cells = [];
    for (var i = 0; i < n; i++) {
      var v = vals[i];
      var inner = '';
      if (v != null) {
        // Sub-pixel bars vanish entirely, which reads as missing data rather
        // than a near-zero day. Floor the drawn height so a real zero-ish
        // value still leaves a visible stub.
        var h = Math.max(2, ((v - base) / span) * plotH);
        var fill = i >= split
          ? 'linear-gradient(to bottom, ' + R.hi + ', ' + R.lo + ')'
          : C.prior;
        // 70% of the column, which is the Home app's measured bar:pitch ratio.
        inner = '<div style="width:70%; height:' + h.toFixed(1) + 'px;' +
                ' border-radius:2px; background:' + fill + ';"></div>';
      } else if (data[i] && finite(data[i].ghost)) {
        var gh = Math.max(2, ((data[i].ghost - base) / span) * plotH);
        inner = '<div style="width:70%; height:' + gh.toFixed(1) + 'px;' +
                ' border-radius:2px; background:' + C.prior + ';"></div>';
      }
      cells.push('<div style="display:flex; align-items:flex-end;' +
                 ' justify-content:center; height:100%; min-width:0;">' + inner + '</div>');
    }

    var rules = '';
    var means = [];
    if (opts.avg !== false) {
      // One dotted rule per series, spanning only that series' own bars --
      // this is what makes the comparison readable at a glance, and it is the
      // detail most obviously missing from a plain bar chart.
      // usage() passes the means it already computed. It must: the headline
      // average EXCLUDES today's partial bucket, and a rule drawn from an
      // independently-computed mean that includes it lands somewhere else --
      // 111 against a stated 118.8, two numbers for one line. Anything reading
      // its own mean off the bars would drift from the headline every morning.
      var given = opts.meanValues;
      [[0, split, C.avgPrior, 0], [split, n, R.avg, 1]].forEach(function (seg) {
        var a = seg[0], b = seg[1], col = seg[2], gi = seg[3];
        var vs = vals.slice(a, b).filter(function (x) { return x != null; });
        var mean;
        if (given && finite(given[gi])) {
          mean = given[gi];
        } else {
          if (!vs.length) return;
          mean = vs.reduce(function (p, c) { return p + c; }, 0) / vs.length;
        }
        var y = plotH - ((mean - base) / span) * plotH;
        means.push({ v: mean, y: y, colour: col });
        rules += '<div style="position:absolute; pointer-events:none;' +
                 ' left:' + (a / n * 100).toFixed(3) + '%;' +
                 ' width:' + ((b - a) / n * 100).toFixed(3) + '%;' +
                 ' top:' + y.toFixed(1) + 'px; height:0;' +
                 ' border-top:1.5px dotted ' + col + ';"></div>';
      });
    }

    // X AXIS. Three marks, which is what makes the span readable: where the
    // prior period starts, where the current one starts, and that the right
    // edge is today. Without the third, fourteen bars under two dates could
    // just as easily be read as sub-day buckets.
    var labels = '';
    if (opts.dayLabels) {
      // One letter per bar. Two dates at the ends do not say which bar is
      // which day, so a spike cannot be tied to a Saturday without
      // counting along the axis. Today's letter is tinted and bold, which
      // also marks the right-hand end without spending a second label row.
      var INITIAL = 'SMTWTFS';
      var parts = '';
      for (var j = 0; j < n; j++) {
        var last = j === n - 1;
        parts += '<div style="position:absolute; text-align:center;' +
                 ' left:' + (j / n * 100).toFixed(3) + '%;' +
                 ' width:' + (100 / n).toFixed(3) + '%;' +
                 ' color:' + (last ? R.avg : 'var(--hk-ink-3,rgba(255,255,255,0.40))') + ';' +
                 ' font-size:10px; line-height:1; white-space:nowrap;' +
                 ' font-weight:' + (last ? '700' : '600') + ';">' +
                 INITIAL.charAt(haFields(data[j].t).weekday) + '</div>';
      }
      labels = '<div style="position:relative; height:12px; margin-top:6px;">' + parts + '</div>';
    } else if (opts.labels !== false) {
      var fmt = opts.fmtLabel || function (d) {
        return dateText(d, { month: 'short', day: 'numeric' });
      };
      var parts2 = '';
      [[0, C.avgPrior], [split, R.avg]].forEach(function (seg) {
        var i2 = seg[0];
        if (!data[i2]) return;
        parts2 += '<div style="position:absolute; left:' + (i2 / n * 100).toFixed(3) + '%;' +
                  ' color:' + seg[1] + '; ' + LABEL + '">' + esc(fmt(data[i2].t)) + '</div>';
      });
      parts2 += '<div style="position:absolute; right:0; color:' + R.avg + '; ' +
                LABEL + '">' + esc(opts.lastLabel || 'Today') + '</div>';
      labels = '<div style="position:relative; height:12px; margin-top:6px;">' + parts2 + '</div>';
    }

    // Y AXIS, in a right-hand gutter rather than over the plot. Overlaying it
    // would collide with whichever bar happened to be tall that week; a gutter
    // costs a little bar width and can never collide. Two marks only -- the
    // axis top and the axis floor.
    //
    // The floor matters more than it looks: with baseline:'min' it is NOT
    // zero, so a chart labelled only at the top would overstate every
    // difference. That is the case this exists for.
    var gutter = '';
    if (opts.scale !== false) {
      var fv = opts.fmtValue || function (v) {
        return (max >= 10 ? Math.round(v) : v.toFixed(1)) + (opts.unitLabel ? ' ' + opts.unitLabel : '');
      };
      var Y = 'position:absolute; right:0; ' + LABEL + ' font-weight:500;';
      var dim = ' color:var(--hk-ink-3,rgba(255,255,255,0.40));';

      // The axis ends.
      var marks = [
        { y: -1, text: fv(max), style: dim, from: 'top', pinned: true },
        // A zero floor is written "0", not "0.0 kWh": the unit is already on
        // the top mark and repeating it on a zero adds width for no meaning.
        { y: -1, text: (base === 0 ? '0' : fv(base)), style: dim, from: 'bottom', pinned: true }
      ];

      // ...and the two period averages, each sitting at the height of its own
      // dotted rule and tinted to match it. This is the piece that makes the
      // card legible: the headline says "118.8 kWh/day" and the orange 119
      // here sits exactly on the orange dotted line, so where the number came
      // from stops being a guess. Without it the rules are two unexplained
      // dashes and the average has no visible provenance.
      if (opts.avgLabels !== false) {
        var fm = opts.fmtMean || fv;
        // Current period first. Marks are placed in order and a later one is
        // dropped if it would overprint, so whichever is listed first wins a
        // collision -- and the current average is the number the headline
        // states, which makes it the one worth keeping.
        means.slice().reverse().forEach(function (m) {
          marks.push({ y: m.y, text: fm(m.v), style: ' color:' + m.colour + ';', from: 'top' });
        });
      }

      // Marks must not overprint each other. The axis ends are pinned -- they
      // mean "this is the top / the floor" and moving them would lie -- so
      // they are placed first and never move. An average may slide a few
      // pixels to clear one: the dotted rule already shows exactly where it
      // sits, so the gutter figure is a value readout, not a position, and a
      // small offset costs nothing. Only if it still cannot fit is it dropped.
      //
      // This case is common, not exotic: an HVAC runtime average can sit at
      // 88% of its own peak, within half a pixel of the axis top, which would
      // silently hide the number the card is about.
      var GAP = 12, SLIDE = 7;
      var placed = [];
      var html = '';

      function conflict(y) {
        for (var k = 0; k < placed.length; k++) {
          if (Math.abs(placed[k] - y) < GAP) return placed[k];
        }
        return null;
      }

      // EVERY MARK IS COMPARED BY THE TOP OF ITS BOX. The floor is anchored by
      // its bottom edge and the others by their top, and comparing those two
      // anchor lines directly is wrong by a whole line height: a floor at
      // y=38 occupies 27.5-38, an average at y=24 occupies 24-34.5, and |38-24|
      // = 14 passes the 12px test while the two print over each other (as
      // on a 38px temperature plot: "76.2" through "71°F"). Converting the
      // floor to a box top first puts both on the same edge. The rendered
      // position of every mark is the same -- `top: plotH + 1 - LH` is exactly
      // where `bottom: -1px` would put it.
      var LH = 10.5;                                   // LABEL: 10.5px, line-height 1
      marks.forEach(function (m) {
        var y = m.from === 'bottom' ? plotH - m.y - LH : m.y;
        var c = conflict(y);
        if (c !== null) {
          if (m.pinned) return;                       // axis ends never move
          var away = y >= c ? 1 : -1;
          var moved = c + away * GAP;
          if (Math.abs(moved - y) > SLIDE || conflict(moved) !== null) return;
          if (moved < -2 || moved > plotH - LH + 2) return;  // would leave the gutter
          y = moved;
        }
        placed.push(y);
        html += '<div style="' + Y + m.style + ' top:' +
                y.toFixed(1) + 'px;">' + esc(m.text) + '</div>';
      });

      gutter = '<div style="position:relative; width:' + (opts.gutter || 46) + 'px;' +
               ' height:' + plotH + 'px; flex:0 0 auto;">' + html + '</div>';
    }

    return '<div style="width:100%; display:flex; align-items:flex-start; gap:7px;">' +
             '<div style="flex:1 1 auto; min-width:0;">' +
               '<div style="position:relative; height:' + plotH + 'px;' +
               ' display:grid; grid-template-columns:repeat(' + n + ', minmax(0, 1fr));">' +
                 cells.join('') + rules +
               '</div>' + labels +
             '</div>' + gutter +
           '</div>';
  }

  // -------------------------------------------------------------------------
  // line(points, opts) -- a live trace of recent history.
  //
  // The complement to bars(): bars answer "is today normal", this answers
  // "what is the house doing right now". Modeled on the history card in the
  // community apple-home-concept dashboard, which is the look this is meant
  // to match -- a 2.5px stroke, a gradient area under it fading to nothing, two
  // faint gridlines, and NO axis labels at all. The number lives in the card
  // header, not on the chart.
  //
  // Unlike everything else in this file this one IS an SVG, because a polyline
  // is not expressible as divs. It is safe here where the bar chart was not:
  // there is no text inside the viewBox, so preserveAspectRatio="none" can
  // stretch the geometry without smearing any glyphs -- exactly the trade the
  // reference card makes.
  //
  // points : [{t: Date, v: number}] oldest first. Numeric arrays remain
  //          accepted for callers that have no timestamps.
  // opts   : { height } px, default 138
  //          { colour } nameMap name; the stroke and the area fade
  //          { grid }   false to drop the two horizontal rules
  //          { lo, hi } a fixed value range, for a caller drawing its own
  //                     value axis: lo maps to the bottom, hi to the top
  //          { pad }    px kept clear above hi and below lo (default 10
  //                     above, 2 below) -- equal, so an axis can find them
  // -------------------------------------------------------------------------
  var lineUid = 0;
  function line(points, opts) {
    opts = opts || {};
    var p = (points || []).map(function (point, i) {
      if (point && typeof point === 'object') {
        return { v: Number(point.v), t: new Date(point.t).getTime(), i: i };
      }
      return { v: Number(point), t: NaN, i: i };
    }).filter(function (point) { return finite(point.v); });
    var H = opts.height == null ? 138 : opts.height;
    if (p.length < 2) {
      return '<div style="height:' + H + 'px;"></div>';
    }

    var W = 760;
    var values = p.map(function (point) { return point.v; });
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (finite(opts.lo) && finite(opts.hi) && opts.hi > opts.lo) { lo = opts.lo; hi = opts.hi; }
    // Min-to-max, like the reference: a house that never drops below half its
    // peak would otherwise draw as a flat line near the top of the box.
    var span = (hi - lo) || 1;
    var top = finite(opts.pad) ? opts.pad : 10;
    var plot = H - top - (finite(opts.pad) ? opts.pad : 2);

    var timed = p.every(function (point) { return isFinite(point.t); });
    var t0 = timed ? p[0].t : 0, t1 = timed ? p[p.length - 1].t : 0;
    // { t0, t1 }: a span of the caller's (a calendar week: Sunday to
    // Saturday, the line stopping at now and the rest of it empty)
    if (timed && finite(opts.t0) && finite(opts.t1) && opts.t1 > opts.t0) { t0 = opts.t0; t1 = opts.t1; }
    timed = timed && t1 > t0;
    var pts = p.map(function (point, i) {
      var x = timed ? (point.t - t0) * W / (t1 - t0) : i * W / (p.length - 1);
      return [x, top + (hi - point.v) * plot / span];
    });
    var path = pts.map(function (q, i) {
      return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
    }).join(' ');
    var area = path + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + H + ' L' + pts[0][0].toFixed(1) + ' ' + H + ' Z';

    var col = opts.colour ? ramp(opts.colour) : ramp('orange');
    var stroke = col.lo;
    var gid = 'hkline' + (++lineUid);

    var grid = opts.grid === false ? '' :
      '<path d="M0 ' + (H * 0.33).toFixed(0) + 'H' + W +
      'M0 ' + (H * 0.66).toFixed(0) + 'H' + W +
      '" style="stroke:var(--hk-line,rgba(255,255,255,0.10))" stroke-width="1" fill="none"/>';

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"' +
           ' style="width:100%; height:' + H + 'px; display:block;">' +
             '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
               '<stop offset="0" stop-color="' + stroke + '" stop-opacity="0.28"/>' +
               '<stop offset="1" stop-color="' + stroke + '" stop-opacity="0"/>' +
             '</linearGradient></defs>' +
             grid +
             '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
             '<path d="' + path + '" fill="none" stroke="' + stroke + '"' +
             ' stroke-width="3" stroke-linecap="round" stroke-linejoin="round"' +
             ' vector-effect="non-scaling-stroke"/>' +
           '</svg>';
  }

  // -------------------------------------------------------------------------
  // recent(hass, entityId, card, opts) -- the live-trace card in one call.
  //
  // Sibling of usage(): that one is the daily comparison, this one is the last
  // few hours. Returns { ready, ttl, sub, val, chart } so a card fills its
  // slots in one line each.
  // -------------------------------------------------------------------------
  function recent(hass, entityId, card, opts) {
    opts = opts || {};
    var hours = opts.hours || 3;
    var ttl = opts.title || 'Whole Home Power';
    var sub = 'Last ' + hours + ' hours';
    if (!window.hkStats) {
      return { ready: false, ttl: ttl, sub: 'hk-stats.js not loaded', val: '--', chart: '' };
    }
    // The headline is the LIVE state, not the last history row -- history can
    // lag by a recorder commit interval (5s by default) and a card that disagrees
    // with the pill next to it reads as broken.
    var val = power(hass && hass.states ? hass.states : {}, entityId);
    var pts = window.hkStats.history(hass, entityId, hours, card);
    if (!pts) return { ready: false, ttl: ttl, sub: sub, val: val, chart: '' };
    // pts: the history itself, for a card that draws HK's own line
    // (hk-trace-card, with the Energy page's lineSvg)
    return { ready: true, ttl: ttl, sub: sub, val: val, pts: pts };
  }

  // -------------------------------------------------------------------------
  // usage(hass, statId, card, opts) -- the whole Usages card in one call.
  //
  // The ONLY function here that reaches for hk-stats.js. Everything above is
  // pure geometry; this is deliberately the single seam between the two, so a
  // card fills its slots in one line each instead of thirty lines of
  // arithmetic repeated per device.
  //
  // Returns { ready, val, sub, chart }. While the statistics are still in
  // flight ready is false and the strings are placeholders, so a template can
  // render it unconditionally.
  // -------------------------------------------------------------------------
  function usage(hass, statId, card, opts) {
    opts = opts || {};
    var days = opts.days || 14;
    var unit = opts.unit || 'kWh';
    var digits = opts.digits == null ? 1 : opts.digits;
    var noun = opts.noun || 'Daily usage';
    var idle = { ready: false, val: '--', sub: 'Loading history…', chart: '' };

    if (!window.hkStats) return { ready: false, val: '--', sub: 'hk-stats.js not loaded', chart: '' };
    // source:'dailyPeak' for sensors that accumulate through the day and reset
    // at midnight (the HVAC run-time ones). See hk-stats.js -- their daily
    // statistics are contaminated by the reset and cannot be used directly.
    var d = opts.source === 'dailyPeak'
      ? window.hkStats.dailyPeak(hass, statId, days, card)
      : window.hkStats.daily(hass, statId, days, card, opts.statOpts);
    if (!d) return idle;

    var split = Math.ceil(days / 2);
    var cur = d.slice(split).filter(function (r) { return finite(r.v); });
    var prev = d.slice(0, split).filter(function (r) { return finite(r.v); });

    // Today is a partial bucket. It belongs in the chart -- the Home app draws it,
    // and a missing final bar looks like an outage -- but averaging it in
    // would drag the headline down all morning, so it is excluded from the
    // mean and from the comparison.
    var curFull = cur.slice(0, Math.max(0, cur.length - 1));
    var mean = function (a) {
      if (!a.length) return null;
      return a.reduce(function (p, c) { return p + c.v; }, 0) / a.length;
    };
    var mCur = mean(curFull.length ? curFull : cur);
    var mPrev = mean(prev);

    // "Avg. 118.8 kWh" does not say an average of WHAT -- per day? over the
    // fortnight on screen? "118.8 kWh/day" answers it in the headline itself,
    // and the gutter then shows the same number on its own dotted rule.
    // scale lets a series be stated in a friendlier unit than it is recorded
    // in -- the run-time sensors are hours, and the Home app says "Avg. 617 min".
    var k = finite(opts.scaleBy) ? opts.scaleBy : 1;
    var hm = opts.format === 'hm';
    var val = mCur == null ? '--'
      : (opts.valPrefix || '') +
        (hm ? fmtHM(mCur)
            : (mCur * k).toFixed(digits) + (opts.unitSpace === false ? '' : ' ') + unit) +
        (opts.valSuffix == null ? '/day' : opts.valSuffix);

    var sub;
    var comparable = mCur != null && mPrev != null &&
                     (opts.delta === 'absolute' || mPrev > 0);
    if (!comparable) {
      sub = 'Not enough history to compare yet';
    } else if (opts.delta === 'absolute') {
      // A percentage of a temperature is meaningless -- 82 degrees is not
      // "6% warmer" than 78 in any sense a reader can use. Say the difference.
      var diff = hm ? (mCur - mPrev) : (mCur - mPrev) * k;
      var range2 = fmtRange(d[0].t, d[split - 1].t);
      var words = opts.words || ['higher', 'lower'];
      if (Math.abs(diff) < (opts.flat == null ? 1 : opts.flat)) {
        sub = noun + ' is about the same as ' + range2;
      } else {
        sub = noun + ' is ' +
              (hm ? fmtHM(Math.abs(diff))
                  : Math.abs(diff).toFixed(digits) + (opts.deltaUnit || '')) + ' ' +
              (diff > 0 ? words[0] : words[1]) + ' than ' + range2;
      }
    } else {
      var pct = Math.round(((mCur - mPrev) / mPrev) * 100);
      var range = fmtRange(d[0].t, d[split - 1].t);
      if (Math.abs(pct) < 5) sub = noun + ' is about the same as ' + range;
      else sub = noun + ' is ' + Math.abs(pct) + '% ' +
                 (pct > 0 ? 'higher' : 'lower') + ' than ' + range;
    }

    // data / split / mPrev: the fortnight itself; the card draws it with
    // HK's own bars (hk-usage-card, the Energy page's barChart)
    return { ready: true, val: val, sub: sub, data: d, split: split, mPrev: mPrev };
  }

  // ------------------------------------------------ LABELS FOLLOW THE BUCKETS
  //
  // hk-stats buckets in HOME ASSISTANT's timezone (see the long note there).
  // A caption rendered with the browser's own zone would therefore name the
  // wrong day for a client that is not in HA's zone -- correct bars under
  // wrong labels, which reads as right and is not. These four helpers are the
  // only places this file turns an instant into text, so they are the only
  // places that have to know.
  //
  // hkStats.tz() returns undefined when it has no better answer than the
  // browser, and an undefined `timeZone` option IS browser-local -- so there
  // is no branch here and nothing changes for a client in HA's zone.
  function haTZ() {
    return (window.hkStats && window.hkStats.tz && window.hkStats.tz()) || undefined;
  }
  function haFields(t) {
    return (window.hkStats && window.hkStats.fields)
      ? window.hkStats.fields(t)
      : { hour: t.getHours(), weekday: t.getDay() };
  }
  function dateText(d, o) {
    return d.toLocaleDateString('en-US', Object.assign({ timeZone: haTZ() }, o));
  }

  function fmtRange(a, b) {
    var mo = { month: 'short', day: 'numeric' };
    var A = dateText(a, mo);
    // Same month reads better as "Aug 24 - 30" than "Aug 24 - Aug 30", which
    // is how the Home app writes it too. Comparing the RENDERED month keeps the
    // test in HA's zone along with everything else here.
    var B = (dateText(a, { month: 'short' }) === dateText(b, { month: 'short' }))
      ? dateText(b, { day: 'numeric' })
      : dateText(b, mo);
    return A + ' – ' + B;
  }

  // -------------------------------------------------------------------------
  // power(states, id) -- format a power sensor, whatever unit it reports in.
  //
  // THE TRAP THIS EXISTS FOR: the power sensors in one house commonly mix kW
  // and W (template sensors, EV wall connectors and batteries often report
  // kW), and there is no naming rule that separates them. A card that does
  // `Math.round(v) + " W"` renders a 3.592 kW reading as "4 W" instead of
  // "3.59 kW". So the ONLY safe move is to read each entity's own
  // unit_of_measurement. Never assume watts.
  //
  // Normalizes to watts, then picks the readable unit: 2 decimals of kW at or
  // above a kilowatt (so the house reads 3.59 kW, not 4 kW), whole watts below
  // it (so a 50 W bedroom does not become a meaningless 0.05 kW).
  function power(states, id, opts) {
    opts = opts || {};
    var s = states && states[id];
    var v = Number(s && s.state);
    // `=== undefined`, NOT `== null`. Loose equality cannot tell "no fallback
    // given" from "the caller explicitly wants null", so `{fallback: null}`
    // would silently return the STRING '--' and callers doing arithmetic on
    // it would get NaN -- "NaN W" on a pill for any unavailable sensor. Some
    // sensors (EV wall connectors, say) drop out regularly, so that is not
    // hypothetical.
    if (!finite(v)) return opts.fallback === undefined ? '--' : opts.fallback;
    var u = String((s.attributes && s.attributes.unit_of_measurement) || '').toLowerCase();
    var w = u === 'kw' ? v * 1000 : (u === 'mw' ? v * 1e6 : v);
    if (opts.watts) return w;
    return Math.abs(w) >= 1000 ? (w / 1000).toFixed(2) + ' kW' : Math.round(w) + ' W';
  }

  window.hkChart = {
    power: power,
    ramp: ramp,
    fmtHM: fmtHM,
    line: line,
    recent: recent,
    bars: bars,
    usage: usage,
    colours: C
  };
  // Tell already-drawn cards this module exists -- see MODULE WAKE in hk-base.js.
  try { window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: 'hkChart' })); } catch (e) {}
})();
