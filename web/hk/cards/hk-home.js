// hk-home.js -- household controls: vacuums, area select, timers
//
// hk-vacuum-card, hk-area-select-card, hk-timers-card, hk-timer-new-card,
// hk-timers-page-card, hk-timer-strip-card.
//
// One file per family of cards, so each file's name says what is in it.
// Shared pieces -- HkBase, the editor helpers, register(), create(), the
// snapshot cache -- come from hk-base.js through window.hkCards.
(function () {
  'use strict';

  // hk-base.js is a Lovelace resource fetched in PARALLEL with this one, so
  // wait for its ready EVENT (never poll: rAF does not fire in a hidden tab,
  // and a tablet behind the screensaver would define nothing -- see
  // hk-base.js).
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-home] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
    var setting = C.setting;
  if (window.hkHome) return;                  // double-load guard
  var HkBase = C.HkBase, M = C.M, register = C.register, firstOf = C.firstOf,
      wireEditor = C.wireEditor, firstOfDomain = C.firstOf,
      HK_LABELS = C.LABELS, create = C.create, SELECTED_BG = C.SELECTED_BG,
      SELECTED_TEXT = C.SELECTED_TEXT, esc = C.esc, button = C.button;

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

  // --------------------------------------------------------- hk-vacuum
  //
  // One vacuum: a live glyph, its name, a row of small chips, and four
  // commands. Not custom:mushroom-vacuum-card, which is a fine card and
  // completely wrong here -- dark slab, its own type scale, its own icon
  // set, and four equal-width grey bars for the commands. Beside the rest of
  // this dashboard it reads as a different application.
  //
  // THE CHIP ROW IS THE REASON THIS CARD EXISTS: without it a stuck vacuum
  // looks exactly like a docked one. Each chip is a fact you would otherwise have to
  // open the more-info dialog to learn.
  class HkVacuumCard extends areaPicking(HkBase) {
    static get CSS() {
      return [
        // 188px, not 200, and row-gap 10 rather than 14. A page that stacks
        // three vacuums one per room section at 200/14 puts the
        // third card ~40px below the fold of an 800px tablet -- a page
        // with exactly three things on it that you still have to scroll. The
        // content needs 52 (glyph) + 26 (chips) + 52 (buttons) + two gaps + 32
        // of padding = 182, so this keeps 6px of slack. DO NOT go below 182.
        //
        // A MINIMUM, NOT A HEIGHT: an error chip ("unable to
        // complete operation") wraps the chips to a second line on a phone,
        // and at a fixed 188 the four buttons would be pushed out of the card
        // and cut off. Every ordinary card is exactly 188; one
        // with more to say grows.
        'hk-plate.vac{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;min-height:188px;  border-radius:' + window.hkCards.M.radius + ';padding:16px 18px;overflow:hidden;cursor:pointer;  ' + window.hkCards.M.glass + ';',
        '  border:' + window.hkCards.M.border + ';  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-tall') + ');  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
        // THE VACUUM DRAWN (2026-11-09, the owner: "should we use these new card setup on the Vacuums page as well? ... room selection on the
        // card itself isn't needed", the mockup approved): the drawing at the left (hk-vacuum-art.js, 112 wide: 78 + 14 + 56 + 32 of padding
        // keeps the 188), the name, what it is doing (red when it needs someone) and one line -- where, how far, the battery; under them one row
        // of 56 px keys: Clean (Pause while it runs, Resume when paused) white and wide, Locate and Dock round. The rooms stay in Clean Areas
        (window.hkVacuumArt ? window.hkVacuumArt.CSS : '') + '.vac .vt{display:flex;align-items:center;gap:16px;min-width:0}',
        '.vac .art{width:112px;flex:none}.vac .vtx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
        '.vac .label{min-width:0;overflow:hidden;font-size:18px;font-weight:600;line-height:24px;color:' + window.hkCards.v('ink') + ';white-space:nowrap;text-overflow:ellipsis}',
        '.vac .vst{font-size:15px;font-weight:600;line-height:20px;color:' + window.hkCards.ACCENTS.mint + '}.vac .vst.idle{color:' + window.hkCards.v('ink-2') + '}.vac .vst.err{color:' + window.hkCards.ACCENTS.red + '}',
        '.vac .meta{font-size:13px;line-height:17px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
        '.vac .vk{display:flex;gap:10px}.vac .cmd{all:unset;box-sizing:border-box;height:56px;min-width:56px;border-radius:28px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;',
        '  background:' + window.hkCards.v('key') + ';color:' + window.hkCards.v('ink') + ';font-family:inherit;font-size:17px;font-weight:600;transition:transform .12s ease}',
        '.vac .cmd.go{flex:1 1 auto;min-width:0;padding:0 14px;background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}.vac .cmd:active{transform:scale(0.97)}',
        '.vac .cmd.clr{flex:none;padding:0 20px;font-size:17px}.vac .cmd[hidden]{display:none}.vac .cmd:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}.vac .cmd hk-icon{width:22px;height:22px;--mdc-icon-size:22px;flex:none;display:flex;align-items:center;justify-content:center}',
        // (a flex box, as a tile's well glyph is -- hk-base.js: under Home Assistant the glyph is an inline child on a line box,
        // its half-leading pushing it low in the key; the owner, 2026-11-10: Clean, Locate and Dock off center in HK Frontend)
        '@media (prefers-reduced-motion:reduce){  .vac .cmd,.vac .cmd:active{transition:none;transform:none}}',
        // ON A HOME GRID (the `vacuum` block; redrawn as a widget, 2026-10-31,
        // the owner: "big Clean / Dock keys", the mock-up's Vacuum): built
        // round what a vacuum is for -- what it is doing and its battery, one
        // big Clean (Pause while it runs, Resume when paused) where a thumb is
        // and Dock beside it. Large and Extra Large add the rooms to clean as
        // tiles to tick, the Clean key saying how many (areaPicking, Clean
        // Areas); Extra Large draws the battery as a ring beside them. Its
        // own markup (_renderBlock), not the page card's: a page keeps that.
        // Tile cells (196 x 150) first, a square cell's sizes after.
        ':host([size]){display:block;height:100%}',
        'hk-plate.vb{box-sizing:border-box;height:100%;display:flex;flex-direction:column;padding:' + C.blockPad(C.CARD.pad) + ';' + C.plate('card') + ';',
        '  overflow:hidden;cursor:pointer;color:' + C.v('ink') + ';-webkit-tap-highlight-color:transparent;--vb-key:44px}',
        // THE HEADING (2026-11-08, the owner: titles "all need to match"; "if the card's name is printed on the card..." it stays here, as it names the vacuum): the vacuum's name on the one heading row, no glyph; the battery at its right on Small
        C.headRowCss('.vb .hd') + C.headCss('.vb .nm'),
                '.vb .rt{display:flex;flex-direction:column;min-width:0}',
        '.vb .sub{display:block;min-width:0;font-size:15px;font-weight:400;line-height:1.3;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.vb[data-s=S] .sub{' + C.typeCss('caption') + '}',
        '.vb .sub.two{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
        '.vb .warn{color:' + C.ACCENTS.orange + '}.vb .bad,.vb .err{color:' + C.ACCENTS.red + '}.vb .good{color:' + C.ACCENTS.green + '}',
        '.vb .big{font-size:34px;font-weight:300;letter-spacing:-0.02em;line-height:1.05;font-variant-numeric:tabular-nums;margin-top:2px}',
        C.headCss('.vb .lab') + '.vb .lab{display:block;flex:none;height:16px;padding:1.5px 0;margin:10px 0 8px}',
        '.vb .note{' + C.typeCss('caption') + ';line-height:1.3;color:' + C.v('ink-2') + ';margin-top:6px}',
        // the status of a clean just sent, in place of the line it is about
        '.vb .hk-status:empty{display:none}.vb .hk-status{' + C.typeCss('caption') + ';line-height:1.3;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.vb .hk-status[data-kind=failed]{color:' + C.v('fail') + '}.vb .hk-status[data-kind=warn]{color:' + C.v('warn') + '}',
        '.vb .rt:has(.hk-status:not(:empty)) .sub{display:none}',
        // THE KEYS at the foot: Clean (white, as a selected key is) taking the room, Dock round beside it
        '.vb .keys{display:flex;gap:10px;margin-top:auto;padding-top:10px;flex:none}',
        '.vb .key{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;flex:none;height:var(--vb-key);min-width:var(--vb-key);',
        '  --vb-r:calc(var(--vb-key) / 2);border-radius:var(--vb-r);background:' + C.v('key-strong') + ';color:' + C.v('ink') + ';font-family:inherit;' + C.typeCss('headline') + ';white-space:nowrap;cursor:pointer}',
        '.vb .key>span{min-width:0;overflow:hidden;text-overflow:ellipsis}',
        '.vb .key.go{flex:1 1 auto;min-width:0;padding:0 10px;background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}',
        // (TALL'S KEYS, 2026-11-08, the owner: nothing stretches -- Clean is as wide as its word, Dock round beside it, the pair centered)
        // (TALL'S KEYS, 2026-11-09, the owner: "The clean and home button need to fill out to match the width of the All Rooms button above it":
        // Clean takes the row's width less the round 56 px Dock and 8 px clear, both 56 tall, at either cell shape)
        '.vb[data-s=T]{--vb-key:56px}.vb[data-s=T] .keys{gap:8px}.vb[data-s=T] .key.go{padding:0 8px}.vb[data-s=T] .key.go hk-icon{display:none}',
        // (the state in words where there is no ring to hold it: no battery and not cleaning, 2026-11-09)
        '.vb .none{text-align:center}.vb .none b{display:block;font-size:22px;font-weight:500;line-height:1.2}',
        '.vb .key hk-icon{flex:none;width:22px;height:22px;--mdc-icon-size:22px;display:flex;align-items:center;justify-content:center}',
        '.vb .key[aria-disabled=true]{opacity:.45;pointer-events:none}',
        '.vb .key:active,.vb .vr:active{transform:scale(0.97)}.vb .key:focus-visible,.vb .vr:focus-visible{outline:2px solid ' + C.v('ink-2') + ';outline-offset:2px}',
        // WIDE: the vacuum and its battery large on the left, the two keys stacked on the right
        '.vb[data-s=W]{flex-direction:row;gap:16px}',
        // (2026-11-09, the owner: "the clean, rooms, and home button area should be wider ... its too squished": the vacuum drawn in two fifths
        // at the left -- its name, the drawing in what is left, what it is doing -- and the keys the rest)
        '.vb[data-s=W] .col{display:flex;flex-direction:column;min-width:0;flex:0 0 40%}.vb[data-s=W] .art{flex:1 1 0;min-height:0;width:100%;margin:2px 0;display:flex}',
        '.vb[data-s=W] .art .hkva{height:100%;width:auto;max-width:100%}.vb[data-s=W] .side{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;gap:8px}',
        '.vb[data-s=W] .side .key{flex:none;width:100%;--vb-key:48px}',
        // THE ROOMS, two across, each a row of its own size (48 px; nothing stretches, 2026-11-08, the owner: "do the rooms scroll in the card if there
        // are more than what the card allows? If not, it should"): as many as the block holds, the rest scrolling (a cut row says so); few
        // rooms stay under their label (data-fit: _fitRooms)
        '.vb .rooms{display:grid;grid-template-columns:repeat(2,var(--vb-cw));justify-content:center;grid-auto-rows:48px;gap:8px;align-content:start;flex:1 1 auto;min-height:0;margin-top:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-x pan-y;scrollbar-width:none}',
        '.vb .rooms::-webkit-scrollbar{display:none}.vb .rooms[data-fit]{align-content:start}',
        // ...and no stretching across the width (2026-11-08): a room is --vb-cw wide (176 on Large, 170 on Extra Large -- two across and the gap
        // nearly fill the column), the label, grid and keys one column of that width, centered in what the block's column leaves
        '.vb[data-s=L]{--vb-cw:176px}.vb[data-s=XL]{--vb-cw:170px}.vb[data-r] :is(.lab,.rooms,.keys){width:calc(var(--vb-cw) * 2 + 8px);align-self:center;box-sizing:border-box}',
        // TALL AND WIDE with rooms on offer: the Rooms key opens the sheet that picks them, and says what is picked ("Kitchen, Office", "3 rooms")
        // (56 px, 2026-11-09: the "All rooms" row was 44 while the block's other keys are 56 -- a 56 px touch target)
        '.vb .rrow{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:none;height:56px;padding:0 8px 0 14px;margin-top:10px;border-radius:28px;background:' + C.v('key') + ';color:' + C.v('ink-2') + ';font-family:inherit;' + C.typeCss('caption') + ';cursor:pointer}',
        '.vb .rrow>span{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vb .rrow.on{color:' + C.v('ink') + ';font-weight:600}.vb .rrow hk-icon{flex:none;width:20px;height:20px;--mdc-icon-size:20px}.vb .rrow:active{transform:scale(0.98)}.vb .rrow:focus-visible{outline:2px solid ' + C.v('ink-2') + ';outline-offset:2px}',
        '.vb .pair{display:flex;gap:8px}.vb .pair .key.rm{flex:1 1 0;min-width:0;padding:0 8px;font-size:15px}.vb .pair .key.rm.on{font-weight:700}.vb .side .pair .key.dk{width:auto}.vb .pair .key.rm hk-icon{display:none}.vb .rm-note{display:block;' + C.typeCss('caption') + ';font-weight:600;color:' + C.v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.vb .vr{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;padding:0 10px;cursor:pointer;  border-radius:var(--hk-inner-radius, 12px);background:' + C.v('key') + ';color:' + C.v('ink') + ';font-family:inherit;font-size:13px;font-weight:600}',
        '.vb .vr>span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vb .vr hk-icon{flex:none;width:16px;height:16px;--mdc-icon-size:16px}',
        '.vb .vr[aria-pressed=true]{background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}',
        // EXTRA LARGE: the vacuum, its battery as a ring and its last run on the left; the rooms on the right
        '.vb[data-s=XL]{flex-direction:row;gap:22px}',
        // (the ring in the middle of what its column has left, the last run at the foot, level with the keys)
        '.vb[data-s=XL] .lcol{flex:0 0 200px;display:flex;flex-direction:column;min-width:0}',
        '.vb[data-s=XL] .lcol :is(.art,.none){margin-top:auto;margin-bottom:auto}',
        '.vb[data-s=XL] .lcol .rt{min-height:var(--vb-key);justify-content:flex-end}',
        '.vb[data-s=XL] .rcol{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}',
        '.vb[data-s=XL] .rcol .lab{margin-top:0}',
        '.vb[data-s=XL] .key.dk{padding:0 18px}',
        // LARGE WITH ROOMS (2026-11-10): Extra Large's two columns -- the vacuum in two fifths at the left, its words at the foot level
        // with the keys; the rooms one to a row down the right, as wide as the column, scrolling past what the block holds
        '.vb[data-s=L][data-r]{flex-direction:row;gap:16px}',
        '.vb[data-s=L][data-r] .lcol{flex:0 0 40%;display:flex;flex-direction:column;min-width:0}',
        '.vb[data-s=L][data-r] .lcol .art{flex:1 1 0;min-height:0;margin:4px 0;display:flex;align-items:center;justify-content:center}',
        '.vb[data-s=L][data-r] .lcol .art .hkva{max-height:100%;width:100%}',
        '.vb[data-s=L][data-r] .lcol .rt{min-height:var(--vb-key);justify-content:flex-end}.vb[data-s=L] .state{font-size:17px}',
        '.vb[data-s=L][data-r] .rcol{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}',
        '.vb[data-s=L][data-r] .rcol .lab{margin-top:0}',
        '.vb[data-s=L][data-r] :is(.lab,.rooms,.keys){width:100%}',
        '.vb[data-s=L] .rooms{grid-template-columns:minmax(0,1fr);grid-auto-rows:44px}.vb[data-s=L] .vr{justify-content:flex-start;padding:0 14px;font-size:15px}',
        // (no rooms: the drawing as large as the block leaves it, centered)
        '.vb[data-s=L]:not([data-r]) .mid .art{width:auto;height:100%;max-width:100%;margin:0 auto;display:flex;justify-content:center}.vb[data-s=L]:not([data-r]) .mid .hkva{height:100%;width:auto;max-width:100%}',
        // THE VACUUM DRAWN IN PLACE OF THE BATTERY RING (2026-11-09, hk-vacuum-art.js; the battery is in the line under what it is doing):
        // Extra Large's in the middle of its column, Tall's as big as --vb-r (what the block leaves) lets it, centered
        (window.hkVacuumArt ? window.hkVacuumArt.CSS : '') + '.vb .art{flex:none;width:100%;margin:6px auto}.vb .state{font-size:22px;font-weight:600;line-height:1.2}',
        '.vb[data-s=T] .art{width:min(100%,calc(var(--vb-r,96px) * 1.43))}.vb[data-s=W] .state{font-size:17px}',
        // (a Large or Extra Large block with no rooms to offer: the battery large in the middle)
        '.vb .mid{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;min-height:0}',
        // ON A SQUARE CELL (196 x 196): the mock-up's sizes
        '@container hk-cell (min-height:180px) or style(--hk-cell-shape: square){  hk-plate.vb{--vb-key:48px}  .vb .big{font-size:36px}  .vb .keys{padding-top:12px}',
        '  .vb .lab{margin-top:12px}  .vb[data-s=W] .side{gap:10px}  .vb[data-s=W] .side .key{--vb-key:56px;font-size:17px}',
        '}'
      ].join('');
    }

    setConfig(config) {
      if (!config || !config.entity) throw new Error('hk-vacuum: `entity` is required');
      super.setConfig(config);
    }
    // (the rooms ticked on a Large or Extra Large block: this element's alone, areaPicking)
    _onConfig() { this._sel = picked(this._config.entity); }
    getCardSize() { return 3; }
    // (a block's tap, hk-base.js openTarget; When Tapped chooses) the Vacuums page, else this vacuum's sheet
    _tapTarget() { var id = (this._config || {}).entity; return [{ page: 'vacuums' }, id && { sheet: id }]; }

    // The card reads four sensors its `entity` does not name -- and the
    // vacuum's own attributes (battery_level), so last_updated, not state:
    // a battery that charges while the vacuum stays `docked` must redraw.
    // A block also draws by its size, the rooms offered and how long ago it
    // last ran (to ten minutes).
    _sigOf() {
      var h = this.client, c = this._config;
      if (!h || !c) return null;
      var art = window.hkVacuumArt ? window.hkVacuumArt.ids(h, c.entity, c) : {};   // (the drawing's error and charge state)
      var ids = [c.entity, this._sib('battery'), c.error, c.dock_error, c.room, this._sib('progress'), art.error, art.charge, art.latch]
                  .filter(Boolean);
      var out = '';
      for (var i = 0; i < ids.length; i++) {
        var s = h.states[ids[i]];
        out += ids[i] + '=' + (s ? s.last_updated : 'x') + ';';
      }
      if (this._cellSize()) {
        out += '|' + this._cellSize() + '|' + (this._blockKey || '') + '|' + this._picker() + '|' + !!this._offer + '|' +
          this._areaSig() + '|' + Math.floor(Date.now() / 600000);
      }
      return out;
    }
    // Rooms to offer: Clean Areas added, or the house's own cleaning script
    // named (as the Vacuums page decides, hk-strategy.js)
    _picker() {
      var HS = window.hkSettings, added = (HS && HS.get && HS.get('added', [])) || [];
      return added.indexOf('clean_areas') >= 0 || !!(HS && HS.get && HS.get('features.vacuum_script', null));
    }

    // THE READINGS ON THE SAME DEVICE (2026-11-09): a Home Grid block is made with the vacuum's id alone, where the Vacuums page's
    // card is handed its battery and progress sensors (hk-strategy.js sibling/siblingLike). A block finds them the same way:
    // a sensor on the vacuum's device with device_class battery, or an id with cleaning_progress. The vacuum's own
    // `battery_level` attribute comes first, in _chips.
    _sib(kind) {
      var c = this._config, h = this.client, ents = h && h.entities;
      if (c[kind]) return c[kind];
      if (!ents || !c.entity) return null;
      var memo = this._sibs && this._sibs.id === c.entity ? this._sibs : (this._sibs = { id: c.entity });
      if (kind in memo) return memo[kind];
      var dev = ents[c.entity] && ents[c.entity].device_id, hit = null;
      if (dev) {
        hit = Object.keys(ents).filter(function (k) {
          var st = h.states[k];
          return k !== c.entity && ents[k].device_id === dev && k.indexOf('sensor.') === 0 && st &&
            (kind === 'battery' ? st.attributes && st.attributes.device_class === 'battery' : /cleaning_progress/.test(k));
        }).sort()[0] || null;
      }
      return (memo[kind] = hit);
    }

    _v(id) {
      var s = id && this._st(id);
      return s ? s.state : undefined;
    }

    // The three different ways these integrations spell "fine".
    static get OK_ERRORS() { return ['no_error', 'none', 'ok', 'unknown', 'unavailable', '']; }

    _chips(st) {
      var cfg = this._config, out = [];
      var state = (st && st.state) || 'unknown';
      var a = (st && st.attributes) || {};

      out.push({ t: C.sentenceCase(String(state).replace(/_/g, ' ')) });

      var b = a.battery_level;
      if (b == null && this._sib('battery')) b = this._v(this._sib('battery'));
      var bn = Number(b);
      if (b != null && b !== 'unknown' && b !== 'unavailable' && isFinite(bn)) {
        // Colour the battery the way the Home app does: only shout when it is low.
        out.push({ t: Math.round(bn) + '%', k: 'battery', n: bn,
                   c: bn <= 20 ? 'bad' : (bn <= 40 ? 'warn' : '') });
      }

      // Only while it is actually working: a room and a percentage next to a
      // docked vacuum are last run's numbers and read as if it were running.
      if (state === 'cleaning' || state === 'returning') {
        var room = this._v(cfg.room);
        if (room && room !== 'unknown' && room !== 'unavailable') out.push({ t: room });
        var pr = Number(this._v(this._sib('progress')));
        if (isFinite(pr) && pr > 0) out.push({ t: Math.round(pr) + '% done', c: 'good' });
      }

      // Errors LAST, so they read as the exception.
      var OK = HkVacuumCard.OK_ERRORS;
      [cfg.error, cfg.dock_error].forEach(function (id) {
        var e = this._v(id);
        if (e && OK.indexOf(e) === -1) {
          out.push({ t: '⚠ ' + String(e).replace(/_/g, ' '), c: 'err' });
        }
      }, this);
      return out;
    }

    _render() {
      var cfg = this._config;
      var sized = this._cellSize();
      if (sized) { this._renderBlock(sized); return; }
      if (!this._built) {
        var cmds = HkVacuumCard.COMMANDS, self = this;
        this._root.innerHTML = '<hk-plate class="vac" data-hk-role="card"><div class="vt"><div class="art"></div><div class="vtx"><b class="label" data-hk-role="label"></b>' +
          '<span class="vst"></span><span class="meta" data-hk-role="meta"></span></div></div><div class="vk">' + cmds.map(function (c) {
            return '<button type="button" class="cmd' + (c[0] === 'go' ? ' go' : '') + '" data-hk-role="' + c[0] + '" data-svc="' + c[2] + '" aria-label="' + c[3] + '">' +
              '<hk-icon icon="' + c[1] + '"></hk-icon>' + (c[0] === 'go' ? '<span></span>' : '') + '</button>';
          }).join('').replace('</button>', '</button><button type="button" class="cmd clr" data-clear hidden>Clear</button>') + '</div></hk-plate>';
        var q = this._root.querySelector.bind(this._root);
        this._e = { card: q('.vac'), art: q('.art'), label: q('.label'), vst: q('.vst'), meta: q('.meta'), go: q('.cmd.go'), clr: q('.cmd.clr') };
        this._root.querySelectorAll('.cmd').forEach(function (b) {
          b.addEventListener('click', function (ev) {
            ev.stopPropagation();                      // (the card's tap opens the vacuum; a key only does its own)
            if (b.hasAttribute('data-clear')) self._clearWater();
            else if (self.client) self._call('vacuum', b.getAttribute('data-svc'), { entity_id: self._config.entity });
          });
        });
        this._bind(this._e.card, 'tap_action', null);
        this._built = true;
      }
      var e = this._e, st = this._st(cfg.entity), state = (st && st.state) || 'unknown';
      var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
      if (e.label.textContent !== nm) e.label.textContent = nm;
      var lk = window.hkVacuumArt ? window.hkVacuumArt.look(this.client, cfg.entity, cfg) : { state: 'idle', words: C.sentenceCase(state.replace(/_/g, ' ')) };
      if (e.art.__s !== lk.state + lk.words) { e.art.__s = lk.state + lk.words; e.art.innerHTML = window.hkVacuumArt ? window.hkVacuumArt.html(lk.state, nm + ', ' + lk.words) : ''; }
      // (Mantel is holding a water tank report: Clear beside Clean, in the row of keys -- it is the same 56 px capsule as the others)
      e.clr.hidden = !lk.latched; e.clr.setAttribute('aria-label', 'Clear the water tank report for ' + nm);
      e.vst.textContent = lk.words; e.vst.className = 'vst' + (/^(water|error)$/.test(lk.state) ? ' err' : /^(docked|idle)$/.test(lk.state) ? ' idle' : '');
      // (the line: where it is and how far, the battery -- the state is said above it, an error in its color there)
      var chips = this._chips(st).slice(1).filter(function (c) { return c.c !== 'err'; });
      e.meta.textContent = chips.map(function (c) { return c.t; }).join(' \u00B7 ');
      var go = state === 'cleaning' ? ['pause', 'mdi:pause', 'Pause'] : state === 'paused' ? ['start', 'mdi:play', 'Resume'] : ['start', 'mdi:play', 'Clean'];
      e.go.setAttribute('data-svc', go[0]); e.go.setAttribute('aria-label', go[2] + ' ' + nm);
      e.go.querySelector('hk-icon').setAttribute('icon', go[1]); e.go.querySelector('span').textContent = go[2];
    }

    // ---- THE BLOCK (see the CSS): drawn whole each time and morphed in, so
    // a tap's focus and the rooms' scroll survive a state push
    _renderBlock(sz) {
      var cfg = this._config, esc = C.esc, self = this;
      this._built = false;                       // (the page's markup, if the block ever leaves the grid)
      this._watchBlock();
      var st = this._st(cfg.entity), state = (st && st.state) || 'unknown', a = (st && st.attributes) || {};
      var nm = cfg.name || a.friendly_name || cfg.entity;
      var chips = this._chips(st), bat = chips.filter(function (c) { return c.k === 'battery'; })[0];
      // THE WATER TANK HELD (hk-vacuum-art.js latch): Small and Large say so in their line; the larger blocks draw it and offer Clear
      var lk = window.hkVacuumArt ? window.hkVacuumArt.look(this.client, cfg.entity, cfg) : { state: 'idle', words: C.sentenceCase(state.replace(/_/g, ' ')) };
      var wline = lk.latched && lk.state === 'water' && !chips.some(function (c) { return c.c === 'err'; }) ? lk.words : '';
      if (sz === 'L' && wline) chips.push({ t: wline, c: 'err' });
      var clr = lk.latched && /^(XL|T|W)$/.test(sz) ? window.hkVacuumArt.clearPill(nm) : '';
      var words = function (list) {
        return list.map(function (c) { return c.c ? '<span class="' + c.c + '">' + esc(c.t) + '</span>' : esc(c.t); }).join(' \u00B7 ');
      };
      var rest = chips.filter(function (c) { return c.k !== 'battery'; });
      var faulty = rest.some(function (c) { return c.c === 'err'; }) || state === 'error';
      // HOW LONG SINCE IT LAST RAN: since it docked (the state's last change).
      // A restart of the house also sets that, so it is a floor, not a log.
      var since = '';
      if ((state === 'docked' || state === 'idle') && st && st.last_changed) {
        var m = Math.round((Date.now() - Date.parse(st.last_changed)) / 60000);
        since = !(m >= 1) ? '' : m < 60 ? m + ' min' : m < 48 * 60 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' days';
      }
      // (the state line's "Ran 31 min ago", Wide and Large and Tall; Extra Large says "Last run" in its own words)
      var ran = since ? ' \u00B7 Ran ' + esc(since) + ' ago' : '';
      // (...after what the line already says, else on its own: no " · Ran" opening an empty line -- a vacuum with no battery, 2026-11-10)
      var after = function (said) { return said ? said + ran : ran.replace(/^ \u00B7 /, ''); };
      // THE ROOMS (Large up, with Clean Areas or the house's script)
      var big = sz === 'L' || sz === 'XL', roomsOn = sz !== 'S' && this._picker();
      this._auto = roomsOn;
      if (roomsOn) this._subAreas();
      var floors = roomsOn ? this._floors() : null;
      this._keepOffered(floors);
      var n = roomsOn ? this._sel.size : 0;
      // THE KEYS: Clean (Pause while it runs, Resume when paused; with rooms
      // ticked, "Clean 2 rooms") and Dock
      var go = state === 'cleaning' ? ['pause', 'mdi:pause', 'Pause'] : state === 'paused' ? ['start', 'mdi:play', 'Resume']
        : n ? ['rooms', 'mdi:play', big ? 'Clean ' + n + (n === 1 ? ' room' : ' rooms') : 'Clean'] : ['start', 'mdi:play', 'Clean'];
      if (this._busy) go = ['', 'mdi:play', 'Sending…'];
      var key = function (k, cls, words) {
        return '<button type="button" class="key ' + cls + '" data-svc="' + k[0] + '" aria-label="' + esc(k[2] + ' ' + nm) + '"' +
          (k[0] ? '' : ' aria-disabled="true"') + '><hk-icon icon="' + k[1] + '"></hk-icon>' + (words ? '<span>' + esc(k[2]) + '</span>' : '') + '</button>';
      };
      var dock = ['return_to_base', 'mdi:home', 'Dock'];
      var status = this._hkStatus, stNode = '<div class="hk-status" role="status" aria-live="polite"' +
        (status ? ' data-kind="' + esc(status.kind) + '">' + esc(status.text) : '>') + '</div>';
      var rooms = '', list = floors ? floors.reduce(function (o, f) { return o.concat(f.areas || []); }, []) : null, chosen = list ? list.filter(function (r) { return self._sel.has(r.id); }).map(function (r) { return r.name; }) : [];
      if (roomsOn && big) {
        rooms = '<b class="lab">Rooms</b>' + (list === null ? '<div class="note">Reading the rooms…</div>'
          : !list.length ? '<div class="note">No room can be cleaned by area yet.</div>'
          : '<div class="rooms" role="group" aria-label="Rooms to clean">' + list.map(function (r) {
              var on = self._sel.has(r.id);
              return '<button type="button" class="vr" data-area="' + esc(r.id) + '" aria-pressed="' + on + '">' +
                (on ? '<hk-icon icon="mdi:check"></hk-icon>' : '') + '<span>' + esc(r.name) + '</span></button>';
            }).join('') + '</div>');
      }
      // (Tall and Wide: the rooms picked in a sheet, named where they are picked -- one or two by name, more by count -- only while it can start a clean, and not beside a Clear pill: three targets at most)
      var pickable = (sz === 'T' || sz === 'W') && roomsOn && list && list.length && !/^(cleaning|returning|paused)$/.test(state) && !clr, said = chosen.length > 2 ? chosen.length + ' rooms' : chosen.join(', ');
      var rkey = pickable ? (sz === 'T' ? '<button type="button" class="rrow' + (said ? ' on' : '') + '" data-rooms aria-label="' + (said ? 'Rooms to clean: ' + esc(chosen.join(', ')) + '. Change' : 'Rooms to clean: the whole house. Choose') +
          '"><span>' + (said ? esc(said) : 'All rooms') + '</span><hk-icon icon="mdi:chevron-right"></hk-icon></button>'
        : '<button type="button" class="key rm' + (said ? ' on' : '') + '" data-rooms aria-label="Choose rooms to clean' + (said ? ': ' + esc(chosen.join(', ')) : '') + '"><hk-icon icon="mdi:floor-plan"></hk-icon><span>' + (chosen.length ? chosen.length + (chosen.length === 1 ? ' room' : ' rooms') : 'Rooms') + '</span></button>') : '';
      // THE VACUUM DRAWN (Extra Large, Tall, Wide; hk-vacuum-art.js) and what it is doing in words under it, the battery in the line after
      var art = window.hkVacuumArt ? '<div class="art">' + window.hkVacuumArt.html(lk.state, nm + ', ' + lk.words) + '</div>' : '';
      var subw = (bat ? [bat] : []).concat(rest.slice(1)), what = '<b class="state">' + esc(lk.words) + '</b>' + clr;
      var html;
      if (sz === 'S') {
        html = '<div class="hd"><b class="nm">' + esc(nm) + '</b></div>' +
          '<span class="sub' + (wline ? ' two' : '') + '">' + (wline ? '<span class="err">' + esc(wline) + '</span><br>' : '') +
          (bat ? '<span class="' + bat.c + '">' + esc(bat.t) + '</span> \u00B7 ' : '') + words(rest) + '</span>' +
          '<div class="keys">' + key(go, 'go', true) + '</div>';
      } else if (sz === 'W') {
        // (Wide's Clear beside Dock, where the rooms key was -- under the words it squeezed the drawing to a speck, 2026-11-09)
        var wclr = clr ? '<button type="button" class="key rm" data-clear aria-label="Clear the water tank report for ' + esc(nm) + '"><span>Clear</span></button>' : '';
        html = '<div class="col"><div class="hd"><b class="nm">' + esc(nm) + '</b></div>' + art + what.replace(clr, '') +
          '<span class="sub">' + (said ? words(subw) + '</span><span class="rm-note">' + esc(chosen.join(', ')) : after(words(subw))) + '</span></div>' +
          '<div class="side">' + key(go, 'go', true) + (pickable || wclr ? '<div class="pair">' + (wclr || rkey) + key(dock, 'dk', false) + '</div>' : key(dock, 'dk', true)) + '</div>';
      } else if (sz === 'T') {
        var bk = this._block(), more = rest.slice(1);
        html = '<div class="hd"><b class="nm">' + esc(nm) + '</b></div>' +
          '<div class="mid" style="--vb-r:' + (bk ? Math.max(72, Math.min(120, bk.h - (pickable ? 286 : 234))) : 96) + 'px">' + art + '</div>' +
          '<div class="rt">' + stNode + what + '<span class="sub two">' + after(words((bat ? [bat] : []).concat(more))) + '</span></div>' + rkey +
          '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', false) + '</div>';
      } else if (sz === 'XL') {
        var run = [since ? 'Last run ' + since + ' ago' : ''];
        // (how much it cleaned and how long, where the vacuum says: older Xiaomi and Roborock integrations do)
        if (isFinite(Number(a.cleaned_area)) && isFinite(Number(a.cleaning_time)) && a.cleaned_area != null && a.cleaning_time != null) {
          run.push(Math.round(Number(a.cleaned_area)) + ' m\u00B2 in ' + Math.round(Number(a.cleaning_time)) + ' min');
        }
        var left = '<div class="hd"><b class="nm">' + esc(nm) + '</b></div>' + art +
          '<div class="rt">' + stNode + what + '<span class="sub two">' + (subw.length ? words(subw) + '<br>' : '') +
          esc(run.filter(Boolean).join('\n')).replace(/\n/g, '<br>') + '</span></div>';
        html = '<div class="lcol">' + left + (roomsOn ? '' : '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', true) + '</div>') + '</div>' +
          (roomsOn ? '<div class="rcol">' + rooms + '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', true) + '</div></div>' : '');
      } else {
        // LARGE (2026-11-10, the owner: "show the new animated vacuum, but still have some room selection ... a vertical scroll
        // list"): Extra Large's shape in less room -- the vacuum drawn, what it is doing and its battery on the left; the rooms a
        // list down the right that scrolls, Clean and Dock under it. No rooms on offer: the drawing in the middle over the keys
        var say = '<div class="rt">' + stNode + what + '<span class="sub two">' + after(words(subw)) + '</span></div>';
        html = roomsOn
          ? '<div class="lcol"><div class="hd"><b class="nm">' + esc(nm) + '</b></div>' + art + say + '</div>' +
            '<div class="rcol">' + rooms + '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', false) + '</div></div>'
          : '<div class="hd"><b class="nm">' + esc(nm) + '</b></div><div class="mid">' + art + '</div>' + say +
            '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', false) + '</div>';
      }
      C.morph(this._root, '<hk-plate class="vb" data-s="' + sz + '"' + (roomsOn && big ? ' data-r' : '') + ' data-hk-role="card">' + html + '</hk-plate>');
      this._fitRooms();
      if (!this._blockTaps) {
        // ONE LISTENER for the block: a room ticks, a key acts, anywhere else opens the vacuum's sheet
        this._blockTaps = true;
        this._root.addEventListener('click', function (e) {
          if (!self._cellSize()) return;            // (the page card's own taps)
          var t = e.target.closest && e.target.closest('[data-svc],[data-area],[data-rooms],[data-clear]');
          e.stopPropagation();
          // (the plate and the battery ring: the block's tap, _tapTarget -- the ring counts as a control to openTarget, so it is asked here)
          if (!t) { if (!e._hkBlockTap) window.hkCards.openTarget(self, self._tapTarget()); return; }
          if (t.hasAttribute('data-clear')) { self._clearWater(); return; }
          if (t.hasAttribute('data-area')) { self._toggle(t.getAttribute('data-area')); return; }
          if (t.hasAttribute('data-rooms')) { self._pickRooms(); return; }
          var svc = t.getAttribute('data-svc');
          if (svc === 'rooms') self._start();
          else if (svc && self.client) self._call('vacuum', svc, { entity_id: self._config.entity });
        });
      }
    }
  }
  // THE ROOMS' ROWS keep their size (48 px) and scroll when the block holds fewer than there are; a few are centered in what is left.
  // Measured after the draw, the keys and the heading taking what they take
  HkVacuumCard.prototype._fitRooms = function () {
    var rm = this._root.querySelector('.rooms');
    if (rm && rm.clientHeight > 0) rm.toggleAttribute('data-fit', rm.scrollHeight <= rm.clientHeight + 1);
  };
  // CLEAR (2026-11-09): Mantel Server holds a water tank report until someone clears it -- from any screen, for everyone (mantel_server/vacuum_water.py)
  HkVacuumCard.prototype._clearWater = function () {
    this._call('script', 'vacuum_water_clear', { vacuum: this._config.entity });
  };
  // THE ROOMS SHEET (Tall and Wide, 2026-11-08): the Vacuums page's own picker (hk-area-select-card, `pick`: this vacuum's rooms, shared with
  // the block) over the page, a Done key in place of Start Cleaning -- the clean is the block's Clean key
  HkVacuumCard.prototype._pickRooms = function () {
    var D = window.hkDetail;
    if (D && D.open) D.open(null, { name: 'Rooms to Clean', icon: 'mdi:floor-plan' },
      { cards: { cards: [{ type: 'custom:hk-area-select-card', layout: 'panel', pick: this._config.entity }] } });
  };
  // grid-area, glyph, vacuum service, aria-label.
  // (the page card's keys: Clean / Pause / Resume, its service set as it draws; Locate; Dock)
  HkVacuumCard.COMMANDS = [
    ['go', 'mdi:play', 'start', 'Clean'],
    ['locate', 'mdi:map-marker', 'locate', 'Locate'],
    ['home', 'mdi:home', 'return_to_base', 'Return to base']
  ];

  // ============================================================ area select
  // Pick rooms, then clean just those.
  //
  // The selection lives in THIS ELEMENT, in a Set -- not in input_boolean
  // helpers. It is not an entity, it is not broadcast, it is not recorded,
  // and two tablets never share one selection. The only thing that reaches
  // Home Assistant is the finished
  // list, once, when Clean is pressed.
  class HkAreaSelectCard extends areaPicking(HkBase) {
    static get CSS() {
      return [
        // THE SAME TRACK AS THE ROOM PILLS on the Play Music page: the same
        // markup, the same `pill` class, and the track every other pill grid
        // uses (hk-base.js TILE).
        //
        // A fixed width would also opt this card out of the responsive track:
        // --hk-track is what css/hk-responsive.css redefines below 640px to
        // reflow a grid to two columns, and a literal width cannot hear it.
        // On a phone this would be the one pill grid that does not reflow.
        '.grid{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));  grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap + 'px;margin:0 0 14px 0}',
        // 40px PILLS, not 70px tiles: the action row matches the area pills
        // above it. Icon-well tiles here would stack two materials on one
        // grid. Play Music's equivalent row -- Clear, Transfer, Browse Music
        // -- is plain pills on the same track as the rooms above it, and this
        // is the same row with the same geometry.
        //
        // The rule below separates them, which is what carries the
        // "these act on the house" meaning that the shape does not.
        '.actions{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));  grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap + 'px;margin:0 0 14px 0}',
        '.floor{font-size:15px;font-weight:600;letter-spacing:-0.2px;  color:' + window.hkCards.v('ink-2') + ';padding:6px 4px 8px 4px}',
        // THE RULE separates two DIFFERENT kinds of thing: the pills above
        // only change a selection, the pills below act on the house. Without
        // it the action row reads as more pills that happen to look odd.
        '.rule{height:1px;margin:6px 4px 16px 4px;padding:0;border:none;  border-radius:0;box-shadow:none;background:' + window.hkCards.v('line') + '}',
        '.empty{font-size:15px;line-height:1.35;color:' + window.hkCards.v('ink-2') + ';padding:4px 4px 16px 4px}',
        // ------------------------------------------------------ THE PANEL
        // `layout: panel` (the Vacuums page, 2026-10-16): the floors on a page
        // card's plate, and what acts on them at its top -- how many are
        // chosen, Clear, Start Cleaning -- so the buttons never scroll away
        // from the count. Start waits for a room.
        '.plate{' + window.hkCards.plate('card') + ';padding:' + window.hkCards.CARD.pad + ';box-sizing:border-box;container-type:inline-size}',
        '.bar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid ' + window.hkCards.v('line') + '}',
        '.bar .n{min-width:0;font-size:13px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.bar .pill{min-width:96px}',
        '.bar .go[aria-pressed="true"] > span{color:' + SELECTED_TEXT + '}',
        '.bar .go[aria-disabled="true"]{opacity:0.45;pointer-events:none}',
        '.plate .floor{padding:0 0 10px 0;font-size:15px}',
        '.plate .grid{margin:0 0 16px 0}',
        '.plate .grid:last-child{margin-bottom:0}',
        '.plate .hk-status{margin:-6px 0 12px 0}',
        '.plate .hk-status:empty{display:none}',
        // narrow (an upright iPad's rail, a phone): the count on a line of
        // its own over the two buttons, and the rooms two across, sharing the width
        '@container (max-width:' + window.hkCards.BP.cardSide + 'px){.bar{grid-template-columns:repeat(2,minmax(0,1fr))}.bar .n{grid-column:1 / -1}  .plate .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
        // a phone: stacked under the vacuum cards, which sit one grid deeper,
        // the plate steps in 4 px a side to share their edges
        '@media (max-width:' + window.hkCards.BP.phone + 'px){.plate{padding:16px;margin:0 4px}}',
        // in a Home Grid block (data-fill): the plate is the block's lower part, and its rooms scroll inside it
        ':host([data-fill]){display:block;height:100%}',
        ':host([data-fill]) .plate{height:100%;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;scrollbar-width:none}',
        ':host([data-fill]) .plate::-webkit-scrollbar{display:none}',
        '.pill:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}'
      ].join('');
    }
    // AUTOMATIC ROOMS: a card whose YAML names
    // no `floors` shows the areas Clean Areas offers -- the ones a vacuum
    // reaches, or those chosen on HK Settings -> Clean by Area -- live
    // (hk_clean_areas/subscribe), grouped by Home Assistant's floors and named
    // by its areas. `floors:` written out still wins.
    _onConfig() {
      this._sel = this._config.pick ? picked(this._config.pick) : new Set();
      this._auto = !Array.isArray(this._config.floors) || !this._config.floors.length;
    }
    // Reads NO entity: everything it draws is the card-local selection, and
    // every change to that calls _render itself. HkBase's default signature has
    // no entity to key on and returns null ("always render"), which would wipe
    // and rebuild every area button on every state push -- measured
    // 120 DOM mutations for 12 updates that changed nothing, on a page with a
    // live camera and vacuums reporting constantly.
    // Automatic, it draws Home Assistant's areas and floors too: their names
    // and floors are the signature (the list itself arrives by subscription).
    _sigOf() {
      if (!this._auto) return 'static';
      this._subAreas();
      return 'auto|' + this._areaSig();
    }

    _render() {
      if (!this._config) return;
      var floors = this._floors();
      var self = this;
      this._keepOffered(floors);
      var n = this._sel ? this._sel.size : 0;
      if (this._config.layout === 'panel') return this._renderPanel(floors, n);
      this._root.innerHTML = '';

      var wrap = document.createElement('div');
      wrap.className = 'floors';
      this._root.appendChild(wrap);
      if (floors && !floors.length) {
        var o = this._offer || {};
        var e = document.createElement('div'); e.className = 'empty';
        e.textContent = (o.missing || o.configured === false) && !this._script()
          ? 'Add HK Clean Areas to clean by area.'
          : 'No room can be cleaned by area yet. Map each vacuum’s rooms in its settings in Home Assistant.';
        wrap.appendChild(e);
      }
      floors = floors || [];

      floors.forEach(function (f) {
        var h = document.createElement('div');
        h.className = 'floor'; h.textContent = f.name;
        wrap.appendChild(h);
        var g = document.createElement('div'); g.className = 'grid';
        (f.areas || []).forEach(function (a) {
          var b = document.createElement('div');
          b.className = 'pill';
          button(b, function () { self._toggle(a.id); });
          b.setAttribute('aria-pressed', self._sel.has(a.id) ? 'true' : 'false');
          var s = document.createElement('span'); s.textContent = a.name;
          b.appendChild(s);
          g.appendChild(b);
        });
        wrap.appendChild(g);
      });

      var rule = document.createElement('div'); rule.className = 'rule';
      this._root.appendChild(rule);

      var acts = document.createElement('div'); acts.className = 'actions';
      // The Start pill counts the selection itself -- a button that says how
      // many rooms it is about to send needs no separate count beside it, and
      // no other confirmation.
      var startPill = this._pill(
        this._busy ? 'Sending…'
                   : (n === 0 ? 'Start Cleaning'
                              : (n === 1 ? 'Clean 1 Area' : 'Clean ' + n + ' Areas')),
        function () { self._start(); });
      // Inert while a submission is in flight. _begin already drops the second
      // tap; this is so the pill does not look tappable while it is.
      if (this._busy) {
        startPill.setAttribute('aria-disabled', 'true');
        startPill.style.opacity = '0.35';
        startPill.style.pointerEvents = 'none';
        startPill.setAttribute('tabindex', '-1');
      }
      acts.appendChild(startPill);
      acts.appendChild(this._pill('Clear', function () { self._clear(); }));
      this._root.appendChild(acts);
      this._root.appendChild(this._statusNode());
    }


    // THE PANEL: the action bar, then each floor's rooms. Focus stays on
    // the room just pressed across the redraw (the selection is the only
    // thing that changes, so the pills are rebuilt in place).
    _renderPanel(floors, n) {
      var self = this;
      var had = this._root.activeElement && this._root.activeElement.getAttribute('data-area');
      var hadGo = this._root.activeElement && this._root.activeElement.classList.contains('go');
      this._root.innerHTML = '';
      var plate = document.createElement('div'); plate.className = 'plate';
      var bar = document.createElement('div'); bar.className = 'bar';
      var cnt = document.createElement('div'); cnt.className = 'n';
      var pk = !!this._config.pick;          // (the vacuum block's Rooms sheet: what is picked is the block's to clean, Done shuts the sheet)
      cnt.textContent = n === 0 ? (pk ? 'None chosen: the whole house' : 'Choose rooms, then start') : n === 1 ? '1 room selected' : n + ' rooms selected';
      cnt.setAttribute('aria-live', 'polite');
      bar.appendChild(cnt);
      var clr = this._pill('Clear', function () { self._clear(); });
      if (!n) { clr.setAttribute('aria-disabled', 'true'); clr.style.opacity = '0.45'; clr.style.pointerEvents = 'none'; clr.setAttribute('tabindex', '-1'); }
      bar.appendChild(clr);
      var go = this._pill(pk ? 'Done' : this._busy ? 'Sending…' : 'Start Cleaning', function () { if (pk) window.hkDetail.close(); else self._start(); });
      go.classList.add('go');
      // THE ONE THAT ACTS, in the selected material once there is something to send
      go.setAttribute('aria-pressed', pk || n && !this._busy ? 'true' : 'false');
      if (!pk && (!n || this._busy)) { go.setAttribute('aria-disabled', 'true'); go.setAttribute('tabindex', '-1'); }
      go.setAttribute('aria-label', pk ? 'Done' : n ? 'Start cleaning ' + n + (n === 1 ? ' room' : ' rooms') : 'Start Cleaning: choose rooms first');
      bar.appendChild(go);
      plate.appendChild(bar);
      plate.appendChild(this._statusNode());
      if (floors && !floors.length) {
        var o = this._offer || {};
        var e = document.createElement('div'); e.className = 'empty';
        e.textContent = (o.missing || o.configured === false) && !this._script()
          ? 'Add HK Clean Areas to clean by area.'
          : 'No room can be cleaned by area yet. Map each vacuum’s rooms in its settings in Home Assistant.';
        plate.appendChild(e);
      }
      var rows = this._config.list ? plate.appendChild(Object.assign(document.createElement('div'), { className: 'rl' })) : plate;   // (`list`: the rows scroll on their own, hk-sheet-vacuum.js)
      (floors || []).forEach(function (f) {
        var hd = document.createElement('div');
        hd.className = 'floor'; hd.textContent = f.name;
        rows.appendChild(hd);
        var g = document.createElement('div'); g.className = 'grid';
        g.setAttribute('role', 'group'); g.setAttribute('aria-label', f.name);
        (f.areas || []).forEach(function (a) {
          var b = document.createElement('div');
          b.className = 'pill';
          button(b, function () { self._toggle(a.id); });
          b.setAttribute('aria-pressed', self._sel.has(a.id) ? 'true' : 'false');
          b.setAttribute('data-area', a.id);
          var sp = document.createElement('span'); sp.textContent = a.name;
          b.appendChild(sp);
          g.appendChild(b);
        });
        rows.appendChild(g);
      });
      this._root.appendChild(plate);
      var back = had ? this._root.querySelector('[data-area="' + had.replace(/"/g, '') + '"]') : hadGo && n ? go : null;
      if (back && back.focus) back.focus();
    }

    // The same markup as hk-speaker-picker-card's `_pill`, down to the
    // aria-pressed="false" -- these never light, they act. Same markup means
    // the two pages' action rows cannot drift apart.
    _pill(text, onclick) {
      var b = document.createElement('div');
      b.className = 'pill';
      button(b, onclick);
      b.setAttribute('aria-pressed', 'false');
      var s = document.createElement('span'); s.textContent = text;
      b.appendChild(s);
      return b;
    }
    getCardSize() { return 6; }
  }

  if (!customElements.get('hk-area-select-card')) {
    customElements.define('hk-area-select-card', HkAreaSelectCard);
  }


  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'hk-area-select-card',
    name: 'HK Vacuum Area Picker',
    description: 'Pick rooms by floor, then start a vacuum clean of just those areas.',
    preview: false
  });


  // =========================================================== timers grid
  // The whole "Running" section of the Timers page: every timer that is
  // counting, one card each, plus the empty state when none are.
  //
  // WHY ONE CARD. A Lovelace view is a static list of cards, so "one card
  // per running timer" can only be spelled there as "one card per POSSIBLE
  // timer, each in its own `type: conditional`, hidden" -- thousands of
  // lines of YAML for a house with many timers. The list of timers lives
  // here as config instead, and the card draws the ones that are running.
  //
  // THE COUNTDOWN IS STILL hk-timers.js AND MUST BE. That module owns
  // <hk-countdown>, which repaints itself off a deadline four times a second
  // and hands the fraction back to its parent as --hk-left for the progress
  // bar. None of that is state a card re-render can produce -- the client reports a
  // running timer changing exactly twice, at start and at finish -- so this
  // card calls hkTimers.html() for the countdown row, and the module's
  // markup lands in this shadow root.
  //
  // RE-RENDER DISCIPLINE IS THE ONE HAZARD. each new client arrives on every state
  // change in the house, and rebuilding this grid on each one would tear down
  // and recreate every <hk-countdown> several times a second -- each one
  // restarting its paint and flashing --hk-left back to the 1 fallback, so the
  // bars would jitter. So _sig() reduces the timers this card actually draws to
  // one string and _render() returns early when it has not moved.
  //
  // THE EMPTY STATE READS NO SENSOR. A `type: conditional` can only test an
  // entity; this card can just look at the timers it was given. The page's
  // own list IS the page's condition, so the two cannot disagree.
  class HkTimersCard extends HkBase {
    static get CSS() {
      return [
        // 388, not 400: layout-card gives every grid child a 4px side margin
        // that no config removes, so three 400px cards need 1248 of a 1280
        // tablet page's 1229 and only two fit (measured). The number is about
        // the page width, not about nesting.
        // 10 apart, as every card on the page (hk-base TILE.gridGap)
        '.grid{display:grid;grid-template-columns:repeat(auto-fill,388px);  grid-auto-rows:196px;column-gap:' + window.hkCards.TILE.gridGap + 'px;row-gap:' + window.hkCards.TILE.gridGap + 'px;margin:0 0 14px 0}',
        // 196 exactly: 52 (head) + 48 (countdown and its bar, which
        // hkTimers.html emits as ONE wrapper and so occupies one row) + 52
        // (buttons) + two 12px gaps + 32 of padding.
        '.tc{height:196px;padding:16px 18px;border-radius:' + M.radius + ';  ' + M.glass + ';border:' + M.border + ';  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-lg') + ');',
        '  display:grid;column-gap:12px;row-gap:12px;align-items:center;  grid-template-columns:repeat(4,minmax(0,1fr));  grid-template-rows:52px minmax(0,1fr) 52px;',
        '  grid-template-areas:"head head head head" "count count count count"                     "pause restart plus finish"}',
        '.tc > .head{grid-area:head;justify-self:stretch;min-width:0;overflow:hidden}',
        '.tc > .count{grid-area:count;justify-self:stretch;align-self:center;min-width:0}',
        // The four controls, with an
        // explicit 21px icon row -- an <hk-icon> has no intrinsic height, so a
        // min-content row collapses it to nothing and the buttons render as
        // bare captions. The caption row CAN be min-content; text sizes itself.
        '.tb{height:52px;border-radius:18px;background:' + window.hkCards.v('key') + ';  border:none;box-shadow:none;padding:0;justify-self:stretch;  display:grid;grid-template-columns:minmax(0,1fr);',
        '  grid-template-rows:21px min-content;align-content:center;  justify-items:center;row-gap:3px;cursor:pointer;user-select:none}',
        '.tb hk-icon{--mdc-icon-size:19px;width:19px;height:19px;  color:' + window.hkCards.v('glyph') + '}',
        '.tb > span{font-size:11px;font-weight:600;letter-spacing:0.1px;  line-height:1;color:' + window.hkCards.v('ink-2') + '}',
        // The empty state is a LINE OF TEXT, not a card. A full-width glass
        // plate with one grey sentence in it looks out of place: a plate is
        // this frontend's shape for a THING YOU CAN TOUCH, and there is nothing
        // here to touch. Sitting the sentence directly under the heading says
        // "this section is empty" without pretending to be a control.
        '.empty{padding:2px 4px 14px 4px;font-size:15px;font-weight:500;  letter-spacing:-0.2px;color:' + window.hkCards.v('ink-3') + '}',
        // PHONE. The 388px track above is a TABLET number -- it is the page
        // width divided by three, and `auto-fill` with a fixed track cannot
        // shrink below it, so at 402px it would lay one 388px card into ~354px
        // of room and the cards would run off the right edge. One full-width column
        // instead; the card's own four control tracks are already
        // `minmax(0,1fr)` and divide whatever they are given (~70px each at
        // 402px, against 52px tall buttons, which is fine).
        '@media (max-width:' + window.hkCards.BP.phone + 'px){  .grid{grid-template-columns:minmax(0,1fr)}',
        '}',
        // ------------------------------------------------ FIT (the Timers page)
        // `fit: true` -- the card fills the running column of the one-page
        // Timers layout (hk-timers-page-card) and the COUNT decides the shape:
        //   1-2 running   the full card, two across
        //   3-4 running   the compact card, two across
        //   5-6 running   the compact card, three across
        //   7 or more     pages of six, swiped sideways, with dots
        // so the running column never grows past two rows and the House
        // timers under it keep their place beside the keypad.
        '.grid.fit{grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));grid-auto-rows:auto;margin:0}',
        // THE COMPACT CARD: the same four rows, smaller -- a 40 px well, the
        // countdown, and the four controls as icons (the caption goes; the
        // glyphs are the ones the full card labels). 164 = 12 + 40 + 8 + 44
        // (the countdown and its bar) + 8 + 40 + 12 -- two rows of it and the
        // House timers fit beside the keypad panel with the bottoms level.
        '.tc.cp{height:164px;padding:12px 16px;row-gap:8px;grid-template-rows:40px minmax(0,1fr) 40px}',
        '.tc.cp .tb{height:40px;border-radius:13px;grid-template-rows:21px}',
        '.tc.cp .tb > span{display:none}',
        // PAGES. A sideways scroll-snap row, one page per viewport, padded all
        // round so the cards' shadows are not cut at its edges (the row's
        // negative margin puts the cards back where a grid would have them),
        // and 32 px apart so the next page never shows in that padding.
        '.pages{display:grid;grid-auto-flow:column;grid-auto-columns:100%;column-gap:32px;  overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-padding:0 16px;',
        '  padding:16px;margin:-16px;overscroll-behavior-x:contain;scrollbar-width:none;  -webkit-overflow-scrolling:touch}',
        '.pages::-webkit-scrollbar{display:none;width:0;height:0}',
        // its own formatting context, so the row's negative margin is taken
        // back inside it -- as a plain child it escapes, and the card comes
        // out 16 px taller than its two rows
        '.pw{display:flow-root}',
        '.page{scroll-snap-align:start;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));  grid-template-rows:repeat(2,164px);gap:12px;align-content:start}',
        // THE HEADING IS THIS CARD'S in `fit` (config `heading`), so the dots
        // sit at the right of it: pages cost no height, and the House timers
        // under the grid stay level with the keypad however many there are.
        '.hrow{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
        // The dots: 24 px targets around an 8 px dot. Swiping is the way;
        // a dot is a jump to that page.
        '.dots{display:flex;justify-content:flex-end;gap:2px;height:24px;margin-top:5px}',
        '.dots button{all:unset;width:24px;height:24px;display:flex;align-items:center;  justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.dots i{width:8px;height:8px;border-radius:4px;background:' + window.hkCards.v('ink-3') + ';  transition:background-color .2s ease}',
        '.dots button[aria-current="true"] i{background:' + window.hkCards.v('ink') + '}',
        // PHONE: one column and no sideways pages -- the page itself scrolls,
        // so every running timer is simply the next card down.
        '@media (max-width:' + window.hkCards.BP.phone + 'px){  .grid.fit{grid-template-columns:minmax(0,1fr)}  .pages{display:block;overflow:visible;padding:0;margin:0}  .pw{display:block}',
        '  .page{grid-template-columns:minmax(0,1fr);grid-template-rows:none;grid-auto-rows:164px;margin:0 0 12px}  .page:last-child{margin-bottom:0}',
        '  .dots{display:none}',
        '}',
        '@media (prefers-reduced-motion: reduce){.dots i{transition:none}}'
      ].join('');
    }

    _onConfig() { this._sig = null; this._page = 0; }

    _list() { var T = window.hkTimers, c = this._config.timers || []; return T && T.withMade ? T.withMade(c, this.client && this.client.states) : c; }
    // (Flat Light's lit color, Apple's light orange, as every lit well's:
    // hk-base flatColor; unchanged in the other looks)
    _tint() { return window.hkCards.flatColor(this._config.tint || 'rgba(255, 159, 10, 0.95)', 'well'); }

    // Only the timers that are counting, in configured order. `paused` is
    // included: a paused timer is still something you are steering.
    _running() {
      var self = this;
      return this._list().filter(function (t) {
        var st = self._st(t.entity);
        return st && (st.state === 'active' || st.state === 'paused');
      });
    }

    // Everything a redraw could possibly change, in one string. `finishes_at`
    // is what moves when a timer is started, paused or extended; `remaining` is
    // the truth on a paused one; `duration` drives the sub-line and Restart.
    _sigOf() {
      var self = this;
      return this._list().map(function (t) {
        var st = self._st(t.entity);
        if (!st) { return t.entity + '|-'; }
        var a = st.attributes || {};
        var nm = t.label_entity ? (self._st(t.label_entity) || {}).state : '';
        return [t.entity, st.state, a.finishes_at || '', a.remaining || '',
                a.duration || '', nm || ''].join('|');
      }).join(';') + (window.hkTimers ? ';M' : ';-');
    }

    _boot() {
      // A BACKSTOP. hk-loader.js imports hk-timers.js on every page, but the
      // imports run in parallel with the cards, so a timer card can render
      // first -- and a page could be missing the loader. So the first render
      // pulls it in if it is not there yet; hk-timers.js ignores a second load.
      // A <script> tag rather than import(): this file is a classic script.
      if (window.hkTimers || window.__hkTimersBooting) { return; }
      window.__hkTimersBooting = true;
      var s = document.createElement('script');
      s.src = '/hk/modules/hk-timers.js';
      s.onload = function () {
        window.dispatchEvent(new Event('hk-timers-ready'));
      };
      s.onerror = function () {
        window.__hkTimersBooting = false;      // let the next render retry
        console.error('[hk-timers] could not load /hk/modules/hk-timers.js');
      };
      document.head.appendChild(s);
      if (!this.__wired) {
        this.__wired = true;
        var self = this;
        window.addEventListener('hk-timers-ready', function once() {
          window.removeEventListener('hk-timers-ready', once);
          self._sig = null;                    // force the next render through
          self._render();
        });
      }
    }

    // NOT named _call -- see hk-security.js _alarm(): shadowing HkBase._call
    // would make this recurse forever and pause/resume/cancel do nothing.
    _timer(entity, service, data) {
      if (!this.client) { return; }
      var d = Object.assign({ entity_id: entity }, data || {});
      this._call('timer', service, d);
    }

    // Seconds left, right now. finishes_at is the ONLY live source on an active
    // timer: `remaining` is frozen at the value it had when the timer started
    // (measured -- a 2-minute timer reported 0:02:00 at t+3s, t+25s and t+45s
    // while the truth ticked 116 -> 96 -> 76). On a PAUSED timer there is no
    // deadline and `remaining` is the truth. hk-timers.js act() does the
    // identical calculation for the pop-up pills; keep the two in step.
    _left(st) {
      var a = (st && st.attributes) || {};
      if (st && st.state === 'active' && a.finishes_at) {
        var end = Date.parse(a.finishes_at);
        if (!isNaN(end)) { return Math.max(0, (end - Date.now()) / 1000); }
      }
      return window.hkTimers ? window.hkTimers.secs(a.remaining) : 0;
    }

    _hms(t) {
      var p = function (n) { return String(n).padStart(2, '0'); };
      return Math.floor(t / 3600) + ':' + p(Math.floor((t % 3600) / 60)) +
             ':' + p(t % 60);
    }

    _btn(area, icon, label, fn) {
      var d = document.createElement('div');
      d.className = 'tb';
      d.style.gridArea = area;
      button(d, fn);
      var i = document.createElement('hk-icon'); i.setAttribute('icon', icon);
      var s = document.createElement('span'); s.textContent = label;
      d.appendChild(i); d.appendChild(s);
      return d;
    }

    // The head: well, name, sub-line. One flex row rather than two grid cells,
    // because the button row below needs four EQUAL tracks and an icon column
    // would have forced the buttons to span unevenly.
    _head(t, st, compact) {
      var tint = this._tint();
      var s = st.state;
      // Filled well while RUNNING, hollow otherwise -- the same grammar as
      // the vacuum card. Colour means "this is happening now", and
      // a paused timer is deliberately not shouting.
      var liveNow = s === 'active';
      var bg = liveNow ? tint : '' + window.hkCards.v('key-strong') + '';
      // (Flat: a white glyph in a colored lit well, as on every tile --
      // DESIGN.md; the other looks keep the vacuum card's dark one)
      var S = window.hkSettings, flat = !!(S && S.rendering && S.rendering().flat);
      var fg = liveNow ? (flat ? '#fff' : 'rgba(0,0,0,0.82)') : 'var(--hk-glyph,rgba(255,255,255,0.80))';
      var px = t.glyph_px || '28px';
      // the compact card's 40 px well: the glyph scales with it
      var well = compact ? 40 : 52;
      if (compact) { px = Math.round(parseFloat(px) * 40 / 52) + 'px'; }
      // The name, in priority order: the live label helper if this timer has
      // one AND it holds something real, then the configured fallback, then the
      // entity's friendly name. `unknown` is the case that matters -- an
      // input_text never written reads that, not empty.
      var raw = t.label_entity ? ((this._st(t.label_entity) || {}).state || '') : '';
      var given = ['', 'unknown', 'unavailable'].indexOf(String(raw).trim()) >= 0
        ? '' : String(raw).trim();
      var n = given || t.label || (st.attributes || {}).friendly_name || '';
      // The sub-line is the SET duration, not the remaining one -- the
      // countdown below already owns "remaining". "1 hr" beside a running
      // 0:47:12 says how far through you are, which the countdown cannot.
      var T = window.hkTimers;
      var dur = T ? T.pretty((st.attributes || {}).duration) : '';
      var word = s === 'active' ? 'Running' : s === 'paused' ? 'Paused' : 'Ready';
      var sub = dur ? word + ' · ' + dur : word;

      var d = document.createElement('div');
      d.className = 'head';
      d.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px;min-width:0;">' +
          '<div style="flex:0 0 auto;width:' + well + 'px;height:' + well + 'px;border-radius:' + (well / 2) + 'px;' +
            'background:' + bg + ';display:flex;align-items:center;' +
            'justify-content:center;">' +
            '<hk-icon icon="' + esc(t.glyph || 'mdi:timer-outline') + '" ' +
              'style="--mdc-icon-size:' + esc(px) + ';color:' + fg + ';">' +
            '</hk-icon></div>' +
          '<div style="min-width:0;text-align:left;">' +
            '<div style="font-size:17px;font-weight:600;letter-spacing:-0.45px;' +
              'color:' + window.hkCards.v('ink') + ';line-height:1.25;overflow:hidden;' +
              'text-overflow:ellipsis;white-space:nowrap;">' + esc(n) + '</div>' +
            '<div style="font-size:13px;font-weight:500;letter-spacing:-0.1px;' +
              'color:' + window.hkCards.v('ink-2') + ';line-height:1.3;">' + esc(sub) + '</div>' +
          '</div></div>';
      return d;
    }

    _card(t, st, compact) {
      var self = this;
      var e = t.entity;
      var c = document.createElement('div');
      c.className = compact ? 'tc cp' : 'tc';
      // ITS NAME OPENS ITS SHEET (the timer sheet, hk-headers.js): the four
      // controls below keep their own taps
      var hd = this._head(t, st, compact);
      hd.style.cursor = 'pointer';
      button(hd, function () {
        window.hkShell.moreInfo(e, self);
      });
      hd.setAttribute('aria-label', 'Open ' + (hd.textContent || 'timer'));
      c.appendChild(hd);

      var count = document.createElement('div');
      count.className = 'count';
      var T = window.hkTimers;
      // No module, or nothing to count: a dash and an empty bar slot, holding
      // the row's height so the four buttons do not jump up a line the moment a
      // timer finishes. A card that changes height reflows every card after it.
      var blank = '<div style="text-align:left;"><div style="font-size:30px;' +
        'font-weight:300;letter-spacing:-0.8px;line-height:1;' +
        'color:' + window.hkCards.v('ink-3') + ';">&mdash;</div>' +
        '<div style="margin-top:10px;height:4px;"></div></div>';
      count.innerHTML = (T && T.html(st.attributes, { fill: this._tint() })) || blank;
      c.appendChild(count);

      // 1. Start / Pause / Resume. One key does all three: timer.start resumes
      //    a paused timer and runs an idle one at its configured duration, so
      //    only the ACTIVE case needs the other service.
      var s = st.state;
      c.appendChild(this._btn('pause',
        s === 'active' ? 'mdi:pause' : 'mdi:play',
        s === 'active' ? 'Pause' : s === 'paused' ? 'Resume' : 'Start',
        function () { self._timer(e, s === 'active' ? 'pause' : 'start'); }));

      // 2. Restart. `duration` is the last STARTED duration, not the one in
      //    YAML, so this restarts at whatever the timer is currently set to.
      //    Passing no duration would be a no-op on an active timer, not a
      //    restart.
      c.appendChild(this._btn('restart', 'mdi:restart', 'Restart', function () {
        self._timer(e, 'start', {
          duration: (st.attributes || {}).duration || '0:00:00'
        });
      }));

      // 3. +5 min. There is no service that ADDS time, and timer.start with a
      //    duration restarts at that duration -- so the extension is expressed
      //    as an absolute new length computed from the live remaining. Read
      //    _left() for why that cannot come from the `remaining` attribute.
      c.appendChild(this._btn('plus', 'mdi:plus', '5 min', function () {
        var live = self._st(e) || st;
        self._timer(e, 'start', {
          duration: self._hms(Math.round(self._left(live)) + 300)
        });
      }));

      // 4. Finish, not Cancel. timer.finish FIRES the finished event, so
      //    whatever the timer was for actually happens -- which is what an
      //    automation listening for it expects. Cancel ends silently, and two
      //    buttons that look alike and differ only in whether the rest of the
      //    house reacts is a trap.
      c.appendChild(this._btn('finish', 'mdi:check', 'Finish', function () {
        self._timer(e, 'finish');
      }));
      return c;
    }

    _render() {
      if (!this._config) { return; }
      this._boot();
      var sig = this._sigOf();
      if (sig === this._sig) { return; }        // see the class comment
      this._sig = sig;

      var running = this._running();
      if (this._config.fit) { this._renderFit(running); return; }
      this._root.innerHTML = '';
      var grid = document.createElement('div');
      grid.className = 'grid';
      for (var i = 0; i < running.length; i++) {
        var t = running[i];
        grid.appendChild(this._card(t, this._st(t.entity)));
      }
      // Only mount the grid when it has something in it. Empty, its 14px
      // bottom margin would push the empty line down as if a row were there.
      if (running.length) { this._root.appendChild(grid); }
      if (!running.length) {
        var e = document.createElement('div');
        e.className = 'empty';
        e.textContent = this._config.empty_text ||
                        'Nothing is running. Set one above.';
        this._root.appendChild(e);
      }
    }
    // THE SHAPE FOR THIS MANY -- see `fit` in the CSS. Exposed for the tests.
    static shape(n) {
      if (n <= 2) return { compact: false, cols: 2, per: 2 };
      if (n <= 4) return { compact: true, cols: 2, per: 4 };
      return { compact: true, cols: 3, per: 6 };
    }

    _renderFit(running) {
      var self = this, n = running.length, sh = HkTimersCard.shape(n);
      var keep = this._page || 0;
      this._root.innerHTML = '';
      this._pages = null; this._dots = null;
      var hrow = null;
      if (this._config.heading) {
        hrow = document.createElement('div'); hrow.className = 'hrow';
        var hd = document.createElement('div'); hd.className = 'head'; hd.textContent = this._config.heading;
        hrow.appendChild(hd);
        this._root.appendChild(hrow);
      }
      if (!n) {
        var e = document.createElement('div');
        e.className = 'empty';
        e.textContent = this._config.empty_text || 'Nothing is running.';
        this._root.appendChild(e);
        return;
      }
      if (n <= 6) {
        var grid = document.createElement('div');
        grid.className = 'grid fit';
        grid.style.setProperty('--cols', String(sh.cols));
        running.forEach(function (t) { grid.appendChild(self._card(t, self._st(t.entity), sh.compact)); });
        this._root.appendChild(grid);
        this._page = 0;
        return;
      }
      // SEVEN OR MORE: pages of six, three across and two down.
      var pages = document.createElement('div');
      pages.className = 'pages';
      var count = Math.ceil(n / 6);
      // THE PAGES BY REFERENCE, not pages.children: hk-glass puts the row's
      // shared blur layer INSIDE the row (it scrolls with it), so the first
      // child is not always the first page.
      this._pageEls = [];
      for (var p = 0; p < count; p++) {
        var pg = document.createElement('div');
        pg.className = 'page';
        this._pageEls.push(pg);
        running.slice(p * 6, p * 6 + 6).forEach(function (t) {
          pg.appendChild(self._card(t, self._st(t.entity), true));
        });
        pages.appendChild(pg);
      }
      var dots = document.createElement('div');
      dots.className = 'dots';
      dots.setAttribute('role', 'tablist');
      for (var d = 0; d < count; d++) {
        (function (i) {
          var b = document.createElement('button');
          b.setAttribute('aria-label', 'Timers page ' + (i + 1) + ' of ' + count);
          b.appendChild(document.createElement('i'));
          b.addEventListener('click', function () { self._goPage(i, true); });
          dots.appendChild(b);
        })(d);
      }
      pages.addEventListener('scroll', function () {
        var i = self._pageAt();
        if (i !== self._page) { self._page = i; self._paintDots(); }
      }, { passive: true });
      var pw = document.createElement('div'); pw.className = 'pw';
      pw.appendChild(pages);
      this._root.appendChild(pw);
      (hrow || this._root).appendChild(dots);
      this._pages = pages; this._dots = dots;
      // A redraw (a timer started, paused or finished) keeps the page you
      // were on -- or the last one, if it has gone.
      this._page = Math.min(keep, count - 1);
      this._paintDots();
      // Now (the row is laid out as soon as it is attached) and again on the
      // next frame, in case the page was not yet laid out.
      var restore = function () { self._goPage(self._page, false); };
      restore();
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
    }
    // A page's left edge, relative to the first page's.
    _pageLeft(i) {
      var k = this._pages && this._pageEls;
      if (!k || !k[i] || !k[0] || !k[i].getBoundingClientRect) return 0;
      // exact, not offsetLeft's whole pixels: a page is 764.8 px wide here
      return k[i].getBoundingClientRect().left - k[0].getBoundingClientRect().left;
    }
    _pageAt() {
      var k = this._pages && this._pageEls, x = this._pages ? this._pages.scrollLeft : 0, best = 0;
      if (!k) return 0;
      for (var i = 1; i < k.length; i++) {
        if (Math.abs(this._pageLeft(i) - x) < Math.abs(this._pageLeft(best) - x)) best = i;
      }
      return best;
    }
    _goPage(i, smooth) {
      if (!this._pages) return;
      this._page = i;
      var left = this._pageLeft(i);
      if (smooth && !(window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) && this._pages.scrollTo) this._pages.scrollTo({ left: left, behavior: 'smooth' });
      else this._pages.scrollLeft = left;
      this._paintDots();
    }
    _paintDots() {
      if (!this._dots) return;
      var cur = this._page;
      Array.prototype.forEach.call(this._dots.children, function (b, i) {
        b.setAttribute('aria-current', i === cur ? 'true' : 'false');
      });
    }
    // WHAT IT SHOWS, in Lovelace's 50px rows: the one empty line, or the
    // running timers' rows of 196px cards (up to three across); in `fit`, one
    // row for two or fewer, else its two compact rows (pages beyond six).
    getCardSize() {
      var n = this._config ? this._running().length : 0;
      if (!n) return 1;
      var size = this._config.fit ? (n <= 2 ? 4 : 7) : 4 * Math.ceil(n / 3);
      return size + (this._config.fit && this._config.heading ? 1 : 0);
    }
  }

  if (!customElements.get('hk-timers-card')) {
    customElements.define('hk-timers-card', HkTimersCard);
  }
  window.customCards.push({
    type: 'hk-timers-card',
    name: 'HK Timers',
    description: 'Every running timer as its own tile, with a live countdown.',
    // `false`, and STATED, as every card here declares `preview` one way or
    // the other. false is the honest value: the picker's preview renders whatever is
    // running in the house right now, which is usually nothing, so the card
    // previews as a bare "Nothing is running" strip. The same reasoning the
    // keypad, the area picker and the pop-up already use.
    preview: false
  });
  // ============================================================== new timer
  // The timer creator: the duration on wheels (hk-roller.js), a name, and Start.
  // WHY THE TYPING LIVES HERE. Kept in input_text helpers, the half-typed
  // duration and name would be GLOBAL entities used as a scratchpad: two
  // tablets would share them, every keystroke would be a service call
  // broadcast to every connected client, and the partly-typed value would
  // sit in the state machine.
  // Here the value is a JS property and typing re-renders nothing; _paint()
  // touches only the end time, the chips and the Start state, so the <input>
  // keeps its caret and the wheels their places.
  // WHAT STILL HAPPENS SERVER-SIDE: script.quick_timer_start (or Mantel, which
  // answers for it) takes the HH:MM:SS and starts a real timer entity.
  // This card collects; Home Assistant decides.
  class HkTimerNewCard extends HkBase {
    static get CSS() {
      var R = window.hkRoller;
      return [
        // THE ROLLER (hk-roller.js; the owner's mockup 5c, 2026-11-09): hours, minutes and seconds on three wheels, where the
        // keypad was -- the same wheels in every layout here and in the Extra Large Timers block's maker
        R ? R.CSS : '',
        '.hkr{--hkr-ink:' + window.hkCards.v('ink') + ';--hkr-ink2:' + window.hkCards.v('ink-2') + ';--hkr-band:' + window.hkCards.v('key') + ';--hkr-band-r:' + window.hkCards.R.inner + 'px}',
        // TWO COLUMNS by default: the wheels and when it ends on the left; the name, its chips and Start on the right
        '.wrap{display:grid;grid-template-columns:384px minmax(0,1fr);gap:28px}',
        // PHONE: stacked, the wheels first and full width
        '@media (max-width:' + window.hkCards.BP.phone + 'px){  .wrap{grid-template-columns:minmax(0,1fr);gap:18px}',
        '}',
        // ...AND BY ITS OWN WIDTH on someone else's dashboard: a section or a
        // Masonry column is narrower than the two columns on any screen, and
        // the name, chips and Start ran out of it. Stacked as on a phone. HK's
        // own pages keep the screen-width rule above (no container there).
        ':host([data-hk-foreign]){container-type:inline-size}',
        '@container (max-width:' + window.hkCards.BP.phone + 'px){  .wrap:not(.panel){grid-template-columns:minmax(0,1fr);gap:18px}',
        '}',
        // WHEN IT WOULD END ("Ends 4:52 PM"), under the wheels; a message ("Too many timers are running.") takes its place
        // while it shows -- the two share one cell
        '.ro{display:grid;justify-items:center;min-height:18px;min-width:0}',
        '.ro > *{grid-area:1 / 1;min-width:0}',
        '.ro .ends{font-size:14px;font-weight:500;line-height:18px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
        '.ro .hk-status{margin:0;min-height:0;line-height:18px;font-size:14px;text-align:center}',
        '.ro:has(.hk-status[data-kind]) .ends{visibility:hidden}',
        // SIX ACROSS, ONE ROW. minmax(0,1fr) rather than 1fr is what lets a long chip ellipsize instead of widening its
        // track and pushing the other five out of the card.
        '.chips{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));  grid-auto-rows:48px;gap:10px;margin:0 0 14px 0}',
        '.chip2{height:48px;border-radius:17px;padding:0 10px;min-width:0;border:' + M.border + ';  box-shadow:none;' + M.glass + ';display:flex;align-items:center;',
        '  justify-content:center;cursor:pointer;user-select:none;font-size:16px;',
        '  font-weight:600;letter-spacing:-0.3px;color:' + window.hkCards.v('ink') + ';',
        '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
        '  transition:background-color .22s ease,transform .12s ease}',
        '.chip2:active{transform:scale(0.96)}',
        '.chip2[aria-pressed="true"]{background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}',
        // A real <input>, which is the point: it keeps its own value and its
        // own caret, and nothing re-renders while somebody is typing.
        '.namebox{height:58px;border-radius:20px;padding:8px 16px;margin:0 0 14px 0;  ' + M.glass + ';border:' + M.border + ';display:flex;align-items:center;gap:10px}',
        '.namebox hk-icon{flex:none;width:18px;height:18px;--mdc-icon-size:18px;color:' + window.hkCards.v('ink-2') + '}',
        '.namebox input{all:unset;width:100%;height:100%;font-size:19px;font-weight:600;  letter-spacing:-0.3px;color:' + window.hkCards.v('ink') + ';font-family:inherit}',
        '.namebox input::placeholder{color:' + window.hkCards.v('ink-3') + ';font-weight:400}',
        '.start{height:70px;border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border + ';  box-shadow:' + M.shSm + ';display:flex;align-items:center;justify-content:center;',
        '  font-size:17px;font-weight:600;letter-spacing:-0.3px;cursor:pointer;',
        '  user-select:none;transition:transform .12s ease}',
        '.start:active{transform:scale(0.97)}',
        '.start[aria-disabled="true"]{opacity:0.45;pointer-events:none}',
        '@media (prefers-reduced-motion: reduce){  .chip2,.chip2:active,.start,.start:active{    transition:none;transform:none}}',
        // ------------------------------------------------------ THE PANEL
        // `layout: panel` -- one column on its own glass plate, the right-hand side of the one-page Timers layout
        // (hk-timers-page-card) and the sheet a Timers block's "+" opens: the wheels and when it would end, the name, its
        // chips, and Start. The plate is the only glass surface; the chips on it are tints, not plates.
        '.wrap.panel{display:flex;flex-direction:column;gap:12px;padding:20px;box-sizing:border-box;height:100%;',
        '  border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border + ';',
        '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-lg') + ')}',
        '.panel .chip2,.panel .namebox{background:' + window.hkCards.v('key') + ';box-shadow:none}',
        '.panel .namebox{height:48px;border-radius:24px;margin:0;border:0}',
        '.panel .namebox input{font-size:17px}',
        // THE NAMES AS A FIXED GRID, three by two: chips that wrap get
        // awkward as they shrink. Every chip
        // the same width, 44 px tall, a long name ellipsized in its own cell.
        '.panel .chips{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:44px;gap:8px;margin:0}',
        '.panel .chip2{height:44px;border-radius:14px;font-size:15px}',
        // the chosen name in the selected material (the plate's key color
        // above would otherwise win: same specificity, later)
        '.panel .chip2[aria-pressed="true"]{background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}',
        '.panel .start{height:56px;border-radius:28px;margin-top:auto;font-size:18px;font-weight:700;border:0}',
        '.panel .start[aria-disabled="false"]{background:var(--hk-timer-tint,rgba(255,159,10,0.95));border-color:transparent;  color:rgba(0,0,0,0.85)}',
        '.panel .start[aria-disabled="true"]{opacity:1;color:' + window.hkCards.v('ink-3') + ';background:' + window.hkCards.v('key') + '}',
        // WIDE (`data-wide`, set by hk-timers-page-card when the page stacks: an iPad held upright, a tablet with the
        // menu docked): this panel runs the full width under the page, so its one column would be a tall strip. Two
        // columns instead -- the wheels and when it ends on the left; the name, its chips and Start on the right.
        ':host([data-wide]) .wrap.panel{display:grid;height:auto;column-gap:24px;row-gap:10px;  grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(4,56px) auto;',
        '  grid-template-areas:"roll name" "roll chips" "roll chips" "roll start" "ro ."}',
        ':host([data-wide]) .panel .hkr{grid-area:roll;align-self:center}',
        ':host([data-wide]) .panel .ro{grid-area:ro}',
        ':host([data-wide]) .panel .namebox{grid-area:name;height:56px;border-radius:28px}',
        ':host([data-wide]) .panel .chips{grid-area:chips;grid-auto-rows:56px;gap:10px;margin:0}',
        ':host([data-wide]) .panel .chip2{height:56px}',
        ':host([data-wide]) .panel .start{grid-area:start;margin:0}',
        // ------------------------------------------------------ THE SHEET
        // `layout: sheet` -- the panel's one column inside a detail sheet (the Timers page's Create a Timer): the sheet
        // is the plate, so no plate of its own; the quick names are the selectable pills' 40 px capsules, three by two
        '.wrap.panel.sheetl{background:none;border:0;box-shadow:none;padding:0;height:auto;min-height:100%;gap:14px}',
        '.sheetl .chips{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:40px;gap:10px}',
        '.sheetl .chip2{height:40px;border-radius:' + C.R.capsule('40px') + ';' + C.PILL_LABEL + ';padding:0 8px}',
        window.hkCards.headCss('.sheetl .lab') + '.sheetl .lab{margin:2px 2px -6px}',
        '.sheetl .start{margin-top:4px}',
        '.sheetl .hkr:focus-within .hkr-band{background:' + window.hkCards.v('key-strong') + '}',
        '.sheetl .chip2:focus-visible,.sheetl .start:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}',
        // ------------------------------------------------------ IN A BLOCK
        // `layout: block` -- the Extra Large Timers block's maker (mockup 5c): the wheels, a name and Start on the
        // block's inner tile; its row height is the block's to give (--hkr-row on the host). A message shows under the
        // wheels only while there is one.
        ':host([data-layout=block]){display:block;height:100%}',
        '.wrap.panel.blockl{height:100%;padding:var(--hk-mk-pad,14px 16px 16px);gap:var(--hk-mk-gap,10px);border-radius:var(--hk-inner-radius,20px);border:0;justify-content:space-between;',
        '  background:' + window.hkCards.v('key') + ';box-shadow:none}',
        '.blockl .hkr{--hkr-row:var(--hk-mk-row,40px);--hkr-fs:var(--hk-mk-fs,24px);--hkr-w:40px;--hkr-uw:34px;--hkr-gap:14px;--hkr-band-x:-4px}',
        '.blockl .ro{min-height:0}.blockl .ro .ends{display:none}.blockl .ro:not(:has(.hk-status[data-kind])){display:none}',
        '.blockl .namebox{height:56px;border-radius:28px;padding:0 16px;background:' + window.hkCards.v('key') + '}',
        '.blockl .namebox input{font-size:15px;font-weight:500}',
        '.blockl .start{height:56px;border-radius:28px;margin-top:0;font-size:17px;font-weight:600}',
        ':host([data-noname]) .blockl .namebox{display:none}'
      ].join('');
    }
    _onConfig() {
      this._dur = Object.assign({}, HkTimerNewCard.last || { h: 0, m: 15, s: 0 });
      this._name = ''; this._built = false;
      if (this._config && this._config.layout === 'block') this.setAttribute('data-layout', 'block');
    }
    _panel() { var l = this._config && this._config.layout; return l === 'panel' || l === 'sheet' || l === 'block'; }
    // "Ends 10:52 PM" moves with the clock, so the panel refreshes it while
    // it is on the page -- only that line, never the wheels or the input.
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      if (!this._endsT) this._endsT = setInterval(function () { self._paintEnds(); }, 15000);
      if (this._roller) this._roller.sync();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      if (this._endsT) { clearInterval(this._endsT); this._endsT = null; }
    }
    _paintEnds() {
      var el = this._root && this._root.querySelector('.ends');
      if (!el) return;
      var t = this._parse();
      el.textContent = t.total
        ? 'Ends ' + new Date(Date.now() + t.total * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'Set a duration';
    }
    // "25 min", "1 hr", "1 hr 30 min", "45 sec", "1 min 30 sec" -- what Start says it will start.
    static words(t) {
      if (!t.total) return '';
      var out = [];
      if (t.h) out.push(t.h + ' hr');
      if (t.m) out.push(t.m + ' min');
      if (t.s) out.push(t.s + ' sec');
      return out.join(' ');
    }
    // Reads no entity -- the wheels and the name are set here. Same trap as the
    // area picker: a null signature would repaint it on every state push (132
    // mutations for 12 unchanged updates). The wheels and inputs call _paint themselves.
    _sigOf() { return 'static'; }

    // THE DURATION is the wheels': hours, minutes, seconds
    _parse() {
      var d = this._dur || {}, h = d.h | 0, m = d.m | 0, s = d.s | 0;
      return { h: h, m: m, s: s, total: h * 3600 + m * 60 + s };
    }
    // (for a test, or anything that sets the wheels: they follow)
    _setDur(v) {
      this._dur = { h: v.h | 0, m: v.m | 0, s: v.s | 0 };
      if (this._roller) this._roller.set(this._dur, true);
      this._paint();
    }
    // THE NAME IS CLEARED ON SUCCESS, NOT ON TAP; THE DURATION STAYS (as the
    // Clock app keeps the wheels where they were -- the same timer again is one
    // tap). Clearing straight after the call, before it has resolved, would
    // lose the name when the call is rejected: no timer exists and nothing is
    // said.
    //
    // `_busy` is the other half: without it a second tap during the round
    // trip sends a second timer.
    //
    // ACCEPTED IS NOT STARTED, AND THAT GAP IS VISIBLE HERE. It is a BLOCKING
    // call to the script itself, asking for the response the allocator
    // returns ({started, slot} or {started, reason}; see
    // helpers/quick_timers.yaml, and Mantel's timers.py, which answers the same
    // way). Three distinct outcomes, three messages.
    //
    // THE START SCRIPT, with the wheels' HH:MM:SS: script.quick_timer_start
    // takes a duration to the second and a name (the keypad's
    // quick_timer_create read only hours and minutes).
    _start() {
      var t = this._parse();
      if (!t.total || !this.client) return;
      // `start_script` is an entity id; a blocking call needs it split. A
      // configured value without a domain is assumed to be a script.
      var ent = this._config.start_script || 'script.quick_timer_start';
      var parts = ent.indexOf('.') === -1 ? ['script', ent] : ent.split('.');
      // NO SUCH SCRIPT: the quick-timer helpers are not installed (a card
      // placed by hand on a dashboard of one's own). Say that, not "could not
      // reach Home Assistant", which sends someone checking the network.
      if (!this.client.states[parts.join('.')]) {
        this._setStatus('failed', NO_HELPERS());
        this._paint();
        return;
      }
      if (!this._begin('Starting timer…')) return;   // second tap: ignored
      var self = this, name = this._name.trim();
      this._callResp(parts[0], parts[1], Object.assign({ duration: window.hkRoller.hms(t) }, name ? { name: name } : {},
        this._ringsIn() ? { rings_in: this._ringsIn() } : {})).then(function (r) {
        self._end();
        // DISPATCH REJECTED. _call has logged it, the wheels and the name are
        // exactly as set, and the message stays up until the next attempt.
        if (!r.ok) {
          self._setStatus('failed', 'Could not reach Home Assistant. Tap to retry.');
          self._paint();
          return;
        }
        var res = r.response;
        // NO RESPONSE AT ALL. An older quick_timers.yaml, or a start_script
        // pointed somewhere that returns nothing. Accepted is all that is
        // known, so that is all that is claimed.
        if (!res || typeof res.started !== 'boolean') {
          self._clearForm();
          self._setStatus('sent', 'Sent to Home Assistant.', 4000);
          self._paint();
          return;
        }
        if (res.started) {
          self._clearForm();
          self._setStatus('sent', 'Timer started.', 4000);
          // in a sheet: started is done -- the sheet goes, the page shows it
          if (self._config.close_on_start && window.hkDetail && window.hkDetail.close) {
            setTimeout(function () { window.hkDetail.close(); }, 700);
          }
        } else if (res.reason === 'no_free_slot') {
          // THE ENTRY IS KEPT. Every slot is busy; cancel one and this same tap works.
          self._setStatus('warn', 'Too many timers are running.');
        } else {
          self._setStatus('warn', 'That works out to no time at all.');
        }
        self._paint();
      });
    }

    _addRingsIn(nb) { var T = window.hkTimers, h = T && T.ringsInHtml && this.client ? T.ringsInHtml(this.client.states) : ''; if (h) nb.insertAdjacentHTML('beforeend', h); }
    _ringsIn() { var el = this._root && this._root.querySelector('.ringsin'); return el ? el.value : ''; }
    _clearForm() {
      HkTimerNewCard.last = Object.assign({}, this._dur);
      this._name = '';
      var inp = this._root.querySelector('.namebox input');
      if (inp) { inp.value = ''; }
    }

    // Repaints ONLY what changes. Rebuilding the card would blow away the
    // <input> and the caret with it, and the wheels' places.
    _paint() {
      var start = this._root.querySelector('.start');
      if (!start) { return; }
      var t = this._parse(), nm = this._name.trim();
      this._paintEnds();
      // DISABLED WHILE IN FLIGHT as well as while empty. _begin already drops
      // a second submission; this is so the button LOOKS inert rather than
      // looking tappable and doing nothing.
      start.setAttribute('aria-disabled', (t.total && !this._busy) ? 'false' : 'true');
      // Start says what it will start ("Start 25 min").
      start.textContent = this._busy ? 'Starting…' : (t.total ? 'Start ' + HkTimerNewCard.words(t) : 'Start Timer');
      Array.prototype.forEach.call(this._root.querySelectorAll('.chip2'), function (c) {
        c.setAttribute('aria-pressed', c.getAttribute('data-name') === nm ? 'true' : 'false');
      });
    }

    _btn(cls, text, fn) {
      var d = document.createElement('div');
      d.className = cls; d.textContent = text;
      return button(d, fn);
    }
    _wheels() {
      var self = this, R = window.hkRoller;
      if (!R) return null;
      this._roller = R.create(R.timerCols(this._dur), { label: 'Timer length', onChange: function (v) { self._dur = v; self._paint(); } });
      return this._roller.el;
    }
    _nameBox() {
      var self = this, nb = document.createElement('div'); nb.className = 'namebox';
      nb.innerHTML = '<hk-icon icon="mdi:pencil"></hk-icon>';
      var inp = document.createElement('input');
      inp.type = 'text'; inp.placeholder = 'Name (optional)'; inp.maxLength = 32;
      inp.setAttribute('aria-label', 'Timer name');
      inp.addEventListener('input', function () { self._name = inp.value; self._paint(); });
      nb.appendChild(inp); this._addRingsIn(nb);
      return nb;
    }
    _chips(inp) {
      var self = this, chips = document.createElement('div'); chips.className = 'chips';
      // QUICK NAMES: a shortcut into the name field, never a duration. The
      // pressed one is whichever the field now says, so typing over it
      // clears it.
      (this._config.name_chips || []).slice(0, 6).forEach(function (n) {
        var c = self._btn('chip2', n, function () {
          self._name = (self._name.trim() === n) ? '' : n;
          inp.value = self._name; self._paint();
        });
        c.setAttribute('data-name', n);
        chips.appendChild(c);
      });
      return chips;
    }
    _readout() {
      var ro = document.createElement('div'); ro.className = 'ro';
      var ends = document.createElement('div'); ends.className = 'ends';
      ro.appendChild(ends); ro.appendChild(this._statusNode());
      return ro;
    }

    _render() {
      if (!this._config) { return; }
      if (this._built) { this._paint(); return; }
      if (this._panel()) { this._renderPanel(); return; }
      var self = this;
      this._root.innerHTML = '';
      var wrap = document.createElement('div'); wrap.className = 'wrap';
      var left = document.createElement('div');
      var wh = this._wheels();
      if (wh) left.appendChild(wh);
      left.appendChild(this._readout());
      var right = document.createElement('div');
      var nb = this._nameBox(); right.appendChild(nb);
      right.appendChild(this._chips(nb.querySelector('input')));
      right.appendChild(this._btn('start', 'Start Timer', function () { self._start(); }));
      wrap.appendChild(left); wrap.appendChild(right);
      this._root.appendChild(wrap);
      this._built = true;
      this._paint();
    }

    // The same parts in one column: the panel, the sheet, the block's maker.
    _renderPanel() {
      var self = this;
      this._root.innerHTML = '';
      // THE PLATE FILLS THE HOST, so the page can stretch the panel to the
      // left column's height (Start is pinned to the bottom of it).
      this._root.style.height = '100%';
      var layout = this._config.layout, sheet = layout === 'sheet', block = layout === 'block';
      var wrap = document.createElement('div'); wrap.className = 'wrap panel' + (sheet ? ' sheetl' : block ? ' blockl' : '');
      if (this._config.tint) wrap.style.setProperty('--hk-timer-tint', window.hkCards.flatColor(this._config.tint, 'well'));
      // ENTER STARTS, from the name field or a wheel (a wheel's arrows are its own)
      wrap.addEventListener('keydown', function (e) {
        var t = e.composedPath ? e.composedPath()[0] : e.target;
        if (e.key === 'Enter' && !(t && t.getAttribute && t.getAttribute('role') === 'button')) { e.preventDefault(); self._start(); }
      });
      var wh = this._wheels();
      if (wh) wrap.appendChild(wh);
      wrap.appendChild(this._readout());
      var nb = this._nameBox(); wrap.appendChild(nb);
      if (!block) {
        var chips = this._chips(nb.querySelector('input'));
        if (sheet && chips.children.length) {
          var lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = 'Quick Names';
          wrap.appendChild(lab);
          chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Quick names');
        }
        wrap.appendChild(chips);
      }
      wrap.appendChild(this._btn('start', 'Start Timer', function () { self._start(); }));
      this._root.appendChild(wrap);
      this._built = true;
      this._paint();
    }
    getCardSize() { return 8; }
  }

  if (!customElements.get('hk-timer-new-card')) {
    customElements.define('hk-timer-new-card', HkTimerNewCard);
  }
  window.customCards.push({
    type: 'hk-timer-new-card',
    name: 'HK New Timer',
    description: 'Type a duration, pick a name, and start a timer.',
    preview: false
  });

  // =========================================================== timers page
  // THE TIMERS PAGE ON ONE PAGE: what is running and the creator side by
  // side, the creator on the right. Two columns:
  //
  //   left   Quick start (six one-tap presets), Running (hk-timers-card in
  //          its `fit` shape: two full cards, then compact ones, then pages
  //          of six swiped sideways), and the House timers that are idle
  //   right  the New Timer panel (hk-timer-new-card, `layout: panel`)
  //
  // THE BOTTOMS LINE UP. The row stretches both columns to the taller one;
  // the House timers are pinned to the bottom of the left column and Start
  // to the bottom of the panel, so the last pill and the Start button end on
  // the same line whatever is running.
  //
  // A HOST. The running grid and the creator are cards of their own
  // (their countdowns, their slot allocation and their status messages);
  // this lays them out and hands them the client. The one thing it
  // does itself is the Quick start row, which answers the way the
  // keypad does -- a bare script call would say nothing when all four
  // slots are busy.
  //
  // PHONE: one column -- Running, Quick start, the creator, House timers.
  // iPAD UPRIGHT: one column in the tablet's order, the creator last and wide.
  class HkTimersPageCard extends HkBase {
    static get CSS() {
      return [
        ':host{display:block}',
        '.pg{display:grid;grid-template-columns:minmax(0,1fr) 420px;column-gap:28px;align-items:stretch}',
        '.main{display:flex;flex-direction:column;min-width:0}',
        '.side{display:flex;flex-direction:column;min-width:0}',
        '.side > *{flex:1 1 auto;display:block}',
        '.s-run{margin-top:16px}',
        // pinned to the bottom of the column: see the class comment
        '.s-house{margin-top:auto;padding-top:16px}',
        '.s-house[hidden]{display:none}',
        // a heading, with the Quick start row's status line beside it
        '.hrow{display:flex;align-items:baseline;gap:12px}',
        '.hrow .head{flex:0 0 auto}',
        '.hrow .hk-status{flex:1;min-width:0;text-align:right;margin:0 4px 10px 4px}',
        '.qs{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}',
        '.qk{height:56px;border-radius:18px;' + M.glass + ';border:' + M.border + ';box-shadow:' + M.shSm + ';',
        '  display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:650;',
        '  letter-spacing:-0.3px;color:' + window.hkCards.v('ink') + ';cursor:pointer;user-select:none;',
        '  -webkit-tap-highlight-color:transparent;transition:transform .12s ease}',
        '.qk:active{transform:scale(0.96)}',
        '.qk[aria-disabled="true"]{opacity:0.45;pointer-events:none}',
        // the house's own pill and gap (hk-base.js TILE), as on every room page
        '.hgrid{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));gap:' + window.hkCards.TILE.gridGap + 'px}',
        // STACKED (`data-stack`, below STACK_W of the card's OWN width, not
        // the window's -- an iPad held upright, and a wall tablet with the
        // menu docked, whose page is an iPad's): ONE COLUMN, the tablet's
        // order -- Quick start, Running, House timers -- then the New Timer
        // panel across the width under them (it lays itself out in two
        // columns, `data-wide`). Beside a 420 px panel the left column would
        // be ~258 px at 744, and six running timers 75 px wide with
        // "2:29:58" spilling out of them. Full width, three across at ~227.
        ':host([data-stack]) .pg{grid-template-columns:minmax(0,1fr)}',
        ':host([data-stack]) .s-house{margin-top:0}',
        ':host([data-stack]) .side{margin-top:22px}',
        '@media (max-width:' + window.hkCards.BP.phone + 'px){  .pg{display:flex;flex-direction:column;gap:18px}  .main{display:contents}',
        '  .s-run{order:1;margin:0}.s-qs{order:2}.side{order:3}.s-house{order:4;margin:0;padding:0}',
        '  .qs{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
        '  .hgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
        '}',
        '@media (prefers-reduced-motion: reduce){.qk,.qk:active{transition:none;transform:none}}'
      ].join('');
    }
    _onConfig() { this._built = false; this._tiles = {}; }
    // (Flat Light's lit color, Apple's light orange, as every lit well's:
    // hk-base flatColor; unchanged in the other looks)
    _tint() { return window.hkCards.flatColor(this._config.tint || 'rgba(255, 159, 10, 0.95)', 'well'); }
    _presets() { return this._config.presets || [5, 10, 15, 20, 30, 60]; }
    // THE HOUSE TIMERS: the card's own `house:` list, else Configure -> Your
    // home -> House timers -- each named as its accessory is, else its friendly name less
    // "- Timer", and pictured as its accessory, else as the timer is.
    _house() {
      if (Array.isArray(this._config.house)) return this._config.house;
      var h = this.client, ids = setting('features.house_timers') || [];
      var A = setting('accessories') || {}, E = A.entities || {};
      var dash = ''; try { dash = String(location.pathname).split('/')[1] || ''; } catch (e) { /* a test */ }
      return ids.filter(function (id) { return !h || (h.states && h.states[id]); }).map(function (id) {
        var st = h && h.states[id], a = E[id] || {}, at = (st && st.attributes) || {};
        var ent = (h && h.entities && h.entities[id]) || {};
        var nm = (a.names && a.names[dash]) || a.name ||
                 String(at.friendly_name || id).replace(/\s*[-\u2013]?\s*timer\s*$/i, '') || id;
        var ic = a.icon || ent.icon || at.icon || 'mdi:timer-outline';
        return { entity: id, name: nm, icon: /^mdi:/.test(ic) && a.icon ? 'hk:' + ic.slice(4) : ic };
      });
    }
    // Only the House timers' states: the running grid and the creator gate
    // their own renders.
    _sigOf() {
      var h = this.client;
      if (!h) return null;
      return this._house().map(function (t) {
        var st = h.states[t.entity];
        return t.entity + '=' + (st ? st.state : 'x');
      }).join(';');
    }
    // EACH NEW CLIENT (either entry of HkBase), then the cards this one hosts.
    _receiveClient() {
      super._receiveClient();
      var self = this, client = this.client;
      [this._run, this._new].forEach(function (c) { if (c) feed(c, client); });
      Object.keys(this._tiles || {}).forEach(function (k) { feed(self._tiles[k], client); });
    }
    static label(mins) {
      return mins < 60 ? mins + ' min' : (mins % 60 ? Math.floor(mins / 60) + ' hr ' + (mins % 60) + ' min' : (mins / 60) + ' hr');
    }
    static hms(mins) {
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(Math.floor(mins / 60)) + ':' + p(mins % 60) + ':00';
    }
    // ONE TAP, ONE TIMER -- and an answer. The allocator returns {started,
    // slot} or {started: false, reason}; see helpers/quick_timers.yaml.
    _quick(mins) {
      var label = HkTimersPageCard.label(mins), self = this;
      if (!this.client) return;
      var ent = this._config.quick_script || 'script.quick_timer_start';
      var parts = ent.indexOf('.') === -1 ? ['script', ent] : ent.split('.');
      if (!this.client.states[parts.join('.')]) {   // the helpers are not installed
        this._setStatus('failed', NO_HELPERS());
        this._render();
        return;
      }
      if (!this._begin('Starting ' + label + '…')) return;
      this._callResp(parts[0], parts[1], { duration: HkTimersPageCard.hms(mins) }).then(function (r) {
        self._end();
        if (!r.ok) self._setStatus('failed', 'Could not reach Home Assistant.');
        else if (r.response && r.response.started === false) self._setStatus('warn', 'Too many timers are running.');
        else self._setStatus('sent', 'Started a ' + label + ' timer.', 4000);
        self._render();
      });
    }
    _build() {
      var self = this, c = this._config;
      this._root.innerHTML = '';
      var pg = document.createElement('div'); pg.className = 'pg';
      var main = document.createElement('div'); main.className = 'main';

      var sqs = document.createElement('div'); sqs.className = 's-qs';
      var hr = document.createElement('div'); hr.className = 'hrow';
      var h1 = document.createElement('div'); h1.className = 'head'; h1.textContent = 'Quick start';
      hr.appendChild(h1); hr.appendChild(this._statusNode());
      sqs.appendChild(hr);
      var qs = document.createElement('div'); qs.className = 'qs';
      this._presets().slice(0, 6).forEach(function (m) {
        var k = document.createElement('div');
        k.className = 'qk';
        k.textContent = HkTimersPageCard.label(m);
        k.setAttribute('aria-label', 'Start a ' + HkTimersPageCard.label(m) + ' timer');
        button(k, function () { self._quick(m); });
        qs.appendChild(k);
      });
      sqs.appendChild(qs);
      main.appendChild(sqs);

      // The heading is the running card's own, so its page dots can sit in it.
      var srun = document.createElement('div'); srun.className = 's-run';
      this._run = create({ type: 'custom:hk-timers-card', fit: true, heading: 'Running', tint: this._tint(),
                           empty_text: c.empty_text || 'Nothing is running.', timers: c.timers || [] });
      srun.appendChild(this._run);
      main.appendChild(srun);

      var sh = document.createElement('div'); sh.className = 's-house';
      var h3 = document.createElement('div'); h3.className = 'head'; h3.textContent = 'House timers';
      sh.appendChild(h3);
      this._hgrid = document.createElement('div'); this._hgrid.className = 'hgrid';
      sh.appendChild(this._hgrid);
      main.appendChild(sh);
      this._shouse = sh;

      var side = document.createElement('div'); side.className = 'side';
      this._new = create({ type: 'custom:hk-timer-new-card', layout: 'panel', tint: this._tint(),
                           create_script: c.create_script || 'script.quick_timer_create',
                           name_chips: c.name_chips || [] });
      side.appendChild(this._new);

      pg.appendChild(main); pg.appendChild(side);
      this._root.appendChild(pg);
      this._built = true;
      if (this.client) { feed(this._run, this.client); feed(this._new, this.client); }
    }
    // The House timers that are IDLE, in order -- a running one is a card
    // in Running instead, never both (the conditions are complements).
    // `timer.start` with no duration runs its configured one.
    _paintHouse() {
      var self = this, h = this.client;
      var idle = this._house().filter(function (t) { var st = h && h.states[t.entity]; return st && st.state === 'idle'; });
      var want = idle.map(function (t) { return t.entity; }).join('|');
      if (want === this._houseKey) return;
      this._houseKey = want;
      this._hgrid.innerHTML = '';
      idle.forEach(function (t) {
        var el = self._tiles[t.entity];
        if (!el) {
          el = self._tiles[t.entity] = create({
            type: 'custom:hk-tile-card', entity: t.entity, name: t.name, icon: t.icon,
            icon_color: 'orange', label_mode: 'duration',
            tap_action: { action: 'perform-action', perform_action: 'timer.start', target: { entity_id: t.entity } }
          });
          feed(el, h);
        }
        self._hgrid.appendChild(el);
      });
      this._shouse.hidden = !idle.length;
    }
    _render() {
      if (!this._config) return;
      if (!this._built) this._build();
      var busy = !!this._busy;
      Array.prototype.forEach.call(this._root.querySelectorAll('.qk'), function (k) {
        k.setAttribute('aria-disabled', busy ? 'true' : 'false');
      });
      this._paintHouse();
      this._shape();
    }
    // STACK BY THE CARD'S OWN WIDTH (see `data-stack` in the CSS), measured
    // rather than asked of a media query, which only knows the window: a
    // 1,280 px tablet with the menu docked has a 980 px page and stacks as
    // an iPad does. The phone keeps its own layout (the 640 px media query).
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      if (!this._ro && typeof ResizeObserver === 'function') {
        this._ro = new ResizeObserver(function () { self._shape(); });
      }
      if (this._ro) this._ro.observe(this);
      this._shape();
    }
    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      if (super.disconnectedCallback) super.disconnectedCallback();
    }
    _shape() {
      var w = this.getBoundingClientRect ? this.getBoundingClientRect().width : 0;
      if (!w) return;
      var stack = w < HkTimersPageCard.STACK_W && (window.innerWidth || 1280) > 640;
      var flip = function (el, name, on) {
        if (!el || on === el.hasAttribute(name)) return;
        if (on) el.setAttribute(name, ''); else el.removeAttribute(name);
      };
      flip(this, 'data-stack', stack);
      // the New Timer panel goes wide (keypad beside its name and chips) only
      // where that fits: a section of someone else's dashboard can stack the
      // page at 352 px, where the wide panel crushed its readout -- there it
      // keeps its own one-column shape, as beside the running timers
      flip(this._new, 'data-wide', stack && w >= 640);
    }
    getCardSize() { return 12; }
  }

  // Narrower than this, the page stacks: at a wall tablet's 1,220 px the keypad
  // sits beside the running timers; at a docked tablet's 932 (and an iPad's
  // 706) the running cards beside it would be ~150 px, too narrow for
  // "2:29:58" and a name.
  HkTimersPageCard.STACK_W = 1000;
  if (!customElements.get('hk-timers-page-card')) {
    customElements.define('hk-timers-page-card', HkTimersPageCard);
  }
  window.customCards.push({
    type: 'hk-timers-page-card',
    name: 'HK Timers Page',
    description: 'The whole Timers page: quick start, running timers, house timers, and the New Timer keypad.',
    preview: false
  });

  // ------------------------------------------------------ hk-timer-strip
  // A HOST, not a card: hk-timers.js owns the markup and the countdown, and
  // this hands it the running list and three presentation flags.
  //
  // THE COUNTDOWN CANNOT BE A RENDERED VALUE. A running timer changes state
  // exactly twice -- at start and at finish -- and everything between is the
  // wall clock moving, which the client never reports. So the number is a
  // <hk-countdown> element that owns its own repaint; this only supplies a
  // deadline. See hk-timers.js.
  //
  // No script injection and no forced update: the module is in hk-loader's
  // list, and HkBase re-renders on signature change.
  class HkTimerStripCard extends HkBase {
    // The one-shot hk-timers-ready listener, held only while attached: a
    // strip detached before the module arrives would otherwise keep the
    // listener -- and itself -- until hk-timers.js loads, then redraw a card
    // nobody can see. Re-attaching before the module lands wires it again.
    _wire() {
      if (window.hkTimers || this._onTimersReady) return;
      var self = this;
      this._onTimersReady = function () {
        self._unwire();
        self.redraw();
      };
      window.addEventListener('hk-timers-ready', this._onTimersReady);
    }
    _unwire() {
      if (!this._onTimersReady) return;
      window.removeEventListener('hk-timers-ready', this._onTimersReady);
      this._onTimersReady = null;
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this._built) this._wire();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      this._unwire();
    }
    static get CSS() {
      // (Large's rules and Extra Large's, 2026-11-07: a selector list over both)
      var lx = (sel, body) => ':host([size=L]) ' + sel + ',:host([size=XL]) ' + sel + '{' + body + '}';
      return [
        'hk-plate.strip{background:none;box-shadow:none;border:none;  padding:0;margin:0;display:block}',
        // The screensaver's row is wrapped in a position:fixed div by strip()
        // itself, so its host must take no space and must not clip.
        'hk-plate.strip.fixed{height:0;overflow:visible}',
        '.strip > div{min-width:0;overflow:hidden}',
        // EACH RUNNING TIMER IS ONE PIECE (mockup 5, approved 2026-11-09, "Proposed -- three running"): its name over its ring -- time left in
        // orange round its track, the time INSIDE it in light, tabular numbers -- and right under the ring two round keys, Pause (Resume)
        // and the red Stop, side by side. The ring is no longer the pause key: it is drawn, not a button. The keys are 56 px targets
        // (44 on screen) 8 px apart, the disc drawn smaller inside. Extra Large three timers across, Large two, Tall one ("+N more"
        // under it), Wide two with the keys BESIDE each ring (stacked), Small the ring alone: the block's tap opens the Timers page.
        // None running, quick starts as keys and an orange + (below). Tile cells first, a square cell's sizes after.
        ':host([size]) hk-plate.strip{position:relative;display:flex;flex-direction:column;justify-content:center;gap:8px;box-sizing:border-box;',
        '  height:100%;padding:' + window.hkCards.blockPad('14px') + ';' + window.hkCards.plate('card') + ';overflow:hidden;--ring:96px}',
        '.strip > div.tg{overflow:visible}.tg{display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));grid-auto-rows:minmax(0,1fr);align-content:center;gap:var(--rg,8px) var(--hk-pad-l,18px);flex:1 1 auto;min-height:0}',
        '.gt{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;min-height:0}',
        // THE TIMER'S TITLE (2026-11-09, the owner: "We don't need the word Timer as a title, it should go. Title of the timer itself, yes, it needs to [match] the rest of the title/headings."): a named timer's name in the block heading (hkCards.headCss: gray, 13 / 600) on the heading row; a timer with no name of its own has no title -- its row stays, so the rings line up (mockup 5) -- and the block's own name ("Timers") is never printed
        window.hkCards.headRowCss('.gt .hd') + '.gt .hd{height:22px;margin-bottom:8px;justify-content:center;align-self:stretch}' + window.hkCards.headCss('.gt .nm') +
        // (READABLE FROM ACROSS THE ROOM, 2026-11-09, the owner: "The text above the active timers should probably be bigger right? And so should the
        // time inside the circle. It needs to be readable"): the name 17 / 600 in the first ink, not the 13 px gray heading; the time 25 % of the ring
        // in a medium weight (it was 21 % light), an hour or more (h:mm:ss, seven figures) 19 % so it stays inside the ring
        '.gt .nm{font-size:17px;line-height:22px;font-weight:600;color:' + window.hkCards.v('ink') + '}',
        '.gt .rg{display:flex;flex-direction:column;align-items:center;gap:8px;flex:none}',
        '.gt .rw{position:relative;flex:none;width:var(--ring);height:var(--ring);display:grid;place-items:center}',
        // (the countdown is the ring's child: it writes the fraction left, --hk-left, on the ring, and the circle reads it)
        '.gt .rw svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}',
        '.gt .rw circle{fill:none;stroke-width:8px;stroke:' + window.hkCards.v('line-strong') + '}',
        '.gt .rw .left{stroke:' + window.hkCards.ACCENTS.orange + ';stroke-linecap:round;stroke-dasharray:calc(var(--hk-left,1)*100) 100}',
        '.gt.hr .rw hk-countdown{font-size:calc(var(--ring) * 0.19)}.gt .rw hk-countdown{position:relative;display:block;font-size:calc(var(--ring) * 0.25);font-weight:500;letter-spacing:-0.02em;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;color:' + window.hkCards.v('ink') + '}',
        '.gt.held .rw hk-countdown{color:' + window.hkCards.v('ink-2') + '}',
        // KEYS A FINGER CAN HIT (2026-11-09, mockup 14b, the owner: "should the touch services for the timers be easier for a finger to hit? The same small and close together"): 52 px discs in 56 px targets, 14 px between the discs -- the targets 10 px clear of each other
        '.gt .kk{display:flex;gap:10px;flex:none}',
        '.gt .pr,.gt .stop{all:unset;box-sizing:border-box;position:relative;flex:none;width:56px;height:56px;display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.gt .pr::before,.gt .stop::before{content:"";position:absolute;inset:2px;border-radius:50%;background:' + window.hkCards.v('line-strong') + '}',
        '.gt .stop::before{background:' + window.hkCards.ACCENTS.red + '}',
        '.gt .pr hk-icon,.gt .stop hk-icon{position:relative;width:22px;height:22px;--mdc-icon-size:22px;color:' + window.hkCards.v('ink') + '}.gt .stop hk-icon{color:#fff}',
        '.gt .pr:active::before,.gt .stop:active::before{transform:scale(0.95)}.gt .pr:focus-visible,.gt .stop:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:-2px;border-radius:50%}',
        // WIDE: each timer's keys BESIDE its ring, stacked (mockup 5)
        // (a tile cell's Wide is 117 px inside its inset, the two keys stacked 120: the name sits over the ring alone, the keys span the unit's height and may use the inset's last pixels)
        ':host([size=W]) .gt:not(.idle){display:grid;grid-template-columns:var(--ring) 56px;grid-template-rows:auto auto;column-gap:6px;justify-content:center;align-content:center;align-items:center}',
        ':host([size=W]) .gt:not(.idle) .rg{display:contents}:host([size=W]) .gt .hd{grid-column:1;grid-row:1}:host([size=W]) .gt .rw{grid-column:1;grid-row:2}',
        // (Wide's keys, 2026-11-09, the owner: "the Pause and stop buttons seem weirdly aligned. They could probably align with the bottom of the
        // ring and the top of the text"): the column spans the name and the ring -- Pause's top on the name's top, Stop's foot on the ring's foot
        ':host([size=W]) .gt:not(.idle) .kk{grid-column:2;grid-row:1 / 3;flex-direction:column;align-self:stretch;justify-content:space-between}',
                ':host([size=W]) hk-plate.strip{--ring:96px}:host([size=S]) hk-plate.strip{--ring:96px}',
        ':host([size=T]) hk-plate.strip{--ring:128px}:host([size=L]) hk-plate.strip{--ring:136px}:host([size=XL]) hk-plate.strip{--ring:136px}',
        // (a tile cell's block is the smaller: the ring gives way before the keys do)
        '@container hk-cell (max-height:180px) and (not style(--hk-cell-shape: square)){:host([size=S]) hk-plate.strip,:host([size=W]) hk-plate.strip{--ring:84px}}',
        ':host([size=T]) .tg,:host([size=L]) .tg{--rg:10px}',
        // ALWAYS A WAY TO ADD A TIMER (2026-11-09, mockup 14b, the owner: "There needs to be a way to add a timer at all times with these cards."): a plain orange + at the plate's top right on every running size -- a 52 px disc in a 56 px target, 6 px from the edges (the disc is then concentric with the plate's corner), a white plus; it opens the New Timer sheet. Where Extra Large has the maker beside its timers, the maker is the way and there is no +
        '.pl{all:unset;box-sizing:border-box;position:absolute;top:6px;right:6px;z-index:2;width:56px;height:56px;display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.pl::before{content:"";position:absolute;inset:2px;border-radius:50%;background:' + window.hkCards.ACCENTS.orange + '}.pl hk-icon{position:relative;width:28px;height:28px;--mdc-icon-size:28px;color:#fff}.pl:active::before{transform:scale(0.95)}',
        '.pl:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:-2px;border-radius:50%}',
        // (Small's ring from the left inset to the +'s disc, 60 px in, under the name, never under 84 -- the owner, 2026-11-09: "treat the right edge of the timer where the left edge of the + button is")
        // (...only while a timer runs: with none, "Start a Timer" and its + sit in the middle of the block -- the owner, 2026-11-10)
        ':host([size=S]) hk-plate.strip{--ring:max(84px,min(calc(100cqw - var(--hk-pad-l,14px) - 60px),calc(100cqh - var(--hk-pad-t,14px) - var(--hk-pad-b,14px) - 30px)))}:host([size=S]) .gt:not(.idle){justify-content:flex-end;justify-self:start;width:var(--ring)}:host([size=W]) .mf{position:absolute;right:var(--hk-pad-r,14px);bottom:var(--hk-pad-b,14px)}',
        '.mf{flex:none;' + window.hkCards.typeCss('caption') + ';color:' + window.hkCards.v('ink-2') + ';text-shadow:' + window.hkCards.v('glow') + '}',
        // NONE RUNNING (2026-11-08, the owner: "the card when no timer is displayed is not good looking at all"): the running timer's own
        // column -- the orange name, a line in the time's light type in place of the time ("Start a timer"), and in place of the ring and
        // Stop the quick starts as rings: each draws its length as the share of an hour its orange arc covers, the length inside, and an
        // orange + for any other. A grid (Tall, Large, Extra Large) fills the block, the rings --k to what it leaves them
        '.qs{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:auto;padding-top:8px}.qs.g{display:grid;grid-template-columns:repeat(var(--qc),var(--k));justify-content:center;align-content:center;flex:1 1 auto;margin-top:0}',
        // THE DIRECTION over the preset rings (mockup 5): one line, the headline's size, centered with them as one group
        '.gt.dg{flex:1 1 auto;align-items:center;justify-content:center}.gt.dg .qs.g{flex:none;padding:0;gap:12px}',
        '.gt .dir{display:block;' + window.hkCards.typeCss('headline') + ';line-height:22px;color:' + window.hkCards.v('ink') + ';text-shadow:' + window.hkCards.v('glow') + ';text-align:center;white-space:nowrap;margin:0 0 14px}',
        // EXTRA LARGE'S MAKER (mockup 5c): the presets' column on the left, the New Timer card's block layout filling the right
        '.gt.mkr{display:grid;align-items:stretch;grid-template-columns:196px minmax(0,1fr);column-gap:13px;flex:1 1 auto;min-height:0}',
        '.gt.mkr .ql{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0}.gt.mkr .qs.g{flex:none;padding:0;gap:14px}',
        '.gt.mkr .mk{min-width:0;min-height:0;height:100%}',
        // EXTRA LARGE WITH ONE OR TWO RUNNING (mockup 14b): the timers, and the maker beside them -- the New Timer card's block layout, 288-340 px
        '.xm{display:grid;grid-template-columns:minmax(0,1fr) var(--mw,320px);column-gap:13px;align-items:stretch;flex:1 1 auto;min-height:0}.xm .tg{flex:none;min-height:0}.xm .mk{min-width:0;min-height:0;height:100%}',
        // LARGE, NOTHING RUNNING (mockup 14b, the owner: "the roller to create a new timer isn't implemented here. I'd like that to be added to the Large and X-Large card as well."): the headline in the UPPER LEFT (DESIGN.md "The headline is the upper left, across the board"; the mockup centered it, the rule wins), four preset rings across in 56 px targets, then the maker -- the wheels, a name where the room allows, Start
        '.gt.idle.lg{align-items:stretch;justify-content:flex-start;gap:8px;flex:1 1 auto}.gt.lg .dir{text-align:left;margin:0}.gt.lg .qs{display:flex;justify-content:space-between;align-items:center;gap:0;margin:0;padding:0;flex:none}.gt.lg .mk{flex:1 1 0;min-height:0;min-width:0}',
        '.rk{all:unset;box-sizing:border-box;position:relative;flex:none;width:var(--k);height:var(--k);border-radius:50%;display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.rk svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}.rk circle{fill:none;stroke-width:10px;stroke:' + window.hkCards.v('line-strong') + '}',
        '.rk .left{stroke:' + window.hkCards.ACCENTS.orange + ';stroke-linecap:round;stroke-dasharray:var(--a) 100}',
        '.rk b{position:relative;font-size:max(13px,calc(var(--k) * 0.3));font-weight:600;letter-spacing:-0.02em;color:' + window.hkCards.v('ink') + ';font-variant-numeric:tabular-nums}',
        '.rk.add{background:' + window.hkCards.ACCENTS.orange + ';color:#fff}.rk.add hk-icon{width:calc(var(--k) * 0.46);height:calc(var(--k) * 0.46);--mdc-icon-size:calc(var(--k) * 0.46)}.rk:active{transform:scale(0.95)}',
        '.rk:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}'
      ].join('');
    }
    getCardSize() { return 1; }
    // (a block's tap, hk-base.js openTarget) the Timers page
    _tapTarget() { return [{ page: 'timers' }]; }
    _gridTap() {
      if (this._tapWired) return;
      this._tapWired = true;
      this._e.addEventListener('click', (e) => {
        var button = e.target.closest('button'); if (!button) return;
        e.stopPropagation();
        if (button.dataset.new !== undefined) { this._newGridTimer(); return; }
        if (button.dataset.preset) {
          var mins = Number(button.dataset.preset);
          this._callResp('script', 'quick_timer_start', { duration: HkTimersPageCard.hms(mins) }).then((r) => {
            if (!r.ok || r.response && r.response.started === false) this._newGridTimer();
          }); return;
        }
        if (button.dataset.timer) this._call('timer', button.dataset.service, { entity_id: button.dataset.timer });
        else { var M = window.hkCards.menu, path = M && M.pagePath('timers'); if (path) window.hkCards.navigate(path, this); }
      });
    }
    // THE EXTRA LARGE MAKER'S CARD: one New Timer card (layout: block), made once and kept, put into the block's place for it
    // whenever that place is drawn; the client handed on each time
    _mountMaker() {
      var mk = this._e && this._e.querySelector('.mk');
      if (!mk) return;
      if (!this._maker) {
        this._maker = window.hkCards.create({ type: 'custom:hk-timer-new-card', layout: 'block',
          name_chips: (window.hkSettings && window.hkSettings.get('headers.timers.names', null)) || undefined });
      }
      if (!this._maker) return;
      if (this._maker.parentNode !== mk) mk.appendChild(this._maker);
      if (mk.hasAttribute('data-noname')) this._maker.setAttribute('data-noname', ''); else this._maker.removeAttribute('data-noname');
      if (this.client && this._maker.hkSetClient) this._maker.hkSetClient(this.client);
    }
    _newGridTimer() {
      var D = window.hkDetail;
      // (the Timers page's own New Timer sheet, 2026-11-09: the sheet is the plate -- no second plate inside it -- and it goes
      // once the timer starts)
      if (D) D.open(null, { name: 'New Timer', icon: 'mdi:timer-plus-outline', icon_color: window.hkCards.ACCENTS.orange }, {
        cards: { cards: [{ type: 'custom:hk-timer-new-card', layout: 'sheet', glass: false, close_on_start: true,
          name_chips: (window.hkSettings && window.hkSettings.get('headers.timers.names', null)) || undefined }] }
      });
    }
    _grid(list, sized) {
      this._watchBlock();
      var states = this.client && this.client.states || {}, T = window.hkTimers, esc = window.hkCards.esc;
      var rows = (list || []).filter((r) => r && r.entity_id).map((r) => ({ id: r.entity_id, name: r.name, attrs: Object.assign({}, r, states[r.entity_id] && states[r.entity_id].attributes), state: states[r.entity_id] && states[r.entity_id].state || 'active' }));
      Object.keys(states).filter((id) => /^timer\.(quick|hk_timer)_/.test(id) && states[id].state === 'paused').forEach((id) => {
        if (!rows.some((r) => r.id === id)) rows.push({ id: id, name: states[id].attributes.friendly_name, attrs: states[id].attributes, state: 'paused' });
      });
      rows = rows.filter((r) => r.state === 'paused' || r.attrs.finishes_at && !isNaN(Date.parse(r.attrs.finishes_at)))
        .sort((a, b) => (Date.parse(a.attrs.finishes_at) || Infinity) - (Date.parse(b.attrs.finishes_at) || Infinity));
      var presets = (window.hkSettings && window.hkSettings.get('headers.timers.presets', null)) || [5, 10, 15, 20, 30, 60];
      var short = (m) => m < 60 ? m + 'm' : m % 60 ? Math.floor(m / 60) + 'h' + (m % 60) : m / 60 + 'h';
      var b = this._block(), cs = typeof getComputedStyle === 'function' ? getComputedStyle(this) : null, pd = (k) => cs && parseFloat(cs.getPropertyValue('--hk-pad-' + k)) || 14;
      var iw = b ? b.w - pd('l') - pd('r') : 168, ih = b ? b.h - pd('t') - pd('b') : 286, big = sized === 'T' || sized === 'L' || sized === 'XL';
      // NONE RUNNING: the quick starts (Settings' presets) as rings, + for the rest; nothing stretches (the owner, 2026-11-08) -- each size has its one ring size, as many as it shows, the group centered
      var ring = (m) => '<button class="rk" data-preset="' + Number(m) + '" style="--a:' + Math.min(100, Number(m) * 100 / 60) + '" aria-label="Start a ' + esc(HkTimersPageCard.label(Number(m))) + ' timer"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45"></circle><circle class="left" cx="50" cy="50" r="45" pathLength="100"></circle></svg><b>' + esc(short(Number(m))) + '</b></button>';
      var plus = '<button class="rk add" data-new aria-label="Create a Timer"><hk-icon icon="mdi:plus"></hk-icon></button>';
      // (the rings as big as the room gives: cols x rows of them under the direction's line, 12 px apart -- 14 on Extra Large's)
      var fitK = (cols, rows, max, w, gap) => Math.max(40, Math.min(max, Math.floor(((w || iw) - (cols - 1) * gap) / cols), Math.floor((ih - 36 - (rows - 1) * gap) / rows)));
      // THE MAKER'S ROWS (the New Timer card's block layout in a place H high): the wheels' row height from what the card's chrome leaves -- its tile's padding (30 px; the tight Large's 18), Start's 56 and the name's 56 with the gaps between -- and the name only where the rows stay readable
      var mkOf = (H, tight) => {
        var padv = tight ? 18 : 30, gap = tight ? 8 : 10, lo = tight ? 18 : 26, rowN = Math.floor((H - padv - 112 - 2 * gap) / 5), named = rowN >= (tight ? 26 : 30), row = Math.max(lo, Math.min(40, named ? rowN : Math.floor((H - padv - 56 - gap) / 5)));
        return { named: named, attrs: ' data-keep data-notap' + (named ? '' : ' data-noname') + ' style="--hk-mk-row:' + row + 'px;--hk-mk-fs:' + Math.max(17, Math.round(row * 0.6)) + 'px' + (tight ? ';--hk-mk-pad:8px 12px 10px;--hk-mk-gap:8px' : '') + '"' };
      };
      var idle = () => {
        var S = sized;
        // SMALL (2026-11-09, the owner: "The button is getting clipped. Also the font here, doesn't seem to match anything else"): the direction over its one key,
        // the orange + that opens the New Timer sheet; not a "Start a timer" pill wider than the block under "None running" in the countdown's light type
        if (S === 'S') return '<div class="gt idle dg"><span class="dir">Start a Timer</span><div class="qs g" style="--k:' + fitK(1, 1, 72, 0, 12) + 'px;--qc:1">' + plus + '</div></div>';
        // NONE RUNNING (the owner's mockup 5, approved 2026-11-09: "It's not really a heading though, but more of a direction"): "Start a
        // Timer" one line at the body's headline size, right over the preset rings, the two one group centered in the block -- Wide
        // three and +, a row; Tall five and +, two across; Large five and +, three across
        if (S === 'L') {
            var pk = [5, 10, 15, 30].filter((m) => presets.indexOf(m) >= 0), lk = mkOf(ih - 22 - 56 - 16, true);   // (the heading, the 56 px rings, two gaps)
          presets.forEach((m) => { if (pk.length < 4 && pk.indexOf(m) < 0) pk.push(m); });
          return '<div class="gt idle lg"><span class="dir">Start a Timer</span><div class="qs g" style="--k:56px;--qc:4">' + pk.slice(0, 4).map(ring).join('') +
            '</div><div class="mk"' + lk.attrs + '></div></div>';
        }
        if (S !== 'XL') {
          // (Wide and Tall hold three controls at most -- the owner's round three, 2026-11-08: two presets and +)
          var L = { W: [3, 1, 64, 2], T: [1, 3, 72, 2], L: [3, 2, 92, 5] }[S] || [3, 2, 92, 5], k = fitK(L[0], L[1], L[2], 0, 12);
          return '<div class="gt idle dg"><span class="dir">Start a Timer</span><div class="qs g" style="--k:' + k + 'px;--qc:' + L[0] + '">' +
            presets.slice(0, L[3]).map(ring).join('') + plus + '</div></div>';
        }
        // EXTRA LARGE MAKES ONE (mockup 5c, 2026-11-09, "Yes, build it"): the six presets under the direction on the left, and on
        // the right the New Timer card in its block layout -- the wheels, a name and Start. Its place keeps what is mounted in it
        // (data-keep: the block's morph leaves the card and its wheels alone); the wheels' rows are what the block's height gives
        // (the tile's 30 px of padding, Start's 56 and the name's 56, 10 px between: the rest is the wheels' five rows)
        var xk = mkOf(ih, false);
        var kx = fitK(2, 3, 84, 196, 14);
        return '<div class="gt idle mkr"><div class="ql"><span class="dir">Start a Timer</span><div class="qs g" style="--k:' + kx + 'px;--qc:2">' +
          presets.slice(0, 6).map(ring).join('') + '</div></div><div class="mk"' + xk.attrs + '></div></div>';
      };
      if (!rows.length) return '<div class="tg">' + idle() + '</div>';
      // (2026-11-09, mockup 5: Extra Large three across, Large two, Tall one with "+N more" under it, Wide two, Small one)
      // (Wide shows one: a second timer's keys have no room beside the + at the top right -- 2026-11-09, mockup 14b; "+N more" at its foot)
      var nn = rows.length, max = { S: 1, T: 1, W: 1, L: 2, XL: 3 }[sized] || 1, shown = rows.slice(0, max), left = nn - shown.length;
      var cols = sized === 'XL' ? 3 : sized === 'L' ? 2 : 1;
      // EXTRA LARGE WITH ONE OR TWO RUNNING keeps the maker beside them (14b): the maker 288-340 px, each timer at least its two keys wide (122 px) -- as many timers as fit beside a 288 px maker; where none fit (or three or more run) the timers take the block, with the +
      var maker = '', mw = 0, ringX = 0;
      var fit = sized === 'XL' && nn <= 2 ? Math.min(nn, Math.floor((iw - 13 - 288 + 18) / 140)) : 0;
      if (fit >= 1) {
        mw = Math.min(340, iw - 13 - (fit * 122 + (fit - 1) * 18)); ringX = Math.min(136, Math.floor((iw - 13 - mw - (fit - 1) * 18) / fit));
        shown = rows.slice(0, fit); left = nn - fit; cols = fit; maker = mkOf(ih - (left ? 28 : 0), false);
      }
      var units = shown.map(function (r) {
        var paused = r.state === 'paused', total = T ? T.secs(r.attrs.duration) : 0, nm = esc(r.name || 'Timer'), ttl = r.name && !/^(quick |hk )?timer( \d+)?$/i.test(r.name.trim()) ? '<b class="nm">' + nm + '</b>' : '';  // (the hub's own "Timer" for one without a name is no name)
        var clock = paused ? 'hold="' + (T ? T.secs(r.attrs.remaining) : 0) + '"' : 'deadline="' + Date.parse(r.attrs.finishes_at) + '"';
        // (the countdown is the ring's child: it writes the fraction left, --hk-left, on the ring, and the circle reads it; the heading row is always there, empty for an unnamed timer, so the rings line up)
        var keys = sized === 'S' ? '' : '<div class="kk"><button class="pr" data-timer="' + esc(r.id) + '" data-service="' + (paused ? 'start' : 'pause') + '" aria-label="' + (paused ? 'Resume' : 'Pause') + ' ' + nm + '"><hk-icon icon="mdi:' + (paused ? 'play' : 'pause') + '"></hk-icon></button>' +
          '<button class="stop" data-timer="' + esc(r.id) + '" data-service="cancel" aria-label="Stop ' + nm + '"><hk-icon icon="mdi:stop"></hk-icon></button></div>';
        var secsLeft = paused ? (T ? T.secs(r.attrs.remaining) : 0) : (Date.parse(r.attrs.finishes_at) - Date.now()) / 1000;
        return '<div class="gt' + (paused ? ' held' : '') + (secsLeft >= 3600 ? ' hr' : '') + '"><div class="hd">' + ttl + '</div><div class="rg"><div class="rw">' +
          '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"></circle><circle class="left" cx="50" cy="50" r="46" pathLength="100"></circle></svg>' +
          '<hk-countdown ' + clock + ' total="' + total + '"></hk-countdown></div>' + keys + '</div></div>';
      });
      var add = '<button class="pl" data-new aria-label="Add a timer"><hk-icon icon="mdi:plus"></hk-icon></button>', more = left && sized !== 'S' ? '<div class="mf">+' + left + ' more</div>' : '';
      if (maker) return '<div class="xm" style="--mw:' + mw + 'px"><div class="tg" style="--cols:' + cols + ';--ring:' + ringX + 'px">' + units.join('') + '</div><div class="mk"' + maker.attrs + '></div></div>' + more;
      return add + '<div class="tg" style="--cols:' + cols + '">' + units.join('') + '</div>' + more;
    }
    _sigOf() {
      var h = this.client;
      if (!h) return null;
      var s = h.states[this._config.entity || 'sensor.running_quick_timers'];
      // The module may arrive after the first render; until it does there is
      // nothing to draw, so fold its presence into the signature.
      if (!this._cellSize()) return (s ? s.last_updated : 'x') + '|' + (window.hkTimers ? '1' : '0');
      return JSON.stringify([s, Object.keys(h.states).filter((id) => /^timer\.(quick|hk_timer)_/.test(id)).map((id) => h.states[id]), !!window.hkTimers]);
    }
    _render() {
      var cfg = this._config;
      if (!this._built) {
        this._root.innerHTML = '<hk-plate class="strip' +
          (cfg.fixed ? ' fixed' : '') + '" data-hk-role="card"></hk-plate>';
        this._e = this._root.querySelector('.strip');
        // The module loads in parallel with this card. One listener, once,
        // and only while the card is attached (see _wire).
        this._wire();
        this._built = true;
      }
      var T = window.hkTimers, sized = this._cellSize();
      if (sized) {
        var on = this._st(cfg.entity || 'sensor.running_quick_timers');
        var html0 = this._grid(on && on.attributes && on.attributes.running, sized);
        this._gridTap();
        window.hkCards.morph(this._e, html0);
        this._mountMaker();
        // THE COUNTDOWNS PAINT AGAIN NOW: the morph took their text and their
        // column's --hk-left (neither is in the markup), and each skips a write
        // it thinks it has made -- the ring sat full, the time blank, until the
        // next second or hundredth moved (hk-timers.js paint)
        this._e.querySelectorAll('hk-countdown').forEach(function (cd) {
          cd._hkLast = null;
          if (cd.parentElement) cd.parentElement._hkFrac = null;
          cd.setAttribute('total', cd.getAttribute('total') || '0');
        });
        return;
      }
      // '' is a CORRECT rendering, not a failure: with no timers running the
      // card draws nothing, and drawing nothing is what keeps it from leaving
      // a gap above the player in the pop-up.
      var html = '';
      if (T) {
        var st = this._st(cfg.entity || 'sensor.running_quick_timers');
        var list = st && st.attributes && st.attributes.running;
        // DOCKED (the docked now-playing bar's timers): each with its whole
        // length, for the ring of time left -- the timer's own `duration`,
        // which is what it was last started with
        if (cfg.docked && Array.isArray(list)) {
          var states = (this.client && this.client.states) || {};
          list = list.map(function (r) {
            var t = r && r.entity_id && states[r.entity_id];
            var d = t && t.attributes && T.secs(t.attributes.duration);
            return d > 0 ? Object.assign({}, r, { total: d }) : r;
          });
        }
        html = T.strip(list, {
          docked: !!cfg.docked,
          scale: Number(cfg.scale) || 1,
          fixed: !!cfg.fixed,
          plated: !!cfg.plated,
          // `glass` needs `plated`: it swaps the plate's material, it does not
          // add one. See hk-timers.js.
          glass: !!cfg.glass
        });
      }
      window.hkCards.morph(this._e, html);
    }
  }

  // Field labels and help text live in hk-base.js (HK_LABELS / HK_HELPERS).
  // NO SCRIPT IN EITHER STUB. Both scripts are OPTIONAL overrides -- unset,
  // the area picker calls hk_frontend.clean_areas and the timer keypad the
  // shipped script.quick_timer_create -- and a stub that filled in "the
  // first script in the house" would make a card placed from the picker run
  // an arbitrary script on its first tap.
  wireEditor('hk-area-select-card', HkAreaSelectCard, [
    { name: 'start_script', selector: { entity: { filter: { domain: 'script' } } } },
    // Empty (the default): the rooms HK Clean Areas offers, by Home
    // Assistant's floors, live. Or a list of {name, areas:[{id, name}]} -- `id`
    // is the AREA ID (the vacuum's clean_area takes area ids, not the vendor's
    // own room names).
    { name: 'floors', selector: { object: {} } },
    // the rooms' order within a floor (automatic rooms only)
    { name: 'order', selector: { area: { multiple: true } } }
  ], function () {
    return { floors: [] };
  });

  wireEditor('hk-timer-new-card', HkTimerNewCard, [
    { name: 'create_script', selector: { entity: { filter: { domain: 'script' } } } },
    { name: 'name_chips', selector: { text: { multiple: true } } }
  ], function () {
    return { name_chips: ['Pasta', 'Oven', 'Laundry'] };
  });

  wireEditor('hk-timers-page-card', HkTimersPageCard, [
    // the same {entity, label, glyph, label_entity} rows as hk-timers-card
    { name: 'timers', selector: { object: {} } },
    // {entity, name, icon} -- started with timer.start while idle
    { name: 'house', selector: { object: {} } },
    { name: 'presets', selector: { object: {} }, helper: 'Up to six durations in minutes, e.g. [5, 10, 15, 20, 30, 60].' },
    { name: 'name_chips', selector: { text: { multiple: true } } },
    { name: 'quick_script', selector: { entity: { filter: { domain: 'script' } } } },
    { name: 'create_script', selector: { entity: { filter: { domain: 'script' } } } },
    { name: 'empty_text', selector: { text: {} } },
    { name: 'tint', selector: { text: {} },
      helper: 'A CSS color, e.g. rgba(255, 159, 10, 0.95). Default orange.' }
  ], function (client) {
    // no `house:` -- an empty list would override General -> House Timers.
    // The quick-timer slots when they are installed (helpers/quick_timers.yaml),
    // listed as a generated Timers page lists them: with no `timers` the card
    // never shows a running quick timer.
    var st = (client && client.states) || {}, timers = [];
    [1, 2, 3, 4].forEach(function (i) {
      var id = 'timer.quick_' + i, nm = 'input_text.quick_timer_' + i + '_name';
      if (!st[id]) return;
      var t = { entity: id, label: 'Quick Timer ' + i, glyph: 'mdi:timer-outline' };
      if (st[nm]) t.label_entity = nm;
      timers.push(t);
    });
    return { timers: timers, name_chips: ['Pasta', 'Oven', 'Laundry'], empty_text: 'Nothing is running.' };
  });

  wireEditor('hk-timers-card', HkTimersCard, [
    // {entity, label, glyph, label_entity} per row.
    { name: 'timers', selector: { object: {} } },
    { name: 'empty_text', selector: { text: {} } },
    { name: 'tint', selector: { text: {} },
      helper: 'A CSS color, e.g. rgba(255, 159, 10, 0.95). Default orange.' }
  ], function (client) {
    // A stub with an empty list previews as a bare "nothing running" strip,
    // which tells the picker nothing. Name a real timer if the house has one.
    var t = firstOfDomain(client, 'timer');
    return {
      timers: t.indexOf('.example') === -1
        ? [{ entity: t, label: 'Timer', glyph: 'mdi:timer-outline' }] : [],
      empty_text: 'Nothing is running.'
    };
  });

  register('hk-vacuum-card', HkVacuumCard, 'HK Vacuum',
    'A robot vacuum with its status, battery and controls.',
    C && [
      { name: 'entity', required: true, selector: { entity: { filter: { domain: 'vacuum' } } } },
      { name: 'name', selector: { text: {} } },
      C.section('Sensors', [
        { type: 'grid', name: '', schema: [
          { name: 'battery', selector: { entity: { filter: { domain: 'sensor' } } } },
          // `room` here is a SENSOR, not the text a tile's `room` is.
          { name: 'room', label: 'Current room sensor', helper: 'The room it is cleaning now.',
            selector: { entity: { filter: { domain: 'sensor' } } } },
          { name: 'progress', selector: { entity: { filter: { domain: 'sensor' } } } },
          { name: 'error', selector: { entity: { filter: { domain: 'sensor' } } } },
          { name: 'dock_error', selector: { entity: { filter: { domain: 'sensor' } } } }
        ] }
      ], 'mdi:gauge', true),
      C.section('Interactions', [
        { name: 'tap_action', selector: { ui_action: {} } }
      ], 'mdi:gesture-tap')
    ],
    function (client) { return { entity: firstOf(client, 'vacuum') }; });

  register('hk-timer-strip-card', HkTimerStripCard, 'HK Timer Strip',
    'A compact row of live countdowns for the running quick timers.',
    C && [
      { name: 'entity', label: 'Running timers sensor',
        helper: 'Default: sensor.running_quick_timers', selector: { entity: { filter: { domain: 'sensor' } } } },
      { type: 'grid', name: '', schema: [
        { name: 'scale', selector: { number: { min: 0.5, max: 3, step: 0.1, mode: 'box' } } },
        { name: 'fixed', selector: { boolean: {} } },
        { name: 'plated', selector: { boolean: {} } },
        { name: 'glass', helper: 'Translucent plate, to match the now-playing bar. Needs Plated.',
          selector: { boolean: {} } },
        { name: 'docked', label: 'Docked',
          helper: 'A slim row for a docked bar: soonest first, with a ring of time left.',
          selector: { boolean: {} } }
      ] }
    ],
    function () { return { entity: 'sensor.running_quick_timers' }; });

  window.hkHome = { version: '1.0.0', picked: PICKED };
  });
})();
