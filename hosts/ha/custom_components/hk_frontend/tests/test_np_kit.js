// THE NOW PLAYING BLOCK, DRAWN FROM THE KIT (round 12, 2026-11-23; web/hk/media/hk-media-npkit.js, -npsheet.js). The layout is a pure function
// of what the block shows and the block's size, so every number the owner's mockup fixed is read from its markup: the cover's size at each
// size, the keys (Wide and Tall only Play / Pause and Next), the volume's row and its track exactly as wide as the progress bar's, the
// capsule's left edge on the words', Extra Large's Up Next. A fictional house: nothing here names a real one.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run np_kit');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';
globalThis.history = { pushState: function () {} };
window.hkSettings = { version: 1, get: function (path, fb) { return path === 'added' ? ['music'] : fb; }, tablet: function () { return null; } };
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/tests/music_house.js');
load(HK_ROOT + '/frontend/modules/hk-kit.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');

var ok = H.ok, eq = H.eq, NP = window.hkNpKit, KT = window.hkKit;
// a block's measures as hkKit.ctx gives them (the tests have no layout): w x h, the insets and the concentric corner
function kx(w, h) { return { w: w, h: h, E: h < 180 && w < 220 ? 10 : 13, X: 18, R: 34, r: h < 180 && w < 220 ? 24 : 21, sq: h >= 180, short: h < 180, light: false, white: false }; }
var SIZE = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
var TILE = { S: [196, 150], W: [405, 150], T: [196, 313], L: [405, 313], XL: [614, 313] };
function song(size, o) {
  return Object.assign({ size: size, song: true, playing: true, live: false, title: 'Blue in Green', artist: 'The Fictional Trio', album: 'Kind of Fictional', cover: '', rooms: ['Living Room'],
    roomKey: 'media_player.living_room', pos: 128, dur: 337, since: 1000, vol: 0.42,
      queue: [{ id: 'q1', title: 'Late Train Home', artist: 'The Fictional Trio', image: '' }, { id: 'q2', title: 'Paper Lanterns' },
      { id: 'q3', title: 'Slow Tide' }, { id: 'q4', title: 'Back Porch' }, { id: 'q5', title: 'City at Dusk' }], lists: [] }, o || {});
}
var html = function (size, shapes, o) { var dd = (shapes || SIZE)[size]; return NP.layout(song(size, o), kx(dd[0], dd[1])); };
// a part's box: left, top, width, height out of its inline style
function box(h, find) {
  var m = new RegExp('<[^>]*' + find + '[^>]*style="([^"]*)"').exec(h);
  if (!m) return null;
  var g = function (n) { var x = new RegExp('(?:^|;)' + n + ':(-?[\\d.]+)px').exec(m[1]); return x ? Number(x[1]) : null; };
  return { x: g('left'), y: g('top'), w: g('width'), h: g('height') };
}
var count = function (h, re) { return (h.match(re) || []).length; };

