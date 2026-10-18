// THE REAL CARD, not an extraction: a hand-copied transcription of the rule
// would be a second source of truth. hk-now-playing-card owns the rule, and
// _playerLine is called directly: it is a pure function of (config, states).
var DIR = HK_ROOT + '/tests/';
load(DIR + 'dom.js');
// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/tests/music_house.js');   // the integration's config, as a screen receives it
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
var NP = customElements.get('hk-now-playing-card');
// THE SCREEN'S FOCUS, not a selector: the option named in the fixture
// becomes this screen's focus in hkMusic, which is what the card resolves
// its player from.
function playerField(states, cfg) {
  var c = Object.create(NP.prototype);
  c._config = { music: true };
  var sel = states['input_select.media_player_selection'];
  window.hkMusic._reset();
  if (sel && cfg.speaker_map[sel.state]) window.hkMusic.setFocus(cfg.speaker_map[sel.state]);
  c._hass = { states: states };
  return c._playerLine(c._player());
}
var MAP = {
  'Everywhere':'media_player.homepods_2',
  'Downstairs':'media_player.downstairs_homepods_downstairs',
  'Kitchen':'media_player.kitchen_homepod_ma',
  'Living Room':'media_player.living_room_homepod_ma',
  'Master Bedroom':'media_player.master_bedroom_homepod_ma',
  'Master Bathroom':'media_player.master_bathroom_homepod_ma',
  'Office':'media_player.office_homepod_ma',
  "Kid's Room":'media_player.kids_room_homepod_ma',
  'Guest Bedroom':'media_player.guest_bedroom_homepod_ma',
  'Extra Room':'media_player.extra_room_homepod_ma',
  'Loft':'media_player.loft_homepod_ma'
};
function e(k){return 'media_player.'+k+'_homepod_ma';}
function S(sel, ent, state, fname, gm, extra) {
  var st={'input_select.media_player_selection':{state:sel}};
  // entity_id on every state, as a real hass has it -- the card names a
  // player by hkMusic's short name, keyed on entity_id.
  if(ent) st[ent]={entity_id:ent,state:state,attributes:{friendly_name:fname,group_members:gm}};
  Object.keys(extra||{}).forEach(function(k){st[k]={entity_id:k,state:'playing',attributes:{friendly_name:extra[k]}};});
  return st;
}
// The separator is real characters -- NBSP, middle dot, NBSP: the card sets
// textContent, so HTML entities would print literally.
var D=' \u00a0\u00b7\u00a0 ', pass=0, fail=0;
function ok(n,got,want){if(got===want){pass++;print('  PASS  '+n+'\n          '+got);}
  else{fail++;print('  FAIL  '+n+'\n          got  '+got+'\n          want '+want);}}

print('=== UNCHANGED cases (must not regress) ===');
// SHORT NAMES: the room the pills call it, not the entity's friendly_name
// -- the same rule the joined-rooms line uses.
ok('single room', playerField(S('Kitchen',e('kitchen'),'playing','Kitchen HomePod MA',[]),{speaker_map:MAP}),
   'PLAYING ON'+D+'KITCHEN');
ok('sync group Downstairs',
   playerField(S('Downstairs','media_player.downstairs_homepods_downstairs','playing','HomePods Downstairs',null),{speaker_map:MAP}),
   'PLAYING ON'+D+'DOWNSTAIRS');
ok('group of exactly 1', playerField(S('Kitchen',e('kitchen'),'playing','Kitchen HomePod MA',[e('kitchen')]),{speaker_map:MAP}),
   'PLAYING ON'+D+'KITCHEN');
// No focus, nothing playing, no home room: says what to do, not what broke.
ok('nothing chosen, nothing playing', playerField(S('Nonsense',null),{speaker_map:MAP}),
   'NOTHING PLAYING'+D+'PICK SPEAKERS ON PLAY MUSIC');

print('\n=== NAMED ROOMS (the new behaviour) ===');
ok('2 rooms', playerField(S('Kitchen',e('kitchen'),'playing','Kitchen HomePod MA',
     [e('kitchen'),e('living_room')]),{speaker_map:MAP}),
   'PLAYING ON'+D+'KITCHEN, LIVING ROOM');
ok('4 rooms (the cap)', playerField(S('Kitchen',e('kitchen'),'playing','Kitchen HomePod MA',
     [e('kitchen'),e('living_room'),e('office'),e('loft')]),{speaker_map:MAP}),
   'PLAYING ON'+D+'KITCHEN, LIVING ROOM, OFFICE, LOFT');
