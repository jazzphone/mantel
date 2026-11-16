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
    // THE DECORATIONS' TWO STYLES (sky.decoration_style), a menu at both levels (phase 33)
    var DECOR_STYLES = [['old', 'Old Decorations'], ['new', 'New Decorations']];
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // A SCREEN'S BACKGROUND (phase 33): the page All Screens' is, in the style the screen wears -- each row Same as All
      // Screens until it is this screen's own (bgPage)
      s_sky(c, x, b) {
        this.bgPage(c, this.bgPlace(x, b, this.flatHere(b), '#/screens/' + encodeURIComponent(x.path) + '/sky'));
      }
      // ...and its Advanced: the same for every screen (Hemisphere, the sources, the Sky Switch)
      s_skyAdvanced(c) {
        c.appendChild(K.group({ footer: 'These are the same for every screen.' }, []));
        this.h_skyAdvanced(c);
      }
      // A SCREEN'S SEASONAL DECORATIONS (phase 32, a page of their own): the switch, their style, and how lively they are -- each All Screens'
      // until it is this screen's own (phase 33: a switch set back to All Screens' follows it again; a menu's first choice)
      s_skyDecor(c, x, b) {
        var self = this, sky = this.data.settings.sky, rows = [], base = '#/screens/' + encodeURIComponent(x.path);
        var own = b.sky_decorations != null, house = sky.decorations !== false;
        rows.push(K.toggle({ label: 'Seasonal Decorations', sk: 'b:sky_decorations', on: own ? b.sky_decorations : house, sub: own ? 'Just This Screen' : 'Same as All Screens',
          onChange: function (v) { self.setB(x.path, { sky_decorations: v === house ? null : v }); } }));
        var dkey = 'sky_decoration_style', down = b[dkey] != null && b[dkey] !== '', dh = M.choiceLabel(DECOR_STYLES, sky.decoration_style || 'old');
        rows.push(K.select({ label: 'Decoration Style', sub: down ? 'Just This Screen' : 'Same as All Screens', sk: 'b:' + dkey, value: down ? b[dkey] : '',
          options: [['', 'Same as All Screens (' + dh + ')', dh]].concat(DECOR_STYLES), onChange: function (v) { self.setB(x.path, { sky_decoration_style: v || null }); } }));
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
            rows.push(K.toggle({ label: 'Calm When Nobody’s Around', sub: 'Half as much moving while ' + this.areaName(b.idle_room) +
                ' has been empty for 5 minutes', sk: 'b:sky_calm_empty', on: !!b.sky_calm_empty,
              onChange: function (v) { self.setB(x.path, { sky_calm_empty: v }); } }));
          }
        }
        c.appendChild(K.group({ footer: 'This screen follows All Screens until you change a setting here. Decorations use the dates and themes for All Screens.' }, rows));
      }
      // A PAGE SCREEN'S BACKDROP: for each of its pages, Same as All Screens,
      // its own sky, the live sky or a fixed backdrop -- one list, the page's
      // name over it
      pageBackdrops(c, x, b, pk) {
        var self = this, o = this.bgPlace(x, b, this.flatHere(b), '#/screens/' + encodeURIComponent(x.path) + '/sky');
        pk.rows.forEach(function (r) { self.bgPagePicker(c, o, r, pk.rows.length === 1); });
        this.skyResetGroup(c, x, b);
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
        return mode === 'photo' || mode === 'landscapes' || mode === 'live' || mode === 'wallpaper' ? M.BG_LABELS[mode] : this.flatColorLabel(mode, theme);
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
      // THE BACKGROUND, ONE SHAPE IN EVERY STYLE (phase 33, decision 7; the owner: "keep all background styles available
      // for all modes, including flat. Let the user decide here"). Every Background page -- All Screens', a screen's,
      // in the glass looks or in Flat -- is drawn from a PLACE: {x, b (a screen's; null All Screens'), flat (Flat's
      // own store: sky.flat_background, a screen's sky_flat_background, the pages' sky_flat_pages -- each style keeps
      // its own choice, so a house that set one background for Glass and another for Flat keeps both), base (the
      // page's address), mode (what it shows), ownMode (a screen's own, else null), sk(k), put(changes), whose(own)}
      bgPlace(x, b, flat, base) {
        var self = this, sky = this.data.settings.sky || {};
        var o = { x: x, b: b, flat: !!flat, base: base, title: 'Background' };
        o.modeKey = flat ? 'sky_flat_background' : 'sky_background';
        // a screen whose Live Sky was turned off (b.sky false) reads as Color: Black -- what it showed (the glass looks)
        o.legacyOff = !flat && !!b && b.sky === false;
        o.houseMode = (flat ? sky.flat_background || 'color' : sky.background) || 'live';
        o.ownMode = b ? (o.legacyOff ? 'color' : b[o.modeKey] || null) : null;
        o.mode = o.ownMode || o.houseMode;
        // a board's key (sky_*) as it is stored here: the screen's own, or All Screens' sky.*
        o.sk = function (k) { return b ? 'b:' + k : 'sky.' + (k === 'sky_custom' ? 'gradient_custom' : k.replace(/^sky_/, '')); };
        o.put = function (ch) {
          if (b) return self.setB(x.path, ch);
          var hc = {};
          Object.keys(ch).forEach(function (k) { if (k !== 'sky') hc[o.sk(k)] = ch[k]; });
          return self.setH(hc);
        };
        // WHOSE A VALUE IS, a screen's row subtitle (phase 33: the one idiom)
        o.whose = function (own) { return b ? (own ? 'Just This Screen' : 'Same as All Screens') : null; };
        return o;
      }
      // A BACKGROUND PAGE'S OWN ADDRESSES, the same under All Screens' and a screen's: the Colors (the live sky's,
      // `backdrop`; a still Color's, `color`), Adjust Photo (`photo`), and each page's, with its own Colors and Adjust
      // Photo. `mk(title, body, back)`; null for any other.
      bgRoute(sub, o, mk) {
        var self = this, back = [o.title, o.base];
        if (sub[0] === 'backdrop' || sub[0] === 'color') return mk('Colors', function (c) { self.bgColors(c, o, sub[0] === 'backdrop' ? 'live' : 'still', null); }, back);
        if (sub[0] === 'photo') return mk('Adjust Photo', function (c) { self.adjustPhoto(c, o, null); }, back);
        if (sub[0] !== 'page' || !sub[1]) return null;
        var key = decodeURIComponent(sub[1]), row = this.skyRow(key, o.b), page = o.base + '/page/' + encodeURIComponent(key);
        var pageBack = [row ? row.label : 'Page', page];
        if (sub[2] === 'color') return mk('Colors', function (c) { if (row) self.bgColors(c, o, 'still', row); }, pageBack);
        if (sub[2] === 'photo') return mk('Adjust Photo', function (c) { if (row) self.adjustPhoto(c, o, row); }, pageBack);
        return mk(row ? row.label : 'Page', function (c) {
          if (row) self.bgPagePicker(c, o, row);
          else c.appendChild(K.group({ footer: 'This page isn’t on ' + (o.b ? 'this screen' : 'any screen') + ', so it has no background to choose.' }, []));
        }, row && row.room && key !== 'rooms' ? ['Room Pages', o.base + '/page/rooms'] : back);
      }
      // THE PAGE: the five backgrounds, each with a picture; the chosen one's own settings; every page's background (at
      // both levels: every page and Rooms); Advanced; Reset Background...
      bgPage(c, o) {
        var self = this, sky = this.data.settings.sky || {}, b = o.b, x = o.x;
        var pk = this.skyPageKeys(b);
        if (b && pk.only && pk.only.keys.length) { this.bgPageScreen(c, o, pk); return; }
        var mode = o.mode, wall = (b && b.sky_wallpaper) || sky.wallpaper, wcol = (b && b.sky_wallpaper_color) || sky.wallpaper_color;
        var ground = this.flatTheme(b) === 'light' ? '#ECEAE5' : '#24252A';
        var rows = [K.previewPick({ label: 'Background', sub: o.whose(!!o.ownMode), sk: o.sk(o.modeKey), value: mode, options: M.SKY_BACKGROUNDS,
          // (Flat's Color: one solid color, its theme's ground)
          picture: function (v, w, ht) { return o.flat && v === 'color' ? self.bgKindThumb('solid', w, ht, null, ground) : self.bgKindThumb(v, w, ht, wall, null, wcol); },
          onChange: function (v) {
            var ch = {};
            ch[o.modeKey] = v;
            if (!o.flat) { ch.sky = true; if (o.legacyOff && v === 'color' && !b.sky_color) ch.sky_color = 'black'; }
            o.put(ch);
          } })];
        // (a Color: which one, on the Colors page)
        if (mode === 'color') rows.push(this.bgColorNav(o));
        var says = o.flat ? { color: 'A solid color behind the cards, in its Light or Dark tone.', photo: 'A photo of your own, still, faded behind the cards.',
                              landscapes: 'One of ' + PN() + '’s landscape photos, still, faded behind the cards.' } : {};
        var foot = [says[mode] || M.BG_SAYS[mode]];
        if (!b) foot.push('Each screen, and each page, can choose its own.');
        if (o.legacyOff) foot.push('This screen’s Live Sky was turned off, so it shows Black.');
        var skySw = (this.data.settings.look || {}).sky_switch;
        if (b && mode === 'live' && x.generated && skySw) foot.push('It also follows ' + this.name(skySw) + ' (Advanced → Sky Switch).');
        if (b && !x.generated) foot.push('A screen written in YAML shows it wherever its YAML puts the sky.');
        c.appendChild(K.group({ footer: foot.join(' ') }, rows));
        if (mode === 'live') this.liveSkyGroups(c, o);
        else if (mode === 'photo') this.bgPhotoGroup(c, o);
        else if (mode === 'landscapes') this.bgLandscapeGroup(c, o);
        else if (mode === 'wallpaper') this.bgWallpaperGroup(c, o);
        this.bgPagesGroup(c, o, pk, 'Pages');
        this.bgEnd(c, o);
      }
      // A PAGE SCREEN (no Home page): its pages' backgrounds first, then the Live Sky's settings while any of them shows it
      bgPageScreen(c, o, pk) {
        var self = this, now = pk.rows.map(function (r) { return { r: r, n: self.bgPageNow(o, r) }; });
        var live = now.filter(function (e) { return e.n.mode === 'live' || (!e.n.mode && (o.flat ? !FLAT_OWN[e.r.key] && o.mode === 'live' : e.n.live)); });
        this.bgPagesGroup(c, o, pk, 'This Screen’s Pages', live.length
          ? 'The Live Sky settings below reach ' + live.map(function (e) { return e.r.label; }).join(' and ') + '.' + (live.length < now.length ? ' The rest keep their own background.' : '')
          : 'This screen has no Home page. Each page’s background is chosen here.');
        if (live.length) this.liveSkyGroups(c, o);
        this.bgEnd(c, o);
      }
      // THE BACKGROUND'S COLOR, a tap away (the Colors page): the glass looks' still colors, Flat's tones
      bgColorNav(o) {
        var sky = this.data.settings.sky || {}, b = o.b, own, value;
        if (o.flat) { own = b ? b.sky_flat_color : null; value = this.flatColorLabel(own || sky.flat_color || 'auto', this.flatTheme(b)); }
        else { own = b ? (o.legacyOff ? b.sky_color || 'black' : b.sky_color) : null; value = this.backdropLabel(own || sky.color || 'midnight'); }
        return K.nav({ label: 'Color', value: value, sub: o.whose(!!own), href: o.base + '/color', sk: o.sk(o.flat ? 'sky_flat_color' : 'sky_color') });
      }
      bgPhotoGroup(c, o) {
        var self = this, sky = this.data.settings.sky || {}, b = o.b, x = o.x, extra = [this.adjustPhotoNav(o, null)];
        var says = 'Shown on Home, the room pages, and every page without a background of its own.';
        this.photoGroup(c, b ? { url: b.sky_photo || null, from: sky.photo || null, fromLabel: 'All Screens’ photo', fk: 'bphoto', sk: 'b:sky_photo', footer: says, extra: extra,
                                 onSet: function (url) {
                                   var was = b.sky_photo, ch = { sky_photo: url };
                                   if (!o.flat) ch.sky = true;
                                   self.setB(x.path, ch).then(function (ok) { if (ok) self.photoForget(was); });
                                 } }
                             : { url: sky.photo || null, fk: 'hphoto', sk: 'sky.photo', footer: says + ' Each screen can use a photo of its own.', extra: extra,
                                 onSet: function (url) { var was = sky.photo; self.setH({ 'sky.photo': url }).then(function (ok) { if (ok) self.photoForget(was); }); } });
      }
      bgLandscapeGroup(c, o) {
        var sky = this.data.settings.sky || {}, b = o.b, extra = [this.adjustPhotoNav(o, null)];
        var says = 'Shown on Home, the room pages, and every page without a background of its own.';
        this.landscapeGroup(c, b ? { value: b.sky_landscape || null, house: sky.landscape || 'every:1440', fk: 'bland', sk: 'b:sky_landscape', href: o.base + '/landscape',
                                     footer: says, extra: extra, onSet: function (v) { var ch = { sky_landscape: v }; if (!o.flat) ch.sky = true; o.put(ch); } }
                                 : { value: sky.landscape || 'every:1440', fk: 'hland', sk: 'sky.landscape', href: '#/house/appearance/sky/landscape',
                                     footer: says + ' Each screen can choose its own.', extra: extra, onSet: function (v) { o.put({ sky_landscape: v }); } });
      }
      bgWallpaperGroup(c, o) {
        var sky = this.data.settings.sky || {}, b = o.b, says = 'Shown on Home, the room pages, and every page without a background of its own.';
        var put = function (ch) { if (b && !o.flat) ch.sky = true; return o.put(ch); };
        this.wallpaperGroup(c, b ? { value: b.sky_wallpaper || null, house: sky.wallpaper || 'ribbons', night: b.sky_wallpaper_night || null,
                                     nightHouse: sky.wallpaper_night || 'auto', fk: 'bwall', sk: 'b:sky_wallpaper',
                                     motion: b.sky_wallpaper_motion || null, motionHouse: sky.wallpaper_motion || 'off',
                                     color: b.sky_wallpaper_color || null, colorHouse: sky.wallpaper_color || 'blue', footer: says,
                                     onMotion: function (v) { o.put({ sky_wallpaper_motion: v }); }, onColor: function (v) { o.put({ sky_wallpaper_color: v }); },
                                     onSet: function (v, motion) { var ch = { sky_wallpaper: v }; if (motion) ch.sky_wallpaper_motion = motion; put(ch); },
                                     onNight: function (v) { o.put({ sky_wallpaper_night: v }); } }
                                 : { value: sky.wallpaper || 'ribbons', night: sky.wallpaper_night || 'auto', fk: 'hwall', sk: 'sky.wallpaper',
                                     footer: says + ' Each screen can choose its own.',
                                     motion: sky.wallpaper_motion || 'off', onMotion: function (v) { o.put({ sky_wallpaper_motion: v }); },
                                     color: sky.wallpaper_color || 'blue', onColor: function (v) { o.put({ sky_wallpaper_color: v }); },
                                     onSet: function (v, motion) { var ch = { sky_wallpaper: v }; if (motion) ch.sky_wallpaper_motion = motion; put(ch); },
                                     onNight: function (v) { o.put({ sky_wallpaper_night: v }); } });
      }
      // THE LIVE SKY'S SETTINGS, the same rows at both levels (phase 33: menus where a screen's had segments, the same
      // subtitles). On a screen each row says whose it is; a switch set back to All Screens' value follows it again, a
      // menu's first choice is "Same as All Screens (Classic)".
      liveSkyGroups(c, o) {
        var sky = this.data.settings.sky || {}, b = o.b, rows = [];
        var says = function (own, text) { return b ? o.whose(own) + ' · ' + text : text; };
        var isOn = function (name) { var k = 'sky_' + name; return b && b[k] != null ? b[k] : sky[name] !== false; };
        var toggle = function (name, label, text) {
          var k = 'sky_' + name, own = !!b && b[k] != null, house = sky[name] !== false;
          rows.push(K.toggle({ label: label, sub: says(own, text), sk: o.sk(k), on: own ? b[k] : house,
            onChange: function (v) { var ch = {}; ch[k] = b && v === house ? null : v; o.put(ch); } }));
        };
        var menu = function (name, label, text, opts, dflt) {
          var k = 'sky_' + name, own = !!b && b[k] != null && b[k] !== '', house = sky[name] || dflt, hl = M.choiceLabel(opts, house);
          rows.push(K.select({ label: label, sub: says(own, text), sk: o.sk(k), value: b ? (own ? b[k] : '') : house,
            options: (b ? [['', 'Same as All Screens (' + hl + ')', hl]] : []).concat(opts),
            onChange: function (v) { var ch = {}; ch[k] = v || null; o.put(ch); } }));
        };
        // Pause When Not in Focus and Moving Things only while anything moves, Rain & Snow only while there is weather
        // to fall (2026-10-10)
        var moving = isOn('animations');
        toggle('animations', 'Animations', 'Drifting clouds, falling rain and snow, the seasons');
        if (moving) {
          toggle('focus_pause', 'Pause When Not in Focus', 'On a computer, while another window is in front');
          menu('moving', 'Moving Things', 'Rain, snow, leaves, birds and confetti', M.SKY_MOVING, 'behind');
        }
        toggle('weather', 'Weather', 'Clouds, rain, snow and fog');
        if (isOn('weather')) toggle('precipitation', 'Rain & Snow', moving ? 'Off, the clouds and fog still move' : 'Not shown while Animations are off');
        menu('cloud_style', 'Clouds', 'Classic haze or photographic clouds', M.CLOUD_STYLES, 'classic');
        menu('daytime', 'Daytime Sky', 'How bright the daytime blue runs', M.DAYTIME_SKIES, 'natural');
        var gOwn = !!b && b.sky_gradient != null;
        rows.push(K.nav({ label: 'Colors', sub: says(gOwn, 'The live sky’s own colors'), sk: o.sk('sky_gradient'), href: o.base + '/backdrop',
                          value: this.backdropLabel(gOwn ? b.sky_gradient : sky.gradient) }));
        var dOwn = !!b && b.sky_decorations != null, decOn = dOwn ? b.sky_decorations : sky.decorations !== false;
        rows.push(K.nav({ label: 'Seasonal Decorations', sub: says(dOwn, 'Holidays, seasons and occasions'), sk: o.sk('sky_decorations'),
                          href: (b ? o.base : '#/house/appearance/sky') + '/decorations', value: decOn ? (sky.themes || []).length + ' On' : 'Off' }));
        c.appendChild(K.group({ header: 'Live Sky', footer: 'Animations off also stops a running fan’s icon spinning and hides falling rain and snow.' +
          (b ? ' This screen follows All Screens until you change a setting here.' : ' Each screen can choose its own.') }, rows));
      }
      // A PAGE'S BACKGROUND NOW, in this place's style: {mode (its own, else All Screens'), own, live, label}
      bgPageNow(o, r) {
        if (o.flat) {
          var f = this.flatPageNow(r, o.b);
          return { mode: f.mode, own: f.own, live: f.mode === 'live', label: f.mode ? this.flatModeLabel(f.mode, this.flatTheme(o.b)) : this.flatAutoLabel(r) };
        }
        var n = this.skyPageNow(r, o.b);
        return { mode: n.mode, own: n.own, live: n.live, label: n.mode ? M.skyModeLabel(n.mode, (this.data.choices || {}).sky_backdrops || []) : M.skyAutoLabel(r) };
      }
      // EVERY PAGE AND ROOMS, at both levels (phase 33: All Screens' listed Timeline and Room Pages alone)
      bgPagesGroup(c, o, pk, header, footer) {
        var self = this, b = o.b, sk = o.sk(o.flat ? 'sky_flat_pages' : 'sky_pages');
        if (!pk.rows.length) return;
        c.appendChild(K.group({ header: header, sk: sk, footer: footer || 'Each page’s background: Automatic (' + (o.flat ? 'its own tone' : 'its own sky') +
            ', or the Background above), or one of its own.' + (b ? ' A page left alone follows All Screens.' : ' Each screen can choose its own.') },
          pk.rows.map(function (r) {
            var n = self.bgPageNow(o, r);
            var sub = [r.custom ? 'Custom page' : null, b ? o.whose(n.own) : null].filter(Boolean).join(' · ') || null;
            return K.nav({ label: r.label, sub: sub, value: n.label, href: o.base + '/page/' + encodeURIComponent(r.key), sk: sk + ':' + r.key });
          })));
      }
      // THE PAGE'S LAST ROWS: (All Screens) the other style's own Background, which a screen wearing it follows;
      // Advanced; Reset Background...
      bgEnd(c, o) {
        var self = this, sky = this.data.settings.sky || {};
        if (!o.b) {
          var houseFlat = this.flatHere(null), boards = this.data.boards || {};
          var others = o.flat !== houseFlat ? [] : Object.keys(boards).filter(function (p) { return boards[p] && self.flatHere(boards[p]) !== houseFlat; });
          if (others.length) {
            var names = others.map(function (p) { var d = self.dash(p); return d ? d.title : p; });
            c.appendChild(K.group({ footer: names.join(', ') + (others.length > 1 ? ' wear ' : ' wears ') + (houseFlat ? 'a glass look' : 'Flat') +
                ', which keeps a background of its own.' }, [
              K.nav({ label: houseFlat ? 'For Screens Using Glass' : 'For Screens Using Flat', sk: houseFlat ? 'sky.background' : 'sky.flat_background',
                      value: houseFlat ? M.BG_LABELS[sky.background || 'live'] : this.flatSummary(null), href: '#/house/appearance/sky/' + (houseFlat ? 'glass' : 'flat') })]));
          }
        }
        c.appendChild(K.group({}, [K.nav({ label: 'Advanced', sub: 'Hemisphere, sources, the Sky Switch', href: o.base + '/advanced', fk: 'sky:advanced' })]));
        this.skyResetGroup(c, o.x, o.b);
      }
      // COLORS (phase 33: Sky Colors and Background -> Color, one picker): the live sky's own colors (`live`: Live Sky
      // first), the Background's still Color, or a page's (`r`) -- the same seventeen; Flat's Color its tones
      bgColors(c, o, which, r) {
        var self = this, sky = this.data.settings.sky || {}, b = o.b;
        if (r) { this.bgPageColors(c, o, r); return; }
        var custom = b ? (b.sky_custom || sky.gradient_custom) : sky.gradient_custom, scope = b ? 'b:sky_custom:' + o.x.path : 'sky.gradient_custom';
        var startCustom = function (ch, id) { if (id === 'custom' && !(b ? b.sky_custom : sky.gradient_custom)) ch.sky_custom = sky.gradient_custom || self.dusk(); return ch; };
        if (which === 'still' && o.flat) {
          this.flatColorGroup(c, { id: b ? (b.sky_flat_color || null) : (sky.flat_color || 'auto'), follow: b ? ['Same as All Screens', sky.flat_color || 'auto'] : null,
            auto: true, theme: this.flatTheme(b), fk: b ? 'bflat:' : 'hflat:', header: null, onPick: function (id) { o.put({ sky_flat_color: id }); } });
          return;
        }
        if (which === 'still') {
          this.colorGroup(c, { id: b ? (o.legacyOff ? b.sky_color || 'black' : b.sky_color || null) : sky.color || 'midnight',
            follow: b ? ['Same as All Screens', sky.color || 'midnight'] : null, custom: custom, scope: scope, fk: b ? 'bcolor:' : 'hcolor:', header: null,
            footer: 'A still color behind the cards, the top of the screen to the bottom: its day colors while the sun is up, its night ones after.',
            onPick: function (id) {
              var ch = startCustom({ sky_color: id }, id);
              if (b) ch.sky = true;
              if (o.legacyOff) ch.sky_background = 'color';
              o.put(ch);
            },
            onCustom: function (v) { o.put({ sky_custom: v }); } });
          return;
        }
        // (a page screen's live sky is its pages': each one's, here)
        var pk = this.skyPageKeys(b);
        if (b && pk.only && pk.only.keys.length) { this.pageBackdrops(c, o.x, b, pk); return; }
        this.colorGroup(c, { live: true, id: b ? (b.sky_gradient == null ? null : b.sky_gradient) : sky.gradient || 'live',
          follow: b ? ['Same as All Screens', sky.gradient || 'live'] : null, custom: custom, scope: scope, fk: b ? 'bbackdrop:' : 'hbackdrop:', header: null,
          footer: 'The live sky’s colors on Home, the room pages, Weather and Calendar. Its weather, decorations and animations still show over it.' +
            (b ? '' : ' Each screen can choose its own.'),
          onPick: function (id) { o.put(b && id == null ? M.backdropFollow(b) : startCustom({ sky_gradient: id }, id)); },
          onCustom: function (v) { o.put({ sky_custom: v }); } });
      }
      // EACH PAGE'S OWN, in this place's style: {mine (here), all (All Screens'), key, pick(page, id | '')}
      bgPageMap(o) {
        var self = this, sky = this.data.settings.sky || {}, b = o.b, key = o.flat ? 'sky_flat_pages' : 'sky_pages';
        var all = (o.flat ? sky.flat_pages : sky.pages) || {}, mine = b ? b[key] || {} : all;
        return { mine: mine, all: all, key: key, pick: function (k, id) {
          var next = Object.assign({}, mine), ch = {};
          if (id) next[k] = id; else delete next[k];
          ch[key] = next;
          if (!o.flat && id === 'custom' && !(b ? b.sky_custom : sky.gradient_custom)) ch.sky_custom = sky.gradient_custom || self.dusk();
          if (b && !o.flat) ch.sky = true;
          return o.put(ch);
        } };
      }
      bgPageColors(c, o, r) {
        var sky = this.data.settings.sky || {}, b = o.b, pm = this.bgPageMap(o), cur = pm.mine[r.key] || null;
        var pick = function (id) { pm.pick(r.key, id); };
        if (o.flat) { this.flatColorGroup(c, { id: cur, theme: this.flatTheme(b), fk: 'fpbd:' + r.key + ':', header: null, onPick: pick }); return; }
        this.colorGroup(c, { id: cur, custom: b ? (b.sky_custom || sky.gradient_custom) : sky.gradient_custom, fk: 'pbd:' + r.key + ':', header: null,
          scope: b ? 'b:sky_custom:' + o.x.path : 'sky.gradient_custom', onPick: pick, onCustom: function (v) { o.put({ sky_custom: v }); } });
      }
      // ONE PAGE'S BACKGROUND (2026-10-13; phase 33: the same choices in every style). What it follows first ("Same as
      // All Screens (Photo)", "Same as Room Pages (Live Sky)") or Automatic, its own sky (the glass looks' pages that have
      // one), then the five; under it, the chosen one's own: its Color, its Photo, Adjust Photo. Stored as before (the
      // glass looks' {page: 'own' | 'live' | a color id | 'photo' | 'landscapes' | 'wallpaper'}, Flat's {page: 'auto' |
      // a Flat color | ...}); a page's own photo in page_photos. `alone`: the screen's only page.
      bgPagePicker(c, o, r, alone) {
        var self = this, sky = this.data.settings.sky || {}, b = o.b, flat = o.flat, theme = this.flatTheme(b), bds = (this.data.choices || {}).sky_backdrops || [];
        var pm = this.bgPageMap(o), all = pm.all, cur = pm.mine[r.key] || '', p = flat ? 'fpbd:' : 'pbd:';
        var photos = b ? (b.sky_page_photos || {}) : (sky.page_photos || {}), page = o.base + '/page/' + encodeURIComponent(r.key);
        var kinds = { own: 1, auto: 1, live: 1, photo: 1, landscapes: 1, wallpaper: 1 }, isColor = !!cur && !kinds[cur];
        var pick = function (id) { pm.pick(r.key, id); };
        var label = function (m) { return flat ? self.flatModeLabel(m, theme) : M.skyModeLabel(m, bds); };
        var roomsNow = (b && pm.mine.rooms) || all.rooms;
        var follow = b && all[r.key] ? 'Same as All Screens (' + label(all[r.key]) + ')'
                   : r.room ? 'Same as Room Pages (' + (roomsNow ? label(roomsNow) : 'Automatic') + ')' : null;
        var autoSays = !flat ? (r.own ? 'Its own sky' : r.custom ? 'As written' : 'The screen’s Background')
          : FLAT_OWN[r.key] ? (M.PAGE_ACCENTS[r.key] ? 'A light or dark shade of its Accent Color (' + M.pageAccentOf(r.key, this.hs('look.page_accents')).a.name + ')'
                                                     : 'Its own tone, in Light and Dark')
          : 'The screen’s Background (' + this.flatSummary(b) + ')';
        var rows = [];
        if (follow) rows.push(K.check({ label: follow, on: !cur, fk: p + r.key + (flat ? ':follow' : ':auto'), onClick: function () { pick(''); } }));
        // (Flat stores Automatic of its own, over what it follows; the glass looks' Automatic is what it follows)
        if (!follow || flat) {
          rows.push(K.check({ label: 'Automatic', sub: autoSays, on: follow ? cur === 'auto' : !cur || cur === 'auto', fk: p + r.key + ':auto',
                              tile: flat ? ['mdi:auto-fix', C.green] : null, onClick: function () { pick(follow ? 'auto' : ''); } }));
        }
        if (!flat && r.own) rows.push(K.check({ label: 'Its Own Sky', sub: 'The page’s own colors', on: cur === 'own', fk: p + r.key + ':own',
                                                tile: ['mdi:palette-swatch', C.green], onClick: function () { pick('own'); } }));
        rows.push(K.check({ label: 'Live Sky', sub: 'The moving sky, with ' + (b ? 'this screen’s' : 'All Screens’') + ' weather and decorations', on: cur === 'live',
                            fk: p + r.key + ':live', tile: ['mdi:weather-sunset', C.blue], onClick: function () { pick('live'); } }));
        var startColor = flat ? (b && b.sky_flat_color && b.sky_flat_color !== 'auto' && b.sky_flat_color) || (sky.flat_color !== 'auto' && sky.flat_color) || 'stone'
                              : (b && b.sky_color) || sky.color || 'midnight';
        rows.push(K.check({ label: 'Color', sub: isColor ? label(cur) : flat ? 'A solid color' : 'A still color', on: isColor, fk: p + r.key + ':color',
                            tile: ['mdi:palette', C.purple], onClick: function () { if (!isColor) pick(startColor); } }));
        rows.push(K.check({ label: 'Photo', sub: photos[r.key] ? 'Its own photo' : 'A photo, still', on: cur === 'photo', fk: p + r.key + ':photo',
                            tile: ['mdi:image', C.orange], onClick: function () { pick('photo'); } }));
        rows.push(K.check({ label: 'Landscapes', sub: PN() + '’s own photos, as ' + (b ? 'the screen' : 'All Screens') + ' has them', on: cur === 'landscapes',
                            fk: p + r.key + ':landscapes', tile: ['mdi:image-filter-hdr', C.teal], onClick: function () { pick('landscapes'); } }));
        // (2026-10-30) the screen's Wallpaper
        var wn = window.hkWallpapers, wid = (b && b.sky_wallpaper) || sky.wallpaper || 'ribbons', wcol = (b && b.sky_wallpaper_color) || sky.wallpaper_color;
        rows.push(K.check({ label: 'Wallpaper', sub: 'Our own art, as ' + (b ? 'the screen' : 'All Screens') + ' has it', on: cur === 'wallpaper',
                            fk: p + r.key + ':wallpaper', tile: ['mdi:wallpaper', wn ? 'center / cover url("' + wn.url(wid, false, wcol) + '")' : C.purple],
                            onClick: function () { pick('wallpaper'); } }));
        c.appendChild(K.group({ header: alone === false ? r.label : null, footer: (alone ? r.label + ' is this screen’s only page, so its background is the screen’s. ' : '') +
          (!flat && r.own ? 'Its Own Sky, ' : '') + 'Color, Photo, Landscapes and Wallpaper are still: no sun, moon, stars, weather or decorations.' }, rows));
        // ITS OWN: the Color, a tap away; its Photo; Adjust Photo wherever a photo or a landscape shows (in Flat, a page's
        // own treatment reaches the screen's photo too)
        var inherited = !cur ? (b && all[r.key]) || (r.room && roomsNow) || null : null;
        var shows = cur && cur !== 'auto' ? cur : inherited && inherited !== 'auto' ? inherited : flat && FLAT_OWN[r.key] ? 'color' : flat ? o.mode : null;
        if (isColor) c.appendChild(K.group({}, [K.nav({ label: 'Color', value: label(cur), href: page + '/color', sk: o.sk(pm.key) + ':' + r.key + ':color' })]));
        if (cur === 'photo') {
          var lvl = (r.room && photos.rooms) || (b ? (b.sky_photo || sky.photo) : sky.photo);
          this.photoGroup(c, { url: photos[r.key] || null, from: lvl || null,
            fromLabel: r.room && photos.rooms ? 'Room Pages’ photo' : b ? 'the screen’s photo' : 'All Screens’ photo',
            fk: 'pphoto:' + r.key, sk: b ? 'b:sky_page_photos' : 'sky.page_photos', header: 'Its Photo', extra: [this.adjustPhotoNav(o, r)],
            footer: 'Without a photo of its own, the page shows ' + (r.room ? 'Room Pages’ photo, else ' : '') + (b ? 'the screen’s' : 'All Screens’') + ' Background photo.',
            onSet: function (url) {
              var was = photos[r.key], next = Object.assign({}, photos);
              if (url) next[r.key] = url; else delete next[r.key];
              o.put({ sky_page_photos: next }).then(function (ok) { if (ok) self.photoForget(was); });
            } });
        } else if (cur === 'landscapes' || (flat && (shows === 'photo' || shows === 'landscapes'))) c.appendChild(K.group({}, [this.adjustPhotoNav(o, r)]));
        // ITS PAGE COLOR, beside its background (the same page key; Flat Colors before phase 33)
        if (flat) {
          c.appendChild(K.group({ footer: 'Its Page Color shades an Automatic background here.' },
            [this.pageColorNav(r.key, b, (b ? '#/screens/' + encodeURIComponent(o.x.path) : '#/house/appearance') + '/page-colors/' + encodeURIComponent(r.key))]));
        }
        // ROOM PAGES: each room's own, a tap away (also in its Room Settings)
        if (r.key === 'rooms') {
          var rrows = this.areasAZ().map(function (aid) {
            var k = self.roomKey(aid);
            if (!k) return null;
            var n = self.bgPageNow(o, { key: k, room: true });
            return K.nav({ label: self.areaName(aid), icon: ((self.client.areas || {})[aid] || {}).icon || 'mdi:texture-box',
                           value: n.own ? n.label : 'Same as Room Pages', href: o.base + '/page/' + encodeURIComponent(k), sk: o.sk(pm.key) + ':' + k });
          }).filter(Boolean);
          if (rrows.length) c.appendChild(K.group({ header: 'Each Room', footer: 'A room left alone is the same as Room Pages. A photo of the room itself, say, behind its page.' }, rrows));
        }
      }
      // ADJUST PHOTO's ROW, under a photo or a landscape: the starting point's name (Balanced, Off ...)
      adjustPhotoNav(o, r) {
        var I = window.hkFlatImage, sky = this.data.settings.sky || {}, b = o.b, value = null, own = false;
        if (I) {
          var keys = r ? (/^room-/.test(r.key) ? [r.key, 'rooms'] : [r.key]) : [];
          value = this.photoStarts(o.flat)[I.preset(o.flat ? I.resolve(sky, b, keys).value : I.resolveGlass(sky, b).value)];
        }
        if (b && !r) {
          var has = function (v) { return !!v && Object.keys(v).length > 0; };
          own = o.flat ? has(b.sky_flat_image_look) || ['sky_flat_fade', 'sky_flat_tint', 'sky_flat_tint_amount', 'sky_flat_tint_light'].some(function (k) { return b[k] != null; })
                       : has(b.sky_image_look) || !!b[o.mode === 'landscapes' ? 'sky_landscape_look' : 'sky_photo_look'];
        }
        return K.nav({ label: 'Adjust Photo', value: value, sub: r ? null : o.whose(own),
                       href: o.base + (r ? '/page/' + encodeURIComponent(r.key) : '') + '/photo', fk: 'sky:adjust' + (r ? ':' + r.key : '') });
      }
      // the starting points by name (hkFlatImage.preset's): 'legacy' is Flat's Previous Look, the glass looks' Off
      photoStarts(flat) {
        return { legacy: flat ? 'Previous Look' : 'Off', original: 'Original', soft: 'Soft', balanced: 'Balanced', rich: 'Rich', washed: 'Washed', custom: 'Custom' };
      }
      // ADJUST PHOTO (phase 33, decision 8; the owner: "it seems like we may lose functionality here? So please be
      // cautious, to make sure that - especially for the image/photo presets, it is retained"). One page for a photo or
      // a landscape -- the Background's (r null) or a page's own -- with every control its three treatments had, the
      // same stored keys, nothing converted:
      //   Starting Point -- Image Look's (Off, or Flat's Previous Look; Original, Soft, Balanced, Rich, Washed; Custom
      //     once adjusted), each with its picture; first, on a screen or a page, what it follows
      //   Adjust -- the starting point's own sliders (Strength, Depth, Brightness, Fade) over a live preview; under
      //     Flat's Previous Look, its older Fade
      //   Blur & Dim -- the glass looks' photo Look (photo_look / landscape_look / a page's page_looks)
      //   Color -- the starting point's Color and Tint Color; the glass looks' Saturation, Color Tint and Tint Strength;
      //     Flat's older Tint, Tint Color, Tint Strength and Tint Brightness while Previous Look is in use
      // Image Look is Flat's (sky.flat_image_look, a screen's, a page's: hkFlatImage.resolve) or the glass looks'
      // (sky.image_look, a screen's: resolveGlass -- the screen's for every photo on it, a page's too). Opening it
      // writes nothing; a patch keeps the fields it doesn't name.
      adjustPhoto(c, o, r) {
        var self = this, I = window.hkFlatImage, sky = this.data.settings.sky || {}, b = o.b, x = o.x, glass = !o.flat;
        if (!I) { c.appendChild(K.group({}, [K.info({ label: 'Loading…', value: '' })])); return; }
        var key = r && !glass ? r.key : null, keys = key ? (/^room-/.test(key) ? [key, 'rooms'] : [key]) : [];
        var resolved = glass ? I.resolveGlass(sky, b) : I.resolve(sky, b, keys), look = resolved.value;
        var field = glass ? 'sky_image_look' : key ? 'sky_flat_page_image_looks.' + key : 'sky_flat_image_look';
        var path = b ? field : 'sky.' + field.replace(/^sky_/, '');
        var own = glass ? (b ? b.sky_image_look : sky.image_look) || {}
                  : key ? ((b ? b.sky_flat_page_image_looks : sky.flat_page_image_looks) || {})[key] || {}
                      : (b ? b.sky_flat_image_look : sky.flat_image_look) || {};
        var patchPath = key ? path : path + '.patch';
        var patch = function (value) { var ch = {}; ch[patchPath] = value; return b ? self.setB(x.path, ch) : self.setH(ch); };
        var source = function (name) { return M.flatSourceLabel(resolved.from[name]) || 'Built-in Default'; };
        // WHAT IT FOLLOWS (its "Same as ..."): the look resolved again without this place's own
        var parent = null, follows = null;
        if (b || key) {
          var S2 = JSON.parse(JSON.stringify(sky)), B2 = b ? JSON.parse(JSON.stringify(b)) : null;
          if (glass) B2.sky_image_look = {};
          else if (key) delete ((b ? B2.sky_flat_page_image_looks : S2.flat_page_image_looks) || {})[key];
          else B2.sky_flat_image_look = {};
          var pr = glass ? I.resolveGlass(S2, B2) : I.resolve(S2, B2, keys);
          parent = pr.value;
          follows = M.flatSourceLabel(pr.from.mode) || (key && /^room-/.test(key) ? 'Room Pages' : 'All Screens');
          if (follows === 'This Screen' && !b) follows = 'All Screens';
        }
        var labels = this.photoStarts(!glass), active = I.preset(look);
        var notes = { legacy: glass ? 'The photo as it is, with Blur & Dim below.' : 'Your previous look: the Fade and Tint below.', original: 'Keep the photograph’s colors.',
          soft: 'Quiet color and gentle shadows.', balanced: 'Clear scenery with a moderate tint.', rich: 'Deeper shadows and richer color.', washed: 'A faint backdrop behind the cards.' };
        var legacyTint = glass ? 'none' : (b && b.sky_flat_tint) || sky.flat_tint || 'none';
        var choose = function (name) {
          var v = name === 'original' || name === 'legacy' ? { mode: name } : Object.assign({}, I.presets[name]);
          if (resolved.from.color.scope === 'default' && /^#/.test(legacyTint)) v.color = legacyTint;
          patch(v);
        };
        // THE PICTURE IT IS PREVIEWED ON: this place's photo or landscape, else a sample landscape
        var palette = M.flatColorsOf(this.data.settings.look || {}, b, keys);
        var seed = M.flatColorHex(palette.accent.value);
        var menuAccent = b ? b.accent : (this.data.settings.menu || {}).accent;
        var legacyAccent = menuAccent === 'auto' ? M.pageAccentOf(key || 'home', (this.data.settings.look || {}).page_accents).a.hex : M.accentOf(menuAccent).hex;
        var color = look.color === 'accent' ? seed || legacyAccent : look.color;
        var theme = glass ? 'dark' : this.flatTheme(b), list = this.landscapes() || [];
        var landscape = M.landscapeFile((b && b.sky_landscape) || sky.landscape || 'every:1440', list);
        var photos = b && b.sky_page_photos || {}, housePhotos = sky.page_photos || {}, pageMode = null, photo = null, rkeys = r ? (r.room ? [r.key, 'rooms'] : [r.key]) : [];
        var pmap = glass ? 'sky_pages' : 'sky_flat_pages', hmap = glass ? 'pages' : 'flat_pages';
        rkeys.some(function (k) { pageMode = (b && b[pmap] || {})[k] || (sky[hmap] || {})[k]; return !!pageMode; });
        rkeys.some(function (k) { photo = photos[k] || housePhotos[k]; return !!photo; });
        var mode = pageMode && pageMode !== 'auto' ? pageMode : o.mode;
        var src = mode === 'photo' ? photo || (b && b.sky_photo) || sky.photo : null;
        var example = mode !== 'landscapes' && !src;
        if (!src && landscape) src = '/hk/landscapes/' + landscape;
        var image = new Image(), paints = [], preview = null;
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
        // 1. STARTING POINT
        var start = [];
        if (parent) {
          start.push(K.check({ label: 'Same as ' + follows + ' (' + labels[I.preset(parent)] + ')', on: !Object.keys(own).length, fk: 'fi:follow',
                               onClick: function () { patch(null); } }));
        }
        var mine = !parent || Object.keys(own).length > 0;
        ['legacy', 'original', 'soft', 'balanced', 'rich', 'washed'].forEach(function (name) {
          var row = K.check({ label: labels[name], sub: notes[name], on: mine && active === name, fk: 'fi:' + name, onClick: function () { choose(name); } });
          if (name !== 'legacy') {
            var box = h('span', { class: 'flat-image-mini', 'aria-hidden': 'true' });
            var cv = h('canvas', { class: 'flat-image-thumb' }), wash = h('span', { class: 'flat-image-wash' });
            box.appendChild(cv); box.appendChild(wash); row.insertBefore(box, row.firstChild);
            addPreview(cv, Object.assign({}, look, name === 'original' ? { mode: 'original' } : I.presets[name]), wash);
          }
          start.push(row);
        });
        // (Custom: a starting point adjusted -- said, not chosen)
        if (active === 'custom') start.push(K.check({ label: 'Custom', sub: 'A starting point, adjusted', on: mine, fk: 'fi:custom', onClick: function () {} }));
        c.appendChild(this.withError(K.group({ header: 'Starting Point', footer: active === 'legacy'
          ? (glass ? 'Choose a starting point to tint the photo as Flat does: its color, depth and fade.' : 'Choose a starting point to use the newer tint controls.')
          : 'A starting point keeps your photo and color choice. Adjusting it makes it Custom.' +
            (glass && r ? ' It is ' + (b ? 'this screen’s' : 'All Screens’') + ', for every photo and landscape.' : key ? ' This page’s own wins over the screen’s.' : '') },
          start), patchPath));
        // 2. ADJUST: the starting point's sliders over the preview; Flat's older Fade under Previous Look
        var adjust = [], imageColor = [];
        var previewLook = Object.assign({}, look);
        if (look.mode !== 'legacy') {
          preview = h('div', { class: 'cell photoprev' });
          var frame = h('div', { class: 'flat-image-preview' });
          frame.setAttribute('data-source', src || '');
          var canvas = h('canvas', { 'aria-label': 'Adjusted photo preview', role: 'img' }), overlay = h('span', { class: 'flat-image-wash' });
          frame.appendChild(canvas); frame.appendChild(overlay); preview.appendChild(frame);
          var where = r ? r.label : (x && x.title) || 'All Screens';
          preview.appendChild(h('small', { text: src ? (example ? 'Sample landscape · choose Photo or Landscapes to use this look.' : 'Preview · ' + where) :
            'Choose a photo or landscape to preview the look.' }));
          addPreview(canvas, previewLook, overlay);
          adjust.push(preview);
          var fields = look.mode === 'tinted' ? ['strength', 'depth', 'brightness', 'fade'] : ['brightness', 'fade'];
          var help = { strength: 'Grayscale to full color', depth: 'Soft shadows to richer neighboring hues', brightness: 'Lighten or darken the image’s midtones',
            fade: 'Soften the image behind the cards' };
          var signed = function (n) { return n > 0 ? '+' + n : String(n); };
          fields.forEach(function (name) {
            var title = name.charAt(0).toUpperCase() + name.slice(1), says;
            if (name === 'brightness') { says = []; for (var n = -50; n <= 50; n++) says.push(signed(n)); }
            var row = K.slider({ label: title, sub: help[name] + ' · ' + source(name), sk: path + ':' + name, value: look[name], min: name === 'brightness' ? -50 : 0,
              max: name === 'brightness' ? 50 : 100, step: 5, labels: says, unit: name === 'brightness' ? '' : '%',
              onChange: function (v) { var change = {}; change[name] = v; patch(change); } });
            if (says) { var out = row.querySelector('.val'); if (out) out.textContent = signed(look[name]); }
            row.querySelector('input').addEventListener('input', function (e) {
              previewLook[name] = +e.target.value; if (image.complete && image.naturalWidth) paints[paints.length - 1]();
            });
            adjust.push(row);
            if (own[name] != null && parent) {
              var pv = name === 'brightness' ? signed(parent[name]) : parent[name] + '%';
              adjust.push(K.button({ label: 'Same as ' + follows + ' (' + pv + ')', fk: 'fi:' + name + ':follow', onClick: function () { var v = {}; v[name] = null; patch(v); } }));
            }
          });
          if (look.mode === 'tinted') {
            imageColor.push(K.seg({ label: 'Color', sub: source('color'), value: look.color === 'accent' ? 'accent' : 'own', sk: path + ':color',
              options: [['accent', 'Match Accent'], ['own', 'Your Own Color']], onChange: function (v) { patch({ color: v === 'accent' ? 'accent' : color }); } }));
            if (look.color !== 'accent') {
              var cr = K.text({ label: 'Tint Color', type: 'color', fk: 'fi:color', value: look.color, onCommit: function (v) { patch({ color: v }); } });
              var input = cr.querySelector('input'); input.addEventListener('change', function () { patch({ color: input.value }); }); imageColor.push(cr);
            }
            if (own.color != null && parent) {
              imageColor.push(K.button({ label: 'Same as ' + follows + ' (' + (parent.color === 'accent' ? 'Match Accent' : String(parent.color).toUpperCase()) + ')',
                                         fk: 'fi:color:follow', onClick: function () { patch({ color: null }); } }));
            }
          }
        }
        var older = !glass && look.mode === 'legacy' ? this.flatFadeParts(o) : null;
        if (older) adjust = adjust.concat(older.fade);
        if (adjust.length) {
          c.appendChild(this.withError(K.group({ header: 'Adjust', footer: older ?
            'How far the photo fades behind the cards: Light washes it toward limestone, Dark toward black. 0% shows the photo as taken.'
            : 'Strength, Depth, Brightness and Fade are independent. Adjusting one makes the starting point Custom.' }, adjust), older ? o.sk('sky_flat_fade') : patchPath));
        }
        // 3. BLUR & DIM, and the glass looks' color: their photo Look -- the Background's photo or landscape, or a page's
        var gl = null;
        if (glass) {
          var land = r ? false : o.mode === 'landscapes', lk = land ? 'sky_landscape_look' : 'sky_photo_look';
          if (r) {
            var looks = b ? (b.sky_page_looks || {}) : (sky.page_looks || {});
            var lvlLook = pageMode === 'landscapes' ? (b ? (b.sky_landscape_look || sky.landscape_look) : sky.landscape_look) : (b ? (b.sky_photo_look || sky.photo_look) : sky.photo_look);
            gl = this.photoLookParts({ look: looks[r.key] || (r.room && looks.rooms) || lvlLook, own: !!looks[r.key], sk: o.sk('sky_page_looks') + ':' + r.key,
              follow: r.room && looks.rooms ? 'Room Pages' : b ? 'This Screen' : 'All Screens',
              onSet: function (v) {
                var next = Object.assign({}, looks);
                if (v) next[r.key] = v; else delete next[r.key];
                o.put({ sky_page_looks: next });
              } });
          } else {
            gl = this.photoLookParts({ look: b ? b[lk] || sky[lk.slice(4)] : sky[lk.slice(4)], own: b ? !!b[lk] : undefined, sk: o.sk(lk), follow: 'All Screens',
              onSet: function (v) { var ch = {}; ch[lk] = v; o.put(ch); } });
          }
          c.appendChild(this.withError(K.group({ header: 'Blur & Dim', footer: 'A soft or darker photo keeps the cards easy to read.' }, gl.blur), gl.own === undefined ? o.sk(lk) : null));
        }
        // 4. COLOR
        var colorRows = imageColor.concat(gl ? gl.color : []).concat(older ? older.tint : []);
        if (colorRows.length) {
          c.appendChild(K.group({ header: 'Color', footer: older ? 'Tint turns the photo to one color, keeping its own light and dark: the page’s accent, or one of your own.'
              : [imageColor.length ? 'Match Accent follows the page’s accent; Your Own Color stays as it is.' : null,
                 gl ? 'Color Tint washes one of the Colors over it: its day colors while the sun is up, its night ones after.' : null].filter(Boolean).join(' ') }, colorRows));
        }
        if (gl && gl.back.length) c.appendChild(K.group({ footer: 'Blur, Dim, Saturation and Color Tint, together.' }, gl.back));
        image.onload = function () { paints.forEach(function (paint) { paint(); }); };
        image.onerror = function () { if (preview) { var note = preview.querySelector('small'); if (note) note.textContent = 'The image could not be loaded. Your look is kept.'; } };
        if (src) image.src = src;
      }
      // FLAT'S OLDER FADE AND TINT (2026-10-17), shown on Adjust Photo while Previous Look is in use: the theme's ground
      // washed over the photo, and the color it leans to (none, the page's accent, or your own), how strong and how
      // bright. A screen's or All Screens' (a page's photo fades as its screen's): {fade: [rows], tint: [rows]}
      flatFadeParts(o) {
        var sky = this.data.settings.sky || {}, b = o.b, put = this.flatPut(o.x, b);
        var one = function (k, dflt) { var own = !!b && b[k] != null, house = sky[k.slice(4)]; house = house == null ? dflt : house; return { own: own, house: house, value: own ? b[k] : house }; };
        var fade = one('sky_flat_fade', 50), tint = one('sky_flat_tint', 'none'), amt = one('sky_flat_tint_amount', 60), lt = one('sky_flat_tint_light', 50);
        var back = function (rows, k, label) { if (b && one(k).own) rows.push(K.button(
          { label: 'Same as All Screens (' + label + ')', sk: o.sk(k) + ':reset', onClick: function () { var ch = {}; ch[k] = null; put(ch); } })); };
        var sub = function (f) { return b ? (f.own ? 'Just This Screen' : 'Same as All Screens') : null; };
        var fadeRows = [K.slider({ label: 'Fade', sub: sub(fade), sk: o.sk('sky_flat_fade'), value: fade.value, min: 0, max: 100, step: 5, unit: '%',
                                   onChange: function (v) { put({ sky_flat_fade: v }); } })];
        back(fadeRows, 'sky_flat_fade', fade.house + '%');
        var tv = tint.value || 'none', mine = /^#/.test(tv), tintRows = [];
        tintRows.push(K.seg({ label: 'Tint', sub: sub(tint), sk: o.sk('sky_flat_tint'), value: mine ? 'own' : tv, stack: !this.hasAttribute('wide'),
          options: [['none', 'None'], ['accent', 'Match Accent'], ['own', 'Your Own']], onChange: function (v) { put({ sky_flat_tint: v === 'own' ? (mine ? tv : '#7e9b83') : v }); } }));
        if (mine) {
          var row = K.text({ label: 'Tint Color', sub: tv.toUpperCase(), type: 'color', fk: o.sk('sky_flat_tint') + ':color', value: tv,
                             onCommit: function (v) { if (/^#[0-9a-f]{6}$/i.test(v)) put({ sky_flat_tint: v.toLowerCase() }); } });
          var inp = row.querySelector('input');
          if (inp) {
            inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
            inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) put({ sky_flat_tint: inp.value.toLowerCase() }); });
          }
          tintRows.push(row);
        }
        back(tintRows, 'sky_flat_tint', M.flatTintLabel(tint.house));
        // ...how strong (2026-10-17, the user: a light one, or a strong one), and how bright: stored 0-100, 50 the photo
        // as it is, said -50..+50
        if (tv !== 'none') {
          tintRows.push(K.slider({ label: 'Tint Strength', sub: sub(amt), sk: o.sk('sky_flat_tint_amount'), value: amt.value, min: 0, max: 100, step: 5, unit: '%',
                                   onChange: function (v) { put({ sky_flat_tint_amount: v }); } }));
          back(tintRows, 'sky_flat_tint_amount', amt.house + '%');
          var says = [];
          for (var n = 0; n <= 100; n++) says.push(n === 50 ? '0' : (n > 50 ? '+' : '−') + Math.abs(n - 50));
          tintRows.push(K.slider({ label: 'Tint Brightness', sub: sub(lt), sk: o.sk('sky_flat_tint_light'), value: lt.value, min: 0, max: 100, step: 5, labels: says,
                                   onChange: function (v) { put({ sky_flat_tint_light: v }); } }));
          back(tintRows, 'sky_flat_tint_light', says[lt.house]);
        }
        return { fade: fadeRows, tint: tintRows };
      }
      // THE COLORS: the theme's tone of each, then your own. o = { id (own,
      // or null following), follow ([label, id] or null), auto (offer
      // Automatic), theme, onPick(id | null), fk, header (null: none) }
      flatColorGroup(c, o) {
        var self = this, rows = [], light = o.theme === 'light';
        var tone = function (id) {
          if (/^#/.test(id || '')) return id;
          var p = self.flatColors().filter(function (x) { return x.id === id; })[0] || self.flatColors()[0];
          return p ? p[light ? 'light' : 'dark'] : (light ? '#EEECE6' : '#17181A');
        };
        if (o.follow) rows.push(K.check({ label: o.follow[0] + ' (' + this.flatColorLabel(o.follow[1], o.theme) + ')', on: !o.id, fk: o.fk + 'follow',
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
        c.appendChild(K.group({ header: o.header === undefined ? 'Color' : o.header, footer: 'Shown in their ' + (light ? 'Light' : 'Dark') +
          ' tones: each color has a Light and a Dark tone, and follows the Theme under Appearance. Solid, with nothing drawn on it.' }, rows));
      }
      // FLAT'S COLORS (2026-10-17; phase 33 took the Flat Colors page apart): Flat's Tiles When Off (off_tint) and
      // whether the pages keep their own colors (pages) at every scope -- All Screens, a screen, and a page or room on
      // either -- and the Accent Color it shares with the other styles. A scope: {kind: 'house' | 'screen' |
      // 'house-page' | 'screen-page', x, b, key}. A field left alone is inherited, Automatic stops there.
      flatAnywhere() {
        var look = this.data.settings.look || {}, boards = this.data.boards || {};
        return look.flat === true || Object.keys(boards).some(function (p) { return M.glassOf(boards[p], look).effective === 'flat'; });
      }
      flatScope(kind, x, b, key) {
        var self = this, look = this.data.settings.look || {};
        var screen = kind === 'screen' || kind === 'screen-page', page = kind === 'house-page' || kind === 'screen-page';
        var sb = screen ? b : null, row = page ? this.skyRow(key, sb) : null;
        var keys = page ? (row && row.room ? [key, 'rooms'] : [key]) : [];
        var sc = { kind: kind, x: x, b: sb, key: key || null, row: row, keys: keys, page: page, screen: screen,
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
      // SAVE a patch ({off_tint?, pages?, accent?}: a value, or null to inherit again -- All Screens': Automatic) at
      // the scope, shown at once
      flatColorsPut(sc, patch) {
        var d = this.data, look = d.settings.look, ch = {};
        var made = function (o) {
          o = Object.assign({}, o || {});
          Object.keys(patch).forEach(function (f) { if (patch[f] == null) delete o[f]; else o[f] = patch[f]; });
          return o;
        };
        if (sc.kind === 'house') {
          look.flat_colors = Object.assign({ accent: 'auto', off_tint: 'auto', pages: 'accent' }, made(look.flat_colors));
          Object.keys(patch).forEach(function (f) { ch['look.flat_colors.' + f] = patch[f]; });
          return this.setH(ch);
        }
        if (sc.kind === 'house-page') {
          var hp = look.flat_page_colors = Object.assign({}, look.flat_page_colors), hv = made(hp[sc.key]);
          if (Object.keys(hv).length) hp[sc.key] = hv; else delete hp[sc.key];
          ch['look.flat_page_colors.' + sc.key] = patch;
          return this.setH(ch);
        }
        var b = d.boards[sc.x.path] = Object.assign({}, d.boards[sc.x.path]);
        if (sc.kind === 'screen') {
          b.flat_colors = made(b.flat_colors);
          Object.keys(patch).forEach(function (f) { ch['flat_colors.' + f] = patch[f]; });
        } else {
          var bp = b.flat_page_colors = Object.assign({}, b.flat_page_colors), bv = made(bp[sc.key]);
          if (Object.keys(bv).length) bp[sc.key] = bv; else delete bp[sc.key];
          ch['flat_page_colors.' + sc.key] = patch;
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
      // APPEARANCE'S COLOR GROUP (phase 33, decision 2: one name per thing): the Accent Color; under it, where Flat is
      // in use and an accent is chosen, Pages Keep Their Own Colors (Flat Colors' Pages before); the Page Colors; and
      // Flat's Tiles When Off (Off Pill Tint before). x null: All Screens', Flat's rows while any screen wears Flat.
      appearanceColors(c, x, b) {
        var flatHere = this.flatHere(x ? b : null), flatAny = x ? flatHere : this.flatAnywhere();
        var base = x ? '#/screens/' + encodeURIComponent(x.path) : '#/house/appearance';
        var rows = [this.accentNav(x, b, base + '/accent')];
        if (flatAny && this.accentOf(x, b).value !== 'auto') rows = rows.concat(this.ownColorsRows(x, b, flatHere));
        rows.push(K.nav({ label: 'Page Colors', value: this.pageColorsSays(b), href: base + '/page-colors', sk: x ? 'b:page_colors' : 'look.page_accents' }));
        if (flatAny) rows.push(this.tilesOffNav(x, b, flatHere, x ? base + '/appearance/tiles-off' : base + '/tiles-off'));
        c.appendChild(K.group({ header: 'Color', footer: 'A page’s own color shows while you’re on it and the Accent Color is Automatic' +
          (flatAny ? '; in Flat, a color chosen for a page always does.' : '.') }, rows));
      }
      // PAGES KEEP THEIR OWN COLORS (flat_colors.pages 'own'): under an Accent Color chosen, the pages that have a
      // color of their own (Climate blue, Lights yellow…) keep it in Flat, Home and the rooms in the accent
      ownColorsRows(x, b, flatHere) {
        var self = this, look = this.data.settings.look || {}, house = ((look.flat_colors || {}).pages) === 'own';
        if (!x) {
          return [K.toggle({ label: 'Pages Keep Their Own Colors', sk: 'look.flat_colors:pages', on: house,
            sub: flatHere ? 'Climate blue, Lights yellow…, in Flat' : 'For screens using Flat',
            onChange: function (on) { self.flatColorsPut(self.flatScope('house'), { pages: on ? 'own' : 'accent' }); } })];
        }
        var mine = (b.flat_colors || {}).pages, own = mine === 'own' || mine === 'accent', sc = this.flatScope('screen', x, b);
        var rows = [K.toggle({ label: 'Pages Keep Their Own Colors', sk: 'b:flat_colors:pages', on: own ? mine === 'own' : house,
          sub: own ? 'Just This Screen' : 'Climate blue, Lights yellow…, in Flat',
          onChange: function (on) { self.flatColorsPut(sc, { pages: on ? 'own' : 'accent' }); } })];
        if (own) rows.push(K.button({ label: 'Reset to All Screens (' + (house ? 'On' : 'Off') + ')', sk: 'b:flat_colors:pages:reset',
          onClick: function () { self.flatColorsPut(sc, { pages: null }); } }));
        return rows;
      }
      // TILES WHEN OFF, a row: what a scope's tiles that are off are washed in (Flat), and whose it is
      tilesOffNav(x, b, flatHere, href, key) {
        var sc = this.flatScope(key ? (x ? 'screen-page' : 'house-page') : (x ? 'screen' : 'house'), x, b, key), r = sc.resolved().off_tint;
        var hex = M.flatColorHex(r.value), acc = M.flatColorHex(sc.resolved().accent.value);
        return K.nav({ label: 'Tiles When Off', value: M.tilesOffName(r.value), href: href,
                       sub: this.flatFieldWhere(sc, 'off_tint', r) || (flatHere ? null : 'For screens using Flat'),
                       tile: hex ? ['', hex] : r.value === 'accent' ? ['mdi:link-variant', acc || '#8e8e93'] : ['mdi:auto-fix', AUTO_ACCENT_TILE],
                       sk: (x ? 'b:' : 'look.') + (key ? 'flat_page_colors:' + key + ':off_tint' : 'flat_colors:off_tint') });
      }
      // TILES WHEN OFF, its page (Off Pill Tint before; the same stored values): Their Own Colors (auto), The Accent
      // Color (accent) or One Color (a color) -- All Screens', a screen's, or a page's on either (`key`)
      tilesOffPage(c, x, b, key) {
        var self = this, sc = this.flatScope(key ? (x ? 'screen-page' : 'house-page') : (x ? 'screen' : 'house'), x, b, key);
        var r = sc.resolved(), own = sc.own().off_tint, cur = r.off_tint.value, house = sc.kind === 'house';
        var pick = function (v) { self.flatColorsPut(sc, { off_tint: v }); };
        var on = function (v) { return (house || own != null) && cur === v; };
        var rows = [];
        if (!house) {
          var par = sc.parent('off_tint'), src = M.flatSourceLabel(par, { label: sc.labelOf });
          rows.push(K.check({ label: sc.kind === 'screen' ? 'Same as All Screens' : key && x ? 'Same as This Screen' : 'Same as All Screens',
                              sub: 'Now ' + M.tilesOffName(par.value) + (src && sc.kind !== 'screen' ? ' · ' + src : ''), on: own == null, fk: 'tilesoff:inherit',
                              onClick: function () { pick(null); } }));
        }
        // (The Accent Color with none chosen in Flat is the menu's: the page's own while that is Automatic)
        var ac = r.accent.value !== 'auto' ? { value: r.accent.value, name: M.flatColorName(r.accent.value), hex: M.flatColorHex(r.accent.value) } : this.accentOf(x, b);
        var acc = ac.value === 'auto' ? null : ac.hex;
        rows.push(K.check({ label: M.TILES_OFF[0][1], sub: M.TILES_OFF[0][2], tile: ['mdi:auto-fix', AUTO_ACCENT_TILE], on: on('auto'), fk: 'tilesoff:auto',
                            onClick: function () { pick('auto'); } }));
        rows.push(K.check({ label: M.TILES_OFF[1][1], sub: acc ? 'Now ' + ac.name + ', and whatever it becomes' : 'The page’s own color, while the Accent Color is Automatic',
                            tile: ['mdi:link-variant', acc || '#8e8e93'], on: on('accent'), fk: 'tilesoff:accent', onClick: function () { pick('accent'); } }));
        var custom = (house || own != null) && cur !== 'auto' && cur !== 'accent';
        var start = M.flatColorHex(cur) || '#789484';
        var row = K.text({ label: M.TILES_OFF[2][1], sub: custom ? start.toUpperCase() : M.TILES_OFF[2][2], type: 'color', fk: 'tilesoff:custom', value: start,
                           error: this.err((sc.screen ? 'b:' : 'look.') + 'flat_colors.off_tint'),
                           onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) pick(t.toLowerCase()); } });
        var inp = row.querySelector('input');
        if (inp) {
          inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
          inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) pick(inp.value.toLowerCase()); });
        }
        if (custom) row.classList.add('on');
        rows.push(row);
        var flatOn = this.flatHere(sc.screen ? b : null) || (!sc.screen && this.flatAnywhere());
        c.appendChild(K.group({ footer: 'In Flat, the wash on tiles that are off and their circles. Tiles that are on stay white with their own colors.' +
          (flatOn ? '' : ' ' + (sc.screen ? 'This screen isn’t using Flat now: this waits until it is.' : 'No screen is using Flat now.')) }, rows));
      }
      // PAGE COLOR (phase 33, decision 3): a page's own color, one palette everywhere -- All Screens' (look.page_accents;
      // a room's, which can't be a key there, look.flat_page_colors[room].accent as before) or a screen's own
      // (flat_page_colors[page].accent, Flat Colors' per-page accent before), over the page's default (PAGE_ACCENTS).
      // -> {own: this scope's (null: none; a screen's old "auto" stays as it was), house: All Screens' or null, value:
      // what shows (null: the default), dflt: {name, hex}}
      pageColorOf(key, b) {
        var look = this.data.settings.look || {}, hp = (look.flat_page_colors || {})[key] || {};
        var house = (look.page_accents || {})[key] || (hp.accent && hp.accent !== 'auto' ? hp.accent : null) || null;
        var mine = b ? (((b.flat_page_colors || {})[key] || {}).accent || null) : null;
        var d = M.pageAccentOf(key, {}).d;
        return { own: b ? mine : house, house: house, value: mine && mine !== 'auto' ? mine : house, dflt: d };
      }
      pageColorName(v, d) { return v ? M.flatColorName(v) : 'Default (' + d.name + ')'; }
      pageColorHex(v, d) { return (v && M.flatColorHex(v)) || d.hex; }
      // "Default", "3 Chosen": a scope's Page Colors in a word
      pageColorsSays(b) {
        var self = this, n = this.skyPageKeys(b).rows.filter(function (r) { var pc = self.pageColorOf(r.key, b); return b ? pc.own != null : pc.house; }).length;
        return n ? n + ' Chosen' : b ? 'Same as All Screens' : 'Default';
      }
      // A PAGE COLOR ROW, to its page
      pageColorNav(key, b, href, o) {
        o = o || {};
        var pc = this.pageColorOf(key, b);
        return K.nav({ label: o.label || 'Page Color', value: this.pageColorName(pc.value, pc.dflt), href: href, icon: o.icon || null,
                       sub: o.sub || (b && pc.own != null ? 'Just This Screen' : null), tile: o.tile === false ? null : ['', this.pageColorHex(pc.value, pc.dflt)],
                       sk: (b ? 'b:flat_page_colors:' : 'look.page_accents:') + key });
      }
      pageColorPut(key, x, b, v) {
        var o = {};
        if (b) { o['flat_page_colors.' + key] = { accent: v }; return this.setB(x.path, o); }
        if (/^[a-z][a-z_]{1,29}$/.test(key)) {
          var next = Object.assign({}, (this.data.settings.look || {}).page_accents);
          if (v) next[key] = v; else delete next[key];
          o['look.page_accents'] = next;
          // (a page's Flat Accent Color from before goes with it, server side: changes.py page_colors_unfolded)
          return this.setH(o);
        }
        o['look.flat_page_colors.' + key] = { accent: v };
        return this.setH(o);
      }
      // A PAGE'S COLOR, its page: the default (All Screens') or Same as All Screens (a screen's), the eleven colors,
      // Flat's eight as Soft Colors, your own -- then, in Flat, its Tiles When Off, and Room Pages' rooms
      pageColorPage(c, key, x, b, base) {
        var self = this, pc = this.pageColorOf(key, b), mine = pc.own && pc.own !== 'auto' ? String(pc.own).toLowerCase() : null;
        var put = function (v) { self.pageColorPut(key, x, b, v); };
        var first = b
          ? K.check({ label: 'Same as All Screens', sub: 'Now ' + this.pageColorName(pc.house, pc.dflt), tile: ['', this.pageColorHex(pc.house, pc.dflt)],
                      on: pc.own == null, fk: 'pcolor:inherit', onClick: function () { put(null); } })
          : K.check({ label: 'Default', sub: pc.dflt.name, tile: ['', pc.dflt.hex], on: !mine, fk: 'pcolor:default', onClick: function () { put(null); } });
        c.appendChild(K.group({ footer: 'The page’s own color: the page you’re on in the menu and tab bar while the Accent Color is Automatic, and its icon on the Pages screen. ' +
          'In Flat it wins over the Accent Color and shades an Automatic background.' }, [first]));
        var on = function (name, hex) { return !!mine && (mine === name || mine === hex); };
        c.appendChild(K.group({ header: 'Colors' }, M.ACCENTS.map(function (n) {
          return K.check({ label: n[1], tile: ['', n[2]], on: on(n[0], n[2]), fk: 'pcolor:' + n[0], onClick: function () { put(n[0]); } });
        })));
        c.appendChild(K.group({ header: 'Soft Colors' }, M.FLAT_ACCENTS.map(function (n) {
          return K.check({ label: n[1], tile: ['', n[2]], on: on(n[0], n[2]), fk: 'pcolor:soft:' + n[0], onClick: function () { put(n[2]); } });
        })));
        var custom = !!mine && !M.ACCENTS.some(function (n) { return on(n[0], n[2]); }) && !M.FLAT_ACCENTS.some(function (n) { return on(n[0], n[2]); });
        var start = this.pageColorHex(pc.value, pc.dflt);
        var row = K.text({ label: 'Your Own Color', sub: custom ? start.toUpperCase() : 'Pick any color.', type: 'color', fk: 'pcolor:custom', value: start,
                           error: this.err(b ? 'b:flat_page_colors.' + key : 'look.page_accents'),
                           onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) put(t.toLowerCase()); } });
        var inp = row.querySelector('input');
        if (inp) {
          inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
          inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) put(inp.value.toLowerCase()); });
        }
        if (custom) row.classList.add('on');
        c.appendChild(K.group({ header: 'Custom' }, [row]));
        var flatHere = this.flatHere(b || null), flatAny = b ? flatHere : this.flatAnywhere();
        if (flatAny && base) {
          c.appendChild(K.group({ header: 'In Flat' }, [this.tilesOffNav(x, b, flatHere, base + '/tiles-off', key)]));
        }
        if (key === 'rooms' && base) {
          var rooms = this.areasAZ().map(function (aid) {
            var k = self.roomKey(aid);
            return k ? self.pageColorNav(k, b, base.replace(/\/rooms$/, '') + '/' + encodeURIComponent(k), { label: self.areaName(aid), tile: true }) : null;
          }).filter(Boolean);
          if (rooms.length) c.appendChild(K.group({ header: 'Each Room', footer: 'A room left alone has Room Pages’ color.' }, rooms));
        }
      }
      // THE PAGE COLORS, a scope's list (All Screens' or a screen's), each a way to its page
      pageColorsList(c, x, b, base) {
        var self = this, rows = this.skyPageKeys(b).rows;
        if (!rows.length) { c.appendChild(K.group({ footer: 'This screen shows no page with a color of its own.' }, [])); return; }
        c.appendChild(K.group({ footer: b ? 'A page left alone has its color from All Screens (Pages → the page → Look). Choose one here for this screen only.'
                                          : 'Each page’s own color on every screen; a screen can give a page its own, under its Appearance.' },
          rows.map(function (r) {
            return self.pageColorNav(r.key, b, base + '/' + encodeURIComponent(r.key), { label: r.label, sub: r.custom ? 'Custom page' : null });
          })));
      }
      // THE PAGE COLORS' ADDRESSES, All Screens' (x null) or a screen's: [] the list, [key] a page's color,
      // [key, 'tiles-off'] its Tiles When Off
      pageColorRoutes(x, b, sub, mk, base, backTo) {
        var self = this, key = sub[0] ? decodeURIComponent(sub[0]) : null, row = key ? this.skyRow(key, b || null) : null;
        if (!key) return mk('Page Colors', function (c) { self.pageColorsList(c, x, b, base); }, backTo);
        var label = row ? row.label : key, back = row && row.room && key !== 'rooms' ? ['Room Pages', base + '/rooms'] : ['Page Colors', base];
        var here = base + '/' + encodeURIComponent(key);
        if (sub[1] === 'tiles-off') return mk('Tiles When Off', function (c) { self.tilesOffPage(c, x, b, key); }, [label, here]);
        var out = mk(label, function (c) { self.pageColorPage(c, key, x, b, here); }, back);
        // A PAGE'S COLOR PREVIEWS THAT PAGE (its address, as the strategy names it)
        var view = x ? (FLAT_VIEW[key] || (key === 'rooms' ? null : key)) : null;
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
          rm.appendChild(
            K.svg('<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="var(--hk-red)"/><path d="M6.5 11h9" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>'
            ));
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
        c.appendChild(
          K.group(
          { header: 'Sources',
          footer: 'Optional. A holiday sensor’s state is Halloween, Thanksgiving or Christmas; the dates then only limit when the sky decorates. A moon sensor gives the phase from 0 to 1.' }, [
          this.entityRow({ label: 'Holiday Season', sk: 'sky.holidays', value: sky.holidays, none: 'From the Dates',
                           filter: { domains: ['sensor'] }, onPick: set('sky.holidays') }),
          this.entityRow({ label: 'Moon Phase', sk: 'sky.moon', value: sky.moon, none: 'Computed',
                           filter: { domains: ['sensor'] }, onPick: set('sky.moon') })]));
        c.appendChild(K.group({ header: 'Sky Switch', footer: 'While this helper is off, no generated screen shows the live sky. A screen written in YAML names its own.' }, [
          this.entityRow({ label: 'Sky Switch', sk: 'look.sky_switch', value: (this.data.settings.look || {}).sky_switch, none: 'None (Always On)',
                           filter: { domains: ['input_boolean', 'switch'] }, onPick: set('look.sky_switch') })]));
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
        // (phase 32: the Pages Screen is a way around too, so it is here rather than a row of its own in the sidebar; the
        // rooms and the header in one group, not two of a row each)
        var ps = this.psCtx({ house: true, base: '#/house/pagesscreen' }).value;
        c.appendChild(K.group({ header: 'Navigation', footer: 'Everything about each, for every screen that uses it.' },
          M.MENU_KINDS.map(function (k) {
            return K.nav({ label: k[1], value: M.usedBy(M.kindUsers(k[0], bd, titleOf)), href: '#/house/menu/' + k[0], sk: 'menu:' + k[0] });
          }).concat([K.nav({ label: 'Pages Screen', value: M.choiceLabel(M.PAGES_SCREEN_SHOW, ps.show || 'off'), href: '#/house/pagesscreen', sk: 'menu:pagesscreen' })])));
        this.swipePagesGroup(c, null, null);
        var hv = M.houseMenuAsBoard(this.data.settings.menu);
        c.appendChild(K.group({ header: 'Rooms and Header', footer: 'Which rooms the menus list, and the header on every page but Home.' }, [
          K.nav({ label: 'Rooms in the Menu', href: '#/house/rooms', sk: 'menu:rooms' }),
          K.nav({ label: 'Back Button & Title', value: M.choiceLabel(M.PAGE_HEADERS, hv.page_header || 'current'), href: '#/house/menu/header', sk: 'menu.page_header' })]));
      }
    };
    KIT.install(Methods);
  };
})();
