// hk-settings-screen.js - a screen's own pages: Overview, the screen, its menu and tab bar, accent.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-screen'] = function (KIT) {
    var AUTO_ACCENT_TILE = KIT.AUTO_ACCENT_TILE, C = KIT.C, DOMAIN = KIT.DOMAIN, OPTION_PAGES = KIT.OPTION_PAGES,
        PN = KIT.PN, PV_SAYS = KIT.PV_SAYS;

    var F, h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      F = s.F; h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // ================================================================ PAGES
      // Each: { title, back: [label, hash], top (a sidebar page), scope (html),
      //         preview (a dashboard path), body(container) }

      // ---------------------------------------------------------- overview
      p_overview() {
        var self = this, d = this.data;
        return { title: 'Overview', top: true, scope: 'Settings for the ' + PN() + ' dashboards in this home.', body: function (c) {
          c.appendChild(K.group({ header: 'Where Settings Live' }, [
            K.info({ tile: ['mdi:tablet-dashboard', C.blue], label: 'Screens',
                     sub: 'Each screen’s own menu, Home page, pages, appearance and behavior.' }),
            K.info({ tile: ['mdi:home', C.gray], label: 'All Screens',
                     sub: 'What every screen shares. Where a screen can choose for itself, it says “Same as All Screens” until it does.' }),
            K.info({ tile: ['mdi:file-document-multiple', C.teal], label: 'Pages',
                     sub: 'Each page’s own settings — its header, status row, what’s on it and its background — on one page each: Climate, Security, Energy, Weather …' }),
            K.info({ tile: ['mdi:lightbulb-group', C.yellow], label: 'Accessories',
                     sub: 'Names, icons and rooms: the same on every screen.' })]));
          var check = self._check;
          var bad = check ? check.filter(function (l) { return l.ok === false; }).length : null;
          c.appendChild(K.group({ header: 'Setup' }, [
            K.nav({ label: 'Setup Check', href: '#/check',
                    value: check ? (bad ? bad + ' to Fix' : 'Ready') : 'Checking…' }),
            K.nav({ label: 'Setup Assistant', href: '#/setup' })]));
          c.appendChild(K.group({ header: 'In This Home' }, [
            K.info({ label: 'Screens', value: String(d.dashboards.filter(function (x) { return x.item; }).length) }),
            K.nav({ label: 'Customized Accessories', value: String(Object.keys(d.accessories.entities || {}).length), href: '#/accessories' }),
            K.nav({ label: 'Pop-ups', value: String(d.popups.length), href: '#/popups' }),
            K.nav({ label: 'Custom Pages', value: String((d.custom_pages || []).length), href: '#/pages' })]));
          var hn = self.hostNote('overview');
          if (hn) c.appendChild(K.group({ footer: hn }, []));
          if (!check && !self._checking) {
            self._checking = true;
            self.client.callWS({ type: DOMAIN + '/setup/check' }).then(function (r) {
              self._check = r.lines; self._checking = false; self.render(true);
            }, function () { self._checking = false; });
          }
        } };
      }

      // ---------------------------------------------------------- a screen
      previewCol(path, view) {
        view = view || '0';
        var self = this, x = this.dash(path);
        var col = h('aside', { class: 'pvcol', 'aria-label': 'Preview' });
        var head = h('div', { class: 'pvhead' }, [h('span', { text: 'Preview' }),
          h('a', { href: '/' + path + '/' + view, target: '_blank', rel: 'noopener', text: 'Open Screen' })]);
        // under the host's own address prefix, when it has one (hostScreenBase)
        var mbase = this.hostScreenBase();
        head.lastChild.setAttribute('href', mbase + '/' + path + '/' + view);
        col.appendChild(head);
        var pv = h('div', { class: 'pvbox' });
        var b = (this.data && this.data.boards && this.data.boards[path]) || null;
        var fr = document.createElement('iframe');
        // hk_kiosk=on (HK Frontend's) and kiosk (the Kiosk Mode plugin's): no
        // Home Assistant header or sidebar; wp_enabled=false: WallPanel never
        // runs in a preview (it would drive the real tablet's screensaver)
        fr.src = mbase + '/' + path + '/' + view + '?hk_kiosk=on&kiosk&wp_enabled=false';
        fr.title = (x ? x.title : path) + ' preview';
        fr.setAttribute('tabindex', '-1');
        pv.appendChild(fr);
        col.appendChild(pv);
        // THE SIZE: the screen as a phone, an iPad upright, a wall tablet, a
        // desk -- and a car's browser on a car screen. The frame IS that size
        // (M.previewSizes), drawn scaled to the column; changing it reloads
        // nothing. Opens on the size the screen is used at, then on the last
        // one chosen for it in this browser.
        var sizes = M.previewSizes(b);
        var chosen = null;
        try { chosen = (JSON.parse(localStorage.getItem('hk-preview-size') || '{}') || {})[path]; } catch (e) { /* private */ }
        var key = sizes.some(function (z) { return z.key === chosen; }) ? chosen : M.previewDefault(b);
        var pick = h('div', { class: 'seg pvsize', role: 'radiogroup', 'aria-label': 'Preview size' });
        var dims = h('span', { class: 'pvdim' });
        // the tablet glyph is drawn landscape (MDI's) unless the home's own symbols are here (Apple's iPad, upright):
        // then Landscape is the one turned, not Portrait
        var upright = !!(window.hkGlyphs && window.hkGlyphs.icons && window.hkGlyphs.icons.tablet);
        var btns = sizes.map(function (z, i) {
          var turn = z.icon === 'hk:tablet' && upright ? !z.rotate : !!z.rotate;
          var btn = h('button', { type: 'button', role: 'radio', 'data-size': z.key, 'aria-label': z.label, title: z.label }, [
            h('hk-icon', { icon: z.icon, class: turn ? 'rot' : '', 'aria-hidden': 'true' }),
            h('span', { class: 'lb', text: z.label }),
            h('span', { class: 'sh', text: z.short || z.label })]);
          btn.addEventListener('click', function () { choose(z.key); });
          btn.addEventListener('keydown', function (e) {
            var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            var j = (i + d + sizes.length) % sizes.length;
            btns[j].focus();
            choose(sizes[j].key);
          });
          pick.appendChild(btn);
          return btn;
        });
        if (!upright && !(window.hkGlyphs && window.hkGlyphs.icons)) {
          // the home's symbols may still be loading (hk-icons.js says when): turn the tablets then
          var glyphs = function (e) {
            if (!e || e.detail !== 'hkGlyphs') return;
            window.removeEventListener('hk-module-ready', glyphs);
            var up = !!(window.hkGlyphs && window.hkGlyphs.icons && window.hkGlyphs.icons.tablet);
            btns.forEach(function (b, k) {
              var z = sizes[k], ic = b.querySelector('hk-icon');
              if (ic && z.icon === 'hk:tablet') ic.classList.toggle('rot', up ? !z.rotate : !!z.rotate);
            });
          };
          window.addEventListener('hk-module-ready', glyphs);
        }
        var fit = function () {
          var z = sizes.filter(function (x) { return x.key === key; })[0] || sizes[0];
          var maxH = self._pvPinned ? Math.max(150, Math.round((window.innerHeight || 800) * 0.28))
            : Math.max(320, Math.min(620, (window.innerHeight || 900) - 300));
          // (the column's own padding is not room for the frame: a pinned preview has some)
          var cs = getComputedStyle(col), cw = col.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
          var f = M.previewFit(cw, maxH, z);
          fr.style.width = z.w + 'px';
          fr.style.height = z.h + 'px';
          fr.style.transform = 'scale(' + f.scale + ')';
          pv.style.width = Math.round(f.width) + 'px';
          pv.style.height = Math.round(f.height) + 'px';
          dims.textContent = z.w + ' × ' + z.h + ' · ';
          pick.classList.remove('short');
          pick.classList.toggle('short', btns.some(function (bt) {
            var lb = bt.querySelector('.lb');
            return lb.scrollWidth > lb.clientWidth;
          }));
          btns.forEach(function (bt, i) {
            var on = sizes[i].key === z.key;
            bt.setAttribute('aria-checked', on ? 'true' : 'false');
            bt.setAttribute('tabindex', on ? '0' : '-1');
          });
        };
        function choose(k) {
          if (k === key) return;
          key = k;
          try {
            var all = JSON.parse(localStorage.getItem('hk-preview-size') || '{}') || {};
            all[path] = k;
            localStorage.setItem('hk-preview-size', JSON.stringify(all));
          } catch (e) { /* private: this page only */ }
          fit();
        }
        col.appendChild(pick);
        col.appendChild(h('p', { class: 'gf' }, [dims, h('span', { class: 'pvsays', text: PV_SAYS.screen })]));
        requestAnimationFrame(fit);
        new ResizeObserver(fit).observe(col);
        this._pv = { path: path, view: view };
        this._fit = fit;
        void self;
        return col;
      }
      p_screen(path, sub) {
        var self = this, x = this.dash(path);
        var home = [this.title(), '#/'];
        if (!x) return { title: 'Screen', back: home, body: function (c) { c.appendChild(K.group({ footer: 'There’s no dashboard at /' + path + '.' }, [])); } };
        var base = '#/screens/' + encodeURIComponent(path);
        var b = this.data.boards[path];
        if (!x.item || !b) {
          return { title: x.title, top: true, back: home, rename: self.renamable(x), scope: 'This dashboard has no HK settings yet.', body: function (c) {
            c.appendChild(K.group({ footer: 'Give it its own menu, Home page and appearance. It starts from what it’s shown on — a wall tablet, a phone, a computer or a car.' },
              [K.nav({ label: 'Set Up This Screen', href: '#/add-screen/use/' + encodeURIComponent(path), cls: 'tintc' })]));
            if (x.generated && x.mode === 'storage') c.appendChild(self.deleteGroup(x));
          } };
        }
        var s = sub[0];
        if (s === 'home-grid' && x.generated) return {
          title: 'Arrange Home Grid', back: [x.title, base],
          body: function (c) {
            if (!self._gridEditors) self._gridEditors = {};
            var editor = self._gridEditors[path];
            if (!editor) {
              editor = document.createElement('hk-grid-editor');
              self._gridEditors[path] = editor;
              editor.configure({ panel: self, path: path, board: b, title: x.title,
                onCancel: function () { delete self._gridEditors[path]; self.back(base); },
                onSaved: function () { delete self._gridEditors[path]; self.back(base); } });
            }
            c.appendChild(editor);
          }
        };
        var mk = function (title, body, backTo) {
          return { title: title, back: backTo || [x.title, base], preview: path, body: body };
        };
        // (the Appearance pages: the look alone in the preview)
        var mkl = function (title, body, backTo) { return Object.assign(mk(title, body, backTo), { lookPreview: true }); };
        // A SCREEN'S MENU SETTINGS (2026-10-29): the kinds it uses, each the
        // page All Screens' is, every setting Same as All Screens until it is
        // its own (menu_own); its menu on each device is set on its page alone
        // (the device pages' addresses forward: M.routeForward)
        var mb = ['Menu', base + '/menu'];
        if (s === 'menu' && sub[1] === 'side' && (sub[2] === 'tablets' || sub[2] === 'phones')) {
          var sbk = ['Side Menu', base + '/menu/side'];
          var pickB = function (k) {
            return function (v) { var ch = {}; ch[k] = v; self.setB(path, M.menuOwnSet(b, ch)); self.back(sbk[1]); };
          };
          return sub[2] === 'phones'
            ? mk('Button Style on Phones', function (c) { self.phoneStyle(c, M.phoneButton(b), pickB('button_phone'), b.swipe); }, sbk)
            : mk('Button Style', function (c) { self.menuStyle(c, b.menu, pickB('menu'), b.swipe); }, sbk);
        }
        var mkind = s === 'menu' ? M.menuKind(sub[1]) : null;
        if (mkind) return mk(mkind[1], function (c) { self.kindPage(c, self.menuCtx(x, b), mkind[0]); }, mb);
        if (s === 'menu') return mk('Menu', function (c) { self.s_menu(c, x, b); });
        // APPEARANCE (2026-10-29): one row on the screen's page, this page laid
        // out as All Screens' Appearance
        var ab = ['Appearance', base + '/appearance'];
        if (s === 'appearance') return mkl('Appearance', function (c) { self.s_appearance(c, x, b); });
        if (s === 'sidepane') return this.p_sidePane(path, sub.slice(1), [x.title, base]);
        // NOW PLAYING OPTIONS (2026-10-30): the screen's own Now Playing, laid
        // out as All Screens' (its rows were under Behavior on its page)
        if (s === 'nowplaying') return mk('Now Playing Options', function (c) { self.s_nowPlaying(c, x, b); });
        // LOOKS (2026-10-30, hk_core looks.py): a whole look in one step, and its Undo
        var lb = ['Looks', base + '/looks'];
        if (s === 'looks' && sub[1] && M.lookOf(sub[1])) return mkl(M.lookOf(sub[1]).name, function (c) { self.lookPage(c, x, b, M.lookOf(sub[1]), base); }, lb);
        if (s === 'looks') return mkl('Looks', function (c) { self.looksPage(c, x, b, base); });
        if (s === 'accent') return mkl('Accent Color', function (c) { self.accentPage(c, x, b); }, ab);
        if (s === 'menu-pages' && x.generated) s = 'pages';
        if (s === 'menu-pages') return mk('Pages in Menu', function (c) { self.s_menuPages(c, x, b); });
        if (s === 'chips' && sub[1]) return mk(M.CHIP_LABELS[sub[1]] || sub[1], function (c) { self.s_chip(c, x, b, sub[1]); },
                                                 ['Status Chips', base + '/chips']);
        if (s === 'chips') return mk('Status Chips', function (c) { self.s_chips(c, x, b); });
        if (s === 'cameras' && sub[1] === 'live') {
          return mk('Live Camera Follows', function (c) { self.s_cameraLive(c, x, b); }, ['Cameras', base + '/cameras']);
        }
        if (s === 'cameras') return mk('Cameras', function (c) { self.s_cameras(c, x, b); });
        if (s === 'scenes') return mk('Scenes', function (c) { self.s_scenes(c, x, b); });
        if (s === 'favorites') return mk('Favorites', function (c) { self.s_favorites(c, x, b); });
        if (s === 'rooms') return mk('Rooms', function (c) { self.s_rooms(c, x, b); });
        if (s === 'pages') return mk('Pages on This Screen', function (c) { self.s_pages(c, x, b); });
        if (s === 'pages-screen') {
          var sps = { house: false, path: path, b: b, base: base + '/pages-screen' };
          if (sub[1] === 'icons') return mk('Icons', function (c) { self.pagesScreenIcons(c, sps); }, ['Pages Screen', sps.base]);
          return mk('Pages Screen', function (c) { self.pagesScreenPage(c, sps); });
        }
        if (s === 'page-headers') return mk('Page Headers', function (c) { self.s_pageHeaders(c, x, b); });
        if (s === 'sky' && sub[1] === 'backdrop') return mkl('Sky Colors', function (c) { self.s_backdrop(c, x, b); }, ['Background', base + '/sky']);
        if (s === 'sky' && sub[1] === 'landscape') {
          return mkl('Choose a Landscape', function (c) {
            self.landscapePick(c, { value: b.sky_landscape || null, house: self.data.settings.sky.landscape || 'every:1440', fk: 'blandpick',
                                    onSet: function (v) { self.setB(x.path, { sky_landscape: v, sky: true }); } });
          }, ['Background', base + '/sky']);
        }
        if (s === 'sky' && sub[1] === 'pages') return mkl('Background', function (c) { self.s_sky(c, x, b); }, ab);
        if (s === 'sky' && sub[1] === 'lively' && sub[2]) {
          var locc = decodeURIComponent(sub[2]);
          return mkl(M.livelyOccLabel(locc), function (c) { self.livelyGroup(c, locc, null, { b: b, path: path }); },
                    ['Each Occasion', base + '/sky/lively']);
        }
        if (s === 'sky' && sub[1] === 'lively') {
          return mkl('Each Occasion', function (c) { self.livelyList(c, { b: b, path: path, base: base }); }, ['Background', base + '/sky']);
        }
        if (s === 'sky' && sub[1] === 'page' && sub[2]) {
          var skey = decodeURIComponent(sub[2]);
          var srow = this.skyRow(skey, b), sflat = this.flatHere(b);
          return mkl(srow ? srow.label : 'Page', function (c) { if (srow) { if (sflat) self.flatPagePicker(c, x, b, srow, base + '/sky'); else self.pagePicker(c, x, b, srow); } },
                    srow && srow.room ? ['Room Pages', base + '/sky/page/rooms'] : ['Background', base + '/sky']);
        }
        if (s === 'sky') return mkl('Background', function (c) { self.s_sky(c, x, b); }, ab);
        if (s === 'glass') return mkl('Appearance Style', function (c) { self.s_glass(c, x, b); }, ab);
        if (s === 'flat-colors') return this.p_flatColors('screen', x, b, sub.slice(1), mkl, ab);
        if (s === 'copy') return mk('Copy Settings', function (c) { self.s_copy(c, x, b); });
        // SLEEP SCREEN is each tablet's since 1.14: a screen's old address opens
        // its (first) tablet's
        if (s === 'sleep') {
          var st0 = (b.tablets || [])[0];
          if (st0 && this.tabs()[st0]) {
            var to = '#/house/tablets/' + encodeURIComponent(st0) + '/sleep' + (sub[1] ? '/' + sub[1] : '');
            try { history.replaceState(null, '', to); } catch (e) { /* no history */ }
            return this.resolve(['house', 'tablets', st0, 'sleep'].concat(sub[1] ? [sub[1]] : []));
          }
          return mk('Sleep Screen', function (c) {
            c.appendChild(K.group({ footer: 'Sleep Screen is each wall tablet’s own. Add the tablet that shows this screen in Wall Tablets.' }, [
              K.nav({ label: 'Wall Tablets', href: '#/house/tablets' })]));
          });
        }
        if (s === 'screensaver' && sub[1] === 'weather') {
          var wpg = mk('Weather', function (c) { self.saverWeather(c, M.saverOptions(b.screensaver_options), self.saverPutB(path)); },
                       ['Screensaver Options', base + '/screensaver']);
          wpg.saverPreview = true; wpg.saverWeather = true;
          return wpg;
        }
        if (s === 'screensaver' && sub[1] === 'energy') {
          var epg = mk('Home Energy', function (c) { self.saverEnergy(c, M.saverOptions(b.screensaver_options), self.saverPutB(path)); },
                       ['Screensaver Options', base + '/screensaver']);
          epg.saverPreview = true; epg.saverEnergy = true;
          return epg;
        }
        // (the Clock Style page is the editor's now, Look -> Big -> Face: its old address opens the editor)
        if (s === 'screensaver' && (sub[1] === 'editor' || sub[1] === 'clock-style')) {
          return this.saverEditorPage(path, { path: path, title: x.title, designId: sub[2] || '', back: ['Screensaver Options', base + '/screensaver'],
            options: M.saverFollows(b) ? this.hs('look.saver') : b.screensaver_options });
        }
        if (s === 'screensaver') {
          var spg = mk('Screensaver Options', function (c) { self.saverPage(c, x, b, path); });
          spg.saverPreview = true;         // the frame shows the screensaver itself
          return spg;
        }
        if (s === 'kiosk') return mk('Home Assistant Header & Sidebar', function (c) { self.kioskPage(c, x, b, path); });
        // A THIRD-PARTY CARD'S OPTIONS: WallPanel's, and the Kiosk Mode
        // plugin's (kiosk-mode: a page under Header & Sidebar)
        if (s === 'wallpanel' || s === 'kiosk-mode') {
          var tpk = s === 'kiosk-mode' ? 'kiosk' : s;
          var key = tpk + '_options', spec = OPTION_PAGES[tpk];
          var saveOpts = function (v) { var o = {}; o[key] = v; return self.setB(path, o); };
          if (sub[1] === 'yaml') {
            return mk('Options in YAML', function (c) {
              self.yamlPage(c, { value: b[key] || {}, note: ((self.data.thirdparty || {})[tpk] || {}).note, sk: 'b:' + key,
                                 help: spec.yamlHelp, example: spec.example, docs: spec.docs, onSave: saveOpts });
            }, [spec.title, base + '/' + s]);
          }
          return mk(spec.title, function (c) {
            if (s === 'wallpanel') self.engineGroup(c, b, path);
            self.optionsPage(c, spec, b[key] || {}, saveOpts, base + '/' + s + '/yaml', ((self.data.thirdparty || {})[tpk] || {}));
          }, s === 'kiosk-mode' ? ['Header & Sidebar', base + '/kiosk'] : null);
        }
        return { title: x.title, top: true, back: home, preview: path, previewTop: true, rename: this.renamable(x),
          scope: 'Only this screen · <b>/' + K.esc(path) + '</b> · ' + (x.generated ? (self.onlyOf(b) ? 'Generated: ' + K.esc(self.onlyOf(b).text) : 'Generated from your home') : 'Written in YAML'),
          body: function (c) { self.s_main(c, x, b); } };
      }
      s_main(c, x, b) {
        var self = this, path = x.path, base = '#/screens/' + encodeURIComponent(path), gen = x.generated;
        var set = function (ch) { return self.setB(path, ch); };
        var look = this.data.settings.look;
        if (!this.hasAttribute('wide')) {
          c.appendChild(K.group({}, [K.nav({ label: 'Open Screen', sub: 'In a new tab', href: '/' + path + '/0', icon: 'mdi:open-in-new' })]));
          var o = c.lastChild.querySelector('a');
          o.setAttribute('target', '_blank'); o.setAttribute('rel', 'noopener');
        }
        // A SCREEN OF ONLY SOME PAGES: first thing on its page, what it shows
        // and the way back to a whole screen
        var only = gen ? this.onlyOf(b) : null;
        if (only) {
          c.appendChild(K.group({ header: 'This Screen Shows', footer: only.keys.length
              ? 'No Home page and no room pages: only ' + (only.names.length > 2 ? 'these pages' : only.names.join(' and ')) +
                ', opening on ' + only.names[0] + '. Turn it into a whole screen any time; nothing is deleted.'
              : 'Home Page is off but no page is picked yet, so it still shows everything. Pick its pages.' }, [
            K.nav({ label: only.text, sub: only.keys.length > 2 ? only.names.join(', ') : null, icon: 'mdi:file-document-multiple-outline',
                    value: 'Change Pages', href: base + '/pages', fk: 'only:pages' }),
            K.button({ label: 'Make It a Whole Screen', fk: 'only:whole', onClick: function () { self.setHomePage(path, true); } })]));
        }
        // MENU & HEADER (2026-10-30 tidy-up): one row to the screen's Menu
        // (its menu on each device is set at the top of that page -- menu and
        // menu_phone, menuKind), then what sits at the top of its pages. THE
        // HEADER (2026-10-09): what sits at the top of Home on a phone, and Home
        // Assistant's own header and sidebar -- every screen, generated or not
        // (hk-kiosk.js), or the Kiosk Mode plugin on a generated one that
        // chooses it
        var mode = M.menuMode(b), pmode = M.phoneMenu(b), rows = [];
        rows.push(K.nav({ label: 'Menu', value: M.menuWord(b), sub: mode !== 'off' || pmode !== 'off' ? M.menuSummary(b) : null,
                          href: base + '/menu', sk: 'b:menu_own' }));
        // a YAML screen says which pages its menu lists here (a generated one, on its Pages)
        if (!gen && (mode !== 'off' || pmode !== 'off')) {
          rows.push(K.nav({ label: 'Pages in Menu', sk: 'b:categories', href: base + '/menu-pages',
                            value: b.categories.length || (b.menu_top || []).length ? 'Custom' : 'Automatic' }));
        }
        if (gen) rows.push(K.seg({ label: 'Header on Phones', sk: 'b:phone_header', stack: !this.hasAttribute('wide'),
                                   value: b.phone_header || 'header', options: [['header', 'Clock & Weather'], ['strip', 'Weather Strip']],
                                   onChange: function (v) { self.setB(path, { phone_header: v }); } }));
        // BACK BUTTON & TITLE (Menu's Page Header before 2026-10-29): the
        // header on every page but Home, beside the other header settings
        if (mode !== 'off' || pmode !== 'off') rows = rows.concat(this.headerRows(this.menuCtx(x, b)));
        rows.push(K.nav({ label: 'Home Assistant Header & Sidebar', href: base + '/kiosk', sk: 'b:kiosk', value: M.kioskSummary(b, gen) }));
        var hdrFoot = [];
        if (gen && b.kiosk && b.kiosk_engine === 'kiosk_mode' && (this.data.thirdparty.kiosk || {}).state !== 'ready') {
          hdrFoot.push((this.data.thirdparty.kiosk || {}).note || '');
        }
        if (gen) hdrFoot.unshift('Header on Phones: on a phone held upright, narrower than 640 px.');
        c.appendChild(K.group({ header: 'Menu & Header', footer: hdrFoot.join(' ') || null }, rows));

        // HOME PAGE
        var chipsVal = !b.chips_row ? 'Off' : b.chips.length ? b.chips.length + ' Chips' : 'Automatic';
        var camsVal = gen && !b.camera_strip ? 'Off' : !b.cameras_custom ? 'Same as All Screens'
          : b.cameras.length ? b.cameras.length + ' Cameras' : 'Automatic';
        var scenesVal = !b.scenes_row ? 'Off' : b.scenes.length ? b.scenes.length + ' Scenes' : 'Automatic';
        var roomsVal = b.rooms_custom ? M.roomsSummary(b) : 'Same as All Screens';
        var home = [
          K.nav({ label: 'Status Chips', value: chipsVal, href: base + '/chips', sk: 'b:chips' }),
          K.nav({ label: 'Cameras', value: camsVal, href: base + '/cameras', sk: 'b:cameras' }),
          K.nav({ label: 'Scenes', value: scenesVal, href: base + '/scenes', sk: 'b:scenes' })];
        if (gen) home.push(K.nav({ label: 'Favorites', value: b.favorites.length ? b.favorites.length + (b.favorites.length === 1 ? ' Favorite' : ' Favorites') : 'None',
                                   href: base + '/favorites', sk: 'b:favorites' }));
        home.push(K.nav({ label: 'Rooms', value: roomsVal, href: base + '/rooms', sk: 'b:rooms_custom' }));
        if (gen && !only) {
          home.unshift(K.select({ label: 'Home Style', value: b.home_style || 'generated',
            options: [['generated', 'Generated'], ['grid', 'Home Grid']],
            onChange: function (v) {
              if (v === 'grid') self.back(base + '/home-grid');
              else self.setB(path, { home_style: 'generated' });
            } }));
          home.splice(1, 0, K.nav({ label: 'Arrange Home Grid', href: base + '/home-grid',
            sub: 'Arrange on a desktop. Save when ready.', value: b.home_grid ? b.home_grid.items.length + ' Blocks' : 'Choose a Starter' }));
        }
        // only some pages: no Home page to set up here
        if (!only) c.appendChild(K.group({ header: 'Home Page', footer: gen ? null :
          'This screen is written in YAML, so it draws its own Home page. These lists apply where its cards read them: the chip row, the scenes row, the camera strip and the room order.' }, home));

        // PAGES
        if (gen && !only) {
          var hdOff = Object.keys(b.headers || {}).length;
          c.appendChild(K.group({ header: 'Pages', footer: 'The order here is the menu’s too; each page’s row says where it sits in the menu. ' +
              'Each page’s own settings are under Pages in the sidebar; Page Headers turns a page’s header off on this screen alone.' }, [
            K.nav({ label: 'Pages on This Screen', href: base + '/pages', sk: 'b:pages',
                    value: b.pages.length ? b.pages.filter(function (k) { return k !== 'browse'; }).length + ' Pages' : 'Automatic' }),
            K.nav({ label: 'Page Headers', href: base + '/page-headers', sk: 'b:headers',
                    value: hdOff ? hdOff + ' Off' : 'Same as All Screens' }),
            // THE PAGES SCREEN (Phase J): its own, or All Screens'
            K.nav({ label: 'Pages Screen', href: base + '/pages-screen', sk: 'b:pages_screen',
                    value: b.pages_screen ? M.pagesScreenSummary(M.pagesScreenOf(this.data.settings.pages_screen, b.pages_screen).value)
                                          : 'Same as All Screens' })]));
        }

        // LOOK (2026-10-30 tidy-up): Appearance, Looks and the Side Pane, one
        // group -- each its page laid out as All Screens'
        var lu = b.look_undo && M.lookOf(b.look_undo.look);
        c.appendChild(K.group({ header: 'Look' }, [
          K.nav({ label: 'Appearance', value: M.glassShort(M.glassOf(b, this.data.settings.look).effective), sub: this.appearanceSays(b), href: base + '/appearance', sk: 'b:appearance' }),
          K.nav({ label: 'Looks', value: lu ? lu.name : '', sub: 'HomeView, Flat, Performance, Holiday Whimsy and more, in one step',
                  href: base + '/looks', sk: 'b:looks' }),
          K.nav({ label: 'Side Pane', value: M.paneSummary(this.paneNow(x.path)), href: base + '/sidepane', sk: 'b:side_pane' })]));

        // NOW PLAYING (2026-10-30 tidy-up: out of Behavior): the switch, then
        // its options on a page of their own as the screensaver's are
        // (s_nowPlaying) -- All Screens' Now Playing, or this screen's own
        if (gen) {
          var npr = [K.toggle({ label: 'Now Playing', sk: 'b:now_playing', on: b.now_playing,
                                sub: 'The music playing, in a side pane or a bar.',
                                onChange: function (on) { set({ now_playing: on }); } })];
          if (b.now_playing && b.np_style !== undefined) {
            npr.push(K.nav({ label: 'Now Playing Options', href: base + '/nowplaying', sk: 'b:np_options',
                             value: M.npOwn(b) ? 'Just This Screen' : 'Same as All Screens' }));
          }
          // (shown once the integration knows it: an older one would drop it)
          if (b.timer_bar !== undefined) {
            // needs the quick_timers.yaml package (its running-timers sensor): off and dimmed while it is missing
            var qtOn = !!(this.client.states || {})['sensor.running_quick_timers'];
            npr.push(K.toggle({ label: 'Timer Bar', sk: 'b:timer_bar', on: b.timer_bar, disabled: !qtOn && !b.timer_bar,
                                sub: 'Running quick timers, docked along the bottom — over the player when music plays.' +
                                     (qtOn ? '' : ' Needs the quick_timers.yaml package in Home Assistant.'),
                                onChange: function (on) { set({ timer_bar: on }); } }));
          }
          if (b.bar_all_pages !== undefined && (b.now_playing || b.timer_bar)) {
            npr.push(K.toggle({ label: 'On Every Page', sk: 'b:bar_all_pages', on: b.bar_all_pages,
                                sub: 'The bar on every page of this screen, not Home alone.',
                                onChange: function (on) { set({ bar_all_pages: on }); } }));
          }
          c.appendChild(K.group({ header: 'Now Playing' }, npr));
        }
        // POP-UPS ("Behavior" until 2026-10-30)
        var pops = (this.data.popups || []).map(function (p) { return p.name || '#' + p.hash; });
        c.appendChild(K.group({ header: 'Pop-ups', footer: (pops.length ? 'Pop-ups (' + pops.join(', ') + ')' : 'Pop-ups') +
          ' open over this screen when an automation shows one. Off: never here — a car’s screen, say.' }, [
          K.toggle({ label: 'Allow Pop-ups', sk: 'b:popups', on: b.popups, onChange: function (on) { set({ popups: on }); } })]));

        // NOTIFICATIONS (Features -> Notifications): this screen's switch, its
        // screensaver, its Do Not Disturb -- each Same as All Screens unless set
        if (F.stateOf(this.data.features, 'hk_notify') === 'added') {
          var nd = (this.feat('hk_notify').data || {}).options || {};
          var SAVERS = { all: 'All', important: 'Important Only', off: 'Off' };
          var nrows = [K.toggle({ label: 'Allow Notifications', sk: 'b:notify', on: b.notify !== false,
                                  sub: 'Banners from Notifications show on this screen',
                                  onChange: function (on) { set({ notify: on }); } })];
          var nwhile = null;
          if (b.notify !== false) {
            var hs = SAVERS[nd.saver] || 'Important Only';
            nrows.push(K.select({ label: 'On the Screensaver', sub: b.notify_saver ? 'Just This Screen' : 'Same as All Screens',
              value: b.notify_saver || '', sk: 'b:notify_saver',
              options: [['', 'Same as All Screens (' + hs + ')', hs], ['all', 'All'], ['important', 'Important Only'], ['off', 'Off']],
              onChange: function (v) { set({ notify_saver: v || null }); } }));
            var dnd = b.notify_dnd, own = !!(dnd && (dnd.schedule || (dnd['while'] || []).length));
            var hd = F.dndSummary(nd.dnd);
            nrows.push(K.select({ label: 'Do Not Disturb', sub: dnd ? 'Just This Screen' : 'Same as All Screens',
              value: !dnd ? '' : own ? 'own' : 'off', sk: 'b:notify_dnd',
              options: [['', 'Same as All Screens (' + hd + ')', hd], ['off', 'Off on This Screen', 'Off'], ['own', 'Its Own Hours']],
              onChange: function (v) {
                set({ notify_dnd: v === '' ? null : v === 'off' ? { schedule: false, 'while': [] }
                  : { schedule: true, from: (nd.dnd || {}).from || '22:00', to: (nd.dnd || {}).to || '07:00', 'while': [] } });
              } }));
            if (own) {
              var dr = F.dndRows(this, dnd, function (x) { set({ notify_dnd: x }); }, 'b:notify_dnd');
              nrows = nrows.concat(dr.rows);
              nwhile = dr.whileRows;
            }
          }
          c.appendChild(K.group({ header: 'Notifications', footer: 'Which notifications there are, and All Screens’ choices, are in Notifications. An Important one gets through Do Not Disturb.' }, nrows));
          if (nwhile) c.appendChild(K.group({ header: 'Do Not Disturb While This Is On', footer: 'An input_boolean, a switch, a timer while it runs.' }, nwhile));
        }

        // WHEN IDLE: the photo screensaver -- what it shows is the screen's
        // (an existing dashboard's comes from these settings unless its own
        // YAML has hk_screensaver, hk-saver.js fromSettings; WallPanel for a
        // generated screen only). When it starts, Home and dark are each wall
        // tablet's own (1.14).
        var idle = [K.toggle({ label: 'Screensaver', sk: 'b:screensaver', on: b.screensaver,
                              onChange: function (on) { set({ screensaver: on }); } })];
        if (b.screensaver) {
          var wp = gen && b.screensaver_engine === 'wallpanel';
          idle.push(K.nav({ label: 'Screensaver Options', href: base + (wp ? '/wallpanel' : '/screensaver'),
                            sk: wp ? 'b:wallpanel_options' : 'b:screensaver_options',
                            value: wp ? 'WallPanel' : (M.saverFollows(b) ? 'Same as All Screens' : 'Just This Screen') }));
        }
        var mine = (b.tablets || []).filter(function (tid) { return self.tabs()[tid]; });
        var idf = [];
        if (b.screensaver) {
          idf.push(mine.length ? 'It runs on this screen’s wall tablets (below), never on a desk or a phone opening it.'
            : 'It runs only on a wall tablet: add the tablet that shows this screen, below.');
          if (!gen) idf.push('If this dashboard’s own YAML has an hk_screensaver block, that is used instead.');
        }
        c.appendChild(K.group({ header: 'Screensaver', footer: idf.join(' ') || null }, idle));

        // WALL TABLETS (1.14): the tablets that run this screen -- each one's
        // user, room, idle time and Sleep Screen are its own
        var trows = mine.map(function (tid) {
          var tt = self.tabs()[tid], ts = self.tabletStatusOf(tid);
          return K.nav({ tile: ['mdi:tablet', ts.known ? self.tabTile(ts.st) : C.blue], label: tt.name,
                         sub: M.tabletApp(tt.app)[1], href: '#/house/tablets/' + encodeURIComponent(tid), fk: 'b:tab:' + tid,
                         value: !ts.known ? '' : ts.st === 'off' ? 'Offline' : ts.word + (ts.batt !== null ? ' · ' + ts.batt + '%' : '') });
        });
        var addT = K.nav({ tile: ['mdi:plus', C.gray], label: 'Add a Tablet to This Screen…', href: '#/house/tablets/add', sk: 'b:tablets' });
        addT.addEventListener('click', function () { self._newT = null; self._addScreen = path; });
        trows.push(addT);
        c.appendChild(K.group({ header: 'Wall Tablets', footer: 'The tablets that run this screen. Each one’s user, room, idle time and Sleep Screen are its own, in Wall Tablets.' }, trows));

        // THIS DEVICE: a car's browser -- and, in one, which Home the screen
        // generates (M.CAR_LAYOUTS) and how much layout its window holds
        // (M.CAR_WIDTHS: tesla-viewport.js zooms to it; Custom, any width)
        var carRows = [K.toggle({ label: 'Car Browser', sub: 'Fit a car’s narrow browser to a desktop layout.', sk: 'b:car', on: b.car,
                                  onChange: function (on) { set({ car: on }); } })];
        var carFoot = null;
        if (b.car) {
          var cl = b.car_layout === 'car' ? 'car' : 'home';
          carRows.push(K.select({ label: 'Car Layout', sk: 'b:car_layout', value: cl,
            options: M.CAR_LAYOUTS.map(function (o) { return [o[0], o[1]]; }),
            onChange: function (v) { set({ car_layout: v }); } }));
          this._carCustom = this._carCustom || {};
          var cw = M.carWidthChoice(b.car_width, this._carCustom[path]);
          carRows.push(K.select({ label: 'Scale', sk: 'b:car_width', value: cw, options: M.CAR_WIDTHS,
            onChange: function (v) {
              self._carCustom[path] = v === 'custom';
              if (v === 'custom') { self.render(); return; }
              set({ car_width: v ? Number(v) : null });
            } }));
          if (cw === 'custom') {
            carRows.push(K.text({ label: 'Layout Width', sk: 'b:car_width:n', value: b.car_width || M.CAR_WIDTH, unit: 'px', inputmode: 'numeric',
              error: this.err('b:car_width'),
              onCommit: function (t) { set({ car_width: Number(String(t).replace(/[^\d.]/g, '')) || null }); } }));
          }
          carFoot = M.CAR_LAYOUTS.filter(function (o) { return o[0] === cl; })[0][2] +
            ' Scale: how much of a desktop layout the car’s window holds — Larger shows less of it, bigger; ' +
            'Custom takes a width of your own (Standard is ' + M.CAR_WIDTH.toLocaleString(window.hkLocale.numTag()) + ' px).';
        }
        c.appendChild(K.group({ header: 'This Device', footer: carFoot }, carRows));
        var devRec = this.deviceRecommend(path, b);
        if (devRec) c.appendChild(devRec);

        // THE HOST'S OWN, for this screen (extend, above): nothing in Home Assistant
        var hx = this.host();
        if (hx && typeof hx.extend === 'function') {
          try { hx.extend('screen', c, { screen: path, title: x.title, where: x.where || null }, this); } catch (e) { /* the host's own page */ }
        }

        c.appendChild(K.group({ footer: 'Another screen’s menu, Home page, appearance and more, onto this one — you choose which.' }, [
          K.nav({ label: 'Copy Settings From…', href: base + '/copy', sk: 'b:copy' })]));
        if (!gen) c.appendChild(K.group({ footer: 'What this dashboard’s own YAML can say beyond these settings: the live sky, HK cards, ' +
            'rooms in the menu, and more, ready to copy.' }, [K.nav({ label: 'YAML Reference', href: '#/advanced/yaml', sk: 'b:yaml-ref' })]));
        if (gen && x.mode === 'storage') { c.appendChild(this.deleteGroup(x)); return; }
        // a host that can't remove a screen's settings says why instead
        if (this.hostNote('screen_remove')) {
          c.appendChild(K.group({ footer: this.hostNote('screen_remove') }, []));
          return;
        }
        c.appendChild(K.group({ footer: 'The dashboard itself stays. Its menu, Home page and appearance go back to the defaults.' }, [
          K.button({ label: 'Remove HK Settings…', destructive: true, sk: 'b:remove', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Remove HK settings for ' + x.title + '?',
              message: 'The dashboard stays. Its menu, Home page, pages and appearance go back to the defaults.',
              ok: 'Remove', destructive: true }).then(function (yes) {
              if (!yes) return;
              self.ws({ type: 'config_entries/subentries/delete', entry_id: self.data.entry_id, subentry_id: x.item })
                .then(function (ok) { if (ok) self.reload().then(function () { self.render(); }); });
            });
          } })]));
      }
      // COPY SETTINGS FROM ANOTHER SCREEN onto this one: which screen, which
      // parts (M.COPY_GROUPS; Favorites and Scenes are left unticked), then one
      // save. A screen's own tablet (Tablet User, Tablet Room) never travels.
      s_copy(c, x, b) {
        var self = this, path = x.path;
        var st = this._copy = (this._copy && this._copy.to === path) ? this._copy : { to: path, from: null, groups: M.copyDefaults() };
        var from = (this.data.dashboards || []).filter(function (d) { return d.item && d.path !== path && self.data.boards[d.path]; });
        if (!from.length) {
          c.appendChild(K.group({ footer: 'There is no other screen with HK settings to copy from yet.' }, []));
          return;
        }
        c.appendChild(K.group({ header: 'From', footer: 'Its settings as they are now; nothing on that screen changes.' }, from.map(function (d) {
          return K.check({ label: d.title, sub: '/' + d.path, on: st.from === d.path, fk: 'copy:from:' + d.path,
                           onClick: function () { st.from = d.path; self.render(); } });
        })));
        this.copyGroups(c, st);
        var src = st.from && this.data.boards[st.from];
        var fromTitle = st.from ? ((this.dash(st.from) || {}).title || st.from) : '';
        c.appendChild(K.group({ footer: 'This screen’s Tablet User and Tablet Room are kept: they belong to its tablet.' }, [
          K.button({ label: st.from ? 'Copy to ' + x.title + '…' : 'Choose a Screen to Copy From', center: true, fk: 'copy:go',
                     disabled: !st.from || !st.groups.length, onClick: function () {
            var names = M.COPY_GROUPS.filter(function (g) { return st.groups.indexOf(g[0]) >= 0; }).map(function (g) { return g[1]; });
            K.confirm(self.shadowRoot, { title: 'Copy from ' + fromTitle + '?', ok: 'Copy',
                                         message: names.join(', ') + ' on ' + x.title + ' are replaced with ' + fromTitle + '’s.' }).then(function (yes) {
              if (!yes) return;
              self.setB(path, M.copyChanges(src, st.groups)).then(function () {
                self._copy = null;
                self.announce('Copied from ' + fromTitle + '.');
                self.back('#/screens/' + encodeURIComponent(path));
              });
            });
          } })]));
      }
      copyGroups(c, st) {
        var self = this;
        c.appendChild(K.group({ header: 'What to Copy', footer: 'Favorites and scenes are usually a screen’s own, so they start unticked.' },
          M.COPY_GROUPS.map(function (g) {
            var on = st.groups.indexOf(g[0]) >= 0;
            return K.check({ label: g[1], multi: true, on: on, fk: 'copy:g:' + g[0], onClick: function () {
              st.groups = on ? st.groups.filter(function (k) { return k !== g[0]; }) : st.groups.concat([g[0]]);
              self.render();
            } });
          })));
      }
      // DELETE SCREEN: a generated screen -- one the page can make -- can go
      // altogether: its dashboard and its settings. A hand-written one only
      // ever loses its settings (Remove HK Settings): it is a file.
      deleteGroup(x) {
        var self = this;
        return K.group({ footer: 'Deletes the dashboard and its HK settings. A tablet showing it will need another screen.' }, [
          K.button({ label: 'Delete Screen…', destructive: true, sk: 'b:delete', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Delete ' + x.title + '?',
              message: 'The dashboard /' + x.path + ' and its HK settings are deleted. This can’t be undone here.',
              ok: 'Delete', destructive: true }).then(function (yes) { if (yes) self.deleteScreen(x); });
          } })]);
      }
      async deleteScreen(x) {
        // the preview is that dashboard, running: unload it first, or it
        // reports its own dashboard missing the moment it is deleted
        var pv = this.pageEl.querySelector('.pvcol');
        if (pv) { var fr = pv.querySelector('iframe'); if (fr) fr.src = 'about:blank'; pv.remove(); }
        this._pv = null; this._fit = null;
        this.status('saving');
        try {
          if (x.item) await this.actions().callWS({ type: 'config_entries/subentries/delete', entry_id: this.data.entry_id, subentry_id: x.item });
          var list = await this.client.callWS({ type: 'lovelace/dashboards/list' });
          var d = (list || []).filter(function (y) { return y.url_path === x.path; })[0];
          if (d) await this.actions().callWS({ type: 'lovelace/dashboards/delete', dashboard_id: d.id });
          this.status('saved');
          this.announce(x.title + ' deleted');
        } catch (e) {
          this.status('error');
          this.announce('Couldn’t delete it: ' + ((e && e.message) || e));
        }
        await this.reload();
        this.go('#/overview');
      }
      s_menuPages(c, x, b) {
        // A HAND-WRITTEN SCREEN'S MENU: each of its pages at the top
        // (right under Home), under Categories, or not in the menu -- as a
        // generated screen's Pages does it. Automatic: the views' own `menu: top`
        // at the top; under Categories, the pages Home's status chips open.
        var self = this, set = function (ch) { return self.setB(x.path, ch); };
        var items = (x.menu_layout || []).map(function (it) { return { path: it.path, title: it.title, page: it.page, top: it.top, auto: it.auto }; });
        if (!items.length) { c.appendChild(K.group({ footer: 'This dashboard has no pages to list besides Home and its rooms.' }, [])); return; }
        c.appendChild(K.group({ footer: 'Top of Menu: right under Home, above Categories. Categories are listed in the order of Home’s status chips. Not in Menu: still one tap away on its chip.' },
          items.map(function (it) {
            return K.select({ label: it.title, sub: it.page ? 'The ' + it.page + ' page' : null, sk: 'place:' + it.path,
              value: M.placeOf(b, it, items), options: M.MENU_PLACES,
              onChange: function (v) {
                var ch = M.placeSet(b, items, it.path, v);
                if (!ch) { self.announce('Categories keeps at least one page: move it to the top, or use the automatic menu.'); self.render(); return; }
                set(ch);
              } });
          })));
        if ((b.menu_top || []).length || (b.categories || []).length) {
          c.appendChild(K.group({ footer: 'Automatic: the pages whose YAML says menu: top at the top; under Categories, the pages Home’s status chips open.' }, [
            K.button({ label: 'Reset to Automatic Menu', fk: 'menu:auto', onClick: function () { set({ menu_top: [], categories: [] }); } })]));
        }
      }
      // A SCREEN'S MENU SETTINGS (2026-10-29): the kinds of menu it uses, each
      // the same page as All Screens' -- every setting there Same as All
      // Screens until it is changed here, then Just This Screen (menu_own)
      s_menu(c, x, b) {
        var self = this, base = '#/screens/' + encodeURIComponent(x.path);
        var set = function (ch) { return self.setB(x.path, ch); };
        // MENU ON THIS SCREEN (on its page until 2026-10-30): the kind of menu
        // on each device -- always the screen's own (menu, menu_phone)
        c.appendChild(K.group({ header: 'Menu on This Screen', footer: M.DEVICES.fold }, [
          this.menuKind(b, set, 'tablets', 'Tablets & Computers'),
          this.menuKind(b, set, 'phones', 'Phones')]));
        var kinds = M.MENU_KINDS.filter(function (k) { return k[2](b); });
        if (!kinds.length) {
          this.swipePagesGroup(c, b, x);
          return;
        }
        c.appendChild(K.group({ header: 'Navigation', footer: 'The ones this screen uses. Each setting follows All Screens until you change it here.' },
          kinds.map(function (k) {
            return K.nav({ label: k[1], value: M.menuSummary(b, M.KIND_KEYS[k[0]]), href: base + '/menu/' + k[0], sk: 'b:menu:' + k[0] });
          })));
        this.swipePagesGroup(c, b, x);
        c.appendChild(K.group({ header: 'In the Menu' }, [
          K.nav({ label: 'Rooms in the Menu', value: b.rooms_custom ? 'Just This Screen' : 'Same as All Screens', href: base + '/rooms', sk: 'b:menu_rooms' })]));
        var mine = [];
        kinds.forEach(function (k) { M.KIND_KEYS[k[0]].forEach(function (key) { if (M.ownsMenu(b, key) && mine.indexOf(key) < 0) mine.push(key); }); });
        if (mine.length) {
          c.appendChild(K.group({ footer: 'Every setting above follows All Screens again. The Accent Color and Back Button & Title stay as they are.' }, [
            K.button({ label: 'Reset All to All Screens', sk: 'b:menu_own:reset', onClick: function () { self.setB(x.path, M.menuOwnReset(b, mine)); } })]));
        }
      }
      // SWIPE BETWEEN PAGES (2026-10-30, hk-pageswipe.js): All Screens' on the
      // Menu page (b null); a screen's beside its tab bar's settings -- Same as
      // All Screens until chosen here, then Just This Screen, with Reset
      swipePagesGroup(c, b, x) {
        var self = this, wide = this.hasAttribute('wide');
        var house = (this.data.settings.menu || {}).swipe_pages || 'auto';
        var own = !!b && M.SWIPE_PAGES.some(function (o) { return o[0] === b.swipe_pages; });
        var cur = own ? b.swipe_pages : house;
        var rows = [K.seg({ label: 'Swipe Between Pages', sk: b ? 'b:swipe_pages' : 'menu.swipe_pages', value: cur, stack: !wide,
          sub: b ? (own ? 'Just This Screen' : 'Same as All Screens') : null, options: M.SWIPE_PAGES,
          onChange: function (v) { return b ? self.setB(x.path, { swipe_pages: v }) : self.setH({ 'menu.swipe_pages': v }); } })];
        if (own) {
          rows.push(K.button({ label: 'Reset to All Screens (' + M.choiceLabel(M.SWIPE_PAGES, house) + ')', sk: 'b:swipe_pages:reset',
            onClick: function () { self.setB(x.path, { swipe_pages: null }); } }));
        }
        // SWIPE RIGHT ON HOME (2026-11-06, the owner): one of this screen's pages, before Home in the swipe's order
        var pages = b && x ? (x.menu_layout || []).filter(function (it) { return it && it.path; }) : [];
        // (with Music, its Now Playing page first: the screensaver's music slide as a page, out of the menu -- 2026-11-07)
        if (pages.some(function (it) { return it.path === 'playmusic'; })) pages = [{ path: 'now-playing', title: 'Now Playing' }].concat(pages);
        var left = b && pages.some(function (it) { return it.path === b.swipe_left; }) ? b.swipe_left : '';
        if (b && pages.length) {
          rows.push(K.select({ label: 'Swipe Right on Home', sk: 'b:swipe_left', value: left,
            options: [['', 'Nothing']].concat(pages.map(function (it) { return [it.path, it.title || it.path]; })),
            disabled: cur === 'off',
            onChange: function (v) { return self.setB(x.path, { swipe_left: v || null }); } }));
        }
        var says = M.SWIPE_PAGES_SAYS[cur] + ' A row, a slider or a block that swipes keeps its own swipe.';
        if (b && pages.length && cur !== 'off') {
          says += left ? ' A swipe right on Home goes to ' + (pages.filter(function (it) { return it.path === left; })[0].title || left) + '.'
            : ' Swipe Right on Home can put one of this screen’s pages before Home.';
        }
        c.appendChild(K.group({ header: 'Gestures', footer: says }, rows));
      }
      // A SCREEN THAT FOLLOWS ALL SCREENS: what it takes from them, in place,
      // then the one way to change them -- the same on every page (Cameras,
      // Rooms)
      fromAllScreens(c, rows, page, href) {
        c.appendChild(K.group({ header: 'From All Screens', footer: 'Change these in All Screens → ' + page +
            ': they change on every screen that follows it. To set this screen’s own, turn off Same as All Screens.' },
          rows.concat([K.nav({ label: 'All Screens → ' + page, href: href, fk: 'from-all:' + href })])));
      }
      // THE MENU'S PAGES' CONTEXT: All Screens' (house) or one screen's. `v`
      // the values in a screen's keys (All Screens' as a board, or the screen
      // as read); `hv` All Screens'; `set` saves a screen's keys.
      menuCtx(x, b) {
        var self = this, hv = M.houseMenuAsBoard(this.data.settings.menu);
        if (!b) return { house: true, v: hv, hv: hv, base: '#/house/menu', rooms: '#/house/rooms',
                         set: function (ch) { return self.setH(M.houseMenuSave(ch)); },
                         sk: function (k) { return 'menu.' + M.MENU_KEYS[k]; } };
        return { house: false, v: b, b: b, hv: hv, x: x, base: '#/screens/' + encodeURIComponent(x.path) + '/menu',
                 rooms: '#/screens/' + encodeURIComponent(x.path) + '/rooms',
                 set: function (ch) { return self.setB(x.path, ch); }, sk: function (k) { return 'b:' + k; } };
      }
      // ONE MENU SETTING'S ROWS: All Screens' as it is; a screen's saying whose
      // it is (Same as All Screens / Just This Screen), saved as its own, with
      // Reset to All Screens (value) under it. make(set, whose) -> the row;
      // said(value) -> All Screens' value in words.
      mRow(ctx, key, make, said) {
        if (ctx.house) return [make(ctx.set, null)];
        var own = M.ownsMenu(ctx.b, key);
        var rows = [make(function (ch) { return ctx.set(M.menuOwnSet(ctx.b, ch)); }, own ? 'Just This Screen' : 'Same as All Screens')];
        if (own) {
          rows.push(K.button({ label: 'Reset to All Screens (' + said(ctx.hv[key]) + ')', sk: 'b:' + key + ':reset',
            onClick: function () { ctx.set(M.menuOwnReset(ctx.b, key)); } }));
        }
        return rows;
      }
      // A KIND OF MENU'S PAGE (side, edge-tab, tab-bar): everything about it,
      // split by device only where each device has its own value. All
      // Screens' shows every row; a screen only those it uses.
      kindPage(c, ctx, kind) {
        if (kind === 'side') this.sidePage(c, ctx);
        else if (kind === 'edge-tab') this.edgeTabPage(c, ctx);
        else this.tabBarPage(c, ctx);
      }
      sidePage(c, ctx) {
        var self = this, v = ctx.v, all = ctx.house, wide = this.hasAttribute('wide');
        var tm = M.menuMode(v), pm = M.phoneMenu(v), side = all || M.usesSide(v);
        var lab = function (list) { return function (x) { return M.choiceLabel(list, x); }; };
        var onOff = function (x) { return x ? 'On' : 'Off'; };
        var btn = [];
        if (all || tm === 'button') {
          btn = btn.concat(this.mRow(ctx, 'menu', function (set, whose) {
            return K.nav({ label: 'Tablets & Computers', sub: whose, value: M.menuStyleLabel(v.menu), href: ctx.base + '/side/tablets', sk: ctx.sk('menu') });
          }, M.menuStyleLabel));
        }
        if (all || pm === 'button') {
          btn = btn.concat(this.mRow(ctx, 'button_phone', function (set, whose) {
            return K.nav({ label: 'Phones', sub: whose, value: M.phoneStyleLabel(M.phoneButton(v)), href: ctx.base + '/side/phones', sk: ctx.sk('button_phone') });
          }, M.phoneStyleLabel));
        }
        if (side) {
          btn = btn.concat(this.mRow(ctx, 'glyph', function (set, whose) {
            return K.seg({ label: 'Button Icon', sub: whose, sk: ctx.sk('glyph'), value: v.glyph || 'sidebar', stack: !wide,
                           options: [['sidebar', 'Sidebar'], ['lines', 'Three Lines']], onChange: function (g) { set({ glyph: g }); } });
          }, function (g) { return g === 'lines' ? 'Three Lines' : 'Sidebar'; }));
        }
        if (btn.length) c.appendChild(K.group({ header: 'Button Style', footer: M.DEVICES.fold }, btn));
        if (all || tm === 'open') {
          var open = this.mRow(ctx, 'dock_min', function (set, whose) {
            return K.text({ label: 'Keep Open Down To', sub: whose, sk: ctx.sk('dock_min'), value: v.dock_min, unit: 'px', inputmode: 'numeric',
                            error: self.err(ctx.sk('dock_min')), onCommit: function (t) { set({ dock_min: Number(String(t).replace(/[^\d.]/g, '')) || 0 }); } });
          }, function (n) { return n + ' px'; }).concat(this.mRow(ctx, 'time_weather', function (set, whose) {
            return K.toggle({ label: 'Time & Weather in Menu', sub: whose, sk: ctx.sk('time_weather'), on: v.time_weather === 'menu',
                              onChange: function (on) { set({ time_weather: on ? 'menu' : 'page' }); } });
          }, function (t) { return t === 'menu' ? 'On' : 'Off'; }));
          c.appendChild(K.group({ header: 'Always Open', footer: (all ? 'For a screen whose menu is always open on tablets and computers. ' : '') +
              'Narrower than Keep Open Down To, the menu folds away and the Phones menu shows instead.' }, open));
        }
        if (side) {
          var ways = this.mRow(ctx, 'swipe', function (set, whose) {
            return K.toggle({ label: 'Swipe from Left Edge', sk: ctx.sk('swipe'), on: !!v.swipe,
              sub: whose || 'Drag right from the left edge, at any width. In the Home Assistant app, set its Swipe Right gesture to None.',
              onChange: function (on) { set(M.swipeChanges(on, v)); } });
          }, onOff).concat(this.mRow(ctx, 'clock', function (set, whose) {
            return K.toggle({ label: 'Tap Clock to Open Menu', sub: whose || 'The weather beside it still opens Weather.', sk: ctx.sk('clock'),
                              on: v.clock !== false, onChange: function (on) { set({ clock: on }); } });
          }, onOff));
          c.appendChild(K.group({ header: 'Other Ways to Open', footer: 'These work beside the button. With the swipe on, a Button Style can be No Button.' }, ways));
        }
        this.inMenuRows(c, ctx, true);
      }
      // THE HOME ASSISTANT SECTION and the rooms: the side menu's and the tab
      // bar's More alike -- the one home of each is linked
      inMenuRows(c, ctx, full) {
        var v = ctx.v;
        var rows = full ? this.mRow(ctx, 'ha_row', function (set, whose) {
          return K.toggle({ label: 'Home Assistant Section', sk: ctx.sk('ha_row'), on: !!v.ha_row,
                            sub: whose || 'Integrations, Automations, Settings and more.', onChange: function (on) { set({ ha_row: on }); } });
        }, function (on) { return on ? 'On' : 'Off'; }) : [];
        if (full && v.ha_row) {
          rows = rows.concat(this.mRow(ctx, 'ha_place', function (set, whose) {
            return K.select({ label: 'Placement', sub: whose || 'In the side menu and in the tab bar’s More.', sk: ctx.sk('ha_place'),
                              value: v.ha_place || 'rooms', options: M.HA_PLACES, onChange: function (x) { set({ ha_place: x }); } });
          }, function (x) { return M.choiceLabel(M.HA_PLACES, x || 'rooms'); }));
        }
        if (!full) {
          rows.push(K.nav({ label: 'Home Assistant Section', value: v.ha_row ? M.choiceLabel(M.HA_PLACES, v.ha_place || 'rooms') : 'Off',
                            href: ctx.base + '/side', sk: ctx.sk('ha_row') }));
        }
        rows.push(K.nav({ label: 'Rooms in the Menu', href: ctx.rooms, sk: ctx.house ? 'menu:rooms' : 'b:menu_rooms',
                          value: ctx.house ? '' : (ctx.b.rooms_custom ? 'Just This Screen' : 'Same as All Screens') }));
        c.appendChild(K.group({ header: 'In the Menu', footer: 'The Home Assistant section shows only what each person may open. Which rooms show, and their order, are in Rooms.' }, rows));
      }
      edgeTabPage(c, ctx) {
        var self = this, v = ctx.v, all = ctx.house, wide = this.hasAttribute('wide');
        this.tabPosRows(c, ctx);
        var size = [], sz = function (z) { return M.choiceLabel(M.TAB_SIZES, z); };
        if (all || M.tabletTab(v)) {
          size = size.concat(this.mRow(ctx, 'tab_size', function (set, whose) {
            return K.seg({ label: 'Tablets & Computers', sub: whose, sk: ctx.sk('tab_size'), value: v.tab_size || 'large', stack: !wide, options: M.TAB_SIZES,
                           onChange: function (z) { set({ tab_size: z }); } });
          }, sz));
        }
        if (all || M.phoneTab(v)) {
          size = size.concat(this.mRow(ctx, 'tab_size_phone', function (set, whose) {
            return K.seg({ label: 'Phones', sub: whose, sk: ctx.sk('tab_size_phone'), value: v.tab_size_phone || 'standard', stack: !wide, options: M.TAB_SIZES,
                           onChange: function (z) { set({ tab_size_phone: z }); } });
          }, sz));
        }
        if (size.length) c.appendChild(K.group({ header: 'Size', footer: 'On a phone the tab lies over the first column of tiles.' }, size));
      }
      // THE EDGE TAB'S PLACE, on every device that shows it
      tabPosRows(c, ctx) {
        var self = this, v = ctx.v, wide = this.hasAttribute('wide'), sk = ctx.sk;
        var tp = M.tabPosParts(v.tab_position), unit = tp.unit;
        // px <-> % at a wall tablet's 800 px, so the tab stays about where it was
        var conv = function (n, to) { var x = Number(n) || 0; return to === '%' ? Math.round(x / 8) : Math.round(x * 8); };
        var trows = this.mRow(ctx, 'tab_position', function (set, whose) {
          return K.seg({ label: 'Position', sub: whose, sk: sk('tab_position'), value: tp.mode, stack: !wide,
            options: [['date', 'Level with Date'], ['custom', 'Custom']],
            onChange: function (m) { set({ tab_position: m === 'date' ? '' : '120px' }); } });
        }, M.tabPosLabel);
        var set = ctx.house ? ctx.set : function (ch) { return ctx.set(M.menuOwnSet(ctx.b, ch)); };
        if (tp.mode === 'custom') {
          trows.splice(1, 0, K.text({ label: 'Distance from Top', sub: 'Where the middle of the tab sits.', sk: sk('tab_position') + ':n',
            value: tp.n, unit: unit === '%' ? '%' : 'px', inputmode: 'decimal', error: this.err(sk('tab_position')),
            onCommit: function (t) {
              // a number (px or %), or nothing changes: an empty or wordy box
              // is not a way back to Level with Date -- that has its own button
              var ek = sk('tab_position');
              if (!/^\s*\d+(\.\d+)?\s*(px|%)?\s*$/.test(String(t))) { self.errors[ek] = M.errorText('tab_position'); self.render(); return; }
              delete self.errors[ek];
              set({ tab_position: M.tabPosJoin(t, unit) });
            } }), K.seg({ label: 'Measured In', sk: sk('tab_position') + ':u', value: unit, stack: !wide,
            options: [['px', 'Pixels'], ['%', '% of Screen Height']],
            onChange: function (u) { if (u !== unit) set({ tab_position: M.tabPosJoin(conv(tp.n, u), u) }); } }));
        }
        c.appendChild(K.group({ header: 'Position', footer: 'Level with Date lines the tab up with the date under the clock. Custom places it a distance from the top.' }, trows));
      }
      // THE TAB BAR: where it sits and how it looks, while scrolling, its tabs
      // and More -- each device's own value where it has one. Its glass is how
      // it looks: under Appearance.
      tabBarPage(c, ctx) {
        var self = this, v = ctx.v, all = ctx.house, wide = this.hasAttribute('wide');
        var tb = all || M.tabletTabBar(v), ph = all || M.phoneMenu(v) === 'tabbar';
        var pos = v.tab_bar_pos || 'bottom', rail = pos === 'left' || pos === 'right';
        var L = function (list) { return function (x) { return M.choiceLabel(list, x); }; };
        var bar = this.mRow(ctx, 'tab_bar_pos', function (set, whose) {
          return K.seg({ label: 'Position', sub: whose || 'Left and right are a rail on a tablet or computer; a phone keeps the bar at the bottom.',
                         sk: ctx.sk('tab_bar_pos'), value: pos, stack: !wide, options: M.TAB_BAR_POS, onChange: function (x) { set({ tab_bar_pos: x }); } });
        }, L(M.TAB_BAR_POS)).concat(this.mRow(ctx, 'tab_bar_size', function (set, whose) {
          return K.seg({ label: 'Size', sub: whose || 'The bar’s thickness (a rail’s width), its icons and labels.',
                         sk: ctx.sk('tab_bar_size'), value: v.tab_bar_size || 'medium', stack: !wide, options: M.TAB_BAR_SIZES,
                         onChange: function (x) { set({ tab_bar_size: x }); } });
        }, L(M.TAB_BAR_SIZES))).concat(this.mRow(ctx, 'tab_bar_labels', function (set, whose) {
          return K.seg({ label: 'Labels', sub: whose || 'Icons Only drops the names for a slimmer bar or rail.',
                         sk: ctx.sk('tab_bar_labels'), value: v.tab_bar_labels || 'show', stack: !wide, options: M.TAB_BAR_LABELS,
                         onChange: function (x) { set({ tab_bar_labels: x }); } });
        }, L(M.TAB_BAR_LABELS)));
        // a bar along the bottom always leaves room at the page's end
        // (hk-tabbar.js room()): the switch is the rail's and the top's
        if (pos !== 'bottom') {
          bar = bar.concat(this.mRow(ctx, 'tab_bar_adjust', function (set, whose) {
            return K.toggle({ label: 'Adjust Content', sk: ctx.sk('tab_bar_adjust'), on: v.tab_bar_adjust !== false,
              sub: whose || (rail ? 'The page moves aside for the open rail. Off, the rail floats over the page.'
                                  : 'The page slides down clear of the open bar. Off, the bar floats over the page.'),
              onChange: function (on) { set({ tab_bar_adjust: on }); } });
          }, function (on) { return on !== false ? 'On' : 'Off'; }));
        }
        c.appendChild(K.group({ header: 'The Bar', footer: 'Its glass is under Appearance, with the other looks.' }, bar));
        // THE SIDE STRIP (2026-10-30, hk-tabbar.js stripSide): the iPhone
        // Duo's strip of system controls down one side, its foot empty -- the
        // bar becomes a rail there, as its own apps have it
        var strip = this.mRow(ctx, 'tab_bar_strip', function (set, whose) {
          return K.toggle({ label: 'Use the Side Strip', sk: ctx.sk('tab_bar_strip'), on: v.tab_bar_strip !== false,
            sub: whose || 'Tabs that don’t fit below the strip’s own items are in More.',
            onChange: function (on) { set({ tab_bar_strip: on }); } });
        }, function (on) { return on !== false ? 'On' : 'Off'; });
        c.appendChild(K.group({ header: 'Side Strip', footer: 'On a phone with a strip of system controls at its side, such as iPhone Duo, the tab bar sits in the strip’s empty part.' }, strip));
        var scroll = [];
        if (tb) scroll = scroll.concat(this.mRow(ctx, 'tab_bar_scroll', function (set, whose) {
          return K.seg({ label: 'Tablets & Computers', sub: whose, sk: ctx.sk('tab_bar_scroll'), value: v.tab_bar_scroll || 'shrink', stack: !wide,
                         options: M.TAB_BAR_SCROLLS, onChange: function (x) { set({ tab_bar_scroll: x }); } });
        }, L(M.TAB_BAR_SCROLLS)));
        if (ph) scroll = scroll.concat(this.mRow(ctx, 'tab_bar_scroll_phone', function (set, whose) {
          return K.seg({ label: 'Phones', sub: whose, sk: ctx.sk('tab_bar_scroll_phone'), value: v.tab_bar_scroll_phone || 'shrink', stack: !wide,
                         options: M.TAB_BAR_SCROLLS, onChange: function (x) { set({ tab_bar_scroll_phone: x }); } });
        }, L(M.TAB_BAR_SCROLLS)));
        if ((tb && (v.tab_bar_scroll || 'shrink') === 'shrink') || (ph && (v.tab_bar_scroll_phone || 'shrink') === 'shrink')) {
          scroll = scroll.concat(this.mRow(ctx, 'tab_bar_fold', function (set, whose) {
            return K.seg({ label: 'Shrinks To', sub: whose || (rail ? 'The end of the rail the small button sits at.' : 'The side the small button sits at.'),
                           sk: ctx.sk('tab_bar_fold'), value: v.tab_bar_fold || 'start', stack: !wide, options: M.foldOptions(pos),
                           onChange: function (x) { set({ tab_bar_fold: x }); } });
          }, function (x) { return M.choiceLabel(M.foldOptions(pos), x || 'start'); })).concat(this.mRow(ctx, 'tab_bar_start', function (set, whose) {
            return K.toggle({ label: 'Start Small', sub: whose || 'The bar rests as the small button; tap it to open the bar.',
                              sk: ctx.sk('tab_bar_start'), on: v.tab_bar_start === 'small', onChange: function (on) { set({ tab_bar_start: on ? 'small' : 'full' }); } });
          }, function (x) { return x === 'small' ? 'On' : 'Off'; }));
        }
        c.appendChild(K.group({ header: 'While Scrolling', footer: 'Shrink folds the bar into one small button as you scroll down; Hide slides it away. Scrolling up, either end of the page or a tap brings it back.' }, scroll));
        var tabs = [], nums = function (list) { return list.map(function (t) { return [String(t[0]), t[1]]; }); };
        if (tb) tabs = tabs.concat(this.mRow(ctx, 'tab_bar_tabs', function (set, whose) {
          return K.select({ label: 'Tabs in Bar', sub: whose || 'On tablets and computers, at the bottom or the top.', sk: ctx.sk('tab_bar_tabs'),
                            value: String(v.tab_bar_tabs || 6), options: nums(M.TAB_BAR_TABS), onChange: function (x) { set({ tab_bar_tabs: Number(x) }); } });
        }, String));
        if (ph) tabs = tabs.concat(this.mRow(ctx, 'tab_bar_tabs_phone', function (set, whose) {
          return K.select({ label: 'Tabs in Bar on Phones', sub: whose, sk: ctx.sk('tab_bar_tabs_phone'),
                            value: String(v.tab_bar_tabs_phone || 3), options: nums(M.TAB_BAR_TABS_PHONE), onChange: function (x) { set({ tab_bar_tabs_phone: Number(x) }); } });
        }, String));
        if (tb) tabs = tabs.concat(this.mRow(ctx, 'tab_bar_tabs_rail', function (set, whose) {
          return K.select({ label: 'Tabs in Rail', sub: whose || 'Down the left or the right.', sk: ctx.sk('tab_bar_tabs_rail'),
                            value: String(v.tab_bar_tabs_rail || 6), options: nums(M.TAB_BAR_TABS), onChange: function (x) { set({ tab_bar_tabs_rail: Number(x) }); } });
        }, String));
        c.appendChild(K.group({ header: 'Tabs', footer: 'Pages, besides Home and More. A narrow phone shows fewer when they don’t fit; the rest are in More.' }, tabs));
        var more = [];
        [[tb, '', 'Tablets & Computers', 'icons'], [ph, '_phone', 'Phones', 'list']].forEach(function (d) {
          if (!d[0]) return;
          more = more.concat(self.mRow(ctx, 'tab_bar_more' + d[1], function (set, whose) {
            return K.seg({ label: 'More Style on ' + d[2], sub: whose, sk: ctx.sk('tab_bar_more' + d[1]), value: v['tab_bar_more' + d[1]] || d[3], stack: !wide,
                           options: M.TAB_BAR_MORE, onChange: function (x) { var ch = {}; ch['tab_bar_more' + d[1]] = x; set(ch); } });
          }, L(M.TAB_BAR_MORE))).concat(self.mRow(ctx, 'tab_bar_rooms' + d[1], function (set, whose) {
            return K.seg({ label: 'Rooms on ' + d[2], sub: whose, sk: ctx.sk('tab_bar_rooms' + d[1]), value: M.roomsPlace(v['tab_bar_rooms' + d[1]]), stack: !wide,
                           options: M.TAB_BAR_ROOMS, onChange: function (x) { var ch = {}; ch['tab_bar_rooms' + d[1]] = x; set(ch); } });
          }, function (x) { return M.choiceLabel(M.TAB_BAR_ROOMS, M.roomsPlace(x)); }));
        });
        c.appendChild(K.group({ header: 'More', footer: 'Icons: a grid, as wide as the screen allows. List: rows like the side menu. Rooms In More sit under the pages; Own Button is a round button beside the bar.' }, more));
        this.inMenuRows(c, ctx, false);
      }
      // BACK BUTTON & TITLE (page_header, Page Header before 2026-10-29): the
      // header on every page but Home -- All Screens' page; a screen's is in
      // its Header group
      headerRows(ctx) {
        var v = ctx.v;
        return this.mRow(ctx, 'page_header', function (set, whose) {
          return K.select({ label: 'Back Button & Title', sub: whose, sk: ctx.sk('page_header'), value: v.page_header || 'current', options: M.PAGE_HEADERS,
                            onChange: function (value) { set({ page_header: value }); } });
        }, function (x) { return M.choiceLabel(M.PAGE_HEADERS, x || 'current'); });
      }
      headerPage(c, ctx) {
        c.appendChild(K.group({ footer: M.PAGE_HEADER_SAYS + ' Each screen can choose its own, in its Header.' }, this.headerRows(ctx)));
      }
      // A SCREEN'S MENU ON ONE DEVICE (`device` 'tablets' or 'phones'): always
      // the screen's own, set only on its page. Changing the tablets' writes
      // the phones' down first, so phones keep what they show.
      menuKind(b, set, device, label) {
        var self = this, wide = this.hasAttribute('wide');
        if (device === 'phones') {
          return K.seg({ label: label, sk: 'b:menu_phone', value: M.phoneMenu(b), stack: !wide, options: M.PHONE_MENUS,
                         onChange: function (v) { set({ menu_phone: v }); } });
        }
        var mode = M.menuMode(b);
        if (mode === 'button') this._lastStyle = b.menu;
        return K.seg({ label: label, sk: 'b:menu', value: mode, stack: !wide,
          options: [['off', 'Off'], ['button', 'Button'], ['open', 'Always Open'], ['tabbar', 'Tab Bar']],
          onChange: function (v) {
            var ch = { menu: M.menuFor(v, b, self._lastStyle) };
            if (!b.menu_phone) ch.menu_phone = M.phoneMenu(b);
            set(ch);
          } });
      }
      // ONE PICK OF MANY, then back: the tablets' button style, Phones'
      menuStyle(c, cur, pick, swipe) {
        c.appendChild(K.group({ footer: 'Below 1,024 px — an iPad held upright, Split View — the screen shows its Phones menu.' +
            (swipe ? '' : ' Turn on Swipe from Left Edge to choose No Button.') },
          M.stylesFor(M.MENU_STYLES, swipe, cur).map(function (s) {
            return K.check({ label: s[1], sub: s[2], on: cur === s[0], fk: 'style:' + s[0], onClick: function () { pick(s[0]); } });
          })));
      }
      // PHONES' BUTTON STYLE (button_phone)
      phoneStyle(c, cur, pick, swipe) {
        c.appendChild(K.group({ footer: M.DEVICES.phones + ' Also a tablet whose own menu doesn’t fit.' +
            (swipe ? '' : ' Turn on Swipe from Left Edge to choose No Button.') },
          M.stylesFor(M.BUTTON_PHONE, swipe, cur).map(function (n) {
            return K.check({ label: n[1], sub: n[2], on: (cur || 'chip') === n[0], fk: 'phone:' + n[0], onClick: function () { pick(n[0]); } });
          })));
      }
      // A KIND'S PAGE FOR ALL SCREENS, its first line: which screens use it --
      // the page's scope line under its title (2026-10-30: an empty group's
      // footer before, out of line with the title)
      usedLine(kind) {
        var self = this, names = M.kindUsers(kind, this.data.boards, function (p) { var d = self.dash(p); return d ? d.title : p; });
        return K.esc(names.length ? 'Used by ' + (names.length > 2 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names.join(' and ')) +
            '. A screen can set any of these as its own, in its Menu.' : 'Not used on any screen. These wait until a screen uses it.');
      }
      // A PAGE'S HIGHLIGHT (look.page_accents): its default first, then the
      // colors and your own -- the page you're on in the menu, while a
      // screen's Accent Color is Automatic
      pageAccent(c, key) {
        var self = this, all = this.hs('look.page_accents') || {}, pa = M.pageAccentOf(key, all);
        var put = function (v) {
          var next = Object.assign({}, all);
          if (v) next[key] = v; else delete next[key];
          self.setH({ 'look.page_accents': next });
        };
        c.appendChild(K.group({ footer: 'The page’s own color: in the menu when you’re on it, while a screen’s Accent Color is Automatic, and in Flat a very light or very dark shade of it is the page’s Automatic background. Choosing another Background overrides that.' }, [
          K.check({ label: 'Default', sub: pa.d.name, tile: ['', pa.d.hex], on: !pa.own, fk: 'paccent:default', onClick: function () { put(null); } })]));
        c.appendChild(K.group({ header: 'Colors' }, M.ACCENTS.map(function (x) {
          return K.check({ label: x[1], tile: ['', x[2]], on: pa.own && !pa.a.custom && pa.a.hex === x[2], fk: 'paccent:' + x[0], onClick: function () { put(x[0]); } });
        })));
        var row = K.text({ label: 'Your Own Color', sub: pa.own && pa.a.custom ? pa.a.hex : 'Pick any color.', type: 'color', fk: 'paccent:custom',
                           value: pa.a.hex, error: this.err('look.page_accents'),
                           onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) put(t.toLowerCase()); } });
        var inp = row.querySelector('input');
        if (inp) {
          inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
          inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) put(inp.value.toLowerCase()); });
        }
        c.appendChild(K.group({ header: 'Custom' }, [row]));
      }
      // ACCENT COLOR (2026-10-29): the menu's highlight and Flat's accent, one
      // choice (M.accentColorOf) -- All Screens' (b null) or a screen's, whose
      // first row is Same as All Screens
      accentOf(x, b) {
        var look = this.data.settings.look || {}, houseFlat = this.flatHere(null);
        return M.accentColorOf(look, this.data.settings.menu || {}, b, b ? this.flatHere(b) : houseFlat, houseFlat);
      }
      accentNav(x, b, href) {
        var ac = this.accentOf(x, b);
        return K.nav({ label: 'Accent Color', value: ac.name, href: href, sk: b ? 'b:accent' : 'menu.accent',
                       sub: b ? (ac.own ? 'Just This Screen' : 'Same as All Screens') : null,
                       tile: ['', ac.hex || AUTO_ACCENT_TILE] });
      }
      accentPage(c, x, b) {
        var self = this, ac = this.accentOf(x, b), flat = b ? this.flatHere(b) : this.flatHere(null);
        var sc = this.flatScope(b ? 'screen' : 'house', x, b), tintAuto = flat && sc.resolved().off_tint.value === 'auto';
        // (the page stays, its checkmark moved: as Flat Colors' pickers do)
        var pick = function (v) {
          return b ? self.setB(x.path, M.accentChanges(v, b, tintAuto)) : self.setH(M.accentChanges(v, null, tintAuto));
        };
        var mine = !b || ac.own, cur = String(ac.value || '').toLowerCase();
        var named = function (n) { return mine && (cur === n[0] || cur === n[2]); };
        var rows = [];
        if (b) rows.push(K.check({ label: 'Same as All Screens', sub: 'Now ' + ac.house.name, on: !ac.own, fk: 'accent:inherit',
                                   tile: ['', ac.house.hex || AUTO_ACCENT_TILE], onClick: function () { pick(null); } }));
        rows.push(K.check({ label: 'Automatic', tile: ['', AUTO_ACCENT_TILE], on: mine && cur === 'auto', fk: 'accent:auto',
          sub: flat ? 'In Flat, Flat’s own: each page’s Accent Color, Home and the rooms orange.'
                    : 'The page you’re on in its own color (Climate blue, Lights yellow…), Home and the rooms orange.',
          onClick: function () { pick('auto'); } }));
        M.ACCENTS.forEach(function (n) {
          rows.push(K.check({ label: n[1], tile: ['', n[2]], on: named(n), fk: 'accent:' + n[0], onClick: function () { pick(n[0]); } }));
        });
        c.appendChild(K.group({ footer: 'Colors the menu’s icons, the tab bar and the page you’re on. In Flat it also shades an Automatic background and, while Off Pill Tint matches it, the pills.' }, rows));
        var custom = mine && cur !== 'auto' && !M.ACCENTS.some(function (n) { return named(n); });
        var row = K.text({ label: 'Your Own Color', sub: custom ? ac.name + ' · ' + (ac.hex || '').toUpperCase() : 'Pick any color.', type: 'color', fk: 'accent:custom',
                           value: ac.hex || '#ff9f0a', error: this.err('menu.accent') || this.err('b:accent'),
                           onCommit: function (t) { if (/^#[0-9a-f]{6}$/i.test(t)) pick(t.toLowerCase()); } });
        var inp = row.querySelector('input');
        if (inp) {
          inp.style.cssText = 'flex:none;width:44px;height:30px;padding:0;border-radius:8px;cursor:pointer';
          inp.addEventListener('change', function () { if (/^#[0-9a-f]{6}$/i.test(inp.value)) pick(inp.value.toLowerCase()); });
        }
        if (custom) row.classList.add('on');
        c.appendChild(K.group({ header: 'Custom' }, [row]));
      }
    };
    KIT.install(Methods);
  };
})();
