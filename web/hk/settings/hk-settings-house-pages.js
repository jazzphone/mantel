// hk-settings-house-pages.js - All Screens: Pages, House, header, Weather and radar, Side Pane, Looks, Pages screen.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-house-pages'] = function (KIT) {
    var DOMAIN = KIT.DOMAIN, HOUSE = KIT.HOUSE, PAGE_ORDERS = KIT.PAGE_ORDERS, PAGE_SCOPE = KIT.PAGE_SCOPE,
        SLEEP_LISTS = KIT.SLEEP_LISTS;

    var F, h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      F = s.F; h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // ---------------------------------------------------------- all screens
      p_music(sub) {
        var self = this, base = '#/features/music', title = 'Music';
        var mk = function (tt, body) { return { title: tt, back: [title, base], body: body }; };
        if (sub[0] === 'categories') return mk('Categories', function (c) { self.h_categories(c); });
        if (sub[0] === 'discover') return mk('Discover Rows', function (c) { self.h_discover(c); });
        // the Music feature's own pages (hk-settings-features.js)
        var fp = sub.length ? F.page(this, ['music'].concat(sub)) : null;
        if (fp) return fp;
        return { title: title, top: true, scope: 'Applies to every screen.', body: function (c) { self.h_music(c); } };
      }
      // ================================================================ PAGES
      // THE PAGES SECTION (2026-10-16, PLAN-2026-10-16-pages-settings.md):
      // each generated page's settings on one page of its own, the same groups
      // in the same order -- Header, Status Row, What's on It, the page's own,
      // Background, Its Pill on Home, Related. A page that comes from a
      // feature (Energy, Music, Live TV) opens on that feature's settings;
      // those pages' own sub-pages keep their #/features/... addresses.
      pageHas() {
        var st = (this.client && this.client.states) || {}, n = function (dom) {
          return Object.keys(st).filter(function (k) { return k.indexOf(dom + '.') === 0; }).length;
        };
        return { kinds: this.data.kinds || {}, alarm: this.hs('security.alarm'), cameras: n('camera'), calendars: n('calendar'), weather: n('weather') };
      }
      pagesListed() { return M.pagesListed(this.pageHas()); }
      // a page's line under its name in the sidebar
      pageSays(key) {
        var S = this.data.settings || {}, bits = [];
        if (M.HEADER_PAGES[key]) bits.push(((S.headers || {})[key] || {}).show === false ? 'Header Off' : 'Header On');
        var ch = ((this.data.choices || {}).status_rows || {})[key];
        if (ch) bits.push('Row: ' + M.statusSummary(Object.assign({ status: ch.default }, (S.status_rows || {})[key]).status));
        var f = M.PAGE_FEATURES[key];
        if (f && (key === 'energy' || key === 'power' || key === 'live_tv')) {
          var t = F.LIST.filter(function (x) { return x[0] === f; })[0];
          if (t && F.stateOf(this.data.features, t[1]) !== 'added') bits.push('Not Set Up');
        }
        return bits.join(' · ') || null;
      }
      p_page(key, sub) {
        var self = this, t = M.pageOf(key);
        if (!t) return this.p_overview();
        var base = '#/page/' + key, title = t[1];
        var mk = function (tt, body, back) { return { title: tt, back: back || [title, base], body: body }; };
        var s0 = sub[0];
        if (s0 === 'status' && ((this.data.choices || {}).status_rows || {})[key]) {
          // @ts-expect-error h_statusRow(c, page) takes two arguments (the third, true, is not read)
          return mk('Status Row', function (c) { self.h_statusRow(c, key, true); });
        }
        if (s0 === 'background') {
          var row = this.skyRow(key, null);
          return mk('Background', function (c) {
            if (row && self.flatHere(null)) self.flatPagePicker(c, null, null, row, '#/house/appearance/sky');
            else if (row) self.pagePicker(c, null, null, row);
            else c.appendChild(K.group({ footer: 'This page isn’t on any screen yet, so it has no background to choose.' }, []));
          });
        }
        if (s0 === 'pill' && M.PAGE_PILL_DEFAULTS[key]) return mk('Its Pill on Home', function (c) { self.s_pill(c, null, null, key); });
        if (s0 === 'accent') return mk('Accent Color', function (c) { self.pageAccent(c, key); });
        if (s0 === 'order' && PAGE_ORDERS[key]) return { title: 'Tile Order', back: [title, base], scope: this.orderScope(key),
                                                        body: function (c) { self.a_pageOrder(c, key); } };
        if (key === 'timers' && s0 === 'house') return mk('House Timers', function (c) { self.h_timers(c); });
        if (key === 'weather' && s0 === 'sensors') return mk('Sensors', function (c) { self.h_weatherSensors(c); });
        if (key === 'weather' && s0 === 'forecast') return mk('Forecast & Details', function (c) { self.h_weatherForecast(c); });
        if (key === 'weather' && s0 === 'radar') {
          if (sub[1] === 'advanced') return mk('Advanced', function (c) { self.h_radarAdvanced(c); }, ['Radar Map', base + '/radar']);
          if (sub[1] === 'yaml') return mk('Weather Radar Card Options', function (c) { self.h_radarLegacy(c); }, ['Radar Map', base + '/radar']);
          return mk('Radar Map', function (c) { self.h_radar(c); });
        }
        if (key === 'calendar' && s0) return mk(self.name(s0), function (c) { self.h_calendarOne(c, s0); });
        if (s0) return this.p_page(key, []);
        return { title: title, top: true, scope: PAGE_SCOPE[key] || 'This page’s settings, on every screen that shows it.',
                 body: function (c) { self.h_page(c, key); } };
      }
      // a feature's own settings page, drawn here (its top page's body)
      pageFeature(c, route) {
        var fp = F.page(this, [route]);
        if (fp && fp.body) fp.body(c);
      }
      h_page(c, key) {
        var self = this, S = this.data.settings || {}, base = '#/page/' + key;
        var set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
        // THE PAGE'S OWN, first where the page is a feature's or one of All
        // Screens' old pages (Weather, Calendar, Cameras): what it is about
        if (key === 'energy') this.pageFeature(c, 'energy');
        if (key === 'music') this.h_music(c);
        if (key === 'live_tv') this.pageFeature(c, 'tv');
        if (key === 'weather') this.h_weather(c);
        if (key === 'calendar') this.h_calendar(c);
        if (key === 'power') {
          var pp = F.page(this, ['energy', 'power']);
          if (pp && pp.body) pp.body(c);
          c.appendChild(K.group({ footer: 'The circuits, meters and batteries the Power page draws are the Energy page’s devices.' }, [
            K.nav({ label: 'Energy’s Devices', icon: 'mdi:lightning-bolt', href: '#/features/energy/devices', fk: 'page:power:devices' })]));
        }
        // 1. HEADER
        if (M.HEADER_PAGES[key]) {
          this.h_header(c, key);
          var off = M.headerOffOn(this.data.boards, key);
          if (off.length) {
            c.appendChild(K.group({ footer: 'Each screen’s own Page Headers can turn this header off there.' }, off.map(function (p) {
              var d = self.dash(p);
              return K.nav({ label: d ? d.title : p, value: 'Off on This Screen', icon: 'mdi:monitor-dashboard',
                             href: '#/screens/' + encodeURIComponent(p) + '/page-headers', fk: 'page:hdoff:' + p });
            })));
          }
        }
        // 2. STATUS ROW
        var ch = ((this.data.choices || {}).status_rows || {})[key];
        if (ch) {
          var cur = Object.assign({ status: ch.default }, (S.status_rows || {})[key]);
          c.appendChild(K.group({ header: 'Status Row', footer: 'Under the page’s name: what it shows, in order, and the rooms it leaves out.' }, [
            K.nav({ label: 'Status Row', value: M.statusSummary(cur.status), href: base + '/status', sk: 'status_rows.' + key })]));
        }
        // 3. THE PAGE'S OWN SETTINGS
        if (key === 'security') {
          var sugg = !this.hs('security.alarm') && (this.data.suggest || {}).alarm;
          c.appendChild(K.group({ header: 'Security System', footer: 'The header’s security line, the Security chip and page, and the alarm keypad.' }, [
            this.entityRow({ label: 'Alarm Panel', sk: 'security.alarm', value: this.hs('security.alarm'), none: 'No Alarm',
                             filter: { domains: ['alarm_control_panel'] }, onPick: set('security.alarm') }),
            sugg ? K.button({ label: 'Use ' + this.name(sugg), fk: 'alarm:suggest', onClick: function () { set('security.alarm')(sugg); } }) : null]));
          this.pageFeature(c, 'alarm');
          c.appendChild(K.group({ header: 'Alarm Keypad', footer: 'Empty for most alarms: a refused code shows “Wrong Code” by itself. Only for a panel that fails silently.' }, [
            this.entityRow({ label: 'Wrong-Code Indicator', sk: 'features.alarm_bad_code', value: this.hs('features.alarm_bad_code'), none: 'Automatic',
                             filter: { domains: ['input_boolean', 'binary_sensor'] }, onPick: set('features.alarm_bad_code') })]));
        }
        if (key === 'timers') {
          var ht = this.hs('features.house_timers') || [];
          c.appendChild(K.group({ header: 'House Timers', footer: 'One-tap timers on the Timers page — a nap, bedtime. Their names and icons are Home Assistant’s.' }, [
            K.nav({ label: 'House Timers', value: ht.length ? String(ht.length) : 'None', href: base + '/house', sk: 'features.house_timers' })]));
        }
        if (key === 'vacuums') {
          this.pageFeature(c, 'clean');
          c.appendChild(K.group({ header: 'Your Own Script', footer: 'Empty: cleaning by area goes through Clean Areas. Only for a house whose own script receives the areas.' }, [
            this.entityRow({ label: 'Clean-Areas Script', sk: 'features.vacuum_script', value: this.hs('features.vacuum_script'), none: 'Clean Areas',
                             filter: { domains: ['script'] }, onPick: set('features.vacuum_script') })]));
        }
        if (key === 'cameras') this.h_cameras(c, true);
        // 4. WHAT'S ON IT: the accessory types, each its own page under
        // Accessories, and the page's tile order where it has one
        var types = (M.PAGE_TYPES[key] || []).map(function (k) { return M.accType(k); }).filter(Boolean);
        if (types.length) {
          var rows = types.map(function (T) {
            return K.nav({ label: T[1], icon: T[2], value: String(self.typeCount(T)), href: '#/accessories/type/' + T[0], fk: 'page:type:' + T[0] });
          });
          if (PAGE_ORDERS[key]) {
            var po = ((this.data.accessories || {}).pages || {})[key] || [];
            rows.push(K.nav({ label: 'Tile Order', value: po.length ? 'Custom' : 'Automatic', href: base + '/order', sk: 'accessories.pages.' + key }));
          }
          rows.push(K.nav({ label: 'Hidden Accessories', icon: 'mdi:eye-off', href: '#/accessories/hidden', fk: 'page:hidden' }));
          c.appendChild(K.group({ header: 'What’s on It', footer: 'Names, icons, rooms and what counts are each accessory’s own, the same on every page.' }, rows));
        }
        // 5. BACKGROUND and 6. ITS PILL ON HOME
        var look = [], row = this.skyRow(key, null), bds = (this.data.choices || {}).sky_backdrops || [];
        if (row && key !== 'cameras') {          // (Cameras' is in its Related)
          look.push(K.nav({ label: 'Background', value: this.skyPageLabel(row, null),
                            href: base + '/background', sk: (this.flatHere(null) ? 'sky.flat_pages:' : 'sky.pages:') + key }));
        }
        if (M.PAGE_PILL_DEFAULTS[key]) {
          var own = (this.hs('look.page_pills') || {})[key] || {};
          look.push(K.nav({ label: 'Its Pill on Home', value: Object.keys(own).length ? 'Customized' : 'Default', href: base + '/pill', sk: 'look.page_pills:' + key }));
        }
        // 7. ITS ACCENT COLOR (2026-10-17): the menu's color for it while a
        // screen's Highlight Color is Automatic, and in Flat its Automatic
        // background's shade
        var pa = M.pageAccentOf(key, this.hs('look.page_accents'));
        look.push(K.nav({ label: 'Accent Color', value: pa.own ? pa.a.name : 'Default (' + pa.d.name + ')', href: base + '/accent',
                          tile: ['', pa.a.hex], sk: 'look.page_accents:' + key }));
        // 8. FLAT COLORS (2026-10-17): Flat's own palette for this page, over
        // the screens' general colors -- where any screen uses Flat
        var lookFoot = 'Its background on every screen that doesn’t choose its own, the pill in a screen’s Scenes row that opens it, and its Accent Color: the page’s identity in every look — its color in the menu while a screen’s Highlight Color is Automatic, and in Flat the shade of its Automatic background.';
        if (row && this.flatAnywhere()) {
          look.push(this.flatColorsNav(this.flatScope('house-page', null, null, key), { tile: false, inherited: 'Same as All Screens' }));
          lookFoot += ' Flat Colors: Flat’s own Accent Color and Off Pill Tint for this page; Automatic uses the Accent Color above.';
        }
        if (look.length) c.appendChild(K.group({ header: 'Look', footer: lookFoot }, look));
        // 7. ON SCREENS: every generated screen, whether it shows the page --
        // each a way to that screen's Pages on This Screen, the page's row lit
        var dash = this.data.dashboards.filter(function (d) { return d.item && d.generated; }), bd = this.data.boards || {};
        var offHd = M.headerOffOn(bd, key);
        var scr = dash.map(function (d) {
          var b = bd[d.path] || {}, shows = M.screenShows(b, key);
          var a = K.nav({ label: d.title, icon: 'mdi:monitor-dashboard',
                          sub: shows && offHd.indexOf(d.path) >= 0 ? 'Header off on this screen' : null,
                          value: shows ? 'Shown' : 'Not Shown', href: '#/screens/' + encodeURIComponent(d.path) + '/pages', fk: 'page:screen:' + d.path });
          // its row on that page, lit when it opens (render's _flash)
          a.addEventListener('click', function () { self._flash = ['pages:grip:' + key, 'place:' + key, 'opages:grip:' + key, 'pages:' + key]; });
          return a;
        });
        if (scr.length) {
          c.appendChild(K.group({ header: 'On Screens', footer: 'Which pages a screen shows, and where each sits in its menu, is that screen’s own: tap one to change it there.' }, scr));
        }
        var rel = [];
        if (key === 'music') rel.push(K.nav({ label: 'Now Playing', sub: 'The bar or side pane on every page', icon: 'mdi:music', href: '#/house/nowplaying', fk: 'page:rel:np' }));
        if (key === 'climate' || key === 'energy') {
          var chip = key === 'climate' ? 'climate' : 'energy';
          rel.push(K.nav({ label: (M.CHIP_LABELS[chip] || chip) + ' Chip', sub: this.chipSays(this.chipScreens(chip)), icon: 'mdi:label-multiple',
                           href: '#/house/chips/' + chip, fk: 'page:rel:chip' }));
        }
        if (key === 'weather') rel.push(K.nav({ label: 'Screensaver', sub: 'Its forecast and weather screen read these too', icon: 'mdi:image-multiple', href: '#/house/screensaver', fk: 'page:rel:saver' }));
        if (rel.length) c.appendChild(K.group({ header: key === 'cameras' ? 'Also' : 'Related' }, rel));
      }
      p_house(page, sub) {
        // WHAT COUNTS (2026-10-13) is each type's page under Accessories now: its
        // old addresses (#/house/counts/<kind>) open the type
        if (page === 'counts') return this.p_accessories(sub[0] && M.accType(sub[0]) ? ['type', sub[0]] : []);
        var self = this, t = HOUSE.filter(function (p) { return p[0] === page; })[0];
        if (!t) return this.p_overview();
        var base = '#/house/' + page, title = t[1];
        var scope = 'Applies to every screen.';
        var mk = function (tt, body, back) { return { title: tt, back: back || [title, base], body: body }; };
        // STATUS CHIPS (2026-10-13): every screen's chip row, and each chip
        // across the screens -- Always or When Active, set right there
        if (page === 'chips') {
          if (sub[0]) {
            var ck = decodeURIComponent(sub[0]), cc = ck.indexOf('chip:') === 0 ? this.customChip(ck.slice(5)) : null;
            return mk((cc ? cc.name : M.CHIP_LABELS[ck] || ck) + ' Chip', function (c) { self.h_chipOne(c, ck); });
          }
          return { title: title, top: true, scope: 'Which chips each screen shows is its own. Here they are side by side, and each chip on every screen.',
                   body: function (c) { self.h_chips(c); } };
        }
        if (page === 'pagesscreen') {
          var hps = { house: true, base: base };
          if (sub[0] === 'icons') return mk('Icons', function (c) { self.pagesScreenIcons(c, hps); });
          return { title: title, top: true, scope: 'Applies to every screen that doesn’t choose its own.',
                   body: function (c) { self.pagesScreenPage(c, hps); } };
        }
        if (page === 'sidepane') return this.p_sidePane(null, sub, [title, base]);
        if (page === 'nowplaying') {
          return { title: title, top: true, scope: 'Applies to every screen that doesn’t choose its own.', body: function (c) { self.h_nowPlaying(c); } };
        }
        if (page === 'appearance') {
          // THE PREVIEW (2026-10-31): the look alone, on a screen that follows All Screens' Appearance (none: no
          // preview, as before)
          // (the Background's pages pick their own screen for the sky's themes: kept)
          var lp = this.lookFollower(), hr = this.houseAppearance(sub, mk, base, title);
          if (hr && !hr.preview && lp) hr.preview = lp;
          if (hr && hr.preview) hr.lookPreview = true;
          return hr;
        }
        if (page === 'menu') {
          // ALL SCREENS -> MENU (2026-10-29): each kind of menu a page of its own
          var hctx = this.menuCtx(null, null), hmv = hctx.v;
          if (sub[0] === 'side' && (sub[1] === 'tablets' || sub[1] === 'phones')) {
            var sbH = ['Side Menu', base + '/side'];
            var pickH = function (k) { return function (v) { var ch = {}; ch[k] = v; hctx.set(ch); self.back(sbH[1]); }; };
            return sub[1] === 'phones'
              ? mk('Button Style on Phones', function (c) { self.phoneStyle(c, M.phoneButton(hmv), pickH('button_phone'), hmv.swipe); }, sbH)
              : mk('Button Style', function (c) { self.menuStyle(c, hmv.menu, pickH('menu'), hmv.swipe); }, sbH);
          }
          var hkind = M.menuKind(sub[0]);
          if (hkind) return Object.assign(mk(hkind[1], function (c) { self.kindPage(c, self.menuCtx(null, null), hkind[0]); }), { scope: this.usedLine(hkind[0]) });
          if (sub[0] === 'header') return mk('Back Button & Title', function (c) { self.headerPage(c, self.menuCtx(null, null)); });
          return { title: title, top: true, scope: scope, body: function (c) { self.h_menu(c); } };
        }
        if (page === 'rooms') {
          if (sub[0] === 'order') return mk('Room Order', function (c) { self.h_roomOrder(c); });
          // THE ROOM PAGES' STATUS ROW (Status Rows' until 2026-10-16)
          if (sub[0] === 'status') return mk('Room Status Row', function (c) { self.h_statusRow(c, 'rooms'); });
          var areasH = (this.client && this.client.areas) || {};
          if (sub[0] && areasH[sub[0]]) {
            var aid = sub[0], rn = this.areaName(aid), rb = [rn, base + '/' + encodeURIComponent(aid)];
            if (sub[1] === 'order') return { title: 'Tile Order', back: rb, body: function (c) { self.a_roomOrder(c, aid); } };
            if (sub[1] === 'scenes') return { title: 'Scenes', back: rb, body: function (c) { self.a_roomScenes(c, aid); } };
            var rp = mk(rn, function (c) { self.h_room(c, aid); });
            // opened from a screen's own room list too: say whose these are
            rp.scope = 'This room’s own settings, the same on every screen.';
            return rp;
          }
          return { title: title, top: true, scope: 'Applies to every screen whose Rooms are Same as All Screens; each room’s own settings, to every screen.',
                   body: function (c) { self.h_rooms(c); } };
        }
        // SCREENSAVER (its own entry since 2026-10-13): every screen whose Same
        // as All Screens is on
        if (page === 'screensaver') {
          var bd = this.data.boards || {};
          // the preview: a screen that follows these, else any screen with the
          // screensaver, shown with these settings (1.8.0: every screen with
          // its own settings left the page with no preview at all)
          var withSaver = Object.keys(bd).filter(function (p) { return bd[p].screensaver && bd[p].screensaver_engine !== 'wallpanel'; });
          var pv = withSaver.filter(function (p) { return M.saverFollows(bd[p]); })[0] || withSaver[0];
          // (the Clock Style page is the editor's now, Look -> Big -> Face: its old address opens the editor)
          if (sub[0] === 'editor' || sub[0] === 'clock-style') {
            return this.saverEditorPage('house', { house: true, path: pv || '', previewPath: pv, title: 'All Screens', back: [title, '#/house/screensaver'],
              options: this.hs('look.saver') });
          }
          if (sub[0] === 'weather') {
            var wcur = M.saverOptions(this.hs('look.saver'));
            var hwpg = mk('Weather', function (c) { self.saverWeather(c, wcur, self.saverPutH()); });
            if (pv) { hwpg.preview = pv; hwpg.saverPreview = true; hwpg.saverHouse = true; }
            hwpg.saverWeather = true;
            return hwpg;
          }
          if (sub[0] === 'energy') {
            var ecur = M.saverOptions(this.hs('look.saver'));
            var hepg = mk('Home Energy', function (c) { self.saverEnergy(c, ecur, self.saverPutH()); });
            if (pv) { hepg.preview = pv; hepg.saverPreview = true; hepg.saverHouse = true; }
            hepg.saverEnergy = true;
            return hepg;
          }
          var spg = { title: title, top: true, body: function (c) { self.h_saver(c); },
                      scope: 'What every screen’s screensaver shows, unless it has its own. When a tablet goes dark is its own Sleep Screen’s (Wall Tablets).' };
          if (pv) { spg.preview = pv; spg.saverPreview = true; spg.saverHouse = true; }
          return spg;
        }
        // WALL TABLETS (1.14): the tablets themselves, each its own page
        if (page === 'tablets') {
          if (sub[0] === 'screensaver') {
            // its old address (before 2026-10-13): forwarded to its own entry
            try { history.replaceState(null, '', '#/house/screensaver' + (sub[1] ? '/' + sub.slice(1).join('/') : '')); } catch (e) { /* no history */ }
            return this.p_house('screensaver', sub.slice(1));
          }
          var all = this.tabs();
          if (sub[0] === 'add') return mk('Add Tablet', function (c) { self.t_add(c); });
          if (sub[0] && all[sub[0]]) {
            var tid = sub[0], tt = all[tid], tb = [tt.name, base + '/' + encodeURIComponent(tid)];
            var tx = { tablet: tid, path: tt.screen, title: tt.name };
            if (sub[1] === 'sleep' && sub[2] && SLEEP_LISTS[sub[2]]) {
              return { title: SLEEP_LISTS[sub[2]].title, back: ['Sleep Screen', tb[1] + '/sleep'], body: function (c) { self.s_sleep_list_t(c, tx, tid, sub[2]); } };
            }
            if (sub[1] === 'sleep') return { title: 'Sleep Screen', back: tb, body: function (c) { self.s_sleep(c, tx, self.tabs()[tid]); } };
            if (sub[1] === 'copy') return { title: 'Copy Sleep Screen', back: tb, body: function (c) { self.t_copySleep(c, tid); } };
            return { title: tt.name, back: [title, base], body: function (c) { self.t_one(c, tid); } };
          }
          return { title: title, top: true, body: function (c) { self.h_tablets(c); },
                   scope: 'The tablets on your walls: how each one is doing, and what it does when nobody’s using it. What the screensaver shows is in Screensaver.' };
        }
        return this.p_overview();
      }
      h_timers(c) {
        var self = this, cur = this.hs('features.house_timers') || [];
        var set = function (v) { self.setH({ 'features.house_timers': v }); };
        c.appendChild(K.listEditor({ fk: 'timers', shownHeader: 'House Timers', emptyText: 'None', announce: this.announce.bind(this),
          rows: cur.map(function (id) { return { value: id, label: self.name(id) }; }),
          onChange: set, addLabel: 'Add Timer…', onAddOther: function () {
            self.go(self.picker('timer-add', { title: 'Add Timer', value: null, multi: true,
              items: function () { return self.entityIds({ domains: ['timer'] }).filter(function (id) { return cur.indexOf(id) < 0; })
                .map(function (id) { return { value: id, label: self.name(id), sub: id }; }); },
              onPick: function (id) { if (id) set(cur.concat(id)); } }));
          } }));
      }
      // A STATUS ROW: a room page's (Rooms), or a page's (Pages -> the page)
      // -- what it shows, in its order, and the rooms a page's leaves out
      h_statusRow(c, page) {
        // (a page's header is on its own page, Pages -> the page, since 2026-10-16)
        var self = this, S = this.data.settings, ch = this.data.choices || {};
        var rooms = page === 'rooms';
        var spec = rooms ? { kinds: ch.status_kinds || [], default: ch.status_kinds || [] } : (ch.status_rows || {})[page];
        if (!spec) return;
        var cur = rooms ? { status: (S.rooms || {}).status || [], exclude_areas: [] }
                        : Object.assign({ status: spec.default, exclude_areas: [] }, (S.status_rows || {})[page]);
        var save = function (status, areas) {
          if (rooms) { self.setH({ 'rooms.status': status }); return; }
          var o = {}; o['status_rows.' + page] = { status: status, exclude_areas: areas };
          self.setH(o);
        };
        var item = function (k) { return { value: k, label: M.STATUS_LABELS[k] || k, sub: M.STATUS_SAYS[k] }; };
        c.appendChild(K.listEditor({ fk: 'st', shownHeader: 'Shown', moreHeader: 'More', announce: this.announce.bind(this),
          shownFooter: 'In this order, each when there’s something to say. Drag to change the order; remove one to hide it.' +
            (rooms ? ' A room’s temperature and humidity are its area’s own sensors (Settings → Areas → Related sensors); ' +
                     'its lights, outlets, fans and the other accessories are the tiles on its page.' : ''),
          emptyText: rooms ? 'Nothing — room pages have no status row' : 'Nothing — the page has no status row',
          rows: cur.status.map(item),
          more: spec.kinds.filter(function (k) { return cur.status.indexOf(k) < 0; }).map(item),
          onChange: function (v) { save(v, cur.exclude_areas); } }));
        if (JSON.stringify(cur.status) !== JSON.stringify(spec.default)) {
          c.appendChild(K.group({}, [K.button({ label: 'Reset to Default Order', fk: 'st:reset',
            onClick: function () { save(spec.default.slice(), cur.exclude_areas); } })]));
        }
        if (rooms) return;
        // SOURCES: what each item shown counts -- Status & Chips' kinds, less
        // the rooms left out below (the server's count knows nothing of those)
        var seen = {}, sources = [];
        cur.status.forEach(function (k) {
          var src = M.STATUS_SOURCE[k];
          if (k === 'security') {
            var alarm = (S.security || {}).alarm;
            sources.push(K.nav({ label: 'Security System', value: alarm ? self.name(alarm) : 'Automatic',
                                 href: '#/page/security', sk: 'security.alarm' }));
            return;
          }
          if (!src || seen[src]) return;
          seen[src] = true;
          var ck = (self.data.counts || {})[src] || { found: [] };
          var n = ck.found.filter(function (id) { return cur.exclude_areas.indexOf(self.areaOf(id)) < 0; }).length;
          var name = (M.COUNT_KINDS.filter(function (x) { return x[0] === src; })[0] || [0, src])[1];
          sources.push(K.nav({ label: name, value: n + ' Included', href: '#/accessories/type/' + src, sk: 'counts.' + src }));
        });
        if (sources.length) c.appendChild(K.group({ header: 'Sources', footer: page === 'climate'
            ? 'Related sensors are chosen in Home Assistant’s area settings. Temperature and humidity use current readings; unavailable readings do not affect the range.'
            : 'What HK finds, less the rooms left out below. Change what counts on each accessory: Hidden Accessories and its Also Count As.' }, sources));
        c.appendChild(K.group({ header: 'Rooms', footer: 'Leave a room out of this row and its lists — an outdoor area, a shed — without hiding it anywhere else.' },
          this.areasAZ().map(function (aid) {
            var included = cur.exclude_areas.indexOf(aid) < 0;
            return K.check({ label: self.areaName(aid), multi: true, on: included, fk: 'st-area:' + aid,
              onClick: function () {
                save(cur.status, included ? cur.exclude_areas.concat(aid) : cur.exclude_areas.filter(function (a) { return a !== aid; }));
              } });
          })));
      }
      // THE PAGE'S HEADER (settings.headers.<page>, hk-headers.js): the cards
      // between the status row and the accessories. Each works itself out from
      // the house; these are only the guesses that can be wrong, each saying
      // what Automatic is.
      h_header(c, page) {
        var self = this, S = this.data.settings || {};
        var D = M.HEADER_PAGES[page].defaults;
        var cur = Object.assign({}, D, (S.headers || {})[page] || {});
        var save = function (k, v) {
          var o = {}, next = Object.assign({}, cur);
          next[k] = v;
          o['headers.' + page] = next;
          self.setH(o);
        };
        var listRow = function (k, label, sub, items, title, auto) {
          var v = cur[k];
          var href = self.picker('hd:' + page + ':' + k, { title: title, value: null, multi: true, verb: 'Use',
            items: items, onPick: function (ids) { if (ids && ids.length) save(k, [].concat(ids)); } });
          var rows = [K.nav({ label: label, sub: sub, value: Array.isArray(v) ? (v.length === 1 ? self.name(v[0]) || self.areaName(v[0]) : v.length + ' Chosen') : auto,
                              href: href, sk: 'headers.' + page, fk: 'hd:' + k })];
          if (Array.isArray(v)) rows.push(K.button({ label: 'Back to Automatic', fk: 'hd:' + k + ':auto', onClick: function () { save(k, null); } }));
          return rows;
        };
        var ents = function (domains, filt) {
          return function () {
            return self.entityIds({ domains: domains, shown: true }).filter(filt || function () { return true; })
              .map(function (id) { return { value: id, label: self.name(id), sub: id }; });
          };
        };
        var head = M.HEADER_PAGES[page];
        c.appendChild(K.group({ header: 'Header', footer: head.footer }, [
          K.toggle({ label: 'Show Header', sub: head.what, on: cur.show !== false, sk: 'headers.' + page, fk: 'hd:show',
                     onChange: function (on) { save('show', on); } })]));
        // THE LIGHTS PAGE'S BACKDROP follows the light outside: Adaptive
        // Lighting's color temperature when the house has it, else the sun's
        if (page === 'lights') {
          var al = this.entityIds({ domains: ['switch'] }).filter(function (id) {
            var a = (self.client.states[id] || {}).attributes || {};
            return /adaptive_lighting/.test(id) && a.color_temp_kelvin != null;
          });
          c.appendChild(K.group({ header: 'Background', footer: al.length
              ? 'The page’s amber takes the color of the light outside, warm at dusk and cooler at midday — from Adaptive Lighting. Automatic reads ' + (self.name(al.slice().sort(function (a, b) { return /** @type {any} */ (/default/.test(b)) - /** @type {any} */ (/default/.test(a)) || (a < b ? -1 : 1); })[0]) || 'the first one') + '.'
              : 'The page’s amber takes the color of the light outside, warm at dusk and cooler at midday — worked out from the sun. With Adaptive Lighting installed it follows that instead.' },
            [K.toggle({ label: 'Follow the Sun', on: cur.sky_follow !== false, sk: 'headers.lights', fk: 'hd:sky_follow', onChange: function (on) { save('sky_follow', on); } })]
              .concat(al.length && cur.sky_follow !== false ? listRow('sky_source', 'Adaptive Lighting', null, ents(['switch'], function (id) { return al.indexOf(id) >= 0; }), 'Adaptive Lighting', 'Automatic') : [])));
        }
        if (cur.show === false) return;
        if (page === 'climate') {
          c.appendChild(K.group({ footer: 'Automatic counts every thermostat on the page that reports when it heats and cools (up to three).' },
            listRow('thermostats', 'Thermostats Counted', 'Heating & Cooling Today', ents(['climate']), 'Thermostats Counted', 'Automatic')));
        } else if (page === 'lights') {
          c.appendChild(K.group({ header: 'Lighting Through the Day' }, [
            K.seg({ label: 'Rooms Shown', options: [[2, '2'], [3, '3'], [4, '4'], [5, '5']], value: cur.rooms || 3, sk: 'headers.lights', fk: 'hd:rooms',
                    onChange: function (v) { save('rooms', Number(v)); } })]));
          c.appendChild(K.group({ header: 'Left On', footer: 'A light on in a room whose motion, occupancy or presence sensors have all said nobody for this long. ' +
              'A room without such a sensor is never named. Automatic leaves out the rooms this row leaves out, and outdoor ones — a yard, a deck, the garage.' },
            [K.toggle({ label: 'Show Left On', on: cur.left_on !== false, sk: 'headers.lights', fk: 'hd:left_on', onChange: function (on) { save('left_on', on); } }),
             K.select({ label: 'Empty For', options: [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']],
                        value: cur.after_min || 10, sk: 'headers.lights', fk: 'hd:after', onChange: function (v) { save('after_min', Number(v)); } })]
              .concat(listRow('exclude_areas', 'Rooms Left Out', null, function () {
                return self.areasAZ().map(function (a) { return { value: a, label: self.areaName(a) }; });
              }, 'Rooms Left Out', 'Automatic'))));
          c.appendChild(K.group({ header: 'Tonight', footer: 'What your automations will do to this page’s lights in the next 16 hours, from their sun and time triggers. ' +
              'One whose conditions don’t hold right now is shown dimmed.' },
            [K.toggle({ label: 'Show Tonight', on: cur.tonight !== false, sk: 'headers.lights', fk: 'hd:tonight', onChange: function (on) { save('tonight', on); } })]
              .concat(listRow('automations', 'Automations', null, ents(['automation']), 'Automations', 'Automatic'))));
        } else if (page === 'security') {
          var way = function (k, label) {
            return listRow(k, label, null, ents(['lock', 'binary_sensor', 'cover'], function (id) {
              var dc = (self.client.states[id].attributes || {}).device_class;
              return id.indexOf('binary_sensor.') !== 0 || /^(door|garage_door|opening)$/.test(dc || '');
            }), label, 'Automatic');
          };
          c.appendChild(K.group({ header: 'Your Home', footer: 'Each label on the house reads its lock and door together. ' +
              'Automatic finds them by name — a lock or door whose name says Front, Back or Garage.' },
            [K.toggle({ label: 'Show Labels', on: cur.callouts !== false, sk: 'headers.security', fk: 'hd:callouts', onChange: function (on) { save('callouts', on); } })]
              .concat(way('front_door', 'Front Door'), way('back_door', 'Back Door'), way('garage', 'Garage'))));
          c.appendChild(K.group({ header: 'Device Care', footer: 'Shown only while a lock, door, window or leak sensor needs looking after: a low battery, or one gone quiet.' },
            [K.select({ label: 'Low Battery', options: [[10, '10%'], [15, '15%'], [20, '20%'], [25, '25%'], [30, '30%'], [40, '40%']],
                       value: cur.low_battery || 20, sk: 'headers.security', fk: 'hd:battery', onChange: function (v) { save('low_battery', Number(v)); } })]));
        } else if (page === 'water') {
          // AUTOMATIC SPELLED OUT: what the header reads when nothing is chosen
          var valves = ((this.data.counts || {}).valves || {}).found || [];
          var vn = function (id) { return self.name(id) + ' ' + id; };
          var autoSupply = valves.filter(function (id) { return /main|supply|shut.?off/i.test(vn(id)); })[0] ||
            (valves.length === 1 && !/sprinkl|irrigat|garden|drip|hose|lawn|zone|pool/i.test(vn(valves[0])) ? valves[0] : null);
          c.appendChild(K.group({ header: 'Water Through the Day', footer: 'Automatic reads the water meter in Home Assistant’s Energy settings (Settings → Dashboards → Energy → Water). ' +
              'With none there, the card stays off.' }, [
            this.entityRow({ label: 'Water Meter', sk: 'headers.water', value: cur.meter, none: 'Automatic',
                             filter: { domains: ['sensor'] }, onPick: function (v) { save('meter', v || null); } })]));
          c.appendChild(K.group({ header: 'Main Supply', footer: 'The valve the header opens and closes, after asking. Automatic: ' +
              (autoSupply ? self.name(autoSupply) : 'a valve named main, supply or shut-off — none found') + '. A sprinkler or garden valve is never the supply.' }, [
            this.entityRow({ label: 'Main Supply Valve', sk: 'headers.water', value: cur.supply, none: 'Automatic',
                             filter: { domains: ['valve', 'switch'] }, onPick: function (v) { save('supply', v || null); } })]));
        } else if (page === 'timers') {
          var STEPS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 45, 60, 90, 120, 180, 240];
          var mins = function (m) { return m < 60 ? m + ' min' : m % 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : (m / 60) + (m === 60 ? ' hour' : ' hours'); };
          var pr = (cur.presets || []).slice();
          c.appendChild(K.listEditor({ fk: 'hd:presets', shownHeader: 'Quick Durations', moreHeader: pr.length < 6 ? 'More' : null, minRows: 1,
            announce: this.announce.bind(this),
            shownFooter: 'The buttons that start a timer in one tap, in this order. Up to six; the Timers page’s Quick Start needs the quick_timers.yaml package in Home Assistant.',
            rows: pr.map(function (m) { return { value: m, label: mins(m) }; }),
            more: pr.length < 6 ? STEPS.filter(function (m) { return pr.indexOf(m) < 0; }).map(function (m) { return { value: m, label: mins(m) }; }) : [],
            onChange: function (v) { if (v.length) save('presets', v.map(Number).slice(0, 6)); } }));
          var nm = (cur.names || []).slice();
          var SUGGEST = ['Pasta', 'Oven', 'Laundry', 'Tea', 'Kids', 'Break', 'Eggs', 'Nap', 'Dryer', 'Bath', 'Homework', 'Pizza', 'Rice', 'Coffee'];
          c.appendChild(K.listEditor({ fk: 'hd:names', shownHeader: 'Quick Names', moreHeader: nm.length < 6 ? 'More' : null,
            announce: this.announce.bind(this), emptyText: 'None — a new timer is just its time',
            shownFooter: 'Create a Timer offers these as names, in this order. Up to six.',
            rows: nm.map(function (n) { return { value: n, label: n }; }),
            more: nm.length < 6 ? SUGGEST.filter(function (n) { return nm.indexOf(n) < 0; }).map(function (n) { return { value: n, label: n }; }) : [],
            onChange: function (v) { save('names', v.slice(0, 6)); } }));
          if (nm.length < 6) {
            c.appendChild(K.group({ footer: 'A name of your own, up to 16 letters.' }, [
              K.text({ label: 'Add a Name', value: '', placeholder: 'Popcorn', maxlength: 16, sk: 'headers.timers', fk: 'hd:name:add',
                       onCommit: function (v) { v = String(v || '').trim(); if (v && nm.indexOf(v) < 0) save('names', nm.concat(v).slice(0, 6)); } })]));
          }
        } else if (page === 'vacuums') {
          c.appendChild(K.group({ header: 'How Runs End', footer: 'A run is Done when a vacuum’s successful-missions counter goes up, Failed or Canceled by its others. ' +
              'Automatic finds each vacuum’s own (a Roomba’s); without them a run ends when it docks.' },
            listRow('counters', 'Mission Counters', null, ents(['sensor'], function (id) { return /mission|clean/i.test(id); }), 'Mission Counters', 'Automatic')));
        }
      }
      // ADD…, right on the kind's page (2026-10-13): the same Also Count As as
      // on each accessory, for several at once -- and the way in for a group
      // helper ("Motion - Kitchen"), which is never counted by itself (its
      // members would count twice). Offered: what the kind's Also count takes
      // (for a reading, the sensors and thermostats that report it), not
      // already counted; the server adds only what it could be (hiding._also).
      countAdd(kind, ck) {
        var self = this, client = this.client, reading = kind === 'temperature' || kind === 'humidity';
        var T = M.accType(kind);
        var href = this.picker('count-add:' + kind, { title: 'Add to ' + (T ? T[1] : 'Also Count'), value: null, multi: true,
          items: function () {
            return self.entityIds({ domains: ck.also || ck.domains || [], shown: true }).filter(function (id) {
              if (ck.found.indexOf(id) >= 0 || ck.exclude.indexOf(id) >= 0) return false;
              if (!reading) return true;
              var a = (client.states[id] || {}).attributes || {};
              return id.indexOf('climate.') === 0 ? ('current_' + kind) in a : a.device_class === kind;
            }).map(function (id) { return { value: id, label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id }; });
          },
          onPick: function (v) {
            var ids = [].concat(v || []);
            if (!ids.length) return;
            var o = {}; o[kind] = true;
            self.save({ type: DOMAIN + '/hidden/also', entity_ids: ids, kinds: o }, [], function () {}, function () {})
              .then(function (ok) { if (ok) self.reload().then(function () { self.render(); }); });
          } });
        return K.nav({ label: 'Add…', href: href, fk: 'inc:add' });
      }
      // THE WEATHER PAGE'S OWN (2026-10-16): the weather service and its
      // sensors (shared with the header, Climate and the screensaver), then what
      // the Weather page shows and its radar (weather.page / weather.radar_native,
      // the page's alone)
      h_weather(c) {
        var self = this, set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
        var place = (this.client.config && this.client.config.location_name) || 'Home';
        c.appendChild(K.group({ header: 'Weather Source', footer: 'The header, Climate and the screensaver use these too. Place: the name over the temperature; empty, this home’s name, ' + String(place).toUpperCase() + '.' }, [
          this.entityRow({ label: 'Weather Service', sk: 'weather.entity', value: this.hs('weather.entity'), none: 'First Weather Entity',
                           filter: { domains: ['weather'] }, onPick: set('weather.entity') }),
          K.text({ label: 'Place', sk: 'weather.place', value: this.hs('weather.place'), placeholder: place, maxlength: 60,
                   error: this.err('weather.place'), onCommit: function (v) { self.setH({ 'weather.place': v }); } })]));
        var pg = M.wxPage(this.data.settings), r = M.radarOf(this.data.settings), plan = M.radarPlanOf(r, this.client);
        c.appendChild(K.group({ header: 'Forecast', footer: 'What the Weather page shows. Only on this page: the header and the screensaver keep their own.' }, [
          K.nav({ label: 'Forecast & Details', value: M.forecastSummary(pg), href: '#/page/weather/forecast', sk: 'weather.page' })]));
        var keys = ['feels_like', 'humidity', 'wind', 'gust', 'uv', 'outside', 'forecast_daily', 'forecast_hourly', 'alerts'];
        var n = keys.filter(function (k) { return self.hs('weather.' + k); }).length;
        c.appendChild(K.group({ header: 'Optional Readings', footer: 'Sensors are optional: without one, the weather service’s own reading is used.' }, [
          K.nav({ label: 'Sensors', value: n ? n + ' Chosen' : 'None', href: '#/page/weather/sensors', sk: 'weather.sensors' })]));
        c.appendChild(K.group({ header: 'Radar', footer: r.enabled && plan.reason ? M.RADAR_REASONS[plan.reason] : 'A precipitation radar map beside the daily forecast.' }, [
          K.nav({ label: 'Radar Map', value: M.radarSummary(r, plan), href: '#/page/weather/radar', sk: 'weather.radar_native' })]));
        c.appendChild(K.group({ header: 'Presentation', footer: 'Each card’s contents build when the page opens, as on the Energy page; the cards stay in place. Not with Reduce Motion.' }, [
          K.toggle({ label: 'Animate Page Loading', on: pg.load_animation, sk: 'weather.page.load_animation',
                     onChange: function (on) { self.wxPageSet({ load_animation: on }); } })]));
      }
      // one key of the page's composition: the whole object goes (the
      // integration checks it whole)
      wxPageSet(changes) {
        return this.setH({ 'weather.page': Object.assign(M.wxPage(this.data.settings), changes) });
      }
      radarSet(changes) {
        this.radarCheckStop();
        return this.setH({ 'weather.radar_native': Object.assign(M.radarOf(this.data.settings), changes) });
      }
      h_weatherForecast(c) {
        var self = this, pg = M.wxPage(this.data.settings);
        var tog = function (k, label, sub, dim) {
          var o = {}; return K.toggle({ label: label, sub: sub, on: pg[k], sk: 'weather.page.' + k, disabled: !!dim && !pg[k],
                                        onChange: function (on) { o[k] = on; self.wxPageSet(o); } });
        };
        var alerts = this.hs('weather.alerts');
        c.appendChild(K.group({ header: 'Show', footer: 'Weather Alerts appear only while an alert is in effect' +
            (alerts ? '.' : ', from an Alerts sensor (Optional Readings → Sensors).') }, [
          tog('show_current', 'Current Conditions'), tog('show_hourly', 'Hourly Forecast'), tog('show_daily', 'Daily Forecast'),
          tog('show_alerts', 'Weather Alerts', alerts ? null : 'Needs the NWS Alerts integration (US only) and its sensor', !alerts)]));
        c.appendChild(K.group({ header: 'Hourly Forecast', footer: 'Up to this many hours, as many as the weather service gives; they scroll sideways where they don’t fit. ' +
            'The view it opens on; a reading the service doesn’t give falls back to Temperature.' }, [
          K.seg({ label: 'Hours', sk: 'weather.page.hours', value: pg.hours, options: M.WX_HOURS,
                  onChange: function (v) { self.wxPageSet({ hours: v }); } }),
          K.seg({ label: 'Default View', sk: 'weather.page.hourly_metric', value: pg.hourly_metric, options: M.WX_METRICS,
                  onChange: function (v) { self.wxPageSet({ hourly_metric: v }); } })]));
        c.appendChild(K.group({ header: 'Daily Forecast', footer: 'Only the days the weather service gives — some give fewer.' }, [
          K.seg({ label: 'Days', sk: 'weather.page.days', value: pg.days, options: M.WX_DAYS,
                  onChange: function (v) { self.wxPageSet({ days: v }); } })]));
        var label = function (k) { var d = M.WX_DETAILS.filter(function (x) { return x[0] === k; })[0]; return d || [k, k, null]; };
        c.appendChild(K.listEditor({ fk: 'wxdetails', announce: this.announce.bind(this),
          rows: pg.details.map(function (k) { var d = label(k); return { value: k, label: d[1], icon: d[2] }; }),
          more: M.WX_DETAILS.filter(function (d) { return pg.details.indexOf(d[0]) < 0; })
            .map(function (d) { return { value: d[0], label: d[1], icon: d[2] }; }),
          shownHeader: 'Details', moreHeader: 'More Details', emptyText: 'No details',
          shownFooter: 'The tiles under the forecast, in this order. One the weather service doesn’t give says so rather than disappearing.',
          onChange: function (v) { self.wxPageSet({ details: v }); } }));
        c.appendChild(K.group({ footer: 'Puts the forecast, the details and the animation back to how they came. The weather service, sensors and radar stay.' }, [
          K.button({ label: 'Reset Forecast & Details', fk: 'weather.page.reset', destructive: true,
                     onClick: function () { self.setH({ 'weather.page': JSON.parse(JSON.stringify(M.WX_PAGE_DEFAULTS)) }); } })]));
      }
      // THE RADAR MAP (hk-radar.js): HK's own, over OpenStreetMap
      h_radar(c) {
        var self = this, r = M.radarOf(this.data.settings), plan = M.radarPlanOf(r, this.client);
        var rows = [K.toggle({ label: 'Show Radar', on: r.enabled, sk: 'weather.radar_native.enabled',
                               onChange: function (on) { self.radarSet({ enabled: on }); } })];
        var says = r.enabled ? (plan.reason ? M.RADAR_REASONS[plan.reason]
          : 'Showing ' + M.RADAR_NAMES[plan.provider] + ' radar around ' + plan.place + '.' +
            (plan.provider === 'noaa' && plan.country && plan.country !== 'US' ? ' NOAA covers the United States only.' : '')) : null;
        if (r.enabled) {
          var auto = plan.country ? (plan.country === 'US' ? 'NOAA' : 'RainViewer') : null;
          rows.push(K.select({ label: 'Radar Provider', sk: 'weather.radar_native.provider', value: r.provider,
            options: M.RADAR_PROVIDERS.map(function (p) { return p[0] === 'auto' && auto ? ['auto', 'Automatic (' + auto + ')', auto] : p; }),
            onChange: function (v) { self.radarSet({ provider: v }); } }));
          rows.push(K.select({ label: 'Base Map', sk: 'weather.radar_native.basemap', value: r.basemap, options: M.RADAR_BASEMAPS,
            onChange: function (v) { self.radarSet({ basemap: v }); } }));
          rows.push(K.seg({ label: 'Map Location', sk: 'weather.radar_native.center', value: r.center, options: M.RADAR_CENTERS,
            onChange: function (v) { self.radarSet({ center: v }); } }));
          if (r.center === 'zone') {
            rows.push(this.entityRow({ label: 'Zone', sk: 'weather.radar_native.zone', value: r.zone, none: 'Choose a Zone',
                                       filter: { domains: ['zone'] }, onPick: function (v) { self.radarSet({ zone: v || null }); } }));
          }
          rows.push(K.nav({ label: 'Advanced', value: M.radarAdvancedSummary(r), href: '#/page/weather/radar/advanced', sk: 'weather.radar_native.advanced' }));
        }
        c.appendChild(K.group({ footer: r.enabled
          ? says + ' Loads map and radar imagery for the displayed area from the selected services. Internet access required.'
          : 'A precipitation radar map on the Weather page, beside the daily forecast. Nothing is loaded while it’s off.' }, rows));
        if (r.enabled) this.radarCheckGroup(c, r, plan);
        // the providers: who they are, what they cost, where they reach
        var link = function (href, text) { return h('a', { href: href, target: '_blank', rel: 'noopener', text: text }); };
        var about = function (text, href, ltext) {
          return h('p', { style: 'margin:0 0 6px' }, [h('span', { text: text + ' ' }), h('a', { href: href, target: '_blank', rel: 'noopener', text: ltext })]);
        };
        c.appendChild(K.group({ header: 'About the Map', footer: h('div', {}, [
          about('NOAA (US): the National Weather Service’s MRMS radar, free, for the United States, Alaska, Hawaii and the Caribbean.',
                'https://www.weather.gov/disclaimer', 'NOAA/NWS terms'),
          about('RainViewer: worldwide, free for personal use, credited on the map, with no guarantee. Its radar stops at a middling zoom.',
                'https://www.rainviewer.com/api.html', 'RainViewer terms'),
          about('The street map is OpenStreetMap’s, whose public tiles are for light personal use, credited on the map.',
                'https://operations.osmfoundation.org/policies/tiles/', 'Tile usage policy')]) }, []));
        var legacy = this.hs('weather.radar') || {};
        if (Object.keys(legacy).length) {
          var odd = Object.keys(legacy).filter(function (k) { return M.RADAR_LEGACY_MAPPED.indexOf(k) < 0; });
          c.appendChild(K.group({ header: 'From the Weather Radar Card', footer: odd.length
            ? odd.length + (odd.length === 1 ? ' option has' : ' options have') + ' no equivalent here and ' + (odd.length === 1 ? 'is' : 'are') + ' kept, unused: ' + odd.join(', ') + '.'
            : 'Its zoom, radar, map movement and playback options were carried over.' }, [
            K.nav({ label: 'Weather Radar Card Options', value: String(Object.keys(legacy).length), href: '#/page/weather/radar/yaml', sk: 'weather.radar' })]));
        }
        c.appendChild(K.group({ footer: 'Turns the radar off and puts every radar setting back to its default.' }, [
          K.button({ label: 'Reset Radar', fk: 'weather.radar_native.reset', destructive: true,
                     onClick: function () { self.radarSet(JSON.parse(JSON.stringify(M.RADAR_DEFAULTS))); } })]));
      }
      h_radarAdvanced(c) {
        var self = this, r = M.radarOf(this.data.settings);
        var tog = function (k, label, sub) {
          var o = {}; return K.toggle({ label: label, sub: sub, on: r[k], sk: 'weather.radar_native.' + k,
                                        onChange: function (on) { o[k] = on; self.radarSet(o); } });
        };
        c.appendChild(K.group({ header: 'Map', footer: 'Higher is closer. RainViewer’s radar stops at its own closest level; closer than that the map still zooms and the radar is drawn larger, not sharper.' }, [
          K.select({ label: 'Initial Zoom', sk: 'weather.radar_native.zoom', value: String(r.zoom),
                     options: [4, 5, 6, 7, 8, 9, 10].map(function (n) { return [String(n), String(n)]; }),
                     onChange: function (v) { self.radarSet({ zoom: Number(v) }); } }),
          tog('marker', r.center === 'zone' ? 'Location Marker' : 'Home Marker'),
          tog('interactive', 'Move and Zoom Expanded Map', 'The page stays centered on your location. Pan and zoom are available only in the expanded map.'),
          K.slider({ label: 'Radar Opacity', sk: 'weather.radar_native.opacity', value: r.opacity, min: 20, max: 100, step: 5, unit: '%',
                     onChange: function (v) { self.radarSet({ opacity: v }); } })]));
        c.appendChild(K.group({ header: 'Playback', footer: 'Only the frames the provider has. Plays automatically on page entry, including in Flat. Reduce Motion waits for a tap, and waking never restarts playback by itself.' }, [
          K.select({ label: 'History', sk: 'weather.radar_native.history_minutes', value: String(r.history_minutes),
                     options: M.RADAR_HISTORY.map(function (x) { return [String(x[0]), x[1]]; }),
                     onChange: function (v) { self.radarSet({ history_minutes: Number(v) }); } }),
          K.seg({ label: 'Speed', sk: 'weather.radar_native.playback_speed', value: r.playback_speed, options: M.RADAR_SPEEDS,
                  onChange: function (v) { self.radarSet({ playback_speed: v }); } }),
          tog('autoplay', 'Play on Open'),
          K.info({ label: 'Playback Controls', value: 'Expanded Map Only', sub: 'The page shows a centered regional view with an expand button. Open it for playback, pan and zoom.' })]));
      }
      // the Weather Radar Card's own options, kept from before 1.16: read only
      h_radarLegacy(c) {
        var legacy = this.hs('weather.radar') || {};
        var rows = Object.keys(legacy).map(function (k) {
          var v = legacy[k], t = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return K.info({ label: k, sub: M.RADAR_LEGACY_MAPPED.indexOf(k) >= 0 ? 'Carried over' : 'No equivalent: unused', value: t.length > 40 ? t.slice(0, 39) + '…' : t });
        });
        if (!rows.length) rows.push(K.info({ label: 'Options', value: 'None' }));
        c.appendChild(K.group({ footer: 'The Weather Radar Card’s options from before HK drew its own radar, kept as they were. They no longer change the Weather page; the card itself still works on dashboards of your own.' }, rows));
      }
      // CHECK RADAR CONNECTION: on a tap only -- the provider's frames and one
      // small current image of the map's area -- never in the background.
      // Stopped by leaving the page or changing a radar setting.
      radarCheckStop() {
        if (this._rcheck) { this._rcheck.ctl.abort(); this._rcheck = null; }
      }
      radarCheckGroup(c, r, plan) {
        var self = this, sig = JSON.stringify([r, plan.provider, plan.lat, plan.lon]);
        var res = this._rcheckRes && this._rcheckRes.sig === sig ? this._rcheckRes : null;
        var rows = [K.button({ label: this._rcheck ? 'Checking…' : 'Check Radar Connection', fk: 'weather.radar_native.check',
                               sk: 'weather.radar_native.check', disabled: !!this._rcheck || !!plan.reason,
                               onClick: function () { self.radarCheck(sig, plan, r); } })];
        if (res && res.ok) {
          rows.push(K.info({ label: 'Provider', value: M.RADAR_NAMES[res.provider] }));
          rows.push(K.info({ label: 'Latest Radar', value: res.latestText }));
          rows.push(K.info({ label: 'History Available', value: res.framesText }));
          rows.push(K.info({ label: 'This Area', value: res.coverageText }));
        } else if (res) rows.push(K.info({ label: 'Couldn’t Connect', sub: res.error }));
        c.appendChild(K.group({ header: 'Connection', footer: 'Asks the provider for its latest frames and one small image of the map’s area, once.' }, rows));
      }
      radarCheck(sig, plan, r) {
        var self = this, route = location.hash;
        this.radarCheckStop();
        var ctl = new AbortController();
        this._rcheck = { ctl: ctl };
        var stop = function () { if (location.hash !== route) self.radarCheckStop(); };
        window.addEventListener('hashchange', stop);
        this.render();
        import('/hk/modules/hk-radar.js').then(function () {
          return window.hkRadar.check(plan, r, ctl.signal);
        }).then(function (got) { return got; }, function (e) {
          return { ok: false, error: (e && e.name === 'AbortError') ? null : String((e && e.message) || e) };
        }).then(function (got) {
          window.removeEventListener('hashchange', stop);
          if (ctl.signal.aborted || !got || got.error === null) return;
          self._rcheck = null;
          self._rcheckRes = Object.assign({ sig: sig }, got);
          if (location.hash === route) self.render();
        });
      }
      // THE CALENDARS the Calendar page and the screensaver's calendar pane
      // show: every calendar, A to Z (automatic), or the ones chosen, in order;
      // each with its colour (its own page)
      calIds() {
        var st = (this.client && this.client.states) || {};
        return Object.keys(st).filter(function (k) { return k.indexOf('calendar.') === 0; }).sort();
      }
      calColor(id, shown) {
        var own = (this.hs('calendar.colors') || {})[id];
        if (own) return { key: own, auto: false };
        var i = shown.indexOf(id);
        return { key: M.CAL_COLORS[(i < 0 ? 0 : i) % M.CAL_COLORS.length], auto: true };
      }
      // THE SIDE PANE (2026-10-30; hk-sidepane.js draws it, settings.py
      // side_pane): one page for All Screens (`path` null) and for each screen,
      // each group All Screens' or the screen's own (its first row's sub-line
      // says whose, one Reset at the foot). The Dashboard's and the
      // Screensaver's sections each a page (/dashboard, /saver), and each
      // section a page of its own: Size, When, and the kind's options.
      // The places that had a pane of their own link here.
      p_sidePane(path, sub, back) {
        var self = this, x = path ? this.dash(path) : null, b = path ? (this.data.boards || {})[path] : null;
        var base = path ? '#/screens/' + encodeURIComponent(path) + '/sidepane' : '#/house/sidepane';
        // THE PREVIEW at the top of the page at every width, the pane in it as
        // you change it (the owner, 2026-10-30: "it may be good to include a
        // preview for the side pane"): this screen, or on All Screens' page a
        // screen that follows it
        // -- and where every screen has a pane of its own (the owner, 2026-10-31:
        // "there still isn't a preview in the Side Pane global page"), the first
        // screen, drawing All Screens' pane instead of its own (hkSidePane.previewHouse)
        var follower = path ? null : this.paneFollower(), pv = path || follower || Object.keys(this.data.boards || {})[0] || null;
        var house = !path && !follower && !!pv;
        var top = { title: 'Side Pane', back: back, preview: pv || undefined, previewTop: !!pv, paneHouse: house };
        // THE SECTIONS (2026-10-30): the Dashboard's and the Screensaver's
        // lists, each a page of its own (#/.../sidepane/dashboard, /saver)
        var secTitle = { dashboard: 'Dashboard Sections', saver: 'Screensaver Sections' };
        if ((sub[0] === 'dashboard' || sub[0] === 'saver') && !sub[1]) {
          return { title: secTitle[sub[0]], back: ['Side Pane', base], preview: pv || undefined, previewTop: !!pv, paneHouse: house,
                   body: function (c) { self.paneSectionsPage(c, path, sub[0], base); } };
        }
        if (sub[0] === 'section' && (sub[1] === 'dashboard' || sub[1] === 'saver')) {
          var i = Number(sub[2]), p0 = this.paneNow(path), s0 = ((p0[sub[1]] || {}).sections || [])[i];
          if (!s0) return Object.assign(top, { body: function (c) { self.paneBody(c, path, x, base); } });
          return { title: (M.paneKind(s0.kind) || [0, s0.kind])[1], back: [secTitle[sub[1]], base + '/' + sub[1]], preview: pv || undefined, previewTop: !!pv, paneHouse: house,
                   body: function (c) { self.paneSection(c, path, sub[1], i); } };
        }
        return Object.assign(top, { top: !path, scope: path ? null : 'Applies to every screen that doesn’t choose its own.',
                                    body: function (c) { self.paneBody(c, path, x, base); void b; } });
      }
      // a screen whose Side Pane is All Screens' throughout (none of its groups
      // its own), else none
      paneFollower() {
        var bd = this.data.boards || {};
        return Object.keys(bd).filter(function (p) {
          var r = bd[p] && bd[p].side_pane_read;
          return !(r && r.own && r.own.length);
        })[0] || null;
      }
      // THE LOOKS (2026-10-30, hk_core looks.py; M.LOOKS): each with its
      // picture and what it is; the one applied last can be undone here
      looksPage(c, x, b, base) {
        var self = this, u = b.look_undo && M.lookOf(b.look_undo.look);
        if (u) {
          c.appendChild(K.group({ footer: 'Puts back what this screen had before ' + u.name + ': its look, its settings and, from the Home Grid editor, its layout.' }, [
            K.button({ label: 'Undo ' + u.name, fk: 'looks:undo', onClick: function () {
              K.confirm(self.shadowRoot, { title: 'Undo ' + u.name + '?', message: 'This screen goes back to how it was before.', ok: 'Undo' }).then(function (ok) {
                if (ok) self.setB(x.path, M.lookUndo(b));
              });
            } })]));
        }
        // (no header: it repeated the page's title, 2026-10-30)
        c.appendChild(K.group({ footer: 'Each sets this screen’s style and colors, its background, its tiles, the Side Pane, swiping and the ' +
          'screensaver — its layout stays. To start from a Look’s layout too, use Layout + Look in the Home Grid editor.' },
          M.LOOKS.map(function (l) { return self.lookCell(l, base + '/looks/' + l.id); })));
      }
      // A LOOK'S CELL: its picture, name and what it is -- a link in the list,
      // the top of its own page (href null)
      lookCell(l, href) {
        var W = window.hkWallpapers, wall = l.settings.sky_background === 'wallpaper' && W && W.url(l.settings.sky_wallpaper, false, l.settings.sky_wallpaper_color);
        var art = h('span', { class: 'lookart', 'aria-hidden': 'true' }, [h('i', {})]);
        art.style.backgroundImage = wall ? 'url("' + wall + '")' : 'linear-gradient(160deg,' + l.art[0] + ',' + l.art[1] + ' 55%,' + l.art[2] + ')';
        art.firstChild.style.background = l.art[3];
        var kids = [art, h('span', { class: 'st' }, [h('b', { text: l.name }), h('small', { text: l.about })])];
        return href ? h('a', { class: 'cell look', href: href, 'data-fk': 'look:' + l.id }, kids)
                    : h('div', { class: 'cell look', 'data-fk': 'look:top:' + l.id }, kids);
      }
      // ONE LOOK: what it changes on this screen (only what differs), and Apply
      lookPage(c, x, b, l, base) {
        var self = this, saver = M.saverOptions(b.screensaver_options || this.hs('look.saver'));
        var r = M.lookChanges(l, b, saver, null);
        // its cell from the list at the top (a plain row repeating the title before)
        c.appendChild(K.group({}, [this.lookCell(l, null)]));
        c.appendChild(K.group({ header: 'What Changes', footer: r.rows.length ? 'On this screen only. Its layout stays.' : 'This screen already looks this way.' },
          r.rows.map(function (row) { return K.info({ label: row[0], value: row[1] + ' → ' + row[2] }); })));
        if (r.rows.length) {
          c.appendChild(K.group({ footer: 'Looks → Undo puts it all back.' }, [K.button({ label: 'Use ' + l.name, fk: 'look:apply', onClick: function () {
            self.setB(x.path, r.changes).then(function () { self.back(base + '/looks'); });
          } })]));
        }
      }
      // THE PREVIEW'S GLASS AS ITS SLIDER MOVES (Frost, Blur, Darkness, Bright Glass's Brightness), before anything is
      // saved -- the frame's hkSettings.previewAmount, as pvPaneDim below
      pvAmount(key, v) {
        var col = this.pageEl && this.pageEl.querySelector('.pvcol'), fr = col && col.querySelector('.pvbox iframe');
        try {
          var S = fr && fr.contentWindow && fr.contentWindow.hkSettings;
          if (S && S.previewAmount) S.previewAmount(key, v);
        } catch (e) { /* not ours */ }
      }
      // THE PREVIEW'S PANE DIMMED AS THE SLIDER MOVES, before anything is saved (hk-sidepane.js reads the screen's
      // settings again when they come back)
      pvPaneDim(v) {
        var col = this.pageEl && this.pageEl.querySelector('.pvcol'), fr = col && col.querySelector('.pvbox iframe');
        try {
          var P = fr && fr.contentWindow && fr.contentWindow.hkSidePane;
          if (P && P.dim) P.dim(v);
        } catch (e) { /* not ours */ }
      }
      // the glass's Dim now (a screen's own, else All Screens'), where a pane taking its own Dim starts
      glassDimNow(path) {
        var b = path ? (this.data.boards || {})[path] : null, look = ((this.data.settings || {}).look) || {};
        var v = b && b.bright_dim != null && b.bright_dim !== '' ? b.bright_dim : look.bright_dim;
        return typeof v === 'number' ? v : 0;
      }
      paneNow(path) {
        var b = path ? (this.data.boards || {})[path] : null;
        return M.paneOf((this.data.settings || {}).side_pane, b);
      }
      // a change to one group: All Screens', or the screen's own (its pane as
      // read updated here at once; the answer brings the server's)
      paneSave(path, g, value) {
        var p = this.paneNow(path);
        if (!path) return this.setH(M.paneSet(p, g, value, false));
        var b = this.data.boards[path], ch = M.paneSet(p, g, value, true);
        b.side_pane_read = Object.assign({}, b.side_pane_read || p, (function () { var o = {}; o[g] = value; return o; })(),
                                         { own: Object.keys(ch.side_pane) });
        return this.setB(path, ch);
      }
      paneResetGroup(path, g) {
        var p = this.paneNow(path), b = this.data.boards[path], ch = M.paneReset(p, g);
        var house = M.paneOf((this.data.settings || {}).side_pane, null);
        b.side_pane_read = Object.assign({}, p, (function () { var o = {}; o[g] = house[g]; return o; })(),
                                         { own: ch.side_pane ? Object.keys(ch.side_pane) : [] });
        return this.setB(path, ch);
      }
      // WHOSE A GROUP IS, on a screen: the sub-line of its first row (null on
      // All Screens') -- one Reset at the page's foot puts them all back
      // (2026-10-30: a "Same as All Screens | All Screens" group before each)
      paneWhose(path, p, g) {
        if (!path) return null;
        return p.own.indexOf(g) >= 0 ? 'Just This Screen' : 'Same as All Screens';
      }
      paneResetAll(path) {
        var b = this.data.boards[path], house = M.paneOf((this.data.settings || {}).side_pane, null);
        b.side_pane_read = Object.assign({}, house, { own: [] });
        return this.setB(path, { side_pane: null });
      }
      // the sections of a group, in words ("Weather, Calendar and Now Playing")
      paneSecNames(grp) {
        return M.listText(((grp || {}).sections || []).map(function (s) { return (M.paneKind(s.kind) || [0, s.kind])[1]; })) || 'None';
      }
      paneBody(c, path, x, base) {
        var self = this, p = this.paneNow(path), dash = p.dashboard, saver = p.saver;
        var put = function (g, v) { return self.paneSave(path, g, v); };
        var whose = function (g) { return self.paneWhose(path, p, g); };
        // a group's Sections page: #/.../sidepane/dashboard or /saver
        var secs = function (g, grp) { return K.nav({ label: 'Sections', value: self.paneSecNames(grp), href: base + '/' + g, sk: 'pane:' + g + ':sections' }); };
        // WHERE
        c.appendChild(K.group({ header: 'Where', footer: 'A Home Grid beside it fits itself in what the pane leaves. A tablet held upright shows it as a band under the page; phones never show it.' }, [
          K.seg({ label: 'Pane Side', sk: 'pane:side', sub: whose('side'), value: p.side, options: M.PANE_SIDES, onChange: function (v) { put('side', v); } }),
          K.seg({ label: 'Width', sk: 'pane:width', sub: whose('width'), value: p.width, options: M.PANE_WIDTHS, stack: !this.hasAttribute('wide'),
                  onChange: function (v) { put('width', v); } })]));
        // THE DASHBOARD ("On the Dashboard" until 2026-10-30): Show as a
        // pop-up, its sections a page of their own
        var drows = [K.select({ label: 'Show', sk: 'pane:dashboard:show', sub: whose('dashboard'), value: dash.show, options: M.PANE_SHOWS,
                                onChange: function (v) { put('dashboard', { show: v, sections: dash.sections }); } })];
        if (dash.show !== 'off') drows.push(secs('dashboard', dash));
        c.appendChild(K.group({ header: 'Dashboard', footer: dash.show === 'all'
            ? 'On every page, each page narrowed by the pane.' : dash.show === 'home' ? 'Beside Home only.' : 'No pane beside the pages.' }, drows));
        // THE SCREENSAVER ("In the Screensaver" until 2026-10-30)
        var srows = [K.select({ label: 'Show', sk: 'pane:saver:show', sub: whose('saver'), value: saver.show, options: M.PANE_SAVER_SHOWS,
                                onChange: function (v) { put('saver', { show: v, sections: saver.sections }); } })];
        if (saver.show === 'own') srows.push(secs('saver', saver));
        c.appendChild(K.group({ header: 'Screensaver', footer: 'Down the photos’ or the clock’s side, Home Status at its top.' }, srows));
        // LOOK: SECTION HEADINGS (2026-10-30), a small title over each section
        // but the Clock and the Weather -- and THE DOORBELL (one group since
        // 2026-10-30)
        // DIM: Same as the Glass (2026-11-01, the default: Bright Glass's Dim), else the pane's own (a slider,
        // 2026-11-01, the owner: "why isn't this a slider?" -- the preview's pane follows it as it moves, and it is
        // saved once, let go)
        var dimLinked = p.dim === M.PANE_DIM_GLASS || p.dim == null;
        var dimRows = [K.toggle({ label: 'Dim Same as the Glass', sk: 'pane:dim_glass', sub: whose('dim') || 'Bright Glass’s Dim, under Appearance', on: dimLinked,
                                  onChange: function (on) { put('dim', on ? M.PANE_DIM_GLASS : self.glassDimNow(path)); } })];
        if (!dimLinked) dimRows.push(K.slider({ label: 'Dim', sk: 'pane:dim', value: M.paneDim(p.dim), min: 0, max: M.PANE_DIM_MAX, step: 5, unit: '%',
                                                onInput: function (v) { self.pvPaneDim(v); }, onChange: function (v) { put('dim', v); } }));
        c.appendChild(K.group({ header: 'Look', footer: 'Dim: a shade over the pane’s glass, for its words over a light background — the same as Bright Glass’s Dim, or its own. ' +
            'Section Headings: a small title, with its icon, over each section — not over the Clock or the Weather, which say what they are. ' +
            'The doorbell’s camera is live, for as long as its pop-up shows.' }, dimRows.concat([
          K.toggle({ label: 'Section Headings', sk: 'pane:headings', sub: whose('headings'), on: p.headings !== false, onChange: function (on) { put('headings', on); } }),
          K.toggle({ label: 'Doorbell', sk: 'pane:doorbell', sub: whose('doorbell') || 'Its camera at the top of the pane while it rings.',
                     on: p.doorbell !== false, onChange: function (on) { put('doorbell', on); } })])));
        // A SCREEN'S ONE RESET: every group it owns back to All Screens'
        if (path && p.own.length) {
          c.appendChild(K.group({ footer: 'Every setting above follows All Screens → Side Pane again.' }, [
            K.button({ label: 'Reset to All Screens', fk: 'pane:reset', onClick: function () { self.paneResetAll(path); } })]));
        }
        void x;
      }
      // A GROUP'S SECTIONS, their own page: the list, or the way back when the
      // group shows none of its own
      paneSectionsPage(c, path, g, base) {
        var p = this.paneNow(path), grp = p[g];
        if ((g === 'dashboard' && grp.show === 'off') || (g === 'saver' && grp.show !== 'own')) {
          c.appendChild(K.group({ footer: g === 'saver' ? 'The screensaver shows no sections of its own. Choose Its Own Sections under Screensaver, on the Side Pane page.'
                                                        : 'The pane is off beside the pages. Choose where it shows under Dashboard, on the Side Pane page.' }, [
            K.nav({ label: 'Side Pane', href: base, fk: 'pane:back' })]));
          return;
        }
        this.paneSections(c, path, g, grp, base);
      }
      // A GROUP'S SECTIONS: in order, each opening its own page; a minus takes
      // one away, the handle moves it, More adds one (eight at most)
      paneSections(c, path, g, grp, base) {
        var self = this, keys = grp.sections.map(M.secKey);
        var name = function (s) { var k = M.paneKind(s.kind) || [0, s.kind]; return k[1]; };
        var ent = function (s) { var st = s.entity && (self.client.states || {})[s.entity]; return st ? ((st.attributes || {}).friendly_name || s.entity) : ''; };
        c.appendChild(K.listEditor({ fk: 'pane:' + g, minRows: 0, announce: this.announce.bind(this),
          shownHeader: 'Sections', moreHeader: grp.sections.length < M.PANE_MAX ? 'Add a Section' : null,
          shownFooter: 'Size: Tiny is one line; Less, the gist; More, the whole section; Full takes the room the pane has left. When There’s Something: only while it has something, such as music playing. The pane never scrolls: when the sections don’t fit, the last ones get smaller, then are left out.',
          emptyText: 'No sections',
          rows: grp.sections.map(function (s, i) {
            var k = M.paneKind(s.kind) || [s.kind, s.kind, 'mdi:card'];
            return { value: keys[i], label: name(s) + (ent(s) ? ' (' + ent(s) + ')' : ''), icon: k[2], value2: M.secSays(s),
                     href: base + '/section/' + g + '/' + i };
          }),
          more: M.secsMore(grp).map(function (k) { return { value: k[0], label: k[1], icon: k[2] }; }),
          onChange: function (vals) {
            if (vals.length > keys.length) { self.paneSave(path, g, M.secsAdd(grp, vals[vals.length - 1])); return; }
            self.paneSave(path, g, M.secsOrder(grp, vals));
          } }));
      }
      // ONE SECTION: its Size, Always or When There's Something, its options
      paneSection(c, path, g, i) {
        var self = this, p = this.paneNow(path), grp = p[g], s = grp.sections[i], st = this.client.states || {};
        var set = function (k, v) { return self.paneSave(path, g, M.secSet(grp, i, k, v)); };
        // SIZE, SHOW, PLACE and WHEN TAPPED (2026-10-30): one group, their
        // footers joined (four one-row groups before)
        c.appendChild(K.group({ header: 'Section', footer: 'Size — Tiny: one line. Less: the gist. More: the whole section. Full: more again, taking the room the pane has left (one section at a time). ' +
            'When There’s Something: music playing (or paused, for Hide After a Pause), a timer running, the alarm armed or a door open, a notification. ' +
            'Bottom: at the pane’s foot, under a space — what’s playing, say — in the order they are listed. ' +
            'When Tapped — Automatic: its page where this screen has one, else its detail sheet. A tap on one thing in it — an event, a person, a thermostat — opens that thing’s sheet.' +
            (s.kind === 'now_playing' ? ' Now Playing’s Automatic is Open the Panel — Speakers, Volume, Queue and Browse, right in the pane; or Flip to the Controls — the section turns over to them.' : '') }, [
          K.seg({ label: 'Size', sk: 'pane:sec:size', value: s.size || 'more', options: M.PANE_SIZES, onChange: function (v) { set('size', v === 'more' ? null : v); } }),
          K.seg({ label: 'Show', sk: 'pane:sec:when', value: s.when || 'always', options: M.PANE_WHEN, stack: true,
                  onChange: function (v) { set('when', v === 'always' ? null : v); } }),
          K.seg({ label: 'Place', sk: 'pane:sec:place', value: s.place || 'top', options: M.PANE_PLACES, onChange: function (v) { set('place', v === 'top' ? null : v); } }),
          K.select({ label: 'When Tapped', sk: 'pane:sec:tap', value: s.tap || 'auto', options: M.paneTaps(s.kind), onChange: function (v) { set('tap', v === 'auto' ? null : v); } })]));
        var ids = function (dom) { return Object.keys(st).filter(function (k) { return k.indexOf(dom + '.') === 0; }).sort(); };
        var nm = function (id) { return ((st[id] || {}).attributes || {}).friendly_name || id; };
        if (s.kind === 'calendar') {
          c.appendChild(K.group({ footer: 'The calendars in Pages → Calendar.' }, [
            K.select({ label: 'Days', sk: 'pane:sec:days', value: String(s.days || ''), options: [['', 'As Its Size Shows']].concat([1, 2, 3, 4, 5, 6, 7].map(function (n) {
              return [String(n), n === 1 ? 'Today' : n === 2 ? 'Today & Tomorrow' : n + ' Days'];
            })), onChange: function (v) { set('days', v ? Number(v) : null); } })]));
        }
        if (s.kind === 'now_playing') {
          c.appendChild(K.group({ footer: 'The song’s album art, blurred, as the ground of the whole pane while something plays. Off: the pane keeps its ordinary ground.' }, [
            K.toggle({ label: 'Album Art Background', sk: 'pane:sec:art', on: s.art !== false, onChange: function (on) { set('art', on ? null : false); } })]));
        }
        if (s.kind === 'clock') {
          // THE CLOCK'S LOOK (2026-10-31, item 43; hk_core PANE_CHOICES): its face, where it sits, its type, the date and a
          // second line -- each first choice today's clock
          var pick = function (label, sk, key, opts, dflt) {
            return K.select({ label: label, sk: sk, value: s[key] || dflt, options: opts, onChange: function (v) { set(key, v === dflt ? null : v); } });
          };
          c.appendChild(K.group({ header: 'Look', footer: 'Face — Stacked: the hours over the minutes, as StandBy has them. Analog: the Analog Numbers face, small, with the time and date beside it. ' +
              'AM/PM shows only on a 12-hour clock. The colon flashes only where animations are on (not under Reduce Motion, Animations Off or Flat). ' +
              'Second Line — Automatic: the date, with the sunset beside it at More. ' +
              'Beside the Time — the temperature and the sky beside the time (at Less and More; under the time when it is centered): Large, two thirds of the time’s size; Quiet, half its size and lighter; a Chip, a small pill; or on the Date Line, at the date’s size. ' +
              'Under the Time, at More — Sunset: the sunset beside the date. Next Hours: the coming hours’ weather. Sun: the day’s arc from sunrise to sunset, with the sun on it. Moon: tonight’s moon and when it is next full or new. Conditions: the sunset or sunrise, wind, humidity and UV.' }, [
            K.seg({ label: 'Face', sk: 'pane:clock:face', value: s.face || 'digital', options: M.CLOCK_FACES, onChange: function (v) { set('face', v === 'digital' ? null : v); } }),
            K.seg({ label: 'Alignment', sk: 'pane:clock:align', value: s.align || 'left', options: M.CLOCK_ALIGNS, onChange: function (v) { set('align', v === 'left' ? null : v); } }),
            K.seg({ label: 'Text Size', sk: 'pane:clock:scale', value: s.scale || 'medium', options: M.CLOCK_SCALES, onChange: function (v) { set('scale', v === 'medium' ? null : v); } }),
            pick('Weight', 'pane:clock:weight', 'weight', M.CLOCK_WEIGHTS, 'semibold'),
            K.toggle({ label: 'AM/PM', sk: 'pane:clock:ampm', on: s.ampm !== false, onChange: function (on) { set('ampm', on ? null : false); } }),
            K.toggle({ label: 'Flashing Colon', sk: 'pane:clock:colon', on: !!s.colon, onChange: function (on) { set('colon', on || null); } }),
            K.seg({ label: 'Date', sk: 'pane:clock:date', value: s.date || 'full', options: M.CLOCK_DATES, onChange: function (v) { set('date', v === 'full' ? null : v); } }),
            pick('Second Line', 'pane:clock:line', 'line', M.CLOCK_LINES, 'auto'),
            pick('Beside the Time', 'pane:clock:beside', 'beside', M.CLOCK_BESIDE, 'none'),
            pick('Under the Time', 'pane:clock:below', 'below', M.CLOCK_BELOW, 'auto')]));
        }
        if (s.kind === 'camera' || s.kind === 'todo') {
          var dom = s.kind === 'camera' ? 'camera' : 'todo';
          var rows = [K.select({ label: s.kind === 'camera' ? 'Camera' : 'List', sk: 'pane:sec:entity', value: s.entity || '',
            options: [['', s.kind === 'camera' ? 'The First of Cameras' : 'The First List']].concat(ids(dom).map(function (id) { return [id, nm(id)]; })),
            onChange: function (v) { set('entity', v || null); } })];
          if (s.kind === 'todo') rows.push(K.toggle({ label: 'Show Completed', sk: 'pane:sec:completed', on: !!s.completed, onChange: function (on) { set('completed', on || null); } }));
          // THE CAMERA'S NAME, as the Home Grid's camera block has it (Hide here unless chosen)
          if (s.kind === 'camera') rows.push(K.select({ label: 'Name', sk: 'pane:sec:name', value: s.name || 'hide', options: M.PANE_CAMERA_NAMES,
            onChange: function (v) { set('name', v === 'hide' ? null : v); } }));
          c.appendChild(K.group({ footer: s.kind === 'todo' ? 'A tap on an item’s circle checks it off.' : s.kind === 'camera' ? 'Name — Automatic: shown on a short still, hidden on a tall one.' : null }, rows));
        }
        c.appendChild(K.group({}, [K.button({ label: 'Remove Section', destructive: true, fk: 'pane:sec:remove', onClick: function () {
          var keys = grp.sections.map(M.secKey);
          keys.splice(i, 1);
          self.paneSave(path, g, M.secsOrder(grp, keys)).then(function () { self.back((path ? '#/screens/' + encodeURIComponent(path) + '/sidepane' : '#/house/sidepane') + '/' + g); });
        } })]));
      }
      // THE LINK from where a pane used to be set (Screensaver Options, Now
      // Playing, the Home Grid editor): `which` is what it says
      // a screen's path from a Screensaver Options page's own address (null: All Screens')
      panePath(href) {
        var m = /^#\/screens\/([^/]+)\//.exec(String(href || ''));
        return m ? decodeURIComponent(m[1]) : null;
      }
      paneLink(path, which, sk) {
        var p = this.paneNow(path), href = path ? '#/screens/' + encodeURIComponent(path) + '/sidepane' : '#/house/sidepane';
        var says = which === 'saver' ? M.paneSaverSummary(p) : which === 'np' ? M.npShowAs(p) : M.paneSummary(p);
        return K.nav({ label: which === 'np' ? 'Show As' : 'Side Pane', value: says, href: href, sk: sk || 'pane:link:' + which });
      }
      // ALL SCREENS -> NOW PLAYING: a side pane (the screensaver's music pane)
      // or the bar on tablets & computers, the bar on phones (hk-base.js
      // nowPlaying, hk-popup.js placeFor). Each screen may choose its own
      // (its Now Playing Options, np_*: s_nowPlaying).
      // THE PAGES SCREEN (docs/phase11/HOMEVIEW-LOOK.md, Phase J): All
      // Screens' (ctx.house) or a screen's (ctx.path, ctx.b) -- on a screen each
      // choice Same as All Screens until it is its own, with a Reset
      psCtx(ctx) {
        var self = this, house = this.data.settings.pages_screen || M.PAGES_SCREEN_DEFAULTS;
        var own = ctx.house ? null : (ctx.b && ctx.b.pages_screen) || null;
        var r = ctx.house ? { value: M.pagesScreenOf(house, null).value, own: {} } : M.pagesScreenOf(house, own);
        return {
          value: r.value, own: r.own, house: M.pagesScreenOf(house, null).value,
          set: function (field, v) {
            if (ctx.house) { var o = {}; o['pages_screen.' + field] = v; return self.setH(o); }
            return self.setB(ctx.path, { pages_screen: M.pagesScreenSet(own, field, v) });
          },
          reset: function () { return self.setB(ctx.path, { pages_screen: null }); }
        };
      }
      // a choice: All Screens' a plain pop-up, a screen's with Same as All Screens first
      psSelect(ctx, ps, field, label, list) {
        var lab = function (v) { return M.choiceLabel(list, v); };
        if (ctx.house) {
          return K.select({ label: label, sk: 'pages_screen.' + field, value: ps.value[field], options: list,
                            onChange: function (v) { ps.set(field, v); } });
        }
        var hv = ps.house[field];
        return K.select({ label: label, sk: 'b:pages_screen:' + field, sub: ps.own[field] ? 'Just This Screen' : 'Same as All Screens',
                          value: ps.own[field] ? ps.value[field] : '',
                          options: [['', 'Same as All Screens (' + lab(hv) + ')', lab(hv)]].concat(list),
                          onChange: function (v) { ps.set(field, v || undefined); } });
      }
      pagesScreenPage(c, ctx) {
        var self = this, ps = this.psCtx(ctx), val = ps.value;
        c.appendChild(K.group({ footer: 'An iPad-style home screen of this screen’s pages, right after Home: swipe from Home to it, ' +
            'or open it from the menu or the tab bar. A way around a screen without a tab bar.' }, [
          this.psSelect(ctx, ps, 'show', 'Pages Screen', M.PAGES_SCREEN_SHOW)]));
        // OFF: nothing else but the way back (2026-10-30: what depends on a
        // switch that is off isn't drawn, as in iOS)
        var on = val.show !== 'off';
        if (on) this.pagesScreenParts(c, ctx, ps, val);
        if (!ctx.house && Object.keys(ps.own).length) {
          c.appendChild(K.group({}, [K.button({ label: 'Reset to All Screens', sk: 'b:pages_screen:reset', onClick: function () { ps.reset(); } })]));
        }
        if (ctx.house) {
          var mine = Object.keys(this.data.boards || {}).filter(function (p) { return (self.data.boards[p] || {}).pages_screen; });
          if (mine.length) {
            c.appendChild(K.group({ header: 'Screens With Their Own', footer: 'These screens choose some of this for themselves.' },
              mine.map(function (p) {
                var x = self.dash(p);
                return K.nav({ label: x ? x.title : p, href: '#/screens/' + encodeURIComponent(p) + '/pages-screen', fk: 'ps:own:' + p,
                               value: M.pagesScreenSummary(M.pagesScreenOf(self.data.settings.pages_screen, self.data.boards[p].pages_screen).value) });
              })));
          }
        }
      }
      // ...ITS PARTS, while it is on: the icons, the widgets, and what else is on it
      pagesScreenParts(c, ctx, ps, val) {
        var icons = Array.isArray(val.icons) ? val.icons.length + (val.icons.length === 1 ? ' Page' : ' Pages') : 'Same as the Menu';
        c.appendChild(K.group({ header: 'Icons', footer: 'Each page as a large icon in its Accent Color. Calendar shows today’s date, ' +
            'Weather the temperature, and a red badge shows what’s waiting: timers running, a door open, a notification.' }, [
          K.nav({ label: 'Icons', value: icons, href: ctx.base + '/icons', sk: ctx.house ? 'pages_screen.icons' : 'b:pages_screen:icons',
                  sub: ctx.house ? null : ps.own.icons ? 'Just This Screen' : 'Same as All Screens' }),
          this.psSelect(ctx, ps, 'rooms', 'Rooms', M.PAGES_SCREEN_ROOMS)]));
        // WIDGETS: the Side Pane's sections among the icons
        var widgets = val.widgets || [], have = {};
        var rows = widgets.map(function (w) {
          have[w.kind] = true;
          return K.select({ label: M.choiceLabel(M.PAGES_SCREEN_WIDGETS, w.kind), sk: (ctx.house ? 'pages_screen.widgets:' : 'b:pages_screen:widgets:') + w.kind,
                            value: w.size + ':' + w.place, options: M.PAGES_SCREEN_SPOTS.concat([['remove', 'Remove']]),
                            onChange: function (v) { ps.set('widgets', M.pagesWidgetSet(widgets, w.kind, v)); } });
        });
        var left = M.PAGES_SCREEN_WIDGETS.filter(function (o) { return !have[o[0]]; });
        if (widgets.length < M.PAGES_SCREEN_WIDGETS_MAX && left.length) {
          rows.push(K.select({ label: 'Add a Widget', sk: ctx.house ? 'pages_screen.widgets' : 'b:pages_screen:widgets', value: '',
                               placeholder: 'Choose', options: left,
                               onChange: function (v) { if (v) ps.set('widgets', M.pagesWidgetSet(widgets, v, 'more:right')); } }));
        }
        if (!ctx.house && ps.own.widgets) {
          rows.push(K.button({ label: 'Same Widgets as All Screens', sk: 'b:pages_screen:widgets:reset',
                               onClick: function () { ps.set('widgets', undefined); } }));
        }
        c.appendChild(K.group({ header: 'Widgets', footer: 'Side Pane sections among the icons: Large is two icons wide and two tall, ' +
            'Small two wide and one tall, on the first Pages screen from the top. They show where the screen has the Side Pane’s sections.' }, rows));
        // ON THE PAGES SCREEN: the Home Pill and the Background Clock, one
        // group (two one-row groups before 2026-10-30)
        c.appendChild(K.group({ header: 'On the Pages Screen', footer: 'Home Pill: a bar at the foot of the Pages screen, as on an iPad — tap it or swipe up on it to go Home. ' +
            'Background Clock: the time, large and faint, behind the icons.' }, [
          this.psSelect(ctx, ps, 'pill', 'Home Pill', M.PAGES_SCREEN_PILL),
          this.psSelect(ctx, ps, 'clock', 'Background Clock', M.PAGES_SCREEN_CLOCK)]));
      }
      // THE ICONS: the menu's pages in its order (Automatic), or a list of
      // its own -- ordered, each page in or out
      pagesScreenIcons(c, ctx) {
        var self = this, ps = this.psCtx(ctx), val = ps.value;
        var custom = {};
        (this.data.custom_pages || []).forEach(function (p) { custom[p.path] = p.title; });
        var kinds = (this.data.page_kinds || []).filter(function (k) { return k !== 'rooms' && k !== 'browse'; });
        if (!this.energyOn()) kinds = kinds.filter(function (k) { return k !== 'energy'; });
        if (!this.powerOn()) kinds = kinds.filter(function (k) { return k !== 'power'; });
        var keys = ctx.house ? kinds.concat(Object.keys(custom))
          : M.pagesModel(ctx.b, kinds, custom).rows.map(function (r) { return r.value; }).filter(function (k) { return k !== 'rooms'; });
        var label = {}, paths = [];
        keys.forEach(function (k) {
          var p = M.menuPathOf(k, custom);
          if (p && paths.indexOf(p) < 0) { paths.push(p); label[p] = custom[k] !== undefined ? custom[k] : (M.PAGE_LABELS[k] || k); }
        });
        if (!ctx.house) {
          // the whole list inherits: a switch, as Screensaver Options has (a
          // Same / Just This Screen pop-up until 2026-10-30)
          c.appendChild(K.group({ footer: ps.own.icons ? 'This screen has its own icons. On: it uses All Screens’ again.'
                                                       : 'The icons All Screens’ Pages Screen has. Off: this screen gets its own, starting from these.' }, [
            K.toggle({ label: 'Same as All Screens', sk: 'b:pages_screen:icons', on: !ps.own.icons,
                       onChange: function (on) { ps.set('icons', on ? undefined : (Array.isArray(val.icons) ? val.icons : 'menu')); } })]));
          if (!ps.own.icons) return;
        }
        var auto = !Array.isArray(val.icons);
        var shown = auto ? paths : val.icons.filter(function (p) { return label[p] !== undefined; });
        c.appendChild(K.listEditor({ fk: ctx.house ? 'psicons' : 'bpsicons', auto: auto, announce: this.announce.bind(this),
          autoFooter: 'Automatic: the pages in this screen’s menu, in its order. Off: the pages you choose, in your order.',
          onAuto: function (on) { ps.set('icons', on ? 'menu' : paths.slice()); },
          shownHeader: 'Icons', shownFooter: auto ? null : 'In this order, row by row.',
          rows: shown.map(function (p) { return { value: p, label: label[p] }; }),
          more: auto ? [] : paths.filter(function (p) { return shown.indexOf(p) < 0; }).map(function (p) { return { value: p, label: label[p] }; }),
          onChange: function (v) { ps.set('icons', v); } }));
      }
    };
    KIT.install(Methods);
  };
})();
