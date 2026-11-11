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
  n.removeChild = function (c) { n.children.splice(n.children.indexOf(c), 1); c.parentNode = null; return c; };
  Object.defineProperty(n, 'firstChild', { get: function () { return n.children[0] || null; } });
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
var py = readPyPackage(HK_ROOT + '/hk_core/settings/model');
// (2026-11-01, item 45: one combined picker -- four arts and six themes, each in a colour; the twelve as an art in a preset)
var ma = /\nWALLPAPER_ARTS = \(([\s\S]*?)\)\n/.exec(py), mt = /\nWALLPAPER_THEMES = \(([\s\S]*?)\)\n/.exec(py);
var tuple = function (x) { return x ? (x[1].match(/"([a-z_]+)"/g) || []).map(function (s) { return s.slice(1, -1); }) : []; };
var ids = tuple(ma).concat(tuple(mt));
check('the four arts and the six themes, in settings.py WALLPAPERS\' order', /\nWALLPAPERS = WALLPAPER_ARTS \+ WALLPAPER_THEMES\n/.test(py) &&
      ids.length === 10 && JSON.stringify(W.list().map(function (w) { return w.id; })) === JSON.stringify(ids), ids);
check('...the default is settings.py\'s: Ribbons, in Rose when nothing is stored', /"wallpaper": "ribbons",/.test(py) && /"wallpaper_color": "rose",/.test(py) &&
      W.DEFAULT === 'ribbons' && /return "ribbons", "rose"/.test(py));
var mlg = /\nWALLPAPER_LEGACY = \{([\s\S]*?)\n\}\n/.exec(py), pyOld = [];
if (mlg) mlg[1].replace(/"([a-z_]+)": \("([a-z]+)", "([a-z]+)"\)/g, function (_, id, art, col) { pyOld.push([id, art, col]); });
check('the twelve as stored before: settings.py WALLPAPER_LEGACY, in its order', pyOld.length === 12 && JSON.stringify(pyOld) === JSON.stringify(W.LEGACY), pyOld);
check('...each read as its art in its own preset, whatever colour is asked', W.LEGACY.every(function (l) {
  var r = W.resolve(l[0], '#123456'); return r.id === l[1] && r.hex === W.color(l[2]) && W.has(l[0]) && !W.isTheme(l[0]);
}));
check('the arts named as you would say them; they move only with the Motion, the themes by themselves', W.list().slice(0, 4).map(function (w) { return w.name; }).join() ===
  'Ribbons,Petals,Shards,Pinwheel' &&
      W.list().every(function (w) { return w.moves === w.theme; }));
check('every family has five colours by day and by night, the night darker', Object.keys(W.FAMILIES).every(function (f) {
  var F = W.FAMILIES[f], L = function (c) { var n = parseInt(c.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255); };
  return F.day.length === 5 && F.night.length === 5 && L(F.night[3]) < L(F.day[3]) + 1;
}));
// TODAY'S CHOICES KEEP THEIR LOOK: each of the twelve pairs is its tuned family, exactly; any other pair the rule
check('each of the twelve (an art in the preset it was drawn in): that family\'s own shades -- they draw as before', W.LEGACY.every(function (l) {
  return W.colors(l[1], false, l[2]).join() === W.FAMILIES[l[2]].day.join() && W.colors(l[1], true, l[2]).join() === W.FAMILIES[l[2]].night.join() &&
    W.svg(l[0], false, 'x') === W.svg(l[1], false, 'x', l[2]);
}) && W.colors('ribbons', false, 'amber').join() !== W.FAMILIES.amber.day.join());
// ...and their stops as the old tables had them (measured off the same art: within 2 of 255)
var BEFORE = { ribbons_rose: ['#8a1f74', '#973681', '#46125e', '#42115e'], petals_violet: ['#211a5e', '#3c3283', '#524999', '#584fa1'],
  shards_blue: ['#3e5780', '#38588b', '#2d528b', '#315790'], pinwheel_teal: ['#1a4f49', '#1a4e48', '#1b4944', '#153e39'],
  petals_amber: ['#3d1b07', '#613515', '#7b4a1f', '#844f20'], shards_graphite: ['#53575e', '#52565e', '#4b5059', '#515761'] };
