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
  p._hass = h; p._e = { house: house };
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
function title(cx) { return cx.children[1].children[0].textContent; }
function rooms(cx) { return cx.children[1].children[1].getAttribute('data-fit').split(','); }

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

// _houseFit: what the column has left once the player has its room
(function () {
  var fit = Card.prototype._houseFit;
  // a list of n cards: its heading 27 px, then a card every 58
  function col(o) {
    var house = { offsetTop: 100, children: { length: o.n, 1: { offsetTop: 127 } }, style: {} };
    Object.defineProperty(house, 'scrollHeight', { get: function () { return 27 + o.n * 58 - 6; } });
    return {
      _cols: o.cols, _houseKey: null,
      _e: { house: house, nx: { hidden: true }, art: { parentNode: { offsetHeight: o.art } },
            front: { scrollHeight: o.front }, left: { clientHeight: o.left }, pon: { offsetHeight: 50 },
            mu: { classList: { contains: function () { return !!o.idle; } } } }
    };
  }
  // the Kitchen tablet's column (measured): 600 high; the song and its
  // controls 260 under the cover. Room: 600 - (50 + 14) - 12 - (260 + 120) = 144
  var p = col({ cols: 2, n: 2, art: 120, front: 380, left: 600 });
  fit.call(p, true);
  eq('two cards (137 px) in 144 px of room: all of them, nothing cut', p._e.house.style.maxHeight, '144px');
  p = col({ cols: 2, n: 9, art: 120, front: 380, left: 600 });
  fit.call(p, true);
  eq('nine cards: whole cards, then 24 px of the next (27 + 58 + 24)', p._e.house.style.maxHeight, '109px');
  p = col({ cols: 2, n: 9, art: 120, front: 380, left: 600, idle: true });
  fit.call(p, true);
  eq('...nothing playing here: no Playing on, so a card more (27 + 2 x 58 + 24)', p._e.house.style.maxHeight, '167px');
  p = col({ cols: 2, n: 9, art: 120, front: 380, left: 420 });
  fit.call(p, true);
  eq('...a short column: one card and the peek at the least', p._e.house.style.maxHeight, '109px');
  p = col({ cols: 1, n: 9, art: 120, front: 380, left: 600 });
  p._e.house.style.maxHeight = '50px';
  fit.call(p, true);
  eq('one column (a phone\'s sheet scrolls): no cap', p._e.house.style.maxHeight, '');
  p = col({ cols: 2, n: 9, art: 120, front: 380, left: 600 });
  fit.call(p, true);
  p._e.left.clientHeight = 900;
  fit.call(p);
  eq('...measured again only when asked to (a resize) or the list changes', p._e.house.style.maxHeight, '109px');
  fit.call(p, true);
  eq('...and then fitted to the new column (27 + 6 x 58 + 24)', p._e.house.style.maxHeight, '399px');
})();

H.run('MUSIC STREAMS', []);
