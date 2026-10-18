// Phase 2 P2.5 in HOME ASSISTANT (docs/phase2/SHEETS.md): HK's own sheets and dialogs, and what
// the HA build still hands to HA. The prelude installs HA's shell (hk-ha-shell.js), as HA's boot
// does, so these drive the real listener, the real sheet and the real toast layer with HA's
// answers: a kind HK has no sheet for, sheets switched off and a tap from HA's own pages still go
// to HA's more-info dialog (the event is let through untouched); toasts still go to HA's
// snackbar; HK's confirm sheet still mounts on the document's body. The generic sheet exists in
// HA only when asked for directly, and its "Open in Home Assistant" opens HA's dialog.
// test_sheets_mantel.js is the other host.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/sheet_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-detail.js');
load(HK_ROOT + '/frontend/shell/hk-overlays.js');
var D = window.hkDetail, _ = D._, C = window.hkCards, S = window.hkShell, O = window.hkOverlays;
var DASH = ['HK-TILE-CARD', 'DIV', 'HA-PANEL-LOVELACE', 'HOME-ASSISTANT'];
var MORE = 'hass-more-info';

print('=== the shell: HA has its own detail and toasts ===');
ok('HA\'s shell is the one in place', S.kind === 'ha');
ok('hostDetail: HA has a detail dialog for any entity', S.hostDetail('scene.evening') === true && S.hostDetail('light.a') === true);
ok('hostToast: HA draws its own toasts', S.hostToast() === true);
ok('dialogRoot: the document\'s body, as always (not HA\'s shadow root)', S.dialogRoot() === document.body && S.overlayRoot() === HA.shadowRoot);

print('\n=== more-info: what HK has no sheet for still goes to HA ===');
HA.hass = house({
  'light.a': ['on', { supported_color_modes: ['brightness'], brightness: 128 }],
  'scene.evening': ['2026-10-18T20:00:00+00:00', { friendly_name: 'Evening' }],
  'sun.sun': ['above_horizon', { elevation: 30 }],
  'cover.tilt': ['closed', { supported_features: 240 }]
}, { admin: true });
resetHistory(); __resetTimers();
var e = request(MORE, 'scene.evening', DASH);
ok('a scene (no sheet of its own): not taken, no sheet -- HA\'s dialog opens', !e.taken && !_.state().el);
e = request(MORE, 'sun.sun', DASH);
ok('the sun: the same', !e.taken && !_.state().el);
e = request(MORE, 'cover.tilt', DASH);
ok('a tilt-only blind: the same (as before)', !e.taken && !_.state().el);
e = request(MORE, 'light.a', DASH);
ok('a light: HK\'s own sheet, the event taken', e.taken && _.state().kind === 'light');
D.close(true);
e = request(MORE, 'light.a', ['HA-DATA-TABLE', 'HA-PANEL-CONFIG', 'HOME-ASSISTANT']);
ok('from HA\'s own Settings: HA\'s dialog, even for a light', !e.taken && !_.state().el);
e = request(MORE, 'light.a', ['HOME-ASSISTANT']);
ok('from nowhere in particular (HA\'s root): HA\'s dialog', !e.taken && !_.state().el);
localStorage.setItem('hk-detail-off', '1');
e = request(MORE, 'light.a', DASH);
ok('sheets switched off: HA\'s dialog for everything', !e.taken && !_.state().el);
localStorage.removeItem('hk-detail-off');
e = request(MORE, 'light.unknown', DASH);
ok('an entity with no state: HA\'s dialog', !e.taken && !_.state().el);

print('\n=== the generic sheet in HA: only when asked for, and Open in Home Assistant ===');
resetHistory(); __resetTimers(); HA.got = [];
ok('open() alone still says no to a kind with no sheet', D.open('scene.evening', {}) === false && !_.state().el);
ok('asked for (generic: true), it opens', D.open('scene.evening', {}, { generic: true }) === true && _.state().kind === 'generic');
var g = _.state().panel;
ok('...HK\'s generic sheet', g.tagName === 'HK-DETAIL-GENERIC');
ok('...its state in the client\'s words', g._big.textContent === 'F:2026-10-18T20:00:00+00:00', g._big.textContent);
ok('...an admin on a host with its own detail: "Open in Home Assistant"', g._gHost.hidden === false && g._gHost.textContent === 'Open in Home Assistant');
var depth = HIST.i;
g._gHost.click();
ok('...pressed: the sheet goes first, with its history entry', !_.state().el && HA.got.length === 0 && HIST.pops.length === 1);
flushPops();
ok('...then HA\'s own dialog: hass-more-info from <home-assistant>, bubbling, composed',
   HA.got.length === 1 && HA.got[0].type === 'hass-more-info' && HA.got[0].detail.entityId === 'scene.evening' && HIST.i === depth - 1, HA.got.length);
ok('...which HK\'s own listener lets through (not from a dashboard): no sheet', !_.state().el);
HA.hass = house({ 'scene.evening': ['2026-10-18T20:00:00+00:00', {}] }, { admin: false });
resetHistory(); __resetTimers();
D.open('scene.evening', {}, { generic: true });
ok('not an admin: no link', _.state().panel._gHost.hidden === true);
D.close(true);
ok('toHost on its own: HA\'s dialog at once', (HA.got = [], _.toHost('sun.sun')) === true && HA.got.length === 1 && HA.got[0].detail.entityId === 'sun.sun');
ok('openHostDetail needs an entity', S.openHostDetail('') === false);

print('\n=== toasts and confirmations stay as they were ===');
HA.got = [];
S.toast({ message: 'Playing Jazz' });
ok('a toast is HA\'s event from <home-assistant>', HA.got.length === 1 && HA.got[0].type === 'hass-notification' && HA.got[0].detail.message === 'Playing Jazz');
ok('...and HK\'s toast layer stays out (HA draws it)', O.current() === null && O._.layer() === null);
var sheet = C.confirmSheet('Turn off the circuit?', function () {});
ok('HK\'s confirm sheet mounts on the document\'s body, as always', sheet.parentNode === document.body && sheet.id === 'hk-confirm');
var choose = C.chooseSheet('Which?', [{ name: 'A' }], function () {});
ok('...and its choose sheet', choose.parentNode === document.body);

sheetResult('SHEETS (HA)');
