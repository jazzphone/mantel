// hk-sidepane.js - THE SIDE PANE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md
// "Phase A2"): one pane per screen, of sections the person picks and orders,
// down one side of the Dashboard (Home only, or every page) and of the
// screensaver. HomeView has no such area; it is where HK can do more.
//
// WHAT IT IS MADE OF. Twelve sections (KINDS), each drawn for the pane -- not
// a page card squeezed in -- at four Sizes: Tiny (one line: its glyph, the
// fact and a value), Less (the gist), More (the whole section) and Full (More
// and then some, taking the room the pane has left; one at a time). Each
// reads the same data its page does (the weather entity and its forecast,
// the calendars, the screen's music, the alarm and locks, a camera's still,
// the quick timers, the house's power, the thermostats, person.*, a to-do
// list through hk_frontend/todo/items, the banners), so the Dashboard's pane
// and the screensaver's draw the same thing.
//
// THE SETTINGS are the screen's Side Pane as read (settings side_pane_read:
// each group the screen's own or All Screens', hk_core resolved()), from HK
// Settings -> Side Pane. Where (Pane Side, Width), On the Dashboard (Off,
// Home Only, Every Page, and its sections), In the Screensaver (Off, Same as
// the Dashboard, Its Own sections) and Show the Doorbell When It Rings.
//
// IT NEVER SCROLLS (fit): sections keep their Size while they fit; when they
// don't, sizes step down from the bottom (Full, More, Less, Tiny), then the
// last sections are left out and the pane's foot says how many ("+2 more").
// A section that is When There's Something shows only while it has something
// (music playing or paused within Hide After a Pause, a timer running, the
// alarm armed or a door open, a notification); a pane whose sections are all
// quiet steps aside -- Now Playing's old side pane exactly.
//
// THE ROOM IT TAKES (publish): its width on its side of <html>, as
// --hk-pane-l / --hk-pane-r and html[hk-pane], and the word 'hk-pane' --
// hk-menu.js narrows the page by it, hk-tabbar.js centres the bar beside it,
// the Home Grid lays itself in what is left (hk-layout.js). Beside a Home Grid
// that fills the height it takes what the grid leaves (444 px beside a 3 x 3 on
// a 1180 x 820 tablet); elsewhere its Width (Narrow 360, Standard 400, Wide
// 480). A tablet held upright gets a band under the page, its sections side
// by side (276 px; 198 on a narrower one); a phone never.
//
// Loaded by hk-loader.js; nothing happens at load but window.hkSidePane.
// The screensaver asks it for a pane of its own (hkSidePane.create('saver')).
(function () {
  'use strict';
  if (window.hkSidePane) return;

  // ------------------------------------------------------------ the sections
  // kind -> [name, glyph, color] (the settings page's rows wear the same)
  var KINDS = {
    clock: ['Clock', 'mdi:clock', '#8e8e93'], weather: ['Weather', 'mdi:weather-partly-cloudy', '#32ade6'],
    calendar: ['Calendar', 'mdi:calendar', '#ff3b30'], now_playing: ['Now Playing', 'mdi:music', '#ff2d55'],
    security: ['Security', 'mdi:shield-home', '#30b0c7'], camera: ['Camera', 'mdi:cctv', '#636366'],
    timers: ['Timers', 'mdi:timer-outline', '#ff9500'], energy: ['Energy', 'mdi:lightning-bolt', '#34c759'],
    climate: ['Climate', 'mdi:thermostat', '#007aff'], people: ['Who’s Home', 'mdi:account', '#5856d6'],
    todo: ['To-do', 'mdi:clipboard-check', '#ff9500'], notifications: ['Notifications', 'mdi:bell', '#ff3b30']
  };
  var ORDER = ['clock', 'weather', 'calendar', 'now_playing', 'security', 'camera', 'timers', 'energy', 'climate',
               'people', 'todo', 'notifications'];
  var SIZES = ['tiny', 'less', 'more', 'full'];
  var WIDTHS = { narrow: 360, standard: 400, wide: 480 };
  // the width the sections are drawn for: a pane's contents are laid out at
  // 400 and scaled whole (0.85-1.3), as the screensaver's pane always was
  var DRAWN_W = 400;
  // a band under the page on a tablet held upright, and on a narrower one
  // (the iPhone Duo open); a phone (hkCards.BP.phone) never
  var BAND_H = 276, BAND_SMALL = 198, BAND_SMALL_W = 760, PHONE_W = 640;
  // the page beside the pane keeps at least this, else no pane; and the most
  // a Home Grid may leave it (wider than this, it takes its Width instead)
  var PAGE_MIN = 560, BESIDE_MAX = 560;
  var MAX = 8;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sizeOf(s) { return s && SIZES.indexOf(s.size) >= 0 ? s.size : 'more'; }

  // ---------------------------------------------------- the decisions (pure)
  // which sections show now: Always, and When There's Something while `has`
  // says it has something
  function shown(list, has) {
    return (list || []).filter(function (s) { return s && KINDS[s.kind] && (s.when !== 'active' || !!has(s)); }).slice(0, MAX);
  }
  // THE FIT: `over(sizes, n)` says whether the first n sections at these sizes
  // (and, n short of all, the foot) are taller than the pane. Sizes step down
  // from the bottom section up, each as far as Tiny; then sections are left
  // out from the bottom. -> { sizes, n, dropped }
  function fit(list, over) {
    var sizes = (list || []).map(sizeOf), n = sizes.length, guard = 0;
    for (var i = n - 1; i >= 0 && guard < 64 && over(sizes, n); guard++) {
      var at = SIZES.indexOf(sizes[i]);
      if (at > 0) sizes[i] = SIZES[at - 1]; else i--;
    }
    while (n > 0 && over(sizes, n)) n--;
    // ...and what a step further down left room for has its Size back, from
    // the top (a big section stepped down above small ones)
    var want = (list || []).map(sizeOf);
    for (var j = 0; j < n; j++) {
      while (sizes[j] !== want[j]) {
        var up = sizes.slice(); up[j] = SIZES[SIZES.indexOf(sizes[j]) + 1];
        if (over(up, n)) break;
        sizes = up;
      }
    }
    return { sizes: sizes.slice(0, n), n: n, dropped: sizes.length - n };
  }
  // WHERE IT GOES on a screen W x H: { kind: 'side', w } | { kind: 'band', h }
  // | { kind: 'none' }. o: width (its Width), menu (a docked menu's width),
  // gridW (the width a Home Grid filling the height takes; Home only)
  function place(W, H, o) {
    o = o || {};
    if (!(W >= PHONE_W)) return { kind: 'none' };
    if (H > W) return { kind: 'band', h: W < BAND_SMALL_W ? BAND_SMALL : BAND_H };
    var room = W - (o.menu || 0), w = WIDTHS[o.width] || WIDTHS.standard;
    if (o.gridW > 0) {
      // (the grid is the page, laid out to its own width: no page minimum)
      var left = Math.round(room - o.gridW);
      if (left >= WIDTHS.narrow && left <= BESIDE_MAX) return { kind: 'side', w: left };
    }
    if (room - w < PAGE_MIN) return { kind: 'none' };
    return { kind: 'side', w: w };
  }
  // the Dashboard's pane on this page: Off, Home Only, Every Page
  function wants(show, home) { return show === 'all' || (show === 'home' && !!home); }
  // the screensaver's sections: off, the Dashboard's, or its own
  function saverList(sp) {
    var s = (sp && sp.saver) || {};
    if (s.show === 'same') return ((sp.dashboard || {}).sections) || [];
    return s.show === 'own' ? s.sections || [] : [];
  }

  // ------------------------------------------------------------ the house
  function C() { return window.hkCards; }
  function clientNow() {
    var HC = window.hkHostClient;
    return (C() && C().client && C().client()) || (HC && HC.current && HC.current()) || null;
  }
  function HS() { return window.hkSettings; }
  function setting(path, fb) { var s = HS(); return s && s.get ? s.get(path, fb) : fb; }
  function states(c) { return (c && c.states) || {}; }
  function attr(st, k) { return st && st.attributes ? st.attributes[k] : undefined; }
  function nameOf(st, id) { return (attr(st, 'friendly_name') || String(id || '').split('.').pop().replace(/_/g, ' ')); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function L() { return window.hkLocale; }
  function hm(d) { try { return L().time(d, { hour: 'numeric', minute: '2-digit' }); } catch (e) { return d.toTimeString().slice(0, 5); } }
  function dateLong(d) { try { return L().date(d, { weekday: 'long', month: 'long', day: 'numeric' }); } catch (e) { return d.toDateString(); } }
  function dateShort(d) { try { return L().date(d, { weekday: 'short', month: 'short', day: 'numeric' }); } catch (e) { return d.toDateString(); } }
  // THE HOUSE CLOCK (the header's: the Time & Date sensors when chosen,
  // else this screen's own; hkSettings.clock) -> { time, ampm, day, h, m }
  function houseNow(c) {
    var ck = HS() && HS().clock ? HS().clock(states(c)) : null, d = new Date();
    var t = ck && ck.time && String(ck.time).indexOf(':') > 0 ? String(ck.time).split(':') : null;
    var h = t ? parseInt(t[0], 10) : d.getHours(), m = t ? parseInt(t[1], 10) : d.getMinutes();
    var day = d;
    if (ck && ck.date && String(ck.date).indexOf('-') > 0) { var p = String(ck.date).split('-').map(Number); day = new Date(p[0], p[1] - 1, p[2], h, m); }
    var is24 = L() && L().is24 && L().is24();
    var time = is24 ? (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m : ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m;
    return { time: time, ampm: is24 ? '' : h >= 12 ? 'PM' : 'AM', day: day, h: h, m: m };
  }
  function condName(st) { var H = window.hkHeader; return H && H.conditionName ? H.conditionName(st) : String(st || '').replace(/-/g, ' ').replace(/^\w/, function (x) { return x.toUpperCase(); }); }
  // the weather's own multicolor glyph (hk-header.js), else Material's
  function wxGlyph(cond, px) {
    var H = window.hkHeader;
    try { if (H && H.wxSvg) return '<span class="wxg">' + H.wxSvg(cond, px) + '</span>'; } catch (e) { /* Material's */ }
    return icon('mdi:weather-' + wxIcon(cond));
  }
  function deg(v) { var n = num(v); return n == null ? '–' : Math.round(n) + '°'; }
  function ago(t) {
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' hr';
  }
  function domainIds(c, dom) {
    return Object.keys(states(c)).filter(function (k) { return k.indexOf(dom + '.') === 0; }).sort();
  }
  function kinds(k) { var x = setting('kinds', {}) || {}; return Array.isArray(x[k]) ? x[k] : []; }

  // THE SCREEN'S MUSIC, as the screensaver's pane finds it (hk-saver.js
  // musicNow): the context hkMusic resolves for this screen, playing first
  function musicNow(c) {
    var M = window.hkMusic;
    if (!M || !M.contexts || !c || !c.states) return null;
    var cs = M.contexts(c), r = M.resolve ? M.resolve(c) : null, i;
    if (r && r.context && r.context.playing) return r.context;
    for (i = 0; i < cs.length; i++) if (cs[i].playing) return cs[i];
    if (r && r.context && r.reason === 'focus') return r.context;
    return null;
  }
  // (paused or stopped, the screen's music is still the one last seen,
  // while Hide After a Pause holds it)
  var musicKey = null, musicAt = 0;
  function graceMs() { var Mn = C() && C().menu; return (Mn && Mn.npGrace ? Mn.npGrace() : 30) * 1000; }
  function musicOf(c) {
    var ctx = musicNow(c);
    if (!ctx && musicKey && Date.now() - musicAt < graceMs() && states(c)[musicKey]) ctx = { key: musicKey };
    if (!ctx) return null;
    var st = states(c)[ctx.key] || {}, a = st.attributes || {};
    var pic = a.entity_picture_local || a.entity_picture || '';
    var dur = num(a.media_duration) || 0, pos = num(a.media_position) || 0, at = Date.parse(a.media_position_updated_at) || 0;
    var playing = st.state === 'playing';
    var t = pos + (playing && at ? (Date.now() - at) / 1000 : 0);
    return { key: ctx.key, playing: playing, title: ctx.title || a.media_title || '', artist: ctx.artist || a.media_artist || '',
             pic: pic, at: dur ? Math.max(0, Math.min(1, t / dur)) : 0 };
  }
  // ...held a grace after it stops (All Screens -> Now Playing -> Hide After a Pause)
  function musicHas(c) {
    var m = musicOf(c);
    if (m && m.playing) { musicKey = m.key; musicAt = Date.now(); return true; }
    return !!m && Date.now() - musicAt < graceMs();
  }
  function timersOf(c) {
    var st = states(c)['sensor.running_quick_timers'], list = attr(st, 'running');
    return (Array.isArray(list) ? list : []).filter(function (r) { return r && (r.finishes_at || r.remaining); });
  }
  function alarmOf(c) {
    var id = setting('security.alarm', null) || domainIds(c, 'alarm_control_panel')[0];
    return id ? { id: id, st: states(c)[id] } : null;
  }
  var ALARM = { disarmed: 'Disarmed', armed_home: 'Armed · Home', armed_away: 'Armed · Away',
                armed_night: 'Armed · Night', armed_vacation: 'Armed · Vacation', triggered: 'Alarm!',
                arming: 'Arming', pending: 'Pending', armed_custom_bypass: 'Armed' };
  function openOf(c, list) {
    return list.filter(function (id) { var s = (states(c)[id] || {}).state; return s === 'on' || s === 'open' || s === 'opening'; });
  }
  // THE LATEST BANNERS (hk-notify.js): what this page has been shown, newest
  // first, kept a while after their banners go
  var NOTES = [];
  function notesOf() {
    var N = window.hkNotify, now = N && N.shown ? N.shown() : [];
    now.forEach(function (n) {
      var key = (n && (n.id || n.tag || n.title || n.message)) || '';
      if (!key || NOTES.some(function (x) { return x.key === key; })) return;
      NOTES.unshift({ key: key, text: n.title || n.message || '', at: n._at || Date.now() });
    });
    if (NOTES.length > 5) NOTES.length = 5;
    var day = Date.now() - 6 * 3600 * 1000;
    return NOTES.filter(function (x) { return x.at > day; });
  }

  // HAS SOMETHING (When There's Something)
  function has(c, s) {
    var st = states(c);
    switch (s.kind) {
      case 'now_playing': return musicHas(c);
      case 'timers': return timersOf(c).length > 0;
      case 'security':
        var al = alarmOf(c), a = al && al.st && al.st.state;
        return (!!a && a !== 'disarmed' && a !== 'unavailable') || openOf(c, kinds('doors').concat(kinds('garage'))).length > 0;
      case 'notifications': return notesOf().length > 0;
      case 'todo': var t = st[s.entity || domainIds(c, 'todo')[0]]; return !!t && Number(t.state) > 0;
      case 'calendar': return calSoon() > 0;
      case 'climate': return domainIds(c, 'climate').some(function (id) { var x = attr(st[id], 'hvac_action'); return x === 'heating' || x === 'cooling'; });
      case 'people': return domainIds(c, 'person').some(function (id) { return (st[id] || {}).state === 'home'; });
      default: return true;
    }
  }

  // THE CALENDAR'S EVENTS (hkCalendar.load, the Calendar page's own read):
  // today and the coming days, read again every five minutes
  var CAL = { evs: null, at: 0, busy: false, days: 0 };
  function calLoad(c, days, done) {
    var K = window.hkCalendar;
    if (!K && !CAL.asked && typeof document !== 'undefined' && document.addEventListener) {
      // (its code, where no card of the page has brought it yet)
      CAL.asked = true;
      import(window.hkV ? window.hkV('/hk/cards/hk-calendar.js') : '/hk/cards/hk-calendar.js').then(done, function () { CAL.evs = []; done(); });
    }
    if (!K || !K.load || !c || CAL.busy || (CAL.evs && Date.now() - CAL.at < 300000 && CAL.days >= days)) return;
    CAL.busy = true;
    var from = new Date(); from.setHours(0, 0, 0, 0);
    var to = new Date(from.getTime() + Math.max(2, days) * 86400000);
    K.load(c, K.ids(c), from, to).then(function (got) {
      CAL.evs = (got && got.evs) || []; CAL.at = Date.now(); CAL.days = Math.max(2, days); CAL.busy = false; done();
    }, function () { CAL.busy = false; CAL.at = Date.now(); });
  }
  // (hkCalendar's events: {cal, uid, title, allDay, start, end} -- Dates)
  function evStart(e) { return new Date(e.start); }
  function evEnd(e) { return new Date(e.end); }
  function allDay(e) { return !!e.allDay; }
  function calComing() {
    var now = Date.now();
    return (CAL.evs || []).filter(function (e) { return evEnd(e).getTime() > now; })
      .sort(function (a, b) { return evStart(a) - evStart(b); });
  }
  function calSoon() {
    var now = Date.now();
    return calComing().filter(function (e) { return !allDay(e) && evStart(e).getTime() - now < 3600000; }).length;
  }

  // A TO-DO LIST'S ITEMS (hk_frontend/todo/items: hk_core/todo.py over the
  // House port), read again when the list's state (its count) changes; an
  // item checked off is struck through until the list says so
  var TODO = {};
  function todoOf(c, eid, done, redraw) {
    var t = TODO[eid] || (TODO[eid] = { sig: null, got: null, busy: false, off: {} });
    var st = states(c)[eid], sig = st ? st.state + '|' + st.last_updated + '|' + !!done : null;
    if (c && c.callWS && sig && sig !== t.sig && !t.busy) {
      t.busy = true; t.sig = sig;
      c.callWS({ type: 'hk_frontend/todo/items', entity_id: eid, completed: !!done }).then(function (got) {
        t.busy = false; t.got = got || null; t.off = {}; redraw();
      }, function (e) { t.busy = false; t.got = { items: [], refused: (e && e.code) || 'failed' }; redraw(); });
    }
    return t;
  }

  // ------------------------------------------------------------ drawing
  function icon(name, extra) { return '<hk-icon icon="' + name + '"' + (extra || '') + '></hk-icon>'; }
  // NO TITLE OVER A SECTION (the owner, 2026-10-30: "I'm not sure we need a
  // heading for each section"): what it shows says what it is, as HomeView's
  // pane. A to-do list keeps its own name (which list is content, not a title).
  function head() { return ''; }
  function tiny(k, txt, val) {
    return '<div class="sec cmp" data-k="' + k + '" data-size="tiny"><div class="r2">' + icon(KINDS[k][1]) +
      '<span class="tx">' + txt + '</span>' + (val ? '<span class="v2">' + val + '</span>' : '') + '</div></div>';
  }
  function box(k, size, inner, cls) {
    return '<div class="sec' + (cls ? ' ' + cls : '') + '" data-k="' + k + '" data-size="' + size + '">' + inner + '</div>';
  }
  function rows(list) {
    return list.map(function (r) {
      return '<div class="r2' + (r[3] ? ' ' + r[3] : '') + '">' + (r[2] ? icon(r[2]) : '') + '<span class="tx">' + esc(r[0]) +
        '</span><span class="v2">' + esc(r[1]) + '</span></div>';
    }).join('');
  }
  function none(k, size, text) { return size === 'tiny' ? tiny(k, esc(text), '') : box(k, size, head(k) + '<div class="sub2">' + esc(text) + '</div>'); }

  // OUR OWN ANALOG FACE, numbered (the Clock at Full)
  function faceSvg(now) {
    var h = now.h % 12, m = now.m, s = '';
    for (var i = 1; i <= 12; i++) {
      var a = i * Math.PI / 6;
      s += '<text x="' + (78 * Math.sin(a)).toFixed(1) + '" y="' + (-78 * Math.cos(a) + 8).toFixed(1) + '">' + i + '</text>';
    }
    var ha = (h + m / 60) * 30, ma = m * 6;
    return '<svg class="face" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="98" class="dial"/>' +
      '<g class="nums">' + s + '</g>' +
      '<line y2="-46" class="hh" transform="rotate(' + ha + ')"/><line y2="-70" class="mh" transform="rotate(' + ma + ')"/>' +
      '<circle r="4" class="pin"/></svg>';
  }

  // EACH SECTION AT EACH SIZE: (size, sec, c, ctx) -> HTML. ctx.slot(key,
  // make) leaves a place for an element kept between draws (the music pane,
  // a doorbell's live camera); ctx.redraw() draws the pane again.
  var SEC = {
    clock: function (s, sec, c) {
      var now = houseNow(c), d = now.day;
      var t = '<span class="tm">' + esc(now.time) + (now.ampm ? '<small>' + now.ampm + '</small>' : '') + '</span>';
      if (s === 'tiny') return tiny('clock', t, esc(dateShort(d)));
      if (s === 'full') return box('clock', s, '<div class="facebox">' + faceSvg(now) + '</div><div class="sub2 ctr">' + esc(dateLong(d)) + '</div>', 'grow');
      var set = attr(states(c)['sun.sun'], 'next_setting'), sun = s === 'more' && set ? ' · Sunset ' + esc(hm(new Date(set))) : '';
      return box('clock', s, '<div class="big2' + (s === 'less' ? ' less' : '') + '">' + t + '</div><div class="sub2">' + esc(dateLong(d)) + sun + '</div>');
    },
    weather: function (s, sec, c, ctx) {
      var id = setting('weather.entity', null) || domainIds(c, 'weather')[0], st = id && states(c)[id];
      if (!st) return none('weather', s, 'No weather');
      var cond = condName(st.state);
      var daily = ctx.forecast(id, 'daily'), hourly = s === 'more' || s === 'full' ? ctx.forecast(id, 'hourly') : [];
      var d0 = daily[0] || {}, hl = d0.temperature != null ? 'H:' + deg(d0.temperature) + ' L:' + deg(d0.templow) : '';
      var now = deg(attr(st, 'temperature'));
      if (s === 'tiny') return tiny('weather', esc(now + ' ' + cond), esc(hl));
      var top = '<div class="wnow">' + wxGlyph(st.state, 44) + '<b>' + esc(now) + '</b><div class="sub2">' + esc(cond) + (hl ? '<br>' + esc(hl) : '') + '</div></div>';
      var hrs = hourly.slice(0, 5).map(function (h, i) {
        return '<div>' + esc(i ? hm(new Date(h.datetime)).replace(':00', '') : 'Now') + wxGlyph(h.condition, 18) + '<b>' + esc(deg(h.temperature)) + '</b></div>';
      }).join('');
      var days = s === 'full' ? rows(daily.slice(1, 4).map(function (x) {
        return [L() ? L().date(new Date(x.datetime), { weekday: 'long' }) : '', deg(x.temperature) + ' / ' + deg(x.templow), 'mdi:weather-' + wxIcon(x.condition)];
      })) : '';
      return box('weather', s, head('weather') + top + (s === 'less' || !hrs ? '' : '<div class="hrs">' + hrs + '</div>') + days);
    },
    calendar: function (s, sec, c, ctx) {
      ctx.calendar(sec.days || (s === 'full' ? 3 : 2));
      if (!CAL.evs) return none('calendar', s, window.hkCalendar && !window.hkCalendar.ids(c).length ? 'No calendars' : 'Reading the calendars\u2026');
      var evs = calComing();
      if (!evs.length) return none('calendar', s, 'Nothing coming up');
      var when = function (e) {
        var a = evStart(e), today = new Date(); today.setHours(0, 0, 0, 0);
        var dayN = Math.floor((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - today) / 86400000);
        var day = dayN <= 0 ? '' : dayN === 1 ? 'Tomorrow ' : (L() ? L().date(a, { weekday: 'short' }) : '') + ' ';
        return allDay(e) ? (day || 'All day').trim() : day + hm(a);
      };
      if (s === 'tiny') return tiny('calendar', esc(evs[0].title || 'Event'), esc(when(evs[0])));
      var n = { less: 2, more: 4, full: 5 }[s];
      return box('calendar', s, head('calendar') + evs.slice(0, n).map(function (e) {
        return '<div class="ev"><span class="cb" style="background:' + esc(ctx.evColor(e)) + '"></span><span class="et"><b>' +
          esc(e.title || 'Event') + '</b><i>' + esc(when(e)) + '</i></span></div>';
      }).join(''));
    },
    now_playing: function (s, sec, c, ctx) {
      var m = musicOf(c);
      if (!m) return none('now_playing', s, 'Not Playing');
      var pp = '<button type="button" class="pp" data-act="pp" aria-label="' + (m.playing ? 'Pause' : 'Play') + '">' +
               icon(m.playing ? 'mdi:pause' : 'mdi:play') + '</button>';
      if (s === 'tiny') return tiny('now_playing', esc(m.title || 'Playing'), pp);
      if (s === 'less') {
        return box('now_playing', s, '<div class="r2 np">' + (m.pic ? '<img class="art" alt="" src="' + esc(m.pic) + '">' : '<span class="art">' + icon('mdi:music') + '</span>') +
          '<span class="tx"><b>' + esc(m.title) + '</b><i>' + esc(m.artist) + '</i></span>' + pp + '</div>');
      }
      // MORE AND FULL: the screensaver's music pane itself (hk-music-pane-card,
      // hk-saver.js): the art, the song, its buttons and volume, Up Next and
      // the Speakers / Browse panel -- the one view the dashboard shares
      return '<div class="sec mp' + (s === 'full' ? ' grow' : '') + '" data-k="now_playing" data-size="' + s + '">' + ctx.slot('np', 'hk-music-pane-card', function (el) {
        if (el.active) el.active(true);
      }) + '</div>';
    },
    security: function (s, sec, c) {
      var al = alarmOf(c), a = al && al.st ? al.st.state : null;
      var locks = kinds('locks'), un = locks.filter(function (id) { return (states(c)[id] || {}).state === 'unlocked'; });
      var wins = kinds('windows'), open = openOf(c, wins), doors = openOf(c, kinds('doors'));
      var lockLine = !locks.length ? '' : un.length ? un.length + ' unlocked' : 'All locked';
      var state = a ? ALARM[a] || a : locks.length ? (un.length ? 'Unlocked' : 'Locked') : 'No alarm';
      if (s === 'tiny') return tiny('security', esc(state), esc(lockLine));
      var top = '<div class="r2 big">' + icon(KINDS.security[1], ' class="shield"') + '<span class="tx">' + esc(state) + '</span></div>';
      if (s === 'less') {
        var gist = [lockLine, wins.length ? (open.length ? open.length + ' windows open' : 'all windows closed') : '', doors.length ? doors.length + ' doors open' : '']
          .filter(Boolean).join(' · ');
        return box('security', s, head('security') + top + (gist ? '<div class="sub2">' + esc(gist) + '</div>' : ''));
      }
      var list = locks.slice(0, 4).map(function (id) { var x = states(c)[id] || {}; return [nameOf(x, id), x.state === 'unlocked' ? 'Unlocked' : x.state === 'locked' ? 'Locked' : String(x.state || ''), x.state === 'unlocked' ? 'mdi:lock-open-variant' : 'mdi:lock', x.state === 'unlocked' ? 'warn' : '']; });
      if (wins.length) list.push(['Windows', open.length ? open.length + ' open' : 'All closed', 'mdi:window-closed-variant']);
      if (s === 'full') {
        kinds('garage').slice(0, 2).forEach(function (id) { var x = states(c)[id] || {}; list.push([nameOf(x, id), x.state === 'open' || x.state === 'on' ? 'Open' : 'Closed', 'mdi:garage']); });
        if (al && al.st) {
          var who = attr(al.st, 'changed_by'), at = al.st.last_changed ? hm(new Date(al.st.last_changed)) : '';
          list.push([ALARM[a] ? ALARM[a].split(' · ')[0] : 'Changed', [at, who].filter(Boolean).join(', '), 'mdi:history']);
        }
      }
      return box('security', s, head('security') + top + rows(list));
    },
    camera: function (s, sec, c, ctx) {
      var id = sec.entity || (setting('cameras.order', []) || [])[0] || domainIds(c, 'camera')[0], st = id && states(c)[id];
      if (!st) return none('camera', s, 'No camera');
      var age = st.last_updated ? ago(Date.parse(st.last_updated)) + ' ago' : '';
      if (s === 'tiny') return tiny('camera', esc(nameOf(st, id)), esc(age));
      var pic = attr(st, 'entity_picture');
      return '<div class="sec cam2 ' + s + '" data-k="camera" data-size="' + s + '">' +
        (pic ? '<img alt="" src="' + esc(ctx.still(id, pic)) + '">' : '') + '<span class="cn">' + esc(nameOf(st, id)) + '</span></div>';
    },
    timers: function (s, sec, c) {
      var t = timersOf(c);
      if (!t.length) return none('timers', s, 'No timers running');
      var left = function (r) {
        var ms = r.finishes_at ? Date.parse(r.finishes_at) - Date.now() : 0;
        if (!r.finishes_at && r.remaining) return String(r.remaining).replace(/^0:/, '');
        var x = Math.max(0, Math.round(ms / 1000)), h = Math.floor(x / 3600), m = Math.floor(x / 60) % 60, sx = x % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sx < 10 ? '0' : '') + sx;
      };
      if (s === 'tiny') return tiny('timers', esc(t[0].name || 'Timer'), '<span class="cd">' + esc(left(t[0])) + '</span>');
      if (s === 'less') return box('timers', s, head('timers') + rows(t.slice(0, 3).map(function (r) { return [r.name || 'Timer', left(r)]; })));
      return box('timers', s, head('timers') + t.slice(0, s === 'full' ? 4 : 3).map(function (r) {
        var total = num(r.duration_s || r.total) || 0, ms = r.finishes_at ? Date.parse(r.finishes_at) - Date.now() : 0;
        var pct = total ? Math.max(0, Math.min(100, 100 - ms / 10 / total)) : 0;
        return '<div class="r2"><span class="tx">' + esc(r.name || 'Timer') + '</span><span class="v2 cd">' + esc(left(r)) + '</span></div>' +
          '<div class="bar2"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
      }).join('') + (s === 'full' ? '<div class="keys">' + [1, 5, 10, 30].map(function (n) {
        return '<button type="button" data-act="timer" data-min="' + n + '">' + n + ' min</button>';
      }).join('') + '</div>' : ''));
    },
    energy: function (s, sec, c) {
      var pid = setting('features.power', null), p = pid && states(c)[pid];
      var watts = function (st) { var n = num(st && st.state), u = attr(st, 'unit_of_measurement'); if (n == null) return null; return u === 'kW' ? n * 1000 : n; };
      var kw = function (w) { return w == null ? '–' : (Math.abs(w) >= 1000 ? (w / 1000).toFixed(1) + ' kW' : Math.round(w) + ' W'); };
      var use = watts(p), solarId = Object.keys(states(c)).filter(function (k) { return /^sensor\..*solar.*power/.test(k); })[0];
      var bat = Object.keys(states(c)).filter(function (k) { return /^sensor\..*(house|home|powerwall).*battery/.test(k) && attr(states(c)[k], 'device_class') === 'battery'; })[0];
      if (use == null && !solarId) return none('energy', s, 'No power reading');
      var sol = solarId ? kw(watts(states(c)[solarId])) : '';
      if (s === 'tiny') return tiny('energy', 'Using ' + esc(kw(use)), sol ? 'Solar ' + esc(sol) : '');
      var stats = '<div class="stats"><div><b>' + esc(kw(use)) + '</b>Using</div>' + (sol ? '<div><b>' + esc(sol) + '</b>Solar</div>' : '') +
        (bat ? '<div><b>' + esc(Math.round(num(states(c)[bat].state) || 0) + ' %') + '</b>Battery</div>' : '') + '</div>';
      var today = s === 'less' ? '' : energyToday(c);
      return box('energy', s, head('energy') + stats + (today ? '<div class="sub2">' + esc(today) + '</div>' : ''));
    },
    climate: function (s, sec, c) {
      var st = states(c), ids = domainIds(c, 'climate');
      var row = function (id) {
        var x = st[id] || {}, cur = attr(x, 'current_temperature'), set = attr(x, 'temperature'), act = attr(x, 'hvac_action');
        return [nameOf(x, id), deg(cur) + (set != null ? ' → ' + deg(set) : ''), act === 'heating' ? 'mdi:fire' : act === 'cooling' ? 'mdi:snowflake' : 'mdi:thermostat', act === 'heating' ? 'heat' : act === 'cooling' ? 'cool' : ''];
      };
      if (!ids.length) return none('climate', s, 'No thermostats');
      if (s === 'tiny') { var r0 = row(ids[0]), a0 = attr(st[ids[0]], 'hvac_action'); return tiny('climate', esc(r0[0] + ' ' + deg(attr(st[ids[0]], 'current_temperature'))), esc(a0 ? String(a0).replace(/^\w/, function (x) { return x.toUpperCase(); }) : '')); }
      var list = ids.slice(0, { less: 2, more: 4, full: 8 }[s]).map(row);
      if (s === 'full') {
        var out = setting('weather.outside', null), w = setting('weather.entity', null) || domainIds(c, 'weather')[0];
        var t = out ? (st[out] || {}).state : attr(st[w], 'temperature');
        if (t != null) list.push(['Outside', deg(t), 'mdi:home-thermometer']);
      }
      return box('climate', s, head('climate') + rows(list));
    },
    people: function (s, sec, c) {
      var st = states(c), ids = domainIds(c, 'person');
      if (!ids.length) return none('people', s, 'Nobody added');
      var home = ids.filter(function (id) { return (st[id] || {}).state === 'home'; }), away = ids.filter(function (id) { return home.indexOf(id) < 0; });
      if (s === 'tiny') return tiny('people', esc(home.length + ' home'), away.length ? esc(away.length + ' away') : '');
      var where = function (id) { var x = st[id] || {}; return x.state === 'home' ? 'Home' : x.state === 'not_home' ? 'Away' : String(x.state || '').replace(/_/g, ' '); };
      if (s === 'full') return box('people', s, head('people') + rows(ids.slice(0, 8).map(function (id) { return [nameOf(st[id], id), where(id), 'mdi:account-circle']; })));
      var av = '<div class="ppl">' + ids.slice(0, 5).map(function (id, i) {
        var x = st[id] || {}, pic = attr(x, 'entity_picture'), nm = nameOf(x, id);
        var face = pic ? '<img alt="" src="' + esc(pic) + '">' : esc(nm.charAt(0).toUpperCase());
        return '<div class="' + (x.state === 'home' ? '' : 'away') + '"><i style="background:' + ['#ff9500', '#5856d6', '#34c759', '#ff2d55', '#32ade6'][i % 5] + '">' + face + '</i>' + esc(nm.split(' ')[0]) + '</div>';
      }).join('') + '</div>';
      var line = s === 'more' && away.length ? away.slice(0, 2).map(function (id) { return nameOf(st[id], id).split(' ')[0] + ' is ' + (where(id) === 'Away' ? 'away' : 'at ' + where(id)); }).join(' · ') : '';
      return box('people', s, head('people') + av + (line ? '<div class="sub2">' + esc(line) + '</div>' : ''));
    },
    todo: function (s, sec, c, ctx) {
      var eid = sec.entity || domainIds(c, 'todo')[0], st = eid && states(c)[eid];
      if (!st) return none('todo', s, 'No to-do list');
      var name = nameOf(st, eid), left = num(st.state);
      if (s === 'tiny') return tiny('todo', esc(name), left == null ? '' : esc(left + (left === 1 ? ' item' : ' items')));
      var t = todoOf(c, eid, sec.completed, ctx.redraw), got = t.got;
      var h = '<div class="h2">' + icon(KINDS.todo[1]) + '<span>' + esc(name) + '</span></div>';
      if (!got) return box('todo', s, h + '<div class="sub2">Reading the list…</div>');
      if (got.refused) return box('todo', s, h + '<div class="sub2">' + esc(got.refused === 'commands_disabled' ? 'Can’t read the list while control of the house is off.' : 'Can’t read the list.') + '</div>');
      var items = (got.items || []).slice(0, { less: 2, more: 4, full: 6 }[s]);
      var list = items.map(function (it) {
        var done = it.done || t.off[it.uid];
        return '<button type="button" class="it' + (done ? ' done' : '') + '" data-act="todo" data-list="' + esc(eid) + '" data-uid="' + esc(it.uid) + '"' +
          (it.done ? ' disabled' : '') + ' aria-label="Check off ' + esc(it.summary) + '"><i></i><span>' + esc(it.summary) + '</span></button>';
      }).join('');
      var add = s === 'full' ? '<form class="add" data-list="' + esc(eid) + '"><input name="item" placeholder="Add an item" aria-label="Add an item to ' + esc(name) + '" autocomplete="off"><button type="submit" aria-label="Add">' + icon('mdi:plus') + '</button></form>' : '';
      return box('todo', s, h + '<div class="todo">' + (list || '<div class="sub2">Nothing left</div>') + '</div>' + add);
    },
    notifications: function (s) {
      var n = notesOf();
      if (!n.length) return none('notifications', s, 'No notifications');
      if (s === 'tiny') return tiny('notifications', esc(n[0].text), esc(ago(n[0].at)));
      return box('notifications', s, head('notifications') + rows(n.slice(0, { less: 1, more: 3, full: 5 }[s]).map(function (x) { return [x.text, ago(x.at)]; })));
    }
  };
  function wxIcon(cond) {
    var m = { 'clear-night': 'night', cloudy: 'cloudy', exceptional: 'cloudy-alert', fog: 'fog', hail: 'hail', lightning: 'lightning',
              'lightning-rainy': 'lightning-rainy', partlycloudy: 'partly-cloudy', pouring: 'pouring', rainy: 'rainy', snowy: 'snowy',
              'snowy-rainy': 'snowy-rainy', sunny: 'sunny', windy: 'windy', 'windy-variant': 'windy-variant' };
    return m[cond] || 'partly-cloudy';
  }
  // today's use and what the panels made, from the Energy page's sums when
  // they are in (hk-energy.js summary); else nothing
  function energyToday(c) {
    var E = window.hkEnergy, sum = null;
    try { sum = E && E.summary ? E.summary(c) : null; } catch (e) { sum = null; }
    if (!sum || sum.used == null) return '';
    return 'Today ' + Number(sum.used).toFixed(1) + ' kWh used' + (sum.solar != null ? ' · ' + Number(sum.solar).toFixed(1) + ' made' : '');
  }

  // THE ART'S BLUR (hk-saver.js drawBlur's pane look): `img` drawn ART px
  // square (64, a tall pane's), blurred and darkened by 0.38, as a small PNG
  // (a plain picture layer: WebKit left a scaled-up canvas unpainted at some
  // sizes) -- {url, rgb: its mean colour}; url null where the picture can't
  // be read
  var ART = 64;
  function artDraw(img) {
    var c = document.createElement('canvas'); c.width = ART; c.height = ART;
    var ctx = c.getContext && c.getContext('2d'), out = { url: null, rgb: null };
    var t = document.createElement('canvas'); t.width = 10; t.height = 10;
    var tc = t.getContext && t.getContext('2d');
    if (!ctx || !tc) return out;
    tc.drawImage(img, 0, 0, 10, 10);
    try {
      var d = tc.getImageData(0, 0, 10, 10).data, sum = [0, 0, 0];
      for (var i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
      out.rgb = sum.map(function (v) { return v / 100; });
    } catch (e) { return out; }
    // (through a middle step: a tall pane stretches it far more than the
    // music pane's square, and one jump from 10 px streaks where the canvas
    // has no filter, as WebKit's)
    var m = document.createElement('canvas'); m.width = 20; m.height = 20;
    var mc = m.getContext('2d');
    if (mc) { mc.imageSmoothingQuality = 'high'; mc.drawImage(t, -2, -2, 24, 24); }
    // (opaque underneath: a blur's edge would let the page show through)
    ctx.fillStyle = 'rgb(' + out.rgb.map(Math.round).join(',') + ')';
    ctx.fillRect(0, 0, ART, ART);
    ctx.imageSmoothingQuality = 'high';
    try { ctx.filter = 'blur(3px)'; } catch (e) { /* the upscale alone */ }
    ctx.drawImage(mc ? m : t, -6, -6, ART + 12, ART + 12);
    try { ctx.filter = 'none'; } catch (e) { /* ignore */ }
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, 0, ART, ART);
    try { out.url = c.toDataURL('image/png'); } catch (e) { out.url = null; }
    return out;
  }

  // ------------------------------------------------------------ the CSS
  // Built on first use: never hkCards while this file loads (DESIGN.md
  // Rules 1). Logical sizes (a 400 px pane), scaled whole by the pane.
  var CSS = null;
  function css() {
    if (CSS) return CSS;
    var K = C(), v = K && K.v ? K.v : function (n) { return 'var(--hk-' + n + ')'; }, R = (K && K.SP && K.SP.cardR) || 20;
    CSS = [
      // (above the page, as Now Playing's pane was; under the menu, the tab bar and every sheet)
      ':host{position:fixed;z-index:5;display:none;box-sizing:border-box;color:' + v('ink') + ';font-family:var(--hk-font-body,inherit);',
      '  -webkit-tap-highlight-color:transparent;contain:layout style}',
      ':host([on]){display:block}',
      ':host([mode="saver"]){position:absolute}',
      // A WIDGET on the Pages screen (Phase J; section() below): one section, filling its slot, no pane of its own
      ':host([mode="widget"]){position:absolute;inset:0}',
      // THE PANE: the docked side menu's material in the screen's look
      // (hk-menu.js .mat; the host's `look`, sync() below), as Now Playing's
      // pane was a frosted sheet -- one live blur, the page and the sky seen
      // through it. It was a near-solid navy plate (.92-.97) once, its blur
      // hidden under it (the owner, 2026-10-30: "the side pane isn't blurred
      // anymore?"). Its edge and shadow toward the page (a left pane's mirrored).
      '.pane{position:absolute;inset:0;overflow:hidden;background:rgba(28,28,32,0.52);',
      '  -webkit-backdrop-filter:blur(34px) saturate(1.9);backdrop-filter:blur(34px) saturate(1.9)}',  // hkCards.BLUR.heavy
      // Frosted and Tinted: no blur, near-solid, as the menu's (the pane is
      // always up on a wall tablet); the slow tablets' Flat the same
      ':host([look="frosted"]) .pane{background:rgba(34,38,56,0.95);-webkit-backdrop-filter:none;backdrop-filter:none}',
      ':host([look="tinted"]) .pane,:host([look="flat"]) .pane{background:rgba(24,24,28,0.93);-webkit-backdrop-filter:none;backdrop-filter:none}',
      // Bright Glass: the white wash over its light blur, the rim on the page side
      ':host([look="bright"]) .pane{background:linear-gradient(150deg,rgba(255,255,255,0.30),rgba(255,255,255,0.14));',
      '  -webkit-backdrop-filter:blur(4px) saturate(1.3) brightness(1.08);backdrop-filter:blur(4px) saturate(1.3) brightness(1.08)}',
      ':host([look="bright"][side="right"]) .pane{border-left:0;box-shadow:inset 1.5px 0 0 rgba(255,255,255,0.22),-18px 0 44px rgba(0,0,0,.18)}',
      ':host([look="bright"][side="left"]) .pane{border-right:0;box-shadow:inset -1.5px 0 0 rgba(255,255,255,0.22),18px 0 44px rgba(0,0,0,.18)}',
      ':host([look="bright"][side="band"]) .pane{border-top:0;box-shadow:inset 0 1.5px 0 rgba(255,255,255,0.22),0 -18px 44px rgba(0,0,0,.18)}',
      ':host([look="bright"]) .pin{text-shadow:0 1px 2px rgba(0,0,0,0.22)}',
      ':host([side="right"]) .pane{border-left:1px solid ' + v('line') + ';box-shadow:-18px 0 44px rgba(0,0,0,.30)}',
      ':host([side="left"]) .pane{border-right:1px solid ' + v('line') + ';box-shadow:18px 0 44px rgba(0,0,0,.30)}',
      ':host([side="band"]) .pane{border-top:1px solid ' + v('line') + ';box-shadow:0 -18px 44px rgba(0,0,0,.30)}',
      // IN THE SCREENSAVER: on its pane's own background, under Home Status
      ':host([mode="saver"]) .pane{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:0;box-shadow:none}',
      // THE ALBUM ART behind the whole pane while a song plays (_artBg): two
      // canvases cross-fading, a shade for the words; a flat tint where the
      // look has no blur
      '.artbg{position:absolute;inset:0;opacity:0;transition:opacity 1.2s ease;pointer-events:none;overflow:hidden;background:#141418}',
      ':host([arted]) .artbg{opacity:1}',
      '.artbg b{position:absolute;left:-8%;top:-8%;width:116%;height:116%;display:block;opacity:0;transition:opacity 1.2s ease;background-size:100% 100%}',
      '.artbg b.on{opacity:1}',
      '.artbg b.raw{background-size:cover;background-position:center;filter:blur(40px) brightness(.62)}',
      '.artbg i{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(6,10,18,.34),rgba(6,10,18,.46))}',
      ':host([arttint]) .artbg{background:var(--art-tint,#1c1c22)}:host([arttint]) .artbg b,:host([arttint]) .artbg i{display:none}',
      '@media (prefers-reduced-motion:reduce){.artbg,.artbg b{transition:none}}',
      '.pin{position:absolute;left:0;top:0;transform-origin:0 0;box-sizing:border-box;display:flex;flex-direction:column;padding:30px 28px 26px}',
      ':host([side="band"]) .pin{padding:20px 24px}',
      ':host([mode="saver"]) .pin{padding:4px 28px 22px}',
      ':host([mode="widget"]) .pane{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:0;box-shadow:none}',
      ':host([mode="widget"]) .pin{padding:0}',
      ':host([mode="widget"]) .secs>.sec{flex:1 1 auto}',
      '.secs{display:flex;flex-direction:column;gap:12px;flex:1 1 auto;min-height:0;overflow:hidden}',
      ':host([side="band"]) .secs{flex-direction:row;align-items:stretch}',
      ':host([side="band"]) .secs>.sec{flex:1 1 0;min-width:0}',
      '.secs>*{flex:none}',
      '.secs>.grow{flex:1 1 auto;min-height:0}',
      '.sec{background:' + v('key') + ';border-radius:' + R + 'px;padding:14px 16px;display:grid;gap:8px;align-content:start;box-sizing:border-box;overflow:hidden}',
      '.sec.cmp{padding:11px 16px}',
      // ON THE PANE (not a band, not a Pages-screen widget): the sections sit
      // straight on its glass, a hairline between them, no plates
      ':host(:not([mode="widget"]):not([side="band"])) .secs{gap:0}',
      ':host(:not([mode="widget"]):not([side="band"])) .sec:not(.cam2):not(.mp){background:none;border-radius:0;padding:14px 0}',
      ':host(:not([mode="widget"]):not([side="band"])) .sec.cmp:not(.cam2){padding:11px 0}',
      ':host(:not([mode="widget"]):not([side="band"])) .sec+.sec{border-top:1px solid ' + v('line') + '}',
      ':host(:not([mode="widget"]):not([side="band"])) .sec.cam2{margin:14px 0}',
      // (the music pane on the pane's ground, not a box: its line above straight)
      ':host(:not([mode="widget"]):not([side="band"])) .sec.mp{border-radius:0}',
      '.sec>.ev:last-child{border-bottom:0}',
      '.h2{display:flex;align-items:center;gap:6px;font:600 13px/1 var(--hk-font-body,inherit);letter-spacing:.3px;text-transform:uppercase;color:' + v('ink-2') + '}',
      '.h2 hk-icon{--mdc-icon-size:15px;width:15px;height:15px}',
      '.big2{font:600 72px/1 var(--hk-font-body,inherit);letter-spacing:-2px;font-variant-numeric:tabular-nums}',
      '.big2.less{font-size:48px;letter-spacing:-1.2px}',
      '.tm{white-space:nowrap}.tm small{font-size:.36em;font-weight:600;letter-spacing:0;margin-left:.18em;color:' + v('ink-2') + '}',
      '.wxg{display:inline-grid;place-items:center;flex:none}.hrs .wxg{display:grid;margin:2px auto}',
      '.sub2{font:500 17px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
      '.sub2.ctr{text-align:center}',
      '.r2{display:flex;align-items:center;gap:10px;font:600 17px/1.3 var(--hk-font-body,inherit);min-width:0}',
      '.r2 hk-icon{--mdc-icon-size:22px;width:22px;height:22px;flex:none}',
      '.r2 .tx{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.r2 .v2{margin-left:auto;color:' + v('ink-2') + ';font-weight:500;white-space:nowrap}',
      '.r2.warn .v2,.r2.heat hk-icon{color:#ff9f0a}.r2.cool hk-icon{color:#64d2ff}',
      '.r2.big{font-size:22px}.r2.big hk-icon{--mdc-icon-size:30px;width:30px;height:30px;color:#30b0c7}',
      '.cd{font-variant-numeric:tabular-nums;color:#ff9f0a}',
      '.wnow{display:flex;align-items:center;gap:12px}',
      '.wnow hk-icon{--mdc-icon-size:44px;width:44px;height:44px;color:#ffd60a}',
      '.wnow b{font:600 44px/1 var(--hk-font-body,inherit);letter-spacing:-1px}',
      '.hrs{display:grid;grid-template-columns:repeat(5,1fr);text-align:center;font:600 13px/1.5 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
      '.hrs b{display:block;color:' + v('ink') + ';font-size:16px}',
      '.hrs hk-icon{--mdc-icon-size:18px;width:18px;height:18px;color:#ffd60a;display:block;margin:2px auto}',
      '.ev{display:grid;grid-template-columns:4px 1fr;gap:12px;align-items:start;padding:7px 0;border-bottom:1px solid ' + v('line') + '}',
      '.ev:last-child{border-bottom:0}',
      '.ev .cb{width:4px;border-radius:2px;align-self:stretch}',
      '.ev .et{min-width:0}',
      '.ev .et b{display:block;font:600 17px/1.3 var(--hk-font-body,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ev .et i{font:500 13px/1.3 var(--hk-font-body,inherit);font-style:normal;color:' + v('ink-2') + '}',
      '.np .art{width:56px;height:56px;border-radius:10px;object-fit:cover;flex:none;background:' + v('key') + ';display:grid;place-items:center}',
      '.np .tx b{display:block;overflow:hidden;text-overflow:ellipsis}.np .tx i{display:block;font:500 15px/1.3 var(--hk-font-body,inherit);font-style:normal;color:' + v('ink-2') + ';overflow:hidden;text-overflow:ellipsis}',
      '.pp{all:unset;cursor:pointer;flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:' + v('key') + '}',
      '.pp hk-icon{--mdc-icon-size:22px;width:22px;height:22px}',
      '.cmp .pp{width:30px;height:30px;margin:-4px 0}',
      // the screensaver's music pane, in a section: More is its art and
      // controls at the pane's width; Full takes what is left
      '.sec.mp{padding:0;display:block;position:relative;height:540px;background:none;overflow:visible}',
      '.sec.mp.grow{height:auto;min-height:540px}',
      '.sec.mp>*{position:absolute;inset:0;height:100%}',
      '.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
      '.stats div{font:500 13px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
      '.stats b{display:block;font:600 22px/1.25 var(--hk-font-body,inherit);color:' + v('ink') + '}',
      '.ppl{display:flex;gap:14px}',
      '.ppl div{display:grid;justify-items:center;gap:4px;font:500 13px/1.2 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
      '.ppl i{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;font:600 18px/1 var(--hk-font-body,inherit);font-style:normal;color:#fff;overflow:hidden}',
      '.ppl i img{width:100%;height:100%;object-fit:cover}',
      '.ppl .away i{opacity:.45}',
      '.bar2{height:5px;border-radius:3px;background:' + v('line-strong') + ';position:relative;overflow:hidden}',
      '.bar2 i{position:absolute;left:0;top:0;bottom:0;background:#ff9f0a;border-radius:3px}',
      '.keys{display:flex;gap:8px;flex-wrap:wrap}',
      '.keys button{all:unset;cursor:pointer;font:600 13.5px/1 var(--hk-font-body,inherit);padding:11px 14px;border-radius:999px;background:' + v('key-strong') + '}',
      '.todo{display:grid;gap:2px}',
      '.it{all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;font:500 17px/1.3 var(--hk-font-body,inherit);min-height:32px}',
      '.it i{flex:none;width:18px;height:18px;border-radius:50%;box-shadow:inset 0 0 0 1.6px ' + v('ink-2') + '}',
      '.it span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.it.done span{text-decoration:line-through;color:' + v('ink-2') + '}',
      '.it.done i{background:#ff9500;box-shadow:none}',
      '.it:focus-visible,.pp:focus-visible,.keys button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      '.add{display:flex;gap:8px}.add input{flex:1;min-width:0;font:500 15px/1 var(--hk-font-body,inherit);color:inherit;background:' + v('key') + ';border:0;border-radius:10px;padding:9px 12px}',
      '.add button{all:unset;cursor:pointer;display:grid;place-items:center;width:36px;border-radius:10px;background:' + v('key-strong') + '}',
      '.sec.cam2{padding:0;position:relative;aspect-ratio:16/9;display:block;background:#000}',
      '.sec.cam2.less{aspect-ratio:auto;height:120px}',
      '.sec.cam2.full{aspect-ratio:4/3}',
      '.sec.cam2>img,.sec.cam2>.live,.sec.cam2>.live>*{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
      '.sec.cam2 .cn{position:absolute;left:12px;bottom:12px;font:600 13px/1 var(--hk-font-body,inherit);background:rgba(28,28,30,.62);padding:6px 9px;border-radius:999px}',
      '.sec.cam2 .lv{position:absolute;right:12px;top:12px;font:700 11px/1 var(--hk-font-body,inherit);letter-spacing:.06em;background:#ff3b30;padding:5px 8px;border-radius:999px;z-index:1}',
      '.sec.cam2.ring{box-shadow:inset 0 0 0 3px #ff3b30}',
      '.facebox{display:grid;place-items:center;flex:1;min-height:0}',
      '.sec[data-k="clock"].grow{display:flex;flex-direction:column}',
      '.face{width:min(100%,300px);height:auto}',
      '.face .dial{fill:none;stroke:' + v('line') + ';stroke-width:1.5}',
      '.face .nums{font:500 22px/1 var(--hk-font-body,inherit);fill:' + v('ink') + ';text-anchor:middle}',
      '.face .hh{stroke:' + v('ink') + ';stroke-width:6;stroke-linecap:round}.face .mh{stroke:' + v('ink') + ';stroke-width:4;stroke-linecap:round}',
      '.face .pin{fill:#ff9f0a}',
      '.more2{font:600 13px/1 var(--hk-font-body,inherit);color:' + v('ink-2') + ';text-align:center;padding:2px 0 0;flex:none}',
      ':host([side="band"]) .more2{align-self:center;padding:0 4px}',
      '@media (hover:hover){.pp:hover,.keys button:hover{background:' + v('key-strong') + '}}',
      '@media (prefers-reduced-motion:no-preference){:host([side]) .pane{transition:opacity .2s}}'
    ].join('\n');
    return CSS;
  }

  // ------------------------------------------------------------ one pane
  // A PANE: the Dashboard's (mode 'dash', fixed to the window's edge) or the
  // screensaver's (mode 'saver', inside its own shadow root). Given its
  // sections and its place, it draws, fits and publishes nothing itself.
  class HkSidePane extends HTMLElement {
    constructor() {
      super();
      this._root = this.attachShadow({ mode: 'open' });
      this._slots = {};
      this._stills = {};
      this._wx = {};
      var self = this;
      this._root.addEventListener('click', function (e) { self._click(e); });
      this._root.addEventListener('submit', function (e) { self._submit(e); });
    }
    // what it shows now: { list (sections), place, doorbell (a camera) }
    show(o) {
      this._o = o || null;
      var on = !!(o && o.place && o.place.kind !== 'none' && ((o.list && o.list.length) || o.doorbell));
      this.toggleAttribute('on', on);
      if (!on) { this._sig = null; this._park(); return false; }
      this.setAttribute('side', o.place.kind === 'band' ? 'band' : o.side === 'left' ? 'left' : 'right');
      this._draw();
      return true;
    }
    redraw() { if (this._o && this.hasAttribute('on')) this._draw(true); }
    // ------------------------------------------------ drawing and the fit
    _draw(again) {
      var o = this._o, c = clientNow();
      if (!this._built) {
        this._root.innerHTML = '<style>' + css() + '</style><div class="pane"><div class="artbg" aria-hidden="true"><b></b><b></b><i></i></div><div class="pin"><div class="secs"></div></div></div>';
        this._pin = this._root.querySelector('.pin');
        this._secs = this._root.querySelector('.secs');
        this._built = true;
      }
      var band = o.place.kind === 'band', W = this.clientWidth || (band ? window.innerWidth : o.place.w) || DRAWN_W;
      var H = this.clientHeight || (band ? o.place.h : window.innerHeight) || 800;
      // drawn at 400 wide and scaled whole (a band at its own height, scaled the same)
      var z = band ? Math.max(0.85, Math.min(1.1, H / BAND_H)) : Math.max(0.85, Math.min(1.3, W / DRAWN_W));
      this._pin.style.width = (W / z).toFixed(1) + 'px';
      this._pin.style.height = (H / z).toFixed(1) + 'px';
      this._pin.style.transform = 'scale(' + z.toFixed(4) + ')';
      var list = o.list || [], self = this;
      var ctx = this._ctx(c);
      var door = o.doorbell ? this._door(o.doorbell, c) : '';
      var render = function (sizes, n) {
        var html = door;
        for (var i = 0; i < n; i++) {
          var s = list[i], fn = SEC[s.kind];
          try { html += fn ? fn(sizes[i], s, c, ctx) : ''; } catch (e) { console.warn('[hk-sidepane] ' + s.kind, e); }
        }
        if (n < list.length) html += '<div class="more2">+' + (list.length - n) + ' more</div>';
        return html;
      };
      this._artBg(list, c);
      var sig = JSON.stringify([list, W, H, o.side, band, o.doorbell]) + '|' + this._dataSig(c);
      if (!again && sig === this._sig) return;
      this._sig = sig;
      var over = function (sizes, n) {
        self._secs.innerHTML = render(sizes, n);
        self._fill();
        return band ? self._secs.scrollWidth > self._secs.clientWidth + 1 || self._tallest() > self._secs.clientHeight + 1
                    : self._secs.scrollHeight > self._secs.clientHeight + 1;
      };
      var got = fit(list, over);
      // (the last measured draw may be a step past the answer: draw the answer)
      this._secs.innerHTML = render(got.sizes, got.n);
      this._fill();
      this._fit = got;
    }
    // THE ALBUM ART BEHIND THE WHOLE PANE (2026-10-30, the owner: "if something
    // is playing, the whole pane should have the album art blur"): while Now
    // Playing is one of its sections and has a song, the pane's ground is the
    // song's art blurred -- the music pane's own way (hk-saver.js drawBlur):
    // drawn 10 px, then 32 px with a 2 px blur and darkened, and the CSS
    // scales it up; no live filter -- under a shade for its words, edge to
    // edge. The next song's fades in over the last; stopped, it fades back to
    // the screen's glass. Where the look has no blur (Flat, Tinted, Frosted,
    // Glass -- Performance's), a flat tint from the art instead.
    _artBg(list, c) {
      var want = list.some(function (s) { return s.kind === 'now_playing'; }) ? musicOf(c) : null;
      var pic = want && want.pic ? want.pic : null, self = this;
      var g = document.documentElement.getAttribute('data-hk-glass') || 'blur';
      var tint = document.documentElement.hasAttribute('data-hk-flat') || ['flat', 'tinted', 'frosted', 'clear'].indexOf(g) >= 0;
      this.toggleAttribute('arttint', tint);
      if (pic === this._artPic) return;
      this._artPic = pic;
      if (!pic) { this.removeAttribute('arted'); return; }
      var img = new Image();
      img.onload = function () {
        if (self._artPic !== pic) return;
        var ly = self._root.querySelectorAll('.artbg b'), n = self._artFlip ? 0 : 1;
        self._artFlip = !self._artFlip;
        var got = artDraw(img);
        if (got.rgb) self.style.setProperty('--art-tint', 'rgb(' + got.rgb.map(function (v) { return Math.round(v * 0.42); }).join(',') + ')');
        // (a picture that can't be read here: itself, under a blur drawn once)
        ly[n].classList.toggle('raw', !got.url);
        ly[n].style.backgroundImage = 'url("' + (got.url || pic).replace(/"/g, '%22') + '")';
        ly[n].classList.add('on'); ly[1 - n].classList.remove('on');
        self.setAttribute('arted', '');
      };
      img.onerror = function () { if (self._artPic === pic) self.removeAttribute('arted'); };
      img.src = pic;
    }
    _tallest() {
      var t = 0;
      Array.prototype.forEach.call(this._secs.children, function (k) { t = Math.max(t, k.scrollHeight || 0); });
      return t;
    }
    // what the data said last time, so a push that changes nothing here draws nothing
    _dataSig(c) {
      var st = states(c), o = this._o, ids = [];
      (o.list || []).forEach(function (s) { ids.push(s.entity || ''); });
      var m = musicOf(c);
      return JSON.stringify([Math.floor(Date.now() / 30000), m && [m.key, m.playing, m.title], timersOf(c).length,
        ids.map(function (id) { return id && st[id] ? st[id].last_updated : ''; }), CAL.at, notesOf().length,
        Object.keys(TODO).map(function (k) { return TODO[k].sig + (TODO[k].got ? 1 : 0); })]);
    }
    _ctx(c) {
      var self = this;
      return {
        redraw: function () { self.redraw(); },
        calendar: function (days) { calLoad(c, days, function () { self.redraw(); }); },
        // an event's color: its own, a keyword's, else its calendar's
        // (hkSettings.eventColor, the Calendar page's), as the chart palette has it
        evColor: function (e) {
          var HSet = window.hkSettings, hue = (C() && C().PALETTE && C().PALETTE.chart) || {}, key = null;
          try { key = HSet && HSet.eventColor ? HSet.eventColor(e.cal, e.title, e.uid, states(c)) : null; } catch (er) { key = null; }
          var rgb = key === 'white' ? [255, 255, 255] : hue[key];
          return rgb && rgb.length === 3 ? 'rgb(' + rgb.join(',') + ')' : '#ff9f0a';
        },
        forecast: function (wid, kind) { return self._forecast(c, wid, kind); },
        still: function (id, pic) {
          // a still at most every ten seconds (the strip's rule), never the same address twice
          var s = self._stills[id] || (self._stills[id] = { at: 0, n: 0 });
          if (Date.now() - s.at > 10000) { s.at = Date.now(); s.n++; }
          return pic + (pic.indexOf('?') >= 0 ? '&' : '?') + 'hk_n=' + s.n;
        },
        slot: function (key, tag) { self._want = self._want || {}; self._want[key] = tag; return '<div class="slot" data-slot="' + key + '"></div>'; }
      };
    }
    // ELEMENTS KEPT BETWEEN DRAWS (the music pane, the doorbell's live
    // camera): made once, moved into each draw's place for them
    _fill() {
      var self = this, want = this._want || {}, c = clientNow();
      Array.prototype.forEach.call(this._secs.querySelectorAll('.slot'), function (slot) {
        var key = slot.getAttribute('data-slot'), tag = want[key], el = self._slots[key];
        if (!el && tag && customElements.get(tag)) {
          el = self._slots[key] = document.createElement(tag);
          if (el.setConfig) el.setConfig(self._slotCfg(key, tag));
          var HC = window.hkHostClient;
          if (HC && HC.bridge && c) HC.bridge(el, c);
        }
        if (!el) {
          if (tag && customElements.whenDefined) customElements.whenDefined(tag).then(function () { self.redraw(); });
          return;
        }
        slot.parentNode.replaceChild(el, slot);
        // (the music pane on the pane's own album-art backdrop: none of its
        // own and no box -- the owner, 2026-10-30)
        if (key === 'np' && !el.hasAttribute('nobg')) el.setAttribute('nobg', '');
        if (key === 'np' && el.active) el.active(true);
      });
    }
    _slotCfg(key, tag) {
      if (key.indexOf('door:') === 0) return { type: 'custom:' + tag, entity: key.slice(5), aspect_ratio: '16x9', fit_mode: 'cover' };
      return { type: 'custom:' + tag };
    }
    // ...and taken out when the pane steps aside (the music pane stops drawing)
    _park() {
      var np = this._slots.np;
      if (np && np.active) np.active(false);
      Object.keys(this._slots).forEach(function (k) { var el = this._slots[k]; if (el.parentNode) el.parentNode.removeChild(el); }, this);
    }
    // THE DOORBELL at the top, live, while its pop-up shows
    _door(cam, c) {
      var st = states(c)[cam], key = 'door:' + cam;
      this._want = this._want || {};
      this._want[key] = 'hk-camera-live-card';
      return '<div class="sec cam2 ring" data-k="door"><div class="live"><div class="slot" data-slot="' + key + '"></div></div>' +
        '<span class="lv">DOORBELL</span><span class="cn">' + esc(nameOf(st, cam)) + ' · Live</span></div>';
    }
    // THE FORECAST (hkWxForecast, the Weather page's own subscription), one
    // per kind, kept while the pane shows weather
    _forecast(c, wid, kind) {
      var W = window.hkWxForecast, key = kind + '|' + wid, self = this, port = c && c.subscriptions;
      if (!W || !port) return [];
      var w = this._wx[key];
      if (!w || w.conn !== port) {
        if (w) w.release();
        w = this._wx[key] = W.watch(port, kind, wid, function () { self.redraw(); });
      }
      return w.data() || [];
    }
    // ------------------------------------------------ taps
    _click(e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null, c = clientNow();
      if (!b || !c || !c.actions) return;
      var act = b.getAttribute('data-act');
      if (act === 'pp') {
        var m = musicOf(c);
        if (m) c.actions.callService('media_player', 'media_play_pause', {}, { entity_id: m.key }).catch(function () { /* refused: said by the host */ });
      } else if (act === 'todo') {
        // CHECKED OFF: a house command (todo.update_item), struck through
        // until the list says so
        var eid = b.getAttribute('data-list'), uid = b.getAttribute('data-uid'), t = TODO[eid];
        if (!eid || !uid || (t && t.off[uid])) return;
        if (t) t.off[uid] = true;
        b.classList.add('done');
        c.actions.callService('todo', 'update_item', { item: uid, status: 'completed' }, { entity_id: eid }).catch(function () {
          if (t) { delete t.off[uid]; } b.classList.remove('done');
        });
      } else if (act === 'timer') {
        // A QUICK TIMER, as the Timers page starts one (the quick_timers package's script)
        var mins = Number(b.getAttribute('data-min')), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
        c.actions.callService('script', 'quick_timer_start', { duration: p2(Math.floor(mins / 60)) + ':' + p2(mins % 60) + ':00' })
          .catch(function () { /* refused: said by the host */ });
      }
      e.stopPropagation();
    }
    _submit(e) {
      var f = e.target, c = clientNow();
      e.preventDefault();
      if (!f || !f.matches || !f.matches('form.add') || !c || !c.actions) return;
      var inp = f.querySelector('input'), txt = inp && String(inp.value || '').trim(), eid = f.getAttribute('data-list');
      if (!txt || !eid) return;
      inp.value = '';
      c.actions.callService('todo', 'add_item', { item: txt.slice(0, 200) }, { entity_id: eid }).catch(function () { inp.value = txt; });
    }
    // (a widget is shown before it is placed: drawn again at its slot's size)
    connectedCallback() { if (this.getAttribute('mode') === 'widget' && this._o) this._draw(true); }
    disconnectedCallback() {
      var wx = this._wx;
      Object.keys(wx).forEach(function (k) { wx[k].release(); });
      this._wx = {};
      this._park();
    }
  }
  if (!customElements.get('hk-side-pane')) customElements.define('hk-side-pane', HkSidePane);

  // ------------------------------------------------------- the Dashboard's
  // THE SCREEN'S SIDE PANE AS READ (settings side_pane_read), or null
  function paneOf() {
    var M = C() && C().menu, dash = M && M.dash ? M.dash() : String(location.pathname).split('/')[1] || '';
    var all = setting('boards', null), b = all && all[dash];
    return (b && b.side_pane_read) || null;
  }
  function isHome() {
    var M = C() && C().menu, here = String(location.pathname).split('/')[2] || '';
    var cfg = M && M.config ? M.config() : null, v0 = cfg && cfg.views && cfg.views[0];
    return !here || here === '0' || !!(v0 && v0.path === here);
  }
  // A DOORBELL RINGING: a camera pop-up of the house's open now (hk-popup.js;
  // #<its hash>), for as long as it shows
  function ringing() {
    var h = String(location.hash || '').slice(1);
    if (!h || !(window.hkPopupOpen > 0)) return null;
    var p = (setting('popups', []) || []).filter(function (x) { return x && x.hash === h && (x.kind || 'camera') === 'camera'; })[0];
    return p ? (p.stream || p.entity || null) : null;
  }
  // the width a Home Grid filling the height takes (hk-layout.js paneRoom)
  var grid = null;
  function gridW(H) {
    var g = grid && grid.isConnected && grid.paneRoom ? grid.paneRoom(H) : 0;
    return g > 0 ? g : 0;
  }
  function menuLeft() {
    var n = 0;
    try { n = parseFloat(document.documentElement.style.getPropertyValue('--hk-menu-right')) || 0; } catch (e) { n = 0; }
    return n;
  }
  // the tab bar's room at the bottom (hk-tabbar.js --hk-tabbar-h: a calc(),
  // so measured on a probe)
  var probe = null;
  function tabRoom() {
    try {
      if (!probe) {
        probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:-9px;top:0;width:1px;visibility:hidden;pointer-events:none;height:var(--hk-tabbar-h,0px)';
        document.body.appendChild(probe);
      }
      return probe.offsetHeight || 0;
    } catch (e) { return 0; }
  }
  // A BAND'S ROOM at the page's foot: the view's margin (hk-menu.js keeps its
  // sides, the tab bar its padding), so a page that scrolls ends above it
  var bandView = null;
  function bandRoom(h) {
    var SH = window.hkShell, M = C() && C().menu, v = null;
    try { v = h && SH && SH.viewSlot ? SH.viewSlot(M && M.panel ? M.panel() : undefined) : null; } catch (e) { v = null; }
    if (bandView && bandView !== v) bandView.style.marginBottom = '';
    bandView = h ? v : null;
    if (v) v.style.marginBottom = h ? h + 'px' : '';
  }
  // its room on <html> (hk-menu.js narrows the page, hk-tabbar.js keeps
  // clear; a band's height for the page's foot), and the word it changed
  function publish(side, w, bandH) {
    var de = document.documentElement;
    if (!de || !de.style) return;
    var l = side === 'left' && w ? w + 'px' : '', r = side === 'right' && w ? w + 'px' : '', b = bandH ? bandH + 'px' : '';
    if (de.style.getPropertyValue('--hk-pane-l') === l && de.style.getPropertyValue('--hk-pane-r') === r &&
        de.style.getPropertyValue('--hk-pane-b') === b) return;
    [['--hk-pane-l', l], ['--hk-pane-r', r], ['--hk-pane-b', b]].forEach(function (x) {
      if (x[1]) de.style.setProperty(x[0], x[1]); else de.style.removeProperty(x[0]);
    });
    if (l || r || b) de.setAttribute('hk-pane', l ? 'left' : r ? 'right' : 'band'); else de.removeAttribute('hk-pane');
    try { window.dispatchEvent(new Event('hk-pane')); } catch (e) { /* no listeners */ }
  }
  // NOW PLAYING IN THE PANE: the docked bar gives the music up to it while
  // it shows (hk-popup.js's `flag` condition, hk-strategy.js)
  function musicFlag(on) {
    var de = document.documentElement;
    if (!de || de.hasAttribute('hk-pane-music') === !!on) return;
    de.toggleAttribute('hk-pane-music', !!on);
    try { window.dispatchEvent(new Event('hk-popup-flags')); } catch (e) { /* none */ }
  }

  var dash = null;
  function sync() {
    var sp = paneOf(), c = clientNow();
    var W = window.innerWidth || 0, H = window.innerHeight || 0;
    var g = sp && sp.dashboard, on = !!(sp && g && wants(g.show, isHome()));
    // (the screensaver up: its own pane, not this one)
    if (window.hkSaver && window.hkSaver.running && window.hkSaver.running() && !(window.hkSaver.covered && !window.hkSaver.covered())) on = false;
    var list = on ? shown(g.sections, function (s) { return has(c, s); }) : [];
    var door = on && sp.doorbell ? ringing() : null;
    var home = isHome();
    var p = on ? place(W, H, { width: sp.width, menu: menuLeft(), gridW: home ? gridW(H - tabRoom()) : 0 }) : { kind: 'none' };
    if (!dash && on && p.kind !== 'none' && (list.length || door)) {
      dash = document.createElement('hk-side-pane');
      dash.setAttribute('mode', 'dash');
      document.body.appendChild(dash);
    }
    var up = dash ? dash.show({ list: list, place: p, side: sp ? sp.side : 'right', doorbell: door }) : false;
    if (dash) dress(dash, up);
    if (dash) {
      var s = dash.style;
      if (up && p.kind === 'side') {
        var L0 = sp.side === 'left' ? menuLeft() : 0;
        s.top = '0'; s.bottom = '0'; s.width = p.w + 'px'; s.height = '';
        s.left = sp.side === 'left' ? L0 + 'px' : ''; s.right = sp.side === 'left' ? '' : '0';
      } else if (up && p.kind === 'band') {
        // (above the tab bar, whose top it reads: hk-tabbar.js --hk-tabbar-top)
        s.left = menuLeft() + 'px'; s.right = '0'; s.width = ''; s.top = ''; s.height = p.h + 'px';
        s.bottom = 'var(--hk-tabbar-top,0px)';
      }
    }
    publish(up && p.kind === 'side' ? sp.side : null, up && p.kind === 'side' ? p.w : 0, up && p.kind === 'band' ? p.h : 0);
    // (a Home Grid takes the band off its own height: hk-layout.js --hk-pane-b)
    bandRoom(up && p.kind === 'band' && !(grid && grid.isConnected) ? p.h : 0);
    musicFlag(up && list.some(function (x) { return x.kind === 'now_playing'; }) && musicHas(c));
  }
  // THE PANE'S MATERIAL is the screen's look (html[data-hk-glass],
  // hk-settings.js; the slow tablets' ladder changes it too): its host's
  // `look`, the CSS above. With a picture of the sky (Blur Mode
  // Pre-rendered, hk-glass.js PINNED) it wears its slice of it under the
  // menu's tint instead of blurring the moving sky live.
  var PIN_TINT = 'linear-gradient(rgba(28,28,32,0.52),rgba(28,28,32,0.52))';
  function lookOf(g) {
    if (g === 'frosted' || g === 'tinted' || g === 'flat') return g;
    if (g === 'bright' || g === 'bright_pre' || g === 'bright_each') return 'bright';
    return 'blur';
  }
  function dress(el, up) {
    var g = document.documentElement.getAttribute('data-hk-glass') || 'blur';
    if (el.getAttribute('look') !== lookOf(g)) el.setAttribute('look', lookOf(g));
    var G = window.hkGlass, pane = el.shadowRoot && el.shadowRoot.querySelector('.pane');
    if (!G || !G.pin || !pane) return;
    if (up && g === 'blur_pre') G.pin(pane, PIN_TINT); else G.unpin(pane);
  }
  // at most once a frame, and again each second while it is up (the clock,
  // a countdown, a grace running out)
  var frame = 0;
  function soon() {
    if (frame) return;
    frame = requestAnimationFrame(function () { frame = 0; try { sync(); } catch (e) { console.error('[hk-sidepane]', e); } });
  }
  var lastPush = 0;
  function pushed() { var now = Date.now(); if (now - lastPush < 1000) return; lastPush = now; soon(); }
  function wire() {
    var SH = window.hkShell;
    if (SH && SH.onNavigate) SH.onNavigate(soon);
    window.addEventListener('popstate', soon);
    window.addEventListener('hashchange', soon);
    window.addEventListener('resize', soon);
    window.addEventListener('hk-popup-change', soon);
    window.addEventListener('hk-saver', soon);
    window.addEventListener('hk-module-ready', soon);
    window.addEventListener('hk-client-update', pushed);
    // the look changing (a setting, the slow tablets' ladder): the material
    try { new MutationObserver(soon).observe(document.documentElement, { attributes: true, attributeFilter: ['data-hk-glass'] }); } catch (e) { /* none */ }
    window.addEventListener('hk-view-ready', function (e) {
      var v = e && e.detail && e.detail.view;
      if (v && v.localName === 'hk-home-grid-view') grid = v;
      soon();
    });
    var waitSettings = function (n) {
      if (window.hkSettings && window.hkSettings.onChange) { window.hkSettings.onChange(soon); soon(); return; }
      if (n < 120) setTimeout(function () { waitSettings(n + 1); }, 500);
    };
    waitSettings(0);
    setInterval(function () { if (dash && dash.hasAttribute('on')) { dash._sig = null; soon(); } }, 15000);
    setInterval(function () { if (dash && dash.hasAttribute('on')) pushed(); }, 1000);
  }
  if (typeof document !== 'undefined' && document.addEventListener && !window.HK_SIDEPANE_NO_WIRE) wire();

  window.hkSidePane = {
    KINDS: KINDS, ORDER: ORDER, SIZES: SIZES, WIDTHS: WIDTHS, MAX: MAX,
    // the screensaver's own pane (hk-saver.js): an element it places itself
    create: function (mode) { var el = document.createElement('hk-side-pane'); el.setAttribute('mode', mode || 'saver'); return el; },
    // ONE SECTION AS A WIDGET (the Pages screen, Phase J): drawn as the pane draws it, filling the slot it's put in
    section: function (kind, size, slot) {
      if (!SEC[kind]) return null;
      var El = customElements.get('hk-side-pane'), el = new El(), w = (slot && slot.w) || DRAWN_W, h = (slot && slot.h) || 360;
      el.setAttribute('mode', 'widget');
      el.show({ list: [{ kind: kind, size: size || 'less' }], place: { kind: 'widget', w: w, h: h }, side: 'right' });
      return el;
    },
    // what the screensaver shows: its sections now, from the screen's Side Pane
    saverList: function (sp, c) { return shown(saverList(sp), function (s) { return has(c || clientNow(), s); }); },
    pane: paneOf,
    sync: sync,
    // tests
    _: { shown: shown, fit: fit, place: place, wants: wants, saverList: saverList, has: has, ringing: ringing, SEC: SEC,
         publish: publish, musicFlag: musicFlag, NOTES: NOTES, TODO: TODO, CAL: CAL }
  };
})();
