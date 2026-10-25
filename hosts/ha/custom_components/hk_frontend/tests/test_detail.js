// hk-detail.js: the Home app-style detail sheets in place of HA's more-info
// dialog. The DOM here does not parse HTML, so these pin the decisions --
// which entity gets which sheet, the fan's speeds and guard, the data
// shaping, which taps are taken -- and the look is checked in a browser and
// on a wall tablet, at 1280 and at 390 px.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-detail.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
var src = readFile(HK_ROOT + '/frontend/cards/hk-detail.js');
var D = window.hkDetail, _ = D && D._;

function house(map) {
  var states = {};
  Object.keys(map).forEach(function (id) {
    states[id] = { entity_id: id, state: map[id][0], attributes: map[id][1] || {}, last_updated: 't' };
  });
  return { states: states };
}

print('=== loaded ===');
ok('window.hkDetail exists with open/close/kindOf', !!D && typeof D.open === 'function' && typeof D.kindOf === 'function');
ok('the light, toggle and fan panels are defined', !!customElements.get('hk-detail-light') && !!customElements.get('hk-detail-toggle') &&
   !!customElements.get('hk-detail-fan'));

(function () {
  var settings0=window.hkSettings;
  try {
    window.hkSettings={rendering:function(){return {flat:true,theme:'light'}}};
    ok('Flat Light brightness uses a contrasting neutral fill',_.lightFill({attributes:{}})===window.hkCards.v('track-fill')&&_.lightFill({attributes:{rgb_color:[255,255,255]}})===window.hkCards.v('track-fill'));
    ok('colored light keeps its hue in Flat',_.lightFill({attributes:{rgb_color:[255,0,0]}})==='rgb(255,0,0)');
    window.hkSettings={rendering:function(){return {flat:false,theme:'dark'}}};
    ok('glass retains its existing white fill',_.lightFill({attributes:{}})==='rgba(255,255,255,0.95)');
  } finally {window.hkSettings=settings0;}
})();

print('\n=== which sheet ===');
var H = house({
  'light.dim': ['on', { supported_color_modes: ['brightness'], brightness: 128 }],
  'light.onoff': ['off', { supported_color_modes: ['onoff'] }],
  'light.hue': ['on', { supported_color_modes: ['color_temp', 'xy'], effect_list: ['candle'] }],
  'switch.coffee': ['on', {}],
  'input_boolean.guest': ['off', {}],
  'fan.living_room_fan': ['on', { percentage: 50, percentage_step: 25, supported_features: 1 }],
  'fan.bath_exhaust': ['off', { supported_features: 0 }],
  'cover.shades': ['open', { supported_features: 15, current_position: 40 }],
  'cover.blinds': ['closed', { supported_features: 11 }],
  'cover.garage': ['closed', { supported_features: 11, device_class: 'garage' }],
  // real-world shapes: a Tesla frunk (device_class door, open only) and a
  // SwitchBot blind that only tilts (bits 16-128)
  'cover.frunk': ['closed', { supported_features: 1, device_class: 'door' }],
  'cover.tilt_only': ['closed', { supported_features: 240, device_class: 'blind', current_tilt_position: 98 }],
  'lock.front': ['locked', {}], 'climate.down': ['cool', {}], 'media_player.tv': ['playing', {}],
  'sensor.temp': ['71.4', { unit_of_measurement: '°F' }], 'sensor.mode': ['eco', {}],
  'binary_sensor.door': ['off', { device_class: 'door' }], 'vacuum.down': ['docked', {}],
  'water_heater.wh': ['eco', {}], 'alarm_control_panel.a': ['disarmed', {}],
  'weather.home': ['sunny', {}], 'person.alex': ['home', {}], 'calendar.family': ['off', {}], 'automation.porch': ['on', {}],
  'button.pc_wake_on_lan': ['unknown', {}], 'input_button.nap': ['2026-10-01T21:14:00+00:00', {}]
});
var want = {
  'light.dim': 'light', 'light.onoff': 'toggle', 'light.hue': 'light', 'switch.coffee': 'toggle',
  'input_boolean.guest': 'toggle', 'fan.living_room_fan': 'fan', 'fan.bath_exhaust': 'toggle',
  'cover.shades': 'cover', 'cover.blinds': 'cover_buttons', 'cover.garage': 'garage', 'lock.front': 'lock', 'climate.down': 'climate',
  'cover.frunk': 'garage', 'cover.tilt_only': null,
  'media_player.tv': 'media', 'sensor.temp': 'sensor', 'sensor.mode': 'state', 'binary_sensor.door': 'binary',
  'vacuum.down': 'vacuum', 'water_heater.wh': 'water_heater', 'alarm_control_panel.a': 'alarm',
  // a person: where they are (hk-person.js); a calendar: its event (hk-calendar.js)
  // the weather: HK's own sheet (hk-weather.js)
  'weather.home': 'weather', 'automation.porch': 'automation', 'person.alex': 'person', 'calendar.family': 'event', 'light.missing': null,
  'button.pc_wake_on_lan': 'button', 'input_button.nap': 'button'
};
var wrong = [];
Object.keys(want).forEach(function (id) { if (D.kindOf(H, id) !== want[id]) wrong.push(id + '=' + D.kindOf(H, id)); });
ok('every domain gets its sheet; the rest fall through to HA', wrong.length === 0, wrong);