var near = function (a, b) { return [1, 3, 5].every(function (j) { return Math.abs(parseInt(a.slice(j, j + 2), 16) - parseInt(b.slice(j, j + 2), 16)) <= 2; }); };
check('...their stops as they were', Object.keys(BEFORE).every(function (id) { return W.stops(id).day.every(function (c, i) { return near(c, BEFORE[id][i]); }); }),
      Object.keys(BEFORE).map(function (id) { return W.stops(id).day; }));
// ANY OTHER COLOUR: five shades of its hue at the arts' luminances, darkest first, the night darker
var Y = function (c) { var f = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }, n = parseInt(c.slice(1), 16);
  return 0.2126 * f(n >> 16) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
var arts = ['#ff0000', '#ffee00', '#ffffff', 'green', 'coral'].map(function (c) { return [W.colors('ribbons', false, c), W.colors('ribbons', true, c)]; });
check('an art in any other colour: five shades at the arts\' luminances, the night darker', arts.every(function (s) {
  return s[0].every(function (c, i) { return Math.abs(Y(c) - W.ART_RAMP.day[i]) < 0.004 && Y(s[1][i]) < Y(c); });
}), arts);
check('...in the colour\'s hue: a red\'s are red, white\'s grey', /^#[0-9a-f]{2}0[0-9a-f]0[0-9a-f]$/.test(arts[0][0][1]) &&
      arts[2][0].every(function (c) { return c.slice(1, 3) === c.slice(3, 5) && c.slice(3, 5) === c.slice(5, 7); }), arts[0][0]);
check('each has four stops by day and by night in any colour, a Color backdrop\'s shape', W.list().every(function (w) {
  return ['rose', '#ff8800', '#000000'].every(function (c) {
    var s = W.stops(w.id, c); return s.day.length === 4 && s.night.length === 4 && s.day.concat(s.night).every(function (x) { return /^#[0-9a-f]{6}$/.test(x); });
  });
}) && W.stops('ribbons', 'coral').day.join() !== W.stops('ribbons', 'green').day.join());
var a = W.svg('shards', false, 'p1', 'blue'), b = W.svg('shards', true, 'p2', 'blue');
check('the art is an SVG cut to the screen (slice), its ids kept apart', /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice"/.test(a) &&
      /id="p1_a"/.test(a) && /id="p2_a"/.test(b) && !/p1_/.test(b));
check('...the night version its own colours, with a few still stars', a !== b && /<circle/.test(b) && !/<circle/.test(a) &&
      b.indexOf(W.colors('shards', true, 'blue')[0]) >= 0 && a.indexOf(W.colors('shards', false, 'blue')[0]) >= 0);
check('...as an address a background takes, made once per colour; an old id the same picture as its art in its preset',
      /^data:image\/svg\+xml;charset=utf-8,%3Csvg/.test(W.url('petals', false, 'amber')) && W.url('petals', false, 'amber') === W.url('petals_amber') &&
      W.url('petals', true, 'amber') !== W.url('petals', false, 'amber') && W.url('petals', false, 'green') !== W.url('petals', false, 'amber'));
check('an unknown one is the default art', W.stops('nope', 'rose').day[0] === W.stops('ribbons', 'rose').day[0] && !W.has('nope') && W.has('shards_graphite') && W.has('shards'));
var big = W.list().filter(function (w) { return !w.theme; }).reduce(function (n, w) { return Math.max(n, W.svg(w.id, false).length, W.svg(w.id, true).length); }, 0);
var bigT = W.list().filter(function (w) { return w.theme; }).reduce(function (n, w) { return Math.max(n, W.svg(w.id, false).length, W.svg(w.id, true).length); }, 0);
check('each drawing stays small (under 6 kB of SVG, a theme\'s still frame under 20 kB -- the aurora\'s rays -- made once on the page), ' +
      'and what ships is the builders (under 44 kB before minifying)',
      big < 6000 && bigT < 20000 && read(HK_ROOT + '/frontend/modules/hk-wallpapers.js').length < 44000, [big, bigT, read(HK_ROOT + '/frontend/modules/hk-wallpapers.js').length]);

// THE MOTION THEMES (2026-10-31): six, each in one colour of the owner's
var themes = W.list().filter(function (w) { return w.theme; });
check('six themes, each named, no family; known as themes', themes.map(function (w) { return w.name; }).join() === 'Aurora,Blobs,Waves,Dot Field,Light Beams,Meteors' &&
      themes.every(function (w) { return w.shape === 'theme' && !w.family && W.isTheme(w.id) && W.has(w.id); }) && !W.isTheme('ribbons_rose') && !W.isTheme('ribbons') && !W.isTheme('toString'));
var mc = /\nWALLPAPER_COLORS = \(([\s\S]*?)\n\)\n/.exec(py), pyCols = [];
if (mc) mc[1].replace(/\{"id": "([a-z]+)", "label": "([A-Za-z ]+)", "hex": "(#[0-9a-f]{6})"\}/g, function (_, id, label, hex) { pyCols.push([id, label, hex]); });
check('the presets are settings.py WALLPAPER_COLORS, in its order; the default its default', pyCols.length === 8 && JSON.stringify(pyCols) === JSON.stringify(W.COLORS) &&
      W.COLOR_DEFAULT === 'blue' && /w, wallpaper_color\(c\) or "blue"/.test(py), pyCols);
check('a colour: a preset\'s, your own (lower case), else the default\'s', W.color('teal') === '#14b8a6' && W.color('#A1B2C3') === '#a1b2c3' &&
      W.color('plaid') === '#2f7bf6' && W.color(null) === '#2f7bf6' && W.color('#abc') === '#2f7bf6');
var Y = function (c) { var f = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }, n = parseInt(c.slice(1), 16);
  return 0.2126 * f(n >> 16) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); };
