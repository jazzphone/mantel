// HOUSE STATUS (docs/phase11/HOUSE-STATUS.md): the status chips as sections (hk-chip.js hkChip.status) and the block's
// and sheet's pure layout (hk-house-status.js). What a section says is what its chip says -- the same chips, order,
// When Active, Smoke & CO, custom and entity chips -- whether or not the chip row is drawn; unknown is never zero;
// alerts lead; a custom chip that would command the house is a readout; a card House Status can't read is named.
var DIR = (function(){ var p = HK_ROOT + '/tests/'; return p; })();
load(DIR + 'dom.js');
load(DIR + 'card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-chip.js');
load(HK_ROOT + '/frontend/cards/hk-house-status.js');
var pass=0, fail=0;
function ok(n,c,x){ if(c){pass++;print('  PASS  '+n);} else {fail++;print('  FAIL  '+n+(x!==undefined?'   '+x:''));} }
function eq(n,a,b){ var A = JSON.stringify(a), B = JSON.stringify(b); ok(n, A === B, A + ' != ' + B); }
var HS = window.hkChip.status, L = window.hkHouseStatus.lib, HC = window.hkCards;
var SET = {}, VER = 1;
window.hkSettings = { get version() { return VER; }, get: function (p, f) {
  var v = SET; String(p).split('.').forEach(function (k) { v = (v === null || v === undefined) ? undefined : v[k]; });
  return (v === null || v === undefined) ? f : v; } };
function S(state, attrs){ return { state: state, last_updated: 't' + Math.random(), attributes: attrs || {} }; }
var soon = Date.now() + 522000, later = Date.now() + 1900000;
function house() {
  return {
    'sensor.house': S('70.6'), 'climate.down': S('cool', { friendly_name: 'Downstairs', hvac_action: 'cooling', current_temperature: 70 }),
    'climate.up': S('cool', { friendly_name: 'Upstairs', hvac_action: 'idle', current_temperature: 71 }),
    'timer.pasta': S('active', { friendly_name: 'Pasta', finishes_at: new Date(soon).toISOString(), remaining: '0:12:00' }),
    'timer.laundry': S('active', { friendly_name: 'Laundry', finishes_at: new Date(later).toISOString() }),
    'timer.tea': S('paused', { friendly_name: 'Tea', remaining: '0:03:10' }),
    'sensor.power': S('6700', { unit_of_measurement: 'W' }),
    'cover.shades': S('open', { friendly_name: 'Living Room Shades' }), 'cover.blinds': S('closed', { friendly_name: 'Bedroom Blinds' }),
    'light.a': S('on', { friendly_name: 'Kitchen Pendants' }), 'light.b': S('on', { friendly_name: 'Loft Lamp' }), 'light.c': S('off', { friendly_name: 'Den Lamp' }),
    'alarm_control_panel.home': S('armed_home'), 'lock.front': S('locked', { friendly_name: 'Front Door' }), 'lock.back': S('locked', { friendly_name: 'Back Door' }),
    'binary_sensor.leak': S('off', { friendly_name: 'Laundry Leak', device_class: 'moisture' }),
    'binary_sensor.smoke': S('off', { friendly_name: 'Hall Smoke', device_class: 'smoke' }),
    'binary_sensor.mailbox': S('on', { friendly_name: 'Mailbox' }), 'light.porch': S('on', { friendly_name: 'Porch Light' }),
    'sensor.alerts': S('0', { Alerts: [] }), 'vacuum.v1': S('docked', { friendly_name: 'Robot' }),
    'binary_sensor.door': S('off', { friendly_name: 'Front Door', device_class: 'door' })
  };
}
var STATES = house();
function client() {
  return { states: STATES, areas: { kitchen: { name: 'Kitchen' }, loft: { name: 'Loft' }, living: { name: 'Living Room' }, garage: { name: 'Garage' } },
           entities: { 'light.a': { area_id: 'kitchen' }, 'light.b': { area_id: 'loft' }, 'cover.shades': { area_id: 'living' },
                       'timer.pasta': { area_id: 'kitchen' }, 'binary_sensor.leak': { area_id: 'garage' }, 'binary_sensor.mailbox': { area_id: 'living' } },
           devices: {} };
}
SET = { kinds: { lights: ['light.a', 'light.b', 'light.c'], locks: ['lock.front', 'lock.back'], thermostats: ['climate.down', 'climate.up'],
                 blinds: ['cover.shades', 'cover.blinds'], leaks: ['binary_sensor.leak'], timers: ['timer.pasta', 'timer.laundry', 'timer.tea'],
                 smoke: ['binary_sensor.smoke'], vacuums: ['vacuum.v1'], doors: ['binary_sensor.door'] },
        security: { alarm: 'alarm_control_panel.home' }, features: { temperature: 'sensor.house', power: 'sensor.power' },
        weather: { alerts: 'sensor.alerts' }, custom_chips: [] };
