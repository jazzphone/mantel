// THE SAME MUSIC IN MANY ROOMS THAT ARE NOT JOINED (2026-10-14): an iPhone
// AirPlaying Apple Music to every HomePod at once is nine players to Music
// Assistant (no group_members, no sync group). hkMusic.contexts() stays one
// context per player -- each is its own COMMAND target -- and
// hkMusic.streams() bundles them for drawing; the Music page draws one card
// per stream and caps its house list so the player keeps its room.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/tests/music_house.js');
load(HK_ROOT + '/frontend/cards/hk-music.js');

var ok = H.ok, eq = H.eq;
var M = window.hkMusic;
function e(k) { return 'media_player.' + k + '_homepod_ma'; }
var NOW = Date.parse('2026-10-14T18:00:00Z');
var AT = '2026-10-14T17:59:50Z';            // ten seconds before NOW

// a room playing on its own, as Music Assistant reports an AirPlay sender
function airplay(title, extra) {
  return Object.assign({ state: 'playing', last_changed: '2026-10-14T17:58:00Z', attributes: Object.assign({
    media_title: title, media_artist: 'BTS', app_id: 'com.apple.tvairplayd', source: 'com.apple.Music',
    group_members: [], media_position: 70, media_position_updated_at: AT
  }, extra || {}) });
}
function hassOf(map) {
  var states = {};
  HK_ROOMS.forEach(function (r) { states[r] = { state: 'idle', attributes: {} }; });
  Object.keys(map).forEach(function (k) { var s = map[k]; s.entity_id = k; states[k] = s; });
  return { states: states };
}
function keys(s) { return s.ctxs.map(function (c) { return c.key; }); }

// ------------------------------------------------------------ the model
(function () {
  var all = {};
  HK_ROOMS.forEach(function (r) { all[r] = airplay('Dynamite'); });
  var h = hassOf(all);
  var cs = M.contexts(h);
  eq('nine rooms AirPlayed to at once: still nine contexts (each its own player)', cs.length, 9);
  var ss = M.streams(cs, NOW);
  eq('...and ONE stream', ss.length, 1);
  eq('...holding every room', ss[0].members.length, 9);
  eq('...keyed by its first context', ss[0].key, cs[0].key);
  eq('...the song', ss[0].title, 'Dynamite');
  ok('...every context still there, in order', JSON.stringify(keys(ss[0])) === JSON.stringify(cs.map(function (c) { return c.key; })));
  ok('contexts carry where the music comes from and how far in',
     cs[0].app === 'com.apple.tvairplayd' && cs[0].pos === 70 && cs[0].posAt === Date.parse(AT), cs[0]);
})();

