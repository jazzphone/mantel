// hk-settings-screen-glass.js - a screen's pages, its Home page, and its glass.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-screen-glass'] = function (KIT) {
    var h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // THE ENERGY FEATURE IS ADDED: its page (and its page pill) exist
      energyOn() {
        var feats = (this.data && this.data.features) || {};
        return !!(feats.hk_energy && (feats.hk_energy.entries || []).length);
      }

      // THE POWER PAGE IS ON (the Energy plan has one): its page kind exists
      powerOn() {
        var E = this.energyOn() && window.hkSettings && window.hkSettings.get('energy', null);
        return !!(E && E.power);
      }

      // WHAT A SCREEN SHOWS (hk-settings-model.js onlySummary): null for a
      // whole screen; for one with no Home page, its pages in a few words
      onlyOf(b) {
        var d = this.data || {}, custom = {};
        (d.custom_pages || []).forEach(function (p) { custom[p.path] = p.title; });
        var energyOn = this.energyOn(), powerOn = this.powerOn();
        if (energyOn) delete custom.energy;
        var kinds = (d.page_kinds || []).filter(function (k) { return (k !== 'energy' || energyOn) && (k !== 'power' || powerOn); });
        return M.onlySummary(b, kinds, custom, energyOn, function (k) { return custom[k] !== undefined ? custom[k] : (M.PAGE_LABELS[k] || k); });
      }

      // HOME PAGE OFF / ON: asked first, and said what changes. The two lists
      // are apart (only_pages / pages), so either way the other is kept.
      setHomePage(path, on) {
        var self = this;
        return this.confirmSwitch(on
          ? { title: 'Make It a Whole Screen?', ok: 'Whole Screen',
              message: 'Its Home page, its rooms and its other pages come back, as they were. The pages it shows now are kept, for if you turn Home Page off again.' }
          : { title: 'Show Only Some Pages?', ok: 'Only Some Pages',
              message: 'This screen will have no Home page and no room pages — only the pages you pick next, opening on the first. ' +
                       'Until you pick one it still shows everything. Nothing is deleted: turn Home Page back on to get the whole screen back.' },
          function () {
            return self.setB(path, { home_page: !!on }).then(function () {
              if (!on) self.go('#/screens/' + encodeURIComponent(path) + '/pages');
              return true;
            });
          });
      }

      dwInSecurity(b) { return !!this.hs('security.alarm') && M.screenShows(b, 'security'); }

      s_pages(c, x, b) {
        var self = this, set = function (ch) { return self.setB(x.path, ch); };
        var custom = {};
        (this.data.custom_pages || []).forEach(function (p) { custom[p.path] = p.title; });
        // THE ENERGY PAGE: with the Energy feature, the generated page has the
        // address `energy` -- a custom page there is not a page of its own
        // (hk-strategy.js shows the generated one); without it, no Energy page
        // to offer
        var energyOn = this.energyOn(), powerOn = this.powerOn();
        var homeCustom = Object.assign({}, custom);
        custom = Object.assign({}, custom);
        if (energyOn) delete custom.energy;
        var kinds = (this.data.page_kinds || []).filter(function (k) { return (k !== 'energy' || energyOn) && (k !== 'power' || powerOn); });
        // DOORS & WINDOWS IS SECURITY'S where the house has an alarm and this
        // screen shows Security (hk-strategy.js withSecurity): no page of its own
        if (this.dwInSecurity(b)) kinds = kinds.filter(function (k) { return k !== 'doors_windows'; });
        var lab = function (k) { return custom[k] !== undefined ? custom[k] : (M.PAGE_LABELS[k] || k); };
        // HOME PAGE: off, the screen is only the pages it lists -- any of them
        var om = b.home_page === false ? M.onlyModel(b, kinds, custom, energyOn) : null;
        var firstOnly = om && om.rows.length ? lab(om.rows[0].value) : null;
        c.appendChild(K.group({ footer: b.home_page === false
            ? (firstOnly ? 'This screen is only these pages, and opens on ' + firstOnly + '.'
                         : 'Add a page below: with none, the screen is a whole screen as usual.')
            : 'Off: the screen is only the pages you pick, and opens on the first — the Energy page alone, say, or Security and Cameras.' }, [
          K.toggle({ label: 'Home Page', sk: 'b:home_page', on: b.home_page !== false,
                     sub: b.home_page === false ? 'Off: only the pages below' : 'On: a whole screen',
                     onChange: function (on) { self.setHomePage(x.path, on); } })]));
        // WHICH HOME: the generated one, or one of the house's custom pages, with
        // the screen's other pages generated as usual (a car's own first page)
        if (b.home_page !== false && Object.keys(homeCustom).length) {
          var hv = b.home_view && homeCustom[b.home_view] !== undefined ? b.home_view : '';
          c.appendChild(K.group({ footer: hv
              ? 'The screen opens on ' + homeCustom[hv] + '; its other pages are generated as usual.'
              : 'A custom page can be this screen’s Home, with its other pages generated as usual — a car’s own first page, say.' }, [
            K.select({ label: 'Home', sk: 'b:home_view', value: hv,
                       options: [['', 'Generated']].concat(Object.keys(homeCustom).map(function (k) { return [k, homeCustom[k]]; })),
                       onChange: function (v) { set({ home_view: v }); } })]));
        }
        if (om) {
          var subOf = function (r) { return r.custom ? 'Custom page' : r.value === 'rooms' ? 'A page for every room' : null; };
          var hrefOf = function (r) {
            return r.custom ? '#/pages/' + encodeURIComponent(r.value) : r.value === 'energy' ? '#/page/energy' : null;
          };
          c.appendChild(K.listEditor({ fk: 'opages', minRows: 0, announce: this.announce.bind(this), shownHeader: 'This Screen Shows Only',
            emptyText: 'No pages yet — add one from More. Until then the screen shows everything.',
            shownFooter: 'In this order; the screen opens on the first. Any page a generated screen can have, and your custom pages.',
            rows: om.rows.map(function (r) {
              return { value: r.value, label: lab(r.value), sub: subOf(r), href: hrefOf(r) };
            }),
            more: om.more.map(function (r) { return { value: r.value, label: lab(r.value), sub: subOf(r) }; }),
            onChange: function (v) { set({ only_pages: v }); } }));
          return;
        }
        var mdl = M.pagesModel(b, kinds, custom);
        var keys = mdl.rows.map(function (r) { return r.value; });
        var menuOn = b.menu !== 'off';
        // WHERE EACH PAGE SITS IN THE MENU: top (right under
        // Home), Categories, or not in the menu -- its row's own pop-up menu
        var items = M.menuItems(keys, custom);
        var placeCtl = function (k) {
          var p = M.menuPathOf(k, custom);
          if (!p || !menuOn) return null;
          var it = items.filter(function (y) { return y.path === p; })[0];
          return K.popup({ label: lab(k) + ' in the menu', options: M.MENU_PLACES, value: M.placeOf(b, it, items),
                           fk: 'place:' + k, onChange: function (v) {
              var ch = M.placeSet(b, items, p, v);
              if (!ch) { self.announce('Categories keeps at least one page: move it to the top, or use the automatic menu.'); self.render(); return; }
              set(ch);
            } });
        };
        c.appendChild(K.listEditor({ fk: 'pages', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
          autoFooter: 'Automatic: every page the house has something for, in the usual order.',
          shownFooter: menuOn ? 'Top of Menu: right under Home, above Categories. Not in Menu: still one tap away on its chip. ' +
            'The order here is the menu’s order.' : 'This screen has no menu (Menu is Off).',
          rows: mdl.rows.map(function (r) {
            return { value: r.value, label: lab(r.value),
                     sub: r.custom ? 'Custom page' : null, removable: r.custom,
                     href: r.custom ? '#/pages/' + encodeURIComponent(r.value) : null,
                     control: placeCtl(r.value), value2: menuOn && M.MENU_FIXED[r.value] && !r.fixed ? M.MENU_FIXED[r.value] : null };
          }),
          more: mdl.more.filter(function (r) { return !mdl.auto || r.custom; })
            .map(function (r) { return { value: r.value, label: lab(r.value), sub: r.custom ? 'Custom page' : null }; }),
          onAuto: function (on) {
            if (!on) { set(M.pagesSave(mdl.rows.map(function (r) { return r.value; }), custom)); return; }
            self.confirmSwitch({ title: 'Use Automatic Pages?', message: 'This screen’s page order and choices will be replaced.', ok: 'Use Automatic' },
                function () { set({ pages: [] }); });
          },
          onAdd: mdl.auto ? function (v) { set(M.pagesCustom(b, v, true)); } : null,
          onRemove: function (v) { set(M.pagesCustom(b, v, false)); },
          onChange: function (v) { set(M.pagesSave(v, custom)); } }));
        if (menuOn && ((b.menu_top || []).length || (b.categories || []).length)) {
          c.appendChild(K.group({ footer: 'Automatic: Weather, Cameras and Live TV at the top, every other page under Categories.' }, [
            K.button({ label: 'Reset to Automatic Menu', fk: 'menu:auto', onClick: function () { set({ menu_top: [], categories: [] }); } })]));
        }
        c.appendChild(K.group({ footer: h('span', {}, ['Custom pages are written in ',
          h('a', { href: '#/pages', text: 'Custom Pages' }), '.']) }, []));
      }

      // THE GLASS STYLE, All Screens' or a screen's (2026-10-10): Glass,
      // Frosted or Blur, and -- while Blur is chosen -- how it blurs (Blur
      // Mode), each with what it costs. `cur`: the stored value shown as
      // chosen (null: none -- a screen following All Screens); `fallback`: the
      // blur mode Blur starts from; `pick(v)` saves; `fk` prefixes the keys.
      glassChoices(c, cur, fallback, pick, fk, header) {
        var style = cur ? M.glassStyle(cur) : null;
        c.appendChild(K.group({ header: header || 'Style' }, M.GLASS_STYLES.map(function (g) {
          return K.check({ label: g[1], sub: g[2], on: style === g[0], fk: fk + g[0], onClick: function () {
            // Blur and Bright Glass keep the mode already chosen
            pick(M.styleValue(g[0], cur, fallback));
          } });
        })));
        // (Bright Glass has Blur's three modes, 2026-10-30)
        var modes = M.modesFor(style);
        if (!modes) return;
        c.appendChild(K.group({ header: 'Blur Mode', footer: 'Shared Layer and Each Card blur live; Pre-rendered blurs a picture of the sky once. ' +
            'On a wall tablet, anything but Each Card. Pop-up sheets blur live in Shared Layer and Pre-rendered.' }, modes.map(function (m) {
          return K.check({ label: m[1], sub: m[2], on: cur === m[0], fk: fk + 'mode:' + m[0], onClick: function () { pick(m[0]); } });
        })));
      }

      s_glass(c, x, b) {
        var self = this, look = this.data.settings.look;
        var pick = function (v) {
          self.setB(x.path, v === 'flat' ? { flat: true } : v === 'house' ? { flat: null, glass: 'house' } : { flat: false, glass: v });
        };
        var gl = M.glassOf(b, look), follows = !gl.own;
        c.appendChild(K.group({ footer: 'Same as All Screens follows All Screens → Appearance, so this screen changes with the others.' }, [
          K.check({ label: 'Same as All Screens', sub: 'Now ' + M.glassLabel(gl.house), on: follows, fk: 'glass:house',
                    onClick: function () { pick('house'); } })]));
        // Blur here starts from All Screens' mode when theirs is a blur too
        this.glassChoices(c, follows ? null : gl.value, M.isBlur(look.glass) || M.isBright(look.glass) ? look.glass : 'blur', pick, 'glass:', 'Just This Screen');
      }
    };
    KIT.install(Methods);
  };
})();
