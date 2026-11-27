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
// A PRESET IS ITS ROOMS (2026-11-01): no Music Assistant group plays it, so
// its rooms joined are a group keyed on their leader, named by the preset.
cx = M.contexts(house(group(DOWN)));
ok('a preset\'s rooms joined are one group, keyed on its leader',
   cx.length + ':' + cx[0].kind + ':' + cx[0].key, '1:group:' + e('kitchen'));
ok('  ...named as the preset', M.label(cx[0]) + ':' + cx[0].preset, 'Downstairs:Downstairs');
var syncOn = merge(group(DOWN), { 'media_player.downstairs_homepods_downstairs': { gm: null, title: 'C' } });
ok('  ...and a Music Assistant group playing is never a context of its own',
   M.contexts(house(syncOn)).map(function (c) { return c.kind + ':' + c.key; }).join(','), 'group:' + e('kitchen'));
cx = M.contexts(house(group(DOWN.slice(0, 3))));
ok('rooms that are not exactly a preset\'s are not named by it', String(cx[0].preset) + ':' + M.label(cx[0]), 'undefined:Kitchen +2');
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
// As in Home Assistant, the host's callWS is the connection's sendMessagePromise.
function hassOn(c) { return { connection: c, callWS: function (m) { return c.sendMessagePromise(m); } }; }
M.attach(hassOn(conn));
M.attach(hassOn(conn));
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
hkGive(np, house(group([e('office'), e('loft')])));
M._reset(); M.setFocus(e('loft'));
var called = [];
np._call = function (d, s, data) { called.push([d + '.' + s, data]); return Promise.resolve(true); };
np._svc('play_pause');
ok('play/pause carries the player on screen -- the group leader',
   called.length + ':' + called[0][0] + ':' + called[0][1].player + ':' + called[0][1].command,
   '1:hk_frontend.music_transport:' + e('office') + ':play_pause');
M._reset();
hkGive(np, house({}));
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
hkGive(ss, house(merge(group([e('office'), e('loft')], { title: 'Song' }))));
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
var lh = house({ [e('office')]: { title: 'com.apple.tvairplayd', state: 'paused' }, [e('loft')]: { title: 'Real song' } });
ok('a paused, untitled AirPlay receiver session is a leftover, not music', M.active(lh.states[e('office')]), false);
ok('the leftover drops out of the contexts', M.contexts(lh).map(function (c) { return c.key; }).join(','), e('loft'));
lh.states[e('office')].state = 'playing';
ok('the same session playing is AirPlay music and stays', M.active(lh.states[e('office')]), true);
ah.states[e('office')].attributes.media_content_id = 'media-source://tts/tts.piper?message=hello';
ok('explicit TTS content is recognized', M.contexts(ah).length, 1);
ah.states[e('office')].attributes.media_content_id = 'http://ha:8123/api/tts_proxy/abc.wav';
ok('resolved HA TTS URL is recognized', M.ignored(ah.states[e('office')]), true);
M._configure(Object.assign({}, HK_HOUSE, { ignore_announcements: false, announcements: [e('office')] }));
ok('toggle off restores original display behavior', M.contexts(ah).length, 2);
M._configure(Object.assign({}, HK_HOUSE, { ignore_announcements: true, announcements: [e('office')] }));
var gh = house(group([e('office'), e('loft')], { title: 'Music' }));
ok('suppressed group leader is not reintroduced via member', M.contexts(gh)[0].key, e('loft'));
M._configure(Object.assign({}, HK_HOUSE, { ignore_announcements: false, intercom: [e('office')] }));
ok('an Intercom message stays out whatever the setting says', M.ignored(ah.states[e('office')]), true);
ok('an Intercom message leaves the other room on the player', M.contexts(ah).map(function (c) { return c.key; }).join(','), e('loft'));
M._configure(HK_HOUSE);

print('\n=== music stopped after a pause reads as paused (hk_core/music/resume.py) ===');
var held = { 'media_player.office_homepod_ma': { state: 'idle', gm: [e('office'), e('loft')], title: 'G' },
             'media_player.loft_homepod_ma': { state: 'idle', gm: [e('office'), e('loft')] } };
