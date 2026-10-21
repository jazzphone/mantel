// hk-layout.js -- building blocks: frame, spacer, back chevron, flat key, info block, grid
//
// hk-frame-card (native HA cards on our glass, lazy `module:` loading),
// hk-spacer-card, hk-back-card, hk-key-card, hk-info-card, hk-grid-card and
// the hk-grid-view view type.
//
// One file per family of cards, so each file's name says what is in it.
// Shared pieces -- HkBase, the editor helpers, register(), create(), the
// snapshot cache -- come from hk-base.js through window.hkCards.
(function () {
  'use strict';

  // hk-base.js is a Lovelace resource fetched in PARALLEL with this one, so
  // wait for its ready EVENT (never poll: rAF does not fire in a hidden tab,
  // and a tablet behind the screensaver would define nothing -- see
  // hk-base.js).
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-layout] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkLayout) return;                  // double-load guard
  var HkBase = C.HkBase, M = C.M, register = C.register, firstOf = C.firstOf,
      create = C.create;

  // -------------------------------------------------------- hk-frame
  //
  // WEARS OUR MATERIAL ON SOMEBODY ELSE'S CARD. It hosts one native HA card
  // and sets the five --ha-card-* custom properties on it, which is all
  // ha-card reads for its plate.
  //
  // WHY NOT `theme:`. That is the documented hook and it is what the camera
  // page uses, but it DOES NOT FIRE FOR A LAZILY-LOADED CARD. MEASURED on the
  // energy page: energy-* cards with a `theme:` in their config, in the same
  // HUI-CARD -> HUI-GRID-CARD chain the camera page uses, carry ONE inline
  // property against a camera card's hundreds. hui-card applies the theme to its child element once, when the
  // config changes; the energy cards live in a chunk that has not loaded yet
  // at that moment, so the call lands on nothing and never retries.
  //
  // WHAT THIS CANNOT REACH, so nobody re-litigates it: the chart's own type
  // scale, its tooltip, and the date picker's chip row are drawn from HA's
  // component styles and have no theme variables at all. A framed card reads
  // as an HA card wearing our plate -- which is the point, but it is not the
  // same as one of ours.
  // `module:` -- A THIRD-PARTY CARD THAT LOADS ONLY WHERE IT IS USED.
  //
  // A Lovelace resource loads on EVERY dashboard page, used or not.
  // weather-radar-card is 457 KB for one card on one subview, so it need
  // not be a resource: the frame imports
  // it the first time the Weather page builds this card, waits for the element
  // to be defined, and only then asks HA to create it. Before the import
  // HA's createCardElement would build an error card for an unknown tag.
  //
  // import() with a <script type=module> fallback, the same pair hk-loader.js
  // uses, because a WebView that refuses a dynamic import still runs a module
  // tag. One promise per URL, so two framed cards never import twice.
  //
  // CACHE NOTE: /hacsfiles/ is served with max-age 31 days, and the resource
  // registry's ?hacstag= is what busts it on a HACS update -- a module URL
  // has none. After updating the card in HACS, bump `?v=` on the module URL
  // in the YAML.
  var MODULES = {};
  function loadModule(url, type) {
    var tag = String(type || '').replace(/^custom:/, '');
    if (tag && customElements.get(tag)) return Promise.resolve();
    if (!MODULES[url]) {
      MODULES[url] = new Promise(function (resolve, reject) {
        import(url).then(resolve, function () {
          var sc = document.createElement('script');
          sc.type = 'module';
          sc.src = url;
          sc.onload = resolve;
          sc.onerror = reject;
          document.head.appendChild(sc);
        });
      });
    }
    return MODULES[url].then(function () {
      return tag ? customElements.whenDefined(tag) : null;
    });
  }

  class HkFrameCard extends HkBase {
    static get CSS() {
      return [
        ':host{display:block}',
        // The frame itself paints NOTHING. The child's own ha-card is the
        // plate; drawing a second one behind it would show as a shoulder in
        // every corner, the same way a tinted plate behind a rounded camera
        // does.
        '.frame{display:block;margin:0}',
        // HOME ASSISTANT'S OWN CARD, ON HK'S GLASS: it draws with HA's theme
        // colors, and with the browser in light mode those are dark gray (the
        // HK Kiosk theme's light mode: #1f1f1f) -- dim on the dark glass (first
        // seen on HA's own energy cards; HK draws its Energy page itself now,
        // and this still serves every other framed HA card). On an HK screen the frame hands it HK's text scale instead; on a
        // light page of someone else's dashboard (data-hk-light) HA's own
        // light colors are right and stay.
        ':host(:not([data-hk-light])) .frame{',
        '  --primary-text-color:rgba(255,255,255,0.94);',
        '  --secondary-text-color:rgba(255,255,255,0.68);',
        '  --disabled-text-color:rgba(255,255,255,0.40);',
        '  --divider-color:rgba(255,255,255,0.12)}',
        // `phone: hide` -- a framed HA card that cannot be made to fit a phone
        // (energy-sources-table is 459px wide at 402 and has no responsive
        // mode of its own) is dropped from the layout there instead of
        // overflowing the page. Same 640px line as hk-responsive.css.
        '@media (max-width:' + window.hkCards.BP.phone + 'px){:host(.hide-phone){display:none}}'
      ].join('');
    }
    static get MATERIALS() {
      return {
        // hk_glass_tile, the material every other card on these pages wears.
        // M.bg, NOT the literal: the plate follows the Glass look like every
        // other card, so a framed card frosts with its neighbours. The frame
        // itself carries the blur marker in dress() below, at the same
        // radius, so the shared layer is cut to it.
        glass: {
          '--ha-card-background': M.bg,
          '--ha-card-border-radius': M.radius,
          '--ha-card-border-width': '1px',
          '--ha-card-border-color': 'var(--hk-look-edge-color, rgba(255,255,255,0.13))',
          '--ha-card-box-shadow': 'var(--hk-look-shadow, 0 10px 28px rgba(0,0,0,0.12))'
        },
        // Full-bleed media (the radar map): rounded like the glass, but a
        // transparent plate with no rim, so the content's own clipped corners
        // are the edge. The same values as the `HK Kiosk Camera` theme,
        // which a framed card cannot use -- see the lazy-load note in _build.
        media: {
          '--ha-card-background': 'transparent',
          '--ha-card-border-radius': '23.5px',
          '--ha-card-border-width': '0px',
          '--ha-card-box-shadow': 'var(--hk-look-shadow, 0 8px 22px rgba(0,0,0,0.12))'
        },
        // No plate at all -- for a card that paints its own.
        none: {
          '--ha-card-background': 'none',
          '--ha-card-border-width': '0px',
          '--ha-card-box-shadow': 'none'
        }
      };
    }
    setConfig(config) {
      if (!config || !config.card || !config.card.type) {
        throw new Error('hk-frame: `card` is required');
      }
      super.setConfig(config);
      this.classList.toggle('hide-phone', config.phone === 'hide');
    }
    getCardSize() { return 6; }
    // The wrapper is static; the child owns its independent update gate.
    // EACH NEW CLIENT (either entry of HkBase), then the child gets what goes with it.
    _receiveClient() {
      super._receiveClient();
      if (this._child) window.hkHostClient.bridge(this._child, this.client);
    }
    // The frame has no state of its own; the child gates its own renders.
    _sigOf() { return 'static'; }
    // HA's OWN HELPERS BUILD THE CHILD, not document.createElement.
    //
    // The energy cards live in a chunk HA loads on demand, and it loads it
    // when ITS createCardElement asks for the card -- creating the element by
    // tag name never triggers that import, so the element sits there
    // unupgraded forever: the right tag, no shadow root, and `typeof
    // setConfig === "undefined"`. It renders as nothing and reports no error.
    //
    // loadCardHelpers() is HA's documented way in. createCardElement() imports
    // the chunk, constructs the element and calls setConfig for us.
    _build() {
      var cfg = this._config, self = this;
      this._child = null;
      var dress = function (el) {
        // Helpers/module imports may finish after the editor replaces config.
        if (self._config !== cfg) return;
        var matName = cfg.material || 'glass';
        var mat = HkFrameCard.MATERIALS[matName];
        if (mat) {
          Object.keys(mat).forEach(function (k) { el.style.setProperty(k, mat[k]); });
        }
        // The frame is the glass SURFACE for hk-glass.js: the child's plate
        // fills it edge to edge, so cutting the shared blur to the frame's
        // rounded box is cutting it to the plate.
        if (self._e && self._e.style) {
          self._e.style.borderRadius = matName === 'glass' ? M.radius : '';
          self._e.style.setProperty('--hk-glass-surface', matName === 'glass' ? '1' : '');
        }
        // `vars:` -- per-card extras, applied AFTER the material so they win.
        // For a card that paints a surface of its own inside the plate:
        // energy-sources-table fills its whole table and header row with
        // --card-background-color, a solid grey slab over the glass. That
        // variable is NOT in the material because the date picker's dropdown
        // reads the same one, and a transparent menu over a chart is unreadable.
        var extra = cfg.vars || {};
        Object.keys(extra).forEach(function (k) {
          el.style.setProperty(k.slice(0, 2) === '--' ? k : '--' + k, String(extra[k]));
        });
        self._child = el;
        self._e.appendChild(el);
        window.hkHostClient.bridge(el, self.client);
      };
      if (window.loadCardHelpers) {
        var make = function () {
          return window.loadCardHelpers().then(function (h) {
            try {
              dress(h.createCardElement(cfg.card));
            } catch (e) {
              console.error('[hk-frame] could not create', cfg.card, e);
            }
          });
        };
        if (cfg.module) {
          loadModule(cfg.module, cfg.card.type).then(make, function (e) {
            console.error('[hk-frame] module failed', cfg.module, e);
            make();                     // HA then shows its own error card
          });
        } else {
          make();
        }
        return;
      }
      // No helpers (an older core): our own cards still work by tag.
      var C = window.hkCards;
      var own = (C && C.create) ? C.create(cfg.card) : null;
      if (own) dress(own);
    }

    _render() {
      var cfg = this._config;
      if (!this._built) {
        this._root.innerHTML = '<div class="frame" data-hk-role="card"></div>';
        this._e = this._root.querySelector('.frame');
        if (cfg.margin) this._e.style.margin = cfg.margin;
        this._built = true;
        this._build();
      }
    }
  }

  // -------------------------------------------------------- hk-spacer
  //
  // NOTHING, at a given height. A Lovelace view is a list of cards and has no
  // way to say "leave a gap here". This is the knob for
  // how far apart two blocks sit; a margin on the block above is not, because
  // that margin belongs to the block and travels with it everywhere else it
  // is used.
  class HkSpacerCard extends HkBase {
    static get CSS() {
      return ['hk-plate.spacer{display:block;background:none;box-shadow:none;',
              '  border:none;padding:0;margin:0}'].join('');
    }
    setConfig(config) { super.setConfig(config || {}); }
    getCardSize() { return 1; }
    _sigOf() { return 'static'; }
    _render() {
      if (!this._built) {
        this._root.innerHTML =
          '<hk-plate class="spacer" data-hk-role="card" aria-hidden="true"></hk-plate>';
        this._e = this._root.querySelector('.spacer');
        this._built = true;
      }
      this._e.style.height = this._config.height || '16px';
    }
  }

  // ------------------------------------------------------------ hk-back
  // A 44px circle with a chevron in it. One instance, included by every
  // subview, and it knows ONE thing the browser's own back does not: which
  // page is a page's parent.
  //
  // Most subviews hang directly off the chip row, so "up" is the dashboard.
  // `music-browse` does not -- it is reached only from Play Music, so backing
  // out to the dashboard would skip a level and drop you two pages from where
  // you started. A page reached from another page adds one line to `parents`.
  // THE ROUND GLASS BUTTON, shared by the back chevron and the menu button
  // beside it (and hk-menu-button-card): one plate, one press, one size.
  var ROUND_CSS = [
    // THE SAME GLASS AS THE CHIPS, blur and all. M.glass is the
    // plate and the marker that cuts the shared blur to this circle;
    // the chip shadow because it is chip-sized.
    // (Glass: blurring what is behind it as each chip does -- hk-chip.js; the
    // other looks set --hk-chip-backdrop: none, as for the chips. It had the
    // plate and not the blur: the menu chip read clear at the head of a
    // frosted row.)
    'hk-plate.back{width:44px;height:44px;border-radius:50%;padding:0;margin:0;flex:none;',
    '  ' + M.glass + ';border:' + M.border + ';',
    '  backdrop-filter:var(--hk-chip-backdrop,blur(20px) saturate(1.4) brightness(0.82));',
    '  -webkit-backdrop-filter:var(--hk-chip-backdrop,blur(20px) saturate(1.4) brightness(0.82));',
    '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-chip') + ');',
    '  display:flex;align-items:center;justify-content:center;line-height:0;',
    '  cursor:pointer;color:' + window.hkCards.v('glyph') + ';',
    '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
    '  transition:transform .12s ease}',
    'hk-plate.back:active{transform:scale(0.97);filter:brightness(0.93)}',
    // ON A LIGHT PAGE (hk-base.js tone) no blur: brightness(0.82) would
    // darken the page behind the plate (the chips do the same, hk-chip.js)
    ':host([data-hk-light]) hk-plate.back{backdrop-filter:none;-webkit-backdrop-filter:none}',
    // The menu glyph at the chevron's optical size: an SF glyph fills its
    // 24 box to 21, so 20px here draws it as wide as the 20px chevron.
    'hk-plate.back hk-icon{--mdc-icon-size:20px;width:20px;height:20px;display:flex}',
    // MENU, BACK, TITLE: 20px between each, so a tap meant for one does not
    // land on its neighbour. The title's 20 is the page's own grid gap.
    '.pair{display:flex;align-items:center;gap:20px}'
  ].join('');
  // The menu's state (hk-base.js). The first load after an update can pair
  // this file with the previous hk-base.js from the service worker's cache,
  // which has no menu: then there is no menu for that load, rather than a
  // back button that throws.
  var NO_MENU = { sig: function () { return ''; }, style: function () { return null; },
                  icon: function () { return ''; }, toggle: function () {} };
  function menu() { return (C && C.menu && C.menu.sig) ? C.menu : NO_MENU; }
  function roundMenu() {
    return '<hk-plate class="back menu" data-hk-role="menu" role="button" aria-label="Menu">' +
      '<hk-icon icon="' + menu().icon() + '"></hk-icon></hk-plate>';
  }

  // A card that drew the round menu button, attached again (a cached view
  // coming back redraws nothing): hand it back to the menu's list.
  function chipBack(card) {
    var m = card._built && card._root && card._root.querySelector && card._root.querySelector('[data-hk-role="menu"]');
    if (m && menu().chipShown) menu().chipShown(card);
  }

  class HkBackCard extends HkBase {
    static get CSS() { return ROUND_CSS; }
    getCardSize() { return 1; }
    // Depends on the URL and the menu's state, not on the client: the menu button
    // beside the chevron comes and goes with the menu's settings.
    _sigOf() { return 'menu=' + menu().sig(); }
    connectedCallback() { super.connectedCallback(); chipBack(this); }
    disconnectedCallback() { super.disconnectedCallback(); if (menu().chipGone) menu().chipGone(this); }
    _render() {
      // THE MENU BUTTON RIDES HERE on a dashboard whose menu uses the round
      // button (hk-base.js menu.style): every sub-page has this card, so the
      // menu is always one tap away, in the same place as the Home page's
      // chip. With the edge tab, or no menu, the chevron is alone -- exactly
      // as on a dashboard without the menu.
      var withMenu = menu().round ? menu().round('page') : menu().style() === 'chip';
      var icon = withMenu ? menu().icon() : '';
      if (this._built && this._menuWas === withMenu && this._iconWas === icon) return;
      this._menuWas = withMenu;
      this._iconWas = icon;
      // The chevron is drawn, not iconised: at 44px an mdi glyph's own padding
      // makes it read small and off-centre, and this stroke weight (2.6) was
      // matched to the 19.7px headings it sits beside.
      var back =
        '<hk-plate class="back" data-hk-role="card" role="button" aria-label="Back">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none"' +
        ' style="stroke:' + window.hkCards.v('glyph') + '" stroke-width="2.6"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M15 4.5 L7.5 12 L15 19.5"/></svg></hk-plate>';
      this._root.innerHTML = withMenu ? '<div class="pair">' + roundMenu() + back + '</div>' : back;
      this._root.querySelector('[data-hk-role="card"]')
          .addEventListener('click', this._up.bind(this));
      var m = this._root.querySelector('[data-hk-role="menu"]');
      if (m) m.addEventListener('click', function (e) { e.stopPropagation(); menu().toggle(); });
      if (m && menu().chipShown) menu().chipShown(this);
      this._built = true;
    }
    // A PAGE WITH DEPTH OF ITS OWN GETS FIRST REFUSAL.
    //
    // Browse Music is a browser: you can be three levels into the library on
    // a page whose "up" is Play Music. Backing out to the parent there would
    // leave the page entirely, skipping every level you had opened.
    //
    // The answer is NOT history.back(): on a wall tablet, "back always lands
    // on the room" cannot strand you mid-history, and history.back() can.
    //
    // So the press is OFFERED first, as a cancelable event. A card with
    // somewhere to go internally calls preventDefault() and handles it; every
    // other page is untouched and still backs out to its parent.
    // One control, two meanings, and the page that knows decides.
    _up() {
      var ev = new CustomEvent('hk-back', { cancelable: true, detail: {
        path: String(location.pathname) } });
      window.dispatchEvent(ev);
      if (ev.defaultPrevented) return;
      var parents = this._config.parents || {};
      var seg = String(location.pathname).split('/');
      var up = parents[seg[2] || ''];
      // Home by its own path: the bare dashboard address made Home Assistant
      // put Home's path on it with a second page change, and every
      // page-change listener ran twice on every way back (seen on the tablet:
      // security -> /<dashboard> -> home)
      if (!up) {
        var cfg = menu().config ? menu().config() : null, v0 = cfg && cfg.views && cfg.views[0];
        if (v0 && v0.path) up = v0.path;
      }
      var path = '/' + seg[1] + (up ? '/' + up : '');
      // dimmed for a drawn frame first: the tap answered before the page is
      window.hkCards.navigate(path, this._root && this._root.querySelector('hk-plate.back'));
    }
  }

  // ------------------------------------------------------------- hk-menu-button
  //
  // THE MENU CHIP: a round glass button that opens the menu of pages and
  // rooms (modules/hk-menu.js). Usually the chip row's `lead:` -- pinned at
  // its start while the chips scroll -- and anywhere else a dashboard wants
  // one. It draws ONLY when this dashboard's menu uses the round button
  // (hk-base.js menu.style: chip); otherwise it takes no space at all, so a
  // shared chip row carries it on every dashboard and changes nothing on the
  // ones without the menu. Its presence on a Home view is also what makes
  // Automatic choose the chip over the edge tab.
  class HkMenuButtonCard extends HkBase {
    static get CSS() { return ':host{display:block}:host([hidden]){display:none}' + ROUND_CSS; }
    getCardSize() { return 1; }
    _sigOf() { return 'menu=' + menu().sig(); }
    connectedCallback() { super.connectedCallback(); chipBack(this); }
    disconnectedCallback() { super.disconnectedCallback(); if (menu().chipGone) menu().chipGone(this); }
    _render() {
      var show = menu().round ? menu().round('home') : menu().style() === 'chip';
      var icon = show ? menu().icon() : '';
      if (this._built && this._showWas === show && this._iconWas === icon) return;
      this._showWas = show;
      this._iconWas = icon;
      this.toggleAttribute('hidden', !show);
      this._root.innerHTML = show ? roundMenu() : '';
      var m = this._root.querySelector('[data-hk-role="menu"]');
      if (m) m.addEventListener('click', function (e) { e.stopPropagation(); menu().toggle(); });
      if (m && menu().chipShown) menu().chipShown(this);
      this._built = true;
    }
  }

  // ------------------------------------------------------------- hk-key
  //
  // A FLAT KEY: one plate, and on it either a glyph or a word, with no state
  // of its own. A key reads no entity except to name a service target.
  //
  // ONE CARD FOR BOTH because they differ only in their plate and their
  // payload, and a key that looks different is still a key. Three variants:
  //
  //   flat    rgba white 0.10, no border, no rim -- the four vacuum controls,
  //           which sit INSIDE a card and must not read as cards themselves
  //   glass   the house glass material with its lit top rim -- the six
  //           free-standing duration chips
  //   filled  a solid tint with dark ink -- the one "+ New Timer" call to
  //           action, which has to out-rank the six chips beside it
  //
  // Not a tile subclass: a tile is an accessory with a state, a well and an
  // on/off material, and every one of those would be dead weight here.
  class HkKeyCard extends HkBase {
    static get CSS() {
      return [
        'hk-plate.key{display:flex;align-items:center;justify-content:center;',
        '  box-sizing:border-box;cursor:pointer;overflow:hidden;',
        '  transition:background-color .25s ease,transform .12s ease;',
        '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
        'hk-plate.key:active{transform:scale(0.97);filter:brightness(0.93)}',
        // ---- flat: the controls inside a vacuum card
        'hk-plate.key.flat{height:52px;border-radius:18px;padding:0;border:none;',
        '  box-shadow:none;background:' + window.hkCards.v('key') + '}',
        'hk-plate.key.flat .icon{width:23px;height:23px;color:' + window.hkCards.v('glyph') + '}',
        // ---- glass: the free-standing duration chips
        // 116x56 and a 20px radius: wider and flatter than the 52px controls
        // above, because a row of NINE 52px squares reads as a keypad, which
        // is the wrong idea -- these are not digits you combine.
        'hk-plate.key.glass{height:56px;width:116px;border-radius:20px;padding:0;',
        '  ' + window.hkCards.M.glass + ';',
        '  border:' + window.hkCards.M.border + ';',
        '  box-shadow:var(--hk-look-shadow, inset 0 1px 0 rgba(255,255,255,0.20),0 6px 18px rgba(0,0,0,0.10))}',
        'hk-plate.key.filled{height:56px;width:116px;border-radius:20px;padding:0;',
        '  border:none;box-shadow:var(--hk-look-shadow, inset 0 1px 0 rgba(255,255,255,0.20),',
        '  0 6px 18px rgba(0,0,0,0.10))}',
        '.key .name{font-size:17px;font-weight:600;letter-spacing:-0.4px;',
        '  color:' + window.hkCards.v('ink') + ';white-space:nowrap}',
        'hk-plate.key.filled .name{color:rgba(0,0,0,0.88);font-weight:700}',
        // PHONE: FILL THE TRACK. The Timers row auto-fills ~118px columns
        // below 640px and a 184px "+ New Timer" would overflow its column,
        // printing on top of the "5 min" chip beside it. Same shape as the
        // pills: calc(100% + 8px) restores layout-card's 4px side margins.
        '@media (max-width:' + window.hkCards.BP.phone + 'px){',
        '  :host{max-width:none !important}',
        '  hk-plate.key.glass,hk-plate.key.filled{',
        '    width:calc(100% + var(--hk-cell-bleed,8px)) !important;',
        '    min-width:0 !important;max-width:none !important}',
        '}'
      ].join('');
    }
    setConfig(config) {
      if (!config || (!config.icon && !config.name)) {
        throw new Error('hk-key: one of `icon` or `name` is required');
      }
      super.setConfig(config);
    }
    getCardSize() { return 1; }
    // A key has no state -- it never needs a re-render from the client at all.
    _sigOf() { return 'static'; }
    _render() {
      var cfg = this._config;
      if (!this._built) {
        var variant = ['flat', 'glass', 'filled'].indexOf(cfg.variant) >= 0
          ? cfg.variant : 'glass';
        this._root.innerHTML =
          '<hk-plate class="key ' + variant + '" data-hk-role="card">' +
          (cfg.icon ? '<hk-state-icon class="icon" data-hk-role="icon"></hk-state-icon>'
                    : '<div class="name" data-hk-role="name"></div>') +
          '</hk-plate>';
        this._e = {
          card: this._root.querySelector('.key'),
          icon: this._root.querySelector('.icon'),
          name: this._root.querySelector('.name')
        };
        this._bind(this._e.card, 'tap_action', null);
        this._built = true;
      }
      var e = this._e;
      if (cfg.width) e.card.style.width = cfg.width;
      if (cfg.fill) e.card.style.background = cfg.fill;
      if (e.icon) {
        e.icon.icon = cfg.icon;
        var cl = this.client;
        if (cl) cl.bindStateIcon(e.icon);
        if (cfg.icon_color) e.icon.style.color = cfg.icon_color;
      }
      if (e.name && e.name.textContent !== cfg.name) e.name.textContent = cfg.name;
    }
  }

  // --------------------------------------------------------- hk-info-card
  //
  // The two big blocks at the top of the Tesla dashboard: the house
  // temperature and the security summary. An icon, a headline, two label
  // lines, and an icon tint that carries the actual signal.
  //
  // BOTH READINGS ARE ONE CALCULATION EACH, SHARED WITH THE WALL HEADER.
  // A private copy of the entity lists drifts from modules/hk-header.js --
  // missing the window checks, or returning "Home Secure" whenever the
  // counters sum to zero, which an EMPTY state map also does. Every id lives
  // once, in hkHeader's SECURITY_* lists, and this card asks hkHeader.status().
  class HkInfoCard extends HkBase {
    static get CSS() {
      return [
        // No plate at all -- these sit on the Tesla's own background. The
        // three stacked drop-shadows are what makes them legible over it.
        'hk-plate.info{box-sizing:border-box;display:block;height:108px;',
        '  border-radius:0;padding:12px;background:none;border:none;box-shadow:none;',
        '  cursor:pointer;',
        '  filter:var(--hk-glow,drop-shadow(0px 1px 3px rgba(0,0,0,0.30))',
        '    drop-shadow(0px 3px 12px rgba(0,0,0,0.28))',
        '    drop-shadow(0px 6px 26px rgba(0,0,0,0.30)));',
        '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
        '.info .grid{display:grid;grid-template-areas:"i n" "i l";',
        '  grid-template-columns:52px minmax(0,1fr);',
        '  grid-template-rows:min-content min-content;',
        '  column-gap:12px;align-content:start;justify-items:start}',
        '.info .icon{grid-area:i;width:34px;height:34px;--mdc-icon-size:34px;',
        '  color:' + window.hkCards.v('glyph') + ';align-self:start;justify-self:center;',
        '  margin-top:2px}',
        '.info .name{grid-area:n;justify-self:start;align-self:end;text-align:left;',
        '  font-weight:600;font-size:26px;letter-spacing:0.3px;',
        '  color:' + window.hkCards.v('ink') + ';line-height:1.02;width:100%}',
        '.info .label{grid-area:l;justify-self:start;align-self:start;text-align:left;',
        '  font-weight:600;font-size:14px;letter-spacing:-0.34px;',
        '  color:' + window.hkCards.v('ink-2') + ';line-height:1.1;width:100%}',
        // Two lines, each clipped on its own. A single wrapping block would
        // let one long alarm string push the other line out of the card.
        '.info .label span{display:block;white-space:nowrap;overflow:hidden;',
        '  text-overflow:ellipsis;text-align:left}',
        // ---- the `state` variant: the same shape reading ONE entity, so it
        // needs no computation and no shadow -- it sits on a glass sheet
        // rather than on the Tesla's photographic background.
        //
        // ON THE PILLS' COLUMNS, or the whole block seems to push to the
        // right. It sits over the Locks, whose pills put their icon well at
        // 15.3 px in (layout-card's 4 px child margin, the pill's 1 px border
        // and its 10.3 px padding),
        // 42 px wide, and their names 10 px after it. 18 px of padding and a
        // 54 px column would put the shield 12 px right of the lock icons and
        // "Disarmed" 20 px right of their names; this centres the shield on
        // the lock icons' column and starts the words where their names do.
        'hk-plate.info.state{height:104px;border-radius:24px;padding:16px 18px 16px 15.3px;',
        '  filter:none}',
        '.info.state .grid{grid-template-columns:42px 1fr;column-gap:10px;',
        '  align-items:center;align-content:center}',
        '.info.state .icon{width:38px;height:38px;--mdc-icon-size:38px;',
        '  align-self:center;justify-self:center;margin-top:0}',
        '.info.state .name{font-size:25px;font-weight:700;letter-spacing:0.14px;',
        '  align-self:center;color:' + window.hkCards.v('ink') + '}',
        '.info.state .label{font-size:14px;font-weight:400;letter-spacing:-0.15px;',
        '  color:' + window.hkCards.v('ink-2') + ';padding-top:4px}'
      ].join('');
    }
    setConfig(config) {
      if (!config || ['climate', 'security', 'state'].indexOf(config.variant) < 0) {
        throw new Error('hk-info: `variant` must be climate, security or state');
      }
      if (config.variant === 'state' && !config.entity) {
        throw new Error('hk-info: variant `state` needs an `entity`');
      }
      super.setConfig(config);
    }
    getCardSize() { return 2; }

    // `state` reads ONE entity and `climate` three, all named in the config,
    // so both gate like any other card. `security` calls hkHeader.status(),
    // which reads a list of entities this config does not name, so no
    // signature could describe it honestly -- null means "always render",
    // the safe answer, and a dashboard rarely has more than one.
    _sigOf() {
      var c = this._config, h = this.client;
      if (!c || !h) return null;
      if (c.variant === 'state') return HkBase.prototype._sigOf.call(this);
      if (c.variant !== 'climate') return null;
      var ids = [c.temperature, c.downstairs, c.upstairs], out = '';
      for (var i = 0; i < ids.length; i++) {
        var s = ids[i] && h.states[ids[i]];
        out += (ids[i] || '-') + '=' + (s ? s.last_updated : 'x') + ';';
      }
      return out;
    }

    _num(id) {
      var s = id && this._st(id);
      var n = parseFloat(s && s.state);
      return isNaN(n) ? null : n;
    }
    _action(id) {
      var s = id && this._st(id);
      return (s && s.attributes && s.attributes.hvac_action) || null;
    }

    // ---- climate: the house temperature, and what the two systems are doing.
    _climate() {
      var cfg = this._config;
      var temp = this._num(cfg.temperature);
      var down = this._action(cfg.downstairs), up = this._action(cfg.upstairs);
      var dc = down === 'cooling', uc = up === 'cooling';
      var dh = down === 'heating', uh = up === 'heating';
      var act = 'Idle';
      if (dc && uc) act = 'Cooling Both';
      else if (dc) act = 'Cooling Down';
      else if (uc) act = 'Cooling Up';
      else if (dh && uh) act = 'Heating Both';
      else if (dh) act = 'Heating Down';
      else if (uh) act = 'Heating Up';
      // THE SENSOR'S OWN UNIT, and the comfort band in it: 66-74 °F unless
      // the card says otherwise (cool_below / warm_above), 19-23 in °C.
      var tst = cfg.temperature && this._st(cfg.temperature);
      var unit = (tst && tst.attributes && tst.attributes.unit_of_measurement) || window.hkLocale.units().temp;
      var celsius = /C$/.test(unit);
      var cool = cfg.cool_below != null ? Number(cfg.cool_below) : (celsius ? 19 : 66);
      var warm = cfg.warm_above != null ? Number(cfg.warm_above) : (celsius ? 23 : 74);
      var colour;
      if (dc || uc) colour = 'rgba(33, 150, 243, 0.98)';
      else if (dh || uh) colour = 'rgba(244, 67, 54, 0.98)';
      else if (temp === null) colour = 'var(--kiosk-text)';
      else if (temp <= cool) colour = 'rgba(33, 150, 243, 0.98)';
      else if (temp >= warm) colour = 'rgba(244, 67, 54, 0.98)';
      else colour = 'rgba(76, 175, 80, 0.98)';
      return {
        name: temp === null ? 'House' : (Math.round(temp) + unit),
        lines: ['Temperature', act],
        colour: colour
      };
    }

    // ---- security: shut, locked, and the garage.
    _security() {
      // NO STATES YET IS THE NORMAL FIRST RENDER. setConfig() renders before
      // Lovelace hands over its object, and hkHeader.status(null) throws -- which HA
      // catches by replacing the whole card with a permanent error card, so
      // the block would never appear at all. Guard on the states object, not
      // just on hkHeader.
      var st = this.client && this.client.states;
      var s = (st && window.hkHeader) ? window.hkHeader.status(st) : null;
      // No hkHeader is not "all clear" -- it is "cannot tell", and this card
      // says so rather than reading "Home Secure" for an empty map.
      if (!s) {
        return { name: 'Check Home', lines: ['Unknown', 'Garage Unknown'],
                 colour: 'rgba(244, 67, 54, 0.98)' };
      }
      var titleCase = function (v) {
        if (!v || v === 'unknown' || v === 'unavailable') return 'Unknown';
        return String(v).replace(/_/g, ' ').split(' ').map(function (w) {
          return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).join(' ');
      };
      var alarm = s.alarmRaw || 'unknown';
      var unlocked = s.unlocked || 0;
      var gd = this._st(this._config.garage);
      var garage = (gd && gd.state) || 'unknown';
      var lockText = unlocked > 0
        ? (unlocked + ' Lock' + (unlocked === 1 ? '' : 's'))
        : 'All Locked';
      var garageText = garage === 'open' ? 'Garage Open'
                     : garage === 'opening' ? 'Garage Opening'
                     : garage === 'closing' ? 'Garage Closing'
                     : garage === 'closed' ? 'Garage Closed'
                     : 'Garage Unknown';
      var garageOpen = ['open', 'opening', 'closing'].indexOf(garage) >= 0;
      // The headline means the house is physically SHUT -- not the wall's
      // "armed and clear" -- so the ordinary disarmed-but-closed reading is
      // unchanged. The alarm state is on the label line and is not lost.
      //
      // s.alert covers doors AND windows, and s.unusable is the honest part:
      // an icon that stays calm because its sensors are dead tells the same
      // lie as "Home Secure" for an empty map.
      var bad = unlocked > 0 || garageOpen || s.alert || s.unusable > 0;
      var armed = ['armed_home', 'armed_away', 'armed_night', 'armed_vacation']
                    .indexOf(alarm) >= 0;
      return {
        name: (s.alert || s.unusable > 0) ? 'Check Home' : 'Home Secure',
        // No garage configured, no garage line (not "Garage Unknown").
        lines: [titleCase(alarm) + ' • ' + lockText].concat(this._config.garage ? [garageText] : []),
        colour: bad ? 'rgba(244, 67, 54, 0.98)'
              : armed ? 'rgba(76, 175, 80, 0.98)' : 'rgba(33, 150, 243, 0.98)'
      };
    }

    // ---- state: one entity, title-cased, with declarative glyph and tint
    // maps. No computation at all.
    _state() {
      var cfg = this._config, st = this._st(cfg.entity);
      var v = (st && st.state) || 'unknown';
      var title = String(v).replace(/_/g, ' ').split(' ').map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(' ');
      var pickFrom = function (map, dflt) {
        if (!map) return dflt;
        if (Object.prototype.hasOwnProperty.call(map, v)) return map[v];
        // `armed_*` is four states that share a glyph and a tint, so a prefix
        // entry earns its keep rather than four near-identical rows.
        var keys = Object.keys(map);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (k.slice(-1) === '*' && v.indexOf(k.slice(0, -1)) === 0) return map[k];
        }
        return map['default'] != null ? map['default'] : dflt;
      };
      return {
        name: cfg.name || title,
        lines: [cfg.label || '', ''],
        icon: pickFrom(cfg.icon_states, cfg.icon),
        colour: pickFrom(cfg.icon_colors, 'var(--hk-glyph, rgba(255,255,255,0.75))')
      };
    }

    _render() {
      var cfg = this._config;
      if (!this._built) {
        this._root.innerHTML =
          '<hk-plate class="info' + (cfg.variant === 'state' ? ' state' : '') +
          '" data-hk-role="card"><div class="grid">' +
          '<hk-icon class="icon" data-hk-role="icon"></hk-icon>' +
          '<div class="name" data-hk-role="name"></div>' +
          '<div class="label" data-hk-role="label">' +
          '<span data-hk-role="l1"></span><span data-hk-role="l2"></span></div>' +
          '</div></hk-plate>';
        var q = this._root.querySelector.bind(this._root);
        this._e = { card: q('.info'), icon: q('.icon'), name: q('.name'),
                    l1: q('[data-hk-role="l1"]'), l2: q('[data-hk-role="l2"]') };
        this._bind(this._e.card, 'tap_action', null);
        this._built = true;
      }
      var e = this._e;
      var r = cfg.variant === 'climate' ? this._climate()
            : cfg.variant === 'state' ? this._state() : this._security();
      var ic = r.icon || cfg.icon;
      if (ic) e.icon.icon = ic;
      e.icon.style.color = r.colour;
      if (e.name.textContent !== r.name) e.name.textContent = r.name;
      if (e.l1.textContent !== r.lines[0]) e.l1.textContent = r.lines[0];
      if (e.l2.textContent !== r.lines[1]) e.l2.textContent = r.lines[1];
    }
  }

  register('hk-frame-card', HkFrameCard, 'HK Frame',
    'Wraps any Home Assistant card in the HK glass background.',
    C && [
      { name: 'card', required: true, selector: { object: {} } },
      C.section('Appearance', [
        { type: 'grid', name: '', schema: [
          { name: 'material', selector: C.selOptions(['glass', 'none']) },
          { name: 'margin', selector: { text: {} } },
          { name: 'phone', selector: C.selOptions(['hide']),
            helper: 'hide: leave this card out of the layout below 640px.' }
        ] },
        { name: 'vars', label: 'CSS Variables',
          helper: 'CSS variables set on the wrapped card, e.g. card-background-color: transparent.',
          selector: { object: {} } }
      ], 'mdi:palette')
    ],
    function () { return { card: { type: 'energy-usage-graph' } }; });

  register('hk-spacer-card', HkSpacerCard, 'HK Spacer',
    'Empty space of a set height, to separate rows.',
    C && [{ name: 'height', selector: { text: {} }, helper: 'CSS height, e.g. 16px.' }],
    function () { return { height: '16px' }; });

  register('hk-back-card', HkBackCard, 'HK Back Button',
    'A round back button for a sub-page; returns to the page above it.',
    C && [{ name: 'parents', selector: { object: {} } }],
    function () { return {}; });

  // No options of its own: when it draws, and with which glyph, are the menu's
  // settings. The one editor field is the standard `glass` opt-out.
  register('hk-menu-button-card', HkMenuButtonCard, 'HK Menu Button',
    'Opens the menu of pages and rooms. Draws only on a dashboard with the menu turned on (' + window.hkShell.haPlace('HK Frontend → Configure → Menu and room pages') + '); put it in a chip row as its lead.',
    C && [{ name: 'glass', selector: { boolean: {} },
            helper: 'Off: leave this button out of the shared blur (Glass look: Blur).' }],
    function () { return {}; });

  register('hk-key-card', HkKeyCard, 'HK Button',
    'A plain button showing an icon or a word, which runs an action when tapped.',
    C && [
      { type: 'grid', name: '', schema: [
        { name: 'name', selector: { text: {} }, helper: 'Text on the button. Use this or an icon.' },
        { name: 'icon', selector: { icon: {} } }
      ] },
      C.section('Appearance', [
        { type: 'grid', name: '', schema: [
          { name: 'variant', selector: C.selOptions(['glass', 'flat', 'filled']) },
          { name: 'icon_color', selector: C.selColour() },
          { name: 'fill', selector: { text: {} } },
          { name: 'width', selector: { text: {} } }
        ] }
      ], 'mdi:palette'),
      C.section('Interactions', [
        { name: 'tap_action', selector: { ui_action: {} } }
      ], 'mdi:gesture-tap', true)
    ],
    function () { return { name: '15 min', variant: 'glass' }; });

  register('hk-info-card', HkInfoCard, 'HK Info Block',
    'A large icon with a title and two lines: the house climate, its security, or any entity\'s state.',
    C && [
      { name: 'variant', required: true, label: 'Type',
        helper: 'Climate and Security summarize the house; Entity state shows one entity.',
        selector: C.selOptions([['climate', 'Climate'], ['security', 'Security'], ['state', 'Entity state']]) },
      { type: 'grid', name: '', schema: [
        { name: 'name', label: 'Title', helper: 'Entity state type: leave empty to show the state.', selector: { text: {} } },
        { name: 'icon', selector: { icon: {} } }
      ] },
      C.section('Entity state', [
        { name: 'entity', selector: { entity: {} } },
        { name: 'label', label: 'Line under the title', helper: '', selector: { text: {} } },
        { name: 'icon_states', selector: { object: {} } },
        { name: 'icon_colors', selector: { object: {} } }
      ], 'mdi:information-outline'),
      C.section('Climate and security', [
        { type: 'grid', name: '', schema: [
          { name: 'temperature', selector: { entity: { filter: { domain: 'sensor' } } } },
          { name: 'downstairs', selector: { entity: { filter: { domain: 'climate' } } } },
          { name: 'upstairs', selector: { entity: { filter: { domain: 'climate' } } } },
          { name: 'garage', selector: { entity: { filter: { domain: 'cover' } } } },
          { name: 'cool_below', label: 'Cool Below',
            helper: 'At or below this the temperature shows blue. Default 66 °F (19 °C).',
            selector: { number: { mode: 'box', step: 0.5 } } },
          { name: 'warm_above', label: 'Warm Above',
            helper: 'At or above this the temperature shows red. Default 74 °F (23 °C).',
            selector: { number: { mode: 'box', step: 0.5 } } }
        ] }
      ], 'mdi:home-thermometer'),
      C.section('Interactions', [
        { name: 'tap_action', selector: { ui_action: {} } }
      ], 'mdi:gesture-tap')
    ],
    function (client) { return { variant: 'security', icon: 'mdi:shield-home',
                                 garage: firstOf(client, 'cover') }; });

  // ---------------------------------------------------------------------
  // hk-grid-card -- the grid host, owned here.
  //
  // A drop-in for layout-card. This is a DELIBERATE REPRODUCTION, not
  // an improvement: it copies layout-card's `custom:grid-layout` geometry
  // exactly, including the parts that are arguably wrong, because every
  // measured constant in this frontend -- the 82px rows, the 9/11/17/19px
  // paddings, the section spacing that lands on 31px -- is tuned against
  // those parts. Reproducing them keeps all of it valid and makes the swap
  // mechanical. Changing any of it belongs in a SEPARATE step where each
  // moved number can be seen on its own.
  //
  // THE CONTRACT, read off the running page rather than the minified source
  // (reading the source alone gets the padding wrong):
  //
  //     #root      display:grid
  //                margin  <- layout.margin, default 0px 4px 0px 4px
  //                padding <- layout.padding
  //                every grid-* / place-* property from `layout`
  //     #root > *  margin: 4px 4px 8px
  //     host       display: block
  //
  // THE HOST IS A BLOCK BOX, stated here rather than inherited. layout-card
  // never gave `grid-layout` a display, so it fell to `inline` for an unknown
  // element -- an inline box containing block content, which Safari and Blink
  // measure differently, which makes every section creep down 6px per
  // tap. A host that says `display: block` itself cannot have that bug.
  //
  // `4px 4px 8px` IS NOT A CHOICE. It is layout-card's hardcoded child margin
  // (`var(--masonry-view-card-margin, 4px 4px 8px)`), it cannot be configured
  // away there, and every alignment in this frontend is achieved by matching
  // nesting depth against it. It is reproduced verbatim; do not "clean it
  // up".
  // Full navigation stays available when a menu folds away. A nested music
  // browser owns Back within its library, so it retains that control.
  function pageHeaderMode(choice, nav, internal) {
    if (internal || choice === 'current' || !nav || !nav.available) return 'current';
    if (choice === 'none') return 'none';
    return choice === 'smart' ? (nav.exact ? 'none' : 'context') : 'current';
  }
  var HEADER_EVENTS = ['hk-page-navigation', 'hk-module-ready', window.hkShell.navEvent, 'popstate', 'resize'];
  class HkGridCard extends HkBase {
    _isPageHeader() {
      var c = this._config || {}, kids = c.cards || [];
      return c.page_header === true || (kids.length === 2 && kids[0].type === 'custom:hk-back-card' && kids[1].type === 'custom:hk-heading-card');
    }
    _headerState() {
      var m = menu(), b = m.board ? m.board() : {}, ctx = { available: false, exact: false };
      var nav = m.tabBar && m.tabBar() ? window.hkTabBar : window.hkMenu;
      if (nav && nav.headerContext) ctx = nav.headerContext();
      var path = String(location.pathname || '').split('/')[2] || '';
      return pageHeaderMode(b.page_header || 'current', ctx, path === 'music-browse');
    }
    // THE VIEW THIS HEADER IS ON, by its path (or index), from the hk-grid-view
    // it sits in; null while it is not in one yet
    _viewPath() {
      var node = this;
      while (node) {
        if (node.localName === 'hk-grid-view') {
          var c = node._config || {}, list = (menu().config && menu().config() || {}).views || [];
          return c.path != null ? String(c.path) : String(list.indexOf(c));
        }
        node = node.parentNode || node.host;
      }
      return null;
    }
    _updatePageHeader() {
      if (!this._isPageHeader() || !this._e) return;
      // ONLY ON ITS OWN PAGE. A tap on another page changes the address a few
      // frames before Home Assistant takes this view away; read then, the next
      // page's context (Home: no header) would fold this one and the page would
      // jump up 45 px on its way out (2026-10-16). Kept as it is until it is
      // the page again.
      var own = this._viewPath(), here = String(location.pathname || '').split('/')[2] || '';
      if (!here) { var v0 = ((menu().config && menu().config() || {}).views || [])[0]; here = v0 && v0.path != null ? String(v0.path) : '0'; }
      if (own !== null && own !== here && this.hasAttribute('data-page-header')) return;
      var mode = this._headerState();
      if (this.getAttribute('data-page-header') !== mode) this.setAttribute('data-page-header', mode);
      // HA wraps each view card in hui-card's shadow root. Mark the direct
      // view child too, so the view can retain its responsive top gutter.
      var node = this;
      while (node) {
        var parent = node.parentNode;
        if (parent && parent.id === 'root' && parent.getRootNode().host && parent.getRootNode().host.localName === 'hk-grid-view') {
          node.setAttribute('data-hk-page-header', mode); break;
        }
        node = parent || node.host;
      }
      if (!this._contextLabel) {
        var label = document.createElement('div');
        label.className = 'page-context'; label.setAttribute('role', 'heading'); label.setAttribute('aria-level', '2');
        this._root.appendChild(label); this._contextLabel = label;
      }
      var hd = (this._config.cards || []).filter(function (c) { return c.type === 'custom:hk-heading-card'; })[0];
      var m = menu(), cfg = m.config && m.config(), path = String(location.pathname || '').split('/')[2];
      var v = cfg && cfg.views && cfg.views.filter(function (v, i) { return String(v.path || i) === path; })[0];
      var room = v && (v.area || v.strategy && v.strategy.area);
      var text = (room ? 'Rooms › ' : '') + (hd && hd.name || v && v.title || '');
      if (this._contextLabel.textContent !== text) this._contextLabel.textContent = text;
    }
    _bindHeader() {
      if (!this._isPageHeader() || this._onHeader) return;
      var self = this;
      this._onHeader = function () { self._updatePageHeader(); };
      HEADER_EVENTS.forEach(function (ev) { window.addEventListener(ev, self._onHeader); });
      this._updatePageHeader();
    }
    // A GRID OF POP-UPS ONLY (the generated #alarm / #media holder; the Music
    // page's phone bar) takes no room, so it takes no margins either: the
    // view gives every card 4 px above and 8 px below, and these 12 px after
    // the Music page's last card made a page sized to the window 4 px too tall
    // -- it scrolled (2026-10-15). Its view child says so (data-hk-zero).
    _markZero() {
      var kids = (this._config && this._config.cards) || [];
      var zero = kids.length > 0 && kids.every(function (c) { return c && /^custom:hk-popup(-group)?-card$/.test(c.type); });
      if (!zero) return;
      var node = this;
      while (node) {
        var parent = node.parentNode;
        if (parent && parent.id === 'root' && parent.getRootNode().host && parent.getRootNode().host.localName === 'hk-grid-view') {
          if (!node.hasAttribute('data-hk-zero')) node.setAttribute('data-hk-zero', '');
          return true;
        }
        node = parent || node.host;
      }
      return false;
    }
    connectedCallback() {
      super.connectedCallback(); this._bindHeader();
      var self = this;
      if (this._markZero() === false) requestAnimationFrame(function () { if (self.isConnected) self._markZero(); });
    }
    disconnectedCallback() {
      if (this._onHeader) { var cb = this._onHeader; HEADER_EVENTS.forEach(function (ev) { window.removeEventListener(ev, cb); }); this._onHeader = null; }
      super.disconnectedCallback();
    }

    setConfig(config) {
      var cfg = Object.assign({}, config || {});
      cfg.layout = Object.assign({}, cfg.layout || {});
      cfg.cards = cfg.cards || [];
      this._config = cfg;
      // The editor reuses one element. Remove the previous grid before the
      // base class rebuilds, otherwise every edit appends another style/root
      // pair and leaves the old child cards alive behind the preview.
      this._root.innerHTML = '';
      this._kids = [];
      this._e = null;
      this._contextLabel = null;
      this.removeAttribute('data-page-header');
      super.setConfig(cfg);
      if (this.isConnected) this._bindHeader();
    }
    // The children gate their own renders; this frame has no state.
    _sigOf() { return this._isPageHeader() ? this._headerState() : 'static'; }
    getCardSize() { return 6; }

    // EACH NEW CLIENT (either entry of HkBase): every child gets what goes with it.
    _receiveClient() {
      super._receiveClient();
      var kids = this._kids || [], client = this.client;
      for (var i = 0; i < kids.length; i++) window.hkHostClient.bridge(kids[i], client);
    }

    // Only grid-* and place-* reach the grid, matching layout-card. Anything
    // else in `layout` is handled explicitly above or ignored, and ignoring it
    // is part of the reproduction: `card_margin`, `justify-content` and
    // `align-items` are silently dropped by layout-card too, and several
    // configs in this repository still carry them.
    _applyLayout(root) {
      var L = this._config.layout || {};
      root.style.cssText = '';
      root.style.display = 'grid';
      root.style.margin = L.margin != null ? L.margin : '0px 4px 0px 4px';
      // A grid that bleeds sideways (`margin: … -22px`, the shadow room of
      // the scroll row it wraps) publishes that bleed, and the phone rule in
      // _render clamps it to the gutter -- see hk-row.js for the whole story.
      var b = window.hkCards.bleedSides(L.margin);
      root.classList.toggle('hk-bleed', !!b);
      root.style.setProperty('--hk-bleed-l', b ? b.l + 'px' : '0px');
      root.style.setProperty('--hk-bleed-r', b ? b.r + 'px' : '0px');
      if (L.padding != null) root.style.padding = L.padding;
      root.style.setProperty('--hk-card-margin', L['card-margin'] != null ? L['card-margin'] : 'initial');
      Object.keys(L).forEach(function (k) {
        if (k.indexOf('grid') === 0 || k === 'place-items' || k === 'place-content') {
          root.style.setProperty(k, L[k]);
        }
      });
    }

    _render() {
      if (this._built) { this._updatePageHeader(); return; }
      this._built = true;
      var self = this, cfg = this._config;

      // A STACKED GRID COLLAPSES ITS MARGINS AGAINST ITS NEIGHBOURS.
      //
      // layout-card carries BOTH of these on its own element, and they are the
      // whole reason stacked grids do not accumulate space:
      //
      //     :host(:not(:first-child)) { margin-top: 0 !important }
      //     :host(:not(:last-child))  { margin-bottom: 0 !important }
      //
      // Without them every view with stacked grids -- climate, energy,
      // weather, vacuums, timers -- grows, and grows CUMULATIVELY down the
      // page, while the plain tile pages stay clean: on the climate page most
      // grids are not the first child, and each would keep margin-top 4px
      // where layout-card gives 0.
      //
      // BOTH rules, not the first alone: with only the first, the climate
      // page still comes out ~110px too tall. They sit side by side in
      // layout-card's style block -- take the whole block, not the rule you
      // went looking for.
      //
      // `!important` is not decoration. The parent grid writes
      // `margin: 4px 4px 8px` as an INLINE style on each child, and only an
      // important declaration outranks an inline one -- which is exactly why
      // layout-card wrote them this way.
      // THE CHILD MARGIN IS A RULE, NOT AN INLINE STYLE, and that distinction
      // is the whole contract -- not a detail of how it is written.
      //
      // layout-card sets `#root > * { margin: 4px 4px 8px }` as CSS, so a card
      // that sets its OWN margin inline overrides it. Several do: a chips
      // row is `custom:hk-row-card` with
      // `margin: -14px -22px -26px -22px`, deliberately negative so it bleeds
      // past the column.
      //
      // Writing the same value inline instead INVERTS that relationship: the
      // grid's margin wins, the row's -22px sides are discarded, and it comes
      // out 26px right and 52px narrower, with everything below pushed down
      // 52px. Same numbers, opposite precedence.
      //
      // Reproduce the MECHANISM, not just the value.
      var st = document.createElement('style');
      st.textContent = ':host([data-page-header=none]){display:none!important}' +
                       ':host([data-page-header=context]) #root{display:none!important}' +
                       '.page-context{display:none;font:600 14px/20px -apple-system,system-ui,sans-serif;color:var(--primary-text-color,#fff);padding:4px 4px 9px}' +
                       // Flat's Light: the page's name in its ink, not HA's white
                       ':host([hk-flat]) .page-context{color:var(--hk-ink)}' +
                       ':host([data-page-header=context]) .page-context{display:block}' +
                       ':host(:not(:first-child)){margin-top:0 !important}' +
                       ':host(:not(:last-child)){margin-bottom:0 !important}' +
                       // `card-margin` (HK's own key, 2026-10-16): a grid whose
                       // cards sit the house gap apart exactly (the thermostats)
                       // says 0px and sets its gaps; every other grid keeps
                       // layout-card's 4 / 4 / 8. Set on #root as `initial`
                       // when absent, so a grid inside never inherits a parent's.
                       '#root>*{margin:var(--hk-card-margin,4px 4px 8px)}' +
                       // The sideways bleed may not pass the screen edge -- at
                       // every width (an upright iPad mini's
                       // gutter is 18.9 px); where the gutter is wider the
                       // clamp is the bleed and nothing moves.
                       '#root.hk-bleed{' +
                       '--hk-bleed-lc:min(var(--hk-bleed-l,0px),var(--hk-gutter,calc((100vw - var(--hk-page-left,0px) - var(--hk-page-right,0px)) * var(--hk-side,0.02) + 4px)));' +
                       '--hk-bleed-rc:min(var(--hk-bleed-r,0px),var(--hk-gutter,calc((100vw - var(--hk-page-left,0px) - var(--hk-page-right,0px)) * var(--hk-side,0.02) + 4px)));' +
                       'margin-left:calc(-1 * var(--hk-bleed-lc)) !important;' +
                       'margin-right:calc(-1 * var(--hk-bleed-rc)) !important}';
      this._root.appendChild(st);

      var root = document.createElement('div');
      root.id = 'root';
      this._applyLayout(root);
      this._root.appendChild(root);
      this._e = root;
      this._kids = [];
      this._updatePageHeader();

      if (!window.loadCardHelpers) {
        console.error('[hk-grid] loadCardHelpers is unavailable');
        return;
      }
      window.loadCardHelpers().then(function (helpers) {
        // The editor can replace the config while the helpers promise is in
        // flight; the frame card guards against the same thing.
        if (self._config !== cfg) return;
        cfg.cards.forEach(function (childCfg) {
          var el;
          try {
            el = helpers.createCardElement(childCfg);
          } catch (e) {
            console.error('[hk-grid] could not create', childCfg, e);
            return;
          }
          // No inline margin here: `#root > *` above supplies it, so a card
          // with its own margin still wins.
          //
          // `view_layout` is how a child places itself on the grid -- the same
          // key layout-card uses, so existing placements keep working
          // unchanged. Only grid-* / place-* are honoured, as there.
          var vl = childCfg.view_layout || {};
          Object.keys(vl).forEach(function (k) {
            if (k.indexOf('grid') === 0 || k.indexOf('place') === 0) {
              el.style.setProperty(k, vl[k]);
            }
          });
          root.appendChild(el);
          self._kids.push(el);
          window.hkHostClient.bridge(el, self.client);
        });
      });
    }
  }

  register('hk-grid-card', HkGridCard, 'HK Grid',
    'A CSS grid of cards. Replaces custom:layout-card / custom:grid-layout.',
    C && [
      { name: 'layout', selector: { object: {} } },
      { name: 'cards', label: 'Cards',
        helper: 'The cards in the grid, as a YAML list; each can place itself with view_layout.',
        selector: { object: {} } }
    ],
    function () { return { layout: { 'grid-template-columns': '1fr' }, cards: [] }; });

  // ---------------------------------------------------------------------
  // hk-grid-view -- the VIEW type, owned here.
  //
  // A drop-in for `type: custom:grid-layout`, which is layout-card's view
  // element -- the same `grid-layout` custom element it uses inside a card,
  // wearing its other hat. This replaces that hat.
  //
  // A VIEW IS A DIFFERENT CONTRACT FROM A CARD, and a simpler one: Home
  // Assistant builds the card elements itself and hands them over as
  // `.cards`, already fed by Lovelace. There is no loadCardHelpers dance here.
  // What HA sets, in this order: setConfig(), then the host object, lovelace, narrow,
  // index, cards, badges -- any of which can arrive more than once.
  //
  // THE PLACEMENT COMES FROM THE CONFIG, NOT THE ELEMENTS. `view_layout` is a
  // key on each card's CONFIG (most say `grid-column: '2'` to sit in
  // the 96% centre column), and a built element does not carry it. So the
  // config's cards array is matched to the element array by index, which is
  // the order HA builds them in.
  //
  // Geometry is reproduced exactly as in hk-grid-card: margin from
  // layout.margin, padding from layout.padding, grid-*/place-* forwarded, and
  // `margin: 4px 4px 8px` on every child. The view's own layout is the
  // 2% / 96% / 2% column grid every page is built on.
  class HkGridView extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      if (!this._sr) this._sr = this.attachShadow({ mode: 'open' });
      this._build();
      this._place();
    }
    // HA may set these before or after setConfig; none of them changes layout,
    // and the cards already have what they read. Lovelace's object is taken at
    // the host adapter's entry (below the class): the view keeps it for the
    // getter and does nothing else with it.
    set lovelace(l) { this._lovelace = l; }
    get lovelace() { return this._lovelace; }
    set narrow(n) { this._narrow = n; }
    set index(i) { this._index = i; }
    set cards(c) { this._cards = c || []; this._place(); }
    get cards() { return this._cards || []; }
    set badges(b) { this._badges = b || []; this._place(); }
    get badges() { return this._badges || []; }

    _build() {
      if (this._root) return;
      // Same rule, same reason as hk-grid-card: a card that sets its own
      // margin must still win, which only holds if this is CSS rather than an
      // inline style.
      var st = document.createElement('style');
      // Percentage padding uses this view's width, matching the side columns
      // even with a docked menu or a narrower device. Keep the normal header unchanged.
      // (clipped below, never across: the page's end, _pageEnd)
      // (flow-root: the root's bottom margin -- the page's end -- stays INSIDE
      // the view. `overflow:clip` makes no block formatting context, so a
      // plain block let that margin collapse through the view's foot: the
      // view's box never followed it, a negative one trimmed nothing, and
      // _pageEnd -- reading the view's foot -- added the same difference on
      // every pass. Energy ended 73 px past its last card, 2026-10-18.)
      // (the clip stops at the view's foot -- a gutter below the last plate --
      // and a plate's shadow runs further (30-60 px), which the clip cut off
      // flat just above the tab bar, the user 2026-10-18. See _clipRoom.)
      st.textContent = ':host{display:flow-root;overflow-y:clip}#root>*{margin:4px 4px 8px}' +
        // (a grid of pop-ups alone: no room, no margins -- hk-grid-card _markZero)
        '#root>[data-hk-zero]{margin:0!important}' +
        '#root>[data-hk-page-header=none]{display:none!important}' +
        '#root:has(>[data-hk-page-header=none]),#root:has(>[data-hk-page-header=context]){' +
        'padding-top:calc(100% * var(--hk-side,0.02))!important}';
      this._sr.appendChild(st);
      var root = document.createElement('div');
      root.id = 'root';
      this._sr.appendChild(root);
      this._root = root;
    }

    _applyLayout() {
      var L = (this._config && this._config.layout) || {};
      var root = this._root;
      if (!root) return;
      root.style.cssText = '';
      root.style.display = 'grid';
      root.style.margin = L.margin != null ? L.margin : '0px 4px 0px 4px';
      // (the page's end, kept: the margin above wiped it, and nothing
      // resizes to say so -- a page re-placed by a settings change or a
      // return to it ended a margin off, the user's Climate, 2026-10-17)
      if (this._endM != null) root.style.marginBottom = this._endM + 'px';
      if (L.padding != null) root.style.padding = L.padding;
      Object.keys(L).forEach(function (k) {
        if (k.indexOf('grid') === 0 || k === 'place-items' || k === 'place-content') {
          root.style.setProperty(k, L[k]);
        }
      });
      // ...and looked at again once the cards are placed (a re-place that
      // moves no edge resizes nothing)
      var me = this;
      if (this.isConnected && !this._endRaf) this._endRaf = requestAnimationFrame(function () { me._endRaf = 0; me._pageEnd(); });
    }

    _place() {
      if (!this._root || !this._config) return;
      this._applyLayout();
      var root = this._root;

      // RECONCILE, NEVER EMPTY-AND-REFILL. HA sets `cards` and `badges`
      // separately and repeatedly while a view builds -- measured: five
      // _place() calls for ONE first visit. Emptying the root each time
      // would detach and re-attach every card on the page four times over, and
      // each detach runs the card's disconnectedCallback: camera timers stop
      // and restart, and every chart that has just asked hk-stats for data
      // is released from the fetch that would have woken it -- the Energy
      // page's charts then sit on "Loading" until their sensors next change.
      // A card that is already in the right place is not touched at all.
      //
      // Badges first, as HA's own views do. None of these dashboards uses
      // them, but a view that silently dropped them would be a trap.
      var want = (this._badges || []).concat(this._cards || []);
      var nb = (this._badges || []).length;
      var cfgCards = (this._config.cards || []);
      want.forEach(function (el, i) {
        if (i >= nb) {
          var vl = (cfgCards[i - nb] && cfgCards[i - nb].view_layout) || {};
          Object.keys(vl).forEach(function (k) {
            if (k.indexOf('grid') === 0 || k.indexOf('place') === 0) {
              el.style.setProperty(k, vl[k]);
            }
          });
        }
      });
      want = HkGridView.roomOrder(want, nb, cfgCards);
      want.forEach(function (el, i) {
        var at = root.childNodes[i] || null;
        if (at !== el) root.insertBefore(el, at);
      });
      while (root.childNodes.length > want.length) root.removeChild(root.lastChild);
      this._announce();
    }

    // `hk-view-ready` ON WINDOW: "this view is attached and its cards are in
    // it", once per attachment. It fires for a first build and again when HA
    // re-attaches a cached view, which is every return to a page already seen.
    //
    // The contract exists for hk-sky.js, which must repaint the background in
    // the same frame the new page appears -- not before (the new palette
    // behind the old page) and not after (the old palette behind the new one).
    // Polling the DOM for a swapped hui-view instead would need a ceiling
    // that a slow tablet's first build can outlast.
    //
    // Waits for the cards, not just for connection: HA can attach the view
    // before handing it `cards`, and an empty page is not the page. A view
    // configured with no cards at all announces on attach.
    // THE PAGE'S END (2026-10-17, the user: "the same distance from the
    // bottom as it is on the left edge"; DESIGN.md "Page edges"): every page
    // ends its side gutter below its lowest plate -- the page's edge to its
    // plates (--hk-side of the page and the 8 px of margins) --
    // whatever its cards' nesting adds on the way (layout-card's
    // 8 px a level, a payback's -10). The view owns it: it finds the lowest
    // plate (descending only into the children that reach the bottom, so a
    // whole page is never walked) and moves its root's bottom margin by the
    // difference; the view clips vertically at its own edge, so a margin
    // taken back takes the empty space under the last plate with it -- never
    // a plate or its shadow (the gutter is wider than any shadow). Run when
    // the page's size changes (a ResizeObserver: cards arriving, a resize),
    // never on a timer. The tab bar's room below a page is padding on the
    // view and adds to it as before -- so nothing that runs on under the bar
    // may count: a card that fits itself to the window ends the page its own
    // foot below its box (data-hk-foot, plateEdge; the Music page).
    // THE CLIP REACHES THE ROOM BELOW THE VIEW: what lies under the view is
    // its container's bottom padding -- the tab bar's room, empty by design --
    // so the clipping box is made that much taller (padding-bottom) and takes
    // no layout room for it (the same amount of negative margin-bottom): paint
    // may run on that far (a shadow fades out there instead of stopping flat
    // at the view's foot), and nothing is added to what scrolls, the room
    // being part of the page already. No room, no padding: the clip as it
    // was. (Plain box model, so Safari does it too; overflow-clip-margin is
    // not in it.)
    _clipRoom() {
      var p = this.parentElement, room = 0;
      if (p) room = Math.max(0, Math.floor(parseFloat(getComputedStyle(p).paddingBottom) || 0));
      var pad = room ? room + 'px' : '', mar = room ? -room + 'px' : '';
      if (this.style.paddingBottom !== pad) this.style.paddingBottom = pad;
      if (this.style.marginBottom !== mar) this.style.marginBottom = mar;
    }
    _pageEnd() {
      var root = this._root;
      if (!root || !this.isConnected) return;
      this._clipRoom();
      var hr = this.getBoundingClientRect();
      if (!hr.height || !hr.width) return;
      // (a page still building in -- its contents rising into place by a
      // transform -- is measured once they are in place: when the finite
      // animations running now ON THIS PAGE have finished; a spinning fan
      // never does and is not waited for. Only this page's: the
      // background's slow ones, or a page left behind's, kept a page that
      // came back waiting -- Safari, Climate unmeasured until a reload,
      // the user 2026-10-17.)
      var me = this, anims = document.getAnimations ? document.getAnimations().filter(function (a) {
        var t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
        return a.playState === 'running' && t && isFinite(t.endTime) && me._holds(a.effect.target);
      }) : [];
      if (anims.length) {
        if (this._endWait) return;
        var wait = this._endWait = {};
        Promise.all(anims.map(function (a) { return a.finished.catch(function () {}); }))
          .then(function () {
            if (me._endWait !== wait) return;
            me._endWait = null;
            requestAnimationFrame(function () { me._pageEnd(); });
          });
        return;
      }
      var gutter = HkGridView.gutter(this);
      var low = HkGridView.plateEdge(root, 'bottom', gutter);
      if (low == null) return;
      // The root's own bottom edge to the lowest plate (the root's box, never
      // the view's: whatever margin the root carries now does not enter it,
      // so a pass changes the margin to a fixed value, not by a step -- the
      // old reading of the view's foot added the difference again each time).
      // The margin that puts the page's end a gutter below that plate.
      // (Rounded DOWN to the tenth: a page that fits the window exactly -- the
      // Music page -- rounded to nearest ended 0.05 px past it, which the
      // browser can round up to a pixel of scroll.)
      var slack = root.getBoundingClientRect().bottom - low;
      var m = parseFloat(getComputedStyle(root).marginBottom) || 0, next = Math.floor((gutter - slack) * 10 + 1e-6) / 10;
      if (Math.abs(next - m) < 0.5) return;
      this._endM = next;
      root.style.marginBottom = next + 'px';
    }
    // `el` on this page (through shadow roots)
    _holds(el) {
      for (var i = 0; el && i < 80; i++) { if (el === this) return true; el = el.parentNode || el.host; }
      return false;
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      // a wait begun before the page was taken away is not this visit's
      this._endWait = null;
      if (!this._endRo && typeof ResizeObserver !== 'undefined' && this._root) {
        var me = this;
        this._endRo = new ResizeObserver(function () {
          if (me._endRaf) return;
          me._endRaf = requestAnimationFrame(function () { me._endRaf = 0; me._pageEnd(); });
        });
      }
      if (this._endRo && this._root) this._endRo.observe(this._root);
      // A settings change (the room order) re-places the cards -- in place,
      // as ever: only the room sections that move are moved.
      var self = this;
      if (!this._onReady) {
        this._onReady = function () { self._place(); };
        window.addEventListener('hk-module-ready', this._onReady);
      }
      this._announce();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      if (this._onReady) { window.removeEventListener('hk-module-ready', this._onReady); this._onReady = null; }
      if (this._endRo) this._endRo.disconnect();
      this._announced = false;
    }
    _announce() {
      if (this._announced || !this.isConnected || !this._config) return;
      var wantCards = (this._config.cards || []).length;
      if (wantCards && !(this._cards || []).length) return;
      this._announced = true;
      try {
        window.dispatchEvent(new CustomEvent('hk-view-ready', { detail: { view: this } }));
      } catch (e) {
        console.error('[hk-grid-view] hk-view-ready listener threw', e);
      }
    }
  }

  // the edge of the outermost plate under `node` (an HK card's hk-plate or HA's ha-card, a camera
  // tile) on one side -- 'bottom' its lowest bottom, 'left' its leftmost left
  // -- in viewport px, or null: only the children whose boxes reach within
  // REACH of that side are searched, through shadow roots, so a page is
  // never walked whole
  var REACH = 60, PAGE_EDGE = 8;
  // THE PAGE'S GUTTER: its edge to its plates, as the page lays it out --
  // --hk-side of the view's width, the view's 4 px margin and its column
  // card's 4 (27.2 px at 1,280: DESIGN.md "Page edges"). `el`: the view, or
  // anything on it (a card that fits itself to the window: the calendar)
  HkGridView.gutter = function (el) {
    var v = el;
    for (var i = 0; v && i < 60 && v.localName !== 'hk-grid-view'; i++) v = v.parentNode || v.host;
    if (!v || !v.getBoundingClientRect) return null;
    var side = parseFloat(getComputedStyle(v).getPropertyValue('--hk-side')) || 0.02;
    return PAGE_EDGE + v.getBoundingClientRect().width * side;
  };
  // A PLATE: what draws a surface -- an HK card's hk-plate or HA's ha-card with a background or a
  // shadow (not a heading's or a row's clear one), or any rounded box that
  // does (a vacuum card's, a calendar panel, a TV tile, a camera tile).
  // Never a fixed layer (a sticky bar's strip, a sheet).
  function plateLike(el) {
    var cs = getComputedStyle(el);
    if (cs.position === 'fixed') return false;
    var drawn = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none';
    return drawn && (el.localName === 'hk-plate' || el.localName === 'ha-card' || parseFloat(cs.borderTopLeftRadius) >= 8);
  }
  // A CARD THAT KEEPS ITS OWN FOOT (data-hk-foot, in px; 2026-10-18): a
  // card that fits itself to the window ends the page itself, that far below
  // its own box -- not a gutter below its lowest plate. The Music page's
  // two columns fill the window to a 16 px foot, and with a tab bar along
  // the bottom its frame runs on under the bar (hk-music.js): measured as a
  // plate, the page ended a gutter below the WINDOW's foot, counting the
  // bar's room a second time (it scrolled 114 px, the user 2026-10-18). Its
  // box is searched no further: what runs on under the bar is not the page.
  // With `gutter` (the page's end, _pageEnd) such a card counts as a plate
  // ending (foot - gutter) below its box, so the page ends its foot below it.
  function footOf(el) {
    var f = el.getAttribute ? el.getAttribute('data-hk-foot') : null;
    return f == null || f === '' || isNaN(parseFloat(f)) ? null : parseFloat(f);
  }
  HkGridView.plateEdge = function (node, side, gutter) {
    var best = null, n0 = 0, low = side === 'bottom';
    // (a box inside a scroller counts only as far as the scroller shows it:
    // the calendar's hours run 1,500 px down inside their panel)
    (function look(n, clip) {
      if (++n0 > 4000) return;
      if (n !== node && n.nodeType === 1) {
        var ov = getComputedStyle(n).overflowY;
        if (ov !== 'visible' && ov !== 'clip') clip = Math.min(clip, n.getBoundingClientRect().bottom);
      }
      var kids = Array.prototype.slice.call((n.shadowRoot || n).children || []);
      if (n.shadowRoot && n.children) kids = kids.concat(Array.prototype.slice.call(n.children));
      // (a `display: contents` wrapper has no box: its children stand in
      // for it -- the calendar's)
      for (var i = 0; i < kids.length && i < 400; i++) {
        if (kids[i].nodeType === 1 && getComputedStyle(kids[i]).display === 'contents') {
          Array.prototype.splice.apply(kids, [i, 1].concat(Array.prototype.slice.call(kids[i].children || [])));
          i--;
        }
      }
      var boxes = kids.map(function (k) { return [k, k.getBoundingClientRect ? k.getBoundingClientRect() : null]; })
        .filter(function (x) { return x[1] && x[1].height > 0 && x[1].width > 0 && x[1].top < clip; });
      if (!boxes.length) return;
      var at = function (r) { return low ? Math.min(r.bottom, clip) : -r.left; };
      var max = Math.max.apply(null, boxes.map(function (x) { return at(x[1]); }));
      boxes.forEach(function (x) {
        if (at(x[1]) < max - REACH) return;
        var k = x[0], foot = low ? footOf(k) : null;
        if (foot != null) {
          var e = at(x[1]) + foot - (gutter || 0);
          if (best === null || e > best) best = e;
          return;
        }
        if (k.localName === 'hk-camera-live-card' || plateLike(k)) {
          if (best === null || at(x[1]) > best) best = at(x[1]);
          return;
        }
        if (k.localName === 'style' || k.localName === 'script') return;
        look(k, clip);
      });
    })(node, Infinity);
    return best === null ? null : low ? best : -best;
  };

  // ROOMS ON HOME IN THE ROOM ORDER (the dashboard item's "Rooms on Home":
  // in room order). A ROOM SECTION is a card whose first card is
  // a heading naming an area -- how the generated Home and a hand-built
  // one write a room. Only those
  // swap places, among the slots they already hold, by where their area
  // falls in the Room order; an area not in it keeps its place after the
  // ones that are. Everything else on the page stays exactly where it is.
  // "As the dashboard lists them" (the default) changes nothing.
  HkGridView.sectionArea = function (cfg) {
    var first = cfg && Array.isArray(cfg.cards) ? cfg.cards[0] : null;
    if (!first || first.type !== 'custom:hk-heading-card' || !first.area) return null;
    return [].concat(first.area)[0] || null;
  };
  HkGridView.roomOrder = function (want, nb, cfgCards) {
    var M = window.hkCards && window.hkCards.menu;
    var b = M && typeof M.board === 'function' ? M.board() : null;
    var how = b && b.home_rooms;
    var order = (how === 'order' || how === 'only') && Array.isArray(b.room_order) ? b.room_order : [];
    if (!order.length) return want;
    // "Only the rooms in the room order" (1.7): the others leave Home; their
    // pages stay.
    var only = how === 'only';
    var rank = {};
    order.forEach(function (a, i) { if (!(a in rank)) rank[a] = i; });
    var slots = [], rooms = [];
    want.forEach(function (el, i) {
      if (i < nb) return;
      var area = HkGridView.sectionArea(cfgCards[i - nb]);
      if (area === null) return;
      slots.push(i);
      rooms.push({ el: el, r: area in rank ? rank[area] : order.length, i: i });
    });
    if (rooms.length < 2 && !only) return want;
    rooms.sort(function (x, y) { return x.r - y.r || x.i - y.i; });
    var out = want.slice(), gone = [];
    slots.forEach(function (at, k) {
      if (only && rooms[k].r === order.length) { gone.push(at); out[at] = null; }
      else out[at] = rooms[k].el;
    });
    return gone.length ? out.filter(function (el) { return el !== null; }) : out;
  };

  window.hkHostClient.entry(HkGridView);
  if (!customElements.get('hk-grid-view')) {
    customElements.define('hk-grid-view', HkGridView);
  }

  window.hkLayout = { version: '1.0.0', pageHeaderMode: pageHeaderMode,
                      gutter: function (el) { return HkGridView.gutter(el); } };
  });
})();
