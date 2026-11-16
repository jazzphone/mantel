// hk-settings-screen-saver.js - a screen's screensaver: its page at both levels, row by row, its faces, thumbnails and editor page.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-screen-saver'] = function (KIT) {
    var MIN = KIT.MIN;

    var h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // THE SCREENSAVER'S OPTIONS (HK Frontend's own, hk-saver.js); the defaults are settings.py's.
      // WHAT IS SAVED: only the options Home Assistant's running HK Frontend
      // knows (the keys of All Screens' options, which it fills in). These
      // files are served the moment they change, its Python only after a
      // restart: a new option sent to an older one had every save refused
      // (Fade Back, 2026-10-04).
      saverKnown(k) {
        var h = this.hs('look.saver');
        return !h || typeof h !== 'object' || Object.prototype.hasOwnProperty.call(h, k);
      }

      // A WHOLE SET AS SAVED (All Screens'): the known keys, its slides' count of photos in step with How Often's
      // minutes (an older version reads that), and the design in use kept with what it shows
      saverOut(o) {
        var self = this, out = {};
        Object.keys(o).forEach(function (k) { if (self.saverKnown(k)) out[k] = o[k]; });
        if (typeof out.extra_every === 'number' && typeof out.each_photo === 'number' && 'forecast_every' in out) {
          out.forecast_every = M.saverLayers.photosFor(out.extra_every, out.each_photo);
        }
        // Timing, photos and slides can also be edited outside the layout editor.
        // Keep those changes with the selected design without mutating inherited settings.
        if (out.active_design && out.designs) {
          var snapshot = Object.assign({}, out); delete snapshot.designs; delete snapshot.active_design;
          out.designs = out.designs.map(function (d) { return d.id === out.active_design ? Object.assign({}, d, { options: snapshot }) : d; });
        }
        return out;
      }

      // ALL SCREENS' OPTIONS AS THEY READ (their slides in minutes) -- and a screen's: All Screens' with its own over them
      saverHouseNow() { return M.saverLayers.inMinutes(M.saverOptions(this.hs('look.saver'))); }
      saverNow(path) { return path ? M.saverLayers.of((this.data.boards || {})[path], this.saverHouseNow()) : this.saverHouseNow(); }

      // ONE OPTION SAVED FOR A SCREEN, ROW BY ROW (phase 33, decision 9): the keys it changes become the screen's own,
      // the rest stay All Screens'. A change to the editor's design makes the whole design its own (one group); the
      // editor's Save hands the whole set, of which only what changed counts. put(key, value) or put({key: value, ...})
      saverPutB(path) {
        var self = this;
        return function (k, v) {
          var b = (self.data.boards || {})[path] || {}, L = M.saverLayers;
          var cur = self.saverNow(path), mine = Object.assign({}, L.own(b)), patch = {};
          if (k && typeof k === 'object') patch = k; else patch[k] = v;
          var same = function (a, c) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(c === undefined ? null : c); };
          var keys = Object.keys(patch).filter(function (x) { return self.saverKnown(x) && !same(patch[x], cur[x]); });
          // (one key put alone is the screen's own even at All Screens' value: it was chosen here)
          if (!(k && typeof k === 'object') && self.saverKnown(k) && keys.indexOf(k) < 0) keys.push(k);
          if (keys.some(function (x) { return !L.isPage(x); })) {
            Object.keys(cur).forEach(function (x) { if (!L.isPage(x) && keys.indexOf(x) < 0 && self.saverKnown(x)) keys.push(x); });
          }
          keys.forEach(function (x) { mine[x] = Object.prototype.hasOwnProperty.call(patch, x) ? patch[x] : cur[x]; });
          var all = Object.assign({}, cur, mine);
          // (a whole set from before holds the count of photos too: in step with its minutes, for an older version)
          if ('forecast_every' in mine) mine.forecast_every = L.photosFor(all.extra_every, all.each_photo);
          if (mine.active_design && mine.designs) {
            var snap = Object.assign({}, all); delete snap.designs; delete snap.active_design;
            mine.designs = mine.designs.map(function (d) { return d.id === mine.active_design ? Object.assign({}, d, { options: snap }) : d; });
          }
          return self.setB(path, { screensaver_options: Object.keys(mine).length ? mine : null });
        };
      }

      // A SCREEN'S ROWS BACK TO ALL SCREENS': its own keys `keys` let go (all of them: Use All Screens' Screensaver)
      saverUnown(path, keys) {
        var mine = Object.assign({}, M.saverLayers.own((this.data.boards || {})[path]));
        (keys || Object.keys(mine)).forEach(function (k) { delete mine[k]; });
        return this.setB(path, { screensaver_options: Object.keys(mine).length ? mine : null });
      }

      saverPutH() {
        var self = this;
        return function (k, v) {
          var o = self.saverHouseNow();
          if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
          return self.setH({ 'look.saver': self.saverOut(o) });
        };
      }

      // THE SCREENSAVER'S FACES, SMALL (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I): a picture of a Show or a
      // clock face for Clock Style's rows and Show's strip -- the face itself, drawn once (still) at a 1180 x 820
      // tablet's size and scaled down whole, so it is exactly the face. Its modules load the first time one shows.
      // `what`: photos, forecast, clock (the clock as chosen), clock:<style>, glance, month or day
      saverFaceModules() {
        var self = this;
        if (window.hkSaverClock && window.hkSaverFaces) return Promise.resolve(true);
        if (!this._fxLoad) {
          this._fxLoad = Promise.all([window.hkSaverClock ? null : import('/hk/modules/hk-saverclock.js'),
                                      window.hkSaverFaces ? null : import('/hk/modules/hk-saverfaces.js')])
            .then(function () { return true; }, function () { self._fxLoad = null; return false; });
        }
        return this._fxLoad;
      }

      saverThumb(w, h, what, cur) {
        var self = this, W = 1180, H = 820;
        var box = document.createElement('span'), inner = document.createElement('div');
        box.className = 'sthumb';
        box.inert = true;
        box.setAttribute('aria-hidden', 'true');
        box.style.cssText = 'flex:none;position:relative;display:block;width:' + w + 'px;height:' + h + 'px;border-radius:' + Math.round(h / 7) + 'px;overflow:hidden;' +
          'background:#1c1c1e;box-shadow:inset 0 0 0 .5px rgba(127,127,127,.35);margin-right:12px';
        inner.style.cssText = 'position:absolute;width:' + W + 'px;height:' + H + 'px;transform-origin:0 0;pointer-events:none';
        box.appendChild(inner);
        // The gallery resizes these frames with CSS. Fit the whole virtual screen
        // to the measured frame, uniformly, rather than cropping a fixed-size drawing.
        var fit = function (bw, bh) {
          if (!bw || !bh) return;
          var scale = Math.min(bw / W, bh / H);
          inner.style.transform = 'scale(' + scale + ')';
          inner.style.left = (bw - W * scale) / 2 + 'px'; inner.style.top = (bh - H * scale) / 2 + 'px';
        };
        fit(w, h);
        if (typeof ResizeObserver !== 'undefined') {
          var seen = false, resize = new ResizeObserver(function (entries) {
            if (box.isConnected) { seen = true; var r = entries[0].contentRect; fit(r.width, r.height); }
            else if (seen) resize.disconnect();
          });
          resize.observe(box);
        }
        // the two that are pictures of their own: the photos, the forecast
        if (what === 'photos') {
          inner.style.background = 'linear-gradient(#8fb3d6,#e9c09a)';
          inner.innerHTML =
            '<svg viewBox="0 0 1180 820" width="1180" height="820"><circle cx="880" cy="230" r="80" fill="#fff4d6"/><path d="M0 640L260 360 470 560 700 300 1180 700V820H0z" fill="#58745f"/><path ' +
            'd="M0 820V700L340 560 620 700 900 600 1180 760V820z" fill="#3c5747"/></svg>';
          return box;
        }
        if (what === 'forecast') {
          inner.style.background = 'linear-gradient(#2f74ba,#a7d2ef)';
          inner.innerHTML =
            '<svg viewBox="0 0 1180 820" width="1180" height="820"><path d="M300 330h300a110 110 0 0 0 10-219 160 160 0 0 0-308 34A100 100 0 0 0 300 330z" fill="#fff" opacity=".92"/>' +
            '<path d="M0 640C260 560 420 600 620 560S980 520 1180 580V820H0z" fill="#4f7a55"/><rect y="700" width="1180" height="120" fill="rgba(6,10,18,.55)"/>' +
            '<g fill="#fff" font-family="-apple-system,system-ui,sans-serif" font-weight="600" font-size="64">' +
            [0, 1, 2, 3, 4].map(function (i) { return '<text x="' + (110 + i * 230) + '" y="785">' + (54 + i) + '°</text>'; }).join('') + '</g></svg>';
          return box;
        }
        // (the clock's Background, 2026-10-31: the live sky alone, and a landscape -- behind the clock as chosen)
        if (what === 'bg:skyonly') inner.style.background = 'linear-gradient(#1f4f8f,#5f9bd0 60%,#b9d9ef)';
        if (what === 'bg:landscapes') { inner.style.background = 'center/cover url("/hk/landscapes/thumbs/01.webp"),#05070e'; }
        if (what === 'bg:photos') return this.saverThumb(w, h, 'photos', cur);
        if (what === 'bg:forecast') return this.saverThumb(w, h, 'forecast', cur);
        // Big Weather: a picture of it, as the forecast's is (the face needs the weather's readings, not loaded here)
        if (what === 'weather') {
          inner.style.background = 'linear-gradient(#2f74ba,#4f93cf 60%,#a7d2ef)';
          inner.innerHTML = '<svg viewBox="0 0 1180 820" width="1180" height="820" font-family="-apple-system,system-ui,sans-serif" fill="#fff">' +
            '<path d="M0 640C260 560 420 600 620 560S980 520 1180 580V820H0z" fill="#4f7a55"/>' +
            '<text x="60" y="80" font-size="34" font-weight="600">Sunny</text><text x="1120" y="94" font-size="44" font-weight="600" text-anchor="end">9:41</text>' +
            '<text x="40" y="520" font-size="400" font-weight="600" letter-spacing="-20" opacity=".92">64°</text>' +
            '<g font-size="40" font-weight="600" text-anchor="middle">' + [210, 470, 730, 990].map(
              function (x, i) { return '<text x="' + x + '" y="740">' + ['6:37', '10', '60%', '21'][i] + '</text>'; }).join('') + '</g></svg>';
          return box;
        }
        var tries = 0, draw = function () {
          if (!box.isConnected) { if (++tries < 20) requestAnimationFrame(draw); return; }
          var C = window.hkSaverClock, F = window.hkSaverFaces, o = cur || {};
          try {
            if (/^bg:/.test(what)) {
              // the clock as chosen over each Background (the two pictures above: the clock over them, no ground)
              var bgId = what.slice(3), own = bgId === 'skyonly' || bgId === 'landscapes';
              C.mount(inner, { flat: false, style: o.clock_style || 'classic', options: o.clock_options, still: true, drift: false, h24: !!o.clock_24, bg: own ? 'none' : bgId, speed: 0,
                               ground: !own, scrim: false, color: (o.clock_colors || {})[o.clock_style || 'classic'] || '', client: self.client,
                               wallpaper: { id: o.clock_wallpaper || 'aurora', color: o.clock_wallpaper_color || 'blue' } });
            } else if (/^clock/.test(what)) {
              var style = what.indexOf(':') > 0 ? what.split(':')[1] : (o.clock_style || 'classic');
              C.mount(inner, { flat: false, style: style, options: o.clock_options, still: true, drift: false, h24: !!o.clock_24, bg: 'gradient', speed: 0,
                               color: (o.clock_colors || {})[style] || '', client: self.client });
            } else {
              F.mount(inner, { kind: what, flat: false, still: true, h24: !!o.clock_24, look: o.day_look, client: self.client, clocks: C });
            }
          } catch (e) { /* no picture: the frame alone */ }
        };
        this.saverFaceModules().then(function (ok) { if (ok) draw(); });
        return box;
      }

      // THE SCREENSAVER EDITOR (2026-11-01, docs/phase12/SCREENSAVER-EDITOR.md): hk-saver-editor.js, loaded the first time it
      // is opened; one per screen (or All Screens), kept while its page shows. `house`: All Screens' screensaver
      saverEditorPage(key, o) {
        var self = this;
        return {
          title: 'Edit Screensaver', back: o.back,
          body: function (c) {
            var made = function () {
              if (!self._saverEditors) self._saverEditors = {};
              var ed = self._saverEditors[key];
              if (!ed) {
                ed = document.createElement('hk-saver-editor');
                self._saverEditors[key] = ed;
                ed.configure(Object.assign({ panel: self, gallery: true, onCancel: function () { delete self._saverEditors[key]; self.leaveTo(o.back[1]); },
                                             onSaved: function () { delete self._saverEditors[key]; self.leaveTo(o.back[1]); } }, o));
              }
              c.appendChild(ed);
            };
            if (window.customElements.get('hk-saver-editor')) made();
            else import('/hk/panels/hk-saver-editor.js').then(made, function (e) { c.textContent = 'The editor couldn\u2019t load: ' + (e && e.message || e); });
          }
        };
      }
      // THE SCREENSAVER PAGES' CONTEXT (phase 33): All Screens' (path null) or a screen's -- the options in force, how
      // one is saved, and which are the screen's own. The same groups, rows and order at both levels; on a screen each
      // row says Same as All Screens or Just This Screen, and its menu starts with Same as All Screens (its value)
      saverCtx(path) {
        var self = this, house = !path, b = house ? null : (this.data.boards || {})[path] || {}, L = M.saverLayers;
        var hcur = this.saverHouseNow();
        return {
          house: house, path: path, b: b, hcur: hcur, cur: house ? hcur : L.of(b, hcur),
          base: house ? '#/house/screensaver' : '#/screens/' + encodeURIComponent(path) + '/screensaver',
          put: house ? this.saverPutH() : this.saverPutB(path),
          own: function (keys) { return !house && [].concat(keys).some(function (k) { return L.isOwn(b, k); }); },
          unown: function (keys) { return self.saverUnown(path, keys); }
        };
      }

      // a row's words on a screen: whose it is (null at All Screens: the row's own words stay)
      saverSays(ctx, keys, sub) { return ctx.house ? sub || null : ctx.own(keys) ? 'Just This Screen' : 'Same as All Screens'; }

      // A MENU ROW: `opts` [[value, words]] (the value in force added when it isn't one, in `fmt`'s words); on a
      // screen Same as All Screens (its value) first, which lets the key go. A number stays a number.
      saverSel(ctx, label, k, opts, sub, fmt) {
        var cur = ctx.cur, num = typeof cur[k] === 'number';
        var words = function (v) {
          var o = opts.filter(function (x) { return String(x[0]) === String(v); })[0];
          return o ? o[1] : fmt ? fmt(v) : String(v);
        };
        var all = opts.some(function (o) { return String(o[0]) === String(cur[k]); }) ? opts.slice() : opts.concat([[cur[k], words(cur[k])]]);
        var mine = ctx.own(k);
        if (!ctx.house) all = [['', 'Same as All Screens (' + words(ctx.hcur[k]) + ')', words(ctx.hcur[k])]].concat(all);
        return K.select({ label: label, sub: this.saverSays(ctx, k, sub), sk: 'saver:' + k, value: ctx.house || mine ? String(cur[k]) : '',
          options: all.map(function (o) { return [String(o[0]), o[1], o[2]]; }),
          onChange: function (v) {
            if (v === '' && !ctx.house) return ctx.unown([k]);
            return ctx.put(k, num ? Number(v) : v);
          } });
      }
      saverTog(ctx, label, k, sub) {
        return K.toggle({ label: label, sub: this.saverSays(ctx, k, sub), on: !!ctx.cur[k], sk: 'saver:' + k, onChange: function (on) { ctx.put(k, on); } });
      }
      // a sub-page's way back to All Screens' rows: the keys this page holds, when the screen has any of its own
      saverUseHouse(c, ctx, keys, label) {
        if (ctx.house || !ctx.own(keys)) return;
        c.appendChild(K.group({}, [K.button({ label: label, fk: 'saver:use-house:' + keys[0], onClick: function () { ctx.unown(keys); } })]));
      }

      // WHAT SHOWS, WHAT'S BETWEEN, HOW PHOTOS SHOW: their row's value
      saverDesignSays(o) {
        var d = (o.designs || []).filter(function (x) { return x.id === o.active_design; })[0];
        if (d) return d.name;
        var big = o.layout && o.layout.big && o.layout.big.kind;
        return o.show === 'clock' ? 'Clock' : M.showName(o.show === 'both' ? 'photos' : o.show) + (big === 'time' && o.show !== 'clock' ? ' with the Time' : '');
      }
      saverSlidesOn(o) {
        var sky = o.show === 'forecast' || o.clock_bg === 'forecast' || o.clock_bg === 'skyonly', photos = o.show === 'photos' || o.show === 'both';
        return [(photos ? o.show === 'both' : o.show === 'clock' && !sky && o.extra_forecast) && 'Forecast', (o.music_first || o.music_slide) && 'Music Full Screen',
                o.extra_music && !o.music_first && !o.music_slide && 'Music', !sky && o.weather_slide && 'Weather', o.energy_slide && 'Home Energy',
                o.holiday_slide && 'Holidays', o.timer_slide !== false && 'Timers'].filter(Boolean);
      }
      saverPhotosOn(o) {
        var bg = o.clock_bg || 'gradient';
        return o.show === 'photos' || o.show === 'both' || (o.show === 'clock' && (bg === 'photos' || bg === 'landscapes'));
      }
      // Night Mode does something only where the design shows the time large: the Clock, a big time, Glance and Month
      saverBigTime(o) {
        var big = o.layout && o.layout.big && o.layout.big.kind;
        return o.show === 'clock' || o.show === 'glance' || o.show === 'month' || big === 'time';
      }

      // A SCREEN'S SCREENSAVER (phase 33, decision 10): its switch on top -- the screen's tablets run it -- and while it
      // is on, the page All Screens' is, every row its own or Same as All Screens
      saverPage(c, x, b, path) {
        var self = this, gen = !!x.generated, wp = gen && b.screensaver_engine === 'wallpanel';
        var mine = (b.tablets || []).filter(function (tid) { return self.tabs()[tid]; });
        var foot = [];
        if (!mine.length) foot.push('It runs only on a wall tablet: add the tablet that shows this screen.');
        else if (b.screensaver) foot.push('It runs on this screen’s wall tablets, never on a desk or a phone opening it.');
        else foot.push('Off, this screen’s wall tablets stay on the dashboard until their Sleep Screen darkens them.');
        if (b.screensaver && !gen) foot.push('If this dashboard’s own YAML has an hk_screensaver block, that is used instead.');
        c.appendChild(K.group({ footer: foot.join(' ') || null }, [K.toggle({ label: 'Screensaver', sub: 'On this screen’s wall tablets', sk: 'b:screensaver', on: !!b.screensaver,
          onChange: function (on) { self.setB(path, { screensaver: on }); } })]));
        if (!b.screensaver) return;
        if (wp) {
          c.appendChild(K.group({}, [K.nav({ label: 'WallPanel Options', href: '#/screens/' + encodeURIComponent(path) + '/wallpanel', sk: 'b:wallpanel_options' })]));
          this.engineGroup(c, b, path);
          return;
        }
        this.saverBody(c, this.saverCtx(path));
        c.appendChild(this.saverEntities(b, path));
      }

      // THE PAGE ITSELF, at both levels (decision 10): What It Shows, When, Photos, the Side Pane and Advanced, then the
      // way back to All Screens' (a screen) or to the defaults (All Screens)
      saverBody(c, ctx) {
        var self = this, cur = ctx.cur, base = ctx.base, L = M.saverLayers;
        var designKeys = Object.keys(cur).filter(function (k) { return !L.isPage(k); });
        var photosOn = this.saverPhotosOn(cur), slides = this.saverSlidesOn(cur);
        // WHAT IT SHOWS: the design (the editor), the photos' source, the slides between
        var hx = this.host(), what = [K.nav({ label: 'Design', value: this.saverDesignSays(cur), href: base + '/editor', sk: 'saver:editor',
          sub: this.saverSays(ctx, designKeys, 'Its face, background and pieces, in the editor') })];
        if (ctx.house) {
          var ph = String(this.hs('look.photos') || '');
          what.push(K.nav({ label: 'Photos', value: /^(?!media-source:)[a-z-]+:\/\//.test(ph) ? 'An Album' : ph ? 'Home Assistant Folder' : 'None', href: base + '/photos', sk: 'saver:photos' }));
        } else if (photosOn && hx && typeof hx.extend === 'function') {
          what.push(K.nav({ label: 'Photos', sub: 'All Screens’ photos, or an album for this screen', href: base + '/photos', sk: 'saver:photos' }));
        }
        what.push(K.nav({ label: 'Slides', value: !slides.length ? 'None' : slides.length === 1 ? slides[0] : slides.length + ' Slides',
          sub: this.saverSays(ctx, this.saverSlideKeys(), slides.length ? null : 'Now and then, over the screensaver'), href: base + '/slides', sk: 'saver:slides' }));
        c.appendChild(K.group({ header: 'What It Shows',
          footer: ctx.house ? null : 'Changing the design in the editor makes it this screen’s own; each other row stays All Screens’ until it changes here.' }, what));
        // WHEN: Starts After -- the one timer -- and Night Mode where the time shows large (a touch keeps the screen In Use
        // for Starts After less a minute: For Automations says so)
        var night = this.saverBigTime(cur) || cur.clock_night !== 'off';
        var when = [this.saverSel(ctx, 'Starts After', 'starts_after', [60, 120, 180, 300, 600, 900, 1800].map(function (n) { return [n, MIN(n)]; }), 'Untouched for this long', MIN)];
        if (night && this.saverKnown('clock_night')) when = when.concat(this.clockNightRows(ctx));
        c.appendChild(K.group({ header: 'When', footer: when.length > 1 ? 'Night Mode works wherever the design shows the time large: the Clock, a big time, Glance and Month.' : null },
          when));
        // PHOTOS: how they show (one page), only where photos show
        if (photosOn) {
          c.appendChild(K.group({ header: 'Photos' }, [K.nav({ label: 'How Photos Show', href: base + '/photos-how', sk: 'saver:photos-how',
            value: (cur.photo_layout === 'mosaic' ? 'Mosaic, ' : '') + MIN(cur.each_photo),
            sub: this.saverSays(ctx, this.saverPhotoKeys(), null) })]));
        }
        // THE SIDE PANE beside it, and the rest (Fade Back, the layout's removal, WallPanel)
        c.appendChild(K.group({}, [this.paneLink(ctx.path, 'saver', 'saver:side_pane'),
          K.nav({ label: 'Advanced', href: base + '/advanced', sk: 'saver:advanced', sub: this.saverSays(ctx, ['fade_back'], null) })]));
        if (ctx.house) this.saverScreens(c);
        // BACK TO ALL SCREENS' (a screen with rows of its own), or to the defaults (All Screens)
        if (!ctx.house && ctx.own(Object.keys(cur))) {
          c.appendChild(K.group({}, [K.button({ label: 'Use All Screens’ Screensaver…', destructive: true, fk: 'saver:use-house', sk: 'saver:use-house', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Use All Screens’ Screensaver?', message: 'Every row this screen set itself goes back to All Screens’, its design too.',
                                         ok: 'Use All Screens’', destructive: true }).then(function (yes) { if (yes) ctx.unown(null); });
          } })]));
        }
        if (ctx.house && M.saverCustom(cur)) {
          c.appendChild(K.group({}, [K.button({ label: 'Reset to Defaults…', destructive: true, fk: 'saver:house-reset', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Use the default screensaver options?', message: 'The settings for All Screens go back to their defaults.',
                                         ok: 'Use Defaults', destructive: true }).then(function (yes) {
              if (yes) self.setH({ 'look.saver': self.saverOut(M.saverOptions(null)) });
            });
          } })]));
        }
      }

      // the keys of the Slides page and of How Photos Show (Use All Screens' on each lets these go)
      saverSlideKeys() {
        return ['music_first', 'music_slide', 'extra_music', 'extra_forecast', 'weather_slide', 'energy_slide', 'holiday_slide', 'timer_slide', 'timer_often',
                'extra_every', 'extra_for', 'forecast_every', 'weather_hide', 'energy_hide', 'forecast_layout', 'forecast_big', 'forecast_planted', 'band',
                'holiday_pick', 'holiday_one', 'holiday_days', 'holiday_off', 'holiday_own', 'holiday_fx', 'holiday_outdoors', 'holiday_hide'];
      }
      saverPhotoKeys() {
        return ['each_photo', 'order', 'zoom', 'fill', 'photo_layout', 'mosaic_change', 'mosaic_color', 'mosaic_count', 'mosaic_every', 'mosaic_gap', 'mosaic_line',
                'mosaic_random', 'portrait_fill', 'portrait_blur', 'portrait_dim', 'portrait_zoom', 'portrait_x', 'portrait_y',
                'landscape_blur', 'landscape_dim', 'landscape_zoom', 'landscape_x', 'landscape_y'];
      }

      // ALL SCREENS' SCREENS: each screen whose screensaver is on, and whether it has rows of its own; and those whose
      // Side Pane in the screensaver is their own (2026-11-01, the owner: "the kitchen keeps showing the Side Pane for
      // the screensaver, even though it's disabled" -- All Screens' was off, the Kitchen's its own)
      saverScreens(c) {
        var self = this, bds = this.data.boards || {};
        var name = function (p) { return (self.dash(p) || { title: p }).title; };
        var savers = Object.keys(bds).filter(function (p) { return bds[p].screensaver; });
        if (savers.length) {
          c.appendChild(K.group({ header: 'Screens', footer: 'A screen’s own rows win over these; everything else on it follows All Screens.' }, savers.map(function (p) {
            return K.nav({ label: name(p), value: M.saverFollows(bds[p]) ? 'Same as All Screens' : 'Just This Screen',
                           href: '#/screens/' + encodeURIComponent(p) + '/screensaver', sk: 'saver:screen:' + p });
          })));
        }
        var housePane = M.paneSaverSummary(this.paneNow(null));
        var ownPane = Object.keys(bds).filter(function (p) {
          return !!(bds[p].screensaver && bds[p].side_pane && bds[p].side_pane.saver) && M.paneSaverSummary(self.paneNow(p)) !== housePane;
        });
        if (ownPane.length) {
          c.appendChild(K.group({ header: 'Side Pane on These Screens', footer: ownPane.length === 1 ? 'This screen has a Side Pane of its own in the screensaver, whatever All Screens’ says.'
              : 'These screens have a Side Pane of their own in the screensaver, whatever All Screens’ says.' }, ownPane.map(function (p) {
            return K.nav({ label: name(p), value: M.paneSaverSummary(self.paneNow(p)), href: '#/screens/' + encodeURIComponent(p) + '/sidepane', sk: 'saver:side_pane:' + p });
          })));
        }
      }

      // SLIDES (decision 12): one set of rows whatever the screensaver shows -- each slide, then How Often (minutes) and
      // Show For (seconds). The forecast over the photos is Photos & Forecast; over a clock it comes now and then.
      saverSlidesPage(c, ctx) {
        var self = this, cur = ctx.cur, base = ctx.base, tog = function (label, k, sub) { return self.saverTog(ctx, label, k, sub); };
        var sky = cur.show === 'forecast' || cur.clock_bg === 'forecast' || cur.clock_bg === 'skyonly', photos = cur.show === 'photos' || cur.show === 'both';
        var rows = [];
        if (photos) {
          rows.push(K.toggle({ label: 'Forecast', sub: this.saverSays(ctx, 'show', 'The forecast over the live sky, between the photos.'), on: cur.show === 'both',
                               sk: 'saver:slide_forecast', onChange: function (on) { ctx.put('show', on ? 'both' : 'photos'); } }));
        } else if (cur.show === 'clock' && !sky) rows.push(tog('Forecast', 'extra_forecast', 'Today, the next hours and the coming days, over the live sky.'));
        if ((photos && (cur.show === 'both' || cur.fallback)) || (cur.show === 'clock' && !sky && cur.extra_forecast)) {
          rows.push(K.nav({ label: 'Forecast Look', value: cur.forecast_layout === 'big' ? 'Big' : 'Classic', href: base + '/forecast', sk: 'saver:forecast_layout' }));
        }
        rows.push(tog('Music Full Screen', 'music_first', 'While something plays: the album art, the song and what’s up next.'));
        // (an older Music slide -- a turn among the others -- shows while it is on, so it can be turned off)
        if (cur.extra_music && !cur.music_first) rows.push(tog('Music as a Slide', 'extra_music', 'What’s playing, in its turn.'));
        if (!sky) rows = rows.concat(this.weatherRows(cur, tog, base + '/weather'));
        rows = rows.concat(this.energyRows(cur, tog, base + '/energy'));
        if (this.saverKnown('holiday_slide')) rows = rows.concat(this.holidayRows(cur, tog, base + '/holiday'));
        if (this.saverKnown('timer_slide')) {
          rows.push(K.toggle({ label: 'Timers', sub: this.saverSays(ctx, 'timer_slide', 'Only while a timer runs, and always for its last minute.'), on: cur.timer_slide !== false,
                               sk: 'saver:timer_slide', onChange: function (on) { ctx.put('timer_slide', on); } }));
          if (cur.timer_slide !== false) {
            rows.push(this.saverSel(ctx, 'Timers Come Up', 'timer_often', [['more', 'More Often'], ['same', 'As Often as the Others']]));
          }
        }
        c.appendChild(K.group({ footer: 'They take turns; Music Full Screen takes the screen while something plays. A slide waits while Night Mode is on.' }, rows));
        var on = this.saverSlidesOn(cur);
        if (on.length) {
          var EV = M.saverLayers.EVERY.map(function (n) { return [n, n === 1 ? 'Every Minute' : 'Every ' + n + ' Minutes']; });
          var FOR = [15, 30, 60, 120].map(function (n) { return [n, MIN(n)]; });
          var mins = function (n) { return n === 1 ? 'minute' : n + ' minutes'; };
          c.appendChild(K.group({ header: 'Timing', footer: 'Every ' + mins(cur.extra_every) + ' a slide fades in for ' + MIN(cur.extra_for).toLowerCase() +
              (photos ? ', between two photos' : '') + ', then the screensaver comes back.' }, [
            this.saverSel(ctx, 'How Often', 'extra_every', EV, null, function (n) { return 'Every ' + n + ' Minutes'; }),
            this.saverSel(ctx, 'Show For', 'extra_for', FOR, null, MIN)]));
        }
        this.saverUseHouse(c, ctx, this.saverSlideKeys(), 'Use All Screens’ Slides');
      }

      // HOW PHOTOS SHOW (decision 10): the slideshow -- Layout and the mosaic, Order, Each Photo For, Slow Zoom -- and how a
      // portrait and a landscape photo each sit on the screen (a change turns the preview to a photo of that shape)
      saverPhotosHowPage(c, ctx) {
        var mo = this.saverKnown('photo_layout') && ctx.cur.photo_layout === 'mosaic';
        this.saverPhotoGroups(c, ctx);
        this.saverShape(c, ctx, 'portrait', mo);
        this.saverShape(c, ctx, 'landscape', mo);
        this.saverUseHouse(c, ctx, this.saverPhotoKeys(), 'Use All Screens’ Photo Settings');
      }

      // THE WALLPAPER behind the clock (the editor's Background: Wallpaper, its Choose the Wallpaper): the dashboard's own
      // picker -- the four wallpapers and the six motion themes, one Color; its night version follows the sun, its motion the Speed
      saverWallpaperPage(c, ctx) {
        var cur = ctx.cur;
        if (!this.saverKnown('clock_wallpaper')) return;
        this.wallpaperGroup(c, { value: cur.clock_wallpaper || 'aurora', color: cur.clock_wallpaper_color || 'blue', fk: 'swall', sk: 'saver:clock_wallpaper',
          saver: true, moving: (cur.clock_speed != null ? cur.clock_speed : (cur.clock_motion === 'still' ? 0 : 35)) > 0,
          onSet: function (v) { ctx.put('clock_wallpaper', v); }, onColor: function (v) { ctx.put('clock_wallpaper_color', v); } });
      }

      // ADVANCED: the way back to the dashboard, the editor's layout let go, and (a screen) WallPanel instead
      saverAdvancedPage(c, ctx, x) {
        var self = this, cur = ctx.cur;
        if (this.saverKnown('fade_back')) {
          var FADES = [[0, 'Instant'], [500, '0.5 Seconds'], [1000, '1 Second'], [2000, '2 Seconds']];
          c.appendChild(K.group({ footer: 'From the screensaver to the dashboard, after a touch or when its switch turns off.' }, [
            this.saverSel(ctx, 'Fade Back', 'fade_back', FADES, null, function (v) { return (v / 1000) + ' Seconds'; })]));
        }
        if (cur.layout) {
          c.appendChild(K.group({ footer: 'The screensaver is drawn as its Show was before the editor laid it out. Its other settings stay.' }, [
            K.button({ label: 'Remove the Layout…', destructive: true, fk: 'saver:layout-off', onClick: function () {
              K.confirm(self.shadowRoot, { title: 'Remove the Layout?', message: 'The screensaver is drawn as its Show was before the editor. Its other settings stay.', ok: 'Remove',
                destructive: true }).then(function (yes) { if (yes) ctx.put('layout', null); });
            } })]));
        }
        if (!ctx.house && x && x.generated) this.engineGroup(c, ctx.b, ctx.path);
      }

      // THE SCREENSAVER'S ROUTES ON A SCREEN (#/screens/<k>/screensaver/...): the page, its sub-pages and the editor
      saverRoute(x, b, path, sub, mk, base) {
        var self = this, back = ['Screensaver', base + '/screensaver'], ctx = function () { return self.saverCtx(path); };
        var page = function (title, body, flags) { return Object.assign(mk(title, body, back), { saverPreview: true }, flags || {}); };
        var s = sub[1] || '';
        // (Photo Layout is on How Photos Show since phase 33: its old address goes there)
        if (s === 'layout') { this.saverForward(base + '/screensaver/photos-how'); s = 'photos-how'; }
        if (s === 'photos') {
          return page('Photos', function (c) { self.saverPhotosPage(c, ctx().cur, ctx().put, false, { screen: path, title: x.title }, false); });
        }
        if (s === 'photos-how') return page('How Photos Show', function (c) { self.saverPhotosHowPage(c, ctx()); });
        if (s === 'slides') return page('Slides', function (c) { self.saverSlidesPage(c, ctx()); });
        if (s === 'advanced') return page('Advanced', function (c) { self.saverAdvancedPage(c, ctx(), x); });
        if (s === 'wallpaper') return page('Wallpaper', function (c) { self.saverWallpaperPage(c, ctx()); });
        if (s === 'forecast') return page('Forecast Look', function (c) { self.saverForecastPage(c, ctx().cur, ctx().put); }, null);
        if (s === 'weather') return page('Weather', function (c) { self.saverWeather(c, ctx().cur, ctx().put); }, { saverWeather: true });
        if (s === 'holiday') return page('Holidays', function (c) { self.saverHoliday(c, ctx().cur, ctx().put); }, { saverHoliday: true });
        if (s === 'energy') return page('Home Energy', function (c) { self.saverEnergy(c, ctx().cur, ctx().put); }, { saverEnergy: true });
        // (the Clock Style page is the editor's now, Look -> Big -> Face: its old address opens the editor)
        if (s === 'editor' || s === 'clock-style') {
          return this.saverEditorPage(path, { path: path, title: x.title, designId: sub[2] || '', back: back, options: this.saverNow(path) });
        }
        return Object.assign(mk('Screensaver', function (c) { self.saverPage(c, x, (self.data.boards || {})[path] || b, path); }),
                             { saverPreview: !!b.screensaver });
      }
      // ...and All Screens' (#/house/screensaver/...): the preview a screen that follows them, else any with its screensaver on
      saverHouseRoute(sub, title, base) {
        var self = this, bd = this.data.boards || {}, ctx = function () { return self.saverCtx(null); };
        var withSaver = Object.keys(bd).filter(function (p) { return bd[p].screensaver && bd[p].screensaver_engine !== 'wallpanel'; });
        var pv = withSaver.filter(function (p) { return M.saverFollows(bd[p]); })[0] || withSaver[0];
        var back = [title, base];
        var page = function (tt, body, flags) {
          var pg = Object.assign({ title: tt, back: back, body: body }, flags || {});
          if (pv) { pg.preview = pv; pg.saverPreview = true; pg.saverHouse = true; }
          return pg;
        };
        var s = sub[0] || '';
        if (s === 'layout') { this.saverForward(base + '/photos-how'); s = 'photos-how'; }
        if (s === 'editor' || s === 'clock-style') {
          return this.saverEditorPage('house', { house: true, path: pv || '', previewPath: pv, title: 'All Screens', back: back, options: this.saverHouseNow() });
        }
        if (s === 'photos') {
          return page('Photos', function (c) {
            self.saverPhotosPage(c, ctx().cur, ctx().put, true, { photos: self.hs('look.photos'), set: function (v) { return self.setH({ 'look.photos': v }); } });
          });
        }
        if (s === 'photos-how') return page('How Photos Show', function (c) { self.saverPhotosHowPage(c, ctx()); });
        if (s === 'slides') return page('Slides', function (c) { self.saverSlidesPage(c, ctx()); });
        if (s === 'advanced') return page('Advanced', function (c) { self.saverAdvancedPage(c, ctx(), null); });
        if (s === 'wallpaper') return page('Wallpaper', function (c) { self.saverWallpaperPage(c, ctx()); });
        if (s === 'forecast') return page('Forecast Look', function (c) { self.saverForecastPage(c, ctx().cur, ctx().put); });
        if (s === 'weather') return page('Weather', function (c) { self.saverWeather(c, ctx().cur, ctx().put); }, { saverWeather: true });
        if (s === 'holiday') return page('Holidays', function (c) { self.saverHoliday(c, ctx().cur, ctx().put); }, { saverHoliday: true });
        if (s === 'energy') return page('Home Energy', function (c) { self.saverEnergy(c, ctx().cur, ctx().put); }, { saverEnergy: true });
        var spg = page(title, function (c) { self.saverBody(c, ctx()); }, { top: true,
          scope: 'What every screen’s screensaver shows, unless it sets a row of its own. When a tablet goes dark is its own Sleep Screen’s (Wall Tablets).' });
        delete spg.back;
        return spg;
      }
      saverForward(to) { try { history.replaceState(null, '', to); } catch (e) { /* no history */ } }

      // THE PHOTOS' PAGE (phase 32): where they come from, one row on the Screensaver. All Screens' is a Home Assistant folder (or
      // an album the host keeps, picked inside); a screen's is its own album or All Screens'. `house`: whether this is All Screens'
      saverPhotosPage(c, cur, put, house, ctx, noFallback) {
        var self = this, hx = this.host(), drew = false;
        if (house) {
          c.appendChild(K.group({ footer: 'A media folder (media-source://…) of the photos every screen’s screensaver shows.' }, [
            K.text({ label: 'Screensaver Photos', sk: 'look.photos', value: self.hs('look.photos'), placeholder: 'media-source://…', error: self.err('look.photos'),
                     onCommit: function (v) { self.setH({ 'look.photos': v }); } })]));
          drew = true;
        }
        // THE HOST'S OWN (extend): nothing in Home Assistant. An album, its photos and the import
        if (hx && typeof hx.extend === 'function') {
          var n = c.childElementCount;
          try { hx.extend(house ? 'house-saver' : 'saver', c, ctx, self); } catch (e) { /* the host's own group */ }
          drew = drew || c.childElementCount > n;
        }
        if (!drew) c.appendChild(K.group({ footer: 'This screen shows the photos in All Screens → Screensaver.' }, []));
        if (cur.show !== 'clock' && !noFallback) {
          c.appendChild(K.group({ footer: cur.fallback ? 'When the photos folder has none, or can’t be read, the forecast shows instead.'
              : 'When the photos folder has none, or can’t be read, the screen stays dark.' },
            [K.toggle({ label: 'Forecast When There Are No Photos', sk: 'saver:fallback', on: !!cur.fallback, onChange: function (on) { put('fallback', on); } })]));
        }
      }


      // THE FORECAST'S LOOK where it comes in among the photos, or in their place (2026-11-01, the owner: "there is no way of setting
      // Big layout for forecast with Photos"): a slide's look, not a layout's (the forecast as the background is laid out in the editor)
      saverForecastPage(c, cur, put) {
        var self = this;
        var tog = function (label, k, sub) {
          return K.toggle({ label: label, sub: sub, on: !!cur[k], sk: 'saver:' + k, onChange: function (on) { put(k, on); } });
        };
        var bigFc = cur.forecast_layout === 'big';
        c.appendChild(K.group({ footer: 'Classic: the live sky and the land, today, the next hours and the coming days. Big: Big ' +
          'Weather, the temperature or the time very large, standing on the ground.' },
          [K.previewPick({ label: 'Layout', sk: 'saver:forecast_layout', value: bigFc ? 'big' : 'classic', options: M.FORECAST_LAYOUTS,
             picture: function (v, w, ht) { return self.saverThumb(w, ht, v === 'big' ? 'weather' : 'forecast', cur); },
             onChange: function (v) { put('forecast_layout', v); } })].concat(
            bigFc && self.saverKnown('forecast_big') ? [K.seg({ label: 'Big Number', sk: 'saver:forecast_big', value: cur.forecast_big === 'clock' ? 'clock' : 'temp',
              options: M.FORECAST_BIG, onChange: function (v) { put('forecast_big', v); } })] : [],
            bigFc && cur.forecast_big === 'clock' && self.saverKnown('forecast_planted') ? [K.toggle({ label: 'Planted Numerals',
              sub: 'The time as solid figures standing in the meadow, with shadows from the sky’s sun and grass at their feet.',
              on: cur.forecast_planted !== false, sk: 'saver:forecast_planted', onChange: function (on) { put('forecast_planted', on); } })] : [],
            !bigFc ? [tog('Details on the Forecast', 'band', 'Today, the next hours and the coming days along the bottom. Off: the sky and the landscape alone.')] : [])));
      }
    };
    KIT.install(Methods);
  };
})();
