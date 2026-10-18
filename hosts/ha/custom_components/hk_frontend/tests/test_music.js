// hkMusic -- the music model in cards/hk-base.js: each screen's own choice
// of speaker, with no shared helper entity.
//
// It answers "what is this screen about" for every music card, so every rule
// in it is a rule the whole Music page, the bar and the screensaver obey. The
// state shapes below are the ones Music Assistant really reports, not idealized:
//   * a PLAYING group: every member reports the whole group_members list,
//     leader first;
//   * an IDLE group: members may report [] while the leader reports the list;
//   * a Music Assistant SYNC GROUP entity reports group_members None.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/tests/music_house.js');   // the integration's config, as a screen receives it
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-chip.js');

var pass = 0, fail = 0;
function ok(what, got, want) {
  if (String(got) === String(want)) { pass++; return; }
  fail++;
  print('  FAIL ' + what + '\n    got  ' + got + '\n    want ' + want);
}
function drain() { for (var i = 0; i < 6; i++) drainMicrotasks(); }

var M = window.hkMusic;
function e(k) { return 'media_player.' + k + '_homepod_ma'; }
var EVERY = 'media_player.homepods_2', DOWNG = 'media_player.downstairs_homepods_downstairs';
var DOWN = ['kitchen', 'living_room', 'master_bedroom', 'master_bathroom', 'guest_bedroom'].map(e);
var ROOMS = DOWN.concat(['office', 'kids_room', 'extra_room', 'loft'].map(e));

// A house: every speaker idle unless `on` says otherwise.
//   on[entity] = {state, gm, title, since}
function house(on) {
  var st = {};
  [EVERY, DOWNG].concat(ROOMS).forEach(function (id) {
    st[id] = { entity_id: id, state: 'idle', last_changed: '2026-09-22T10:00:00Z',
               attributes: { group_members: id.indexOf('_ma') > 0 ? [] : null } };
  });
  Object.keys(on || {}).forEach(function (id) {
    var o = on[id];
    st[id] = { entity_id: id, state: o.state || 'playing',
               last_changed: o.since || '2026-09-22T10:00:00Z',
               attributes: { group_members: o.gm === undefined ? [] : o.gm,
                             media_title: o.title || '' } };
  });
  return { states: st };
}
function group(members, extra) {
  var on = {};
  members.forEach(function (m) {
    on[m] = Object.assign({ gm: members.slice() }, extra || {});
  });
  return on;
}
function merge() {
  var out = {};
  Array.prototype.forEach.call(arguments, function (o) { Object.assign(out, o); });
  return out;
}

print('=== the generated model is the house ===');
ok('eleven speakers', M.speakers().length, 11);
ok('two presets, with their rooms', M.presets().map(function (p) {
  return p.name + ':' + p.members.length; }).join(','), 'Everywhere:9,Downstairs:5');
ok('nine rooms', M.rooms().length, 9);
ok('short names', M.nameOf(e('kids_room')), "Kid's Room");
ok('an unknown entity is not a speaker', M.known('media_player.tv'), false);

print('\n=== contexts: one derivation, from the states as MA reports them ===');
var cx = M.contexts(house({}));
ok('silence is not a context', cx.length, 0);
cx = M.contexts(house({ 'media_player.office_homepod_ma': { title: 'A' } }));
ok('a room on its own', cx.length + ':' + cx[0].kind + ':' + cx[0].key, '1:room:' + e('office'));
cx = M.contexts(house(group([e('office'), e('loft')], { title: 'B' })));
ok('a join is ONE context, keyed on its leader',
   cx.length + ':' + cx[0].kind + ':' + cx[0].key, '1:group:' + e('office'));
ok('  ...with both rooms', cx[0].members.join(','), [e('office'), e('loft')].join(','));
ok('  ...named as both', M.label(cx[0]), 'Office + Loft');
cx = M.contexts(house(group([e('office'), e('loft'), e('extra_room')])));
ok('three rooms read "A +2"', M.label(cx[0]), 'Office +2');
// A sync group is recognised by ITS OWN state.
var syncOn = merge(group(DOWN), { 'media_player.downstairs_homepods_downstairs': { gm: null, title: 'C' } });
cx = M.contexts(house(syncOn));
ok('a playing sync group is the preset', cx.length + ':' + cx[0].kind + ':' + cx[0].key,
   '1:preset:' + DOWNG);