ok('an idle group is no music', M.contexts(house(held)).length, 0);
M._configure(Object.assign({}, HK_HOUSE, { resumable: [e('office'), e('loft')] }));
cx = M.contexts(house(held));
ok('the integration\'s resumable players are paused music', cx.map(function (c) {
  return c.kind + ':' + c.key + ':' + c.state + ':' + c.playing + ':' + c.members.length; }).join(','),
   'group:' + e('office') + ':paused:false:2');
M._configure(HK_HOUSE);

print('\n=== a sync group playing on its own rooms\' players is nothing to the screens ===');
var everyOn = { 'media_player.homepods_2': { gm: null, title: 'F' } };
ok('a Music Assistant group whose rooms are idle claims nothing', M.contexts(house(everyOn)).length, 0);

print('\n=== a virtual pair is one room (docs/phase4/VIRTUAL-PAIRS.md) ===');
// The Office's two HomePods made one room in Mantel: the right one is no speaker of its own
var OR = 'media_player.office_right_homepod_ma';
M._configure(Object.assign({}, HK_HOUSE, { speakers: HK_HOUSE.speakers.map(function (s) {
  return s.entity === e('office') ? Object.assign({}, s, { parts: [e('office'), OR] }) : s; }) }));
ok('its second player folds into the room', M.fold([e('kitchen'), OR, e('office')]).join(','), [e('kitchen'), e('office')].join(','));
ok('  ...and is no speaker', M.known(OR), false);
var pairOn = group([e('office'), OR], { title: 'P' });
cx = M.contexts(house(pairOn));
ok('the pair joined is ONE room, not a group', cx.length + ':' + cx[0].kind + ':' + cx[0].key, '1:room:' + e('office'));
ok('  ...named as the room', M.label(cx[0]), 'Office');
cx = M.contexts(house(group([e('kitchen'), OR, e('office')], { title: 'Q' })));
ok('with the Kitchen: two rooms', cx[0].members.join(','), [e('kitchen'), e('office')].join(','));
ok('  ...named as two', M.label(cx[0]), 'Kitchen + Office');
cx = M.contexts(house(group([OR, e('office'), e('loft')], { title: 'R' })));
ok('its second player leading: still the room, first', cx[0].members.join(','), [e('office'), e('loft')].join(','));
M._configure(HK_HOUSE);

print('\n=== who leads a pick (hk_core MusicConfig.leader_of) ===');
// 2026-11-02: eleven HomePods were joined under the first, A to Z, and the
// announcements Home Assistant sends that room played in every room
var pick = [e('loft'), e('office'), e('kitchen')];
ok('nothing set: the first room', M.leader(pick), e('loft'));
M._configure(Object.assign({}, HK_HOUSE, { announce_rooms: [e('loft')] }));
ok('an announcement room first: the next room', M.leader(pick), e('office'));
ok('  ...alone, it plays where it is', M.leader([e('loft')]), e('loft'));
M._configure(Object.assign({}, HK_HOUSE, { leaders: [e('living_room'), e('kitchen')], announce_rooms: [e('loft')] }));
ok('the house\'s leaders, best first, wherever they are in the pick', M.leader(pick), e('kitchen'));
ok('  ...the best of them picked', M.leader(pick.concat(e('living_room'))), e('living_room'));
ok('none picked: an empty answer', M.leader([]), null);
M._configure(HK_HOUSE);

print('\n=== a request the link answered "still going" (2026-11-26, hk_core/music/requests.py) ===');
// From a Home Assistant screen a slow music request comes back {ok, pending, request}. That is "not yet": settle() holds it
// until the music feed carries the outcome, so the screen shows "Starting..." and then how it went, a step chained after it
// never goes before the item plays, and a newer request for the same rooms takes the older one's answer from the screen.
var settled = {};
function track(label, p) { p.then(function (r) { settled[label] = r; }); return p; }
function feed(requests) { M._configure(Object.assign({}, HK_HOUSE, { requests: requests })); }
function answer(response) { return Promise.resolve({ context: { id: 'x' }, response: response }); }
M._reset(); M._configure(HK_HOUSE);
var pendingPlay = track('play', M.settle('music_play_media', { player: e('kitchen') }, answer({ ok: true, pending: true, request: 'rq1', message: 'Still starting the music.' })));
drain();
ok('a pending answer is still pending: nothing is settled, not "played"', settled.play, undefined);
feed({ rq1: { ok: true, leader: e('kitchen') } });
drain();
ok('...until its outcome arrives on the feed: then the outcome is the answer', JSON.stringify(settled.play.response), JSON.stringify({ ok: true, leader: e('kitchen') }));
ok('  ...not stale', settled.play.stale, undefined);

