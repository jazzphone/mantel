// hk-music.js: the Music page's rules -- room names fitted to one line, where
// a library item plays with nothing playing, and the group's volume calls.
// (The page itself is checked live, headless: hk_house/tools/headless.)
var DIR = HK_ROOT + '/';
load(DIR + 'tests/dom.js');
load(DIR + 'tests/card_harness.js');
load(DIR + 'frontend/cards/hk-base.js');
load(DIR + 'frontend/cards/hk-music.js');

var pass = 0, fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}
var U = window.hkMusicPage && window.hkMusicPage._;
ok('loads: the card and its rules', !!U && !!customElements.get('hk-music-card'));

// ONE LINE: a character is 10 px in this measure
var w = function (s) { return s.length * 10; };
var rooms = ['Living Room', 'Kitchen', 'Master Bedroom', 'Office'];
ok('every name when they fit', U.fitNames(rooms, 1000, w) === 'Living Room, Kitchen, Master Bedroom and Office');
ok('...as many as fit, then "and N more"', U.fitNames(rooms, 340, w) === 'Living Room, Kitchen and 2 more', U.fitNames(rooms, 340, w));
ok('...one name and "and N more" at the least', U.fitNames(rooms, 230, w) === 'Living Room and 3 more');
ok('...and "Living Room +3" when even that does not fit', U.fitNames(rooms, 150, w) === 'Living Room +3', U.fitNames(rooms, 150, w));
ok('...two names joined with "and"', U.fitNames(['Kitchen', 'Loft'], 1000, w) === 'Kitchen and Loft');

// WHERE A LIBRARY ITEM PLAYS, nothing playing
var presets = [{ name: 'Downstairs', entity: 'media_player.down', members: ['k', 'lr'] }];
var t = U.playTarget(['lr', 'k'], presets);
ok('a preset\'s rooms: its own group, nothing to bring in after', t.player === 'media_player.down' && t.then === null, t);
t = U.playTarget(['loft'], presets);
ok('one room: that room', t.player === 'loft' && t.then === null);
t = U.playTarget(['office', 'loft'], presets);
ok('an ad-hoc set: the first, then all of them brought together', t.player === 'office' && JSON.stringify(t.then) === '["office","loft"]', t);
ok('no rooms: no player', U.playTarget([], presets).player === null);

// THE GROUP'S VOLUME (the room card's rule)
var c1 = { key: 'k', kind: 'room', members: ['k'] };
ok('one room: that room', JSON.stringify(U.volumeCalls(c1, presets, 0.3)) === '[{"entity_id":"k","volume_level":0.3}]');
var cg = { key: 'lr', kind: 'group', members: ['lr', 'k', 'o'] };
ok('an ad-hoc group: every member in one call', JSON.stringify(U.volumeCalls(cg, presets, 0.4)) === '[{"entity_id":["lr","k","o"],"volume_level":0.4}]');
var cp = { key: 'media_player.down', kind: 'preset', members: ['k', 'lr'] };
var vp = U.volumeCalls(cp, presets, 0.5);
ok('a preset: the group, then its rooms', vp.length === 2 && vp[0].entity_id === 'media_player.down' && JSON.stringify(vp[1].entity_id) === '["k","lr"]', vp);
ok('nothing playing: no calls', U.volumeCalls(null, presets, 0.5).length === 0);

// THE FIRST LAYOUT IS NOT ANIMATED (2026-10-13): built with no column count
// (drawn unseen until _layout measures it), and a change of columns laid
// with transitions off -- on a phone Now Playing slid off the foot on every
// first visit, a sheet popping up and away
(function () {
  var src = readFile(HK_ROOT + '/frontend/cards/hk-music.js');
  ok('the page is built with no column count, unseen until it has one',
     src.indexOf('<div class="mu">') >= 0 && src.indexOf('<div class="mu" cols=') < 0 && src.indexOf("'.mu:not([cols]){visibility:hidden}'") >= 0);
  ok('...and a new column count is laid with its transitions off',
     /mu\.classList\.add\('relay'\);\s*mu\.setAttribute\('cols', String\(cols\)\);/.test(src) && src.indexOf("'.mu.relay,.mu.relay *{transition:none!important}'") >= 0 &&
     /requestAnimationFrame\(function \(\) \{ mu\.classList\.remove\('relay'\); \}\)/.test(src));
})();

// THE LIBRARY INSIDE THE PAGE gets what goes with each new client, through the host
// adapter's bridge (in HA, the frontend's object, which an HkBase card turns back
// into the same client).
(function () {
  var card = new (customElements.get('hk-music-card'))(), lib = {}, host = { states: {} };
  card._lib = lib;
  card.hass = host;
  ok('the library card is handed the object that goes with the page\'s client', lib.hass === host);
  ok('...and the page\'s client is that object\'s client', card.client === window.hkHostClient.from(host));
})();

print('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' MUSIC PAGE TESTS PASS');
if (fail) throw new Error(fail + ' failed');
