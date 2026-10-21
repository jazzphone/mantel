// THE SCREENSAVER'S HOME ENERGY AND WEATHER KEEP THEIR LAYERS (2026-10-19):
// on the wall tablets both flickered as they came in and went. Measured
// headless at 1920 x 1200 and 2560 x 1600 (Chrome's LayerTree, a local Mantel
// with invented data): every turn made compositing layers and dropped them
// again -- the weather's layer and its whole sky (70 layers) let go once it
// had faded out and made again as it came back, Home Energy's with its photo
// canvas, the corner cards' as the screens faded over them, the leader lines'
// and their neighbours' as they drew, the symbol's as it was drawn anew; and
// moving one screen's layer under the other's rebuilt it. On a tablet's
// WebView each change is a re-raster of what sits above (hk-saver.js .ph:
// the photos' flicker, fixed the same way 2026-09-30). The rule these hold
// them to: a turn changes opacity, never which layers exist.
// The geometry is the browser's; this suite holds the rules that keep it.
if (typeof HK_ROOT === 'undefined') throw new Error('Run through tests/run');
load(HK_ROOT + '/tests/dom.js');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

// THE SHIM, a little further: innerHTML is kept (and its writes counted), the
// layer's own <style> readable; '.enbg' is a canvas; querySelectorAll gives
// two stable stubs that record their animations
// (dom.js's innerHTML cannot be redefined: each element gets its own)
function keepHtml(e) {
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return this.__html || ''; },
    set: function (v) { this.__html = String(v); this.__writes = (this.__writes || 0) + 1; this.children = []; }
  });
  return e;
}
var baseCreate = document.createElement;
document.createElement = function (t) { return keepHtml(baseCreate.call(document, t)); };
var baseQ = El.prototype.querySelector;
El.prototype.querySelector = function (sel) {
  this.__q = this.__q || {};
  if (sel === '.enbg' && !this.__q[sel]) { var c = document.createElement('canvas'); c.parentNode = this; this.__q[sel] = c; }
  return this.__q[sel] || keepHtml(baseQ.call(this, sel));
};
var animations = [];
El.prototype.querySelectorAll = function (sel) {
  this.__qa = this.__qa || {};
  if (!this.__qa[sel]) {
    this.__qa[sel] = [0, 1].map(function () {
      var e = new El('stub');
      e.animate = function (frames) { animations.push({ sel: sel, frames: frames }); return {}; };
      return e;
    });
  }
  return this.__qa[sel];
};
Object.defineProperty(El.prototype, 'childNodes', { get: function () { return this.children; } });
El.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
globalThis.getComputedStyle = function () { return { fontWeight: '400', fontSize: '10px', fontFamily: 'x', letterSpacing: '0' }; };
window.innerWidth = 1920; window.innerHeight = 1200;

// the Live Sky's scene, recorded: when it is set to the weather
var sceneLog = [];
window.hkSky = { scene: function () {
  return { update: function () { sceneLog.push('update'); return {}; }, pause: function (on) { sceneLog.push(on ? 'held' : 'run'); },
           destroy: function () {} };
} };
var weatherState = { state: 'partlycloudy', attributes: { temperature: 18, wind_speed: 9, wind_bearing: 200 } };
window.hkSettings = { get: function (k, d) { return k === 'weather.entity' ? 'weather.proof' : d; },
                      weatherId: function () { return 'weather.proof'; } };
var client = { states: { 'weather.proof': weatherState } };

load(HK_ROOT + '/frontend/modules/hk-saver-energy.js');
load(HK_ROOT + '/frontend/modules/hk-saver-weather.js');

function rule(css, sel) {
  var i = css.indexOf(sel + '{');
  return i < 0 ? null : css.slice(i + sel.length + 1, css.indexOf('}', i));
}
function cssOf(el) { var m = /<style>([\s\S]*?)<\/style>/.exec(el.innerHTML); return m ? m[1] : ''; }