var shades = ['#ff0000', '#ffff00', '#ffffff', '#000000', '#14b8a6'].map(function (c) { return [W.colors('waves', false, c), W.colors('waves', true, c)]; });
check('any colour\'s shades: five, darkest first, at set luminances -- a white, a black, a yellow the same as a blue -- the night darker',
      shades.every(function (s) { return s[0].length === 5 && s[0].every(function (c, i) { return i === 0 || Y(c) > Y(s[0][i - 1]); }) &&
        s[0].every(function (c, i) { return Math.abs(Y(c) - Y(shades[4][0][i])) < 0.004 && Y(s[1][i]) < Y(c); }); }), shades);
check('...in the colour\'s own hue: a red\'s are red, white\'s and black\'s grey', /^#[0-9a-f]{2}0[0-4]0[0-4]$/.test(shades[0][0][2]) &&
      shades[2][0].join() === shades[3][0].join() && shades[2][0].every(function (c) { return c.slice(1, 3) === c.slice(3, 5) && c.slice(3, 5) === c.slice(5, 7); }), shades[0][0]);
check('...a partner turned round the wheel where a theme draws one (Aurora: ten shades, Blobs fifteen)',
      W.colors('aurora', false, 'rose').length === 10 && W.colors('blobs', false, 'rose').length === 15 && W.colors('aurora', false, 'rose')[7] !== W.colors('aurora', false, 'rose')[2]);
