// THE CSS STRING SNAPSHOT (hk_house/docs/PLAN-2026-10-12-design-consolidation.md,
// step 0.3): every CSS string HK Frontend's cards and modules hand the page,
// collected in one place and compared with tests/fixtures/css_snapshot.json.
//
// A refactor that moves a design value into hkCards.T must leave every string
// here byte-identical; a step that changes a value on purpose updates the
// fixture in the same commit, so the fixture's diff IS the reviewable change:
//
//     HK_UPDATE_SNAPSHOT=1 tests/run csssnapshot
//
// Collected: each registered element's static CSS (and PART_CSS) and the CSS
// its methods build (hk-control's _baseCss ...), every string named *CSS on
// the modules' exported objects (hkCards, hkDetail._, hkMenu._, hkTabBar._,
// hkNotify._, hkTimers -- the menu, bar, banners, dock and detail sheet hand
// theirs over for this test), hkCards.segCss, and every stylesheet a module
// builds while it loads. CSS that only exists inside a closure (NOT_REACHED)
// is covered by the live fingerprint
// (hk_house/tools/headless/style_fingerprint.py) instead.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');

var GOT = {};
function put(name, css) {
  if (typeof css !== 'string' || !css) return;
  if (GOT[name] !== undefined && GOT[name] !== css) {
    var i = 2; while (GOT[name + '#' + i] !== undefined && GOT[name + '#' + i] !== css) i++;
    name = name + '#' + i;
  }
  GOT[name] = css;
}
var LOADING = '';
// a stylesheet built while the files load (dom.js's innerHTML can't be hooked:
// its accessor is fixed)
var RS = globalThis.CSSStyleSheet;
globalThis.CSSStyleSheet = function () { RS.call(this); delete this.replaceSync; };
globalThis.CSSStyleSheet.prototype.replaceSync = function (t) { if (LOADING !== 'after') put('sheet@' + LOADING, t); };

var FILES = ['cards/hk-base', 'modules/hk-stats', 'modules/hk-charts', 'modules/hk-glass',
  'cards/hk-tile', 'cards/hk-chip', 'cards/hk-stat', 'cards/hk-row', 'cards/hk-layout', 'cards/hk-home',
  'cards/hk-media', 'cards/hk-music', 'cards/hk-library', 'cards/hk-cameras', 'cards/hk-security',
  'cards/hk-energy', 'cards/hk-headers', 'modules/hk-header', 'cards/hk-weather', 'cards/hk-calendar', 'cards/hk-control', 'cards/hk-room',
  'cards/hk-popup', 'cards/hk-detail', 'cards/hk-person', 'cards/hk-strategy',
  'modules/hk-timers', 'modules/hk-menu', 'modules/hk-tabbar', 'modules/hk-notify',
  'modules/hk-saver-panel', 'modules/hk-frosttint',
  'panels/hk-settings-kit'];
var LOADED = [], FAILED = [];
FILES.forEach(function (f) {
  LOADING = f.split('/')[1];
  try { load(HK_ROOT + '/frontend/' + f + '.js'); LOADED.push(f); }
  catch (e) { FAILED.push(f + ': ' + String(e).slice(0, 120)); }
});
LOADING = 'after';
try { window.dispatchEvent(new Event('hk-cards-ready')); } catch (e) { /* no window events */ }

