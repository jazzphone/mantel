// hk-energy-rings.js - the Energy Rings block.
//
// PART OF THE ENERGY CARDS (hk-energy.js). Not a card and not run on its own: it registers one
// function, which hk-energy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkEnergyParts = window.hkEnergyParts || {})['hk-energy-rings'] = function (K) {
    var blockBox = K.blockBox, esc = K.esc, fx = K.fx, HkBase = K.HkBase, plan = K.plan, ringSvg = K.ringSvg,
        summary = K.summary, sweepRings = K.sweepRings, WIDGET_CSS = K.WIDGET_CSS;

    // ================================================= THE ENERGY RINGS BLOCK
    // (2026-10-31, the owner's mock-up, "Energy Rings (new)"): the Energy page's
    // rings, the Activity rings' way, on a Home Grid block -- Energy, Cost,
    // Solar, Water and Gas where the house has them (four at most, the plan's
    // choice), each against a usual period, a white dot where the usual is by
    // now, a second lap past it. The numbers are the page's own (summary():
    // the same sums, so the two never disagree). Today, This Week or This
    // Month: the block's `period` is where it starts, and the switch in its top
    // right corner (Tall: across the top) changes it in place -- the block's
    // own, never the page's tab. Small has no switch: a tap moves it on.
    //   S   the rings, and the period under them
    //   W   the rings, and each figure beside them
    //   T   the switch, the rings and the figures, evenly spaced
    //   L   the switch; the rings centred under it; the figures two by two
    //   XL  the rings on the left; the figures two by two, centred with them,
    //       and the period so far with where its cost is heading
    var RING_PERIODS = [['day', 'Today'], ['week', 'Week'], ['month', 'Month']];
    var RINGS_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.er{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;',
      '  padding:' + window.hkCards.blockPad('14px') + ';' + window.hkCards.plate('card') + ';color:' + window.hkCards.v('ink') + ';',
      '  -webkit-tap-highlight-color:transparent}',
      'hk-plate.er[role=button]{cursor:pointer}',
      WIDGET_CSS,
      '.rings{display:block;flex:none}.rings .tick{fill:#fff;filter:drop-shadow(0 0 2px rgba(0,0,0,.55))}',
      // THE SWITCH: three choices on a track, the chosen one white; each a
      // 44 px target (its ::after reaches above and below the 30 px pill); Tall's, nothing stretching (2026-11-08): each as wide as its word, centered
      '.per{display:flex;gap:2px;padding:3px;border-radius:' + window.hkCards.R.capsule('33px') + ';background:' + window.hkCards.v('key') + ';flex:none;z-index:1}',
      '.per button{all:unset;position:relative;box-sizing:border-box;min-width:46px;padding:5px 11px;border-radius:' + window.hkCards.R.capsule('27px') + ';text-align:center;cursor:pointer;',
      '  ' + window.hkCards.typeCss('caption') + ';font-weight:600;line-height:17px;color:' + window.hkCards.v('ink-2') + '}',
      '.per button::after{content:"";position:absolute;top:-9px;bottom:-9px;left:-1px;right:-1px}',
      '.per button[aria-pressed=true]{background:#fff;color:#1c1c1e}',
      '.per button:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}',
      '.per.tr{position:absolute;top:var(--hk-pad-t,14px);right:var(--hk-pad-r,14px)}',
      '.per.sm{align-self:center}.per.sm button{flex:none;min-width:0;padding:5px 7px}',
      // the figures: a dot in the ring's color, the name, the amount
      '.ev{display:flex;flex-direction:column;gap:5px;min-width:0}',
      '.ev>div{display:grid;grid-template-columns:10px minmax(0,1fr) auto;column-gap:8px;align-items:center}',
      '.ev i{width:10px;height:10px;border-radius:50%}',
      '.ev b{' + window.hkCards.typeCss('body') + ';font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ev span{' + window.hkCards.typeCss('body') + ';font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}',
      '.wgrid span em{font-style:normal;font-size:.55em;font-weight:600;color:' + window.hkCards.v('ink-2') + ';margin-left:2px}',
      '.wgrid small{' + window.hkCards.typeCss('caption') + ';color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.wgrid.c>div{align-items:center;text-align:center}',
      '.er-s{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex:1;min-height:0}',
      '.er-s small{' + window.hkCards.typeCss('caption') + ';color:' + window.hkCards.v('ink-2') + '}',
      '.er-w{display:flex;align-items:center;gap:20px;flex:1;min-height:0}.er-w .ev{flex:1;padding-top:30px}',
      '.er-t{display:flex;flex-direction:column;align-items:center;justify-content:space-between;flex:1;min-height:0}.er-t .ev{align-self:stretch}',
      '.er-l{display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;flex:1;min-height:0;padding-top:30px}.er-l .wgrid{align-self:stretch}',
      '.er-x{display:flex;align-items:center;gap:30px;flex:1;min-height:0}.er-x>.wcol{flex:1;justify-content:center}',
      '.er-x .wgrid span{font-size:30px;letter-spacing:-0.6px}.er-l .wgrid span{font-size:22px}',
      '.so{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:16px;padding-top:12px;border-top:1px solid ' + window.hkCards.v('line') + '}',
      '.so b{' + window.hkCards.typeCss('headline') + ';white-space:nowrap}.so small{' + window.hkCards.typeCss('caption') + ';color:' + window.hkCards.v('ink-2') +
        ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.wait{margin:auto;' + window.hkCards.typeCss('caption') + ';color:' + window.hkCards.v('ink-2') + ';text-align:center}'
    ].join('');
    // the rings' width and step in px at a size (the mock-up's: 14 px rings
    // 3 px apart, 18 on the largest), in the 220 viewBox's units
    function ringFit(px) {
      var w = px > 180 ? 18 : 14, k = 220 / px;
      return { w: w * k, step: (w + 3) * k, r0: 110 - (w / 2 + 2) * k };
    }
    class HkEnergyRingsCard extends HkBase {
      static get CSS() { return RINGS_CSS; }
      // (a block's tap, hk-base.js openTarget) Energy. Small is its own switch (a tap changes the period): its whole
      // plate is a button
      _tapTarget() { return this._cellSize() === 'S' ? [] : [{ page: 'energy' }]; }
      getCardSize() { return 4; }
      setConfig(config) {
        super.setConfig(config);
        var p = (config || {}).period;
        this._period = RING_PERIODS.some(function (x) { return x[0] === p; }) ? p : 'day';
      }
      // the period, the size and the minute: the sums move on with the clock;
      // their statistics landing (hk-stats) and the page's settings (prefs)
      // wake the card on their own
      _sigOf() { return JSON.stringify([this._period, this._cellSize(), this._blockKey || '', Math.floor(Date.now() / 60e3), !!plan()]); }
      _render() {
        var size = this._cellSize() || 'L', h = this.client;
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="er" data-hk-role="card"></hk-plate>';
          this._card = this._root.querySelector('hk-plate');
          var self = this;
          this._card.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('button[data-p]');
            if (b) { e.stopPropagation(); self._pick(b.getAttribute('data-p')); return; }
            if (self._cellSize() === 'S') self._pick(null);
          });
          this._card.addEventListener('keydown', function (e) {
            if (e.target === self._card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); self._pick(null); }
          });
          this._built = true;
          this._ringWas = null;
        }
        var b = blockBox(this, size), card = this._card;
        card.className = 'er ' + size;
        var small = size === 'S';
        if (small) {
          card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0');
        } else { card.removeAttribute('role'); card.removeAttribute('tabindex'); }
        var s = null;
        // (`_clock`: a test's own time)
        try { s = h ? summary(h, this, this._clock ? +this._clock() : undefined) : null; } catch (e) { console.warn('[hk-energy-rings]', e && e.message); s = null; }
        var per = s && s.periods && s.periods[this._period];
        if (!per) {
          card.removeAttribute('aria-label');
          window.hkCards.morph(card, '<div class="wl">Energy</div><div class="wait">' +
            (plan() ? 'Loading…' : 'Add Energy in Settings to show its rings here.') + '</div>');
          return;
        }
        var p = this._period, name = { day: 'Today', week: 'This Week', month: 'This Month' }[p];
        var list = per.rings.map(function (r) { return { key: r.key, c: r.c, f: r.typ > 0 ? r.v / r.typ : 0, tick: r.typ > 0 && r.tick < 1 ? r.tick : null }; });
        var amount = function (r, unitEm) {
          if (r.key === 'cost') return esc(s.money(r.v, 2));
          var val = r.key === 'water' || r.key === 'gas' ? fx(r.v, 0) : fx(r.v, Math.abs(r.v) >= 100 ? 0 : 1);
          return val + (r.unit ? (unitEm ? '<em>' + esc(r.unit) + '</em>' : ' ' + esc(r.unit)) : '');
        };
        var usual = function (r) { return r.typ > 0 ? Math.round(100 * r.v / r.typ) + '% of usual' : 'Learning your usual'; };
        var rings = function (px) { return '<div style="width:' + px + 'px;height:' + px + 'px;flex:none">' +
          ringSvg(list, null, 0, ringFit(px)).replace('class="rings"', 'class="rings" width="' + px + '" height="' + px + '"') + '</div>'; };
        var sw = function (cls) {
          return '<div class="per ' + cls + '" role="group" aria-label="Period">' + RING_PERIODS.map(function (x) {
            return '<button type="button" data-p="' + x[0] + '" aria-pressed="' + (x[0] === p) + '">' + x[1] + '</button>';
          }).join('') + '</div>';
        };
        var evals = function () {
          return '<div class="ev">' + per.rings.map(function (r) {
            return '<div><i style="background:' + r.c + '"></i><b>' + esc(r.name) + '</b><span>' + amount(r, false) + '</span></div>';
          }).join('') + '</div>';
        };
        var grid = function (cls) {
          return '<div class="wgrid ' + cls + '">' + per.rings.map(function (r) {
            return '<div><b><i style="background:' + r.c + '"></i>' + esc(r.name) + '</b><span>' + amount(r, true) + '</span><small>' + usual(r) + '</small></div>';
          }).join('') + '</div>';
        };
        var html, evH = per.rings.length * 23, grH = Math.ceil(per.rings.length / 2);
        if (small) {
          html = '<div class="er-s">' + rings(Math.max(60, Math.min(b.iw, b.ih - 22))) + '<small>' + name + '</small></div>';
        } else if (size === 'W') {
          html = '<div class="er-w">' + rings(Math.max(80, Math.min(b.ih, Math.round(b.iw * 0.45)))) + evals() + '</div>' + sw('tr');
        } else if (size === 'T') {
          html = '<div class="er-t">' + sw('sm') + rings(Math.max(80, Math.min(b.iw - 6, b.ih - 34 - evH - 24))) + evals() + '</div>';
        } else if (size === 'L') {
          // the figures two by two under the rings: 2 rows of label, amount and line
          html = sw('tr') + '<div class="er-l">' + rings(Math.max(80, Math.min(170, b.ih - 30 - grH * 57 - 12 - 12))) + grid('c') + '</div>';
        } else {
          var head = per.heading, toward = head.cost != null ? s.money(head.cost, p === 'day' ? 2 : 0) : fx(head.energy, p === 'day' ? 1 : 0) + ' kWh';
          var soFar = (p === 'month' ? per.name : name) + ' so far';
          html = sw('tr') + '<div class="er-x">' + rings(Math.max(120, Math.min(250, b.ih, Math.round(b.iw * 0.45)))) +
            '<div class="wcol">' + grid('') + '<div class="so"><b>' + esc(soFar) + '</b><small>Heading for ' + esc(toward) + '</small></div></div></div>';
        }
        card.setAttribute('aria-label', 'Energy rings, ' + name + ': ' + per.rings.map(function (r) { return r.name + ' ' + amount(r, false).replace(/<[^>]+>/g, '') + ', ' + usual(r); }).join('; ') +
          (small ? '. Tap for ' + { day: 'this week', week: 'this month', month: 'today' }[p] : ''));
        window.hkCards.morph(card, html);
        // THE RINGS SWEEP IN as the page's do: from nothing on a new period,
        // from where they were on an update
        this._ringWas = sweepRings(card, this._ringWas, this._ringFor !== p);
        this._ringFor = p;
      }
      // a period chosen (or, on Small, the next one)
      _pick(p) {
        var i = RING_PERIODS.map(function (x) { return x[0]; }).indexOf(this._period);
        var next = p || RING_PERIODS[(i + 1) % RING_PERIODS.length][0];
        if (next === this._period) return;
        this._period = next;
        this.redraw();
      }
    }

    var ROW = [
      { name: 'height', selector: { text: {} }, helper: 'CSS height, e.g. 320px. Empty: the page\'s own.' }
    ];

    // what the shell and the later parts use of this one
    K.HkEnergyRingsCard = HkEnergyRingsCard; K.ROW = ROW;
  };
})();
