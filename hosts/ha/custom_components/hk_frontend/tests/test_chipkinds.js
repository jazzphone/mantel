// The chip KINDS (hk-chip.js): `kind: lights` fills a chip in from What
// counts, and must draw exactly what hand-written chips drew -- label, glyph,
// color -- for the same states. And the row (hk-chips-card): which chips,
// their order, which are quiet, where a home's own extra chips go.
var DIR = (function(){ var p = HK_ROOT + '/tests/'; return p; })();
load(DIR + 'dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-chip.js');
var pass=0, fail=0;
function ok(n,c,x){ if(c){pass++;print('  PASS  '+n);} else {fail++;print('  FAIL  '+n+(x!==undefined?'   '+x:''));} }
var K = window.hkChip.kinds, HC = window.hkCards;
var SET = {};
window.hkSettings = { version: 1, get: function (p, f) {
  var v = SET; String(p).split('.').forEach(function (k) { v = (v === null || v === undefined) ? undefined : v[k]; });
  return (v === null || v === undefined) ? f : v; } };
function S(state, attrs){ return { state: state, last_updated: 't', attributes: attrs || {} }; }
// What a chip DRAWS for these states: label, glyph, colour name.
function draw(kind, states) {
  var hass = { states: states };
  var cfg = K.config(kind, hass);
  if (!cfg) return null;
  var card = { _st: function (id) { return states[id] || null; } };
  var st = card._st(cfg.entity);
  var val = HC.chipValue(card, cfg, st);
  var icon = HC.ruleValue(card, cfg, st, cfg.icon_rules, 'icon') || HC.pickChip(cfg.icon_states, val) || cfg.icon;
  var col = HC.ruleValue(card, cfg, st, cfg.icon_color_rules, 'color') || HC.pickChip(cfg.icon_color_states, val) || cfg.icon_color;
  var active = (cfg.active || []).some(function (w) { return HC.chipPasses(card, cfg, st, w); });
  return { label: HC.labelFor(card, cfg, st), icon: icon, color: col, active: active, name: cfg.name, tap: cfg.tap_action };
}

SET = { kinds: { lights: ['light.a', 'light.b', 'switch.lamp'], locks: ['lock.front', 'lock.back'],
                 doors: ['binary_sensor.front', 'binary_sensor.back'], windows: ['binary_sensor.w1', 'binary_sensor.w2'],
                 garage: ['cover.garage'], fans: ['fan.a', 'fan.b'], thermostats: ['climate.down', 'climate.up'],
                 blinds: ['cover.b1', 'cover.b2'], leaks: ['binary_sensor.leak1', 'binary_sensor.leak2'],
                 timers: ['timer.t1', 'timer.t2'], vacuums: ['vacuum.v1'], speakers: ['media_player.k'] },
        security: { alarm: 'alarm_control_panel.home' },
        features: { temperature: 'sensor.house', power: 'sensor.power' },
        weather: { alerts: 'sensor.alerts' } };

print('=== Lights: the switches the house counts as lights too ===');
var d = draw('lights', { 'light.a': S('on'), 'light.b': S('off'), 'switch.lamp': S('on') });
ok('2 On, lit bulb, yellow', d.label === '2 On' && d.icon === 'hk:lightbulb-on' && d.color === 'yellow', JSON.stringify(d));
d = draw('lights', { 'light.a': S('off'), 'light.b': S('off'), 'switch.lamp': S('off') });
ok('none on: 0 On, outline, gray, not active', d.label === '0 On' && d.icon === 'hk:lightbulb-outline' && d.color === 'gray' && !d.active, JSON.stringify(d));
ok('opens the Lights page', d.tap.navigation_path === './lights');

