// hk-settings-screen-kiosk.js - a screen's kiosk, engine, options and YAML pages.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-screen-kiosk'] = function (KIT) {
    var optGet = KIT.optGet, optSet = KIT.optSet, PN = KIT.PN;

    var h, K;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      stateLabel(id) {
        var st = this.client && this.client.states[id];
        return st ? (st.state === 'on' ? 'On' : st.state === 'off' ? 'Off' : st.state) : '';
      }

      // HEADER & SIDEBAR: what HK Frontend hides (hk-kiosk.js) -- and, on a
      // generated screen where the Kiosk Mode plugin is installed (or already
      // chosen), the plugin instead, with its own options page.
      kioskPage(c, x, b, path) {
        var self = this, base = '#/screens/' + encodeURIComponent(path);
        var set = function (o) { return self.setB(path, o); };
        var plugin = x.generated && b.kiosk_engine === 'kiosk_mode';
        // ON OR OFF first; what is hidden, and how, only while on
        c.appendChild(K.group({ footer: b.kiosk ? null : 'When this screen is shown in Home Assistant, Home Assistant’s own header and sidebar show around it.' }, [
          K.toggle({ label: 'Hide Header & Sidebar', sk: 'b:kiosk', on: b.kiosk, onChange: function (on) { set({ kiosk: on }); } })]));
        if (!b.kiosk) return;
        if (!plugin) {
          c.appendChild(K.group({ footer: 'Whatever is hidden, the menu’s Home Assistant section still reaches Home Assistant ' +
              '(Show Menu opens its sidebar). To see them on one visit, add ?\u2060hk_kiosk=off to the screen’s address.' +
              (x.generated ? '' : ' This dashboard’s own YAML can say it instead (hk_kiosk), and then that is used; ' +
               'if it has a kiosk_mode block, the Kiosk Mode plugin does it and these do nothing.') }, [
            K.toggle({ label: 'Hide Header', sub: 'The bar along the top with the dashboard’s name, its views and its menu.',
                       sk: 'b:kiosk_header', on: b.kiosk_header !== false, onChange: function (on) { set({ kiosk_header: on }); } }),
            K.toggle({ label: 'Hide Sidebar', sk: 'b:kiosk_sidebar', on: b.kiosk_sidebar !== false,
                       onChange: function (on) { set({ kiosk_sidebar: on }); } }),
            K.toggle({ label: 'For Admins Too', sub: 'Off: someone signed in as an admin still sees them.',
                       sk: 'b:kiosk_admins', on: b.kiosk_admins !== false, onChange: function (on) { set({ kiosk_admins: on }); } })]));
        }
        if (!x.generated) return;
        var tp = (this.data.thirdparty || {}).kiosk || {};
        if (!plugin && (!tp.state || tp.state === 'missing')) return;
        var rows = [K.toggle({ label: 'Use the Kiosk Mode Plugin Instead', sk: 'b:kiosk_engine', on: plugin, onChange: function (on) {
          set({ kiosk_engine: on ? 'kiosk_mode' : 'hk' });
        } })];
        if (plugin) rows.push(K.nav({ label: 'Kiosk Mode Options', href: base + '/kiosk-mode', sk: 'b:kiosk_options',
                                      value: Object.keys(b.kiosk_options || {}).length ? 'Custom' : 'Default' }));
        c.appendChild(K.group({ header: 'Kiosk Mode Plugin', footer: plugin
          ? 'The Kiosk Mode plugin (HACS) hides them on this screen, with its own options. Off: ' + PN() + ' does it.' +
            (tp.state !== 'ready' && tp.note ? ' ' + tp.note : '')
          : PN() + ' hides them itself. The Kiosk Mode plugin (HACS) can do it instead, for its own options.' }, rows));
      }

      // WALLPANEL INSTEAD: only where WallPanel (HACS) is installed, for a screen
      // that prefers it; its own options page then takes over.
      engineGroup(c, b, path) {
        var self = this, tp = (this.data.thirdparty || {}).wallpanel || {};
        var wp = b.screensaver_engine === 'wallpanel';
        if (!wp && (!tp.state || tp.state === 'missing')) return;
        c.appendChild(K.group({ header: 'WallPanel', footer: wp
          ? 'WallPanel (HACS) draws this screen’s screensaver, with the options below. Off: ' + PN() + '’s own.'
          : 'Draw this screen’s screensaver with WallPanel (HACS) instead of ' + PN() + '’s own.' }, [
          K.toggle({ label: 'Use WallPanel Instead', on: wp, sk: 'b:screensaver_engine', onChange: function (on) {
            self.setB(path, { screensaver_engine: on ? 'wallpanel' : 'hk' }).then(function () {
              self.go('#/screens/' + encodeURIComponent(path) + (on ? '/wallpanel' : '/screensaver'));
            });
          } })]));
      }

      optionsPage(c, spec, cur, save, yamlHref, tp) {
        var self = this;
        if (tp && tp.state && tp.state !== 'ready') c.appendChild(K.group({ footer: tp.note }, []));
        spec.groups.forEach(function (g, gi) {
          var rows = g.rows.map(function (r, ri) {
            var fk = 'opt:' + (r.key || r.fk || gi + '-' + ri), v = optGet(r, cur);
            var put = function (nv) { save(optSet(r, cur, nv)); };
            if (r.type === 'switch') return K.toggle({ label: r.label, sub: r.sub, on: !!v, sk: fk, onChange: put });
            if (r.type === 'seg') return K.seg({ label: r.label, sub: r.sub, value: v, options: r.options, sk: fk, onChange: put });
            var opts = r.options.map(function (op) { return [String(op[0]), op[1]]; });
            if (v !== '' && !opts.some(function (op) { return op[0] === String(v); })) opts.push([String(v), String(v)]);
            return K.select({ label: r.label, sub: r.sub, value: String(v), options: opts, sk: fk, onChange: put });
          });
          c.appendChild(K.group({ header: g.header, footer: gi === spec.groups.length - 1 ? spec.footer : null }, rows));
        });
        var n = Object.keys(cur || {}).length;
        c.appendChild(K.group({ header: 'More', footer: 'Any other option the card has, written in YAML.' }, [
          K.nav({ label: 'Options in YAML', value: n ? n + ' Set' : 'None', href: yamlHref, sk: 'opt:yaml' })]));
        if (n) {
          c.appendChild(K.group({}, [K.button({ label: 'Reset to Tuned Setup…', destructive: true, fk: 'opt:reset', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Use the tuned setup?', message: 'Every option changed here and in YAML goes back.',
                                         ok: 'Use Tuned Setup', destructive: true }).then(function (yes) { if (yes) save({}); });
          } })]));
        }
      }

      // A YAML PAGE: the options as written, Save / Revert / Use Default
      yamlPage(c, o) {
        var self = this, cur = o.value || {}, valid = true;
        if (o.example) {
          var ex = K.group({ header: 'For Example', footer: o.docs ? h('span', {}, ['Every option: ',
            h('a', { href: o.docs, target: '_blank', rel: 'noopener', text: 'the card’s documentation' }), '.']) : null }, []);
          ex.querySelector('.cells').appendChild(h('pre', { class: 'ex', text: o.example }));
          c.appendChild(ex);
          var dl = ex.querySelector('.gf a'); if (dl) dl.setAttribute('href', o.docs);
        }
        var box = h('div', { class: 'yaml' });
        // what to write goes under the editor, with the group's other notes
        // (not in the page-subtitle style: after other groups that sat at the
        // page's margin, out of line with every footer)
        var grp = K.group({ footer: [o.help, o.note].filter(Boolean).join(' ') || null }, []);
        grp.querySelector('.cells').replaceWith(box);
        c.appendChild(grp);
        var err = this.err(o.sk);
        if (err) c.appendChild(h('div', { class: 'errline', role: 'alert', text: err }));
        var saveBtn = K.button({ label: o.saveLabel || 'Save', fk: o.sk + ':save', onClick: function () {
          if (!valid) { self.announce('The YAML has a mistake.'); return; }
          o.onSave(cur && typeof cur === 'object' ? cur : {});
        } });
        var rows = [saveBtn];
        if (o.clear !== false && Object.keys(o.value || {}).length) {
          rows.push(K.button({ label: 'Reset to Default Options…', destructive: true, fk: o.sk + ':clear', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Use the default options?', message: 'What’s written here will be removed.',
                                         ok: 'Use Default', destructive: true }).then(function (yes) { if (yes) o.onSave({}); });
          } }));
        }
        c.appendChild(K.group({}, rows));
        // THE KIT'S YAML EDITOR (Phase 2 P2.4; Home Assistant's before): the
        // value written out, read back at every change -- empty is {}, a
        // mistake leaves Save saying so
        box.appendChild(K.yaml({ value: cur, label: o.label || 'YAML', fk: o.sk + ':yaml', sk: o.sk + ':yaml',
          onChange: function (v, ok) {
            valid = ok; cur = v;
            if (valid && o.onDraft) o.onDraft(cur);
          } }));
      }
    };
    KIT.install(Methods);
  };
})();
