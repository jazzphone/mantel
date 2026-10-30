// hk-glass.js - the SHARED BLUR behind every glass surface (look.glass = blur).
//
// WHY ONE LAYER PER SCROLLER AND NOT ONE PER CARD. A backdrop-filter on each
// card, measured on an entry-level Samsung wall tablet (SM-X230): 22 blur
// surfaces (14 pills + 8 chips) took the main page from 90 to 45 fps still
// and ~30-45 scrolling, and blanked cards until they were scrolled -- tile
// memory running out. An 8px radius cost the same as 20px:
// on these tile-based GPUs the bill is the NUMBER of blur surfaces (a render
// pass and a backdrop texture each), not their size. One shared layer, cut to
// the cards' shapes with a clip-path, held 90 fps with every pill and chip
// frosted -- cheaper than the chips' own blur alone.
//
// WHY ONE LAYER PER MOVING CONTAINER. ONE sheet positioned against the
// document does not work: a page may scroll <body>, not the document, and
// each row scrolls sideways inside itself, so the pills would slide across a
// frost that stays put. So each layer lives INSIDE the container
// that carries its cards (the view, each sideways row, a pop-up sheet; see
// collect()), and the browser moves it with them on the compositor -- no
// JavaScript and no lag while scrolling. A page ends up with a handful of
// layers: its view, plus one per row of glass.
//
// HOW A SURFACE IS KNOWN. Every glass surface's rule carries
// `--hk-glass-surface: 1` (hkCards.M.glass, the status chip), a custom
// property registered NON-inherited by hk-settings.js, so only the plate
// itself has it. Cards join and leave from HkBase's connected/disconnected
// callbacks (window.__hkGlassCards); `glass: false` in a card's config keeps
// it out. Nothing is scanned page-wide, and a card written tomorrow joins the
// same way.
//
// THE LAYER sits at z-index -1 inside its container: painted after the sky
// (fixed, z -1, earlier in the tree) and before every card. Its backdrop root
// must be <html> -- anything that makes an ancestor its own compositing
// surface (filter, opacity < 1, an opacity ANIMATION still filling) cuts it
// off from the sky -- why pages change with no fade (see below).
//
// A PAGE IS SHOWN AS SOON AS HOME ASSISTANT HAS BUILT IT (2026-10-11). A new
// page was once held hidden until its frost was placed, and a page coming
// back kept faint until every card on it had redrawn -- no frame without its
// frost, but about 350 ms more on every return to Home on the Living Room
// tablet, and half of every page change (measured on the tablets: 410-620 ms
// tap to page with it, 185-300 without; nothing looked off). Every layer is
// still drawn at full strength from the frame update() creates it -- the same
// frame as the cards it frosts, as update() runs in the animation frame
// before that paint; no layer fades in. A pop-up's layer lives in its sheet
// and fades with it -- but while the sheet's opacity is below 1 the sheet is
// a backdrop root, so until the fade ends the frost samples only what the
// sheet itself draws (the #alarm sheet blurs itself, so that is frost).
//
// PRE-RENDERED (look.glass = blur_pre, 2026-10-10): the same layers, cut to
// the same shapes, but nothing blurs live. Each layer holds a small picture
// of the sky, blurred ONCE, pinned to the screen (an <img>, position:fixed):
// the cards scroll and their cut-outs slide over the still picture, exactly
// as frost over a fixed sky would look -- the colors right at every scroll
// position, on the compositor, no JavaScript. What it cannot show: the sky's
// motion through the glass (rain, drifting clouds, bats), which a 20 px blur
// all but erases anyway. The picture is painted from the sky's own pieces
// (preRender: its gradient, glow, clouds, ceiling, land) at 1/6 size --
// nothing finer survives the blur -- and painted again as the sky changes
// (PRE_*): a tiny image the GPU draws scaled, where the live blur re-blurs
// the sky behind every card on every frame anything moves. A layer whose
// picture cannot be pinned to the screen (a pop-up sheet sliding in makes
// itself the box a fixed child sits in) blurs live, and so does every layer
// until the first picture is ready, or while no sky is showing.

