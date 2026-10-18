// hk-saver-weather.js (2026-10-14): the screensaver's Weather -- its words
// and numbers from a weather entity and its forecast (window.hkSaverWeather._.view)
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-header.js');
load(HK_ROOT + '/frontend/modules/hk-saver-weather.js');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
var V = window.hkSaverWeather._.view, NOW = Date.UTC(2026, 9, 14, 18, 15);    // 2:15 PM EDT
function hrs(list) { return list.map(function (x, i) { return { datetime: new Date(NOW + (i + 1) * 36e5).toISOString(), condition: x[0], temperature: x[1], precipitation_probability: x[2] }; }); }
function days(list) { return list.map(function (x, i) { return { datetime: new Date(NOW + i * 864e5).toISOString(), condition: x[0], temperature: x[1], templow: x[2], precipitation_probability: x[3] }; }); }
var sunny = { state: 'sunny', attributes: { temperature: 85, wind_speed: 6, wind_gust_speed: 12, wind_bearing: 225, wind_speed_unit: 'mph' } };
var H1 = hrs([['sunny', 86, 0], ['sunny', 88, 0], ['sunny', 86, 0], ['sunny', 82, 0], ['clear-night', 75, 0], ['clear-night', 71, 0]]);
var D1 = days([['sunny', 88, 58, 0], ['sunny', 81, 62, 0], ['partlycloudy', 64, 50, 10], ['rainy', 58, 46, 70]]);
var v = V(sunny, H1, D1, NOW, []);
ok('the temperature, today\'s high and low', v.t === 85 && v.hi === 88 && v.lo === 58, v);
ok('a dry day: the high, when, and tonight\'s low', /high of <em>88°<\/em> around/.test(v.lede) && /Tonight, 58°/.test(v.lede), v.lede);
ok('three readings: Temperature, Rain, Wind', v.stats.map(function (s) { return s[0]; }).join() === 'temp,rain,wind', v.stats);
ok('...rain: dry until the first wet day', v.stats[1][3] === 'Dry until ' + new Date(D1[3].datetime).toLocaleDateString('en-US', { weekday: 'long' }), v.stats[1]);
ok('...wind: from the southwest, gusts 12', v.stats[2][3] === 'From the southwest, gusts 12', v.stats[2]);
ok('five hours and three days along the bottom', v.hours.length === 5 && v.days.length === 3, [v.hours.length, v.days.length]);
var rainy = { state: 'rainy', attributes: { temperature: 61, wind_speed: 14, wind_bearing: 90 } };
var H2 = hrs([['rainy', 61, 90], ['rainy', 60, 85], ['pouring', 59, 95], ['cloudy', 58, 20], ['cloudy', 56, 10]]);
v = V(rainy, H2, days([['rainy', 63, 52, 90], ['sunny', 70, 52, 0]]), NOW, []);
ok('raining: until about the first dry hour', /^Drying out around /.test(v.head), v.lede);
ok('...its chance today', v.stats[1][0] === 'rain' && v.stats[1][2].indexOf('95') === 0, v.stats[1]);
var snowy = { state: 'snowy', attributes: { temperature: 29, wind_speed: 2 } };
v = V(snowy, [], days([['snowy', 31, 22, 80]]), NOW, []);
ok('snowing: the reading says Snow', v.stats[1][1] === 'Snow', v.stats[1]);
ok('...calm wind says so', /^Calm/.test(v.stats[2][3]), v.stats[2]);
ok('...no forecast hours: none along the bottom', v.hours.length === 0);
v = V({ state: 'partlycloudy', attributes: { temperature: 72, wind_speed: 9 } }, hrs([['partlycloudy', 73, 10], ['rainy', 70, 60]]), D1, NOW, []);
ok('wet later: likely around that hour', /^Rain around /.test(v.head), v.lede);
v = V(sunny, H1, D1, NOW, ['rain', 'wind', 'hours', 'days']);
ok('Weather Options leaves out Rain, Wind, the hours and the days', v.stats.length === 1 && !v.hours.length && !v.days.length, v);
v = V({ state: 'clear-night', attributes: { temperature: 58 } }, [], days([['sunny', 88, 52, 0]]), NOW, []);
ok('a clear night: Clear Tonight, down to the low by dawn', v.head === 'Clear Tonight' && /Down to 52° by dawn/.test(v.lede), v);
ok('the wind\'s direction, eight ways', window.hkSaverWeather._.dirOf(0) === 'north' && window.hkSaverWeather._.dirOf(225) === 'southwest' &&
   window.hkSaverWeather._.dirOf(350) === 'north' && window.hkSaverWeather._.dirOf(null) === '');

