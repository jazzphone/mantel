// hk-detail-accessory.js - the accessory pane's glyphs, arrangement and the HA name moves.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-detail-accessory'] = function (K) {
    var at = K.at, C = K.C, domainOf = K.domainOf, esc = K.esc, stOf = K.stOf;

    // ============================================================ ACCESSORY
    // SETTINGS: the Home app's per-accessory settings, behind a gear in the
    // sheet's header -- for admins only, since a wall tablet's user must not
    // rename the home. Everything is saved as it is changed (accessories.py;
    // the room is Home Assistant's own area) and reaches every screen: a
    // generated dashboard redraws within ten seconds.
    //
    //   Name        the tile's and the sheet's name, the home's (or, with
    //               "Only on this dashboard", this one's)
    //   Room        Home Assistant's area for it
    //   Show As     a switch drawn and counted as a light, a fan, an outlet
    //   Size        its tile regular or tall, over its kind's own
    //   Spinning    a fan's tile glyph turning while it is on, or still
    //   Icon        the glyph
    //   Where It Shows      Show in HK Frontend, then each place it can be
    //                       hidden from -- Home, its room's page, the pages
    //                       and chips of its kinds (hiding.py; the same
    //                       switches as HK Settings -> Hidden Accessories)
    //   Favorite on this dashboard
    var ACC_CSS = [
      '.hkd .gear{width:44px;height:44px;border-radius:22px;border:0;padding:0;flex-shrink:0;',
      '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
      '  background:rgba(255,255,255,0.14);color:rgba(255,255,255,0.92);--mdc-icon-size:20px}',
      '.hkd .gear:active{background:rgba(255,255,255,0.26)}',
      // a phone's header row is 40 px, as are its well and X (SHEET_CSS)
      '@media (max-width:' + C.BP.phone + 'px){.hkd .gear{width:40px;height:40px;border-radius:20px}}',
      '.hkd .gear[hidden]{display:none}',
      '.hkd .body > .acc{margin-block:0}',
      '.acc{display:flex;flex-direction:column;gap:20px;padding-bottom:6px;font-size:16px}',
      // colours are variables with the sheet's (dark) values as defaults, so
      // the settings page can draw the same pane in its own light or dark
      '.acc .cap{font-size:13px;font-weight:600;letter-spacing:.3px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');',
      '  text-transform:uppercase;padding:0 6px 6px}',
      '.acc .grp{background:var(--acc-cell,rgba(255,255,255,0.08));border-radius:14px;overflow:hidden}',
      '.acc .row{display:flex;align-items:center;justify-content:space-between;gap:14px;',
      '  min-height:50px;padding:0 16px;box-sizing:border-box}',
      // the line between two rows starts at their text, as iOS draws it
      '.acc .row + .row{background:linear-gradient(var(--acc-sep,rgba(255,255,255,0.09)),var(--acc-sep,rgba(255,255,255,0.09)))',
      '  16px 0/calc(100% - 16px) 1px no-repeat}',
      '.acc .row .k{flex-shrink:0;color:var(--acc-label,' + window.hkCards.v('ink') + ')}',
      // a place's line under its name (Where it shows): what that place covers
      '.acc .row .k small{display:block;font-size:13px;line-height:17px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');margin-top:1px}',
      '.acc .row .k small[hidden]{display:none}',
      '.acc .row.place .k,.acc .row.wall .k{flex-shrink:1;min-width:0;padding:9px 0}',
      '.acc .row.dim .k{opacity:.45}',
      '.acc .tg:disabled{opacity:.45;cursor:default}',
      '.acc .note a{color:var(--acc-focus,#0a84ff);text-decoration:none}',
      '.acc input.nm{flex:1;min-width:0;background:transparent;border:0;color:var(--acc-text,' + window.hkCards.v('ink') + ');font:inherit;',
      '  text-align:right;outline:none;padding:0;text-overflow:ellipsis}',
      // the whole row's height is the field's target, not its 21 px of text
      '.acc .row input.nm,.acc .row select{align-self:stretch;min-height:44px}',
      '.acc input.nm::placeholder{color:var(--acc-label3,' + window.hkCards.v('ink-3') + ')}',
      '.acc select{min-width:0;max-width:60%;background:transparent;color:var(--acc-value,' + window.hkCards.v('ink-2') + ');border:0;',
      '  font:inherit;text-align:right;outline:none;-webkit-appearance:none;appearance:none;cursor:pointer}',
      '.acc select option{color:#000}',
      '.acc .tg{-webkit-appearance:none;appearance:none;width:51px;height:31px;border-radius:16px;margin:0;',
      '  background:var(--acc-fill,rgba(255,255,255,0.18));position:relative;cursor:pointer;flex-shrink:0;transition:background .2s}',
      '.acc .tg::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;',
      '  background:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);transition:transform .2s}',
      '.acc .tg:checked{background:var(--acc-green,#34c759)}',
      '.acc .tg:checked::after{transform:translateX(20px)}',
      '.acc .seg{display:flex;gap:2px;background:var(--acc-seg,rgba(255,255,255,0.08));border-radius:10px;padding:2px;margin:10px 12px}',
      // each choice as wide as its word, the rest shared out: equal fifths
      // left "Automatic" (bold when chosen) spilling into "Light" on a phone
      '.acc .seg button{flex:1 1 auto;min-width:0;padding:0 6px;height:32px;border:0;border-radius:8px;background:transparent;',
      '  color:var(--acc-text,' + window.hkCards.v('ink') + ');font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}',
      '.acc .seg button.on{background:var(--acc-seg-on,rgba(255,255,255,0.24));font-weight:600}',
      '.acc .glyphs{display:grid;grid-template-columns:repeat(auto-fill,46px);justify-content:center;gap:8px;padding:12px}',
      '.acc .glyphs button{width:46px;height:46px;border-radius:23px;border:0;cursor:pointer;justify-self:center;',
      '  background:var(--acc-glyph,rgba(255,255,255,0.10));color:var(--acc-text,#fff);--mdc-icon-size:23px;display:flex;',
      '  align-items:center;justify-content:center;font:inherit;font-size:11px}',
      '.acc .glyphs button.on{background:var(--acc-glyph-on-bg,rgba(255,255,255,0.92));color:var(--acc-glyph-on-fg,#000)}',
      '.acc .swatches{display:flex;flex-wrap:wrap;gap:8px;padding:12px 14px}',
      '.acc .swatches button{width:32px;height:32px;border-radius:16px;border:2px solid transparent;cursor:pointer;',
      '  font:inherit;font-size:10px;color:var(--acc-text,' + window.hkCards.v('ink') + ');background:var(--acc-glyph,rgba(255,255,255,0.12))}',
      '.acc .swatches button.on{border-color:var(--acc-text,#fff);box-shadow:0 0 0 2px rgba(0,0,0,0.4) inset}',
      '.acc .swatches button:first-child{width:auto;padding:0 10px}',
      '.acc .glyphs.fvg{border-top:1px solid var(--acc-sep,rgba(255,255,255,0.09))}',
      // ARRANGE: Move Left / Move Right, over a small copy of the tiles it
      // moves among, laid out as the dashboard lays them out
      '.acc .arrb{display:flex;gap:8px;padding:10px 12px 0}',
      '.acc .arrb button,.acc .edpg{flex:1;height:40px;border:0;border-radius:10px;background:var(--acc-glyph,rgba(255,255,255,0.12));',
      '  color:var(--acc-text,#fff);font:inherit;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;',
      '  justify-content:center;gap:6px;--mdc-icon-size:18px}',
      '.acc .arrb button:disabled{opacity:.35;cursor:default}',
      '.acc .arrb button:not(:disabled):active,.acc .edpg:active{background:var(--acc-seg-on,rgba(255,255,255,0.24))}',
      // EDIT THIS PAGE: Arrange's button (above), the whole group's width
      '.acc .edpg{width:calc(100% - 24px);margin:10px 12px}',
      '.acc .mini{display:grid;grid-auto-flow:dense;grid-auto-rows:30px;gap:5px;padding:12px}',
      '.acc .mini .mt{display:flex;align-items:center;gap:5px;min-width:0;border-radius:9px;padding:0 7px;',
      '  background:var(--acc-glyph,rgba(255,255,255,0.10));color:var(--acc-label2,rgba(255,255,255,0.7));font-size:11px;',
      '  --mdc-icon-size:14px;transition:background .2s,color .2s}',
      '.acc .mini .mt.tall{grid-row:span 2;flex-direction:column;align-items:flex-start;justify-content:space-between;padding:7px}',
      '.acc .mini .mt span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      // a tall tile stacks its name under the glyph: a column's item is as
      // wide as its text unless held to the tile, and a long name ran over
      // the next tile instead of ending in an ellipsis
      // ...and at the foot of the tile with or without a glyph above it (a
      // water heater has none: alone, space-between put its name at the top)
      '.acc .mini .mt.tall span{max-width:100%;margin-top:auto}',
      '.acc .mini .mt.on{background:var(--acc-glyph-on-bg,rgba(255,255,255,0.92));color:var(--acc-glyph-on-fg,#000);font-weight:600}',
      '.acc .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
      // SEARCH EVERY ICON: the Apple glyphs, then Home Assistant's Material ones
      '.acc .gsearch{display:block;padding:12px 12px 0}',
      '.acc .gsearch input{width:100%;box-sizing:border-box;height:36px;border:0;border-radius:10px;padding:0 12px;',
      '  background:var(--acc-glyph,rgba(255,255,255,0.10));color:var(--acc-text,' + window.hkCards.v('ink') + ');font:inherit;font-size:15px;outline:none}',
      '.acc .gsearch input::placeholder{color:var(--acc-label3,' + window.hkCards.v('ink-3') + ')}',
      '.acc .gsearch.fvs{border-top:1px solid var(--acc-sep,rgba(255,255,255,0.09))}',
      '.acc .glyphs .gh{grid-column:1/-1;font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;',
      '  color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');padding:4px 2px 0}',
      '.acc .glyphs .gn{grid-column:1/-1;font-size:13px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');padding:0 2px}',
      '.acc .with{display:flex;flex-wrap:wrap;gap:8px;padding:0 14px 12px}',
      '.acc .with[hidden]{display:none}',
      '.acc .with button{height:32px;border-radius:16px;border:0;background:var(--acc-glyph,rgba(255,255,255,0.14));color:var(--acc-text,' + window.hkCards.v('ink') + ');',
      '  font:inherit;font-size:14px;padding:0 12px;cursor:pointer}',
      '.acc .reset{height:50px;border:0;border-radius:14px;background:var(--acc-cell,rgba(255,255,255,0.08));',
      '  color:var(--acc-red,#ff453a);font:inherit;cursor:pointer;width:100%}',
      // Reset asks first, in place (an alert over a sheet would stack two sheets)
      '.acc .sure{display:flex;flex-direction:column;gap:8px}',
      '.acc .sure[hidden]{display:none}',
      '.acc .sure .q{font-size:13px;line-height:18px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');padding:0 6px;text-align:center}',
      '.acc .sure .b{display:flex;gap:8px}',
      '.acc .sure button{flex:1;height:44px;border:0;border-radius:12px;font:inherit;cursor:pointer;',
      '  background:var(--acc-cell,rgba(255,255,255,0.08));color:var(--acc-text,' + window.hkCards.v('ink') + ')}',
      '.acc .sure button.go{color:var(--acc-red,#ff453a);font-weight:600}',
      '.acc .note{font-size:13px;line-height:18px;color:var(--acc-label2,' + window.hkCards.v('ink-2') + ');padding:0 6px}',
      // a footer under its group, a little apart from it, as iOS sets one
      '.acc .grp + .note{margin-top:6px}',
      '.acc .err{color:var(--acc-orange,#ff9f0a)}',
      '.acc .sec[hidden],.acc .row[hidden]{display:none}',
      '.acc a.row{color:inherit;text-decoration:none}.acc a.row svg{opacity:.45}',
      '.acc .tg:focus-visible,.acc button:focus-visible,.acc select:focus-visible,.acc input:focus-visible{outline:2px solid var(--acc-focus,#0a84ff);outline-offset:2px}'
    ].join('');

    // The glyphs a kind of thing is offered, the Home app's vocabulary first
    // -- Apple's Home symbols for that kind (2026-10-01: every one the glyph
    // file has), then the house's own favorites. Anything else is a search
    // away (glyphSearch): every hk: glyph, and Home Assistant's Material
    // Design icons.
    var GLYPHS = {
      light: ['lightbulb', 'lightbulb-group', 'lightbulb-multiple', 'lightbulb-variant', 'lightbulb-on', 'lightbulb-night',
              'ceiling-light', 'ceiling-light-multiple', 'chandelier', 'ceiling-fan-light', 'lamp', 'floor-lamp', 'desk-lamp',
              'wall-sconce', 'wall-sconce-flat', 'vanity-light', 'light-recessed', 'lightbulb-spot', 'light-flood-down',
              'lightbulb-fluorescent-tube', 'outdoor-lamp', 'coach-lamp', 'string-lights', 'led-strip-variant',
              'light-switch', 'christmas-tree', 'pine-tree', 'motion-sensor', 'sword', 'fire'],
      outlet: ['power-socket-us', 'power-strip', 'power-plug', 'toggle-switch', 'light-switch', 'remote',
               'gesture-tap-button', 'coffee', 'lamp', 'string-lights', 'christmas-tree', 'fire', 'fireplace',
               'fan', 'fan-desk', 'fan-floor', 'air-purifier', 'radiator', 'television', 'monitor', 'projector',
               'audio-video', 'desktop-tower', 'laptop', 'server', 'server-network', 'router-wireless', 'printer',
               'printer-3d', 'amplifier', 'gamepad-variant', 'run-fast', 'washing-machine', 'tumble-dryer',
               'dishwasher', 'fridge', 'microwave', 'toaster-oven', 'stove', 'pot-steam', 'pot', 'popcorn',
               'water-boiler', 'sprinkler-variant', 'sprinkler', 'pool', 'faucet', 'scent', 'guitar-acoustic',
               'teddy-bear', 'party-popper', 'bell', 'clock', 'ev-plug-tesla', 'ev-station', 'power-plug-battery-outline'],
      fan: ['fan', 'ceiling-fan', 'ceiling-fan-light', 'fan-desk', 'fan-floor', 'air-purifier', 'air-conditioner',
            'hvac', 'air-humidifier', 'dehumidifier', 'radiator', 'fireplace', 'heat-wave', 'snowflake'],
      climate: ['thermostat', 'home-thermometer', 'air-conditioner', 'hvac', 'radiator', 'fireplace', 'heat-wave',
                'snowflake', 'fan', 'ceiling-fan', 'air-purifier', 'water-boiler', 'thermometer-water'],
      humidifier: ['air-humidifier', 'air-humidifier-active', 'dehumidifier', 'air-purifier', 'water-percent', 'scent'],
      cover: ['blinds-horizontal', 'blinds-vertical', 'blinds-vertical-closed', 'roller-shade', 'roman-shade',
              'roman-shade-open', 'window-shutter', 'window-shutter-open', 'curtains', 'curtains-closed',
              'window-closed-variant', 'window-closed', 'window-open', 'awning', 'skylight', 'garage',
              'garage-variant', 'garage-double', 'gate', 'door-closed', 'door-sliding', 'door-french'],
      // a door or window sensor: each is drawn open and shut (its pair)
      contact: ['door-closed', 'door-sliding', 'door-french', 'window-closed-variant', 'window-closed', 'skylight',
                'garage', 'garage-variant', 'garage-double', 'gate', 'contact-sensor', 'mailbox-up'],
      sensor: ['motion-sensor', 'motion', 'contact-sensor', 'smoke-detector', 'molecule-co', 'molecule-co2',
               'air-filter', 'home-thermometer', 'water-percent', 'water', 'water-alert', 'pipe-leak',
               'lightning-bolt', 'home-battery', 'speedometer', 'doorbell-video', 'bell', 'mailbox-up', 'walk'],
      media_player: ['television', 'apple-tv', 'homepod', 'homepod-mini', 'homepod-pair', 'homepod-mini-pair', 'homepod-and-homepod-mini', 'speaker', 'speaker-multiple',
                     'speaker-play', 'television-speaker', 'audio-video', 'amplifier', 'radio', 'projector',
                     'remote-tv', 'music', 'volume-high', 'monitor', 'laptop', 'cellphone', 'tablet', 'gamepad-variant'],
      lock: ['lock', 'lock-smart', 'door-closed-lock', 'door-french', 'door-sliding', 'gate', 'key-variant', 'garage',
             'garage-double', 'shield-lock'],
      camera: ['camera', 'webcam', 'doorbell-video', 'motion'],
      alarm_control_panel: ['shield-home', 'shield-lock', 'alarm-light', 'alarm-light-off', 'bell', 'motion-sensor'],
      vacuum: ['robot-vacuum'],
      valve: ['spigot', 'sprinkler', 'sprinkler-variant', 'water', 'pipe-leak', 'faucet', 'shower', 'bathtub',
              'pool', 'waves', 'water-boiler'],
      scene: ['home', 'sparkles', 'star-fill', 'weather-night', 'white-balance-sunny', 'weather-sunset-up', 'bed',
              'sofa', 'seat', 'silverware-fork-knife', 'television', 'music', 'party-popper', 'balloon', 'walk',
              'location-enter', 'bag-suitcase', 'car', 'sleep', 'lightbulb', 'fire', 'christmas-tree', 'shield-home'],
      other: ['home', 'star-fill', 'sparkles', 'toggle-switch', 'power-socket-us', 'lightbulb', 'fan',
              'thermometer-water', 'water', 'timer-sand', 'clock', 'alarm', 'bell', 'bed', 'sofa', 'seat', 'dresser',
              'desk', 'table-furniture', 'bookshelf', 'stairs', 'bathtub', 'shower', 'toilet', 'hanger', 'shield-home',
              'car', 'ev-station', 'paw', 'flower', 'pine-tree', 'party-popper', 'balloon', 'trash-can', 'package-variant',
              'wifi', 'cellphone', 'tablet', 'watch', 'laptop', 'wrench']
    };
    GLYPHS.water_heater = GLYPHS.climate;
    GLYPHS.binary_sensor = GLYPHS.sensor;
    GLYPHS.script = GLYPHS.scene;
    GLYPHS.input_button = GLYPHS.button = GLYPHS.outlet;
    function glyphsFor(id, show) {
      var d = domainOf(id);
      if (show === 'light') return GLYPHS.light;
      if (show === 'fan') return GLYPHS.fan;
      if (show === 'switch' || show === 'outlet') return GLYPHS.outlet;
      if (d === 'switch' || d === 'input_boolean') return GLYPHS.outlet;
      if (d === 'binary_sensor') {
        var dc = at(stOf(C.client(), id), 'device_class');
        if (/^(door|window|garage_door|opening)$/.test(String(dc || ''))) return GLYPHS.contact;
      }
      return GLYPHS[d] || GLYPHS.other;
    }
    // SEARCH EVERY ICON: the hk: glyphs (the house's glyph file, else the
    // names the lists above use), then Home Assistant's own Material Design
    // icons, read from its icon list with their keywords (/static/mdi/
    // iconList.json -- the file its own icon picker reads), less those with
    // an hk: twin of the same name (one is drawn as the other: an mdi: icon
    // is drawn from the hk set where it has one). [{v, icon, mdi}] matching
    // every word, at most MAX of the Material ones.
    var MDI_LIST = null;
    function mdiList() {
      if (!MDI_LIST) {
        MDI_LIST = (typeof fetch === 'function' ? fetch('/static/mdi/iconList.json')
          .then(function (r) { return r.ok ? r.json() : []; }) : Promise.resolve([]))
          .catch(function () { return []; })
          .then(function (l) { return Array.isArray(l) ? l : []; });
      }
      return MDI_LIST;
    }
    function hkNames() {
      var g = window.hkGlyphs && window.hkGlyphs.icons, seen = {}, out = [];
      var add = function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } };
      Object.keys(g || {}).forEach(add);
      Object.keys(GLYPHS).forEach(function (k) { GLYPHS[k].forEach(add); });
      return out.sort();
    }
    function glyphSearch(q, list) {
      var words = String(q || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
      var hit = function (t) { return words.every(function (w) { return t.indexOf(w) >= 0; }); };
      var names = hkNames(), have = {};
      names.forEach(function (n) { have[n] = 1; });
      var hk = names.filter(function (n) { return hit(n.replace(/-/g, ' ')); })
        .map(function (n) { return { v: 'hk:' + n, icon: 'hk:' + n }; });
      var mdi = (list || []).filter(function (it) {
        return it && it.name && !have[it.name] && hit(it.name.replace(/-/g, ' ') + ' ' + (it.keywords || []).join(' ').toLowerCase());
      });
      // BY ITS NAME FIRST: an icon whose name has the words ("fan-off") before
      // one found only by a keyword that happens to begin with them (a unicorn,
      // "fantasy") -- in Home Assistant's order within each
      var byName = function (it) { return hit(it.name.replace(/-/g, ' ')) ? 0 : 1; };
      mdi = mdi.map(function (it, i) { return [byName(it), i, it]; })
        .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (x) { return x[2]; });
      return { hk: hk, mdi: mdi.map(function (it) { return { v: 'mdi:' + it.name, icon: 'mdi:' + it.name, mdi: true }; }) };
    }
    var SEARCH_MAX = 120;

    // ARRANGE (2026-10-01): a tile moved left or right among the tiles it
    // sits with -- read off the page, from the tile the sheet opened from.
    // The generated dashboard says where each tile lives (hk-strategy.js
    // hk_place): a room's section on Home, a group on a room page, or the
    // Favorites. What moves is the tile's place in the room's Tile Order
    // (accessories `rooms`, every screen) or this screen's favorites; what
    // is NOT on show there (a tile off Home, another group's) keeps its
    // place. Left and right are reading order: the end of a row wraps.
    var GROUP_WORDS = { Climate: 'climate accessories', Lights: 'lights', 'Speakers & TVs': 'speakers and TVs',
                        Security: 'security accessories', Water: 'water accessories', Other: 'other accessories' };
    function arrangeOf(h, id, tile) {
      var cfg = tile && tile._config, place = cfg && cfg.hk_place;
      var root = tile && tile.parentNode;
      // (a category page's tile -- its place has a `page` -- is Edit mode's
      // to arrange, not the sheet's)
      if (!place || place.page || !root || !root.children) return null;
      var kids = [].filter.call(root.children, function (k) { return k._config && k._config.entity; });
      var visible = kids.map(function (k) { return k._config.entity; });
      if (visible.length < 2 || visible.indexOf(id) < 0) return null;
      var look = {};
      kids.forEach(function (k) {
        var c = k._config, vl = c.view_layout || {};
        look[c.entity] = { name: c.name || at(stOf(h, c.entity), 'friendly_name') || c.entity, icon: c.icon || '',
                           tall: c.size === 'tall' || /span\s*2/.test(String(vl['grid-row'] || '')) };
      });
      var cols = 0;
      try { cols = String(getComputedStyle(root).gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean).length; }
      catch (e) { /* no layout (a test) */ }
      cols = Math.max(1, Math.min(6, cols || 4));
      if (place.fav) {
        var dash = dashNow(), b = (((window.hkSettings && window.hkSettings.get('boards', null)) || {})[dash]) || {};
        var favs = (b.favorites || []).slice();
        visible.forEach(function (x) { if (favs.indexOf(x) < 0) favs.push(x); });
        return { fav: true, dash: dash, visible: visible, full: favs, look: look, cols: cols,
                 note: 'Moves it among the Favorites on this screen.' };
      }
      var area = place.area, areas = h.areas || {};
      if (!area || !areas[area]) return null;
      var full = [];
      try {
        var HS = window.hkSettings, G = (HS && HS.get('generated', null)) || {};
        var r = window.hkStrategy && window.hkStrategy.rooms
          ? window.hkStrategy.rooms(h, { areas: [area], include_entities: G.include_entities || [] }) : [];
        full = (r[0] && r[0].entities) ? r[0].entities.slice() : [];
      } catch (e) { full = []; }
      visible.forEach(function (x) { if (full.indexOf(x) < 0) full.push(x); });
      var room = areas[area].name;
      return { area: area, visible: visible, full: full, look: look, cols: cols,
               note: place.group ? 'Moves it among the ' + (GROUP_WORDS[place.group] || 'accessories') + ' in the ' + room + '.'
                                 : 'Moves it among the tiles in the ' + room + '.' };
    }
    // one step left (-1) or right (1): the new visible order, and the whole
    // list it is saved as -- the visible tiles take the places they held, in
    // their new order; the others stay where they were. null at an end.
    function arrangeMove(visible, full, id, dir) {
      var i = visible.indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= visible.length) return null;
      var v = visible.slice(); v[i] = v[j]; v[j] = id;
      var out = full.slice(), n = 0;
      out.forEach(function (x, k) { if (visible.indexOf(x) >= 0) out[k] = v[n++]; });
      return { visible: v, full: out };
    }
    function accessoriesNow() {
      var HS = window.hkSettings;
      return (HS && HS.get('accessories', null)) || { entities: {}, rooms: {} };
    }
    function accOf(id) { return (accessoriesNow().entities || {})[id] || {}; }
    function dashNow() { try { return String(location.pathname).split('/')[1] || ''; } catch (e) { return ''; } }
    // THE ACCESSORY'S NAME for the sheet's title: this dashboard's, else the
    // home's (null: none set).
    function accName(id) {
      var a = accOf(id), dash = dashNow();
      return (a.names && a.names[dash]) || a.name || null;
    }
    function accIcon(id) {
      var v = String(accOf(id).icon || '');
      return v ? (/^mdi:/.test(v) ? 'hk:' + v.slice(4) : v) : null;
    }
    function canEdit(h) { return !!(h && h.user && h.user.is_admin); }
    // Is this dashboard a generated one (custom:hk-dashboard)? Only those
    // draw favorites, so only there is "Favorite on this dashboard" offered.
    function generatedHere() {
      try {
        var panel = window.hkShell.panel();
        var raw = panel && panel.lovelace && panel.lovelace.rawConfig;
        return !!(raw && raw.strategy && /hk-dashboard$/.test(String(raw.strategy.type || '')));
      } catch (e) { return false; }
    }

    // opts.panel: drawn on the settings page, which is no dashboard -- no
    // "Only on this dashboard", no "Favorite on this dashboard".
    // WHERE IT SHOWS, filled in when the server answers: Show in HK Frontend
    // (off: hidden everywhere), then each place this accessory can be hidden
    // from. Hidden with its whole device or room, the switch says so and
    // waits for that to change (Hidden Accessories).
    function wherePane(h, el, id, area, opts, fail) {
      var grp = el.querySelector('.sec.where .grp'), wall = el.querySelector('.row.wall');
      var shown = wall.querySelector('.tg.shown'), why = wall.querySelector('.wwhy');
      var rows = [];
      var paint = function (snap) {
        rows.forEach(function (r) { r.remove(); });
        rows = [];
        var e = (h.entities || {})[id] || {};
        var dev = e.device_id && (snap.devices || []).indexOf(e.device_id) >= 0 ? (h.devices || {})[e.device_id] : null;
        var room = area && (snap.areas || []).indexOf(area) >= 0 ? area : null;
        var every = (snap.everywhere || []).indexOf(id) >= 0;
        var off = (snap.off || {})[id] || [], can = (snap.can || {})[id] || [];
        var locked = !!(dev || room);
        shown.disabled = locked;
        shown.checked = !every && !locked;
        why.hidden = !locked;
        why.textContent = dev ? 'Hidden with its device, ' + (dev.name_by_user || dev.name || 'this device')
          : room ? 'Hidden with its room, ' + (((h.areas || {})[room] || {}).name || room) : '';
        var after = wall;
        can.forEach(function (k) {
          var p = (snap.places || {})[k] || [k, ''];
          var name = k === 'room' ? ((((h.areas || {})[area] || {}).name || 'Its') + ' Room Page') : p[0];
          var r = document.createElement('div');
          r.className = 'row place' + (every || locked ? ' dim' : '');
          r.innerHTML = '<span class="k">' + esc(name) + '<small>' + esc(p[1]) + '</small></span>' +
            '<input class="tg" type="checkbox" role="switch">';
          var tg = r.querySelector('.tg');
          tg.setAttribute('aria-label', 'Show on ' + name);
          tg.dataset.k = k;
          tg.checked = off.indexOf(k) < 0;
          tg.disabled = every || locked;
          tg.addEventListener('change', function () { send(false); });
          after.insertAdjacentElement('afterend', r);
          after = r;
          rows.push(r);
        });
        // ALSO COUNT AS: on = counted there (added); what it could be added to, off
        var also = el.querySelector('.sec.also'), ag = also && also.querySelector('.grp');
        if (!ag) return;
        var added = (snap.added || {})[id] || [];
        var ks = (snap.order || []).filter(function (k) { return added.indexOf(k) >= 0 || ((snap.also || {})[id] || []).indexOf(k) >= 0; });
        also.hidden = !ks.length;
        ag.innerHTML = '';
        ks.forEach(function (k) {
          var p = (snap.places || {})[k] || [k, ''];
          var r = document.createElement('div');
          r.className = 'row place';
          r.innerHTML = '<span class="k">' + esc(p[0]) + '<small>' + esc(p[1]) + '</small></span><input class="tg" type="checkbox" role="switch">';
          var tg = r.querySelector('.tg');
          tg.setAttribute('aria-label', 'Also count as ' + p[0]);
          tg.checked = added.indexOf(k) >= 0;
          tg.addEventListener('change', function () {
            var kinds = {};
            kinds[k] = tg.checked;
            if (!opts.panel && window.hkStrategy && window.hkStrategy.ownChange) window.hkStrategy.ownChange();
            h.actions.callWS({ type: 'hk_frontend/hidden/also', entity_ids: [id], kinds: kinds })
              .then(function (s2) { paint(s2); if (opts.onSave) opts.onSave(true); },
                    function (err) { fail(err); if (opts.onSave) opts.onSave(false); });
          });
          ag.appendChild(r);
        });
      };
      var send = function (everywhere) {
        var places = {};
        rows.forEach(function (r) { var tg = r.querySelector('.tg'); if (!tg.checked) places[tg.dataset.k] = true; });
        if (!opts.panel && window.hkStrategy && window.hkStrategy.ownChange) window.hkStrategy.ownChange();
        return h.actions.callWS({ type: 'hk_frontend/hidden/set', entity_ids: [id], everywhere: everywhere, places: everywhere ? {} : places })
          .then(function (snap) { paint(snap); if (opts.onSave) opts.onSave(true); },
                function (err) { fail(err); if (opts.onSave) opts.onSave(false); });
      };
      shown.addEventListener('change', function () { send(!shown.checked); });
      h.callWS({ type: 'hk_frontend/hidden/get', entity_ids: [id] }).then(paint, function () {
        why.hidden = false;
        why.textContent = 'Couldn’t read where it shows.';
      });
    }

    // ALSO RENAME IN HOME ASSISTANT (2026-10-31, the owner: "Also rename in Home Assistant"): how this page writes
    // an entity's display name to Home Assistant's registry, or null where it may not -- the switch is then not
    // drawn at all. Only people who may change the house, and only while the connection can do it:
    //  * a host with settings of its own (settingsHost()) answers both questions and does the write itself,
    //    through its own audited route (canRenameInHome(client), renameInHome(id, name, client));
    //  * the host that IS Home Assistant (haNav 'own') has no such host: an admin writes the registry
    //    directly, config/entity_registry/update, which Home Assistant allows admins only.
    // Home Assistant has one name per entity, so only the home-wide name is ever sent, never a screen's.
    var HA_RENAME_NOTE = 'On: this name is also Home Assistant’s name for it, so the logbook, voice assistants and ' +
      'HomeKit Bridge say it too. Its entity ID stays, so automations keep working. A name for only this dashboard stays ' +
      'here. Off: it stops syncing, and Home Assistant keeps the last name; change it there.';
    function homeRenamer(h) {
      var shell = window.hkShell, host = null, own = false;
      try { host = shell && shell.settingsHost ? shell.settingsHost() : null; } catch (e) { host = null; }
      if (host) {
        var can = false;
        try { can = typeof host.canRenameInHome === 'function' && typeof host.renameInHome === 'function' && !!host.canRenameInHome(h); } catch (e) { can = false; }
        return can ? function (id, name) { return host.renameInHome(id, name, h); } : null;
      }
      try { own = !!shell && shell.haNav() === 'own'; } catch (e) { own = false; }
      if (!own || !canEdit(h) || !h.actions || typeof h.actions.callWS !== 'function') return null;
      return function (id, name) {
        return h.actions.callWS({ type: 'config/entity_registry/update', entity_id: id, name: name });
      };
    }

    // THE BRIDGE: a sheet's controls act through the client's action port
    // (HkBase._call), so a panel is simply shown its client. A card inside a
    // sheet (the thermostat, the alarm keypad) gets what goes with the client
    // from the host adapter: in HA an HK card takes the frontend's object at its
    // entry and reads the client made from it, and an HA-drawn card needs that
    // object itself (or the client itself, read-only, when there is none).
    function bridge(el, client) { window.hkHostClient.bridge(el, client); }

    // the element with focus, inside any shadow roots
    function deepActive() {
      var a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      return a;
    }
    // what Tab can reach in `root`, in order, through shadow roots
    var FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
    function focusables(root) {
      var out = [];
      (function walk(n) {
        var kids = n.shadowRoot ? n.shadowRoot.children : n.children;
        if (n.nodeType === 1 && n !== root && n.matches && n.matches(FOCUSABLE) && n.getClientRects().length &&
            n.getAttribute('aria-disabled') !== 'true') out.push(n);
        Array.prototype.forEach.call(kids || [], walk);
        if (n.shadowRoot) Array.prototype.forEach.call(n.children || [], function (c) { if (c.assignedSlot) walk(c); });
      })(root);
      return out;
    }

    // silent: no history.back() -- the entry is already gone (popstate), or a
    // new sheet, a pop-up or a navigation is taking over.
    // A SHEET COVERS THE PAGE, as a pop-up does (hk-popup.js hkPopupCover):
    // the camera strip stops swapping stills under its blur until it goes.
    function covering(delta) {
      window.hkPopupCover = Math.max(0, (window.hkPopupCover || 0) + delta);
      try {
        window.dispatchEvent(new CustomEvent('hk-popup-change',
          { detail: { open: window.hkPopupOpen || 0, cover: window.hkPopupCover } }));
      } catch (e) { /* no event bus (a test) */ }
    }

    // what the shell and the later parts use of this one
    K.ACC_CSS = ACC_CSS; K.accIcon = accIcon; K.accName = accName; K.accOf = accOf; K.arrangeMove = arrangeMove;
    K.arrangeOf = arrangeOf; K.bridge = bridge; K.canEdit = canEdit; K.covering = covering; K.dashNow = dashNow;
    K.deepActive = deepActive; K.focusables = focusables; K.generatedHere = generatedHere;
    K.glyphSearch = glyphSearch; K.glyphsFor = glyphsFor; K.HA_RENAME_NOTE = HA_RENAME_NOTE;
    K.homeRenamer = homeRenamer; K.mdiList = mdiList; K.SEARCH_MAX = SEARCH_MAX; K.wherePane = wherePane;
  };
})();
