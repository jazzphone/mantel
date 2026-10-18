// hk-library-card -- the Browse Music page's own library.
//
// WHAT THIS SUITE IS FOR. The card's DATA comes from a websocket, which this
// shim has no way to serve, so the response SHAPE is checked against a
// running system instead. What is left here is the part that is ours and can
// be got wrong silently:
//
//   * the ROOT FILTER -- browse_media's root mixes Music Assistant's
//     categories with every HA media source installed (Camera, Text-to-speech,
//     UniFi Protect). Only MA's belong on a music page, and the filter must
//     apply at the ROOT ONLY: below it everything is already MA's, and
//     filtering there would empty every album.
//   * the PLAYER RESOLUTION -- every call names an entity, and that is the
//     whole reason this card exists. A wrong map means browsing the wrong room
//     silently.
//   * the BREADCRUMB STACK -- back must land where you came from, including
//     out of a search.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/tests/music_house.js');   // the integration's config, as a screen receives it
// Most tests here name Music Assistant's entry in YAML when they need one;
// the integration's own entry is tested explicitly below.
var HOUSE_NO_MA = Object.assign({}, HK_HOUSE, { library_entry: null });
window.hkMusic._configure(HOUSE_NO_MA);
load(HK_ROOT + '/frontend/cards/hk-library.js');

var pass = 0, fail = 0;
function ok(what, got, want) {
  if (String(got) === String(want)) { pass++; return; }
  fail++;
  print('  FAIL ' + what + '\n    got  ' + got + '\n    want ' + want);
}

// PROMISES DO NOT RESOLVE BY THEMSELVES IN A SYNCHRONOUS SCRIPT. jsc gives us
// drainMicrotasks(); a few passes, because the guards under test are chained
// (_ws -> .then -> _paint) and one pass only runs the jobs queued so far.
function drain(n) {
  for (var i = 0; i < (n || 5); i++) drainMicrotasks();
}

var Ctor = customElements.get('hk-library-card');
if (!Ctor) throw new Error('hk-library-card never registered');

var MAP = {
  'Kitchen': 'media_player.kitchen_homepod_ma',
  'Loft': 'media_player.loft_homepod_ma',
  'Everywhere': 'media_player.homepods_2'
};
// `option` is the room this SCREEN is focused on (hkMusic), which is what the
// card resolves its player from.
// An option the map does not name leaves the screen with no focus at all.
function card(option) {
  var c = Object.create(Ctor.prototype);
  c._config = { music: true };
  hkGive(c, { states: {} });
  window.hkMusic._reset();
  if (MAP[option]) window.hkMusic.setFocus(MAP[option]);
  // EVERY MAPPED PLAYER EXISTS, as it does in a real hass: _play checks the
  // player's availability and refuses a speaker hass does not have.
  Object.keys(MAP).forEach(function (k) {
    c.hass.states[MAP[k]] = { entity_id: MAP[k], state: 'idle', attributes: {} };
  });
  // A real element can dispatch; the tests/dom.js stub cannot.
  c.dispatchEvent = function (ev) { (this._events = this._events || []).push(ev); return true; };
  c._stack = []; c._items = null; c._mode = 'browse';
  return c;
}

print('=== every call names the speaker the page points at ===');
ok('Kitchen selected',   card('Kitchen')._player(),   'media_player.kitchen_homepod_ma');
ok('Loft selected',      card('Loft')._player(),      'media_player.loft_homepod_ma');
ok('a group selected',   card('Everywhere')._player(),'media_player.homepods_2');
// An option the map does not cover must NOT silently fall through to some
// other room: a speaker missing from the map would quietly play somewhere
// else.
ok('unmapped option resolves to nothing', card('Nowhere')._player(), 'null');
var fb = card('Nowhere');
fb._config.fallback_player = 'media_player.homepods_2';
ok('...unless a fallback is configured', fb._player(), 'media_player.homepods_2');

print('\n=== the root keeps Music Assistant and drops HA media sources ===');
var ROOT = [
  { title: 'Artists',       media_content_type: 'music_assistant' },
  { title: 'Albums',        media_content_type: 'music_assistant' },
  { title: 'Playlists',     media_content_type: 'music_assistant' },
  { title: 'Camera',        media_content_type: 'app' },
  { title: 'Text-to-speech',media_content_type: 'app' },
  { title: 'UniFi Protect', media_content_type: 'app' }
];
var c = card('Kitchen');
ok('root drops the app sources', c._filter(ROOT).length, 3);
ok('  ...and keeps MA in order',
   c._filter(ROOT).map(function (x) { return x.title; }).join('|'),
   'Artists|Albums|Playlists');

// BELOW the root nothing is filtered: an album's tracks are `music`, not
// `music_assistant`, so filtering there would empty every album on the page.
var TRACKS = [{ title: 'Track 1', media_content_type: 'music' },
              { title: 'Track 2', media_content_type: 'music' }];
c._stack = [{ title: 'Back In Black' }];
ok('inside an album nothing is dropped', c._filter(TRACKS).length, 2);
c._stack = [];
c._mode = 'search';
ok('search results are never filtered', c._filter(TRACKS).length, 2);
ok('  (search results are `music`, not `music_assistant`)',
   c._filter(ROOT).length, 6);

print('\n=== `hide:` drops categories you do not use ===');
// Audiobooks, say: offered by Music Assistant, never opened, and an eighth
// tile costs a row on a wall tablet. The ids are browse_media's own
// (`artists`, `albums`, ...).
var ROOT7 = [
  { title: 'Artists',   media_content_id: 'artists',    media_content_type: 'music_assistant' },
  { title: 'Podcasts',  media_content_id: 'podcasts',   media_content_type: 'music_assistant' },
  { title: 'Audiobooks',media_content_id: 'audiobooks', media_content_type: 'music_assistant' },
  { title: 'Camera',    media_content_id: 'media-source://camera', media_content_type: 'app' }
];
c = card('Kitchen');
ok('nothing hidden by default', c._filter(ROOT7).length, 3);
c._config.hide = ['audiobooks'];
ok('audiobooks hidden', c._filter(ROOT7).map(function (x) { return x.title; }).join('|'),
   'Artists|Podcasts');
// The hide list is a ROOT concern. Inside a category the ids are item ids, and
// one that happened to collide with a category name must not vanish.
c._stack = [{ title: 'Podcasts' }];
ok('hide does not reach inside a category', c._filter(ROOT7).length, 4);
c._stack = [];
c._config.hide = ['nope'];
ok('an id that matches nothing drops nothing', c._filter(ROOT7).length, 3);

print('\n=== Configure -> Browse Music is the house default; a card\'s own YAML wins ===');
// A generated dashboard's Browse Music page has no YAML to put `hide:` in,
// so the house's choice comes from the settings.
var realSetting = window.hkCards.setting, SET = {};
window.hkCards.setting = function (path, fb) { return path in SET ? SET[path] : fb; };
SET['browse.hide'] = ['audiobooks'];
c = card('Kitchen');
ok('the house hides audiobooks', c._filter(ROOT7).map(function (x) { return x.title; }).join('|'),
   'Artists|Podcasts');
c._config.hide = [];
ok('  ...unless the card says hide: []', c._filter(ROOT7).length, 3);
SET['browse.discover'] = [{ key: 'favourite_songs', title: 'Favourite songs', media_type: 'track', favorite: true },
                          { key: 'recent_artists', title: 'Recently played artists', media_type: 'artist',
                            order_by: 'last_played_desc' }];
c = card('Kitchen');
c._config.config_entry = 'abc';
var askedFor = [];
c._ws = function (m) { askedFor.push(m.service_data); return new Promise(function () {}); };
c._loadDiscover();
ok('the house\'s rows, in its order', c._shelves.map(function (s) { return s.title; }).join('|'),
   'Favourite songs|Recently played artists');
ok('  ...asked as picked', JSON.stringify(askedFor.map(function (d) {
     return [d.media_type, d.order_by || null, !!d.favorite]; })),
   '[["track",null,true],["artist","last_played_desc",false]]');
ok('  ...never sending the key or the title to Music Assistant',
   'key' in askedFor[0] || 'title' in askedFor[0], 'false');
// Saved again with other rows: the old shelves go at once, not after SHELF_AGE.
SET['browse.discover'] = [{ key: 'favourite_radio', title: 'Favourite radio', media_type: 'radio', favorite: true }];
c._loadDiscover();
ok('other rows replace the shelves immediately', c._shelves.map(function (s) { return s.title; }).join('|'),
   'Favourite radio');