(function () {
  // two different songs, and one room a song apart from the rest
  var h = hassOf({});
  h.states[e('kitchen')] = airplay('Dynamite');
  h.states[e('living_room')] = airplay('Dynamite');
  h.states[e('office')] = airplay('Butter');
  h.states[e('loft')] = airplay('Dynamite', { media_artist: 'Someone Else' });
  var ss = M.streams(M.contexts(h), NOW);
  eq('a different song, or the same title by another artist, is its own stream', ss.length, 3);
  ok('...the two Dynamite rooms together', JSON.stringify(ss[0].members) === JSON.stringify([e('kitchen'), e('living_room')]), ss[0].members);

  h = hassOf({});
  h.states[e('kitchen')] = airplay('Dynamite');
  h.states[e('office')] = airplay('Dynamite', { app_id: 'music_assistant', source: '' });
  eq('the same song from another source (Music Assistant\'s own queue) is not merged', M.streams(M.contexts(h), NOW).length, 2);

  h = hassOf({});
  h.states[e('kitchen')] = airplay('Dynamite');
  h.states[e('office')] = airplay('Dynamite', { media_position: 140 });
  eq('the same song a minute apart: two streams', M.streams(M.contexts(h), NOW).length, 2);

  h = hassOf({});
  h.states[e('kitchen')] = airplay('Dynamite');
  // reported later, so its position is the same moment of the song
  h.states[e('office')] = airplay('Dynamite', { media_position: 75, media_position_updated_at: '2026-10-14T17:59:55Z' });
  eq('...positions compared at the same moment (reported 5 s apart)', M.streams(M.contexts(h), NOW).length, 1);

  h = hassOf({});
  h.states[e('kitchen')] = airplay('Dynamite');
  h.states[e('office')] = airplay('Dynamite', { media_position: undefined, media_position_updated_at: undefined });
  eq('...a room that does not say how far in matches on the song alone', M.streams(M.contexts(h), NOW).length, 1);

  h = hassOf({});
  h.states[e('kitchen')] = airplay('Dynamite');
  h.states[e('office')] = Object.assign(airplay('Dynamite'), { state: 'paused' });
  eq('a paused room is not merged with a playing one', M.streams(M.contexts(h), NOW).length, 2);

  h = hassOf({});
  h.states[e('kitchen')] = airplay('');
  h.states[e('office')] = airplay('');
  eq('rooms with no title are never merged (nothing says they are the same)', M.streams(M.contexts(h), NOW).length, 2);

  // a real MA group stays the one context it was, and joins a matching room
  var g = [e('kitchen'), e('living_room')];
  h = hassOf({});
  h.states[e('kitchen')] = airplay('Dynamite', { group_members: g });
  h.states[e('living_room')] = airplay('Dynamite', { group_members: g });
  h.states[e('office')] = airplay('Dynamite');
  var cs = M.contexts(h), ss = M.streams(cs, NOW);
  eq('an MA group is still one context', cs.length, 2);
  ok('...and with a room playing the same, one stream of three rooms', ss.length === 1 && ss[0].members.length === 3, ss);
  eq('no contexts, no streams', M.streams([], NOW).length, 0);
})();

// ------------------------------------------------------------ the page
// _drawHouse on a stand-in page: the shim's elements, with the little it
// needs that dom.js has not got
if (!El.prototype.insertAdjacentHTML) El.prototype.insertAdjacentHTML = function (where, html) {
  var x = new El('span'); x._html = html; this.appendChild(x);
};
var Card = customElements.get('hk-music-card');
function page(h, mine) {
  var p = Object.create(Card.prototype);
  var house = document.createElement('div');
  hkGive(p, h); p._e = { house: house };
  p._M = function () { return M; };
  p._targetRooms = function () { return [e('kitchen')]; };
  p._artImage = function () {};
  p._fits = 0; p._houseFit = function () { this._fits++; };
  p._houseSig = null;
  var c = mine ? M.contexts(h).filter(function (x) { return x.key === mine; })[0] : null;
  p._drawHouse(c);
  return p;
}
function cards(p) { return p._e.house.children.filter(function (x) { return /\bcx\b/.test(x.className); }); }
// (the song, before " — Artist": the row says both since 2026-11-12)
function title(cx) { return cx.children[1].children[0].textContent.split(' — ')[0]; }
// (the rooms' line: a speaker glyph, then the rooms -- the span that says them, 2026-11-12)
function rooms(cx) { return cx.children[1].children[1].children.filter(function (x) { return x.getAttribute && x.getAttribute('data-fit') != null; })[0].getAttribute('data-fit').split(','); }