print('\n=== Security: the alarm and the locks, first rule wins ===');
var base = { 'lock.front': S('locked'), 'lock.back': S('locked') };
function sec(alarm, extra) { var s = Object.assign({}, base, extra || {}); s['alarm_control_panel.home'] = S(alarm); return draw('security', s); }
d = sec('disarmed');
ok('disarmed: Disarmed, shield-off, red', d.label === 'Disarmed' && d.icon === 'hk:shield-off' && d.color === 'red', JSON.stringify(d));
d = sec('armed_away');
ok('armed: Armed Away, shield-lock, green', d.label === 'Armed Away' && d.icon === 'hk:shield-lock' && d.color === 'green', JSON.stringify(d));
d = sec('armed_away', { 'lock.back': S('unlocked') });
ok('an unlocked lock beats armed: 1 Unlocked, lock-open, red', d.label === '1 Unlocked' && d.icon === 'hk:lock-open-variant' && d.color === 'red', JSON.stringify(d));
d = sec('triggered', { 'lock.back': S('unlocked') });
ok('triggered beats everything', d.label === 'Triggered' && d.icon === 'hk:shield-alert' && d.color === 'red', JSON.stringify(d));
ok('the Security page: security, else alarm (preview: the first)', d.tap.navigation_path === './security');

print('\n=== Doors & Windows: each counted, pluralised, joined ===');
var dw = { 'binary_sensor.front': S('on'), 'binary_sensor.back': S('on'), 'binary_sensor.w1': S('on'),
           'binary_sensor.w2': S('off'), 'cover.garage': S('closed') };
d = draw('doors_windows', dw);
ok('2 Doors • 1 Window, red', d.label === '2 Doors • 1 Window' && d.color === 'red' && d.active, d.label);
ok('the door-and-lock glyph', d.icon === 'hk:door-closed-lock');
dw['binary_sensor.front'] = S('off'); dw['binary_sensor.back'] = S('off'); dw['binary_sensor.w1'] = S('off');
d = draw('doors_windows', dw);
ok('all shut: All Closed, gray, not active', d.label === 'All Closed' && d.color === 'gray' && !d.active, JSON.stringify(d));
dw['cover.garage'] = S('open');
ok('the garage door counts', draw('doors_windows', dw).label === 'Garage Open');

print('\n=== Climate: the temperature, fans only when on ===');
var cl = { 'sensor.house': S('78.6'), 'fan.a': S('off'), 'fan.b': S('off'),
           'climate.down': S('cool', { hvac_action: 'idle' }), 'climate.up': S('cool', { hvac_action: 'idle' }) };
d = draw('climate', cl);
ok('79°, thermostat glyph, blue, not active', d.label === '79°' && d.icon === 'hk:thermostat' && d.color === 'blue' && !d.active, JSON.stringify(d));
cl['fan.a'] = S('on'); cl['fan.b'] = S('on'); cl['climate.up'] = S('cool', { hvac_action: 'cooling' });
d = draw('climate', cl);
ok('79° · 2 Fans, snowflake', d.label === '79° · 2 Fans' && d.icon === 'hk:snowflake' && d.active, d.label);
cl['fan.b'] = S('off');
ok('one fan is "1 Fan"', draw('climate', cl).label === '79° · 1 Fan');
cl['climate.down'] = S('heat', { hvac_action: 'heating' });
ok('heating: red', draw('climate', cl).color === 'red');
SET.features.temperature = null;
cl['climate.down'] = S('heat', { hvac_action: 'heating', current_temperature: 70.2 });
ok('no indoor sensor: the first thermostat\'s', draw('climate', cl).label.indexOf('70°') === 0, draw('climate', cl).label);
SET.features.temperature = 'sensor.house';

