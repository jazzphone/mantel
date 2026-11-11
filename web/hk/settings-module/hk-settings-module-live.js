// hk-settings-module-live.js - the live feed: the integration's answer and its subscriptions.
//
// PART OF THE HK SETTINGS MODULE (window.hkSettings) (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsModuleParts = window.hkSettingsModuleParts || {})['hk-settings-module-live'] = function (K) {
    // A SUBSCRIPTION THAT SURVIVES. home-assistant-js-websocket
    // re-subscribes by itself after a reconnect -- but a subscribe that FAILS is
    // dropped for good. And one fails after every Home Assistant restart on a
    // screen that reconnects early: the websocket is served from the moment the
    // frontend is up, before this integration has registered its commands, so
    // the answer is `unknown_command` and the page would never hear of another
    // edit until it was reloaded. So the resubscribe is ours: after every
    // reconnect ('ready'), and after a failure with a backoff (1 s .. 30 s).
    // Also used by hkMusic (hk-base.js). Returns a function that ends it.
    function subscribe(conn, msg, onEvent, label) {
      var gen = 0, timer = null, backoff = 1000, closed = false, unsub = null;
      function quiet(fn) {
        try { var r = fn(); if (r && typeof r.catch === 'function') r.catch(function () {}); }
        catch (e) { /* already gone */ }
      }
      function go() {
        if (closed) return;
        var my = ++gen;
        clearTimeout(timer);
        Promise.resolve().then(function () {
          return conn.subscribeMessage(function (ev) {
            if (my === gen && !closed) onEvent(ev);
          }, msg, { resubscribe: false });
        }).then(function (u) {
          if (my !== gen || closed) { quiet(u); return; }
          unsub = u;
          backoff = 1000;
        }, function (e) {
          if (my !== gen || closed) return;
          console.warn('[' + (label || msg.type) + '] not available, retrying in ' +
                       (backoff / 1000) + ' s (' + ((e && (e.message || e.code)) || e) + ')');
          timer = setTimeout(go, backoff);
          backoff = Math.min(backoff * 2, 30000);
        });
      }
      // A reconnect: the server has forgotten every subscription.
      function onReady() { unsub = null; backoff = 1000; go(); }
      if (typeof conn.addEventListener === 'function') conn.addEventListener('ready', onReady);
      go();
      return function close() {
        closed = true;
        clearTimeout(timer);
        if (typeof conn.removeEventListener === 'function') conn.removeEventListener('ready', onReady);
        if (unsub) quiet(unsub);
      };
    }
    function currentClient() {
      var host = window.hkHostClient;
      return host && host.current ? host.current() : null;
    }

    // what the shell and the later parts use of this one
    K.currentClient = currentClient; K.subscribe = subscribe;
  };
})();