ok('  ...named as the preset', M.label(cx[0]), 'Downstairs');
cx = M.contexts(house(group(DOWN)));
ok('the same rooms joined AD HOC are not the preset',
   cx[0].kind + ':' + cx[0].key, 'group:' + e('kitchen'));
// A stale group must not hide a room that is really playing on its own.
var stale = { 'media_player.downstairs_homepods_downstairs': { state: 'paused', gm: null },
              'media_player.kitchen_homepod_ma': { title: 'D' } };
cx = M.contexts(house(stale));
ok('a paused sync group whose rooms are idle claims nothing',
   cx.map(function (c) { return c.kind + ':' + c.key; }).join(','), 'room:' + e('kitchen'));
cx = M.contexts(house(merge(group([e('office'), e('loft')]),
                            { 'media_player.kitchen_homepod_ma': { title: 'E' } })));
ok('two separate contexts', cx.length, 2);
cx = M.contexts(house({ 'media_player.office_homepod_ma': { gm: [e('office'), 'media_player.tv'] } }));
ok('a member we have no pill for is dropped', cx[0].members.join(','), e('office'));
cx = M.contexts(house({ 'media_player.office_homepod_ma': { state: 'paused' } }));
ok('paused is a context, but not playing', cx.length + ':' + cx[0].playing, '1:false');

print('\n=== resolve(): the rules, in order ===');
// The home room is the SIGNED-IN USER's, from the integration's options --
// each wall tablet is its own user.
function withHome(room) { M._configure(Object.assign({}, HK_HOUSE, { home: room })); }
M._reset();
withHome(e('kitchen'));
var r = M.resolve(house({}));
ok('nothing chosen, nothing playing -> the tablet\'s own room',
   r.player + ':' + r.reason, e('kitchen') + ':home');
withHome(null);
r = M.resolve(house({}));
ok('no home room -> nothing, honestly', String(r.player) + ':' + r.reason, 'null:none');
r = M.resolve(house({ 'media_player.office_homepod_ma': {} }));
ok('no focus, something playing -> follow it', r.player + ':' + r.reason,
   e('office') + ':following');

M.setFocus(e('loft'));
r = M.resolve(house(group([e('loft'), e('office')])));
ok('focused room playing -> it', r.player + ':' + r.reason, e('loft') + ':focus');
// With NEWER music elsewhere, so "follow what is playing" would give a
// different answer -- the member rule has to be what decides this.
r = M.resolve(house(merge(group([e('office'), e('loft')]),
  { 'media_player.kitchen_homepod_ma': { since: '2026-09-22T23:00:00Z' } })));
ok('focused room is a MEMBER -> the player is its leader', r.player + ':' + r.name,
   e('office') + ':Office + Loft');
r = M.resolve(house({ 'media_player.kitchen_homepod_ma': {} }));
ok('focused room idle, another playing -> show what is playing',
   r.player + ':' + r.reason, e('kitchen') + ':following');
M.resolve(house({}));   // (not following it: a followed one stays followed when paused -- below)
r = M.resolve(house({ 'media_player.kitchen_homepod_ma': { state: 'paused' } }));
ok('...but a PAUSED context does not pull an idle screen',
   r.player + ':' + r.reason, e('loft') + ':idle');

// A PAUSED CHOICE STAYS PUT. Office+Loft playing; the screen is pointed at the
// Extra Room, which plays and is then paused -- and Music Assistant turns a
// paused AirPlay room IDLE about 30 s later. The screen must NOT then jump to
// Office+Loft, which were playing all along: only a NEW start pulls it.
M._reset();
var ol = group([e('office'), e('loft')], { since: '2026-09-22T09:00:00Z' });
M.setFocus(e('extra_room'));
M.resolve(house(merge(ol, { 'media_player.extra_room_homepod_ma': {} })));   // focus taken
r = M.resolve(house(merge(ol, { 'media_player.extra_room_homepod_ma': { state: 'paused' } })));
ok('paused: still the Extra Room', r.player + ':' + r.reason, e('extra_room') + ':focus');
r = M.resolve(house(ol));                         // ...and MA idles it
ok('gone idle: STILL the Extra Room, not the music that was already playing',
   r.player + ':' + r.reason, e('extra_room') + ':idle');
r = M.resolve(house(merge(ol, { 'media_player.kitchen_homepod_ma': { since: '2026-09-22T12:00:00Z' } })));
ok('...but music that STARTS now does pull it', r.player + ':' + r.reason,
   e('kitchen') + ':following');
var ol2 = group([e('office'), e('loft')], { since: '2026-09-22T12:30:00Z' });
r = M.resolve(house(ol2));
ok('...and so does music that stopped and started again', r.player, e('office'));

