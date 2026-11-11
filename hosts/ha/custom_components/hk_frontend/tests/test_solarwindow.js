// HOME GRID'S SOLAR WINDOW (2026-11-10; hk-grid-catalog.js solar, home_grid.py solar_endpoint): Show When from one
// endpoint until the next, each a clock time in the house's zone or sunrise / sunset with a signed offset in minutes,
// read from Home Assistant's sun.sun. A Los Angeles house: daylight saving ends 2026-11-01 and starts 2026-03-08.
// Every instant here is UTC; the sun's times are near the real ones for Los Angeles.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run solarwindow');
if (typeof window === 'undefined') globalThis.window = globalThis;
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

var G = window.hkGridCatalog, S = G.solar, ZONE = 'America/Los_Angeles';
var realLocale = window.hkLocale;
window.hkLocale = Object.assign({}, realLocale || {}, { zone: function () { return ZONE; } });
function at(s) { return Date.parse(s); }
function iso(ms) { return ms == null ? null : new Date(ms).toISOString().replace('.000', ''); }
function sun(state, rising, setting) {
  return { 'sun.sun': { state: state, attributes: { next_rising: rising, next_setting: setting } } };
}
function on(c, st, t) { return S.spans(c, st, at(t)).on; }
function next(c, st, t) { return iso(S.spans(c, st, at(t)).next); }

var EVENING = { kind: 'solar_window', from: { sun: 'sunset', offset: -15 }, to: { at: '22:00' } };
var MORNING = { kind: 'solar_window', from: { sun: 'sunrise', offset: -60 }, to: { sun: 'sunrise', offset: 30 } };

// ---- the evening: from 15 minutes before sunset until 10 PM (2026-11-10: sunset 4:56 PM PST, 00:56Z on the 11th)
(function () {
  S.forget();
  var day = sun('above_horizon', '2026-11-11T14:39:00+00:00', '2026-11-11T00:56:00+00:00');
  ok('evening: 4:40 PM is before the window', on(EVENING, day, '2026-11-11T00:40:00Z') === false);
  ok('...its next edge is 4:41 PM', next(EVENING, day, '2026-11-11T00:40:00Z') === '2026-11-11T00:41:00Z', next(EVENING, day, '2026-11-11T00:40:00Z'));
  ok('...4:41 PM it opens', on(EVENING, day, '2026-11-11T00:41:00Z') === true);
  ok('...open, its next edge is 10 PM', next(EVENING, day, '2026-11-11T00:41:00Z') === '2026-11-11T06:00:00Z');
  // the sun sets: Home Assistant's next_setting is tomorrow's now
  var night = sun('below_horizon', '2026-11-11T14:39:00+00:00', '2026-11-12T00:55:00+00:00');
  ok('after sunset (next_setting rolled to tomorrow): still open at 8 PM', on(EVENING, night, '2026-11-11T04:00:00Z') === true);
  ok('...today\'s sunset is the one the page saw, not tomorrow\'s less a day',
     iso(S.spans(EVENING, night, at('2026-11-11T04:00:00Z')).spans.filter(function (s) { return s[0] <= at('2026-11-11T04:00:00Z') && at('2026-11-11T04:00:00Z') < s[1]; })[0][0]) ===
       '2026-11-11T00:41:00Z');
  ok('...9:59 PM open, 10 PM closed', on(EVENING, night, '2026-11-11T05:59:00Z') === true && on(EVENING, night, '2026-11-11T06:00:00Z') === false);
  ok('...closed, its next edge is tomorrow\'s 4:40 PM (tomorrow\'s sunset less 15)', next(EVENING, night, '2026-11-11T06:30:00Z') === '2026-11-12T00:40:00Z',
     next(EVENING, night, '2026-11-11T06:30:00Z'));
  // a page opened after sunset never saw today's next_setting: tomorrow's, a day back
  S.forget();
  ok('a page opened after sunset: open at 8 PM all the same', on(EVENING, night, '2026-11-11T04:00:00Z') === true);
  var spans = S.spans(EVENING, night, at('2026-11-11T04:00:00Z')).spans;
  ok('...today\'s window from tomorrow\'s sunset, a day back (4:40 PM)', spans.some(function (s) { return iso(s[0]) === '2026-11-11T00:40:00Z' && iso(s[1]) === '2026-11-11T06:00:00Z'; }),
     spans.map(function (s) { return s.map(iso); }));
  ok('...and before 4:40 PM tomorrow it is shut', on(EVENING, night, '2026-11-11T14:00:00Z') === false);
})();

