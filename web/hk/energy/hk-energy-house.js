// hk-energy-house.js - the Home Power house, load and sun cards and the flow picture.
//
// PART OF THE ENERGY CARDS (hk-energy.js). Not a card and not run on its own: it registers one
// function, which hk-energy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkEnergyParts = window.hkEnergyParts || {})['hk-energy-house'] = function (K) {
    var axisOf = K.axisOf, batFlow = K.batFlow, carHome = K.carHome, carsCharging = K.carsCharging, esc = K.esc,
        FLOW = K.FLOW, fx = K.fx, gridDown = K.gridDown, HkPowerBase = K.HkPowerBase, isOn = K.isOn, model = K.model,
        moreAttr = K.moreAttr, numOf = K.numOf, powerSplit = K.powerSplit, pw = K.pw, rgba = K.rgba,
        series = K.series, vs = K.vs, whtml = K.whtml, wtxt = K.wtxt;

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
        svg: '<path d="' + curvePath(segs) + '" fill="none" stroke="' + col +
          '" stroke-opacity=".5" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>',
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
          'hk-plate.ep.phouse{height:auto;background:none;border:0;box-shadow:none;padding:0;overflow:visible}',
          '.hart{position:relative;width:100%;margin:58px auto 0}',
          '.hart svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
          '.pic{position:absolute;inset:0}',
          // the moving light (flowLine): a zero-size stage scaled to the picture
          '.stage{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;transform:scale(var(--fs,1));pointer-events:none}',
          '.pic:not([data-fs]) .stage{visibility:hidden}',
          '.flowdot,.portdot{position:absolute;left:0;top:0;border-radius:50%;will-change:transform,opacity}',
          '.flowdot{width:56px;height:56px;margin:-28px 0 0 -28px;opacity:0}',
          '.portdot{width:30px;height:30px;margin:-15px 0 0 -15px;background:radial-gradient(circle,#30d158 0,#30d158 45%,rgba(48,209,88,.45) 60%,rgba(48,209,88,0) 72%);' +
            'animation:port 1.4s ease-in-out infinite}',
          '.chips{position:absolute;inset:0;pointer-events:none}',
          // a chip: the floating strip's material (Tinted: its near-solid plate)
          '.chip{position:absolute;transform:translate(-50%,calc(-100% - 18px));padding:8px 13px 9px;border-radius:' + window.hkCards.R.inner +
            'px;white-space:nowrap;pointer-events:auto;cursor:pointer;',
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
          '  -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 10 14%27%3E%3Cpath d=%27M6 0L0 8h4l-1 6 6-8H5z%27/%3E%3C/svg%3E") center/contain ' +
            'no-repeat;',
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
        var c = this._config || {}, h = this.client, self = this;
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
          '<linearGradient id="gl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff8d0" stop-opacity=".6"/><stop offset="1" ' +
            'stop-color="#fff" stop-opacity="0"/></linearGradient>' +
          (hasSolar && L.solar ? '<mask id="pvm" style="mask-type:alpha">' + img('solar') + '</mask>' : '') + '</defs>' +
          '<g mask="url(#hfm)"><g mask="url(#hfm2)">' + img('house') + '</g></g>';
        if (hasSolar) {
          svg += img('solar');
          if (solar > 20 && L.solar) svg += '<g mask="url(#pvm)" opacity="' + (0.35 + 0.65 * Math.min(1, solar / 5000)).toFixed(2) + '"><rect class="glint" x="' + (L.solar[1] - 100) + '" y="' +
            L.solar[2] + '" width="260" height="' + L.solar[4] + '" fill="url(#gl)" transform="skewX(-20)"/></g>';
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
          // the cable only while a car at home is plugged in (its cable
          // sensor; without one, at home is plugged in) or charging: a car
          // parked unplugged is drawn without it (2026-10-28)
          if (carsHome.length) svg += img('car') + (charging || carsHome.some(function (k) { return k.plugged; }) ? img('cable') : '');
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
        svg += chips.map(function (f) { return '<circle class="dot" cx="' + f.a[0] + '" cy="' + f.a[1] + '" r="8" fill="#fff" fill-opacity=".9" style="filter:drop-shadow(0 0 4px rgba(0,0,0,.5))"/>';
          }).join('');
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
        this._paint('<div class="hart" style="aspect-ratio:' + W + '/' + vh + ';max-width:' + mw + 'px"><div class="pic"' + fs + '>' + svg + stage + '</div><div class="chips">' +
          chips.map(function (f) {
          // NEAR AN EDGE A CHIP OPENS INWARD (it ran off an iPad's page): in the
          // picture's outer fifths it sits on the inner side of its line
          var fx0 = f.a[0] / W, sd = fx0 > 0.8 ? 'l' : fx0 < 0.2 ? 'r' : side[f.key];
          return '<div class="chip' + (f.cls ? ' ' + f.cls : '') + (sd ? ' ' + sd : '') + '"' + moreAttr(f.more) + ' style="left:' + (f.a[0] / W * 100).toFixed(2) + '%;top:' +
            ((f.a[1] - crop) / vh * 100).toFixed(2) + '%">' + f.h + '</div>';
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
          '<defs><linearGradient id="lvg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="' + (low ? '#c42a22' : '#1f9e43') + '"/><stop offset="1" stop-color="' +
            (low ? '#ff6b61' : '#6cf08f') + '"/></linearGradient>' +
          '<linearGradient id="lvs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff" stop-opacity=".35"/><stop offset=".55" ' +
            'stop-color="#fff" stop-opacity="0"/></linearGradient>' +
          '<linearGradient id="lvl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#eafff0" stop-opacity=".8"/><stop offset="1" ' +
            'stop-color="#fff" stop-opacity="0"/></linearGradient>' +
          '<clipPath id="lvc"><rect x="' + bx.toFixed(2) + '" y="' + (by + bh - fill).toFixed(1) + '" width="' + bwid.toFixed(2) + '" height="' + fill.toFixed(1) + '" rx="' + (bwid / 2).toFixed(2) +
            '"/></clipPath></defs>' +
          '<rect class="lvtrack" x="' + (bx - 2).toFixed(2) + '" y="' + (by - 2).toFixed(1) + '" width="' + (bwid + 4).toFixed(2) + '" height="' + (bh + 4).toFixed(1) + '" rx="' +
            (bwid / 2 + 2).toFixed(2) + '" fill="rgba(0,0,0,.55)" stroke="rgba(255,255,255,.22)" stroke-width="1"/>' +
          '<g clip-path="url(#lvc)"><rect x="' + bx.toFixed(2) + '" y="' + by.toFixed(1) + '" width="' + bwid.toFixed(2) + '" height="' + bh.toFixed(1) + '" fill="url(#lvg)"/>' +
          '<rect x="' + bx.toFixed(2) + '" y="' + by.toFixed(1) + '" width="' + bwid.toFixed(2) + '" height="' + bh.toFixed(1) + '" fill="url(#lvs)"/>' +
          (bw ? '<rect class="lvrun' + (bw < 0 ? ' down' : '') + '" x="' + bx.toFixed(2) + '" y="' + by.toFixed(1) + '" width="' + bwid.toFixed(2) + '" height="' + (bh * 0.4).toFixed(1) +
            '" fill="url(#lvl)"/>' : '') + '</g>' +
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
          'hk-plate.ep.pload{--hk-ep-h:270px}',
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
        var c = this._config || {}, h = this.client;
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
            window.hkShell.announce({ bubbles: true, composed: true }, self);
          });
        }
      }
    }

    // ------------------------------------------------- where the sun goes
    // RIGHT NOW in watts (the split of the live readings) and TODAY in kWh
    // (the same split, hour by hour, over the Energy page's statistics: what
    // Home Assistant's Energy dashboard does), and how much of today's sun the
    // house used itself.
    function sunToday(client, card) {
      var M = model(client, card), D = M && series(client, card, M);
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
          'hk-plate.ep.psun{--hk-ep-h:270px}',
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
        var c = this._config || {}, h = this.client;
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
            '<div class="lg2">' + parts.map(function (p) { return '<span><i style="background:' + p[2] + '"></i>' + p[0] + ' <b>' + (kwh ? fx(p[1], 1) + ' kWh' : wtxt(p[1])) + '</b></span>'; }).join(
              '') + '</div>';
        };
        this._paint('<div class="ttl"><b>' + esc(c.title || 'Where the Sun Goes') + '</b><span>' + (T ? fx(T.sun, 1) + ' kWh today' : '') + '</span></div>' +
          '<div class="sg"><div' + moreAttr(c.solar) + '><div class="k">Right Now</div>' + bar([r.s2h, r.s2b, r.s2g]) + '</div>' +
          (T ? '<div><div class="k">Today</div>' + bar([T.s2h, T.s2b, T.s2g], true) + '</div>' : '') + '</div>' +
          (T && T.sun > 0.05 ? '<div class="say">You used <b>' + Math.round((T.s2h + T.s2b) / T.sun * 100) + '%</b> of today’s sun yourself.</div>' : ''));
      }
    }

    var PWR_SEL = { entity: { filter: { domain: 'sensor' } } };

    // what the shell and the later parts use of this one
    K.ART = ART; K.HkPowerHouseCard = HkPowerHouseCard; K.HkPowerLoadCard = HkPowerLoadCard;
    K.HkPowerSunCard = HkPowerSunCard; K.PWR_SEL = PWR_SEL;
  };
})();