SET['browse.discover'] = [];
c._loadDiscover();
ok('no rows picked -> no Discover section', String(c._shelves), 'null');
c = card('Kitchen');
c._config.config_entry = 'abc';
c._config.discover = [{ title: 'Mine', media_type: 'album' }];
c._ws = function () { return new Promise(function () {}); };
SET['browse.discover'] = [{ key: 'favourite_radio', title: 'Favourite radio', media_type: 'radio', favorite: true }];
c._loadDiscover();
ok('a card\'s own discover: wins', c._shelves[0].title, 'Mine');
window.hkCards.setting = realSetting;

print('\n=== the categories come first, Discover below them ===');
// The category row sits right under search: Discover above it would put five
// rows of artwork between the search box and the seven things the page exists
// to open.
function painted(atRoot, shelves) {
  var c = card('Kitchen');
  c._e = { body: document.createElement('div') };
  c._crumb = function () {};
  c._tile = function (n) {
    var d = document.createElement('div'); d.className = 'it';
    d.textContent = n.title || n.name || ''; return d;
  };
  c._ctx = { top: null, atRoot: atRoot, mode: 'browse' };
  c._items = [{ title: 'Artists', media_content_id: 'artists' },
              { title: 'Albums',  media_content_id: 'albums' }];
  c._shown = 60;
  c._shelves = shelves;
  c._paint();
  return c._e.body.children.map(function (x) { return x.className; });
}
var SH = [{ title: 'Recently added', items: [{ name: 'A', uri: 'u', media_type: 'album' }] },
          { title: 'Most played',    items: [{ name: 'B', uri: 'u', media_type: 'album' }] }];
ok('grid first, shelves second', painted(true, SH).join('|'), 'grid cats|shelves');
// Not "a heading somewhere above" -- NO heading. Under the search bar the
// categories read as the page's own controls, and the first shelf's own
// heading separates the two halves.
var body = painted(true, SH);
ok('no extra heading over the categories', body.indexOf('cats'), -1);
// Still loading, or every shelf empty: the wrapper must not appear at all,
// or the page carries 26px of margin under the categories for nothing.
ok('no shelves yet -> grid alone', painted(true, null).join('|'), 'grid cats');
ok('all shelves empty -> grid alone',
   painted(true, [{ title: 'x', items: [] }]).join('|'), 'grid cats');
// Inside a category there are no shelves at all: there you asked a question,
// and suggestions are noise.
ok('not at the root -> no shelves', painted(false, SH).join('|'), 'grid');
// `cats` is the class that lets the row STRETCH to the full width (auto-fit
// collapses the unused track). At the root that is six known tiles; on a list
// of results it would stretch two matches to 626px each -- and the artwork is
// square, so that is a 626px-tall tile.
ok('only the root row may stretch', painted(false, SH)[0], 'grid');

print('\n=== a category carries its label inside the pill ===');
// A caption under the well, like an album's, would cost the row 128px to say
// one word. Everything that is NOT a category keeps the caption, because
// artwork cannot be written over.
c = card('Kitchen');
var catTile = c._tile({ title: 'Radio stations', media_content_id: 'radio' }, true);
var kids = function (t, cls) {
  return t.children.filter(function (x) { return x.className === cls; }).length;
};
var artOf = function (t) {
  return t.children.filter(function (x) { return x.className === 'art'; })[0];
};
// It is the shared 70px action tile from hk-base.js -- the same
// material the playlist buttons one page back are made of -- so the class is
// what carries the well, the glyph size and the label beside it.
ok('a category IS the shared action tile', catTile.className, 'it cat tile');
ok('  ...with a well', kids(catTile, 'well'), 1);
ok('  ...and the label beside it', kids(catTile, 'txt'), 1);
ok('  ...reading the title',
   catTile.children.filter(function (x) { return x.className === 'txt'; })[0].textContent,
   'Radio stations');
ok('  ...and no artwork slot at all', kids(catTile, 'art'), 0);
ok('  ...and no caption under it', kids(catTile, 'nm'), 0);
var albumTile = c._tile({ title: 'Awakening', media_class: 'album' }, false);
ok('an album is NOT a tile', albumTile.className.indexOf('tile'), -1);
ok('  ...it keeps its artwork', kids(albumTile, 'art'), 1);
ok('  ...and captions below it', kids(albumTile, 'nm'), 1);

print('\n=== a category lists through get_library, and PAGES ===');
// browse_media truncates silently -- measured against one library:
// albums 498 of 1126, tracks 277 of 7883, no error and no `not_shown`.
// A thenable that resolves IN THE CALLER'S JOB. A real Promise defers to a
// microtask, and jsc only drains those when the script ends -- so `_open`
// would return with nothing loaded and every assertion below would read
// undefined. The card only ever does `.then(...).catch(...)`, so this is
// enough of a promise to stand in for one.
function syncP(v) {
  return {
    then: function (f) {
      var err = null;
      try { f(v); } catch (e) { err = e; }
      return { catch: function (g) { if (err) g(err); } };
    }
  };
}
function cat(cfgExtra) {
  var c = card('Kitchen');
  c._config.config_entry = 'abc';
  Object.keys(cfgExtra || {}).forEach(function (k) { c._config[k] = cfgExtra[k]; });
  c.calls = [];
  c._paint = function () {};
  c._ws = function (msg) {
    c.calls.push(msg);
    if (msg.type !== 'call_service') return syncP({ children: [] });
    var off = msg.service_data.offset, n = off === 0 ? 500 : 3;
    var items = [];
    for (var i = 0; i < n; i++) {
      items.push({ name: 'a' + (off + i), uri: 'library://album/' + (off + i),
                   media_type: 'album', image: null,
                   artists: [{ name: 'Someone' }] });
    }
    return syncP({ response: { items: items } });
  };
  return c;
}
var c2 = cat();
c2._open({ title: 'Albums', can_expand: true, media_content_type: 'music',
           media_content_id: 'albums' });
ok('a category calls get_library', c2.calls[0].service, 'get_library');
ok('  ...alphabetically', c2.calls[0].service_data.order_by, 'name');
ok('  ...500 at a time', c2.calls[0].service_data.limit, 500);
ok('  ...from the start', c2.calls[0].service_data.offset, 0);
ok('  ...naming the config entry', c2.calls[0].service_data.config_entry_id, 'abc');
// THE INTEGRATION'S LIVE ENTRY WINS over one written in YAML: a re-added
// Music Assistant gets a new id, and the page must not keep asking the old one.
window.hkMusic._configure(HK_HOUSE);
var c2b = cat();
c2b._open({ title: 'Albums', can_expand: true, media_content_type: 'music',
            media_content_id: 'albums' });
ok('the integration\'s Music Assistant entry wins',
   c2b.calls[0].service_data.config_entry_id, 'ma-entry');
window.hkMusic._configure(HOUSE_NO_MA);
// Below the category, browse_media again: those levels are small and
// browse_media is what knows how to expand a node.
var c3 = cat();
c3._stack = [{ title: 'Albums', id: 'albums' }];
c3._open({ title: 'An album', can_expand: true, media_content_type: 'music',
           media_content_id: 'library://album/9' });
ok('inside a category it is browse_media again',
   c3.calls[0].type, 'media_player/browse_media');
// No config entry anywhere -> get_library cannot run at all, so fall back
// rather than show an empty page.
var c4 = card('Kitchen');
c4.calls = []; c4._paint = function () {};
c4._ws = function (m) { c4.calls.push(m); return syncP({ children: [] }); };
c4._open({ title: 'Albums', can_expand: true, media_content_type: 'music',
           media_content_id: 'albums' });
ok('no config entry falls back to browse_media',
   c4.calls[0].type, 'media_player/browse_media');

print('\n=== "Show more" fetches the next page when it runs out ===');
// A FULL page means there is more on the server even though nothing is left
// in `items`. Without that, the page would stop at 500 -- the same silent
// truncation, just moved.
var c5 = cat();
c5._open({ title: 'Albums', can_expand: true, media_content_type: 'music',
           media_content_id: 'albums' });
ok('a full page means "there may be more"', c5._pageMore, 'true');
ok('  ...and remembers what it was paging', c5._paged.type, 'album');
c5._shown = 500;                       // everything loaded is on screen
c5.calls = [];
c5._more();
ok('running out fetches the next page', c5.calls.length, 1);
ok('  ...from where it left off', c5.calls[0].service_data.offset, 500);
ok('  ...appending, not replacing', c5._items.length, 503);
ok('a short page means the end', c5._pageMore, 'false');
c5.calls = [];
c5._shown = 600;
c5._more();
ok('  ...so it stops asking', c5.calls.length, 0);
// Paging state must not leak onto a level that has nothing more behind it.
var c6 = cat();
c6._open({ title: 'Albums', can_expand: true, media_content_type: 'music',
           media_content_id: 'albums' });