// every registered element: its static CSS and PART_CSS
// dom.js's registry (_defined) is a global of the shim
Object.keys(_defined).sort().forEach(function (tag) {
  var C = customElements.get(tag);
  if (!C) return;
  try { put(tag + '.CSS', C.CSS); } catch (e) { put(tag + '.CSS!', 'THROWS ' + e); }
  try { if (C.PART_CSS) put(tag + '.PART_CSS', C.PART_CSS); } catch (e) { /* none */ }
  try { if (C.prototype && typeof C.prototype.PART_CSS === 'string') put(tag + '.proto.PART_CSS', C.prototype.PART_CSS); } catch (e) { /* none */ }
  // CSS a card builds in a method (hk-control's _baseCss / _extraCss /
  // _segCss), called on a bare instance with an empty config
  var P = C.prototype;
  Object.getOwnPropertyNames(P).sort().forEach(function (m) {
    if (!/css$/i.test(m) || m === 'constructor') return;
    var d = Object.getOwnPropertyDescriptor(P, m);
    if (!d || typeof d.value !== 'function' || d.value.length) return;
    try { var o = Object.create(P); o._config = {}; put(tag + '.' + m + '()', d.value.call(o)); }
    catch (e) { /* needs a live element (hk-music's _panelCss): not reached */ }
  });
});
// strings named *CSS on the exported objects, one level into `_`
function scan(label, o) {
  if (!o) return;
  Object.keys(o).sort().forEach(function (k) {
    if (/CSS$/.test(k) && typeof o[k] === 'string') put(label + '.' + k, o[k]);
  });
  if (o._ && typeof o._ === 'object') scan(label + '._', o._);
}
['hkCards', 'hkDetail', 'hkMenu', 'hkTabBar', 'hkNotify', 'hkSaverPanel', 'hkHeader', 'hkTimers',
  'hkKiosk', 'hkGlass', 'hkChart', 'hkStats', 'hkSettingsKit', 'hkEnergyPage'].forEach(function (g) { scan(g, globalThis[g]); });
if (window.hkCards && window.hkCards.segCss) {
  put('hkCards.segCss(.seg)', window.hkCards.segCss('.seg', {}));
}

var NOT_REACHED = ['hk-popup CSS / STASH_CSS (module-private)', 'hk-calendar SHEET_CSS (the event editor)',
  'hk-cameras live-view CSS (written per camera)', 'hk-header FIT_CSS (per selector)', 'hk-kiosk CSS (needs a live page)',
  'hk-music _panelCss (needs a live element)', 'hk-saver CSS (the screensaver)', 'hk-sky (art, out of scope)'];

var keys = Object.keys(GOT).sort(), snap = {};
keys.forEach(function (k) { snap[k] = GOT[k]; });
var FIX = HK_ROOT + '/tests/fixtures/css_snapshot.json';
var pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL ' + name + (got !== undefined ? '  ' + got : '')); } }
ok('every file loads', FAILED.length === 0, FAILED.join(' | '));
ok('collects a real number of CSS strings', keys.length > 100, keys.length);
if (typeof HK_UPDATE_SNAPSHOT !== 'undefined' && HK_UPDATE_SNAPSHOT) {
  writeFile(FIX, JSON.stringify(snap, null, 1) + '\n');
  print('wrote ' + FIX + ': ' + keys.length + ' strings; not reached: ' + NOT_REACHED.join('; '));
} else {
  var want = null;
  try { want = JSON.parse(read(FIX)); } catch (e) { ok('fixture readable', false, String(e)); }
  if (want) {
    var wk = Object.keys(want).sort();
    // FORMATTING IS NOT A CHANGE: a value moved into v() writes
    // 'var(--hk-x,<v>)' where the old literal may have had a space after the
    // comma. Whitespace around , : ; { } ( ) and runs of it compare equal.
    var flat = function (s) {
      return s.replace(/\s+/g, ' ').replace(/\s*([,:;{}()>])\s*/g, '$1').trim();
    };
    wk.forEach(function (k) {
      if (!(k in snap)) ok(k + ' still produced', false, 'missing');
      else if (flat(snap[k]) !== flat(want[k])) {
        // the first difference, with a little context either side
        var a = flat(want[k]), b = flat(snap[k]), i = 0;
        while (i < a.length && a[i] === b[i]) i++;
        ok(k + ' unchanged', false, '@' + i + ' was …' + a.slice(Math.max(0, i - 40), i + 60) + '… now …' + b.slice(Math.max(0, i - 40), i + 60) + '…');
      } else pass++;
    });
    keys.forEach(function (k) { if (!(k in want)) ok(k + ' is in the fixture', false, 'new'); });
  }
}
print(fail ? 'FAIL ' + fail + ' CSS SNAPSHOT TESTS (' + pass + ' passed)' : 'ALL ' + pass + ' CSS SNAPSHOT TESTS PASS');