print('\n=== the layers themselves: one each, for good, hidden by opacity alone ===');
var en = window.hkSaverEnergy.create({}), wx = window.hkSaverWeather.create({});
[['.en', cssOf(en.el)], ['.wx', cssOf(wx.el)]].forEach(function (p) {
  var base = rule(p[1], p[0]), shown = rule(p[1], p[0] + '.on');
  ok(p[0] + ': its own layer for good (will-change: opacity)', !!base && /will-change:opacity/.test(base), base);
  ok(p[0] + ': hidden by its opacity, never visibility (which let go of every layer in it)',
     !!base && !/visibility/.test(base) && !!shown && !/visibility/.test(shown), [base, shown]);
  ok(p[0] + ': only its opacity is faded', !!base && /transition:opacity var\(--hk-[a-z]+-fade,3000ms\) ease[;}]?/.test(base) &&
     !/,visibility/.test(base), base);
});
var bgRule = rule(cssOf(en.el), '.en .enbg');
ok('Home Energy: the photo\'s copy is always there (its opacity, not display:none, follows the look)',
   !!bgRule && /display:block/.test(bgRule) && /opacity:0/.test(bgRule) && /opacity:1/.test(rule(cssOf(en.el), '.en[look=photo] .enbg') || ''), bgRule);
var cv = en.el.querySelector('.enbg');
ok('...drawn into from the start, at the size the saver paints it (96 wide, the screen\'s shape): no new layer at the first turn',
   cv.width === 96 && cv.height === Math.round(96 * 1200 / 1920), [cv.width, cv.height]);

print('\n=== what draws as a screen arrives: painted, not the compositor\'s ===');
[['.en .st .ln', cssOf(en.el)], ['.wx .wxin .st .ln', cssOf(wx.el)]].forEach(function (p) {
  var r = rule(p[1], p[0]);
  ok(p[0] + ': drawn out by its background, not a transform', !!r && !/transform-origin/.test(r) && /background-repeat:no-repeat/.test(r), r);
});

print('\n=== Weather: drawn once, unseen, and kept ===');
wx.layout(1920, 1200);
var body = wx.el.querySelector('.wxin').querySelector('.wxbody');
ok('ready: a weather to show', wx.ready(client) === true);
ok('...its sky set to the weather as it is built, held still (not as the screen first comes in)',
   sceneLog.join() === 'update,held', sceneLog);
ok('...and its words and symbol drawn unseen', body.__writes === 1, body.__writes);
wx.ready(client);
ok('...asked again: not drawn again, its sky not set again', body.__writes === 1 && sceneLog.join() === 'update,held,held', [body.__writes, sceneLog]);
sceneLog.length = 0;
ok('the turn: drawn', wx.draw(client) === true);
ok('...what was drawn stays (the symbol and the number not new elements, their layers kept)', body.__writes === 1, body.__writes);
ok('...the lines held at nothing, to draw as it arrives', wx.el.querySelector('.wxin').querySelectorAll('.st .ln')[0].style.backgroundSize === '0% 100%');
animations.length = 0;
wx.arrived();
var lines = animations.filter(function (a) { return a.sel === '.st .ln'; });
ok('...arrived: the lines draw by their background\'s size, never a transform',
   lines.length === 2 && lines.every(function (a) { return a.frames[0].backgroundSize === '0% 100%' && a.frames[1].backgroundSize === '100% 100%' && !('transform' in a.frames[0]); }), lines);
var marks = animations.filter(function (a) { return a.sel === '.bar b'; });
ok('...and the bar\'s marker comes in by its colors, not its opacity (which made it a layer at every Weather turn)',
   marks.length === 2 && marks.every(function (a) { return a.frames.every(function (f) { return 'backgroundColor' in f && !('opacity' in f); }); }), marks);
wx.leave();
weatherState.attributes.temperature = 21;
wx.draw(client);
ok('...the weather changed: drawn again', body.__writes === 2, body.__writes);
wx.leave();
wx.setHide(['wind']);
wx.draw(client);
ok('...Weather Options changed: drawn again', body.__writes === 3, body.__writes);
wx.destroy();

