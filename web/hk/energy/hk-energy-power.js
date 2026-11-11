// hk-energy-power.js - the Home Power cards: shared helpers, flow, status, house battery and segmented choice.
//
// PART OF THE ENERGY CARDS (hk-energy.js). Not a card and not run on its own: it registers one
// function, which hk-energy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkEnergyParts = window.hkEnergyParts || {})['hk-energy-power'] = function (K) {
    var bindMore = K.bindMore, EP_CSS = K.EP_CSS, esc = K.esc, fx = K.fx, GLY = K.GLY, HkBase = K.HkBase, hm = K.hm,
        HOUR = K.HOUR, moreAttr = K.moreAttr, NAMED = K.NAMED, plan = K.plan, REST = K.REST, rgba = K.rgba,
        watts = K.watts;

    // ============================================================ HOME POWER
    //
    // The home power cards, in the Energy page's language: Right Now (what
    // flows between the grid, the house and the battery), the status in sentences, the house battery as a
    // battery, and a segmented choice for a select (the operating mode). Every
    // reading is an entity in the card's config, so they suit any home battery.
    //
    // POWER IS READ WITH ITS UNIT (hkChart.power): one panel reports W and kW
    // side by side.
    function pw(client, id) {
      if (!client || !id) return null;
      var C = window.hkChart;
      if (C) return C.power(client.states, id, { watts: true, fallback: null });
      var s = client.states[id], n = s ? Number(s.state) : NaN;
      if (!isFinite(n)) return null;
      return /^kW$/i.test((s.attributes || {}).unit_of_measurement || '') ? n * 1000 : n;
    }
    function numOf(client, id) {
      var s = id && client && client.states[id], n = s ? Number(s.state) : NaN;
      return s && s.state !== '' && isFinite(n) ? n : null;
    }
    function isOn(client, id) { var s = id && client && client.states[id]; return !!s && s.state === 'on'; }
    // NO READING IS NOT AN ANSWER: a missing, unknown or unavailable state is
    // null here, never 'off' or 'away'. The panel's grid status reads unknown
    // for a few seconds ~20 times a day, and a car's location goes unavailable
    // whenever its maker's cloud does -- neither means the grid is down or the
    // car has left.
    function reading(client, id) {
      var s = id && client && client.states[id];
      return s && s.state !== '' && s.state !== 'unknown' && s.state !== 'unavailable' ? s.state : null;
    }
    function gridDown(client, c) { return !!c.grid_status && reading(client, c.grid_status) === 'off'; }
    function carHome(client, k) { var r = k.home ? reading(client, k.home) : null; return r == null || r === 'home'; }
    // a runtime sensor in hours (or minutes) -> hours
    function hoursOf(client, id) {
      var v = numOf(client, id);
      if (v == null) return null;
      var u = ((client.states[id].attributes || {}).unit_of_measurement || 'h').toLowerCase();
      return /^min/.test(u) ? v / 60 : /^s/.test(u) ? v / 3600 : /^d/.test(u) ? v * 24 : v;
    }
    function wtxt(w) { return watts(w).join(' '); }
    function whtml(w) { var x = watts(w); return x[0] + '<u>' + x[1] + '</u>'; }
    // charging (+), giving (-) or idle (0), in watts
    function batFlow(client, cfg) {
      var c = pw(client, cfg.charge) || 0, d = pw(client, cfg.discharge) || 0;
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
    function carsCharging(client, c) {
      var all = (c.cars || []).filter(Boolean), atHome = function (k) { return carHome(client, k); };
      var own = function (k) { return Math.max(0, pw(client, k.power) || 0); };
      var fixed = all.filter(function (k) { return k.charger; }), taken = fixed.map(function (k) { return k.charger; });
      // (away, a Wall Connector's watts are someone else's car; the car's own
      // reading is a charger somewhere else, not the house's)
      var out = fixed.filter(function (k) { return atHome(k) || k.charger !== k.power; })
        .map(function (k) { return { car: atHome(k) ? k : null, w: Math.max(0, pw(client, k.charger) || 0) }; })
        .filter(function (x) { return x.w > 5; });
      var cars = all.filter(function (k) { return !k.charger; });
      var chargers = (c.chargers || []).filter(function (id) { return id && taken.indexOf(id) < 0; });
      return out.concat(guess(cars, chargers));
      function guess(cars, chargers) {
        if (!chargers.length) return cars.filter(function (k) { return atHome(k) && own(k) > 5; }).map(function (k) { return { car: k, w: own(k) }; });
        var live = chargers.map(function (id) { return Math.max(0, pw(client, id) || 0); }).filter(function (w) { return w > 5; })
          .sort(function (a, b) { return b - a; });
        if (!live.length) return [];
        var home = cars.filter(atHome);
        var saysCharging = function (k) {
          var st = k.state && client.states[k.state];
          return own(k) > 5 || (st && /^charging$/i.test(st.state));
        };
        var cands = home.filter(saysCharging).sort(function (a, b) { return own(b) - own(a); });
        if (!cands.length) cands = home.filter(function (k) { return k.plugged && isOn(client, k.plugged); });
        if (!cands.length) cands = home;
        return live.map(function (w, i) { return { car: cands[i] || (cands.length === 1 ? null : cands[0]) || null, w: w }; });
      }
    }
    var POWER_ANIM = '@media (prefers-reduced-motion: reduce){.run,.gw,.shim,.wfill,.cell .fill,.hshim{animation:none !important}}' +
      // a card that fills its row (`fill`): as tall as the row, at least its own height
      // (stretched, not a percentage: the grid stretches the host to the row,
      // and the card grows in it)
      ':host([data-fill]){display:flex;flex-direction:column}' +
      'hk-plate.ep.fill{flex:1 1 auto;height:auto !important;min-height:var(--hk-ep-h,0px)}' +
      // THE CARD BUILDS IN the first time it has something to show, as the
      // page headers do (hk-headers.js BASE_CSS): its parts rise into place one
      // after another; the graphs build by EP_CSS's .anim. Never on an update.
      '@keyframes hkPwIn{from{opacity:0;transform:translateY(8px)}}' +
      '.anim > *{animation:hkPwIn ' + window.hkCards.DUR.build + ' ' + window.hkCards.EASE.build + ' backwards}' +
      '.anim > :nth-child(2){animation-delay:60ms}.anim > :nth-child(3){animation-delay:120ms}.anim > :nth-child(n+4){animation-delay:180ms}' +
      '@media (prefers-reduced-motion: reduce){.anim > *{animation:none}}';

    // THE BLOCKS AS WIDGETS (2026-10-31, the owner's mock-up, "Home Grid
    // blocks, widget style"): what a block is in its color, the one figure
    // large and light, a line under it; rows of figures two by two; a row of
    // bars. The Battery and Energy Rings blocks share them.
    var WIDGET_CSS = [
      window.hkCards.headCss('.wl') + '.wl{flex:none}',
      '.wb{font-size:44px;font-weight:300;letter-spacing:-0.9px;line-height:1.04;font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:2px;flex:none}',
      '.ws{' + window.hkCards.typeCss('body') + ';line-height:19px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ws.wrap{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
      '.wf{margin-top:auto}',
      '.wcol{display:flex;flex-direction:column;min-width:0}',
      '.wc{display:block}',
      '.waxis{display:flex;justify-content:space-between;margin-top:6px;' + window.hkCards.typeCss('micro') + ';color:' + window.hkCards.v('ink-3') + '}',
      '.wgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px}.wgrid>div{display:flex;flex-direction:column;min-width:0}',
      // 2026-11-09, the owner, on the colored capitals: "Fix it" -- Title Case, gray, the color a small dot before the word
      '.wgrid b{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:' +
        window.hkCards.v('glow') + '}.wgrid b i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:0.5px}',
      '.wgrid span{font-size:22px;font-weight:600;letter-spacing:-0.3px;line-height:1.2;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    ].join('');
    // A BLOCK'S BOX in px, and inside its inset: the view's measure, else a
    // square cell's (the inset 18 there, 14 on tiles: --hk-block-pad)
    var SQUARE = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
    function blockBox(card, size) {
      card._watchBlock();
      var b = card._block(), d = SQUARE[size] || SQUARE.S, pad = 18;
      try { pad = parseFloat(getComputedStyle(card).getPropertyValue('--hk-block-pad')) || 18; } catch (e) { pad = 18; }
      var w = b ? b.w : d[0], h = b ? b.h : d[1];
      return { w: w, h: h, pad: pad, iw: w - 2 * pad, ih: h - 2 * pad };
    }
    // ONE RING, as Activity draws it: its track, and the arc from the top
    function ringOne(f, col, px, sw) {
      var r = px / 2 - sw / 2 - 1, c = 2 * Math.PI * r, k = Math.max(0, Math.min(1, f || 0)), m = (px / 2).toFixed(1);
      return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 ' + px + ' ' + px + '" aria-hidden="true">' +
        '<circle cx="' + m + '" cy="' + m + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + col + '" stroke-opacity=".22" stroke-width="' + sw + '"/>' +
        (k > 0.001 ? '<circle cx="' + m + '" cy="' + m + '" r="' + r.toFixed(1) + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' +
          (c * k).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 ' + m + ' ' + m + ')"/>' : '') + '</svg>';
    }

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
        var h = this.client;
        if (!h || !this._config) return null;
        return this._ids().map(function (id) { var s = h.states[id]; return id + '=' + (s ? s.state : 'x'); }).join(';');
      }
      _shell(cls) {
        if (this._built) return;
        this._root.innerHTML = '<hk-plate class="ep ' + cls + '" data-hk-role="card"></hk-plate>';
        this._card = this._root.querySelector('hk-plate');
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
          'hk-plate.ep.flow{--hk-ep-h:320px}',
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
          '@media (max-width:' + window.hkCards.BP.phone + 'px){hk-plate.ep.flow{--hk-ep-h:280px}.hf .big{font-size:18px}.hf .k{font-size:10px}}'
        ].join('');
      }
      _render() {
        this._shell('flow');
        var c = this._config || {}, h = this.client;
        if (!h) return;
        var gridW = pw(h, c.grid), home = pw(h, c.home), lvl = numOf(h, c.level), bw = batFlow(h, c);
        var gOn = gridW != null && gridW > 5, gs = reading(h, c.grid_status), onGrid = gs === 'on' ? true : gs === 'off' ? false : gOn || bw >= 0;
        var bLabel = bw === 0 ? 'Standing by' : bw > 0 ? 'Charging ' + wtxt(bw) : 'Powering the house';
        var speed = function (w) { return Math.max(0.5, 3 - Math.abs(w) / 900).toFixed(2) + 's'; };
        var glow = (0.18 + 0.42 * Math.min(1, (home || 0) / 4000)).toFixed(2);
        var level = lvl == null ? 0 : Math.max(0, Math.min(100, lvl)), wl = level / 100;
        var fig = function (cls, label, value, sub, more) {
          return '<div class="hf ' + cls + '"' + moreAttr(more) + '><div class="k">' + label + '</div><div class="big num">' + value + '</div>' +
            (sub ? '<div class="cap">' + esc(sub) + '</div>' : '') + '</div>';
        };
        var art = '';
        if (c.art) {
          var over = '<svg class="hov" viewBox="0 0 1600 700" aria-hidden="true"><defs><linearGradient id="shimg" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
            '<clipPath id="wbw"><rect x="1155" y="528" width="26" height="96" rx="6"/></clipPath></defs>' +
            (lvl != null ? '<rect clip-path="url(#wbw)" class="wfill" x="1155" y="' + (528 + 96 * (1 - wl)).toFixed(1) + '" width="26" height="' + (96 * wl).toFixed(1) +
              '" fill="#30d158" fill-opacity=".85"/>' : '') +
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
          'hk-plate.ep.pst{--hk-ep-h:320px;padding:6px 22px;display:grid;grid-template-rows:repeat(4,minmax(0,1fr))}',
          // the text centered on its icon, as the Energy page's highlights
          '.hli{display:grid;grid-template-columns:32px minmax(0,1fr);gap:12px;align-content:center;align-items:center;border-top:1px solid ' + window.hkCards.v('line') + '}',
          '.hli:first-child{border-top:0}',
          '.hli .ic{width:32px;height:32px;border-radius:50%;display:grid;place-items:center}',
          '.hli .ic svg{width:18px;height:18px}',
          '.hli .tx{font-size:15px;font-weight:500;line-height:20px;color:' + window.hkCards.v('ink-2') + ';',
          '  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}',
          '.hli .tx b{color:' + window.hkCards.v('ink') + ';font-weight:600}',
          '.hli.alert .tx b{color:#ff6961}',
          '@media (max-width:' + window.hkCards.BP.phone + 'px){hk-plate.ep.pst{--hk-ep-h:380px}}'
        ].join('');
      }
      _render() {
        this._shell('pst');
        var c = this._config || {}, h = this.client;
        if (!h) return;
        var rows = [], lvl = numOf(h, c.level), home = pw(h, c.home), bh = hoursOf(h, c.backup), bw = batFlow(h, c);
        var gridUp = !gridDown(h, c);
        if (!gridUp) rows.push({ more: c.grid_status, ic: STAT_GLY.tower, c: '#ff453a', alert: true, t: '<b>The grid is down.</b> The house is running on the battery' +
          (lvl != null ? ', at ' + Math.round(lvl) + '%' : '') + '.' });
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
        if (bh != null) rows.push({ more: c.backup, ic: STAT_GLY.batt, c: '#30d158', t: '<b>' + (gridUp ? 'A full backup would last ' : 'The battery will last ') + hm(bh) + '</b> at this load' +
          (home != null ? ' (' + wtxt(home) + ')' : '') + '.' });
        if (c.eps) rows.push({ more: c.eps, ic: STAT_GLY.bolt, c: '#5ac8fa', t: '<b>EPS is ' + (isOn(h, c.eps) ? 'on' : 'off') + '</b>' +
          (isOn(h, c.eps) ? ': the backed-up circuits switch over in under 20 ms.' : ': backed-up circuits may blink in an outage.') });
        if (c.storm) rows.push({ more: c.storm, ic: STAT_GLY.storm, c: '#bf5af2', t: '<b>Storm Mode is ' + (isOn(h, c.storm) ? 'on' : 'off') + '</b>' +
          (isOn(h, c.storm) ? ': charging to full ahead of the weather.' : '.') });
        this._paint(rows.slice(0, 4).map(function (r) {
          return '<div class="hli' + (r.alert ? ' alert' : '') + '"' + moreAttr(r.more) + '><div class="ic" style="background:' + rgba(r.c, 0.14) + ';color:' + r.c + '"><svg viewBox="0 0 24 24">' +
            r.ic + '</svg></div><div class="tx">' + r.t + '</div></div>';
        }).join(''));
      }
    }

    // ------------------------------------------------------ the house battery
    // A battery, filled to its level (growing from the left on first draw),
    // the reserve and the limit marked on it, light running through it while
    // it charges (or back while it powers the house); its packs as small
    // batteries; EPS and the charging speed.
    class HkHouseBatteryCard extends HkPowerBase {
      // (a block's tap, hk-base.js openTarget) Energy, else the battery's own level sensor
      _tapTarget() { var id = (this._config || {}).level; return [{ page: 'energy' }, id && { sheet: id }]; }
      static get PART_CSS() {
        return [
          'hk-plate.ep.hb{height:auto;min-height:256px}',
          '.bt2{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(220px,1fr);gap:36px;flex:1;min-height:0;margin-top:26px;align-items:center}',
          '@container (max-width:720px){.bt2{grid-template-columns:1fr;gap:20px;margin-top:30px}}',
          '.cell{position:relative;height:118px;border-radius:24px;border:6px solid var(--hk-battery-shell,rgba(255,255,255,.42));padding:6px;margin-right:16px;box-sizing:border-box}',
          '.cell:after{content:"";position:absolute;right:-16px;top:32px;width:10px;height:42px;border-radius:0 7px 7px 0;background:var(--hk-battery-shell,rgba(255,255,255,.42))}',
          '.cell .fill{position:relative;overflow:hidden;height:100%;border-radius:13px;background:' + window.hkCards.v('battery-fill') +
            ';box-shadow:inset 0 1px 0 rgba(255,255,255,0.35);  animation:growX 1.2s cubic-bezier(.22,.8,.25,1) backwards;transform-origin:0 50%;transition:width .6s ease}',
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
          '.cell .txt span{font-size:14px;line-height:18px;font-weight:600;color:rgba(255,255,255,.9);margin-top:8px;text-shadow:0 1px 2px rgba(0,0,0,.25);padding-right:12px;  white-space:nowrap;' +
            'overflow:hidden;text-overflow:ellipsis}',
          // a mark is a tick through the battery's outline, top and bottom --
          // never a line through the figures inside it
          '.mk{position:absolute;top:-10px;bottom:-10px;width:0;border-left:2px dashed;' +
            '  -webkit-mask-image:linear-gradient(to bottom,#000 22px,transparent 22px,transparent calc(100% - 22px),#000 calc(100% - 22px));',
          '  mask-image:linear-gradient(to bottom,#000 22px,transparent 22px,transparent calc(100% - 22px),#000 calc(100% - 22px))}',
          '.mkl{position:absolute;bottom:calc(100% + 14px);transform:translateX(-50%);font-style:normal;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;' +
            'white-space:nowrap}',
          '.side2{display:flex;flex-direction:column;gap:14px;min-width:0}',
          '.pk2{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:14px;align-items:center;padding-right:6px}',
          '.mini{position:relative;height:26px;border-radius:8px;border:3px solid var(--hk-battery-shell,rgba(255,255,255,.42));padding:2px;box-sizing:border-box}',
          '.mini:after{content:"";position:absolute;right:-7px;top:6px;width:4px;height:8px;border-radius:0 2px 2px 0;background:var(--hk-battery-shell,rgba(255,255,255,.42))}',
          '.mini i{display:block;height:100%;border-radius:4px;background:' + window.hkCards.v('battery-fill') + '}',
          '.pk2 b{font-size:15px;font-weight:600}.pk2 span{font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
          '.pk2 .pv{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}',
          '.facts{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding-top:14px;border-top:1px solid ' + window.hkCards.v('line') + '}',
          '.facts .big{font-size:20px;margin-top:5px}',
          // ON A HOME GRID (the `battery` block; 2026-10-31, the owner's mock-up
          // of the blocks as Apple's widgets): the plate fills the block on its
          // inset, and the battery is Activity's ring -- WIDGET_CSS's label,
          // figure and lines. S the level and its ring; W the stored kWh and
          // the backup beside a larger ring; T the ring large; L the ring with
          // the level inside, then solar in, the house using, the grid and when
          // it is full, two by two; XL the same beside the day's charge as bars.
          ':host([size]) hk-plate.ep.hb{height:100%;min-height:0;padding:' + window.hkCards.blockPad('14px') + '}',
          WIDGET_CSS,
          '.bring{position:relative;display:grid;place-items:center;flex:none}.bring>svg{position:absolute;inset:0}',
          '.bring hk-icon{position:relative;display:block;--mdc-icon-size:100%}',
          '.bring .in{position:relative;display:flex;flex-direction:column;align-items:center;line-height:1}',
          '.bring .in b{font-weight:500;letter-spacing:-0.5px;font-variant-numeric:tabular-nums}',
          '.bring .in small{' + window.hkCards.typeCss('caption') + ';color:' + window.hkCards.v('ink-2') + ';margin-top:4px}',
          '.bw{display:flex;gap:18px;flex:1;min-height:0}.bw>.wcol{flex:1}',
          '.bt{display:flex;flex-direction:column;flex:1;min-height:0}.bt .bring{margin:auto}',
          '.blg{display:flex;flex-direction:column;justify-content:space-between;flex:1;min-height:0}',
          '.blg .top{display:flex;gap:18px;align-items:center;min-width:0}',
          '.bx{display:flex;gap:24px;flex:1;min-height:0}',
          '.bx .lft{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:10px;text-align:center}',
          // THE HEADINGS (2026-11-08, the owner: "if the card's name is printed on the card...it can go"): the block's own name is gone at every size; the graph's Today is the one gray heading
          window.hkCards.headRowCss('.hh') + window.hkCards.headCss('.hh .hd'),
          '.bx .rt{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}',
          '.bx .wbars{flex:1;min-height:40px}',
          '.bx .wgrid{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 10px;margin-top:12px}.bx .wgrid span{font-size:17px}',
          // (THE FOUR FIGURES ARE TARGETS, 2026-11-08, the controls audit: each 44 px tall at least, 12 px clear between them)
          '.blg .wgrid>div,.bx .wgrid>div{min-height:44px;',
          '  justify-content:center}'
        ].join('');
      }
      // a block also reads the Energy feature's sun, house and grid (and is
      // drawn again for a new block size)
      _ids() {
        var out = super._ids(), P = this._cellSize() ? plan() : null, W = (P && P.power) || {};
        [W.solar, W.home, W.grid].forEach(function (id) { if (id && out.indexOf(id) < 0) out.push(id); });
        return out;
      }
      _sigOf() {
        var s = super._sigOf();
        return s == null ? null : s + '|' + (this._cellSize() || '') + '|' + (this._blockKey || '');
      }
      // A HOME GRID BLOCK, from the battery's own readings and the Energy
      // feature's (the plan's power page: the sun, the house and the grid now)
      _renderBlock(sized) {
        var c = this._config || {}, h = this.client, P = plan(), W = (P && P.power) || {};
        var lvl = numOf(h, c.level), level = lvl == null ? 0 : Math.max(0, Math.min(100, lvl));
        var stored = numOf(h, c.stored), bh = hoursOf(h, c.backup), bw = batFlow(h, c), res = numOf(h, c.reserve);
        var doing = bw > 0 ? 'Charging' : bw < 0 ? 'Powering the house' : 'Standing by';
        var pct = lvl == null ? '—' : Math.round(level) + '%', low = res != null && level <= res;
        var col = low ? NAMED.red : NAMED.green, b = blockBox(this, sized);
        var glyph = bw > 0 ? 'mdi:lightning-bolt' : 'mdi:home-battery';
        var ring = function (px, inner) { return '<div class="bring"' + moreAttr(c.level) + ' style="width:' + px + 'px;height:' + px + 'px">' + ringOne(level / 100, col, px, px > 100 ? 10 : 8) +
          inner + '</div>'; };
        var icon = function (px) { return '<hk-icon icon="' + glyph + '" style="width:' + px + 'px;height:' + px + 'px;color:' + col + '"></hk-icon>'; };
        var face = function (px, fs) { return '<div class="in"><b style="font-size:' + fs + 'px">' + pct + '</b><small>' + esc(doing === 'Powering the house' ? 'In use' : doing) + '</small></div>'; };
        var backup = bh != null ? hm(bh) + ' of backup' : '';
        var both = [stored != null ? fx(stored, 1) + ' kWh' : null, backup || null].filter(Boolean).join(' · ');
        if (sized === 'S') {
          // (2026-11-07, the review: a 64 px ring in the corner under the level left half the block bare) one ring as large as the block, the level and what it is doing inside it
          var sp = Math.max(64, Math.min(b.iw, b.ih));
          this._paint('<div class="bt">' + ring(sp, face(sp, Math.round(sp * 0.24))) + '</div>');
          return;
        }
        if (sized === 'W') {
          var wp = Math.min(120, b.ih);
          this._paint('<div class="bw"><div class="wcol"><div class="wb">' + pct + '</div>' +
            '<div class="ws">' + esc([doing, stored != null ? fx(stored, 1) + ' kWh' : null].filter(Boolean).join(' · ')) + '</div>' +
            (backup ? '<div class="wf ws">About ' + esc(backup) + '</div>' : '') + '</div>' +
            '<div class="wcol" style="flex:none;justify-content:center">' + ring(wp, icon(Math.round(wp * 0.37))) + '</div></div>');
          return;
        }
        if (sized === 'T') {
          // the ring as large as the column, or the room the words leave it
          var tp = Math.max(80, Math.min(b.iw, b.ih - 46 - 19 - 38 - 24));
          this._paint('<div class="bt"><div class="wb">' + pct + '</div><div class="ws">' + esc(doing) + '</div>' +
            ring(tp, icon(Math.round(tp * 0.32))) + (both ? '<div class="ws wrap">' + esc(both) + '</div>' : '') + '</div>');
          return;
        }
        // L and XL: the four figures -- the sun in, the house using, the grid,
        // and when the battery is full (charging) or how long it lasts
        var sun = W.solar ? pw(h, c.solar || W.solar) : null, home = pw(h, c.home || W.home), grid = pw(h, c.grid || W.grid);
        var kw = function (w) { return w == null ? '—' : Math.abs(w) >= 1000 ? fx(w / 1000, 1) + ' kW' : fx(w, 0) + ' W'; };
        var full = '—', fullK = 'Full By';
        var cap = stored != null && lvl > 0 ? stored / (lvl / 100) : null;
        if (bw > 0 && cap != null && level < 100) {
          var hrs = (cap - stored) * 1000 / bw;
          if (hrs > 0 && hrs < 48) full = new Date(Date.now() + hrs * HOUR).toLocaleTimeString(window.hkLocale.tag(),
            window.hkLocale.clock({ hour: 'numeric', minute: '2-digit', timeZone: window.hkStats && window.hkStats.tz() }));
        } else if (bw > 0 && level >= 100) full = 'Full';
        else { fullK = 'Lasts'; full = bh != null ? hm(bh) : '—'; }
        var stat = function (k, cl, val, more) { return '<div' + moreAttr(more) + '><b><i style="background:' + cl + '"></i>' + k + '</b><span>' + esc(val) + '</span></div>'; };
        var four = function (short) {
          return stat(short ? 'Solar' : 'Solar In', NAMED.yellow, sun == null ? 'None' : kw(sun), c.solar || W.solar) +
            stat(short ? 'Using' : 'House Using', NAMED.orange, kw(home), c.home || W.home) +
            stat(grid != null && grid < -5 ? 'To Grid' : short ? 'Grid' : 'From Grid', NAMED.blue, kw(grid == null ? null : Math.abs(grid)), c.grid || W.grid) +
            stat(fullK, col, full, c.level);
        };
        if (sized === 'L') {
          var lp = Math.max(96, Math.min(Math.round(b.iw * 0.48), b.ih - 2 * 44 - 12 - 36));
          this._paint('<div class="blg"><div class="top">' + ring(lp, face(lp, Math.round(lp * 0.21))) +
            '<div class="wcol"><div class="wb" style="font-size:30px">' + (stored != null ? fx(stored, 1) + ' kWh' : pct) + '</div>' +
            (backup ? '<div class="ws wrap">About ' + esc(backup) + '</div>' : '') + '</div></div>' +
            '<div class="wgrid">' + four(false) + '</div></div>');
          return;
        }
        // XL: the ring and what is stored on the left; the day's charge as bars, then the four figures
        var xp = Math.max(120, Math.min(190, b.ih - 44, Math.round(b.iw * 0.34)));
        this._paint('<div class="bx"><div class="lft" style="width:' + Math.max(xp, 200) + 'px">' + ring(xp, face(xp, Math.round(xp * 0.21))) +
          (both ? '<div class="ws wrap">' + esc(both) + '</div>' : '') + '</div>' +
          '<div class="rt"><div class="hh"><span class="hd">Today</span></div>' +
          '<div class="wbars">' + this._dayBars(c, lvl, col, b.iw - Math.max(xp, 200) - 24, Math.max(40, b.ih - 19 - 8 - 19 - 12 - 44)) + '</div>' +
          '<div class="waxis"><span>12 AM</span><span>6</span><span>12 PM</span><span>6</span></div>' +
          '<div class="wgrid">' + four(true) + '</div></div></div>');
      }
      // THE DAY'S CHARGE: each hour's mean level since midnight (the hour we
      // are in, the level now), and the hours still to come yesterday's, in
      // gray -- the shape of a usual day ahead
      // (`w` x `h` px: an SVG, as HK's bars are drawn -- barChart)
      _dayBars(c, lvl, col, w, h0) {
        var S = window.hkStats, h = this.client, hr = S && c.level ? S.hourly(h, c.level, 48, this, { type: 'mean' }) : null;
        var out = [];
        if (hr && hr.length) {
          var start = -1;
          for (var i = hr.length - 1; i >= 0; i--) if (S.fields(hr[i].t).hour === 0) { start = i; break; }
          if (start < 0) start = Math.max(0, hr.length - 24);
          for (var k = 0; k < 24; k++) {
            var j = start + k, now = j === hr.length - 1, y = start - 24 + k;
            if (j < hr.length) out.push({ v: now && lvl != null ? lvl : hr[j].v, fut: false });
            else out.push({ v: y >= 0 && hr[y] ? hr[y].v : null, fut: true });
          }
        }
        while (out.length < 24) out.push({ v: null, fut: true });
        var gap = 3, bw = Math.max(1, (w - 23 * gap) / 24), rx = Math.min(3, bw / 2);
        return '<svg class="wc" width="' + Math.round(w) + '" height="' + Math.round(h0) + '" viewBox="0 0 ' + w.toFixed(1) + ' ' + h0 +
          '" role="img" aria-label="The battery’s charge through the day">' +
          out.map(function (x, i) {
            var bh = Math.max(3, Math.min(100, x.v || 0) / 100 * h0);
            return '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (h0 - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) +
              '" rx="' + rx.toFixed(1) + '" fill="' + (x.fut ? REST : col) + '"/>';
          }).join('') + '</svg>';
      }
      _render() {
        this._shell('hb');
        var c = this._config || {}, h = this.client;
        if (!h) return;
        var sized = this._cellSize();
        if (sized) { this._renderBlock(sized); return; }
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
          return '<div class="pk2"' + moreAttr(p.level) + '><div class="mini"><i style="width:' + (pl == null ? 0 : Math.max(0, Math.min(100, pl))) + '%"></i></div><div><b>' +
            esc(p.name || 'Pack ' + (i + 1)) + '</b><br><span>' +
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
          'hk-plate.ep.segc{height:auto;padding:16px 18px}',
          // HK's segmented control (the calendar's), its choices sharing the width
          window.hkCards.segCss('.seg'),
          '.seg button{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;padding:0 8px}',
          '.mdesc{font-size:14px;line-height:18px;color:' + window.hkCards.v('ink-2') + ';margin:12px 4px 0;min-height:18px}',
          // a phone: names wrap to two lines rather than lose their ends
          // a phone: names wrap to two lines rather than lose their ends
          '@media (max-width:' + window.hkCards.BP.phone +
            'px){.seg{height:auto;min-height:44px}.seg button{font-size:13px;padding:4px;height:auto;min-height:36px;white-space:normal;line-height:1.15}}'
        ].join('');
      }
      _opts() {
        var c = this._config || {}, s = this.client && this.client.states[c.entity];
        if (Array.isArray(c.options) && c.options.length) {
          return c.options.map(function (o) { return typeof o === 'string' ? { value: o, name: o } : o; });
        }
        return (((s && s.attributes) || {}).options || []).map(function (o) {
          return { value: o, name: String(o).replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); }) };
        });
      }
      _render() {
        this._shell('segc');
        var c = this._config || {}, h = this.client, self = this;
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
        var c = this._config || {}, h = this.client, self = this;
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

    // what the shell and the later parts use of this one
    K.batFlow = batFlow; K.blockBox = blockBox; K.carHome = carHome; K.carsCharging = carsCharging; K.FLOW = FLOW;
    K.gridDown = gridDown; K.HkHouseBatteryCard = HkHouseBatteryCard; K.HkPowerBase = HkPowerBase;
    K.HkPowerFlowCard = HkPowerFlowCard; K.HkPowerStatusCard = HkPowerStatusCard; K.HkSegmentCard = HkSegmentCard;
    K.isOn = isOn; K.numOf = numOf; K.powerSplit = powerSplit; K.pw = pw; K.whtml = whtml; K.WIDGET_CSS = WIDGET_CSS;
    K.wtxt = wtxt;
  };
})();
