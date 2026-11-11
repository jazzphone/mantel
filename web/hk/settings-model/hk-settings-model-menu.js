// hk-settings-model-menu.js - the menu and the glass.
//
// PART OF THE SETTINGS MODEL (hk-settings-model.js). Not a card and not run on its own: it registers one
// function, which hk-settings-model.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSettingsModelParts = window.hkSettingsModelParts || {})['hk-settings-model-menu'] = function (K) {
    var ACCENTS = K.ACCENTS, GLASS = K.GLASS, GLASS_STYLES = K.GLASS_STYLES, glassStyle = K.glassStyle,
        isBlur = K.isBlur, isBright = K.isBright, MENU_STYLES = K.MENU_STYLES, PAGE_LABELS = K.PAGE_LABELS,
        phoneStyleLabel = K.phoneStyleLabel, TAB_STYLES = K.TAB_STYLES;

    // ------------------------------------------------------------- the menu
    function menuMode(b) {
      return b.menu === 'off' || b.menu === 'open' || b.menu === 'tabbar' ? b.menu : 'button';
    }
    // Switching the segmented control: a button keeps the style it had.
    function menuFor(mode, b, last) {
      if (mode === 'off' || mode === 'open' || mode === 'tabbar') return mode;
      return menuMode(b) === 'button' ? b.menu : (last || 'auto');
    }
    // THE TAB BAR (hk-tabbar.js): the screen's Menu "Tab Bar", or the side
    // menu with "Tab Bar" where it folds -- does this screen ever show it?
    function hasTabBar(b) { return !!b && (tabletTabBar(b) || phoneMenu(b) === 'tabbar'); }
    function tabletTabBar(b) { return !!b && b.menu === 'tabbar'; }
    // PHONES' OWN MENU (2026-10-08; hk-base.js phoneMenu, settings.py
    // BOARD_PHONE_MENUS): a phone -- an iPhone or an Android phone either way
    // up, or a window under 640 px -- and a tablet whose own menu doesn't fit
    // (2026-10-09, hk-base.js phoneForm) show the screen's Phones menu: off, a
    // button, or the tab bar. Unset: the tablets' when that is off or the tab
    // bar, else a button.
    var PHONE_MENUS = [['off', 'Off'], ['button', 'Button'], ['tabbar', 'Tab Bar']];
    // THE DEVICES, said the same way on every page
    var DEVICES = {
      phones: 'An iPhone or an Android phone, either way up, or a window narrower than 640 px.',
      tablets: 'An iPad, a wall tablet or a computer.',
      // the one sentence for where a tablet's menu doesn't fit
      fold: 'Where its menu doesn’t fit — an iPad held upright, Split View — a tablet shows the Phones menu.'
    };
    // the edge tab's sizes, a tablet's and a phone's (settings.py BOARD_TAB_SIZES)
    var TAB_SIZES = [['standard', 'Standard'], ['large', 'Large'], ['xl', 'Extra Large']];
    function phoneMenu(b) {
      var m = b && b.menu_phone;
      if (m === 'off' || m === 'button' || m === 'tabbar') return m;
      if (!b) return 'off';
      return b.menu === 'off' || b.menu === 'tabbar' ? b.menu : 'button';
    }
    // ...its button's style
    function phoneButton(b) {
      var v = (b && b.button_phone) || 'chip';
      return v === 'chip_scroll' || v === 'tab' || v === 'none' ? v : 'chip';
    }
    // one line for each device's row: a screen's (its menu, then the style)
    // or All Screens' (`house`: the style alone -- whether a screen has a menu
    // is its own)
    function tabletSummary(b, house) {
      if (house) return menuStyleLabel(b.menu);
      var m = menuMode(b);
      // a button's style names a button already: "Chip, Then Tab"
      return m === 'off' ? 'Off' : m === 'open' ? 'Always Open' : m === 'tabbar' ? 'Tab Bar' : menuStyleLabel(b.menu);
    }
    function phoneSummary(b, house) {
      if (house) return phoneStyleLabel(phoneButton(b));
      var m = phoneMenu(b);
      return m === 'off' ? 'Off' : m === 'tabbar' ? 'Tab Bar' : phoneStyleLabel(phoneButton(b));
    }
    var TAB_BAR_SCROLLS = [['shrink', 'Shrink'], ['hide', 'Hide'], ['stay', 'Stay']];
    var TAB_BAR_MORE = [['icons', 'Icons'], ['list', 'List']];
    var TAB_BAR_SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
    var TAB_BAR_LABELS = [['show', 'Icons and Names'], ['icons', 'Icons Only']];
    // where the Home Assistant section sits, in the side menu and More alike
    var HA_PLACES = [['top', 'Top'], ['categories', 'Above Categories'], ['rooms', 'Above Rooms'], ['bottom', 'Bottom']];
    // Tabs in Bar / in Rail: pages, Home and More not counted
    var TAB_BAR_TABS = [[2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8']];
    // a phone's (settings.py TAB_BAR_TABS_PHONE): six tabs at most on a 402 px iPhone, Home and More among them
    var TAB_BAR_TABS_PHONE = [[2, '2'], [3, '3'], [4, '4']];
    var TAB_BAR_POS = [['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right']];
    // SHRINKS TO, named by the bar's direction: a bar's left or right, a
    // rail's top or bottom (stored as its start or end)
    function foldOptions(pos) {
      return pos === 'left' || pos === 'right' ? [['start', 'Top'], ['end', 'Bottom']] : [['start', 'Left'], ['end', 'Right']];
    }
    var TAB_BAR_ROOMS = [['more', 'In More'], ['button', 'Own Button'], ['off', 'Off']];
    // a boolean from the first form: true is In More
    function roomsPlace(v) { return v === false || v === 'off' ? 'off' : v === 'button' ? 'button' : 'more'; }
    // ('tinted' was stored as 'clear' before entry 1.12: Appearance's
    // see-through glass is 'clear')
    var TAB_BAR_GLASS = [['house', 'Same as Screen'], ['blur', 'Blur'], ['frosted', 'Frosted'], ['tinted', 'Tinted'],
                         ['bright', 'Bright Glass']];
    function choiceLabel(list, v) {
      for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i][1];
      return v;
    }
    function menuStyleLabel(v) {
      for (var i = 0; i < MENU_STYLES.length; i++) if (MENU_STYLES[i][0] === v) return MENU_STYLES[i][1];
      return v;
    }
    // ACCENT COLOR (2026-10-29, Phase 3): one choice for the menu's highlight
    // and Flat's accent -- Automatic (in Flat, Flat's own; elsewhere each
    // page's color), the eleven colors, or your own. Saved as the menu's
    // accent (menu.accent, a screen's `accent`) and the same value as Flat's
    // (flat_colors.accent), so the two never part again. An accent Flat kept
    // apart before stays as it was saved: shown here while Flat is in use, and
    // a Flat screen's own as Just This Screen.
    // -> {value, name, hex (null: Automatic), own, house: the same for All
    // Screens}. `look`: settings.look; `menu`: settings.menu; `b`: a screen
    // (as read) or null for All Screens; `flat`: Flat in use there.
    function accentColorOf(look, menu, b, flat, houseFlat) {
      look = look || {};
      var said = function (v) { return { value: v, name: v === 'auto' ? 'Automatic' : flatColorName(v), hex: flatColorHex(v) }; };
      var hfa = ((look.flat_colors || {}).accent) || 'auto';
      var hv = houseFlat && hfa !== 'auto' ? hfa : String((menu || {}).accent || 'orange').toLowerCase();
      var house = said(hv);
      if (!b) return Object.assign(house, { own: false, house: house });
      var fown = (b.flat_colors || {}).accent;
      var own = ownsMenu(b, 'accent') || fown != null;
      var fa = fown != null ? fown : hfa;
      var v = flat && fa !== 'auto' ? fa : String(b.accent || 'orange').toLowerCase();
      return Object.assign(said(v), { own: own, house: house });
    }
    // CHOOSING IT: both, in one write -- {house: setH's changes} or {screen:
    // setB's}; in Flat, Off Pill Tint left Automatic follows a chosen color
    // (flatAccentChange). `v` null: back to All Screens' (a screen).
    function accentChanges(v, b, tintAuto) {
      if (!b) {
        var h = { 'menu.accent': v, 'look.flat_colors.accent': v };
        if (v !== 'auto' && tintAuto) h['look.flat_colors.off_tint'] = 'accent';
        return h;
      }
      if (v == null) return Object.assign(menuOwnReset(b, 'accent'), { 'flat_colors.accent': null });
      var s = Object.assign(menuOwnSet(b, { accent: v }), { 'flat_colors.accent': v });
      if (v !== 'auto' && tintAuto) s['flat_colors.off_tint'] = 'accent';
      return s;
    }
    // FLAT COLORS (2026-10-17; settings.py flat_colors, hk-settings.js
    // resolveFlatColors): Accent Color's presets -- hk-base.js FLAT_ACCENTS,
    // the same list (tests/test_flatcolors.js)
    var FLAT_ACCENTS = [['amber', 'Amber', '#e09649'], ['sage', 'Sage', '#7e9b83'], ['harbor', 'Harbor', '#5c91bc'],
                        ['lavender', 'Lavender', '#9374bc'], ['rose', 'Rose', '#c17d91'], ['slate', 'Slate', '#64798e'],
                        ['teal', 'Teal', '#599b9c'], ['clay', 'Clay', '#ad8972']];
    // a screen's (or All Screens') Flat Colors at `keys`, as the dashboard
    // resolves them -- the same function, so the two can't disagree
    function flatColorsOf(look, b, keys) {
      var S = window.hkSettings;
      return S && S.resolveFlatColors ? S.resolveFlatColors(look, b, keys)
           : { accent: { value: 'auto', scope: 'default', page: null }, off_tint: { value: 'auto', scope: 'default', page: null },
               pages: { value: 'accent', scope: 'default', page: null } };
    }
    // a resolved accent in a word: a page keeping its own color says so
    function flatAccentSays(f) { return f && f.scope === 'own-page' ? 'Its Own Color' : flatColorName(f && f.value); }
    // Flat Colors' `pages` in a word
    function flatPagesName(v) { return v === 'own' ? 'Own Colors' : 'Follow Accent'; }
    // a Flat Colors value in a word: a preset by its name, Apple's by theirs
    function flatColorName(v) {
      v = String(v || 'auto').toLowerCase();
      if (v === 'auto') return 'Automatic';
      if (v === 'accent') return 'Match Accent';
      for (var i = 0; i < FLAT_ACCENTS.length; i++) if (FLAT_ACCENTS[i][2] === v) return FLAT_ACCENTS[i][1];
      for (var j = 0; j < ACCENTS.length; j++) if (ACCENTS[j][0] === v || ACCENTS[j][2] === v) return ACCENTS[j][1];
      return /^#[0-9a-f]{6}$/.test(v) ? 'Custom' : 'Automatic';
    }
    // ...and as a swatch (null: none -- Automatic, Match Accent)
    function flatColorHex(v) {
      v = String(v || '').toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(v)) return v;
      for (var j = 0; j < ACCENTS.length; j++) if (ACCENTS[j][0] === v) return ACCENTS[j][2];
      for (var i = 0; i < FLAT_ACCENTS.length; i++) if (FLAT_ACCENTS[i][0] === v) return FLAT_ACCENTS[i][2];
      return null;
    }
    // WHERE A RESOLVED FIELD COMES FROM, in words: "All Screens", "This
    // Screen", "Calendar on All Screens", "Kitchen on This Screen" ('' for the
    // built-in Automatic). o.label(key): a page's or room's name.
    function flatSourceLabel(f, o) {
      o = o || {};
      var name = function (k) {
        var l = o.label && o.label(k);
        if (l) return l;
        if (k === 'rooms') return 'Room Pages';
        if (/^room-/.test(k)) return k.slice(5).replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        return SKY_PAGE_LABELS[k] || PAGE_LABELS[k] || k;
      };
      if (!f || f.scope === 'default') return '';
      if (f.scope === 'house') return 'All Screens';
      if (f.scope === 'screen') return 'This Screen';
      if (f.scope === 'house-page') return name(f.page) + ' on All Screens';
      if (f.scope === 'screen-page') return name(f.page) + ' on This Screen';
      if (f.scope === 'own-page') return 'Pages Keep Their Own Colors';
      return 'Preview';
    }
    // a photo's Tint in a word (Sky / Background -> Tint)
    function flatTintLabel(v) { return v === 'accent' ? 'Match Accent' : /^#/.test(v || '') ? 'Your Own' : 'None'; }
    // "Sage · All Screens"
    function flatFieldSays(f, o) {
      var src = flatSourceLabel(f, o);
      return flatColorName(f.value) + (src ? ' · ' + src : '');
    }
    // CHOOSING AN ACCENT is one coordinated change: where the tint in effect
    // is Automatic, it links to the accent in the same write; a tint already
    // matched, or a color of its own (here or inherited), is left as it is.
    // `r`: the scope's resolved colors before the change.
    function flatAccentChange(value, r) {
      var out = { accent: value };
      if (value !== 'auto' && r && r.off_tint && r.off_tint.value === 'auto') out.off_tint = 'accent';
      return out;
    }
    // TAB POSITION as two choices: level with the date ('') or a distance from
    // the top in px or % (settings.py tab_position) -- [mode, number, unit]
    function tabPosParts(v) {
      var m = /^\s*(\d+(?:\.\d+)?)\s*(px|%)?\s*$/.exec(String(v || ''));
      return m ? { mode: 'custom', n: m[1], unit: m[2] || 'px' } : { mode: 'date', n: '', unit: 'px' };
    }
    function tabPosJoin(n, unit) {
      var t = String(n == null ? '' : n).replace(/[^\d.]/g, '');
      return t ? t + (unit === '%' ? '%' : 'px') : '';
    }
    function tabPosLabel(v) {
      var p = tabPosParts(v);
      return p.mode === 'date' ? 'Level with Date' : p.n + (p.unit === '%' ? ' % from Top' : ' px from Top');
    }
    // ALL SCREENS' MENU (settings `menu`) as a screen's keys, and back
    // (settings.py MENU_KEYS): the same rows serve both
    // BACK BUTTON & TITLE (Page Header before 2026-10-29): beside a screen's
    // other header settings
    var PAGE_HEADERS = [['current', 'Back & Title'], ['smart', 'Context When Needed'], ['none', 'No Header']];
    var PAGE_HEADER_SAYS =
      'With the side menu open or a tab bar, Context When Needed drops a repeated title and keeps a short label; No Header removes both. The full header returns when the menu folds into a button.';
    var MENU_KEYS = { page_header: 'page_header', menu: 'style', tab_position: 'tab_at', tab_size: 'tab_size',
                      tab_size_phone: 'tab_size_phone', dock_min: 'open_min', time_weather: 'time_weather_at',
                      ha_row: 'ha_row', ha_place: 'ha_at', accent: 'accent', glyph: 'glyph', clock: 'clock', swipe: 'swipe',
                      tab_bar_scroll: 'bar_scroll', tab_bar_rooms: 'bar_rooms', tab_bar_glass: 'bar_glass',
                      tab_bar_more: 'bar_more', tab_bar_more_phone: 'bar_more_phone',
                      tab_bar_pos: 'bar_pos', tab_bar_fold: 'bar_fold', tab_bar_start: 'bar_start',
                      tab_bar_adjust: 'bar_adjust', tab_bar_scroll_phone: 'bar_scroll_phone',
                      tab_bar_tabs: 'bar_tabs', tab_bar_tabs_rail: 'bar_tabs_rail', tab_bar_size: 'bar_size', tab_bar_labels: 'bar_labels',
                      tab_bar_tabs_phone: 'bar_tabs_phone', tab_bar_strip: 'bar_strip',
                      button_phone: 'button_phone', tab_bar_rooms_phone: 'bar_rooms_phone' };
    var MENU_DEFAULTS = { page_header: 'current', menu: 'auto', tab_position: '', tab_size: 'large', tab_size_phone: 'standard',
                          dock_min: 1000, time_weather: 'page', ha_row: false, ha_place: 'rooms', accent: 'orange', glyph: 'sidebar', clock: true,
                          swipe: false, tab_bar_scroll: 'shrink', tab_bar_rooms: 'more', tab_bar_glass: 'house',
                          tab_bar_more: 'icons', tab_bar_more_phone: 'list', tab_bar_pos: 'bottom',
                          tab_bar_fold: 'start', tab_bar_start: 'full', tab_bar_adjust: true,
                          tab_bar_scroll_phone: 'shrink', tab_bar_tabs: 6, tab_bar_tabs_rail: 6, tab_bar_tabs_phone: 3,
                          tab_bar_size: 'medium', tab_bar_labels: 'show', tab_bar_strip: true, button_phone: 'chip', tab_bar_rooms_phone: 'more' };
    function houseMenuAsBoard(m) {
      m = m || {};
      var out = {};
      Object.keys(MENU_KEYS).forEach(function (k) {
        var v = m[MENU_KEYS[k]];
        out[k] = v === undefined || v === null ? MENU_DEFAULTS[k] : v;
      });
      out.clock = out.clock !== false;
      out.swipe = out.swipe === true;
      out.tab_bar_rooms = roomsPlace(out.tab_bar_rooms);
      out.tab_bar_adjust = out.tab_bar_adjust !== false;
      out.tab_bar_strip = out.tab_bar_strip !== false;
      out.tab_bar_rooms_phone = roomsPlace(out.tab_bar_rooms_phone);
      if (out.tab_bar_glass === 'clear') out.tab_bar_glass = 'tinted';
      return out;
    }
    function houseMenuSave(ch) {
      var out = {};
      Object.keys(ch).forEach(function (k) { if (MENU_KEYS[k]) out['menu.' + MENU_KEYS[k]] = ch[k]; });
      return out;
    }
    // A SCREEN'S MENU, ONE SETTING AT A TIME (2026-10-29, settings.py
    // menu_own), as Appearance follows All Screens: which of its menu
    // settings are its own -- the rest are All Screens'. A screen still read
    // with menu_custom (not moved yet) owns them all, as it did.
    function menuOwn(b) {
      if (!b) return [];
      var keys = Object.keys(MENU_KEYS);
      if (Array.isArray(b.menu_own)) return keys.filter(function (k) { return b.menu_own.indexOf(k) >= 0; });
      return b.menu_custom === true ? keys : [];
    }
    function ownsMenu(b, k) { return menuOwn(b).indexOf(k) >= 0; }
    // a change to a screen's menu settings: each becomes its own (Just This
    // Screen); `menu` itself only as a button's style
    function menuOwnSet(b, ch) {
      var own = menuOwn(b), out = Object.assign({}, ch);
      Object.keys(ch).forEach(function (k) { if (MENU_KEYS[k] && own.indexOf(k) < 0) own.push(k); });
      out.menu_own = Object.keys(MENU_KEYS).filter(function (k) { return own.indexOf(k) >= 0; });
      return out;
    }
    // ...and back to All Screens' (Reset to All Screens)
    function menuOwnReset(b, keys) {
      keys = [].concat(keys);
      return { menu_own: menuOwn(b).filter(function (k) { return keys.indexOf(k) < 0; }) };
    }
    // one line for a row that opens some of a screen's menu settings (`keys`:
    // those; all of them when left out)
    function menuSummary(b, keys) {
      var own = menuOwn(b).filter(function (k) { return !keys || keys.indexOf(k) >= 0; });
      return !own.length ? 'Same as All Screens' : own.length === 1 ? '1 Own Setting' : own.length + ' Own Settings';
    }
    // THE KINDS OF MENU (All Screens -> Menu, 2026-10-29): the side menu (a
    // button or always open, on either device), the edge tab, the tab bar --
    // each a page of everything about it. A screen (as read) uses a kind on
    // either device.
    function usesSide(b) { var m = menuMode(b); return m === 'button' || m === 'open' || phoneMenu(b) === 'button'; }
    var MENU_KINDS = [['side', 'Side Menu', usesSide], ['edge-tab', 'Edge Tab', function (b) { return showsTab(b); }],
                      ['tab-bar', 'Tab Bar', function (b) { return hasTabBar(b); }]];
    function menuKind(id) { return MENU_KINDS.filter(function (k) { return k[0] === id; })[0] || null; }
    // the screens that use a kind ([{path, title}] -> their titles)
    function kindUsers(id, boards, titleOf) {
      var k = menuKind(id);
      return !k ? [] : Object.keys(boards || {}).filter(function (p) { return boards[p] && k[2](boards[p]); })
        .map(function (p) { return titleOf ? titleOf(p) : p; });
    }
    // ...as a row's value: who uses it
    function usedBy(names) {
      if (!names.length) return 'Not used on any screen';
      return names.length <= 2 ? names.join(', ') : names.length + ' Screens';
    }
    // A SCREEN'S MENU ON EACH DEVICE in words: "Tab Bar on Both" when they
    // are the same, else "Button, Tab Bar on Phones" (2026-10-30: never
    // "Button · Button")
    function menuWord(b) {
      var m = menuMode(b), p = phoneMenu(b);
      var t = m === 'off' ? 'Off' : m === 'open' ? 'Always Open' : m === 'tabbar' ? 'Tab Bar' : 'Button';
      var ph = p === 'off' ? 'Off' : p === 'tabbar' ? 'Tab Bar' : 'Button';
      return t === ph ? (t === 'Off' ? 'Off' : t + ' on Both') : t + ', ' + ph + ' on Phones';
    }
    // which menu settings each kind's page holds (a screen's Reset there)
    var KIND_KEYS = {
      side: ['menu', 'button_phone', 'glyph', 'dock_min', 'time_weather', 'swipe', 'clock', 'ha_row', 'ha_place'],
      'edge-tab': ['tab_position', 'tab_size', 'tab_size_phone'],
      'tab-bar': ['tab_bar_pos', 'tab_bar_size', 'tab_bar_labels', 'tab_bar_strip', 'tab_bar_scroll', 'tab_bar_scroll_phone', 'tab_bar_fold',
                  'tab_bar_start', 'tab_bar_adjust', 'tab_bar_tabs', 'tab_bar_tabs_phone', 'tab_bar_tabs_rail', 'tab_bar_more',
                  'tab_bar_more_phone', 'tab_bar_rooms', 'tab_bar_rooms_phone', 'ha_row', 'ha_place']
    };
    // THE EDGE TAB, on each device: a tablet's button or folded menu, a
    // phone's button
    function tabletTab(b) {
      var m = menuMode(b);
      if (m === 'off' || m === 'tabbar') return false;
      return m === 'button' && !!TAB_STYLES[b.menu];
    }
    function phoneTab(b) {
      var s = phoneButton(b);
      return phoneMenu(b) === 'button' && (s === 'tab' || s === 'chip_scroll');
    }
    function showsTab(b) { return tabletTab(b) || phoneTab(b); }

    // ------------------------------------------------------------ the glass
    function glassLabel(v) {
      for (var i = 0; i < GLASS.length; i++) if (GLASS[i][0] === v) return GLASS[i][1];
      return v;
    }
    // ...as a row's value, the style alone ("Bright Glass", not "Bright Glass
    // · Shared Layer": its mode is on the Style page)
    function glassShort(v) {
      return isBlur(v) ? 'Blur' : isBright(v) ? 'Bright Glass' : glassLabel(v);
    }
    // this screen's glass: its own, or All Screens'
    function glassOf(b, look) {
      var own = !!b.glass && b.glass !== 'house';
      look = look || {};
      var house = look.flat === true ? 'flat' : (look.glass || 'clear');
      var flat = typeof b.flat === 'boolean' ? b.flat : (!own && look.flat === true);
      own = typeof b.flat === 'boolean' || own;
      var value = flat ? 'flat' : (b.glass && b.glass !== 'house' ? b.glass : look.glass || 'clear');
      return { own: own, value: own ? value : 'house', effective: value, house: house };
    }
    // an amount: this screen's own (a number), else All Screens'
    function amountOf(b, look, key) {
      var own = b[key] !== null && b[key] !== undefined && b[key] !== '';
      var house = look && typeof look[key] === 'number' ? look[key] : 50;
      return { own: own, value: own ? Number(b[key]) : house, house: house };
    }
    // which amount the glass uses (the others are kept but not shown)
    function amountsFor(effective) {
      return { frost: effective === 'frosted', blur: isBlur(effective), tint: effective === 'tinted', bright: isBright(effective) };
    }
    // the Glass group's footer, for the style shown (All Screens' Appearance
    // and a screen's page say the same)
    function glassFooter(style) {
      var t = 'How the pills, tiles and chips look.';
      if (style ===
        'flat'
        ) return 'Opaque surfaces with no blur, animations or live sky effects. Color, landscape and photo backgrounds remain available in Background. Your other appearance preferences are kept.';
      if (style === 'frosted') t += ' Frost: how milky, 50% is the middle. Tint from Background: each card takes the color of the page behind it instead of one gray.';
      if (isBlur(style)) t += ' Blur: how strong, 50% is 20 px.';
      if (
        isBright(
        style)) t +=
        ' Strength: how bright the glass is, 50% as designed. It holds back by itself where white text would get hard to read. Dim: a shade over the cards, the chips and the tab bar, as the Side ' +
        'Pane’s Dim — the Side Pane follows it unless it has its own.';
      if (style === 'tinted') t += ' Darkness: how much of the background shows through, 50% is 75% dark. Icon Circles: Dark as the Home app’s, or Light to keep their shape over dark scenery.';
      return t;
    }
    // A LIGHTER SCREEN FOR A SLOW TABLET (2026-10-29): offered on a screen's
    // Appearance, never applied by itself, ONE suggestion at a time -- a ladder
    // of the settings that cost a weak tablet the most frames, the dearest
    // first (Flat turns off the same things: blur, motion, the live sky and
    // autoplay). The screen's first step that still applies is the one offered:
    //   glass   Blur, Frosted or Tinted -> Glass (hk-glass.js measured 22 blur
    //           surfaces halving the frame rate of a Samsung SM-X230)
    //   rain    the sky's falling Rain & Snow off (the clouds and fog stay)
    //   front   Moving Things in front of the cards -> behind them
    //   anim    Animations off: the sky holds still
    //   camera  Live First Camera off: the first tile is a snapshot
    // Use Flat is the second button on every step but Moving Things.
    //
    // WHAT A NUMBER MEANS. A sample says what was on the screen when it was
    // drawn (its `fps_sig`, hkSettings.ladderSignature(): ladderSignature
    // below); it counts only while the screen's settings still read the same.
    // So after a step is taken nothing more is offered until the tablet has
    // drawn again (hourly) and is still under SLOW_FPS -- then the next step
    // is. A sample from before the ladder has no signature: it speaks for the
    // first step alone, by its style, as it did.
    //
    // `facts`: ladderFacts(); `tablets`: [{name, screens, fps, fps_screen,
    // fps_style, fps_sig, fps_at}] -- each tablet's latest frame rate (5 idle
    // seconds, page-health.js / hk-fps.js), where it was measured when it says,
    // else the screens it shows. A tablet counts for this screen when it
    // measured it (or, saying nothing of where, shows it), with these
    // settings, under SLOW_FPS, in the last FPS_FRESH. The slowest one speaks.
    // null: nothing to recommend (a light screen already, no numbers that
    // match, or all fast enough).
    var SLOW_FPS = 45, FPS_FRESH = 14 * 86400;
    var HEAVY_LOOKS = { blur: 1, frosted: 1, tinted: 1, bright: 1 };
    // the settings the ladder reads, as a screen has them: {style, anim
    // (the sky animates), weather, rain, front (moving things over the cards),
    // camera (the first tile plays live), cams (the screen has a camera strip
    // at all)}. `sky`: All Screens' sky.*; `cams`: {strip, live} -- whether the
    // screen shows a camera strip, and All Screens' Live First Camera. A flag
    // is on only while it costs: nothing under Flat, no sky motion over a still
    // background (hk-settings.js ladderSignature works the same out)
    function ladderFacts(b, look, sky, cams) {
      b = b || {}; sky = sky || {}; cams = cams || {};
      var style = glassOf(b, look).effective, flat = style === 'flat';
      var own = function (bk, hk, dflt) { return b[bk] != null ? b[bk] : (sky[hk] == null ? dflt : sky[hk]); };
      var live = !flat && b.sky !== false && (b.sky_background || sky.background || 'live') === 'live';
      // (a Wallpaper with Motion on moves too, while Animations are on: 2026-10-30)
      var moving = !flat && b.sky !== false && (b.sky_background || sky.background) === 'wallpaper' &&
        (own('sky_wallpaper_motion', 'wallpaper_motion', 'off') || 'off') !== 'off';
      var anim = (live || moving) && own('sky_animations', 'animations', true) !== false;
      var weather = live && own('sky_weather', 'weather', true) !== false;
      return { style: style, anim: anim, weather: weather,
               rain: anim && weather && own('sky_precipitation', 'precipitation', true) !== false,
               front: live && anim && own('sky_moving', 'moving', 'behind') === 'front',
               camera: !flat && (typeof b.camera_live_video === 'boolean' ? b.camera_live_video : cams.live !== false),
               cams: !!cams.strip };
    }
    // the word the sampler sends (hkSettings.ladderSignature): "blur:a1w1r1f0c1"
    function ladderSignature(f) {
      var n = function (v) { return v ? '1' : '0'; };
      return f.style + ':a' + n(f.anim) + 'w' + n(f.weather) + 'r' + n(f.rain) + 'f' + n(f.front) + 'c' + n(f.camera);
    }
    // each step: when it applies, its short name (the row on All Screens'
    // Appearance), the button and the change it makes (this screen's own, never
    // All Screens'), what the facts are after it, whether Use Flat goes with it,
    // what the tablet drew with (`drew`) and what the change gives (`why`)
    var LADDER = [
      { id: 'glass', applies: function (f) { return !!HEAVY_LOOKS[glassStyle(f.style)]; },
        button: 'Use Glass on This Screen', change: { flat: false, glass: 'clear' }, flat: true,
        after: function (f) { return Object.assign({}, f, { style: 'clear' }); } },
      { id: 'rain', applies: function (f) { return f.rain; }, label: 'Rain & Snow',
        drew: 'Rain & Snow on', why: 'Without them the clouds and fog still drift, and it is lighter.',
        button: 'Turn Off Rain & Snow on This Screen', change: { sky_precipitation: false }, flat: true,
        after: function (f) { return Object.assign({}, f, { rain: false }); } },
      { id: 'front', applies: function (f) { return f.front; }, label: 'Moving Things',
        drew: 'Moving Things in front of the cards', why: 'Behind them, they cost less.',
        button: 'Put Moving Things Behind on This Screen', change: { sky_moving: 'behind' }, flat: false,
        after: function (f) { return Object.assign({}, f, { front: false }); } },
      { id: 'anim', applies: function (f) { return f.anim; }, label: 'Animations',
        drew: 'Animations on', why: 'Off, the sky holds still: no drifting clouds, rain or snow, little moving things, or moving wallpaper.',
        button: 'Turn Off Animations on This Screen', change: { sky_animations: false }, flat: true,
        after: function (f) { return Object.assign({}, f, { anim: false, rain: false, front: false }); } },
      { id: 'camera', applies: function (f) { return f.camera && f.cams; }, label: 'Live Camera',
        drew: 'a camera playing live', why: 'Off, its first tile is a snapshot: no video to decode.',
        button: 'Turn Off Live First Camera on This Screen', change: { camera_live_video: false }, flat: true,
        after: function (f) { return Object.assign({}, f, { camera: false }); } }
    ];
    var LADDER_THEN = 'If it’s still slow an hour from now, the next suggestion appears here.';
    function slowRecommend(path, facts, tablets, now) {
      if (!facts || facts.style === 'flat') return null;
      var step = LADDER.filter(function (st) { return st.applies(facts); })[0];
      if (!step) return null;
      var sig = ladderSignature(facts), kind = glassStyle(facts.style), slow = null;
      (tablets || []).forEach(function (t) {
        if (!t || typeof t.fps !== 'number' || !(t.fps < SLOW_FPS)) return;
        var where = t.fps_screen ? t.fps_screen === path : (t.screens || []).indexOf(path) >= 0;
        if (!where) return;
        if (t.fps_sig) { if (t.fps_sig !== sig) return; }
        else if (step.id !== 'glass' || (t.fps_style && (t.fps_style === 'flat' || glassStyle(t.fps_style) !== kind))) return;
        if (now && typeof t.fps_at === 'number' && now - t.fps_at > FPS_FRESH) return;
        if (!slow || t.fps < slow.fps) slow = t;
      });
      if (!slow) return null;
      var fps = Math.round(slow.fps), who = (slow.name || 'A tablet') + ' draws ' + fps + ' frames a second with ';
      var label = step.label, says, then = null;
      if (step.id === 'glass') {
        label = (GLASS_STYLES.filter(function (g) { return g[0] === kind; })[0] || [0, kind])[1];
        says = who + label + '. ' + (kind === 'blur' || kind === 'bright' ? 'Glass looks almost the same and is lighter.'
          : 'Flat is the lightest look: no blur, animations or moving sky.');
      } else says = who + step.drew + '. ' + step.why;
      // the next step, if one would still apply once this one is taken
      var next = step.after(facts);
      if (LADDER.some(function (st) { return st.applies(next); })) then = LADDER_THEN;
      return { name: slow.name, fps: fps, step: step.id, style: kind, label: label, says: says, then: then,
               button: step.button, change: step.change, flat: step.flat };
    }
    var SKY_PAGE_LABELS = { music: 'Music', rooms: 'Room Pages', live_tv: 'Live TV' };

    // what the shell and the later parts use of this one
    K.accentChanges = accentChanges; K.accentColorOf = accentColorOf; K.amountOf = amountOf;
    K.amountsFor = amountsFor; K.choiceLabel = choiceLabel; K.DEVICES = DEVICES; K.FLAT_ACCENTS = FLAT_ACCENTS;
    K.flatAccentChange = flatAccentChange; K.flatAccentSays = flatAccentSays; K.flatColorHex = flatColorHex;
    K.flatColorName = flatColorName; K.flatColorsOf = flatColorsOf; K.flatFieldSays = flatFieldSays;
    K.flatPagesName = flatPagesName; K.flatSourceLabel = flatSourceLabel; K.flatTintLabel = flatTintLabel;
    K.foldOptions = foldOptions; K.glassFooter = glassFooter; K.glassLabel = glassLabel; K.glassOf = glassOf;
    K.glassShort = glassShort; K.HA_PLACES = HA_PLACES; K.hasTabBar = hasTabBar;
    K.houseMenuAsBoard = houseMenuAsBoard; K.houseMenuSave = houseMenuSave; K.KIND_KEYS = KIND_KEYS;
    K.kindUsers = kindUsers; K.LADDER = LADDER; K.ladderFacts = ladderFacts; K.ladderSignature = ladderSignature;
    K.MENU_KEYS = MENU_KEYS; K.MENU_KINDS = MENU_KINDS; K.menuFor = menuFor; K.menuKind = menuKind;
    K.menuMode = menuMode; K.menuOwn = menuOwn; K.menuOwnReset = menuOwnReset; K.menuOwnSet = menuOwnSet;
    K.menuStyleLabel = menuStyleLabel; K.menuSummary = menuSummary; K.menuWord = menuWord; K.ownsMenu = ownsMenu;
    K.PAGE_HEADER_SAYS = PAGE_HEADER_SAYS; K.PAGE_HEADERS = PAGE_HEADERS; K.PHONE_MENUS = PHONE_MENUS;
    K.phoneButton = phoneButton; K.phoneMenu = phoneMenu; K.phoneSummary = phoneSummary; K.phoneTab = phoneTab;
    K.roomsPlace = roomsPlace; K.showsTab = showsTab; K.SKY_PAGE_LABELS = SKY_PAGE_LABELS; K.SLOW_FPS = SLOW_FPS;
    K.slowRecommend = slowRecommend; K.TAB_BAR_GLASS = TAB_BAR_GLASS; K.TAB_BAR_LABELS = TAB_BAR_LABELS;
    K.TAB_BAR_MORE = TAB_BAR_MORE; K.TAB_BAR_POS = TAB_BAR_POS; K.TAB_BAR_ROOMS = TAB_BAR_ROOMS;
    K.TAB_BAR_SCROLLS = TAB_BAR_SCROLLS; K.TAB_BAR_SIZES = TAB_BAR_SIZES; K.TAB_BAR_TABS = TAB_BAR_TABS;
    K.TAB_BAR_TABS_PHONE = TAB_BAR_TABS_PHONE; K.TAB_SIZES = TAB_SIZES; K.tabletSummary = tabletSummary;
    K.tabletTab = tabletTab; K.tabletTabBar = tabletTabBar; K.tabPosJoin = tabPosJoin; K.tabPosLabel = tabPosLabel;
    K.tabPosParts = tabPosParts; K.usedBy = usedBy; K.usesSide = usesSide;
  };
})();
