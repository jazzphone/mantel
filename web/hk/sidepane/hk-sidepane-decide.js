// hk-sidepane-decide.js - what the pane shows: its decisions and the house it reads.
//
// PART OF THE SIDE PANE (hk-sidepane.js). Not a card and not run on its own: it registers one
// function, which hk-sidepane.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSidePaneParts = window.hkSidePaneParts || {})['hk-sidepane-decide'] = function (K) {
    // ------------------------------------------------------------ the sections
    // kind -> [name, glyph, color] (the settings page's rows wear the same)
    var KINDS = {
      clock: ['Clock', 'mdi:clock', '#8e8e93'], weather: ['Weather', 'mdi:weather-partly-cloudy', '#32ade6'],
      calendar: ['Calendar', 'mdi:calendar', '#ff3b30'], now_playing: ['Now Playing', 'mdi:music', '#ff2d55'],
      security: ['Security', 'mdi:shield-home', '#30b0c7'], camera: ['Camera', 'mdi:cctv', '#636366'],
      timers: ['Timers', 'mdi:timer-outline', '#ff9500'], energy: ['Energy', 'mdi:lightning-bolt', '#34c759'],
      climate: ['Climate', 'mdi:thermostat', '#007aff'], people: ['Who’s Home', 'mdi:account', '#5856d6'],
      todo: ['To-do', 'mdi:clipboard-check', '#ff9500'], notifications: ['Notifications', 'mdi:bell', '#ff3b30'],
      status: ['Status', 'mdi:card-text-outline', '#5ac8fa']
    };
    var ORDER = ['clock', 'weather', 'calendar', 'now_playing', 'security', 'camera', 'timers', 'energy', 'climate',
                 'people', 'todo', 'notifications', 'status'];
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
    // says it has something -- a Status only ever while its rule holds
    function shown(list, has) {
      return (list || []).filter(function (s) { return s && KINDS[s.kind] && ((s.when !== 'active' && s.kind !== 'status') || !!has(s)); }).slice(0, MAX);
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
      var all = states(c), st = all[ctx.key] || {}, a = st.attributes || {};
      var pic = a.entity_picture_local || a.entity_picture || '';
      var dur = num(a.media_duration) || 0, pos = num(a.media_position) || 0, at = Date.parse(a.media_position_updated_at) || 0;
      var playing = st.state === 'playing';
      var t = pos + (playing && at ? (Date.now() - at) / 1000 : 0);
      // A GROUP'S VOLUME IS ITS ROOMS' (2026-11-05, the owner: "the volume slider in the music pane isn't working", music
      // on Everywhere): the slider shows their average and sets every one, as the player's and the music panel's do;
      // the leader's alone moved one room of nine and sprang back
      var members = Array.isArray(ctx.members) && ctx.members.length > 1 ? ctx.members.slice() : [ctx.key];
      var vols = members.map(function (k) { return num(attr(all[k], 'volume_level')); }).filter(function (x) { return x !== null; });
      var vol = members.length > 1 ? (vols.length ? vols.reduce(function (n, x) { return n + x; }, 0) / vols.length : null) : num(a.volume_level);
      return { key: ctx.key, members: members, rooms: window.hkNpStrip.rooms({ states: all }, ctx.key, members), playing: playing, title: ctx.title || a.media_title || '', artist: ctx.artist ||
        a.media_artist || '',
               pic: pic, at: dur ? Math.max(0, Math.min(1, t / dur)) : 0, left: dur ? Math.max(0, dur - t) : 0, vol: vol };
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
    function shieldOf(a) { var C = window.hkCards; return a && C && C.alarmGlyph ? C.alarmGlyph(a) : KINDS.security[1]; }
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
        case 'status': return !!s.entity && !!st[s.entity] && met(s.show, st);
        default: return true;
      }
    }

    // A STATUS'S RULE (2026-11-06; the Screensaver's Shows When, hk-saverlayout.js met(), which this file can't wait
    // for -- the screensaver loads it): {entity, op: is / not / above / below, value}; none, always. An entity this
    // screen can't read, or unavailable, never holds -- absent is not the same as "not"
    function met(show, st) {
      if (!show) return true;
      var x = st && st[show.entity];
      if (!x || x.state === 'unavailable' || x.state === 'unknown') return false;
      var s = String(x.state), v = show.value;
      if (show.op === 'above' || show.op === 'below') {
        var a = parseFloat(s), b = typeof v === 'number' ? v : parseFloat(v);
        if (!isFinite(a) || !isFinite(b)) return false;
        return show.op === 'above' ? a > b : a < b;
      }
      var same = s.toLowerCase() === String(v).toLowerCase() || (isFinite(parseFloat(s)) && parseFloat(s) === (typeof v === 'number' ? v : parseFloat(v)));
      return show.op === 'is' ? same : !same;
    }
    // ...and what it says: its own name and label, else the entity's name and its state (with its unit), and its
    // glyph in its color (the chip's palette, hkCards.PALETTE.icon: "blue" the Home app's blue)
    function stateWords(x) {
      var u = attr(x, 'unit_of_measurement'), s = String(x && x.state != null ? x.state : '');
      return (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ') + (u ? ' ' + u : '');
    }
    function statusOf(sec, c) {
      var x = sec.entity && states(c)[sec.entity];
      if (!x) return null;
      var P = C() && C().PALETTE && C().PALETTE.icon, col = sec.color && P && P[sec.color];
      return { name: sec.name || nameOf(x, sec.entity), label: sec.label || stateWords(x),
               icon: sec.icon || attr(x, 'icon') || 'mdi:information-outline', color: col || '' };
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
        // (hk-calendar.js is cut into parts: window.hkCalendar is there once they have run -- its promise in
        // window.__hkSplitReady -- not when the file itself has)
        import(window.hkV ? window.hkV('/hk/cards/hk-calendar.js') : '/hk/cards/hk-calendar.js')
          .then(function () { return (window.__hkSplitReady || {})['hk-calendar']; })
          .then(done, function () { CAL.evs = []; done(); });
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

    // what the shell and the later parts use of this one
    K.ago = ago; K.ALARM = ALARM; K.alarmOf = alarmOf; K.allDay = allDay; K.ART = ART; K.ART_MAX = ART_MAX;
    K.ART_MEAN = ART_MEAN; K.attr = attr; K.BAND_H = BAND_H; K.C = C; K.CAL = CAL; K.calComing = calComing;
    K.calLoad = calLoad; K.clientNow = clientNow; K.condName = condName; K.dateLong = dateLong;
    K.dateShort = dateShort; K.deg = deg; K.domainIds = domainIds; K.DRAWN_W = DRAWN_W; K.energyToday = energyToday;
    K.esc = esc; K.evStart = evStart; K.FACE_COLORS = FACE_COLORS; K.fit = fit; K.has = has; K.hm = hm;
    K.houseNow = houseNow; K.HS = HS; K.icon = icon; K.inkGlyph = inkGlyph; K.KINDS = KINDS; K.kinds = kinds; K.L = L;
    K.LOST = LOST; K.MAX = MAX; K.met = met; K.musicNow = musicNow; K.musicOf = musicOf; K.nameOf = nameOf;
    K.NOTES = NOTES; K.notesOf = notesOf; K.nowTemp = nowTemp; K.num = num; K.openOf = openOf; K.ORDER = ORDER;
    K.pic = pic; K.place = place; K.saverList = saverList; K.setting = setting; K.shieldOf = shieldOf;
    K.shown = shown; K.SIZES = SIZES; K.states = states; K.statusOf = statusOf; K.timersOf = timersOf; K.TODO = TODO;
    K.todoAdd = todoAdd; K.todoCheck = todoCheck; K.todoOf = todoOf; K.wants = wants; K.WIDTHS = WIDTHS;
    K.wxGlyph = wxGlyph; K.wxIcon = wxIcon;
  };
})();
