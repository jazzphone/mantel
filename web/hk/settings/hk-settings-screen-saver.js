// hk-settings-screen-saver.js - a screen's screensaver: its styles, faces, thumbnails, editor page and groups.
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
      // AN OPTIONS PAGE: OPTION_PAGES' controls over the options mapping, then
      // the way to the rest of it in YAML
      // THE SCREENSAVER'S OPTIONS (HK Frontend's own, hk-saver.js). Every
      // control saves the whole set; the defaults are settings.py's.
      // A SCREEN'S SCREENSAVER OPTIONS: the settings for All Screens (the
      // default -- `screensaver_options` null), or its own.
      // WHAT IS SAVED: only the options Home Assistant's running HK Frontend
      // knows (the keys of All Screens' options, which it fills in). These
      // files are served the moment they change, its Python only after a
      // restart: a new option sent to an older one had every save refused
      // (Fade Back, 2026-10-04).
      saverKnown(k) {
        var h = this.hs('look.saver');
        return !h || typeof h !== 'object' || Object.prototype.hasOwnProperty.call(h, k);
      }

      saverOut(o) {
        var self = this, out = {};
        Object.keys(o).forEach(function (k) { if (self.saverKnown(k)) out[k] = o[k]; });
        // Timing, photos and slides can also be edited outside the layout editor.
        // Keep those changes with the selected design without mutating inherited settings.
        if (out.active_design && out.designs) {
          var snapshot = Object.assign({}, out); delete snapshot.designs; delete snapshot.active_design;
          out.designs = out.designs.map(function (d) { return d.id === out.active_design ? Object.assign({}, d, { options: snapshot }) : d; });
        }
        return out;
      }

      // one option saved, for a screen of its own or for All Screens
      saverPutB(path) {
        var self = this;
        return function (k, v) {
          var b = (self.data.boards || {})[path] || {}, o = M.saverOptions(b.screensaver_options);
          if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
          return self.setB(path, { screensaver_options: self.saverOut(o) });
        };
      }

      saverPutH() {
        var self = this;
        return function (k, v) {
          var o = M.saverOptions(self.hs('look.saver'));
          if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
          return self.setH({ 'look.saver': self.saverOut(o) });
        };
      }

      // CLOCK STYLE (2026-10-13): the fourteen faces, the preview showing the
      // one chosen -- the same style for Show: Clock and a Large clock
      // (2026-10-30: each with a small picture of itself; Liquid, Giant and
      // Scattered Numerals bring their own colour)
      saverStyle(c, cur, put) {
        var self = this, cr = this.clockColorRow(cur, put);
        if (cr) c.appendChild(K.group({ footer: 'Each style keeps its own color.' }, [cr]));
        c.appendChild(K.group({ footer: 'The same style for Show: Clock and a Large clock over the photos or the forecast. Every style shows the date' +
            (M.CLOCK_OWN_GROUND ? ' but Liquid and Scattered Numerals. Liquid, Giant Numerals and Scattered Numerals bring their own color, in place of the background behind the clock.' : '.') },
          M.CLOCK_STYLES.map(function (st) {
            return K.check({ label: st[1], sub: st[2], on: (cur.clock_style || 'classic') === st[0], fk: 'saver:clock_style:' + st[0],
                             thumb: self.saverThumb(64, 44, 'clock:' + st[0], cur),
                             onClick: function () { put('clock_style', st[0]); } });
          })));
        // Today's line of what's playing, under its weather (2026-11-01, the owner: "I don't see a place to turn this off")
        if ((cur.clock_style || 'classic') === 'today') {
          c.appendChild(K.group({ footer: 'Today shows the weather under the time, and the song playing in the house under it, while something plays.' },
            [K.toggle({ label: 'Weather', sk: 'saver:clock_today_weather', on: cur.clock_today_weather !== false,
                       onChange: function (on) { put('clock_today_weather', on); } }),
             K.toggle({ label: 'What’s Playing', sk: 'saver:clock_today_music', on: cur.clock_today_music !== false,
                        onChange: function (on) { put('clock_today_music', on); } })]));
        }
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
              C.mount(inner, { style: o.clock_style || 'classic', options: o.clock_options, still: true, drift: false, h24: !!o.clock_24, bg: own ? 'none' : bgId, speed: 0,
                               ground: !own, scrim: false, color: (o.clock_colors || {})[o.clock_style || 'classic'] || '', client: self.client,
                               wallpaper: { id: o.clock_wallpaper || 'aurora', color: o.clock_wallpaper_color || 'blue' } });
            } else if (/^clock/.test(what)) {
              var style = what.indexOf(':') > 0 ? what.split(':')[1] : (o.clock_style || 'classic');
              C.mount(inner, { style: style, options: o.clock_options, still: true, drift: false, h24: !!o.clock_24, bg: 'gradient', speed: 0,
                               color: (o.clock_colors || {})[style] || '', client: self.client });
            } else {
              F.mount(inner, { kind: what, still: true, h24: !!o.clock_24, look: o.day_look, client: self.client, clocks: C });
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

      // THE EDITOR'S ROW, first on a Screensaver page; with a layout saved, what of the page it takes the place of, and the
      // way back (the Show drawn as it was)
      saverEditRow(c, href, cur, put, note) {
        var self = this, lay = !!(cur && cur.layout), active = (cur.designs || []).find(function (d) { return d.id === cur.active_design; });
        // (the page below is what can't be laid out: the photos, the slides, Night Mode and the timing)
        c.appendChild(K.group({ footer: (note ? note + ' ' : '') + 'What shows and how it looks \u2014 the background, the time, the widgets and the corners \u2014 is set in the editor' +
            (lay ? '.' : ', starting from how it looks today.') + ' Below: the photos, the slides, Night Mode and the timing.' },
          [K.nav({ label: 'Designs & Editor', value: active ? active.name : 'Current Screensaver', sub: (cur.designs || []).length + ' saved designs · Faces, backgrounds and all widgets',
            icon: 'mdi:pencil', href: href, sk: 'saver:editor' })]
            .concat(lay && put ? [K.button({ label: 'Remove the Layout\u2026', destructive: true, fk: 'saver:layout-off', onClick: function () {
              K.confirm(self.shadowRoot, { title: 'Remove the Layout?', message: 'The screensaver is drawn as its Show was before the editor. Its other settings stay.', ok: 'Remove',
                destructive: true })
                .then(function (yes) { if (yes) put('layout', null); });
            } })] : [])));
      }

      saverPage(c, x, b, path) {
        var self = this, house = M.saverFollows(b);
        var cur = M.saverOptions(house ? this.hs('look.saver') : b.screensaver_options);
        // THE EDITOR (2026-11-01): the whole screensaver laid out on the screen itself
        this.saverEditRow(c, '#/screens/' + encodeURIComponent(path) + '/screensaver/editor', cur, house ? null : function (k, v) {
          var o = M.saverOptions(cur); o[k] = v; return self.setB(path, { screensaver_options: self.saverOut(o) });
        }, house ? 'Editing gives this screen a screensaver of its own, starting from All Screens\u2019.' : null);
        c.appendChild(K.group({ footer: house
            ? 'This screen uses the screensaver settings for All Screens (All Screens → Screensaver). Off: it gets its own, starting from these.'
            : 'This screen has its own screensaver settings. On: it uses the settings for All Screens again.' }, [
          K.toggle({ label: 'Same as All Screens', sk: 'saver:house', on: house, onChange: function (on) {
            self.setB(path, { screensaver_options: on ? null : self.saverOut(cur) });
          } })].concat(house ? [K.nav({ label: 'Screensaver for All Screens', value: M.saverSummary(cur),
                                        href: '#/house/screensaver', sk: 'saver:house-page' })] : [])));
        // THE HOST'S OWN, for this screen's screensaver (extend): nothing in
        // Home Assistant. Where the Photos group is while the screen has
        // options of its own (2026-10-30), else under Same as All Screens
        var hx = this.host();
        // (with options of its own, only where its show has photos: the Photos
        // show, or the clock over them)
        var usesPhotos = house || cur.show === 'photos' || cur.show === 'both' || (cur.show === 'clock' && cur.clock_bg === 'photos');
        var photoSrc = function (c2) {
          if (!hx || typeof hx.extend !== 'function' || !usesPhotos) return false;
          var n = c2.childElementCount;
          try { hx.extend('saver', c2, { screen: path, title: x.title }, self); } catch (e) { /* the host's own group */ }
          return c2.childElementCount > n;
        };
        if (house) photoSrc(c);
        // (the Side Pane is the screen's own even while its screensaver is All Screens': what this screen shows beside it)
        if (house) c.appendChild(
          K.group({ header: 'Side Pane', footer: 'This screen’s Side Pane in the screensaver, set on its Side Pane page: it is the screen’s own even while the rest follows All Screens.' },
          [this.paneLink(path, 'saver', 'saver:side_pane')]));
        if (!house) {
          this.saverGroups(c, cur, function (k, v) {
            var o = M.saverOptions(cur); if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
            return self.setB(path, { screensaver_options: self.saverOut(o) });
          }, '#/screens/' + encodeURIComponent(path) + '/screensaver/clock-style', b.idle_room ? this.areaName(b.idle_room) : x.title, photoSrc);
          if (M.saverCustom(cur)) {
            c.appendChild(K.group({}, [K.button({ label: 'Reset to Defaults…', destructive: true, fk: 'saver:reset', onClick: function () {
              K.confirm(self.shadowRoot, { title: 'Use the default screensaver options?',
                message: 'This removes saved designs and resets the screensaver, widgets and other options to their defaults.',
                                           ok: 'Use Defaults', destructive: true }).then(function (yes) {
                if (yes) self.setB(path, { screensaver_options: self.saverOut(M.saverOptions(null)) });
              });
            } })]));
          }
        }
        c.appendChild(this.saverEntities(b, path));
        if (x.generated) this.engineGroup(c, b, path);
      }

      // THE OPTIONS THAT LIVE OUTSIDE THE EDITOR, for a screen of its own or for All Screens: `cur` the options in
      // force, `put(key, value)` saves one. EDIT SCREENSAVER IS WHERE IT IS LAID OUT (2026-11-01, the owner: "The editor
      // should be the primary source for modifications. Only things that really need to live outside the editor to
      // function should be on the settings page"): the background, the time and its face, colors and depth, the widgets
      // and the corners, Time Behind, the darkening and the legibility are the editor's (a screen with no layout opens
      // there as it is drawn today). Here: where the photos come from and how they show, the wallpaper chosen, what comes
      // between and how often, Night Mode, the Side Pane and the timing
      saverGroups(c, cur, put, styleHref, room, photoSrc) {
        var self = this;
        var sel = function (label, k, choices, sub) {
          var opts = choices.map(function (n) { return [String(n), MIN(n)]; });
          if (!choices.some(function (n) { return n === cur[k]; })) opts.push([String(cur[k]), MIN(cur[k])]);
          return K.select({ label: label, sub: sub, value: String(cur[k]), options: opts, sk: 'saver:' + k,
                            onChange: function (v) { put(k, Number(v)); } });
        };
        var tog = function (label, k, sub) {
          return K.toggle({ label: label, sub: sub, on: !!cur[k], sk: 'saver:' + k, onChange: function (on) { put(k, on); } });
        };
        // ONE TIMER: Starts After also decides how long a touch keeps the screen
        // In Use (a minute less, never under 15 s -- screensaver.py window_of)
        var win = Math.max(15, cur.starts_after - 60);
        var show = cur.show, fc = show === 'forecast', both = show === 'both', ck = show === 'clock', bg = cur.clock_bg || 'gradient';
        var face = show === 'glance' || show === 'month' || show === 'day';
        // (photos where the background is photos: the Photos show, Photos with the forecast between, the clock over them)
        var photos = show === 'photos' || both || (ck && (bg === 'photos' || bg === 'landscapes'));
        var mf = !!cur.music_first, muKnown = self.saverKnown('music_slide'), mu = muKnown && !!cur.music_slide;
        var enKnown = self.saverKnown('energy_slide'), en = enKnown && !!cur.energy_slide;
        var energyHref = String(styleHref || '').replace(/clock-style$/, 'energy');
        var weatherHref = String(styleHref || '').replace(/clock-style$/, 'weather'), holidayHref = String(styleHref || '').replace(/clock-style$/, 'holiday');
        var hlKnown = self.saverKnown('holiday_slide'), hl = hlKnown && !!cur.holiday_slide;
        var every = function (n) { return 'Every ' + n + ' Photos'; };
        // PHOTOS: where they come from (All Screens' folder, a host's album), then how they show (Slideshow)
        var srcDrew = photoSrc ? photoSrc(c) : false;
        if (photos) {
          if (!ck) c.appendChild(K.group({ footer: cur.fallback ? 'When the photos folder has none, or can’t be read, the forecast shows instead.'
              : 'When the photos folder has none, or can’t be read, the screen stays dark.' }, [tog('Forecast When There Are No Photos', 'fallback')]));
          this.saverPhotoGroups(c, cur, put, tog, ck, srcDrew);
        }
        // THE WALLPAPER, where the background is one (the editor's Background: Wallpaper): the dashboard's own picker --
        // the four wallpapers and the six motion themes, one Color; its night version follows the sun, its motion the Speed
        if (ck && bg === 'wallpaper' && self.saverKnown('clock_wallpaper')) {
          self.wallpaperGroup(c, { value: cur.clock_wallpaper || 'aurora', color: cur.clock_wallpaper_color || 'blue', fk: 'swall', sk: 'saver:clock_wallpaper',
            saver: true, moving: (cur.clock_speed != null ? cur.clock_speed : (cur.clock_motion === 'still' ? 0 : 35)) > 0,
            onSet: function (v) { put('clock_wallpaper', v); }, onColor: function (v) { put('clock_wallpaper_color', v); } });
        }
        // NOW AND THEN: the slides among the photos, how often, and their own options; over the forecast or a clock, the
        // screens that come in now and then (saverExtras)
        if (photos && !ck) {
          var muSlide = mu && !mf;
          var wxKnown = self.saverKnown('weather_slide'), wx = wxKnown && !!cur.weather_slide;
          var turns = [muSlide && 'the music', both && 'the forecast', wx && 'the weather', en && 'Home Energy', hl && 'the holidays'].filter(Boolean);
          c.appendChild(K.group({ header: 'Now and Then', footer: turns.length
              ? 'After every few photos a slide fades in for as long as a photo shows, then the photos go on.' +
                (turns.length > 1 ? ' ' + M.listText(turns).replace(/^t/, 'T') + ' take turns.' : '') +
                (muSlide ? ' The music only while something plays; its buttons skip or pause without closing the screensaver, and a tap on its album art opens Music.' : '') +
                (en ? ' Home Energy skips its turn until it has the day’s numbers; a tap on it opens Energy.' : '') +
                (hl ? ' The holidays only once one is near.' : '')
              : 'Slides among the photos: the forecast' + (mf ? '' : ', what’s playing') + (wxKnown ? ', the weather' : '') + (enKnown ? ', Home Energy' : '') +
                (hlKnown ? ', and the holidays.' : '.') }, [
            K.toggle({ label: 'Forecast', sub: 'The forecast over the live sky, as one of the photos. Its sky only moves while it is on screen.',
                       on: both, sk: 'saver:slide_forecast', onChange: function (on) { put('show', on ? 'both' : 'photos'); } })
          // (one key for Music Full Screen, phase 13: the editor's and this page's are the same choice -- music_first)
          ].concat(muKnown ? [tog('Music Full Screen', 'music_first', 'While something plays: the album art, the song and what’s up next, with buttons for the previous or next song.')] : [],
                   wxKnown ? this.weatherRows(cur, tog, weatherHref) : [],
                   enKnown ? this.energyRows(cur, tog, energyHref) : [],
                   hlKnown ? this.holidayRows(cur, tog, holidayHref) : [],
                   turns.length ? [K.select({ label: 'A Slide', sk: 'saver:forecast_every', value: String(cur.forecast_every),
                                      options: [3, 5, 10, 20].concat([3, 5, 10, 20].indexOf(cur.forecast_every) < 0 ? [cur.forecast_every] : [])
                                        .map(function (n) { return [String(n), every(n)]; }),
                                      onChange: function (v) { put('forecast_every', Number(v)); } })] : [])));
        } else if ((fc || ck) && enKnown) this.saverExtras(c, cur, put, tog, fc ? 'forecast' : 'clock', mf, energyHref);
        // THE FORECAST WHERE IT COMES IN (2026-11-01, the owner: "there is no way of setting Big layout for forecast with
        // Photos"): between the photos, in their place when there are none, now and then over a clock -- a slide's look,
        // not a layout's (the forecast as the background is laid out in the editor)
        var fcSlide = photos && !ck && (both || cur.fallback);
        if (fcSlide && self.saverKnown('forecast_layout')) {
          var bigFc = cur.forecast_layout === 'big';
          c.appendChild(K.group({ header: 'The Forecast', footer: 'How the forecast looks where it comes in among the photos, or in their place' +
              '. Classic: the live sky and the land, today, the next hours and the coming days along the bottom. Big: Big Weather, the temperature or the time very large, standing on the ground.' },
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
        // NIGHT MODE: the clock dim red on black at night -- a time of day, not a look
        var night = this.clockNightRows(cur, put);
        if (night.length) c.appendChild(K.group({ header: 'Night Mode', footer: 'Wherever the screensaver shows the time large: the Clock, a big time in the editor, Glance and Month.' }, night));
        // THE PANE (the Side Pane's In the Screensaver group since 2026-10-30; its page has it -- this screen's, or All
        // Screens'). ALL SCREENS' NAMES THE SCREENS WITH THEIR OWN (2026-11-01, the owner: "the kitchen keeps showing the
        // Side Pane for the screensaver, even though it's disabled" -- All Screens' was off, the Kitchen's its own)
        var panePath = this.panePath(styleHref), bds = this.data.boards || {};
        var housePane = panePath ? '' : M.paneSaverSummary(this.paneNow(null));
        var ownPane = panePath ? [] : Object.keys(bds).filter(function (pth) {
          return !!(bds[pth].screensaver && bds[pth].side_pane && bds[pth].side_pane.saver) && M.paneSaverSummary(self.paneNow(pth)) !== housePane;
        });
        c.appendChild(K.group({ header: 'Side Pane', footer: 'Sections down one side of the screen — the events, what’s playing, the weather and more — with the ' +
            (ck ? 'clock' : face ? M.showName(show) + ' face' : fc ? 'forecast' : 'photos or the forecast') + ' beside it. Set on the Side Pane page, with the Dashboard’s.' +
            (ownPane.length ? ' ' + (ownPane.length === 1 ? 'This screen has' : 'These screens have') + ' a Side Pane of their own in the screensaver, whatever All Screens’ says:' : '') },
          [this.paneLink(panePath, 'saver', 'saver:side_pane')].concat(ownPane.map(function (pth) {
            return K.nav({ label: (self.dash(pth) || { title: pth }).title, value: M.paneSaverSummary(self.paneNow(pth)),
                           href: '#/screens/' + encodeURIComponent(pth) + '/sidepane', sk: 'saver:side_pane:' + pth });
          }))));
        // BACK TO THE DASHBOARD (hk-saver.js stop): a touch or the switch
        var FADES = [[0, 'Instant'], [500, '0.5 Seconds'], [1000, '1 Second'], [2000, '2 Seconds']];
        var fadeOpts = FADES.concat(FADES.some(function (f) { return f[0] === cur.fade_back; }) ? []
          : [[cur.fade_back, (cur.fade_back / 1000) + ' Seconds']]);
        c.appendChild(K.group({ header: 'Timing', footer: 'Starts After is the one timer. The screen also counts as In Use for ' + MIN(win).toLowerCase() +
            ' after each touch (a minute less than Starts After), so the photos never come up while someone is using it, and an automation reading ' +
            'In Use never disagrees with the screensaver.' }, [
          sel('Starts After', 'starts_after', [60, 120, 180, 300, 600, 900, 1800], 'Untouched for this long.')].concat(
            photos && !ck ? [sel('Each Photo For', 'each_photo', [10, 20, 30, 60, 120, 300])] : [],
            !self.saverKnown('fade_back') ? [] : [K.select({ label: 'Fade Back', sub: 'From the screensaver to the dashboard, after a touch or when the switch turns off.',
                        value: String(cur.fade_back), sk: 'saver:fade_back',
                        options: fadeOpts.map(function (f) { return [String(f[0]), f[1]]; }),
                        onChange: function (v) { put('fade_back', Number(v)); } })])));
      }
    };
    KIT.install(Methods);
  };
})();