print('\n=== fan ===');
ok('a Lutron fan steps in four', _.fanSteps(H.states['fan.living_room_fan']) === 4);
ok('its speeds are Lutron\'s own names', _.fanLabel(25, 4, true) === 'Low' && _.fanLabel(50, 4, true) === 'Medium' &&
   _.fanLabel(75, 4, true) === 'Medium-High' && _.fanLabel(100, 4, true) === 'High' && _.fanLabel(0, 4, true) === 'Off');
ok('a continuous fan reads as a percentage', _.fanLabel(42, 100, true) === '42%');
ok('the manual guard timer is timer.fan_manual_<room>', _.fanGuard('fan.living_room_fan') === 'timer.fan_manual_living_room' &&
   _.fanGuard('fan.backyard_deck_fan') === 'timer.fan_manual_backyard_deck');
ok('speed names sit at the middle of each band', /\(i \+ 0\.5\) \/ n \* 100/.test(src));

print('\n=== light ===');
var caps = _.lightCaps(H.states['light.hue']);
ok('capabilities read from supported_color_modes', caps.colour && caps.temp && caps.dim && caps.effects);
var favs = _.defaultFavourites(H.states['light.hue']);
ok('default favorites: whites across the range, then colors; at most six (the rainbow is the seventh)',
   favs.length === 6 && favs[0].color_temp_kelvin === 2700 && !!favs[3].hs_color, favs);
ok('a favorite matches the light\'s current color temperature',
   _.favMatches({ color_temp_kelvin: 2700 }, { attributes: { color_mode: 'color_temp', color_temp_kelvin: 2680 } }));
ok('the color row ends in the rainbow, which opens the wheel',
   /<button class="rainbow" aria-label="More colors"><\/button>/.test(src) && /self\._go\('wheel'\)/.test(src));
ok('effects are ONE button opening the list, with search past 12', /fx\.className = 'btn menu'/.test(src) && /list\.length > 12/.test(src));
ok('favorites are read from the registry only by an admin (a wall tablet is not)', /h\.user && h\.user\.is_admin && h\.callWS/.test(src));
ok('a warm kelvin swatch is warm', (function () { var c = _.kelvinRgb(2700); return c[0] === 255 && c[2] < 200; })());

print('\n=== data ===');
var pts = [];
for (var i = 0; i < 5000; i++) pts.push({ t: new Date(1e12 + i * 1000), v: i % 10 });
var ds = _.downsample(pts, 300);
ok('a long history is cut to at most 300 points, in time order', ds.length <= 300 && ds.length > 250 && +ds[1].t > +ds[0].t, ds.length);
ok('a short one is left alone', _.downsample(pts.slice(0, 10), 300).length === 10);

