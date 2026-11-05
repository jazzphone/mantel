// hk-pageswipe.js -- SWIPE BETWEEN PAGES (docs/phase11/HOMEVIEW-LOOK.md,
// Phase 0; DESIGN.md Motion, "A page swipe", 2026-10-30; rebuilt 2026-11-04
// from measurements, docs/development/Motion.md).
//
// A sideways swipe anywhere on a page takes you to the next or the previous
// page. The page follows the finger, the next one comes in beside it, and the
// tab bar's highlight slides along with it (hk-tabbar.js follow / land), so
// it is always under the page you are about to land on. The sky or the ground
// stays still behind: only the views move, by transform.
// The background of the page it heads for (Calendar's, Live TV's) fades in as
// it comes in, with the finger (skyFade); a tap on a tab still cuts to it. A
// press on the empty screen under a page shorter than it is the page's too.
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
// detail sheet, a pop-up that covers the page (an address #hash; not the
// docked bar, hkPopup.docked), the menu or the bar's More open,
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
// RATIO times the vertical (hkDrag.classify), from there, so the page doesn't
// jump by what the finger went first; it lands past TURN of the width, or on a
// flick over FLICK px/ms that way (the last 100 ms of its moves, none if it
// rested before it lifted: hkDrag.speed; a flick back goes back, however far it
// had gone); past the first and the last page it gives GIVE of the travel.
// Reduce Motion (or Flat's motion off): nothing follows the finger, the two
// pages cross-fade (`fade`, .2 s) and the highlight jumps.
//
// LET GO, IT GOES ON AT THE FINGER'S SPEED: a critically damped spring from
// where the page is, at the speed it was going (spring(): stiffer for a flick
// that would otherwise overshoot; no bounce), run by the browser's compositor
// as a transition, so a busy page doesn't stop it. A finger that comes down on
// a page still settling catches it where it is (catchIt): nothing queued can
// overwrite what the finger does next, because only one of G (a finger), A (a
// settle) and L (a page being built) is ever moving the page.
//
// THE NEIGHBORS ARE THE REAL PAGES, READY BEFORE THE FINGER COMES (2026-11-04,
// the owner: "fail to display content"; measured, every swipe to a page not yet
// visited, and every swipe on a tablet the slow-tablet ladder had flagged, showed
// a title on the sky): at a quiet moment after landing (plan()) the host makes
// the page on either side (hkViewHost warm / hold) and it waits in the slot,
// fixed beside the page, a width away, inert, off stage. Nothing is mounted or
// measured under the finger: at most two more pages in the document, whose
// cards the host keeps nearly current (feedHeld); landing moves nothing, the
// page it left is already its neighbor. Only for a page not ready yet (the
// first moment after a load, a host with no view host) does ghost() stand in:
// its title, on the page's ground, replaced in place when the real one is.
// Beside the page a neighbor wears `hk-swipe-peek` (its pop-ups wait for it to
// land, hk-popup.js), and `hk-swipe-landed` says when it has.
//
// FOLLOWED BY POINTER EVENTS, captured only for a mouse (a touch is the
// target's own until it ends: WebKit kept a captured touch, hk-menu.js -- and
// heard on that element too, should a card draw it away mid-swipe); the
// page says touch-action pan-y while the swipe is on here, so a sideways drag
// comes here and an up-and-down one stays the browser's scroll.
(function () {
  'use strict';
  if (window.hkPageSwipe) return;

  var EDGE = 24, START = 10, RATIO = 1.4, TURN = 0.2, FLICK = 0.5, FLICK_MIN = 30, GIVE = 1 / 3;
  var EAT_MS = 350, LAND_WAIT = 5000, SLOW_FPS = 45, REST = 60;
  // a settle ended by its timer, if the browser says nothing, this long after
  var SETTLE_SPARE = 250;
  // a finger that comes down on a page more than ADVANCE of the way home: the landing is done with, it holds the new page
  var ADVANCE = 0.5;
  // px a finger goes sideways before what may move gets its layer
  var HEAT = 3;
  var STANDARD = 'cubic-bezier(.32,.72,0,1)', STANDARD_MS = 340, FADE_MS = 200;
  // px past the window's edge (and a tenth of its width more) a page waiting beside this one sits at rest (park)
  var PARK_GAP = 48;
  // the props a swipe sets on a view, given back as they were
  var PROPS = ['transform', 'transition', 'transform-origin', 'position', 'left', 'top', 'width', 'height', 'max-height',
               'overflow', 'will-change', 'pointer-events', 'opacity', '--hk-ground-hide'];

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
  function neighbors(items, path, isHere) {
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
  // does it land, how fast did it go, and where does it go from there: the one set of rules (hk-drag.js)
  function D() { return window.hkDrag; }
  function lands(dx, width, v) { return D().lands(dx, width, v, { turn: TURN, flick: FLICK, min: FLICK_MIN }); }
  function speed(pts, up) { return D().speed(pts, up); }
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
  function viewSlot() {
    var S = SH(), M = menu();
    if (!S || !S.viewSlot) return null;
    try { return S.viewSlot(M && M.panel ? M.panel() : null) || null; } catch (e) { return null; }
  }
  function currentView() {
    var S = SH(), slot = viewSlot();
    if (!slot || !S.view) return null;
    try { return S.view(slot) || null; } catch (e) { return null; }
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
    // (a pop-up that covers the page; the docked bar -- Now Playing, the timers -- covers nothing, and the page swipes
    // on under it: 2026-11-02, the owner, the bar up on the Calendar and every swipe refused, turning its months)
    var PU = window.hkPopup;
    if (location.hash && location.hash.length > 1 && !(PU && typeof PU.docked === 'function' && PU.docked(location.hash))) return 'popup';
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
  // for the screen and the look it shows now, under SLOW_FPS. (It once got a
  // title on the sky for every page, which is what a slow tablet's owner saw of
  // every swipe, 2026-11-04. It gets the real pages, as every tablet does: a
  // rest sample says nothing of what a swipe can draw. Kept for the checks and
  // for what a flagged tablet may want to leave out next.)
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
  // where it is drawn right now, mid-transition too
  function drawnX(el, fallback) {
    try {
      var t = getComputedStyle(el).transform;
      if (!t || t === 'none') return fallback;
      var m = /matrix\(([^)]+)\)/.exec(t);
      return m ? parseFloat(m[1].split(',')[4]) || 0 : fallback;
    } catch (e) { return fallback; }
  }
  function offAttrs(el) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
  function onAttrs(el) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
  function later(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn); else fn();
  }
  // THE PAGE SAYS touch-action pan-y while the swipe is on here: a sideways
  // drag comes to us as pointer events, an up-and-down one is the browser's
  // (a row that scrolls sideways is a scroller of its own, and keeps its pan)
  // (and its slot: the empty screen under a page shorter than it, below)
  var armed = null, armedSlot = null, TOUCH = 'pan-y pinch-zoom';
  function untouch(el) { if (el && el.style.getPropertyValue('touch-action') === TOUCH) el.style.removeProperty('touch-action'); }
  function arm() {
    var v = on() ? pageNow() : null, slot = v ? viewSlot() : null;
    if (armed && armed !== v) { untouch(armed); armed = null; }
    if (armedSlot && armedSlot !== slot) { untouch(armedSlot); armedSlot = null; }
    if (v && !armed) { v.style.setProperty('touch-action', TOUCH); armed = v; }
    if (slot && !armedSlot && !slot.style.getPropertyValue('touch-action')) { slot.style.setProperty('touch-action', TOUCH); armedSlot = slot; }
  }

  // ------------------------------------------------------------ the stage
  // ST: the page at rest or moving (`view`), where it is drawn (`x`), its box (`rect`, `top`), what it wore (`saved`) and
  // what waits beside it (`nb`: 1 on the right, -1 on the left: { item, dir, real, el, saved, off, ground }). Only one of
  // G (a finger), A (a settle) and L (building the page it lands on) moves it at a time.
  var ST = null, G = null, A = null, L = null, eatUntil = 0;
  // why the last press was not the page's (the check reads it: hk-pageswipe state())
  var why = '';

  function host() { return window.hkViewHost && window.hkViewHost.live ? window.hkViewHost.live() : null; }
  function pageNow() {
    if (ST && ST.view.isConnected) return ST.view;
    return currentView();
  }
  function stageFor(view) {
    if (ST && ST.view === view) return ST;
    if (ST) retire(ST);
    ST = { view: view, nb: {}, x: 0, rect: null, top: 0, base: '', origin: '', saved: null, spare: [], here: null };
    watchSize(view);
    return ST;
  }
  // THE PAGE'S BOX CHANGING AT REST (the Side Pane going as the Pages screen comes up, the window): what waits beside it
  // is laid out at its new place now, not under the next finger. Measured once on a tap to the Pages screen, before the
  // pane had gone, the Calendar waited at Home's narrower width, and drew itself again for its own only after it had
  // landed: a jump half a second in (2026-11-05, the owner's video)
  var sizeRo = null;
  function watchSize(view) {
    if (typeof ResizeObserver !== 'function') return;
    if (!sizeRo) sizeRo = new ResizeObserver(function () { if (ST && ST.rect && !G && !A && !L) measure(ST); });
    sizeRo.disconnect();
    if (view) sizeRo.observe(view);
  }
  // its box as laid out (a full rail scales the page aside: hk-tabbar.js aside): read at a press, when nothing is waiting
  // to be laid out, so the first frame of a swipe measures nothing
  function measure(st) {
    var view = st.view, base = view.style.getPropertyValue('transform') || '';
    st.base = base;
    try { st.origin = view.style.getPropertyValue('transform-origin') || ''; } catch (x) { st.origin = ''; }
    if (base) view.style.setProperty('transform', 'none');
    var r = view.getBoundingClientRect();
    if (base) view.style.setProperty('transform', base);
    var se = document.scrollingElement || document.documentElement, body = document.body;
    var scrolled = Math.max(window.scrollY || 0, se ? se.scrollTop : 0, body ? body.scrollTop : 0);
    var left = r.left, width = r.width || window.innerWidth || 1;
    var top = Math.max(0, Math.min((window.innerHeight || 0) / 2, r.top + scrolled));
    var same = st.rect && st.rect.left === left && st.rect.width === width && st.top === top && st.placedBase === base;
    st.placedBase = base;
    st.rect = { left: left, width: width };
    st.top = top;
    if (!same) Object.keys(st.nb).forEach(function (k) { if (st.nb[k]) place(st, st.nb[k]); });
    return st;
  }

  // ------------------------------------------------------------ the neighbor
  // a page the host hasn't got ready: its title, on the page's own ground
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
  // laid out at the room it will have (the Side Pane coming or going: hkSidePane.room), its edge against this one's,
  // fixed to the screen a width away
  function place(st, N) {
    var r = st.rect, s = N.el.style, P = window.hkSidePane, room = P && P.room ? P.room(N.item.path) : null;
    var left = r.left, width = r.width;
    if (room) { width += room.grow; if (room.side === 'left') left -= room.grow; }
    N.off = N.dir > 0 ? r.left + r.width - left : r.left - left - width;
    N.left = left;
    N.width = width;
    s.setProperty('position', 'fixed');
    s.setProperty('left', left + 'px');
    s.setProperty('top', st.top + 'px');
    s.setProperty('width', width + 'px');
    s.setProperty(N.real ? 'max-height' : 'height', Math.max(0, (window.innerHeight || 0) - st.top) + 'px');
    s.setProperty('overflow', 'hidden');
    s.setProperty('pointer-events', 'none');
    s.setProperty('transition', 'none');
    if (st.origin) s.setProperty('transform-origin', st.origin);
    if (G && G.stage === st) setX(N.el, N.off + xOfNeighbor(st, N), st.base);
    else rest(st, N);
  }
  function xOfNeighbor(st, N) { return N.dir === (st.x < 0 ? 1 : -1) ? st.x : 0; }
  // AT REST, PAST THE WINDOW'S EDGE (2026-11-05, the owner: the Pages screen showed through Home's Side Pane, and the
  // Calendar sat over the right of the Pages screen): a page's width away from a page narrower than the window (the Side
  // Pane beside it) is still on the screen. While nothing moves, what waits beside the page waits out of sight; a
  // finger's first move brings it to the page's edge (follow), as a settle takes it back there (run)
  function park(N) {
    var W = window.innerWidth || 0, gap = PARK_GAP + W / 10, l = (N.left || 0) + (N.off || 0);
    return N.dir > 0 ? Math.max(0, W + gap - l) : Math.min(0, -gap - (l + (N.width || 0)));
  }
  function rest(st, N) { setX(N.el, (N.off || 0) + park(N), st.base); }

  // ITS OWN LOOK beside the page (hkSettings.lookAt): the Calendar waiting beside the Pages screen wears Blur where the
  // Pages screen is Bright Glass (Home Only), so it lands looking as it will stay. Every page in the slot wears its
  // own, the page shown none (the root's is its own): again as each lands and as the look changes (hk-look)
  function wearLook(el, path) {
    if (!el || !el.style) return;
    var S = window.hkSettings, l = null;
    try { l = path && S && S.lookAt ? S.lookAt(path) : null; } catch (e) { l = null; }
    var had = el.__hkLook || [], keys = l ? Object.keys(l.vars) : [];
    had.forEach(function (k) { if (keys.indexOf(k) < 0) el.style.removeProperty(k); });
    keys.forEach(function (k) { if (el.style.getPropertyValue(k) !== l.vars[k]) el.style.setProperty(k, l.vars[k]); });
    el.__hkLook = keys;
  }
  function relook(st) {
    if (!st) return;
    var here = st.items && st.items[st.at];
    wearLook(st.view, here ? here.path : null);
    Object.keys(st.nb).forEach(function (k) { var N = st.nb[k]; if (N && N.real) wearLook(N.el, N.item.path); });
  }
  // a real page, made ready (the host's own element) or a stand-in, into the slot
  function adopt(st, dir, item, p) {
    var parent = st.view.parentNode;
    if (!parent) return null;
    // (one let go a moment ago and not yet out: it is still in its place, and still knows what it wore)
    var kept = p ? (st.spare || []).filter(function (o) { return o.el === p.el; })[0] : null;
    if (kept) {
      st.spare.splice(st.spare.indexOf(kept), 1);
      kept.item = item;
      kept.dir = dir;
      st.nb[dir] = kept;
      if (kept.el.swipeEnter) { try { kept.el.swipeEnter(dir); } catch (e) { /* its own */ } }
      place(st, kept);
      if (kept.real) wearLook(kept.el, item.path);
      return kept;
    }
    var N = { item: item, dir: dir, real: !!p, el: p ? p.el : ghost(item), ground: null };
    N.saved = save(N.el);
    // (beside the page, not it: its pop-ups wait for it to land -- hk-popup.js peeking)
    N.el.setAttribute('hk-swipe-peek', '');
    if (N.real) {
      var H = host();
      if (H && H.hold) H.hold(N.el, true);
      offAttrs(N.el);
      if (N.el.swipeEnter) { try { N.el.swipeEnter(dir); } catch (e) { /* its own */ } }
    }
    st.nb[dir] = N;
    place(st, N);
    if (N.real) wearLook(N.el, item.path);
    if (N.el.parentNode !== parent) parent.appendChild(N.el);
    return N;
  }
  function drop(N) {
    if (!N) return;
    N.el.removeAttribute('hk-swipe-peek');
    unground(N.ground);
    N.ground = null;
    if (N.real) {
      onAttrs(N.el);
      wearLook(N.el, null);
      restore(N.el, N.saved);
      var H = host();
      if (!(H && H.hold && H.hold(N.el, false)) && N.el.parentNode) N.el.parentNode.removeChild(N.el);
    } else if (N.el.parentNode) N.el.parentNode.removeChild(N.el);
  }
  function retire(st) {
    Object.keys(st.nb).forEach(function (k) { drop(st.nb[k]); });
    st.nb = {};
    (st.spare || []).forEach(drop);
    st.spare = [];
  }
  // THE PAGE ON THAT SIDE, for a finger already going that way and nothing ready: the host's own if it holds it (attached
  // now, as there is nothing else to show), else the stand-in, and the real one is asked for
  function needNeighbor(st, dir, item) {
    var H = host(), seg = viewSeg(item.path), p = null;
    if (H && H.peek) { try { p = H.peek(seg); } catch (e) { p = null; } }
    var N = adopt(st, dir, item, p);
    if (N && !N.real) makeReady(st, dir, item);
    return N;
  }

  // ------------------------------------------------------------ made ready ahead
  // AT A QUIET MOMENT (planSoon): the page on either side of this one, built by the host and kept in the slot; one a
  // moment; what no longer belongs here let go. Nothing here runs while a finger is on the page or it is moving.
  var planT = 0, planGen = 0, making = {};
  function planSoon(ms) {
    if (planT) return;
    planT = setTimeout(function () {
      var go = function () { planT = 0; plan(); };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 500 }); else go();
    }, ms === undefined ? 60 : ms);
  }
  function asleep() {
    try { if (document.visibilityState === 'hidden') return true; } catch (e) { /* none */ }
    return !!window.__hkAsleep;
  }
  function plan() {
    listenHost();
    var H = host();
    var wait = blocked();
    if (wait === 'off' || wait === 'away' || wait === 'edit') { if (ST && !G && !A && !L) { retire(ST); ST = null; } return; }
    if (wait === 'saver' || asleep()) return;        // (hk-asleep, a page coming back: asked again)
    if (G || A || L || wait) { planSoon(wait ? 1000 : 250); return; }
    var view = currentView();
    if (!view || !H || !H.warm) return;
    // (a host whose navigation takes a moment: not there yet)
    if (ST && ST.view !== view && ST.arrived && now() - ST.arrived < 1000) { planSoon(200); return; }
    var st = stageFor(view), items = list(), nb = neighbors(items, location.pathname, isHere);
    st.items = items;
    st.at = nb.at;
    if (nb.at < 0) { retire(st); return; }
    measure(st);
    [[1, nb.next], [-1, nb.prev]].forEach(function (pair) {
      var dir = pair[0], item = pair[1], N = st.nb[dir];
      if (N && (!item || N.item.path !== item.path)) { drop(N); delete st.nb[dir]; N = null; }
      if (N && N.real) groundKnown(N.el, true);
      if (!item || N) return;
      // (one let go a moment ago, wanted again: it never left its place)
      var o = (st.spare || []).filter(function (q) { return q.item.path === item.path; })[0];
      if (o) { adopt(st, dir, item, { el: o.el }); return; }
      makeReady(st, dir, item);
    });
    (st.spare || []).forEach(drop);
    st.spare = [];
    groundKnown(st.view, true);
    relook(st);
  }
  function makeReady(st, dir, item) {
    var H = host(), key = item.path;
    if (!H || !H.warm || making[key]) return;
    making[key] = 1;
    var gen = planGen;
    H.warm(viewSeg(item.path)).then(function (p) {
      delete making[key];
      // (made for a page since left: the page now may want it, or the one on its way)
      if (p && (gen !== planGen || ST !== st)) { planSoon(); return; }
      if (gen !== planGen || ST !== st || !p || !st.view.isConnected) return;
      var N = st.nb[dir];
      if (N && (N.real || N.item.path !== item.path)) return;
      // a settle running to the stand-in goes on with it: the page it lands on is ready for then
      if (N && A && A.st === st) return;
      if (N) drop(N);
      delete st.nb[dir];
      var R = adopt(st, dir, item, p);
      groundKnown(p.el);
      if (R && G && G.stage === st && G.live) {
        R.el.style.setProperty('will-change', 'transform');
        R.ground = ground(st, R.el, 0);
        setX(R.el, R.off + xOfNeighbor(st, R), st.base);
      }
    }, function (e) {
      delete making[key];
      try { console.error('[hk-pageswipe] a page could not be made ready', e); } catch (x) { /* no console */ }
    });
  }
  // the page's own glass while it moves: nothing to make ready here but the walk (groundOf) for the first frame not to
  // (at a quiet moment, again: its card may not have been drawn the last time)
  function groundKnown(el, again) { if (el && (again || el.__hkGroundOf === undefined)) el.__hkGroundOf = groundOf(el); }

  // ------------------------------------------------------------ a page's ground
  // A PAGE WITH A GROUND OF ITS OWN (the Pages screen's blurred sky, hk-pages-screen.js swipeGround) draws it fixed to
  // the window -- and a page moving by transform takes its fixed things with it: the blur rode along, a plate with an
  // edge (2026-11-01, the owner: "the blur going from the Apps Page back to the HomeView seems to follow"). While a
  // swipe moves the page, its own is hidden (--hk-ground-hide) and a still layer behind the pages wears it, as
  // strong as the page is on the screen.
  function groundOf(el) {
    var q = [el], i = 0;
    while (i < q.length && i < 4000) {
      var n = q[i++];
      if (typeof n.swipeGround === 'function') { try { return n.swipeGround() || null; } catch (e) { return null; } }
      if (n.shadowRoot) q.push(n.shadowRoot);
      for (var c = n.firstElementChild; c; c = c.nextElementSibling) q.push(c);
    }
    return null;
  }
  function ground(st, el, k) {
    groundKnown(el);
    var f = el.__hkGroundOf, parent = st.view.parentNode;
    if (!f || !parent) return null;
    var d = document.createElement('div');
    d.className = 'hk-swipe-ground';
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:' + (k || 0) + ';-webkit-backdrop-filter:' + f + ';backdrop-filter:' + f;
    parent.insertBefore(d, st.view);
    el.style.setProperty('--hk-ground-hide', '1');
    d._of = el;
    return d;
  }
  function shade(d, k, ms) {
    if (!d) return;
    d.style.transition = ms ? 'opacity ' + ms + 'ms ' + STANDARD : 'none';
    d.style.opacity = String(+k.toFixed(3));
  }
  function unground(d) {
    if (!d) return;
    if (d._of) d._of.style.removeProperty('--hk-ground-hide');
    if (d.parentNode) d.parentNode.removeChild(d);
  }

  // ------------------------------------------------------------ the gesture
  // A FINGER STARTING SIDEWAYS: the page and what is beside it each get their own layer, a moment before the swipe begins, so
  // its first frame has only to move them. Not at the press itself: in WebKit that held every tap up by 50-90 ms
  // (measured 2026-11-04). A press that turns out to be something else gives them back.
  function heat(st) {
    if (st.hot) return;
    st.hot = true;
    if (!st.saved) st.saved = save(st.view);
    st.view.style.setProperty('will-change', 'transform');
    Object.keys(st.nb).forEach(function (k) { if (st.nb[k]) st.nb[k].el.style.setProperty('will-change', 'transform'); });
  }
  function cool(st) {
    st.hot = false;
    if (st.saved) { restore(st.view, st.saved); st.saved = null; }
    Object.keys(st.nb).forEach(function (k) {
      var N = st.nb[k];
      if (!N) return;
      N.el.style.removeProperty('will-change');
      unground(N.ground);
      N.ground = null;
    });
    unground(st.here);
    st.here = null;
    st.x = 0;
    var H = host();
    if (H && H.busy) H.busy(false);
  }

  // THE FINGER'S OWN ELEMENT, DRAWN AWAY: a card that draws itself again under a finger (the Calendar, as the Now
  // Playing bar rose and the page made room) takes the touch's target out of the page -- and a finger's events go on
  // to that element, out of the document, never reaching ours: the swipe was lost (2026-11-02, the first swipe on the
  // Calendar, in WebKit). So they are heard on it too, and taken from there once it is gone
  var heldTarget = null;
  function onLost(e) {
    if (!G || e.pointerId !== G.id || (e.target && e.target.isConnected !== false)) return;
    if (e.type === 'pointermove') onMove(e); else onUp(e);
  }
  function holdTarget(t) {
    if (heldTarget === t) return;
    if (heldTarget) ['pointermove', 'pointerup', 'pointercancel'].forEach(function (k) { heldTarget.removeEventListener(k, onLost); });
    heldTarget = t && typeof t.addEventListener === 'function' ? t : null;
    if (heldTarget) ['pointermove', 'pointerup', 'pointercancel'].forEach(function (k) { heldTarget.addEventListener(k, onLost); });
  }

  function onDown(e) {
    if (G && G.live) { if (e.pointerId !== G.id) settle(null, G.stage.x, 0); return; }      // a second finger: let it go
    if (A) {
      why = 'landing';
      if (!A.calm && (e.pointerType !== 'mouse' || e.button === 0) && e.isPrimary !== false) catchIt(e);
      return;
    }
    if (G && G.stage && G.stage.hot) cool(G.stage);
    G = null;
    holdTarget(null);
    why = L ? 'landing' : (e.pointerType === 'mouse' && e.button !== 0) || e.isPrimary === false ? 'button' : blocked();
    if (why) return;
    var view = pageNow();
    if (!view) { why = 'no view'; return; }
    var path = e.composedPath ? e.composedPath() : [];
    // only on the page itself -- or the empty screen under a page shorter than it (2026-11-01, the owner: "I get stuck
    // on the Live TV page ... it isn't letting me swipe": its channels end a third of the way down, and below them is
    // the view's slot, not the page)
    var slot = viewSlot(), under = !!slot && path[0] === slot;
    if (path.indexOf(view) < 0 && !under) { why = 'off the page'; return; }
    var sa = safe();
    if (atEdge(e.clientX, window.innerWidth || 0, sa.left, sa.right)) { why = 'edge'; return; }
    var drag = D();
    if (!drag || !drag.sideways || drag.sideways(path, under ? slot : view)) { why = 'its own'; return; }
    var items = list(), nb = neighbors(items, location.pathname, isHere);
    if (nb.at < 0) { why = 'not in the order'; return; }
    var grid = null;
    path.forEach(function (n) {
      if (!grid && n && n.localName === 'hk-home-grid-view' && n._views && n._views() > 1) grid = n;
    });
    var t = e.timeStamp || Date.now(), st = stageFor(view);
    st.items = items;
    st.at = nb.at;
    G = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, stage: st, target: path[0] || null,
          grid: grid, live: false, calm: reduced(), pts: [[t, e.clientX]], dx: 0 };
    if (e.pointerType !== 'mouse') holdTarget(path[0]);
    measure(st);
  }

  function onMove(e) {
    if (!G || e.pointerId !== G.id) return;
    var dx = e.clientX - G.x0, dy = e.clientY - G.y0;
    if (!G.live) {
      // a Home Grid's views go first: it hands a swipe past its end over (hk-swipe-past)
      if (G.grid) return;
      if (!G.calm && !G.stage.hot && Math.abs(dx) >= HEAT && Math.abs(dx) > Math.abs(dy)) heat(G.stage);
      var k = window.hkDrag.classify(dx, dy, { axis: 'x', slop: START, ratio: RATIO });
      if (k === 'press') return;
      if (k === 'scroll') { letGo(); return; }
      begin(e, dx);
    }
    // (each move the tablet coalesced into this one: the flick's speed from all of them)
    var all = null;
    try { all = e.getCoalescedEvents ? e.getCoalescedEvents() : null; } catch (x) { all = null; }
    (all && all.length ? all : [e]).forEach(function (m) { G.pts.push([m.timeStamp || e.timeStamp || Date.now(), m.clientX]); });
    if (G.pts.length > 40) G.pts.splice(0, G.pts.length - 40);
    follow(e.clientX);
  }
  function letGo() {
    if (G && G.stage && G.stage.hot) cool(G.stage);
    G = null;
    holdTarget(null);
  }

  // THE PAGE SWIPE BEGINS: the finger is START px away by now, and the page starts from here rather than jumping that
  // far; the card under the finger lets go (as it would for a scroll)
  function begin(e, dx) {
    G.live = true;
    G.x0 += Math.max(-START, Math.min(START, dx || 0));
    var st = G.stage, view = st.view;
    if (!G.calm) heat(st);
    var H = host();
    if (H && H.busy) H.busy(true);
    if (!G.calm) {
      view.style.setProperty('transition', 'none');
      st.here = ground(st, view, 1);
      Object.keys(st.nb).forEach(function (k) {
        var N = st.nb[k];
        if (N && !N.ground) N.ground = ground(st, N.el, 0);
      });
    }
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

  // THE FINGER AT clientX: the page there, and the page beside it, now; nothing is read. What goes with them -- the
  // highlight, the Side Pane, a ground's strength -- once a frame, with where the finger is by then.
  function follow(clientX) {
    var st = G.stage, dx = clientX - G.x0 + (G.from || 0);
    G.dx = dx;
    if (G.calm) return;
    var dir = dx < 0 ? 1 : -1, to = st.items[st.at + dir] || null;
    var x = travel(dx, !!to);
    if (Math.abs(x) > st.rect.width) x = (x < 0 ? -1 : 1) * (st.rect.width + (Math.abs(x) - st.rect.width) * GIVE);
    st.x = x;
    // the page on that side, made ready the first time the finger goes that way, if it isn't yet
    if (to && !st.nb[dir]) {
      var M = needNeighbor(st, dir, to);
      if (M) { M.el.style.setProperty('will-change', 'transform'); M.ground = ground(st, M.el, 0); }
    }
    var N = st.nb[dir], O = st.nb[-dir];
    setX(st.view, x, st.base);
    if (N) setX(N.el, x + N.off, st.base);
    if (O) setX(O.el, O.off, st.base);
    if (!G.frame) {
      var g = G;
      g.frame = true;
      later(function () { g.frame = false; if (G === g) companions(g); });
    }
  }
  function companions(g) {
    var st = g.stage, dir = st.x < 0 ? 1 : -1, to = st.items[st.at + dir] || null, N = st.nb[dir], O = st.nb[-dir];
    var T = window.hkTabBar, P = window.hkSidePane, f = to ? Math.min(1, Math.abs(st.x) / st.rect.width) : 0, at = (to || st.items[st.at]).path;
    shade(st.here, 1 - f);
    if (N) shade(N.ground, f);
    if (O) shade(O.ground, 0);
    skyHold(g, to, f);
    if (T && T.follow) {
      try { T.follow(f, at); } catch (e) { /* not drawn */ }
    }
    // (the Side Pane and the bar's place with the finger too, where the pane shows on one page and not the other)
    if (P && P.follow) P.follow(f, at);
  }

  // THE BACKGROUND WITH THE FINGER (skyFade; 2026-11-05, the owner: swiping to the Calendar, its background
  // switched as it landed -- the fade began only as the finger let go, and a page let go nearly in had little of its
  // settle left to fade in): the page it heads for has its own painted under a still copy of this one, a couple of
  // frames after it starts that way (the paint doesn't hold up the frame that starts the swipe), and the copy is as faint
  // as that page is far in. Turning to the other page: this one's comes back first. Let go: run takes it the rest of the way
  function skyHold(g, to, f) {
    var K = window.hkSky, want = to ? to.path : null;
    if (g.sky && !g.sky.alive()) { g.sky = null; g.skyAsk = null; }
    if (g.sky && g.sky.path !== want) { dropSky(g); g.skyAsk = null; }
    if (g.sky) { g.sky.set(f); return; }
    if (!want || !K || !K.swipeCover || g.skyAsk === want) return;
    g.skyAsk = want;
    later(function () {
      later(function () {
        if (G !== g || g.skyAsk !== want || g.sky) return;
        var st = g.stage, now = st.items[st.at + (st.x < 0 ? 1 : -1)];
        if (!now || now.path !== want) { g.skyAsk = null; return; }
        g.sky = skyFade(want);
        if (g.sky) g.sky.set(Math.min(1, Math.abs(st.x) / st.rect.width));
      });
    });
  }
  // A BACKGROUND ON ITS WAY (hk-sky.js swipeCover): that page's painted under a still copy of this one, and the copy as
  // faint as set(k) says (0..1, how far that page is in). done(land, ms, ease): it fades out on that curve (landing), or
  // back in, this page's own painted again under it (swipeBack), and goes. A finger catching it: set() holds it where
  // it is. Null where there is nothing to fade (no sky, Reduce Motion); one that does nothing for the same background.
  function skyFade(path) {
    var K = window.hkSky, cover = null;
    try { cover = K && K.swipeCover ? K.swipeCover(path) : null; } catch (e) { cover = null; }
    var live = true, an = null, timer = 0, gen = 0;
    var h = { path: path, alive: function () { return live; }, set: function () {}, done: function () { live = false; } };
    if (cover === false) return h;
    if (!cover) return null;
    cover.style.setProperty('will-change', 'opacity');
    var drawn = function () { var o = parseFloat(getComputedStyle(cover).opacity); return isFinite(o) ? o : 1; };
    var stop = function () {
      gen++;
      clearTimeout(timer);
      if (!an) return;
      var o = drawn();
      try { an.cancel(); } catch (e) { /* done */ }
      an = null;
      cover.style.opacity = String(o);
    };
    var end = function (land) {
      live = false;
      if (!land && K.swipeBack) { try { K.swipeBack(); } catch (e) { /* no sky */ } }
      if (cover.parentNode) cover.parentNode.removeChild(cover);
    };
    h.set = function (k) {
      if (!live) return;
      stop();
      cover.style.opacity = String(+(1 - Math.max(0, Math.min(1, +k || 0))).toFixed(3));
    };
    h.done = function (land, ms, ease) {
      if (!live) return;
      stop();
      var from = drawn(), to = land ? 0 : 1, my = gen;
      var once = function () { if (gen === my && live) end(land); };
      if (!ms || Math.abs(from - to) < 0.01) { cover.style.opacity = String(to); end(land); return; }
      var frames = [{ opacity: from }, { opacity: to }];
      try { an = cover.animate(frames, { duration: ms, easing: ease || STANDARD, fill: 'forwards' }); }
      catch (e) { try { an = cover.animate(frames, { duration: ms, easing: STANDARD, fill: 'forwards' }); } catch (x) { end(land); return; } }
      an.onfinish = once;
      timer = setTimeout(once, ms + 500);
    };
    return h;
  }
  function dropSky(g) {
    if (!g || !g.sky) return;
    var s = g.sky;
    g.sky = null;
    try { s.done(false, 0); } catch (e) { /* no sky */ }
  }

  function onUp(e) {
    if (!G || e.pointerId !== G.id || G.cancelling) return;
    if (!G.live) { letGo(); return; }
    // (the lift a sample only where it moved past the last move)
    var t = e.timeStamp || Date.now(), lastPt = G.pts[G.pts.length - 1];
    if (!lastPt || e.clientX !== lastPt[1]) G.pts.push([t, e.clientX]);
    var st = G.stage, dx = e.clientX - G.x0 + (G.from || 0), v = speed(G.pts, t);
    var raw = G.calm ? dx : st.x;
    // A FINGER THAT CAUGHT A SETTLE AND LET GO WITHOUT GOING ANYWHERE, or the browser took it: on to where it was going
    if (G.caught && (e.type !== 'pointerup' || Math.abs(e.clientX - G.x0) < 3)) {
      eatUntil = Date.now() + EAT_MS;
      settle(G.caught.to, st.x, 0);
      return;
    }
    var dir = raw < 0 ? 1 : -1, to = st.items[st.at + dir] || null;
    var goes = e.type === 'pointerup' && !!to && lands(raw, st.rect.width, v);
    settle(goes ? to : null, raw, to ? v : v * GIVE);
  }

  // LET GO: to the page `to`, or back. From where it is, at the speed it was going (v, px/ms).
  function settle(to, x, v) {
    var g = G, st = g ? g.stage : ST, sky = g ? g.sky : null;
    if (g) g.sky = null;
    G = null;
    holdTarget(null);
    if (!st) { if (sky) sky.done(false, 0); return; }
    var H = host();
    if (H && H.busy) H.busy(false);
    eatUntil = Date.now() + EAT_MS;
    x = x || 0;
    var dir = to ? (st.items[st.at + 1] === to ? 1 : -1) : x < 0 ? 1 : -1, N = to ? st.nb[dir] || null : null;
    var T = window.hkTabBar, P = window.hkSidePane;
    try { if (T && T.land) T.land(to ? to.path : null); } catch (e) { /* not drawn */ }
    if (P && P.land) P.land(to ? to.path : null);
    if (g && g.calm) {
      if (sky) sky.done(false, 0);
      if (to) crossfade(st, to, dir, N);
      else { backHome(st); }
      return;
    }
    if (to && !N) N = needNeighbor(st, dir, to);
    run(st, to, dir, N, x, v, sky);
  }
  // the transitions of a settle: the page and what is beside it, the same curve; what it wore comes back when it ends.
  // `sky`: the background the finger was bringing in (skyHold), the rest of the way with the page, on its curve
  function run(st, to, dir, N, x, v, sky) {
    var target = to ? -dir * st.rect.width : 0;
    var c = D().curve(x, target, v), s = c.spring, ms = c.ms;
    var tr = 'transform ' + ms + 'ms ' + c.ease;
    var moved = [st.view], side = x < 0 ? 1 : -1;
    // (where each is now is what it moves from, not the last frame's)
    setX(st.view, x, st.base);
    Object.keys(st.nb).forEach(function (k) {
      var M = st.nb[k];
      if (M) { setX(M.el, M.off + (M.dir === side ? x : 0), st.base); moved.push(M.el); }
    });
    if (typeof getComputedStyle === 'function') { try { void getComputedStyle(st.view).transform; } catch (e) { /* a test page */ } }
    st.x = target;
    moved.forEach(function (el) { el.style.setProperty('transition', tr); });
    setX(st.view, target, st.base);
    shade(st.here, to ? 0 : 1, ms);
    Object.keys(st.nb).forEach(function (k) {
      var M = st.nb[k];
      if (!M) return;
      setX(M.el, M === N ? 0 : M.off, st.base);
      shade(M.ground, M === N ? 1 : 0, ms);
    });
    var a = A = { st: st, to: to, dir: dir, N: N, spring: s, ms: ms, t0: now(), timer: 0, off: null, sky: null };
    if (sky && !sky.alive()) sky = null;
    var there = !!sky && !!to && to.path === sky.path;
    if (sky) {
      a.sky = sky;
      sky.done(there, ms, c.ease);
      st.skyAt = there ? to.path : null;
    }
    var end = function (ev) {
      if (ev && (ev.target !== st.view || ev.propertyName !== 'transform')) return;
      finish(a);
    };
    st.view.addEventListener('transitionend', end);
    a.off = function () { st.view.removeEventListener('transitionend', end); clearTimeout(a.timer); };
    a.timer = setTimeout(function () { finish(a); }, ms + SETTLE_SPARE);
    if (!ms || Math.abs(x - target) < 0.5) { finish(a); return; }
    // (no finger brought it -- a catch, a settle back: the page's background fades to the one it lands on, with it, once
    // the settle is under way, so what the sky paints doesn't hold up its first frame; and back again if it went there)
    if (!there) skyTo(a, st, to);
  }
  function skyTo(a, st, to) {
    var want = to ? to.path : st.skyAt ? location.pathname : null;
    if (!want || want === st.skyAt) return;
    later(function () {
      later(function () {
        if (A !== a) return;
        st.skyAt = to ? to.path : null;
        var f = skyFade(want);
        if (f) f.done(true, Math.min(a.ms, STANDARD_MS), STANDARD);
      });
    });
  }
  function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }

  // A SETTLE ENDS: once, by whichever of the browser and the timer says so first
  function finish(a) {
    if (A !== a) return;
    A = null;
    a.off();
    var st = a.st;
    if (a.to) { arrive(st, a.to, a.dir, a.N, 0); return; }
    backHome(st);
  }
  function backHome(st) {
    Object.keys(st.nb).forEach(function (k) {
      var N = st.nb[k];
      if (!N) return;
      // (a stand-in was only for this swipe; the real pages go on waiting)
      if (!N.real) { drop(N); delete st.nb[k]; return; }
      N.el.style.setProperty('transition', 'none');
      rest(st, N);
    });
    cool(st);
    st.skyAt = null;
    planSoon();
  }

  // A FINGER ON A PAGE STILL SETTLING: it stops where it is and is the finger's. Well on its way to a page that is ready,
  // it has landed there: the finger holds that page, the one it left beside it (and a swipe on from there is the next).
  function catchIt(e) {
    var a = A, st = a.st, t = now() - a.t0;
    A = null;
    a.off();
    var x = drawnX(st.view, a.spring.at(t)), side = x < 0 ? 1 : -1;
    var parts = [[st.view, x]];
    Object.keys(st.nb).forEach(function (k) {
      var N = st.nb[k];
      if (N) parts.push([N.el, drawnX(N.el, N.off + (N.dir === side ? x : 0))]);
    });
    parts.forEach(function (p) { p[0].style.setProperty('transition', 'none'); setX(p[0], p[1], st.base); });
    st.x = x;
    var to = a.to, sky = a.sky && a.sky.alive() ? a.sky : null;
    // (its background, on its way with the page: where the page is going on, the rest of the way at once; else the
    // finger's again, where it is now)
    if (sky && to && Math.abs(x) >= st.rect.width * ADVANCE) { sky.done(true, FADE_MS, STANDARD); sky = null; }
    // ...to a page not ready yet (its stand-in): it lands, and is built; the finger waits for it. Caught each time, a quick
    // run of flicks never landed it at all, and stood on its title (2026-11-04, WebKit)
    if (to && !(a.N && a.N.real) && Math.abs(x) >= st.rect.width * ADVANCE) {
      why = 'landing';
      arrive(st, to, a.dir, a.N, 0);
      return;
    }
    if (to && a.N && a.N.real && Math.abs(x) >= st.rect.width * ADVANCE) {
      arrive(st, to, a.dir, a.N, x + a.dir * st.rect.width);
      st = ST;
      x = st.x;
      to = null;
      // (however little was left of the way: the finger is moving this page now, and what it wears has to come back)
      heat(st);
    }
    G = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, stage: st, target: null, grid: null, live: true,
          calm: false, pts: [[e.timeStamp || Date.now(), e.clientX]], dx: 0, caught: { to: to },
          from: st.items[st.at + (x < 0 ? 1 : -1)] ? x : x / GIVE, sky: sky || null, skyAsk: sky ? sky.path : null };
    if (sky) sky.set(Math.min(1, Math.abs(x) / st.rect.width));
    why = '';
    if (e.pointerType !== 'touch') { try { st.view.setPointerCapture(e.pointerId); } catch (x2) { /* gone */ } }
    var H = host();
    if (H && H.busy) H.busy(true);
  }

  // REDUCE MOTION: the pages cross-fade, the new one coming up as the old one goes (a page not ready: the old one fades
  // to the sky, the new one comes up as it is built)
  function crossfade(st, to, dir, N) {
    var fade = 'opacity ' + FADE_MS + 'ms linear';
    st.saved = st.saved || save(st.view);
    st.view.style.setProperty('transition', fade);
    st.view.style.setProperty('opacity', '0');
    if (N && N.real) {
      setX(N.el, 0, st.base);
      N.el.style.setProperty('opacity', '0');
      if (typeof getComputedStyle === 'function') { try { void getComputedStyle(N.el).opacity; } catch (e) { /* */ } }
      N.el.style.setProperty('transition', fade);
      N.el.style.setProperty('opacity', '1');
    }
    var a = A = { st: st, to: to, dir: dir, N: N, spring: D().spring(0, 0, 0), ms: FADE_MS, t0: now(), timer: 0, calm: true, off: function () { clearTimeout(a.timer); } };
    a.timer = setTimeout(function () {
      if (A !== a) return;
      A = null;
      if (N && N.real) { arrive(st, to, dir, N, 0); return; }
      arrive(st, to, dir, N, 0, true);
    }, FADE_MS);
  }

  // IT HAS LANDED: the page beside it takes its place in the page's flow and the host is told; nothing moves on the screen.
  // The page it left stays in the slot, now the neighbor on the other side (`left`: where the page is still drawn, a
  // finger holding it). A page not ready goes the long way (commit).
  function arrive(st, to, dir, N, left, faded) {
    if (!(N && N.real)) { commit(st, to, dir, N, faded); return; }
    var H = host(), S = SH(), P = window.hkSidePane, old = st.view, other = st.nb[-dir];
    var back = { item: st.items[st.at], dir: -dir, real: true, el: old, saved: st.saved || save(old), ground: null };
    unground(st.here);
    unground(N.ground);
    // (kept in the slot until the host has shown it: it stays where it is, and its cards go on)
    if (H && H.hold) { H.hold(old, true); H.hold(N.el, false, true); }
    offAttrs(old);
    old.setAttribute('hk-swipe-peek', '');
    old.style.removeProperty('opacity');
    onAttrs(N.el);
    N.el.removeAttribute('hk-swipe-peek');
    restore(N.el, N.saved);
    var next = ST = { view: N.el, nb: {}, x: left || 0, rect: st.rect, top: st.top, base: '', origin: '', saved: null,
                      items: st.items, at: st.at + dir, spare: (st.spare || []).concat(other ? [other] : []), here: null, arrived: now() };
    next.nb[-dir] = back;
    // (the page it left out of the flow first, so that this one's box is its own)
    place(next, back);
    measure(next);
    watchSize(next.view);
    next.spare.forEach(function (o) { o.el.style.setProperty('transition', 'none'); rest(next, o); });
    arm();
    if (S && S.navigate) S.navigate(to.path);
    // (the room it lands in first: the Side Pane says where it is now, so the page takes its place as it is put back)
    if (P && P.sync) { try { P.sync(); } catch (e) { /* not drawn */ } }
    relook(next);
    if (left) {
      heat(next);
      setX(next.view, left, next.base);
      setX(back.el, back.off + (back.dir === (left < 0 ? 1 : -1) ? left : 0), next.base);
      back.el.style.setProperty('will-change', 'transform');
    } else {
      back.el.style.removeProperty('will-change');
    }
    landed(N.el);
    planSoon(0);
  }
  // (the page it left is not the page now, and the page it landed on is: what waited for that -- hk-popup.js -- looks
  // again, in that order, as when a page left goes out of the document before the next comes in)
  function landed(el) {
    try {
      window.dispatchEvent(new CustomEvent('hk-swipe-left'));
      window.dispatchEvent(new CustomEvent('hk-swipe-landed', { detail: { el: el || null } }));
    } catch (e) { /* none */ }
  }

  // A PAGE NOT READY: the host builds it now, the stand-in on the screen until it is in
  function commit(st, to, dir, N, faded) {
    var H = host(), g = st;
    var land = L = { st: st, to: to, dir: dir, N: N, offs: [] };
    delete g.nb[dir];
    var done = function (el) {
      if (L !== land) return;
      L = null;
      land.offs.forEach(function (off) { try { off(); } catch (e) { /* */ } });
      clearTimeout(land.timer);
      unground(g.here);
      g.here = null;
      // (the room it lands in first: the Side Pane says where it is now, so the page takes its place as it is put back)
      var P = window.hkSidePane;
      if (el && P && P.sync) { try { P.sync(); } catch (e) { /* not drawn */ } }
      if (N) drop(N);
      Object.keys(g.nb).forEach(function (k) { drop(g.nb[k]); });
      g.nb = {};
      restore(g.view, g.saved);
      g.saved = null;
      g.hot = false;
      if (ST === g) ST = null;
      if (el && el !== g.view) {
        if (el.swipeEnter) { try { el.swipeEnter(dir); } catch (e) { /* its own */ } }
        if (faded) fadeIn(el);
      }
      setTimeout(arm, 0);
      landed(el);
      planSoon();
    };
    if (H && H.onView) {
      land.offs.push(H.onView(function (el, view, cfg, info) { done(info && info.path === viewSeg(to.path) ? el : null); }));
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

  // A VIEW SHOWN BY SOMETHING ELSE (a tab, the back button, a link): the swipe's arrangement is over. A page waiting beside
  // this one that is now the page gets its own place back, the others go at the next quiet moment.
  function onShown(el) {
    if (!ST || ST.view === el) return;
    var st = ST;
    if (G && G.stage === st) { dropSky(G); G = null; }
    if (A && A.st === st) { var a = A; A = null; a.off(); }
    Object.keys(st.nb).forEach(function (k) {
      var N = st.nb[k];
      if (!N || N.el !== el) return;
      delete st.nb[k];
      unground(N.ground);
      onAttrs(el);
      el.removeAttribute('hk-swipe-peek');
      wearLook(el, null);
      restore(el, N.saved);
      var H = host();
      if (H && H.hold) H.hold(el, false);
    });
    unground(st.here);
    st.here = null;
    retire(st);
    if (st.saved) restore(st.view, st.saved);
    st.saved = null;
    ST = null;
    planGen++;
    setTimeout(arm, 0);
    landed(el);
    planSoon();
  }
  var heard = null;
  function listenHost() {
    var H = host();
    if (!H || H === heard || !H.onView) return;
    heard = H;
    H.onView(function (el) { onShown(el); });
  }

  // A HOME GRID'S SWIPE PAST ITS END (hk-layout.js): ours from here, when
  // there is a page that way
  function takes(dir, grid) {
    return !!G && !G.live && G.grid === grid && !!G.stage.items[G.stage.at + dir] && !blocked();
  }
  function onPast(e) {
    var d = e.detail || {};
    if (!G || G.live || d.pointerId !== G.id) return;
    G.grid = null;
    if (d.target) G.target = d.target;
    begin({ pointerId: d.pointerId, pointerType: d.pointerType || G.type }, d.dx);
    if (typeof d.x === 'number') follow(d.x);
  }

  // the tap a swipe ends with is no tap on what is under it
  function onClick(e) {
    if (Date.now() < eatUntil) { eatUntil = 0; e.stopPropagation(); e.preventDefault(); }
  }
  // THE WINDOW TURNED OR WENT AWAY: a finger's swipe goes back where it was, and a settle ends now: nothing keeps moving
  // in a window that isn't drawn, or to a size that has gone
  function abandon() {
    if (G && G.live) settle(null, G.stage.x, 0);
    else letGo();
    if (A) { var a = A; finish(a); }
  }
  function onVisibility() {
    abandon();
    if (document.visibilityState !== 'hidden') planSoon();
  }

  function start() {
    var d = document, o = { capture: true, passive: true };
    d.addEventListener('pointerdown', onDown, o);
    d.addEventListener('pointermove', onMove, o);
    d.addEventListener('pointerup', onUp, o);
    d.addEventListener('pointercancel', onUp, o);
    d.addEventListener('click', onClick, true);
    d.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', function () { abandon(); arm(); if (ST) ST.rect = null; planSoon(); });
    window.addEventListener('hk-swipe-past', onPast);
    window.addEventListener('hk-asleep', function () { planSoon(); });
    window.addEventListener('hk-look', function () { relook(ST); });
    // (Edit mode going on: what waits beside the page goes)
    if (typeof MutationObserver === 'function' && d.documentElement) {
      new MutationObserver(function () { planSoon(0); }).observe(d.documentElement, { attributes: true, attributeFilter: ['data-hk-editing'] });
    }
    window.addEventListener('hk-view-ready', function () { listenHost(); arm(); planSoon(); });
    var S = SH();
    if (S && S.onNavigate) S.onNavigate(function () { setTimeout(arm, 0); });
    window.addEventListener('popstate', function () { abandon(); setTimeout(arm, 0); });
    var HS = window.hkSettings;
    if (HS && HS.onChange) HS.onChange(function () { arm(); planSoon(); });
    listenHost();
    arm();
    setTimeout(function () { listenHost(); arm(); planSoon(); }, 1500);
  }

  window.hkPageSwipe = {
    version: '2.0.0',
    // the pages a swipe moves through here, in order (ctx: work it out for
    // that list instead); extend(fn) puts others in it -- fn(items, ctx)
    order: function (ctx) { return ctx ? order(ctx) : list(); },
    extend: extend,
    on: on,
    blocked: blocked,
    // a finger has the page, or it is settling: what can wait, waits (web/home.js narrowing)
    moving: function () { return !!(G && G.live) || !!A; },
    takes: takes,
    arm: arm,
    plan: plan,
    _: { enabled: enabled, order: order, neighbors: neighbors, atEdge: atEdge, travel: travel, lands: lands, speed: speed,
         viewSeg: viewSeg, ghost: ghost, slow: slow, park: park,
         NUMBERS: { EDGE: EDGE, START: START, RATIO: RATIO, TURN: TURN, FLICK: FLICK, FLICK_MIN: FLICK_MIN, GIVE: GIVE,
                    STANDARD_MS: STANDARD_MS, FADE_MS: FADE_MS, SLOW_FPS: SLOW_FPS, REST: REST },
         state: function () { return { G: G, L: L, A: A, ST: ST, why: why }; } }
  };
  if (typeof document !== 'undefined' && document.addEventListener) start();
  // (said once it's here: the menu offers the Pages screen's place in the
  // order then -- hk-menu.js loads before this)
  try { window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: 'hkPageSwipe' })); } catch (e) { /* no listeners */ }
})();