(function () {
  var all = {};
  HK_ROOMS.forEach(function (r) { all[r] = airplay('Dynamite'); });
  var h = hassOf(all);
  var p = page(h, e('kitchen'));
  var cx = cards(p);
  eq('the Kitchen tablet, nine rooms on one AirPlay: ONE house card', cx.length, 1);
  eq('...the song', title(cx[0]), 'Dynamite');
  eq('...every room on its line (fitted to "Kitchen, Living Room and 7 more")', rooms(cx[0]).length, 9);
  ok('...lit: it is this page\'s music', /\bon\b/.test(cx[0].className) && !cx[0].getAttribute('data-ctx'));
  ok('...its height fitted', p._fits >= 1);

  // the page shows something else: the AirPlay card hands it ONE player
  h.states[e('loft')] = airplay('Butter', { app_id: 'music_assistant', source: '' });
  p = page(h, e('loft'));
  cx = cards(p);
  eq('another song on this page: a card each, not ten', cx.length, 2);
  var dyn = cx.filter(function (x) { return title(x) === 'Dynamite'; })[0];
  eq('...the Dynamite card switches to one explicit player (the first)', dyn.getAttribute('data-ctx'), e('kitchen'));

  // ...this tablet's own room first, when it is one of them
  var was = HK_HOUSE.home;
  HK_HOUSE.home = e('office'); M._configure(HK_HOUSE);
  p = page(h, e('loft'));
  dyn = cards(p).filter(function (x) { return title(x) === 'Dynamite'; })[0];
  eq('...or this tablet\'s own room when it plays it', dyn.getAttribute('data-ctx'), e('office'));
  HK_HOUSE.home = was; M._configure(HK_HOUSE);

  // one room, this page's: no list (as before)
  p = page(hassOf((function () { var o = {}; o[e('kitchen')] = airplay('Dynamite'); return o; })()), e('kitchen'));
  eq('one room playing, this page\'s: no house list', p._e.house.children.length, 0);
  // two independent rooms with the same song: the list says so
  p = page(hassOf((function () { var o = {}; o[e('kitchen')] = airplay('Dynamite'); o[e('office')] = airplay('Dynamite'); return o; })()), e('kitchen'));
  eq('this page\'s song in a room its buttons do not reach: one card, both rooms', cards(p).length === 1 && rooms(cards(p)[0]).length, 2);
})();

// ONE AIRPLAY SESSION (2026-11-20, hk_core/music/airplay.py): a HomeView AirPlaying to every HomePod. Each stream names
// Receivers advertise the same AirPlay group, so its rooms share an AirPlay context.
(function () {
  var HV = { app_id: 'com.apple.sonic.music', source: 'Music' };
  function sess(k, sid, extra) { return airplay('Santa Tell Me', Object.assign({ airplay_group_id: sid, media_content_id: 'apple-device://ap-' + k + '/' + sid + '::STREAM' }, extra || {})); }
  var all = {};
  HK_ROOMS.forEach(function (r, i) { all[r] = i === 4 ? sess(i, 'snHomeView', HV) : sess(i, 'snHomeView'); });
  var h = hassOf(all);
  var cs = M.contexts(h);
  eq('eight rooms of one AirPlay session: one context', cs.length, 1);
  ok('...a group of every room, marked airplay', cs[0].kind === 'group' && cs[0].members.length === HK_ROOMS.length && cs[0].airplay === true, cs[0]);
  ok('...named as a group is ("Kitchen +8")', /\+/.test(M.label(cs[0])), M.label(cs[0]));
  eq('...never a preset, though its rooms are Everywhere\'s', cs[0].preset, undefined);
  eq('...and the page\'s own music: no house list', page(h, cs[0].key)._e.house.children.length, 0);
  eq('...the player line\'s rooms (hkMusic.together): every room of the session', M.together(h, h.states[HK_ROOMS[3]]).length, HK_ROOMS.length);
  // a room paused or idle in the session is a room of it while paused, not when idle; another session is its own
  h = hassOf({});
  h.states[e('kitchen')] = sess('kitchen', 'snA', HV);
  h.states[e('office')] = sess('office', 'snA', { media_title: 'Something Else' });
  h.states[e('loft')] = Object.assign(sess('loft', 'snA'), { state: 'idle' });
  h.states[e('living_room')] = sess('living_room', 'snB');
  cs = M.contexts(h);
  ok('the session decides, not the title; an idle room is not in it; another session is its own',
     cs.length === 2 && JSON.stringify(cs[0].members) === JSON.stringify([e('kitchen'), e('office')]) && cs[1].members.length === 1 && !cs[1].airplay, cs);
  // a real Music Assistant group is never folded into a session
  var g = [e('kitchen'), e('living_room')];
  h = hassOf({});
  h.states[e('kitchen')] = airplay('Dynamite', { group_members: g });
  h.states[e('living_room')] = airplay('Dynamite', { group_members: g });
  cs = M.contexts(h);
  ok('an MA group: no airplay mark', cs.length === 1 && !cs[0].airplay, cs);
})();

