// MUSIC NOT ADDED (2026-10-12): hk-music-card, hk-now-playing-card,
// hk-library-card and hk-speaker-picker-card say "Add the Music feature..."
// instead of empty rooms -- and ONLY when both of the integration's own
// answers say Music is not there: hkMusic's (hk_music/subscribe) and the
// live settings feed's `added`. A house WITH Music must never see the line,
// not even while a page loads and neither answer is in yet.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/tests/music_house.js');   // configures hkMusic (Music added)
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-library.js');
load(HK_ROOT + '/frontend/cards/hk-music.js');

// <html>, which the Music page reads (the docked bar's height) and flags
if (!document.documentElement) {
  document.documentElement = new El('html');
  document.documentElement.toggleAttribute = function (k, on) {
    if (on) this.attrs[k] = ''; else delete this.attrs[k];
  };
}
// THE MUSIC PAGE'S OWN LIBRARY is created by tag; the shim does not upgrade
// it, so it gets a stand-in with the two calls the page makes (the library
// itself is driven directly below).
(function () {
  var prev = document.createElement.bind(document);
  document.createElement = function (tag) {
    var el = prev(tag);
    if (String(tag).toLowerCase() === 'hk-library-card') {
      el.setConfig = function () {};
      el.toggleAttribute = function () {};
    }
    return el;
  };
})();

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}
var Mu = window.hkMusic;

// THE SETTINGS FEED: `live` once the integration has answered, and its
// `added` list (hkCards.added reads it through get)
var S = { live: false, added: [] };
window.hkSettings = {
  get live() { return S.live; },
  get: function (p, f) { return p === 'added' ? S.added : f; },
  onChange: function () { return function () {}; }
};
function world(musicAnswer, live, added) {
  Mu._reset();
  if (musicAnswer === 'none') Mu._configure({ configured: false });
  else if (musicAnswer === 'house') Mu._configure(HK_HOUSE);
  else Mu._configure(null);                // not answered yet: hkMusic's start
  S.live = live; S.added = added;
}

var house = H.house({ 'media_player.office_homepod_ma': ['idle', {}] });
function card(tag, cfg) {
  var c = H.make(tag);
  // no layout in the shim: the Music page measures itself and, at no width,
  // waits for one
  c.getBoundingClientRect = function () { return { width: 0, height: 0, top: 0, left: 0 }; };
  c.dispatchEvent = function () { return true; };    // the shim's element cannot
  H.attach(c);
  c.setConfig(Object.assign({ type: 'custom:' + tag }, cfg || {}));
  c.hass = house.hass();
  return c;
}
function note(c) {
  var k = c._root.children[0];
  return !!k && k.getAttribute('data-hk-role') === 'no-music' ? k.textContent : '';
}
var LINE = 'Add the Music feature to play music here (Settings → Devices & services → HK Frontend → Add feature).';
var TAGS = ['hk-music-card', 'hk-now-playing-card', 'hk-speaker-picker-card', 'hk-library-card'];

print('=== Music not added: the line, on every music card ===');
world('none', true, []);
TAGS.forEach(function (t) {
  ok(t + ': says to add the Music feature', note(card(t)) === LINE, note(card(t)));
});

print('\n=== ...and nowhere else ===');
world('unanswered', false, []);
TAGS.forEach(function (t) {
  ok(t + ': neither answer in yet (a page loading): no line', !note(card(t)));
});
world('none', false, []);
TAGS.forEach(function (t) {
  ok(t + ': settings feed not live (its stored copy): no line', !note(card(t)));
});
world('unanswered', true, ['music']);
TAGS.forEach(function (t) {
  ok(t + ': the feed says Music is added, hkMusic not answered yet: no line', !note(card(t)));
});
world('house', true, []);
TAGS.forEach(function (t) {
  ok(t + ': hkMusic configured: no line, whatever the feed says', !note(card(t)));
});

print('\n=== the cards that do not need it ===');
world('none', true, []);
var bar = card('hk-now-playing-card', { hide_idle: true, bar: true });
ok('the docked bar (hide_idle): draws nothing, not the line', !note(bar) && bar.style.display === 'none');
var lib = card('hk-library-card', { player: 'media_player.office_homepod_ma' });
ok('a library with a speaker of its own (player): browses, no line', !note(lib) && lib._built === true);
var lib2 = card('hk-library-card', { fallback_player: 'media_player.office_homepod_ma' });
ok('...or a fallback_player: no line', !note(lib2) && lib2._built === true);

print('\n=== Music added later: the card builds itself ===');
world('none', true, []);
var cards = TAGS.map(function (t) { return card(t); });
cards.forEach(function (c, i) { ok(TAGS[i] + ': the line first', !!note(c)); });
Mu._configure(HK_HOUSE);
S.added = ['music'];
cards.forEach(function (c, i) {
  c.hass = house.hass();
  ok(TAGS[i] + ': then the card itself', !note(c));
});
ok('the player is built again', cards[1]._built === true && !!cards[1]._e);
ok('the Music page is built again', cards[0]._built === true && !!cards[0]._e);
ok('the library is built again', cards[3]._built === true && !!cards[3]._e);

print('\n=== ...and the line is in the signature, so a hass push brings it ===');
world('house', true, ['music']);
var np = card('hk-now-playing-card');
var before = np._sigOf();
Mu._configure({ configured: false }); S.added = [];
ok('the signature moves when Music goes away', np._sigOf() !== before);
np.hass = house.hass();
ok('...and the next push draws the line', note(np) === LINE);

window.hkSettings = undefined;
world('house', false, []);
print('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' NO-MUSIC TESTS PASS');
if (fail) throw new Error(fail + ' failed');
