// hk-energy-usage.js - the usage tile, the live trace and the battery strip.
//
// PART OF THE ENERGY CARDS (hk-energy.js). Not a card and not run on its own: it registers one
// function, which hk-energy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkEnergyParts = window.hkEnergyParts || {})['hk-energy-usage'] = function (K) {
    var barChart = K.barChart, colorOf = K.colorOf, firstOf = K.firstOf, HkBase = K.HkBase, HOUR = K.HOUR,
        lineSvg = K.lineSvg, NAMED = K.NAMED, timeLabels = K.timeLabels;

    // THE PICKER'S STARTER SENSOR, BY KIND. firstOf(client, 'sensor') is the
    // first sensor of any kind -- a media player's bitrate shown as a battery.
    // Each test is tried in turn (best first); the first sensor passing one
    // wins, and with none of them it is the first sensor, as before.
    function sensorWhere(client) {
      var tests = Array.prototype.slice.call(arguments, 1);
      var st = (client && client.states) || {}, ids = Object.keys(st);
      for (var t = 0; t < tests.length; t++) {
        for (var i = 0; i < ids.length; i++) {
          if (ids[i].indexOf('sensor.') !== 0) continue;
          if (tests[t]((st[ids[i]] && st[ids[i]].attributes) || {})) return ids[i];
        }
      }
      return firstOf(client, 'sensor');
    }

    // ----------------------------------------------------------- hk-usage
    //
    // A DAILY COMPARISON: a caption, a headline figure, a sentence saying how
    // this compares with the usual, and a fortnight of bars under it. Used on
    // the energy and weather pages.
    //
    // hk-charts.js reads the data -- hkChart.usage(client, stat, card, opts)
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
          'hk-plate.usage{box-sizing:border-box;display:block;',
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
      // the client's states at all -- so the default signature would gate out exactly
      // the update this card exists to show. `entity` is the live sensor and
      // moves often enough to keep the tile current; hkChart caches the
      // statistics and calls requestUpdate when a fetch lands.
      _sigOf() {
        var h = this.client, c = this._config;
        if (!h || !c) return null;
        var s = h.states[c.entity || c.stat];
        return (s ? s.last_updated : 'x') + '|' + (window.hkChart ? '1' : '0');
      }

      // More info opens `entity`, or the statistic's own sensor when there is
      // no `entity` -- what the editor promises. A statistic that is not an
      // entity (an external "domain:id" one) has no dialog to open, so it is
      // left as before.
      _act(spec, defaultMoreInfo) {
        var cfg = this._config || {}, h = this.client;
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
            '<hk-plate class="usage' + (cfg.align === 'center' ? ' mid' : '') +
            '" data-hk-role="card"><div class="grid">' +
            '<div class="nm" data-hk-role="nm"></div>' +
            '<div class="val" data-hk-role="val"></div>' +
            '<div class="sub" data-hk-role="sub"></div>' +
            '<div class="chart" data-hk-role="chart"></div>' +
            '</div></hk-plate>';
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

        var u = (window.hkChart && this.client)
          ? window.hkChart.usage(this.client, cfg.stat, this, cfg.opts || {})
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
          'hk-plate.trace{box-sizing:border-box;display:block;',
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
        var h = this.client, c = this._config;
        if (!h || !c) return null;
        var s = h.states[c.entity];
        return (s ? s.last_updated : 'x') + '|' + (window.hkChart ? '1' : '0');
      }
      _render() {
        var cfg = this._config;
        if (!this._built) {
          this._root.innerHTML =
            '<hk-plate class="trace" data-hk-role="card"><div class="grid">' +
            '<div class="ttl" data-hk-role="ttl"></div>' +
            '<div class="sub" data-hk-role="sub"></div>' +
            '<div class="val" data-hk-role="val"></div>' +
            '<div class="body" data-hk-role="body"></div>' +
            '</div></hk-plate>';
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
        var r = (window.hkChart && this.client)
          ? window.hkChart.recent(this.client, cfg.entity, this, cfg.trace || {})
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
          'hk-plate.strip2{box-sizing:border-box;display:block;',
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
        var h = this.client, c = this._config;
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
            '<hk-plate class="strip2" data-hk-role="card">' +
            '<div class="head"><div class="ttl" data-hk-role="ttl"></div>' +
            '<div class="read"><span class="kwh" data-hk-role="kwh"></span>' +
            '<span class="soc" data-hk-role="soc"></span></div></div>' +
            '<div class="body" data-hk-role="body"></div>' +
            '</hk-plate>';
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
        if (C && this.client && cfg.discharge) {
          dis = C.power(this.client.states, cfg.discharge, { watts: true, fallback: null });
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

    // what the shell and the later parts use of this one
    K.HkBatteryStripCard = HkBatteryStripCard; K.HkTraceCard = HkTraceCard; K.HkUsageCard = HkUsageCard;
    K.sensorWhere = sensorWhere;
  };
})();
