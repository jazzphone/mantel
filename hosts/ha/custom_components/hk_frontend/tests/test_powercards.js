// The EcoFlow page's cards (hk-energy.js HOME POWER): hk-power-flow-card,
// hk-power-status-card, hk-house-battery-card, hk-segment-card --
// CONSTRUCTED AND DRIVEN against this house's own entity ids and units (the
// panel reports W and kW side by side; the backup runtime in hours).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/modules/hk-charts.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-stat.js');

function powerHouse(over) {
  var rows = {
    'sensor.panel_ac_in': ['1072.0', { unit_of_measurement: 'W' }],
    'sensor.panel_ac_out': ['1072.0', { unit_of_measurement: 'W' }],
    'sensor.battery_charge_power': ['0.0', { unit_of_measurement: 'W' }],
    'sensor.battery_output_power': ['0.0', { unit_of_measurement: 'kW' }],
    'sensor.battery_level': ['86', { unit_of_measurement: '%' }],
    'sensor.stored': ['21.3', { unit_of_measurement: 'kWh' }],
    'sensor.backup': ['15.78', { unit_of_measurement: 'h' }],
    'number.reserve': ['10', { unit_of_measurement: '%' }],
    'number.limit': ['90', { unit_of_measurement: '%' }],
    'number.speed': ['2500', { unit_of_measurement: 'W' }],
    'sensor.pack1': ['86', { unit_of_measurement: '%' }],
    'sensor.pack1_t': ['96.8', { unit_of_measurement: '°F' }],
    'binary_sensor.grid': ['on', {}],
    'binary_sensor.fault': ['off', {}],
    'switch.eps': ['on', {}],
    'binary_sensor.storm': ['off', {}],
    'select.mode': ['none', { options: ['none', 'time_of_use', 'self_powered', 'scheduled'] }]
  };
  Object.keys(over || {}).forEach(function (k) { rows[k] = over[k]; });
  return H.house(rows);
}
var CFG = { grid: 'sensor.panel_ac_in', home: 'sensor.panel_ac_out', charge: 'sensor.battery_charge_power',
            discharge: 'sensor.battery_output_power', level: 'sensor.battery_level', grid_status: 'binary_sensor.grid' };
function drawn(card) { return H.morphed(card._card); }

