// mantel-native.js -- the page's side of the iPhone and iPad app (apple/Mantel/HouseWebView.swift injects
// window.mantelNative: the `ios` host). Everywhere else there is no bridge, and nothing here runs.
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
})(typeof window !== 'undefined' ? window : globalThis);