H.run('NOW PLAYING KIT', [
function () {
  H.section('the kit and its parts are in');
  ok('the layout, the tone and the sheet\'s element', !!NP && typeof NP.layout === 'function' && typeof NP.toneOf === 'function' && !!customElements.get('hk-music-sheet'));
},
function () {
  H.section('Small: the cover centered, the song and artist under it; no volume, no keys');
  var h = html('S'), c = box(h, 'data-np="cover"');
  eq('the cover is 80 and centered', [c.w, c.x], [80, 58]);
  ok('...the song and the artist centered under it', /text-align:center[^>]*>Blue in Green/.test(h) && /text-align:center[^>]*>The Fictional Trio/.test(h));
  ok('...no volume, no progress, no key', !/data-np="vol"/.test(h) && !/data-np="prog"/.test(h) && count(h, /class="key/g) === 0);
  ok('...on the cover\'s own dark surface', /class="kit mu"/.test(h) && /data-hk-role="card"/.test(h));
},
function () {
  H.section('Wide: the room under the cover, the volume, and only Play / Pause and Next');
  var h = html('W'), c = box(h, 'data-np="cover"'), r = box(h, 'data-np="room"'), v = box(h, 'data-np="vol"');
  eq('the cover is 128 on the 13 edge', [c.w, c.x, c.y], [128, 13, 13]);
  ok('the room is a row under the cover (its tap), centered on it', r.y > c.y + c.h - 4 && Math.abs((r.x + r.w / 2) - (c.x + c.w / 2)) < 1, [r, c]);
  ok('the volume: a row 50 tall, the whole row its touch', v.h === 50 && /role="slider"/.test(h) && /data-hk-control/.test(h), v);
  eq('Play / Pause and Next, no Previous', [count(h, /class="key/g), /aria-label="Previous"/.test(h), /aria-label="Next"/.test(h), /aria-label="Pause"/.test(h)], [2, false, true, true]);
  ok('the song and artist beside the cover', box(h, 'data-np="vol"').x > c.x + c.w);
},
function () {
  H.section('Tall: the cover on the axis, the progress with times, the volume as wide as it, two keys');
  var h = html('T'), c = box(h, 'data-np="cover"'), p = box(h, 'data-np="prog"'), v = box(h, 'data-np="vol"');
  eq('the cover is 150, centered', [c.w, c.x], [150, 23]);
  eq('the volume\'s row is as wide as the progress bar, on the 18 inset', [v.w, v.x, p.w, p.x], [160, 18, 160, 18]);
  ok('...46 tall, a touch', v.h >= 46);
  eq('Play / Pause and Next', [count(h, /class="key/g), /aria-label="Previous"/.test(h)], [2, false]);
  ok('the times: the elapsed and what is left', /class="kl num e"/.test(h) && /class="kl num r"/.test(h));
},
function () {
  H.section('Large: the capsule on the cover\'s top edge on the words\' left edge; the progress 24 under the cover');
  var h = html('L'), c = box(h, 'data-np="cover"'), pill = /<button[^>]*class="npr pill"[^>]*style="([^"]*)"/.exec(h), title = box(h, 'class="a kd"'),
    album = (function () { var m = /class="a kb" style="([^"]*top:([\d.]+)px[^"]*color:var\(--hk-ink-3\))/.exec(h); return m ? { y: Number(m[2]) } : null; })();
  var pl = Number(/left:([\d.]+)px/.exec(pill[1])[1]), pt = Number(/top:([\d.]+)px/.exec(pill[1])[1]);
  eq('the cover is 156', [c.w, c.h], [156, 156]);
  eq('the capsule is on the cover\'s top edge, 38 tall', [pt, /height:38px/.test(pill[1])], [13, true]);
  eq('...its LEFT EDGE exactly on the title\'s (the owner: it "should align with the text")', pl, title.x);
  eq('the song, artist and album end on the cover\'s bottom edge (the album line sits 24 above it)', [title.y, album.y], [c.y + c.h - 74, c.y + c.h - 24]);
  var p = box(h, 'data-np="prog"'), v = box(h, 'data-np="vol"');
  eq('the progress is 24 under the cover', p.y - (c.y + c.h), 24);
  eq('the volume as wide as the progress bar, 64 tall', [v.w, v.x, v.h], [p.w, p.x, 64]);
  eq('Previous, Play / Pause, Next', [count(h, /class="key/g), /aria-label="Previous"/.test(h)], [3, true]);
  ok('no Up Next on Large', !/Up Next/.test(h));
},
function () {
  H.section('Extra Large: Large in the left 405, Up Next (four covers, each plays) and a Queue key');
  var h = html('XL'), l = html('L'), p = box(h, 'data-np="prog"'), pl = box(l, 'data-np="prog"');
  eq('the left is Large\'s (the progress as wide)', p.w, pl.w);
  ok('Up Next, the next four covers', /Up Next/.test(h) && count(h, /data-np="upnext"/g) === 4 && /data-qid="q1"/.test(h) && !/data-qid="q5"/.test(h));
  ok('a Queue key at the foot opens the queue', /data-np="queue"/.test(h) && />Queue</.test(h));
  var ups = h.match(/data-np="upnext"[^>]*style="([^"]*)"/g).map(function (s) { return /width:([\d.]+)px/.exec(s)[1]; });
  ok('the covers are square and as large as the column lets them be', ups.every(function (x) { return x === ups[0]; }) && Number(ups[0]) > 80, ups);
},
function () {
  H.section('a tile cell (150 high): what does not fit as a full target goes -- the volume first');
  eq('Wide: no volume, the keys kept', [/data-np="vol"/.test(html('W', TILE)), count(html('W', TILE), /class="key/g)], [false, 2]);
  eq('Tall: no volume, the progress kept', [/data-np="vol"/.test(html('T', TILE)), /data-np="prog"/.test(html('T', TILE))], [false, true]);
  var l = html('L', TILE), c = box(l, 'data-np="cover"'), v = box(l, 'data-np="vol"');
  ok('Large: the volume stays, the cover a size smaller', !!v && c.w < 156 && c.w >= 72 && v.h === 46, [c, v]);
  ok('...nothing under the keys', v.y + v.h <= 313 - 13 - 64);
  ok('Small: the cover a step down', box(html('S', TILE), 'data-np="cover"').w === 52);
},
function () {
  H.section('nothing playing: the same plate, an empty cover, no times; Extra Large offers the playlists');
  var h = NP.layout(song('L', { song: false, playing: false, title: 'Nothing Playing', artist: '', album: '', dur: 0, pos: 0 }), kx(405, 405));
  ok('the title says so, the cover is the note, the times are dashes', /Nothing Playing/.test(h) && /--:--/.test(h) && !/<img/.test(h));
  var x = NP.layout(song('XL', { song: false, playing: false, title: 'Nothing Playing', artist: '', album: '', dur: 0, queue: [], lists: [{ name: 'Focus', pi: 0 }, { name: 'Dinner Party', pi: 1 }] }),
    kx(614, 405));
  ok('Extra Large: Playlists in Up Next\'s place, Browse in the Queue key\'s', /Playlists/.test(x) && count(x, /data-np="plist"/g) === 2 && /data-np="browse"/.test(x) && !/data-np="queue"/.test(x));
},
function () {
  H.section('the progress: counting by itself while it plays and Motion allows; held otherwise');
  var live = html('L', null, { live: true }), held = html('L', null, { live: false });
  ok('playing: the elapsed counts from where the track began, what is left to where it ends', /<hk-countdown class="kl num e" since="1000" total="337"/.test(live) &&
    /deadline="338000" total="337"/.test(live));
  ok('...held: the elapsed is text, what is left a held countdown', /<span class="kl num e">2:08<\/span>/.test(held) && /hold="209" total="337"/.test(held));
  eq('the same state draws the same markup (a quiet update draws nothing again)', html('L', null, { live: true }), live);
},
function () {
  H.section('the plate\'s color: a deep tint of the cover\'s');
  var t = NP.toneOf(58, 124, 134);
  ok('a blue-green cover: its hue, three lightnesses top to foot', /^hsl\(18\d,\d+%,38%\)$/.test(t.a) && /,22%\)$/.test(t.b) && /,11%\)$/.test(t.c), t);
  ok('a gray cover: a graphite, not a hue', /^hsl\(220,6%,38%\)$/.test(NP.toneOf(120, 120, 120).a), NP.toneOf(120, 120, 120));
  ok('a vivid cover is held to a saturation white words can sit on', Number(/,(\d+)%,/.exec(NP.toneOf(255, 0, 0).a)[1]) <= 55);
},
function () {
  H.section('the card: a Home Grid block draws the kit; the cover opens the sheet');
  var house = H.house({ 'media_player.kitchen_homepod_ma': ['playing', { friendly_name: 'Kitchen HomePod', media_title: 'Paper Lanterns', media_artist: 'June Avenue', media_album_name: 'Dusk',
    volume_level: 0.3, media_duration: 200, media_position: 50 }] });
  var np = H.make('hk-now-playing-card');
  np.setConfig({ type: 'custom:hk-now-playing-card' });
  np.setAttribute('size', 'W');
  np.getAttribute = function (k) { return this.attrs[k]; };
  np.hasAttribute = function (k) { return k in this.attrs; };
  hkGive(np, house.hass());
  window.hkMusic.setFocus('media_player.kitchen_homepod_ma');
  np._render();
  ok('the block is the kit\'s (the card\'s root holds the cover\'s own plate)', /class="kit mu"/.test(np._root.innerHTML) && /data-np="cover"/.test(np._root.innerHTML));
  var opened = [], turned = [];
  window.hkDetail = { open: function (id, src, o) { opened.push([id, o.panel.tag, o.panel.config.tab]); return true; } };
  np._turn = function (t) { turned.push(t); };
  np._npAct('cover');
  np._npAct('room');
  eq('the cover opens the sheet on Queue; the room on Speakers', opened, [[null, 'hk-music-sheet', 'queue'], [null, 'hk-music-sheet', 'speakers']]);
  window.hkDetail = null;
  np._npAct('cover');
  eq('with no detail sheet to open it in, the older turn-over', turned, ['queue']);
  var sent = [];
  np._call = function (d, s, data) { sent.push([d, s, data]); return Promise.resolve(true); };
  np._svc = function (c) { sent.push(c); };
  np._npAct('pp'); np._npAct('next'); np._npAct('prev');
  eq('the keys send the transport', sent, ['play_pause', 'next', 'previous']);
  sent.length = 0;
  np._npSetVol(0.5);
  ok('a level goes to the speaker, and is held on screen until it says so', sent.length === 1 && sent[0][1] === 'volume_set' && sent[0][2].volume_level === 0.5 && np._npHold && np._npHold.v === 0.5,
    sent);
  var bar = H.make('hk-now-playing-card');
  bar.setConfig({ type: 'custom:hk-now-playing-card', bar: true });
  ok('the docked bar (no size) keeps its own drawing', bar._renderKit() === false);
}
]);