// (2026-11-26, Codex's review) AN ID ON RECEIVERS ALONE IS NO SESSION: two independent iPhones appear only as receivers, and
// two ids that match (a non-hash item id) tell nothing of one device sending both. No room of the house sends it, so no room
// is folded under it: each is its own context, a button sends to the one player asked, and only the DRAWING (one stream card,
// no button of its own) and the words ("AirPlay", the source line) are the song's
(function () {
  function rx(k, sid, extra) { return airplay('Same Song', Object.assign({ media_content_id: 'apple-device://ap-' + k + '/' + sid + '::STREAM' }, extra || {})); }
  var h = hassOf({});
  function put(k, st) { st.entity_id = e(k); h.states[e(k)] = st; }
  put('kitchen', rx('kitchen', 'snItem'));
  put('office', rx('office', 'snItem'));
  put('loft', rx('loft', 'snItem'));
  var cs = M.contexts(h);
  eq('receivers alone with one id: one context each, none marked airplay', cs.map(function (c) { return c.members.length + ':' + !!c.airplay; }).join(), '1:false,1:false,1:false');
  eq('...the player line\'s rooms (hkMusic.together): the one asked', M.together(h, h.states[e('office')]), []);
  eq('...still ONE stream to draw (the song, the source, how far in)', M.streams(cs, NOW).length, 1);
  eq('...and where it comes from is as it was: AirPlay from a device that is no speaker', cs[0].from, 'AirPlay');
  var cx = cards(page(h, e('living_room')));
  var card = cx.filter(function (x) { return title(x) === 'Same Song'; })[0];
  ok('...one card, every room, no play / pause of its own (it would pause one device and read as pausing all)',
     rooms(card).length === 3 && !card.children.filter(function (c) { return /\bpp\b/.test(c.className); })[0]);
  put('living_room', rx('living_room', 'snItem', { app_id: 'com.apple.sonic.music', source: 'Music' }));
  eq('seeing one sender still proves nothing about the receivers', M.contexts(h).length, 4);
  h.states[e('living_room')].attributes.airplay_group_id = 'group-home';
  h.states[e('office')].attributes.airplay_group_id = 'GROUP-HOME';
  h.states[e('loft')].attributes.airplay_group_id = 'group-phone';
  cs = M.contexts(h);
  var home = cs.filter(function (c) { return c.key === e('living_room'); })[0];
  ok('the matching receivers fold under the sender', home.airplay && home.members.length === 2, home);
  eq('the unrelated receiver keeps its own source label', M.whereFrom(h.states, e('loft')), 'AirPlay');
  eq('the receiver with the same group names the sender', M.whereFrom(h.states, e('office')), 'AirPlay from ' + M.nameOf(e('living_room')));
})();

