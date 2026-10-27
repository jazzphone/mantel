// hk-edit.js - EDIT MODE: arranging a page in place, as the Home app does
// (drag the pills, make one Tall, Done). Owners and Admins only, and never at
// a wall tablet, whoever is signed in there. The servers stay the real check
// (Mantel's `configure`, Home Assistant's require_admin); this only decides
// whether the page offers it. The plan: Edit pages in place (2026-10-26).
//
// WHO MAY
//   canEditPage(h, client)  true when the person may edit this page here: an
//                           Owner or Admin (h.user.is_admin, h being the
//                           host's object or HKClient) and not at a wall
//                           tablet. "At a wall tablet" is the host's to say:
//                           hkShell.atTablet(client). A host that cannot say
//                           is taken as a tablet.
//
// WHICH PAGES (the surface registry). Nothing here names a page: a SURFACE
// is one kind of thing a page can arrange (a room's pills, a category page's,
// the Favorites, a scenes row, the menu), registered with
//
//   hkEdit.surface({ id, offers(view), enter(ctx) })
//     id            unique; registering the same id again replaces it
//     offers(view)  does this Lovelace view config ({path, title, area,
//                   cards: [...]}) hold something this surface edits? Pure
//                   and cheap: the menu asks it on each rebuild (memoised per
//                   view object). A page is offered Edit when any surface
//                   says yes -- never a Home Grid screen's Home, which has
//                   its own editor.
//     enter(ctx)    the page is going into Edit mode: claim what is on it
//                   and return a PART, or null for nothing here. ctx:
//                     h        the client (reads: h.callWS; saves are sent by
//                              Done through h.actions.callWS)
//                     view, path, title, dash   the page
//                     viewEl   the view's element
//                     grids    every hk-grid-card on the page (deep, through
//                              shadow roots), in page order
//                     taken    grids already claimed (pillGroups skips them)
//   a PART is { saves(), restore(), leave(), dirty?(), note?, buttons? }:
//     saves()       what Done sends, worked out NOW from what is on the page:
//                   [{ doc, msg, label? }] in order -- `doc` is the document
//                   the message changes, 'accessories', 'board/<dash>' or
//                   'house' (settings/set: the house settings) -- panel/get's
//                   `versions` key; Done adds expect_version
//                   from it. [] when nothing changed.
//     restore()     put the page back as it was when Edit began (Cancel, a
//                   Reload, Discard)
//     leave()       take the editing off the page (always, after restore()
//                   or after a save)
//     dirty()       optional: saves().length > 0 by default
//     note          optional: a line under the bar's title ("Lights keep
//                   this order on their room pages too")
//     buttons       optional: [{ label, run(session) }] in the bar
//   hkEdit.button({ id, label, show(session), run(session) })  a bar button
//                   of its own (the Room Order sheet's "Rooms", phase G)
//
// SHARED FOR SURFACES OF PILLS (this file's own room surface uses them):
//   pillGroups(ctx, claim, opts)  each grid on the page whose pills `claim`
//       (claim(hk_place, config, el) -> bool) as a GROUP that drags: a short
//       hold (HOLD_MS) or a 5 px mouse drag picks a pill up, a finger that
//       moves first scrolls, the others slide aside (FLIP), the page scrolls
//       near its top and bottom edges, and a size badge (Regular | Tall)
//       where opts.sizable(el) says the size applies (default: a tile that
//       has a layout -- hk-tile.js); opts.idOf(el) says what a member is
//       when it is not a pill with an entity. A group: { grid, root, place, initial,
//       tiles(), ids(), moved(), sizes(), restore(), leave() }.
//   roomOrders(groups, ctx)  the rooms' whole Tile Orders (accessory/order),
//       each room's list with the pills shown in the order left and every
//       other tile (one off this page, hidden) in the place it held
//   sizeSaves(groups)        accessory/set {size} for each pill resized
//
// THE SESSION
//   offer(h)        Edit is offered here now (the menu's "Edit Page", the
//                   tab bar's More, the sheet's "Edit This Page")
//   editAny(h)      the person may edit and some page of this dashboard can
//                   be (the tab bar keeps its More for them on every page)
//   enter(h, opts)  true when Edit mode began (opts.viewEl: the view, else
//                   hkShell.view())
//   active()        the session, or null: { path, title, view, dirty(), saves() }
//   done()          a promise: 'saved' | 'nothing' | 'conflict' | 'failed'
//   cancel()        everything since Edit began is put back
//   leave(saved)    out of Edit mode without asking (saved: keep the page as
//                   it is arranged)
// window gets `hk-edit` ({detail: {active}}) when Edit begins or ends and
// when a surface is registered: the menu and the tab bar rebuild.
//
// Loaded by hk-loader.js in both hosts; it assigns window.hkEdit and
// registers its room surface at load, and reads hkCards, hkDrag, hkShell,
// hkStrategy and hkSettings only when asked (they load in parallel).
(function (global) {
  'use strict';
  if (global.hkEdit) return;

  var DOMAIN = 'hk_frontend';
  var HOLD_MS = 250;            // a finger held this long picks a pill up (iOS's jiggle mode is quicker than the grid editor's 350)
  var EDGE = 72;                // within this of the window's top or bottom, a carried pill scrolls the page
  var SPEED = 22;               // px a frame at the very edge
  var SETTLE = '.26s';          // a pill gliding to its place
  var BAR_GAP = 12;             // the bar under a tab bar at the top (its own 12 px from the edge), and the page under the bar

  function win() { return global.window || global; }
  function doc() { return global.document; }
  function cards() { return global.hkCards || null; }
  function shell() { return global.hkShell || null; }
  function v(name, fb) { var C = cards(); return C && C.v ? C.v(name) : fb; }
  function raf(fn) { var r = global.requestAnimationFrame; return r ? r(fn) : setTimeout(fn, 16); }
  function unraf(id) { var c = global.cancelAnimationFrame; if (c) c(id); else clearTimeout(id); }
  function ease() { var C = cards(); return (C && C.EASE && C.EASE.standard) || 'cubic-bezier(.32,.72,0,1)'; }

  // ------------------------------------------------------------- who may
  function canEditPage(h, client) {
    if (!(h && h.user && h.user.is_admin)) return false;
    var SH = shell(), at = false;
    try { at = SH && typeof SH.atTablet === 'function' ? SH.atTablet(client) : false; } catch (e) { at = null; }
    return at === false;
  }

  // ------------------------------------------------------------- the page
  function dashCfg() {
    try { var C = cards(); if (C && C.menu && C.menu.config) return C.menu.config(); } catch (e) { /* no menu yet */ }
    try { var SH = shell(); return SH && SH.dashboardConfig ? SH.dashboardConfig() : null; } catch (e) { return null; }
  }
  // the view the address names: its `path`, else its index; none: the first
  function currentView() {
    var cfg = dashCfg(), views = cfg && Array.isArray(cfg.views) ? cfg.views : [];
    if (!views.length) return null;
    var seg = String((global.location && global.location.pathname) || '').split('/');
    var dash = seg[1] || '', here = seg[2] || '', i = -1;
    if (!here) i = 0;
    else {
      for (var k = 0; k < views.length; k++) {
        if (views[k] && views[k].path != null && String(views[k].path) === here) { i = k; break; }
      }
      if (i < 0 && /^\d+$/.test(here) && views[+here]) i = +here;
    }
    if (i < 0 || !views[i]) return null;
    var view = views[i];
    return { view: view, index: i, path: view.path != null ? String(view.path) : String(i), dash: dash,
             title: view.menu_title || view.title || (i === 0 ? 'Home' : 'This Page') };
  }
  // does any card in `list` (nested: grids, stacks) say yes?
  function anyCard(list, fn) {
    var a = Array.isArray(list) ? list : [];
    for (var i = 0; i < a.length; i++) {
      var c = a[i];
      if (!c || typeof c !== 'object') continue;
      if (fn(c)) return true;
      if (anyCard(c.cards, fn) || (c.card && anyCard([c.card], fn))) return true;
    }
    return false;
  }
  function placeOf(cfg) { return (cfg && cfg.hk_place && typeof cfg.hk_place === 'object') ? cfg.hk_place : null; }
  // does the view hold a pill whose place `pred` takes?
  function claimsIn(view, pred) {
    return !!view && anyCard(view.cards, function (c) { return !!c.entity && pred(placeOf(c), c); });
  }

  // ------------------------------------------------------------- registry
  var SURFACES = [], BUTTONS = [], GEN = 0;
  var MEMO = typeof WeakMap === 'function' ? new WeakMap() : null;
  function announce() {
    try {
      var C = global.CustomEvent;
      win().dispatchEvent(new C('hk-edit', { detail: { active: !!session } }));
    } catch (e) { /* no window */ }
  }
  function surface(spec) {
    if (!spec || !spec.id || typeof spec.offers !== 'function' || typeof spec.enter !== 'function') {
      throw new Error('hkEdit.surface wants { id, offers(view), enter(ctx) }');
    }
    SURFACES = SURFACES.filter(function (s) { return s.id !== spec.id; }).concat([spec]);
    GEN++;
    announce();
    return spec;
  }
  function unregister(id) {
    var n = SURFACES.length;
    SURFACES = SURFACES.filter(function (s) { return s.id !== id; });
    if (SURFACES.length !== n) { GEN++; announce(); }
  }
  function surfaces() { return SURFACES.map(function (s) { return s.id; }); }
  function button(spec) {
    if (!spec || !spec.id || !spec.label || typeof spec.run !== 'function') throw new Error('hkEdit.button wants { id, label, run(session) }');
    BUTTONS = BUTTONS.filter(function (b) { return b.id !== spec.id; }).concat([spec]);
    if (session) paintExtra(session);
    return spec;
  }
  function unbutton(id) { BUTTONS = BUTTONS.filter(function (b) { return b.id !== id; }); }

  function editable(view) {
    if (!view || typeof view !== 'object') return false;
    if (view.type === 'custom:hk-home-grid-view') return false;          // Home Grid: its own editor
    var m = MEMO && MEMO.get(view);
    if (m && m.gen === GEN) return m.yes;
    var yes = SURFACES.some(function (s) { try { return !!s.offers(view); } catch (e) { return false; } });
    if (MEMO) MEMO.set(view, { gen: GEN, yes: yes });
    return yes;
  }
  function offer(h) {
    if (session || !canEditPage(h, h)) return false;
    var cv = currentView();
    return !!cv && editable(cv.view);
  }
  function editAny(h) {
    if (!canEditPage(h, h)) return false;
    var cfg = dashCfg();
    return !!cfg && Array.isArray(cfg.views) && cfg.views.some(editable);
  }
  // for the menu's list key: changes when the offer does
  function offerKey(h) {
    var cv = currentView();
    return (offer(h) ? '1' : '0') + ':' + (cv ? cv.path : '') + ':' + GEN;
  }

  // ------------------------------------------------------------ the grids
  // every hk-grid-card under `root`, through shadow roots, in page order
  function findGrids(root) {
    var out = [], n = 0;
    (function walk(el) {
      if (!el || ++n > 40000) return;
      // (hk-grid-card: its #root and the cards in it)
      if (el._e && el._e.children && Array.isArray(el._kids)) out.push(el);
      var kids = el.children || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
      if (el.shadowRoot) walk(el.shadowRoot);
    })(root);
    return out;
  }
  function isTall(t) {
    if (t && typeof t._layout === 'function') {
      try { var l = t._layout(); return l === 'tall' || l === 'climate_tall'; } catch (e) { /* fall through */ }
    }
    return /span\s*2/.test(String((t && t.style && t.style.getPropertyValue && t.style.getPropertyValue('grid-row')) || ''));
  }
  function rect(el) {
    var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, width: 0, height: 0 };
  }
  function motionOn() {
    try {
      var S = global.hkSettings;
      if (S && S.rendering && S.rendering().motion === false) return false;
      var mm = win().matchMedia;
      if (mm && mm('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) { /* no media queries */ }
    return true;
  }

  // the grid's own rules while editing, in its shadow root
  function gridCss() {
    return '#root.hk-editing{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
      // THE WIGGLE turns (`rotate`), never `transform`: an animation beats an
      // inline style, and the FLIP and the carried pill move by transform
      '#root.hk-editing>[data-hk-edit]{animation:hk-edit-wiggle .26s ease-in-out infinite alternate;' +
      'animation-delay:calc(var(--hk-edit-i,0) * -.07s);cursor:grab;-webkit-tap-highlight-color:transparent}' +
      '#root.hk-editing>[data-hk-edit].hk-carried{animation:none;z-index:5;cursor:grabbing;' +
      'filter:drop-shadow(0 14px 22px rgba(0,0,0,.28))}' +
      '@keyframes hk-edit-wiggle{from{rotate:-.5deg}to{rotate:.5deg}}' +
      // Reduce Motion (the system's, or the screen's own): still, and framed
      // (addFrame: a dashed frame round what the pill paints, not an outline
      // of its element -- a room's pill is wider than its element, hk-tile.js
      // `calc(100% + 8px)`, so an outline missed its right edge)
      '#root.hk-editing.hk-still>[data-hk-edit]{animation:none}' +
      '@media (prefers-reduced-motion:reduce){#root.hk-editing>[data-hk-edit]{animation:none}}';
  }
  // the frame's rules, in the pill's own shadow root: FRAME_GAP outside the
  // edges frameFit measured (--hk-edit-fl/-ft/-fr/-fb, from the element's)
  var FRAME_GAP = 5;
  function frameCss() {
    var g = FRAME_GAP + 'px';
    return ':host{position:relative}' +
      '.hk-edit-frame{position:absolute;pointer-events:none;box-sizing:border-box;z-index:3;' +
      'left:calc(var(--hk-edit-fl,0px) - ' + g + ');top:calc(var(--hk-edit-ft,0px) - ' + g + ');' +
      'right:calc(var(--hk-edit-fr,0px) - ' + g + ');bottom:calc(var(--hk-edit-fb,0px) - ' + g + ');' +
      'border:2px dashed ' + v('mark', 'rgba(255,255,255,0.32)') + ';' +
      'border-radius:calc(' + v('glass-radius', '23.5px') + ' + ' + g + ')}';
  }
  // the badge's rules, in the pill's own shadow root (it moves and turns with it)
  function badgeCss() {
    return ':host{position:relative}' +
      '.hk-edit-size{position:absolute;top:-9px;right:-7px;z-index:4;display:inline-flex;align-items:center;' +
      'box-sizing:border-box;height:24px;padding:2px;margin:0;border:0;border-radius:12px;cursor:pointer;' +
      'background:' + v('overlay-solid', 'rgba(24,24,28,0.93)') + ';color:' + v('ink-2', 'rgba(255,255,255,0.68)') + ';' +
      'box-shadow:0 2px 8px rgba(0,0,0,.22);font:600 11px/20px ' + v('font-body', '-apple-system, sans-serif') + ';' +
      'letter-spacing:.1px;-webkit-tap-highlight-color:transparent;transition:opacity .2s}' +
      '.hk-edit-size span{display:block;height:20px;padding:0 7px;border-radius:10px}' +
      '.hk-edit-size span.on{background:' + v('ink', 'rgba(255,255,255,0.94)') + ';color:' + v('overlay-solid', 'rgba(24,24,28,0.93)') + '}' +
      '.hk-edit-size:focus-visible{outline:2px solid ' + v('accent', '#ff9f0a') + ';outline-offset:2px}';
  }

  // ------------------------------------------------------------ a group
  // One grid of pills, dragged within itself.
  function Group(grid, tiles, o) {
    var self = this, root = grid._e;
    this.grid = grid; this.root = root; this.o = o || {};
    this.members = tiles.slice();
    this.place = placeOf(tiles[0]._config) || {};
    this.order0 = [].slice.call(root.children || []);
    this.initial = this.ids();
    this.flow0 = root.style.getPropertyValue('grid-auto-flow');
    this.tall0 = this.members.map(isTall);
    this.cfg0 = this.members.map(function (t) { return t._config; });
    this.row0 = this.members.map(function (t) { return t.style.getPropertyValue('grid-row'); });
    this.press = null;
    var d = doc();
    this.css = d.createElement('style');
    this.css.textContent = gridCss();
    if (grid.shadowRoot) grid.shadowRoot.appendChild(this.css);
    root.classList.add('hk-editing');
    var still = !motionOn();
    root.classList.toggle('hk-still', still);
    root.setAttribute('data-hk-control', '');
    // what you see is the order saved: reading order, not dense packing
    root.style.setProperty('grid-auto-flow', 'row');
    this.members.forEach(function (t, i) {
      t.__hkEditGroup = self;
      t.setAttribute('data-hk-edit', '');
      t.style.setProperty('--hk-edit-i', String(i % 5));
      if (self.sizable(t)) addBadge(t);
      if (still) addFrame(t);
    });
    this.on = {
      pointerdown: function (e) { onDown(self, e); },
      click: function (e) { onClick(self, e); },
      contextmenu: function (e) { e.stopPropagation(); e.preventDefault(); },
      keydown: function (e) { onKey(self, e); },
      // a pill carried: the page does not scroll under the finger
      touchmove: function (e) { if (root.classList.contains('hk-carrying')) e.preventDefault(); }
    };
    ['pointerdown', 'click', 'contextmenu', 'keydown'].forEach(function (t) { root.addEventListener(t, self.on[t], true); });
    root.addEventListener('touchmove', this.on.touchmove, { passive: false });
  }
  Group.prototype.sizable = function (t) {
    if (this.o.sizable) return !!this.o.sizable(t);
    return typeof t._layout === 'function' && typeof t.setConfig === 'function';
  };
  Group.prototype.tiles = function () {
    var m = this.members;
    return [].filter.call(this.root.children || [], function (c) { return m.indexOf(c) >= 0; });
  };
  // (a pill's entity; opts.idOf(el) for a group of other things -- the
  // Vacuums page's cards, each in a grid of its own: hk-edit-pages.js)
  Group.prototype.idOf = function (t) { return this.o.idOf ? this.o.idOf(t) : t._config.entity; };
  Group.prototype.ids = function () { var self = this; return this.tiles().map(function (t) { return self.idOf(t); }); };
  Group.prototype.moved = function () { return this.ids().join('|') !== this.initial.join('|'); };
  Group.prototype.sizes = function () {
    var self = this, out = [];
    this.members.forEach(function (t, i) {
      if (!self.sizable(t)) return;
      var tall = isTall(t);
      if (tall !== self.tall0[i]) out.push({ entity_id: self.idOf(t), size: tall ? 'tall' : 'regular' });
    });
    return out;
  };
  Group.prototype.restore = function () {
    var self = this, root = this.root;
    this.order0.forEach(function (el) { if (el.parentNode === root) root.appendChild(el); });
    this.members.forEach(function (t, i) {
      if (t._config !== self.cfg0[i] && t.__hkResized) {
        t.setConfig(self.cfg0[i]);
        t.__hkResized = false;
      }
      if (self.row0[i]) t.style.setProperty('grid-row', self.row0[i]); else t.style.removeProperty('grid-row');
      paintBadge(t);
      fitLater(t);
    });
  };
  Group.prototype.leave = function () {
    var self = this, root = this.root;
    if (this.press) { try { this.press.stop(); } catch (e) { /* done */ } this.press = null; }
    ['pointerdown', 'click', 'contextmenu', 'keydown'].forEach(function (t) { root.removeEventListener(t, self.on[t], true); });
    root.removeEventListener('touchmove', this.on.touchmove, { passive: false });
    root.classList.remove('hk-editing'); root.classList.remove('hk-still'); root.classList.remove('hk-carrying');
    root.removeAttribute('data-hk-control');
    if (this.flow0) root.style.setProperty('grid-auto-flow', this.flow0); else root.style.removeProperty('grid-auto-flow');
    if (this.css && this.css.parentNode) this.css.parentNode.removeChild(this.css);
    this.members.forEach(function (t) {
      dropBadge(t);
      dropFrame(t);
      t.removeAttribute('data-hk-edit');
      t.classList.remove('hk-carried');
      t.style.removeProperty('--hk-edit-i');
      t.style.transform = ''; t.style.transition = '';
      t.__hkEditGroup = null;
    });
  };

  // ------------------------------------------------------------ the badge
  function addBadge(t) {
    var sr = t.shadowRoot, d = doc();
    if (!sr || t.__hkBadge) return;
    var st = d.createElement('style');
    st.className = 'hk-edit-css';
    st.textContent = badgeCss();
    var b = d.createElement('button');
    b.className = 'hk-edit-size';
    b.setAttribute('type', 'button');
    var r = d.createElement('span'), tl = d.createElement('span');
    r.textContent = 'Regular'; tl.textContent = 'Tall';
    b.appendChild(r); b.appendChild(tl);
    b.__hkTile = t;
    sr.appendChild(st); sr.appendChild(b);
    t.__hkBadge = { btn: b, css: st, r: r, t: tl };
    paintBadge(t);
  }
  function paintBadge(t) {
    var B = t && t.__hkBadge;
    if (!B) return;
    var tall = isTall(t);
    B.r.className = tall ? '' : 'on';
    B.t.className = tall ? 'on' : '';
    B.btn.setAttribute('aria-label', 'Size: ' + (tall ? 'Tall' : 'Regular') + '. Makes it ' + (tall ? 'Regular' : 'Tall') + '.');
    B.btn.setAttribute('aria-pressed', tall ? 'true' : 'false');
  }
  function dropBadge(t) {
    var B = t.__hkBadge;
    if (!B) return;
    [B.btn, B.css].forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    t.__hkBadge = null;
  }

  // ------------------------------------------------------------ the frame
  // (Reduce Motion: what marks a pill as movable instead of the wiggle)
  function addFrame(t) {
    var sr = t.shadowRoot, d = doc();
    if (!sr || t.__hkFrame) return;
    var st = d.createElement('style');
    st.className = 'hk-edit-css';
    st.textContent = frameCss();
    var f = d.createElement('div');
    f.className = 'hk-edit-frame';
    f.setAttribute('aria-hidden', 'true');
    sr.appendChild(st); sr.appendChild(f);
    t.__hkFrame = { el: f, css: st };
    frameFit(t);
  }
  // THE PILL'S PAINTED EDGES, against its element's: the box round its
  // shadow root's own content (not the badge or the frame). A room's pill
  // runs 8px past its element's right edge (and 2px below it); a scene's
  // fills its element exactly.
  function frameFit(t) {
    var F = t && t.__hkFrame, sr = t && t.shadowRoot;
    if (!F || !sr || typeof t.getBoundingClientRect !== 'function') return;
    var h = t.getBoundingClientRect(), l = Infinity, tp = Infinity, r = -Infinity, b = -Infinity;
    [].forEach.call(sr.children || [], function (k) {
      if (k === F.el || k.tagName === 'STYLE' || (t.__hkBadge && k === t.__hkBadge.btn) || typeof k.getBoundingClientRect !== 'function') return;
      var kr = k.getBoundingClientRect();
      if (!kr.width || !kr.height) return;
      l = Math.min(l, kr.left); tp = Math.min(tp, kr.top); r = Math.max(r, kr.right); b = Math.max(b, kr.bottom);
    });
    if (!isFinite(l) || !t.style || !t.style.setProperty) return;
    t.style.setProperty('--hk-edit-fl', Math.round(l - h.left) + 'px');
    t.style.setProperty('--hk-edit-ft', Math.round(tp - h.top) + 'px');
    t.style.setProperty('--hk-edit-fr', Math.round(h.right - r) + 'px');
    t.style.setProperty('--hk-edit-fb', Math.round(h.bottom - b) + 'px');
  }
  // after a size change has been drawn (Tall, Regular, a Cancel)
  function fitLater(t) { if (t && t.__hkFrame) raf(function () { frameFit(t); }); }
  function dropFrame(t) {
    var F = t.__hkFrame;
    if (!F) return;
    [F.el, F.css].forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    ['--hk-edit-fl', '--hk-edit-ft', '--hk-edit-fr', '--hk-edit-fb'].forEach(function (k) { if (t.style && t.style.removeProperty) t.style.removeProperty(k); });
    t.__hkFrame = null;
  }
  function badgeText(t) {
    var B = t && t.__hkBadge;
    return B ? B.r.textContent + '|' + B.t.textContent + ':' + (isTall(t) ? 'Tall' : 'Regular') : '';
  }
  // TALL OR REGULAR, previewed at once as the generated page draws it
  // (hk-strategy.js resized(): the tile's `size` swaps its layout --
  // hk-tile.js TALL_OF -- and its cell spans two rows, or one)
  function toggleSize(g, t) {
    if (!g.sizable(t)) return;
    var tall = !isTall(t);
    var cfg = Object.assign({}, t._config, { size: tall ? 'tall' : 'regular' });
    var vl = Object.assign({}, cfg.view_layout || {});
    if (tall) vl['grid-row'] = 'span 2'; else delete vl['grid-row'];
    if (Object.keys(vl).length) cfg.view_layout = vl; else delete cfg.view_layout;
    flip(g, function () {
      t.__hkResized = true;
      t.setConfig(cfg);
      if (tall) t.style.setProperty('grid-row', 'span 2'); else t.style.removeProperty('grid-row');
    });
    paintBadge(t);
    fitLater(t);
    changed();
  }

  // ------------------------------------------------------------ the press
  function hitOf(g, e) {
    var path = e && e.composedPath ? e.composedPath() : [], tile = null, badge = null;
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el) continue;
      if (!badge && el.__hkTile && el.__hkTile.__hkEditGroup === g) badge = el;
      if (el.parentNode === g.root && g.members.indexOf(el) >= 0) { tile = el; break; }
    }
    return { tile: tile, badge: badge };
  }
  function onDown(g, e) {
    if (!session) return;
    var hit = hitOf(g, e);
    // a press on the badge is the badge's (its click toggles the size)
    if (hit.badge) { e.stopPropagation(); return; }
    if (!hit.tile) return;
    // the pill never hears it: no device control, no hold to dim
    e.stopPropagation();
    if (e.pointerType === 'mouse') e.preventDefault();
    if (session.saving || carry) return;
    var D = global.hkDrag;
    if (!D || !D.press) return;
    g.press = D.press(g.root, e, {
      hold: HOLD_MS, lifted: null,
      lift: function (ev) { return lift(g, hit.tile, ev); },
      tap: function () { g.press = null; },
      cancel: function () { g.press = null; }
    });
  }
  function onClick(g, e) {
    var hit = hitOf(g, e);
    if (hit.badge && session && !session.saving) toggleSize(g, hit.badge.__hkTile);
    e.stopPropagation(); e.preventDefault();
  }
  function onKey(g, e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var hit = hitOf(g, e);
    if (!hit.tile && !hit.badge) return;
    if (hit.badge && session && !session.saving) toggleSize(g, hit.badge.__hkTile);
    e.stopPropagation(); e.preventDefault();
  }

  // ------------------------------------------------------------ carrying
  var carry = null;
  // where each pill sits, from its grid's corner -- so a page that scrolls
  // while one is carried (the window, or a phone's <body>) moves nothing here
  function homes(g) {
    var out = [], o = rect(g.root);
    g.tiles().forEach(function (t) {
      var r = rect(t);
      out.push({ el: t, left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height });
    });
    return out;
  }
  function homeOf(list, el) { for (var i = 0; i < list.length; i++) if (list[i].el === el) return list[i]; return null; }
  // FLIP: `change` moves things; every pill but the carried one starts from
  // where it was and glides to its new place
  function flip(g, change) {
    var held = carry && carry.g === g ? carry.tile : null;
    var first = homes(g);
    change();
    g.tiles().forEach(function (t) { if (t !== held) { t.style.transition = 'none'; t.style.transform = ''; } });
    if (held) held.style.transform = '';
    var last = homes(g);
    var moving = [];
    last.forEach(function (l) {
      if (l.el === held) return;
      var f = homeOf(first, l.el);
      if (!f) return;
      var dx = f.left - l.left, dy = f.top - l.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      l.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      moving.push(l.el);
    });
    if (moving.length) {
      void g.root.offsetWidth;                         // that start, drawn
      raf(function () {
        moving.forEach(function (t) { t.style.transition = 'transform ' + SETTLE + ' ' + ease(); t.style.transform = ''; });
      });
    }
    if (carry && carry.g === g) { carry.homes = last; follow(carry.last); }
    return last;
  }
  function lift(g, tile, ev) {
    if (carry || !session) return false;
    g.press = null;
    var r = rect(tile);
    carry = { g: g, tile: tile, offX: ev.clientX - r.left, offY: ev.clientY - r.top, last: ev, homes: homes(g), raf: 0, skip: null };
    tile.style.transition = 'none';
    tile.classList.add('hk-carried');
    g.root.classList.add('hk-carrying');
    if (tile.__hkBadge) tile.__hkBadge.btn.style.opacity = '0';
    carry.move = function (e) { carryMove(e); };
    carry.up = function () { drop(); };
    g.root.addEventListener('pointermove', carry.move);
    g.root.addEventListener('pointerup', carry.up);
    g.root.addEventListener('pointercancel', carry.up);
    follow(ev);
    return true;
  }
  function follow(ev) {
    if (!carry || !ev) return;
    var h = homeOf(carry.homes, carry.tile);
    if (!h) return;
    var o = rect(carry.g.root);
    var tx = ev.clientX - carry.offX - (o.left + h.left), ty = ev.clientY - carry.offY - (o.top + h.top);
    carry.tile.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(1.04)';
  }
  // the pill under the pointer takes the carried one's place (within its
  // middle, so a pill just moved aside is not taken straight back)
  function aim(ev) {
    var g = carry.g, o = rect(g.root), x = ev.clientX - o.left, y = ev.clientY - o.top, hit = null;
    carry.homes.forEach(function (h) {
      if (h.el === carry.tile || hit) return;
      var ix = h.width * 0.12, iy = h.height * 0.12;
      if (x >= h.left + ix && x <= h.left + h.width - ix && y >= h.top + iy && y <= h.top + h.height - iy) hit = h.el;
    });
    if (carry.skip && hit !== carry.skip) carry.skip = null;
    if (!hit || hit === carry.skip) return;
    var list = g.tiles(), i = list.indexOf(carry.tile), j = list.indexOf(hit);
    if (i < 0 || j < 0 || i === j) return;
    var t = carry.tile;
    flip(g, function () {
      if (i < j) g.root.insertBefore(t, hit.nextSibling); else g.root.insertBefore(t, hit);
    });
    carry.skip = hit;
  }
  function edgeSpeed(y) {
    var H = win().innerHeight || 800;
    if (y < EDGE) return -Math.ceil(SPEED * Math.min(1, (EDGE - y) / EDGE));
    if (y > H - EDGE) return Math.ceil(SPEED * Math.min(1, (y - (H - EDGE)) / EDGE));
    return 0;
  }
  function carryMove(ev) {
    if (!carry) return;
    carry.last = ev;
    follow(ev);
    aim(ev);
    if (edgeSpeed(ev.clientY) && !carry.raf) carry.raf = raf(tick);
  }
  // NEAR AN EDGE, the page scrolls under the carried pill, faster nearer it
  function tick() {
    if (!carry) return;
    carry.raf = 0;
    var sp = edgeSpeed(carry.last.clientY);
    if (!sp) return;
    scrollPage(sp);
    follow(carry.last);
    aim(carry.last);
    carry.raf = raf(tick);
  }
  // the window, else a phone's <body> (where overflow-x is hidden, it is the scroller)
  function scrollPage(dy) {
    var w = win(), d = doc(), y0 = w.scrollY || 0;
    if (w.scrollBy) w.scrollBy(0, dy);
    var b = d && d.body;
    if ((w.scrollY || 0) === y0 && b && b.scrollHeight > b.clientHeight) b.scrollTop += dy;
  }
  function drop() {
    var c = carry;
    if (!c) return;
    carry = null;
    if (c.raf) unraf(c.raf);
    var root = c.g.root, t = c.tile;
    root.removeEventListener('pointermove', c.move);
    root.removeEventListener('pointerup', c.up);
    root.removeEventListener('pointercancel', c.up);
    t.classList.remove('hk-carried');
    root.classList.remove('hk-carrying');
    if (t.__hkBadge) t.__hkBadge.btn.style.opacity = '';
    t.style.transition = 'transform ' + SETTLE + ' ' + ease();
    raf(function () { t.style.transform = ''; });
    changed();
  }

  // ------------------------------------------------------------ shared for surfaces
  function pillGroups(ctx, claim, o) {
    ctx.taken = ctx.taken || [];
    return (ctx.grids || []).map(function (grid) {
      if (ctx.taken.indexOf(grid) >= 0 || !grid._e) return null;
      var tiles = (grid._kids || []).filter(function (k) {
        var id = k && k._config && (o && o.idOf ? o.idOf(k) : k._config.entity);
        return id && k.parentNode === grid._e && claim(placeOf(k._config), k._config, k);
      });
      if (!tiles.length) return null;
      ctx.taken.push(grid);
      return new Group(grid, tiles, o);
    }).filter(Boolean);
  }
  // the shown ones take the places they held, in their new order
  function fillSlots(full, shown) {
    var set = {}, k = 0;
    shown.forEach(function (id) { set[id] = 1; });
    return full.map(function (id) { return set[id] ? shown[k++] : id; });
  }
  // the page's list (`live`, the strategy's order) with what a saved order
  // has and the page does not (hidden everywhere) kept after the one it
  // followed
  function merged(saved, live) {
    var out = (live || []).slice();
    if (!Array.isArray(saved) || !saved.length) return out;
    saved.forEach(function (id, i) {
      if (out.indexOf(id) >= 0) return;
      var j = i - 1;
      while (j >= 0 && out.indexOf(saved[j]) < 0) j--;
      out.splice(j < 0 ? 0 : out.indexOf(saved[j]) + 1, 0, id);
    });
    return out;
  }
  // A ROOM'S WHOLE TILE ORDER as it stands: the strategy's (its own order,
  // then the rest), with a saved order's hidden ones kept in place
  function fullOrder(h, area) {
    var HS = global.hkSettings, S = global.hkStrategy, live = [];
    try {
      var G = (HS && HS.get('generated', null)) || {};
      var r = S && S.rooms ? S.rooms(h, { areas: [area], include_entities: G.include_entities || [] }) : [];
      live = r[0] && r[0].id === area && r[0].entities ? r[0].entities.slice() : [];
    } catch (e) { live = []; }
    var A = HS && HS.get('accessories', null), saved = A && A.rooms && Array.isArray(A.rooms[area]) ? A.rooms[area] : null;
    return merged(saved, live);
  }
  // EACH ROOM A GROUP CHANGED, its whole list: every group of that room on
  // this page (moved or not -- a room with no order of its own keeps exactly
  // what it showed, Lights A to Z included) fills its pills' places. A pill
  // belongs to the room whose list has it: its group's, else one of the
  // page's (two rooms on one page each keep their own list).
  function roomOrders(groups, ctx) {
    var h = ctx.h, areas = [].concat((ctx.view && ctx.view.area) || []).filter(Boolean);
    var fulls = {}, order = [], parts = {};
    var full = function (a) { if (!fulls[a]) fulls[a] = fullOrder(h, a); return fulls[a]; };
    groups.forEach(function (g) {
      var home = g.place && g.place.area;
      if (!home) return;
      var cands = [home].concat(areas.filter(function (a) { return a !== home; }));
      var by = {}, seen = [];
      g.ids().forEach(function (id) {
        var a = null;
        for (var i = 0; i < cands.length && !a; i++) if (full(cands[i]).indexOf(id) >= 0) a = cands[i];
        if (!a) { a = home; full(home).push(id); }
        if (!by[a]) { by[a] = []; seen.push(a); }
        by[a].push(id);
      });
      seen.forEach(function (a) {
        if (!parts[a]) { parts[a] = []; order.push(a); }
        parts[a].push({ g: g, ids: by[a] });
      });
    });
    return order.filter(function (a) { return parts[a].some(function (p) { return p.g.moved(); }); }).map(function (a) {
      var out = full(a).slice();
      parts[a].forEach(function (p) { out = fillSlots(out, p.ids); });
      var name = (h && h.areas && h.areas[a] && h.areas[a].name) || a;
      return { doc: 'accessories', label: name + '’s order', msg: { type: DOMAIN + '/accessory/order', area_id: a, entities: out } };
    });
  }
  function sizeSaves(groups) {
    var out = [];
    groups.forEach(function (g) {
      g.sizes().forEach(function (s) {
        out.push({ doc: 'accessories', label: s.entity_id + ' ' + s.size,
                   msg: { type: DOMAIN + '/accessory/set', entity_id: s.entity_id, size: s.size } });
      });
    });
    return out;
  }

  // ------------------------------------------------------------ the session
  var session = null;
  function active() { return session; }
  function collect(s) {
    var out = [];
    s.parts.forEach(function (p) { try { out = out.concat(p.saves() || []); } catch (e) { /* a part that cannot say */ } });
    return out;
  }
  function isDirty(s) {
    return s.parts.some(function (p) {
      try { return p.dirty ? !!p.dirty() : (p.saves() || []).length > 0; } catch (e) { return false; }
    });
  }
  function changed() { if (session) say(''); }

  function enter(h, opts) {
    opts = opts || {};
    if (session || !canEditPage(h, h)) return false;
    var cv = currentView();
    if (!cv || !editable(cv.view)) return false;
    var SH = shell(), viewEl = opts.viewEl || null;
    // the view shown (a host whose view host keeps no view element of its
    // own: the slot it draws the view in)
    if (!viewEl) { try { viewEl = SH ? (SH.view() || SH.viewSlot() || SH.viewContainer()) : null; } catch (e) { viewEl = null; } }
    if (!viewEl) return false;
    var ctx = { h: h, view: cv.view, path: cv.path, title: cv.title, dash: cv.dash, viewEl: viewEl,
                grids: findGrids(viewEl), taken: [] };
    var parts = [];
    SURFACES.forEach(function (sf) {
      var p = null;
      try { p = sf.enter(ctx); } catch (e) { p = null; if (global.console) console.error('[hk-edit] ' + sf.id, e); }
      if (p) parts.push(p);
    });
    if (!parts.length) return false;
    var s = {
      h: h, path: cv.path, title: cv.title, dash: cv.dash, view: cv.view, viewEl: viewEl,
      url: String((global.location && global.location.pathname) || ''), parts: parts, saving: null, ctx: ctx,
      dirty: function () { return isDirty(s); }, saves: function () { return collect(s); }
    };
    ctx.session = s;
    // THE VERSIONS AS EDITING BEGINS (panel/get, Owners and Admins): Done
    // sends each change with its document's, so someone else's change made
    // meanwhile is a `conflict`, never silently replaced
    var read;
    try { read = Promise.resolve(h.callWS({ type: DOMAIN + '/panel/get' })); } catch (e) { read = Promise.reject(e); }
    s.versions = read.then(function (r) { return (r && r.versions) || {}; }, function () { return {}; });
    session = s;
    mountBar(s);
    guard(s);
    try { doc().documentElement.setAttribute('data-hk-editing', ''); } catch (e) { /* no document */ }
    announce();
    return true;
  }

  function leave(saved) {
    var s = session;
    if (!s) return false;
    if (carry) drop();
    s.parts.forEach(function (p) {
      try { if (!saved && p.restore) p.restore(); } catch (e) { /* its own */ }
      try { if (p.leave) p.leave(); } catch (e) { /* its own */ }
    });
    session = null;
    unguard(s);
    unmountBar(s);
    try { doc().documentElement.removeAttribute('data-hk-editing'); } catch (e) { /* no document */ }
    announce();
    return true;
  }
  function cancel() { return leave(false); }
  function rebuild() {
    var S = global.hkStrategy;
    try { if (S && S.rebuild) S.rebuild(); } catch (e) { /* not on a generated dashboard */ }
  }

  // DONE: every change, one at a time, each with its document's version (the
  // one read as editing began, then the one each answer brings)
  function done() {
    var s = session;
    if (!s) return Promise.resolve('nothing');
    if (s.saving) return s.saving;
    var saves = collect(s);
    if (!saves.length) { leave(true); return Promise.resolve('nothing'); }
    busy(s, true);
    say('Saving…');
    s.saving = s.versions.then(function (ver) { return send(s, saves, Object.assign({}, ver), false); });
    return s.saving;
  }
  function send(s, saves, ver, anyway) {
    var S = global.hkStrategy;
    // this screen's own change: built again the moment the feed has it
    if (S && S.ownChange) S.ownChange();
    var i = 0;
    var next = function () {
      if (session !== s) return 'gone';
      if (i >= saves.length) { s.saving = null; leave(true); return 'saved'; }
      var sv = saves[i], msg = Object.assign({}, sv.msg);
      if (!anyway && ver[sv.doc] != null) msg.expect_version = ver[sv.doc];
      return Promise.resolve().then(function () { return s.h.actions.callWS(msg); }).then(function (r) {
        // the answer's version is the next one's; an answer without one
        // (an older host) leaves the rest to go without
        if (r && r.version != null) ver[sv.doc] = r.version; else delete ver[sv.doc];
        i++;
        return next();
      }, function (err) {
        s.saving = null;
        if (session !== s) return 'gone';
        busy(s, false);
        if (err && err.code === 'conflict') {
          say('');
          changedMeanwhile(s, saves.slice(i), ver);
          return 'conflict';
        }
        say('Not saved: ' + ((err && err.message) || err || 'unknown error'));
        return 'failed';
      });
    };
    return next();
  }
  // "This page changed": Reload (Cancel's place) or Save Anyway, as the grid
  // editor asks (hk-grid-editor.js changed()); Escape or a tap outside is
  // neither, and the page stays in Edit mode with nothing lost
  function changedMeanwhile(s, rest, ver) {
    ask(s, 'This page changed since you started editing', {
      detail: 'It was changed in another window or on another device. Reload to see it as it is now ' +
              '(your changes here are discarded), or Save Anyway to replace it with your arrangement.',
      no: 'Reload', yes: 'Save Anyway',
      onNo: function () { if (session !== s) return; leave(false); rebuild(); },
      onOk: function () {
        if (session !== s) return;
        busy(s, true); say('Saving…');
        s.saving = send(s, rest, ver, true);
      }
    });
  }
  function ask(s, text, o) {
    var C = cards();
    if (!C || !C.confirmSheet) { if (o.onNo) o.onNo(); return; }
    s.asking = C.confirmSheet(text, o.onOk, { detail: o.detail, yes: o.yes, no: o.no, onNo: o.onNo });
  }
  function asking(s) {
    var el = s && s.asking;
    return !!(el && el.hasAttribute && el.hasAttribute('data-open'));
  }
  function discardFirst(s, go) {
    ask(s, 'Discard your changes to this page?', {
      detail: 'Leaving Edit mode puts this page back as it was.', yes: 'Discard', no: 'Keep Editing',
      onOk: function () { if (session === s) leave(false); go(); }, onNo: function () {}
    });
  }

  // LEAVING THE PAGE ASKS FIRST: HK's own navigation (the menu, the tab bar,
  // a back button), the browser's back, and closing or reloading the window
  function guard(s) {
    var SH = shell();
    if (SH && typeof SH.navigate === 'function' && !SH.navigate.__hkEdit) {
      var orig = SH.navigate;
      var wrap = function () {
        var args = arguments;
        if (session !== s) return orig.apply(SH, args);
        if (!s.dirty()) { leave(false); return orig.apply(SH, args); }
        discardFirst(s, function () { orig.apply(SH, args); });
        return null;
      };
      wrap.__hkEdit = true;
      SH.navigate = wrap;
      s.unNav = function () { if (SH.navigate === wrap) SH.navigate = orig; };
    }
    s.onKey = function (e) {
      if (e.key !== 'Escape' || session !== s || asking(s)) return;
      if (e.stopPropagation) e.stopPropagation();
      if (carry) { drop(); return; }
      if (!s.saving) cancel();
    };
    s.onUnload = function (e) {
      if (session !== s || !s.dirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    s.onPop = function () {
      if (session !== s) return;
      var here = String((global.location && global.location.pathname) || '');
      if (here === s.url) return;
      if (!s.dirty()) { leave(false); return; }
      // back to the page being edited, then asked
      try { global.history.pushState(null, '', s.url); if (SH && SH.announce) SH.announce(); } catch (e) { /* no history */ }
      discardFirst(s, function () { try { global.history.back(); } catch (e) { /* no history */ } });
    };
    var w = win();
    w.addEventListener('keydown', s.onKey, true);
    w.addEventListener('beforeunload', s.onUnload);
    w.addEventListener('popstate', s.onPop);
  }
  function unguard(s) {
    if (s.unNav) s.unNav();
    var w = win();
    w.removeEventListener('keydown', s.onKey, true);
    w.removeEventListener('beforeunload', s.onUnload);
    w.removeEventListener('popstate', s.onPop);
  }

  // ------------------------------------------------------------ the bar
  // A capsule pinned at the top, over the page: Cancel, "Editing <page>"
  // (a surface's note under it), the extra buttons, Done. The title stays
  // centred (1fr auto 1fr), and Cancel and Done sit the same distance from
  // the capsule's ends.
  function barCss() {
    var C = cards(), B = (C && C.BLUR && C.BLUR.heavy) || 'blur(34px) saturate(1.9)';
    // (over the page, not a docked menu: --hk-page-left / -right, hk-menu.js)
    // (under a tab bar at the top, --hk-tabbar-below from hk-tabbar.js: as
    // far below it as it is below the window's edge, BAR_GAP; under the
    // host's own toolbar when it shows one, --hk-edit-under: mountBar)
    return '#hk-edit{position:fixed;left:var(--hk-page-left,0px);right:var(--hk-page-right,0px);top:0;z-index:10;display:flex;justify-content:center;' +
      'box-sizing:border-box;padding:max(calc(var(--hk-safe-top, env(safe-area-inset-top, 0px)) + 10px), ' +
      'calc(var(--hk-tabbar-below, -100px) + ' + BAR_GAP + 'px), calc(var(--hk-edit-under, -100px) + 10px)) 16px 0;pointer-events:none}' +
      '#hk-edit .bar{pointer-events:auto;box-sizing:border-box;width:100%;max-width:640px;min-height:52px;' +
      'display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;column-gap:8px;' +
      'padding:3px 5px;border-radius:26px;border:' + v('glass-border', '1px solid rgba(255,255,255,0.13)') + ';' +
      'background:' + v('overlay', 'rgba(28,28,32,0.52)') + ';' +
      '-webkit-backdrop-filter:' + B + ';backdrop-filter:' + B + ';' +
      'box-shadow:0 10px 30px rgba(0,0,0,.28);color:' + v('ink', 'rgba(255,255,255,0.94)') + ';' +
      'font-family:' + v('font-body', '-apple-system, sans-serif') + '}' +
      '#hk-edit .l{justify-self:start;display:flex}' +
      '#hk-edit .r{justify-self:end;display:flex;align-items:center}' +
      '#hk-edit button{appearance:none;-webkit-appearance:none;border:0;margin:0;background:none;color:inherit;' +
      'font:inherit;font-size:17px;line-height:22px;padding:11px 16px;min-height:44px;border-radius:22px;' +
      'cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent}' +
      '#hk-edit button:active{background:' + v('key', 'rgba(255,255,255,0.10)') + '}' +
      '#hk-edit button.ok{font-weight:600;color:' + v('accent', '#ff9f0a') + '}' +
      '#hk-edit button[disabled]{opacity:.45;cursor:default}' +
      '#hk-edit .mid{min-width:0;text-align:center;padding:4px 0}' +
      '#hk-edit .t{font-size:15px;font-weight:600;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#hk-edit .n,#hk-edit .m{font-size:13px;font-weight:500;line-height:17px;color:' + v('ink-2', 'rgba(255,255,255,0.68)') + '}' +
      '#hk-edit .m.err{color:' + v('fail', '#ff453a') + '}' +
      '#hk-edit [hidden]{display:none!important}' +
      '@media (max-width:640px){#hk-edit button{padding:11px 12px}' +
      // (a phone with a bar button of a surface's -- Rooms: the title gives
      // way, never runs under the buttons)
      '#hk-edit .bar{grid-template-columns:auto minmax(0,1fr) auto}#hk-edit button.more{padding:11px 8px}}';
  }
  function el(tag, cls, text) {
    var e = doc().createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function mountBar(s) {
    var d = doc();
    if (!d || !d.createElement) return;
    var host = el('div');
    host.id = 'hk-edit';
    var st = el('style');
    st.textContent = barCss();
    var bar = el('div', 'bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Editing ' + s.title);
    var l = el('div', 'l'), mid = el('div', 'mid'), r = el('div', 'r');
    var cx = el('button', 'cx', 'Cancel'), ok = el('button', 'ok', 'Done');
    cx.setAttribute('type', 'button'); ok.setAttribute('type', 'button');
    var t = el('div', 't', 'Editing ' + s.title), n = el('div', 'n'), m = el('div', 'm');
    m.setAttribute('aria-live', 'polite');
    var extra = el('span', 'x');
    cx.addEventListener('click', function () { if (session === s && !s.saving) cancel(); });
    ok.addEventListener('click', function () { if (session === s) done(); });
    l.appendChild(cx);
    mid.appendChild(t); mid.appendChild(n); mid.appendChild(m);
    r.appendChild(extra); r.appendChild(ok);
    bar.appendChild(l); bar.appendChild(mid); bar.appendChild(r);
    host.appendChild(st); host.appendChild(bar);
    var SH = shell(), root = null;
    try { root = SH && SH.dialogRoot ? SH.dialogRoot() : null; } catch (e) { root = null; }
    root = root || d.body;
    if (!root) return;
    // THE HOST'S OWN TOOLBAR, when it shows one (Home Assistant's dashboard
    // header, unless kiosk mode hides it): the bar goes under it, never over
    // its buttons
    var under = 0;
    try {
      var tb = SH && SH.toolbar ? SH.toolbar() : null, tr = tb && tb.getBoundingClientRect ? tb.getBoundingClientRect() : null;
      if (tr && tr.height > 0 && tr.bottom > 0 && tr.top < 80) under = Math.round(tr.bottom);
    } catch (e) { under = 0; }
    if (under && host.style && host.style.setProperty) host.style.setProperty('--hk-edit-under', under + 'px');
    root.appendChild(host);
    var C = cards();
    if (C && C.flatSurface) { try { C.flatSurface(bar, 'bar'); } catch (e) { /* the Glass looks */ } }
    s.bar = { host: host, bar: bar, cancel: cx, done: ok, extra: extra, title: t, note: n, msg: m };
    var note = '';
    s.parts.forEach(function (p) { if (!note && p.note) note = String(p.note); });
    n.textContent = note;
    n.hidden = !note;
    m.hidden = true;
    paintExtra(s);
    makeRoom(s);
  }
  // THE PAGE MAKES ROOM: the bar is pinned over the top of the page, so while
  // editing the view goes down by what the bar would cover of it (and
  // BAR_GAP) -- the page's title, a room's back button, the first row of
  // pills are never under the bar (or under a tab bar at the top and the bar
  // below it). Measured once the bar is drawn; a page scrolled past its top
  // is measured from its top all the same.
  function makeRoom(s) {
    var v = s.viewEl, B = s.bar;
    if (!v || !v.style || !B || !B.bar || typeof B.bar.getBoundingClientRect !== 'function' ||
        typeof v.getBoundingClientRect !== 'function') return;
    var room = 0;
    try {
      var bb = B.bar.getBoundingClientRect(), vr = v.getBoundingClientRect(), pad = 0;
      try { pad = parseFloat(global.getComputedStyle(v).paddingTop) || 0; } catch (e) { pad = 0; }
      var top = vr.top + (global.scrollY || global.pageYOffset || 0) + pad;
      room = Math.max(0, Math.min(bb.bottom + BAR_GAP, Math.round(bb.bottom + BAR_GAP - top)));
    } catch (e) { room = 0; }
    if (!room) return;
    s.room = { el: v, was: v.style.getPropertyValue('margin-top'), prio: v.style.getPropertyPriority ? v.style.getPropertyPriority('margin-top') : '' };
    v.style.setProperty('margin-top', 'calc(' + (s.room.was || '0px') + ' + ' + room + 'px)');
  }
  function unroom(s) {
    var R = s.room;
    if (!R) return;
    if (R.was) R.el.style.setProperty('margin-top', R.was, R.prio || ''); else R.el.style.removeProperty('margin-top');
    s.room = null;
  }
  function paintExtra(s) {
    var B = s.bar;
    if (!B) return;
    while (B.extra.firstChild) B.extra.removeChild(B.extra.firstChild);
    var list = [];
    BUTTONS.forEach(function (b) { var show = true; try { show = b.show ? !!b.show(s) : true; } catch (e) { show = false; } if (show) list.push(b); });
    s.parts.forEach(function (p) { (p.buttons || []).forEach(function (b) { list.push(b); }); });
    list.forEach(function (b) {
      var x = el('button', 'more', b.label);
      x.setAttribute('type', 'button');
      x.addEventListener('click', function () { if (session === s && !s.saving) b.run(s); });
      B.extra.appendChild(x);
    });
  }
  function unmountBar(s) {
    unroom(s);
    if (s.bar && s.bar.host && s.bar.host.parentNode) s.bar.host.parentNode.removeChild(s.bar.host);
    s.bar = null;
  }
  function busy(s, on) {
    if (!s.bar) return;
    s.bar.done.disabled = !!on;
    s.bar.cancel.disabled = !!on;
    [].forEach.call(s.bar.extra.children || [], function (b) { b.disabled = !!on; });
  }
  function say(text) {
    var s = session;
    if (!s || !s.bar) return;
    var m = s.bar.msg;
    m.textContent = text || '';
    m.hidden = !text;
    m.className = /^Not saved/.test(text || '') ? 'm err' : 'm';
  }

  // ------------------------------------------------------------ rooms
  // ROOM PAGES' GROUPS AND HOME'S ROOM SECTIONS (hk-strategy.js hk_place:
  // {area, group} and {area}): a drag within one changes the room's Tile
  // Order (accessory/order, every screen), a badge the accessory's size.
  // A category page's pills say their `page` (phase D's) and the Favorites
  // `fav` (phase E's).
  function roomPlace(p) { return !!(p && p.area && !p.page && !p.fav); }
  surface({
    id: 'rooms',
    offers: function (view) { return claimsIn(view, roomPlace); },
    enter: function (ctx) {
      var groups = pillGroups(ctx, function (p) { return roomPlace(p); });
      if (!groups.length) return null;
      return {
        groups: groups,
        saves: function () { return roomOrders(groups, ctx).concat(sizeSaves(groups)); },
        dirty: function () { return groups.some(function (g) { return g.moved() || g.sizes().length > 0; }); },
        restore: function () { groups.forEach(function (g) { g.restore(); }); },
        leave: function () { groups.forEach(function (g) { g.leave(); }); }
      };
    }
  });

  global.hkEdit = {
    version: '1.0.0',
    canEditPage: canEditPage,
    currentView: currentView, editable: editable, offer: offer, editAny: editAny, offerKey: offerKey,
    enter: enter, leave: leave, cancel: cancel, done: done, active: active,
    surface: surface, surfaces: surfaces, button: button,
    pillGroups: pillGroups, roomOrders: roomOrders, sizeSaves: sizeSaves,
    // the Reduce Motion frame round a pill (the scenes row's too: hk-edit-pages.js)
    addFrame: addFrame, dropFrame: dropFrame,
    _: {
      HOLD_MS: HOLD_MS, EDGE: EDGE, fillSlots: fillSlots, merged: merged, roomOrders: roomOrders, claimsIn: claimsIn,
      findGrids: findGrids, unregister: unregister, unbutton: unbutton, badgeText: badgeText,
      bar: function () { return session && session.bar ? session.bar.host : null; },
      barButtons: function () { var B = session && session.bar; return B ? { cancel: B.cancel, done: B.done, extra: B.extra } : null; },
      barTitle: function () { var B = session && session.bar; return B ? B.title.textContent : ''; },
      barNote: function () { var B = session && session.bar; return B ? B.note.textContent : ''; },
      barMessage: function () { var B = session && session.bar; return B ? B.msg.textContent : ''; }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