// PAUSED, STILL FOLLOWED: the bar's own pause must not drop the screen back
// to its idle focus (the Living Room tablet, following the Office).
M._reset();
M.setFocus(e('loft'));
M.resolve(house({}));
var offOn = { 'media_player.office_homepod_ma': { since: '2026-09-22T14:00:00Z' } };
ok('music started after the choice is followed', M.resolve(house(offOn)).reason, 'following');
var offPaused = { 'media_player.office_homepod_ma': { state: 'paused', since: '2026-09-22T14:05:00Z' } };
r = M.resolve(house(offPaused));
ok('  ...and still followed once paused', r.player + ':' + r.reason, e('office') + ':following');
r = M.resolve(house(merge(offPaused, { 'media_player.kitchen_homepod_ma': { since: '2026-09-22T13:00:00Z' } })));
ok('  ...but music that is playing comes before it', r.player, e('kitchen'));
ok('  ...and once it stops, the screen goes back to its own',
   (M.resolve(house(offPaused)), M.resolve(house({}))).player + ':' + M.resolve(house({})).reason, e('loft') + ':idle');
ok('  ...and paused music it was not following does not pull it',
   M.resolve(house({ 'media_player.extra_room_homepod_ma': { state: 'paused', since: '2026-09-22T15:00:00Z' } })).reason, 'idle');

// A NEW CHOICE STARTS A NEW "ALREADY PLAYING". Following the Kitchen (which
// started after the focus was set), you tap the idle Kid's Room: the
// Kitchen was playing when you CHOSE that room, so it must not pull you back.
M._reset();
M.setFocus(e('loft'));
M.resolve(house({}));
var kit = { 'media_player.kitchen_homepod_ma': { since: '2026-09-22T13:00:00Z' } };
ok('a start after the choice is followed', M.resolve(house(kit)).player, e('kitchen'));
M.setFocus(e('kids_room'));
r = M.resolve(house(kit));
ok('  ...but choosing another room resets what counts as new',
   r.player + ':' + r.reason, e('kids_room') + ':idle');

// Home room wins ties, then the newest.
M._reset();
withHome(e('loft'));
var two = merge({ 'media_player.kitchen_homepod_ma': { since: '2026-09-22T12:00:00Z' } },
                { 'media_player.loft_homepod_ma': { since: '2026-09-22T11:00:00Z' } });
ok('the tablet\'s own room first', M.resolve(house(two)).player, e('loft'));
withHome(null);
ok('otherwise the newest', M.resolve(house(two)).player, e('kitchen'));
// ...and newest really means newest, not first in the speaker list: here the
// Loft (listed last) started after the Kitchen (listed first).
var two2 = merge({ 'media_player.kitchen_homepod_ma': { since: '2026-09-22T11:00:00Z' } },
                 { 'media_player.loft_homepod_ma': { since: '2026-09-22T12:00:00Z' } });
ok('  ...whatever the list order', M.resolve(house(two2)).player, e('loft'));

// HOLD: a request in flight keeps the screen on its target.
var realNow = Date.now, clock = 1000000;
Date.now = function () { return clock; };
M._reset();
M.setFocus(e('office'), { hold: true });
var busy = house({ 'media_player.kitchen_homepod_ma': {} });
r = M.resolve(busy);
ok('a held request outranks other music', r.player + ':' + r.reason, e('office') + ':pending');
clock += M.HOLD + 1;
r = M.resolve(busy);
// The Kitchen was ALREADY playing when the Office was asked for, so the
// screen stays on what you asked for rather than jumping there.
ok('  ...but not forever: it ends, and the screen stays on what was asked for',
   r.player + ':' + r.reason, e('office') + ':idle');
clock = 1000000;
M.setFocus(e('office'), { hold: true });
M.release(e('office'));
ok('  ...and a failed request lets go at once', M.resolve(busy).reason, 'idle');
ok('  ...while music that starts AFTERWARDS is followed',
   M.resolve(house({ 'media_player.kitchen_homepod_ma': { since: '2026-09-22T23:59:00Z' } })).reason,
   'following');
Date.now = realNow;

