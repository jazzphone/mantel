// hk-timer-strip-card -- CONSTRUCTED AND DRIVEN. The editor is tested
// elsewhere; this suite tests the card.
//
// The strip is a HOST: modules/hk-timers.js owns the markup and the
// countdowns, and the module loads in PARALLEL with the card. So the order
// that matters is the one a wall tablet actually hits -- the card renders FIRST,
// with nothing to draw, and must redraw by itself when hk-timers.js arrives
// ('hk-timers-ready'). This suite loads the module half way through on
// purpose. <hk-countdown>'s own interval and its cleanup are
// test_countdown.js's; here the strip only has to hand it the right deadline.
//
// Configs: the screensaver's (scale 1.6, fixed) and the #media pop-up's
// (plated, glass).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
function editorFields(tag) {
  var C = customElements.get(tag), probe = C.getConfigElement();
  var EC = customElements.get(String(probe.tagName || '').toLowerCase());
  var ed = EC ? new EC() : probe;
  if (!ed.appendChild) ed.appendChild = function () {};
  ed.hass = { states: {} }; ed.setConfig({ type: 'custom:' + tag });
  var out = {};
  (function walk(list) { (list || []).forEach(function (f) { if (f.schema) walk(f.schema); else out[f.name] = f; }); })(ed._form.schema);
  return out;
}

var RUNNING = 'sensor.running_quick_timers';
var PASTA = { entity_id: 'timer.quick_1', name: 'Pasta', finishes_at: '2026-09-26T12:10:00+00:00' };
var OVEN = { entity_id: 'timer.quick_2', name: 'Oven', finishes_at: '2026-09-26T12:25:00+00:00' };
function timerHouse(rows) {
  return H.house({
    [RUNNING]: [String(rows.length), { running: rows, icon: 'mdi:timer-outline' }],
    'timer.quick_1': ['active', { finishes_at: PASTA.finishes_at }],
    'light.kitchen_table_light': ['off', {}]
  });
}
var SAVER = { type: 'custom:hk-timer-strip-card', entity: RUNNING, scale: 1.6, fixed: true };

