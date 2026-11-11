// hk-base-menu.js - Lovelace's panel, the menu's widths and state, Now Playing's grace.
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-menu'] = function (K) {
    var ACCENTS = K.ACCENTS, boardOf = K.boardOf, dashSeg = K.dashSeg, flatColor = K.flatColor,
        flatPalette = K.flatPalette, legacyAccentHex = K.legacyAccentHex, MENU_DOCK = K.MENU_DOCK,
        msetting = K.msetting, pageAccent = K.pageAccent, ST = K.ST;

    function panelLovelace() {
      if (ST.panelKept && ST.panelKept.isConnected) {
        var lv = ST.panelKept.lovelace, up = lv && lv.urlPath;
        if (!up || up === dashSeg()) return ST.panelKept;
      }
      ST.panelKept = window.hkShell.panel();
      return ST.panelKept;
    }
    function lovelaceConfig() { return window.hkShell.dashboardConfig(panelLovelace()); }
    var MENU_NARROW = 640;
    // A PHONE (the screen's Phones menu settings): a window under MENU_NARROW,
    // or a device whose screen's shorter side is under PHONE_SIDE -- a phone
    // held sideways (iPhones 375-440, Android phones 360-412) is still one.
    // The device's screen, not the window: an iPad mini (744), a 1024 x 600
    // tablet and the 1280 x 800 wall tablets stay tablets either way up, and a
    // short desktop window is never a phone.
    var PHONE_SIDE = 500;
    function menuNarrow() {
      if ((window.innerWidth || 1280) < MENU_NARROW) return true;
      var sc = window.screen, a = sc && Number(sc.width), b = sc && Number(sc.height);
      return a > 0 && b > 0 && Math.min(a, b) < PHONE_SIDE;
    }
    // THE EDGE TAB NEEDS A MARGIN TO LIVE IN: 26 px of it, beside a page
    // margin of 2% + 4 px -- 29.6 px on a 1280 wall tablet, 26.7 on an iPad
    // held sideways, but 18.9 on an iPad mini held upright, where the tab would
    // lie against the first chip and the weather. Below 1,024
    // px the dashboard uses the round button instead, as a phone always has.
    var TAB_MIN = 1024;
    function dockMin() {
      var v = Number(boardOf(dashSeg()).dock_min);
      return isFinite(v) && v > 0 ? v : MENU_DOCK;
    }
    // White over the highlight, as Apple draws it over orange, green and teal
    // (contrast with white ~1.9-2.1); black over the pale ones -- yellow, mint,
    // cyan, a light colour of your own -- where white falls under 1.8.
    function accentText(hex) {
      var c = [1, 3, 5].map(function (i) {
        var v = parseInt(hex.substr(i, 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      var L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      return 1.05 / (L + 0.05) >= 1.8 ? '#fff' : '#000';
    }
    function panelWidth() {
      var p = panelLovelace(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
      return (r && r.width) || window.innerWidth || 0;
    }
    // Anywhere in a view's config: a chip row's `lead:`, a grid's `cards:`, a
    // conditional's `card:`. Bounded, because a config is data we did not write.
    function holdsCard(node, type, depth) {
      if (!node || typeof node !== 'object' || depth > 12) return false;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) if (holdsCard(node[i], type, depth + 1)) return true;
        return false;
      }
      if (node.type === type) return true;
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k) && typeof node[k] === 'object' &&
            holdsCard(node[k], type, depth + 1)) return true;
      }
      return false;
    }
    // A MENU BUTTON IN A VIEW: written out, or the chips card's -- hk-chips-card
    // puts one at the start of its row unless its `lead` is false (hk-chip.js).
    // Counting only a written-out one, hk-menu.js would find no button on a
    // phone's Home whose chip row is hk-chips-card, and pin its own round one
    // over the weather: two menu buttons.
    function holdsMenuButton(node, depth) {
      if (!node || typeof node !== 'object' || depth > 12) return false;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) if (holdsMenuButton(node[i], depth + 1)) return true;
        return false;
      }
      if (node.type === 'custom:hk-menu-button-card') return true;
      if (node.type === 'custom:hk-chips-card' && node.lead !== false &&
          (!node.lead || holdsMenuButton(node.lead, depth + 1))) return true;
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k) && typeof node[k] === 'object' &&
            holdsMenuButton(node[k], depth + 1)) return true;
      }
      return false;
    }
    // THE PHONES MENU, WHERE THE TABLETS' DOESN'T FIT (2026-10-09): a
    // tablet or computer whose own menu has no room -- an always-open menu
    // under Keep Open Down To, a button under TAB_MIN (the edge tab has no
    // margin there) -- shows the screen's Phones menu instead, with all of
    // Phones' settings: an iPad held upright, Split View, a narrow window.
    // The tab bar fits at every width, so a tablets' Tab Bar never folds.
    function compact() {
      if (menuNarrow()) return false;
      var m = boardOf(dashSeg()).menu;
      if (m === 'off' || m === 'tabbar') return false;
      return m === 'open' ? panelWidth() < dockMin() : (window.innerWidth || 1280) < TAB_MIN;
    }
    // Phones' menu and settings here: a phone, or a tablet whose menu doesn't fit
    function phoneForm() { return menuNarrow() || compact(); }
    // NOW PLAYING HERE (2026-10-15; All Screens -> Now Playing, a screen's
    // np_* over it): { phone, style: 'pane' | 'bar', side: 'right' | 'left',
    // bar: 'bottom' | 'top' }. A phone always has the bar, at Phones' place.
    // Whether a pane FITS is the pop-up's to say (hk-popup.js): it knows the
    // page's width beside it, a docked menu and Home Assistant's sidebar taken.
    var NP_DEFAULT = { style: 'bar', side: 'right', bar: 'bottom', bar_phone: 'bottom' };
    // ...AND HOW LONG IT STAYS once the music is paused or stopped, in seconds
    // (All Screens -> Now Playing -> Hide After a Pause): the bar, the pane and
    // the screensaver's music alike, each held longer while it is in use
    var NP_GRACES = [10, 20, 30, 60, 120];
    function npGrace() {
      var g = Number((msetting('now_playing', null) || {}).grace);
      return NP_GRACES.indexOf(g) >= 0 ? g : 30;
    }
    function nowPlaying() {
      var b = boardOf(dashSeg()), h = msetting('now_playing', null) || {};
      var pick = function (k, hk, ok) {
        return ok.indexOf(b[k]) >= 0 ? b[k] : ok.indexOf(h[hk]) >= 0 ? h[hk] : NP_DEFAULT[hk];
      };
      var bars = ['bottom', 'top'];
      if (menuNarrow()) return { phone: true, style: 'bar', side: 'right', bar: pick('np_bar_phone', 'bar_phone', bars) };
      return { phone: false, style: pick('np_style', 'style', ['pane', 'bar']), side: pick('np_side', 'side', ['right', 'left']),
               bar: pick('np_bar', 'bar', bars) };
    }
    // THE BUTTON'S STYLE where Phones' menu shows (button_phone): the chip,
    // the chip then the tab once scrolled past, the tab, or no button at all
    // (the swipe alone).
    function narrowStyle() {
      var n = boardOf(dashSeg()).button_phone;
      if (n === 'none') return swipeOn() ? 'none' : 'chip';
      return n === 'tab' || n === 'chip_scroll' ? n : 'chip';
    }
    // NO BUTTON leans on the swipe: with the swipe off it is never left with
    // no way in -- the button style is Automatic's, the phone's the chip.
    function swipeOn() { return !!boardOf(dashSeg()).swipe; }
    function folded() { return phoneForm(); }
    // Is Home the page showing? (its path, or none, or 0)
    function homeHere() {
      var here = String(location.pathname).split('/')[2] || '';
      var cfg = lovelaceConfig(), v0 = cfg && cfg.views && cfg.views[0];
      return !here || here === '0' || !!(v0 && v0.path === here);
    }
    var CHIPS = new Set();
    function homeHasButton() {
      var cfg = lovelaceConfig();
      if (!cfg) return false;
      if (ST.homeButton.cfg !== cfg) {
        var v0 = cfg.views && cfg.views[0];
        ST.homeButton = { cfg: cfg, v: !!v0 && holdsMenuButton(v0, 0) };
      }
      return ST.homeButton.v;
    }
    // A view is a ROOM PAGE when it names an area: `area:` (one, or a list for
    // a room that spans two -- a backyard and its deck), or the room strategy's.
    function areasOfView(v) {
      var a = v && (v.area || (v.strategy && v.strategy.area));
      return a ? [].concat(a).filter(Boolean) : [];
    }
    function roomIndex(area) {
      var cfg = lovelaceConfig();
      if (!cfg || !Array.isArray(cfg.views)) return null;
      if (ST.roomPages.cfg !== cfg) {
        var map = {};
        cfg.views.forEach(function (v, i) {
          if (!i) return;                            // Home is never a room page
          areasOfView(v).forEach(function (a) { if (!(a in map)) map[a] = i; });
        });
        ST.roomPages = { cfg: cfg, map: map };
      }
      var i = ST.roomPages.map[area];
      return i === undefined ? null : i;
    }
    var dateLines = {};
    // v2: measured from the top of the PAGE (under any Home Assistant toolbar),
    // not of the panel -- a first load paints the toolbar for a moment before
    // kiosk mode hides it, and a v1 value taken then sat 56 px low.
    var DATE_KEY = 'hk-menu-date2:';
    // THE TOP OF THE PAGE AT REST, in the viewport, scroll or no scroll: the
    // dashboard panel's top plus Home Assistant's toolbar while it shows (kiosk
    // mode hides it). The document is what scrolls, so the panel's own rect
    // moves with it and the scroll has to be added back. Without it a menu sync
    // while the page is scrolled (any change in the page's height is one) puts
    // the edge tab that far up, and it stays there: measured, tab top 87 at
    // rest, -313 after a sync at scrollY 400, still -313 back at the top.
    function viewTop() {
      var p = panelLovelace();
      if (!p || !p.getBoundingClientRect) return 0;
      var top = p.getBoundingClientRect().top + (window.scrollY || 0);
      try {
        var h = window.hkShell.toolbar(p);
        if (h && getComputedStyle(h).display !== 'none') top += h.getBoundingClientRect().height;
      } catch (e) { /* no toolbar to find */ }
      return top;
    }
    // THE TAB BAR (hk-tabbar.js) IS THE MENU'S OTHER FORM, never beside it:
    // the tablets' Menu "tabbar" is the bar at every width and no side menu,
    // and Phones' Menu "tabbar" the bar on a phone and wherever the tablets'
    // menu doesn't fit (compact). Wherever the bar shows, the side menu is
    // off: no chip, no tab, no swipe, no clock tap.
    //
    // PHONES' MENU (menu_phone): off, a button (in button_phone's style) or
    // the tab bar -- never always open. Unset (a screen from before phones had
    // their own; settings.py phones_lifted writes it down): the tablets' Menu
    // when that is off or the tab bar, else a button.
    function phoneMenu(b) {
      var m = b.menu_phone;
      if (m === 'off' || m === 'button' || m === 'tabbar') return m;
      return b.menu === 'off' || b.menu === 'tabbar' ? b.menu : 'button';
    }
    // ...and where a tablet borrows it: Off would leave it with no way in at
    // all, so it is the chip
    function phoneMenuHere(b) {
      var m = phoneMenu(b);
      return m === 'off' && !menuNarrow() ? 'button' : m;
    }
    function sideMenu() {
      var b = boardOf(dashSeg());
      if (phoneForm()) return phoneMenuHere(b) === 'button';
      return b.menu !== 'off' && b.menu !== 'tabbar';
    }
    function dockedHere() {
      if (phoneForm()) return false;
      return boardOf(dashSeg()).menu === 'open' && panelWidth() >= dockMin();
    }
    function tabBarHere() {
      var b = boardOf(dashSeg());
      if (phoneForm()) return phoneMenuHere(b) === 'tabbar';
      return b.menu === 'tabbar';
    }
    var menuState = {
      // this dashboard's own settings (boardOf above)
      board: function () { return Object.assign({}, boardOf(dashSeg())); },
      on: function () { return sideMenu() && !tabBarHere(); },
      // the tab bar shows here, in the menu's place
      tabBar: tabBarHere,
      // a phone, by its width or its screen (menuNarrow): a phone's shape
      // (the tab bar's height, its fit, no rail)
      phone: menuNarrow,
      // Phones' menu and settings here: a phone, or a tablet whose own menu
      // doesn't fit (compact)
      phoneForm: phoneForm,
      compact: compact,
      // Phones' menu for a screen's settings `b`, as it resolves ('off',
      // 'button' or 'tabbar') -- HK Settings names what Automatic does
      phoneMenu: phoneMenu,
      // Shown beside the page all the time (its item's Menu: "Always open
      // beside the page"), when there is room for it.
      docked: dockedHere,
      // The time, date and weather at the top of the menu (its item's "Time
      // and weather": in the menu) -- only while it is docked here; the Home
      // header (hk-weather.js) steps aside for it.
      hasTime: function () {
        return menuState.docked() && boardOf(dashSeg()).time_weather === 'menu';
      },
      // 'tab', 'chip', or 'docked' -- a menu that is always there needs no
      // button at all: no tab, no chip, no round button beside the chevron.
      // Where the tablets' menu doesn't fit (folded: a phone, an always-open
      // menu under Keep Open Down To, a button under TAB_MIN) it is Phones'
      // button style (narrowStyle above).
      //
      // TWO MIXES:
      //   chip_scroll  the chip everywhere; the edge tab slides in while the
      //                chip is scrolled out of sight
      //   chip_home    the chip on Home (sliding to the tab the same way), the
      //                tab on every other page
      // Where the tab has no room (under TAB_MIN) Phones' button style decides.
      // 'none': no button at all -- the swipe (and the clock) open it.
      style: function () {
        if (!menuState.on()) return null;
        if (menuState.docked()) return 'docked';
        if (folded()) { var n = narrowStyle(); return n === 'tab' || n === 'none' ? n : 'chip'; }
        var b = boardOf(dashSeg()).menu;
        if (b === 'none' && swipeOn()) return 'none';
        if (b === 'chip' || b === 'tab') return b;
        if (b === 'chip_scroll') return 'chip';
        if (b === 'chip_home') return homeHere() ? 'chip' : 'tab';
        return homeHasButton() ? 'chip' : 'tab';
      },
      // Does a round button draw at this card? where: 'home' -- the menu chip
      // (hk-menu-button-card, Home's chip row lead); 'page' -- beside a
      // sub-page's back chevron. Answered by the CARD'S place, not the page
      // showing: Home's view stays cached while a sub-page is up, and must
      // come back with its chip.
      round: function (where) {
        var s = menuState.style();
        if (s !== 'chip' && s !== 'tab') return false;
        if (folded()) return narrowStyle() !== 'tab';
        if (boardOf(dashSeg()).menu === 'chip_home') return where === 'home';
        return s === 'chip';
      },
      // The edge tab here: 'always', 'scrolled' (only while every round button
      // on the page is out of sight -- hk-menu.js watches them) or 'never'.
      tab: function () {
        var s = menuState.style();
        if (s === 'tab') return 'always';
        if (s !== 'chip') return 'never';
        if (folded()) return narrowStyle() === 'chip_scroll' ? 'scrolled' : 'never';
        var b = boardOf(dashSeg()).menu;
        return b === 'chip_scroll' || b === 'chip_home' ? 'scrolled' : 'never';
      },
      // The round buttons on the page now (their <hk-plate>s), for the
      // scrolled tab. A card that draws one hands itself over when it draws or
      // is attached again (a cached view comes back without drawing), and takes
      // itself back when it leaves the page (chipGone) -- held any longer, every
      // card a rebuild or a chip-row replan discarded stayed alive with the
      // whole state snapshot it last had (4,195 entities).
      chipShown: function (card) {
        if (!card) return;
        CHIPS.add(card);
        window.dispatchEvent(new CustomEvent('hk-menu-chip'));
      },
      chipGone: function (card) { CHIPS.delete(card); },
      chips: function () {
        var out = [];
        CHIPS.forEach(function (card) {
          var el = card.shadowRoot && card.shadowRoot.querySelector('[data-hk-role="menu"]');
          if (!el) CHIPS.delete(card);
          else if (el.isConnected) out.push(el);
        });
        return out;
      },
      // the button's picture: the iPad sidebar glyph, or three lines
      // (each screen's, All Screens' unless it sets its own -- settings.py resolved())
      icon: function () { return boardOf(dashSeg()).glyph === 'lines' ? 'hk:menu' : 'hk:dock-left'; },
      clock: function () {
        return menuState.on() && !menuState.docked() && boardOf(dashSeg()).clock !== false;
      },
      // SWIPE FROM THE LEFT EDGE (the screen's Swipe from Left Edge): a drag
      // right from the dashboard's left edge pulls the menu out -- hk-menu.js
      // -- alongside whatever button there is, at every width; not while the
      // menu is docked, open already.
      swipe: function () { return menuState.on() && !menuState.docked() && swipeOn(); },
      // THE MENU'S HIGHLIGHT: its icons and the current page's row -- one of
      // Apple's system colours (dark-mode values), or the screen's own
      // "#rrggbb". `on`: the text over it, dark on the light ones.
      // `base`: everything else the highlight colors -- the menu's icons.
      // Automatic changes only the page you're on (the user, 2026-10-17): its
      // row takes the page's color, the rest keep HK's orange.
      // FLAT'S ACCENT COLOR (2026-10-17): chosen, it is the whole highlight in
      // Flat -- the page you're on and every other icon (the user: the icons
      // stayed orange, two tones) -- while the Highlight Color stays saved for
      // the other looks and for an Automatic Accent
      accent: function () {
        var a = String(boardOf(dashSeg()).accent || 'orange').toLowerCase(), auto = a === 'auto';
        var hex = legacyAccentHex();
        // (bright on Flat's Light too -- Apple's light color, not darkened:
        // the user, 2026-10-17)
        var color = flatColor(hex, 'on');
        var base = auto ? flatColor(ACCENTS.orange, 'on') : color;
        var pal = flatPalette();
        // IN FLAT the page you're on is always white over its fill, whatever
        // the color -- Lights' yellow and Weather's cyan too (the user,
        // 2026-10-17: the black text and glyph looked wrong); the Glass looks
        // keep black over their pale colors (accentText)
        var S = window.hkSettings, flatNow = !!(S && S.rendering && S.rendering().flat);
        if (pal && pal.seed) return { color: pal.seed, on: '#fff', base: pal.seed, flat: true };
        return { color: color, on: flatNow ? '#fff' : accentText(hex), base: base };
      },
      open: function () { if (window.hkMenu) window.hkMenu.open(); },
      toggle: function () { if (window.hkMenu) window.hkMenu.toggle(); },
      // a card that draws a way in signs on this, so it redraws when any of it changes
      sig: function () {
        var acc = boardOf(dashSeg()).accent;
        var pal = flatPalette();
        return [menuState.on(), menuState.style(), boardOf(dashSeg()).menu, menuState.icon(),
                menuState.clock(), acc === 'auto' ? 'auto:' + pageAccent() : acc, pal && pal.seed || ''].join('|');
      },
      // Where a room heading for `area` leads: this dashboard's room page for
      // it, while "Room headings open their room page" is on. null: stay a
      // plain heading.
      roomPath: function (area) {
        if (!area || msetting('rooms.headings', true) === false) return null;
        var i = roomIndex(area);
        if (i === null) return null;
        var v = lovelaceConfig().views[i];
        return '/' + dashSeg() + '/' + (v.path || i);
      },
      // Where this dashboard's page at view path `p` is (a Home Grid's Timers
      // block opens Timers); null: the screen has no such page
      pagePath: function (p) {
        var cfg = lovelaceConfig(), views = (cfg && cfg.views) || [];
        for (var i = 0; i < views.length; i++) if (views[i] && views[i].path === p) return '/' + dashSeg() + '/' + p;
        return null;
      },
      // THE DATE LINE, for the edge tab: hk-header-card measures where its
      // date's optical centre sits (px below the top of the dashboard's panel)
      // and publishes it here; hk-menu.js centres the tab on it. Kept per
      // dashboard, and across reloads, so a page opened straight onto a room
      // puts the tab where Home will.
      publishDate: function (y) {
        var d = dashSeg();
        if (dateLines[d] !== undefined && Math.abs(dateLines[d] - y) < 0.25) return;
        dateLines[d] = y;
        try { localStorage.setItem(DATE_KEY + d, String(Math.round(y * 10) / 10)); } catch (e) { /* private */ }
        window.dispatchEvent(new CustomEvent('hk-menu-date', { detail: { dash: d, y: y } }));
      },
      dateY: function () {
        var d = dashSeg();
        if (dateLines[d] === undefined) {
          try {
            var v = parseFloat(localStorage.getItem(DATE_KEY + d));
            if (isFinite(v)) dateLines[d] = v;
          } catch (e) { /* private */ }
        }
        return dateLines[d] === undefined ? null : dateLines[d];
      },
      areasOfView: areasOfView,
      viewTop: viewTop,
      config: lovelaceConfig, panel: panelLovelace, dash: dashSeg, holdsCard: holdsCard, nowPlaying: nowPlaying, npGrace: npGrace,
      homeButton: homeHasButton,
      NARROW: MENU_NARROW, DOCK: MENU_DOCK, TAB_MIN: TAB_MIN
    };
    // the pages that keep a tone of their own while the screen shows a photo:
    // the Glass looks' own-color pages (hk-settings-model.js SKY_OWN) and, in
    // Flat, Calendar and Weather too -- a photo behind them didn't look good
    // (the user, 2026-10-16). Home and the rooms take the screen's Background.
    var FLAT_OWN = { cameras: 1, live_tv: 1, security: 1, doors_windows: 1, climate: 1, lights: 1, timers: 1,
                     vacuums: 1, music: 1, water: 1, energy: 1, calendar: 1, weather: 1, power: 1 };

    // what the shell and the later parts use of this one
    K.FLAT_OWN = FLAT_OWN; K.MENU_NARROW = MENU_NARROW; K.menuState = menuState;
  };
})();
