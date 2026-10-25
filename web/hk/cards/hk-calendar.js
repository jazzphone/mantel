// hk-calendar.js -- the house's calendars: the Calendar page, its event
// sheet, and the screensaver's calendar pane.
//
// hk-calendar-card       the Calendar page (hk-strategy.js `calendar`): the
//                        month, the week or the day, moved through with the
//                        arrows (or a swipe), events added, changed and deleted
// hk-calendar-pane-card  the screensaver's pane (hk-saver.js, option
//                        `calendar`): today's events and the coming days',
//                        down the right of the screen
// window.hkCalendar      the events of the calendars (Home Assistant's own
//                        calendar API) and the sheet that shows and edits one
// hk-detail-event        THE EVENT SHEET (hk-detail.js kind `event`): an HK
//                        sheet like every other -- the event, and its day
//                        beside it -- opened by the Calendar page, a
//                        calendar's tile and a calendar's notification
//
// WHICH CALENDARS, AND THEIR COLOURS: All Screens -> Calendar
// (hkSettings.calendarIds / calendarColor), read live -- a change there
// redraws these cards and rebuilds nothing.
//
// THE EVENTS come from GET /api/calendars/<entity>?start&end (the same
// answer Home Assistant's own calendar panel draws), for the range a card
// shows, and are shared between cards for a minute. Adding, changing and
// deleting go through calendar/event/create | update | delete, offered only
// where the calendar says it can (supported_features: 1 create, 2 delete,
// 4 update -- a Local Calendar can do all three, a read-only feed none).
(function () {
  'use strict';

  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-calendar] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkCalendar) return;              // double-load guard
  var HkBase = C.HkBase, M = C.M, register = C.register, esc = C.esc;

  // ------------------------------------------------------------ dates
  var DAY_MS = 86400000;
  var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
             'October', 'November', 'December'];
  var MON3 = MON.map(function (m) { return m.slice(0, 3); });
  // the calendar's own red (Apple Calendar's, as StandBy draws today): Month View's name and today's circle
  var CAL_RED = '#ff453a';
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // calendar days, not 24-hour steps: a daylight-saving day is 23 or 25 hours
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()); }
  function addMonths(d, n) {
    var t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    var last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
  }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  // THE WEEK STARTS ON THE USER'S FIRST DAY (their Home Assistant profile;
  // "language" is the language's own, Sunday for English): the week view,
  // the month's rows and the little month alike, as the Energy page's weeks
  var WS = 0;
  function setWeekStart(h) { if (window.hkStats && window.hkStats.weekStart) WS = window.hkStats.weekStart(h); }
  function weekStart(d) { var x = day0(d); return addDays(x, -((x.getDay() - WS + 7) % 7)); }
  function dows(list) { return list.slice(WS).concat(list.slice(0, WS)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  // local time with its offset: what calendar/event/create takes, and what
  // the events API reads as a moment
  function isoLocal(d) {
    var o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-';
    o = Math.abs(o);
    return ymd(d) + 'T' + hm(d) + ':' + pad(d.getSeconds()) + s + pad(Math.floor(o / 60)) + ':' + pad(o % 60);
  }
  function time(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  // the month grid's short form: 7a, 5:30p
  function tshort(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + (m ? ':' + pad(m) : '') + (h < 12 ? 'a' : 'p');
  }
  function hourLabel(h) { return h === 0 ? '12 AM' : h === 12 ? 'Noon' : (h % 12) + (h < 12 ? ' AM' : ' PM'); }
  function span(ev) {
    if (ev.allDay) {
      var last = addDays(ev.end, -1);
      return sameDay(ev.start, last) ? 'All day' : 'All day · through ' + MON3[last.getMonth()] + ' ' + last.getDate();
    }
    var e = ev.end, s = ev.start;
    if (sameDay(s, e) || (+e === +addDays(day0(s), 1))) return time(s) + ' – ' + time(e);
    return time(s) + ' – ' + MON3[e.getMonth()] + ' ' + e.getDate() + ', ' + time(e);
  }
  // "in 46 min", "in 2 hr", "Now"
  function soon(ev, now) {
    if (ev.allDay) return '';
    if (ev.start <= now && ev.end > now) return 'Now';
    var min = Math.round((ev.start - now) / 60000);
    if (min <= 0 || min > 180) return '';
    if (min < 60) return 'in ' + min + ' min';
    var hr = Math.floor(min / 60), r = min % 60;
    return 'in ' + hr + ' hr' + (r >= 5 ? ' ' + r + ' min' : '');
  }

  // ------------------------------------------------------------ calendars
  var WHITE = [255, 255, 255];
  function calIds(client) {
    var HS = window.hkSettings, st = (client && client.states) || {};
    if (HS && HS.calendarIds) return HS.calendarIds(st);
    return Object.keys(st).filter(function (k) { return k.indexOf('calendar.') === 0; }).sort();
  }
  function rgbOf(id, client) {
    var HS = window.hkSettings, key = HS && HS.calendarColor ? HS.calendarColor(id, (client && client.states) || {}) : 'orange';
    var hue = (C.PALETTE && C.PALETTE.chart) || {};
    return key === 'white' ? WHITE : (hue[key] && hue[key].length === 3 ? hue[key] : [255, 159, 10]);
  }
  // an event's color: its own, a keyword's, else its calendar's (hkSettings.eventColor)
  function evRgb(ev, client) {
    var HS = window.hkSettings;
    if (!ev || !HS || !HS.eventColor) return rgbOf(ev && ev.cal, client);
    var key = HS.eventColor(ev.cal, ev.title, ev.uid, (client && client.states) || {});
    var hue = (C.PALETTE && C.PALETTE.chart) || {};
    return key === 'white' ? WHITE : (hue[key] && hue[key].length === 3 ? hue[key] : evRgb(ev, client));
  }
  // the keywords and the events' own colors, for a card's signature
  function colorSig() {
    var HS = window.hkSettings;
    return HS && HS.get ? '|' + JSON.stringify([HS.get('calendar.keywords', []), HS.get('calendar.event_colors', {})]) : '';
  }
  // AN EVENT'S BLOCK (2026-10-16, the user: the blocks were dim and hard to
  // read): its color as a tint over an opaque dark base, so the photo or the
  // sky behind the glass no longer shows through the words, and -- for a
  // block in the hours -- a solid edge of the color itself
  // (the base is the design's solid overlay, hkCards.OVER.solid)
  function fill(rgb, a) { return 'linear-gradient(' + rgba(rgb, a) + ',' + rgba(rgb, a) + '),' + ((C.OVER && C.OVER.solid) || 'rgba(24,24,28,0.93)'); }
  // Calendar colors are content, including event/keyword overrides. Flat
  // uses the full assigned color; the Glass looks keep the opaque tint.
  // Keep both in CSS so changing appearance updates an already-open sheet.
  function eventStyle(rgb, a) {
    var c = rgb.map(function (n) { var s = n / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    var luminance = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    var ink = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000' : '#fff';
    return 'background:var(--hk-cal-event-fill,' + fill(rgb, a) + ');--hk-cal-event-color:' + rgba(rgb, 1) + ';--hk-cal-event-ink:' + ink;
  }
  var FLAT_EVENT_CSS = [
    ':host([hk-flat]) :is(.bar1,.ad,.blk,.tlad button,.tlb){--hk-cal-event-fill:var(--hk-cal-event-color);color:var(--hk-cal-event-ink);opacity:1}',
    ':host([hk-flat]) :is(.ad em,.blk .t2,.tlb .t2){color:var(--hk-cal-event-ink)}',
    ':host([hk-flat]) .ev.past{opacity:1}'
  ].join('');
  function edge(rgb) { return ';--e:' + rgba(rgb, 1); }
  function rgba(rgb, a) { return 'rgba(' + rgb.join(',') + ',' + a + ')'; }
  function features(client, id) {
    var st = client && client.states && client.states[id];
    return Number((st && st.attributes && st.attributes.supported_features) || 0);
  }
  function can(client, id, what) { return !!(features(client, id) & ({ create: 1, delete: 2, update: 4 })[what]); }
  function calName(client, id) {
    var st = client && client.states && client.states[id];
    return (st && st.attributes && st.attributes.friendly_name) || id;
  }
  function writable(client) { return calIds(client).filter(function (id) { return can(client, id, 'create'); }); }

  // ------------------------------------------------------------ events
  // One event, as the cards use it: start and end as Dates (an all-day
  // event's end is the day AFTER its last, as the API gives it).
  function norm(cal, e) {
    var s = e.start || {}, en = e.end || {};
    var allDay = !s.dateTime && !!s.date;
    var start = allDay ? parseYmd(s.date) : new Date(s.dateTime);
    var end = allDay ? parseYmd(en.date) : new Date(en.dateTime || s.dateTime);
    if (!start || isNaN(start)) return null;
    if (!end || isNaN(end) || end <= start) end = allDay ? addDays(start, 1) : new Date(+start + 3600000);
    return { cal: cal, uid: e.uid || null, rid: e.recurrence_id || null, rrule: e.rrule || null,
             title: String(e.summary || 'Untitled'), desc: String(e.description || ''), loc: String(e.location || ''),
             allDay: allDay, start: start, end: end,
             key: cal + '|' + (e.uid || '') + '|' + (e.recurrence_id || '') + '|' + (+start) };
  }
  function byStart(a, b) {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.start - b.start) || (b.end - a.end) || (a.title < b.title ? -1 : 1);
  }
  // A DAY'S OWN EVENTS for a dot: what starts that day or lasts no longer
  // than it -- not a month-long all-day event passing through
  function ownDay(evs, d) {
    var a = day0(d);
    return onDay(evs, d).filter(function (e) { return sameDay(e.start, a) || (e.end - e.start) <= DAY_MS; });
  }
  // the events touching a day
  function onDay(evs, d) {
    var a = day0(d), b = addDays(a, 1);
    return evs.filter(function (e) { return e.start < b && e.end > a; }).sort(byStart);
  }

  // THE SHARED STORE: one answer per (calendar, range) for a minute, so the
  // page and the pane (or two cards) ask once. `ver` moves on every edit
  // made here, and every card asks again.
  var store = { ver: 0, got: {}, live: {} };
  var TTL = 60000;
  function fetchOne(client, id, from, to) {
    var key = id + '|' + (+from) + '|' + (+to) + '|' + store.ver, hit = store.got[key];
    if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.evs);
    if (store.live[key]) return store.live[key];
    var path = 'calendars/' + id + '?start=' + encodeURIComponent(isoLocal(from)) + '&end=' + encodeURIComponent(isoLocal(to));
    var p;
    try { p = Promise.resolve(client.callApi('GET', path)); } catch (e) { p = Promise.reject(e); }
    p = p.then(function (r) {
      var evs = (Array.isArray(r) ? r : []).map(function (e) { return norm(id, e); }).filter(Boolean);
      store.got[key] = { at: Date.now(), evs: evs };
      delete store.live[key];
      return evs;
    }, function (err) {
      delete store.live[key];
      throw err;
    });
    store.live[key] = p;
    return p;
  }
  // the line over the page when calendars could not be read: a calendar
  // Home Assistant has as unavailable (its account signed out, say) says so
  function failedLine(h, ids) {
    var names = ids.map(function (id) { return calName(h, id); }).join(', ');
    var off = ids.every(function (id) { var s = h && h.states && h.states[id]; return s && s.state === 'unavailable'; });
    return names + (off ? (ids.length > 1 ? ' are' : ' is') + ' unavailable in Home Assistant.' : ' couldn’t be read.');
  }
  // every chosen calendar's events from `from` to `to`; a calendar that
  // fails is left out (and said so), the rest still show
  function load(client, ids, from, to) {
    if (!client || !client.callApi || !ids.length) return Promise.resolve({ evs: [], failed: [] });
    var failed = [];
    return Promise.all(ids.map(function (id) {
      return fetchOne(client, id, from, to).catch(function (e) {
        console.warn('[hk-calendar]', id, e && (e.message || e.body || e));
        failed.push(id);
        return [];
      });
    })).then(function (lists) {
      // (in the calendars' own order, not the order the failures came back:
      // the line read "Work, Family" on one load and "Family, Work" on the next)
      failed = ids.filter(function (id) { return failed.indexOf(id) >= 0; });
      return { evs: [].concat.apply([], lists).sort(byStart), failed: failed };
    });
  }
  function changed() {
    store.ver++;
    store.got = {};
    try { window.dispatchEvent(new CustomEvent('hk-calendar-changed')); } catch (e) { /* ignore */ }
  }

  // ADD, CHANGE, DELETE. `ev` is the event as norm() made it; `scope` for an
  // occurrence of a repeating event: '' (this one) or 'THISANDFUTURE'.
  function payload(f) {
    var o = { summary: f.title };
    if (f.allDay) { o.dtstart = ymd(f.start); o.dtend = ymd(addDays(day0(f.end), 1)); }
    else { o.dtstart = isoLocal(f.start); o.dtend = isoLocal(f.end); }
    if (f.desc) o.description = f.desc;
    if (f.loc) o.location = f.loc;
    if (f.rrule) o.rrule = f.rrule;
    return o;
  }
  function wsErr(e) { return (e && (e.message || e.code)) || 'Home Assistant refused it.'; }
  // A write: through the caller's client's action port (hkCards.actions,
  // which still turns a caller's host input into its client).
  function writer(x) { return window.hkCards.actions(x); }
  function create(client, cal, f) {
    return writer(client).callWS({ type: 'calendar/event/create', entity_id: cal, event: payload(f) })
      .then(function () { changed(); }, function (e) { throw new Error(wsErr(e)); });
  }
  function update(client, ev, f, scope) {
    var msg = { type: 'calendar/event/update', entity_id: ev.cal, uid: ev.uid, event: payload(f) };
    if (ev.rid) { msg.recurrence_id = ev.rid; if (scope) msg.recurrence_range = scope; }
    return writer(client).callWS(msg).then(function () { changed(); }, function (e) { throw new Error(wsErr(e)); });
  }
  function remove(client, ev, scope) {
    var msg = { type: 'calendar/event/delete', entity_id: ev.cal, uid: ev.uid };
    if (ev.rid) { msg.recurrence_id = ev.rid; if (scope) msg.recurrence_range = scope; }
    return writer(client).callWS(msg).then(function () { changed(); }, function (e) { throw new Error(wsErr(e)); });
  }

  // OVERLAPPING EVENTS SIDE BY SIDE in a day's column: each cluster of
  // events that overlap shares the width, each in the first free lane.
  function lanes(evs) {
    var out = [], cluster = [], end = -Infinity;
    function flush() {
      var cols = [];
      cluster.forEach(function (it) {
        var c = 0;
        while (cols[c] && cols[c] > +it.s) c++;
        cols[c] = +it.e;
        it.col = c;
      });
      cluster.forEach(function (it) { it.cols = cols.length; out.push(it); });
      cluster = [];
    }
    evs.slice().sort(function (a, b) { return (a.s - b.s) || (b.e - a.e); }).forEach(function (it) {
      if (+it.s >= end) { flush(); end = -Infinity; }
      cluster.push(it);
      end = Math.max(end, +it.e);
    });
    flush();
    return out;
  }
  // ALL-DAY BARS across a row of days: each event's first and last column
  // in the row, in the first lane free for all of them.
  function bars(evs, from, n) {
    var to = addDays(from, n), used = [], out = [];
    evs.filter(function (e) { return (e.allDay || (e.end - e.start) >= DAY_MS) && e.start < to && e.end > from; })
      .sort(function (a, b) { return (a.start - b.start) || (b.end - a.end); })
      .forEach(function (e) {
        var a = Math.max(0, Math.floor((day0(e.start) - from) / DAY_MS + 0.5));
        var lastDay = e.allDay ? addDays(e.end, -1) : (e.end.getHours() || e.end.getMinutes() ? e.end : addDays(e.end, -1));
        var b = Math.min(n - 1, Math.floor((day0(lastDay) - from) / DAY_MS + 0.5));
        if (b < a) b = a;
        var lane = 0;
        while ((used[lane] || []).some(function (r) { return !(b < r[0] || a > r[1]); })) lane++;
        (used[lane] = used[lane] || []).push([a, b]);
        out.push({ ev: e, a: a, b: b, lane: lane, cont: e.start < from, more: e.end > to });
      });
    return { list: out, lanes: used.length };
  }

  // ------------------------------------------------------------ icons
  var IC = {
    left: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    notes: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14M5 11h14M5 16h9"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>'
  };

  // ------------------------------------------------------------ the sheet
  // ONE SHEET, reused, on document.body (no card's overflow can clip it,
  // like hk-base's confirmSheet): an event shown, or the form that adds or
  // changes one. Its own shadow root, so nothing on the page styles it.
  var REPEATS = [['', 'Never'], ['FREQ=DAILY', 'Every Day'], ['FREQ=WEEKLY', 'Every Week'],
                 ['FREQ=MONTHLY', 'Every Month'], ['FREQ=YEARLY', 'Every Year']];
  var SHEET_CSS = [
    ':host{position:fixed;inset:0;z-index:9000;display:none;' + C.FONT_ROOT + ';',
    '  -webkit-tap-highlight-color:transparent}',
    ':host([open]){display:block}',
    '*{box-sizing:border-box;font-family:inherit}',
    '.back{position:absolute;inset:0;background:rgba(4,10,24,0.5)}',
    '.box{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 24px));',
    '  max-height:calc(var(--hk-vh,100vh) - 24px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;',
    '  border-radius:28px;border:1px solid rgba(255,255,255,0.14);background:rgba(24,24,28,0.93);color:' + window.hkCards.v('ink') + ';',
    '  box-shadow:0 30px 80px rgba(0,0,0,0.45);padding:0 20px 22px}',
    '.hd{display:flex;align-items:center;height:64px;position:sticky;top:0;background:linear-gradient(rgba(24,24,28,0.93),rgba(24,24,28,0.93)),rgba(24,24,28,0.93);z-index:1;margin:0 -20px;padding:0 20px}',
    // the title riding on the form once it has scrolled (hk-base.js shade)
    C.shadeCss('.hd'),
    '.hd .t{flex:1;text-align:center;font-size:17px;font-weight:700}',
    'button{appearance:none;font:inherit;cursor:pointer;color:' + window.hkCards.v('ink') + '}',
    '.tb{height:40px;padding:0 14px;border:0;border-radius:20px;background:transparent;font-size:17px;font-weight:500;min-width:72px}',
    '.go{background:#fff;color:#1c1c1e;font-weight:700;padding:0 20px}',
    // a text button's words on the form's edge (the pill keeps its own)
    '.hd > .tb:first-child:not(.go){padding-left:0;text-align:left}',
    '.hd > .tb:last-child:not(.go){padding-right:0;text-align:right}',
    '.go[disabled]{opacity:0.4;cursor:default}',
    '.grp{border-radius:14px;background:rgba(255,255,255,0.08);margin-top:14px}',
    '.row{display:flex;align-items:center;min-height:52px;padding:0 16px;gap:10px}',
    '.row + .row{border-top:1px solid rgba(255,255,255,0.1)}',
    '.row .l{font-size:17px;flex:1}',
    'input,textarea,select{font:inherit;color:' + window.hkCards.v('ink') + ';background:transparent;border:0;outline:none}',
    'input::placeholder,textarea::placeholder{color:' + window.hkCards.v('ink-3') + '}',
    '.title{flex:1;font-size:19px;font-weight:600;height:52px}',
    '.loc{flex:1;font-size:17px;height:52px}',
    'textarea{width:100%;font-size:17px;resize:none;padding:14px 16px;min-height:76px;display:block;overflow-wrap:anywhere}',
    '.pick{height:36px;padding:0 10px;border-radius:10px;background:rgba(255,255,255,0.14);font-size:16px;color-scheme:dark}',
    'select.pick{padding:0 8px;max-width:240px}',
    'select option{color:#000}',
    '.sw{width:52px;height:32px;border-radius:16px;border:0;background:rgba(255,255,255,0.22);padding:2px;display:flex;transition:background .2s}',
    '.sw span{width:28px;height:28px;border-radius:14px;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,0.25);transition:transform .2s}',
    '.sw[aria-checked="true"]{background:#30d158}',
    '.sw[aria-checked="true"] span{transform:translateX(20px)}',
    '.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:12px 16px}',
    '.chip{height:36px;padding:0 12px;border-radius:18px;border:0;background:rgba(255,255,255,0.1);font-size:14px;font-weight:600}',
    '.chip[aria-pressed="true"]{background:#fff;color:#1c1c1e}',
    '.dot{width:10px;height:10px;border-radius:5px;flex:none}',
    '.err{color:#ffb3ae;font-size:14px;font-weight:600;padding:12px 4px 0;display:none}',
    '.err[data-on]{display:block}',
    '.del{width:100%;margin-top:14px;height:48px;border-radius:14px;border:1px solid rgba(255,105,97,0.45);background:rgba(255,69,58,0.16);',
    '  color:#ffb3ae;font-size:17px;font-weight:600}',
    // the event, shown
    '.vw{padding:6px 0 0}',
    '.vw .cal{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
    '.vw h2{margin:8px 0 0;font-size:26px;font-weight:700;letter-spacing:-0.3px;line-height:1.2;overflow-wrap:anywhere}',
    '.vw .ln{display:flex;align-items:flex-start;gap:10px;margin-top:12px;font-size:16px;line-height:1.35}',
    '.vw .ln svg{flex:none;margin-top:2px;opacity:0.85}',
    // A LONG WORD OR LINK (a FaceTime or Zoom link in the notes) breaks
    // where it must, rather than widening the sheet into a sideways scroll
    '.vw .ln span{min-width:0;overflow-wrap:anywhere}',
    '.vw .note{white-space:pre-wrap;color:' + window.hkCards.v('ink-2') + '}',
    '.acts{display:flex;gap:10px;margin-top:20px}',
    '.acts button{flex:1;height:48px;border-radius:24px;font-size:17px;font-weight:600}',
    '.acts .ed{border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.12)}',
    '.acts .rm{border:1px solid rgba(255,105,97,0.45);background:rgba(255,69,58,0.16);color:#ffb3ae}',
    '.ro{margin-top:16px;font-size:14px;color:' + window.hkCards.v('ink-2') + '}',
    '.pk{display:flex;gap:8px;margin-left:auto}',
    // a phone: the label over its date and time
    '@media (max-width:460px){.box{padding:0 14px 18px}.hd{margin:0 -14px;padding:0 14px}.dt{flex-wrap:wrap;padding:10px 16px;gap:8px}',
    '  .dt .l{flex-basis:100%}.dt .pk{margin-left:0;flex:1 1 100%;min-width:0}.dt .pick{flex:1 1 0;min-width:0;width:0}}'
  ].join('\n');

  var sheet = null;
  function sheetEl() {
    if (sheet) return sheet;
    var host = document.createElement('hk-calendar-sheet');
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + SHEET_CSS + '</style><div class="back"></div>' +
      '<div class="box" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(host);
    sheet = { host: host, root: root, box: root.querySelector('.box'), onKey: null };
    // (its header is drawn again with each view: found when it is needed)
    C.shade(sheet.box, function () { return sheet.box.querySelector('.hd'); }, { foot: true });
    root.querySelector('.back').addEventListener('click', function () { if (sheet.backdrop) closeSheet(); });
    return sheet;
  }
  function openSheet(label, backdrop) {
    var s = sheetEl();
    s.backdrop = backdrop;
    s.box.setAttribute('aria-label', label);
    s.host.setAttribute('open', '');
    if (!s.onKey) {
      s.onKey = function (e) { if (e.key === 'Escape' && sheet.host.hasAttribute('open')) { e.stopPropagation(); closeSheet(); } };
      document.addEventListener('keydown', s.onKey, true);
    }
    return s;
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.host.removeAttribute('open');
    sheet.box.innerHTML = '';
    if (sheet.onKey) { document.removeEventListener('keydown', sheet.onKey, true); sheet.onKey = null; }
  }

  // AN EVENT, SHOWN: when, where, the notes, and Edit / Delete where the
  // calendar allows them.
  function show(client, ev) {
    // AN HK SHEET, the size of every other (hk-detail.js): this one stays
    // for the editor and for a screen without hk-detail
    if (window.hkDetail && customElements.get('hk-detail-event') && window.hkDetail.open(ev.cal, null, { event: ev })) return;
    var s = openSheet(ev.title, true), rgb = evRgb(ev, client);
    var day = ev.allDay ? '' : (sameDay(ev.start, new Date()) ? 'Today, ' : DOW_LONG[ev.start.getDay()] + ', ' +
              MON3[ev.start.getMonth()] + ' ' + ev.start.getDate() + ', ');
    var allDayWhen = ev.allDay ? DOW_LONG[ev.start.getDay()] + ', ' + MON[ev.start.getMonth()] + ' ' + ev.start.getDate() + ' · ' + span(ev) : '';
    var edit = can(client, ev.cal, 'update') && ev.uid, del = can(client, ev.cal, 'delete') && ev.uid;
    s.box.innerHTML =
      '<div class="hd"><span class="tb" aria-hidden="true"></span><div class="t">Event</div>' +
      '<button class="tb" data-a="close">Done</button></div>' +
      '<div class="vw"><div class="cal"><span class="dot" style="background:' + rgba(rgb, 1) + '"></span>' + esc(calName(client, ev.cal)) + '</div>' +
      '<h2>' + esc(ev.title) + '</h2>' +
      '<div class="ln">' + IC.clock + '<span>' + esc(ev.allDay ? allDayWhen : day + span(ev)) + '</span></div>' +
      (ev.rrule ? '<div class="ln">' + IC.repeat + '<span>' + esc(repeatLabel(ev.rrule)) + '</span></div>' : '') +
      (ev.loc ? '<div class="ln">' + IC.pin + '<span>' + esc(ev.loc) + '</span></div>' : '') +
      (ev.desc ? '<div class="ln">' + IC.notes + '<span class="note">' + esc(ev.desc) + '</span></div>' : '') +
      (edit || del ? '<div class="acts">' + (edit ? '<button class="ed" data-a="edit">Edit</button>' : '') +
                     (del ? '<button class="rm" data-a="del">Delete</button>' : '') + '</div>'
                   : '<div class="ro">Home Assistant can’t edit this calendar, so its events can’t be changed or deleted here.</div>') +
      '</div>';
    s.box.onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'close') closeSheet();
      else if (a === 'edit') edit_(client, ev);
      else if (a === 'del') askDelete(client, ev, function () { closeSheet(); });
    };
  }
  function repeatLabel(r) {
    var hit = REPEATS.filter(function (x) { return x[0] && x[0] === r; })[0];
    if (hit) return hit[1];
    var f = /FREQ=([A-Z]+)/.exec(r || '');
    return f ? 'Repeats ' + f[1].toLowerCase() : 'Repeats';
  }
  // DELETE, asked first; an occurrence of a repeating event asks which.
  function askDelete(client, ev, done) {
    var go = function (scope) {
      remove(client, ev, scope).then(done, function (e) {
        C.confirmSheet('Couldn’t delete “' + ev.title + '”', function () {}, { detail: e.message, yes: 'OK', no: 'Close' });
      });
    };
    if (ev.rid) {
      C.chooseSheet('Delete “' + ev.title + '”?', [{ name: 'This Event Only', scope: '' },
        { name: 'This and Future Events', scope: 'THISANDFUTURE' }], function (o) { go(o.scope); });
    } else {
      C.confirmSheet('Delete “' + ev.title + '”?', function () { go(''); }, { yes: 'Delete', detail: span(ev) });
    }
  }

  // THE FORM: a new event (`ev` null; `seed` = {cal, start, end, allDay}) or
  // a change to one.
  function edit_(client, ev, seed) {
    var cals = writable(client);
    if (!ev && !cals.length) return;
    var isNew = !ev;
    var f = ev ? { cal: ev.cal, title: ev.title, loc: ev.loc, desc: ev.desc, allDay: ev.allDay, rrule: ev.rrule || '',
                   start: new Date(ev.start), end: ev.allDay ? addDays(ev.end, -1) : new Date(ev.end) }
               : { cal: (seed && seed.cal && cals.indexOf(seed.cal) >= 0) ? seed.cal : cals[0], title: '', loc: '', desc: '',
                   allDay: !!(seed && seed.allDay), rrule: '', start: seed.start, end: seed.end };
    var origRule = f.rrule;
    var s = openSheet(isNew ? 'New Event' : 'Edit Event', false);
    var repeatOpts = REPEATS.slice();
    if (f.rrule && !REPEATS.some(function (r) { return r[0] === f.rrule; })) repeatOpts.push([f.rrule, repeatLabel(f.rrule)]);
    s.box.innerHTML =
      '<div class="hd"><button class="tb" data-a="cancel">Cancel</button><div class="t">' + (isNew ? 'New Event' : 'Edit Event') + '</div>' +
      '<button class="tb go" data-a="save">' + (isNew ? 'Add' : 'Save') + '</button></div>' +
      '<div class="grp"><label class="row"><span style="display:none">Title</span>' +
      '<input class="title" data-f="title" placeholder="Title" maxlength="200" aria-label="Title"></label>' +
      '<label class="row">' + IC.pin + '<input class="loc" data-f="loc" placeholder="Location" maxlength="200" aria-label="Location"></label></div>' +
      '<div class="grp"><div class="row"><span class="l" id="adl">All-day</span>' +
      '<button class="sw" role="switch" data-a="allday" aria-labelledby="adl"><span></span></button></div>' +
      '<div class="row dt"><span class="l">Starts</span><span class="pk"><input type="date" class="pick" data-f="sd" aria-label="Start date">' +
      '<input type="time" class="pick" data-f="st" step="300" aria-label="Start time"></span></div>' +
      '<div class="chips" data-f="chips"></div>' +
      '<div class="row dt"><span class="l">Ends</span><span class="pk"><input type="date" class="pick" data-f="ed" aria-label="End date">' +
      '<input type="time" class="pick" data-f="et" step="300" aria-label="End time"></span></div></div>' +
      '<div class="grp"><div class="row">' + IC.repeat + '<span class="l">Repeat</span><select class="pick" data-f="rrule" aria-label="Repeat">' +
      repeatOpts.map(function (r) { return '<option value="' + esc(r[0]) + '">' + esc(r[1]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="row"><span class="dot" data-f="calDot"></span><span class="l">Calendar</span><select class="pick" data-f="cal" aria-label="Calendar"' +
      (isNew ? '' : ' disabled') + '>' + (isNew ? cals : [f.cal]).map(function (id) {
        return '<option value="' + esc(id) + '">' + esc(calName(client, id)) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="grp"><textarea data-f="desc" rows="3" placeholder="Notes" maxlength="2000" aria-label="Notes"></textarea></div>' +
      '<div class="err" role="alert"></div>' +
      (isNew || !can(client, f.cal, 'delete') || !ev.uid ? '' : '<button class="del" data-a="del">Delete Event</button>');
    var q = function (k) { return s.box.querySelector('[data-f="' + k + '"]'); };
    var save = s.box.querySelector('[data-a="save"]'), err = s.box.querySelector('.err');
    q('title').value = f.title; q('loc').value = f.loc; q('desc').value = f.desc; q('rrule').value = f.rrule || '';
    q('cal').value = f.cal;
    function paintTimes() {
      q('sd').value = ymd(f.start); q('ed').value = ymd(f.end);
      q('st').value = hm(f.start); q('et').value = hm(f.end);
      ['st', 'et'].forEach(function (k) { q(k).style.display = f.allDay ? 'none' : ''; });
      s.box.querySelector('[data-a="allday"]').setAttribute('aria-checked', f.allDay ? 'true' : 'false');
      q('calDot').style.background = rgba(rgbOf(f.cal, client), 1);
      // QUICK TIMES around the start, every half hour
      var box = q('chips');
      box.style.display = f.allDay ? 'none' : '';
      if (!f.allDay) {
        var base = new Date(f.start); base.setMinutes(base.getMinutes() < 30 ? 0 : 30, 0, 0);
        var html = '';
        for (var i = -2; i <= 2; i++) {
          var t = new Date(+base + i * 1800000);
          if (!sameDay(t, f.start)) continue;
          html += '<button class="chip" data-a="quick" data-t="' + hm(t) + '" aria-pressed="' + (hm(t) === hm(f.start)) + '">' + time(t) + '</button>';
        }
        box.innerHTML = html;
      }
      save.disabled = !q('title').value.trim();
    }
    paintTimes();
    var dur = function () { return f.end - f.start; };
    function setStart(d) { var keep = Math.max(f.allDay ? 0 : 900000, dur()); f.start = d; f.end = new Date(+d + keep); paintTimes(); }
    function at(dateStr, timeStr, fallback) {
      var d = parseYmd(dateStr);
      if (!d) return fallback;
      var m = /^(\d{1,2}):(\d{2})/.exec(timeStr || '');
      if (m) d.setHours(+m[1], +m[2], 0, 0); else d.setHours(fallback.getHours(), fallback.getMinutes(), 0, 0);
      return d;
    }
    q('title').addEventListener('input', function () { save.disabled = !q('title').value.trim(); err.removeAttribute('data-on'); });
    q('sd').addEventListener('change', function () { setStart(at(q('sd').value, q('st').value, f.start)); });
    q('st').addEventListener('change', function () { setStart(at(q('sd').value, q('st').value, f.start)); });
    q('ed').addEventListener('change', function () { f.end = at(q('ed').value, q('et').value, f.end); paintTimes(); });
    q('et').addEventListener('change', function () { f.end = at(q('ed').value, q('et').value, f.end); paintTimes(); });
    q('cal').addEventListener('change', function () { f.cal = q('cal').value; paintTimes(); });
    s.box.onclick = function (e) {
      var b = e.target.closest && e.target.closest('[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'cancel') closeSheet();
      else if (a === 'allday') {
        f.allDay = !f.allDay;
        if (f.allDay) { f.start = day0(f.start); f.end = day0(f.end < f.start ? f.start : f.end); }
        else {
          var s0 = new Date(f.start); s0.setHours(9, 0, 0, 0);
          f.start = s0; f.end = new Date(+s0 + 3600000);
        }
        paintTimes();
      } else if (a === 'quick') {
        var p = b.getAttribute('data-t').split(':'), d = new Date(f.start);
        d.setHours(+p[0], +p[1], 0, 0);
        setStart(d);
      } else if (a === 'del') {
        askDelete(client, ev, function () { closeSheet(); });
      } else if (a === 'save') {
        f.title = q('title').value.trim();
        f.loc = q('loc').value.trim();
        f.desc = q('desc').value.trim();
        f.rrule = q('rrule').value;
        if (!f.title) return;
        if (f.allDay ? day0(f.end) < day0(f.start) : f.end <= f.start) {
          err.textContent = 'It has to end after it starts.';
          err.setAttribute('data-on', '');
          return;
        }
        var finish = function () { closeSheet(); };
        var fail = function (x) { save.disabled = false; err.textContent = 'Couldn’t save: ' + x.message; err.setAttribute('data-on', ''); };
        save.disabled = true;
        if (isNew) { create(client, f.cal, f).then(finish, fail); return; }
        // an occurrence of a repeating event: this one, or this and the
        // ones after it (a change to the repeat itself is always the latter)
        if (ev.rid) {
          if (f.rrule !== origRule) { update(client, ev, f, 'THISANDFUTURE').then(finish, fail); return; }
          C.chooseSheet('Change “' + f.title + '”', [{ name: 'This Event Only', scope: '' },
            { name: 'This and Future Events', scope: 'THISANDFUTURE' }], function (o) {
            if (!o.scope) f.rrule = '';
            update(client, ev, f, o.scope).then(finish, fail);
          });
          save.disabled = false;
          return;
        }
        update(client, ev, f, '').then(finish, fail);
      }
    };
    setTimeout(function () { try { if (isNew) q('title').focus(); } catch (e) { /* ignore */ } }, 60);
  }
  // a new event at `start` (a day: the next hour today, else 9 AM)
  function newAt(client, start, allDay, cal) {
    var s0 = new Date(start);
    if (!allDay && s0.getHours() === 0 && s0.getMinutes() === 0) {
      var now = new Date();
      if (sameDay(s0, now)) { s0 = new Date(now); s0.setHours(now.getHours() + 1, 0, 0, 0); }
      else s0.setHours(9, 0, 0, 0);
    }
    edit_(client, null, { cal: cal, start: s0, end: allDay ? day0(s0) : new Date(+s0 + 3600000), allDay: !!allDay });
  }

  // ------------------------------------------------------------ the page
  // THE RIGHT-HAND COLUMN'S WIDTH: the month's day panel, the day view's
  // column, and the view switch's place above them
  var RCOL = 380;
  // the view switch's slide: a touch past and back, as a UIKit spring (the tab bar's)
  var SPRING = 'cubic-bezier(.34,1.24,.42,1)';
  // where a view button sits in its switch (left and width)
  // THE VIEW SWITCH IS HK'S SEGMENTED CONTROL (hk-base.js segCss, segBox,
  // slideSeg), the same as the Energy tabs'
  function segBox(b) { return window.hkCards.segBox(b); }
  function slideSeg(b, from) { return window.hkCards.slideSeg(b, from); }
  // a panel's plate (hkCards.plate): the tall shadow, as every page card
  var GLASS = function () { return window.hkCards.plate('panel'); };
  var PAGE_CSS = function () {
    return [
      ':host{display:block;color:' + window.hkCards.v('ink') + ';-webkit-tap-highlight-color:transparent}',
      // the bar's and the rest's holders (_render): no box of their own
      '.hold{display:contents}',
      'button{appearance:none;font:inherit;color:' + window.hkCards.v('ink') + ';cursor:pointer;margin:0}',
      // (its controls level with Energy's tabs, one page edge from the top:
      // the 54 px row centers its 44 px controls 5 px in -- DESIGN.md "Page edges")
      '.bar{display:flex;align-items:center;gap:14px;min-height:52px;margin:-4px 0 16px;flex-wrap:wrap}',
      '.ttl{font-size:34px;font-weight:700;letter-spacing:-0.6px;white-space:nowrap}',
      '.ttl span{font-weight:300;opacity:0.8}',
      '.arrows{display:flex;gap:8px}',
      // THE CONTROLS ARE GLASS LIKE THE PANELS (M.glass, not only its color):
      // the marker that cuts them out of the shared blur, so they follow the
      // screen's Glass setting as the calendar under them does
      '.rb{width:44px;height:44px;border-radius:22px;border:' + M.border + ';' + M.glass + ';display:flex;align-items:center;justify-content:center;padding:0}',
      '.pb{height:44px;padding:0 18px;border-radius:22px;border:' + M.border + ';' + M.glass + ';font-size:15px;font-weight:600}',
      '.sp{flex:1}',
      // the view switch and New Event over the right-hand column, the switch
      // starting where that column does (RCOL, the day panel and the day
      // view's column alike)
      '.rgt{width:' + RCOL + 'px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px}',
      // HK's segmented control (the choice slides to the new view), its
      // choices a fixed 74 px here
      C.segCss('.seg', { raised: true }),
      '.seg button{width:74px;padding:0}',
      '.new{height:44px;padding:0 18px 0 14px;border-radius:22px;border:0;background:#fff;color:#1c1c1e;font-size:15px;font-weight:600;display:flex;align-items:center;gap:6px;white-space:nowrap;flex:none}',
      '.panel{' + GLASS() + ';position:relative;overflow:hidden}',
      '.body{display:flex;gap:20px;align-items:stretch}',
      '.wide .body{height:var(--cal-h,620px)}',
      '.ell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.warn{margin:0 0 12px;font-size:14px;font-weight:600;color:var(--hk-warn,#ffd60a)}',
      '.empty{padding:18px 0;font-size:15px;color:' + window.hkCards.v('ink-2') + '}',
      // ---- month
      '.mgrid{flex:1;min-width:0;padding:10px 12px 12px;display:flex;flex-direction:column}',
      '.dows{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));height:30px;align-items:center;flex:none}',
      '.dows div{padding-left:8px;font-size:11px;font-weight:600;letter-spacing:0.4px;color:' + window.hkCards.v('ink-2') + '}',
      '.weeks{flex:1;display:flex;flex-direction:column;min-height:0}',
      '.wk{position:relative;flex:1;min-height:0;border-top:1px solid ' + window.hkCards.v('line') + ';display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}',
      '.cell{position:relative;min-width:0;overflow:hidden;border:0;background:transparent;text-align:left;padding:0;display:block}',
      '.cell + .cell{border-left:1px solid ' + window.hkCards.v('line') + '}',
      '.cell.out{opacity:0.45}',
      '.cell.sel{background:' + window.hkCards.v('key') + '}',
      '.num{position:absolute;left:9px;top:8px;font-size:15px;font-weight:600;line-height:20px}',
      '.cell.today .num{left:5px;top:5px;width:26px;height:26px;line-height:26px;border-radius:13px;background:#fff;color:#1c1c1e;font-weight:700;text-align:center}',
      '.chips{position:absolute;left:9px;right:6px;display:flex;flex-direction:column;gap:2px}',
      '.chip{height:17px;line-height:17px;font-size:12px;font-weight:500;display:flex;align-items:center;gap:5px;min-width:0}',
      '.chip i{flex:none;width:7px;height:7px;border-radius:4px}',
      '.chip b{font-weight:700}',
      '.more{height:17px;line-height:17px;font-size:12px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
      '.bar1{position:absolute;height:18px;line-height:18px;border-radius:8px;font-size:11px;font-weight:700;padding:0 6px;box-sizing:border-box;',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:0;text-align:left;color:' + window.hkCards.v('ink') + '}',
      '.dots{position:absolute;left:0;right:0;bottom:6px;display:flex;justify-content:center;gap:3px}',
      '.dots i{width:6px;height:6px;border-radius:3px}',
      // ---- the day's list (month) and the agenda rows
      '.side{width:' + RCOL + 'px;flex:none;padding:' + window.hkCards.CARD.pad + ';display:flex;flex-direction:column}',
      '.dname{font-size:28px;font-weight:700;letter-spacing:-0.4px}',
      '.dsub{font-size:15px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';margin-top:2px}',
      // (its 10 px under the day's name as padding: the list scrolls right up
      // under the name, in a frame with the sheet's shadows -- BASE_CSS .hk-edge)
      '.list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding-top:10px}',
      '.ad{width:100%;height:30px;margin-top:6px;border-radius:8px;border:0;display:flex;align-items:center;padding:0 12px;gap:8px;font-size:14px;font-weight:600;text-align:left;color:' + window.hkCards.v('ink') + '}',
      '.ad i{flex:none;width:8px;height:8px;border-radius:4px}',
      '.ad em{margin-left:auto;font-style:normal;font-weight:500;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
      '.ev{width:100%;display:flex;align-items:flex-start;padding:12px 0;border:0;border-bottom:1px solid ' + window.hkCards.v('line') + ';background:transparent;text-align:left;gap:0}',
      '.ev:last-child{border-bottom:0}',
      '.ev.past{opacity:0.5}',
      '.ev .tm{width:76px;flex:none;font-size:14px;font-weight:600;padding-top:2px}',
      '.ev i{flex:none;width:9px;height:9px;border-radius:5px;margin:7px 10px 0 0}',
      '.ev .tx{min-width:0;flex:1}',
      '.ev .t1{font-size:17px;font-weight:600}',
      '.ev .t2{font-size:14px;color:' + window.hkCards.v('ink-2') + ';margin-top:2px}',
      '.soon{flex:none;height:24px;padding:0 10px;border-radius:12px;background:#fff;color:#1c1c1e;font-size:12px;font-weight:700;display:flex;align-items:center;margin-left:8px}',
      '.addday{height:44px;border-radius:22px;border:1px dashed ' + window.hkCards.v('mark') + ';background:transparent;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;flex:none}',
      // ---- week and day: the time grid
      '.tg{flex:1;min-width:0;padding:8px 12px 12px;display:flex;flex-direction:column}',
      '.cols{display:grid;flex:none}',
      '.dh{display:flex;align-items:center;justify-content:center;gap:7px;height:46px;border:0;background:transparent;padding:0}',
      '.dh span{font-size:13px;font-weight:600;letter-spacing:0.6px;color:' + window.hkCards.v('ink-2') + '}',
      '.dh b{font-size:17px;font-weight:600}',
      '.dh.today b{width:28px;height:28px;line-height:28px;border-radius:14px;background:#fff;color:#1c1c1e;font-weight:700;text-align:center;font-size:15px}',
      '.alld{position:relative;border-top:1px solid ' + window.hkCards.v('line') + ';flex:none}',
      '.alld .lab{position:absolute;left:0;top:50%;transform:translateY(-50%);width:50px;text-align:right;font-size:11px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
      '.tl{position:relative;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;border-top:1px solid ' + window.hkCards.v('line') + '}',
      '.hrs{position:relative}',
      '.hr{position:absolute;left:56px;right:0;height:0;border-top:1px solid ' + window.hkCards.v('line') + '}',
      '.hr span{position:absolute;left:-56px;top:-8px;width:50px;text-align:right;font-size:11px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
      '.days{position:absolute;top:0;bottom:0;right:0;display:grid}',
      '.dcol{position:relative;border-left:1px solid ' + window.hkCards.v('line') + '}',
      '.dcol.today{background:' + window.hkCards.v('key') + '}',
      '.slot{position:absolute;left:0;right:0;border:0;background:transparent;padding:0}',
      '.blk{position:absolute;box-sizing:border-box;overflow:hidden;border-radius:8px;padding:4px 8px 4px 10px;border:0;text-align:left;color:' + window.hkCards.v('ink') + ';line-height:1.25}',
      '.blk .t1{font-size:13px;font-weight:700}',
      '.blk .t2{font-size:12px;font-weight:500;color:rgba(255,255,255,0.8);margin-top:1px}',
      '.blk.past{opacity:0.85}',
      '.blk{box-shadow:inset 3px 0 0 var(--e,transparent)}',
      '.blk.sel{box-shadow:inset 3px 0 0 var(--e,transparent),0 0 0 2px ' + window.hkCards.v('ink') + '}',
      '.dayv .blk{border-radius:8px;padding:4px 12px;line-height:1.25}',
      '.dayv .blk .t1{font-size:15px}',
      '.dayv .blk .t2{font-size:13px;margin-top:2px}',
      '.now{position:absolute;height:2px;background:#ff453a;pointer-events:none}',
      '.now::before{content:"";position:absolute;left:-5px;top:-4px;width:10px;height:10px;border-radius:5px;background:#ff453a}',
      '.nowl{position:absolute;left:0;width:50px;text-align:right;font-size:11px;font-weight:700;color:#ff6961;pointer-events:none}',
      // ---- the day's right column: the month, the event
      '.rcol{width:' + RCOL + 'px;flex:none;display:flex;flex-direction:column;gap:16px;min-height:0}',
      '.mini{padding:16px 18px 14px;flex:none}',
      '.mini .mh{display:flex;align-items:center}',
      '.mini .mh b{font-size:17px;font-weight:700;flex:1}',
      '.mini .mh button{width:36px;height:36px;border:0;background:transparent;padding:0;display:flex;align-items:center;justify-content:center}',
      '.mgr{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));margin-top:6px;row-gap:2px}',
      '.mgr .w{text-align:center;font-size:11px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';height:22px;line-height:22px}',
      '.md{height:38px;border:0;background:transparent;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}',
      '.md b{height:26px;min-width:26px;line-height:26px;font-size:14px;font-weight:600;border-radius:13px;text-align:center}',
      '.md.out b{opacity:0.4}',
      '.md.today b{background:#fff;color:#1c1c1e;font-weight:700}',
      '.md.sel:not(.today) b{background:' + window.hkCards.v('key-strong') + '}',
      '.md i{width:5px;height:5px;border-radius:3px}',
      '.det{padding:18px 20px;flex:none}',
      '.det .c{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
      '.det .c i{width:10px;height:10px;border-radius:5px}',
      '.det h3{font-size:22px;font-weight:700;margin:8px 0 0;letter-spacing:-0.35px;overflow-wrap:anywhere}',
      '.det .ln{display:flex;align-items:flex-start;gap:10px;margin-top:9px;font-size:15px}',
      '.det .ln svg{flex:none;margin-top:2px}',
      '.det .ln span{min-width:0;overflow-wrap:anywhere}',
      '.det .note{color:' + window.hkCards.v('ink-2') + ';white-space:pre-wrap;max-height:84px;overflow:hidden}',
      '.det .acts{display:flex;gap:10px;margin-top:16px}',
      '.det .acts button{flex:1;height:44px;border-radius:22px;font-size:15px;font-weight:600}',
      '.det .ed{border:' + M.border + ';background:' + window.hkCards.v('key') + '}',
      '.det .rm{border:1px solid rgba(255,105,97,0.45);background:rgba(255,69,58,0.18);color:#ffb3ae}',
      '.det .none{font-size:15px;color:' + window.hkCards.v('ink-2') + '}',
      // ---- narrow (a phone): stacked
      '.narrow .ttl{font-size:26px}',
      '.narrow .bar{gap:10px}',
      '.narrow .sp{display:none}',
      '.narrow .arrows{margin-left:auto}',
      '.narrow .pb{order:4}',
      '.narrow .rgt{display:contents}',
      '.narrow .seg{order:5;flex:1}',
      '.narrow .seg button{flex:1;width:auto}',
      '.narrow .new{order:6}',
      '.narrow .body{flex-direction:column;gap:14px}',
      '.narrow .mgrid{padding:8px}',
      '.narrow .wk{height:56px;flex:none}',
      '.narrow .num{left:0;right:0;text-align:center}',
      '.narrow .cell.today .num{left:50%;margin-left:-13px}',
      '.narrow .side{width:auto;padding:18px}',
      '.narrow .list{overflow:visible}',
      '.narrow .tg{height:min(620px,calc(var(--hk-vh,100vh) - 220px));flex:none}',
      '.narrow .rcol{width:auto}',
      '.narrow .wl{padding:4px 18px 10px}',
      '.fit .body{height:var(--cal-h,620px)}',
      // (the week's list scrolls in a frame: the sheet's shadows, BASE_CSS .hk-edge)
      '.fit .wlp{flex:1;min-height:0;display:flex;flex-direction:column}',
      '.fit .wl{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}',
      '.wl .dayh{font-size:13px;font-weight:700;letter-spacing:1.2px;color:' + window.hkCards.v('ink-2') + ';margin-top:16px}',
      '.wl .dayh.today{color:' + window.hkCards.v('ink') + '}'
    ].join('\n');
  };

  class HkCalendarCard extends HkBase {
    static get CSS() { return PAGE_CSS() + FLAT_EVENT_CSS; }
    constructor() {
      super();
      this._view = 'month';
      this._day = day0(new Date());     // the day chosen (and what the view shows)
      this._sel = null;                  // the event chosen (day view)
      this._evs = [];
      this._failed = [];
      this._have = '';                   // the range (and store version) the events are for
      this._n = 0;                       // answers in
      this._w = 0;
      var self = this;
      this._onChanged = function () { self._have = ''; self._fetch(); };
      this._onResize = function () { self._measure(); };
      // on its own shadow root: they live and go with the card
      this._root.addEventListener('click', function (e) { self._click(e); });
      this._root.addEventListener('pointerdown', function (e) { self._swipeStart(e); });
      this._root.addEventListener('pointerup', function (e) { self._swipeEnd(e); });
    }
    setConfig(config) {
      var c = Object.assign({}, config || {});
      if (c.view === 'week' || c.view === 'day') this._view = c.view;
      super.setConfig(c);
    }
    getCardSize() { return 12; }
    // OPENED AT A DAY: ?day=2026-10-12 on the page's address (a calendar
    // notification's Go To). Read when the page shows, each new day once.
    _dayFromUrl() {
      var m = /[?&]day=(\d{4}-\d{2}-\d{2})/.exec(location.search || ''), d = m ? parseYmd(m[1]) : null;
      if (!d || m[1] === this._urlDay) return;
      this._urlDay = m[1];
      this._view = 'day';
      this._day = day0(d);
      this._sel = null;
      this._have = '';
      if (this.client) { this._fetch(); this.redraw(); }
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      this._dayFromUrl();
      if (!this._onLoc) { this._onLoc = function () { self._dayFromUrl(); }; }
      window.hkShell.onNavigate(this._onLoc);
      window.addEventListener('hk-calendar-changed', this._onChanged);
      window.addEventListener('resize', this._onResize);
      // (a docked bar or the Now Playing pane coming or going changes the room)
      window.addEventListener('hk-dock', this._onResize);
      window.addEventListener('hk-pane', this._onResize);
      if (typeof ResizeObserver === 'function' && !this._ro) {
        this._ro = new ResizeObserver(function (en) {
          var w = en && en[0] && en[0].contentRect ? en[0].contentRect.width : self.clientWidth;
          if (Math.abs(w - self._w) < 2) return;
          self._w = w;
          self._measure();
          self.redraw();
        });
        this._ro.observe(this);
      }
      // every five minutes the events again (a calendar changed elsewhere)
      this._tick = setInterval(function () { self._have = ''; self._fetch(); }, 300000);
      // DRAWN BEFORE IT WAS PLACED, the page guessed its width (wide) and
      // its height (the 620 px default), and a cold load could show that
      // frame before the ResizeObserver and the measure below put it right
      // (2026-10-20, Safari on Mantel: the panels drew short, then grew).
      // So the width is taken now, the page drawn again for it, and the
      // panels measured, before the first frame -- and again once they are
      // drawn: measured from the body itself.
      var w0 = this.clientWidth || 0;
      if (w0 && Math.abs(w0 - this._w) >= 2) { this._w = w0; if (this.client && this._config) this.redraw(); }
      this._measure();
      this._m0 = setTimeout(function () { self._m0 = null; self._measure(); setTimeout(function () { if (self.isConnected) self._measure(); }, 400); }, 0);
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      window.removeEventListener('hk-calendar-changed', this._onChanged);
      window.hkShell.offNavigate(this._onLoc);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('hk-dock', this._onResize);
      window.removeEventListener('hk-pane', this._onResize);
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      if (this._tick) { clearInterval(this._tick); this._tick = null; }
      if (this._m0) { clearTimeout(this._m0); this._m0 = null; }
      this._hkSig = null;
    }
    _wide() { return (this._w || this.clientWidth || 1200) >= 900; }
    // THE PAGE'S HEIGHT, on a wide screen: the panels reach the bottom of
    // the window, whatever is above them
    // MEASURED, NOT GUESSED (2026-10-15): it took a 74 px Home Assistant
    // toolbar that a kiosk screen doesn't have and none of the tab bar's
    // room, and the page ran ~190 px past the window -- the page scrolled,
    // not the week. The panels end where what follows them begins: the
    // view's room for a tab bar or a docked bar, the cards' margins (the
    // view's own end, hui-view, and its bottom padding), so the page fits
    // the window exactly and the week's hours scroll in their own panel.
    _measure() {
      if (!this.isConnected || !this.getBoundingClientRect) return;
      var H = window.innerHeight || 800, se = document.scrollingElement, sy = se ? se.scrollTop : (window.scrollY || 0);
      var body = this._root && this._root.querySelector('.wide .body, .fit .body');
      if (!body) {
        var r = this.getBoundingClientRect(), h0 = Math.max(460, Math.round(H - (r.top + sy) - 24));
        if (h0 !== this._h) { this._h = h0; this.style.setProperty('--cal-h', h0 + 'px'); }
        return;
      }
      // (to the end of the VIEW'S CONTENT -- the layout inside hui-view --
      // not hui-view's own: that one is stretched to the window, so measuring
      // to it only ever confirmed the height the panels already had, and a
      // desk opened at the 620 px default stayed there until a resize; 2026-10-16)
      var hv = null, inner = null, n = this, prev = null;
      for (var i = 0; i < 40 && n; i++) {
        if (window.hkShell.is(n, 'view')) { hv = n; inner = prev; break; }
        if (n.nodeType === 1) prev = n;
        n = n.parentNode || n.host;
      }
      var br = body.getBoundingClientRect(), after = 24;
      // THE PAGE'S EDGE BELOW (2026-10-17, DESIGN.md "Page edges"): the
      // panels end one page gutter above the window -- the gutter the view
      // keeps under every page (hk-layout.js gutter), so the view has nothing
      // to correct and the panels never move after they are drawn -- plus
      // whatever room is kept below the page (a tab bar's)
      var G = window.hkLayout && window.hkLayout.gutter ? window.hkLayout.gutter(this) : null;
      if (hv) {
        var vc = hv.parentNode && hv.parentNode.nodeType === 1 ? hv.parentNode : null;
        var pad = vc ? parseFloat(getComputedStyle(vc).paddingBottom) || 0 : 0;
        if (G != null) {
          after = G + pad + (parseFloat(getComputedStyle(hv).paddingBottom) || 0) +
            (inner ? parseFloat(getComputedStyle(inner).paddingBottom) || 0 : 0) + (parseFloat(hv.style.marginBottom) || 0);
        } else {
          var end = (inner || hv).getBoundingClientRect().bottom + (inner ? parseFloat(getComputedStyle(hv).paddingBottom) || 0 : 0);
          after = Math.max(0, end - br.bottom) + pad + (parseFloat(hv.style.marginBottom) || 0);
        }
      }
      var h = Math.max(460, Math.floor(H - (br.top + sy) - after));
      if (h !== this._h) { this._h = h; this.style.setProperty('--cal-h', h + 'px'); }
    }
    // THE DAYS SHOWN: the month's weeks, the week, or the day
    _range() {
      var d = this._day;
      if (this._view === 'month') {
        var first = new Date(d.getFullYear(), d.getMonth(), 1), from = weekStart(first);
        var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        var weeks = Math.ceil((Math.round((day0(last) - from) / DAY_MS) + 1) / 7);
        return { from: from, to: addDays(from, weeks * 7), weeks: weeks };
      }
      if (this._view === 'week') { var w = weekStart(d); return { from: w, to: addDays(w, 7) }; }
      // the day, and its month (the little month's dots)
      var m0 = weekStart(new Date(d.getFullYear(), d.getMonth(), 1));
      return { from: m0, to: addDays(m0, 42) };
    }
    _fetch() {
      var h = this.client;
      if (!h) return;
      var r = this._range(), ids = calIds(h);
      var want = ids.join(',') + '|' + (+r.from) + '|' + (+r.to) + '|' + store.ver;
      if (want === this._have) return;
      this._have = want;
      var self = this;
      load(h, ids, r.from, r.to).then(function (got) {
        if (self._have !== want) return;
        self._evs = got.evs;
        self._failed = got.failed;
        self._n++;
        self.redraw();
      });
    }
    _sigOf() {
      var h = this.client;
      if (!h || !this._config) return null;
      var ids = calIds(h), HS = window.hkSettings;
      var out = ids.map(function (id) { var s = h.states[id]; return id + '=' + (s ? s.last_updated : 'x'); }).join(';');
      var cols = ids.map(function (id) { return HS && HS.calendarColor ? HS.calendarColor(id, h.states) : ''; }).join(',') + colorSig();
      return out + '|' + cols + '|' + this._n + '|' + this._view + '|' + (+this._day) + '|' + (this._sel || '') +
        '|' + (this._wide() ? 'W' : 'N') + '|' + Math.floor(Date.now() / 60000);
    }
    _go(view, day) {
      if (view) this._view = view;
      if (day) this._day = day0(day);
      this._sel = null;
      this._fetch();
      this.redraw();
    }
    _step(n) {
      var d = this._day;
      if (this._view === 'month') this._go(null, addMonths(new Date(d.getFullYear(), d.getMonth(), 1), n));
      else this._go(null, addDays(d, this._view === 'week' ? 7 * n : n));
    }
    _swipeStart(e) {
      if (e.pointerType === 'mouse') return;
      this._sx = e.clientX; this._sy = e.clientY; this._st = Date.now();
    }
    // A SWIPE across the month or the week turns it (a sideways flick, not
    // a scroll of the hours)
    _swipeEnd(e) {
      if (this._sx == null || e.pointerType === 'mouse') return;
      var dx = e.clientX - this._sx, dy = e.clientY - this._sy, dt = Date.now() - this._st;
      this._sx = null;
      if (dt < 700 && Math.abs(dx) > 70 && Math.abs(dy) < 50) { this._swiped = Date.now(); this._step(dx < 0 ? 1 : -1); }
    }
    _find(key) { return this._evs.filter(function (e) { return e.key === key; })[0] || null; }
    _click(e) {
      if (this._swiped && Date.now() - this._swiped < 400) return;
      var b = e.composedPath ? e.composedPath().filter(function (n) { return n.getAttribute && n.getAttribute('data-a'); })[0]
                              : (e.target.closest && e.target.closest('[data-a]'));
      if (!b) return;
      var a = b.getAttribute('data-a'), v = b.getAttribute('data-v'), h = this.client;
      if (a === 'prev') this._step(-1);
      else if (a === 'next') this._step(1);
      else if (a === 'today') this._go(null, new Date());
      else if (a === 'view') this._go(v, this._day);
      else if (a === 'new') newAt(h, this._view === 'month' || this._view === 'day' ? this._day : new Date(), false);
      else if (a === 'addday') newAt(h, this._day, false);
      else if (a === 'day') {
        var d = parseYmd(v);
        // a second tap on the chosen day opens it
        if (this._view === 'month' && sameDay(d, this._day)) this._go('day', d);
        else if (this._view === 'month') { this._day = d; if (d.getMonth() !== this._shownMonth) this._fetch(); this.redraw(); }
        else this._go('day', d);
      } else if (a === 'mini') { this._go(null, parseYmd(v)); }
      else if (a === 'minip' || a === 'minin') this._go(null, addMonths(this._day, a === 'minip' ? -1 : 1));
      else if (a === 'slot') {
        if (!writable(h).length) return;
        var p = v.split('T'), sd = parseYmd(p[0]);
        sd.setHours(+p[1], 0, 0, 0);
        newAt(h, sd, false);
      } else if (a === 'ev') {
        var ev = this._find(v);
        if (!ev) return;
        // ONE GESTURE, ONE MEANING (2026-10-16, the user): a tap on an event
        // opens its sheet in every view. The wide day view also marks it in
        // its side list, so the list is on it when the sheet closes.
        if (this._view === 'day' && this._wide()) { this._sel = v; this.redraw(); }
        show(h, ev);
      } else if (a === 'edit') { var e1 = this._find(this._sel); if (e1) edit_(h, e1); }
      else if (a === 'del') { var e2 = this._find(this._sel), self = this; if (e2) askDelete(h, e2, function () { self._sel = null; }); }
    }
    _render() {
      var h = this.client;
      if (!h || !this._config) return;
      setWeekStart(h);
      this._fetch();
      var wide = this._wide();
      // KEEP WHERE THE HOURS WERE SCROLLED (the page is redrawn whole)
      var tl = this._root.querySelector && this._root.querySelector('.tl');
      var keep = tl && tl.getAttribute && tl.getAttribute('data-k') === this._view + (+this._day) ? tl.scrollTop : null;
      var list = this._root.querySelector && this._root.querySelector('.list'), keepL = list ? list.scrollTop : 0;
      var bar = this._bar(h, wide), html = '';
      if (!calIds(h).length) html += '<div class="panel" style="padding:22px"><div class="empty">No calendars. Add one to Home Assistant (Settings → Devices &amp; Services → Add Integration → Local Calendar) and it shows here.</div></div>';
      else {
        if (this._failed.length) html += '<div class="warn">' + esc(failedLine(h, this._failed)) + '</div>';
        html += this._view === 'week' ? this._week(h, wide) : this._view === 'day' ? this._dayView(h, wide) : this._month(h, wide);
      }
      // THE BAR IS WRITTEN ONLY WHEN IT CHANGES (2026-10-10). The page is
      // drawn again when its events arrive -- at once when they were fetched
      // before -- and a bar written again then cut the view switch's slide
      // short: the new button, mid-way, jumped home. So the bar and the rest
      // have holders of their own (display:contents: the layout as before),
      // and the bar's is left alone while its markup is the same.
      // NARROW ON A TABLET (beside the Now Playing pane, an iPad), THE WEEK
      // fits the window too ('fit'): its list scrolls in its panel, under a
      // page that stays put -- a phone's page scrolls as a phone's does
      var fit = !wide && this._view === 'week' && (window.innerWidth || 0) >= 640 && (window.innerHeight || 0) >= 500;
      var cls = (wide ? 'wide' : 'narrow') + (fit ? ' fit' : ''), wrap = this._wrap, fresh = false;
      if (!wrap || wrap.parentNode !== this._root || wrap.className !== cls) {
        fresh = true;
        // (a new layout: its panels measured again once drawn)
        var selfM = this;
        requestAnimationFrame(function () { if (selfM.isConnected) selfM._measure(); });
        this._root.innerHTML = '<div class="' + cls + '"><div class="hold"></div><div class="hold"></div></div>';
        wrap = this._wrap = this._root.children && this._root.children[0];
        if (wrap && wrap.children && wrap.children.length === 2) wrap.__bar = null;
        else wrap = this._wrap = null;
      }
      if (!wrap) {
        // markup that is not parsed (the test shim): the page whole, as before
        this._root.innerHTML = '<div class="' + cls + '">' + bar + html + '</div>';
      } else if (wrap.__bar !== bar) {
        // where the view switch's choice was, for its slide to the new one
        var was = wrap.children[0].querySelector && wrap.children[0].querySelector('.seg button[aria-selected="true"]');
        var segFrom = was ? segBox(was) : null;
        wrap.children[0].innerHTML = bar;
        wrap.__bar = bar;
        var nowSeg = segFrom && wrap.children[0].querySelector('.seg button[aria-selected="true"]');
        if (nowSeg) slideSeg(nowSeg, segFrom);
      }
      if (wrap) wrap.children[1].innerHTML = html;
      // MEASURED BEFORE THE FIRST PAINT (2026-10-20, Safari on Mantel): a
      // new layout's panels were measured a frame later, so on some loads
      // their first frame was the 620 px default and then they grew.
      // THE WARNING LINE COMES LATE: it sits above the panels and arrives
      // with the events' answer, often after the panels were measured --
      // they were pushed down by its height and ran past the window's
      // gutter, on some loads and not others. Measured again in the same
      // frame it comes or goes, so the panels' bottom edge stays put.
      var warned = this._failed.length > 0;
      if (fresh || warned !== !!this._warned) { this._warned = warned; this._measure(); }
      var tl2 = this._root.querySelector && this._root.querySelector('.tl');
      if (tl2 && tl2.setAttribute) {
        tl2.setAttribute('data-k', this._view + (+this._day));
        if (keep != null) tl2.scrollTop = keep;
        else tl2.scrollTop = Math.max(0, this._scrollTo * this._px - 12);
      }
      var l2 = this._root.querySelector && this._root.querySelector('.list');
      if (l2 && keepL) l2.scrollTop = keepL;
      // THE LISTS' EDGES: the sheet's shadows, top once scrolled, foot while
      // more lies below (hk-base.js edges; all drawn anew each time)
      if (C.edges) C.edges(this._root);
    }
    _bar(h, wide) {
      var d = this._day, v = this._view, ttl;
      if (v === 'month') ttl = MON[d.getMonth()] + ' <span>' + d.getFullYear() + '</span>';
      else if (v === 'week') {
        var a = weekStart(d), b = addDays(a, 6);
        ttl = (wide ? MON3[a.getMonth()] + ' ' + a.getDate() + ' – ' + (a.getMonth() === b.getMonth() ? '' : MON3[b.getMonth()] + ' ') + b.getDate()
                    : MON3[a.getMonth()] + ' ' + a.getDate() + ' – ' + b.getDate()) + ' <span>' + b.getFullYear() + '</span>';
      } else ttl = (wide ? DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] : DOW_LONG[d.getDay()].slice(0, 3) + ', ' + MON3[d.getMonth()]) +
                   ' ' + d.getDate() + ' <span>' + d.getFullYear() + '</span>';
      var prevL = v === 'month' ? 'Previous month' : v === 'week' ? 'Previous week' : 'Previous day';
      var nextL = v === 'month' ? 'Next month' : v === 'week' ? 'Next week' : 'Next day';
      var seg = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(function (o) {
        return '<button role="tab" data-a="view" data-v="' + o[0] + '" aria-selected="' + (o[0] === v) + '">' + o[1] + '</button>';
      }).join('');
      var isToday = v === 'month' ? (d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear())
                  : v === 'week' ? sameDay(weekStart(d), weekStart(new Date())) : sameDay(d, new Date());
      return '<div class="bar"><div class="ttl">' + ttl + '</div>' +
        '<div class="arrows"><button class="rb" data-a="prev" aria-label="' + prevL + '">' + IC.left + '</button>' +
        '<button class="rb" data-a="next" aria-label="' + nextL + '">' + IC.right + '</button></div>' +
        '<button class="pb" data-a="today"' + (isToday ? ' aria-current="date"' : '') + '>Today</button>' +
        '<div class="sp"></div><div class="rgt"><div class="seg" role="tablist" aria-label="View">' + seg + '</div>' +
        (writable(h).length ? '<button class="new" data-a="new" aria-label="New Event">' + IC.plus + (wide ? 'New Event' : '') + '</button>' : '') +
        '</div></div>';
    }
    // ---- the month
    _month(h, wide) {
      var r = this._range(), evs = this._evs, today = new Date(), d = this._day;
      this._shownMonth = d.getMonth();
      var rowH = wide ? (this._h || 620) - 20 - 30 : 56;
      rowH = wide ? rowH / r.weeks : 56;
      var weeks = '';
      for (var w = 0; w < r.weeks; w++) {
        var from = addDays(r.from, w * 7), bs = bars(evs, from, 7), shownLanes = wide ? Math.min(bs.lanes, 2) : 0;
        var cells = '';
        for (var c = 0; c < 7; c++) {
          var day = addDays(from, c), cls = 'cell' + (day.getMonth() !== d.getMonth() ? ' out' : '') +
            (sameDay(day, today) ? ' today' : '') + (sameDay(day, d) ? ' sel' : '');
          var mine = onDay(evs, day);
          var inner = '<span class="num">' + day.getDate() + '</span>';
          if (wide) {
            // the day's own (not an all-day bar shown above it)
            var barred = bs.list.filter(function (b) { return b.lane < shownLanes && c >= b.a && c <= b.b; }).map(function (b) { return b.ev; });
            var own = mine.filter(function (e) { return barred.indexOf(e) < 0; });
            var top = 31 + shownLanes * 20 + 2, room = Math.max(0, Math.floor((rowH - top - 2) / 19));
            var showN = own.length > room ? Math.max(0, room - 1) : own.length;
            inner += '<span class="chips" style="top:' + top + 'px">' + own.slice(0, showN).map(function (e) {
              var rgb = evRgb(e, h);
              return '<span class="chip"><i style="background:' + rgba(rgb, 1) + '"></i><span class="ell">' +
                (e.allDay ? '' : '<b>' + tshort(e.start < day0(day) ? day0(day) : e.start) + '</b> ') + esc(e.title) + '</span></span>';
            }).join('') + (own.length > showN ? '<span class="more">+' + (own.length - showN) + ' more</span>' : '') + '</span>';
          } else if (ownDay(evs, day).length) {
            var cs = [];
            ownDay(evs, day).forEach(function (e) { var k = rgba(evRgb(e, h), 1); if (cs.indexOf(k) < 0) cs.push(k); });
            inner += '<span class="dots">' + cs.slice(0, 3).map(function (k) { return '<i style="background:' + k + '"></i>'; }).join('') + '</span>';
          }
          cells += '<button class="' + cls + '" data-a="day" data-v="' + ymd(day) + '" aria-label="' + DOW_LONG[day.getDay()] + ', ' +
            MON[day.getMonth()] + ' ' + day.getDate() + (mine.length ? ', ' + mine.length + (mine.length === 1 ? ' event' : ' events') : '') + '">' + inner + '</button>';
        }
        var barsHtml = bs.list.filter(function (b) { return b.lane < shownLanes; }).map(function (b) {
          var rgb = evRgb(b.ev, h);
          return '<button class="bar1" data-a="ev" data-v="' + esc(b.ev.key) + '" style="top:' + (31 + b.lane * 20) + 'px;left:calc(' + b.a +
            ' * 100% / 7 + 3px);width:calc(' + (b.b - b.a + 1) + ' * 100% / 7 - 6px);' + eventStyle(rgb, 0.55) + '">' + esc(b.ev.title) + '</button>';
        }).join('');
        weeks += '<div class="wk">' + cells + barsHtml + '</div>';
      }
      var grid = '<div class="panel mgrid"><div class="dows">' + dows(DOW).map(function (x) { return '<div>' + (wide ? x : x.charAt(0)) + '</div>'; }).join('') +
        '</div><div class="weeks">' + weeks + '</div></div>';
      return '<div class="body">' + grid + this._dayList(h, wide) + '</div>';
    }
    // THE CHOSEN DAY'S EVENTS (beside the month)
    _dayList(h, wide) {
      var d = this._day, now = new Date(), evs = onDay(this._evs, d), today = sameDay(d, now);
      var all = evs.filter(function (e) { return e.allDay || (e.start <= day0(d) && e.end >= addDays(day0(d), 1)); });
      var timed = evs.filter(function (e) { return all.indexOf(e) < 0; });
      var next = null;
      if (today) timed.forEach(function (e) { if (!next && soon(e, now)) next = e; });
      var sub = MON[d.getMonth()] + ' ' + d.getDate() + (today ? ' · Today' : sameDay(d, addDays(day0(now), 1)) ? ' · Tomorrow' : '');
      var rows = timed.map(function (e) {
        var rgb = evRgb(e, h), past = e.end <= now;
        var sl = e === next ? soon(e, now) : '';
        return '<button class="ev' + (past ? ' past' : '') + '" data-a="ev" data-v="' + esc(e.key) + '">' +
          '<span class="tm">' + (e.start < day0(d) ? 'Until' : time(e.start)) + '</span><i style="background:' + rgba(rgb, 1) + '"></i>' +
          '<span class="tx"><span class="t1 ell" style="display:block">' + esc(e.title) + '</span>' +
          '<span class="t2 ell" style="display:block">' + esc(span(e) + (e.loc ? ' · ' + e.loc : '')) + '</span></span>' +
          (sl ? '<span class="soon">' + sl + '</span>' : '') + '</button>';
      }).join('');
      var alls = all.map(function (e) {
        var rgb = evRgb(e, h);
        return '<button class="ad" data-a="ev" data-v="' + esc(e.key) + '" style="' + eventStyle(rgb, 0.4) + '"><i style="background:' +
          rgba(rgb, 1) + '"></i><span class="ell">' + esc(e.title) + '</span><em>' + esc(span(e)) + '</em></button>';
      }).join('');
      return '<div class="panel side"><div class="dname">' + DOW_LONG[d.getDay()] + '</div><div class="dsub">' + sub + '</div>' +
        '<div class="hk-edge"><div class="list">' + alls + (rows || (alls ? '' : '<div class="empty">Nothing on this day.</div>')) + '</div></div>' +
        (writable(h).length ? '<button class="addday" data-a="addday">' + IC.plus + ' Add an Event on ' + DOW_LONG[d.getDay()] + '</button>' : '') +
        '</div>';
    }
    // ---- the time grid (week: 7 columns; day: 1)
    _grid(h, days, wide, isDay) {
      var PX = isDay ? 48 : 44, now = new Date(), self = this;
      this._px = PX;
      var n = days.length, gutter = 56, evs = this._evs;
      var from = days[0], bs = bars(evs, from, n);
      var allH = Math.max(30, bs.lanes * 26 + 6);
      var heads = isDay ? '' : '<div class="cols" style="grid-template-columns:' + gutter + 'px repeat(' + n + ',minmax(0,1fr))"><div></div>' +
        days.map(function (d) {
          return '<button class="dh' + (sameDay(d, now) ? ' today' : '') + '" data-a="day" data-v="' + ymd(d) + '" aria-label="' +
            DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + '"><span>' + (wide ? DOW[d.getDay()] : DOW[d.getDay()].charAt(0)) +
            '</span><b>' + d.getDate() + '</b></button>';
        }).join('') + '</div>';
      var alld = '<div class="alld" style="height:' + allH + 'px"><span class="lab">all-day</span>' + bs.list.map(function (b) {
        var rgb = evRgb(b.ev, h);
        return '<button class="bar1" data-a="ev" data-v="' + esc(b.ev.key) + '" style="top:' + (4 + b.lane * 26) + 'px;height:22px;line-height:22px;font-size:12px;left:calc(' +
          gutter + 'px + ' + b.a + ' * (100% - ' + gutter + 'px) / ' + n + ' + 3px);width:calc(' + (b.b - b.a + 1) + ' * (100% - ' + gutter + 'px) / ' + n +
          ' - 6px);' + eventStyle(rgb, 0.55) + '">' + esc(b.ev.title) + (isDay && b.ev.allDay ? '<span style="font-weight:500;margin-left:8px;opacity:0.85">' + esc(span(b.ev).replace('All day · ', '').replace('All day', '')) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
      // (the hour's label gives way to the time now, where they would meet)
      var nowAt = days.some(function (d) { return sameDay(d, now); }) ? (now - day0(now)) / 3600000 * PX : -99;
      var hrs = '';
      for (var hr = 1; hr < 24; hr++) {
        hrs += '<div class="hr" style="top:' + (hr * PX) + 'px">' + (Math.abs(hr * PX - nowAt) < 14 ? '' : '<span>' + hourLabel(hr) + '</span>') + '</div>';
      }
      var first = 24;
      var cols = days.map(function (d) {
        var a = day0(d), b = addDays(a, 1), today = sameDay(d, now);
        var items = evs.filter(function (e) { return !e.allDay && (e.end - e.start) < DAY_MS && e.start < b && e.end > a; })
          .map(function (e) { return { ev: e, s: e.start < a ? a : e.start, e: e.end > b ? b : e.end }; });
        var slots = '';
        for (var h2 = 0; h2 < 24; h2++) slots += '<button class="slot" tabindex="-1" aria-hidden="true" data-a="slot" data-v="' + ymd(d) + 'T' + h2 + '" style="top:' + (h2 * PX) + 'px;height:' + PX + 'px"></button>';
        var blocks = lanes(items).map(function (it) {
          var top = (it.s - a) / 3600000 * PX, ht = Math.max(18, (it.e - it.s) / 3600000 * PX - 3);
          first = Math.min(first, (it.s - a) / 3600000);
          var rgb = evRgb(it.ev, h), past = it.ev.end <= now, w = 100 / it.cols;
          return '<button class="blk' + (past ? ' past' : '') + (self._sel === it.ev.key ? ' sel' : '') + '" data-a="ev" data-v="' + esc(it.ev.key) + '" style="top:' + (top + 1) +
            'px;height:' + ht + 'px;left:calc(' + (it.col * w) + '% + 3px);width:calc(' + w + '% - 6px);' + eventStyle(rgb, past ? 0.28 : 0.5) + edge(rgb) + '">' +
            '<div class="t1 ell">' + esc(it.ev.title) + '</div>' + (ht > 30 ? '<div class="t2 ell">' + esc(span(it.ev) + (isDay && it.ev.loc ? ' · ' + it.ev.loc : '')) + '</div>' : '') + '</button>';
        }).join('');
        return '<div class="dcol' + (today && !isDay ? ' today' : '') + '">' + slots + blocks + '</div>';
      }).join('');
      var nowIdx = -1;
      days.forEach(function (d, i) { if (sameDay(d, now)) nowIdx = i; });
      var nowTop = (now - day0(now)) / 3600000 * PX;
      var nowLine = nowIdx < 0 ? '' : '<div class="now" style="top:' + nowTop + 'px;left:calc(' + gutter + 'px + ' + nowIdx + ' * (100% - ' + gutter + 'px) / ' + n +
        ');width:calc((100% - ' + gutter + 'px) / ' + n + ')"></div><div class="nowl" style="top:' + (nowTop - 8) + 'px">' + time(now).replace(' AM', '').replace(' PM', '') + '</div>';
      // first look: the hour before now (today shown) or before the first event, else 7 AM
      this._scrollTo = Math.max(0, Math.floor(nowIdx >= 0 ? (now - day0(now)) / 3600000 - 2 : first < 24 ? first - 1 : 7));
      // (the hours are a grid under their heading's rule, as iPad Calendar's:
      // no fades at its ends -- the user, 2026-10-17)
      return heads + alld + '<div class="tl"><div class="hrs" style="height:' + (24 * PX) + 'px">' + hrs +
        '<div class="days" style="left:' + gutter + 'px;grid-template-columns:repeat(' + n + ',minmax(0,1fr))">' + cols + '</div>' + nowLine + '</div></div>';
    }
    _week(h, wide) {
      var a = weekStart(this._day), days = [];
      for (var i = 0; i < 7; i++) days.push(addDays(a, i));
      if (!wide) return '<div class="body">' + this._weekList(h, days) + '</div>';
      return '<div class="body"><div class="panel tg">' + this._grid(h, days, wide, false) + '</div></div>';
    }
    // A WEEK ON A PHONE: day by day, as a list
    _weekList(h, days) {
      var now = new Date(), self = this;
      var out = days.map(function (d) {
        var evs = onDay(self._evs, d);
        return '<div class="dayh' + (sameDay(d, now) ? ' today' : '') + '">' + DOW_LONG[d.getDay()].toUpperCase() + ' · ' + MON3[d.getMonth()].toUpperCase() + ' ' + d.getDate() + '</div>' +
          (evs.length ? evs.map(function (e) {
            var rgb = evRgb(e, h);
            return '<button class="ev' + (e.end <= now ? ' past' : '') + '" data-a="ev" data-v="' + esc(e.key) + '"><span class="tm">' +
              (e.allDay ? 'All day' : time(e.start < day0(d) ? day0(d) : e.start)) + '</span><i style="background:' + rgba(rgb, 1) + '"></i><span class="tx">' +
              '<span class="t1 ell" style="display:block">' + esc(e.title) + '</span>' + (e.loc ? '<span class="t2 ell" style="display:block">' + esc(e.loc) + '</span>' : '') + '</span></button>';
          }).join('') : '<div class="empty" style="padding:8px 0">Nothing.</div>');
      }).join('');
      return '<div class="panel wlp"><div class="hk-edge"><div class="wl">' + out + '</div></div></div>';
    }
    _dayView(h, wide) {
      var d = this._day;
      var grid = '<div class="panel tg dayv">' + this._grid(h, [d], wide, true) + '</div>';
      if (!wide) return '<div class="body">' + grid + '</div>';
      return '<div class="body">' + grid + '<div class="rcol">' + this._mini(h) + this._detail(h) + '</div></div>';
    }
    // THE LITTLE MONTH beside the day: any day in a tap, a dot where there
    // are events
    _mini(h) {
      var d = this._day, from = weekStart(new Date(d.getFullYear(), d.getMonth(), 1)), now = new Date(), evs = this._evs;
      var cells = dows(['S', 'M', 'T', 'W', 'T', 'F', 'S']).map(function (x) { return '<div class="w">' + x + '</div>'; }).join('');
      var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      var n = Math.ceil((Math.round((day0(last) - from) / DAY_MS) + 1) / 7) * 7;
      for (var i = 0; i < n; i++) {
        var x = addDays(from, i), mine = ownDay(evs, x);
        var dot = mine.length ? rgba(evRgb(mine[0], h), 1) : 'transparent';
        cells += '<button class="md' + (x.getMonth() !== d.getMonth() ? ' out' : '') + (sameDay(x, now) ? ' today' : '') + (sameDay(x, d) ? ' sel' : '') +
          '" data-a="mini" data-v="' + ymd(x) + '" aria-label="' + MON[x.getMonth()] + ' ' + x.getDate() + '"><b>' + x.getDate() + '</b><i style="background:' + dot + '"></i></button>';
      }
      return '<div class="panel mini"><div class="mh"><b>' + MON[d.getMonth()] + ' ' + d.getFullYear() + '</b>' +
        '<button data-a="minip" aria-label="Previous month">' + IC.left + '</button><button data-a="minin" aria-label="Next month">' + IC.right + '</button></div>' +
        '<div class="mgr">' + cells + '</div></div>';
    }
    // THE CHOSEN EVENT (day view): tap one in the hours
    _detail(h) {
      var now = new Date(), d = this._day, ev = this._sel ? this._find(this._sel) : null;
      if (!ev) {
        // nothing chosen: the next one today, else the day's first
        var evs = onDay(this._evs, d);
        ev = evs.filter(function (e) { return !e.allDay && e.end > now; })[0] || evs.filter(function (e) { return !e.allDay; })[0] || null;
        if (ev) this._sel = ev.key;
      }
      if (!ev) {
        var anyAll = onDay(this._evs, d).length > 0;
        return '<div class="panel det"><div class="none">' + (anyAll ? 'Only all-day events on this day.' : 'Nothing on this day.') +
          (writable(h).length ? ' Tap an hour to add an event.' : '') + '</div></div>';
      }
      var rgb = evRgb(ev, h), sl = soon(ev, now);
      var when = (sameDay(ev.start, now) ? 'Today, ' : DOW_LONG[ev.start.getDay()] + ', ') + span(ev);
      var ed = can(h, ev.cal, 'update') && ev.uid, rm = can(h, ev.cal, 'delete') && ev.uid;
      return '<div class="panel det"><div class="c"><i style="background:' + rgba(rgb, 1) + '"></i>' + esc(calName(h, ev.cal)) +
        (sl ? '<span class="soon" style="margin-left:auto">' + sl + '</span>' : '') + '</div>' +
        '<h3>' + esc(ev.title) + '</h3>' +
        '<div class="ln">' + IC.clock + '<span>' + esc(when) + '</span></div>' +
        (ev.rrule ? '<div class="ln">' + IC.repeat + '<span>' + esc(repeatLabel(ev.rrule)) + '</span></div>' : '') +
        (ev.loc ? '<div class="ln">' + IC.pin + '<span>' + esc(ev.loc) + '</span></div>' : '') +
        (ev.desc ? '<div class="ln" style="color:' + window.hkCards.v('ink-2') + '">' + IC.notes + '<span class="note">' + esc(ev.desc) + '</span></div>' : '') +
        (ed || rm ? '<div class="acts">' + (ed ? '<button class="ed" data-a="edit">Edit</button>' : '') + (rm ? '<button class="rm" data-a="del">Delete</button>' : '') + '</div>' : '') +
        '</div>';
    }
  }

  // ------------------------------------------------------------ the pane
  // THE SCREENSAVER'S CALENDAR PANE (hk-saver.js draws its place, its
  // background and its scrolling): today's events and the coming days',
  // big enough to read across a room. Past events today are dimmed; the
  // next one says how soon.
  // a Home Grid calendar block: its padding (a page card's), the space under the date, an
  // event's line and the gap between lines
  var GV = { pad: window.hkCards.CARD.y, under: 10, row: 40, gap: 6 };
  var PANE_CSS = [
    ':host{display:block;color:' + window.hkCards.v('ink') + '}',
    '.day{padding-top:22px}',
    '.lbl{font-size:13px;font-weight:700;letter-spacing:1.4px;color:' + window.hkCards.v('ink-2') + '}',
    '.date{font-size:24px;font-weight:700;letter-spacing:-0.3px;margin-top:2px}',
    '.ad{margin-top:12px;min-height:32px;border-radius:8px;display:flex;align-items:center;padding:4px 12px;gap:8px;font-size:15px;font-weight:600;color:' + window.hkCards.v('ink') + '}',
    '.ad i{flex:none;width:8px;height:8px;border-radius:4px}',
    '.ad em{margin-left:auto;font-style:normal;font-weight:500;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
    '.ev{display:flex;align-items:flex-start;padding:12px 0;border-bottom:1px solid ' + window.hkCards.v('line') + '}',
    '.ev:last-child{border-bottom:0}',
    '.ev.past{opacity:0.45}',
    '.tm{width:82px;flex:none;font-size:16px;font-weight:600;padding-top:3px}',
    '.ev i{flex:none;width:10px;height:10px;border-radius:5px;margin:9px 12px 0 0}',
    '.tx{min-width:0;flex:1}',
    '.t1{font-size:20px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.t2{font-size:15px;color:' + window.hkCards.v('ink-2') + ';margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.soon{flex:none;margin:2px 0 0 8px;height:24px;padding:0 10px;border-radius:12px;background:#fff;color:#1c1c1e;font-size:12px;font-weight:700;display:flex;align-items:center}',
    '.none{font-size:17px;color:' + window.hkCards.v('ink-2') + ';padding:12px 0 4px}',
    '.foot{height:60px}',
    // ON A HOME GRID (G2, the `calendar` block): a plate -- today's date,
    // then what is still to come today and the coming days (`days`, today
    // and tomorrow unless the block says), one line each, a later day under
    // its own heading; at T the time goes under the title. The lines scroll
    // inside the plate, under the date, and a line opens its event's sheet.
    ':host([size]) .blk{' + window.hkCards.plate('card') + ';box-sizing:border-box;height:100%;padding:' + window.hkCards.CARD.pad + ';',
    '  overflow:hidden;display:flex;flex-direction:column}',
    '.blk .lbl{' + window.hkCards.labelCss('label') + ';line-height:16px}',
    '.blk .date{' + window.hkCards.typeCss('title') + ';line-height:27px;margin:2px 0 ' + GV.under + 'px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.blk.T .date{' + window.hkCards.typeCss('headline') + ';line-height:21px}',
    '.blk .gl{display:flex;flex-direction:column;gap:' + GV.gap + 'px;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;',
    '  scrollbar-width:none;margin:0 -6px;padding:0 6px}',
    '.blk .gl::-webkit-scrollbar{display:none}',
    '.gl .gd{' + window.hkCards.labelCss('label') + ';line-height:16px;margin-top:' + (GV.under - GV.gap) + 'px;flex:none}',
    '.gev{display:flex;align-items:center;gap:10px;height:' + GV.row + 'px;min-width:0;flex:none;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.gev:active{opacity:0.6}',
    '.gev:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}',
    '.gev i{flex:none;width:10px;height:10px;border-radius:5px}',
    '.gev .gtm{flex:none;width:70px;' + window.hkCards.typeCss('body') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.gev .gtx{min-width:0;flex:1}',
    '.gev .g1{' + window.hkCards.typeCss('headline') + ';line-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.gev .g2{' + window.hkCards.typeCss('caption') + ';line-height:16px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.blk .none{' + window.hkCards.typeCss('body') + ';color:' + window.hkCards.v('ink-2') + '}',
    // MONTH VIEW: seven columns, the weeks' rows sharing the height; the day's
    // number sized to its cell (container units: the block is a container)
    '.blk.mo{gap:6px}',
    '.mo .mh{' + window.hkCards.labelCss('label') + ';color:' + CAL_RED + ';line-height:16px;flex:none}',
    '.mo .mg{flex:1;min-height:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:auto repeat(var(--w),minmax(0,1fr));align-items:center;justify-items:center;gap:2px 0}',
    '.mo .mw{' + window.hkCards.labelCss('label-small') + ';line-height:14px}',
    '.mo .md{all:unset;box-sizing:border-box;cursor:pointer;-webkit-tap-highlight-color:transparent;position:relative;display:flex;align-items:center;justify-content:center;height:100%;max-height:calc(100cqw / 7.6);aspect-ratio:1;border-radius:50%;',
    '  font-size:clamp(11px,min(5.4cqw,7.5cqh),24px);font-weight:500;font-variant-numeric:tabular-nums}',
    // (at night the wash makes white the red: today's number goes black, --hk-night-on-red, to read on its circle)
    '.mo .md.now{background:' + CAL_RED + ';color:var(--hk-night-on-red,#fff)}',
    '.mo .md.now i{background:var(--hk-night-on-red,#fff)}',
    '.mo .md i{position:absolute;bottom:12%;width:4px;height:4px;border-radius:2px;background:' + window.hkCards.v('ink-2') + '}',
    '.mo button.md:active{opacity:.6}.mo button.md:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:1px}',
    '.mo .md.out{cursor:default}'
  ].join('\n');
  class HkCalendarPaneCard extends HkBase {
    static get CSS() { return PANE_CSS + FLAT_EVENT_CSS; }
    constructor() {
      super();
      this._evs = []; this._have = ''; this._n = 0;
      var self = this;
      this._onChanged = function () { self._have = ''; self._fetch(); };
    }
    getCardSize() { return 6; }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      window.addEventListener('hk-calendar-changed', this._onChanged);
      this._tick = setInterval(function () { self._have = ''; self._fetch(); }, 300000);
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      window.removeEventListener('hk-calendar-changed', this._onChanged);
      if (this._tick) { clearInterval(this._tick); this._tick = null; }
      this._hkSig = null;
    }
    _calIds(h) {
      var own = (this._config || {}).calendars;
      return Array.isArray(own) && own.length ? own.filter(function (id) { return h.states[id]; }) : calIds(h);
    }
    _days() { var n = Number((this._config || {}).days); return n >= 1 && n <= 7 ? Math.round(n) : 2; }
    // what to read: today and the coming days, or (Month View) the weeks the month's grid shows
    _range() {
      var now = new Date();
      if (this._month()) { var a = weekStart(new Date(now.getFullYear(), now.getMonth(), 1)); return [a, addDays(a, 42)]; }
      return [day0(now), addDays(day0(now), this._days())];
    }
    _month() { return !!(this._config || {}).month && !!this._cellSize(); }
    _fetch() {
      var h = this.client;
      if (!h) return;
      var rg = this._range(), from = rg[0], to = rg[1], ids = this._calIds(h);
      var want = ids.join(',') + '|' + (+from) + '|' + (+to) + '|' + store.ver;
      if (want === this._have) return;
      this._have = want;
      var self = this;
      load(h, ids, from, to).then(function (got) {
        if (self._have !== want) return;
        self._evs = got.evs; self._n++;
        self.redraw();
      });
    }
    _sigOf() {
      var h = this.client;
      if (!h || !this._config) return null;
      var ids = this._calIds(h), HS = window.hkSettings;
      return ids.map(function (id) { var s = h.states[id]; return id + '=' + (s ? s.last_updated : 'x') + '/' +
        (HS && HS.calendarColor ? HS.calendarColor(id, h.states) : ''); }).join(';') + colorSig() + '|' + this._n + '|' + Math.floor(Date.now() / 60000);
    }
    _render() {
      var h = this.client;
      if (!h || !this._config) return;
      this._fetch();
      var sized = this._cellSize();
      if (sized) { this._renderBlock(sized); return; }
      var now = new Date(), d0 = day0(now), self = this, html = '', next = null;
      onDay(this._evs, d0).forEach(function (e) { if (!next && soon(e, now)) next = e; });
      for (var i = 0; i < this._days(); i++) {
        var d = addDays(d0, i), evs = onDay(self._evs, d);
        var all = evs.filter(function (e) { return e.allDay || (e.start <= d && e.end >= addDays(d, 1)); });
        var timed = evs.filter(function (e) { return all.indexOf(e) < 0; });
        var lbl = i === 0 ? 'TODAY' : i === 1 ? 'TOMORROW' : DOW_LONG[d.getDay()].toUpperCase();
        var date = i < 2 ? DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() : MON[d.getMonth()] + ' ' + d.getDate();
        html += '<div class="day"><div class="lbl">' + lbl + '</div><div class="date">' + date + '</div>' +
          all.map(function (e) {
            var rgb = evRgb(e, h);
            return '<div class="ad" style="' + eventStyle(rgb, 0.4) + '"><i style="background:' + rgba(rgb, 1) + '"></i>' + esc(e.title) + '<em>All day</em></div>';
          }).join('') +
          '<div>' + timed.map(function (e) {
            var rgb = evRgb(e, h), sl = e === next ? soon(e, now) : '';
            var sub = e.loc || (e.end - e.start > 3600000 ? time(e.start) + ' – ' + time(e.end) : calName(h, e.cal));
            return '<div class="ev' + (e.end <= now ? ' past' : '') + '"><div class="tm">' + (e.start < d ? 'Until' : time(e.start)) +
              '</div><i style="background:' + rgba(rgb, 1) + '"></i><div class="tx"><div class="t1">' + esc(e.title) + '</div><div class="t2">' +
              esc(sub) + '</div></div>' + (sl ? '<div class="soon">' + sl + '</div>' : '') + '</div>';
          }).join('') + '</div>' +
          (evs.length ? '' : '<div class="none">Nothing scheduled.</div>') + '</div>';
      }
      if (!this._calIds(h).length) html = '<div class="day"><div class="none">No calendars.</div></div>';
      this._root.innerHTML = html + '<div class="foot"></div>';
    }
    // A HOME GRID BLOCK: T and L
    _renderBlock(sized) {
      var h = this.client, now = new Date(), d0 = day0(now), wide = sized !== 'T', self = this;
      this._watchBlock();
      if (this._month()) { this._renderMonth(sized, d0); return; }
      // what is still to come, day by day, each day's all-day first
      var shown = [], days = [];
      for (var i = 0; i < this._days(); i++) days.push(addDays(d0, i));
      var html = days.map(function (d, i) {
        var evs = onDay(self._evs, d).filter(function (e) { return e.end > now && shown.indexOf(e) < 0; });
        var all = evs.filter(function (e) { return e.allDay || (e.start <= d && e.end >= addDays(d, 1)); });
        var rows = all.concat(evs.filter(function (e) { return all.indexOf(e) < 0; })).map(function (e) {
          var isAll = all.indexOf(e) >= 0, rgb = evRgb(e, h), tmw = isAll ? 'All day' : (e.start < d ? 'Until ' + time(e.end) : time(e.start));
          var sub = [wide ? '' : tmw, e.loc || (!isAll && wide && e.end - e.start > 3600000 ? time(e.start) + ' – ' + time(e.end) : '')]
            .filter(Boolean).join(' · ') || calName(h, e.cal);
          shown.push(e);
          return '<div class="gev" role="button" tabindex="0" data-ev="' + (shown.length - 1) + '" aria-label="' + esc(e.title + ', ' + tmw) + '">' +
            (wide ? '<div class="gtm">' + esc(tmw) + '</div>' : '') +
            '<i style="background:' + rgba(rgb, 1) + '"></i><div class="gtx"><div class="g1">' + esc(e.title) + '</div>' +
            '<div class="g2">' + esc(sub) + '</div></div></div>';
        });
        if (!i || !rows.length) return rows.join('');
        var lbl = i === 1 ? 'Tomorrow' : DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
        return '<div class="gd">' + esc(lbl) + '</div>' + rows.join('');
      }).join('');
      this._shown = shown;
      var date = wide ? DOW_LONG[d0.getDay()] + ', ' + MON[d0.getMonth()] + ' ' + d0.getDate()
                      : DOW_LONG[d0.getDay()].slice(0, 3) + ', ' + MON[d0.getMonth()].slice(0, 3) + ' ' + d0.getDate();
      // (the lines keep where they were scrolled across a redraw)
      var was = this._root.querySelector('.gl'), top = was ? was.scrollTop : 0;
      this._root.innerHTML = '<div class="blk ' + sized + '"><div class="lbl">Today</div><div class="date">' + esc(date) + '</div>' +
        '<div class="gl">' + (shown.length ? html : '<div class="none">' + (this._calIds(h).length ? 'Nothing scheduled.' : 'No calendars.') + '</div>') +
        '</div></div>';
      if (top) this._root.querySelector('.gl').scrollTop = top;
      if (!this._taps) {
        this._taps = true;
        var open = function (ev) {
          var row = ev.target.closest && ev.target.closest('.gev');
          var e = row && self._shown && self._shown[+row.getAttribute('data-ev')];
          if (e) show(self.client, e);
        };
        this._root.addEventListener('click', open);
        this._root.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(ev); } });
      }
    }
  }

  // MONTH VIEW (2026-10-24, StandBy's calendar): the month's name, the
  // week's days and the month as a grid filling the block, today circled,
  // a dot under a day with something on it. Weeks start as the calendar's do.
  HkCalendarPaneCard.prototype._renderMonth = function (sized, d0) {
    var first = new Date(d0.getFullYear(), d0.getMonth(), 1), a = weekStart(first), self = this;
    var last = new Date(d0.getFullYear(), d0.getMonth() + 1, 0), weeks = Math.ceil((((first - a) / 864e5) + last.getDate()) / 7);
    var cells = [];
    for (var i = 0; i < weeks * 7; i++) {
      var d = addDays(a, i), on = d.getMonth() === d0.getMonth(), busy = on && onDay(self._evs, d).length > 0;
      // a day of the month is a button: its day on the Calendar page (as a calendar notification's Go To opens it)
      cells.push(on ? '<button type="button" class="md' + (sameDay(d, d0) ? ' now' : '') + '" data-ymd="' + ymd(d) + '" aria-label="' +
        esc(DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + (busy ? ', with events' : '')) + '"><b>' + d.getDate() + '</b>' +
        (busy ? '<i></i>' : '') + '</button>' : '<span class="md out" aria-hidden="true"></span>');
    }
    this._root.innerHTML = '<div class="blk mo ' + sized + '" role="group" aria-label="' + esc(MON[d0.getMonth()] + ' ' + d0.getFullYear()) + '">' +
      '<div class="mh">' + esc(MON[d0.getMonth()]) + '</div><div class="mg" style="--w:' + weeks + '">' +
      dows(DOW).map(function (x) { return '<span class="mw" aria-hidden="true">' + x.charAt(0) + '</span>'; }).join('') + cells.join('') + '</div></div>';
    if (!this._dayTaps) {
      this._dayTaps = true;
      this._root.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.md[data-ymd]');
        if (!b) return;
        var dash = '/' + (String(location.pathname).split('/')[1] || '') + '/';
        window.hkCards.navigate(dash + 'calendar?day=' + b.getAttribute('data-ymd'), self);
      });
    }
  };

  register('hk-calendar-card', HkCalendarCard, 'HK Calendar',
    'The house’s calendars: the month, the week or the day, with events to add, change and delete.',
    C && [{ name: 'view', selector: { select: { options: [{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }] } } }],
    function () { return {}; });
  register('hk-calendar-pane-card', HkCalendarPaneCard, 'HK Calendar Pane',
    'Today’s events and the coming days’, as the screensaver’s calendar pane shows them.',
    C && [{ name: 'days', selector: { number: { min: 1, max: 7, mode: 'box' } } }],
    function () { return { days: 2 }; });

  // ============================================================ EVENT SHEET
  // hk-detail.js kind `event`: two columns on a tablet (the WIDE sheet), one
  // on a phone; HK's sizes and spacing (hk-detail.js SP).
  //   the event  its calendar, the time big, the day and how long; where,
  //              how it repeats, notes; Edit / Delete where the calendar
  //              allows them (this file's editor and delete, unchanged)
  //   its day    every event of that day, this one marked -- a tap shows
  //              another in its place
  // THE EVENT comes as the Calendar page's (norm), a notification's (the
  // house's: its name, start and end as text), or -- from a calendar's tile --
  // the calendar's own (the one going on or next). The day's events are then
  // asked for, and the event found among them for its uid (Edit, Delete).
  function fromAny(client, cal, e) {
    if (!e && cal) {
      var st = client && client.states && client.states[cal], a = (st && st.attributes) || {};
      if (!a.start_time) return null;
      e = { summary: a.message, start: a.start_time, end: a.end_time, location: a.location, description: a.description, all_day: a.all_day };
    }
    if (!e) return null;
    if (e.start instanceof Date) return e;                         // already norm()'s
    var timed = function (v) { return /[T ]\d/.test(String(v || '')); };
    var parse = function (v) {
      var t = String(v || '');
      if (!timed(t)) return parseYmd(t);
      var x = new Date(t.replace(' ', 'T'));
      return isNaN(x) ? null : x;
    };
    var start = parse(e.start), allDay = !!e.all_day || !timed(e.start);
    if (!start) return null;
    var end = parse(e.end) || (allDay ? addDays(start, 1) : new Date(+start + 3600000));
    return { cal: e.cal || cal, uid: e.uid || null, rid: e.recurrence_id || null, rrule: e.rrule || null,
             title: String(e.summary || e.title || 'Untitled'), desc: String(e.description || ''), loc: String(e.location || ''),
             allDay: allDay, start: start, end: end, key: (e.cal || cal) + '||' + (+start) };
  }
  function longDay(d) {
    var w = DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate();
    return sameDay(d, new Date()) ? 'Today · ' + w : sameDay(d, addDays(day0(new Date()), 1)) ? 'Tomorrow · ' + w : w;
  }
  function howLong(ev) {
    if (ev.allDay) return '';
    var m = Math.round((ev.end - ev.start) / 60000), h = Math.floor(m / 60);
    return h ? h + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';
  }
  function bigTime(ev) {
    if (ev.allDay) return 'All Day';
    var a = time(ev.start), b = time(ev.end);
    // "12:15 – 1:45 PM": one AM / PM when both share it, on one day
    if (sameDay(ev.start, ev.end) && a.slice(-2) === b.slice(-2)) a = a.slice(0, -3);
    return a + ' – ' + b;
  }
  function whenDetail(fn) {
    if (window.hkDetail && window.hkDetail._) return fn(window.hkDetail);
    window.addEventListener('hk-detail-ready', function () { if (window.hkDetail) fn(window.hkDetail); }, { once: true });
  }
  whenDetail(function (X) {
    if (customElements.get('hk-detail-event')) return;
    var U = X._, SP = U.SP;
    var CSS = [
      ':host{display:block;color:#fff}',
      '.ee{display:flex;gap:' + SP.region + 'px;min-height:100%;box-sizing:border-box}',
      '.col{display:flex;flex-direction:column;gap:' + SP.block + 'px;min-width:0}',
      '.c1{width:340px;flex:none}.c2{flex:1}',
      '.ee.one{flex-direction:column;gap:' + SP.block + 'px}.ee.one .c1,.ee.one .c2{width:auto;display:contents}',
      '.ee .hkn-card{margin-bottom:' + (SP.region - SP.block) + 'px}',
      '.card{border-radius:' + SP.cardR + 'px;background:rgba(255,255,255,0.08);padding:' + SP.cardPad + ';flex:none}',
      '.card.rows{padding:' + SP.rowsPad + '}',
      '.lab{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:13px;line-height:16px;font-weight:600;',
      '  letter-spacing:0.3px;color:rgba(235,235,245,0.55);text-transform:uppercase}',
      '.lab .n{text-transform:none;font-size:15px;font-weight:400;letter-spacing:0;color:rgba(235,235,245,0.8)}',
      '.when{padding:0 ' + SP.inset + 'px;flex:none}',
      '.calc{display:flex;align-items:center;gap:8px;font-size:14px;line-height:18px;font-weight:600;color:rgba(255,255,255,0.9)}',
      '.calc i{width:10px;height:10px;border-radius:50%;flex:none}',
      '.t{margin-top:' + SP.line + 'px;font-size:36px;font-weight:700;letter-spacing:-1px;line-height:40px}',
      '.d{margin-top:' + SP.line + 'px;font-size:15px;line-height:20px;color:rgba(235,235,245,0.62)}',
      '.row{display:flex;align-items:flex-start;gap:12px;font-size:16px;line-height:20px}',
      // ITS COLOR (2026-10-16): the ten, the one it wears ringed; a tap on
      // its own again (or Automatic) gives it back to its keyword or calendar
      // (the sheets' .lab pulls what follows up 10 px: not here)
      '.colc .lab{margin-bottom:0}',
      '.cols{display:flex;justify-content:space-between;margin-top:14px}',
      '.cols button{width:24px;height:24px;border-radius:50%;border:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;',
      '  box-shadow:0 0 0 0 transparent;transition:box-shadow .15s}',
      '.cols button.on{box-shadow:0 0 0 2px rgba(30,30,32,1),0 0 0 4px #fff}',
      // (a 24 px dot, a 36 px finger: the tap reaches 6 past it each way)
      '.cols button{position:relative}.cols button::after{content:"";position:absolute;inset:-6px}',
      '.lab .auto{border:0;background:none;padding:0;font:inherit;font-size:15px;font-weight:400;letter-spacing:0;text-transform:none;color:#64d2ff;cursor:pointer}',
      '.row + .row{margin-top:' + SP.block + 'px}',
      '.row svg{flex:none;width:20px;height:20px;opacity:.7}',
      '.row span{min-width:0;overflow-wrap:anywhere}',
      '.row .note{white-space:pre-wrap;color:' + window.hkCards.v('ink-2') + '}',
      '.acts{display:flex;gap:' + SP.block + 'px;margin-top:auto;flex:none}',
      '.ee.one .acts{margin-top:0}',
      '.acts button{flex:1;height:50px;border-radius:25px;border:0;background:rgba(255,255,255,0.14);color:#fff;font:inherit;',
      '  font-size:16px;font-weight:600;cursor:pointer}',
      '.acts button:active{background:rgba(255,255,255,0.24)}',
      '.acts .rm{color:#ff6961}',
      '.ro{margin-top:auto;padding:0 ' + SP.inset + 'px;font-size:14px;line-height:18px;color:' + window.hkCards.v('ink-2') + '}',
      '.ee.one .ro{margin-top:0}',
      '.day{display:flex;flex-direction:column}',
      '.c2 > .day{flex:1;min-height:0;overflow-y:auto;scrollbar-width:none}',
      '.c2 > .day::-webkit-scrollbar{display:none}',
      '.day .lab{margin-bottom:6px}',
      '.ev{display:flex;align-items:stretch;gap:12px;padding:10px;margin:0 -10px;border-radius:12px;position:relative;cursor:pointer;',
      '  border:0;background:none;color:#fff;font:inherit;text-align:left;width:calc(100% + 20px);box-sizing:border-box;',
      '  -webkit-tap-highlight-color:transparent}',
      '.ev + .ev:before{content:"";position:absolute;left:10px;right:10px;top:0;border-top:1px solid rgba(255,255,255,0.10)}',
      '.ev.on{background:rgba(255,255,255,0.10)}',
      '.ev.on:before,.ev.on + .ev:before{display:none}',
      '.ev .bar{width:4px;border-radius:2px;flex:none}',
      '.ev .tm{width:70px;flex:none;font-size:13px;line-height:20px;color:rgba(235,235,245,0.6)}',
      '.ev .nm{min-width:0;font-size:15px;font-weight:600;line-height:20px;overflow-wrap:anywhere}',
      '.ev .nm small{display:block;font-size:13px;line-height:18px;font-weight:500;color:rgba(235,235,245,0.55)}',
      '.empty{font-size:15px;line-height:20px;color:rgba(235,235,245,0.55);padding:10px 0}',
      // ---- A TABLET (2026-10-13): the event in cards on the left, its day
      // as hours on the right -- iPad Calendar's event and its day -- filling
      // the sheet, where a short list once floated in an empty one
      // the sheet's height and no more: the hours scroll inside their card
      '.ee:not(.one){flex:1;height:100%;min-height:0}.ee:not(.one) .col{min-height:0}',
      // (a long note, a notification on top: the left column scrolls, the month shrinks first)
      '.ee:not(.one) .c1{overflow-y:auto;scrollbar-width:none}.ee:not(.one) .c1::-webkit-scrollbar{display:none}',
      '.ee:not(.one) .when{border-radius:' + SP.cardR + 'px;background:rgba(255,255,255,0.08);padding:' + SP.cardPad + '}',
      '.calc .soon{margin-left:auto;height:24px;padding:0 10px;border-radius:12px;background:#fff;color:#1c1c1e;font-size:11px;font-weight:700;',
      '  display:flex;align-items:center;flex:none}',
      '.c2 > .tlc{flex:1;min-height:0;display:flex;flex-direction:column;padding:16px 0 0;overflow:hidden}',
      '.tlc > .lab{padding:0 18px;margin-bottom:10px}',
      '.tlad{display:flex;flex-direction:column;gap:4px;padding:0 12px 10px 64px;flex:none}',
      '.tlad button{height:26px;border-radius:8px;border:0;padding:0 10px;font:inherit;font-size:13px;font-weight:600;color:#fff;text-align:left;',
      '  cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;-webkit-tap-highlight-color:transparent}',
      '.tlad button.on{box-shadow:0 0 0 2px #fff inset}',
      '.tlw{position:relative;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;',
      '  border-top:1px solid ' + window.hkCards.v('line') + '}',
      '.tlw::-webkit-scrollbar{display:none}',
      '.tlh{position:relative}',
      '.tlr{position:absolute;left:64px;right:12px;height:0;border-top:1px solid ' + window.hkCards.v('line') + '}',
      '.tlr span{position:absolute;left:-60px;top:-8px;width:50px;text-align:right;font-size:11px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
      '.tlx{position:absolute;top:0;bottom:0;left:64px;right:12px}',
      '.tlb{position:absolute;box-sizing:border-box;overflow:hidden;border-radius:8px;padding:4px 10px;border:0;text-align:left;color:#fff;',
      '  font:inherit;line-height:1.25;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.tlb .t1{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tlb .t2{font-size:11px;font-weight:500;color:rgba(255,255,255,0.75);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tlb.past{opacity:0.85}',
      '.tlb{box-shadow:inset 3px 0 0 var(--e,transparent)}',
      '.tlb.on{box-shadow:inset 3px 0 0 var(--e,transparent),0 0 0 2px #fff inset}',
      // the little month under the event: a dot where there are events, the
      // day shown filled; a tap shows that day (its hours, its first event)
      // (its own height, not what the details above leave: a day with notes
      // and one without put the month in the same place)
      '.mm{flex:none;display:flex;flex-direction:column}',
      '.ee{transition:opacity .15s}.ee.wait{opacity:.55}',
      '.mm .lab{margin-bottom:8px}',
      '.mmg{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));row-gap:2px;flex:1;min-height:0}',
      '.mmg .w{text-align:center;font-size:11px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';padding-bottom:4px}',
      '.mmg button{min-height:36px;border:0;background:none;padding:0;color:#fff;font:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
      '  cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.mmg button b{width:28px;height:28px;line-height:28px;border-radius:14px;text-align:center;font-size:13px;font-weight:600}',
      '.mmg button i{width:4px;height:4px;border-radius:2px}',
      '.mmg button.out{opacity:.35}',
      '.mmg button.today b{color:#ff6961}',
      '.mmg button.sel b{background:#fff;color:#1c1c1e}',
      '.tln{position:absolute;left:64px;right:12px;height:2px;background:#ff453a;pointer-events:none}',
      '.tln::before{content:"";position:absolute;left:-5px;top:-4px;width:10px;height:10px;border-radius:5px;background:#ff453a}',
      // A SHORT SCREEN (hk-detail.js SHORT_MQ: a phone on its side): the
      // left column is the event, where and what, and Edit and Delete --
      // without the month (the day beside it places the event) or its Color
      // (set from a taller screen); the time a size smaller
      // ...and the event's column a share of the sheet, not its 340, so the day's column keeps its header on one line
      U.SHORT_MQ ? '@media ' + U.SHORT_MQ + '{.c1 .mm,.c1 .colc{display:none}.t{font-size:30px;line-height:34px}.c1{width:min(340px,52%)}' +
        '.c2 .lab span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.c2 .lab span:last-child{flex:none}' +
        '.ro{font-size:13px;line-height:16px}}' : ''
    ].join('');
    // This sheet predates the light appearance. Its Glass text and wells
    // stay as drawn; Flat reads the same ink/key roles as the other sheets.
    var FLAT_DETAIL_CSS = [
      ':host([hk-flat]){color:' + C.v('ink') + '}',
      ':host([hk-flat]) .card,:host([hk-flat]) .when{background:' + C.v('key') + '}',
      ':host([hk-flat]) .when{border-radius:' + SP.cardR + 'px;padding:' + SP.cardPad + '}',
      ':host([hk-flat]) :is(.lab,.lab .n,.calc,.d,.ev .tm,.ev .nm small,.empty){color:' + C.v('ink-2') + '}',
      ':host([hk-flat]) :is(.ev,.mmg button){color:' + C.v('ink') + '}',
      ':host([hk-flat]) .ev + .ev:before{border-color:' + C.v('line') + '}',
      ':host([hk-flat]) .ev.on{background:' + C.v('key-strong') + '}',
      ':host([hk-flat]) :is(.ev.on .tm,.ev.on .nm small){color:' + C.v('ink') + '}',
      ':host([hk-flat]) .acts button{background:' + C.v('key') + ';color:' + C.v('ink') + '}',
      ':host([hk-flat]) .acts button:active{background:' + C.v('key-strong') + '}',
      ':host([hk-flat]) :is(.acts .rm,.mmg button.today b){color:' + C.v('fail') + '}',
      ':host([hk-flat]) .lab .auto{color:' + C.v('ink') + ';text-decoration:underline}',
      ':host([hk-flat]) .cols button{box-shadow:inset 0 0 0 1px ' + C.v('line') + '}',
      ':host([hk-flat]) .cols button.on{box-shadow:0 0 0 2px ' + C.v('key') + ',0 0 0 4px ' + C.v('ink') + '}'
    ].join('');
    var TL_PX = 48;
    class EventPanel extends U.Panel {
      // (the notification's card lives in here: its CSS too)
      static get CSS() { return U.PANEL_CSS + U.NOTE_CSS + CSS + FLAT_EVENT_CSS + FLAT_DETAIL_CSS; }
      constructor() {
        super();
        var self = this;
        this._onChanged = function () { self._day = null; self._load(); };
      }
      hkWidthKind() { return 'event'; }
      hkNoGear() { return true; }
      hkFill() { return !matchMedia('(max-width:' + window.hkCards.BP.phone + 'px)').matches; }
      // the notification's card, at the top of the left column
      hkNote(card) { this._note = card; if (this._c1) this._c1.insertBefore(card, this._c1.firstChild); }
      // the header: the calendar's glyph in its color, the event's name
      hkHead(h, d) {
        var rgb = this._ev ? evRgb(this._ev, h) : rgbOf(this._id, h);
        d.well.style.background = 'rgba(255,255,255,0.12)';
        d.icon.icon = 'mdi:calendar';
        d.icon.style.color = rgba(rgb, 1);
        d.tt.textContent = this._ev ? this._ev.title : calName(h, this._id);
        return true;
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        window.addEventListener('hk-calendar-changed', this._onChanged);
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        window.removeEventListener('hk-calendar-changed', this._onChanged);
      }
      _sigOf() { return this._built ? 'built' : 'new'; }
      _render() {
        var h = this.client;
        if (!h || !this._config) return;
        if (!this._ev) this._ev = fromAny(h, this._id, this._config.event);
        var one = matchMedia('(max-width:' + window.hkCards.BP.phone + 'px)').matches;
        if (!this._built || this._one !== one) {
          this._built = true; this._one = one;
          // a tablet's two columns are the sheet's height (the hours scroll
          // inside theirs): the panel's own box passes the height down
          this._root.style.cssText = one ? '' : 'flex:1;min-height:0;display:flex;flex-direction:column';
          this._root.innerHTML = '<div class="ee' + (one ? ' one' : '') + '"><div class="col c1"></div><div class="col c2"></div></div>';
          this._c1 = this._root.querySelector('.c1'); this._c2 = this._root.querySelector('.c2');
          this._root.querySelector('.ee').addEventListener('click', this._click.bind(this));
          this._load();
          this._paint();
        }
      }
      _load() {
        var h = this.client, ev = this._ev, self = this;
        if (!h || (!ev && !this._at)) return;
        var a = this._at || day0(ev.start), ids = calIds(h);
        this._at = a;
        if (ev && ids.indexOf(ev.cal) < 0) ids = ids.concat([ev.cal]);
        load(h, ids, a, addDays(a, 1)).then(function (r) {
          if (+self._at !== +a) return;                 // another day was picked meanwhile
          self._day = onDay(r.evs, a);
          // the event itself, found again: its uid and repeat (Edit, Delete)
          var ev2 = self._ev;
          if (ev2) {
            var same = function (e) { return e.cal === ev2.cal && e.title === ev2.title; };
            var hit = self._day.filter(function (e) { return same(e) && +e.start === +ev2.start; })[0] || self._day.filter(same)[0];
            if (hit) self._ev = hit;
          }
          self._paint();
        });
        // the little month's dots (a tablet): its weeks' events, once a month
        var m0 = weekStart(new Date(a.getFullYear(), a.getMonth(), 1)), mk = +m0 + '|' + store.ver;
        if (!this._one && this._monKey !== mk) {
          this._monKey = mk;
          load(h, ids, m0, addDays(m0, 42)).then(function (r) { if (self._monKey === mk) { self._mon = r.evs; self._paint(); } });
        }
      }
      // ANOTHER DAY, from the little month: its hours, and its first event
      // (the next one still to come, if it is today) -- or none
      // WHAT IS SHOWN STAYS until the day is in (2026-10-16, the user: the
      // sheet jumped about from day to day): the little month marks the day
      // at once, the rest dims a moment and is then replaced in one paint --
      // never a "Loading…" swapped in and out
      _pickDay(d) {
        if (+d === +this._at) return;
        this._at = d; this._tlMoved = false;
        var self = this;
        var h = this.client, ids = calIds(h);
        var ee = this._root.querySelector('.ee');
        if (ee) ee.classList.add('wait');
        this._root.querySelectorAll('.mmg button[data-d]').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-d') === ymd(d)); });
        load(h, ids, d, addDays(d, 1)).then(function (r) {
          if (+self._at !== +d) return;
          var list = onDay(r.evs, d), now = new Date();
          var ee2 = self._root.querySelector('.ee');
          if (ee2) ee2.classList.remove('wait');
          self._day = list;
          self._ev = list.filter(function (e) { return !e.allDay && e.end > now; })[0] || list.filter(function (e) { return !e.allDay; })[0] || list[0] || null;
          self._paint();
          if (+self._at !== +day0(d)) return;
          // a new month: its dots
          self._load();
        });
      }
      _month(h) {
        var a = this._at, from = weekStart(new Date(a.getFullYear(), a.getMonth(), 1)), now = new Date(), evs = this._mon || [];
        var cells = dows(['S', 'M', 'T', 'W', 'T', 'F', 'S']).map(function (x) { return '<div class="w">' + x + '</div>'; }).join('');
        var last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
        var n = Math.ceil((Math.round((day0(last) - from) / DAY_MS) + 1) / 7) * 7;
        for (var i = 0; i < n; i++) {
          var x = addDays(from, i), mine = ownDay(evs, x);
          cells += '<button class="' + (x.getMonth() !== a.getMonth() ? 'out ' : '') + (sameDay(x, now) ? 'today ' : '') + (sameDay(x, a) ? 'sel' : '') +
            '" data-d="' + ymd(x) + '" aria-label="' + MON[x.getMonth()] + ' ' + x.getDate() + '"><b>' + x.getDate() + '</b><i style="background:' +
            (mine.length ? rgba(evRgb(mine[0], h), 1) : 'transparent') + '"></i></button>';
        }
        return '<div class="card mm"><div class="lab"><span>' + MON[a.getMonth()] + ' ' + a.getFullYear() + '</span></div><div class="mmg" style="grid-template-rows:auto repeat(' + (n / 7) + ',36px)">' + cells + '</div></div>';
      }
      _paint() {
        var h = this.client, ev = this._ev;
        if (!this._c1 || !h) return;
        var note = this._note;
        if (!ev && this._at && !this._one) {
          // a day picked from the little month with nothing on it
          var dd = this._at, tw0 = this._c2.querySelector('.tlw'), was0 = tw0 ? tw0.scrollTop : null;
          this._c1.innerHTML = '<div class="when"><div class="t">' + (this._day ? 'Nothing Planned' : 'Loading…') + '</div><div class="d">' + esc(longDay(dd)) + '</div></div>' + this._month(h);
          this._c2.innerHTML = this._hours(h, null);
          var tw1 = this._c2.querySelector('.tlw');
          if (tw1) tw1.scrollTop = was0 != null && this._tlMoved ? was0 : 7 * TL_PX;
          var st0 = X._.state();
          if (st0 && st0.panel === this && st0.tt) st0.tt.textContent = longDay(dd).replace(/^(Today|Tomorrow) · /, '');
          if (note) this._c1.insertBefore(note, this._c1.firstChild);
          return;
        }
        if (!ev) {
          this._c1.innerHTML = '<div class="when"><div class="t">No Events</div><div class="d">' + esc(calName(h, this._id)) + '</div></div>';
          this._c2.innerHTML = '';
          if (note) this._c1.insertBefore(note, this._c1.firstChild);
          return;
        }
        var rgb = evRgb(ev, h), one = this._one;
        var edit = can(h, ev.cal, 'update') && ev.uid, del = can(h, ev.cal, 'delete') && ev.uid;
        var rows = (ev.loc ? '<div class="row">' + IC.pin + '<span>' + esc(ev.loc) + '</span></div>' : '') +
                   (ev.rrule ? '<div class="row">' + IC.repeat + '<span>' + esc(repeatLabel(ev.rrule)) + '</span></div>' : '') +
                   (ev.desc ? '<div class="row">' + IC.notes + '<span class="note">' + esc(ev.desc) + '</span></div>' : '');
        var sl = soon(ev, new Date());
        var when = '<div class="when"><div class="calc"><i style="background:' + rgba(rgb, 1) + '"></i>' + esc(calName(h, ev.cal)) +
          (sl && !one ? '<span class="soon">' + esc(sl) + '</span>' : '') + '</div>' +
          '<div class="t">' + esc(bigTime(ev)) + '</div><div class="d">' + esc([longDay(ev.start), howLong(ev)].filter(Boolean).join(' · ')) + '</div></div>';
        var colors = this._colors(h, ev);
        var acts = edit || del ? '<div class="acts">' + (edit ? '<button data-a="edit">Edit</button>' : '') +
          (del ? '<button class="rm" data-a="del">Delete</button>' : '') + '</div>'
          : (this._day ? '<div class="ro">Home Assistant can’t edit this calendar, so its events can’t be changed or deleted here.</div>' : '');
        var list = this._day;
        var day = '<div class="card day"><div class="lab"><span>' + esc(DOW_LONG[ev.start.getDay()] + ', ' + MON[ev.start.getMonth()] + ' ' + ev.start.getDate()) +
          '</span>' + (list ? '<span class="n">' + list.length + (list.length === 1 ? ' event' : ' events') + '</span>' : '') + '</div>' +
          (list ? (list.length ? list.map(function (e) {
            var on = e.cal === ev.cal && +e.start === +ev.start && e.title === ev.title;
            return '<button class="ev' + (on ? ' on' : '') + '" data-k="' + esc(e.key) + '"><span class="bar" style="background:' + rgba(evRgb(e, h), 1) + '"></span>' +
              '<span class="tm">' + (e.allDay ? 'All Day' : esc(time(e.start))) + '</span><span class="nm">' + esc(e.title) +
              '<small>' + esc([calName(h, e.cal), e.loc].filter(Boolean).join(' · ')) + '</small></span></button>';
          }).join('') : '<div class="empty">Nothing else that day</div>') : '<div class="empty">Loading…</div>') + '</div>';
        // a tablet: the month right under the time, where it stays from event
        // to event; the details (as long as they are) under it, then the buttons
        this._c1.innerHTML = one ? when + (rows ? '<div class="card rows">' + rows + '</div>' : '') + colors + day + acts
          : when + this._month(h) + (rows ? '<div class="card rows">' + rows + '</div>' : '') + colors + acts;
        var tw = this._c2.querySelector('.tlw'), was = tw ? tw.scrollTop : null;
        this._c2.innerHTML = one ? '' : this._hours(h, ev);
        // the hours: where they were (another of the day's events tapped), or
        // first at the hour before this event (7 AM for an all-day one)
        tw = this._c2.querySelector('.tlw');
        if (tw) {
          var at = ev.allDay ? 7 : Math.max(0, ev.start.getHours() + ev.start.getMinutes() / 60 - 1);
          // (12 px above the hour's line: its label is centred on the line, and flush it was cut in half)
          var self = this, top = this._tlMoved && was != null ? was : Math.max(0, at * TL_PX - 12);
          // (again once laid out: a sheet still opening has no height yet)
          tw.scrollTop = top;
          requestAnimationFrame(function () { if (!self._tlMoved) tw.scrollTop = top; });
          tw.addEventListener('scroll', function () { if (Math.abs(tw.scrollTop - top) > 2) self._tlMoved = true; }, { passive: true });
        }
        if (note) this._c1.insertBefore(note, this._c1.firstChild);
        // the header names the event shown
        var st = X._.state();
        if (st && st.panel === this && st.tt) st.tt.textContent = ev.title;
      }
      // ITS COLOR: its own (picked here, for the series), else the first
      // keyword in its title, else its calendar's
      _colors(h, ev) {
        var HS = window.hkSettings;
        if (!HS || !HS.eventKey) return '';
        var key = HS.eventKey(ev.title, ev.uid), own = this._own && this._own.k === key ? this._own.c : (HS.get('calendar.event_colors', {}) || {})[key];
        var kw = HS.keywordColor(ev.title), hue = (C.PALETTE && C.PALETTE.chart) || {};
        var cur = own || kw || HS.calendarColor(ev.cal, h.states);
        var why = own ? '<button class="auto" data-a="col" data-v="">Automatic</button>' : '<span class="n">' + esc(kw ? 'Matches a Keyword' : 'Same as ' + calName(h, ev.cal)) + '</span>';
        return '<div class="card colc"><div class="lab"><span>Color</span>' + why + '</div><div class="cols">' +
          ['red', 'orange', 'yellow', 'green', 'mint', 'teal', 'blue', 'purple', 'pink', 'white'].map(function (k) {
            var rgb = k === 'white' ? WHITE : hue[k] || [255, 159, 10];
            return '<button data-a="col" data-v="' + k + '" class="' + (k === cur ? 'on' : '') + '" aria-label="' + k + '" style="background:' + rgba(rgb, 1) + '"></button>';
          }).join('') + '</div></div>';
      }
      _setColor(color) {
        var h = this.client, ev = this._ev, HS = window.hkSettings, self = this;
        if (!h || !ev || !HS || !HS.eventKey) return;
        var key = HS.eventKey(ev.title, ev.uid), own = (HS.get('calendar.event_colors', {}) || {})[key];
        if (color && color === own) color = '';            // its own again: back to automatic
        this._own = { k: key, c: color || null };
        this._paint();
        writer(h).callWS({ type: 'hk_frontend/calendar/color', key: key, color: color || null }).catch(function (e) {
          console.warn('[hk-calendar] the color', e);
          self._own = null; self._paint();
        });
      }
      // THE DAY AS HOURS (a tablet): its all-day events across the top, the
      // rest as blocks in their hours, side by side where they overlap
      // (lanes(), the Calendar page's day), this one outlined, now a red line
      _hours(h, ev) {
        var list = this._day, a = this._at || day0(ev.start), b = addDays(a, 1), now = new Date(), PX = TL_PX;
        var isOn = function (e) { return !!ev && e.cal === ev.cal && +e.start === +ev.start && e.title === ev.title; };
        // (a short screen's narrower day: "Sat, Oct 24", whole, not "Saturday, October …")
        var brief = U.SHORT_MQ && window.matchMedia && window.matchMedia(U.SHORT_MQ).matches;
        var lab = '<div class="lab"><span>' + esc(brief ? DOW[a.getDay()].charAt(0) + DOW[a.getDay()].slice(1).toLowerCase() + ', ' + MON3[a.getMonth()] + ' ' + a.getDate()
                                                       : DOW_LONG[a.getDay()] + ', ' + MON[a.getMonth()] + ' ' + a.getDate()) + '</span>' +
          (list ? '<span class="n">' + list.length + (list.length === 1 ? ' event' : ' events') + '</span>' : '') + '</div>';
        if (!list) return '<div class="card tlc">' + lab + '<div class="empty" style="padding:0 18px">Loading…</div></div>';
        var long = function (e) { return e.allDay || (e.end - e.start) >= DAY_MS; };
        var alld = list.filter(long).map(function (e) {
          var rgb = evRgb(e, h);
          return '<button class="' + (isOn(e) ? 'on' : '') + '" data-k="' + esc(e.key) + '" style="' + eventStyle(rgb, 0.55) + '">' + esc(e.title) + '</button>';
        }).join('');
        var hrs = '';
        for (var hr = 1; hr < 24; hr++) hrs += '<div class="tlr" style="top:' + (hr * PX) + 'px"><span>' + hourLabel(hr) + '</span></div>';
        var items = list.filter(function (e) { return !long(e); })
          .map(function (e) { return { ev: e, s: e.start < a ? a : e.start, e: e.end > b ? b : e.end }; });
        var blocks = lanes(items).map(function (it) {
          var top = (it.s - a) / 3600000 * PX, ht = Math.max(22, (it.e - it.s) / 3600000 * PX - 3), w = 100 / it.cols;
          var rgb = evRgb(it.ev, h), past = it.ev.end <= now;
          return '<button class="tlb' + (past ? ' past' : '') + (isOn(it.ev) ? ' on' : '') + '" data-k="' + esc(it.ev.key) + '" style="top:' + (top + 1) +
            'px;height:' + ht + 'px;left:calc(' + (it.col * w) + '% + 2px);width:calc(' + w + '% - 4px);' + eventStyle(rgb, past ? 0.28 : 0.5) + edge(rgb) + '">' +
            '<div class="t1">' + esc(it.ev.title) + '</div>' + (ht > 36 ? '<div class="t2">' + esc(span(it.ev) + (it.ev.loc ? ' · ' + it.ev.loc : '')) + '</div>' : '') + '</button>';
        }).join('');
        var nowLine = sameDay(a, now) ? '<div class="tln" style="top:' + ((now - a) / 3600000 * PX) + 'px"></div>' : '';
        return '<div class="card tlc">' + lab + (alld ? '<div class="tlad">' + alld + '</div>' : '') +
          '<div class="tlw"><div class="tlh" style="height:' + (24 * PX) + 'px">' + hrs + '<div class="tlx">' + blocks + '</div>' + nowLine + '</div></div></div>';
      }
      _click(e) {
        var b = e.target.closest ? e.target.closest('[data-a], [data-k], [data-d]') : null;
        if (!b) return;
        var h = this.client, ev = this._ev;
        if (b.hasAttribute('data-d')) { this._pickDay(parseYmd(b.getAttribute('data-d'))); return; }
        if (b.hasAttribute('data-k')) {
          var k = b.getAttribute('data-k'), hit = (this._day || []).filter(function (x) { return x.key === k; })[0];
          if (hit) { this._ev = hit; this._paint(); }
          return;
        }
        var a = b.getAttribute('data-a');
        if (a === 'col') { this._setColor(b.getAttribute('data-v')); return; }
        if (a === 'edit') edit_(h, ev);
        else if (a === 'del') askDelete(h, ev, function () { X.close(); });
      }
    }
    customElements.define('hk-detail-event', EventPanel);
  });

  window.hkCalendar = {
    version: '1.0.0',
    ids: calIds, load: load, create: create, update: update, remove: remove, changed: changed,
    show: show, edit: edit_, newAt: newAt, close: closeSheet, askDelete: askDelete, fromAny: fromAny,
    // tests
    _: { failedLine: failedLine, bigTime: bigTime, longDay: longDay, norm: norm, onDay: onDay, ownDay: ownDay, lanes: lanes, bars: bars, payload: payload, isoLocal: isoLocal, ymd: ymd,
         weekStart: weekStart, setWeekStart: setWeekStart, dows: dows, addMonths: addMonths, span: span, soon: soon, tshort: tshort, store: store }
  };
  });
})();