ok('5 rooms -> 4 names +1', playerField(S('Kitchen',e('kitchen'),'playing','Kitchen HomePod MA',
     [e('kitchen'),e('living_room'),e('master_bedroom'),e('master_bathroom'),e('guest_bedroom')]),{speaker_map:MAP}),
   'PLAYING ON'+D+'KITCHEN, LIVING ROOM, MASTER BEDROOM, MASTER BATHROOM +1');
ok('all 9 -> 4 names +5', playerField(S('Kitchen',e('kitchen'),'playing','Kitchen HomePod MA',
     [e('kitchen'),e('living_room'),e('master_bedroom'),e('master_bathroom'),
      e('guest_bedroom'),e('office'),e('kids_room'),e('extra_room'),e('loft')]),{speaker_map:MAP}),
   'PLAYING ON'+D+'KITCHEN, LIVING ROOM, MASTER BEDROOM, MASTER BATHROOM +5');
ok('order follows group_members (leader first)',
   playerField(S('Loft',e('loft'),'playing','Loft HomePod MA',
     [e('loft'),e('kitchen'),e('office')]),{speaker_map:MAP}),
   'PLAYING ON'+D+'LOFT, KITCHEN, OFFICE');
ok('paused ad-hoc', playerField(S('Loft',e('loft'),'paused','Loft HomePod MA',
     [e('loft'),e('office')]),{speaker_map:MAP}),
   'PAUSED ON'+D+'LOFT, OFFICE');
ok("apostrophe room name", playerField(S('Loft',e('loft'),'playing','Loft HomePod MA',
     [e('loft'),e('kids_room')]),{speaker_map:MAP}),
   'PLAYING ON'+D+"LOFT, KID'S ROOM");

print('\n=== a member with no pill falls back to friendly_name ===');
ok('unmapped member', playerField(S('Kitchen',e('kitchen'),'playing','Kitchen HomePod MA',
     [e('kitchen'),'media_player.mystery'], {'media_player.mystery':'Mystery Box'}),{speaker_map:MAP}),
   'PLAYING ON'+D+'KITCHEN, MYSTERY BOX');

print('\n=== the transport button shows what it will DO ===');
// The combined play/pause button shows the icon for what is happening now.
// mdi:play-pause is honest about the SERVICE it calls and useless as a
// status -- identical whether the room is silent or mid-track.
function iconFor(state) {
  var c = Object.create(NP.prototype);
  c._config = { entity: 'input_select.media_player_selection', speaker_map: MAP };
  var states = { 'input_select.media_player_selection': { state: 'Kitchen' } };
  if (state !== null) {
    states[e('kitchen')] = { state: state, attributes: { media_title: 't' } };
  }
  c._hass = { states: states };
  // THE CARD'S OWN METHOD, not a copy of its expression.
  return c._playIcon(c._player());
}
// And the painter that _render actually calls, so the wiring is covered too.
function paintedIcon(state) {
  var c = Object.create(NP.prototype);
  c._config = { entity: 'input_select.media_player_selection', speaker_map: MAP };
  var states = { 'input_select.media_player_selection': { state: 'Kitchen' } };
  states[e('kitchen')] = { state: state, attributes: { media_title: 't' } };
  c._hass = { states: states };
  var icon = document.createElement('ha-icon');
  icon.setAttribute('icon', 'mdi:play');
  var btn = document.createElement('div');
  btn.querySelector = function () { return icon; };
  c._e = { play: btn };
  c._paintPlayButton(c._player());
  return { icon: icon.getAttribute('icon'), label: btn.getAttribute('aria-label') };
}
ok('playing shows PAUSE',        iconFor('playing'), 'mdi:pause');
ok('paused shows play',          iconFor('paused'),  'mdi:play');
ok('idle shows play',            iconFor('idle'),    'mdi:play');
ok('off shows play',             iconFor('off'),     'mdi:play');
ok('unavailable shows play',     iconFor('unavailable'), 'mdi:play');
// No speaker resolved at all -- the useful next action is still "start
// something", so this falls out correctly without a branch of its own.
ok('no player at all shows play', iconFor(null),     'mdi:play');

