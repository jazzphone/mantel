// hk-calendar.js -- the Calendar page, its events, and the screensaver's
// calendar pane, CONSTRUCTED AND DRIVEN the way Lovelace drives them.
//
//   1. the date and layout helpers (what a day shows, side-by-side events,
//      all-day bars across a week, the messages that add and change events);
//   2. the page: it asks Home Assistant for the range it shows, one request
//      per calendar, draws the answer, moves through months and views, offers
//      New Event only where a calendar can take one, and keeps its gate;
//   3. adding, changing and deleting: the websocket messages, and every card
//      asking again afterwards;
//   4. the pane: today, tomorrow and the days after, the past dimmed;
//   5. the calendars and their colours (hkSettings.calendarIds / calendarColor).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
// fixtures at now ± hours: the clock is pinned to noon (fixed_clock.js)
load(HK_ROOT + '/tests/fixed_clock.js');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/tests/sample_settings.js');
load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-calendar.js');

var K = window.hkCalendar, U = K._;
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function at(d, h, m) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0); return x; }
var NOW = new Date(), TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()); }
// an event as the calendar API answers it
function timed(uid, title, s, e, extra) {
  return Object.assign({ uid: uid, summary: title, start: { dateTime: U.isoLocal(s) }, end: { dateTime: U.isoLocal(e) } }, extra || {});
}
function allDay(uid, title, s, e) { return { uid: uid, summary: title, start: { date: ymd(s) }, end: { date: ymd(e) } }; }
function lastHtml(card) { var w = card._root.__writes || []; return card._root.__html || (w.length ? w[w.length - 1] : '') || ''; }
// a click on an element carrying data-a / data-v
function tap(card, a, v) {
  var el = { getAttribute: function (k) { return k === 'data-a' ? a : k === 'data-v' ? (v == null ? null : v) : null; } };
  card._click({ composedPath: function () { return [el]; }, target: el });
}

function house() {
  return H.house({
    'calendar.home': ['off', { friendly_name: 'Home Calendar', supported_features: 7 }],
    'calendar.holidays': ['off', { friendly_name: 'Holidays', supported_features: 0 }],
    'sensor.unrelated': ['1', {}]
  });
}