var SIX = { chips: ['climate', 'timers', 'energy', 'blinds', 'lights', 'security'], chips_quiet: ['blinds'], chips_row: false };
function read(board) { var c = client(); return HS.read(HS.plan(board, c), c); }
function names(m) { return m.sections.map(function (s) { return s.name; }); }
function sec(m, name) { return m.sections.filter(function (s) { return s.name === name; })[0]; }

print('=== the screen\'s chips, with the chip row hidden ===');
var m = read(SIX);
eq('the six, in the screen\'s order (Smoke & CO is quiet: not shown)', names(m), ['Climate', 'Timers', 'Power', 'Blinds', 'Lights', 'Security']);
ok('the chip row\'s switch is the row\'s: rowPlan draws none', window.hkChip.kinds.rowPlan({}, SIX, client()) === null);
eq('Climate: the indoor reading, and what the house is doing', [sec(m, 'Climate').reading, sec(m, 'Climate').detail], [{ num: '71°' }, 'Cooling']);
eq('...each thermostat, when there are several', sec(m, 'Climate').extra, 'Downstairs 70° · Upstairs 71°');
eq('Power is the Energy chip\'s reading, kW from W', sec(m, 'Power').reading, { num: '6.7', unit: 'kW' });
eq('...and opens the Energy page (in an editor preview: the first of its pages)', sec(m, 'Power').tap, { action: 'navigate', navigation_path: './energy' });
eq('Blinds: 1 Open, where', [sec(m, 'Blinds').reading, sec(m, 'Blinds').detail], [{ num: '1', unit: 'Open' }, 'Living Room']);
eq('Lights: 2 On, in which rooms', [sec(m, 'Lights').reading, sec(m, 'Lights').detail, sec(m, 'Lights').extra], [{ num: '2', unit: 'On' }, 'In 2 rooms', 'Kitchen · Loft']);
eq('Security: the alarm, the locks under it', [sec(m, 'Security').reading, sec(m, 'Security').detail], [{ text: 'Armed Home' }, 'All locked']);
var t = sec(m, 'Timers');
eq('Timers: the soonest running counts down, its name and room', [t.reading, t.detail, t.extra], [{ countdown: { deadline: soon } }, 'Pasta · Kitchen', '2 running · 1 paused']);
ok('...a timer running asks for attention; Climate does not', t.attention && !sec(m, 'Climate').attention);

print('\n=== When Active, and live changes ===');
STATES['cover.shades'] = S('closed', { friendly_name: 'Living Room Shades' });
eq('the blinds all closed: Blinds is not shown (it is When Active)', names(read(SIX)), ['Climate', 'Timers', 'Power', 'Lights', 'Security']);
eq('...the same chips Always: Blinds says All Closed', sec(read(Object.assign({}, SIX, { chips_quiet: [] })), 'Blinds').reading, { text: 'All Closed' });
STATES['timer.pasta'] = S('idle', {}); STATES['timer.laundry'] = S('idle', {});
t = sec(read(SIX), 'Timers');
eq('only a paused timer: its time held', [t.reading, t.detail, t.extra], [{ countdown: { hold: 190 } }, 'Tea', 'Paused']);
STATES['timer.tea'] = S('idle', {});
t = sec(read(SIX), 'Timers');
eq('no timer: None, nothing running', [t.reading, t.detail], [{ text: 'None' }, 'Nothing running']);
STATES = house();

