// hk-sheet-generic.js - The generic sheet (an entity HK draws no sheet of its own for) and the list sheets.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-generic'] = function (K) {
    var C = K.C, canEdit = K.canEdit, domainOf = K.domainOf, esc = K.esc, gone = K.gone, isOn = K.isOn,
        PANEL_CSS = K.PANEL_CSS, SEARCH = K.SEARCH, SENSE_CSS = K.SENSE_CSS, SensePanel = K.SensePanel,
        sinceText = K.sinceText, TICK = K.TICK, toHost = K.toHost, unavailable = K.unavailable;

    // ------------------------------------------------------------ generic
    // THE GENERIC SHEET (Phase 2 P2.5): an entity HK draws no sheet of its
    // own for, on a host without a detail of its own (Mantel; Home Assistant
    // keeps its more-info dialog for these). Its glyph, its state in the
    // client's words, since when, what it says about itself (its key
    // attributes, named and formatted by the client), a control only where
    // one is obvious, and for an admin on a host with a detail of its own,
    // "Open in Home Assistant" (toHost). Nothing else: no history, no
    // settings beyond the gear every sheet has for an admin.
    //
    // NOT A KEY ATTRIBUTE: what the sheet already shows (name, glyph, unit,
    // the state's class), the host's bookkeeping, and anything that is not
    // a short value.
    var GENERIC_SKIP = {
      friendly_name: 1, icon: 1, entity_picture: 1, supported_features: 1, supported_color_modes: 1,
      assumed_state: 1, attribution: 1, device_class: 1, unit_of_measurement: 1, state_class: 1,
      editable: 1, id: 1, restored: 1, entity_id: 1, hidden: 1, icon_color: 1, options: 1
    };
    var GENERIC_ROWS = 8;
    // [{ key, name, value }]: at most GENERIC_ROWS, in the entity's own order
    function genericRows(c, s) {
      var a = (s && s.attributes) || {}, out = [];
      Object.keys(a).forEach(function (k) {
        if (out.length >= GENERIC_ROWS || GENERIC_SKIP[k]) return;
        var v = a[k], t = typeof v;
        var short = t === 'string' ? v !== '' && v.length <= 120 : t === 'number' ? isFinite(v) : t === 'boolean' ? true :
          Array.isArray(v) ? v.length > 0 && v.length <= 6 && v.every(function (x) { return typeof x === 'string' || typeof x === 'number'; }) : false;
        if (!short) return;
        var name, value;
        try { name = c && c.formatEntityAttributeName ? c.formatEntityAttributeName(s, k) : k; } catch (e) { name = k; }
        try { value = c && c.formatEntityAttributeValue ? c.formatEntityAttributeValue(s, k) : String(v); } catch (e) { value = String(v); }
        if (value == null || value === '') return;
        out.push({ key: k, name: String(name || k), value: String(value) });
      });
      return out;
    }
    // THE ONE OBVIOUS CONTROL, through the client's action port: a toggle
    // (homeassistant.toggle) for an on/off state in a domain that takes one,
    // Activate for a scene, Run for a script; none for anything else, and
    // never for what HK never toggles in one tap (hk-base's neverToggles).
    var GENERIC_TOGGLE = { remote: 1, group: 1, input_boolean: 1, switch: 1, light: 1, fan: 1, humidifier: 1 };
    function genericControl(c, id, s) {
      if (!s || !id) return null;
      var d = domainOf(id);
      if (C.neverToggles && C.neverToggles(c, id)) return null;
      if (d === 'scene') return { kind: 'run', label: 'Activate', domain: 'scene', service: 'turn_on' };
      if (d === 'script') return { kind: 'run', label: 'Run', domain: 'script', service: 'turn_on' };
      if (GENERIC_TOGGLE[d] && (s.state === 'on' || s.state === 'off')) {
        return { kind: 'toggle', label: s.state === 'on' ? 'Turn Off' : 'Turn On', domain: 'homeassistant', service: 'toggle' };
      }
      return null;
    }
    var GENERIC_CSS = [
      // a long state (a date and time, a sentence) steps down and wraps rather than leave the sheet
      '.big{max-width:100%;overflow-wrap:anywhere}',
      '.big.w.long{font-size:30px;letter-spacing:-0.5px;line-height:1.15}',
      '.gbtn{min-width:200px;height:50px;padding:0 24px;border:0;border-radius:25px;font:inherit;font-size:17px;font-weight:600;',
      '  color:' + window.hkCards.v('ink') + ';background:rgba(255,255,255,0.16);cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.gbtn.on{background:#30d158;color:#fff}',
      '.gbtn[disabled]{opacity:.45;cursor:default}',
      '.attrs{align-self:stretch;padding:4px 20px;border-radius:20px;background:rgba(255,255,255,0.08)}',
      '.attrs .r{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:12px 0;font-size:15px}',
      '.attrs .r + .r{border-top:0.5px solid rgba(255,255,255,0.12)}',
      '.attrs .k{color:' + window.hkCards.v('ink-2') + '}',
      '.attrs .v{text-align:right;overflow-wrap:anywhere}',
      '.hostlink{appearance:none;border:0;background:none;font:inherit;font-size:15px;color:#0a84ff;cursor:pointer;padding:6px 10px}',
      ':host([hk-flat]) .attrs{background:' + C.v('key') + '}',
      ':host([hk-flat]) .attrs .r + .r{border-top-color:' + C.v('line') + '}',
      ':host([hk-flat]) .gbtn:not(.on){background:' + C.v('key') + ';color:' + C.v('glyph') + '}'
    ].join('');
    class GenericPanel extends SensePanel {
      static get CSS() { return PANEL_CSS + SENSE_CSS + GENERIC_CSS; }
      hkWidthKind() { return 'generic'; }
      _render() {
        var s = this._stateObj, c = this.client, self = this;
        if (!s) return;
        if (!this._built) {
          this._built = true;
          this._shell('');
          var pn = this._root.querySelector('.pn');
          this._gCtl = document.createElement('button');
          this._gCtl.className = 'gbtn';
          this._gCtl.hidden = true;
          this._gCtl.addEventListener('click', function () { self._gRun(); });
          this._gList = document.createElement('div');
          this._gList.className = 'attrs';
          this._gList.hidden = true;
          this._gHost = document.createElement('button');
          this._gHost.className = 'hostlink';
          this._gHost.textContent = 'Open in Home Assistant';
          this._gHost.hidden = true;
          this._gHost.addEventListener('click', function () { toHost(self._id); });
          pn.appendChild(this._gCtl);
          pn.appendChild(this._gList);
          pn.appendChild(this._gHost);
        }
        var txt;
        try { txt = c && c.formatEntityState ? c.formatEntityState(s) : s.state; } catch (e) { txt = s.state; }
        this._glyph(s, isOn(s));
        this._big.textContent = gone(s) ? 'Unavailable' : txt;
        this._big.classList.toggle('long', String(this._big.textContent).length > 14);
        this._since.textContent = unavailable(s) ? '' : sinceText(s.last_changed);
        // the control: what it does now (a toggle's word follows the state)
        var ctl = genericControl(c, this._id, s);
        this._gSpec = ctl;
        this._gCtl.hidden = !ctl;
        if (ctl) {
          this._gCtl.textContent = ctl.label;
          this._gCtl.classList.toggle('on', ctl.kind === 'toggle' && s.state === 'on');
          this._gCtl.disabled = gone(s);
        }
        // the key attributes, redrawn only when what they say changed
        var rows = genericRows(c, s), sig = JSON.stringify(rows);
        if (sig !== this._gSig) {
          this._gSig = sig;
          this._gRows = rows;
          this._gList.innerHTML = '';
          rows.forEach(function (r) {
            var row = document.createElement('div'), k = document.createElement('span'), v = document.createElement('span');
            row.className = 'r'; k.className = 'k'; v.className = 'v';
            k.textContent = r.name; v.textContent = r.value;
            row.appendChild(k); row.appendChild(v);
            self._gList.appendChild(row);
          });
          this._gList.hidden = !rows.length;
        }
        // an admin, on a host with a detail of its own (none in Mantel)
        this._gHost.hidden = !(canEdit(c) && window.hkShell.hostDetail(this._id));
      }
      _gRun() {
        var ctl = this._gSpec, s = this._stateObj, self = this;
        if (!ctl || !s || gone(s)) return;
        var go = function () { self._svc(ctl.domain, ctl.service); };
        var conf = this._src.confirmation;
        if (conf && C.confirmSheet) C.confirmSheet(conf.text || (ctl.label + '?'), go);
        else go();
      }
    }

    // ------------------------------------------------------------ lists
    // One pick-list look for every "choose one of these": a select, a
    // humidifier's modes. The current row carries the orange tick the light's
    // effects use; past 12 rows there is a search.
    var LIST_CSS = [
      // (each list in a frame with the sheet's shadows: BASE_CSS .hk-edge)
      '.lf{flex:0 0 auto;align-self:stretch}',
      '.list{align-self:stretch;border-radius:18px;background:rgba(255,255,255,0.06);max-height:420px;overflow-y:auto;',
      '  overscroll-behavior:contain;scrollbar-width:none}',
      '.list::-webkit-scrollbar{display:none}',
      '.list button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;',
      '  min-height:52px;padding:0 18px;border:0;border-bottom:1px solid rgba(255,255,255,0.07);',
      '  background:transparent;color:' + window.hkCards.v('ink') + ';font:inherit;font-size:17px;text-align:left;cursor:pointer}',
      '.list button span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.list button svg{flex-shrink:0}',
      '.list button:last-child{border-bottom:0}',
      '.list button:active{background:rgba(255,255,255,0.08)}',
      '.search{align-self:stretch;display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;border-radius:14px;',
      '  background:rgba(255,255,255,0.10)}',
      '.search input{flex-grow:1;min-width:0;border:0;background:transparent;color:' + window.hkCards.v('ink') + ';font:inherit;',
      '  font-size:17px;outline:none}',
      '.search input::placeholder{color:' + window.hkCards.v('ink-3') + '}',
      '.sub{align-self:stretch;display:flex;flex-direction:column;gap:16px}',
      '.bk{display:flex;align-items:center;gap:10px}',
      '.bk button{width:40px;height:40px;border-radius:20px;border:0;padding:0;display:flex;',
      '  align-items:center;justify-content:center;background:rgba(255,255,255,0.13);color:#fff;cursor:pointer}',
      '.bk .t{font-size:20px;font-weight:700;letter-spacing:-.3px}',
      '@media (max-width:' + C.BP.phone + 'px){.list{max-height:340px}}'
    ].join('');
    function pretty(v) {
      var t = String(v == null ? '' : v).replace(/_/g, ' ');
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    // pickList(host, options, onPick, label): paints the list (and, past 12
    // options, its search) into host; returns repaint(cur) for state changes.
    // `label` names the search field for a screen reader.
    function pickList(host, options, onPick, label) {
      var q = '', sig = null, box = document.createElement('div');
      box.className = 'list';
      if (options.length > 12) {
        var se = document.createElement('label');
        se.className = 'search';
        se.innerHTML = SEARCH + '<input type="search" placeholder="Search" aria-label="Search ' + esc(label || '') + '" autocomplete="off">';
        host.appendChild(se);
        se.querySelector('input').addEventListener('input', function (ev) { q = ev.target.value.toLowerCase(); paint(last, true); });
      }
      var lf = document.createElement('div');
      lf.className = 'hk-edge lf';
      lf.appendChild(box); host.appendChild(lf);
      C.edges(lf);
      var last = null;
      function paint(cur, force) {
        last = cur;
        var s2 = cur + '|' + q;
        if (!force && s2 === sig) return;
        sig = s2;
        var rows = options.filter(function (o) { return !q || pretty(o).toLowerCase().indexOf(q) !== -1; });
        box.innerHTML = rows.map(function (o) {
          return '<button data-o="' + esc(o) + '"' + (o === cur ? ' aria-current="true"' : '') + '><span>' + esc(pretty(o)) + '</span>' +
                 (o === cur ? TICK : '') + '</button>';
        }).join('') || '<div class="muted" style="padding:18px">Nothing matches</div>';
        box.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () { onPick(b.getAttribute('data-o')); });
        });
      }
      return paint;
    }

    // what the shell and the later sheet files use of this one
    K.GENERIC_SKIP = GENERIC_SKIP; K.genericControl = genericControl; K.GenericPanel = GenericPanel;
    K.genericRows = genericRows; K.LIST_CSS = LIST_CSS; K.pickList = pickList; K.pretty = pretty;
  };
})();
