// hk-sky-front.js - registering, mounting, the styles, the aurora, the front and liveliness.
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-front'] = function (K) {
    var BASE = K.BASE, rng = K.rng, SH = K.SH, ST = K.ST;

    // ------------------------------------------------------------------ style
    // NOTE: this is called SHEET, not CSS. Naming it CSS would shadow the global
    // CSS object inside this IIFE and silently break CSS.registerProperty below,
    // which would cost the cross-fade with no error anywhere.
    var FRONT_Z = 1;

    // Registering the gradient stops as <color> is what lets the sky CROSS-FADE
    // instead of jumping. An unregistered custom property has no type, so it can
    // only ever swap discretely -- sunrise would step through the palette in
    // visible slabs. hk-tap.js already relies on registerProperty for --hk-ring,
    // so support is proven on the same browsers.
    var REG = ['--sk0', '--sk1', '--sk2', '--sk3', '--clTop', '--clBot', '--glowC'];
    function register() {
      if (ST.registered || !window.CSS || !window.CSS.registerProperty) return;
      ST.registered = true;
      REG.forEach(function (name) {
        try {
          window.CSS.registerProperty({
            name: name, syntax: '<color>', inherits: true,
            initialValue: 'rgba(0,0,0,0)'
          });
        } catch (e) { /* already registered by an earlier import; harmless */ }
      });
    }

    // ------------------------------------------------------------------ mount
    // Walk UP out of however many shadow roots the card is nested in, rather
    // than querying DOWN from <home-assistant>. The path down changes with the
    // panel wrapper and wallpanel adds its own; up from the card is always the
    // same three hops.
    function container(card) {
      var n = card;
      for (var i = 0; i < 40 && n; i++) {
        if (SH.is(n, 'viewContainer')) return n;
        n = n.parentNode || n.host;
        if (n && n.nodeType === 11) n = n.host;   // ShadowRoot -> its host
      }
      return null;
    }

    function attachStyles(el) {
      var root = el.getRootNode();
      if (!root) return;
      try {
        if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
          ST.sheet = new CSSStyleSheet();
          ST.sheet.replaceSync(ST.SHEET);
          root.adoptedStyleSheets = root.adoptedStyleSheets.concat(ST.sheet);
          return;
        }
      } catch (e) { ST.sheet = null; }
      var tag = document.createElement('style');
      tag.id = 'hk-sky-style';
      tag.textContent = ST.SHEET;
      (root.appendChild ? root : document.head).appendChild(tag);
    }

    function detachStyles(el) {
      var root = el && el.getRootNode();
      if (root && ST.sheet && root.adoptedStyleSheets) {
        root.adoptedStyleSheets =
          root.adoptedStyleSheets.filter(function (s) { return s !== ST.sheet; });
      }
      ST.sheet = null;
      var tag = (root && root.querySelector && root.querySelector('#hk-sky-style'))
             || document.getElementById('hk-sky-style');
      if (tag) tag.remove();
    }

    // ------------------------------------------------------------ AURORA
    // THE NORTHERN LIGHTS AS SMALL CANVASES (2026-10-11). Each curtain was a
    // box 140% of the screen wide painted with two soft gradients -- about
    // half a screen of a wall tablet's tile memory each, a screen and a half
    // with the container (Christmas night had 2 screens less headroom than
    // the old decorations, measured headless with the budget capped). Nothing
    // in them is finer than a 50 px ramp, so they are drawn at a quarter of
    // their size into a canvas, which keeps its own pixel size on the GPU, and
    // scaled up; the curtains still drift and breathe as before (the band's
    // own animation). The same gradients as the CSS they replace: the
    // vertical glow under the 100deg stripes repeating every 18% of the
    // gradient line, each transparent stop the transparent of its neighbour
    // (CSS mixes premultiplied, so 'transparent' never greys a ramp).
    // (Measured against the CSS curtains: a mean difference of 0.7/255, and
    // Christmas night's headroom 4 -> 6 screens, the old decorations' own.)
    var AUR_RES = 0.25;
    function auroraCanvas(band) {
      var cv = document.createElement('canvas');
      if (!cv.getContext || !cv.getContext('2d')) return;
      band.appendChild(cv);
      band.classList.add('cv');
      band._hkCv = cv;
    }
    function auroraDraw(band) {
      var cv = band._hkCv;
      if (!cv) return;
      var W = band.clientWidth, H = band.clientHeight;
      if (!(W > 0) || !(H > 0)) return;
      var key = W + 'x' + H;
      if (cv._hkKey === key) return;
      cv._hkKey = key;
      cv.width = Math.max(1, Math.round(W * AUR_RES));
      cv.height = Math.max(1, Math.round(H * AUR_RES));
      var x = cv.getContext('2d');
      x.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
      // the glow: transparent to 8%, green by 42%, blue by 72%, gone at the foot
      var g = x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0.08, 'rgba(80,255,170,0)'); g.addColorStop(0.42, 'rgba(80,255,170,.5)');
      g.addColorStop(0.72, 'rgba(60,180,255,.14)'); g.addColorStop(1, 'rgba(60,180,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      // the stripes at 100deg: the CSS gradient line through the centre, its
      // length |W sin| + |H cos|, carried on to a whole number of repeats
      var a = 100 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
      var L = Math.abs(W * dx) + Math.abs(H * dy), P = 0.18, n = Math.ceil(1 / P);
      var x0 = W / 2 - dx * L / 2, y0 = H / 2 - dy * L / 2, span = L * P * n;
      var st = x.createLinearGradient(x0, y0, x0 + dx * span, y0 + dy * span);
      for (var k = 0; k < n; k++) {
        var b = k / n, u = 1 / n / P;      // a stop at fraction f of the line: b + f * u
        st.addColorStop(b, 'rgba(90,255,170,0)');
        st.addColorStop(b + 0.06 * u, 'rgba(90,255,170,0)');
        st.addColorStop(b + 0.09 * u, 'rgba(90,255,170,.42)');
        st.addColorStop(b + 0.13 * u, 'rgba(80,220,200,.18)');
        st.addColorStop(Math.min(1, b + 0.18 * u), 'rgba(80,220,200,0)');
      }
      x.fillStyle = st; x.fillRect(0, 0, W, H);
    }

    // ------------------------------------------------------------ FRONT
    // MOVING THINGS (Sky / Background, 2026-10-11): 'front' draws the rain and
    // snow, the falling leaves and petals, the bats and birds, the flybys, the
    // confetti and the fireflies OVER the cards; fireworks, fog and mist,
    // clouds and the scenery stay behind. The sky is one fixed layer under the
    // page (z-index -1, contain:strict), so nothing in it can be lifted over
    // the cards: the moving things are MOVED into a second layer, #hk-sky-front,
    // over the page and under everything HK lays over it, and back again.
    //   * Each keeps its CSS: every #hk-sky rule reaches #hk-sky-front (SHEET),
    //     and each moved node sits in a SHELL of each parent it had -- same tag,
    //     class and style, kept in step (a MutationObserver) -- so a rule like
    //     ".near-scenery.spooky .near-motion.night" still applies.
    //   * Its builders keep their references (a moved node is the same node);
    //     the lookups by selector look in the front too (skyQ / skyQA).
    //   * A placeholder marks where it was: back there on 'behind', and dropped
    //     with its home when the scene is rebuilt (the placeholder goes too).
    //   * Not one touch: pointer-events:none on the layer and everything in it.
    var FRONT_SEL = [
      ':scope > .rain', ':scope > .snow',
      ':scope > .near-scenery > .near-motion.leaves', ':scope > .near-scenery > .near-motion.swirl',
      ':scope > .near-scenery > .near-motion.petals', ':scope > .near-scenery > .near-motion.confetti',
      ':scope > .near-scenery > .near-motion.dusk', ':scope > .near-scenery > .near-motion.day',
      ':scope > .near-scenery > .near-motion.eve', ':scope > .near-scenery > .near-motion.night:not(.fireworks)',
      ':scope > .near-scenery > .near-motion.dark > .flock',
      ':scope > .season > .bat', ':scope > .season > .witch', ':scope > .season > .xflake',
      ':scope > .season > .sleigh', ':scope > .season > .leaffield', ':scope > .season > .sp-fall',
      ':scope > .season > .sp-fly'
    ].join(',');
    // the node itself, or its moved twin's -- where a moving thing is now
    function skyQ(node, sel) {
      var n = node.querySelector(sel);
      if (!n && node._hkShell) n = node._hkShell.querySelector(sel);
      return n;
    }
    function skyQA(node, sel) {
      var out = Array.prototype.slice.call(node.querySelectorAll(sel));
      if (node._hkShell) out = out.concat(Array.prototype.slice.call(node._hkShell.querySelectorAll(sel)));
      return out;
    }
    function mirror(from, to) {
      var c = String(from.className || '').replace(/\bown\b/, '').trim();
      if (to.className !== c) to.className = c;
      var st = from.getAttribute('style') || '';
      if ((to.getAttribute('style') || '') !== st) to.setAttribute('style', st);
    }
    function frontOf(sky) {
      var F = sky._hkFront;
      if (F && F.el.isConnected) return F;
      var el = document.createElement('div');
      el.id = 'hk-sky-front';
      el.setAttribute('aria-hidden', 'true');
      sky.parentNode.insertBefore(el, sky.nextSibling);
      F = sky._hkFront = { el: el, moved: [], shells: [], mo: null };
      sky._hkShell = el;
      F.mo = typeof MutationObserver === 'function' ? new MutationObserver(function (recs) {
        recs.forEach(function (r) { var t = r.target; if (t._hkShell) mirror(t, t._hkShell); });
      }) : null;
      F.watch = function (orig) { if (F.mo) F.mo.observe(orig, { attributes: true, attributeFilter: ['class', 'style'] }); };
      F.watch(sky);
      mirror(sky, el);
      return F;
    }
    // the shell of `orig` (a parent of a moved node) in the front, made once
    function shellOf(F, sky, orig) {
      if (orig === sky) return F.el;
      if (orig._hkShell && orig._hkShell.isConnected) return orig._hkShell;
      var sh = document.createElement(orig.localName || 'div');
      mirror(orig, sh);
      shellOf(F, sky, orig.parentNode).appendChild(sh);
      orig._hkShell = sh;
      F.shells.push(orig);
      F.watch(orig);
      return sh;
    }
    function frontSync(sky, on) {
      var F = sky._hkFront;
      if (!on) {
        if (!F) return;
        // every moving thing back where it was (gone with its home: gone)
        F.moved.forEach(function (m) {
          if (m.mark.parentNode) m.mark.parentNode.replaceChild(m.node, m.mark); else m.node.remove();
        });
        F.shells.forEach(function (o) { o._hkShell = null; });
        if (F.mo) F.mo.disconnect();
        F.el.remove();
        sky._hkFront = null; sky._hkShell = null;
        return;
      }
      if (!sky.parentNode) return;
      F = frontOf(sky);
      // a scene rebuilt took its placeholders with it: its moved things go too
      F.moved = F.moved.filter(function (m) {
        if (m.mark.isConnected) return true;
        m.node.remove();
        return false;
      });
      F.shells = F.shells.filter(function (o) {
        if (o.isConnected) return true;
        if (o._hkShell) o._hkShell.remove();
        o._hkShell = null;
        return false;
      });
      Array.prototype.forEach.call(sky.querySelectorAll(FRONT_SEL), function (n) {
        var mark = document.createComment('hk-front');
        var home = shellOf(F, sky, n.parentNode);
        n.parentNode.insertBefore(mark, n);
        home.appendChild(n);
        F.moved.push({ node: n, mark: mark });
      });
      mirror(sky, F.el);
    }

    // ------------------------------------------------------------ LIVELINESS
    // How many of the little moving things there are, and how often the ones
    // that cross come by (HK Settings -> Sky / Background: each occasion's and
    // each woodland season's Liveliness, and each screen's; plan:
    // hk_house/docs/PLAN-SKY-LIVELINESS-2026-10-08.md). A KNOB is one setting
    // of one effect; its step 0-4 is Off - Few - Normal - Lots - Max. A preset
    // sets every knob of its occasion at once; Classic (Normal, 2) is the sky
    // exactly as it was drawn before there were knobs.
    //   many   a count: so many leaves, petals, fireflies, bats in a flock
    //   often  a crossing's cycle: a flock, the geese, the witch, the sleigh,
    //          a flyby, a shooting star, a firework (Off: never comes)
    //   show   on or off: the owl, the mist, the rainbow, the balloons, the
    //          lights' twinkle
    // A knob's kind -- what a screen's own Custom scales: Flying, Falling,
    // Glowing, Night Sky. The same table is in settings.py (LIVELY_KNOBS) and
    // panels/hk-settings-model.js (LIVELY); test_season.js holds the three
    // together.
    var LV_KNOBS = {
      bats: ['flying', 'many'], bats_often: ['flying', 'often'], swarm: ['flying', 'many'],
      witch: ['flying', 'often'], geese: ['flying', 'often'], sleigh: ['flying', 'often'],
      flyby: ['flying', 'often'], balloons: ['flying', 'show'],
      leaves: ['falling', 'many'], swirl: ['falling', 'many'], petals: ['falling', 'many'],
      snow: ['falling', 'many'], particles: ['falling', 'many'], mist: ['falling', 'show'],
      fireflies: ['glowing', 'many'], glints: ['glowing', 'many'], lights: ['glowing', 'show'],
      owl: ['glowing', 'show'], rainbow: ['glowing', 'show'],
      stars: ['night', 'many'], meteors: ['night', 'often'], fireworks: ['night', 'often'],
      aurora: ['night', 'often']
    };
    var LV_MANY = [0, 0.5, 1, 1.6, 2.5];          // a count's factor, by step
    var LV_CYCLE = [0, 2, 1, 0.6, 0.4];           // a cycle's factor (0: never comes)
    var LV_PRESETS = { subtle: 1, classic: 2, festive: 3, party: 4 };
    function lvStep(v, dflt) { v = Number(v); return v >= 0 && v <= 4 && Math.round(v) === v ? v : dflt; }
    // The resolved Liveliness for a reading (read() puts skyLook().lively on it
    // as s.lively: this screen's own, or All Screens' -- the same shape at both
    // levels, 2026-10-09). `all`: one preset for every occasion, or 'custom':
    // then `occ` -- each occasion's preset -- and `custom`, a Custom one's
    // knobs. knob(occ, k): this occasion's step for knob k (2 = Normal); many /
    // cycle: the factors to apply; on: whether a `show` or `often` knob is on
    // at all. `sig` changes with every setting that can change what is built,
    // so a scene is rebuilt on a change and never otherwise.
    function lvOf(s) {
      var L = (s && s.lively) || {};
      var all = LV_PRESETS.hasOwnProperty(L.all) || L.all === 'custom' ? L.all : 'classic';
      var occs = L.occ || {}, cust = L.custom || {};
      function preset(occ) { return all === 'custom' ? (occs[occ] || 'classic') : all; }
      function knob(occ, k) {
        var p = preset(occ);
        if (p === 'custom') return lvStep((cust[occ] || {})[k], 2);
        return LV_PRESETS.hasOwnProperty(p) ? LV_PRESETS[p] : 2;
      }
      return {
        knob: knob,
        many: function (occ, k) { return LV_MANY[knob(occ, k)]; },
        cycle: function (occ, k) { return LV_CYCLE[knob(occ, k)]; },
        on: function (occ, k) { return knob(occ, k) !== 0; },
        // Calm When Nobody's Around, right now: thin the scene (lvThin) without
        // a rebuild
        quiet: !!L.quiet,
        sig: JSON.stringify([all, all === 'custom' ? occs : null, all === 'custom' ? cust : null]),
        // what changes THIS occasion's scene: its own setting (another
        // occasion's change rebuilds nothing on show)
        sigFor: function (occ) {
          var p = preset(occ);
          return JSON.stringify([p, p === 'custom' ? cust[occ] || null : null]);
        }
      };
    }
    // A count, scaled: Off is none; anything else at least one when there was
    // one to scale.
    function lvCount(base, f) {
      if (!(f > 0) || !(base > 0)) return 0;
      return Math.max(1, Math.round(base * f));
    }
    // MORE OR FEWER, AND THE REST OF THE SCENE UNMOVED. A builder draws its
    // `base` elements from the scene's own rnd exactly as before -- Classic is
    // byte-for-byte the old scene, and every later builder's draws are the
    // same whatever this one's count -- keeps the first `n` of them, and draws
    // any beyond the base from a stream of its own (`extra`). `each(i, r)`
    // builds element i from r and returns it; lvRange returns the kept ones.
    function lvRange(base, n, rnd, extraSeed, each) {
      var out = [], extra = null;
      for (var i = 0; i < Math.max(base, n); i++) {
        var r = rnd;
        if (i >= base) r = extra || (extra = rng(extraSeed));
        var node = each(i, r, i < n);
        if (i < n && node) out.push(node);
      }
      return out;
    }
    // CALM WHEN NOBODY'S AROUND thins a scene by half with no rebuild: every
    // second element of a count is marked `lv-t`, and a quiet scene
    // (.lv-quiet on its root) takes those out of the render tree.
    function lvThin(nodes) {
      for (var i = 1; i < nodes.length; i += 2) if (nodes[i] && nodes[i].classList) nodes[i].classList.add('lv-t');
      return nodes;
    }

    // A CROSSING THAT COMES MORE OR LESS OFTEN, AT THE SAME SPEED. Its
    // keyframes put the crossing in the first few percent of the cycle; a
    // longer or shorter cycle with the same keyframes would crawl or race
    // across. So a scaled copy is made -- every percentage times base/new --
    // and the element runs that copy for the new cycle. Made once per root
    // and scale (a constructed sheet of its own, beside the sky's).
    var KF_ROOTS = typeof WeakMap === 'function' ? new WeakMap() : null;
    function kfText(base) {
      var css = ST.SHEET + (typeof OWN_CSS === 'string' ? OWN_CSS : '');
      var at = css.indexOf('@keyframes ' + base + '{');
      if (at < 0) return null;
      var i = css.indexOf('{', at) + 1, depth = 1, j = i;
      while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
      return css.slice(i, j - 1);
    }
    function kfScale(body, s) {
      // selectors only: the text before each '{' at the top level of the body
      return body.replace(/(^|\})([^{}]*)\{/g, function (m, close, sel) {
        return close + sel.replace(/([0-9.]+)%/g, function (mm, p) {
          var v = Number(p);
          if (v === 0 || v === 100) return mm;
          return Math.min(99.9, v * s).toFixed(3).replace(/\.?0+$/, '') + '%';
        }) + '{';
      });
    }
    function lvKeyframes(ref, base, s) {
      if (!(s > 0) || Math.abs(s - 1) < 1e-3) return base;
      var name = base + '-x' + Math.round(s * 1000);
      try {
        var root = ref && ref.isConnected && ref.getRootNode ? ref.getRootNode() : document;
        var rec = KF_ROOTS && KF_ROOTS.get(root);
        if (!rec) {
          rec = { names: {}, sheet: null, tag: null };
          if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
            rec.sheet = new CSSStyleSheet();
            root.adoptedStyleSheets = root.adoptedStyleSheets.concat(rec.sheet);
          } else {
            rec.tag = document.createElement('style');
            (root.appendChild && root !== document ? root : document.head).appendChild(rec.tag);
          }
          if (KF_ROOTS) KF_ROOTS.set(root, rec);
        }
        if (!rec.names[name]) {
          var body = kfText(base);
          if (body === null) return base;
          rec.names[name] = 1;
          var rule = '@keyframes ' + name + '{' + kfScale(body, s) + '}';
          if (rec.sheet) rec.sheet.insertRule(rule, rec.sheet.cssRules.length);
          else rec.tag.textContent += rule;
        }
      } catch (e) { /* no stylesheet (a test harness): the name still says what was asked */ }
      return name;
    }
    // Run `el` on a crossing `base` keyframes for `baseCycle` seconds at a
    // factor of that cycle: the duration through `durVar` (or the animation
    // itself), the scaled keyframes by name. Returns the new cycle.
    // SHOW ME NOW (Sky Lab): every crosser in `el` -- a flock, the geese, the
    // witch, the sleigh, a flyby, a shooting star, a firework -- sent across at
    // once: each running crossing moved to the start of its next cycle, where
    // its crossing is. Returns how many.
    var CROSSERS = /^(near-flock|near-geese|hk-witchfly|hk-sleigh|hk-spfly|hk-spburst|hk-meteor|hk-fw)(-x[0-9]+)?$/;
    function showNow(el) {
      var n = 0;
      (function walk(node) {
        if (!node || !node.querySelectorAll) return;
        var all = node.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var anims = all[i].getAnimations ? all[i].getAnimations() : [];
          for (var j = 0; j < anims.length; j++) {
            var a = anims[j];
            if (!CROSSERS.test(a.animationName || '') || a.playState !== 'running' || !a.effect) continue;
            var t = a.effect.getComputedTiming();
            if (typeof t.progress !== 'number' || !(t.duration > 0)) continue;
            a.currentTime = a.currentTime + (1 - t.progress) * t.duration + 50;
            n++;
          }
          if (all[i].shadowRoot) walk(all[i].shadowRoot);
        }
      })(el);
      return n;
    }
    function lvCycleOn(el, ref, base, baseCycle, f, durVar) {
      var cyc = baseCycle * f;
      if (Math.abs(f - 1) < 1e-3) return baseCycle;
      var name = lvKeyframes(ref, base, baseCycle / cyc);
      el.style.animationName = name;
      if (durVar) el.style.setProperty(durVar, cyc.toFixed(1) + 's');
      else el.style.animationDuration = cyc.toFixed(1) + 's';
      return cyc;
    }

    // One table, seven themes. `a` and `l` are the frame's measured mean alpha
    // and ink luma, from dwebp -pam on the ENCODED webp -- same basis as SEASON
    // above, so the cap arithmetic describes what the page actually loads.
    //
    // The frames are BORDERS with open centers, which is why the coverage is so
    // much lower than the full-bleed seasonal art: the busiest, Valentine's, is
    // 0.090 against the Christmas decoration's 0.105 and the canopy's 0.084.
    //
    // `event` is a RARE flyby, built as a long-cycle CSS animation that parks the
    // element off-screen for most of the cycle -- the same shape as the witch and
    // the sleigh. Driving these from requestAnimationFrame and WAAPI would add a
    // second animation engine and a timer per theme.
    var SP_ASSET = {
      petal:     BASE + 'sp-petal.webp',
      heart:     BASE + 'sp-heart.webp',
      crystal:   BASE + 'sp-crystal.webp',
      firework:  BASE + 'sp-firework.webp',
      rocket:    BASE + 'sp-rocket.webp',
      butterfly: BASE + 'sp-butterfly.webp',
      fairy:     BASE + 'sp-fairy.webp'
    };

    // A SKY OF ITS OWN (HK Frontend 1.3): the forecast screensaver's
    // (hk-saver.js). The page's sky is ONE element in the view, hidden and still
    // behind any screensaver; this is a second one, built into the screensaver's
    // own shadow root with its own stylesheet, painted by the same paint() from
    // the same read() -- so it is the same live sky, weather and all -- plus a
    // landscape (tools/sky/src/land/, frontend/sky/land-*.webp) between the
    // clouds and the falling weather. paint() keeps its per-element state on the
    // element (el._hkSeasonKey), so the two never disturb each other.
    //
    //   var sc = hkSky.scene(container);  sc.update(client);  sc.pause(true);  sc.destroy();
    var OWN_CSS = [
      '#hk-sky.own{z-index:0}',
      '#hk-sky.own.skyonly .land,#hk-sky.own.skyonly .lbox,#hk-sky.own.skyonly .season,#hk-sky.own.skyonly .near-scenery{display:none}',
      '#hk-sky .land>i{position:absolute;inset:0;background-repeat:no-repeat;',
      '  background-position:center bottom;background-size:cover;opacity:0;',
      '  transition:opacity 4s ease;filter:brightness(var(--landB,1));will-change:opacity}',
      '#hk-sky .land>i.on{opacity:1}',
      // with a landscape, the horizon colour belongs where the land meets the
      // sky (the art's horizon is at ~60%), and the season's frame gives way to
      // the season's own land
      '#hk-sky.own.landed .grad{background:linear-gradient(to bottom,',
      '  var(--sk0) 0%,var(--sk1) 24%,var(--sk2) 44%,var(--sk3) 62%)}',
      // (the seasonal layer stays: paintSeason leaves its frames out here)
      // ---- twinkling stars: brighter stars over the star texture, each on its
      // own slow scintillation, faded with the stars (--starO)
      '#hk-sky .twk{opacity:var(--starO,0);transition:opacity 6s linear}',
      '#hk-sky .twk .st{position:absolute;width:var(--s);height:var(--s);',
      '  margin:calc(var(--s) / -2) 0 0 calc(var(--s) / -2);border-radius:50%;',
      '  background:#f6f8ff;box-shadow:0 0 calc(var(--s) * 2.2) rgba(214,226,255,.75);',
      '  opacity:.3;animation:hk-twk1 var(--td) ease-in-out var(--tdel) infinite}',
      // LONG LOOPS, several twinkles each. Every loop's end is a trip to the
      // main thread (the animation's timing is re-synced there), so 34 stars on
      // 3-9 s loops re-styled the page ~24 times a second; on 36-64 s loops
      // holding three or four twinkles, about twice. The same goes for every
      // flame, bulb and firefly below.
      '@keyframes hk-twk1{0%,100%{opacity:.3}6.5%{opacity:.3}8%{opacity:var(--pk)}10.5%{opacity:.3}34.5%{opacity:.3}36%{opacity:var(--pk)}38.5%{opacity:.3}61.5%{opacity:.3}63%{opacity:var(--pk)}' +
        '65.5%{opacity:.3}86.5%{opacity:.3}88%{opacity:var(--pk)}90.5%{opacity:.3}}',
      '@keyframes hk-twk2{0%,100%{opacity:.3}13.5%{opacity:.3}15%{opacity:var(--pk)}17.5%{opacity:.3}45.5%{opacity:.3}47%{opacity:var(--pk)}49.5%{opacity:.3}69.5%{opacity:.3}71%{opacity:var(--pk)}' +
        '73.5%{opacity:.3}}',
      '@keyframes hk-twk3{0%,100%{opacity:.3}21.5%{opacity:.3}23%{opacity:var(--pk)}25.5%{opacity:.3}53.5%{opacity:.3}55%{opacity:var(--pk)}57.5%{opacity:.3}80.5%{opacity:.3}82%{opacity:var(--pk)}' +
        '84.5%{opacity:.3}}',
      // ---- shooting stars: parked at opacity 0 for all but ~1.5% of a long
      // cycle, then a streak along the element's own rotated x-axis. Only on a
      // clear night (.meteors); each crossing re-aims the next (meteorAim)
      '#hk-sky .twk .ss{position:absolute;width:0;height:0;display:none;',
      '  transform:rotate(var(--a))}',
      '#hk-sky.meteors .twk .ss{display:block}',
      '#hk-sky .twk .ss i{position:absolute;right:0;top:-1px;width:var(--len);height:2px;',
      '  border-radius:2px;background:linear-gradient(to right,rgba(236,242,255,0),',
      '  rgba(236,242,255,.55) 70%,#fff);box-shadow:0 0 6px rgba(214,226,255,.6);',
      '  opacity:0;will-change:transform,opacity;',
      '  animation:hk-meteor var(--md) linear var(--mdel) infinite}',
      '@keyframes hk-meteor{0%{transform:translate3d(0,0,0);opacity:0}',
      '  .2%{opacity:1}.9%{opacity:.85}1.2%,100%{transform:translate3d(var(--run),0,0);opacity:0}}',
      // ---- the land's box (see layersHtml)
      // Centred by its LEFT, never a transform: under a transformed box the
      // flames, bulbs and fireflies stop animating on the compositor and redo
      // the page's style every frame (measured: 26 recalcs a second against 2)
      '#hk-sky .lbox{inset:auto;left:calc(50% - var(--lbw,100%) / 2);bottom:0;',
      '  width:var(--lbw,100%);height:var(--lbh,100%)}',
      '#hk-sky .lbox>*{position:absolute;inset:0}',
      // a holiday's LIGHTS LAYER: the full glow over the land's embers, two
      // layers cross-fading like the land's, dimmed with the land
      '#hk-sky .hl{opacity:var(--hlO,0);transition:opacity 4s ease;filter:brightness(var(--hlB,1))}',
      '#hk-sky .hl b,#hk-sky .hl i{position:absolute;inset:0}',
      '#hk-sky .hl i{background:center/100% 100% no-repeat;opacity:0;transition:opacity 4s ease}',
      '#hk-sky .hl i.on{opacity:1}',
      // candles gutter; café lights breathe
      '#hk-sky .hl.flick b{animation:hk-hlflick 17s linear infinite}',
      '@keyframes hk-hlflick{0%,100%{opacity:1}3%{opacity:.86}4%{opacity:.97}10%{opacity:.9}',
      '  12%{opacity:1}18%{opacity:.84}20%{opacity:.95}29%{opacity:.88}31%{opacity:1}',
      '  40%{opacity:.85}42%{opacity:.96}53%{opacity:.9}55%{opacity:1}63%{opacity:.83}',
      '  66%{opacity:.97}75%{opacity:.89}77%{opacity:1}86%{opacity:.86}89%{opacity:.98}}',
      '#hk-sky .hl.breathe b{animation:hk-hlbreathe 16s ease-in-out infinite alternate}',
      '@keyframes hk-hlbreathe{from{opacity:.84}to{opacity:1}}',
      // one candle's own flame, and one bulb's twinkle, from the art's list
      '#hk-sky .hx>*{position:absolute;aspect-ratio:1;transform:translate(-50%,-50%);',
      '  border-radius:50%;opacity:0;will-change:opacity}',
      '#hk-sky .hx .cf{background:radial-gradient(circle,rgba(255,190,96,.62) 0,',
      '  rgba(255,138,40,.26) 32%,rgba(255,110,20,0) 68%);',
      '  animation:hk-candle var(--cd) linear var(--cdl) infinite}',
      '@keyframes hk-candle{0%,100%{opacity:.55}3%{opacity:.85}5%{opacity:.5}9%{opacity:.75}',
      '  12%{opacity:.62}16%{opacity:.95}19%{opacity:.58}24%{opacity:.8}27%{opacity:.66}',
      '  31%{opacity:.9}33%{opacity:.52}38%{opacity:.7}43%{opacity:.6}46%{opacity:.92}',
      '  50%{opacity:.64}54%{opacity:.82}57%{opacity:.5}62%{opacity:.78}66%{opacity:.6}',
      '  71%{opacity:.97}74%{opacity:.62}79%{opacity:.84}83%{opacity:.55}88%{opacity:.76}',
      '  92%{opacity:.6}96%{opacity:.88}}',
      '#hk-sky .hx .tw{background:radial-gradient(circle,#fff6e6 0,rgba(255,236,200,.9) 12%,',
      '  rgba(255,196,120,.35) 30%,rgba(255,170,90,0) 60%);',
      '  animation:hk-bulb var(--td) ease-in-out var(--tdel) infinite}',
  '@keyframes hk-bulb{0%,100%{opacity:0}7%{opacity:0}12%{opacity:var(--pk)}21%{opacity:0}40%{opacity:0}45%{opacity:var(--pk)}54%{opacity:0}73%{opacity:0}78%{opacity:var(--pk)}87%{opacity:0}}',
      // the birthday balloons, each cluster swaying on its own knot
      '#hk-sky .bx .bprops{position:absolute;inset:auto;background:center/100% 100% no-repeat;',
      '  filter:brightness(var(--landB,1))}',
      '#hk-sky .bx .bprops.glow{filter:none;mix-blend-mode:screen}',
      '#hk-sky .bx .bln{position:absolute;inset:auto;background:center/100% 100% no-repeat;',
      '  transform-origin:var(--ox) var(--oy);will-change:transform;',
      '  transition:background-image 4s ease;filter:brightness(var(--landB,1));',
      '  animation:hk-sway var(--sd) ease-in-out var(--sdl) infinite alternate}',
      '@keyframes hk-sway{from{transform:rotate(var(--r0))}to{transform:rotate(var(--r1))}}',
      // fireflies over the meadow on a summer night: a slow wander and a blink
      '#hk-sky .life .ff{position:absolute;width:0;height:0;will-change:transform;',
      '  animation:hk-ffwander var(--wd) ease-in-out var(--wdl) infinite}',
      '#hk-sky .life .ff i{position:absolute;left:-2.5px;top:-2.5px;width:5px;height:5px;',
      '  border-radius:50%;background:#f6ffc4;',
      '  box-shadow:0 0 7px 3px rgba(220,255,120,.8),0 0 22px 8px rgba(196,255,96,.3);',
      '  opacity:0;animation:hk-ffblink1 var(--bd) ease-in-out var(--bdl) infinite}',
      '@keyframes hk-ffwander{0%,100%{transform:translate3d(0,0,0)}',
      '  17%{transform:translate3d(var(--dx1),var(--dy1),0)}',
      '  33%{transform:translate3d(var(--dx2),var(--dy2),0)}',
      '  50%{transform:translate3d(var(--dx3),var(--dy3),0)}',
      '  67%{transform:translate3d(var(--dx4),var(--dy4),0)}',
      '  83%{transform:translate3d(var(--dx5),var(--dy5),0)}}',
      '@keyframes hk-ffblink1{0%,100%{opacity:0}4.5%{opacity:0}6%{opacity:1}8%{opacity:.85}10.5%{opacity:0}17.5%{opacity:0}19%{opacity:1}21%{opacity:.85}23.5%{opacity:0}29.5%{opacity:0}' +
        '31%{opacity:1}33%{opacity:.85}35.5%{opacity:0}45.5%{opacity:0}47%{opacity:1}49%{opacity:.85}51.5%{opacity:0}56.5%{opacity:0}58%{opacity:1}60%{opacity:.85}62.5%{opacity:0}71.5%{opacity:0}' +
        '73%{opacity:1}75%{opacity:.85}77.5%{opacity:0}84.5%{opacity:0}86%{opacity:1}88%{opacity:.85}90.5%{opacity:0}}',
      '@keyframes hk-ffblink2{0%,100%{opacity:0}1.5%{opacity:0}3%{opacity:1}5%{opacity:.85}7.5%{opacity:0}13.5%{opacity:0}15%{opacity:1}17%{opacity:.85}19.5%{opacity:0}26.5%{opacity:0}' +
        '28%{opacity:1}30%{opacity:.85}32.5%{opacity:0}38.5%{opacity:0}40%{opacity:1}42%{opacity:.85}44.5%{opacity:0}53.5%{opacity:0}55%{opacity:1}57%{opacity:.85}59.5%{opacity:0}65.5%{opacity:0}' +
        '67%{opacity:1}69%{opacity:.85}71.5%{opacity:0}78.5%{opacity:0}80%{opacity:1}82%{opacity:.85}84.5%{opacity:0}91.5%{opacity:0}93%{opacity:1}95%{opacity:.85}97.5%{opacity:0}}',
      // Fourth of July fireworks over the hills: one burst per element per
      // cycle, each cycle re-placed (fireworkAim)
      '#hk-sky .life .fw{position:absolute;aspect-ratio:1;opacity:0;',
      '  background:url(' + SP_ASSET.firework + ') center/contain no-repeat;',
      '  filter:hue-rotate(var(--hue)) saturate(1.3);will-change:transform,opacity;',
      '  animation:hk-fw var(--fd) ease-out var(--fdl) infinite}',
      '@keyframes hk-fw{0%{opacity:0;transform:translate(-50%,-50%) scale(.12)}',
      '  .5%{opacity:.95;transform:translate(-50%,-50%) scale(.75)}',
      '  4.5%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}',
      '  100%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}',
      // HELD, NOT HIDDEN: the screensaver's sky pauses between forecast slides
      // (and under Fully's dark screensaver) without dropping its layers --
      // .hidden's will-change:auto took the land and the fog off their layers
      // at every slide's start and put them back at its end, and the WebView
      // re-rastered what sits above each time (the flicker at every turn)
      '#hk-sky.own.held *{animation-play-state:paused!important}',
      '@media (prefers-reduced-motion:reduce){#hk-sky .land>i{transition:none}}'
    ].join('');

    // what the shell and the later parts use of this one
    K.attachStyles = attachStyles; K.auroraCanvas = auroraCanvas; K.auroraDraw = auroraDraw; K.container = container;
    K.detachStyles = detachStyles; K.FRONT_Z = FRONT_Z; K.frontSync = frontSync; K.kfScale = kfScale;
    K.LV_KNOBS = LV_KNOBS; K.lvCount = lvCount; K.lvCycleOn = lvCycleOn; K.lvOf = lvOf; K.lvRange = lvRange;
    K.lvThin = lvThin; K.OWN_CSS = OWN_CSS; K.register = register; K.showNow = showNow; K.skyQ = skyQ;
    K.skyQA = skyQA; K.SP_ASSET = SP_ASSET;
  };
})();
