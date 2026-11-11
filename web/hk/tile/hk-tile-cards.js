// hk-tile-cards.js - the tile, light, fan, cover, scene, favorite, climate and tall cards.
//
// PART OF THE TILE CARDS (hk-tile.js). Not a card and not run on its own: it registers one
// function, which hk-tile.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkTileParts = window.hkTileParts || {})['hk-tile-cards'] = function (K) {
    var brightnessLabel = K.brightnessLabel, C = K.C, colourFor = K.colourFor, HEAT_STATES = K.HEAT_STATES,
        HkTileBase = K.HkTileBase, LABEL_MODES = K.LABEL_MODES, ownTint = K.ownTint, sentence = K.sentence,
        tempColour = K.tempColour, titled = K.titled;

    // The plain tile. A label is a static string, a named mode, or
    // (falling through) the on/off default.
    class HkTileCard extends HkTileBase {
      _sigOf() {
        var sig = super._sigOf(), mode = (this._config || {}).label_mode;
        if (mode === 'climate_temperature' || mode === 'climate_humidity') {
          sig += ';reading:' + !!(window.hkRoom && window.hkRoom.climateReading) + ':' +
            window.hkLocale.units().temp;
        }
        // (a machine's tile reads every part of it, and its minutes left move on)
        var L = window.hkLaundry, mid = (this._config || {}).machine;
        if (mode === 'laundry' && L && mid && this.client) {
          var m = L.byId(this.client, mid), sts = this.client.states || {};
          if (m) L.ids(this.client, m).forEach(function (id) { var x = sts[id]; sig += ';' + id + '=' + (x ? x.state : '-'); });
          sig += ';t' + Math.floor(Date.now() / 60000);
        }
        return sig;
      }
      // NOT REPORTING (the generated Water page's Sensor Coverage):
      // how many of `group` have said nothing -- neither on nor off -- shown
      // lit, since the tile is only there while that is more than none.
      // It stands for its group: no entity of its own.
      _entityOptional(c) { return !!(c && c.label_mode === 'unreported' && Array.isArray(c.group) && c.group.length); }
      _unreported() {
        var h = this.client, grp = Array.isArray(this._config.group) ? this._config.group : [];
        return grp.filter(function (id) { var x = h && h.states[id]; return !x || (x.state !== 'on' && x.state !== 'off'); }).length;
      }
      // A WASHER OR DRYER (phase 22): what hkLaundry reads off all its parts -- lit while it runs, waits to be unloaded or needs a look
      _laundry() {
        var L = window.hkLaundry, id = this._config && this._config.machine;
        if (!L || !id || !this.client) return null;
        var m = L.byId(this.client, id);
        return m ? L.look(this.client, m) : null;
      }
      _isOn(st) {
        if (this._config && this._config.label_mode === 'unreported') return this._unreported() > 0;
        if (this._config && this._config.label_mode === 'laundry') {
          var lo = this._laundry();
          return !!lo && (lo.runs || lo.state === 'done' || lo.state === 'wrinkle' || lo.state === 'leak' || lo.state === 'error');
        }
        return super._isOn(st);
      }
      _label(st) {
        var cfg = this._config;
        if (cfg.label != null) return cfg.label;
        if (cfg.label_mode === 'unreported') return String(this._unreported());
        // "Drying · 24 min", "Done", "Off": what it is doing and how long, in a tile's one line
        if (cfg.label_mode === 'laundry') {
          var lo = this._laundry();
          if (!lo) return 'Unavailable';
          return lo.runs && lo.left != null && lo.state !== 'paused' ? lo.title + ' · ' + window.hkLaundry.dur(lo.left) : lo.title;
        }
        var s = (st && st.state) || 'unknown';
        if (cfg.label_mode === 'climate_temperature' || cfg.label_mode === 'climate_humidity') {
          var kind = cfg.label_mode.slice(8), R = window.hkRoom;
          var reading = R && R.climateReading && this.client ? R.climateReading(this.client, cfg.entity, kind) : null;
          return reading == null ? 'Unavailable' : Math.round(reading) + (kind === 'temperature' ? '°' : '%');
        }

        // The Home app names the JOB, not the state: "Lowering to 45%" on a
        // dehumidifier, the same way a thermostat reads "Cool to 72" rather than
        // "On". Keyed on device_class, not on `action`, so the phrase is stable
        // whether the unit is actively running or idling at its target -- which
        // is what the thermostat label does too.
        if (cfg.label_mode === 'brightness') return brightnessLabel(st);
        // A BLIND READS ITS POSITION, not its state: "45%" says more than
        // "Open", and the two endpoints still read Closed / Open so a fully
        // shut blind never says "0%". Falls back to the state when the cover
        // reports no position (some do not).
        if (cfg.label_mode === 'position') {
          if (s === 'unknown' || s === 'unavailable') return titled(s);
          var pos = st && st.attributes && st.attributes.current_position;
          if (pos != null && !isNaN(Number(pos))) {
            var pp = Math.round(Number(pos));
            if (pp <= 0) return 'Closed';
            if (pp >= 100) return 'Open';
            return pp + '%';
          }
          if (s === 'open' || s === 'opening') return 'Open';
          if (s === 'closed' || s === 'closing') return 'Closed';
          return titled(s);
        }
        // An IDLE TIMER shows what it is about to run for -- "45 min", "2 hr 30
        // min" -- so the tile is its own label AND its own button. `duration` is
        // an H:MM:SS string; a timer with no duration says "Start".
        if (cfg.label_mode === 'duration') {
          var dur = st && st.attributes && st.attributes.duration;
          if (!dur) return 'Start';
          var parts = String(dur).split(':').map(Number);
          if (parts.some(isNaN)) return 'Start';
          while (parts.length < 3) parts.unshift(0);
          var hh = parts[0], mm = parts[1];
          if (!hh && !mm) return 'Start';
          if (hh && mm) return hh + ' hr ' + mm + ' min';
          return hh ? (hh + ' hr') : (mm + ' min');
        }
        // ---- the two GROUP labels. See `group` on HkTileBase below.
        if (cfg.label_mode === 'group_brightness') {
          var lit = this._groupOn();
          if (!lit.length) return 'Off';
          var pcts = [];
          for (var gi = 0; gi < lit.length; gi++) {
            var gb = lit[gi].attributes && lit[gi].attributes.brightness;
            if (gb != null && !isNaN(Number(gb))) {
              pcts.push(Math.round((Number(gb) / 255) * 100));
            }
          }
          if (!pcts.length) return 'On';
          var sum = 0;
          for (var pi = 0; pi < pcts.length; pi++) sum += pcts[pi];
          return Math.round(sum / pcts.length) + '%';
        }
        if (cfg.label_mode === 'group_count') {
          // Gated on the card's OWN entity, not on the group: this tile's
          // entity is the group light itself, and "Off" means that group is
          // off. Counting members would say "1 On" for a group reporting off.
          if (s !== 'on') return 'Off';
          var n = this._groupOn().length;
          return n > 1 ? (n + ' On') : 'On';
        }
        // A THERMOSTAT'S SETPOINT. Two modes because the two tiles say it
        // differently: the favourite row has no space for a verb and reads
        // "68\u00b0\u201372\u00b0"; the tall tile has the width and reads
        // "Heat to 72\u00b0", which is what the Home app does.
        if (cfg.label_mode === 'setpoint' || cfg.label_mode === 'setpoint_verb') {
          var at = (st && st.attributes) || {};
          var num = function (v) { return v != null && !isNaN(Number(v)); };
          var deg = function (v) { return Math.round(Number(v)) + '\u00b0'; };
          var verb = cfg.label_mode === 'setpoint_verb';
          if (verb && s === 'off') return 'Off';
          if (num(at.target_temp_low) && num(at.target_temp_high)) {
            return deg(at.target_temp_low) + '\u2013' + deg(at.target_temp_high);
          }
          if (num(at.temperature)) {
            if (!verb) return deg(at.temperature);
            if (HEAT_STATES.indexOf(s) !== -1) return 'Heat to ' + deg(at.temperature);
            if (s === 'cool') return 'Cool to ' + deg(at.temperature);
            return 'Set to ' + deg(at.temperature);
          }
          // The plain mode does NOT title-case its fallback; the verb one does.
          return verb ? titled(s) : String(s).replace(/_/g, ' ');
        }
        if (cfg.label_mode === 'humidity') {
          if (s === 'off') return 'Off';
          if (s === 'unavailable' || s === 'unknown') return 'Unavailable';
          var at = (st && st.attributes) || {};
          var target = at.humidity;
          if (target == null || isNaN(Number(target))) return 'On';
          var down = at.device_class === 'dehumidifier' || at.action === 'drying';
          return (down ? 'Lowering to ' : 'Raising to ') + Math.round(Number(target)) + '%';
        }

        var preset = LABEL_MODES[cfg.label_mode];
        var map = cfg.label_map || (preset && preset.map);
        var dflt = cfg.label_default != null
          ? cfg.label_default : (preset && preset.dflt);
        if (map && map[s] != null) return map[s];
        if (dflt == null) {
          if (!st) return '';
          return s === 'on' ? 'On' : (s === 'off' ? 'Off' : s);
        }
        if (dflt === 'sentence') return sentence(s);
        if (dflt === 'title') return titled(s);
        if (dflt === 'spaces') return String(s).replace(/_/g, ' ');
        return dflt;
      }
    }

    class HkLightCard extends HkTileCard {
      _label(st) {
        if (this._config.label != null) return this._config.label;
        return brightnessLabel(st);
      }
    }

    // The fan tile -- percentage when running.
    class HkFanCard extends HkTileCard {
      // Spins by default; a config can still turn it off.
      _animation() { return this._config.animation || 'spin'; }
      _label(st) {
        if (this._config.label != null) return this._config.label;
        var s = (st && st.state) || 'unknown';
        if (s === 'on') {
          var pct = st.attributes && st.attributes.percentage;
          if (pct !== undefined && pct !== null && !isNaN(Number(pct))) {
            return Math.round(Number(pct)) + '%';
          }
          return 'On';
        }
        if (s === 'off') return 'Off';
        return String(s).replace(/_/g, ' ').split(' ')
          .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
          .join(' ');
      }
    }

    // The cover tile -- position wins over state, because a blind at 40% is neither
    // open nor closed and saying "Open" there is wrong.
    class HkCoverCard extends HkTileCard {
      _label(st) {
        if (this._config.label != null) return this._config.label;
        var s = (st && st.state) || 'unknown';
        if (s === 'unknown' || s === 'unavailable') return titled(s);
        var pos = st && st.attributes && st.attributes.current_position;
        if (pos !== undefined && pos !== null && !isNaN(Number(pos))) {
          var p = Math.round(Number(pos));
          if (p <= 0) return 'Closed';
          if (p >= 100) return 'Open';
          return p + '%';
        }
        if (s === 'open' || s === 'opening') return 'Open';
        if (s === 'closed' || s === 'closing') return 'Closed';
        return sentence(s);
      }
    }

    // The scene tile -- the variant with the 33 deltas. Also the action tile,
    // which is a scene with `elevated: true`.
    class HkSceneCard extends HkTileBase {
      // A TAP RUNS IT. One placed by hand (the card picker's, written without a
      // tap_action) runs its scene, script or automation like the generated
      // rows' pills, rather than opening its sheet. A tap_action of its own wins.
      setConfig(config) {
        var c = config || {};
        if (c.entity && !c.tap_action) c = Object.assign({}, c, { tap_action: window.hkCards.sceneTap(String(c.entity)) });
        super.setConfig(c);
      }
      _variant() {
        return this._config.elevated ? 'scene elevated' : 'scene';
      }
      // A scene pill may be just an action: the Live TV pill navigates to the
      // Live TV page and has no entity. It then never lights (no state).
      _entityOptional() { return true; }
      // ...and no state change can change it, so it draws once. HkBase's default
      // signature is NULL -- "render on every push" -- when the config names no
      // entity, which would put an entity-less pill on several renders a second
      // on every dashboard that has one. 'static', like the back chevron. A
      // parent that lights a pill itself (_hkLit) already clears _hkSig to
      // redraw it (hk-media.js _paintBusy), so the gate does not hide that.
      _sigOf() {
        var c = this._config || {};
        if (!c.entity && !(Array.isArray(c.group) && c.group.length)) return 'static';
        return super._sigOf();
      }
      // (No tile has a hold -- see HkTileBase.)
      // A scene lights only on 'on' -- it does NOT get the pill's extended
      // ON_STATES, so a scene must not light up for 'open' or 'paused'.
      // _hkLit: set by a parent that decides on its own -- the speaker picker's
      // playlist pills have no entity at all, and light while
      // THIS screen's request for them is in flight.
      _isOn(st) {
        if (this._hkLit) return !!this._hkLit();
        return !!st && st.state === 'on';
      }
      _hasLabel() { return false; }
      _label() { return ''; }
      // ITS COLOUR, AS CHOSEN: an accessory's Color (its detail sheet), a page
      // pill's (HK Settings). White -- or none chosen -- is the Home app's own
      // scene: a bare white glyph, and a tapped one flips to near-black on the
      // white plate. A COLOUR is worn as an accessory wears it: off, the glyph
      // takes it; lit (a running script, a scene the moment it is tapped:
      // .hk-tapped), it fills a circle behind a white glyph on the white plate.
      _tint(cfg) {
        var c = cfg.icon_color ? String(cfg.icon_color).toLowerCase().trim() : '';
        return c && c !== 'white' ? colourFor(cfg, null) : null;
      }
      // no well unless lit in a colour: the scene stylesheet owns it otherwise
      _wellBackground(cfg, st, on) {
        var t = this._tint(cfg);
        return t ? (on ? t : 'none') : null;
      }
      _iconColour(cfg, st, on) {
        var t = this._tint(cfg);
        if (t) return on ? 'white' : t;
        return on ? 'rgba(0, 0, 0, 0.95)' : '' + window.hkCards.v('ink') + '';
      }
      // (Flat Colors: its chosen color, else neutral -- never the domain's)
      _idleSource(cfg) { return this._tint(cfg); }
      // ON ITS GRADIENT (`block_color`) always, a scene having no on: its
      // chosen color, else a tint of its own (ownTint)
      _ownColour(cfg) { return this._tint(cfg) || ownTint(cfg.entity || cfg.name); }
      _paintedOff() { return true; }
      _render() {
        super._render();
        var e = this._els, t = this._tint(this._config || {});
        if (!e || !e.card) return;
        e.card.classList.toggle('tinted', !!t);
        if (t) e.card.style.setProperty('--hk-tint', t);
      }
    }

    // The favorite tile -- adds a room line above the name. `room` is a plain
    // string in the config: a card authored by hand in YAML needs options
    // that read cleanly, not expressions.
    class HkFavoriteCard extends HkTileCard {
      _variant() { return 'favourite'; }
      setConfig(config) { super.setConfig(Object.assign({ layout: 'favourite' }, config)); }
    }

    // The climate favorite and the tall climate tile -- one class, two layouts.
    //
    // The two differ in three things and nothing else: the grid, the
    // type scale (both in CSS above), and WHEN THE PLATE IS LIT. The favourite
    // one is lit always -- a thermostat on
    // the favourites row is a reading, not a switch. The tall one lights only
    // while the system is on, like every other tall tile in the room grid.
    class HkClimateCard extends HkTileCard {
      _variant() { return 'climate'; }
      setConfig(config) { super.setConfig(Object.assign({ layout: 'climate' }, config)); }
      // Always the lit material.
      _isOn() { return true; }
      _render() {
        super._render();
        var e = this._els;
        // parentNode check, not just existence: a config edit rebuilds the grid
        // (HkBase.setConfig), and a kept reference would point at the old one.
        if (!this._tempEl || this._tempEl.parentNode !== e.grid) {
          this._tempEl = document.createElement('div');
          this._tempEl.className = 'temp';
          this._tempEl.setAttribute('data-hk-role', 'temp');
          e.grid.appendChild(this._tempEl);
        }
        var st = this._st(this._config.entity);
        var t = st && st.attributes && st.attributes.current_temperature;
        var txt = (t == null || isNaN(Number(t))) ? this._noTemp()
                                                  : (Math.round(Number(t)) + '\u00b0');
        if (this._tempEl.textContent !== txt) this._tempEl.textContent = txt;
        this._tempEl.style.color = tempColour(st, !!this._isOn(st));
      }
      // "--\u00b0" on the favourite row, where the column would otherwise
      // collapse and drag the text left; EMPTY on the tall tile, which has a
      // fixed 44px row and simply shows nothing.
      _noTemp() { return '--\u00b0'; }
    }

    class HkClimateTallCard extends HkClimateCard {
      _variant() { return 'climate_tall tall'; }
      setConfig(config) {
        super.setConfig(Object.assign({ layout: 'climate_tall' }, config));
      }
      _isOn(st) {
        var s = st && st.state;
        return !!s && ['off', 'unavailable', 'unknown'].indexOf(s) === -1;
      }
      _noTemp() { return ''; }
    }

    class HkTallCard extends HkTileCard {
      _variant() { return 'tall'; }
      setConfig(config) { super.setConfig(Object.assign({ layout: 'tall' }, config)); }
    }

    var WELL = { name: 'well_background', selector: { text: {} } };
    var BARE_COLOUR = { name: 'bare_icon_color', selector: C.selColour() };
    var ROOM = { name: 'room', selector: { text: {} } };
    // the same card draws a water heater (HEAT_STATES' eco, gas, electric)
    var CLIMATE = ['climate', 'water_heater'];

    // what the shell and the later parts use of this one
    K.BARE_COLOUR = BARE_COLOUR; K.CLIMATE = CLIMATE; K.HkClimateCard = HkClimateCard;
    K.HkClimateTallCard = HkClimateTallCard; K.HkCoverCard = HkCoverCard; K.HkFanCard = HkFanCard;
    K.HkFavoriteCard = HkFavoriteCard; K.HkLightCard = HkLightCard; K.HkSceneCard = HkSceneCard;
    K.HkTallCard = HkTallCard; K.HkTileCard = HkTileCard; K.ROOM = ROOM; K.WELL = WELL;
  };
})();
