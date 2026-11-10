// hk-sheet-vacuum.js - The vacuum sheet and its rooms.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-vacuum'] = function (K) {
    var at = K.at, BACK = K.BACK, bridge = K.bridge, C = K.C, CHEV = K.CHEV, esc = K.esc, glyph = K.glyph, num = K.num,
        Panel = K.Panel, PANEL_CSS = K.PANEL_CSS, pretty = K.pretty, unavailable = K.unavailable;

    // ------------------------------------------------------------ vacuum
    // The robot, what it is doing, and its four commands. Battery, room,
    // progress and errors are SEPARATE sensors here (the vacuum entities carry
    // no battery_level): the vacuum page's card names them, and a vacuum
    // opened from anywhere else finds them on its own device.
    var VF = { PAUSE: 4, RETURN_HOME: 16, LOCATE: 512, START: 8192 };
    var VAC_WORDS = { docked: 'Docked', cleaning: 'Cleaning', paused: 'Paused', returning: 'Returning',
                      idle: 'Idle', error: 'Error' };
    var VAC_OK = ['no_error', 'none', 'ok', 'unknown', 'unavailable', ''];
    // THE ROOM PICKER AS A LIST (hk-area-select-card, `list`): on the sheet itself, no plate of its own; the count, Clear and Start
    // Cleaning held at the top; the rooms one to a row (two in the wide sheet: list="2") under them, scrolling in what the sheet leaves
    // -- the owner, 2026-11-10: "a scrollable section with 1 column of areas"; "it could probably have 2 columns"
    var LIST_CSS = [
      ':host([list]){display:flex;flex-direction:column;min-height:0}',
      ':host([list]) > div{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
      // (not a glass plate: hk-glass.js frosts every --hk-glass-surface, and laid one over the sheet's own glass -- a box behind the rooms)
      ':host([list]) .plate{--hk-glass-surface:0;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:0;background:none;box-shadow:none;border:0;-webkit-backdrop-filter:none;backdrop-filter:none}',
      ':host([list]) .bar{flex:none;margin-bottom:12px;padding-bottom:12px}',
      ':host([list]) .rl{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;scrollbar-width:none}',
      ':host([list]) .rl::-webkit-scrollbar{display:none}',
      ':host([list]) .rl .grid{grid-template-columns:minmax(0,1fr);grid-auto-rows:48px;gap:8px}',
      ':host([list="2"]) .rl .grid{grid-template-columns:repeat(2,minmax(0,1fr))}',
      ':host([list]) .rl .pill{height:100%;border-radius:calc(48px / 2);padding:0 18px}:host([list]) .rl .pill > span{justify-self:start;text-align:left}',
      // (its pills the sheet's own keys, not glass: hk-glass.js frosted them on a layer of their own, a box behind them in a sheet)
      ':host([list]) .pill{--hk-glass-surface:0;-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none}',
      ':host([list]) .pill:not([aria-pressed="true"]){background:' + C.v('key') + '}'
    ].join('');
    function deviceSensor(h, id, test) {
      var ents = h && h.entities, me = ents && ents[id];
      if (!me || !me.device_id) return null;
      var hit = null;
      Object.keys(ents).some(function (k) {
        if (k.indexOf('sensor.') !== 0 || !ents[k] || ents[k].device_id !== me.device_id) return false;
        if (test(k, h.states[k])) { hit = k; return true; }
        return false;
      });
      return hit;
    }
    class VacuumPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          '.pn{gap:20px;padding:3px 0}',
          // the robot 200 and its commands 72: sized for the one sheet height
          '.bot{width:200px;height:200px;border-radius:100px;display:flex;align-items:center;justify-content:center;',
          '  background:rgba(255,255,255,0.10);color:rgba(255,255,255,0.85);transition:background .25s,color .25s}',
          '.bot.live{background:rgba(48,209,88,0.20);color:#30d158}',
          '.bot.bad{background:rgba(255,69,58,0.18);color:#ff453a}',
          // THE VACUUM DRAWN (2026-11-10, the owner: the sheets "should also get the updated animations"): the blocks' drawing
          // (hk-vacuum-art.js) in place of the glyph in its circle -- docked, charging, cleaning, returning, paused, stuck -- as wide as the
          // circle was, the circle's colors left to the drawing's own
          '.bot.drawn{width:240px;height:auto;border-radius:0;background:none;display:block}.bot.drawn.live,.bot.drawn.bad{background:none;color:inherit}',
          (window.hkVacuumArt ? window.hkVacuumArt.CSS : ''),
          '.big.w{font-size:40px}',
          '.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;min-height:30px}',
          '.chips span{height:30px;padding:0 12px;border-radius:15px;display:inline-flex;align-items:center;',
          '  font-size:14px;font-weight:600;background:rgba(255,255,255,0.10);color:' + window.hkCards.v('ink-2') + ';',
          '  font-variant-numeric:tabular-nums}',
          '.chips .good{color:#30d158}.chips .warn{color:#ffd60a}.chips .low{color:#ff453a}',
          '.chips .err{background:rgba(255,69,58,0.18);color:#ff6961}',
          '.cmds{align-self:stretch;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}',
          '.cmds button{display:flex;flex-direction:column;align-items:center;gap:8px;border:0;background:none;',
          '  color:#fff;font:inherit;cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent}',
          '.cmds .ci{width:72px;height:72px;border-radius:36px;display:flex;align-items:center;justify-content:center;',
          '  background:rgba(255,255,255,0.13);transition:background .2s,color .2s}',
          '.cmds button:active .ci{background:rgba(255,255,255,0.24)}',
          '.cmds button.sel .ci{background:rgba(255,255,255,0.95);color:rgba(0,0,0,0.85)}',
          '.cmds button[disabled]{opacity:.35;cursor:default}',
          '.cmds .cl{font-size:14px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
          '.pn > .menu{margin-top:0}',
          // CLEAN AREAS: the rooms this robot has on its map, two to a row,
          // a pick toggles; the green button sends only this robot.
          '.sub{align-self:stretch;display:flex;flex-direction:column;gap:16px}',
          '.bk{display:flex;align-items:center;gap:10px}',
          '.bk button{width:40px;height:40px;border-radius:20px;border:0;padding:0;display:flex;',
          '  align-items:center;justify-content:center;background:rgba(255,255,255,0.13);color:#fff;cursor:pointer}',
          '.bk .t,.two .rh{font-size:20px;font-weight:700;letter-spacing:-.3px}',
          '.agf{flex:0 0 auto}',
          '.ag{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:360px;overflow-y:auto;',
          '  overscroll-behavior:contain;scrollbar-width:none}',
          '.ag::-webkit-scrollbar{display:none}',
          // centred: text-only buttons have no glyph to share a left edge with
          '.ag .btn{height:48px;border-radius:24px;padding:0 12px;font-size:15px;min-width:0;justify-content:center;text-align:center}',
          '.ag .btn span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
          '.go{align-self:stretch;background:#30d158}',
          '.go:active{background:#28b84c}',
          '.go[disabled]{background:rgba(255,255,255,0.13);opacity:.5}',
          '.why{font-size:14px;color:#ff6961;text-align:center;min-height:18px;margin-top:-6px}',
          // THE ROOMS WHERE CLEAN AREAS IS NOT HOME ASSISTANT'S OWN (Mantel; a house's cleaning script): the Vacuums page's picker in the sheet
          '.pk{align-self:stretch;min-height:0}',
          '@media (max-width:' + C.BP.phone + 'px){.bot{width:170px;height:170px;border-radius:85px}.bot.drawn{width:200px;height:auto;border-radius:0}',
          '  .cmds .ci{width:60px;height:60px;border-radius:30px}.big.w{font-size:34px}',
          '  .ag{max-height:320px}.ag .btn{height:44px;border-radius:22px;padding:0 10px}}',
          // WITH ROOMS the panel fills the sheet's body (hkFill): the vacuum's view in its middle; the rooms' view and the wide sheet
          // as tall as the body, the rooms taking what is left and scrolling, one to a row (2026-11-10, the owner)
          ':host{display:flex;flex-direction:column}',
          ':host > div{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
          ':host([rooms]) .pn{margin-block:auto}',
          '.pn.sub,.pn.two{flex:1 1 auto;min-height:0;margin-block:0}',
          '.pn.sub{align-items:stretch;gap:16px}',
          '.rooms{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:12px}',
          '.rooms > *{flex:1 1 auto;min-height:0}',
          '.rooms .go,.rooms .why{flex:none}',
          '.agf{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
          '.ag,.ag{grid-template-columns:minmax(0,1fr);max-height:none;flex:1 1 auto;min-height:0;align-content:start}',
          '.ag .btn{justify-content:flex-start;text-align:left;padding:0 18px}',
          '.why.none{color:' + window.hkCards.v('ink-2') + ';text-align:left;margin:0}',
          // TWO COLUMNS (a tablet): the vacuum, what it is doing and its commands on the left; the rooms down the right
          '.pn.two{flex-direction:row;align-items:stretch;gap:20px;padding:0}',
          '.two .lft{flex:0 0 340px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;min-height:0}',
          '.two .rgt{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px}',
          '.two .ag{grid-template-columns:repeat(2,minmax(0,1fr))}'
        ].join('');
      }
      // THE ROOMS (2026-11-10, the owner: "a scrollable section with 1 column of areas you would scroll through ... creating a large
      // detail sheet for the tablets with the vacuums may be worth it"): 'ha' -- Home Assistant's own clean_area for this robot (HK
      // Frontend), 'house' -- the blocks' rooms, Clean Areas offered or the house's cleaning script (Mantel), '' -- none. With rooms the
      // sheet fills its body and, on a tablet, is wide: the vacuum on the left, the rooms one to a row down the right, scrolling
      _roomsKind(h) {
        h = h || this.client;
        var C1 = window.hkCards, ca = !!(C1 && C1.added && C1.added('clean_areas'));
        var haArea = !!(h && h.services && h.services.vacuum && h.services.vacuum.clean_area && h.services.hk_frontend);
        if (ca && haArea) return 'ha';
        if (ca || (C1 && C1.setting && C1.setting('features.vacuum_script', null))) return 'house';
        return '';
      }
      hkWidthKind(h) { return this._roomsKind(h) ? 'vacuum_rooms' : 'vacuum'; }
      hkFill() { return !!this._roomsKind(); }
      _wideAt() { return 700; }
      _onWide() { if (this.hasAttribute('wide')) this._view = 'main'; this._built = false; this._render(); }
      _parts() {
        if (this._pt) return this._pt;
        var c = this._src.config || {}, h = this.client, id = this._id;
        var find = function (re, dc) {
          return deviceSensor(h, id, function (k, st) {
            return dc ? !!(st && st.attributes && st.attributes.device_class === dc) : re.test(k);
          });
        };
        this._pt = {
          battery: c.battery || find(null, 'battery'),
          room: c.room || find(/current_room$/),
          progress: c.progress || find(/cleaning_progress$/),
          error: c.error || find(/(operational|vacuum)_error$/),
          dock_error: c.dock_error || find(/dock_error$/)
        };
        return this._pt;
      }
      _v(id) { var c = this.client, st = id && c && c.states[id]; return st ? st.state : null; }
      // The chips read other sensors (battery, room, progress, errors): they
      // are inputs like the vacuum, or a battery charging on the dock would
      // never move the sheet (the default signature is the vacuum alone).
      _sigOf() {
        var h = this.client, id = this._id;
        if (!h || !id) return null;
        var p = this._parts(), out = '';
        var art = window.hkVacuumArt ? window.hkVacuumArt.ids(h, id, this._src.config || {}) : {};
        [id, p.battery, p.room, p.progress, p.error, p.dock_error, art.error, art.charge, art.latch].forEach(function (k) {
          var st = k && h.states[k];
          out += (st ? st.last_updated : 'x') + '|';
        });
        return out;
      }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        this._na(s);
        var f = num(at(s, 'supported_features')) || 0;
        if (!this._view) this._view = 'main';
        var kind = this._roomsKind(), two = !!kind && this.hasAttribute('wide');
        this.toggleAttribute('rooms', !!kind);
        if (!two && this._view === 'areas') { this._renderAreas(); return; }
        if (!this._built) {
          this._built = true;
          var cmds = [['start', 'mdi:play', 'Start', VF.START], ['pause', 'mdi:pause', 'Pause', VF.PAUSE],
                      ['locate', 'mdi:map-marker', 'Locate', VF.LOCATE], ['return_to_base', 'mdi:home-import-outline', 'Dock', VF.RETURN_HOME]];
          var top = '<div class="bot' + (window.hkVacuumArt ? ' drawn' : '') + '">' + (window.hkVacuumArt ? '' : glyph('mdi:robot-vacuum', 96)) + '</div>' +
            '<div class="big w"></div><div class="chips"></div><div class="cmds">' +
            cmds.map(function (c) {
              return '<button data-s="' + c[0] + '"' + (f & c[3] ? '' : ' disabled') + ' aria-label="' + c[2] + '">' +
                     '<div class="ci">' + glyph(c[1], 30) + '</div><div class="cl">' + c[2] + '</div></button>';
            }).join('') + '</div>';
          this._drawn = '';
          this._root.innerHTML = two
            ? '<div class="pn two"><div class="lft">' + top + '</div><div class="rgt"><div class="rh">Rooms to Clean</div><div class="rooms"></div></div></div>'
            : '<div class="pn">' + top + '</div>';
          this._root.querySelectorAll('.cmds button').forEach(function (b) {
            b.addEventListener('click', function () { self._svc('vacuum', b.getAttribute('data-s')); });
          });
          this._bot = this._root.querySelector('.bot');
          this._big = this._root.querySelector('.big');
          this._chips = this._root.querySelector('.chips');
          if (two) this._fillRooms(this._root.querySelector('.rooms'), kind);
          else if (kind) this._roomsRow(kind);
        }
        if (this._pickCard && this._pickCard.isConnected) bridge(this._pickCard, this.client);
        var st = s.state, p = this._parts();
        var live = st === 'cleaning' || st === 'returning';
        var chips = [];
        var bn = num(at(s, 'battery_level'));
        if (bn == null) bn = num(this._v(p.battery));
        if (bn != null) chips.push([Math.round(bn) + '% battery', bn <= 20 ? 'low' : bn <= 40 ? 'warn' : '']);
        // a room and a percentage next to a DOCKED vacuum are last run's
        if (live) {
          var room = this._v(p.room);
          if (room && room !== 'unknown' && room !== 'unavailable') chips.push([room, '']);
          var pr = num(this._v(p.progress));
          if (pr != null && pr > 0) chips.push([Math.round(pr) + '% done', 'good']);
        }
        var errs = [p.error, p.dock_error].map(function (id) { return self._v(id); })
          .filter(function (e) { return e && VAC_OK.indexOf(e) === -1; });
        errs.forEach(function (e) { chips.push([pretty(e), 'err']); });
        var bad = unavailable(s) || st === 'error' || errs.length > 0;
        this._bot.classList.toggle('live', live && !bad);
        this._bot.classList.toggle('bad', bad);
        if (window.hkVacuumArt) {
          var lk = window.hkVacuumArt.look(this.client, this._id, this._src.config || {});
          var draw = window.hkVacuumArt.html(lk.state, (at(s, 'friendly_name') || this._id) + ', ' + lk.words);
          if (this._drawn !== draw) { this._drawn = draw; this._bot.innerHTML = draw; }
        }
        this._big.textContent = unavailable(s) ? 'Unavailable' : VAC_WORDS[st] || pretty(st);
        var html = chips.map(function (c) { return '<span class="' + c[1] + '">' + esc(c[0]) + '</span>'; }).join('');
        if (this._chipsHtml !== html) { this._chipsHtml = html; this._chips.innerHTML = html; }
        var on = { start: st === 'cleaning', pause: st === 'paused', return_to_base: st === 'returning' };
        this._root.querySelectorAll('.cmds button').forEach(function (b) {
          b.classList.toggle('sel', !!on[b.getAttribute('data-s')]);
        });
      }
    }

    // ------------------------------------------------------------ vacuum: areas
    // WHICH ROOMS THIS ROBOT KNOWS, where Home Assistant maps them ('ha'): its own mapping (the vacuum's entity settings), read through
    // Clean Areas' dry run -- a plan, nothing sent -- once per sheet; Clean sends this robot alone (vacuum.clean_area). Under Mantel
    // ('house') the rooms are the blocks' and the Vacuums page's, picked in that page's own picker (hk-area-select-card, one column)
    VacuumPanel.prototype._reachLoad = function (then) {
      var self = this, h = this.client, id = this._id;
      if (this._reach) { then(); return; }
      if (this._reachP) { this._reachP.push(then); return; }
      this._reachP = [then];
      this._callResp('hk_frontend', 'clean_areas', { areas: Object.keys((h && h.areas) || {}), dry_run: true }).then(function (res) {
        var plan = (res && res.response && res.response.plan) || [];
        var mine = plan.filter(function (p) { return p.vacuum === id && p.action === 'clean_area'; })[0];
        var hh = self.client || h;
        self._reach = ((mine && mine.areas) || []).map(function (a) { return { id: a, name: (hh.areas[a] && hh.areas[a].name) || pretty(a) }; })
          .sort(function (x, y) { return x.name.localeCompare(y.name); });
        var w = self._reachP; self._reachP = null;
        w.forEach(function (f) { f(); });
      });
    };
    // A PHONE (and a sheet too narrow for two columns): a row under the commands that opens the rooms
    VacuumPanel.prototype._roomsRow = function (kind) {
      var self = this;
      var add = function (said) {
        var pn = self._root.querySelector('.pn');
        if (!pn || pn.querySelector('.menu') || self._view !== 'main') return;
        var b = document.createElement('button');
        b.className = 'btn menu';
        b.innerHTML = '<span>Rooms to Clean</span><span class="cur">' + said + CHEV + '</span>';
        b.addEventListener('click', function () { self._view = 'areas'; self._built = false; self._render(); });
        pn.appendChild(b);
      };
      if (kind === 'house') { add('Choose'); return; }
      this._reachLoad(function () { if (self._reach.length) add(self._reach.length + ' rooms'); });
    };
    VacuumPanel.prototype._renderAreas = function () {
      var self = this, kind = this._roomsKind();
      if (!this._built) {
        this._built = true;
        this._root.innerHTML = '<div class="pn sub"><div class="bk"><button aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + BACK + '"/></svg></button><span class="t">Rooms to Clean</span></div><div class="rooms"></div></div>';
        this._root.querySelector('.bk button').addEventListener('click', function () { self._view = 'main'; self._built = false; self._render(); });
        this._fillRooms(this._root.querySelector('.rooms'), kind);
      }
      if (this._pickCard && this._pickCard.isConnected) bridge(this._pickCard, this.client);
      if (kind === 'ha') this._paintAreas();
    };
    // THE ROOMS INTO `box`, one to a row, scrolling in what the sheet leaves them
    VacuumPanel.prototype._fillRooms = function (box, kind) {
      var self = this;
      this._pickCard = null;
      if (kind === 'house') {
        // THE ROOMS THIS VACUUM REACHES (2026-11-10, the owner: "the Vacuum should only show rooms in its detail sheet that it can vacuum"):
        // Mantel's Clean Areas coverage (hk_clean_areas/coverage) gives each robot's areas, from its room map; a robot with no map, and a
        // host that does not answer (Home Assistant), keep every room the house offers, as the robot's block does
        var two = this.hasAttribute('wide'), c = this.client, id = this._id;
        var make = function (only) {
          if (box.isConnected === false || typeof window.loadCardHelpers !== 'function') return;
          // (made as the custom pop-up makes its cards: the picker's file may not have loaded yet -- hk-sheet-group.js)
          window.loadCardHelpers().then(function (helpers) {
            if (box.isConnected === false) return;
            var pc = helpers.createCardElement(Object.assign({ type: 'custom:hk-area-select-card', layout: 'panel', list: true }, only ? { only: only } : {}));
            pc.setAttribute('list', two ? '2' : '1');
            bridge(pc, self.client);
            box.appendChild(pc);
            // (its shadow root once it is upgraded: the helper can hand it over before -- then no style would land)
            var css = function (n) {
              if (pc.shadowRoot) { if (!pc.shadowRoot.querySelector('style.hkvl')) pc.shadowRoot.appendChild(Object.assign(document.createElement('style'), { className: 'hkvl', textContent: LIST_CSS })); }
              else if (n < 40) setTimeout(function () { css(n + 1); }, 25);
            };
            css(0);
            self._pickCard = pc;
          }, function (e) { console.error('[hk-detail] vacuum rooms: no card helpers', e); });
        };
        var ask = null;
        try { ask = c && typeof c.callWS === 'function' ? Promise.resolve(c.callWS({ type: 'hk_clean_areas/coverage' })) : null; } catch (e) { ask = null; }
        if (!ask) { make(null); return; }
        ask.then(function (r) {
          var mine = ((r && r.coverage) || []).filter(function (v) { return v.vacuum === id; })[0];
          make(mine && Array.isArray(mine.areas) && mine.areas.length ? mine.areas.slice() : null);
        }, function () { make(null); });
        return;
      }
      if (!this._pick) this._pick = new Set();
      this._reachLoad(function () {
        if (box.isConnected === false) return;
        box.innerHTML = (self._reach.length ? '<div class="hk-edge agf"><div class="ag">' + self._reach.map(function (a) {
            return '<button class="btn" data-a="' + esc(a.id) + '" aria-pressed="false"><span>' + esc(a.name) + '</span></button>';
          }).join('') + '</div></div><button class="btn go" disabled></button><div class="why"></div>'
          : '<div class="why none">No room is mapped for this vacuum yet. Map its rooms in its settings in Home Assistant.</div>');
        C.edges(box);
        box.querySelectorAll('.ag .btn').forEach(function (b) {
          b.addEventListener('click', function () {
            var a = b.getAttribute('data-a');
            if (self._pick.has(a)) self._pick.delete(a); else self._pick.add(a);
            self._paintAreas();
          });
        });
        var go = self._goBtn = box.querySelector('.go');
        self._why = box.querySelector('.why');
        if (go) go.addEventListener('click', function () {
          if (!self._pick.size || go.disabled) return;
          var areas = Array.from(self._pick);
          go.disabled = true;
          self._why.textContent = '';
          // THIS robot only: the picker on the vacuum page is the home-wide one
          self._svc('vacuum', 'clean_area', { cleaning_area_id: areas }).then(function (ok) {
            if (ok) { self._pick.clear(); if (!self.hasAttribute('wide')) { self._view = 'main'; self._built = false; self._render(); } else self._paintAreas(); return; }
            // the selection survives a failed send
            self._why.textContent = 'Could not start. Tap to try again.';
            self._paintAreas();
          });
        });
        self._paintAreas();
      });
    };
    VacuumPanel.prototype._paintAreas = function () {
      var pick = this._pick || new Set(), n = pick.size;
      this._root.querySelectorAll('.ag .btn').forEach(function (b) {
        var on = pick.has(b.getAttribute('data-a'));
        b.classList.toggle('sel', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (this._goBtn && this._goBtn.isConnected !== false) {
        this._goBtn.disabled = !n;
        this._goBtn.textContent = n ? 'Clean ' + n + (n === 1 ? ' Room' : ' Rooms') : 'Choose Rooms';
      }
    };

    // what the shell and the later sheet files use of this one
    K.VacuumPanel = VacuumPanel;
  };
})();
