// hk-grid-security.js - the small key, the security card and its keypad, the vacuum.
//
// PART OF THE HOME GRID'S CARDS (hk-grid-cards.js). Not a card and not run on its own: it registers one
// function, which hk-grid-cards.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkGridCardsParts = window.hkGridCardsParts || {})['hk-grid-security'] = function (K) {
    var attr = K.attr, C = K.C, dom = K.dom, DOORS = K.DOORS, friendly = K.friendly, HkBase = K.HkBase, kind = K.kind,
        OFF = K.OFF, own = K.own, setting = K.setting, sizeOf = K.sizeOf, TILE = K.TILE, type = K.type, v = K.v;

    // ===================================================== the small tiles
    // THE S TILE: Lock Up, All Lights Off, Garage, a scene or script, and
    // Everything. A key with a state: the glyph in its well at the top, the
    // name and the state it changes at the bottom -- the tall tile's measured
    // pieces (42 px well, 15 / 600 on 16.5 px lines, the pill's padding).
    // AN APP ICON'S CORNER: iPadOS's 22.4 % of its side (hk-tabbar.js ICON_CORNER, the Pages screen's)
    var APP_CORNER = '22.4%';
    var KEY_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.k{box-sizing:border-box;height:100%;display:flex;flex-direction:column;justify-content:space-between;',
      // (a tile's padding -- and a Square screen's corner inset, as hk-tile.js has it: the shield's well was cut by
      // the 72 px corner, 2026-10-30)
      '  padding:calc(12.8px + var(--hk-in-t,0px)) calc(12.8px + var(--hk-in-r,0px)) calc(12.8px + var(--hk-in-b,0px)) calc(' + TILE.padL + 'px + var(--hk-in-l,0px));cursor:pointer;overflow:hidden;' + C.plate('tile') + ';',
      '  -webkit-tap-highlight-color:transparent;--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
      '  transition:transform ' + C.DUR.press + ' ease,filter ' + C.DUR.press + ' ease}',
      'hk-plate.k:active{transform:scale(0.97);filter:brightness(0.93)}',
      'hk-plate.k:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      '.well{width:42px;height:42px;border-radius:50%;background:' + v('key') + ';display:flex;',
      '  align-items:center;justify-content:center;flex:none}',
      '.icon{width:' + TILE.glyph + 'px;height:' + TILE.glyph + 'px;--mdc-icon-size:100%;display:flex;',
      '  color:' + v('glyph') + ';transition:color ' + C.DUR.fade + ' ease}',
      '.tx{display:flex;flex-direction:column;gap:' + TILE.rowGap + 'px;min-width:0}',
      '.name,.state{font-size:15px;line-height:' + TILE.lineH + 'px;letter-spacing:-0.23px;white-space:nowrap;',
      '  overflow:hidden;text-overflow:ellipsis}',
      '.name{font-weight:600;color:' + v('ink') + '}',
      '.state{font-weight:500;color:' + v('ink-2') + '}',
      '.state[data-kind="failed"]{color:' + v('fail') + '}',
      '@media (prefers-reduced-motion:reduce){hk-plate.k,hk-plate.k:active{transition:none;transform:none}}',
      // a block's corners on square cells (hk-home-grid-view's --hk-block-radius)
      'hk-plate.k{border-radius:var(--hk-block-radius, ' + C.M.radius + ')}',
      // CENTRED (2026-10-30, the Tile Style; hk-base.js TILE.centred): the
      // glyph over the name and what it changes, all centred, as HomeView has it
      ':host([tile=centred]) hk-plate.k{display:block}',
      C.centredTile({ host: ':host([tile=centred])', plate: 'hk-plate.k', lit: 'hk-plate.k.lit', well: '.well', icon: '.icon',
                      name: '.tx .name', sub: ['.tx .state'] }),
      // IN ITS OWN COLOR (2026-10-31, the widget mock-up; _look's `paint`): the
      // plate a gradient of the key's color -- the app icons' (hkCards.
      // iconGradient) -- its glyph and words white. Off a HomeView dashboard it
      // is Shortcuts' button: the glyph bare at the top, the name and its state
      // larger at the foot, on the block's inset
      'hk-plate.k[data-paint]{background:linear-gradient(180deg,var(--k-a),var(--k-b)) !important;--hk-glass-backdrop:none;-webkit-backdrop-filter:none;backdrop-filter:none}',
      'hk-plate.k[data-paint] .name{color:#fff !important}hk-plate.k[data-paint] .state{color:rgba(255,255,255,0.85) !important}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint]{padding:' + C.blockPad('14px') + '}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint] .well{width:34px;height:34px;background:none;border-radius:0}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint] .icon{width:34px;height:34px}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint] .name{' + type('headline') + ';line-height:21px}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint] .state{' + type('caption') + ';line-height:17px}',
      // A FOLDER OF APP ICONS in the glyph's place (Everything, Small): four
      // of the screen's pages and rooms in their colors, on a frosted square
      '.well.folder{background:none !important;border-radius:0}',
      '.fold{box-sizing:border-box;width:100%;height:100%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:8%;padding:11%;',
      '  border-radius:' + APP_CORNER + ';background:rgba(255,255,255,0.22);box-shadow:0 4px 10px rgba(0,0,0,0.18)}',
      '.fold i{display:flex;align-items:center;justify-content:center;border-radius:' + APP_CORNER + ';min-width:0;min-height:0}',
      '.fold hk-icon{width:58%;height:58%;--mdc-icon-size:100%;display:flex;color:#fff}',
      ':host(:not([tile=centred])) .well.folder{width:46px;height:46px}'
    ].join('');

    class HkGridKey extends HkBase {
      static get CSS() { return KEY_CSS; }
      getCardSize() { return 2; }
      // {name, icon, state, color}
      _look() { return { name: '', icon: 'mdi:circle-outline', state: '', color: null }; }
      _tap() {}
      _render() {
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="k" data-hk-role="card" role="button" tabindex="0">' +
            '<div class="well"><hk-icon class="icon"></hk-icon></div>' +
            '<div class="tx"><div class="name"></div><div class="state"></div></div></hk-plate>';
          var q = this._root.querySelector.bind(this._root), self = this;
          this._e = { card: q('.k'), icon: q('.icon'), name: q('.name'), state: q('.state') };
          this._e.card.addEventListener('click', function (ev) { ev.stopPropagation(); self._tap(); });
          this._e.card.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); self._tap(); }
          });
          this._built = true;
        }
        var e = this._e, k = this._look();
        if (e.icon.icon !== k.icon) e.icon.icon = k.icon;
        // its own color's gradient, or the glass
        var g = k.paint ? C.iconGradient(k.paint) : null;
        if (g) { e.card.setAttribute('data-paint', ''); e.card.style.setProperty('--k-a', g[0]); e.card.style.setProperty('--k-b', g[1]); }
        else if (e.card.hasAttribute('data-paint')) { e.card.removeAttribute('data-paint'); e.card.style.removeProperty('--k-a'); e.card.style.removeProperty('--k-b'); }
        // a folder of app icons in the glyph's place: [[color, glyph], ...]
        var fk = k.folder ? JSON.stringify(k.folder) : '';
        if (fk !== (this._foldKey || '')) {
          this._foldKey = fk;
          var well = e.icon.parentNode, old = well.querySelector('.fold');
          if (old) old.remove();
          well.classList.toggle('folder', !!k.folder);
          e.icon.style.display = k.folder ? 'none' : '';
          if (k.folder) {
            var f = document.createElement('span');
            f.className = 'fold';
            f.setAttribute('aria-hidden', 'true');
            k.folder.forEach(function (x) {
              var gi = C.iconGradient(x[0]), i = document.createElement('i'), ic = document.createElement('hk-icon');
              i.style.background = 'linear-gradient(180deg,' + gi[0] + ',' + gi[1] + ')';
              ic.icon = x[1];
              i.appendChild(ic); f.appendChild(i);
            });
            well.appendChild(f);
          }
        }
        // (Centred: the glyph by what is drawn, as the tiles' -- TILE.centred.ink)
        if (this.getAttribute('tile') === 'centred') e.icon.setAttribute('ink', String(C.TILE.centred.ink)); else e.icon.removeAttribute('ink');
        e.icon.style.color = g ? '#fff' : k.color || '';
        if (e.name.textContent !== k.name) e.name.textContent = k.name;
        var said = this._said || null;
        var text = said ? said.text : k.state;
        if (e.state.textContent !== text) e.state.textContent = text;
        if (said) e.state.setAttribute('data-kind', said.kind); else e.state.removeAttribute('data-kind');
        e.card.setAttribute('aria-label', k.name + (text ? ', ' + text : ''));
      }
      // a word in the state's place for a moment (a command that didn't go)
      _say(kind, text, ms) {
        var self = this;
        this._said = { kind: kind, text: text };
        if (this._sayT) clearTimeout(this._sayT);
        this._sayT = setTimeout(function () { self._sayT = null; self._said = null; self.redraw(); }, ms || 3000);
        this.redraw();
      }
      disconnectedCallback() {
        if (this._sayT) { clearTimeout(this._sayT); this._sayT = null; this._said = null; }
        super.disconnectedCallback();
      }
    }

    // ===================================================== hk-grid-security-card
    // SECURITY AS A WIDGET (2026-10-31, the widget mock-up): the one fact, big
    // -- the alarm's state in its color. Small: its shield, the state large
    // and the mode and the locks under it. Wide: that beside the locks, the
    // garage and the doors and windows, the open ones first and in orange.
    // Large: the shield and "Armed · Home" over that list, Home, Away and
    // Disarm at the foot. Extra Large (hk-grid-keypad-card): the alarm's
    // keypad beside the list. Every arming goes through the alarm's own sheet
    // or keypad: no command here can bypass its PIN. The list takes the room
    // it has, a row of 44 px each, and says "N more" for what does not fit.
    var SEC_ROW = 44;
    var SEC_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.sec{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:10px;padding:' + C.blockPad('14px') + ';overflow:hidden;' + C.plate('card') + ';color:' + v('ink') + ';',
      '  -webkit-tap-highlight-color:transparent;--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
      'hk-plate.sec[size=W],hk-plate.sec.kp{flex-direction:row;gap:18px}',
      '[role=button]{cursor:pointer}',
      '[role=button]:focus-visible,button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      // the shield bare, in the state's color (gray disarmed), as the Small blocks beside it draw their glyphs
      // (the owner, 2026-10-31: "Yes, bare glyph" -- no circle, as HomeView's tiles): 34 px, the heading's 30
      '.wl{width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex:none}',
      '.wl hk-icon{width:100%;height:100%;--mdc-icon-size:100%;display:flex;color:var(--c,' + v('ink-2') + ')}',
      '.hd .wl{width:30px;height:30px}',
      '.one{display:flex;flex-direction:column;min-width:0;margin-top:auto}',
      // (the state a title's size, 22: at a figure's 30 "Disarmed" filled a Small block -- the owner, 2026-10-31: "really large")
      '.big{' + type('title') + ';font-weight:600;line-height:1.1;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--t,' + v('ink') + ')}',
      '.sub{' + type('body') + ';font-weight:400;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // SMALL: the name and its line as the Small blocks beside it have them (the Action's: a headline over a
      // caption, on the block's inset) -- the owner, 2026-10-31: "different than All Lights Off and Lock Up"
      'hk-plate.sec[size=S] .big{' + type('headline') + ';line-height:21px;margin-top:0}',
      'hk-plate.sec[size=S] .sub{' + type('caption') + ';line-height:17px}',
      '.side{display:flex;flex-direction:column;flex:0 0 150px;min-width:0}',
      '.hd{display:flex;align-items:center;gap:12px;min-width:0;flex:none;min-height:44px}',
      '.hd .tx{display:flex;flex-direction:column;min-width:0}',
      '.hd b{' + type('title') + ';font-weight:600;line-height:27px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.hd small{' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.col{display:flex;flex-direction:column;gap:10px;flex:1;min-width:0;min-height:0}',
      '.rows{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}',
      '.row{display:flex;align-items:center;gap:10px;height:' + SEC_ROW + 'px;flex:none;box-sizing:border-box;border-bottom:1px solid ' + v('line') + ';min-width:0}',
      '.row:last-child,.row.end{border-bottom:0}',
      '.row hk-icon{width:20px;height:20px;--mdc-icon-size:100%;display:flex;flex:none;color:' + v('ink-2') + '}',
      '.row span{' + type('body') + ';flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.row em{font-style:normal;' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap;flex:none}',
      '.row.open hk-icon,.row.open em{color:' + v('warn') + '}',
      '.row.lk hk-icon{color:var(--lk)}',
      '.row.mo span{color:' + v('ink-2') + '}',
      // Home, Away and Disarm along the foot, where a thumb is: the mode it is in lit
      '.arm{display:flex;gap:8px;flex:none}',
      '.arm button{all:unset;box-sizing:border-box;flex:1;height:44px;border-radius:22px;text-align:center;background:' + v('key') + ';' + type('body') + ';font-weight:600;color:' + v('ink') + ';cursor:pointer}',
      '.arm button.on{background:#fff;color:#1c1c1e}',
      '.arm button:active{background:' + v('key-strong') + '}',
      // (Extra Large: the alarm's keypad, its keys sized to the block)
      '.kpad{flex:0 0 264px;min-width:0;min-height:0}.kpad.side{flex-basis:330px}.kpad > *{display:block;height:100%}'
    ].join('');
    var SEC_WORDS = { disarmed: ['Disarmed', ''], armed_home: ['Armed', 'Home'], armed_away: ['Armed', 'Away'], armed_night: ['Armed', 'Night'],
                      armed_vacation: ['Armed', 'Vacation'], armed_custom_bypass: ['Armed', 'Custom'], arming: ['Arming…', ''], pending: ['Pending…', ''],
                      disarming: ['Disarming…', ''], triggered: ['Triggered', ''] };
    // the alarm's state as the block says it: the word, its mode, the shield and its color
    function alarmLook(st) {
      var s = st && st.state, w = SEC_WORDS[s], A = C.ACCENTS;
      if (!w) return { word: s === 'unavailable' || s === 'unknown' || !st ? 'Unavailable' : String(s), mode: '', icon: 'mdi:shield-off', color: null };
      var armed = /^armed_/.test(s);
      return { word: w[0], mode: w[1], icon: s === 'disarmed' ? 'mdi:shield-off' : s === 'triggered' ? 'mdi:shield-alert' : s === 'armed_home' ? 'mdi:shield-home' : 'mdi:shield-lock',
               color: s === 'triggered' ? A.red : armed ? A.teal : /ing$|pending/.test(s) ? A.orange : null, text: s === 'triggered' ? A.red : null };
    }
    // ITS LIST: the locks, the garage, the doors and windows (the house's
    // lists, else what it has), each {id, name, icon, value, open, lock}; the
    // open ones first
    function secRows(client) {
      var st = (client && client.states) || {}, out = [];
      var locks = (kind('locks') || own(client, 'lock')).filter(function (id) { return dom(id) === 'lock' && st[id]; });
      locks.forEach(function (id) {
        var s = st[id].state, open = s === 'unlocked' || s === 'open';
        out.push({ id: id, name: friendly(client, id), icon: open ? 'mdi:lock-open-variant' : 'mdi:lock', value: open ? 'Unlocked' : OFF[s] ? 'Unknown' : 'Locked', open: open, lock: !open });
      });
      var garage = (kind('garage') || own(client, 'cover').filter(function (id) { return DOORS[attr(st[id], 'device_class')]; })).filter(function (id) { return st[id]; });
      garage.forEach(function (id) {
        var s = st[id].state, shut = s === 'closed' || s === 'off';
        out.push({ id: id, name: friendly(client, id), icon: shut ? 'mdi:garage' : 'mdi:garage-open', value: shut ? 'Closed' : OFF[s] ? 'Unknown' : 'Open', open: !shut && !OFF[s] });
      });
      ['doors', 'windows'].forEach(function (k) {
        var dc = k === 'doors' ? 'door' : 'window';
        (kind(k) || Object.keys(st).filter(function (id) { return dom(id) === 'binary_sensor' && attr(st[id], 'device_class') === dc; }).sort())
          .filter(function (id) { return st[id]; }).forEach(function (id) {
            var open = st[id].state === 'on';
            out.push({ id: id, name: friendly(client, id), icon: 'mdi:' + dc + (open ? (dc === 'door' ? '-open' : '-open-variant') : (dc === 'door' ? '-closed' : '-closed-variant')),
                       value: open ? 'Open' : 'Closed', open: open });
          });
      });
      return out.filter(function (r) { return r.open; }).concat(out.filter(function (r) { return !r.open; }));
    }
    // ...and what it says in a few words: "1 window open", else the locks
    function secSays(rows) {
      var open = rows.filter(function (r) { return r.open; });
      if (open.length) return open.length === 1 ? open[0].name + ' ' + open[0].value.toLowerCase() : open.length + ' open';
      return rows.some(function (r) { return r.lock; }) ? 'All locked' : rows.length ? 'All closed' : '';
    }

    class HkGridSecurityCard extends HkBase {
      static get CSS() { return SEC_CSS; }
      getCardSize() { return 2; }
      _alarm() {
        return this._config.entity || setting('security.alarm', null) ||
          Object.keys((this.client && this.client.states) || {}).filter(function (id) { return dom(id) === 'alarm_control_panel'; })[0] || null;
      }
      _size() { return sizeOf(this) || 'S'; }
      _keys() { return false; }
      _sigOf() {
        var id = this._alarm(), st = id && this.client && this.client.states[id];
        return JSON.stringify([id, st && st.state, secRows(this.client), this._size(), this._blockKey || '']);
      }
      _tap() { var id = this._alarm(); if (id) window.hkShell.moreInfo(id, this); }
      // (the plate's tap, hk-base.js openTarget: Small the whole block, Wide its state and Large its heading already
      // were the alarm's sheet; now anywhere between its rows, too -- not the keypad's keys and gaps, a PIN's)
      _tapTarget() { var id = this._alarm(); return id ? [{ sheet: id }] : []; }
      // (the keypad, Extra Large: each new client)
      _receiveClient() {
        super._receiveClient();
        var c = this.client;
        (this._kids || []).forEach(function (k) { window.hkHostClient.bridge(k, c); });
      }
      _button(el, fn) {
        el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
        el.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
        el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(); } });
      }
      connectedCallback() {
        super.connectedCallback();
        var self = this;
        if (!this._fitRO && typeof ResizeObserver === 'function') {
          this._fitRO = new ResizeObserver(function () { self._fit(); });
          this._fitRO.observe(this);
        }
      }
      disconnectedCallback() {
        if (this._fitRO) { this._fitRO.disconnect(); this._fitRO = null; }
        super.disconnectedCallback();
      }
      _render() {
        this._watchBlock();
        var self = this, size = this._size(), keys = this._keys() && size === 'XL', alarm = this._alarm();
        // (a tile cell's shorter Extra Large: the keys side by side with the readout and the ways to arm, so
        // each key keeps 44 px -- stacked under the readout they came to 36)
        var bk = this._block(), side = keys && !!bk && bk.h < 340;
        var shape = size + (keys ? 'k' : '') + (side ? 's' : '') + '|' + alarm;
        if (!this._built || this._shape !== shape) {
          this._shape = shape;
          var head = '<div class="hd"><div class="wl"><hk-icon></hk-icon></div><div class="tx"><b></b><small></small></div></div>';
          var html = size === 'S' ? '<div class="wl"><hk-icon></hk-icon></div><div class="one"><div class="big"></div><div class="sub"></div></div>'
            : size === 'W' ? '<div class="side"><div class="wl"><hk-icon></hk-icon></div><div class="one"><div class="big"></div><div class="sub"></div></div></div><div class="rows"></div>'
            : keys ? '<div class="kpad" data-notap></div><div class="col">' + head + '<div class="rows"></div></div>'
            : head + '<div class="rows"></div><div class="arm"><button type="button" data-m="home">Home</button><button type="button" data-m="away">Away</button><button type="button" data-m="off">Disarm</button></div>';
          this._root.innerHTML = '<hk-plate class="sec' + (keys ? ' kp' : '') + '" data-hk-role="card" size="' + size + '">' + html + '</hk-plate>';
          var q = this._root.querySelector.bind(this._root), all = this._root.querySelectorAll.bind(this._root);
          this._e = { card: q('.sec'), wl: q('.wl'), icon: q('.wl hk-icon'), big: q('.big') || q('.hd b'), sub: q('.sub') || q('.hd small'), rows: q('.rows') };
          // the tap: Small the whole block, Wide its state, Large its heading -- the alarm's sheet, with its PIN
          var hit = size === 'S' ? this._e.card : size === 'W' ? q('.side') : q('.hd');
          this._button(hit, function () { if (self._config.tap !== 'none') self._tap(); });
          Array.prototype.forEach.call(all('.arm button'), function (b) {
            b.setAttribute('aria-label', b.textContent + ': the alarm’s controls');
            b.addEventListener('click', function (ev) { ev.stopPropagation(); self._tap(); });
          });
          this._kids = [];
          if (keys) {
            this._pad = C.createCard(Object.assign({ type: 'custom:hk-alarm-keypad-card', glass: false }, side ? { layout: 'side' } : {}, alarm ? { entity: alarm } : {}), this.client);
            q('.kpad').classList.toggle('side', side);
            q('.kpad').appendChild(this._pad);
            this._kids.push(this._pad);
          } else this._pad = null;
          this._rowKey = null;
          this._built = true;
        }
        var e = this._e, st = alarm && this.client && this.client.states[alarm], look = alarmLook(st), rows = secRows(this.client), says = secSays(rows);
        if (e.icon.icon !== look.icon) e.icon.icon = look.icon;
        if (look.color) e.card.style.setProperty('--c', look.color); else e.card.style.removeProperty('--c');
        if (look.text) e.card.style.setProperty('--t', look.text); else e.card.style.removeProperty('--t');
        var big = size === 'S' || size === 'W' ? look.word : look.word + (look.mode ? ' · ' + look.mode : '');
        var sub = size === 'S' ? [look.mode, says && (/^All /.test(says) ? 'all ' + says.slice(4) : says)].filter(Boolean).join(' · ') : size === 'W' ? (look.mode || says) : says;
        if (size === 'S' && !look.mode) sub = says;
        e.big.textContent = big;
        e.sub.textContent = sub;
        var label = 'Security, ' + big + (sub ? ', ' + sub : '');
        (size === 'S' ? e.card : (e.card.querySelector('.side') || e.card.querySelector('.hd'))).setAttribute('aria-label', label);
        Array.prototype.forEach.call(this._root.querySelectorAll('.arm button'), function (b) {
          var m = b.getAttribute('data-m');
          b.classList.toggle('on', m === 'off' ? !!st && st.state === 'disarmed' : !!st && st.state === 'armed_' + m);
        });
        if (e.rows) {
          var key = JSON.stringify(rows);
          if (key !== this._rowKey) {
            this._rowKey = key;
            e.rows.innerHTML = '';
            rows.forEach(function (r) {
              var d = document.createElement('div');
              d.className = 'row' + (r.open ? ' open' : '') + (r.lock ? ' lk' : '');
              d.innerHTML = '<hk-icon></hk-icon><span></span><em></em>';
              d.querySelector('hk-icon').icon = r.icon;
              d.querySelector('span').textContent = r.name;
              d.querySelector('em').textContent = r.value;
              self._button(d, function () { window.hkShell.moreInfo(r.id, self); });
              d.setAttribute('aria-label', r.name + ', ' + r.value);
              e.rows.appendChild(d);
            });
            var more = document.createElement('div');
            more.className = 'row mo';
            more.innerHTML = '<hk-icon></hk-icon><span></span>';
            more.querySelector('hk-icon').icon = 'mdi:dots-horizontal';
            this._button(more, function () { self._tap(); });
            e.rows.appendChild(more);
            this._more = more;
          }
          e.card.style.setProperty('--lk', C.ACCENTS.teal);
        }
        if (this._pad) {
          // the keys and their gaps fill the block's height: the readout, four rows of keys, the ways to arm
          var h = bk ? bk.h - 36 : 369;
          this._pad.style.setProperty('--hk-kp-key', Math.max(36, Math.min(64, side ? Math.floor((h - 30) / 4) : Math.floor((h - 44 - 50) / 5))) + 'px');
        }
        this._fit();
      }
      // THE LIST IN THE ROOM IT HAS: whole rows; what does not fit, "N more"
      _fit() {
        var e = this._e;
        if (!e || !e.rows || !this._more) return;
        var list = Array.prototype.filter.call(e.rows.children, function (c) { return c !== this._more; }, this);
        var h = e.rows.clientHeight;
        if (!h) return;
        var fits = Math.max(0, Math.floor((h + 1) / SEC_ROW)), cut = list.length > fits, show = cut ? Math.max(0, fits - 1) : list.length;
        list.forEach(function (r, i) { r.style.display = i >= show ? 'none' : ''; r.classList.toggle('end', !cut && i === show - 1); });
        this._more.style.display = cut && fits > 0 ? '' : 'none';
        if (cut) {
          var t = (list.length - show) + ' more';
          this._more.querySelector('span').textContent = t;
          this._more.setAttribute('aria-label', t + ': the alarm’s sheet');
        }
      }
    }

    // ===================================================== the full-control blocks
    // (2026-10-24, the owner: "the detail sheets that are useful as blocks"):
    // a Large or Extra Large Vacuum block is its controls with Clean Areas --
    // the Vacuum page's own card in a block-sized plate. (Security's keypad,
    // Extra Large since 2026-10-31, is the Security block's: above.)
    var FULL_CSS = ':host{display:block;height:100%}' +
      'hk-plate.full{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:10px;padding:' + C.blockPad('14px') + ';overflow:hidden;' + C.plate('card') + '}' +
      '.ttl{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:24px;flex:none;padding:0 4px}' +
      '.ttl b{' + type('headline') + ';color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.body{flex:1;min-height:0;position:relative}.body > *{display:block;height:100%}' +
      '.areas{flex:1;min-height:0}';                // (Clean Areas scrolls its rooms in its own plate)
    class HkGridFull extends HkBase {
      static get CSS() { return FULL_CSS; }
      getCardSize() { return 4; }
      _receiveClient() {
        super._receiveClient();
        var c = this.client;
        (this._kids || []).forEach(function (k) { window.hkHostClient.bridge(k, c); });
      }
      _mount(parent, cfg, size) {
        // (the block's When Tapped goes with it: a dial inside the climate panel answers the same)
        if (this._config && this._config.tap) cfg = Object.assign({}, cfg, { tap: this._config.tap });
        var el = C.createCard(cfg, this.client);
        if (size) el.setAttribute('size', size);
        parent.appendChild(el);
        (this._kids = this._kids || []).push(el);
        return el;
      }
    }
    // THE KEYPAD (the catalog's Large and Extra Large Security): Large is the
    // Security block's own (the list, Home, Away and Disarm); Extra Large
    // keeps the alarm's keypad beside the list (the owner, 2026-10-31) -- its
    // own keys, readout and ways to arm (hk-security.js); the PIN is checked
    // as it always is, by the alarm, never here
    class HkGridKeypadCard extends HkGridSecurityCard {
      _keys() { return true; }
    }
    // THE VACUUM: the vacuum card's own block at Large and Extra Large (2026-10-31,
    // the owner: "rooms as tiles to tick, 'Clean 2 rooms'"): its state, the
    // rooms Clean Areas offers when the home has them (as the Vacuums page
    // does: hk-strategy.js), and big Clean and Dock keys -- hk-vacuum-card
    // draws it, by the size it is given (hk-home.js _renderBlock)
    class HkGridVacuumFull extends HkGridFull {
      _sigOf() { return JSON.stringify([this._config.entity || null, sizeOf(this)]); }
      _render() {
        var key = JSON.stringify([this._config.entity, sizeOf(this)]);
        if (this._built && this._key === key) return;
        this._key = key; this._kids = [];
        // (the whole block's height: the card fills it)
        this._root.innerHTML = '<div class="body" style="height:100%"></div>';
        this._mount(this._root.querySelector('.body'), { type: 'custom:hk-vacuum-card', entity: this._config.entity }, sizeOf(this) || 'L');
        this._built = true;
      }
    }

    // what the shell and the later parts use of this one
    K.alarmLook = alarmLook; K.APP_CORNER = APP_CORNER; K.FULL_CSS = FULL_CSS; K.HkGridFull = HkGridFull;
    K.HkGridKey = HkGridKey; K.HkGridKeypadCard = HkGridKeypadCard; K.HkGridSecurityCard = HkGridSecurityCard;
    K.HkGridVacuumFull = HkGridVacuumFull; K.KEY_CSS = KEY_CSS; K.secRows = secRows; K.secSays = secSays;
  };
})();