// _houseFit: what the column has left once the player has its room
(function () {
  var fit = Card.prototype._houseFit;
  // a list of n cards: its heading 27 px, then a card every 78 (72 and the 6 between: Apple's player rows, 2026-11-12)
  function col(o) {
    var house = { offsetTop: 100, children: { length: o.n, 1: { offsetTop: 127 } }, style: {} };
    Object.defineProperty(house, 'scrollHeight', { get: function () { return 27 + o.n * 78 - 6; } });
    return {
      _cols: o.cols, _houseKey: null,
      _e: { house: house, nx: { hidden: true }, art: { parentNode: { offsetHeight: o.art } },
            front: { scrollHeight: o.front }, left: { clientHeight: o.left }, pon: { offsetHeight: 50 },
            mu: { classList: { contains: function () { return !!o.idle; } } } }
    };
  }
  // the Kitchen tablet's column (measured): 600 high; the song and its
  // controls 260 under the cover. Room: 600 - (50 + 14) - 12 - (260 + 120) = 144; a taller column, 640: 184
  var p = col({ cols: 2, n: 2, art: 120, front: 380, left: 640 });
  fit.call(p, true);
  eq('two cards (177 px) in 184 px of room: all of them, nothing cut', p._e.house.style.maxHeight, '184px');
  p = col({ cols: 2, n: 9, art: 120, front: 380, left: 600 });
  fit.call(p, true);
  eq('nine cards: whole cards, then 24 px of the next (27 + 78 + 24)', p._e.house.style.maxHeight, '129px');
  p = col({ cols: 2, n: 9, art: 120, front: 380, left: 600, idle: true });
  fit.call(p, true);
  eq('...nothing playing here: no Playing on, so a card more (27 + 2 x 78 + 24)', p._e.house.style.maxHeight, '207px');
  p = col({ cols: 2, n: 9, art: 120, front: 380, left: 420 });
  fit.call(p, true);
  eq('...a short column: one card and the peek at the least', p._e.house.style.maxHeight, '129px');
  p = col({ cols: 1, n: 9, art: 120, front: 380, left: 600 });
  p._e.house.style.maxHeight = '50px';
  fit.call(p, true);
  eq('one column (a phone\'s sheet scrolls): no cap', p._e.house.style.maxHeight, '');
  p = col({ cols: 2, n: 9, art: 120, front: 380, left: 600 });
  fit.call(p, true);
  p._e.left.clientHeight = 900;
  fit.call(p);
  eq('...measured again only when asked to (a resize) or the list changes', p._e.house.style.maxHeight, '129px');
  fit.call(p, true);
  eq('...and then fitted to the new column (27 + 5 x 78 + 24)', p._e.house.style.maxHeight, '441px');
})();

// ------------------------------------------------------------ where it comes from (2026-11-25)
// A speaker playing its own app, the rooms it AirPlays to, AirPlay from an iPhone, and Music Assistant's own:
// hk_core/music/airplay.py's where_from, the same words.
(function () {
  var h = hassOf({});
  h.states[e('living_room')] = airplay('Happy Xmas', { app_id: 'com.apple.sonic.music', source: 'Music',
    airplay_group_id: 'group-home', media_content_id: 'apple-device://ap0001/snHome::STREAM' });
  h.states[e('kitchen')] = airplay('Happy Xmas', { app_id: 'com.apple.TVAirPlay',
    airplay_group_id: 'group-home', media_content_id: 'apple-device://ap0002/snHome::STREAM' });
  h.states[e('office')] = airplay('Butter', { app_id: 'com.apple.TVAirPlay',
    media_content_id: 'apple-device://ap0003/snPhone::STREAM' });
  h.states[e('loft')] = airplay('Song', { app_id: 'music_assistant', source: '', media_content_id: 'apple_music://track/1' });
  var by = {};
  M.contexts(h).forEach(function (c) { c.members.forEach(function (m) { by[m] = c; }); });
  var lr = M.nameOf(e('living_room'));
  eq('its own app: "<app> on <speaker>"', by[e('living_room')].from, 'Music on ' + lr);
  ok('  ...and outside', by[e('living_room')].outside === true);
  eq('a room it sends to, the same session: one context with it', by[e('kitchen')], by[e('living_room')]);
  eq('...led by the speaker it comes from ("Living Room + 1", not the first room)', by[e('kitchen')].key, e('living_room'));
  eq('...first of its rooms', by[e('kitchen')].members[0], e('living_room'));
  eq('AirPlay from an iPhone', by[e('office')].from, 'AirPlay');
  ok('Music Assistant\'s own: no line, not outside', by[e('loft')].from === null && by[e('loft')].outside === false);
  eq('a receiver alone names its sender', M.whereFrom(h.states, e('kitchen')), 'AirPlay from ' + lr);
  // the sending speaker by its own name, not its room's (a room can have a HomePod and a HomeView)
  h.states[e('living_room')].attributes.friendly_name = 'Living Room HomeView';
  eq('...by its own name', M.whereFrom(h.states, e('kitchen')), 'AirPlay from Living Room HomeView');
  eq('...on its own line too', M.whereFrom(h.states, e('living_room')), 'Music on Living Room HomeView');
})();