print('\n=== unknown is not zero, nor locked ===');
STATES['sensor.power'] = S('unavailable', { unit_of_measurement: 'W' });
var p = sec(read(SIX), 'Power');
eq('power unavailable: no reading, said so (never 0 kW)', [p.reading, p.detail], [{ none: true }, 'Unavailable']);
STATES['sensor.house'] = S('unknown'); STATES['climate.down'] = S('unavailable');
eq('the temperature unknown: no reading', sec(read(SIX), 'Climate').reading, { none: true });
STATES = house();
SET.security = {};
STATES['lock.back'] = S('unavailable', { friendly_name: 'Back Door' });
var s0 = sec(read(SIX), 'Security');
eq('no alarm, a lock not reporting: never All Locked', [s0.reading, s0.detail, s0.extra], [{ num: '1', unit: 'Not Reporting' }, '1 lock not reporting', 'Back Door']);
ok('...and it asks for attention', s0.attention);
STATES['lock.back'] = S('unlocked', { friendly_name: 'Back Door' });
eq('one unlocked: the chip\'s 1 Unlocked', sec(read(SIX), 'Security').reading, { num: '1', unit: 'Unlocked' });
SET.security = { alarm: 'alarm_control_panel.home' };
STATES = house();

print('\n=== alerts lead; the rest keep their order ===');
var ALL = { chips: ['climate', 'lights', 'water', 'weather_alert', 'security'], chips_quiet: ['water', 'weather_alert'] };
eq('nothing wrong: the quiet ones are not shown', names(read(ALL)), ['Climate', 'Lights', 'Security']);
STATES['binary_sensor.leak'] = S('on', { friendly_name: 'Laundry Leak', device_class: 'moisture' });
STATES['sensor.alerts'] = S('1', { Alerts: [{ Event: 'Wind Advisory', Headline: 'Wind Advisory until 6 PM', Severity: 'Moderate' }] });
m = read(ALL);
eq('a leak and a weather alert: first, in the screen\'s order between them', names(m), ['Water', 'Weather Alerts', 'Climate', 'Lights', 'Security']);
eq('...the weather alert reads as one piece, its headline under it', [sec(m, 'Weather Alerts').reading, sec(m, 'Weather Alerts').detail], [{ text: 'Wind Advisory' }, 'Wind Advisory until 6 PM']);
ok('...both urgent', sec(m, 'Water').urgent && sec(m, 'Weather Alerts').urgent && !sec(m, 'Climate').urgent);
STATES['light.c'] = S('on', { friendly_name: 'Den Lamp' });
eq('a reading changing never reorders them', names(read(ALL)), names(m));
STATES['binary_sensor.smoke'] = S('on', { friendly_name: 'Hall Smoke', device_class: 'smoke' });
m = read(ALL);
eq('smoke: Smoke & CO leads every screen, unasked, and says what', [m.sections[0].name, m.sections[0].reading, m.sections[0].urgent], ['Smoke & CO', { text: 'Smoke Detected' }, true]);
eq('...it opens nothing (as its chip)', m.sections[0].tap, { action: 'none' });
STATES['alarm_control_panel.home'] = S('triggered');
ok('the alarm going off: Security is urgent too', sec(read(ALL), 'Security').urgent);
STATES = house();

print('\n=== custom chips and entity chips ===');
SET.custom_chips = [
  { key: 'mail', name: 'Mail', after: 'end', card: { type: 'custom:hk-status-chip-card', entity: 'binary_sensor.mailbox', name: 'Mail', label_map: { on: 'Delivered', off: 'Empty' } } },
  { key: 'porch', name: 'Porch', after: 'end', card: { type: 'conditional', conditions: [{ condition: 'state', entity: 'light.porch', state: 'on' }],
    card: { type: 'custom:hk-status-chip-card', entity: 'light.porch', name: 'Porch' } } },
  { key: 'wide', name: 'Wide Only', after: 'end', card: { type: 'conditional', conditions: [{ condition: 'screen', media_query: '(min-width: 1024px)' }],
    card: { type: 'custom:hk-status-chip-card', entity: 'light.porch', name: 'Wide Only' } } },
  { key: 'odd', name: 'Garden Glance', after: 'end', card: { type: 'glance', entities: ['light.porch'] } },
  { key: 'toggle', name: 'Fountain', after: 'end', card: { type: 'custom:hk-status-chip-card', entity: 'light.porch', name: 'Fountain', tap_action: { action: 'toggle' } } }
];
VER++;
var CB = { chips: ['lights', 'binary_sensor.mailbox'], chips_extra: ['binary_sensor.mailbox'], chips_quiet: [], chips_custom: ['mail', 'porch', 'wide', 'odd', 'toggle'] };
m = read(CB);
eq('an entity chip, the custom status chips, a conditional whose condition holds', names(m), ['Lights', 'Mailbox', 'Mail', 'Porch', 'Fountain']);
eq('...the entity chip: its state, its room, its sheet', [sec(m, 'Mailbox').reading, sec(m, 'Mailbox').detail, sec(m, 'Mailbox').tap], [{ text: 'on' }, 'Living Room', { action: 'more-info' }]);
eq('...a custom chip\'s own label', sec(m, 'Mail').reading, { text: 'Delivered' });
eq('a chip whose tap would toggle: a readout here, no tap', [sec(m, 'Fountain').readonly, sec(m, 'Fountain').tap], [true, { action: 'none' }]);
eq('a screen-width condition and a glance card: named, never guessed', m.unsupported, ['Wide Only', 'Garden Glance']);
STATES['light.porch'] = S('off', { friendly_name: 'Porch Light' });
eq('the conditional\'s condition false: not shown', names(read(CB)).indexOf('Porch'), -1);
STATES = house(); SET.custom_chips = []; VER++;