ok('paging armed inside the category', c6._pageMore, 'true');
c6._stack = [{ title: 'Albums', id: 'albums' }];
c6._open({ title: 'An album', can_expand: true, media_content_type: 'music',
           media_content_id: 'library://album/9' });
ok('  ...and disarmed below it', c6._pageMore, 'false');

print('\n=== the artist survives the move to get_library ===');
// browse_media titles an album "Matt Redman - 10,000 Reasons"; get_library
// titles it "10,000 Reasons" and puts the artist in its own field. Dropping
// it would quietly remove the artist from every album tile.
c = card('Kitchen');
var withArt = c._shelfNode({ name: '10,000 Reasons', uri: 'u', media_type: 'album',
                             artists: [{ name: 'Matt Redman' }] }, true);
ok('the category listing shows it', withArt.sub, 'Matt Redman');
ok('  ...and carries it for the header', withArt._artist, 'Matt Redman');
var shelf = c._shelfNode({ name: '10,000 Reasons', uri: 'u', media_type: 'album',
                           artists: [{ name: 'Matt Redman' }] }, false);
ok('a Discover shelf tile does not', String(shelf.sub), 'undefined');
ok('  ...but still carries it', shelf._artist, 'Matt Redman');
ok('no artists at all is not a crash',
   String(c._shelfNode({ name: 'x', uri: 'u', media_type: 'album' }, true).sub),
   'undefined');

print('\n=== which section a search result belongs in ===');
// media_class is NOT enough: Music Assistant returns radio stations as the
// generic `music`, so grouping on it puts four stations under a heading
// called "Music". The URI carries the real type.
c = card('Kitchen');
var kindOf = function (id, cls) {
  return c._kind({ media_content_id: id, media_class: cls });
};
ok('a radio station is radio, not music',
   kindOf('radiobrowser://radio/e07a3814-a235', 'music'), 'radio');
ok('a podcast',   kindOf('itunes_podcasts://podcast/https://anchor.fm/x', 'podcast'), 'podcast');
ok('a playlist',  kindOf('library://playlist/151', 'playlist'), 'playlist');
ok('a track',     kindOf('apple_music://track/355010134', 'track'), 'track');
ok('an album',    kindOf('apple_music://album/1440847380', 'album'), 'album');
// No URI, or one whose type we have no heading for: fall back to the class,
// and to "other" when that is no good either. A result must never vanish.
ok('no uri falls back to the class', kindOf('', 'artist'), 'artist');
ok('an unknown type falls back too', kindOf('weird://thing/1', 'album'), 'album');
ok('and unknown everything is other', kindOf('weird://thing/1', 'mystery'), 'other');

print('\n=== a search answers in sections, in a fixed order ===');
var SEARCH = [
  { title: 'Radio 105',   media_content_id: 'radiobrowser://radio/1', media_class: 'music' },
  { title: 'Yellow',      media_content_id: 'apple_music://track/2',  media_class: 'track' },
  { title: 'Coldplay',    media_content_id: 'apple_music://artist/3', media_class: 'artist' },
  { title: 'Parachutes',  media_content_id: 'apple_music://album/4',  media_class: 'album' },
  { title: '42',          media_content_id: 'apple_music://track/5',  media_class: 'track' },
  { title: 'Essentials',  media_content_id: 'library://playlist/6',   media_class: 'playlist' }
];
function searched(items) {
  var c = card('Kitchen');
  c._e = { body: document.createElement('div') };
  c._crumb = function () {};
  c._tile = function (n) {
    var d = document.createElement('div'); d.className = 'it';
    d.textContent = n.title || ''; return d;
  };
  c._ctx = { top: null, atRoot: false, mode: 'search' };
  c._items = items; c._shown = 60;
  c._paint();
  return c._e.body.children.map(function (sec) {
    var body = sec.children[1];
    // A Tracks section is a LIST -- one plate of rows -- and every other
    // section is a grid of tiles. Read whichever it is by its own shape.
    var names = body.className === 'list'
      ? body.children.map(function (r) { return r.attrs['data-hk-name']; })
      : body.children.map(function (t) { return t.textContent; });
    return sec.children[0].textContent + ':' + names.join(',');
  });
}
var secs = searched(SEARCH);
// Artists, Albums, Tracks, Playlists, Radio -- the order is fixed so the
// shape of a result page is the same every time, whatever order MA answered.
ok('five sections', secs.length, 5);
ok('in the fixed order',
   secs.map(function (x) { return x.split(':')[0]; }).join('|'),
   'Artists|Albums|Tracks|Playlists|Radio stations');
ok('both tracks land in Tracks', secs[2], 'Tracks:Yellow,42');
// ...and that section is a list, while its neighbors are grids.
function shapes(items) {
  var c = card('Kitchen');
  c._e = { body: document.createElement('div') };
  c._crumb = function () {};
  c._tile = function () { return document.createElement('div'); };
  c._ctx = { top: null, atRoot: false, mode: 'search' };
  c._items = items; c._shown = 60;
  c._paint();
  return c._e.body.children.map(function (sec) {
    return sec.children[0].textContent + '=' + sec.children[1].className;
  });
}
ok('only Tracks is a list',
   shapes(SEARCH).join('|'),
   'Artists=grid|Albums=grid|Tracks=list|Playlists=grid|Radio stations=grid');
ok('the station is under Radio stations', secs[4], 'Radio stations:Radio 105');
// An empty kind must not leave an empty heading behind.
ok('only sections with results appear',
   searched([SEARCH[2]]).join('|'), 'Artists:Coldplay');

print('\n=== a track listing is a list, not a grid ===');
// Tracks are a list, not a grid: in a grid an album's nineteen tiles all carry
// the SAME cover at 199px square, so the nineteen things that differ are 13px
// truncated captions.
c = card('Kitchen');
var tr = function (id, title, thumb) {
  return { media_content_id: 'library://track/' + id, media_class: 'track',
           title: title, thumbnail: thumb || null, can_play: true };
};
ok('all tracks -> a list', c._isTracks([tr(1, 'a'), tr(2, 'b')]), 'true');
// Not "most". A level that mixes an album in with tracks is still a browse,
// and half a list is worse than either.
ok('one non-track and it stays a grid',
   c._isTracks([tr(1, 'a'), { media_content_id: 'library://album/9', media_class: 'album' }]),
   'false');
ok('an empty level is not a list', c._isTracks([]), 'false');
// ...and the BROWSE path actually uses it: opening an album paints a list
// where opening an artist paints a grid.
function levelShape(items) {
  var c = card('Kitchen');
  c._e = { body: document.createElement('div') };
  c._crumb = function () {};
  c._tile = function () { return document.createElement('div'); };
  c._ctx = { top: null, atRoot: false, mode: 'browse' };
  c._items = items; c._shown = 60;
  c._paint();
  return c._e.body.children[0].className;
}
ok('inside an album the level is a list',
   levelShape([tr(1, 'a'), tr(2, 'b')]), 'list');
ok('inside an artist it is still a grid',
   levelShape([{ media_content_id: 'library://album/9', media_class: 'album', title: 'x' }]),
   'grid');

print('\n=== "Artist - Title" is one string, and it splits ===');
// browse_media gives a track no separate artist field.
ok('artist and title',   JSON.stringify(c._split('Jesus Culture - Awaken Me')),
   '{"artist":"Jesus Culture","title":"Awaken Me"}');
// FIRST separator only, or a title with its own dash loses half of itself.
ok('a title keeps its own dash',
   JSON.stringify(c._split("Coldplay - Don't Panic - Single")),
   '{"artist":"Coldplay","title":"Don\'t Panic - Single"}');
ok('no separator is all title', JSON.stringify(c._split('Exclusively Coldplay')),
   '{"artist":"","title":"Exclusively Coldplay"}');
ok('a hyphen without spaces is not one',
   JSON.stringify(c._split('Jay-Z')), '{"artist":"","title":"Jay-Z"}');

print('\n=== a column that repeats in every row is dropped ===');
function rows(items, top) {
  var c = card('Kitchen');
  c._shown = 60;
  var list = c._list(items, top || null);
  return list.children.map(function (rw) {
    var lead = rw.children[0], txt = rw.children[1];
    return [lead.className, lead.textContent,
            txt.children[0].textContent,
            txt.children[1] ? txt.children[1].textContent : ''].join('|');
  });
}
// AN ALBUM: one cover repeated, one artist repeated. What is left that
// differs is the title, so the row is a number and a title.
var ALBUM = [tr(1, 'Jesus Culture - Awaken Me', 'http://art/a.jpg'),
             tr(2, 'Jesus Culture - Father of Lights', 'http://art/a.jpg'),
             tr(3, 'Jesus Culture - Perfect Love', 'http://art/a.jpg')];
