// THE MEDIA BLOCKS AS WIDGETS (2026-10-31, the Home Grid blocks mock-up the
// owner approved): Now Playing's sizes (a new Small, the volume under the
// transport on Large and Extra Large, Speakers and Browse either side; Small, Wide and Tall only the keys, what
// does not fit is on the player's sheet, 2026-11-08), the
// Music block (Music's Recently Played: hk-media.js hk-recent-music-card) and
// the Live TV block (its channels: hk-tv-channels-card), each mounted by the
// panel block (hk-grid-cards.js). A fictional house: nothing here names a real one.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run blocks_media');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';
globalThis.history = { pushState: function () {} };

var ADDED = ['music', 'live_tv'];
window.hkSettings = {
  version: 1,
  get: function (path, fb) { return path === 'added' ? ADDED : fb; },
  tablet: function () { return null; }
};

load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/tests/music_house.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/cards/hk-grid-cards.js');

var ok = H.ok, eq = H.eq, C = window.hkCards, Mx = window.hkMedia._;
window.hkCards.createCard = function (cfg, client) {
  var el = window.hkCards.create(cfg);
  if (el && client) el.hkSetClient(client);
  return el;
};

var house = H.house({
  'media_player.kitchen_homepod_ma': ['playing', { friendly_name: 'Kitchen HomePod', media_title: 'Paper Lanterns', media_artist: 'June Avenue' }],
  'camera.channel_4_1': ['idle', { friendly_name: 'Channel 4' }],
  'sensor.channel_4_1_now': ['Evening News', { start: new Date(Date.now() - 30 * 60000).toISOString(), end: new Date(Date.now() + 30 * 60000).toISOString() }],
  'camera.channel_7_1': ['idle', { friendly_name: 'Food' }],
  'sensor.channel_7_1_now': ['Coastal Kitchens', {}],
  'camera.channel_9_1': ['idle', { friendly_name: 'Comedy' }]
});
function client() { return window.hkHostClient.from(house.hass()); }
function sized(tag, size) {
  var el = H.make(tag);
  el.setConfig({ type: 'custom:' + tag });
  el.setAttribute('size', size);
  el.getAttribute = function (k) { return this.attrs[k]; };
  el.hasAttribute = function (k) { return k in this.attrs; };
  return el;
}
var CHANNELS = { configured: true, channels: [
  { number: '4.1', name: 'Channel 4', camera: 'camera.channel_4_1', now: 'sensor.channel_4_1_now' },
  { number: '7.1', name: 'Food', camera: 'camera.channel_7_1', now: 'sensor.channel_7_1_now' },
  { number: '9.1', name: 'Comedy', camera: 'camera.channel_9_1', now: null }] };

