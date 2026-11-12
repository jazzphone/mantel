// mantel-native.js -- the page's side of the iPhone and iPad app (jazzphone/mantel-ios: Mantel/HouseWebView.swift injects
// window.mantelNative: the `ios` host; jazzphone/mantel-android's Bridge.kt: the `android` host). Everywhere else
// there is no bridge, and nothing here runs.
// docs/phase10/NATIVE-FEEL.md, items 3, 4 and 6.
//
//   HAPTICS    a light tap as a command leaves for the house (a light, a lock, a scene, the music's buttons),
//              a warning when the house refuses one -- the page's own commands, through mantel-client.js
//   THE MENU   "Mantel App" in HK's menu and the tab bar's More (mantel-shell.js hostMenu): the app's own settings,
//              a native sheet, in place of a second ⋯ button over the page
//   TONE       the status bar's ink: dark on a light page (light Flat), light otherwise and while the Music page's
//              dark Now Playing is up
(function (global) {
  'use strict';
  const N = global.mantelNative;
  if (N && N.platform === 'android') { android(global, N); return; }
  if (!N || N.platform !== 'ios') return;

  // THE PLAYER: the app's own Now Playing (iPhone), in place of the Music page's sheet -- HK's music cards ask the
  // host for one by a name of HK's own (hk-music.js _sheet, hk-media.js's bar)
  if (typeof N.player === 'function') global.hkHostPlayer = () => N.player();
  // THE PHONE'S OWN NOTIFICATIONS: with the app's notifications on and registered with the house, every notification
  // reaches it as the phone's own banner -- the page draws none of its own (hk-notify.js decide, hkHostNotifies)
  global.hkHostNotifies = () => N.notifications === true;

  // a command that changes something, not one that reads (music_assistant.get_queue, get_library)
  const READ = /(^|\.)get_/;
  global.addEventListener('mantel-command', (e) => {
    const d = (e && e.detail) || {};
    if (d.kind === 'service' && !READ.test(String(d.what || ''))) N.haptic('light');
  });
  global.addEventListener('hk-command-denied', () => N.haptic('warning'));
  // HK's own moments that a finger should feel (hk-edit.js: a hold that starts Edit mode)
  global.addEventListener('hk-haptic', (e) => N.haptic(String((e && e.detail && e.detail.kind) || 'light')));

  let ink = null;
  function tone() {
    const S = global.hkSettings, r = S && S.rendering ? S.rendering() : null;
    const de = global.document && global.document.documentElement;
    const light = !!(r && r.flat && r.theme === 'light') && !(de && de.hasAttribute('hk-music-sheet'));
    if (light === ink) return;
    ink = light;
    N.tone(light);
  }
  // the look can change at any moment (a setting saved on another screen, a page with its own look, the Music
  // page's sheet): a cheap read once a second
  global.setInterval(tone, 1000);
  tone();

  // MANTEL FOR ANDROID (jazzphone/mantel-android, docs/phase26/ANDROID-APP.md "Managing a tablet"): Mantel Settings
  // manages the app through this page's socket. The page tells Mantel the app's status when it connects and every
  // minute, and has the app do what Mantel asks (one of apps/tablet_app.py COMMANDS), answering with how it went.
  function android(g, A) {
    if (typeof A.status !== 'function' || typeof A.command !== 'function') return;
    const status = () => Promise.resolve(A.status()).then((t) => (typeof t === 'string' ? JSON.parse(t) : t)).catch(() => null);
    let hub = null;
    const tell = () => { if (hub) status().then((st) => { if (st) hub.tell('tablet_app', { event: 'status', status: st }); }); };
    const attach = () => {
      hub = g.__mantelHub;
      if (!hub) { g.setTimeout(attach, 500); return; }
      const before = hub.onReconnect;
      hub.onReconnect = function () { if (before) before.apply(this, arguments); g.setTimeout(tell, 1000); };
      hub.onTabletApp = (m) => {
        if (!m || m.event !== 'command') return;
        Promise.resolve(A.command(String(m.command), m.value === undefined ? null : m.value))
          .then((r) => (typeof r === 'string' ? JSON.parse(r) : r))
          .then((r) => hub.tell('tablet_app', { event: 'done', nonce: m.nonce, ok: !!(r && r.ok), message: (r && r.message) || '',
                                                status: (r && r.status) || null, image: (r && r.image) || undefined }),
                (e) => hub.tell('tablet_app', { event: 'done', nonce: m.nonce, ok: false, message: String(e && e.message || e) }));
      };
      g.setTimeout(tell, 3000);
      g.setInterval(tell, 60000);
    };
    attach();
  }
})(typeof window !== 'undefined' ? window : globalThis);