print('\n=== Home Energy: its rings\' white dots ===');
// (the summary hk-energy.js would give; enough for the ring and its dot)
window.hkEnergy = {
  summary: function () {
    return { asOf: Date.now(), receivedAt: Date.now(), hasFives: false, contributor: null, today0: 0,
      rings: [{ key: 'energy', name: 'Energy', c: '#30d158', v: 12, typ: 20, tick: 0.5, unit: 'kWh' }], typ: { energy: 20 },
      today: { energy: 12, cost: 0, water: 0, gas: 0, solar: 0 }, usualByNow: 10, yday: 0.5,
      month: { energy: 300, cost: 0, water: 0, gas: 0, solar: 0 }, monthName: 'October', projCost: null, hasCost: false,
      power: 1200, battery: null, money: function (v) { return '$' + v; } };
  },
  ringSvg: function () { return '<svg class="rings"></svg>'; },
  sweepRings: function () { return null; },
  fx: function (v, d) { return Number(v).toFixed(d); }, kwh: function (v) { return Number(v).toFixed(1); }, watts: function (v) { return String(v); }
};
window.hkStats = { tz: function () { return undefined; } };
en.layout(1920, 1200);
ok('ready and drawn', en.ready(client) === true && en.draw(client, 'photo', function () {}) === true);
animations.length = 0;
en.arrived();
var ticks = animations.filter(function (a) { return a.sel === 'svg.rings .tick'; });
var elines = animations.filter(function (a) { return a.sel === '.st .ln'; });
ok('...arrived: the white dots come in by their fill, not their opacity (which gave the rings a layer while it ran)',
   ticks.length === 2 && ticks.every(function (a) { return a.frames.every(function (f) { return 'fillOpacity' in f && !('opacity' in f); }); }), ticks);
ok('...and the lines by their background\'s size', elines.length === 2 &&
   elines.every(function (a) { return a.frames[1].backgroundSize === '100% 100%' && !('transform' in a.frames[0]); }), elines);
en.destroy();

print('\n=== hk-saver.js: the corner clock, and where the two screens sit ===');
var src = read(HK_ROOT + '/frontend/modules/hk-saver.js');
ok('the corner clock keeps a layer for good, as the weather line and what plays do',
   /'\.info > hk-clock-card\{transition:opacity ' \+ CROSSFADE_MS \+ 'ms ease;will-change:opacity\}'/.test(src));
ok('Home Energy\'s layer is put in at the start, as the weather\'s (not at its first turn)',
   /enCtl = X\.create\([^)]*\);\s*root\.insertBefore\(enCtl\.el, root\.querySelector\('\.info'\)\);/.test(src));
ok('...and neither is moved for the other between it and the corner cards',
   /if \(!underCards\(enCtl\.el, info\)\) root\.insertBefore\(enCtl\.el, info\);/.test(src) &&
   /if \(!underCards\(wxCtl\.el, info\)\) root\.insertBefore\(wxCtl\.el, info\);/.test(src));
// underCards itself, run: the function's own text, on a stand-in root
var m = /function underCards\(el, info\) \{[\s\S]*?\n  \}\n/.exec(src);
ok('underCards is there', !!m);
if (m) {
  var root = new El('div');
  var underCards = new Function('root', m[0] + '; return underCards;')(root);
  function node(cls) { var e = new El('div'); e.className = cls; return e; }
  function chain(list) {
    root.children = list;
    list.forEach(function (e, i) { e.parentNode = root; e.nextSibling = list[i + 1] || null; });
  }
  var E = node('en'), X = node('wx'), I = node('info'), CK = node('ck');
  chain([E, X, I]);
  ok('...Home Energy under the weather, under the cards: left where it is', underCards(E, I) === true && underCards(X, I) === true);
  chain([X, E, I]);
  ok('...the other way round: left too', underCards(X, I) === true && underCards(E, I) === true);
  chain([E, CK, X, I]);
  ok('...a clock mounted again above it: moved', underCards(E, I) === false && underCards(X, I) === true);
  chain([I, E]);
  ok('...above the corner cards: moved', underCards(E, I) === false);
  ok('...not in this root: put in', underCards(node('en'), I) === false);
}

