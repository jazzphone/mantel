// hk-energy.js -- the energy charts: daily usage tiles, the live trace, the battery strip
// (since the design consolidation, 2026-10-12, drawn with the Energy page's own
// barChart / lineSvg and the House Battery's battery)
//
// hk-usage-card, hk-trace-card, hk-battery-strip-card, and the Energy page's own
// cards (hk-energy-*-card, from THE ENERGY PAGE down). Data and drawing come
// from modules/hk-stats.js and modules/hk-charts.js.
//
// One file per family of cards, so each file's name says what is in it.
// Shared pieces -- HkBase, the editor helpers, register(), create(), the
// snapshot cache -- come from hk-base.js through window.hkCards.
(function () {
  'use strict';

  // hk-base.js is a Lovelace resource fetched in PARALLEL with this one, so
  // wait for its ready EVENT (never poll: rAF does not fire in a hidden tab,
  // and a tablet behind the screensaver would define nothing -- see
  // hk-base.js).
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-energy] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkEnergy) return;                  // double-load guard
  var HkBase = C.HkBase, register = C.register, firstOf = C.firstOf,
      create = C.create;

  // THE PICKER'S STARTER SENSOR, BY KIND. firstOf(hass, 'sensor') is the
  // first sensor of any kind -- a media player's bitrate shown as a battery.
  // Each test is tried in turn (best first); the first sensor passing one
  // wins, and with none of them it is the first sensor, as before.
  function sensorWhere(hass) {
    var tests = Array.prototype.slice.call(arguments, 1);
    var st = (hass && hass.states) || {}, ids = Object.keys(st);
    for (var t = 0; t < tests.length; t++) {
      for (var i = 0; i < ids.length; i++) {
        if (ids[i].indexOf('sensor.') !== 0) continue;
        if (tests[t]((st[ids[i]] && st[ids[i]].attributes) || {})) return ids[i];
      }
    }
    return firstOf(hass, 'sensor');
  }

  // ----------------------------------------------------------- hk-usage
  //
  // A DAILY COMPARISON: a caption, a headline figure, a sentence saying how
  // this compares with the usual, and a fortnight of bars under it. Used on
  // the energy and weather pages.
  //
  // hk-charts.js reads the data -- hkChart.usage(hass, stat, card, opts)
  // returns {val, sub, data, split, mPrev} and wakes the card through
  // requestUpdate when its statistics arrive. This card is the plate, the
  // type scale, the grid and HK's bars (barChart, the Energy page's).
  //
  // `opts` is passed through UNTOUCHED. Every one of its keys belongs to
  // hk-charts.js (colour, source, format, noun, unit, delta, baseline,
  // statOpts, height, scale...), and re-declaring them here would be a second
  // place to keep them in step. See that file for what they mean.
  class HkUsageCard extends HkBase {
    // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)
    static get FLAT_MOTION() { return true; }
    static get CSS() {
      return [
        // The glass plate, its padding, and the caption/value type scale --
        // the same material hk_glass_tile gives every pop-up tile.
        'ha-card.usage{box-sizing:border-box;display:block;',
        '  height:var(--hk-usage-height,214px);padding:15px 16px 13px 16px;margin:0;' + window.hkCards.plate('card') + ';',
        '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
        // Four stacked text rows plus the plot. Fixed height rather than auto
        // so a row of these stays flush when one device's comparison sentence
        // wraps to two lines.
        '.usage .grid{display:grid;height:100%;',
        '  grid-template-areas:"nm" "val" "sub" "chart";',
        '  grid-template-columns:minmax(0,1fr);',
        '  grid-template-rows:min-content min-content min-content minmax(0,1fr);',
        '  justify-items:start;align-content:start;row-gap:0}',
        // LEFT, like the Home app's Energy page. width:100% without text-align
        // inherits a centred parent's alignment and the title floats over a
        // left-aligned stat.
        //
        // The PILL name scale, not the hk_popup_tile caps: these cards sit
        // beside pills, and an uppercase tracked caption here would read as a
        // heading for the section rather than a label on the tile.
        '.usage .nm{grid-area:nm;text-align:left;font-size:14px;font-weight:600;',
        '  letter-spacing:-0.15px;line-height:1.15;color:' + window.hkCards.v('ink-2') + ';',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%}',
        // 22px, not hk_popup_tile's 25px: that scale assumes two rows of text,
        // and at 25 the headline crowds the sentence under it.
        '.usage .val{grid-area:val;font-size:22px;font-weight:700;',
        '  letter-spacing:-0.45px;line-height:1.25;color:' + window.hkCards.v('ink') + ';',
        '  white-space:nowrap}',
        '.usage .sub:empty{display:none}',
        '.usage .sub{grid-area:sub;text-align:left;font-size:12.6px;',
        '  font-weight:400;letter-spacing:-0.05px;line-height:1.25;',
        '  color:' + window.hkCards.v('ink-2') + ';width:100%;white-space:normal}',
        '.usage .chart{grid-area:chart;justify-self:stretch;align-self:end;',
        '  width:100%;margin-top:10px}',
        // HK's bar chart (barChart, the Energy page's): centered, labels
        // under their own bars
        BARS_CSS,
        // ---- `align: center`, opt-in
        //
        // The default above is LEFT on purpose and stays that way: on the
        // Energy page left-aligned mirrors the Home app. On the weather page
        // one sits in a row with the four hk-weather-tile-cards, and those are
        // centred both ways -- one left-aligned tile in a row of centred ones
        // reads as a mistake.
        //
        // THE HEADING STAYS PINNED TO THE TOP, and that is the whole reason
        // this is not a plain `align-content:center`. The four tiles beside it
        // pack their captions to the top of the plate, and all five headings
        // sit on one line (measured: the same ink top on every card). Centring
        // the whole stack pushes this one 15px down and breaks that.
        //
        // So: `start`, with the VALUE's row taking the slack instead of the
        // chart's. The value then centres in whatever space is left between
        // the heading and the chart -- which is what makes the card look
        // settled once `compare: false` removes the sentence.
        //
        // The chart is NOT centred horizontally -- justify-self:stretch above
        // beats justify-items, which is what keeps it full width. A bar chart
        // shrunk to its content would be a different chart.
        '.usage.mid .grid{justify-items:center;align-content:start;',
        '  grid-template-rows:min-content minmax(0,1fr) min-content min-content}',
        '.usage.mid .val{align-self:center}',
        // THE NAME TAKES THE WEATHER TILES' CAPTION. The four
        // hk-weather-tile-cards beside this one on the weather page are the
        // reference: their `.wtile .cap` is the row's heading, so this card
        // adopts it rather than the other way round. Copied from
        // cards/hk-weather.js -- CHANGE ONE, CHANGE BOTH.
        //
        //     13px / 600 / +0.3px tracking / secondary ink / UPPERCASE
        //     (the one label, hkCards.TYPE label)
        //
        // text-transform, NOT an uppercase string: the text is a `name:` from
        // YAML, and shouting belongs in the presentation rather than in the
        // config somebody reads.
        //
        // line-height:INHERIT, not normal and not a number. `.wtile .cap` sets
        // none at all, so it picks up the theme's (1.6 here) and its box is
        // 19px at 12px type. `.usage .nm` pins 1.15, and `normal` gives 15px:
        // the heading sits 4px shorter than the four beside it. Inheriting is
        // what actually tracks the tiles, whatever the theme says.
        //
        // It stays LEFT while the value and the sentence centre -- the shape
        // of the whole row: heading left, body centred.
        '.usage.mid .sub,.usage.mid .val{text-align:center}',
        // 14px top, matching `.wtile`'s padding: with `.usage`'s own 15px the
        // heading's ink sits exactly 1px below the four beside it (measured
        // on the page).
        '.usage.mid{padding-top:14px}',
        '.usage.mid .nm{justify-self:start;text-align:left;font-size:13px;',
        '  font-weight:600;letter-spacing:0.3px;line-height:inherit;',
        '  text-transform:uppercase;color:' + window.hkCards.v('ink-2') + '}'
      ].join('');
    }
    setConfig(config) {
      if (!config || !config.stat) throw new Error('hk-usage: `stat` is required');
      super.setConfig(config);
    }
    getCardSize() { return 3; }

    // The tile reads STATISTICS, which arrive asynchronously and are not in
    // hass.states at all -- so the default signature would gate out exactly
    // the update this card exists to show. `entity` is the live sensor and
    // moves often enough to keep the tile current; hkChart caches the
    // statistics and calls requestUpdate when a fetch lands.
    _sigOf() {
      var h = this._hass, c = this._config;
      if (!h || !c) return null;
      var s = h.states[c.entity || c.stat];
      return (s ? s.last_updated : 'x') + '|' + (window.hkChart ? '1' : '0');
    }

    // More info opens `entity`, or the statistic's own sensor when there is
    // no `entity` -- what the editor promises. A statistic that is not an
    // entity (an external "domain:id" one) has no dialog to open, so it is
    // left as before.
    _act(spec, defaultMoreInfo) {
      var cfg = this._config || {}, h = this._hass;
      if (cfg.entity || !cfg.stat || !h || !h.states[cfg.stat]) {
        return super._act(spec, defaultMoreInfo);
      }
      this._config = Object.assign({}, cfg, { entity: cfg.stat });
      try { return super._act(spec, defaultMoreInfo); }
      finally { this._config = cfg; }
    }

    _render() {
      var cfg = this._config;
      if (!this._built) {
        this._root.innerHTML =
          '<ha-card class="usage' + (cfg.align === 'center' ? ' mid' : '') +
          '" data-hk-role="card"><div class="grid">' +
          '<div class="nm" data-hk-role="nm"></div>' +
          '<div class="val" data-hk-role="val"></div>' +
          '<div class="sub" data-hk-role="sub"></div>' +
          '<div class="chart" data-hk-role="chart"></div>' +
          '</div></ha-card>';
        var q = this._root.querySelector.bind(this._root);
        this._e = { card: q('.usage'), nm: q('.nm'), val: q('.val'),
                    sub: q('.sub'), chart: q('.chart') };
        // Only when asked. The energy page wants more-info (the dialog's
        // history graph is the natural next step); the weather row is a row of
        // inert tiles and the chart on its face already IS the history.
        if (cfg.tap_action && cfg.tap_action.action !== 'none') {
          this._bind(this._e.card, 'tap_action', null);
        }
        this._built = true;
      }
      var e = this._e;
      // A per-site height, which is a geometry override rather than a second
      // design: the weather row pins 172px so this tile matches the four
      // beside it, and clips so a long sentence cannot leave the row ragged.
      if (cfg.height) {
        e.card.style.height = cfg.height;
        e.card.style.overflow = 'hidden';
      }
      var nm = cfg.name || '';
      if (e.nm.textContent !== nm) e.nm.textContent = nm;

      var u = (window.hkChart && this._hass)
        ? window.hkChart.usage(this._hass, cfg.stat, this, cfg.opts || {})
        : {};
      // `compare: false` drops the comparison sentence. The chart already
      // shows the fortnight the sentence describes, so on a 172px tile it is
      // a second telling of the same thing and clutters the card. The
      // Energy page's tiles are 214px and keep it.
      //
      // Empty, not absent: the row is min-content so it collapses to nothing,
      // and `.sub:empty{display:none}` stops an empty box carrying its own
      // line-height into the stack.
      var val = u.val || '--';
      var sub = cfg.compare === false ? '' : (u.sub || '--');
      if (e.val.textContent !== val) e.val.textContent = val;
      if (e.sub.textContent !== sub) e.sub.textContent = sub;
      window.hkCards.morph(e.chart, this._bars(u));
    }
    // THE FORTNIGHT AS HK'S BARS (barChart): the last period dimmed, this one
    // in the tile's color, today the label in ink; the last period's average
    // is the usual, dotted. `opts.colour` (or `color`) is a color by name
    // (hkCards.PALETTE) or a hex; baseline: 'min' floats a temperature's
    // bars above their smallest
    _bars(u) {
      if (!u || !u.data || !u.data.length) return '';
      var o = this._config.opts || {}, d = u.data, last = d.length - 1;
      var col = colorOf(o.colour || o.color, NAMED.orange);
      var w = this._e.chart.clientWidth;
      if (!w) laterOf(this);
      var vs = d.map(function (r) { return typeof r.v === 'number' && isFinite(r.v) ? r.v : null; });
      var floor = 0;
      if (o.baseline === 'min') {
        var have = vs.filter(function (x) { return x !== null; });
        var mn = Math.min.apply(null, have), mxv = Math.max.apply(null, have);
        if (have.length) floor = mxv - mn > 1e-6 ? mn - (mxv - mn) * 0.35 : mn - 1;
      }
      var bars = d.map(function (r, i) {
        var f = window.hkStats && window.hkStats.fields ? window.hkStats.fields(r.t) : null;
        return { segs: [{ v: vs[i] === null ? 0 : vs[i], c: col }], dim: i < u.split, now: i === last,
                 label: o.dayLabels === false || !f ? '' : 'SMTWTFS'[f.weekday] };
      });
      return barChart({ bars: bars, avail: w || 280, H: o.height || 78, usual: u.mPrev || 0, floor: floor, id: 'u' });
    }
  }

  // ----------------------------------------------------------- hk-trace
  //
  // THE LIVE TRACE: a few hours of raw history as a line, with the current
  // value large at the right. Deliberately a DIFFERENT object from
  // hk-usage-card -- that one is a daily comparison and answers "is today
  // normal"; this answers "what is the house doing right now", which no other
  // card on the page does. Statistics are hourly at best and would flatten the
  // steps this exists to show, so hkChart.recent() reads raw recorder history.
  class HkTraceCard extends HkBase {
    // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)
    static get FLAT_MOTION() { return true; }
    static get CSS() {
      return [
        'ha-card.trace{box-sizing:border-box;display:block;',
        '  padding:18px 22px 16px 22px;margin:0;' + window.hkCards.plate('card') + ';',
        '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
        '.trace .grid{display:grid;',
        '  grid-template-areas:"ttl val" "sub val" "body body";',
        '  grid-template-columns:minmax(0,1fr) max-content;',
        '  grid-template-rows:min-content min-content min-content;',
        '  align-items:start;row-gap:0}',
        '.trace .ttl{grid-area:ttl;justify-self:start;font-size:16px;',
        '  font-weight:700;letter-spacing:-0.2px;line-height:1.25;',
        '  color:' + window.hkCards.v('ink') + ';white-space:nowrap}',
        '.trace .sub{grid-area:sub;justify-self:start;font-size:12px;',
        '  font-weight:400;line-height:1.3;margin-top:2px;',
        '  color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
        // 300 weight at 36px (figure-l's size). The reference card's headline is light, not
        // bold -- the trace under it is what carries the emphasis.
        '.trace .val{grid-area:val;grid-row:1 / 3;justify-self:end;',
        '  align-self:center;font-size:36px;font-weight:300;letter-spacing:-1px;',
        '  line-height:1;color:' + window.hkCards.v('ink') + ';white-space:nowrap}',
        // The unit set smaller and dimmer beside the numeral, as the reference
        // card does -- one string, two sizes.
        '.trace .val .u{font-size:0.4em;font-weight:500;letter-spacing:0;',
        '  opacity:0.55;margin-left:5px}',
        '.trace .body{grid-area:body;justify-self:stretch;width:100%;margin-top:10px}',
        // the Energy page's line (lineSvg) and its time labels
        '.trace .ln{display:block;width:100%}',
        TLAB_CSS
      ].join('');
    }
    setConfig(config) {
      if (!config || !config.entity) throw new Error('hk-trace: `entity` is required');
      super.setConfig(config);
    }
    getCardSize() { return 3; }
    // Raw history arrives asynchronously; the live sensor moving is what keeps
    // the headline current, and hkChart wakes the card when a fetch lands.
    _sigOf() {
      var h = this._hass, c = this._config;
      if (!h || !c) return null;
      var s = h.states[c.entity];
      return (s ? s.last_updated : 'x') + '|' + (window.hkChart ? '1' : '0');
    }
    _render() {
      var cfg = this._config;
      if (!this._built) {
        this._root.innerHTML =
          '<ha-card class="trace" data-hk-role="card"><div class="grid">' +
          '<div class="ttl" data-hk-role="ttl"></div>' +
          '<div class="sub" data-hk-role="sub"></div>' +
          '<div class="val" data-hk-role="val"></div>' +
          '<div class="body" data-hk-role="body"></div>' +
          '</div></ha-card>';
        var q = this._root.querySelector.bind(this._root);
        this._e = { card: q('.trace'), ttl: q('.ttl'), sub: q('.sub'),
                    val: q('.val'), body: q('.body') };
        if (cfg.tap_action && cfg.tap_action.action !== 'none') {
          this._bind(this._e.card, 'tap_action', null);
        }
        this._built = true;
      }
      var e = this._e;
      if (cfg.margin) e.card.style.margin = cfg.margin;
      var r = (window.hkChart && this._hass)
        ? window.hkChart.recent(this._hass, cfg.entity, this, cfg.trace || {})
        : {};
      var ttl = r.ttl || (cfg.trace && cfg.trace.title) || '';
      if (e.ttl.textContent !== ttl) e.ttl.textContent = ttl;
      var sub = r.sub || '';
      if (e.sub.textContent !== sub) e.sub.textContent = sub;
      // "1.48 kW" -> the numeral, then the unit in its own smaller run.
      var raw = String(r.val || '--'), parts = raw.split(' ');
      var html = parts.length > 1
        ? (parts[0] + '<span class="u">' + parts.slice(1).join(' ') + '</span>')
        : raw;
      window.hkCards.morph(e.val, html);
      var body = '';
      if (r.pts) {
        var t = cfg.trace || {}, hours = t.hours || 3, H = t.height || 138;
        var col = colorOf(t.colour || t.color, NAMED.orange);
        body = '<svg class="ln" style="height:' + H + 'px" viewBox="0 0 1000 ' + H + '" preserveAspectRatio="none">' +
          lineSvg(evenly(r.pts, hours, 120), 1000, H, col, { fill: 0.22, sw: 2.5 }) + '</svg>' +
          timeLabels(Date.now(), hours, window.hkStats && window.hkStats.tz ? window.hkStats.tz() : undefined);
      }
      window.hkCards.morph(e.body, body);
    }
  }
  // A LINE'S VALUES AT EVEN STEPS over the last `hours` (lineSvg spaces its
  // points evenly): each step the last reading at or before it, nothing
  // before the first
  function evenly(pts, hours, n) {
    var t1 = Date.now(), t0 = t1 - hours * HOUR, out = [], j = 0, last = null;
    var p = pts.map(function (x) { return { t: +new Date(x.t), v: Number(x.v) }; })
      .filter(function (x) { return isFinite(x.t) && isFinite(x.v); })
      .sort(function (a, b) { return a.t - b.t; });
    for (var i = 0; i <= n; i++) {
      var at = t0 + (t1 - t0) * i / n;
      while (j < p.length && p[j].t <= at) last = p[j++].v;
      out.push(last);
    }
    return out;
  }
  // A CARD THAT HAD NO WIDTH YET (not laid out) draws again once it has one
  function laterOf(card) {
    if (card._hkLater || typeof requestAnimationFrame !== 'function') return;
    card._hkLater = true;
    requestAnimationFrame(function () {
      card._hkLater = false;
      if (card.isConnected) { card._hkSig = null; card._render(); }
    });
  }
  // the bar chart's and the time labels' CSS, for the cards outside the
  // Energy page that draw them (the page's own cards have theirs below)
  var BARS_CSS = '.bc{display:flex;flex-direction:column;align-items:center}' +
    '.bl{position:relative;height:12px;margin-top:6px}' +
    '.bl span{position:absolute;top:0;transform:translateX(-50%);font-size:11px;font-weight:600;line-height:1;white-space:nowrap;' +
    'color:' + window.hkCards.v('ink-3') + '}' +
    '.bl span.now{color:' + window.hkCards.v('ink') + '}' +
    '.bc svg{display:block}';
  var TLAB_CSS = '.tlab{display:flex;justify-content:space-between;margin-top:6px;font-size:12px;font-weight:600;line-height:1;' +
    'color:' + window.hkCards.v('ink-3') + ';font-variant-numeric:tabular-nums}';

  // ------------------------------------------------- hk-battery-strip
  //
  // The house battery as one band: what it is doing, how much is in it, how
  // long that lasts, and a capsule showing the charge against its reserve and
  // its limit. Every figure is a named entity in the config.
  //
  // NEVER FORMAT A POWER SENSOR ON ITS RAW NUMBER: one home's power sensors
  // can report kW and W side by side. hkChart.power reads the
  // entity's own unit; {watts: true} returns a comparable number and the plain
  // call returns a formatted string.
  class HkBatteryStripCard extends HkBase {
    // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)
    static get FLAT_MOTION() { return true; }
    static get CSS() {
      return [
        'ha-card.strip2{box-sizing:border-box;display:block;',
        '  padding:15px 18px 13px 18px;margin:0;' + window.hkCards.plate('card') + ';',
        '  cursor:pointer;',
        '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
        // ONE HEADER ROW, NOT A STACK. A title with a sentence under it --
        // "Idle · 21.3 kWh stored · 11h 23m backup" -- reads as text jammed on
        // top of text, and half of that sentence repeats the Battery Flow and
        // Backup Time tiles that sit above this card. So: the name on the
        // left, the reading on the right on one baseline, and the bar with
        // room to breathe.
        '.strip2 .head{display:flex;align-items:baseline;justify-content:space-between;',
        '  gap:12px;min-width:0}',
        '.strip2 .ttl{font-size:15px;font-weight:700;letter-spacing:-0.2px;',
        '  line-height:1.2;color:' + window.hkCards.v('ink') + ';white-space:nowrap;',
        '  overflow:hidden;text-overflow:ellipsis;min-width:0}',
        '.strip2 .read{display:flex;align-items:baseline;gap:8px;flex:0 0 auto}',
        '.strip2 .kwh{font-size:13px;font-weight:500;letter-spacing:-0.05px;',
        '  color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
        '.strip2 .soc{font-size:22px;font-weight:700;letter-spacing:-0.5px;',
        '  line-height:1;color:' + window.hkCards.v('ink') + ';font-variant-numeric:tabular-nums}',
        '.strip2 .body{margin-top:11px;width:100%}',
        // THE HOUSE BATTERY'S BATTERY (hk-house-battery-card), small: an
        // outline with its nub, filled to the level (red at or under the
        // reserve), light running back through it while the house draws on
        // it, the reserve and the limit as ticks through the outline; the
        // outline is a mark, so a light page of your own draws it gray
        '.bat{position:relative;height:30px;border-radius:10px;border:3px solid ' + window.hkCards.v('mark') + ';padding:3px;margin-right:9px;box-sizing:border-box}',
        '.bat:after{content:"";position:absolute;right:-9px;top:6px;width:5px;height:12px;border-radius:0 3px 3px 0;background:' + window.hkCards.v('mark') + '}',
        '.bat .fill{position:relative;overflow:hidden;height:100%;border-radius:5px;background:' + window.hkCards.v('battery-fill') + ';transition:width .6s ease}',
        '.bat .fill.low{background:' + window.hkCards.v('battery-fill-low') + '}',
        '.bat .hshim{position:absolute;top:0;bottom:0;width:35%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);',
        '  animation:hRun 1.8s linear infinite reverse}',
        '@keyframes hRun{from{left:-35%}to{left:100%}}',
        '@media (prefers-reduced-motion: reduce){.bat .hshim{display:none}}',
        '.bat .mk{position:absolute;top:-8px;bottom:-8px;width:0;border-left:2px dashed;',
        '  -webkit-mask-image:linear-gradient(to bottom,#000 8px,transparent 8px,transparent calc(100% - 8px),#000 calc(100% - 8px));',
        '  mask-image:linear-gradient(to bottom,#000 8px,transparent 8px,transparent calc(100% - 8px),#000 calc(100% - 8px))}'
      ].join('');
    }
    setConfig(config) {
      if (!config || !config.entity) {
        throw new Error('hk-battery-strip: `entity` is the state of charge');
      }
      super.setConfig(config);
    }
    getCardSize() { return 2; }
    _sigOf() {
      var h = this._hass, c = this._config;
      if (!h || !c) return null;
      var ids = [c.entity, c.discharge, c.stored, c.reserve, c.limit].filter(Boolean);
      var out = '';
      for (var i = 0; i < ids.length; i++) {
        var s = h.states[ids[i]];
        out += ids[i] + '=' + (s ? s.state : 'x') + ';';
      }
      return out;
    }
    _num(id) {
      var s = id && this._st(id);
      var n = Number(s && s.state);
      return isFinite(n) && s && s.state !== '' ? n : null;
    }
    _render() {
      var cfg = this._config;
      if (!this._built) {
        this._root.innerHTML =
          '<ha-card class="strip2" data-hk-role="card">' +
          '<div class="head"><div class="ttl" data-hk-role="ttl"></div>' +
          '<div class="read"><span class="kwh" data-hk-role="kwh"></span>' +
          '<span class="soc" data-hk-role="soc"></span></div></div>' +
          '<div class="body" data-hk-role="body"></div>' +
          '</ha-card>';
        var q = this._root.querySelector.bind(this._root);
        this._e = { card: q('.strip2'), ttl: q('.ttl'), kwh: q('.kwh'), soc: q('.soc'), body: q('.body') };
        this._bind(this._e.card, 'tap_action', null);
        this._built = true;
      }
      var e = this._e, C = window.hkChart;
      if (cfg.margin) e.card.style.margin = cfg.margin;
      var soc = this._num(cfg.entity);
      var name = cfg.name || 'House Battery';
      if (e.ttl.textContent !== name) e.ttl.textContent = name;
      var socTxt = soc === null ? '--%' : Math.round(soc) + '%';
      if (e.soc.textContent !== socTxt) e.soc.textContent = socTxt;
      // Stored energy stays: nothing else on the page says it. The state and
      // the backup runtime are left out -- the tiles above say both, and the bar's
      // colour already says charging versus discharging.
      var kwh = this._num(cfg.stored);
      var kwhTxt = kwh === null ? '' : kwh.toFixed(1) + ' kWh';
      if (e.kwh.textContent !== kwhTxt) e.kwh.textContent = kwhTxt;

      var dis = null;
      if (C && this._hass && cfg.discharge) {
        dis = C.power(this._hass.states, cfg.discharge, { watts: true, fallback: null });
      }

      var body = '';
      if (soc !== null) {
        var lvl = Math.max(0, Math.min(100, soc)), res = this._num(cfg.reserve), lim = this._num(cfg.limit);
        var mark = function (v, col) {
          if (v === null || v <= 0 || v >= 100) return '';
          return '<div class="mk" style="left:calc(3px + (100% - 6px) * ' + (v / 100) + ');border-color:' + col + '"></div>';
        };
        // light runs back through it while the house is drawing on the pack
        // -- the one state where the number is falling
        body = '<div class="bat"><div class="fill' + (res !== null && lvl <= res ? ' low' : '') + '" style="width:' + lvl + '%">' +
          (dis !== null && dis >= 5 ? '<div class="hshim"></div>' : '') + '</div>' +
          mark(res, '#ff9f0a') + mark(lim, 'var(--hk-battery-mark,rgba(255,255,255,.85))') + '</div>';
      }
      window.hkCards.morph(e.body, body);
    }
  }

  register('hk-usage-card', HkUsageCard, 'HK Usage Tile',
    'Today\'s energy use or runtime compared with the last two weeks, with a bar chart.',
    C && [
      { name: 'stat', required: true, label: 'Daily statistic',
        helper: 'The sensor with long-term statistics to chart.',
        selector: { entity: { filter: { domain: 'sensor' } } } },
      { name: 'name', selector: { text: {} } },
      // Left by default, as on the Energy page. Center is for a tile that
      // sits in a row of centered weather tiles.
      { name: 'compare', label: 'Comparison sentence',
        helper: 'Off drops the "about the same as ..." line. The chart already shows that fortnight.',
        selector: { boolean: {} } },
      { name: 'align', label: 'Text alignment',
        helper: 'Center to match a row of centered tiles. Left is the default; the chart stays full width either way.',
        selector: { select: { mode: 'dropdown', custom_value: true, options: [
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' } ] } } },
      C.section('Chart', [
        { name: 'opts', selector: { object: {} } },
        { name: 'height', selector: { text: {} }, helper: 'CSS height of the tile, e.g. 172px.' }
      ], 'mdi:chart-bar'),
      C.section('Interactions', [
        { name: 'entity', label: 'Entity to open',
          helper: 'Opened by More info. Defaults to the statistic.', selector: { entity: {} } },
        { name: 'tap_action', selector: { ui_action: {} } }
      ], 'mdi:gesture-tap')
    ],
    // An energy total (what the Energy page charts), else any energy sensor.
    function (hass) {
      return { stat: sensorWhere(hass,
        function (a) { return a.device_class === 'energy' &&
          (a.state_class === 'total' || a.state_class === 'total_increasing'); },
        function (a) { return a.device_class === 'energy'; }),
        name: 'Whole Home' };
    });

  register('hk-trace-card', HkTraceCard, 'HK Live Graph',
    'A line graph of the last few hours of a sensor, with its current value.',
    C && [
      { name: 'entity', required: true, selector: { entity: { filter: { domain: 'sensor' } } } },
      { name: 'trace', selector: { object: {} } },
      C.section('Layout', [
        { name: 'margin', selector: { text: {} } }
      ], 'mdi:ruler'),
      C.section('Interactions', [
        { name: 'tap_action', selector: { ui_action: {} } }
      ], 'mdi:gesture-tap')
    ],
    function (hass) {
      return { entity: sensorWhere(hass, function (a) { return a.device_class === 'power'; }),
               trace: { hours: 3, colour: 'orange' } };
    });

  register('hk-battery-strip-card', HkBatteryStripCard, 'HK Battery Strip',
    'A home battery\'s charge level against its reserve and charge limit, with stored energy.',
    C && [
      { name: 'entity', required: true, label: 'Battery level sensor',
        helper: 'Percent charged.', selector: { entity: { filter: { domain: 'sensor' } } } },
      { name: 'name', selector: { text: {} } },
      C.section('Sensors', [
        { type: 'grid', name: '', schema: [
          { name: 'stored', selector: { entity: { filter: { domain: 'sensor' } } } },
          { name: 'discharge', selector: { entity: { filter: { domain: 'sensor' } } },
            helper: 'Turns the bar amber while the house is running on the battery.' },
          { name: 'reserve', selector: { entity: { filter: { domain: ['number', 'input_number', 'sensor'] } } } },
          { name: 'limit', selector: { entity: { filter: { domain: ['number', 'input_number', 'sensor'] } } } }
        ] }
      ], 'mdi:battery', true),
      C.section('Layout', [
        { name: 'margin', selector: { text: {} } }
      ], 'mdi:ruler'),
      C.section('Interactions', [
        { name: 'tap_action', selector: { ui_action: {} } }
      ], 'mdi:gesture-tap')
    ],
    function (hass) {
      return { entity: sensorWhere(hass,
        function (a) { return a.device_class === 'battery'; },
        function (a) { return a.unit_of_measurement === '%'; }) };
    });


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
    return (v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
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
  function prefs(hass, card) {
    if (card) EP.cards.add(card);
    var fresh = EP.prefs && (Date.now() - EP.prefsAt) < 10 * 60e3;
    if (!fresh && !EP.asking && hass && hass.callWS) {
      EP.asking = true;
      Promise.all([
        hass.callWS({ type: 'energy/get_prefs' }),
        hass.callWS({ type: 'energy/info' }).catch(function () { return {}; })
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
  function model(hass, card) {
    var P = plan(), pr = prefs(hass, card);
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
  function series(hass, card, M) {
    var S = window.hkStats;
    if (!S || !M || !M.ids.length) return null;
    if (hass) EP.ws = S.weekStart(hass);
    var h = S.hourly(hass, M.ids, HOURS, card), d = S.daily(hass, M.ids, daysFor(period(), EP.back), card);
    return h && d ? { h: h, d: d } : null;
  }
  // EACH DAY'S RUNTIME of the devices that have one (hk-stats dailyPeak: the
  // day's highest reading of a counter that resets at midnight). Not waited
  // on: the page draws without it and adds it when it lands.
  function runtimes(hass, card, M) {
    var S = window.hkStats;
    if (!S || !S.dailyPeak || !M || !M.runtimes.length) return null;
    return S.dailyPeak(hass, M.runtimes, daysFor(period(), EP.back), card);
  }
  // hours as "1h 55m"
  function hm(h) {
    var m = Math.round((h || 0) * 60);
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
  }
  // THE LAST THREE HOURS OF EVERY POWER SENSOR ON THE PAGE, in one call
  function live(hass, card, M) {
    var S = window.hkStats;
    if (!S || !S.fiveMinute || !M || !M.powers.length) return null;
    return S.fiveMinute(hass, M.powers, FIVES, card);
  }
  function wattsNow(hass, id) {
    var C = window.hkChart;
    if (!C || !hass || !id) return null;
    return C.power(hass.states, id, { watts: true, fallback: null });
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
  function summary(hass, waker, now) {
    var S = window.hkStats, M = model(hass, waker);
    if (!S || !M || !hass) return null;
    var ids = houseIds(M);
    if (!ids.length) return null;
    var h = S.hourly(hass, ids, HOURS, waker), d = S.daily(hass, ids, DAYS, waker);
    var F = S.fiveMinute(hass, ids, OPEN_FIVES, waker, { type: 'change' });
    if (!h || !d) return null;
    var D = { h: h, d: d };
    now = now || Date.now();
    var T = calc(M, D, 'day', now), Mo = calc(M, D, 'month', now, null, { back: 0, ws: S.weekStart(hass) });
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
    var unit = function (k) { return k === 'cost' ? '' : k === 'water' || k === 'gas' ? unitOf(hass, M.src[k].ids[0]) : 'kWh'; };
    var rings = want.filter(function (k) { return all[k]; }).slice(0, 4).map(function (k) {
      return { key: k, name: RING_NAME[k], c: RING[k], v: today[k], typ: typ[k], tick: share[k], unit: unit(k) };
    });
    var devIds = M.devs.filter(function (d) { return d.counted && d.stat; }).map(function (d) { return d.stat; });
    var dh = S.hourly(hass, devIds, HOURS, waker), dd = S.daily(hass, devIds, DAYS, waker);
    var df = S.fiveMinute(hass, devIds, OPEN_FIVES, waker, { type: 'change' });
    var cause = dh && dd ? contributor(M, { h: Object.assign({}, h, dh), d: Object.assign({}, d, dd) }, df, T, o.upTo, today.energy - typ.energy * eBy[0]) : null;
    var receiptTimes = S.freshness ? [S.freshness(h), S.freshness(d), F && S.freshness(F)].filter(Boolean) : [];
    var receivedAt = receiptTimes.length ? Math.min.apply(null, receiptTimes) : null;
    var mo = { energy: Mo.home + o.home, cost: Mo.cost + o.cost, water: Mo.water + o.water, gas: Mo.gas + o.gas, solar: Mo.solar + o.solar };
    var bat = M.house && hass.states[M.house.entity], bl = bat ? Number(bat.state) : NaN;
    return {
      asOf: o.upTo, receivedAt: receivedAt, hasFives: !!F, contributor: cause, today0: T.today0, rings: rings, typ: typ, today: today, usualByNow: typ.energy * eBy[0],
      yday: eBy[1], month: mo, monthName: MONTHS[S.fields(Mo.start).month - 1],
      // where the month's cost is heading: so far, and a usual day for each day left
      projCost: M.hasCost && Mo.cur ? mo.cost + T.typ.cost * Math.max(0, Mo.n - Mo.whole - eBy[0]) : null,
      hasCost: M.hasCost, power: wattsNow(hass, M.total.power), battery: isFinite(bl) ? bl : null,
      money: function (v, dd) { var C = window.hkCards; return C && C.money ? C.money(hass, v, dd) : '$' + fx(v, dd); }
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
  var CHEV_L = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  var CHEV_R = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
  // ---- what stood out, in words
  var GLY = {
    clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/>',
    batt: '<rect x="3" y="7" width="16" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5.5" y="9.5" width="8" height="5" rx="1" fill="currentColor"/><rect x="20" y="10" width="2" height="4" rx="1" fill="currentColor"/>',
    car: '<path d="M5 16v2M19 16v2M4 13l2-5h12l2 5v3H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    coin: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.4.8-2.4 1.8 0 2.6 5 1.4 5 4 0 1-1.1 1.8-2.6 1.8-1.2 0-2.2-.5-2.7-1.3M12 6.5v11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    sun: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  };
  // ---- the period in words: "this week", "last week", "the week of
  // Sep 27", "in August"; its title, "Last Week", "Week of Sep 27", "August";
  // and its dates, "Oct 11 – 17", "Sep 27 – Oct 3", "Oct 1 – 31"
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dateShort(t, tz) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz }); }
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
  function hourName(t, tz) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: tz }); }
  function dayName(t, tz) { return new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz }); }

  function highlights(M, R, hass, money) {
    var out = [], tz = window.hkStats && window.hkStats.tz(), when = whenOf(R.per, R);
    if (R.per === 'now') {
      var T = M.total, wNow = wattsNow(hass, T.power);
      var live = M.devs.filter(function (d) { return d.counted && d.power; })
        .map(function (d) { return { d: d, w: Math.max(0, wattsNow(hass, d.power) || 0) }; })
        .sort(function (a, b) { return b.w - a.w; });
      var top3 = live.slice(0, 3).filter(function (r) { return r.w >= 5; });
      if (top3.length && wNow > 0) {
        out.push({ more: T.power, ic: GLY.bolt, c: '#ff9f0a', t: '<b>' + top3.map(function (r) { return esc(r.d.name); }).join(', ') +
          '</b> ' + (top3.length > 1 ? 'are' : 'is') + ' drawing ' + fx(Math.min(100, 100 * sum(top3.map(function (r) { return r.w; })) / wNow), 0) + '% of it.' });
      }
      var run = live.filter(function (r) { return r.w >= 1000; })[0];
      if (run) out.push({ more: run.d.power || run.d.stat, ic: GLY.up, c: '#5ac8fa', t: '<b>' + esc(run.d.name) + ' is running</b> at ' + watts(run.w).join(' ') + '.' });
      var hb = M.house, hs = hb && hass.states[hb.entity];
      if (hs && isFinite(Number(hs.state))) {
        var ls = hb.label && hass.states[hb.label];
        out.push({ more: hb.entity, ic: GLY.batt, c: '#30d158', t: '<b>The house battery is at ' + Math.round(Number(hs.state)) + '%</b>' +
          (ls && isFinite(Number(ls.state)) ? ', ' + fx(Number(ls.state), 1) + ' kWh stored.' : '.') });
      }
      var cars = M.batts.filter(function (b) { return !b.house; }).map(function (b) {
        var s = hass.states[b.entity], l = b.label && hass.states[b.label];
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

  // ====================================================== THE CARDS' PLATE
  var EP_CSS = [
    // THE PAGE CARD (hk-base.js pageCardCss): the plate and padding, the one
    // title row, the figure, the label -- shared with the page headers
    // (hk-headers.js), so the two pages' cards cannot drift apart
    window.hkCards.pageCardCss('ep'),
    '.tlab{display:flex;justify-content:space-between;margin-top:6px;font-size:12px;font-weight:600;line-height:1;',
    '  color:' + window.hkCards.v('ink-3') + ';font-variant-numeric:tabular-nums}',
    '.dim{opacity:0.28}',
    // A DAY STILL TO COME: its label quieter (its bar is last period's, in gray)
    '.bl span.fut,.bl span.fut b{color:' + window.hkCards.v('ink-3') + '}',
    // A TAP ON ANYTHING ABOUT ONE THING opens its sheet (data-more)
    '[data-more]{cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '[data-more]:active{opacity:0.7}',
    'svg{display:block}',
    // THE GRAPHS BUILD when a tab is first drawn (the card's `anim` class, a
    // second long): transform, opacity and clip only, so the compositor does
    // the work and nothing is laid out again. Never on a live update.
    '@keyframes hkGrow{from{transform:scale(0.001)}}',
    '@keyframes hkRise{from{transform:scaleY(0.001)}}',
    '@keyframes hkPop{from{transform:scale(0.6);opacity:0}}',
    '@keyframes hkWipe{from{clip-path:inset(0 100% 0 0)}}',
    // the bar GROWS from the left: its leading edge rounded like its end,
    // over a second, steadily rather than all at once
    '@keyframes hkGrowBar{from{clip-path:inset(0 100% 0 0 round 8px)}to{clip-path:inset(0 0 0 0 round 8px)}}',
    '.anim .bar.gwipe{animation:hkGrowBar 1.1s cubic-bezier(.22,.8,.25,1) backwards}',
    '.anim .gw{animation:hkGrow .55s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 14ms);',
    '  transform-box:view-box;transform-origin:150px 150px}',
    '.anim .gr2{animation:hkRise .6s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 45ms);',
    '  transform-box:fill-box;transform-origin:50% 100%}',
    '.anim .gp{animation:hkPop .4s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 16ms)}',
    '.anim .gwipe{animation:hkWipe .7s cubic-bezier(.22,.8,.25,1) backwards}',
    '.anim .dots i{animation:hkRise .5s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 18ms);transform-origin:50% 100%}',
    '@media (prefers-reduced-motion: reduce){.anim *{animation:none !important}}',
    // HOVER, TOUCH OR KEYS ON A GRAPH (hkCards.scrub, 2026-10-16): the bar
    // under the pointer or finger lit, the rest back, its figure said in the
    // card's title row; the chart takes focus and the arrow keys step it
    '.bc,.clock,.trace{touch-action:pan-y;-webkit-user-select:none;user-select:none}',
    '.bc [data-i],.clock [data-i]{transition:opacity ' + window.hkCards.DUR.press + ' ease}',
    '.on [data-i]:not(.hit){opacity:.35}',
    '.bc:focus-visible,.clock:focus-visible,.trace:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:4px;border-radius:' + window.hkCards.R.small + 'px}',
    '.trace .cur{stroke:' + window.hkCards.v('ink') + ';stroke-width:1.5;opacity:0}',
    '.trace.on .cur{opacity:.8}',
    '@media (prefers-reduced-motion: reduce){.bc [data-i],.clock [data-i]{transition:none}}'
  ].join('');

  // WHAT A SLOT IS, for a graph's readout: "9 AM" on the day's hours,
  // "Tue, Oct 14" on a week's or month's days (bar k of the tab)
  function slotName(p, R, k, tz) {
    if (p === 'now' || p === 'day') {
      var t0 = R.hToday.length ? +R.ax.h[R.hToday[0]].t : 0;
      return hourName(t0 + k * 36e5, tz);
    }
    return R.dates[k] != null ? new Date(R.dates[k]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }) : '';
  }

  // A TAP ON ANYTHING MARKED data-more="<entity>" opens that entity's sheet
  // (hass-more-info, which HK's detail sheets answer): one listener per card
  function bindMore(card, el) {
    if (!el || el._hkMore) return;
    el._hkMore = true;
    el.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-more]') : null;
      var id = t && t.getAttribute('data-more');
      if (!id) return;
      e.stopPropagation();
      card.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: id } }));
    });
  }
  function moreAttr(id) { return id ? ' data-more="' + esc(id) + '"' : ''; }
  // THE SHARED SHELL: joins the page, gates renders on what it draws from,
  // and hands each card the model, the statistics and the sums
  class HkEnergyBase extends HkBase {
    // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)
    static get FLAT_MOTION() { return true; }
    static get CSS() { return EP_CSS + (this.PART_CSS || ''); }
    getCardSize() { return 6; }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      EP.cards.add(this);
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      EP.cards.delete(this);
    }
    // the tab, the lit section, HA's settings arriving, and -- on Now --
    // every power sensor the card reads
    _sigOf() {
      var h = this._hass;
      if (!h) return null;
      var sig = period() + '|' + (EP.back || 0) + '|' + EP.pick + '|' + EP.ver + '|' + (plan() ? 'p' : '-');
      // NOW MOVES WITH THE HOUSE, BUT NOT 12 TIMES A SECOND: a Now card
      // follows its sensors at most every five seconds (a circuit's watts
      // change on nearly every push; nobody reads them that fast)
      if (period() === 'now') sig += '|' + Math.floor(Date.now() / 5e3);
      return sig;
    }
    _money(v, d) {
      var C = window.hkCards;
      return C && C.money ? C.money(this._hass, v, d) : '$' + fx(v, d);
    }
    _shell(cls) {
      if (this._built) return;
      this._root.innerHTML = '<ha-card class="ep ' + cls + '" data-hk-role="card"></ha-card>';
      this._card = this._root.querySelector('ha-card');
      var hgt = this._config && this._config.height;
      if (hgt) this._card.style.setProperty('--hk-ep-h', String(hgt));
      bindMore(this, this._card);
      this._built = true;
    }
    // model + statistics + sums, or a reason to wait
    _data() {
      var M = model(this._hass, this);
      if (!M) return { wait: true };
      var D = series(this._hass, this, M);
      if (!D) return { M: M, wait: true };
      var R = calcFor(M, D, period(), runtimes(this._hass, this, M));
      return R ? { M: M, D: D, R: R } : { M: M, wait: true };
    }
    // A GRAPH THAT READS OUT (hkCards.scrub): `tips[i]` is what bar i says;
    // the line it says it in is the title row's right-hand text unless
    // `o.readout` names another, and that text comes back after
    _scrubs(box, tips, o) {
      if (!box) return;
      o = o || {};
      var self = this, rd = o.readout || function () { return self._card && self._card.querySelector('.ttl span'); };
      var rest = o.rest != null ? o.rest : (rd() ? rd().innerHTML : '');
      window.hkCards.scrub(this, box, { count: tips.length, nowI: o.nowI, rest: rest, name: o.name || 'Graph', readout: rd, index: o.index,
        onPick: o.onPick, say: function (i) { return tips[i] || ''; } });
    }
    // draw again once the card has a width (the bars are sized to it)
    _later() {
      var self = this;
      if (this._laterAsked) return;
      this._laterAsked = true;
      requestAnimationFrame(function () { self._laterAsked = false; if (self._card && self._card.clientWidth) self.redraw(); });
    }
    _paint(html) {
      window.hkCards.morph(this._card, html);
      // a tab drawn for the first time builds; every redraw after it does not
      var p = period() + '|' + (EP.back || 0);
      if (this._animTab !== p && !/class="wait"/.test(html)) {
        this._animTab = p;
        var card = this._card;
        restartAnim(card, 'anim');
        clearTimeout(this._animT);
        this._animT = setTimeout(function () { card.classList.remove('anim'); }, 1500);
      }
    }
  }

  // ------------------------------------------------------------ the tabs
  class HkEnergyPeriodCard extends HkEnergyBase {
    static get PART_CSS() {
      return [
        // THE TABS FLOAT: they stay at the top while the page scrolls under
        // them, and once they do, a frosted strip keeps them readable over
        // the cards (no strip while they sit in their place)
        // ...clear of an iPhone's status bar and Dynamic Island (2026-10-13:
        // floating, they sat under the clock and could not be tapped), as the
        // tab bar at the top does (hk-tabbar.js TOP_CSS)
        ':host{position:sticky;top:max(var(--hk-energy-sticky-top,10px), calc(env(safe-area-inset-top, 0px) + 4px));z-index:4;display:block}',
        // ON THE PAGE'S EDGES, as the cards under it (they are in a grid that
        // gives each 4 px a side; this sits in the page's column, where a grid
        // would end its sticking): DESIGN.md "Page edges"
        'ha-card.ep{margin-left:4px;margin-right:4px;width:auto}',
        'ha-card.ep.period{height:auto;background:none;border:1px solid transparent;box-shadow:none;padding:0 4px;',
        '  flex-direction:row;align-items:center;gap:12px;min-height:36px;overflow:visible;flex-wrap:wrap;',
        '  border-radius:24px;transition:background-color .25s ease,padding .25s ease,box-shadow .25s ease,border-color .25s ease}',
        // the look's floating plate where it has one (Tinted: no blur, the
        // menu's and tab bar's near-opaque plate), else a frosted strip
        ':host([data-stuck]) ha-card.ep.period{padding:6px 6px 6px 16px;background:' + window.hkCards.v('float-plate') + ';',
        '  -webkit-backdrop-filter:var(--hk-float-backdrop,blur(24px) saturate(1.6));backdrop-filter:var(--hk-float-backdrop,blur(24px) saturate(1.6));',
        '  border-color:rgba(255,255,255,0.12);box-shadow:0 8px 24px rgba(0,0,0,0.28)}',
        ':host([data-stuck]) .pt{text-shadow:none}',
        '.pt{font-size:22px;font-weight:700;letter-spacing:-0.35px;line-height:1.1;white-space:nowrap;',
        '  text-shadow:' + window.hkCards.v('glow') + '}',
        '.ps{font-size:15px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
        // ‹ › THROUGH THE WEEKS OR MONTHS: the calendar's own round glass
        // buttons (hk-calendar.js .rb); the tab itself brings you back
        '.nav{display:flex;gap:8px}',
        '.nav[hidden]{display:none}',
        '.nav button{appearance:none;width:44px;height:44px;border-radius:22px;border:' + window.hkCards.M.border + ';' + window.hkCards.M.glass + ';',
        '  display:flex;align-items:center;justify-content:center;padding:0;margin:0;color:' + window.hkCards.v('ink') + ';cursor:pointer;',
        '  -webkit-tap-highlight-color:transparent;transition:opacity .2s ease}',
        '.nav button:disabled{opacity:0.35;cursor:default}',
        // HK's segmented control: the calendar's own (hk-base.js segCss)
        window.hkCards.segCss('.seg', { raised: true }),
        '.seg .live{width:7px;height:7px;border-radius:50%;background:#30d158;box-shadow:0 0 0 3px rgba(48,209,88,0.25)}',
        '@media (max-width:' + window.hkCards.BP.phone + 'px){.seg{width:100%}.seg button{flex:1;min-width:0;padding:0 6px}.seg .pfx{display:none}.ps{flex:1 1 auto}',
        // floating on a phone: just the tabs, so the strip takes one row
        '  :host([data-stuck]) .pt,:host([data-stuck]) .ps,:host([data-stuck]) .nav{display:none}:host([data-stuck]) ha-card.ep.period{padding:5px}}'
      ].join('');
    }
    getCardSize() { return 1; }
    // NO PLATE, so nothing for the shared blur to frost behind it
    setConfig(config) { super.setConfig(Object.assign({ glass: false }, config || {})); }
    // FLOATING OR IN ITS PLACE: watched on scroll (any scroller: the window
    // on a phone, the view elsewhere), at most once a frame
    connectedCallback() {
      super.connectedCallback();
      var self = this;
      if (!this._onScroll) {
        this._onScroll = function () {
          if (self._scrollQ) return;
          self._scrollQ = requestAnimationFrame(function () {
            self._scrollQ = 0;
            var top = parseFloat(getComputedStyle(self).top) || 0, r = self.getBoundingClientRect();
            var stuck = r.top <= top + 0.5 && (window.scrollY > 0 || r.top < self._homeTop - 1);
            if (self._homeTop == null || (!stuck && r.top > top + 0.5)) self._homeTop = r.top;
            self.toggleAttribute('data-stuck', !!stuck);
          });
        };
      }
      window.addEventListener('scroll', this._onScroll, { passive: true, capture: true });
      this._onScroll();
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      window.removeEventListener('scroll', this._onScroll, { capture: true });
    }
    _sigOf() { return period() + '|' + (EP.back || 0) + '|' + EP.ver + '|' + Math.floor(Date.now() / 60e3); }
    _render() {
      var self = this, S = window.hkStats;
      if (S && this._hass) EP.ws = S.weekStart(this._hass);
      // this card's own Opens On, before anything has chosen a tab
      if (!EP.period && this._config && PERIODS.indexOf(this._config.opens_on) >= 0) EP.period = this._config.opens_on;
      if (!this._built) {
        this._shell('period');
        this._card.innerHTML = '<div class="pt"></div><div class="ps"></div>' +
          '<div class="nav" hidden><button data-n="1">' + CHEV_L + '</button><button data-n="-1">' + CHEV_R + '</button></div>' +
          '<div class="seg" role="tablist" aria-label="Period">' +
          PERIODS.map(function (p) {
            return '<button role="tab" data-p="' + p + '">' + (p === 'now' ? '<i class="live"></i>' : '') +
              (p === 'week' || p === 'month' ? '<span class="pfx">This </span>' + (p === 'week' ? 'Week' : 'Month') : TAB_NAMES[p]) + '</button>';
          }).join('') + '</div>';
        this._card.querySelectorAll('.nav button').forEach(function (b) {
          b.addEventListener('click', function (e) {
            e.stopPropagation();
            if (b.disabled) return;
            setBack((EP.back || 0) + Number(b.getAttribute('data-n')));
          });
        });
        this._card.querySelectorAll('.seg button').forEach(function (b) {
          b.addEventListener('click', function (e) {
            e.stopPropagation();
            var was = self._card.querySelector('.seg button[aria-selected="true"]'), from = window.hkCards.segBox(was);
            setPeriod(b.getAttribute('data-p'));
            self.redraw();
            if (was !== b) window.hkCards.slideSeg(b, from);
          });
        });
      }
      var p = period(), tz = S && S.tz(), now = new Date(), cal = (p === 'week' || p === 'month') && S, back = cal ? (EP.back || 0) : 0;
      var P = cal ? S.period(p, back, +now, EP.ws || 0) : null;
      var sub = p === 'now' ? 'Live · ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
        : p === 'day' ? now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })
        : P ? rangeText(P.start, P.len, tz) : '';
      this._card.querySelector('.pt').textContent = P ? titleOf(p, back, P.start, tz) : TAB_NAMES[p];
      this._card.querySelector('.ps').textContent = sub;
      // the arrows: back as far as the statistics go (and half a year of
      // weeks, a year of months), forward as far as this week or month
      var nav = this._card.querySelector('.nav'), x = cal ? this._data() : null, R = x && x.R;
      nav.hidden = !cal;
      if (cal) {
        var pv = nav.children[0], nx = nav.children[1], word = p === 'week' ? 'week' : 'month';
        pv.disabled = back >= MAX_BACK[p] || !!(R && R.prev && !R.prev.has);
        nx.disabled = back === 0;
        pv.setAttribute('aria-label', 'Previous ' + word);
        nx.setAttribute('aria-label', 'Next ' + word);
      }
      this._card.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-selected', b.getAttribute('data-p') === p ? 'true' : 'false');
      });
    }
  }

  // ------------------------------------------------- the hero: now, or rings
  // `tick`: a week or month still going marks on each ring where a usual
  // one would be by now (the days gone of its length) -- past it is above usual
  function ringSvg(list, more, tick) {
    var w = list.length > 3 ? 18 : 22, step = w + 4, r0 = 96, out = '', ticks = '';
    list.forEach(function (x, i) {
      var r = r0 - i * step, c = 2 * Math.PI * r, f = Math.max(0, Math.min(x.f, 1)), over = Math.max(0, Math.min(x.f - 1, 1));
      out += '<circle cx="110" cy="110" r="' + r + '" fill="none" stroke="' + x.c + '" stroke-opacity=".18" stroke-width="' + w + '"/>';
      // every arc is always drawn (an empty one is a zero-length dash), so
      // the same element is there to animate from one value to the next
      out += '<circle class="arc" data-k="' + x.key + '" data-c="' + c.toFixed(1) + '" data-len="' + (c * f).toFixed(1) +
        '" cx="110" cy="110" r="' + r + '" fill="none" stroke="' + x.c + '" stroke-width="' + w +
        '" stroke-linecap="round" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 110 110)"' +
        (f > 0.001 ? '' : ' stroke-opacity="0"') + '/>';
      // PAST A FULL RING, a second lap over the first, its end cap shadowed
      // so the overlap reads (the Activity rings' own)
      out += '<circle class="arc lap" data-k="' + x.key + '-lap" data-c="' + c.toFixed(1) + '" data-len="' + (c * over).toFixed(1) +
        '" cx="110" cy="110" r="' + r + '" fill="none" stroke="' + x.c + '" stroke-width="' + w +
        '" stroke-linecap="round" stroke-dasharray="' + (c * over).toFixed(1) + ' ' + c.toFixed(1) +
        '" transform="rotate(-90 110 110)" style="filter:drop-shadow(0 0 4px rgba(0,0,0,.6))"' + (over > 0.001 ? '' : ' stroke-opacity="0"') + '/>';
      // a white dot on the ring itself (a line across all of them reads as a
      // clock's hand); each ring its own (x.tick) where its usual day differs
      var tk = x.tick != null ? x.tick : tick;
      if (tk > 0 && tk < 1) {
        var a = (tk * 360 - 90) * Math.PI / 180;
        ticks += '<circle class="tick" cx="' + (110 + r * Math.cos(a)).toFixed(1) + '" cy="' + (110 + r * Math.sin(a)).toFixed(1) + '" r="' + (w * 0.2).toFixed(1) + '"/>';
      }
    });
    return '<svg class="rings" viewBox="0 0 220 220" role="img" aria-label="Rings against a usual ' + (tick > 0 ? 'period, marked where it would be by now' : 'day') + '"' +
      moreAttr(more) + '>' + out + ticks + '</svg>';
  }
  // A LINE THROUGH VALUES as an area, `w` x `h`; nulls (an open bucket, a
  // gap) are skipped rather than drawn as zero
  function lineSvg(vals, w, h, color, o) {
    o = o || {};
    var pts = [], mx = o.min || 0.01;
    vals.forEach(function (x) { if (typeof x === 'number' && isFinite(x) && x > mx) mx = x; });
    var n = Math.max(1, vals.length - 1);
    vals.forEach(function (x, i) {
      if (typeof x !== 'number' || !isFinite(x)) return;
      pts.push([i * w / n, h - 2 - (h - 4) * Math.max(0, x) / mx]);
    });
    if (pts.length < 2) return '<path d="M0 ' + (h - 2) + 'H' + w + '" stroke="' + window.hkCards.v('line-strong') + '" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var last = pts[pts.length - 1];
    return '<path d="' + d + ' L' + last[0].toFixed(1) + ' ' + h + ' L' + pts[0][0].toFixed(1) + ' ' + h + ' Z" fill="' + rgba(color, o.fill || 0.2) + '"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (o.sw || 2) + '" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      (o.dot === false ? '' : '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3" fill="' + color + '"/>');
  }
  function timeLabels(now, hours, tz) {
    var out = [];
    for (var i = 0; i <= 3; i++) {
      out.push(i === 3 ? 'Now' : new Date(now - (3 - i) * hours / 3 * HOUR).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }));
    }
    return '<div class="tlab">' + out.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>';
  }
  function readingOf(card, M, R, t) {
    var h = card._hass;
    if (t.kind === 'cost') return { k: 'Today’s Cost', v: R ? card._money(R.cost, 2) : '—' };
    var s = t.entity && h.states[t.entity];
    if (!s) return null;
    if (t.kind === 'climate') {
      var ct = (s.attributes || {}).current_temperature;
      return { k: t.name, v: ct != null && isFinite(Number(ct)) ? Math.round(Number(ct)) + '°' : '—' };
    }
    var n = Number(s.state), u = (s.attributes || {}).unit_of_measurement || '';
    if (t.kind === 'temp') return { k: t.name, v: isFinite(n) ? Math.round(n) + '°' : '—' };
    return { k: t.name, v: isFinite(n) ? fx(n, Math.abs(n) >= 100 ? 0 : 1) + (u ? '<u>' + esc(u) + '</u>' : '') : esc(s.state) };
  }
  function ringsOf(M, R) {
    var all = { energy: true, cost: M.hasCost, solar: M.src.solar.length > 0, water: M.src.water.ids.length > 0, gas: M.src.gas.ids.length > 0 };
    var want = Array.isArray(M.rings) && M.rings.length ? M.rings : ['energy', 'cost', 'solar', 'water', 'gas'];
    return want.filter(function (k) { return all[k]; }).slice(0, 4).map(function (k) {
      var val = k === 'energy' ? R.home : k === 'cost' ? R.cost : R[k], typ = (k === 'energy' ? R.typ.home : R.typ[k]) * R.n;
      return { key: k, c: RING[k], v: val, typ: typ, f: typ > 0 ? val / typ : 0 };
    });
  }
  class HkEnergyHeroCard extends HkEnergyBase {
    static get PART_CSS() {
      return [
        'ha-card.ep.hero{--hk-ep-h:320px}',
        '.rh{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:center;height:100%}',
        '.rings{width:200px;height:200px}',
        '.rings .tick{fill:#fff;filter:drop-shadow(0 0 2px rgba(0,0,0,.55))}',
        '.lede{font-size:21px;font-weight:600;line-height:1.3;letter-spacing:-0.3px}',
        '.lede em{font-style:normal;color:' + RING.energy + '}',
        '.stats{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:16px;margin-top:18px}',
        // EACH FIGURE FITS ITS THIRD (2026-10-16, the user: "1,112$161.49068"
        // at 1100 px): the column is its own container and the figure at most
        // 22 % of it -- 30 px from a 136 px column, smaller below; and a
        // card under 700 px draws the rings at 150, giving the figures the room
        '.stat{min-width:0;container-type:inline-size}',
        '.stat .big{margin-top:7px;font-size:min(30px,22cqw);white-space:nowrap}',
        // (its unit half the figure: 15 px at 30, as everywhere, and with it as it shrinks)
        '.stat .big u{font-size:0.5em}',
        '@container (max-width:' + window.hkCards.BP.cardList + 'px){.rh{grid-template-columns:150px minmax(0,1fr);gap:20px}.rings{width:150px;height:150px}.stats{gap:12px}}',
        '.of{font-size:14px;line-height:18px;margin-top:3px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.nowv{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:10px;flex:none}',
        '.nowv .big{font-size:44px;font-weight:600;letter-spacing:-1.5px;line-height:1}',  // hkCards.TYPE hero
        '.nowv .big u{font-size:20px;margin-left:4px}',
        '.nowv .cap{text-align:right;padding-bottom:2px}',
        '.trace{width:100%;flex:1;min-height:60px;margin-top:14px}',
        '.reads{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-top:16px;padding-top:16px;',
        '  border-top:1px solid ' + window.hkCards.v('line') + ';flex:none}',
        '.reads .big{font-size:24px;margin-top:7px}',
        // THE WHOLE ROW WIDE (no highlights beside it): a third of it more --
        // what is drawing most on Now, the period before on the others
        '.hw{display:flex;gap:26px;height:100%;min-height:0}',
        '.hw>.hm{flex:1;display:flex;flex-direction:column;min-width:0}',
        '.wide{display:none;width:300px;flex:none;flex-direction:column;justify-content:center;gap:12px;',
        '  border-left:1px solid ' + window.hkCards.v('line') + ';padding-left:24px}',
        '@container (min-width:' + window.hkCards.BP.cardHero + 'px){.wide{display:flex}}',
        '.wide .mh{font-size:13px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;color:' + window.hkCards.v('ink-2') + '}',
        '.mr{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;row-gap:5px;align-items:baseline}',
        '.mr b{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.mr span{font-size:13px;color:' + window.hkCards.v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
        '.mr i{grid-column:1/-1;display:block;height:6px;border-radius:3px;background:' + window.hkCards.v('key') + ';overflow:hidden}',
        '.mr i em{display:block;height:100%;border-radius:3px}',
        '.cmp .big{font-size:22px;margin-top:5px}',
        '@media (max-width:' + window.hkCards.BP.phone + 'px){ha-card.ep.hero{--hk-ep-h:450px}.rh{grid-template-columns:1fr;justify-items:center;gap:20px}',
        '  .rh>div{width:100%}.rings{width:180px;height:180px}.stats{gap:10px}.stat .big{font-size:24px}.of{white-space:normal}',
        '  .reads{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:14px}.nowv .big{font-size:40px}}'
      ].join('');
    }
    _render() {
      this._shell('hero');
      var x = this._data(), p = period();
      if (x.wait) return this._paint('<div class="wait">Loading…</div>');
      var M = x.M, R = x.R, h = this._hass, tz = window.hkStats && window.hkStats.tz();
      if (p === 'now') {
        this._ringTab = 'now';               // the rings sweep in again on the way back
        var T = M.total, w = wattsNow(h, T.power), five = live(h, this, M), html;
        var reads = (M.P.top || []).map(function (t, i) {
          var r = readingOf(this, M, R, t);
          if (r) r.i = i;
          return r;
        }, this).filter(Boolean).slice(0, 4);
        var readsHtml = reads.length ? '<div class="reads">' + reads.map(function (r) {
          return '<div class="stat" data-r="' + r.i + '"><div class="k">' + esc(r.k) + '</div><div class="big num">' + r.v + '</div></div>';
        }).join('') + '</div>' : '';
        if (w != null) {
          var tr = five && five[T.power] ? five[T.power].map(function (p2) { return p2.v; }) : [];
          var trT = five && five[T.power] ? five[T.power].map(function (p2) { return +p2.t; }) : [];
          var got = tr.filter(function (z) { return typeof z === 'number'; }), avg = got.length ? sum(got) / got.length : null;
          var wv = watts(w);
          html = '<div class="ttl"><b>Using Now</b><span>' + esc(T.name || 'Whole Home') + ' · the last 3 hours</span></div>' +
            '<div class="nowv"' + moreAttr(T.power) + '><div class="big num">' + wv[0] + '<u>' + wv[1] + '</u></div><div class="cap">' +
            (avg != null ? (w > avg * 1.3 ? 'Above' : w < avg * 0.7 ? 'Below' : 'About') + ' its last-3-hour average of ' + watts(avg).join(' ') + '<br>' : '') +
            kwh(R.home) + ' kWh so far today</div></div>' +
            '<svg class="trace gwipe"' + moreAttr(T.power) + ' viewBox="0 0 1000 150" preserveAspectRatio="none">' + lineSvg(tr, 1000, 150, RING.energy, { fill: 0.22, sw: 2.5 }) +
            '<line class="cur" x1="0" x2="0" y1="0" y2="150" vector-effect="non-scaling-stroke"/></svg>' +
            timeLabels(Date.now(), 3, tz) + readsHtml;
        } else {
          // NO WHOLE-HOME POWER SENSOR: today so far, by hour
          var hrs = R.hToday.map(function (i) { return homeAt(M, x.D.h, i); });
          html = '<div class="ttl"><b>Today So Far</b><span>by hour</span></div>' +
            '<div class="nowv"' + moreAttr(T.stat) + '><div class="big num">' + kwh(R.home) + '<u>kWh</u></div><div class="cap">No live reading for the whole home</div></div>' +
            '<svg class="trace" viewBox="0 0 1000 150" preserveAspectRatio="none">' + lineSvg(hrs, 1000, 150, RING.energy, { fill: 0.22, sw: 2.5 }) + '</svg>' + readsHtml;
        }
        // drawing most, live, in their sections' colors
        var drawing = M.devs.filter(function (d) { return d.counted && d.power; })
          .map(function (d) { return { d: d, w: Math.max(0, wattsNow(h, d.power) || 0) }; })
          .filter(function (r) { return r.w >= 5; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 5);
        var dmax = drawing.length ? drawing[0].w : 1;
        var wide = drawing.length ? '<div class="wide"><div class="mh">Drawing Most</div>' + drawing.map(function (r) {
          return '<div class="mr"' + moreAttr(r.d.power || r.d.stat) + '><b>' + esc(r.d.name) + '</b><span>' + watts(r.w).join(' ') + '</span><i><em style="width:' +
            (100 * r.w / dmax).toFixed(1) + '%;background:' + r.d.sec.color + '"></em></i></div>';
        }).join('') + '</div>' : '';
        this._paint('<div class="hw"><div class="hm">' + html + '</div>' + wide + '</div>');
        this._bindReads(M);
        // THE LAST THREE HOURS READ OUT: each five minutes' watts, a line at it
        var trace = this._card.querySelector('svg.trace');
        if (trace && w != null && tr.length) {
          var cur = trace.querySelector('.cur'), n5 = tr.length;
          this._scrubs(trace, tr.map(function (z, i) {
            return new Date(trT[i] || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) + ' \u00b7 ' +
              (typeof z === 'number' && isFinite(z) ? watts(z).join(' ') : 'no reading yet');
          }), { nowI: n5 - 1, name: 'The last three hours',
            index: function (x, y, box) { var r = box.getBoundingClientRect(); return r.width ? Math.max(0, Math.min(n5 - 1, Math.round((x - r.left) / r.width * (n5 - 1)))) : -1; },
            onPick: function (i) { if (cur && i != null) { var X = (1000 * i / Math.max(1, n5 - 1)).toFixed(1); cur.setAttribute('x1', X); cur.setAttribute('x2', X); } } });
        }
        return;
      }
      var rings = ringsOf(M, R), when = whenOf(p, R), wk = p === 'week' ? 'week' : 'month';
      // AGAINST USUAL: today's projection against a usual day; a week or a
      // month so far against a usual one's pace to now (a whole one, once past)
      var base = R.typ.home * (p === 'day' ? 1 : R.days), got = p === 'day' ? R.proj : R.home;
      var vsT = base > 0 ? Math.round(100 * (got - base) / base) : 0;
      var near = Math.abs(vsT) < 6, cmp = near ? (p === 'day' ? 'about a typical day' : 'about usual')
        : Math.abs(vsT) + '% ' + (vsT < 0 ? 'below' : 'above') + (p === 'day' ? ' a typical day' : ' usual');
      var lede;
      if (p === 'day' || R.cur) {
        lede = (p === 'day' ? 'On pace for ' : 'Heading for ') + '<em>' + fx(R.proj, 0) + ' kWh</em> ' + when + ', ' + cmp +
          (M.hasCost ? ', about ' + this._money(R.projCost, p === 'day' ? 2 : 0) : '') + '.';
        // THE FIRST MORNING OF A WEEK OR MONTH has nothing to say about it
        // yet: what there is so far, and the last one
        if (p !== 'day' && R.whole === 0 && R.share < 0.5 && R.prev && R.prev.allHome > 0) {
          lede = 'The ' + wk + ' has just started: <em>' + kwh(R.home) + ' kWh</em> so far. ' +
            (p === 'week' ? 'Last week' : monthOf(R.prev.start)) + ' came to ' + fx(R.prev.allHome, 0) + ' kWh' +
            (M.hasCost ? ', about ' + this._money(R.prev.allCost, 0) : '') + '.';
        }
      } else if (!R.has) {
        lede = 'No history for ' + when.replace(/^in /, '') + '.';
      } else {
        lede = 'Used <em>' + fx(R.home, 0) + ' kWh</em> ' + when + ', ' + cmp + (M.hasCost ? ', ' + this._money(R.cost, 0) : '') + '.';
      }
      if (R.typ.home <= 0) lede = 'Learning your usual: there isn’t a day of history yet.';
      var self = this;
      var stats = rings.map(function (r) {
        var unit = r.key === 'cost' ? '' : r.key === 'water' || r.key === 'gas' ? esc(unitOf(h, M.src[r.key].ids[0])) : 'kWh';
        var val = r.key === 'cost' ? self._money(r.v, 2) : (r.key === 'water' || r.key === 'gas' ? fx(r.v, 0) : kwh(r.v));
        // a week's or a month's usual cost in whole dollars: "$344.89" does not fit a third of the card
        var typ = r.key === 'cost' ? self._money(r.typ, p === 'day' ? 2 : 0) : fx(r.typ, 0);
        var mid = r.key === 'energy' ? (M.total.stat || M.src.imp[0]) : r.key === 'cost' ? (M.src.cost[0] || M.total.cost) : r.key === 'solar' ? M.src.solar[0] : M.src[r.key].ids[0];
        return '<div class="stat"' + moreAttr(mid) + '><div class="k"><i style="background:' + r.c + '"></i>' + ({ energy: 'Energy', cost: 'Cost', solar: 'Solar', water: 'Water', gas: 'Gas' })[r.key] +
          '</div><div class="big num">' + val + (unit ? '<u>' + unit + '</u>' : '') + '</div><div class="of">of a typical ' + typ + '</div></div>';
      }).join('');
      // THE PERIOD BEFORE: yesterday by this time, last week, the 30 days before
      var D2 = x.D, ax = R.ax, nd = ax.d.length, prev = null;
      if (p === 'day') {
        var yH = R.hYday.map(function (i) { return homeAt(M, D2.h, i); }), yC = R.hYday.map(function (i) { return costAt(M, D2.h, i); });
        var yT = sum(yH), byNow = R.share;
        prev = { name: 'Yesterday by Now', home: yT * byNow, cost: sum(yC) * byNow, all: 'All of yesterday: ' + fx(yT, 1) + ' kWh' };
      } else if (R.prev && R.prev.has) {
        // the week or month before: as far into it as this one has gone, or whole
        var pname = R.cur ? (p === 'week' ? 'Last Week by Now' : 'Last Month by Now') : (p === 'week' ? 'The Week Before' : monthOf(R.prev.start));
        prev = { name: pname, word: R.cur ? 'last ' + wk + ' by now' : p === 'week' ? 'the week before' : monthOf(R.prev.start),
                 home: R.prev.home, cost: R.prev.cost,
                 all: R.prev.byNow ? 'All of ' + (p === 'week' ? 'last week' : monthOf(R.prev.start)) + ': ' + fx(R.prev.allHome, 0) + ' kWh' : '' };
      }
      var cmpHtml = '';
      if (prev) {
        var dpct = prev.home > 0 ? Math.round(100 * (R.home - prev.home) / prev.home) : 0;
        cmpHtml = '<div class="wide cmp"><div class="mh">Compared With</div>' +
          '<div><div class="k">' + esc(prev.name) + '</div><div class="big num">' + kwh(prev.home) + '<u>kWh</u></div>' +
          '<div class="of">' + (M.hasCost ? this._money(prev.cost, p === 'day' ? 2 : 0) + (prev.all ? ' \u00b7 ' : '') : '') + esc(prev.all) + '</div></div>' +
          '<div><div class="k">' + (p === 'day' ? 'Today So Far' : esc(titleOf(p, R.back, R.start, tz))) + '</div><div class="big num">' + (dpct > 0 ? '+' : '') + dpct + '<u>%</u></div>' +
          '<div class="of">' + (Math.abs(dpct) < 5 ? 'About the same' : (dpct > 0 ? 'More than ' : 'Less than ') + esc(prev.word || prev.name.toLowerCase())) + '</div></div></div>';
      }
      var tick = p !== 'day' && R.cur ? R.days / R.n : 0;
      this._paint('<div class="hw"><div class="hm"><div class="rh">' + ringSvg(rings, M.total.stat || M.src.imp[0], tick) + '<div><div class="lede">' + lede + '</div>' +
        '<div class="stats" style="--n:' + rings.length + '">' + stats + '</div></div></div></div>' + cmpHtml + '</div>');
      this._animateRings(p);
    }
    // A READING OPENS WHAT IT IS: Today's Cost the whole home's power, a
    // thermostat the screen's Climate page (`climate_path`) or its sheet,
    // anything else its sheet -- what the readings row's tiles did
    _bindReads(M) {
      var self = this, top = (M.P.top || []);
      this._card.querySelectorAll('.reads .stat').forEach(function (el) {
        if (el._hkBound) return;
        el._hkBound = true;
        el.style.cursor = 'pointer';
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          var t = top[Number(el.getAttribute('data-r'))] || {}, cfg = self._config || {};
          if (t.kind === 'climate' && cfg.climate_path) {
            self._act({ action: 'navigate', navigation_path: cfg.climate_path }, false);
            return;
          }
          var id = t.kind === 'cost' ? (M.total.power || M.total.stat) : t.entity;
          if (id) self.dispatchEvent(new CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: id } }));
        });
      });
    }
    // THE RINGS SWEEP IN, as the Activity rings do: from the top, clockwise,
    // all together, easing out over ~0.8 s, and a ring past full laps itself
    // after its first turn. On a new tab (or the first time) from nothing; on
    // an update while the tab is open, from where each was. Reduce Motion:
    // the finished rings.
    _animateRings(p) {
      this._ringWas = sweepRings(this._card, this._ringWas, this._ringTab !== p);
      this._ringTab = p;
    }
  }
  // (the hero's rings and the screensaver's: `was` each arc's length last
  // time, `fresh` from nothing; returns the lengths for next time)
  function sweepRings(root, was, fresh) {
    var arcs = root.querySelectorAll('circle.arc');
    was = was || {};
    var still = !arcs.length || !arcs[0].animate ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var D = window.hkCards && window.hkCards.DUR, E = window.hkCards && window.hkCards.EASE;
    var next = {}, SWEEP = (D && parseFloat(D.ring) * 1000) || 850, EASE = (E && E.build) || 'cubic-bezier(.22,.8,.25,1)';
    for (var i = 0; i < arcs.length; i++) {
      var a = arcs[i], k = a.getAttribute('data-k'), c = Number(a.getAttribute('data-c')), to = Number(a.getAttribute('data-len'));
      var lap = a.classList.contains('lap'), from = fresh ? 0 : (was[k] != null ? was[k] : to);
      next[k] = to;
      if (still || Math.abs(to - from) < 0.5) continue;
      // a lap starts when its ring has come round once; on an update, at once
      var delay = lap && fresh ? SWEEP * 0.85 : 0, dur = lap && fresh ? Math.max(250, SWEEP * 0.6 * to / c + 200) : (fresh ? SWEEP : 500);
      a.animate([{ strokeDasharray: from + ' ' + c, strokeOpacity: 1 }, { strokeDasharray: to + ' ' + c, strokeOpacity: 1 }],
                { duration: dur, delay: delay, easing: EASE, fill: 'backwards' });
    }
    return next;
  }
  function unitOf(hass, id) {
    var s = id && hass && hass.states[id];
    return (s && s.attributes && s.attributes.unit_of_measurement) || '';
  }

  // ------------------------------------------------------------ highlights
  class HkEnergyHighlightsCard extends HkEnergyBase {
    static get PART_CSS() {
      return [
        'ha-card.ep.hl{--hk-ep-h:320px;padding:6px 22px;display:grid;grid-template-rows:repeat(4,minmax(0,1fr))}',
        // THE TEXT CENTERED ON ITS ICON, however many lines (2026-10-13, the
        // user's call: centered on the first line, two lines read as pushed down)
        '.hli{display:grid;grid-template-columns:32px minmax(0,1fr);gap:12px;align-content:center;align-items:center;',
        '  border-top:1px solid ' + window.hkCards.v('line') + '}',
        '.hli:first-child{border-top:0}',
        '.hli .ic{width:32px;height:32px;border-radius:50%;display:grid;place-items:center}',
        '.hli .ic svg{width:18px;height:18px}',
        '.hli .tx{font-size:15px;font-weight:500;line-height:20px;color:' + window.hkCards.v('ink-2') + ';',
        '  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}',
        '.hli .tx b{color:' + window.hkCards.v('ink') + ';font-weight:600}',
        '@media (max-width:' + window.hkCards.BP.phone + 'px){ha-card.ep.hl{--hk-ep-h:380px}}'
      ].join('');
    }
    _render() {
      this._shell('hl');
      var x = this._data();
      if (x.wait) return this._paint('<div class="wait">Loading…</div>');
      var self = this, list = x.M.highlights ? highlights(x.M, x.R, this._hass, function (a, d) { return self._money(a, d); }) : [];
      this._paint(list.map(function (it) {
        return '<div class="hli"' + moreAttr(it.more) + (it.sec ? ' data-sec="' + esc(it.sec) + '"' : '') + '><div class="ic" style="background:' + rgba(it.c, 0.14) + ';color:' + it.c + '"><svg viewBox="0 0 24 24">' +
          it.ic + '</svg></div><div class="tx">' + it.t + '</div></div>';
      }).join(''));
      var self = this;
      this._card.querySelectorAll('[data-sec]').forEach(function (el) {
        if (el._hkSec) return;
        el._hkSec = true;
        el.style.cursor = 'pointer';
        el.addEventListener('click', function (e) { e.stopPropagation(); setPick(el.getAttribute('data-sec')); self.redraw(); });
      });
    }
  }

  // ------------------------------------------------------- where it went
  class HkEnergyWhereCard extends HkEnergyBase {
    static get PART_CSS() {
      return [
        // ITS HEIGHT FOLLOWS ITS KEY, which is the same on every tab (the
        // sections never change with it), so it still never shifts
        'ha-card.ep.where{height:auto;min-height:' + window.hkCards.TILE.tall + 'px}',
        '.bar{display:flex;height:24px;border-radius:8px;overflow:hidden;margin:14px 0 16px;gap:2px;background:' + window.hkCards.v('key') + ';flex:none}',
        '.bar i{display:block;height:100%;min-width:2px;cursor:pointer;transition:opacity .2s}',
        '.chips{display:flex;justify-content:space-between;gap:10px 18px;flex-wrap:wrap}',
        '.chip{display:grid;grid-template-columns:10px minmax(0,1fr);column-gap:8px;align-items:center;font-size:14px;font-weight:600;',
        '  line-height:18px;cursor:pointer;min-width:0;border:0;background:none;color:inherit;font-family:inherit;padding:0;text-align:left;',
        '  -webkit-tap-highlight-color:transparent;transition:opacity .2s}',
        '.chip i{width:10px;height:10px;border-radius:3px}',
        '.chip em{font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.chip span{grid-column:2;font-size:13px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
        '@container (max-width:1060px){.chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}}',
        '@container (max-width:520px){.chips{grid-template-columns:repeat(2,minmax(0,1fr))}.ttl span{display:none}}'
      ].join('');
    }
    _render() {
      this._shell('where');
      var x = this._data(), p = period(), self = this;
      if (x.wait) return this._paint('<div class="wait">Loading…</div>');
      var M = x.M, R = x.R, h = this._hass, rows, rest, total, fmt;
      if (p === 'now') {
        rows = M.devs.filter(function (d) { return d.counted && d.power; })
          .map(function (d) { return { d: d, v: Math.max(0, wattsNow(h, d.power) || 0) }; });
        var tw = wattsNow(h, M.total.power), on = sum(rows.map(function (r) { return r.v; }));
        rest = tw != null ? Math.max(0, tw - on) : 0;
        total = tw != null ? tw : on;
        fmt = function (z) { return watts(z).join(' '); };
      } else {
        rows = R.counted.map(function (r) { return { d: r.d, v: r.v }; });
        rest = R.untracked; total = R.home;
        fmt = function (z) { return kwh(z) + ' kWh'; };
      }
      var parts = [];
      M.sections.forEach(function (s) {
        rows.filter(function (r) { return r.d.sec === s && r.v > 0; }).sort(function (a, b) { return b.v - a.v; })
          .forEach(function (r, i) { parts.push({ s: s, v: r.v, n: r.d.name, a: i % 2 ? 0.72 : 1 }); });
      });
      var all = sum(parts.map(function (q) { return q.v; })) + rest || 1;
      var secs = M.sections.map(function (s) {
        return { s: s, v: sum(parts.filter(function (q) { return q.s === s; }).map(function (q) { return q.v; })) };
      }).filter(function (q) { return q.s.items.some(function (it) { return it.counted; }); });
      // A SECTION LOOKED AT (2026-10-16, the user: a tap re-drew the whole
      // page and, with a listener added on every paint, toggled itself back
      // off -- "not at all on month"): hover, focus or a tap lights it in
      // THIS card and says it in the title row; a second tap, or a tap
      // elsewhere on the card, lets it go. Nothing else on the page redraws.
      // (A section a highlight lit for the page, EP.pick, still shows.)
      var look = this._look && secs.some(function (q) { return q.s.id === self._look; }) ? this._look : null;
      var lit = function (s) { return look ? look === s.id : !EP.pick || EP.pick === s.id; };
      var head = p === 'now' ? 'Where it’s going now' : 'Where it went';
      var sumText = fmt(total) + (p === 'now' ? '' : ' ' + whenOf(p));
      // what a looked-at section says: its share, and what in it used the most
      this._say = function (id) {
        var q = secs.filter(function (z) { return z.s.id === id; })[0];
        if (!q) return sumText;
        var top = parts.filter(function (z) { return z.s === q.s; })[0];
        return q.s.name + ' · ' + fmt(q.v) + ' · ' + fx(100 * q.v / all, 0) + '%' + (top && top.n ? ' · most: ' + top.n : '');
      };
      this._paint('<div class="ttl"><b>' + head + '</b><span class="num rdw" aria-live="polite">' + esc(look ? this._say(look) : sumText) + '</span></div>' +
        '<div class="bar gwipe">' + parts.map(function (q) {
          return '<i data-sec="' + esc(q.s.id) + '" data-a="' + q.a + '" title="' + esc(q.n) + ': ' + fmt(q.v) + '" style="flex:' + q.v + ' 1 0;background:' + q.s.color +
            ';opacity:' + (lit(q.s) ? q.a : 0.28) + '"></i>';
        }).join('') + (rest > 0 ? '<i data-a="1" title="Not on a device" style="flex:' + rest + ' 1 0;background:' + REST + ';opacity:' + (look ? 0.28 : 1) + '"></i>' : '') + '</div>' +
        '<div class="chips">' + secs.map(function (q) {
          return '<button class="chip' + (lit(q.s) ? '' : ' dim') + '" data-sec="' + esc(q.s.id) + '" aria-pressed="' + (look === q.s.id) + '"><i style="background:' + q.s.color + '"></i><em>' +
            esc(q.s.name) + '</em><span>' + fmt(q.v) + ' · ' + fx(100 * q.v / all, 0) + '%</span></button>';
        }).join('') + (rest > 0 || p !== 'now' ? '<span class="chip' + (look ? ' dim' : '') + '"><i style="background:' + REST + '"></i><em>Not on a device</em><span>' +
          fmt(rest) + ' · ' + fx(100 * rest / all, 0) + '%</span></span>' : '') + '</div>');
      this._sumText = sumText;
      if (this._wired) return;
      // ONE SET OF LISTENERS, on the card, for every paint to come
      this._wired = true;
      var card = this._card, hov = null;
      var secOf = function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-sec]') : null; return t ? t.getAttribute('data-sec') : null; };
      // light one section in place: the bar's parts and the chips, and the line
      var show = function (id) {
        card.querySelectorAll('.bar i').forEach(function (el) {
          el.style.opacity = !id || el.getAttribute('data-sec') === id ? el.getAttribute('data-a') : '0.28';
        });
        card.querySelectorAll('.chip').forEach(function (el) { el.classList.toggle('dim', !!id && el.getAttribute('data-sec') !== id); });
        var sp = card.querySelector('.rdw');
        if (sp) sp.textContent = id ? self._say(id) : self._sumText || '';
      };
      var settle = function () { show(hov || self._look); if (!hov && !self._look) self.redraw(); };
      card.addEventListener('pointerover', function (e) {
        if (e.pointerType !== 'mouse') return;
        var id = secOf(e);
        if (id && id !== hov) { hov = id; show(id); }
      });
      card.addEventListener('pointerout', function (e) {
        if (e.pointerType !== 'mouse' || !hov) return;
        var to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-sec]') : null;
        if (!to) { hov = null; settle(); }
      });
      card.addEventListener('focusin', function (e) { var id = secOf(e); if (id) show(id); });
      card.addEventListener('focusout', function () { settle(); });
      card.addEventListener('click', function (e) {
        var id = secOf(e);
        e.stopPropagation();
        // a section lit for the page by a highlight: a tap here lets it go
        if (EP.pick) { setPick(EP.pick); return; }
        self._look = id && self._look !== id ? id : null;
        hov = null;
        self.redraw();
      });
    }
  }

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
        'ha-card.ep.shape{--hk-ep-h:340px}',
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
        '.ml{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;',
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
        '@media (max-width:' + window.hkCards.BP.phone + 'px){ha-card.ep.shape{--hk-ep-h:330px}}'
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
        var wedge = function (a0, a1, rr) { return 'M' + pt(a0, r0) + ' L' + pt(a0, rr) + ' A' + rr + ' ' + rr + ' 0 0 1 ' + pt(a1, rr) + ' L' + pt(a1, r0) + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' + pt(a0, r0) + 'Z'; };
        for (var hh = 0; hh < 24; hh++) {
          var a0 = (hh / 24) * 2 * Math.PI - Math.PI / 2 + 0.02, a1 = ((hh + 1) / 24) * 2 * Math.PI - Math.PI / 2 - 0.02;
          svg += '<path d="' + wedge(a0, a1, r1) + '" fill="' + window.hkCards.v('key') + '"/>';
          if (hh < vals.length) {
            svg += '<path class="gw" data-i="' + hh + '" style="--i:' + hh + '" d="' + wedge(a0, a1, r0 + (r1 - r0) * Math.max(0.04, vals[hh] / mx)) + '" fill="' + pc + '" fill-opacity="' + (hh === vals.length - 1 ? 1 : 0.82) + '"/>';
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
          var dlab = new Date(R.dates[k]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }) + ' \u00b7 ' + fx(z, 0) + ' kWh' + (today ? ' so far' : '') + ' \u00b7 ' + st2[2].toLowerCase() + ' usual';
          cells += '<button class="c gp' + (today ? ' today' : '') + (EP.dayPick === i ? ' sel' : '') + '" data-day="' + i + '" aria-label="' + esc(dlab) + '" title="' + fx(z, 0) + ' kWh · ' + st2[2] + (today ? ' so far' : '') +
            '" style="--i:' + k + ';background:' + st2[1] + '">' + dn + '</button>';
        });
        // A DAY TAPPED: its own line in place of the legend, its figures, its devices
        var pick = EP.dayPick != null && md.indexOf(EP.dayPick) >= 0 ? EP.dayPick : null;
        if (pick != null) {
          var pz = slotOf(M, R, D.d, pick, sec), pexp = us * (md.indexOf(pick) === R.todayK ? R.share : 1);
          var ppct = pexp > 0 ? Math.round(100 * (pz / pexp - 1)) : 0, pcost = costAt(M, D.d, pick);
          var pname = new Date(R.ax.d[pick].t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
          main = '<div class="cal small">' + cells + '</div><div class="leg dayl"><span class="li"><b>' + pname + '</b></span><span class="li">' + fx(pz, 0) + ' kWh \u00b7 ' +
            (Math.abs(ppct) < 7 ? 'about usual' : Math.abs(ppct) + '% ' + (ppct > 0 ? 'above' : 'below') + ' usual') +
            (M.hasCost && !sec ? ' \u00b7 ' + this._money(pcost, 2) : '') + '</span></div>';
        } else {
          main = '<div class="cal small">' + cells + '</div><div class="leg"><span class="li">Less ' + STEPS.map(function (s2) { return '<i style="background:' + s2[1] + '"></i>'; }).join('') +
            ' More</span><span class="gr"></span><span class="li">Usual: ' + fx(us, 0) + ' kWh</span></div>';
        }
        ttlR = pick != null ? 'tap it again for the month' : 'against a usual day';
        var mv = gone.map(function (i) { return slotOf(M, R, D.d, i, sec); }), mb = mv.indexOf(Math.max.apply(null, mv));
        if (mb >= 0) side.push(['Biggest Day', new Date(R.ax.d[gone[mb]].t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }),
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
        cardEl.addEventListener('pointerout', function (e) { if (e.pointerType === 'mouse' && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.cal .c[data-day]'))) say(null); });
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
        svg += '<rect data-i="' + i + '" x="' + x0.toFixed(1) + '" y="' + (H - gh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + gh.toFixed(1) + '" rx="' + rx.toFixed(1) + '" fill="' + rgba(b.ghostColor || '#ffffff', 0.16) + '"/>';
      }
      var tot = sum(b.segs.map(function (g) { return g.v; }));
      if (tot <= 0) {
        svg += '<rect data-i="' + i + '" x="' + x0.toFixed(1) + '" y="' + (H - 3) + '" width="' + bw.toFixed(1) + '" height="3" rx="1.5" fill="' + window.hkCards.v('key') + '"/>';
      } else {
        // the stack, drawn as one rounded bar: each part clipped from it
        var g0 = '<g class="gr2" data-i="' + i + '" style="--i:' + i + '">', hTot = Math.max(3, H * tot / mx), top = H - hTot;
        var cid = 'c' + (o.id || 'b') + i;
        g0 += '<clipPath id="' + cid + '"><rect x="' + x0.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hTot.toFixed(1) + '" rx="' + rx.toFixed(1) + '"/></clipPath>';
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
      : '<path d="M28 6s20 22 20 37a20 20 0 0 1-40 0C8 28 28 6 28 6z" fill="' + color + '"/><path d="M18 45a10 10 0 0 0 10 10" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/>') +
      '</svg>';
  }
  var MINI_CSS = [
    'ha-card.ep.mini{--hk-ep-h:340px}',
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
    '@media (max-width:' + window.hkCards.BP.phone + 'px){ha-card.ep.mini{--hk-ep-h:330px}}'
  ].join('');
  // the side panel's three figures: [label, value, note]
  function sidePanel(items) {
    return '<div class="ms">' + items.map(function (x) {
      return '<div><div class="k">' + x[0] + '</div><div class="big num">' + x[1] + '</div><div class="cap">' + esc(x[2]) + '</div></div>';
    }).join('') + '</div>';
  }

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
      var M = x.M, R = x.R, D = x.D, h = this._hass;
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
      var M = x.M, R = x.R, D = x.D, h = this._hass, ids = M.src[kind].ids, tz = window.hkStats && window.hkStats.tz();
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
        : new Date(R.ax.d[sl.idx[bi]].t).toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
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
        'ha-card.ep.track{height:auto;padding:6px 22px;margin-left:4px;margin-right:4px;width:auto}',
        // TWO COLUMNS OF ROWS on a wide screen: half the height
        '.tl{display:grid;grid-template-columns:minmax(0,1fr);column-gap:40px}',
        '@container (min-width:' + window.hkCards.BP.cardRows + 'px){.tl{grid-template-columns:repeat(2,minmax(0,1fr))}.tl .tr:nth-child(2){border-top:0}}',
        '.tr{display:grid;grid-template-columns:minmax(140px,210px) 110px minmax(0,1fr);column-gap:20px;align-items:center;',
        '  padding:12px 0;border-top:1px solid ' + window.hkCards.v('line') + '}',
        '.tr:first-child{border-top:0}',
        '.tn b{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.tn b i{width:10px;height:10px;border-radius:50%;flex:none}',
        '.tn span{display:block;margin-top:4px;padding-left:18px;font-size:13px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
        '.tn span b.up{display:inline;color:#ffb340}.tn span b.down{display:inline;color:#4cd964}',
        '.tv{font-size:24px;font-weight:700;letter-spacing:-0.5px;white-space:nowrap;font-variant-numeric:tabular-nums}',
        '.tv u{text-decoration:none;font-size:13px;font-weight:600;margin-left:3px;color:' + window.hkCards.v('ink-2') + '}',
        '.tc{min-width:0;display:flex;justify-content:flex-start}',
        '.tc .bc{align-items:flex-start}',
        '@media (max-width:' + window.hkCards.BP.phone + 'px){.tr{grid-template-columns:minmax(0,1fr) auto;row-gap:10px}.tc{grid-column:1/-1}}',
        // compact: no bars, two columns of rows
        '.compact .tr{grid-template-columns:minmax(0,1fr) auto}.compact .tc{display:none}'
      ].join('');
    }
    getCardSize() { return 6; }
    _render() {
      this._shell('track');
      var x = this._data(), p = period(), h = this._hass, S = window.hkStats;
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
      var cw = (this._card.clientWidth || 1100) - 44, narrow = cw < 600, twoCol = cw >= 1100;
      var colW = twoCol ? (cw - 40) / 2 : cw;
      var avail = narrow ? cw : Math.max(140, colW - 210 - 110 - 40);
      if (!this._card.clientWidth) this._later();
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
          return new Date(R.ax.d[q.i].t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz2 }) + ' \u00b7 ' + fmtV(q.z) + ' \u00b7 last week';
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
      this._paint('<div class="tl">' + rows.join('') + '</div>');
      // each row reads out in its own comparison line
      var self = this;
      this._card.querySelectorAll('.tr').forEach(function (row, ri) {
        var t = rowTips[ri], line = row.querySelector('.tn span');
        if (t) self._scrubs(row.querySelector('.tc .bc'), t.tips, { nowI: t.nowI, name: t.name, readout: function () { return line; }, rest: line ? line.innerHTML : '' });
      });
    }
  }
  register('hk-energy-tracking-card', HkEnergyTrackingCard, 'HK Energy Tracking',
    'The meters and runtimes you follow, a row each: how each compares with its usual, its figure and its bars for the tab.',
    C && [{ name: 'compact', label: 'Without Bars', selector: { boolean: {} },
            helper: 'Each row\'s name, figure and comparison only: a short list.' }],
    function () { return {}; });


  // ============================================================ HOME POWER
  //
  // The home power cards, in the Energy page's language: Right Now (what
  // flows between the grid, the house and the battery), the status in sentences, the house battery as a
  // battery, and a segmented choice for a select (the operating mode). Every
  // reading is an entity in the card's config, so they suit any home battery.
  //
  // POWER IS READ WITH ITS UNIT (hkChart.power): one panel reports W and kW
  // side by side.
  function pw(hass, id) {
    if (!hass || !id) return null;
    var C = window.hkChart;
    if (C) return C.power(hass.states, id, { watts: true, fallback: null });
    var s = hass.states[id], n = s ? Number(s.state) : NaN;
    if (!isFinite(n)) return null;
    return /^kW$/i.test((s.attributes || {}).unit_of_measurement || '') ? n * 1000 : n;
  }
  function numOf(hass, id) {
    var s = id && hass && hass.states[id], n = s ? Number(s.state) : NaN;
    return s && s.state !== '' && isFinite(n) ? n : null;
  }
  function isOn(hass, id) { var s = id && hass && hass.states[id]; return !!s && s.state === 'on'; }
  // NO READING IS NOT AN ANSWER: a missing, unknown or unavailable state is
  // null here, never 'off' or 'away'. The panel's grid status reads unknown
  // for a few seconds ~20 times a day, and a car's location goes unavailable
  // whenever its maker's cloud does -- neither means the grid is down or the
  // car has left.
  function reading(hass, id) {
    var s = id && hass && hass.states[id];
    return s && s.state !== '' && s.state !== 'unknown' && s.state !== 'unavailable' ? s.state : null;
  }
  function gridDown(hass, c) { return !!c.grid_status && reading(hass, c.grid_status) === 'off'; }
  function carHome(hass, k) { var r = k.home ? reading(hass, k.home) : null; return r == null || r === 'home'; }
  // a runtime sensor in hours (or minutes) -> hours
  function hoursOf(hass, id) {
    var v = numOf(hass, id);
    if (v == null) return null;
    var u = ((hass.states[id].attributes || {}).unit_of_measurement || 'h').toLowerCase();
    return /^min/.test(u) ? v / 60 : /^s/.test(u) ? v / 3600 : /^d/.test(u) ? v * 24 : v;
  }
  function wtxt(w) { return watts(w).join(' '); }
  function whtml(w) { var x = watts(w); return x[0] + '<u>' + x[1] + '</u>'; }
  // charging (+), giving (-) or idle (0), in watts
  function batFlow(hass, cfg) {
    var c = pw(hass, cfg.charge) || 0, d = pw(hass, cfg.discharge) || 0;
    return c > 5 ? c : d > 5 ? -d : 0;
  }
  // WHO IS CHARGING, AND AT WHAT (the Power page's cards): with wall chargers
  // (`chargers`, their power sensors) the watts are theirs -- on the house's
  // own network, live -- and a car's own reading (its maker's cloud, minutes
  // behind and stale once the car sleeps) only says WHICH car: the ones
  // whose own reading or state says charging, else the ones plugged in at
  // home. Without chargers, each car's own reading. -> [{car, w}]
  // A CAR WITH ITS OWN (`charger`, its settings: a Wall Connector, a
  // monitored circuit, or its own reading) is charging when that reads; the
  // rest share what is left, as above.
  function carsCharging(hass, c) {
    var all = (c.cars || []).filter(Boolean), atHome = function (k) { return carHome(hass, k); };
    var own = function (k) { return Math.max(0, pw(hass, k.power) || 0); };
    var fixed = all.filter(function (k) { return k.charger; }), taken = fixed.map(function (k) { return k.charger; });
    // (away, a Wall Connector's watts are someone else's car; the car's own
    // reading is a charger somewhere else, not the house's)
    var out = fixed.filter(function (k) { return atHome(k) || k.charger !== k.power; })
      .map(function (k) { return { car: atHome(k) ? k : null, w: Math.max(0, pw(hass, k.charger) || 0) }; })
      .filter(function (x) { return x.w > 5; });
    var cars = all.filter(function (k) { return !k.charger; });
    var chargers = (c.chargers || []).filter(function (id) { return id && taken.indexOf(id) < 0; });
    return out.concat(guess(cars, chargers));
    function guess(cars, chargers) {
      if (!chargers.length) return cars.filter(function (k) { return atHome(k) && own(k) > 5; }).map(function (k) { return { car: k, w: own(k) }; });
      var live = chargers.map(function (id) { return Math.max(0, pw(hass, id) || 0); }).filter(function (w) { return w > 5; })
        .sort(function (a, b) { return b - a; });
      if (!live.length) return [];
      var home = cars.filter(atHome);
      var saysCharging = function (k) {
        var st = k.state && hass.states[k.state];
        return own(k) > 5 || (st && /^charging$/i.test(st.state));
      };
      var cands = home.filter(saysCharging).sort(function (a, b) { return own(b) - own(a); });
      if (!cands.length) cands = home.filter(function (k) { return k.plugged && isOn(hass, k.plugged); });
      if (!cands.length) cands = home;
      return live.map(function (w, i) { return { car: cands[i] || (cands.length === 1 ? null : cands[0]) || null, w: w }; });
    }
  }
  var POWER_ANIM = '@media (prefers-reduced-motion: reduce){.run,.gw,.shim,.wfill,.cell .fill,.hshim{animation:none !important}}' +
    // a card that fills its row (`fill`): as tall as the row, at least its own height
    // (stretched, not a percentage: the grid stretches the host to the row,
    // and the card grows in it)
    ':host([data-fill]){display:flex;flex-direction:column}' +
    'ha-card.ep.fill{flex:1 1 auto;height:auto !important;min-height:var(--hk-ep-h,0px)}' +
    // THE CARD BUILDS IN the first time it has something to show, as the
    // page headers do (hk-headers.js BASE_CSS): its parts rise into place one
    // after another; the graphs build by EP_CSS's .anim. Never on an update.
    '@keyframes hkPwIn{from{opacity:0;transform:translateY(8px)}}' +
    '.anim > *{animation:hkPwIn ' + window.hkCards.DUR.build + ' ' + window.hkCards.EASE.build + ' backwards}' +
    '.anim > :nth-child(2){animation-delay:60ms}.anim > :nth-child(3){animation-delay:120ms}.anim > :nth-child(n+4){animation-delay:180ms}' +
    '@media (prefers-reduced-motion: reduce){.anim > *{animation:none}}';

  // THE SHELL: HK's plate, gated on the entities its config names
  class HkPowerBase extends HkBase {
    // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)
    static get FLAT_MOTION() { return true; }
    static get CSS() { return EP_CSS + (this.PART_CSS || '') + POWER_ANIM; }
    getCardSize() { return 6; }
    _ids() {
      var c = this._config || {}, out = [];
      Object.keys(c).forEach(function (k) {
        var v = c[k];
        if (typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v)) out.push(v);
      });
      (c.packs || []).forEach(function (p) { if (p) { if (p.level) out.push(p.level); if (p.temperature) out.push(p.temperature); } });
      (c.cars || []).forEach(function (k) { if (k) ['level', 'power', 'home', 'plugged', 'charge', 'state', 'charger'].forEach(function (f) { if (k[f]) out.push(k[f]); }); });
      (c.chargers || []).forEach(function (id) { if (id) out.push(id); });
      return out;
    }
    _sigOf() {
      var h = this._hass;
      if (!h || !this._config) return null;
      return this._ids().map(function (id) { var s = h.states[id]; return id + '=' + (s ? s.state : 'x'); }).join(';');
    }
    _shell(cls) {
      if (this._built) return;
      this._root.innerHTML = '<ha-card class="ep ' + cls + '" data-hk-role="card"></ha-card>';
      this._card = this._root.querySelector('ha-card');
      var hgt = this._config && this._config.height;
      if (hgt) this._card.style.setProperty('--hk-ep-h', String(hgt));
      // FILL THE ROW (`fill`: the Power page's pairs): every card in a row as
      // tall as the tallest, each at least its own height
      if (this._config && this._config.fill) {
        this._card.classList.add('fill');
        this.setAttribute('data-fill', '');
        // the shadow root's own wrapper stretches with them
        if (this._root && this._root !== this.shadowRoot && this._root.style) {
          this._root.style.display = 'flex';
          this._root.style.flexDirection = 'column';
          this._root.style.flex = '1 1 auto';
        }
      }
      bindMore(this, this._card);
      this._built = true;
    }
    _paint(html) {
      window.hkCards.morph(this._card, html);
      if (!this._built1 && html && !/class="wait"/.test(html)) {
        this._built1 = true;
        var card = this._card;
        card.classList.add('anim');
        setTimeout(function () { card.classList.remove('anim'); }, 1600);
      }
    }
  }

  // ------------------------------------------------------------ right now
  // The house art (`art`, 1600 x 700, its top 32% empty; the overlay is laid
  // out for one particular picture) with an overlay drawn in its own pixels -- light down
  // the cable while the grid supplies power, faster with more watts; the
  // windows glowing with the house's load; the wall battery's level in its
  // window, rising light while it charges and falling while it powers the
  // house. Without art (or until it loads), three nodes in a row.
  var CABLE = 'M281 272 C 330 390, 430 480, 600 527';
  class HkPowerFlowCard extends HkPowerBase {
    static get PART_CSS() {
      return [
        'ha-card.ep.flow{--hk-ep-h:320px}',
        '.hart{position:relative;flex:1;min-height:0;margin-top:6px;display:flex;align-items:flex-end;justify-content:center}',
        '.hbox{position:relative;height:100%;max-width:100%;aspect-ratio:1600/700}',
        '.hbox img,.hbox .hov,.hbox .cab{position:absolute;inset:0;width:100%;height:100%}',
        '.hbox .cab{will-change:transform;overflow:visible}',
        '.hbox .gw{position:absolute;border-radius:3px;background:radial-gradient(closest-side,rgba(255,217,160,.95),rgba(255,200,120,.35));',
        '  opacity:var(--g);will-change:opacity;animation:breathe 4s ease-in-out infinite}',
        '.hf{position:absolute;top:2%}',
        '.hf.l{left:4%}.hf.c{left:50%;transform:translateX(-50%);text-align:center}.hf.r{right:2%;text-align:right}',
        '.hf .big{font-size:24px;margin-top:4px}',

        '@keyframes breathe{50%{opacity:calc(var(--g) * 0.7)}}',
        '@keyframes run{to{stroke-dashoffset:-32}}',
        '.run{animation:run linear infinite}',
        '.cab .flowline,.hov .flowline{fill:none;stroke:#ffb340;stroke-width:9;stroke-linecap:round;stroke-dasharray:3 26;filter:drop-shadow(0 0 6px rgba(255,179,64,.9))}',
        '.hov .flowline.bat{stroke:#30d158;filter:drop-shadow(0 0 6px rgba(48,209,88,.9))}',
        '.shim{animation:shimUp 1.6s linear infinite}.shim.down{animation-direction:reverse}',
        '@keyframes shimUp{from{transform:translateY(96px)}to{transform:translateY(-96px)}}',
        '.wfill{animation:rise 1.2s cubic-bezier(.22,.8,.25,1) backwards;transform-box:fill-box;transform-origin:50% 100%}',
        '@keyframes rise{from{transform:scaleY(0)}}',
        '.hart.none{display:none}',
        '.hart:not(.none) + .fwrap{display:none}',
        '.fwrap{flex:1;min-height:0;display:flex;align-items:center}',
        '.fchart{width:100%;height:100%;max-height:220px}',
        '@media (max-width:' + window.hkCards.BP.phone + 'px){ha-card.ep.flow{--hk-ep-h:280px}.hf .big{font-size:18px}.hf .k{font-size:10px}}'
      ].join('');
    }
    _render() {
      this._shell('flow');
      var c = this._config || {}, h = this._hass;
      if (!h) return;
      var gridW = pw(h, c.grid), home = pw(h, c.home), lvl = numOf(h, c.level), bw = batFlow(h, c);
      var gOn = gridW != null && gridW > 5, gs = reading(h, c.grid_status), onGrid = gs === 'on' ? true : gs === 'off' ? false : gOn || bw >= 0;
      var bLabel = bw === 0 ? 'Standing by' : bw > 0 ? 'Charging ' + wtxt(bw) : 'Powering the house';
      var speed = function (w) { return Math.max(0.5, 3 - Math.abs(w) / 900).toFixed(2) + 's'; };
      var glow = (0.18 + 0.42 * Math.min(1, (home || 0) / 4000)).toFixed(2);
      var level = lvl == null ? 0 : Math.max(0, Math.min(100, lvl)), wl = level / 100;
      var fig = function (cls, label, value, sub, more) {
        return '<div class="hf ' + cls + '"' + moreAttr(more) + '><div class="k">' + label + '</div><div class="big num">' + value + '</div>' + (sub ? '<div class="cap">' + esc(sub) + '</div>' : '') + '</div>';
      };
      var art = '';
      if (c.art) {
        var over = '<svg class="hov" viewBox="0 0 1600 700" aria-hidden="true"><defs><linearGradient id="shimg" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
          '<clipPath id="wbw"><rect x="1155" y="528" width="26" height="96" rx="6"/></clipPath></defs>' +
          (lvl != null ? '<rect clip-path="url(#wbw)" class="wfill" x="1155" y="' + (528 + 96 * (1 - wl)).toFixed(1) + '" width="26" height="' + (96 * wl).toFixed(1) + '" fill="#30d158" fill-opacity=".85"/>' : '') +
          // the clip on a still group: on the moving light itself it would move
          // with it, and the light would run from the ground to the sky
          (bw !== 0 ? '<g clip-path="url(#wbw)"><rect class="shim' + (bw < 0 ? ' down' : '') + '" x="1155" y="528" width="26" height="96" fill="url(#shimg)"/></g>' : '') +
          (bw < 0 ? '<path class="run flowline bat" d="M1128 580 H1060" style="animation-duration:' + speed(bw) + '"/>' : '') + '</svg>';
        // THE MOVING PARTS ON LAYERS OF THEIR OWN, so a frame repaints only
        // them (measured: blending the glow inside the picture's SVG
        // repainted all of it every frame): the windows' glow as two plain
        // boxes that only change opacity (the compositor's work), the
        // cable's light in a small SVG of its own
        var glowH = '<i class="gw" style="left:41.25%;top:68.3%;width:7%;height:17.7%;--g:' + glow + '"></i>' +
          '<i class="gw" style="left:58.1%;top:68.3%;width:7%;height:17.7%;--g:' + glow + '"></i>';
        var cableH = gOn ? '<svg class="cab" viewBox="0 0 1600 700" aria-hidden="true"><path class="run flowline" d="' + CABLE + '" style="animation-duration:' + speed(gridW) + '"/></svg>' : '';
        art = '<div class="hart' + (this._artFailed ? ' none' : '') + '"><div class="hbox"><img alt="" src="' + esc(c.art) + '">' + glowH + over + cableH +
          fig('l', 'From the Grid', gOn ? whtml(gridW) : 'None', null, c.grid) + fig('c', 'The House', home != null ? whtml(home) : '—', null, c.home) +
          fig('r', 'Battery', lvl != null ? Math.round(level) + '<u>%</u>' : '—', bLabel, c.level) + '</div></div>';
      }
      var line = function (x1, x2, on, col) {
        return '<path d="M' + x1 + ' 70H' + x2 + '" stroke="rgba(255,255,255,.12)" stroke-width="5" stroke-linecap="round"/>' +
          (on ? '<path class="run" d="M' + x1 + ' 70H' + x2 + '" stroke="' + col + '" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 13"/>' : '');
      };
      var GL = (window.hkGlyphs && window.hkGlyphs.icons) || {};
      var node = function (x, g, col, label, val, sub, more) {
        return '<g' + moreAttr(more) + '><circle cx="' + x + '" cy="70" r="30" fill="rgba(0,0,0,.22)" stroke="' + rgba(col, 0.55) + '" stroke-width="2"/>' +
          (typeof GL[g] === 'string' ? '<svg x="' + (x - 15) + '" y="55" width="30" height="30" viewBox="0 0 24 24"><path d="' + GL[g] + '" fill="' + col + '"/></svg>' : '') +
          '<text x="' + x + '" y="132" text-anchor="middle" font-size="12" font-weight="600" letter-spacing=".4" fill="currentColor" opacity=".68">' + label + '</text>' +
          '<text x="' + x + '" y="158" text-anchor="middle" font-size="22" font-weight="700" fill="currentColor">' + val + '</text>' +
          (sub ? '<text x="' + x + '" y="178" text-anchor="middle" font-size="13" fill="currentColor" opacity=".6">' + esc(sub) + '</text>' : '') + '</g>';
      };
      // (no house battery named: the grid and the house alone)
      var hasBat = !!(c.level || c.charge || c.discharge);
      var chart = '<svg class="fchart" viewBox="0 0 600 190" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Power flow">' +
        (hasBat ? line(110, 270, gOn, '#ff9f0a') + line(330, 490, bw !== 0, '#30d158') +
          node(80, 'transmission-tower', '#ff9f0a', 'FROM THE GRID', gOn ? wtxt(gridW) : 'None', null, c.grid) +
          node(300, 'home-lightning-bolt', '#ffffff', 'THE HOUSE', home != null ? wtxt(home) : '—', null, c.home) +
          node(520, 'home-battery-outline', '#30d158', 'BATTERY', lvl != null ? Math.round(level) + '%' : '—', bLabel, c.level)
        : line(220, 380, gOn, '#ff9f0a') +
          node(190, 'transmission-tower', '#ff9f0a', 'FROM THE GRID', gOn ? wtxt(gridW) : 'None', null, c.grid) +
          node(410, 'home-lightning-bolt', '#ffffff', 'THE HOUSE', home != null ? wtxt(home) : '—', null, c.home)) + '</svg>';
      this._paint('<div class="ttl"><b>' + esc(c.title || 'Right Now') + '</b><span>' + (onGrid ? 'on the grid' : 'on the battery') + '</span></div>' +
        art + '<div class="fwrap">' + chart + '</div>');
      // the art missing: the chart, for good (no request on every redraw)
      var img = this._card.querySelector('.hart img'), self = this;
      if (img && !img._hkBound) {
        img._hkBound = true;
        img.addEventListener('error', function () { self._artFailed = true; var a = self._card.querySelector('.hart'); if (a) a.classList.add('none'); });
      }
    }
  }

  // ----------------------------------------------------------- the status
  // What a row of chips said, in sentences (the Energy page's Highlights): a
  // grid outage or a fault first, in red; then the source, the backup, EPS
  // and Storm Mode -- four rows at most.
  var STAT_GLY = {
    tower: '<path d="M12 2 7 22M12 2l5 20M8.5 15h7M9.6 10h4.8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    batt: GLY.batt, bolt: GLY.bolt,
    storm: '<path d="M7 14a5 5 0 1 1 2-9.6A6 6 0 0 1 20 9a4 4 0 0 1-2 7.5M12 12l-2 5h4l-2 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    alert: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6M12 16.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
  };
  class HkPowerStatusCard extends HkPowerBase {
    static get PART_CSS() {
      return [
        'ha-card.ep.pst{--hk-ep-h:320px;padding:6px 22px;display:grid;grid-template-rows:repeat(4,minmax(0,1fr))}',
        // the text centered on its icon, as the Energy page's highlights
        '.hli{display:grid;grid-template-columns:32px minmax(0,1fr);gap:12px;align-content:center;align-items:center;border-top:1px solid ' + window.hkCards.v('line') + '}',
        '.hli:first-child{border-top:0}',
        '.hli .ic{width:32px;height:32px;border-radius:50%;display:grid;place-items:center}',
        '.hli .ic svg{width:18px;height:18px}',
        '.hli .tx{font-size:15px;font-weight:500;line-height:20px;color:' + window.hkCards.v('ink-2') + ';',
        '  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}',
        '.hli .tx b{color:' + window.hkCards.v('ink') + ';font-weight:600}',
        '.hli.alert .tx b{color:#ff6961}',
        '@media (max-width:' + window.hkCards.BP.phone + 'px){ha-card.ep.pst{--hk-ep-h:380px}}'
      ].join('');
    }
    _render() {
      this._shell('pst');
      var c = this._config || {}, h = this._hass;
      if (!h) return;
      var rows = [], lvl = numOf(h, c.level), home = pw(h, c.home), bh = hoursOf(h, c.backup), bw = batFlow(h, c);
      var gridUp = !gridDown(h, c);
      if (!gridUp) rows.push({ more: c.grid_status, ic: STAT_GLY.tower, c: '#ff453a', alert: true, t: '<b>The grid is down.</b> The house is running on the battery' + (lvl != null ? ', at ' + Math.round(lvl) + '%' : '') + '.' });
      if (c.problem && isOn(h, c.problem)) rows.push({ more: c.problem, ic: STAT_GLY.alert, c: '#ff453a', alert: true, t: '<b>The panel reports a fault.</b> Check it in its own app.' });
      // THE SUN, WHAT THE HOUSE RUNS ON, A CAR CHARGING (from the whole
      // house's readings when the page gives them; the panel's otherwise)
      var sun = c.solar ? Math.max(0, pw(h, c.solar) || 0) : 0, g = pw(h, c.grid);
      var Sx = powerSplit({ solar: sun, imp: g == null ? 0 : Math.max(0, g), exp: g != null && g < 0 ? -g : 0, bc: bw > 0 ? bw : 0, bd: bw < 0 ? -bw : 0, home: home });
      if (gridUp && sun > 20) rows.push({ more: c.solar, ic: GLY.sun, c: FLOW.sun, t: '<b>The sun</b> is covering ' + Math.min(100, Math.round(Sx.s2h / Math.max(1, Sx.home) * 100)) +
        '% of the house' + (Sx.s2g > 5 ? ' and selling ' + wtxt(Sx.s2g) + ' back.' : Sx.s2b > 5 ? ' and charging the battery.' : '.') });
      if (gridUp) {
        var on = ({ sun: 'Running mostly on the sun', batt: 'Running on the battery', grid: 'Running on the grid' })[Sx.main || 'grid'];
        // (no house battery named: what the house runs on, alone)
        var hasBat = !!(c.level || c.charge || c.discharge);
        rows.push({ more: c.grid_status, ic: STAT_GLY.tower, c: '#ff9f0a', t: '<b>' + on + '</b>' + (hasBat ? '; the battery is ' +
          (bw > 0 ? 'charging at ' + wtxt(bw) : bw < 0 ? 'helping with ' + wtxt(-bw) : 'standing by') + (lvl != null ? ' at ' + Math.round(lvl) + '%' : '') : '') + '.' });
      }
      var chg = carsCharging(h, c);
      chg.forEach(function (x) {
        rows.push({ more: x.car ? x.car.level : null, ic: GLY.car, c: FLOW.car, t: '<b>' + esc(x.car ? x.car.name || 'A car' : 'A car') + '</b> is charging at ' + wtxt(x.w) + ', ' +
          ({ sun: 'mostly from the sun', batt: 'mostly from the battery', grid: 'mostly from the grid' })[Sx.main || 'grid'] + '.' });
      });
      if (!chg.length && !gridUp) (c.cars || []).forEach(function (k) {
        if (k.plugged && isOn(h, k.plugged)) rows.push({ more: k.level, ic: GLY.car, c: FLOW.car, t: '<b>' + esc(k.name || 'A car') + '</b> is plugged in; charging waits for the grid.' });
      });
      if (bh != null) rows.push({ more: c.backup, ic: STAT_GLY.batt, c: '#30d158', t: '<b>' + (gridUp ? 'A full backup would last ' : 'The battery will last ') + hm(bh) + '</b> at this load' + (home != null ? ' (' + wtxt(home) + ')' : '') + '.' });
      if (c.eps) rows.push({ more: c.eps, ic: STAT_GLY.bolt, c: '#5ac8fa', t: '<b>EPS is ' + (isOn(h, c.eps) ? 'on' : 'off') + '</b>' + (isOn(h, c.eps) ? ': the backed-up circuits switch over in under 20 ms.' : ': backed-up circuits may blink in an outage.') });
      if (c.storm) rows.push({ more: c.storm, ic: STAT_GLY.storm, c: '#bf5af2', t: '<b>Storm Mode is ' + (isOn(h, c.storm) ? 'on' : 'off') + '</b>' + (isOn(h, c.storm) ? ': charging to full ahead of the weather.' : '.') });
      this._paint(rows.slice(0, 4).map(function (r) {
        return '<div class="hli' + (r.alert ? ' alert' : '') + '"' + moreAttr(r.more) + '><div class="ic" style="background:' + rgba(r.c, 0.14) + ';color:' + r.c + '"><svg viewBox="0 0 24 24">' + r.ic + '</svg></div><div class="tx">' + r.t + '</div></div>';
      }).join(''));
    }
  }

  // ------------------------------------------------------ the house battery
  // A battery, filled to its level (growing from the left on first draw),
  // the reserve and the limit marked on it, light running through it while
  // it charges (or back while it powers the house); its packs as small
  // batteries; EPS and the charging speed.
  class HkHouseBatteryCard extends HkPowerBase {
    static get PART_CSS() {
      return [
        'ha-card.ep.hb{height:auto;min-height:256px}',
        '.bt2{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(220px,1fr);gap:36px;flex:1;min-height:0;margin-top:26px;align-items:center}',
        '@container (max-width:720px){.bt2{grid-template-columns:1fr;gap:20px;margin-top:30px}}',
        '.cell{position:relative;height:118px;border-radius:24px;border:6px solid var(--hk-battery-shell,rgba(255,255,255,.42));padding:6px;margin-right:16px;box-sizing:border-box}',
        '.cell:after{content:"";position:absolute;right:-16px;top:32px;width:10px;height:42px;border-radius:0 7px 7px 0;background:var(--hk-battery-shell,rgba(255,255,255,.42))}',
        '.cell .fill{position:relative;overflow:hidden;height:100%;border-radius:13px;background:' + window.hkCards.v('battery-fill') + ';box-shadow:inset 0 1px 0 rgba(255,255,255,0.35);',
        '  animation:growX 1.2s cubic-bezier(.22,.8,.25,1) backwards;transform-origin:0 50%;transition:width .6s ease}',
        '.cell .fill.low{background:' + window.hkCards.v('battery-fill-low') + '}',
        '@keyframes growX{from{transform:scaleX(0)}}',
        '.hshim{position:absolute;top:0;bottom:0;width:35%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);animation:hRun 1.8s linear infinite}',
        '.hshim.bw{animation-direction:reverse}',
        '@keyframes hRun{from{left:-35%}to{left:100%}}',
        '.cell .txt{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding-left:26px}',
        '.cell .txt b{font-size:44px;font-weight:600;letter-spacing:-1.5px;line-height:1;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.25)}',
        '.cell .txt b u{text-decoration:none;font-size:18px;margin-left:2px;opacity:.8}',
        // ONE line under the level: the stored kWh and the backup time. Two
        // lines left the figures a few px off the fill's edges.
        '.cell .txt span{font-size:14px;line-height:18px;font-weight:600;color:rgba(255,255,255,.9);margin-top:8px;text-shadow:0 1px 2px rgba(0,0,0,.25);padding-right:12px;',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // a mark is a tick through the battery's outline, top and bottom --
        // never a line through the figures inside it
        '.mk{position:absolute;top:-10px;bottom:-10px;width:0;border-left:2px dashed;',
        '  -webkit-mask-image:linear-gradient(to bottom,#000 22px,transparent 22px,transparent calc(100% - 22px),#000 calc(100% - 22px));',
        '  mask-image:linear-gradient(to bottom,#000 22px,transparent 22px,transparent calc(100% - 22px),#000 calc(100% - 22px))}',
        '.mkl{position:absolute;bottom:calc(100% + 14px);transform:translateX(-50%);font-style:normal;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}',
        '.side2{display:flex;flex-direction:column;gap:14px;min-width:0}',
        '.pk2{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:14px;align-items:center;padding-right:6px}',
        '.mini{position:relative;height:26px;border-radius:8px;border:3px solid var(--hk-battery-shell,rgba(255,255,255,.42));padding:2px;box-sizing:border-box}',
        '.mini:after{content:"";position:absolute;right:-7px;top:6px;width:4px;height:8px;border-radius:0 2px 2px 0;background:var(--hk-battery-shell,rgba(255,255,255,.42))}',
        '.mini i{display:block;height:100%;border-radius:4px;background:' + window.hkCards.v('battery-fill') + '}',
        '.pk2 b{font-size:15px;font-weight:600}.pk2 span{font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
        '.pk2 .pv{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}',
        '.facts{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-top:14px;border-top:1px solid ' + window.hkCards.v('line') + '}',
        '.facts .big{font-size:20px;margin-top:5px}'
      ].join('');
    }
    _render() {
      this._shell('hb');
      var c = this._config || {}, h = this._hass;
      if (!h) return;
      var lvl = numOf(h, c.level), level = lvl == null ? 0 : Math.max(0, Math.min(100, lvl));
      var stored = numOf(h, c.stored), bh = hoursOf(h, c.backup), bw = batFlow(h, c);
      var res = numOf(h, c.reserve), lim = numOf(h, c.limit);
      var mark = function (v, col, name) {
        if (v == null) return '';
        var at = 'left:calc(6px + (100% - 12px) * ' + (Math.max(0, Math.min(100, v)) / 100) + ')';
        return '<div class="mk" style="' + at + ';border-color:' + col + '"></div><em class="mkl" style="' + at + ';color:' + col + '">' + name + ' ' + Math.round(v) + '%</em>';
      };
      // "at this load" is the status card's to say: here, one short line
      var sub = [stored != null ? fx(stored, 1) + ' kWh' : null, bh != null ? hm(bh) + ' of backup' : null].filter(Boolean).join(' · ');
      var packs = (c.packs || []).map(function (p, i) {
        var pl = numOf(h, p.level), pt = numOf(h, p.temperature), tu = p.temperature && h.states[p.temperature] ? ((h.states[p.temperature].attributes || {}).unit_of_measurement || '') : '';
        return '<div class="pk2"' + moreAttr(p.level) + '><div class="mini"><i style="width:' + (pl == null ? 0 : Math.max(0, Math.min(100, pl))) + '%"></i></div><div><b>' + esc(p.name || 'Pack ' + (i + 1)) + '</b><br><span>' +
          (pt != null ? fx(pt, 0) + esc(tu) : '') + '</span></div><div class="pv">' + (pl == null ? '—' : Math.round(pl) + '<span style="font-size:13px">%</span>') + '</div></div>';
      }).join('');
      var speed = pw(h, c.speed), facts = [];
      if (c.eps) facts.push('<div><div class="k">EPS</div><div class="big">' + (isOn(h, c.eps) ? 'On' : 'Off') + '</div></div>');
      if (speed != null) facts.push('<div><div class="k">Charging Speed</div><div class="big num">' + whtml(speed) + '</div></div>');
      this._paint('<div class="ttl"><b>' + esc(c.title || 'House Battery') + '</b><span>' + (bw > 0 ? 'charging' : bw < 0 ? 'powering the house' : 'standing by') + '</span></div>' +
        '<div class="bt2"><div><div class="cell"' + moreAttr(c.level) + '><div class="fill' + (res != null && level <= res ? ' low' : '') + '" style="width:' + level + '%">' +
          (bw !== 0 ? '<div class="hshim' + (bw < 0 ? ' bw' : '') + '"></div>' : '') + '</div>' +
          mark(res, '#ff9f0a', 'Reserve') + mark(lim, 'var(--hk-battery-mark,rgba(255,255,255,.85))', 'Limit') +
          '<div class="txt"><b>' + (lvl == null ? '—' : Math.round(level) + '<u>%</u>') + '</b><span>' + sub + '</span></div></div></div>' +
        '<div class="side2">' + packs + (facts.length ? '<div class="facts">' + facts.join('') + '</div>' : '') + '</div></div>');
    }
  }

  // ---------------------------------------------------- a segmented choice
  // A select's options as the Energy tabs' segmented control, with one line
  // saying what the chosen one does (`options: [{value, name, description}]`;
  // without them, the select's own options, prettied).
  class HkSegmentCard extends HkPowerBase {
    static get PART_CSS() {
      return [
        'ha-card.ep.segc{height:auto;padding:16px 18px}',
        // HK's segmented control (the calendar's), its choices sharing the width
        window.hkCards.segCss('.seg'),
        '.seg button{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;padding:0 8px}',
        '.mdesc{font-size:14px;line-height:18px;color:' + window.hkCards.v('ink-2') + ';margin:12px 4px 0;min-height:18px}',
        // a phone: names wrap to two lines rather than lose their ends
        // a phone: names wrap to two lines rather than lose their ends
        '@media (max-width:' + window.hkCards.BP.phone + 'px){.seg{height:auto;min-height:44px}.seg button{font-size:13px;padding:4px;height:auto;min-height:36px;white-space:normal;line-height:1.15}}'
      ].join('');
    }
    _opts() {
      var c = this._config || {}, s = this._hass && this._hass.states[c.entity];
      if (Array.isArray(c.options) && c.options.length) {
        return c.options.map(function (o) { return typeof o === 'string' ? { value: o, name: o } : o; });
      }
      return (((s && s.attributes) || {}).options || []).map(function (o) {
        return { value: o, name: String(o).replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); }) };
      });
    }
    _render() {
      this._shell('segc');
      var c = this._config || {}, h = this._hass, self = this;
      if (!h) return;
      var s = h.states[c.entity], cur = this._pending || (s && s.state), opts = this._opts();
      var on = opts.filter(function (o) { return o.value === cur; })[0];
      this._paint('<div class="seg" role="tablist" aria-label="' + esc(c.name || 'Mode') + '">' + opts.map(function (o) {
        return '<button role="tab" data-v="' + esc(o.value) + '" aria-selected="' + (o.value === cur ? 'true' : 'false') + '">' + esc(o.name || o.value) + '</button>';
      }).join('') + '</div><div class="mdesc">' + esc(on ? (on.description || '') : '') + '</div>');
      this._card.querySelectorAll('.seg button').forEach(function (b) {
        if (b._hkBound) return;
        b._hkBound = true;
        b.addEventListener('click', function (e) { e.stopPropagation(); self._choose(b.getAttribute('data-v')); });
      });
      if (this._pending && s && s.state === this._pending) this._pending = null;
    }
    // a choice: shown at once, then asked of the select; back to the
    // select's own state after 4 s if it never takes
    _choose(v) {
      var c = this._config || {}, h = this._hass, self = this;
      if (!c.entity || !h || v === (h.states[c.entity] || {}).state) return;
      var dom = c.entity.split('.')[0];
      var was = this._card && this._card.querySelector('.seg button[aria-selected="true"]'), from = window.hkCards.segBox(was);
      this._pending = v;
      this.redraw();
      var now = this._card && this._card.querySelector('.seg button[aria-selected="true"]');
      if (now && now !== was) window.hkCards.slideSeg(now, from);
      this._call(dom === 'input_select' ? 'input_select' : 'select', 'select_option', { entity_id: c.entity, option: v });
      clearTimeout(this._pendT);
      this._pendT = setTimeout(function () { self._pending = null; self.redraw(); }, 4000);
    }
  }

  // ------------------------------------------------------------ the split
  // Where the power comes from and goes, Home Assistant's own order (its
  // Energy dashboard's): the sun first to what is sold (only the sun or the
  // battery can be), then to the battery, then the house; the grid makes up
  // what the battery took beyond the sun; the battery gives the rest. Watts in,
  // each >= 0: solar, imp (grid in), exp (grid out), bc (battery in), bd
  // (battery out), and home (the whole house, measured; worked out when null).
  function powerSplit(r) {
    var solar = Math.max(0, r.solar || 0), imp = Math.max(0, r.imp || 0), exp = Math.max(0, r.exp || 0);
    var bc = Math.max(0, r.bc || 0), bd = Math.max(0, r.bd || 0);
    var home = r.home != null ? Math.max(0, r.home) : Math.max(0, imp - exp + solar + bd - bc);
    var s2g = Math.min(solar, exp), s2b = Math.min(solar - s2g, bc), s2h = Math.max(0, solar - s2g - s2b);
    var g2b = Math.max(0, bc - s2b), g2h = Math.max(0, imp - g2b), b2h = Math.max(0, bd - Math.max(0, exp - s2g));
    var all = s2h + g2h + b2h, mix = all > 0 ? { sun: s2h / all, grid: g2h / all, batt: b2h / all } : { sun: 0, grid: 0, batt: 0 };
    var main = 'grid';
    ['sun', 'batt'].forEach(function (k) { if (mix[k] > mix[main]) main = k; });
    return { home: home, s2g: s2g, s2b: s2b, s2h: s2h, g2b: g2b, g2h: g2h, b2h: b2h, mix: mix, main: all > 0 ? main : null };
  }
  var FLOW = { sun: '#ffd60a', grid: '#ff9f0a', batt: '#30d158', car: '#64d2ff', home: '#ffffff', red: '#ff453a' };

  // --------------------------------------------------------- the picture
  // THE HOUSE, full width and plateless: a layered picture (`art`, a folder
  // with art.json, in a house's own files) where each layer
  // shows only when the house has it (panels with solar, the battery with
  // one, the car while one is home), the figures as floating chips over the
  // part of the house each is about, and light running along the real cables
  // (the pole's while buying or selling, the car's while it charges) at a
  // pace that follows the watts. The battery's level is a slim bar on the
  // cabinet's front, drawn in the face's own plane; a light rises through it
  // while it charges. Every clip sits on a still group (328d073b).
  // A FAILED LOAD IS NOT KEPT: its waiters hear null and the entry goes, so
  // the next card (or the same one after a 60 s back-off, as hk-stats backs
  // off after an error) asks again -- one bad fetch on a tablet waking on weak Wi-Fi no longer
  // leaves every Power page blank until a full reload.
  var ART = {};          // art.json by folder, loaded once
  var ART_RETRY_MS = 60000;
  // through hkCards.artJson: the browser's last copy at once, the file
  // asked again behind it (a picture changed is drawn again)
  function artOf(base, done) {
    if (ART[base] && ART[base].json) return done(ART[base].json);
    window.hkCards.artJson(base, function (j) {
      if (j) ART[base] = { json: j, wait: [] };
      done(j);
    });
  }
  // THE CABLE AS A CURVE: the art's points joined by a Catmull-Rom spline
  // (straight segments between them bent at every point -- the pole's drop
  // looked kinked). -> [[p0, c1, c2, p1], ...] in the picture's own units
  function curveOf(pts) {
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i - 1] || pts[i], b = pts[i], c = pts[i + 1], d = pts[i + 2] || c;
      out.push([b, [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6], [c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6], c]);
    }
    return out;
  }
  function curvePath(segs) {
    var f = function (q) { return (+q[0]).toFixed(1) + ' ' + (+q[1]).toFixed(1); };
    return segs.length ? 'M' + f(segs[0][0]) + segs.map(function (g) { return ' C' + f(g[1]) + ' ' + f(g[2]) + ' ' + f(g[3]); }).join('') : '';
  }
  // n + 1 points evenly spaced ALONG the curve (by length, not by segment),
  // and the curve's length
  function curveWalk(segs, n) {
    var poly = [], at = function (g, t) {
      var u = 1 - t;
      return [u * u * u * g[0][0] + 3 * u * u * t * g[1][0] + 3 * u * t * t * g[2][0] + t * t * t * g[3][0],
              u * u * u * g[0][1] + 3 * u * u * t * g[1][1] + 3 * u * t * t * g[2][1] + t * t * t * g[3][1]];
    };
    segs.forEach(function (g, i) { for (var k = i ? 1 : 0; k <= 24; k++) poly.push(at(g, k / 24)); });
    var len = [0];
    for (var i = 1; i < poly.length; i++) len.push(len[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    var total = len[len.length - 1], out = [], j = 1;
    for (var s = 0; s <= n; s++) {
      var want = total * s / n;
      while (j < len.length - 1 && len[j] < want) j++;
      var span = len[j] - len[j - 1] || 1, t = Math.max(0, Math.min(1, (want - len[j - 1]) / span));
      out.push([poly[j - 1][0] + (poly[j][0] - poly[j - 1][0]) * t, poly[j - 1][1] + (poly[j][1] - poly[j - 1][1]) * t]);
    }
    return { pts: out, length: total };
  }
  // A CABLE CARRYING POWER (the user's pick, 2026-10-14: "Option A"): the
  // cable drawn as a smooth line, and one soft glow travelling along it at
  // an even pace -- in from the pole, out to it when selling. The glow is an
  // HTML dot moved by `transform` keyframes, so it runs on the compositor:
  // the old three-stripe light (stroke-dashoffset inside the picture's SVG)
  // restyled and repainted the picture every frame -- the page's main thread
  // 11.9 % against 5.9 % without it (headless, a 1280 tablet at 4x); this way
  // ~0 (a lab page: 60 restyles/s -> 0). -> {svg, dot: html, css}
  var FLOW_PX_S = 90;              // the glow's pace, picture px a second
  function flowLine(pts, col, back, crop) {
    var segs = curveOf(pts), walk = curveWalk(segs, 40);
    var dur = Math.max(3.5, Math.min(6, walk.length / FLOW_PX_S));
    var key = 'hkf' + (function (str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); })(JSON.stringify(pts) + crop);
    var n = walk.pts.length - 1;
    var kf = walk.pts.map(function (q, i) {
      var op = i === 0 || i === n ? 0 : i < 3 || i > n - 3 ? 0.55 : 1;
      return (i / n * 100).toFixed(2) + '%{transform:translate(' + q[0].toFixed(1) + 'px,' + (q[1] - crop).toFixed(1) + 'px);opacity:' + op + '}';
    }).join('');
    return {
      svg: '<path d="' + curvePath(segs) + '" fill="none" stroke="' + col + '" stroke-opacity=".5" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>',
      css: '@keyframes ' + key + '{' + kf + '}',
      dot: '<i class="flowdot" style="animation:' + key + ' ' + dur.toFixed(2) + 's linear infinite' + (back ? ' reverse' : '') +
           ';background:radial-gradient(circle,rgba(255,255,255,.95) 0,' + rgba(col, 0.85) + ' 18%,' + rgba(col, 0.35) + ' 42%,' + rgba(col, 0) + ' 70%)"></i>'
    };
  }
  class HkPowerHouseCard extends HkPowerBase {
    static get PART_CSS() {
      var v = window.hkCards.v, B = window.hkCards.BLUR;
      return [
        ':host{display:block}',
        'ha-card.ep.phouse{height:auto;background:none;border:0;box-shadow:none;padding:0;overflow:visible}',
        '.hart{position:relative;width:100%;margin:58px auto 0}',
        '.hart svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
        '.pic{position:absolute;inset:0}',
        // the moving light (flowLine): a zero-size stage scaled to the picture
        '.stage{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;transform:scale(var(--fs,1));pointer-events:none}',
        '.pic:not([data-fs]) .stage{visibility:hidden}',
        '.flowdot,.portdot{position:absolute;left:0;top:0;border-radius:50%;will-change:transform,opacity}',
        '.flowdot{width:56px;height:56px;margin:-28px 0 0 -28px;opacity:0}',
        '.portdot{width:30px;height:30px;margin:-15px 0 0 -15px;background:radial-gradient(circle,#30d158 0,#30d158 45%,rgba(48,209,88,.45) 60%,rgba(48,209,88,0) 72%);animation:port 1.4s ease-in-out infinite}',
        '.chips{position:absolute;inset:0;pointer-events:none}',
        // a chip: the floating strip's material (Tinted: its near-solid plate)
        '.chip{position:absolute;transform:translate(-50%,calc(-100% - 18px));padding:8px 13px 9px;border-radius:' + window.hkCards.R.inner + 'px;white-space:nowrap;pointer-events:auto;cursor:pointer;',
        '  background:' + v('float-plate') + ';-webkit-backdrop-filter:var(--hk-float-backdrop,' + B.medium + ');backdrop-filter:var(--hk-float-backdrop,' + B.medium + ');',
        '  border:1px solid rgba(255,255,255,0.12);box-shadow:0 8px 24px rgba(0,0,0,0.28);-webkit-tap-highlight-color:transparent}',
        '.chip:after{content:"";position:absolute;left:50%;top:100%;width:1.5px;height:18px;background:rgba(255,255,255,0.5);transform:translateX(-50%)}',
        '.chip.l{transform:translate(calc(-100% + 16px),calc(-100% - 18px))}.chip.l:after{left:auto;right:16px;transform:none}',
        '.chip.r{transform:translate(-16px,calc(-100% - 18px))}.chip.r:after{left:16px;transform:none}',
        '.chip .k{font-size:11px;letter-spacing:0.4px;gap:6px}.chip .k i{width:8px;height:8px;border-radius:50%;display:inline-block}',
        '.chip .big{font-size:22px;margin-top:3px}',
        // the cars' chip: a row a car, the names left, the readings right
        '.crows{display:grid;grid-template-columns:auto auto;column-gap:18px;row-gap:5px;margin-top:6px;align-items:baseline}',
        '.crow{display:contents}.crow b{font-size:15px;font-weight:600;white-space:nowrap}',
        '.crow span{font-size:17px;font-weight:700;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
        '.crow span u{text-decoration:none;font-size:11px;font-weight:600;margin-left:1px;opacity:.75}',
        '.crow span.away{font-size:15px;font-weight:600;color:' + v('ink-2') + '}',
        '.crow .blt{display:inline-block;width:9px;height:12px;margin-right:5px;vertical-align:-1px;background:currentColor;',
        '  -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 10 14%27%3E%3Cpath d=%27M6 0L0 8h4l-1 6 6-8H5z%27/%3E%3C/svg%3E") center/contain no-repeat;',
        '  mask:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 10 14%27%3E%3Cpath d=%27M6 0L0 8h4l-1 6 6-8H5z%27/%3E%3C/svg%3E") center/contain no-repeat}',
        '@keyframes glint{from{transform:translateX(-420px)}to{transform:translateX(620px)}}',
        '.glint{animation:glint 3.2s ' + window.hkCards.EASE.standard + ' infinite}',
        '@keyframes lvRun{from{transform:translateY(250%)}to{transform:translateY(-100%)}}',
        '.lvrun{transform-box:fill-box;animation:lvRun 2.2s ' + window.hkCards.EASE.build + ' infinite}.lvrun.down{animation-direction:reverse}',
        '@keyframes lvTop{50%{opacity:.35}}',
        '.lvtop{animation:lvTop 1.6s ease-in-out infinite;filter:drop-shadow(0 0 3px rgba(108,240,143,.9))}',
        '@keyframes port{50%{opacity:.25}}',
        '@media (prefers-reduced-motion:reduce){.glint,.lvrun,.lvtop,.portdot{animation:none}.flowdot{display:none}}',
        // a phone: the chips in a grid above the house, no stems
        '@container (max-width:' + window.hkCards.BP.cardSide + 'px){.hart{margin-top:0;display:flex;flex-direction:column-reverse;aspect-ratio:auto !important;max-width:none !important}',
        '  .pic{position:relative}.hart svg{position:static;height:auto}.chips{position:static;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:8px}',
        '  .chip,.chip.l,.chip.r{position:static;transform:none;white-space:normal}.chip:after{display:none}.chip .lg{display:none}.dot{display:none}',
        '  .chip.cars{grid-column:1/-1}.chip.cars .crows{grid-template-columns:minmax(0,1fr) auto}.chip.cars .crow b{overflow:hidden;text-overflow:ellipsis}}'
      ].join('');
    }
    // NO PLATE: the house sits on the page
    setConfig(config) { super.setConfig(Object.assign({ glass: false }, config || {})); }
    // THE STAGE FOLLOWS THE PICTURE'S WIDTH: its scale is set when the
    // picture is laid out at a new size -- the ResizeObserver's own moment,
    // never a read in the render
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this._pic && this._fitRO) this._fitRO.observe(this._pic);
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      if (this._fitRO) this._fitRO.disconnect();
    }
    _fit() {
      var pic = this._card && this._card.querySelector('.pic');
      if (!pic || pic === this._pic || typeof ResizeObserver !== 'function') return;
      if (!this._fitRO) {
        var self = this;
        this._fitRO = new ResizeObserver(function (entries) {
          entries.forEach(function (e) {
            var W = self._artW, w = e.contentRect.width;
            if (!W || !w) return;
            self._fs = (w / W).toFixed(5);
            e.target.style.setProperty('--fs', self._fs);
            e.target.setAttribute('data-fs', '');
          });
        });
      }
      if (this._pic) this._fitRO.unobserve(this._pic);
      this._pic = pic;
      this._fitRO.observe(pic);
    }
    getCardSize() { return 8; }
    _ids() {
      var c = this._config || {}, out = super._ids();
      (c.cars || []).forEach(function (k) { ['level', 'power', 'home', 'plugged', 'charge', 'state', 'charger'].forEach(function (f) { if (k && k[f]) out.push(k[f]); }); });
      (c.chargers || []).forEach(function (id) { if (id) out.push(id); });
      return out;
    }
    _render() {
      this._shell('phouse');
      var c = this._config || {}, h = this._hass, self = this;
      if (!h) return;
      // THE PICTURE FOLDER: your own (art.json and its layers, in your
      // files), else the house that ships (frontend/power-house, 2026-10-14)
      var base = c.art || '/hk/power-house/';
      if (base.slice(-1) !== '/') base += '/';
      if (this._art === undefined && !(this._artFail && Date.now() - this._artFail < ART_RETRY_MS)) {
        this._art = null;
        artOf(base, function (j) {
          if (j) { self._art = j; self._artFail = 0; self.redraw(); } else { self._art = undefined; self._artFail = Date.now(); }
        });
      }
      var A = this._art;
      if (!A) return;
      var L = A.layers || {}, W = A.canvas[0], H = A.canvas[1];
      // THE READINGS (watts): the grid signed or in two sensors, the sun, the
      // battery, the whole house; each car: home, plugged in, charging
      var g = pw(h, c.grid), gx = pw(h, c.grid_export);
      var imp = g == null ? 0 : Math.max(0, g), exp = gx != null ? Math.max(0, gx) : g != null && g < 0 ? -g : 0;
      var solar = c.solar ? Math.max(0, pw(h, c.solar) || 0) : 0, hasSolar = !!c.solar;
      var bat = !!c.level, lvl = numOf(h, c.level), level = lvl == null ? 0 : Math.max(0, Math.min(100, lvl)), bw = batFlow(h, c);
      var gridUp = !gridDown(h, c);
      var cars = (c.cars || []).map(function (k) {
        var home = carHome(h, k);
        return { cfg: k, home: home, plugged: k.plugged ? isOn(h, k.plugged) : home };
      });
      var chg = carsCharging(h, c);
      var carsOn = cars.length > 0, carsHome = cars.filter(function (k) { return k.home; }), carW = chg.reduce(function (a, x) { return a + x.w; }, 0);
      var S = powerSplit({ solar: solar, imp: imp, exp: exp, bc: bw > 0 ? bw : 0, bd: bw < 0 ? -bw : 0, home: pw(h, c.home) });
      var crop = A.crop != null ? A.crop : Math.max(0, Math.min.apply(null, Object.keys(L).map(function (k) { return L[k][2]; })) - 50);
      var vh = H - crop, maxh = c.max_height || A.max_height || 560;
      // the layers, each at its trimmed place
      var img = function (k) { var l = L[k]; return l ? '<image href="' + base + l[0] + '" x="' + l[1] + '" y="' + l[2] + '" width="' + l[3] + '" height="' + l[4] + '"/>' : ''; };
      var fade = A.fade || { right: [0.86, 0.985], bottom: [0.9, 1] };
      var svg = '<svg viewBox="0 ' + crop + ' ' + W + ' ' + vh + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><defs>' +
        '<linearGradient id="hfx" x1="0" x2="1" y1="0" y2="0"><stop offset="' + fade.right[0] + '" stop-color="#fff"/><stop offset="' + fade.right[1] + '" stop-color="#000"/></linearGradient>' +
        '<linearGradient id="hfy" x1="0" x2="0" y1="0" y2="1"><stop offset="' + fade.bottom[0] + '" stop-color="#fff"/><stop offset="' + fade.bottom[1] + '" stop-color="#000"/></linearGradient>' +
        '<mask id="hfm" maskContentUnits="userSpaceOnUse"><rect width="' + W + '" height="' + H + '" fill="url(#hfx)"/></mask>' +
        '<mask id="hfm2" maskContentUnits="userSpaceOnUse"><rect width="' + W + '" height="' + H + '" fill="url(#hfy)"/></mask>' +
        '<linearGradient id="gl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff8d0" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
        (hasSolar && L.solar ? '<mask id="pvm" style="mask-type:alpha">' + img('solar') + '</mask>' : '') + '</defs>' +
        '<g mask="url(#hfm)"><g mask="url(#hfm2)">' + img('house') + '</g></g>';
      if (hasSolar) {
        svg += img('solar');
        if (solar > 20 && L.solar) svg += '<g mask="url(#pvm)" opacity="' + (0.35 + 0.65 * Math.min(1, solar / 5000)).toFixed(2) + '"><rect class="glint" x="' + (L.solar[1] - 100) + '" y="' + L.solar[2] + '" width="260" height="' + L.solar[4] + '" fill="url(#gl)" transform="skewX(-20)"/></g>';
      }
      if (bat) svg += img('battery') + (lvl == null ? '' : this._level(A, level, bw, lvl != null && c.reserve && numOf(h, c.reserve) != null && level <= numOf(h, c.reserve)));
      svg += img('pole');
      var flows = [], dots = '';
      if (A.paths && A.paths.grid) {
        if (imp > 5 && gridUp) flows.push(flowLine(A.paths.grid, FLOW.grid, false, crop));
        else if (exp > 5 && gridUp) flows.push(flowLine(A.paths.grid, FLOW.sun, true, crop));
      }
      flows.forEach(function (f) { svg += f.svg; });
      var charging = carW > 5;
      if (carsOn) {
        svg += img('charger');
        if (carsHome.length) svg += img('car') + img('cable');
        var car = A.cars && A.cars.a;
        if (charging && car && car.cable) {
          var col = FLOW[S.main] || FLOW.grid;
          var cf = flowLine(car.cable, col, false, crop);
          flows.push(cf);
          svg += cf.svg;
          // the charge port breathing: an HTML dot too (opacity, compositor)
          dots += '<i class="portdot" style="transform:translate(' + car.port[0] + 'px,' + (car.port[1] - crop) + 'px)"></i>';
        }
      }
      // THE CHIPS, each over its anchor, with a stem to a dot
      var AN = A.anchors || {}, side = A.chip_side || {}, chips = [];
      var chip = function (key, more, col, label, val) {
        var a = AN[key];
        if (!a) return;
        label = label.replace(/^(From the |To the |The )/, '<span class="lg">$1</span>');
        chips.push({ key: key, a: a, more: more, h: '<div class="k"><i style="background:' + col + '"></i>' + label + '</div><div class="big num">' + val + '</div>' });
      };
      if (!gridUp) chip('grid', c.grid_status, FLOW.red, 'The Grid', 'Down');
      else if (exp > 5) chip('grid', c.grid_export || c.grid, FLOW.sun, 'To the Grid', whtml(exp));
      else chip('grid', c.grid, FLOW.grid, 'From the Grid', imp > 5 ? whtml(imp) : 'None');
      chip('house', c.home, FLOW.home, 'The House', S.home > 0 ? whtml(S.home) : 'Off');
      if (hasSolar) chip('solar', c.solar, FLOW.sun, 'The Sun', solar > 20 ? whtml(solar) : 'None');
      if (bat) chip('battery', c.level, FLOW.batt, 'Battery', lvl == null ? '—' : Math.round(level) + '<u>%</u>');
      // THE CARS: one chip, a row each -- its name, and its charging watts,
      // its level at home, or Away; a row opens its car. Watts no car can
      // claim are "A car".
      if (carsOn && AN.cars) {
        var crow = function (more, name, v) { return '<div class="crow"' + moreAttr(more) + '><b>' + esc(name) + '</b>' + v + '</div>'; };
        var chgv = function (w) { return '<span class="chg" style="color:' + FLOW.car + '"><i class="blt"></i>' + whtml(w) + '</span>'; };
        var crows = cars.map(function (k) {
          var x = chg.filter(function (y) { return y.car === k.cfg; })[0], lv = numOf(h, k.cfg.level);
          return crow(k.cfg.level, k.cfg.name || 'Car', x ? chgv(x.w) : !k.home ? '<span class="away">Away</span>' :
            '<span>' + (lv == null ? '—' : Math.round(lv) + '<u>%</u>') + '</span>');
        }).concat(chg.filter(function (y) { return !y.car; }).map(function (y) { return crow(null, 'A car', chgv(y.w)); }));
        chips.push({ key: 'cars', a: AN.cars, cls: 'cars', h: '<div class="k"><i style="background:' + FLOW.car + '"></i>' + (cars.length > 1 ? 'Cars' : 'Car') + '</div>' +
          '<div class="crows">' + crows.join('') + '</div>' });
      }
      svg += chips.map(function (f) { return '<circle class="dot" cx="' + f.a[0] + '" cy="' + f.a[1] + '" r="8" fill="#fff" fill-opacity=".9" style="filter:drop-shadow(0 0 4px rgba(0,0,0,.5))"/>'; }).join('');
      svg += '</svg>';
      var mw = Math.round(maxh * W / vh);
      // the moving light over the picture, in the picture's own units: the
      // stage is scaled to the picture's width (_fit, a ResizeObserver)
      this._artW = W;
      var stage = flows.length || dots ? '<div class="stage"><style>' + flows.map(function (f) { return f.css; }).join('') + '</style>' +
        flows.map(function (f) { return f.dot; }).join('') + dots + '</div>' : '';
      // (the scale last measured goes in the markup: a redraw's morph keeps
      // only what the markup says)
      var fs = this._fs ? ' style="--fs:' + this._fs + '" data-fs' : '';
      this._paint('<div class="hart" style="aspect-ratio:' + W + '/' + vh + ';max-width:' + mw + 'px"><div class="pic"' + fs + '>' + svg + stage + '</div><div class="chips">' + chips.map(function (f) {
        // NEAR AN EDGE A CHIP OPENS INWARD (it ran off an iPad's page): in the
        // picture's outer fifths it sits on the inner side of its line
        var fx0 = f.a[0] / W, sd = fx0 > 0.8 ? 'l' : fx0 < 0.2 ? 'r' : side[f.key];
        return '<div class="chip' + (f.cls ? ' ' + f.cls : '') + (sd ? ' ' + sd : '') + '"' + moreAttr(f.more) + ' style="left:' + (f.a[0] / W * 100).toFixed(2) + '%;top:' + ((f.a[1] - crop) / vh * 100).toFixed(2) + '%">' + f.h + '</div>';
      }).join('') + '</div></div>');
      this._fit();
    }
    // the slim level bar on the cabinet's front, skewed into the face's plane
    _level(A, level, bw, low) {
      var q = A.battery_window;
      if (!q) return '';
      var fw = q[1][0] - q[0][0], fh = q[3][1] - q[0][1], sk = (q[1][1] - q[0][1]) / fw;
      var cx = A.bar_cx != null ? A.bar_cx - q[0][0] : fw / 2;
      var bwid = Math.max(10, fw * 0.34), bx = cx - bwid / 2, by = fh * 0.17, bh = fh * 0.72, fill = bh * level / 100;
      return '<g transform="matrix(1 ' + sk.toFixed(4) + ' 0 1 ' + q[0][0] + ' ' + q[0][1] + ')">' +
        '<defs><linearGradient id="lvg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="' + (low ? '#c42a22' : '#1f9e43') + '"/><stop offset="1" stop-color="' + (low ? '#ff6b61' : '#6cf08f') + '"/></linearGradient>' +
        '<linearGradient id="lvs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff" stop-opacity=".35"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
        '<linearGradient id="lvl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#eafff0" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
        '<clipPath id="lvc"><rect x="' + bx.toFixed(2) + '" y="' + (by + bh - fill).toFixed(1) + '" width="' + bwid.toFixed(2) + '" height="' + fill.toFixed(1) + '" rx="' + (bwid / 2).toFixed(2) + '"/></clipPath></defs>' +
        '<rect class="lvtrack" x="' + (bx - 2).toFixed(2) + '" y="' + (by - 2).toFixed(1) + '" width="' + (bwid + 4).toFixed(2) + '" height="' + (bh + 4).toFixed(1) + '" rx="' + (bwid / 2 + 2).toFixed(2) + '" fill="rgba(0,0,0,.55)" stroke="rgba(255,255,255,.22)" stroke-width="1"/>' +
        '<g clip-path="url(#lvc)"><rect x="' + bx.toFixed(2) + '" y="' + by.toFixed(1) + '" width="' + bwid.toFixed(2) + '" height="' + bh.toFixed(1) + '" fill="url(#lvg)"/>' +
        '<rect x="' + bx.toFixed(2) + '" y="' + by.toFixed(1) + '" width="' + bwid.toFixed(2) + '" height="' + bh.toFixed(1) + '" fill="url(#lvs)"/>' +
        (bw ? '<rect class="lvrun' + (bw < 0 ? ' down' : '') + '" x="' + bx.toFixed(2) + '" y="' + by.toFixed(1) + '" width="' + bwid.toFixed(2) + '" height="' + (bh * 0.4).toFixed(1) + '" fill="url(#lvl)"/>' : '') + '</g>' +
        (bw > 0 ? '<rect class="lvtop" x="' + bx.toFixed(2) + '" y="' + (by + bh - fill - 1.5).toFixed(1) + '" width="' + bwid.toFixed(2) + '" height="3" rx="1.5" fill="#d8ffe3"/>' : '') + '</g>';
    }
  }

  // ------------------------------------------------------------ the house
  // THE WHOLE HOUSE, NOT JUST THE BATTERY'S PANEL: one bar split into what
  // the battery backs up, what it does not and a car charging; the three
  // drawing the most, each marked backed up or not; how much of the house the
  // battery covers now. `devices` [{name, power, backed}] come from the
  // Energy feature's plan; `backed_power` (the battery panel's output) is the
  // backed-up share where there is one, else the backed-up devices' sum.
  // (a variable: Flat's Light turns it gray -- white on its ivory plate vanished)
  var NOT_BACKED = 'var(--hk-not-backed,rgba(255,255,255,0.55))';
  class HkPowerLoadCard extends HkPowerBase {
    static get PART_CSS() {
      var v = window.hkCards.v;
      return [
        'ha-card.ep.pload{--hk-ep-h:270px}',
        '.lbar{display:flex;height:16px;border-radius:8px;overflow:hidden;background:' + v('key') + ';margin-top:14px;gap:2px;flex:none}',
        '.lbar i{display:block;height:100%}',
        '.lg2{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;font-size:13px;color:' + v('ink-2') + '}',
        '.lg2 span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.lg2 span i{width:8px;height:8px;border-radius:50%}',
        '.lg2 b{color:' + v('ink') + ';font-weight:600;font-variant-numeric:tabular-nums}',
        '.rows{display:flex;flex-direction:column;margin-top:8px}',
        '.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;min-height:29px;border-top:1px solid ' + v('line') + ';font-size:15px;cursor:pointer}',
        '.row:first-child{border-top:0}',
        '.row b{font-weight:600;color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.row em{font-style:normal;font-size:13px;color:' + v('ink-2') + ';margin-left:6px}',
        '.row span{font-weight:600;font-variant-numeric:tabular-nums}',
        '.say{font-size:15px;line-height:20px;color:' + v('ink-2') + ';margin-top:auto;padding-top:8px}.say b{color:' + v('ink') + '}',
        '.ttl a{color:#64d2ff;text-decoration:none;font-weight:600}'
      ].join('');
    }
    _ids() {
      var out = super._ids();
      (this._config.devices || []).forEach(function (d) { if (d && d.power) out.push(d.power); });
      (this._config.cars || []).forEach(function (k) { if (k) ['power', 'home', 'plugged', 'state', 'charger'].forEach(function (f) { if (k[f]) out.push(k[f]); }); });
      (this._config.chargers || []).forEach(function (id) { if (id) out.push(id); });
      return out;
    }
    _render() {
      this._shell('pload');
      var c = this._config || {}, h = this._hass;
      if (!h) return;
      var hw = pw(h, c.home), home = Math.max(0, hw || 0), outage = gridDown(h, c);
      var devs = (c.devices || []).map(function (d) { return { name: d.name, more: d.power, w: Math.max(0, pw(h, d.power) || 0), up: !!d.backed, parent: !!d.parent }; });
      var carW = carsCharging(h, c).reduce(function (a, x) { return a + x.w; }, 0);
      // the backed-up split only with readings to split: no house total or
      // no backed-up reading is "no split", not 0 %
      var bpw = c.backed_power ? pw(h, c.backed_power) : null;
      var anyUp = devs.some(function (d) { return d.up; }) && hw != null && (!c.backed_power || bpw != null);
      var backed = c.backed_power ? Math.max(0, bpw || 0)
        : devs.reduce(function (a, d) { return a + (d.up && !d.parent ? d.w : 0); }, 0);
      backed = Math.min(backed, home);
      var other = Math.max(0, home - backed - carW);
      var parts = anyUp ? [['Backed Up', backed, FLOW.batt], ['Not Backed Up', other, NOT_BACKED], ['Charging', carW, FLOW.car]]
        : [['The House', Math.max(0, home - carW), NOT_BACKED], ['Charging', carW, FLOW.car]];
      parts = parts.filter(function (p) { return p[1] > 1; });
      var tot = parts.reduce(function (a, p) { return a + p[1]; }, 0) || 1;
      var top = devs.filter(function (d) { return !d.parent && d.w > 5; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 3);
      var link = c.link ? '<a href="' + esc(c.link) + '" data-nav="' + esc(c.link) + '">Every device ›</a>' : '';
      this._paint('<div class="ttl"><b>' + esc(c.title || 'The House') + '</b><span>' + (link || (home > 0 ? wtxt(home) + ' now' : '')) + '</span></div>' +
        '<div class="lbar">' + parts.map(function (p) { return '<i style="width:' + (p[1] / tot * 100).toFixed(2) + '%;background:' + p[2] + '"></i>'; }).join('') + '</div>' +
        '<div class="lg2">' + parts.map(function (p) { return '<span><i style="background:' + p[2] + '"></i>' + p[0] + ' <b>' + wtxt(p[1]) + '</b></span>'; }).join('') + '</div>' +
        '<div class="rows">' + top.map(function (d) {
          return '<div class="row"' + moreAttr(d.more) + '><b>' + esc(d.name) + (anyUp ? '<em>' + (d.up ? 'backed up' : 'not backed up') + '</em>' : '') + '</b><span>' + wtxt(d.w) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="say">' + (outage && anyUp ? 'In the outage only the backed-up circuits are on.'
          : anyUp ? 'The battery covers <b>' + Math.round(backed / Math.max(1, home) * 100) + '%</b> of the house now.' : 'Drawing the most right now.') + '</div>');
      var a = this._card.querySelector('.ttl a'), self = this;
      if (a && !a._hkBound) {
        a._hkBound = true;
        a.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          history.pushState(null, '', a.getAttribute('data-nav'));
          self.dispatchEvent(new CustomEvent('location-changed', { bubbles: true, composed: true }));
        });
      }
    }
  }

  // ------------------------------------------------- where the sun goes
  // RIGHT NOW in watts (the split of the live readings) and TODAY in kWh
  // (the same split, hour by hour, over the Energy page's statistics: what
  // Home Assistant's Energy dashboard does), and how much of today's sun the
  // house used itself.
  function sunToday(hass, card) {
    var M = model(hass, card), D = M && series(hass, card, M);
    if (!M || !D || !M.src.solar.length) return null;
    var ax = axisOf(D, M);
    if (!ax) return null;
    var today0 = +ax.d[ax.d.length - 1].t, T = { s2h: 0, s2b: 0, s2g: 0, sun: 0 };
    ax.h.forEach(function (p, i) {
      if (+p.t < today0) return;
      var s = M.src, r = powerSplit({ solar: vs(D.h, s.solar, i), imp: vs(D.h, s.imp, i), exp: vs(D.h, s.exp, i), bc: vs(D.h, s.into, i), bd: vs(D.h, s.out, i), home: null });
      T.s2h += r.s2h; T.s2b += r.s2b; T.s2g += r.s2g; T.sun += vs(D.h, s.solar, i);
    });
    return T;
  }
  class HkPowerSunCard extends HkPowerBase {
    static get PART_CSS() {
      var v = window.hkCards.v;
      return [
        'ha-card.ep.psun{--hk-ep-h:270px}',
        '.sg{display:grid;grid-template-columns:1fr;gap:16px;margin-top:16px}',
        '@container (min-width:' + window.hkCards.BP.cardSide + 'px){.sg{grid-template-columns:1fr 1fr;gap:36px}}',
        '.sbar{display:flex;height:16px;border-radius:8px;overflow:hidden;background:' + v('key') + ';margin-top:8px;gap:2px}',
        '.sbar i{display:block;height:100%}',
        '.lg2{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;font-size:13px;color:' + v('ink-2') + '}',
        '.lg2 span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.lg2 span i{width:8px;height:8px;border-radius:50%}',
        '.lg2 b{color:' + v('ink') + ';font-weight:600;font-variant-numeric:tabular-nums}',
        '.say{font-size:15px;line-height:20px;color:' + v('ink-2') + ';margin-top:auto;padding-top:8px}.say b{color:' + v('ink') + '}'
      ].join('');
    }
    _render() {
      this._shell('psun');
      var c = this._config || {}, h = this._hass;
      if (!h) return;
      var g = pw(h, c.grid), gx = pw(h, c.grid_export), bw = batFlow(h, c);
      var r = powerSplit({ solar: pw(h, c.solar), imp: g == null ? 0 : Math.max(0, g), exp: gx != null ? gx : g != null && g < 0 ? -g : 0,
        bc: bw > 0 ? bw : 0, bd: bw < 0 ? -bw : 0, home: pw(h, c.home) });
      var T = sunToday(h, this), bat = !!(c.charge || c.discharge);
      var bar = function (a, kwh) {
        var parts = [['The House', a[0], FLOW.sun], ['Battery', a[1], FLOW.batt], ['The Grid', a[2], FLOW.grid]]
          .filter(function (p) { return p[1] > 0.001 && (p[0] !== 'Battery' || bat); });
        var tot = parts.reduce(function (x, p) { return x + p[1]; }, 0);
        if (tot <= 0.001) return '<div class="sbar"></div><div class="lg2"><span>None</span></div>';
        return '<div class="sbar">' + parts.map(function (p) { return '<i style="width:' + (p[1] / tot * 100).toFixed(2) + '%;background:' + p[2] + '"></i>'; }).join('') + '</div>' +
          '<div class="lg2">' + parts.map(function (p) { return '<span><i style="background:' + p[2] + '"></i>' + p[0] + ' <b>' + (kwh ? fx(p[1], 1) + ' kWh' : wtxt(p[1])) + '</b></span>'; }).join('') + '</div>';
      };
      this._paint('<div class="ttl"><b>' + esc(c.title || 'Where the Sun Goes') + '</b><span>' + (T ? fx(T.sun, 1) + ' kWh today' : '') + '</span></div>' +
        '<div class="sg"><div' + moreAttr(c.solar) + '><div class="k">Right Now</div>' + bar([r.s2h, r.s2b, r.s2g]) + '</div>' +
        (T ? '<div><div class="k">Today</div>' + bar([T.s2h, T.s2b, T.s2g], true) + '</div>' : '') + '</div>' +
        (T && T.sun > 0.05 ? '<div class="say">You used <b>' + Math.round((T.s2h + T.s2b) / T.sun * 100) + '%</b> of today’s sun yourself.</div>' : ''));
    }
  }

  var PWR_SEL = { entity: { filter: { domain: 'sensor' } } };
  register('hk-power-load-card', HkPowerLoadCard, 'HK Power House Load',
    'The whole house now: what the battery backs up, what it does not and a car charging; the three drawing the most.',
    C && [
      { type: 'grid', name: '', schema: [
        { name: 'home', label: 'The whole house (power)', required: true, selector: PWR_SEL },
        { name: 'backed_power', label: 'The battery panel\'s output (power)', selector: PWR_SEL },
        { name: 'grid_status', label: 'Grid up', selector: { entity: { filter: { domain: 'binary_sensor' } } } }
      ] },
      { name: 'devices', selector: { object: {} }, helper: 'Each: {name, power, backed}.' },
      { name: 'link', selector: { text: {} }, helper: 'Optional: where Every device opens, e.g. ./energy.' }
    ],
    function (hass) { return { home: sensorWhere(hass, function (a) { return a.device_class === 'power'; }) }; });
  register('hk-power-sun-card', HkPowerSunCard, 'HK Where the Sun Goes',
    'The sun now and today: to the house, the battery and the grid, in Home Assistant\'s own order.',
    C && [
      { type: 'grid', name: '', schema: [
        { name: 'solar', label: 'The sun (power)', required: true, selector: PWR_SEL },
        { name: 'grid', label: 'The grid (power)', selector: PWR_SEL },
        { name: 'grid_export', label: 'To the grid (power)', selector: PWR_SEL },
        { name: 'home', label: 'The whole house (power)', selector: PWR_SEL },
        { name: 'charge', label: 'Battery charging (power)', selector: PWR_SEL },
        { name: 'discharge', label: 'Battery giving (power)', selector: PWR_SEL }
      ] }
    ],
    function (hass) { return { solar: sensorWhere(hass, function (a) { return a.device_class === 'power'; }) }; });
  register('hk-power-house-card', HkPowerHouseCard, 'HK Power House',
    'The house full width: a layered picture where each part shows only when the house has it, the figures as chips over it, light along the real cables.',
    C && [
      { type: 'grid', name: '', schema: [
        { name: 'home', label: 'The whole house (power)', selector: PWR_SEL },
        { name: 'grid', label: 'The grid (power, in; negative is out)', selector: PWR_SEL },
        { name: 'grid_export', label: 'To the grid (power)', selector: PWR_SEL },
        { name: 'grid_status', label: 'Grid up', selector: { entity: { filter: { domain: 'binary_sensor' } } } },
        { name: 'solar', label: 'The sun (power)', selector: PWR_SEL },
        { name: 'level', label: 'Battery level', selector: PWR_SEL },
        { name: 'charge', label: 'Battery charging (power)', selector: PWR_SEL },
        { name: 'discharge', label: 'Battery giving (power)', selector: PWR_SEL },
        { name: 'reserve', selector: { entity: { filter: [{ domain: 'number' }, { domain: 'input_number' }, { domain: 'sensor' }] } } }
      ] },
      { name: 'cars', selector: { object: {} }, helper: 'Each car: {name, level, power, home, plugged, charge}.' },
      { name: 'chargers', selector: { object: {} }, helper: 'Optional: the wall chargers\' power sensors -- live, where a car\'s own reading lags.' },
      { name: 'art', label: 'Picture folder', selector: { text: {} }, helper: 'A folder of your files with art.json and its layers, e.g. /hk/art/my-house/. Empty: the house that comes with HK Frontend.' }
    ],
    function (hass) { return { home: sensorWhere(hass, function (a) { return a.device_class === 'power'; }) }; });
  register('hk-power-flow-card', HkPowerFlowCard, 'HK Power Flow',
    'Right now: from the grid, the house and the battery, over a picture of the house (or as a flow chart).',
    C && [
      { type: 'grid', name: '', schema: [
        { name: 'grid', label: 'From the grid (power)', selector: PWR_SEL },
        { name: 'home', label: 'The house (power)', selector: PWR_SEL },
        { name: 'level', label: 'Battery level', selector: PWR_SEL },
        { name: 'grid_status', label: 'Grid up', selector: { entity: { filter: { domain: 'binary_sensor' } } } },
        { name: 'charge', label: 'Battery charging (power)', selector: PWR_SEL },
        { name: 'discharge', label: 'Battery giving (power)', selector: PWR_SEL }
      ] },
      { name: 'art', label: 'House picture', selector: { text: {} }, helper: 'Leave empty for the flow chart. The overlay is laid out for one particular house picture, not any picture.' },
      { name: 'title', selector: { text: {} } }
    ],
    function (hass) { return { home: sensorWhere(hass, function (a) { return a.device_class === 'power'; }) }; });
  register('hk-power-status-card', HkPowerStatusCard, 'HK Power Status',
    'The home battery system in sentences: a grid outage or fault first, then the source, the backup, EPS and Storm Mode.',
    C && [
      { type: 'grid', name: '', schema: [
        { name: 'grid_status', label: 'Grid up', selector: { entity: { filter: { domain: 'binary_sensor' } } } },
        { name: 'problem', label: 'Fault', selector: { entity: { filter: { domain: 'binary_sensor' } } } },
        { name: 'level', label: 'Battery level', selector: PWR_SEL },
        { name: 'backup', label: 'Backup runtime', selector: PWR_SEL },
        { name: 'home', label: 'The house (power)', selector: PWR_SEL },
        { name: 'charge', label: 'Battery charging (power)', selector: PWR_SEL },
        { name: 'discharge', label: 'Battery giving (power)', selector: PWR_SEL },
        { name: 'eps', label: 'EPS', selector: { entity: { filter: [{ domain: 'switch' }, { domain: 'binary_sensor' }] } } },
        { name: 'storm', label: 'Storm Mode', selector: { entity: { filter: [{ domain: 'switch' }, { domain: 'binary_sensor' }] } } },
        { name: 'solar', label: 'The sun (power)', selector: PWR_SEL },
        { name: 'grid', label: 'The grid (power)', selector: PWR_SEL }
      ] },
      { name: 'cars', selector: { object: {} }, helper: 'Each car: {name, level, power, plugged}.' }
    ],
    function (hass) { return { level: sensorWhere(hass, function (a) { return a.device_class === 'battery'; }) }; });
  register('hk-house-battery-card', HkHouseBatteryCard, 'HK House Battery',
    'A home battery as a battery: its level with the reserve and limit marked, its packs, EPS and charging speed.',
    C && [
      { type: 'grid', name: '', schema: [
        { name: 'level', label: 'Battery level', required: true, selector: PWR_SEL },
        { name: 'stored', label: 'Energy stored', selector: PWR_SEL },
        { name: 'backup', label: 'Backup runtime', selector: PWR_SEL },
        { name: 'reserve', selector: { entity: { filter: [{ domain: 'number' }, { domain: 'input_number' }, { domain: 'sensor' }] } } },
        { name: 'limit', selector: { entity: { filter: [{ domain: 'number' }, { domain: 'input_number' }, { domain: 'sensor' }] } } },
        { name: 'speed', label: 'Charging speed', selector: { entity: { filter: [{ domain: 'number' }, { domain: 'sensor' }] } } },
        { name: 'charge', label: 'Battery charging (power)', selector: PWR_SEL },
        { name: 'discharge', label: 'Battery giving (power)', selector: PWR_SEL },
        { name: 'eps', label: 'EPS', selector: { entity: { filter: [{ domain: 'switch' }, { domain: 'binary_sensor' }] } } }
      ] },
      { name: 'packs', selector: { object: {} }, helper: 'Each pack: {name, level, temperature}.' },
      { name: 'title', selector: { text: {} } }
    ],
    function (hass) { return { level: sensorWhere(hass, function (a) { return a.device_class === 'battery'; }) }; });
  register('hk-segment-card', HkSegmentCard, 'HK Segmented Choice',
    'A select\'s options as a segmented control, with a line saying what the chosen one does.',
    C && [
      { name: 'entity', required: true, selector: { entity: { filter: [{ domain: 'select' }, { domain: 'input_select' }] } } },
      { name: 'options', selector: { object: {} }, helper: 'Optional: [{value, name, description}], in order. Empty: the select\'s own.' }
    ],
    function (hass) { return { entity: firstOf(hass, 'select') || firstOf(hass, 'input_select') }; });

  // THE PAGE'S API FOR THE TILES AND HEADINGS (hk-stat.js): the tab, the lit
  // section, and a device's figures for the tab -- one shared request.
  EP.__powerSplit = function (r) { return powerSplit(r); };
  // the tests hand the picture its art.json (no fetch there)
  EP.__art = function (base, json) { ART[base] = { json: json, wait: [] }; };
  Object.assign(EP, {
    period: EP.period, plan: plan, getPeriod: period, setPeriod: setPeriod, setPick: setPick, setBack: setBack,
    join: function (card) { EP.cards.add(card); },
    getModel: function (hass, card) { return model(hass, card); },
    // { v, unit, line[], usual, cmp } for one tile on the current tab; null
    // while its numbers load
    tile: function (hass, card, cfg) {
      var M = model(hass, card);
      if (!M) return null;
      var p = PERIODS.indexOf(cfg.period) >= 0 ? cfg.period : period();
      var dev = M.devs.filter(function (d) { return (cfg.stat && d.stat === cfg.stat) || (cfg.power && d.power === cfg.power); })[0];
      var RT = dev && dev.runtime ? runtimes(hass, card, M) : null;
      if (p === 'now') {
        var five = cfg.power ? live(hass, card, M) : null, ra = RT && RT[dev.runtime], last = ra && ra[ra.length - 1];
        return { line: five && five[cfg.power] ? five[cfg.power].map(function (q) { return q.v; }) : null,
                 ran: last && typeof last.v === 'number' ? hm(last.v) + ' today' : null };
      }
      var D = series(hass, card, M);
      if (!D) return null;
      var R = calcFor(M, D, p, runtimes(hass, card, M));
      if (!R || !cfg.stat) return null;
      var row = R.devices.filter(function (r) { return r.d.stat === cfg.stat; })[0];
      var val = row ? row.v : sum(R.idx.map(function (i) { return v(R.ser, cfg.stat, i); }));
      // the line: the 14 days up to the period's last (today, or a past
      // week's or month's own end)
      var usual = row ? row.usual : 0, n = D.d[cfg.stat] ? D.d[cfg.stat].length : 0, line = [];
      var end = R.idx && R.idx.length && R.per !== 'day' ? R.idx[R.idx.length - 1] + 1 : n;
      for (var i = Math.max(0, end - 14); i < end; i++) line.push(v(D.d, cfg.stat, i));
      var k = val / Math.max(0.01, usual * R.n * R.pshare), pct = Math.round(100 * (k - 1)), when = whenOf(p, R);
      var cmp = usual < 0.05 ? (val < 0.05 ? 'Off ' + when : 'Rarely used')
        : val < 0.05 ? 'Not used ' + when
        : Math.abs(pct) < 12 ? 'About usual'
        : '<b class="' + (pct > 0 ? 'up' : 'down') + '">' + (pct > 0 ? '↑ ' : '↓ ') + Math.abs(pct) + '%</b> vs usual';
      // A RUNTIME TELLS MORE THAN ITS kWh: "Ran 1h 55m · ↓ 40%", against its usual hours
      if (row && row.rt) {
        var rk = row.rt.v / Math.max(0.01, row.rt.usual * R.n * R.pshare), rp = Math.round(100 * (rk - 1));
        cmp = 'Ran ' + hm(row.rt.v) + (row.rt.usual < 0.05 || Math.abs(rp) < 12 ? '' : ' \u00b7 <b class="' + (rp > 0 ? 'up' : 'down') + '">' +
          (rp > 0 ? '\u2191 ' : '\u2193 ') + Math.abs(rp) + '%</b>');
      }
      return { v: val, line: line, usual: usual, cmp: cmp };
    },
    // a section's total on the tab: watts now, or kWh
    section: function (hass, card, id, per) {
      var M = model(hass, card);
      if (!M) return null;
      var sec = M.sections.filter(function (s) { return s.id === id; })[0];
      if (!sec) return null;
      var p = PERIODS.indexOf(per) >= 0 ? per : period();
      if (p === 'now') {
        var on = sec.items.filter(function (d) { return d.counted && d.power; });
        if (!on.length) return { color: sec.color, text: '' };
        return { color: sec.color, text: watts(sum(on.map(function (d) { return Math.max(0, wattsNow(hass, d.power) || 0); }))).join(' ') + ' now' };
      }
      var D = series(hass, card, M);
      if (!D) return { color: sec.color, text: '' };
      var R = calcFor(M, D, p, runtimes(hass, card, M)), row = R && R.secs.filter(function (s) { return s.s === sec; })[0];
      if (!row || !sec.items.some(function (d) { return d.counted; })) return { color: sec.color, text: '' };
      return { color: sec.color, text: kwh(row.v) + ' kWh ' + whenOf(p, R) };
    },
    lineSvg: lineSvg, restartAnim: restartAnim,
    // a meter's kWh so far today, from the page's statistics (null while they load)
    todayOf: function (hass, card, stat) {
      var M = model(hass, card), D = M && M.ids.indexOf(stat) >= 0 ? series(hass, card, M) : null;
      var a = D && D.d[stat], last = a && a[a.length - 1];
      return last && typeof last.v === 'number' ? last.v : (D ? 0 : null);
    },
    // a section's color, for a tile's line
    sectionColor: function (id) {
      var M = EP.cache, s = M && M.sections && M.sections.filter(function (x) { return x.id === id; })[0];
      return s ? s.color : null;
    },
    // TEST SEAMS
    __calc: calc, __buildModel: buildModel, __contributor: contributor, __hm: hm, __sources: sourcesOf, __highlights: highlights
  });

  var ROW = [
    { name: 'height', selector: { text: {} }, helper: 'CSS height, e.g. 320px. Empty: the page\'s own.' }
  ];
  register('hk-energy-period-card', HkEnergyPeriodCard, 'HK Energy Tabs',
    'Now, Today, This Week and This Month for every HK energy card on the page.',
    C && [{ name: 'opens_on', label: 'Opens On', selector: { select: { mode: 'dropdown', options: [
      { value: 'now', label: 'Now' }, { value: 'day', label: 'Today' },
      { value: 'week', label: 'This Week' }, { value: 'month', label: 'This Month' }] } },
      helper: 'The tab the page shows first. Empty: HK Settings → Energy\'s Opens On.' }],
    function () { return {}; });
  register('hk-energy-hero-card', HkEnergyHeroCard, 'HK Energy Summary',
    'Now: the whole home\'s power and the last three hours. Today, This Week, This Month: rings against a usual day.', C && ROW, function () { return {}; });
  register('hk-energy-highlights-card', HkEnergyHighlightsCard, 'HK Energy Highlights',
    'What stood out, in four sentences: the busiest hour, a device above its usual, the battery, the biggest section.', C && ROW, function () { return {}; });
  register('hk-energy-where-card', HkEnergyWhereCard, 'HK Energy Where It Went',
    'One bar of the house\'s energy (or power, on Now) by section. Tap a section to light it on the page.', C && ROW, function () { return {}; });
  register('hk-energy-day-card', HkEnergyDayCard, 'HK Energy Your Day',
    'The day as a clock, the week as bars, the month as a calendar against a usual day.', C && ROW, function () { return {}; });
  register('hk-energy-battery-card', HkEnergyBatteryCard, 'HK Energy House Battery',
    'The house battery: its level now, and what it charged and gave back.', C && ROW, function () { return {}; });
  register('hk-energy-water-card', HkEnergyWaterCard, 'HK Energy Water',
    'Water (or gas) from Home Assistant\'s Energy settings, against a usual day, with the tab\'s own bars.',
    C && [{ name: 'source', selector: C.selOptions ? C.selOptions(['water', 'gas']) : { text: {} } }].concat(ROW),
    function () { return { source: 'water' }; });

  // THE SCREENSAVER'S HOME ENERGY reads the page's sums and draws its rings
  // (hk-saver-energy.js)
  window.hkEnergy = { version: '1.0.0', summary: summary, ringSvg: ringSvg, sweepRings: sweepRings,
                      fx: fx, kwh: kwh, watts: watts, esc: esc };
  // the tiles and headings (hk-stat.js) that drew before this file ran
  try { window.dispatchEvent(new CustomEvent('hk-energy-ready')); } catch (e) {}
  });
})();