v = V(sunny, H1, D1, NOW, []);
ok('the first upcoming hour is retained', v.hours[0] === H1[0]);
ok('dry hourly forecast stays uncluttered', !v.showPop);
v = V(sunny, hrs([['rainy', 72, 70], ['cloudy', 70, null]]), D1, NOW, []);
ok('rain probabilities shown for relevant hours', v.showPop && /^Rain around /.test(v.head), v);
ok('missing probability stays missing in the source', v.hours[1].precipitation_probability === null);
ok('no duplicate rain-arrival sentence below headline', v.lede.indexOf('Rain likely') < 0, v.lede);
v = V(sunny, H2, D1, NOW, ['rain']);
ok('hidden Rain also hides hourly probabilities', !v.showPop);
v = V(rainy, [{datetime:new Date(NOW+36e5).toISOString(),temperature:60}], D1, NOW, []);
ok('incomplete forecast cannot promise drying out', v.head.indexOf('Drying out') < 0, v.head);
var windy = hrs([['sunny', 86, 0], ['sunny', 88, 0]]); windy[1].wind_speed = 20;
v = V(sunny, windy, D1, NOW, []);
ok('next meaningful wind increase headlines a dry forecast', /^Wind picks up around /.test(v.head), v.head);
v = V(sunny, [], [], NOW, []);
ok('without forecasts current condition remains useful', v.head === 'Sunny' && !v.hours.length && !v.showPop, v);

// Alert selection is independent of the weather/forecast renderer.
var A = window.hkSaverWeather._.alertsOf;
function alert(overrides) { return Object.assign({ Event: 'Severe Thunderstorm Warning', Severity: 'Severe', Status: 'Actual',
  Effective: new Date(NOW - 1000).toISOString(), Expires: new Date(NOW + 3600e3).toISOString(),
  Instruction: 'Move indoors. Stay away from windows.', Description: 'Sample full alert.' }, overrides || {}); }
function sensor(rows, state) { return { state: state == null ? String(rows.length) : state, attributes: { Alerts: rows } }; }
ok('no configured sensor: no banner', A(null, NOW).length === 0);
ok('zero count suppresses a stale alert list', A(sensor([alert()], '0'), NOW).length === 0);
ok('unavailable sensor: no stale warning', A(sensor([alert()], 'unavailable'), NOW).length === 0);
var al = A(sensor([alert()]), NOW);
ok('active warning preserves source wording and full instructions', al.length === 1 && al[0].title === 'Severe Thunderstorm Warning' &&
  al[0].brief === 'Move indoors.' && al[0].instruction === 'Move indoors. Stay away from windows.' && al[0].description === 'Sample full alert.', al);
ok('expired alert disappears without a new sensor state', A(sensor([alert({ Expires: new Date(NOW).toISOString() })]), NOW).length === 0);
ok('Ends takes precedence over a later Expires', A(sensor([alert({ Ends: new Date(NOW - 1).toISOString() })]), NOW).length === 0);
ok('invalid Ends falls back to Expires', A(sensor([alert({ Ends: 'invalid', Expires: new Date(NOW - 1).toISOString() })]), NOW).length === 0);
ok('message expiration wins over a later event end', A(sensor([alert({ Ends: new Date(NOW + 1000).toISOString(), Expires: new Date(NOW - 1).toISOString() })]), NOW).length === 0);
ok('future Effective does not show prematurely', A(sensor([alert({ Effective: new Date(NOW + 1).toISOString() })]), NOW).length === 0);
ok('future Onset is still an active issued alert', A(sensor([alert({ Onset: new Date(NOW + 1000).toISOString() })]), NOW).length === 1);
ok('cancellations and test messages are excluded', A(sensor([alert({ MessageType: 'Cancel' }), alert({ Status: 'Test' })]), NOW).length === 0);
al = A(sensor([alert({ Severity: 'Minor' }), alert({ Event: 'Tornado Warning', Severity: 'Extreme' }), alert({ Severity: 'Moderate' })]), NOW);
ok('most severe first, remaining alerts retained', al.length === 3 && al[0].title === 'Tornado Warning' && al[2].severity === 'Minor', al);
ok('invalid or absent end time keeps an active source alert', A(sensor([alert({ Expires: 'invalid' })]), NOW)[0].end === null);
ok('missing instructions use source headline', A(sensor([alert({ Instruction: '', Headline: 'Warning issued for Springfield.' })]), NOW)[0].brief === 'Warning issued for Springfield.');
ok('malformed alert lists are ignored', A({ state: '1', attributes: { Alerts: {} } }, NOW).length === 0);
var long = A(sensor([alert({ Instruction: Array(60).join('Instruction ') })]), NOW)[0];
ok('long banner summary is bounded, full instruction retained', long.brief.length <= 140 && long.instruction.length > 140);

print(fail ? 'FAIL ' + fail + ' SAVER WEATHER TESTS' : 'ALL ' + pass + ' SAVER WEATHER TESTS PASS');
if (fail) throw new Error(fail + ' failed');