// The painter _render calls, including the screen-reader label.
ok('painting a playing room sets pause', paintedIcon('playing').icon, 'mdi:pause');
ok('  ...and says Pause out loud',       paintedIcon('playing').label, 'Pause');
ok('painting a paused room sets play',   paintedIcon('paused').icon, 'mdi:play');
ok('  ...and says Play out loud',        paintedIcon('paused').label, 'Play');

// The card must actually REPAINT when playback starts or stops, or the glyph
// is right on load and wrong until something else happens.
function sigFor(state, updated) {
  var c = Object.create(NP.prototype);
  c._config = { entity: 'input_select.media_player_selection', speaker_map: MAP };
  c._hass = { states: {
    'input_select.media_player_selection': { state: 'Kitchen', last_updated: 'a' },
    'media_player.kitchen_homepod_ma': { state: state, last_updated: updated,
                                         attributes: { media_title: 't' } } } };
  return c._sigOf();
}
ok('playing -> paused changes the signature',
   sigFor('playing', 't1') !== sigFor('paused', 't2'), true);

// ...AND THROUGH _render(), because the call living in the right place is the
// half that can be deleted silently: with `this._paintPlayButton(p)` removed
// from the render block every assertion above would still pass.
function renderedIcon(state) {
  // morph() parses an HTML string into real nodes, which tests/dom.js does not
  // do -- it only paints the artwork here, so a no-op double is faithful for
  // what this test is about. Restored immediately afterwards.
  var realMorph = window.hkCards.morph;
  window.hkCards.morph = function () {};
  try {
  var c = new NP();
  c.setConfig({ entity: 'input_select.media_player_selection', speaker_map: MAP });
  var states = { 'input_select.media_player_selection': { state: 'Kitchen', last_updated: 'a' } };
  states[e('kitchen')] = { state: state, last_updated: state,
                           attributes: { media_title: 't', media_artist: 'a' } };
  c.hass = { states: states, callService: function () {} };
  var btn = c._e && c._e.play;
  var ic = btn && btn.querySelector('ha-icon');
  return { icon: ic ? ic.getAttribute('icon') : '(no button)',
           label: btn ? btn.getAttribute('aria-label') : '(no button)' };
  } finally { window.hkCards.morph = realMorph; }
}
print('\n=== ...and the render block actually calls it ===');
ok('a full render of a playing room shows pause', renderedIcon('playing').icon, 'mdi:pause');
ok('  ...labelled Pause', renderedIcon('playing').label, 'Pause');
ok('a full render of a paused room shows play', renderedIcon('paused').icon, 'mdi:play');
ok('a full render of an idle room shows play', renderedIcon('idle').icon, 'mdi:play');


// THE EDITOR'S FIELDS, by name (sections and grids flattened)
function editorFields(tag) {
  var K = customElements.get(tag), p = K.getConfigElement(),
      EC = customElements.get(String(p.tagName).toLowerCase());
  var ed = new EC();
  if (!ed.appendChild) ed.appendChild = function () {};
  ed.setConfig({});
  var out = {};
  (function walk(s) { (s || []).forEach(function (f) { if (f.schema) walk(f.schema); else out[f.name] = f; }); })(ed._form.schema);
  return out;
}

print('\n=== from the card picker, on a dashboard of your own ===');
var npStub = NP.getStubConfig();
ok('the player\'s stub has controls: HK Media Controls following the screen\'s music',
   JSON.stringify(npStub.meta_card),
   '{"type":"custom:hk-media-control-card","color":"purple","bare":true,"parts":["progress","volume"],"entity_from":{"music":true}}');
ok('...in the wide layout\'s one slot, not sub_card (the tall layout\'s)', npStub.sub_card, undefined);
ok('...and no music: true (never read)', npStub.music, undefined);
var npF = editorFields('hk-now-playing-card');
ok('Hide When Idle is in its editor', npF.hide_idle && npF.hide_idle.label + ' / ' + JSON.stringify(npF.hide_idle.selector),
   'Hide When Idle / {"boolean":{}}');
ok('...Tall layout stays', !!npF.tall, true);
ok('the controls cards say what goes there', !!(npF.meta_card.helper && npF.sub_card.helper), true);
var SP = customElements.get('hk-speaker-picker-card');
ok('the speaker picker\'s stub has no Browse page (only HK\'s own screens have one)', JSON.stringify(SP.getStubConfig()), '{}');
ok('...the option stays in its editor', !!editorFields('hk-speaker-picker-card').browse_url, true);

print('\n'+(fail?'FAILURES: '+fail:'ALL '+pass+' TESTS PASS'));
