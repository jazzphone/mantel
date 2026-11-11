// hk-chip-row.js - the chips row and Home Status.
//
// PART OF THE CHIP CARDS (hk-chip.js). Not a card and not run on its own: it registers one
// function, which hk-chip.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkChipParts = window.hkChipParts || {})['hk-chip-row'] = function (K) {
    var autoKinds = K.autoKinds, C0 = K.C0, colourFor = K.colourFor, entityChip = K.entityChip,
        entityIds = K.entityIds, found = K.found, IC = K.IC, icEntry = K.icEntry, icLine = K.icLine,
        icWatch = K.icWatch, KIND_NAMES = K.KIND_NAMES, kindConfig = K.kindConfig, kindsLive = K.kindsLive,
        labelFor = K.labelFor, OPEN = K.OPEN, passes = K.passes, pick = K.pick, QUIET_DEFAULT = K.QUIET_DEFAULT,
        ruleValue = K.ruleValue, S = K.S, valueOf = K.valueOf;

    // ============================================================ THE CHIP ROW
    //
    // hk-chips-card: the status chips under a dashboard's header, as ONE card
    // with nothing to list. Which chips, in what order and which
    // are quiet is the dashboard's own -- its item under Dashboards on the
    // integration's page (Home: Chips, Only when there is something to report)
    // -- read live, so an edit there reaches an open screen at once. A
    // dashboard with no item, or an item that picks none, shows every kind the
    // house has, in KIND_ORDER.
    //
    //   type: custom:hk-chips-card
    //   chips: [lights, climate, sensor.mailbox]   # optional: the row when the item names none
    //   quiet: [lights]                            # optional: likewise, the quiet ones
    //   extra:                                     # the house's own chips, placed
    //     - after: weather_alert                   #   after a kind, or start / end
    //       card: {type: conditional, ...}
    //
    // The row is an hk-row-card with the chip row's measured geometry
    // (14/30 shadow room, 22 sideways, the 35 px
    // section gaps paid back by the margin) and the menu chip as its lead.
    // The row's config: this card's own lists, else the dashboard's, else
    // every kind the house has; the house's extra chips placed; the geometry.
    // `away`: on someone else's dashboard (HkBase place(): data-hk-foreign).
    // The rows' sideways bleed (-22 px each side, paid back in padding) is for
    // HK's own page padding; in a section it runs past the section's edge.
    function rowPlan(cfg, b, client, away) {
      b = b || {};
      // The dashboard's Home -> Chips -> "Show the status chips": no row.
      if (b.chips_row === false) return null;
      var cards = rowItems(cfg, b, client).map(function (x) { return x.card; });
      var row = { type: 'custom:hk-row-card', card_width: 'fit-content', gap: 10, pad_top: 14,
                  pad_bottom: 30, pad_left: 22, pad_right: 22, margin: '-15px -22px -32px -22px',
                  cards: cards };
      if (away) { row.margin = '-15px 0px -32px 0px'; row.pad_left = 0; row.pad_right = 0; }
      ROW_KEYS.forEach(function (k) { if (cfg[k] !== undefined) row[k] = cfg[k]; });
      // `lead: true` (the editor's Menu Button switch, on) is the default too
      if (cfg.lead !== false) row.lead = (cfg.lead && cfg.lead !== true) ? cfg.lead : { type: 'custom:hk-menu-button-card' };
      return row;
    }
    // THE ROW'S CHIPS, each with where it came from: [{key, name, card}] -- `key` the kind, the entity or `chip:<key>`
    // (null for a YAML extra), `name` a custom chip's own name. The row draws the cards; House Status (below) reads the
    // same list whether or not the row is drawn (`chips_row` is the row's, never House Status's).
    function rowItems(cfg, b, client) {
      cfg = cfg || {};
      b = b || {};
      // THE DASHBOARD'S OWN CHOICE FIRST (its item), then this card's YAML as
      // the default, then every kind the house has.
      var tokens = (Array.isArray(b.chips) && b.chips.length) ? b.chips
                 : (Array.isArray(cfg.chips) && cfg.chips.length) ? cfg.chips : autoKinds(client);
      // The dashboard's own chips (entities): chips_extra says WHICH, and the
      // item's chips list may place them among the kinds (Order -> Chips);
      // one not placed follows the kinds. An entity the list
      // places but chips_extra no longer names is gone.
      if (Array.isArray(b.chips_extra)) {
        var extra = b.chips_extra;
        if (tokens === b.chips) {
          tokens = tokens.filter(function (t) {
            return typeof t !== 'string' || (t.indexOf('.') < 0 && t !== 'intercom') || extra.indexOf(t) >= 0;
          });
        }
        tokens = tokens.concat(extra.filter(function (e) { return tokens.indexOf(e) < 0; }));
      }
      // CUSTOM CHIPS: the house's own chips in YAML (Library ->
      // Custom Chips); this screen's chips_custom says which. One the chip
      // order places ("chip:<key>") sits there; the rest where the chip says --
      // after a kind, at the start or the end -- as a YAML `extra:` would.
      var lib = {};
      (S('custom_chips', null) || []).forEach(function (c) { if (c && c.key && c.card) lib[c.key] = c; });
      var mine = (Array.isArray(b.chips_custom) ? b.chips_custom : []).filter(function (k) { return lib[k]; });
      var TOK = 'chip:';
      tokens = tokens.filter(function (t) {
        return typeof t !== 'string' || t.indexOf(TOK) !== 0 || mine.indexOf(t.slice(TOK.length)) >= 0;
      });
      // EACH CUSTOM CHIP'S SHOW on this screen (2026-10-13, chips_custom_show):
      // Always or When Active, like the kinds; missing, as written. Always
      // takes a conditional chip out of its condition; When Active makes a
      // status chip quiet -- its own `active:` rules, or for one entity, while
      // it isn't off, closed, idle or unavailable (as an accessory chip).
      var cshow = (b.chips_custom_show && typeof b.chips_custom_show === 'object') ? b.chips_custom_show : {};
      var copyAs = function (key, card) {
        var c = JSON.parse(JSON.stringify(card)), m = cshow[key];
        if (m === 'always' && c.type === 'conditional' && c.card) return c.card;
        if (m === 'active' && c.type === 'custom:hk-status-chip-card') {
          c.quiet = true;
          if (!Array.isArray(c.active) || !c.active.length) {
            if (c.entity) c.active = [{ entity: c.entity, state_not: ['off', 'unavailable', 'unknown', 'idle', 'closed', 'locked', ''] }];
          }
        }
        return c;
      };
      var quiet = Array.isArray(b.chips_quiet) ? b.chips_quiet
                : Array.isArray(cfg.quiet) ? cfg.quiet : QUIET_DEFAULT;
      // SMOKE & CO is no screen's choice: it leads every row of a house that
      // has an alarm, shown only while one is going off.
      tokens = tokens.filter(function (t) { return t !== 'smoke'; });
      var keys = [], items = [];
      var add = function (key, card, at, name) {
        var it = { key: key, name: name || null, card: card };
        if (at === undefined) { keys.push(key); items.push(it); } else { keys.splice(at, 0, null); items.splice(at, 0, it); }
      };
      tokens.forEach(function (t) {
        if (t && typeof t === 'object') { add(null, t); return; }
        t = String(t);
        // THE INTERCOM, a chip a screen adds from More: drawn only where the page has it and this person may use it
        if (t === 'intercom') {
          var ic = icEntry(client);
          if (ic) add(t, { type: 'custom:hk-status-chip-card', kind: 'intercom', label: ic.label });
          return;
        }
        if (t.indexOf(TOK) === 0) { var lk = t.slice(TOK.length); add(t, copyAs(lk, lib[lk].card), undefined, lib[lk].name); return; }
        add(t, t.indexOf('.') > 0 ? entityChip(t, quiet.indexOf(t) >= 0)
                                  : { type: 'custom:hk-status-chip-card', kind: t, quiet: quiet.indexOf(t) >= 0 || t === 'laundry' });   // (Laundry: only while it says something, on every screen)
      });
      // after: a kind (or an entity) in the row, `start` or `end`. A kind the
      // row does not show puts the chip at the end.
      var placed = keys.filter(function (k) { return k && k.indexOf(TOK) === 0; });
      var extras = (Array.isArray(cfg.extra) ? cfg.extra : []).concat(mine.filter(function (k) {
        return placed.indexOf(TOK + k) < 0; }).map(function (k) { return { after: lib[k].after, card: copyAs(k, lib[k].card), key: TOK + k, name: lib[k].name }; }));
      extras.forEach(function (x) {
        if (!x || !x.card) return;
        var at = x.after === 'start' ? 0 : keys.indexOf(x.after) + 1;
        if (at <= 0 && x.after !== 'start') at = items.length;
        add(x.key || null, x.card, at, x.name);
      });
      if (found('smoke', client).length) items.unshift({ key: 'smoke', name: null, card: { type: 'custom:hk-status-chip-card', kind: 'smoke', quiet: true } });
      return items;
    }
    var ROW_KEYS = ['align', 'card_width', 'gap', 'pad_top', 'pad_bottom', 'pad_left', 'pad_right', 'margin',
                    'phone_card_width', 'phone_gap'];

    // ============================================================ HOUSE STATUS
    //
    // THE STATUS CHIPS AS SECTIONS (2026-11-07, docs/phase11/HOUSE-STATUS.md): the Home Grid block House Status and its
    // sheet (hk-house-status.js) draw what this screen's chips say -- the same chips, order, Always / When Active, Smoke &
    // CO first, custom chips and entity chips -- with no rules of their own. The chip row's switch (`chips_row`) is the
    // row's: House Status reads the chips whether or not the row is drawn. Presentation-neutral: no DOM here.
    //
    //   plan(board, client) -> {items, unsupported, ids, key}   what can be shown, rebuilt only when settings move
    //   read(plan, client)  -> {sections, unsupported, total}   each section now: visible ones only, alerts first
    //
    // A section: {key, kind, name, icon, entity, color, reading, label, detail, extra, active, urgent, attention, tap,
    // readonly}. reading is {num, unit} ("3", "On"), {text} ("Armed Home"), {countdown: {deadline} | {hold}} (a timer),
    // or {none: true} for no reading ("--": a sensor that has not reported is not zero). detail and extra are lines
    // read from the house (who, where), never stand-ins; null when there is nothing true to say.
    //
    // TAPS: a section opens what its chip opens (the chip's tap_action: a kind's page through kindPage, an entity's
    // sheet). A custom chip whose tap would change the house (toggle, call-service) is a readout here (`readonly`):
    // House Status reads and navigates, it never commands.
    // CUSTOM CARDS: a custom chip that is a status chip, or a conditional around one whose conditions are state or
    // numeric_state (and/or of them), is read; any other card has no reading House Status can trust, and is named in
    // `unsupported` (the sheet says so) rather than dropped unseen.
    var HS_NAMES = { energy: 'Power' };              // the Energy chip's reading is power now: Power, its page Energy
    var HS_SAFE = ['navigate', 'more-info', 'none', 'url', 'intercom', 'laundry'];
    var LOCK_KNOWN = ['locked', 'unlocked'];
    function hsName(client, id) {
      var st = client && client.states && client.states[id];
      var full = (C0().accName && C0().accName(id)) || (st && st.attributes && st.attributes.friendly_name) || id;
      var a = hsArea(client, id), room = a && client.areas && client.areas[a] ? client.areas[a].name : '';
      var short = window.hkStrategy && window.hkStrategy.shortName;
      var n = short && room ? short(full, room) : full;
      // (the room off the front, unless all that is left is what it is: "Porch Light" stays itself)
      return /^(light|lights|lamp|blind|shade|sensor|leak|door|window|lock|speaker|timer)$/i.test(n) ? full : n;
    }
    // A CHIP'S LINE IN PIECES: its parts joined by a separator (Climate's "72° · 2 Fans"); a label joined by a plain
    // space (a weather alert's "Tornado Warning +2") is one piece
    function hsParts(cfg, label) {
      var sep = cfg.join != null ? String(cfg.join) : ' \u00b7 ';
      return Array.isArray(cfg.parts) && sep.trim() ? String(label).split(sep) : [String(label)];
    }
    function hsArea(client, id) {
      var e = ((client && client.entities) || {})[id] || {}, devs = (client && client.devices) || {};
      return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || null;
    }
    function hsRoom(client, id) {
      var a = hsArea(client, id);
      return a && client && client.areas && client.areas[a] ? String(client.areas[a].name || '') : '';
    }
    // "Kitchen · Loft +2": as many as `max`, then how many more
    function hsList(names, max) {
      var seen = [], m = max || 2;
      names.forEach(function (n) { if (n && seen.indexOf(n) < 0) seen.push(n); });
      if (!seen.length) return null;
      return seen.slice(0, m).join(' · ') + (seen.length > m ? ' +' + (seen.length - m) : '');
    }
    function hsRooms(client, ids) {
      var rooms = [];
      ids.forEach(function (id) { var r = hsRoom(client, id); if (r && rooms.indexOf(r) < 0) rooms.push(r); });
      return rooms;
    }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    // a timer's `remaining` ("0:03:10", "3:10", 190) in seconds; null when it says nothing a clock can hold
    function hsSecs(v) {
      if (typeof v === 'number') return isFinite(v) ? Math.max(0, v) : null;
      var parts = String(v == null ? '' : v).split(':').map(Number);
      if (!parts.length || parts.some(function (n) { return !isFinite(n); }) || String(v) === '') return null;
      return parts.reduce(function (a, n) { return a * 60 + n; }, 0);
    }
    // A READING from the chip's label: "3 On" -> {num: '3', unit: 'On'}, "72°" -> {num: '72°'}, "Armed Home" -> {text}
    var NUM = /^([-+]?\d[\d.,]*(?::\d\d)*(?:\s?°[CF]?|%)?)(?:\s+(\S.*))?$/;
    function hsReading(text) {
      var t = String(text == null ? '' : text).trim();
      if (!t || /^--( |$)/.test(t) || t === '--') return { none: true };
      var m = NUM.exec(t);
      return m ? (m[2] ? { num: m[1], unit: m[2] } : { num: m[1] }) : { text: t };
    }
    // A CONDITIONAL'S CONDITIONS (Home Assistant's own forms): true or false, or null when one is a kind House Status
    // cannot judge (a screen width, a user, a time) -- the card is then unsupported, never guessed
    function hsCond(c, card) {
      if (!c || typeof c !== 'object') return null;
      var kind = c.condition || (c.entity ? (c.above != null || c.below != null ? 'numeric_state' : 'state') : null);
      if (kind === 'and' || kind === 'or') {
        if (!Array.isArray(c.conditions)) return null;
        var got = c.conditions.map(function (x) { return hsCond(x, card); });
        if (got.indexOf(null) >= 0) return null;
        return kind === 'and' ? got.indexOf(false) < 0 : got.indexOf(true) >= 0;
      }
      if (!c.entity) return null;
      var s = card._st(c.entity), v = s ? s.state : 'unavailable';
      if (kind === 'state') {
        if (c.state != null) return [].concat(c.state).map(String).indexOf(v) >= 0;
        if (c.state_not != null) return [].concat(c.state_not).map(String).indexOf(v) < 0;
        return null;
      }
      if (kind === 'numeric_state') {
        var n = Number(v);
        if (v === '' || !isFinite(n)) return false;
        if (c.above != null && !(n > Number(c.above))) return false;
        if (c.below != null && !(n < Number(c.below))) return false;
        return c.above != null || c.below != null ? true : null;
      }
      return null;
    }
    function hsConds(list, card) {
      if (!Array.isArray(list)) return null;
      var got = list.map(function (x) { return hsCond(x, card); });
      return got.indexOf(null) >= 0 ? null : got.indexOf(false) < 0;
    }
    function hsCard(client) { return { client: client, _st: function (id) { return window.hkCardState.state(client, id); } }; }

    // WHAT CAN BE SHOWN, for this screen: the row's chips as configs. Rebuilt by the caller when `key` moves.
    function hsKey(b, client) {
      var HS = window.hkSettings, M = C0().menu, lc = null;
      try { lc = M && M.config ? M.config() : null; } catch (e) { lc = null; }
      var views = lc && Array.isArray(lc.views) ? lc.views.map(function (v) { return v && v.path; }).join(',') : '-';
      return [HS ? HS.version : -1, window.hkMusic ? window.hkMusic.rooms().length : -1, client ? 1 : 0,
              kindsLive() ? '' : Object.keys((client && client.states) || {}).length, views,
              IC.feed ? 1 : 0, JSON.stringify([b && b.chips, b && b.chips_quiet, b && b.chips_extra, b && b.chips_custom, b && b.chips_custom_show])].join('|');
    }
    function hsPlan(b, client) {
      var board = Object.assign({}, b || {}, { chips_row: true });
      var items = [], unsupported = [], ids = [], seen = {};
      var keep = function (list) { list.forEach(function (id) { if (!seen[id]) { seen[id] = true; ids.push(id); } }); };
      rowItems({}, board, client).forEach(function (x) {
        var card = x.card || {}, conds = null, chip = card;
        if (card.type === 'conditional' && card.card && card.card.type === 'custom:hk-status-chip-card' && Array.isArray(card.conditions)) {
          conds = card.conditions; chip = card.card;
        }
        if (chip.type !== 'custom:hk-status-chip-card' || (conds && hsConds(conds, hsCard(client)) === null)) {
          unsupported.push(x.name || card.name || chip.name || (x.key && x.key.indexOf('chip:') !== 0 ? x.key : 'A custom chip'));
          return;
        }
        var cfg;
        if (chip.kind) {
          var over = Object.assign({}, chip);
          delete over.kind; delete over.type;
          cfg = Object.assign({}, kindConfig(chip.kind, client) || { name: KIND_NAMES[chip.kind] || String(chip.kind), missing: true }, over);
        } else {
          cfg = Object.assign({}, chip);
          delete cfg.type;
        }
        if (cfg.missing) return;                       // a kind the house has none of: never shown, as on the row
        var tap = cfg.tap_action || (cfg.entity ? { action: 'more-info' } : { action: 'none' });
        var readonly = HS_SAFE.indexOf(tap.action) < 0;
        if (readonly) tap = { action: 'none' };
        keep(entityIds(cfg));
        if (conds) keep(entityIds(conds));
        if (cfg.count && cfg.count.music && window.hkMusic) keep(window.hkMusic.rooms().map(function (r) { return r.entity; }));
        if (cfg.count && cfg.count.laundry && window.hkLaundry) window.hkLaundry.machines(client).forEach(function (m) { keep(window.hkLaundry.ids(client, m)); });
        items.push({ key: x.key || ('custom' + items.length), kind: chip.kind || null, cfg: cfg, conds: conds, tap: tap, readonly: readonly,
                     name: (chip.kind && !chip.name && HS_NAMES[chip.kind]) || cfg.name || null });
      });
      return { items: items, unsupported: unsupported, ids: ids, key: hsKey(b, client) };
    }

    // A KIND'S DETAIL: what the house says beyond the chip's line -- where, who, which -- only from the states
    function hsDetail(kind, cfg, card, client, label, s, out) {
      var n = function (k) { return found(k, client); }, st = function (id) { return card._st(id); };
      var on = function (ids, states) { return ids.filter(function (id) { var x = st(id); return x && [].concat(states).indexOf(x.state) >= 0; }); };
      var names = function (ids) { return ids.map(function (id) { return hsName(client, id); }); };
      var parts = hsParts(cfg, label || '');
      var rest = parts.length > 1 ? parts.slice(1).join(' · ') : null;
      switch (kind) {
        case 'climate': {
          var cl = n('thermostats'), act = [];
          cl.forEach(function (id) { var a = (st(id) || {}).attributes || {}; if ((a.hvac_action === 'heating' || a.hvac_action === 'cooling') && act.indexOf(a.hvac_action) < 0) act.push(
            a.hvac_action); });
          var doing = act.map(function (a) { return a === 'heating' ? 'Heating' : 'Cooling'; }).join(' · ');
          out.detail = [doing, rest].filter(Boolean).join(' · ') || (out.reading.num ? 'Inside' : null);
          var temps = cl.map(function (id) {
            var x = st(id), t = x && x.attributes ? Number(x.attributes.current_temperature) : NaN;
            return x && x.attributes && x.attributes.current_temperature != null && isFinite(t) ? hsName(client, id) + ' ' + Math.round(t) + '°' : null;
          }).filter(Boolean);
          if (temps.length > 1) out.extra = hsList(temps, 3);
          return;
        }
        case 'timers': {
          var tm = n('timers'), live = [], held = [];
          tm.forEach(function (id) {
            var x = st(id), a = (x && x.attributes) || {};
            if (x && x.state === 'active' && a.finishes_at && isFinite(Date.parse(a.finishes_at))) live.push({ id: id, at: Date.parse(a.finishes_at) });
            else if (x && x.state === 'paused') held.push({ id: id, left: hsSecs(a.remaining) });
          });
          live.sort(function (p, q) { return p.at - q.at; });
          var lead = live[0] || held[0];
          if (!lead) { out.detail = 'Nothing running'; return; }
          if (live[0]) out.reading = { countdown: { deadline: live[0].at } };
          else if (held[0].left != null) out.reading = { countdown: { hold: held[0].left } };
          var room = hsRoom(client, lead.id);
          out.detail = [hsName(client, lead.id), room].filter(Boolean).join(' · ');
          var count = [live.length ? live.length + ' running' : '', held.length ? held.length + ' paused' : ''].filter(Boolean).join(' · ');
          out.extra = live.length + held.length > 1 ? count : (live[0] ? 'Running' : 'Paused');
          return;
        }
        case 'energy': {
          out.detail = s && s.state === 'unavailable' ? 'Unavailable' : out.reading.none ? 'No reading' : 'Right now';
          return;
        }
        case 'lights': {
          var lit = on(n('lights'), 'on'), rooms = hsRooms(client, lit);
          if (!lit.length) { out.detail = 'All off'; return; }
          out.detail = rooms.length > 1 ? 'In ' + rooms.length + ' rooms' : rooms[0] || plural(lit.length, 'light', 'lights');
          out.extra = rooms.length > 1 ? hsList(rooms, 3) : hsList(names(lit), 2);
          return;
        }
        case 'blinds': {
          var open = on(n('blinds'), ['open', 'opening', 'closing']), br = hsRooms(client, open);
          if (!open.length) { out.detail = 'All closed'; return; }
          out.detail = br.length > 1 ? 'In ' + br.length + ' rooms' : br[0] || hsList(names(open), 2);
          out.extra = hsList(names(open), 2);
          return;
        }
        case 'doors_windows': {
          var dw = on(n('doors').concat(n('windows'), n('garage')), OPEN);
          out.detail = dw.length ? rest || null : 'All closed';
          if (dw.length) out.extra = hsList(names(dw), 2);
          if (dw.length && !out.detail) { out.detail = out.extra; out.extra = null; }
          return;
        }
        case 'security': {
          var locks = n('locks'), alarm = S('security.alarm', null), al = alarm && st(alarm);
          var open2 = on(locks, ['unlocked', 'open', 'opening', 'unlocking']), odd = locks.filter(
            function (id) { var x = st(id); return !x || LOCK_KNOWN.indexOf(x.state) < 0 && open2.indexOf(id) < 0; });
          // UNKNOWN IS NOT LOCKED: a lock that has not said (unavailable, jammed) is never counted as secure
          if (!open2.length && odd.length && out.reading.text === 'All Locked') out.reading = { num: String(odd.length), unit: 'Not Reporting' };
          var lockLine = !locks.length ? null : open2.length ? plural(open2.length, 'lock', 'locks') + ' open'
                       : odd.length ? plural(odd.length, 'lock', 'locks') + ' not reporting' : 'All locked';
          var alarmLine = al && al.state && al.state !== 'unavailable' && al.state !== 'unknown'
            ? String(al.state).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : (alarm ? 'Alarm unavailable' : null);
          out.detail = out.reading.num ? alarmLine || lockLine : lockLine || alarmLine;
          if (open2.length || odd.length) out.extra = hsList(names(open2.length ? open2 : odd), 2);
          return;
        }
        case 'water': {
          var wet = on(n('leaks'), 'on');
          out.detail = wet.length ? hsList(hsRooms(client, wet).length ? hsRooms(client, wet) : names(wet), 2) : 'All dry';
          if (wet.length) out.extra = hsList(names(wet), 2);
          return;
        }
        case 'laundry': {
          var lo = window.hkLaundry ? window.hkLaundry.lookAll(client).filter(function (o) { return o.runs || o.state === 'done' || o.state === 'wrinkle' || o.state === 'leak' || o.state === 'error';
            }) : [];
          out.detail = lo.length ? hsList(lo.map(function (o) { return o.name + ' ' + o.short.toLowerCase(); }), 2) : 'Nothing running';
          return;
        }
        case 'vacuums': {
          var vm = on(n('vacuums'), ['cleaning', 'returning', 'paused', 'error']);
          out.detail = vm.length ? hsList(names(vm), 2) : 'All docked';
          if (vm.length) out.extra = hsList(vm.map(function (id) { return String(st(id).state).replace(/^\w/, function (c) { return c.toUpperCase(); }); }), 2);
          return;
        }
        case 'speakers': {
          var rooms2 = window.hkMusic && window.hkMusic.rooms().length ? window.hkMusic.rooms() : null;
          var playing = rooms2 ? rooms2.filter(function (r) { var x = st(r.entity); return x && x.state === 'playing' && !window.hkMusic.ignored(x); }).map(
            function (r) { return r.name || hsName(client, r.entity); })
                               : names(on(n('speakers'), 'playing'));
          out.detail = playing.length ? hsList(playing, 2) : 'Nothing playing';
          return;
        }
        case 'weather_alert': {
          var w = cfg.entity && st(cfg.entity), al0 = w && w.attributes && Array.isArray(w.attributes.Alerts) ? w.attributes.Alerts[0] : null;
          if (al0 && al0.Headline && al0.Headline !== al0.Event) out.detail = String(al0.Headline);
          if (al0 && al0.Severity) out.extra = String(al0.Severity);
          return;
        }
        case 'smoke': {
          var hot = on(n('smoke'), 'on');
          if (hot.length) { out.detail = hsList(names(hot), 2); out.extra = rest; }
          return;
        }
        case 'intercom':
          out.detail = icLine() || null;
          return;
      }
      // an entity as a chip: where it is
      if (cfg.entity && !kind) out.detail = hsRoom(client, cfg.entity) || null;
    }

    // THE SECTIONS NOW: each item's visibility as its chip's, its reading and detail; alerts (an alarm going off, a
    // weather alert, a leak) lead, the rest in the screen's order -- never sorted by their changing readings
    var HS_URGENT = { smoke: 1, weather_alert: 1, water: 1 };
    function hsRead(plan, client) {
      var card = hsCard(client), urgent = [], rest = [];
      (plan && plan.items || []).forEach(function (it) {
        var cfg = it.cfg, s = cfg.entity ? card._st(cfg.entity) : null;
        if (it.conds && hsConds(it.conds, card) !== true) return;
        var act = !Array.isArray(cfg.active) || !cfg.active.length ? true
                : cfg.active.some(function (a) { return passes(card, cfg, s, a); });
        if (cfg.quiet && !act) return;
        var val = valueOf(card, cfg, s), label = labelFor(card, cfg, s);
        var parts = hsParts(cfg, label);
        var col = ruleValue(card, cfg, s, cfg.icon_color_rules, 'color');
        var out = {
          key: it.key, kind: it.kind, entity: cfg.entity || null,
          name: it.name || (s && s.attributes && s.attributes.friendly_name) || cfg.entity || 'Status',
          icon: ruleValue(card, cfg, s, cfg.icon_rules, 'icon') || pick(cfg.icon_states, val) || cfg.icon || null,
          color: col ? colourFor({ icon_color: col }, s, val) : colourFor(cfg, s, val),
          label: label, reading: hsReading(parts[0]), detail: null, extra: null,
          active: act, urgent: false, attention: false, tap: it.tap, readonly: it.readonly
        };
        hsDetail(it.kind, cfg, card, client, label, s, out);
        var alarm = it.kind === 'security' && S('security.alarm', null), al = alarm && card._st(alarm);
        out.urgent = !!(HS_URGENT[it.kind] && cfg.active && act) || !!(al && al.state === 'triggered');
        out.attention = out.urgent || (it.kind === 'timers' && act) || (it.kind === 'doors_windows' && act) ||
                        (it.kind === 'security' && (out.reading.unit === 'Unlocked' || out.reading.unit === 'Not Reporting'));
        (out.urgent ? urgent : rest).push(out);
      });
      var sections = urgent.concat(rest);
      return { sections: sections, unsupported: (plan && plan.unsupported) || [], total: sections.length };
    }
    class HkChipsCard extends HTMLElement {
      constructor() {
        super();
        var self = this;
        this._key = null;
        this._row = null;
        this._wake = function () { self._plan(); };
      }
      setConfig(config) {
        this._cfgIn = Object.assign({}, config || {});
        this._key = null;
        this._plan();
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (C0().place) C0().place(this);
        this.style.display = 'block';
        window.addEventListener('hk-module-ready', this._wake);
        this._plan();
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        window.removeEventListener('hk-module-ready', this._wake);
        if (this._icOff) { this._icOff(); this._icOff = null; }
      }
      // A settings change arrives as `hk-module-ready` (the wake above). The
      // State pushes only matter before the integration's kinds are in, when
      // the kinds are found from the states themselves. EACH NEW CLIENT arrives
      // through the host adapter's entry (below the class).
      _onClient(client) {
        var first = !this._seenClient;
        this._seenClient = client;
        if (C0().tone) C0().tone(this, client);
        if (first || !kindsLive()) this._plan();
        if (this._row) window.hkHostClient.bridge(this._row, client);
      }
      getCardSize() { return 1; }
      _board() {
        var M = C0().menu;
        return (M && M.board ? M.board() : null) || {};
      }
      _plan() {
        var cfg = this._cfgIn;
        if (!cfg) return;
        icWatch(this, this._board(), 'chips_extra');
        var row = rowPlan(cfg, this._board(), this.client, this.hasAttribute('data-hk-foreign'));
        var key = JSON.stringify(row);
        if (key === this._key) return;
        var on = !!row;
        this.style.display = on ? '' : 'none';
        if (this.hidden === on) {
          this.hidden = !on;
          // never before connected: hui-card's element is still null then
          if (this.isConnected) {
            this.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: on }, bubbles: true, composed: true }));
          }
        }
        if (!on) { this._key = key; return; }
        if (!customElements.get('hk-row-card')) {
          var self = this;
          if (!this._waiting) {
            this._waiting = true;
            customElements.whenDefined('hk-row-card').then(function () {
              self._waiting = false; self._key = null; self._plan();
            });
          }
          return;
        }
        this._key = key;
        if (!this._row) {
          this._row = document.createElement('hk-row-card');
          this.appendChild(this._row);
        }
        this._row.setConfig(row);
        window.hkHostClient.bridge(this._row, this.client);
      }
    }

    // ============================================================ THE SCENES ROW
    //
    // hk-scenes-card: the row of scene pills, with nothing to list (1.7). Which
    // scenes, and their order, are the dashboard's own (its item: Home ->
    // Scenes), read live; with none chosen there, this card's `scenes:`, else
    // every scene the house has, A to Z. `looks:` is how a given entity's pill
    // looks -- a house's own names, glyphs and colours, kept once however many
    // dashboards pick it. An entity without a look is drawn from its own name
    // and icon (HA's entity settings) and runs on a tap: a scene or script is
    // turned on, a button pressed.
    //
    //   type: custom:hk-scenes-card
    //   scenes: [scene.movie, input_button.good_morning]
    //   looks:
    //     input_button.good_morning: {name: Good Morning, icon: hk:white-balance-sunny, icon_color: yellow}
    //
    // The row's measured geometry: the pill
    // width the grids read (--hk-pill), 14/30/22/22 of shadow room paid back by
    // the wrapper's margin, two pills across on a phone.
    var SCENE_ICON = { scene: 'mdi:palette', script: 'mdi:script-text-play', button: 'mdi:gesture-tap-button',
                       input_button: 'mdi:gesture-tap-button', automation: 'mdi:robot' };
    function sceneTap(id) { return window.hkCards.sceneTap(id); }

    // what the shell and the later parts use of this one
    K.HkChipsCard = HkChipsCard; K.HS_NAMES = HS_NAMES; K.hsConds = hsConds; K.hsKey = hsKey; K.hsPlan = hsPlan;
    K.hsRead = hsRead; K.hsReading = hsReading; K.rowItems = rowItems; K.rowPlan = rowPlan; K.SCENE_ICON = SCENE_ICON;
    K.sceneTap = sceneTap;
  };
})();
