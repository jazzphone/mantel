// THE MEDIA BLOCKS AS WIDGETS (2026-10-31, the Home Grid blocks mock-up the
// owner approved): Now Playing's sizes (a new Small, the volume under the
// transport on Wide, Tall and Large, Speakers and Browse either side), the
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
  eq('Wide: the volume under the transport', [!!at('W').sub_card, (at('W').meta_card || {}).parts], [false, ['volume']]);
  eq('Tall: the progress, then the volume', [(at('T').sub_card || {}).parts, (at('T').meta_card || {}).parts], [['progress'], ['volume']]);
  eq('Large: as before, progress and volume', [(at('L').sub_card || {}).parts, (at('L').meta_card || {}).parts], [['progress'], ['volume']]);
  ok('...each following the screen\'s music', at('W').meta_card.entity_from && at('W').meta_card.entity_from.music === true);
},
function () {
  H.section('Now Playing: the sizes\' layouts');
  var css = customElements.get('hk-now-playing-card').CSS;
  ok('Small: the cover and Speakers on top, back / play / next along the foot',
     css.indexOf('"art art . . spk" "title title title title title" "artist artist artist artist artist" ". . . . ." "prev . play . next"') >= 0);
  ok('...on a tile cell the artist goes and the cover takes the height left', /@container hk-cell \(max-height:179px\)\{:host\(\[size=S\]\)[^}]*--np-art[^}]*\}:host\(\[size=S\]\) \.np \.artist\{display:none\}/.test(css));
  ok('Wide: Speakers and Browse at the transport\'s ends, the volume under it',
     css.indexOf('"art spk prev play next brw" "art meta meta meta meta meta"') >= 0);
  ok('...five 44 px controls beside the cover (the cover gives way)', css.indexOf("' - 236px)") < 0 && /--np-art:min\(\(100cqh[^;]*- 236px\)/.test(css));
  ok('Tall: the label, the song, the progress, the transport with Speakers and Browse, the volume',
     css.indexOf('"lab lab lab lab lab" "title title title title title" "artist artist artist artist artist" ". . . . ." "sub sub sub sub sub" "prev . play . next" "spk meta meta meta brw"') >= 0 &&
     css.indexOf('--hk-np-cols:44px minmax(0,1fr) 44px minmax(0,1fr) 44px;') >= 0);
  ok('...the transport up off the foot: the bottom inset 6 px more', /:host\(\[size=T\]\) hk-plate\.np\{--hk-np-pad:[^;]*calc\(var\(--hk-pad-b,20px\) \+ 6px\)/.test(css));
  ok('...no longer Speakers and Browse in the top corners', css.indexOf('position:absolute;top:12px;width:32px') < 0);
  ok('Large: the label over the song, the volume under the transport',
     css.indexOf('"art art lab lab lab"') >= 0 && css.indexOf('"spk prev play next brw" "meta meta meta meta meta"') >= 0);
  ok('the volume a 44 px place on W, T and L', css.indexOf(':host([size=W]) .np .meta,:host([size=T]) .np .meta,:host([size=L]) .np .meta{display:flex;align-items:center;gap:10px;padding:0;--hk-range-h:44px}') >= 0);
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
    var spk = np._root.querySelector('.spk');
    (spk._listeners.click || [])[0]();
  });
  eq('Small: Volume (no slider of its own); Wide: Speakers', turned, ['S:volume', 'W:speakers']);
  var np = sized('hk-now-playing-card', 'T');
  hkGive(np, house.hass());
  window.hkMusic.setFocus('media_player.kitchen_homepod_ma');
  np._render();
  eq('the label says what the music is doing', np._root.querySelector('.lab').textContent, 'Now Playing');
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
  var many = []; for (var i = 0; i < 30; i++) many.push({ uri: 'library://track/' + i, name: 'T' + i });
  eq('at most the last and twelve', Mx.recentCovers(many).length, 13);
  eq('the covers each size shows: W four, T six, L eight, XL twelve (and the last above L\'s and XL\'s)',
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
  eq('Presets: a tile for each playlist, a playlist with choices standing for each choice',
     all.map(function (t) { return t.name; }), ['Favorites Mix', 'Christmas', '2020s', '2010s', '2000s']);
  eq('...a choice names its playlist, a plain one says Playlist', [all[0].artist, all[2].artist], ['Playlist', 'Decades']);
  eq('...each plays by its key', all.map(function (t) { return t.playlist; }), ['favorites_mix', 'christmas', 'decade_2020s', 'decade_2010s', 'decade_2000s']);
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
  eq('Presets asks the library for nothing', house.ws.length, asks);
  var html = String(mu._root.innerHTML);
  eq('...the first playlist above, the rest in the grid', (html.match(/data-i="/g) || []).length, 5);
  ok('...labelled Playlists', html.indexOf('<span class="lab">Playlists</span>') >= 0, html.slice(0, 300));
  window.hkMusic.setFocus('media_player.kitchen_homepod_ma');
  var before = house.calls.length;
  mu._playList(all[1], document.createElement('button'));
  var call = house.calls[before];
  eq('a tap: hk_frontend.music_play on the screen\'s speaker', call && [call.domain, call.service, call.data.rooms, call.data.playlist],
     ['hk_frontend', 'music_play', [window.hkMusic.player(client())], 'christmas']);
  var one = sized('hk-recent-music-card', 'W');
  one._config = { type: 'custom:hk-recent-music-card', show: 'playlist', playlist: 'Decades' };
  one.client = client();
  one._render();
  var oh = String(one._root.innerHTML);
  eq('One Playlist: its choices, labelled with its name', [(oh.match(/class="it"/g) || []).length, oh.indexOf('<span class="lab">Decades</span>') >= 0], [3, true]);
},
function () {
  H.section('Live TV: the page\'s channels, a tile each, a tap plays it full screen');
  eq('S one, W two, T three, L four, XL six', ['S', 'W', 'T', 'L', 'XL'].map(function (s) { return Mx.TV_SLOTS[s]; }), [1, 2, 3, 4, 6]);
  eq('the tiles\' arrangement: W across, T down, L two by two, XL three by two',
     [Mx.tvGrid('W', 2), Mx.tvGrid('T', 3), Mx.tvGrid('L', 4), Mx.tvGrid('XL', 6), Mx.tvGrid('XL', 3)], [[2, 1], [1, 3], [2, 2], [3, 2], [3, 1]]);
  var tv = sized('hk-tv-channels-card', 'W');
  tv.client = client();
  tv._render();
  var ask = house.ws[house.ws.length - 1];
  eq('asks hk_tv/channels, as the Live TV page does', ask.msg.type, 'hk_tv/channels');
  ask.resolve(CHANNELS);
  return H.tick().then(function () {
    tv._render();
    var plate = tv._root.children[0], tiles = plate.children;
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
    eq('fewer channels than places: as many tiles as channels', xl._root.children[0].children.length, 3);
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
