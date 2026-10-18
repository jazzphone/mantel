// HK's view host (Phase 2 P2.3): draws an HK dashboard from the strategy's
// output without Lovelace's page machinery -- no hui-root, hui-view or
// hui-card, and no element of the host's at all.
//
// What Lovelace does for a dashboard is a few steps here:
//   * pick the view by the address (/<dashboard>/<view>, as HA's frontend has
//     it; a view without a `path` is addressed by its index),
//   * make the view element (`custom:` views by their tag) and each card in it
//     (createCardElement: `custom:` cards by their tag; Lovelace's grid, stacks
//     and conditional drawn by HK's own small containers below; any other
//     Lovelace card type a labelled placeholder),
//   * setConfig, then hand the view and every card what goes with the client
//     (the host adapter's bridge, window.hkHostClient.bridge), in Lovelace's
//     order: setConfig, the client, narrow, index, cards,
//   * follow the client: each new client goes to the view shown and its cards
//     (a view left keeps its cards, as hui-root caches views, and catches up
//     when it is shown again),
//   * route: HK's own navigation (hkShell.navigate / onNavigate) and the back
//     button (popstate) swap the view in the same container, so the sky, the
//     menu and the tab bar stay mounted,
//   * tell the host shell where the view is (shellParts / onView), so the sky,
//     menu and tab bar find it through hkShell as they do in HA.
//
// The host gives it the dashboard config (the strategy's `generate` output),
// the client, and the element the views go in. Mantel's page is web/home.js;
// P2.6's HA panel will be another. Nothing here names a host's element or
// event (tests/test_shell_boundary.py), nor the host's raw object.
(function (global) {
  'use strict';
  if (global.hkViewHost) return;

  function doc() { return global.document; }
  function win() { return global.window || global; }
  function adapter() { return global.hkHostClient || null; }
  function shell() { return global.hkShell || null; }

  // What goes with `client` to a card or view, through the host adapter. An
  // element whose code has not arrived yet is fed once it is configured.
  function feed(el, client) {
    if (!el || !client) return;
    if (el.__hkWaiting) { el.__hkWaiting.client = client; return; }
    var A = adapter();
    if (A && A.bridge) A.bridge(el, client);
  }

  // ------------------------------------------------------------ the factory
  var defined = false;
  function define() {
    if (defined) return;
    var ce = global.customElements, A = adapter();
    if (!ce || typeof global.HTMLElement !== 'function') return;
    defined = true;
    var classes = makeClasses();
    Object.keys(classes).forEach(function (tag) {
      // Lovelace's entry, through the host adapter: each container takes the
      // host's input and gets _onClient(client)
      if (A && A.entry && classes[tag].prototype._onClient) A.entry(classes[tag]);
      if (!ce.get(tag)) ce.define(tag, classes[tag]);
    });
  }

  function typeOf(cfg) { return String((cfg && cfg.type) || ''); }

  // A Lovelace card type HK does not draw, or a card whose config failed: a
  // labelled box in its place, never the host's own card.
  function placeholder(cfg, why) {
    define();
    var el = doc().createElement('hk-card-placeholder');
    el.setConfig(Object.assign({}, cfg || {}, { __why: why || 'type' }));
    return el;
  }

  function configure(el, cfg) {
    try {
      el.setConfig(cfg);
      return true;
    } catch (e) {
      try { console.error('[hk-view-host] setConfig failed for', typeOf(cfg), e); } catch (x) { /* no console */ }
      return false;
    }
  }

  function swap(oldEl, newEl) {
    var p = oldEl && oldEl.parentNode;
    if (p && p.replaceChild) p.replaceChild(newEl, oldEl);
  }

  // Lovelace's container types that HK's strategy and cards use, drawn by HK.
  var BUILT_IN = {
    'grid': 'hk-view-grid',
    'vertical-stack': 'hk-view-stack',
    'horizontal-stack': 'hk-view-stack',
    'conditional': 'hk-view-conditional'
  };

  // THE CARD FACTORY: a card element from its config, with no Lovelace.
  // `client` (optional): fed after setConfig. The view host makes a view's
  // cards with it, and hkCards.createCard makes a container's children with
  // it when the host has no Lovelace.
  function createCardElement(cfg, client) {
    define();
    var t = typeOf(cfg), el;
    if (BUILT_IN[t]) {
      el = doc().createElement(BUILT_IN[t]);
      if (!configure(el, cfg)) return placeholder(cfg, 'error');
      feed(el, client);
      return el;
    }
    if (t.indexOf('custom:') !== 0) return placeholder(cfg, 'type');
    var tag = t.slice(7);
    el = doc().createElement(tag);
    if (typeof el.setConfig === 'function') {
      if (!configure(el, cfg)) return placeholder(cfg, 'error');
      feed(el, client);
      return el;
    }
    // ITS CODE HAS NOT ARRIVED YET: configured and fed once it is defined, as
    // Lovelace's wrapper does (the element is upgraded in place).
    var ce = global.customElements;
    if (!ce || !ce.whenDefined) return placeholder(cfg, 'missing');
    var wait = el.__hkWaiting = { client: client || null };
    ce.whenDefined(tag).then(function () {
      if (ce.upgrade) { try { ce.upgrade(el); } catch (e) { /* upgraded already */ } }
      delete el.__hkWaiting;
      if (typeof el.setConfig !== 'function' || !configure(el, cfg)) { swap(el, placeholder(cfg, 'error')); return; }
      feed(el, wait.client);
    });
    return el;
  }

  // HA's conditional card's conditions, read off the client: state,
  // numeric_state, screen, user, and / or / not (and the legacy form, an
  // entity with state / state_not and no `condition`).
  function holds(cond, client) {
    if (!cond) return true;
    var states = (client && client.states) || {};
    function list(v) { return Array.isArray(v) ? v : [v]; }
    function st(id) { return states[id]; }
    switch (cond.condition || (cond.entity ? 'state' : '')) {
      case 'state': {
        var s = st(cond.entity), v = s ? s.state : 'unavailable';
        if (cond.state !== undefined && list(cond.state).map(String).indexOf(v) < 0) return false;
        if (cond.state_not !== undefined && list(cond.state_not).map(String).indexOf(v) >= 0) return false;
        return true;
      }
      case 'numeric_state': {
        var ns = st(cond.entity), n = ns ? Number(ns.state) : NaN;
        if (isNaN(n)) return false;
        return (cond.above === undefined || n > Number(cond.above)) &&
               (cond.below === undefined || n < Number(cond.below));
      }
      case 'screen': {
        var mm = win().matchMedia;
        return typeof mm === 'function' ? !!mm.call(win(), cond.media_query || 'all').matches : true;
      }
      case 'user': {
        var u = client && client.user;
        return !!u && list(cond.users || []).indexOf(u.id) >= 0;
      }
      case 'and': return (cond.conditions || []).every(function (c) { return holds(c, client); });
      case 'or': return (cond.conditions || []).some(function (c) { return holds(c, client); });
      case 'not': return !(cond.conditions || []).some(function (c) { return holds(c, client); });
      default: return true;
    }
  }

  function styleEl(css) {
    var st = doc().createElement('style');
    st.textContent = css;
    return st;
  }

  function makeClasses() {
    var H = global.HTMLElement;

    class HkCardPlaceholder extends H {
      setConfig(cfg) {
        this._config = cfg || {};
        var t = typeOf(cfg) || 'a card with no type', why = this._config.__why;
        this.setAttribute('data-type', t);
        this.style.cssText = 'display:block;box-sizing:border-box;padding:10px 12px;border-radius:12px;' +
          'border:1px dashed rgba(255,255,255,.35);color:rgba(255,255,255,.7);' +
          'font:500 12px/1.35 -apple-system,system-ui,sans-serif';
        this.textContent = why === 'error' ? 'This card could not be drawn: ' + t
          : why === 'missing' ? 'Card code not loaded: ' + t
          : 'Drawn only in Home Assistant: ' + t;
      }
      getCardSize() { return 1; }
    }

    // A container: its children made by the factory, each fed the client.
    class HkViewContainerCard extends H {
      _children() { return this._kids || []; }
      _make(cards) {
        var self = this;
        this._kids = (cards || []).map(function (c) { return createCardElement(c, self.client); });
        return this._kids;
      }
      _onClient(client) {
        this._children().forEach(function (k) { feed(k, client); });
      }
      _box(css) {
        if (!this._sr) this._sr = this.attachShadow({ mode: 'open' });
        while (this._sr.firstChild) this._sr.removeChild(this._sr.firstChild);
        this._sr.appendChild(styleEl(css));
        if (this._config.title) {
          var h = doc().createElement('div');
          h.className = 'title';
          h.textContent = this._config.title;
          this._sr.appendChild(h);
        }
        var box = doc().createElement('div');
        box.id = 'box';
        this._sr.appendChild(box);
        return box;
      }
      getCardSize() { return 1; }
    }

    // Lovelace's grid card: `columns` equal tracks (3 unless set). `square`
    // is not drawn: HK's own grids say square: false.
    class HkViewGrid extends HkViewContainerCard {
      setConfig(cfg) {
        this._config = cfg || {};
        var cols = Math.max(1, Number(this._config.columns) || 3);
        var box = this._box(':host{display:block}.title{font-weight:600;padding:0 4px 8px}' +
          '#box{display:grid;gap:var(--grid-card-gap,8px);grid-template-columns:repeat(' + cols + ',minmax(0,1fr))}');
        this._make(this._config.cards).forEach(function (k) { box.appendChild(k); });
      }
    }

    // Lovelace's vertical and horizontal stacks.
    class HkViewStack extends HkViewContainerCard {
      setConfig(cfg) {
        this._config = cfg || {};
        var row = typeOf(cfg) === 'horizontal-stack';
        var box = this._box(':host{display:block}.title{font-weight:600;padding:0 4px 8px}' +
          (row ? '#box{display:flex;flex-direction:row;gap:var(--horizontal-stack-card-gap,var(--stack-card-gap,8px))}' +
                 '#box>*{flex:1 1 0;min-width:0}'
               : '#box{display:flex;flex-direction:column;gap:var(--vertical-stack-card-gap,var(--stack-card-gap,8px))}'));
        this._make(this._config.cards).forEach(function (k) { box.appendChild(k); });
      }
    }

    // Lovelace's conditional card: its card is on the page, and fed, only
    // while the conditions hold; it says so with `hidden` and
    // card-visibility-changed, as Lovelace's does.
    class HkViewConditional extends HkViewContainerCard {
      setConfig(cfg) {
        this._config = cfg || {};
        this._on = null;
        this._card = this._make([this._config.card])[0];
        this.hidden = true;
        this.style.display = 'none';
      }
      _onClient(client) {
        var on = (this._config.conditions || []).every(function (c) { return holds(c, client); });
        if (on) {
          feed(this._card, client);
          if (this._card.parentNode !== this) this.appendChild(this._card);
        } else if (this._card.parentNode === this) {
          this.removeChild(this._card);
        }
        if (on !== this._on) {
          this._on = on;
          this.hidden = !on;
          this.style.display = on ? '' : 'none';
          try {
            this.dispatchEvent(new global.CustomEvent('card-visibility-changed',
              { detail: { value: on }, bubbles: true, composed: true }));
          } catch (e) { /* no events here */ }
        }
      }
    }

    // A view whose type HK cannot draw (Lovelace's masonry, sections, panel):
    // its cards in one column, under a note.
    class HkViewFallback extends H {
      setConfig(cfg) {
        this._config = cfg || {};
        this.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px';
        var note = doc().createElement('div');
        note.textContent = this._config.__error
          ? 'This page could not be drawn (' + this._config.__error + '); its cards are shown in a column.'
          : 'This page’s layout is drawn only in Home Assistant (' + (typeOf(cfg) || 'masonry') +
            '); its cards are shown in a column.';
        note.style.cssText = 'color:rgba(255,255,255,.6);font:500 12px -apple-system,system-ui,sans-serif';
        this._note = note;
        this.appendChild(note);
      }
      set cards(list) {
        var self = this;
        (this._cards || []).forEach(function (c) { if (c.parentNode === self) self.removeChild(c); });
        this._cards = list || [];
        this._cards.forEach(function (c) { self.appendChild(c); });
      }
      get cards() { return this._cards || []; }
    }

    return {
      'hk-card-placeholder': HkCardPlaceholder,
      'hk-view-grid': HkViewGrid,
      'hk-view-stack': HkViewStack,
      'hk-view-conditional': HkViewConditional,
      'hk-view-fallback': HkViewFallback
    };
  }

  // ------------------------------------------------------------ the views
  // A view's address: its path, else its index (HA's rule).
  function pathOf(view, i) { return view && view.path ? String(view.path) : String(i); }

  function cardsOf(view) {
    if (Array.isArray(view.cards)) return view.cards;
    var out = [];
    (view.sections || []).forEach(function (s) { (s && s.cards || []).forEach(function (c) { out.push(c); }); });
    return out;
  }

  function narrow() {
    var w = win().innerWidth;
    return typeof w === 'number' ? w < 870 : false;
  }

  // ------------------------------------------------------------ the host
  // opts:
  //   container  the element that holds the view (the sky mounts in it)
  //   slot       where the view element goes (default: the container)
  //   config     the dashboard config: { views: [...] }
  //   client     the first client (later ones follow hkHostClient.current())
  //   base       the dashboard's address, '/<dashboard>' (default: the
  //              address's first segment)
  //   follow     false: the caller hands each client with setClient()
  //   willShow(view, first)  awaited before a view is shown (Mantel widens its
  //              state subscription for a page it has not seen)
  //   leave(path)  an address outside this dashboard (default: load it)
  function create(opts) {
    opts = opts || {};
    define();
    var container = opts.container || null;
    if (!container) throw new Error('hkViewHost.create: a container is required');
    var slot = opts.slot || container;
    var config = opts.config || { views: [] };
    var base = opts.base || ('/' + (global.location.pathname.split('/')[1] || ''));
    var client = opts.client || null;
    var cache = {};                // view index -> { el, cards, view, index, path, fed }
    var cur = null;
    var turn = 0;                  // the newest show() wins
    var target = -1;               // the view it asked for
    var listeners = [];
    var offs = [];

    function views() { return (config && config.views) || []; }
    function find(path) {
      var vs = views(), p = path == null ? '' : String(path);
      if (!vs.length) return -1;
      if (!p) return 0;
      for (var i = 0; i < vs.length; i++) if (vs[i] && vs[i].path === p) return i;
      if (/^\d+$/.test(p) && Number(p) < vs.length) return Number(p);
      return 0;                    // an unknown view: the first, as HA does
    }

    function feedEntry(entry, c) {
      if (!entry || !c) return;
      entry.fed = c;
      feed(entry.el, c);
      for (var i = 0; i < entry.cards.length; i++) feed(entry.cards[i], c);
    }

    function viewElement(view) {
      var t = typeOf(view), ce = global.customElements;
      if (t.indexOf('custom:') !== 0) {
        var fb = doc().createElement('hk-view-fallback');
        fb.setConfig(view);
        return Promise.resolve(fb);
      }
      var tag = t.slice(7);
      var ready = ce && ce.whenDefined && !ce.get(tag) ? ce.whenDefined(tag) : Promise.resolve();
      return ready.then(function () {
        var el = doc().createElement(tag);
        el.setConfig(view);
        return el;
      }).catch(function (e) {
        // a view whose config throws: its cards in a column, under a note that says so
        try { console.error('[hk-view-host] view setConfig failed for', t, e); } catch (x) { /* no console */ }
        var fb = doc().createElement('hk-view-fallback');
        fb.setConfig(Object.assign({}, view, { __error: String((e && e.message) || e) }));
        return fb;
      });
    }

    function build(i) {
      var view = views()[i];
      return viewElement(view).then(function (el) {
        feed(el, client);
        try { el.narrow = narrow(); el.index = i; } catch (e) { /* a view without them */ }
        var cards = cardsOf(view).map(function (c) { return createCardElement(c, client); });
        el.cards = cards;
        return { el: el, cards: cards, view: view, index: i, path: pathOf(view, i), fed: client };
      });
    }

    function tell(entry, first) {
      listeners.slice().forEach(function (fn) {
        try { fn(entry.el, entry.view, config, { first: first, path: entry.path }); }
        catch (e) { try { console.error('[hk-view-host] view listener threw', e); } catch (x) { /* no console */ } }
      });
    }

    // Show the view at `path` (a path, an index, or '' for the first).
    // Resolves with its element, or null when a newer show() took over.
    function show(path) {
      var my = ++turn, i = find(path);
      target = i;
      if (i < 0) return Promise.resolve(null);
      var first = !cache[i];
      var wait = opts.willShow ? Promise.resolve().then(function () { return opts.willShow(views()[i], first); })
                                     .catch(function (e) { try { console.error('[hk-view-host] willShow', e); } catch (x) { /* */ } })
                               : Promise.resolve();
      return wait.then(function () {
        if (my !== turn) return null;
        return cache[i] ? cache[i] : build(i).then(function (entry) { cache[i] = cache[i] || entry; return cache[i]; });
      }).then(function (entry) {
        if (!entry || my !== turn) return null;
        if (entry.fed !== client) feedEntry(entry, client);
        if (cur === entry) return entry.el;
        var old = cur;
        cur = entry;
        // the shell learns the new view BEFORE it is attached: the view says
        // it is up (hk-view-ready) as it attaches, and the tab bar and the sky
        // ask the shell for it then
        tell(entry, first);
        if (old && old.el.parentNode === slot) slot.removeChild(old.el);
        slot.appendChild(entry.el);
        if (old && typeof win().scrollTo === 'function') { try { win().scrollTo(0, 0); } catch (e) { /* */ } }
        return entry.el;
      });
    }

    // Each new client: to the view shown and its cards. `force`: again with
    // the same client (Mantel records which states a page reads that way).
    function setClient(c, force) {
      if (!c || (c === client && !force)) return;
      client = c;
      if (cur) feedEntry(cur, c);
    }
    function refresh() { setClient(client, true); }

    // THE ROUTER: HK's navigation and the back button. A hash change (a
    // pop-up) is not a page change; an address on another dashboard leaves.
    function viewPathOf(pathname) {
      var parts = String(pathname || '').split('/');
      return { dashboard: '/' + (parts[1] || ''), view: parts[2] || '' };
    }
    function route() {
      var at = viewPathOf(global.location.pathname);
      if (at.dashboard !== base) {
        if (opts.leave) opts.leave(global.location.pathname);
        else global.location.assign(global.location.href);
        return null;
      }
      // the view asked for last (shown, or on its way) stays: nothing to do
      if (target === find(at.view) && target >= 0) return Promise.resolve(cur ? cur.el : null);
      return show(at.view);
    }

    function start() {
      var S = shell();
      if (S && S.onNavigate) offs.push(S.onNavigate(route));
      var w = win();
      if (w.addEventListener) {
        w.addEventListener('popstate', route);
        offs.push(function () { w.removeEventListener('popstate', route); });
      }
      if (opts.follow !== false && w.addEventListener) {
        var onUpdate = function () {
          var A = adapter();
          if (A && A.current) setClient(A.current());
        };
        w.addEventListener('hk-client-update', onUpdate);
        offs.push(function () { w.removeEventListener('hk-client-update', onUpdate); });
        onUpdate();                // the host's newest client, if it moved on since create()
      }
      return route();
    }
    function stop() { offs.splice(0).forEach(function (off) { try { off(); } catch (e) { /* */ } }); }

    // Move to a view of this dashboard by its path (HK's own navigation).
    function navigate(path) {
      var S = shell(), to = base + '/' + String(path || '');
      if (S && S.navigate) return S.navigate(to);
      return null;
    }

    // The parts of a host shell this host can answer (hkShell.use merges
    // them over the host's own): the container, the view shown, the config.
    function shellParts() {
      return {
        panel: function () { return container; },
        viewContainer: function () { return container; },
        viewSlot: function () { return container; },
        view: function (c) { return (c === undefined || c === container) && cur ? cur.el : null; },
        dashboardConfig: function () { return config; },
        tags: { viewContainer: container.localName || null, view: cur ? cur.el.localName : null }
      };
    }

    function onView(fn) {
      listeners.push(fn);
      return function () { var k = listeners.indexOf(fn); if (k >= 0) listeners.splice(k, 1); };
    }

    // Lovelace's card helpers, for the cards that ask for them (hk-grid-card,
    // hk-frame, pop-ups, detail sheets), when the host has none: the factory.
    if (opts.helpers !== false && typeof win().loadCardHelpers !== 'function') {
      win().loadCardHelpers = function () {
        return Promise.resolve({ createCardElement: function (cfg) { return createCardElement(cfg); } });
      };
    }

    return {
      config: config,
      base: base,
      container: container,
      slot: slot,
      show: show,
      start: start,
      stop: stop,
      route: route,
      navigate: navigate,
      setClient: setClient,
      refresh: refresh,
      client: function () { return client; },
      current: function () {
        return cur ? { path: cur.path, index: cur.index, view: cur.view, element: cur.el, cards: cur.cards.slice() } : null;
      },
      cached: function () { return Object.keys(cache).map(function (k) { return cache[k].path; }); },
      shellParts: shellParts,
      onView: onView
    };
  }

  global.hkViewHost = {
    create: create,
    createCardElement: createCardElement,
    holds: holds,
    define: define,
    BUILT_IN: Object.freeze(Object.assign({}, BUILT_IN))
  };
})(globalThis);
