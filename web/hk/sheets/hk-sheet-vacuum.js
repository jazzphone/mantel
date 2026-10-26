// hk-sheet-vacuum.js - The vacuum sheet and its rooms.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-vacuum'] = function (K) {
    var at = K.at, BACK = K.BACK, C = K.C, CHEV = K.CHEV, esc = K.esc, glyph = K.glyph, num = K.num,
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
          '.bk .t{font-size:20px;font-weight:700;letter-spacing:-.3px}',
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
          '@media (max-width:' + C.BP.phone + 'px){.bot{width:170px;height:170px;border-radius:85px}',
          '  .cmds .ci{width:60px;height:60px;border-radius:30px}.big.w{font-size:34px}',
          '  .ag{max-height:320px}.ag .btn{height:44px;border-radius:22px;padding:0 10px}}'
        ].join('');
      }
      hkWidthKind() { return 'vacuum'; }
      // the sensors: the source card's, else found on the vacuum's device
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
        [id, p.battery, p.room, p.progress, p.error, p.dock_error].forEach(function (k) {
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
        if (this._view === 'areas') { this._renderAreas(); return; }
        if (!this._built) {
          this._built = true;
          var cmds = [['start', 'mdi:play', 'Start', VF.START], ['pause', 'mdi:pause', 'Pause', VF.PAUSE],
                      ['locate', 'mdi:map-marker', 'Locate', VF.LOCATE], ['return_to_base', 'mdi:home-import-outline', 'Dock', VF.RETURN_HOME]];
          this._root.innerHTML = '<div class="pn"><div class="bot">' + glyph('mdi:robot-vacuum', 96) + '</div>' +
            '<div class="big w"></div><div class="chips"></div><div class="cmds">' +
            cmds.map(function (c) {
              return '<button data-s="' + c[0] + '"' + (f & c[3] ? '' : ' disabled') + ' aria-label="' + c[2] + '">' +
                     '<div class="ci">' + glyph(c[1], 30) + '</div><div class="cl">' + c[2] + '</div></button>';
            }).join('') + '</div></div>';
          this._root.querySelectorAll('.cmds button').forEach(function (b) {
            b.addEventListener('click', function () { self._svc('vacuum', b.getAttribute('data-s')); });
          });
          this._bot = this._root.querySelector('.bot');
          this._big = this._root.querySelector('.big');
          this._chips = this._root.querySelector('.chips');
          this._areasBtn();
        }
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
    // WHICH ROOMS THIS ROBOT KNOWS comes from Home Assistant's own mapping (the
    // vacuum's entity settings), read through Clean Areas' dry run -- a
    // plan, nothing sent -- once per sheet. Only a robot that takes
    // vacuum.clean_area gets the button; one that just starts in its own room
    // has nothing to choose.
    VacuumPanel.prototype._areasBtn = function () {
      var self = this, h = this.client;
      var add = function () {
        if (!self._reach || !self._reach.length || self._view !== 'main') return;
        var pn = self._root.querySelector('.pn');
        if (!pn || pn.querySelector('.menu')) return;
        var b = document.createElement('button');
        b.className = 'btn menu';
        b.innerHTML = '<span>Clean Areas</span><span class="cur">' + self._reach.length + ' rooms' + CHEV + '</span>';
        b.addEventListener('click', function () { self._view = 'areas'; self._built = false; self._render(); });
        pn.appendChild(b);
      };
      if (this._reach !== undefined) { add(); return; }
      this._reach = null;
      var C1 = window.hkCards;
      if (!h || !C1 || !C1.added || !C1.added('clean_areas') || !h.services || !h.services.vacuum ||
          !h.services.vacuum.clean_area) return;
      var id = this._id;
      this._callResp('hk_frontend', 'clean_areas', { areas: Object.keys(h.areas || {}), dry_run: true }).then(function (res) {
        var plan = (res && res.response && res.response.plan) || [];
        var mine = plan.filter(function (p) { return p.vacuum === id && p.action === 'clean_area'; })[0];
        var areas = (mine && mine.areas) || [];
        var hh = self.client || h;
        self._reach = areas.map(function (a) { return { id: a, name: (hh.areas[a] && hh.areas[a].name) || pretty(a) }; })
          .sort(function (x, y) { return x.name.localeCompare(y.name); });
        add();
      });
    };
    VacuumPanel.prototype._renderAreas = function () {
      var self = this;
      if (!this._pick) this._pick = new Set();
      if (!this._built) {
        this._built = true;
        this._root.innerHTML = '<div class="pn"><div class="sub"><div class="bk"><button aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + BACK + '"/></svg></button><div class="t">Clean Areas</div></div>' +
          '<div class="hk-edge agf"><div class="ag">' + (this._reach || []).map(function (a) {
            return '<button class="btn" data-a="' + esc(a.id) + '" aria-pressed="false"><span>' + esc(a.name) + '</span></button>';
          }).join('') + '</div></div><button class="btn go" disabled></button><div class="why"></div></div></div>';
        this._root.querySelector('.bk button').addEventListener('click', function () { self._view = 'main'; self._built = false; self._render(); });
        C.edges(this._root);
        this._root.querySelectorAll('.ag .btn').forEach(function (b) {
          b.addEventListener('click', function () {
            var a = b.getAttribute('data-a');
            if (self._pick.has(a)) self._pick.delete(a); else self._pick.add(a);
            self._paintAreas();
          });
        });
        var go = this._goBtn = this._root.querySelector('.go');
        this._why = this._root.querySelector('.why');
        go.addEventListener('click', function () {
          if (!self._pick.size || go.disabled) return;
          var areas = Array.from(self._pick);
          go.disabled = true;
          self._why.textContent = '';
          // THIS robot only: the picker on the vacuum page is the home-wide one
          self._svc('vacuum', 'clean_area', { cleaning_area_id: areas }).then(function (ok) {
            if (ok) { self._pick.clear(); self._view = 'main'; self._built = false; self._render(); return; }
            // the selection survives a failed send
            self._why.textContent = 'Could not start. Tap to try again.';
            self._paintAreas();
          });
        });
      }
      this._paintAreas();
    };
    VacuumPanel.prototype._paintAreas = function () {
      var pick = this._pick, n = pick.size;
      this._root.querySelectorAll('.ag .btn').forEach(function (b) {
        var on = pick.has(b.getAttribute('data-a'));
        b.classList.toggle('sel', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (this._goBtn) {
        this._goBtn.disabled = !n;
        this._goBtn.textContent = n ? 'Clean ' + n + (n === 1 ? ' Area' : ' Areas') : 'Choose Areas';
      }
    };

    // what the shell and the later sheet files use of this one
    K.VacuumPanel = VacuumPanel;
  };
})();