var r = rows(ALBUM);
ok('an album numbers its rows', r[0], 'num|1|Awaken Me|');
ok('  ...and keeps counting',   r[2], 'num|3|Perfect Love|');
ok('  ...with no repeated artist line', r.join('').indexOf('Jesus Culture'), -1);
// DOMINANT, NOT UNANIMOUS -- and the exception is the point. On a real album,
// "Awakening", 18 of 19 tracks are Jesus Culture and one is Banning
// Liebscher. An all-or-nothing rule would print the artist on all nineteen,
// 18 of them saying nothing and the one that mattered lost among them.
var MIXED = ALBUM.concat([tr(4, 'Banning Liebscher - Interlude', 'http://art/a.jpg')]);
r = rows(MIXED);
ok('the odd track out keeps its artist', r[3], 'num|4|Interlude|Banning Liebscher');
ok('  ...and the other 3 still do not', r.slice(0, 3).join('').indexOf('Jesus Culture'), -1);
// A PLAYLIST has no understood artist, so a dominant one is still named --
// the covers differ there, which is what gates this.
var HEAVY = [tr(1, 'Coldplay - Yellow', 'http://art/1.jpg'),
             tr(2, 'Coldplay - 42', 'http://art/2.jpg'),
             tr(3, 'Muse - Hysteria', 'http://art/3.jpg')];
ok('a dominant artist in a playlist is still named',
   rows(HEAVY)[0].split('|').pop(), 'Coldplay');
// A PLAYLIST: neither repeats, so each row keeps its own artwork and artist.
var PLAYLIST = [tr(1, 'Coldplay - Yellow', 'http://art/c.jpg'),
                tr(2, 'Dave Matthews Band - So Much to Say', 'http://art/d.jpg')];
r = rows(PLAYLIST);
ok('a playlist shows artwork', r[0].split('|')[0], 'thumb');
ok('  ...and the artist under the title', r[0].split('|').slice(2).join('|'),
   'Yellow|Coldplay');
ok('  ...for every row', r[1].split('|').slice(2).join('|'),
   'So Much to Say|Dave Matthews Band');
// No artwork anywhere is still "the same in every row", so it numbers rather
// than printing the same placeholder glyph N times.
r = rows([tr(1, 'Yellow'), tr(2, '42')]);
ok('no artwork at all numbers too', r[0].split('|')[0], 'num');

print('\n=== the header over a track listing ===');
// The artist, the album name and the cover sit above the track listing. It is
// also what pays for the rows dropping those columns -- said once and large
// instead of nineteen times.
function head(items, top) {
  var c = card('Kitchen');
  var hd = c._head(top, items, c._trackInfo(items));
  var cover = hd.children[0], meta = hd.children[1];
  return { cover: cover.children[0] ? cover.children[0].src || 'icon' : 'icon',
           lines: meta.children.map(function (x) { return x.className + ':' + x.textContent; }) };
}
var h = head(ALBUM, { title: 'Awakening', node: { thumbnail: 'http://art/a.jpg' } });
ok('the cover is the tile you tapped', h.cover, 'http://art/a.jpg');
ok('album, artist, count', h.lines.join('|'),
   'h1:Awakening|h2:Jesus Culture|h3:3 songs');
// THE TILE'S TITLE IS PREFIXED with the artist too, so printing it whole
// above a line that already says the artist says it twice. On a real page
// the tile reads "Matt Redman - 10,000 Reasons".
h = head(ALBUM, { title: 'Matt Redman - 10,000 Reasons', node: {} });
ok('the header splits the level title too', h.lines[0], 'h1:10,000 Reasons');
ok('  ...and the prefix is the artist', h.lines[1], 'h2:Matt Redman');
// The prefix WINS over the tracks' most common artist: it is the album's own
// artist, where the other is a guess that is usually right.
h = head(PLAYLIST, { title: 'Muse - Origin of Symmetry', node: {} });
ok('a title prefix beats the dominant track artist', h.lines[1], 'h2:Muse');
// A PLAYLIST has no artist of its own, and printing its most common one would
// say something that is not true of it.
h = head(PLAYLIST, { title: 'Your Essentials', node: { thumbnail: 'http://art/p.jpg' } });
ok('a playlist gets no artist line', h.lines.join('|'),
   'h1:Your Essentials|h3:2 songs');
// browse_media answers the LEVEL with thumbnail:null (measured on both an
// album and a playlist), so a level opened without a tile -- a deep link, a
// restored crumb -- falls back to the artwork the tracks share.
h = head(ALBUM, { title: 'Awakening', node: {} });
ok('no tile artwork falls back to the tracks', h.cover, 'http://art/a.jpg');
h = head([tr(1, 'A - b'), tr(2, 'A - c')], { title: 'Nowhere', node: {} });
ok('and with no artwork anywhere, an icon', h.cover, 'icon');
ok('one song is singular',
   head([tr(1, 'A - b', 'u')], { title: 'x', node: {} }).lines.pop(), 'h3:1 song');

print('\n=== Play all survives the list ===');
// Opening an album to see its tracks must not be the only way to lose the
// ability to play the album.
r = rows(ALBUM, { playable: true, node: {} });
ok('Play all is the first row', r[0], 'thumb||Play all|');
ok('  ...and the tracks follow it', r[1], 'num|1|Awaken Me|');
ok('  ...numbered from one, not two', r[3], 'num|3|Perfect Love|');

print('\n=== back out of a result returns to the search ===');
// Back out of a result opened from a search returns to that search. Opening a
// result pushes onto the browse stack and sets mode to `browse`, so without
// the saved search the last step out would land on the root categories with
// the query still sitting in the box.
c = card('Kitchen');
c._loaded = [];
c._load = function (node) { this._loaded.push(node ? node.title : 'ROOT'); };
c._paint = function () { this._painted = (this._painted || 0) + 1; };
c._mode = 'search'; c._query = 'coldplay';
c._items = [{ title: 'Parachutes' }];
c._shown = 60;
c._open({ title: 'Parachutes', can_expand: true, media_content_type: 'music',
          media_content_id: 'apple_music://album/4' });
ok('opening a result remembers the search', c._saved.query, 'coldplay');
ok('  ...and its results, not just the query', c._saved.items.length, 1);
ok('  ...and we are browsing now', c._mode, 'browse');
c._back();
ok('back restores the search', c._mode, 'search');
ok('  ...with the query', c._query, 'coldplay');
ok('  ...and the same results', c._items.length, 1);
ok('  ...WITHOUT asking Music Assistant again', c._loaded.length, 1);
ok('  ...and the memory is spent', String(c._saved), 'null');
// One more back, now at the search itself, clears it and goes to the root.
c._back();
ok('back again leaves the search', c._mode, 'browse');
ok('  ...to the root', c._loaded[c._loaded.length - 1], 'ROOT');

print('\n=== the saved search cannot go stale ===');
// Two levels deep: only the step that EMPTIES the stack restores it.
c = card('Kitchen');
c._loaded = []; c._load = function (n) { this._loaded.push(n ? n.title : 'ROOT'); };
c._paint = function () {};
c._mode = 'search'; c._query = 'q'; c._items = [1]; c._shown = 60;
c._open({ title: 'Artist', can_expand: true, media_content_id: 'x://artist/1' });
c._open({ title: 'Album', can_expand: true, media_content_id: 'x://album/1' });
c._back();
ok('one level up is still a browse', c._mode, 'browse');
ok('  ...and it loaded the parent', c._loaded[c._loaded.length - 1], 'Artist');
c._back();
ok('the step that empties the stack restores the search', c._mode, 'search');
// A NEW search from the root must not leave the OLD one recoverable.
c = card('Kitchen');
c._paint = function () {};
c._ws = function () { return Promise.resolve({ result: [] }); };
c._saved = { query: 'old', items: [], shown: 60 };
c._search('new');
ok('a fresh search drops the saved one', String(c._saved), 'null');
// ...but searching from INSIDE something does not, because back out of that
// search returns to where you were standing.
c = card('Kitchen');
c._paint = function () {};
c._ws = function () { return Promise.resolve({ result: [] }); };
c._stack = [{ title: 'Coldplay' }];
c._saved = { query: 'old', items: [], shown: 60 };
c._search('new');
ok('a search from inside keeps it', c._saved.query, 'old');

print('\n=== the breadcrumb ===');
c = card('Kitchen');
c._loaded = [];
c._load = function (node) { this._loaded.push(node ? node.title : 'ROOT'); };
c._open({ title: 'Artists', can_expand: true, media_content_type: 'music_assistant',
          media_content_id: 'artists' });