print('\n=== hk-saver.js: the dashboard hidden under the screensaver, wherever its host keeps the view ===');
// THE VIEW OUTSIDE THE ROOT (2026-10-21): Mantel's page keeps its view
// (<hk-view-container id="view">) beside #hk-shell-root, so hiding the root
// left the whole dashboard -- sky, cards, the shared blur -- composited under
// the photos (~7 screens of layers, headless), and Return to Home made a new
// page's ~120 under it mid-turn. coverDashboard itself, run: its own text.
var cm = /  function within\(root, el\) \{[\s\S]*?\n  function coverDashboard\(covered\) \{[\s\S]*?\n  \}\n/.exec(src);
ok('coverDashboard is there', !!cm);
if (cm) {
  var cover = new Function('window', 'var coverT = null, coveredPage = null, pageVisibility = null, coveredView = [];' +
                           cm[0] + '; return coverDashboard;');
  function styled(tag) {
    var e = new El(tag);
    // (dom.js's Style methods are read-only: these are the element's own, with a priority kept beside)
    var pri = {}, set = e.style.setProperty;
    Object.defineProperty(e.style, 'setProperty', { value: function (k, v, p) { set.call(this, k, v); pri[k] = p || ''; } });
    Object.defineProperty(e.style, 'getPropertyPriority', { value: function (k) { return pri[k] || ''; } });
    return e;
  }
  function page(viewInside) {
    var root = styled('div'), view = styled('hk-view-container');
    view.parentNode = viewInside ? root : null;
    var win = { hkShell: { root: function () { return root; }, viewContainer: function () { return view; } },
                dispatchEvent: function () {} };
    return { root: root, view: view, cover: cover(win) };
  }
  var mantel = page(false);
  mantel.view.style.setProperty('visibility', 'visible');
  mantel.cover(true);
  ok('Mantel: the root and the view beside it are both hidden',
     mantel.root.style.getPropertyValue('visibility') === 'hidden' && mantel.view.style.getPropertyValue('visibility') === 'hidden' &&
     mantel.view.style.getPropertyPriority('visibility') === 'important', [mantel.root.style, mantel.view.style]);
  mantel.cover(true);
  mantel.cover(false);
  ok('...and both given back as they were at the wake (the view\'s own visibility kept)',
     mantel.root.style.getPropertyValue('visibility') === '' && mantel.view.style.getPropertyValue('visibility') === 'visible',
     [mantel.root.style, mantel.view.style]);
  var ha = page(true);
  ha.cover(true);
  ok('Home Assistant: the view is inside the root, hidden with it, left alone',
     ha.root.style.getPropertyValue('visibility') === 'hidden' && ha.view.style.getPropertyValue('visibility') === '', ha.view.style);
  ha.cover(false);
  ok('...and the root given back', ha.root.style.getPropertyValue('visibility') === '');
}

print('\n=== hk-saver.js: a tap counts only on music that is on screen ===');
// THE PANE DOWN (2026-10-21): with Music in the pane set up and nothing
// playing, the pane stays laid out at opacity 0 and its music hidden -- its
// art's box over the clock's right side took a tap meant to wake the screen
// and closed it onto Play Music.
var sm = /  function seen\(el\) \{[\s\S]*?\n  \}\n/.exec(src);
ok('seen() is there, and musicHit skips a view not seen', !!sm && /\(v\.kind === 'slide' && !muShowing\) \|\| !seen\(v\.el\)\) continue;/.test(src));
if (sm) {
  var styles = new Map();
  var gcs = function (el) { return Object.assign({ display: 'block', visibility: 'visible', opacity: '1' }, styles.get(el) || {}); };
  var hostEl = new El('hk-saver'), pane = new El('div'), pm = new El('div');
  hostEl.nodeType = pane.nodeType = pm.nodeType = 1;          // (dom.js's El has none; a real element is 1)
  var shadow = { nodeType: 11, host: hostEl };
  pane.parentNode = shadow; pm.parentNode = pane;
  var seenFn = new Function('getComputedStyle', 'host', sm[0] + '; return seen;')(gcs, hostEl);
  ok('...the pane up, its music shown: seen', seenFn(pm) === true);
  styles.set(pane, { opacity: '0' });
  ok('...the pane down (opacity 0): not seen, its art takes no tap', seenFn(pm) === false);
  styles.set(pane, {}); styles.set(pm, { visibility: 'hidden' });
  ok('...its music hidden (nothing playing): not seen', seenFn(pm) === false);
  styles.set(pm, {}); styles.set(hostEl, { opacity: '0.004' });
  ok('...the screensaver itself still getting ready: not seen', seenFn(pm) === false);
}

print(fail ? 'FAIL ' + fail + ' SAVER LAYER TESTS' : 'ALL ' + pass + ' SAVER LAYER TESTS PASS');
if (fail) throw new Error(fail + ' failed');
