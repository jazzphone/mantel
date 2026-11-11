// hk-menu-drawer.js - the drawer: mounting, placing, building its list, Home Assistant's sidebar, the edge swipe.
//
// PART OF THE MENU (hk-menu.js). Not a card and not run on its own: it registers one
// function, which hk-menu.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkMenuParts = window.hkMenuParts || {})['hk-menu-drawer'] = function (K) {
    var BAND_WIDE = K.BAND_WIDE, C = K.C, CSS = K.CSS, editItems = K.editItems, editKey = K.editKey, esc = K.esc,
        glyph = K.glyph, haKey = K.haKey, haList = K.haList, haOpen = K.haOpen, hostItems = K.hostItems,
        IDLE_MS = K.IDLE_MS, INK = K.INK, isHere = K.isHere, M = K.M, model = K.model, pagePaths = K.pagePaths,
        publishHeader = K.publishHeader, SH = K.SH, sidebarSource = K.sidebarSource, TAB_W = K.TAB_W,
        tabCentre = K.tabCentre, tabSize = K.tabSize, W = K.W;

    var CHEV_L = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"' +
      ' stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M15 4.5 L7.5 12 L15 19.5"/></svg>';
    var CHEV_D = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"' +
      ' stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M5 9 L12 16 L19 9"/></svg>';

    // EDIT MODE'S ROWS (hk-edit-menu.js): a page's Hide switch and a handle,
    // a room's handle; the row lifted while it is carried
    var GRIP = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>';
    var EDIT_CSS = [
      '.row.ed{cursor:default;gap:12px;padding-right:4px;touch-action:pan-y;user-select:none;-webkit-user-select:none}',
      '.row.ed.home{padding-right:14px}',
      '.row.ed.off hk-icon,.row.ed.off span{opacity:.45}',
      '.row.ed.lifted{z-index:2;background:rgba(255,255,255,0.14);box-shadow:0 8px 24px rgba(0,0,0,0.35);transition:none!important}',
      '.list.hk-carrying .row.ed:not(.lifted){pointer-events:none}',
      '.row.ed .sw{flex:none;position:relative;width:44px;height:26px;border-radius:13px;border:0;padding:0;margin:0;',
      '  background:rgba(120,120,128,0.36);cursor:pointer;transition:background-color .2s ease;-webkit-tap-highlight-color:transparent}',
      '.row.ed .sw::after{content:"";position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;background:#fff;',
      '  box-shadow:0 2px 4px rgba(0,0,0,0.25);transition:transform .2s ease}',
      '.row.ed .sw[aria-checked="true"]{background:#34c759}',
      '.row.ed .sw[aria-checked="true"]::after{transform:translateX(18px)}',
      '.row.ed .grip{flex:none;width:36px;height:40px;display:flex;align-items:center;justify-content:center;border:0;padding:0;margin:0;',
      '  background:none;color:rgba(235,235,245,0.6);cursor:grab;touch-action:none;border-radius:12px}',
      '.row.ed .grip:focus-visible,.row.ed .sw:focus-visible{outline:2px solid rgba(255,255,255,0.7);outline-offset:1px}',
      '.row.ed .gap{flex:none;width:36px}',
      '.sh.ed{cursor:default}',
      // the Edit bar lies over the page's top, an open menu's too: its list starts below it
      '.root:not(.docked) .panel:not(.has-now) .list.arranging{padding-top:calc(var(--safe, 0px) + 62px)}',
      '.ednote{margin:14px 14px 6px;font-size:13px;line-height:1.35;color:' + window.hkCards.v('ink-2') + '}',
      '@media (prefers-reduced-motion:reduce){.row.ed,.row.ed .sw,.row.ed .sw::after{transition:none!important}}'
    ].join('\n');

    // ------------------------------------------------------------- state
    var S = { host: null, root: null, open: false, dash: null, idle: null, shut: {}, built: '' };

    function haRoot() { return SH.overlayRoot(); }
    function narrow() { return (window.innerWidth || 1280) < M.NARROW; }
    // Its item's Menu: "Always open beside the page", when there is room.
    function docked() { return M.docked(); }

    function mount() {
      if (S.host && S.host.isConnected) return true;
      var r = haRoot();
      if (!r) return false;
      S.host = document.createElement('div');
      S.host.id = 'hk-menu';
      var sr = S.host.attachShadow({ mode: 'open' });
      window.hkCards.flatSurface(S.host, 'menu');
      // (and the list's edges, the sheet's shadows: hk-base.js edgeCss)
      sr.innerHTML = '<style>' + CSS + EDIT_CSS + window.hkCards.flatCss() + (window.hkCards.edgeCss ? window.hkCards.edgeCss() : '') +
        ':host([hk-flat]) .mat{background:var(--hk-flat-menu)!important;border-color:var(--hk-line)}' +
        ':host([hk-flat]) .panel::before{box-shadow:var(--hk-flat-elevated-shadow)!important}' +
        ':host([hk-flat]) .tab,:host([hk-flat]) .fab{background:var(--hk-flat-elevated)!important;color:var(--hk-ink)}' +
        // the page you're on: the highlight's solid fill, its text and icon
        // white -- as the other looks (the user, 2026-10-17: the tint with an
        // accent name and a white icon read as two tones)
        ':host([hk-flat]) .row.here::before{transform:none}' +
        // the list clipped under the device's safe area, in every look
        '.hk-edge>.list{-webkit-mask-image:linear-gradient(transparent 0,transparent var(--safe),#000 var(--safe));' +
        'mask-image:linear-gradient(transparent 0,transparent var(--safe),#000 var(--safe))}' +
        '</style>' +
        '<div class="root" part="root">' +
          '<div class="scrim"></div><div class="edge" aria-hidden="true"></div>' +
          '<div class="clip"><nav class="panel" aria-label="Menu" aria-hidden="true">' +
            '<div class="mat"></div>' +
            '<div class="now" hidden><div class="tm"><span class="t"></span><span class="ap"></span></div>' +
              '<div class="wx" role="link" aria-label="Weather"><span class="g"></span><span class="tp"></span></div>' +
              '<div class="d"></div><div class="c" role="link" aria-label="Weather"></div></div>' +
            '<div class="rule" hidden></div><div class="hk-edge"><div class="list"></div></div>' +
            '<button class="tab" aria-label="Menu" aria-expanded="false"><hk-icon></hk-icon>' + CHEV_L + '</button>' +
          '</nav></div>' +
          '<button class="fab" aria-label="Menu"><hk-icon></hk-icon></button>' +
        '</div>';
      S.root = sr.querySelector('.root');
      S.panel = sr.querySelector('.panel');
      S.list = sr.querySelector('.list');
      if (window.hkCards.edges) window.hkCards.edges(sr.querySelector('.hk-edge'));
      S.scrim = sr.querySelector('.scrim');
      S.now = sr.querySelector('.now');
      // fitted again whenever its width changes: a fit made while the menu
      // was hidden or still docking left "Feels" in and cut the date off
      // (the user, 2026-10-17)
      if (typeof ResizeObserver !== 'undefined') {
        var nowW = 0;
        new ResizeObserver(function (es) {
          var w = Math.round(es[0].contentRect.width);
          if (w && w !== nowW) { nowW = w; if (S.nowLines && nowOn()) fitNow(); }
        }).observe(S.now);
      }
      S.rule = sr.querySelector('.rule');
      [sr.querySelector('.now .wx'), sr.querySelector('.now .c')].forEach(function (el) {
        el.addEventListener('click', function () { goWeather(); });
      });
      S.tab = sr.querySelector('.tab');
      S.fab = sr.querySelector('.fab');
      S.mat = sr.querySelector('.mat');
      // the panel slid in or out: its pinned glass is cut again where it is
      S.panel.addEventListener('transitionend', function () { if (window.hkGlass && window.hkGlass.repin) window.hkGlass.repin(); });
      sr.querySelector('.scrim').addEventListener('click', function () { close(); });
      S.tab.addEventListener('click', function (e) {
        e.stopPropagation();
        // a swipe that started on the tab and opened the menu is not a tap
        if (Date.now() - (S.pulled || 0) < 500) return;
        toggle(!e.detail);                 // detail 0: pressed with a key, not tapped
      });
      S.fab.addEventListener('click', function (e) { e.stopPropagation(); open(); });
      S.list.addEventListener('click', onList);
      // Anything done INSIDE the menu is activity: it keeps it open.
      ['pointerdown', 'wheel', 'keydown'].forEach(function (t) {
        S.panel.addEventListener(t, armIdle, { passive: true });
      });
      wireSwipe();
      S.edge = sr.querySelector('.edge');
      // TOUCH ADJUSTMENT: Chrome moves a finger's touch onto the nearest
      // element that answers a tap, and pointer listeners alone do not make
      // one -- measured, a touch 3 px from the edge went to the tile 13 px
      // away, or to <html>, about half the time. A click listener does (and
      // does nothing: a tap that lands here passes on as it would).
      S.edge.addEventListener('click', function () {});
      wireEdge(S.edge);
      wireEdge(S.tab);
      r.appendChild(S.host);
      return true;
    }

    // THE PANEL COVERS THE DASHBOARD, not the whole window: on a desktop
    // Home Assistant's own sidebar stays visible to its left, and on a phone
    // the menu runs from the top of the screen like the Home app's.
    function place() {
      if (!S.root) return;
      // The SCREEN's height, not the panel's: the document is what scrolls,
      // so on a long page the panel is as tall as the page (thousands of px
      // on a phone) while the menu must fill only what is visible.
      var p = M.panel(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
      var l = r ? r.left : 0, t = r ? Math.max(0, r.top) : 0;
      var h = Math.max(0, (window.innerHeight || 800) - t);
      S.root.style.setProperty('--l', l + 'px');
      S.root.style.setProperty('--t', t + 'px');
      S.root.style.setProperty('--h', h + 'px');
      S.root.style.setProperty('--edge-w', edgeWidth(r ? r.width : (window.innerWidth || 0)) + 'px');
      // THE TAB, centered on the date line (hk-header-card publishes it per
      // dashboard, from the top of the page); without one yet, where the Home
      // header's date sits on a wall tablet. The tab lives in the panel, whose
      // top is the dashboard's -- the page starts lower when HA's toolbar shows.
      var top = M.viewTop();
      // the toolbar's height: the page's top at rest, less the panel's
      var bar = r ? Math.max(0, top - (r.top + (window.scrollY || 0))) : 0;
      S.root.style.setProperty('--edge-t', (t + bar) + 'px');
      var ts = tabSize();
      S.root.style.setProperty('--tab-w', ts[0] + 'px');
      S.root.style.setProperty('--tab-h', ts[1] + 'px');
      S.root.style.setProperty('--tab-ic', ts[2] + 'px');
      S.root.style.setProperty('--tab-r', Math.round(ts[0] * 15 / TAB_W) + 'px');
      var y = tabCentre(M.board().tab_position || '', M.dateY(),
                        Math.max(0, (window.innerHeight || 800) - Math.max(0, top)), ts[1]);
      S.root.style.setProperty('--tab-y', ((top - t) + y - ts[1] / 2) + 'px');
    }

    // WHERE THE DASHBOARD STARTS, for the sheets (hk-popup.js, hk-detail.js):
    //   --hk-content-left  past Home Assistant's own sidebar, when it shows.
    //                      A modal sheet centers in the rest -- the WHOLE
    //                      dashboard, this menu included, docked or not: the
    //                      menu is the dashboard's own, Home Assistant's
    //                      sidebar is not.
    //   --hk-page-left     ...and past this menu when it is docked: where a
    //                      sheet that is not modal (the now-playing bar) starts,
    //                      so it never lies over the menu's last rows.
    // Backdrops still cover everything; only the sheet moves.
    function publishLeft() {
      var p = M.panel(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
      var left = Math.max(0, r ? r.left : 0);
      var de = document.documentElement;
      if (!de || !de.style) return;
      // (--hk-menu-right: where the page would start with no pane -- the
      // pop-up asks it whether a pane fits; --hk-page-right: the pane's
      // width on the right, where the page ends)
      var menuRight = left + (S.root && M.on() && docked() ? W : 0), ps = paneSides();
      var pageLeft = menuRight + ps.l;
      [['--hk-content-left', left], ['--hk-page-left', pageLeft], ['--hk-menu-right', menuRight], ['--hk-page-right', ps.r]].forEach(function (kv) {
        var v = Math.round(kv[1] * 10) / 10 + 'px';
        if (de.style.getPropertyValue(kv[0]) !== v) de.style.setProperty(kv[0], v);
      });
      // THE iPAD BAND IS THE PAGE'S WIDTH, NOT THE WINDOW'S. A
      // 1,280 px tablet with the menu docked has a 980 px page -- an iPad's
      // -- and takes the iPad pill (five across) and page layouts, which
      // css/hk-responsive.css applies under [data-hk-band] as well as under
      // its media query (which only knows the window).
      // "wide" from 860 px of page: a tablet with the menu open (980), an
      // iPad held sideways -- room for the tablet's own arrangement where the
      // iPad's was a squeeze (hk-responsive.css, [data-hk-band="wide"]).
      // (less the room the view keeps beside a side safe area: hk-base.js SAFE)
      var sa = window.hkCards && window.hkCards.safeArea ? window.hkCards.safeArea() : { left: 0, right: 0 };
      var pw = (window.innerWidth || 0) - pageLeft - ps.r - Math.max(0, sa.left - pageLeft) - Math.max(0, sa.right - ps.r);
      var band = pw > M.NARROW && pw < M.TAB_MIN ? (pw >= BAND_WIDE ? 'wide' : 'narrow') : null;
      if (band !== de.getAttribute('data-hk-band')) {
        if (band) de.setAttribute('data-hk-band', band); else de.removeAttribute('data-hk-band');
      }
    }
    // The panel's size and place change without a window resize when Home
    // Assistant's sidebar expands or collapses; watched while the menu is on.
    function watchPanel() {
      var p = M.panel();
      if (!window.ResizeObserver || !p || S.watched === p) return;
      if (S.ro) S.ro.disconnect();
      S.ro = new ResizeObserver(function () { sync(); });
      S.ro.observe(p);
      S.watched = p;
    }

    function paintIcons() {
      var icon = M.icon();
      // (an hk-base.js from before 1.5 has no accent: the orange stays)
      var a = typeof M.accent === 'function' ? M.accent() : null;
      if (a && S.host) {
        // the icons the highlight (base); the page you're on its own color
        // (Highlight Color Automatic: only that row changes)
        S.host.style.setProperty('--hk-accent', a.base || a.color);
        S.host.style.setProperty('--hk-here', a.color);
        S.host.style.setProperty('--hk-on-accent', a.on);
      }
      [S.tab, S.fab].forEach(function (b) {
        var i = b && b.querySelector('hk-icon');
        if (i && i.getAttribute('icon') !== icon) i.setAttribute('icon', icon);
      });
    }

    // A MENU DOCKING BY ITSELF (2026-10-09). On a load the dashboard's left
    // edge is still moving -- Home Assistant's sidebar going (hk-kiosk.js)
    // -- and the menu slid in from where the sidebar had been, then settled
    // a little further left: a bounce on every load (screen-recorded). So it
    // waits, unseen, until that edge holds still for SETTLE_FRAMES frames
    // (at most SETTLE_MAX), then is drawn in place with no slide; the slide
    // stays for opening it by hand.
    var SETTLE_FRAMES = 2, SETTLE_MAX = 30;
    function settle() {
      var run = S.settleRun = (S.settleRun || 0) + 1, last = null, same = 0, n = 0;
      S.still = true; S.settling = true;
      var cls = function (c, on) { if (S.root) S.root.classList.toggle(c, on); };
      cls('still', true); cls('settling', true);
      var frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (f) { return setTimeout(f, 16); };
      (function look() {
        if (run !== S.settleRun) return;
        var p = M.panel(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
        var l = r ? Math.round(r.left) : 0;
        same = l === last ? same + 1 : 0; last = l; n++;
        if (same < SETTLE_FRAMES && n < SETTLE_MAX) { frame(look); return; }
        place();
        S.settling = false; cls('settling', false);
        // the slide back on after the frame it was drawn in
        frame(function () { frame(function () { if (run === S.settleRun) { S.still = false; cls('still', false); } }); });
      })();
    }

    // Everything that can change which pieces show: called on every page
    // change, settings change, resize and state push -- all cheap, all
    // idempotent.
    function sync() {
      var on = M.on();
      watchPanel();
      guardDrawer();
      if (!on) {
        if (S.open) close(true);
        undock();
        if (S.root) S.root.className = 'root';
        publishHeader();
        paintNow();
        publishLeft();
        return;
      }
      if (!mount()) { undock(); publishLeft(); return; }
      var style = M.style(), dock = docked();
      var glass = document.documentElement.getAttribute('data-hk-glass');
      var home = isHome();
      var cls = ['root'];
      if (glass === 'frosted' || glass === 'tinted') cls.push(glass);
      // Bright Glass in any of its modes (2026-10-30)
      if (glass === 'bright' || glass === 'bright_pre' || glass === 'bright_each') cls.push('bright');
      pinGlass(glass === 'blur_pre' ? 'blur' : glass === 'bright_pre' ? 'bright' : null, dock);
      var tabAt = typeof M.tab === 'function' ? M.tab() : (style === 'tab' ? 'always' : 'never');
      // a menu docking by itself appears where it belongs (settle)
      if (dock && !S.wasDock) settle();
      S.wasDock = dock;
      if (S.still) cls.push('still');
      if (S.settling) cls.push('settling');
      if (dock) cls.push('docked');
      else if (tabAt === 'always') cls.push('tabbed');
      // While the menu is open the tab stays as it was when it opened:
      // otherwise the page scrolling behind an open menu moves the chip in
      // and out of sight, and the tab (its close handle) slides back and
      // forth over the menu. Closing looks again.
      else if (tabAt === 'scrolled') {
        cls.push('tabscroll');
        if (S.open ? S.root.classList.contains('tabbed') : chipGone()) cls.push('tabbed');
      }
      // a phone's Home with no chip to hold the button
      else if (style === 'chip' && narrow() && home && !homeHasChip()) cls.push('fabbed');
      if (S.open && !dock) cls.push('open');
      if (swipeOn()) cls.push('swipe');
      if (S.drag && S.drag.live) cls.push('dragging');
      S.root.className = cls.join(' ');
      S.panel.setAttribute('aria-hidden', (S.open || dock) ? 'false' : 'true');
      S.tab.setAttribute('aria-expanded', S.open ? 'true' : 'false');
      paintIcons();
      place();
      if (dock) { dockTo(); if (listKey() !== S.built) build(); markHere(); }
      else undock();
      paintNow();
      publishLeft();
      publishHeader();
    }

    // ------------------------------------------------ the scrolled tab
    // Its item's Menu: "Chip, the tab once scrolled past" / "Chip on Home, tab
    // on the other pages" (hk-base.js menu.tab() says 'scrolled'): the tab
    // slides in while every round button on the page is out of sight, and
    // back out when one returns. The buttons are the cards' own <hk-plate>s
    // (menu.chips()), looked at on scroll -- one or two rects a frame, and
    // only on such a dashboard.
    //
    // A page whose button has not drawn yet (just navigated) is given a
    // moment before the tab counts it as missing, so it does not flash in and
    // straight back out.
    var CHIP_WAIT = 600;
    function chipGone() {
      var els = typeof M.chips === 'function' ? M.chips() : [];
      if (!els.length) {
        if (!S.noChip) {
          S.noChip = Date.now();
          setTimeout(function () { if (S.noChip) sync(); }, CHIP_WAIT + 20);
        }
        return Date.now() - S.noChip >= CHIP_WAIT;
      }
      S.noChip = 0;
      // the top of what shows: under Home Assistant's toolbar, which stays
      // put while the page scrolls (viewTop is the page's top at rest)
      var p = M.panel(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
      var rest = r ? r.top + (window.scrollY || 0) : 0;
      var edge = Math.max(0, r ? r.top : 0) + Math.max(0, M.viewTop() - rest), vh = window.innerHeight || 800;
      return !els.some(function (el) {
        var r = el.getBoundingClientRect();
        var mid = (r.top + r.bottom) / 2;         // half of it gone counts as gone
        return r.width > 0 && mid > edge && mid < vh;
      });
    }
    function scrolled() {
      if (S.scrollRaf || !S.root || S.open || !S.root.classList.contains('tabscroll')) return;
      S.scrollRaf = requestAnimationFrame(function () {
        S.scrollRaf = 0;
        if (S.open || !S.root.classList.contains('tabscroll')) return;
        var gone = chipGone();
        if (gone !== S.root.classList.contains('tabbed')) S.root.classList.toggle('tabbed', gone);
      });
    }

    // ------------------------------------------------ the time and weather
    function nowOn() {
      return !!S.root && docked() && typeof M.hasTime === 'function' && M.hasTime();
    }
    // WITH A PICTURE OF THE SKY (Blur Mode Pre-rendered, hk-glass.js
    // PINNED): the panel, the edge tab and the button wear their slice of it
    // under their own tints instead of blurring the moving sky live -- the
    // panel is a full-height blur of it on every page
    var PIN_TINTS = [['mat', 'linear-gradient(rgba(28,28,32,0.52),rgba(28,28,32,0.52))'],
                     ['tab', 'linear-gradient(145deg,rgba(255,255,255,0.17),rgba(255,255,255,0.07)),linear-gradient(rgba(26,30,46,0.24),rgba(26,30,46,0.24))'],
                     ['fab', 'linear-gradient(145deg,rgba(255,255,255,0.16),rgba(255,255,255,0.07))']];
    // ...AND IN BRIGHT GLASS (Pre-rendered, 2026-11-07): the same picture,
    // painted with the look's own light blur (--hk-blur-filter), under the
    // Bright wash and Dim (.root.bright .mat, .tab, .fab above) -- the docked
    // panel only: over the page (not docked) it blurs the cards beneath it
    // (34 px), which a picture of the sky cannot show, so it stays live
    var BRIGHT_TINTS = [['mat', 'var(--hk-bright-shade,linear-gradient(transparent,transparent)),linear-gradient(150deg,rgba(255,255,255,0.30),rgba(255,255,255,0.14))', true],
                        ['tab', 'var(--hk-chip-plate)'], ['fab', 'var(--hk-chip-plate)']];
    // `mode`: 'blur' (Blur's Pre-rendered), 'bright' (Bright Glass's), or none
    function pinGlass(mode, dock) {
      var G = window.hkGlass;
      if (!G || !G.pin) return;
      var list = mode === 'bright' ? BRIGHT_TINTS : PIN_TINTS;
      list.forEach(function (p) {
        if (!S[p[0]]) return;
        if (mode && !(p[2] && !dock)) G.pin(S[p[0]], p[1]); else G.unpin(S[p[0]]);
      });
    }
    function paintNow() {
      if (!S.root) return;
      var on = nowOn();
      S.panel.classList.toggle('has-now', on);
      S.now.hidden = !on;
      S.rule.hidden = !on;
      var H = window.hkHeader, h = C.client();
      if (!on) { S.nowKey = ''; if (H && H.nowDone) H.nowDone(); return; }
      if (!H || typeof H.now !== 'function' || !h || !h.states) return;
      var v = H.now(h.states, C.subscriptions(h));
      // wxReady: the home's weather glyphs arriving swaps the Material stand-in
      // for the real one, with no weather change to say so.
      var ready = H.wxReady ? H.wxReady() : '';
      var key = [v.time, v.ampm, v.date, v.state, v.night, v.temp, v.condition, v.feels, v.high, v.low, ready].join('|');
      if (key === S.nowKey) return;
      var glyph = v.state + '|' + v.night + '|' + ready;
      S.nowKey = key;
      var q = function (sel) { return S.now.querySelector(sel); };
      q('.t').textContent = v.time;
      q('.ap').textContent = v.ampm;
      q('.tp').textContent = v.temp;
      q('.d').textContent = v.date;
      if (S.nowGlyph !== glyph) { S.nowGlyph = glyph; q('.g').innerHTML = H.wxSvg(v.state, 28, { night: v.night }); }
      S.nowCond = v.condition;
      S.nowLines = nowLines(v);
      fitNow();
    }
    // WHAT GOES BESIDE THE DATE, fullest first; fitNow takes the first that
    // leaves the date whole (the user, 2026-10-17): today's high and low, as
    // iOS's Weather widget has them -- "Sunny · H:71° L:52°", then the high
    // alone, then the condition alone. "Feels" only when it says something
    // the big temperature doesn't (3° or more off it), in the high's place.
    // No forecast: "Sunny · Feels 60°", then "Sunny", as before.
    var FEELS_APART = 3;
    function nowLines(v) {
      var c = v.condition || '', dot = function (x) { return c ? c + ' \u00b7 ' + x : x; };
      var hi = v.high != null ? 'H:' + v.high + '\u00b0' : '', lo = v.low != null ? 'L:' + v.low + '\u00b0' : '';
      var odd = v.feels && v.feelsN != null && v.tempN != null && Math.abs(v.feelsN - v.tempN) >= FEELS_APART;
      var out = [];
      if (hi) {
        if (lo) out.push(dot(hi + ' ' + lo));
        out.push(dot(odd ? v.feels : hi));
      } else if (v.feels) out.push(dot(v.feels));
      out.push(c || (out.length ? out[out.length - 1] : ''));
      return out.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    }
    // The fullest of nowLines() that fits beside the date -- the date is
    // never the one squeezed. Then each
    // line's ink is put on the column (see the CSS note).
    //
    // SF PRO'S SIDE BEARINGS, MEASURED, in em, off a 4x render of the font
    // every screen loads from /hk/ at the optical size the page draws it --
    // not canvas measureText, which is not the same everywhere: Chrome's
    // canvas skips SF Pro's display optical size, so "79°" lands 0.5 px past
    // "Feels 79°" there and about 1 px short of it elsewhere. The font file
    // is the same on every screen; its bearings are too. Only the glyphs that
    // can start or end a line:
    var LB_TIME = { 1: .0398, 2: .0398, 3: .0398, 4: .0341, 5: .0511, 6: .0398, 7: .0284, 8: .0398, 9: .0455 }; // 600 44px
    var LB_DATE = { S: .0536, M: .0893, T: .0357, W: .0357, F: .0893 };                                    // 600 14px
    var RB_TEMP = .0496;                                                                                   // "°" 500 32px
    var RB_LINE = { '\u00b0': .0519, a: .0592, d: .0681, e: .0379, g: .0619, h: .0642, k: .0285, l: .0670,
                    n: .0592, r: .0246, s: .0525, t: .0391, w: .0374, y: .0257 };                           // 600 14px
    // whether `el`'s one line of text is wider than its box: the text's own
    // width (a Range), not scrollWidth -- Safari reports an ellipsized
    // line's scrollWidth as its box's, so the date was cut with "Feels"
    // still beside it (the user, 2026-10-17)
    function clipped(el) {
      var box = el.getBoundingClientRect().width;
      if (!box || !document.createRange) return false;
      var r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().width > box + 0.5;
    }
    function fitNow() {
      var q = function (sel) { return S.now.querySelector(sel); };
      var c = q('.c'), d = q('.d');
      var lines = S.nowLines && S.nowLines.length ? S.nowLines : [S.nowCond || ''];
      c.textContent = lines[0];
      var first = function (t) { return String(t || '').charAt(0); };
      var last = function (t) { t = String(t || ''); return t.charAt(t.length - 1); };
      var em = function (table, ch, px, dflt) { return (table[ch] !== undefined ? table[ch] : dflt) * px; };
      q('.tm').style.marginLeft = (INK - em(LB_TIME, first(q('.t').textContent), 44, .04)).toFixed(2) + 'px';
      d.style.marginLeft = (INK - em(LB_DATE, first(d.textContent), 14, .05)).toFixed(2) + 'px';
      q('.wx').style.marginRight = (INK - RB_TEMP * 32).toFixed(2) + 'px';
      c.style.marginRight = (INK - em(RB_LINE, last(c.textContent).toLowerCase(), 14, .05)).toFixed(2) + 'px';
      // (asked with the margins in place: they move the line's ends)
      for (var i = 1; i < lines.length && clipped(d); i++) {
        c.textContent = lines[i];
        c.style.marginRight = (INK - em(RB_LINE, last(c.textContent).toLowerCase(), 14, .05)).toFixed(2) + 'px';
      }
      if (!S.nowFonts && document.fonts && document.fonts.ready) {
        S.nowFonts = true;
        document.fonts.ready.then(function () { if (nowOn()) fitNow(); });
        // (and each font that arrives later: SF Pro landing after the fit
        // widened the date past its room)
        if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { if (nowOn()) fitNow(); });
      }
    }
    // The weather opens the Weather page, as it does in the header -- the
    // dashboard's own `weather` view, when it has one.
    function goWeather() {
      var cfg = M.config(), dash = M.dash();
      var has = cfg && (cfg.views || []).some(function (v) { return v && v.path === 'weather'; });
      if (!has || !dash) return;
      var path = '/' + dash + '/weather';
      if (location.pathname === path) return;
      SH.navigate(path);
    }

    function isHome() {
      var here = String(location.pathname).split('/')[2] || '';
      var cfg = M.config(), v0 = cfg && cfg.views && cfg.views[0];
      return !here || here === '0' || (v0 && v0.path === here);
    }
    // hk-base's answer: a written-out button or the chips card's lead.
    function homeHasChip() { return M.homeButton(); }

    // ---------------------------------------------------------- the list
    function listKey() {
      var cfg = M.config(), h = C.client(), side = sidebarSource();
      var b = M.board();
      return [M.dash(), b.ha_place, b.menu_rooms, JSON.stringify(b.room_order), b.ha_row,
              JSON.stringify(b.categories), JSON.stringify(b.menu_top || []), JSON.stringify(b.pages || []),
              JSON.stringify(b.chips || []), b.chips_row,
              haSidebarShown(),
              // the Home Assistant section: More folded or not, this user's
              // sidebar order, and the panels there are
              !!S.shut.ha_more, JSON.stringify(S.haPrefs || null), !!(h && h.user && h.user.is_admin),
              side && side.panels ? Object.keys(side.panels).join(',') : '', haKey(),
              hostItems().map(function (x) { return x.title + x.href; }).join(','),
              // Edit Page: offered on this page or not (hkEdit.offerKey);
              // Edit mode's rows (hk-edit-menu.js)
              editKey(h), arranging() ? 'ed' : '',
              cfg ? (cfg.views || []).length : 0,
              JSON.stringify(h && h.areas ? Object.keys(h.areas).map(function (k) {
                return k + ':' + h.areas[k].name + ':' + (h.areas[k].icon || '');
              }) : [])].join('|') + '|' + (cfgId(cfg));
    }
    var CFGS = new WeakMap(), CFGN = 0;
    function cfgId(cfg) {
      if (!cfg || typeof cfg !== 'object') return 0;
      if (!CFGS.has(cfg)) CFGS.set(cfg, ++CFGN);
      return CFGS.get(cfg);
    }
    function build() {
      var cfg = M.config(), h = C.client();
      var b = M.board();
      var m = model(cfg, h && h.areas, { dash: M.dash(), order: b.menu_rooms === 'order' ? 'order' : 'az',
                                          roomOrder: b.room_order,
                                          user: h && h.user && h.user.id,
                                          categories: b.categories,
                                          top: b.menu_top,
                                          chips: b.chips, chipsRow: b.chips_row,
                                          pageOrder: pagePaths(b.pages, b.custom_pages),
                                          ha: !!b.ha_row });
      S.items = [];
      var html = '';
      function row(it) {
        S.items.push(it);
        var cls = it.kind === 'sub' ? ' sub' : it.kind === 'more' ? ' more' : '';
        var tail = it.badge ? '<b class="bdg" data-badge="' + it.badge + '" hidden></b>' : it.kind === 'more' ? CHEV_D : '';
        return '<button class="row' + cls + '" data-i="' + (S.items.length - 1) + '"' +
          (it.kind === 'more' ? ' aria-expanded="' + !!it.open + '"' : '') + '><hk-icon icon="' +
          esc(glyph(it.icon)) + '"></hk-icon><span>' + esc(it.title) + '</span>' + tail + '</button>';
      }
      function section(key, title, items) {
        if (!items.length) return '';
        var shut = !!S.shut[key];
        return '<button class="sh' + (shut ? ' shut' : '') + '" data-sec="' + key + '" aria-expanded="' +
          (!shut) + '">' + esc(title) + CHEV_D + '</button>' + (shut ? '' : items.map(row).join(''));
      }
      if (arranging()) {
        buildEdit(m);
        return;
      }
      if (m.home) html += row(m.home);
      if (m.pages) html += row(m.pages);
      S.haOn = m.ha;
      haCounts(m.ha);
      // THE HOME ASSISTANT SECTION where the screen puts it (ha_place): right
      // under Home, above Categories, above Rooms (the default) or last
      var ha = '';
      if (m.ha) {
        haUpdates(h, true);
        ha = section('ha', 'Home Assistant', haList(S.haPrefs, { moreOpen: !!S.shut.ha_more, sidebarShown: haSidebarShown() }));
      }
      var place = b.ha_place || 'rooms';
      if (place === 'top') html += ha;
      html += m.top.map(row).join('');
      if (place === 'categories') html += ha;
      html += section('categories', 'Categories', m.categories);
      if (place === 'rooms') html += ha;
      html += section('rooms', 'Rooms', m.rooms);
      if (place === 'bottom') html += ha;
      // EDIT PAGE, a row of its own above the host's section (Edit mode)
      html += editItems(h).map(row).join('');
      var hostRows = hostItems();
      html += section('host', hostRows.length ? hostRows[0].section || 'More' : '', hostRows);
      var keep = S.list.scrollTop;
      S.list.innerHTML = html;
      S.list.classList.remove('arranging');
      S.list.scrollTop = keep;
      if (window.hkCards.edges) window.hkCards.edges(S.list.parentNode);
      S.built = listKey();
      paintBadges();
    }

    // IN EDIT MODE (hk-edit-menu.js): the pages with a handle and a Hide
    // switch -- the top pages, then Categories (one list: a page drags
    // between the two), then the pages not in the menu, then the rooms with a
    // handle. No Home Assistant or host rows: a tap goes nowhere while editing.
    function arranging() { return !!(window.hkEditMenu && window.hkEditMenu.on()); }
    function viewPath(it) { var p = it.paths || []; return String(p[1] != null ? p[1] : p[0]); }
    function buildEdit(m) {
      var ED = window.hkEditMenu, html = '';
      var edRow = function (it, sec, o) {
        S.items.push(it);
        var p = sec === 'rooms' ? it.path : (it.hidden ? it.path : viewPath(it));
        var move = o.grip && ED.movable(it);
        return '<div class="row ed' + (o.hidden ? ' off' : '') + (o.home ? ' home' : '') + '" data-i="' + (S.items.length - 1) +
          '" data-sec="' + sec + '" data-p="' + esc(p) + '"' + (move ? ' data-move' : '') + (o.hidden ? ' data-hidden' : '') +
          '><hk-icon icon="' + esc(glyph(it.icon)) + '"></hk-icon><span>' + esc(it.title) + '</span>' +
          (o.sw ? '<button class="sw" type="button" role="switch" aria-checked="' + !o.hidden + '" aria-label="Show ' +
                  esc(it.title) + ' in the Menu"></button>' : '') +
          (move ? '<button class="grip" type="button" aria-label="Move ' + esc(it.title) +
                  '" aria-description="Drag, or use the up and down arrow keys">' + GRIP + '</button>' : o.home ? '' : '<span class="gap"></span>') +
          '</div>';
      };
      var head = function (sec, title) { return '<div class="sh ed" data-sec="' + sec + '" role="heading" aria-level="2">' + esc(title) + '</div>'; };
      if (m.home) html += edRow(m.home, 'home', { home: true });
      if (m.pages) html += edRow(m.pages, 'home', { home: true });
      html += m.top.map(function (it) { return edRow(it, 'top', { sw: true, grip: true }); }).join('');
      html += head('categories', 'Categories');
      html += m.categories.map(function (it) { return edRow(it, 'categories', { sw: true, grip: true }); }).join('');
      var hid = ED.hidden();
      if (hid.length) html += head('hidden', 'Not in Menu') + hid.map(function (it) { return edRow(it, 'hidden', { sw: true, hidden: true }); }).join('');
      if (m.rooms.length) {
        html += head('rooms', 'Rooms');
        html += m.rooms.map(function (it) { return edRow(it, 'rooms', { grip: m.rooms.length > 1 }); }).join('');
      }
      html += '<p class="ednote">Drag a page by its handle, or hold it, to move it; the tab bar and More follow. ' +
        'Saved when you tap Done.</p>';
      var keep = S.list.scrollTop;
      S.list.innerHTML = html;
      S.list.classList.add('arranging');
      S.list.scrollTop = keep;
      if (window.hkCards.edges) window.hkCards.edges(S.list.parentNode);
      S.built = listKey();
      ED.wireList(S.list, {});
    }

    // THE COUNTS, as Home Assistant's own sidebar keeps them: waiting
    // notifications (every user), and on Settings the updates ready to
    // install plus the repairs not ignored (admins). Subscribed only while a
    // screen shows the section, and painted in place -- a count never
    // rebuilds the list.
    // Through the current client: its subscription port (one per socket, so
    // the same identity across snapshots) and its read path for the repairs.
    var HC = { notif: 0, updates: 0, issues: 0, conn: null, un: [], at: 0 };
    function haCounts(on) {
      var h = C.client(), conn = h && h.subscriptions;
      if (!on || !conn) {
        HC.un.forEach(function (f) { try { f(); } catch (e) { /* gone */ } });
        HC.un = [];
        HC.conn = null;
        return;
      }
      if (HC.conn === conn) return;
      haCounts(false);
      HC.conn = conn;
      var keep = function (p) {
        Promise.resolve(p).then(function (un) {
          if (HC.conn === conn) HC.un.push(un); else { try { un(); } catch (e) { /* gone */ } }
        }, function () { /* refused: no count */ });
      };
      var seen = {};
      keep(conn.subscribeMessage(function (m) {
        if (m.type === 'current') seen = {};
        Object.keys(m.notifications || {}).forEach(function (id) {
          if (m.type === 'removed') delete seen[id]; else seen[id] = 1;
        });
        HC.notif = Object.keys(seen).length;
        paintBadges();
      }, { type: 'persistent_notification/subscribe' }));
      // this user's sidebar order and hidden items (More follows them)
      keep(conn.subscribeMessage(function (m) {
        S.haPrefs = (m && m.value) || null;
        if (docked() && listKey() !== S.built) { build(); markHere(); }
      }, { type: 'frontend/subscribe_user_data', key: 'sidebar' }));
      if (h.user && h.user.is_admin) {
        var issues = function () {
          h.callWS({ type: 'repairs/list_issues' }).then(function (r) {
            HC.issues = ((r && r.issues) || []).filter(function (x) { return !x.ignored; }).length;
            paintBadges();
          }, function () { /* no repairs */ });
        };
        issues();
        // home-assistant-js-websocket's subscribeEvents(cb, type) is exactly this message
        keep(conn.subscribeMessage(function () { clearTimeout(HC.it); HC.it = setTimeout(issues, 500); },
                                   { type: 'subscribe_events', event_type: 'repairs_issue_registry_updated' }));
      }
    }
    // updates: at most every 5 s, as Home Assistant's own sidebar counts them
    function haUpdates(h, now) {
      if (!(h && h.user && h.user.is_admin && h.states)) { HC.updates = 0; return; }
      var t = Date.now();
      if (!now && t - HC.at < 5000) return;
      HC.at = t;
      var n = 0, en = h.entities || {};
      for (var id in h.states) {
        if (id.lastIndexOf('update.', 0) !== 0) continue;
        var st = h.states[id];
        if (st.state === 'on' && ((st.attributes.supported_features || 0) & 1) && !(en[id] && en[id].hidden)) n++;
      }
      if (n !== HC.updates) { HC.updates = n; paintBadges(); }
    }
    function paintBadges() {
      if (!S.list) return;
      var n = { settings: HC.updates + HC.issues, notif: HC.notif };
      S.list.querySelectorAll('.bdg').forEach(function (b) {
        var v = n[b.getAttribute('data-badge')] || 0;
        var txt = v > 99 ? '99+' : String(v);
        if (b.textContent !== txt) b.textContent = txt;
        if (b.hidden !== !v) b.hidden = !v;
      });
    }
    function markHere() {
      if (!S.items) return;
      var rows = S.list.querySelectorAll('.row'), hereRow = null;
      for (var i = 0; i < rows.length; i++) {
        var it = S.items[+rows[i].getAttribute('data-i')];
        var here = !!it && isHere(it, location.pathname);
        rows[i].classList.toggle('here', here);
        if (here) { rows[i].setAttribute('aria-current', 'page'); hereRow = rows[i]; } else rows[i].removeAttribute('aria-current');
      }
      slideHere(hereRow);
      publishHeader();
    }
    // THE HIGHLIGHT GLIDES from the row you were on to the one you are on:
    // the new row's highlight starts over the old row's box (in the list's
    // own coordinates, scroll included, so a rebuilt list still knows where it
    // was) and springs home. Nothing while the menu is out of sight (no box),
    // or when the row has not moved.
    function boxOf(el) {
      var l = S.list.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left - l.left, y: r.top - l.top + S.list.scrollTop, w: r.width, h: r.height };
    }
    function slideHere(el) {
      if (window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) { S.hereBox = null; return; }
      var to = el ? boxOf(el) : null, from = S.hereBox;
      S.hereBox = to;
      if (!from || !to || (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1)) return;
      el.classList.add('slide-from');
      el.style.setProperty('--hx', (from.x - to.x) + 'px');
      el.style.setProperty('--hy', (from.y - to.y) + 'px');
      el.style.setProperty('--sx', String(from.w / to.w));
      el.style.setProperty('--sy', String(from.h / to.h));
      void el.offsetWidth;                      // that start, drawn
      el.classList.remove('slide-from');
      ['--hx', '--hy', '--sx', '--sy'].forEach(function (v) { el.style.removeProperty(v); });
    }

    function onList(e) {
      // Edit mode: a row is arranged, never followed (hk-edit-menu.js)
      if (e.target.closest && e.target.closest('.row.ed,.sh.ed')) return;
      var sh = e.target.closest && e.target.closest('.sh');
      if (sh) {
        var k = sh.getAttribute('data-sec');
        S.shut[k] = !S.shut[k];
        try { localStorage.setItem('hk-menu-shut', JSON.stringify(S.shut)); } catch (x) { /* private */ }
        build();
        markHere();
        return;
      }
      var r = e.target.closest && e.target.closest('.row');
      if (!r || !S.items) return;
      var it = S.items[+r.getAttribute('data-i')];
      if (!it) return;
      if (it.kind === 'ha') { close(true); if (!SH.openHaMenu()) openHaSidebar(); return; }
      // Home Assistant elsewhere: its address
      if (it.kind === 'halink') { close(true); haOpen(it); return; }
      if (it.kind === 'more') {
        S.shut.ha_more = !S.shut.ha_more;
        try { localStorage.setItem('hk-menu-shut', JSON.stringify(S.shut)); } catch (x) { /* private */ }
        build();
        markHere();
        return;
      }
      // EDIT PAGE: the menu goes, the page goes into Edit mode
      if (it.kind === 'edit') {
        close(true);
        if (window.hkEdit && window.hkEdit.enter) window.hkEdit.enter(C.client());
        return;
      }
      // the host's own page (its settings): a full page load
      if (it.kind === 'hostlink') {
        close(true);
        if (it.run) { try { it.run(); } catch (x) { /* the host's own */ } } else location.assign(it.href);
        return;
      }
      // Notifications: Home Assistant's own drawer, over the page
      if (it.kind === 'notif') {
        close(true);
        SH.showNotifications();
        return;
      }
      // A Home Assistant page: kiosk mode is lifted outside the dashboards
      // (syncOutside), so its own sidebar or header is the way back.
      if (it.kind === 'hapage' || it.kind === 'sub') {
        try { sessionStorage.setItem(ESCAPE_KEY, '1'); } catch (x) { /* private mode */ }
        HA.used = true;
        close(true);
        SH.haNavigate(it.path);
        return;
      }
      // The selection moves at once, so the tap is answered before the page is.
      S.list.querySelectorAll('.row.here').forEach(function (x) { x.classList.remove('here'); });
      r.classList.add('here');
      slideHere(r);
      if (!docked()) close(true);
      if (isHere(it, location.pathname)) return;
      // after a frame drawn (hk-base's navigate, no dim): the highlight's
      // slide starts before the new page's work, which holds a wall tablet's
      // main thread for half a second -- or the slide would begin after it
      var N = window.hkCards && window.hkCards.navigate;
      if (N) { N(it.path, null); return; }
      SH.navigate(it.path);
    }

    // ------------------------------------------ Home Assistant's own sidebar
    // THE "HOME ASSISTANT" ROW opens HA's sidebar -- Settings, the other
    // dashboards -- sliding over the page the way HA does it on a phone, even
    // on a wall tablet where kiosk mode hides it. Kiosk mode hides it with one
    // rule in home-assistant-main (the sidebar at 0 width, display none); for
    // as long as the drawer is open a rule of ours lifts that, the drawer is
    // HA's own modal one (its own dimmed backdrop, tap outside or Escape to
    // close) and the sidebar is expanded, labels and all. The moment it
    // closes -- or the page changes -- all three are put back, so kiosk mode
    // is exactly as it was. A phone is no different: kiosk mode hides the
    // sidebar there too.
    var HA = { active: false };
    function haParts() {
      return { main: SH.main(), sr: SH.mainRoot(), drawer: SH.drawer(), sidebar: SH.sidebar() };
    }
    // Home Assistant's sidebar already on screen beside the page (no kiosk
    // mode, a wide window): Show Menu would open what is there.
    function haSidebarShown() {
      if (HA.active) return false;
      // a host that shows the page inside Home Assistant says (its sidebar data)
      var side = sidebarSource();
      if (side && typeof side.shown === 'boolean') return side.shown;
      var p = haParts();
      if (!p.sidebar || !p.drawer || p.drawer.type === 'modal') return false;
      try {
        return getComputedStyle(p.sidebar).display !== 'none' && p.sidebar.getBoundingClientRect().width > 0;
      } catch (e) { return false; }
    }
    function openHaSidebar() {
      var p = haParts();
      if (!p.drawer || !p.sidebar || HA.active) return;
      try { sessionStorage.setItem(ESCAPE_KEY, '1'); } catch (e) { /* private mode */ }
      // Two rules to lift: kiosk mode hides the sidebar in home-assistant-main
      // and, on a phone, HA's drawer as well, inside ha-drawer.
      var T = SH.tags;
      var lift = liftRule(p.sr, ':host{--ha-sidebar-width:256px !important;--mdc-drawer-width:256px !important}' +
                             T.drawer + ' > ' + T.sidebar + '{display:flex !important}');
      var lift2 = p.drawer.shadowRoot ? liftRule(p.drawer.shadowRoot, 'wa-drawer[open]{display:block !important}') : null;
      // HK Frontend's own hiding (hk-kiosk.js) steps aside the same way
      if (window.hkKiosk) window.hkKiosk.hold(true);
      HA = { active: true, used: true, type: p.drawer.type, expand: p.sidebar.alwaysExpand, p: p, lift: [lift, lift2] };
      p.drawer.type = 'modal';
      p.sidebar.alwaysExpand = true;
      requestAnimationFrame(function () { requestAnimationFrame(function () { p.drawer.open = true; }); });
      // HA's drawer says it has closed by clearing `open`: watched, cheaply,
      // only while it is up.
      var seen = false;
      HA.poll = setInterval(function () {
        if (p.drawer.open) { seen = true; return; }
        if (seen) restoreHaSidebar();
      }, 250);
      HA.nav = function () { if (p.drawer.open) p.drawer.open = false; setTimeout(restoreHaSidebar, 350); };
      SH.onNavigate(HA.nav);
    }
    // OUTSIDE THE DASHBOARDS, HOME ASSISTANT IS HOME ASSISTANT.
    // kiosk-mode's rules outlive the dashboard that set them: open Settings
    // from the Home Assistant section and its sidebar stays hidden there, with no
    // way back but a reload -- and on a phone its ☰ opens a drawer kiosk mode
    // also hides. So once this browser has used the row (this session), every
    // page that is NOT a dashboard gets kiosk mode's rules switched off --
    // HA's own sidebar, or its ☰, is the way back -- and they are switched on
    // again the moment a dashboard is back. The rules are disabled in place
    // (media="not all"), never removed, so kiosk-mode's own bookkeeping is
    // untouched. A screen that never had the row -- a wall tablet -- never
    // gets here.
    var ESCAPE_KEY = 'hk-ha-row-used';
    function rowUsed() {
      try { return sessionStorage.getItem(ESCAPE_KEY) === '1'; } catch (e) { return !!HA.used; }
    }
    function onDashboard() { return SH.onDashboard(); }
    function kioskRules() {
      var p = haParts(), out = [];
      [p.sr, p.drawer && p.drawer.shadowRoot].forEach(function (root) {
        if (root) out = out.concat([].slice.call(root.querySelectorAll('style[id^="kiosk_mode"]')));
      });
      return out;
    }
    function syncOutside() {
      var free = rowUsed() && !onDashboard();
      kioskRules().forEach(function (st) {
        if (free && st.getAttribute('data-hk-media') === null) {
          st.setAttribute('data-hk-media', st.getAttribute('media') || '');
          st.setAttribute('media', 'not all');
        } else if (!free && st.getAttribute('data-hk-media') !== null) {
          var m = st.getAttribute('data-hk-media');
          if (m) st.setAttribute('media', m); else st.removeAttribute('media');
          st.removeAttribute('data-hk-media');
        }
      });
    }
    function onPageChange() { syncOutside(); setTimeout(syncOutside, 150); setTimeout(syncOutside, 800); }

    function restoreHaSidebar() {
      if (!HA.active) return;
      var h = HA;
      HA = { active: false, used: true };
      clearInterval(h.poll);
      SH.offNavigate(h.nav);
      // after the drawer's own close animation, so it does not snap shut
      setTimeout(function () {
        try { h.p.drawer.type = h.type || ''; h.p.sidebar.alwaysExpand = !!h.expand; } catch (e) { /* gone */ }
        h.lift.forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
        if (window.hkKiosk) window.hkKiosk.hold(false);
      }, 300);
    }
    function liftRule(root, css) {
      var el = root.querySelector('style#hk-ha-sidebar') || document.createElement('style');
      el.id = 'hk-ha-sidebar';
      el.textContent = css;
      if (!el.parentNode) root.appendChild(el);
      return el;
    }

    // ----------------------------------------------------- open and close
    function open() {
      if (!M.on() || docked()) return;
      if (!mount()) return;
      if (listKey() !== S.built) build();
      markHere();
      S.open = true;
      sync();
      armIdle();
      var here = S.list.querySelector('.row.here');
      // A room far down the list is brought into view, not left off-screen.
      if (here && here.offsetTop > S.list.clientHeight - 60) {
        S.list.scrollTop = here.offsetTop - S.list.clientHeight / 2 + 22;
      }
    }
    // byKey: closed from the keyboard (Escape, or the tab pressed with a key),
    // which alone takes the focus back to the tab -- where a keyboard user
    // was. A tap never does: the tab would hold the focus with no one
    // looking, and the Home Assistant app's web view draws the focus ring
    // round it now and then (a white stroke, 2026-10-04). Focus a tap left
    // on the tab is let go of too.
    function close(quiet, byKey) {
      if (!S.open) return;
      S.open = false;
      clearTimeout(S.idle);
      sync();
      if (!S.tab) return;
      if (byKey && !quiet && S.root.classList.contains('tabbed')) S.tab.focus({ preventScroll: true });
      else if (S.host && S.host.shadowRoot && S.host.shadowRoot.activeElement === S.tab) S.tab.blur();
    }
    function toggle(byKey) { if (S.open) close(false, byKey); else open(); }
    function armIdle() {
      clearTimeout(S.idle);
      // (not while it is being arranged: Edit mode has its own Done)
      if (S.open && !arranging()) S.idle = setTimeout(function () { close(true); }, IDLE_MS);
    }

    // SWIPE IT AWAY, the iPad gesture: a drag that starts on the panel and
    // travels left more than it travels down closes it. Vertical drags are
    // the list's to scroll.
    function wireSwipe() {
      var g = null;
      S.panel.addEventListener('pointerdown', function (e) {
        if (!S.open || e.pointerType === 'mouse') return;
        g = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }, { passive: true });
      S.panel.addEventListener('pointermove', function (e) {
        if (!g || e.pointerId !== g.id) return;
        var dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
        if (dx < -48 && Math.abs(dx) > 1.5 * Math.abs(dy)) { g = null; close(true); }
      }, { passive: true });
      ['pointerup', 'pointercancel'].forEach(function (t) {
        S.panel.addEventListener(t, function () { g = null; }, { passive: true });
      });
    }

    // ------------------------------------------------ the edge swipe
    // SWIPE FROM THE LEFT EDGE (the screen's Swipe from Left Edge, hk-base.js
    // menu.swipe()), the iPad gesture the other way: a drag that starts in
    // the page's left margin -- the strip (.edge) -- or on the edge tab, and
    // travels right more than it travels down, pulls the menu out under the
    // finger, as the Home app's sidebar and Android's drawer do; let go past
    // a third of it, or flicked, and it opens, otherwise it slides back. Any
    // width, any button style (No Button relies on it).
    //
    // A strip of its own, not a listener on the page: its touch-action keeps
    // the sideways drag from the browser (no back swipe, no scroll, the
    // events keep coming), and the tiles never see a touch that was a swipe.
    // As wide as the page's margin -- 2% + 4 px, 16 px on a phone -- so it
    // covers nothing that can be tapped; it sits under the pop-ups and
    // sheets (the root's z-index), which cover it while they are up.
    var EDGE_MIN = 14, EDGE_MAX = 24;
    function edgeWidth(pw) {
      if ((window.innerWidth || 1280) < M.NARROW) return 16;
      return Math.round(Math.max(EDGE_MIN, Math.min(EDGE_MAX, 0.02 * pw + 4)));
    }
    function swipeOn() { return typeof M.swipe === 'function' && !!M.swipe(); }
    // A FINGER IS FOLLOWED BY ITS TOUCH EVENTS, never by pointer capture.
    // On an iPhone (the Home Assistant app, 2026-10-04) a captured touch was
    // never let go: the lift did not reach the strip, WebKit kept every later
    // touch on it -- hidden or not -- and nothing on the page could be tapped
    // again (the menu's rows, the scrim, then the whole dashboard) until a
    // reload, while scrolling, which is the browser's own, still went to the
    // page. A touch's events go to where it started without any capture, and
    // always end in touchend or touchcancel. A mouse (or pen) uses pointer
    // events and the capture, which ends with its button.
    function wireEdge(el) {
      el.addEventListener('touchstart', function (e) {
        if (S.drag) finishDrag();          // one that never heard its end: settle it first
        if (e.touches.length !== 1) return;
        var t = e.changedTouches[0];
        startDrag(el, t.clientX, t.clientY, 't' + t.identifier);
      }, { passive: true });
      // THE PAGE HOLDS STILL UNDER A SWIPE: touch-action pan-y lets the
      // browser scroll the up-and-down part of any drag, and a thumb's arc
      // (about 40 degrees) scrolled the page some hundreds of px behind the
      // opening menu. A finger the menu follows -- one that has made a swipe
      // (swipeStarts, the same test that pulls the menu out) -- keeps the
      // page still; anything short of that is left to the browser, so a
      // scroll that starts here with a wobble to the right still scrolls
      // (WebKit lets a touch scroll no more once one of its moves is
      // cancelled). Only touches that start here (16-24 px of margin) are
      // held -- this listener is the strip's own.
      el.addEventListener('touchmove', function (e) {
        var g = S.drag, t = g && ours(e.changedTouches);
        if (!t) return;
        if (g.live || swipeStarts(t.clientX - g.x, t.clientY - g.y)) e.preventDefault();
      }, { passive: false });
      el.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'touch') return;     // the touch events above have it
        if (S.drag) finishDrag();
        if (e.button !== 0) return;
        if (startDrag(el, e.clientX, e.clientY, e.pointerId)) {
          try { el.setPointerCapture(e.pointerId); } catch (x) { /* already gone */ }
          S.drag.captured = true;
        }
      });
    }
    function startDrag(el, x, y, id) {
      if (S.open || docked() || !swipeOn()) return false;
      // the tab answers a tap on its own (and the panel's swipe closes it)
      S.drag = { x: x, y: y, id: id, el: el, live: false, w: W, dx: 0, trail: [] };
      S.edgeAt = Date.now();
      follow(true);
      return true;
    }
    // The rest of the gesture, heard at the document, and ended by any of
    // its ends: the finger lifted or cancelled, the mouse button up, a new
    // touch or press anywhere, or a drag gone quiet (DRAG_IDLE).
    var DRAG_IDLE = 4000;
    var DRAG_EVENTS = { touchstart: onTouchOther, touchmove: onTouchMove, touchend: onTouchEnd, touchcancel: onTouchEnd,
                        pointermove: onPointerMove, pointerup: onPointerEnd, pointercancel: onPointerEnd,
                        pointerdown: onPointerOther };
    function follow(on) {
      Object.keys(DRAG_EVENTS).forEach(function (t) {
        if (on) document.addEventListener(t, DRAG_EVENTS[t], { capture: true, passive: true });
        else document.removeEventListener(t, DRAG_EVENTS[t], { capture: true, passive: true });
      });
      quiet(on);
    }
    function quiet(on) {
      clearTimeout(S.dragIdle);
      if (on) S.dragIdle = setTimeout(function () { finishDrag(); }, DRAG_IDLE);
    }
    function ours(list) {
      for (var i = 0; list && i < list.length; i++) if ('t' + list[i].identifier === S.drag.id) return list[i];
      return null;
    }
    function onTouchMove(e) {
      var t = S.drag && ours(e.changedTouches);
      if (t) dragTo(t.clientX, t.clientY);
    }
    function onTouchOther(e) { if (S.drag && !ours(e.changedTouches)) finishDrag(); }
    function onTouchEnd(e) {
      if (!S.drag) return;
      if (ours(e.changedTouches) || !(e.touches && e.touches.length)) finishDrag();
    }
    function onPointerMove(e) { if (S.drag && e.pointerId === S.drag.id) dragTo(e.clientX, e.clientY); }
    function onPointerEnd(e) { if (S.drag && e.pointerId === S.drag.id) finishDrag(); }
    // a press elsewhere (a mouse's, or a touch the drag is not following)
    function onPointerOther(e) {
      if (S.drag && e.pointerId !== S.drag.id && !(e.pointerType === 'touch' && String(S.drag.id).charAt(0) === 't')) finishDrag();
    }
    // WHAT COUNTS AS A SWIPE, AND AS A FLICK (2026-10-04, "it doesn't always
    // trigger"):
    //   the start -- right at least SWIPE_SLOPE times as far as up or down
    //     (about 40 degrees: a thumb swings in an arc; it was 1.5, 34
    //     degrees). One that goes more up or down than across, past 12 px,
    //     is the page's scroll.
    //   the flick -- its speed over the last FLICK_MS of the finger, as the
    //     Home app's and Android's drawers measure it: a finger slows just
    //     before it lifts, and the last move alone made a quick swipe read as
    //     a slow one, so the panel slid back. A finger that stopped before
    //     lifting has no speed. FLICK_V and at least FLICK_MIN px open it.
    var SWIPE_SLOPE = 1.2, SWIPE_MIN = 10, FLICK_MS = 100, FLICK_V = 0.3, FLICK_MIN = 24;
    // the one test for "this is a swipe": the menu comes out, and the page
    // is held still, from the same move (dx right, dy down, from the start)
    function swipeStarts(dx, dy) { return dx >= SWIPE_MIN && dx >= SWIPE_SLOPE * Math.abs(dy); }
    function dragTo(cx, cy) {
      var g = S.drag;
      quiet(true);
      var dx = cx - g.x, dy = cy - g.y;
      if (!g.live) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { endDrag(false); return; }
        if (!swipeStarts(dx, dy)) return;
        // it is a swipe: the list is made ready as the panel comes out
        if (listKey() !== S.built) build();
        markHere();
        g.live = true;
        g.w = (S.panel.getBoundingClientRect().width) || W;
        S.root.classList.add('dragging');
        S.panel.setAttribute('aria-hidden', 'false');
      }
      var d = Math.max(0, Math.min(g.w, dx - SWIPE_MIN));
      g.dx = d;
      g.trail.push({ t: Date.now(), d: d });
      if (g.trail.length > 8) g.trail.shift();
      S.panel.style.transform = 'translateX(' + (d - g.w) + 'px)';
      S.scrim.style.opacity = String(d / g.w);
    }
    // px/ms rightward over the finger's last FLICK_MS (and the move before,
    // where moves come further apart); 0 once it has stood still that long
    function flickSpeed(g) {
      var tr = g.trail, n = tr.length, last = tr[n - 1];
      if (n < 2 || Date.now() - last.t > FLICK_MS) return 0;
      var i = n - 1;
      while (i > 0 && last.t - tr[i - 1].t <= FLICK_MS) i--;
      if (i === n - 1) i = n - 2;
      return (last.d - tr[i].d) / Math.max(16, last.t - tr[i].t);
    }
    // where it was left decides: past a third, or flicked, it opens
    function finishDrag() {
      var g = S.drag;
      endDrag(!!g && g.live && (g.dx > g.w / 3 || (g.dx >= FLICK_MIN && flickSpeed(g) > FLICK_V)));
    }
    // Let go: open from where the finger left it, or slide back. The classes
    // change first (sync drops `dragging`, open adds `open`), then the inline
    // drag styles go, so the panel's own transition carries it the rest of
    // the way either way.
    function endDrag(opens) {
      var g = S.drag;
      S.drag = null;
      follow(false);
      if (!g) return;
      S.edgeAt = Date.now();
      if (g.captured) { try { g.el.releasePointerCapture(g.id); } catch (x) { /* already released */ } }
      if (!g.live) return;
      S.pulled = Date.now();
      // (from where the finger left it, at the speed it was going, for this one move: hk-drag.js)
      var H = window.hkDrag, c = H && H.curve ? H.curve(g.dx - g.w, opens ? 0 : -g.w, flickSpeed(g)) : null;
      if (c && c.ms) {
        var tr = c.ms + 'ms ' + c.ease;
        S.panel.style.transition = 'transform ' + tr + ',box-shadow ' + tr;
        S.scrim.style.transition = 'opacity ' + tr;
        clearTimeout(S.pulledT);
        S.pulledT = setTimeout(function () { S.panel.style.transition = ''; S.scrim.style.transition = ''; }, c.ms + 60);
      }
      if (opens) open(); else sync();
      S.panel.style.transform = '';
      S.scrim.style.opacity = '';
    }

    // ------------------------------------- Home Assistant's hidden drawer
    // THE HOME ASSISTANT APP HAS A LEFT-EDGE SWIPE OF ITS OWN (its Gestures:
    // Swipe Right, "Show Sidebar" by default), and it sends the page
    // `sidebar/show`. Where Home Assistant's sidebar is hidden (kiosk mode,
    // HK's or the plugin's) that opens its drawer all the same: a modal no
    // one can see, and the whole page goes inert under it -- measured, a tap
    // mid-screen lands on <html class="wa-scroll-lock"> -- until a reload.
    // On an iPhone it came with every Swipe from Left Edge (2026-10-04).
    //
    // So a drawer that opens while the sidebar is hidden, and not for the
    // menu's own Show Menu (HA.active), is closed again at once: the screen
    // keeps its sidebar hidden, as it chose. If it came with the edge swipe,
    // the screen says once (per session) what to change in the app; the app
    // tells the page nothing of its gestures, so this is when it can know.
    var GUARD = { drawer: null, mo: null };
    var TOLD_KEY = 'hk-app-swipe-told';
    function guardDrawer() {
      if (!window.MutationObserver) return;
      var p = haParts();
      if (!p.drawer || GUARD.drawer === p.drawer) return;
      if (GUARD.mo) GUARD.mo.disconnect();
      GUARD.drawer = p.drawer;
      GUARD.mo = new MutationObserver(function () { if (p.drawer.open) unseenDrawer(); });
      GUARD.mo.observe(p.drawer, { attributes: true, attributeFilter: ['open'] });
    }
    // ONLY WHERE THIS PAGE HIDES THE SIDEBAR: a dashboard whose screen hides
    // it (hk-kiosk.js says so; the Kiosk Mode plugin's, by the sidebar's own
    // look). Never on Home Assistant's own pages -- there its sidebar is the
    // way round, and on a phone, where it is a drawer, the sidebar is still 0 px
    // wide at the moment the drawer starts opening, which read as hidden and
    // shut it again at once (2026-10-05).
    function unseenDrawer() {
      if (HA.active || !onDashboard()) return;
      var K = window.hkKiosk, ks = K && typeof K.state === 'function' ? K.state() : null;
      if (ks && !ks.sidebar) return;
      var p = haParts();
      if (!p.drawer || !p.sidebar) return;
      if (ks && ks.sidebar) { p.drawer.open = false; if (S.drag || Date.now() - (S.edgeAt || 0) < 2500) tellAppSwipe(); return; }
      var hidden;
      try { hidden = getComputedStyle(p.sidebar).display === 'none' || p.sidebar.getBoundingClientRect().width === 0; }
      catch (e) { return; }
      if (!hidden) return;
      p.drawer.open = false;
      if (S.drag || Date.now() - (S.edgeAt || 0) < 2500) tellAppSwipe();
    }
    function tellAppSwipe() {
      try { if (sessionStorage.getItem(TOLD_KEY)) return; sessionStorage.setItem(TOLD_KEY, '1'); } catch (e) { /* private */ }
      SH.toast({
        message: 'The Home Assistant app’s own swipe opens its sidebar too. In the app, set Settings → ' +
                 'Companion App → Gestures → Swipe Right to None.', duration: 12000 });
    }

    // the Now Playing pane's widths, as hk-popup.js wrote them on <html>
    // (its own style: read there, never through getComputedStyle)
    function paneSides() {
      var st = document.documentElement && document.documentElement.style;
      var g = function (k) { var n = st ? parseFloat(st.getPropertyValue(k)) : 0; return n > 0 ? n : 0; };
      return { l: g('--hk-pane-l'), r: g('--hk-pane-r') };
    }
    // DOCKED (Menu: "Always open beside the page"): the panel stays beside
    // the page and the view is pushed right by its width.
    function viewEl() { return SH.viewSlot(M.panel()); }
    // ...AND BESIDE THE NOW PLAYING PANE (hk-popup.js publishes its width
    // on <html> as --hk-pane-l / --hk-pane-r while it is up): the view is
    // narrowed by it on its side, so the page lays itself out in what is
    // left -- the iPad band and all (publishLeft). A left pane sits right of
    // a docked menu. The one writer of the view's side margins.
    function dockTo() { room(true); }
    function undock() { room(false); }
    function room(dock) {
      var v = viewEl(), p = paneSides();
      var ml = (dock ? W : 0) + p.l, mr = p.r;
      if (S.docked && S.docked !== v) { S.docked.style.marginLeft = ''; S.docked.style.marginRight = ''; S.docked = null; }
      if (!v) return;
      var l = ml ? ml + 'px' : '', r = mr ? mr + 'px' : '';
      if (v.style.marginLeft !== l) v.style.marginLeft = l;
      if (v.style.marginRight !== r) v.style.marginRight = r;
      S.docked = (l || r) ? v : null;
    }

    // what the shell and the later parts use of this one
    K.build = build; K.close = close; K.docked = docked; K.haUpdates = haUpdates; K.listKey = listKey;
    K.markHere = markHere; K.onPageChange = onPageChange; K.open = open; K.openHaSidebar = openHaSidebar;
    K.paintNow = paintNow; K.place = place; K.room = room; K.S = S; K.scrolled = scrolled; K.sync = sync;
    K.toggle = toggle;
  };
})();
