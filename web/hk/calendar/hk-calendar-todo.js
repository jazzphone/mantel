// hk-calendar-todo.js - the To-do block card and its CSS.
//
// PART OF THE CALENDAR CARDS (hk-calendar.js). Not a card and not run on its own: it registers one
// function, which hk-calendar.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkCalendarParts = window.hkCalendarParts || {})['hk-calendar-todo'] = function (K) {
    var C = K.C, esc = K.esc, fitRows = K.fitRows, HkBase = K.HkBase;

    // ============================================================ TO-DO
    // THE TO-DO BLOCK (2026-10-31, the owner's mock-up "Blocks as widgets": the Reminders widgets; the catalog's
    // `todo`, its `entity` a to-do list, none the house's first): the list's name in its color, how many are left
    // large, then the items, each with its circle to tick off -- the rows filling the block, "N more" at the foot
    // when they don't all fit. Small is the count and what is next, and a tap opens the whole list over the page,
    // larger than the block, as Now Playing's Speakers do (hk-media.js _turn): to tick off and to add to. Large
    // has the name and the count in a column of their own; Extra Large two lists side by side where the house has
    // two (else the one list runs on into the second column), and Add an Item.
    //
    // THE ITEMS are the Side Pane's (hk-sidepane.js, hkSidePane.todo): hk_frontend/todo/items read again when the
    // list's count changes, an item ticked off struck through until the list says so (todo.update_item), one
    // added with todo.add_item -- the same reads and the same commands, through the page's action port.
    //
    // A LIST'S COLOR: a to-do list has none of its own, so each takes the next of these in the house's order of
    // lists (the first orange, as the Side Pane's To-do), the same on every block and in the panel.
    var LIST_HUES = ['orange', 'blue', 'green', 'purple', 'pink', 'teal'];
    function todoIds(h) {
      return Object.keys((h && h.states) || {}).filter(function (k) { return k.indexOf('todo.') === 0; }).sort();
    }
    function listHue(h, eid) {
      var i = Math.max(0, todoIds(h).indexOf(eid));
      return C.ACCENTS[LIST_HUES[i % LIST_HUES.length]];
    }
    function listName(h, eid) {
      var st = h && h.states && h.states[eid];
      return (st && st.attributes && st.attributes.friendly_name) || String(eid || '').split('.').pop().replace(/_/g, ' ');
    }
    function listLeft(h, eid) {
      var st = h && h.states && h.states[eid], n = st ? Number(st.state) : NaN;
      return isFinite(n) && n >= 0 ? n : null;
    }
    function TD() { return window.hkSidePane && window.hkSidePane.todo; }
    // a list's open items, as the Side Pane hands them (or why there are none to show)
    function itemsOf(t) {
      var got = t && t.got;
      if (!got) return { wait: 'Reading the list…' };
      if (got.refused) return { wait: got.refused === 'commands_disabled' ? 'Can’t read the list while control of the house is off.' : 'Can’t read the list.' };
      return { items: (got.items || []).filter(function (it) { return !it.done; }) };
    }
    // AN ITEM'S ROW: its circle and its name, a tap ticks it off (44 px, a finger's)
    function itemRow(eid, it, t) {
      var done = !!(t && t.off && t.off[it.uid]);
      return '<div class="it' + (done ? ' done' : '') + '" role="button" tabindex="0" data-list="' + esc(eid) + '" data-uid="' + esc(it.uid) +
        '" aria-label="' + esc((done ? 'Checked off ' : 'Check off ') + it.summary) + '"><i></i><span>' + esc(it.summary) + '</span></div>';
    }
    var TODO_CSS = [
      ':host{display:block;color:' + window.hkCards.v('ink') + '}',
      '.blk{' + window.hkCards.plate('card') + ';box-sizing:border-box;height:100%;padding:' + window.hkCards.blockPad(window.hkCards.CARD.pad) + ';',
      '  overflow:hidden;display:flex;flex-direction:column;min-height:240px}',
      ':host([size]) .blk{min-height:0}',
      // 2026-11-08, the owner: titles "all need to match" -- the list's name is the one heading, no color of its own
      window.hkCards.headCss('.tw .ln') + '.tw .ln{height:16px;padding:1.5px 0;margin-bottom:8px;flex:none}.tw .ln+.ls{margin-top:0}',
      '.tw .cn{flex:none;font-weight:300;line-height:1.02;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}',
      '.tw.S .cn{font-size:36px}.tw.T .cn{font-size:36px}.tw.W .cn,.tw.L .cn,.tw.XL .cn{font-size:44px}',
      '.tw .hd{flex:none;display:flex;flex-direction:column;min-width:0;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.tw.S{cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.tw [role=button]:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}',
      '.tw .hd:active,.tw.S:active{opacity:0.7}',
      '.tw .ls{flex:1 1 0;min-height:0;display:flex;flex-direction:column;overflow:hidden;margin-top:6px}',
      '.tw .it{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:44px;flex:none;min-width:0;font-size:17px;line-height:21px;',
      '  cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.tw .it+.it{border-top:1px solid ' + window.hkCards.v('line') + '}',
      '.tw .it i{flex:none;width:20px;height:20px;border-radius:50%;box-shadow:inset 0 0 0 2px ' + window.hkCards.v('ink-2') + '}',
      '.tw .it span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tw .it.done span{text-decoration:line-through;color:' + window.hkCards.v('ink-2') + '}',
      '.tw .it.done i{background:var(--hue);box-shadow:none}',
      '.tw .ft{flex:none;margin-top:auto;padding-top:6px;font-size:15px;line-height:18px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tw .nil{flex:none;font-size:15px;line-height:19px;padding:10px 0;color:' + window.hkCards.v('ink-2') + '}',
      '.tw.W,.tw.L,.tw.XL{flex-direction:row;gap:22px}.tw.W .it{flex:1 0 44px;max-height:64px}',
      '.tw .c1{flex:0 0 96px;min-width:0;display:flex;flex-direction:column}.tw.XL .c1{flex-basis:120px}',
      '.tw .c2,.tw .c3{flex:1 1 0;min-width:0;display:flex;flex-direction:column}',
      '.tw .c2>.ls:first-child,.tw .c3>.ls:first-child{margin-top:0}',
      // Extra Large's Add an Item: the panel, its field ready
      '.tw .addb{flex:none;margin-top:8px;height:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;',
      '  background:' + window.hkCards.v('key') + ';cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent}',
      '.tw .addb:active{opacity:0.7}',
      // (the cell is the block's own: a square one is 180 px and up for Small, two rows' 360 for the rest)
      '@container hk-cell (min-height:180px) or style(--hk-cell-shape: square){.tw.S .cn,.tw.W .cn{font-size:54px}}',
      '@container hk-cell (min-height:360px){.tw.T .cn{font-size:44px}.tw.L .cn,.tw.XL .cn{font-size:54px}}'
    ].join('\n');
    // THE WHOLE LIST, over the page (hk-media.js _turn's way): on <body> under a shadow root of its own -- the
    // block's cell clips -- larger than the block and centred on it, the page dimmed a little behind it. The
    // lists as tabs, the items to tick off, a field to add one. It closes on a tap outside, its X, Escape, and
    // with the block.
    function panelCss() {
      var HC = window.hkCards;
      return [
        '.scrim{position:fixed;inset:0;background:rgba(0,0,0,0);transition:background .3s}.scrim.on{background:rgba(0,0,0,.34)}',
        '.nb{position:fixed;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:18px;color:#fff;overflow:hidden;',
        '  border-radius:' + HC.M.radius + ';background:rgb(24,25,29);box-shadow:0 26px 70px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12)}',
        '.hd{flex:none;display:flex;align-items:center;gap:10px}',
        '.tabs{flex:1 1 auto;min-width:0;height:44px;padding:3px;border-radius:22px;display:flex;gap:2px;box-sizing:border-box;background:rgba(255,255,255,.12);' +
          'border:1px solid rgba(255,255,255,.16)}',
        '.tabs div{flex:1 1 auto;min-width:0;height:36px;padding:0 12px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;cursor:pointer;' +
          'box-sizing:border-box}',
        '.tabs div span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.tabs div.on{background:#fff;color:#1c1c1e}',
        '.x{flex:none;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;box-sizing:border-box;',
        '  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.16);--mdc-icon-size:20px}',
        '.cnt{flex:none;display:flex;align-items:baseline;gap:10px;padding:2px 2px 0}',
        '.cnt b{font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.cnt span{font-size:15px;color:rgba(255,255,255,.7);white-space:nowrap}',
        '.ls{flex:1 1 0;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:0 2px}',
        '.ls::-webkit-scrollbar{display:none}',
        '.it{box-sizing:border-box;display:flex;align-items:center;gap:12px;min-height:50px;font-size:17px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.it+.it{border-top:1px solid rgba(255,255,255,.12)}',
        '.it i{flex:none;width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 2px rgba(255,255,255,.55)}',
        '.it span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.it.done span{text-decoration:line-through;color:rgba(255,255,255,.6)}',
        '.it.done i{background:var(--hue);box-shadow:none}',
        '.nil{font-size:15px;color:rgba(255,255,255,.7);padding:12px 2px}',
        '.add{flex:none;display:flex;gap:8px}',
        '.add input{flex:1;min-width:0;box-sizing:border-box;height:44px;border-radius:22px;border:0;outline:0;padding:0 16px;font:inherit;font-size:17px;color:#fff;background:rgba(255,255,255,.12)}',
        '.add input::placeholder{color:rgba(255,255,255,.55)}',
        '.add button{all:unset;flex:none;box-sizing:border-box;height:44px;border-radius:22px;padding:0 20px;background:#fff;color:#1c1c1e;font-size:15px;font-weight:600;cursor:pointer}',
        '[role=button]:focus-visible,[role=tab]:focus-visible,.add button:focus-visible{outline:2px solid rgba(255,255,255,.7);outline-offset:2px}',
        '@media (prefers-reduced-motion:reduce){.scrim{transition:none}}'
      ].join('\n');
    }

    class HkTodoCard extends HkBase {
      static get CSS() { return TODO_CSS; }
      // (a block's tap, hk-base.js openTarget) the list, over the page: to tick off and to add to
      _tapTarget() {
        var a = this.client && this._config ? this._lists()[0] : null, self = this;
        return a ? [{ run: function () { self._open(a); } }] : [];
      }
      constructor() {
        super();
        this._n = 0;
        var self = this;
        // the Side Pane's read landing: the block drawn again, and its panel
        this._landed = function () { self._n++; self.redraw(); if (self._panel) self._panel.draw(); };
      }
      getCardSize() { return 4; }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._panel) this._panel.close(true);
        clearTimeout(this._waitT);
      }
      // the block's list (its own, else the house's first) and, for Extra Large, the house's next
      _lists() {
        var h = this.client, ids = todoIds(h), own = (this._config || {}).entity;
        var a = own && h.states[own] ? own : ids[0];
        return a ? [a].concat(ids.filter(function (x) { return x !== a; }).slice(0, 1)) : [];
      }
      _sigOf() {
        var h = this.client;
        if (!h || !this._config) return null;
        return todoIds(h).map(function (id) { var s = h.states[id]; return id + '=' + s.state + '/' + s.last_updated; }).join(';') +
          '|' + this._n + '|' + JSON.stringify(this._config);
      }
      // a list's items, through the Side Pane; before its module is there, asked again in a moment
      _read(eid) {
        var T = TD(), self = this;
        if (T && this.client) return T.items(this.client, eid, false, this._landed);
        clearTimeout(this._waitT);
        this._waitT = setTimeout(function () { self._n++; self.redraw(); }, 500);
        return null;
      }
      _render() {
        var h = this.client;
        if (!h || !this._config) return;
        var size = this._cellSize() || 'T', lists = this._lists();
        if (size !== 'S') this._watchBlock();
        this._wireTaps();
        if (!lists.length) {
          this._root.innerHTML = '<div class="blk tw ' + size + '"><div class="ln">To-do</div><div class="nil">No to-do lists</div></div>';
          return;
        }
        var a = lists[0], t = this._read(a), got = itemsOf(t), items = got.items || [], hue = listHue(h, a), name = listName(h, a);
        var left = listLeft(h, a);
        if (left == null) left = items.length;
        var count = left + (left === 1 ? ' item' : ' items');
        var head = '<div class="ln">' + esc(name) + '</div><div class="cn">' + left + '</div>';
        var rows = got.wait ? '<div class="nil">' + esc(got.wait) + '</div>'
          : items.length ? items.map(function (it) { return itemRow(a, it, t); }).join('') : '<div class="nil">Nothing left</div>';
        var hd = '<div class="hd" role="button" tabindex="0" data-open="' + esc(a) + '" aria-label="' + esc(name + ', ' + count + '. Show the list') + '">' + head + '</div>';
        var ft = '<div class="ft" style="display:none"></div>';
        var style = ' style="--hue:' + hue + '"';
        if (size === 'S') {
          var next = items[0] ? 'Next: ' + items[0].summary : got.wait ? '' : 'All done';
          this._root.innerHTML = '<div class="blk tw S" role="button" tabindex="0" data-open="' + esc(a) + '"' + style + ' aria-label="' +
            esc(name + ', ' + count + (next ? '. ' + next : '') + '. Show the list') + '">' + head + (next ? '<div class="ft">' + esc(next) + '</div>' : '') + '</div>';
          return;
        }
        if (size === 'T') {
          this._root.innerHTML = '<div class="blk tw T"' + style + '>' + hd + '<div class="ls">' + rows + '</div>' + ft + '</div>';
        } else if (size === 'L' || size === 'W') {
          this._root.innerHTML = '<div class="blk tw ' + size + '"' + style + '><div class="c1">' + hd + ft + '</div><div class="c2"><div class="ls">' + rows + '</div></div></div>';
        } else {
          // Extra Large: a second list of its own, or this one running on
          var b = lists[1], tb = b ? this._read(b) : null, gb = b ? itemsOf(tb) : null;
          var rowsB = !b ? '' : gb.wait ? '<div class="nil">' + esc(gb.wait) + '</div>'
            : gb.items.length ? gb.items.map(function (it) { return itemRow(b, it, tb); }).join('') : '<div class="nil">Nothing left</div>';
          var add = '<div class="addb" role="button" tabindex="0" data-add="' + esc(a) + '" aria-label="' + esc('Add an item to ' + name) + '">Add an Item</div>';
          this._root.innerHTML = '<div class="blk tw XL"' + style + '><div class="c1">' + hd + ft + add + '</div><div class="c2"><div class="ls">' + rows + '</div></div>' +
            '<div class="c3"' + (b ? ' style="--hue:' + listHue(h, b) + '"' : '') + '>' +
            (b ? '<div class="ln">' + esc(listName(h, b)) + '</div>' : '') + '<div class="ls">' + rowsB + '</div>' +
            (b ? '<div class="ft" style="display:none"></div>' : '') + '</div></div>';
          if (b) this._fitList(this._root.querySelector('.c3 .ls'), this._root.querySelector('.c3 .ft'), listLeft(h, b), gb.items);
          else {
            // (one list: what the second column can't take moves on into the third)
            var c2 = this._root.querySelector('.c2 .ls'), c3 = this._root.querySelector('.c3 .ls');
            var over = fitRows(c2, null);
            if (over) over.forEach(function (r) { r.style.display = ''; c3.appendChild(r); });
            var c3cut = fitRows(c3, this._root.querySelector('.c1 .ft'));
            this._more(this._root.querySelector('.c1 .ft'), left, items, c3cut);
            return;
          }
        }
        this._fitList(this._root.querySelector('.ls'), this._root.querySelector('.ft'), left, items);
      }
      // the rows that fit, and how many more at the foot ("3 more"): the count is the list's, not what was read
      _fitList(ls, ft, left, items) { this._more(ft, left, items, fitRows(ls, ft)); }
      _more(ft, left, items, cut) {
        if (!cut || !ft) return;
        var shown = items.length - cut.filter(function (r) { return r.classList.contains('it'); }).length;
        var n = Math.max(0, (left == null ? items.length : left) - shown);
        ft.textContent = n ? n + ' more' : '';
      }
      _wireTaps() {
        if (this._taps) return;
        this._taps = true;
        var self = this;
        var act = function (ev) {
          var el = ev.target && ev.target.closest && ev.target.closest('[data-uid],[data-open],[data-add]');
          if (!el) return;
          if (el.hasAttribute('data-uid')) { tick(self.client, el); return; }
          self._open(el.getAttribute('data-open') || el.getAttribute('data-add'), el.hasAttribute('data-add'));
        };
        this._root.addEventListener('click', act);
        this._root.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(ev); } });
      }
      _open(eid, adding) { if (!this._panel && eid) this._panel = todoPanel(this, eid, adding); }
    }
    // TICKED OFF: the Side Pane's command, the row struck through at once (and again if it was refused)
    function tick(client, el) {
      var T = TD(), sent = T && T.check(client, el.getAttribute('data-list'), el.getAttribute('data-uid'));
      if (!sent) return;
      el.classList.add('done');
      sent.catch(function () { el.classList.remove('done'); });
    }
    function todoPanel(card, eid, adding) {
      var HC = window.hkCards, plate = card._root.querySelector('.blk');
      if (!plate || !card.client) return null;
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:12;' + (HC.FONT_ROOT || '');
      var sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML = '<style>' + panelCss() + '</style><div class="scrim"></div><div class="nb" role="dialog" aria-modal="true">' +
        '<div class="hd"><div class="tabs" role="tablist"></div><div class="x" role="button" tabindex="0" aria-label="Close"><hk-icon icon="mdi:close"></hk-icon></div></div>' +
        '<div class="cnt"></div><div class="ls"></div>' +
        '<form class="add"><input name="item" placeholder="Add an Item" aria-label="Add an item" autocomplete="off" enterkeyhint="done"><button type="submit">Add</button></form></div>';
      var q = function (s) { return sr.querySelector(s); };
      var me = { eid: eid, el: q('.nb'), scrim: q('.scrim'), host: host, anim: null };
      me.draw = function () {
        var h = card.client;
        if (!h) return;
        var ids = todoIds(h);
        if (ids.indexOf(me.eid) < 0) me.eid = ids[0];
        if (!me.eid) { me.close(); return; }
        var t = card._read(me.eid), got = itemsOf(t), hue = listHue(h, me.eid), name = listName(h, me.eid), left = listLeft(h, me.eid);
        if (left == null) left = (got.items || []).length;
        me.el.style.setProperty('--hue', hue);
        me.el.setAttribute('aria-label', name);
        q('.tabs').innerHTML = ids.map(function (id) {
          return '<div role="tab" tabindex="0" aria-selected="' + (id === me.eid) + '" data-tab="' + esc(id) + '"' + (id === me.eid ? ' class="on"' : '') + '><span>' + esc(listName(h, id)) +
            '</span></div>';
        }).join('');
        q('.cnt').innerHTML = '<b style="color:' + hue + '">' + esc(name) + '</b><span>' + left + (left === 1 ? ' item' : ' items') + '</span>';
        var ls = q('.ls'), top = ls.scrollTop;
        ls.innerHTML = got.wait ? '<div class="nil">' + esc(got.wait) + '</div>'
          : got.items.length ? got.items.map(function (it) { return itemRow(me.eid, it, t); }).join('') : '<div class="nil">Nothing left</div>';
        ls.scrollTop = top;
        q('.add input').setAttribute('aria-label', 'Add an item to ' + name);
      };
      // ITS BOX: bigger than the block -- 520 x 640 on a tablet, a phone's width -- centred on it, on the screen
      me.place = function () {
        var vw = window.innerWidth, vh = window.innerHeight, r = me.rect || plate.getBoundingClientRect(), phone = vw <= HC.BP.phone;
        var w = Math.round(phone ? vw - 24 : Math.min(vw - 32, Math.max(r.width, 520)));
        var hh = Math.round(Math.min(vh - (phone ? 48 : 40), Math.max(r.height, 640)));
        var clamp = function (v, lo, hi) { return hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)); };
        me.box = { x: Math.round(clamp(r.left + r.width / 2 - w / 2, 12, vw - w - 12)), y: Math.round(clamp(r.top + r.height / 2 - hh / 2, 20, vh - hh - 20)), w: w, h: hh };
        me.el.style.cssText = 'left:' + me.box.x + 'px;top:' + me.box.y + 'px;width:' + w + 'px;height:' + hh + 'px';
      };
      // ...grown out of the block, and back into it: transforms only
      var reduce = function () {
        return (window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) ||
               (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      };
      var small = function () {
        var R = me.rect, B = me.box;
        return 'translate(' + Math.round(R.left + R.width / 2 - (B.x + B.w / 2)) + 'px,' + Math.round(R.top + R.height / 2 - (B.y + B.h / 2)) + 'px) scale(' +
          (R.width / B.w).toFixed(3) + ',' + (R.height / B.h).toFixed(3) + ')';
      };
      me.close = function (now) {
        if (card._panel !== me) return;
        card._panel = null;
        window.removeEventListener('keydown', me.key);
        window.removeEventListener('resize', me.place);
        try { var fa = sr.activeElement; if (fa && fa.blur) fa.blur(); } catch (x) { /* none */ }
        me.scrim.classList.remove('on');
        var fin = function () { host.remove(); };
        if (now || reduce() || typeof me.el.animate !== 'function') { fin(); return; }
        if (me.anim) me.anim.cancel();
        me.anim = me.el.animate([{ transform: 'none', opacity: 1 }, { transform: small(), opacity: 0 }], { duration: 260, easing: HC.EASE.exit, fill: 'forwards' });
        me.anim.onfinish = fin;
      };
      me.key = function (ev) { if (ev.key === 'Escape') me.close(); };
      me.scrim.addEventListener('click', function () { me.close(); });
      me.el.addEventListener('click', function (ev) {
        var t = ev.target && ev.target.closest && ev.target.closest('.x,[data-tab],[data-uid]');
        if (!t) return;
        if (t.classList.contains('x')) me.close();
        else if (t.hasAttribute('data-tab')) { me.eid = t.getAttribute('data-tab'); q('.ls').scrollTop = 0; me.draw(); }
        else tick(card.client, t);
      });
      me.el.addEventListener('keydown', function (ev) {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.closest && ev.target.closest('[role=button],[role=tab]')) { ev.preventDefault(); ev.target.click(); }
      });
      q('.add').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var inp = q('.add input'), txt = String(inp.value || '').trim(), T = TD();
        if (!txt || !T || !card.client) return;
        inp.value = '';
        T.add(card.client, me.eid, txt).catch(function () { inp.value = txt; });
      });
      window.addEventListener('keydown', me.key);
      window.addEventListener('resize', me.place);
      var rr = plate.getBoundingClientRect();
      me.rect = { left: rr.left, top: rr.top, width: rr.width, height: rr.height };
      me.place();
      me.draw();
      document.body.appendChild(host);
      requestAnimationFrame(function () { me.scrim.classList.add('on'); });
      if (!reduce() && typeof me.el.animate === 'function') {
        me.anim = me.el.animate([{ transform: small(), opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: HC.EASE.standard });
      }
      if (adding) setTimeout(function () { var i = q('.add input'); if (i && card._panel === me) i.focus(); }, 60);
      return me;
    }

    // what the shell and the later parts use of this one
    K.HkTodoCard = HkTodoCard;
  };
})();
