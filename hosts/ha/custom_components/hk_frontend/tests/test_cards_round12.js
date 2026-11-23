// ROUND 12 (2026-11-23), the cards in the kit: On Now's new take (the count, one bar, the kinds as rows), House Status's headline that
// leaves its own row out of the list, and Recent's quieter rows. Each is drawn here at its sizes on a fictional house and read as markup:
// what is on the card, in what order, what it opens. How it looks is the twin's (tools/headless/house_twin.py); this is what it says.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run cards_round12');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';
globalThis.history = { pushState: function () {} };

var FEED = {
  kinds: { lights: ['light.kitchen_pendants', 'light.den_lamp', 'light.porch_light'], speakers: ['media_player.kitchen_speaker'], fans: ['fan.bedroom_fan'],
           locks: ['lock.front_door'] },
  weather: { alerts: 'sensor.alerts' }, security: { alarm: 'alarm_control_panel.home' }
};
window.hkSettings = {
  version: 1,
  get: function (path, fb) {
    var v = FEED;
    String(path).split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
    return v === undefined || v === null ? fb : v;
  },
  tablet: function () { return null; }
};
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/modules/hk-kit.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-room.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/cards/hk-chip.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/cards/hk-grid-cards.js');
load(HK_ROOT + '/frontend/cards/hk-house-status.js');
var ok = H.ok, eq = H.eq;
function sized(tag, size, cfg) {
  var card = H.make(tag);
  card.setAttribute('size', size);
  card.setConfig(Object.assign({ type: 'custom:' + tag }, cfg || {}));
  return card;
}
// the text a card shows: its markup less the tags and the attributes (which carry the screen readers' words)
function words(html) { return html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '|').replace(/\|+/g, '|').replace(/^\||\|$/g, ''); }
var BLOCK = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
function draw(tag, size, house, cfg) {
  var c = sized(tag, size, cfg);
  c._block = function () { return { w: BLOCK[size][0], h: BLOCK[size][1] }; };
  c._watchBlock = function () {};
  hkGive(c, house);
  c._render();
  return c;
}
function hostOf(house, areas, entities) {
  var h = house.hass();
  h.areas = areas || {}; h.entities = entities || {}; h.devices = {};
  return h;
}

