// hk-calendar-event.js - the event panel's helpers.
//
// PART OF THE CALENDAR CARDS (hk-calendar.js). Not a card and not run on its own: it registers one
// function, which hk-calendar.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkCalendarParts = window.hkCalendarParts || {})['hk-calendar-event'] = function (K) {
    var addDays = K.addDays, day0 = K.day0, DOW_LONG = K.DOW_LONG, MON = K.MON, parseYmd = K.parseYmd,
        sameDay = K.sameDay, time = K.time;

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

    // what the shell and the later parts use of this one
    K.bigTime = bigTime; K.fromAny = fromAny; K.howLong = howLong; K.longDay = longDay; K.whenDetail = whenDetail;
  };
})();