print('\n=== the sheet ===');
ok('the X is the size of the well, so it sits as far from the top as the right',
   /\.hkd \.well\{width:44px;height:44px/.test(src) && /\.hkd \.x\{width:44px;height:44px/.test(src));
ok('on a phone the sheet is the screen less 16 px a side', /\.hkd \.sheet\{width:calc\(var\(--hk-vw, 100vw\) - 32px\)/.test(src) &&
   /max-width:calc\(var\(--hk-vw, 100vw\) - var\(--hk-content-left, 0px\) - 32px\)/.test(src));
ok('...and elsewhere it centers on the dashboard, past Home Assistant\'s sidebar',
   /padding-left:var\(--hk-content-left,0px\)/.test(src));
ok('the caps follow a car browser\'s zoomed layout px (--hk-vw/--hk-vh), else the viewport units',
   /max-height:calc\(var\(--hk-vh, 100dvh\) - 32px\)/.test(src) && !/calc\(100dvh - 32px\)/.test(src));
ok('the back button closes it (one history entry, same URL, carrying this sheet\'s token -- not a hash)',
   /var entry = \{ hkDetail: id, hkTok: tok \};/.test(src) && /history\.pushState\(entry, '', location\.href\)/.test(src));
ok('it closes after 60 s untouched, counted from the last touch', /AUTO_CLOSE_MS = 60000/.test(src) && /sheet\.addEventListener\('pointerdown', armAuto, true\)/.test(src));
ok('one blur layer, on the sheet only', (src.match(/-webkit-backdrop-filter:blur/g) || []).length === 1);
ok('no link to history or settings anywhere', !/History|settings tab|config\/entities/.test(src.replace(/\/\/.*$/mg, '')));

print('\n=== covers, locks, climate ===');
ok('the cover, lock and climate panels are defined', !!customElements.get('hk-detail-cover') && !!customElements.get('hk-detail-lock') &&
   !!customElements.get('hk-detail-climate'));
ok('a shade is drawn as the shade: fabric track, window fill, a handle on its edge',
   /\.vs\.shade\{background:repeating-linear-gradient/.test(src) && /\.vs\.shade \.fill::before/.test(src));
ok('a position slider sends set_cover_position; buttons only for the features the cover has',
   /'set_cover_position', \{ position: Math\.round\(v \* 100\) \}/.test(src) &&
   /if \(f & 1\) defs\.push/.test(src) && /if \(f & 8\) defs\.push/.test(src) && /if \(f & 2\) defs\.push/.test(src));
// the gesture itself is exercised in test_detail_behaviour.js
ok('unlocking is a one-second hold; locking (and a jammed retry) is a tap',
   /var HOLD_MS = 1000;/.test(src) && /hold: locked \? \['lock', 'unlock'\] : null/.test(src) &&
   /tap: open \|\| jammed \|\| unsure \? \['lock', 'lock'\] : null/.test(src));
ok('the garage is the lock\'s ring: hold to open, tap to close, tap to stop while it moves',
   !!customElements.get('hk-detail-garage') && /class GaragePanel extends RingPanel/.test(src) &&
   /hold: st === 'closed' && \(f & 1\) \? \['cover', 'open_cover'\] : null/.test(src) &&
   /tap: \(st === 'open' \|\| unsure\) && \(f & 2\) \? \['cover', 'close_cover'\] : stop/.test(src));
ok('the keyboard cannot unlock or open without a confirmation', /if \(sp\.hold\) C\.confirmSheet\(sp\.ask/.test(src) &&
   /ask: 'Unlock '/.test(src) && /ask: 'Open '/.test(src));
ok('the thermostat is hk-thermostat-card, bare, with the readings centered in their thirds',
   /createElement\('hk-thermostat-card'\)/.test(src) && /bare: true, glass: false/.test(src) && /text-align:center\}/.test(src));
var ctl = readFile(HK_ROOT + '/frontend/cards/hk-control.js');
ok('hk-control-card: bare beyond media drops the plate and the header, and stays out of the blur',
   /body\.replace\('class="surface', 'class="surface bare'\)/.test(ctl) && /\.surface\.bare \.head/.test(ctl) &&
   /if \(this\._config && this\._config\.bare\) return;/.test(ctl));

print('\n=== media, sensors ===');
ok('the media and sensor panels are defined', !!customElements.get('hk-detail-media') && !!customElements.get('hk-detail-sensor') &&
   !!customElements.get('hk-detail-binary') && !!customElements.get('hk-detail-state'));
ok('a speaker gets Browse Music (focus the speaker, then the Browse view); a TV gets Input and power',
   /hkMusic\.setFocus/.test(src) && /'select_source'/.test(src) && /pw\.classList\.toggle\('lit'/.test(src));
ok('the TV\'s input falls back to the app it is in', /a\.source \|\| a\.app_name/.test(src));
ok('the artwork is the Play Music cover: no frame, a soft shadow', !/\.art\{[^']*border:\d+px solid/.test(src) &&
   /\.art\{[^']*box-shadow:0 10px 26px/.test(src));
ok('an idle speaker draws its placeholder on the FIRST paint', /var pic = a\.entity_picture_local \|\| a\.entity_picture \|\| '';/.test(src));
// Music Assistant's entity_picture is http://<ip>:8095: mixed content on
// https, and refused by an https proxy on its way through the art proxy, so no
// cover shows in Safari or on a tablet. _local is HA's own media_player_proxy
ok('the cover is HA\'s own proxy first (entity_picture_local), as the now-playing bar',
   src.indexOf('a.entity_picture_local || a.entity_picture') > 0);
ok('no level, but steps: volume down and up, not a guessing slider',
   /step = !level && !!\(f & MF\.VOLUME_STEP\)/.test(src) && /'volume_down'/.test(src) && /'volume_up'/.test(src));
ok('the hidden attribute beats a panel\'s display rule', /\[hidden\]\{display:none!important\}/.test(src));
ok('energy totals name their span (the headline is today\'s meter)', /'24-hour total'/.test(src) && /'Peak hour'/.test(src));
ok('the header is the glyph and the name, nothing under it -- and the name labels the dialog',
   !/class="st"/.test(src) && !/hkStatus|hkNoun|statusOf/.test(src) &&
   /'<div class="tx"><div class="tt" id="hkd-t' \+ tok \+ '"><\/div><\/div>'/.test(src) &&
   /aria-labelledby="hkd-t' \+ tok \+ '"/.test(src));
ok('a sensor says when it last changed in the sheet itself', /this\._upd\.textContent = /.test(src) && /'Updated just now'/.test(src));

print('\n=== vacuum, valve, controls ===');
ok('the vacuum, valve and control panels are defined', ['vacuum', 'valve', 'number', 'select', 'humidifier', 'water-heater'].every(function (k) {
  return !!customElements.get('hk-detail-' + k); }));
ok('the vacuum reads the vacuum page\'s sensors, else finds them on its own device',
   /battery: c\.battery \|\| find\(null, 'battery'\)/.test(src) && /function deviceSensor\(/.test(src));
ok('a docked vacuum shows no room or progress (those are last run\'s)', /if \(live\) \{\s*var room/.test(src));
ok('the four commands only where the vacuum supports them', /\(f & c\[3\] \? '' : ' disabled'\)/.test(src));
ok('a valve is the lock\'s ring, held BOTH ways, never tapped',
   /class ValvePanel extends RingPanel/.test(src) && /\['valve', 'open_valve'\] : \(st === 'open' \|\| unsure\) && \(f & 2\) \? \['valve', 'close_valve'\]/.test(src) &&
   /tap: null,\s*hint: st === 'closed' \? 'Hold to open'/.test(src));
ok('unknown is no reading, not no control: a switch, lock, garage or valve that has not reported still takes the safe command',
   /function gone\(s\) \{ return !s \|\| s\.state === 'unavailable'; \}/.test(src) && /this\._tg\.disabled = gone\(s\);/.test(src) &&
   /bad = jammed \|\| gone\(s\), unsure = st === 'unknown'/.test(src));
ok('the valve is water blue when it runs, gray when shut', /\.lk\.water \.core\{background:#56bde4\}/.test(src) &&
   /\.lk\.water\.shut \.core\{background:rgba\(255,255,255,0\.22\)\}/.test(src));
ok('a select is its list (the orange tick on the current row, search past 12)', /function pickList\(/.test(src) &&
   /options\.length > 12/.test(src) && /'select_option', \{ option: o \}/.test(src));
ok('a number maps its slider across min..max in its own steps', /r\.lo \+ Math\.round\(v \* r\.n\) \* r\.step/.test(src) &&
   /'set_value', \{ value:/.test(src));

ok('Clean Areas: this robot\'s mapped rooms (a dry-run plan, nothing sent), sent to THIS robot only',
   /'hk_frontend', 'clean_areas', \{ areas: Object\.keys\(h\.areas \|\| \{\}\), dry_run: true \}/.test(src) &&
   /added\('clean_areas'\)/.test(src) &&
   /p\.vacuum === id && p\.action === 'clean_area'/.test(src) && /self\._svc\('vacuum', 'clean_area', \{ cleaning_area_id: areas \}\)/.test(src));
// a failed send keeping the rooms picked is exercised in test_detail_behaviour.js

print('\n=== thermostat run time ===');
(function () {
  var mid = new Date(2026, 8, 26, 0, 0, 0).getTime(), ymid = new Date(2026, 8, 25, 0, 0, 0).getTime();
  var row = function (t, act) { return { s: 'heat_cool', a: { hvac_action: act }, lu: t / 1000 }; };
  var H = 3600000, now = mid + 10 * H;
  var rows = [row(ymid - 2 * H, 'cooling'),     // running before yesterday: only from ymid counts
              row(ymid + 1 * H, 'idle'),
              row(ymid + 23 * H, 'cooling'),    // across midnight: 1 h yesterday, 0.5 h today
              row(mid + 0.5 * H, 'idle'),
              row(mid + 9 * H, 'heating')];     // still running: 9:00 -> now (10:00)
  var t = _.runTimes(rows, now, { attributes: { hvac_action: 'heating' } });
  ok('yesterday: 1 h from its midnight + 1 h up to ours', Math.round(t.yesterday / 60) === 120, t);
  ok('today: the half hour past midnight + the hour still running', Math.round(t.today / 60) === 90, t);
  var idle = _.runTimes([row(mid + 2 * H, 'idle')], now, { attributes: { hvac_action: 'idle' } });
  ok('an idle day is 0', idle.today === 0 && idle.yesterday === 0, idle);
  ok('durations read "45 min", "2 hr", "2 hr 4 min"', _.dur(2700) === '45 min' && _.dur(7200) === '2 hr' && _.dur(7444) === '2 hr 4 min');
  ok('the sheet shows Ran today and Yesterday, from history (no run-time sensors needed)',
     /<div class="k">Ran today<\/div>/.test(src) && /'history\/history_during_period'/.test(src) && !/hvac_run_time/.test(src));
})();

print('\n=== one height, two widths, axes ===');
ok('every control sheet one height (680) and one of two widths (460 / 820); the camera sheet the pop-ups\' 1200, as tall as its picture',
   _.SHEET_H === 680 && _.STD === 460 && _.WIDE === 820 && _.WIDTH.camera === 1200 &&
   Object.keys(_.WIDTH).every(function (k) { return k === 'camera' || _.WIDTH[k] === 460 || _.WIDTH[k] === 820; }) &&
   /hkAutoHeight\(\) \{ return true; \}/.test(src) &&
   _.WIDTH.climate === 820 && _.WIDTH.sensor === 820 && _.WIDTH.binary === 460 && _.WIDTH.media_tv === 460);
// Every phone sheet is one height, the speaker's (643); a short screen still
// takes screen - 80, and the tall ones scroll inside it
ok('a phone sheet is the speaker\'s height (643), never more than the screen less 40 (20 a side on an iPhone SE); content centered by auto margins (a tall one scrolls from the top)',
   _.PHONE_H === 643 && /height:min\(' \+ PHONE_H \+ 'px, calc\(var\(--hk-vh, 100dvh\) - 40px\)\)/.test(src) &&
   /'\.hkd \.body > \*\{margin-block:auto\}'/.test(src));
ok('the heater dial lets a vertical swipe scroll the sheet (pan-y, as the thermostat ring)',
   /\.dl\{position:relative;width:100%;max-width:var\(--hk-tstat-ring,300px\);touch-action:pan-y/.test(src));
ok('ticks are round steps of 1, 2, 5 or 10 -- never 2.5', JSON.stringify(_.niceTicks(70.3, 78.4, 4)) === '[70,75,80]' &&
   JSON.stringify(_.niceTicks(0, 4.02, 4)) === '[0,2,4,6]' && JSON.stringify(_.niceTicks(1, 1, 4)) === '[0,1,2]');
ok('tick labels carry the unit\'s mark and shorten thousands', _.tickText(75, '°F') === '75°' && _.tickText(45, '%') === '45%' &&
   _.tickText(1500, 'W') === '1.5k' && _.tickText(2.5, 'kWh') === '2.5');
ok('small-power and fine-temperature ticks stay distinct',
   _.tickText(0.015, 'kW', 0.005) === '0.015' && _.tickText(0.02, 'kW', 0.005) === '0.02' &&
   _.tickText(72.2, '°F', 0.2) === '72.2°' && _.tickText(1050, 'W', 50) === '1.05k');
ok('times along a day end at Now, along a week at Today', (function () {
  var d = _.timeTicks(86400000, 5), w = _.timeTicks(7 * 86400000, 5);
  return d.length === 5 && d[4].t === 'Now' && d[0].f === 0 && d[4].f === 1 && w[4].t === 'Today';
})());
ok('the select list fills the sheet, rows 52 to 68', /hkFill\(\) \{ return true; \}/.test(src) && /var ROW_MAX = 68;/.test(src) &&
   /':host > div\{flex:1;min-height:0;display:flex;flex-direction:column\}'/.test(src));
ok('the thermostat: two columns in a wide sheet, the trend fluid so both columns end together; the right column starts at the dial\'s track',
   /:host\(\[wide\]\) \.pn\{flex-direction:row/.test(src) && /fluid: wide/.test(src) && /_alignTop\(\)/.test(src));
// Safari matches no @container rule in a shadow tree against :host: the
// width is decided in script (the wide attribute), never by a container query
ok('no panel relies on a CSS container query (Safari would keep the thermostat stacked)',
   !/'@container/.test(src) && !/container-type:/.test(src) && (src.match(/_wideAt\(\) \{ return 700; \}/g) || []).length === 2 &&
   /_wideAt\(\) \{ return window\.matchMedia && matchMedia\(SHORT_MQ\)\.matches \? Infinity : 700; \}/.test(src) &&
   /new ResizeObserver/.test(src));
ok('the water heater dial sweeps 270 degrees from the lower left', /A0: 135, SWEEP: 270/.test(src) && /^M/.test(_.arcPath(0.5)));
// The water heater and the thermostat look the same and are the same size:
// the heater's ring is hk-control's, number for number, and sized by the same
// variables on the same wide sheet
ok('the water heater ring is the thermostat card\'s ring', (function () {
  var ctl = readFile(HK_ROOT + '/frontend/cards/hk-control.js');
  return /viewBox="0 0 200 172"/.test(ctl) && /_arc\(0, 1, 78\)/.test(ctl) && /r="13"/.test(ctl) &&
    /\.ring \.trk\{fill:none;stroke:\$\{window\.hkCards\.v\('line-strong'\)\};stroke-width:22px/.test(ctl) &&
    /var WD = \{ W: 200, H: 172, CX: 100, CY: 100, R: 78, A0: 135, SWEEP: 270 \}/.test(src) &&
    /class="kn" r="13"/.test(src) && /\.dl \.trk\{fill:none;stroke:' \+ window\.hkCards\.v\('line-strong'\) \+ ';stroke-width:22px/.test(src) &&
    /max-width:var\(--hk-tstat-ring,300px\)/.test(src) && /water_heater: WIDE/.test(src) &&
    (src.match(/':host\(\[wide\]\) \.dial\{' \+ TSTAT_WIDE \+ '\}'/g) || []).length === 2;
})());
ok('rings 264, the switch 150 x 320, sliders 440', /\.lk\{position:relative;width:264px;height:264px/.test(src) &&
   /\.tg\{position:relative;width:150px;height:320px/.test(src) && /\.vs\{position:relative;width:150px;height:440px/.test(src));

print('\n=== the alarm: just the keypad, as a sheet ===');
ok('the alarm is a sheet like the rest: the state word over hk-alarm-keypad-card, standard width',
   !!customElements.get('hk-detail-alarm') && _.PANELS.alarm === 'hk-detail-alarm' && _.WIDTH.alarm === 460 &&
   /createElement\('hk-alarm-keypad-card'\)/.test(src) && /setConfig\(Object\.assign\(\{ entity: this\._id, glass: false, status: false \}, short \? \{ layout: 'side' \} : \{\}\)\)/.test(src));
ok('a tap on the alarm opens its sheet directly, never through the #alarm pop-up',
   !/kind === 'alarm' && !opts\.direct && window\.hkPopup/.test(src) && !/window\.hkPopup\.open\('#alarm'\)/.test(src));
ok('opened for a hash it pushes no history entry of its own, and says when it has gone',
   /if \(opts\.hashed\) d\.pushed = false;/.test(src) && /if \(d\.onClose\) \{ try \{ d\.onClose\(\); \}/.test(src));
var pop = readFile(HK_ROOT + '/frontend/cards/hk-popup.js');
ok('hk-popup: `detail:` opens the sheet for the hash and clears the hash when it closes',
   /if \(this\._config\.detail\) \{ this\._syncDetail\(want\); return; \}/.test(pop) &&
   /direct: true, hashed: true, onClose: function \(\) \{/.test(pop) && /if \(location\.hash === hash\) setHash\(''\);/.test(pop));

// hk-base's BASE_CSS is adopted into every HkBase shadow root, so a class
// name it owns restyles anything here that reuses it: ".pill" would draw a
// dark box behind every sheet button (glass marker + grid + shadow).
(function () {
  var b = readFile(HK_ROOT + '/frontend/cards/hk-base.js');
  var base = b.slice(b.indexOf('  var BASE_CSS = ['), b.indexOf('].join', b.indexOf('  var BASE_CSS = [')));
  var owned = {};
  (base.match(/\.([a-zA-Z][\w-]*)/g) || []).forEach(function (m) { owned[m.slice(1)] = 1; });
  ['M', 'css', 'js', 'glass', 'border', 'radius', 'shSm', 'start', 'txt', 'well'].forEach(function (k) { delete owned[k]; });
  var code = src.replace(/\/\/.*$/mg, '');
  var clash = Object.keys(owned).filter(function (c) {
    return new RegExp("'\\s*\\." + c + "[\\s{,.:>\\[]").test(code) || new RegExp('(class="|className = \'|class=\\\\?")[^"\']*\\b' + c + '\\b').test(code);
  });
  ok('no panel class clashes with a BASE_CSS class (a shared .pill draws a box behind every button)', clash.length === 0, clash);
})();

print('\n=== interception ===');
function ev(tags) { return { composedPath: function () { return tags.map(function (t) { return { tagName: t }; }); } }; }
ok('taken from a dashboard', _.fromDashboard(ev(['HK-TILE-CARD', 'DIV', 'HA-PANEL-LOVELACE', 'HOME-ASSISTANT'])));
ok('taken from an hk pop-up (beside the panel)', _.fromDashboard(ev(['HK-LIGHT-CARD', 'DIV', 'HOME-ASSISTANT'])));
ok('NOT from HA\'s Settings screens', !_.fromDashboard(ev(['HA-DATA-TABLE', 'HA-PANEL-CONFIG', 'HOME-ASSISTANT'])));
ok('the capture listener runs before HA\'s, and only takes the tap when a sheet opened', /window\.addEventListener\(window\.hkShell\.events\.moreInfo, function \(e\) \{[\s\S]{0,700}\}, true\);/.test(src) &&
   /if \(!open\(id, src, host \? undefined : \{ generic: off \? 'only' : true \}\)\) return;\s*e\.stopImmediatePropagation\(\);/.test(src));
ok('...a host with a detail of its own keeps what HK leaves (P2.5; test_sheets.js drives it)',
   /if \(host && !fromDashboard\(e\)\) return;/.test(src) && /if \(host && \(off \|\| !kindOf\(C\.client\(\), id\)\)\) return;/.test(src));
ok('the Configure switch, a card\'s detail: false, or hk-detail-off turn it off',
   /C\.setting\('look\.details', true\) === false/.test(src) && /src\.config\.detail === false/.test(src));
ok('a toggle keeps the tile\'s confirmation (EcoFlow circuits, say)', /var conf = this\._src\.confirmation;/.test(src) && /C\.confirmSheet\(/.test(src));

print('\n=== the header glyph is the entity\'s Home app glyph ===');
(function () {
  var U = window.hkDetail._, M = window.hkCards.menu, was = M.config;
  var st = function (state, icon) { return { state: state, attributes: icon ? { icon: icon } : {} }; };
  ok('the tile it was opened from: its icon', U.headIcon({ icon: 'hk:fan' }, st('on')) === 'hk:fan');
  ok('...and its icon for this state', U.headIcon({ icon: 'hk:blinds', icon_states: { closed: 'hk:blinds-closed' } }, st('closed')) === 'hk:blinds-closed');
  ok('`on:` unquoted in YAML (the boolean true) still matches', U.headIcon({ icon: 'hk:lock', icon_states: { 'true': 'hk:lock-open' } }, st('on')) === 'hk:lock-open');
  var cfg = { views: [{ cards: [{ type: 'grid', cards: [
    { type: 'custom:hk-tile-card', entity: 'fan.deck', icon: 'mdi:fan' },
    { type: 'custom:hk-tile-card', entity: 'fan.deck', icon: 'hk:fan', icon_color: 'blue' },
    { type: 'custom:hk-lock-card', entity: 'lock.front', icon: 'hk:lock', icon_states: { unlocked: 'hk:lock-open' } }] }] }] };
  M.config = function () { return cfg; };
  ok('opened from anywhere else: this dashboard\'s card for it, the first with an hk: glyph',
     U.lookOf('fan.deck').icon === 'hk:fan' && U.lookOf('fan.deck').icon_color === 'blue');
  ok('...its states too', U.headIcon(U.lookFor(null, 'lock.front'), st('unlocked')) === 'hk:lock-open');
  ok('a source that names no glyph looks it up', U.lookFor({ name: 'Deck Fan' }, 'fan.deck').icon === 'hk:fan');
  window.hkGlyphs = { icons: { 'ceiling-fan': 1 } };
  ok('no card for it: its own mdi icon as its SF Symbol when the set has one',
     U.headIcon(U.lookFor(null, 'fan.other'), st('on', 'mdi:ceiling-fan')) === 'hk:ceiling-fan');
  ok('...and Home Assistant\'s own icon only when it does not', U.headIcon(U.lookFor(null, 'fan.other'), st('on', 'mdi:weather-cloudy')) === null);
  M.config = was;
})();

// ---- A NOTIFICATION, OPENED: its words and where it goes
(function () {
  var U = window.hkDetail._;
  ok('the spacing scale', U.SP.region === 20 && U.SP.piece === 20 && U.SP.piecePhone === 16 && U.SP.block === 12 && U.SP.line === 6 &&
     U.SP.cardPad === '16px 18px 14px' && U.SP.inset === 18);
  var now = Date.now() / 1000;
  ok('when: now', /^now · \d/.test(U.noteWhen({ ts: now })));
  ok('when: minutes ago', /^5 min ago · \d/.test(U.noteWhen({ ts: now - 300 })));
  ok('when: an hour on, the time alone', /^\d{1,2}:\d{2}/.test(U.noteWhen({ ts: now - 7200 })));
  ok('Go To: None, and a person has no page', U.goFor({}, { go: 'none', entity: 'lock.front' }) === null &&
     U.goFor({}, { kind: 'people', entity: 'person.alex' }) === null);
  // a sheet's card: its words, its buttons (no Go To without a dashboard here).
  // (the shim's innerHTML keeps nothing: these elements keep theirs)
  var mk = document.createElement;
  document.createElement = function (t) {
    var e = mk.call(document, t), v = '';
    Object.defineProperty(e, 'innerHTML', { get: function () { return v; }, set: function (x) { v = String(x); } });
    return e;
  };
  var el = U.noteEl({}, { n: { title: 'Garage Door', message: 'Opened.', ts: now, mute: 'a:cover.garage', icon: 'hk:garage-open', tint: '#ff9f0a' } }, 'card');
  var html = el.innerHTML;
  ok('the card: title, message and when, Mute 1 Hour', html.indexOf('Garage Door') >= 0 && html.indexOf('Opened. · now') >= 0 &&
     html.indexOf('Mute 1 Hour') >= 0);
  var col = U.noteEl({}, { n: { title: 'Leak', message: 'Water detected.', important: true, ts: now } }, 'col');
  ok('the column: Important, and no Mute for an automation’s own', col.innerHTML.indexOf('Important') >= 0 && col.innerHTML.indexOf('Mute') < 0);
  document.createElement = mk;
})();

// THE READOUT: hover or touch a sheet's chart for the value and time under
// it. What it reads is what the plot drew (the same points and range, so the
// dot sits on the line); the look and the gestures are checked in a browser.
print('\n=== the chart readout ===');
(function () {
  var was = window.hkChart;
  window.hkChart = { line: function () { return '<svg></svg>'; }, bars: function () { return '<div></div>'; } };
  var hks = function (html) {
    var m = /data-hks="([^"]*)"/.exec(html);
    return m && JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  };
  var now = Date.now(), HR = 3600000;
  var smallPower = _.axesChart({ pts: [{ t: now - HR, v: 0.012 }, { t: now, v: 0.023 }], H: 200, unit: 'kW', ms: HR });
  var smallLabels = [], tickRe = /<span style="top:[^"]*">([^<]*)<\/span>/g, tick;
  while ((tick = tickRe.exec(smallPower))) smallLabels.push(tick[1]);
  ok('a small-kW chart labels each gridline correctly and sizes its label column',
    JSON.stringify(smallLabels) === '["0.01","0.015","0.02","0.025"]' && /class="sz">0\.015<\/b>/.test(smallPower), smallLabels);
  var line = _.axesChart({ pts: [{ t: now - 2 * HR, v: 180 }, { t: now - HR, v: NaN }, { t: now - HR / 2, v: 450 }, { t: now, v: 355 }],
                           H: 200, unit: 'W', ms: 24 * HR, n: 5 });
  var dl = hks(line);
  ok('a line chart carries what it drew: the finite points, its value range and padding', !!dl && dl.k === 'l' && dl.u === 'W' &&
     dl.p.length === 3 && dl.p[2][1] === 355 && dl.lo === 100 && dl.hi === 500 && dl.pad === 6 && dl.ms === 24 * HR, dl);
  var bars = _.axesChart({ pts: [{ t: now - 2 * HR, v: 0.2 }, { t: now - HR, v: null }, { t: now, v: 0.4 }], bars: true,
                           H: 200, unit: 'kWh', ms: 3 * HR, n: 5 });
  var db = hks(bars);
  ok('a bar chart keeps every column, an empty one as null, its floor at zero', !!db && db.k === 'b' && db.p.length === 3 &&
     db.p[1][1] === null && db.lo === 0 && db.pad === 0, db);
  // the nearest point in time, not the nearest index
  var pl = _.scrubPick(dl, 0.8, now);
  ok('a line picks the point nearest in time and puts the line on it', pl.i === 1 && pl.v === 450 && Math.abs(pl.f - 0.75) < 1e-9, pl);
  ok('the live reading that closes the line is "Now"', _.scrubPick(dl, 1, now).label === 'Now');
  ok('an earlier point is its clock time', /^\d{1,2}:\d\d\s?[AP]M$/i.test(_.scrubPick(dl, 0, now).label), _.scrubPick(dl, 0, now).label);
  var wk = { k: 'l', u: '°F', lo: 60, hi: 80, pad: 6, ms: 168 * HR, p: [[now - 100 * HR, 70], [now - 50 * HR, 72], [now, 71]] };
  ok('across a week the weekday comes too', /^[A-Z][a-z]{2}\s\d{1,2}:\d\d\s?[AP]M$/i.test(_.scrubPick(wk, 0, now).label), _.scrubPick(wk, 0, now).label);
  var pb = _.scrubPick(db, 0.5, now);
  ok('bars pick the column under the finger, its middle', pb.i === 1 && pb.v === null && Math.abs(pb.f - 0.5) < 1e-9, pb);
  var d0 = new Date(); d0.setHours(14, 0, 0, 0);
  var hb = { k: 'b', ms: 2 * HR, p: [[+d0 - 24 * HR, 1], [+d0, 2]] };
  ok('an hour\'s bar is its span: "2 – 3 PM"', /^2\s–\s3\sPM$/i.test(_.scrubPick(hb, 0, +d0 + 2 * HR).label), _.scrubPick(hb, 0, +d0 + 2 * HR).label);
  ok('the hour still going ends at Now', /^2\sPM\s–\sNow$/i.test(_.scrubPick(hb, 0.9, +d0 + HR / 2).label), _.scrubPick(hb, 0.9, +d0 + HR / 2).label);
  var day = { k: 'b', ms: 7 * 24 * HR, p: [] };
  for (var i = 6; i >= 0; i--) day.p.push([+d0 - i * 24 * HR, i]);
  ok('a day\'s bar: Today, Yesterday, then the date', _.scrubPick(day, 0.99, +d0 + HR).label === 'Today' &&
     _.scrubPick(day, 0.8, +d0 + HR).label === 'Yesterday' && /^[A-Z][a-z]{2},\s[A-Z][a-z]{2}\s\d{1,2}$/.test(_.scrubPick(day, 0, +d0 + HR).label),
     [_.scrubPick(day, 0.99, +d0 + HR).label, _.scrubPick(day, 0, +d0 + HR).label]);
  ok('values read as the sheet\'s own: 212 W, 0.42 kWh, 71.3°F, 45%, 1,234 W, a gap as a dash',
     _.scrubValue(212.4, 'W') === '212 W' && _.scrubValue(0.4211, 'kWh') === '0.42 kWh' && _.scrubValue(71.34, '°F') === '71.3°F' &&
     _.scrubValue(45, '%') === '45%' && _.scrubValue(1234, 'W') === '1,234 W' && _.scrubValue(null, 'W') === '—');
  ok('every chart in a sheet listens, and is put back after each redraw', (src.match(/\n\s*scrub\(this\._(chart|trend)\);/g) || []).length === 5);
  ok('a vertical swipe on the plot still scrolls the sheet (pan-y)', /'\.ap\[data-hks\]\{touch-action:pan-y;/.test(src));
  window.hkChart = was;
})();

print('\n' + (fail ? 'FAIL ' + fail + ' DETAIL TESTS' : 'ALL ' + pass + ' DETAIL TESTS PASS'));
if (fail) throw new Error('detail tests failed');
