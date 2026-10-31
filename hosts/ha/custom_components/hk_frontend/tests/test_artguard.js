// NEVER THE BROKEN-IMAGE "?" -- the art guard in hk-base.js (the owner's item 46).
//
// What is held here: an <img> that opts in (data-ph) and cannot load shows the
// last good picture, else the placeholder (the note, or the initial on a
// color), as an SVG/data URL so the node stays an image; a failed address is
// not asked for again for 30 s, so a re-render keeps the fallback; the kept
// copies are capped and trimmed least-recently-used, through the snapshot
// cache; an unavailable player (no picture) is not an <img> at all.
var DIR = HK_ROOT + '/tests/';
load(DIR + 'dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');

var pass = 0, fail = 0;
function ok(n, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + n); }
  else { fail++; print('  FAIL  ' + n + '\n          got  ' + String(g).slice(0, 200) + '\n          want ' + String(w).slice(0, 200)); }
}
var H = window.hkCards, SC = H.snapCache;
function reset() {
  localStorage.clear();
  SC._reset();
  globalThis.__canvasCalls = [];
  globalThis.__canvasTaints = false;
  __resetTimers();
  Object.keys(H.art.bad).forEach(function (k) { delete H.art.bad[k]; });
}
// an <img> as the browser would hand it to the capture listener
function img(src, extra) {
  var i = document.createElement('img');
  i.setAttribute('src', src);
  Object.keys(extra || {}).forEach(function (k) { i.setAttribute(k, extra[k]); });
  return i;
}
function fire(root, type, target) { (root._listeners[type] || []).forEach(function (f) { f({ target: target }); }); }
function isData(s) { return /^data:/.test(String(s)); }
function svgOf(s) { return decodeURIComponent(String(s).replace(/^data:image\/svg\+xml,/, '')); }

print('=== the markup ===');
reset();
var m = H.artImg('/api/media/x/art?v=1', { cls: 'art', ph: 'note' });
ok('an opted-in <img> with the address and its class',
   [/data-ph="note"/.test(m), /class="art"/.test(m), /src="\/api\/media\/x\/art\?v=1"/.test(m)], [true, true, true]);
var av = H.artImg('/p.jpg', { ph: 'av', ini: 'B', color: '#ff9500' });
ok('a face carries its initial and color', [/data-initials="B"/.test(av), /data-color="#ff9500"/.test(av)], [true, true]);
ok('an address with quotes cannot end the attribute', /src="a&quot;b"/.test(H.artImg('a"b', {})), true);

print('\n=== the guard ===');
reset();
var root = document.createElement('div');
H.artGuard(root); H.artGuard(root);
ok('installed once however often it is asked', [(root._listeners.error || []).length, (root._listeners.load || []).length], [1, 1]);
var plain = img('/x.png');
fire(root, 'error', plain);
ok('an <img> that did not opt in is left alone', plain.getAttribute('src'), '/x.png');

var art = img('/api/media/a/art?v=1', { 'data-ph': 'note' });
fire(root, 'error', art);
var s1 = art.getAttribute('src');
ok('a failed cover becomes an image, not the "?"', isData(s1), true);
ok('the placeholder is the music note', /<path/.test(svgOf(s1)), true);
ok('the failed address is remembered', typeof H.art.bad['/api/media/a/art?v=1'], 'number');
fire(root, 'error', art);
ok('the fallback failing too is not a loop', art.getAttribute('src'), s1);