check('a theme\'s stops: four by day and by night, from its colour', themes.every(function (w) {
  var a = W.stops(w.id, 'rose'), b = W.stops(w.id, 'teal');
  return a.day.length === 4 && a.night.length === 4 && a.day.concat(a.night).every(function (c) { return /^#[0-9a-f]{6}$/.test(c); }) && a.day.join() !== b.day.join();
}));
check('...every theme has its measured weights, one per shade and band', themes.every(function (w) {
  var M = W._weights[w.id], K = W.colors(w.id, false).length;
  return M && M.w.length === 4 && M.w.every(function (r) { return r.length === K; }) && M.c.day.length === 4 && M.c.night.length === 4;
}));
var f1 = W.svg('waves', false, 't1', 'rose'), f2 = W.svg('waves', true, 't2', 'teal');
check('its still frame: a 1000 x 700 picture cut to the screen, in its colour, its ids kept apart',
      /viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice"/.test(f1) && f1.indexOf(W.colors('waves', false, 'rose')[3]) >= 0 &&
      f2.indexOf(W.colors('waves', true, 'teal')[3]) >= 0 && /id="t1_/.test(f1) && !/t1_/.test(f2));
check('...its address made once per colour and version', W.url('waves', false, 'rose') === W.url('waves', false, 'rose') &&
      W.url('waves', false, 'rose') !== W.url('waves', false, 'teal') && W.url('waves', false, 'teal') !== W.url('waves', true, 'teal') &&
      W.url('waves', false, 'blue') === W.url('waves', false, '#2F7BF6'));
var sc = W.scene('aurora', false, 'violet');
check('ON THE SCREEN: a ground and its layers, each a picture in a box (or a tile) with how it moves; made once per colour and version',
      sc === W.scene('aurora', false, '#7a5cff') && sc !== W.scene('aurora', true, 'violet') && /^data:image\/svg\+xml/.test(sc.ground) && sc.layers.length === 2 &&
      sc.layers.every(function (L) { return /^data:image\/svg\+xml/.test(L.url) && L.box.length === 4 && L.mv.an === 'sway' && /^[a-f]$/.test(L.d); }) &&
      W.scene('dots', false).layers.some(function (L) { return L.tile === 30 && !L.box && L.mv.an === 'tile'; }) && W.scene('ribbons_rose', false) === null);
check('...every layer moves by one of the sky\'s four keyframes, at one of its six lengths', themes.every(function (w) {
  return W.scene(w.id, false).layers.every(function (L) { return ['sway', 'loop', 'tile', 'meteor'].indexOf(L.mv.an) >= 0 && /^[a-f]$/.test(L.d); });
}));
check('...a few layers each, no filter and no blend mode in any picture', themes.every(function (w) {
  var s = W.scene(w.id, true, 'amber'), all = decodeURIComponent(s.ground) + s.layers.map(function (L) { return decodeURIComponent(L.url); }).join('');
  return s.layers.length <= 5 && !/<filter|feGaussian|mix-blend|blur\(/.test(all);
}));

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
check('...no grain over it; the sky says which it shows (a change the glass hears)', sky.values['--grainO'] === '0' && sky.values['--wall'] === '"ribbons@' + W.color('rose') + ':day"');
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
// A MOTION THEME ON THE SCREEN (paintWall's wallScene)
hkSky._paintWall(sky, { id: 'waves', color: 'rose' }, false);
var tl = layers.filter(function (l) { return l.classList.contains('on'); })[0], wsc = W.scene('waves', false, 'rose');
check('a theme: its ground on the layer, its own layers inside it, each its picture in its box with how it moves',
      tl && tl.classList.contains('th') && tl.style.backgroundImage === 'url("' + wsc.ground + '")' && tl.children.length === 3 &&
      tl.children.every(function (i, n) { return i.style.backgroundImage === 'url("' + wsc.layers[n].url + '")' && i.className === 'sway' &&
        i.style.left === wsc.layers[n].box[0] + '%' && i.values['--an'] === 'hk-wt-sway' && /^var\(--w[a-f]\)$/.test(i.values['--ad']); }) &&
      sky.values['--wall'] === '"waves@' + W.color('rose') + ':day"');
hkSky._paintWall(sky, { id: 'waves', color: 'rose' }, false);
check('...painted again with nothing new: untouched', tl.classList.contains('on') && tl.children.length === 3);
hkSky._paintWall(sky, { id: 'waves', color: 'teal' }, false);
var tl2 = layers.filter(function (l) { return l.classList.contains('on'); })[0];
check('...another colour: it crossfades to the other layer, drawn in the new one', tl2 !== tl && tl2.style.backgroundImage === 'url("' + W.scene('waves', false, 'teal').ground + '")');
timers.splice(0).forEach(function (f) { f(); });
check('...and the old one\'s layers go once it has faded', tl.children.length === 0 && tl.style.backgroundImage === '' && tl2.children.length === 3);
hkSky._paintWall(sky, { id: 'dots', color: 'blue' }, false);
var dl = layers.filter(function (l) { return l.classList.contains('on'); })[0], tile = dl.children.filter(function (i) { return i.className === 'tile'; })[0];
check('the dot field\'s tile overhangs one tile, moves one tile', tile && tile.style.left === '-30px' && tile.style.top === '-30px' && tile.values['--tile'] === '30px' &&
      tile.style.backgroundSize === '30px 30px');
hkSky._paintWall(sky, { id: 'ribbons_rose' }, false);
timers.splice(0).forEach(function (f) { f(); });
var back = layers.filter(function (l) { return l.classList.contains('on'); })[0];
check('back to a drawn one: no theme left on its layer', !back.classList.contains('th') && back.children.length === 0 &&
      !layers.some(function (l) { return l.children.length; }));
hkSky._paintWall(sky, null, false);
timers.splice(0).forEach(function (f) { f(); });
var src = read(HK_ROOT + '/frontend/modules/hk-sky.js');
check('a theme\'s layers move only while its Motion is on (data-wm), transform and opacity only; the ground stands still',
      /'#hk-sky\[data-wm\] \.wall\.th\{inset:0;will-change:auto;animation:none\}'/.test(src) &&
      /'#hk-sky\[data-wm\] \.wall\.th>i\{will-change:transform,opacity;animation:var\(--an\)/.test(src) &&
      (src.match(/@keyframes (hk-wt-[a-z]+|hk-meteor-wt)\{[^']*/g) || []).length === 4 &&
      (src.match(/@keyframes (hk-wt-[a-z]+|hk-meteor-wt)\{[^']*/g) || []).every(function (k) { return !/(left|top|width|height|margin|background|filter)\s*:/.test(k); }));
check('...the rules are hkWallpapers.motionCss\'s for the sky, written out (the screensaver\'s clock takes the same)',
      W.motionCss('#hk-sky .wall.th>i', '#hk-sky[data-wm] .wall.th>i', 'hk-wt-').split('\n').every(function (r) { return src.indexOf("'" + r + "'") >= 0; }));
check('...a meteor is a mover a Pre-rendered blur leaves out; Reduce Motion stops all', hkSky.moves({ animationName: 'hk-wt-meteor' }) &&
      /@media \(prefers-reduced-motion:reduce\)\{#hk-sky \*\{animation:none!important\}\}/.test(src));
check('the layers fade as the stops do (4 s), and stay off the sky\'s animations (a still: the static sky)',
      /#hk-sky \.wall\{position:absolute;inset:0;background-size:cover;background-position:center;',\s*'  opacity:0;transition:opacity 4s linear\}/.test(src) &&
      /else if \(bg && bg\.mode === 'wallpaper'\) \{ wall = bg\.wallpaper; still = bg\.stops \|\| black; \}/.test(src) &&
      /paintWall\(ST\.mounted, opts\.photo \? null : opts\.wall \|\| null, wn\)/.test(src));   // (ST.mounted: hk-sky.js's shared state, tools/split_js.py --state)
check('...its night version after sunset, or always, or never (its Night Version)',
      /var wn = opts\.wall \? \(opts\.wall\.night === 'auto' \? !up : opts\.wall\.night === 'night'\) : !up;/.test(src));
check('the loader brings it in, before the sky, on both products\' pages', /'hk-wallpapers\.js',\s*'hk-sky\.js'/.test(read(HK_ROOT + '/frontend/modules/hk-loader.js')));

print(fail ? 'FAIL ' + fail + ' WALLPAPER TESTS' : 'ALL ' + pass + ' WALLPAPER TESTS PASS');
if (fail) throw new Error('wallpaper tests failed');
