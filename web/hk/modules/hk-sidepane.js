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
// hk-menu.js narrows the page by it, hk-tabbar.js centers the bar beside it,
// the Home Grid lays itself in what is left (hk-layout.js). Always its Width
// (Narrow 360, Standard 400, Wide 480), beside a Home Grid too (2026-10-30). A tablet held upright gets a band under the page, its sections side
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
  var PAGE_MIN = 560;
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
    // ITS WIDTH, ALWAYS (2026-10-30; the owner: "I'm not sure the side pane
    // widths are working"): beside a Home Grid it once took whatever the grid
    // left, so on Home Narrow, Standard and Wide all came out the same. Now
    // the grid fits itself in what the pane leaves (it scales to any room),
    // so beside one there is no page minimum
    if (!(o.gridW > 0) && room - w < PAGE_MIN) return { kind: 'none' };
    if (o.gridW > 0 && room - w < WIDTHS.narrow) return { kind: 'none' };
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
  var FACE_COLORS = ['#ff9500', '#5856d6', '#34c759', '#ff2d55', '#32ade6'];
  // A picture that cannot load is the note or the initial, never the "?" (item 46: hkCards.artImg)
  function pic(url, o) {
    return C() && C().artImg ? C().artImg(url, o) : '<img' + (o.cls ? ' class="' + o.cls + '"' : '') + ' alt="" src="' + esc(url) + '">';
  }
  function clientNow() {
    var HC = window.hkHostClient;
    return (C() && C().client && C().client()) || (HC && HC.current && HC.current()) || null;
  }
  function HS() { return window.hkSettings; }
  function setting(path, fb) { var s = HS(); return s && s.get ? s.get(path, fb) : fb; }
  function states(c) { return (c && c.states) || {}; }
  function attr(st, k) { return st && st.attributes ? st.attributes[k] : undefined; }
  // (Mantel's own name first, hkCards.accName: a rename reaches the pane too, 2026-10-31)
  function nameOf(st, id) {
    var own = C() && C().accName && id ? C().accName(id) : null;
    return own || attr(st, 'friendly_name') || String(id || '').split('.').pop().replace(/_/g, ' ');
  }
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
  // A GLYPH TRIMMED TO ITS INK (2026-11-01, the owner: the glyph beside the temperature "just thrown there"): every
  // weather symbol sits in its 120 x 120 design square at a place and size of its own, so a box of one size put each
  // one's ink somewhere else. Measured once per symbol (an unseen copy's getBBox), its viewBox becomes its ink, and
  // the box it is drawn in (CSS) fits and centers it the same way whatever the symbol.
  var INK = {};
  function inkGlyph(cond, px) {
    var html = wxGlyph(cond, px), m = /viewBox="([^"]+)"/.exec(html);
    if (!m || typeof document === 'undefined' || !document.body) return html;
    var key = html.replace(/ style="[^"]*"/, '');
    if (!(key in INK)) {
      INK[key] = null;
      try {
        var tmp = document.createElement('div');
        tmp.style.cssText = 'position:absolute;left:-9999px;top:0;width:120px;height:120px;visibility:hidden';
        tmp.innerHTML = html;
        document.body.appendChild(tmp);
        var b = tmp.querySelector('svg').getBBox();
        tmp.remove();
        if (b && b.width > 0 && b.height > 0) INK[key] = [b.x, b.y, b.width, b.height].map(function (n) { return Math.round(n * 10) / 10; }).join(' ');
      } catch (e) { /* drawn as it comes */ }
    }
    return INK[key] ? html.replace(m[0], 'viewBox="' + INK[key] + '"') : html;
  }
  function deg(v) { var n = num(v); return n == null ? '–' : Math.round(n) + '°'; }
  // THE TEMPERATURE NOW, as the Weather block and page read it (hk-weather.js _nowTemp): Settings' outside sensor
  // when it names one and it reads, else the weather service's (2026-11-01, the owner: the pane said 56° beside a
  // block's 65°, the pane reading only the service's)
  function nowTemp(c, st) {
    var HS = window.hkSettings;
    if (HS && HS.nowTemp) return HS.nowTemp(states(c), st && st.entity_id);
    var out = setting('weather.outside', null), o = out && states(c)[out], v = o ? num(o.state) : null;   // (read by name: kept)
    return v !== null ? v : attr(st, 'temperature');
  }
  function ago(t) {
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' hr';
  }
  // A DOMAIN'S ENTITIES: the states here and the house's registry -- a page
  // Mantel has narrowed to what it reads holds no state for what only the
  // pane reads, so the registry names them, and reading one by name asks for
  // it (web/home.js keep). Listed from the states alone, the weather went
  // "No weather" on such a page (2026-10-30).
  function domainIds(c, dom) {
    var seen = {}, out = [];
    [states(c), (c && c.entities) || {}].forEach(function (o) {
      Object.keys(o).forEach(function (k) { if (k.indexOf(dom + '.') === 0 && !seen[k]) { seen[k] = 1; out.push(k); } });
    });
    return out.sort();
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
             pic: pic, at: dur ? Math.max(0, Math.min(1, t / dur)) : 0, left: dur ? Math.max(0, dur - t) : 0, vol: num(a.volume_level) };
  }
  // ...held a grace after it stops (All Screens -> Now Playing -> Hide After a Pause)
  function musicHas(c) {
    var m = musicOf(c);
    if (m && m.playing) { musicKey = m.key; musicAt = Date.now(); return true; }
    return !!m && Date.now() - musicAt < graceMs();
  }
  function timersOf(c) {
    var all = states(c), list = attr(all['sensor.running_quick_timers'], 'running');
    var out = (Array.isArray(list) ? list : []).filter(function (r) { return r && (r.finishes_at || r.remaining); });
    // (a paused quick timer, which the sensor lists no longer: there to resume, as on the Timers block)
    Object.keys(all).sort().forEach(function (id) {
      if (/^timer\.quick_/.test(id) && all[id].state === 'paused' && !out.some(function (r) { return r.entity_id === id; })) {
        out.push({ entity_id: id, name: attr(all[id], 'friendly_name'), remaining: attr(all[id], 'remaining') });
      }
    });
    return out;
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
  // today and the coming days, read again every five minutes.
  // NEVER STUCK (2026-11-01, the owner: "occasionally the calendar doesn't load"): a read with no answer in LOST
  // is given up -- one sent as the connection was made again never answers, and kept busy the pane never asked
  // again -- its late answer ignored; a failed read is tried again after LOST, not at every draw; and no
  // calendars known yet is no answer to keep for five minutes.
  var LOST = 30000;
  var CAL = { evs: null, at: 0, busy: false, days: 0, n: 0, failAt: 0 };
  function calLoad(c, days, done) {
    var K = window.hkCalendar;
    if (!K && !CAL.asked && typeof document !== 'undefined' && document.addEventListener) {
      // (its code, where no card of the page has brought it yet)
      CAL.asked = true;
      import(window.hkV ? window.hkV('/hk/cards/hk-calendar.js') : '/hk/cards/hk-calendar.js').then(done, function () { CAL.evs = []; done(); });
    }
    var now = Date.now();
    if (CAL.busy && now - CAL.busy > LOST) CAL.busy = false;
    if (!K || !K.load || !c || CAL.busy || now - CAL.failAt < LOST || (CAL.evs && now - CAL.at < 300000 && CAL.days >= days)) return;
    var ids = K.ids(c);
    if (!ids.length) return;
    var n = ++CAL.n;
    CAL.busy = now;
    var from = new Date(); from.setHours(0, 0, 0, 0);
    var to = new Date(from.getTime() + Math.max(2, days) * 86400000);
    K.load(c, ids, from, to).then(function (got) {
      if (n !== CAL.n) return;
      CAL.evs = (got && got.evs) || []; CAL.at = Date.now(); CAL.days = Math.max(2, days); CAL.busy = false; CAL.failAt = 0; done();
    }, function () { if (n !== CAL.n) return; CAL.busy = false; CAL.failAt = Date.now(); });
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
  // (2026-10-31: the Home Grid's To-do block reads the same lists, hkSidePane.todo -- so whoever asks while a
  // read is out is drawn again when it lands, not only the one that sent it)
  var TODO = {};
  function todoOf(c, eid, done, redraw) {
    var t = TODO[eid] || (TODO[eid] = { sig: null, got: null, busy: false, off: {}, wait: [], n: 0, failAt: 0 });
    var st = states(c)[eid], sig = st ? st.state + '|' + st.last_updated + '|' + !!done : null, now = Date.now();
    // (never stuck, as the calendar: a read unanswered in LOST given up, a failed one asked again after LOST)
    if (t.busy && now - t.busy > LOST) { t.busy = false; t.sig = null; }
    if (c && c.callWS && sig && sig !== t.sig && !t.busy && now - t.failAt >= LOST) {
      var n = ++t.n;
      t.busy = now; t.sig = sig; t.wait = [];
      var landed = function () { var w = t.wait || []; t.wait = []; w.forEach(function (f) { f(); }); };
      c.callWS({ type: 'hk_frontend/todo/items', entity_id: eid, completed: !!done }).then(function (got) {
        if (n !== t.n) return;
        t.busy = false; t.failAt = 0; t.got = got || null; t.off = {}; redraw(); landed();
      }, function (e) {
        if (n !== t.n) return;
        t.busy = false; t.sig = null; t.failAt = Date.now();
        t.got = t.got && !t.got.refused ? t.got : { items: [], refused: (e && e.code) || 'failed' }; redraw(); landed();
      });
    } else if (t.busy && redraw && (t.wait || (t.wait = [])).indexOf(redraw) < 0) t.wait.push(redraw);
    return t;
  }
  // CHECKED OFF: a house command (todo.update_item), struck through until the list says so; false when it is
  // already on its way. ADDED: todo.add_item. Both through the page's action port, as every command.
  function todoCheck(c, eid, uid) {
    var t = TODO[eid];
    if (!c || !c.actions || !eid || !uid || (t && t.off[uid])) return false;
    if (t) t.off[uid] = true;
    return c.actions.callService('todo', 'update_item', { item: uid, status: 'completed' }, { entity_id: eid })
      .catch(function (e) { if (t) delete t.off[uid]; throw e; });
  }
  function todoAdd(c, eid, txt) {
    return c.actions.callService('todo', 'add_item', { item: String(txt).slice(0, 200) }, { entity_id: eid });
  }

  // ------------------------------------------------------------ drawing
  function icon(name, extra) { return '<hk-icon icon="' + name + '"' + (extra || '') + '></hk-icon>'; }
  // A SECTION'S HEADING (2026-10-30): the small uppercase title -- text alone
  // since 2026-10-31 (the owner: "remove the glyph/icon... rather it just be
  // text"), as the pane's Section Headings say (the screen's Side Pane `headings`, on
  // by default) -- never over the Clock or the Weather, which say what they
  // are, nor on a Pages-screen widget. A to-do list keeps its own name either
  // way (which list is content). HEAD_ON is the drawing pane's, set as it draws.
  var HEAD_ON = true;
  function head(k) {
    if (!HEAD_ON || k === 'clock' || k === 'weather') return '';
    return '<div class="h2"><span>' + esc(KINDS[k][0]) + '</span></div>';
  }
  function tiny(k, txt, val) {
    return '<div class="sec cmp" data-k="' + k + '" data-size="tiny"><div class="r2">' + icon(KINDS[k][1]) +
      '<span class="tx">' + txt + '</span>' + (val ? '<span class="v2">' + val + '</span>' : '') + '</div></div>';
  }
  function box(k, size, inner, cls) {
    return '<div class="sec' + (cls ? ' ' + cls : '') + '" data-k="' + k + '" data-size="' + size + '">' + inner + '</div>';
  }
  // A LIST THAT GIVES WAY (2026-10-30, the owner: the calendar, the to-do list
  // and the like "should contract vertically when there isn't enough room"):
  // its rows in a .lst, the section a .shrink -- shorter where the pane is
  // short, the rows scrolling inside it, down to its heading and one row
  // (_floors); only past that does a size step down (fit)
  function lst(inner) { return '<div class="lst">' + inner + '</div>'; }
  // (r[4]: the entity a tap on the row opens, its own sheet)
  function rows(list) {
    return list.map(function (r) {
      return '<div class="r2' + (r[3] ? ' ' + r[3] : '') + '"' + (r[4] ? ' data-ent="' + esc(r[4]) + '"' : '') + '>' + (r[2] ? icon(r[2]) : '') + '<span class="tx">' + esc(r[0]) +
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

  // THE CLOCK SECTION'S LOOK (hk_core PANE_CHOICES; the "Side Pane clock styles" board, item 43): Face (Digital,
  // Stacked -- StandBy's hours over minutes -- or Analog, the Analog Numbers face small with the time and date
  // beside it), Alignment, Size (`scale`), Weight, AM/PM, Flashing Colon, Date, Second Line. What a section
  // leaves out is today's clock.
  var CLOCK_DEFAULTS = { face: 'digital', align: 'left', scale: 'medium', weight: 'semibold', date: 'full', line: 'auto', beside: 'none', below: 'auto' };
  function clockLook(sec) {
    var o = {};
    Object.keys(CLOCK_DEFAULTS).forEach(function (k) { o[k] = sec && sec[k] ? sec[k] : CLOCK_DEFAULTS[k]; });
    o.ampm = !(sec && sec.ampm === false);
    o.colon = !!(sec && sec.colon === true);
    return o;
  }
  // the classes a choice adds to the section (its type's size and weight, its alignment): none for today's
  function clockClasses(o) {
    var cls = '';
    if (o.align !== 'left') cls += ' cka-' + o.align;
    if (o.scale !== 'medium') cls += ' cks-' + o.scale;
    if (o.weight !== 'semibold') cls += ' ckw-' + o.weight;
    return cls;
  }
  // The colon flashes only where motion is allowed: not under Reduce Motion (the device's), Animations Off, or Flat
  // (hkSettings.skyLook().animations says all three)
  function motionOk() {
    try { var S = HS(); return !(S && S.skyLook && S.skyLook().animations === false); } catch (e) { return true; }
  }
  // the time: AM/PM only when the clock is a 12-hour one and the section shows it; the colon its own span when it flashes
  function timeHtml(now, o, flash) {
    var p = now.time.split(':');
    return '<span class="tm">' + esc(p[0]) + (flash ? '<span class="ckc">:</span>' : ':') + esc(p[1]) + (now.ampm && o.ampm ? '<small>' + now.ampm + '</small>' : '') + '</span>';
  }
  // STACKED: the hours over the minutes (StandBy's); no colon to flash and no AM/PM beside them
  function stackHtml(now) {
    var p = now.time.split(':');
    return '<span class="tm"><span>' + esc(p[0]) + '</span><span>' + esc(p[1]) + '</span></span>';
  }
  // the weather line: "64° Partly Cloudy" (the weather section's own reading); nothing while it has none
  function clockWeather(c) {
    var id = setting('weather.entity', null) || domainIds(c, 'weather')[0], st = id && (states(c)[id] || WX_LAST[id]);
    return st ? esc(deg(nowTemp(c, st)) + ' ' + condName(st.state)) : '';
  }
  // THE WEATHER BESIDE THE TIME (2026-10-31, the owner: "like we do for the left side bar menu"): the condition's glyph
  // and the temperature at the right of the time, the condition and today's high under them, as the menu's header
  // draws them (hk-menu.js); nothing until the weather is here
  // ...IN THE LOOK CHOSEN (2026-11-01, the owner: "give the user the choice"): `weather` Large, two thirds of the time
  // in its weight; `quiet` half the time, regular, the glyph in the date's gray; `chip` a small pill level with the
  // time; `date` on the date's line at the date's size, the time's row its own. Left puts it at the right, Right
  // mirrors it, Center stacks it under the time.
  function besideWeather(c, ctx, look) {
    var id = setting('weather.entity', null) || domainIds(c, 'weather')[0], st = id && (states(c)[id] || WX_LAST[id]);
    if (!st) return '';
    var daily = ctx && ctx.forecast ? ctx.forecast(id, 'daily') : [], d0 = daily[0] || {};
    var cond = condName(st.state), hi = d0.temperature != null ? 'H:' + deg(d0.temperature) : '', t = esc(deg(nowTemp(c, st)));
    var hl = hi ? '<span class="hl"> \u00b7 ' + esc(hi) + '</span>' : '';
    if (look === 'date') return { look: look, wt: '', sky: '<div class="sub2 ckxs dl2">' + inkGlyph(st.state, 18) + '<b>' + t + '</b><span class="cn"> ' + esc(cond) + '</span>' + hl + '</div>' };
    if (look === 'chip') return { look: look, wt: '<div class="ckx chip"><span class="pill">' + inkGlyph(st.state, 20) + '<b>' + t + '</b></span></div>',
                                  sky: '<div class="sub2 ckxs">' + esc(cond) + hl + '</div>' };
    // (two parts, each in its own place in the clock's grid: the temperature beside the time, the sky beside the date)
    return { look: look, wt: '<div class="ckx' + (look === 'quiet' ? ' q' : '') + '">' + inkGlyph(st.state, 34) + '<b>' + t + '</b></div>',
             sky: '<div class="sub2 ckxs">' + esc(cond) + hl + '</div>' };
  }

  // UNDER THE TIME (2026-10-31, the owner: at More the sunset "just kind of blends in ... something that spans the whole
  // way"): a strip the clock's width under the time and date, of the clock's own choosing -- the next hours, the
  // sun's day, the moon, or the conditions (wind, humidity, UV, sunset). '' when what it needs isn't here.
  var SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
  function moonAge(t) { var a = ((t - NEW_MOON) / 86400000) % SYNODIC; return a < 0 ? a + SYNODIC : a; }
  // its name: New, First Quarter, Full and Last Quarter only within a day of them (eight equal bins called 67 %
  // "Last Quarter"), the crescents and gibbous between
  function moonName(age) {
    var f = age / SYNODIC, near = 1 / SYNODIC;
    if (f < near || f > 1 - near) return 'New Moon';
    if (Math.abs(f - 0.25) < near) return 'First Quarter';
    if (Math.abs(f - 0.5) < near) return 'Full Moon';
    if (Math.abs(f - 0.75) < near) return 'Last Quarter';
    return (f < 0.5 ? 'Waxing ' : 'Waning ') + (f < 0.25 || f > 0.75 ? 'Crescent' : 'Gibbous');
  }
  // the moon drawn as it is tonight: its dark disc, the lit part bounded by the limb and the terminator (an ellipse)
  function moonSvg(age, px) {
    var r = 20, cx = 22, cy = 22, f = age / SYNODIC, k = Math.cos(2 * Math.PI * f), rx = Math.abs(k) * r, wax = f < 0.5;
    var lit = 'M' + cx + ' ' + (cy - r) + ' A' + r + ' ' + r + ' 0 0 ' + (wax ? 1 : 0) + ' ' + cx + ' ' + (cy + r) +
              ' A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + ((k > 0) === wax ? 0 : 1) + ' ' + cx + ' ' + (cy - r) + 'Z';
    return '<svg class="moon" viewBox="0 0 44 44" width="' + px + '" height="' + px + '" aria-hidden="true">' +
      '<circle cx="22" cy="22" r="20" fill="rgba(255,255,255,.14)"/><path d="' + lit + '" fill="#f2f0e6"/></svg>';
  }
  function underTime(kind, c, ctx) {
    var st = states(c), sun = st['sun.sun'], now = Date.now();
    var wid = setting('weather.entity', null) || domainIds(c, 'weather')[0], w = wid && (st[wid] || WX_LAST[wid]);
    if (kind === 'hours') {
      var hourly = w && ctx && ctx.forecast ? ctx.forecast(wid, 'hourly') : [];
      if (!hourly.length) return '';
      return '<div class="ckb hrs">' + hourly.slice(0, 5).map(function (h, i) {
        // (Now is the temperature now, as beside the time: nowTemp; the later hours the forecast's)
        return '<div>' + esc(i ? hm(new Date(h.datetime)).replace(':00', '') : 'Now') + wxGlyph(h.condition, 18) + '<b>' + esc(deg(i ? h.temperature : nowTemp(c, w))) + '</b></div>';
      }).join('') + '</div>';
    }
    if (kind === 'sun') {
      var rise = Date.parse(attr(sun, 'next_rising')), set = Date.parse(attr(sun, 'next_setting'));
      if (!isFinite(rise) || !isFinite(set)) return '';
      // the day it is in: by day the sunrise was today (the next one is tomorrow's); by night, the day to come
      var day = set < rise;
      if (day) rise -= 86400000;
      var p = day ? Math.max(0, Math.min(1, (now - rise) / (set - rise))) : 0, pt = function (t) { return [10 + t * 280, 52 - 42 * Math.sin(Math.PI * t)]; };
      var path = function (a, b) { var o = []; for (var i = 0; i <= 40; i++) { var q = pt(a + (b - a) * i / 40); o.push(q[0].toFixed(1) + ',' + q[1].toFixed(1)); } return o.join(' '); };
      var at = pt(p), len = Math.round((set - rise) / 60000);
      return '<div class="ckb cksun"><svg viewBox="0 0 300 60" aria-hidden="true">' +
        '<defs><linearGradient id="ckSunG" x1="0" x2="1"><stop offset="0" stop-color="#ff9f0a"/><stop offset="1" stop-color="#ffd60a"/></linearGradient></defs>' +
        '<line x1="0" y1="52" x2="300" y2="52" stroke="rgba(255,255,255,.22)" stroke-width="1"/>' +
        '<polyline points="' + path(0, 1) + '" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>' +
        (day && p > 0 ? '<polyline points="' + path(0, p) + '" fill="none" stroke="url(#ckSunG)" stroke-width="3" stroke-linecap="round"/>' : '') +
        (day ? '<circle cx="' + at[0].toFixed(1) + '" cy="' + at[1].toFixed(1) + '" r="9" fill="rgba(255,214,10,.25)"/><circle cx="' + at[0].toFixed(1) + '" cy="' + at[1].toFixed(1) + '" r="5.5" fill="#ffd60a"/>' : '') +
        '</svg><div class="sub2 cksl"><span>' + icon('mdi:weather-sunset-up') + esc(hm(new Date(rise))) + '</span><span class="ckdl">' +
        esc(Math.floor(len / 60) + 'h ' + (len % 60) + 'm of daylight') + '</span><span>' + icon('mdi:weather-sunset') + esc(hm(new Date(set))) + '</span></div></div>';
    }
    if (kind === 'moon') {
      var age = moonAge(now), f = age / SYNODIC, lit = Math.round((1 - Math.cos(2 * Math.PI * f)) / 2 * 100);
      var name = moonName(age), toFull = (SYNODIC / 2 - age + SYNODIC) % SYNODIC, toNew = SYNODIC - age;
      var next = toFull < toNew ? ['Full', toFull] : ['New', toNew], dn = Math.round(next[1]);
      var when = dn <= 0 ? 'tonight' : dn === 1 ? 'tomorrow' : 'in ' + dn + ' days';
      return '<div class="ckb ckmoon">' + moonSvg(age, 44) + '<div><b>' + esc(name) + '</b><div class="sub2">' + esc(lit + '% lit · ' + next[0] + ' Moon ' + when) + '</div></div></div>';
    }
    if (kind === 'conditions') {
      var a = (w && w.attributes) || {}, cols = [];
      var setT = Date.parse(attr(sun, 'next_setting')), riseT = Date.parse(attr(sun, 'next_rising'));
      if (isFinite(setT) && isFinite(riseT)) cols.push(setT < riseT ? ['mdi:weather-sunset', hm(new Date(setT)), 'Sunset'] : ['mdi:weather-sunset-up', hm(new Date(riseT)), 'Sunrise']);
      // (wind, humidity and UV from Settings -> Weather's sensors when it names them, as the Weather page: hkSettings.nowRead)
      var HS = window.hkSettings, rd = function (k, at) { return HS && HS.nowRead ? HS.nowRead(st, k, wid) : num(a[at]); };
      var windId = setting('weather.wind', null), windU = windId && st[windId] && num(st[windId].state) !== null
        ? attr(st[windId], 'unit_of_measurement') : a.wind_speed_unit, wind = rd('wind', 'wind_speed'), hum = rd('humidity', 'humidity');
      if (wind != null) cols.push(['mdi:weather-windy', Math.round(wind) + (windU ? ' ' + windU : ''), 'Wind']);
      if (hum != null) cols.push(['mdi:water-percent', Math.round(hum) + '%', 'Humidity']);
      var uv = rd('uv', 'uv_index');
      if (uv != null) cols.push(['mdi:white-balance-sunny', String(Math.round(uv)), 'UV']);
      if (!cols.length) return '';
      return '<div class="ckb ckrd" style="--n:' + cols.length + '">' + cols.map(function (x) {
        return '<div>' + icon(x[0]) + '<b>' + esc(x[1]) + '</b><span>' + esc(x[2]) + '</span></div>'; }).join('') + '</div>';
    }
    return '';
  }

  // EACH SECTION AT EACH SIZE: (size, sec, c, ctx) -> HTML. ctx.slot(key,
  // make) leaves a place for an element kept between draws (the music pane,
  // a doorbell's live camera); ctx.redraw() draws the pane again.
  var SEC = {
    clock: function (s, sec, c, ctx) {
      // THE CLOCK'S LOOK (2026-10-31, the owner's item 43): every choice's first value is today's clock, so a
      // section that sets none draws exactly what it did (the classes and the spans below are added only for
      // a choice made)
      var o = clockLook(sec), now = houseNow(c), d = now.day, flash = o.colon && motionOk();
      var t = timeHtml(now, o, flash);
      var cls = clockClasses(o);
      var dateText = o.date === 'off' ? '' : esc(o.date === 'short' ? dateShort(d) : dateLong(d));
      if (s === 'tiny') return tiny('clock', t, o.date === 'off' ? '' : esc(dateShort(d)));
      // THE SECOND LINE: Sunset or Weather, under the date (Automatic is today's: the sunset beside the date at
      // More; None is no second line at all)
      var set = attr(states(c)['sun.sun'], 'next_setting'), sunText = set ? 'Sunset ' + esc(hm(new Date(set))) : '';
      // (the weather beside the time: at Less and More, a digital or stacked face -- and then not its second line too)
      var wxBy = o.beside !== 'none' && (s === 'less' || s === 'more') && o.face !== 'analog' ? besideWeather(c, ctx, o.beside) : '';
      var extra = o.line === 'sunset' ? sunText : o.line === 'weather' && !wxBy ? clockWeather(c) : '';
      var second = extra ? '<div class="sub2 ck2">' + extra + '</div>' : '';
      if (s === 'full') {
        var big = o.face === 'stacked' ? '<div class="big2 ck stk">' + stackHtml(now) + '</div>' : faceSvg(now);
        return box('clock', s, '<div class="facebox">' + big + '</div>' + (dateText ? '<div class="sub2 ctr">' + dateText + '</div>' : '') + second, 'grow' + cls);
      }
      // LINED UP (2026-10-31, the owner: "the time's left edge with the
      // date's, AM on the baseline, date left / sunset right"): the digits
      // pulled back by their own side bearing, AM on their baseline, and
      // under them the date at the left and the sunset at the right
      // (UNDER THE TIME, at More: a strip of its own in the sunset's place -- underTime)
      var under = s === 'more' && o.below !== 'auto' && o.face !== 'analog' ? underTime(o.below, c, ctx) : '';
      var sun = o.line === 'auto' && s === 'more' && set && !under ? '<span class="sun">' + sunText + '</span>' : '';
      var dl = dateText ? '<span class="dl">' + dateText + '</span>' : '';
      var line = (dl || sun ? '<div class="sub2 ckd">' + dl + (sun && o.date === 'full' ? '<span class="ds">' + esc(dateShort(d)) + '</span>' : '') + sun + '</div>' : '') + second;
      if (o.face === 'analog') {
        // THE ANALOG NUMBERS FACE, small, with the time and the date beside it
        return box('clock', s, '<div class="ckan">' + faceSvg(now) + '<div class="ckt"><b>' + t + '</b>' + (dateText ? '<span class="sub2">' + dateText + '</span>' : '') +
          '</div></div>' + second, cls.trim());
      }
      var main = o.face === 'stacked' ? '<div class="big2 ck stk' + (s === 'less' ? ' less' : '') + '">' + stackHtml(now) + '</div>'
                                      : '<div class="big2 ck' + (s === 'less' ? ' less' : '') + '">' + t + '</div>';
      if (wxBy) {
        // (the date's line without the second line, which runs the whole width under both)
        var dateLine = dl || sun ? '<div class="sub2 ckd">' + dl + (sun && o.date === 'full' ? '<span class="ds">' + esc(dateShort(d)) + '</span>' : '') + sun + '</div>' : '<div class="ckd"></div>';
        return box('clock', s, '<div class="ckrow ckw-' + wxBy.look + '">' + main + wxBy.wt + dateLine + wxBy.sky + second + under + '</div>', (cls + ' ckby').trim());
      }
      return box('clock', s, main + line + under, cls.trim());
    },
    weather: function (s, sec, c, ctx) {
      var id = setting('weather.entity', null) || domainIds(c, 'weather')[0], st = id && states(c)[id];
      // (its state not here yet -- loading, a reconnect, a narrowed page asking
      // for it: the last one seen, never "No weather" while it comes)
      if (st) WX_LAST[id] = st; else if (id && WX_LAST[id]) st = WX_LAST[id];
      if (!st) return none('weather', s, id ? 'Getting the weather…' : 'No weather');
      var cond = condName(st.state);
      var daily = ctx.forecast(id, 'daily'), hourly = s === 'more' || s === 'full' ? ctx.forecast(id, 'hourly') : [];
      var d0 = daily[0] || {}, hl = d0.temperature != null ? 'H:' + deg(d0.temperature) + ' L:' + deg(d0.templow) : '';
      var now = deg(nowTemp(c, st));
      if (s === 'tiny') return tiny('weather', esc(now + ' ' + cond), esc(hl));
      var top = '<div class="wnow">' + wxGlyph(st.state, 44) + '<b>' + esc(now) + '</b><div class="sub2">' + esc(cond) + (hl ? '<br>' + esc(hl) : '') + '</div></div>';
      var hrs = hourly.slice(0, 5).map(function (h, i) {
        // (Now is the temperature now, as beside the time: nowTemp; the later hours the forecast's)
        return '<div>' + esc(i ? hm(new Date(h.datetime)).replace(':00', '') : 'Now') + wxGlyph(h.condition, 18) + '<b>' + esc(deg(i ? h.temperature : nowTemp(c, st))) + '</b></div>';
      }).join('');
      var days = s === 'full' ? rows(daily.slice(1, 4).map(function (x) {
        return [L() ? L().date(new Date(x.datetime), { weekday: 'long' }) : '', deg(x.temperature) + ' / ' + deg(x.templow), 'mdi:weather-' + wxIcon(x.condition)];
      })) : '';
      return box('weather', s, head('weather') + top + (s === 'less' || !hrs ? '' : '<div class="hrs">' + hrs + '</div>') + days);
    },
    calendar: function (s, sec, c, ctx) {
      ctx.calendar(sec.days || (s === 'full' ? 7 : s === 'more' ? 3 : 2));
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
      // LESS: the next two. MORE and FULL: every event in its Days (3 and 7
      // unless it says), scrolling inside the section where they don't all
      // fit -- the pane itself never scrolls (2026-10-30). A tap on one opens
      // its sheet (data-ev).
      var days = sec.days || (s === 'full' ? 7 : s === 'more' ? 3 : 2), end = new Date(); end.setHours(0, 0, 0, 0);
      end = end.getTime() + days * 86400000;
      var mine = s === 'less' ? evs.slice(0, 2) : evs.filter(function (e) { return evStart(e).getTime() < end; });
      if (!mine.length) mine = evs.slice(0, 1);
      CAL.shown = mine;
      // UNDER THEIR DAY (2026-10-31, the owner: "the date or day of the week before the events as a header, instead of
      // ... a second line"): Today, Tomorrow, then the weekday, once each; under each event only its time, or All day
      var dayOf = function (e) {
        var a = evStart(e), today = new Date(); today.setHours(0, 0, 0, 0);
        var n = Math.floor((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - today) / 86400000);
        if (n <= 0) return 'Today';
        if (n === 1) return 'Tomorrow';
        if (n < 7) { try { return L().date(a, { weekday: 'long' }); } catch (x) { /* below */ } }
        return dateShort(a);
      };
      var last = null;
      return box('calendar', s, head('calendar') + '<div class="evs' + (s === 'less' ? '' : ' scroll') + ' lst">' + mine.map(function (e, i) {
        var d = dayOf(e), hd = d !== last ? '<div class="evd">' + esc(d) + '</div>' : '';
        last = d;
        return hd + '<div class="ev" data-ev="' + i + '"><span class="cb" style="background:' + esc(ctx.evColor(e)) + '"></span><span class="et"><b>' +
          esc(e.title || 'Event') + '</b><i>' + esc(allDay(e) ? 'All day' : hm(evStart(e))) + '</i></span></div>';
      }).join('') + '</div>', 'shrink');
    },
    now_playing: function (s, sec, c, ctx) {
      var m = musicOf(c);
      if (!m) return none('now_playing', s, 'Not Playing');
      var pp = '<button type="button" class="pp" data-act="pp" aria-label="' + (m.playing ? 'Pause' : 'Play') + '">' +
               icon(m.playing ? 'mdi:pause' : 'mdi:play') + '</button>';
      if (s === 'tiny') return tiny('now_playing', esc(m.title || 'Playing'), pp);
      // LESS AND MORE, A MINI PLAYER (2026-10-31, the owner's pick of three):
      // the cover and the song on their own line; under it one row --
      // Speakers, back, play / pause (white, the largest), next, Browse -- the
      // screensaver's two at its ends, opening its panel over the pane
      // (musicPanel); then the volume, its speakers either side, a quiet 6 px
      // track in a 44 px place for a finger ("make sure the thin line for
      // volume is ok for a finger to use"). MORE is the same player a size up
      // ("one family"): a bigger cover and the song's progress over the row,
      // drawn by the compositor to the song's end (no redraw a second). FULL
      // stays the screensaver's own pane, below.
      if (s === 'less' || s === 'more') {
        var mk = function (act, name, ic, cls) { return '<button type="button" class="' + (cls || 'pp') + '" data-act="' + act + '" aria-label="' + name + '">' + icon(ic) + '</button>'; };
        var prog = s === 'more' ? '<div class="npp" role="progressbar" aria-label="Song" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(m.at * 100) + '"><i style="transform:scaleX(' + m.at.toFixed(4) + ')' +
          (m.playing && m.left > 0 ? ';animation:npp ' + Math.round(m.left) + 's linear forwards' : '') + '"></i></div>' : '';
        return box('now_playing', s, (s === 'more' ? head('now_playing') : '') + '<div class="r2 np' + (s === 'more' ? ' np2' : '') + '">' + (m.pic ? pic(m.pic, { cls: 'art', ph: 'note' }) : '<span class="art">' + icon('mdi:music') + '</span>') +
          '<span class="tx"><b>' + esc(m.title) + '</b><i>' + esc(m.artist) + '</i></span></div>' + prog +
          '<div class="trow">' + mk('spk', 'Speakers', 'mdi:speaker') + mk('prev', 'Previous', 'mdi:skip-previous', 'tk') +
          mk('pp', m.playing ? 'Pause' : 'Play', m.playing ? 'mdi:pause' : 'mdi:play', 'pp big') + mk('next', 'Next', 'mdi:skip-next', 'tk') +
          mk('brw', 'Browse Music', 'mdi:music-box-multiple') + '</div>' +
          (m.vol !== null ? '<div class="vol">' + icon('mdi:volume-high', ' class="lo"') + '<input type="range" min="0" max="100" step="1" data-act="vol" aria-label="Volume" value="' +
            Math.round(m.vol * 100) + '">' + icon('mdi:volume-high') + '</div>' : ''));
      }
      // FULL: the screensaver's music pane itself (hk-music-pane-card,
      // hk-saver.js): the art, the song, its buttons and volume, Up Next and
      // the Speakers / Browse panel -- the one view the dashboard shares --
      // taking the room left
      return '<div class="sec mp' + (s === 'full' ? ' grow' : ' compact') + '" data-k="now_playing" data-size="' + s + '">' + head('now_playing') + ctx.slot('np', 'hk-music-pane-card', function (el) {
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
      // ONLY WHAT IS OPEN (the owner, 2026-10-31: "if all windows, doors, and locks are closed and locked, I don't
      // really need to know that... I just need to know when something opens"): All Locked the all-clear, then
      // the windows and doors open, if any -- never "all windows closed"
      var n = function (k, one, many) { return k + ' ' + (k === 1 ? one : many) + ' open'; };
      if (s === 'less') {
        var gist = [lockLine, open.length ? n(open.length, 'window', 'windows') : '', doors.length ? n(doors.length, 'door', 'doors') : '']
          .filter(Boolean).join(' · ');
        // ONE LINE (2026-10-31, the owner: two lines "doesn't look great"): the state, and what is open at its right
        return box('security', s, head('security') + '<div class="r2 big">' + icon(KINDS.security[1], ' class="shield"') + '<span class="tx">' + esc(state) + '</span>' +
          (gist ? '<span class="v2 sub2">' + esc(gist) + '</span>' : '') + '</div>');
      }
      var list = locks.slice(0, s === 'full' ? 8 : 4).map(function (id) { var x = states(c)[id] || {}; return [nameOf(x, id), x.state === 'unlocked' ? 'Unlocked' : x.state === 'locked' ? 'Locked' : String(x.state || ''), x.state === 'unlocked' ? 'mdi:lock-open-variant' : 'mdi:lock', x.state === 'unlocked' ? 'warn' : '', id]; });
      // (More: the windows only when one is open; Full, the whole picture, says so either way)
      if (wins.length && (open.length || s === 'full')) list.push(['Windows', open.length ? open.length + ' open' : 'All closed', open.length ? 'mdi:window-open-variant' : 'mdi:window-closed-variant', open.length ? 'warn' : '']);
      if (s === 'full') {
        kinds('garage').slice(0, 2).forEach(function (id) { var x = states(c)[id] || {}; list.push([nameOf(x, id), x.state === 'open' || x.state === 'on' ? 'Open' : 'Closed', 'mdi:garage', '', id]); });
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
      // THE STILL, WHEN IT HAS LOADED (2026-10-31, the owner: "never the ?"): the camera's glyph on the dark plate
      // always, and the picture over it only once one has come (ctx.still: the last good address, else ''; _cams
      // fetches and refreshes it in place). THE NAME (the owner's item 33 for the blocks, 42 here): Hide unless
      // the section's Name says Show, or Automatic, which shows it on a short still only, as the blocks' cells do
      var url = ctx.still(id);
      return '<div class="sec cam2 ' + s + '" data-k="camera" data-size="' + s + '" data-cam="' + esc(id) + '" data-name="' + (sec.name || 'hide') + '">' +
        '<span class="cg" aria-hidden="true">' + icon(KINDS.camera[1]) + '</span>' +
        (url ? '<img alt="" src="' + esc(url) + '">' : '') + '<span class="cn">' + esc(nameOf(st, id)) + '</span></div>';
    },
    timers: function (s, sec, c) {
      var t = timersOf(c);
      var keys = '<div class="keys">' + [1, 5, 10, 30].map(function (n) {
        return '<button type="button" data-act="timer" data-min="' + n + '">' + n + ' min</button>';
      }).join('') + '</div>';
      // (none running: More and Full offer the quick ones, so a tap starts one)
      if (!t.length) return s === 'more' || s === 'full' ? box('timers', s, head('timers') + '<div class="sub2">No timers running</div>' + keys) : none('timers', s, 'No timers running');
      var left = function (r) {
        var ms = r.finishes_at ? Date.parse(r.finishes_at) - Date.now() : 0;
        if (!r.finishes_at && r.remaining) return String(r.remaining).replace(/^0:/, '');
        var x = Math.max(0, Math.round(ms / 1000)), h = Math.floor(x / 3600), m = Math.floor(x / 60) % 60, sx = x % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sx < 10 ? '0' : '') + sx;
      };
      if (s === 'tiny') return tiny('timers', esc(t[0].name || 'Timer'), '<span class="cd">' + esc(left(t[0])) + '</span>');
      // EACH TIMER (2026-10-31, the owner: "the ring is the pause (its centre
      // shows pause/play), a big red stop key", as the Timers block has them):
      // its ring of time left -- a tap pauses or resumes it -- its time and
      // its name, and the red Stop. The time is an <hk-countdown> (hk-timers.js),
      // which ticks on its own and hands the ring the fraction left
      // (--hk-left, on the row): the pane draws again only as its data changes.
      var T = window.hkTimers, all = states(c);
      return box('timers', s, head('timers') + lst(t.slice(0, s === 'full' ? 4 : 3).map(function (r) {
        var id = r.entity_id, x = id && all[id], a = (x && x.attributes) || {}, nm = esc(r.name || 'Timer');
        var paused = x ? x.state === 'paused' : !r.finishes_at;
        var total = num(r.duration_s || r.total) || (T && T.secs ? T.secs(a.duration) : 0) || 0;
        var rest = paused ? (T && T.secs ? T.secs(a.remaining || r.remaining) : 0) : Math.max(0, Math.round((Date.parse(r.finishes_at) - Date.now()) / 1000));
        var clock = paused ? 'hold="' + rest + '"' : 'deadline="' + Date.parse(r.finishes_at) + '"';
        var frac = total ? Math.max(0, Math.min(1, rest / total)) : 1;
        return '<div class="tmr" style="--hk-left:' + frac.toFixed(2) + '">' +
          (id ? '<button type="button" class="tpr" data-act="tp" data-timer="' + esc(id) + '" data-paused="' + (paused ? 1 : 0) + '" aria-label="' + (paused ? 'Resume ' : 'Pause ') + nm + '">' +
            '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45"></circle><circle class="l" cx="50" cy="50" r="45" pathLength="100"></circle></svg>' +
            icon(paused ? 'mdi:play' : 'mdi:pause') + '</button>' : '') +
          '<hk-countdown ' + clock + ' total="' + total + '">' + esc(left(paused ? { remaining: a.remaining || r.remaining } : r)) + '</hk-countdown>' +
          '<span class="tn">' + nm + '</span>' +
          (id ? '<button type="button" class="tst" data-act="tx" data-timer="' + esc(id) + '" aria-label="Stop ' + nm + '">' + icon('mdi:stop') + '</button>' : '') + '</div>';
      }).join('')) + (s === 'full' ? keys : ''), 'shrink');
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
      // LESS: what the house uses; MORE: with the panels and the battery, and
      // today's; FULL: the same, then each as a row with its sheet
      if (s === 'less') stats = '<div class="stats"><div><b>' + esc(kw(use)) + '</b>Using</div></div>';
      var more = s !== 'full' ? '' : rows([pid ? ['House', kw(use), 'mdi:home-lightning-bolt', '', pid] : null,
                                          solarId ? ['Solar', sol, 'mdi:weather-sunny', '', solarId] : null,
                                          bat ? ['Battery', Math.round(num(states(c)[bat].state) || 0) + ' %', 'mdi:home-battery', '', bat] : null].filter(Boolean));
      return box('energy', s, head('energy') + stats + (today ? '<div class="sub2">' + esc(today) + '</div>' : '') + more);
    },
    climate: function (s, sec, c) {
      var st = states(c), ids = domainIds(c, 'climate');
      var row = function (id) {
        var x = st[id] || {}, cur = attr(x, 'current_temperature'), set = attr(x, 'temperature'), act = attr(x, 'hvac_action');
        // (Less: its temperature; More and Full: where it is set to as well)
        return [nameOf(x, id), deg(cur) + (set != null && s !== 'less' ? ' → ' + deg(set) : ''), act === 'heating' ? 'mdi:fire' : act === 'cooling' ? 'mdi:snowflake' : 'mdi:thermostat', act === 'heating' ? 'heat' : act === 'cooling' ? 'cool' : '', id];
      };
      if (!ids.length) return none('climate', s, 'No thermostats');
      if (s === 'tiny') { var r0 = row(ids[0]), a0 = attr(st[ids[0]], 'hvac_action'); return tiny('climate', esc(r0[0] + ' ' + deg(attr(st[ids[0]], 'current_temperature'))), esc(a0 ? String(a0).replace(/^\w/, function (x) { return x.toUpperCase(); }) : '')); }
      var list = ids.slice(0, { less: 2, more: 4, full: 8 }[s]).map(row);
      if (s === 'full') {
        var w = setting('weather.entity', null) || domainIds(c, 'weather')[0], t = nowTemp(c, st[w]);
        if (t != null) list.push(['Outside', deg(t), 'mdi:home-thermometer']);
      }
      return box('climate', s, head('climate') + lst(rows(list)), 'shrink');
    },
    people: function (s, sec, c) {
      var st = states(c), ids = domainIds(c, 'person');
      if (!ids.length) return none('people', s, 'Nobody added');
      var home = ids.filter(function (id) { return (st[id] || {}).state === 'home'; }), away = ids.filter(function (id) { return home.indexOf(id) < 0; });
      if (s === 'tiny') return tiny('people', esc(home.length + ' home'), away.length ? esc(away.length + ' away') : '');
      var where = function (id) { var x = st[id] || {}; return x.state === 'home' ? 'Home' : x.state === 'not_home' ? 'Away' : String(x.state || '').replace(/_/g, ' '); };
      // FULL: each one, where and since when
      var since = function (id) { var t = Date.parse((st[id] || {}).last_changed); return t ? ' · ' + ago(t) : ''; };
      if (s === 'full') return box('people', s, head('people') + lst(rows(ids.slice(0, 8).map(function (id) { return [nameOf(st[id], id), where(id) + since(id), 'mdi:account', '', id]; }))), 'shrink');
      var av = '<div class="ppl" style="--n:' + Math.min(5, ids.length) + '">' + ids.slice(0, 5).map(function (id, i) {
        var x = st[id] || {}, pic_ = attr(x, 'entity_picture'), nm = nameOf(x, id);
        var face = pic_ ? pic(pic_, { ph: 'av', ini: nm.charAt(0).toUpperCase(), color: FACE_COLORS[i % 5] }) : esc(nm.charAt(0).toUpperCase());
        return '<div data-ent="' + esc(id) + '" class="' + (x.state === 'home' ? '' : 'away') + '"><i style="background:' + FACE_COLORS[i % 5] + '">' + face + '</i>' + esc(nm.split(' ')[0]) + '</div>';
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
      var h = '<div class="h2"><span>' + esc(name) + '</span></div>';
      if (!got) return box('todo', s, h + '<div class="sub2">Reading the list…</div>');
      if (got.refused) return box('todo', s, h + '<div class="sub2">' + esc(got.refused === 'commands_disabled' ? 'Can’t read the list while control of the house is off.' : 'Can’t read the list.') + '</div>');
      var items = (got.items || []).slice(0, { less: 2, more: 4, full: 6 }[s]);
      var list = items.map(function (it) {
        var done = it.done || t.off[it.uid];
        return '<button type="button" class="it' + (done ? ' done' : '') + '" data-act="todo" data-list="' + esc(eid) + '" data-uid="' + esc(it.uid) + '"' +
          (it.done ? ' disabled' : '') + ' aria-label="Check off ' + esc(it.summary) + '"><i></i><span>' + esc(it.summary) + '</span></button>';
      }).join('');
      var add = s === 'full' ? '<form class="add" data-list="' + esc(eid) + '"><input name="item" placeholder="Add an item" aria-label="Add an item to ' + esc(name) + '" autocomplete="off"><button type="submit" aria-label="Add">' + icon('mdi:plus') + '</button></form>' : '';
      return box('todo', s, h + '<div class="todo lst">' + (list || '<div class="sub2">Nothing left</div>') + '</div>' + add, 'shrink');
    },
    notifications: function (s) {
      var n = notesOf();
      if (!n.length) return none('notifications', s, 'No notifications');
      if (s === 'tiny') return tiny('notifications', esc(n[0].text), esc(ago(n[0].at)));
      return box('notifications', s, head('notifications') + lst(rows(n.slice(0, { less: 1, more: 3, full: 5 }[s]).map(function (x) { return [x.text, ago(x.at)]; }))), 'shrink');
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
  var ART = 64, ART_MEAN = 78, ART_MAX = 132;
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
    // ITS BRIGHTNESS, EVENED OUT (2026-10-30): a fixed darkening made a dark
    // cover all but black ("the Side Pane is solid black"). Each pixel scaled
    // so the art's mean sits at ART_MEAN -- a dark cover lifted, a light one
    // held down -- and none past ART_MAX, so white words over it (under the
    // shade) keep 4.5:1 however light the cover
    try {
      var px = ctx.getImageData(0, 0, ART, ART), dd = px.data, lum = function (i) { return 0.2126 * dd[i] + 0.7152 * dd[i + 1] + 0.0722 * dd[i + 2]; }, sum2 = 0;
      for (var p = 0; p < dd.length; p += 4) sum2 += lum(p);
      var k = Math.max(0.3, Math.min(2.6, ART_MEAN / Math.max(1, sum2 / (dd.length / 4))));
      for (var q = 0; q < dd.length; q += 4) {
        dd[q] *= k; dd[q + 1] *= k; dd[q + 2] *= k;
        var l = lum(q);
        if (l > ART_MAX) { var f = ART_MAX / l; dd[q] *= f; dd[q + 1] *= f; dd[q + 2] *= f; }
      }
      ctx.putImageData(px, 0, 0);
    } catch (e) { ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(0, 0, ART, ART); }
    try { out.url = c.toDataURL('image/png'); } catch (e) { out.url = null; }
    return out;
  }

  // ------------------------------------------------------------ the CSS
  // Built on first use: never hkCards while this file loads (DESIGN.md
  // Rules 1). Logical sizes (a 400 px pane), scaled whole by the pane.
  // (built before hkCards has come, the design values have fallbacks of their
  // own, and it is not kept: drawn again once hkCards is here -- the pane
  // hangs under <body>, where no --hk-* value is set, and a sheet built
  // without fallbacks lost its hairlines and its second ink for good, on
  // whichever load drew it first -- the owner's dividers that came and went,
  // 2026-10-30)
  var CSS = null, BARE = { ink: '#fff', 'ink-2': 'rgba(235,235,245,0.6)', line: 'rgba(255,255,255,0.14)',
    'line-strong': 'rgba(255,255,255,0.22)', key: 'rgba(118,118,128,0.24)', 'key-strong': 'rgba(118,118,128,0.36)' };
  var WX_LAST = {};
  function cssReady() { var K = C(); return !!(K && K.v); }
  function css() {
    if (CSS) return CSS;
    var K = C(), v = K && K.v ? K.v : function (n) { return 'var(--hk-' + n + (BARE[n] ? ',' + BARE[n] : '') + ')'; }, R = (K && K.SP && K.SP.cardR) || 20;
    var out = [
      // (above the page, as Now Playing's pane was; under the menu, the tab bar and every sheet)
      ':host{position:fixed;z-index:5;display:none;box-sizing:border-box;color:' + v('ink') + ';font-family:var(--hk-font-body,inherit);',
      '  -webkit-tap-highlight-color:transparent;contain:layout style}',
      ':host([on]){display:block}',
      // (going: drawn while it slides away, never pressed -- _slide)
      ':host([leaving]:not([on])){display:block;pointer-events:none}',
      // (a swipe toward a page that has it: shown under the finger before it is on -- FOLLOW)
      ':host([peek]:not([on])){display:block;pointer-events:none}',
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
      // DIM (the pane's Dim, dress() below): a shade over the glass and the album art, under the words
      ':host([dim]) .pane::before{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;background:rgba(0,0,0,var(--pane-dim,0))}',
      ':host([dim]) .pin{z-index:2}',
      ':host([mode="saver"]) .pane::before,:host([mode="widget"]) .pane::before{display:none}',
      // IN THE SCREENSAVER: on its pane's own background, under Home Status
      ':host([mode="saver"]) .pane{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:0;box-shadow:none}',
      // THE ALBUM ART behind the whole pane while a song plays (_artBg): two
      // canvases cross-fading, a shade for the words; a flat tint where the
      // look has no blur
      '.artbg{position:absolute;inset:0;opacity:0;transition:opacity 1.2s ease;pointer-events:none;overflow:hidden;background:#141418}',
      ':host([arted]) .artbg{opacity:1}',
      '.artbg b{position:absolute;left:-8%;top:-8%;width:116%;height:116%;display:block;opacity:0;transition:opacity 1.2s ease;background-size:100% 100%}',
      '.artbg b.on{opacity:1}',
      '.artbg b.raw{background-size:cover;background-position:center;filter:blur(40px) brightness(.7)}',
      '.artbg i{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(6,10,18,.24),rgba(6,10,18,.34))}',
      ':host([arttint]) .artbg{background:var(--art-tint,#1c1c22)}:host([arttint]) .artbg b,:host([arttint]) .artbg i{display:none}',
      '@media (prefers-reduced-motion:reduce){.artbg,.artbg b{transition:none}}',
      '.pin{position:absolute;left:0;top:0;transform-origin:0 0;box-sizing:border-box;display:flex;flex-direction:column;padding:30px 28px 26px}',
      ':host([side="band"]) .pin{padding:20px 24px}',
      ':host([mode="saver"]) .pin{padding:4px 28px 22px}',
      ':host([mode="widget"]) .pane{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:0;box-shadow:none}',
      ':host([mode="widget"]) .pin{padding:0}',
      // THE SAME ROOM ABOVE AS AT THE SIDE (2026-10-31, the owner: "so much buffer/padding above the time"): the
      // pane's 30 px, the first section's own 14 and the clock's leading put its digits ~55 px down against 28 at the
      // right. Beside the page: the top inset the sides', the first section none of its own, and the big time trimmed
      // to its figures' height (text-box; where a browser has none, only the leading is left)
      ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .pin{padding-top:28px;padding-bottom:28px}',
      // ...and at the foot the same (2026-10-31, the owner: room under Security): the last section none of its own
      ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .secs>.sec:last-child:not(.cam2):not(.mp){padding-bottom:0}',
      ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .secs>.sec:first-child:not(.cam2):not(.mp){padding-top:0}',
      ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .secs>.sec[data-k="clock"]:first-child .big2{text-box:trim-start cap alphabetic}',
      ':host([mode="widget"]) .secs>.sec{flex:1 1 auto}',
      '.secs{display:flex;flex-direction:column;gap:12px;flex:1 1 auto;min-height:0;overflow:hidden}',
      // (...room at its sides for what reaches a little past a section's edge -- the clock's digits pulled back by
      // their side bearing: this column's clip still cut the 8 and the 9, 2026-10-31, the owner -- given back by a
      // margin, so nothing moves)
      ':host(:not([mode="widget"])) .secs{padding:0 8px;margin:0 -8px}',
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
      // (the Clock's Size and Weight are --cks and --ckw, set by a section's classes; unset they are today's 72 / 48 px, 600)
      '.big2{font:var(--ckw,600) calc(72px*var(--cks,1))/1 var(--hk-font-body,inherit);letter-spacing:calc(-2px*var(--cks,1));font-variant-numeric:tabular-nums}',
      '.big2.less{font-size:calc(48px*var(--cks,1));letter-spacing:calc(-1.2px*var(--cks,1))}',
      '.cks-small{--cks:.75}.cks-large{--cks:1.25}.ckw-light{--ckw:300}.ckw-regular{--ckw:400}.ckw-bold{--ckw:700}',
      '.tm{white-space:nowrap}.tm small{font-size:.36em;font-weight:600;letter-spacing:0;margin-left:.18em;color:' + v('ink-2') + '}',
      // (the Clock lined up: the digits' side bearing taken back, so their ink starts where the date's does; AM
      // on their baseline; the date at the left, the sunset at the right)
      '.ck .tm{display:flex;align-items:baseline;margin-left:-0.05em}.ck .tm small{margin-left:.14em}',
      '.ckd{display:flex;justify-content:space-between;align-items:baseline;gap:4px 12px;flex-wrap:wrap}.ckd>*{white-space:nowrap}.ckd .sun{margin-left:auto}',
      // (a narrow pane: the date short, "Sat, Oct 31", so the sunset keeps its place at the right of it)
      '.sec[data-k="clock"]{container-type:inline-size}.ckd .ds{display:none}',
      // (the digits pulled back by their side bearing reach past the section's edge -- beside the page a section has
      // no side padding, and its clip cut the 8's left side off: 2026-10-31, the owner. The clock is never scrolled)
      '.sec[data-k="clock"]:not(.grow){overflow:visible}',
      // THE WEATHER BESIDE THE TIME (besideWeather): two rows on two baselines (2026-10-31, the owner: the date and the
      // sky "should line up") -- the time and the temperature, their figures on one baseline (the temperature two
      // thirds of the time's size, so it sits lower rather than growing heavy); the date and the sky on the next. The
      // time's side takes the room; the weather's is as wide as it needs. A second line runs under both
      '.ckrow{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"t w" "d s";column-gap:12px;row-gap:8px;align-items:baseline}',
      '.ckrow>.big2{grid-area:t;min-width:0}.ckrow>.ckx{grid-area:w}.ckrow>.ckd{grid-area:d;min-width:0}.ckrow>.ckxs{grid-area:s}.ckrow>.ck2{grid-column:1 / -1}',
      '.ckx{justify-self:end;white-space:nowrap;font:var(--ckw,600) calc(48px*var(--cks,1))/1 var(--hk-font-body,inherit);letter-spacing:calc(-1px*var(--cks,1))}',
      // (the figures are a <b>, which a browser draws a step BOLDER than the clock's own weight: 56° heavier than the
      // time it sits beside -- 2026-11-01, the owner. They take the clock's weight, as the time does)
      '.ckx b{font-weight:inherit}',
      // (the time's row ends at its figures' baseline, and the temperature's: the date sits the row gap under them,
      // not under the room a line of 48 px figures keeps below them -- 2026-11-01, the owner, on the mock-ups)
      '.ckrow>.big2,.ckrow>.ckx:not(.chip){text-box:trim-end cap alphabetic}.ckrow{row-gap:10px}',
      // (...and the first section's, whose top is trimmed to the figures' cap already: both ends)
      ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .secs>.sec[data-k="clock"]:first-child .ckrow>.big2{text-box:trim-both cap alphabetic}',
      // QUIET: half the time's size, regular, the glyph in the date's gray
      '.ckx.q{font-weight:400;font-size:calc(34px*var(--cks,1));letter-spacing:0}.ckrow:has(.big2.less)>.ckx.q{font-size:calc(26px*var(--cks,1))}',
      '.ckx.q .wxg,.ckx.q hk-icon{opacity:.75}',
      // A CHIP: a small pill, level with the time's middle
      '.ckrow>.ckx.chip,.ckrow:has(.big2.less)>.ckx.chip{align-self:center;font:600 calc(20px*var(--cks,1))/1 var(--hk-font-body,inherit);letter-spacing:0}',
      '.ckx.chip .pill{display:inline-block;padding:9px 14px;border-radius:999px;background:' + v('line') + ';text-box:trim-both cap alphabetic;white-space:nowrap}',
      '.ckx.chip .wxg,.ckx.chip hk-icon{--gh:1.05em;--gg:.3em}',
      // ON THE DATE LINE: the time has its row to itself; the weather at the date's size, on the date's line
      '.ckrow.ckw-date{grid-template-areas:"t t" "d s"}.cka-right .ckrow.ckw-date{grid-template-areas:"t t" "s d"}',
      '.ckxs.dl2{color:' + v('ink-2') + '}.ckxs.dl2 b{font-weight:600;color:' + v('ink') + ';margin-right:.25em}',
      '.ckxs.dl2 .wxg,.ckxs.dl2 hk-icon{--gh:1.15em;--gg:.3em;opacity:.85}',
      '.cka-center .ckrow.ckw-date{grid-template-areas:"t" "d" "s"}',
      // (a narrow pane: the date and the temperature keep the line; the sky's words go -- centered, it has a line of its own)
      '@container (max-width:340px){.ckby:not(.cka-center) .dl2 .cn{display:none}}',
      // (the glyph inline, centered on the figures, so the line's baseline is the figures')
      // (centered on the figures: the glyph's drawing sits low in its box -- its ink measured 5 px under the digits' at 36 px,
      // 2026-11-01, the owner: "the glyph/icon sitting too low" -- so the box is raised by that, a seventh of the size)
      // THE GLYPH'S BOX, every look the same way (its ink is the viewBox: inkGlyph): --gh tall, wider than tall so a wide
      // symbol is as tall as a square one, its middle on the middle of the figures' caps (SF's cap height, .705 em),
      // --gg from the figures. A Material stand-in (no glyphs uploaded) keeps its own padding.
      '.ckx .wxg,.ckx hk-icon,.dl2 .wxg,.dl2 hk-icon{--gh:.82em;--gg:.24em;display:inline-block;width:calc(var(--gh) * 1.3);height:var(--gh);--mdc-icon-size:var(--gh);',
      '  vertical-align:calc(.3525em - var(--gh) / 2);margin-right:var(--gg);flex:none}',
      '.ckx .wxg svg,.dl2 .wxg svg{display:block;width:100%!important;height:100%!important;vertical-align:0!important}',
      '.ckxs{justify-self:end;text-align:right;white-space:nowrap}',
      '.ckrow:has(.big2.less)>.ckx{font-size:calc(36px*var(--cks,1))}',
      // (a narrow pane: the high goes, then the date's long form -- the time keeps its room)
      '@container (max-width:300px){.ckxs .hl{display:none}}',
      // (the time at the right: the weather at the left, mirrored -- 2026-10-31, the owner; centered: under the time)
      '.cka-right .ckrow{grid-template-columns:auto minmax(0,1fr);grid-template-areas:"w t" "s d"}',
      '.cka-right .ckx,.cka-right .ckxs{justify-self:start;text-align:left}',
      '.cka-center .ckrow{grid-template-columns:1fr;grid-template-areas:"t" "d" "w" "s";justify-items:center}.cka-center .ckx,.cka-center .ckxs{justify-self:center;text-align:center}',
      '.cka-center .ckrow>.ckx{margin-top:10px}',
      // ...and the date's line beside the weather has no room for the sunset at its right (it wrapped under, off to
      // the side -- 2026-10-31): there the sunset is a line of its own under the date, on the time's side
      '.ckby .ckd{flex-direction:column;flex-wrap:nowrap;gap:4px}.ckby .ckd .sun{margin-left:0}',
      // UNDER THE TIME (underTime): the clock's width, under a hairline, whatever the alignment
      '.ckb{border-top:1px solid ' + v('line') + ';padding-top:12px;margin-top:4px;text-align:left;justify-self:stretch;width:100%;box-sizing:border-box}',
      '.ckrow>.ckb{grid-column:1 / -1}',
      '.ckb.hrs{text-align:center}',
      // ...the sun's day: its arc, gone over in the sun's colours, the sun where it is; sunrise, daylight, sunset
      '.cksun svg{display:block;width:100%;height:auto;overflow:visible}',
      '.cksl{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;white-space:nowrap}',
      '.cksl span{display:inline-flex;align-items:center;gap:4px}.cksl hk-icon{--mdc-icon-size:16px;width:16px;height:16px;color:#ffd60a}',
      '@container (max-width:300px){.cksl .ckdl{display:none}}',
      // ...the moon: tonight's, drawn, its name and how much is lit, the next full or new moon
      '.ckmoon{display:flex;align-items:center;gap:14px}.ckmoon .moon{flex:none;filter:drop-shadow(0 0 6px rgba(242,240,230,.25))}',
      '.ckmoon b{display:block;font:600 17px/1.3 var(--hk-font-body,inherit)}',
      // ...the conditions: up to four readings, each its glyph, its value and its name
      '.ckrd{display:grid;grid-template-columns:repeat(var(--n,4),1fr);text-align:center;gap:6px}',
      '.ckrd hk-icon{--mdc-icon-size:20px;width:20px;height:20px;display:block;margin:0 auto 4px;color:' + v('ink-2') + '}',
      '.ckrd b{display:block;font:600 16px/1.25 var(--hk-font-body,inherit);white-space:nowrap}.ckrd span{display:block;font:500 12px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
      '.ckby.cka-right .ckd{align-items:flex-end}.ckby.cka-center .ckd{align-items:center}',
      '@container (max-width:320px){.ckd .ds{display:inline}.ckd:has(.ds) .dl{display:none}}',
      // THE CLOCK'S CHOICES (item 43): Stacked (the hours over the minutes), Analog (the small face with the time and date
      // beside it), Alignment, the second line, and the flashing colon (held under Reduce Motion as well as by skyLook())
      '.big2.stk{font-size:calc(60px*var(--cks,1));line-height:.92;letter-spacing:calc(-1.5px*var(--cks,1))}.big2.stk.less{font-size:calc(40px*var(--cks,1))}',
      '.stk .tm{display:flex;flex-direction:column;align-items:flex-start;margin-left:-0.05em}',
      '.sec[data-k="clock"].grow .big2.stk{font-size:calc(120px*var(--cks,1))}',
      '.ckan{display:flex;align-items:center;gap:16px;min-width:0}',
      '.ckan .face{width:calc(88px*var(--cks,1));height:auto;flex:none}.sec[data-size="less"] .ckan .face{width:calc(68px*var(--cks,1))}',
      '.ckt{display:grid;gap:4px;min-width:0}.ckt b{font:var(--ckw,600) calc(24px*var(--cks,1))/1.1 var(--hk-font-body,inherit);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.ckt .sub2{font-size:calc(15px*var(--cks,1))}.sub2.ck2{font-size:15px}',
      '.cka-center,.cka-center .sub2{text-align:center}.cka-right,.cka-right .sub2{text-align:right}',
      '.cka-center .ck .tm,.cka-center .ckd,.cka-center .ckan{justify-content:center}.cka-right .ck .tm,.cka-right .ckd,.cka-right .ckan{justify-content:flex-end}',
      '.cka-center .ckd .sun,.cka-right .ckd .sun{margin-left:0}.cka-right .ck .tm{margin-left:0}',
      '.cka-center .stk .tm{align-items:center;margin-left:0}.cka-right .stk .tm{align-items:flex-end}',
      '.cka-right .facebox{justify-items:end}',
      '@keyframes ckblink{0%,49%{opacity:1}50%,100%{opacity:.25}}.ckc{animation:ckblink 2s steps(1) infinite}',
      '@media (prefers-reduced-motion:reduce){.ckc{animation:none}}',
      '.wxg{display:inline-grid;place-items:center;flex:none}.hrs .wxg{display:grid;margin:2px auto}',
      '.sub2{font:500 17px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
      '.sub2.ctr{text-align:center}',
      '.r2{display:flex;align-items:center;gap:10px;font:600 17px/1.3 var(--hk-font-body,inherit);min-width:0}',
      '.r2 hk-icon{--mdc-icon-size:22px;width:22px;height:22px;flex:none}',
      '.r2 .tx{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.r2 .v2{margin-left:auto;color:' + v('ink-2') + ';font-weight:500;white-space:nowrap}',
      '.r2.warn .v2,.r2.heat hk-icon{color:#ff9f0a}.r2.cool hk-icon{color:#64d2ff}',
      '.r2.big{font-size:22px}.r2.big hk-icon{--mdc-icon-size:30px;width:30px;height:30px;color:#30b0c7}',
      // (Security at Less: what is open at the right, on the state's baseline, at the second line's size)
      '.r2.big .v2.sub2{align-self:baseline;font:500 15px/1.3 var(--hk-font-body,inherit);flex:none}.r2.big:has(.v2) .tx{align-self:baseline}',
      '.cd{font-variant-numeric:tabular-nums;color:#ff9f0a}',
      // A TIMER'S ROW: the ring (the pause) at the left, the time over its name, the red Stop at the right
      '.tmr{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"r t s" "r n s";column-gap:12px;align-items:center;--ring:56px}',
      '.tmr hk-countdown{grid-area:t;align-self:end;font:400 24px/1.15 var(--hk-font-body,inherit);font-variant-numeric:tabular-nums;color:' + v('ink') + '}',
      '.tmr .tn{grid-area:n;align-self:start;min-width:0;font:500 14px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tpr,.tst{all:unset;box-sizing:border-box;position:relative;display:grid;place-items:center;border-radius:50%;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.tpr{grid-area:r;width:var(--ring);height:var(--ring)}',
      '.tpr svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}',
      '.tpr circle{fill:none;stroke-width:10px;stroke:' + v('line-strong') + '}',
      '.tpr .l{stroke:#ff9f0a;stroke-linecap:round;stroke-dasharray:calc(var(--hk-left,1)*100) 100}',
      '.tpr hk-icon{position:relative;--mdc-icon-size:20px;width:20px;height:20px;color:#ff9f0a}',
      '.tst{grid-area:s;width:44px;height:44px;background:#ff453a}',
      '.tst hk-icon{--mdc-icon-size:20px;width:20px;height:20px;color:#fff}',
      '.tpr:active,.tst:active{transform:scale(0.95)}',
      '.tpr:focus-visible,.tst:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      '.sec[data-size="less"] .tmr{--ring:44px}.sec[data-size="less"] .tmr hk-countdown{font-size:20px}',
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
      // a day's heading over its events (the last event before the next day keeps no rule under it)
      '.evd{font:600 13px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + ';padding:12px 0 2px}',
      '.evd:first-child{padding-top:0}',
      '.ev:has(+ .evd){border-bottom:0}',
      '.np .art{width:56px;height:56px;border-radius:10px;object-fit:cover;flex:none;background:' + v('key') + ';display:grid;place-items:center}',
      '.np .tx b{display:block;overflow:hidden;text-overflow:ellipsis}.np .tx i{display:block;font:500 15px/1.3 var(--hk-font-body,inherit);font-style:normal;color:' + v('ink-2') + ';overflow:hidden;text-overflow:ellipsis}',
      '.pp{all:unset;cursor:pointer;flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:' + v('key') + '}',
      '.pp hk-icon{--mdc-icon-size:22px;width:22px;height:22px}',
      '.cmp .pp{width:30px;height:30px}',
      '.trow{display:flex;align-items:center;justify-content:space-between;margin-top:12px}',
      '.tk{all:unset;cursor:pointer;display:grid;place-items:center;width:44px;height:44px;border-radius:50%}.tk hk-icon{--mdc-icon-size:30px;width:30px;height:30px}',
      '.tk:active{background:' + v('key') + '}',
      '.pp.big{width:52px;height:52px;background:#fff;color:#1c1c1e}.pp.big hk-icon{--mdc-icon-size:30px;width:30px;height:30px;color:#1c1c1e}',
      '.vol{display:flex;align-items:center;gap:10px;margin-top:4px}',
      '.np2 .art{width:88px;height:88px;border-radius:12px}.np2 .tx b{font-size:20px}',
      '.npp{height:4px;border-radius:2px;background:' + v('line-strong') + ';overflow:hidden;margin-top:14px}',
      '.npp i{display:block;height:100%;background:' + v('ink') + ';transform-origin:left center}',
      '@keyframes npp{to{transform:scaleX(1)}}',
      '@media (prefers-reduced-motion:reduce){.npp i{animation:none!important}}',
      // (each speaker a centered box: hk-icon's own box is inline, so the small one sat on its text line, below the
      // slider's -- the owner, 2026-11-01)
      '.vol hk-icon{--mdc-icon-size:20px;width:20px;height:20px;color:' + v('ink-2') + ';flex:none;display:flex;align-items:center;justify-content:center}.vol hk-icon.lo{--mdc-icon-size:14px;width:14px;height:14px}',
      '.vol input{flex:1;min-width:0;-webkit-appearance:none;appearance:none;height:44px;background:transparent;margin:0;touch-action:pan-y;cursor:pointer}',
      '.vol input::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:' + v('line-strong') + '}',
      '.vol input::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-8px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3)}',
      '.vol input::-moz-range-track{height:6px;border-radius:3px;background:' + v('line-strong') + '}',
      '.vol input::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:50%;background:#fff}',
      // the screensaver's music pane, in a section: More is its art and
      // controls at the pane's width; Full takes what is left
      '.sec.mp{padding:0;display:block;position:relative;height:540px;background:none;overflow:visible}',
      '.sec.mp.grow{height:auto;min-height:540px}',
      // (More: the compact player, its Up Next and album left out)
      '.sec.mp.compact{height:430px}',
      // AT THE FOOT: the space between the top sections and the bottom ones
      '.secs>.gap{flex:1 1 auto;min-height:0;border:0}',
      ':host([side="band"]) .secs>.gap{flex:0 0 0}',
      // THE CALENDAR'S EVENTS at More and Full: scrolling inside the section
      // where they don't all fit (the pane never scrolls), Full taking the
      // room left
      '.evs.scroll{max-height:300px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
      '.evs.scroll::-webkit-scrollbar{display:none}',
      '.sec.grow[data-k="calendar"]{display:flex;flex-direction:column}',
      '.sec.grow[data-k="calendar"] .evs.scroll{max-height:none;flex:1 1 auto;min-height:0}',
      '.evs>.ev:last-child{border-bottom:0}',
      // A LIST THAT GIVES WAY (lst): down the pane (not a band, not a Pages
      // Screen widget) its section shrinks where the pane is short, to the
      // floor _floors sets; its rows scroll inside
      '.sec.shrink{display:flex;flex-direction:column}',
      '.sec.shrink>*{flex:none}',
      ':host(:not([side="band"]):not([mode="widget"])) .secs>.shrink:not(.grow){flex:0 1 auto}',
      '.lst{display:grid;gap:8px;align-content:start}.evs.lst{display:block}',
      '.sec.shrink>.lst{flex:0 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
      '.sec.shrink>.lst::-webkit-scrollbar{display:none}',
      // ...and the calendar's events, down the pane, run as far as the pane
      // has room for, not to 300 px with a space under them (the owner,
      // 2026-10-31: "a gap/space above Who's Home that could be filled")
      // -- and so, where the pane is short, the first to give way
      ':host(:not([side="band"]):not([mode="widget"])) .sec.shrink>.evs.scroll{max-height:none}',
      ':host(:not([side="band"]):not([mode="widget"])) .secs>.shrink[data-k="calendar"]:not(.grow){flex-shrink:100}',
      '.sec.shrink>.lst.cut{-webkit-mask-image:linear-gradient(#000 calc(100% - 22px),transparent);mask-image:linear-gradient(#000 calc(100% - 22px),transparent)}',
      // A TAP: every section and each thing in it is a target
      '.secs>[data-i]:not([data-k="now_playing"]),[data-ent],[data-ev]{cursor:pointer}',
      '.secs>[data-i]:not([data-k="now_playing"]):active,[data-ent]:active,[data-ev]:active{opacity:.7}',
      '.sec.mp>*{position:absolute;inset:0;height:100%}',
      // (its heading, when the pane has them, above the music pane, not over it)
      '.sec.mp>.h2{position:relative;inset:auto;height:auto;padding:14px 0 0}',
      '.sec.mp>.h2~*{top:34px;height:auto;bottom:0}',
      '.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
      '.stats div{font:500 13px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
      '.stats b{display:block;font:600 22px/1.25 var(--hk-font-body,inherit);color:' + v('ink') + '}',
      // (spread evenly across the pane, as the Who's Home block has them --
      // not packed to the left; the owner, 2026-10-31)
      '.ppl{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:14px}',
      '.ppl div{display:grid;justify-items:center;gap:4px;min-width:0;font:500 13px/1.2 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
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
      // (the glyph on the dark plate until a still has loaded over it; the name by the section's Name)
      '.sec.cam2>.cg{position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,.4)}',
      '.sec.cam2>.cg hk-icon{width:40px;height:40px;--hk-icon-size:40px}',
      '.sec.cam2[data-name=hide] .cn,.sec.cam2[data-name=auto]:not(.less) .cn{display:none}',
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
    if (K && K.v) CSS = out;
    return out;
  }

  // ------------------------------------------------------------ taps
  // a section's page (the screen's view of that path) and its sheet's entity
  var TAP_PAGE = { weather: 'weather', calendar: 'calendar', now_playing: 'music', security: 'security', camera: 'cameras',
                   timers: 'timers', energy: 'energy', climate: 'climate' };
  function pagePath(p) {
    var M = C() && C().menu, cfg = M && M.config ? M.config() : null;
    var v = cfg && (cfg.views || []).filter(function (x) { return x && x.path === p; })[0];
    if (!v) return null;
    var seg = String(location.pathname).split('/')[1] || '';
    return '/' + seg + '/' + p;
  }
  function go(path) {
    var SH = window.hkShell;
    if (SH && SH.navigate) SH.navigate(path); else location.assign(path);
  }
  function tapEntity(s, c) {
    switch (s.kind) {
      case 'weather': return setting('weather.entity', null) || domainIds(c, 'weather')[0] || null;
      case 'calendar': return (window.hkCalendar && window.hkCalendar.ids ? window.hkCalendar.ids(c) : [])[0] || null;
      case 'now_playing': { var m = musicOf(c); return m ? m.key : null; }
      case 'security': { var al = alarmOf(c); return (al && al.id) || kinds('locks')[0] || null; }
      case 'camera': return s.entity || (setting('cameras.order', []) || [])[0] || domainIds(c, 'camera')[0] || null;
      case 'energy': return setting('features.power', null);
      case 'climate': return domainIds(c, 'climate')[0] || null;
      case 'people': return domainIds(c, 'person')[0] || null;
      case 'todo': return s.entity || domainIds(c, 'todo')[0] || null;
      default: return null;
    }
  }

  // ------------------------------------------------------------ one pane
  // A PANE: the Dashboard's (mode 'dash', fixed to the window's edge) or the
  // screensaver's (mode 'saver', inside its own shadow root). Given its
  // sections and its place, it draws, fits and publishes nothing itself.
  class HkSidePane extends HTMLElement {
    constructor() {
      super();
      this._root = this.attachShadow({ mode: 'open' });
      if (C() && C().artGuard) C().artGuard(this._root);
      this._slots = {};
      this._stills = {};
      this._wx = {};
      var self = this;
      this._root.addEventListener('click', function (e) { self._click(e); });
      // THE VOLUME: set where it is let go (the music's own player)
      this._root.addEventListener('change', function (e) {
        var t = e.target, c = clientNow(), m = c && musicOf(c);
        if (!t || t.getAttribute('data-act') !== 'vol' || !m || !c.actions) return;
        c.actions.callService('media_player', 'volume_set', { volume_level: Math.max(0, Math.min(1, Number(t.value) / 100)) }, { entity_id: m.key })
          .catch(function () { /* refused: said by the host */ });
      });
      this._root.addEventListener('submit', function (e) { self._submit(e); });
    }
    // what it shows now: { list (sections), place, doorbell (a camera) }
    show(o) {
      this._o = o || null;
      var on = !!(o && o.place && o.place.kind !== 'none' && ((o.list && o.list.length) || o.doorbell));
      var was = this.hasAttribute('on');
      this.toggleAttribute('on', on);
      if (!on) { this._sig = null; if (was) this._slide(false); else this._park(); return false; }
      this.setAttribute('side', o.place.kind === 'band' ? 'band' : o.side === 'left' ? 'left' : 'right');
      this._draw();
      if (!was) this._slide(true);
      this._shown = true;
      return true;
    }
    // SLIDING IN AND OUT (2026-11-01, the owner: "I'd love the Side Pane and tab bar to animate/slide out of the way when
    // I swipe between pages, instead of just popping into place"): on the Dashboard, a pane that goes slides off past its
    // own edge -- the page already in its new width under it -- and one that comes slides in from there. A transform
    // alone (no layout while it moves); the first time it shows, under Reduce Motion, and anywhere but the Dashboard,
    // as before: at once.
    _slide(coming) {
      var self = this, side = this.getAttribute('side');
      if (this._slideAnim) { try { this._slideAnim.cancel(); } catch (e) { /* done */ } this._slideAnim = null; }
      this.removeAttribute('leaving');
      // (the finger already took it there -- a swipe between pages, FOLLOW: nothing more to slide)
      if (this._followed) { this._followed = false; if (!coming) this._park(); return; }
      var still = this.getAttribute('mode') !== 'dash' || typeof this.animate !== 'function' || (coming && !this._shown) ||
        (window.hkSettings && window.hkSettings.skyLook && window.hkSettings.skyLook().animations === false) ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (still) { if (!coming) this._park(); return; }
      var away = side === 'band' ? 'translateY(100%)' : side === 'left' ? 'translateX(-100%)' : 'translateX(100%)';
      var EASE = (C() && C().EASE) || { standard: 'ease-out', exit: 'ease-in' };
      if (coming) {
        this._slideAnim = this.animate([{ transform: away }, { transform: 'none' }], { duration: 360, easing: EASE.standard });
        this._slideAnim.onfinish = function () { self._slideAnim = null; };
        return;
      }
      // (still drawn while it goes: `leaving` keeps it shown, the off pane's taps off)
      this.setAttribute('leaving', '');
      var a = this._slideAnim = this.animate([{ transform: 'none' }, { transform: away }], { duration: 300, easing: EASE.exit, fill: 'forwards' });
      a.onfinish = function () {
        if (self._slideAnim !== a) return;
        self._slideAnim = null; self.removeAttribute('leaving'); a.cancel();
        if (!self.hasAttribute('on')) self._park();
      };
    }
    redraw() { if (this._o && this.hasAttribute('on')) this._draw(true); }
    // ------------------------------------------------ drawing and the fit
    _draw(again) {
      var o = this._o, c = clientNow();
      if (!this._built) {
        this._cssFull = cssReady();
        this._root.innerHTML = '<style>' + css() + '</style><div class="pane"><div class="artbg" aria-hidden="true"><i></i></div><div class="pin"><div class="secs"></div></div></div>';
        this._pin = this._root.querySelector('.pin');
        this._secs = this._root.querySelector('.secs');
        this._built = true;
      }
      // (its sheet drawn again with the design values, once hkCards has come)
      if (!this._cssFull && cssReady()) { this._cssFull = true; this._root.querySelector('style').textContent = css(); }
      var band = o.place.kind === 'band', W = this.clientWidth || (band ? window.innerWidth : o.place.w) || DRAWN_W;
      var H = this.clientHeight || (band ? o.place.h : window.innerHeight) || 800;
      // drawn at 400 wide and scaled whole (a band at its own height, scaled the same)
      var z = band ? Math.max(0.85, Math.min(1.1, H / BAND_H)) : Math.max(0.85, Math.min(1.3, W / DRAWN_W));
      this._pin.style.width = (W / z).toFixed(1) + 'px';
      this._pin.style.height = (H / z).toFixed(1) + 'px';
      this._pin.style.transform = 'scale(' + z.toFixed(4) + ')';
      // AT THE TOP, AND AT THE FOOT (a section's Place, 2026-10-30): the top
      // ones in order, a space, then the bottom ones -- each drawn with its
      // index in the pane's list (data-i), what a tap on it reads
      var all = o.list || [], self = this;
      var list = all.filter(function (x) { return x.place !== 'bottom'; }), foot = list.length;
      list = list.concat(all.filter(function (x) { return x.place === 'bottom'; }));
      this._list = list;
      var sp = paneOf();
      HEAD_ON = this.getAttribute('mode') !== 'widget' && !(sp && sp.headings === false);
      var ctx = this._ctx(c);
      var door = o.doorbell ? this._door(o.doorbell, c) : '';
      var render = function (sizes, n) {
        var html = door;
        for (var i = 0; i < n; i++) {
          var s = list[i], fn = SEC[s.kind];
          if (i === foot && foot > 0) html += '<div class="gap" aria-hidden="true"></div>';
          try { html += fn ? String(fn(sizes[i], s, c, ctx)).replace(/^<div /, '<div data-i="' + i + '" ') : ''; } catch (e) { console.warn('[hk-sidepane] ' + s.kind, e); }
        }
        if (n < list.length) html += '<div class="more2">+' + (list.length - n) + ' more</div>';
        return html;
      };
      this._artBg(list, c);
      var sig = JSON.stringify([list, W, H, o.side, band, o.doorbell, HEAD_ON]) + '|' + this._dataSig(c);
      if (!again && sig === this._sig) return;
      this._sig = sig;
      var over = function (sizes, n) {
        self._secs.innerHTML = render(sizes, n);
        self._fill();
        self._floors();
        return band ? self._secs.scrollWidth > self._secs.clientWidth + 1 || self._tallest() > self._secs.clientHeight + 1
                    : self._secs.scrollHeight > self._secs.clientHeight + 1;
      };
      var got = fit(list, over);
      // (the last measured draw may be a step past the answer: draw the answer)
      this._secs.innerHTML = render(got.sizes, got.n);
      this._fill();
      this._floors();
      this._cuts();
      this._cams();
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
      // (the Now Playing section's Album Art Background, on unless set off -- item 41: off, the pane keeps its ordinary
      // ground, and the music pane at Full its own backdrop)
      this._artOn = list.some(function (s) { return s.kind === 'now_playing' && s.art !== false; });
      var want = this._artOn ? musicOf(c) : null;
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
        var got = artDraw(img), bg = self._root.querySelector('.artbg');
        if (got.rgb) self.style.setProperty('--art-tint', 'rgb(' + got.rgb.map(function (v) { return Math.round(v * 0.42); }).join(',') + ')');
        // A NEW LAYER FOR EACH SONG, its picture set before it is in the page,
        // faded in over the last, which then goes: WebKit left a layer whose
        // picture changed during its fade unpainted -- the pane's ground alone,
        // near black (2026-10-30). (A picture that can't be read here: itself,
        // under a blur drawn once.)
        var b = document.createElement('b');
        if (!got.url) b.className = 'raw';
        b.style.backgroundImage = 'url("' + (got.url || pic).replace(/"/g, '%22') + '")';
        bg.insertBefore(b, bg.querySelector('i'));
        var olds = Array.prototype.filter.call(bg.querySelectorAll('b'), function (x) { return x !== b; });
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          b.classList.add('on');
          olds.forEach(function (o) { o.classList.remove('on'); setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 1300); });
        }); });
        self.setAttribute('arted', '');
      };
      img.onerror = function () { if (self._artPic === pic) self.removeAttribute('arted'); };
      img.src = pic;
    }
    // A TAP ON A SECTION (2026-10-30, the owner: "ALL the Widgets should do
    // something if you tap on them"): on one thing in it -- an event, a
    // person, a lock, a thermostat -- that thing's sheet; else the section's
    // When Tapped: Automatic (its page where this screen has one, else its
    // sheet), Its Page, Its Sheet or Nothing. Its buttons, the to-do list's
    // circles and the music pane keep their own.
    _tap(e, c) {
      var t = e.target;
      if (!t.closest || t.closest('button,input,form,a,.slot,hk-music-pane-card')) return;
      var sec = t.closest('[data-i]'), s = sec && this._list ? this._list[+sec.getAttribute('data-i')] : null;
      if (!s || s.tap === 'none') return;
      // NOW PLAYING'S OWN TWO (2026-10-31, item 44): the Speakers / Volume / Queue / Browse panel opens in place over
      // the pane, or the section flips over to it, as the screensaver's player turns (musicPanel) -- and Automatic is
      // the panel (2026-11-01, the owner: a tap on the cover or the song opened the detail sheet; the panel keeps
      // them on the page). THE COVER at Automatic or Open the Panel is the screensaver's music, full screen (the
      // owner, the same day: "that would be neat!"); where this screen has none, the panel.
      if (s.kind === 'now_playing' && (!s.tap || s.tap === 'auto' || s.tap === 'panel' || s.tap === 'flip')) {
        var Sv = window.hkSaver;
        if (s.tap !== 'flip' && t.closest('.art') && Sv && Sv.showMusic && Sv.showMusic()) return;
        musicPanel(this, 'speakers', sec, s.tap === 'flip' ? 'flip' : 'drawer');
        return;
      }
      var D = window.hkDetail, ev = t.closest('[data-ev]'), one = t.closest('[data-ent]');
      if (ev && CAL.shown && CAL.shown[+ev.getAttribute('data-ev')]) {
        var K = window.hkCalendar, x = CAL.shown[+ev.getAttribute('data-ev')];
        if (K && K.show) { try { K.show(c, x); return; } catch (err) { /* below */ } }
      }
      if (one && D && D.open && s.tap !== 'page') { D.open(one.getAttribute('data-ent')); return; }
      // (the Clock has no page of its own; showing the weather -- beside the time or under it -- its page is Weather:
      // 2026-10-31, the owner set When Tapped to its page and nothing happened)
      var page = s.kind === 'clock' ? (s.beside === 'weather' || s.line === 'weather' ? 'weather' : null) : TAP_PAGE[s.kind];
      var ent = tapEntity(s, c), path = page && pagePath(page);
      if ((s.tap === 'page' || !s.tap || s.tap === 'auto') && path) { go(path); return; }
      if (ent && D && D.open && s.tap !== 'page') { D.open(ent); return; }
      if (path) go(path);
    }
    // HOW SHORT A .shrink MAY GO: its heading, what is under its rows (the
    // timers' keys, the to-do list's Add) and its first row, as laid out
    // before it gives way (the pane is scaled whole: CSS pixels, offsetHeight)
    _floors() {
      Array.prototype.forEach.call(this._secs.querySelectorAll('.secs>.shrink'), function (sec) {
        var cs = getComputedStyle(sec), gap = parseFloat(cs.rowGap) || 0, h = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        var kids = Array.prototype.filter.call(sec.children, function (k) { return k.offsetHeight > 0 || k.classList.contains('lst'); });
        kids.forEach(function (k, i) {
          if (i) h += gap;
          if (!k.classList.contains('lst')) { h += k.offsetHeight; return; }
          var one = k.firstElementChild;
          h += one ? Math.min(k.scrollHeight, one.offsetHeight + (one.nextElementSibling && one.nextElementSibling.classList.contains('bar2') ? one.nextElementSibling.offsetHeight + 8 : 0)) : 0;
        });
        sec.style.minHeight = Math.ceil(h) + 2 + 'px';
      });
    }
    // ...and a list cut short fades out at its foot, so it reads as more below
    _cuts() {
      Array.prototype.forEach.call(this._secs.querySelectorAll('.shrink>.lst'), function (l) {
        l.classList.toggle('cut', l.scrollHeight > l.clientHeight + 2);
      });
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
      return JSON.stringify([Math.floor(Date.now() / 30000), m && [m.key, m.playing, m.title],
        timersOf(c).map(function (r) { var x = st[r.entity_id]; return [r.entity_id, x && x.state, r.finishes_at || r.remaining]; }),
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
        // a camera's last still that loaded, or '' (see _cams)
        still: function (id) { var s = self._stills[id]; return s && s.url || ''; },
        slot: function (key, tag) { self._want = self._want || {}; self._want[key] = tag; return '<div class="slot" data-slot="' + key + '"></div>'; }
      };
    }
    // THE CAMERA'S STILL, LOADED AND REFRESHED IN PLACE (2026-10-31, the owner's item 42: "Driveway Camera ...
    // never loads", a "?" forever). WHY: the address asked for carried `hk_n=`, and Mantel's still route answers
    // only width, height, v and _hk (camera_still.py: anything else is a 400), so every request failed; and it
    // asked for no size, which is the camera's whole 4K frame (1.8 MB) where the blocks ask 480 x 270. Now, as
    // the blocks' strip does (hk-cameras.js _srcFor): the entity's own entity_picture, read fresh each time (HA
    // rotates its token), `_hk` a counter, and the tier's size. A new one is loaded off screen and put in only once
    // it has a picture (naturalWidth), at most every ten seconds; one that failed is not asked for again with the
    // same address for a minute. A draw shows the last good one at once.
    _cams() {
      var self = this, c = clientNow(), nodes = this._secs ? this._secs.querySelectorAll('.cam2[data-k="camera"]') : [];
      var ids = {};
      Array.prototype.forEach.call(nodes, function (n) { var id = n.getAttribute('data-cam'); if (id) ids[id] = 1; });
      var any = Object.keys(ids);
      if (!any.length) { if (this._camT) { clearInterval(this._camT); this._camT = null; } return; }
      if (!this._camT) this._camT = setInterval(function () { self._cams(); }, 10000);
      if (!c) return;
      any.forEach(function (id) {
        var st = states(c)[id], HC = C(), a = st && st.attributes;
        var pic = a && !a.restored && !(HC && HC.stale && HC.stale(st)) ? a.entity_picture : null;
        var s = self._stills[id] || (self._stills[id] = { at: 0, n: 0, url: '', busy: false, bad: '', badAt: 0 });
        // (a picture that neither loads nor fails in LOST is given up, as the calendar's read)
        if (s.busy && Date.now() - s.at > LOST) s.busy = false;
        if (!pic || s.busy || Date.now() - s.at < 9000) return;
        if (s.bad === pic && Date.now() - s.badAt < 60000) return;
        s.busy = true; s.at = Date.now(); s.n++;
        var url = pic + (pic.indexOf('?') < 0 ? '?' : '&') + '_hk=' + s.n + '&width=480&height=270', im = new Image();
        im.onload = function () {
          s.busy = false;
          if (!im.naturalWidth) { s.bad = pic; s.badAt = Date.now(); return; }
          s.url = url; s.bad = '';
          Array.prototype.forEach.call(self._secs.querySelectorAll('.cam2[data-k="camera"]'), function (n) {
            if (n.getAttribute('data-cam') !== id) return;
            var el = n.querySelector('img');
            if (!el) { el = document.createElement('img'); el.alt = ''; n.insertBefore(el, n.querySelector('.cn')); }
            if (el.getAttribute('src') !== url) el.setAttribute('src', url);
          });
        };
        im.onerror = function () { s.busy = false; s.bad = pic; s.badAt = Date.now(); };
        im.src = url;
      });
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
        if (key === 'np') el.toggleAttribute('nobg', self._artOn !== false);
        if (key === 'np') el.toggleAttribute('compact', !!(el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('compact')));
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
      if (this._camT) { clearInterval(this._camT); this._camT = null; }
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
    // THE FORECAST: the house's forecast sensor where Configure -> Weather names one (as the weather blocks
    // read it), else hkWxForecast, the Weather page's own subscription, one per kind, kept while the pane shows
    // weather -- and asked again at each draw (ensure): after a refusal's wait, or a reconnect that forgot it.
    // (2026-11-01, the owner: the forecast under the time came only once the Weather page had been opened --
    // the page's own ask, which the pane then shared; the pane's first had gone unanswered and it never asked again)
    _forecast(c, wid, kind) {
      var HS = window.hkSettings, sid = HS && HS.get ? HS.get('weather.forecast_' + kind, null) : null;
      if (sid) return (((states(c)[sid] || {}).attributes || {}).forecast) || [];
      var W = window.hkWxForecast, key = kind + '|' + wid, self = this, port = c && c.subscriptions;
      if (!W || !port) return [];
      var w = this._wx[key];
      if (!w || w.conn !== port) {
        if (w) w.release();
        w = this._wx[key] = W.watch(port, kind, wid, function () { self.redraw(); });
      } else {
        w.ensure();
      }
      return w.data() || [];
    }
    // ------------------------------------------------ taps
    _click(e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null, c = clientNow();
      if (!b) { this._tap(e, c); return; }
      if (!c || !c.actions) return;
      var act = b.getAttribute('data-act');
      if (act === 'pp') {
        var m = musicOf(c);
        if (m) c.actions.callService('media_player', 'media_play_pause', {}, { entity_id: m.key }).catch(function () { /* refused: said by the host */ });
      } else if (act === 'prev' || act === 'next') {
        var mn = musicOf(c);
        if (mn) c.actions.callService('media_player', act === 'prev' ? 'media_previous_track' : 'media_next_track', {}, { entity_id: mn.key }).catch(function () { /* refused: said by the host */ });
      } else if (act === 'spk' || act === 'brw') {
        musicPanel(this, act === 'spk' ? 'speakers' : 'browse', b.closest('[data-k="now_playing"]'), 'drawer');
      } else if (act === 'todo') {
        // CHECKED OFF: a house command (todo.update_item), struck through
        // until the list says so
        var sent = todoCheck(c, b.getAttribute('data-list'), b.getAttribute('data-uid'));
        if (!sent) return;
        b.classList.add('done');
        sent.catch(function () { b.classList.remove('done'); });
      } else if (act === 'tp' || act === 'tx') {
        // A RUNNING TIMER'S RING (pause / resume) AND STOP: the Timers block's
        // services (timer.pause, timer.start, timer.cancel)
        var tid = b.getAttribute('data-timer');
        if (tid) c.actions.callService('timer', act === 'tx' ? 'cancel' : b.getAttribute('data-paused') === '1' ? 'start' : 'pause', {}, { entity_id: tid })
          .catch(function () { /* refused: said by the host */ });
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
      todoAdd(c, eid, txt).catch(function () { inp.value = txt; });
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
  // (HK Settings' All Screens page, when no screen follows All Screens
  // throughout: its preview is a screen drawing All Screens' pane, 2026-10-31)
  var HOUSE = false;
  function paneOf() {
    var hs = HOUSE && setting('side_pane', null);
    if (hs) return Object.assign({}, hs, { own: [] });
    var M = C() && C().menu, dash = M && M.dash ? M.dash() : String(location.pathname).split('/')[1] || '';
    var all = setting('boards', null), b = all && all[dash];
    return (b && b.side_pane_read) || null;
  }
  function isHome(path) {
    var M = C() && C().menu, here = String(path || location.pathname).split(/[?#]/)[0].split('/')[2] || '';
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
    // (a swipe that carried the tab bar there already: its edges move now with no glide, and the offset the finger
    // gave it goes in the same frame -- where it is drawn does not move; FOLLOW below)
    if (FOLLOW.landed) handOver();
    try { window.dispatchEvent(new Event('hk-pane')); } catch (e) { /* no listeners */ }
  }
  // WITH THE FINGER (2026-11-01, the owner: "if I swipe half way, the side pane and navbar should also move in motion
  // with the page ... The Side pane ... may just need a fade out"): hk-pageswipe.js says how far a swipe has gone
  // toward a page (`follow`, 0..1) and where it lands (`land`, or null: back). Where the pane shows on one page and
  // not the other, it fades with the finger, drifting a little toward its own edge, and the tab bar moves with it to
  // the middle it will have (--hk-pane-shift, half the pane's width: hk-tabbar.js .row's `translate`). Let go, both
  // finish the way the page does; the room itself changes as the page lands, and handOver swaps the bar's offset for
  // its new edges in the same frame.
  var FOLLOW = { p: 0, to: null, going: 0, shift: 0, landed: false, tween: 0 };
  var SWIPE_MS = 300, DRIFT = 28;
  function stillMotion() {
    return (window.hkSettings && window.hkSettings.skyLook && window.hkSettings.skyLook().animations === false) ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  // +1: the pane goes (here, not there); -1: it comes; 0: no change between the two
  function paneChange(toPath) {
    var sp = paneOf(), g = sp && sp.dashboard;
    if (!g || !dash || dash.getAttribute('side') === 'band') return 0;
    var here = wants(g.show, isHome()), there = wants(g.show, isHome(toPath));
    return here === there ? 0 : here ? 1 : (dash._built ? -1 : 0);
  }
  // THE PAGE THERE'S ROOM (2026-11-01, the owner: "the HomeView Grid kind of snaps into place behind the side pane"):
  // where the pane comes or goes, the page coming in is laid out at the width it will have -- `grow` px wider (the
  // pane going) or narrower (coming), on the pane's side; null: the same as here
  function roomFor(toPath) {
    var k = paneChange(toPath), w = k && dash ? parseFloat(dash.style.width) || dash.getBoundingClientRect().width || 0 : 0;
    return w ? { side: dash.getAttribute('side'), grow: k * w } : null;
  }
  // THE BAR'S OWN (hk-tabbar.js reads --hk-pane-shift and --hk-pane-glide, and nothing else does): set on <html>, a
  // custom property every element inherits, each frame of a swipe restyled the whole document -- every card's shadow
  // tree -- and the swipes between Home and the Pages screen dropped frames (2026-11-02, the owner: "stutter")
  function barHost() { return document.getElementById('hk-tabbar'); }
  function followDraw(p) {
    var bar = barHost(), k = FOLLOW.going, side = dash && dash.getAttribute('side');
    if (!k || !dash) return;
    var out = k > 0 ? p : 1 - p, sign = side === 'left' ? -1 : 1;
    dash.style.opacity = String(1 - out);
    dash.style.transform = 'translateX(' + (sign * out * DRIFT).toFixed(1) + 'px)';
    // (the bar's middle: half the pane's width toward the pane's side as it goes, back as it comes)
    if (bar) bar.style.setProperty('--hk-pane-shift', (k * p * FOLLOW.shift).toFixed(1) + 'px');
  }
  function follow(p, toPath) {
    if (stillMotion()) return;
    if (FOLLOW.to !== toPath) {
      FOLLOW.to = toPath; FOLLOW.going = paneChange(toPath);
      // (its width as placed: a pane that is coming is not drawn yet)
      var w = dash ? parseFloat(dash.style.width) || dash.getBoundingClientRect().width || 0 : 0, side = dash && dash.getAttribute('side');
      FOLLOW.shift = (side === 'left' ? -1 : 1) * w / 2;
      if (FOLLOW.going < 0 && dash) dash.setAttribute('peek', '');
    }
    cancelAnimationFrame(FOLLOW.tween);
    FOLLOW.p = Math.max(0, Math.min(1, p || 0));
    followDraw(FOLLOW.p);
  }
  function land(path) {
    if (!FOLLOW.going) { FOLLOW.to = null; return; }
    var from = FOLLOW.p, goal = path ? 1 : 0, t0 = 0;
    FOLLOW.landed = !!path;
    if (dash) dash._followed = !!path;
    var step = function (now) {
      if (!t0) t0 = now;
      var u = Math.min(1, (now - t0) / SWIPE_MS), e = 1 - Math.pow(1 - u, 3);
      FOLLOW.p = from + (goal - from) * e;
      followDraw(FOLLOW.p);
      if (u < 1) { FOLLOW.tween = requestAnimationFrame(step); return; }
      if (!path) unfollow();
    };
    cancelAnimationFrame(FOLLOW.tween);
    FOLLOW.tween = requestAnimationFrame(step);
    // (a page that never lands -- a slow host -- leaves nothing behind)
    clearTimeout(FOLLOW.giveUp);
    FOLLOW.giveUp = setTimeout(function () { if (FOLLOW.landed) handOver(); }, 3000);
  }
  function handOver() {
    FOLLOW.landed = false;
    clearTimeout(FOLLOW.giveUp);
    cancelAnimationFrame(FOLLOW.tween);
    var bar = barHost();
    if (bar) bar.style.setProperty('--hk-pane-glide', '0s');
    unfollow();
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (bar) bar.style.removeProperty('--hk-pane-glide'); }); });
  }
  function unfollow() {
    var bar = barHost();
    if (bar) bar.style.removeProperty('--hk-pane-shift');
    if (dash) { dash.style.opacity = ''; dash.style.transform = ''; dash.removeAttribute('peek'); }
    FOLLOW.to = null; FOLLOW.going = 0; FOLLOW.p = 0;
  }
  // THE MUSIC'S PANEL OVER THE PANE (Less's Speakers and Browse): the
  // screensaver's (hk-saver-panel.js) -- Speakers, Volume, Queue, Browse, what
  // plays at its foot -- the pane's own size and place, so it opens where the
  // player is. A tap outside, its X, Escape, a moment after a request has
  // landed, and the music going close it. `how`: 'flip', the section turning
  // over to it (turnAnim); 'drawer' (2026-11-01, the owner: "the player slides
  // up to the top and below it is the browse/speaker/volume/queue tabs"), the
  // whole pane, what plays at its top, rising from where the section was
  // (drawerAnim)
  var mpnl = null;
  function musicPanel(pane, tab, from, how) {
    var P = window.hkSaverPanel, HC = C();
    if (mpnl) { if (mpnl.p.tab() !== tab) mpnl.p.show(tab); else closeMusicPanel(); return; }
    if (!P || !pane || !pane.getBoundingClientRect) return;
    var r = pane.getBoundingClientRect();
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:12;' + ((HC && HC.FONT_ROOT) || '');
    var sr = host.attachShadow({ mode: 'open' });
    var st = document.createElement('style');
    st.textContent = P.CSS + (HC && HC.shadeCss ? HC.shadeCss('.mpanel') : '') +
      '.scrim{position:fixed;inset:0}.mpanel.pn{position:fixed;border-radius:' + ((HC && HC.R && HC.R.sheet) || 38) + 'px;background:rgb(24,25,29);' +
      'box-shadow:0 26px 70px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12)}' +
      // THE DRAWER: the pane itself, what plays first (its cover a size up), the tabs under it
      // (the pane's own material: a dark glass over it, not a solid plate on whatever look the screen has)
      '.mpanel.pn.dr{border-radius:0;box-shadow:none;background:rgba(18,20,24,.93);-webkit-backdrop-filter:blur(30px) saturate(1.4);backdrop-filter:blur(30px) saturate(1.4)}' +
      '.mpanel.dr .mpmini{order:-1;border-top:0;border-bottom:1px solid rgba(255,255,255,.12);padding:24px 22px 16px}' +
      '.mpanel.dr .mpmini .ia{width:60px;height:60px;border-radius:10px}.mpanel.dr .mpmini .tx b{font-size:17px}' +
      '.mpanel.dr .mphd{padding-top:14px}';
    sr.appendChild(st);
    var scrim = document.createElement('div'); scrim.className = 'scrim';
    sr.appendChild(scrim);
    var me = { host: host, doneT: null };
    me.p = P.create({
      tabs: ['speakers', 'volume', 'queue', 'browse'],
      client: function () { return clientNow(); },
      ctx: function () { return musicNow(clientNow()); },
      art: function () { return null; },
      stop: true,
      follow: function (key) { var Mu = window.hkMusic; if (key && Mu && Mu.known && Mu.known(key)) Mu.setFocus(key); },
      done: function (ms) {
        if (mpnl !== me) return;
        clearTimeout(me.doneT);
        me.doneT = setTimeout(function () { if (mpnl === me) closeMusicPanel(); }, ms || 0);
      },
      wide: function () { return false; },
      mini: function () { return true; },
      now: function () {
        var m = musicOf(clientNow());
        return m ? { idle: false, playing: m.playing, title: m.title, artist: m.artist, pic: m.pic, room: '' } : null;
      },
      transport: function (k) {
        var c = clientNow(), m = c && musicOf(c);
        if (m && c.actions) c.actions.callService('media_player', k === 'pp' ? 'media_play_pause' : 'media_next_track', {}, { entity_id: m.key }).catch(function () { /* refused */ });
      }
    });
    var el = me.p.el, drawer = how === 'drawer', inset = drawer ? 0 : 8;
    el.classList.add('up', 'pn');
    if (drawer) el.classList.add('dr');
    el.style.cssText = 'left:' + (r.left + inset) + 'px;top:' + (r.top + inset) + 'px;width:' + (r.width - 2 * inset) + 'px;height:' + (r.height - 2 * inset) + 'px';
    sr.appendChild(el);
    me.p.size(r.width - 2 * inset, r.height - 2 * inset, 1);
    me.p.show(tab);
    scrim.addEventListener('click', closeMusicPanel);
    me.key = function (ev) { if (ev.key === 'Escape') closeMusicPanel(); };
    window.addEventListener('keydown', me.key);
    document.body.appendChild(host);
    mpnl = me;
    // FLIPPED OVER (Now Playing's When Tapped, 2026-10-31, item 44): the section turns over to the same panel;
    // or THE DRAWER rises from it
    if (from && from.getBoundingClientRect && (how === 'flip' || drawer)) {
      var fr = from.getBoundingClientRect();
      me.from = from; me.rect = { left: fr.left, top: fr.top, width: fr.width, height: fr.height };
      me.box = { x: r.left + inset, y: r.top + inset, w: r.width - 2 * inset, h: r.height - 2 * inset };
      me.how = how;
      if (drawer) drawerAnim(me, true); else turnAnim(me, true);
    }
  }
  function closeMusicPanel() {
    var me = mpnl;
    if (!me) return;
    mpnl = null;
    clearTimeout(me.doneT);
    window.removeEventListener('keydown', me.key);
    var fin = function () { try { me.p.destroy(); } catch (e) { /* gone */ } me.host.remove(); if (me.from && me.from.isConnected) me.from.style.visibility = ''; };
    if (me.from) { (me.how === 'drawer' ? drawerAnim : turnAnim)(me, false, fin); return; }
    fin();
  }
  // THE DRAWER'S RISE: at first only what plays shows, where the section stood (the section hidden under it); it
  // rises to the pane's top, the tabs and the list opening under it as it goes. Closing, back down the same way.
  // Transforms and a clip only; at rest under Reduce Motion.
  function drawerAnim(me, opening, done) {
    var el = me.p.el, src = me.from, B = me.box, R = me.rect, HC = C();
    var EASE = (HC && HC.EASE) || { standard: 'ease-out', exit: 'ease-in' };
    var reduce = (window.hkSettings && window.hkSettings.skyLook && window.hkSettings.skyLook().animations === false) ||
                 (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // UNFOLDING FROM THE PLAYER (2026-11-01, the owner: "the slide up and down of the media player in the side pane
    // doesn't look great at all"): the drawer starts as exactly the section's box and opens up and down from it to the
    // whole pane (a clip), the player's row riding up inside it to the top, the tabs and the list fading in as it
    // opens. It was a solid box sliding up, the pane bare under it until it got there. Closing, the same backwards.
    var top = Math.max(0, Math.round(R.top - B.y)), bottom = Math.max(0, Math.round(B.y + B.h - (R.top + R.height)));
    var inner = el.querySelector('.mpin'), rest = el.querySelectorAll('.mphd,.mpbody,.mpfoot');
    var small = { clipPath: 'inset(' + top + 'px 0 ' + bottom + 'px 0)' }, full = { clipPath: 'inset(0px 0 0px 0)' };
    var ride = [{ transform: 'translateY(' + top + 'px)' }, { transform: 'none' }], show = [{ opacity: 0 }, { opacity: 1 }];
    var stop = function () {
      (me.anims || []).forEach(function (x) { try { x.cancel(); } catch (e) { /* done */ } });
      me.anims = []; me.anim = null;
    };
    stop();
    var can = !reduce && typeof el.animate === 'function';
    var run = function (target, frames, o) { var x = target.animate(frames, o); me.anims.push(x); return x; };
    if (opening) {
      if (src && src.isConnected) src.style.visibility = 'hidden';
      if (!can) return;
      var o = { duration: 440, easing: EASE.standard };
      var a = me.anim = run(el, [small, full], o);
      if (inner) run(inner, ride, o);
      Array.prototype.forEach.call(rest, function (n) { run(n, show, { duration: 320, delay: 120, easing: 'ease-out', fill: 'backwards' }); });
      a.onfinish = function () { if (me.anim === a) stop(); };
    } else {
      if (!can) { done(); return; }
      var c = { duration: 340, easing: EASE.standard, fill: 'forwards' };
      var b = me.anim = run(el, [full, small], c);
      if (inner) run(inner, ride.slice().reverse(), c);
      Array.prototype.forEach.call(rest, function (n) { run(n, show.slice().reverse(), { duration: 200, easing: 'ease-in', fill: 'forwards' }); });
      b.onfinish = function () { stop(); done(); };
    }
  }
  // THE TURN, as the Home Grid's Now Playing block and the screensaver turn the card (hk-media.js _turnAnim): the section
  // to edge-on where it stands, then the panel from edge-on, growing from the section's size to its own; back the same
  // way. Transforms only; at rest under Reduce Motion (the section hidden, the panel shown).
  function turnAnim(me, opening, done) {
    var el = me.p.el, src = me.from, B = me.box, R = me.rect, HC = C();
    var EASE = (HC && HC.EASE) || { standard: 'ease-out', exit: 'ease-in' };
    var reduce = (window.hkSettings && window.hkSettings.skyLook && window.hkSettings.skyLook().animations === false) ||
                 (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var edge = 'perspective(1500px) rotateY(90deg)';
    var small = 'perspective(1500px) translate(' + Math.round(R.left + R.width / 2 - (B.x + B.w / 2)) + 'px,' + Math.round(R.top + R.height / 2 - (B.y + B.h / 2)) +
                'px) rotateY(-90deg) scale(' + (R.width / B.w).toFixed(3) + ',' + (R.height / B.h).toFixed(3) + ')';
    var live = src && src.isConnected && typeof src.animate === 'function';
    var can = !reduce && typeof el.animate === 'function';
    if (me.anim) { try { me.anim.cancel(); } catch (x) { /* done */ } me.anim = null; }
    if (opening) {
      if (!can || !live) { if (src && src.isConnected) src.style.visibility = 'hidden'; return; }
      el.style.visibility = 'hidden';
      var a = me.anim = src.animate([{ transform: 'none' }, { transform: edge }], { duration: 240, easing: EASE.exit, fill: 'forwards' });
      a.onfinish = function () {
        if (src.isConnected) src.style.visibility = 'hidden';
        a.cancel();
        if (mpnl !== me) return;
        el.style.visibility = '';
        var b = me.anim = el.animate([{ transform: small }, { transform: 'none' }], { duration: 440, easing: EASE.standard });
        b.onfinish = function () { if (me.anim === b) me.anim = null; };
      };
    } else {
      if (!can || !live) { done(); return; }
      var c1 = me.anim = el.animate([{ transform: 'none' }, { transform: small }], { duration: 300, easing: EASE.exit, fill: 'forwards' });
      c1.onfinish = function () {
        el.style.visibility = 'hidden';
        src.style.visibility = '';
        var c2 = me.anim = src.animate([{ transform: edge }, { transform: 'none' }], { duration: 280, easing: EASE.standard });
        c2.onfinish = function () { me.anim = null; done(); };
      };
    }
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
    // (the pane WILL take the music: up here, or coming up, with a Now Playing section -- whether or not anything
    // plays yet. Said only once the music was in the pane, the bar came up for the frames between the music starting
    // and the pane's next draw, the page lost its height and a Home Grid fitted itself smaller, then back: the owner,
    // 2026-11-01, "the whole dashboard redraws" as the Music block turned into the player)
    musicFlag(on && p.kind !== 'none' && (g.sections || []).some(function (x) { return x && x.kind === 'now_playing'; }));
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
  var DIM_WORDS = { none: 0, low: 16, medium: 30, high: 45 }, DIM_HELD = null, DIM_HELD_T = 0;
  // ('glass': Same as the Glass, dress() below)
  function dimPct(v) { return typeof v === 'string' ? (DIM_WORDS[v] || 0) : Math.max(0, Math.min(60, Number(v) || 0)); }
  function dress(el, up) {
    var g = document.documentElement.getAttribute('data-hk-glass') || 'blur';
    if (el.getAttribute('look') !== lookOf(g)) el.setAttribute('look', lookOf(g));
    // (how much, 0-60 %: Off / Low / Medium / High its first hours; the Settings slider's own while it moves)
    // SAME AS THE GLASS (2026-11-01, the default, the owner: linked, with an opt-out): Bright Glass's Dim, as the
    // page wears it (hk-settings.js --hk-bright-dim: none where the page isn't in Bright Glass) -- a variable, so
    // the glass's slider moving in Settings moves it too
    var own = (paneOf() || {}).dim, linked = DIM_HELD === null && (own === 'glass' || own === undefined || own === null);
    var dim = DIM_HELD !== null ? DIM_HELD : dimPct(own);
    if (linked) { el.setAttribute('dim', ''); el.style.setProperty('--pane-dim', 'var(--hk-bright-dim, 0)'); }
    else if (dim > 0) { el.setAttribute('dim', ''); el.style.setProperty('--pane-dim', String(dim / 100)); }
    else { el.removeAttribute('dim'); el.style.removeProperty('--pane-dim'); }
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
    // a swipe between pages (hk-pageswipe.js): how far toward `toPath`, and where it landed (null: back); the room
    // the page there will have, so it comes in laid out as it lands
    follow: function (p, toPath) { try { follow(p, toPath); } catch (e) { /* not drawn */ } },
    land: function (path) { try { land(path); } catch (e) { /* not drawn */ } },
    room: function (toPath) { try { return roomFor(toPath); } catch (e) { return null; } },
    // THE SETTINGS SLIDER'S DIM while it moves (hk-settings.js pvPaneDim): held a few seconds past the last move,
    // long enough for the saved setting to come back, then the setting's own again
    dim: function (pct) {
      DIM_HELD = dimPct(pct);
      clearTimeout(DIM_HELD_T);
      DIM_HELD_T = setTimeout(function () { DIM_HELD = null; soon(); }, 6000);
      soon();
    },
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
    // A TO-DO LIST'S ITEMS, checked off and added to, as the pane's own section does (the Home Grid's To-do block)
    todo: { items: todoOf, check: todoCheck, add: todoAdd },
    sync: sync,
    previewHouse: function (on) { if (HOUSE === !!on) return; HOUSE = !!on; sync(); },
    // tests
    _: { shown: shown, fit: fit, place: place, wants: wants, saverList: saverList, has: has, ringing: ringing, SEC: SEC,
         publish: publish, musicFlag: musicFlag, NOTES: NOTES, TODO: TODO, CAL: CAL, calLoad: calLoad, todoOf: todoOf, LOST: LOST }
  };
})();
