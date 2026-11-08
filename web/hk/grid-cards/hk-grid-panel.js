// hk-grid-panel.js - the pages' own panels as blocks.
//
// PART OF THE HOME GRID'S CARDS (hk-grid-cards.js). Not a card and not run on its own: it registers one
// function, which hk-grid-cards.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridCardsParts = window.hkGridCardsParts || {})['hk-grid-panel'] = function (K) {
    var attr = K.attr, C = K.C, dom = K.dom, esc = K.esc, FULL_CSS = K.FULL_CSS, HkGridFull = /** @type {HkLooseElementConstructor} */ (K.HkGridFull),
        plural = K.plural, setting = K.setting, sizeOf = K.sizeOf, type = K.type, v = K.v;

    // THE PAGES' OWN PANELS AS BLOCKS (2026-10-24, the owner: "let's do them
    // all"): what the Power, Music, Security, Climate, Live TV and Water pages
    // show at their top, read live from the house's settings as those pages
    // read them, so a block follows a change without the screen being built
    // again. `panel`:
    //   power     (2026-10-31) the power now and the day's chart, Activity's
    //             numbers on the block's own plate (_ownPower)
    //   music     the speaker picker: speakers, presets and playlists
    //   doors     the house with its ways in: locks, doors, windows, garage
    //             (S, W, T: how many are open and the list, _ownDoors)
    //   climate   a thermostat's full controls (its sheet)
    //   tv        Live TV's channels; a tap plays one full screen
    //   water     (2026-10-31) today's water and the day's bars, the days
    //             before beside them (_ownWater)
    // Nothing set up for it: the block says where to set it up.
    var PANEL_EMPTY = {
      power: ['Power', 'Add Energy with a power plan in Settings to show power here.'],
      music: ['Music', 'Set up Music in Settings to choose speakers and playlists here.'],
      doors: ['Doors & Locks', 'No locks, doors or windows yet.'],
      climate: ['Thermostat', 'No thermostat yet.'],
      tv: ['Live TV', 'Add channels in Settings → Live TV to show them here.'],
      water: ['Water', 'Name a water meter in Settings → Pages → Water to show it here.']
    };
    function hidesOf() {
      var G = setting('generated', null) || {}, out = {};
      ['exclude_entities', 'exclude_devices', 'exclude_areas', 'include_entities'].forEach(function (k) { if (Array.isArray(G[k])) out[k] = G[k]; });
      return out;
    }
    function firstOfDomain(client, d) {
      return Object.keys((client && client.states) || {}).filter(function (id) { return dom(id) === d; }).sort()[0] || null;
    }
    // what a panel block mounts: [{cfg, cls}] (each in a part of its own), or null
    function panelParts(kind, size, cfg, client) {
      if (kind === 'power') {
        var added = setting('added', []) || [], E = added.indexOf('energy') >= 0 ? setting('energy', null) : null, W = E && E.power;
        if (!W || typeof W !== 'object') return null;
        var B = W.battery || {};
        // EVERY SIZE AS ACTIVITY'S NUMBERS (2026-10-31, the owner's widget
        // mock-up; the status in sentences at Wide and the house picture at
        // Large were the Power page's own, and drew no plate of their own on
        // a block): a green Using Now, the power now large, and a chart along
        // the foot -- Small the last three hours, the rest the day; Large
        // the sun and the battery under the figure; Extra Large today's top
        // users beside it. Drawn here (`own`); the Power page keeps its cards.
        return [{ own: 'power', home: W.home || null, solar: W.solar || null, level: B.level || null }];
      }
      if (kind === 'music') {
        // (2026-10-31, Music's widget: what played last and covers to play
        // again, at the block's size -- hk-media.js hk-recent-music-card)
        var M = window.hkMusic, sp = M && M.speakers ? M.speakers() : [];
        return sp && sp.length ? [{ cfg: Object.assign({ type: 'custom:hk-recent-music-card' }, cfg.show ? { show: cfg.show } : {}, cfg.playlist ? { playlist: cfg.playlist } : {}, cfg.speaker ? { speaker: cfg.speaker } : {}), size: size }] : null;
      }
      if (kind === 'doors') {
        var S = window.hkStrategy, inv = null;
        try { inv = S && S.inventory ? S.inventory(client, hidesOf()) : null; } catch (e) { inv = null; }
        if (!inv || !(inv.locks.length + inv.doors.length + inv.windows.length + inv.garage.length)) return null;
        // EVERY SIZE (2026-10-31, the widget mock-up): how many are open, large;
        // Wide the count beside the list, Tall and Large the list under it,
        // Extra Large beside it -- the doors, the garage and the windows, the
        // open ones first (the locks are Security's). The house picture with
        // Recent Activity stays the Doors & Locks page's.
        if (inv.doors.length + inv.windows.length + inv.garage.length) {
          return [{ own: 'doors', doors: inv.doors, windows: inv.windows, garage: inv.garage }];
        }
        // (a house of locks alone: their overview, as before)
        var alarm = setting('security.alarm', null) || firstOfDomain(client, 'alarm_control_panel');
        return [{ cfg: { type: 'custom:hk-security-overview-card', alarm: alarm, locks: inv.locks, doors: inv.doors, windows: inv.windows,
          garage: inv.garage, leaks: inv.leaks || [], height: '100%' } }];
      }
      if (kind === 'climate') {
        var id = cfg.entity || firstOfDomain(client, 'climate');
        // the dial alone (its Tall layout: the ring as large as the column),
        // then its readings, modes and fan in the two columns beside it
        return id ? [{ cfg: { type: 'custom:hk-control-card', entity: id }, size: 'T' }, { readings: id, cls: 'wide' }] : null;
      }
      if (kind === 'tv') {
        // (2026-10-31: its first channels, a tile each in its color with what
        // is on; a tap plays one full screen -- hk-media.js hk-tv-channels-card)
        return (setting('added', []) || []).indexOf('live_tv') >= 0 ? [{ cfg: Object.assign({ type: 'custom:hk-tv-channels-card' }, cfg.channel ? { channel: cfg.channel } : {}), size: size }] : null;
      }
      if (kind === 'water') {
        var hw = (setting('headers', null) || {}).water || {};
        // EVERY SIZE AS THE WIDGET MOCK-UP (2026-10-31): today large and the
        // day's bars, drawn here -- Tall with the days before under them,
        // Large and Extra Large with what the leak sensors say, Extra Large
        // with the days before beside it. (The Water page keeps its day and
        // its main supply; the block was the page's small chart in a big
        // empty plate.)
        var lk = null;
        try { lk = window.hkStrategy && window.hkStrategy.inventory ? window.hkStrategy.inventory(client, hidesOf()).leaks : null; } catch (e) { lk = null; }
        return [{ own: 'water', meter: hw.meter || null, leaks: lk || [] }];
      }
      return null;
    }
    // (side by side: a thermostat's dial and its controls, two columns'
    // worth; an XL water block's day and supply, half each)
    var PANEL_CSS = '.parts{display:flex;flex-direction:column;gap:10px;height:100%}' +
      '.parts.row{flex-direction:row}.parts.row .part{flex:1 1 0;min-width:0}.parts.row .part.wide{flex:2 1 0}' +
      // (each part a size container of its own: a card inside sizes itself to its part, not the whole block -- the
      // Thermostat XL's dial was sized to the block and ran out of its column, 2026-10-30)
      '.part{flex:1;min-height:0;position:relative;container-type:size}.part > *{display:block;height:100%;--hk-sec-min:0px}' +
      // FIT: the card at its own height, scaled down to the part (_fit)
      '.part.fit{overflow:hidden}.part.fit > *{height:auto;transform-origin:50% 0}' +
      '.rd{' + C.plate('card') + ';box-sizing:border-box;height:100%;padding:' + C.blockPad(C.CARD.pad) + ';display:flex;flex-direction:column;gap:12px;justify-content:space-between}' +
      // (THE READINGS TAKE THE PLATE'S FREE HEIGHT, 2026-11-07, the review: Inside, Humidity and Outside sat at its top and
      // Mode at its foot with 180 px of glass between -- now three rows that share what the modes leave, each its name at the
      // left and its figure, larger, at the right)
      '.rd .now{display:flex;flex-direction:column;flex:1;min-height:0}' +
      '.rd .now div{display:flex;align-items:center;justify-content:space-between;gap:10px;flex:1 1 0;min-height:0;min-width:0;border-bottom:1px solid ' + v('line') + '}' +
      '.rd .now div:last-child{border-bottom:0}' +
      '.rd .k{' + type('body') + ';color:' + v('ink-2') + '}' +
      '.rd .v{' + type('title') + ';font-variant-numeric:tabular-nums}' +
      // (the readings grow with their plate -- the Thermostat XL's left a band of nothing under them, 2026-10-30)
      '.rd .v{font-size:clamp(26px, 12cqh, 40px);line-height:1.1}' +
      '.rd .row{display:flex;flex-direction:column;gap:6px}' +
      C.segCss('.rd .seg', { on: '[aria-pressed="true"]', fill: true }) +
      // (each mode a finger's 44 px tall: the segments' own 36 were under it, 2026-10-31)
      '.rd .seg button{flex:1 1 0;min-height:44px}' +
      '.part.plated{' + C.plate('card') + ';box-sizing:border-box;padding:' + C.blockPad('14px') + ';overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;scrollbar-width:none}' +
      '.part.plated::-webkit-scrollbar{display:none}.part.plated > *{height:auto;min-height:100%}' +
      '.empty{' + type('body') + ';color:' + v('ink-2') + ';padding:0 4px}';
    // THE BLOCKS AS WIDGETS (2026-10-31, the owner's mock-up, "Home Grid
    // blocks, widget style"): what a block is in its color, the one figure
    // large and light, a line under it, then a short chart or a list along
    // the foot. A panel's own part (`own`: Power S, Water and Doors S to T)
    // and On Now draw with these.
    // THE TEXT GLOW (2026-11-07, the review): the colored labels (USING NOW green, TODAY blue) and the figures on the
    // Blur and Bright looks, like every other word on the glass -- on the plate, so every part of it inherits it.
    var ACC = C.ACCENTS;
    var WG_CSS = 'hk-plate.wg{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;' +
        'padding:' + C.blockPad('14px') + ';' + C.plate('card') + ';color:' + v('ink') + ';text-shadow:' + v('glow') + '}' +
      '.wl{font-size:15px;font-weight:600;line-height:19px;letter-spacing:0.2px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}' +
      '.wb{font-size:44px;font-weight:300;letter-spacing:-0.9px;line-height:1.04;font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:2px;flex:none}' +
      '.wb.m{font-size:30px;font-weight:500;letter-spacing:-0.5px}' +
      '.ws{' + type('body') + ';line-height:19px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}' +
      '.wf{margin-top:auto}.wcol{display:flex;flex-direction:column;min-width:0}' +
      '.wc{display:block;flex:none}' +
      // THE COUNT, as large as a block's figure gets (the clock's 72); a
      // tile cell (150 tall) the hero's 44, so the words under it keep their room
      '.wb.xl{font-size:72px;letter-spacing:-1.5px}' +
      '@container hk-cell (max-height:179px){.wb.xl{font-size:44px;letter-spacing:-0.9px}}' +
      // A LIST: rows of 36, the open (or the on) ones in their color; what
      // does not fit is "N more" in the last row's place
      '.wr{display:flex;flex-direction:column;min-width:0;min-height:0}' +
      '.wr>div{display:flex;align-items:center;gap:10px;height:36px;flex:none;border-bottom:1px solid ' + v('line') + ';cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.wr>div:last-child{border-bottom:0}' +
      // (Large and up: 44 px rows, a tap target each, the name over since when)
      '.wr.tall>div{height:48px}.wr .wt{display:flex;flex-direction:column;flex:1;min-width:0}.wr .wt b{flex:none}' +
      '.wr .wt small{' + type('caption') + ';line-height:15px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.wr b{' + type('body') + ';font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.wr em{font-style:normal;' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap}' +
      '.wr>div.more{cursor:default}.wr>div.more b{font-weight:500;color:' + v('ink-2') + '}' +
      // (THE DOORS' GROUP, 2026-11-08: the hero and the rows one group on the middle of what the label leaves; rows keep their 48 px --
      // the list used to grow to its block, rows 44 to 88 px, and the owner: nothing stretches)
      '.wmid{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}.wmid>hk-icon{margin-bottom:0}' +
      '.wr.tall b{' + type('headline') + '}.wr.tall em{' + type('body') + '}.wr.tall .wt small{' + type('caption') + ';line-height:17px}' +
      '.wb.ok{display:flex;align-items:center;gap:8px}' +
      // (ROWS THAT ARE TARGETS, 2026-11-08, the controls audit: Doors Wide's 44 px tall; Power Extra Large's 44 with 8 px clear, no rules between)
      '.wr.t44>div{height:44px}.wr.sp{gap:8px}.wr.sp>div{height:44px;border-bottom:0}' +
      '.wg hk-icon{display:block;flex:none;--mdc-icon-size:100%}' +
      '.wsplit{display:flex;gap:18px;flex:1;min-height:0}.wsplit>:last-child{flex:1}' +
      '.waxis{display:flex;justify-content:space-between;margin-top:6px;flex:none;' + type('micro') + ';color:' + v('ink-3') + '}';
    // a glyph from the MDI subset (web/mdi), in a color
    function gly(icon, px, col) {
      return '<hk-icon icon="' + icon + '" style="width:' + px + 'px;height:' + px + 'px' + (col ? ';color:' + col : '') + '"></hk-icon>';
    }
    // the block in px inside its inset: the view's measure, else a square cell's
    var SQ_BLOCK = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
    function inner(card, size) {
      if (card._watchBlock) card._watchBlock();
      var b = card._block ? card._block() : null, d = SQ_BLOCK[size] || SQ_BLOCK.S, pad = 18;
      try { pad = parseFloat(getComputedStyle(card).getPropertyValue('--hk-block-pad')) || 18; } catch (e) { pad = 18; }
      return { iw: (b ? b.w : d[0]) - 2 * pad, ih: (b ? b.h : d[1]) - 2 * pad };
    }
    // HOW MANY ROWS OF 36 FIT in `room` px -- and when not all do, the last
    // of them says how many more
    function fitRows(items, room, row, each) {
      var n = Math.max(1, Math.floor(room / (each || 36)));
      if (items.length <= n) return items.map(row).join('');
      return items.slice(0, n - 1).map(row).join('') + '<div class="more"><b>' + (items.length - n + 1) + ' more</b></div>';
    }
    // SHORT BARS, each in its color: [{v, c}] scaled to the largest, `w` x
    // `h` px -- an SVG, as HK's bars are drawn (hk-energy.js barChart), 3 px
    // apart with their tops rounded
    function wbars(list, w, h) {
      var mx = 0, n = list.length, gap = 3, bw = Math.max(1, (w - (n - 1) * gap) / n), rx = Math.min(3, bw / 2);
      list.forEach(function (x) { if (typeof x.v === 'number' && x.v > mx) mx = x.v; });
      return '<svg class="wc" width="' + Math.round(w) + '" height="' + Math.round(h) + '" viewBox="0 0 ' + w.toFixed(1) + ' ' + h + '" aria-hidden="true">' + list.map(function (x, i) {
        var bh = Math.max(3, (mx > 0 && typeof x.v === 'number' ? Math.max(0.06, x.v / mx) : 0.06) * h);
        return '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="' + rx.toFixed(1) + '" fill="' + x.c + '"' +
          // (`ghost`: a slot still to come, drawn from the day before -- half the ink)
          (x.ghost ? ' fill-opacity=".5"' : '') + '/>';
      }).join('') + '</svg>';
    }
    // a short chart's height: 40, or 28 on a tile cell (its figure keeps its room)
    function shortH(box) { return box.ih < 140 ? 28 : 40; }
    // a power sensor's watts, read with its unit (hkChart.power; a W or kW sensor)
    function wattsOf(client, id) {
      var s = id && client && client.states[id];
      if (!s) return null;
      if (window.hkChart && window.hkChart.power) return window.hkChart.power(client.states, id, { watts: true, fallback: null });
      var n = Number(s.state);
      return isFinite(n) ? (/^kW$/i.test(attr(s, 'unit_of_measurement') || '') ? n * 1000 : n) : null;
    }
    function numTag() { return window.hkLocale && window.hkLocale.numTag ? window.hkLocale.numTag() : undefined; }
    function amount(x) { return x < 10 ? (Math.round(x * 10) / 10).toLocaleString(numTag()) : Math.round(x).toLocaleString(numTag()); }
    // THE WATER METER: Settings -> Pages -> Water's, else the Energy
    // settings' water sources (energy/get_prefs, asked once for the page)
    var WATER_SRC = { ids: null, wait: null };
    function waterIds(card, client, meter) {
      if (meter) return [meter];
      if (WATER_SRC.ids) return WATER_SRC.ids;
      if (!WATER_SRC.wait && client && client.callWS) {
        WATER_SRC.wait = client.callWS({ type: 'energy/get_prefs' }).then(function (pr) {
          WATER_SRC.ids = ((pr && pr.energy_sources) || []).filter(function (s) { return s.type === 'water' && s.stat_energy_from; })
            .map(function (s) { return s.stat_energy_from; });
        }, function () { WATER_SRC.ids = []; }).then(function () { WATER_SRC.wait = null; card.redraw(); });
      }
      return null;
    }
    // TODAY'S WATER, as the Water page sums it (hk-headers.js water day):
    // each hour since midnight from the recorder's statistics, this hour
    // from its five-minute ones; the hours still to come yesterday's, in
    // gray; the days before, newest first; and today against a usual day by
    // now (the week before's mean, on yesterday's own shape)
    function waterDay(card, client, ids) {
      var S = window.hkStats;
      if (!S || !ids.length) return null;
      var hr = S.hourly(client, ids, 48, card), fm = S.fiveMinute(client, ids, 13, card, { type: 'change' }), dd = S.daily(client, ids, 8, card);
      if (!hr || !dd) return null;
      var sumAt = function (ser, i) {
        var got = false, t = 0;
        ids.forEach(function (id) { var r = ser[id] && ser[id][i]; if (r && r.v != null) { got = true; t += r.v; } });
        return got ? t : null;
      };
      var first = hr[ids[0]] || [], n = first.length, start = -1;
      for (var i = n - 1; i >= 0; i--) if (S.fields(first[i].t).hour === 0) { start = i; break; }
      if (start < 0) start = Math.max(0, n - 24);
      var seq = first.map(function (r, k) { return sumAt(hr, k); });
      var hourStart = n ? +first[n - 1].t : Date.now(), part = null;
      if (fm) (fm[ids[0]] || []).forEach(function (r, k) { if (+r.t >= hourStart) { var x = sumAt(fm, k); if (x != null) part = (part || 0) + x; } });
      seq[n - 1] = part;
      var today = seq.slice(start), yday = seq.slice(Math.max(0, start - 24), start), nowK = today.length - 1;
      var tot = today.reduce(function (a, x) { return a + (x || 0); }, 0);
      var day24 = [];
      for (var k = 0; k < 24; k++) day24.push(k <= nowK ? { v: today[k], fut: false } : { v: yday[k], fut: true });
      // a usual day by now: the seven days before today, on yesterday's shape
      var days = (dd[ids[0]] || []).map(function (r, k) { return { t: r.t, v: sumAt(dd, k) }; });
      var before = days.slice(0, -1).filter(function (x) { return x.v != null; });
      var usual = before.length ? before.reduce(function (a, x) { return a + x.v; }, 0) / before.length : 0;
      var yAll = yday.reduce(function (a, x) { return a + (x || 0); }, 0), frac = Math.min(1, (Date.now() - hourStart) / 36e5);
      var share = Math.min(1, Math.max(0, (Date.now() - (n ? +first[start].t : Date.now())) / 864e5));
      if (yAll > 0.5 && yday.length === 24) {
        share = (yday.slice(0, nowK).reduce(function (a, x) { return a + (x || 0); }, 0) + (yday[nowK] || 0) * frac) / yAll;
      }
      var byNow = usual * share, pct = byNow > 0.5 ? Math.round(100 * (tot - byNow) / byNow) : null;
      var st0 = client.states[ids[0]];
      return { tot: tot, unit: attr(st0, 'unit_of_measurement') || '', seq: seq, day24: day24,
               week: days.slice(0, -1).reverse(), day0: days.length ? days[days.length - 1].t : new Date(), more: /:/.test(ids[0]) ? null : ids[0],
               cmp: pct == null ? '' : Math.abs(pct) < 15 ? 'About usual' : Math.abs(pct) + '% ' + (pct > 0 ? 'above' : 'below') + ' usual' };
    }
    // a door, a window or the garage: open, and its glyph
    function opened(st) { return !!st && (st.state === 'on' || st.state === 'open' || st.state === 'opening' || st.state === 'closing'); }
    var WAY_GLYPH = { door: ['mdi:door-open', 'mdi:door-closed'], window: ['mdi:window-open', 'mdi:window-closed'], garage: ['mdi:garage-open', 'mdi:garage'] };
    class HkGridPanelCard extends HkGridFull {
      static get CSS() { return FULL_CSS + PANEL_CSS + WG_CSS; }
      // THE PLATE'S TAP (hk-base.js openTarget; 2026-10-31, the owner on 0.1.94): the page the panel is a part of --
      // the figure and the rows in it keep their own sheets (data-more) -- or, on a screen without that page, the
      // reading's own sheet
      _tapTarget() {
        var c = this._config || {}, kind = c.panel, parts = this._parts(), p0 = (parts && parts[0]) || /** @type {any} */ ({});
        if (kind === 'power') return [{ page: 'power' }, { page: 'energy' }, p0.home && { sheet: p0.home }];
        if (kind === 'water') return [{ page: 'water' }, p0.meter && { sheet: p0.meter }];
        if (kind === 'doors') return [{ page: 'doors-windows' }];
        if (kind === 'music') return [{ page: 'music-browse' }, { page: 'playmusic' }];
        if (kind === 'tv') return [{ page: 'live-tv' }];
        if (kind === 'climate') { var id = c.entity || firstOfDomain(this.client || { states: {} }, 'climate'); return [id && { sheet: id }, { page: 'climate' }]; }
        return [];
      }
      _parts() {
        var c = this._config || {};
        try { return panelParts(c.panel, sizeOf(this), c, this.client || { states: {} }); } catch (e) { return null; }
      }
      _sigOf() {
        var parts = this._parts(), h = this.client, rd = parts && parts[1] && parts[1].readings, st = rd && h ? h.states[rd] : null;
        // (a part of its own: the states it reads, and the block's size)
        var own = parts && parts[0] && parts[0].own ? this._ownIds(parts[0]).map(function (id) { var s = h && h.states[id]; return s ? s.last_updated : null; }) : null;
        return JSON.stringify([parts, sizeOf(this), st ? st.last_updated : null, own, own ? this._blockKey || '' : null]);
      }
      _render() {
        if (!this._config) return;      // (a client update can come before the config: nothing to draw yet -- media-card-check, 2026-11-08)
        var parts = this._parts(), key = JSON.stringify(parts);
        if (this._built && this._key === key) { this._readings(); this._drawOwn(); return; }
        this._key = key; this._kids = []; this._built = true; this._own = null;
        if (!parts) {
          // (a block with nothing to show, `panel: 'note'`: the name and line it was given -- hk-grid-catalog.js stand())
          var e = PANEL_EMPTY[this._config.panel] || [this._config.name || '', this._config.text || ''];
          this._root.innerHTML = '<hk-plate class="full" data-hk-role="card"><div class="ttl"><b></b></div><div class="empty"></div></hk-plate>';
          this._root.querySelector('b').textContent = e[0];
          this._root.querySelector('.empty').textContent = e[1];
          return;
        }
        this._root.innerHTML = '<div class="parts' + (parts.length > 1 ? ' row' : '') + '"></div>';
        var box = this._root.querySelector('.parts'), self = this;
        this._rd = null; this._rdHtml = null;
        parts.forEach(function (p) {
          var part = document.createElement('div');
          part.className = 'part' + (p.cls ? ' ' + p.cls : '');
          box.appendChild(part);
          if (p.readings) { self._rd = part; return; }
          if (p.own) {
            part.innerHTML = '<hk-plate class="wg" data-hk-role="card"></hk-plate>';
            self._own = { spec: p, plate: part.querySelector('hk-plate'), html: null };
            self._own.plate.addEventListener('click', function (e) {
              var row = e.target.closest && e.target.closest('[data-more]');
              if (row) { e.stopPropagation(); window.hkShell.moreInfo(row.getAttribute('data-more'), self); }
            });
            return;
          }
          var kid = self._mount(part, p.cfg, p.size);
          if (/\bfit\b/.test(p.cls || '')) self._fitWatch(part, kid, /\bfitw\b/.test(p.cls));
        });
        this._readings();
        this._drawOwn();
      }
      // A PART OF ITS OWN (the widget sizes): the entities it reads
      _ownIds(p) {
        if (p.own === 'power') return [p.home, p.solar, p.level].filter(Boolean);
        if (p.own === 'doors') return [].concat(p.doors, p.garage, p.windows);
        if (p.own === 'water') return (p.meter ? [p.meter] : WATER_SRC.ids || []).slice(0, 1).concat(p.leaks || []);
        return [];
      }
      _drawOwn() {
        var o = this._own;
        if (!o) return;
        var p = o.spec, size = sizeOf(this) || 'S', box = inner(this, size), h = this.client || { states: {} };
        var html = p.own === 'power' ? this._ownPower(p, size, box, h) : p.own === 'doors' ? this._ownDoors(p, size, box, h) : this._ownWater(p, size, box, h);
        if (html === o.html) return;
        o.html = html;
        C.morph(o.plate, html);
      }
      // POWER: what the house uses now, large. Small the last three hours in
      // fifteen-minute bars (the recorder's five-minute means, three to a
      // bar); Wide, Large and Extra Large the day by the hour (each hour's
      // mean since midnight, the hour we are in the reading now, the hours
      // still to come yesterday's in gray). Large adds the sun and the
      // battery under the figure, and the hours under the chart; Extra Large
      // today's top users beside it.
      _ownPower(p, size, box, h) {
        var w = wattsOf(h, p.home), S = window.hkStats;
        var kw = function (x) { return x == null ? ['—', ''] : Math.abs(x) >= 1000 ? [(x / 1000).toLocaleString(numTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }), 'kW'] : [Math.round(x).toLocaleString(numTag()), 'W']; };
        var fig = kw(w), more = p.home ? ' data-more="' + esc(p.home) + '"' : '';
        var lab = '<div class="wl" style="color:' + ACC.green + '">Using Now</div>';
        if (size === 'S') {
          var five = S && p.home ? S.fiveMinute(h, [p.home], 37, this) : null;
          var rows = (five && five[p.home]) || [], closed = rows.slice(-37, -1), bars = [];
          for (var k = 0; k < 12; k++) {
            var g = closed.slice(k * 3, k * 3 + 3).map(function (r) { return r.v; }).filter(function (x) { return typeof x === 'number'; });
            bars.push({ v: g.length ? g.reduce(function (a, x) { return a + x; }, 0) / g.length : null, c: ACC.green });
          }
          return lab + '<div class="wb"' + more + '>' + fig[0] + '</div>' +
            '<div class="ws">' + fig[1] + '</div><div class="wf" role="img" aria-label="The last three hours">' + wbars(bars, box.iw, shortH(box)) + '</div>';
        }
        var hr = S && p.home ? S.hourly(h, [p.home], 48, this, { type: 'mean' }) : null, ser = (hr && hr[p.home]) || [], day = [];
        if (ser.length) {
          var start = -1;
          for (var i = ser.length - 1; i >= 0; i--) if (S.fields(ser[i].t).hour === 0) { start = i; break; }
          if (start < 0) start = Math.max(0, ser.length - 24);
          for (var j = 0; j < 24; j++) {
            var at = start + j, y = start - 24 + j;
            if (at < ser.length) day.push({ v: at === ser.length - 1 && w != null ? w : ser[at].v, c: ACC.green });
            else day.push({ v: y >= 0 && ser[y] ? ser[y].v : null, c: v('ink-3'), ghost: true });
          }
        }
        while (day.length < 24) day.push({ v: null, c: v('ink-3'), ghost: true });
        var big = '<div class="wb"' + more + '>' + esc(fig.join(' ').trim()) + '</div>';
        var chart = function (cw, ch) { return '<div class="wf" role="img" aria-label="Today, hour by hour">' + wbars(day, cw, ch) + '</div>'; };
        var axis = '<div class="waxis"><span>12 AM</span><span>6</span><span>12 PM</span><span>6</span></div>';
        if (size === 'W') return lab + big + chart(box.iw, Math.max(30, box.ih - 19 - 46 - 10));
        // the sun now and the battery's level, where the house has them
        var sun = p.solar ? wattsOf(h, p.solar) : null, lv = p.level && h.states[p.level] ? Number(h.states[p.level].state) : NaN;
        var bits = [sun != null ? 'Solar ' + kw(sun).join(' ') : '', isFinite(lv) ? 'Battery ' + Math.round(lv) + '%' : ''].filter(Boolean);
        // (Tall, 2026-11-07, the review: the figure, then the sun and the battery a line each -- 160 px holds one -- and the
        // day's chart takes the rest of the height, the hours under it)
        var line = bits.join(' · '), tall = size === 'T', nl = tall ? bits.length : line ? 1 : 0;
        var sub = (tall ? bits : line ? [line] : []).map(function (t) { return '<div class="ws">' + esc(t) + '</div>'; }).join('');
        var chH = Math.max(40, box.ih - 19 - 46 - nl * 19 - 12 - 19);
        if (size === 'L' || tall) return lab + big + sub + chart(box.iw, chH) + axis;
        // XL: the chart on the left; today's top users on the right -- the
        // whole house, then the Energy page's devices by what they used today
        var lw = Math.round((box.iw - 22) * 0.58), users = this._topUsers(h);
        // (rows 44 px with 8 clear, as many as fit and "N more": each is a target of its own, so none touches the next)
        var urow = function (u) {
          return '<div' + (u.more ? ' data-more="' + esc(u.more) + '"' : ' style="cursor:default"') + '>' + gly(u.icon, 20, null) + '<b>' + esc(u.name) + '</b><em>' + u.v + '</em></div>';
        };
        return '<div class="wsplit" style="gap:22px"><div class="wcol" style="flex:0 0 ' + lw + 'px">' + lab + big + sub + chart(lw, chH) + axis + '</div>' +
          '<div class="wcol"><div class="wl" style="color:' + v('ink-2') + '">Today</div><div class="wmid"><div class="wr sp">' +
          fitRows(users, box.ih - 19 - 6 + 8, urow, 52) + '</div></div></div></div>';
      }
      // TODAY'S TOP USERS (Extra Large): the house so far today (the Energy
      // page's own sum, hkEnergy.summary), then each device the Energy page
      // counts, by its kWh today -- both null until their statistics land
      _topUsers(h) {
        var E = window.hkEnergy, EP = window.hkEnergyPage, out = [], self = this;
        // (the Energy page's file, asked for by name where no card of it is on the screen, as the
        // screensaver's energy asks: hk-loader.js hkNeed.file)
        if (!E && window.hkNeed && window.hkNeed.file && !this._askedEnergy) {
          this._askedEnergy = true;
          window.hkNeed.file('hk-energy.js').then(function () { self.redraw(); });
        }
        var kwh = function (x) { return x == null ? '—' : (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toLocaleString(numTag(), { minimumFractionDigits: x >= 100 ? 0 : 1 }) + ' kWh'; };
        var s = null;
        try { s = E && E.summary ? E.summary(h, this) : null; } catch (e) { s = null; }
        out.push({ name: 'House', icon: 'mdi:home', v: kwh(s ? s.today.energy : null), more: null });
        var M = EP && EP.getModel ? EP.getModel(h, this) : null;
        (M ? M.devs : []).filter(function (d) { return d.counted && d.stat; }).map(function (d) {
          return { d: d, v: EP.todayOf ? EP.todayOf(h, self, d.stat) : null };
        }).filter(function (r) { return r.v != null && r.v > 0.05; }).sort(function (a, b) { return b.v - a.v; }).forEach(function (r) {
          out.push({ name: r.d.name, icon: r.d.icon || 'mdi:power-plug', v: kwh(r.v), more: r.d.power || r.d.stat });
        });
        return out;
      }
      // DOORS AND WINDOWS: how many are open, large; Wide the count beside
      // the list, Tall over it -- the open ones first, in orange
      _ownDoors(p, size, box, h) {
        var list = [];
        [['door', p.doors], ['garage', p.garage], ['window', p.windows]].forEach(function (x) {
          (x[1] || []).forEach(function (id) { var st = h.states[id]; if (st) list.push({ id: id, kind: x[0], st: st, open: opened(st) }); });
        });
        list.sort(function (a, b) { return (b.open ? 1 : 0) - (a.open ? 1 : 0); });
        var open = list.filter(function (x) { return x.open; }), name = function (x) { return (C.accName && C.accName(x.id)) || attr(x.st, 'friendly_name') || x.id; };
        var row = function (x) {
          var g = WAY_GLYPH[x.kind][x.open ? 0 : 1];
          return '<div data-more="' + esc(x.id) + '">' + gly(g, 20, x.open ? ACC.orange : null) + '<b>' + esc(name(x)) + '</b><em' +
            (x.open ? ' style="color:' + ACC.orange + '"' : '') + '>' + (x.open ? 'Open' : 'Closed') + '</em></div>';
        };
        var lab = '<div class="wl" style="color:' + ACC.teal + '">Doors &amp; Windows</div>';
        // THE COPY, PLAINLY (2026-11-08, the review: "1 open" over "All doors closed" while a window was open): what is open
        // and by name -- "1 Open" over "Office Window" -- or "All Closed" with a check over what the block watches; no zero
        var ways = list.filter(function (x) { return x.kind !== 'window'; }).length, wins = list.length - ways;
        var names = open.length < 3 ? open.map(name).join(' · ') : name(open[0]) + ' + ' + (open.length - 1) + ' more';
        var line = open.length ? names : [ways ? plural(ways, 'door', 'doors') : '', wins ? plural(wins, 'window', 'windows') : ''].filter(Boolean).join(' · ');
        var ok = function (px) { return gly('mdi:check-circle', px, ACC.teal); };
        if (size === 'S') {
          var first = open[0];
          if (!first) return ok(34) + '<div class="wb m" style="margin-top:8px">All Closed</div><div class="ws">Doors &amp; Windows</div>';
          return gly(WAY_GLYPH[first.kind][0], 34, ACC.orange) + '<div class="wb xl">' + open.length + '</div><div class="ws">' + esc(open.length === 1 ? 'Open · ' + name(first) : 'Open') + '</div>';
        }
        var big = open.length ? '<div class="wb m">' + open.length + ' Open</div>' : '<div class="wb m ok">' + ok(24) + 'All Closed</div>';
        if (size === 'W') {
          return '<div class="wsplit"><div class="wcol" style="flex:0 0 170px">' + lab + big + '<div class="ws">' + esc(line) + '</div></div>' +
            '<div class="wcol wr t44" style="justify-content:center">' + fitRows(list, box.ih, row, 44) + '</div></div>';
        }
        // (T, L and XL, 2026-11-08, the owner: nothing stretches -- rows keep their 48 px, as many as fit with "N more", and the hero and
        // the rows are one group centered under the label; the figure is the hero's 72 where three rows still fit under it)
        var since = function (st) {
          var t = Date.parse(st.last_changed || ''), L = window.hkLocale;
          if (!t) return '';
          var d = new Date(t), today = new Date().toDateString() === d.toDateString(), tag = L ? L.tag() : undefined;
          return (size === 'T' ? 'Since ' : 'Open since ') + (today ? d.toLocaleTimeString(tag, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(tag, { weekday: 'short' }));
        };
        var tall = function (x) {
          var g = WAY_GLYPH[x.kind][x.open ? 0 : 1], s = x.open ? since(x.st) : '', col = x.open ? ' style="color:' + ACC.orange + '"' : '';
          // (Tall, 160 px across: the state is the line under the name -- "Open since 9:41 PM", "Closed" -- not a word beside it)
          if (size === 'T') return '<div data-more="' + esc(x.id) + '">' + gly(g, 24, x.open ? ACC.orange : null) + '<span class="wt"><b>' + esc(name(x)) + '</b><small' + col + '>' + esc(s || 'Closed') + '</small></span></div>';
          return '<div data-more="' + esc(x.id) + '">' + gly(g, 24, x.open ? ACC.orange : null) + '<span class="wt"><b>' + esc(name(x)) + '</b>' +
            (s ? '<small>' + esc(s) + '</small>' : '') + '</span><em' + col + '>' + (x.open ? 'Open' : 'Closed') + '</em></div>';
        };
        var heroH = open.length ? 94 : 100;
        var hero = function (xl) {
          if (!xl) return big;
          return open.length ? '<div class="wb xl">' + open.length + '</div><div class="ws">Open</div>' : ok(44) + '<div class="wb m" style="margin-top:6px">All Closed</div>';
        };
        if (size === 'T' || size === 'L') {
          var room = box.ih - 19 - 6, xl = room - heroH - 8 >= Math.min(list.length, 3) * 48, rest = room - (xl ? heroH : 52) - 8;
          return lab + '<div class="wmid">' + hero(xl) + '<div class="wr tall" style="margin-top:8px">' + fitRows(list, rest, tall, 48) + '</div></div>';
        }
        return '<div class="wsplit" style="gap:22px"><div class="wcol" style="flex:0 0 200px">' + lab +
          '<div class="wmid">' + hero(true) + '<div class="ws">' + esc(line) + '</div>' +
          '</div></div><div class="wcol wmid wr tall">' + fitRows(list, box.ih, tall, 48) + '</div></div>';
      }
      // WATER: today's large; Small and Tall the last twelve hours as a
      // short chart (Tall the days before under it); Wide the day's hours
      // beside the number, the chart on the block's foot
      _ownWater(p, size, box, h) {
        var lab = '<div class="wl" style="color:' + ACC.cyan + '">Water</div>';
        var ids = waterIds(this, h, p.meter);
        if (ids && !ids.length) return lab + '<div class="ws wf" style="white-space:normal">' + esc(PANEL_EMPTY.water[1]) + '</div>';
        var d = ids ? waterDay(this, h, ids) : null;
        if (!d) return lab + '<div class="ws wf">Loading today…</div>';
        var more = d.more ? ' data-more="' + esc(d.more) + '"' : '', unit = esc(d.unit), big = '<div class="wb"' + more + '>' + amount(d.tot) + '</div>';
        var last12 = d.seq.slice(-12).map(function (x) { return { v: x, c: ACC.cyan }; });
        if (size === 'S') return lab + big + '<div class="ws">' + unit + ' today</div><div class="wf">' + wbars(last12, box.iw, shortH(box)) + '</div>';
        if (size === 'W') {
          var day = d.day24.map(function (x) { return { v: x.v, c: x.fut ? v('ink-3') : ACC.cyan, ghost: x.fut }; });
          return '<div class="wsplit"><div class="wcol" style="flex:0 0 130px">' + lab + big + '<div class="ws">' + unit + ' today</div>' +
            (d.cmp ? '<div class="ws">' + esc(d.cmp) + '</div>' : '') + '</div>' +
            '<div class="wcol" style="justify-content:flex-end">' + wbars(day, box.iw - 130 - 18, Math.max(40, box.ih - 30)) + '</div></div>';
        }
        var tz = window.hkStats && window.hkStats.tz();
        var row = function (x) {
          return '<div style="cursor:default"><b>' + esc(new Date(x.t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short', timeZone: tz }))) + '</b><em>' +
            (x.v == null ? '—' : amount(x.v) + ' ' + unit) + '</em></div>';
        };
        if (size === 'L' || size === 'XL') {
          // what the leak sensors say: one wet, by name and in red; else "no leaks", where the house has them
          var wet = (p.leaks || []).filter(function (id) { return h.states[id] && h.states[id].state === 'on'; });
          var leak = wet.length ? '<span style="color:' + ACC.red + '">Leak: ' + esc((C.accName && C.accName(wet[0])) || attr(h.states[wet[0]], 'friendly_name') || wet[0]) + '</span>'
            : (p.leaks || []).length ? 'no leaks' : '';
          var line = [d.cmp ? esc(d.cmp) : '', leak].filter(Boolean).join(' · ');
          var today = '<div class="wl" style="color:' + ACC.cyan + '">Today</div><div class="wb"' + more + '>' + amount(d.tot) + ' ' + unit + '</div>' +
            (line ? '<div class="ws">' + line + '</div>' : '');
          var hours = d.day24.map(function (x) { return { v: x.v, c: x.fut ? v('ink-3') : ACC.cyan, ghost: x.fut }; });
          var chH = Math.max(40, box.ih - 19 - 46 - (line ? 19 : 0) - 14);
          if (size === 'L') return today + '<div class="wf">' + wbars(hours, box.iw, chH) + '</div>';
          var lw = Math.round((box.iw - 22) * 0.58);
          return '<div class="wsplit" style="gap:22px"><div class="wcol" style="flex:0 0 ' + lw + 'px">' + today + '<div class="wf">' + wbars(hours, lw, chH) + '</div></div>' +
            '<div class="wcol"><div class="wl" style="color:' + v('ink-2') + '">This Week</div>' +
            // (today first, as the mock-up's Sat over Fri, Thu, Wed)
            '<div class="wr" style="margin-top:6px">' + fitRows([{ t: d.day0, v: d.tot }].concat(d.week), box.ih - 19 - 6, row) + '</div></div></div>';
        }
        var room = box.ih - 19 - 46 - 19 - (d.cmp ? 19 : 0) - 12 - 44 - 14 - 19 - 4;
        return lab + big + '<div class="ws">' + unit + ' today</div>' + (d.cmp ? '<div class="ws">' + esc(d.cmp) + '</div>' : '') +
          '<div style="margin-top:12px">' + wbars(last12, box.iw, 44) + '</div>' +
          '<div class="wl" style="margin-top:14px;color:' + v('ink-2') + '">This Week</div>' +
          '<div class="wr" style="margin-top:2px">' + fitRows(d.week, room, row) + '</div>';
      }
      // A THERMOSTAT'S READINGS AND CONTROLS beside its dial: inside,
      // humidity and outside (the sheet's three), then its modes and its fan
      _readings() {
        if (!this._rd) return;
        var h = this.client || { states: {} }, id = this._parts()[1].readings, s = h.states[id] || {}, a = s.attributes || {};
        var HS = window.hkSettings, wid = setting('weather.entity', null) || firstOfDomain(h, 'weather'), wx = h.states[wid];
        var ot = HS && HS.nowTemp ? HS.nowTemp(h.states, wid) : wx && wx.attributes ? wx.attributes.temperature : null;
        var out = ot != null ? Math.round(ot) + '°' : '—';
        var NAME = { heat_cool: 'Auto', auto: 'Auto', heat: 'Heat', cool: 'Cool', off: 'Off', dry: 'Dry', fan_only: 'Fan', on: 'On', low: 'Low', medium: 'Medium', high: 'High' };
        var word = function (m) { return NAME[m] || String(m).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); };
        var seg = function (label, list, cur, kind) {
          if (!list || list.length < 2) return '';
          return '<div class="row"><span class="k">' + label + '</span><div class="seg" role="group" aria-label="' + label + '">' + list.slice(0, 5).map(function (m) {
            return '<button type="button" data-' + kind + '="' + esc(m) + '" aria-pressed="' + (m === cur) + '">' + esc(word(m)) + '</button>';
          }).join('') + '</div></div>';
        };
        var html = '<div class="rd"><div class="now">' + [['Inside', a.current_temperature != null ? Math.round(a.current_temperature) + '°' : '—'],
          ['Humidity', a.current_humidity != null ? Math.round(a.current_humidity) + '%' : '—'], ['Outside', out]].map(function (r) {
          return '<div><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>';
        }).join('') + '</div>' + seg('Mode', a.hvac_modes, s.state, 'mode') + seg('Fan', a.fan_modes, a.fan_mode, 'fan') + '</div>';
        if (this._rdHtml === html) return;
        this._rdHtml = html; this._rd.innerHTML = html;
        var self = this;
        this._rd.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () {
            var m = b.getAttribute('data-mode'), f = b.getAttribute('data-fan');
            if (m) self._call('climate', 'set_hvac_mode', { entity_id: id, hvac_mode: m });
            else if (f) self._call('climate', 'set_fan_mode', { entity_id: id, fan_mode: f });
          });
        });
      }
      // a card as tall as its width makes it, shrunk (never grown) to its
      // part: a picture centred; words (wide) laid out that much wider first,
      // so the shrunk card still spans the part (and, wider, is no taller)
      _fitWatch(part, kid, wide) {
        if (this._fitRO) this._fitRO.disconnect();
        if (typeof ResizeObserver === 'undefined') return;
        var fit = function () {
          kid.style.transform = ''; kid.style.width = '';
          var h = kid.offsetHeight, room = part.clientHeight;
          if (!h || !room || h <= room) return;
          var k = room / h;
          if (wide) { kid.style.width = (100 / k).toFixed(3) + '%'; kid.style.transformOrigin = '0 0'; }
          kid.style.transform = 'scale(' + k.toFixed(4) + ')';
        };
        this._fitRO = new ResizeObserver(fit);
        this._fitRO.observe(part); this._fitRO.observe(kid);
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._fitRO) { this._fitRO.disconnect(); this._fitRO = null; }
      }
    }

    // what the shell and the later parts use of this one
    K.ACC = ACC; K.gly = gly; K.hidesOf = hidesOf; K.HkGridPanelCard = HkGridPanelCard; K.inner = inner;
    K.WG_CSS = WG_CSS;
  };
})();