print('\n=== Blinds, Timers, Vacuums, Speakers, Water ===');
d = draw('blinds', { 'cover.b1': S('open'), 'cover.b2': S('closed') });
ok('Blinds: 1 Open, blue', d.label === '1 Open' && d.icon === 'hk:blinds-open' && d.color === 'blue');
ok('Blinds open the Climate page where there is no Blinds page (preview: blinds)', d.tap.navigation_path === './blinds');
d = draw('blinds', { 'cover.b1': S('closed'), 'cover.b2': S('closed') });
ok('Blinds: All Closed, gray', d.label === 'All Closed' && d.color === 'gray' && !d.active);
d = draw('timers', { 'timer.t1': S('active'), 'timer.t2': S('paused') });
ok('Timers: counts running ones', d.label === '1 On' && d.color === 'orange', d.label);
d = draw('timers', { 'timer.t1': S('idle'), 'timer.t2': S('paused') });
ok('Timers: a paused one is None but still active', d.label === 'None' && d.active);
d = draw('vacuums', { 'vacuum.v1': S('docked') });
ok('Vacuums: Idle, gray', d.label === 'Idle' && d.color === 'gray');
d = draw('vacuums', { 'vacuum.v1': S('cleaning') });
ok('Vacuums: 1 Running, blue', d.label === '1 Running' && d.color === 'blue');
d = draw('speakers', { 'media_player.k': S('playing') });
ok('Speakers: 1 Playing', d.label === '1 Playing');
d = draw('water', { 'binary_sensor.leak1': S('on'), 'binary_sensor.leak2': S('off') });
ok('Water: 1 Leak, red', d.label === '1 Leak' && d.color === 'red' && d.active);
d = draw('water', { 'binary_sensor.leak1': S('off'), 'binary_sensor.leak2': S('off') });
ok('Water: No Leaks, not active', d.label === 'No Leaks' && !d.active);

print('\n=== Energy: shown in kW whatever the sensor reports ===');
d = draw('energy', { 'sensor.power': S('2630', { unit_of_measurement: 'W' }) });
ok('2630 W -> 2.6 kW', d.label === '2.6 kW', d.label);
d = draw('energy', { 'sensor.power': S('2.63', { unit_of_measurement: 'kW' }) });
ok('2.63 kW -> 2.6 kW', d.label === '2.6 kW', d.label);
ok('unavailable: -- kW', draw('energy', { 'sensor.power': S('unavailable', { unit_of_measurement: 'kW' }) }).label === '-- kW');

print('\n=== Weather alert: the first alert, "+N" for the rest ===');
var alerts = [{ Event: 'Heat Advisory', Severity: 'Moderate' }, { Event: 'Flood Watch', Severity: 'Severe' }];
d = draw('weather_alert', { 'sensor.alerts': S('2', { Alerts: alerts }) });
ok('Heat Advisory +1, orange', d.label === 'Heat Advisory +1' && d.color === 'orange' && d.active, JSON.stringify(d));
alerts[0].Severity = 'SEVERE';
ok('severe: red', draw('weather_alert', { 'sensor.alerts': S('1', { Alerts: [alerts[0]] }) }).color === 'red');
ok('no alerts: not active', !draw('weather_alert', { 'sensor.alerts': S('0', { Alerts: [] }) }).active);

print('\n=== Smoke & CO: what went off, in red, and only then ===');
SET.kinds.smoke = ['binary_sensor.loft_smoke', 'binary_sensor.loft_co'];
function alarm(smoke, co) {
  return draw('smoke', { 'binary_sensor.loft_smoke': S(smoke, { device_class: 'smoke' }),
                         'binary_sensor.loft_co': S(co, { device_class: 'carbon_monoxide' }) });
}
d = alarm('off', 'off');
ok('all clear: not active (quiet: not shown)', !d.active, JSON.stringify(d));
d = alarm('on', 'off');
ok('smoke: Smoke Detected, smoke detector, red', d.active && d.label === 'Smoke Detected' && d.icon === 'hk:smoke-detector' && d.color === 'red', JSON.stringify(d));
d = alarm('off', 'on');
ok('carbon monoxide: CO Detected, the CO glyph', d.active && d.label === 'CO Detected' && d.icon === 'hk:molecule-co', JSON.stringify(d));
d = alarm('on', 'on');
ok('both: both said', d.label === 'Smoke Detected • CO Detected', d.label);
ok('named Smoke & CO; opens nothing', d.name === 'Smoke & CO' && d.tap.action === 'none');
var plan0 = K.rowPlan({}, { chips: ['lights', 'security'], chips_quiet: [] }, { states: {} });
ok('the row: first, before the screen\'s own chips, and quiet whatever the screen says',
   plan0.cards[0].kind === 'smoke' && plan0.cards[0].quiet === true && plan0.cards[1].kind === 'lights', JSON.stringify(plan0.cards[0]));
