// hk-settings-house-sky.js - All Screens: the Sky page, backgrounds, Flat colors, Theme, Birthdays, Menu.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-house-sky'] = function (KIT) {
    var AUTO_ACCENT_TILE = KIT.AUTO_ACCENT_TILE, C = KIT.C, FLAT_OWN = KIT.FLAT_OWN, FLAT_VIEW = KIT.FLAT_VIEW,
        PN = KIT.PN;

    var h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      s_sky(c, x, b) {
        var self = this, sky = this.data.settings.sky, rows = [];
        if (this.flatHere(b)) { this.flatSky(c, x, b, '#/screens/' + encodeURIComponent(x.path) + '/sky'); return; }
        // WHAT THESE SETTINGS REACH: the live sky only -- Home, the room pages
        // and any page set to Live Sky or a backdrop. A page screen whose pages
        // keep their own color shows none of it; say so, and the way to change it.
        var pk = this.skyPageKeys(b), base = '#/screens/' + encodeURIComponent(x.path);
        var bds = (this.data.choices || {}).sky_backdrops || [];
        // THE BACKGROUND FIRST (2026-10-13; was the Live Sky switch): Same as
        // All Screens, or this screen's own Live Sky, Color or Photo. A screen
        // whose Live Sky was turned off (b.sky false) reads as Color: Black --
        // what it showed -- and any choice here turns it back on.
        var skySw = (this.data.settings.look || {}).sky_switch;
        var pageScreen = !!(pk.only && pk.only.keys.length), legacyOff = b.sky === false;
        if (!pageScreen) {
          var ownMode = legacyOff ? 'color' : b.sky_background, hMode = sky.background || 'live', mode = ownMode || hMode;
          var bgRows = [K.previewPick({ label: 'Background', sub: ownMode ? 'Just This Screen' : 'Same as All Screens', sk: 'b:sky_background', value: mode,
            options: M.SKY_BACKGROUNDS, picture: function (v, w, ht) { return self.bgKindThumb(v, w, ht, b.sky_wallpaper || sky.wallpaper, null, b.sky_wallpaper_color || sky.wallpaper_color); }, onChange: function (v) {
              var ch = { sky_background: v, sky: true };
              if (legacyOff && v === 'color' && !b.sky_color) ch.sky_color = 'black';
              self.setB(x.path, ch);
            } })];
          if (ownMode) bgRows.push(K.button({ label: 'Reset to All Screens (' + M.BG_LABELS[hMode] + ')', sk: 'b:sky_background:reset',
            onClick: function () { self.setB(x.path, { sky_background: null, sky: true }); } }));
          var foot = [M.BG_SAYS[mode]];
          if (legacyOff) foot.push('This screen’s Live Sky was turned off, so it shows Black.');
          if (mode === 'live' && x.generated && skySw) foot.push('It also follows ' + this.name(skySw) + ' (All Screens → Appearance → Background → Sky Switch).');
          if (!x.generated) foot.push('A screen written in YAML shows it wherever its YAML puts the sky.');
          c.appendChild(K.group({ footer: foot.join(' ') }, bgRows));
          if (mode === 'color') {
            this.colorGroup(c, { id: legacyOff ? (b.sky_color || 'black') : (b.sky_color || null), follow: ['Same as All Screens', sky.color || 'midnight'],
              custom: b.sky_custom || sky.gradient_custom, fk: 'bcolor:', scope: 'b:sky_custom:' + x.path,
              onPick: function (id) {
                var ch = { sky_color: id, sky: true };
                if (legacyOff) ch.sky_background = 'color';
                if (id === 'custom' && !b.sky_custom) ch.sky_custom = sky.gradient_custom || self.dusk();
                self.setB(x.path, ch);
              },
              onCustom: function (v) { self.setB(x.path, { sky_custom: v }); } });
            this.skyPagesGroup(c, x, b);
            this.skyResetGroup(c, x, b);
            return;
          }
          if (mode === 'photo') {
            this.photoGroup(c, { url: b.sky_photo || null, from: sky.photo || null, fromLabel: 'All Screens’ photo', fk: 'bphoto', sk: 'b:sky_photo',
              footer: 'Shown on Home, the room pages, and every page without a color of its own.',
              onSet: function (url) { var was = b.sky_photo; self.setB(x.path, { sky_photo: url, sky: true }).then(function (ok) { if (ok) self.photoForget(was); }); } });
            this.photoLookGroup(c, { look: b.sky_photo_look || sky.photo_look, own: !!b.sky_photo_look, sk: 'b:sky_photo_look', follow: 'All Screens',
              onSet: function (v) { self.setB(x.path, { sky_photo_look: v }); } });
            this.flatImageGroup(c, x, b, null, true);
            this.skyPagesGroup(c, x, b);
            this.skyResetGroup(c, x, b);
            return;
          }
          if (mode === 'landscapes') {
            this.landscapeGroup(c, { value: b.sky_landscape || null, house: sky.landscape || 'every:1440', fk: 'bland', sk: 'b:sky_landscape',
              href: base + '/sky/landscape', footer: 'Shown on Home, the room pages, and every page without a color of its own.',
              onSet: function (v) { self.setB(x.path, { sky_landscape: v, sky: true }); } });
            this.photoLookGroup(c, { look: b.sky_landscape_look || sky.landscape_look, own: !!b.sky_landscape_look, sk: 'b:sky_landscape_look', follow: 'All Screens',
              onSet: function (v) { self.setB(x.path, { sky_landscape_look: v }); } });
            this.flatImageGroup(c, x, b, null, true);
            this.skyPagesGroup(c, x, b);
            this.skyResetGroup(c, x, b);
            return;
          }
          if (mode === 'wallpaper') {
            this.wallpaperGroup(c, { value: b.sky_wallpaper || null, house: sky.wallpaper || 'ribbons', night: b.sky_wallpaper_night || null,
              nightHouse: sky.wallpaper_night || 'auto', fk: 'bwall', sk: 'b:sky_wallpaper',
              motion: b.sky_wallpaper_motion || null, motionHouse: sky.wallpaper_motion || 'off',
              onMotion: function (v) { self.setB(x.path, { sky_wallpaper_motion: v }); },
              color: b.sky_wallpaper_color || null, colorHouse: sky.wallpaper_color || 'blue',
              onColor: function (v) { self.setB(x.path, { sky_wallpaper_color: v }); },
              footer: 'Shown on Home, the room pages, and every page without a color of its own.',
              onSet: function (v, motion) { var ch = { sky_wallpaper: v, sky: true }; if (motion) ch.sky_wallpaper_motion = motion; self.setB(x.path, ch); },
              onNight: function (v) { self.setB(x.path, { sky_wallpaper_night: v }); } });
            this.skyPagesGroup(c, x, b);
            this.skyResetGroup(c, x, b);
            return;
          }
        }
        if (pageScreen) {
          var now = pk.rows.map(function (r) { return { r: r, n: self.skyPageNow(r, b) }; });
          var liveOnes = now.filter(function (o) { return o.n.live; });
          c.appendChild(K.group({ header: 'This Screen’s Pages', footer: liveOnes.length
              ? 'The Live Sky settings below reach ' + liveOnes.map(function (o) { return o.r.label; }).join(' and ') + '. ' +
                (liveOnes.length < now.length ? 'The rest keep their own background.' : '')
              : 'This screen has no Home page. Each page’s background — its own color, a Color, a Photo or the Live Sky — is chosen here.' },
            now.map(function (o) {
              return K.nav({ label: o.r.label + ' Background', value: o.n.mode ? M.skyModeLabel(o.n.mode, bds) : M.skyAutoLabel(o.r),
                             href: base + '/sky/page/' + encodeURIComponent(o.r.key), sk: 'b:sky_pages:' + o.r.key });
            })));
          // nothing here shows the live sky: none of its settings to show
          if (!liveOnes.length) { this.skyResetGroup(c, x, b); return; }
        }
        // Pause When Not in Focus only while anything moves here, Rain & Snow
        // only while there is weather (2026-10-10), as on All Screens' page
        var moving = b.sky_animations != null ? b.sky_animations : sky.animations !== false;
        var weathery = b.sky_weather != null ? b.sky_weather : sky.weather !== false;
        [['animations', 'Animations'], ['focus_pause', 'Pause When Not in Focus', moving],
         ['weather', 'Weather'], ['precipitation', 'Rain & Snow', weathery],
         ['decorations', 'Seasonal Decorations']].forEach(function (entry) {
          if (entry.length > 2 && !entry[2]) return;
          var key = 'sky_' + entry[0], own = b[key] != null, house = sky[entry[0]] !== false;
          rows.push(K.toggle({ label: entry[1], sk: 'b:' + key, on: own ? b[key] : house,
            sub: own ? 'Just This Screen' : 'Same as All Screens', onChange: function (v) { var o = {}; o[key] = v; self.setB(x.path, o); } }));
          if (own) rows.push(K.button({ label: 'Reset to All Screens (' + (house ? 'On' : 'Off') + ')', sk: 'b:' + key + ':reset',
            onClick: function () { var o = {}; o[key] = null; self.setB(x.path, o); } }));
        });
        // LIVELINESS, this screen's own (2026-10-09), as All Screens' is: one
        // preset for every occasion, or Custom -- each occasion its own (Each
        // Occasion). Only while anything moves here.
        var moves = b.sky_animations != null ? b.sky_animations : sky.animations !== false;
        if (moves) {
          var hAll = sky.liveliness_all || 'classic';
          rows.push(K.select({ label: 'Liveliness', sub: b.sky_liveliness ? 'Just This Screen' : 'Same as All Screens', sk: 'b:sky_liveliness',
            value: b.sky_liveliness || '',
            options: [['', 'Same as All Screens (' + M.livelyPresetLabel(hAll) + ')', M.livelyPresetLabel(hAll)]].concat(M.LIVELY_ALL),
            onChange: function (v) {
              var ch = { sky_liveliness: v || null };
              // Custom starts as the screen is now: All Screens' own occasions,
              // or the one preset on each
              if (v === 'custom' && !Object.keys(b.sky_liveliness_occ || {}).length) {
                var src = b.sky_liveliness && b.sky_liveliness !== 'custom' ? b.sky_liveliness : hAll;
                if (src === 'custom') {
                  ch.sky_liveliness_occ = Object.assign({}, sky.liveliness || {});
                  ch.sky_liveliness_custom = JSON.parse(JSON.stringify(sky.liveliness_custom || {}));
                } else {
                  ch.sky_liveliness_occ = {};
                  self.livelyOccs().forEach(function (id) { ch.sky_liveliness_occ[id] = src; });
                }
              }
              self.setB(x.path, ch);
            } }));
          if (b.sky_liveliness === 'custom') {
            rows.push(K.nav({ label: 'Each Occasion', sub: 'Every holiday, occasion, season and the Night Sky', sk: 'b:sky_liveliness_occ',
                              href: base + '/sky/lively', value: 'Custom' }));
          }
          // only where the screen's room can tell it is empty
          if (b.idle_room && M.roomSensors(this.client, b.idle_room).length) {
            rows.push(K.toggle({ label: 'Calm When Nobody\u2019s Around', sub: 'Half as much moving while ' + this.areaName(b.idle_room) +
                ' has been empty for 5 minutes', sk: 'b:sky_calm_empty', on: !!b.sky_calm_empty,
              onChange: function (v) { self.setB(x.path, { sky_calm_empty: v }); } }));
          }
        }
        // THE SKY'S LOOK, each as All Screens' tabs (2026-10-09): the shared
        // value until changed, then this screen's own and a way back
        var wideS = this.hasAttribute('wide');
        var segOwn = function (label, key, opts, houseVal) {
          var own = b[key] != null && b[key] !== '';
          rows.push(K.seg({ label: label, sub: own ? 'Just This Screen' : 'Same as All Screens', sk: 'b:' + key, stack: !wideS,
            value: own ? b[key] : houseVal, options: opts,
            onChange: function (v) { var o = {}; o[key] = v; self.setB(x.path, o); } }));
          if (own) rows.push(K.button({ label: 'Reset to All Screens (' + M.choiceLabel(opts, houseVal) + ')', sk: 'b:' + key + ':reset',
            onClick: function () { var o = {}; o[key] = null; self.setB(x.path, o); } }));
        };
        segOwn('Decoration Style', 'sky_decoration_style', [['old', 'Old Decorations'], ['new', 'New Decorations']], sky.decoration_style || 'old');
        segOwn('Moving Things', 'sky_moving', M.SKY_MOVING, sky.moving || 'behind');
        segOwn('Clouds', 'sky_cloud_style', M.CLOUD_STYLES, sky.cloud_style || 'classic');
        segOwn('Daytime Sky', 'sky_daytime', M.DAYTIME_SKIES, sky.daytime || 'natural');
        // a page screen's backdrop is its pages' (above): no second one here
        if (!(pk.only && pk.only.keys.length)) {
          rows.push(K.nav({ label: 'Sky Colors', sk: 'b:sky_gradient', href: '#/screens/' + encodeURIComponent(x.path) + '/sky/backdrop',
            sub: b.sky_gradient == null ? 'Same as All Screens' : 'Just This Screen',
            value: this.backdropLabel(b.sky_gradient == null ? sky.gradient : b.sky_gradient) }));
        }
        c.appendChild(K.group({ footer: 'Animations off also stops a running fan’s icon spinning, and hides falling rain and snow. ' +
            'Pause When Not in Focus: on a computer, everything holds still while another window is in front. ' +
            'Weather off leaves the sun, moon and stars; Rain & Snow off keeps the clouds and fog. Decorations use the dates and themes for All Screens. ' +
            'Liveliness: how many little things move, and how often — the same for every occasion, or Custom for each its own.' }, rows));
        // a whole screen's pages, under its sky (a page screen lists its own
        // at the top)
        if (!(pk.only && pk.only.keys.length)) this.skyPagesGroup(c, x, b);
      }
      s_backdrop(c, x, b) {
        var self = this, sky = this.data.settings.sky;
        var back = '#/screens/' + encodeURIComponent(x.path) + '/sky';
        // A PAGE SCREEN: its backdrop is its pages' -- each one's, here, and
        // nothing else (it has no Home or room page for a general backdrop)
        var pk = this.skyPageKeys(b);
        if (pk.only && pk.only.keys.length) { this.pageBackdrops(c, x, b, pk); return; }
        c.appendChild(K.group({ footer: 'Follows the backdrop and custom colors for All Screens as they change.' }, [
          K.check({ label: 'Same as All Screens', sub: 'Now ' + this.backdropLabel(sky.gradient), on: b.sky_gradient == null,
            fk: 'bbackdrop:house', onClick: function () { self.setB(x.path, M.backdropFollow(b)); self.back(back); } })]));
        var pick = function (id) {
          var changes = { sky_gradient: id };
          if (id === 'custom' && !b.sky_custom) {
            var dusk = self.data.choices.sky_backdrops.filter(function (p) { return p.id === 'dusk'; })[0];
            var start = sky.gradient_custom || dusk;
            changes.sky_custom = { day: start.day.slice(), night: start.night.slice() };
          }
          self.setB(x.path, changes);
          if (id !== 'custom') self.back(back);
        };
        c.appendChild(K.group({ header: 'The Sky — Just This Screen', footer: 'The live sky’s colors on Home, the room pages, Weather and Calendar, with its weather and decorations over it.' },
          this.backdropRows(b.sky_gradient, b.sky_custom || sky.gradient_custom, pick, 'bbackdrop:')));
        // A following screen has no selected own row, including Live.
        if (b.sky_gradient === 'custom') this.customBackdrop(c, b.sky_custom || sky.gradient_custom, 'b:sky_custom:' + x.path, function (v) {
          self.setB(x.path, { sky_custom: v });
        });
      }
      // A PAGE SCREEN'S BACKDROP: for each of its pages, Same as All Screens,
      // its own Page Color, the live sky or a fixed backdrop -- one list, the
      // page's name over it
      pageBackdrops(c, x, b, pk) {
        var self = this;
        pk.rows.forEach(function (r) { self.pagePicker(c, x, b, r, pk.rows.length === 1); });
        this.skyResetGroup(c, x, b);
      }
      // ONE PAGE'S BACKGROUND (2026-10-13: the Background's choices, page by
      // page): Automatic (All Screens) or Same as All Screens (a screen), its
      // own Page Color, the Live Sky, a still Color or a Photo -- for All
      // Screens (x, b null) or one screen. Stored as before ({page: 'own' |
      // 'live' | a color id | 'photo'}); a page's own photo in page_photos.
      // `alone`: the screen's only page (its background is the screen's).
      pagePicker(c, x, b, r, alone) {
        var self = this, sky = this.data.settings.sky, all = sky.pages || {};
        var bds = (this.data.choices || {}).sky_backdrops || [];
        var mine = b ? (b.sky_pages || {}) : all;
        var photos = b ? (b.sky_page_photos || {}) : (sky.page_photos || {});
        var custom = b ? (b.sky_custom || sky.gradient_custom) : sky.gradient_custom;
        var cur = mine[r.key] || '';
        var isColor = cur && cur !== 'own' && cur !== 'live' && cur !== 'photo' && cur !== 'landscapes' && cur !== 'wallpaper';
        var put = function (ch) {
          if (b) { ch.sky = true; return self.setB(x.path, ch); }
          var hc = {};
          Object.keys(ch).forEach(function (k) { hc['sky.' + { sky_pages: 'pages', sky_page_photos: 'page_photos', sky_page_looks: 'page_looks', sky_custom: 'gradient_custom' }[k]] = ch[k]; });
          return self.setH(hc);
        };
        var pick = function (id) {
          var next = Object.assign({}, mine);
          if (id) next[r.key] = id; else delete next[r.key];
          var ch = { sky_pages: next };
          if (id === 'custom' && !(b ? b.sky_custom : sky.gradient_custom)) ch.sky_custom = sky.gradient_custom || self.dusk();
          put(ch);
        };
        // the color a page set to Color starts with: the screen's, else All Screens'
        var startColor = (b && b.sky_color) || sky.color || 'midnight';
        // a room's page follows Room Pages (All Screens' choice for the room
        // first, on a screen)
        var roomsNow = (b && (b.sky_pages || {}).rooms) || all.rooms;
        var first = b && all[r.key] ? ['Same as All Screens', 'Now ' + M.skyModeLabel(all[r.key], bds)]
                  : r.room ? ['Same as Room Pages', 'Now ' + (roomsNow ? M.skyModeLabel(roomsNow, bds) : 'the screen’s Background')]
                  : ['Automatic', r.own ? 'Its own color' : r.custom ? 'As written' : 'The screen’s Background'];
        var rows = [K.check({ label: first[0], sub: first[1], on: !cur, fk: 'pbd:' + r.key + ':auto', onClick: function () { pick(''); } })];
        if (r.own) rows.push(K.check({ label: 'Page Color', sub: 'The page’s own color', on: cur === 'own', fk: 'pbd:' + r.key + ':own',
                                       tile: ['mdi:palette-swatch', C.green], onClick: function () { pick('own'); } }));
        rows.push(K.check({ label: 'Live Sky', sub: 'The moving sky, with ' + (b ? 'this screen’s' : 'All Screens’') + ' weather and decorations', on: cur === 'live',
                            fk: 'pbd:' + r.key + ':live', tile: ['mdi:weather-sunset', C.blue], onClick: function () { pick('live'); } }));
        rows.push(K.check({ label: 'Color', sub: isColor ? M.skyModeLabel(cur, bds) : 'A still color', on: isColor, fk: 'pbd:' + r.key + ':color',
                            tile: ['mdi:palette', C.purple], onClick: function () { if (!isColor) pick(startColor); } }));
        rows.push(K.check({ label: 'Photo', sub: photos[r.key] ? 'Its own photo' : 'A photo, still', on: cur === 'photo', fk: 'pbd:' + r.key + ':photo',
                            tile: ['mdi:image', C.orange], onClick: function () { pick('photo'); } }));
        rows.push(K.check({ label: 'Landscapes', sub: PN() + '’s own photos, as ' + (b ? 'the screen' : 'All Screens') + ' has them', on: cur === 'landscapes',
                            fk: 'pbd:' + r.key + ':landscapes', tile: ['mdi:image-filter-hdr', C.teal], onClick: function () { pick('landscapes'); } }));
        // (2026-10-30) the screen's Wallpaper
        var wn = window.hkWallpapers, wid = (b && b.sky_wallpaper) || sky.wallpaper || 'ribbons', wcol = (b && b.sky_wallpaper_color) || sky.wallpaper_color;
        rows.push(K.check({ label: 'Wallpaper', sub: 'Our own art, as ' + (b ? 'the screen' : 'All Screens') + ' has it', on: cur === 'wallpaper',
                            fk: 'pbd:' + r.key + ':wallpaper', tile: ['mdi:wallpaper', wn ? 'center / cover url("' + wn.url(wid, false, wcol) + '")' : C.purple],
                            onClick: function () { pick('wallpaper'); } }));
        c.appendChild(K.group({ header: alone === false ? r.label : null, footer: (alone ? r.label + ' is this screen’s only page, so its background is the screen’s. ' : '') +
          'Page Color, Color, Photo, Landscapes and Wallpaper are still: no sun, moon, stars, weather or decorations.' }, rows));
        if (isColor) {
          this.colorGroup(c, { id: cur, custom: custom, fk: 'pbd:' + r.key + ':',
            onPick: function (id) { pick(id); },
            onCustom: function (v) { put({ sky_custom: v }); }, scope: b ? 'b:sky_custom:' + x.path : 'sky.gradient_custom' });
        }
        if (cur === 'photo') {
          var lvl = (r.room && photos.rooms) || (b ? (b.sky_photo || sky.photo) : sky.photo);
          this.photoGroup(c, { url: photos[r.key] || null, from: lvl || null,
            fromLabel: r.room && photos.rooms ? 'Room Pages’ photo' : b ? 'the screen’s photo' : 'All Screens’ photo',
            fk: 'pphoto:' + r.key, sk: b ? 'b:sky_page_photos' : 'sky.page_photos', header: 'Its Photo',
            footer: 'Without a photo of its own, the page shows ' + (r.room ? 'Room Pages’ photo, else ' : '') + (b ? 'the screen’s' : 'All Screens’') + ' Background photo.',
            onSet: function (url) {
              var was = photos[r.key], next = Object.assign({}, photos);
              if (url) next[r.key] = url; else delete next[r.key];
              put({ sky_page_photos: next }).then(function (ok) { if (ok) self.photoForget(was); });
            } });
          // ITS LOOK (2026-10-13): its own, else (a room) Room Pages', else the
          // screen's -- each a page apart, a photo of the room its own blur
          var looks = b ? (b.sky_page_looks || {}) : (sky.page_looks || {});
          var lvlLook = b ? (b.sky_photo_look || sky.photo_look) : sky.photo_look;
          var inLook = (r.room && looks.rooms) || lvlLook;
          this.photoLookGroup(c, { look: looks[r.key] || inLook, own: !!looks[r.key], sk: (b ? 'b:sky_page_looks:' : 'sky.page_looks:') + r.key,
            follow: r.room && looks.rooms ? 'Room Pages’ Look' : b ? 'the Screen’s Look' : 'All Screens’ Look',
            onSet: function (v) {
              var next = Object.assign({}, looks);
              if (v) next[r.key] = v; else delete next[r.key];
              put({ sky_page_looks: next });
            } });
        }
        // LANDSCAPES on a page: the screen's landscape (which one is the
        // Background's choice), with a Look of its own -- else the screen's
        // landscape look
        if (cur === 'landscapes') {
          var llooks = b ? (b.sky_page_looks || {}) : (sky.page_looks || {});
          var landLook = b ? (b.sky_landscape_look || sky.landscape_look) : sky.landscape_look;
          this.photoLookGroup(c, { look: llooks[r.key] || (r.room && llooks.rooms) || landLook, own: !!llooks[r.key],
            sk: (b ? 'b:sky_page_looks:' : 'sky.page_looks:') + r.key,
            follow: r.room && llooks.rooms ? 'Room Pages’ Look' : b ? 'the Screen’s Look' : 'All Screens’ Look',
            onSet: function (v) {
              var next = Object.assign({}, llooks);
              if (v) next[r.key] = v; else delete next[r.key];
              put({ sky_page_looks: next });
            } });
        }
        // ROOM PAGES: each room's own, a tap away (also in its Room Settings)
        if (r.key === 'rooms') {
          var base = b ? '#/screens/' + encodeURIComponent(x.path) + '/sky/page/' : '#/house/appearance/sky/page/';
          var rrows = this.areasAZ().map(function (aid) {
            var k = self.roomKey(aid);
            if (!k) return null;
            var n = self.skyPageNow({ key: k, room: true }, b);
            return K.nav({ label: self.areaName(aid), icon: ((self.client.areas || {})[aid] || {}).icon || 'mdi:texture-box',
                           value: n.own ? M.skyModeLabel(n.mode, bds) : 'Same as Room Pages', href: base + encodeURIComponent(k), sk: (b ? 'b:sky_pages:' : 'sky.pages:') + k });
          }).filter(Boolean);
          if (rrows.length) c.appendChild(K.group({ header: 'Each Room', footer: 'A room left alone is the same as Room Pages. A photo of the room itself, say, behind its page.' }, rrows));
        }
      }
      // THE PAGES, under Sky / Background: each page and its background, a
      // tap away -- where people look for it, not inside the sky's Backdrop
      skyPagesGroup(c, x, b, header) {
        var self = this, bds = (this.data.choices || {}).sky_backdrops || [];
        var pk = this.skyPageKeys(b);
        var base = b ? '#/screens/' + encodeURIComponent(x.path) + '/sky/page/' : '#/house/appearance/sky/page/';
        // ALL SCREENS': a page under Pages has its background there (its Look),
        // since 2026-10-16 -- here are the rest: Room Pages, custom pages
        var rows = b ? pk.rows : pk.rows.filter(function (r) { return !M.pageOf(r.key); });
        if (!rows.length) return;
        c.appendChild(K.group({ header: header || 'Pages', sk: b ? 'b:sky_pages' : 'sky.pages', footer: 'Each page’s background: Automatic (its own color, or the Background above), the Live Sky, a still Color, or a Photo.' +
            (b ? ' A page left alone follows All Screens.' : ' Each screen can choose its own. Climate, Lights and the other pages have theirs under Pages.') },
          rows.map(function (r) {
            var n = self.skyPageNow(r, b);
            return K.nav({ label: r.label, sub: r.custom ? 'Custom page' : null, value: n.mode ? M.skyModeLabel(n.mode, bds) : M.skyAutoLabel(r),
                           href: base + encodeURIComponent(r.key), sk: (b ? 'b:sky_pages:' : 'sky.pages:') + r.key });
          })));
      }
      // FLAT'S BACKGROUNDS (2026-10-16; settings.py FLAT_BACKGROUNDS). Flat
      // draws no live sky, so while a screen wears it, Sky / Background is
      // Flat's own page: a Color (Automatic, a tone that follows Light and
      // Dark, or your own), a Photo or Landscapes, how far a photo fades, and
      // each page's. The Glass looks' Sky / Background is kept for when Flat
      // is left. b null: All Screens'.
      flatHere(b) {
        var look = this.data.settings.look || {};
        return b ? M.glassOf(b, look).effective === 'flat' : look.flat === true;
      }
      flatTheme(b) {
        var look = this.data.settings.look || {};
        var t = b && (b.flat_theme === 'light' || b.flat_theme === 'dark') ? b.flat_theme : look.flat_theme;
        return t === 'light' ? 'light' : 'dark';
      }
      flatColors() { return (this.data.choices || {}).flat_colors || []; }
      // a color's name in this theme (Black is Pebble in Light)
      flatColorLabel(id, theme) {
        if (!id || id === 'auto') return 'Automatic';
        if (/^#/.test(id)) return 'Your Own Color';
        var p = this.flatColors().filter(function (x) { return x.id === id; })[0];
        return p ? (theme === 'light' && p.light_label) || p.label : id;
      }
      flatModeLabel(mode, theme) {
        return mode === 'photo' ? 'Photo' : mode === 'landscapes' ? 'Landscapes' : this.flatColorLabel(mode, theme);
      }
      // a page's Flat background now: {mode (its own, else All Screens'), own}
      flatPageNow(row, b) {
        var all = this.data.settings.sky.flat_pages || {}, mine = b ? (b.sky_flat_pages || {})[row.key] : all[row.key];
        return { mode: mine || all[row.key] || null, own: !!mine };
      }
      // (a page left alone says Automatic, whatever Automatic is for it)
      flatAutoLabel(row) { return 'Automatic'; }
      // a page's background in a word, whichever look the screen wears
      skyPageLabel(row, b) {
        if (this.flatHere(b)) { var f = this.flatPageNow(row, b); return f.mode ? this.flatModeLabel(f.mode, this.flatTheme(b)) : this.flatAutoLabel(row); }
        var n = this.skyPageNow(row, b), bds = (this.data.choices || {}).sky_backdrops || [];
        return n.mode ? M.skyModeLabel(n.mode, bds) : M.skyAutoLabel(row);
      }
      // the screen's (or All Screens') Flat background in a few words
      flatSummary(b) {
        var sky = this.data.settings.sky;
        var bg = (b && b.sky_flat_background) || sky.flat_background || 'color';
        return bg === 'color' ? this.flatColorLabel((b && b.sky_flat_color) || sky.flat_color || 'auto', this.flatTheme(b)) : M.BG_LABELS[bg];
      }
      // the store for Flat's keys: a screen's sky_flat_* / sky_page_photos, or
      // All Screens' sky.flat_* / sky.page_photos
      flatPut(x, b) {
        var self = this;
        return function (ch) {
          if (b) return self.setB(x.path, ch);
          var o = {};
          Object.keys(ch).forEach(function (k) { o['sky.' + k.replace(/^sky_/, '')] = ch[k]; });
          return self.setH(o);
        };
      }
      // THE COLORS: the theme's tone of each, then your own. o = { id (own,
      // or null following), follow ([label, id] or null), auto (offer
      // Automatic), theme, onPick(id | null), fk }
      flatColorGroup(c, o) {
        var self = this, rows = [], light = o.theme === 'light';
        var tone = function (id) {
          if (/^#/.test(id || '')) return id;
          var p = self.flatColors().filter(function (x) { return x.id === id; })[0] || self.flatColors()[0];
          return p ? p[light ? 'light' : 'dark'] : (light ? '#EEECE6' : '#17181A');
        };
        if (o.follow) rows.push(K.check({ label: o.follow[0], sub: 'Now ' + this.flatColorLabel(o.follow[1], o.theme), on: !o.id, fk: o.fk + 'follow',
                                          onClick: function () { o.onPick(null); } }));
        if (o.auto) rows.push(K.check({ label: 'Automatic', sub: 'Stone here; Climate, Lights, Security, Calendar and Weather each in a tone of their own',
                                        on: o.id === 'auto', fk: o.fk + 'auto', tile: ['mdi:auto-fix', tone('stone')], onClick: function () { o.onPick('auto'); } }));
        this.flatColors().forEach(function (p) {
          rows.push(K.check({ label: (light && p.light_label) || p.label, tile: ['', p[light ? 'light' : 'dark']], on: o.id === p.id, fk: o.fk + p.id,
                              onClick: function () { o.onPick(p.id); } }));
        });
        var own = /^#/.test(o.id || '');
        var row = K.text({ label: 'Your Own Color', sub: own ? o.id : 'Pick any color. It stays the same in Light and Dark.', type: 'color', fk: o.fk + 'custom',
                           value: own ? o.id : tone(o.id || 'stone'), onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) o.onPick(t.toUpperCase()); } });
        var inp = row.querySelector('input');
        if (inp) {
          inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
          inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) o.onPick(inp.value.toUpperCase()); });
        }
        if (own) row.classList.add('on');
        rows.push(row);
        c.appendChild(K.group({ header: o.header || 'Color', footer: 'Shown in their ' + (light ? 'Light' : 'Dark') + ' tones: each color has a Light and a Dark tone, and follows the Theme under Appearance. Solid, with nothing drawn on it.' }, rows));
      }
      // One editor and resolver for house, screen, page, and room image looks.
      // Opening writes nothing; patches preserve unrelated fields in the store.
      // `glass` (2026-10-24, the owner): the same Image Look for the Glass
      // looks' Photo and Landscapes, kept apart from Flat's (sky.image_look, a
      // screen's sky_image_look; hkFlatImage.resolveGlass), over the dark
      // ground; Off there is the photo with its Photo Look alone
      flatImageGroup(c, x, b, key, glass) {
        var self = this, I = window.hkFlatImage, sky = this.data.settings.sky || {};
        if (!I) return 'legacy';
        var keys = key ? (/^room-/.test(key) ? [key, 'rooms'] : [key]) : [];
        var resolved = glass ? I.resolveGlass(sky, b) : I.resolve(sky, b, keys), look = resolved.value;
        var field = glass ? 'sky_image_look' : key ? 'sky_flat_page_image_looks.' + key : 'sky_flat_image_look';
        var path = b ? field : 'sky.' + field.replace(/^sky_/, '');
        var own = glass ? (b ? b.sky_image_look : sky.image_look) || {}
                  : key ? ((b ? b.sky_flat_page_image_looks : sky.flat_page_image_looks) || {})[key] || {}
                      : (b ? b.sky_flat_image_look : sky.flat_image_look) || {};
        var patchPath = key ? path : path + '.patch';
        var patch = function (value) { var ch = {}; ch[patchPath] = value; return b ? self.setB(x.path, ch) : self.setH(ch); };
        var source = function (name) { return M.flatSourceLabel(resolved.from[name]) || 'Built-in Default'; };
        var labels = { legacy: glass ? 'Off' : 'Previous Look', original: 'Original', soft: 'Soft', balanced: 'Balanced', rich: 'Rich', washed: 'Washed', custom: 'Custom' };
        var notes = { original: 'Keep the photograph’s colors.', soft: 'Quiet color and gentle shadows.', balanced: 'Clear scenery with a moderate tint.', rich: 'Deeper shadows and richer color.', washed: 'A faint backdrop behind the cards.' };
        var active = I.preset(look);
        var legacyTint = glass ? 'none' : (b && b.sky_flat_tint) || sky.flat_tint || 'none';
        var choose = function (name) {
          var v = name === 'original' || name === 'legacy' ? { mode: name } : Object.assign({}, I.presets[name]);
          if (resolved.from.color.scope === 'default' && /^#/.test(legacyTint)) v.color = legacyTint;
          patch(v);
        };
        var rows = [K.select({ label: 'Image Look', sub: labels[active] + ' · ' + source('mode'), sk: path, fk: 'fi:look', value: active,
          options: Object.keys(labels).map(function (name) { return [name, labels[name]]; }),
          onChange: function (name) { if (name !== 'custom') choose(name); } })];
        if (Object.keys(own).length) rows.push(K.button({ label: key || b ? 'Use Inherited Image Settings' : 'Reset Image Settings', fk: 'fi:reset', onClick: function () { patch(null); } }));
        c.appendChild(this.withError(K.group({ header: 'Image Look', footer: look.mode === 'legacy'
          ? (glass ? 'The picture as it is, with the Look above. Choose a starting point to tint it as Flat does: its color, depth and fade.'
                   : 'Your previous appearance is kept. Choose a look below to use the new tint controls.')
          : 'Choose a starting point, then Adjust if you want. A look keeps your image and color choice. Page choices take priority over general screen settings.' }, rows), patchPath));

        var palette = M.flatColorsOf(this.data.settings.look || {}, b, keys);
        var seed = M.flatColorHex(palette.accent.value);
        var menuAccent = b ? b.accent : (this.data.settings.menu || {}).accent;
        var legacyAccent = menuAccent === 'auto' ? M.pageAccentOf(key || 'home', (this.data.settings.look || {}).page_accents).a.hex : M.accentOf(menuAccent).hex;
        var color = look.color === 'accent' ? seed || legacyAccent : look.color;
        var theme = glass ? 'dark' : this.flatTheme(b), list = this.landscapes() || [];
        var landscape = M.landscapeFile((b && b.sky_landscape) || sky.landscape || 'every:1440', list);
        var photos = b && b.sky_page_photos || {}, housePhotos = sky.page_photos || {};
        var pageMode = null, photo = null;
        keys.some(function (k) { pageMode = (b && b.sky_flat_pages || {})[k] || (sky.flat_pages || {})[k]; return !!pageMode; });
        keys.some(function (k) { photo = photos[k] || housePhotos[k]; return !!photo; });
        var mode = glass ? (b && b.sky_background) || sky.background || 'live'
          : pageMode && pageMode !== 'auto' ? pageMode : key && FLAT_OWN[key] ? 'color' : (b && b.sky_flat_background) || sky.flat_background || 'color';
        var src = mode === 'photo' ? photo || (b && b.sky_photo) || sky.photo : null;
        var example = mode !== 'landscapes' && !src;
        if (!src && landscape) src = '/hk/landscapes/' + landscape;
        var image = new Image(), paints = [];
        function addPreview(canvas, style, overlay) {
          paints.push(function () {
            if (!canvas.isConnected) return;
            try {
              I.paint(canvas, image, style, style.color === 'accent' ? seed || legacyAccent : style.color, canvas.className === 'flat-image-thumb' ? 180 : 640);
              if (overlay) overlay.style.background = I.fade(style.fade, theme);
              canvas.style.opacity = '1';
            } catch (e) { canvas.style.opacity = '0'; }
          });
        }
        var presetRows = Object.keys(notes).map(function (name) {
          var button = K.check({ label: labels[name], sub: notes[name], on: active === name, fk: 'fi:' + name, onClick: function () { choose(name); } });
          var box = h('span', { class: 'flat-image-mini', 'aria-hidden': 'true' });
          var cv = h('canvas', { class: 'flat-image-thumb' }), wash = h('span', { class: 'flat-image-wash' });
          box.appendChild(cv); box.appendChild(wash); button.insertBefore(box, button.firstChild);
          var style = Object.assign({}, look, name === 'original' ? { mode: 'original' } : I.presets[name]);
          addPreview(cv, style, wash); return button;
        });
        c.appendChild(K.group({ header: 'Starting Points' }, presetRows));
        if (look.mode !== 'legacy') {
          var preview = h('div', { class: 'cell photoprev' }), frame = h('div', { class: 'flat-image-preview' });
          frame.setAttribute('data-source', src || '');
          var canvas = h('canvas', { 'aria-label': 'Image look preview', role: 'img' }), overlay = h('span', { class: 'flat-image-wash' });
          frame.appendChild(canvas); frame.appendChild(overlay); preview.appendChild(frame);
          preview.appendChild(h('small', { text: src ? (example ? 'Sample landscape · choose Photo or Landscapes to use this look.' : 'Preview · ' + (key || (x && x.title) || 'All Screens')) : 'Choose a photo or landscape to preview the look.' }));
          var previewLook = Object.assign({}, look); addPreview(canvas, previewLook, overlay);
          var colorRows = [preview];
          if (look.mode === 'tinted') {
            colorRows.push(K.seg({ label: 'Color', sub: source('color'), value: look.color === 'accent' ? 'accent' : 'own', sk: path + ':color',
              options: [['accent', 'Match Accent'], ['own', 'Your Own Color']], onChange: function (v) { patch({ color: v === 'accent' ? 'accent' : color }); } }));
            if (look.color !== 'accent') {
              var cr = K.text({ label: 'Tint Color', type: 'color', fk: 'fi:color', value: look.color, onCommit: function (v) { patch({ color: v }); } });
              var input = cr.querySelector('input'); input.addEventListener('change', function () { patch({ color: input.value }); }); colorRows.push(cr);
            }
            if (own.color != null) colorRows.push(K.button({ label: 'Use Inherited Color', onClick: function () { patch({ color: null }); } }));
          }
          c.appendChild(K.group({ footer: 'Match Accent follows this page’s effective accent. Your Own Color stays independent.' }, colorRows));
          var adjustId = path + ':' + (x && x.path || 'house');
          this._flatImageAdjust = this._flatImageAdjust || {};
          var details = h('details', { class: 'flat-image-adjust' }); details.open = !!this._flatImageAdjust[adjustId];
          details.appendChild(h('summary', { class: 'cell', text: 'Adjust' }));
          details.addEventListener('toggle', function () { self._flatImageAdjust[adjustId] = details.open; });
          var sliders = [], fields = look.mode === 'tinted' ? ['strength', 'depth', 'brightness', 'fade'] : ['brightness', 'fade'];
          var help = { strength: 'Grayscale to full color', depth: 'Soft shadows to richer neighboring hues', brightness: 'Lighten or darken the image’s midtones', fade: 'Soften the image behind the cards' };
          fields.forEach(function (name) {
            var title = name.charAt(0).toUpperCase() + name.slice(1), says;
            if (name === 'brightness') { says = []; for (var n = -50; n <= 50; n++) says.push(n > 0 ? '+' + n : String(n)); }
            var row = K.slider({ label: title, sub: help[name] + ' · ' + source(name), sk: path + ':' + name, value: look[name], min: name === 'brightness' ? -50 : 0,
              max: name === 'brightness' ? 50 : 100, step: 5, labels: says, unit: name === 'brightness' ? '' : '%',
              onChange: function (v) { self._flatImageAdjust[adjustId] = details.open; var change = {}; change[name] = v; patch(change); } });
            if (says) { var out = row.querySelector('.val'); if (out) out.textContent = look[name] > 0 ? '+' + look[name] : String(look[name]); }
            row.querySelector('input').addEventListener('input', function (e) {
              previewLook[name] = +e.target.value; if (image.complete && image.naturalWidth) paints[paints.length - 1]();
            });
            sliders.push(row);
            if (own[name] != null) sliders.push(K.button({ label: 'Use Inherited ' + title, onClick: function () { var v = {}; v[name] = null; patch(v); } }));
          });
          details.appendChild(K.group({ footer: 'Strength, Depth, Brightness, and Fade are independent. Adjusting a preset makes it Custom.' }, sliders)); c.appendChild(details);
        }
        image.onload = function () { paints.forEach(function (paint) { paint(); }); };
        image.onerror = function () { if (preview) { var note = preview.querySelector('small'); if (note) note.textContent = 'The image could not be loaded. Your look is kept.'; } };
        if (src) image.src = src;
        return look.mode;
      }
      // THE FADE over a photo: the theme's ground washed over it, so the
      // cards stay easy to read. o = { value, house (a screen's: All Screens'),
      // own, onSet(v | null), sk }
      flatFadeGroup(c, o) {
        var self = this;
        var rows = [K.slider({ label: 'Fade', sub: o.house === undefined ? null : (o.own ? 'Just This Screen' : 'Same as All Screens'), sk: o.sk,
                               value: o.value, min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { o.onSet(v); } })];
        if (o.own) rows.push(K.button({ label: 'Reset to All Screens (' + o.house + '%)', sk: o.sk + ':reset', onClick: function () { o.onSet(null); } }));
        // TINT (2026-10-17, the user): the color the fade leans to -- none
        // (the theme's own), the page's accent, or one of your own
        var t = o.tint, tv = t.value || 'none', own = /^#/.test(tv);
        rows.push(K.seg({ label: 'Tint', sub: t.house === undefined ? null : (t.own ? 'Just This Screen' : 'Same as All Screens'), sk: t.sk,
          value: own ? 'own' : tv, options: [['none', 'None'], ['accent', 'Match Accent'], ['own', 'Your Own']], stack: !this.hasAttribute('wide'),
          onChange: function (v) { t.onSet(v === 'own' ? (own ? tv : '#7e9b83') : v); } }));
        if (own) {
          var row = K.text({ label: 'Tint Color', sub: tv.toUpperCase(), type: 'color', fk: t.sk + ':color', value: tv,
                             onCommit: function (x) { if (/^#[0-9a-f]{6}$/i.test(x)) t.onSet(x.toLowerCase()); } });
          var inp = row.querySelector('input');
          if (inp) {
            inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
            inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) t.onSet(inp.value.toLowerCase()); });
          }
          rows.push(row);
        }
        if (t.own) rows.push(K.button({ label: 'Reset Tint to All Screens (' + M.flatTintLabel(t.house) + ')', sk: t.sk + ':reset', onClick: function () { t.onSet(null); } }));
        // ...and how strong (2026-10-17, the user: a light one, or a strong one)
        if (tv !== 'none') {
          var ta = o.tintAmount;
          rows.push(K.slider({ label: 'Tint Strength', sub: ta.house === undefined ? null : (ta.own ? 'Just This Screen' : 'Same as All Screens'), sk: ta.sk,
                               value: ta.value, min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { ta.onSet(v); } }));
          if (ta.own) rows.push(K.button({ label: 'Reset Strength to All Screens (' + ta.house + '%)', sk: ta.sk + ':reset', onClick: function () { ta.onSet(null); } }));
          // ...and how bright: stored 0-100, 50 the photo as it is, said -50..+50
          var tb = o.tintLight, says = [];
          for (var n = 0; n <= 100; n++) says.push(n === 50 ? '0' : (n > 50 ? '+' : '−') + Math.abs(n - 50));
          rows.push(K.slider({ label: 'Tint Brightness', sub: tb.house === undefined ? null : (tb.own ? 'Just This Screen' : 'Same as All Screens'), sk: tb.sk,
                               value: tb.value, min: 0, max: 100, step: 5, labels: says, onChange: function (v) { tb.onSet(v); } }));
          if (tb.own) rows.push(K.button({ label: 'Reset Brightness to All Screens (' + says[tb.house] + ')', sk: tb.sk + ':reset', onClick: function () { tb.onSet(null); } }));
        }
        void self;
        c.appendChild(this.withError(K.group({ footer: 'How far the background fades behind the cards: Light washes it toward limestone, Dark toward black. 0% shows the photo as taken. ' +
          'Tint turns the photo to one color, keeping its own light and dark: the page’s accent (its Flat Accent Color, else its own Accent Color), or one of your own. Strength is how far; Brightness lightens or darkens it.' }, rows), o.sk));
      }
      flatSky(c, x, b, base) {
        var self = this, sky = this.data.settings.sky, theme = this.flatTheme(b), put = this.flatPut(x, b);
        var hMode = sky.flat_background || 'color', own = b ? b.sky_flat_background : null, mode = own || hMode;
        var bgRows = [K.previewPick({ label: 'Background', sub: b ? (own ? 'Just This Screen' : 'Same as All Screens') : null, sk: b ? 'b:sky_flat_background' : 'sky.flat_background',
          value: mode, options: [['color', 'Color'], ['photo', 'Photo'], ['landscapes', 'Landscapes']],
          // (Flat's Color: one solid color, its theme's ground)
          picture: function (v, w, ht) { return self.bgKindThumb(v === 'color' ? 'solid' : v, w, ht, null, theme === 'light' ? '#ECEAE5' : '#24252A'); },
          onChange: function (v) { put({ sky_flat_background: v }); } })];
        if (own) bgRows.push(K.button({ label: 'Reset to All Screens (' + M.BG_LABELS[hMode] + ')', sk: 'b:sky_flat_background:reset',
                                        onClick: function () { put({ sky_flat_background: null }); } }));
        var says = { color: 'A solid color behind the cards.', photo: 'A photo of your own, still, faded behind the cards.',
                     landscapes: 'One of ' + PN() + '’s landscape photos, still, faded behind the cards.' };
        c.appendChild(K.group({ footer: says[mode] + ' Flat shows no Live Sky: its sun, weather and decorations come back with the other looks, as you left them. ' +
          (b ? 'Each page can choose its own below.' : 'Each screen, and each page, can choose its own.') }, bgRows));
        if (mode === 'color') {
          this.flatColorGroup(c, { id: b ? (b.sky_flat_color || null) : (sky.flat_color || 'auto'), follow: b ? ['Same as All Screens', sky.flat_color || 'auto'] : null,
            auto: true, theme: theme, fk: b ? 'bflat:' : 'hflat:', onPick: function (id) { put({ sky_flat_color: id }); } });
        }
        if (mode === 'photo') {
          this.photoGroup(c, b ? { url: b.sky_photo || null, from: sky.photo || null, fromLabel: 'All Screens’ photo', fk: 'bphoto', sk: 'b:sky_photo',
                                   footer: 'The same photo the other looks use.',
                                   onSet: function (url) { var was = b.sky_photo; self.setB(x.path, { sky_photo: url }).then(function (ok) { if (ok) self.photoForget(was); }); } }
                               : { url: sky.photo || null, fk: 'hphoto', sk: 'sky.photo', footer: 'The same photo the other looks use.',
                                   onSet: function (url) { var was = sky.photo; self.setH({ 'sky.photo': url }).then(function (ok) { if (ok) self.photoForget(was); }); } });
        }
        if (mode === 'landscapes') {
          this.landscapeGroup(c, b ? { value: b.sky_landscape || null, house: sky.landscape || 'every:1440', fk: 'bland', sk: 'b:sky_landscape', href: base + '/landscape',
                                       onSet: function (v) { self.setB(x.path, { sky_landscape: v }); } }
                                   : { value: sky.landscape || 'every:1440', fk: 'hland', sk: 'sky.landscape', href: '#/house/appearance/sky/landscape',
                                       onSet: function (v) { self.setH({ 'sky.landscape': v }); } });
        }
        // the fade reaches every photo here -- a page's own too -- so it shows
        // wherever a photo can be
        var hFade = sky.flat_fade == null ? 50 : sky.flat_fade, fOwn = !!b && b.sky_flat_fade != null;
        var hTint = sky.flat_tint || 'none', tOwn = !!b && b.sky_flat_tint != null;
        var hAmt = sky.flat_tint_amount == null ? 60 : sky.flat_tint_amount, aOwn = !!b && b.sky_flat_tint_amount != null;
        var hLight = sky.flat_tint_light == null ? 50 : sky.flat_tint_light, lOwn = !!b && b.sky_flat_tint_light != null;
        if (this.flatImageGroup(c, x, b, null) === 'legacy') this.flatFadeGroup(c, { value: fOwn ? b.sky_flat_fade : hFade, house: b ? hFade : undefined, own: fOwn, sk: b ? 'b:sky_flat_fade' : 'sky.flat_fade',
                                onSet: function (v) { put({ sky_flat_fade: v }); },
                                tint: { value: tOwn ? b.sky_flat_tint : hTint, house: b ? hTint : undefined, own: tOwn, sk: b ? 'b:sky_flat_tint' : 'sky.flat_tint',
                                        onSet: function (v) { put({ sky_flat_tint: v }); } },
                                tintAmount: { value: aOwn ? b.sky_flat_tint_amount : hAmt, house: b ? hAmt : undefined, own: aOwn,
                                              sk: b ? 'b:sky_flat_tint_amount' : 'sky.flat_tint_amount', onSet: function (v) { put({ sky_flat_tint_amount: v }); } },
                                tintLight: { value: lOwn ? b.sky_flat_tint_light : hLight, house: b ? hLight : undefined, own: lOwn,
                                             sk: b ? 'b:sky_flat_tint_light' : 'sky.flat_tint_light', onSet: function (v) { put({ sky_flat_tint_light: v }); } } });
        this.flatPagesGroup(c, x, b, base);
        this.skyResetGroup(c, x, b);
      }
      // THE PAGES' Flat backgrounds, a tap away
      flatPagesGroup(c, x, b, base) {
        var self = this, rows = this.skyPageKeys(b).rows, theme = this.flatTheme(b);
        if (!rows.length) return;
        c.appendChild(K.group({ header: 'Pages', sk: b ? 'b:sky_flat_pages' : 'sky.flat_pages',
          footer: 'Each page’s background: Automatic (its own tone, or the Background above), a Color, a Photo or Landscapes.' + (b ? ' A page left alone follows All Screens.' : '') },
          rows.map(function (r) {
            var n = self.flatPageNow(r, b);
            return K.nav({ label: r.label, sub: r.custom ? 'Custom page' : null, value: n.mode ? self.flatModeLabel(n.mode, theme) : self.flatAutoLabel(r),
                           href: base + '/page/' + encodeURIComponent(r.key), sk: (b ? 'b:sky_flat_pages:' : 'sky.flat_pages:') + r.key });
          })));
      }
      // ONE PAGE'S Flat background: Same as All Screens / Room Pages, Automatic,
      // a Color, a Photo or Landscapes
      flatPagePicker(c, x, b, r, base) {
        var self = this, sky = this.data.settings.sky, all = sky.flat_pages || {}, theme = this.flatTheme(b), put = this.flatPut(x, b);
        var mine = b ? (b.sky_flat_pages || {}) : all, photos = b ? (b.sky_page_photos || {}) : (sky.page_photos || {});
        var cur = mine[r.key] || '';
        var isColor = !!cur && cur !== 'auto' && cur !== 'photo' && cur !== 'landscapes';
        var pick = function (v) {
          var next = Object.assign({}, mine);
          if (v) next[r.key] = v; else delete next[r.key];
          put({ sky_flat_pages: next });
        };
        var roomsNow = (b && (b.sky_flat_pages || {}).rooms) || all.rooms;
        var follow = b && all[r.key] ? ['Same as All Screens', 'Now ' + this.flatModeLabel(all[r.key], theme)]
                   : r.room ? ['Same as Room Pages', 'Now ' + (roomsNow ? this.flatModeLabel(roomsNow, theme) : 'the screen’s Background')] : null;
        var autoSays = FLAT_OWN[r.key] ? (M.PAGE_ACCENTS[r.key] ? 'A light or dark shade of its Accent Color (' + M.pageAccentOf(r.key, this.hs('look.page_accents')).a.name + ')' : 'Its own tone, in Light and Dark')
                                       : 'The screen’s Background (' + this.flatSummary(b) + ')';
        var rows = [];
        if (follow) rows.push(K.check({ label: follow[0], sub: follow[1], on: !cur, fk: 'fpbd:' + r.key + ':follow', onClick: function () { pick(''); } }));
        rows.push(K.check({ label: 'Automatic', sub: autoSays, on: follow ? cur === 'auto' : (!cur || cur === 'auto'), fk: 'fpbd:' + r.key + ':auto',
                            tile: ['mdi:auto-fix', C.green], onClick: function () { pick(follow ? 'auto' : ''); } }));
        rows.push(K.check({ label: 'Color', sub: isColor ? this.flatColorLabel(cur, theme) : 'A solid color', on: isColor, fk: 'fpbd:' + r.key + ':color',
                            tile: ['mdi:palette', C.purple], onClick: function () { if (!isColor) pick((b && b.sky_flat_color && b.sky_flat_color !== 'auto' && b.sky_flat_color) || (sky.flat_color !== 'auto' && sky.flat_color) || 'stone'); } }));
        rows.push(K.check({ label: 'Photo', sub: photos[r.key] ? 'Its own photo' : 'A photo, still', on: cur === 'photo', fk: 'fpbd:' + r.key + ':photo',
                            tile: ['mdi:image', C.orange], onClick: function () { pick('photo'); } }));
        rows.push(K.check({ label: 'Landscapes', sub: PN() + '’s own photos, as ' + (b ? 'the screen' : 'All Screens') + ' has them', on: cur === 'landscapes',
                            fk: 'fpbd:' + r.key + ':landscapes', tile: ['mdi:image-filter-hdr', C.teal], onClick: function () { pick('landscapes'); } }));
        c.appendChild(K.group({ footer: 'While Flat is on. A photo here fades as ' + (b ? 'the screen’s' : 'All Screens’') + ' Fade says.' }, rows));
        // ITS FLAT COLORS, beside its background (the same page key)
        var fps = this.flatScope(b ? 'screen-page' : 'house-page', x, b, r.key);
        c.appendChild(K.group({ footer: 'Its Accent Color shades an Automatic background here.' },
          [this.flatColorsNav(fps, { inherited: b ? 'Same as This Screen' : 'Same as All Screens' })]));
        if (isColor) this.flatColorGroup(c, { id: cur, theme: theme, fk: 'fpbd:' + r.key + ':', onPick: function (id) { pick(id); } });
        if (cur === 'photo') {
          var lvl = (r.room && photos.rooms) || (b ? (b.sky_photo || sky.photo) : sky.photo);
          this.photoGroup(c, { url: photos[r.key] || null, from: lvl || null,
            fromLabel: r.room && photos.rooms ? 'Room Pages’ photo' : b ? 'the screen’s photo' : 'All Screens’ photo',
            fk: 'pphoto:' + r.key, sk: b ? 'b:sky_page_photos' : 'sky.page_photos', header: 'Its Photo',
            footer: 'The same photo the other looks use for this page.',
            onSet: function (url) {
              var was = photos[r.key], next = Object.assign({}, photos);
              if (url) next[r.key] = url; else delete next[r.key];
              put({ sky_page_photos: next }).then(function (ok) { if (ok) self.photoForget(was); });
            } });
        }
        this.flatImageGroup(c, x, b, r.key);
        if (r.key === 'rooms') {
          var rrows = this.areasAZ().map(function (aid) {
            var k = self.roomKey(aid);
            if (!k) return null;
            var n = self.flatPageNow({ key: k, room: true }, b);
            return K.nav({ label: self.areaName(aid), icon: ((self.client.areas || {})[aid] || {}).icon || 'mdi:texture-box',
                           value: n.own ? self.flatModeLabel(n.mode, theme) : 'Same as Room Pages', href: base + '/page/' + encodeURIComponent(k),
                           sk: (b ? 'b:sky_flat_pages:' : 'sky.flat_pages:') + k });
          }).filter(Boolean);
          if (rrows.length) c.appendChild(K.group({ header: 'Each Room', footer: 'A room left alone is the same as Room Pages.' }, rrows));
        }
      }
      // FLAT COLORS (2026-10-17; hk_house/docs/PLAN-2026-10-17-flat-appearance-colors.md):
      // Flat's Accent Color and Off Pill Tint, one editor at every scope --
      // All Screens, a screen, and a page or room on either. A scope:
      // {kind: 'house' | 'screen' | 'house-page' | 'screen-page', x, b, key}.
      // Opening any of it writes nothing; a field left alone is inherited,
      // Automatic stops there.
      flatAnywhere() {
        var look = this.data.settings.look || {}, boards = this.data.boards || {};
        return look.flat === true || Object.keys(boards).some(function (p) { return M.glassOf(boards[p], look).effective === 'flat'; });
      }
      flatScope(kind, x, b, key) {
        var self = this, look = this.data.settings.look || {};
        var screen = kind === 'screen' || kind === 'screen-page', page = kind === 'house-page' || kind === 'screen-page';
        var sb = screen ? b : null, row = page ? this.skyRow(key, sb) : null;
        var keys = page ? (row && row.room ? [key, 'rooms'] : [key]) : [];
        var base = screen ? '#/screens/' + encodeURIComponent(x.path) + '/flat-colors' : '#/house/appearance/flat-colors';
        var sc = { kind: kind, x: x, b: sb, key: key || null, row: row, keys: keys, page: page, screen: screen,
                   href: page ? base + '/page/' + encodeURIComponent(key) : base, baseHref: base,
                   label: page ? (row ? row.label : key) : screen ? x.title : 'All Screens' };
        sc.own = function () {
          if (kind === 'house') return look.flat_colors || {};
          if (kind === 'screen') return (sb && sb.flat_colors) || {};
          if (kind === 'house-page') return (look.flat_page_colors || {})[key] || {};
          return ((sb && sb.flat_page_colors) || {})[key] || {};
        };
        sc.labelOf = function (k) { var r = self.skyRow(k, sb); return r ? r.label : null; };
        sc.resolved = function () { return M.flatColorsOf(look, sb, keys); };
        // a field as it would be with this scope's own taken away
        sc.parent = function (f) {
          var L = JSON.parse(JSON.stringify(look)), B = sb ? JSON.parse(JSON.stringify(sb)) : null;
          if (kind === 'screen') delete (B.flat_colors || {})[f];
          else if (kind === 'house-page') delete ((L.flat_page_colors || {})[key] || {})[f];
          else if (kind === 'screen-page') delete ((B.flat_page_colors || {})[key] || {})[f];
          return M.flatColorsOf(L, B, keys)[f];
        };
        return sc;
      }
      // SAVE a patch ({accent?, off_tint?}: a value, or null to inherit again
      // -- All Screens': Automatic) at the scope, shown at once; `whole`: the
      // scope's own replaced (a reset)
      flatColorsPut(sc, patch, whole) {
        var d = this.data, look = d.settings.look, ch = {};
        var made = function (o) {
          o = whole ? {} : Object.assign({}, o || {});
          Object.keys(patch).forEach(function (f) { if (patch[f] == null) delete o[f]; else o[f] = patch[f]; });
          return o;
        };
        if (sc.kind === 'house') {
          look.flat_colors = Object.assign({ accent: 'auto', off_tint: 'auto', pages: 'accent' }, made(look.flat_colors));
          if (whole) ch['look.flat_colors'] = look.flat_colors;
          else Object.keys(patch).forEach(function (f) { ch['look.flat_colors.' + f] = patch[f]; });
          return this.setH(ch);
        }
        if (sc.kind === 'house-page') {
          var hp = look.flat_page_colors = Object.assign({}, look.flat_page_colors), hv = made(hp[sc.key]);
          if (Object.keys(hv).length) hp[sc.key] = hv; else delete hp[sc.key];
          ch['look.flat_page_colors.' + sc.key] = whole ? (Object.keys(hv).length ? hv : null) : patch;
          return this.setH(ch);
        }
        var b = d.boards[sc.x.path] = Object.assign({}, d.boards[sc.x.path]);
        if (sc.kind === 'screen') {
          b.flat_colors = made(b.flat_colors);
          if (whole) ch.flat_colors = b.flat_colors;
          else Object.keys(patch).forEach(function (f) { ch['flat_colors.' + f] = patch[f]; });
        } else {
          var bp = b.flat_page_colors = Object.assign({}, b.flat_page_colors), bv = made(bp[sc.key]);
          if (Object.keys(bv).length) bp[sc.key] = bv; else delete bp[sc.key];
          ch['flat_page_colors.' + sc.key] = whole ? (Object.keys(bv).length ? bv : null) : patch;
        }
        return this.setB(sc.x.path, ch);
      }
      // "Just This Screen", "From Calendar on All Screens" ...: whose a field is
      flatFieldWhere(sc, name, f) {
        var own = sc.own()[name] != null;
        if (sc.kind === 'house') return null;
        if (own) return sc.kind === 'screen' ? 'Just This Screen' : sc.kind === 'house-page' ? 'Just This Page' : 'Just This Page Here';
        var src = M.flatSourceLabel(f, { label: sc.labelOf });
        return src ? 'From ' + src : null;
      }
      // A ROW THAT LEADS TO A SCOPE'S FLAT COLORS, with what it comes to
      flatColorsNav(sc, o) {
        o = o || {};
        var r = sc.resolved(), own = sc.own(), mine = own.accent != null || own.off_tint != null;
        var value = sc.kind === 'house' || mine || !sc.page || r.accent.scope === 'own-page' ? M.flatAccentSays(r.accent) +
                    (r.off_tint.value === 'accent' || r.off_tint.value === 'auto' ? '' : ' · Own Tint')
                  : (o.inherited || 'Inherited');
        // (All Screens' and a screen's: the pills' tint -- their accent is
        // Appearance's Accent Color since 2026-10-29)
        if (!sc.page) value = M.flatColorName(r.off_tint.value);
        return K.nav({ label: o.label || 'Flat Colors', value: value, sub: o.sub || null, href: sc.href,
                       tile: o.tile === false ? null : ['mdi:palette-outline', M.flatColorHex(r.accent.value) || '#8e8e93'],
                       sk: (sc.screen ? 'b:' : 'look.') + (sc.page ? 'flat_page_colors:' + sc.key : 'flat_colors') });
      }
      // THE FLAT COLORS PAGE: the two fields (each its value and whose it
      // is), what the background does with them, each page's own, the resets
      flatColorsPage(c, sc) {
        var self = this, r = sc.resolved(), own = sc.own(), look = this.data.settings.look || {};
        if (sc.page && !sc.row) {
          c.appendChild(K.group({ footer: 'This page isn’t on ' + (sc.screen ? 'this screen' : 'any screen') + ', so it has no colors to choose.' }, []));
          return;
        }
        var flatOn = sc.screen ? this.flatHere(sc.b) : this.flatHere(null);
        var accentHex = M.flatColorHex(r.accent.value);
        var tintSays = r.off_tint.value === 'accent' ? (accentHex ? 'Match Accent' : 'Match Highlight') : M.flatColorName(r.off_tint.value);
        var foot = {
          house: 'In Flat, the Accent Color shades an Automatic background and colors the menu and tab bar. Off Pill Tint washes every pill that’s off; lit pills stay white. Each screen, page and room can choose its own.',
          screen: 'This screen’s own colors, over All Screens’. Page overrides take priority over general screen colors: a page with colors of its own, here or on All Screens, keeps them.',
          'house-page': 'This page on every screen, over the screens’ general colors. To change it on one screen only, choose it under that screen’s Flat Colors → Pages.',
          'screen-page': 'This page on this screen only. It wins over everything else.'
        }[sc.kind];
        if (!flatOn) foot += sc.screen ? ' This screen isn’t using Flat now: these wait until it is.' : ' All Screens isn’t using Flat now: these are the colors for any screen that is.';
        c.appendChild(K.group({ header: sc.page ? 'Flat Colors' : null, footer: foot }, [
          // (All Screens' and a screen's accent is Appearance's Accent Color
          // since 2026-10-29; a page's own stays here)
          !sc.page ? null : K.nav({ label: 'Accent Color', value: M.flatAccentSays(r.accent), sub: this.flatFieldWhere(sc, 'accent', r.accent),
                  tile: accentHex ? ['', accentHex] : ['mdi:auto-fix', AUTO_ACCENT_TILE], href: sc.href + '/accent',
                  sk: (sc.screen ? 'b:' : 'look.') + 'flat_colors:accent' }),
          K.nav({ label: 'Off Pill Tint', value: tintSays, sub: this.flatFieldWhere(sc, 'off_tint', r.off_tint),
                  tile: M.flatColorHex(r.off_tint.value) ? ['', M.flatColorHex(r.off_tint.value)]
                      : r.off_tint.value === 'accent' ? ['mdi:link-variant', accentHex || '#8e8e93'] : ['mdi:auto-fix', AUTO_ACCENT_TILE],
                  href: sc.href + '/tint', sk: (sc.screen ? 'b:' : 'look.') + 'flat_colors:off_tint' })]
          // WHETHER THE PAGES TAKE IT (All Screens and a screen: a page's own
          // accent is always its own)
          .concat(sc.page ? [] : [K.nav({ label: 'Pages', value: M.flatPagesName(r.pages.value),
                  sub: sc.kind === 'screen' && sc.own().pages != null ? 'Just This Screen' : null,
                  href: sc.href + '/pages', sk: (sc.screen ? 'b:' : 'look.') + 'flat_colors:pages' })])));
        this.flatBackgroundGroup(c, sc, r);
        if (!sc.page) this.flatColorsPages(c, sc);
        else if (sc.key === 'rooms') this.flatColorsRooms(c, sc);
        // THE RESETS: Automatic stops inheriting; inherited follows again
        var auto = (r.accent.value === 'auto' || !sc.page) && r.off_tint.value === 'auto';
        var mine = (sc.page && own.accent != null) || own.off_tint != null;
        var acts = [];
        if (!auto) acts.push(K.button({ label: 'Restore Automatic Colors', fk: 'flatc:auto', onClick: function () {
          self.flatColorsPut(sc, sc.page ? { accent: 'auto', off_tint: 'auto' } : { off_tint: 'auto' }).then(function (ok) { if (ok) self.announce('Automatic colors restored'); });
        } }));
        if (sc.kind !== 'house' && mine) acts.push(K.button({ label: sc.kind === 'screen' ? 'Reset to All Screens' : 'Use Inherited Colors', fk: 'flatc:inherit',
          onClick: function () { self.flatColorsPut(sc, {}, true).then(function (ok) { if (ok) self.announce('Colors inherited again'); }); } }));
        if (acts.length) {
          c.appendChild(K.group({ footer: sc.kind === 'house' ? 'Both back to Automatic: each page’s own Accent Color, each accessory’s own tint. The Background is its own setting.'
              : 'Restore Automatic Colors: Automatic here, whatever ' + (sc.kind === 'screen' ? 'All Screens chooses' : 'the screens choose') + '. ' +
                (mine ? (sc.kind === 'screen' ? 'Reset to All Screens' : 'Use Inherited Colors') + ': both fields follow ' + (sc.kind === 'screen' ? 'All Screens' : 'the screen and All Screens') + ' again. ' : '') +
                'The Background is its own setting.' }, acts));
        }
        // a screen of its own in Flat under a house in Glass: All Screens'
        // Flat Colors are still where its inherited colors come from
        if (sc.kind === 'screen' && !this.flatHere(null)) {
          c.appendChild(K.group({ footer: 'What this screen inherits. Editing them leaves All Screens’ own style as it is.' },
            [this.flatColorsNav(this.flatScope('house'), { label: 'All Screens’ Flat Colors' })]));
        }
      }
      // WHAT THE BACKGROUND DOES WITH THEM: an Automatic background takes the
      // accent's shade; a color, photo or landscape chosen keeps its own --
      // said, with a way to it and a deliberate way back to Automatic
      flatBackgroundGroup(c, sc, r) {
        var self = this, sky = this.data.settings.sky, b = sc.b, theme = this.flatTheme(b);
        var houseFlat = this.flatHere(null), src = null, label = null, href;
        var pageMode = null, pageScope = null;
        sc.keys.forEach(function (k) {
          if (pageMode) return;
          var mine = b && (b.sky_flat_pages || {})[k], all = (sky.flat_pages || {})[k];
          if (mine) { pageMode = mine; pageScope = 'screen'; } else if (all) { pageMode = all; pageScope = 'house'; }
        });
        if (pageMode && pageMode !== 'auto') { src = 'page'; label = this.flatModeLabel(pageMode, theme); }
        else if (!(sc.page && FLAT_OWN[sc.key])) {
          var bg = (b && b.sky_flat_background) || sky.flat_background || 'color';
          var col = bg === 'color' ? ((b && b.sky_flat_color) || sky.flat_color || 'auto') : null;
          if (bg !== 'color' || col !== 'auto') { src = b && (b.sky_flat_background || b.sky_flat_color) ? 'screen' : 'house'; label = bg === 'color' ? this.flatColorLabel(col, theme) : M.BG_LABELS[bg]; }
        }
        if (sc.page) href = sc.screen ? '#/screens/' + encodeURIComponent(sc.x.path) + '/sky/page/' + encodeURIComponent(sc.key)
                                     : (houseFlat ? '#/house/appearance/sky/page/' : '#/house/appearance/sky/flat/page/') + encodeURIComponent(sc.key);
        else href = sc.screen ? '#/screens/' + encodeURIComponent(sc.x.path) + '/sky' : houseFlat ? '#/house/appearance/sky' : '#/house/appearance/sky/flat';
        var seed = M.flatColorHex(r.accent.value);
        var rows = [K.nav({ label: 'Background', href: href, sk: 'flatc:background',
                            value: src ? label + ' · Separate Choice' : seed ? 'Matches Accent Color' : 'Automatic' })];
        if (src && seed) {
          rows.push(K.button({ label: 'Use Automatic Background', fk: 'flatc:bg-auto', onClick: function () {
            var done;
            if (src === 'page') {
              var put = pageScope === 'screen' ? self.flatPut(sc.x, b) : self.flatPut(null, null);
              var map = Object.assign({}, pageScope === 'screen' ? b.sky_flat_pages : sky.flat_pages);
              var pk = sc.keys.filter(function (k) { return map[k]; })[0];
              if (pageScope === 'screen' && (sky.flat_pages || {})[pk]) map[pk] = 'auto'; else delete map[pk];
              done = put({ sky_flat_pages: map });
            } else done = (src === 'screen' ? self.flatPut(sc.x, b) : self.flatPut(null, null))({ sky_flat_background: 'color', sky_flat_color: 'auto' });
            done.then(function (ok) { if (ok) self.announce('Background is Automatic'); });
          } }));
        }
        var say = src ? (seed ? 'A background you chose stays as it is: the accent colors the highlight and the pills, not it. Use Automatic Background to let it match.'
                              : 'A background you chose stays as it is.')
                      : seed ? 'An Automatic background is a very light (or, in Dark, very deep) shade of the Accent Color.'
                             : 'Automatic: ' + (sc.page && FLAT_OWN[sc.key] ? 'a shade of the page’s own Accent Color.' : 'the theme’s own ground.');
        c.appendChild(K.group({ header: 'Background', footer: say + (src === 'page' ? ' (Chosen for this page.)' : src ? ' (Chosen for ' + (src === 'screen' ? 'this screen' : 'All Screens') + '.)' : '') }, rows));
      }
      // EACH PAGE'S OWN, a tap away, from All Screens' or a screen's
      flatColorsPages(c, sc) {
        var self = this, rows = this.skyPageKeys(sc.b).rows;
        if (!rows.length) return;
        c.appendChild(K.group({ header: 'Pages', footer: 'A page left alone takes the colors above' + (sc.screen ? ', unless All Screens gives it its own.' : '.') },
          rows.map(function (row) {
            var ps = self.flatScope(sc.screen ? 'screen-page' : 'house-page', sc.x, sc.b, row.key);
            var hp = sc.screen ? self.flatScope('house-page', null, null, row.key) : null, hpo = hp ? hp.own() : {};
            return self.flatColorsNav(ps, { label: row.label, sub: row.custom ? 'Custom page' : null, tile: false,
              inherited: hp && (hpo.accent != null || hpo.off_tint != null) ? 'From All Screens' : sc.screen ? 'Same as This Screen' : 'Same as All Screens' });
          })));
      }
      flatColorsRooms(c, sc) {
        var self = this;
        var rows = this.areasAZ().map(function (aid) {
          var k = self.roomKey(aid);
          if (!k) return null;
          var rs = self.flatScope(sc.kind, sc.x, sc.b, k);
          return self.flatColorsNav(rs, { label: self.areaName(aid), tile: false, inherited: 'Same as Room Pages' });
        }).filter(Boolean);
        if (rows.length) c.appendChild(K.group({ header: 'Each Room', footer: 'A room’s own colors win over Room Pages’.' }, rows));
      }
      // ONE FIELD'S CHOICES: Same as / inherited, Automatic, then its colors
      flatColorsPick(c, sc, f) {
        var self = this, r = sc.resolved(), own = sc.own()[f], cur = r[f].value, house = sc.kind === 'house';
        var pick = function (v) {
          var patch = f === 'accent' && v != null ? M.flatAccentChange(v, r) : (function () { var p = {}; p[f] = v; return p; })();
          self.flatColorsPut(sc, patch).then(function (ok) {
            if (ok && patch.off_tint === 'accent') self.announce('Off Pill Tint now matches the accent');
          });
        };
        var rows = [];
        if (!house) {
          var par = sc.parent(f), src = M.flatSourceLabel(par, { label: sc.labelOf });
          rows.push(K.check({ label: sc.kind === 'screen' ? 'Same as All Screens' : 'Use Inherited ' + (f === 'accent' ? 'Color' : 'Tint'),
                              sub: 'Now ' + M.flatColorName(par.value) + (src ? ' · ' + src : ''), on: own == null, fk: 'flatc:' + f + ':inherit',
                              onClick: function () { pick(null); } }));
        }
        var isOwn = function (v) { return (house || own != null) && cur === v; };
        if (f === 'accent') {
          rows.push(K.check({ label: 'Automatic', sub: 'Each page’s own Accent Color, as in the other looks; Home and the rooms orange',
                              tile: ['mdi:auto-fix', AUTO_ACCENT_TILE], on: isOwn('auto'), fk: 'flatc:accent:auto', onClick: function () { pick('auto'); } }));
          M.FLAT_ACCENTS.forEach(function (p) {
            rows.push(K.check({ label: p[1], tile: ['', p[2]], on: isOwn(p[2]), fk: 'flatc:accent:' + p[0], onClick: function () { pick(p[2]); } }));
          });
        } else {
          var acc = M.flatColorHex(r.accent.value);
          rows.push(K.check({ label: 'Automatic', sub: 'Each accessory in a wash of its own color. Flat Dark keeps its plain pills.',
                              tile: ['mdi:auto-fix', AUTO_ACCENT_TILE], on: isOwn('auto'), fk: 'flatc:tint:auto', onClick: function () { pick('auto'); } }));
          rows.push(K.check({ label: 'Match Accent', sub: acc ? 'Now ' + M.flatColorName(r.accent.value) + ', and whatever it becomes' : 'The page’s highlight, while the Accent Color is Automatic',
                              tile: ['mdi:link-variant', acc || '#8e8e93'], on: isOwn('accent'), fk: 'flatc:tint:accent', onClick: function () { pick('accent'); } }));
        }
        var named = (f === 'accent' ? M.FLAT_ACCENTS.map(function (p) { return p[2]; }) : []).concat(['auto', 'accent']);
        var custom = (house || own != null) && named.indexOf(cur) < 0;
        var start = M.flatColorHex(cur) || (f === 'accent' ? '#8872b4' : '#789484');
        var row = K.text({ label: 'Your Own Color', sub: custom ? start.toUpperCase() : f === 'accent' ? 'Pick any color.' : 'One tint for every pill, whatever the accent.',
                           type: 'color', fk: 'flatc:' + f + ':custom', value: start, error: this.err((sc.screen ? 'b:' : 'look.') + 'flat_colors.' + f),
                           onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) pick(t.toLowerCase()); } });
        var inp = row.querySelector('input');
        if (inp) {
          inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
          inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) pick(inp.value.toLowerCase()); });
        }
        if (custom) row.classList.add('on');
        rows.push(row);
        var foot = f === 'accent'
          ? 'Shades an Automatic background and colors the menu and tab bar: its icons and the page you’re on. Chosen while Off Pill Tint is Automatic, it sets the tint to Match Accent too; a tint of your own stays. The Highlight Color stays saved for the other looks.'
          : 'The wash on pills that are off, and their circles. Lit pills stay white with their own colors; alerts and warnings keep theirs.';
        c.appendChild(K.group({ header: f === 'accent' ? 'Accent Color' : 'Off Pill Tint', footer: foot }, rows));
      }
      // THE PAGES THAT HAVE A COLOR OF THEIR OWN: the accent, or theirs
      flatPagesPick(c, sc) {
        var self = this, own = sc.own().pages, cur = sc.resolved().pages.value, house = sc.kind === 'house';
        var pick = function (v) { self.flatColorsPut(sc, { pages: v }); };
        var on = function (v) { return (house || own != null) && cur === v; };
        var rows = [];
        if (!house) {
          var par = M.flatColorsOf(this.data.settings.look || {}, null, []).pages.value;
          rows.push(K.check({ label: 'Same as All Screens', sub: 'Now ' + M.flatPagesName(par), on: own == null, fk: 'flatc:pages:inherit',
                              onClick: function () { pick(null); } }));
        }
        rows.push(K.check({ label: 'Follow Accent', sub: 'Every page in the Accent Color', on: on('accent'), fk: 'flatc:pages:accent',
                            onClick: function () { pick('accent'); } }));
        rows.push(K.check({ label: 'Keep Their Own Colors', sub: 'Climate blue, Lights yellow, Calendar purple…', on: on('own'), fk: 'flatc:pages:own',
                            onClick: function () { pick('own'); } }));
        c.appendChild(K.group({ footer: 'Pages like Climate and Lights have a color of their own (each page → Look → Highlight Color). Keep Their Own Colors leaves those pages in it, as Automatic does; Home and the rooms take the Accent Color either way. A page given Flat Colors of its own keeps them.' }, rows));
      }
      // the pages of a scope's routes: [] its Flat Colors, ['accent'], ['tint'],
      // ['page', key, ...] a page's
      p_flatColors(kind, x, b, sub, mk, backTo) {
        var self = this, page = sub[0] === 'page' && sub[1], key = page ? decodeURIComponent(sub[1]) : null, rest = page ? sub.slice(2) : sub;
        var sc = this.flatScope(page ? (kind === 'screen' ? 'screen-page' : 'house-page') : kind, x, b, key);
        var top = sc.page ? (sc.row ? sc.row.label : 'Page') : 'Flat Colors';
        var parent = sc.page ? (sc.row && sc.row.room && key !== 'rooms' ? ['Room Pages', sc.baseHref + '/page/rooms'] : ['Flat Colors', sc.baseHref]) : backTo;
        if (rest[0] === 'pages' && !sc.page) return mk('Pages', function (c) { self.flatPagesPick(c, sc); }, [top, sc.href]);
        if (rest[0] === 'accent' || rest[0] === 'tint') {
          return mk(rest[0] === 'accent' ? 'Accent Color' : 'Off Pill Tint', function (c) { self.flatColorsPick(c, sc, rest[0] === 'accent' ? 'accent' : 'off_tint'); }, [top, sc.href]);
        }
        var out = mk(top, function (c) { self.flatColorsPage(c, sc); }, parent);
        // A PAGE'S COLORS PREVIEW THAT PAGE (its address, as the strategy names it)
        var view = sc.page && sc.screen ? (FLAT_VIEW[key] || (key === 'rooms' ? null : key)) : null;
        if (view && out.preview) out.previewView = view;
        return out;
      }
      h_theme(c, t) {
        var self = this, sky = this.data.settings.sky, themes = sky.themes || [], on = themes.indexOf(t.id) >= 0;
        var built = (this.data.choices || {}).sky_built_in || {};
        c.appendChild(K.group({ footer: t.desc }, [K.toggle({ label: 'Show ' + t.label, sk: 'sky.themes:' + t.id, on: on,
          onChange: function (v) {
            var all = (self.data.choices || {}).themes || [];
            self.setH({ 'sky.themes': all.filter(function (x) { return x === t.id ? v : themes.indexOf(x) >= 0; }) });
          } })]));
        if (on) this.livelyGroup(c, t.id);
        if (t.id === 'birthday') { this.h_birthdays(c); return; }
        if (t.dates) {
          var from = M.skyDate(sky, built, t.dates, 'from'), to = M.skyDate(sky, built, t.dates, 'to');
          var rows = [this.dateRow('Starts', t.dates + '_from', from, false), this.dateRow('Ends', t.dates + '_to', to, t.dates === 'thanksgiving')];
          if (from.own || to.own) rows.push(K.button({ label: 'Reset to Default Dates', fk: 'sky:dates:reset', onClick: function () {
            var o = {}; o['sky.' + t.dates + '_from'] = null; o['sky.' + t.dates + '_to'] = null; self.setH(o);
          } }));
          c.appendChild(K.group({ header: 'Dates', footer: 'Default: ' + M.dateLabel(from.builtIn) + ' to ' + M.dateLabel(to.builtIn) +
            (t.id === 'spring-garden' || t.id === 'winter-wonderland' ? ', for your hemisphere.' : '.') }, rows.map(function (r, i) {
            return i < 2 ? self.withError(r, 'sky.' + t.dates + (i ? '_to' : '_from')) : r;
          })));
        }
        if (t.often) {
          var labels = M.OFTEN_LABELS[t.often] || {};
          // DAYS (it was "How Often"): which days it shows -- "often" is
          // Liveliness's word, for how often its crossers come by
          var often = [K.select({ label: 'Days', sk: 'sky.' + t.often, value: sky[t.often] || M.OFTEN_DEFAULT[t.often] || 'sometimes',
            options: Object.keys(labels).map(function (k) { return [k, labels[k]]; }),
            onChange: function (v) { var o = {}; o['sky.' + t.often] = v; self.setH(o); } })];
          if (t.extra) {
            var l2 = M.OFTEN_LABELS[t.extra];
            often.push(K.seg({ label: 'Spooky Nights', sub: 'A big moon, fog, bats and a witch', sk: 'sky.' + t.extra, stack: !self.hasAttribute('wide'),
              value: sky[t.extra] || 'sometimes', options: Object.keys(l2).map(function (k) { return [k, l2[k]]; }),
              onChange: function (v) { var o = {}; o['sky.' + t.extra] = v; self.setH(o); } }));
          }
          var ofoot = /_per_month$/.test(t.often) ? 'On its own fixed days each month, never the same day as the other.' :
            /^spring/.test(t.often) ? 'Sometimes is about one day in seven.' :
            /^winter/.test(t.often) ? 'Sometimes is about one day in eight.' :
            'Sometimes: some days, more often as the last day nears, and always the final days.';
          c.appendChild(K.group({ footer: ofoot }, often));
        }
      }
      dateRow(label, key, d, allowThanksgiving) {
        var self = this, cur = d.value, md = M.mmdd(cur);
        var monthSel = h('select', { 'aria-label': label + ' month', 'data-fk': 'date:' + key + ':m' });
        var opts = (allowThanksgiving ? [['thanksgiving', 'Thanksgiving Day']] : []).concat(M.MONTHS.map(function (m, i) {
          return [String(i + 1), m]; }));
        var curM = cur === 'thanksgiving' ? 'thanksgiving' : md ? String(md.month) : '';
        opts.forEach(function (o) { var e = h('option', { value: o[0], text: o[1] }); if (o[0] === curM) e.selected = true; monthSel.appendChild(e); });
        var daySel = h('select', { 'aria-label': label + ' day', 'data-fk': 'date:' + key + ':d' });
        for (var i = 1; i <= 31; i++) { var e = h('option', { value: String(i), text: String(i) }); if (md && md.day === i) e.selected = true; daySel.appendChild(e); }
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var commit = function () {
          var o = {};
          o['sky.' + key] = monthSel.value === 'thanksgiving' ? 'Thanksgiving Day' : pad(Number(monthSel.value)) + '-' + pad(Number(daySel.value));
          self.setH(o);
        };
        monthSel.addEventListener('change', commit);
        daySel.addEventListener('change', commit);
        var pop = function (sel, text) {
          return h('span', { class: 'pop' }, [h('span', { class: 'pv', text: text }), sel]);
        };
        var box = h('span', { class: 'dated' }, [pop(monthSel, curM === 'thanksgiving' ? 'Thanksgiving Day' : md ? M.MONTHS[md.month - 1].slice(0, 3) : '—')]);
        if (curM !== 'thanksgiving') box.appendChild(pop(daySel, md ? String(md.day) : '—'));
        return h('div', { class: 'cell', 'data-sk': 'sky.' + key }, [K.label(label, d.own ? null : 'Default'), box]);
      }
      h_birthdays(c) {
        var self = this, list = (this.data.settings.sky.birthdays || []).slice();
        var save = function (v) { self.setH({ 'sky.birthdays': v }); };
        var rows = list.map(function (b, i) {
          var rm = h('button', { class: 'lx rm', type: 'button', 'aria-label': 'Remove ' + b.name, 'data-fk': 'bd:rm:' + i });
          rm.appendChild(K.svg('<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="var(--hk-red)"/><path d="M6.5 11h9" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>'));
          rm.addEventListener('click', function () { save(list.filter(function (x, j) { return j !== i; })); });
          return h('div', { class: 'cell li' }, [rm, K.label(b.name), h('span', { class: 'val', text: M.MONTHS[b.month - 1] + ' ' + b.day })]);
        });
        if (!rows.length) rows.push(K.info({ label: 'No birthdays yet' }));
        c.appendChild(K.group({ header: 'Birthdays' }, rows));
        var nb = this._nb = this._nb || { name: '', month: '1', day: '1' };
        var nm = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'Name', maxlength: 40, 'data-fk': 'bd:name' });
        nm.value = nb.name;
        nm.addEventListener('input', function () { nb.name = nm.value; });
        var ms = h('select', { 'aria-label': 'Month', 'data-fk': 'bd:m' });
        M.MONTHS.forEach(function (m, i) { var o = h('option', { value: String(i + 1), text: m }); if (String(i + 1) === nb.month) o.selected = true; ms.appendChild(o); });
        ms.addEventListener('change', function () { nb.month = ms.value; });
        var ds = h('select', { 'aria-label': 'Day', 'data-fk': 'bd:d' });
        for (var i = 1; i <= 31; i++) { var o = h('option', { value: String(i), text: String(i) }); if (String(i) === nb.day) o.selected = true; ds.appendChild(o); }
        ds.addEventListener('change', function () { nb.day = ds.value; });
        var add = h('button', { class: 'pbtn', type: 'button', text: 'Add', 'data-fk': 'bd:add' });
        add.addEventListener('click', function () {
          if (!nb.name.trim()) { nm.focus(); self.announce('Enter a name.'); return; }
          save(list.concat({ name: nb.name.trim(), month: Number(nb.month), day: Number(nb.day) }));
          self._nb = null;
        });
        var box = h('div', { class: 'inl' }, [nm, ms, ds, add]);
        var g = K.group({ header: 'Add Birthday', footer: 'Balloons and confetti on the day.' }, []);
        g.querySelector('.cells').appendChild(box);
        c.appendChild(g);
        if (this.err('sky.birthdays')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('sky.birthdays') }));
      }
      h_skyAdvanced(c) {
        var self = this, sky = this.data.settings.sky, set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
        c.appendChild(K.group({ footer: 'Southern moves the default spring and winter dates by six months.' }, [
          K.seg({ label: 'Hemisphere', sk: 'sky.hemisphere', value: sky.hemisphere === 'south' ? 'south' : 'north',
                  options: [['north', 'Northern'], ['south', 'Southern']], onChange: set('sky.hemisphere') })]));
        c.appendChild(K.group({ header: 'Sources', footer: 'Optional. A holiday sensor’s state is Halloween, Thanksgiving or Christmas; the dates then only limit when the sky decorates. A moon sensor gives the phase from 0 to 1.' }, [
          this.entityRow({ label: 'Holiday Season', sk: 'sky.holidays', value: sky.holidays, none: 'From the Dates',
                           filter: { domains: ['sensor'] }, onPick: set('sky.holidays') }),
          this.entityRow({ label: 'Moon Phase', sk: 'sky.moon', value: sky.moon, none: 'Computed',
                           filter: { domains: ['sensor'] }, onPick: set('sky.moon') })]));
        c.appendChild(K.group({ header: 'Decorations Also Need', footer: 'Another on/off that must also be on for the decorations to show.' }, [
          this.entityRow({ label: 'Also Needs', sk: 'sky.seasonal', value: sky.seasonal, none: 'Nothing Else',
                           filter: { domains: ['input_boolean', 'switch'] }, onPick: set('sky.seasonal') })]));
      }
      // ALL SCREENS' MENU (2026-10-02): every menu setting, for every screen
      // that doesn't set its own; whether a screen has a menu -- a button, or
      // always open -- is each screen's.
      // ALL SCREENS -> MENU (2026-10-29): how people get around -- each
      // screen's menu, the three kinds of menu (each a page of everything
      // about it, with who uses it), and the rooms' one home
      h_menu(c) {
        var self = this, bd = this.data.boards || {};
        var titleOf = function (p) { var d = self.dash(p); return d ? d.title : p; };
        var rows = Object.keys(bd).filter(function (p) { return bd[p]; }).map(function (p) {
          return K.nav({ label: titleOf(p), value: M.menuWord(bd[p]), href: '#/screens/' + encodeURIComponent(p), fk: 'menu:screen:' + p });
        });
        if (rows.length) {
          c.appendChild(K.group({ header: 'Menu on Each Screen', sk: 'menu:screens',
            footer: 'On tablets and computers, then on phones. Each screen chooses its own, on its page.' }, rows));
        }
        c.appendChild(K.group({ header: 'Navigation', footer: 'Everything about each, for every screen that uses it.' },
          M.MENU_KINDS.map(function (k) {
            return K.nav({ label: k[1], value: M.usedBy(M.kindUsers(k[0], bd, titleOf)), href: '#/house/menu/' + k[0], sk: 'menu:' + k[0] });
          })));
        this.swipePagesGroup(c, null, null);
        c.appendChild(K.group({ header: 'In the Menu', footer: 'Which rooms the side menu and the tab bar’s More list show, and in what order.' }, [
          K.nav({ label: 'Rooms in the Menu', href: '#/house/rooms', sk: 'menu:rooms' })]));
        var hv = M.houseMenuAsBoard(this.data.settings.menu);
        c.appendChild(K.group({ header: 'Header', footer: 'The header on every page but Home. It sits with each screen’s other header settings.' }, [
          K.nav({ label: 'Back Button & Title', value: M.choiceLabel(M.PAGE_HEADERS, hv.page_header || 'current'), href: '#/house/menu/header', sk: 'menu.page_header' })]));
      }
    };
    KIT.install(Methods);
  };
})();