H.run('TIMER STRIP', [

  function () {
    H.section('hk-timer-strip-card, before hk-timers.js has loaded');
    H.ok('the module really is absent', !window.hkTimers);
    var house = timerHouse([PASTA]), card = H.make('hk-timer-strip-card');
    var w0 = H.snapshot().window;
    H.noThrow('setConfig with the screensaver config', function () { card.setConfig(SAVER); });
    H.ok('the host is the zero-height fixed plate', /<hk-plate class="strip fixed"/.test(card._root.__html));
    H.eq('it waits for the module: one listener', H.snapshot().window - w0, 1);
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    H.eq('nothing to draw yet, and that is not an error', H.morphed(H.part(card._root, '.strip')), '');
    H.ok('the module\'s absence is part of the signature', /\|0$/.test(card._sigOf()), card._sigOf());
    card.setConfig(SAVER);
    card.hass = house.hass();
    H.eq('a second setConfig does not wire a second listener', H.snapshot().window - w0, 1);

    // The one-shot 'hk-timers-ready' listener lives only
    // while the card is attached. Detaching before the module arrives removes
    // it (and with it the last reference to the card); re-attaching before
    // the module lands wires it again.
    H.attach(card);
    H.detach(card);
    H.eq('detached before the module loads: its listener is gone',
         H.snapshot().window - w0, 0);
    H.attach(card);
    H.eq('re-attached before the module loads: wired again', H.snapshot().window - w0, 1);
    H.detach(card);
    H.eq('...and gone again on detach', H.snapshot().window - w0, 0);
    var detachedRenders = card.__renders;

    var live = H.make('hk-timer-strip-card');
    live.setConfig({ type: 'custom:hk-timer-strip-card', plated: true, glass: true });
    live.hass = house.hass();
    H.attach(live);
    var r0 = live.__renders;
    load(HK_ROOT + '/frontend/modules/hk-timers.js');
    H.ok('hk-timers.js loaded', !!window.hkTimers);
    H.eq('every waiting listener removed itself', H.snapshot().window - w0, 0);
    H.ok('the attached strip redrew by itself', live.__renders > r0, live.__renders - r0);
    H.eq('...the detached one did not', card.__renders - detachedRenders, 0);
    var html = H.morphed(H.part(live._root, '.strip'));
    H.ok('the media bar\'s strip now shows the running timer', /Pasta/.test(html), html.slice(0, 80));
    H.ok('...as a countdown to its deadline',
         html.indexOf('<hk-countdown deadline="' + Date.parse(PASTA.finishes_at) + '"') >= 0);
    // The bar has no blur (fixed over a scrolling page it would re-blur
    // every frame); its pills wear the bar's tint, not a blur.
    H.ok('...on the bar\'s tint (plated + glass), no blur of its own',
         /rgba\(22,23,26,\.92\)/.test(html) && !/backdrop-filter/.test(html));
    H.ok('...with the restart / +1 min / finish controls for timer.quick_1',
         // (data attributes, read by hk-timers.js's one delegated listener: no inline handler, which Mantel's CSP refuses)
         /data-hk-timer="timer\.quick_1" data-hk-timer-act="restart"/.test(html) &&
         /data-hk-timer="timer\.quick_1" data-hk-timer-act="plus"/.test(html) &&
         /data-hk-timer="timer\.quick_1" data-hk-timer-act="finish"/.test(html) && !/onclick=/.test(html));
    H.detach(live);
  },

  function () {
    H.section('hk-timer-strip-card, with hk-timers.js loaded');
    var house = timerHouse([PASTA]), card = H.make('hk-timer-strip-card');
    var w0 = H.snapshot().window;
    card.setConfig(SAVER);
    H.eq('the module is here: no listener is wired', H.snapshot().window - w0, 0);
    card.hass = house.hass();
    var html = H.morphed(H.part(card._root, '.strip'));
    H.ok('the screensaver strip draws the timer', /Pasta/.test(html));
    H.ok('...scaled 1.6x (a 20px countdown drawn at 32px)', /font-size:32px/.test(html));
    H.ok('...with no controls on the screensaver', !/act\(/.test(html));
    H.ok('...in its own fixed wrapper', /position:fixed/.test(html));

    H.gate('timer strip', card, house,
      function () { return house.set(RUNNING, '2', { running: [PASTA, OVEN] }); },
      function () { return house.set('timer.quick_1', 'active', { finishes_at: '2026-09-26T12:11:00+00:00' }); });
    // ^ the TIMER entity is not an input: the strip reads the sensor's
    // prepared list, which is where "which timers count" lives.
    html = H.morphed(H.part(card._root, '.strip'));
    H.ok('the second timer is drawn', /Pasta/.test(html) && /Oven/.test(html));
    card.hass = house.set(RUNNING, '0', { running: [] });
    H.eq('nothing running: the strip draws nothing (no gap above the player)',
         H.morphed(H.part(card._root, '.strip')), '');
    var def = H.make('hk-timer-strip-card');
    def.setConfig({ type: 'custom:hk-timer-strip-card' });
    def.hass = timerHouse([OVEN]).hass();
    H.ok('no entity configured: sensor.running_quick_timers by default',
         /Oven/.test(H.morphed(H.part(def._root, '.strip'))));
    return H.lifecycle('timer strip', card, house, function (c) {
      c.hass = house.set(RUNNING, '1', { running: [OVEN] });
    });
  },

  // THE EDITORS offer what the cards read: the strip's `docked`, the
  // vacuum's tap.
  function () {
    H.section('editors');
    var strip = editorFields('hk-timer-strip-card'), vac = editorFields('hk-vacuum-card');
    H.ok('hk-timer-strip-card: Docked', !!strip.docked && !!strip.docked.selector.boolean && !!strip.docked.helper);
    H.ok('hk-vacuum-card: tap_action', !!vac.tap_action && !!vac.tap_action.selector.ui_action);
  }
]);
