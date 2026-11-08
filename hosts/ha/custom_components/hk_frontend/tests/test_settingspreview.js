// THE SCREENSAVER'S PREVIEW, JUST WHAT IS CHANGING (panels/hk-settings.js, 2026-10-31, the owner: "see just what
// they're changing, updating in place"): on a host with a page of only the screensaver (its settingsHost's
// saverPage), the preview frame shows that page while the screensaver's pages are open; each change to the options
// is handed to the frame's screensaver as it is put (hkSaver.preview's `over`) -- for a screen's own options, or
// All Screens' -- and a redraw of the page after a save keeps the frame (it was made again every time, the whole
// screen loaded again: a preview not pinned never matched).
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/panels/hk-settings-features.js');
var SRC = read(HK_ROOT + '/frontend/panels/hk-settings.js');
(0, eval)(readRunnable(HK_ROOT + '/frontend/panels/hk-settings.js').replace('  var M = null, K = null, h = null, F = null;',
  '  var M = window.hkSettingsModel, K = window.hkSettingsKit, h = K.h, F = window.hkSettingsFeatures; F.use(K);'));
var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
var P = customElements.get('hk-settings-panel').prototype;

print('=== the frame’s address ===');
function pg(host) { var p = Object.create(P); p._host = host; p._pv = { path: 'dashboard-kitchen', view: '0' }; return p; }
var withPage = pg({ saverPage: true, screenBase: '/base' }), without = pg(null);
ok('the screensaver’s pages, on a host with a page of only the screensaver: that page', P.previewSrc.call(withPage, 'saver'),
   '/base/dashboard-kitchen/0?hk_kiosk=on&kiosk&wp_enabled=false&hk_preview=saver');
ok('...any other page: the screen, as the preview always loaded it', P.previewSrc.call(withPage, null), '/base/dashboard-kitchen/0?hk_kiosk=on&kiosk&wp_enabled=false');
ok('a host without one: the screen on the screensaver’s pages too', P.previewSrc.call(without, 'saver'), '/dashboard-kitchen/0?hk_kiosk=on&kiosk&wp_enabled=false');
ok('the screen’s address as the preview column makes it (so nothing loads again for nothing)',
   SRC.indexOf("fr.src = mbase + '/' + path + '/' + view + '?hk_kiosk=on&kiosk&wp_enabled=false';") >= 0, true);

print('=== each change, handed over as it is put ===');
function page(house, path) {
  var p = Object.create(P), handed = [], saved = [];
  p._saverHouse = house; p._pv = { path: path || 'dashboard-kitchen', view: '0' }; p._saverWas = true;
  p.saverPreview = function (on) { handed.push([on, p._saverOver]); };
  p.save = function (msg) { saved.push(msg.type); return Promise.resolve(); };
  p.data = { boards: {}, settings: {} };
  p.handed = handed; p.saved = saved;
  return p;
}
var a = page(false);
P.setB.call(a, 'dashboard-kitchen', { screensaver_options: { show: 'day', day_look: 'dark' } });
ok('a screen’s options: handed to the preview, and saved', [a.handed, a.saved.length], [[[true, { show: 'day', day_look: 'dark' }]], 1]);
var b = page(false);
P.setB.call(b, 'dashboard-den', { screensaver_options: { show: 'day' } });
ok('...not another screen’s (the frame shows this one)', b.handed, []);
var c = page(false);
P.setB.call(c, 'dashboard-kitchen', { title: 'Den' });
ok('...nor anything but the screensaver’s options', c.handed, []);
var d = page(true);
P.setB.call(d, 'dashboard-kitchen', { screensaver_options: { show: 'day' } });
P.setH.call(d, { 'look.saver': { show: 'month' } });
ok('All Screens’ preview: All Screens’ options, not the screen’s', d.handed, [[true, { show: 'month' }]]);
var e = page(false);
P.setB.call(e, 'dashboard-kitchen', { screensaver_options: null });
ok('Same as All Screens (the screen’s own options gone): the saved ones again', e.handed, [[true, null]]);
var f = page(false); f._saverWas = false;
P.saverOver.call(f, { show: 'day' });
ok('no preview showing: kept for when it does, nothing asked of the frame', [f.handed, f._saverOver], [[], { show: 'day' }]);

print('=== the frame kept across a redraw ===');
ok('a preview not pinned is kept (pinned compared as true or false, not undefined against false)', /!!this\._pv\.pinned === pinned/.test(SRC), true);
ok('...its address changed in one place, never on a redraw (frameSrc)', /var at = fr\.getAttribute\('data-src'\) \|\| fr\.getAttribute\('src'\);\s*if \(!want \|\| at === want\) return;/.test(SRC), true);
// (2026-11-01: a new src is a Back step of the page's -- Back after the Screensaver editor's Save loaded the frame's
// address, the screensaver alone, full screen -- so a loaded frame goes there in its own history entry)
ok('...in the frame\'s own history entry once it has a page (location.replace), its src only before', [/loaded\.replace\(new URL\(want, location\.href\)\.href\); return;/.test(SRC), /fr\.setAttribute\('data-src', want\);/.test(SRC)], [true, true]);
ok('the Screensaver editor leaves in its own history entry, never by Back', [/leaveTo\(hash\) \{[\s\S]{0,160}location\.replace\(/.test(SRC), /onSaved: function \(\) \{ delete self\._saverEditors\[key\]; self\.leaveTo\(o\.back\[1\]\); \}/.test(SRC)], [true, true]);
// (2026-11-08, the owner: Back on any Screensaver settings page could load the screensaver alone, full screen -- the
// frame's loads are the browser's history entries too, so the page's Back never uses the browser's beside a frame)
(function () {
  if (typeof history === 'undefined') window.history = { back: function () {} };
  var was = history.back, calls = [];
  history.back = function () { calls.push('browser back'); };
  var fake = function (frame) {
    return { from: {}, staticBack: function () { return null; }, hist: ['#/screens/x/screensaver', '#/screens/x/screensaver/holiday'],
             pageEl: { querySelector: function (s) { return frame && s === '.pvbox iframe' ? {} : null; } },
             leaveTo: function (h) { calls.push('leave ' + h); }, go: function (h) { calls.push('go ' + h); } };
  };
  location.hash = '#/screens/x/screensaver/holiday';
  P.back.call(fake(true), '#/screens/x/screensaver');
  P.back.call(fake(false), '#/screens/x/screensaver');
  history.back = was;
  ok('Back beside a preview frame goes in the page\'s own history entry; without one, the browser\'s Back', calls,
     ['leave #/screens/x/screensaver', 'browser back']);
})();
ok('...and a frame on its way to the screensaver alone, or back, is asked nothing until it is there',
   /if \(\/hk_preview=saver\/\.test\(bound\) !== \/hk_preview=saver\/\.test\(at\)\) return false;/.test(SRC), true);

print(fail ? 'FAIL ' + fail + ' SETTINGS PREVIEW TESTS' : 'ALL ' + pass + ' SETTINGS PREVIEW TESTS PASS');
if (fail) throw new Error(fail + ' failed');