H.run('MEDIA BLOCKS', [
function () {
  H.section('Now Playing: what each size is handed (the catalog)');
  var G = window.hkGridCatalog, at = function (s) { return G.config({ card: 'now_playing', size: s, opts: {} }, {}); };
  eq('Small: the player alone, no progress or volume card', [!!at('S').sub_card, !!at('S').meta_card], [false, false]);
  // (the volume back on Wide and Tall, 2026-11-09, the owner: "Looks like the tall and the wide cards lost their volume
  // slider?" -- and "Volume is more important than the progress bar for these cards": where both do not fit full-size,
  // the progress is the thin line, the volume keeps its slider)
  eq('Wide: the progress and the volume', [(at('W').sub_card || {}).parts, (at('W').meta_card || {}).parts], [['progress'], ['volume']]);
  eq('Tall: the progress and the volume', [(at('T').sub_card || {}).parts, (at('T').meta_card || {}).parts], [['progress'], ['volume']]);
  eq('Large: the progress and the volume', [(at('L').sub_card || {}).parts, (at('L').meta_card || {}).parts], [['progress'], ['volume']]);
  eq('Extra Large: the same', [(at('XL').sub_card || {}).parts, (at('XL').meta_card || {}).parts], [['progress'], ['volume']]);
  ok('...each following the screen\'s music', at('L').meta_card.entity_from && at('L').meta_card.entity_from.music === true && at('W').sub_card.entity_from.music === true);
},
function () {
  H.section('Now Playing: the sizes\' layouts');
  var css = customElements.get('hk-now-playing-card').CSS;
  // THE CONTROLS STRIP (2026-11-09, hk-np-strip.js): the progress, the keys and the volume are one grid area, `strip`, laid
  // out by the strip itself (a column) -- the sizes name that area where they named sub, prev, play, next, spk, brw and meta,
  // and set the strip's targets: 56 px (a block is drawn at about 0.8), play / pause 64, 12 px clear above and below the keys
  ok('Small: the cover and play / pause on top, the song under them',
     css.indexOf('"art strip" ". ." "title title" "artist artist"') >= 0 && css.indexOf(':host(:is([size=S],[size=W],[size=T])) .np .hks .mx{display:none}') >= 0 &&
     css.indexOf(':host([size=S]) .np .hks [data-act=prev],:host([size=S]) .np .hks [data-act=next]{display:none}') >= 0);
  ok('...on a tile cell the artist goes and the cover takes the height left', /@container hk-cell \(max-height:179px\)\{:host\(\[size=S\]\)[^}]*--np-art[^}]*\}:host\(\[size=S\]\) \.np \.artist\{display:none\}/.test(css));
  ok('every block: the strip\'s targets 56 px, play / pause 64, 12 px clear above and below the keys, the volume\'s row 56',
     css.indexOf('--hks-min:56px;--hks-b:56px;--hks-pp:64px;--hks-x:56px;--hks-vh:56px;--hks-g1:12px;--hks-g2:12px;') >= 0);
  // (the speaker line over the title at every size with one -- the owner's mockup 12h, 2026-11-09: its own row, `line`)
  ok('every block but Small: the speaker line over the title, a 56 px touch area', css.indexOf('grid-area:line;') >= 0 && css.indexOf('--hksl-h:56px') >= 0 &&
     css.indexOf(':host([size=S]) .np .hksl{display:none}') >= 0);
  ok('Wide: the speaker line, the song and the strip beside the cover', css.indexOf('"art ." "art line" "art title" "art artist" "art strip" "art ."') >= 0);
  ok('...the cover as big as the keys\' 178 px and the gap beside it (the block\'s inset) leave it', /--np-art:min\(\(100cqh[^;]*- 178px - var\(--hk-pad-l,22px\)\)/.test(css));
  // (the thin line stays in the progress's place, never along the foot -- 2026-11-09, the owner: "it looks bad at the bottom
  // like that")
  // (2026-11-09: the speaker line over the song took the thin progress line's room -- the owner's order, the volume first,
  // then the progress; the sheet has it)
  ok('...no progress, the volume a full row', css.indexOf(':host([size=W]) .np .hks .mprog{display:none!important}') >= 0);
  ok('...on a tile cell (110 px) the keys alone: the volume on the sheet', css.indexOf('@container hk-cell (max-height:179px){:host([size=W]) .np .hks .mvol{display:none}}') >= 0);
  ok('Tall: the cover, the speaker line, the song, the strip', css.indexOf('--hk-np-areas:"art" "line" "title" "artist" "strip";') >= 0);
  ok('...the cover on the block\'s axis', css.indexOf(':host([size=T]) .np .art{justify-self:center;align-self:start}') >= 0);
  ok('...the bottom inset 6 px more', /:host\(\[size=T\]\) hk-plate\.np\{--hk-np-pad:[^;]*calc\(var\(--hk-pad-b,20px\) \+ 6px\)/.test(css));
  ok('Large: the speaker line and the song beside the cover, the strip under them', css.indexOf('--hk-np-areas:"pre" "line" "title" "artist" "post" "." "strip";') >= 0);
  ok('...on a tile cell the progress is the thin line, the volume keeps its slider', css.indexOf(':host([size=L]) .np .hks .mprog{pointer-events:none;--hk-prog-h:3px') >= 0);
  ok('Tall on a tile cell: the same', css.indexOf(':host([size=T]) .np .hks .mprog{pointer-events:none;--hk-prog-h:3px') >= 0);
  ok('Extra Large: the group between two flexible rows, centered on the cover',
     css.indexOf('--hk-np-rows:minmax(0,1fr) min-content min-content min-content min-content minmax(0,1fr)') >= 0 && css.indexOf('"art ." "art line" "art title" "art artist" "art strip" "art ."') >= 0);
  ok('in a pager: no volume row', css.indexOf(':host([size][data-grid-pager]) hk-plate.np{--hk-np-pad:20px 22px 44px;--np-vol:0px}') >= 0);
},
function () {
  H.section('Now Playing: Speakers turns the block over, a Small one to the Volume');
  var turned = [];
  ['S', 'W'].forEach(function (s) {
    var np = sized('hk-now-playing-card', s);
    np._turn = function (tab) { turned.push(s + ':' + tab); };
    hkGive(np, house.hass());
    np._render();
    var spk = np._root.querySelector('.hksl');   // (the speaker line over the title since 2026-11-09: the Speakers key's place)
    (spk._listeners.click || [])[0]();
  });
  eq('Small: Volume (no slider of its own); Wide: Speakers', turned, ['S:volume', 'W:speakers']);
  var np = sized('hk-now-playing-card', 'T');
  hkGive(np, house.hass());
  window.hkMusic.setFocus('media_player.kitchen_homepod_ma');
  np._render();
  ok('no label over the song (2026-11-08)', !/class="lab"|>Now Playing<|'Now Playing'/.test(readFile(HK_ROOT + '/frontend/media/hk-media-now.js')));
},
function () {
  H.section('Music: one cover per album, the last first');
  var items = [
    { uri: 'library://track/1', name: 'Low Tide', image: 'a.jpg', album: { uri: 'library://album/1' }, artists: [{ name: 'Marlow Lane' }] },
    { uri: 'library://track/2', name: 'Night Drive', album: { uri: 'library://album/1' } },
    { uri: 'library://track/3', name: 'Garden', album: { uri: 'library://album/2' } },
    { uri: '', name: 'nothing to play' },
    { uri: 'library://track/4', name: 'Long Walk' }];
  var got = Mx.recentCovers(items);
  eq('a record played through shows once; nothing without a uri', got.map(function (i) { return i.name; }), ['Low Tide', 'Garden', 'Long Walk']);
  eq('...with its artist and picture', [got[0].artist, got[0].image], ['Marlow Lane', 'a.jpg']);
  var many = []; for (var i = 0; i < 50; i++) many.push({ uri: 'library://track/' + i, name: 'T' + i });
  eq('at most forty (the grid scrolls through them)', Mx.recentCovers(many).length, 40);
  eq('the covers each size shows at once: W four, T six, L eight, XL twelve (and the last above L\'s and XL\'s)',
     ['W', 'T', 'L', 'XL'].map(function (s) { return Mx.RECENT[s][0]; }), [4, 6, 8, 12]);
  eq('a cover with no picture has a color of its own, the same every time', Mx.tintOf('Low Tide'), Mx.tintOf('Low Tide'));
},
function () {
  H.section('Music: asks for the Music page\'s Recently played, and a tap plays on this screen\'s music');
  var mu = sized('hk-recent-music-card', 'W');
  var c = client();
  mu.client = c;
  mu._render();
  var ask = house.ws[house.ws.length - 1];
  eq('get_library, tracks by when they last played', [ask.msg.service, ask.msg.service_data.media_type, ask.msg.service_data.order_by, ask.msg.service_data.config_entry_id],
     ['get_library', 'track', 'last_played_desc', 'ma-entry']);
  ask.resolve({ response: { items: [{ uri: 'library://track/1', name: 'Low Tide' }] } });
  return H.tick().then(function () {
    eq('the answer is kept', mu._items.map(function (i) { return i.name; }), ['Low Tide']);
    // EXTRA LARGE, Recently Played (2026-11-09, mockup 13): the last large with Play and Browse, "Also Played" as rows
    var xl = sized('hk-recent-music-card', 'XL');
    xl.client = c;
    xl._items = [{ uri: 'u1', name: 'One', artist: 'A', key: 'k1' }, { uri: 'u2', name: 'Two', artist: 'B', key: 'k2' }, { uri: 'u3', name: 'Three', artist: 'C', key: 'k3' }];
    xl._render();
    var xh = String(xl._root.innerHTML);
    eq('XL: the last in the left column, the rest as rows under Also Played, Play and Browse at the foot',
       [xh.indexOf('xl2') >= 0, xh.indexOf('Also Played') >= 0, (xh.match(/class="rw"/g) || []).length, xh.indexOf('class="pp"') >= 0, xh.indexOf('class="br"') >= 0, xh.indexOf('class="al"') >= 0],
       [true, true, 2, true, true, true]);
    var rb = xl._root.querySelectorAll('.rw'), before0 = house.calls.length;
    xl._play(xl._items[1], document.createElement('button'));     // (the row's own listener: fake clicks carry no stopPropagation)
    var rcall = house.calls[before0];
    eq('...a row plays its song', rcall && rcall.data.media_content_id, 'u2');
    xl._items = [{ uri: 'u1', name: 'One', artist: 'A', key: 'k1' }];
    xl._render();
    ok('XL with one thing played: no rows, the right column says so', String(xl._root.innerHTML).indexOf('Nothing else yet') >= 0);
    window.hkMusic.setFocus('media_player.kitchen_homepod_ma');
    var el = document.createElement('button'), before = house.calls.length;
    mu._play(mu._items[0], el);
    var call = house.calls[before];
    eq('hk_frontend.music_play_media on the screen\'s player', call && [call.domain, call.service, call.data.player, call.data.media_content_id],
       ['hk_frontend', 'music_play_media', window.hkMusic.player(c), 'library://track/1']);
  });
},
function () {
  H.section('Music: Presets and One Playlist, read as the Music page reads its playlists');
  var pls = window.hkMusic.playlists();
  var all = Mx.playlistTiles(pls, null);
  eq('Presets: a tile for each playlist, a playlist with choices ONE tile (as the Music page\'s pill)',
     all.map(function (t) { return t.name; }), ['Favorites Mix', 'Christmas', 'Decades']);
  eq('...a plain one says Playlist, one with choices how many', [all[0].artist, all[2].artist], ['Playlist', '3 Playlists']);
  eq('...each plays by its key; the choices are the tile\'s', all.map(function (t) { return t.playlist || t.options.map(function (o) { return o.playlist; }).join(','); }),
     ['favorites_mix', 'christmas', 'decade_2020s,decade_2010s,decade_2000s']);
  eq('One Playlist: only its own choices', Mx.playlistTiles(pls, 'Decades').map(function (t) { return t.name; }), ['2020s', '2010s', '2000s']);
  eq('...a playlist the house lacks: nothing', Mx.playlistTiles(pls, 'Gone').length, 0);
  var G = window.hkGridCatalog;
  eq('the catalog hands the card its choice', [G.config({ card: 'music', size: 'L', opts: { show: 'playlist', playlist: 'Decades' } }, {}).show,
     G.config({ card: 'music', size: 'L', opts: { show: 'playlist', playlist: 'Decades' } }, {}).playlist], ['playlist', 'Decades']);
  eq('...Recently Played is none', ['show' in G.config({ card: 'music', size: 'L', opts: {} }, {}), 'show' in G.config({ card: 'music', size: 'L', opts: { show: 'recent' } }, {})], [false, false]);
  var P = customElements.get('hk-grid-panel-card'), el = new P();
  el._config = { panel: 'music', show: 'presets' };
  el.getAttribute = function (k) { return k === 'size' ? 'L' : null; };
  el.client = client();
  eq('the panel block hands it to the card', el._parts(), [{ cfg: { type: 'custom:hk-recent-music-card', show: 'presets' }, size: 'L' }]);
  // THE CARD: tiles, no ask of the library, a tap plays the playlist on this screen's speakers
  var mu = sized('hk-recent-music-card', 'L');
  mu._config = { type: 'custom:hk-recent-music-card', show: 'presets' };
  mu.client = client();
  var asks = house.ws.length;
  mu._render();
  // (2026-11-08: Large and Extra Large -- and Small -- lead with the last played; the playlists by when each last played, asked once)
  var lp = house.ws.slice(asks).filter(function (m) { return m.service_data && m.service_data.media_type === 'playlist'; });
  ok('Presets asks the library only for its playlists by last played', house.ws.length - asks <= 1 &&
     lp.every(function (m) { return m.service_data.order_by === 'last_played_desc'; }), JSON.stringify(house.ws.slice(asks)));
  var html = String(mu._root.innerHTML);
  eq('...the first playlist above, the rest in the grid', (html.match(/data-i="/g) || []).length, 3);
  ok('...labelled Playlists', html.indexOf('<span class="lab">Playlists</span>') >= 0, html.slice(0, 300));
  window.hkMusic.setFocus('media_player.kitchen_homepod_ma');
  var before = house.calls.length;
  mu._playList(all[1], document.createElement('button'));
  var call = house.calls[before];
  eq('a tap: hk_frontend.music_play on the screen\'s speaker', call && [call.domain, call.service, call.data.rooms, call.data.playlist],
     ['hk_frontend', 'music_play', [window.hkMusic.player(client())], 'christmas']);
  // a tap on Decades: the Music page's sheet of its choices, and the one picked plays
  var C = window.hkCards, was = C.chooseSheet, asked = null;
  C.chooseSheet = function (title, list, pick) { asked = [title, list.map(function (o) { return o.name; })]; pick(list[1]); };
  before = house.calls.length;
  try { mu._play(all[2], document.createElement('button')); } finally { C.chooseSheet = was; }
  eq('Decades: the sheet of its choices', asked, ['Decades', ['2020s', '2010s', '2000s']]);
  call = house.calls[before];
  eq('...the decade picked plays on the screen\'s speaker', call && [call.service, call.data.playlist], ['music_play', 'decade_2010s']);
  // SMALL: the cover is the block, play in its middle; WIDE and EXTRA LARGE scroll across, TALL and LARGE down
  var sm = sized('hk-recent-music-card', 'S');
  sm._config = { type: 'custom:hk-recent-music-card', show: 'presets' };
  sm.client = client();
  sm._render();
  var sh = String(sm._root.innerHTML);
  ok('Small: the cover behind it all, one play button, the name at its foot',
     sh.indexOf('class="bg"') >= 0 && (sh.match(/class="go"/g) || []).length === 1 && sh.indexOf('class="last"') < 0 && sh.indexOf('Favorites Mix') >= 0, sh.slice(0, 400));
  ['W', 'T', 'L', 'XL'].forEach(function (z) {
    var b = sized('hk-recent-music-card', z);
    b._config = { type: 'custom:hk-recent-music-card', show: 'presets' };
    b.client = client();
    b._render();
    var bh = String(b._root.innerHTML);
    // (XL, 2026-11-08: the last played above five across, its Play beside it)
    var across = z === 'W' || z === 'XL';
    if (z === 'XL') {
      // (XL, 2026-11-09 mockup 13: two columns -- the last played with Play and Browse, the rest as 56 px rows)
      eq('XL: two columns, the first playlist large, the rest as rows', [bh.indexOf('xl2') >= 0, bh.indexOf('class="cv ') < 0, (bh.match(/class="rw"/g) || []).length, bh.indexOf('class="br"') >= 0], [true, true, 2, true]);
      return;
    }
    eq(z + ': ' + (across ? 'across' : 'down') + ', every playlist in it', [bh.indexOf('class="cv ' + (across ? 'x' : 'y') + '"') >= 0,
       (bh.match(/data-i="/g) || []).length], [true, 3]);
  });
  // THE LAST PLAYED FIRST (2026-11-08, the owner): matched by the playlists' items, a choice of one its own tile
  var lpls = [{ name: 'Favorites', key: 'f', uris: ['library://playlist/1'] }, { name: 'Christmas', key: 'c', uris: ['library://playlist/2'] },
              { name: 'Decades', options: [{ name: '1990s', key: 'd90', uris: ['library://playlist/3'] }] }];
  var lt = Mx.playlistTiles(lpls, null), L0 = Mx.LASTPL.uris;
  try {
    Mx.LASTPL.uris = ['library://playlist/99', 'library://playlist/2', 'library://playlist/1'];
    eq('the last played the house has leads, the rest in their order', Mx.heroFirst(lt, lpls).map(function (t) { return t.name + '/' + t.artist; }),
       ['Christmas/Last Played', 'Favorites/Playlist', 'Decades/1 Playlists']);
    Mx.LASTPL.uris = ['library://playlist/3'];
    eq('...a choice of one: that choice, before them all', Mx.heroFirst(lt, lpls).map(function (t) { return t.name; }), ['1990s', 'Favorites', 'Christmas', 'Decades']);
    Mx.LASTPL.uris = ['library://playlist/99'];
    eq('...none of them played: as they are', Mx.heroFirst(lt, lpls).map(function (t) { return t.name; }), ['Favorites', 'Christmas', 'Decades']);
  } finally { Mx.LASTPL.uris = L0; }
  // WHEN TAPPED: the Music page by default; Choose a Playlist, the playlists' sheet, Decades asking which next
  eq('a tap on the plate: the Music page', sm._tapTarget()[0], { page: 'playmusic' });
  // ...its Plays On a preset: the speaker's sheet opens on the preset's first room, never on the preset
  sm._config = { type: 'custom:hk-recent-music-card', show: 'presets', speaker: 'media_player.downstairs_homepods_downstairs' };
  eq('a tap, Plays On a preset: the sheet of its first room', sm._tapTarget()[1], { sheet: 'media_player.kitchen_homepod_ma' });
  sm._config = { type: 'custom:hk-recent-music-card', show: 'presets', speaker: 'media_player.office_homepod_ma' };
  eq('...a room: its own sheet', sm._tapTarget()[1], { sheet: 'media_player.office_homepod_ma' });
  sm._config = { type: 'custom:hk-recent-music-card', show: 'presets', tap: 'playlists', speaker: 'media_player.kitchen_homepod_ma' };
  var D = window.hkDetail, opened = null, closed = 0, wasOpen = D && D.open, wasClose = D && D.close;
  window.hkDetail = Object.assign({}, D || {}, { open: function (id, src, opts) { opened = [id, src, opts]; return true; }, close: function () { closed++; } });
  try { sm._tapTarget()[0].run(); } finally { if (D) { D.open = wasOpen; D.close = wasClose; } }
  eq('Choose a Playlist: a detail sheet of the playlists\' covers, playing where the block plays',
     opened && [opened[1].name, opened[2].cards.cards[0].type, opened[2].cards.cards[0].speaker, opened[2].cards.width],
     ['Playlists', 'custom:hk-music-playlists-card', 'media_player.kitchen_homepod_ma', 'wide']);
  // THE SHEET'S CARD: every playlist a cover; Decades opens its choices in place, Back over them; a tap plays and the sheet goes
  var ps = sized('hk-music-playlists-card', null);
  ps._config = { type: 'custom:hk-music-playlists-card', speaker: 'media_player.kitchen_homepod_ma' };
  ps.client = client();
  ps._render();
  var pt = String(ps._root.innerHTML);
  eq('the sheet: a cover for each playlist, Decades one', (pt.match(/class="it"/g) || []).length, 3);
  ps._pick(ps._list[2], document.createElement('button'));
  ps._render();
  pt = String(ps._root.innerHTML);
  ok('...Decades: its choices, with Back', (pt.match(/class="it"/g) || []).length === 3 && pt.indexOf('data-back') >= 0 && pt.indexOf('2010s') >= 0, pt.slice(0, 300));
  before = house.calls.length;
  window.hkDetail = Object.assign({}, window.hkDetail || {}, { close: function () { closed++; } });
  var picked = ps._pick(ps._list[1], document.createElement('button'));
  call = house.calls[before];
  eq('...a decade picked plays where the block plays', call && [call.service, call.data.playlist, call.data.rooms], ['music_play', 'decade_2010s', ['media_player.kitchen_homepod_ma']]);
  ps._open = null;
  ps._render();
  eq('...Back: the playlists again', (String(ps._root.innerHTML).match(/data-back/g) || []).length, 0);
  var one = sized('hk-recent-music-card', 'W');
  one._config = { type: 'custom:hk-recent-music-card', show: 'playlist', playlist: 'Decades' };
  one.client = client();
  one._render();
  var oh = String(one._root.innerHTML);
  eq('One Playlist: its choices, labelled with its name', [(oh.match(/class="it"/g) || []).length, oh.indexOf('<span class="lab">Decades</span>') >= 0], [3, true]);
  return H.tick().then(function () { return picked; }).then(function (played) {
    eq('...and once it plays, the sheet goes', [played, closed], [true, 1]);
    if (D) window.hkDetail = D;
  });
},
function () {
  H.section('Music: a playlist\'s cover is the picture of what it is built with, the gradient and glyph otherwise');
  var covered = HK_HOUSE.playlists.map(function (p) { return JSON.parse(JSON.stringify(p)); });
  covered[0].image = '/ma/imageproxy/aa?size=256';                      // Favorites Mix
  covered[2].options[1].image = 'https://img.example/2010s.jpg';         // Decades: its 2010s only
  covered[2].image = covered[2].options[1].image;                        // (Mantel gives the pill its first choice's)
  window.hkMusic._configure(Object.assign({}, HK_HOUSE, { playlists: covered }));
  // (innerHTML does not parse in this harness: the covers the page would find are stood in, one button each)
  var stand = function (card, n) {
    card._root.querySelectorAll = function (sel) {
      if (sel !== '[data-i]') return [];
      return Array.from({ length: n }, function (_, i) {
        return { getAttribute: function () { return String(i); }, addEventListener: function () {}, classList: { add: function () {}, contains: function () { return false; } },
                 querySelector: function (q) { return q === '.cvr' ? { cover: i } : null; } };
      });
    };
  };
  try {
    var tiles = Mx.playlistTiles(window.hkMusic.playlists(), null);
    eq('the tiles carry the pill\'s picture, the choices theirs', [tiles[0].image, tiles[1].image, tiles[2].image, tiles[2].options.map(function (o) { return o.image; })],
       ['/ma/imageproxy/aa?size=256', null, 'https://img.example/2010s.jpg', [null, 'https://img.example/2010s.jpg', null]]);
    eq('One Playlist\'s choices: each its own', Mx.playlistTiles(window.hkMusic.playlists(), 'Decades').map(function (t) { return t.image; }),
       [null, 'https://img.example/2010s.jpg', null]);
    // THE BLOCK: every cover with a picture is drawn with it (its glyph kept for when it fails), the rest stay gradients
    var drawn = [], blk = sized('hk-recent-music-card', 'L');
    blk._config = { type: 'custom:hk-recent-music-card', show: 'presets' };
    blk.client = client();
    blk._artImage = function (url, box, icon, size) { drawn.push([url, /icon="hk:star-fill"/.test(icon) || /icon="hk:timer-sand"/.test(icon)]); };
    stand(blk, 3);
    blk._render();
    eq('the block draws the pictures it has, with the playlist\'s own glyph behind', drawn.slice().sort(), [['/ma/imageproxy/aa?size=256', true], ['https://img.example/2010s.jpg', true]].sort());
    var html = String(blk._root.innerHTML);
    ok('...the cover without one keeps its gradient and glyph', html.indexOf('hk:christmas-tree') >= 0 && html.indexOf('--c1:') >= 0, html.slice(0, 300));
    // THE SHEET: the same, and a choice opened in place shows its own (else the pill's)
    drawn = [];
    var sh = sized('hk-music-playlists-card', null);
    sh._config = { type: 'custom:hk-music-playlists-card' };
    sh.client = client();
    sh._artImage = function (url) { drawn.push(url); };
    stand(sh, 3);
    sh._render();
    eq('the playlists\' sheet draws them too', drawn, ['/ma/imageproxy/aa?size=256', 'https://img.example/2010s.jpg']);
    drawn = [];
    sh._open = 'Decades';
    stand(sh, 3);
    sh._render();
    eq('...a pill opened: its choices, each its own picture (none, the gradient)', drawn, ['https://img.example/2010s.jpg']);
  } finally { window.hkMusic._configure(HK_HOUSE); }
  eq('no pictures from the server: the plain tiles, as before', Mx.playlistTiles(window.hkMusic.playlists(), null).map(function (t) { return t.image; }), [null, null, null]);
},
function () {
  H.section('Live TV: the page\'s channels, a tile each, a tap plays it full screen');
  eq('S one, W two, T three, L four, XL six', ['S', 'W', 'T', 'L', 'XL'].map(function (s) { return Mx.TV_SLOTS[s]; }), [1, 2, 3, 4, 6]);
  eq('the tiles\' arrangement: W across, T down, L two by two (Extra Large is two columns, below)',
     [Mx.tvGrid('W', 2), Mx.tvGrid('T', 3), Mx.tvGrid('L', 4)], [[2, 1], [1, 3], [2, 2]]);
  var tv = sized('hk-tv-channels-card', 'W');
  tv.client = client();
  tv._render();
  var ask = house.ws[house.ws.length - 1];
  eq('asks hk_tv/channels, as the Live TV page does', ask.msg.type, 'hk_tv/channels');
  ask.resolve(CHANNELS);
  return H.tick().then(function () {
    tv._render();
    var plate = tv._root.children[0], tiles = plate.children[plate.children.length - 1].children;    // (the tiles' group is the plate's last child; Large and Extra Large have a label row before it)
    eq('Wide: the first two, in the page\'s order', tiles.length, 2);
    eq('...what is on, then the channel', [tiles[0].querySelector('b').textContent, tiles[0].querySelector('small').textContent], ['Evening News', 'Channel 4']);
    ok('...a bar of how far through, when the guide says', tv._bars.length === 1 && Math.abs(parseFloat(tv._bars[0].el.style.width) - 50) < 2);
    ok('...each in its own color', !!tiles[0].style['--c1'] && tiles[0].style['--c1'] !== tiles[1].style['--c1']);
    var opened = [];
    window.hkCameras = { tvPlayer: function (owner, ch) { opened.push([owner === tv, ch.number]); return { close: function () {}, update: function () {} }; } };
    tv.isConnected = true;          // (on the page: a block taken off it plays nothing)
    (tiles[1]._listeners.click || [])[0]({ stopPropagation: function () {} });
    eq('a tap opens that channel in the Live TV page\'s player', opened, [[true, '7.1']]);
    var xl = sized('hk-tv-channels-card', 'XL');
    xl.client = client(); xl._channels = CHANNELS.channels; xl._configured = true;
    xl._render();
    // EXTRA LARGE IN TWO COLUMNS (2026-11-09, mockup 13): the channel on at the left, the others as rows at the right
    var plateX = xl._root.children[0];
    eq('Extra Large: the first channel on the left, the rest as rows', [plateX.className, plateX.children[0].className, plateX.children[1].children[1].children.length], ['tv xl', 'lf', CHANNELS.channels.length - 1]);
    eq('...the left names the channel and its show', [plateX.children[0].querySelector('small').textContent, plateX.children[0].querySelector('b').textContent].join('|'), '4.1 \u00b7 Channel 4|Evening News');
    eq('...the right is headed Channels', plateX.children[1].children[0].children[0].textContent, 'Channels');
    var rows = plateX.children[1].children[1].children;
    eq('...a row: the show over the channel', [rows[0].querySelector('b').textContent, rows[0].querySelector('small').textContent], ['Coastal Kitchens', 'Food']);
    var xo = [];
    window.hkCameras = { tvPlayer: function (owner, ch) { xo.push(ch.number); return { close: function () {}, update: function () {} }; } };
    xl.isConnected = true;
    (plateX.children[0]._listeners.click || [])[0]({ stopPropagation: function () {} });
    (rows[0]._listeners.click || [])[0]({ stopPropagation: function () {} });
    eq('the left plays the one on; a row tunes its channel', xo, ['4.1', '7.1']);
    xl._render();
    eq('the last one played is the one on, after', xl._root.children[0].children[0].querySelector('small').textContent, '7.1 \u00b7 Food');
    var xc = sized('hk-tv-channels-card', 'XL');
    xc.client = client(); xc._channels = CHANNELS.channels; xc._configured = true; xc._config = { channel: '9.1' };
    xc._render();
    eq('a channel chosen is the one on, whatever was played', xc._root.children[0].children[0].querySelector('small').textContent.slice(0, 3), '9.1');
  });
},
function () {
  H.section('The panel block mounts them, sized');
  var P = customElements.get('hk-grid-panel-card');
  var at = function (kind, size) {
    var el = new P();
    el._config = { panel: kind };
    el.getAttribute = function (k) { return k === 'size' ? size : null; };
    el.client = client();
    return el._parts();
  };
  eq('Music: the Recently Played widget at the block\'s size', at('music', 'T'), [{ cfg: { type: 'custom:hk-recent-music-card' }, size: 'T' }]);
  eq('Live TV: the channels at the block\'s size', at('tv', 'XL'), [{ cfg: { type: 'custom:hk-tv-channels-card' }, size: 'XL' }]);
  ADDED = ['music'];
  eq('...none without Live TV added (the block says where to add it)', at('tv', 'XL'), null);
  ADDED = ['music', 'live_tv'];
}
]);