ok('opening pushes a crumb', c._stack.length, 1);
ok('  and loads it', c._loaded[c._loaded.length - 1], 'Artists');
c._open({ title: 'AC/DC', can_expand: true, media_content_type: 'music',
          media_content_id: 'library://artist/476' });
ok('drilling pushes another', c._stack.length, 2);
c._back();
ok('back pops one', c._stack.length, 1);
ok('  and reloads the parent', c._loaded[c._loaded.length - 1], 'Artists');
c._back();
ok('back again reaches the root', c._stack.length, 0);
ok('  and loads the root', c._loaded[c._loaded.length - 1], 'ROOT');

print('\n=== a track plays instead of expanding ===');
c = card('Kitchen');
c._calls = [];
// RETURNS A PROMISE, because the real one always does (HkBase._call resolves
// `true`/`false` and never rejects). A stub that returned undefined would
// let _play() look fine here while it throws in the browser, where it checks
// whether the call was accepted.
// hk_frontend.music_play_media ANSWERS, so the stub does too (HkBase._callResp's
// shape: {ok, response}). A stub that answered nothing would hide the path
// that reads the answer.
c._callResp = function (d, s, data) { this._calls.push([d, s, data]);
                                      return Promise.resolve({ ok: true, response: { ok: true } }); };
c._flash = function () {};
c._load = function () {};
c._open({ title: 'Carry On', can_expand: false, can_play: true,
          media_content_type: 'music', media_content_id: 'apple_music://track/1' });
ok('no crumb pushed for a leaf', c._stack.length, 0);
ok('one service call', c._calls.length, 1);
ok('  ...through the integration', c._calls[0][0] + '.' + c._calls[0][1], 'hk_frontend.music_play_media');
// THE ASSERTION THIS CARD EXISTS FOR.
ok('  ...TARGETED AT THE SELECTED SPEAKER',
   c._calls[0][2].player, 'media_player.kitchen_homepod_ma');
ok('  ...carrying the id', c._calls[0][2].media_content_id, 'apple_music://track/1');
ok('  ...and the type', c._calls[0][2].media_content_type, 'music');

// Change the selection and the SAME track goes somewhere else, with no other
// state touched -- that is the property an iframe cannot have.
c = card('Loft');
c._calls = []; c._callResp = function (d, s, data) { this._calls.push(data);
                                                     return Promise.resolve({ ok: true, response: { ok: true } }); };
c._flash = function () {}; c._load = function () {};
c._open({ title: 'Carry On', can_expand: false, can_play: true,
          media_content_type: 'music', media_content_id: 'apple_music://track/1' });
ok('the selection decides the target', c._calls[0].player,
   'media_player.loft_homepod_ma');

print('\n=== a node that can do neither is inert ===');
c = card('Kitchen');
c._calls = []; c._callResp = function () { this._calls.push(1);
                                           return Promise.resolve({ ok: true, response: {} }); };
c._load = function () {};
c._open({ title: 'Nothing', can_expand: false, can_play: false });
ok('no crumb', c._stack.length, 0);
ok('no call', c._calls.length, 0);

print('\n=== the page back chevron is this card\'s back, while there is depth ===');
// hk-back-card offers every press as a cancelable `hk-back` before it
// navigates. Taking it here is what gives the page ONE back control -- it
// means "up a level" until there are none left, and only then "leave the
// page". Otherwise the chevron would jump straight out of a three-level
// browse to Play Music.
c = card('Kitchen');
c._loaded = [];
c._load = function (n) { this._loaded.push(n ? n.title : 'ROOT'); };
c._stack = [{ title: 'Artists' }, { title: 'AC/DC' }];
function pressBack(cc) {
  var prevented = false;
  cc._onBack({ preventDefault: function () { prevented = true; } });
  return prevented;
}
// _onBack is installed on first render; build it the way _render does.
var selfRef = c;
c.isConnected = true;
c._onBack = function (ev) {
  if (!selfRef.isConnected) return;
  if (selfRef._mode !== 'search' && !selfRef._stack.length) return;
  ev.preventDefault();
  selfRef._back();
};
ok('two levels deep it is consumed', pressBack(c), 'true');
ok('  ...and one level is popped', c._stack.length, 1);
ok('one level deep it is consumed', pressBack(c), 'true');
ok('  ...reaching the root', c._stack.length, 0);
// AT THE ROOT IT MUST LET GO, or the page could never be left at all.
ok('at the root it is NOT consumed', pressBack(c), 'false');

// A search is a level too: backing out of it returns to the browse you left.
c._mode = 'search'; c._query = 'kenny';
ok('a search consumes it', pressBack(c), 'true');
ok('  ...and returns to browsing', c._mode, 'browse');
ok('  ...clearing the query', c._query, '');

// A DISCONNECTED CARD MUST NOT EAT THE PRESS. The listener lives on window,
// so a stale one would swallow back on whatever page came next.
c.isConnected = false;
c._stack = [{ title: 'Artists' }];
ok('a disconnected card ignores it', pressBack(c), 'false');

print('\n=== Discover shelves speak a different dialect ===');
// get_library answers {name, uri, media_type, image}; browse_media answers
// {title, media_content_id, media_content_type, can_expand, thumbnail}. One
// renderer serves both, so the shelf item is translated -- and the uri IS a
// valid browse id, which is what lets a shelf tile drill in like any other.
c = card('Kitchen');
var album = c._shelfNode({ name: 'Awakening', uri: 'library://album/1948',
                           media_type: 'album', image: 'http://x/y.jpg' });
ok('name -> title',        album.title, 'Awakening');
ok('uri  -> content id',   album.media_content_id, 'library://album/1948');
ok('image -> thumbnail',   album.thumbnail, 'http://x/y.jpg');
ok('browsed as `music`',   album.media_content_type, 'music');
ok('an album can be opened', album.can_expand, 'true');

var track = c._shelfNode({ name: 'Amazed', uri: 'library://track/5362',
                           media_type: 'track' });
// A LEAF. Tapping a track must PLAY it, not try to open it -- browse_media
// would answer nothing and the page would look broken.
ok('a track cannot be opened', track.can_expand, 'false');
ok('  ...but can be played',   track.can_play, 'true');
ok('a missing image is null',  String(track.thumbnail), 'null');
ok('radio is a leaf too',
   c._shelfNode({ name: 'r', uri: 'u', media_type: 'radio' }).can_expand, 'false');
ok('a playlist opens',
   c._shelfNode({ name: 'p', uri: 'u', media_type: 'playlist' }).can_expand, 'true');

print('\n=== a shelf that cannot load simply is not there ===');
// A shelf is a suggestion. An error message where a suggestion should be is
// worse than the absence of one, so a failed fetch leaves an empty list and
// _paint skips it.
c = card('Kitchen');
c._config.config_entry = 'abc';
c._config.discover = [{ title: 'Recently added', media_type: 'album',
                        order_by: 'timestamp_added_desc' }];
c._ws = function () { return Promise.reject(new Error('nope')); };
c._paint = function () { this._painted = (this._painted || 0) + 1; };
c._loadDiscover();
ok('a shelf is registered immediately', c._shelves.length, 1);
ok('  ...with no items yet', String(c._shelves[0].items), 'null');

print('\n=== shelves refresh when old, and a failure is neither forever nor a loop ===');
// A visited view's card lives until the page reloads, so a shelf fetched once
// per CARD would go a day stale, and a failed one would stay missing all day.
var realNow = Date.now, clock = 1000000;
Date.now = function () { return clock; };
var asked = 0, answer = 'ok';
c = card('Kitchen');
c._config.config_entry = 'abc';
c._config.discover = [{ title: 'Recently played', media_type: 'track', order_by: 'last_played_desc' }];
c._paint = function () {};
c._ws = function () {
  asked++;
  return answer === 'ok' ? Promise.resolve({ response: { items: [{ name: 'T' + asked }] } })
                         : Promise.reject(new Error('down'));
};
c._loadDiscover(); drain();
ok('first root visit fetches', asked, 1);
c._loadDiscover(); drain();
ok('an immediate second visit does not', asked, 1);
clock += 11 * 60 * 1000;
c._loadDiscover(); drain();
ok('after ten minutes it fetches again', asked, 2);
ok('  ...and shows the new answer', c._shelves[0].items[0].name, 'T2');
clock += 11 * 60 * 1000; answer = 'fail';
c._loadDiscover(); drain();
ok('a failed refresh keeps what the shelf had', c._shelves[0].items[0].name, 'T2');
c._loadDiscover(); drain(); c._loadDiscover(); drain();
ok('  ...and is NOT retried on every paint (no loop)', asked, 3);
clock += 61 * 1000; answer = 'ok';
c._loadDiscover(); drain();
ok('  ...but is retried a minute later', asked, 4);
Date.now = realNow;

