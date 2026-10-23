// hk-row.js -- a horizontally scrolling row, as a native Lovelace card.
//
// Takes the place of custom:swipe-card (Swiper, 187,770 bytes) for the
// scrolling rows on the dashboards, with none of the workarounds swipe-card
// needs.
//
// WHY THIS IS A FAIR TRADE, AND NOT A REWRITE OF SWIPER
// A scrolling row here is Swiper with `freeMode: {enabled: true}`, which turns
// its snapping and paging OFF, and no pagination, arrows, loop, autoplay,
// effects or snapping. Used that way the library is a horizontally
// scrolling div, which is what `overflow-x:auto` already is.
// Feature-for-feature:
//
//   slidesPerView: auto   -> flex children at their own width      same
//   spaceBetween: N       -> gap: Npx                              same
//   freeMode.enabled      -> native momentum scrolling             same
//   watchOverflow         -> no overflow, no scroll                same
//   grabCursor            -> cursor:grab + _wireMouseDrag()        same
//   observer, observeParents, observeSlideChildren, resizeObserver
//                         -> nothing to re-measure                 need gone
//
// FINGER SCROLLING IS THE BROWSER'S, NOT SWIPER'S. Touch drag, flick momentum,
// deceleration and end-of-list overscroll all come free here
// and run on the
// COMPOSITOR, not in JS -- which is the point on a 4 GB tablet where the main
// thread is the scarce resource. Trackpad two-finger scroll, shift+wheel and
// the scrollbar all work for the same reason.
//
// MOUSE CLICK-DRAG is the one thing the browser has never done natively, and
// it is the only behaviour of Swiper's that had to be written by hand --
// _wireMouseDrag() below. It is GATED ON
// `pointerType === 'mouse'`: a wall tablet never produces a mouse pointer, so
// on a touchscreen every line of it is unreachable, not merely unused.
//
// TWO PROPERTIES THAT LOOK COSMETIC AND ARE NOT
//   overscroll-behavior-x: contain  -- without it, flicking past the end of
//     the camera strip triggers the browser's horizontal swipe-navigation
//     gesture and leaves the dashboard. `none` would also remove the
//     end-of-row bounce; see the long note on the property itself for why it
//     is `contain`.
//   scrollbar hiding -- Android draws an overlay scrollbar under the pills
//     otherwise. Both the standard property and the -webkit- pseudo are needed.
//
// THE VERTICAL CLIP CANNOT GO AWAY.
// A scroll container clips on every edge (overflow-y is set to hidden with
// overflow-x auto), so this clips outer box-shadows exactly as Swiper does -- that
// is not swipe-card's fault. The difference is that the clip is on an element
// this card owns, so `pad_top` / `pad_bottom` open room for a shadow INSIDE it.
// Padding is inside the padding box and overflow clips at the padding box edge,
// so a shadow that fits in the padding survives.
//
// Those default to 0, and a row's children keep their own shadow margin, so
// a row opens room for a shadow only where its config asks for it.
(function () {
  'use strict';

  if (window.hkRow) return;
  window.hkRow = { version: '1.3.0' };

  var CSS = [
    ':host{display:block;position:relative}',
    // The scroller. `gap` rather than per-child margins so the last child has
    // no trailing space -- Swiper's spaceBetween behaved the same way.
    '.row{display:flex;flex-direction:row;align-items:flex-start;',
    '  overflow-x:auto;overflow-y:hidden;',
    // `contain`, ON BOTH ENGINES. The simplest answer, and the right one once
    // the alternatives below are weighed.
    //
    // THE TWO ENGINES' OVERSCROLL ARE NOT THE SAME EFFECT.
    //
    //   iOS / WebKit (a phone): overscroll TRANSLATES. The row slides
    //     past its edge and springs back with nothing deformed -- measured off
    //     a screen recording of the Home app: the camera strip's
    //     left edge runs 48 -> 383 px and returns to exactly 48 over ~1.2s.
    //   ANDROID (wall tablets, Chrome WebView): overscroll DEFORMS.
    //     Android 12+ stretches the content itself, so the pills smear and
    //     squash at the end of the row.
    //
    // `none` kills both. An @supports block giving WebKit `contain` and
    // leaving Blink at `none` makes a phone bounce and a tablet hard-stop.
    // THERE IS NO CSS THAT GIVES BLINK THE TRANSLATE:
    // stretch is the platform's overscroll and `overscroll-behavior` only
    // chooses between having it and not -- and the stretch beats nothing.
    // So both get `contain`, with no engine sniffing.
    //
    // `contain` STILL STOPS SCROLL CHAINING, which is the safety property the
    // original value existed for: without it a flick past the end of the
    // camera strip triggers the browser's horizontal back gesture and leaves
    // the dashboard. NEVER set this to `auto`.
    //
    // X ONLY, deliberately. The row is `overflow-y:hidden`, so it never scrolls
    // vertically and vertical gestures must still chain to the PAGE -- that is
    // how you scroll the dashboard with a finger resting on the camera strip.
    // Setting the shorthand `overscroll-behavior:none` would block that.
    '  overscroll-behavior-x:contain;',
    '  -webkit-overflow-scrolling:touch;',
    '  scrollbar-width:none;-ms-overflow-style:none;cursor:grab}',
    '.row::-webkit-scrollbar{display:none;width:0;height:0}',
    // A flex item shrinks to fit by default, which would squeeze fixed-width
    // tiles as soon as the row overflows -- the exact opposite of scrolling.
    // `--hk-cell-bleed: 0` is the other half of the phone rule in the tile
    // cards. Below 640px a tile sizes itself `calc(100% + var(--hk-cell-bleed,
    // 8px))`, where the 8px replaces the side margins layout-card gives a GRID
    // child. A row child has no such margin -- it is sized directly by
    // `card_width` -- so without this it would render 8px too wide and be
    // clipped by the scroller. These rows scroll, so their tiles keep their
    // full width on a phone rather than shrinking; only the grids reflow.
    '.row > *{flex:0 0 auto;--hk-cell-bleed:0px}',
    // THE LEAD: one card PINNED at the start of the row, outside
    // the scroller -- the menu chip at the head of the status chips. The
    // SCROLLER STARTS WHERE THE LEAD ENDS (margin-left), with the gap as its
    // padding, so at rest the first chip sits exactly where it would beside
    // it and, scrolled, the chips are clipped at the lead's edge, as a row
    // clips on iOS. NOT A MASK (chips fading out behind the lead): a mask
    // makes the row a backdrop root, and the shared blur layer inside it
    // (hk-glass.js) then has nothing behind it to blur: every chip's frost
    // vanishes the moment the row moves. A
    // lead that draws nothing (the menu is off, or its style is the edge tab)
    // measures 0 wide and the row is byte-for-byte a row without one.
    // top: the row's padding, then centred on the first card's own box
    // (--hk-lead-dy, measured): a status chip carries a 5 px top margin of
    // its own, so the padding alone would leave the menu chip 5 px high.
    '.lead{position:absolute;z-index:1;top:calc(var(--hk-row-pt,0px) + var(--hk-lead-dy,0px));',
    '  left:var(--hk-row-pl,0px);display:flex}',
    '.row.has-lead{margin-left:calc(var(--hk-row-pl,0px) + var(--hk-lead-w,0px)) !important;',
    '  padding-left:var(--hk-lead-gap,0px) !important}',
    // NO `touch-action` ON THE ROW, AT ANY WIDTH. It once carried `pan-x` on a
    // phone, read as "this row pans sideways, vertical goes to the page". That
    // is not what it means: touch-action is INTERSECTED down the chain from the
    // finger to the scroller that would move, so `pan-x` on the row forbids a
    // vertical pan of the PAGE for any touch that lands on it -- a swipe up
    // that started on the chips, the scenes or the camera strip moved the
    // page 0 px (row_scroll.py, 2026-10-04). Left at `auto`, the browser locks
    // each drag to its main axis and hands a vertical one to the page, as the
    // wall tablets always did. The page sliding sideways that `pan-x` was for
    // is held by `overflow-x: clip` on the document (hk-responsive.css).
    //
    // NOR IS IT NEEDED AGAINST FALSE TAPS: every action fires from `click`,
    // and a browser that takes a drag for scrolling sends pointercancel and
    // never makes the click.
    // A ROW MAY BLEED INTO THE GUTTER, NEVER PAST THE SCREEN -- AT EVERY
    // WIDTH, not only on a phone: an iPad mini held upright (744 px, an
    // 18.9 px gutter) would scroll sideways by the 3 px the chips' 22 px
    // bleed passes it. Where the gutter is wider than the
    // bleed -- a 1280 px tablet, any desktop -- the clamp is the bleed,
    // so nothing there moves.
    // A row pulls itself out sideways by its shadow reach (`margin: … -22px`,
    // on itself or on the grid wrapping it) and pays it back inside the clip
    // (`pad_left: 22`), so the leading pill's shadow is not sliced off. On
    // a 1280px tablet the gutter is 29.6px (2% + the 4px grid-child
    // margin) and the 22px vanish into it. A 402px phone has 12px, and the
    // extra 10px would make every page with a chip or scene row scroll
    // sideways by exactly that much. So the bleed is clamped to the gutter
    // and the SAME amount comes off the padding, which keeps the pills on
    // the column. The wrapper (hk-grid-card) publishes its bleed as
    // --hk-bleed-l/-r and the clamped value as --hk-bleed-lc/-rc; a row that
    // bleeds on its own host does the same for itself (.hk-bleed). Either
    // way the padding below reads them by inheritance.
    // THE GUTTER IS THE PAGE'S, not the window's: --hk-side (2 %, 1.5 % from
    // 641 px up: css/hk-responsive.css) of the
    // width RIGHT OF the docked menu and Home Assistant's sidebar
    // (--hk-page-left, published by hk-menu.js), plus the 4 px grid-child
    // margin. 2vw is the window's, and with the menu docked at 1,010 px the
    // chips would bleed 4 px past the screen edge and the page scroll sideways.
    '  :host(.hk-bleed){',
    '    --hk-bleed-lc:min(var(--hk-bleed-l,0px),var(--hk-gutter,calc((100vw - var(--hk-page-left,0px) - var(--hk-page-right,0px)) * var(--hk-side,0.02) + 4px)));',
    '    --hk-bleed-rc:min(var(--hk-bleed-r,0px),var(--hk-gutter,calc((100vw - var(--hk-page-left,0px) - var(--hk-page-right,0px)) * var(--hk-side,0.02) + 4px)));',
    '    margin-left:calc(-1 * var(--hk-bleed-lc)) !important;',
    '    margin-right:calc(-1 * var(--hk-bleed-rc)) !important}',
    '  .row{',
    '    padding-left:calc(var(--hk-row-pl,0px) - var(--hk-bleed-l,0px) + var(--hk-bleed-lc,var(--hk-bleed-l,0px))) !important;',
    '    padding-right:calc(var(--hk-row-pr,0px) - var(--hk-bleed-r,0px) + var(--hk-bleed-rc,var(--hk-bleed-r,0px))) !important}',
    // the lead follows the same clamp as the padding it sits over
    '  .lead{left:calc(var(--hk-row-pl,0px) - var(--hk-bleed-l,0px) + var(--hk-bleed-lc,var(--hk-bleed-l,0px)))}',
    '  .row.has-lead{',
    '    margin-left:calc(var(--hk-row-pl,0px) - var(--hk-bleed-l,0px) + var(--hk-bleed-lc,var(--hk-bleed-l,0px)) + var(--hk-lead-w,0px)) !important;',
    '    padding-left:var(--hk-lead-gap,0px) !important}',
    // PHONE: match the grids. A scroll row has no track, so a child cannot
    // inherit --hk-track. `phone_card_width` lets a row state its children's
    // width below 640px as a share of the ROW -- the same content box the
    // grids measure against -- so `calc((100% - 12px) / 2)` lands on exactly
    // the 2-up track the tiles use. Opt-in per row: the chips are fit-content
    // and the cameras are 360px, and neither should be resized.
    '@media (max-width: 640px){',
    // not the shared glass layer (hk-glass.js), which sizes itself to its band
    '  .row.phone-sized > :not([data-hk-glass-layer]){width:var(--hk-row-phone-w) !important;',
    '    min-width:0 !important;max-width:none !important}',
    // `phone_gap` is the other half of matching a grid, and without it the
    // width alone cannot do it. A GRID's visible gap is not its `grid-gap`:
    // layout-card adds 4px of side margin to every grid child, so two
    // neighbouring tiles sit `gap + 8` apart. A row child has no such margin,
    // so a row reproducing a 12px grid needs a 20px gap to put its second
    // child on the same column. Measured: without it the Scenes row lands
    // its second pill at x=256 against the favourites' x=260.
    //
    // `!important` for the same reason the width rule has it -- `gap` is set
    // as an INLINE style from `cfg.gap`, which a stylesheet rule cannot beat.
    //
    // SEPARATE CLASS FROM phone-sized, deliberately: a row that sets only
    // `phone_card_width` keeps the gap it always had. Opt-in twice over, and
    // both live inside this media query, so no wall tablet can see either.
    '  .row.phone-gapped{gap:var(--hk-row-phone-gap) !important}',
    '}',
    '@media (prefers-reduced-motion: reduce){.row{scroll-behavior:auto}}'
  ].join('');

  // A spacer also works when a quiet/conditional first chip is hidden.
  // Cancel its extra flex gap so an exactly fitting row stays unscrolled.
  CSS += '.row.align-end::before{content:"";flex:0 0 0;margin-left:auto;margin-right:calc(-1 * var(--hk-row-align-gap,0px))}';

  var SHEET = null;
  if (typeof CSSStyleSheet === 'function' && CSSStyleSheet.prototype.replaceSync) {
    try { SHEET = new CSSStyleSheet(); SHEET.replaceSync(CSS); } catch (e) { SHEET = null; }
  }

  class HkRowCard extends HTMLElement {
    constructor() {
      super();
      this._root = this.attachShadow({ mode: 'open' });
      if (SHEET) this._root.adoptedStyleSheets = [SHEET];
      else { var s = document.createElement('style'); s.textContent = CSS; this._root.appendChild(s); }
      this._children = [];
      this._built = false;
    }

    setConfig(config) {
      if (!config || !Array.isArray(config.cards)) {
        throw new Error('hk-row: `cards` must be a list of cards');
      }
      this._config = config;
      // A config change replaces the children wholesale. Cheap: this card is a
      // container, so it re-renders only when the DASHBOARD config changes, not
      // on state.
      this._built = false;
      this._children = [];
      // The drag wiring holds DOCUMENT-level listeners, so it has to come off
      // with the row it was wired to or a re-config stacks a second copy.
      if (this._dragOff) { this._dragOff(); this._dragOff = null; }
      if (this._leadOff) { this._leadOff(); this._leadOff = null; }
      this._root.querySelectorAll('.row,.lead').forEach(function (n) { n.remove(); });
      this._build();
    }

    // HA MOVES CARDS AROUND IN THE DOM, so disconnect is NOT "this card is
    // finished" -- it is routinely followed by a reconnect a frame later.
    // Drag wiring hung off _build() alone and torn down on disconnect is
    // gone by the time the view has finished mounting, and the row does not
    // drag at all (_dragOff === null on a live row). Wiring belongs on
    // connect, and it has to be idempotent because connect can fire more
    // than once.
    connectedCallback() {
      // on someone else's dashboard: the row, not the cards in it, carries
      // the light look (hk-base.js place / tone)
      if (window.hkCards && window.hkCards.place) window.hkCards.place(this);
      if (window.hkCards && window.hkCards.tone) window.hkCards.tone(this, this.client);
      if (window.hkCards && window.hkCards.flatSurface) {
        window.hkCards.flatSurface(this, 'row');
        if (!this._flatStyle) { this._flatStyle = document.createElement('style'); this._flatStyle.textContent = window.hkCards.flatCss(); this._root.appendChild(this._flatStyle); }
      }
      this._wireDrag();
    }

    // A card removed from the DOM must not leave listeners on document.
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      if (this._dragOff) { this._dragOff(); this._dragOff = null; }
    }

    _wireDrag() {
      if (this._dragOff) { return; }                 // already wired
      var row = this._root.querySelector('.row');
      if (row) { this._wireMouseDrag(row); }
    }

    _build() {
      if (this._built || !this._config) return;
      var cfg = this._config;
      var row = document.createElement('div');
      row.className = 'row';
      if (cfg.align === 'end') {
        row.classList.add('align-end');
        row.style.setProperty('--hk-row-align-gap', cfg.gap == null ? '0px' : typeof cfg.gap === 'number' ? cfg.gap + 'px' : cfg.gap);
      }
      if (cfg.gap != null) row.style.gap = (typeof cfg.gap === 'number' ? cfg.gap + 'px' : cfg.gap);
      // ALL FOUR SIDES CLIP, not just top and bottom. `overflow-x:auto` forces
      // overflow-y to `auto` as well, so the scroller clips on every edge --
      // and the FIRST child sits flush against the left content edge, so a
      // shadow's sideways reach is cut there exactly as its vertical reach is
      // cut above and below: a hard vertical line down the left of the
      // leading pill.
      //
      // Horizontal reach is `blur -/+ offset-x`; every shadow here has
      // offset-x 0, so it is simply `blur` on both sides -- 22px for hk_pill's
      // `0 8px 22px`.
      if (cfg.phone_card_width) {
        row.classList.add('phone-sized');
        row.style.setProperty('--hk-row-phone-w', cfg.phone_card_width);
      }
      // Below 640px only -- see the .phone-gapped note in CSS above.
      if (cfg.phone_gap) {
        row.classList.add('phone-gapped');
        row.style.setProperty('--hk-row-phone-gap',
          typeof cfg.phone_gap === 'number' ? cfg.phone_gap + 'px' : cfg.phone_gap);
      }
      var px = { paddingTop: cfg.pad_top, paddingBottom: cfg.pad_bottom,
                 paddingLeft: cfg.pad_left, paddingRight: cfg.pad_right };
      for (var k in px) {
        if (px[k] != null) row.style[k] = (typeof px[k] === 'number' ? px[k] + 'px' : px[k]);
      }
      // `margin` is on the HOST, and it exists to PAY BACK the padding above.
      // pad_top/pad_bottom open room inside the clip for a child's shadow, which
      // makes this card taller than the row it replaced; a negative margin here
      // hands that height back so nothing else on the page moves. The two are
      // always designed together -- see the call sites, which show the
      // arithmetic. Sizing one without the other is how the row drifts.
      if (cfg.margin != null) this.style.margin = cfg.margin;
      // The side padding and any sideways bleed, published for the phone
      // clamp in the CSS above (`--hk-bleed-*`, `.hk-bleed`).
      var pl = window.hkCards && window.hkCards.px, bl = window.hkCards && window.hkCards.bleedSides;
      this.style.setProperty('--hk-row-pl', (pl ? pl(cfg.pad_left) : null) || '0px');
      this.style.setProperty('--hk-row-pr', (pl ? pl(cfg.pad_right) : null) || '0px');
      // Only a row that bleeds on its own host states these; a row inside a
      // bleeding grid must INHERIT the grid's values, so nothing is written
      // here that would shadow them.
      var b = bl ? bl(cfg.margin) : null;
      this.classList.toggle('hk-bleed', !!b);
      if (b) {
        this.style.setProperty('--hk-bleed-l', b.l + 'px');
        this.style.setProperty('--hk-bleed-r', b.r + 'px');
      } else {
        this.style.removeProperty('--hk-bleed-l');
        this.style.removeProperty('--hk-bleed-r');
      }

      for (var i = 0; i < cfg.cards.length; i++) {
        var el = this._createCard(cfg.cards[i]);
        if (cfg.card_width && cfg.card_width !== 'fit-content') {
          el.style.width = cfg.card_width;
          el.style.minWidth = cfg.card_width;
          el.style.maxWidth = cfg.card_width;
        }
        row.appendChild(el);
        this._children.push(el);
      }
      this._root.appendChild(row);
      if (cfg.lead) this._buildLead(row, cfg);
      // Covers the build-after-connect order; connectedCallback covers the
      // other one, and _wireDrag is idempotent so both firing is harmless.
      this._wireDrag();
      this._built = true;
    }

    // MOUSE CLICK-DRAG -- the one thing Swiper's grabCursor does that the
    // browser does not do by itself.
    //
    // THIS CODE IS UNREACHABLE ON A TOUCHSCREEN WALL TABLET, and that is a
    // structural guarantee rather than an intention: the first line of the
    // handler returns unless `pointerType === 'mouse'`, and a touchscreen
    // never produces a mouse pointer. Touch scrolling is the browser's, on the
    // compositor, and nothing below runs during it. That is the same guard
    // hk-tap.js uses to separate a tap from a scroll.
    //
    // WHY DOCUMENT LISTENERS AND NOT setPointerCapture: capture retargets the
    // events at the row, which would change what the child cards see for the
    // whole gesture. Listening on document moves nothing and is removed again
    // on disconnect.
    _wireMouseDrag(row) {
      var SLOP = 5;                 // px before a press becomes a drag
      var drag = null;
      var self = this;

      function down(ev) {
        if (ev.pointerType !== 'mouse' || ev.button !== 0) { return; }
        // Clear any stale suppression so a flag left by an earlier drag can
        // never eat an unrelated click later on.
        self._eatClick = false;
        drag = { x: ev.clientX, left: row.scrollLeft, moved: false };
      }

      function move(ev) {
        if (!drag) { return; }
        var dx = ev.clientX - drag.x;
        if (!drag.moved) {
          if (Math.abs(dx) < SLOP) { return; }
          drag.moved = true;
          row.style.cursor = 'grabbing';
          // Without this the drag selects the pill captions as it passes over
          // them and leaves blue highlight behind.
          row.style.userSelect = 'none';
        }
        row.scrollLeft = drag.left - dx;
        ev.preventDefault();
      }

      function up() {
        if (!drag) { return; }
        var moved = drag.moved;
        drag = null;
        row.style.cursor = '';
        row.style.userSelect = '';
        // A drag that ends over a tile would otherwise deliver a click to it
        // and fire the scene. Swiper suppressed the same click for the same
        // reason. The flag is read by the capture-phase listener below, which
        // runs before the tile's own handler.
        self._eatClick = moved;
      }

      function click(ev) {
        if (!self._eatClick) { return; }
        self._eatClick = false;
        ev.stopPropagation();
        ev.preventDefault();
      }

      row.addEventListener('pointerdown', down);
      row.addEventListener('click', click, true);
      // passive:false because move() calls preventDefault to stop the browser
      // starting a text selection or a native image drag mid-scroll.
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);

      this._dragOff = function () {
        row.removeEventListener('pointerdown', down);
        row.removeEventListener('click', click, true);
        document.removeEventListener('pointermove', move, { passive: false });
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
      };
    }

    // THE LEAD -- see `.lead` in the CSS. Its width is WATCHED, not read once:
    // the menu chip decides whether to draw itself only after the settings
    // arrive (and redraws when they change), so the row learns it from the
    // lead's box rather than from any flag.
    _buildLead(row, cfg) {
      var lead = document.createElement('div');
      lead.className = 'lead';
      var el = this._createCard(cfg.lead);
      lead.appendChild(el);
      this._children.push(el);
      this._root.appendChild(lead);
      var pl = window.hkCards && window.hkCards.px;
      this.style.setProperty('--hk-row-pt', (pl ? pl(cfg.pad_top) : null) || '0px');
      var gap = parseFloat(cfg.gap) || 0;
      var host = this, dy = 0;
      // The first card that is showing, by its OWN box (a card's margin is
      // inside hui-card's box): a chip, not a hidden conditional or a wrapper.
      // THE PLATE ITSELF, found through any wrapper: a chip that shows only
      // sometimes sits in Home Assistant's conditional card, an INLINE
      // element around a block, and Safari gives such an element a box of
      // its own line (Chrome gives it the chip's) -- centred on that, the
      // menu chip sat 3 px low on an iPhone (2026-09-30).
      function plateOf(node) {
        var q = [node], n = 0;
        while (q.length && n++ < 40) {
          var el = q.shift();
          var c = el.shadowRoot && el.shadowRoot.querySelector('hk-plate, ha-card');   // an HK card's plate, or HA's card's
          if (c) return c;
          var kids = [].slice.call(el.children || []);
          if (el.shadowRoot) kids = kids.concat([].slice.call(el.shadowRoot.children || []));
          q.push.apply(q, kids);
        }
        return null;
      }
      function firstBox() {
        var kids = row.children;
        for (var i = 0; i < kids.length; i++) {
          var c = plateOf(kids[i]) || kids[i].firstElementChild || kids[i];
          var r = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
          if (r && r.width > 0 && r.height > 0 && r.height < 120 && r.width < 600) return r;
        }
        return null;
      }
      function measure() {
        var w = lead.getBoundingClientRect ? lead.getBoundingClientRect().width : 0;
        var on = w > 0.5;
        if (on) {
          var b = firstBox(), l = lead.getBoundingClientRect();
          if (b) {
            var off = (b.top + b.height / 2) - (l.top + l.height / 2);
            if (Math.abs(off) > 0.25) {
              dy += off;
              host.style.setProperty('--hk-lead-dy', dy + 'px');
            }
          }
        }
        row.classList.toggle('has-lead', on);
        // Half the gap each side of the clip: scrolled chips stop 5 px short
        // of the lead rather than butting into it, and at rest the first chip
        // is still the full gap away.
        host.style.setProperty('--hk-lead-w', on ? (w + gap / 2) + 'px' : '0px');
        host.style.setProperty('--hk-lead-gap', on ? (gap / 2) + 'px' : '0px');
      }
      var ro = null;
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(measure);
        ro.observe(lead);
        ro.observe(row);
      }
      measure();
      this._leadOff = function () {
        if (ro) ro.disconnect();
      };
      this._leadMeasure = measure;          // tests
    }

    // HA's own container pattern, lifted from hui-conditional-base. `hui-card`
    // owns lazy module loading, the error card for an unknown type, and the
    // ll-rebuild handling that swipe-card gets WRONG -- its _rebuildCard calls
    // a method that does not exist, so a card built before its custom element
    // registers stays an invisible placeholder until a page reload. Using
    // hui-card is why this card needs no patch for that. hkCards.createCard
    // makes exactly that with Lovelace, and the card itself without it.
    _createCard(config) {
      return window.hkCards.createCard(config, this.client);
    }

    // EACH NEW CLIENT, through the host adapter's entry (below the class): the
    // row's tone, and every child card gets what goes with it (the host adapter
    // decides: in HA a card Home Assistant draws needs the frontend's object).
    _onClient(c) {
      if (window.hkCards && window.hkCards.tone) window.hkCards.tone(this, c);
      for (var i = 0; i < this._children.length; i++) window.hkHostClient.bridge(this._children[i], c);
    }

    // The row is as tall as its tallest child; HA only needs a rough number for
    // masonry, and these dashboards use grid-layout anyway.
    getCardSize() { return 2; }
  }

  function reg() {
    var C = window.hkCards;
    // its size in HA's Sections view (hk-base.js GRID)
    if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-row-card', HkRowCard);
    window.hkHostClient.entry(HkRowCard);    // Lovelace's entry, through the host adapter
    if (!customElements.get('hk-row-card')) customElements.define('hk-row-card', HkRowCard);
    if (C && C.editor) {
      var etag = C.editor('hk-row-card', [
        // The honest control for a nested list is the YAML sub-editor.
        { name: 'cards', selector: { object: {} } },
        { name: 'lead', selector: { object: {} },
          helper: 'One card pinned at the start of the row, which does not scroll -- e.g. the menu button.' },
        C.section('Layout', [
          { type: 'grid', name: '', schema: [
            { name: 'card_width', selector: { text: {} }, helper: 'Width of each card, e.g. ' + C.TILE.w + 'px.' },
            { name: 'gap', selector: { text: {} }, helper: 'Space between cards, e.g. ' + C.TILE.gridGap + '.' },
            { name: 'phone_card_width', selector: { text: {} } },
            { name: 'phone_gap', selector: { text: {} } },
            { name: 'pad_top', selector: { text: {} } },
            { name: 'pad_bottom', selector: { text: {} } },
            { name: 'pad_left', selector: { text: {} } },
            { name: 'pad_right', selector: { text: {} } },
            { name: 'margin', selector: { text: {} } }
          ] }
        ], 'mdi:ruler')
      ]);
      HkRowCard.getConfigElement = function () { return document.createElement(etag); };
    }
    if (!Object.prototype.hasOwnProperty.call(HkRowCard, 'getStubConfig')) {
      HkRowCard.getStubConfig = function () {
        // NO `type` here: the card picker lays this over its own
        // `custom:hk-row-card`, and a bare `hk-row-card` is a type Home
        // Assistant does not know ("Unknown type").
        // the pill's width and gap (hk-base.js TILE): asked only by the card
        // picker, after hk-base has loaded
        var T = window.hkCards.TILE;
        return { card_width: T.w + 'px', gap: T.gridGap, cards: [] };
      };
    }
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: 'hk-row-card', name: 'HK Scroll Row',
      description: 'A row of cards that scrolls sideways.',
      preview: false
    });
    window.hkRow.HkRowCard = HkRowCard;
  }

  // Same rule as every other card here: hk-base.js is a parallel-loaded
  // resource, so wait for its READY EVENT rather than polling. rAF never fires
  // in a hidden tab, which is where a wall tablet spends most of its life
  // behind a screensaver.
  if (window.hkCards && window.hkCards.editor) reg();
  else window.addEventListener('hk-cards-ready', reg, { once: true });
})();