// (2026-11-26) a stream named by pyatv's 64-hex hash of the song (no id from the sender) is no session: two devices
// playing the same song stay two things to command, drawn as one stream
(function () {
  var h = hassOf({}), hash = 'apple-device://ap0001/' + Array(17).join('ab12');
  h.states[e('kitchen')] = airplay('Same', { media_content_id: hash });
  h.states[e('office')] = airplay('Same', { media_content_id: hash.replace('ap0001', 'ap0002') });
  var cs = M.contexts(h);
  eq('a fallback hash folds nothing: two contexts', cs.length, 2);
  eq('...still one stream to draw', M.streams(cs, NOW).length, 1);
})();

// (2026-11-26) the same song in rooms that are no session is DRAWN as one card, but its buttons are no device's but one: a
// card of several players has no play / pause of its own (it would pause one device and read as pausing both), and a card
// of ONE thing playing -- a single room, or one AirPlay session whose sender named it -- has its button
(function () {
  var h = hassOf({}), hash = Array(17).join('cd34');
  h.states[e('kitchen')] = airplay('Same', { media_content_id: 'apple-device://ap0001/' + hash });
  h.states[e('office')] = airplay('Same', { media_content_id: 'apple-device://ap0002/' + hash });
  h.states[e('living_room')] = airplay('Solo', { app_id: 'music_assistant', source: '' });
  h.states[e('loft')] = airplay('Sent', { airplay_group_id: 'group-home', media_content_id: 'apple-device://ap0003/snHome::STREAM' });
  h.states[e('guest_bedroom')] = airplay('Sent', { airplay_group_id: 'group-home', media_content_id: 'apple-device://ap0004/snHome::STREAM',
                                                  app_id: 'com.apple.sonic.music', source: 'Music' });
  var cx = cards(page(h, e('living_room')));
  function button(x) { return x.children.filter(function (c) { return /\bpp\b/.test(c.className); })[0]; }
  var same = cx.filter(function (x) { return title(x) === 'Same'; })[0], sent = cx.filter(function (x) { return title(x) === 'Sent'; })[0];
  eq('two devices playing one song: one card, both rooms', rooms(same).length, 2);
  ok('...and no play / pause for the pair', !button(same));
  ok('...a tap on it still opens one player', !!same.getAttribute('data-ctx'));
  ok('one AirPlay session (the sender named it): one card with its button, for the session\'s leader',
     !!button(sent) && button(sent).getAttribute('data-ppk') === sent.getAttribute('data-ctx'));
  // the page being on one of them: the lit card has no list button either way
  eq('...the page\'s own card is not a button', cards(page(h, e('living_room'))).filter(function (x) { return /\bon\b/.test(x.className); }).length, 1);
})();