print('\n=== Discover needs a config entry and rows ===');
// get_library is the one call here that takes no entity, so without the
// config entry it cannot run at all -- and must not half-run.
c = card('Kitchen');
c._config.discover = [{ title: 'x', media_type: 'album' }];
c._ws = function () { throw new Error('must not be called'); };
c._loadDiscover();
ok('no config entry -> no shelves', String(c._shelves), 'undefined');
// No `discover:` and no settings module: nothing to ask. (A real screen
// always has hk-settings.js, whose defaults are five rows -- see
// test_settings.js.)
c = card('Kitchen');
c._config.config_entry = 'abc';
c._ws = function () { throw new Error('must not be called'); };
c._loadDiscover();
ok('no rows anywhere -> no shelves', String(c._shelves), 'undefined');
c = card('Kitchen');
c._config.config_entry = 'abc';
c._config.discover = [];
c._ws = function () { throw new Error('must not be called'); };
c._loadDiscover();
ok('discover: [] -> no shelves', String(c._shelves), 'undefined');

print('\n=== a slow answer must never beat a newer one (the search race) ===');
// The debounce must not leave the *visible* new query accepting old answers.
// Drive the actual input listener, before its timer invokes _search.
c = card('Kitchen');
c._root = document.createElement('div');
c._load = function () {};
c._render();
c._req = 7;
c._e.search._listeners.input[0]({ target: { value: 'zeppelin' } });
ok('typing invalidates an old request before debounce', c._req, 8);
ok('the new query is recorded immediately', c._query, 'zeppelin');
// A root failure must offer a retry without a dashboard refresh.
c._e.body = document.createElement('div');
var retried = 0;
c._retry = function () { retried++; };
c._empty('No response');
c._e.body.children[0].children[1].click();
ok('error recovery has a working retry', retried, 1);
// THE RACE: type "love", then "zeppelin"; the broad query can answer 1.4s
// later and replace 19 correct results with its own -- the search box says
// zeppelin, the screen says Love, The Beatles - Love, Planetshakers - All for
// Love...
//
// The guard is a request counter, so the test is: hold two answers, release
// them in the WRONG order, and check which one the card kept.
function pending() {
  var box = {};
  box.promise = new Promise(function (res, rej) { box.res = res; box.rej = rej; });
  return box;
}
c = card('Kitchen');
c._paint = function () {};
var a = pending(), b = pending(), nth = 0;
c._ws = function () { nth++; return nth === 1 ? a.promise : b.promise; };
c._mode = 'search';
c._search('love');                       // first, will answer LAST
c._search('zeppelin');                   // second, answers first
b.res({ result: [{ title: 'Led Zeppelin', media_content_id: 'x://artist/1' }] });
a.res({ result: [{ title: 'Love' }, { title: 'The Beatles - Love' }] });
drain();
ok('the newer search wins', (c._items || []).length, 1);
ok('  ...and it is the right one', (c._items || [])[0].title, 'Led Zeppelin');

// The same for a FAILURE arriving late: a stale rejection must not blank a
// good list, which is the other half of the guard.
c = card('Kitchen');
c._paint = function () {};
a = pending(); b = pending(); nth = 0;
c._ws = function () { nth++; return nth === 1 ? a.promise : b.promise; };
c._mode = 'search';
c._search('slow');
c._search('fast');
b.res({ result: [{ title: 'Kept' }] });
a.rej(new Error('provider went away'));
drain();
ok('a stale error does not blank the list', (c._items || []).length, 1);
ok('  ...and sets no error banner', String(c._err), 'null');

// A navigation in flight must lose to one started after it, the same way.
c = card('Kitchen');
c._paint = function () {};
a = pending(); b = pending(); nth = 0;
c._ws = function () { nth++; return nth === 1 ? a.promise : b.promise; };
// A non-empty stack so _filter passes these through -- the root filter is a
// different rule with its own tests above.
c._stack = [{ title: 'Albums', type: 'music_assistant', id: 'albums' }];
c._load(c._stack[0]);
c._load({ title: 'Artists', type: 'music_assistant', id: 'artists' });
b.res({ children: [{ title: 'from artists', media_content_type: 'music' }] });
a.res({ children: [{ title: 'from albums', media_content_type: 'music' }] });
drain();
ok('the newer browse wins', (c._items || [])[0].title, 'from artists');

print('\n=== a playlist answers the tap before its tracks do ===');
// Music Assistant fetches a playlist's tracks from Apple Music on the way in
// (7-45 s measured cold, 2026-10-14). The header -- the tapped tile's cover
// and title, "Loading songs…" -- is drawn at once, so the tap is answered.
// What the body would show is read at each paint: the pending level, or the
// list the card still holds.
function shots(c) {
  c._shots = [];
  c._paint = function () {
    this._shots.push(this._loading && this._pend ? 'head:' + this._pend.title
                     : 'items:' + (this._items || []).map(function (n) { return n.title; }).join(','));
  };
}
var PL = { title: 'Rock Classics', type: 'music', id: 'library://playlist/142',
           node: { title: 'Rock Classics', media_content_id: 'library://playlist/142',
                   thumbnail: 'http://art/rc.jpg' } };
c = card('Kitchen'); shots(c);
a = pending(); c._ws = function () { return a.promise; };
c._items = [{ title: 'Playlists grid' }];
c._stack = [{ title: 'Playlists', id: 'playlists' }, PL];
c._load(PL);
ok('opening a playlist draws its header at once', c._shots.join('|'), 'head:Rock Classics');
ok('  ...and keeps the level it left, for back', c._items[0].title, 'Playlists grid');
a.res({ children: [{ title: 'AC/DC - Thunderstruck', media_content_id: 'x://track/1',
                     media_content_type: 'music' }] });
drain();
ok('  ...then the tracks replace it', c._shots[c._shots.length - 1], 'items:AC/DC - Thunderstruck');
ok('  ...and nothing is pending', String(c._pend), 'null');
// The header itself: same cover and title as the loaded one, the count
// replaced by the wait, which breathes.
h = c._head(PL, [], { cover: '' }, 'Loading songs…');
ok('the waiting header names the playlist', h.children[1].children.map(function (x) {
  return x.className + ':' + x.textContent; }).join('|'), 'h1:Rock Classics|h3 wait:Loading songs…');
ok('  ...with the tile\'s cover', h.children[0].children[0].src, 'http://art/rc.jpg');

// An ALBUM too: MA usually answers from its database in ~10 ms, but one
// measured 50 s. The header stays put when the rows land, so no flash.
c = card('Kitchen'); shots(c);
a = pending(); c._ws = function () { return a.promise; };
var AL = { title: 'Done With Mirrors', type: 'music', id: 'library://album/2038',
           node: { media_content_id: 'library://album/2038' } };
c._stack = [{ title: 'Albums', id: 'albums' }, AL];
c._load(AL);
ok('an album is drawn at once too', c._shots.join('|'), 'head:Done With Mirrors');

// An ARTIST is not: its albums come from MA's database and the level is a
// grid, not a header over tracks, so the old level stays until it lands.
c = card('Kitchen'); shots(c);
a = pending(); c._ws = function () { return a.promise; };
var AR = { title: 'Roxette', type: 'music', id: 'library://artist/754',
           node: { media_content_id: 'library://artist/754' } };
c._stack = [{ title: 'Artists', id: 'artists' }, AR];
c._load(AR);
ok('an artist is not drawn early', c._shots.length, 0);

// BACK while a playlist is still loading: the newer load owns the screen,
// and the late tracks are dropped.
c = card('Kitchen'); shots(c);
a = pending(); b = pending(); nth = 0;
c._ws = function () { nth++; return nth === 1 ? a.promise : b.promise; };
c._stack = [{ title: 'Search', id: 'x' }, PL];
c._load(PL);
c._stack.pop();
c._load(c._stack[0]);
ok('leaving a pending playlist clears it', String(c._pend), 'null');
b.res({ children: [{ title: 'the level you went back to', media_content_type: 'music' }] });
a.res({ children: [{ title: 'late tracks', media_content_type: 'music' }] });
drain();
ok('  ...and its late tracks do not land', c._items[0].title, 'the level you went back to');

