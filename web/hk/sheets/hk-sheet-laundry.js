// hk-sheet-laundry.js - The laundry sheet: one machine, or several with a switch between them (phase 22, docs/phase22/LAUNDRY.md).
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-laundry'] = function (K) {
    var C = K.C, esc = K.esc, Panel = K.Panel, PANEL_CSS = K.PANEL_CSS, SP = K.SP;

    var laundryVar = function (n) { return window.hkCards.v(n); };

    var MINT = (C.ACCENTS && C.ACCENTS.mint) || '#63e6e2', RED = (C.ACCENTS && C.ACCENTS.red) || '#ff453a';

    var ICON = {
      pause:
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="4.5" width="4.4" height="15" rx="1.6" fill="currentColor"/><rect x="13.6" y="4.5" width="4.4" height="15" ' +
        'rx="1.6" fill="currentColor"/></svg>',
      play:
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 4.6v14.8c0 1 1.1 1.6 2 1.1l11.6-7.4c.8-.5.8-1.7 0-2.2L9 3.5c-.9-.5-2 .1-2 1.1Z" fill="currentColor"/></svg>',
      stop: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3.2" fill="currentColor"/></svg>',
      check:
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.5 4.6L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" ' +
        'stroke-linejoin="round"/></svg>'
    };

    class LaundryPanel extends Panel {
      static get CSS() {
        var L = window.hkLaundry;
        return PANEL_CSS + (L ? L.CSS : '') + [
          ':host{display:flex;flex-direction:column}',
          ':host > div{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
          '.pn{flex:1 1 auto;min-height:0;gap:' + SP.piece + 'px;align-items:stretch}',
          // THE MACHINE: the drawing, what it is doing (the hero), how long, the progress and Clear -- centered
          '.lft{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:' + SP.block + 'px;text-align:center;min-width:0}',
          '.art{width:220px}',
          '.big{margin-top:4px}',
          '.muted{margin-top:-6px}',
          '.fin{font-size:15px;color:' + laundryVar('ink-3') + ';font-variant-numeric:tabular-nums;min-height:20px}',
          '.prog{width:240px;height:8px;border-radius:4px;background:' + laundryVar('line-strong') + ';overflow:hidden}',
          '.prog i{display:block;height:100%;border-radius:inherit;background:' + MINT + '}',
          '.big.mint{color:' + MINT + '}.big.red,.muted.red{color:' + RED + '}',
          // THE RIGHT COLUMN: a switch between machines, the steps, the readings, the keys at the foot
          '.rgt{display:flex;flex-direction:column;gap:' + SP.block + 'px;min-width:0;min-height:0}',
          '.seg{display:flex;gap:4px;padding:3px;height:44px;box-sizing:border-box;border-radius:calc(44px / 2);background:' + laundryVar('key') + '}',
          '.seg button{all:unset;box-sizing:border-box;flex:1 1 0;min-width:0;height:38px;border-radius:calc(38px / 2);text-align:center;font-size:15px;font-weight:600;',
          '  color:' + laundryVar('ink-2') + ';cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 10px}',
          '.seg button.on{background:' + laundryVar('key-strong') + ';color:' + laundryVar('ink') + '}',
          '.seg button:focus-visible{outline:2px solid ' + laundryVar('ink-2') + ';outline-offset:2px}',
          '.crd{padding:' + SP.cardPad + ';border-radius:' + SP.cardR + 'px;background:rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:10px}',
          ':host([hk-flat]) .crd{background:' + laundryVar('key') + '}',
          '.lab{margin:0}',
          '.trk{display:flex;gap:6px}',
          '.trk .st{flex:1 1 0;display:flex;flex-direction:column;gap:8px;min-width:0}',
          '.trk .bar{height:6px;border-radius:3px;background:' + laundryVar('line-strong') + ';overflow:hidden}',
          '.trk .bar i{display:block;height:100%;background:' + MINT + ';border-radius:inherit}',
          '.trk .lb{font-size:13px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:' + laundryVar('ink-3') + '}',
          '.trk .st.now .lb{color:' + laundryVar('ink') + '}.trk .st.done .lb{color:' + laundryVar('ink-2') + '}',
          '.rows{display:flex;flex-direction:column}',
          '.rows .r{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid ' + laundryVar('line') + ';font-size:15px;color:' + laundryVar('ink-2') + '}',
          '.rows .r:first-child{border-top:0;padding-top:2px}.rows .r:last-child{padding-bottom:0}',
          '.rows .r b{font-weight:600;color:' + laundryVar('ink') + ';text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
          '.rows .r b.red{color:' + RED + '}',
          '.keys{margin-top:auto;display:flex;flex-direction:column;gap:8px}',
          '.keys .row{display:flex;gap:' + SP.block + 'px}.keys .btn{flex:1 1 0}',
          '.keys .btn.stop{color:' + RED + '}',
          '.why{font-size:13px;color:' + laundryVar('ink-3') + ';text-align:center}',
          '.none{font-size:15px;color:' + laundryVar('ink-2') + ';text-align:center;margin:auto}',
          // TWO COLUMNS ON A TABLET: the machine left (340), the rest right, their tops and feet the body's
          ':host([wide]) .pn{flex-direction:row;gap:' + SP.region + 'px;padding:0}',
          ':host([wide]) .lft{flex:0 0 340px}',
          ':host([wide]) .rgt{flex:1 1 auto}',
          // ONE COLUMN ON A PHONE: the drawing smaller, everything in one scroll
          ':host(:not([wide])) .pn{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}',
          ':host(:not([wide])) .pn::-webkit-scrollbar{display:none}',
          ':host(:not([wide])) .art{width:170px}',
          ':host(:not([wide])) .keys{margin-top:0}',
          ':host(:not([wide])) .prog{width:200px}'
        ].join('');
      }
      hkWidthKind() { return 'laundry'; }
      hkFill() { return true; }
      hkNoGear() { return true; }
      _wideAt() { return 700; }
      _onWide() { this._built = false; this._render(); }
      _list() { var L = window.hkLaundry; return L ? L.machines(this.client) : []; }
      _machine() {
        var list = this._list(), want = this._mid || (this._config || {}).machine;
        return list.filter(function (m) { return m.id === want; })[0] || list[0] || null;
      }
      _sigOf() {
        var L = window.hkLaundry, m = this._machine(), s = (this.client && this.client.states) || {};
        if (!L || !m) return 'none';
        var out = m.id + '|' + this.hasAttribute('wide') + '|' + this._list().length + '|' + Math.floor(Date.now() / 30000) + '|';
        L.ids(this.client, m).forEach(function (id) { var st = s[id]; out += id + '=' + (st ? st.state + '@' + (st.last_changed || '') : 'x') + ';'; });
        return out;
      }
      connectedCallback() {
        super.connectedCallback();
        var self = this;
        clearInterval(this._tick);
        // (the time left and "Finished 12 min ago" move on with the minutes)
        this._tick = setInterval(function () { if (self.redraw) self.redraw(); }, 30000);
      }
      disconnectedCallback() {
        super.disconnectedCallback();
        clearInterval(this._tick); this._tick = null;
      }
      _render() {
        var self = this, L = window.hkLaundry, m = this._machine();
        if (!L || !m) {
          var where = window.hkShell && window.hkShell.settingsPlace ? window.hkShell.settingsPlace('Accessories \u2192 Laundry') : 'Accessories \u2192 Laundry';
          this._root.innerHTML = '<div class="pn"><div class="none">No washer or dryer is set up. Add one in ' + esc(where) + '.</div></div>'; this._built = false; return;
        }
        var list = this._list(), o = L.look(this.client, m), ctl = L.controls(this.client, m), wide = this.hasAttribute('wide');
        if (!this._built || this._builtFor !== m.id) {
          this._built = true; this._builtFor = m.id;
          var seg = list.length > 1 ? '<div class="seg" role="tablist" aria-label="Machines">' + list.slice(0, 4).map(function (x) {
            return '<button type="button" role="tab" data-m="' + esc(x.id) + '" aria-selected="' + (x.id === m.id) + '" class="' + (x.id === m.id ? 'on' : '') + '">' + esc(x.name) + '</button>';
          }).join('') + '</div>' : '';
          this._root.innerHTML = '<div class="pn">' +
            '<div class="lft"><div class="art"></div><div class="big"></div><div class="muted"></div><div class="fin"></div>' +
            '<div class="prog" hidden><i></i></div><button type="button" class="btn clr" hidden>' + ICON.check + 'Clear</button></div>' +
            '<div class="rgt">' + seg + '<div class="crd steps" hidden><div class="lab">Cycle</div><div class="trk"></div></div>' +
            '<div class="crd"><div class="lab">' + (wide ? 'Readings' : 'Readings') + '</div><div class="rows"></div></div>' +
            '<div class="keys"><div class="row"></div><div class="why" hidden></div></div></div></div>';
          this._root.querySelectorAll('.seg button').forEach(function (b) {
            b.addEventListener('click', function () { self._mid = b.getAttribute('data-m'); self._built = false; self._render(); });
          });
          this._root.querySelector('.clr').addEventListener('click', function () {
            var cur = self._machine();
            if (cur) self._call('script', L.CLEAR, { machine: cur.id });
          });
          this._art = ''; this._keys = '';
        }
        var q = function (s) { return self._root.querySelector(s); };
        var draw = L.art(o.state, o.kind, { display: L.display(o), label: o.name + ', ' + o.title });
        var drawKey = o.state + o.kind + L.display(o);
        if (this._art !== drawKey) { this._art = drawKey; q('.art').innerHTML = draw; }
        var big = q('.big');
        big.textContent = o.title;
        big.className = 'big' + (o.state === 'leak' || o.state === 'error' ? ' red' : (o.state === 'done' || o.state === 'wrinkle') ? ' mint' : '');
        var mu = q('.muted');
        mu.textContent = o.sub || (o.state === 'off' ? 'Not running' : '');
        mu.className = 'muted' + (o.state === 'leak' ? ' red' : '');
        q('.fin').textContent = o.endsWords || (o.held && o.state !== 'done' ? '' : '');
        var pg = q('.prog');
        pg.hidden = o.pct == null;
        if (o.pct != null) pg.querySelector('i').style.width = Math.round(o.pct) + '%';
        q('.clr').hidden = !(o.held && (o.machine === 'done' || o.machine === 'wrinkle'));
        // THE STEPS
        var sc = q('.steps');
        sc.hidden = !o.steps;
        if (o.steps) {
          q('.trk').innerHTML = o.steps.map(function (s) {
            var f = s.done ? 100 : s.now ? 50 : 0;
            return '<div class="st' + (s.done ? ' done' : s.now ? ' now' : '') + '"><div class="bar"><i style="width:' + f + '%' + (s.color ? ';background:' + s.color : '') +
              '"></i></div><div class="lb">' + esc(s.name) + '</div></div>';
          }).join('');
        }
        // THE READINGS: only what this machine has
        var rows = [];
        if (o.left != null) rows.push(['Time Left', L.dur(o.left)]);
        if (o.pct != null) rows.push(['Progress', Math.round(o.pct) + '%']);
        if (o.door) rows.push(['Door', o.door]);
        if (o.remote !== null) rows.push(['Remote Control', o.remote ? 'On' : 'Off']);
        if (o.watts !== null && o.watts !== undefined) rows.push(['Power', Math.round(o.watts) + ' W']);
        if (m.leak) rows.push(['Leak Sensor', o.leak ? 'Wet' : 'Dry', o.leak]);
        rows.push(['Kind', (L.KIND_NAMES[o.kind] || 'Washer')]);
        q('.rows').innerHTML = rows.map(function (r) { return '<div class="r">' + esc(r[0]) + '<b' + (r[2] ? ' class="red"' : '') + '>' + esc(r[1]) + '</b></div>'; }).join('');
        // THE KEYS: what the machine itself offers; dimmed, with why, where it won't take them now
        var keys = [], runsNow = o.runs && o.machine !== 'delayed', dis = ctl.why ? ' disabled' : '';
        if (runsNow && o.machine === 'paused' && ctl.resume) keys.push(['resume', ICON.play + 'Resume', '']);
        else if (runsNow && ctl.pause) keys.push(['pause', ICON.pause + 'Pause', '']);
        if (runsNow && ctl.stop) keys.push(['stop', ICON.stop + 'Stop', ' stop']);
        var kh = keys.map(function (k) { return '<button type="button" class="btn' + k[2] + '" data-k="' + k[0] + '"' + dis + '>' + k[1] + '</button>'; }).join('') + '|' + (ctl.why || '');
        if (this._keys !== kh) {
          this._keys = kh;
          var row = q('.keys .row');
          row.innerHTML = kh.split('|')[0];
          row.querySelectorAll('button').forEach(function (b) {
            b.addEventListener('click', function () {
              var c = L.controls(self.client, self._machine() || m)[b.getAttribute('data-k')];
              if (c) self._call(c[0], c[1], c[2]);
            });
          });
          var why = q('.why');
          why.hidden = !(keys.length && ctl.why);
          why.textContent = ctl.why || '';
        }
      }
    }

    if (!customElements.get('hk-detail-laundry')) customElements.define('hk-detail-laundry', /** @type {any} */ (LaundryPanel));
  };
})();
