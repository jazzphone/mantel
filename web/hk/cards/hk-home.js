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
  class HkVacuumCard extends HkBase {
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
        'hk-plate.vac{box-sizing:border-box;display:block;min-height:188px;',
        '  border-radius:' + window.hkCards.M.radius + ';padding:16px 18px;overflow:hidden;cursor:pointer;',
        '  ' + window.hkCards.M.glass + ';',
        '  border:' + window.hkCards.M.border + ';',
        '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-tall') + ');',
        '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
        '.vac .grid{display:grid;min-height:156px;',
        '  grid-template-areas:"ico label label label" "meta meta meta meta" "start pause locate home";',
        '  grid-template-columns:52px 1fr 1fr 1fr;',
        '  grid-template-rows:52px min-content 1fr;',
        '  column-gap:14px;row-gap:10px;align-items:center}',
        '.vac .ico{grid-area:ico;justify-self:start;width:52px;height:52px;',
        '  border-radius:26px;display:flex;align-items:center;justify-content:center;',
        '  background:' + window.hkCards.v('key-strong') + ';transition:background-color .25s ease}',
        // LIVE is green with dark ink -- the same "it is doing something right
        // now" signal the progress chip uses.
        '.vac .ico[data-live="1"]{background:rgba(48,209,88,0.95)}',
        '.vac .ico hk-icon{--mdc-icon-size:28px;width:28px;height:28px;',
        '  color:var(--hk-glyph,rgba(255,255,255,0.80))}',
        '.vac .ico[data-live="1"] hk-icon{color:rgba(0,0,0,0.82)}',
        '.vac .label{grid-area:label;justify-self:start;align-self:center;',
        '  min-width:0;overflow:hidden;font-size:18px;font-weight:600;',
        '  letter-spacing:-0.45px;color:' + window.hkCards.v('ink') + ';line-height:1.25;',
        '  text-align:left;white-space:nowrap;text-overflow:ellipsis;width:100%}',
        '.vac .meta{grid-area:meta;justify-self:start;align-self:center;',
        '  min-width:0;display:flex;flex-wrap:wrap;gap:7px}',
        '.vac .chip{display:inline-flex;align-items:center;gap:5px;',
        '  padding:4px 10px;border-radius:11px;font-size:12px;font-weight:600;',
        '  letter-spacing:0.1px;line-height:1.25;white-space:nowrap;',
        '  background:' + window.hkCards.v('key') + ';color:' + window.hkCards.v('ink') + '}',
        '.vac .chip.warn{background:rgba(255,159,10,0.92);color:rgba(0,0,0,0.85)}',
        '.vac .chip.bad{background:rgba(255,69,58,0.92);color:rgba(0,0,0,0.85)}',
        '.vac .chip.err{background:rgba(255,69,58,0.95);color:rgba(255,255,255,0.97)}',
        '.vac .chip.good{background:rgba(48,209,88,0.92);color:rgba(0,0,0,0.85)}',
        '.vac .cmd{justify-self:stretch;height:52px;border-radius:18px;padding:0;',
        '  border:none;box-shadow:none;background:' + window.hkCards.v('key') + ';',
        '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
        '  transition:background-color .25s ease,transform .12s ease}',
        '.vac .cmd:active{transform:scale(0.97);filter:brightness(0.93)}',
        '.vac .cmd hk-icon{width:23px;height:23px;--mdc-icon-size:23px;',
        '  color:' + window.hkCards.v('glyph') + '}',
        '@media (prefers-reduced-motion:reduce){',
        '  .vac .cmd,.vac .cmd:active,.vac .ico{transition:none;transform:none}}',
        // ON A HOME GRID (G2, the `vacuum` block): the plate fills it; the
        // glyph beside the status and its chips, the commands along the foot
        // as 44 px capsules. W: all four, on a page card's padding; S: Start
        // and Dock, on a tile's (the block is a tile's size)
        ':host([size]) hk-plate.vac{height:100%;min-height:0;padding:' + C.CARD.pad + ';border-radius:var(--hk-block-radius, ' + C.M.radius + ')}',
        ':host([size=S]) hk-plate.vac{padding:12.8px 12.8px 12.8px ' + C.TILE.padL + 'px}',
        ':host([size]) .vac .grid{height:100%;min-height:0;row-gap:8px;column-gap:10px;',
        '  grid-template-areas:"ico label label label" "ico meta meta meta" "start pause locate home";',
        '  grid-template-columns:44px repeat(3,minmax(0,1fr));grid-template-rows:22px 22px minmax(44px,1fr)}',
        ':host([size=S]) .vac .grid{grid-template-areas:"ico label" "ico meta" "start home";',
        '  grid-template-columns:44px minmax(0,1fr)}',
        ':host([size=S]) .vac [data-hk-role=pause],:host([size=S]) .vac [data-hk-role=locate]{display:none}',
        ':host([size]) .vac .ico{width:44px;height:44px;border-radius:22px;align-self:start}',
        ':host([size]) .vac .ico hk-icon{--mdc-icon-size:24px;width:24px;height:24px}',
        ':host([size]) .vac .label{' + C.typeCss('headline') + ';line-height:22px}',
        ':host([size]) .vac .meta{flex-wrap:nowrap;overflow:hidden;align-self:start}',
        ':host([size]) .vac .cmd{height:44px;align-self:end;border-radius:22px}'
      ].join('');
    }

    setConfig(config) {
      if (!config || !config.entity) throw new Error('hk-vacuum: `entity` is required');
      super.setConfig(config);
    }
    getCardSize() { return 3; }

    // The card reads four sensors its `entity` does not name -- and the
    // vacuum's own attributes (battery_level), so last_updated, not state:
    // a battery that charges while the vacuum stays `docked` must redraw.
    _sigOf() {
      var h = this.client, c = this._config;
      if (!h || !c) return null;
      var ids = [c.entity, c.battery, c.error, c.dock_error, c.room, c.progress]
                  .filter(Boolean);
      var out = '';
      for (var i = 0; i < ids.length; i++) {
        var s = h.states[ids[i]];
        out += ids[i] + '=' + (s ? s.last_updated : 'x') + ';';
      }
      return out;
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
      if (b == null && cfg.battery) b = this._v(cfg.battery);
      var bn = Number(b);
      if (b != null && b !== 'unknown' && b !== 'unavailable' && isFinite(bn)) {
        // Colour the battery the way the Home app does: only shout when it is low.
        out.push({ t: Math.round(bn) + '%',
                   c: bn <= 20 ? 'bad' : (bn <= 40 ? 'warn' : '') });
      }

      // Only while it is actually working: a room and a percentage next to a
      // docked vacuum are last run's numbers and read as if it were running.
      if (state === 'cleaning' || state === 'returning') {
        var room = this._v(cfg.room);
        if (room && room !== 'unknown' && room !== 'unavailable') out.push({ t: room });
        var pr = Number(this._v(cfg.progress));
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
      if (!this._built) {
        var cmds = HkVacuumCard.COMMANDS;
        var html = '<hk-plate class="vac" data-hk-role="card"><div class="grid">' +
          '<div class="ico" data-hk-role="ico"><hk-icon icon="mdi:robot-vacuum"></hk-icon></div>' +
          '<div class="label" data-hk-role="label"></div>' +
          '<div class="meta" data-hk-role="meta"></div>';
        for (var i = 0; i < cmds.length; i++) {
          html += '<div class="cmd" style="grid-area:' + cmds[i][0] + '"' +
                  ' role="button" aria-label="' + cmds[i][3] + '"' +
                  ' data-hk-role="' + cmds[i][0] + '">' +
                  '<hk-icon icon="' + cmds[i][1] + '"></hk-icon></div>';
        }
        this._root.innerHTML = html + '</div></hk-plate>';
        var q = this._root.querySelector.bind(this._root);
        this._e = { card: q('.vac'), ico: q('.ico'), label: q('.label'), meta: q('.meta') };
        var self = this;
        cmds.forEach(function (c) {
          q('[data-hk-role="' + c[0] + '"]').addEventListener('click', function (ev) {
            // The whole card opens more-info; a command must not also do that.
            ev.stopPropagation();
            if (self.client) {
              self._call('vacuum', c[2], { entity_id: cfg.entity });
            }
          });
        });
        this._bind(this._e.card, 'tap_action', null);
        this._built = true;
      }
      var e = this._e, st = this._st(cfg.entity);
      var state = (st && st.state) || 'unknown';
      var live = (state === 'cleaning' || state === 'returning');
      e.ico.setAttribute('data-live', live ? '1' : '0');

      var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
      if (e.label.textContent !== nm) e.label.textContent = nm;

      var chips = this._chips(st);
      var key = chips.map(function (c) { return (c.c || '') + ':' + c.t; }).join('|');
      if (e.meta.__key !== key) {
        e.meta.__key = key;
        e.meta.innerHTML = '';
        chips.forEach(function (c) {
          var s = document.createElement('span');
          s.className = 'chip' + (c.c ? ' ' + c.c : '');
          s.textContent = c.t;
          e.meta.appendChild(s);
        });
      }
    }
  }
  // grid-area, glyph, vacuum service, aria-label.
  HkVacuumCard.COMMANDS = [
    ['start', 'mdi:play', 'start', 'Start'],
    ['pause', 'mdi:pause', 'pause', 'Pause'],
    ['locate', 'mdi:map-marker', 'locate', 'Locate'],
    ['home', 'mdi:home-import-outline', 'return_to_base', 'Return to base']
  ];

  // ============================================================ area select
  // Pick rooms, then clean just those.
  //
  // The selection lives in THIS ELEMENT, in a Set -- not in input_boolean
  // helpers. It is not an entity, it is not broadcast, it is not recorded,
  // and two tablets never share one selection. The only thing that reaches
  // Home Assistant is the finished
  // list, once, when Clean is pressed.
  class HkAreaSelectCard extends HkBase {
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
        '.grid{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));',
        '  grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap + 'px;margin:0 0 14px 0}',
        // 40px PILLS, not 70px tiles: the action row matches the area pills
        // above it. Icon-well tiles here would stack two materials on one
        // grid. Play Music's equivalent row -- Clear, Transfer, Browse Music
        // -- is plain pills on the same track as the rooms above it, and this
        // is the same row with the same geometry.
        //
        // The rule below separates them, which is what carries the
        // "these act on the house" meaning that the shape does not.
        '.actions{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));',
        '  grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap + 'px;margin:0 0 14px 0}',
        '.floor{font-size:15px;font-weight:600;letter-spacing:-0.2px;',
        '  color:' + window.hkCards.v('ink-2') + ';padding:6px 4px 8px 4px}',
        // THE RULE separates two DIFFERENT kinds of thing: the pills above
        // only change a selection, the pills below act on the house. Without
        // it the action row reads as more pills that happen to look odd.
        '.rule{height:1px;margin:6px 4px 16px 4px;padding:0;border:none;',
        '  border-radius:0;box-shadow:none;background:' + window.hkCards.v('line') + '}',
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
        '@container (max-width:' + window.hkCards.BP.cardSide + 'px){.bar{grid-template-columns:repeat(2,minmax(0,1fr))}.bar .n{grid-column:1 / -1}',
        '  .plate .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
        // a phone: stacked under the vacuum cards, which sit one grid deeper,
        // the plate steps in 4 px a side to share their edges
        '@media (max-width:' + window.hkCards.BP.phone + 'px){.plate{padding:16px;margin:0 4px}}',
        // in a Home Grid block (data-fill): the plate is the block's lower part, and its rooms scroll inside it
        ':host([data-fill]){display:block;height:100%}',
        ':host([data-fill]) .plate{height:100%;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}',
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
      this._sel = new Set();
      this._auto = !Array.isArray(this._config.floors) || !this._config.floors.length;
    }
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
    }
    disconnectedCallback() {
      super.disconnectedCallback();
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
      var ids = (o.missing || o.configured === false) && this._script() ? Object.keys(A) : (o.areas || []);
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
      var A = (this.client && this.client.areas) || {}, FL = (this.client && this.client.floors) || {};
      var ids = (this._offer && this._offer.areas) || [];
      return 'auto|' + this._order().join(',') + '|' + ids.map(function (id) {
        var a = A[id] || {}, f = FL[a.floor_id] || {};
        return id + ':' + (a.name || '') + ':' + (a.floor_id || '') + ':' + (f.name || '') + ':' + (f.level == null ? '' : f.level);
      }).join(',');
    }

    _toggle(id) {
      this._sel.has(id) ? this._sel.delete(id) : this._sel.add(id);
      this._render();
    }
    _clear() { this._sel.clear(); this._render(); }

    // SAME RULE AS THE TIMER KEYPAD: the selection survives a failed dispatch.
    // Six rooms chosen, one tap, a rejected call: clearing then would wipe
    // the lot with nothing cleaning and nothing said.
    _start() {
      if (!this._sel.size || !this.client) return;
      var n = this._sel.size;
      if (!this._begin('Sending ' + n + (n === 1 ? ' area…' : ' areas…'))) return;
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
        this._setStatus('failed', 'Add Clean Areas (' + window.hkShell.haPlace('HK Frontend → Add feature') + ') to clean by area.');
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
          self._sel = new Set(keep.filter(function (a) { return areas.indexOf(a) !== -1; }));
        }
        // Home Assistant's own refusal (res.error), else the service's answer.
        self._setStatus('failed', r.message || res.error ||
                        'Could not reach Home Assistant. Tap to retry.');
        self._render();
      });
    }

    _render() {
      if (!this._config) return;
      var floors = this._floors();
      var self = this;
      // a room no longer offered is no longer selected
      if (floors && this._auto && this._sel && this._sel.size) {
        var here = {};
        floors.forEach(function (f) { (f.areas || []).forEach(function (a) { here[a.id] = true; }); });
        this._sel.forEach(function (id) { if (!here[id]) self._sel.delete(id); });
      }
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
      cnt.textContent = n === 0 ? 'Choose rooms, then start' : n === 1 ? '1 room selected' : n + ' rooms selected';
      cnt.setAttribute('aria-live', 'polite');
      bar.appendChild(cnt);
      var clr = this._pill('Clear', function () { self._clear(); });
      if (!n) { clr.setAttribute('aria-disabled', 'true'); clr.style.opacity = '0.45'; clr.style.pointerEvents = 'none'; clr.setAttribute('tabindex', '-1'); }
      bar.appendChild(clr);
      var go = this._pill(this._busy ? 'Sending…' : 'Start Cleaning', function () { self._start(); });
      go.classList.add('go');
      // THE ONE THAT ACTS, in the selected material once there is something to send
      go.setAttribute('aria-pressed', n && !this._busy ? 'true' : 'false');
      if (!n || this._busy) { go.setAttribute('aria-disabled', 'true'); go.setAttribute('tabindex', '-1'); }
      go.setAttribute('aria-label', n ? 'Start cleaning ' + n + (n === 1 ? ' room' : ' rooms') : 'Start Cleaning: choose rooms first');
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
      (floors || []).forEach(function (f) {
        var hd = document.createElement('div');
        hd.className = 'floor'; hd.textContent = f.name;
        plate.appendChild(hd);
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
        plate.appendChild(g);
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
        '.grid{display:grid;grid-template-columns:repeat(auto-fill,388px);',
        '  grid-auto-rows:196px;column-gap:' + window.hkCards.TILE.gridGap + 'px;row-gap:' + window.hkCards.TILE.gridGap + 'px;margin:0 0 14px 0}',
        // 196 exactly: 52 (head) + 48 (countdown and its bar, which
        // hkTimers.html emits as ONE wrapper and so occupies one row) + 52
        // (buttons) + two 12px gaps + 32 of padding.
        '.tc{height:196px;padding:16px 18px;border-radius:' + M.radius + ';',
        '  ' + M.glass + ';border:' + M.border + ';',
        '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-lg') + ');',
        '  display:grid;column-gap:12px;row-gap:12px;align-items:center;',
        '  grid-template-columns:repeat(4,minmax(0,1fr));',
        '  grid-template-rows:52px minmax(0,1fr) 52px;',
        '  grid-template-areas:"head head head head" "count count count count"',
        '                     "pause restart plus finish"}',
        '.tc > .head{grid-area:head;justify-self:stretch;min-width:0;overflow:hidden}',
        '.tc > .count{grid-area:count;justify-self:stretch;align-self:center;min-width:0}',
        // The four controls, with an
        // explicit 21px icon row -- an <hk-icon> has no intrinsic height, so a
        // min-content row collapses it to nothing and the buttons render as
        // bare captions. The caption row CAN be min-content; text sizes itself.
        '.tb{height:52px;border-radius:18px;background:' + window.hkCards.v('key') + ';',
        '  border:none;box-shadow:none;padding:0;justify-self:stretch;',
        '  display:grid;grid-template-columns:minmax(0,1fr);',
        '  grid-template-rows:21px min-content;align-content:center;',
        '  justify-items:center;row-gap:3px;cursor:pointer;user-select:none}',
        '.tb hk-icon{--mdc-icon-size:19px;width:19px;height:19px;',
        '  color:' + window.hkCards.v('glyph') + '}',
        '.tb > span{font-size:11px;font-weight:600;letter-spacing:0.1px;',
        '  line-height:1;color:' + window.hkCards.v('ink-2') + '}',
        // The empty state is a LINE OF TEXT, not a card. A full-width glass
        // plate with one grey sentence in it looks out of place: a plate is
        // this frontend's shape for a THING YOU CAN TOUCH, and there is nothing
        // here to touch. Sitting the sentence directly under the heading says
        // "this section is empty" without pretending to be a control.
        '.empty{padding:2px 4px 14px 4px;font-size:15px;font-weight:500;',
        '  letter-spacing:-0.2px;color:' + window.hkCards.v('ink-3') + '}',
        // PHONE. The 388px track above is a TABLET number -- it is the page
        // width divided by three, and `auto-fill` with a fixed track cannot
        // shrink below it, so at 402px it would lay one 388px card into ~354px
        // of room and the cards would run off the right edge. One full-width column
        // instead; the card's own four control tracks are already
        // `minmax(0,1fr)` and divide whatever they are given (~70px each at
        // 402px, against 52px tall buttons, which is fine).
        '@media (max-width:' + window.hkCards.BP.phone + 'px){',
        '  .grid{grid-template-columns:minmax(0,1fr)}',
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
        '.pages{display:grid;grid-auto-flow:column;grid-auto-columns:100%;column-gap:32px;',
        '  overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-padding:0 16px;',
        '  padding:16px;margin:-16px;overscroll-behavior-x:contain;scrollbar-width:none;',
        '  -webkit-overflow-scrolling:touch}',
        '.pages::-webkit-scrollbar{display:none;width:0;height:0}',
        // its own formatting context, so the row's negative margin is taken
        // back inside it -- as a plain child it escapes, and the card comes
        // out 16 px taller than its two rows
        '.pw{display:flow-root}',
        '.page{scroll-snap-align:start;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));',
        '  grid-template-rows:repeat(2,164px);gap:12px;align-content:start}',
        // THE HEADING IS THIS CARD'S in `fit` (config `heading`), so the dots
        // sit at the right of it: pages cost no height, and the House timers
        // under the grid stay level with the keypad however many there are.
        '.hrow{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
        // The dots: 24 px targets around an 8 px dot. Swiping is the way;
        // a dot is a jump to that page.
        '.dots{display:flex;justify-content:flex-end;gap:2px;height:24px;margin-top:5px}',
        '.dots button{all:unset;width:24px;height:24px;display:flex;align-items:center;',
        '  justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.dots i{width:8px;height:8px;border-radius:4px;background:' + window.hkCards.v('ink-3') + ';',
        '  transition:background-color .2s ease}',
        '.dots button[aria-current="true"] i{background:' + window.hkCards.v('ink') + '}',
        // PHONE: one column and no sideways pages -- the page itself scrolls,
        // so every running timer is simply the next card down.
        '@media (max-width:' + window.hkCards.BP.phone + 'px){',
        '  .grid.fit{grid-template-columns:minmax(0,1fr)}',
        '  .pages{display:block;overflow:visible;padding:0;margin:0}',
        '  .pw{display:block}',
        '  .page{grid-template-columns:minmax(0,1fr);grid-template-rows:none;grid-auto-rows:164px;margin:0 0 12px}',
        '  .page:last-child{margin-bottom:0}',
        '  .dots{display:none}',
        '}',
        '@media (prefers-reduced-motion: reduce){.dots i{transition:none}}'
      ].join('');
    }

    _onConfig() { this._sig = null; this._page = 0; }

    _list() { return this._config.timers || []; }
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
  // The timer creator: a duration keypad, a name, and Start.
  //
  // WHY THE TYPING LIVES HERE. Kept in input_text helpers, the half-typed
  // duration and name would be GLOBAL entities used as a scratchpad: two
  // tablets would share them, every keystroke would be a service call
  // broadcast to every connected client, and the partly-typed value would
  // sit in the state machine.
  //
  // Here the value is a JS property and typing re-renders nothing; _paint()
  // touches only the readout, the chips and the Start state, so the <input>
  // keeps its caret.
  //
  // WHAT STILL HAPPENS SERVER-SIDE: script.quick_timer_create. It parses the
  // digits the same way the readout below does and starts a real timer entity.
  // This card collects; Home Assistant decides.
  class HkTimerNewCard extends HkBase {
    static get CSS() {
      return [
        // THE LEFT COLUMN IS THE KEYPAD'S WIDTH, and the keypad's keys are
        // sized FROM the column rather than the other way round. At 404px
        // beside a keypad of 3x120 + 2x12 = 384, the duration readout above
        // the keys overhangs them by 20px on the right. Deriving the keys
        // from the column (repeat(3, 1fr), below)
        // means the readout and the keypad cannot disagree: change this
        // one number and both follow.
        '.wrap{display:grid;grid-template-columns:384px minmax(0,1fr);gap:28px}',
        // PHONE: stack. 384 + 28 + a second column does not fit a 402px screen,
        // and the keypad is the thing you came here to touch, so it goes first
        // and full width. The keys derive from the column (repeat(3,1fr)), so
        // they follow automatically -- that is the whole point of sizing them
        // FROM the column rather than pinning them.
        '@media (max-width:' + window.hkCards.BP.phone + 'px){',
        '  .wrap{grid-template-columns:minmax(0,1fr);gap:18px}',
        '}',
        // ...AND BY ITS OWN WIDTH on someone else's dashboard: a section or a
        // Masonry column is narrower than the two columns on any screen, and
        // the name, chips and Start ran out of it. Stacked as on a phone. HK's
        // own pages keep the screen-width rule above (no container there).
        ':host([data-hk-foreign]){container-type:inline-size}',
        '@container (max-width:' + window.hkCards.BP.phone + 'px){',
        '  .wrap:not(.panel){grid-template-columns:minmax(0,1fr);gap:18px}',
        '}',
        '.readout{height:104px;border-radius:' + M.radius + ';padding:0 24px;margin:0 0 14px 0;',
        '  ' + M.glass + ';border:' + M.border + ';box-shadow:var(--hk-look-shadow, 0 10px 28px rgba(0,0,0,0.12));',
        '  display:flex;align-items:center}',
        '.big{font-size:44px;font-weight:300;letter-spacing:-1.2px;line-height:1}',
        '.sub{font-size:14px;font-weight:500;margin-top:8px;color:' + window.hkCards.v('ink-2') + '}',
        '.pad{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));',
        '  grid-auto-rows:62px;gap:12px}',
        '.key{height:62px;border-radius:22px;padding:0;' + M.glass + ';',
        '  border:' + M.border + ';box-shadow:var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,0.10));',
        '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
        '  user-select:none;font-size:19.7px;letter-spacing:-0.45px;font-weight:700;',
        '  color:' + window.hkCards.v('ink') + ';transition:transform .12s ease}',
        '.key:active{transform:scale(0.96)}',
        // SIX ACROSS, ONE ROW. A grid with no template-columns is a single
        // column, and the six name chips would stack one per row down the
        // whole right-hand side. minmax(0,1fr)
        // rather than 1fr is what lets a long chip ellipsize instead of
        // widening its track and pushing the other five out of the card.
        '.chips{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));',
        '  grid-auto-rows:48px;gap:10px;margin:0 0 14px 0}',
        '.chip2{height:48px;border-radius:17px;padding:0 10px;min-width:0;border:' + M.border + ';',
        '  box-shadow:none;' + M.glass + ';display:flex;align-items:center;',
        '  justify-content:center;cursor:pointer;user-select:none;font-size:16px;',
        '  font-weight:600;letter-spacing:-0.3px;color:' + window.hkCards.v('ink') + ';',
        '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
        '  transition:background-color .22s ease,transform .12s ease}',
        '.chip2:active{transform:scale(0.96)}',
        '.chip2[aria-pressed="true"]{background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}',
        // A real <input>, which is the point: it keeps its own value and its
        // own caret, and nothing re-renders while somebody is typing.
        '.namebox{height:58px;border-radius:20px;padding:8px 16px;margin:0 0 14px 0;',
        '  ' + M.glass + ';border:' + M.border + ';display:flex;align-items:center}',
        '.namebox input{all:unset;width:100%;font-size:19px;font-weight:600;',
        '  letter-spacing:-0.3px;color:' + window.hkCards.v('ink') + ';font-family:inherit}',
        '.namebox input::placeholder{color:' + window.hkCards.v('ink-3') + '}',
        '.start{height:70px;border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border + ';',
        '  box-shadow:' + M.shSm + ';display:flex;align-items:center;justify-content:center;',
        '  font-size:17px;font-weight:600;letter-spacing:-0.3px;cursor:pointer;',
        '  user-select:none;transition:transform .12s ease}',
        '.start:active{transform:scale(0.97)}',
        '.start[aria-disabled="true"]{opacity:0.45;pointer-events:none}',
        '@media (prefers-reduced-motion: reduce){',
        '  .key,.key:active,.chip2,.chip2:active,.start,.start:active{',
        '    transition:none;transform:none}}',
        // ------------------------------------------------------ THE PANEL
        // `layout: panel` -- one column on its own glass plate, the right-hand
        // side of the one-page Timers layout (hk-timers-page-card): what it
        // is and where a message lands, the duration and when it would end,
        // the keypad, the name, its chips, and Start. The plate is the only
        // glass surface; the keys and chips on it are tints, not plates.
        '.wrap.panel{display:flex;flex-direction:column;gap:12px;padding:20px;box-sizing:border-box;height:100%;',
        '  border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border + ';',
        '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-lg') + ')}',
        '.panel .ro{display:flex;align-items:baseline;justify-content:space-between;gap:12px;height:60px}',
        '.panel .big{font-size:56px;font-weight:300;letter-spacing:-2px;line-height:60px;white-space:nowrap}',
        '.panel .ends{font-size:14px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
        // the hint and the status share one cell, right-aligned on the
        // duration's baseline; a message hides the hint while it shows
        '.panel .side{display:grid;justify-items:end;min-width:0}',
        '.panel .side > *{grid-area:1 / 1;min-width:0}',
        '.panel .side .hk-status{margin:0;min-height:0;line-height:1.3;font-size:14px;text-align:right}',
        '.panel .side:has(.hk-status[data-kind]) .ends{visibility:hidden}',
        '.panel .pad{grid-auto-rows:56px;gap:10px}',
        '.panel .key,.panel .chip2,.panel .namebox{background:' + window.hkCards.v('key') + ';box-shadow:none}',
        '.panel .key{height:56px;border-radius:18px;font-size:21px;font-weight:600}',
        '.panel .namebox{height:48px;border-radius:16px;margin:0}',
        '.panel .namebox input{font-size:17px}',
        // THE NAMES AS A FIXED GRID, three by two: chips that wrap get
        // awkward as they shrink. Every chip
        // the same width, 44 px tall, a long name ellipsized in its own cell.
        '.panel .chips{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:44px;gap:8px;margin:0}',
        '.panel .chip2{height:44px;border-radius:14px;font-size:15px}',
        // the chosen name in the selected material (the plate's key color
        // above would otherwise win: same specificity, later)
        '.panel .chip2[aria-pressed="true"]{background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}',
        '.panel .start{height:56px;border-radius:18px;margin-top:auto;font-size:18px;font-weight:700}',
        '.panel .start[aria-disabled="false"]{background:var(--hk-timer-tint,rgba(255,159,10,0.95));border-color:transparent;',
        '  color:rgba(0,0,0,0.85)}',
        '.panel .start[aria-disabled="true"]{opacity:1;color:' + window.hkCards.v('ink-3') + ';background:' + window.hkCards.v('key') + '}',
        // WIDE (`data-wide`, set by hk-timers-page-card when the page stacks:
        // an iPad held upright, a tablet with the menu docked): this panel
        // runs the full width under the page, so its one column would be a
        // 700 px calculator. Two columns instead -- the duration and keypad
        // on the left; the name, its chips and Start on the right, Start
        // level with the keypad's last row -- which is also half the height.
        // ON THE KEYPAD'S ROWS: the name field lines up with the keypad's top
        // row. The right column is the
        // pad's own four 56 px rows, 10 apart: the name beside 1-2-3, the two
        // rows of names beside 4-5-6 and 7-8-9, Start beside 00-0-delete.
        ':host([data-wide]) .wrap.panel{display:grid;height:auto;column-gap:24px;row-gap:10px;',
        '  grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:auto repeat(4,56px);',
        '  grid-template-areas:"ro ." "pad name" "pad chips" "pad chips" "pad start"}',
        ':host([data-wide]) .panel .ro{grid-area:ro}',
        ':host([data-wide]) .panel .pad{grid-area:pad;margin:0}',
        ':host([data-wide]) .panel .namebox{grid-area:name;height:56px;margin:0}',
        ':host([data-wide]) .panel .chips{grid-area:chips;grid-auto-rows:56px;gap:10px;margin:0}',
        ':host([data-wide]) .panel .chip2{height:56px}',
        ':host([data-wide]) .panel .start{grid-area:start;margin:0}',
        // ------------------------------------------------------ THE SHEET
        // `layout: sheet` -- the panel's one column inside a detail sheet
        // (the Timers page's Create a Timer, 2026-10-16): the sheet is the
        // plate, so no plate of its own; the quick names are the selectable
        // pills' 40 px capsules, three by two, all one width.
        '.wrap.panel.sheetl{background:none;border:0;box-shadow:none;padding:0;height:auto;min-height:100%;gap:12px}',
        '.sheetl .chips{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:40px;gap:10px}',
        '.sheetl .chip2{height:40px;border-radius:' + C.R.capsule('40px') + ';' + C.PILL_LABEL + ';padding:0 8px}',
        '.sheetl .lab{font-size:13px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';margin:2px 2px -4px}',
        '.sheetl .start{margin-top:4px;height:52px}',
        // ALL OF IT ON ONE SCREEN of a wall tablet's sheet: the keys and the
        // duration a little shorter than the panel's
        '.sheetl .ro{height:52px}',
        '.sheetl .big{font-size:' + C.TYPE.hero.size + 'px;line-height:52px}',
        '.sheetl .pad{grid-auto-rows:50px}',
        '.sheetl .key{height:50px}',
        '.sheetl .namebox{height:46px}',
        '.sheetl .key:focus-visible,.sheetl .chip2:focus-visible,.sheetl .start:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}'
      ].join('');
    }
    _onConfig() { this._digits = ''; this._name = ''; this._built = false; }
    _panel() { return this._config && (this._config.layout === 'panel' || this._config.layout === 'sheet'); }
    // "Ends 10:52 PM" moves with the clock, so the panel refreshes it while
    // it is on the page -- only that line, never the keypad or the input.
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      if (!this._endsT) this._endsT = setInterval(function () { self._paintEnds(); }, 15000);
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
        : 'Type a duration';
    }
    // "25 min", "1 hr", "1 hr 30 min" -- what Start says it will start.
    static words(t) {
      if (!t.total) return '';
      if (!t.h) return t.m + ' min';
      return t.h + ' hr' + (t.m ? ' ' + t.m + ' min' : '');
    }
    // Reads no entity -- the digits and name are typed here. Same trap as the
    // area picker: a null signature would repaint it on every state push (132
    // mutations for 12 unchanged updates). Keys and inputs call _paint themselves.
    _sigOf() { return 'static'; }

    // Digits shift in from the RIGHT into HHMM -- the same reading
    // script.quick_timer_create does. If the two ever disagree the page would
    // promise one duration and start another; keep them in step.
    _parse() {
      var p = this._digits.replace(/[^0-9]/g, '').slice(-4);
      while (p.length < 4) { p = '0' + p; }
      var h = parseInt(p.slice(0, 2), 10), m = parseInt(p.slice(2), 10);
      return { h: h, m: m, total: h * 3600 + m * 60 };
    }
    _press(d) {
      if (d === 'back') this._digits = this._digits.slice(0, -1);
      else this._digits = (this._digits + d).replace(/[^0-9]/g, '').slice(-4);
      this._paint();
    }
    // THE FORM IS CLEARED ON SUCCESS, NOT ON TAP. Clearing it straight after
    // the call -- synchronously, unconditionally, before the call has
    // resolved -- loses the duration and the label when the call is
    // rejected: no timer exists and nothing is said. You would retype it and
    // assume you had mistyped.
    //
    // `_busy` is the other half: without it a second tap during the round
    // trip sends a second timer. It also keeps the keypad from being edited
    // into a state that does not match what was sent.
    //
    // ACCEPTED IS NOT STARTED, AND THAT GAP IS VISIBLE HERE.
    //
    // script.turn_on resolves the instant the script BEGINS. There are four
    // timer slots: start a fifth that way and the call returns `true`, the
    // keypad clears, and nothing runs -- you typed a duration, watched the
    // form empty, and no timer exists anywhere on the page, with nothing on
    // screen to explain it.
    //
    // So it is a BLOCKING call to the script itself, asking for the
    // response the allocator returns ({started, slot} or {started, reason};
    // see helpers/quick_timers.yaml). Three distinct outcomes, three messages, and
    // the form is cleared for exactly one of them.
    _start() {
      var t = this._parse();
      if (!t.total || !this.client) return;
      // `create_script` is an entity id; a blocking call needs it split. A
      // configured value without a domain is assumed to be a script.
      var ent = this._config.create_script || 'script.quick_timer_create';
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
      var self = this;
      this._callResp(parts[0], parts[1], {
        digits: this._digits, name: this._name.trim()
      }).then(function (r) {
        self._end();
        // DISPATCH REJECTED. _call has logged it, every keystroke is still
        // exactly as typed, and the message stays up until the next attempt.
        if (!r.ok) {
          self._setStatus('failed', 'Could not reach Home Assistant. Tap to retry.');
          self._paint();
          return;
        }
        var res = r.response;
        // NO RESPONSE AT ALL. An older quick_timers.yaml, or a create_script
        // pointed somewhere that returns nothing. Accepted is all that is
        // known, so that is all that is claimed -- and the form is still
        // cleared, as it is for any accepted call without an answer.
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
          // THE ENTRY IS KEPT. All four slots are busy; cancel one on the
          // Timers page and this same tap works. Wiping the duration would
          // make the person retype it for no reason.
          // Short enough for the panel's top line; says which four.
          self._setStatus('warn', 'All four quick timers are busy.');
        } else {
          self._setStatus('warn', 'That works out to no time at all.');
        }
        self._paint();
      });
    }

    _clearForm() {
      this._digits = ''; this._name = '';
      var inp = this._root.querySelector('.namebox input');
      if (inp) { inp.value = ''; }
    }

    // Repaints ONLY what changes. Rebuilding the card would blow away the
    // <input> and the caret with it.
    _paint() {
      var big = this._root.querySelector('.big');
      if (!big) { return; }
      var t = this._parse();
      var sub = this._root.querySelector('.sub');
      var start = this._root.querySelector('.start');
      big.textContent = t.total
        ? (t.h ? t.h + ':' + (t.m < 10 ? '0' + t.m : t.m) : t.m + ' min')
        : '0 min';
      big.style.color = t.total ? '' + window.hkCards.v('ink') + '' : '' + window.hkCards.v('ink-3') + '';
      var nm = this._name.trim();
      if (sub) sub.textContent = t.total ? (nm || 'Unnamed') : 'Type a duration';
      this._paintEnds();
      // DISABLED WHILE IN FLIGHT as well as while empty. _begin already drops
      // a second submission; this is so the button LOOKS inert rather than
      // looking tappable and doing nothing.
      start.setAttribute('aria-disabled', (t.total && !this._busy) ? 'false' : 'true');
      // The panel's Start says what it will start ("Start 25 min").
      start.textContent = this._busy ? 'Starting…'
        : (this._panel() && t.total ? 'Start ' + HkTimerNewCard.words(t) : 'Start Timer');
      Array.prototype.forEach.call(this._root.querySelectorAll('.chip2'), function (c) {
        c.setAttribute('aria-pressed', c.getAttribute('data-name') === nm ? 'true' : 'false');
      });
    }

    _btn(cls, text, fn) {
      var d = document.createElement('div');
      d.className = cls; d.textContent = text;
      return button(d, fn);
    }

    _render() {
      if (!this._config) { return; }
      if (this._built) { this._paint(); return; }
      if (this._panel()) { this._renderPanel(); return; }
      var self = this;
      this._root.innerHTML = '';
      var wrap = document.createElement('div'); wrap.className = 'wrap';

      var left = document.createElement('div');
      var ro = document.createElement('div'); ro.className = 'readout';
      var box = document.createElement('div');
      var big = document.createElement('div'); big.className = 'big';
      var sub = document.createElement('div'); sub.className = 'sub';
      box.appendChild(big); box.appendChild(sub); ro.appendChild(box);
      left.appendChild(ro);
      var pad = document.createElement('div'); pad.className = 'pad';
      ['1','2','3','4','5','6','7','8','9'].forEach(function (d) {
        pad.appendChild(self._btn('key', d, function () { self._press(d); }));
      });
      pad.appendChild(self._btn('key', '00', function () { self._press('00'); }));
      pad.appendChild(self._btn('key', '0', function () { self._press('0'); }));
      pad.appendChild(self._btn('key', '\u232b', function () { self._press('back'); }));
      left.appendChild(pad);

      var right = document.createElement('div');
      var nb = document.createElement('div'); nb.className = 'namebox';
      var inp = document.createElement('input');
      inp.type = 'text'; inp.placeholder = 'Name (optional)'; inp.maxLength = 32;
      inp.addEventListener('input', function () { self._name = inp.value; self._paint(); });
      nb.appendChild(inp); right.appendChild(nb);
      var chips = document.createElement('div'); chips.className = 'chips';
      (this._config.name_chips || []).forEach(function (n) {
        var c = self._btn('chip2', n, function () {
          self._name = (self._name.trim() === n) ? '' : n;
          inp.value = self._name; self._paint();
        });
        c.setAttribute('data-name', n);
        chips.appendChild(c);
      });
      right.appendChild(chips);
      right.appendChild(this._btn('start', 'Start Timer', function () { self._start(); }));
      // Below the button, in the flow. It holds its height empty, so a message
      // arriving does not shift the keypad under somebody's finger.
      right.appendChild(this._statusNode());

      wrap.appendChild(left); wrap.appendChild(right);
      this._root.appendChild(wrap);
      this._built = true;
      this._paint();
    }

    // The same parts as _render, in the panel's one column.
    _renderPanel() {
      var self = this;
      this._root.innerHTML = '';
      // THE PLATE FILLS THE HOST, so the page can stretch the panel to the
      // left column's height (Start is pinned to the bottom of it).
      this._root.style.height = '100%';
      var sheet = this._config.layout === 'sheet';
      var wrap = document.createElement('div'); wrap.className = 'wrap panel' + (sheet ? ' sheetl' : '');
      if (this._config.tint) wrap.style.setProperty('--hk-timer-tint', window.hkCards.flatColor(this._config.tint, 'well'));
      // A KEYBOARD TYPES THE DURATION too: digits, Backspace, Enter to start
      // -- except in the name field, which keeps its own keys
      wrap.addEventListener('keydown', function (e) {
        var t = e.composedPath ? e.composedPath()[0] : e.target;
        if (t && t.tagName === 'INPUT') { if (e.key === 'Enter') { e.preventDefault(); self._start(); } return; }
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); self._press(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); self._press('back'); }
        else if (e.key === 'Enter' && !(t && t.getAttribute && t.getAttribute('role') === 'button')) { e.preventDefault(); self._start(); }
      });

      // NO "NEW TIMER" CAPTION: the panel explains itself. The status line
      // takes the hint's place beside the duration ("Type a duration" /
      // "Ends 2:45 PM") while
      // a message is showing -- see `.side` in the CSS.
      var ro = document.createElement('div'); ro.className = 'ro';
      var big = document.createElement('div'); big.className = 'big';
      var side = document.createElement('div'); side.className = 'side';
      var ends = document.createElement('div'); ends.className = 'ends';
      side.appendChild(ends); side.appendChild(this._statusNode());
      ro.appendChild(big); ro.appendChild(side);
      wrap.appendChild(ro);

      var pad = document.createElement('div'); pad.className = 'pad';
      ['1','2','3','4','5','6','7','8','9','00','0'].forEach(function (d) {
        pad.appendChild(self._btn('key', d, function () { self._press(d); }));
      });
      var del = self._btn('key', '\u232b', function () { self._press('back'); });
      del.setAttribute('aria-label', 'Delete');
      pad.appendChild(del);
      wrap.appendChild(pad);

      var nb = document.createElement('div'); nb.className = 'namebox';
      var inp = document.createElement('input');
      inp.type = 'text'; inp.placeholder = 'Name (optional)'; inp.maxLength = 32;
      inp.setAttribute('aria-label', 'Timer name');
      inp.addEventListener('input', function () { self._name = inp.value; self._paint(); });
      nb.appendChild(inp); wrap.appendChild(nb);

      var chips = document.createElement('div'); chips.className = 'chips';
      // QUICK NAMES: a shortcut into the name field, never a duration. The
      // pressed one is whichever the field now says, so typing over it
      // clears it.
      if (sheet && (this._config.name_chips || []).length) {
        var lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = 'Quick names';
        wrap.appendChild(lab);
        chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Quick names');
      }
      (this._config.name_chips || []).slice(0, 6).forEach(function (n) {
        var c = self._btn('chip2', n, function () {
          self._name = (self._name.trim() === n) ? '' : n;
          inp.value = self._name; self._paint();
        });
        c.setAttribute('data-name', n);
        chips.appendChild(c);
      });
      wrap.appendChild(chips);
      wrap.appendChild(this._btn('start', 'Start Timer', function () { self._start(); }));

      this._root.appendChild(wrap);
      this._built = true;
      this._paint();
      // IN A SHEET THE KEYPAD HAS THE KEYBOARD: focus moves onto it (not the
      // name field -- a tablet's keyboard would rise), so typed digits land
      if (sheet) {
        wrap.setAttribute('tabindex', '-1');
        wrap.style.outline = 'none';
        requestAnimationFrame(function () { try { wrap.focus({ preventScroll: true }); } catch (e) { /* ok */ } });
      }
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
        '@media (max-width:' + window.hkCards.BP.phone + 'px){',
        '  .pg{display:flex;flex-direction:column;gap:18px}',
        '  .main{display:contents}',
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
        else if (r.response && r.response.started === false) self._setStatus('warn', 'All four quick timers are busy.');
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
      return [
        'hk-plate.strip{background:none;box-shadow:none;border:none;',
        '  padding:0;margin:0;display:block}',
        // The screensaver's row is wrapped in a position:fixed div by strip()
        // itself, so its host must take no space and must not clip.
        'hk-plate.strip.fixed{height:0;overflow:visible}',
        '.strip > div{min-width:0;overflow:hidden}',
        // ON A HOME GRID (the `timers` block, docs/phase11/HOME-GRID.md R6):
        // a plate of the running timers, each its ring of time left and its
        // pause / resume and cancel; none running, Create a Timer (and, at W,
        // the Timers page's quick starts)
        ':host([size]) hk-plate.strip{display:flex;flex-direction:column;justify-content:center;gap:8px;box-sizing:border-box;',
        '  height:100%;padding:12px;' + window.hkCards.plate('card') + ';overflow:hidden}',
        '.timer-grid{display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));gap:12px}.grid-timer{display:grid;gap:6px;min-width:0}',
        '.timer-heading{display:flex;align-items:center;gap:10px;min-width:0}.timer-heading>b{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:' + window.hkCards.v('ink') + '}',
        '.timer-ring{width:56px;height:56px;flex:none;border-radius:50%;display:grid;place-items:center;position:relative}',
        '.timer-ring svg{position:absolute;inset:0;width:56px;height:56px;transform:rotate(-90deg)}.timer-ring circle{fill:none;stroke-width:4px;stroke:' + window.hkCards.v('key') + '}.timer-ring .ring-left{stroke:' + window.hkCards.v('warn') + ';stroke-dasharray:calc(var(--hk-left,1)*100) 100}',
        '.timer-ring hk-countdown{position:relative;font-size:13px;font-weight:600;color:' + window.hkCards.v('ink') + ';font-variant-numeric:tabular-nums}',
        '.timer-controls{display:flex;gap:8px}.timer-controls button,.quick-grid button{border:0;border-radius:22px;background:' + window.hkCards.v('key') + ';color:' + window.hkCards.v('ink') + ';min-width:44px;min-height:44px;flex:1;cursor:pointer;font:inherit;' + window.hkCards.typeCss('caption') + '}',
        '.timer-controls hk-icon{display:block;width:20px;height:20px;margin:auto;--mdc-icon-size:20px}',
        '.new-timer{border:0;background:none;color:' + window.hkCards.v('ink') + ';display:flex;align-items:center;gap:10px;text-align:left;min-height:56px;cursor:pointer;padding:0}',
        '.new-timer i{width:42px;height:42px;background:' + window.hkCards.v('key') + ';border-radius:50%;display:grid;place-items:center;flex:none}.new-timer hk-icon{width:24px;height:24px;--mdc-icon-size:24px}',
        '.new-timer span{display:grid;gap:3px}.new-timer b{font-size:15px;font-weight:600}.new-timer small{' + window.hkCards.typeCss('caption') + ';color:' + window.hkCards.v('ink-2') + '}',
        '.quick-grid{display:flex;gap:6px}'
      ].join('');
    }
    getCardSize() { return 1; }
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
    _newGridTimer() {
      var D = window.hkDetail;
      if (D) D.open(null, { name: 'Create a Timer', icon: 'mdi:timer-outline' }, {
        cards: { cards: [{ type: 'custom:hk-timer-new-card', layout: 'panel',
          name_chips: (window.hkSettings && window.hkSettings.get('headers.timers.names', null)) || undefined }] }
      });
    }
    _grid(list, sized) {
      this._watchBlock();
      var states = this.client && this.client.states || {}, T = window.hkTimers, esc = window.hkCards.esc;
      var rows = (list || []).filter((r) => r && r.entity_id).map((r) => ({ id: r.entity_id, name: r.name, attrs: Object.assign({}, r, states[r.entity_id] && states[r.entity_id].attributes), state: states[r.entity_id] && states[r.entity_id].state || 'active' }));
      Object.keys(states).filter((id) => /^timer.quick_/.test(id) && states[id].state === 'paused').forEach((id) => {
        if (!rows.some((r) => r.id === id)) rows.push({ id: id, name: states[id].attributes.friendly_name, attrs: states[id].attributes, state: 'paused' });
      });
      rows = rows.filter((r) => r.state === 'paused' || r.attrs.finishes_at && !isNaN(Date.parse(r.attrs.finishes_at)))
        .sort((a, b) => (Date.parse(a.attrs.finishes_at) || Infinity) - (Date.parse(b.attrs.finishes_at) || Infinity));
      if (!rows.length) {
        var presets = (window.hkSettings && window.hkSettings.get('headers.timers.presets', null)) || [5, 10, 15, 20, 30, 60];
        return '<button class="new-timer" data-new aria-label="Create a Timer"><i><hk-icon icon="mdi:timer-outline"></hk-icon></i><span><b>Timers</b><small>Create a Timer</small></span></button>' +
          (sized === 'W' ? '<div class="quick-grid">' + presets.slice(0, 6).map((m) => '<button data-preset="' + Number(m) + '">' + esc(HkTimersPageCard.label(Number(m))) + '</button>').join('') + '</div>' : '');
      }
      var max = sized === 'S' ? 1 : 2;
      return '<div class="timer-grid" style="--cols:' + Math.min(max, rows.length) + '">' + rows.slice(0, max).map(function (r) {
        var paused = r.state === 'paused', total = T ? T.secs(r.attrs.duration) : 0;
        var clock = paused ? 'hold="' + (T ? T.secs(r.attrs.remaining) : 0) + '"' : 'deadline="' + Date.parse(r.attrs.finishes_at) + '"';
        return '<div class="grid-timer"><div class="timer-heading"><div class="timer-ring"><svg viewBox="0 0 56 56" aria-hidden="true"><circle class="ring-track" cx="28" cy="28" r="25"></circle><circle class="ring-left" cx="28" cy="28" r="25" pathLength="100"></circle></svg><hk-countdown ' + clock + ' total="' + total + '"></hk-countdown></div><b>' + esc(r.name || 'Timer') + '</b></div>' +
          '<div class="timer-controls"><button data-timer="' + esc(r.id) + '" data-service="' + (paused ? 'start' : 'pause') + '" aria-label="' + (paused ? 'Resume' : 'Pause') + ' ' + esc(r.name || 'Timer') + '"><hk-icon icon="mdi:' + (paused ? 'play' : 'pause') + '"></hk-icon></button>' +
          '<button data-timer="' + esc(r.id) + '" data-service="cancel" aria-label="Cancel ' + esc(r.name || 'Timer') + '"><hk-icon icon="mdi:close"></hk-icon></button></div></div>';
      }).join('') + '</div>';
    }
    _sigOf() {
      var h = this.client;
      if (!h) return null;
      var s = h.states[this._config.entity || 'sensor.running_quick_timers'];
      // The module may arrive after the first render; until it does there is
      // nothing to draw, so fold its presence into the signature.
      if (!this._cellSize()) return (s ? s.last_updated : 'x') + '|' + (window.hkTimers ? '1' : '0');
      return JSON.stringify([s, Object.keys(h.states).filter((id) => /^timer.quick_/.test(id)).map((id) => h.states[id]), !!window.hkTimers]);
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

  // ============================================================ THE PEOPLE
  // hk-people-card: the household at a glance (the Home Grid's `people`
  // block, docs/phase11/HOME-GRID.md; at home anywhere else too) -- each
  // person their picture or initials, ringed green at home, their name and
  // where they are; a tap opens their sheet (hk-person.js). As many as the
  // width holds, in `people:` order, else every person A to Z.
  var PP = { w: 72, gap: 12, av: 48, home: 'rgba(52,199,89,0.85)' };
  class HkPeopleCard extends HkBase {
    static get CSS() {
      return [
        'hk-plate.pp{display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;height:100%;',
        '  padding:' + C.CARD.pad + ';margin:0;' + C.plate('card') + ';overflow:hidden}',
        '.pp .row{display:grid;grid-template-columns:repeat(var(--n,4),minmax(' + PP.w + 'px,1fr));gap:0 ' + PP.gap + 'px;',
        '  justify-content:start}',
        '.pr{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;min-height:44px;margin:0;padding:0;',
        '  border:0;background:none;font:inherit;color:' + C.v('ink') + ';cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.pr:active{opacity:.6}',
        '.pr:focus-visible{outline:2px solid ' + C.v('ink-2') + ';outline-offset:4px;border-radius:' + C.R.small + 'px}',
        '.av{width:' + PP.av + 'px;height:' + PP.av + 'px;border-radius:50%;flex:none;overflow:hidden;display:flex;',
        '  align-items:center;justify-content:center;background:' + C.v('key-strong') + ';' + C.typeCss('headline') + ';',
        '  box-shadow:0 0 0 2px ' + C.v('line-strong') + '}',
        '.pr.home .av{box-shadow:0 0 0 2px ' + PP.home + '}',
        '.av img{width:100%;height:100%;object-fit:cover;display:block}',
        '.pr b{' + C.typeCss('body') + ';line-height:19px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.pr span{' + C.typeCss('caption') + ';line-height:16px;color:' + C.v('ink-2') + ';max-width:100%;',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      ].join('');
    }
    getCardSize() { return 2; }
    _ids() {
      var h = this.client, st = (h && h.states) || {}, own = this._config.people;
      if (Array.isArray(own) && own.length) return own.filter(function (id) { return st[id]; });
      var name = function (id) { return String((st[id].attributes || {}).friendly_name || id); };
      return Object.keys(st).filter(function (id) { return id.indexOf('person.') === 0; })
        .sort(function (a, b) { return name(a).localeCompare(name(b)); });
    }
    _sigOf() {
      var h = this.client;
      if (!h) return null;
      return this._ids().map(function (id) { var s = h.states[id]; return id + '=' + s.state + '/' + ((s.attributes || {}).entity_picture || ''); }).join(';');
    }
    _render() {
      var h = this.client;
      if (!h) return;
      this._watchBlock();
      var b = this._block(), ids = this._ids();
      var n = b ? Math.max(1, Math.floor((b.w - 2 * C.CARD.x + PP.gap) / (PP.w + PP.gap))) : ids.length;
      var esc = C.esc;
      var where = function (s) {
        return s.state === 'home' ? 'Home' : s.state === 'not_home' ? 'Away'
          : /^(unknown|unavailable)$/.test(s.state) ? 'Unknown' : String(s.state).replace(/(^|[\s_])(\w)/g, function (m, a, c) { return (a === '_' ? ' ' : a) + c.toUpperCase(); });
      };
      var cells = ids.slice(0, n).map(function (id) {
        var s = h.states[id], a = s.attributes || {}, nm = String(a.friendly_name || id);
        var ini = nm.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
        return '<button class="pr' + (s.state === 'home' ? ' home' : '') + '" data-id="' + esc(id) + '" aria-label="' +
          esc(nm + ', ' + where(s)) + '"><span class="av">' + (a.entity_picture ? '<img alt="" data-initials="' + esc(ini) + '" src="' + esc(a.entity_picture) + '">' : esc(ini)) +
          '</span><b>' + esc(nm.split(/\s+/)[0]) + '</b><span>' + esc(where(s)) + '</span></button>';
      });
      C.morph(this._root, '<hk-plate class="pp" data-hk-role="card"><div class="row" role="list" style="--n:' +
        Math.min(n, Math.max(1, ids.length)) + '">' + cells.join('') + '</div></hk-plate>');
      this._root.querySelectorAll('.av img').forEach(function (img) {
        // once (the browser's own error can follow the hand-made one, on an image no longer in the page)
        img.onerror = function () { img.onerror = null; if (img.parentNode) img.parentNode.textContent = img.getAttribute('data-initials'); };
        if (img.complete && !img.naturalWidth) img.onerror();
      });
      if (!this._wired) {
        this._wired = true;
        var self = this;
        this._root.addEventListener('click', function (e) {
          var t = e.target.closest && e.target.closest('.pr');
          if (t) window.hkShell.moreInfo(t.getAttribute('data-id'), self);
        });
      }
    }
  }

  register('hk-people-card', HkPeopleCard, 'HK People',
    'The household at a glance: each person, at home or where they are. A tap opens their sheet.',
    C && [{ name: 'people', selector: { entity: { multiple: true, filter: { domain: 'person' } } } }],
    function () { return {}; });

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

  window.hkHome = { version: '1.0.0' };
  });
})();