H.run('power cards', [
  function () {
    H.section('hk-power-flow-card');
    var house = powerHouse(), card = H.make('hk-power-flow-card');
    card.setConfig(Object.assign({ type: 'custom:hk-power-flow-card' }, CFG));
    card.hass = house.hass();
    var html = drawn(card);
    H.ok('no art: the flow chart, the three figures', html.indexOf('class="fchart"') > 0 && html.indexOf('1.07 kW') > 0 && html.indexOf('86%') > 0, html.slice(0, 200));
    H.ok('the grid line flows (1.07 kW in), the battery line does not (standing by)',
      (html.match(/class="run"/g) || []).length === 1 && html.indexOf('Standing by') > 0);
    H.ok('on the grid', html.indexOf('on the grid') > 0);
    H.ok('a tap on a figure opens its sensor: the grid, the house, the battery', html.indexOf('data-more="sensor.panel_ac_in"') > 0 &&
      html.indexOf('data-more="sensor.panel_ac_out"') > 0 && html.indexOf('data-more="sensor.battery_level"') > 0);
    // (1.8.0) NO HOUSE BATTERY: the grid and the house alone
    card.setConfig({ type: 'custom:hk-power-flow-card', grid: CFG.grid, home: CFG.home });
    card.hass = house.hass();
    html = drawn(card);
    H.ok('no battery: two figures, no BATTERY', html.indexOf('class="fchart"') > 0 && html.indexOf('BATTERY') < 0 && html.indexOf('THE HOUSE') > 0, html.slice(0, 300));
    var st = H.make('hk-power-status-card');
    st.setConfig({ type: 'custom:hk-power-status-card', grid: CFG.grid, home: CFG.home, grid_status: CFG.grid_status });
    st.hass = house.hass();
    H.ok('...and the status says nothing of a battery', drawn(st).indexOf('Running on the grid</b>.') > 0 && drawn(st).indexOf('battery') < 0, drawn(st).slice(0, 300));
    card.setConfig(Object.assign({ type: 'custom:hk-power-flow-card', art: '/hk/art/ecoflow/house.webp' }, CFG));
    card.hass = house.hass();
    html = drawn(card);
    H.ok('with art: the picture, its cable lit, the wall battery filled to 86%', html.indexOf('/hk/art/ecoflow/house.webp') > 0 &&
      html.indexOf('run flowline') > 0 && /class="wfill"[^>]*height="82\.6"/.test(html), html.slice(0, 300));
    card.hass = house.set('sensor.battery_output_power', '1.2');
    html = drawn(card);
    H.ok('a battery giving 1.2 kW (its sensor in kW): powering the house, the light falling and flowing into the house',
      html.indexOf('Powering the house') > 0 && html.indexOf('shim down') > 0 && html.indexOf('flowline bat') > 0);
  },
  function () {
    H.section('hk-power-status-card');
    var house = powerHouse(), card = H.make('hk-power-status-card');
    card.setConfig({ type: 'custom:hk-power-status-card', grid_status: 'binary_sensor.grid', problem: 'binary_sensor.fault', level: 'sensor.battery_level',
      backup: 'sensor.backup', home: 'sensor.panel_ac_out', charge: 'sensor.battery_charge_power', discharge: 'sensor.battery_output_power',
      eps: 'switch.eps', storm: 'binary_sensor.storm' });
    card.hass = house.hass();
    var html = drawn(card);
    H.ok('the source first, then the backup, EPS, Storm Mode', html.indexOf('Running on the grid') < html.indexOf('15h 47m') &&
      html.indexOf('15h 47m') < html.indexOf('EPS is on') && html.indexOf('Storm Mode is off') > 0, html);
    H.eq('four rows', (html.match(/class="hli/g) || []).length, 4);
    H.ok('each sentence opens what it is about: the grid, the backup, EPS, Storm Mode', html.indexOf('data-more="binary_sensor.grid"') > 0 &&
      html.indexOf('data-more="sensor.backup"') > 0 && html.indexOf('data-more="switch.eps"') > 0 && html.indexOf('data-more="binary_sensor.storm"') > 0);
    card.hass = house.set('binary_sensor.grid', 'off');
    html = drawn(card);
    H.ok('the grid down: its own red row first, and the backup reads as what is left', html.indexOf('hli alert') > 0 &&
      html.indexOf('The grid is down') < html.indexOf('The battery will last') && html.indexOf('Running on the grid') < 0);
    card.hass = house.set('binary_sensor.fault', 'on');
    html = drawn(card);
    H.eq('a fault too: two red rows', (html.match(/hli alert/g) || []).length, 2);
    card.hass = house.set('binary_sensor.fault', 'off');
    card.hass = house.set('binary_sensor.grid', 'unknown');
    html = drawn(card);
    H.ok('the grid status unknown for a moment: no reading, not an outage', html.indexOf('The grid is down') < 0 && html.indexOf('hli alert') < 0, html.slice(0, 300));
    card.hass = house.set('binary_sensor.grid', 'unavailable');
    H.ok('...nor when unavailable', drawn(card).indexOf('The grid is down') < 0);
  },
  function () {
    H.section('hk-house-battery-card');
    var house = powerHouse(), card = H.make('hk-house-battery-card');
    card.setConfig({ type: 'custom:hk-house-battery-card', level: 'sensor.battery_level', stored: 'sensor.stored', backup: 'sensor.backup',
      reserve: 'number.reserve', limit: 'number.limit', speed: 'number.speed', charge: 'sensor.battery_charge_power',
      discharge: 'sensor.battery_output_power', eps: 'switch.eps', packs: [{ level: 'sensor.pack1', temperature: 'sensor.pack1_t' }] });
    card.hass = house.hass();
    var html = drawn(card);
    H.ok('filled to 86%, the reserve and the limit marked where they belong', html.indexOf('class="fill" style="width:86%"') > 0 &&
      html.indexOf('* 0.1)') > 0 && html.indexOf('Reserve 10%') > 0 && html.indexOf('* 0.9)') > 0 && html.indexOf('Limit 90%') > 0, html.slice(0, 400));
    H.ok('21.3 kWh and 15h 47m of backup in it, one line', html.indexOf('<span>21.3 kWh · 15h 47m of backup</span>') > 0 && html.indexOf('at this load') < 0);
    H.ok('the pack with its temperature; EPS; the charging speed', html.indexOf('97°F') > 0 && html.indexOf('>On<') > 0 && html.indexOf('2.50<u>kW</u>') > 0);
    H.ok('standing by: no light running', html.indexOf('hshim') < 0 && html.indexOf('standing by') > 0);
    H.ok('the battery opens its level, a pack its own', html.indexOf('class="cell" data-more="sensor.battery_level"') > 0 && html.indexOf('class="pk2" data-more="sensor.pack1"') > 0);
    card.hass = house.set('sensor.battery_charge_power', '800');
    H.ok('charging: light running forward', drawn(card).indexOf('class="hshim"') > 0 && drawn(card).indexOf('>charging<') > 0);
    card.hass = house.set('sensor.battery_level', '8');
    H.ok('at or under its reserve: red', drawn(card).indexOf('class="fill low"') > 0);
  },
  function () {
    H.section('hk-segment-card');
    var house = powerHouse(), card = H.make('hk-segment-card');
    card.setConfig({ type: 'custom:hk-segment-card', entity: 'select.mode', options: [
      { value: 'none', name: 'Off', description: 'Grid passes through.' }, { value: 'self_powered', name: 'Self-Powered', description: 'Battery first.' }] });
    card.hass = house.hass();
    var html = drawn(card);
    H.ok('the options given, the current one pressed, its line under them', html.indexOf('data-v="none" aria-selected="true">Off') > 0 &&
      html.indexOf('Grid passes through.') > 0 && html.indexOf('Time Of Use') < 0);
    card._choose('self_powered');
    H.eq('a choice asks the select', house.calls.slice(-1)[0], { domain: 'select', service: 'select_option', data: { entity_id: 'select.mode', option: 'self_powered' } });
    H.ok('...and shows at once', drawn(card).indexOf('data-v="self_powered" aria-selected="true"') > 0 && drawn(card).indexOf('Battery first.') > 0);
    var plain = H.make('hk-segment-card');
    plain.setConfig({ type: 'custom:hk-segment-card', entity: 'select.mode' });
    plain.hass = house.hass();
    H.ok('no options given: the select\'s own, prettied', drawn(plain).indexOf('>Time Of Use<') > 0 && drawn(plain).indexOf('>Self Powered<') > 0);
    H.runTimers();
  },
  function () {
    H.section('powerSplit: Home Assistant\'s order');
    var S = window.hkEnergyPage.__powerSplit;
    var r = S({ solar: 5000, imp: 0, exp: 1500, bc: 2000, bd: 0, home: 1500 });
    H.ok('the sun sells first, then charges, then the house', r.s2g === 1500 && r.s2b === 2000 && r.s2h === 1500 && r.main === 'sun', JSON.stringify(r));
    r = S({ solar: 1000, imp: 2500, exp: 0, bc: 2000, bd: 0, home: 1500 });
    H.ok('the sun short of the battery: the grid makes up the rest, and the house is all grid', r.s2b === 1000 && r.g2b === 1000 && r.s2h === 0 && r.g2h === 1500 && r.main === 'grid', JSON.stringify(r));
    r = S({ solar: 0, imp: 0, exp: 0, bc: 0, bd: 900, home: null });
    H.ok('night on the battery: the house worked out (900 W), all battery', r.home === 900 && r.b2h === 900 && r.main === 'batt', JSON.stringify(r));
    r = S({ solar: 0, imp: 0, exp: 0, bc: 0, bd: 0, home: 0 });
    H.ok('nothing flowing: no main source', r.main === null);
  },
  function () {
    H.section('hk-power-house-card');
    var BASE = '/hk/art/my-house/';
    window.hkEnergyPage.__art(BASE, {"canvas": [1536, 1024], "anchors": {"grid": [62, 236], "solar": [699, 301], "house": [527, 780], "battery": [1432.5, 719], "cars": [1148, 818]}, "battery_window": [[1405, 722], [1457, 719], [1457, 890], [1405, 896]], "paths": {"grid": [[96.0, 286.0], [121.17, 365.77], [156.38, 436.62], [195.14, 486.67], [231.0, 504.0], [237.63, 516.07], [245.37, 515.93], [248.0, 506.0], [240, 500], [240, 610]], "solar_to_battery": [[760, 397], [760, 436], [756, 480], [740, 550], [715, 605], [783, 657], [900, 675], [1130, 675], [1337, 675], [1405, 719]], "battery_to_house": [[1405, 810], [1377, 805], [1355, 798], [1340, 794]], "to_charger_a": [[1405, 812], [1378, 811], [1341, 808], [1310, 680], [1145, 691], [965, 708], [908, 725], [908, 790]]}, "chargers": {"a": [908, 790]}, "cars": {"a": {"port": [1026, 858], "cable": [[908.0, 805.0], [913.67, 837.99], [921.9, 861.34], [932.61, 876.15], [945.7, 883.54], [961.1, 884.63], [978.71, 880.51], [998.45, 872.31], [1020.24, 861.13], [1026, 858]]}}, "windows": [], "layers": {"house": ["house.trim.webp", 2, 197, 1534, 827], "solar": ["solar.trim.webp", 370, 199, 661, 215], "battery": ["battery.trim.webp", 1340, 695, 134, 216], "pole": ["pole.trim.webp", 30, 233, 224, 618], "charger": ["charger.trim.webp", 892, 770, 28, 44], "car": ["car.trim.webp", 1001, 789, 379, 222], "cable": ["cable.trim.webp", 902, 800, 129, 92]}, "bar_cx": 1432.5, "crop": 150, "max_height": 560, "chip_side": {"battery": "r", "cars": "l", "grid": "r"}, "fade": {"right": [0.86, 0.985], "bottom": [0.9, 1]}});
    var house = powerHouse({ 'sensor.main_power': ['1.84', { unit_of_measurement: 'kW' }], 'sensor.solar': ['0', { unit_of_measurement: 'W' }],
      'sensor.car_level': ['52', { unit_of_measurement: '%' }], 'sensor.car_power': ['0', { unit_of_measurement: 'kW' }],
      'device_tracker.car': ['home', {}], 'binary_sensor.car_cable': ['on', {}], 'switch.car_charge': ['off', {}] });
    var HC = { type: 'custom:hk-power-house-card', art: BASE, home: 'sensor.main_power', grid: 'sensor.main_power', grid_status: 'binary_sensor.grid',
      level: 'sensor.battery_level', charge: 'sensor.battery_charge_power', discharge: 'sensor.battery_output_power', reserve: 'number.reserve',
      cars: [{ name: 'Blue Car', level: 'sensor.car_level', power: 'sensor.car_power', home: 'device_tracker.car', plugged: 'binary_sensor.car_cable', charge: 'switch.car_charge' }] };
    var card = H.make('hk-power-house-card');
    card.setConfig(HC);
    card.hass = house.hass();
    var html = drawn(card);
    // NO PICTURE FOLDER: the house that ships (frontend/power-house, 2026-10-14)
    window.hkEnergyPage.__art('/hk/power-house/', {"canvas": [1536, 1024], "anchors": {"grid": [62, 236], "solar": [699, 301], "house": [527, 780], "battery": [1432.5, 719], "cars": [1148, 818]}, "battery_window": [[1405, 722], [1457, 719], [1457, 890], [1405, 896]], "paths": {"grid": [[96.0, 286.0], [121.17, 365.77], [156.38, 436.62], [195.14, 486.67], [231.0, 504.0], [237.63, 516.07], [245.37, 515.93], [248.0, 506.0], [240, 500], [240, 610]], "solar_to_battery": [[760, 397], [760, 436], [756, 480], [740, 550], [715, 605], [783, 657], [900, 675], [1130, 675], [1337, 675], [1405, 719]], "battery_to_house": [[1405, 810], [1377, 805], [1355, 798], [1340, 794]], "to_charger_a": [[1405, 812], [1378, 811], [1341, 808], [1310, 680], [1145, 691], [965, 708], [908, 725], [908, 790]]}, "chargers": {"a": [908, 790]}, "cars": {"a": {"port": [1026, 858], "cable": [[908.0, 805.0], [913.67, 837.99], [921.9, 861.34], [932.61, 876.15], [945.7, 883.54], [961.1, 884.63], [978.71, 880.51], [998.45, 872.31], [1020.24, 861.13], [1026, 858]]}}, "windows": [], "layers": {"house": ["house.trim.webp", 2, 197, 1534, 827], "solar": ["solar.trim.webp", 370, 199, 661, 215], "battery": ["battery.trim.webp", 1340, 695, 134, 216], "pole": ["pole.trim.webp", 30, 233, 224, 618], "charger": ["charger.trim.webp", 892, 770, 28, 44], "car": ["car.trim.webp", 1001, 789, 379, 222], "cable": ["cable.trim.webp", 902, 800, 129, 92]}, "bar_cx": 1432.5, "crop": 150, "max_height": 560, "chip_side": {"battery": "r", "cars": "l", "grid": "r"}, "fade": {"right": [0.86, 0.985], "bottom": [0.9, 1]}});
    var bare = H.make('hk-power-house-card');
    bare.setConfig(Object.assign({}, HC, { art: undefined }));
    bare.hass = house.hass();
    var bh = drawn(bare);
    H.ok('no Picture Folder: the house that comes with HK Frontend', bh.indexOf('/hk/power-house/house.trim.webp') > 0 && bh.indexOf('No picture folder') < 0, bh.slice(0, 200));
    H.ok('the house, the battery, the pole, the charger and the car: each trimmed layer at its place', html.indexOf('house.trim.webp') > 0 && html.indexOf('battery.trim.webp') > 0 &&
      html.indexOf('pole.trim.webp') > 0 && html.indexOf('charger.trim.webp') > 0 && html.indexOf('car.trim.webp') > 0, html.slice(0, 300));
    H.ok('no solar configured: no panels, no Sun chip', html.indexOf('solar.trim.webp') < 0 && html.indexOf('The Sun') < 0 && html.indexOf('>Sun<') < 0);
    H.ok('buying 1.84 kW: the pole\'s cable glows (orange), the chip says so', html.indexOf('class="flowdot"') > 0 && html.indexOf('#ff9f0a') > 0 && html.indexOf('1.84<u>kW</u>') > 0);
    H.ok('the cable is a smooth curve (no corners), its light an HTML dot on transform keyframes -- the compositor\'s, not the picture\'s SVG',
      / C[\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+/.test(html) && html.indexOf('class="comet"') < 0 && /@keyframes hkf[a-z0-9]+\{0\.00%\{transform:translate\(/.test(html), html.slice(0, 300));
    H.ok('...at an even pace: 3.5 to 6 s a trip, whatever the watts', /linear infinite/.test(html) && /animation:hkf[a-z0-9]+ (3\.[5-9]\d|[45]\.\d\d|6\.00)s/.test(html));
    H.ok('the battery\'s level bar at 86%, standing by: no light in it', html.indexOf('class="lvtrack"') > 0 && html.indexOf('lvrun') < 0 && html.indexOf('86<u>%</u>') > 0);
    H.ok('a tap on a chip opens its sensor', html.indexOf('data-more="sensor.main_power"') > 0 && html.indexOf('data-more="sensor.battery_level"') > 0 && html.indexOf('data-more="sensor.car_level"') > 0);
    H.ok('the car home, not charging: its row, its name and its level; its cable not lit',
      html.indexOf('<div class="crow" data-more="sensor.car_level"><b>Blue Car</b><span>52<u>%</u></span>') > 0 && html.indexOf('>Car</div>') > 0 && html.indexOf('class="portdot"') < 0);
    H.ok('...plugged in (its cable sensor on): the cable drawn', html.indexOf('cable.trim.webp') > 0);
    card.hass = house.set('binary_sensor.car_cable', 'off');
    html = drawn(card);
    H.ok('home, unplugged and not charging: the car drawn, no cable (2026-10-28)', html.indexOf('car.trim.webp') > 0 && html.indexOf('cable.trim.webp') < 0);
    card.hass = house.set('binary_sensor.car_cable', 'on');
    card.hass = house.set('sensor.car_power', '7.7');
    html = drawn(card);
    H.ok('charging 7.7 kW: the cable lit, the port breathing, the chip shows the watts', html.indexOf('class="portdot"') > 0 && (html.match(/class="flowdot"/g) || []).length === 2 && html.indexOf('7.70<u>kW</u>') > 0);
    card.hass = house.set('sensor.battery_charge_power', '800');
    H.ok('the battery charging: light rising in the bar, its top glowing', drawn(card).indexOf('class="lvrun"') > 0 && drawn(card).indexOf('class="lvtop"') > 0);
    card.hass = house.set('sensor.battery_level', '8');
    H.ok('at or under the reserve: the bar turns red', drawn(card).indexOf('#c42a22') > 0);
    card.hass = house.set('device_tracker.car', 'not_home');
    html = drawn(card);
    H.ok('the car away: no car drawn, the chip says Away', html.indexOf('car.trim.webp') < 0 && html.indexOf('>Away<') > 0);
    card.hass = house.set('device_tracker.car', 'unavailable');
    html = drawn(card);
    H.ok('its location unavailable (the maker\'s cloud): still drawn, not Away', html.indexOf('car.trim.webp') > 0 && html.indexOf('>Away<') < 0);
    card.hass = house.set('binary_sensor.grid', 'unknown');
    H.ok('the grid status unknown: not Down', drawn(card).indexOf('>Down<') < 0);
    card.hass = house.set('sensor.battery_level', 'unavailable');
    html = drawn(card);
    H.ok('no battery level: the chip says —, no empty bar drawn', html.indexOf('—') > 0 && html.indexOf('class="lvtrack"') < 0);
    card.hass = house.set('sensor.battery_level', '8');
    card.hass = house.set('device_tracker.car', 'not_home');
    card.hass = house.set('binary_sensor.grid', 'off');
    H.ok('the grid down: its chip says so, in red, and its cable is dark', drawn(card).indexOf('>Down<') > 0 && drawn(card).indexOf('#ff453a') > 0 && drawn(card).indexOf('#ff9f0a"') < 0);
    // TWO CARS, two Wall Connectors: each car its own charger (its
    // settings), so each row its own watts -- whichever car started first
    var two = H.make('hk-power-house-card');
    var h3 = powerHouse({ 'sensor.main_power': ['16000', { unit_of_measurement: 'W' }], 'sensor.left_wc': ['7600', { unit_of_measurement: 'W' }], 'sensor.right_wc': ['0', { unit_of_measurement: 'W' }],
      'sensor.a_level': ['61', { unit_of_measurement: '%' }], 'sensor.b_level': ['80', { unit_of_measurement: '%' }], 'device_tracker.a': ['home', {}], 'device_tracker.b': ['home', {}],
      'sensor.a_power': ['0', { unit_of_measurement: 'kW' }], 'sensor.b_power': ['7.7', { unit_of_measurement: 'kW' }] });
    var CARS2 = [{ name: 'Red Car', level: 'sensor.a_level', power: 'sensor.a_power', home: 'device_tracker.a', charger: 'sensor.left_wc' },
                 { name: 'Blue Car', level: 'sensor.b_level', power: 'sensor.b_power', home: 'device_tracker.b', charger: 'sensor.right_wc' }];
    two.setConfig(Object.assign({}, HC, { cars: CARS2, chargers: ['sensor.left_wc', 'sensor.right_wc'] }));
    two.hass = h3.hass();
    html = drawn(two);
    H.ok('two cars: Cars, a row each; the left charger\'s 7.6 kW is Red Car\'s (its own reading says 0), Blue Car at 80% (its stale 7.7 kW ignored)',
      html.indexOf('>Cars</div>') > 0 && /<b>Red Car<\/b><span class="chg"[^>]*><i class="blt"><\/i>7\.60<u>kW<\/u>/.test(html) && html.indexOf('<b>Blue Car</b><span>80<u>%</u>') > 0, html.slice(html.indexOf('crows'), html.indexOf('crows') + 400));
    two.hass = h3.set('sensor.right_wc', '7700');
    H.ok('both charging: both rows with their watts', /Red Car<\/b><span class="chg"[^>]*><i class="blt"><\/i>7\.60/.test(drawn(two)) && /Blue Car<\/b><span class="chg"[^>]*><i class="blt"><\/i>7\.70/.test(drawn(two)));
    two.hass = h3.set('device_tracker.a', 'not_home');
    two.hass = h3.set('sensor.right_wc', '0');
    html = drawn(two);
    H.ok('Red Car away, its charger still drawing: Away on its row, the watts "A car"', html.indexOf('<b>Red Car</b><span class="away">Away</span>') > 0 && /<b>A car<\/b><span class="chg"/.test(html));
    var ownR = H.make('hk-power-house-card');
    var h4 = powerHouse({ 'sensor.main_power': ['9000', { unit_of_measurement: 'W' }], 'sensor.a_level': ['61', { unit_of_measurement: '%' }], 'device_tracker.a': ['not_home', {}],
      'sensor.a_power': ['150', { unit_of_measurement: 'kW' }] });
    ownR.setConfig(Object.assign({}, HC, { cars: [{ name: 'Red Car', level: 'sensor.a_level', power: 'sensor.a_power', home: 'device_tracker.a', charger: 'sensor.a_power' }] }));
    ownR.hass = h4.hass();
    H.ok('its own reading as its charger, away at a Supercharger: not charging at the house', !/class="chg"/.test(drawn(ownR)) && drawn(ownR).indexOf('>Away<') > 0);
    var sun = H.make('hk-power-house-card');
    var h2 = powerHouse({ 'sensor.main_power': ['-1200', { unit_of_measurement: 'W' }], 'sensor.solar': ['5.4', { unit_of_measurement: 'kW' }] });
    sun.setConfig(Object.assign({}, HC, { solar: 'sensor.solar', cars: [] }));
    sun.hass = h2.hass();
    html = drawn(sun);
    H.ok('with solar: the panels and their glint, the Sun chip', html.indexOf('solar.trim.webp') > 0 && html.indexOf('class="glint"') > 0 && html.indexOf('5.40<u>kW</u>') > 0);
    H.ok('selling 1.2 kW: To the Grid, the cable lit yellow, running back', html.indexOf('To the </span>Grid') > 0 && html.indexOf('#ffd60a') > 0 && / linear infinite reverse/.test(html));
    H.ok('no cars configured: no charger, no Cars chip', html.indexOf('charger.trim.webp') < 0 && html.indexOf('Cars') < 0);
    H.runTimers();
  },
  function () {
    H.section('hk-power-load-card');
    var house = powerHouse({ 'sensor.main_power': ['2.06', { unit_of_measurement: 'kW' }], 'sensor.office': ['232', { unit_of_measurement: 'W' }],
      'sensor.fridge': ['258', { unit_of_measurement: 'W' }], 'sensor.crawl': ['423', { unit_of_measurement: 'W' }], 'sensor.rack': ['492', { unit_of_measurement: 'W' }],
      'sensor.car_power': ['0', { unit_of_measurement: 'kW' }] });
    var card = H.make('hk-power-load-card');
    card.setConfig({ type: 'custom:hk-power-load-card', home: 'sensor.main_power', backed_power: 'sensor.panel_ac_out', grid_status: 'binary_sensor.grid',
      link: './energy', cars: [{ power: 'sensor.car_power' }],
      devices: [{ name: 'Office', power: 'sensor.office', backed: true }, { name: 'Refrigerator', power: 'sensor.fridge', backed: true },
                { name: 'Crawl Space', power: 'sensor.crawl', backed: false }, { name: 'Network Rack', power: 'sensor.rack', backed: true, parent: true }] });
    card.hass = house.hass();
    var html = drawn(card);
    H.ok('the whole house split: 1.07 kW backed up (the panel\'s output), 988 W not', html.indexOf('Backed Up <b>1.07 kW</b>') > 0 && html.indexOf('Not Backed Up <b>988 W</b>') > 0, html.slice(0, 400));
    H.ok('the three drawing the most, marked; a device inside a circuit not counted twice', html.indexOf('Crawl Space<em>not backed up</em>') > 0 &&
      html.indexOf('Refrigerator<em>backed up</em>') > 0 && html.indexOf('Network Rack') < 0);
    H.ok('the battery covers 52% now; Every device opens the Energy page', html.indexOf('<b>52%</b>') > 0 && html.indexOf('data-nav="./energy"') > 0);
    card.hass = house.set('sensor.car_power', '7.7');
    H.ok('a car charging: its own part of the bar', drawn(card).indexOf('Charging <b>') > 0);
    card.hass = house.set('binary_sensor.grid', 'off');
    H.ok('an outage: only the backed-up circuits are on', drawn(card).indexOf('only the backed-up circuits are on') > 0);
    card.hass = house.set('binary_sensor.grid', 'unknown');
    H.ok('the grid status unknown: not an outage', drawn(card).indexOf('only the backed-up circuits are on') < 0 && drawn(card).indexOf('The battery covers') > 0);
    card.hass = house.set('sensor.panel_ac_out', 'unavailable');
    html = drawn(card);
    H.ok('the backed-up reading unavailable: no split and no "covers 0%"', html.indexOf('covers <b>0%') < 0 && html.indexOf('Backed Up') < 0 && html.indexOf('Drawing the most') > 0, html.slice(0, 400));
    var plain = H.make('hk-power-load-card');
    plain.setConfig({ type: 'custom:hk-power-load-card', home: 'sensor.main_power', devices: [{ name: 'Crawl Space', power: 'sensor.crawl' }] });
    plain.hass = house.hass();
    H.ok('no battery: the house and what draws the most, no backed-up words', drawn(plain).indexOf('backed up') < 0 && drawn(plain).indexOf('Drawing the most') > 0);
  },
  function () {
    H.section('hk-power-sun-card and the status');
    var house = powerHouse({ 'sensor.solar': ['5.4', { unit_of_measurement: 'kW' }], 'sensor.main_power': ['-1200', { unit_of_measurement: 'W' }],
      'sensor.car_power': ['7.7', { unit_of_measurement: 'kW' }], 'sensor.car_level': ['52', { unit_of_measurement: '%' }] });
    var sun = H.make('hk-power-sun-card');
    sun.setConfig({ type: 'custom:hk-power-sun-card', solar: 'sensor.solar', grid: 'sensor.main_power', charge: 'sensor.battery_charge_power', discharge: 'sensor.battery_output_power' });
    sun.hass = house.set('sensor.battery_charge_power', '2000');
    var html = drawn(sun);
    H.ok('right now: 1.2 kW sold, 2 kW to the battery, the rest to the house', html.indexOf('The Grid <b>1.20 kW</b>') > 0 && html.indexOf('Battery <b>2.00 kW</b>') > 0 &&
      html.indexOf('The House <b>2.20 kW</b>') > 0, html.slice(0, 500));
    house = powerHouse({ 'sensor.solar': ['5.4', { unit_of_measurement: 'kW' }], 'sensor.main_power': ['-1200', { unit_of_measurement: 'W' }],
      'sensor.car_power': ['7.7', { unit_of_measurement: 'kW' }], 'sensor.car_level': ['52', { unit_of_measurement: '%' }] });
    var st = H.make('hk-power-status-card');
    st.setConfig(Object.assign({}, CFG, { type: 'custom:hk-power-status-card', solar: 'sensor.solar', grid: 'sensor.main_power',
      cars: [{ name: 'Blue Car', level: 'sensor.car_level', power: 'sensor.car_power' }] }));
    st.hass = house.hass();
    html = drawn(st);
    H.ok('the sun in a sentence, selling back', html.indexOf('<b>The sun</b> is covering') > 0 && html.indexOf('selling') > 0, html.slice(0, 300));
    H.ok('the car charging, from what charges it most', html.indexOf('<b>Blue Car</b> is charging at 7.70 kW, mostly from the sun.') > 0);
  },
  function () {
    H.section('the backed-up badge');
    var house = powerHouse({ 'sensor.office': ['232', { unit_of_measurement: 'W' }] });
    var t = H.make('hk-rank-card');
    t.setConfig({ type: 'custom:hk-rank-card', entity: 'sensor.office', name: 'Office', backed: true });
    t.hass = house.hass();
    var said = function (card) { return (card._e.card.children || []).filter(function (k) { return k.className === 'sr' && /Backed up/.test(k.textContent); }).length; };
    H.ok('a backed-up tile: the battery on its kWh line (the card marked), said for a screen reader, the glyph left alone',
      /\bbkd\b/.test(t._e.card.className || '') && said(t) === 1 && (t._e.well.children || []).length <= 1);
    var u = H.make('hk-rank-card');
    u.setConfig({ type: 'custom:hk-rank-card', entity: 'sensor.office', name: 'Office' });
    u.hass = house.hass();
    H.ok('one that is not: none', !/\bbkd\b/.test(u._e.card.className || '') && said(u) === 0);
    H.runTimers();
  },
  function () {
    H.section('the wall chargers\' watts, not the car\'s own');
    // the car's own reading stale at 10 kW (its maker's cloud), the charger at 0: not charging
    var house = powerHouse({ 'sensor.main_power': ['4.7', { unit_of_measurement: 'kW' }], 'sensor.red_power': ['10', { unit_of_measurement: 'kW' }],
      'sensor.red_level': ['80', { unit_of_measurement: '%' }], 'device_tracker.red': ['home', {}], 'binary_sensor.red_cable': ['on', {}],
      'sensor.left_wc': ['0.0', { unit_of_measurement: 'kW' }], 'sensor.right_wc': ['0.0', { unit_of_measurement: 'kW' }] });
    var CARS = [{ name: 'Red Car', level: 'sensor.red_level', power: 'sensor.red_power', home: 'device_tracker.red', plugged: 'binary_sensor.red_cable' }];
    var st = H.make('hk-power-status-card');
    st.setConfig(Object.assign({}, CFG, { type: 'custom:hk-power-status-card', grid: 'sensor.main_power', cars: CARS, chargers: ['sensor.left_wc', 'sensor.right_wc'] }));
    st.hass = house.hass();
    H.ok('a stale car reading with the chargers at 0: nobody is charging', drawn(st).indexOf('is charging at') < 0, drawn(st).slice(0, 300));
    var load = H.make('hk-power-load-card');
    load.setConfig({ type: 'custom:hk-power-load-card', home: 'sensor.main_power', cars: CARS, chargers: ['sensor.left_wc', 'sensor.right_wc'], devices: [] });
    load.hass = house.hass();
    H.ok('...and The House shows no Charging part', drawn(load).indexOf('Charging <b>') < 0);
    house.set('sensor.right_wc', '9.6');
    st.hass = house.hass();
    H.ok('the right charger at 9.6 kW: the car charging at the charger\'s watts', drawn(st).indexOf('<b>Red Car</b> is charging at 9.60 kW') > 0, drawn(st).slice(0, 400));
    load.hass = house.hass();
    H.ok('...The House\'s Charging is the charger\'s 9.6 kW', drawn(load).indexOf('Charging <b>9.60 kW</b>') > 0);
    var nochg = H.make('hk-power-status-card');
    nochg.setConfig(Object.assign({}, CFG, { type: 'custom:hk-power-status-card', grid: 'sensor.main_power', cars: CARS }));
    nochg.hass = house.hass();
    H.ok('no chargers given: the car\'s own reading, as before', drawn(nochg).indexOf('is charging at 10.0 kW') > 0);
    H.runTimers();
  }
]);
