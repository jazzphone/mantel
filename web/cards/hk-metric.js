// The existing HK metric card, using HKClient for its data and host icon binding.
// CSS, editor metadata, action handling and its base remain in the existing card family.
(function (global) {
  'use strict';
  if (global.hkCreateMetricCard) return;
  global.hkCreateMetricCard = function (HkStatBase, metricColour, FLOW_FLOOR) {
  class HkMetricCard extends HkStatBase {
    setConfig(config) {
      if (!config || !config.entity) throw new Error('hk-stat: `entity` is required');
      super.setConfig(config);
    }
    _render() {
      var cfg = this._config, st = this._st(cfg.entity);
      if (!this._built) {
        this._root.innerHTML =
          '<hk-plate class="metric" data-hk-role="card"><div class="grid">' +
          '<div class="well" data-hk-role="well"><hk-state-icon class="icon" data-hk-role="icon"></hk-state-icon></div>\n' +
          '<div class="name" data-hk-role="name"></div>\n' +
          '<div class="state" data-hk-role="state"></div>\n' +
          '</div></hk-plate>';
        this._e = {
          card: this._root.querySelector('.metric'), icon: this._root.querySelector('.icon'),
          name: this._root.querySelector('.name'), state: this._root.querySelector('.state')
        };
        // _bind, not a hardcoded more-info: these configs carry tap_action
        // (some with a `confirmation`), and a card that always
        // opened the detail dialog would drop it with no visible symptom.
        // No hold key -- the tap contract has no hold anywhere.
        this._bind(this._e.card, 'tap_action', null);
        this._built = true;
      }
      var e = this._e;
      e.icon.style.color = metricColour(cfg);
      if (this.client && this.client.bindStateIcon) this.client.bindStateIcon(e.icon, st);
      var ic = this._icon(st);
      if (ic) e.icon.icon = ic;
      var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
      if (e.name.textContent !== nm) e.name.textContent = nm;
      // THE FORMATTED STATE, not the raw one. The value shows
      // what HA would show -- "0.51 MB", not "0.51" -- so it carries the unit
      // and the locale's number formatting. client.formatEntityState is the same
      // function the rest of the frontend uses; the fallback only matters on
      // an older core.
      var val;
      var mode = this._modeValue(st);
      if (mode !== null) {
        val = mode;
      } else if (cfg.value != null) {
        val = cfg.value;
      } else if (st && this.client && this.client.formatEntityState) {
        val = this.client.formatEntityState(st);
      } else if (st) {
        var u = st.attributes && st.attributes.unit_of_measurement;
        val = u ? (st.state + ' ' + u) : st.state;
      } else {
        val = '';
      }
      if (e.state.textContent !== val) e.state.textContent = val;
    }

    // ---- THE VALUE MODES -------------------------------------------------
    //
    // Each mode is a named reading, not a bespoke calculation:
    //
    //   temperature  a rounded degree, from the state or an attribute
    //   power        live watts through hkChart, already unit-formatted
    //   runtime      hours as "19h 3m", or `idle_text` at or below zero
    //   cost         "$1.23 \u00b7 45 kWh" -- a currency sensor and its meter
    //   cost_today   the same, from STATISTICS: today's change of a kWh meter
    //                (`stat`) and of its cost (`cost_stat`), or the kWh times
    //                `price` (a number, or an entity holding one) -- for a
    //                house with no "today's cost" sensor (the Energy page)
    //   flow         two sensors, charge and discharge; whichever is running
    //                wins, with its sign. Also picks the glyph (see _icon).
    //
    // Returns null when no mode applies, so the ordinary formatted state
    // still wins and nothing about the other cards changes.
    // THE TEMPERATURE'S UNIT when no value_suffix says: the sensor's own
    // (a degree unit read from the state, not from an attribute -- a
    // thermostat's current_temperature carries none), else the house's
    // (Settings -> System -> General), else °F as before.
    _tempUnit(st) {
      var cfg = this._config || {};
      var u = !cfg.value_attribute && st && st.attributes && st.attributes.unit_of_measurement;
      if (!u || String(u).charAt(0) !== '\u00b0') {
        u = window.hkLocale.units().temp;
      }
      return String(u);
    }

    _modeValue(st) {
      var cfg = this._config, m = cfg.value_mode;
      if (!m) return null;
      var n = function (v) { return Number.isFinite(Number(v)) ? Number(v) : null; };

      if (m === 'temperature') {
        var t = cfg.value_attribute
          ? (st && st.attributes && st.attributes[cfg.value_attribute])
          : (st && st.state);
        var tv = n(t);
        return tv === null ? '--' : (Math.round(tv) + (cfg.value_suffix || this._tempUnit(st)));
      }

      if (m === 'runtime') {
        var h = n(st && st.state);
        if (h === null || h <= 0) return cfg.idle_text || 'Standby';
        var whole = Math.floor(h);
        return whole + 'h ' + Math.round((h - whole) * 60) + 'm';
      }

      // hkChart is a separate module that may not have loaded yet. Every mode
      // below needs it, and "--" is the honest answer until it has.
      var C = window.hkChart, h2 = this.client;
      if (!C || !h2) return '--';
      var watts = function (id) {
        return C.power(h2.states, id, { watts: true, fallback: null });
      };
      var fmt = function (id) { return C.power(h2.states, id); };

      if (m === 'power') return fmt(cfg.power || cfg.entity);

      if (m === 'cost_today') {
        var S2 = window.hkStats;
        if (!S2 || !cfg.stat) return '--';
        var ids = [cfg.stat].concat(cfg.cost_stat ? [cfg.cost_stat] : []);
        var all = S2.daily(h2, ids, 2, this);
        var today = function (id) {
          var a = all && all[id], v = a && a.length ? a[a.length - 1].v : null;
          return Number.isFinite(v) ? v : null;
        };
        var kwh = today(cfg.stat), money = cfg.cost_stat ? today(cfg.cost_stat) : null;
        if (money === null && kwh !== null && cfg.price != null) {
          var pr = typeof cfg.price === 'number' ? cfg.price : n(this._st(cfg.price) && this._st(cfg.price).state);
          if (pr !== null) money = kwh * pr;
        }
        if (kwh === null && money === null) return '--';
        var ms = money === null ? null : window.hkCards.money(h2, money, 2);
        var ks = kwh === null ? null : (Math.round(kwh) + ' kWh');
        return [ms, ks].filter(Boolean).join(' \u00b7 ');
      }

      if (m === 'cost') {
        var c = n(st && st.state);
        var cs = c === null ? '--' : window.hkCards.money(this.client, c, 2);
        var k = n(this._st(cfg.value_peer) && this._st(cfg.value_peer).state);
        return k === null ? cs : (cs + ' \u00b7 ' + Math.round(k) + ' kWh');
      }

      if (m === 'flow') {
        // DISCHARGE IS TESTED FIRST. Both sensors can read non-zero at once
        // during a changeover, and "the house is drawing from the battery" is
        // the more urgent of the two readings.
        var dis = watts(cfg.discharge), chg = watts(cfg.charge);
        if (dis !== null && dis >= FLOW_FLOOR) return '\u2212' + fmt(cfg.discharge);
        if (chg !== null && chg >= FLOW_FLOOR) return '+' + fmt(cfg.charge);
        return cfg.idle_text || 'Idle';
      }
      return null;
    }

    // `flow` picks its own glyph from the same two readings the value uses.
    _icon(st) {
      var cfg = this._config;
      if (cfg.value_mode === 'flow' && cfg.icon_flow && window.hkChart && this.client) {
        var C = window.hkChart, S = this.client.states;
        var w = function (id) {
          return C.power(S, id, { watts: true, fallback: 0 });
        };
        if (w(cfg.discharge) >= FLOW_FLOOR) return cfg.icon_flow.discharging;
        if (w(cfg.charge) >= FLOW_FLOOR) return cfg.icon_flow.charging;
        return cfg.icon_flow.idle;
      }
      return cfg.icon;
    }

    // A metric may read sensors its `entity` does not name -- the cost tile's
    // meter, the flow tile's two power sensors. Without them in the signature
    // the card renders once and then freezes -- the same trap as the chips'.
    _sigOf() {
      var h = this.client, c = this._config;
      if (!h || !c) return null;
      var ids = [c.entity, c.power, c.value_peer, c.charge, c.discharge,
                 typeof c.price === 'string' ? c.price : null]
                  .filter(Boolean);
      var out = '';
      for (var i = 0; i < ids.length; i++) {
        var s = h.states[ids[i]];
        out += ids[i] + '=' + (s ? s.last_updated : 'x') + ';';
      }
      return out;
    }
  }

    return HkMetricCard;
  };
  try { global.dispatchEvent(new CustomEvent('hk-metric-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