plan0 = K.rowPlan({ extra: [{ after: 'start', card: { type: 'x-first' } }] }, { chips: ['smoke', 'lights'] }, { states: {} });
ok('...before an extra at the start; never twice', plan0.cards[0].kind === 'smoke' && plan0.cards[1].type === 'x-first' &&
   plan0.cards.filter(function (c) { return c.kind === 'smoke'; }).length === 1);
ok('not one of the kinds a screen chooses', K.auto({ states: {} }).indexOf('smoke') < 0);
delete SET.kinds.smoke;
ok('a house without an alarm: no Smoke & CO chip in the row',
   K.rowPlan({}, { chips: ['lights'] }, { states: {} }).cards[0].kind === 'lights');
ok('found from the states before the integration answers: smoke and CO classes',
   (function () { var k = SET; SET = { security: {}, features: {}, weather: {} };
     var f = K.found('smoke', { states: { 'binary_sensor.s': S('off', { device_class: 'smoke' }),
       'binary_sensor.c': S('off', { device_class: 'carbon_monoxide' }), 'binary_sensor.cam': S('off') } }).join();
     SET = k; return f; })() === 'binary_sensor.c,binary_sensor.s');

print('\n=== a kind the house does not have draws nothing ===');
var keep = SET;
SET = { kinds: { lights: [] }, security: {}, features: {}, weather: {} };
ok('no lights, no chip', K.config('lights', { states: {} }) === null);
ok('no power sensor, no Energy chip', K.config('energy', { states: {} }) === null);
ok('no alarm and no locks, no Security chip', K.config('security', { states: {} }) === null);
ok('automatic row: only what exists', K.auto({ states: {} }).length === 0);
SET = keep;
ok('automatic row: every kind, in order',
   K.auto({ states: {} }).join() === 'weather_alert,security,doors_windows,climate,lights,blinds,timers,vacuums,speakers,water,energy',
   K.auto({ states: {} }).join());

print('\n=== before the integration answers: found from the states ===');
keep = SET;
SET = { security: {}, features: {}, weather: {} };
var house = { states: { 'light.a': S('on'), 'light.grp': S('on', { entity_id: ['light.a'] }),
                        'binary_sensor.d': S('off', { device_class: 'door' }), 'binary_sensor.x': S('off'),
                        'cover.car': S('closed', { device_class: 'door' }), 'cover.blind': S('open') },
              entities: { 'light.hidden': { hidden: true } } };
house.states['light.hidden'] = S('on');
ok('lights: not a group, not hidden', K.found('lights', house).join() === 'light.a', K.found('lights', house).join());
ok('doors: a door contact only', K.found('doors', house).join() === 'binary_sensor.d');
ok('blinds: a cover with no class, not a door cover', K.found('blinds', house).join() === 'cover.blind');
SET = keep;

print('\n=== the page a chip opens is one this dashboard has ===');
var views = null, realCfg = HC.menu.config;
HC.menu.config = function () { return views; };
views = { views: [{ path: 'home' }, { path: 'alarm' }, { path: 'climate' }] };
ok('Security opens ./alarm here', K.config('security', { states: base }).tap_action.navigation_path === './alarm');
ok('Blinds open ./climate here', K.config('blinds', { states: {} }).tap_action.navigation_path === './climate');
ok('no Lights page: the chip opens nothing', K.config('lights', { states: {} }).tap_action.action === 'none');
// THE WAY IN to the two quiet pages: no menu entry -- the
// chip, which shows only while something is open or wet, opens its page
views = { views: [{ path: 'home' }, { path: 'doors-windows' }, { path: 'water' }] };
var dw = K.config('doors_windows', { states: { 'binary_sensor.front': S('on') } });
ok('a door open: the Doors & Windows chip opens ./doors-windows', dw && dw.tap_action.navigation_path === './doors-windows', dw && JSON.stringify(dw.tap_action));
var wt = K.config('water', { states: { 'binary_sensor.leak1': S('on') } });
ok('a leak: the Water chip opens ./water', wt && wt.tap_action.navigation_path === './water', wt && JSON.stringify(wt.tap_action));
HC.menu.config = realCfg;