print('\n=== setFocus / persistence / bad input ===');
M._reset();
var changes = 0;
M.onChange(function () { changes++; });
ok('an unknown key is refused', M.setFocus('media_player.nonsense'), false);
ok('  ...and changes nothing', String(M.focus()) + ':' + changes, 'null:0');
ok('a known key is taken', M.setFocus(e('loft')), true);
ok('  ...and announced once', changes, 1);
ok('  ...and kept for the first paint', JSON.parse(localStorage.getItem('hk_music_focus')).key, e('loft'));
__lsThrows = true;
ok('blocked storage does not break setFocus', M.setFocus(e('office')), true);
__lsThrows = false;
// The server copy: frontend/set_user_data out, subscribe_user_data in.
M._reset();
var sent = [], subs = [];
var conn = {
  sendMessagePromise: function (m) { sent.push(m); return Promise.resolve(); },
  subscribeMessage: function (cb, m) { subs.push({ cb: cb, m: m }); return Promise.resolve(function () {}); }
};
M.attach({ connection: conn });
M.attach({ connection: conn });
function sub(type) { return subs.filter(function (s) { return s.m.type === type; }); }
ok('subscribes to the saved focus once per connection',
   sub('frontend/subscribe_user_data').length, 1);
ok('  ...under its own key', sub('frontend/subscribe_user_data')[0].m.key, 'hk_music_focus');
ok('and to the integration\'s configuration, once',
   sub('hk_music/subscribe').length, 1);
var saved = sub('frontend/subscribe_user_data')[0];
saved.cb({ value: { key: e('extra_room'), at: 5 } });
ok('the saved focus is adopted when it arrives', M.focus(), e('extra_room'));
// ...even before the speaker list has arrived, since the two subscriptions
// answer in either order -- resolve() is what refuses a key it does not know.
saved.cb({ value: { key: 'media_player.renamed_away', at: 6 } });
ok('a saved key that no longer exists is kept but never resolved',
   M.resolve(house({})).reason === 'focus' || M.resolve(house({})).player === 'media_player.renamed_away',
   false);
saved.cb({ value: { key: e('extra_room'), at: 7 } });
saved.cb({ value: null });
ok('an empty saved value is ignored', M.focus(), e('extra_room'));
M.setFocus(e('loft'));
ok('a choice is saved to the server',
   sent.length === 1 && sent[0].type === 'frontend/set_user_data' && sent[0].value.key === e('loft'),
   true);
saved.cb({ value: { key: e('extra_room'), at: 1 } });
ok('an echo arriving mid-write cannot undo the choice', M.focus(), e('loft'));
drain();
ok('once the write has landed, the server is followed again',
   (saved.cb({ value: { key: e('office'), at: 9 } }), M.focus()), e('office'));

// A RESTORED CHOICE KEEPS ITS OWN "ALREADY PLAYING" (a reload, a cleared
// cache): Everywhere chosen at 14:13, Downstairs started at 16:11 -- it was
// followed before the reload and still is after; music that was playing
// before 14:13 was not, and still is not. (The Master Bedroom tablet,
// 2026-10-11: "Ready on Everywhere" and two cards over the art.)
M._reset();
saved.cb({ value: { key: EVERY, at: Date.parse('2026-09-22T14:13:00Z') } });
var later = { 'media_player.office_homepod_ma': { since: '2026-09-22T16:11:00Z' } };
r = M.resolve(house(later));
ok('restored: music started after the choice is still followed', r.player + ':' + r.reason, e('office') + ':following');
M._reset();
saved.cb({ value: { key: EVERY, at: Date.parse('2026-09-22T14:13:00Z') } });
var before = { 'media_player.office_homepod_ma': { since: '2026-09-22T13:00:00Z' } };
r = M.resolve(house(before));
ok('restored: music playing before the choice still does not pull it', r.player + ':' + r.reason, EVERY + ':idle');
M._reset();
M.setFocus(EVERY);
r = M.resolve(house({ 'media_player.office_homepod_ma': { since: new Date(Date.now() + 5000).toISOString() } }));
ok('chosen here: whatever plays at the tap is "already", a clock off by seconds or not', r.reason, 'idle');

print('\n=== the configuration arrives from the integration ===');
var cfgSub = sub('hk_music/subscribe')[0];
var seen = 0; M.onChange(function () { seen++; });
cfgSub.cb(Object.assign({}, HK_HOUSE, {
  speakers: HK_HOUSE.speakers.concat([{ name: 'Garage', entity: 'media_player.garage_homepod_ma' }]) }));
ok('a new speaker is known at once', M.known('media_player.garage_homepod_ma'), true);
ok('  ...and every card is told', seen > 0, true);
cfgSub.cb({ configured: false });
ok('an unconfigured house knows no speakers', M.speakers().length, 0);
M._configure(HK_HOUSE);

