// hk-layout-grid.js - the grid card, the grid view and the conditional card.
//
// PART OF THE LAYOUT CARDS (hk-layout.js). Not a card and not run on its own: it registers one
// function, which hk-layout.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkLayoutParts = window.hkLayoutParts || {})['hk-layout-grid'] = function (K) {
    var C = K.C, HkBase = K.HkBase, menu = K.menu, SAFE_PAD_L = K.SAFE_PAD_L, SAFE_PAD_R = K.SAFE_PAD_R,
        SAFE_PADS = K.SAFE_PADS;

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
                         '--hk-bleed-lc:min(var(--hk-bleed-l,0px),var(--hk-gutter,calc((100vw - var(--hk-page-left,0px) - var(--hk-page-right,0px) - ' + SAFE_PADS +
                           ') * var(--hk-side,0.02) + 4px)));' +
                         '--hk-bleed-rc:min(var(--hk-bleed-r,0px),var(--hk-gutter,calc((100vw - var(--hk-page-left,0px) - var(--hk-page-right,0px) - ' + SAFE_PADS +
                           ') * var(--hk-side,0.02) + 4px)));' +
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
        // CLEAR OF A SIDE SAFE AREA (2026-10-30): the iPhone Duo's strip of
        // system controls, a phone turned with its Dynamic Island at the side.
        // The view pads itself by it -- its background, and the sky behind it,
        // still run under -- less what a docked menu or a pane already clears
        // (hk-base.js SAFE.padL / padR). 0 in a browser on a computer.
        st.textContent = ':host{display:flow-root;overflow-y:clip;box-sizing:border-box;padding-left:' + SAFE_PAD_L + ';padding-right:' + SAFE_PAD_R + '}' +
          '#root>*{margin:4px 4px 8px}' +
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
        // (kept beside the page shown, for a swipe: it says so when it is shown -- hk-view-host.js hold)
        if (this._announced || !this.isConnected || !this._config || this.hasAttribute('data-hk-offstage')) return;
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

    // A BLOCK WITH RULES (2026-10-24; hk-grid-catalog.js rulesOf): its own card
    // by default, and the card of the first rule whose conditions all hold --
    // music playing, a time window and the alarm still armed, a doorbell ...
    // It owns ONE mounted child; switching never changes its cell. A rule with
    // a time or solar window looks again at its next edge (hk-grid-catalog.js
    // armClock); a doorbell ring counts for a minute. `force` (the editor's
    // Preview): -1 the default, else a rule.
    var cfgIds = new WeakMap(), cfgCount = 0;
    // A BLOCK'S TILE STYLE (2026-10-30): Centred, set on the block's card by
    // the grid, handed on to the card it holds (as `size` is)
    function passTile(from, to) {
      if (!to || !to.setAttribute) return;
      if (from.getAttribute('tile') === 'centred') to.setAttribute('tile', 'centred'); else to.removeAttribute('tile');
    }
    function cfgId(c) {
      if (!c || typeof c !== 'object') return 'x';
      var n = cfgIds.get(c);
      if (!n) cfgIds.set(c, n = ++cfgCount);
      return n;
    }
    class HkGridConditionalCard extends HkBase {
      static get CSS() { return ':host{display:block;height:100%}.variant,.variant>*{display:block;height:100%;width:100%}'; }
      static get observedAttributes() { return ['size', 'tile']; }
      attributeChangedCallback() { if (this._child) { this._child.setAttribute('size', this.getAttribute('size')); passTile(this, this._child); } }
      _rules() { return window.hkGridCatalog.rulesOf((this._config || {}).item); }
      _shown() {
        var cfg = this._config || {}, G = window.hkGridCatalog;
        if (typeof cfg.force === 'number') return cfg.force;
        if (typeof cfg.force === 'boolean') return cfg.force ? 0 : -1;        // (an older preview's)
        // (the house's music speakers, for Music Is Playing with none chosen)
        var sp = ((cfg.ctx || {}).speakers || []).map(function (s) { return s && s.entity; }).filter(Boolean);
        return G.choose(cfg.item, this.client && this.client.states, this._ringing || false,
          window.hkSettings && window.hkSettings.get('security.alarm', null), undefined, sp);
      }
      // A CHEAP SIGNATURE (2026-10-29): the rule shown and WHICH config this is. It was JSON.stringify of the whole block
      // (its rules, the context) on every push of the house, to compare with the last; a config is set whole and never
      // changed in place (the catalog makes a new one each time), so the object's identity says it, and _render still
      // compares the choice and the saved block before it builds anything.
      _sigOf() { return this._shown() + '|' + cfgId(this._config); }
      _receiveClient() {
        super._receiveClient();
        if (this._child) window.hkHostClient.bridge(this._child, this.client);
      }
      _render() {
        var cfg = this._config, shown = this._shown(), r = this._rules(), item = cfg.item;
        // the same card while neither the choice nor the saved block changed
        var key = JSON.stringify([shown, item, cfg.ctx]);
        // (a new config -- the editor's -- may have new edges)
        if (this._armedFor !== cfg) { this._armedFor = cfg; this._lastShown = shown; this._arm(); }
        if (this._child && this._childKey === key) return;
        this._childKey = key;
        var chosen = shown >= 0 && r.rules[shown] ? Object.assign({ size: item.size }, r.rules[shown]) : Object.assign({}, r.base);
        delete chosen.when;
        var child = C.createCard(window.hkGridCatalog.config(chosen, cfg.ctx), this.client);
        child.setAttribute('size', this.getAttribute('size') || item.size);
        passTile(this, child);
        if (this.hasAttribute('data-grid-pager')) child.setAttribute('data-grid-pager', '');
        var box = document.createElement('div'); box.className = 'variant'; box.appendChild(child);
        this._root.replaceChildren(box); this._child = child;
      }
      // every condition of every rule, flat
      _conds() {
        var out = [];
        this._rules().rules.forEach(function (r) { var w = r.when || {}; (Array.isArray(w.all) ? w.all : [w]).forEach(function (c) { out.push(c); }); });
        return out;
      }
      connectedCallback() {
        super.connectedCallback();
        if (!this._onRing) this._onRing = (e) => {
          var event = e && e.detail;
          if (!event || event.type !== 'notification' || event.kind !== 'doorbell') return;
          if (!this._conds().some(function (c) { return c.kind === 'doorbell'; })) return;
          this._ringing = event.camera || true; this.redraw(); clearTimeout(this._ringTimer);
          this._ringTimer = setTimeout(() => { this._ringing = false; this.redraw(); }, 60000);
        };
        window.addEventListener('hk-house-event', this._onRing);
        this._lastShown = this._config ? this._shown() : null;
        this._arm();
      }
      _arm() { var G = window.hkGridCatalog; if (G && G.armClock) G.armClock(this); }
      disconnectedCallback() {
        window.removeEventListener('hk-house-event', this._onRing); clearTimeout(this._ringTimer); clearTimeout(this._tick); this._tick = null;
        this._ringing = false; super.disconnectedCallback();
      }
    }

    // ---------------------------------------------------- hk-home-grid-view
    //
    // A HOME GRID SCREEN'S HOME (docs/phase11/HOME-GRID.md): its blocks on a
    // grid of `cols` x `rows` fixed tall-tile cells, uniformly scaled to fit
    // the tablet, centered with spare room around it -- under the
    // optional top band (the screen's header, C.HOME_GRID.band px). It NEVER
    // SCROLLS: the view is the screen's height and clips; a card that can't
    // fit its cell clips its own contents (each cell clips too), and never
    // grows the page. The stored frame (1280 x 800) is the desktop editor's,
    // not this view's.
    //
    // The strategy (hk-strategy.js homeGridView) hands it:
    //   grid: { cols, rows, band, scale }
    //   cards: the band's card first when band is on (hk_band: true), then one
    //     per block with hk_cell: { id, size, at: [column, row] }, then any
    //     card that only listens (a pop-up, the docked bar), which takes no room
    // Matched to the built elements by index, as hk-grid-view does. Each block
    // sits in its own cell, which carries `size` (S, W, T, L, XL) and is a
    // size container (`hk-cell`); the grid sets `--hk-cell-w` / `--hk-cell-h`,
    // one cell's width and height. A card's own layout per class reads them
    // (G2). The card gets the same `size` attribute.
    var GRID = C.HOME_GRID || { sizes: {}, gap: 10, band: 60 };
    // A CELL'S SHAPE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md "The numbers"):
    // its height, the gap and the canvas's edge. Tiles: 150, 10, the page's
    // gutter. Square cells: 196 and HomeView's 13; on a Square screen the edge
    // is 14 (C.HOME_GRID.square), about a gap from the glass.
    function cellShape(g) {
      var sq = GRID.square || { h: 196, gap: 13, edge: 14 };
      if (g.cell !== 'square') return { h: C.TILE.tall, gap: GRID.gap, pad: GRID.pad };
      return { h: sq.h, gap: sq.gap, pad: g.screen === 'square' ? sq.edge : GRID.pad };
    }
    // ...and a block's corners on square cells: HomeView's one radius
    // (C.R.square), and on a Square screen the outer corner of a block at the
    // screen's corner concentric with the display's (C.R['square-screen']).
    // One value, or four (top-left, top-right, bottom-right, bottom-left).
    function cellRadius(g, at, span) {
      if (g.cell !== 'square') return '';
      var r = (C.R && C.R.square || 34) + 'px', o = (C.R && C.R['square-screen'] || 72) + 'px';
      if (g.screen !== 'square') return r;
      var l = at[0] === 0, rt = at[0] + span[0] === g.cols, t = at[1] === 0, b = at[1] + span[1] === g.rows;
      if (!((l || rt) && (t || b))) return r;
      return [l && t ? o : r, rt && t ? o : r, rt && b ? o : r, l && b ? o : r].join(' ');
    }
    // ...and the room a block's words keep from such an outer corner: the
    // corner's circle comes 0.29 of its radius in along the diagonal, so a line
    // at the tile's own padding (12.8, cleared by the 34 corner) is cut by the
    // 72 one -- the owner's "ff" for "Off" and "ood Morning", 2026-10-30. The
    // two sides that meet at an outer corner give (72 - 34) x 0.29, rounded
    // up, more; read by each block's padding as --hk-in-t / -r / -b / -l.
    function cellInset(g, at, span) {
      if (g.cell !== 'square' || g.screen !== 'square') return null;
      var r = (C.R && C.R.square || 34), o = (C.R && C.R['square-screen'] || 72), e = Math.ceil((o - r) * (1 - Math.SQRT1_2)) + 1;
      var l = at[0] === 0, rt = at[0] + span[0] === g.cols, t = at[1] === 0, b = at[1] + span[1] === g.rows;
      if (!((l || rt) && (t || b))) return null;
      return { t: t ? e : 0, r: rt ? e : 0, b: b ? e : 0, l: l ? e : 0 };
    }
    // A NIGHT (the grid's `night`): "always", or now between from and to (across midnight)
    function gridNightNow(n, d) {
      if (!n || n.mode === 'off') return false;
      if (n.mode === 'always') return true;
      var mins = function (t) { var p = String(t || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); };
      var m = d.getHours() * 60 + d.getMinutes(), a = mins(n.from || '22:00'), b = mins(n.to || '07:00');
      return a <= b ? m >= a && m < b : m >= a || m < b;
    }
    // ...and the night itself, the screensaver clock's: what is behind the
    // grid hidden (the page black), and one dim red over everything on the
    // screen -- the blocks, the tab bar, a sheet -- by multiply, so white is
    // the red and black stays black. It takes no touches.
    function gridNight(on) {
      // (nothing to do where there is no page: a test's DOM)
      if (typeof document.getElementById !== 'function' || !document.documentElement || !document.body) return;
      var de = document.documentElement, wash = document.getElementById('hk-night-wash');
      if (on === de.hasAttribute('hk-night') && (!on || wash)) return;
      if (!document.getElementById('hk-night-css')) {
        var st = document.createElement('style');
        st.id = 'hk-night-css';
        // (--hk-night-on-red: what a card draws on its own red -- today's circle -- turns black, which the wash keeps)
        st.textContent = 'html[hk-night] #hk-sky{visibility:hidden!important}html[hk-night],html[hk-night] body{background:#000!important}' +
          'html[hk-night]{--hk-night-on-red:#000}' +
          '#hk-night-wash{position:fixed;inset:0;z-index:2147483000;pointer-events:none;background:#b3261e;mix-blend-mode:multiply}';
        (document.head || de).appendChild(st);
      }
      if (on) {
        de.setAttribute('hk-night', '');
        if (!wash) { wash = document.createElement('div'); wash.id = 'hk-night-wash'; wash.setAttribute('aria-hidden', 'true'); document.body.appendChild(wash); }
      } else {
        de.removeAttribute('hk-night');
        if (wash) wash.remove();
      }
    }

    // what the shell and the later parts use of this one
    K.cellInset = cellInset; K.cellRadius = cellRadius; K.cellShape = cellShape; K.footOf = footOf; K.GRID = GRID;
    K.gridNight = gridNight; K.gridNightNow = gridNightNow; K.HkGridCard = HkGridCard;
    K.HkGridConditionalCard = HkGridConditionalCard; K.HkGridView = HkGridView; K.PAGE_EDGE = PAGE_EDGE;
    K.pageHeaderMode = pageHeaderMode; K.passTile = passTile; K.plateLike = plateLike; K.REACH = REACH;
  };
})();
