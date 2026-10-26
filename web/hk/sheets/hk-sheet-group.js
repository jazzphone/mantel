// hk-sheet-group.js - The entity registry sheet, a group's sheet, a custom pop-up's cards, and the registry of every sheet (PANELS).
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-group'] = function (K) {
    var accName = K.accName, AlarmPanel = K.AlarmPanel, at = K.at, BinaryPanel = K.BinaryPanel,
        ButtonPanel = K.ButtonPanel, C = K.C, CameraPanel = K.CameraPanel, ClimatePanel = K.ClimatePanel,
        CoverPanel = K.CoverPanel, domainOf = K.domainOf, FanPanel = K.FanPanel, GaragePanel = K.GaragePanel,
        GenericPanel = K.GenericPanel, HkBase = K.HkBase, HumidifierPanel = K.HumidifierPanel,
        LightPanel = K.LightPanel, LockPanel = K.LockPanel, MediaPanel = K.MediaPanel,
        NumberPanel = K.NumberPanel, open = K.open, SelectPanel = K.SelectPanel, SensorPanel = K.SensorPanel,
        sheetState = K.sheetState, StatePanel = K.StatePanel, stOf = K.stOf, TogglePanel = K.TogglePanel,
        VacuumPanel = K.VacuumPanel, ValvePanel = K.ValvePanel, WaterHeaterPanel = K.WaterHeaterPanel;

    // ------------------------------------------------------------ registry
    // kind (kindOf) -> element
    var PANELS = {
      light: 'hk-detail-light',
      toggle: 'hk-detail-toggle',
      fan: 'hk-detail-fan',
      cover: 'hk-detail-cover',
      cover_buttons: 'hk-detail-cover', garage: 'hk-detail-garage',
      vacuum: 'hk-detail-vacuum', valve: 'hk-detail-valve', number: 'hk-detail-number',
      select: 'hk-detail-select', humidifier: 'hk-detail-humidifier', water_heater: 'hk-detail-water-heater',
      lock: 'hk-detail-lock', button: 'hk-detail-button',
      climate: 'hk-detail-climate',
      media: 'hk-detail-media',
      sensor: 'hk-detail-sensor',
      state: 'hk-detail-state',
      binary: 'hk-detail-binary',
      alarm: 'hk-detail-alarm',
      camera: 'hk-detail-camera',
      group: 'hk-detail-group',
      cards: 'hk-detail-cards',
      // defined by hk-person.js, hk-calendar.js, hk-weather.js and hk-headers.js (each loads on its own;
      // open() says no until the element exists)
      person: 'hk-detail-person',
      event: 'hk-detail-event',
      weather: 'hk-detail-weather',
      automation: 'hk-detail-automation',
      timer: 'hk-detail-timer',
      // HK's generic sheet, for a kind with no sheet of its own on a host
      // without a detail of its own (Phase 2 P2.5)
      generic: 'hk-detail-generic'
    };
    function def(tag, Ctor) { if (!customElements.get(tag)) customElements.define(tag, Ctor); }
    // The panels fed a client alone (open(): every panel defined here except
    // the camera, group and custom-cards sheets, which hold cards of their own
    // and are still fed through the bridge).
    var CLIENT_FED = [LightPanel, TogglePanel, FanPanel, CoverPanel, LockPanel, GaragePanel, ButtonPanel,
                      ClimatePanel, MediaPanel, SensorPanel, StatePanel, BinaryPanel, VacuumPanel, ValvePanel,
                      NumberPanel, SelectPanel, HumidifierPanel, WaterHeaterPanel, AlarmPanel, GenericPanel];
    def('hk-detail-light', LightPanel);
    def('hk-detail-generic', GenericPanel);
    def('hk-detail-toggle', TogglePanel);
    def('hk-detail-fan', FanPanel);
    def('hk-detail-cover', CoverPanel);
    def('hk-detail-lock', LockPanel);
    def('hk-detail-garage', GaragePanel);
    def('hk-detail-button', ButtonPanel);
    def('hk-detail-climate', ClimatePanel);
    def('hk-detail-media', MediaPanel);
    def('hk-detail-sensor', SensorPanel);
    def('hk-detail-state', StatePanel);
    def('hk-detail-binary', BinaryPanel);
    def('hk-detail-vacuum', VacuumPanel);
    def('hk-detail-valve', ValvePanel);
    def('hk-detail-number', NumberPanel);
    def('hk-detail-select', SelectPanel);
    def('hk-detail-humidifier', HumidifierPanel);
    def('hk-detail-water-heater', WaterHeaterPanel);
    def('hk-detail-alarm', AlarmPanel);
    def('hk-detail-camera', CameraPanel);

    // ------------------------------------------------------------ a group
    // A ROOM'S "3 WINDOWS" (hk-room.js): the sheet every device gets, holding
    // those devices as the dashboard's own tiles, two to a row. A tile's name
    // opens that device's sheet in place of this one, as any sheet opened
    // from a sheet does. Tiles come from the generated dashboard's builder
    // where it has one for the kind (a fan is a fan tile), else a sensor tile
    // that reads its own state.
    var SENSOR_TILE = {
      windows: { icon: 'hk:window-closed-variant', on: 'hk:window-open-variant', label: 'open_closed' },
      doors: { icon: 'hk:door-closed', on: 'hk:door-open', label: 'open_closed' },
      garage: { icon: 'hk:garage', on: 'hk:garage-open', label: 'open_closed' },
      motion: { icon: 'hk:motion-sensor', label: 'state' },
      occupancy: { icon: 'hk:walk', label: 'state' },
      leaks: { icon: 'hk:water', on: 'hk:water-alert', label: 'state' }
    };
    function groupTile(h, id, room, kind) {
      var st = stOf(h, id), full = at(st, 'friendly_name') || id, S = window.hkStrategy;
      // the accessory's own name (its gear), as on every other page
      var name = accName(id) || (S && S.shortName ? S.shortName(full, room) : full);
      var d = domainOf(id);
      if (kind === 'temperature' || kind === 'humidity') {
        var e = (h.entities || {})[id] || {}, dev = (h.devices || {})[e.device_id] || {};
        var area = (h.areas || {})[e.area_id || dev.area_id] || {};
        room = area.name || '';
        name = accName(id) || (S && S.shortName ? S.shortName(full, room) : full);
        return { type: 'custom:hk-tile-card', entity: id, name: name, room: room, layout: room ? 'favourite' : 'standard',
          icon: kind === 'temperature' ? 'hk:home-thermometer' : 'hk:water-percent', icon_color: 'blue',
          label_mode: 'climate_' + kind, tap_action: { action: 'more-info' } };
      }
      if (d !== 'binary_sensor' && d !== 'sensor' && S && S.tileFor) {
        var t = S.tileFor(h, id, name);
        if (t) { t = Object.assign({}, t); delete t.view_layout; return t; }
      }
      var k = SENSOR_TILE[kind] || { icon: 'mdi:eye', label: 'state' };
      var closed = k.icon, opened = k.on;
      // a door, window or garage sensor's own glyph (its gear), as its pair
      if (opened && S && S.contactGlyphs) { var g = S.contactGlyphs(id, opened, closed); opened = g[0]; closed = g[1]; }
      var cfg = { type: 'custom:hk-tile-card', entity: id, name: name, icon: closed,
                  icon_color: 'blue', label_mode: k.label };
      if (opened && opened !== closed) cfg.icon_states = { on: opened };
      return cfg;
    }
    class GroupPanel extends HkBase {
      static get CSS() {
        // A sheet is the same 460 px on an iPad as on a desk, so its two
        // columns keep the full pill (--hk-pill is the iPad's, 170, on the page).
        // No cell bleed: a phone tile is its cell PLUS 8 px, for the 4 px
        // margins layout-card gives a page's cells (hk-tile.js) -- this grid
        // has none, so each pill would run 8 px into the gap and the right
        // column would be cut off at the sheet's edge on a phone.
        var T = C.TILE;
        return ':host{display:block;--hk-pill:' + T.w + 'px;--hk-cell-bleed:0px}' +
          '.summary{color:' + window.hkCards.v('ink-2') + ';font-size:16px;padding:0 0 18px;text-align:center}' +
          '.grp{display:grid;grid-template-columns:repeat(2,' + T.w + 'px);grid-auto-rows:auto;gap:' + T.gridGap + 'px;' +
          '  justify-content:center;align-content:start;padding:2px 0 8px}' +
          '@media (max-width:' + C.BP.phone + 'px){.grp{grid-template-columns:repeat(2,minmax(0,1fr))}}';
      }
      hkWidthKind() { return 'group'; }
      hkFill() { return true; }
      // null: every update goes on to the pills, which gate themselves. The
      // LIST is worked out again (resolve -- a page's members, a walk of the
      // house -- and every pill's config) only when what it reads moved:
      // its members' states, the registries (rooms, areas), the settings
      // and the modules (GEN, via _hkGen) -- not on every push.
      _sigOf() { return null; }
      _listSig(h) {
        var regs = [h.entities, h.devices, h.areas];
        if (!this._regs || regs.some(function (r, i) { return r !== this._regs[i]; }, this)) {
          this._regs = regs;
          this._regN = (this._regN || 0) + 1;
        }
        var HS = window.hkSettings, st = h.states || {}, out = this._regN + '|' + this._hkGen + '|' + (HS && HS.version) + '|';
        (this._ids || []).forEach(function (id) { out += id + '=' + (st[id] ? st[id].last_updated : 'x') + ';'; });
        return out;
      }
      _render() {
        // reads through the client; each pill gets what goes with it (the host adapter decides)
        var c = this.client, cfg = this._config || {};
        if (!c) return;
        if (this._built && this._lsig === this._listSig(c)) {
          (this._kids || []).forEach(function (el) { feedPill(el, c); });
          return;
        }
        var resolved = cfg.resolve ? cfg.resolve(c) : null;
        var ids = resolved ? resolved.ids : cfg.entities || [];
        var configs = ids.map(function (id) {
          var room = cfg.room;
          if (cfg.row) {
            var e = (c.entities || {})[id] || {}, d = (c.devices || {})[e.device_id] || {};
            room = ((c.areas || {})[e.area_id || d.area_id] || {}).name || '';
          }
          var t = groupTile(c, id, room, cfg.groupKind);
          // The sheet already blurs its backdrop. Every nested pill must
          // stay out of the shared glass renderer too: its clipped layer in
          // the scrolling body adds a second blur inside an animated blur
          // surface, producing rectangular artifacts on tablet GPUs.
          t.glass = false;
          if (cfg.row) {
            t.room = room || '';
            // The room line needs its own explicit grid track. Leaving the
            // standard two-row layout creates an implicit third column and
            // squeezes the accessory name/readout almost out of view.
            t.layout = room ? 'favourite' : 'standard';
            t.size = 'regular';
            t.tap_action = { action: 'more-info' };
            delete t.icon_tap_action;
          }
          return t;
        });
        var key = JSON.stringify(configs);
        if (!this._built || key !== this._key) {
          this._built = true;
          this._key = key;
          var scroll = this.parentNode && this.parentNode.scrollTop;
          var grid = document.createElement('div');
          grid.className = 'grp';
          this._kids = configs.map(function (config) {
            var el = C.create(config);
            if (el) grid.appendChild(el);
            return el;
          }).filter(Boolean);
          this._root.innerHTML = '';
          if (cfg.row) {
            this._summary = document.createElement('div');
            this._summary.className = 'summary';
            this._root.appendChild(this._summary);
          }
          this._root.appendChild(grid);
          if (this.parentNode && scroll != null) this.parentNode.scrollTop = scroll;
        }
        if (resolved && this._summary) {
          this._summary.textContent = resolved.value;
          if (sheetState().panel === this) sheetState().tt.textContent = resolved.title;
        }
        this._ids = ids.slice();
        this._lsig = this._listSig(c);
        (this._kids || []).forEach(function (el) { feedPill(el, c); });
      }
    }
    // A PILL (hkCards.create) gets what goes with the client once it is
    // configured; anything else straight through the host adapter.
    function feedPill(el, client) {
      if (el.hkSetClient) el.hkSetClient(client); else window.hkHostClient.bridge(el, client);
    }
    def('hk-detail-group', GroupPanel);
    // A CUSTOM POP-UP'S CARDS (Pop-ups -> Custom): any cards, in
    // a column, built by Home Assistant's own card helpers (a core card or a
    // custom one), fed what goes with the sheet's client (through the host
    // adapter) while the sheet is up. A card that cannot be built is HA's error
    // card, in its place.
    class CardsPanel extends HkBase {
      static get CSS() {
        return ':host{display:block}' +
          '.cards{display:flex;flex-direction:column;gap:12px;padding:2px 0 8px}' +
          '.none{color:' + window.hkCards.v('ink-2') + ';font-size:15px;text-align:center;padding:40px 12px}';
      }
      hkWidthKind() { return (this._config || {}).width === 'wide' ? 'cards_wide' : 'cards'; }
      hkFill() { return true; }
      _sigOf() { return null; }
      _render() {
        var c = this.client, cfg = this._config || {}, self = this;
        if (!c) return;
        if (!this._built) {
          this._built = true;
          this._kids = [];
          var box = document.createElement('div');
          box.className = 'cards';
          this._root.innerHTML = '';
          this._root.appendChild(box);
          var list = Array.isArray(cfg.cards) ? cfg.cards : [];
          if (!list.length) {
            box.innerHTML = '<div class="none">No cards yet.</div>';
          } else if (typeof window.loadCardHelpers === 'function') {
            window.loadCardHelpers().then(function (helpers) {
              list.forEach(function (cc) {
                var el;
                try { el = helpers.createCardElement(cc); } catch (e) {
                  el = helpers.createCardElement({ type: 'error', error: String(e && e.message || e), origConfig: cc });
                }
                window.hkHostClient.bridge(el, self.client);
                box.appendChild(el);
                self._kids.push(el);
              });
            }, function (e) { console.error('[hk-detail] custom pop-up: no card helpers', e); });
          }
        }
        (this._kids || []).forEach(function (el) { window.hkHostClient.bridge(el, c); });
      }
    }
    def('hk-detail-cards', CardsPanel);
    // openGroup(title, ids, { icon, room, kind, color, row, resolve })
    //   row: a page's status row the list was opened from (hk-room.js; the
    //   Climate page's was `climate`, still taken): each pill says its own
    //   room, a summary heads the list, `resolve` keeps both live, and an
    //   accessory opened from it comes back to it
    function openGroup(title, ids, o, extra) {
      o = o || {};
      if (!ids || !ids.length) return false;
      return open(null, { name: title, icon: o.icon, icon_color: o.color || 'rgba(255,255,255,0.92)' },
                  Object.assign({ group: { title: title, ids: ids.slice(), room: o.room || '', kind: o.kind || '',
                    icon: o.icon, color: o.color, row: o.row || o.climate, resolve: o.resolve } }, extra || {}));
    }
    function restoreGroup(g) {
      var current = g.resolve && g.resolve(C.client());
      // An empty category still needs a way back out after its last member
      // was removed while a device's controls were open.
      return open(null, { name: current ? current.title : g.title, icon: g.icon,
                          icon_color: g.color || 'rgba(255,255,255,0.92)' },
        { group: Object.assign({}, g, { ids: current ? current.ids : g.ids }) });
    }

    // what the shell and the later sheet files use of this one
    K.CLIENT_FED = CLIENT_FED; K.def = def; K.openGroup = openGroup; K.PANELS = PANELS;
    K.restoreGroup = restoreGroup;
  };
})();