// A FAILURE says so, rather than "Loading songs…" forever.
c = card('Kitchen'); shots(c);
a = pending(); c._ws = function () { return a.promise; };
c._stack = [{ title: 'Playlists', id: 'playlists' }, PL];
c._load(PL);
a.rej(new Error('Apple Music Rate Limiter'));
drain();
ok('a failed playlist clears the wait', String(c._pend), 'null');
ok('  ...and says why', /Rate Limiter/.test(c._err), true);

// THE TIME IT NEEDS: Rock Classics took 45 s cold, past the usual 20 s, so a
// playlist that was coming said "did not respond". MA retries Apple for up
// to ~2 minutes; a playlist or album waits that long, anything else does not.
c = card('Kitchen'); shots(c);
var waits = [];
c._ws = function (m, w) { waits.push(w || 20000); return pending().promise; };
c._stack = [{ title: 'Playlists', id: 'playlists' }, PL];
c._load(PL);
c._stack = [{ title: 'Artists', id: 'artists' }, AR];
c._load(AR);
ok('a playlist may take two minutes; an artist the usual 20 s', waits.join(','), '120000,20000');

// THE PAGE SAYS IT IS IN USE, so Keep Playlists Ready (warm.py) does not
// put a request of its own ahead of this person's at Apple Music. After the
// request it is about, and at most every 30 s.
c = card('Kitchen'); c._paint = function () {};
var said = [];
// a host object has its methods from the start (the adapter offers what it has)
hkGive(c, Object.assign({}, c.hass, { callWS: function (m) { said.push(m.type); return Promise.resolve(); } }));
c._ws = function (m) { said.push(m.type); return pending().promise; };
c._stack = [{ title: 'Playlists', id: 'playlists' }, PL];
c._load(PL);
c._load(PL);
c._search('zep');
drain();
ok('opening and searching say the page is in use, once',
   said.join(','), 'media_player/browse_media,hk_music/used,media_player/browse_media,media_player/search_media');
c = card('Kitchen'); c._paint = function () {};
// a host object has its methods from the start (the adapter offers what it has)
hkGive(c, Object.assign({}, c.hass, { callWS: function () { throw new Error('unknown command'); } }));
c._ws = function () { return pending().promise; };
c._load(PL);
ok('  ...and a backend without the command changes nothing', String(c._err), 'null');

// Pressing back onto saved results must beat a load that was already out.
c = card('Kitchen');
c._paint = function () {};
a = pending(); nth = 0;
c._ws = function () { nth++; return a.promise; };
c._saved = { query: 'kept', items: [{ title: 'restored' }], shown: 60 };
c._e = null;
c._stack = [{ title: 'Albums', type: 'music_assistant', id: 'albums' }];
c._load(c._stack[0]);
c._restoreSearch();
a.res({ children: [{ title: 'late browse', media_content_type: 'music' }] });
drain();
ok('restoring a search beats an in-flight load', (c._items || [])[0].title, 'restored');

print('\n=== the page never stops naming the speaker ===');
// Naming it only at the root is not enough: search for a song from a wall
// tablet, tap it, and it plays to a room whose name has not been on screen
// since.
function crumbText(c) {
  var seen = [];
  c._e = { crumb: { innerHTML: '', appendChild: function (n) { seen.push(n.textContent); },
                    _seen: seen } };
  c._playerName = function () { return 'Office'; };
  c._crumb(c._stack.length ? c._stack[c._stack.length - 1] : null);
  return seen.join('');
}
c = card('Office'); c._mode = 'browse'; c._stack = [];
ok('root names the speaker', /Office/.test(crumbText(c)), true);
c = card('Office'); c._mode = 'search'; c._query = 'zep'; c._stack = [];
ok('a search names the speaker', /Office/.test(crumbText(c)), true);
c = card('Office'); c._mode = 'browse';
c._stack = [{ title: 'Albums' }, { title: 'Awakening' }];
ok('two levels deep names the speaker', /Office/.test(crumbText(c)), true);

print('\n=== a play that was refused does not claim it worked ===');
c = card('Kitchen');
c._paint = function () {};
c._callResp = function () { return Promise.resolve({ ok: false, error: 'x' }); };
c._play({ title: 'Thing', media_content_id: 'x://track/1', media_content_type: 'music' });
ok('says it is starting first, and where', c._toast, 'Playing Thing on Kitchen');
drain();
ok('  ...then says it did not', c._toast, 'Could not play Thing');
// The integration ran it and it never STARTED: a refusal answer, not an error.
c = card('Kitchen');
c._paint = function () {};
c._callResp = function () {
  return Promise.resolve({ ok: true, response: { ok: false, message: 'It did not start on Kitchen.' } }); };
c._play({ title: 'Thing', media_content_id: 'x://track/1', media_content_type: 'music' });
drain();
ok('an answer that says it did not start is reported, in its words',
   c._toast, 'Could not play Thing: It did not start on Kitchen.');
c = card('Kitchen');
c._paint = function () {};
c._callResp = function () { return Promise.resolve({ ok: true, response: { ok: true, leader: 'media_player.kitchen_homepod_ma' } }); };
c._play({ title: 'Thing', media_content_id: 'x://track/1', media_content_type: 'music' });
drain();
ok('an accepted play keeps the happy message', c._toast, 'Playing Thing on Kitchen');

print('\n=== an unavailable speaker is refused out loud, not accepted silently ===');
// HA skips an unavailable entity inside a service call and reports success,
// so without this every tap during a Music Assistant restart would say
// "Playing".
['unavailable', 'unknown'].forEach(function (bad) {
  c = card('Kitchen');
  c.hass.states['media_player.kitchen_homepod_ma'].state = bad;
  c._calls = [];
  c._callResp = function (d, s, data) { this._calls.push([d, s, data]); return Promise.resolve({ ok: true, response: { ok: true } }); };
  c._play({ title: 'Thing', media_content_id: 'x://track/1', media_content_type: 'music' });
  ok(bad + ': no service call is made', c._calls.length, 0);
  ok(bad + ': and it says why', /Kitchen is unavailable/.test(c._toast), true);
});
c = card('Kitchen');
delete c.hass.states['media_player.kitchen_homepod_ma'];
c._calls = [];
c._callResp = function (d, s, data) { this._calls.push([d, s, data]); return Promise.resolve({ ok: true, response: { ok: true } }); };
c._play({ title: 'Thing', media_content_id: 'x://track/1', media_content_type: 'music' });
ok('a player missing from hass is refused too', c._calls.length, 0);

print('\n=== the message is HA\'s own toast, not a row at the top of the list ===');
// A row in the body is off screen whenever you have scrolled to the track you
// tapped, and setting/clearing it rebuilds the whole body twice.
c = card('Kitchen');
var fired = [];
c.dispatchEvent = function (ev) { fired.push(ev); return true; };
c._paint = function () { throw new Error('a message must not repaint the body'); };
c._flash('hello');
ok('one hass-notification event', fired.length + ':' + (fired[0] && fired[0].type), '1:hass-notification');
ok('  ...carrying the message', fired[0].detail && fired[0].detail.message, 'hello');

print('\n=== changing speaker while searching re-runs the SEARCH ===');
// _load always sets _ctx.mode to browse; leaving this._mode at 'search' puts
// the card in a state the back handler reads one way and the body another.
c = card('Kitchen');
c._built = true; c._e = { search: { value: '' } };
c._mode = 'search'; c._query = 'zep';
var asked = [];
c._search = function (q) { asked.push('search:' + q); };
c._load = function () { asked.push('load'); };
c._render();
ok('it searches again', asked.join(','), 'search:zep');
c = card('Kitchen');
c._built = true; c._e = { search: { value: '' } };
c._mode = 'browse'; c._stack = [];
asked = [];
c._search = function (q) { asked.push('search:' + q); };
c._load = function () { asked.push('load'); };
c._render();
ok('browsing still browses', asked.join(','), 'load');

print('\n=== artwork that never answers still resolves (a tablet with no internet) ===');
// On a wall tablet with no internet access, is1-ssl.mzstatic.com and
// r2.theaudiodb.com can HANG -- no response, no refusal -- while HA and Music
// Assistant's own :8095 answer. An <img> in that state fires neither `load`
// nor `error`, so an error handler alone never runs and the tile stays an
// empty square for as long as the page is up.
//
// In an Apple Music library nearly every item's artwork is on Apple's CDN,
// so that is almost every tile on the page.
//
// The shim's innerHTML setter does not store the string (it clears children),
// so "the placeholder won" is observed the way the shim can honestly report
// it: the <img> is gone, and a spy records what was written.
function artBox() {
  var b = document.createElement('div');
  b.__html = null;
  Object.defineProperty(b, 'innerHTML', {
    configurable: true,
    get: function () { return b.__html === null ? '' : b.__html; },
    set: function (v) { b.__html = String(v); b.children = []; }
  });
  return b;
}
function fire(el, type) {
  (el._listeners[type] || []).slice().forEach(function (f) { f({ type: type }); });
}
var host = Object.create(Ctor.prototype);

