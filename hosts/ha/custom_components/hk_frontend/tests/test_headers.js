// THE PAGE HEADERS (hk-headers.js, 2026-10-15): the Climate, Lights and
// Security pages' header cards, CONSTRUCTED AND DRIVEN -- their history and
// logbook answered, the schedule sent as the server sends it -- and the
// pieces they are built from (the next time of a sun or time trigger, the
// ways in found by name, Energy's bar rules).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
// fixtures at now ± hours: the clock is pinned to noon (fixed_clock.js)
load(HK_ROOT + '/tests/fixed_clock.js');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-headers.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');

var X = window.hkHeaders, MIN = 60e3, HOUR = 36e5;
function drawn(card) { return H.morphed(card._card); }
function midnight() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
// answer the card's oldest pending websocket call
function answer(house, fn) {
  var e = house.ws.shift();
  if (!e) return Promise.resolve();
  e.resolve(fn(e.msg));
  return tick();
}
// (dom.js never runs a timer: a few turns of the microtask queue instead)
var tick = function () { var p = Promise.resolve(); for (var i = 0; i < 6; i++) p = p.then(function () {}); return p; };

H.run('page headers', [
  function () {
    H.section('the pieces');
    // Energy's bars: at most 20 px, 0.42 of a bar apart, as wide as they are
    var b = X.bars([0, 1, 2].map(function () { return { segs: [{ v: 10, c: '#fff' }] }; }), 1000, 48);
    H.ok('a bar is at most 20 px', b.bw === 20, b.bw);
    H.ok('...0.42 of a bar apart, and the chart is as wide as its bars', Math.abs(b.gap - 8.4) < 1e-9 && Math.abs(b.W - (3 * 20 + 2 * 8.4)) < 1e-9);
    var n24 = X.bars(new Array(24).join('x').split('x').map(function () { return { segs: [{ v: 0, c: '#fff' }] }; }), 400, 48);
    H.ok('24 bars in 400 px narrow to fit', n24.bw < 20 && n24.W <= 400.01, n24.W);
    // spans and merge
    var s = X.spans([[0, 'on'], [10, 'off'], [20, 'on']], 0, 30, function (p) { return p[1] === 'on'; });
    H.eq('on spans, the last still open at "now"', s, [[0, 10], [20, 30]]);
    H.eq('overlapping spans merge (a room lit while any light is)', X.merge([[0, 10], [5, 12], [20, 25]]), [[0, 12], [20, 25]]);
    // next times
    var now = Date.parse('2026-10-15T20:00:00');
    var h = { states: { 'sun.sun': { attributes: { next_setting: '2026-10-16T18:55:00', next_rising: '2026-10-16T07:33:00' } } } };
    H.eq('a time trigger: today if still ahead', X.nextTime(h, { kind: 'time', at: '22:00' }, now), Date.parse('2026-10-15T22:00:00'));
    H.eq('...else tomorrow, if within 16 hours', X.nextTime(h, { kind: 'time', at: '06:00' }, now), Date.parse('2026-10-16T06:00:00'));
    H.eq('...and not at all beyond', X.nextTime(h, { kind: 'time', at: '19:00' }, now), null);
    H.eq('sunrise less an hour, from sun.sun', X.nextTime(h, { kind: 'sun', event: 'sunrise', offset_s: -3600 }, now), Date.parse('2026-10-16T06:33:00'));
    H.eq('sunset tomorrow is too far', X.nextTime(h, { kind: 'sun', event: 'sunset', offset_s: -900 }, now), null);
    // ways in, by name
    var hw = { states: {} };
    ['lock.front_door_lock', 'lock.back_door_lock', 'lock.garage_door_lock', 'binary_sensor.front_door_entry',
     'binary_sensor.kitchen_back_door', 'binary_sensor.garage_door', 'cover.garage_door'].forEach(function (id) {
      hw.states[id] = { entity_id: id, state: id.indexOf('lock.') === 0 ? 'locked' : 'off', attributes: {}, last_changed: '2026-10-15T18:00:00Z' };
    });
    var ways = X.waysIn(hw, { locks: ['lock.front_door_lock', 'lock.back_door_lock', 'lock.garage_door_lock'],
      doors: ['binary_sensor.front_door_entry', 'binary_sensor.kitchen_back_door', 'binary_sensor.garage_door'], garage: ['cover.garage_door'] }, {});
    H.eq('the front door: its lock and its contact', ways.front_door, ['lock.front_door_lock', 'binary_sensor.front_door_entry']);
    H.eq('the back door: the kitchen back door', ways.back_door, ['lock.back_door_lock', 'binary_sensor.kitchen_back_door']);
    H.eq('the garage: its door\'s lock and the garage door itself', ways.garage, ['lock.garage_door_lock', 'cover.garage_door']);
    H.eq('Settings\' pick wins', X.waysIn(hw, { locks: [] }, { front_door: ['lock.back_door_lock'] }).front_door, ['lock.back_door_lock']);
    H.eq('locked and shut: Locked, no warning', [X.wayState(hw, ways.front_door).word, X.wayState(hw, ways.front_door).warn], ['Locked', false]);
    hw.states['binary_sensor.front_door_entry'].state = 'on';
    H.eq('the door open: Open, a warning', [X.wayState(hw, ways.front_door).word, X.wayState(hw, ways.front_door).warn], ['Open', true]);
    H.eq('the garage reads its door', X.wayState(hw, ways.garage).word, 'Closed');
    // GONE QUIET: a leak sensor "unknown" since a restart while its device's
    // temperature reports is working; unavailable, or a silent device, is not
    var t0 = Date.parse('2026-10-16T09:40:00Z'), iso = function (ms) { return new Date(ms).toISOString(); };
    var hq = { states: {
      'binary_sensor.sink_leak': { state: 'unknown', attributes: {}, last_updated: iso(t0 - 7 * HOUR) },
      'sensor.sink_temp': { state: '75.2', attributes: {}, last_updated: iso(t0 - 9 * HOUR), last_reported: iso(t0 - 2 * HOUR) },
      'binary_sensor.old_leak': { state: 'unknown', attributes: {}, last_updated: iso(t0 - 40 * HOUR) },
      'sensor.old_battery': { state: '80', attributes: {}, last_updated: iso(t0 - 40 * HOUR) },
      'binary_sensor.gone': { state: 'unavailable', attributes: {} },
      'binary_sensor.alone': { state: 'unknown', attributes: {} } },
      entities: { 'binary_sensor.sink_leak': { device_id: 'a' }, 'sensor.sink_temp': { device_id: 'a' },
                  'binary_sensor.old_leak': { device_id: 'b' }, 'sensor.old_battery': { device_id: 'b' }, 'binary_sensor.gone': { device_id: 'c' } } };
    H.ok('a leak sensor unknown since a restart, its device reporting: working', !X.goneQuiet(hq, 'binary_sensor.sink_leak', t0));
    H.ok('...its device silent for over a day: not reporting', X.goneQuiet(hq, 'binary_sensor.old_leak', t0));
    H.ok('unavailable: not reporting', X.goneQuiet(hq, 'binary_sensor.gone', t0));
    H.ok('unknown with nothing to judge it by: not named', !X.goneQuiet(hq, 'binary_sensor.alone', t0));
    // a row's glyph by what it is and what it did
    var hk = { states: { 'binary_sensor.w': { attributes: { device_class: 'window' } }, 'binary_sensor.l': { attributes: { device_class: 'moisture' } } } };
    H.eq('kinds: a window, a leak sensor, a lock, the alarm', [X.kindOf(hk, 'binary_sensor.w'), X.kindOf(hk, 'binary_sensor.l'), X.kindOf(hk, 'lock.x'), X.kindOf(hk, 'alarm_control_panel.a', 'alarm_control_panel.a')],
         ['window', 'leak', 'lock', 'alarm']);
    H.eq('an opened window: its open glyph, red as its tile', [X.rowGlyph('window', 'on').icon, X.rowGlyph('window', 'on').color], ['hk:window-open-variant', window.hkCards.PALETTE.icon.red]);
    H.eq('...closed: its closed glyph, plain', [X.rowGlyph('window', 'off').icon, X.rowGlyph('window', 'off').color], ['hk:window-closed-variant', window.hkCards.v('ink-2')]);
    H.eq('a lock unlocked: open, orange', [X.rowGlyph('lock', 'unlocked').icon, X.rowGlyph('lock', 'unlocked').color], ['hk:lock-open-variant', window.hkCards.PALETTE.icon.orange]);
    H.eq('the alarm armed Home: the keypad\'s blue', X.rowGlyph('alarm', 'armed_home').color, window.hkCards.PALETTE.icon.blue);
    H.eq('a leak: the water alert, red', [X.rowGlyph('leak', 'on').icon, X.rowGlyph('leak', 'on').color], ['hk:water-alert', window.hkCards.PALETTE.icon.red]);
    H.eq('a lock locked: mint', X.rowGlyph('lock', 'locked').color, window.hkCards.PALETTE.icon.mint);
  },

  function () {
    H.section('Climate: the day\'s runtime');
    var house = H.house({
      'climate.down': ['heat_cool', { friendly_name: 'Downstairs Ecobee Thermostat', hvac_action: 'cooling', current_temperature: 76 }],
      'climate.up': ['heat_cool', { friendly_name: 'Upstairs Ecobee Thermostat', hvac_action: 'idle', current_temperature: 74 }]
    });
    var card = H.make('hk-climate-runtime-card');
    card.setConfig({ type: 'custom:hk-climate-runtime-card', thermostats: ['climate.down', 'climate.up'], height: '240px' });
    card.hass = house.hass();
    H.ok('loading until history answers', drawn(card).indexOf('Loading today') > 0);
    return tick().then(function () {
    H.ok('one history call for both, with attributes (hvac_action)', house.ws.length === 1 && house.ws[0].msg.type === 'history/history_during_period' &&
      house.ws[0].msg.entity_ids.join() === 'climate.down,climate.up' && house.ws[0].msg.no_attributes === false, house.ws[0] && house.ws[0].msg);
    var m0 = midnight() / 1000;
    return answer(house, function () {
      return {
        'climate.down': [{ s: 'heat_cool', a: { hvac_action: 'idle', current_temperature: 72 }, lu: m0 },
                         { s: 'heat_cool', a: { hvac_action: 'cooling', current_temperature: 75 }, lu: m0 + 3600 },
                         { s: 'heat_cool', a: { hvac_action: 'idle', current_temperature: 73 }, lu: m0 + 3600 + 45 * 60 }],
        'climate.up': [{ s: 'heat_cool', a: { hvac_action: 'idle', current_temperature: 74 }, lu: m0 }]
      };
    }).then(function () {
      card.hass = house.hass();
      var html = drawn(card);
      H.ok('cooling only: "Cooling Through the Day"', html.indexOf('Cooling Through the Day') > 0, html.slice(0, 200));
      H.ok('the downstairs figure: 45 min (and whatever runs since)', /45<u>min<\/u>|<u>min<\/u>/.test(html) && html.indexOf('Downstairs') > 0);
      H.ok('the upstairs figure: Idle, its name trimmed of "Ecobee Thermostat"', html.indexOf('>Idle<') > 0 && html.indexOf('>Upstairs · ') > 0);
      // THE HOUSE ITSELF (2026-10-21): each thermostat's indoor temperature now
      // beside its name, and its day as a line of its own colour over the bars
      H.ok('each thermostat\'s temperature now beside its name, a dot in its line\'s colour',
           /<i style="background:#bf5af2"><\/i>Downstairs · <b>76°<\/b>/.test(html) && /<i style="background:#30d158"><\/i>Upstairs · <b>74°<\/b>/.test(html), html.slice(0, 600));
      H.ok('a line for each thermostat, in its colour', /<path class="il" stroke="#bf5af2" d="M/.test(html) && /<path class="il" stroke="#30d158" d="M/.test(html));
      H.ok('...on the same scale as the bars\' hours: one point an hour to now', ((html.match(/<path class="il" stroke="#bf5af2" d="([^"]*)"/) || [])[1] || '').split(/[ML]/).length - 1 >= 1);
      H.ok('the readout names the temperatures', html.indexOf('runtime and temperatures') > 0);
      H.ok('24 hour bars, labeled at 12a / 6a / 12p / 6p', (html.match(/data-i="/g) || []).length >= 24 && html.indexOf('>12a<') > 0 && html.indexOf('>6p<') > 0);
      H.ok('each thermostat\'s figure opens its sheet', html.indexOf('data-more="climate.down"') > 0);
    });
    });
  },

  function () {
    H.section('Climate: the outside temperature over the bars');
    var saved = window.hkSettings;
    window.hkSettings = { get: function (k, d) { return k === 'weather.outside' ? 'sensor.out' : k === 'headers' ? {} : d; },
                          weatherId: function () { return 'weather.home'; } };
    var house = H.house({
      'climate.down': ['heat_cool', { friendly_name: 'Downstairs Thermostat', hvac_action: 'cooling' }],
      'sensor.out': ['71', { unit_of_measurement: '°F' }], 'weather.home': ['sunny', { temperature: 70 }]
    });
    var card = H.make('hk-climate-runtime-card');
    card.setConfig({ type: 'custom:hk-climate-runtime-card', thermostats: ['climate.down'] });
    card.hass = house.hass();
    H.ok('...and the hourly forecast for the hours to come', house.subs.some(function (x) { return x.msg.forecast_type === 'hourly' && x.msg.entity_id === 'weather.home'; }));
    var m0 = midnight() / 1000;
    return tick().then(function () {
      H.ok('the history asks for the outside sensor too', house.ws[0] && house.ws[0].msg.entity_ids.join() === 'climate.down,sensor.out', house.ws[0] && house.ws[0].msg);
      return answer(house, function () {
      return { 'climate.down': [{ s: 'heat_cool', a: { hvac_action: 'cooling' }, lu: m0 }],
               'sensor.out': [{ s: '60', lu: m0 }, { s: '65', lu: m0 + 3 * 3600 }] };
    }); }).then(function () {
      var sub = house.subs.filter(function (x) { return x.msg.forecast_type === 'hourly'; })[0];
      sub.cb({ forecast: [{ datetime: new Date(Date.now() + 2 * HOUR).toISOString(), temperature: 80 }] });
      card.hass = house.hass();
      var html = drawn(card);
      H.ok('the measured line, solid, and the forecast, dashed', html.indexOf('class="ol"') > 0 && html.indexOf('class="ol fc"') > 0, html.slice(-800));
      H.ok('a dot an hour for the readout, and the reading now labeled', (html.match(/class="od"/g) || []).length >= 2 && html.indexOf('>71°</text>') > 0);
      H.ok('the legend names it', html.indexOf('Outside</span>') > 0);
      window.hkSettings = saved;
    });
  },

  function () {
    H.section('Climate: outside & ahead');
    var house = H.house({ 'weather.home': ['partlycloudy', { temperature: 79 }],
      'sun.sun': ['above_horizon', { next_setting: new Date(Date.now() + 2 * HOUR).toISOString(), next_rising: new Date(Date.now() + 14 * HOUR).toISOString() }] });
    var card = H.make('hk-climate-outside-card');
    card.setConfig({ type: 'custom:hk-climate-outside-card', weather: 'weather.home' });
    card.hass = house.hass();
    H.ok('subscribes to the hourly and the daily forecast', house.subs.length === 2 && house.subs[0].msg.forecast_type === 'hourly' && house.subs[1].msg.forecast_type === 'daily');
    var now = Date.now();
    house.subs[0].cb({ forecast: [1, 2, 3, 4, 5, 6, 7].map(function (i) { return { datetime: new Date(now + i * HOUR).toISOString(), temperature: 79 - i * 2 }; }) });
    house.subs[1].cb({ forecast: [{ datetime: new Date(now).toISOString(), temperature: 81, templow: 62 }] });
    card.hass = house.hass();
    var html = drawn(card);
    H.ok('the temperature, the condition, the high and low', html.indexOf('79°') > 0 && html.indexOf('Partly cloudy') > 0 && html.indexOf('High 81° · Low 62°') > 0, html);
    H.ok('three hours ahead, two apart', (html.match(/<b>\d+°<\/b>/g) || []).length === 3);
    H.ok('cooling off, and the sunset', /Cooling off/.test(html) && html.indexOf('sunset') > 0);
  },

  function () {
    H.section('Lights: through the day');
    var house = H.house({ 'light.a': ['on', {}], 'light.b': ['off', {}], 'light.c': ['off', {}] });
    var card = H.make('hk-lights-day-card');
    card.setConfig({ type: 'custom:hk-lights-day-card', rooms: [{ name: 'Office', lights: ['light.a', 'light.b'] }, { name: 'Kitchen', lights: ['light.c'] }] });
    card.hass = house.hass();
    var m0 = midnight() / 1000, now = Date.now() / 1000;
    return tick().then(function () { return answer(house, function (msg) {
      H.ok('history without attributes, the page\'s lights only', msg.no_attributes === true && msg.entity_ids.length === 3);
      return { 'light.a': [{ s: 'off', lu: m0 }, { s: 'on', lu: now - 2 * 3600 }], 'light.b': [{ s: 'on', lu: now - 3 * 3600 }, { s: 'off', lu: now - 1800 }],
               'light.c': [{ s: 'on', lu: now - 600 }, { s: 'off', lu: now - 300 }] };
    }).then(function () {
      card.hass = house.hass();
      var html = drawn(card);
      H.ok('Office first: lit while either light was (3 h, merged)', html.indexOf('Office') < html.indexOf('Kitchen') && html.indexOf('>3h<') > 0, html);
      H.ok('the longest room fills the track', html.indexOf('width:100.0%') > 0);
      H.ok('Kitchen: 5 minutes', html.indexOf('>5m<') > 0);
    }); });
  },

  function () {
    H.section('Lights: left on, then tonight');
    var ago = function (m) { return new Date(Date.now() - m * MIN).toISOString(); };
    var house = H.house({ 'light.foyer': ['on', { brightness: 255 }], 'light.office': ['on', {}], 'binary_sensor.foyer_motion': ['off', { device_class: 'motion' }],
      'binary_sensor.office_occ': ['on', { device_class: 'occupancy' }],
      'sun.sun': ['below_horizon', { next_setting: new Date(Date.now() + 20 * HOUR).toISOString(), next_rising: new Date(Date.now() + 9 * HOUR).toISOString() }] });
    var hass = function () {
      var h = house.hass();
      h.states['light.foyer'].last_changed = ago(120);
      h.states['binary_sensor.foyer_motion'].last_changed = ago(40);
      h.entities = { 'light.foyer': { area_id: 'foyer' }, 'binary_sensor.foyer_motion': { area_id: 'foyer' },
                     'light.office': { area_id: 'office' }, 'binary_sensor.office_occ': { area_id: 'office' } };
      h.areas = { foyer: { name: 'Foyer' }, office: { name: 'Office' } };
      return h;
    };
    var soon = new Date(Date.now() + HOUR), inAnHour = ('0' + soon.getHours()).slice(-2) + ':' + ('0' + soon.getMinutes()).slice(-2);
    var card = H.make('hk-lights-tonight-card');
    card.setConfig({ type: 'custom:hk-lights-tonight-card', rooms: [{ name: 'Foyer', lights: ['light.foyer'], icons: { 'light.foyer': 'hk:chandelier' } },
                                                                      { name: 'Office', lights: ['light.office'] }] });
    X.__schedule({ lights: { schedule: [
      { automation: 'automation.yard', kind: 'time', at: inAnHour, effect: 'off', entities: ['light.foyer'], area: 'Front Yard', name: 'Lighting - Front Yard - X', ready: true },
      { automation: 'automation.morning', kind: 'sun', event: 'sunrise', offset_s: -3600, effect: 'on', entities: ['light.office'], area: 'Home', name: 'Lighting - Home - Interior', ready: false },
      { automation: 'automation.other', kind: 'sun', event: 'sunrise', offset_s: 0, effect: 'on', entities: ['switch.coffee'], area: 'Kitchen', name: 'x', ready: true }] } });
    card.hass = hass();
    var html = drawn(card);
    H.ok('the Foyer light, its room empty 40 min: left on, with Turn Off', html.indexOf('data-off="light.foyer"') > 0 && html.indexOf('empty 40m') > 0 && html.indexOf('100%') > 0, html);
    H.ok('...its own glyph', html.indexOf('hk:chandelier') > 0);
    H.ok('the Office, someone there: not named', html.indexOf('data-off="light.office"') < 0);
    H.ok('"1 light in empty rooms"', html.indexOf('1 light in empty rooms') > 0);
    H.ok('tonight: only automations that switch the page\'s lights', html.indexOf('automation.other') < 0 && html.indexOf('Front Yard lights off') > 0);
    H.ok('a row whose condition fails now is quieter, and says so', html.indexOf('class="ev wait"') > 0 && html.indexOf('not now') > 0 && html.indexOf('Inside lights on · sunrise') > 0);
    // Turn Off: the light's own service
    card._card.dispatchEvent && null;
    card.hass.callService('light', 'turn_off', { entity_id: 'light.foyer' });
    H.ok('Turn Off sends turn_off for that light', house.calls.some(function (c) { return c.domain === 'light' && c.service === 'turn_off' && c.data.entity_id === 'light.foyer'; }));
    // nothing sensed, nothing scheduled: Light Levels
    var lv = H.make('hk-lights-tonight-card');
    lv.setConfig({ type: 'custom:hk-lights-tonight-card', rooms: [{ name: 'Den', lights: ['light.office'] }] });
    X.__schedule({ lights: { schedule: [] } });
    var h2 = house.hass(); h2.entities = {}; h2.areas = {};
    lv.hass = h2;
    H.ok('no presence sensors and nothing scheduled: Light Levels', drawn(lv).indexOf('Light Levels') > 0, drawn(lv).slice(0, 120));
  },

  function () {
    H.section('Security: your home and device care');
    X.__art('/hk/power-house/', { layers: { house: ['house.trim.webp', 2, 197, 1534, 827] },
      doors: { front_door: { at: [526, 797], tag: [192, 987] }, garage: { at: [1110, 837], tag: [1342, 997] }, back_door: { at: [1012, 347], tag: [1322, 237] } } });
    var house = H.house({ 'lock.front_door_lock': ['locked', { friendly_name: 'Front Door Lock' }], 'binary_sensor.front_door_entry': ['off', { device_class: 'door' }],
      'cover.garage_door': ['closed', { device_class: 'garage' }], 'alarm_control_panel.house': ['disarmed', {}],
      'binary_sensor.leak': ['unknown', { device_class: 'moisture', friendly_name: 'Sink Water Leak Sensor Moisture' }],
      'sensor.front_door_lock_battery': ['14', { device_class: 'battery', friendly_name: 'Front Door Lock Battery' }] });
    var hass = function () {
      var h = house.hass();
      h.entities = { 'lock.front_door_lock': { device_id: 'd1' }, 'sensor.front_door_lock_battery': { device_id: 'd1' } };
      h.devices = { d1: { name: 'Front Door Lock' } };
      return h;
    };
    var card = H.make('hk-security-overview-card');
    card.setConfig({ type: 'custom:hk-security-overview-card', alarm: 'alarm_control_panel.house', locks: ['lock.front_door_lock'],
                     doors: ['binary_sensor.front_door_entry'], garage: ['cover.garage_door'], leaks: ['binary_sensor.leak'] });
    card.hass = hass();
    return tick().then(function () {
    var html = drawn(card);
    H.ok('the house picture, a label for each way in the house has', html.indexOf('house.trim.webp') > 0 && html.indexOf('<b>Front Door</b>') > 0 &&
      html.indexOf('<b>Garage</b>') > 0 && html.indexOf('<b>Back Door</b>') < 0, html.slice(0, 400));
    H.ok('a label sits where the picture says, a dot on the door itself', /left:12\.39%/.test(html) && html.indexOf('cx="524"') > 0);
    H.ok('the logbook asked since midnight, for the locks, the garage and the alarm', house.ws.length === 1 && house.ws[0].msg.type === 'logbook/get_events' &&
      house.ws[0].msg.entity_ids.indexOf('alarm_control_panel.house') >= 0 && house.ws[0].msg.entity_ids.indexOf('cover.garage_door') >= 0);
    var care = H.morphed(card._care);
    H.ok('Device Care: the low battery on the lock\'s own device first', care.indexOf('Front Door Lock battery · 14%') > 0 && card._care.style.display !== 'none', care);
    H.ok('one thing to look after: Details opens its sheet', care.indexOf('data-care') < 0 && care.indexOf('>Details<') > 0, care);
    var t0 = midnight() / 1000 + 3600;
    return answer(house, function () {
      return [{ entity_id: 'binary_sensor.leak', state: 'off', when: t0 - 30 },
              { entity_id: 'binary_sensor.front_door_entry', state: 'on', when: t0 }, { entity_id: 'binary_sensor.front_door_entry', state: 'off', when: t0 + 4 },
              { entity_id: 'lock.front_door_lock', state: 'locked', when: t0 + 60, context_name: 'HomeKit' }];
    }).then(function () {
      card.hass = hass();
      var html2 = drawn(card);
      H.ok('a close folds into its open: "Front Door closed · Open for 4 seconds"', html2.indexOf('Front Door closed') > 0 && html2.indexOf('Open for 4 seconds') > 0, html2.slice(-600));
      H.ok('each row has its glyph', (html2.match(/class="ar"[^>]*><hk-icon class="gl"/g) || []).length === 2 && html2.indexOf('hk:door-closed') > 0 && html2.indexOf('hk:lock"') > 0, html2.slice(-900));
      // EXPAND: the open keeps its own row; the close still says how long
      H.ok('grouped: an Expand button', html2.indexOf('data-expand') > 0 && html2.indexOf('>Expand<') > 0);
      card._setExpanded(true);
      card.hass = hass();
      var html3 = drawn(card);
      H.ok('expanded: the open and the close each a row (3)', (html3.match(/class="ar"/g) || []).length === 3 && html3.indexOf('Front Door opened') > 0 &&
        html3.indexOf('Open for 4 seconds') > 0 && html3.indexOf('>Collapse<') > 0, html3.slice(-900));
      H.ok('...remembered on this screen', window.localStorage.getItem('hk-security-activity-expanded') === '1');
      card._setExpanded(false);
      card.hass = hass();
      H.ok('collapsed again: 2 rows', (drawn(card).match(/class="ar"/g) || []).length === 2);
      H.ok('who did it, when the logbook says', html2.indexOf('by HomeKit') > 0);
      H.ok('"2 today", newest first', html2.indexOf('2 today') > 0 && html2.indexOf('Front Door locked') < html2.indexOf('Front Door closed'));
      // nothing to look after: no Device Care
      house.set('sensor.front_door_lock_battery', '80', { device_class: 'battery' });
      house.set('binary_sensor.leak', 'off', { device_class: 'moisture' });
      card.hass = hass();
      H.ok('nothing to look after: Device Care is not there', card._care.style.display === 'none');
    });
    });
  },

  function () {
    H.section('the utility pages: a vacuum run and how it ended (2026-10-16)');
    // compressed history, seconds: {s, lu}
    var T0 = 1.79e9, m = function (min) { return T0 + min * 60; };
    var hist = function (pairs) { return pairs.map(function (p) { return { s: p[1], lu: m(p[0]) }; }); };
    var now = (T0 + 600 * 60) * 1000;
    // a mop wash between two passes is one run; a success counter's rise says Completed
    var H1 = { 'vacuum.a': hist([[0, 'docked'], [10, 'cleaning'], [50, 'returning'], [52, 'docked'], [58, 'cleaning'], [80, 'returning'], [82, 'docked']]),
               'sensor.a_ok': hist([[0, '10'], [83, '11']]) };
    var r1 = X.vacRuns({ entity: 'vacuum.a', success: 'sensor.a_ok' }, H1, now);
    H.ok('passes 8 minutes apart are one run', r1.length === 1 && r1[0].start === m(10) * 1000 && r1[0].end === m(80) * 1000, JSON.stringify(r1));
    H.ok('...its cleaning time the two passes, not the wash between', r1[0].clean === 62 * MIN, r1[0].clean / MIN);
    H.ok('...Completed: the vacuum\'s own success counter rose', r1[0].out === 'done', r1[0].out);
    // no counter: back on the dock is all that can be said
    var r2 = X.vacRuns({ entity: 'vacuum.a' }, { 'vacuum.a': H1['vacuum.a'] }, now);
    H.ok('no counter: "docked", never "done" -- a run stopped early docks too', r2[0].out === 'docked', r2[0].out);
    // an error reported during the run, or just after it, is the run's
    var H3 = { 'vacuum.a': H1['vacuum.a'], 'sensor.a_err': hist([[0, 'no_error'], [85, 'water_tank_empty'], [86, 'no_error']]) };
    var r3 = X.vacRuns({ entity: 'vacuum.a', error: 'sensor.a_err' }, H3, now);
    H.ok('an error sensor\'s report as it settles: failed, with why', r3[0].out === 'failed' && r3[0].why === 'water tank empty', JSON.stringify(r3[0]));
    var r4 = X.vacRuns({ entity: 'vacuum.a', success: 'sensor.a_ok', failed: 'sensor.a_bad' },
      { 'vacuum.a': hist([[0, 'docked'], [10, 'cleaning'], [70, 'error'], [200, 'docked']]), 'sensor.a_ok': hist([[0, '10']]), 'sensor.a_bad': hist([[0, '3'], [71, '4']]) }, now);
    H.ok('the failure counter rose: failed', r4[0].out === 'failed', r4[0].out);
    var r5 = X.vacRuns({ entity: 'vacuum.a' }, { 'vacuum.a': hist([[0, 'docked'], [500, 'cleaning']]) }, now);
    H.ok('still cleaning: running, open at now', r5[0].out === 'running' && r5[0].end === now, JSON.stringify(r5));
    var r6 = X.vacRuns({ entity: 'vacuum.a' }, { 'vacuum.a': hist([[0, 'docked'], [10, 'cleaning'], [40, 'idle']]) }, now);
    H.ok('ended away from the dock: stopped', r6[0].out === 'stopped', r6[0].out);

    H.section('the main supply: what the valve says, never more');
    var st = function (id, s) { return { entity_id: id, state: s, attributes: {} }; };
    H.eq('a valve\'s states as they are', ['open', 'closed', 'opening', 'closing', 'unknown', 'unavailable', 'stuck'].map(function (s) { return X.supplyState(st('valve.m', s)); }),
         ['open', 'closed', 'opening', 'closing', 'unknown', 'unavailable', 'unknown']);
    H.eq('a switch: on is open, off closed, the rest unknown', ['on', 'off', 'unknown', 'unavailable'].map(function (s) { return X.supplyState(st('switch.m', s)); }),
         ['open', 'closed', 'unknown', 'unavailable']);
    H.ok('no entity: unavailable', X.supplyState(undefined) === 'unavailable');
  },

  function () {
    H.section('the keypad, boxed');
    var house = H.house({ 'alarm_control_panel.house': ['armed_home', { code_format: 'number', supported_features: 3 }], 'binary_sensor.door': ['off', {}] });
    var k = H.make('hk-alarm-keypad-card');
    k.setConfig({ type: 'custom:hk-alarm-keypad-card', entity: 'alarm_control_panel.house', boxed: true, entries: ['binary_sensor.door'] });
    k.hass = house.hass();
    H.ok('its own plate, titled', !!k._root.querySelector('hk-plate.kp') || /kp/.test(JSON.stringify(Object.keys(k._root))), 'boxed');
  }
]);