print('\n=== where a section goes: the screen\'s own pages ===');
HC.menu = HC.menu || {};
var cfgWas = HC.menu.config;
HC.menu.config = function () { return { views: [{ path: 'lights' }, { path: 'alarm' }, { path: 'climate' }] }; };
VER++;
m = read(SIX);
eq('Lights to ./lights, Security to its first page the screen has (alarm), Blinds to Climate (its fallback)',
   [sec(m, 'Lights').tap.navigation_path, sec(m, 'Security').tap.navigation_path, sec(m, 'Blinds').tap.navigation_path], ['./lights', './alarm', './climate']);
eq('no Energy page here: Power opens nothing (never a made-up page)', sec(m, 'Power').tap, { action: 'none' });
var went = [], sheetWent = [];
var shNav = window.hkShell.navigate, shMore = window.hkShell.moreInfo;
window.hkShell.navigate = function (p) { went.push(p); };
window.hkShell.moreInfo = function (id) { went.push('sheet:' + id); };
window.hkDetail = { navigateFrom: function (p) { sheetWent.push(p); } };
globalThis.location.pathname = '/hk-kitchen/home';
var G = window.hkHouseStatus._;
G.go({}, sec(m, 'Lights'), false);
eq('a block\'s section: one navigation, the dashboard\'s own path', went, ['/hk-kitchen/lights']);
G.go({}, sec(m, 'Lights'), true);
eq('...from the sheet: through hkDetail.navigateFrom (the sheet comes down on its way)', [went.length, sheetWent], [1, ['/hk-kitchen/lights']]);
ok('a section with nowhere to go does nothing, and is no button', G.go({}, sec(m, 'Power'), false) === false && !G.goes(sec(m, 'Power')) && went.length === 1);
G.go({}, { tap: { action: 'more-info' }, entity: 'binary_sensor.mailbox' }, false);
eq('an entity chip\'s section: its sheet', went[1], 'sheet:binary_sensor.mailbox');
window.hkShell.navigate = shNav; window.hkShell.moreInfo = shMore; HC.menu.config = cfgWas; VER++;

print('\n=== the block\'s layout: sizes, cells, counts ===');
// the block inside its inset: square cells (18 a side) and tile cells (14)
var BOX = { square: { S: [160, 160], W: [369, 160], T: [160, 369], L: [369, 369], XL: [578, 369] },
            tile: { S: [168, 122], W: [374, 122], T: [168, 282], L: [374, 282], XL: [580, 282] } };
