// hk-calendar-data.js - dates, the calendars and their colors, events and their reads and writes, and the icons.
//
// PART OF THE CALENDAR CARDS (hk-calendar.js). Not a card and not run on its own: it registers one
// function, which hk-calendar.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkCalendarParts = window.hkCalendarParts || {})['hk-calendar-data'] = function (K) {
    var C = K.C;

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
      clock:
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path ' +
        'd="M12 7v5l3 2"/></svg>',
      pin:
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 ' +
        '19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
      notes:
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14M5 11h14M5 16h9"/></svg>',
      repeat:
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l3 3-3 3"/><path d="M4 ' +
        '11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>'
    };

    // what the shell and the later parts use of this one
    K.addDays = addDays; K.addMonths = addMonths; K.bars = bars; K.CAL_RED = CAL_RED; K.calIds = calIds;
    K.calName = calName; K.can = can; K.changed = changed; K.colorSig = colorSig; K.create = create; K.day0 = day0;
    K.DAY_MS = DAY_MS; K.DOW = DOW; K.DOW_LONG = DOW_LONG; K.dows = dows; K.edge = edge; K.eventStyle = eventStyle;
    K.evRgb = evRgb; K.failedLine = failedLine; K.FLAT_EVENT_CSS = FLAT_EVENT_CSS; K.hm = hm; K.hourLabel = hourLabel;
    K.IC = IC; K.isoLocal = isoLocal; K.lanes = lanes; K.load = load; K.MON = MON; K.MON3 = MON3; K.norm = norm;
    K.onDay = onDay; K.ownDay = ownDay; K.parseYmd = parseYmd; K.payload = payload; K.remove = remove; K.rgba = rgba;
    K.rgbOf = rgbOf; K.sameDay = sameDay; K.setWeekStart = setWeekStart; K.soon = soon; K.span = span;
    K.store = store; K.time = time; K.tshort = tshort; K.update = update; K.weekStart = weekStart; K.WHITE = WHITE;
    K.writable = writable; K.writer = writer; K.ymd = ymd;
  };
})();
