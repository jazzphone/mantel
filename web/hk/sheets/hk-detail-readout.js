// hk-detail-readout.js - the scrubbable readout, light colors and the favorites.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-detail-readout'] = function (K) {
    var at = K.at, C = K.C, clamp = K.clamp, esc = K.esc, lightCaps = K.lightCaps, num = K.num;

    // ------------------------------------------------------------ the readout
    // HOVER OR TOUCH A CHART AND IT SAYS WHAT IS THERE: a vertical line at the
    // nearest point, a dot on the line (a bar chart lights its bar instead),
    // and a label at the TOP of the line -- above the plot, where a finger
    // never covers it -- with the value and its time. A mouse shows it while
    // over the plot; a finger while it is down (pan-y: a vertical swipe still
    // scrolls the sheet, and the browser's pointercancel takes it away).
    //
    // scrub(box) is called with the chart's STABLE container after every
    // paint: the first call listens, every call puts the readout back on the
    // new plot. A power sensor's chart is redrawn on each state push, every
    // few seconds, and a finger held still must not lose its readout to it.
    function scrubValue(v, unit) {
      if (v == null) return '—';
      var a = Math.abs(v), d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
      if (/°|%/.test(unit)) d = a >= 100 ? 0 : 1;
      var t = Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
      return !unit ? t : /^(°|%)/.test(unit) ? t + unit : t + ' ' + unit;
    }
    function dayWord(t, now) {
      var d = new Date(t), n = new Date(now), y = new Date(now - 86400000);
      var same = function (a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
      return same(d, n) ? 'Today' : same(d, y) ? 'Yesterday' : null;
    }
    // A POINT'S TIME, as precise as its chart: a clock time across a day
    // (Now for the live reading that closes the line), the weekday too
    // across a week, the date across a month.
    function scrubTimeLine(t, ms, now) {
      if (now - t < 60000) return 'Now';
      var d = new Date(t), clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (ms <= 36 * 3600000) return clock;
      if (ms <= 8 * 86400000) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + clock;
      return dayWord(t, now) || d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    // A BAR'S TIME is its whole span: "2 – 3 PM" (the hour still going is
    // "2 PM – Now"), a day is "Today", "Yesterday" or "Tue, Oct 7".
    function scrubTimeBar(t, step, now) {
      if (step < 20 * 3600000) {
        var h = function (x) { return new Date(x).toLocaleTimeString([], { hour: 'numeric' }); };
        var a = h(t), b = t + step > now ? 'Now' : h(t + step);
        var sa = a.match(/\s?([AP]M)$/i), sb = b.match(/\s?([AP]M)$/i);
        if (sa && sb && sa[1] === sb[1]) a = a.replace(sa[0], '');
        return a + ' – ' + b;
      }
      return dayWord(t, now) || new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }
    // the point at a fraction across the plot: the nearest in time for a
    // line (drawn by time, first row to last, as hkChart.line does), the
    // column under it for bars. {i, f (its own fraction), v, label}
    function scrubPick(d, f, now) {
      var p = d.p, n = p.length;
      if (!n) return null;
      if (d.k === 'b') {
        var i = clamp(Math.floor(f * n), 0, n - 1), lab = scrubTimeBar(p[i][0], d.ms / n, now);
        // a day still to come: last period's same day (its gray), or nothing yet
        if (p[i][1] == null && p[i][0] > now) {
          return p[i].length > 2 ? { i: i, f: (i + 0.5) / n, v: p[i][2], label: lab + ' \u00b7 ' + (d.gw || 'last period') }
                                 : { i: i, f: (i + 0.5) / n, v: null, text: lab, label: 'to come' };
        }
        return { i: i, f: (i + 0.5) / n, v: p[i][1], label: lab };
      }
      // a line over a calendar period spans it, not its first row to its last
      var t0 = d.t1 > d.t0 ? d.t0 : p[0][0], t1 = d.t1 > d.t0 ? d.t1 : p[n - 1][0], timed = t1 > t0;
      var want = timed ? t0 + f * (t1 - t0) : f * (n - 1), at = function (k) { return timed ? p[k][0] : k; };
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var m = (lo + hi) >> 1; if (at(m) <= want) lo = m; else hi = m; }
      var j = Math.abs(at(hi) - want) < Math.abs(at(lo) - want) ? hi : lo;
      return { i: j, f: timed ? (p[j][0] - t0) / (t1 - t0) : (n > 1 ? j / (n - 1) : 0), v: p[j][1],
               label: scrubTimeLine(p[j][0], d.ms, now) };
    }
    function scrubShow(box, ap, clientX) {
      var d = ap._hks;
      if (d === undefined) { try { d = JSON.parse(ap.getAttribute('data-hks') || 'null'); } catch (e) { d = null; } ap._hks = d; }
      if (!d || !d.p || !d.p.length) return;
      var r = ap.getBoundingClientRect();
      if (r.width < 2) return;
      var pick = scrubPick(d, clamp((clientX - r.left) / r.width, 0, 1), Date.now());
      if (!pick) return;
      var L = ap._hksL;
      if (!L) {
        L = ap._hksL = document.createElement('div');
        L.className = 'hks';
        L.setAttribute('aria-hidden', 'true');
        L.innerHTML = '<i class="hkl"></i>' + (d.k === 'l' ? '<b class="hkd"></b>' : '') +
                      '<div class="hkp"><span class="v"></span><span class="t"></span></div>';
        ap.appendChild(L);
        if (d.k === 'l') {
          // the dot is the line's own color
          var stroke = ap.querySelector('svg path[stroke]');
          if (stroke) L.querySelector('.hkd').style.borderColor = stroke.getAttribute('stroke');
        } else {
          ap._hksBars = ap.querySelector('[style*="grid-template-columns"]');
          if (ap._hksBars) ap._hksBars.classList.add('hksg');
        }
      }
      // on a device pixel, as every rule is (a half-pixel line is a blur)
      var dpr = window.devicePixelRatio || 1, x = Math.round(pick.f * r.width * dpr) / dpr;
      L.firstChild.style.transform = 'translateX(' + x + 'px)';
      if (d.k === 'l') {
        var span = (d.hi - d.lo) || 1, y = d.pad + (d.hi - pick.v) / span * (r.height - 2 * d.pad);
        L.querySelector('.hkd').style.transform = 'translate(' + x + 'px,' + y.toFixed(1) + 'px)';
      } else if (ap._hksBars && ap._hksOn !== pick.i) {
        var cells = ap._hksBars.children;
        if (cells[ap._hksOn]) cells[ap._hksOn].classList.remove('hkon');
        if (cells[pick.i]) cells[pick.i].classList.add('hkon');
        ap._hksOn = pick.i;
      }
      var pill = L.lastChild;
      if (ap._hksTxt !== pick.label + '|' + pick.v + '|' + pick.text) {
        ap._hksTxt = pick.label + '|' + pick.v + '|' + pick.text;
        pill.firstChild.textContent = pick.text != null ? pick.text : scrubValue(pick.v, d.u);
        pill.lastChild.textContent = pick.label;
        ap._hksW = pill.offsetWidth;
      }
      // the label centered on the line, kept inside the chart: it may run
      // over the values' column on the left, never past the plot's right
      var axc = ap.parentNode, left = axc ? axc.getBoundingClientRect().left - r.left : 0;
      var w = ap._hksW || 0, pl = clamp(x - w / 2, left, Math.max(left, r.width - w));
      pill.style.transform = 'translateX(' + Math.round(pl * dpr) / dpr + 'px)';
      L.classList.add('on');
      if (d.k === 'b' && ap._hksBars) ap._hksBars.classList.add('on');
    }
    function scrubHide(box) {
      box._hksX = null;
      box.querySelectorAll('.ap .hks.on, .ap .hksg.on').forEach(function (e) { e.classList.remove('on'); });
    }
    function scrub(box) {
      if (!box) return;
      if (!box._hksBound) {
        box._hksBound = true;
        box._hksX = null;
        var plotOf = function (e) {
          var path = e.composedPath ? e.composedPath() : [];
          for (var i = 0; i < path.length && path[i] !== box; i++) {
            if (path[i].classList && path[i].classList.contains('ap')) return path[i];
          }
          return null;
        };
        var to = function (ap, x) { box._hksX = x; scrubShow(box, ap, x); };
        box.addEventListener('pointerdown', function (e) {
          if (e.pointerType === 'mouse') return;
          var ap = plotOf(e);
          if (!ap) return;
          box._hksId = e.pointerId;
          try { box.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
          to(ap, e.clientX);
        });
        box.addEventListener('pointermove', function (e) {
          if (e.pointerType === 'mouse') {
            var ap = plotOf(e);
            if (ap) to(ap, e.clientX); else if (box._hksX != null) scrubHide(box);
            return;
          }
          if (e.pointerId !== box._hksId || box._hksX == null) return;
          var cur = box.querySelector('.ap');
          if (cur) to(cur, e.clientX);
        });
        var end = function (e) {
          if (e.pointerType === 'mouse' && e.type !== 'pointerleave') return;
          if (e.pointerType !== 'mouse' && e.pointerId !== box._hksId) return;
          box._hksId = null;
          scrubHide(box);
        };
        box.addEventListener('pointerup', end);
        box.addEventListener('pointercancel', end);
        box.addEventListener('pointerleave', end);
        return;
      }
      // a redraw: the readout back where it was, on the new plot
      if (box._hksX != null) {
        var ap2 = box.querySelector('.ap');
        if (ap2) scrubShow(box, ap2, box._hksX);
      }
    }

    // Colour temperature -> an sRGB swatch (Tanner Helland's fit).
    function kelvinRgb(k) {
      var t = clamp(k, 1000, 40000) / 100, r, g, b;
      r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
      g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
      b = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307);
      return [clamp(Math.round(r), 0, 255), clamp(Math.round(g), 0, 255), clamp(Math.round(b), 0, 255)];
    }
    function css(rgb) { return 'rgb(' + rgb.join(',') + ')'; }
    function hsCss(hs) { return 'hsl(' + Math.round(hs[0]) + ',100%,' + Math.round(100 - (hs[1] / 2)) + '%)'; }
    // A fill colour for a light: its own colour, lifted toward white so a dim
    // red is still readable as a slider.
    function lightFill(s) {
      var rgb = at(s, 'rgb_color');
      var look = window.hkSettings && window.hkSettings.rendering ? window.hkSettings.rendering() : {};
      if (look.flat && look.theme === 'light') {
        // White light belongs to the sheet's neutral control palette. A
        // white fill on its white sheet made the active level disappear.
        if (!rgb || rgb.length !== 3 || Math.max.apply(null, rgb) - Math.min.apply(null, rgb) < 32) return C.v('track-fill');
        return css(rgb); // colored light keeps its color, without a white wash
      }
      if (!rgb || rgb.length !== 3) return 'rgba(255,255,255,0.95)';
      return css(rgb.map(function (c) { return Math.round(c + (255 - c) * 0.3); }));
    }

    // HA's favourite colours for a light live in the entity registry
    // (options.light.favorite_colors). Reading it needs an admin; a wall
    // tablet is not one, so it gets the same kind of defaults HA itself
    // offers: a few whites across the light's range, then colours.
    var FAV_CACHE = {};
    function defaultFavourites(s) {
      var caps = lightCaps(s), out = [];
      if (caps.temp) {
        var lo = num(at(s, 'min_color_temp_kelvin')) || 2000, hi = num(at(s, 'max_color_temp_kelvin')) || 6500;
        [2700, 4000, 6000].forEach(function (k) { out.push({ color_temp_kelvin: clamp(k, lo, hi) }); });
      }
      if (caps.colour) {
        [[0, 100], [30, 100], [120, 90], [210, 100], [280, 85], [330, 75]].forEach(function (hs) {
          out.push({ hs_color: hs });
        });
      }
      return out.slice(0, 6);
    }
    function favourites(h, s, cb) {
      var id = s.entity_id;
      if (FAV_CACHE[id]) return FAV_CACHE[id];
      FAV_CACHE[id] = defaultFavourites(s);
      if (h && h.user && h.user.is_admin && h.callWS) {
        h.callWS({ type: 'config/entity_registry/get', entity_id: id }).then(function (e) {
          var f = e && e.options && e.options.light && e.options.light.favorite_colors;
          if (Array.isArray(f) && f.length) { FAV_CACHE[id] = f; if (cb) cb(); }
        }).catch(function () { /* defaults stand */ });
      }
      return FAV_CACHE[id];
    }
    function favCss(f) {
      if (f.color_temp_kelvin) return css(kelvinRgb(f.color_temp_kelvin));
      if (f.hs_color) return hsCss(f.hs_color);
      if (f.rgb_color) return css(f.rgb_color);
      if (f.rgbw_color) return css(f.rgbw_color.slice(0, 3));
      if (f.rgbww_color) return css(f.rgbww_color.slice(0, 3));
      if (f.xy_color) return 'rgb(255,255,255)';
      return 'rgb(255,255,255)';
    }
    function favMatches(f, s) {
      if (f.color_temp_kelvin) {
        return at(s, 'color_mode') === 'color_temp' && Math.abs((num(at(s, 'color_temp_kelvin')) || 0) - f.color_temp_kelvin) < 120;
      }
      var hs = at(s, 'hs_color');
      if (f.hs_color && hs && at(s, 'color_mode') !== 'color_temp') {
        var dh = Math.abs(hs[0] - f.hs_color[0]); dh = Math.min(dh, 360 - dh);
        return dh < 8 && Math.abs(hs[1] - f.hs_color[1]) < 8;
      }
      return false;
    }

    function throttle(fn, ms) {
      var last = 0, t = null, args = null;
      function run() { last = Date.now(); t = null; fn.apply(null, args); }
      var w = function () {
        args = arguments;
        var wait = ms - (Date.now() - last);
        if (wait <= 0) { clearTimeout(t); run(); } else if (!t) t = setTimeout(run, wait);
      };
      w.cancel = function () { clearTimeout(t); t = null; };
      return w;
    }

    function glyph(icon, size) {
      return '<hk-icon icon="' + esc(icon) + '" style="--mdc-icon-size:' + size + 'px"></hk-icon>';
    }
    var BACK = 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z';

    // what the shell and the later parts use of this one
    K.BACK = BACK; K.css = css; K.defaultFavourites = defaultFavourites; K.favCss = favCss; K.favMatches = favMatches;
    K.favourites = favourites; K.glyph = glyph; K.hsCss = hsCss; K.kelvinRgb = kelvinRgb; K.lightFill = lightFill;
    K.scrub = scrub; K.scrubPick = scrubPick; K.scrubValue = scrubValue; K.throttle = throttle;
  };
})();
