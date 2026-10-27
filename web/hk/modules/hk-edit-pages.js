// hk-edit-pages.js - EDIT MODE'S OTHER SURFACES (hk-edit.js has the shell
// and the room pages): the category pages, Home's Favorites and the scenes
// rows. Each is an hkEdit.surface (the contract is at the top of
// hk-edit.js); nothing here draws a bar or saves by itself -- Done sends what
// each part's saves() says, with its document's version.
//
//   category-rooms  Lights, Climate (its left stack) and Water list room by
//                   room (hk-strategy.js catPlace: {area, group, page}). A
//                   drag in a room's section changes THAT ROOM'S Tile Order
//                   (accessory/order, hkEdit.roomOrders), so the room page
//                   follows -- the bar says so. Tall / Regular as on a room
//                   page.
//   page-order      Security and Vacuums keep an order of their own
//                   ({page}): accessory/page_order {page, entities}, the
//                   whole list (a saved one's missing lock keeps its place).
//                   Security ignores size, so no badge; a vacuum is a 388 px
//                   card in a grid of its own, and those grids are what drag.
//                   DOORS & WINDOWS has no saved order (Status & Chips orders
//                   it), so its page offers no Edit.
//   favorites       Home's Favorites ({fav: true}): board/set {favorites},
//                   this screen's version; a favorite gone from the house
//                   keeps its place. Always one height: no badge.
//   scenes-row      a row of scene pills that scrolls sideways (hk-chip.js
//                   HkScenesCard in an hk-row-card): Home's saves board/set
//                   {scenes, scenes_pages} -- its page pills placed among the
//                   scenes as "page:<kind>", as HK Settings saves it
//                   (hk-settings-model.js scenesSave); a room page's saves
//                   accessory/room_scenes {area_id, entities}. The pills drag
//                   SIDEWAYS (the slide-aside maths of hk-settings-kit.js
//                   dragger(), turned on its side), the row scrolls itself
//                   while one is carried near an end, and never drag-scrolls
//                   under a mouse while editing (hk-row.js's own mouse drag).
//
// Loaded by hk-loader.js after hk-edit.js (in parallel: it waits for
// window.hkEdit); assigns window.hkEditPages.
(function (global) {
  'use strict';
  if (global.hkEditPages) return;

  var DOMAIN = 'hk_frontend';
  var PAGE_TOKEN = 'page:';
  var EDGE = 48;                // within this of the row's ends, a carried pill scrolls the row
  var SPEED = 14;               // px a frame at the very end
  var SETTLE = '.26s';
  // the category pages that follow each room's order, and what the bar says
  var CAT = { lights: 'Lights keep this order on their room pages too.',
              climate: 'These keep this order on their room pages too.',
              water: 'Leak sensors keep this order on their room pages too.' };
  var OWN = { security: 'Security', vacuums: 'Vacuums' };

  function E() { return global.hkEdit || null; }
  function win() { return global.window || global; }
  function doc() { return global.document; }
  function raf(fn) { var r = global.requestAnimationFrame; return r ? r(fn) : setTimeout(fn, 16); }
  function unraf(id) { var c = global.cancelAnimationFrame; if (c) c(id); else clearTimeout(id); }
  function cards() { return global.hkCards || null; }
  function v(name, fb) { var C = cards(); return C && C.v ? C.v(name) : fb; }
  function ease() { var C = cards(); return (C && C.EASE && C.EASE.standard) || 'cubic-bezier(.32,.72,0,1)'; }
  function setting(path, fb) {
    var HS = global.hkSettings;
    try { return HS && HS.get ? HS.get(path, fb) : fb; } catch (e) { return fb; }
  }
  // this screen's settings, as the page draws them (hk-base.js menu.board)
  function board(dash) {
    var C = cards();
    try { if (C && C.menu && C.menu.board) return C.menu.board() || {}; } catch (e) { /* no menu */ }
    return ((setting('boards', null) || {})[dash]) || {};
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
  function placeOf(cfg) { return (cfg && cfg.hk_place && typeof cfg.hk_place === 'object') ? cfg.hk_place : null; }
  // does any card in `list` (nested: grids, stacks, a conditional's card) say yes?
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
  function claims(view, pred) {
    return !!view && anyCard(view.cards, function (c) { return !!c.entity && pred(placeOf(c), c); });
  }
  function concat(groups, key) {
    var out = [];
    groups.forEach(function (g) { out = out.concat(key === 'initial' ? g.initial : g.ids()); });
    return out;
  }
  function pillsPart(groups, saves, note) {
    return {
      groups: groups, note: note || '',
      saves: saves,
      dirty: function () { return groups.some(function (g) { return g.moved() || g.sizes().length > 0; }); },
      restore: function () { groups.forEach(function (g) { g.restore(); }); },
      leave: function () { groups.forEach(function (g) { g.leave(); }); }
    };
  }
  // THE WHOLE LIST AS SAVED: `full` with what was shown (`was`) and is not in
  // it put after what it followed, then the shown ones in their new order
  // (`now`) in the places they held
  function slotted(full, was, now) {
    var X = E()._;
    return X.fillSlots(X.merged(full, was), now);
  }

  // ------------------------------------------------------------ category pages
  function catPlace(p) { return !!(p && p.area && CAT[p.page]); }
  var offersCat = function (view) { return claims(view, catPlace); };
  function enterCat(ctx) {
    var H = E(), groups = H.pillGroups(ctx, function (p) { return catPlace(p); });
    if (!groups.length) return null;
    return pillsPart(groups, function () { return H.roomOrders(groups, ctx).concat(H.sizeSaves(groups)); },
                     CAT[groups[0].place.page]);
  }

  // ------------------------------------------------------------ Security, Vacuums
  function ownPlace(p) { return !!(p && !p.area && OWN[p.page]); }
  // a vacuum's card sits in a grid of its own: that grid is what moves
  function wrapped(cfg) {
    var c = cfg && cfg.type === 'custom:hk-grid-card' && Array.isArray(cfg.cards) && cfg.cards.length === 1 ? cfg.cards[0] : null;
    return c && c.entity && ownPlace(placeOf(c)) ? c : null;
  }
  var offersOwn = function (view) { return claims(view, ownPlace); };
  function pageOrderSaves(groups, page) {
    if (!groups.some(function (g) { return g.moved(); })) return [];
    var A = setting('accessories', null), saved = A && A.pages && Array.isArray(A.pages[page]) ? A.pages[page] : [];
    return [{ doc: 'accessories', label: OWN[page] + ' order',
              msg: { type: DOMAIN + '/accessory/page_order', page: page,
                     entities: slotted(saved, concat(groups, 'initial'), concat(groups, 'ids')) } }];
  }
  function enterOwn(ctx) {
    var H = E(), parts = [];
    // the cards in grids of their own (Vacuums): those grids move, and are
    // never a group of their own
    var boxed = H.pillGroups(ctx, function (p, cfg) { return !!wrapped(cfg); }, {
      sizable: function () { return false; },
      idOf: function (el) { var c = wrapped(el && el._config); return c ? c.entity : null; }
    });
    boxed.forEach(function (g) { ctx.taken = ctx.taken.concat(g.members); });
    // the pills (Security's locks and garage doors): no size, it ignores it
    var pills = H.pillGroups(ctx, function (p) { return ownPlace(p); }, { sizable: function () { return false; } });
    var byPage = {};
    pills.forEach(function (g) { (byPage[g.place.page] = byPage[g.place.page] || []).push(g); });
    boxed.forEach(function (g) {
      var c = wrapped(g.members[0]._config);
      var k = placeOf(c).page;
      (byPage[k] = byPage[k] || []).push(g);
    });
    Object.keys(byPage).forEach(function (page) {
      var gs = byPage[page];
      parts.push(pillsPart(gs, function () { return pageOrderSaves(gs, page); }));
    });
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : {
      saves: function () { return parts.reduce(function (o, p) { return o.concat(p.saves()); }, []); },
      dirty: function () { return parts.some(function (p) { return p.dirty(); }); },
      restore: function () { parts.forEach(function (p) { p.restore(); }); },
      leave: function () { parts.forEach(function (p) { p.leave(); }); }
    };
  }

  // ------------------------------------------------------------ Favorites
  function favPlace(p) { return !!(p && p.fav); }
  var offersFav = function (view) { return claims(view, favPlace); };
  function enterFav(ctx) {
    var H = E(), groups = H.pillGroups(ctx, function (p) { return favPlace(p); }, { sizable: function () { return false; } });
    if (!groups.length) return null;
    return pillsPart(groups, function () {
      if (!groups.some(function (g) { return g.moved(); })) return [];
      var favs = Array.isArray(board(ctx.dash).favorites) ? board(ctx.dash).favorites : [];
      return [{ doc: 'board/' + ctx.dash, label: 'Favorites',
                msg: { type: DOMAIN + '/board/set', dashboard: ctx.dash,
                       changes: { favorites: slotted(favs, concat(groups, 'initial'), concat(groups, 'ids')) } } }];
    });
  }

  // ------------------------------------------------------------ scenes rows
  function isScenes(c) { return c && c.type === 'custom:hk-scenes-card'; }
  var offersScenes = function (view) {
    return !!view && anyCard(view.cards, function (c) {
      return isScenes(c) && (!c.room || (Array.isArray(c.scenes) && c.scenes.length > 0)) && c.show !== false;
    });
  };
  // every element under `root` (through shadow roots) `pred` takes, in page order
  function findAll(root, pred, stopAt) {
    var out = [], n = 0;
    (function walk(el) {
      if (!el || ++n > 40000) return;
      if (pred(el)) { out.push(el); if (stopAt) return; }
      var kids = el.children || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
      if (el.shadowRoot) walk(el.shadowRoot);
    })(root);
    return out;
  }
  function isRowCard(el) { return !!(el && el._config && Array.isArray(el._config.cards) && Array.isArray(el._children) && (el._root || el.shadowRoot)); }
  function scrollerOf(rc) {
    var r = rc._root || rc.shadowRoot, kids = (r && r.children) || [];
    for (var i = 0; i < kids.length; i++) if (kids[i].classList && kids[i].classList.contains('row')) return kids[i];
    return null;
  }
  // what HK Settings saves for a list of scenes and page pills
  // (hk-settings-model.js scenesSave, which the dashboard does not load: the
  // same rule, and tests/test_edit_pages.js holds the two together)
  function scenesSave(values) {
    return { scenes: values,
             scenes_pages: values.filter(function (x) { return typeof x === 'string' && x.indexOf(PAGE_TOKEN) === 0; })
               .map(function (x) { return x.slice(PAGE_TOKEN.length); }) };
  }
  // HOME'S LIST as its row plans it (hk-chip.js scenesPlan): the screen's
  // scenes, else the card's own, else every scene A to Z; a page pill only
  // when the screen has it (scenes_pages), one not placed after the rest
  function homeList(cfg, b, h) {
    var sp = Array.isArray(b.scenes_pages) ? b.scenes_pages : [];
    var ids = (Array.isArray(b.scenes) && b.scenes.length) ? b.scenes
            : (Array.isArray(cfg.scenes) && cfg.scenes.length) ? cfg.scenes : null;
    if (!ids) {
      var st = (h && h.states) || {}, ents = (h && h.entities) || {};
      ids = Object.keys(st).filter(function (id) {
        return id.indexOf('scene.') === 0 && !(ents[id] && (ents[id].hidden || ents[id].entity_category));
      }).sort(function (x, y) {
        return String(st[x].attributes.friendly_name || x).localeCompare(String(st[y].attributes.friendly_name || y));
      });
    }
    var out = ids.filter(function (id) {
      return typeof id !== 'string' || id.indexOf(PAGE_TOKEN) !== 0 || sp.indexOf(id.slice(PAGE_TOKEN.length)) >= 0;
    });
    sp.forEach(function (k) { if (out.indexOf(PAGE_TOKEN + k) < 0) out.push(PAGE_TOKEN + k); });
    return out;
  }
  // A ROOM'S LIST: its areas' own lists (the first's, then what the others
  // add), else the row it shows (Automatic: every scene in the room)
  function roomList(cfg, areas) {
    var A = setting('accessories', null), own = (A && A.scenes && typeof A.scenes === 'object') ? A.scenes : {};
    var mine = areas.filter(function (a) { return Array.isArray(own[a]); }), out = [];
    mine.forEach(function (a) { own[a].forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); }); });
    return { list: mine.length ? out : (cfg.scenes || []).slice(), area: mine[0] || areas[0] || null };
  }
  // what a pill in the row stands for: its scene, "page:<kind>" for a page
  // pill (matched by the page it opens), else the entry itself (a whole card)
  function keyOf(pill, pages) {
    var c = pill || {}, nav = c.tap_action && c.tap_action.action === 'navigate' ? c.tap_action.navigation_path : null;
    if (c.entity && !nav) return c.entity;
    if (nav) {
      var CH = global.hkChip && global.hkChip.scenes;
      for (var i = 0; i < pages.length; i++) {
        var pp = CH && CH.page ? CH.page(pages[i]) : null;
        if (pp && pp.tap_action && pp.tap_action.navigation_path === nav) return PAGE_TOKEN + pages[i];
      }
    }
    return c.entity || c;
  }

  // the row's own rules while editing, in the row card's shadow root
  function rowCss() {
    return '.row.hk-editing{cursor:default;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
      '.row.hk-editing>[data-hk-edit]{animation:hk-edit-wiggle .26s ease-in-out infinite alternate;' +
      'animation-delay:calc(var(--hk-edit-i,0) * -.07s);cursor:grab;-webkit-tap-highlight-color:transparent}' +
      '.row.hk-editing>[data-hk-edit].hk-carried{animation:none;z-index:5;position:relative;cursor:grabbing;' +
      'filter:drop-shadow(0 14px 22px rgba(0,0,0,.28))}' +
      '@keyframes hk-edit-wiggle{from{rotate:-.5deg}to{rotate:.5deg}}' +
      // Reduce Motion: still, and framed as a grid's pills are (hkEdit.addFrame)
      '.row.hk-editing.hk-still>[data-hk-edit]{animation:none}' +
      '@media (prefers-reduced-motion:reduce){.row.hk-editing>[data-hk-edit]{animation:none}}';
  }

  // ONE SCENES ROW, dragged within itself, sideways
  function Row(rc, row, keys) {
    var self = this;
    this.rc = rc; this.row = row;
    this.members = rc._children.filter(function (el) { return el && el.parentNode === row; });
    this.keys = this.members.map(function (el) { return keys[rc._children.indexOf(el)]; });
    this.order0 = [].slice.call(row.children || []);
    this.initial = this.ids();
    this.press = null; this.carry = null;
    var d = doc(), sr = rc._root || rc.shadowRoot;
    this.css = d.createElement('style');
    this.css.textContent = rowCss();
    if (sr) sr.appendChild(this.css);
    row.classList.add('hk-editing');
    var still = !motionOn(), H = E();
    row.classList.toggle('hk-still', still);
    row.setAttribute('data-hk-control', '');
    this.members.forEach(function (t, i) {
      t.setAttribute('data-hk-edit', '');
      t.style.setProperty('--hk-edit-i', String(i % 5));
      if (still && H && H.addFrame) H.addFrame(t);
    });
    this.on = {
      pointerdown: function (e) { self.down(e); },
      click: function (e) { if (self.hit(e)) { e.stopPropagation(); e.preventDefault(); } },
      contextmenu: function (e) { e.stopPropagation(); e.preventDefault(); },
      keydown: function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && self.hit(e)) { e.stopPropagation(); e.preventDefault(); }
      },
      touchmove: function (e) { if (self.carry) e.preventDefault(); }
    };
    ['pointerdown', 'click', 'contextmenu', 'keydown'].forEach(function (t) { row.addEventListener(t, self.on[t], true); });
    row.addEventListener('touchmove', this.on.touchmove, { passive: false });
  }
  Row.prototype.tiles = function () {
    var m = this.members;
    return [].filter.call(this.row.children || [], function (c) { return m.indexOf(c) >= 0; });
  };
  Row.prototype.key = function (el) { return this.keys[this.members.indexOf(el)]; };
  Row.prototype.ids = function () { var self = this; return this.tiles().map(function (t) { return self.key(t); }); };
  Row.prototype.moved = function () {
    var a = this.ids(), b = this.initial;
    return a.length !== b.length || a.some(function (x, i) { return x !== b[i]; });
  };
  Row.prototype.hit = function (e) {
    var path = e && e.composedPath ? e.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      if (path[i] && path[i].parentNode === this.row && this.members.indexOf(path[i]) >= 0) return path[i];
    }
    return null;
  };
  Row.prototype.down = function (e) {
    var s = E() && E().active();
    if (!s) return;
    // the row's own mouse drag-scroll (hk-row.js) never hears it, nor the pill
    if (e.stopImmediatePropagation) e.stopImmediatePropagation(); else e.stopPropagation();
    var tile = this.hit(e);
    if (!tile) return;
    if (e.pointerType === 'mouse' && e.preventDefault) e.preventDefault();
    if (s.saving || this.carry) return;
    var D = global.hkDrag, self = this;
    if (!D || !D.press) return;
    // (where it was pressed: the pill keeps that spot under the pointer,
    // though a mouse lifts it only 5 px on)
    this.x0 = this.at(e);
    this.press = D.press(this.row, e, {
      hold: E()._.HOLD_MS, lifted: null,
      lift: function (ev) { return self.lift(tile, ev); },
      tap: function () { self.press = null; },
      cancel: function () { self.press = null; }
    });
  };
  // where the pointer is along the row's content (scrolled or not)
  Row.prototype.at = function (ev) { return ev.clientX - rect(this.row).left + (this.row.scrollLeft || 0); };
  Row.prototype.lift = function (tile, ev) {
    if (this.carry || !(E() && E().active())) return false;
    this.press = null;
    var self = this, o = rect(this.row), sl = this.row.scrollLeft || 0;
    var items = this.tiles().map(function (t) { var r = rect(t); return { el: t, left: r.left - o.left + sl, width: r.width }; });
    var i = -1;
    items.forEach(function (it, k) { if (it.el === tile) i = k; });
    if (i < 0) return false;
    // one place along: the pill's width and the gap after it
    var gap = items.length > 1 ? Math.max(0, items[1].left - items[0].left - items[0].width) : 0;
    var c = this.carry = { tile: tile, items: items, i: i, to: i, x0: this.at(ev), step: items[i].width + gap, last: ev, raf: 0, dx: 0 };
    if (this.x0 != null) c.x0 = this.x0;
    tile.style.transition = 'none';
    tile.classList.add('hk-carried');
    this.row.classList.add('hk-carrying');
    items.forEach(function (it) { if (it.el !== tile) it.el.style.transition = 'transform ' + SETTLE + ' ' + ease(); });
    c.move = function (e) { self.move(e); };
    c.up = function () { self.drop(); };
    this.row.addEventListener('pointermove', c.move);
    this.row.addEventListener('pointerup', c.up);
    this.row.addEventListener('pointercancel', c.up);
    this.place();
    return true;
  };
  // the carried pill under the pointer, the others aside (dragger(), sideways)
  Row.prototype.place = function () {
    var c = this.carry;
    if (!c) return;
    var dx = c.dx = this.at(c.last) - c.x0, items = c.items, i = c.i;
    c.tile.style.transform = 'translateX(' + dx + 'px) scale(1.04)';
    var mid = function (k) { return items[k].left + items[k].width / 2; };
    var x = mid(i) + dx, to = i, k;
    for (k = 0; k < i; k++) if (x < mid(k)) { to = k; break; }
    for (k = items.length - 1; k > i; k--) if (x > mid(k)) { to = k; break; }
    c.to = to;
    items.forEach(function (it, k2) {
      if (k2 === i) return;
      var shift = (i < k2 && k2 <= to) ? -c.step : (to <= k2 && k2 < i) ? c.step : 0;
      it.el.style.transform = shift ? 'translateX(' + shift + 'px)' : '';
    });
  };
  Row.prototype.speed = function (x) {
    var o = rect(this.row), right = o.left + o.width;
    if (x < o.left + EDGE) return -Math.ceil(SPEED * Math.min(1, (o.left + EDGE - x) / EDGE));
    if (x > right - EDGE) return Math.ceil(SPEED * Math.min(1, (x - (right - EDGE)) / EDGE));
    return 0;
  };
  Row.prototype.move = function (ev) {
    var c = this.carry, self = this;
    if (!c) return;
    c.last = ev;
    this.place();
    if (this.speed(ev.clientX) && !c.raf) c.raf = raf(function () { self.tick(); });
  };
  // NEAR AN END, the row scrolls under the carried pill, faster nearer it
  Row.prototype.tick = function () {
    var c = this.carry, self = this;
    if (!c) return;
    c.raf = 0;
    var sp = this.speed(c.last.clientX);
    if (!sp) return;
    var was = this.row.scrollLeft || 0;
    this.row.scrollLeft = Math.max(0, was + sp);
    if ((this.row.scrollLeft || 0) === was) return;      // at the end
    this.place();
    c.raf = raf(function () { self.tick(); });
  };
  Row.prototype.drop = function () {
    var c = this.carry, row = this.row;
    if (!c) return;
    this.carry = null;
    if (c.raf) unraf(c.raf);
    row.removeEventListener('pointermove', c.move);
    row.removeEventListener('pointerup', c.up);
    row.removeEventListener('pointercancel', c.up);
    var t = c.tile, o = rect(row), from = c.items[c.i].left + c.dx;
    // the others are already where they go: in place, unmoved
    c.items.forEach(function (it) { if (it.el !== t) { it.el.style.transition = 'none'; it.el.style.transform = ''; } });
    if (c.to !== c.i) {
      var list = this.tiles(), ref = list[c.to];
      if (c.to > c.i) row.insertBefore(t, ref.nextSibling); else row.insertBefore(t, ref);
    }
    t.classList.remove('hk-carried');
    row.classList.remove('hk-carrying');
    // ...and the carried one glides from where it was let go
    var now = rect(t).left - o.left + (row.scrollLeft || 0);
    t.style.transition = 'none';
    t.style.transform = 'translateX(' + (from - now) + 'px)';
    void row.offsetWidth;
    raf(function () { t.style.transition = 'transform ' + SETTLE + ' ' + ease(); t.style.transform = ''; });
  };
  Row.prototype.restore = function () {
    var row = this.row;
    if (this.carry) this.drop();
    this.order0.forEach(function (el) { if (el.parentNode === row) row.appendChild(el); });
    this.members.forEach(function (t) { t.style.transform = ''; t.style.transition = ''; });
  };
  Row.prototype.leave = function () {
    var self = this, row = this.row;
    if (this.press) { try { this.press.stop(); } catch (e) { /* done */ } this.press = null; }
    if (this.carry) this.drop();
    ['pointerdown', 'click', 'contextmenu', 'keydown'].forEach(function (t) { row.removeEventListener(t, self.on[t], true); });
    row.removeEventListener('touchmove', this.on.touchmove, { passive: false });
    row.classList.remove('hk-editing'); row.classList.remove('hk-still'); row.classList.remove('hk-carrying');
    row.removeAttribute('data-hk-control');
    if (this.css && this.css.parentNode) this.css.parentNode.removeChild(this.css);
    var H = E();
    this.members.forEach(function (t) {
      if (H && H.dropFrame) H.dropFrame(t);
      t.removeAttribute('data-hk-edit');
      t.classList.remove('hk-carried');
      t.style.removeProperty('--hk-edit-i');
      t.style.transform = ''; t.style.transition = '';
    });
  };
  // THE LIST SAVED: the whole list with the shown ones in their new order.
  // An entry that is a whole card goes as a token and comes back as itself.
  function rowList(full, r) {
    var objs = [], tok = function (x) {
      if (typeof x === 'string') return x;
      var i = objs.indexOf(x);
      if (i < 0) { objs.push(x); i = objs.length - 1; }
      return '\u0000' + i;
    };
    var out = slotted(full.map(tok), r.initial.map(tok), r.ids().map(tok));
    return out.map(function (x) { return x.charAt(0) === '\u0000' ? objs[+x.slice(1)] : x; });
  }
  function enterScenes(ctx) {
    var rows = [];
    findAll(ctx.viewEl, function (el) { return el && el.localName === 'hk-scenes-card' && !!el._cfgIn; }, true).forEach(function (card) {
      var rc = findAll(card, isRowCard, true)[0], row = rc && scrollerOf(rc);
      if (!row) return;
      var cfg = card._cfgIn || {}, room = !!cfg.room, b = room ? {} : board(ctx.dash);
      var pages = room ? [] : (Array.isArray(b.scenes_pages) ? b.scenes_pages : []);
      var keys = rc._config.cards.map(function (c) { return keyOf(c, pages); });
      var r = new Row(rc, row, keys);
      if (!r.members.length) { r.leave(); return; }
      if (room) {
        var areas = [].concat(ctx.view && ctx.view.area || []).filter(Boolean), rl = roomList(cfg, areas);
        r.save = function () {
          if (!rl.area || !r.moved()) return [];
          return [{ doc: 'accessories', label: 'Scenes', msg: { type: DOMAIN + '/accessory/room_scenes', area_id: rl.area, entities: rowList(rl.list, r) } }];
        };
      } else {
        var full = homeList(cfg, b, ctx.h);
        r.save = function () {
          if (!r.moved()) return [];
          return [{ doc: 'board/' + ctx.dash, label: 'Scenes',
                    msg: { type: DOMAIN + '/board/set', dashboard: ctx.dash, changes: scenesSave(rowList(full, r)) } }];
        };
      }
      rows.push(r);
    });
    if (!rows.length) return null;
    return {
      rows: rows,
      saves: function () { return rows.reduce(function (o, r) { return o.concat(r.save()); }, []); },
      dirty: function () { return rows.some(function (r) { return r.moved(); }); },
      restore: function () { rows.forEach(function (r) { r.restore(); }); },
      leave: function () { rows.forEach(function (r) { r.leave(); }); }
    };
  }

  // ------------------------------------------------------------ registering
  var SPECS = [
    { id: 'category-rooms', offers: offersCat, enter: enterCat },
    { id: 'page-order', offers: offersOwn, enter: enterOwn },
    { id: 'favorites', offers: offersFav, enter: enterFav },
    { id: 'scenes-row', offers: offersScenes, enter: enterScenes }
  ];
  var done = false, tries = 0;
  function register() {
    var H = E();
    if (done) return true;
    if (!H || typeof H.surface !== 'function' || !H._) return false;
    done = true;
    SPECS.forEach(function (s) { H.surface(s); });
    return true;
  }
  // hk-edit.js loads beside this one, in either order
  (function wait() {
    if (register() || ++tries > 400) return;
    setTimeout(wait, 25);
  })();

  global.hkEditPages = {
    version: '1.0.0',
    register: register,
    _: { offers: { category: offersCat, own: offersOwn, favorites: offersFav, scenes: offersScenes },
         homeList: homeList, roomList: roomList, keyOf: keyOf, scenesSave: scenesSave, rowList: rowList, Row: Row }
  };
})(typeof window !== 'undefined' ? window : globalThis);
