// hk-media-card -- THE MEDIA PLAYER TILE, constructed and driven. The editor
// is tested elsewhere; test_tile.js calls the tile family's _label()/_isOn()
// on bare prototypes, because a full tile render removes the parts it does
// not draw and dom.js's stubs have no remove(). card_harness.js adds it, so
// this runs the whole card: new, setConfig, hass, render, gate, lifecycle.
//
// Configs as real dashboards write them; the two shapes are the HomePod
// (bare glyph, no well) and the TV (label_mode source_first, and the split
// tap target -- the glyph toggles, the name opens detail).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');

var HOMEPOD = 'media_player.master_bathroom_homepod_ma';
var TV = 'media_player.master_bedroom_tv';
function mediaHouse() {
  return H.house({
    [HOMEPOD]: ['playing', { source: 'Apple Music', media_title: 'Clair de Lune',
                             friendly_name: 'Master Bathroom HomePod MA' }],
    [TV]: ['idle', { source: 'HDMI 1', friendly_name: 'Master Bedroom TV' }],
    'media_player.kitchen_homepod_ma': ['idle', {}],
    'light.kitchen_table_light': ['off', {}]
  });
}
function tap(el) {
  (el._listeners.click || []).forEach(function (f) {
    f({ stopPropagation: function () {}, preventDefault: function () {} });
  });
}

H.run('MEDIA TILE', [

  function () {
    H.section('hk-media-card: a HomePod (bare glyph, transparent well)');
    var house = mediaHouse(), card = H.make('hk-media-card');
    H.noThrow('setConfig with the Master Bathroom config', function () {
      card.setConfig({ type: 'custom:hk-media-card', entity: HOMEPOD, name: 'HomePod',
        icon: 'hk:homepod-mini', icon_size: '40px', icon_color: 'rgba(255, 255, 255, 0.85)',
        bare_icon: true, bare_icon_color: 'rgba(152, 152, 157, 1)', well_background: 'transparent' });
    });
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var R = card._root, P = function (s) { return H.part(R, s); };
    H.ok('draws the pill', /<ha-card class="card" data-hk-role="card">/.test(R.__html));
    H.eq('no room line: the part is removed, not hidden', P('.room').parentNode, null);
    H.eq('name', P('.name').textContent, 'HomePod');
    H.eq('playing with a source reads Playing, as the Home app\'s HomePods do', P('.label').textContent, 'Playing');
    H.eq('playing lights the tile', P('.card').getAttribute('data-on'), '1');
    H.eq('no well, in every state', P('.well').style.background, 'transparent');
    H.eq('lit and bare: the glyph takes bare_icon_color', P('.icon').style.color, 'rgba(152, 152, 157, 1)');
    H.eq('icon_size sizes the glyph', [P('.icon').style.width, P('.icon').style.height], ['40px', '40px']);
    H.eq('the glyph', P('.icon').icon, 'hk:homepod-mini');

    H.gate('media tile', card, house,
      function () { return house.set(HOMEPOD, 'paused', { source: 'Apple Music' }); },
      function () { return house.set('media_player.kitchen_homepod_ma', 'playing'); });
    H.eq('paused reads Paused', P('.label').textContent, 'Paused');
    H.eq('...and a paused HomePod is still lit (hk_pill\'s state list)', P('.card').getAttribute('data-on'), '1');
    card.hass = house.set(HOMEPOD, 'playing', { source: 'Music Assistant Queue' });
    H.eq('...Music Assistant\'s queue is not shown', P('.label').textContent, 'Playing');
    card.hass = house.set(HOMEPOD, 'playing', { app_name: 'YouTube' });
    H.eq('...nor an Apple TV\'s app', P('.label').textContent, 'Playing');
    card.hass = house.set(HOMEPOD, 'paused', { app_name: 'YouTube' });
    H.eq('...paused with it open still reads Paused', P('.label').textContent, 'Paused');
    card.hass = house.set(HOMEPOD, 'idle', {});
    H.eq('idle reads Not Playing', P('.label').textContent, 'Not Playing');
    H.eq('...and is dark', P('.card').getAttribute('data-on'), '0');
    H.eq('dark and bare: the glyph takes icon_color', P('.icon').style.color, 'rgba(255, 255, 255, 0.85)');
    card.hass = house.drop(HOMEPOD);
    H.eq('a vanished entity reads Unavailable, falls back to the config name',
         [P('.label').textContent, P('.name').textContent], ['Unavailable', 'HomePod']);
    return H.lifecycle('media tile', card, house, function (c) { c.hass = house.hass(); });
  },

  function () {
    H.section('hk-media-card: a TV (source_first, split tap target)');
    var house = mediaHouse(), card = H.make('hk-media-card');
    card.setConfig({ type: 'custom:hk-media-card', entity: TV, name: 'TV', icon: 'hk:television',
      icon_size: '29px', icon_color: 'rgba(88, 192, 206, 0.98)', label_mode: 'source_first',
      icon_tap_action: { action: 'toggle' } });
    card.hass = house.hass();
    var R = card._root, P = function (s) { return H.part(R, s); };
    H.eq('source_first: an idle TV still names its source', P('.label').textContent, 'HDMI 1');
    H.eq('the media default icon colour is replaced, not inherited', card._config.icon_color,
         'rgba(88, 192, 206, 0.98)');
    tap(P('.well'));
    H.eq('tapping the glyph toggles the TV', house.calls,
         [{ domain: 'homeassistant', service: 'toggle', data: { entity_id: TV } }]);
    H.gate('media tile (TV)', card, house,
      function () { return house.set(TV, 'off', {}); },
      function () { return house.set(HOMEPOD, 'idle', {}); });
    H.eq('off reads Off', P('.label').textContent, 'Off');
    var r0 = card.__renders;
    card.hass = house.touch(TV);
    H.eq('a new stamp is a change (the default signature reads last_updated)', card.__renders - r0, 1);
    var plain = H.make('hk-media-card');
    plain.setConfig({ type: 'custom:hk-media-card', entity: TV });
    plain.hass = house.hass();
    H.eq('no icon_color given: the hk_media default (cyan)', plain._config.icon_color, 'cyan');
    return H.lifecycle('media tile (TV)', card, house, function (c) { c.hass = house.hass(); });
  }
]);