print('\n=== the row: the dashboard\'s chips, quiet ones, extras ===');
var plan = K.rowPlan({}, { chips: ['lights', 'security', 'sensor.mail'], chips_quiet: ['lights', 'sensor.mail'] }, { states: {} });
ok('its own order', plan.cards.map(function (c) { return c.kind || c.entity; }).join() === 'lights,security,sensor.mail');
ok('quiet ones are quiet', plan.cards[0].quiet === true && plan.cards[1].quiet === false && plan.cards[2].quiet === true);
ok('an entity is a chip of its own', plan.cards[2].type === 'custom:hk-status-chip-card' && !plan.cards[2].kind);
ok('the menu chip leads', plan.lead && plan.lead.type === 'custom:hk-menu-button-card');
ok('the chip row\'s geometry', plan.gap === 10 && plan.pad_top === 14 && plan.pad_bottom === 30 && plan.margin === '-15px -22px -32px -22px');
// Home -> Chips -> "Show the status chips" off: no row at all
ok('chips_row false: no row', K.rowPlan({ chips: ['lights'] }, { chips_row: false }, { states: {} }) === null);
plan = K.rowPlan({}, {}, { states: {} });
ok('no item: every kind, the default quiet ones',
   plan.cards.length === 11 && plan.cards.filter(function (c) { return c.quiet; }).map(function (c) { return c.kind; }).join() === 'weather_alert,doors_windows,blinds,water');
plan = K.rowPlan({ extra: [{ after: 'weather_alert', card: { type: 'x-mail' } }, { after: 'end', card: { type: 'x-battery' } }] },
                 {}, { states: {} });
ok('extras: after a kind, and at the end',
   plan.cards[1].type === 'x-mail' && plan.cards[plan.cards.length - 1].type === 'x-battery');
plan = K.rowPlan({ extra: [{ after: 'nothing_here', card: { type: 'x-lost' } }] }, { chips: ['lights'] }, { states: {} });
ok('extra after a kind the row lacks: the end', plan.cards[1].type === 'x-lost');
plan = K.rowPlan({ chips: ['climate'], quiet: [], lead: false }, { chips: ['lights'] }, { states: {} });
ok('the dashboard\'s own list wins over the card\'s default; lead off', plan.cards.length === 1 && plan.cards[0].kind === 'lights' && !plan.lead);
plan = K.rowPlan({ chips: ['climate'], quiet: [] }, {}, { states: {} });
ok('no item: the card\'s default', plan.cards.length === 1 && plan.cards[0].kind === 'climate' && plan.cards[0].quiet === false);
plan = K.rowPlan({}, { chips: ['lights'], chips_extra: ['sensor.mail'] }, { states: {} });
ok('the dashboard\'s extra chips follow its kinds', plan.cards.length === 2 && plan.cards[1].entity === 'sensor.mail');
plan = K.rowPlan({}, { chips: ['lights', 'sensor.mail', 'security', 'sensor.gone'], chips_extra: ['sensor.mail', 'sensor.pkg'] }, { states: {} });
ok('Order -> Chips places an own chip among the kinds; chips_extra says which exist',
   plan.cards.map(function (c) { return c.kind || c.entity; }).join() === 'lights,sensor.mail,security,sensor.pkg',
   JSON.stringify(plan.cards.map(function (c) { return c.kind || c.entity; })));

// CUSTOM CHIPS: a home's own chips in YAML, on the screens
// that list them -- where the chip says, or where the chip order places it
SET.custom_chips = [{ key: 'mail', name: 'Mail', after: 'weather_alert', card: { type: 'conditional', card: { type: 'x-mail' } } },
                    { key: 'house-battery', name: 'House Battery', after: 'end', card: { type: 'x-battery' } },
                    { key: 'spare', name: 'Spare', after: 'start', card: { type: 'x-spare' } }];
