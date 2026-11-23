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
    // own, never the page's tab.
    //   S   the period in the upper left (the owner, 2026-11-12: "It should be at the top left"), a tap on it moves
    //       it on, and the rings under it; a tap anywhere else lays a box of the
    //       figures over the foot of the rings (2026-11-12, the owner: "an overlay box over the ring that displayed
    //       what you had on the back of the turn it over card"; "Why is there a blur? And we only need it over the
    //       Energy / Cost / Water / Gas portion"; after white boxes, "maybe black box, but lighter than before with white
    //       text" -- he chose 62 %): each ring's dot, name and figure, no blur, as tall as its rows; a tap, or eight
    //       seconds, takes it away. Its Figures option Always (the owner, the same day: "an option to always show the
    //       data, not just on tap") keeps the box up; a tap anywhere but the period does the block's When Tapped
    //   W   the rings, and each figure beside them
    //   T   the switch, the rings and the figures, evenly spaced
    //   L   the switch; the rings centred under it; the figures two by two
    //   XL  the rings on the left; the figures two by two, centred with them,
    //       and the period so far with where its cost is heading
    var RING_PERIODS = [['day', 'Today'], ['week', 'Week'], ['month', 'Month']];
    var CHEV =
      '<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round"/></svg>';
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
      '.per button[aria-pressed=true]{background:#fff;color:#1c1c1e;text-shadow:none}',
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
      '.er-s{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex:1;min-height:0}.er-s .oh{align-self:flex-start}',
      '.er-s small{' + window.hkCards.typeCss('caption') + ';color:' + window.hkCards.v('ink-2') + '}',
      // SMALL'S BOX OF FIGURES: the floating strip's dark (OVER.float, 62 %: the owner's pick over the solid overlay's 93
      // and the overlay's 52), the rings through it, no blur -- the scale's value, not the look's --hk-float-plate (Bright
      // Glass makes that a faint wash, and the words sat on the rings), so its words are the dark table's white in every
      // look; as tall as its rows, at the foot of the block, its words 12 px in from its sides (the owner: "more edge
      // buffer") and 8 from its top and foot, its corner concentric with the plate's
      '.ov{position:absolute;left:calc(var(--hk-pad-l,14px) - 6px);right:calc(var(--hk-pad-r,14px) - 6px);bottom:calc(var(--hk-pad-b,14px) - 6px);',
      '  box-sizing:border-box;padding:8px 12px;background:' + window.hkCards.OVER.float + ';',
      '  opacity:0;transform:translateY(6px);pointer-events:none;',
      '  transition:opacity ' + window.hkCards.DUR.fade + ' ease,transform ' + window.hkCards.DUR.standard + ' ' + window.hkCards.EASE.standard + '}',
      '.ov.on{opacity:1;transform:none;pointer-events:auto}',
      '.ov .ev{gap:4px}.ov .ev b,.ov .ev span{color:' + window.hkCards.T.ink + '}',
      // the period over the rings, upper left, a button: the word and a chevron, its target 44 px tall
      '.oh{all:unset;position:relative;display:flex;align-items:center;gap:5px;cursor:pointer;' + window.hkCards.typeCss('caption') + ';',
      '  line-height:16px;color:' + window.hkCards.v('ink-2') + '}',
      '.oh::after{content:"";position:absolute;left:-10px;right:-10px;top:-14px;bottom:-14px}',
      '.oh:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:3px;border-radius:' + window.hkCards.R.small + 'px}',
      // (Always: the box is there from the start, never moving in)
      '.ov.fix{transition:none}',
      '@media (prefers-reduced-motion: reduce){.ov{transition:none;transform:none}}',
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
      // (a block's tap, hk-base.js openTarget) Energy. Small is its own control (a tap shows its figures over the
      // rings): its whole plate is a button -- unless its figures are always shown
      // (the kit's Small is the rings and one line, no box of figures to open: its tap is the block's When Tapped too)
      _tapTarget() { return this._cellSize() === 'S' && !this._always && !window.hkKit ? [] : [{ page: 'energy' }]; }
      getCardSize() { return 4; }
      setConfig(config) {
        super.setConfig(config);
        var p = (config || {}).period;
        this._period = RING_PERIODS.some(function (x) { return x[0] === p; }) ? p : 'day';
        this._always = (config || {}).figures === 'always';
      }
      // the period, the size and the minute: the sums move on with the clock;
      // their statistics landing (hk-stats) and the page's settings (prefs)
      // wake the card on their own
      _sigOf() { return JSON.stringify([this._period, this._cellSize(), this._blockKey || '', Math.floor(Date.now() / 60e3), !!plan()]); }
      _render() {
        var size = this._cellSize() || 'L', h = this.client;
        // (the kit's card, hk-kit.js; the older drawing below only where the kit draws none)
        if (window.hkKit && window.hkKit.on(this)) { if (this._renderKit(size)) return; } else if (window.hkKit) window.hkKit.forget(this);
        // (back from the kit's drawing: this plate was replaced in the root)
        if (this._card && this._card.parentNode !== this._root) this._built = false;
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="er" data-hk-role="card"></hk-plate>';
          this._card = this._root.querySelector('hk-plate');
          var self = this;
          this._card.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('button[data-p]');
            if (b) { e.stopPropagation(); self._pick(b.getAttribute('data-p')); return; }
            if (self._cellSize() === 'S' && !self._always) self._show(!self._open);
          });
          this._card.addEventListener('keydown', function (e) {
            if (e.target === self._card && !self._always && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); self._show(!self._open); }
          });
          this._built = true;
          this._ringWas = null;
        }
        var b = blockBox(this, size), card = this._card;
        card.className = 'er ' + size;
        var small = size === 'S', always = small && this._always;
        if (small && !always) {
          card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0'); card.setAttribute('aria-expanded', String(!!this._open));
        } else { card.removeAttribute('role'); card.removeAttribute('tabindex'); card.removeAttribute('aria-expanded'); this._open = false; clearTimeout(this._ovT); }
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
          // the figure alone in the box, as the back of the mock-up's card had it (the unit is the ring's: its name says it)
          var bare = function (r) { return r.key === 'cost' ? esc(s.money(r.v, 2)) : r.key === 'water' || r.key === 'gas' ? fx(r.v, 0) : fx(r.v, Math.abs(r.v) >= 100 ? 0 : 1); };
          var next = { day: 'week', week: 'month', month: 'day' }[p], open = always || !!this._open;
          html = '<div class="er-s"><button type="button" class="oh" data-p="' + next + '" aria-label="' + name + '. Show ' +
            { day: 'today', week: 'this week', month: 'this month' }[next] + '">' + name + CHEV + '</button>' + rings(Math.max(60, Math.min(b.iw, b.ih - 22))) + '</div>' +
            '<div class="ov' + (open ? ' on' : '') + (always ? ' fix' : '') + '" style="border-radius:' + (b.pad >= 18 ? window.hkCards.R.square - 12 : window.hkCards.R.inner) + 'px"' +
            (open ? '' : ' aria-hidden="true"') + '>' +
            '<div class="ev">' + per.rings.map(function (r) {
              return '<div><i style="background:' + r.c + '"></i><b>' + esc(r.name) + '</b><span>' + bare(r) + '</span></div>';
            }).join('') + '</div></div>';
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
          (small && !always ? '. Tap to ' + (this._open ? 'hide' : 'show') + ' the figures' : ''));
        window.hkCards.morph(card, html);
        // THE RINGS SWEEP IN as the page's do: from nothing on a new period,
        // from where they were on an update
        this._ringWas = sweepRings(card, this._ringWas, this._ringFor !== p);
        this._ringFor = p;
      }
      // THE KIT'S CARD (phase 34, round 12; hk-kit.js): the Fitness app's rings, the house's own -- today's rings (the same set, colors and
      // meanings: Energy, Cost, Solar, Water, Gas against a usual period, a white dot where the usual is by now, a second lap past it), each
      // ring's figure in its own color as Fitness writes them ("16.2/20 KWH": the value in semibold, the usual and the unit smaller).
      //   S   the rings and one line     W   the rings, a one-line row each (the name, the colored figure)     T   the rings over the rows
      //   L   a header ("Energy", the period, a tap moves it on), big rings left, a two-line row each      XL  the same with the rows two by two
      //       and, under them, the week as seven small rings with their day letters, today's ringed -- from the daily history (none, the week is
      //       left out). The period (Today, This Week, This Month) is the block's option; its header's word moves it on in place (Large, Extra Large)
      /** @param {string} size */
      _renderKit(size) {
        var Kt = window.hkKit, h = this.client, self = this;
        if (!Kt || !h) return false;
        var s = null;
        try { s = summary(h, this, this._clock ? +this._clock() : undefined); } catch (e) { console.warn('[hk-energy-rings]', e && e.message); s = null; }
        var per = s && s.periods && s.periods[this._period];
        if (!per || !per.rings.length) return false;
        this._watchBlock();
        var k = Kt.ctx(this), w = k.w, ht = k.h, E = k.E, X = k.X, sq = ht >= 180, p = this._period, v = Kt.v, esc2 = Kt.esc;
        var name = { day: 'Today', week: 'This Week', month: 'This Month' }[p], low = { day: 'today', week: 'this week', month: 'this month' }[p];
        var ink = v('ink', 'rgba(255,255,255,0.94)');
        var list = per.rings.map(function (/** @type {any} */ r) { return { key: r.key, c: r.c, f: r.typ > 0 ? r.v / r.typ : 0, tick: r.typ > 0 && r.tick < 1 ? r.tick : null }; });
        // THE FIGURES: the value, the usual and the unit -- "16.2", "/20", "KWH"; a cost "$2.31", "/$3.10"
        /** @param {any} r @param {boolean} usual */
        var parts = function (r, usual) {
          var money = r.key === 'cost', fmt = function (/** @type {number} */ x, /** @type {number} */ d) {
            return money ? s.money(x, d) : r.key === 'water' || r.key === 'gas' ? fx(x, 0) : fx(x, Math.abs(x) >= 100 ? 0 : 1); };
          return { val: fmt(r.v, 2), goal: usual && r.typ > 0 ? '/' + fmt(r.typ, p === 'day' ? 2 : 0) : '', unit: r.unit || '' };
        };
        /** @param {any} r @param {boolean} usual @param {boolean} unit */
        var fig = function (r, usual, unit) {
          var q = parts(r, usual), tail = q.goal + (unit && q.unit ? ' ' + q.unit.toUpperCase() : '');
          return '<span style="color:' + r.c + ';font-weight:600">' + esc2(q.val) + '</span>' +
            (tail ? '<span style="color:' + r.c + ';opacity:.85;font-size:.8em;font-weight:600">' + esc2(tail) + '</span>' : '');
        };
        // the rings in a box of `d` px: the block's own ringSvg, its thickness and gap in px (the viewBox is 220)
        /** @param {number} cx @param {number} cy @param {number} d @param {number} sw @param {any[]} items @param {boolean} [plain] */
        var rings = function (cx, cy, d, sw, items, plain) {
          var kk = 220 / d, svg = ringSvg(items, null, 0, { w: sw * kk, step: (sw + 2.5) * kk, r0: 110 - (sw / 2 + 1.5) * kk }).replace('class="rings"', 'class="rings" width="' + d + '" height="' +
            d + '"');
          if (plain) svg = svg.replace(/ class="arc( lap)?"/g, ' class="wk"').replace(/ data-k="[^"]*"/g, '');
          return Kt.box(cx - d / 2, cy - d / 2, d, d, '', 'pointer-events:none', svg);
        };
        // a row: a dot in the ring's color, the name, the figure -- on one line (the figure at the right), or under the name
        // one line: the figure's width in px (the value, then its usual smaller), and whether the name keeps its room beside it
        /** @param {any} r @param {boolean} usual */
        var figW = function (r, usual) { var q = parts(r, true); return Math.round(q.val.length * 9.6 + (usual ? q.goal.length * 7.7 : 0) + 3); };
        /** @param {number} ww @param {any} r */
        var fits = function (ww, r) { return ww - X - 22 - X - figW(r, true) - 8 >= Math.min(r.name.length * 10.3, 70); };
        /** @param {number} x @param {number} y @param {number} ww @param {any} r @param {number} rh @param {boolean} last @param {boolean} two @param {boolean} usual */
        var row = function (x, y, ww, r, rh, last, two, usual) {
          var x1 = x + X + 22, o = '<button type="button" class="row" aria-label="' + esc2(r.name + ' ' + parts(r, true).val + parts(r, true).goal + ' ' + parts(r, true).unit) +
            '" style="' + Kt.st(x, y, ww, rh) + '"></button>' + Kt.box(x + X, y + (rh - 10) / 2, 10, 10, '', 'pointer-events:none;border-radius:50%;background:' + r.c);
          if (two) o += Kt.tx(x1, y + (rh - 46) / 2, ww - X - 22 - X, 'kt', esc2(r.name), 'pointer-events:none') +
            Kt.tx(x1, y + (rh - 46) / 2 + 24, ww - X - 22 - X, 'kb', fig(r, true, true), 'pointer-events:none;color:' + ink);
          else {
            var fw = figW(r, usual);
            o += Kt.tx(x1, y + (rh - 24) / 2, ww - X - 22 - X - fw - 8, 'kt', esc2(r.name), 'pointer-events:none') +
              Kt.tx(x + ww - X - fw, y + (rh - 22) / 2, fw, 'kb', fig(r, usual, false), 'pointer-events:none;text-align:right;color:' + ink);
          }
          return o + (last ? '' : Kt.box(x1, y + rh - 1, x + ww - X - x1, 1, 'sep', 'pointer-events:none'));
        };
        var n = per.rings.length, o = '';
        /** @param {number} x @param {number} y0 @param {number} ww @param {number} rh @param {number} cols @param {boolean} two */
        var rowsAt = function (x, y0, ww, rh, cols, two) {
          var perCol = Math.ceil(n / cols), out = '', cw = (ww + (cols - 1) * X) / cols;
          // (every row the same: the usual beside each figure, or none beside any where a name has no room for it)
          var usual = two || per.rings.every(function (/** @type {any} */ r) { return fits(cw, r); });
          per.rings.forEach(function (/** @type {any} */ r, /** @type {number} */ i) {
            var c = Math.floor(i / perCol), j = i % perCol; out += row(x + c * (cw - X), y0 + j * rh, cw, r, rh, j === perCol - 1 || i === n - 1, two, usual);
          });
          return out;
        };
        var head = function (/** @type {string} */ sub) {
          var chev = Kt.svg('down', 14, Kt.v('ink-3', 'rgba(255,255,255,0.40)'));
          return Kt.head(k, { title: 'Energy', sub: esc2(sub) + ' ' + chev, subHtml: true }) +
            '<button type="button" class="hit" data-notap data-p="' + { day: 'week', week: 'month', month: 'day' }[p] + '" aria-label="' + esc2(name) + '. Show ' +
            { day: 'this week', week: 'this month', month: 'today' }[p] + '" style="' + Kt.st(X - 8, 34, 190, 44) + '"></button>';
        };
        if (size === 'S') {
          var f0 = per.rings[0], q0 = parts(f0, false), sd = sq ? 112 : 84, scy = (sq ? 10 : 6) + sd / 2 + 2;
          o = rings(w / 2, scy, sd, sq ? 10 : 8, list) + Kt.tx(8, scy + sd / 2 + (sq ? 8 : 4), w - 16, 'kt', fig(f0, false, false).replace(/<\/span>$/, '') + '</span>' +
            (q0.unit ? '<span style="color:' + ink + '"> ' + esc2(q0.unit) + '</span>' : ''), 'text-align:center;pointer-events:none') +
            Kt.tx(8, scy + sd / 2 + (sq ? 32 : 26), w - 16, 'kb', esc2(f0.name + ' ' + low), 'text-align:center;pointer-events:none');
        } else if (size === 'W') {
          var wd = Math.min(ht - 2 * E, 164), wcx = E + wd / 2, wx = Math.round(wcx + wd / 2 + 14), rh = Math.min(46, (ht - 12) / n);
          o = rings(wcx, ht / 2, wd, 13, list) + rowsAt(wx, (ht - n * rh) / 2, w - wx, rh, 1, false);
        } else if (size === 'T') {
          var rh2 = Math.min(50, Math.floor((ht - 200) / Math.max(1, n))), td = Math.min(w - 2 * E, 164, ht - n * rh2 - 2 * E - 8), ty0 = 18 + td / 2;
          o = rings(w / 2, Math.max(ty0, E + td / 2), td, 13, list) + rowsAt(0, ht - 6 - n * rh2, w, rh2, 1, false);
        } else if (size === 'L') {
          var ld = 199, rhl = Math.min(72, Math.floor((ht - 84 - 8) / n)), lx = E + ld + 10;
          o = head(name) + rings(E + ld / 2, 74 + (ht - 74) / 2, ld, 15, list) + rowsAt(lx, 84, w - lx, rhl, 1, true);
        } else {
          var days = per && s.periods.week && s.periods.week.days, ld2 = days ? 199 : 250, lx2 = E + ld2 + 10;
          o = head(name) + rings(E + ld2 / 2, days ? 166 : 74 + (ht - 74) / 2, ld2, days ? 15 : 18, list) + rowsAt(lx2, days ? 70 : 90, w - lx2, days ? 92 : 100, 2, true);
          if (days) {
            var ww7 = (w - 2 * E) / 7, L7 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], S = window.hkStats;
            days.forEach(function (/** @type {any} */ d, /** @type {number} */ i) {
              var cx = E + ww7 * i + ww7 / 2, items = list.map(function (/** @type {any} */ r, /** @type {number} */ q) { return { key: r.key + i, c: r.c, f: d.f ? d.f[q] : 0, tick: null }; });
              o += Kt.tx(cx - 20, 290, 40, 'kl', L7[S ? S.fields(d.t).weekday : new Date(d.t).getDay()], 'text-align:center;pointer-events:none' + (d.today ? ';color:' + ink : '')) +
                rings(cx, 344, 64, 5, items, true) + (d.today ? Kt.box(cx - 37, 307, 74, 74, '', 'pointer-events:none;border-radius:50%;box-shadow:inset 0 0 0 2px ' +
                  v('line-strong', 'rgba(255,255,255,.24)')) : '');
            });
          }
        }
        var label = 'Energy rings, ' + name + ': ' + per.rings.map(function (/** @type {any} */ r) { var q = parts(r, true); return r.name + ' ' + q.val + q.goal + ' ' + q.unit; }).join('; ');
        var was = this._kitHtml;
        var done = Kt.draw(this, Kt.plate(k, o, { label: label, cls: 'er' }), function (/** @type {any} */ root) {
          root.querySelectorAll('button[data-p]').forEach(function (/** @type {any} */ b) { b.addEventListener('click', function () { self._pick(b.getAttribute('data-p')); }); });
        });
        // THE RINGS SWEEP IN as the page's do: from nothing on a new period, from where they were on an update (only when the drawing changed)
        if (this._kitHtml !== was || this._ringFor !== p) { this._ringWas = sweepRings(this._root, this._ringWas, this._ringFor !== p); this._ringFor = p; }
        return done;
      }
      // SMALL'S BOX of figures shown or taken away; shown, it goes by itself after eight seconds
      _show(on) {
        if (this._always) return;
        this._open = !!on;
        clearTimeout(this._ovT);
        var ov = this._card && this._card.querySelector('.ov');
        if (ov) {
          ov.classList.toggle('on', this._open);
          if (this._open) ov.removeAttribute('aria-hidden'); else ov.setAttribute('aria-hidden', 'true');
        }
        if (this._card && this._cellSize() === 'S') this._card.setAttribute('aria-expanded', String(this._open));
        var self = this;
        if (this._open) this._ovT = setTimeout(function () { self._show(false); }, 8000);
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