// ---- the morning: from an hour before sunrise until half an hour after it (2026-11-10: sunrise 6:38 AM, 14:38Z)
(function () {
  S.forget();
  var dark = sun('below_horizon', '2026-11-10T14:38:00+00:00', '2026-11-11T00:56:00+00:00');
  ok('morning: 5:37 AM shut, 5:38 AM open', on(MORNING, dark, '2026-11-10T13:37:00Z') === false && on(MORNING, dark, '2026-11-10T13:38:00Z') === true);
  ok('...its next edge open is 7:08 AM', next(MORNING, dark, '2026-11-10T13:38:00Z') === '2026-11-10T15:08:00Z');
  // the sun rises: next_rising is tomorrow's
  var up = sun('above_horizon', '2026-11-11T14:39:00+00:00', '2026-11-11T00:56:00+00:00');
  ok('after sunrise (next_rising rolled): open at 7:00 AM, shut at 7:08 AM', on(MORNING, up, '2026-11-10T15:00:00Z') === true && on(MORNING, up, '2026-11-10T15:08:00Z') === false);
  ok('...the next is tomorrow\'s, an hour before tomorrow\'s sunrise', next(MORNING, up, '2026-11-10T15:10:00Z') === '2026-11-11T13:39:00Z', next(MORNING, up, '2026-11-10T15:10:00Z'));
  S.forget();
  ok('a page opened after sunrise: open at 7:05 AM (tomorrow\'s sunrise a day back: until 7:09)', on(MORNING, up, '2026-11-10T15:05:00Z') === true &&
     on(MORNING, up, '2026-11-10T15:09:00Z') === false);
})();

// ---- midnight
(function () {
  S.forget();
  var night = sun('below_horizon', '2026-11-11T14:39:00+00:00', '2026-11-11T00:56:00+00:00');
  var LATE = { kind: 'solar_window', from: { sun: 'sunset', offset: 0 }, to: { at: '01:00' } };
  ok('sunset until 1 AM: open at 12:30 AM (opened the evening before)', on(LATE, night, '2026-11-11T08:30:00Z') === true);
  ok('...shut at 1 AM', on(LATE, night, '2026-11-11T09:00:00Z') === false);
  var DAWN = { kind: 'solar_window', from: { at: '22:00' }, to: { sun: 'sunrise', offset: -60 } };
  ok('10 PM until an hour before sunrise: open at 3 AM', on(DAWN, night, '2026-11-11T11:00:00Z') === true);
  ok('...open at 5:38 AM, shut at 5:39 AM', on(DAWN, night, '2026-11-11T13:38:00Z') === true && on(DAWN, night, '2026-11-11T13:39:00Z') === false);
  ok('...shut at noon', on(DAWN, night, '2026-11-11T20:00:00Z') === false);
  var CLOCK = { kind: 'solar_window', from: { at: '23:30' }, to: { at: '00:30' } };
  ok('two times, past midnight, no sun needed', on(CLOCK, {}, '2026-11-11T08:00:00Z') === true && on(CLOCK, {}, '2026-11-11T08:30:00Z') === false);
})();