var kindsOf = function (p) { return p.cards.map(function (c) { return c.kind || (c.card && c.card.type) || c.type; }); };
plan = K.rowPlan({}, { chips_custom: ['mail', 'house-battery'] }, { states: {} });
ok('custom chips sit where they say: Mail after weather alerts, House Battery at the end (the YAML extras)',
   kindsOf(plan)[1] === 'x-mail' && kindsOf(plan)[kindsOf(plan).length - 1] === 'x-battery' && kindsOf(plan).indexOf('x-spare') < 0,
   kindsOf(plan));
plan = K.rowPlan({}, { chips: ['lights', 'chip:house-battery', 'security'], chips_custom: ['house-battery', 'spare'] }, { states: {} });
ok('...a screen\'s chip order places one; the other still sits where it says (the start)',
   kindsOf(plan).join() === 'x-spare,lights,x-battery,security', kindsOf(plan));
plan = K.rowPlan({}, { chips: ['lights', 'chip:mail'], chips_custom: [] }, { states: {} });
ok('...one the screen does not list is not shown, even where the order had it', kindsOf(plan).join() === 'lights', kindsOf(plan));
plan = K.rowPlan({}, { chips_custom: ['gone'] }, { states: {} });
ok('...nor one the library no longer has', kindsOf(plan).indexOf('gone') < 0 && plan.cards.length === 11);
var c1 = K.rowPlan({}, { chips_custom: ['house-battery'] }, { states: {} });
c1.cards[c1.cards.length - 1].type = 'changed';
ok('...each row gets its own copy of the card', SET.custom_chips[1].card.type === 'x-battery');
// EACH CUSTOM CHIP'S SHOW on a screen (2026-10-13): Always or When Active
SET.custom_chips = [{ key: 'mail', name: 'Mail', after: 'end', card: { type: 'conditional', conditions: [{ condition: 'state', entity: 'sensor.mailbox', state: 'Delivered' }],
                                                                          card: { type: 'custom:hk-status-chip-card', entity: 'sensor.mailbox' } } },
                    { key: 'house-battery', name: 'House Battery', after: 'end', card: { type: 'custom:hk-status-chip-card', entity: 'sensor.battery' } },
                    { key: 'own-rules', name: 'Own', after: 'end', card: { type: 'custom:hk-status-chip-card', entity: 'sensor.x', active: [{ entity: 'sensor.x', state: 'on' }] } }];
var last = function (p, n) { return p.cards[p.cards.length - (n || 1)]; };
plan = K.rowPlan({}, { chips: ['chip:mail', 'chip:house-battery'], chips_custom: ['mail', 'house-battery'] }, { states: {} });
ok('as written: Mail in its condition, the battery always', plan.cards[0].type === 'conditional' && !plan.cards[1].quiet);
plan = K.rowPlan({}, { chips: ['chip:mail', 'chip:house-battery'], chips_custom: ['mail', 'house-battery'],
                       chips_custom_show: { mail: 'always', 'house-battery': 'active' } }, { states: {} });
ok('Always takes Mail out of its condition', plan.cards[0].type === 'custom:hk-status-chip-card' && plan.cards[0].entity === 'sensor.mailbox');
ok('When Active makes the battery quiet, while its entity is on', plan.cards[1].quiet === true &&
   plan.cards[1].active[0].entity === 'sensor.battery' && plan.cards[1].active[0].state_not.indexOf('off') >= 0);
plan = K.rowPlan({}, { chips: ['chip:own-rules'], chips_custom: ['own-rules'], chips_custom_show: { 'own-rules': 'active' } }, { states: {} });
ok('...a chip with its own active: rules keeps them', plan.cards[0].quiet === true && plan.cards[0].active[0].state === 'on' && plan.cards[0].active.length === 1);
ok('...and the library\u2019s card is untouched', !SET.custom_chips[1].card.quiet && SET.custom_chips[0].card.type === 'conditional');
delete SET.custom_chips;

print('\n=== the scenes row ===');
var SC = window.hkChip.scenes;
var sh = { states: { 'scene.movie': S('scening', { friendly_name: 'Movie Night' }), 'scene.bed': S('scening', { friendly_name: 'Bedtime' }),
                     'input_button.gm': S('x', { friendly_name: 'Good Morning' }), 'scene.hidden': S('x', { friendly_name: 'Zzz' }) },
           entities: { 'scene.hidden': { hidden: true }, 'scene.movie': { icon: 'hk:tv' } } };
