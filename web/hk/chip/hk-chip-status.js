// hk-chip-status.js - the status chip and the toggle chip.
//
// PART OF THE CHIP CARDS (hk-chip.js). Not a card and not run on its own: it registers one
// function, which hk-chip.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkChipParts = window.hkChipParts || {})['hk-chip-status'] = function (K) {
    var colourFor = K.colourFor, entityIds = K.entityIds, expandKind = K.expandKind, HkChipBase = K.HkChipBase,
        labelFor = K.labelFor, passes = K.passes, pick = K.pick, ruleValue = K.ruleValue, tileToken = K.tileToken,
        valueOf = K.valueOf;

    class HkStatusChipCard extends HkChipBase {
      // DECLARE WHAT THE LABEL READS, or the chip renders once and then lies.
      // HkBase's default signature covers `entity` only, so a chip counting six
      // locks would never re-render when one of them unlocked -- it would sit on
      // its first value indefinitely: a card that watches only its own
      // `entity` sees every other input late, whenever that entity next
      // changes.
      //
      // COLLECTED BY WALKING THE WHOLE CONFIG, not from a list of known keys.
      // A list misses something -- `when.any_of` (Climate's icon and colour
      // read hvac_action on both thermostats), a list-valued `source` taken as
      // one id -- and the chip keeps a stale icon and colour until some other
      // watched sensor happens to change, or the page is reloaded. Any
      // entity-shaped string anywhere counts; *_action blocks
      // are skipped, since what a tap calls is not what the chip shows.
      // A `kind:` is expanded first (expandKind), so its entities are walked.
      _sigOf() {
        expandKind(this);
        var h = this.client, c = this._config;
        if (!h || !c) return null;
        if (this._sigCfg !== c) { this._sigCfg = c; this._sigIds = entityIds(c); }
        var ids = this._sigIds;
        // `count: {music: true}` names its rooms nowhere in the config: they are
        // the integration's, read now, so a speaker added in the UI is counted.
        if (c.count && c.count.music && window.hkMusic) {
          ids = ids.concat(window.hkMusic.rooms().map(function (r) { return r.entity; }));
        }
        // (a laundry chip reads every part of every machine, and its minutes move on)
        if (c.count && c.count.laundry && window.hkLaundry) {
          var LM = window.hkLaundry;
          LM.machines(h).forEach(function (m) { ids = ids.concat(LM.ids(h, m)); });
          ids = ids.concat(['~' + Math.floor(Date.now() / 60000)]);
        }
        // No rooms YET (hk_music has not answered) is a stable state, not
        // "unknown": returning null here would redraw the Speakers chip on
        // every state push until the feed arrives. The moment rooms exist the
        // signature changes anyway.
        if (!ids.length) return (c.count && c.count.music) ? tileToken() + 'music:none' : null;
        var out = tileToken();
        for (var i = 0; i < ids.length; i++) {
          var st = h.states[ids[i]];
          out += ids[i] + '=' + (st ? st.last_updated : 'x') + ';';
        }
        return out;
      }

      // SHOWN OR NOT: a quiet chip only while something is active, and a kind
      // the house does not have never. Hidden the way a conditional card is --
      // the host `hidden`, and `card-visibility-changed` so the hui-card around
      // it hides too and the row closes the gap.
      //
      // NOT WHILE HOME ASSISTANT IS STILL BUILDING THE CARD: setConfig renders
      // before hui-card has stored the element, and an event then reaches a
      // hui-card whose element is still null -- it throws, and every chip in
      // the row becomes a "Configuration error". Before the card is on the page the
      // attribute is enough: hui-card reads `hidden` when it first updates.
      _show(on) {
        if (this._shown === on) return;
        this._shown = on;
        this.hidden = !on;
        if (this.style) this.style.display = on ? '' : 'none';
        if (this.isConnected && this.dispatchEvent) {
          this.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: on }, bubbles: true, composed: true }));
        }
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        // Hidden before it was attached: say so now that someone can hear it.
        if (this._shown === false && this.dispatchEvent) {
          this.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: false }, bubbles: true, composed: true }));
        }
      }
      _active(cfg, st) {
        var a = cfg.active;
        if (!Array.isArray(a) || !a.length) return true;
        for (var i = 0; i < a.length; i++) if (passes(this, cfg, st, a[i])) return true;
        return false;
      }

      _render() {
        expandKind(this);
        var cfg = this._config, st = this._st(cfg.entity), on = this._isOn(st);
        this._show(!cfg.missing && (!cfg.quiet || this._active(cfg, st)));
        if (!this._built) {
          this._root.innerHTML =
            '<hk-plate class="chip status" data-hk-role="card"><div class="grid">' +
            '<div class="well" data-hk-role="well"><hk-state-icon class="icon" data-hk-role="icon"></hk-state-icon></div>' +
            // The newlines are not cosmetic: without whitespace between these
            // elements the card's text reads "Lights3 On" rather than
            // "Lights 3 On" -- to a screen reader, or in a copy.
            '\n<div class="name" data-hk-role="name"></div>\n' +
            '<div class="label" data-hk-role="label"></div>\n' +
            '</div></hk-plate>';
          this._e = {
            card: this._root.querySelector('.chip'), icon: this._root.querySelector('.icon'),
            name: this._root.querySelector('.name'), label: this._root.querySelector('.label')
          };
          // No hold -- see hk-tile.js. A long press does what a tap does.
          this._bind(this._e.card, 'tap_action', null);
          this._built = true;
        }
        var e = this._e;
        e.card.classList.toggle('inert', !!cfg.tap_action && cfg.tap_action.action === 'none');
        var val = valueOf(this, cfg, st);
        e.card.setAttribute('data-on', on ? '1' : '0');
        var ruleCol = ruleValue(this, cfg, st, cfg.icon_color_rules, 'color');
        e.icon.style.color = ruleCol
          ? colourFor({ icon_color: ruleCol }, st, val)
          : colourFor(cfg, st, val);
        // Flat's Light: a chip's glyph keeps its own bright color (the
        // user, 2026-10-17 -- a chip says how things are, on or off)
        if (window.hkCards.flatColor) e.icon.style.color = window.hkCards.flatColor(e.icon.style.color, 'on');
        e.icon.classList.toggle('spin', cfg.animation === 'spin');
        var cl = this.client;
        if (cl) cl.bindStateIcon(e.icon, st);
        // SAME FIRST-MATCH BRANCH AS THE LABEL, because Security's icon is a
        // branch too: triggered -> shield-alert, any lock open -> lock-open,
        // armed -> shield-lock, else shield-off. One predicate, three uses.
        var ic = ruleValue(this, cfg, st, cfg.icon_rules, 'icon')
              || pick(cfg.icon_states, val) || this._icon(st);
        if (ic) e.icon.icon = ic;
        this._sizeIcon(e.icon);
        var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
        if (e.name.textContent !== nm) e.name.textContent = nm;
        var lb = labelFor(this, cfg, st);
        if (e.label.textContent !== lb) e.label.textContent = lb;
      }
    }

    // The toggle chip. `option` turns it into a segment: with one set,
    // selection compares the entity's STATE to that option instead of testing
    // for 'on'. Same thing, different predicate -- one card with one option.
    class HkToggleCard extends HkChipBase {
      _isOn(st) {
        if (this._config.option != null) {
          return String((st && st.state) || '') === String(this._config.option);
        }
        return !!st && st.state === 'on';
      }
      _render() {
        var cfg = this._config, st = this._st(cfg.entity), on = this._isOn(st);
        if (!this._built) {
          this._root.innerHTML =
            '<hk-plate class="chip toggle" data-hk-role="card"><div class="grid">' +
            '<div class="name" data-hk-role="name"></div></div></hk-plate>';
          this._e = { card: this._root.querySelector('.chip'), name: this._root.querySelector('.name') };
          // No hold -- see hk-tile.js. A long press does what a tap does.
          this._bind(this._e.card, 'tap_action', null);
          this._built = true;
        }
        this._e.card.setAttribute('data-on', on ? '1' : '0');
        var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
        if (this._e.name.textContent !== nm) this._e.name.textContent = nm;
      }
    }

    // what the shell and the later parts use of this one
    K.HkStatusChipCard = HkStatusChipCard; K.HkToggleCard = HkToggleCard;
  };
})();