// ---- daylight saving
(function () {
  S.forget();
  // ends 2026-11-01 at 2 AM PDT. Sunset on Oct 31 6:04 PM PDT (01:04Z Nov 1); on Nov 1 5:03 PM PST (01:03Z Nov 2)
  var oct31 = sun('above_horizon', '2026-11-01T14:29:00+00:00', '2026-11-01T01:04:00+00:00');
  ok('fall back: Oct 31 opens 5:49 PM PDT and closes 10 PM PDT (05:00Z)', iso(S.spans(EVENING, oct31, at('2026-11-01T00:40:00Z')).next) === '2026-11-01T00:49:00Z' &&
     on(EVENING, oct31, '2026-11-01T04:59:00Z') === true && on(EVENING, oct31, '2026-11-01T05:00:00Z') === false);
  var nov1 = sun('below_horizon', '2026-11-01T14:29:00+00:00', '2026-11-02T01:03:00+00:00');
  ok('...Nov 1 closes at 10 PM PST (06:00Z), an hour later in UTC', on(EVENING, nov1, '2026-11-02T05:59:00Z') === true && on(EVENING, nov1, '2026-11-02T06:00:00Z') === false);
  ok('...Nov 1\'s window opens at 4:48 PM PST', S.spans(EVENING, nov1, at('2026-11-02T02:00:00Z')).spans.some(function (s) { return iso(s[0]) === '2026-11-02T00:48:00Z'; }));
  var REPEAT = { kind: 'solar_window', from: { at: '01:30' }, to: { at: '03:00' } };
  ok('...1:30 AM, which comes twice, opens at the first (08:30Z)', on(REPEAT, {}, '2026-11-01T08:29:00Z') === false && on(REPEAT, {}, '2026-11-01T08:30:00Z') === true);
  ok('...and stays open through the second 1:30 until 3 AM PST (11:00Z)', on(REPEAT, {}, '2026-11-01T09:30:00Z') === true && on(REPEAT, {}, '2026-11-01T11:00:00Z') === false);
  // starts 2026-03-08 at 2 AM PST: sunrise Mar 8 7:20 AM PDT (14:20Z)
  var mar8 = sun('below_horizon', '2026-03-08T14:20:00+00:00', '2026-03-09T02:05:00+00:00');
  ok('spring forward: the morning opens at 6:20 AM PDT (13:20Z)', on(MORNING, mar8, '2026-03-08T13:19:00Z') === false && on(MORNING, mar8, '2026-03-08T13:20:00Z') === true);
  var GAP = { kind: 'solar_window', from: { at: '02:30' }, to: { at: '04:00' } };
  ok('...2:30 AM, which never comes, opens at 3:30 AM PDT (10:30Z)', on(GAP, {}, '2026-03-08T10:29:00Z') === false && on(GAP, {}, '2026-03-08T10:30:00Z') === true);
  ok('...and closes at 4 AM PDT (11:00Z)', on(GAP, {}, '2026-03-08T11:00:00Z') === false);
  ok('...10 PM on Mar 8 is PDT\'s (05:00Z Mar 9): a fixed time keeps the wall clock', S.atWall(S.dayOf(at('2026-03-08T12:00:00Z'), ZONE), 22 * 60, ZONE) === at('2026-03-09T05:00:00Z'));
})();

// ---- no sun to read
(function () {
  S.forget();
  ok('no sun.sun: can\'t be judged', S.spans(EVENING, {}, at('2026-11-11T04:00:00Z')).on === null);
  ok('...and the condition does not hold', G.matches(EVENING, {}) === false);
  ok('sun.sun unavailable: can\'t be judged', S.spans(EVENING, { 'sun.sun': { state: 'unavailable', attributes: {} } }, at('2026-11-11T04:00:00Z')).on === null);
  ok('next_setting missing', S.spans(EVENING, sun('below_horizon', '2026-11-11T14:39:00Z', undefined), at('2026-11-11T04:00:00Z')).on === null);
  ok('next_setting unreadable', S.spans(EVENING, sun('below_horizon', '2026-11-11T14:39:00Z', 'soon'), at('2026-11-11T04:00:00Z')).on === null);
  ok('a sunset ten days off (a polar summer): can\'t be judged', S.spans(EVENING, sun('above_horizon', '2026-11-11T14:39:00Z', '2026-11-21T00:56:00Z'), at('2026-11-11T04:00:00Z')).on === null);
  ok('the morning needs only sunrise: no next_setting is fine', S.spans(MORNING, sun('below_horizon', '2026-11-10T14:38:00Z', undefined), at('2026-11-10T14:00:00Z')).on === true);
  ok('a window with no from', S.spans({ kind: 'solar_window', to: { at: '22:00' } }, {}, at('2026-11-11T04:00:00Z')).on === null);
  ok('an offset past six hours', S.spans({ kind: 'solar_window', from: { sun: 'sunset', offset: 400 }, to: { at: '22:00' } },
     sun('below_horizon', '2026-11-11T14:39:00Z', '2026-11-11T00:56:00Z'), at('2026-11-11T04:00:00Z')).on === null);
  ok('the same endpoint twice never opens', S.spans({ kind: 'solar_window', from: { at: '22:00' }, to: { at: '22:00' } }, {}, at('2026-11-11T06:00:00Z')).on === null);
})();

