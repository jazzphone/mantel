// hk-edit-menu.js - EDIT MODE'S MENU, TAB BAR AND ROOM ORDER (the plan "Edit
// pages in place", phase G, 2026-10-26). In Edit mode the side menu, the tab
// bar and its More sheet arrange the SAME lists, so a change in one shows in
// all three at once:
//   the page order       `pages` (kinds and custom page addresses; empty: the
//                        generated order) -- the order of the menu's top
//                        pages and Categories alike, and of the tab bar
//   the top of the menu  `menu_top` (view paths; empty: the views' own
//                        `menu: top`; ['-']: none)
//   Categories           `categories` (view paths; empty: the chips' pages,
//                        or every page) -- a page's Hide switch
//   the rooms            `room_order` (areas) and `menu_rooms` ('order')
// Nothing new is stored: these are the screen's settings (hk_core
// settings/model.py), saved on Done in ONE board/set with the screen's
// version. The rooms are All Screens' unless the screen keeps its own
// (`rooms_custom`): then the room order goes to All Screens (settings/set
// rooms.order / rooms.menu, with panel/get's versions["house"]), as HK
// Settings' Rooms would save it.
//
// THE PREVIEW: hkCards.menu.board() -- what the menu, the tab bar and Home's
// room sections (hk-layout.js roomOrder) read -- answers with the edit laid
// over the screen's own settings while Edit lasts, and after Done until the
// feed brings the saved settings. The menu and the tab bar draw again on the
// `hk-edit` event.
//
// THE PIECES
//   surface 'menu'      hkEdit's surface: never makes a page editable by
//                       itself (offers() is false), but joins every Edit
//                       session with a part: saves() / restore() / leave()
//   button 'menu-rooms' "Rooms" in the Edit bar: the Room Order sheet
//                       (HK Settings' list: drag, Move Up / Down, A to Z, a
//                       note on where the order applies)
//   on()                Edit mode is on with this part (the menu and the tab
//                       bar draw their edit rows)
//   model()             the menu's list as it is being arranged
//   hidden()            pages that could be in the menu but are not
//   movable(it)         a menu item that has a place in the page order
//   menuMove(path, sec, i) / hide(path) / show(path)       the side menu
//   tabMove(path, i) / toMore(path, V) / forward(path, i, V) / moreMove(path, i, V)
//                                                           the tab bar and More
//                       (V: the category tabs on the bar)
//   roomMove(from, to), roomsApply(order)                   the rooms
//   wireList(list, o) / wireBar(o)   the drags (hkDrag presses) for hk-menu.js
//                       and hk-tabbar.js
// Every path is a VIEW path ('weather', 'room-den'), as menu_top and
// categories hold them.
//
// Loaded by hk-loader.js in both hosts, after hk-edit.js (but in parallel:
// it registers with hkEdit whenever that is there).
(function (global) {
  'use strict';
  if (global.hkEditMenu) return;

  var DOMAIN = 'hk_frontend';
  var KEEP_MS = 20000;             // a saved arrangement stays shown this long at most, waiting for the feed
  var HOLD_MS = 250;               // a finger held this long picks a tab or a row up (Edit mode's)

  // hk-strategy.js's page kinds (settings/model.py PAGE_KINDS) and their view paths
  var KIND_PATH = { weather: 'weather', calendar: 'calendar', cameras: 'cameras', live_tv: 'live-tv', security: 'security',
                    doors_windows: 'doors-windows', climate: 'climate', lights: 'lights', timers: 'timers',
                    vacuums: 'vacuums', music: 'playmusic', water: 'water', energy: 'energy', power: 'power' };
  var PAGE_KINDS = ['weather', 'calendar', 'cameras', 'live_tv', 'security', 'doors_windows', 'climate', 'lights', 'timers',
                    'vacuums', 'music', 'water', 'energy', 'power', 'rooms'];

  function cards() { return global.hkCards || null; }
  function menuState() { var C = cards(); return (C && C.menu) || null; }
  function H() { return (global.hkMenu && global.hkMenu._) || null; }
  function edit() { return global.hkEdit || null; }
  function doc() { return global.document; }
  function J(v) { return JSON.stringify(v === undefined ? null : v); }

  // ------------------------------------------------------------ the lists
  function vp(it) { var p = it && it.paths; return p ? String(p[1] != null ? p[1] : p[0]) : ''; }
  function same(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
  function sameSet(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; }); }
  function moveVal(list, from, to) { var v = list.slice(), m = v.splice(from, 1)[0]; v.splice(to, 0, m); return v; }
  function without(list, x) { return list.filter(function (y) { return y !== x; }); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  // the slots `shown` held in `full` refilled in shown's order; the rest stay
  function fillSlots(full, shown) {
    var set = {}, k = 0;
    shown.forEach(function (id) { set[id] = 1; });
    return full.map(function (id) { return set[id] ? shown[k++] : id; });
  }
  // a view path's place in the page order: its kind, or a custom page's address
  function keyOf(path, b) {
    for (var k in KIND_PATH) if (KIND_PATH[k] === path) return k;
    var cp = (b && b.custom_pages) || [], pg = (b && b.pages) || [];
    return cp.indexOf(path) >= 0 || (pg.indexOf(path) >= 0 && path !== 'browse' && path !== 'rooms') ? path : null;
  }
  function beforeRooms(list, k) { var r = list.indexOf('rooms'); list.splice(r >= 0 ? r : list.length, 0, k); }
  // the page order written down: as chosen, or the generated order
  // (hk-strategy.js), each custom page before the rooms as it is shown
  function fullPages(b) {
    var pages = ((b && b.pages) || []).filter(function (k) { return k !== 'browse'; });
    var out = pages.length ? pages.slice() : PAGE_KINDS.slice();
    ((b && b.custom_pages) || []).forEach(function (k) { if (out.indexOf(k) < 0) beforeRooms(out, k); });
    return out;
  }
  function modelOf(ctx, b) {
    var M = H();
    if (!M || !ctx || !ctx.cfg) return { home: null, top: [], categories: [], rooms: [] };
    return M.model(ctx.cfg, ctx.areas, { dash: ctx.dash, order: b.menu_rooms === 'order' ? 'order' : 'az',
                                         roomOrder: b.room_order, user: ctx.user, categories: b.categories,
                                         top: b.menu_top, chips: b.chips, chipsRow: b.chips_row,
                                         pageOrder: M.pagePaths(b.pages, b.custom_pages), ha: false });
  }
  function lists(m) { return { top: m.top.map(vp), cats: m.categories.map(vp) }; }
  function eff(b, p) { return Object.assign({}, b, p || {}); }

  // THE MENU AS `newTop` / `newCats` (view paths, in order): the fewest
  // settings that say it. The top as it is, else the views' own, else
  // written down; Categories as it is, else written down (never empty: that
  // is "automatic"); then the page order, only where the order differs.
  // null: it cannot be said.
  function place(ctx, b, newTop, newCats) {
    var cur = lists(modelOf(ctx, b));
    if (same(cur.top, newTop) && same(cur.cats, newCats)) return {};
    var tops = [undefined, [], newTop.length ? newTop.slice() : ['-']];
    var catsC = [undefined].concat(newCats.length ? [newCats.slice()] : []);
    var pick = null;
    for (var i = 0; i < tops.length && !pick; i++) {
      for (var j = 0; j < catsC.length && !pick; j++) {
        var p = {};
        if (tops[i] !== undefined) p.menu_top = tops[i];
        if (catsC[j] !== undefined) p.categories = catsC[j];
        var l = lists(modelOf(ctx, eff(b, p)));
        if (sameSet(l.top, newTop) && sameSet(l.cats, newCats)) pick = p;
      }
    }
    if (!pick) return null;
    var l2 = lists(modelOf(ctx, eff(b, pick)));
    if (!(same(l2.top, newTop) && same(l2.cats, newCats))) {
      var keys = [];
      newTop.concat(newCats).forEach(function (p) { var k = keyOf(p, b); if (k && keys.indexOf(k) < 0) keys.push(k); });
      var full = fullPages(b);
      keys.forEach(function (k) { if (full.indexOf(k) < 0) beforeRooms(full, k); });
      pick.pages = fillSlots(full, keys);
    }
    Object.keys(pick).forEach(function (k) { if (J(pick[k]) === J(b[k] || [])) delete pick[k]; });
    return pick;
  }
  // a page to `sec` ('top' | 'categories') at `index` there
  function menuMove(ctx, b, path, sec, index) {
    var l = lists(modelOf(ctx, b));
    var top = without(l.top, path), cats = without(l.cats, path);
    var list = sec === 'top' ? top : cats;
    list.splice(clamp(index, 0, list.length), 0, path);
    return place(ctx, b, top, cats);
  }
  function hide(ctx, b, path) {
    var l = lists(modelOf(ctx, b));
    if (l.top.indexOf(path) < 0 && l.cats.indexOf(path) < 0) return {};
    var cats = without(l.cats, path);
    if (!cats.length) return null;
    return place(ctx, b, without(l.top, path), cats);
  }
  // shown again: under Categories, where the page order puts it
  function unhide(ctx, b, path) {
    var l = lists(modelOf(ctx, b)), full = fullPages(b);
    if (l.top.indexOf(path) >= 0 || l.cats.indexOf(path) >= 0) return {};
    var rank = function (p) { var k = keyOf(p, b), i = k ? full.indexOf(k) : -1; return i < 0 ? full.length : i; };
    var cats = l.cats.slice(), at = cats.length, r = rank(path);
    for (var i = 0; i < cats.length; i++) if (rank(cats[i]) > r) { at = i; break; }
    cats.splice(at, 0, path);
    return place(ctx, b, l.top, cats);
  }
  // the pages that could be in the menu and are not: titled, not a room's,
  // not another page's address (Browse Music), and this person's to see
  function hiddenOf(ctx, b) {
    var views = (ctx && ctx.cfg && ctx.cfg.views) || [], l = lists(modelOf(ctx, b)), out = [];
    views.forEach(function (v, i) {
      if (!i || !v || v.menu_follows || v.area || (v.strategy && v.strategy.area)) return;
      if (v.visible === false || (Array.isArray(v.visible) && !v.visible.some(function (u) { return u && (u.user === ctx.user || u === ctx.user); }))) return;
      var title = v.menu_title || v.title, path = String(v.path || i);
      if (!title || l.top.indexOf(path) >= 0 || l.cats.indexOf(path) >= 0) return;
      out.push({ title: title, icon: v.menu_icon || v.icon || 'mdi:view-dashboard-outline', path: path, hidden: true,
                 kind: 'hidden', paths: [String(i), v.path] });
    });
    return out;
  }

  // THE TAB BAR: Home, then the first V categories; More: the top pages,
  // then the categories past V, then the rooms
  function tabMove(ctx, b, path, j) { return menuMove(ctx, b, path, 'categories', j); }
  // a tab dropped on More: the first page past the fit (the first in More
  // comes forward); with nothing past it, More's top pages take it
  function toMore(ctx, b, path, V) {
    var l = lists(modelOf(ctx, b)), i = l.cats.indexOf(path);
    if (i < 0 || i >= V) return {};
    if (l.cats.length > V) {
      var cats = without(l.cats, path);
      cats.splice(V, 0, path);
      return place(ctx, b, l.top, cats);
    }
    return menuMove(ctx, b, path, 'top', l.top.length);
  }
  // a page in More dragged onto the bar at tab `j` (0: the first after Home);
  // past the last tab is the last place on the bar
  function forward(ctx, b, path, j, V) {
    var l = lists(modelOf(ctx, b));
    if (l.top.indexOf(path) < 0 && l.cats.indexOf(path) < 0) return null;
    var cats = without(l.cats, path);
    cats.splice(clamp(j, 0, Math.max(0, Math.min(V - 1, cats.length))), 0, path);
    return place(ctx, b, without(l.top, path), cats);
  }
  // More's own grid: its pages (the top, then past the fit) in a new order;
  // dropped among the top pages a page goes to the top, among the others to
  // Categories, on the line between them it stays where it was
  function moreMove(ctx, b, path, j, V) {
    var l = lists(modelOf(ctx, b));
    var wasTop = l.top.indexOf(path) >= 0, ci = l.cats.indexOf(path);
    if (!wasTop && (ci < 0 || ci < V)) return null;
    var top = without(l.top, path), vis = l.cats.slice(0, V).filter(function (p) { return p !== path; });
    var rest = l.cats.slice(V).filter(function (p) { return p !== path; });
    var t = top.length;
    j = clamp(j, 0, t + rest.length);
    var toTop = j < t || (j === t && wasTop);
    if (toTop) top.splice(j, 0, path); else rest.splice(j - t, 0, path);
    return place(ctx, b, top, vis.concat(rest));
  }

  // ------------------------------------------------------------ the rooms
  // the rooms on this screen as the Room Order sheet starts them: the room
  // order when there is one (Home's, even while the menu is A to Z), else
  // the menu's
  function roomItems(ctx, b) {
    return modelOf(ctx, (b.room_order || []).length ? eff(b, { menu_rooms: 'order' }) : b).rooms;
  }
  function onlyHome(b) { return b.home_rooms === 'only' && (b.room_order || []).length > 0; }
  function listedRoom(b, r) { return (r.areas || []).some(function (a) { return (b.room_order || []).indexOf(a) >= 0; }); }
  // the rooms in a new order -> {room_order, menu_rooms}: each room's areas in
  // turn (a combined room's together), taking the slots this screen's areas
  // held in the order (All Screens' order holds other screens' rooms too);
  // with Home showing only some rooms, only those are in it
  function roomsPatch(b, rooms) {
    var full = (b.room_order || []).slice(), flat = [], only = onlyHome(b);
    rooms.forEach(function (r) { (r.areas || []).forEach(function (a) { if (flat.indexOf(a) < 0) flat.push(a); }); });
    if (!only) flat.forEach(function (a) { if (full.indexOf(a) < 0) full.push(a); });
    var shown = flat.filter(function (a) { return full.indexOf(a) >= 0; });
    var out = { room_order: fillSlots(full, shown), menu_rooms: 'order' };
    if (J(out.room_order) === J(b.room_order || [])) delete out.room_order;
    if (b.menu_rooms === 'order') delete out.menu_rooms;
    return out;
  }
  function byTitle(x, y) { return String(x.title).localeCompare(String(y.title), undefined, { sensitivity: 'base' }); }
  // THE ROOM ORDER SHEET'S LIST (its drawing is openRooms below)
  function RoomSheet(ctx, b) {
    this.b = b;
    var all = roomItems(ctx, b), only = onlyHome(b);
    this.rows = only ? all.filter(function (r) { return listedRoom(b, r); }) : all;
    this.rest = only ? all.filter(function (r) { return !listedRoom(b, r); }) : [];
    this.touched = false;
  }
  RoomSheet.prototype.list = function () { return this.rows.slice(); };
  RoomSheet.prototype.others = function () { return this.rest.slice(); };
  RoomSheet.prototype.move = function (from, to) {
    if (from < 0 || from >= this.rows.length) return false;
    to = clamp(to, 0, this.rows.length - 1);
    this.touched = true;
    if (from === to) return false;
    this.rows = moveVal(this.rows, from, to);
    return true;
  };
  RoomSheet.prototype.up = function (i) { return i > 0 && this.move(i, i - 1); };
  RoomSheet.prototype.down = function (i) { return i < this.rows.length - 1 && this.move(i, i + 1); };
  RoomSheet.prototype.az = function () { this.touched = true; this.rows = this.rows.slice().sort(byTitle); };
  RoomSheet.prototype.set = function (rows) { this.touched = true; this.rows = rows.slice(); };
  RoomSheet.prototype.patch = function () { return this.touched ? roomsPatch(this.b, this.rows) : {}; };

  // WHERE THE ROOM ORDER APPLIES, said under the list
  function noteOf(b) {
    var home = b.home_rooms === 'order' || b.home_rooms === 'only', pages = b.page_rooms === 'order';
    var s = 'This order is the menu’s Rooms and the tab bar’s';
    if (home && pages) s += ', Home’s room sections, and the room sections on Lights, Climate, Water and the other pages that group by room.';
    else if (home) s += ', and Home’s room sections.';
    else if (pages) s += ', and the room sections on Lights, Climate, Water and the other pages that group by room.';
    else s += '.';
    if (!home) s += ' Home lists its rooms its own way (HK Settings → Rooms).';
    if (!pages) s += ' The pages that group by room keep them by floor.';
    s += b.rooms_custom ? ' It is this screen’s own room order.'
                        : ' It is All Screens’ room order: every screen whose Rooms are Same as All Screens follows it.';
    return s;
  }

  // ------------------------------------------------------------ the save
  // what Done sends for the edit `ov` over the screen's settings `base`
  function savesOf(base, ov, dash) {
    var ch = {}, room = {}, out = [];
    Object.keys(ov || {}).forEach(function (k) { if (J(ov[k]) !== J(base[k] === undefined ? (Array.isArray(ov[k]) ? [] : null) : base[k])) ch[k] = ov[k]; });
    ['room_order', 'menu_rooms'].forEach(function (k) { if (k in ch) { room[k] = ch[k]; delete ch[k]; } });
    if (Object.keys(room).length && base.rooms_custom) { Object.assign(ch, room); room = {}; }
    if (Object.keys(ch).length) {
      out.push({ doc: 'board/' + dash, label: 'Menu', msg: { type: DOMAIN + '/board/set', dashboard: dash, changes: ch } });
    }
    if (Object.keys(room).length) {
      var hc = {};
      if ('room_order' in room) hc['rooms.order'] = room.room_order;
      if ('menu_rooms' in room) hc['rooms.menu'] = room.menu_rooms;
      // with the house settings' version (panel/get's versions["house"]):
      // someone else's change to All Screens' rooms meanwhile is a conflict
      out.push({ doc: 'house', label: 'Room Order', msg: { type: DOMAIN + '/settings/set', changes: hc } });
    }
    return out;
  }

  // ------------------------------------------------------------ the session
  var S = { part: null, ctx: null, ov: {}, pending: null, restored: false, sheet: null, carry: null };
  function on() { return !!S.part; }
  // the screen's own settings, never the preview
  function base() {
    var M = menuState();
    if (!M || typeof M.board !== 'function') return {};
    return (M.board.orig ? M.board.orig.call(M) : M.board()) || {};
  }
  function overlay(b) {
    if (S.part) return S.ov;
    var p = S.pending;
    if (!p) return null;
    var now = Date.now();
    if (now - p.at > KEEP_MS || Object.keys(p.ov).every(function (k) { return J(b[k]) === J(p.ov[k]); })) { S.pending = null; return null; }
    return p.ov;
  }
  // hkCards.menu.board(), with the edit laid over it
  function wrapBoard() {
    var M = menuState();
    if (!M || typeof M.board !== 'function' || M.board.__hkEditMenu) return !!(M && M.board && M.board.__hkEditMenu);
    var orig = M.board;
    var w = function () {
      var b = orig.apply(M, arguments);
      var o = b && overlay(b);
      if (o) Object.keys(o).forEach(function (k) { b[k] = o[k]; });
      return b;
    };
    w.__hkEditMenu = true;
    w.orig = orig;
    M.board = w;
    return true;
  }
  function board() { var M = menuState(); return (M && M.board ? M.board() : null) || {}; }
  function model() { return modelOf(S.ctx || ctxNow(), board()); }
  function ctxNow() {
    var M = menuState(), C = cards(), h = C && C.client ? C.client() : null;
    return { cfg: M && M.config ? M.config() : null, areas: h && h.areas, dash: M && M.dash ? M.dash() : '',
             user: h && h.user && h.user.id };
  }
  // the edit so far, a patch more: shown at once
  function apply(patch) {
    if (!S.part || !patch) return false;
    var b0 = base(), ov = Object.assign({}, S.ov, patch);
    Object.keys(ov).forEach(function (k) { if (J(ov[k]) === J(b0[k] === undefined ? (Array.isArray(ov[k]) ? [] : null) : b0[k])) delete ov[k]; });
    S.ov = ov;
    preview(patch);
    return true;
  }
  function preview(patch) {
    try { win().dispatchEvent(new global.CustomEvent('hk-edit', { detail: { active: !!S.part, menu: true } })); } catch (e) { /* no window */ }
    try { if (global.hkMenu && global.hkMenu.rebuild) global.hkMenu.rebuild(); } catch (e) { /* not drawn */ }
    // Home's room sections follow the room order (hk-layout.js roomOrder)
    if (!patch || 'room_order' in patch || 'menu_rooms' in patch) {
      try {
        var SH = global.hkShell, hv = SH && SH.view ? SH.view() : null;
        if (hv && typeof hv._place === 'function') hv._place();
      } catch (e) { /* not a grid view */ }
    }
  }
  function win() { return global.window || global; }
  function changes() { return savesOf(base(), S.ov, (S.ctx && S.ctx.dash) || ''); }

  function act(fn) {
    return function () {
      if (!S.part) return false;
      var args = [S.ctx, board()].concat([].slice.call(arguments));
      return apply(fn.apply(null, args));
    };
  }
  // the same, on the session's lists: shown at once (true), or not (false)
  var A = { menuMove: act(menuMove), hide: act(hide), show: act(unhide), tabMove: act(tabMove), toMore: act(toMore),
            forward: act(forward), moreMove: act(moreMove) };
  function visibleCats() { var T = global.hkTabBar, st = T && T._ && T._.state ? T._.state() : null; return st && st.tabs ? Math.max(0, st.tabs.length - 1) : 0; }

  function enterPart(ctx) {
    var M = menuState();
    if (!M || !H() || typeof M.config !== 'function' || !M.config()) return null;
    wrapBoard();
    var h = ctx.h || {};
    S.ctx = { cfg: M.config(), areas: h.areas, dash: (M.dash && M.dash()) || ctx.dash || '', user: h.user && h.user.id };
    S.ov = {}; S.pending = null; S.restored = false;
    var m = modelOf(S.ctx, board());
    if (!m.top.length && !m.categories.length && !m.rooms.length) { S.ctx = null; return null; }
    var part = {
      menu: true,
      saves: function () { return changes(); },
      dirty: function () { return changes().length > 0; },
      restore: function () { S.restored = true; S.ov = {}; closeRooms(false); },
      leave: function () {
        closeRooms(false);
        if (!S.restored && Object.keys(S.ov).length) S.pending = { ov: S.ov, at: Date.now() };
        S.ov = {}; S.part = null; S.ctx = null;
        // (hkEdit tells the menu and the tab bar as it leaves; Home's sections:)
        preview({ room_order: 1 });
      }
    };
    S.part = part;
    return part;
  }
  function register() {
    var EE = edit();
    if (!EE || typeof EE.surface !== 'function') return false;
    if (EE.surfaces().indexOf('menu') >= 0) return true;
    EE.surface({ id: 'menu', offers: function () { return false; }, enter: enterPart });
    EE.button({ id: 'menu-rooms', label: 'Rooms', show: function () { return !!S.part && roomItems(S.ctx, board()).length > 1; },
                run: function (s) { openRooms(s); } });
    return true;
  }

  // ------------------------------------------------------------ dragging
  // ONE LIST DRAGGED ALONG ONE AXIS (the side menu's rows, the bar's tabs):
  // the carried one follows the pointer, the others slide aside -- the kit's
  // dragger() (hk-settings-kit.js), for any axis and with fixed rows (the
  // Categories heading) that slide too
  function slider(els, carried, axis) {
    var y = axis === 'y', idx = els.indexOf(carried);
    var boxes = els.map(function (el) { return el.getBoundingClientRect(); });
    var mids = boxes.map(function (r) { return y ? r.top + r.height / 2 : r.left + r.width / 2; });
    var cb = boxes[idx] || { width: 0, height: 0 };
    var gap = 0;
    if (els.length > 1) {
      var nb = boxes[idx + 1] || boxes[idx - 1];
      gap = nb ? Math.max(0, y ? (nb.top > cb.top ? nb.top - (cb.top + cb.height) : cb.top - (nb.top + nb.height))
                               : (nb.left > cb.left ? nb.left - (cb.left + cb.width) : cb.left - (nb.left + nb.width))) : 0;
    }
    var size = (y ? cb.height : cb.width) + gap, to = idx;
    els.forEach(function (el) { if (el !== carried) el.style.transition = 'transform .2s cubic-bezier(.32,.72,0,1)'; });
    return {
      move: function (d) {
        carried.style.transform = y ? 'translateY(' + d + 'px)' : 'translateX(' + d + 'px)';
        var c = mids[idx] + d;
        to = idx;
        for (var k = 0; k < els.length; k++) { if (k < idx && c < mids[k]) { to = k; break; } }
        for (var j = els.length - 1; j > idx; j--) { if (c > mids[j]) { to = j; break; } }
        els.forEach(function (el, k) {
          if (el === carried) return;
          var shift = (idx < k && k <= to) ? -size : (to <= k && k < idx) ? size : 0;
          el.style.transform = shift ? (y ? 'translateY(' + shift + 'px)' : 'translateX(' + shift + 'px)') : '';
        });
      },
      order: function () { return moveVal(els, idx, to); },
      moved: function () { return to !== idx; },
      clear: function () { els.forEach(function (el) { el.style.transform = ''; el.style.transition = ''; }); }
    };
  }
  function drag() { return global.hkDrag || null; }
  // a press that may pick something up: hkDrag's (a held finger or a moving
  // mouse; a finger along `axis` at once), then the carry's own moves
  function pressCarry(el, e, o) {
    var D = drag();
    if (!D || !S.part || S.carry) return;
    if (e.button !== undefined && e.button !== 0) return;
    D.press(el, e, {
      axis: o.axis || null, hold: o.hold || HOLD_MS, lifted: null,
      lift: function (ev) {
        if (!S.part || S.carry) return false;
        var c = o.lift(ev);
        if (!c) return false;
        S.carry = c;
        // (from where the press began: the thing has not moved since)
        var x0 = e.clientX, y0 = e.clientY;
        var mv = function (m) { if (S.carry === c) c.move(m, m.clientX - x0, m.clientY - y0); };
        var end = function (u, cancelled) {
          el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cx);
          if (S.carry !== c) return;
          S.carry = null;
          c.drop(u, cancelled);
        };
        var up = function (u) { end(u, false); };
        var cx = function (u) { end(u, true); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cx);
        c.move(ev, ev.clientX - x0, ev.clientY - y0);
        return true;
      },
      tap: o.tap, cancel: function () {}
    });
  }
  function holdStill(el) {
    var D = drag();
    if (!D || !el || el.__hkEditHold) return;
    el.__hkEditHold = true;
    D.holdStill(el, 'hk-carrying');
  }
  function inside(r, x, y, pad) { pad = pad || 0; return !!r && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad; }

  // THE SIDE MENU'S ROWS (hk-menu.js draws them in Edit mode): `list` holds
  //   .row.ed[data-p][data-sec="top"|"categories"|"rooms"]  (a page or a room)
  //   .sh.ed[data-sec="categories"]                          (the heading)
  // each with a .grip and a page's .sw (its Hide switch). o.rebuild() draws
  // the list again.
  function wireList(list, o) {
    if (!list || !S.part) return;
    holdStill(list);
    var q = function (sel) { return [].slice.call(list.querySelectorAll(sel)); };
    q('.row.ed').forEach(function (row) {
      var sw = row.querySelector('.sw'), grip = row.querySelector('.grip'), path = row.getAttribute('data-p');
      if (sw) sw.addEventListener('click', function (e) {
        e.stopPropagation();
        var did = row.getAttribute('data-hidden') !== null ? A.show(path) : A.hide(path);
        if (!did && o.say) o.say('Categories needs at least one page.');
      });
      if (!grip) return;
      grip.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (!d) return;
        e.preventDefault();
        if (step(row, d)) S.focus = path;
      });
      var start = function (e, axis) {
        if (e.target && e.target.closest && e.target.closest('.sw')) return;
        e.stopPropagation();
        pressCarry(axis ? grip : row, e, { axis: axis, lift: function () { return carryRow(list, row, o); } });
      };
      grip.addEventListener('pointerdown', function (e) { start(e, 'y'); });
      row.addEventListener('pointerdown', function (e) { if (!grip.contains(e.target)) start(e, null); });
    });
    if (S.focus) {
      var f = list.querySelector('.row.ed[data-p="' + S.focus + '"] .grip');
      S.focus = null;
      if (f) f.focus();
    }
  }
  function rowsOf(list, rooms) {
    return [].slice.call(list.querySelectorAll(rooms ? '.row.ed[data-sec="rooms"]'
      : '.row.ed[data-sec="top"][data-move],.sh.ed[data-sec="categories"],.row.ed[data-sec="categories"][data-move]'));
  }
  function carryRow(list, row, o) {
    var rooms = row.getAttribute('data-sec') === 'rooms';
    if (!rooms && row.getAttribute('data-move') === null) return null;
    var els = rowsOf(list, rooms), sl = slider(els, row, 'y'), s0 = list.scrollTop;
    row.classList.add('lifted');
    list.classList.add('hk-carrying');
    var lb = list.getBoundingClientRect(), raf = 0, lastY = null, lastD = 0;
    var tick = function () {
      raf = 0;
      if (S.carry === null || lastY === null) return;
      var v = lastY < lb.top + 40 ? -8 : lastY > lb.bottom - 40 ? 8 : 0;
      if (!v) return;
      list.scrollTop += v;
      sl.move(lastD + (list.scrollTop - s0));
      raf = (global.requestAnimationFrame || setTimeout)(tick, 16);
    };
    return {
      move: function (e, dx, dy) {
        lastY = e.clientY; lastD = dy;
        sl.move(dy + (list.scrollTop - s0));
        if (!raf) raf = (global.requestAnimationFrame || setTimeout)(tick, 16);
      },
      drop: function (e, cancelled) {
        var order = sl.order(), moved = sl.moved();
        sl.clear();
        row.classList.remove('lifted');
        list.classList.remove('hk-carrying');
        if (cancelled || !moved) return;
        var path = row.getAttribute('data-p');
        if (rooms) {
          roomsTo(order.map(function (el) { return el.getAttribute('data-p'); }));
          return;
        }
        var h = order.filter(function (el) { return el.classList.contains('sh'); })[0];
        var hi = h ? order.indexOf(h) : order.length, at = order.indexOf(row);
        var sec = at < hi ? 'top' : 'categories';
        var peers = order.filter(function (el, k) { return el !== h && (sec === 'top' ? k < hi : k > hi); });
        A.menuMove(path, sec, peers.indexOf(row));
      }
    };
  }
  // the arrow keys on a row's handle: one place up or down -- the first
  // category up is the last top page, and back
  function step(row, d) {
    var path = row.getAttribute('data-p'), sec = row.getAttribute('data-sec');
    if (sec === 'rooms') {
      var rs = roomItems(S.ctx, board()).map(function (r) { return r.path; }), i = rs.indexOf(path);
      if (i < 0 || i + d < 0 || i + d >= rs.length) return false;
      return roomsTo(moveVal(rs, i, i + d));
    }
    var l = lists(model()), top = l.top, cats = l.cats;
    if (sec === 'top') {
      var t = top.indexOf(path);
      if (d > 0 && t === top.length - 1) return A.menuMove(path, 'categories', 0);
      return t + d >= 0 && A.menuMove(path, 'top', t + d);
    }
    var c = cats.indexOf(path);
    if (d < 0 && c === 0) return A.menuMove(path, 'top', top.length);
    return c + d < cats.length && A.menuMove(path, 'categories', c + d);
  }
  // the rooms in a new order (room view paths)
  function roomsTo(paths) {
    if (!S.part) return false;
    var rs = new RoomSheet(S.ctx, board()), all = rs.list().concat(rs.others());
    var by = {};
    all.forEach(function (r) { by[r.path] = r; });
    var listed = rs.list().map(function (r) { return r.path; });
    rs.set(paths.map(function (p) { return by[p]; }).filter(function (r) { return r && listed.indexOf(r.path) >= 0; }));
    return apply(rs.patch());
  }

  // THE TAB BAR AND MORE (hk-tabbar.js, in Edit mode). o:
  //   pill        the bar's tabs' parent; tabs are .tab[data-p] (Home and
  //               More have none; More is [data-t="more"])
  //   sheet       More's sheet: pages .it[data-k="p"][data-p], rooms
  //               .it[data-k="r"][data-p]
  //   rail        the bar stands upright
  //   visible     the category tabs on the bar now
  //   root        where a carried page's ghost goes
  function wireBar(o) {
    if (!o || !o.pill || !S.part) return;
    var axis = o.rail ? 'y' : 'x';
    S.bar = o;
    [].slice.call(o.pill.querySelectorAll('.tab[data-p]')).forEach(function (tab) {
      // (the bar keeps its tabs when they are drawn the same: wired once)
      if (tab.__hkEditMenu) return;
      tab.__hkEditMenu = true;
      tab.addEventListener('pointerdown', function (e) {
        o = S.bar || o;
        e.stopPropagation();
        pressCarry(tab, e, { axis: axis, lift: function () { return carryTab(o, tab, axis); } });
      });
    });
    [o.sheet, o.roomsSheet].forEach(function (sheet) {
      if (!sheet) return;
      holdStill(sheet.querySelector('.body') || sheet);
      [].slice.call(sheet.querySelectorAll('.it[data-p]')).forEach(function (it) {
        if (it.__hkEditMenu) return;
        it.__hkEditMenu = true;
        it.addEventListener('pointerdown', function (e) {
          e.stopPropagation();
          pressCarry(it, e, { axis: null, lift: function () { return carryItem(o, it, sheet); } });
        });
      });
    });
  }
  function moreTab(o) { return o.pill.querySelector('.tab[data-t="more"]'); }
  function carryTab(o, tab, axis) {
    var tabs = [].slice.call(o.pill.querySelectorAll('.tab[data-p]'));
    var sl = slider(tabs, tab, axis), mt = moreTab(o), mr = mt ? mt.getBoundingClientRect() : null;
    var r0 = tab.getBoundingClientRect(), over = false;
    tab.classList.add('lifted');
    o.pill.classList.add('hk-carrying');
    return {
      move: function (e, dx, dy) {
        var cx = r0.left + r0.width / 2 + dx, cy = r0.top + r0.height / 2 + dy;
        over = inside(mr, cx, cy, 6) || (o.sheet && o.sheet.classList.contains('open') && inside(o.sheet.getBoundingClientRect(), e.clientX, e.clientY));
        if (mt) mt.classList.toggle('hk-drop', over);
        sl.move(axis === 'y' ? dy : dx);
      },
      drop: function (e, cancelled) {
        var order = sl.order(), moved = sl.moved();
        sl.clear();
        tab.classList.remove('lifted');
        o.pill.classList.remove('hk-carrying');
        if (mt) mt.classList.remove('hk-drop');
        if (cancelled) return;
        var path = tab.getAttribute('data-p');
        if (over) { A.toMore(path, o.visible); return; }
        if (moved) A.tabMove(path, order.indexOf(tab));
      }
    };
  }
  // a page or a room in More, carried as a ghost: onto the bar (pages), or
  // to another place in its own grid
  function carryItem(o, it, sheet) {
    var room = it.getAttribute('data-k') === 'r', path = it.getAttribute('data-p');
    var r0 = it.getBoundingClientRect(), d = doc(), body = sheet.querySelector('.body') || sheet;
    // the ghost: the page's icon and name in a capsule of its own (the
    // tab bar's .hk-ghost), over everything -- More clips what is in it
    var g = d.createElement('div'), ic = it.querySelector('hk-icon'), nm = it.querySelector('span');
    g.className = 'hk-ghost';
    if (ic) g.appendChild(ic.cloneNode(true));
    var t = d.createElement('span');
    t.textContent = nm ? nm.textContent : '';
    g.appendChild(t);
    var gx = function (x, y) { g.style.left = (x - 24) + 'px'; g.style.top = (y - 22) + 'px'; };
    (o.root || it.parentNode).appendChild(g);
    it.classList.add('lifted');
    body.classList.add('hk-carrying');
    var cells = [].slice.call(sheet.querySelectorAll(room ? '.it[data-k="r"][data-p]' : '.it[data-k="p"][data-p]'));
    var boxes = cells.map(function (c) { return c.getBoundingClientRect(); });
    var tabs = [].slice.call(o.pill.querySelectorAll('.tab[data-p]')).map(function (t) { return t.getBoundingClientRect(); });
    var pr = o.pill.getBoundingClientRect(), target = null, mark = null;
    var unmark = function () { if (mark) { mark.classList.remove('hk-drop'); mark = null; } };
    void r0;
    return {
      move: function (e) {
        var x = e.clientX, y = e.clientY;
        gx(x, y);
        unmark();
        target = null;
        if (!room && inside(pr, x, y, 8)) {
          // onto the bar: before the first tab whose middle is past the pointer
          var j = tabs.length;
          for (var k = 0; k < tabs.length; k++) {
            var mid = o.rail ? tabs[k].top + tabs[k].height / 2 : tabs[k].left + tabs[k].width / 2;
            if ((o.rail ? y : x) < mid) { j = k; break; }
          }
          target = { bar: j };
          o.pill.classList.add('hk-drop');
          return;
        }
        o.pill.classList.remove('hk-drop');
        for (var i = 0; i < boxes.length; i++) {
          if (inside(boxes[i], x, y)) { target = { at: i }; if (cells[i] !== it) { mark = cells[i]; mark.classList.add('hk-drop'); } break; }
        }
      },
      drop: function (e, cancelled) {
        if (g.parentNode) g.parentNode.removeChild(g);
        it.classList.remove('lifted');
        body.classList.remove('hk-carrying');
        unmark();
        o.pill.classList.remove('hk-drop');
        if (cancelled || !target) return;
        if (target.bar !== undefined) { A.forward(path, target.bar, o.visible); return; }
        var from = cells.indexOf(it);
        if (target.at === from) return;
        var paths = cells.map(function (c) { return c.getAttribute('data-p'); });
        if (room) { roomsTo(moveVal(paths, from, target.at)); return; }
        A.moreMove(path, target.at, o.visible);
      }
    };
  }

  // ------------------------------------------------------------ the Room Order sheet
  var KIT_URL = '/hk/panels/hk-settings-kit.js';
  function kit() {
    if (global.hkSettingsKit) return Promise.resolve(global.hkSettingsKit);
    return import(KIT_URL).then(function () { return global.hkSettingsKit; });
  }
  var UP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
  var DOWN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  function sheetCss() {
    return ':host{position:fixed!important;inset:0;z-index:12;height:auto!important;background:transparent!important;display:block}' +
      '.scrim{position:absolute;inset:0;background:rgba(0,0,0,.45)}' +
      '.pane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(540px,calc(100vw - 32px));' +
      'max-height:calc(100dvh - 48px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;' +
      'background:var(--hk-bg);border-radius:14px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.5)}' +
      '.nav{flex:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;min-height:52px;padding:0 8px;' +
      'border-bottom:.5px solid var(--hk-sep)}' +
      '.nav h2{margin:0;font-size:17px;font-weight:600;letter-spacing:-.41px}' +
      '.nav button{appearance:none;border:0;background:none;color:var(--hk-tint);font:inherit;font-size:17px;padding:10px 8px;min-height:44px;cursor:pointer}' +
      '.nav .ok{justify-self:end;font-weight:600}.nav .az{justify-self:start}' +
      '.body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:20px 16px 8px}' +
      '.mv{display:flex;gap:2px;margin-left:auto}' +
      '.mv button{appearance:none;border:0;background:none;color:var(--hk-tint);width:36px;height:36px;border-radius:18px;padding:0;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer}' +
      '.mv button[disabled]{color:var(--hk-label3);cursor:default}' +
      '.mv button:not([disabled]):active{background:var(--hk-press)}' +
      '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}';
  }
  function closeRooms(keep) {
    var sh = S.sheet;
    if (!sh) return;
    S.sheet = null;
    var w = win();
    w.removeEventListener('keydown', sh.onKey, true);
    if (sh.session && sh.session.asking === sh.host) sh.session.asking = null;
    if (sh.host && sh.host.parentNode) sh.host.parentNode.removeChild(sh.host);
    if (keep && S.part) apply(sh.rs.patch());
    if (sh.back && sh.back.focus) { try { sh.back.focus(); } catch (e) { /* gone */ } }
  }
  function openRooms(s) {
    if (!S.part || S.sheet) return Promise.resolve(false);
    var back = doc() && doc().activeElement;
    return kit().then(function (K) {
      if (!K || !S.part || S.sheet) return false;
      var d = doc(), host = d.createElement('div');
      host.id = 'hk-edit-rooms';
      var sr = host.attachShadow({ mode: 'open' });
      var h = s && s.h, dark = !(h && h.themes && h.themes.darkMode === false);
      if (dark) host.setAttribute('dark', '');
      var rs = new RoomSheet(S.ctx, board());
      var sh = { host: host, rs: rs, session: s, back: back };
      sr.innerHTML = '<style>' + K.CSS + sheetCss() + '</style><div class="scrim"></div>' +
        '<div class="pane" role="dialog" aria-modal="true" aria-labelledby="rt"><div class="nav">' +
        '<button class="az" type="button">A to Z</button><h2 id="rt">Room Order</h2><button class="ok" type="button">Done</button></div>' +
        '<div class="body"></div><div class="sr" aria-live="polite"></div></div>';
      var body = sr.querySelector('.body'), live = sr.querySelector('.sr');
      var say = function (t) { live.textContent = ''; setTimeout(function () { live.textContent = t; }, 30); };
      var draw = function (focusFk) {
        var rows = rs.list(), n = rows.length;
        while (body.firstChild) body.removeChild(body.firstChild);
        var mv = function (r, i) {
          var box = K.h('span', { class: 'mv' });
          [['Up', -1, UP], ['Down', 1, DOWN]].forEach(function (x) {
            var b = K.h('button', { type: 'button', 'aria-label': 'Move ' + r.title + ' ' + x[0], 'data-fk': 'mv:' + x[0] + ':' + r.path, html: x[2] });
            if ((x[1] < 0 && i === 0) || (x[1] > 0 && i === n - 1)) b.disabled = true;
            b.addEventListener('click', function () {
              if (rs.move(i, i + x[1])) { say(r.title + ', ' + (i + x[1] + 1) + ' of ' + n); draw('mv:' + x[0] + ':' + r.path); }
            });
            box.appendChild(b);
          });
          return box;
        };
        body.appendChild(K.listEditor({ fk: 'rooms', minRows: n, announce: say,
          shownHeader: onlyHome(rs.b) ? 'On Home' : 'Rooms',
          shownFooter: noteOf(rs.b),
          rows: rows.map(function (r, i) { return { value: r.path, label: r.title, icon: r.icon, control: mv(r, i) }; }),
          onChange: function (values) {
            rs.set(values.map(function (p) { return rows.filter(function (r) { return r.path === p; })[0]; }).filter(Boolean));
            draw(S.focusFk);
          } }));
        if (rs.others().length) {
          body.appendChild(K.group({ header: 'Not on Home', footer: 'These rooms aren’t on Home, so they follow the others in the menu.' },
            rs.others().map(function (r) { return K.info({ label: r.title, icon: r.icon }); })));
        }
        // a handle's arrow keys move the row: its focus comes back to it
        [].forEach.call(body.querySelectorAll('[data-fk^="rooms:grip:"]'), function (g) {
          g.addEventListener('keydown', function () { S.focusFk = g.getAttribute('data-fk'); });
          g.addEventListener('pointerdown', function () { S.focusFk = null; });
        });
        if (focusFk) {
          var f = body.querySelector('[data-fk="' + focusFk + '"]');
          if (f && f.disabled) f = f.parentNode.querySelector('button:not([disabled])');
          if (f) f.focus();
        }
      };
      draw();
      sr.querySelector('.az').addEventListener('click', function () { rs.az(); say('Sorted A to Z'); draw(); });
      sr.querySelector('.ok').addEventListener('click', function () { closeRooms(true); });
      sr.querySelector('.scrim').addEventListener('click', function () { closeRooms(true); });
      sh.onKey = function (e) {
        if (e.key !== 'Escape' || S.sheet !== sh) return;
        e.stopPropagation(); e.preventDefault();
        closeRooms(true);
      };
      win().addEventListener('keydown', sh.onKey, true);
      // (hkEdit's Escape is Cancel; while this is open it is this sheet's)
      host.setAttribute('data-open', '');
      if (s) s.asking = host;
      var SH = global.hkShell, root = null;
      try { root = SH && SH.dialogRoot ? SH.dialogRoot() : null; } catch (e) { root = null; }
      (root || d.body).appendChild(host);
      S.sheet = sh;
      var ok = sr.querySelector('.ok');
      if (ok && ok.focus) ok.focus();
      return true;
    }, function (err) {
      if (global.console) console.error('[hk-edit-menu] the Room Order sheet needs hk-settings-kit.js', err);
      return false;
    });
  }

  // ------------------------------------------------------------ public
  function roomMove(from, to) {
    if (!S.part) return false;
    var rs = new RoomSheet(S.ctx, board());
    rs.move(from, to);
    return apply(rs.patch());
  }
  function roomsApply(order) {
    if (!S.part) return false;
    var rs = new RoomSheet(S.ctx, board()), rows = rs.list();
    rs.set(order.map(function (i) { return rows[i]; }).filter(Boolean));
    return apply(rs.patch());
  }

  global.hkEditMenu = {
    version: '1.0.0',
    on: on, model: model, board: board,
    hidden: function () { return S.part ? hiddenOf(S.ctx, board()) : []; },
    movable: function (it) { return !!it && (it.kind === 'room' || !!keyOf(vp(it), board())); },
    menuMove: function (p, sec, i) { return A.menuMove(p, sec, i); }, hide: function (p) { return A.hide(p); },
    show: function (p) { return A.show(p); }, tabMove: function (p, i) { return A.tabMove(p, i); },
    toMore: function (p, V) { return A.toMore(p, V == null ? visibleCats() : V); },
    forward: function (p, i, V) { return A.forward(p, i, V == null ? visibleCats() : V); },
    moreMove: function (p, i, V) { return A.moreMove(p, i, V == null ? visibleCats() : V); },
    roomMove: roomMove, roomsApply: roomsApply, openRooms: function () { var EE = edit(); return openRooms(EE && EE.active()); },
    closeRooms: function () { closeRooms(true); },
    wireList: wireList, wireBar: wireBar, carrying: function () { return !!S.carry; },
    _: { keyOf: keyOf, fullPages: fullPages, fillSlots: fillSlots, modelOf: modelOf, lists: lists, place: place,
         menuMove: menuMove, hide: hide, unhide: unhide, hiddenOf: hiddenOf,
         tabMove: tabMove, toMore: toMore, forward: forward, moreMove: moreMove,
         roomItems: roomItems, roomsPatch: roomsPatch, RoomSheet: RoomSheet, noteOf: noteOf, savesOf: savesOf,
         slider: slider, state: function () { return S; }, PAGE_KINDS: PAGE_KINDS }
  };

  // hkCards and hkEdit load in parallel with this file: whichever is last
  if (!wrapBoard()) win().addEventListener('hk-cards-ready', function () { wrapBoard(); });
  if (!register()) {
    var tries = 0;
    var again = function () { if (register()) { win().removeEventListener('hk-edit', again); return; } if (++tries < 40) setTimeout(again, 250); };
    win().addEventListener('hk-edit', again);
    setTimeout(again, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
