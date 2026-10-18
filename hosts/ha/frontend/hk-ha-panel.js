// HK AS ITS OWN HOME ASSISTANT PANEL (Phase 2 P2.6, opt-in: custom_components/hk_frontend/
// hk_panel.py registers it only while switched on). An HK screen drawn inside HA by HK's own
// view host (web/hk/shell/hk-view-host.js) -- no Lovelace: no hui-root, no hui-view, no
// hui-card, no Lovelace-wide state.
//
// HA makes this element (panel_custom) and sets on it what it sets on every panel: `hass`,
// `narrow`, `route` and `panel`. This file is the HA adapter for that: the only place in it
// that names HA's object is the `hass` setter, which turns it into HK's client at once
// (hkHostClient.from). What it does with the client is what Mantel's web/home.js does:
//
//   1. load the dashboard's card code: the Lovelace resources (lovelace/resources, the same
//      list Lovelace loads) and HK's own card files (the panel's config, from resources.py),
//      as HA's own loader does (a module imported, a stylesheet linked);
//   2. read the screen's own strategy options (lovelace/config of the screen the panel is set
//      to draw, its `strategy:` block), and generate the dashboard with HK's strategy
//      (hkStrategy.generate), exactly as Lovelace would for that dashboard;
//   3. draw it with HK's view host in this panel's own container, the views routed under the
//      panel's address (/<panel>/<view>), and the host shell put in its "panel" mode
//      (hkHAShell.ownPanel), so the sky, the menu and the tab bar find this panel's view;
//   4. hand every new client to the view host; build again when the strategy asks
//      (config-refresh: a settings change) or the registries change (shouldRegenerate).
//
// Leaving the panel (another HA page) puts the shell back in its Lovelace mode.
(function (global) {
  'use strict';
  var TAG = 'hk-ha-panel';
  var ce = global.customElements;
  if (!ce || ce.get(TAG)) return;

  var BOOT_WAIT_MS = 20000;

  // HK's ordered boot (boot.py) runs at HA's bootstrap; a panel opened straight away can
  // arrive first. Its readiness events, with a slow poll behind them.
  function booted() {
    return !!(global.hkClient && global.hkHostClient && global.hkShell && global.hkHAShell);
  }
  function whenBooted() {
    if (booted()) return Promise.resolve();
    return new Promise(function (res, rej) {
      var t0 = Date.now(), iv = null;
      function check() {
        if (booted()) { done(); res(); } else if (Date.now() - t0 > BOOT_WAIT_MS) { done(); rej(new Error('HK has not loaded (hk-boot.js)')); }
      }
      function done() {
        clearInterval(iv);
        ['hk-host-shell-ready', 'hk-ha-client-ready'].forEach(function (e) { global.removeEventListener(e, check); });
      }
      ['hk-host-shell-ready', 'hk-ha-client-ready'].forEach(function (e) { global.addEventListener(e, check); });
      iv = setInterval(check, 250);
    });
  }

  // the module loader (a test hands its own)
  var loader = { import: function (url) { return import(url); } };
  function importOnce(url) {
    return Promise.resolve().then(function () { return loader.import(url); }).catch(function (err) { console.error('[hk-ha-panel] could not load ' + url, err); });
  }

  // HA's loadLovelaceResources, for this page: a stylesheet linked once, a module imported
  // (the same URL as Lovelace's is the same module: it runs once).
  function bare(url) { return String(url || '').split('?')[0]; }
  function linked(url) {
    var links = global.document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) if (bare(links[i].getAttribute('href')) === bare(url)) return true;
    return false;
  }
  function loadResources(list) {
    var seen = {}, mods = [];
    (list || []).forEach(function (r) {
      var url = r && r.url, key = bare(url);
      if (!url || seen[key]) return;
      seen[key] = 1;
      if (r.type === 'css') {
        if (!linked(url)) {
          var l = global.document.createElement('link');
          l.rel = 'stylesheet';
          l.href = url;
          global.document.head.appendChild(l);
        }
      } else if (r.type === 'module') {
        mods.push(importOnce(url));
      } else if (r.type === 'js') {
        // a classic script resource: HA adds a <script>; import() runs it the same way here
        mods.push(importOnce(url));
      }
    });
    return Promise.all(mods);
  }

  function cardsReady() {
    if (global.hkCards && global.hkCards.TILE) return Promise.resolve();
    return new Promise(function (res) { global.addEventListener('hk-cards-ready', function () { res(); }, { once: true }); });
  }

  // A view's theme (the strategy names HK Kiosk), as HA applies one to a view: its
  // variables on the view's container, the dark mode's over the theme's own.
  function applyTheme(el, themes, name) {
    var prev = el.__hkThemeKeys || [];
    prev.forEach(function (k) { el.style.removeProperty(k); });
    el.__hkThemeKeys = [];
    var t = name && themes && themes.themes && themes.themes[name];
    if (!t || typeof t !== 'object') return;
    var vars = {};
    Object.keys(t).forEach(function (k) { if (k !== 'modes') vars[k] = t[k]; });
    var dark = t.modes && t.modes.dark;
    if (dark && typeof dark === 'object') Object.keys(dark).forEach(function (k) { vars[k] = dark[k]; });
    Object.keys(vars).forEach(function (k) {
      var v = vars[k];
      if (v === null || typeof v === 'object') return;
      var prop = '--' + k;
      el.style.setProperty(prop, String(v));
      el.__hkThemeKeys.push(prop);
    });
  }

  var CSS = ':host{display:block;position:relative;min-height:100vh;background:#05070e;color:#fff;' +
            'font-family:var(--ha-font-family-body,-apple-system,system-ui,sans-serif)}' +
            // the view container: the sky mounts in it, behind the view (as Mantel's page)
            'hk-view-container{display:block;position:relative;isolation:isolate;min-height:100vh}' +
            '#app{min-height:100vh}' +
            '.hk-panel-note{padding:24px;font:500 14px/1.4 -apple-system,system-ui,sans-serif;color:rgba(255,255,255,.75)}';

  class HkHaPanel extends HTMLElement {
    constructor() {
      super();
      this._client = null;
      this._input = null;
      this._host = null;
      this._building = null;
      this._again = false;
      this._regenTimer = 0;
      this._onRefresh = this._onRefresh.bind(this);
    }

    // ---- what HA sets on a panel
    set hass(input) {
      var old = this._input;
      this._input = input;
      if (!booted()) {
        // HK's boot not run yet: this same input again once it has
        var self = this;
        if (!this._bootWait) {
          this._bootWait = whenBooted().then(function () { self._bootWait = null; self.hass = self._input; },
            function (err) { self._bootWait = null; self._note(String((err && err.message) || err)); });
        }
        return;
      }
      var c = global.hkHostClient.from(input);
      if (!c) return;
      this._client = c;
      if (this._host) this._host.setClient(c);
      this._watchRegistries(old, input);
      this._kick();
    }
    get hass() { return this._input; }
    set narrow(v) { this._narrow = !!v; }
    get narrow() { return !!this._narrow; }
    set route(v) { this._route = v; }
    get route() { return this._route; }
    set panel(v) { this._panel = v; this._kick(); }
    get panel() { return this._panel; }

    // the panel's address, its first segment (hk-panel)
    _url() {
      var p = this._panel;
      return String((p && p.url_path) || global.location.pathname.split('/')[1] || '');
    }
    _screen() {
      var cfg = this._panel && this._panel.config;
      return String((cfg && cfg.screen) || '');
    }

    connectedCallback() {
      if (!this.shadowRoot) {
        var sr = this.attachShadow({ mode: 'open' });
        var st = global.document.createElement('style');
        st.textContent = CSS;
        sr.appendChild(st);
        this._view = global.document.createElement('hk-view-container');
        this._view.id = 'view';
        this._app = global.document.createElement('div');
        this._app.id = 'app';
        this._view.appendChild(this._app);
        sr.appendChild(this._view);
      }
      this.addEventListener('config-refresh', this._onRefresh);
      if (this._host) {
        // back on this panel (HA keeps a panel it has made): the shell in panel mode again
        global.hkHAShell.ownPanel(this, this._host, this._url());
        this._host.start();
        if (this._client) this._host.setClient(this._client);
      }
      this._kick();
    }

    disconnectedCallback() {
      this.removeEventListener('config-refresh', this._onRefresh);
      clearTimeout(this._regenTimer);
      if (this._host) this._host.stop();
      if (global.hkHAShell) global.hkHAShell.lovelace(this);
    }

    // Build once there is a client, an address and a place to draw.
    _kick() {
      if (this._host || this._building || !this._client || !this._panel || !this._app || !this.isConnected) return;
      var self = this;
      this._building = this._build().catch(function (err) {
        console.error('[hk-ha-panel] could not draw the screen', err);
        self._note('HK could not draw this screen: ' + ((err && err.message) || err));
      }).then(function () { self._building = null; });
    }

    _note(text) {
      if (!this._app) return;
      var n = global.document.createElement('div');
      n.className = 'hk-panel-note';
      n.textContent = text;
      while (this._app.firstChild) this._app.removeChild(this._app.firstChild);
      this._app.appendChild(n);
    }

    // The screen's own strategy options: its Lovelace config's `strategy:` block (the
    // Overview is "lovelace", Lovelace's url_path null). None (no screen, not a generated
    // dashboard, unreadable): HK's defaults.
    _strategyOptions(client) {
      var screen = this._screen();
      if (!screen || !client.callWS) return Promise.resolve({});
      return client.callWS({ type: 'lovelace/config', url_path: screen === 'lovelace' ? null : screen, force: false })
        .then(function (cfg) {
          var s = cfg && cfg.strategy;
          return (s && typeof s === 'object' && String(s.type || '').slice(-12) === 'hk-dashboard') ? s : {};
        })
        .catch(function () { return {}; });
    }

    _resources(client) {
      var own = (this._panel && this._panel.config && this._panel.config.resources) || [];
      var mine = own.map(function (r) { return { type: r[0], url: r[1] }; });
      var ask = client.callWS ? client.callWS({ type: 'lovelace/resources' }).catch(function () { return []; }) : Promise.resolve([]);
      return ask.then(function (list) { return loadResources([].concat(list || [], mine)); });
    }

    async _build() {
      await whenBooted();
      var client = this._client;
      await importOnce('/hk/shell/hk-view-host.js');
      await this._resources(client);
      if (!global.hkStrategy) await importOnce('/hk/cards/hk-strategy.js');
      await cardsReady();
      var options = await this._strategyOptions(client);
      var config = await global.hkStrategy.generate(options, this._client || client);
      this._mount(config);
      await this._host.start();
    }

    _mount(config) {
      var self = this, url = this._url();
      while (this._app.firstChild) this._app.removeChild(this._app.firstChild);
      var host = global.hkViewHost.create({
        container: this._view,
        slot: this._app,
        config: config,
        client: this._client,
        base: '/' + url,
        // the client comes from HA's `hass` on this panel (the setter above)
        follow: false,
        // another HA page: HA's own router moves there; nothing to load here
        leave: function () {}
      });
      this._host = host;
      host.onView(function (el, view) {
        applyTheme(self._view, self._client && self._client.themes, view && view.theme);
      });
      global.hkHAShell.ownPanel(this, host, url);
    }

    // A settings change the strategy says needs a new build (config-refresh, hk-strategy.js
    // refresh()), or new registries: built again, on the view shown.
    _onRefresh(ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      this._rebuild();
    }
    _watchRegistries(oldInput, newInput) {
      var S = global.hkStrategy;
      if (!this._host || !oldInput || oldInput === newInput || !S || !S.shouldRegenerate) return;
      var again = false;
      try { again = S.shouldRegenerate({}, oldInput, newInput); } catch (e) { again = false; }
      if (!again) return;
      var self = this;
      clearTimeout(this._regenTimer);
      this._regenTimer = setTimeout(function () { self._rebuild(); }, 1000);
    }
    _rebuild() {
      if (!this._host) return;
      if (this._building) { this._again = true; return; }
      var self = this;
      this._building = (async function () {
        var options = await self._strategyOptions(self._client);
        var config = await global.hkStrategy.generate(options, self._client);
        if (self._host) self._host.stop();
        self._host = null;
        self._mount(config);
        if (self.isConnected) await self._host.start();
      })().catch(function (err) {
        console.error('[hk-ha-panel] could not build the screen again', err);
      }).then(function () {
        self._building = null;
        if (self._again) { self._again = false; self._rebuild(); }
      });
    }
  }

  ce.define(TAG, HkHaPanel);
  global.hkHAPanel = { tag: TAG, applyTheme: applyTheme, loadResources: loadResources, loader: loader };
})(globalThis);
