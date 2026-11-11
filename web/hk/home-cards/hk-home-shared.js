// hk-home-shared.js - what the vacuum and timer cards share: the nested-card feed, the no-helpers line, the rooms picked and the room-picking base.
//
// PART OF THE HOME CARDS (hk-home.js). Not a card and not run on its own: it registers one
// function, which hk-home.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkHomeParts = window.hkHomeParts || {})['hk-home-shared'] = function (K) {
    var setting = K.setting;

    // What the timer cards say when the script they call does not exist: the
    // quick-timer helpers (helpers/quick_timers.yaml) are not installed.
    // A nested card made by create() takes its client once it is configured (an
    // unupgraded element would keep a plain property that shadows the setter).
    // slice 9: needs hk-base.js's hkSetClient to take a client; until then this
    // does what it does, with the host adapter deciding what the child gets.
    function feed(el, client) {
      if (!el || !client) return;
      if (typeof el.setConfig === 'function') { window.hkHostClient.bridge(el, client); return; }
      el._hkFeed = client;                       // the latest one, when the element arrives
      if (el._hkFeedWait || !window.customElements || !customElements.whenDefined) return;
      el._hkFeedWait = true;
      customElements.whenDefined(el.localName).then(function () {
        el._hkFeedWait = false;
        window.hkHostClient.bridge(el, el._hkFeed);
      }, function () { el._hkFeedWait = false; });
    }

    // (Home Assistant's own helpers, named as the host names them: hk-host-shell.js haName)
    function NO_HELPERS() { return 'Quick timers need ' + window.hkShell.haName('HK Frontend\u2019s timer helpers') + ' (helpers/quick_timers.yaml).'; }

    // ------------------------------------------------------- picking rooms
    // THE ROOMS TO CLEAN, AND CLEANING THEM: the rooms Clean Areas offers, the
    // selection, and the one dispatch. The area picker (below) is built on it,
    // and so, from Large up, is the Vacuum block (2026-10-31, the owner: "rooms
    // as tiles to tick, 'Clean 2 rooms'") -- one way to ask for rooms, so the
    // block and the Vacuums page can never send them differently.
    //
    // A card on this sets `_auto` (show the rooms Clean Areas offers, live) and
    // `_sel` (a Set) before it draws, and redraws in _render.
    // THE ROOMS PICKED FOR A VACUUM (2026-11-08, the owner: Tall and Wide pick their rooms in a sheet and name them on the block): one Set a vacuum,
    // shared by its block and the Rooms sheet that edits it; a pick tells the others by hk-vacuum-rooms
    var PICKED = {}, picked = (id) => PICKED[id] || (PICKED[id] = new Set());
    function areaPicking(Base) {
      return class extends Base {
        // THROUGH hkSettings.subscribe, as every lasting subscription here is: the
        // command is HK Frontend's own and always answers ({configured: false}
        // without Clean Areas), but right after a restart a screen can reconnect
        // before it is registered, and a raw subscribe refused then is dropped for
        // good -- the picker kept the old rooms until the card was rebuilt. This
        // one resubscribes on every reconnect and retries a refusal with back-off.
        _subAreas() {
          if (!this._auto || this._areaSub || !this.isConnected) return;
          var conn = this.client && this.client.subscriptions;    // the client's port
          var sub = window.hkSettings && window.hkSettings.subscribe;
          if (!conn || typeof conn.subscribeMessage !== 'function' || typeof sub !== 'function') return;
          var self = this;
          this._areaSub = sub(conn, { type: 'hk_clean_areas/subscribe' }, function (ev) {
            self._offer = ev || { configured: false, areas: [] };
            self._render();
          }, 'hk-area-select');
        }
        connectedCallback() {
          super.connectedCallback();
          this._subAreas();
          window.addEventListener('hk-vacuum-rooms', this._onPick = () => { if (this._config && (this._config.pick || this._cellSize())) this._render(); });
        }
        disconnectedCallback() {
          super.disconnectedCallback();
          window.removeEventListener('hk-vacuum-rooms', this._onPick);
          var close = this._areaSub;
          this._areaSub = null;
          if (typeof close === 'function') close();
        }
        // THE ORDER within a floor: the card's own `order:` (area ids -- a house
        // whose rooms read in a sequence of its own), else this screen's Room
        // order when it is used on pages (Home -> Rooms), else A to Z. A room not
        // in the order follows those that are, A to Z.
        _order() {
          if (Array.isArray(this._config.order) && this._config.order.length) return this._config.order;
          var M = window.hkCards && window.hkCards.menu, b = M && M.board ? M.board() : null;
          return b && b.page_rooms === 'order' && Array.isArray(b.room_order) ? b.room_order : [];
        }
        // [{name, areas: [{id, name}]}], or null while HK Clean Areas has not
        // answered yet
        _floors() {
          if (!this._auto) return this._config.floors || [];
          var o = this._offer;
          if (!o) return null;
          var A = (this.client && this.client.areas) || {}, FL = (this.client && this.client.floors) || {};
          // without HK Clean Areas a house's own script still cleans: every area
          var ids = (o.missing || o.configured === false) && this._script() ? Object.keys(A) : (o.areas || []), only = this._config.only;
          if (Array.isArray(only)) ids = ids.filter(function (id) { return only.indexOf(id) >= 0; });   // (`only`: one vacuum's rooms, its sheet's -- hk-sheet-vacuum.js)
          var by = {};
          ids.forEach(function (id) {
            var a = A[id];
            if (!a) return;
            var f = a.floor_id && FL[a.floor_id] ? a.floor_id : '';
            (by[f] = by[f] || []).push({ id: id, name: a.name || id });
          });
          var lv = function (f) { var x = FL[f]; return x && typeof x.level === 'number' ? x.level : 1e9; };
          var rank = {}, order = this._order();
          order.forEach(function (id, i) { if (!(id in rank)) rank[id] = i; });
          var rk = function (a) { return a.id in rank ? rank[a.id] : order.length; };
          return Object.keys(by).sort(function (x, y) {
            return (x === '') - (y === '') || lv(x) - lv(y) || String((FL[x] || {}).name).localeCompare(String((FL[y] || {}).name));
          }).map(function (f) {
            return { name: (FL[f] && FL[f].name) || 'Rooms',
                     areas: by[f].sort(function (x, y) { return rk(x) - rk(y) || String(x.name).localeCompare(String(y.name)); }) };
          });
        }
        _script() { return this._config.start_script || setting('features.vacuum_script'); }
        // what the rooms drawn depend on: the order, and each offered area's
        // name and floor (the list itself arrives by subscription)
        _areaSig() {
          var A = (this.client && this.client.areas) || {}, FL = (this.client && this.client.floors) || {};
          var ids = (this._offer && this._offer.areas) || [];
          return this._order().join(',') + '|' + ids.map(function (id) {
            var a = A[id] || {}, f = FL[a.floor_id] || {};
            return id + ':' + (a.name || '') + ':' + (a.floor_id || '') + ':' + (f.name || '') + ':' + (f.level == null ? '' : f.level);
          }).join(',');
        }
        // a room no longer offered is no longer selected
        _keepOffered(floors) {
          if (!floors || !this._auto || !this._sel || !this._sel.size) return;
          var here = {}, sel = this._sel;
          floors.forEach(function (f) { (f.areas || []).forEach(function (a) { here[a.id] = true; }); });
          sel.forEach(function (id) { if (!here[id]) sel.delete(id); });
        }

        _toggle(id) {
          this._sel.has(id) ? this._sel.delete(id) : this._sel.add(id);
          this._render(); window.dispatchEvent(new Event('hk-vacuum-rooms'));
        }
        _clear() { this._sel.clear(); this._render(); window.dispatchEvent(new Event('hk-vacuum-rooms')); }

        // SAME RULE AS THE TIMER KEYPAD: the selection survives a failed dispatch.
        // Six rooms chosen, one tap, a rejected call: clearing then would wipe
        // the lot with nothing cleaning and nothing said.
        _start() {
          if (!this._sel.size || !this.client) return;
          var n = this._sel.size;
          if (!this._begin('Sending ' + n + (n === 1 ? ' area\u2026' : ' areas\u2026'))) return;
          var self = this;
          var areas = Array.from(this._sel);
          var sent = function () {
            self._clear();              // _clear re-renders
            self._setStatus('sent', n === 1 ? 'Sent 1 area to clean.'
                                            : 'Sent ' + n + ' areas to clean.', 5000);
          };
          // A HOUSE'S OWN SCRIPT, when it names one (the card's start_script, or
          // Configure -> Advanced): it receives `areas` and does the rest. Still
          // script.turn_on and only `ok` -- the robot cards beside this one are
          // the real confirmation.
          var script = this._script();
          if (script) {
            this._call('script', 'turn_on', { entity_id: script, variables: { areas: areas } })
              .then(function (ok) {
                self._end();
                if (ok) sent();
                else {
                  // Selection untouched: six rooms chosen is real work to redo.
                  self._setStatus('failed', 'Could not reach Home Assistant. Tap to retry.');
                  self._render();
                }
              });
            return;
          }
          // OTHERWISE CLEAN AREAS SENDS THEM (hk_frontend.clean_areas, the Clean
          // Areas feature): each vacuum gets the chosen areas on its own room
          // map, and it says which areas no vacuum reaches. Not added: say so,
          // rather than an error from the action.
          if (!(window.hkCards && window.hkCards.added && window.hkCards.added('clean_areas'))) {
            this._end();
            this._setStatus('failed', 'Add Clean Areas (' + window.hkShell.haPlace('HK Frontend \u2192 Add feature') + ') to clean by area.');
            this._render();
            return;
          }
          this._callResp('hk_frontend', 'clean_areas', { areas: areas }).then(function (res) {
            self._end();
            var r = (res && res.response) || {};
            if (res.ok && r.ok) {
              sent();
              // SOME AREAS NO VACUUM REACHES: the rest were sent, so this is a
              // `warn` (it stays until the next action), not a failure.
              if (r.unreachable && r.unreachable.length) {
                self._setStatus('warn', 'Sent. No vacuum reaches ' + r.unreachable.length +
                                ' of them.');
              }
              return;
            }
            // SOME VACUUMS STARTED AND SOME DID NOT: keep only the areas of the
            // ones that failed, so a retry does not re-send the robots already
            // cleaning. A refusal or an unreachable Home Assistant keeps it all.
            if (res.ok && r.failed && r.failed.length && r.plan) {
              var bad = {};
              r.failed.forEach(function (f) { bad[f.vacuum] = true; });
              var keep = [];
              r.plan.forEach(function (step) {
                if (bad[step.vacuum]) keep = keep.concat(step.areas || []);
              });
              self._sel.clear(); keep.forEach(function (a) { if (areas.indexOf(a) !== -1) self._sel.add(a); });
            }
            // Home Assistant's own refusal (res.error), else the service's answer.
            self._setStatus('failed', r.message || res.error ||
                            'Could not reach Home Assistant. Tap to retry.');
            self._render();
          });
        }
      };
    }

    // what the shell and the later parts use of this one
    K.areaPicking = areaPicking; K.feed = feed; K.NO_HELPERS = NO_HELPERS; K.PICKED = PICKED; K.picked = picked;
  };
})();