function lay(cell, size, n, words) { var b = BOX[cell][size]; return L.plan(size, b[0], b[1], n, { words: words !== false }); }
// ROUND TWO (2026-11-08): a headline over the sections as lines, each line at its size's height (NOTHING STRETCHES)
var x = lay('square', 'T', 7);
eq('Tall, square: the headline over six lines of 44, "+1 more"', [x.shape, x.rowH, x.shown, x.more, x.cols], ['square', 44, 6, 1, 1]);
x = lay('tile', 'T', 7);
eq('...on a tile cell, four', [x.shape, x.shown, x.more], ['tile', 4, 3]);
x = lay('square', 'W', 7);
eq('Wide: the headline in a third, three lines of 44 beside it', [x.side, x.shown, x.more], [123, 3, 4]);
x = lay('tile', 'W', 7);
eq('...on a tile cell, two', [x.shown, x.more], [2, 5]);
x = lay('square', 'L', 7);
eq('Large: the headline and its sentence over four lines of 56', [x.rowH, x.shown, x.sentence], [56, 4, true]);
x = lay('tile', 'L', 7);
eq('...on a tile cell, three of 48, the sentence where it costs no line', [x.rowH, x.shown, x.sentence], [48, 3, true]);
x = lay('square', 'XL', 7);
eq('Extra Large: a headline column beside six lines of 56', [x.side, x.rowH, x.shown, x.more, x.big], [200, 56, 6, 1, true]);
x = lay('tile', 'L', 4, false);
eq('On Now\'s Large on a tile cell: all four kinds', [x.shown, x.more], [4, 0]);
x = lay('square', 'T', 4, false);
eq('On Now\'s Tall on a square cell: the count large (72) over its four kinds', [x.big, x.shown], [true, 4]);
var whole = true, tall = true, fits = true;
['square', 'tile'].forEach(function (cell) {
  ['W', 'T', 'L', 'XL'].forEach(function (size) {
    [true, false].forEach(function (words) {
      for (var n = 0; n <= 16; n++) {
        var y = lay(cell, size, n, words), b = BOX[cell][size];
        if (y.shown + y.more !== n) whole = false;
        if (y.rowH < L.TAP) tall = false;
        var used = y.rows * y.rowH + (size === 'W' || size === 'XL' ? 0 : L.LABEL + L.headH({ words: words, big: y.big }) + 8 + (y.sentence ? 21 : 0));
        if (used > b[1]) fits = false;
      }
    });
  });
});
ok('every count 0 to 16, every size, both cells: shown + more is all of them (more never loses one)', whole);
ok('...no line is ever under a finger\'s 44 px', tall);
ok('...and the lines at their height always fit inside the plate', fits);

print('\n=== the sheet ===');
ok('wide on a tablet across (1180 x 820), for two or more', L.wantWide(1180, 820, 6, 0) && !L.wantWide(1180, 820, 1, 0));
ok('standard upright (820 x 1180), on a phone, on a short window, beside a docked menu too wide', !L.wantWide(820, 1180, 6) && !L.wantWide(390, 844, 6) &&
   !L.wantWide(900, 500, 6) && !L.wantWide(1180, 820, 6, 360));
eq('the body\'s width: panels, rows two across, rows', [L.sheetMode(772, 6), L.sheetMode(548, 6), L.sheetMode(412, 6), L.sheetMode(772, 1)], ['panels', 'rows2', 'rows', 'rows']);
eq('Small leads with an alert, else attention, else the first',
   [L.lead([{ n: 1 }, { n: 2, attention: true }, { n: 3, urgent: true }]).n, L.lead([{ n: 1 }, { n: 2, attention: true }]).n, L.lead([{ n: 1 }]).n, L.lead([])],
   [3, 2, 1, null]);
eq('readings in words', [L.words({ num: '3', unit: 'On' }), L.words({ text: 'Armed Home' }), L.words({ none: true }), L.words({ countdown: { hold: 190 } }),
   L.words({ countdown: { deadline: 1000 + 522000 } }, 1000)], ['3 On', 'Armed Home', 'No reading', '3:10 paused', '8:42 left']);
eq('a reading from a chip\'s label', [HS.reading('3 On'), HS.reading('72°'), HS.reading('6.7 kW'), HS.reading('--'), HS.reading('-- kW'), HS.reading('All Closed')],
   [{ num: '3', unit: 'On' }, { num: '72°' }, { num: '6.7', unit: 'kW' }, { none: true }, { none: true }, { text: 'All Closed' }]);

print('\n=== the card\'s lifecycle: its listeners go with it ===');
var Card = window.hkHouseStatus.Card;
ok('the block and the sheet are defined', !!customElements.get('hk-house-status-card') && !!customElements.get('hk-house-status-sheet'));
var el = new Card();
el.setConfig({ size: 'L' });
var before = (globalThis.__winL && (globalThis.__winL['hk-module-ready'] || []).length) || 0;
el.connectedCallback();
var during = (globalThis.__winL && (globalThis.__winL['hk-module-ready'] || []).length) || 0;
el.disconnectedCallback();
var after = (globalThis.__winL && (globalThis.__winL['hk-module-ready'] || []).length) || 0;
ok('connected: it listens for the settings; disconnected: it no longer does', during === before + 1 && after === before, [before, during, after].join());
el.connectedCallback(); el.connectedCallback(); el.disconnectedCallback();
after = (globalThis.__winL && (globalThis.__winL['hk-module-ready'] || []).length) || 0;
ok('attached again and again: one listener at most, none after', after <= before + 1, after);

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' HOUSE STATUS TESTS PASS'));
