// hk-weather-details.js - the details and radar cards.
//
// PART OF THE WEATHER CARDS (hk-weather.js). Not a card and not run on its own: it registers one
// function, which hk-weather.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkWeatherParts = window.hkWeatherParts || {})['hk-weather-details'] = function (K) {
    var BAND_KEYS = K.BAND_KEYS, Base = K.Base, build = K.build, buildDue = K.buildDue, C = K.C,
        houseWeather = K.houseWeather, ownKeys = K.ownKeys, wxEnter = K.wxEnter, wxLeave = K.wxLeave,
        wxPage = K.wxPage;

    // ------------------------------------------- hk-weather-details-card
    // THE PAGE'S DETAILS: the tiles weather.page.details names, in its order
    // (read live), six across on a wide screen, three on an upright tablet,
    // two on a phone -- by this card's own width. One forecast watch for all
    // of them (the band's _forecast, shared with the page's other cards).
    class HkWeatherDetailsCard extends Base {
      static get CSS() {
        return ':host{display:block}' +
          '.dg{display:grid;grid-template-columns:repeat(var(--n,6),minmax(0,1fr));gap:var(--hk-gap,10px)}';
      }
      setConfig(config) {
        this._hkOwn = ownKeys(config, BAND_KEYS);
        super.setConfig(Object.assign({}, config || {}));
        houseWeather(this, this.client, BAND_KEYS);
      }
      // each new client: the house's weather resolved first, then HkBase's step
      _receiveClient() { houseWeather(this, this.client, BAND_KEYS); super._receiveClient(); }
      _sigOf() {
        var h = this.client;
        if (!h) return null;
        var src = this._sources(), HS = window.hkSettings, ids = [this._config.entity, src.hourly, src.daily, 'sun.sun',
          HS ? HS.get('weather.wind', null) : null, HS ? HS.get('weather.gust', null) : null, HS ? HS.get('weather.uv', null) : null,
          HS ? HS.get('weather.humidity', null) : null, HS ? HS.get('sky.moon', null) : null];
        return 'fc=' + (this._fcN || 0) + ';d=' + wxPage().details.join(',') + ';' + ids.map(function (id) {
          var st = id && h.states[id]; return (id || '') + '=' + (st ? st.last_updated : 'x');
        }).join(';') + ';h=' + Math.floor(Date.now() / 3600e3) + ';m=' + Math.floor(Date.now() / 600e3);
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        wxEnter(this);
        var self = this;
        if (!this._ro && typeof ResizeObserver === 'function') {
          this._ro = new ResizeObserver(function (en) {
            var w = en[0] && en[0].contentRect ? en[0].contentRect.width : 0;
            var n = w > 1000 ? 6 : w > 560 ? 3 : 2;
            if (n !== self._cols) { self._cols = n; if (self._grid) self._grid.style.setProperty('--n', n); }
          });
          this._ro.observe(this);
        }
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        wxLeave(this);
        var tiles = this._tiles || {};
        Object.keys(tiles).forEach(function (k) { wxLeave(tiles[k]); });
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this._fcRelease();
        this._hkSig = null;
      }
      _render() {
        if (!this._config || !this.client) return;
        if (!this._grid) {
          this._root.innerHTML = '<div class="dg" role="list" aria-label="Weather details"></div>';
          this._grid = this._root.querySelector('.dg');
          if (this._cols) this._grid.style.setProperty('--n', this._cols);
          this._tiles = {};
        }
        var self = this, HS = window.hkSettings, want = wxPage().details;
        var wx = { hourly: this._forecast('hourly', this._sources().hourly), daily: this._forecast('daily', this._sources().daily) };
        var order = want.join(',');
        if (order !== this._order) {
          this._order = order;
          Object.keys(this._tiles).forEach(function (k) { if (want.indexOf(k) < 0) { self._tiles[k].remove(); delete self._tiles[k]; } });
          want.forEach(function (k) {
            var t = self._tiles[k];
            if (!t) {
              t = self._tiles[k] = document.createElement('hk-weather-tile-card');
              t.setAttribute('role', 'listitem');
              var cfg = { type: 'custom:hk-weather-tile-card', variant: k, look: 'page', glass: self._config.glass };
              if (k === 'sun') cfg.sun = 'sun.sun';
              if (k === 'moon' && HS && HS.get('sky.moon', null)) cfg.phase = HS.get('sky.moon', null);
              t.setConfig(cfg);
            }
            self._grid.appendChild(t);      // in order (appending moves it)
          });
        }
        want.forEach(function (k) {
          var t = self._tiles[k];
          t._wx = wx;
          t._hkSig = null;
          window.hkHostClient.bridge(t, self.client);
        });
        // the tiles build one after another, 70 ms apart
        if (want.length && buildDue(this)) {
          want.forEach(function (k, i) {
            var t = self._tiles[k];
            t.style.setProperty('--d', (i * 70) + 'ms');
            build(t, t._e && t._e.card);
          });
        }
      }
      getCardSize() { return 4; }
    }

    // -------------------------------------------------- hk-radar-card
    // THE WEATHER PAGE'S RADAR (2026-10-16): a shell that holds the card's
    // place and imports modules/hk-radar.js -- the map, the providers and
    // the playback -- only when the radar is on (weather.radar_native) and
    // the card is on a page. Off, or never shown, nothing is loaded and
    // nothing is asked of any map or radar service.
    var RADAR_URL = '/hk/modules/hk-radar.js';
    var radarLoad = null;
    function radarModule() {
      if (window.hkRadar) return Promise.resolve(window.hkRadar);
      if (!radarLoad) {
        // (hkV: Mantel's build's ?v= on the module's address, web/shim/base.js)
        radarLoad = import(window.hkV ? window.hkV(RADAR_URL) : RADAR_URL).then(function () { return window.hkRadar; }, function (e) {
          radarLoad = null;
          throw e;
        });
      }
      return radarLoad;
    }
    class HkRadarCard extends Base {
      static get CSS() {
        return ':host{display:block}' +
          '.ph{box-sizing:border-box;height:var(--hk-wx-radar-h,455px);' + C.plate('card') + ';background:#1b2b33;' +
          'display:grid;place-content:center;font-size:14px;font-weight:500;color:rgba(255,255,255,.7)}' +
          '@media (max-width:' + C.BP.phone + 'px){.ph{height:var(--hk-wx-radar-h-phone,430px)}}' +
          ':host([data-hk-cell]) .ph{height:100%}';
      }
      _sigOf() {
        var h = this.client, HS = window.hkSettings;
        if (!h || !HS || !HS.radarNative) return null;
        var r = HS.radarNative(), z = r.zone && h.states[r.zone], rd = HS.rendering ? HS.rendering() : {};
        return JSON.stringify([r, z ? z.last_updated : null, h.config && h.config.latitude, h.config && h.config.longitude,
                               h.config && h.config.country, rd.flat, rd.theme]);
      }
      _render() {
        var HS = window.hkSettings;
        if (!this.client || !HS || !HS.radarNative) return;
        var on = HS.radarNative().enabled;
        this.style.display = on ? '' : 'none';
        if (!on) { this._detach(); this._root.innerHTML = ''; return; }
        if (this._ctl) { this._ctl.update(this.client); return; }
        if (!this._root.firstChild) this._root.innerHTML = '<div class="ph" role="status">Loading the radar…</div>';
        if (!this.isConnected || this._loading) return;
        var self = this;
        this._loading = true;
        radarModule().then(function (M) {
          self._loading = false;
          if (!self.isConnected || self._ctl || !HS.radarNative().enabled) return;
          self._ctl = M.attach(self, self._root);
          self._ctl.update(self.client);
        }, function (e) {
          self._loading = false;
          console.warn('[hk-weather] the radar could not load', e);
          self._root.innerHTML = '<div class="ph" role="status">The radar couldn’t load. Reload the page to try again.</div>';
        });
      }
      _detach() { if (this._ctl) { this._ctl.detach(); this._ctl = null; } }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        wxEnter(this);
        if (this.client) this.redraw();
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        wxLeave(this);
        this._detach();
        this._root.innerHTML = '';
        this._hkSig = null;
      }
      getCardSize() { return 9; }
    }

    // ------------------------------------------------------------------
    // THE HEADER'S TWO HALVES AS CARDS.
    //
    // A CARD IS CONFIGURED AT ITS CALL SITE. A shared YAML snippet arrives by
    // `!include`, an include takes no keys, and custom:layout-card forwards
    // only grid*/place-* to children -- so the only way to size one
    // differently per dashboard would be CSS custom properties published by a
    // whole extra theme and read through `var()` in an inline style. As a
    // card, the Tesla writes `main_size: 26px` next to it and needs no theme.
    //
    // BOTH ARE THIN. The markup is hk-header.js's -- the same builders the wall
    // header itself calls -- so these cards are option mapping and a plate,
    // and cannot drift from the header.
    function opts(cfg, map) {
      var o = {};
      for (var k in map) { if (cfg[k] != null) o[map[k]] = cfg[k]; }
      return o;
    }

    // what the shell and the later parts use of this one
    K.HkRadarCard = HkRadarCard; K.HkWeatherDetailsCard = HkWeatherDetailsCard; K.opts = opts;
  };
})();