M._reset(); M._configure(HK_HOUSE); settled = {};
track('fail', M.settle('music_play', { rooms: [e('kitchen'), e('office')], playlist: 'k' }, answer({ ok: true, pending: true, request: 'rq2' })));
drain();
feed({ rq2: { ok: false, message: 'Kitchen did not start.' } });
drain();
ok('a failure arrives with its words', settled.fail.response.ok + ':' + settled.fail.response.message, 'false:Kitchen did not start.');
M._configure(HK_HOUSE);

// an outcome already on the feed (a page that reconnected, or a fast one): answered at once
settled = {};
feed({ rq3: { ok: true } });
track('early', M.settle('music_stop', { rooms: [e('kitchen')] }, answer({ ok: true, pending: true, request: 'rq3' })));
drain();
ok('an outcome the feed already holds settles it at once', settled.early.response.ok, true);
M._configure(HK_HOUSE);

// an older Mantel's pending answer has no request id: said in words, never "it played"
settled = {};
track('noid', M.settle('music_play', { rooms: [e('kitchen')], playlist: 'k' }, answer({ ok: true, pending: true })));
drain();
ok('no request id: not confirmed, in words, as a failure', settled.noid.response.ok + ':' + /not been confirmed/.test(settled.noid.response.message), 'false:true');

// an answer that is not pending is handed back as it came (Mantel's own page, Home Assistant's own engine)
settled = {};
track('plain', M.settle('music_play', { rooms: [e('kitchen')], playlist: 'k' }, answer({ ok: true, leader: e('kitchen') })));
drain();
ok('a plain answer is the same', settled.plain.response.leader + ':' + settled.plain.stale, e('kitchen') + ':undefined');
var other = Promise.resolve({ response: {} });
ok('a request that takes no room (a volume change) is not touched', M.settle('music_transport', { player: e('kitchen'), command: 'volume_set' }, other), other);

// A NEWER REQUEST FOR THE SAME ROOMS takes the older one's answer from the screen
settled = {};
track('old', M.settle('music_play', { rooms: [e('kitchen'), e('office')], playlist: 'k' }, answer({ ok: true, pending: true, request: 'rq4' })));
drain();
track('newer', M.settle('music_transport', { player: e('office'), command: 'play_pause' }, answer({ ok: true })));
track('elsewhere', M.settle('music_play', { rooms: [e('loft')], playlist: 'k' }, answer({ ok: true, leader: e('loft') })));
feed({ rq4: { ok: false, message: 'Late failure.' } });
drain();
ok('a pause on one of its rooms supersedes the older play: its late failure is stale, not shown', settled.old.stale + ':' + settled.old.response.superseded, 'true:true');
ok('...the newer one is the screen\'s', settled.newer.stale, undefined);
ok('...another room\'s request is nobody\'s business', settled.elsewhere.stale, undefined);
M._configure(HK_HOUSE);
settled = {};
track('volume', M.settle('music_play', { rooms: [e('kitchen')], playlist: 'k' }, answer({ ok: true })));
M.settle('music_transport', { player: e('kitchen'), command: 'volume_up' }, answer({ ok: true }));
drain();
ok('a volume change supersedes nothing', settled.volume.stale, undefined);
// the engine's own word (another screen's request took over): stale too
settled = {};
track('engine', M.settle('music_play', { rooms: [e('kitchen')], playlist: 'k' }, answer({ ok: true, leader: e('kitchen'), superseded: true })));
drain();
ok('an answer the engine says a newer request superseded is stale', settled.engine.stale, true);

// A LIBRARY PICK ON SEVERAL ROOMS is ONE request that claims every room of the pick (2026-11-26, hk_core/music/engine.py pick_claims):
// the other screens' newer requests are the engine's to tell apart; this page's own are told apart by the room the item plays on
M._reset(); M._configure(HK_HOUSE); settled = {};
var PICK = { player: e('kitchen'), rooms: [e('kitchen'), e('office')], media_content_id: 'x://1', media_content_type: 'music' };
track('pick', M.settle('music_play_media', PICK, answer({ ok: true, leader: e('kitchen'), left: [e('office')], message: 'Office was changed since.' })));
M.claim('music_stop', { rooms: [e('office')] });                      // this page stops the Office meanwhile
drain();
ok('a Stop of this page\'s for another room of the pick: the pick still answers, with what it left',
   settled.pick.stale + ':' + JSON.stringify(settled.pick.response.left), 'undefined:' + JSON.stringify([e('office')]));
