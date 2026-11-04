// hk-settings.js -- HK SETTINGS, the admin page (panel.py), built as an
// Apple settings screen:
//
//   OVERVIEW       where settings live, setup status
//   SCREENS        each dashboard, one page: Menu, Home Page, Pages,
//                  Appearance, Behavior -- a live preview beside it
//   ALL SCREENS    General, Weather, Appearance, Sky,
//                  Menu, Rooms (and each room's page), Wall Tablets
//   FEATURES       Music, Live TV, Alarm PIN, Clean Areas
//                  (hk-settings-features.js)
//   LIBRARY        Accessories (by type, then room), Pop-ups, Custom Pages,
//                  Custom Chips
//   SYSTEM         Advanced, Setup Check (+ the Setup Assistant)
//
// A sidebar with search beside the page on a wide window; stacked pages with
// a back button on a phone. The address is the page (#/screens/dashboard-
// kitchen/chips), so Back, reload and links work.
//
// EVERY CONTROL SAVES AS IT CHANGES, as Settings does: only what changed
// goes to the integration (hk_frontend/settings/set, hk_frontend/board/set --
// settings_api.py checks it the way Configure does), and the bar says Saved
// or what went wrong, beside the field. Configure (HA's own dialogs) keeps
// working on the same storage; either can be used.
//
// Words and the small decisions (what a list shows, what a change saves)
// are hk-settings-model.js; the controls are hk-settings-kit.js.
//
// THE HOST'S SETTINGS (hkShell.settingsHost(), null on a host without any):
// a host may put its own pages beside HK's, drawn with the same kit. The page
// knows nothing of them but this shape:
//   { title       the page's name in place of "HK Settings"
//     house       false: the host's pages only (HK's own are not read)
//     groups()    [{ header, place: 'top' | 'end', rows: [{ route, label,
//                 sub, tile: [icon, color] }] }] -- sidebar groups, above
//                 Overview ('top') or after System ('end')
//     page(parts, panel)  the page for an address the host owns, or null
//     forward(path)       an old address of the host's -> where it is now
//     first()             where an empty address opens (null: Overview)
//     search()            [{ label, route, where, words }]
//     notes               { overview, screen_remove, add_screen, secure }: the
//                 host's words where HK's own page differs on it (secure:
//                 where to look when talking at the door needs HTTPS)
//     screenBase          the prefix of a screen's own address
//     saverPage           true: a screen's address with ?hk_preview=saver is
//                         a page of only its screensaver (the preview's, on
//                         the screensaver's pages)
//     back                { label, href }: the way out, on a host with no
//                 sidebar of its own
//     owns        { tablet_user: true }: what of HK's own the host keeps
//                 itself, so HK's control for it is not drawn (a wall
//                 tablet's Tablet User: the host's 'tablet' group has it)
//                 files: '<route>': the font and glyphs are the host's own
//                 (that route's page), not HK's folder under /config
//                 sidebar: true: no Home Assistant sidebar of HK's to show
//     extend(where, c, ctx, panel)  the host's own groups on one of HK's
//                 pages, appended to c: where 'tablets' (Wall Tablets, after
//                 its list; ctx { tablets }), 'tablet' (a wall tablet's
//                 page, after Setup; ctx { tablet, name, app }), 'screen'
//                 (a screen's page, after This Device; ctx { screen, title }),
//                 'saver' (a screen's Screensaver Options, first; ctx { screen,
//                 title }) or 'house-saver' (All Screens' Screensaver, after
//                 Photos; ctx { photos, set(source) })
//     gridHistory(path, panel) a promise for this screen’s layout history,
//                 absent on a host without layout history
//     tabletHealth(panel) a promise for each wall tablet's latest frame
//                 rate: [{name, screens, fps, fps_screen, fps_style,
//                 fps_sig, fps_at, secure}] (a screen's Appearance recommends one
//                 lighter setting at a time from it); absent where tablets
//                 report to nobody
//     press(ids, panel)  a tablet's own parts that are the host's, not HA
//                 buttons (Reload, Clear Cache: tablets[].parts), pressed:
//                 a promise (rejected with a message to show), or null to
//                 leave them to HA's button.press }
// Home Assistant has none, so nothing of another host's is drawn, read or
// said there.
// @ts-check
(function () {
  'use strict';
  if (customElements.get('hk-settings-panel')) return;

  var DOMAIN = 'hk_frontend';
  var M = null, K = null, h = null, F = null;

  // the modules, fetched beside this one with its version (panel.py puts the
  // files' time on our URL)
  function stamp(panel) {
    try { var u = panel.config._panel_custom.module_url; var m = /[?&]v=(\d+)/.exec(u); if (m) return m[1]; } catch (e) { /* none */ }
    return String(Date.now());
  }
  // A BACKGROUND PHOTO, made no bigger than `max` px on its long side and
  // saved as a JPEG, before it is uploaded (photoUpload). Its pixels come
  // through a canvas, so what is stored carries no location or camera data.
  function shrinkPhoto(file, max) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, hh = img.naturalHeight, k = Math.min(1, max / Math.max(w, hh, 1));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(hh * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(u);
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error('It couldn’t be made into a JPEG.')); }, 'image/jpeg', 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(u); reject(new Error('That file isn’t a picture this browser can open.')); };
      img.src = u;
    });
  }
  // AN HTTP WRITE TO THE HOST'S API (a config flow's start, step or
  // abandon), made exactly as the frontend's own callApi makes one, but
  // through the client's action port (`request`, an authenticated fetch of a
  // path on the host): the path under /api/; a JSON body, with its type, when
  // there is one; the answer read as JSON when it says it is JSON, else as
  // text; an error answer, a body that won't parse or a request that never
  // arrived thrown as {error, status_code, body}, as callApi throws them. A
  // host that cannot act refuses (commands_disabled), sending nothing, and
  // that refusal is passed on as it is.
  function restWrite(actions, method, path, body) {
    var init = { method: method, headers: {} };
    if (body) {
      init.headers['Content-Type'] = 'application/json;charset=UTF-8';
      init.body = JSON.stringify(body);
    }
    return Promise.resolve(actions.request('/api/' + path, init)).then(function (res) {
      var type = res.headers.get('content-type');
      var read = type && type.indexOf('application/json') >= 0
        ? res.json().catch(function (e) { throw { error: 'Unable to parse JSON response', status_code: e && e.status, body: null }; })
        : res.text();
      return read.then(function (b) {
        if (!res.ok) throw { error: 'Response error: ' + res.status, status_code: res.status, body: b };
        return b;
      });
    }, function (e) {
      if (e && e.code === 'commands_disabled') throw e;
      throw { error: 'Request error', status_code: undefined, body: undefined };
    });
  }
  function ensureFont() {
    if (document.querySelector('link[data-hk-font]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/hk/fonts/sf-pro.css'; l.setAttribute('data-hk-font', '');
    document.head.appendChild(l);
  }
  // The dashboards' own modules, for an accessory's settings: the settings
  // feed they read, the glyphs, the detail sheet's pane.
  var cardsReady = null;
  var DETAIL_WAIT = 15000;
  // what the preview says under it: the screen, live; or the screensaver alone, each change as it is made
  var PV_SAYS = { screen: 'Live: changes show here within seconds. A generated screen rebuilds itself within about ten.',
                  saver: 'The screensaver alone, with live weather, music and photos: each change shows here as you make it.',
                  look: 'This screen’s look with a few of its cards on it: changes show here within moments.' };
  function loadCards() {
    if (cardsReady) return cardsReady;
    cardsReady = (async function () {
      var v = Date.now();
      var tries = [['hkSettings', '/hk/modules/hk-settings.js'], ['customIconsets', '/hk/iconset/hk-icons.js'],
                   ['hkCards', '/hk/cards/hk-base.js'], ['hkDetail', '/hk/cards/hk-detail.js']];
      for (var i = 0; i < tries.length; i++) {
        var t = tries[i];
        if (t[0] === 'customIconsets' ? (window.customIconsets && window.customIconsets.hk) : window[t[0]]) continue;
        try { await import(t[1] + '?v=' + v); } catch (e) { console.warn('[hk-settings] ' + t[1], e); }
      }
      // ...AND ITS SHEETS: hk-detail.js sets window.hkDetail only once it has fetched its panels (web/hk/sheets/),
      // a moment after its own import has returned -- so an accessory's page opened first thing (a search, a
      // link, a reload) found no detail and said it "couldn't load" (2026-10-31, the owner). It says when it is
      // up (hk-detail-ready); never waited for longer than DETAIL_WAIT, and tried again next time if it never came
      if (!window.hkDetail) {
        await new Promise(function (done) {
          var t = setTimeout(done, DETAIL_WAIT);
          window.addEventListener('hk-detail-ready', function () { clearTimeout(t); done(); }, { once: true });
        });
        if (!window.hkDetail) cardsReady = null;
      }
    })();
    return cardsReady;
  }

  // ------------------------------------------------------------ the parts (generated by tools/split_js.py)
  // THIS FILE IS THE SHELL. Its members are cut into the files of web/hk/settings/ (the PARTS below, in the order they
  // run) by tools/split_js.py from tools/split_manifests/settings.json; `split_js.py --find <name>` says which file holds
  // one. Each file registers one function in window.hkSettingsParts; they run here, in this order (a later one may use
  // an earlier one), each given the kit K: what the parts use of the shell, in one object. What the shell uses of them,
  // they hand back on K, and it is taken from there. The files are fetched in parallel; a host that has already loaded
  // them (the suites) starts at once, in the same turn.
  var PARTS = ['hk-settings-css.js', 'hk-settings-tables.js', 'hk-settings-screen.js', 'hk-settings-screen-pages.js',
               'hk-settings-add.js', 'hk-settings-house-pages.js', 'hk-settings-house-looks.js',
               'hk-settings-house-sky.js', 'hk-settings-rooms.js', 'hk-settings-accessories.js',
               'hk-settings-library.js'];
  var PARTS_TRIES = 6;
  function partKey(file) { return file.replace(/\.js$/, ''); }
  // ONE FILE THAT DIDN'T COME (a tablet's Wi-Fi waking, the server restarting) used to leave the cards dead until a reload
  // (the third audit pass, WEB-11): the ones still missing are asked for again, a little later each time, at an address
  // of their own -- a browser keeps a failed module's answer for its address
  function loadParts(then, n) {
    // (the first call has no n; the retries and the finish pass it) a shell evaluated twice before its parts arrive
    // must not run them twice: the flag is set at once, not when the parts have run
    if (n === undefined) {
      var started = window.__hkSplitStarted = window.__hkSplitStarted || {};
      if (started['hk-settings']) return;
      started['hk-settings'] = true;
    }
    n = n || 0;
    var have = window.hkSettingsParts || {};
    var missing = PARTS.filter(function (file) { return !have[partKey(file)]; });
    if (!missing.length) {
      try { then(); } catch (err) { console.error('[hk-settings] the parts did not start', err); }
      // (the checks that drive a page wait for every shell that started to say it is done)
      (window.__hkSplitDone = window.__hkSplitDone || {})['hk-settings'] = true;
      return;
    }
    // (window.hkV: the build's ?v= on an address put together here, web/shim/base.js)
    Promise.all(missing.map(function (file) {
      var u = '/hk/settings/' + file, href = window.hkV ? window.hkV(u) : u;
      var got = n ? import(href + (href.indexOf('?') < 0 ? '?' : '&') + 'retry=' + n) : import(href);
      return got.catch(function (err) { return err; });
    })).then(function (got) {
      var err = got.filter(function (r) { return r instanceof Error; })[0];
      var left = PARTS.filter(function (file) { return !(window.hkSettingsParts || {})[partKey(file)]; });
      if (!left.length) { loadParts(then, n); return; }
      err = err || new Error(left[0] + ' ran without registering');
      if (n + 1 >= PARTS_TRIES) { console.error('[hk-settings] the parts did not start', err); return; }
      console.warn('[hk-settings] a part did not load (' + err.message + '); again shortly');
      setTimeout(function () { loadParts(then, n + 1); }, Math.min(1000 * Math.pow(2, n), 15000));
    });
  }
  // ------------------------------------------------------------ end of the parts loader
  var BACK, C, CSS, HOUSE, LIBRARY, PENCIL, SYSTEM, TICK;

  class HkSettingsPanel extends /** @type {HkLooseElementConstructor} */ (HTMLElement) {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.errors = {};
      this.pickers = {};
      this.q = '';
      this.hist = [];
      this.from = loadFrom();
      this._onHash = this.onHash.bind(this);
      this._onClick = this.onClick.bind(this);
      // A PRESS IN PROGRESS: see render(). Released after the press's click.
      var self = this;
      // NOT a press on a pop-up menu (a <select>): its list is the browser's
      // own, and on a Mac that list swallows the release -- the page heard no
      // pointerup, every redraw after the choice was held, and the row kept
      // showing where the page had been until the next click anywhere
      this._onPress = function (e) {
        var t = e && e.composedPath ? e.composedPath()[0] : e && e.target;
        if (t && t.tagName === 'SELECT') return;
        self._pressing = true;
      };
      this._onRelease = function () {
        if (!self._pressing) return;
        setTimeout(function () {
          self._pressing = false;
          var held = self._held;
          self._held = null;
          if (held) self.render(held.background, held.navigated);
        }, 0);
      };
      // typing over: a redraw skipped while typing (render(true)) is drawn now
      this._onFocusOut = function () {
        setTimeout(function () {
          if (self._dirty && !self.typing()) { self._dirty = false; self.render(true); }
        }, 0);
      };
    }
    // THE HOST'S ENTRY (window.hkHostClient.entry, below): Home Assistant's
    // panel_custom hands this element the frontend's object; the page gets
    // the host adapter's client for each new one, and reads `this.client`.
    // The first one starts the page; each one may change light/dark.
    _onClient(client) {
      var first = !this._hadClient;
      this._hadClient = client;
      if (first) this.boot();
      var dark = !!(client && client.themes && client.themes.darkMode);
      if (dark !== this.hasAttribute('dark')) this.toggleAttribute('dark', dark);
      // the host's own sidebar button, when it drew one, follows the client
      if (this._menuBtn) window.hkShell.menuButton(this._menuBtn, { client: client });
    }
    set narrow(v) { this._narrow = v; if (this._menuBtn) window.hkShell.menuButton(this._menuBtn, { narrow: v }); if (this.ready) this.render(); }
    set panel(v) { this._panel = v; }
    set route(v) { /* our own hash is the route */ }
    // NAVIGATION: our own links are "#/..." and handled here. Home Assistant
    // routes link clicks itself (history.pushState, which fires no
    // hashchange): the address would change and the page would not. So a
    // click on one of ours is ours, and HA's own navigation events are heard
    // too.
    connectedCallback() {
      window.addEventListener('hashchange', this._onHash);
      window.addEventListener('popstate', this._onHash);
      window.hkShell.onNavigate(this._onHash);
      this.shadowRoot.addEventListener('pointerdown', this._onPress, true);
      window.addEventListener('pointerup', this._onRelease, true);
      // a choice made is a press over, whatever the browser told us
      this.shadowRoot.addEventListener('change', this._onRelease, true);
      window.addEventListener('pointercancel', this._onRelease, true);
      this.shadowRoot.addEventListener('focusout', this._onFocusOut);
      if (this.ready) { this.subscribe(); this.render(); }
    }
    disconnectedCallback() {
      window.removeEventListener('hashchange', this._onHash);
      window.removeEventListener('popstate', this._onHash);
      window.hkShell.offNavigate(this._onHash);
      this.shadowRoot.removeEventListener('pointerdown', this._onPress, true);
      window.removeEventListener('pointerup', this._onRelease, true);
      window.removeEventListener('pointercancel', this._onRelease, true);
      this.shadowRoot.removeEventListener('change', this._onRelease, true);
      this.shadowRoot.removeEventListener('focusout', this._onFocusOut);
      this._pressing = false; this._held = null;
      // nothing of this page's keeps running while it is away: a reload due,
      // a preview frame still being asked for its sky or screensaver, the
      // bar's status fading
      clearTimeout(this._soonT); clearTimeout(this._stT);
      clearInterval(this._skyWait); clearInterval(this._saverWait);
      this._soonT = this._stT = this._skyWait = this._saverWait = null;
      if (this._unsub) { try { this._unsub(); } catch (e) { /* gone */ } this._unsub = null; }
    }

    // ---------------------------------------------------------- start
    async boot() {
      var s = this.shadowRoot, self = this;
      s.innerHTML = '<div class="loading">Loading…</div>';
      ensureFont();
      var v = stamp(this._panel);
      // (asked for again, a little later each time and at an address of its own, when a file didn't come: it showed
      // "couldn't load" until a reload; the third audit pass, 2026-11-01)
      this._bootTry = (this._bootTry || 0) + 1;
      if (this._bootTry > 1) v += '&retry=' + this._bootTry;
      try {
        await Promise.all([partsReady, import('/hk/panels/hk-settings-model.js?v=' + v), import('/hk/panels/hk-settings-kit.js?v=' + v),
                           import('/hk/panels/hk-settings-features.js?v=' + v), import('/hk/modules/hk-settings.js?v=' + v),
                           import('/hk/modules/hk-flat-image.js?v=' + v), import('/hk/modules/hk-drag.js?v=' + v),
                           // (the Wallpaper picker's previews, 2026-10-30)
                           import('/hk/modules/hk-wallpapers.js?v=' + v),
                           // (the grid editor's palette presses go through hk-drag.js)
                           import('/hk/cards/hk-grid-catalog.js?v=' + v).then(function () { return import('/hk/panels/hk-grid-editor.js?v=' + v); })]);
      } catch (e) {
        var again = this._bootTry < 5;
        s.innerHTML = '<div class="loading"></div>';
        s.firstChild.textContent = 'HK settings couldn’t load: ' + String(e && e.message || e) + (again ? '. Trying again…' : '');
        if (again) setTimeout(function () { if (self.isConnected) self.boot(); }, 1000 * Math.pow(2, this._bootTry - 1));
        return;
      }
      M = window.hkSettingsModel; K = window.hkSettingsKit; h = K.h; F = window.hkSettingsFeatures; F.use(K);
      bindLate();
      s.innerHTML = '<style>' + K.CSS + '\n' + CSS + '</style>' +
        '<div class="app" data-view="root"><nav class="side" aria-label="HK settings"></nav>' +
        '<main class="detail"><div class="bar"><div class="lead"></div><div class="mid" aria-hidden="true"></div>' +
        '<div class="st" role="status" aria-live="polite"></div></div><div class="scroll"><div class="page"></div></div></main></div>' +
        '<div class="live" aria-live="assertive"></div>';
      s.addEventListener('click', this._onClick);
      this.app = s.querySelector('.app');
      this.sideEl = s.querySelector('.side');
      this.bar = s.querySelector('.bar');
      this.scrollEl = s.querySelector('.scroll');
      this.pageEl = s.querySelector('.page');
      this.liveEl = s.querySelector('.live');
      this.scrollEl.addEventListener('scroll', function () {
        self.bar.classList.toggle('scrolled', self.scrollEl.scrollTop > 30);
      }, { passive: true });
      this.sideEl.addEventListener('scroll', function () {
        self.sideEl.classList.toggle('scrolled', self.sideEl.scrollTop > 2);
      }, { passive: true });
      new ResizeObserver(function () { self.measure(); }).observe(this);
      this.measure();
      // THE HOST'S PAGES ONLY (someone who may not change the house's): HK's
      // own settings are never read
      var hx = this.host();
      this.hostOnly = !!(hx && hx.house === false);
      if (this.hostOnly) {
        this.data = null;
        this.ready = true;
        this.onHash();
        return;
      }
      try { await this.reload(); } catch (e) {
        s.querySelector('.page').innerHTML = '';
        this.pageEl.appendChild(h('div', { class: 'big' }, [h('h2', { text: this.title() }),
          h('p', { text: String(e && e.message || e) })]));
        this.app.setAttribute('data-view', 'detail');
        return;
      }
      this.ready = true;
      this.subscribe();
      if (!location.hash && !this.data.setup_done && !this.data.dashboards.some(function (d) { return d.item; })) {
        history.replaceState(null, '', '#/setup');
      }
      this.onHash();
    }
    measure() {
      var w = this.getBoundingClientRect().width || window.innerWidth;
      // TWO COLUMNS from 700 px, as iOS Settings on an iPad: every iPad held
      // upright (744 to 1032 px) gets the list beside the page, a phone one
      // column (below 700 even in landscape: 932 px is the widest iPhone, but
      // 844 x 390 has no height for a sidebar, so that is height-checked)
      var tall = (this.getBoundingClientRect().height || window.innerHeight) >= 500;
      var wide = w >= 700 && tall, xwide = w >= 1320;
      var changed = wide !== this.hasAttribute('wide') || xwide !== this.hasAttribute('xwide');
      this.toggleAttribute('wide', wide);
      this.toggleAttribute('xwide', xwide);
      if (changed && this.ready) this.render();
      if (this._fit) this._fit();
    }
    async reload() {
      this.data = await this.client.callWS({ type: DOMAIN + '/panel/get' });
    }
    // every change, from here or anywhere (Configure, a gear, another
    // browser), comes back over the settings feed: read again and redraw
    // A subscription still on its way when the page is taken away is ended
    // the moment it arrives -- else it would live on unseen, reloading the
    // whole page's settings at every change made anywhere
    subscribe() {
      var port = this.client && this.client.subscriptions;
      if (this._unsub || this._subbing || !port) return;
      var self = this, first = true;
      this._subbing = true;
      port.subscribeMessage(function () {
        if (first) { first = false; return; }
        self.soon();
      }, { type: DOMAIN + '/settings/subscribe' }).then(function (u) {
        self._subbing = false;
        if (self.isConnected) self._unsub = u;
        else { try { u(); } catch (e) { /* gone */ } }
      }).catch(function () { self._subbing = false; /* older server */ });
    }
    soon() {
      var self = this;
      clearTimeout(this._soonT);
      this._soonT = setTimeout(function () {
        self.reload().then(function () { self.render(true); }).catch(function () { /* next change */ });
      }, 450);
    }

    // ---------------------------------------------------------- routing
    parts() {
      return (location.hash || '').replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
    }
    // THE HOST'S SETTINGS (above), read once when the page starts
    host() {
      if (this._host === undefined) {
        var o = null;
        try { o = window.hkShell && window.hkShell.settingsHost ? window.hkShell.settingsHost() : null; } catch (e) { o = null; }
        this._host = o && typeof o === 'object' ? o : null;
      }
      return this._host;
    }
    // @ts-expect-error title() shadows HTMLElement's title (a string); the element has always had the method
    title() { var x = this.host(); return (x && x.title) || window.hkShell.settingsName(); }
    hostScreenBase() { var x = this.host(); return (x && typeof x.screenBase === 'string') ? x.screenBase : ''; }
    hostNote(key) { var x = this.host(); return (x && x.notes && x.notes[key]) || null; }
    // the page an empty address shows: Overview, or the host's first
    rootPage() {
      var x = this.host();
      if (x && typeof x.first === 'function') {
        var f = x.first();
        if (f) { var pg = x.page(String(f).split('/'), this); if (pg) return pg; }
      }
      return this.hostOnly ? { title: this.title(), top: true, body: function () {} } : this.p_overview();
    }
    onClick(e) {
      if (e.defaultPrevented && !this._hashLink(e)) return;
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = this._hashLink(e);
      if (!a || a.getAttribute('target')) return;
      e.preventDefault();
      e.stopPropagation();
      var href = a.getAttribute('href');
      this.noteFrom(location.hash || '#/', href, !!(a.closest && a.closest('.side')));
      this.go(href);
    }
    // BACK GOES WHERE YOU CAME FROM, not to a page's fixed parent: in the
    // Setup Assistant, Radar Map's Back must return to the step, not to the
    // Weather page. A page opened by a link from anywhere else remembers that
    // page, and Back -- the bar's, and any "done, go back" -- returns there:
    // the wizard's step, the screen that linked to All Screens' glass. A
    // link to a page's own child, and anything from the sidebar or search,
    // starts fresh. Kept for the browser session, so a reload keeps it.
    noteFrom(from, to, fresh) {
      from = hashOf(from); to = hashOf(to);
      if (from === to) return;
      if (fresh) { delete this.from[to]; }
      else if (to === this.backHref(from)) { return; }         // going up: `to` keeps its own
      else if (this.staticBack(to) === from) { delete this.from[to]; }
      else { this.from[to] = from; }
      saveFrom(this.from);
    }
    staticBack(hash) {
      var parts = hashOf(hash).replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
      var pg = null;
      try { pg = this.resolve(parts); } catch (e) { return null; }
      return pg && pg.back ? hashOf(pg.back[1]) : (parts.length ? '#/' : null);
    }
    backHref(hash) { hash = hashOf(hash); return this.from[hash] || this.staticBack(hash); }
    labelOf(hash) {
      var parts = hashOf(hash).replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
      if (!parts.length) return this.title();
      try { var pg = this.resolve(parts); return (pg && (pg.backLabel || pg.title)) || 'Back'; } catch (e) { return 'Back'; }
    }
    _hashLink(e) {
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (n === this) break;
        if (n.tagName === 'A') return String(n.getAttribute('href') || '').charAt(0) === '#' ? n : null;
      }
      return null;
    }
    onHash() {
      // an old address shows the new one (Pages, 2026-10-16: M.routeForward;
      // the host's own: its forward)
      var hx = this.host(), here = this.parts().join('/');
      var fw = (hx && typeof hx.forward === 'function' && hx.forward(here)) || (this.hostOnly ? null : M.routeForward(here));
      if (fw) { try { history.replaceState(null, '', '#/' + fw.split('/').map(encodeURIComponent).join('/')); } catch (e) { /* no history */ } }
      var cur = location.hash || '#/';
      // hashchange, popstate and HA's location-changed can all say the same
      if (cur === this._seen && this.hist.length) return;
      this._seen = cur;
      // a rename left half-done is let go with the page
      this._renaming = null; this._renameDraft = null; this._renameErr = null;
      // our own history, to know whether Back can simply go back
      if (this.hist.length > 1 && this.hist[this.hist.length - 2] === cur) this.hist.pop();
      else if (this.hist[this.hist.length - 1] !== cur) this.hist.push(cur);
      // A SCREEN'S FIELD ERRORS ARE THAT SCREEN'S. They are kept by setting
      // (`b:<key>`), and every screen's page has the same settings: a refused
      // Kitchen Tablet Room showed under Loft's and Master Bathroom's too. On
      // to another screen, they go.
      var screen = (/^#\/screens\/([^/?#]+)/.exec(cur) || [])[1] || null;
      if (screen !== this._errScreen) {
        var self = this;
        Object.keys(this.errors).forEach(function (k) { if (/^b:/.test(k)) delete self.errors[k]; });
        this._errScreen = screen;
      }
      this.render(false, true);
    }
    go(hash) {
      if ((location.hash || '#/') === hash) { if (this._seen !== hash) this.onHash(); else this.render(); }
      else location.hash = hash;                           // -> hashchange -> onHash
    }
    // back to `hash`: the browser's Back when that is where we came from.
    // A page's fixed parent means the page it was opened from, if any.
    back(hash) {
      var cur = hashOf(location.hash || '#/');
      if (this.from[cur] && hashOf(hash) === this.staticBack(cur)) hash = this.from[cur];
      if (this.hist.length > 1 && this.hist[this.hist.length - 2] === hash) history.back();
      else this.go(hash);
    }
    // LEAVING A PAGE THAT HAD A FRAME OF ITS OWN (the Screensaver editor's screen): to `hash` in this page's own history
    // entry, never the browser's Back -- a frame's loads are entries too, and Back after the frame had gone took Safari
    // to the frame's address, the screensaver alone, full screen (2026-11-01, the owner: "Sometimes hitting save...
    // loads the Screensaver preview full screen")
    leaveTo(hash) {
      if ((location.hash || '#/') === hash) { this.go(hash); return; }
      location.replace(location.pathname + location.search + hash);      // -> hashchange -> onHash
    }
    announce(text) {
      var l = this.liveEl;
      l.textContent = '';
      setTimeout(function () { l.textContent = text; }, 30);
    }

    // A SWITCH THAT ASKS FIRST (Automatic, Same as All Screens): K.toggle
    // shows its new state at once, so a Cancel draws the page again -- the
    // switch back where it was -- and only an OK runs `yes`.
    confirmSwitch(opts, yes) {
      var self = this;
      return K.confirm(this.shadowRoot, opts).then(function (ok) {
        if (ok) return yes();
        self.render();
        return false;
      });
    }

    // ---------------------------------------------------------- saving
    status(kind) {
      var st = this.bar.querySelector('.st'), self = this;
      clearTimeout(this._stT);
      st.className = 'st' + (kind === 'error' ? ' err' : '');
      if (kind === 'saving') {
        this._stT = setTimeout(function () { st.textContent = 'Saving…'; }, 350);
      } else if (kind === 'saved') {
        st.innerHTML = TICK + '<span>Saved</span>';
        this._stT = setTimeout(function () { st.textContent = ''; }, 1800);
      } else if (kind === 'error') {
        st.textContent = 'Couldn’t Save';
        this._stT = setTimeout(function () { st.textContent = ''; st.className = 'st'; }, 5000);
      } else st.textContent = '';
      void self;
    }
    // One change (or a few) to the house's settings. `local` shows it at
    // once; the answer is the truth.
    setH(changes) {
      if (changes && Object.prototype.hasOwnProperty.call(changes, 'look.saver') && this._saverHouse) this.saverOver(changes['look.saver']);
      var d = this.data;
      return this.save({ type: DOMAIN + '/settings/set', changes: changes }, Object.keys(changes), function () {
        Object.keys(changes).forEach(function (p) {
          if (p === 'sidebar' || p === 'files_folder') { d.integration[p] = changes[p]; return; }
          var i = p.indexOf('.'), sec = p.slice(0, i), key = p.slice(i + 1);
          // (a patch -- look.flat_colors.accent -- is its caller's to show)
          if (key.indexOf('.') >= 0) return;
          if (d.settings[sec]) d.settings[sec][key] = changes[p];
        });
      }, function (r) { if (r && r.settings) d.settings = r.settings; });
    }
    setB(path, changes) {
      var d = this.data;
      if (changes && Object.prototype.hasOwnProperty.call(changes, 'screensaver_options') && !this._saverHouse && this._pv && this._pv.path === path) this.saverOver(changes.screensaver_options);
      return this.save({ type: DOMAIN + '/board/set', dashboard: path, changes: changes },
        Object.keys(changes).map(function (k) { return 'b:' + k; }), function () {
          var whole = {};
          Object.keys(changes).forEach(function (k) { if (k.indexOf('.') < 0) whole[k] = changes[k]; });
          d.boards[path] = Object.assign({}, d.boards[path] || {}, whole);
        // (over what the page had, not in its place: an answer without a key the page reads -- side_pane_read, the
        // screen's Side Pane as read -- must not take it away; one server's answer once had none, and the next Side
        // Pane change saved its one group alone, 2026-11-01)
        }, function (r) { if (r && r.board) d.boards[path] = Object.assign({}, d.boards[path] || {}, r.board); });
    }
    // A FEATURE'S OWN SETTINGS (hk-settings-features.js): read with its
    // `<id>/settings/get`, kept here while the page is open, read
    // again in the background when a minute old; saved one change at a time
    // with its `/set`, whose answer is the page again.
    feat(domain) {
      var st = (this.feats = this.feats || {})[domain] || (this.feats[domain] = {});
      if (!st.loading && (!st.at || Date.now() - st.at > 60000)) this.featLoad(domain);
      return st;
    }
    async featLoad(domain, fresh) {
      var st = this.feats[domain], self = this;
      st.loading = true;
      try {
        st.data = await this.client.callWS(Object.assign({ type: domain + '/settings/get' }, fresh ? { fresh: true } : {}));
        st.error = null;
      } catch (e) {
        st.error = String((e && e.message) || e);
      }
      st.loading = false; st.at = Date.now();
      self.render(true);
    }
    featSet(domain, changes, keys) {
      var st = this.feat(domain);
      keys = keys || Object.keys(changes);
      return this.save({ type: domain + '/settings/set', changes: changes }, keys.map(function (k) { return 'f:' + domain + ':' + k; }),
        function () {
          if (!st.data) return;
          Object.keys(changes).forEach(function (k) {
            if (k in st.data && typeof changes[k] !== 'object') st.data[k] = changes[k];
          });
        }, function (r) { if (r) { st.data = r; st.at = Date.now(); } });
    }
    // any other command of the feature's (add, remove, a set that names an
    // entry): its answer is the page again
    featCall(domain, msg, keys) {
      var st = this.feat(domain);
      return this.save(msg, (keys || []).map(function (k) { return 'f:' + domain + ':' + k; }), function () {},
        function (r) { if (r) { st.data = r; st.at = Date.now(); } });
    }
    ws(msg, keys) {
      var self = this;
      return this.save(msg, keys || [], function () {}, function () {});
    }
    async save(msg, keys, local, apply) {
      var self = this;
      local();
      keys.forEach(function (k) { delete self.errors[k]; });
      this.render();
      this.status('saving');
      try {
        var r = await this.actions().callWS(msg);
        apply(r);
        this.status('saved');
        this.render();
        this.soon();
        return true;
      } catch (e) {
        var f = M.refusals(e);
        keys.forEach(function (k) {
          var code = f ? f[k.replace(/^[bt]:/, '').replace(/^f:[a-z_]+:/, '')] : null;
          self.errors[k] = code ? M.errorText(code) : (f ? null : String((e && e.message) || e));
          if (!self.errors[k]) delete self.errors[k];
        });
        if (!keys.length) this.errors._ = String((e && e.message) || e);
        this.status('error');
        this.announce('Couldn’t save. ' + (Object.keys(self.errors).map(function (k) { return self.errors[k]; })[0] || ''));
        try { await this.reload(); } catch (x) { /* keep what we have */ }
        this.render();
        return false;
      }
    }

    // ---------------------------------------------------------- drawing
    typing() {
      var a = /** @type {HTMLInputElement | null} */ (this.shadowRoot.activeElement);
      return !!(a && (a.tagName === 'INPUT' && a.type !== 'range' || a.tagName === 'TEXTAREA' ||
                      a.closest && a.closest('.accwrap')));
    }
    render(background, navigated) {
      if (!this.ready || (!this.data && !this.hostOnly)) return;
      // NOT UNDER A PRESS. A text field saves on blur, and the blur of a press
      // elsewhere comes between that press's pointerdown and its click: the
      // redraw replaced the very row being pressed, and the click was lost
      // (a kind picked once did nothing; Add Pop-up needed a second tap).
      // Held until the press has ended and clicked, then drawn once.
      if (this._pressing) {
        var was = this._held || {};
        this._held = { background: !!(was.background !== undefined ? was.background && background : background),
                       navigated: !!(was.navigated || navigated) };
        return;
      }
      if (background && this.typing()) { this._dirty = true; return; }
      var self = this, parts = this.parts(), key = parts.join('/');
      var wide = this.hasAttribute('wide');
      var active = this.shadowRoot.activeElement;
      var fk = active && active.getAttribute && active.getAttribute('data-fk');
      var inSide = active && this.sideEl.contains(active);
      var top = this.scrollEl.scrollTop;
      var root = !parts.length;
      this.app.setAttribute('data-view', root && !wide ? 'root' : 'detail');
      if (wide || root) this.paintSide(parts);
      var pg = root ? this.rootPage() : this.resolve(parts);
      this.pickers = this.pickers || {};
      this.paintPage(pg, parts);
      if (key === this._last) this.scrollEl.scrollTop = top;
      else { this.scrollEl.scrollTop = 0; this.bar.classList.remove('scrolled'); }
      this._last = key;
      var t = null;
      if (fk) {
        var sel = '[data-fk="' + String(fk).replace(/(["\\])/g, '\\$1') + '"]';
        t = /** @type {HTMLElement | null} */ ((inSide ? this.sideEl : this.shadowRoot).querySelector(sel));
        if (t && t.focus) t.focus({ preventScroll: true });
      }
      if (!t && navigated && !inSide) {
        var h1 = this.pageEl.querySelector('h1');
        if (h1) h1.focus({ preventScroll: true });
      }
      if (this._flash) {
        // a setting's key (search), or a list of a row's controls (a page's
        // On Screens: its row on the screen's Pages on This Screen)
        var pe = this.pageEl, el = null;
        if (Array.isArray(this._flash)) {
          this._flash.some(function (fk) {
            var x = pe.querySelector('[data-fk="' + fk + '"]');
            if (x) el = (x.closest && x.closest('.cell, li, [role=listitem]')) || x;
            return !!el;
          });
        } else el = pe.querySelector('[data-sk="' + this._flash + '"]');
        this._flash = null;
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.classList.add('flash');
          setTimeout(function () { el.classList.remove('flash'); }, 1500);
        }
      }
      this._dirty = false;
      // WALL TABLETS ARE LIVE: their state, battery and checks are read from
      // Home Assistant's states, so their pages are drawn again every 10 s
      // while open (not under a press or while typing: render's own rules)
      // (only Wall Tablets' own pages: a screen's page has its live preview)
      var onTabs = parts[0] === 'house' && parts[1] === 'tablets';
      if (onTabs && !this._tabTick) {
        this._tabTick = setInterval(function () {
          var q = self.parts();
          if (!self.isConnected || !(q[0] === 'house' && q[1] === 'tablets')) {
            clearInterval(self._tabTick); self._tabTick = null; return;
          }
          if (q[2] !== 'add' && q[3] !== 'copy') self.render(true);
        }, 10000);
      }
      void self;
    }
    // A SCREEN'S NAME AND ITS PENCIL (pg.rename: the dashboard). The pencil
    // turns the title into a field; Save (or Return) renames the dashboard,
    // Cancel (or Escape) leaves it. Its address -- and so every link, tablet
    // and automation that opens it -- stays.
    titleLine(pg) {
      var self = this, x = pg.rename;
      if (this._renaming !== x.path) {
        var pen = h('button', { class: 'ren', type: 'button', 'aria-label': 'Rename ' + x.title, 'data-fk': 'rename', 'data-sk': 'b:rename' });
        pen.innerHTML = PENCIL;
        pen.addEventListener('click', function () {
          self._renaming = x.path; self._renameErr = null; self.render();
          var inp = /** @type {HTMLInputElement | null} */ (self.shadowRoot.querySelector('.renform input'));
          if (inp) { inp.focus(); inp.select(); }
        });
        return h('div', { class: 'tline' }, [h('h1', { class: 'lt', tabindex: '-1', text: pg.title || '' }), pen]);
      }
      var inp = h('input', { type: 'text', 'aria-label': 'Name', maxlength: 50, 'data-fk': 'rename:input', spellcheck: 'false',
                             autocomplete: 'off' });
      inp.value = this._renameDraft != null ? this._renameDraft : x.title;
      var ok = h('button', { class: 'ok', type: 'button', text: 'Save', 'data-fk': 'rename:save' });
      var no = h('button', { class: 'no', type: 'button', text: 'Cancel', 'data-fk': 'rename:cancel' });
      var paint = function () { ok.disabled = !inp.value.trim() || self._renameBusy; };
      var cancel = function () { self._renaming = null; self._renameDraft = null; self._renameErr = null; self.render(); };
      var save = function () { self.renameScreen(x, inp.value); };
      inp.addEventListener('input', function () { self._renameDraft = inp.value; self._renameErr = null; paint(); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); if (!ok.disabled) save(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      });
      ok.addEventListener('click', save);
      no.addEventListener('click', cancel);
      paint();
      var out = h('div', {}, [h('div', { class: 'renform' }, [inp, ok, no]),
        this._renameErr ? h('p', { class: 'renerr', role: 'alert', text: this._renameErr }) : null]);
      return out;
    }
    async renameScreen(x, title) {
      title = String(title || '').trim();
      if (!title || this._renameBusy) return;
      if (title === x.title) { this._renaming = null; this._renameDraft = null; this.render(); return; }
      this._renameBusy = true;
      this.status('saving');
      try {
        if (this.hostRenames(x)) {
          // a screen its host keeps itself: the host renames it; the address stays
          await this.host().renameScreen(x.path, title);
        } else {
          // the dashboard itself: its title is the sidebar's name
          await this.actions().callWS({ type: 'lovelace/dashboards/update', dashboard_id: x.id, title: title });
          // ...and the screen's own item (and its screensaver's device) after it
          await this.actions().callWS({ type: DOMAIN + '/dashboard/titled', dashboard: x.path });
        }
        this._renaming = null; this._renameDraft = null; this._renameErr = null;
        try { await this.reload(); } catch (e) { x.title = title; }
        this.status('saved');
        this.announce('Renamed to ' + title + '.');
      } catch (e) {
        this._renameErr = 'Couldn’t rename it: ' + String((e && (e.message || (e.body && e.body.message) || e.error)) || e);
        this.status('error');
      }
      this._renameBusy = false;
      this.render();
    }
    paintPage(pg, parts) {
      var self = this, wide = this.hasAttribute('wide');
      // THE BAR: Back to the page above (none beside the sidebar at the top)
      var lead = this.bar.querySelector('.lead');
      lead.innerHTML = '';
      var back = pg.back || (parts.length && !wide ? [this.title(), '#/'] : null);
      var came = this.from[hashOf(location.hash || '#/')];
      if (came && (!back || hashOf(back[1]) !== came)) back = [this.labelOf(came), came];
      if (back && (!(wide && pg.top) || came)) {
        var b = h('button', { class: 'back', type: 'button', 'aria-label': 'Back to ' + back[0] });
        b.innerHTML = BACK + '<span>' + K.esc(back[0]) + '</span>';
        b.addEventListener('click', function () { self.back(back[1]); });
        lead.appendChild(b);
      }
      this.bar.querySelector('.mid').textContent = pg.title || '';
      // THE PAGE. A screen's preview stays put while its settings redraw (a
      // moved iframe would load the whole dashboard again).
      // (a title with no line under it: .bare, its own room before the first group)
      var head = h('div', { class: 'ph' + (pg.scope ? '' : ' bare') }, [pg.rename ? this.titleLine(pg) : h('h1', { class: 'lt', tabindex: '-1', text: pg.title || '' }),
        pg.scope ? h('p', { class: 'scope', html: pg.scope }) : null]);
      var content = h('div', { class: 'pc' });
      try { pg.body(content); } catch (e) {
        console.error('[hk-settings]', e);
        content.appendChild(K.group({ footer: 'This page couldn’t be drawn: ' + (e && e.message || e) }, []));
      }
      // beside the page (a wide window) it stays for the screen's sub-pages;
      // above it (narrower, phones too) only the screen's own page has it --
      // unless it is PINNED (the bar's Preview button): then it stays at the
      // top of every page that has one, the settings scrolling under it
      var xwide = this.hasAttribute('xwide');
      var pinned = !xwide && !!pg.preview && pinnedPreview();
      this.previewButton(!xwide && !!pg.preview, pinned);
      if (pg.preview && !xwide && !pg.previewTop && !pinned) pg.preview = null;
      this._pvPinned = pinned;
      // (pinned: a preview not pinned has none set -- compared as it was, undefined against false, no preview was
      // ever kept: every change made the frame load its screen again, 2026-10-31)
      var keepPv = pg.preview && this._pv && this._pv.path === pg.preview && this._pv.view === (pg.previewView || '0') &&
        !!this._pv.pinned === pinned && this.pageEl.querySelector('.pvcol');
      if (keepPv) {
        this.pageEl.replaceChild(head, this.pageEl.querySelector('.ph'));
        this.pageEl.replaceChild(content, this.pageEl.querySelector('.pc'));
      } else {
        this.pageEl.innerHTML = '';
        this.pageEl.className = 'page' + (pg.preview ? ' split' : '');
        this.pageEl.appendChild(head);
        this._pv = null; this._fit = null;
        if (pg.preview) {
          var pcol = this.previewCol(pg.preview, pg.previewView);
          if (pinned) { pcol.classList.add('pin'); this._pv.pinned = true; this.pageEl.insertBefore(pcol, head); }
          else this.pageEl.appendChild(pcol);
        }
        this.pageEl.appendChild(content);
      }
      // a first group with no heading (a theme's page): the preview's box
      // lines up with that group, not its PREVIEW heading with nothing
      var first = content.firstElementChild;
      this.pageEl.classList.toggle('nohead', !!(pg.preview && first && first.classList &&
        first.classList.contains('grp') && !(first.firstElementChild && first.firstElementChild.classList.contains('gh'))));
      this.skyPreview(pg.preview ? pg.sky : null);
      this._saverEnergy = !!pg.saverEnergy;
      this._saverWx = !!pg.saverWeather;
      // what the frame shows: the screen, the screensaver alone, or the look alone (previewSrc)
      this._frameMode = pg.preview ? (pg.saverPreview ? 'saver' : pg.lookPreview ? 'look' : null) : null;
      this.frameSrc();
      this.saverPreview(!!(pg.preview && pg.saverPreview), !!pg.saverHouse);
      this.panePreview(!!(pg.preview && pg.paneHouse));
    }

    // THE SIDE PANE'S ALL SCREENS PREVIEW: the screen in the frame drawing
    // All Screens' pane, not its own (p_sidePane's paneHouse); its window's
    // hkSidePane, once it has one
    panePreview(on) {
      var self = this, fr = /** @type {HTMLIFrameElement | null} */ (this.pageEl.querySelector('.pvcol .pvbox iframe')), n = 0;
      clearInterval(this._paneWait);
      if (!fr) return;
      var go = function () {
        var P = null;
        try { P = fr.contentWindow && fr.contentWindow.hkSidePane; } catch (e) { /* not ours */ }
        if (P && typeof P.previewHouse === 'function') { P.previewHouse(on); return true; }
        return false;
      };
      if (!go()) this._paneWait = setInterval(function () { if (go() || ++n > 80) clearInterval(self._paneWait); }, 250);
    }

    // THE PREVIEW BUTTON (narrower than a desk): the live preview pinned to
    // the top of the page, or not; remembered in this browser. A pin and a
    // word, Pin or Pinned: an eye alone did not say what it does.
    previewButton(show, pinned) {
      var b = /** @type {HTMLElement | null} */ (this.bar.querySelector('.pvtoggle')), self = this;
      if (!show) { if (b) b.remove(); return; }
      if (!b) {
        b = h('button', { class: 'pvtoggle', type: 'button', 'data-fk': 'bar:preview' });
        b.addEventListener('click', function () {
          pinPreview(!pinnedPreview());
          self.render();
        });
        this.bar.appendChild(b);
      }
      b.innerHTML = '';
      b.appendChild(K.icon('mdi:pin', ''));
      b.appendChild(h('span', { text: pinned ? 'Pinned' : 'Pin' }));
      b.setAttribute('aria-label', 'Pin Preview');
      b.title = pinned ? 'Unpin the preview from the top' : 'Pin the preview to the top while you scroll';
      b.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    }
    // THE SCREENSAVER'S PREVIEW: on Screensaver Options the frame shows the
    // screensaver as that screen shows it (its window's hkSaver.preview) and
    // follows every change made here; any other page takes it away again.
    // Only the frame: the screen's tablet, its switch and its photos' order
    // are not touched.
    saverPreview(on, house) {
      if (house === undefined) house = this._saverHouse; else this._saverHouse = house;
      var self = this, col = this.pageEl.querySelector('.pvcol');
      var old = col && col.querySelector('.pvsaver');
      if (old) old.remove();
      clearInterval(this._saverWait);
      var box = col && col.querySelector('.pvbox'), fr = box && box.querySelector('iframe');
      if (!fr) { this._saverWas = false; return; }
      if (!on && !this._saverWas) return;
      this._saverWas = on;
      var n = 0;
      // WHICH PHOTO (2026-10-13): Any, or a Portrait or Landscape one -- held
      // while its settings change, so a crop or a blur can be judged
      var shape = this._saverEnergy ? 'energy' : this._saverWx ? 'weather' : this._saverShape || '';
      if (!on) this._saverOver = null;
      // (a frame on its way to the screensaver alone, or back, is asked nothing until it is there: its old page
      // would answer -- frameSrc changes its address)
      var bound = this.previewSrc(this._frameMode);
      var go = function () {
        var S = null, at = '';
        try { S = fr.contentWindow && fr.contentWindow.hkSaver; at = fr.contentWindow.location.search; } catch (e) { /* not ours */ }
        if (/hk_preview=saver/.test(bound) !== /hk_preview=saver/.test(at)) return false;
        if (S && typeof S.preview === 'function') { S.preview(on, shape || null, !!house, on ? self._saverOver : null); return true; }
        return false;
      };
      if (!go()) self._saverWait = setInterval(function () { if (go() || ++n > 80) clearInterval(self._saverWait); }, 250);
      if (on && (this._saverEnergy || this._saverWx)) {
        box.parentNode.insertBefore(h('div', { class: 'pvsaver' }, [h('p', { class: 'gf',
          text: (this._saverWx ? 'The weather' : 'Home Energy') + ' as this screen shows it, held while you change these. Only this preview changes.' })]), box.nextSibling);
      } else if (on) {
        var seg = h('div', { class: 'seg pvmoment', role: 'radiogroup', 'aria-label': 'Preview a photo' });
        [['', 'Any Photo'], ['portrait', 'Portrait'], ['landscape', 'Landscape']].forEach(function (o) {
          var b = h('button', { type: 'button', role: 'radio', 'aria-checked': o[0] === shape ? 'true' : 'false', tabindex: o[0] === shape ? '0' : '-1',
                                'data-fk': 'pvshape:' + (o[0] || 'any'), text: o[1] });
          b.addEventListener('click', function () { if (o[0] !== shape) { self._saverShape = o[0]; self.saverPreview(true); } });
          seg.appendChild(b);
        });
        box.parentNode.insertBefore(h('div', { class: 'pvsaver' }, [seg, h('p', { class: 'gf',
          text: (house ? 'The screensaver with these settings, shown on ' + ((self.dash(self._pv ? self._pv.path : '') || {}).title || 'a screen') + '.'
                       : 'The screensaver as this screen shows it, with the changes you make here.') +
                ' Portrait or Landscape keeps one photo of that shape while you change its settings. Only this preview changes.' })]), box.nextSibling);
      }
    }

    // EACH CHANGE TO THE SCREENSAVER, AS IT IS MADE (2026-10-31): the options handed to the preview's screensaver
    // the moment they are put -- before the save has gone round -- which shows them where it is (hkSaver.preview's
    // `over`); kept for the frame until these pages are left. null: the saved ones again (Same as All Screens).
    saverOver(o) {
      this._saverOver = o && typeof o === 'object' ? o : null;
      if (this._saverWas) this.saverPreview(true);
    }
    // THE PREVIEW FRAME'S ADDRESS (2026-10-31, the owner: "just what they're changing"): the screen; on the
    // screensaver's pages the screensaver alone, where the host has a page of only that (its settingsHost's
    // saverPage); on the Appearance pages the look alone -- the screen with a few of its cards (hk-strategy.js
    // lookSample). Changed when a page asks for another (one short load), never on a redraw.
    previewSrc(mode) {
      var pv = this._pv, x = this.host();
      if (!pv) return '';
      var q = mode === 'saver' && x && x.saverPage === true ? '&hk_preview=saver' : mode === 'look' ? '&hk_preview=look' : '';
      return this.hostScreenBase() + '/' + pv.path + '/' + (pv.view || '0') + '?hk_kiosk=on&kiosk&wp_enabled=false' + q;
    }
    frameSrc() {
      var col = this.pageEl.querySelector('.pvcol'), fr = col && /** @type {HTMLIFrameElement | null} */ (col.querySelector('.pvbox iframe'));
      if (!fr) return;
      var want = this.previewSrc(this._frameMode), says = col.querySelector('.pvsays');
      if (says) says.textContent = /hk_preview=saver/.test(want) ? PV_SAYS.saver : /hk_preview=look/.test(want) ? PV_SAYS.look : PV_SAYS.screen;
      var at = fr.getAttribute('data-src') || fr.getAttribute('src');
      if (!want || at === want) return;
      // (in the frame's own history entry: a new src is a Back step of the page's, and Back would load the frame's
      // address instead of going back a page; data-src keeps where it was sent)
      var loaded = null;
      try { loaded = fr.contentWindow && fr.contentWindow.location.href !== 'about:blank' ? fr.contentWindow.location : null; } catch (e) { loaded = null; }
      fr.setAttribute('data-src', want);
      if (loaded) { try { loaded.replace(new URL(want, location.href).href); return; } catch (e) { /* another origin's */ } }
      fr.setAttribute('src', want);
    }

    // THE SKY'S PREVIEW. On the Sky page the preview frame shows today's own
    // sky; on a theme's page, that theme -- whatever today's date, and even
    // switched off -- in the moments it can be seen in (M.skyMoments). It is
    // forced INSIDE the frame (its window's hkSky.preview): no real screen
    // changes, and any other page puts the frame back to today's sky.
    skyPreview(sky) {
      var self = this, col = this.pageEl.querySelector('.pvcol');
      var old = col && col.querySelector('.pvsky');
      if (old) old.remove();
      clearInterval(this._skyWait);
      var box = col && col.querySelector('.pvbox'), fr = box && box.querySelector('iframe');
      if (!fr) { this._skyWas = false; return; }
      var theme = sky ? sky.theme : null;
      // the frame's hkSky arrives with its dashboard: asked for until then
      var apply = function (when) {
        var n = 0;
        var go = function () {
          var S = null;
          try { S = fr.contentWindow && fr.contentWindow.hkSky; } catch (e) { /* not ours */ }
          if (S && typeof S.preview === 'function') { S.preview(theme, when); return true; }
          return false;
        };
        clearInterval(self._skyWait);
        if (go()) return;
        self._skyWait = setInterval(function () { if (go() || ++n > 80) clearInterval(self._skyWait); }, 250);
      };
      if (!sky) { if (this._skyWas) { theme = null; apply(null); } this._skyWas = false; return; }
      this._skyWas = true;
      var x = this.dash(this._pv && this._pv.path), who = x ? x.title : 'Home';
      var row = h('div', { class: 'pvsky' });
      if (!theme) {
        row.appendChild(h('p', { class: 'gf', text: 'Your ' + who + ' screen’s sky right now. Choose a decoration to see it here.' }));
        box.parentNode.insertBefore(row, box.nextSibling);
        apply(null);
        return;
      }
      var mo = M.skyMoments(theme), key = mo.value;
      if (mo.options.length > 1) {
        var seg = h('div', { class: 'seg pvmoment', role: 'radiogroup', 'aria-label': 'When' });
        var btns = mo.options.map(function (o) {
          var b = h('button', { type: 'button', role: 'radio', 'data-moment': o[0], text: o[1] });
          b.addEventListener('click', function () { choose(o[0]); });
          seg.appendChild(b);
          return b;
        });
        var paint = function () {
          btns.forEach(function (b, i) {
            var on = mo.options[i][0] === key;
            b.setAttribute('aria-checked', on ? 'true' : 'false');
            b.setAttribute('tabindex', on ? '0' : '-1');
          });
        };
        var choose = function (k) { if (k === key) return; key = k; paint(); apply(k); };
        paint();
        row.appendChild(seg);
      }
      row.appendChild(h('p', { class: 'gf', text: 'Your ' + who + ' screen with this decoration, whatever today’s date. Only this preview changes.' }));
      box.parentNode.insertBefore(row, box.nextSibling);
      apply(key);
    }

    // ---------------------------------------------------------- sidebar
    paintSide(parts) {
      var d = this.data, self = this, wide = this.hasAttribute('wide');
      var here = parts.join('/');
      var at = function (p) { return here === p || here.indexOf(p + '/') === 0; };
      var side = this.sideEl;
      var searchHad = /** @type {HTMLInputElement | null} */ (side.querySelector('.search input'));
      var focused = searchHad && this.shadowRoot.activeElement === searchHad;
      var selStart = focused ? searchHad.selectionStart : null;
      side.innerHTML = '';
      var top = h('div', { class: 'sidetop' });
      var head = h('div', { class: 'sidehead' });
      // A NARROW WINDOW: the host's own button that opens its sidebar (none
      // on a host without one)
      var mb = this._narrow ? window.hkShell.menuButton(this._menuBtn || null, { narrow: this._narrow, client: this.client }) : null;
      if (mb) {
        this._menuBtn = mb;
        head.appendChild(mb);
        head.classList.add('menubtn');
      }
      // a host with no sidebar of its own: its way out, over the name
      var hx = this.host();
      if (hx && hx.back && hx.back.href) {
        var out = h('a', { class: 'hostback', href: hx.back.href, 'data-fk': 'side:hostback' });
        out.innerHTML = BACK + '<span>' + K.esc(hx.back.label || 'Back') + '</span>';
        top.appendChild(out);
      }
      head.appendChild(h('h1', { text: this.title() }));
      top.appendChild(head);
      var sb = h('div', { class: 'search', role: 'search' });
      sb.appendChild(K.icon('mdi:magnify', 'mag'));
      var inp = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search settings', 'data-fk': 'side:search' });
      inp.value = this.q;
      inp.addEventListener('input', function () {
        self.q = inp.value;
        self.paintSide(self.parts());
      });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { self.q = ''; self.paintSide(self.parts()); } });
      sb.appendChild(inp);
      top.appendChild(sb);
      side.appendChild(top);
      if (focused) { inp.focus(); try { inp.setSelectionRange(selStart, selStart); } catch (e) { /* type=search */ } }

      if (this.q.trim()) { side.appendChild(this.searchResults()); return; }
      var hostGroups = function (place) {
        if (!hx || typeof hx.groups !== 'function') return;
        (hx.groups() || []).filter(function (g) { return (g.place || 'end') === place; }).forEach(function (g) {
          side.appendChild(K.group({ header: g.header || null }, (g.rows || []).map(function (r) {
            return K.nav({ tile: r.tile || null, label: r.label, sub: r.sub || null, value: r.value, href: '#/' + r.route,
                           current: wide && (at(r.route) || (!here && r.root)), fk: 'side:' + r.route });
          })));
        });
      };
      hostGroups('top');
      if (this.hostOnly) { hostGroups('end'); return; }
      var items = d.dashboards.filter(function (x) { return x.item; });
      var nAcc = Object.keys((d.accessories && d.accessories.entities) || {}).length;
      side.appendChild(K.group({}, [K.nav({ tile: ['mdi:home-heart', C.orange], label: 'Overview',
        sub: items.length + ' Screens · ' + nAcc + ' Accessories', href: '#/overview',
        current: wide && (here === '' || here === 'overview'), fk: 'side:overview' })]));
      var rows = items.map(function (x) {
        // A SCREEN OF ONLY SOME PAGES says so, with a glyph of its own: it
        // must never pass for a whole screen
        var only = x.generated ? self.onlyOf(d.boards[x.path]) : null;
        // WHERE IT IS DRAWN (`where`, from a host that draws screens of its own: {text, icon, also: drawn here too}) -- HK in Home
        // Assistant sends none, and its list is as it always was
        var where = x.where && typeof x.where.text === 'string' ? x.where : null;
        return K.nav({ tile: [only ? 'mdi:file-document-multiple-outline' : where && where.icon ? where.icon : x.generated ? 'mdi:view-dashboard-variant' : 'mdi:tablet-dashboard',
                              only ? C.teal : where && where.also ? C.blue : x.generated ? C.indigo : C.blue],
                       label: x.title, sub: only ? only.text : where ? where.text : null, href: '#/screens/' + encodeURIComponent(x.path),
                       current: wide && at('screens/' + x.path), fk: 'side:s:' + x.path });
      });
      rows.push(K.nav({ tile: ['mdi:plus', C.gray], label: 'Add Screen', href: '#/add-screen', current: wide && at('add-screen'),
                        fk: 'side:add' }));
      side.appendChild(K.group({ header: 'Screens' }, rows));
      // PAGES (2026-10-16): every page the house has, each its own settings
      // -- a feature's pages (#/features/energy/devices) count as its page's
      var pageHere = M.pageOfRoute(here);
      side.appendChild(K.group({ header: 'Pages' }, this.pagesListed().map(function (p) {
        return K.nav({ tile: [p[2], p[3]], label: p[1], href: '#/page/' + p[0], current: wide && pageHere === p[0], fk: 'side:page:' + p[0] });
      })));
      var list = function (header, arr, pre) {
        side.appendChild(K.group({ header: header }, arr.filter(function (p) { return p[4] !== 'unlisted'; }).map(function (p) {
          var r = p[5] || (pre || '') + p[0];
          return K.nav({ tile: [p[2], p[3]], label: p[1], href: '#/' + r, current: wide && at(r), fk: 'side:' + r });
        })));
      };
      list('All Screens', HOUSE, 'house/');
      list('Library', LIBRARY);
      list('System', SYSTEM);
      hostGroups('end');
    }
    searchResults() {
      var d = this.data, self = this, hx = this.host();
      var hostRows = hx && typeof hx.search === 'function' ? (hx.search() || []) : [];
      if (this.hostOnly) {
        var hres = M.search(this.q, [], hostRows).slice(0, 60);
        if (!hres.length) return K.group({ footer: 'No settings match “' + this.q.trim() + '”.' }, []);
        return K.group({ header: 'Results' }, hres.map(function (r, i) {
          return K.nav({ label: r.label, sub: r.where || null, href: '#/' + r.route, fk: 'side:r:' + i });
        }));
      }
      var screens = d.dashboards.filter(function (x) { return x.item; });
      var extra = hostRows.slice();
      screens.forEach(function (x) { extra.push({ label: x.title, route: 'screens/' + x.path, where: 'Screen', words: x.path }); });
      d.popups.forEach(function (p) { extra.push({ label: p.name || p.hash, route: 'popups/' + p.hash, where: 'Pop-up', words: '#' + p.hash }); });
      (d.custom_pages || []).forEach(function (p) { extra.push({ label: p.title, route: 'pages/' + p.path, where: 'Custom Page', words: p.path }); });
      extra = extra.concat(F.search(d.features));
      var areas = this.client.areas || {};
      Object.keys(areas).forEach(function (a) { extra.push({ label: areas[a].name, route: 'house/rooms/' + a, where: 'Room', words: 'room scenes' }); });
      var res = M.search(this.q, screens, extra).slice(0, 60);
      if (!res.length) return K.group({ footer: 'No settings match “' + this.q.trim() + '”.' }, []);
      return K.group({ header: 'Results' }, res.map(function (r, i) {
        var a = K.nav({ label: r.label, sub: r.where || null, href: '#/' + r.route, fk: 'side:r:' + i });
        // r.key is the row's own label (hk-settings-model.js search())
        a.addEventListener('click', function () { self._flash = r.key; });
        return a;
      }));
    }

    // ---------------------------------------------------------- helpers
    hs(path) { var i = path.indexOf('.'); return (this.data.settings[path.slice(0, i)] || {})[path.slice(i + 1)]; }
    err(sk) { return this.errors[sk] || null; }
    dash(path) { return this.data.dashboards.filter(function (x) { return x.path === path; })[0]; }
    // a dashboard Home Assistant can rename: one it stores (a YAML dashboard
    // is named in its YAML), with its collection id -- or a screen the host
    // keeps itself (no Lovelace id), which the host renames (renameScreen)
    renamable(x) { return x && ((x.mode === 'storage' && x.id) || this.hostRenames(x)) ? x : null; }
    hostRenames(x) {
      var hx = this.host();
      return !!(x && !x.id && x.mode !== 'storage' && x.mode !== 'yaml' && hx && typeof hx.renameScreen === 'function');
    }
    name(id) {
      if (!id) return '';
      var a = ((this.data.accessories || {}).entities || {})[id];
      var st = this.client.states[id];
      return (a && a.name) || (st && st.attributes.friendly_name) || id;
    }
    areaOf(id) {
      var e = (this.client.entities || {})[id] || {}, devs = this.client.devices || {};
      return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || '';
    }
    areaName(a) { var x = (this.client.areas || {})[a]; return (x && x.name) || a; }
    areasAZ() {
      var areas = this.client.areas || {};
      return Object.keys(areas).sort(function (p, q) { return String(areas[p].name).localeCompare(String(areas[q].name)); });
    }
    entityIds(filter) {
      var client = this.client, ents = client.entities || {};
      return Object.keys(client.states).filter(function (id) {
        var dom = id.split('.')[0];
        if (filter.domains && filter.domains.indexOf(dom) < 0) return false;
        if (filter.re && !filter.re.test(id)) return false;
        if (filter.dc && client.states[id].attributes.device_class !== filter.dc) return false;
        if (filter.shown) { var e = ents[id] || {}; if (e.hidden || e.entity_category) return false; }
        return true;
      });
    }
    // A ROW THAT PICKS AN ENTITY: its value is the entity's name (or what
    // "none" means), and it opens a searchable list.
    // "Same as General (Lyric Alarm)": the alarm panel General names
    sameAsGeneral() {
      var g = this.hs('security.alarm');
      return 'Same as the Security Page' + (g ? ' (' + this.name(g) + ')' : '');
    }
    entityRow(o) {
      var self = this;
      var href = this.picker(o.sk, {
        title: o.title || o.label, value: o.value, none: o.none, required: o.required,
        items: function () {
          return self.entityIds(o.filter).map(function (id) { return { value: id, label: self.name(id), sub: id }; });
        },
        onPick: o.onPick
      });
      var st = o.value && this.client.states[o.value];
      var val = o.value ? (st ? this.name(o.value) : o.value + ' (missing)') : (o.none || 'None'), sub = o.sub;
      // "Automatic (Main Power)", "Same as General (Lyric Alarm)": on the
      // row, the value it follows, and whose under the label -- as every
      // row that follows something says it (the picker keeps the whole name)
      var follows = !o.value && !sub && /^(Automatic|Same as [^(]+?) \((.+)\)$/.exec(val);
      if (follows) { sub = follows[1]; val = follows[2]; }
      var row = K.nav({ label: o.label, sub: sub, value: val, href: href, sk: o.sk });
      return this.withError(row, o.sk);
    }
    withError(row, sk) {
      var e = this.err(sk);
      if (!e) return row;
      return h('div', { class: 'cellwrap' }, [row, h('div', { class: 'errline', role: 'alert', text: e })]);
    }
    // register a picker page under the current page (#/<here>/~<key>)
    picker(key, spec) {
      var parts = this.parts().filter(function (p) { return p[0] !== '~'; });
      this.pickers[key] = spec;
      return '#/' + parts.map(encodeURIComponent).join('/') + '/~' + encodeURIComponent(key);
    }
    pickerPage(parts) {
      var self = this, key = parts[parts.length - 1].slice(1);
      var parentParts = parts.slice(0, -1);
      // a picker's page is registered by its page: draw that, unseen, first
      var parent = this.resolve(parentParts);
      var scratch = document.createElement('div');
      try { parent.body(scratch); } catch (e) { /* its picker may still be there */ }
      var spec = this.pickers[key];
      var backHash = '#/' + parentParts.map(encodeURIComponent).join('/');
      if (!spec) return { title: parent.title, back: [parent.title, backHash], body: function (c) { self.go(backHash); void c; } };
      return { title: spec.title, back: [parent.title, backHash], body: function (c) {
        var choose = function (v) {
          self._pq = null;
          self._psel = null;
          self.back(backHash);
          spec.onPick(v);
        };
        var sel = null;
        if (spec.multi) sel = self._psel && self._psel.key === key ? self._psel : (self._psel = { key: key, order: [] });
        self.pickList(c, { title: spec.title, items: spec.items, multi: !!spec.multi, sel: sel && sel.order,
          verb: spec.verb || 'Add', onDone: function (v) { choose(v); },
          current: spec.value, none: spec.none, onPick: choose,
          // the search is this picker's: another picker opens with none
          query: self._pq && self._pq.key === key ? self._pq.q : '', onQuery: function (q) { self._pq = { key: key, q: q }; } });
      } };
    }
    // THE PICKER (2026-10-13: every picker in HK Settings, after Hide
    // Accessories' -- the one the owner found "easy to understand and laid
    // out a lot cleaner"): a search that matches the name, the entity id and
    // the room; the choices under their rooms, A to Z, each with its glyph and
    // its entity id; and for several at once, ticks from the start with a bar
    // saying how many are selected, Clear, and the one button that finishes
    // (Add, Next). What is ticked stays ticked while the search changes;
    // while searching, Select All ticks everything it matches.
    //   o = { items(tab) -> [{ value, label, sub, room, icon, note }],
    //         tabs: [[id, text]], tab, onTab(id)      e.g. Accessories / Whole Devices
    //         multi, sel (the array ticked, kept by the caller), verb, onDone(values)
    //         current, none, onPick(value)            one choice: a tap picks it
    //         query, onQuery(q), title }
    // An entity's room is its area's (room: '' = No Room); a list where
    // nothing has a room is one plain list, with no headings.
    pickList(c, o) {
      var self = this, client = this.client;
      if (o.tabs) c.appendChild(K.group({}, [K.seg({ label: 'Pick', fk: 'pick:tab', value: o.tab, options: o.tabs,
        onChange: function (x) { o.onTab(x); } })]));
      var sb = h('div', { class: 'search', style: 'margin:0 0 ' + (o.multi ? 22 : 18) + 'px' });
      sb.appendChild(K.icon('mdi:magnify', 'mag'));
      var inp = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search' + (o.title ? ' ' + o.title : ''), 'data-fk': 'pick:search' });
      inp.value = o.query || '';
      sb.appendChild(inp);
      c.appendChild(sb);
      var bar = o.multi ? h('div', { class: 'pickbar', role: 'toolbar', 'aria-label': 'Selected' }) : null;
      if (bar) c.appendChild(bar);
      var box = h('div');
      c.appendChild(box);
      var sel = o.sel || [];
      var tick = function (v) { var i = sel.indexOf(v); if (i >= 0) sel.splice(i, 1); else sel.push(v); };
      var barBtn = function (label, fk, onClick, cls, disabled) {
        var b = h('button', { type: 'button', class: cls || '', 'data-fk': fk, text: label, disabled: !!disabled });
        b.addEventListener('click', onClick);
        return b;
      };
      var paintBar = function (got, searching) {
        bar.innerHTML = '';
        var n = sel.length;
        bar.appendChild(h('span', { class: 'pcount', 'aria-live': 'polite', text: n ? n + ' Selected' : 'Pick one or several' }));
        if (searching && got.length > 1) {
          var allOn = got.every(function (it) { return sel.indexOf(it.value) >= 0; });
          bar.appendChild(barBtn(allOn ? 'Deselect All' : 'Select All ' + got.length, 'pick:all', function () {
            got.forEach(function (it) { var on = sel.indexOf(it.value) >= 0; if (allOn ? on : !on) tick(it.value); });
            paint();
          }));
        }
        if (n) bar.appendChild(barBtn('Clear', 'pick:clear', function () { sel.splice(0, sel.length); paint(); }));
        var verb = o.verb || 'Add';
        bar.appendChild(barBtn(n && verb !== 'Next' ? verb + ' ' + n : verb, 'pick:add', function () { o.onDone(sel.slice()); }, 'add', !n));
      };
      var roomOf = function (it) {
        if (it.room !== undefined && it.room !== null) return it.room;
        return client.states[it.value] ? (self.areaName(self.areaOf(it.value)) || '') : null;
      };
      var paint = function () {
        box.innerHTML = '';
        var words = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        var all = o.items(o.tab).map(function (it) {
          var ent = !!client.states[it.value];
          return { value: it.value, label: it.label, room: roomOf(it), note: it.note,
                   // under its room, an entity's second line is its id (two
                   // "Water Heater"s told apart), whatever the caller wrote
                   sub: ent ? it.value : it.sub, icon: it.icon || (ent ? self.accGlyph(it.value) : null) };
        });
        var got = all.filter(function (it) {
          var t = (it.label + ' ' + (it.sub || '') + ' ' + it.value + ' ' + (it.room || '')).toLowerCase();
          return words.every(function (w) { return t.indexOf(w) >= 0; });
        });
        if (bar) paintBar(got, words.length > 0);
        var row = function (it) {
          if (o.multi) {
            var on = sel.indexOf(it.value) >= 0;
            return K.check({ label: it.label, sub: it.sub, multi: true, on: on, icon: it.icon, value: it.note, fk: 'pick:' + it.value,
                             onClick: function () { tick(it.value); paint(); } });
          }
          return K.check({ label: it.label, sub: it.sub, on: it.value === o.current, icon: it.icon, value: it.note, fk: 'pick:' + it.value,
                           onClick: function () { o.onPick(it.value); } });
        };
        var noneRow = o.none && !o.multi && !words.length
          ? K.check({ label: o.none, on: !o.current, onClick: function () { o.onPick(null); }, fk: 'pick:none' }) : null;
        if (noneRow) box.appendChild(K.group({}, [noneRow]));
        var az = function (a, b) { return a.label.localeCompare(b.label); };
        var CAP = 400, shown = 0;
        if (!got.some(function (it) { return it.room; })) {
          // nothing here has a room (calendars, weather services): one list
          box.appendChild(K.group({}, got.sort(az).slice(0, CAP).map(row)));
          shown = Math.min(got.length, CAP);
        } else {
          var by = {}, rooms = [];
          got.forEach(function (it) { var r = it.room || 'No Room'; if (!by[r]) { by[r] = []; rooms.push(r); } by[r].push(it); });
          rooms.sort(function (a, b) { return /** @type {any} */ (a === 'No Room') - /** @type {any} */ (b === 'No Room') || a.localeCompare(b); });
          rooms.forEach(function (r) {
            if (shown >= CAP) return;
            var list = by[r].sort(az).slice(0, CAP - shown);
            shown += list.length;
            box.appendChild(K.group({ header: r }, list.map(row)));
          });
        }
        if (!got.length) box.appendChild(K.group({ footer: 'Nothing matches.' }, []));
        else if (got.length > shown) box.appendChild(K.group({ footer: 'Showing ' + shown + ' of ' + got.length.toLocaleString(window.hkLocale.numTag()) + '. Search to find more.' }, []));
      };
      inp.addEventListener('input', function () { if (o.onQuery) o.onQuery(inp.value); paint(); });
      paint();
    }

    resolve(parts) {
      var hx = this.host();
      if (hx && typeof hx.page === 'function') {
        var hp = hx.page(parts, this);
        if (hp) return hp;
      }
      if (this.hostOnly) return this.rootPage();
      var last = parts[parts.length - 1] || '';
      if (last[0] === '~') return this.pickerPage(parts);
      // AN ADDRESS THAT MOVED (Pages, 2026-10-16) opens where it is now
      var fw = M.routeForward(parts.join('/'));
      if (fw) return this.resolve(fw.split('/'));
      var a = parts[0];
      if (a === 'overview') return this.p_overview();
      if (a === 'page') return parts[1] ? this.p_page(parts[1], parts.slice(2)) : this.p_overview();
      // no screen named: the Overview (the list of screens is the menu) --
      // not "There's no dashboard at /undefined"
      if (a === 'screens') return parts[1] ? this.p_screen(parts[1], parts.slice(2)) : this.p_overview();
      if (a === 'add-screen') return this.p_add(parts.slice(1));
      if (a === 'house' && parts[1] === 'music') return this.p_music(parts.slice(2));    // its old address
      if (a === 'house') return this.p_house(parts[1], parts.slice(2));
      if (a === 'features') {
        if (parts[1] === 'music') return this.p_music(parts.slice(2));
        return F.page(this, parts.slice(1)) || this.p_overview();
      }
      if (a === 'accessories') return this.p_accessories(parts.slice(1));
      if (a === 'popups') return this.p_popups(parts.slice(1));
      if (a === 'pages') return this.p_pages(parts.slice(1));
      if (a === 'chips') return this.p_chips(parts.slice(1));
      if (a === 'advanced') return parts[1] === 'yaml' ? this.p_yamlRef(parts[2]) : parts[1] === 'features' ? this.p_featureList() : this.p_advanced();
      if (a === 'check') return this.p_check();
      if (a === 'setup') return this.p_setup(Number(parts[1] || 0));
      return this.p_overview();
    }

  }
  var SETUP_STEPS = ['Welcome', 'Security System', 'Weather', 'Appearance', 'Features', 'First Screen', 'Done'];
  var SETUP_FIRST = SETUP_STEPS.indexOf('First Screen');
  var PIN_KEY = 'hk-preview-pinned';
  function pinnedPreview() { try { return localStorage.getItem(PIN_KEY) === '1'; } catch (e) { return false; } }
  function pinPreview(on) { try { if (on) localStorage.setItem(PIN_KEY, '1'); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private */ } }
  function hashOf(h) { h = String(h || '#/').split('?')[0]; return h.charAt(0) === '#' ? h : '#' + h; }
  var FROM_KEY = 'hk-settings-from';
  function loadFrom() {
    try { var o = JSON.parse(sessionStorage.getItem(FROM_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; }
    catch (e) { return {}; }
  }
  function saveFrom(o) { try { sessionStorage.setItem(FROM_KEY, JSON.stringify(o)); } catch (e) { /* private window */ } }
  function slug(t) {
    return String(t || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }
  window.hkHostClient.entry(HkSettingsPanel);
  // @ts-expect-error (the same title() as above makes the class not a CustomElementConstructor to the checker)
  customElements.define('hk-settings-panel', HkSettingsPanel);
  window.hkSettingsPanel = { version: '2.0.0' };

  // THE CLASS'S METHODS that parts add: as a class body defines them (writable, configurable, NOT enumerable; a
  // getter or setter stays an accessor), so for-in and Object.getOwnPropertyNames over the prototype see the same names
  function install(from) {
    Object.getOwnPropertyNames(from.prototype).forEach(function (name) {
      if (name === 'constructor') return;
      if (Object.prototype.hasOwnProperty.call(HkSettingsPanel.prototype, name)) throw new Error('[hk-settings] ' + name + ' is defined twice');
      var d = Object.getOwnPropertyDescriptor(from.prototype, name);
      Object.defineProperty(HkSettingsPanel.prototype, name, d.get || d.set
        ? { get: d.get, set: d.set, enumerable: false, configurable: true }
        : { value: d.value, writable: true, enumerable: false, configurable: true });
    });
  }
  // THE SHELL'S VARIABLES SET ONCE, LATER (F, h, K, M): each part that uses one has its own copy, handed over here
  // whenever the shell has assigned them (the parts run, and the page's start)
  var lates = [];
  function bindLate() {
    var s = { F: F, h: h, K: K, M: M };
    lates.forEach(function (bind) { bind(s); });
  }
  function kit() {
    return {
      DOMAIN: DOMAIN, hashOf: hashOf, loadCards: loadCards, PV_SAYS: PV_SAYS, restWrite: restWrite,
      SETUP_FIRST: SETUP_FIRST, SETUP_STEPS: SETUP_STEPS, shrinkPhoto: shrinkPhoto, slug: slug, install: install,
      late: lates
    };
  }
  function runParts() {
    var KIT = kit();
    PARTS.forEach(function (file) { window.hkSettingsParts[partKey(file)](KIT); });
    BACK = KIT.BACK; C = KIT.C; CSS = KIT.CSS; HOUSE = KIT.HOUSE; LIBRARY = KIT.LIBRARY; PENCIL = KIT.PENCIL;
    SYSTEM = KIT.SYSTEM; TICK = KIT.TICK;
    bindLate();
  }

  var partsReady = new Promise(function (resolve, reject) {
    var ran = false;
    loadParts(function () {
      runParts();
      ran = true;
      resolve();
    });
    // (the loader gives up after its last try with a note in the console; the page says so too)
    if (!ran) setTimeout(function () { reject(new Error('its files did not load')); }, 75000);
  });
  partsReady.catch(function () { /* boot() reports it */ });
})();