var face = img('/p/sam.jpg', { 'data-ph': 'av', 'data-initials': 'B', 'data-color': '#34c759' });
fire(root, 'error', face);
var sv = svgOf(face.getAttribute('src'));
ok('a failed face is the initial on the person\'s color', [/>B</.test(sv), /#34c759/.test(sv)], [true, true]);
var noColor = img('/p/x.jpg', { 'data-ph': 'av', 'data-initials': 'K' });
fire(root, 'error', noColor);
ok('with no color given it still draws one', /fill="#[0-9a-f]{6}"/.test(svgOf(noColor.getAttribute('src'))), true);

print('\n=== a re-render keeps the fallback, and tries again after 30 s ===');
ok('artSrc: the failed address gives the fallback', H.artSrc('/api/media/a/art?v=1', { ph: 'note' }), s1);
ok('the markup built now has the same fallback', H.artImg('/api/media/a/art?v=1', { ph: 'note' }).indexOf(encodeURIComponent('<svg').slice(0, 3)) > 0, true);
ok('an address never seen is its own', H.artSrc('/other.jpg', { ph: 'note' }), '/other.jpg');
H.art.bad['/api/media/a/art?v=1'] = Date.now() - H.art.BAD_MS - 1;
ok('after 30 s it is asked for again', H.artSrc('/api/media/a/art?v=1', { ph: 'note' }), '/api/media/a/art?v=1');

print('\n=== the last good picture ===');
reset();
var g1 = img('/api/media/b/art?v=1', { 'data-ph': 'note' });
g1.naturalWidth = 600; g1.naturalHeight = 600;
fire(root, 'load', g1);
var keys = SC.keys('art:');
ok('a cover is kept under its own address, version included', keys, ['art:/api/media/b/art?v=1']);
ok('160 wide', globalThis.__canvasCalls[0], { w: 160, h: 160 });
// TRACK A LOADED, TRACK B FAILS: the note, never A's cover (the lead's rule)
var broken = img('/api/media/b/art?v=2', { 'data-ph': 'note' });
fire(root, 'error', broken);
ok('track B failing is the note, not track A\'s cover', /^data:image\/svg/.test(broken.getAttribute('src')), true);
ok('...and so does a re-render', /^data:image\/svg/.test(H.artSrc('/api/media/b/art?v=2', { ph: 'note' })), true);
var again = img('/api/media/b/art?v=1', { 'data-ph': 'note' });
fire(root, 'error', again);
ok('the SAME picture failing later is its own kept copy', /^data:image\/jpeg/.test(again.getAttribute('src')), true);
// a face is the same face whatever the query
var f1 = img('/p/sam.jpg?t=1', { 'data-ph': 'av', 'data-initials': 'S' });
f1.naturalWidth = 200; f1.naturalHeight = 200;
fire(root, 'load', f1);
var f2 = img('/p/sam.jpg?t=2', { 'data-ph': 'av', 'data-initials': 'S' });
fire(root, 'error', f2);
ok('a face failing under a new query keeps the last good face', /^data:image\/jpeg/.test(f2.getAttribute('src')), true);
var nokept = img('/api/media/c/art?v=1', { 'data-ph': 'note' });
fire(root, 'error', nokept);
ok('with nothing kept for it, the placeholder', /^data:image\/svg/.test(nokept.getAttribute('src')), true);
var skip = img('data:image/svg+xml,x', { 'data-ph': 'note' });
skip.naturalWidth = 64; skip.naturalHeight = 64;
globalThis.__canvasCalls = [];
fire(root, 'load', skip);
ok('a data: picture is never kept', globalThis.__canvasCalls.length, 0);
var zero = img('/z.jpg', { 'data-ph': 'note' });
fire(root, 'load', zero);
ok('a load with no size is not kept', SC.keys('art:').indexOf('art:/z.jpg'), -1);

print('\n=== the cap, least recently used out ===');
reset();
for (var i = 0; i < H.art.KEEP + 6; i++) {
  var im = img('/a/' + i + '.jpg', { 'data-ph': 'note' });
  im.naturalWidth = 300; im.naturalHeight = 300;
  fire(root, 'load', im);
  H.art.kept('/a/0.jpg');                     // 0 is in use all along: it must outlive 1
}
var left = SC.keys('art:');
ok('never more than the cap', left.length, H.art.KEEP);
ok('the one used again stayed; the untouched oldest went', [left.indexOf('art:/a/0.jpg') >= 0, left.indexOf('art:/a/1.jpg') >= 0], [true, false]);
ok('the newest stayed', left.indexOf('art:/a/' + (H.art.KEEP + 5) + '.jpg') >= 0, true);

print('\n=== it survives a reload ===');
SC._flush();
var saved = JSON.parse(localStorage.getItem('hk-snap-v1') || '{}');
ok('written through to the snapshot cache\'s storage', Object.keys(saved).filter(function (k) { return k.indexOf('art:') === 0; }).length, H.art.KEEP);
SC._reset();
ok('and read back as a kept copy', /^data:image\//.test(H.art.kept('/a/' + (H.art.KEEP + 5) + '.jpg')), true);

print('\n=== a tainted canvas or no storage does not take the page down ===');
reset();
globalThis.__canvasTaints = true;
var t1 = img('/t.jpg', { 'data-ph': 'note' });
t1.naturalWidth = 300; t1.naturalHeight = 300;
fire(root, 'load', t1);
var t2 = img('/t.jpg?v=2', { 'data-ph': 'note' });
fire(root, 'error', t2);
ok('a copy that cannot be read back falls to the placeholder', /^data:image\/svg/.test(t2.getAttribute('src')), true);
globalThis.__canvasTaints = false;

print('\n=== an unavailable player: no picture, no <img> ===');
// Music Assistant away more than 60 s: the player is `unavailable` with no
// entity_picture. The Now Playing block draws its own note for that.
load(HK_ROOT + '/frontend/cards/hk-media.js');
var NP = customElements.get('hk-now-playing-card');
ok('the Now Playing card exists', !!NP, true);
var np = Object.create(NP.prototype);
ok('no picture for an unavailable player', np._art({ state: 'unavailable', attributes: {} }), '');
ok('...nor for none at all', np._art(null), '');
ok('a picture the player has is the address to draw', np._art({ state: 'playing', attributes: { entity_picture_local: 'http://h/a.jpg' } }), 'http://h/a.jpg');

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL ' + pass + ' ART GUARD TESTS PASS'));
