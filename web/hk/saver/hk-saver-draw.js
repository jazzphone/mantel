// hk-saver-draw.js - the layout, the clocks, Home Energy and the weather.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-draw'] = function (K) {
    var dashConf = K.dashConf, layoutSoon = K.layoutSoon;

    var ANALOG = { analog: 1, numbers: 1, giant: 1, scattered: 1, ring: 1, arc: 1, solar: 1, prism: 1, world: 1, hotel: 1, terminal: 1, atelier: 1, meridian: 1, markets: 1, brief: 1, modular: 1 };
    function faceScale(want, width, height, room, bounded) {
      var scale = want / Math.max(1, height);
      return bounded ? Math.min(scale, room.w * .9 / Math.max(1, width), room.h * .9 / Math.max(1, height)) : scale;
    }
    // WHERE THE INK IS (2026-11-01, the owner: "alignment is key"): a box around words holds the line's room above and
    // below the letters, so boxes on one line don't put the letters on one. inkOf(node): the union of what `node` draws
    // -- its words by their letters (the font's own measure: the room above the figures and below them taken off), its
    // pictures whole -- in page px, {x0, y0, x1, y1}, or null; shadow roots too. Measured, not a frame's work: only when
    // the layout is planned (the minute, a resize, the house's words)
    var inkCtx = null, inkRange = null;
    // a text node's letters: the top of its first line's letters and its last line's baseline, in page px -- from its own
    // line boxes (a Range's: wherever a flex box or padding put them) and the font's measure of how far the letters
    // reach inside a line box (k: a line box as drawn, scaled or not, against the font's own)
    function wordsInk(t, cs) {
      var txt = t.textContent.trim();
      if (!txt) return null;
      try {
        if (!inkCtx) inkCtx = document.createElement('canvas').getContext('2d');
        if (!inkRange) inkRange = document.createRange();
        inkCtx.font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].join(' ');
        var mt = inkCtx.measureText(txt), fa = mt.fontBoundingBoxAscent, fd = mt.fontBoundingBoxDescent || 0;
        if (!(fa > 0) || !(mt.actualBoundingBoxAscent > 0)) return null;
        inkRange.selectNodeContents(t);
        var rs = inkRange.getClientRects();
        if (!rs.length) return null;
        var a = rs[0], z = rs[rs.length - 1], k = a.height / (fa + fd) || 1;
        var x0 = 1e9, x1 = -1e9;
        Array.prototype.forEach.call(rs, function (r) { x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right); });
        return { x0: x0, x1: x1, y0: a.top + k * (fa - mt.actualBoundingBoxAscent), y1: z.top + (z.height / (fa + fd) || 1) * fa };
      } catch (e) { return null; }
    }
    // the ink's box: its top the highest letter's or picture's, its foot the last line's baseline (lines of words on one
    // line are on one baseline, whatever hangs below it), or the pictures' foot where there are no words
    // (`hidden`: count what is hidden too -- the big element's face is measured unseen)
    function inkOf(node, hidden) {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, wy1 = -1e9, py1 = -1e9, lineH = 0, bigPy1 = -1e9;
      var walk = function (r) {
        Array.prototype.forEach.call(r.querySelectorAll('*'), function (n) {
          if (n.shadowRoot) walk(n.shadowRoot);
          var tag = n.tagName.toLowerCase();
          if (tag === 'style' || tag === 'script' || (n.closest && n.closest('svg') && tag !== 'svg')) return;
          /** @type {any} */ var cs = null, seen = function () {
            if (!cs) cs = getComputedStyle(n);
            return cs.display !== 'none' && (hidden || (cs.visibility !== 'hidden' && +cs.opacity !== 0));
          };
          if (tag === 'svg' || tag === 'img' || tag === 'canvas') {
            var q = n.getBoundingClientRect();
            if (!q.width || !q.height || !seen()) return;
            x0 = Math.min(x0, q.left); x1 = Math.max(x1, q.right); y0 = Math.min(y0, q.top); py1 = Math.max(py1, q.bottom);
            // (a picture taller than lines of words -- a song's art -- is what a card's foot is, not a glyph hanging on a line)
            if (q.height > 2.2 * lineH && lineH) bigPy1 = Math.max(bigPy1, q.bottom); else if (!lineH) pics.push(q);
            return;
          }
          for (var c = n.firstChild; c; c = c.nextSibling) {
            if (c.nodeType !== 3 || !c.textContent.trim() || !seen()) continue;
            var w = wordsInk(c, cs);
            if (!w) continue;
            // (only what shows: words cut off by a box that hides its overflow -- Today's long song title, ellipsized --
            // measured their whole length, so the face's box ran past them and the time sat left of center, the
            // owner, 2026-11-01)
            for (var a = n; a && a.nodeType === 1; a = a.parentNode) {
              if (getComputedStyle(a).overflowX === 'visible') continue;
              var ab = a.getBoundingClientRect();
              w.x0 = Math.max(w.x0, ab.left); w.x1 = Math.min(w.x1, ab.right);
            }
            if (!(w.x1 > w.x0)) continue;
            x0 = Math.min(x0, w.x0); x1 = Math.max(x1, w.x1); y0 = Math.min(y0, w.y0); wy1 = Math.max(wy1, w.y1);
            lineH = Math.max(lineH, parseFloat(cs.fontSize) || 0);
          }
        });
      };
      var pics = [];
      walk(node.shadowRoot || node);
      // (pictures met before any words: judged once the words' size is known)
      pics.forEach(function (q) { if (lineH && q.height > 2.2 * lineH) bigPy1 = Math.max(bigPy1, q.bottom); });
      var y1 = wy1 > -1e9 ? Math.max(wy1, bigPy1) : py1;
      return x1 > x0 && y1 > y0 ? { x0: x0, y0: y0, x1: x1, y1: y1 } : null;
    }
    // A GLANCE GROUP'S FILE (hk-saverpieces-<group>.js, phase 1b): loaded the first time a layout places one of its
    // pieces, then the layout drawn again
    var pieceFiles = {};
    function pieceFile(f) {
      if (pieceFiles[f]) return;
      pieceFiles[f] = import('/hk/modules/hk-saverpieces-' + f + '.js').then(function () { if (f === 'home') piecesStarted(); layoutSoon(); })
        .catch(function (e) { console.warn('[hk-saver] pieces', f, e && e.message); });
    }
    // THE SCREENSAVER HAS COME UP: what "since" means to the pieces that count what arrives (Notifications)
    function piecesStarted() {
      var H = window.hkSaverWidgets && window.hkSaverWidgets._ && window.hkSaverWidgets._.home;
      if (H && H.reset) { try { H.reset(); } catch (e) { /* its own */ } }
    }
    function deg(v) { return v == null || !isFinite(v) ? '—' : Math.round(v) + '°'; }
    function photoLum(img) {
      try {
        if (!img || !img.naturalWidth) return null;
        var cv = document.createElement('canvas'); cv.width = cv.height = 8;
        var x = cv.getContext('2d');
        x.drawImage(img, 0, 0, 8, 8);
        var d = x.getImageData(0, 0, 8, 8).data, sum = 0;
        for (var i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        return sum / (d.length / 4);
      } catch (e) { return null; }         // (a photo from another host can't be read: white, as before)
    }
    // HOW MUCH OF A BOX THE LAND COVERS (its art's alpha, laid out as hk-sky.js's .land draws it: cover, center bottom, of
    // the 2560 x 1600 art): the share at half or more, weighed once per land, screen and box; undefined until it is known
    var landShares = {};
    // a Show of hk-saverfaces.js's (Glance, Month, Day): loaded only now
    var fcxLoad = null;
    function facesModule() {
      if (window.hkSaverFaces) return Promise.resolve(window.hkSaverFaces);
      if (!fcxLoad) {
        fcxLoad = import('/hk/modules/hk-saverfaces.js').then(function () { return window.hkSaverFaces; })
          .catch(function (e) { fcxLoad = null; console.warn('[hk-saver] faces', e && e.message); return null; });
      }
      return fcxLoad;
    }
    // THE CLOCK'S TEXT OVER PHOTOS (2026-10-13): Outline, four hard shadows a
    // stroke's width out (any face: text, canvas or SVG), then Shadow, one soft
    // one below -- as a filter on the clock's layer, drawn once per change
    function ckFx(c) {
      var o = (c.clock_text_outline || 0) / 100, s = (c.clock_text_shadow || 0) / 100, out = [];
      if (o > 0) {
        var w = +(0.5 + o * 2.5).toFixed(2), a = (0.55 + o * 0.4).toFixed(2);
        [[w, 0], [-w, 0], [0, w], [0, -w]].forEach(function (d) { out.push('drop-shadow(' + d[0] + 'px ' + d[1] + 'px 0 rgba(0,0,0,' + a + '))'); });
      }
      if (s > 0) out.push('drop-shadow(0 ' + (1 + s * 3).toFixed(1) + 'px ' + (2 + s * 22).toFixed(1) + 'px rgba(0,0,0,' + (0.25 + s * 0.6).toFixed(2) + '))');
      return out.join(' ') || 'none';
    }
    // the options but the clock's face (its style, 24-hour)
    // THE SLIDES' OWN SETTINGS changed alone (the editor's Slides section, a slide on show): drawn again in place
    function sansSlides(c) {
      var o = {};
      Object.keys(c || {}).forEach(function (k) { if (['corner_time_size', 'corner_hide', 'music_hide'].indexOf(k) < 0) o[k] = c[k]; });
      return JSON.stringify(o);
    }
    function sansClock(c) {
      var o = {};
      Object.keys(c || {}).forEach(function (k) { if (['clock_style', 'clock_options', 'clock_24', 'clock_today_music', 'clock_today_weather', 'clock_color', 'clock_speed', 'clock_depth', 'clock_night', 'clock_night_from', 'clock_night_to', 'clock_text_shadow', 'clock_text_outline'].indexOf(k) < 0) o[k] = c[k]; });
      return JSON.stringify(o);
    }
    function minsOf(hhmm) { var p = String(hhmm || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
    function textBox(el) {
      var rg = document.createRange(); rg.selectNodeContents(el);
      var r = rg.getBoundingClientRect();
      return r && r.width > 0 ? r : null;
    }
    var DAY_GAP = 14;
    // the screen's weather service (Weather), for Today
    function weatherEntity() {
      var HS = window.hkSettings;
      return (HS && HS.get && HS.get('weather.entity', null)) || null;
    }
    // this dashboard's Energy page, when it has one: a tap on Home Energy opens it
    function energyPage() {
      var conf = dashConf();
      var has = conf && Array.isArray(conf.views) && conf.views.some(function (v) { return v && v.path === 'energy'; });
      return has ? '/' + (String(location.pathname).split('/')[1] || '') + '/energy' : null;
    }
    var EX_PREVIEW_MS = 8000;              // HK Settings' preview: the first one soon

    // what the shell and the later parts use of this one
    K.ANALOG = ANALOG; K.ckFx = ckFx; K.DAY_GAP = DAY_GAP; K.deg = deg; K.energyPage = energyPage;
    K.EX_PREVIEW_MS = EX_PREVIEW_MS; K.facesModule = facesModule; K.inkOf = inkOf; K.landShares = landShares;
    K.minsOf = minsOf; K.photoLum = photoLum; K.pieceFile = pieceFile; K.piecesStarted = piecesStarted;
    K.sansClock = sansClock; K.sansSlides = sansSlides; K.textBox = textBox; K.weatherEntity = weatherEntity; K.faceScale = faceScale;
  };
})();