__resetTimers();
var bx = artBox();
var img = host._artImage('http://never/answers.jpg', bx, '<PLACEHOLDER>');
ok('the image goes in first', bx.children.length, 1);
ok('  ...and no placeholder yet', String(bx.__html), 'null');
__runTimers();                              // the 6s deadline arrives
ok('a hung load falls back', bx.__html, '<PLACEHOLDER>');
ok('  ...the img is gone', bx.children.length, 0);
ok('  ...and the request is canceled', img.src, '');

__resetTimers();
bx = artBox();
img = host._artImage('http://dead/404.jpg', bx, '<PLACEHOLDER>');
fire(img, 'error');
ok('an error still falls back', bx.__html, '<PLACEHOLDER>');

__resetTimers();
bx = artBox();
img = host._artImage('http://good/art.jpg', bx, '<PLACEHOLDER>');
img.complete = true; img.naturalWidth = 512;
fire(img, 'load');
__runTimers();
ok('artwork that loads is left alone', String(bx.__html), 'null');
ok('  ...and keeps its src', img.src, 'http://good/art.jpg');

// The deadline must not fire on an image that arrived before it: the check is
// complete && naturalWidth, because `complete` alone is also true after a
// failure.
__resetTimers();
bx = artBox();
img = host._artImage('http://slow/but-fine.jpg', bx, '<PLACEHOLDER>');
img.complete = true; img.naturalWidth = 300;   // arrived, but no event fired
__runTimers();
ok('a late-but-loaded image is not replaced', String(bx.__html), 'null');

// complete WITHOUT pixels is a failure, not a success.
__resetTimers();
bx = artBox();
img = host._artImage('http://broken/zero.jpg', bx, '<PLACEHOLDER>');
img.complete = true; img.naturalWidth = 0;
__runTimers();
ok('complete with no pixels still falls back', bx.__html, '<PLACEHOLDER>');
__resetTimers();

print('\n=== the crumb must not lie about how many rooms it will play to ===');
// With Browse open on the Office context, unjoin the Extra Room: the crumb
// must stop saying "Office +1" once _playerName() recomputes to "Office".
// _sigOf reads group_members, or nothing repaints.
function withGroup(option, player, members) {
  var c = card(option);
  c.hass.states[player] = { state: 'playing',
                             attributes: { group_members: members, media_title: 't' } };
  return c;
}
var K = 'media_player.kitchen_homepod_ma', L = 'media_player.loft_homepod_ma';
c = withGroup('Kitchen', K, [K, L]);
ok('a group of two names both rooms', c._playerName(), 'Kitchen + Loft');
var sigGrouped = c._sigOf();
c.hass.states[K].attributes.group_members = [];
ok('  ...and alone it is just the name', c._playerName(), 'Kitchen');
ok('  ...which CHANGES the signature, so the card repaints',
   c._sigOf() !== sigGrouped, true);
c.hass.states[K].attributes.group_members = [K, L, 'media_player.office_homepod_ma'];
ok('a group that GREW reads +2', c._playerName(), 'Kitchen +2');
ok('  ...also a new signature', c._sigOf() !== sigGrouped, true);

// ...but a group change must NOT re-ask Music Assistant for the level.
c = withGroup('Kitchen', K, [K, L]);
c._built = true;
c._e = { search: { value: '' }, crumb: { innerHTML: '', appendChild: function () {} } };
c._loadedFor = c._player();
c._stack = [];
var asked = [];
c._load = function () { asked.push('load'); };
c._search = function () { asked.push('search'); };
c._crumb = function () { asked.push('crumb'); };
c.hass.states[K].attributes.group_members = [];     // the group went away
c._render();
ok('the same speaker -> repaint the bar only', asked.join(','), 'crumb');
// a genuinely different speaker still reloads
asked = [];
window.hkMusic.setFocus(L, { hold: true });   // a request sent to the Loft
c._render();
ok('a different speaker -> reload the level', asked.join(','), 'load');

print('\n=== the back chevron must survive a disconnect ===');
// Registration inside the once-only `if (!this._built)` block would let the
// FIRST disconnect remove the window listener for good. Loading /music-browse
// directly looks fine; navigating Play Music -> Browse Music re-places the
// card, which disconnects it, and from then on the page chevron would walk
// you off the page instead of up a level.
function libCard() {
  var c = card('Kitchen');
  c._stack = []; c._mode = 'browse'; c._items = null;
  return c;
}
var listeners = [];
var realAdd = globalThis.addEventListener, realRemove = globalThis.removeEventListener;
globalThis.addEventListener = function (t, f) {
  if (t === 'hk-back') listeners.push(f);
  return realAdd ? realAdd.apply(this, arguments) : undefined;
};
globalThis.removeEventListener = function (t, f) {
  if (t === 'hk-back') listeners = listeners.filter(function (x) { return x !== f; });
  return realRemove ? realRemove.apply(this, arguments) : undefined;
};

c = libCard();
c.connectedCallback();
ok('connecting binds the handler', listeners.length, 1);
c.connectedCallback();
ok('  ...and connecting twice does not bind twice', listeners.length, 1);
c.disconnectedCallback();
ok('disconnecting unbinds it', listeners.length, 0);
c.connectedCallback();
ok('RECONNECTING BINDS IT AGAIN', listeners.length, 1);

// and the handler still does the right thing at each depth
var handler = listeners[0];
function press(c2) {
  var ev = { prevented: false, preventDefault: function () { this.prevented = true; } };
  handler(ev);
  return ev.prevented;
}
c.isConnected = true;
c._back = function () { c.__wentBack = true; };
c._stack = []; c._mode = 'browse'; c.__wentBack = false;
ok('at the root it lets the page chevron through', press(c), false);
ok('  ...and does not navigate the library', c.__wentBack, false);
c._stack = [{ title: 'Albums' }]; c.__wentBack = false;
ok('inside a category it takes the press', press(c), true);
ok('  ...and goes up a level', c.__wentBack, true);
c._stack = []; c._mode = 'search'; c.__wentBack = false;
ok('in a search it takes the press too', press(c), true);
// a card that has been disconnected must not act, even if its handler is called
c._stack = [{ title: 'Albums' }]; c.isConnected = false; c.__wentBack = false;
ok('a disconnected card ignores it', press(c), false);

print('\n=== a cold load that beats the music configuration recovers ===');
(function () {
  // The focus is in place (a real page has it from user_data before any
  // speaker is known) -- set while configured, then the speakers are taken
  // away to reproduce the moment before the integration has answered.
  var c = card('Kitchen');
  window.hkMusic._configure({ configured: false, speakers: [], floors: [], playlists: [], home: null });
  c._built = true;
  var loads = 0;
  var realLoad = Ctor.prototype._load;
  c._load = function (node) { loads++; return realLoad.call(this, node); };
  c._paint = function () {};
  c._ws = function () { return syncP({ children: [] }); };
  c._musicOff = null;
  c.connectedCallback();
  c._load(null);
  ok('with no configuration there is no speaker', c._err, 'No speaker selected.');
  // ...then the integration answers, with no focus change of its own.
  window.hkMusic._configure(HOUSE_NO_MA);
  drain();
  ok('the configuration arriving clears the error', !c._err, true);
  ok('  ...and loads the page again', loads >= 2, true);
  c.disconnectedCallback();
})();

globalThis.addEventListener = realAdd;
globalThis.removeEventListener = realRemove;


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

print('\n=== its editor ===');
var LF = editorFields('hk-library-card');
ok('Speaker (player) is in it, a media player', LF.player && LF.player.label + ' ' + JSON.stringify(LF.player.selector),
   'Speaker {"entity":{"filter":{"domain":"media_player"}}}');
var lp = card('Kitchen'); lp._config.player = 'media_player.loft_homepod_ma';
ok('...and it is what the card plays on, over the screen\'s room', lp._player(), 'media_player.loft_homepod_ma');
ok('Hide Categories picks several of Music Assistant\'s categories',
   LF.hide && LF.hide.selector.select.multiple + ' ' + LF.hide.selector.select.options.map(function (o) { return o.value; }).join(','),
   'true artists,albums,tracks,playlists,radio,podcasts,audiobooks');
ok('Discover Rows is YAML (each row is a query)', LF.discover && JSON.stringify(LF.discover.selector), '{"object":{}}');
ok('Fallback speaker stays', !!LF.fallback_player, true);

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' LIBRARY TESTS PASS'));