// ---- rules: first match wins, and a window that can't be judged falls through
(function () {
  S.forget();
  var block = { id: 'b', card: 'calendar', size: 'L', at: [0, 0], rules: [
    { when: { all: [EVENING] }, card: 'security' },
    { when: { all: [{ kind: 'music_playing' }] }, card: 'now_playing' }] };
  var music = { 'media_player.den': { state: 'playing' } };
  var dusk = Object.assign({}, music, sun('below_horizon', '2026-11-11T14:39:00Z', '2026-11-11T00:56:00Z'));
  ok('in the window: the Solar Window rule, the first', G.choose(block, dusk, false, null, new Date(at('2026-11-11T02:00:00Z'))) === 0);
  ok('outside it: the next rule that holds', G.choose(block, dusk, false, null, new Date(at('2026-11-11T07:00:00Z'))) === 1);
  ok('no sun.sun: the next rule that holds', G.choose(block, music, false, null, new Date(at('2026-11-11T02:00:00Z'))) === 1);
  ok('no sun.sun and nothing else: the default', G.choose(block, {}, false, null, new Date(at('2026-11-11T02:00:00Z'))) === -1);
  var both = { id: 'c', card: 'calendar', size: 'L', at: [0, 0], rules: [{ when: { all: [EVENING, { kind: 'alarm_armed' }] }, card: 'security' }] };
  ok('with All: each must hold', G.choose(both, Object.assign({ 'alarm_control_panel.home': { state: 'disarmed' } }, dusk), false, null, new Date(at('2026-11-11T02:00:00Z'))) === -1 &&
     G.choose(both, Object.assign({ 'alarm_control_panel.home': { state: 'armed_away' } }, dusk), false, null, new Date(at('2026-11-11T02:00:00Z'))) === 0);
  ok('After Sunset is as it was: the sun below the horizon', G.matches({ kind: 'after_sunset' }, dusk) === true &&
     G.matches({ kind: 'after_sunset' }, sun('above_horizon', 'x', 'y')) === false);
  ok('A Time of Day takes a Date too (the house\'s clock)', G.matches({ kind: 'time', from: '16:00', to: '17:00' }, {}, false, null, new Date(at('2026-11-11T00:30:00Z'))) === true);
  // the block's timer: the soonest edge of its time and solar conditions
  var timed = { id: 'd', card: 'calendar', size: 'L', at: [0, 0], rules: [
    { when: { all: [EVENING] }, card: 'security' }, { when: { all: [{ kind: 'time', from: '16:45', to: '18:00' }] }, card: 'weather' }] };
  ok('nextChange: the soonest edge of any rule (4:41 PM before 4:45 PM)', iso(G.nextChange(timed, dusk, at('2026-11-11T00:30:00Z'))) === '2026-11-11T00:41:00Z',
     iso(G.nextChange(timed, dusk, at('2026-11-11T00:30:00Z'))));
  ok('...then the time window\'s (4:45 PM)', iso(G.nextChange(timed, dusk, at('2026-11-11T00:42:00Z'))) === '2026-11-11T00:45:00Z');
  ok('...a block with neither has none', G.nextChange(block.rules[1] && { rules: [block.rules[1]] }, dusk, at('2026-11-11T00:42:00Z')) === null);
  ok('...nor a window without the sun', G.nextChange({ rules: [{ when: { all: [EVENING] }, card: 'x' }] }, {}, at('2026-11-11T00:42:00Z')) === null);
})();

window.hkLocale = realLocale;
print(fail ? 'FAIL ' + fail + ' SOLAR WINDOW TESTS' : 'ALL ' + pass + ' SOLAR WINDOW TESTS PASS');