var sp = SC.plan({}, {}, sh);
var pills = sp.config.cards[1].cards[0].cards;
ok('no list anywhere: every scene A to Z, not hidden ones', sp.auto && pills.map(function (p) { return p.entity; }).join() === 'scene.bed,scene.movie');
ok('a pill runs its scene, with the entity\'s own icon', pills[1].tap_action.perform_action === 'scene.turn_on' &&
   pills[1].tap_action.target.entity_id === 'scene.movie' && pills[1].icon === 'hk:tv' && pills[1].name === 'Movie Night');
sp = SC.plan({ scenes: ['scene.movie'], looks: { 'input_button.gm': { icon: 'hk:sun', icon_color: 'yellow' } } },
             { scenes: ['input_button.gm', 'scene.bed'] }, sh);
pills = sp.config.cards[1].cards[0].cards;
ok('the dashboard\'s scenes win, in its order', pills.map(function (p) { return p.entity; }).join() === 'input_button.gm,scene.bed');
ok('a button is pressed; its look is the one `looks` gives it', pills[0].tap_action.perform_action === 'input_button.press' &&
   pills[0].icon === 'hk:sun' && pills[0].icon_color === 'yellow');
ok('the scenes row\'s geometry', sp.config.cards[1].layout.margin === '-14px -22px -7px -22px' &&
   sp.config.cards[1].cards[0].card_width === 'var(--hk-pill, ' + HC.TILE.w + 'px)' &&
   sp.config.cards[1].cards[0].gap === HC.TILE.gridGap);
ok('turned off on the dashboard: nothing', SC.plan({}, { scenes_row: false }, sh).config === null);
// A ROOM'S ROW (room: true, a room page's): exactly the scenes it is given
sp = SC.plan({ room: true, scenes: ['input_button.gm'] }, { scenes: ['scene.bed'], scenes_row: false, scenes_pages: ['music'] }, sh);
pills = sp.config && sp.config.cards[1].cards[0].cards;
ok('a room row ignores the screen\'s Home row, its switch and its page pills',
   !!pills && pills.length === 1 && pills[0].entity === 'input_button.gm' && !sp.auto);
ok('...and is nothing given nothing (never every scene in the house)', SC.plan({ room: true, scenes: [] }, {}, sh).config === null);
var realCfg2 = HC.menu.config;
HC.menu.config = function () { return { views: [{ path: 'home' }, { path: 'live-tv' }, { path: 'alarm' }] }; };
sp = SC.plan({}, { scenes: ['scene.bed'], scenes_pages: ['live_tv', 'security', 'music'] }, sh);
pills = sp.config.cards[1].cards[0].cards;
ok('page pills follow the scenes, only for pages this dashboard has', pills.length === 3 &&
   pills[1].name === 'Live TV' && pills[1].tap_action.navigation_path === './live-tv' &&
   pills[2].tap_action.navigation_path === './alarm', JSON.stringify(pills.map(function (p) { return p.name; })));
sp = SC.plan({}, { scenes: ['page:live_tv', 'scene.bed', 'page:music'], scenes_pages: ['live_tv', 'security'] }, sh);
pills = sp.config.cards[1].cards[0].cards;
ok('Order -> Scenes places a page pill among the scenes; scenes_pages says which exist',
   pills.map(function (p) { return p.name; }).join() === 'Live TV,Bedtime,Security', JSON.stringify(pills.map(function (p) { return p.name; })));
HC.menu.config = function () { return { views: [{ path: 'home' }, { path: 'energy' }] }; };
sp = SC.plan({}, { scenes: ['scene.bed'], scenes_pages: ['energy'] }, sh);
pills = sp.config.cards[1].cards[0].cards;
ok('the Energy page pill opens the Energy page, where the screen has it', pills.length === 2 && pills[1].name === 'Energy' &&
   pills[1].icon === 'mdi:lightning-bolt' && pills[1].tap_action.navigation_path === './energy',
   JSON.stringify(pills.map(function (p) { return p.name; })));