H.run('CALENDAR', [
  function () {
    H.section('the helpers');
    var oct1 = new Date(2026, 9, 1), nov1 = new Date(2026, 10, 1);
    var hw = U.norm('calendar.home', allDay('a', 'Halloween', oct1, nov1));
    H.ok('an all-day event is all day', hw.allDay === true);
    H.eq('...its span names its last day', U.span(hw), 'All day · through Oct 31');
    H.eq('...one day long: just "All day"', U.span(U.norm('c', allDay('b', 'x', oct1, new Date(2026, 9, 2)))), 'All day');
    var ft = U.norm('calendar.home', timed('f', 'Furnace tune-up', at(oct1, 13), at(oct1, 14, 30), { location: 'Home' }));
    H.eq('a timed event keeps its times', [ft.start.getHours(), ft.end.getHours(), ft.end.getMinutes()], [13, 14, 30]);
    H.eq('...and its span', U.span(ft), '1:00 PM – 2:30 PM');
    H.eq('...and where', ft.loc, 'Home');
    H.ok('an event with no end gets an hour', (function () {
      var e = U.norm('c', { uid: 'n', summary: 'x', start: { dateTime: U.isoLocal(at(oct1, 9)) }, end: {} });
      return e.end - e.start === 3600000;
    })());
    H.eq('no title: Untitled', U.norm('c', { start: { date: '2026-10-01' }, end: { date: '2026-10-02' } }).title, 'Untitled');
    H.eq('the month grid’s short times', [U.tshort(at(oct1, 7)), U.tshort(at(oct1, 17, 30)), U.tshort(at(oct1, 0)), U.tshort(at(oct1, 12))],
         ['7a', '5:30p', '12a', '12p']);
    H.ok('isoLocal carries the offset', /^2026-10-01T13:00:00[+-]\d\d:\d\d$/.test(U.isoLocal(at(oct1, 13))), U.isoLocal(at(oct1, 13)));
    H.eq('a day’s events: the all-day first, then by time', U.onDay([ft, hw], oct1).map(function (e) { return e.title; }), ['Halloween', 'Furnace tune-up']);
    H.eq('...an event of another day is not there', U.onDay([ft], new Date(2026, 9, 2)).length, 0);
    H.eq('next month from the 31st: the last day of a shorter month', ymd(U.addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
    H.eq('the week starts on Sunday', ymd(U.weekStart(new Date(2026, 9, 1))), '2026-09-27');
    // the user's own first day (their Home Assistant profile), as the Energy page's weeks
    U.setWeekStart({ locale: { first_weekday: 'monday' } });
    H.eq('...or on Monday, when that is the user\'s first day: the week, and the month\'s day names', [ymd(U.weekStart(new Date(2026, 9, 1))), U.dows(['S', 'M', 'T', 'W', 'T', 'F', 'S']).join('')],
         ['2026-09-28', 'MTWTFSS']);
    U.setWeekStart({ locale: { first_weekday: 'language', language: 'en' } });
    H.eq('...and English\'s own is Sunday', ymd(U.weekStart(new Date(2026, 9, 1))), '2026-09-27');
    // side by side
    var L = U.lanes([{ s: at(oct1, 9), e: at(oct1, 11) }, { s: at(oct1, 10), e: at(oct1, 12) }, { s: at(oct1, 13), e: at(oct1, 14) }]);
    H.eq('two overlapping events share the width; the third has it alone', L.map(function (x) { return x.col + '/' + x.cols; }), ['0/2', '1/2', '0/1']);
    // bars across a week
    var B = U.bars([hw], new Date(2026, 8, 27), 7);
    H.eq('an all-day event starting Thursday: a bar Thursday to Saturday, going on', [B.list[0].a, B.list[0].b, B.list[0].more, B.lanes], [4, 6, true, 1]);
    var B2 = U.bars([hw, U.norm('c', allDay('z', 'Trip', new Date(2026, 9, 2), new Date(2026, 9, 4)))], new Date(2026, 8, 27), 7);
    H.eq('...an overlapping one takes the next lane', B2.list.map(function (b) { return b.lane; }), [0, 1]);
    // what goes to Home Assistant
    var p = U.payload({ title: 'Pumpkin carving', allDay: true, start: new Date(2026, 9, 24), end: new Date(2026, 9, 24), loc: 'Backyard' });
    H.eq('an all-day event: its last day plus one, as dates', [p.dtstart, p.dtend, p.location, p.summary], ['2026-10-24', '2026-10-25', 'Backyard', 'Pumpkin carving']);
    var p2 = U.payload({ title: 'x', allDay: false, start: at(oct1, 16), end: at(oct1, 17, 30), rrule: 'FREQ=WEEKLY' });
    H.ok('a timed one: local times with the offset', /T16:00:00[+-]/.test(p2.dtstart) && /T17:30:00[+-]/.test(p2.dtend), p2);
    H.eq('...the repeat goes too; empty notes do not', [p2.rrule, 'description' in p2], ['FREQ=WEEKLY', false]);
    // how soon
    var n = at(oct1, 12, 14);
    H.eq('in 46 minutes', U.soon(U.norm('c', timed('s', 'x', at(oct1, 13), at(oct1, 14))), n), 'in 46 min');
    H.eq('going on: Now', U.soon(U.norm('c', timed('s', 'x', at(oct1, 12), at(oct1, 13))), n), 'Now');
    H.eq('two hours off', U.soon(U.norm('c', timed('s', 'x', at(oct1, 14, 14), at(oct1, 15))), n), 'in 2 hr');
    H.eq('over three hours off: nothing', U.soon(U.norm('c', timed('s', 'x', at(oct1, 18), at(oct1, 19))), n), '');
  },

  function () {
    H.section('the page');
    var hs = house(), card = H.make('hk-calendar-card');
    card.setConfig({ type: 'custom:hk-calendar-card' });
    card.hass = hs.hass();
    H.eq('it asks once per calendar', hs.api.length, 2);
    H.ok('...for the month it shows', /^calendars\/calendar\.(home|holidays)\?start=.*&end=/.test(hs.api[0].path), hs.api[0].path);
    var from = U.weekStart(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1));
    H.ok('...from the Sunday before the 1st', hs.api[0].path.indexOf(encodeURIComponent(U.isoLocal(from))) > 0, hs.api[0].path);
    H.ok('New Event is offered (a calendar can take one)', lastHtml(card).indexOf('data-a="new"') >= 0);
    card.hass = hs.hass();
    H.eq('the same hass asks nothing more', hs.api.length, 2);
    var home = hs.api.filter(function (r) { return r.path.indexOf('calendar.home') >= 0; })[0];
    var hol = hs.api.filter(function (r) { return r.path.indexOf('calendar.holidays') >= 0; })[0];
    home.resolve([timed('f1', 'Furnace tune-up', at(TODAY, 13), at(TODAY, 14, 30), { location: 'Home' }),
                  timed('s1', 'Soccer practice', at(TODAY, 17, 30), at(TODAY, 19))]);
    hol.resolve([allDay('h1', 'Fall Festival', TODAY, addDays(TODAY, 1))]);
    return H.tick(8).then(function () {
      var html = lastHtml(card);
      H.ok('the answer is drawn', html.indexOf('Furnace tune-up') >= 0 && html.indexOf('Soccer practice') >= 0 && html.indexOf('Fall Festival') >= 0);
      H.ok('...today is marked', html.indexOf('cell') >= 0 && html.indexOf(' today') >= 0);
      H.ok('...the chosen day’s list shows its events', html.indexOf('class="panel side"') >= 0 && html.indexOf('data-a="addday"') >= 0);
      H.eq('the events are kept', card._evs.length, 3);
      // the gate
      H.gate('the page', card, hs, function () { return hs.set('calendar.home', 'on'); }, function () { return hs.set('sensor.unrelated', '2'); });
      // moving through months
      var n0 = hs.api.length, m0 = card._day.getMonth();
      tap(card, 'next');
      H.eq('Next: the next month', card._day.getMonth(), (m0 + 1) % 12);
      H.eq('...asked for', hs.api.length, n0 + 2);
      tap(card, 'today');
      H.ok('Today: back', card._day.getMonth() === m0 && card._day.getDate() === TODAY.getDate());
      tap(card, 'view', 'week');
      H.eq('Week', card._view, 'week');
      H.ok('...the week is drawn as hours', lastHtml(card).indexOf('class="tl"') >= 0 && lastHtml(card).indexOf('data-a="slot"') >= 0);
      tap(card, 'view', 'day');
      H.ok('Day: the hours, the little month and the event', lastHtml(card).indexOf('panel mini') >= 0 && lastHtml(card).indexOf('panel det') >= 0);
      tap(card, 'prev');
      H.eq('Previous in Day view: the day before', ymd(card._day), ymd(addDays(TODAY, -1)));
      tap(card, 'view', 'month');
      tap(card, 'day', ymd(addDays(TODAY, 0)));
      H.eq('a day tapped twice opens it', card._view, 'month');
      tap(card, 'day', ymd(TODAY));
      H.eq('...in Day view', card._view, 'day');
      return H.lifecycle('the page', card, hs);
    });
  },

  function () {
    H.section('a calendar that can only be read');
    var hs = H.house({ 'calendar.feed': ['off', { friendly_name: 'Feed', supported_features: 0 }] });
    var card = H.make('hk-calendar-card');
    card.setConfig({ type: 'custom:hk-calendar-card', view: 'week' });
    card.hass = hs.hass();
    H.eq('it starts in the view it was given', card._view, 'week');
    H.ok('no New Event', lastHtml(card).indexOf('data-a="new"') < 0);
    var before = hs.ws.length;
    tap(card, 'slot', ymd(TODAY) + 'T10');
    H.eq('an hour tapped opens nothing', hs.ws.length, before);
    var none = H.make('hk-calendar-card');
    none.setConfig({ type: 'custom:hk-calendar-card' });
    none.hass = H.house({}).hass();
    H.ok('no calendars: it says how to add one', lastHtml(none).indexOf('No calendars') >= 0);
  },

  function () {
    H.section('calendars that could not be read');
    var hs = H.house({ 'calendar.chores': ['off', { friendly_name: 'Chores', supported_features: 0 }],
                       'calendar.school': ['off', { friendly_name: 'School', supported_features: 0 }] });
    var card = H.make('hk-calendar-card');
    card.setConfig({ type: 'custom:hk-calendar-card' });
    card.hass = hs.hass();
    var measured = 0, measure = card._measure;
    card._measure = function () { measured++; return measure.apply(this, arguments); };
    function ask(id) { return hs.api.filter(function (r) { return r.path.indexOf(id + '?') >= 0; }).pop(); }
    // the second calendar's failure comes back first
    ask('calendar.school').reject({ code: 'failed', message: 'Home Assistant answered 500' });
    return H.tick(2).then(function () {
      ask('calendar.chores').reject({ code: 'failed', message: 'Home Assistant answered 500' });
      return H.tick(8);
    }).then(function () {
      H.ok('the line names them in the calendars’ order, whichever failed first',
           lastHtml(card).indexOf('Chores, School couldn’t be read.') >= 0, lastHtml(card).match(/class="warn">[^<]*/));
      H.eq('...and the panels are measured again as it comes (their bottom edge stays put)', measured, 1);
      card.hass = hs.hass();
      H.eq('...not again while it stays', measured, 1);
      H.eq('a calendar Home Assistant has as unavailable says so',
           U.failedLine({ states: { 'calendar.chores': { state: 'unavailable', attributes: { friendly_name: 'Chores' } } } }, ['calendar.chores']),
           'Chores is unavailable in Home Assistant.');
      var both = { states: { 'calendar.chores': { state: 'unavailable', attributes: { friendly_name: 'Chores' } },
                             'calendar.school': { state: 'unavailable', attributes: { friendly_name: 'School' } } } };
      H.eq('...two of them', U.failedLine(both, ['calendar.chores', 'calendar.school']), 'Chores, School are unavailable in Home Assistant.');
      both.states['calendar.school'].state = 'on';
      H.eq('...one that is on but failed: "couldn’t be read"', U.failedLine(both, ['calendar.chores', 'calendar.school']), 'Chores, School couldn’t be read.');
      // DRAWN BEFORE IT WAS PLACED: it guessed wide; placed in a narrow
      // column it takes the width and is drawn and measured before a frame
      var placed = H.make('hk-calendar-card');
      placed.setConfig({ type: 'custom:hk-calendar-card' });
      placed.hass = hs.hass();
      H.ok('drawn unplaced: the wide page (its width unknown)', lastHtml(placed).indexOf('class="wide"') >= 0);
      var m2 = 0, mf = placed._measure;
      placed._measure = function () { m2++; return mf.apply(this, arguments); };
      placed.clientWidth = 700;
      H.attach(placed);
      H.eq('placed: its width taken at once', placed._w, 700);
      H.ok('...drawn again for it (narrow) before the first frame', lastHtml(placed).indexOf('class="narrow"') >= 0, lastHtml(placed).slice(0, 40));
      H.ok('...and measured then too', m2 >= 1, m2);
      H.detach(placed);
    });
  },

  function () {
    H.section('adding, changing, deleting');
    var hs = house(), h = hs.hass(), page = H.make('hk-calendar-card');
    page.setConfig({ type: 'custom:hk-calendar-card' });
    page.hass = h;
    H.attach(page);
    var asked = hs.api.length, ver = U.store.ver;
    var f = { title: 'Pumpkin carving', allDay: false, start: at(TODAY, 16), end: at(TODAY, 17, 30), loc: 'Backyard' };
    var done = K.create(h, 'calendar.home', f);
    H.eq('create: calendar/event/create', [hs.ws[0].msg.type, hs.ws[0].msg.entity_id, hs.ws[0].msg.event.summary, hs.ws[0].msg.event.location],
         ['calendar/event/create', 'calendar.home', 'Pumpkin carving', 'Backyard']);
    hs.ws[0].resolve(null);
    return done.then(function () {
      H.eq('...and the store moves on', U.store.ver, ver + 1);
      H.ok('...and the page asks again', hs.api.length > asked);
      var ev = U.norm('calendar.home', timed('u1', 'Soccer practice', at(TODAY, 17, 30), at(TODAY, 19), { recurrence_id: '20261001T173000', rrule: 'FREQ=WEEKLY' }));
      var up = K.update(h, ev, { title: 'Soccer', allDay: false, start: ev.start, end: ev.end, rrule: 'FREQ=WEEKLY' }, 'THISANDFUTURE');
      var m = hs.ws[1].msg;
      H.eq('update: this and the ones after', [m.type, m.uid, m.recurrence_id, m.recurrence_range, m.event.summary],
           ['calendar/event/update', 'u1', '20261001T173000', 'THISANDFUTURE', 'Soccer']);
      hs.ws[1].resolve(null);
      return up.then(function () {
        var plain = U.norm('calendar.home', timed('u2', 'Dentist', at(TODAY, 15), at(TODAY, 16)));
        var rm = K.remove(h, plain, '');
        var m2 = hs.ws[2].msg;
        H.eq('delete: just the event', [m2.type, m2.uid, 'recurrence_id' in m2], ['calendar/event/delete', 'u2', false]);
        hs.ws[2].reject({ code: 'not_found', message: 'Event not found' });
        return rm.then(function () { H.ok('a refusal is an error', false); }, function (e) {
          H.eq('a refusal is an error, with its message', e.message, 'Event not found');
          H.detach(page);
        });
      });
    });
  },

  function () {
    H.section('the pane');
    var hs = house(), card = H.make('hk-calendar-pane-card');
    card.setConfig({ type: 'custom:hk-calendar-pane-card', days: 3 });
    card.hass = hs.hass();
    H.eq('it asks for its days', hs.api.length, 2);
    H.ok('...from today', hs.api[0].path.indexOf(encodeURIComponent(U.isoLocal(TODAY))) > 0, hs.api[0].path);
    var past = at(TODAY, 0, 5), soonS = new Date(+NOW + 30 * 60000);
    hs.api.filter(function (r) { return r.path.indexOf('calendar.home') >= 0; })[0].resolve([
      timed('p', 'Trash & recycling', past, new Date(+past + 10 * 60000)),
      timed('n', 'Furnace tune-up', soonS, new Date(+soonS + 3600000), { location: 'Home' })]);
    hs.api.filter(function (r) { return r.path.indexOf('calendar.holidays') >= 0; })[0].resolve([allDay('h', 'Fall Festival', addDays(TODAY, 1), addDays(TODAY, 2))]);
    return H.tick(8).then(function () {
      var html = lastHtml(card);
      H.ok('today, tomorrow and the day after', html.indexOf('TODAY') >= 0 && html.indexOf('TOMORROW') >= 0 &&
           html.split('class="day"').length - 1 === 3);
      H.ok('the past is dimmed', html.indexOf('ev past') >= 0);
      H.ok('the next one says how soon', /in \d+ min/.test(html), html.match(/class="soon">[^<]*/));
      H.ok('tomorrow’s all-day event', html.indexOf('Fall Festival') >= 0 && html.indexOf('All day') >= 0);
      H.ok('a day with nothing says so', html.indexOf('Nothing scheduled.') >= 0);
      H.gate('the pane', card, hs, function () { return hs.set('calendar.holidays', 'on'); }, function () { return hs.set('sensor.unrelated', '3'); });
      return H.lifecycle('the pane', card, hs);
    });
  },

  function () {
    H.section('which calendars, and their colours');
    var HS = window.hkSettings, st = house().hass().states;
    H.eq('none chosen: every calendar, A to Z', HS.calendarIds(st), ['calendar.holidays', 'calendar.home']);
    H.eq('...coloured in turn', [HS.calendarColor('calendar.holidays', st), HS.calendarColor('calendar.home', st)], ['orange', 'green']);
    var s = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS));
    s.calendar = { entities: ['calendar.home', 'calendar.gone'], colors: { 'calendar.home': 'blue' } };
    HS._apply(s);
    H.eq('chosen: only those, in order, that exist', HS.calendarIds(st), ['calendar.home']);
    H.eq('...each with its own colour', HS.calendarColor('calendar.home', st), 'blue');
    HS._apply(HK_SAMPLE_SETTINGS);
    H.eq('the screensaver’s defaults carry the pane, off, for two days', [HS.DEFAULTS.look.saver.calendar, HS.DEFAULTS.look.saver.calendar_days], [false, 2]);
  },
  // THE EVENT SHEET (hk-detail kind `event`): the event from wherever it came
  function () {
    var h = { states: { 'calendar.family': { state: 'on', attributes: { message: 'Soccer', start_time: '2026-10-12 12:15:00',
      end_time: '2026-10-12 13:45:00', location: 'City Park', description: '' } } } };
    // a notification's (the house's words for it)
    var ev = K.fromAny(h, 'calendar.family', { cal: 'calendar.family', summary: 'Soccer', start: '2026-10-12T12:15:00-04:00',
                                                 end: '2026-10-12T13:45:00-04:00', location: 'City Park' });
    H.eq('a notification’s event: its name, timed', [ev.title, ev.allDay, ev.loc, ev.cal], ['Soccer', false, 'City Park', 'calendar.family']);
    H.eq('...its start a moment', +ev.start, Date.parse('2026-10-12T12:15:00-04:00'));
    // a calendar's tile: its own event, going on or next
    var tile = K.fromAny(h, 'calendar.family', null);
    H.eq('a calendar’s own (its tile)', [tile.title, tile.start.getHours(), tile.start.getMinutes(), tile.end.getHours()], ['Soccer', 12, 15, 13]);
    var all = K.fromAny(h, 'calendar.family', { summary: 'Columbus Day', start: '2026-10-12', end: '2026-10-13' });
    H.eq('an all-day one', [all.allDay, all.start.getDate(), all.end.getDate()], [true, 12, 13]);
    H.eq('no event at all', K.fromAny({ states: { 'calendar.work': { state: 'off', attributes: {} } } }, 'calendar.work', null), null);
    // the time, big: one AM / PM when both share it
    H.eq('12:15 – 1:45 PM', U.bigTime({ allDay: false, start: at(TODAY, 12, 15), end: at(TODAY, 13, 45) }), '12:15 – 1:45 PM');
    H.eq('9:00 AM – 1:00 PM', U.bigTime({ allDay: false, start: at(TODAY, 9), end: at(TODAY, 13) }), '9:00 AM – 1:00 PM');
    H.eq('All Day', U.bigTime({ allDay: true, start: TODAY, end: addDays(TODAY, 1) }), 'All Day');
    H.ok('its day: Today first', U.longDay(TODAY).indexOf('Today · ') === 0 && U.longDay(addDays(TODAY, 1)).indexOf('Tomorrow · ') === 0);
  }
]);