(function () {
  'use strict';
  if (window.hkGlass) return;
  var SH = window.hkShell;     // the host's page: its view container, navigation

  var MAT = 'blur(20px) saturate(1.4) brightness(0.82)';
  // PRE-RENDERED: the mode, the picture, and when it is painted again --
  // ON WHAT CHANGES IT, never by looking every few seconds: the sky says when
  // what it shows changed (hk-sky-paint, its sig()), the window its size,
  // the settings the blur's strength. A big change (another page, size,
  // weather or season, the clouds coming up) repaints at once; the light
  // drifting at most every PRE_DRIFT; and every PRE_MAX whatever, for the
  // clouds, which drift with nothing to say so (plan(): one deadline).
  var PRE = false, PRE_SCALE = 1 / 6, PRE_DRIFT = 45000, PRE_MAX = 120000, PRE_FADE = 2500;
  // A MOVING SKY (Animations on): the clouds drift under the still picture,
  // measured headless 2026-10-11 -- a picture 10 s old was already 5/255 off
  // on average and 70+ in its worst cell, and 8 / 90 by a minute, until the
  // 2-minute repaint put it right in one visible step (and a page came back
  // to wearing its remembered picture, minutes old). So while the sky moves
  // the picture is painted every PRE_MOVE, each step small, and every
  // same-page repaint fades over PRE_FADE (2.5 s, was 0.8): a slow drift the
  // eye follows, not a jump. A still sky keeps PRE_MAX. (A page change keeps
  // its quick swap and the pinned glass its 0.5 s FADE_MS turn.)
  var PRE_MOVE = 30000;
  // A CHANGE IS NOT A DRIFT (2026-10-11, the user: the glass "detects
  // changes" too slowly -- between pages, a new song's cover on Music). The
  // 2.5 s fade is for the sky drifting under a still picture; what the sky
  // SHOWS changing (another page, a new cover, rain) is painted the moment
  // the sky says so (hk-sky-change), as it will look once its fades are
  // done (hk-skyshot.js settle, fades ending within PRE_AHEAD), and goes on
  // over PRE_SWAP -- or over what is left of the sky's own fade, so the two
  // move together. Measured headless (4x CPU), a new cover: the pills right
  // 5.7 s after it (1.1 s waiting for the wash, then the paint, then 2.5 s
  // of fade). A slower fade is painted again once it has ended (unsettled).
  var PRE_SWAP = 600, PRE_AHEAD = 5000;
  // ...AND WHILE SOMETHING DRIFTS ACROSS IT (the clouds, the fog's wisps,
  // the aurora: hkSky.drifting()), every PRE_TRACK, each picture fading into
  // the next over that same time: the pills follow the clouds (the user,
  // 2026-10-11: "the chips are not updated" -- they lagged a cloud right
  // behind them by up to 30 s). Never while the page is being touched or
  // scrolled (PRE_QUIET after the last of it): a paint is ~25-75 ms of the
  // main thread at a tablet's speed, and one in a swipe would be felt.
  var PRE_TRACK = 2000, PRE_QUIET = 700, PRE_STUCK = 10000, PIN_STEPS = 8, lastInput = 0, touching = 0;
  function maxAge() {
    var HS = window.hkSettings, look = HS && HS.skyLook ? HS.skyLook() : null;
    if (!(look && look.animations)) return PRE_MAX;
    return window.hkSky && window.hkSky.drifting && window.hkSky.drifting() ? PRE_TRACK : PRE_MOVE;
  }
  function onInput(e) {
    lastInput = Date.now();
    if (e.type === 'pointerdown') touching++;
    else if (e.type === 'pointerup' || e.type === 'pointercancel') touching = Math.max(0, touching - 1);
  }
  var INPUTS = ['pointerdown', 'pointerup', 'pointercancel', 'wheel', 'scroll', 'touchmove'];
  // NOTHING CAN WEDGE IT: an image that never answers is left out
  // (hk-skyshot.js, 4 s), and a paint that has not finished in PRE_RENDER_MS
  // is given up (the picture stays; plan() tries again) -- one stuck paint
  // once held `busy` and stopped every repaint after it
  var PRE_RENDER_MS = 10000;
  // NO SECOND PAINT "ONCE THE SKY HAS SETTLED": the sky cuts to a new page
  // (hk-sky.js snapNext), so a page change is painted right the first time
  // -- measured, the picture at the change and one 5 s later differ by
  // under 1/255 on average (2026-10-10). What does arrive later -- the
  // realistic clouds, the ceiling's art -- the sky says (hk-sky-paint, its
  // cloudsSig), and the first picture waits for it (PRE_CLOUDS_MS at most).
  var PRE_CLOUDS_MS = 3000;
  // url/path: the picture worn on screen and its page; next: one ready for
  // a page not on screen yet (worn when it is, viewShown); drawn: the page
  // the last picture was painted for (what preTick compares)
  var pre = { url: null, big: '', small: '', at: 0, busy: false, timer: null, path: null, again: false, pending: null, since: 0,
              next: null, drawn: null, gen: 0, busySig: null, unsettled: false };
  // A NEW PAGE: its picture is painted the moment its sky has drawn
  // (hk-sky-paint), or PRE_NAV_MS after the move when nothing says so, and
  // faded in. Until then everything keeps the last page's picture: taking it
  // off left a gap -- the menu's panel showed the sky unblurred for a third
  // of a second at every page change (screen-recorded, 2026-10-10)
  var PRE_NAV_MS = 400, navT = null;
  // THE PAGE ON SCREEN, which is not yet the page navigated to: Home
  // Assistant swaps the view a few frames after the address changes (more
  // for a page drawn the first time, held hidden until it is). A page's
  // picture is worn only once its page is on screen -- worn at the address
  // change, the last page's cards and the menu's panel showed the next
  // page's blur for those frames (screen-recorded, 2026-10-10). Until then
  // it waits (pre.next). Set as the new view is put on the page
  // (watchViews), or after VIEW_UP_MS if no view ever is (a page that is
  // not a dashboard).
  var VIEW_UP_MS = 1500, viewUp = here(), viewUpT = null;
  function viewShown() {
    clearTimeout(viewUpT); viewUpT = null;
    if (viewUp === here()) return;
    viewUp = here();
    if (!(PRE && active)) return;
    wearNext();
    // no picture of this page yet: its layers blur live until there is one
    if (!ownPicture()) eachLayer(function (L) { if (!L._hkOverlay) preUndress(L); });
  }
  // the picture waiting for this page, on now
  function wearNext() {
    var n = pre.next;
    if (!n || n.path !== skyAt()) return;
    pre.next = null;
    if (n.url) wearAll(n.url, n.path, false, false); else preNone();
  }
  function here() { try { return location.pathname; } catch (e) { return ''; } }
  // THE PAGE THE SKY SHOWS NOW -- which is not yet the page whose view is up:
  // the view goes on a frame or two before its sky cuts to it (hk-sky.js
  // path()). A page's picture goes on with its SKY (hk-sky-change, said in
  // the same task), not with its view: worn with the view, Home's moon was
  // on the pills for those frames over the last page's backdrop -- the moon
  // flashing behind the chips at each return to Home (2026-10-13). No sky
  // (a page without one): the view's page.
  function skyAt() {
    var S = window.hkSky, p = S && typeof S.path === 'function' ? S.path() : null;
    return p || viewUp;
  }
  function fresh() { return !!pre.url; }
  // A PINNED SURFACE'S NEW PICTURE fades in over FADE_MS, a frame at a time
  // -- a straight swap read as a flash -- at an even pace (easing left the
  // first and last steps 100 ms apart, 2026-10-10)
  var FADE_MS = 500;
  var fadeRaf = null, fadeTimer = null, fading = null;
  // PINNED: glass outside the cards, fixed to the screen -- the menu's
  // panel, its edge tab and button, the tab bar and its sheets (hk-menu.js,
  // hk-tabbar.js). Each blurred live over the moving sky in every mode, the
  // menu a full-height panel of it. With a picture (Pre-rendered) each
  // wears its own slice under its own tint (pin(el, tint)), its live blur
  // off, faded in; in any other look, untouched.
  var pinned = new Map();
  var cards = window.__hkGlassCards = window.__hkGlassCards || new Set();

  // iOS WEBKIT DRAWS A LAYER INSIDE A SCROLLING ROW OVER EVERYTHING IN THE ROW
  // THAT IS NOT COMPOSITED ITSELF (the Home Assistant iPhone app, for one).
  // The chips and scenes rows show frost and no pills; rotating or opening
  // the sidebar (a full re-composite) brings them back. Measured on an
  // iPhone, one change at a time: hiding the row's layer -> pills; the row as
  // its own stacking context (isolation) -> no change; the layer at z-index 0
  // with the cards lifted to z-index 1 -> frost ON TOP of them. So z-order
  // does not decide it there. Giving each card in the row its own compositing
  // layer (will-change: transform) does: pills, frost behind. Each card is
  // promoted in the same update() that places its row's layer, so there is
  // no frame without.
  //
  // ON EVERY ENGINE, not just iOS: an iOS-only branch is one more thing to
  // drift and to troubleshoot. Chrome and macOS Safari do not need it, and it
  // costs them nothing measurable: on a wall tablet, alternating off/on, the
  // chips row scrolled at 86-90 fps either way and the whole page at 85-89,
  // p95 frame 11.1 ms in every run (19 cards promoted).
  // Only the cards in SIDEWAYS rows are promoted (collect(): `sideways`) --
  // not the page's grids, and not a pop-up sheet's cards, which scroll
  // vertically (or a whole panel of them would be promoted).
  // A promoted element that leaves the page gives it back at once (HA keeps
  // a visited view's elements, which would carry it into the clear look).
  var promoted = new Map();      // element -> its own will-change before (undone by unpromote/stop())
  // The row child that holds this plate: walk up from the plate until the
  // parent is the scrolling anchor. Nothing if the anchor is no longer above
  // it -- the walk would reach the document, which has no attributes.
  function promote(p) {
    var n = p.el;
    for (;;) {
      var up = flatParent(n);
      if (!up || up.nodeType !== 1) return;
      if (up === p.anchor) break;
      n = up;
    }
    if (promoted.has(n) || n.hasAttribute('data-hk-glass-layer')) return;
    promoted.set(n, n.style.willChange || '');
    n.style.willChange = 'transform';
  }
  function unpromote(was, n) { n.style.willChange = was; promoted.delete(n); }
  var plates = new Map();        // card -> [{el, anchor, scrolls, sideways, clips}]
  var layers = new Map();        // anchor (or DOC) -> {layers, posWas}
  var DOC = { doc: true };
  var VIEWS = SH.viewTags.map(function (t) { return t.toUpperCase(); });
  var active = false, queued = false, full = true, timer = null, ro = null, hostRo = null;
  var BACKSTOP_MS = 30000;
  // Cards to collect() again on the next update: the ones that joined or
  // left. `full` re-collects every card (start, a resize, fonts loaded).
  var dirty = new Set();
  var stats = { layers: 0, rects: 0, updates: 0, lastMs: 0 };

  function flatParent(n) {
    if (n.assignedSlot) return n.assignedSlot;
    var p = n.parentNode;
    if (!p) return null;
    return p.nodeType === 11 ? p.host : p;
  }
  function marked(el) {
    try { return getComputedStyle(el).getPropertyValue('--hk-glass-surface').trim() === '1'; }
    catch (e) { return false; }
  }

  // A card's glass plates, each with its ANCHOR -- the element its layer lives
  // in -- and any clipping (overflow:hidden) boxes between plate and anchor.
  //
  // THE ANCHOR MUST MOVE WITH THE PLATE, so the browser carries the frost with
  // its cards on the compositor. Walking up from the plate:
  //   * a scroll container below <body>: the scroller itself -- the layer
  //     scrolls with its cards. A sideways row (overflow-x scrolls, overflow-y
  //     does not: `sideways`), or a pop-up sheet (hk-popup's .sheet is
  //     overflow-y:auto), whose layer then rides the sheet's open transform;
  //   * a position:fixed box that does not scroll: that box;
  //   * otherwise the page scrolls it, and WHICH element scrolls the page
  //     differs (<html> on some layouts, <body> with overflow:auto on others:
  //     a sheet pinned to the document leaves the pills sliding across a
  //     frost that stays put on a body-scrolling layout).
  //     So the anchor is the VIEW ELEMENT (hui-view): it moves with the page
  //     whichever element scrolls it, every card in the view shares it, and
  //     it comes after Home Assistant's view background (see below). With no
  //     view element, the highest positioned element below <body>.
  function collect(card) {
    var out = [], root = card.shadowRoot;
    if (!root) return out;
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!marked(el)) continue;
      // Without a registered (non-inherited) property every descendant would
      // read 1; keep only the outermost.
      var p = flatParent(el);
      if (p && p.nodeType === 1 && root.contains(p) && marked(p)) continue;
      var clips = [], anchor = null, scrolls = false, sideways = false, highest = null, n = p;
      while (n && n.nodeType === 1 && n !== document.body && n !== document.documentElement) {
        var cs = getComputedStyle(n);
        var ox = cs.overflowX, oy = cs.overflowY;
        var sx = ox === 'auto' || ox === 'scroll', sy = oy === 'auto' || oy === 'scroll';
        if (cs.position === 'fixed') { anchor = n; break; }
        // (A vertical scroller's overflow-x COMPUTES to auto as well, so a
        // sideways row is the one that scrolls on x and not on y.)
        if (sx || sy) { anchor = n; scrolls = true; sideways = sx && !sy; break; }
        // THE VIEW ELEMENT, NOT ITS CONTAINER. hui-view-container holds
        // Home Assistant's own view background (hui-view-background: opaque,
        // z-index -1) BEFORE hui-view in the tree, so a layer anywhere in
        // front of it -- the container's shadow root, say -- is painted
        // UNDER that background and blurs a flat color, invisibly: the rows
        // blur (their layers come after the background) and the view's pills
        // do not. Inside hui-view, the layer comes after it.
        if (VIEWS.indexOf(n.tagName) >= 0) { anchor = n; break; }
        if (cs.position !== 'static') highest = n;
        if (ox !== 'visible' || oy !== 'visible') clips.push(n);
        n = flatParent(n);
      }
      if (!anchor) anchor = highest || DOC;
      out.push({ el: el, anchor: anchor, scrolls: scrolls, sideways: sideways, clips: clips });
    }
    return out;
  }

  // r: one radius, or four [top-left, top-right, bottom-right, bottom-left]
  // (a Square screen's corner block: hk-layout.js cellRadius)
  function rrect(x, y, w, h, r) {
    var q = (Array.isArray(r) ? r : [r, r, r, r]).map(function (v) { return Math.max(0, Math.min(v || 0, w / 2, h / 2)); });
    var f = function (v) { return Math.round(v * 10) / 10; };
    var a = function (v, X, Y) { return 'A' + f(v) + ',' + f(v) + ' 0 0 1 ' + f(X) + ',' + f(Y); };
    return 'M' + f(x + q[0]) + ',' + f(y) + 'H' + f(x + w - q[1]) +
      a(q[1], x + w, y + q[1]) + 'V' + f(y + h - q[2]) +
      a(q[2], x + w - q[2], y + h) + 'H' + f(x + q[3]) +
      a(q[3], x, y + h - q[3]) + 'V' + f(y + q[0]) +
      a(q[0], x + q[0], y) + 'Z';
  }

  // BANDS, NOT ONE LAYER PER CONTAINER. A backdrop surface larger than the
  // GPU's max texture is silently NOT DRAWN: a wall tablet that reports
  // MAX_TEXTURE_SIZE 8192, under a view layer of 1920 x 8856 device px,
  // blurs only the small row layers. Every layer is therefore cut
  // into bands along its long side: never over 4096 device px (a size every
  // WebGL GPU supports) and about 4 megapixels each, so a tablet draws the one
  // or two bands on screen, not a page-tall texture. Cuts fall only in the
  // gaps between surfaces, so no pill is ever split across a seam.
  var MAX_DEVICE = 4096, BAND_AREA = 4e6;

  // shapes [{x,y,w,h,r}] over an extent W x H (CSS px) -> bands, each
  // {axis, start, len, cross, shapes}. Cut bands run from the first shape to
  // the last, never over glass-free space before or after them (pills only
  // in a page's top 110 px would otherwise make ONE band 6000 px tall --
  // 9000 device px, over a tablet's max texture). Pure: tested by
  // test_glass.js.
  function bands(shapes, W, H, dpr) {
    dpr = dpr || 1;
    var axis = null, cross = 0;
    if (H * dpr > MAX_DEVICE || W * H * dpr * dpr > BAND_AREA * 1.5) { axis = 'y'; cross = W; }
    if (W * dpr > MAX_DEVICE && (!axis || W > H)) { axis = 'x'; cross = H; }
    if (!axis) return [{ axis: 'y', start: 0, len: H, cross: W, shapes: shapes.slice() }];
    var len = Math.min(MAX_DEVICE, Math.max(1024, BAND_AREA / Math.max(1, cross * dpr))) / dpr;
    var at = axis === 'y' ? 'y' : 'x', size = axis === 'y' ? 'h' : 'w';
    var sorted = shapes.slice().sort(function (a, b) { return a[at] - b[at]; });
    var out = [], cur = null, reach = 0;
    sorted.forEach(function (sh) {
      var s0 = sh[at], s1 = sh[at] + sh[size];
      if (!cur) { cur = { axis: axis, start: s0, cross: cross, shapes: [] }; reach = s0; }
      // A band is full: cut in the gap before this shape, if there is one.
      else if (s0 >= reach && s1 - cur.start > len) {
        var cut = (reach + s0) / 2;
        cur.len = cut - cur.start; out.push(cur);
        cur = { axis: axis, start: cut, cross: cross, shapes: [] };
      }
      cur.shapes.push(sh);
      reach = Math.max(reach, s1);
    });
    if (cur) { cur.len = reach - cur.start; out.push(cur); }
    return out;
  }

  // An anchor's own TRANSFORM scale, from its computed `transform` (always
  // 'none', matrix() or matrix3d() once computed). A pop-up sheet opens from
  // scale(.98): measured on that first frame, every shape comes out 2% short
  // toward the sheet's corner, and a transform fires no ResizeObserver, so
  // the frost would sit up-and-left of the pills until the 2 s backstop.
  // Dividing by the scale puts the
  // shape where the pill is in the sheet's own layout, and the layer -- inside
  // the sheet -- then scales with it for the rest of the animation. Pure:
  // tested by test_glass.js.
  function transformScale(t) {
    var m = /^matrix(3d)?\(([^)]*)\)/.exec(t || '');
    if (!m) return { x: 1, y: 1 };
    var n = m[2].split(',').map(parseFloat);
    var a = n[0], b = n[1], c = m[1] ? n[4] : n[2], d = m[1] ? n[5] : n[3];
    return { x: Math.sqrt(a * a + b * b) || 1, y: Math.sqrt(c * c + d * d) || 1 };
  }

  // THE ANCHOR'S WHOLE SCALE: its own transform times every ancestor's. A
  // detail sheet's cards scroll in the sheet's .body, so that is their anchor
  // -- and the open transform (scale .98) is on .sheet, one level up.
  // Dividing out only the anchor's own leaves the frost behind a group
  // sheet's tiles ("2 Windows") cut 2% short toward the corner until the 2 s
  // backstop (measured in Chrome: a 162 px plate cut 158.8 wide). Read once
  // per anchor per pass
  // (`scaleMemo`); a pass measures a few anchors, each a short walk up.
  var scaleMemo = null;
  function scaleOf(A) {
    var m = scaleMemo && scaleMemo.get(A);
    if (m) return m;
    var x = 1, y = 1, n = A;
    while (n && n.nodeType === 1) {
      var t = getComputedStyle(n).transform;
      if (t && t !== 'none') { var ts = transformScale(t); x *= ts.x; y *= ts.y; }
      if (n === document.documentElement) break;
      n = flatParent(n);
    }
    m = { x: x, y: y };
    if (scaleMemo) scaleMemo.set(A, m);
    return m;
  }

  // The view an anchor sits in (or is).
  function viewOf(anchor) {
    var n = anchor === DOC ? null : anchor;
    while (n && n.nodeType === 1) {
      if (VIEWS.indexOf(n.tagName) >= 0) return n;
      n = flatParent(n);
    }
    return null;
  }
  // A VIEW ON THE PAGE: one kept by Home Assistant, back, at once; a new one
  // once it has been drawn (two frames). Said by the view being put in its
  // container (watchViews) or by a card joining it, whichever is first.
  // A KEPT VIEW'S GLASS IS THERE IN ITS FIRST FRAME (2026-10-13): its
  // layers left with it and were built again only on the next animation
  // frame -- a gap of one frame on a desk, ~170 ms at 6x slower (traced), in
  // which the sky had already cut to the page's scene and every pill on it
  // was bare: the moon flashing behind Home's chips on a wall tablet, at each
  // return to Home (the user's video). The view is put back synchronously
  // and its cards with it, and this runs before that frame is drawn (a
  // MutationObserver), so the layers are laid -- in their picture -- now.
  // ONCE, when every card has come back with it: each card's reconnect says
  // the view too (changed()), and a pass for each was 225 passes on the
  // Living Room's Home -- so it waits for the end of this task, still before
  // the frame (a microtask).
  var keptPass = false;
  function onPage(v) {
    if (v.__hkShown) {
      viewShown();
      if (active && v.isConnected && !keptPass) {
        keptPass = true;
        var run = function () { keptPass = false; if (active) update(); };
        if (typeof queueMicrotask === 'function') queueMicrotask(run); else Promise.resolve().then(run);
      }
      return;
    }
    v.__hkShown = true;
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      if (v.isConnected) viewShown();
    }); });
  }
  // WHERE THE PAGES GO: a view element put on the page is the page on
  // screen (viewShown) -- one kept by Home Assistant coming back at once, a
  // new one once it has been drawn. Only a VIEW being inserted counts; a card
  // appearing never inserts one.
  var viewMo = null, viewBox = null;
  function watchViews() {
    if (typeof MutationObserver === 'undefined') return;
    var box = viewContainer();
    if (!box || box === viewBox) return;
    if (viewMo) viewMo.disconnect();
    viewBox = box;
    viewMo = new MutationObserver(function (recs) {
      if (!active) return;
      recs.forEach(function (r) {
        Array.prototype.forEach.call(r.addedNodes || [], function (n) {
          if (n.nodeType === 1 && VIEWS.indexOf(n.tagName) >= 0) onPage(n);
        });
      });
    });
    viewMo.observe(box, { childList: true });
  }
  function viewContainer() { return SH.viewContainer() || SH.viewSlot(); }

  function newLayer(anchor) {
    var layer = document.createElement('div');
    layer.setAttribute('data-hk-glass-layer', '');
    // --hk-blur-filter: the strength chosen under Configure -> Look
    // (hk-settings.js); MAT, its middle, without it.
    var f = 'var(--hk-blur-filter,' + MAT + ')';
    layer.style.cssText = 'position:absolute;left:0;top:0;z-index:-1;pointer-events:none;margin:0;' +
      'flex:none;backdrop-filter:' + f + ';-webkit-backdrop-filter:' + f;
    if (anchor === DOC) { document.body.appendChild(layer); }
    else {
      // A shadow host renders only slotted light children; its own shadow
      // tree always renders.
      var into = anchor.shadowRoot || anchor;
      into.insertBefore(layer, into.firstChild);
    }
    layer._hkOverlay = overContent(layer);
    preDress(layer);
    return layer;
  }

  // ---- PRE-RENDERED: a layer wears the picture, or blurs live ----
  // WHAT IS BEHIND A LAYER decides it, not whether its picture happens to
  // line up. A layer in the page's own flow sits on the sky: it wears the
  // picture. One inside a fixed or sticky box -- a pop-up's sheet, a bar
  // held over the page -- floats over the page's content, which scrolls
  // under it: a picture of the sky there would be wrong however well it
  // lined up, so it blurs live (2026-10-10; it once went live only because
  // a sheet's opening transform put its picture out of line, and stayed
  // live for good).
  function overContent(layer) {
    for (var n = flatParent(layer); n && n.nodeType === 1 && n !== document.documentElement; n = flatParent(n)) {
      var pos = getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    }
    return false;
  }
  // A PAGE LAYER'S PICTURE LINES UP with the sky only while nothing above it
  // is transformed (that would make itself the box the fixed picture sits
  // in). Looked at again on every layout pass (preCheck), so a layer caught
  // mid-move blurs live for that while, then wears the picture again.
  function lined(img) {
    var r = img.getBoundingClientRect();
    return Math.abs(r.left) <= 1 && Math.abs(r.top) <= 1 && Math.abs(r.width - window.innerWidth) <= 2;
  }
  // THE PICTURE IS A SMALL CANVAS THE COMPOSITOR STRETCHES, not an <img>.
  // An <img> pinned over the screen is rastered at the screen's full size
  // into tiles -- one per layer, a screen of tile memory each where the
  // layer shows -- and every repaint added a second one per layer for its
  // fade: on a wall tablet near its tile budget that pushed it over, the
  // browser dropped the old picture's tiles, and for two frames every pill
  // showed the sharp sky (screen-recorded on the Master Bedroom tablet, at
  // each repaint; reproduced headless at the budget's edge: 0 tile warnings
  // at rest, 2 at a repaint). A canvas is one texture at its own size (the
  // picture's, 1/6 of the screen), scaled on the GPU: no tiles at all.
  // `data-src` names the picture it holds.
  function preImg(url) {
    var cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true'); cv.setAttribute('data-hk-pre', ''); cv.setAttribute('data-src', url);
    // the window in the page's own units: under a car dashboard's zoom
    // (tesla-viewport.js publishes --hk-vw / --hk-vh) 100vw is only Z of the
    // screen -- the picture covered two thirds of it and lined up with nothing
    cv.style.cssText = 'position:fixed;left:0;top:0;width:var(--hk-vw,100vw);height:var(--hk-vh,100vh);max-width:none;max-height:none;' +
      'margin:0;padding:0;border:0;pointer-events:none;transition:opacity ' + PRE_FADE + 'ms linear';
    var draw = function (im) {
      if (!im || !cv.getContext) return;
      cv.width = im.naturalWidth || im.width || 1; cv.height = im.naturalHeight || im.height || 1;
      var x = cv.getContext('2d');
      if (x) x.drawImage(im, 0, 0);
    };
    var rec = pics.get(url);
    if (rec && rec.done) draw(rec.im); else decoded(url).then(draw);
    return cv;
  }
  function picOf(el) { return el ? el.getAttribute('data-src') : null; }
  // A PAGE LAYER WEARS ONLY ITS OWN PAGE'S PICTURE. Pages' pictures differ
  // (measured: 34-47/255 on average between one page's and the next), so on
  // a page seen for the first time since the load the last page's picture
  // was the wrong blur on every pill until the new one was painted -- 0.2-
  // 0.5 s on a tablet (2026-10-10). Meanwhile they blur live, which is
  // right by definition; the pinned glass keeps its fade.
  function ownPicture() { return fresh() && pre.path === skyAt(); }
  function preDress(L) {
    if (!PRE || !ownPicture() || L._hkOverlay) { preUndress(L); return; }
    // the live blur off FIRST: a backdrop-filter makes its own element the
    // box a fixed child sits in, so measured under it every picture would
    // read as out of line
    L.style.backdropFilter = 'none';
    L.style.webkitBackdropFilter = 'none';
    if (!L._hkPre) {
      var img = preImg(pre.url);
      L.appendChild(img);
      if (!lined(img)) { img.remove(); preUndress(L); return; }
      L._hkPre = img;
    }
  }
  // every layout pass: a page layer out of line blurs live, one back in line
  // wears the picture again (all in this task: never painted half-way)
  function preCheck(L) {
    if (L._hkOverlay) return;
    if (L._hkPre) { if (!lined(L._hkPre)) preUndress(L); }
    else preDress(L);
  }
  function preUndress(L) {
    var f = 'var(--hk-blur-filter,' + MAT + ')';
    if (L._hkPre) { L._hkPre.remove(); L._hkPre = null; }
    Array.prototype.slice.call(L.querySelectorAll('[data-hk-pre]')).forEach(function (i) { i.remove(); });
    L.style.backdropFilter = f;
    L.style.webkitBackdropFilter = f;
  }
  function eachLayer(fn) { layers.forEach(function (rec) { rec.layers.forEach(function (L) { if (L.isConnected) fn(L); }); }); }
  // ---- PINNED: each its own slice of the picture ----
  // (in the surface's own CSS pixels: under a car dashboard's zoom `z` a
  // screen pixel is 1/z of one)
  function sliceOf(url, x, y, W, H, z) {
    z = z || 1;
    if (z === 1) return 'url("' + url + '") ' + (-x).toFixed(1) + 'px ' + (-y).toFixed(1) + 'px / ' + W + 'px ' + H + 'px no-repeat';
    return 'url("' + url + '") ' + (-x / z).toFixed(1) + 'px ' + (-y / z).toFixed(1) + 'px / ' + (W / z).toFixed(1) + 'px ' + (H / z).toFixed(1) + 'px no-repeat';
  }
  function zoomOf(el) { return (el && el.currentCSSZoom) || 1; }
  // WHERE A SLICE IS CUT: where the surface sits on the screen, kept inside
  // the picture
  function placeOf(r, W, H) {
    return [Math.max(0, Math.min(r.left, W - r.width)), Math.max(0, Math.min(r.top, H - r.height))];
  }
  // A RUNNING FADE, FINISHED NOW: every surface in it given its end
  function finishFade() {
    if (fadeRaf && window.cancelAnimationFrame) cancelAnimationFrame(fadeRaf);
    fadeRaf = null; clearTimeout(fadeTimer); fadeTimer = null;
    if (fading) fading.forEach(function (m) { if (m.el.isConnected) wearPin(m.el, m.bg); });
    fading = null;
  }
  function wearPin(el, bg) {
    el._hkPin = bg;
    el.style.setProperty('background', bg);
    el.style.setProperty('-webkit-backdrop-filter', 'none');
    el.style.setProperty('backdrop-filter', 'none');
  }
  function unpinEl(el) {
    if (!el._hkPin) return;
    el.style.removeProperty('background');
    el.style.removeProperty('-webkit-backdrop-filter');
    el.style.removeProperty('backdrop-filter');
    el._hkPin = null; el._hkPinPos = null; el._hkPinUrl = null; el._hkPinPath = null;
  }
  // CUT EVERY PINNED SURFACE'S SLICE. `fade`: fade each changed one from
  // what it wears now (crossfade) instead of jumping.
  function pinAll(fade, ms, coarse) {
    if (!PRE) return;
    var W = window.innerWidth, H = window.innerHeight, ok = fresh(), moves = [];
    // a new fade starts from where the last one was going; a plain pass
    // leaves a fading surface to its fade -- snapping it to its end mid-fade
    // and the fade pulling it back read as a flicker
    if (fade || !ok) finishFade();
    var busy = fading;
    var inFade = function (el) { return busy && busy.some(function (m) { return m.el === el; }); };
    pinned.forEach(function (tint, el) {
      if (!el.isConnected) { pinned.delete(el); return; }
      if (!ok) { unpinEl(el); return; }
      if (inFade(el)) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var z = zoomOf(el), at = placeOf(r, W, H), bg = tint + ', ' + sliceOf(pre.url, at[0], at[1], W, H, z);
      if (el._hkPin === bg) return;
      var from = el._hkPin && el._hkPinUrl ? sliceOf(el._hkPinUrl, el._hkPinPos[0], el._hkPinPos[1], W, H, z) : '';
      // ANOTHER PAGE'S PICTURE FADES ACROSS (2026-10-10): the menu's panel
      // belongs to no page, and a swap a few frames off the page's own
      // showed; over FADE_MS it reads as the page arriving.
      var turn = from && el._hkPinPath && el._hkPinPath !== pre.path;
      if ((fade || turn) && from) moves.push({ el: el, fromUrl: el._hkPinUrl, fromAt: el._hkPinPos, at: at, bg: bg, pin: tint,
                                               ms: turn ? FADE_MS : (ms || PRE_FADE), coarse: !turn && !!coarse });
      else wearPin(el, bg);
      el._hkPinPos = at; el._hkPinUrl = pre.url; el._hkPinPath = pre.path;
    });
    if (moves.length) crossfade(moves, W, H);
  }
  // THE NEW SLICE FADES IN OVER WHAT WAS THERE, in place, every frame for
  // FADE_MS: the two pictures blended by the browser (-webkit-cross-fade,
  // WebKit and Chrome both) at the share the fade has reached, under the
  // surface's own tint. It once took 29 see-through copies of every new
  // picture, made as PNGs -- about 100 ms of WebKit's main thread at each
  // repaint (the Mac, 2026-10-10). A surface that has moved as well is put
  // straight on: the two slices would not line up.
  var XFADE = (function () {
    try { return !!(window.CSS && CSS.supports && CSS.supports('background-image', '-webkit-cross-fade(url(a.png), url(b.png), 50%)')); } catch (e) { return false; }
  })();
  function crossfade(moves, W, H) {
    var url = pre.url;
    moves = moves.filter(function (m) {
      if (XFADE && window.requestAnimationFrame && m.fromAt && m.fromAt[0] === m.at[0] && m.fromAt[1] === m.at[1]) return true;
      wearPin(m.el, m.bg);
      return false;
    });
    if (!moves.length) return;
    finishFade();
    fading = moves;
    var t0 = performance.now(), last = -1, ms = Math.max.apply(null, moves.map(function (m) { return m.ms || FADE_MS; }));
    // THE CLOUDS' 2 s REPAINTS FADE IN COARSE STEPS (PIN_STEPS): a pinned
    // surface's fade restyles it once a step, and a step every frame, back
    // to back for as long as the clouds move, was a style pass every frame
    // (measured headless at 4x: 247 -> 1179 in 20 s, the main thread's work
    // 2.2 -> 6.5 s). Two pictures 2 s apart differ little (2/255 on average,
    // 36 at most): eight steps read as a fade -- each on a timer, as an
    // animation frame asked for every frame was itself a style pass a frame.
    var q = moves.every(function (m) { return m.coarse; }) ? PIN_STEPS : 100;
    var later = function () {
      if (q < 100) fadeTimer = setTimeout(function () { fadeTimer = null; step(performance.now()); }, ms / q);
      else fadeRaf = requestAnimationFrame(step);
    };
    var step = function (now) {
      fadeRaf = null;
      if (!PRE || !active || pre.url !== url) { fading = null; return; }
      var t = Math.min(1, Math.max(0, (now - t0) / ms));
      var k = Math.round(t * q) * (100 / q);
      if (k !== last) {
        last = k;
        moves.forEach(function (m) {
          if (!m.el.isConnected) return;
          if (k >= 100) wearPin(m.el, m.bg);
          else if (k > 0) {
            var z = zoomOf(m.el), sz = z === 1 ? W + 'px ' + H + 'px' : (W / z).toFixed(1) + 'px ' + (H / z).toFixed(1) + 'px';
            wearPin(m.el, m.pin + ', -webkit-cross-fade(url("' + m.fromUrl + '"), url("' + url + '"), ' + k + '%) ' +
                    (-m.at[0] / z).toFixed(1) + 'px ' + (-m.at[1] / z).toFixed(1) + 'px / ' + sz + ' no-repeat');
          }
        });
      }
      if (t < 1) later();
      else fading = null;
    };
    later();
  }
  // A PAGE CHANGE: the page's remembered picture is ready for it at once
  // (worn as the page shows), and a fresh one is painted when its sky has
  // drawn -- or PRE_NAV_MS on
  function onNavPre() {
    if (!PRE || !active) return;
    var path = here(), c = cache.get(path);
    pre.pending = null;
    pre.next = c ? { url: c.url, path: path } : null;
    // decoded now, while the page is still coming: worn as it shows, it is
    // drawn in that frame (a picture not shown for a while may have been
    // dropped from the decoded cache)
    // ...and what it was painted from, and when: back on its page, it is
    // judged as that picture (its age, its sky), not the last one painted
    if (c) { pre.drawn = path; pre.big = c.big; pre.small = c.small; pre.at = c.at; decoded(c.url); }
    if (viewUp === path) wearNext();
    clearTimeout(navT);
    navT = setTimeout(function () { navT = null; preTick(false); }, PRE_NAV_MS);
    clearTimeout(viewUpT);
    if (viewUp !== here()) viewUpT = setTimeout(viewShown, VIEW_UP_MS);
  }
  // the sky has settled (hk-sky-paint): a picture that read a slower fade
  // half-way is painted again now, slowly (it is the light moving)
  function onSkyPaint() {
    if (!PRE || !active) return;
    if (pre.unsettled && pre.url && pre.drawn === here()) { pre.unsettled = false; preTick(true); return; }
    onSkyChange();
  }
  // the sky changed (hk-sky-change, said at once -- or hk-sky-paint from a
  // sky that says only that)
  function onSkyChange() {
    if (!PRE || !active) return;
    // the sky has cut to a page whose picture is waiting: on now, with it
    wearNext();
    // the same page: preTick weighs it (big -- at once; the light -- at most
    // every PRE_DRIFT)
    if (pre.drawn !== here() && pre.url) { clearTimeout(navT); navT = null; }
    preTick(false);
  }
  // THE ONE DEADLINE: PRE_MAX after the last paint (the clouds have moved),
  // or PRE_DRIFT after it if the light has moved since
  function plan() {
    clearTimeout(pre.timer); pre.timer = null;
    if (!PRE || !active || !pre.at) return;
    var due = pre.at + maxAge();
    if (preSigs().small !== pre.small) due = Math.min(due, pre.at + PRE_DRIFT);
    pre.timer = setTimeout(function () { pre.timer = null; preTick(false); }, Math.max(0, due - Date.now()) + 20);
  }
  // A PAGE'S LAST PICTURE, remembered (PRE_CACHE pages): back on a page,
  // its picture goes on in the same instant as the page -- before the sky
  // has even drawn it -- and the fresh one fades in over it after. The
  // first visit waits for its paint (the sky's, then the picture's, ~0.1 s).
  var PRE_CACHE = 12, cache = new Map();
  function cached(u) { var hit = false; cache.forEach(function (c) { if (c.url === u) hit = true; }); return hit; }
  // A PICTURE NOTHING USES ANY MORE IS FREED: looked at once the longest
  // fade that could still be drawing it is over, and freed only if nothing
  // wears it then -- not the picture, not one pending or waiting for its
  // page, not one remembered, no layer's image, no pinned surface (nor a
  // fade on one); else looked at again after another fade.
  function inUse(u) {
    if (u === pre.url || u === pre.pending || (pre.next && u === pre.next.url) || cached(u)) return true;
    var used = false;
    eachLayer(function (L) { Array.prototype.forEach.call(L.querySelectorAll('[data-hk-pre]'), function (i) { if (picOf(i) === u) used = true; }); });
    pinned.forEach(function (t, el) { if ((el.style.background || '').indexOf(u) >= 0) used = true; });
    if (fading) fading.forEach(function (m) { if (m.fromUrl === u) used = true; });
    return used;
  }
  function freePic(u) {
    if (!u) return;
    setTimeout(function () {
      if (inUse(u)) { if (active) freePic(u); return; }
      pics.delete(u);
      try { URL.revokeObjectURL(u); } catch (e) { /* gone */ }
    }, Math.max(PRE_FADE, FADE_MS, PRE_AHEAD) + 100);
  }
  function remember(path, url) {
    var was = cache.get(path);
    cache.delete(path);
    cache.set(path, { url: url, big: pre.big, small: pre.small, at: pre.at });
    if (was && was.url !== url) freePic(was.url);
    while (cache.size > PRE_CACHE) { var k = cache.keys().next().value, c = cache.get(k); cache.delete(k); freePic(c.url); }
  }
  // EVERYTHING ON `url` NOW: the layers (faded on the same page, swapped on
  // another) and the pinned glass (faded when `fade`)
  function wearAll(url, path, same, fade, ms, coarse) {
    if (!ms) ms = PRE_FADE;
    var old = pre.url;
    pre.url = url; pre.path = path;
    eachLayer(function (L) {
      if (L._hkOverlay) return;
      if (!L._hkPre) { preDress(L); return; }
      if (picOf(L._hkPre) === url) return;
      var was = L._hkPre, img = preImg(url);
      if (!same) img.style.transition = 'none'; else { img.style.transition = 'opacity ' + ms + 'ms linear'; img.style.opacity = '0'; }
      L.appendChild(img);
      L._hkPre = img;
      // THE OLD PICTURE GOES ONCE THE NEW ONE IS IN -- counted from when its
      // fade STARTS, not from when it was put in. The fade starts in the next
      // frame, and in the seconds after a page load a wall tablet's next frame
      // can be most of a second away: the old picture's timer ran out first,
      // and every pill on the page showed the sky unblurred for two frames
      // until the new one's fade got going (screen-recorded on the Master
      // Bedroom, 2026-10-11, at 5-7 s after each load; never once the page
      // was idle). Its own transitionend says when it is in; the timer is
      // the backstop for a fade that never reports.
      var show = function () {
        if (!same) { was.remove(); return; }
        requestAnimationFrame(function () {
          img.style.opacity = '1';
          var gone = false, drop = function () { if (gone) return; gone = true; was.remove(); };
          if (img.addEventListener) img.addEventListener('transitionend', drop, { once: true });
          setTimeout(drop, ms + 250);
        });
      };
      show();                       // (drawn already: preShow decoded the picture)
    });
    pinAll(fade, ms, coarse);
    if (old && old !== url) freePic(old);
  }
  // THE DECODED PICTURES, by url: what each layer's canvas is drawn from
  var pics = new Map();
  function decoded(url) {
    if (typeof Image === 'undefined') return Promise.resolve(null);   // nothing to decode with (a test harness)
    var rec = pics.get(url);
    if (rec) return rec.job;
    var im = new Image(); im.src = url;
    rec = { im: im, done: false };
    var fin = function () { rec.done = true; return im; };
    rec.job = im.decode ? im.decode().then(fin, fin) : Promise.resolve(fin());
    pics.set(url, rec);
    return rec.job;
  }
  // A NEW PICTURE. Nothing wears it until it is decoded: WebKit draws a
  // background it has not decoded as nothing, and the menu's panel -- its
  // live blur already off -- showed the sky unblurred at page changes (the
  // Mac, 2026-10-10). Decoding it as an image is enough for the background
  // too: tested in WebKit, a background set once decode() resolved drew in
  // that same frame, every time; set before, it drew nothing for a frame
  // (a two-frame "warm-up" once added on top of it made no difference and
  // went). On the same page it fades in; on another page the layers swap
  // to it the moment it is ready.
  function preShow(url, path, ms, drift) {
    if (path === undefined) path = here();
    if (!ms) ms = PRE_FADE;
    var same = !pre.url || pre.path === path;
    pre.pending = url;
    var go = function () {
      if (pre.pending !== url || !PRE || !active || path !== here()) {
        if (pre.pending === url) pre.pending = null;
        freePic(url);
        return;
      }
      pre.pending = null;
      remember(path, url);
      if (path !== skyAt()) { var was = pre.next; pre.next = { url: url, path: path }; if (was && was.url !== url) freePic(was.url); return; }
      wearAll(url, path, same, same, ms, drift);
    };
    if (typeof Image === 'undefined') { go(); return; }          // nothing to decode with (a test harness)
    decoded(url).then(go);
  }
  function preNone() {
    var old = pre.url;
    pre.url = null; pre.big = ''; pre.small = '';
    pinAll();
    eachLayer(preUndress);
    freePic(old);
  }

  // ---- PRE-RENDERED: the picture ----
  function skyEl() {
    var el = window.hkSky && window.hkSky.element ? window.hkSky.element() : null;
    if (!el || !el.isConnected) return null;
    var cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' ? null : el;
  }
  // -> a Promise of { url: a blob URL, check }, or null when there is no sky
  // to paint (check: what hk-skyshot.js found -- check.ahead, check.unsettled). The
  // sky as a picture, blurred, is hk-skyshot.js's: what the browser shows,
  // drawn again from each piece's computed style and matrix (what moves
  // across the scene left out, as the sky says), then the look's own filter
  // (--hk-blur-filter: blur, saturate, brightness) over it -- every filter
  // applied by the browser, none by script.
  function preRender() {
    var sky = skyEl();
    if (!sky || !window.hkSkyShot || typeof DOMMatrix === 'undefined') return Promise.resolve(null);
    var f = (getComputedStyle(document.documentElement).getPropertyValue('--hk-blur-filter') || '').trim() || MAT;
    return window.hkSkyShot.render(sky, { scale: PRE_SCALE, moves: window.hkSky && window.hkSky.moves, filter: f, settle: PRE_AHEAD }).then(function (shot) {
      if (!shot) return null;
      return new Promise(function (res) {
        try { shot.canvas.toBlob(function (blob) { res(blob ? { url: URL.createObjectURL(blob), check: shot.check } : null); }, 'image/png'); } catch (e) { res(null); }
      });
    });
  }
  // WHAT THE PICTURE WOULD SHOW: big -- what the sky shows (its own
  // signature, hk-sky.js sig()), the page, the size, the blur's strength;
  // small -- the sky's light
  function preSigs() {
    var sky = skyEl(), path = '';
    try { path = location.pathname; } catch (e) { /* no location (a test harness) */ }
    var sg = sky && window.hkSky && window.hkSky.sig ? window.hkSky.sig() : { big: sky ? 'sky' : 'none', small: '' };
    var big = sg.big + '|' + window.innerWidth + 'x' + window.innerHeight + '|' + path +
      '|' + ((getComputedStyle(document.documentElement).getPropertyValue('--hk-blur-filter') || '').trim());
    return { big: big, small: sg.small };
  }
  function preTick(force) {
    if (!PRE || !active) return;
    if (document.hidden || (window.hkSky && window.hkSky.asleep && window.hkSky.asleep())) {
      if (pre.busy) pre.again = true;
      return;
    }
    var s = preSigs(), now = Date.now(), age = now - pre.at, path = here();
    var big = !pre.url || pre.drawn !== path || s.big !== pre.big;
    // WHILE PAINTING, an ask means: look again once this one is done -- and the
    // signatures say whether anything changed. (A forced paint after every
    // ask painted the same sky three more times at each page change, each
    // blur and encode ~40 ms of WebKit's main thread, 2026-10-10.) Except a
    // CHANGE of what the sky shows since that paint began: it does not wait
    // behind it (a paint can wait up to 4 s for a picture that never comes,
    // hk-skyshot.js) -- it starts now, and the older paint is dropped.
    if (pre.busy && !(pre.busySig && s.big !== pre.busySig)) { pre.again = true; return; }
    // THE FIRST PICTURE WAITS FOR THE CLOUDS (at most PRE_CLOUDS_MS): taken
    // at load it came before them, and the pills wore a cloudless sky,
    // darker than the one behind them, for 5 s (the Mac, 2026-10-10). The
    // layers blur live meanwhile; the sky says when they are up
    // (hk-sky-paint).
    if (!pre.url && Date.now() - pre.since < PRE_CLOUDS_MS && window.hkSky && window.hkSky.cloudsPending && window.hkSky.cloudsPending()) return;
    var due = force || big || (s.small !== pre.small && age > PRE_DRIFT) || age > maxAge();
    if (!due) { plan(); return; }
    // only the sky moving on: not while the page is touched or scrolled (a
    // press whose release never came is let go of after PRE_STUCK)
    if (touching > 0 && now - lastInput > PRE_STUCK) touching = 0;
    if (!force && !big && (touching > 0 || now - lastInput < PRE_QUIET)) {
      clearTimeout(pre.timer);
      pre.timer = setTimeout(function () { pre.timer = null; preTick(false); }, Math.max(100, lastInput + PRE_QUIET - now));
      return;
    }
    var gen = ++pre.gen, mine = function () { return gen === pre.gen; };
    pre.busy = true; pre.busySig = s.big;
    var gaveUp = false, guard = setTimeout(function () { gaveUp = true; if (mine()) { pre.busy = false; plan(); } }, PRE_RENDER_MS), job;
    try { job = preRender(); } catch (e) { job = Promise.reject(e); }
    job.then(function (shot) {
      clearTimeout(guard);
      var url = shot && shot.url, check = (shot && shot.check) || {};
      // given up on, or a newer paint has started since: dropped
      if (gaveUp || !mine()) { if (url) URL.revokeObjectURL(url); return; }
      pre.busy = false; pre.busySig = null;
      if (!PRE || !active) { if (url) URL.revokeObjectURL(url); return; }
      pre.at = Date.now(); pre.big = s.big; pre.small = s.small; pre.drawn = path;
      // a slower fade read as it is now: painted again when the sky says it
      // has settled (onSkyPaint)
      pre.unsettled = !!check.unsettled;
      // a change goes on quickly -- with the sky's own fade if longer; the
      // light or the clouds drifting, slowly
      var ms = big ? Math.max(PRE_SWAP, Math.min(PRE_AHEAD, check.ahead || 0)) : Math.min(PRE_FADE, maxAge());
      if (url) preShow(url, path, ms, !big && ms <= PRE_TRACK);
      else if (path !== skyAt()) pre.next = { url: null, path: path };
      else preNone();
      // the page moved on, or the sky changed, while this was painted: paint
      // it again
      if (pre.again || here() !== path || preSigs().big !== s.big) { pre.again = false; preTick(false); }
      else plan();
    }, function () { clearTimeout(guard); if (!gaveUp && mine()) { pre.busy = false; pre.busySig = null; plan(); } });
  }
  function recFor(anchor) {
    var rec = layers.get(anchor);
    if (rec) {
      rec.layers = rec.layers.filter(function (l) { return l.isConnected; });
      return rec;
    }
    var posWas = null;
    // The layers' containing block must be the anchor (a row may be static).
    if (anchor !== DOC && getComputedStyle(anchor).position === 'static') {
      posWas = anchor.style.position || '';
      anchor.style.position = 'relative';
    }
    rec = { layers: [], posWas: posWas };
    layers.set(anchor, rec);
    if (ro && anchor !== DOC) ro.observe(anchor);
    return rec;
  }
  function dropLayer(anchor) {
    var rec = layers.get(anchor);
    if (!rec) return;
    rec.layers.forEach(function (l) { l.remove(); });
    if (rec.posWas !== null && anchor !== DOC) anchor.style.position = rec.posWas;
    if (ro && anchor !== DOC) { try { ro.unobserve(anchor); } catch (e) { /* gone */ } }
    layers.delete(anchor);
  }

  // ONE PLATE -> its shape in its anchor's coordinates, or null when it has
  // no visible box. Shared by the full pass and the press pass.
  function measure(p) {
    var r = p.el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (var j = 0; j < p.clips.length; j++) {
      var c = p.clips[j].getBoundingClientRect();
      x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top);
      x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom);
    }
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    // Into the anchor's own coordinates: its padding box, plus its scroll
    // offset when it is the scroller -- and in ITS units. Under CSS
    // `zoom` (the car dashboards: tesla-viewport.js zooms the document)
    // getBoundingClientRect is in zoomed screen pixels while the layer's
    // lengths are multiplied by the zoom again, so every shape would land
    // short of its pill (seen in Chrome at zoom 0.67).
    // currentCSSZoom is the effective zoom; exactly 1 without one.
    var A = p.anchor, k = 1, lx, ly;
    if (A === DOC) {
      k = document.documentElement.currentCSSZoom || 1;
      lx = function (v) { return v / k + window.scrollX / k; };
      ly = function (v) { return v / k + window.scrollY / k; };
    } else {
      var b = A.getBoundingClientRect(), kx, ky;
      if ('currentCSSZoom' in A) {
        // Zoom times the transforms on and above the anchor (a pop-up or a
        // detail sheet mid-open: see scaleOf).
        var ts = scaleOf(A);
        k = A.currentCSSZoom || 1; kx = k * ts.x; ky = k * ts.y;
      } else {
        // The ratio already carries both.
        kx = ky = (A.offsetWidth ? b.width / A.offsetWidth : 1) || 1;
      }
      var sx = p.scrolls ? A.scrollLeft : 0, sy = p.scrolls ? A.scrollTop : 0;
      lx = function (v) { return (v - b.left) / kx - A.clientLeft + sx; };
      ly = function (v) { return (v - b.top) / ky - A.clientTop + sy; };
    }
    // THE PLATE'S OWN CORNERS, all four, at the size it is DRAWN: a computed
    // radius is in the plate's layout px, and a Home Grid's canvas scales
    // its blocks whole (hk-layout.js _measure) -- read unscaled, the cut came
    // out tighter than the plate and its rim, a darker patch past the
    // tile's own curve (the owner, 2026-10-30: Good Morning's lower right)
    var cs = getComputedStyle(p.el), ow = p.el.offsetWidth;
    var z = (ow ? r.width / ow : 1) / (A === DOC ? k : (kx || 1));
    var rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]
      .map(function (v) { var n = parseFloat(v) || 0; return (/%$/.test(v) ? n / 100 * Math.min(ow, p.el.offsetHeight) : n) * z; });
    if (rad[0] === rad[1] && rad[1] === rad[2] && rad[2] === rad[3]) rad = rad[0];
    var X0 = lx(x0), Y0 = ly(y0);
    return { A: A, shape: { x: X0, y: Y0, w: lx(x1) - X0, h: ly(y1) - Y0, r: rad } };
  }

  // ONE ANCHOR'S LAYERS from its group of shapes: size, bands, clip paths.
  // Returns how many band layers it has.
  //
  // SIZED FROM THE SHAPES ALONE, never from the anchor's scrollWidth or
  // scrollHeight. The layer is itself scrollable overflow, so those read its
  // own size back and it could only grow: a row that lost a conditional chip
  // would still scroll out to its old width, and a page that got shorter
  // would keep its old height (measured in Chrome: a row of 200 px of cards
  // stayed 600 wide). The view's width is also clamped to the client box, so
  // a layer never widens a page that does not scroll sideways.
  function place(A, g, dpr) {
    var rec = recFor(A), right = 0, bottom = 0;
    g.shapes.forEach(function (sh) { right = Math.max(right, sh.x + sh.w); bottom = Math.max(bottom, sh.y + sh.h); });
    var W = Math.ceil(g.scrolls || A === DOC ? right : Math.min(right, A.clientWidth || right));
    var H = Math.ceil(bottom);
    var bs = bands(g.shapes, W, H, dpr);
    while (rec.layers.length < bs.length) rec.layers.push(newLayer(A));
    while (rec.layers.length > bs.length) rec.layers.pop().remove();
    bs.forEach(function (band, i) {
      var L = rec.layers[i], dy = band.axis === 'y' ? band.start : 0, dx = band.axis === 'x' ? band.start : 0;
      var w = band.axis === 'x' ? band.len : band.cross, h = band.axis === 'y' ? band.len : band.cross;
      L.style.left = dx + 'px'; L.style.top = dy + 'px';
      // Plain inline sizes: hk-row's phone rule sizes every row child but
      // this layer (:not([data-hk-glass-layer])), so there is nothing to beat.
      L.style.width = Math.ceil(w) + 'px';
      L.style.height = Math.ceil(h) + 'px';
      var path = "path('" + band.shapes.map(function (sh) {
        return rrect(sh.x - dx, sh.y - dy, sh.w, sh.h, sh.r);
      }).join('') + "')";
      if (L.getAttribute('data-path') !== path) {
        L.style.clipPath = band.shapes.length ? path : 'inset(100%)';
        L.setAttribute('data-path', path);
      }
    });
    return bs.length;
  }

  // THE LAST PASS, kept so a press can re-cut one card without re-measuring
  // the page: anchor -> {shapes (each tagged with its card), scrolls}.
  var lastGroups = null;

  function gone(p) { return !p.el.isConnected; }
  // A CARD IS COLLECTED AGAIN ONLY WHEN IT CHANGED: it joined or left
  // (`dirty`), a plate was replaced, or its tree changed size -- its first
  // render after joining, a rebuild, rows added. Not every card on every join
  // anywhere, and not every card with no glass surface (headings, pop-up
  // groups, the now-playing card, the detail panels) on every pass, the 2 s
  // backstop included: collect() reads the computed style of every element
  // in the card. Counting the elements is cheap.
  var sizeAt = new WeakMap();    // card -> its element count when last collected
  function treeSize(card) { return card.shadowRoot ? card.shadowRoot.querySelectorAll('*').length : 0; }
  // A CARD THAT LEFT WITH ITS PAGE keeps what was collected (parked, held
  // only as long as the card is): Home Assistant re-attaches a page it has
  // shown, and a card coming back unchanged -- the same plates, its tree the
  // same size -- is not collected again (collect() reads the computed style
  // of every element in it: every card of Home on every return, measured
  // headless at 6x slower as a third of the shared blur's page-change cost).
  var parked = new WeakMap();
  function forget(card) {
    var ps = plates.get(card);
    if (ps && ro) ps.forEach(function (p) { try { ro.unobserve(p.el); } catch (e) { /* gone */ } });
    if (ps) parked.set(card, ps);
    plates.delete(card);
  }
  function unpark(card) {
    var ps = parked.get(card);
    parked.delete(card);
    if (!ps || ps.some(gone) || sizeAt.get(card) !== treeSize(card)) return null;
    plates.set(card, ps);
    if (ro) ps.forEach(function (p) { ro.observe(p.el); });
    return ps;
  }
  function recollect(card) {
    forget(card);
    var ps = collect(card);
    plates.set(card, ps);
    if (ro) ps.forEach(function (p) { ro.observe(p.el); });
    sizeAt.set(card, treeSize(card));
    return ps;
  }

  function update() {
    queued = false;
    if (!active) return;
    watchViews();
    var t0 = performance.now();
    scaleMemo = new Map();
    var groups = new Map(), rects = 0;
    // A card that left the page (HkBase drops it from `cards` on disconnect)
    // leaves `plates` and the observer too, or every navigation on a wall
    // tablet grows both for as long as blur mode is on; a
    // promoted element that left gives its will-change back.
    promoted.forEach(function (was, n) { if (!n.isConnected) unpromote(was, n); });
    plates.forEach(function (ps, c) { if (!cards.has(c)) forget(c); });
    // Collected, then promoted, all of them, THEN measured: a promotion
    // writes will-change, and written between two measurements it made the
    // next one lay the page out again -- once per row card on every return
    // to a page (18 forced layouts on the Living Room's Home, traced).
    var todo = [];
    cards.forEach(function (card) {
      if (!card.isConnected) return;
      var ps = plates.get(card), back = false;
      if (!ps && !full && dirty.has(card)) back = !!(ps = unpark(card));
      if (full || (dirty.has(card) && !back) || !ps || ps.some(gone) || sizeAt.get(card) !== treeSize(card)) {
        ps = recollect(card);
      }
      todo.push([card, ps]);
    });
    todo.forEach(function (cp) { cp[1].forEach(function (p) { if (p.sideways) promote(p); }); });
    todo.forEach(function (cp) {
      var card = cp[0], ps = cp[1];
      if (carried.has(card)) return;            // its own blur while carried (carry)
      ps.forEach(function (p) {
        var m = measure(p);
        if (!m) return;
        if (!groups.has(m.A)) groups.set(m.A, { shapes: [], scrolls: p.scrolls });
        m.shape.card = card;
        groups.get(m.A).shapes.push(m.shape);
        rects++;
      });
    });
    full = false; dirty.clear();
    var count = 0, dpr = window.devicePixelRatio || 1;
    layers.forEach(function (rec, A) { if (!groups.has(A)) dropLayer(A); });
    groups.forEach(function (g, A) { count += place(A, g, dpr); });
    if (PRE && fresh()) eachLayer(preCheck);
    lastGroups = groups;
    if (PRE && pinned.size) pinAll(false);
    scaleMemo = null;
    stats.layers = count; stats.anchors = layers.size; stats.rects = rects; stats.updates++;
    stats.promoted = promoted.size;   // row cards with their own layer (see promote)
    stats.lastMs = +(performance.now() - t0).toFixed(1);
  }

  // THE PRESS PASS: only the pressed cards are re-measured, and only their
  // anchors' layers are re-cut; every other shape comes from the last pass.
  // A pass over the page measured 7-9 ms on a wall tablet (every
  // glass card, getBoundingClientRect and computed style each) -- run on
  // every frame of a press, most of a 90 fps frame. A card that has left the
  // page or has nothing to measure is dropped from `list`; false when
  // nothing was re-cut, and the caller stops (it NEVER falls back to a full
  // update: after a tap that navigated, that would run every frame of the
  // tail).
  function pressUpdate(list) {
    if (!lastGroups) return false;
    var t0 = performance.now(), touched = new Set();
    scaleMemo = new Map();
    list.forEach(function (card) {
      if (carried.has(card)) return;            // its own blur while carried (carry)
      var ps = card.isConnected && plates.get(card);
      if (ps && ps.length && ps.some(gone)) ps = recollect(card);   // rebuilt by the tap
      if (!ps || !ps.length) { list.delete(card); return; }
      var cut = new Set();
      ps.forEach(function (p) {
        var m = measure(p);
        var g = m && lastGroups.get(m.A);
        if (!g) return;
        if (!cut.has(m.A)) {
          g.shapes = g.shapes.filter(function (sh) { return sh.card !== card; });
          cut.add(m.A);
        }
        m.shape.card = card;
        g.shapes.push(m.shape);
        touched.add(m.A);
      });
    });
    scaleMemo = null;
    if (!touched.size) return false;
    var dpr = window.devicePixelRatio || 1;
    touched.forEach(function (A) { place(A, lastGroups.get(A), dpr); });
    stats.pressMs = +(performance.now() - t0).toFixed(2);
    return true;
  }

  function schedule(recollect) {
    if (recollect) full = true;
    if (!active || queued) return;
    queued = true;
    requestAnimationFrame(update);
  }

  // A PRESSED CARD SHRINKS (scale .96-.97 on :active, 120-140 ms) but its
  // cut-out in the shared layer would stay full size, showing a ring of frost
  // around every pill pushed in. No observer hears a
  // transform, so while a finger is on a glass card -- and for the release
  // animation after -- the shapes are re-cut every frame from the live
  // (transformed) boxes. getBoundingClientRect in the animation frame reads
  // this frame's transition value, so the frost moves in step. Idle
  // otherwise: nothing runs per frame when nobody is touching the screen.
  //
  // EVERY PRESSED CARD IS FOLLOWED, not only the last: a second tap inside
  // the first one's release would leave the first cut-out shrunk until the
  // 2 s backstop. The loop runs while any finger that went down on
  // a glass card is down, and PRESS_TAIL_MS after the last one lifts; it
  // stops early when no pressed card is left to measure (a tap that
  // navigated), and it always ends with one ordinary update.
  var pressed = new Set(), pointers = new Set(), pressUntil = 0, pressTicking = false, PRESS_TAIL_MS = 300;
  // The innermost glass card under the finger that has plates (a chip, not
  // the row card around it).
  function glassCardOf(e) {
    var path = e.composedPath ? e.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      var ps = cards.has(path[i]) && plates.get(path[i]);
      if (ps && ps.length) return path[i];
    }
    return null;
  }
  function pressTick() {
    if (active && (pointers.size || performance.now() <= pressUntil) && pressUpdate(pressed)) {
      requestAnimationFrame(pressTick);
      return;
    }
    pressTicking = false; pressed.clear(); pointers.clear();
    schedule(false);
  }
  function onDown(e) {
    if (!active) return;
    var c = glassCardOf(e);
    if (!c) return;
    pressed.add(c); pointers.add(e.pointerId);
    if (pressTicking) return;
    pressTicking = true;
    requestAnimationFrame(pressTick);
  }
  function onUp(e) {
    if (!pointers.delete(e.pointerId)) return;
    if (!pointers.size) pressUntil = performance.now() + PRESS_TAIL_MS;
  }
  // The glass cards `el` is or holds (a grid's wrapper round its pill).
  function cardsIn(el) {
    if (cards.has(el)) return [el];
    var out = [];
    cards.forEach(function (c) {
      for (var n = flatParent(c); n && n.nodeType === 1; n = flatParent(n)) if (n === el) { out.push(c); return; }
    });
    return out;
  }
  // MOVED BY TRANSFORM (Edit mode's pills gliding aside): the same
  // per-frame re-cut as a press, for `ms` from now.
  function moving(el, ms) {
    if (!active || !el) return;
    var cs = cardsIn(el);
    if (!cs.length) return;
    cs.forEach(function (c) { pressed.add(c); });
    pressUntil = Math.max(pressUntil, performance.now() + (ms || 0));
    if (pressTicking) return;
    pressTicking = true;
    requestAnimationFrame(pressTick);
  }

  // CARRIED (Edit mode's pill under the finger): out of the shared layer,
  // and its plate blurs what is behind it itself, as under "Blur each card".
  // A cut-out re-cut every frame stayed behind the pill on an iPad (Safari,
  // 2026-10-27: the frost a pill's length off while it was carried), though
  // in step in every headless engine; a plate's own blur moves with it on
  // the compositor. One more blur surface, for one pill, while it is held.
  var carried = new Map();       // card -> its own --hk-glass-backdrop before
  function carry(el, on) {
    if (!el || on && !active) return;           // no shared layer (another look): nothing to stand in for
    (on ? cardsIn(el) : Array.from(carried.keys()).filter(function (c) { return c === el || cardsIn(el).indexOf(c) >= 0; }))
      .forEach(function (c) {
        if (on) {
          if (carried.has(c)) return;
          carried.set(c, c.style.getPropertyValue('--hk-glass-backdrop'));
          c.style.setProperty('--hk-glass-backdrop', 'var(--hk-blur-filter,' + MAT + ')');
        } else {
          var was = carried.get(c);
          carried.delete(c);
          if (was) c.style.setProperty('--hk-glass-backdrop', was); else c.style.removeProperty('--hk-glass-backdrop');
        }
        if (active && lastGroups) {
          lastGroups.forEach(function (g) { g.shapes = g.shapes.filter(function (sh) { return sh.card !== c; }); });
          if (on) { var dpr = window.devicePixelRatio || 1; lastGroups.forEach(function (g, A) { if (A.isConnected !== false) place(A, g, dpr); }); }
        }
        if (!on) { dirty.add(c); schedule(false); }
      });
  }

  function start() {
    if (active) return;
    active = true; full = true;
    watchViews();
    SH.onNavigate(watchViews);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    try { ro = new ResizeObserver(function () { schedule(false); }); } catch (e) { ro = null; }
    // EVERY CARD'S OWN BOX TOO: a plate moves only when something before it
    // in the page changes size, and everything on these pages is a card --
    // so a card growing (a row added, a picture loaded) says so itself.
    try { hostRo = new ResizeObserver(function () { schedule(false); }); } catch (e) { hostRo = null; }
    if (hostRo) cards.forEach(function (c) { hostRo.observe(c); });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisible);
    // A BACKSTOP for a layout move nothing reports (something not a card
    // changing size above a plate): one pass that measures every plate and
    // collects nothing (7-9 ms on a wall tablet, see pressUpdate). It ran
    // every 2 s, the only way a card growing above was heard; the cards
    // report that themselves now (hostRo), so it is a long backstop.
    // Not while nobody can see it: hidden, or behind the photo screensaver
    // (an overlay -- document.hidden stays false; hk-sky knows).
    timer = setInterval(function () {
      if (document.hidden || (window.hkSky && window.hkSky.asleep && window.hkSky.asleep())) return;
      schedule(false);
    }, BACKSTOP_MS);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { schedule(true); });
    schedule(true);
    if (PRE) {
      pre.since = Date.now();
      preTick(false);
      setTimeout(function () { if (PRE && active && !pre.url) preTick(false); }, PRE_CLOUDS_MS + 50);   // the clouds never said
    }
    if (PRE) {
      viewUp = here();
      SH.onNavigate(onNavPre);
      window.addEventListener('popstate', onNavPre);
      window.addEventListener('hk-sky-paint', onSkyPaint);
      window.addEventListener('hk-sky-change', onSkyChange);
      INPUTS.forEach(function (t) { window.addEventListener(t, onInput, { capture: true, passive: true }); });
      window.addEventListener('hk-asleep', onWakePre);
    }
  }
  function stop() {
    if (!active) return;
    active = false;
    SH.offNavigate(watchViews);
    if (viewMo) { viewMo.disconnect(); viewMo = null; viewBox = null; }
    clearInterval(timer); timer = null;
    if (hostRo) { hostRo.disconnect(); hostRo = null; }
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    pressed.clear(); pointers.clear();
    carried.forEach(function (was, c) { if (was) c.style.setProperty('--hk-glass-backdrop', was); else c.style.removeProperty('--hk-glass-backdrop'); });
    carried.clear();
    if (ro) { ro.disconnect(); ro = null; }
    Array.from(layers.keys()).forEach(dropLayer);
    plates = new Map(); dirty.clear(); lastGroups = null;
    promoted.forEach(unpromote);
    clearTimeout(pre.timer); pre.timer = null;
    if (fadeRaf && window.cancelAnimationFrame) cancelAnimationFrame(fadeRaf);
    fadeRaf = null; clearTimeout(fadeTimer); fadeTimer = null; fading = null; pre.pending = null;
    cache.forEach(function (c) { if (c.url !== pre.url) { try { URL.revokeObjectURL(c.url); } catch (e) { /* gone */ } } }); cache.clear();
    pics.clear();
    pinned.forEach(function (t, el) { unpinEl(el); });
    SH.offNavigate(onNavPre);
    window.removeEventListener('popstate', onNavPre);
    window.removeEventListener('hk-sky-paint', onSkyPaint);
    window.removeEventListener('hk-sky-change', onSkyChange);
    INPUTS.forEach(function (t) { window.removeEventListener(t, onInput, { capture: true, passive: true }); });
    touching = 0;
    window.removeEventListener('hk-asleep', onWakePre);
    clearTimeout(navT); navT = null;
    clearTimeout(viewUpT); viewUpT = null;
    if (pre.url) { try { URL.revokeObjectURL(pre.url); } catch (e) { /* gone */ } }
    if (pre.next && pre.next.url) { try { URL.revokeObjectURL(pre.next.url); } catch (e) { /* gone */ } }
    pre.url = null; pre.big = ''; pre.small = ''; pre.at = 0; pre.path = null; pre.again = false; pre.next = null; pre.drawn = null;
  }
  function onResize() { schedule(true); if (PRE && active) preTick(false); }
  function onVisible() { if (!document.hidden) { schedule(false); onWakePre(); } }
  // back from hidden or asleep (no paint while either): what changed meanwhile
  function onWakePre() { if (PRE && active) preTick(false); }

  // blur and blur_pre share the layers; switching between them rebuilds
  // them, live or pictured. Bright Glass (2026-10-30) in its Shared Layer
  // and Pre-rendered modes wears the same layers with its own filter
  // (--hk-blur-filter)
  function sync() {
    var g = window.hkSettings && window.hkSettings.glass ? window.hkSettings.glass() : '';
    var want = g === 'blur' || g === 'blur_pre' || g === 'bright' || g === 'bright_pre';
    var wantPre = g === 'blur_pre' || g === 'bright_pre';
    if (active && wantPre !== PRE) stop();
    PRE = wantPre;
    if (want) start(); else stop();
    if (PRE && active) preTick(false);          // the blur's strength, say
  }

  window.hkGlass = {
    // HkBase calls this when a card joins or leaves (window.__hkGlassCards).
    // Only this card is collected again; a card joining a view says the
    // view is on the page (onPage).
    changed: function (card, on) {
      if (!active) return;
      if (!card) { schedule(true); return; }
      if (hostRo) { try { if (on) hostRo.observe(card); else hostRo.unobserve(card); } catch (e) { /* gone */ } }
      if (on) { var v = viewOf(card); if (v) onPage(v); }
      dirty.add(card);
      schedule(false);
    },
    // HkBase calls this when a joined card has drawn again: collected again
    // on the next frame only if its plates were replaced or its tree changed
    // size (a plate drawn late), as update() would have found -- every
    // other draw costs a count of its elements.
    // hk-edit.js calls this as it moves a card by transform (no observer
    // hears one): its frost follows it every frame for `ms`.
    moving: moving,
    // ...and as it carries one: `on`, the card blurs behind itself and is
    // out of the shared layer; off, back in it.
    carry: carry,
    carrying: function (card) { return carried.has(card); },
    rendered: function (card) {
      if (!active || !card || !card.isConnected) return;
      var ps = plates.get(card);
      if (ps && !ps.some(gone) && sizeAt.get(card) === treeSize(card)) return;
      dirty.add(card);
      schedule(false);
    },
    stats: function () {
      var live = 0, pictured = 0;
      eachLayer(function (L) { if (L._hkPre) pictured++; else live++; });
      return Object.assign({ active: active, cards: cards.size, pre: PRE, pictured: pictured, live: live,
                             preAge: pre.at ? Date.now() - pre.at : null }, stats);
    },
    // PRE-RENDERED: paint the picture again now (debugging, Sky Lab)
    repaint: function () { preTick(true); },
    // PINNED GLASS (hk-menu.js, hk-tabbar.js): `el` wears its slice of the
    // picture under `tint` (CSS background layers) whenever there is one;
    // pin again after it moves (a sheet opened, the panel slid in)
    pin: function (el, tint) {
      if (!el) return;
      pinned.set(el, tint);
      if (PRE && active) pinAll(false);
    },
    unpin: function (el) { if (!el) return; pinned.delete(el); unpinEl(el); },
    repin: function () { if (PRE && active) pinAll(false); },
    // One update now, without waiting for a frame (debugging; a hidden tab
    // runs no animation frames).
    refresh: function () { full = true; queued = false; update(); return this.stats(); },
    _rrect: rrect,     // tests
    _pre: { show: preShow, none: preNone, render: preRender, nav: onNavPre, sigs: preSigs, state: function () { return pre; } },
    _bands: bands,
    _transformScale: transformScale,
    _scaleOf: scaleOf
  };

  if (window.hkSettings && window.hkSettings.onChange) window.hkSettings.onChange(sync);
  sync();
})();
