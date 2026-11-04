// hk-settings-house-looks.js - All Screens: Now Playing, Calendar, Appearance, recommendations, Sky.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-house-looks'] = function (KIT) {
    var C = KIT.C, haName = KIT.haName, LAND_FILE = KIT.LAND_FILE, PN = KIT.PN, shrinkPhoto = KIT.shrinkPhoto,
        TILE_FOOT = KIT.TILE_FOOT;

    var h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      h_nowPlaying(c) {
        var self = this, np = this.npHouse(), wide = this.hasAttribute('wide');
        var set = function (k, v) { var o = {}; o['now_playing.' + k] = v; self.setH(o); };
        // SHOW AS: the bar, or In the Side Pane -- the Side Pane's page (2026-10-30;
        // Now Playing's own pane moved into it)
        var inPane = M.paneHasMusic(this.paneNow(null));
        var rows = [this.paneLink(null, 'np', 'now_playing.style'),
                    K.seg({ label: 'Bar Position', sk: 'now_playing.bar', value: np.bar, options: M.NP_BARS,
                            onChange: function (v) { set('bar', v); } })];
        var gl = M.choiceLabel(M.NP_GRACES, np.grace).toLowerCase();
        c.appendChild(K.group({ header: 'Tablets & Computers', footer: inPane
          ? 'In the Side Pane while it shows; the bar wherever the pane doesn’t. It leaves ' + gl + ' after the music’s paused or stops.'
          : 'The bar slides in when music starts and leaves ' + gl + ' after it’s paused or stops.' }, rows));
        c.appendChild(K.group({ header: 'Phones', footer: 'Phones always use the bar.' }, [
          K.seg({ label: 'Bar Position', sk: 'now_playing.bar_phone', value: np.bar_phone, options: M.NP_BARS,
                  onChange: function (v) { set('bar_phone', v); } })]));
        // HIDE AFTER A PAUSE: the bar, the pane and the screensaver's music,
        // held longer while somebody is using it
        c.appendChild(K.group({ header: 'Paused or Stopped', footer: 'How long Now Playing stays once the music is paused or stops — ' +
            'the bar, the pane and the screensaver’s music alike. While someone is using it (Speakers or Browse open, a tap on it), ' +
            'it stays, and waits this long again after.' }, [
          K.select({ label: 'Hide After', sk: 'now_playing.grace', value: String(np.grace),
                     options: M.NP_GRACES.map(function (g) { return [String(g[0]), g[1]]; }),
                     onChange: function (v) { set('grace', Number(v)); } })]));
        // the screens that choose their own, as other Same as All Screens pages list them
        var own = [], bd = this.data.boards || {};
        Object.keys(bd).forEach(function (pth) {
          var b = bd[pth] || {};
          if (b.np_style || b.np_side || b.np_bar || b.np_bar_phone) own.push(K.nav({ label: (self.dash(pth) || {}).title || pth, value: M.npSummary(b, np),
            href: '#/screens/' + encodeURIComponent(pth) + '/nowplaying', sk: 'np:screen:' + pth }));
        });
        if (own.length) c.appendChild(K.group({ header: 'Screens With Their Own', footer: 'These screens choose their own, on their Now Playing Options.' }, own));
        void wide;
      }
      // A SCREEN'S NOW PLAYING OPTIONS (2026-10-30): All Screens' Now Playing,
      // by device, each choice Same as All Screens until it is the screen's
      // own -- and one Reset for them all
      s_nowPlaying(c, x, b) {
        var self = this, path = x.path, hnp = this.npHouse();
        var set = function (ch) { return self.setB(path, ch); };
        var lab = function (list, v) { return M.choiceLabel(list, v); };
        if (!b.now_playing || b.np_style === undefined) {
          c.appendChild(K.group({ footer: 'Now Playing is off on this screen. Turn it on on the screen’s page.' }, [
            K.nav({ label: x.title, href: '#/screens/' + encodeURIComponent(path), fk: 'np:screen' })]));
          return;
        }
        var npSel = function (key, label, list, hv) {
          var own = b[key];
          return K.select({ label: label, sk: 'b:' + key, sub: own ? 'Just This Screen' : 'Same as All Screens', value: own || '',
            options: [['', 'Same as All Screens (' + lab(list, hv) + ')', lab(list, hv)]].concat(list),
            onChange: function (v) { var o = {}; o[key] = v || null; set(o); } });
        };
        var inPane = M.paneHasMusic(this.paneNow(path));
        // (Show As: the bar, or the Side Pane's Now Playing -- its page, 2026-10-30)
        c.appendChild(K.group({ header: 'Tablets & Computers', footer: inPane
          ? 'In the Side Pane while it shows; the bar wherever the pane doesn’t.'
          : 'The bar slides in when music starts.' }, [
          this.paneLink(path, 'np', 'b:np_style'),
          npSel('np_bar', 'Bar Position', M.NP_BARS, hnp.bar)]));
        c.appendChild(K.group({ header: 'Phones', footer: 'Phones always use the bar.' }, [
          npSel('np_bar_phone', 'Bar Position', M.NP_BARS, hnp.bar_phone)]));
        if (M.npOwn(b)) {
          c.appendChild(K.group({ footer: 'Every choice above follows All Screens → Now Playing again.' }, [
            K.button({ label: 'Reset to All Screens', sk: 'b:np_options:reset', onClick: function () {
              var o = {};
              M.NP_OWN_KEYS.forEach(function (k) { o[k] = null; });
              set(o);
            } })]));
        }
      }
      npHouse() {
        return Object.assign({ style: 'bar', side: 'right', bar: 'bottom', bar_phone: 'bottom', grace: 30 }, (this.data.settings || {}).now_playing || {});
      }

      h_calendar(c) {
        var self = this, mine = this.hs('calendar.entities') || [], all = this.calIds();
        var auto = !mine.length, shown = auto ? all : mine;
        var set = function (v) { self.setH({ 'calendar.entities': v }); };
        var row = function (id) {
          var col = self.calColor(id, shown);
          return { value: id, label: self.name(id), href: '#/page/calendar/' + id,
                   value2: col.auto ? 'Automatic (' + M.colorLabel(col.key) + ')' : M.colorLabel(col.key) };
        };
        if (!all.length) {
          c.appendChild(K.group({ footer: 'Add a calendar to Home Assistant (Settings → Devices & Services → Add Integration → Local Calendar, Google Calendar or CalDAV) and it shows here.' }, [
            K.info({ label: 'Calendars', value: 'None' })]));
          return;
        }
        c.appendChild(K.listEditor({ fk: 'calendars', auto: auto, announce: this.announce.bind(this),
          autoFooter: auto ? 'Every calendar in Home Assistant, A to Z. Turn off Automatic to choose them and their order.'
                           : 'Only these calendars, in this order.',
          onAuto: function (on) { set(on ? [] : all.slice()); },
          shownHeader: 'Calendars', emptyText: 'None', shownFooter: 'The Calendar page and the screensaver’s calendar pane show these. Select one for its color.',
          rows: shown.map(row), onChange: set, addLabel: auto ? null : 'Add Calendar…',
          onAddOther: auto ? null : function () {
            self.go(self.picker('calendar-add', { title: 'Add Calendar', value: null, multi: true,
              items: function () { return all.filter(function (id) { return mine.indexOf(id) < 0; })
                .map(function (id) { return { value: id, label: self.name(id), sub: id }; }); },
              onPick: function (id) { if (id) set(mine.concat(id)); } }));
          } }));
        this.h_calendarKeywords(c);
      }
      // COLORS BY KEYWORD (2026-10-16): an event whose title has the word
      // ("Doctor", "Emma") takes its color, the first that matches; an
      // event's own color, picked on its sheet, wins over them
      h_calendarKeywords(c) {
        var self = this, list = (this.hs('calendar.keywords') || []).slice();
        var save = function (next) { self.setH({ 'calendar.keywords': next }); };
        var opts = M.PILL_COLORS.map(function (k) { return [k, M.colorLabel(k)]; }).concat([['__remove', 'Remove']]);
        var rows = list.map(function (k, i) {
          return K.select({ label: k.word, sk: 'calendar.keywords', fk: 'kw:' + i, value: k.color, options: opts,
            onChange: function (v) {
              var next = list.slice();
              if (v === '__remove') next.splice(i, 1); else next[i] = { word: k.word, color: v };
              save(next);
            } });
        });
        rows.push(K.text({ label: 'Add a Keyword', sk: 'calendar.keywords', fk: 'kw:add', value: '', placeholder: 'Doctor',
          error: this.err('calendar.keywords'),
          onCommit: function (t) {
            var w = String(t || '').trim();
            if (!w || list.some(function (k) { return k.word.toLowerCase() === w.toLowerCase(); })) return;
            var used = list.map(function (k) { return k.color; });
            var col = M.PILL_COLORS.filter(function (k) { return k !== 'white' && used.indexOf(k) < 0; })[0] || 'red';
            save(list.concat([{ word: w, color: col }]));
          } }));
        c.appendChild(K.group({ header: 'Colors by Keyword', footer: 'An event with one of these words in its name takes its color — the first that matches, in any case. ' +
            'Tap an event on the Calendar page to give it a color of its own.' }, rows));
      }
      h_calendarOne(c, id) {
        var self = this, mine = this.hs('calendar.entities') || [], shown = mine.length ? mine : this.calIds();
        var all = Object.assign({}, this.hs('calendar.colors') || {});
        var i = shown.indexOf(id), autoKey = M.CAL_COLORS[(i < 0 ? 0 : i) % M.CAL_COLORS.length];
        var st = this.client && this.client.states[id], f = (st && st.attributes && st.attributes.supported_features) || 0;
        var can = [f & 1 ? 'added' : null, f & 4 ? 'changed' : null, f & 2 ? 'deleted' : null].filter(Boolean);
        c.appendChild(K.group({ footer: 'Its events’ color on the Calendar page and the screensaver. Automatic: the next color by its place in the list.' }, [
          K.select({ label: 'Color', sk: 'calendar.colors', value: all[id] || '', placeholder: 'Automatic',
                     options: [['', 'Automatic (' + M.colorLabel(autoKey) + ')']]
                       .concat(M.PILL_COLORS.map(function (k) { return [k, M.colorLabel(k)]; })),
                     onChange: function (v) {
                       var out = Object.assign({}, all);
                       if (v) out[id] = v; else delete out[id];
                       self.setH({ 'calendar.colors': out });
                     } })]));
        c.appendChild(K.group({ footer: can.length
            ? 'Events can be ' + (can.length > 1 ? can.slice(0, -1).join(', ') + ' and ' + can[can.length - 1] : can[0]) + ' from the Calendar page.'
            : 'This calendar can only be read: its events can’t be added or changed from the Calendar page.' }, [
          K.info({ label: 'Entity', value: id })]));
      }
      h_weatherSensors(c) {
        var self = this, set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
        var row = function (key, label, none, dc, sub) {
          return self.entityRow({ label: label, sub: sub, sk: 'weather.' + key, value: self.hs('weather.' + key), none: none,
                                  filter: { domains: ['sensor'], dc: dc }, onPick: set('weather.' + key) });
        };
        c.appendChild(K.group({ header: 'Now', footer: 'Empty: the weather service’s own reading.' }, [
          row('feels_like', 'Feels Like', 'From Weather Service'), row('humidity', 'Humidity', 'From Weather Service'),
          row('wind', 'Wind Speed', 'From Weather Service'), row('gust', 'Wind Gust', 'Not Shown'),
          row('uv', 'UV Index', 'Not Shown'),
          row('outside', 'Outside Temperature', 'Not Shown', 'temperature', 'The Weather page’s daily averages')]));
        c.appendChild(K.group({ header: 'Forecast', footer: 'A sensor with a forecast attribute. Empty: the forecast is read from the weather service.' }, [
          row('forecast_daily', 'Daily Forecast', 'From Weather Service'), row('forecast_hourly', 'Hourly Forecast', 'From Weather Service')]));
        c.appendChild(K.group({ header: 'Alerts', footer: 'The NWS Alerts integration’s sensor (US only; without it there are no alerts). Its alert chip and card show only while an alert is active.' }, [
          row('alerts', 'Weather Alerts', 'None')]));
      }
      // ALL SCREENS -> APPEARANCE (2026-10-29): how screens look, one page --
      // the Style and only its own options, then (Phase 4) what's recommended,
      // the Colors, the Background and the tab bar's look. A screen's own
      // Appearance page is laid out the same (s_appearance).
      h_appearance(c) {
        var self = this, look = this.data.settings.look, sky = this.data.settings.sky || {};
        var style = look.flat === true ? 'flat' : look.glass;
        // THE STYLE'S OWN SETTINGS ONLY (2026-10-09): Frost and Tint from
        // Background with Frosted, Blur with the blurs -- as a screen's page
        // shows them. A screen with a style of its own sets them there.
        var rows = [K.nav({ label: 'Appearance Style', value: M.glassShort(style), href: '#/house/appearance/glass', sk: 'look.glass' })];
        rows = rows.concat(this.glassRows(style, {
          frost: { value: look.frost, onChange: function (v) { self.setH({ 'look.frost': v }); } },
          tint: { on: !!look.frost_tint, onChange: function (on) { self.setH({ 'look.frost_tint': on }); } },
          blur: { value: look.blur, onChange: function (v) { self.setH({ 'look.blur': v }); } },
          bright: { value: typeof look.bright === 'number' ? look.bright : 50, onChange: function (v) { self.setH({ 'look.bright': v }); } },
          brightDim: { value: typeof look.bright_dim === 'number' ? look.bright_dim : 0, onChange: function (v) { self.setH({ 'look.bright_dim': v }); } },
          brightPages: { value: look.bright_pages === 'all' ? 'all' : 'home', onChange: function (v) { self.setH({ 'look.bright_pages': v }); } },
          dark: { value: typeof look.tint === 'number' ? look.tint : 50, onChange: function (v) { self.setH({ 'look.tint': v }); } },
          well: { value: look.well || 'dark', onChange: function (v) { self.setH({ 'look.well': v }); } }
        }, 'look.'));
        if (style === 'flat') rows = rows.concat(this.flatThemeRows(null, look, null));
        // the screens that keep their own look, named as links (ownLooks: up
        // from the Style page, 2026-10-29)
        // TILE STYLE in the Style group (its own Tiles group until 2026-10-30)
        rows = rows.concat(this.tileStyleRows(null, null));
        var own = this.ownLooks(look);
        c.appendChild(K.group({ header: 'Style', footer: typeof own === 'string' ? M.glassFooter(style) + ' ' + TILE_FOOT
          : [document.createTextNode(M.glassFooter(style) + ' ')].concat(own, [document.createTextNode(' ' + TILE_FOOT)]) }, rows));
        this.recommendGroups(c, null);
        // COLORS & BACKGROUND: the one Accent Color, Flat's own while any
        // screen wears Flat, then the Background (one group since 2026-10-30)
        var colors = [this.accentNav(null, null, '#/house/appearance/accent')];
        if (style === 'flat' || this.flatAnywhere()) {
          colors.push(this.flatColorsNav(this.flatScope('house'), { sub: style === 'flat' ? null : 'For Screens Using Flat' }));
        }
        colors.push(K.nav({ label: 'Background', href: '#/house/appearance/sky', sk: 'sky.background',
                            value: style === 'flat' ? this.flatSummary(null) : M.choiceLabel(M.SKY_BACKGROUNDS, sky.background || 'live') }));
        c.appendChild(K.group({ header: 'Colors & Background', footer: 'The Accent Color colors the menu, the tab bar and the page you’re on' +
          (style === 'flat' || this.flatAnywhere() ? '; in Flat it also shades the background. Flat Colors: the pills’ tint and each page’s own.' : '.') }, colors));
        c.appendChild(K.group({ header: 'Tab Bar', footer: 'For every screen with a tab bar that doesn’t choose its own. Tinted: a near-solid bar, no blur.' },
          this.tabBarGlassRows(this.menuCtx(null, null), style)));
      }
      // THE TAB BAR'S GLASS (tab_bar_glass, a menu setting): Same as Screen
      // names the screen's look (All Screens': Appearance's)
      tabBarGlassRows(ctx, style) {
        var v = ctx.v, label = M.glassShort(style);
        var opts = M.TAB_BAR_GLASS.map(function (g) { return g[0] === 'house' ? ['house', 'Same as Screen (' + label + ')', label] : g; });
        return this.mRow(ctx, 'tab_bar_glass', function (set, whose) {
          return K.select({ label: 'Tab Bar Glass', sub: whose || ((v.tab_bar_glass || 'house') === 'house' ? 'Same as Screen' : null),
                            sk: ctx.sk('tab_bar_glass'), value: v.tab_bar_glass || 'house', options: opts,
                            onChange: function (x) { set({ tab_bar_glass: x }); } });
        }, function (x) { return M.choiceLabel(M.TAB_BAR_GLASS, x || 'house'); });
      }
      // RECOMMENDED (2026-10-29): after the Style, ONE change that should help
      // where a wall tablet showing the screen draws under 45 frames a second
      // (M.slowRecommend: the style first, then the sky's Rain & Snow, its
      // Moving Things in front, its Animations, a live camera) -- on a screen's
      // Appearance its own, with a button for the change and, on most steps,
      // Use Flat; on All Screens' (x null) a row per such screen, to its page.
      // Nothing changes until one is tapped. A number only counts for the
      // settings it was drawn with, so after a step the next one waits for the
      // tablet's next sample. The numbers are the host's (tabletHealth); a host
      // without them (Home Assistant) shows the one this device measured itself,
      // under This Device (deviceRecommend).
      recommendGroups(c, x, b) {
        var self = this, list = this.tabletHealth(), now = Date.now() / 1000;
        if (!list) return;
        var cams = this.camerasIn(list);
        if (x) {
          var rec = M.slowRecommend(x.path, this.slowFacts(x.path, b, cams), list, now);
          if (rec) c.appendChild(this.slowRecGroup(x.path, rec));
          return;
        }
        var boards = this.data.boards || {};
        var rows = (this.data.dashboards || []).map(function (d) {
          var bd = boards[d.path], r = bd && M.slowRecommend(d.path, self.slowFacts(d.path, bd, cams), list, now);
          return r ? { label: d.title || d.path, sub: r.name + ': ' + r.fps + ' frames a second', value: r.label,
                       href: '#/screens/' + encodeURIComponent(d.path) + '/appearance', fk: 'rec:slow:' + d.path } : null;
        }).filter(Boolean);
        if (!rows.length) return;
        c.appendChild(K.recommend({ title: 'Recommended', actions: rows,
          says: (rows.length === 1 ? 'A wall tablet showing this screen draws' : 'Wall tablets showing these screens draw') +
            ' under ' + M.SLOW_FPS + ' frames a second. Its Appearance suggests one change that should help; nothing changes until you choose it.' }));
      }
      // a screen's settings as the ladder reads them (M.ladderFacts); `cams`:
      // whether the house has a camera, asked once (camerasIn)
      slowFacts(path, b, cams) {
        var s = this.data.settings, d = this.dash(path);
        var strip = !!(d && d.generated && b.camera_strip !== false && ((b.cameras || []).length || cams));
        return M.ladderFacts(b, s.look, s.sky, { strip: strip, live: (s.cameras || {}).live });
      }
      // does the house have a camera for a strip to show? Asked only while some
      // tablet is slow -- the one place the answer is read
      camerasIn(list) {
        var self = this;
        if (!list.some(function (t) { return t && typeof t.fps === 'number' && t.fps < M.SLOW_FPS; })) return false;
        try {
          return this.entityIds({ domains: ['camera'], shown: true }).some(function (id) { return !self.notHouseCamera(id); });
        } catch (e) { return false; }
      }
      // a screen's own, on this screen only (never All Screens'): the change
      // that helps, and Use Flat where it goes with it. The footer says why,
      // and that a still slow screen gets the next suggestion in an hour
      slowRecGroup(path, rec, title) {
        var self = this;
        var actions = [{ label: rec.button, sk: 'rec:' + rec.step,
                         onClick: function () { self.setB(path, rec.change); } }];
        if (rec.flat) actions.push({ label: 'Use Flat', sk: 'rec:flat', onClick: function () { self.setB(path, { flat: true }); } });
        return K.recommend({ title: title || 'Recommended', says: rec.says + (rec.then ? ' ' + rec.then : ''), actions: actions });
      }
      // EACH WALL TABLET'S LATEST FRAME RATE, from the host (what its tablets
      // report): read when a page first asks and again after five minutes,
      // the page redrawn when it comes. null on a host without them.
      tabletHealth() {
        var hx = this.host(), self = this, now = Date.now();
        if (!hx || typeof hx.tabletHealth !== 'function') return null;
        if (!this._health || now - this._health.at > 300000) {
          var slot = this._health = { at: now, list: this._health ? this._health.list : [] };
          Promise.resolve().then(function () { return hx.tabletHealth(self); }).then(function (got) {
            slot.list = Array.isArray(got) ? got : [];
            if (self._health === slot && self.isConnected) self.render(true);
          }).catch(function () { /* none to show: asked again later */ });
        }
        return this._health.list;
      }
      // TALKING AT THE DOOR NEEDS HTTPS (2026-11-02): a browser gives the microphone only to a secure page, and a camera
      // sheet's talk button is left out of one that is not. The words to show on the pages that set a camera's talk-back
      // up, or null while this screen and every wall tablet that has said (the host's tabletHealth: `secure`) are secure.
      // The host may say where to look (notes.secure); without one, the fix is the address.
      talkNote() {
        var health = this.tabletHealth() || [];
        if (window.isSecureContext !== false && !health.some(function (t) { return t.secure === false; })) return null;
        return 'Talking at the door needs HTTPS. ' + (this.hostNote('secure') || 'Open Home Assistant by its https:// address.');
      }
      // THIS DEVICE'S OWN (Home Assistant, where tablets report to nobody): the
      // frame rate hk-fps.js measured on this browser, for the screen it
      // measured and the settings it measured them with -- a group under This
      // Device on that screen's page
      deviceRecommend(path, b) {
        if (this.tabletHealth()) return null;
        var own = null;
        try { own = window.hkFps && window.hkFps.latest ? window.hkFps.latest() : JSON.parse(localStorage.getItem('hk-fps') || 'null'); } catch (e) { own = null; }
        if (!own || own.screen !== path || typeof own.fps !== 'number') return null;
        var list = [{ name: 'This device', fps: own.fps, fps_screen: own.screen, fps_style: own.style || null, fps_sig: own.sig || null,
                      fps_at: own.at ? own.at / 1000 : null }];
        var rec = M.slowRecommend(path, this.slowFacts(path, b, this.camerasIn(list)), list, Date.now() / 1000);
        return rec ? this.slowRecGroup(path, rec, 'Recommended for This Device') : null;
      }
      // A SCREEN'S APPEARANCE (2026-10-29): laid out as All Screens' -- its
      // Style, Colors, Background and Tab Bar Look, each Same as All Screens
      // until it chooses its own
      s_appearance(c, x, b) {
        var self = this, path = x.path, base = '#/screens/' + encodeURIComponent(path), look = this.data.settings.look;
        var set = function (ch) { return self.setB(path, ch); };
        var only = x.generated ? this.onlyOf(b) : null;
        var gl = M.glassOf(b, look), app = [];
        app.push(K.nav({ label: 'Appearance Style', href: base + '/glass', sk: 'b:glass',
          sub: gl.own ? 'Just This Screen' : 'Same as All Screens', value: M.glassShort(gl.own ? gl.value : gl.house) }));
        var amt = function (k) {
          var a = M.amountOf(b, look, k);
          return { value: a.value, own: a.own, house: a.house,
                   onChange: function (v) { var o = {}; o[k] = v; set(o); }, reset: function () { var o = {}; o[k] = null; set(o); } };
        };
        var tOwn = typeof b.frost_tint === 'boolean', tHouse = !!look.frost_tint;
        var wOwn = b.well === 'dark' || b.well === 'light', wHouse = look.well || 'dark';
        app = app.concat(this.glassRows(gl.effective, {
          frost: amt('frost'), blur: amt('blur'), dark: amt('tint'), bright: amt('bright'),
          brightDim: (function () {
            var own = b.bright_dim != null && b.bright_dim !== '', house = typeof look.bright_dim === 'number' ? look.bright_dim : 0;
            return { value: own ? Number(b.bright_dim) : house, own: own, house: house,
                     onChange: function (v) { set({ bright_dim: v }); }, reset: function () { set({ bright_dim: null }); } };
          })(),
          brightPages: (function () {
            var own = b.bright_pages === 'home' || b.bright_pages === 'all', house = look.bright_pages === 'all' ? 'all' : 'home';
            return { value: own ? b.bright_pages : house, own: own, house: house,
                     onChange: function (v) { set({ bright_pages: v }); }, reset: function () { set({ bright_pages: null }); } };
          })(),
          well: { value: wOwn ? b.well : wHouse, own: wOwn, house: wHouse,
                  onChange: function (v) { set({ well: v }); }, reset: function () { set({ well: null }); } },
          tint: { on: tOwn ? b.frost_tint : tHouse, own: tOwn, house: tHouse,
                  onChange: function (on) { set({ frost_tint: on }); }, reset: function () { set({ frost_tint: null }); } }
        }, 'b:'));
        if (gl.effective === 'flat') app = app.concat(this.flatThemeRows(b, look, path));
        // TILE STYLE in the Style group (its own Tiles group until 2026-10-30)
        app = app.concat(this.tileStyleRows(b, path));
        c.appendChild(K.group({ header: 'Style', footer: M.glassFooter(gl.effective) + ' ' + TILE_FOOT }, app));
        this.recommendGroups(c, x, b);
        var colors = [this.accentNav(x, b, base + '/accent')];
        if (gl.effective === 'flat') {
          var fsc = this.flatScope('screen', x, b), fown = fsc.own();
          colors.push(this.flatColorsNav(fsc, { sub: fown.off_tint != null || fown.pages != null ? 'Just This Screen' : 'Same as All Screens' }));
        }
        // a page screen: what its pages actually show (one page: its background
        // by name), never a "Same as All Screens" that reaches nothing
        var bflat = this.flatHere(b), skyVal = bflat ? this.flatSummary(b) : M.skySummary(b);
        if (only && only.keys.length) {
          var spk = this.skyPageKeys(b);
          var modes = spk.rows.map(function (r) { return self.skyPageLabel(r, b); });
          var same = modes.every(function (m2) { return m2 === modes[0]; });
          skyVal = same ? modes[0] : 'Mixed';
        }
        // a screen whose Live Sky was turned off (before 2026-10-13) shows Black
        // (Flat's backgrounds are its own: that switch isn't theirs)
        colors.push(K.nav({ label: 'Background', href: base + '/sky', sk: 'b:sky_look', value: b.sky || bflat ? skyVal : 'Black' }));
        c.appendChild(K.group({ header: 'Colors & Background' }, colors));
        if (M.hasTabBar(b)) {
          c.appendChild(K.group({ header: 'Tab Bar', footer: 'Tinted: a near-solid bar, no blur.' },
            this.tabBarGlassRows(this.menuCtx(x, b), gl.effective)));
        }
      }
      // the Appearance row on a screen's page: its style, and whose it is
      appearanceSays(b) {
        var gl = M.glassOf(b, this.data.settings.look);
        return gl.own ? 'Just This Screen' : 'Same as All Screens';
      }
      // ALL SCREENS' SKY / BACKGROUND (under Appearance since 2026-10-29)
      // ALL SCREENS -> APPEARANCE's pages (p_house): Style, Accent, Background, Flat Colors, Page Pills, the page itself
      houseAppearance(sub, mk, base, title) {
        var self = this;
        if (sub[0] === 'glass') return mk('Appearance Style', function (c) { self.h_glass(c); });
        if (sub[0] === 'accent') return mk('Accent Color', function (c) { self.accentPage(c, null, null); });
        // SKY / BACKGROUND (its own sidebar entry until 2026-10-29)
        if (sub[0] === 'sky') return this.houseSky(sub.slice(1));
        if (sub[0] === 'flat-colors') return this.p_flatColors('house', null, null, sub.slice(1), mk, [title, base]);
        if (sub[0] === 'pills') return mk('Page Pills', function (c) { self.h_pills(c); });
        if (sub[0] === 'pill' && sub[1]) {
          return mk(M.PAGE_LABELS[sub[1]] || sub[1], function (c) { self.s_pill(c, null, null, sub[1]); }, ['Page Pills', base + '/pills']);
        }
        return { title: title, top: true, scope: 'Applies to every screen that doesn’t choose its own.', body: function (c) { self.h_appearance(c); } };
      }
      // THE SCREEN ALL SCREENS' APPEARANCE PAGES PREVIEW: one that follows them (none of its own set -- unset, or
      // `house`, Same as All Screens), else the first screen, as the screensaver's All Screens page does
      lookFollower() {
        var bd = (this.data && this.data.boards) || {}, keys = Object.keys(bd);
        var own = ['flat', 'flat_theme', 'glass', 'tab_bar_glass', 'tile_style', 'sky_background', 'sky_color', 'sky_wallpaper'];
        return keys.filter(function (p) {
          var b = bd[p] || {};
          return b.sky !== false && !own.some(function (k) { return b[k] !== undefined && b[k] !== null && b[k] !== 'house'; });
        })[0] || keys[0] || null;
      }
      houseSky(sub) {
        var self = this, base = '#/house/appearance/sky', title = 'Background';
        var scope = 'Applies to every screen.';
        var mk = function (tt, body, back) { return { title: tt, back: back || [title, base], body: body }; };
        if (sub[0] === 'advanced') return mk('Advanced', function (c) { self.h_skyAdvanced(c); });
        if (sub[0] === 'backdrop') return mk('Sky Colors', function (c) { self.h_backdrop(c); });
        if (sub[0] === 'landscape') return mk('Choose a Landscape', function (c) {
          self.landscapePick(c, { value: self.data.settings.sky.landscape || 'every:1440', fk: 'hlandpick',
                                  onSet: function (v) { self.setH({ 'sky.landscape': v }); } });
        });
        if (sub[0] === 'pages') return mk('Background', function (c) { self.h_sky(c); });
        if (sub[0] === 'lively') return mk('Each Occasion', function (c) { self.livelyList(c, null); });
        // FLAT'S OWN: its page while All Screens wears another look, and its
        // pages' -- and a page's while All Screens wears Flat
        var fbase = sub[0] === 'flat' ? base + '/flat' : base;
        var fsub = sub[0] === 'flat' ? sub.slice(1) : sub;
        if ((sub[0] === 'flat' || this.flatHere(null)) && fsub[0] === 'page' && fsub[1]) {
          var fkey = decodeURIComponent(fsub[1]), frow = this.skyRow(fkey, null);
          return mk(frow ? frow.label : 'Page', function (c) { if (frow) self.flatPagePicker(c, null, null, frow, fbase); },
                    frow && frow.room ? ['Room Pages', fbase + '/page/rooms'] : [sub[0] === 'flat' ? 'Flat Backgrounds' : 'Background', fbase]);
        }
        if (sub[0] === 'flat') return mk('Flat Backgrounds', function (c) { self.flatSky(c, null, null, fbase); }, ['Background', base]);
        if (sub[0] === 'page' && sub[1]) {
          var hkey = decodeURIComponent(sub[1]);
          var hrow = this.skyRow(hkey, null);
          return mk(hrow ? hrow.label : 'Page', function (c) { if (hrow) self.pagePicker(c, null, null, hrow); },
                    hrow && hrow.room ? ['Room Pages', base + '/page/rooms'] : ['Background', base]);
        }
        if (sub[0] === 'woodland' && sub[1]) {
          var ws = M.WOODLAND.filter(function (w) { return w[0] === sub[1]; })[0];
          if (ws) return mk(ws[1], function (c) { self.h_season(c, ws); }, ['Woodland Between Occasions', base + '/woodland']);
        }
        if (sub[0] === 'woodland') return mk('Woodland Between Occasions', function (c) { self.h_woodland(c); });
        if (sub[0] === 'night') return mk('Night Sky', function (c) { self.h_nightSky(c); });
        // THE SKY'S PREVIEW: today's sky on the Sky page, a theme's on its
        // own page (skyPreview), on the house's Home screen
        var spv = M.skyPreviewScreen(this.data.dashboards, this.data.boards);
        var withSky = function (pg, theme) { if (spv) { pg.preview = spv; pg.sky = { theme: theme }; } return pg; };
        var th = M.SKY_THEMES.filter(function (x) { return x.id === sub[0]; })[0];
        if (th) return withSky(mk(th.label, function (c) { self.h_theme(c, th); }), th.id);
        return withSky({ title: title, back: ['Appearance', '#/house/appearance'], scope: scope, body: function (c) { self.h_sky(c); } }, null);
      }
      // EVERY PAGE PILL, each a way to its look
      h_pills(c) {
        var pills = this.hs('look.page_pills') || {};
        c.appendChild(K.group({ footer: 'A screen chooses which page pills its Scenes row shows; how each looks is the same everywhere.' },
          Object.keys(M.PAGE_PILL_DEFAULTS).map(function (k) {
            var d = M.PAGE_PILL_DEFAULTS[k], own = pills[k] || {};
            return K.nav({ label: own.name || d[0], sub: own.name ? d[0] : null, icon: own.icon || d[1],
                           value: Object.keys(own).length ? 'Customized' : '', href: '#/page/' + k + '/pill', fk: 'pill:' + k });
          })));
      }
      // TILE STYLE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase B): the Home
      // Grid's tiles in the Home app's layout (the room pages' Tall pills always are, 2026-10-31) or
      // Centred, HomeView's -- All Screens', or a screen's own (b, path) with
      // Same as All Screens / Just This Screen and its Reset
      tileStyleRows(b, path) {
        var known = function (v) { return M.TILE_STYLES.some(function (o) { return o[0] === v; }); };
        var self = this, house = known((this.data.settings.look || {}).tile_style) ? this.data.settings.look.tile_style : 'auto';
        var own = !!b && known(b.tile_style);
        var rows = [K.seg({ label: 'Tile Style', sk: b ? 'b:tile_style' : 'look.tile_style', value: own ? b.tile_style : house, options: M.TILE_STYLES,
          sub: b ? (own ? 'Just This Screen' : 'Same as All Screens') : null,
          onChange: function (v) { if (b) self.setB(path, { tile_style: v }); else self.setH({ 'look.tile_style': v }); } })];
        if (own) rows.push(K.button({ label: 'Reset to All Screens (' + M.choiceLabel(M.TILE_STYLES, house) + ')', sk: 'b:tile_style:reset',
          onClick: function () { self.setB(path, { tile_style: null }); } }));
        return rows;
      }
      // THE ROWS UNDER GLASS STYLE, the same on All Screens' Appearance and a
      // screen's page: the amount of the style in use, with Frosted its Tint
      // from Background, with Tinted its Darkness (stored `tint`) and Icon
      // Circles (`well`). `v`: {frost, tint, blur, dark, well} -- each its value and
      // onChange, and on a screen `own`/`house`/`reset` for the inherited
      // pattern (Same as All Screens / Just This Screen, Reset to All Screens).
      glassRows(style, v, skp) {
        var self = this, rows = [], uses = M.amountsFor(style);
        // k: v's entry; key: the stored name, when it differs (Darkness is `tint`)
        var amount = function (k, label, key) {
          var a = v[k];
          key = key || k;
          // whose it is in the sub-line, as every other inherited row says it (a
          // gray badge until 2026-10-30)
          // (the preview's glass follows it as it moves, 2026-11-01, as the Side Pane's Dim does)
          rows.push(K.slider({ label: label, sk: skp + key, value: a.value, unit: '%', step: 5,
            sub: a.house == null ? null : (a.own ? 'Just This Screen' : 'Same as All Screens'),
            onInput: function (n) { self.pvAmount(key, n); }, onChange: a.onChange }));
          if (a.own) rows.push(K.button({ label: 'Reset to All Screens (' + a.house + '%)', sk: skp + key + ':reset', onClick: a.reset }));
        };
        if (uses.frost) {
          amount('frost', 'Frost');
          var t = v.tint;
          rows.push(K.toggle({ label: 'Tint from Background', sk: skp + 'frost_tint', on: t.on,
            sub: t.house == null ? null : (t.own ? 'Just This Screen' : 'Same as All Screens'), onChange: t.onChange }));
          if (t.own) rows.push(K.button({ label: 'Reset to All Screens (' + (t.house ? 'On' : 'Off') + ')', sk: skp + 'frost_tint:reset',
            onClick: t.reset }));
        }
        if (uses.blur) amount('blur', 'Blur');
        // BRIGHT GLASS's Strength (2026-10-30), held back by itself over a light
        // background (hkSettings.brightCap)
        if (uses.bright && v.bright) amount('bright', 'Strength');
        // ...and its DIM (2026-11-01, the owner: like the Side Pane's): a shade over the cards, the chips and the bars,
        // 0-60 %; the Side Pane's follows it unless it has its own
        if (uses.bright && v.brightDim) {
          var bd = v.brightDim;
          rows.push(K.slider({ label: 'Dim', sk: skp + 'bright_dim', value: bd.value, min: 0, max: M.BRIGHT_DIM_MAX, step: 5, unit: '%',
            sub: bd.house == null ? null : (bd.own ? 'Just This Screen' : 'Same as All Screens'),
            onInput: function (n) { self.pvAmount('bright_dim', n); }, onChange: bd.onChange }));
          if (bd.own) rows.push(K.button({ label: 'Reset to All Screens (' + bd.house + '%)', sk: skp + 'bright_dim:reset', onClick: bd.reset }));
        }
        // ...and where it shows (2026-10-30): Home Only (and the Pages screen,
        // 2026-10-31), the other pages in its Blur, or Every Page
        if (uses.bright && v.brightPages) {
          var bp = v.brightPages;
          rows.push(K.seg({ label: 'Bright Glass On', sk: skp + 'bright_pages', value: bp.value, options: M.BRIGHT_PAGES,
            sub: bp.house == null ? 'Home Only: Home and the Pages screen; the other pages in Blur' : (bp.own ? 'Just This Screen' : 'Same as All Screens'), onChange: bp.onChange }));
          if (bp.own) rows.push(K.button({ label: 'Reset to All Screens (' + M.choiceLabel(M.BRIGHT_PAGES, bp.house) + ')', sk: skp + 'bright_pages:reset', onClick: bp.reset }));
        }
        if (uses.tint && v.dark) {
          amount('dark', 'Darkness', 'tint');
          var w = v.well;
          rows.push(K.seg({ label: 'Icon Circles', sk: skp + 'well', value: w.value, options: M.TINT_WELLS,
            sub: w.house == null ? null : (w.own ? 'Just This Screen' : 'Same as All Screens'), onChange: w.onChange }));
          if (w.own) rows.push(K.button({ label: 'Reset to All Screens (' + M.choiceLabel(M.TINT_WELLS, w.house) + ')',
            sk: skp + 'well:reset', onClick: w.reset }));
        }
        return rows;
      }
      flatThemeRows(b, look, path) {
        var self = this, own = b && (b.flat_theme === 'light' || b.flat_theme === 'dark');
        var house = look.flat_theme === 'light' ? 'light' : 'dark';
        var rows = [K.seg({ label: 'Theme', sk: b ? 'b:flat_theme' : 'look.flat_theme',
          value: own ? b.flat_theme : house, options: [['light', 'Light'], ['dark', 'Dark']],
          sub: b ? (own ? 'Just This Screen' : 'Same as All Screens') : null,
          onChange: function (v) { if (b) self.setB(path, { flat_theme: v }); else self.setH({ 'look.flat_theme': v }); } })];
        if (own) rows.push(K.button({ label: 'Reset Theme to All Screens', sk: 'b:flat_theme:reset',
          onClick: function () { self.setB(path, { flat_theme: null }); } }));
        return rows;
      }
      h_glass(c) {
        var self = this, look = this.data.settings.look;
        this.glassChoices(c, look.flat === true ? 'flat' : look.glass || 'clear', 'blur', function (v) {
          self.setH(v === 'flat' ? { 'look.flat': true } : { 'look.flat': false, 'look.glass': v });
        }, 'hglass:');
      }
      // UNDER ALL SCREENS' STYLE: one line naming the screens that keep their
      // own look -- a change here doesn't reach them (2026-10-27: Home stayed
      // Flat under a Blur saved for All Screens) -- each a way to its own
      ownLooks(look) {
        var self = this, bd = this.data.boards || {}, own = [];
        Object.keys(bd).forEach(function (p) {
          var b = bd[p], g = b ? M.glassOf(b, look) : null, d = self.dash(p);
          if (g && g.own) own.push({ path: p, title: d ? d.title : p, label: M.glassLabel(g.value) });
        });
        if (!own.length) return 'Each screen can choose its own under its Appearance.';
        var parts = [];
        own.forEach(function (o, i) {
          if (i) parts.push(document.createTextNode(i === own.length - 1 ? (own.length > 2 ? ', and ' : ' and ') : ', '));
          parts.push(h('a', { href: '#/screens/' + encodeURIComponent(o.path) + '/glass', text: o.title }));
          parts.push(document.createTextNode(' (' + o.label + ')'));
        });
        parts.push(document.createTextNode(own.length > 1 ? ' keep their own look, so this doesn’t change them.'
                                                           : ' keeps its own look, so this doesn’t change it.'));
        return parts;
      }
      h_sky(c) {
        var self = this, sky = this.data.settings.sky, look = this.data.settings.look;
        if (look.flat === true) { this.flatSky(c, null, null, '#/house/appearance/sky'); return; }
        // a screen in Flat while All Screens isn't: All Screens' Flat
        // backgrounds, which it follows, a tap away
        var flatOnes = Object.keys(this.data.boards || {}).filter(function (p) { return self.flatHere(self.data.boards[p]); });
        if (flatOnes.length) {
          c.appendChild(K.group({ footer: flatOnes.map(function (p) { var d = self.dash(p); return d ? d.title : p; }).join(', ') +
              (flatOnes.length > 1 ? ' wear' : ' wears') + ' Flat, which has backgrounds of its own.' }, [
            K.nav({ label: 'Flat Backgrounds', value: this.flatSummary(null), href: '#/house/appearance/sky/flat', sk: 'sky.flat_background' })]));
        }
        // THE BACKGROUND FIRST (2026-10-13): Live Sky, a still Color or a
        // Photo -- and below it only what that one needs. Before, a solid color
        // took turning off Animations, Weather, Rain & Snow and setting a
        // Backdrop, and the stars still showed through.
        var mode = sky.background || 'live';
        c.appendChild(K.group({ footer: M.BG_SAYS[mode] + ' Each screen, and each page, can choose its own.' }, [
          K.previewPick({ label: 'Background', sk: 'sky.background', value: mode, options: M.SKY_BACKGROUNDS,
                  picture: function (v, w, ht) { return self.bgKindThumb(v, w, ht, sky.wallpaper, null, sky.wallpaper_color); },
                  onChange: function (v) { self.setH({ 'sky.background': v }); } })]));
        if (mode === 'color') {
          this.colorGroup(c, { id: sky.color || 'midnight', custom: sky.gradient_custom, fk: 'hcolor:',
            onPick: function (id) {
              var ch = { 'sky.color': id };
              if (id === 'custom' && !sky.gradient_custom) ch['sky.gradient_custom'] = self.dusk();
              self.setH(ch);
            },
            onCustom: function (v) { self.setH({ 'sky.gradient_custom': v }); }, scope: 'sky.gradient_custom' });
          this.skyPagesGroup(c, null, null);
          this.skyResetGroup(c, null, null);
          return;
        }
        if (mode === 'photo') {
          this.photoGroup(c, { url: sky.photo || null, fk: 'hphoto', sk: 'sky.photo',
            footer: 'Shown on Home, the room pages, and every page without a color of its own. Each screen can use a photo of its own.',
            onSet: function (url) { var was = sky.photo; self.setH({ 'sky.photo': url }).then(function (ok) { if (ok) self.photoForget(was); }); } });
          this.photoLookGroup(c, { look: sky.photo_look, sk: 'sky.photo_look', onSet: function (v) { self.setH({ 'sky.photo_look': v }); } });
          this.flatImageGroup(c, null, null, null, true);
          this.skyPagesGroup(c, null, null);
          this.skyResetGroup(c, null, null);
          return;
        }
        // LANDSCAPES (2026-10-14): HK Frontend's own photos -- which one, and
        // its own Look (a photo's, kept apart from your Photo's)
        if (mode === 'landscapes') {
          this.landscapeGroup(c, { value: sky.landscape || 'every:1440', fk: 'hland', sk: 'sky.landscape', href: '#/house/appearance/sky/landscape',
            footer: 'Shown on Home, the room pages, and every page without a color of its own. Each screen can choose its own.',
            onSet: function (v) { self.setH({ 'sky.landscape': v }); } });
          this.photoLookGroup(c, { look: sky.landscape_look, sk: 'sky.landscape_look', onSet: function (v) { self.setH({ 'sky.landscape_look': v }); } });
          this.flatImageGroup(c, null, null, null, true);
          this.skyPagesGroup(c, null, null);
          this.skyResetGroup(c, null, null);
          return;
        }
        // A WALLPAPER (2026-10-30): our own art -- which one, and when its night
        // version shows
        if (mode === 'wallpaper') {
          this.wallpaperGroup(c, { value: sky.wallpaper || 'ribbons', night: sky.wallpaper_night || 'auto', fk: 'hwall', sk: 'sky.wallpaper',
            footer: 'Shown on Home, the room pages, and every page without a color of its own. Each screen can choose its own.',
            motion: sky.wallpaper_motion || 'off', onMotion: function (v) { self.setH({ 'sky.wallpaper_motion': v }); },
            color: sky.wallpaper_color || 'blue', onColor: function (v) { self.setH({ 'sky.wallpaper_color': v }); },
            onSet: function (v, motion) { var ch = { 'sky.wallpaper': v }; if (motion) ch['sky.wallpaper_motion'] = motion; self.setH(ch); },
            onNight: function (v) { self.setH({ 'sky.wallpaper_night': v }); } });
          this.skyPagesGroup(c, null, null);
          this.skyResetGroup(c, null, null);
          return;
        }
        // RAIN & SNOW only while there is weather to fall; PAUSE WHEN NOT IN
        // FOCUS only while anything moves (2026-10-10)
        var bg = [
          K.toggle({ label: 'Animations', sub: 'The moving parts — drifting clouds, falling rain and snow, the seasons, and a running fan’s spinning icon.',
            sk: 'sky.animations', on: sky.animations !== false, onChange: function (on) { self.setH({ 'sky.animations': on }); } })];
        if (sky.animations !== false) {
          bg.push(K.toggle({ label: 'Pause When Not in Focus', sub: 'On a computer, everything holds still while another window is in front, ' +
              'and picks up where it left off when you come back. Saves most of the work the dashboard does while you aren’t looking.',
            sk: 'sky.focus_pause', on: sky.focus_pause !== false, onChange: function (on) { self.setH({ 'sky.focus_pause': on }); } }));
          bg.push(K.seg({ label: 'Moving Things', sub: 'Rain and snow, falling leaves, bats and birds, flybys and confetti. ' +
              'In front, they cross over the cards — taps still go straight through to them. Fireworks, fog and clouds stay behind.',
            sk: 'sky.moving', value: sky.moving || 'behind', options: M.SKY_MOVING, stack: !this.hasAttribute('wide'),
            onChange: function (v) { self.setH({ 'sky.moving': v }); } }));
        }
        bg.push(K.toggle({ label: 'Weather', sub: 'Clouds, rain, snow and fog. The sun, moon and stars stay.',
            sk: 'sky.weather', on: sky.weather !== false, onChange: function (on) { self.setH({ 'sky.weather': on }); } }));
        if (sky.weather !== false) {
          bg.push(K.toggle({ label: 'Rain & Snow', sub: sky.animations === false
              ? 'Not shown while Animations are off — it can’t fall'
              : 'The falling rain and snow. Off, the clouds and fog still move, and it takes less work to draw',
            sk: 'sky.precipitation', on: sky.precipitation !== false, onChange: function (on) { self.setH({ 'sky.precipitation': on }); } }));
        }
        c.appendChild(K.group({ header: 'Live Sky' }, bg.concat([
          K.seg({ label: 'Clouds', sub: 'Classic drifting haze, or realistic photographic clouds', sk: 'sky.cloud_style',
            value: sky.cloud_style || 'classic', options: M.CLOUD_STYLES, stack: !this.hasAttribute('wide'),
            onChange: function (v) { self.setH({ 'sky.cloud_style': v }); } }),
          K.seg({ label: 'Daytime Sky', sub: 'How bright the daytime blue runs. Sunsets and nights are the same.', sk: 'sky.daytime', stack: !this.hasAttribute('wide'),
            value: sky.daytime || 'natural', options: M.DAYTIME_SKIES,
            onChange: function (v) { self.setH({ 'sky.daytime': v }); } }),
          K.nav({ label: 'Sky Colors', sub: 'The live sky’s own colors, with its weather and decorations', value: this.backdropLabel(sky.gradient),
                  href: '#/house/appearance/sky/backdrop', sk: 'sky.gradient' })])));
        this.skyPagesGroup(c, null, null);
        var rows = [K.toggle({ label: 'Seasonal Decorations', sk: 'sky.decorations', on: sky.decorations !== false,
                               onChange: function (on) { self.setH({ 'sky.decorations': on }); } })];
        rows.push(K.seg({ label: 'Decoration Style', sub: 'Holidays, seasons and special occasions', sk: 'sky.decoration_style',
          value: sky.decoration_style || 'old', options: [['old', 'Old Decorations'], ['new', 'New Decorations']], stack: !this.hasAttribute('wide'),
          onChange: function (v) { self.setH({ 'sky.decoration_style': v }); } }));
        rows.push(K.nav({ label: 'Woodland Between Occasions', sub: 'New Decorations, on days with no holiday',
          value: M.woodlandSummary(sky.woodland), href: '#/house/appearance/sky/woodland', sk: 'sky.woodland' }));
        if (sky.decorations !== false) {
          M.SKY_THEMES.forEach(function (t) {
            var on = (sky.themes || []).indexOf(t.id) >= 0;
            rows.push(K.nav({ label: t.label, value: on ? self.livelyValue(t.id) : 'Off', href: '#/house/appearance/sky/' + t.id, sk: 'sky:' + t.id }));
          });
        }
        var gate = sky.seasonal ? ' They also need ' + this.name(sky.seasonal) + ' to be on (Advanced).' : '';
        c.appendChild(K.group({ header: 'Seasonal Decorations', footer: 'What the live sky dresses up for. This is the same switch as Seasonal Decorations on the ' + haName('HK Frontend device') + '.' + gate }, rows));
        // LIVELINESS (2026-10-09): one preset for every holiday, occasion,
        // season and the Night Sky, or Custom -- each its own (Each Occasion)
        if (this.livelyMoves()) {
          var lrows = [K.select({ label: 'Liveliness', sub: 'How many little things move, and how often', sk: 'sky.liveliness_all',
            value: sky.liveliness_all || 'classic', options: M.LIVELY_ALL, onChange: function (v) { self.setH({ 'sky.liveliness_all': v }); } })];
          if (sky.liveliness_all === 'custom') {
            lrows.push(K.nav({ label: 'Each Occasion', sub: 'Every holiday, occasion, season and the Night Sky', href: '#/house/appearance/sky/lively',
                               sk: 'sky.liveliness', value: 'Custom' }));
          }
          c.appendChild(K.group({ footer: 'Liveliness: the decorations’ little moving things — bats, leaves, snow, ' +
              'fireflies — and the Night Sky’s stars. Custom sets each occasion its own. Each screen can choose its own.' }, lrows));
        }
        c.appendChild(K.group({ header: 'Sky Switch', footer: 'While this helper is off, no generated screen shows the live sky. A screen written in YAML names its own.' }, [
          this.entityRow({ label: 'Sky Switch', sk: 'look.sky_switch', value: look.sky_switch, none: 'None (Always On)',
                           filter: { domains: ['input_boolean', 'switch'] }, onPick: function (v) { self.setH({ 'look.sky_switch': v }); } })]));
        c.appendChild(K.group({}, [K.nav({ label: 'Advanced', sub: 'Hemisphere, sources, what decorations need', href: '#/house/appearance/sky/advanced' })]));
        this.skyResetGroup(c, null, null);
      }
      // RESET TO DEFAULTS (2026-10-14, the owner's ask): every setting on this
      // Sky / Background page goes back -- All Screens' to HK's defaults
      // (settings.py SKY_RESET, server side), a screen's to Same as All
      // Screens -- but never the Pages (each page's own background, photo and
      // look). A photo or custom colors you made are kept for next time.
      skyResetGroup(c, x, b) {
        var self = this;
        c.appendChild(K.group({ footer: b ? 'Every setting on this page goes back to Same as All Screens. The Pages keep their own backgrounds.'
                                          : 'Every setting on this page goes back to its default. The Pages keep their own backgrounds, and a photo or custom colors you made are kept for next time.' }, [
          K.button({ label: 'Reset to Defaults…', destructive: true, fk: b ? 'sky:screen-reset' : 'sky:house-reset', onClick: function () {
            K.confirm(self.shadowRoot, { title: b ? 'Use the Background for All Screens?' : 'Use the default Background?',
              message: b ? 'Every setting on this page goes back to Same as All Screens. Each page’s own background stays.'
                         : 'Every setting on this page goes back to its default: the Live Sky, with its weather, decorations and liveliness. Each page’s own background stays.',
              ok: 'Use Defaults', destructive: true }).then(function (yes) {
              if (!yes) return;
              if (!b) { self.setH({ 'sky.reset': true }); return; }
              var ch = { sky: true, sky_liveliness_occ: {}, sky_liveliness_custom: {}, sky_calm_empty: false };
              ['sky_background', 'sky_color', 'sky_landscape', 'sky_photo_look', 'sky_landscape_look', 'sky_animations', 'sky_focus_pause',
               'sky_moving', 'sky_weather', 'sky_precipitation', 'sky_cloud_style', 'sky_daytime', 'sky_gradient', 'sky_decorations',
               'sky_decoration_style', 'sky_liveliness', 'sky_flat_background', 'sky_flat_color', 'sky_flat_fade', 'sky_flat_tint', 'sky_flat_tint_amount', 'sky_flat_tint_light', 'sky_flat_image_look', 'sky_image_look',
               'sky_wallpaper', 'sky_wallpaper_night', 'sky_wallpaper_motion', 'sky_wallpaper_color'].forEach(function (k) { ch[k] = null; });
              self.setB(x.path, ch);
            });
          } })]));
      }
      // HK FRONTEND'S OWN LANDSCAPES (2026-10-14), as the screensaver's clock
      // has them: the list from the folder's index.json (a home's own files
      // folder can answer with its own), fetched once; null until it comes.
      landscapes() {
        if (this._land) return this._land;
        if (!this._landAsk && typeof fetch === 'function') {
          var self = this;
          this._landAsk = true;
          fetch('/hk/landscapes/index.json').then(function (r) { return r.json(); }).then(function (j) {
            self._land = ((j && j.photos) || []).filter(function (p) { return p && typeof p.file === 'string' && LAND_FILE.test(p.file); });
            self.render(true);
          }).catch(function () { self._landAsk = false; });
        }
        return null;
      }
      // THE BACKGROUND'S KINDS, SMALL (2026-10-31; its previewPick): Live Sky the sun over a hill under a day's sky,
      // Color a still evening's colors (Flat's, `solid`: its one color), Photo a photo of your own (a picture of
      // one), Landscapes the first, and Wallpaper the one chosen (`wall`; a motion theme in its colour, `col`) -- drawn
      // as pictures, nothing live
      bgKindThumb(kind, w, ht, wall, solid, col) {
        var el = document.createElement('span');
        el.style.cssText = 'display:block;width:' + w + 'px;height:' + ht + 'px;background-position:center;background-size:cover';
        var W = window.hkWallpapers, wurl = kind === 'wallpaper' && W && W.url ? W.url(wall || 'ribbons', false, col) : null;
        if (kind === 'live') el.innerHTML = '<svg viewBox="0 0 88 61" width="100%" height="100%" preserveAspectRatio="none"><defs><linearGradient id="bk-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f86d0"/><stop offset="1" stop-color="#bfe0f5"/></linearGradient></defs><rect width="88" height="61" fill="url(#bk-l)"/><circle cx="64" cy="18" r="7" fill="#fff6cf"/><path d="M0 48C20 38 36 42 52 40S76 36 88 42V61H0z" fill="#5d8a5f"/></svg>';
        else if (kind === 'color') el.style.background = 'linear-gradient(#1b2350,#5a3a78 55%,#d9826b)';
        else if (kind === 'solid') el.style.background = solid || '#24252A';
        else if (kind === 'photo') el.innerHTML = '<svg viewBox="0 0 88 61" width="100%" height="100%" preserveAspectRatio="none"><rect width="88" height="61" fill="#d9c4a5"/><circle cx="30" cy="22" r="9" fill="#8a5a3c"/><path d="M14 61c2-16 10-24 16-24s14 8 16 24z" fill="#365f8a"/><circle cx="60" cy="25" r="8" fill="#c99a76"/><path d="M45 61c2-14 9-21 15-21s13 7 15 21z" fill="#b04a4a"/></svg>';
        else if (kind === 'landscapes') el.style.backgroundImage = 'url("/hk/landscapes/thumbs/01.webp")';
        else if (wurl) el.style.backgroundImage = 'url("' + wurl + '")';
        else el.style.background = 'linear-gradient(160deg,#c45a7c,#6a3d8f)';
        return el;
      }
      // a landscape's picture: its small copy (`thumb`) for the grid, else the photo
      landSrc(p, big) {
        return '/hk/landscapes/' + (!big && typeof p.thumb === 'string' && /^thumbs\/[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(webp|jpe?g|png)$/i.test(p.thumb) ? p.thumb : p.file);
      }
      // WHICH LANDSCAPE, AND WHEN IT CHANGES (the owner's three): Each Time
      // the Screen Wakes, On a Schedule (with how often), or Stay the Same --
      // on the one showing now, or one picked (Choose a Landscape...). The one
      // showing now above them.
      //   o = { value (own; null following), house (All Screens', on a
      //         screen), onSet(v | null), href, fk, sk, footer }
      landscapeGroup(c, o) {
        var list = this.landscapes() || [], eff = o.value || o.house || 'every:1440', rows = [];
        var own = o.house === undefined ? eff : o.value;
        var kind = function (v) { return !v ? null : v === 'wake' ? 'wake' : /^every:/.test(v) ? 'every' : 'stay'; };
        var file = M.landscapeFile(eff, list), p = list.filter(function (x) { return x.file === file; })[0];
        if (p) {
          rows.push(h('div', { class: 'cell photoprev' }, [h('img', { src: this.landSrc(p, true), alt: p.title || 'The landscape', 'data-fk': o.fk + ':img' }),
            h('small', { text: (kind(eff) === 'wake' ? 'For now: ' : kind(eff) === 'every' ? 'Now: ' : '') + (p.title || '') })]));
        }
        if (o.house !== undefined) {
          rows.push(K.check({ label: 'Same as All Screens', sub: 'Now ' + M.landscapeLabel(o.house, list), on: !o.value, fk: o.fk + ':follow',
                              onClick: function () { o.onSet(null); } }));
        }
        rows.push(K.check({ label: 'Each Time the Screen Wakes', sub: 'A new one while the screensaver or the black is up, so it is there when the screen wakes',
                            on: kind(own) === 'wake', fk: o.fk + ':wake', onClick: function () { o.onSet('wake'); } }));
        rows.push(K.check({ label: 'On a Schedule', sub: kind(own) === 'every' ? M.landscapeLabel(own) : 'Every day, every hour …',
                            on: kind(own) === 'every', fk: o.fk + ':every', onClick: function () { if (kind(own) !== 'every') o.onSet('every:1440'); } }));
        if (kind(own) === 'every') {
          rows.push(K.select({ label: 'Change', sk: o.sk + ':every', value: own, options: M.LANDSCAPE_EVERY, onChange: function (v) { o.onSet(v); } }));
        }
        // Stay the Same: on the one showing now, until another is picked
        rows.push(K.check({ label: 'Stay the Same', sub: kind(own) === 'stay' ? M.landscapeLabel(own, list) : 'The one showing now, or one you choose',
                            on: kind(own) === 'stay', fk: o.fk + ':stay', onClick: function () { if (kind(own) !== 'stay' && file) o.onSet(file); } }));
        rows.push(K.nav({ label: 'Choose a Landscape', href: o.href, sk: o.sk }));
        c.appendChild(this.withError(K.group({ header: 'Landscape', footer: (o.footer ? o.footer + ' ' : '') +
          'Fifty photos that come with ' + PN() + ', all public domain or CC0, from Wikimedia Commons.' }, rows), o.sk));
      }
      // A WALLPAPER: ONE COMBINED PICKER (2026-11-01, item 45: the owner's
      // Option A, after 2026-10-30's twelve and 2026-10-31's motion themes). The
      // four arts and the six motion themes side by side, each drawn by the
      // builder the screen draws it with, in the colour chosen, the one in use
      // ticked; a MOVES mark on the ones that move -- the themes always, and
      // every one while the Motion is on (the arts sway then too). Under them
      // one Color for all of them (the presets one tap each, then Your Own
      // Color, as the Accent Color's page has them), the Motion, then the Night
      // Version. On a screen: Same as All Screens (`house`, `nightHouse` ...)
      // until it picks its own.
      //   o = { value (own, or null), house, night (own, or null), nightHouse,
      //         onSet(id | null, motion), onNight(v | null), fk, sk, footer,
      //         color (own, or null), colorHouse, onColor(v | null),
      //         motion, motionHouse, onMotion, saver (the clock's: its own
      //         Speed and the sun stand for Motion and Night Version),
      //         moving (the saver's: its Speed is not 0) }
      // Picking a theme while the Motion is Off turns it to Slow (in the same
      // place: All Screens' or the screen's own): a moving background that
      // stood still would look broken. Motion Off afterwards keeps it still.
      wallpaperGroup(c, o) {
        var W = window.hkWallpapers, eff = o.value || o.house, rows = [];
        if (!W) { c.appendChild(K.group({ header: 'Wallpaper' }, [K.info({ label: 'Loading…', value: '' })])); return; }
        var list = W.list(), name = function (id) { var r = W.resolve(id); return (list.filter(function (w) { return w.id === r.id; })[0] || {}).name || id; };
        var mEff = o.motion || o.motionHouse || 'off', cEff = o.color || o.colorHouse || W.COLOR_DEFAULT;
        // (an old id, should one still be stored: its art in its own preset)
        var old = W.legacy(eff);
        if (old) { eff = old[0]; cEff = old[1]; }
        var moving = o.saver ? !!o.moving : mEff !== 'off';
        if (o.house !== undefined) {
          rows.push(K.check({ label: 'Same as All Screens', sub: 'Now ' + name(o.house), on: !o.value, fk: o.fk + ':follow',
                              onClick: function () { o.onSet(null); } }));
        }
        rows.push(h('div', { class: 'cell wallgrid' }, list.map(function (w) {
          var on = eff === w.id;
          var bt = h('button', { class: on ? 'on' : '', type: 'button', title: w.name, 'aria-label': w.name + (w.moves || moving ? ', moves' : ''),
                                 'aria-pressed': on ? 'true' : 'false', 'data-fk': o.fk + ':' + w.id },
                     [h('span', { class: 'pic' }, [h('img', { src: W.url(w.id, false, cEff), alt: '' })].concat(w.moves || moving ? [h('b', { class: 'mv', text: 'MOVES' })] : [])),
                      h('span', { text: w.name })]);
          bt.addEventListener('click', function () { o.onSet(w.id, !o.saver && w.theme && mEff === 'off' ? 'slow' : null); });
          return bt;
        })));
        c.appendChild(this.withError(K.group({ header: 'Wallpaper', footer: (o.footer ? o.footer + ' ' : '') +
          'Four wallpapers and six motion themes, our own art, each in the color below.' + (o.saver ? '' : ' The cards take its colors — Bright Glass shows them best.') }, rows), o.sk));
        this.wallColorGroup(c, o, cEff);
        // (the screensaver's clock: its night version follows the sun, its motion is the Background's Speed)
        if (o.saver) return;
        // MOTION (2026-10-30): the picture drifts, or a theme's layers move, at a speed
        var mOwn = o.motionHouse !== undefined && !!o.motion;
        var mRows = [K.seg({ label: 'Motion', sub: o.motionHouse === undefined ? null : (mOwn ? 'Just This Screen' : 'Same as All Screens'),
          sk: o.sk.replace('wallpaper', 'wallpaper_motion'), value: mEff, options: M.WALLPAPER_MOTION, onChange: function (v) { o.onMotion(v); } })];
        if (mOwn) mRows.push(K.button({ label: 'Reset to All Screens (' + M.choiceLabel(M.WALLPAPER_MOTION, o.motionHouse) + ')',
          sk: o.sk.replace('wallpaper', 'wallpaper_motion') + ':reset', onClick: function () { o.onMotion(null); } }));
        c.appendChild(K.group({ footer: 'A wallpaper drifts, sways or turns slowly; a motion theme moves its own way. It stops while the screen is dark or hidden, ' +
          'when Animations are off, and for Reduce Motion.' }, mRows));
        var nOwn = o.nightHouse !== undefined && !!o.night, nEff = o.night || o.nightHouse || 'auto';
        var nRows = [K.seg({ label: 'Night Version', sub: o.nightHouse === undefined ? null : (nOwn ? 'Just This Screen' : 'Same as All Screens'),
          sk: o.sk.replace('wallpaper', 'wallpaper_night'), value: nEff, options: M.WALLPAPER_NIGHT, onChange: function (v) { o.onNight(v); } })];
        if (nOwn) nRows.push(K.button({ label: 'Reset to All Screens (' + M.choiceLabel(M.WALLPAPER_NIGHT, o.nightHouse) + ')',
          sk: o.sk.replace('wallpaper', 'wallpaper_night') + ':reset', onClick: function () { o.onNight(null); } }));
        c.appendChild(K.group({ footer: 'Each one has a darker version for the night. After Sunset: it fades in as the sun goes down.' }, nRows));
      }
      // A MOTION THEME'S COLOR (2026-10-31): Same as All Screens (on a screen),
      // the presets (hk-wallpapers.js COLORS, settings.py WALLPAPER_COLORS), and
      // Your Own Color -- the rows and the color well the Accent Color uses.
      // `cEff`: the color in use.
      wallColorGroup(c, o, cEff) {
        var W = window.hkWallpapers, rows = [], hex = W.color(cEff), mine = o.colorHouse === undefined || !!o.color;
        var preset = function (v) { return W.COLORS.filter(function (p) { return p[0] === v; })[0] || null; };
        var label = function (v) { var p = preset(v); return p ? p[1] : String(W.color(v)).toUpperCase(); };
        if (o.colorHouse !== undefined) {
          rows.push(K.check({ label: 'Same as All Screens', sub: 'Now ' + label(o.colorHouse), on: !o.color, fk: o.fk + ':color:follow',
                              tile: ['', W.color(o.colorHouse)], onClick: function () { o.onColor(null); } }));
        }
        W.COLORS.forEach(function (p) {
          rows.push(K.check({ label: p[1], tile: ['', p[2]], on: mine && cEff === p[0], fk: o.fk + ':color:' + p[0], onClick: function () { o.onColor(p[0]); } }));
        });
        var own = mine && !preset(cEff);
        var row = K.text({ label: 'Your Own Color', sub: own ? hex.toUpperCase() : 'Pick any color.', type: 'color', fk: o.fk + ':color:custom',
                           value: hex, onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) o.onColor(t.toLowerCase()); } });
        var inp = row.querySelector('input');
        if (inp) {
          inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
          inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) o.onColor(inp.value.toLowerCase()); });
        }
        if (own) row.classList.add('on');
        rows.push(row);
        c.appendChild(this.withError(K.group({ header: 'Color', footer: 'The wallpaper or theme is drawn in this color’s shades, darker at night. A very light or very dark color ' +
          'is drawn in its own hue but kept deep enough for the cards’ text to stay easy to read.' }, rows), o.sk.replace('wallpaper', 'wallpaper_color')));
      }
      // CHOOSE A LANDSCAPE: every one, small, the one it stays on ticked; a
      // tap picks it, and it stays (Stay the Same).
      landscapePick(c, o) {
        var self = this, list = this.landscapes();
        if (!list) { c.appendChild(K.group({}, [K.info({ label: 'Loading…', value: '' })])); return; }
        var grid = h('div', { class: 'landgrid' }, list.map(function (p) {
          var on = o.value === p.file;
          var bt = h('button', { class: on ? 'on' : '', type: 'button', title: p.title || p.file, 'aria-label': p.title || p.file,
                                 'aria-pressed': on ? 'true' : 'false', 'data-fk': o.fk + ':' + p.file },
                     [h('img', { src: self.landSrc(p), alt: '', loading: 'lazy' })]);
          bt.addEventListener('click', function () { o.onSet(p.file); });
          return bt;
        }));
        c.appendChild(K.group({ header: 'Landscapes', footer: 'The one you choose stays (Stay the Same). To change it each time the screen wakes, or on a schedule, go back to Background.' },
                              [h('div', { class: 'cell landcell' }, [grid])]));
      }
      dusk() {
        var d = ((this.data.choices || {}).sky_backdrops || []).filter(function (p) { return p.id === 'dusk'; })[0];
        return d ? { day: d.day.slice(), night: d.night.slice() } : null;
      }
      // A STILL COLOR (the Background's Color, or a page's): the colors -- not
      // Live Sky -- with Same as All Screens first where there is one to follow.
      //   o = { id (own, or null following), follow: [label, id] (Same as ...),
      //         custom (stops), onPick(id | null), onCustom(stops), scope, fk }
      colorGroup(c, o) {
        var rows = [];
        if (o.follow) rows.push(K.check({ label: o.follow[0], sub: 'Now ' + this.backdropLabel(o.follow[1]), on: !o.id, fk: o.fk + 'follow',
                                          onClick: function () { o.onPick(null); } }));
        var all = this.backdropRows(o.id, o.custom, o.onPick, o.fk).filter(function (r) { return r.getAttribute('data-fk') !== o.fk + 'live'; });
        c.appendChild(K.group({ header: o.header || 'Color', footer: o.footer || 'The top of the screen to the bottom. Each has its day colors and, after sunset, its night ones.' }, rows.concat(all)));
        var eff = o.id || (o.follow && o.follow[1]);
        if (o.id === 'custom') this.customBackdrop(c, o.custom, o.scope, o.onCustom);
        else if (!o.id && eff === 'custom') c.appendChild(K.group({ footer: 'Custom’s colors are chosen where it is followed.' }, []));
      }
      // A PHOTO OF YOUR OWN (the Background's Photo, or a page's): what is
      // shown, Choose Photo... and Remove. Uploaded to Home Assistant's own
      // image store (image_upload, as a person's or an area's picture is),
      // made no bigger than 2560 px first -- a phone's 12-megapixel original
      // would cost a wall tablet ~48 MB to draw.
      //   o = { url (own), from (followed, shown when there is no own),
      //         fromLabel, onSet(url | null), fk, sk, header, footer }
      photoGroup(c, o) {
        var self = this, shown = o.url || o.from, rows = [], up = this._upl && this._upl.fk === o.fk ? this._upl : null;
        if (shown) {
          var im = h('img', { src: shown, alt: o.url ? 'The photo' : o.fromLabel, 'data-fk': o.fk + ':img' });
          rows.push(h('div', { class: 'cell photoprev' }, [im, o.url ? null : h('small', { text: o.fromLabel })]));
        }
        var inp = h('input', { type: 'file', accept: 'image/*', 'data-fk': o.fk + ':file', style: 'display:none' });
        inp.addEventListener('change', function () {
          var f = inp.files && inp.files[0];
          inp.value = '';
          if (f) self.photoUpload(f, o.fk).then(function (url) { if (url) o.onSet(url); });
        });
        if (up && up.busy) rows.push(K.info({ label: 'Uploading…', value: '' }));
        else rows.push(K.button({ label: o.url ? 'Choose Another Photo…' : 'Choose Photo…', fk: o.fk + ':choose', icon: 'mdi:image-plus', onClick: function () { inp.click(); } }));
        if (o.url && !(up && up.busy)) rows.push(K.button({ label: o.from ? 'Use ' + o.fromLabel : 'Remove Photo', destructive: !o.from, fk: o.fk + ':remove',
                                                            onClick: function () { o.onSet(null); } }));
        var g = K.group({ header: o.header || 'Photo', footer: !shown ? 'No photo yet: it shows Black until one is chosen. ' + (o.footer || '') : o.footer }, rows);
        g.appendChild(inp);
        c.appendChild(g);
        if (up && up.error) c.appendChild(h('div', { class: 'errline', role: 'alert', text: up.error }));
        if (o.sk && this.err(o.sk)) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err(o.sk) }));
      }
      // A PHOTO'S LOOK (2026-10-13): Blur, Dim, Saturation and a Color Tint --
      // one of the Color backdrops washed over it at Tint Strength. Each
      // change saves the whole look (settings.py photo_look).
      //   o = { look (as shown), own (a screen: its own, else All Screens'
      //         -- undefined for All Screens), onSet(look | null), fk, sk }
      photoLookGroup(c, o) {
        var L = Object.assign({ blur: 0, dim: 0, saturation: 100, tint: '', tint_amount: 35 }, o.look || {});
        var put = function (k, v) { var n = Object.assign({}, L); n[k] = v; o.onSet(n); };
        var colors = ((this.data.choices || {}).sky_backdrops || []).filter(function (p) { return p.id !== 'live'; });
        var rows = [
          K.slider({ label: 'Blur', sk: o.sk + ':blur', value: L.blur, min: 0, max: 100, unit: '%', onChange: function (v) { put('blur', v); } }),
          K.slider({ label: 'Dim', sk: o.sk + ':dim', value: L.dim, min: 0, max: 80, unit: '%', onChange: function (v) { put('dim', v); } }),
          K.slider({ label: 'Saturation', sub: '100% as taken; 0% black and white', sk: o.sk + ':saturation', value: L.saturation, min: 0, max: 200, step: 5, unit: '%',
                     onChange: function (v) { put('saturation', v); } }),
          K.select({ label: 'Color Tint', sub: 'One of the Colors, washed over it', sk: o.sk + ':tint', value: L.tint || '',
                     options: [['', 'None']].concat(colors.map(function (p) { return [p.id, p.label]; })),
                     onChange: function (v) { put('tint', v); } })];
        if (L.tint) rows.push(K.slider({ label: 'Tint Strength', sk: o.sk + ':tint_amount', value: L.tint_amount, min: 5, max: 80, step: 5, unit: '%',
                                         onChange: function (v) { put('tint_amount', v); } }));
        // back to what it follows, and back to the photo as taken
        var follow = o.follow || 'All Screens';
        if (o.own === true) rows.push(K.button({ label: 'Reset to ' + follow, sk: o.sk + ':reset', onClick: function () { o.onSet(null); } }));
        var asTaken = !L.blur && !L.dim && L.saturation === 100 && !L.tint;
        if (!asTaken) rows.push(K.button({ label: 'Reset to Default', sk: o.sk + ':default', onClick: function () {
          o.onSet({ blur: 0, dim: 0, saturation: 100, tint: '', tint_amount: 35 });
        } }));
        c.appendChild(this.withError(K.group({ header: 'Look', footer: (o.own === false ? 'Same as ' + follow + ' until you change it. ' : o.own ? 'Its own. ' : '') +
          'Reset to Default shows the photo as taken. Tint’s day colors show while the sun is up, its night ones after.' }, rows), o.sk));
      }
      async photoUpload(file, fk) {
        this._upl = { fk: fk, busy: true };
        this.render(true);
        try {
          var blob = await shrinkPhoto(file, 2560);
          var fd = new FormData();
          fd.append('file', blob, 'hk-background.jpg');
          var r = await this.actions().request('/api/image/upload', { method: 'POST', body: fd });
          if (!r.ok) throw new Error(r.status === 413 ? 'It’s too big.' : 'Home Assistant answered ' + r.status + '.');
          var j = await r.json();
          if (!j || !/^[0-9a-f]{32}$/.test(j.id || '')) throw new Error('Home Assistant didn’t say where it put it.');
          this._upl = null;
          return '/api/image/serve/' + j.id + '/original';
        } catch (e) {
          this._upl = { fk: fk, error: 'The photo couldn’t be uploaded. ' + ((e && e.message) || '') };
          this.render(true);
          return null;
        }
      }
      // a photo no longer used anywhere -- All Screens, a screen, a page --
      // leaves Home Assistant's image store (one HK uploaded: /api/image/serve)
      photoForget(url) {
        var m = /^\/api\/image\/serve\/([0-9a-f]{32})\/original$/.exec(url || '');
        if (!m) return;
        var d = this.data, used = [], sky = (d.settings || {}).sky || {};
        used.push(sky.photo);
        Object.keys(sky.page_photos || {}).forEach(function (k) { used.push(sky.page_photos[k]); });
        Object.keys(d.boards || {}).forEach(function (p) {
          var b = d.boards[p] || {};
          used.push(b.sky_photo);
          Object.keys(b.sky_page_photos || {}).forEach(function (k) { used.push(b.sky_page_photos[k]); });
        });
        if (used.indexOf(url) >= 0) return;
        this.actions().callWS({ type: 'image/delete', image_id: m[1] }).catch(function () { /* already gone */ });
      }
      // The picker reads choices from the server, just like dates and themes.
      // Loading the dashboard's settings module here would start its websocket
      // subscriptions merely to obtain a static palette table.
      backdropLabel(id) {
        var p = ((this.data.choices || {}).sky_backdrops || []).filter(function (p) { return p.id === (id || 'live'); })[0];
        return p ? p.label : 'Live Sky';
      }
      backdropRows(id, custom, pick, prefix) {
        return ((this.data.choices || {}).sky_backdrops || []).map(function (p) {
          var stops = p.day || (p.id === 'custom' && custom && custom.day);
          return K.check({ label: p.label, on: p.id === id, fk: prefix + p.id,
            tile: [p.id === 'live' ? 'mdi:weather-sunset' : 'mdi:palette',
                   stops ? 'linear-gradient(180deg, ' + stops.join(',') + ')' : C.purple],
            onClick: function () { pick(p.id); } });
        });
      }
      // Two sets of four native color controls. Keep edits during panel redraws
      // (a save's answer or the settings feed can redraw while the OS color
      // picker is open). Commit a snapshot on change; never hand setH/setB a
      // mutable draft.
      customBackdrop(c, stored, scope, save) {
        var fallback = ((this.data.choices || {}).sky_backdrops || []).filter(function (p) { return p.id === 'dusk'; })[0];
        if (!fallback) return;
        var source = stored || { day: fallback.day, night: fallback.night };
        var signature = JSON.stringify(source);
        this._skyDrafts = this._skyDrafts || {};
        var cache = this._skyDrafts[scope];
        if (!cache || cache.signature !== signature) {
          cache = this._skyDrafts[scope] = { signature: signature, stops: JSON.parse(signature) };
        }
        var rows = ['day', 'night'].map(function (key) {
          var label = key === 'day' ? 'Day' : 'Night';
          var colors = cache.stops[key].map(function (v, i) {
            var input = h('input', { type: 'color', 'aria-label': label + ' stop ' + (i + 1),
              'data-fk': scope + ':' + key + ':' + i });
            input.value = v;
            input.addEventListener('input', function () { cache.stops[key][i] = input.value; });
            input.addEventListener('change', function () {
              cache.stops[key][i] = input.value;
              save(JSON.parse(JSON.stringify(cache.stops)));
            });
            return input;
          });
          return h('div', { class: 'cell', 'data-sk': scope + ':' + key }, [K.label(label), h('div', { class: 'skycolors' }, colors)]);
        });
        c.appendChild(this.withError(K.group({ header: 'Custom Stops', footer: 'Four colors from the top of the sky to the horizon. Day when the sun is above the horizon; Night otherwise.' }, rows), scope.indexOf('b:') === 0 ? 'b:sky_custom' : scope));
      }
      // WOODLAND BETWEEN OCCASIONS: New Decorations' seasonal woodland on the
      // days with no holiday or birthday, season by season -- its own choice
      // (2026-10-04; summer's had been the Fourth of July's Show, autumn's
      // Thanksgiving's)
      h_woodland(c) {
        var self = this, on = this.data.settings.sky.woodland || [];
        // each season its own page: whether it shows, and its Liveliness
        c.appendChild(K.group({ footer: 'With New Decorations, the season\u2019s woodland shows on days with no holiday or ' +
            'birthday. A holiday\u2019s own Show still decides the holiday.' }, M.WOODLAND.map(function (w) {
          return K.nav({ label: w[1], value: on.indexOf(w[0]) >= 0 ? self.livelyValue(w[0]) : 'Off',
                         href: '#/house/appearance/sky/woodland/' + w[0], sk: 'sky.woodland:' + w[0] });
        })));
      }
      // A WOODLAND SEASON'S OWN PAGE: shown or not between occasions, and how
      // lively it is
      h_season(c, w) {
        var self = this, on = this.data.settings.sky.woodland || [], yes = on.indexOf(w[0]) >= 0;
        c.appendChild(K.group({ footer: 'New Decorations, on days with no holiday or birthday.' }, [
          K.toggle({ label: 'Show ' + w[1] + ' Woodland', sk: 'sky.woodland:' + w[0], on: yes, onChange: function (v) {
            self.setH({ 'sky.woodland': M.WOODLAND.map(function (x) { return x[0]; })
              .filter(function (x) { return x === w[0] ? v : on.indexOf(x) >= 0; }) });
          } })]));
        if (yes) this.livelyGroup(c, w[0]);
      }
      // THE NIGHT SKY (the forecast screensaver's): its twinkling stars and
      // shooting stars, every clear night of the year
      h_nightSky(c) {
        this.livelyGroup(c, 'night', 'The forecast screensaver\u2019s stars, every clear night.');
      }
      // An occasion's, a season's or the night's value on its row: On (Classic)
      // or its preset
      livelyValue(occ) {
        var sky = this.data.settings.sky || {};
        if ((sky.liveliness_all || 'classic') !== 'custom') return 'On';
        return 'On \u00b7 ' + M.livelyPresetLabel((sky.liveliness || {})[occ] || 'classic');
      }
      // the decoration styles in use: All Screens' and any screen's own
      livelyStyles() {
        var sky = this.data.settings.sky || {}, boards = this.data.boards || {}, out = {};
        out[sky.decoration_style || 'old'] = true;
        Object.keys(boards).forEach(function (p) { var st = boards[p] && boards[p].sky_decoration_style; if (st) out[st] = true; });
        return out;
      }
      // whether anything moves on any screen (Animations, All Screens' or a
      // screen's own)
      livelyMoves() {
        var sky = this.data.settings.sky || {}, boards = this.data.boards || {};
        return sky.animations !== false || Object.keys(boards).some(function (p) { return boards[p] && boards[p].sky_animations === true; });
      }
      // EVERY OCCASION THAT HAS LIVELINESS (settings.py LIVELY_OCCASIONS), in
      // its order: the holidays and occasions, the woodland seasons, the night
      livelyOccs() {
        var t = ((this.data.choices || {}).sky_lively || {}).occasions || {};
        return Object.keys(t);
      }
      // EACH OCCASION, All Screens' (lvl null) or a screen's ({b, path, base}):
      // its preset, each a way to its Liveliness
      livelyList(c, lvl) {
        var self = this, sky = this.data.settings.sky || {}, styles = this.livelyStyles();
        var lv = lvl ? (lvl.b.sky_liveliness_occ || {}) : (sky.liveliness || {});
        var table = (this.data.choices || {}).sky_lively;
        var rows = this.livelyOccs().filter(function (id) { return M.livelyKnobs(table, id, styles).length; }).map(function (id) {
          var href = lvl ? lvl.base + '/sky/lively/' + encodeURIComponent(id)
            : id === 'night' ? '#/house/appearance/sky/night'
            : M.WOODLAND.some(function (w) { return w[0] === id; }) ? '#/house/appearance/sky/woodland/' + id : '#/house/appearance/sky/' + id;
          return K.nav({ label: M.livelyOccLabel(id), value: M.livelyPresetLabel(lv[id] || 'classic'), href: href, fk: 'lively-occ:' + id });
        });
        c.appendChild(K.group({ footer: 'Each holiday, occasion, woodland season and the Night Sky: a preset, or Custom with each effect your own way.' +
            (lvl ? ' Just this screen.' : ' For every screen whose Liveliness is Same as All Screens.') }, rows));
      }
      // LIVELINESS (hk-sky.js lvOf) of one occasion, All Screens' (lvl null)
      // or a screen's ({b, path}): a preset, or Custom and each of the
      // occasion's knobs -- a slider for a count or a crossing, a switch for one
      // that is only on or off. Only the knobs a decoration style in use draws;
      // nothing at all while nothing moves. All Screens': only while its
      // Liveliness is Custom (else a way to it).
      livelyGroup(c, occ, foot, lvl) {
        var self = this, sky = this.data.settings.sky || {};
        var lv = lvl ? (lvl.b.sky_liveliness_occ || {}) : (sky.liveliness || {});
        var cust = lvl ? (lvl.b.sky_liveliness_custom || {}) : (sky.liveliness_custom || {});
        var cur = lv[occ] || 'classic';
        var knobs = M.livelyKnobs((this.data.choices || {}).sky_lively, occ, this.livelyStyles());
        if (!knobs.length) return;
        if (!this.livelyMoves()) {
          c.appendChild(K.group({ header: 'Liveliness', footer: 'Animations are off, so nothing moves. Turn Animations on under Background.' }, []));
          return;
        }
        if (!lvl && (sky.liveliness_all || 'classic') !== 'custom') {
          c.appendChild(K.group({ header: 'Liveliness', footer: 'The same for every occasion. Choose Custom for Liveliness on Background to set each its own.' }, [
            K.nav({ label: 'Liveliness', value: M.livelyPresetLabel(sky.liveliness_all || 'classic'), href: '#/house/appearance/sky', sk: 'sky.liveliness_all' })]));
          return;
        }
        var put = function (occMap, custMap) {
          if (lvl) {
            var o = {};
            if (occMap) o.sky_liveliness_occ = occMap;
            if (custMap) o.sky_liveliness_custom = custMap;
            return self.setB(lvl.path, o);
          }
          var h = {};
          if (occMap) h['sky.liveliness'] = occMap;
          if (custMap) h['sky.liveliness_custom'] = custMap;
          return self.setH(h);
        };
        var pick = function (p) {
          var all = Object.assign({}, lv), c2 = null;
          all[occ] = p;
          // Custom starts from the preset it was on, the first time
          if (p === 'custom' && !cust[occ]) {
            c2 = Object.assign({}, cust);
            c2[occ] = M.livelyFrom(cur === 'custom' ? 'classic' : cur, knobs);
          }
          put(all, c2);
        };
        var skp = lvl ? 'b:sky_liveliness_occ:' : 'lively:';
        c.appendChild(K.group({ header: 'Liveliness', footer: foot || 'How many of the little moving things, and how often the ones that cross come by.' },
          M.LIVELY_PRESETS.map(function (p) {
            return K.check({ label: p[1], sub: p[2], on: cur === p[0], fk: skp + occ + ':' + p[0], onClick: function () { pick(p[0]); } });
          })));
        if (cur !== 'custom') return;
        var mine = cust[occ] || M.livelyFrom('classic', knobs);
        var save = function (k, v) {
          var c2 = Object.assign({}, cust), o = Object.assign({}, mine);
          o[k] = v; c2[occ] = o;
          put(null, c2);
        };
        c.appendChild(K.group({ header: 'Custom', footer: 'Normal is as it has always been.' }, knobs.map(function (k) {
          var v = mine[k[0]] === undefined ? 2 : mine[k[0]];
          var sk = (lvl ? 'b:sky_liveliness_custom:' : 'sky.liveliness_custom:') + occ + ':' + k[0];
          if (k[2] === 'show') return K.toggle({ label: k[1], sk: sk, on: v > 0, onChange: function (x) { save(k[0], x ? 2 : 0); } });
          return K.slider({ label: k[1], sub: k[2] === 'often' ? 'How often' : 'How many', sk: sk, value: v, min: 0, max: 4, step: 1,
                            labels: k[2] === 'often' ? M.LIVELY_OFTEN : M.LIVELY_STEPS, onChange: function (x) { save(k[0], x); } });
        })));
      }
      h_backdrop(c) {
        var self = this, sky = this.data.settings.sky;
        var pick = function (id) {
          var changes = { 'sky.gradient': id };
          // Selecting Custom starts with a real palette immediately. Otherwise
          // its checked row would say Custom while the renderer fell back to live.
          if (id === 'custom' && !sky.gradient_custom) {
            var dusk = self.data.choices.sky_backdrops.filter(function (p) { return p.id === 'dusk'; })[0];
            changes['sky.gradient_custom'] = { day: dusk.day.slice(), night: dusk.night.slice() };
          }
          self.setH(changes);
        };
        c.appendChild(K.group({ header: 'The Sky', footer: 'The live sky’s colors on Home, the room pages, Weather and Calendar. Its weather, decorations and animations still show over it. Each screen can choose its own.' },
          this.backdropRows(sky.gradient || 'live', sky.gradient_custom, pick, 'hbackdrop:')));
        if (sky.gradient === 'custom') this.customBackdrop(c, sky.gradient_custom, 'sky.gradient_custom', function (v) {
          self.setH({ 'sky.gradient_custom': v });
        });
      }
      // A SCREEN'S PAGES, for their backgrounds: a page screen's own pages;
      // a whole screen's every page (and its custom pages)
      skyPageKeys(b) {
        var d = this.data, custom = {};
        (d.custom_pages || []).forEach(function (p) { custom[p.path] = p.title; });
        var only = b ? this.onlyOf(b) : null;
        var energyOn = this.energyOn(), powerOn = this.powerOn();
        if (energyOn) delete custom.energy;
        var keys;
        if (only && only.keys.length) keys = only.keys.slice();
        else {
          var dwOff = this.dwInSecurity(b);
          keys = (d.page_kinds || []).filter(function (k) { return (k !== 'energy' || energyOn) && (k !== 'power' || powerOn) && (k !== 'doors_windows' || !dwOff); });
          Object.keys(custom).forEach(function (k) {
            if (!b || (b.custom_pages || []).indexOf(k) >= 0 || (b.only_pages || []).indexOf(k) >= 0) keys.push(k);
          });
        }
        return { rows: M.skyPageRows(keys, custom), only: only };
      }
      // a page's background as it stands: this screen's, else All Screens',
      // else Automatic -- with where it comes from
      skyPageNow(row, b) {
        var all = this.data.settings.sky.pages || {}, mine = b ? b.sky_pages && b.sky_pages[row.key] : all[row.key];
        var mode = mine || all[row.key] || null;
        if (row.room) return { mode: mode, own: !!mine, live: mode === 'live' };
        // the sky's own settings (weather, decorations ...) reach a page only
        // while it shows the live sky: a color, its own or a backdrop, is still
        return { mode: mode, own: !!mine, live: mode ? mode === 'live' : !row.own && !row.custom };
      }
    };
    KIT.install(Methods);
  };
})();
