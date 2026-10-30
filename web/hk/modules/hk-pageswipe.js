// hk-pageswipe.js -- SWIPE BETWEEN PAGES (docs/phase11/HOMEVIEW-LOOK.md,
// Phase 0; DESIGN.md Motion, "A page swipe", 2026-10-30).
//
// A sideways swipe anywhere on a page takes you to the next or the previous
// page. The page follows the finger, the next one comes in beside it, and the
// tab bar's highlight slides along with it (hk-tabbar.js follow / land), so
// it is always under the page you are about to land on. The sky or the ground
// stays still behind: only the views move, by transform.
//
// THE ORDER (the owner's decision 8): the tab bar's tabs, left to right as it
// shows them (More is not a page); on a page that isn't in it -- a room, a
// page under More -- no page swipe. With no tab bar, the side menu's order:
// Home, then its Categories (hkTabBar.pages()). Others put pages in it with
// hkPageSwipe.extend(fn): fn(items, ctx) gives the list back, changed (the
// Pages screen goes right after Home).
//
// WHEN: the screen's Swipe Between Pages (hkSettings.swipePages(): its own
// swipe_pages, else All Screens' menu.swipe_pages) -- Automatic is on where a
// tab bar shows, or where the screen has its Pages screen (`pages_screen`);
// On, everywhere; Off. Never in Edit mode (HK's or Home Assistant's), with a
// detail sheet, a pop-up (an address #hash), the menu or the bar's More open,
// or while the screensaver or the black screen shows; never off the page
// itself (HK Settings, the editor's preview, the bar, a sheet).
//
// WHAT KEEPS ITS OWN SWIPE: hkDrag.sideways (hk-drag.js), the one list --
// a block that swipes its pages, sliders, the thermostat's ring, a field,
// anything data-hk-control, a row that scrolls sideways. A Home Grid with
// views turns them first and hands a swipe past its last view over
// (hk-swipe-past, hk-layout.js); a swipe back from the next page lands on
// its last view (swipeEnter). A swipe that starts within EDGE px of either
// side is left alone: the left is the side menu's edge swipe, and in Safari
// either edge is the browser's back and forward.
//
// THE NUMBERS are the grid's views': it starts past START px sideways at
// RATIO times the vertical (hkDrag.classify); it lands past TURN of the width,
// or on a flick over FLICK px/ms; past the first and the last page it gives
// GIVE of the travel and springs back. Lands on `standard` (.34 s); Reduce
// Motion (or Flat's motion off): nothing follows the finger, the page
// cross-fades (`fade`, .2 s) and the highlight jumps.
//
// THE NEIGHBOUR is the view host's own, when it holds it (hkViewHost.live()
// .peek(): Home and the last four pages): put in the slot beside the page,
// fixed to the screen, fed the newest client. A page it doesn't hold shows
// its title on the page's ground while the swipe moves, and is built as it
// lands -- never during the drag. A tablet the slow-tablet ladder has flagged
// (hk-fps.js: under SLOW_FPS with what it shows now) gets that plain plate
// for every page, and the glass when it lands.
//
// FOLLOWED BY POINTER EVENTS, captured only for a mouse (a touch is the
// target's own until it ends: WebKit kept a captured touch, hk-menu.js); the
// page says touch-action pan-y while the swipe is on here, so a sideways drag
// comes here and an up-and-down one stays the browser's scroll.
(function () {
  'use strict';
  if (window.hkPageSwipe) return;

  var EDGE = 24, START = 10, RATIO = 1.4, TURN = 0.2, FLICK = 0.5, FLICK_MIN = 30, GIVE = 1 / 3;
  var EAT_MS = 350, FLICK_WINDOW = 100, LAND_WAIT = 5000, SLOW_FPS = 45;
  var STANDARD = 'cubic-bezier(.32,.72,0,1)', STANDARD_MS = 340, FADE_MS = 200;
  // the props a swipe sets on a view, given back as they were
  var PROPS = ['transform', 'transition', 'transform-origin', 'position', 'left', 'top', 'width', 'height', 'max-height',
               'overflow', 'will-change', 'pointer-events', 'opacity'];

  // ------------------------------------------------------------ the rules
  // (pure: the tests hold them, test_pageswipe.js)

  // Swipe Between Pages here: 'auto' -- where a tab bar shows or the Pages
  // screen is on; 'on'; 'off'
  function enabled(mode, ctx) {
    ctx = ctx || {};
    if (mode === 'off') return false;
    if (mode === 'on') return true;
    return !!(ctx.bar || ctx.pagesScreen);
  }
  // THE ORDER, extended: each fn(items, ctx) may give a new list
  var EXTEND = [];
  function order(ctx) {
    var items = ((ctx && ctx.items) || []).filter(Boolean);
    EXTEND.forEach(function (fn) {
      try { var out = fn(items.slice(), ctx || {}); if (Array.isArray(out)) items = out.filter(Boolean); }
      catch (e) { try { console.error('[hk-pageswipe] an order extension threw', e); } catch (x) { /* no console */ } }
    });
    return items;
  }
  function extend(fn) {
    if (typeof fn !== 'function') return function () {};
    EXTEND.push(fn);
    return function () { var i = EXTEND.indexOf(fn); if (i >= 0) EXTEND.splice(i, 1); };
  }
  // where `path` is in the list, and the pages either side (null at an end;
  // at -1: not in it, no page swipe)
  function neighbours(items, path, isHere) {
    var at = -1;
    (items || []).forEach(function (it, i) { if (at < 0 && it && isHere(it, path)) at = i; });
    return { at: at, prev: at > 0 ? items[at - 1] : null, next: at >= 0 && at < items.length - 1 ? items[at + 1] : null };
  }
  // within EDGE of either side of the page (its side safe areas are not the page's: the iPhone Duo's strip)
  function atEdge(x, width, left, right) {
    return x < (left || 0) + EDGE || x > width - (right || 0) - EDGE;
  }
  // how far the page goes for the finger's dx: all of it towards a page, GIVE of it past the ends
  function travel(dx, toward) { return toward ? dx : dx * GIVE; }
  // does it land: past TURN of the width, or flicked that way (v px/ms)
  function lands(dx, width, v) {
    if (!dx) return false;
    if (Math.abs(dx) > width * TURN) return true;
    return Math.abs(dx) > FLICK_MIN && Math.abs(v || 0) > FLICK && (v < 0) === (dx < 0);
  }
  // the speed of the last FLICK_WINDOW ms of [t, x] samples
  function speed(pts) {
    if (!pts || pts.length < 2) return 0;
    var last = pts[pts.length - 1], first = last;
    for (var i = pts.length - 1; i >= 0; i--) { if (last[0] - pts[i][0] > FLICK_WINDOW) break; first = pts[i]; }
    var dt = last[0] - first[0];
    return dt > 0 ? (last[1] - first[1]) / dt : 0;
  }
  // the view's address on its dashboard: '/dashboard-hall/lights' -> 'lights'
  function viewSeg(path) { return String(path || '').split(/[?#]/)[0].split('/')[2] || ''; }

  // ------------------------------------------------------------ the page
  function C() { return window.hkCards || null; }
  function SH() { return window.hkShell || null; }
  function menu() { var c = C(); return c && c.menu ? c.menu : null; }
  function board() { var M = menu(); try { return (M && M.board && M.board()) || {}; } catch (e) { return {}; } }
  function barShown() { var M = menu(); try { return !!(M && M.tabBar && M.tabBar()); } catch (e) { return false; } }
  function mode() {
    var S = window.hkSettings;
    try { return S && S.swipePages ? S.swipePages() : 'auto'; } catch (e) { return 'auto'; }
  }
  // THE PAGES SCREEN (Phase J, built beside this): read as it comes -- its
  // own reader when there is one, else the screen's `pages_screen`; absent, off
  function pagesScreen() {
    var S = window.hkSettings;
    if (S && typeof S.pagesScreen === 'function') { try { return !!S.pagesScreen(); } catch (e) { return false; } }
    var v = board().pages_screen;
    return v === true || v === 'on';
  }
  function on() { return enabled(mode(), { bar: barShown(), pagesScreen: pagesScreen() }); }
  function isHere(it, path) {
    var H = window.hkMenu && window.hkMenu._;
    return H && H.isHere ? H.isHere(it, path) : it.path === path;
  }
  function list() {
    var T = window.hkTabBar, p = { bar: false, items: [] };
    try { if (T && T.pages) p = T.pages() || p; } catch (e) { /* not drawn yet */ }
    return order({ items: p.items || [], bar: !!p.bar, board: board(), path: location.pathname,
                   pagesScreen: pagesScreen() });
  }
  function currentView() {
    var S = SH(), M = menu();
    if (!S || !S.viewSlot || !S.view) return null;
    try { return S.view(S.viewSlot(M && M.panel ? M.panel() : null)) || null; } catch (e) { return null; }
  }
  function reduced() {
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true; } catch (e) { /* none */ }
    var HS = window.hkSettings, r = null;
    try { r = HS && HS.rendering ? HS.rendering() : null; } catch (e) { r = null; }
    return !!(r && r.motion === false);
  }
  // WHAT HOLDS IT OFF, now (a reason, or '')
  function blocked() {
    if (!on()) return 'off';
    var S = SH();
    try { if (S && S.onDashboard && S.onDashboard() === false) return 'away'; } catch (e) { /* a test page */ }
    var de = document.documentElement;
    if (de && de.hasAttribute && de.hasAttribute('data-hk-editing')) return 'edit';
    if (window.hkEdit && window.hkEdit.active && window.hkEdit.active()) return 'edit';
    if (window.hkEditMenu && window.hkEditMenu.on && window.hkEditMenu.on()) return 'edit';
    var M = menu(), p = null;
    try { p = M && M.panel ? M.panel() : null; } catch (e) { p = null; }
    if (p && p.lovelace && p.lovelace.editMode) return 'edit';
    if (location.hash && location.hash.length > 1) return 'popup';
    var D = window.hkDetail, ds = null;
    try { ds = D && D._ && D._.state ? D._.state() : null; } catch (e) { ds = null; }
    if (ds && ds.el && !ds.closing) return 'sheet';
    if (window.hkMenu && window.hkMenu.isOpen && window.hkMenu.isOpen()) return 'menu';
    var T = window.hkTabBar, ts = null;
    try { ts = T && T._ && T._.state ? T._.state() : null; } catch (e) { ts = null; }
    if (ts && ts.sheet) return 'more';
    var sv = window.hkSaver;
    if (window.__hkAsleep) return 'saver';
    try { if (sv && ((sv.running && sv.running()) || (sv.black && sv.black()))) return 'saver'; } catch (e) { /* none */ }
    return '';
  }
  // THE SLOW-TABLET LADDER HAS FLAGGED THIS TABLET: its last frame rate,
  // for the screen and the look it shows now, under SLOW_FPS
  function slow() {
    var F = window.hkFps, s = null;
    try { s = F && F.latest ? F.latest() : null; } catch (e) { s = null; }
    if (!s || typeof s.fps !== 'number' || !(s.fps < SLOW_FPS)) return false;
    var seg = String(location.pathname).split('/')[1] || '';
    if (s.screen && s.screen !== seg) return false;
    var HS = window.hkSettings, sig = null;
    try { sig = HS && HS.ladderSignature ? HS.ladderSignature() : null; } catch (e) { sig = null; }
    return !s.sig || !sig || s.sig === sig;
  }
  function safe() {
    var c = C();
    try { return c && c.safeArea ? c.safeArea() : { left: 0, right: 0 }; } catch (e) { return { left: 0, right: 0 }; }
  }

  // ------------------------------------------------------------ styles
  function save(el) {
    var o = {};
    PROPS.forEach(function (p) { o[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority ? el.style.getPropertyPriority(p) : '']; });
    return o;
  }
  function restore(el, o) {
    if (!el || !o) return;
    PROPS.forEach(function (p) {
      if (o[p][0]) el.style.setProperty(p, o[p][0], o[p][1]); else el.style.removeProperty(p);
    });
  }
  function setX(el, x, base) {
    el.style.setProperty('transform', 'translateX(' + (+x).toFixed(1) + 'px)' + (base && base !== 'none' ? ' ' + base : ''));
  }

  // THE PAGE SAYS touch-action pan-y while the swipe is on here: a sideways
  // drag comes to us as pointer events, an up-and-down one is the browser's
  // (a row that scrolls sideways is a scroller of its own, and keeps its pan)
  var armed = null, TOUCH = 'pan-y pinch-zoom';
  function arm() {
    var v = on() ? currentView() : null;
    if (armed && armed !== v) {
      if (armed.style.getPropertyValue('touch-action') === TOUCH) armed.style.removeProperty('touch-action');
      armed = null;
    }
    if (v && !armed) { v.style.setProperty('touch-action', TOUCH); armed = v; }
  }

  // ------------------------------------------------------------ the neighbour
  // a page the host doesn't hold: its title, on the page's own ground
  function ghost(item) {
    var c = C(), g = document.createElement('div'), h = document.createElement('div');
    g.className = 'hk-swipe-ghost';
    g.setAttribute('aria-hidden', 'true');
    g.style.cssText = 'box-sizing:border-box;' + (c && c.FONT_ROOT ? c.FONT_ROOT + ';' : '') +
      'color:' + (c && c.v ? c.v('ink') : 'rgba(255,255,255,.94)') + ';' +
      'padding:calc(var(--hk-safe-top, env(safe-area-inset-top, 0px)) + 18px) 27px 0';
    h.style.cssText = (c && c.typeCss ? c.typeCss('page-title') : 'font-size:34px;font-weight:700') +
      ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    h.textContent = item && item.title ? item.title : '';
    g.appendChild(h);
    return g;
  }
  // the page `item` beside the one shown, `dir` (1: on the right, -1: the left) a width away
  function prepare(g, dir, item) {
    var parent = g.view.parentNode;
    if (!parent) return null;
    var host = window.hkViewHost && window.hkViewHost.live ? window.hkViewHost.live() : null;
    var p = null;
    if (host && host.peek && !slow()) {
      try { p = host.peek(viewSeg(item.path)); } catch (e) { p = null; }
    }
    var N = { item: item, dir: dir, cached: !!p, el: p ? p.el : ghost(item) };
    N.saved = save(N.el);
    if (N.cached && N.el.swipeEnter) { try { N.el.swipeEnter(dir); } catch (e) { /* its own */ } }
    var r = g.rect, st = N.el.style;
    st.setProperty('position', 'fixed');
    st.setProperty('left', r.left + 'px');
    st.setProperty('top', g.top + 'px');
    st.setProperty('width', r.width + 'px');
    st.setProperty(N.cached ? 'max-height' : 'height', Math.max(0, (window.innerHeight || 0) - g.top) + 'px');
    st.setProperty('overflow', 'hidden');
    st.setProperty('pointer-events', 'none');
    st.setProperty('transition', 'none');
    st.setProperty('will-change', 'transform');
    if (g.origin) st.setProperty('transform-origin', g.origin);
    setX(N.el, dir * g.w, g.base);
    parent.appendChild(N.el);
    return N;
  }
  function drop(N) {
    if (!N) return;
    if (N.el.parentNode) N.el.parentNode.removeChild(N.el);
    if (N.cached) restore(N.el, N.saved);
  }

  // ------------------------------------------------------------ the gesture
  var G = null, L = null, eatUntil = 0;
  // why the last press was not the page's (the check reads it: hk-pageswipe state())
  var why = '';

  function onDown(e) {
    if (G && G.live) { if (e.pointerId !== G.id) settle(0, 0); return; }      // a second finger: let it go
    G = null;
    why = L ? 'landing' : (e.pointerType === 'mouse' && e.button !== 0) || e.isPrimary === false ? 'button' : blocked();
    if (why) return;
    var view = currentView();
    if (!view) { why = 'no view'; return; }
    var path = e.composedPath ? e.composedPath() : [];
    // only on the page itself
    if (path.indexOf(view) < 0) { why = 'off the page'; return; }
    var sa = safe();
    if (atEdge(e.clientX, window.innerWidth || 0, sa.left, sa.right)) { why = 'edge'; return; }
    var D = window.hkDrag;
    if (!D || !D.sideways || D.sideways(path, view)) { why = 'its own'; return; }
    var items = list(), nb = neighbours(items, location.pathname, isHere);
    if (nb.at < 0) { why = 'not in the order'; return; }
    var grid = null;
    path.forEach(function (n) {
      if (!grid && n && n.localName === 'hk-home-grid-view' && n._views && n._views() > 1) grid = n;
    });
    var t = e.timeStamp || Date.now();
    G = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, view: view, target: path[0] || null,
          items: items, at: nb.at, grid: grid, live: false, pts: [[t, e.clientX]], dx: 0, nb: {} };
  }

  function onMove(e) {
    if (!G || e.pointerId !== G.id) return;
    var dx = e.clientX - G.x0, dy = e.clientY - G.y0;
    if (!G.live) {
      // a Home Grid's views go first: it hands a swipe past its end over (hk-swipe-past)
      if (G.grid) return;
      var k = window.hkDrag.classify(dx, dy, { axis: 'x', slop: START, ratio: RATIO });
      if (k === 'press') return;
      if (k === 'scroll') { G = null; return; }
      begin(e);
    }
    G.pts.push([e.timeStamp || Date.now(), e.clientX]);
    if (G.pts.length > 30) G.pts.splice(0, G.pts.length - 30);
    follow(dx);
  }

  // THE PAGE SWIPE BEGINS: what goes back after is kept, and the card under
  // the finger lets go (as it would for a scroll)
  function begin(e) {
    var view = G.view;
    G.live = true;
    G.calm = reduced();
    G.saved = save(view);
    G.base = view.style.getPropertyValue('transform') || '';
    try { G.origin = view.style.getPropertyValue('transform-origin') || ''; } catch (x) { G.origin = ''; }
    view.style.setProperty('transition', 'none');
    // its box as laid out (a full rail scales the page aside: hk-tabbar.js aside)
    view.style.setProperty('transform', 'none');
    var r = view.getBoundingClientRect();
    if (G.base) view.style.setProperty('transform', G.base); else view.style.removeProperty('transform');
    var se = document.scrollingElement || document.documentElement, body = document.body;
    var scrolled = Math.max(window.scrollY || 0, se ? se.scrollTop : 0, body ? body.scrollTop : 0);
    G.rect = { left: r.left, width: r.width || window.innerWidth || 1 };
    G.w = G.rect.width;
    G.top = Math.max(0, Math.min((window.innerHeight || 0) / 2, r.top + scrolled));
    if (!G.calm) view.style.setProperty('will-change', 'transform');
    if (e.pointerType !== 'touch') { try { view.setPointerCapture(e.pointerId); } catch (x) { /* gone */ } }
    // (the cancel sent here is for the card, not for us)
    G.cancelling = true;
    try {
      if (G.target && typeof PointerEvent === 'function') {
        G.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, pointerType: e.pointerType,
                                                                    bubbles: true, composed: true }));
      }
    } catch (x) { /* no PointerEvent */ }
    G.cancelling = false;
  }

  function follow(dx) {
    G.dx = dx;
    if (G.calm) return;
    var dir = dx < 0 ? 1 : -1, to = G.items[G.at + dir] || null;
    var x = travel(dx, !!to);
    // the page on that side, made ready the first time the finger goes that way
    if (to && !G.nb[dir]) G.nb[dir] = prepare(G, dir, to);
    var N = G.nb[dir], O = G.nb[-dir];
    setX(G.view, x, G.base);
    if (N) setX(N.el, x + dir * G.w, G.base);
    if (O) setX(O.el, -dir * G.w, G.base);
    var T = window.hkTabBar;
    if (T && T.follow) {
      try { T.follow(to ? Math.min(1, Math.abs(dx) / G.w) : 0, (to || G.items[G.at]).path); } catch (e) { /* not drawn */ }
    }
  }

  function onUp(e) {
    if (!G || e.pointerId !== G.id || G.cancelling) return;
    if (!G.live) { G = null; return; }
    G.pts.push([e.timeStamp || Date.now(), e.clientX]);
    var dx = e.clientX - G.x0;
    settle(e.type === 'pointerup' && lands(dx, G.w, speed(G.pts)) ? dx : 0, dx);
  }

  // LET GO: lands on the page that way (`go`: the finger's dx), or goes back
  function settle(go, dx) {
    var g = G;
    G = null;
    if (!g || !g.live) return;
    eatUntil = Date.now() + EAT_MS;
    var dir = (go || dx || g.dx) < 0 ? 1 : -1, to = go ? g.items[g.at + dir] || null : null;
    var T = window.hkTabBar;
    try { if (T && T.land) T.land(to ? to.path : null); } catch (e) { /* not drawn */ }
    var N = to ? g.nb[dir] || null : null;
    if (g.calm) {
      if (to) fadeOut(g, to, dir);
      else restore(g.view, g.saved);
      return;
    }
    var tr = 'transform ' + STANDARD_MS + 'ms ' + STANDARD;
    g.view.style.setProperty('transition', tr);
    setX(g.view, to ? -dir * g.w : 0, g.base);
    Object.keys(g.nb).forEach(function (k) {
      var M = g.nb[k];
      if (!M) return;
      M.el.style.setProperty('transition', tr);
      setX(M.el, M === N ? 0 : +k * g.w, g.base);
    });
    setTimeout(function () {
      Object.keys(g.nb).forEach(function (k) { if (g.nb[k] !== N) drop(g.nb[k]); });
      if (to) commit(g, to, dir, N);
      else restore(g.view, g.saved);
    }, STANDARD_MS + 20);
  }

  // REDUCE MOTION: the page fades, the next one fades in as it lands
  function fadeOut(g, to, dir) {
    g.view.style.setProperty('transition', 'opacity ' + FADE_MS + 'ms linear');
    g.view.style.setProperty('opacity', '0');
    setTimeout(function () { commit(g, to, dir, null); }, FADE_MS);
  }

  // THE PAGE IT LANDS ON is shown by the host (its navigation): the
  // neighbour already in the slot stays there (hk-view-host.js show), a
  // page not held is built now
  function commit(g, to, dir, N) {
    var host = window.hkViewHost && window.hkViewHost.live ? window.hkViewHost.live() : null;
    var land = L = { g: g, to: to, dir: dir, N: N, offs: [] };
    var done = function (el) {
      if (L !== land) return;
      L = null;
      land.offs.forEach(function (off) { try { off(); } catch (e) { /* */ } });
      clearTimeout(land.timer);
      if (N && N.cached) restore(N.el, N.saved);
      else drop(N);
      restore(g.view, g.saved);
      if (el && el !== g.view) {
        if (!(N && N.cached) && el.swipeEnter) { try { el.swipeEnter(dir); } catch (e) { /* its own */ } }
        if (g.calm) fadeIn(el);
      }
      setTimeout(arm, 0);
    };
    if (host && host.onView) {
      land.offs.push(host.onView(function (el, view, cfg, info) { done(info && info.path === viewSeg(to.path) ? el : null); }));
    } else {
      // (a host with no view host of ours: its new view says it is in)
      var onReady = function (ev) { var v = ev && ev.detail && ev.detail.view; if (v && v !== g.view) done(v); };
      window.addEventListener('hk-view-ready', onReady);
      land.offs.push(function () { window.removeEventListener('hk-view-ready', onReady); });
    }
    land.timer = setTimeout(function () { done(null); }, LAND_WAIT);
    var S = SH();
    if (S && S.navigate) S.navigate(to.path);
    else done(null);
  }
  function fadeIn(el) {
    el.style.setProperty('opacity', '0');
    void el.offsetWidth;
    el.style.setProperty('transition', 'opacity ' + FADE_MS + 'ms linear');
    el.style.setProperty('opacity', '1');
    setTimeout(function () { el.style.removeProperty('opacity'); el.style.removeProperty('transition'); }, FADE_MS + 50);
  }

  // A HOME GRID'S SWIPE PAST ITS END (hk-layout.js): ours from here, when
  // there is a page that way
  function takes(dir, grid) {
    return !!G && !G.live && G.grid === grid && !!G.items[G.at + dir] && !blocked();
  }
  function onPast(e) {
    var d = e.detail || {};
    if (!G || G.live || d.pointerId !== G.id) return;
    G.grid = null;
    if (d.target) G.target = d.target;
    begin({ pointerId: d.pointerId, pointerType: d.pointerType || G.type });
  }

  // the tap a swipe ends with is no tap on what is under it
  function onClick(e) {
    if (Date.now() < eatUntil) { eatUntil = 0; e.stopPropagation(); e.preventDefault(); }
  }
  // the window turned or went away mid-swipe: back where it was
  function abandon() {
    if (G && G.live) settle(0, 0);
    G = null;
  }

  function start() {
    var d = document, o = { capture: true, passive: true };
    d.addEventListener('pointerdown', onDown, o);
    d.addEventListener('pointermove', onMove, o);
    d.addEventListener('pointerup', onUp, o);
    d.addEventListener('pointercancel', onUp, o);
    d.addEventListener('click', onClick, true);
    d.addEventListener('visibilitychange', abandon);
    window.addEventListener('resize', function () { abandon(); arm(); });
    window.addEventListener('hk-swipe-past', onPast);
    window.addEventListener('hk-view-ready', arm);
    var S = SH();
    if (S && S.onNavigate) S.onNavigate(function () { setTimeout(arm, 0); });
    window.addEventListener('popstate', function () { abandon(); setTimeout(arm, 0); });
    var HS = window.hkSettings;
    if (HS && HS.onChange) HS.onChange(arm);
    arm();
    setTimeout(arm, 1500);
  }

  window.hkPageSwipe = {
    version: '1.0.0',
    // the pages a swipe moves through here, in order (ctx: work it out for
    // that list instead); extend(fn) puts others in it -- fn(items, ctx)
    order: function (ctx) { return ctx ? order(ctx) : list(); },
    extend: extend,
    on: on,
    blocked: blocked,
    takes: takes,
    arm: arm,
    _: { enabled: enabled, order: order, neighbours: neighbours, atEdge: atEdge, travel: travel, lands: lands, speed: speed,
         viewSeg: viewSeg, ghost: ghost, slow: slow,
         NUMBERS: { EDGE: EDGE, START: START, RATIO: RATIO, TURN: TURN, FLICK: FLICK, FLICK_MIN: FLICK_MIN, GIVE: GIVE,
                    STANDARD_MS: STANDARD_MS, FADE_MS: FADE_MS, SLOW_FPS: SLOW_FPS },
         state: function () { return { G: G, L: L, why: why }; } }
  };
  if (typeof document !== 'undefined' && document.addEventListener) start();
  // (said once it's here: the menu offers the Pages screen's place in the
  // order then -- hk-menu.js loads before this)
  try { window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: 'hkPageSwipe' })); } catch (e) { /* no listeners */ }
})();