print('\n=== commands name their player ===');
// The player drawn is the player sent: nothing is left for a script to read
// from a selector when the call arrives.
var NP = customElements.get('hk-now-playing-card');
var np = Object.create(NP.prototype);
np._config = { music: true };
np._hass = house(group([e('office'), e('loft')]));
M._reset(); M.setFocus(e('loft'));
var called = [];
np._call = function (d, s, data) { called.push([d + '.' + s, data]); return Promise.resolve(true); };
np._svc('play_pause');
ok('play/pause carries the player on screen -- the group leader',
   called.length + ':' + called[0][0] + ':' + called[0][1].player + ':' + called[0][1].command,
   '1:hk_frontend.music_transport:' + e('office') + ':play_pause');
M._reset();
np._hass = house({});
location.pathname = '/dashboard-phone/0';
called = [];
np._svc('next');
ok('no player on screen -> no call at all', called.length, 0);

print('\n=== the screensaver and the Speakers chip read the same speakers ===');
M._reset(); M._configure(HK_HOUSE);
var SS = customElements.get('hk-screensaver-now-card');
var ss = Object.create(SS.prototype);
ss._config = { music: true };
ok('the screensaver watches the integration\'s speakers, presets first',
   ss._players().join(), HK_HOUSE.speakers.map(function (s) { return s.entity; }).join());
ss._hass = house(merge(group([e('office'), e('loft')], { title: 'Song' })));
ok('  ...and finds what is playing', ss._playing() && ss._playing().entity_id, e('office'));
var CH = customElements.get('hk-status-chip-card');
var chip = new CH();
chip.setConfig({ name: 'Speakers', icon: 'hk:speaker', count: { music: true, match: 'playing' },
                 format: '{v} Playing', zero: 'None Playing' });
chip.hass = house(merge(group([e('office'), e('loft')]),
                        { 'media_player.downstairs_homepods_downstairs': {} }));
var sigA = chip._sigOf();
ok('the chip\'s signature covers every configured room',
   HK_ROOMS.every(function (r) { return sigA.indexOf(r) >= 0; }), true);
ok('  ...but not a sync group, which would count its rooms twice',
   sigA.indexOf('homepods_downstairs') < 0, true);
// labelFor is the chip's own label function, the one its render calls.
ok('the chip counts each PLAYING ROOM once',
   window.hkCards.labelFor(chip, chip._config, null), '2 Playing');

print('\n=== no music card reads a speaker selector ===');
['hk-media.js', 'hk-library.js', 'hk-popup.js', 'hk-control.js'].forEach(function (f) {
  var src = readFile(HK_ROOT + '/frontend/cards/' + f);
  var code = src.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
  ok(f + ' never names the input_select in code',
     /input_select\.media_player_selection/.test(code), false);
});

print('\n=== announcements are display-only and opt-out ===');
M._configure(Object.assign({}, HK_HOUSE, { ignore_announcements: true, announcements: [e('office')] }));
var ah = house({ [e('office')]: { title: 'com.apple.tvairplayd' }, [e('loft')]: { title: 'Real song' } });
ok('announcement excluded while other room stays visible', M.contexts(ah).map(function (c) { return c.key; }).join(','), e('loft'));
ok('fallback player cannot expose the announcement', M.ignored(ah.states[e('office')]), true);
M._configure(Object.assign({}, HK_HOUSE, { ignore_announcements: true }));
ah.states[e('office')].attributes.media_duration = 2;
ok('short AirPlay music with generic metadata is not guessed away', M.contexts(ah).length, 2);
ah.states[e('office')].attributes.media_content_id = 'media-source://tts/tts.piper?message=hello';
ok('explicit TTS content is recognized', M.contexts(ah).length, 1);
ah.states[e('office')].attributes.media_content_id = 'http://ha:8123/api/tts_proxy/abc.wav';
ok('resolved HA TTS URL is recognized', M.ignored(ah.states[e('office')]), true);
M._configure(Object.assign({}, HK_HOUSE, { ignore_announcements: false, announcements: [e('office')] }));
ok('toggle off restores original display behavior', M.contexts(ah).length, 2);
M._configure(Object.assign({}, HK_HOUSE, { ignore_announcements: true, announcements: [e('office')] }));
var gh = house(group([e('office'), e('loft')], { title: 'Music' }));
ok('suppressed group leader is not reintroduced via member', M.contexts(gh)[0].key, e('loft'));
M._configure(HK_HOUSE);

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' MUSIC MODEL TESTS PASS'));
