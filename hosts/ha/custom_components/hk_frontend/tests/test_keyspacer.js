// hk-key-card and hk-spacer-card -- CONSTRUCTED AND DRIVEN. The editors are
// tested elsewhere; this suite tests the cards.
//
// Both are STATELESS by design: their _sigOf is the constant 'static', so no
// hass push -- related to anything or not -- may ever redraw them. The render
// gate test here is therefore the inverse of the other suites': every entity
// is "unrelated". What a key does is its tap, so a Timers page's two kinds
// of key ("+ New Timer" navigates, "5 min" runs script.quick_timer_start)
// are tapped and their action checked.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');

// A navigate tap pushes history and announces it, like HA's own navigate().
location.pathname = '/dashboard-kitchen/timers';
var pushed = [];
globalThis.history = { pushState: function (_s, _t, p) { pushed.push(p); location.pathname = p; } };
function tap(el) {
  (el._listeners.click || []).forEach(function (f) {
    f({ stopPropagation: function () {}, preventDefault: function () {} });
  });
}
function keyHouse() {
  return H.house({
    'sensor.running_quick_timers': ['0', { running: [] }],
    'light.kitchen_table_light': ['off', {}]
  });
}
// A card with a constant signature: nothing the house does redraws it.
function staticGate(name, card, house) {
  var r0 = card.__renders;
  H.eq(name + ': the signature is the constant "static"', card._sigOf(), 'static');
  card.hass = house.set('light.kitchen_table_light', 'on');
  card.hass = house.set('sensor.running_quick_timers', '1', { running: [{ name: 'Pasta' }] });
  H.eq(name + ': still static after the house changed', card._sigOf(), 'static');
  H.eq(name + ': ...and never redrawn by hass', card.__renders - r0, 0);
}

H.run('KEY AND SPACER', [

  function () {
    H.section('hk-key-card: "+ New Timer" (variant filled, navigate)');
    H.throws('neither icon nor name: the config is refused', function () {
      H.make('hk-key-card').setConfig({ variant: 'glass' });
    });
    var house = keyHouse(), card = H.make('hk-key-card');
    H.noThrow('setConfig with the Timers page config', function () {
      card.setConfig({ type: 'custom:hk-key-card', name: '+ New Timer', variant: 'filled',
        fill: 'rgba(255, 159, 10, 0.95)', width: '184px',
        tap_action: { action: 'navigate', navigation_path: './timer-new' } });
    });
    var R = card._root;
    H.ok('draws before any hass (it needs none)', /<ha-card class="key filled"/.test(R.__html), R.__html);
    H.ok('a word key has a name, not an icon', /class="name"/.test(R.__html) && !/ha-state-icon/.test(R.__html));
    H.eq('the word', H.part(R, '.name').textContent, '+ New Timer');
    H.eq('fill', H.part(R, '.key').style.background, 'rgba(255, 159, 10, 0.95)');
    H.eq('width', H.part(R, '.key').style.width, '184px');
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    staticGate('key', card, house);
    tap(H.part(R, '.key'));
    H.runTimers();
    H.eq('tap: "./timer-new" resolves against THIS dashboard', pushed, ['/dashboard-kitchen/timer-new']);
    H.eq('...and calls no service', house.calls.length, 0);
    return H.lifecycle('key', card, house, function (c) { c.hass = house.hass(); });
  },

  function () {
    H.section('hk-key-card: "5 min" (variant glass, perform-action)');
    location.pathname = '/dashboard-kitchen/timers';
    var house = keyHouse(), card = H.make('hk-key-card');
    card.setConfig({ type: 'custom:hk-key-card', name: '5 min', variant: 'glass',
      tap_action: { action: 'perform-action', perform_action: 'script.quick_timer_start',
                    data: { duration: '00:05:00' } } });
    card.hass = house.hass();
    H.ok('the glass variant', /<ha-card class="key glass"/.test(card._root.__html));
    tap(H.part(card._root, '.key'));
    H.eq('tap runs the script with its duration', house.calls,
         [{ domain: 'script', service: 'quick_timer_start', data: { duration: '00:05:00' } }]);
    // A config edit in the card editor re-runs setConfig on the SAME element;
    // the key must rebuild with the new variant, not keep the first one.
    card.setConfig({ type: 'custom:hk-key-card', name: '10 min', variant: 'flat' });
    H.ok('a second setConfig rebuilds (the editor preview)', /<ha-card class="key flat"/.test(card._root.__html));
    H.eq('...with the new word', H.part(card._root, '.name').textContent, '10 min');
    var icon = H.make('hk-key-card');
    H.noThrow('an icon key renders', function () {
      icon.setConfig({ type: 'custom:hk-key-card', icon: 'mdi:play', variant: 'flat',
                       icon_color: 'rgba(255,255,255,0.9)' });
      icon.hass = house.hass();
    });
    H.eq('...its glyph', H.part(icon._root, '.icon').icon, 'mdi:play');
    H.ok('...an unknown variant falls back to glass', (function () {
      var k = H.make('hk-key-card'); k.setConfig({ name: 'x', variant: 'shiny' });
      return /class="key glass"/.test(k._root.__html);
    })());
  },

  function () {
    H.section('hk-spacer-card (a phone header, a daily-energy page, a camera strip)');
    var house = keyHouse(), card = H.make('hk-spacer-card');
    H.noThrow('setConfig with the phone config', function () {
      card.setConfig({ type: 'custom:hk-spacer-card', height: '2px' });
    });
    H.ok('draws an inert, hidden plate', /<ha-card class="spacer" data-hk-role="card" aria-hidden="true">/
      .test(card._root.__html));
    H.eq('at the configured height', H.part(card._root, '.spacer').style.height, '2px');
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    staticGate('spacer', card, house);
    card.setConfig({ type: 'custom:hk-spacer-card', height: '22px' });
    H.eq('a new height is applied on setConfig', H.part(card._root, '.spacer').style.height, '22px');
    var bare = H.make('hk-spacer-card');
    H.noThrow('no config at all is allowed', function () { bare.setConfig(undefined); });
    H.eq('...and defaults to 16px', H.part(bare._root, '.spacer').style.height, '16px');
    return H.lifecycle('spacer', card, house, function (c) { c.hass = house.hass(); });
  }
]);
