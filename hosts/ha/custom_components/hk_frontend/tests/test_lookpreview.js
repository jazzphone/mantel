// THE LOOK ALONE (2026-10-31, the owner: "just what they're changing"): Settings' preview on the Appearance pages is
// the screen with only a few of its cards on Home (?hk_preview=look; hk-strategy.js lookSample) -- the header and its
// chips, the scenes, the room with the most tiles -- on its own background, glass, accent, menu and tab bar. Which
// pages ask for it (a screen's Appearance pages; All Screens', shown on a screen that follows them), and the frame's
// address.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/panels/hk-settings-features.js');
(0, eval)(readRunnable(HK_ROOT + '/frontend/panels/hk-settings.js').replace('  var M = null, K = null, h = null, F = null;',
  '  var M = window.hkSettingsModel, K = window.hkSettingsKit, h = K.h, F = window.hkSettingsFeatures; F.use(K);'));
var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}

print('=== the few cards ===');
var grid = function (kids) { return { type: 'grid', cards: kids }; };
var room = function (name, n) { var t = []; for (var i = 0; i < n; i++) t.push({ type: 'custom:hk-light-card', entity: 'light.' + name + i });
  return grid([{ type: 'custom:hk-heading-card', heading: name }, { type: 'custom:hk-grid-card', cards: t }]); };
var head = grid([{ type: 'custom:hk-header-card' }, { type: 'custom:hk-chips-card' }, { type: 'custom:hk-spacer-card' }]);
var cams = grid([grid([{ type: 'custom:hk-heading-card' }, { type: 'custom:hk-grid-card', cards: [{ type: 'custom:hk-row-card', cards: [{ type: 'custom:hk-camera-mosaic-card' },
  { type: 'custom:hk-camera-mosaic-card' }, { type: 'custom:hk-camera-mosaic-card' }, { type: 'custom:hk-camera-mosaic-card' }, { type: 'custom:hk-camera-mosaic-card' }] }] }])]);
var scenes = { type: 'custom:hk-scenes-card' }, small = room('Porch', 1), big = room('Kitchen', 4), mid = room('Den', 2);
var popup = { type: 'custom:hk-grid-card', cards: [{ type: 'custom:hk-popup-card' }] };
var views = [{ type: 'custom:hk-grid-view', path: 'home', cards: [head, cams, scenes, small, big, mid, popup] }, { type: 'custom:hk-grid-view', path: 'lights', cards: [mid] }];
window.hkStrategy.lookSample(views);
ok('Home keeps the header and chips, the scenes and the room with the most tiles, in that order', views[0].cards, [head, scenes, big]);
ok('...not the cameras (a room-like section of live video), nor the pop-ups', views[0].cards.indexOf(cams) < 0 && views[0].cards.indexOf(popup) < 0, true);
ok('...the other pages as they are (the menu and tab bar still name them)', views[1].cards, [mid]);
var hg = [{ type: 'custom:hk-home-grid-view', path: 'home', grid: { items: [1, 2, 3] } }];
window.hkStrategy.lookSample(hg);
ok('a Home Grid is left as it is', hg[0], { type: 'custom:hk-home-grid-view', path: 'home', grid: { items: [1, 2, 3] } });
var bare = [{ type: 'custom:hk-grid-view', path: 'home', cards: [head] }];
window.hkStrategy.lookSample(bare);
ok('a Home with only some of them: what there is', bare[0].cards, [head]);
var SSRC = read(HK_ROOT + '/frontend/cards/hk-strategy.js');
ok('only on the preview’s address, after the pages are made', [/function lookPreview\(\) \{ try \{ return \/\[\?&\]hk_preview=look\(\?:&\|\$\)\/\.test/.test(SSRC),
   /skyPages\(cfg\.views\);\s*if \(lookPreview\(\)\) lookSample\(cfg\.views\);/.test(SSRC)], [true, true]);

print('=== which pages ask for it ===');
var P = customElements.get('hk-settings-panel').prototype;
var page = Object.create(P);
page.data = { boards: { 'dashboard-kitchen': { glass: 'house', tab_bar_glass: 'house', accent: 'orange', sky: true },
                        'dashboard-den': { glass: 'clear' } },
              dashboards: [{ url_path: 'dashboard-kitchen', title: 'Kitchen', item: true }, { url_path: 'dashboard-den', title: 'Den', item: true }],
              settings: { sky: {}, look: {} }, choices: {} };
page.dash = function (p) { return { path: p, title: p === 'dashboard-den' ? 'Den' : 'Kitchen', item: true, generated: true }; };
page.hs = function () { return null; };
var screenPage = function (s) { return P.p_screen.call(page, 'dashboard-kitchen', s); };
['appearance', 'looks', 'accent', 'sky', 'glass'].forEach(function (s) {
  var r = screenPage([s]);
  ok('a screen’s ' + s + ' page: the look alone, of this screen', [r.preview, !!r.lookPreview], ['dashboard-kitchen', true]);
});
ok('...not its other pages (Status Chips: the screen)', !!screenPage(['chips']).lookPreview, false);
ok('All Screens’ Appearance: on a screen that follows it (`house`: Same as All Screens)', P.lookFollower.call(page), 'dashboard-kitchen');
var hp = P.p_house.call(page, 'appearance', []);
ok('...its page has the look alone, on that screen', [hp.preview, !!hp.lookPreview], ['dashboard-kitchen', true]);
var none = Object.create(page); none.data = { boards: { 'dashboard-den': { glass: 'clear' } } };
ok('...no screen follows it: the first screen', P.lookFollower.call(none), 'dashboard-den');

print('=== the frame’s address ===');
var fr = Object.create(P); fr._host = null; fr._pv = { path: 'dashboard-kitchen', view: '0' };
ok('the look alone, on any host', P.previewSrc.call(fr, 'look'), '/dashboard-kitchen/0?hk_kiosk=on&kiosk&wp_enabled=false&hk_preview=look');
ok('...the screen otherwise', P.previewSrc.call(fr, null), '/dashboard-kitchen/0?hk_kiosk=on&kiosk&wp_enabled=false');

print(fail ? 'FAIL ' + fail + ' LOOK PREVIEW TESTS' : 'ALL ' + pass + ' LOOK PREVIEW TESTS PASS');
if (fail) throw new Error(fail + ' failed');
