// THE WALLPAPERS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase E): our own
// art (hk-wallpapers.js) -- the twelve settings.py names, each drawn from its
// family's colours with its four stops; the sky paints one as a still, its
// night version crossfading in (hk-sky.js paintWall); the screen's choice
// resolved as the other backgrounds are (hk-settings.js wallpaper()).
var pass = 0, fail = 0;
function check(label, c, got) { print((c ? 'PASS ' : 'FAIL ') + label + (c || got === undefined ? '' : '   got ' + JSON.stringify(got))); c ? pass++ : fail++; }
globalThis.window = globalThis; globalThis.location = { pathname: '/test', search: '' };
var LISTEN = {}; globalThis.addEventListener = function (t, f) { (LISTEN[t] = LISTEN[t] || []).push(f); };
globalThis.setInterval = function () { return 1; }; globalThis.clearInterval = function () {};
var timers = []; globalThis.setTimeout = function (f) { timers.push(f); return timers.length; }; globalThis.clearTimeout = function () {};
globalThis.getComputedStyle = function () { return { left: '0px', getPropertyValue: function () { return ''; } }; };
function node() {
  var n = { children: [], className: '', values: {}, clientWidth: 1280, clientHeight: 800 };
  n.style = { setProperty: function (k, v) { n.values[k] = v; }, getPropertyValue: function (k) { return n.values[k] || ''; },
              removeProperty: function (k) { delete n.values[k]; } };
  n.classList = { contains: function (k) { return n.className.split(' ').indexOf(k) >= 0; },
                  add: function (k) { if (!this.contains(k)) n.className = (n.className + ' ' + k).trim(); },
                  remove: function (k) { n.className = n.className.split(' ').filter(function (c) { return c !== k; }).join(' '); },
                  toggle: function (k, on) { if (on) this.add(k); else this.remove(k); } };
  n.appendChild = function (c) { c.parentNode = n; n.children.push(c); return c; };
  n.insertBefore = function (c, b) { c.parentNode = n; var i = b ? n.children.indexOf(b) : -1; n.children.splice(i < 0 ? n.children.length : i, 0, c); return c; };
  n.querySelectorAll = function (sel) {
    var out = [], want = sel.slice(1);
    (function walk(a) { a.children.forEach(function (c) { if (c.className.split(' ').indexOf(want) >= 0) out.push(c); walk(c); }); })(n);
    return out;
  };
  n.querySelector = function (sel) { return n.querySelectorAll(sel)[0] || null; };
  Object.defineProperty(n, 'nextSibling', { get: function () { var p = n.parentNode; return p ? p.children[p.children.indexOf(n) + 1] || null : null; } });
  return n;
}
globalThis.document = { createElement: node, readyState: 'complete', head: node(), body: node(), addEventListener: function () {},
                        querySelector: function () { return null; }, querySelectorAll: function () { return []; }, getElementById: function () { return null; } };

load(HK_ROOT + '/frontend/modules/hk-wallpapers.js');
var W = window.hkWallpapers;
var py = read(HK_ROOT + '/hk_core/settings/model.py');
var m = /\nWALLPAPERS = \(([\s\S]*?)\)\n/.exec(py);
var ids = m ? (m[1].match(/"([a-z_]+)"/g) || []).map(function (s) { return s.slice(1, -1); }) : [];
check('the twelve, in settings.py WALLPAPERS\' order', ids.length === 12 && JSON.stringify(W.list().map(function (w) { return w.id; })) === JSON.stringify(ids), ids);
check('...the default is settings.py\'s', /"wallpaper": "ribbons_rose"/.test(py) && W.DEFAULT === 'ribbons_rose');
var fam = {}, shapes = {};
W.list().forEach(function (w) { (fam[w.family] = fam[w.family] || []).push(w.shape); shapes[w.shape] = 1; });
check('six families, two shapes each; four shapes', Object.keys(fam).length === 6 && Object.keys(fam).every(function (f) { return fam[f].length === 2 && fam[f][0] !== fam[f][1]; }) &&
      Object.keys(shapes).sort().join() === 'petals,pinwheel,ribbons,shards', fam);