// (2026-11-26) A LIBRARY ITEM ON SEVERAL ROOMS IS ONE REQUEST FOR THE WHOLE PICK (Codex's review): the item plays on one
// player and the engine brings the others in once it plays -- claiming every room when the request starts, so a Stop, a
// play or a move another screen sends for one of them meanwhile keeps that room out. The screen sends no second request
// (a transfer of its own would be newer than that Stop), says "Starting..." until the answer, and then says where it played
// and what it left. A request from a Home Assistant screen can be answered "still going" (hkMusic.settle waits for its outcome)
(function () {
  function flush() { for (var i = 0; i < 6; i++) drainMicrotasks(); }
  function item() {
    var p = Object.create(Card.prototype), r = { calls: [], data: [], toasts: [], answers: [], page: p, focus: [] };
    p._M = function () { return M; };
    p._ctx = function () { return null; };
    p._rooms = function () { return [e('kitchen'), e('office')]; };
    p._nextSet = function () { return null; };
    p._roomsLabel = function (list) { return list.map(function (x) { return M.nameOf(x); }).join(' + '); };
    p._toast = function (m) { r.toasts.push(m); };
    p._refreshPlaylists = function () {};
    p._askThenPlay = function (rooms, go) { go(); };
    p._callResp = function (d, s, data) { r.calls.push(s); r.data.push(data); return new Promise(function (res) { r.answers.push(res); }); };
    p._playNode({ title: 'Song', media_content_id: 'x://1', media_content_type: 'music' });
    flush();
    return r;
  }
  var K = M.nameOf(e('kitchen')), O = M.nameOf(e('office'));
  var r = item();
  eq('ONE request: the item on one player, the whole pick in `rooms`, and said to be starting', r.calls.join() + '|' + r.toasts.join(),
     'music_play_media|Starting Song on ' + K + ' + ' + O + '\u2026');
  eq('...the player, and every room of the pick', JSON.stringify([r.data[0].player, r.data[0].rooms]),
     JSON.stringify([e('kitchen'), [e('kitchen'), e('office')]]));
  r.answers[0]({ ok: true, response: { ok: true, leader: e('kitchen') } });
  flush();
  eq('...the others are not asked to join by the screen: the engine did', r.calls.join(), 'music_play_media');
  eq('...and "Playing" when it has', r.toasts[r.toasts.length - 1], 'Playing Song on ' + K + ' + ' + O);
  r = item();
  r.answers[0]({ ok: true, response: { ok: true, leader: e('kitchen'), left: [e('office')], message: O + ' was changed since.' } });
  flush();
  eq('a room a newer request took is left and named: where it played, and why not there',
     r.toasts[r.toasts.length - 1], 'Playing Song on ' + K + '. ' + O + ' was changed since.');
  r = item();
  r.answers[0]({ ok: true, response: { ok: true, leader: e('kitchen'), left: [e('office')], message: 'The music did not move.' } });
  flush();
  eq('...or would not join', r.toasts[r.toasts.length - 1], 'Playing Song on ' + K + '. The music did not move.');
  r = item();
  r.answers[0]({ ok: true, response: { ok: false, message: 'It did not start on Kitchen.' } });
  flush();
  ok('an item that did not start says why, and plays nowhere',
     r.calls.join() === 'music_play_media' && r.toasts[r.toasts.length - 1] === 'Could not play Song: It did not start on Kitchen.', r.toasts);
  r = item();
  r.answers[0]({ ok: true, stale: true, response: { ok: true, superseded: true } });
  flush();
  ok('an item a newer request took over says nothing more', r.calls.join() === 'music_play_media' && r.toasts.length === 1, r.toasts);
  // a pending answer from a Home Assistant screen: the page waits for the engine's real outcome (the music feed), then says it
  var pend = M.settle('music_play_media', { player: e('kitchen'), rooms: [e('kitchen'), e('office')] },
                      Promise.resolve({ ok: true, response: { ok: true, pending: true, request: 'rq9' } }));
  var done = null; pend.then(function (v) { done = v; });
  flush();
  ok('...a "still going" answer is no answer yet', done === null);
  M._configure(Object.assign({}, HK_HOUSE, { requests: { rq9: { ok: true, leader: e('kitchen'), left: [e('office')], message: O + ' was changed since.' } } }));
  flush();
  eq('...the outcome that comes carries what the pick left', JSON.stringify([done.response.left, done.response.message]),
     JSON.stringify([[e('office')], O + ' was changed since.']));
  // a newer request of this page for the room the item plays on is the pick's end; for another room of it, it is not
  var tail = M.settle('music_play_media', { player: e('kitchen'), rooms: [e('kitchen'), e('office')] }, Promise.resolve({ ok: true, response: { ok: true, leader: e('kitchen') } }));
  M.claim('music_stop', { rooms: [e('office')] });
  var got = null; tail.then(function (v) { got = v; });
  flush();
  ok('a Stop of this page\'s for another room of the pick leaves the pick its answer', got && !got.stale, got);
  tail = M.settle('music_play_media', { player: e('kitchen'), rooms: [e('kitchen'), e('office')] }, Promise.resolve({ ok: true, response: { ok: true, leader: e('kitchen') } }));
  M.claim('music_stop', { rooms: [e('kitchen')] });
  got = null; tail.then(function (v) { got = v; });
  flush();
  ok('...a Stop for the room it plays on does not', got && got.stale === true, got);
  M._configure(HK_HOUSE);
})();

H.run('MUSIC STREAMS', []);