HC.menu.config = function () { return { views: [{ path: 'home' }] }; };
sp = SC.plan({}, { scenes: ['scene.bed'], scenes_pages: ['energy'] }, sh);
pills = sp.config.cards[1].cards[0].cards;
ok('...and is no pill on a screen without it (no Energy feature)', pills.length === 1, JSON.stringify(pills.map(function (p) { return p.name; })));
HC.menu.config = realCfg2;

print('\n=== the chip\'s markup is a string ===');
// The shim cannot mount a chip (no querySelector), so a slip that turns the
// template into NaN -- `' + +` -- would pass every suite and blank the live row.
var SRC = readFile(HK_ROOT + '/frontend/cards/hk-chip.js');
ok('no unary plus in a string concatenation', !/'\s*\+\s*\+\s*\n/.test(SRC));

print('\n=== hiding: never announced while Home Assistant is still building the card ===');
var Chip = customElements.get('hk-status-chip-card'), sent = 0;
var stub = { isConnected: false, style: {}, dispatchEvent: function () { sent++; } };
Chip.prototype._show.call(stub, true);
Chip.prototype._show.call(stub, false);
ok('not yet on the page: no card-visibility-changed (hui-card\'s element is still null)', sent === 0 && stub.hidden === true);
stub.isConnected = true;
Chip.prototype._show.call(stub, true);
ok('on the page: announced', sent === 1 && stub.hidden === false);

print('\n=== an entity chip as its accessory says ===');
var realSet = HC.setting;
HC.setting = function (p, f) {
  return p === 'accessories' ? { entities: { 'sensor.mailbox_status': { name: 'Mail', icon: 'mdi:mailbox-up', color: 'blue',
    when: 'Mail Likely Delivered', label: 'Likely Delivered' } } } : f;
};
var mail = K.entityChip('sensor.mailbox_status', false);
ok('named, pictured and coloured by its accessory', mail.name === 'Mail' && mail.icon === 'hk:mailbox-up' && mail.icon_color === 'blue');
ok('...shown only when its state is the one given, with its label',
   mail.quiet === true && mail.active[0].state === 'Mail Likely Delivered' && mail.label === 'Likely Delivered');
var plain = K.entityChip('sensor.other', false);
ok('an entity with no accessory settings: a plain chip', !plain.name && !plain.quiet && plain.active[0].state_not.length > 0);
var pill = SC.pill({ states: { 'scene.movie': { attributes: { friendly_name: 'Movie' } } }, entities: {} }, 'scene.movie');
ok('a scene pill with none: its own name, white', pill.name === 'Movie' && pill.icon_color === 'white');
HC.setting = function (p, f) {
  return p === 'accessories' ? { entities: { 'scene.movie': { name: 'Film', icon: 'hk:television', color: 'purple' } } } : f;
};
pill = SC.pill({ states: { 'scene.movie': { attributes: { friendly_name: 'Movie' } } }, entities: {} }, 'scene.movie');
ok('...with its accessory\'s name, glyph and colour', pill.name === 'Film' && pill.icon === 'hk:television' && pill.icon_color === 'purple');
HC.setting = function (p, f) {
  return p === 'accessories' ? { entities: { 'sensor.car': { attribute: 'range' } } } : f;
};
var car = K.entityChip('sensor.car', false);
ok('an attribute in place of the state, without the state\'s unit', car.attribute === 'range' && car.unit === false);
HC.setting = realSet;

// THE MENU'S COPY of the kind tables (hk-menu.js loads before the card files
// and keeps its own): the same order and the same pages, always.
load(HK_ROOT + '/frontend/modules/hk-menu.js');
var MK = window.hkMenu && window.hkMenu._ && window.hkMenu._.kinds;
ok('the menu\'s kind order is hk-chip\'s', MK && JSON.stringify(MK.ORDER) === JSON.stringify(window.hkChip.kinds.ORDER));
ok('the menu\'s kind pages are hk-chip\'s', MK && JSON.stringify(MK.PAGES) === JSON.stringify(window.hkChip.kinds.PAGES));

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' CHIP KIND TESTS PASS'));