check('...named as you would say them', W.list()[0].name === 'Rose Ribbons' && W.list()[11].name === 'Graphite Pinwheel');
check('every family has five colours by day and by night, the night darker', Object.keys(W.FAMILIES).every(function (f) {
  var F = W.FAMILIES[f], L = function (c) { var n = parseInt(c.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255); };
  return F.day.length === 5 && F.night.length === 5 && L(F.night[3]) < L(F.day[3]) + 1;
}));
check('each has four stops by day and by night, a Color backdrop\'s shape', W.list().every(function (w) {
  var s = W.stops(w.id); return s.day.length === 4 && s.night.length === 4 && s.day.concat(s.night).every(function (c) { return /^#[0-9a-f]{6}$/.test(c); });
}));
var a = W.svg('shards_blue', false, 'p1'), b = W.svg('shards_blue', true, 'p2');
check('the art is an SVG cut to the screen (slice), its ids kept apart', /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice"/.test(a) &&
      /id="p1_a"/.test(a) && /id="p2_a"/.test(b) && !/p1_/.test(b));
check('...the night version its own colours, with a few still stars', a !== b && /<circle/.test(b) && !/<circle/.test(a) &&
      b.indexOf(W.colors('shards_blue', true)[0]) >= 0 && a.indexOf(W.colors('shards_blue', false)[0]) >= 0);
check('...as an address a background takes, made once', /^data:image\/svg\+xml;charset=utf-8,%3Csvg/.test(W.url('petals_amber')) && W.url('petals_amber') === W.url('petals_amber') &&
      W.url('petals_amber', true) !== W.url('petals_amber'));
check('an unknown one is the default', W.stops('nope').day[0] === W.stops('ribbons_rose').day[0] && !W.has('nope') && W.has('shards_graphite'));
var big = W.list().reduce(function (n, w) { return Math.max(n, W.svg(w.id, false).length, W.svg(w.id, true).length); }, 0);
check('each drawing stays small (under 6 kB of SVG, made once on the page), and what ships is the builders (under 20 kB)',
      big < 6000 && read(HK_ROOT + '/frontend/modules/hk-wallpapers.js').length < 20000, big);

// THE SKY PAINTS ONE (hk-sky.js paintWall)
load(HK_ROOT + '/frontend/modules/hk-sky.js');
var sky = node(), art = node(); art.className = 'art'; sky.appendChild(node()).className = 'grad'; sky.appendChild(art); sky.appendChild(node()).className = 'scrim';
hkSky._paintWall(sky, null, false);
check('no wallpaper: nothing made, nothing said', !sky.querySelectorAll('.wall').length && !sky.values['--wall']);
hkSky._paintWall(sky, { id: 'ribbons_rose' }, false);
var layers = sky.querySelectorAll('.wall');
check('a wallpaper: two layers over the album\'s, under the scrim; one shown, the picture its day version', layers.length === 2 &&
      sky.children.indexOf(layers[0]) === 2 && sky.children.indexOf(layers[1]) === 3 && sky.children[4].className === 'scrim' &&
      layers.filter(function (l) { return l.classList.contains('on'); }).length === 1 &&
      layers.filter(function (l) { return l.classList.contains('on'); })[0].style.backgroundImage === 'url("' + W.url('ribbons_rose', false) + '")');
check('...no grain over it; the sky says which it shows (a change the glass hears)', sky.values['--grainO'] === '0' && sky.values['--wall'] === '"ribbons_rose:day"');
var shown = layers.filter(function (l) { return l.classList.contains('on'); })[0];
hkSky._paintWall(sky, { id: 'ribbons_rose' }, false);
check('painted again with nothing new: untouched', shown.classList.contains('on') && sky.querySelectorAll('.wall').length === 2);
hkSky._paintWall(sky, { id: 'ribbons_rose' }, true);
var now = layers.filter(function (l) { return l.classList.contains('on'); })[0];
check('sunset: the night version fades in on the other layer as the day one fades out', now !== shown && !shown.classList.contains('on') &&
      now.style.backgroundImage === 'url("' + W.url('ribbons_rose', true) + '")' && shown.style.backgroundImage !== '');
timers.splice(0).forEach(function (f) { f(); });
check('...and the day picture is let go once it has gone', shown.style.backgroundImage === '' && now.style.backgroundImage !== '');
hkSky._paintWall(sky, null, false);
timers.splice(0).forEach(function (f) { f(); });
check('another background: the wallpaper fades out and its pictures go', !layers.some(function (l) { return l.classList.contains('on') || l.style.backgroundImage; }) &&
      sky.values['--wall'] === 'none');
var src = read(HK_ROOT + '/frontend/modules/hk-sky.js');
check('the layers fade as the stops do (4 s), and stay off the sky\'s animations (a still: the static sky)',
      /#hk-sky \.wall\{position:absolute;inset:0;background-size:cover;background-position:center;',\s*'  opacity:0;transition:opacity 4s linear\}/.test(src) &&
      /else if \(bg && bg\.mode === 'wallpaper'\) \{ wall = bg\.wallpaper; still = bg\.stops \|\| black; \}/.test(src) &&
      /paintWall\(mounted, opts\.photo \? null : opts\.wall \|\| null, wn\)/.test(src));
check('...its night version after sunset, or always, or never (its Night Version)',
      /var wn = opts\.wall \? \(opts\.wall\.night === 'auto' \? !up : opts\.wall\.night === 'night'\) : !up;/.test(src));
check('the loader brings it in, before the sky, on both products\' pages', /'hk-wallpapers\.js',\s*'hk-sky\.js'/.test(read(HK_ROOT + '/frontend/modules/hk-loader.js')));

print(fail ? 'FAIL ' + fail + ' WALLPAPER TESTS' : 'ALL ' + pass + ' WALLPAPER TESTS PASS');
if (fail) throw new Error('wallpaper tests failed');
