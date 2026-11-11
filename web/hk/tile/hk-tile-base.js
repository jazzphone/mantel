// hk-tile-base.js - the tile base class and the media card.
//
// PART OF THE TILE CARDS (hk-tile.js). Not a card and not run on its own: it registers one
// function, which hk-tile.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkTileParts = window.hkTileParts || {})['hk-tile-base'] = function (K) {
    var brightnessLabel = K.brightnessLabel, colourFor = K.colourFor, CSS = K.CSS, hexOf = K.hexOf, HkBase = K.HkBase,
        iconColour = K.iconColour, LAYOUTS = K.LAYOUTS, levelOf = K.levelOf, lightRgb = K.lightRgb,
        NAME_MAP = K.NAME_MAP, ON_STATES = K.ON_STATES, readingOf = K.readingOf, sentence = K.sentence,
        sizedLayout = K.sizedLayout, titled = K.titled, wellColour = K.wellColour;

    // `on:` UNQUOTED IN YAML IS THE BOOLEAN true, so an icon_states map keyed on
    // entity states silently becomes {true: ...} and the lookup against the
    // string 'on' never matches -- so a humidifier or dehumidifier shows its
    // idle glyph while running. The generator quotes these keys;
    // this is the safety net for a map written by hand, where the mistake is
    // invisible in the YAML and invisible in the rendering (it just never
    // changes). Same trap as `name: Off` becoming false.
    function normaliseIconStates(config) {
      var m = config && config.icon_states;
      if (!m || typeof m !== 'object') return config;
      var fixed = null;
      Object.keys(m).forEach(function (k) {
        if (k === 'true' || k === 'false') {
          fixed = fixed || Object.assign({}, m);
          delete fixed[k];
          fixed[k === 'true' ? 'on' : 'off'] = m[k];
        }
      });
      if (!fixed) return config;
      var out = Object.assign({}, config);
      out.icon_states = fixed;
      return out;
    }

    // ------------------------------------------------------------- base tile
    var PRESS_MS = 1500;                 // a momentary tile's light after a tap

    class HkTileBase extends HkBase {
      // A MOMENTARY ACCESSORY LIGHTS WHEN TAPPED (2026-09-30). A button -- a
      // computer's Wake on LAN, an input_button -- has no on or off: its state
      // is the time it was last pressed, so its tile never lit and a tap looked
      // like it did nothing. A tap that fires its action now lights the tile
      // for PRESS_MS, as HomeKit does for a momentary accessory, and goes dark
      // at once if Home Assistant refused the call.
      _momentary() {
        var d = String((this._config || {}).entity || '').split('.')[0];
        return d === 'button' || d === 'input_button';
      }
      _pressed() { return !!this._pressUntil && Date.now() < this._pressUntil; }
      // (Not an override of _call: a card never shadows an HkBase helper --
      // tests/test_dispatch.js.) A confirmation is asked first by HkBase, which
      // then comes back here with the answer.
      _act(spec, defaultMoreInfo) {
        var a = spec && spec.action;
        var svc = spec ? String(spec.service || spec.perform_action || '') : '';
        var parts = svc.split('.');
        if ((a === 'call-service' || a === 'perform-action') && this._momentary() && parts.length === 2 &&
            svc.indexOf('[[[') === -1 && !(spec.confirmation && !spec._hkConfirmed)) {
          var self = this;
          this._press();
          this._call(parts[0], parts[1], Object.assign({}, spec.data || {}, spec.target || {}))
            .then(function (ok) { if (!ok) self._unpress(); });
          return;
        }
        return super._act(spec, defaultMoreInfo);
      }
      _press() {
        var self = this;
        this._pressUntil = Date.now() + PRESS_MS;
        clearTimeout(this._pressT);
        this._pressT = setTimeout(function () { self._unpress(); }, PRESS_MS + 20);
        this.redraw();
      }
      _unpress() {
        clearTimeout(this._pressT);
        this._pressT = null; this._pressUntil = 0;
        this.redraw();
      }
      static get CSS() { return CSS; }

      setConfig(config) {
        if (!config || (!config.entity && !this._entityOptional(config))) {
          throw new Error('hk-tile: `entity` is required');
        }
        super.setConfig(normaliseIconStates(config));
      }
      // A tile that shows a state needs the entity it shows. One that is only
      // an action (a scene pill that navigates, like Live TV) does not.
      _entityOptional() { return false; }

      getCardSize() { return this._layout() === 'tall' || this._layout() === 'climate_tall' ? 2 : 1; }
      _layout() {
        var cfg = this._config || {};
        // on a Home Grid the block decides: its tall layout, whatever the size -- but Wide (2026-11-07, the owner) is Apple
        // Home's wide tile: the pill (Centered keeps the tall layout: wideTile)
        var cell = this._cellSize();
        return sizedLayout(LAYOUTS[cfg.layout] ? cfg.layout : 'standard', cell ? (cell === 'W' && this.getAttribute('tile') !== 'centred' ? 'regular' : 'tall') : cfg.size);
      }

      // THE LEVEL (T, 2026-11-07, the review): under the glyph and the words, a capsule the rest of the block tall -- the
      // detail sheet's dimmer (a rounded capsule, the filled part in the thing's own color or white) with its percent.
      // A drag up or down sets it (relative to where the finger lands, the whole capsule being 100 %; sent once, on
      // letting go: the room card's dimmer does the same), a tap toggles. Sideways it does nothing -- pages swipe.
      // `fill`: the filled part's color; `grad`: the plate is the own-color gradient (white fill, white words).
      _levelDraw(lv, st, on, fill, grad) {
        var e = this._els, box;
        this._lv = lv;
        if (!lv) {
          if (e.lvl) { e.lvl.remove(); e.lvl = null; }
          if (this.hasAttribute('level')) this.removeAttribute('level');
          return;
        }
        this.setAttribute('level', '');
        if (!e.lvl) {
          box = document.createElement('div');
          box.className = 'lvl'; box.setAttribute('role', 'slider'); box.tabIndex = 0;
          box.setAttribute('data-hk-hero', '');   // the Tall block's one control, made to fill it (the grid audit's --stretch)
          box.setAttribute('aria-valuemin', '0'); box.setAttribute('aria-valuemax', '100');
          box.innerHTML = '<i class="fill"></i><b></b>';
          e.grid.appendChild(box);
          // WIDE (2026-11-09, the owner: "the wide accessory card with slider doesn't match ... the tall"): the Tall's capsule turned
          // sideways -- beside the glyph and the words, filling the rest of the plate, its fill growing left to right (.side)
          if (this._cellSize() === 'W') box.classList.add('side');
          e.lvl = box;
          this._levelWire(box);
        }
        var pct = this._lvDrag != null ? this._lvDrag : (this._lvHold && Date.now() < this._lvHold.until ? this._lvHold.pct : lv.pct);
        var fillEl = e.lvl.firstChild, label = e.lvl.lastChild;
        box = e.lvl;
        var side = box.classList.contains('side');
        if (side) fillEl.style.width = pct + '%'; else fillEl.style.height = pct + '%';
        fillEl.style.background = fill || '';
        // (the words' dark ink over the filled part: 22 % of a tall capsule's height, a third of a wide one's width)
        box.classList.toggle('hi', pct >= (side ? 34 : 22));
        box.classList.toggle('drag', this._lvDrag != null);
        var word = pct <= 0 && lv.words ? lv.words[0] : pct >= 100 && lv.words ? lv.words[1] : (!on && pct <= 0) || lv.off ? 'Off' : pct + '%';
        if (label.textContent !== word) label.textContent = word;
        var nm = (this._config && this._config.name) || (st && st.attributes && st.attributes.friendly_name) || '';
        box.setAttribute('aria-label', (nm ? nm + ' ' : '') + lv.what);
        box.setAttribute('aria-valuenow', String(pct));
        box.setAttribute('aria-valuetext', word);
      }
      _levelWire(box) {
        var self = this, s = null, eat = false;
        var send = function (c) {
          self._call(c[0], c[1], c[2]).then(function (ok) { if (!ok) { self._lvHold = null; self.redraw(); } });
        };
        var set = function (p) {
          var lv = self._lv;
          if (!lv) return;
          self._lvHold = { pct: p, until: Date.now() + 2500 };
          clearTimeout(self._lvT); self._lvT = setTimeout(function () { self._lvHold = null; self.redraw(); }, 2600);
          send(lv.set(p));
          self.redraw();
        };
        box.addEventListener('pointerdown', function (ev) {
          if (ev.button > 0 || !self._lv) return;
          var r = box.getBoundingClientRect();
          s = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, pct: self._lv.pct, h: Math.max(1, r.height), w: Math.max(1, r.width), moved: false, across: box.classList.contains('side') };
          try { box.setPointerCapture(ev.pointerId); } catch (x) { /* a test page */ }
        });
        box.addEventListener('pointermove', function (ev) {
          if (!s || ev.pointerId !== s.id) return;
          var dy = ev.clientY - s.y;
          if (s.side) return;
          if (s.across) {
            // (Wide: across sets it; a drag that starts up or down is the page's scroll, and no tap)
            var dx = ev.clientX - s.x;
            if (!s.moved && Math.hypot(dx, dy) >= 6 && Math.abs(dy) > Math.abs(dx)) { s.side = true; return; }
            if (!s.moved && Math.abs(dx) < 6) return;
            s.moved = true;
            ev.preventDefault();
            self._lvDrag = Math.max(0, Math.min(100, Math.round(s.pct + dx / s.w * 100)));
            self.redraw();
            return;
          }
          // (a drag that starts sideways is no one's here: pages swipe -- and it is no tap either)
          if (!s.moved && Math.hypot(dy, ev.clientX - s.x) >= 6 && Math.abs(ev.clientX - s.x) > Math.abs(dy)) { s.side = true; return; }
          if (!s.moved && Math.abs(dy) < 6) return;
          s.moved = true;
          ev.preventDefault();
          self._lvDrag = Math.max(0, Math.min(100, Math.round(s.pct - dy / s.h * 100)));
          self.redraw();
        });
        var end = function (ev, ok) {
          if (!s || ev.pointerId !== s.id) return;
          var d = s; s = null;
          if (d.side) { eat = ok; setTimeout(function () { eat = false; }, 0); return; }
          if (!d.moved) return;
          eat = ok; setTimeout(function () { eat = false; }, 0);
          var p = self._lvDrag;
          self._lvDrag = null;
          if (ok && p != null && p !== d.pct) set(p); else self.redraw();
        };
        box.addEventListener('pointerup', function (ev) { end(ev, true); });
        box.addEventListener('pointercancel', function (ev) { end(ev, false); });
        // a tap toggles (and is the capsule's, never the plate's); the click that ends a drag is the drag's
        box.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (eat) { eat = false; return; }
          if (self._lv) send(self._lv.toggle);
        });
        box.addEventListener('keydown', function (ev) {
          var lv = self._lv, k = ev.key;
          if (!lv) return;
          if (k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft') {
            ev.preventDefault();
            var up = k === 'ArrowUp' || k === 'ArrowRight';
            set(Math.max(0, Math.min(100, (self._lvHold && Date.now() < self._lvHold.until ? self._lvHold.pct : lv.pct) + (up ? 5 : -5))));
          } else if (k === 'Enter' || k === ' ') { ev.preventDefault(); send(lv.toggle); }
        });
        box.addEventListener('contextmenu', function (ev) { ev.stopPropagation(); });
      }

      // Subclasses answer these four; everything else is shared.

      // "ON" IS NOT JUST 'on'. ON_STATES lists ten more states that light the
      // tile up; missing them renders every open blind, unlocked door and armed
      // alarm in the OFF material.
      _isOn(st) {
        // `group_lit: any` -- a tile standing for SEVERAL entities that has no
        // group entity of its own to ask. "Vanity + Shower Lights" is two plain
        // lights, so the plate lights when either does; without this the tile
        // reads OFF while half the room is lit.
        //
        // The DEFAULT is still the card's own entity: a tile whose entity is a
        // light group (light.bathroom_lights) must follow the group, not its
        // members.
        if (this._config && this._config.group_lit === 'any') {
          return this._groupOn().length > 0;
        }
        if (!st) return false;
        return ON_STATES.indexOf(st.state) !== -1;
      }

      // The members of `group:` that are currently on, as state objects.
      // `group` is a plain list of entity ids; HkBase._sigOf reads it too, so a
      // member changing wakes the tile.
      _groupOn() {
        var ids = (this._config && this._config.group) || [];
        var out = [];
        for (var i = 0; i < ids.length; i++) {
          var g = this._st(ids[i]);
          if (g && g.state === 'on') out.push(g);
        }
        return out;
      }
      _label(st) { return st ? st.state : ''; }
      // A stateful glyph -- a blind that closes, a lock that opens, a humidifier
      // that starts -- is a
      // state->icon map: `icon` is the default and icon_states names the
      // exceptions. Declarative, so it survives being authored by hand in YAML.
      _icon(st) {
        var m = this._config.icon_states;
        if (m && st && m[st.state] != null) return m[st.state];
        return this._config.icon;
      }
      // Overridable because a tile may replace the pill's colour rule
      // entirely -- the media tile does.
      _iconColour(cfg, st, on) { return iconColour(cfg, st, on); }
      // ITS OWN COLOR, for its gradient (`block_color`): the glyph's when lit;
      // and whether it stands on it while off too (a scene, which is never on)
      _ownColour(cfg, st) { return colourFor(cfg, st); }
      _paintedOff() { return false; }
      // A CSS class rather than inline styles, so a variant's deltas live in the
      // shared stylesheet and cost nothing per instance.
      _variant() { return ''; }
      _wellBackground(cfg, st, on) { return cfg.well_background || wellColour(cfg, st, on); }
      // AN OFF PILL'S OWN COLOR, for Flat Colors' Automatic tint: a calm off
      // color where it has one (a leak sensor's drop), else its color -- the
      // same for every kind, media too. Unavailable has none of its own.
      _idleSource(cfg, st) {
        if (st && (st.state === 'unavailable' || st.state === 'unknown')) return null;
        if (cfg.off_icon_color) {
          var o = String(cfg.off_icon_color).toLowerCase().trim();
          return NAME_MAP[o] || cfg.off_icon_color;
        }
        return colourFor(cfg, st);
      }
      // A GLYPH WITH NO CIRCLE, by what the card says rather than how a
      // browser writes it back (Safari's `none` for transparent): a bare icon,
      // a well asked to be clear, or none drawn (null: the stylesheet's)
      _bareWell(cfg, wb) {
        return !!cfg.bare_icon || wb === null || /^\s*(transparent|none)\s*$/i.test(String(wb));
      }
      // A variant with no label row does not RENDER the element at all, rather
      // than leaving a display:none div behind.
      _hasLabel() { return true; }
      _animation() { return this._config.animation || 'none'; }
      // NO CARD IN THIS SET HAS A HOLD. Returning null means
      // the timer is never armed, so a slow press does exactly what a quick one
      // does -- which is what a wall tablet wants: a hold that does something
      // different is undiscoverable, and it fired by accident every time someone
      // rested a finger on a tile. Any `hold_action` left in a config is inert.
      // Override this in a card that genuinely needs one.

      _render() {
        var cfg = this._config || {};
        var st = this._st(cfg.entity);
        var on = !!this._isOn(st) || this._pressed();
        var layout = this._layout();
        // (a tall block's level, HomeView's Tall tile: this._levelDraw, below)
        // (Wide too, 2026-11-08, the owner: "the Wide accessory ... the same function as the tall ... with a horizontal slider", for
        // "anything that can slide like that": the whole Wide tile is the slider, as Control Center's -- a light, a fan, a shade)
        var cs = this._cellSize(), lv = cs === 'T' || cs === 'W' ? levelOf(cfg.entity, st) : null;
        if (lv && cs === 'W' && lv.what === 'volume') lv = null;

        if (!this._built) {
          this._root.innerHTML =
            '<hk-plate class="card" data-hk-role="card">' +
            '  <div class="grid">' +
            '    <div class="well" data-hk-role="well"><hk-state-icon class="icon" data-hk-role="icon"></hk-state-icon></div>' +
            '    <div class="name" data-hk-role="name"></div>' +
            '    <div class="label" data-hk-role="label"></div>' +
            // AFTER the label in DOM order. grid-area puts it on the top row
            // regardless, so this is free -- and the card's text then reads
            // "Front Door / Locked / Living Room", the accessory first.
            '    <div class="room"></div>' +
            '  </div>' +
            '</hk-plate>';
          this._els = {
            card: this._root.querySelector('.card'),
            grid: this._root.querySelector('.grid'),
            well: this._root.querySelector('.well'),
            icon: this._root.querySelector('.icon'),
            room: this._root.querySelector('.room'),
            name: this._root.querySelector('.name'),
            label: this._root.querySelector('.label')
          };
          if (!this._config.room) { this._els.room.remove(); this._els.room = null; }
          if (!this._hasLabel()) {
            this._els.label.remove();
            this._els.label = null;
          }
          // THE HOME APP SPLITS THE TAP TARGET: tapping the GLYPH toggles the
          // accessory and tapping the name opens detail. One target for both
          // makes every light tile more-info only: no style differs, and the
          // lights simply stop turning on when you tap them. Behaviour is not
          // visible to a computed-style check -- it has to be carried
          // deliberately, which is what icon_tap_action does.
          this._bind(this._els.card, 'tap_action');
          // a right-click (a mouse's, never a finger's) opens detail: hk-base
          this._bindDetail(this._els.card);
          if (this._config.icon_tap_action) {
            this._bind(this._els.well, 'icon_tap_action', null);
          }
          this._built = true;
        }

        var e = this._els;
        e.grid.style.gridTemplateAreas = LAYOUTS[layout];
        e.card.setAttribute('data-on', on ? '1' : '0');
        var variant = this._variant();
        // A variant may be two classes ('scene elevated'), so split it. Its
        // height classes follow the LAYOUT, not the variant: a tall tile made
        // regular (size) loses `tall`, a pill made tall gains it, and a
        // thermostat's tall tile made regular wears the pill's `climate`.
        var cls = (variant ? variant.split(' ') : []).filter(function (c) { return c && c !== 'tall' && c !== 'climate_tall'; });
        if (layout === 'climate_tall') cls.push('climate_tall');
        if (layout === 'climate_pill' && cls.indexOf('climate') < 0) cls.push('climate');
        cls.forEach(function (c) { e.card.classList.add(c); });
        e.card.classList.toggle('tall', layout === 'tall' || layout === 'climate_tall');
        // THREE LINES (a room line over the name and state): the favourite and
        // the climate favourite's layouts, whatever card draws them -- the
        // group sheet's favourite-layout pills carry no `favourite` variant.
        // Its height and row are the table's fav / favRow (hk-base.js TILE).
        e.card.classList.toggle('three-line', layout === 'favourite' || layout === 'climate');
        if (layout !== 'climate_tall') e.card.classList.remove('climate_tall');
        if (e.label) e.label.style.display = (layout === 'action') ? 'none' : '';

        // well_background is the per-card escape hatch -- the Home app draws
        // Apple TV and HomePod
        // with no well in EVERY state, and that is how those cards say so.
        // An inline style would beat the variant's stylesheet rule, so a card
        // that paints no well (scene) returns null and CSS decides. This is the
        // whole reason _wellBackground exists rather than a direct assignment.
        // TILE STYLE ON A PAGE (2026-10-30): a Tall pill that is no Home Grid
        // block's (its block sets `tile` on it) takes its own `tile`, else the
        // screen's (hkSettings.tileStyle: its own, else All Screens'). A
        // regular pill stays as it is: wide and short, centred reads badly.
        if (!this.hasAttribute('size') && !this.hasAttribute('data-group-fill')) {
          // (the room pages' Tall pills are the Home app's, whatever the Tile Style: Centred is HomeView's, for the Home
          // Grid alone -- 2026-10-31, the owner: "The HomeView styling is really just for the Main dashboard page...
          // and the Pages Screen". A Home Grid block hands its tiles `tile` itself)
          var centred = cfg.tile === 'centred';
          if (centred) this.setAttribute('tile', 'centred'); else this.removeAttribute('tile');
        }
        // (a Centred tile's glyph while off: the screen's Icons -- the look's, Color or White; hkSettings.tileIcons)
        var HS = window.hkSettings, icons = this.getAttribute('tile') === 'centred' && HS && HS.tileIcons ? HS.tileIcons() : 'auto';
        if (icons === 'auto') this.removeAttribute('icons'); else this.setAttribute('icons', icons);
        // (a Centred tile draws every glyph bare, lit in its own colour, each
        // one as large as the next by what is drawn: TILE.centred.ink)
        var bareCfg = this.getAttribute('tile') === 'centred' ? Object.assign({}, cfg, { bare_icon: true }) : cfg;
        var wb = this._wellBackground(bareCfg, st, on);
        var ic = this._iconColour(bareCfg, st, on);
        // FLAT COLORS (2026-10-17; hk-base flatPalette / flatIdle): OFF, the
        // pill takes a wash of its source -- its own color, or the one tint
        // chosen -- its circle a deeper one and its glyph that color at 3:1.
        // A glyph with no circle (a scene, Apple TV, HomePod, the alarm)
        // stays bare. Lit pills are white, their wells their own colors.
        var C = window.hkCards, pal = !on && C.flatPalette ? C.flatPalette() : null;
        var idle = pal && pal.tinted ? C.flatIdle(this._idleSource(cfg, st), this._bareWell(cfg, wb), pal) : null;
        if (idle) {
          if (idle.well) wb = idle.well;
          ic = idle.glyph;
          e.card.setAttribute('data-hk-idle', '');
          e.card.style.setProperty('--hk-idle-pill', idle.pill);
          e.card.style.setProperty('--hk-idle-glyph', idle.glyph);
        } else if (e.card.hasAttribute('data-hk-idle')) {
          e.card.removeAttribute('data-hk-idle');
          e.card.style.removeProperty('--hk-idle-pill');
          e.card.style.removeProperty('--hk-idle-glyph');
        }
        // IN ITS OWN COLOR (`block_color`, the CSS's): on its gradient the glyph
        // is white -- bare, or in a white wash of a circle where it has one
        var grad = cfg.block_color && (on || this._paintedOff()) ? C.iconGradient(hexOf(this._ownColour(cfg, st)) || '#8e8e93') : null;
        if (grad) {
          if (idle) { e.card.removeAttribute('data-hk-idle'); e.card.style.removeProperty('--hk-idle-pill'); e.card.style.removeProperty('--hk-idle-glyph'); }
          wb = this._bareWell(bareCfg, wb) ? 'transparent' : 'rgba(255,255,255,0.25)';
          ic = '#fff';
          e.card.setAttribute('data-hk-grad', '');
          e.card.style.setProperty('--hk-grad-a', grad[0]);
          e.card.style.setProperty('--hk-grad-b', grad[1]);
        } else if (e.card.hasAttribute('data-hk-grad')) {
          e.card.removeAttribute('data-hk-grad');
          e.card.style.removeProperty('--hk-grad-a');
          e.card.style.removeProperty('--hk-grad-b');
        }
        if (wb !== null) e.well.style.background = wb;
        e.icon.style.color = ic;
        // (the filled part: white on the gradient; lit on white, the light's own color, else the well's -- or, with no circle, the glyph's)
        this._levelDraw(lv, st, on, grad ? '#fff' : on ? (cfg.entity.indexOf('light.') === 0 && lightRgb(st)) || (wb && wb !== 'transparent' ? wb : ic) : '', !!grad);
        if (cfg.icon_size) {
          e.icon.style.width = cfg.icon_size;
          e.icon.style.height = cfg.icon_size;
        }

        // `spin` is a config option so a card can ask for it; HkFanCard
        // defaults it on.
        e.icon.classList.toggle('spin', this._animation() === 'spin');

        var cl = this.client; if (cl) cl.bindStateIcon(e.icon, st);
        var ic = this._icon(st);
        if (ic) e.icon.icon = ic;
        // CENTRED: each glyph as large as the next by what it draws, not its box
        // (hkInkScale, TILE.centred.ink: about 63 px of a 76 px box, HomeView's;
        // the alarm drawn to its box's edges was half again the lamps' size,
        // 2026-10-31). The host's icon element, so the box is scaled whole.
        var inkName = this.getAttribute('tile') === 'centred' && ic && window.hkInkScale ? ic : null, icEl = e.icon;
        if (!inkName) icEl.style.removeProperty('scale');
        else window.hkInkScale(inkName, window.hkCards.TILE.centred.ink).then(function (k) {
          if (icEl.icon === inkName || icEl.getAttribute('icon') === inkName || !icEl.icon) icEl.style.setProperty('scale', String(Math.round(k * 1000) / 1000));
        });

        if (e.room && e.room.textContent !== cfg.room) e.room.textContent = cfg.room;
        e.card.classList.toggle('roomed', !!e.room);
        var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
        if (e.name.textContent !== nm) e.name.textContent = nm;
        if (e.label) {
          var lb = this._label(st) || '', secondary = cfg.secondary;
          if (secondary && secondary.mode !== 'auto') {
            var a = st && st.attributes || {}, value;
            if (secondary.mode === 'none') lb = '';
            else if (secondary.mode === 'state') lb = st ? titled(st.state) : 'Unavailable';
            else if (secondary.mode === 'brightness') lb = brightnessLabel(st);
            else if (secondary.mode === 'attribute') {
              value = a[secondary.attribute];
              lb = value == null || typeof value === 'object' ? '—' : String(value) + (secondary.unit ? ' ' + secondary.unit : '');
            }
          } else if (lv && lv.what !== 'volume' && st) lb = titled(st.state);   // (the capsule says the percent: the line says the state)
          if (e.label.textContent !== lb) e.label.textContent = lb;
        }
        // A SENSOR'S READING (2026-11-08, the owner of the Tiny tile: "does it look like with a sensor...like temperature"): on a
        // Centered tile a temperature's or a humidity's number stands where the glyph would, as a thermostat's does
        var rd = this.getAttribute('tile') === 'centred' ? readingOf(cfg.entity, st) : null;
        e.card.classList.toggle('reading', !!rd);
        if (rd && (!this._readEl || this._readEl.parentNode !== e.grid)) { this._readEl = document.createElement('div'); this._readEl.className = 'temp'; e.grid.appendChild(this._readEl); }
        if (rd && this._readEl.textContent !== rd) this._readEl.textContent = rd;
        if (!rd && this._readEl && this._readEl.parentNode) this._readEl.remove();
      }
    }

    // ------------------------------------------------------------- hk-media
    // A TV or speaker tile: what it is playing, or its input.
    class HkMediaCard extends HkTileBase {
      // A real player from this home, so the picker preview is not empty.
      static getStubConfig(input) {
        var client = window.hkCards.asClient(input), ids = client ? Object.keys(client.states) : [];
        for (var i = 0; i < ids.length; i++) {
          if (ids[i].indexOf('media_player.') === 0) return { entity: ids[i] };
        }
        return { entity: 'media_player.example' };
      }

      // ON is `playing`, PLUS the pill's extended ON_STATES -- not `playing ||
      // on` alone. The difference is not theoretical: 'paused' is in that list,
      // so a paused HomePod renders as an ON tile (white plate, black text). A
      // test of idle/on/off/playing/unavailable alone never exercises it --
      // test paused too.
      _isOn(st) {
        if (!st) return false;
        return st.state === 'playing' || ON_STATES.indexOf(st.state) !== -1;
      }

      _label(st) {
        var s = (st && st.state) || 'unavailable';
        var at = (st && st.attributes) || {};
        // `source_first` is the televisions' variant: whatever the box is showing
        // ("HDMI 1") is more useful than its transport state, so a source wins
        // even when the player reports idle or standby.
        if (this._config.label_mode === 'source_first') {
          if (s === 'off') return 'Off';
          if (s === 'unavailable' || s === 'unknown') return 'Unavailable';
          if (at.source) return String(at.source);
          if (s === 'playing') return 'Playing';
          if (s === 'paused') return 'Paused';
          if (s === 'idle' || s === 'standby' || s === 'on') return 'Not Playing';
          return sentence(s);
        }
        // THE HOMEPODS AND THE APPLE TVS read as the Home app's do: Playing,
        // Paused, Not Playing. A source is not what is playing --
        // Music Assistant's HomePods report "Music Assistant Queue" -- and an
        // Apple TV's app ("YouTube") read differently from every HomePod.
        if (s === 'playing') return 'Playing';
        if (s === 'paused') return 'Paused';
        if (s === 'idle' || s === 'standby' || s === 'on') return 'Not Playing';
        if (s === 'off') return 'Off';
        if (s === 'unavailable' || s === 'unknown') return 'Unavailable';
        return sentence(s);
      }

      // icon_color is cyan by default; a card config may override it.
      setConfig(config) {
        var c = Object.assign({ icon_color: 'cyan' }, config);
        super.setConfig(c);
      }

      // A media tile REPLACES the pill's icon colour rather than inheriting it:
      // the glyph is a flat white unless it is bare, in which case icon_color
      // paints the glyph itself because there is no well to carry the colour.
      // The inherited colour map would tint every media glyph cyan.
      _iconColour(cfg, st, on) {
        // (a Centred tile's Icons White: white off, as every other tile's -- hkSettings.tileIcons)
        if (!on && this.getAttribute('icons') === 'white') return 'rgba(255,255,255,0.94)';
        if (!on) {
          // (through flatColor: Flat's Light darkens the white glyph made for
          // the dark glass, or it vanished on the ivory tile -- Apple TV, HomePod)
          return (cfg.bare_icon && cfg.icon_color) ? window.hkCards.flatColor(cfg.icon_color, 'glyph') : '' + window.hkCards.v('glyph') + '';
        }
        // CENTRED, PLAYING (2026-10-31): the speaker's own color on the white
        // plate, as every lit Centred glyph is -- not the HomePod's grey, which
        // read as off beside the lamps in a Room block
        if (this.getAttribute('tile') === 'centred') return window.hkCards.flatColor(this._ownColour(cfg, st), 'on');
        return super._iconColour(cfg, st, on);
      }
      // A SPEAKER'S OWN COLOR: its accessory's Color (icon_color, a palette
      // name or a hex), else Music's -- its page's accent -- never the HomePod
      // glyph's white or grey
      _ownColour(cfg) {
        var c = String(cfg.icon_color || '').toLowerCase().trim();
        if (c && c !== 'white' && (NAME_MAP[c] || /^#[0-9a-f]{6}$/.test(c))) return NAME_MAP[c] || c;
        var C = window.hkCards;
        return (C.pageAccentHex && C.pageAccentHex('music')) || (C.ACCENTS && C.ACCENTS.pink) || '#ff375f';
      }
    }

    // what the shell and the later parts use of this one
    K.HkMediaCard = HkMediaCard; K.HkTileBase = HkTileBase;
  };
})();
