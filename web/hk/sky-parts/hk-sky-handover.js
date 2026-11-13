// hk-sky-handover.js - the sky handed to the tablet app (phase 29, docs/phase29/PLAN.md).
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
//
// WHY. A wall tablet's page costs the most while its sky moves: Chromium draws the whole page and composes it again
// every frame anything in the sky moves, and every glass card blurs the moving sky again. Mantel for Android draws a
// busy sky on a surface of its own under a see-through page, at 30 frames a second, for about half of it (PLAN.md's
// table: Halloween night 1.86 -> 1.02 of a core on the Loft). A calm sky -- clouds inching along, a wallpaper -- costs
// Chromium only slivers, and stays the page's (decision 1).
//
// WHAT IT HANDS OVER. hk-sky stays the one sky: nothing about a scene is written twice. This reads what hk-sky built --
// every part under #hk-sky that moves by a CSS animation (the Web Animations API gives each one's keyframes, easing and
// timing), the parts between them and the root, and the still parts around them -- and has the app bake a picture of
// each part from this page, sheet by sheet, then play the same keyframes. A new kind of scene works in the app with no
// change, as long as it moves by CSS keyframes on transform and opacity, as every scene does today.
//
// BUSY, decided at each hand-over from the keyframes themselves, not from a list of scenes (busyOf): a part that moves
// faster than BUSY_SPEED, a flipbook (steps()), or something falling -- a loop that carries a part down the screen (rain,
// snow, leaves). Nothing busy: the sky is the page's, and one the app plays is handed back.
//
// ...AND ONLY WHILE NOTHING ELSE ON THE PAGE MOVES (pageMoves, measured on the Loft 2026-11-13): a washer spinning on
// the Laundry block, a playing video, moving things in front of the cards -- the page then makes every frame anyway, so
// handing the sky over saved it little, and Android composed the app's sky with a page changing out of step with it:
// pouring rain cost 2.08 of a core handed over against 1.67 kept (1.24-1.31 against 1.29-1.52 with the washer still).
//
// WHERE. Only where the page's host offers a player (hkShell.skyPlayer(): Mantel's shell answers with the tablet app's
// bridge; Home Assistant's facade answers none) and the wall tablet's own setting says so (Wall Tablets -> the tablet ->
// Mantel for Android -> Sky Drawn by the App, `app_sky`, hk_core/settings/model/tablet_rules.py). Never in front of the
// cards (Sky -> Moving Things -> In Front stays the page's), and only under a glass the frost picture can stand in for
// (hk-glass.js FROST): the live blur sees only the see-through page.
//
// HOW (the prototype's, mantel-android's docs/NATIVE-SKY.md). Baking: everything but the parts on one sheet hidden, the
// cards in every shadow root too, the parts moved to free places with the `translate` property (their own transform
// untouched), a colored mark in the corner; the app copies the window as the display shows it, so canvases, masks and
// filters bake exactly as Chromium draws them. Only what changed is baked: each part has a signature (sigOf), and one
// already baked keeps its picture in the app. Then the page's own sky is clipped away -- not hidden: hk-skyshot leaves a
// hidden piece out of the glass's picture -- and its animations paused. While the app plays, the page's times are kept up
// with the app's, and a crossing that ends in the app (realistic clouds, `fill: both`) is finished on the page, so
// hk-sky sends the next one as it always does.
//
// THE PLAYER (hk-shell.d.ts HkSkyPlayer): send(op, data) -> a Promise of the app's answer.
//   switch {on}   this tablet's setting, so the app sets up its surface at start next time
//   begin         cover the glass with a picture of it while the sheets are baked
//   sheet {...}   the page shows one sheet: keep each item's part
//   play {...}    the scene and the pictures: play it
//   shown         the page's own sky is away: uncover
//   hold {on}     the page's sky is held (hk-sky's .held/.hidden, the black curtain): the app's too
//   stop          the page draws its own sky again
// @ts-check
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-handover'] = function (K) {
    var ST = K.ST;

    var MARGIN = 24;          // CSS px around a part: its drop shadow, a glow
    var QUIET = 3000;         // the sky still this long after a change before it is handed over again
    var SPACING = 8000;       // and at most this often (most hand-overs bake a picture or two, or nothing)
    var LOOK = 60000;         // a look once a minute, whatever was heard
    var RETRY = 60000;        // after a hand-over failed
    // WHAT IS BUSY (decision 1): faster than this, in CSS px a second, at any point of its keyframes
    var BUSY_SPEED = 100;
    var OURS = ['hk-sky-app'];
    var info = { state: 'off', bakes: 0, same: 0, finished: 0, last: null, error: null, busy: null, why: '' };

    var css = null;
    function style() {
      if (css || !document.head) return;
      css = document.createElement('style');
      css.setAttribute('data-hk-sky-handover', '');
      css.textContent =
        'html.hk-sky-app,html.hk-sky-app body{background:transparent!important}' +
        // HIDDEN BY A CLIP, NOT BY VISIBILITY: hk-glass paints its frost from the sky's own pieces (hk-skyshot reads
        // their computed style), and a hidden piece is one it leaves out
        '#hk-sky.hk-sky-app{clip-path:inset(50%)!important}' +
        '#hk-sky.hk-sky-app *{animation-play-state:paused!important;will-change:auto!important}' +
        'html.hk-sky-bake,html.hk-sky-bake body{background:transparent!important}' +
        'html.hk-sky-bake *{visibility:hidden!important}' +
        'html.hk-sky-still #hk-sky,html.hk-sky-still #hk-sky *{transition:none!important}' +
        'html.hk-sky-bake #hk-sky *{animation-play-state:paused!important}';
      document.head.appendChild(css);
    }

    function frames(n) {
      return new Promise(function (r) { var f = function () { if (--n <= 0) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    }
    function rootEl() {
      var r = ST.mounted;
      return r && r.isConnected && r.id === 'hk-sky' && !r._hkFlat ? r : null;
    }

    // -- where: the player, the tablet's setting, the glass ----------------------------------------------------------
    function player() {
      var SH = window.hkShell;
      try { return SH && typeof SH.skyPlayer === 'function' ? SH.skyPlayer() || null : null; } catch (e) { return null; }
    }
    // this page's wall tablet wants it (hkSettings.tablet(): its own setting, Sky Drawn by the App)
    function wantedHere() {
      var HS = window.hkSettings, t = null;
      try { t = HS && typeof HS.tablet === 'function' ? HS.tablet() : null; } catch (e) { t = null; }
      return !!(t && !t.legacy && t.app_sky === true);
    }
    function send(op, data) {
      var P = player();
      if (!P) return Promise.resolve(false);
      try { return Promise.resolve(P.send(op, data == null ? null : data)).catch(function () { return false; }); } catch (e) { return Promise.resolve(false); }
    }

    // -- reading the sky -----------------------------------------------------------------------------------------------
    function cssAnims(e) {
      if (!e.getAnimations) return [];
      return e.getAnimations().filter(function (a) {
        var fx = /** @type {KeyframeEffect} */ (a.effect);
        return typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation && fx && fx.target === e &&
          !fx.pseudoElement && (a.playState === 'running' || a.playState === 'paused');
      });
    }
    var ATOMIC = { SVG: 1, svg: 1, IMG: 1, CANVAS: 1, VIDEO: 1 };
    function atomic(e) { return !!ATOMIC[e.tagName]; }
    function ownPaint(e, cs) {
      if (atomic(e)) return true;
      if (cs.backgroundImage !== 'none') return true;
      if (!/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(cs.backgroundColor)) return true;
      if (cs.boxShadow !== 'none') return true;
      if (parseFloat(cs.borderTopWidth) || parseFloat(cs.borderLeftWidth) || parseFloat(cs.borderRightWidth) ||
          parseFloat(cs.borderBottomWidth)) return true;
      for (var c = e.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.data.trim()) return true;
      return false;
    }
    function zOf(e) { var z = parseInt(getComputedStyle(e).zIndex, 10); return isNaN(z) ? 0 : z; }
    function num(s, ref) {
      s = String(s).trim();
      var v = parseFloat(s);
      if (isNaN(v)) return 0;
      if (/%$/.test(s)) return v / 100 * ref;
      if (/rad$/.test(s)) return v * 180 / Math.PI;
      if (/turn$/.test(s)) return v * 360;
      return v;
    }
    /** "translate3d(-32.5%, 0px, 0px) scaleY(0.5)" -> [["t", x, y], ["s", 1, 0.5]] (% of the box) */
    function ops(str, w, h) {
      if (!str || str === 'none') return [];
      var out = [], re = /([a-zA-Z0-9]+)\(([^)]*)\)/g, m;
      while ((m = re.exec(str))) {
        var f = m[1], a = m[2].split(',').map(function (x) { return x.trim(); });
        switch (f) {
          case 'translate3d': case 'translate': out.push(['t', num(a[0], w), a[1] != null ? num(a[1], h) : 0]); break;
          case 'translateX': out.push(['t', num(a[0], w), 0]); break;
          case 'translateY': out.push(['t', 0, num(a[0], h)]); break;
          case 'scale': case 'scale3d': out.push(['s', num(a[0], 1), a[1] != null ? num(a[1], 1) : num(a[0], 1)]); break;
          case 'scaleX': out.push(['s', num(a[0], 1), 1]); break;
          case 'scaleY': out.push(['s', 1, num(a[0], 1)]); break;
          case 'rotate': case 'rotateZ': out.push(['r', num(a[0], 1)]); break;
          case 'matrix': out.push(/** @type {any[]} */ (['m']).concat(a.slice(0, 6).map(Number))); break;
          case 'matrix3d': out.push(['m', +a[0], +a[1], +a[4], +a[5], +a[12], +a[13]]); break;
          default:
            try { var d = new DOMMatrix(m[0]); out.push(['m', d.a, d.b, d.c, d.d, d.e, d.f]); } catch (e) { /* skip */ }
        }
      }
      return out;
    }
    function keyList(kfs, prop, parse, under) {
      var list = kfs.filter(function (k) { return k[prop] != null; }).map(function (k) {
        return { at: k.computedOffset, v: parse(k[prop]), e: k.easing || 'linear' };
      });
      if (!list.length) return null;
      if (list[0].at > 0) list.unshift({ at: 0, v: under, e: list[0].e });
      if (list[list.length - 1].at < 1) list.push({ at: 1, v: under, e: 'linear' });
      return list;
    }
    function animOf(a, box) {
      var t = a.effect.getComputedTiming(), kfs = a.effect.getKeyframes(), it = t.iterations;
      var timing = a.effect.getTiming ? a.effect.getTiming() : {};
      return {
        dur: typeof t.duration === 'number' ? t.duration : 0, delay: t.delay || 0,
        iter: isFinite(it) ? it : -1, dir: t.direction || 'normal', fill: t.fill || 'none',
        rate: a.playbackRate, ct: a.currentTime || 0, ease: timing.easing || 'linear',
        o: keyList(kfs, 'opacity', function (v) { return parseFloat(v); }, 1),
        t: keyList(kfs, 'transform', function (v) { return ops(v, box.width, box.height); }, [])
      };
    }

    // -- busy (decision 1) ----------------------------------------------------------------------------------------------
    // where a list of transform operations moves the part's origin to (translations and a matrix's; scale and rotation
    // turn it in place)
    function shift(list) {
      var x = 0, y = 0;
      (list || []).forEach(function (o) {
        if (o[0] === 't') { x += o[1]; y += o[2]; } else if (o[0] === 'm') { x += o[5]; y += o[6]; }
      });
      return [x, y];
    }
    // ONE ANIMATION'S VERDICT: '' (calm), 'flipbook', 'fast' or 'falling'. `a` is animOf's.
    function busyAnim(a) {
      if (!a || !(a.dur > 0)) return '';
      var rate = Math.abs(a.rate || 1);
      var steps = /steps\(|step-(start|end)/;
      if (steps.test(a.ease || '')) return 'flipbook';
      var lists = [a.t, a.o].filter(Boolean);
      for (var i = 0; i < lists.length; i++) for (var j = 0; j < lists[i].length; j++) if (steps.test(lists[i][j].e || '')) return 'flipbook';
      if (!a.t) return '';
      var top = 0, fall = 0, across = 0;
      for (var k = 1; k < a.t.length; k++) {
        var p = shift(a.t[k - 1].v), q = shift(a.t[k].v), dt = (a.t[k].at - a.t[k - 1].at) * a.dur / rate;
        var dx = q[0] - p[0], dy = q[1] - p[1];
        if (dt > 0) top = Math.max(top, Math.sqrt(dx * dx + dy * dy) / dt * 1000);
        fall += dy; across += Math.abs(dx);
      }
      if (top > BUSY_SPEED) return 'fast';
      // FALLING: a loop that carries the part down the screen and starts again (a rain or snow deck, a leaf)
      if (a.iter < 0 && a.dir === 'normal' && fall > 40 && fall > across) return 'falling';
      return '';
    }
    // THE SCENE'S VERDICT: the first busy part's why, or '' when everything is calm
    function busyOf(nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var as = nodes[i].anims || [];
        for (var j = 0; j < as.length; j++) { var b = busyAnim(as[j]); if (b) return b; }
      }
      return '';
    }
    // A LOOK WITHOUT TOUCHING ANYTHING: the sky's animations as they are, judged (the full read lays parts flat)
    function busyNow(root) {
      var out = [];
      [root].concat(Array.from(root.querySelectorAll('*'))).forEach(function (e) {
        var as = cssAnims(e);
        if (!as.length) return;
        var box = { width: e.offsetWidth || 0, height: e.offsetHeight || 0 };
        if (!box.width && !box.height && e.getBoundingClientRect) { var r = e.getBoundingClientRect(); box = { width: r.width, height: r.height }; }
        out.push({ anims: as.map(function (a) { return animOf(a, box); }) });
      });
      return busyOf(out);
    }

    // WHAT ELSE MOVES (the ...AND ONLY WHILE above): a running animation outside the sky that won't end soon (a loop, or
    // more than LONG left), in any shadow root, or a playing video; '' when nothing does, else what moves
    var LONG = 5000;
    function pageMoves() {
      var sky = rootEl(), found = '';
      (function walk(/** @type {Document | ShadowRoot} */ r) {
        var all = r.querySelectorAll('*');
        for (var i = 0; i < all.length && !found; i++) {
          var e = all[i];
          if (sky && (e === sky || sky.contains(e))) continue;
          if (e.tagName === 'VIDEO' && !(/** @type {HTMLVideoElement} */ (e)).paused) { found = 'video'; break; }
          var as = e.getAnimations ? e.getAnimations() : [];
          for (var j = 0; j < as.length; j++) {
            var a = as[j];
            if (a.playState !== 'running' || !a.effect) continue;
            var t = a.effect.getComputedTiming(), end = typeof t.endTime === 'number' ? t.endTime : Infinity;
            if (!isFinite(end) || end - (Number(a.currentTime) || 0) > LONG) {
              found = String(/** @type {any} */ (a).animationName || e.tagName.toLowerCase()); break;
            }
          }
          if (e.shadowRoot) walk(e.shadowRoot);
        }
      })(document);
      return found;
    }

    // -- one hand-over --------------------------------------------------------------------------------------------------
    var handed = new WeakSet(), playedAt = 0, touched = [], keyN = 0, lastShape = null;
    // WHAT IS BAKED ALREADY, by what it looks like (sigOf): a part that hasn't changed keeps its picture in the app
    var baked = new Map();
    function setImp(e, p, v) { e.style.setProperty(p, v, 'important'); touched.push([e, p]); }
    function unsetAll() { touched.forEach(function (t) { t[0].style.removeProperty(t[1]); }); touched = []; }
    // a canvas's pixels, in short: drawn small into 8 x 8 and read back once
    var probe = null;
    function canvasSig(c) {
      try {
        if (!probe) { probe = document.createElement('canvas'); probe.width = 8; probe.height = 8; }
        var x = probe.getContext('2d', { willReadFrequently: true });
        x.clearRect(0, 0, 8, 8); x.drawImage(c, 0, 0, 8, 8);
        var d = x.getImageData(0, 0, 8, 8).data, h = 0;
        for (var i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0;
        return c.width + 'x' + c.height + ':' + h;
      } catch (e) { return c.width + 'x' + c.height + ':' + Math.random(); }
    }
    function playing() { return info.state === 'playing'; }
    function clipOn(on) {
      var r = rootEl(), html = document.documentElement;
      if (r) r.classList.toggle('hk-sky-app', on);
      html.classList.toggle('hk-sky-app', on);
    }

    // THE SKY READ AND, IF BUSY, HANDED OVER (or what is new in it baked). Resolves to what happened: 'calm', 'same',
    // 'played'; throws when the app or the glass couldn't.
    async function handOver() {
      var root = rootEl();
      if (!root) throw new Error('no sky');
      var t0 = performance.now(), html = document.documentElement;
      var live = root.classList.contains('hk-sky-app') && playing();
      var covered = false, shadows = [];
      async function cover() {
        if (covered) return;
        if (!(await send('begin'))) throw new Error('no cover');
        covered = true;
      }
      // the sky as it stands -- no transitions, or a part fading in reads as hidden
      html.classList.add('hk-sky-still');
      var shown = new Set(), gone = new Set();
      try {
        // (a part at opacity 0 that doesn't animate shows nothing, nor does anything inside it)
        [root].concat(Array.from(root.querySelectorAll('*'))).forEach(function (e) {
          if (e.parentElement && gone.has(e.parentElement)) { gone.add(e); return; }
          var cs = getComputedStyle(e);
          if (parseFloat(cs.opacity) === 0 && !cssAnims(e).length) { gone.add(e); return; }
          if (cs.visibility === 'visible' && (!e.checkVisibility || e.checkVisibility())) shown.add(e);
        });
        // the app's sky kept moving since the last hand-over: the page's catches up, so nothing jumps
        var gap = playedAt ? performance.now() - playedAt : 0, syncAt = performance.now();
        // the moving parts and everything between them and the sky's root
        var movers = [], skel = new Set([root]);
        root.querySelectorAll('*').forEach(function (e) {
          if (!shown.has(e)) return;
          var as = cssAnims(e);
          if (!as.length) return;
          if (gap) as.forEach(function (a) { if (handed.has(a)) a.currentTime = (a.currentTime || 0) + gap * a.playbackRate; });
          movers.push(e);
          for (var x = e; x && x !== root; x = x.parentElement) skel.add(x);
        });
        // each part's resting opacity and transform, then laid flat for measuring and baking
        var nodes = [], ids = new Map();
        var order = [root].concat(Array.from(root.querySelectorAll('*')).filter(function (e) { return skel.has(e); }));
        order.forEach(function (e, i) {
          var cs = getComputedStyle(e), as = e === root ? [] : cssAnims(e);
          ids.set(e, i);
          nodes.push({ el: e, id: i, parent: e === root ? -1 : ids.get(e.parentElement), as: as,
            bo: parseFloat(cs.opacity), btStr: cs.transform, origin: cs.transformOrigin,
            movesT: as.some(function (a) { return a.effect.getKeyframes().some(function (k) { return k.transform != null; }); }) });
        });
        // BUSY? read before anything is laid flat (the boxes as they are)
        var why = busyOf(nodes.map(function (n) {
          var box = { width: n.el.offsetWidth || 0, height: n.el.offsetHeight || 0 };
          return { anims: n.as.map(function (a) { return animOf(a, box); }) };
        }));
        info.busy = why;
        if (!why) return 'calm';
        if (!live) await cover();
        nodes.forEach(function (n) { setImp(n.el, 'opacity', '1'); setImp(n.el, 'transform', 'none'); });
        var vw = innerWidth, vh = innerHeight, items = [], rects = {};
        var moves = function (n) { for (; n; n = n.parent >= 0 ? nodes[n.parent] : null) if (n.movesT) return true; return false; };
        var rectOf = function (els, deep, n) {
          var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
          var add = function (e) {
            var q = e.getBoundingClientRect();
            if (!q.width && !q.height) return;
            l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
          };
          els.forEach(function (e) { add(e); if (deep) e.querySelectorAll('*').forEach(function (d) { if (shown.has(d)) add(d); }); });
          if (l === Infinity) return null;
          l -= MARGIN; t -= MARGIN; r += MARGIN; b += MARGIN;
          if (!moves(n)) { l = Math.max(l, 0); t = Math.max(t, 0); r = Math.min(r, vw); b = Math.min(b, vh); }
          l = Math.floor(l); t = Math.floor(t); r = Math.ceil(r); b = Math.ceil(b);
          return r > l && b > t ? { x: l, y: t, w: r - l, h: b - t } : null;
        };
        // what a part looks like: everything in it that paints, as the browser has it now
        var sigOf = function (it) {
          var parts = [JSON.stringify(it.r)];
          (it.self ? [it.self] : it.els).forEach(function (e) {
            var list = it.self && !it.deep ? [e] : [e].concat(Array.from(e.querySelectorAll('*')));
            list.forEach(function (d) {
              if (!shown.has(d) || (d !== e && skel.has(d))) return;
              var cs = getComputedStyle(d), sk = skel.has(d);
              parts.push(d.tagName, typeof d.className === 'string' ? d.className : '', d.offsetLeft, d.offsetTop,
                d.offsetWidth, d.offsetHeight, cs.backgroundImage, cs.backgroundColor, cs.backgroundSize, cs.backgroundPosition,
                sk ? '' : cs.opacity, sk ? '' : cs.transform, cs.filter, cs.maskImage || cs.webkitMaskImage || '',
                cs.borderRadius, cs.boxShadow, cs.zIndex,
                d.tagName === 'CANVAS' ? canvasSig(d) : d.tagName === 'IMG' ? d.currentSrc : '',
                d.tagName === 'svg' ? d.innerHTML.length : '');
            });
          });
          return parts.join('|');
        };
        var addItem = function (it) {
          it.sig = sigOf(it);
          var had = baked.get(it.sig);
          it.key = had || ('p' + (keyN++));
          it.reuse = !!had;
          rects[it.key] = it.r;
          items.push(it);
          return { k: 'b', key: it.key };
        };
        nodes.forEach(function (n) {
          var e = n.el, box = e.getBoundingClientRect(), o = n.origin.split(' ');
          n.box = box;
          n.ox = box.left + num(o[0], box.width); n.oy = box.top + num(o[1], box.height);
          n.items = [];
          var cs = getComputedStyle(e);
          if (shown.has(e) && ownPaint(e, cs)) {
            var r1 = rectOf([e], atomic(e), n);
            if (r1) n.items.push(addItem({ r: r1, self: e, deep: atomic(e) }));
          }
          if (atomic(e)) return;
          var kids = Array.from(e.children).map(function (c, i) { return { c: c, i: i, z: zOf(c) }; })
            .sort(function (a, b) { return a.z - b.z || a.i - b.i; });
          var run = null;
          kids.forEach(function (x) {
            var c = x.c;
            if (skel.has(c)) { run = null; n.items.push({ k: 'n', id: ids.get(c) }); return; }
            if (gone.has(c) || (!shown.has(c) && !c.querySelector('*'))) return;
            if (!run) { run = { els: [] }; n.items.push(run); }
            run.els.push(c);
          });
          n.items = n.items.map(function (it) {
            if (!it.els) return it;
            var r2 = rectOf(it.els, true, n);
            return r2 ? addItem({ r: r2, els: it.els }) : null;
          }).filter(Boolean);
        });
        var fresh = items.filter(function (it) { return !it.reuse; });
        // the sheets, for what is new: big parts in tiles of the screen's size, the rest packed in rows
        var sheets = [], small = [];
        fresh.forEach(function (it) {
          if (it.r.w > vw / 2 || it.r.h > vh / 2) {
            for (var ty = 0; ty < it.r.h; ty += vh) for (var tx = 0; tx < it.r.w; tx += vw)
              sheets.push([{ it: it, ox: tx, oy: ty, w: Math.min(vw, it.r.w - tx), h: Math.min(vh, it.r.h - ty), sx: 0, sy: 0 }]);
          } else small.push(it);
        });
        small.sort(function (a, b) { return b.r.h - a.r.h; });
        var cur = null, x = 0, y = 0, rowH = 0;
        small.forEach(function (it) {
          if (!cur || x + it.r.w > vw) { x = 0; y += rowH + 2; rowH = 0; }
          if (!cur || y + it.r.h > vh) { cur = []; sheets.push(cur); x = 0; y = 0; rowH = 0; }
          cur.push({ it: it, ox: 0, oy: 0, w: it.r.w, h: it.r.h, sx: x, sy: y });
          x += it.r.w + 2; rowH = Math.max(rowH, it.r.h);
        });
        if (sheets.length) {
          await cover();
          clipOn(false);
          html.classList.add('hk-sky-bake');
          // the cards, the header... live in shadow roots, where the page's rule doesn't reach and a style of their own
          // can say visible: hidden in each one (the sky itself is in the light DOM)
          (function walk(/** @type {Document | ShadowRoot} */ r) {
            r.querySelectorAll('*').forEach(function (e) {
              if (!e.shadowRoot) return;
              var st = document.createElement('style');
              st.textContent = '*{visibility:hidden!important}';
              e.shadowRoot.appendChild(st); shadows.push(st);
              walk(e.shadowRoot);
            });
          })(document);
          var markEl = document.createElement('div');
          html.appendChild(markEl);
          shadows.push(markEl);
          for (var s = 0; s < sheets.length; s++) {
            var mark = touched.length;
            sheets[s].forEach(function (p) {
              var dx = p.sx - (p.it.r.x + p.ox) + 'px', dy = p.sy - (p.it.r.y + p.oy) + 'px';
              var els = p.it.self ? [p.it.self] : p.it.els;
              els.forEach(function (e) {
                if (shown.has(e)) setImp(e, 'visibility', 'visible');
                setImp(e, 'translate', dx + ' ' + dy);
                if (p.it.self && !p.it.deep) return;
                e.querySelectorAll('*').forEach(function (d) { if (shown.has(d) && !skel.has(d)) setImp(d, 'visibility', 'visible'); });
              });
            });
            // THE SHEET'S MARK: a few pixels of its own color in the bottom right corner, so the app knows its copy is
            // of this sheet and not a frame late (on the Loft, 6 of 23 copies were)
            var mk = [(37 * (s + 1) + 40) % 256, (101 * (s + 1) + 80) % 256, (199 * (s + 1) + 120) % 256];
            markEl.style.cssText = 'position:fixed;right:0;bottom:0;width:6px;height:6px;z-index:2147483647;pointer-events:none;' +
              'visibility:visible!important;opacity:1!important;background:rgb(' + mk.join(',') + ')!important';
            await frames(2);
            var ok = await send('sheet', { vw: vw, mark: mk, items: sheets[s].map(function (p) {
              return { key: p.it.key, x: p.sx, y: p.sy, w: p.w, h: p.h, ox: p.ox, oy: p.oy, fw: p.it.r.w, fh: p.it.r.h };
            }) });
            if (!ok) throw new Error('sheet ' + s);
            touched.splice(mark).forEach(function (t) { t[0].style.removeProperty(t[1]); });
          }
        }
        // the keyframes, read now -- the page's times caught up once more with the app's, which kept moving while this
        // baked (or the bats jumped back by the bake's length)
        var more = playedAt ? performance.now() - syncAt : 0;
        if (more) nodes.forEach(function (n) { n.as.forEach(function (a) { if (handed.has(a)) a.currentTime = (a.currentTime || 0) + more * a.playbackRate; }); });
        var scene = { vw: vw, vh: vh, nodes: nodes.map(function (n) {
          var box = n.box;
          n.as.forEach(function (a) { handed.add(a); });
          return { id: n.id, parent: n.parent, ox: n.ox, oy: n.oy, bo: n.bo,
            bt: n.movesT ? [] : ops(n.btStr, box.width, box.height),
            anims: n.as.map(function (a) { return animOf(a, box); }), items: n.items };
        }) };
        unsetAll();
        shadows.forEach(function (st) { st.remove(); }); shadows = [];
        html.classList.remove('hk-sky-bake');
        var keep = items.filter(function (it) { return it.reuse; }).map(function (it) { return it.key; });
        // NOTHING CHANGED -- the same parts, keyframes and pictures (hk-sky rewrites its colors to what they were): the
        // app's sky goes on as it is (the page's times are caught up with it already)
        var shape = JSON.stringify(scene, function (k, v) { return k === 'ct' || k === 'ease' ? undefined : v; });
        if (live && !fresh.length && shape === lastShape) {
          playedAt = performance.now();
          info.same++;
          return 'same';
        }
        // THE GLASS FIRST: it wears the frost picture before the page's own sky goes, or the cards would show the app's
        // sky sharp through a blur that sees nothing (hk-glass.js FROST)
        if (!live && !(await glassReady())) throw new Error('glass');
        if (!(await send('play', { scene: scene, rects: rects, keep: keep }))) throw new Error('play');
        lastShape = shape;
        playedAt = performance.now();
        baked = new Map(items.map(function (it) { return [it.sig, it.key]; }));
        clipOn(true);
        finishLater(nodes);
        if (covered) { await frames(2); await send('shown'); }
        info.bakes++;
        info.last = { ms: Math.round(performance.now() - t0), nodes: nodes.length, movers: movers.length, pictures: items.length,
          baked: fresh.length, kept: keep.length, sheets: sheets.length, covered: covered, why: why };
        return 'played';
      } catch (e) {
        baked = new Map(); lastShape = null;   // (half a bake: nothing in the app can be trusted to match)
        if (covered && !live) { try { await send('stop'); } catch (x) { /* */ } }
        throw e;
      } finally {
        unsetAll();
        shadows.forEach(function (st) { st.remove(); });
        html.classList.remove('hk-sky-bake');
        html.classList.remove('hk-sky-still');
        if (live && playing() && !root.classList.contains('hk-sky-app')) clipOn(true);
      }
    }
    function glassReady() {
      var G = window.hkGlass;
      if (!G || typeof G.frost !== 'function') return Promise.resolve(!looksBlurred());
      return Promise.resolve(G.frost(true)).catch(function () { return false; });
    }
    // no hk-glass at all: only a look that blurs nothing may go on without it
    function looksBlurred() {
      var HS = window.hkSettings, g = '';
      try { g = HS && HS.glass ? HS.glass() : ''; } catch (e) { g = ''; }
      return /^(blur|bright)/.test(g);
    }

    // ONE CROSSING EACH (realistic clouds: hk-sky sends the next cloud on `animationend`). The page's sky is paused while
    // the app plays it, so the page's crossing never ends by itself: it is finished on the page when the app's ends.
    var finishTimers = [], finishDue = [];
    function finishLater(nodes) {
      finishTimers.forEach(clearTimeout); finishTimers = []; finishDue = [];
      nodes.forEach(function (n) {
        n.as.forEach(function (a) {
          var t = a.effect.getComputedTiming();
          if (!isFinite(t.endTime)) return;
          var left = Math.max(0, (t.endTime - (a.currentTime || 0)) / (a.playbackRate || 1));
          finishTimers.push(setTimeout(function () { finish(a); }, left + 30));
        });
      });
    }
    function finish(a) {
      if (busy) { finishDue.push(a); return; }          // (not in the middle of a hand-over: after it)
      try {
        if (a.playState !== 'finished' && a.effect && a.effect.target && a.effect.target.isConnected) { a.finish(); info.finished++; }
      } catch (e) { /* gone */ }
    }

    // -- when -----------------------------------------------------------------------------------------------------------
    var busy = false, lastRun = 0, observed = null, mo = null, held = false, timer = 0, pendingWhileHeld = false, started = false;
    // held: hk-sky's own (.held under a kiosk's black, .hidden behind photos), or HK's black curtain over the page --
    // nothing of the sky shows, so the app's stops drawing too
    function curtained() {
      var c = document.querySelector('[data-hk-curtain]');
      if (!c) return false;
      var cs = getComputedStyle(c);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.95;
    }
    function isHeld() {
      var r = rootEl();
      return !!r && (r.classList.contains('held') || r.classList.contains('hidden') || curtained());
    }
    function schedule(ms) {
      clearTimeout(timer);
      var at = Math.max(Date.now() + ms, lastRun + SPACING);
      timer = setTimeout(run, at - Date.now());
    }
    // THE SKY BACK TO THE PAGE (calm, the setting off, no player, a failure): the app stops, the page's sky shows and
    // moves again, the glass is the look's own
    async function giveBack(why) {
      finishTimers.forEach(clearTimeout); finishTimers = []; finishDue = [];
      var was = playing();
      clipOn(false);
      baked = new Map(); lastShape = null; playedAt = 0;
      if (was) { try { await send('stop'); } catch (e) { /* the app has gone: its sky with it */ } }
      if (window.hkGlass && window.hkGlass.frost && window.hkGlass.frosted && window.hkGlass.frosted()) window.hkGlass.frost(false);
      info.why = why || '';
    }
    async function run() {
      if (busy) return;
      var P = player(), want = !!P && wantedHere();
      if (!want) {
        if (playing()) await giveBack(P ? 'switched off' : 'no player');
        info.state = 'off';
        if (P) tell(false);
        return;
      }
      tell(true);
      var root = rootEl();
      if (!root) { if (playing()) await giveBack('no sky'); info.state = 'off'; return; }
      if (isHeld() || document.hidden) { schedule(QUIET); return; }
      // SOMETHING ELSE MOVES: the page makes every frame anyway, and keeps its sky (looked at again in a minute)
      var other = pageMoves();
      info.moves = other;
      if (other) { if (playing()) await giveBack('the page moves: ' + other); info.state = 'page moves'; lastRun = Date.now(); return; }
      // CALM, at a look that changes nothing: the page keeps it (or has it back)
      if (!playing() && !busyNow(root)) { info.busy = ''; info.state = 'calm'; lastRun = Date.now(); return; }
      busy = true;
      try {
        var got = await handOver();
        lastRun = Date.now();
        if (got === 'calm') { if (playing()) await giveBack('calm'); info.state = 'calm'; }
        else { info.state = 'playing'; info.error = null; }
      } catch (e) {
        info.error = String(e && e.message || e);
        await giveBack('failed');
        info.state = 'failed';
        lastRun = Date.now();
        schedule(RETRY);
      } finally {
        busy = false;
        var due = finishDue; finishDue = [];
        due.forEach(finish);
      }
    }
    // the tablet's setting, told to the app when it changes (so its surface is set up at its next start)
    var told = null;
    function tell(on) {
      if (told === on) return;
      told = on;
      send('switch', { on: on });
    }
    // A BIG CHANGE (another page's sky, the weather, a season -- hk-sky-change) while the app plays: the sky is the
    // page's again at once, and handed over again once it has been quiet. A picture of another sky on the glass, or the
    // app's old sky behind a new page, would be wrong in the meantime; the page drawing it for a few seconds is not.
    var lastBig = null;
    function onSkyChange() {
      var S = window.hkSky, big = null;
      try { big = S && S.sig ? (S.sig() || {}).big : null; } catch (e) { big = null; }
      var changed = lastBig !== null && big !== lastBig;
      lastBig = big;
      if (changed && playing() && !busy) { giveBack('changed').then(function () { info.state = 'calm'; }); }
      schedule(QUIET);
    }
    function watch() {
      var r = rootEl();
      if (r === observed) return;
      observed = r;
      if (mo) { mo.disconnect(); mo = null; }
      if (!r) { if (playing() && !busy) giveBack('no sky').then(function () { info.state = 'off'; }); return; }
      mo = new MutationObserver(function (list) {
        if (busy) return;
        var real = list.some(function (m) {
          // (hk-sky sets many styles to what they were already: nothing changed)
          if (m.type === 'attributes' && m.oldValue === /** @type {Element} */ (m.target).getAttribute(m.attributeName || '')) return false;
          if (m.type !== 'attributes' || m.target !== r || m.attributeName !== 'class') return true;
          var strip = function (v) { return String(v || '').split(/\s+/).filter(function (c) { return c && OURS.indexOf(c) < 0; }).sort().join(' '); };
          return strip(m.oldValue) !== strip(r.className);
        });
        var h = isHeld();
        if (h !== held) { held = h; if (playing()) send('hold', { on: h }); }
        if (real) { if (h) pendingWhileHeld = true; else schedule(QUIET); }
      });
      mo.observe(r, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style'] });
      schedule(QUIET);
    }
    function start() {
      if (started || !player()) return;            // (a host with no player: nothing here ever runs)
      started = true;
      style();
      info.state = 'waiting';
      setInterval(function () { if (!busy && !held) schedule(0); }, LOOK);
      setInterval(function () {
        watch();
        if (!playing() || busy) return;
        var h = isHeld();
        if (h !== held) { held = h; send('hold', { on: h }); if (!h && pendingWhileHeld) { pendingWhileHeld = false; schedule(QUIET); } }
      }, 1000);
      window.addEventListener('hk-sky-change', onSkyChange);
      if (window.hkSettings && window.hkSettings.onChange) window.hkSettings.onChange(function () { schedule(QUIET); });
      setTimeout(watch, 1000);
    }
    // (the shell's hkSky is made after the parts run, and the host's shell may come a little later still)
    [0, 1000, 5000, 15000].forEach(function (ms) { setTimeout(start, ms); });

    // what the shell and the later parts use of this one: the status and the pieces the tests check
    window.hkSkyHandover = {
      status: function () { return Object.assign({ playing: playing() }, info); },
      again: function (all) { if (all) baked = new Map(); lastRun = 0; schedule(0); },
      start: start,
      _busyAnim: busyAnim, _busyOf: busyOf, _busyNow: busyNow, _pageMoves: pageMoves, _ops: ops, _shift: shift, BUSY_SPEED: BUSY_SPEED
    };
  };
})();