settled = {};
track('pick2', M.settle('music_play_media', PICK, answer({ ok: true, leader: e('kitchen') })));
M.claim('music_stop', { rooms: [e('kitchen')] });
drain();
ok('...a Stop for the room it plays on ends it for this page', settled.pick2.stale, true);
settled = {};
track('pick3', M.settle('music_play_media', PICK, answer({ ok: true, pending: true, request: 'rq7' })));
drain();
feed({ rq7: { ok: true, leader: e('kitchen'), left: [e('office')], message: 'Office was changed since.' } });
drain();
ok('a pending pick settles with the engine\'s own outcome: where it played, what it left, why',
   JSON.stringify([settled.pick3.response.leader, settled.pick3.response.left, settled.pick3.response.message]),
   JSON.stringify([e('kitchen'), [e('office')], 'Office was changed since.']));
M._configure(HK_HOUSE);
ok('its words: where it played, then why not there', M.pickSaid('Song', PICK.rooms, { left: [e('office')], message: 'Office was changed since' },
   function (list) { return list.map(function (x) { return M.nameOf(x); }).join(' + '); }), 'Playing Song on ' + M.nameOf(e('kitchen')) + '. Office was changed since.');
ok('...all of it when nothing was left', M.pickSaid('Song', PICK.rooms, { ok: true }, function (list) { return list.length + ' rooms'; }), 'Playing Song on 2 rooms');

// the speaker picker and the music page ask through _callResp: pending is settled there, and a stale one is flagged
(function () {
  var Card = customElements.get('hk-now-playing-card'), c = Object.create(Card.prototype);
  c._actions = function () { return { callService: function () { return answer({ ok: true, pending: true, request: 'rq9' }); } }; };
  var got;
  c._callResp('hk_frontend', 'music_play_media', { player: e('den'), media_content_id: 'x://1', media_content_type: 'music' }).then(function (r) { got = r; });
  drain();
  ok('_callResp: a pending answer is not an answer yet', got, undefined);
  feed({ rq9: { ok: false, message: 'It did not start on Den.' } });
  drain();
  ok('...it answers with the real outcome, so a step chained after it never goes before the item plays',
     got && got.ok + ':' + got.response.ok + ':' + got.response.message, 'true:false:It did not start on Den.');
  M._configure(HK_HOUSE);
})();

// THE SESSION IS THE SENDER'S, NEVER THE SONG'S: two HomeViews each playing one song in their own app, the id the same on
// every stream, fold nothing; one sender is a session
(function () {
  function st(sid, n, app) {
    return { entity_id: '', state: 'playing', last_changed: '2026-09-22T10:00:00Z', attributes: { group_members: [], media_title: 'Same Song', media_artist: 'Band',
      app_id: app, media_content_id: 'apple-device://ap000' + n + '/' + sid + '::STREAM' } };
  }
  var h = house({}), HV = 'com.apple.sonic.music', RX = 'com.apple.TVAirPlay';
  [[e('kitchen'), 1, HV], [e('office'), 2, HV], [e('loft'), 3, RX], [e('kids_room'), 4, RX]].forEach(function (x) { h.states[x[0]] = st('snSame', x[1], x[2]); h.states[x[0]].entity_id = x[0]; });
  var cx = M.contexts(h);
  ok('two speakers sending one id: four players, no session', cx.length + ':' + cx.every(function (c) { return !c.airplay && c.members.length === 1; }), '4:true');
  ok('...so a receiver\'s rooms (hkMusic.together) are its own', M.together(h, h.states[e('loft')]).length, 0);
  h.states[e('office')].state = 'idle';
  cx = M.contexts(h);
  ok('one sender left: its session again', cx.length + ':' + cx[0].airplay + ':' + cx[0].members.length, '1:true:3');
})();

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' MUSIC MODEL TESTS PASS'));