H.run('CARDS ROUND 12', [
function () {
  H.section('On Now: the count, one bar of what it is made of, the kinds as rows');
  var house = H.house({
    'light.kitchen_pendants': ['on', { friendly_name: 'Kitchen Pendants' }], 'light.den_lamp': ['on', { friendly_name: 'Den Lamp' }],
    'light.porch_light': ['on', { friendly_name: 'Porch Light' }],
    'media_player.kitchen_speaker': ['playing', { friendly_name: 'Kitchen Speaker' }], 'fan.bedroom_fan': ['on', { friendly_name: 'Bedroom Fan' }] });
  var areas = { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, den: { area_id: 'den', name: 'Den' }, porch: { area_id: 'porch', name: 'Porch' }, bedroom: { area_id: 'bedroom', name: 'Bedroom' } };
  var ents = { 'light.kitchen_pendants': { area_id: 'kitchen' }, 'light.den_lamp': { area_id: 'den' }, 'light.porch_light': { area_id: 'porch' },
               'media_player.kitchen_speaker': { area_id: 'kitchen' }, 'fan.bedroom_fan': { area_id: 'bedroom' } };
  var on = function (size) { var c = draw('hk-on-now-card', size, hostOf(house, areas, ents)); return c._root.innerHTML; };
  var segs = function (html) { return (html.match(/border-radius:[^;"]*;?"?>?/g) || []).length; };
  var L = on('L'); 
  ok('L: the count 5 is the hero, "On" and "In 4 rooms" beside it', />5<\/div>/.test(L) && /class="a kt"[^>]*>On<\/div>/.test(L) && /In 4 rooms/.test(L), words(L));
  ok('...no tiles and no header: nothing says "On Now" but the screen readers', !/On Now/.test(words(L)) && !/class="k /.test(L), words(L));
  // the bar: one segment a kind that is on, in the kind's color, wide as its share (3 lights : 1 speaker : 1 fan), 3 px apart
  var bar = L.match(/top:100px;width:[\d.]+px;height:12px;background:[^;]+;border-radius:[^"]*"/g) || [];
  eq('...ONE bar of three segments, the biggest kind first', bar.length, 3);
  var ws = bar.map(function (b) { return parseFloat(/width:([\d.]+)px/.exec(b)[1]); });
  ok('...in proportion (lights 3 of 5, the others 1 each) with 3 px between', Math.abs(ws[0] / ws[1] - 3) < 0.05 && Math.abs(ws[1] - ws[2]) < 0.05 && Math.abs(ws[0] + ws[1] + ws[2] + 6 - 369) < 0.2,
    ws);
  ok('...a color each: the lights\' first', new RegExp('background:' + window.hkCards.ACCENTS.yellow.replace(/[()]/g, '\\$&')).test(bar[0]), bar[0]);
  ok('L: a row a kind the house has, each opening it (data-open-kind), its count at the right', (L.match(/data-open-kind="/g) || []).length === 3 &&
     /data-open-kind="lights"/.test(L) && /data-open-kind="fans"/.test(L), L.match(/data-open-kind="[a-z]+"/g));
  ok('...All Off is the foot key (and only that key on Large)', (L.match(/<button type="button" class="key/g) || []).length === 1 && /data-all="1"/.test(L), L.match(/class="key[^>]*>/g));
  var XL = on('XL');
  ok('XL: two columns of rows and the foot Lights Off beside All Off', /data-off-kind="lights"/.test(XL) && /data-all="1"/.test(XL) && (XL.match(/class="key/g) || []).length === 2, words(XL));
  var W = on('W');
  ok('W: All Off beside the count, the kinds a legend under the bar: dot, count and name', /data-all="1"/.test(W) && />3 Lights<\/div>/.test(W) && />1 Speaker<\/div>/.test(W) &&
     (W.match(/class="hit"/g) || []).length === 3 && !/class="row"/.test(W), words(W));
  var S = on('S');
  ok('S: the count centered, the bar, "On Now" and the biggest kinds in a line; no keys', />5<\/div>/.test(S) && />On Now<\/div>/.test(S) && /3 lights · 1 speaker/.test(S) && !/<button/.test(S),
    words(S));
  ok('T: the count at 52, a row a kind, All Off the foot', /font-size:52px/.test(on('T')) && (on('T').match(/class="row"/g) || []).length === 3 && /data-all="1"/.test(on('T')));
  // nothing on: a quiet 0 and "All Off", an empty bar, the kinds at rest, no key
  var quiet = H.house({ 'light.den_lamp': ['off', { friendly_name: 'Den Lamp' }], 'fan.bedroom_fan': ['off', { friendly_name: 'Bedroom Fan' }] });
  var Q = draw('hk-on-now-card', 'L', hostOf(quiet, areas, ents))._root.innerHTML;
  ok('nothing on: 0 quiet with "All Off", the bar empty, no All Off key, the kinds Off', /kh quiet/.test(Q) && />All Off<\/div>/.test(Q) && !/class="key/.test(Q) && />Off<\/div>/.test(Q), words(Q));
  // what the keys do: All Off turns off what is on; Lights Off the lights alone
  var c = draw('hk-on-now-card', 'XL', hostOf(house, areas, ents)), calls = [];
  c._call = function (d, s, data) { calls.push([d, s, data.entity_id]); };
  c._off(null, 'lights', false);
  eq('Lights Off: one call, the lights on', calls, [['light', 'turn_off', ['light.kitchen_pendants', 'light.den_lamp', 'light.porch_light']]]);
  calls.length = 0; c._off(null, null, true);
  eq('All Off: a call a kind on', calls.map(function (x) { return x[0]; }), ['light', 'media_player', 'fan']);
  // White glyphs: the row glyphs go white (no color on a glyph), the bar keeps its colors
  var white = draw('hk-on-now-card', 'L', hostOf(house, areas, ents), { glyphs: 'white' })._root.innerHTML;
  ok('White glyphs: the bar keeps its colors, the glyphs do not', /background:rgb|background:#|background:var\(--hk-accent/.test(white) ||
    /background:/.test(white.match(/width:[\d.]+px;height:12px;background:[^;]+/)[0]) &&
     !/class="g on"/.test(white), white.match(/class="g[^"]*"/g));
},
function () {
  H.section('House Status: the headline\'s category leaves the list, and the line under it says something new');
  var soon = Date.now() + 3 * 3600 * 1000;
  var house = H.house({
    'sensor.alerts': ['1', { Alerts: [{ Event: 'Special Weather Statement', Headline: 'Special Weather Statement issued for the area', Severity: 'Moderate', Ends: new Date(soon).toISOString() }] }],
    'light.den_lamp': ['on', { friendly_name: 'Den Lamp' }], 'light.porch_light': ['on', { friendly_name: 'Porch Light' }], 'lock.front_door': ['locked', { friendly_name: 'Front Door' }],
    'alarm_control_panel.home': ['disarmed', {}] });
  var h = hostOf(house, { den: { name: 'Den' } }, { 'light.den_lamp': { area_id: 'den' } });
  window.hkCards.menu = Object.assign(window.hkCards.menu || {}, { board: function () { return { chips: ['weather_alert', 'lights', 'security'], chips_row: false }; } });
  var c = draw('hk-house-status-card', 'L', h), html = c._root.innerHTML;
  ok('the headline names the alert (a block under it has the kit\'s plate)', /Special Weather Statement/.test(words(html)) && /hk-plate class="kit/.test(html), words(html));
  ok('...the line under it says when it ends, and does not repeat the category ("Weather Alerts")', /Until /.test(words(html)) && !/Weather Alerts/.test(words(html)), words(html));
  ok('...and the list below it has the others only: the alert\'s row left', !/Weather Alerts/.test(words(html)) && /Lights/.test(words(html)) && /Security/.test(words(html)), words(html));
  var rows = (html.match(/class="row"/g) || []).length;
  ok('...two rows (Lights, Security), not three', rows === 2, rows);
  // a quiet house: no headline category, so every section is a row and the line says so
  var q = H.house({ 'light.den_lamp': ['off', { friendly_name: 'Den Lamp' }], 'lock.front_door': ['locked', {}], 'alarm_control_panel.home': ['disarmed', {}] });
  var qh = draw('hk-house-status-card', 'L', hostOf(q, { den: { name: 'Den' } }, {}))._root.innerHTML;
  // (the alert chip is When Active: not shown, so Lights and Security)
  ok('all good: the headline is All Good and nothing leaves the list', /All Good/.test(words(qh)) && /Nothing needs a look/.test(words(qh)) && (qh.match(/class="row"/g) || []).length === 2,
    words(qh));
}
]);
