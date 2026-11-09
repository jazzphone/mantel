// hk-grid-security.js - the small key, the security card and its keypad, the vacuum.
//
// PART OF THE HOME GRID'S CARDS (hk-grid-cards.js). Not a card and not run on its own: it registers one
// function, which hk-grid-cards.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridCardsParts = window.hkGridCardsParts || {})['hk-grid-security'] = function (K) {
    var attr = K.attr, C = K.C, dom = K.dom, DOORS = K.DOORS, friendly = K.friendly, HkBase = /** @type {HkLooseElementConstructor} */ (K.HkBase), kind = K.kind,
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
    // Tall (2026-11-07): the same in a narrow block -- the state a word over its line, Home and Away side by side with
    // Disarm under them. Large: the shield and "Armed · Home" over that list, Home, Away and
    // Disarm at the foot. Extra Large (hk-grid-keypad-card): the alarm's
    // keypad beside the list. Every arming goes through the alarm's own sheet
    // or keypad: no command here can bypass its PIN. The list takes the room
    // it has, a row of 44 px each, and says "N more" for what does not fit.
    var SEC_ROW = 44;
    // THE DOORS AND WINDOWS AT A BLOCK'S FOOT (2026-11-08, the owner's "toast for the windows and doors that open"): nothing while all
    // are closed -- the room is the list's; else a flat strip in orange: "Office Window open", or "3 open · " and their names. Extra
    // Large's keypad block, and HomeView's Large, Tall and Wide.
    // "+N MORE" in a heading's line, as an Accessory Group's: a label, its 44 px tap round it
    var LM_CSS = '.lm{all:unset;' + C.labelCss('label') + ';line-height:16px;text-shadow:' + v('glow') + ';position:relative;top:-3px;white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent;flex:none}' +
      '.lm::after{content:"";position:absolute;left:-10px;right:-10px;top:-14px;bottom:-14px}.lm[hidden]{display:none}';
    var NOTICE_CSS = [
      // (flat, the earlier strip's look -- the owner, 2026-11-08: "I prefer the flatter toast style", not a button like the rows): a pill of
      // the key's fill as wide as the rows, the glyph and the words in orange, one line; its tap a finger's 44 px on screen round it
      '.ops .op.toast{position:relative;width:100%;height:44px;justify-content:flex-start;gap:10px;padding:0 16px;border-radius:22px;background:' + v('key') + ';color:' + v('warn') + ';text-shadow:' + v('glow') + '}',
      '.ops .op.toast::after{content:"";position:absolute;left:0;right:0;top:-6px;bottom:-6px}',
      '.ops .op.toast hk-icon{width:20px;height:20px;color:' + v('warn') + '}',
    ].join('');
    function doorsNotice(self, box, rows, go, short) {
      var open = rows.filter(function (r) { return r.open; });
      box.innerHTML = '';
      var mk = function (cls, html, label, fn) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; self._button(d, fn); d.setAttribute('aria-label', label); return d; };
      if (open.length) {
        var names = open.map(function (r) { return r.name; }).join(', ');
        // (short -- Wide's, under the alarm -- the count alone: its names were cut to a word)
        var tt = short ? open.length + ' open' : open.length === 1 ? open[0].name + ' ' + (open[0].value || 'open').toLowerCase() : open.length + ' open · ' + names;
        var to = mk('op toast', '<hk-icon></hk-icon><span></span>', open.length + ' open: ' + names, open.length === 1 ? function () { window.hkShell.moreInfo(open[0].id, self); } : go);
        to.querySelector('hk-icon').icon = open[0].icon; to.querySelector('span').textContent = tt;
        box.appendChild(to);
      }
      box.style.display = box.children.length ? '' : 'none';
    }
    var SEC_LIST_ROW = 56;
    // THE ROW'S HEIGHT: as many 56 px rows as the room holds, then the tallest of three designed heights at which that many still fit --
    // never a measure to fit, never a gap a row's height of the room left over under the list
    function listRow(H, n) {
      var fits = Math.max(1, Math.floor((H + 8) / (SEC_LIST_ROW + 8))), k = Math.min(n, fits);
      if (n < fits) return { rh: SEC_LIST_ROW, fits: fits };
      var rh = [64, 60, 56].filter(function (h) { return k * h + (k - 1) * 8 <= H; })[0] || SEC_LIST_ROW;
      return { rh: rh, fits: fits };
    }
    // WHICH ROWS SHOW WHEN NOT ALL FIT: what is not secured first, then the garage doors, then the rest in their order -- "+N more" is
    // only ever secured locks where it can be (the owner, 2026-11-08: "my locks, garage door"); shown in the block's own order
    function shownFirst(list, show) {
      var rank = function (r) { return r.open || r.kind === 'open' || r.kind === 'jammed' ? 0 : (r.id || '').indexOf('cover.') === 0 ? 1 : 2; };
      var idx = list.map(function (r, i) { return i; }).sort(function (a, b) { return rank(list[a]) - rank(list[b]) || a - b; }).slice(0, show), keep = {};
      idx.forEach(function (i) { keep[i] = true; });
      return keep;
    }
    var SEC_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.sec{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:10px;padding:' + C.blockPad('14px') + ';overflow:hidden;' + C.plate('card') + ';color:' + v('ink') + ';',
      '  -webkit-tap-highlight-color:transparent;--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
      'hk-plate.sec[size=W],hk-plate.sec.kp{flex-direction:row;gap:18px}',
      // (shapes on its inset -- the keypad, the locks, the ways to arm -- at the shape inset, 13 on a square cell, their corners 34 - 13;
      // the heading keeps the text's 18 -- 2026-11-08, the owner's group-block rule "across all the cards")
      'hk-plate.sec.kp,hk-plate.sec[size=L],hk-plate.sec[size=T]{padding:' + C.blockPad('14px', true) + '}',
      'hk-plate.sec[size=L] .hd,hk-plate.sec[size=T] .hd{margin:var(--hk-text-in,0px) var(--hk-text-in,0px) 0 var(--hk-text-in,0px)}',
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
      // ...and in the Centered tile style (2026-11-07, the review: beside Lock Up and the lamps it alone sat on the
      // inset's corner): HomeView's tile -- the shield bare at a third, the state and what it says centered under it
      C.centredTile({ host: ':host([tile=centred])', plate: 'hk-plate.sec[size=S]', lit: 'hk-plate.sec.lit[size=S]', well: 'hk-plate.sec[size=S] .wl',
                      icon: 'hk-plate.sec[size=S] .wl hk-icon', name: 'hk-plate.sec[size=S] .big', sub: ['hk-plate.sec[size=S] .sub'] }),
      '.side{display:flex;flex-direction:column;flex:0 0 150px;min-width:0}',
      '.hd{display:flex;align-items:center;gap:12px;min-width:0;flex:none;min-height:44px}',
      '.hd .tx{display:flex;flex-direction:column;min-width:0}',
      '.hd b{' + type('title') + ';font-weight:600;line-height:27px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.hd small{' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.col{display:flex;flex-direction:column;gap:10px;flex:1;min-width:0;min-height:0}',
      // (2026-11-08, the owner's rule -- a control is 44 px with 8 px clear round it: Wide's rows are keys, the room between them)
      '.rows{display:flex;flex-direction:column;justify-content:center;gap:8px;flex:1;min-height:0;min-width:0;overflow:hidden}',
      '.row{display:flex;align-items:center;gap:10px;height:' + SEC_ROW + 'px;flex:none;box-sizing:border-box;padding:0 14px;border-radius:' + (C.R.inner + 'px') + ';background:' + v('key') + ';min-width:0}',
      '.row hk-icon{width:20px;height:20px;--mdc-icon-size:100%;display:flex;flex:none;color:' + v('ink-2') + '}',
      '.row span{' + type('body') + ';flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.row em{font-style:normal;' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap;flex:none}',
      // THE STATE UNDER THE NAME (2026-11-08, the lead: "Front D... Unlocked" -- the row beside the shield's column had the name and its state
      // in one line): the row is the glyph and two lines, the name whole and the state under it, 44 px as before
      '.row{display:grid;grid-template-columns:20px minmax(0,1fr);gap:0 10px;align-content:center}.row hk-icon{grid-row:1 / span 2;align-self:center}',
      '.row span{flex:none;grid-column:2;line-height:19px}.row em{grid-column:2;line-height:16px}.row.mo span{grid-row:1 / span 2;align-self:center}',
      '.row.open hk-icon,.row.open em{color:' + v('warn') + '}',
      '.row.lk hk-icon{color:var(--lk)}',
      '.row.mo span{color:' + v('ink-2') + '}',
      // Home, Away and Disarm along the foot, where a thumb is: the mode it is in lit
      // THE KEYS' DESIGNED WIDTHS (2026-11-08, `--stretch`: they grew with the block): each key a width of its own, the row centered --
      // Large's three 112 wide, Tall's Home and Away 72 with Disarm as wide as the two and the gap between them
      '.arm{display:flex;justify-content:center;gap:8px;flex:none}',
      '.arm button{all:unset;box-sizing:border-box;flex:none;width:112px;height:44px;border-radius:22px;text-align:center;background:' + v('key') + ';' + type('body') + ';font-weight:600;color:' + v('ink') + ';cursor:pointer}',
      '.arm button.on{background:#fff;color:#1c1c1e}',
      '.arm button:active{background:' + v('key-strong') + '}',
      // TALL (2026-11-07, the review): the shield and state on top, the rows through the middle, and at the foot Home and Away
      // side by side with Disarm under them (three 44 px keys in a row do not fit a block this narrow); the state's line may
      // take two lines, so "Office Window open" is read whole
      'hk-plate.sec[size=T] .arm{flex-wrap:wrap;width:152px;align-self:center}hk-plate.sec[size=T] .arm button{width:72px}hk-plate.sec[size=T] .arm button[data-m=off]{width:152px}',
      'hk-plate.sec[size=T] .hd small{white-space:normal;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
      // (2026-11-08, the owner's rule -- "anything that does not fit cleanly moves to the detail sheet": Tall is the alarm and its three
      // ways to arm, the shield and the state centered in the room between them; the locks and doors are the Security page's and
      // the block's Custom Detail Sheet's; the heading says what is open and opens the alarm's sheet)
      'hk-plate.sec[size=T] .hd{flex:1 1 auto;flex-direction:column;justify-content:center;text-align:center;gap:8px}hk-plate.sec[size=T] .hd .wl{width:56px;height:56px}hk-plate.sec[size=T] .hd .tx{align-items:center;max-width:100%}',
      // LARGE AND EXTRA LARGE (2026-11-08, the owner: "the touch points for the locks/garage door ... a tad bigger ... the keypad first,
      // the locks and garage door represented cleanly and easy to interact with, then ... open windows and doors in a compact way"; and
      // "entities in a card should maintain dimensions": NOTHING STRETCHES, DESIGN.md "Using the space"): the locks and the garage as
      // tiles of ONE designed size -- 116 x 96 with the glyph over the name over its state, or, where that fits fewer, 150 x 64 with the
      // glyph beside them -- as many as the room holds (what is left is "N more", a tile as big as the rest), the group centered, its
      // last row centered too; each a tap that opens its sheet; one not secured the white of HomeView's lit tile. Under them one
      // 44 px strip for the doors and windows (as wide as its words): "All closed" (a tap opens Doors & Windows), else the open ones
      // (Extra Large: no heading -- the keypad's readout says the alarm's state, and the strip says what is open)
      'hk-plate.sec.kp .hd{display:none}',
      // (the tiles and the strip are one group, centered in what the heading and the keys leave: auto margins at its two ends)
      '.ents{flex:1 1 0;min-height:0;width:100%;margin:0 auto;display:flex;flex-wrap:wrap;justify-content:center;align-content:center;gap:8px}',
      '.ent{box-sizing:border-box;flex:none;min-width:0;border-radius:var(--hk-inner-radius,' + C.R.inner + 'px);' + C.plate('tile') + ';cursor:pointer;transition:transform ' + C.DUR.press + ' ease}',
      '.ent:active{transform:scale(0.97)}',
      '.ent .in{box-sizing:border-box;width:100%;height:100%;display:flex;align-items:center;gap:10px;padding:0 12px}',
      '.ent hk-icon{width:26px;height:26px;--mdc-icon-size:100%;display:flex;flex:none;color:' + v('ink-2') + '}.ent.lk hk-icon{color:var(--lk)}',
      '.ent .tt{display:flex;flex-direction:column;min-width:0}',
      // (a name is read whole: two lines where it needs them -- "Black Beauty Lock", "Crawl Space Lock" -- never cut, 2026-11-08)
      '.ent .n{' + type('body') + ';font-weight:600;font-size:15px;line-height:18px;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}',
      '.ent .s{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ents.st .ent .in{flex-direction:column;justify-content:center;text-align:center;gap:3px;padding:6px}.ents.st .ent hk-icon{width:34px;height:34px;margin-bottom:3px}.ents.st .ent .tt{align-items:center;max-width:100%}.ents.st .ent .n{font-size:15px;line-height:18px}.ents.st .ent .s{font-size:15px;line-height:20px}',
      '.ent.open{background:#fff;--hk-glass-backdrop:none;-webkit-backdrop-filter:none;backdrop-filter:none}.ent.open .n{color:#000}.ent.open .s{color:' + v('ink-on-state') + '}.ent.open hk-icon{color:' + v('warn') + '}',
      '.ops{display:flex;justify-content:center;gap:8px;flex:none;min-width:0}',
      '.op{box-sizing:border-box;flex:0 1 auto;min-width:0;max-width:100%;height:44px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 18px;border-radius:22px;background:' + v('key') + ';cursor:pointer;color:' + v('ink-2') + ';-webkit-tap-highlight-color:transparent}',
      '.op:active{background:' + v('key-strong') + '}.op hk-icon{width:20px;height:20px;--mdc-icon-size:100%;display:flex;flex:none}',
      '.op span{' + type('body') + ';font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.op.open{color:' + v('warn') + ';text-shadow:' + v('glow') + '}',
      // EXTRA LARGE BESIDE THE KEYPAD, DRAWN AGAIN (2026-11-08, the owner: "back to the drawing board ... the keypad, my locks, garage door,
      // and the toast for the windows and doors that open"; the tiles "just bump to the top of the edge", "there should be a heading"):
      // a label row over the column, as an Accessory Group's -- LOCKS & DOORS, "+N more" at its right when some do not fit; each lock and
      // garage door a row of the column's width (56 px, never grown): its glyph, its name whole, its state at the right -- not secured,
      // the white of a lit tile, the state in orange; at the foot, on the arm keys' line, the doors and windows: nothing while all
      // are closed, else a notice -- an orange badge, what is open and the rest under it
      '.lh{display:none}',
      'hk-plate.sec.kp .col{gap:8px}',
      'hk-plate.sec.kp .lh{display:flex;align-items:center;justify-content:space-between;gap:10px;height:19px;flex:none;margin:var(--hk-text-in,0px) var(--hk-text-in,0px) 0}',
      '.lh .lt{' + C.labelCss('label') + ';line-height:16px;text-shadow:' + v('glow') + ';position:relative;top:-3px;white-space:nowrap}',
      LM_CSS,
      '.ents.lst{display:flex;flex-direction:column;flex-wrap:nowrap;justify-content:flex-start;align-content:stretch;gap:8px;margin:0}',
      '.ents.lst .ent{width:100%;height:' + SEC_LIST_ROW + 'px}',
      '.ents.lst .ent .in{gap:12px;padding:0 16px 0 14px}',
      '.ents.lst .ent hk-icon{width:26px;height:26px}',
      '.ents.lst .ent .tt{flex:1;flex-direction:row;align-items:baseline;justify-content:space-between;gap:10px}',
      '.ents.lst .ent .n{font-size:17px;line-height:22px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;flex:0 1 auto}',
      '.ents.lst .ent .s{font-size:15px;line-height:20px;flex:none}',
      '.ents.lst .ent.open .s{color:' + v('warn') + ';font-weight:600}',
      'hk-plate.sec.kp .ops{margin-top:auto;justify-content:flex-start}',
      // LARGE (Classic) THE SAME (2026-11-08, the owner: its tiles' words ran into their edges, the strip wider than the tiles -- "it
      // looks thrown together"): the alarm's heading ("+N more" at its right), the rows, the notice and Home, Away and Disarm -- every
      // one the block's inner width, on the same two edges
      'hk-plate.sec[size=L]{gap:8px}hk-plate.sec[size=L] .ops{margin-top:auto;justify-content:flex-start}',
      'hk-plate.sec[size=L] .arm{justify-content:stretch}hk-plate.sec[size=L] .arm button{flex:1 1 0;width:auto}',
      'hk-plate.sec .hd .lm{top:0;margin-left:auto}',
      NOTICE_CSS,
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
        out.push({ id: id, name: friendly(client, id), icon: open ? 'mdi:lock-open-variant' : 'mdi:lock', value: open ? 'Unlocked' : OFF[s] ? 'Unknown' : 'Locked', open: open, lock: !open, tile: true });
      });
      var garage = (kind('garage') || own(client, 'cover').filter(function (id) { return DOORS[attr(st[id], 'device_class')]; })).filter(function (id) { return st[id]; });
      garage.forEach(function (id) {
        var s = st[id].state, shut = s === 'closed' || s === 'off';
        out.push({ id: id, name: friendly(client, id), icon: shut ? 'mdi:garage' : 'mdi:garage-open', value: shut ? 'Closed' : OFF[s] ? 'Unknown' : 'Open', open: !shut && !OFF[s], tile: true });
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
            : keys ? '<div class="kpad" data-notap></div><div class="col">' + head + '<div class="lh"><span class="lt">Locks &amp; Doors</span><button type="button" class="lm" hidden></button></div><div class="ents lst"></div><div class="ops"></div></div>'
            : size === 'L' ? head.replace('</div></div>', '</div><button type="button" class="lm" hidden></button></div>') + '<div class="ents lst"></div><div class="ops"></div><div class="arm"><button type="button" data-m="home">Home</button><button type="button" data-m="away">Away</button><button type="button" data-m="off">Disarm</button></div>'
            : size === 'T' ? head + '<div class="arm"><button type="button" data-m="home">Home</button><button type="button" data-m="away">Away</button><button type="button" data-m="off">Disarm</button></div>'
            : head + '<div class="rows"></div><div class="arm"><button type="button" data-m="home">Home</button><button type="button" data-m="away">Away</button><button type="button" data-m="off">Disarm</button></div>';
          this._root.innerHTML = '<hk-plate class="sec' + (keys ? ' kp' : '') + '" data-hk-role="card" size="' + size + '">' + html + '</hk-plate>';
          var q = this._root.querySelector.bind(this._root), all = this._root.querySelectorAll.bind(this._root);
          this._e = { card: q('.sec'), wl: q('.wl'), icon: q('.wl hk-icon'), big: q('.big') || q('.hd b'), sub: q('.sub') || q('.hd small'), rows: q('.rows'), ents: q('.ents'), ops: q('.ops'), lm: q('.lm') };
          if (this._e.lm) this._e.lm.addEventListener('click', function (ev) { ev.stopPropagation(); self._tap(); });
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
          this._rowKey = null; this._tileKey = null;          // (a new build: its entries and the line under them drawn again)
          this._built = true;
        }
        var e = this._e, st = alarm && this.client && this.client.states[alarm], look = alarmLook(st), rows = secRows(this.client), says = secSays(rows);
        // THE BLOCK'S OWN ENTRIES (members, HomeView's Entries: Choose -- 2026-11-08, the keypad kept in HomeView's Extra Large): its
        // locks and garage doors those, in its order; the doors and windows still the line under them
        var mem = Array.isArray((this._config || {}).members) && this._config.members.length ? this._config.members : null;
        // (one the house's own lists leave out is still drawn from its state -- 2026-11-08, the owner: chosen entries didn't show)
        var stAll = (this.client && this.client.states) || {}, cl = this.client;
        if (mem) rows = rows.filter(function (r) { return !r.tile; }).concat(mem.map(function (id) {
          var r0 = rows.filter(function (r) { return r.tile && r.id === id; })[0], s0 = stAll[id];
          if (r0) return r0;
          if (!s0) return { id: id, name: id, icon: 'mdi:help-circle-outline', value: 'Unavailable', open: false, tile: true };
          if (dom(id) === 'lock') {
            var un = s0.state === 'unlocked' || s0.state === 'open';
            return { id: id, name: friendly(cl, id), icon: un ? 'mdi:lock-open-variant' : 'mdi:lock', value: un ? 'Unlocked' : 'Locked', open: un, lock: !un, tile: true };
          }
          var shut = s0.state === 'closed' || s0.state === 'off', gar = !!DOORS[attr(s0, 'device_class')];
          return { id: id, name: friendly(cl, id), icon: gar ? (shut ? 'mdi:garage' : 'mdi:garage-open') : (shut ? 'mdi:door-closed' : 'mdi:door-open'),
                   value: shut ? 'Closed' : 'Open', open: !shut, tile: true };
        }));
        if (e.icon.icon !== look.icon) e.icon.icon = look.icon;
        if (look.color) e.card.style.setProperty('--c', look.color); else e.card.style.removeProperty('--c');
        if (look.text) e.card.style.setProperty('--t', look.text); else e.card.style.removeProperty('--t');
        var big = size === 'S' || size === 'W' || size === 'T' ? look.word : look.word + (look.mode ? ' · ' + look.mode : '');
        var sub = size === 'S' ? [look.mode, says && (/^All /.test(says) ? 'all ' + says.slice(4) : says)].filter(Boolean).join(' · ') : size === 'W' ? (look.mode || says) : size === 'T' ? [look.mode, says].filter(Boolean).join(' · ') : says;
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
        if (e.ents) {
          // (the locks and the garage as tiles, the doors and windows as the strip under them; a house with no lock or garage
          // door shows its doors and windows as the tiles)
          var tiles = rows.filter(function (r) { return r.tile; }), ops = rows.filter(function (r) { return !r.tile; });
          if (!tiles.length) { tiles = ops; ops = []; }
          var tkey = JSON.stringify([tiles, ops]);
          if (tkey !== this._tileKey) {
            this._tileKey = tkey; this._tiles = tiles;
            e.ents.innerHTML = ''; e.ops.innerHTML = '';
            var mk = function (cls, html, label, fn) {
              var d = document.createElement('div'); d.className = cls; d.innerHTML = html; self._button(d, fn); d.setAttribute('aria-label', label); return d;
            };
            tiles.forEach(function (r) {
              var d = mk('ent' + (r.open ? ' open' : '') + (r.lock ? ' lk' : ''), '<div class="in"><hk-icon></hk-icon><div class="tt"><span class="n"></span><span class="s"></span></div></div>', r.name + ', ' + r.value, function () { window.hkShell.moreInfo(r.id, self); });
              d.querySelector('hk-icon').icon = r.icon; d.querySelector('.n').textContent = r.name; d.querySelector('.s').textContent = r.value;
              e.ents.appendChild(d);
            });
            var more = mk('ent more', '<div class="in"><hk-icon></hk-icon><div class="tt"><span class="n"></span></div></div>', '', function () { self._tap(); });
            more.querySelector('hk-icon').icon = 'mdi:dots-horizontal'; more.style.display = 'none';
            e.ents.appendChild(more); this._moreTile = more;
            // (the strip: what is open, by name; else "All closed", a tap to the doors and windows page)
            var open = ops.filter(function (r) { return r.open; }), go = function () { if (!window.hkCards.openTarget(self, [{ page: 'doors-windows' }, alarm && { sheet: alarm }])) self._tap(); };
            if (keys || size === 'L') doorsNotice(self, e.ops, ops, go);
            if (!keys && size !== 'L' && ops.length && !open.length) { var shut = mk('op', '<hk-icon></hk-icon><span>All closed</span>', 'Doors and windows: all closed', go); shut.querySelector('hk-icon').icon = 'mdi:door-closed'; e.ops.appendChild(shut); }
            if (!keys && size !== 'L' && open.length) {
              var d = mk('op open', '<hk-icon></hk-icon><span></span>', open.length + ' open: ' + open.map(function (r) { return r.name; }).join(', '), open.length === 1 ? function () { window.hkShell.moreInfo(open[0].id, self); } : go);
              d.querySelector('hk-icon').icon = open[0].icon;
              d.querySelector('span').textContent = open.length === 1 ? open[0].name + ' ' + open[0].value.toLowerCase() : open.map(function (r) { return r.name; }).join(', ');
              e.ops.appendChild(d);
            }
            if (!keys && size !== 'L') e.ops.style.display = e.ops.children.length ? '' : 'none';
          }
          e.card.style.setProperty('--lk', C.ACCENTS.teal);
        }
        if (this._pad) {
          // the keys and their gaps fill the block's height: the readout, four rows of keys, the ways to arm
          var h = bk ? bk.h - 36 : 369;
          // (Home, Away and Disarm are as tall as a key where the block has the room -- 2026-11-08, the lead: "under 44 px tall" -- else 44, never less)
          var k6 = Math.floor((h - 50) / 6), pk = Math.max(36, Math.min(64, side ? Math.floor((h - 30) / 4) : k6 >= 44 ? k6 : Math.floor((h - 44 - 50) / 5)));
          this._pad.style.setProperty('--hk-kp-key', pk + 'px');
          this._pad.style.setProperty('--hk-kp-pill', Math.max(44, side ? Math.min(56, pk) : k6 >= 44 ? pk : 44) + 'px');
        }
        this._fit();
      }
      // THE TILES IN THE ROOM THEY HAVE (2026-11-08): each of one designed size, never grown (DESIGN.md "Using the space"): the stacked
      // tile (116 x 96) or the tile in a row (150 x 64), the stacked one when it holds them all, else whichever holds more; as many as fit, the
      // last place "N more" when there are more (the alarm's sheet); the group as even as it can be -- four are 2 + 2 -- and centered,
      // its last row too
      _fitTiles() {
        var e = this._e, box = e.ents, list = this._tiles || [], n = list.length, G = 8, best = null;
        box.style.flex = ''; box.style.height = ''; box.style.margin = ''; box.style.maxWidth = '';    // (measured as the room the others leave -- its last
        // width too: kept, the box measured its own last layout and never found room for two columns again, 2026-11-08)
        var W = box.clientWidth, H = box.clientHeight;
        // (the box takes the room the heading, the strip and the keys leave; its tiles keep their own size inside it)
        if (!W || H <= 0) return;
        if (this._pad || this._size() === 'L') return this._fitList(box, list, H);
        // TWO COLUMNS OF HOMEVIEW TILES (2026-11-08, the owner on his Kitchen tablet: one column of pills beside the keypad "looks
        // horrible"): the stacked tile -- glyph, name (two lines where it needs them), state -- at the largest of a few designed sizes
        // that stands two across in the room the keypad leaves; only a column too narrow for two of the smallest takes one column of
        // rows. Never a size measured to fit: one of these, the group centered.
        // (beside the keypad too: the owner, 2026-11-08, tried a wider keypad and one column of pills -- "those cards are super wide
        // now ... 2 column is the best here")
        // HALF (the block's Height): half-height pills, two across at the widest of three designed widths -- the glyph beside the
        // name, which takes two lines where it needs them
        // (beside the keypad Half is the default -- the owner, 2026-11-08: "that looks the best"; Full, the HomeView tiles, when chosen)
        var hc = (this._config || {}).height, half = hc === 'half' || (!hc && !!this._pad);
        var sizes = half ? [{ w: 150, h: 64, st: false }, { w: 140, h: 64, st: false }, { w: 130, h: 64, st: false }] : this._size() === 'XL' ? [{ w: 136, h: 112 }, { w: 124, h: 104 }, { w: 112, h: 100 }] : [{ w: 116, h: 96 }, { w: 108, h: 96 }, { w: 100, h: 92 }];
        sizes.some(function (o) {
          var across = Math.min(3, Math.floor((W + G) / (o.w + G))), rows = Math.floor((H + G) / (o.h + G));
          if (across < 2 || rows < 1) return false;
          best = { w: o.w, h: o.h, st: o.st !== false, across: across, cap: across * rows };
          return true;
        });
        if (!best) {
          var rw = Math.min(W, 168), rr = Math.max(1, Math.floor((H + G) / (64 + G)));
          best = { w: rw, h: 64, st: false, across: 1, cap: rr };
        }
        var show = n <= best.cap ? n : Math.max(0, best.cap - 1), slots = show < n ? show + 1 : show;
        var rowsNeeded = Math.max(1, Math.ceil(slots / best.across)), c = Math.max(1, Math.ceil(slots / rowsNeeded));
        box.classList.toggle('st', best.st);
        box.style.maxWidth = (c * best.w + (c - 1) * G) + 'px';
        box.style.flex = 'none'; box.style.height = (rowsNeeded * best.h + (rowsNeeded - 1) * G) + 'px';
        // BESIDE THE KEYPAD the column lines up with it (the owner, 2026-11-08: the doors-and-windows line "should align to the bottom
        // of the Arm/Disarm buttons"): the locks from the readout's top, the line on the arm keys' foot; elsewhere one centered group
        box.style.margin = this._pad ? '0 auto' : 'auto auto 0';
        if (e.ops) { e.ops.style.marginBottom = this._pad ? '0' : 'auto'; e.ops.style.marginTop = this._pad ? 'auto' : ''; }
        var all = Array.prototype.filter.call(box.children, function (k) { return k !== this._moreTile; }, this), vis = all.slice(0, show).concat(show < n ? [this._moreTile] : []);
        all.concat(this._moreTile).forEach(function (k) { k.style.display = vis.indexOf(k) < 0 ? 'none' : ''; k.style.width = best.w + 'px'; k.style.height = best.h + 'px'; });
        if (show < n) {
          var t = (n - show) + ' more';
          this._moreTile.querySelector('.n').textContent = t;
          this._moreTile.setAttribute('aria-label', t + ': the alarm’s sheet');
        }
      }
      // BESIDE THE KEYPAD: whole 56 px rows from the top, as many as the column holds; the rest "+N more" in the label row
      _fitList(box, list, H) {
        // (56 px: a finger's 44 on the tablet's screen, where a block is drawn at 0.8 -- the owner's rule; custom_sheet_check)
        var n = list.length, lr = listRow(H, n), rh = lr.rh, fits = lr.fits, show = Math.min(n, fits), lm = this._e.lm;
        if (this._moreTile) this._moreTile.style.display = 'none';
        var kids = Array.prototype.filter.call(box.children, function (k) { return k !== this._moreTile; }, this), keep = shownFirst(list, show);
        kids.forEach(function (k, i) { k.style.display = keep[i] ? '' : 'none'; k.style.width = ''; k.style.height = rh + 'px'; });
        box.style.flex = 'none'; box.style.height = (show * rh + Math.max(0, show - 1) * 8) + 'px'; box.style.maxWidth = ''; box.style.margin = '0';
        if (lm) {
          lm.hidden = show >= n;
          lm.textContent = '+' + (n - show) + ' more';
          lm.setAttribute('aria-label', (n - show) + ' more: the alarm’s sheet');
        }
      }
      // THE LIST IN THE ROOM IT HAS: whole rows; what does not fit, "N more"
      _fit() {
        var e = this._e;
        if (e && e.ents) return this._fitTiles();
        if (!e || !e.rows || !this._more) return;
        var list = Array.prototype.filter.call(e.rows.children, function (c) { return c !== this._more; }, this);
        var h = e.rows.clientHeight;
        if (!h) return;
        var fits = Math.max(0, Math.floor((h + 8) / (SEC_ROW + 8))), cut = list.length > fits, show = cut ? Math.max(0, fits - 1) : list.length;
        // (a row is 44 px, never grown -- 2026-11-08, "nothing stretches" -- 8 px between; what is shown, or the shown and "N more", stands centered in the room)
        list.forEach(function (r, i) { r.style.display = i >= show ? 'none' : ''; });
        this._more.style.display = cut && fits > 0 ? '' : 'none';
        if (cut) {
          var t = (list.length - show) + ' more';
          this._more.querySelector('span').textContent = t;
          this._more.setAttribute('aria-label', t + ': the alarm’s sheet');
        }
      }
    }

    // ===================================================== Security as HomeView has it
    // SECURITY'S HOMEVIEW PRESENTATION (2026-11-07, docs/phase11/HOME-GRID.md "Security's HomeView sizes"; the
    // block's `presentation: homeview`): the alarm and the house's entries -- its locks and garage doors -- as the
    // accessory tiles beside it are drawn, never a look of its own. Small is a key (the shield, Security and one line);
    // Wide the alarm beside its locks and garage in a line each; Compact (3 x 1) the alarm beside a slot for each
    // entry; Large the alarm over a row for each; Extra Large the alarm beside two columns of slots. What does not fit
    // ends in an "N more" slot, as big as the rest; the alarm is no entry slot. An entry that is not secured -- a lock
    // unlocked, a garage open, a lock jammed -- is the white tile every accessory that is on is; a secured one rests.
    // The whole tile (or row) is its tap, and opens: the alarm and "N more" the Security overview (the block's own
    // custom sheet when it has one, else the alarm and every entry as tiles); an entry its own sheet, where it is
    // unlocked or opened by holding, as ever. Nothing here operates a lock, a door or the alarm.
    var LOCK_WORDS = { locked: ['Locked', 'secure'], unlocked: ['Unlocked', 'open'], open: ['Open', 'open'], jammed: ['Jammed', 'jammed'],
                       locking: ['Locking…', 'moving'], unlocking: ['Unlocking…', 'moving'], opening: ['Opening…', 'moving'] };
    var DOOR_WORDS = { closed: ['Closed', 'secure'], open: ['Open', 'open'], opening: ['Opening…', 'moving'], closing: ['Closing…', 'moving'] };
    // ONE ENTRY'S STATE, said as it is: {word, kind} -- kind secure, open, jammed, moving or unknown. Nothing that is
    // not positively Locked or Closed is ever called so: an unknown, unavailable, jammed or moving entry is its own.
    function entryState(st, id) {
      if (!st) return { word: 'Unavailable', kind: 'unknown' };
      var s = st.state;
      if (s === 'unavailable') return { word: 'Unavailable', kind: 'unknown' };
      if (s === 'unknown' || s == null || s === '') return { word: 'Unknown', kind: 'unknown' };
      var w = (dom(id) === 'lock' ? LOCK_WORDS : DOOR_WORDS)[s];
      return w ? { word: w[0], kind: w[1] } : { word: String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' '), kind: 'unknown' };
    }
    // its glyph, the accessory tiles' own pair (hk-strategy.js favorites: a lock's, a garage door's)
    function entryIcon(id, kind) {
      if (dom(id) === 'lock') return kind === 'open' || kind === 'jammed' ? 'hk:lock-open-variant' : 'hk:lock';
      return kind === 'open' || kind === 'moving' ? 'hk:garage-open-variant' : 'hk:garage-variant';
    }
    // WHO IS IN IT: the block's own (members, in its order), else the house's locks and then its garage doors -- the
    // lists Security's other blocks read (kinds), else what the house has. An entry named but gone is still one: it
    // reads Unavailable and is never counted secured. (What a person may not view never reached the page.)
    function hvMembers(client, cfg) {
      var st = (client && client.states) || {};
      if (Array.isArray(cfg.members) && cfg.members.length) return cfg.members.slice();
      var locks = (kind('locks') || own(client, 'lock')).filter(function (id) { return dom(id) === 'lock' && st[id]; });
      var garage = (kind('garage') || own(client, 'cover').filter(function (id) { return DOORS[attr(st[id], 'device_class')]; }))
        .filter(function (id) { return dom(id) === 'cover' && st[id]; });
      return locks.concat(garage);
    }
    function hvAlarm(client, cfg) {
      return cfg.entity || setting('security.alarm', null) ||
        Object.keys((client && client.states) || {}).filter(function (id) { return dom(id) === 'alarm_control_panel'; })[0] || null;
    }
    // THE BLOCK'S FACTS: the alarm, each entry {id, name, word, kind, icon}, and the counts over ALL of them -- one
    // unlocked behind "N more" is still one unlocked
    function hvModel(client, cfg) {
      var st = (client && client.states) || {}, alarm = hvAlarm(client, cfg);
      var entries = hvMembers(client, cfg).map(function (id) {
        var s = entryState(st[id], id);
        return { id: id, name: st[id] ? friendly(client, id) : id.split('.')[1].replace(/_/g, ' '), word: s.word, kind: s.kind, icon: entryIcon(id, s.kind) };
      });
      var by = function (k) { return entries.filter(function (e) { return e.kind === k; }); };
      return { alarm: alarm, alarmSt: alarm ? st[alarm] || null : null, entries: entries,
               open: by('open').concat(by('jammed')), moving: by('moving'), unknown: by('unknown'), secure: by('secure') };
    }
    // ONE LINE (Small, and the alarm area's second line): Triggered first; then what is not secured; then what is
    // moving; then what cannot be read; else the alarm's own state (its arming too) -- or, with no alarm, the doors
    function hvLine(m) {
      var a = m.alarmSt, look = alarmLook(a);
      if (a && a.state === 'triggered') return 'Triggered';
      var one = function (list, tail) { return list.length === 1 ? list[0].name + ' ' + list[0].word.toLowerCase() : list.length + ' ' + tail; };
      if (m.open.length) return one(m.open, 'not secured');
      if (m.moving.length) return one(m.moving, 'moving');
      if (m.unknown.length) return one(m.unknown, 'unavailable');
      if (m.alarm) return look.word + (look.mode ? ' · ' + look.mode : '');
      return m.entries.length ? 'All doors secured' : 'Nothing to show';
    }
    // everything, for a screen reader: the alarm, then each kind of entry
    function hvSpoken(m) {
      var look = alarmLook(m.alarmSt), parts = [];
      if (m.alarm) parts.push('Alarm ' + look.word + (look.mode ? ' ' + look.mode : ''));
      m.entries.forEach(function (e) { parts.push(e.name + ' ' + e.word); });
      return 'Security. ' + parts.join(', ');
    }
    // THE SECURITY OVERVIEW: the block's own custom sheet (the editor's), else the alarm and every entry, as tiles
    function hvOverview(el) {
      var cfg = el._config || {}, D = window.hkDetail;
      if (!D || !D.openSheet) return false;
      var sheet = cfg.custom_sheet;
      if (!sheet) {
        var m = hvModel(el.client, cfg), ids = (m.alarm ? [m.alarm] : []).concat(m.entries.map(function (e) { return e.id; }));
        sheet = { v: 1, title: 'Security', entries: ids.map(function (id, i) { return { id: 's' + (i + 1), entity: id }; }) };
      }
      return D.openSheet(sheet, { title: 'Security', icon: 'mdi:shield-home', style: cfg.sheet_style, opener: el });
    }

    // SMALL: a key, as the Small blocks beside it -- in Home's look or HomeView's (the block's Tile Style)
    class HkGridSecurityKey extends HkGridKey {
      _sigOf() { var m = hvModel(this.client, this._config || {}); return JSON.stringify([hvLine(m), m.alarm, m.alarmSt && m.alarmSt.state, this.getAttribute('tile')]); }
      _look() {
        var m = hvModel(this.client, this._config || {}), look = alarmLook(m.alarmSt);
        return { name: 'Security', icon: m.alarm ? look.icon : 'mdi:shield-home', state: hvLine(m), color: look.color };
      }
      _render() {
        super._render();
        if (this._e) this._e.card.setAttribute('aria-label', hvSpoken(hvModel(this.client, this._config || {})) + '. Opens Security.');
      }
      _tap() { if ((this._config || {}).tap !== 'none' || this._config.custom_sheet) hvOverview(this); }
    }

    var HV_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.hv{box-sizing:border-box;height:100%;display:flex;gap:12px;padding:' + C.blockPad('14px') + ';overflow:hidden;' + C.plate('card') + ';color:' + v('ink') + ';',
      '  -webkit-tap-highlight-color:transparent;--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
      'hk-plate.hv[size=L]{flex-direction:column}',
      // (its entries on the shape inset, the alarm's words on the text's -- 2026-11-08)
      'hk-plate.hv{padding:' + C.blockPad('14px', true) + '}hk-plate.hv .al{margin:var(--hk-text-in,0px) 0 var(--hk-text-in,0px) var(--hk-text-in,0px)}hk-plate.hv[size=L] .al{margin:var(--hk-text-in,0px) var(--hk-text-in,0px) 0 var(--hk-text-in,0px)}',
      '[role=button]{cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '[role=button]:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      // THE ALARM'S AREA: the shield bare in its state's color (as the legacy block, and the Small keys), the state and
      // its one line. Wide, Compact and Extra Large: a column at the left; Large: a heading
      '.al{display:flex;flex-direction:column;justify-content:space-between;min-width:0;flex:0 0 auto;border-radius:' + (C.R.inner + 'px') + ';transition:transform ' + C.DUR.press + ' ease}',
      '.al:active{transform:scale(0.97)}',
      'hk-plate.hv[size=W] .al{flex-basis:42%}',
      'hk-plate.hv[size=C] .al,hk-plate.hv[size=XL] .al{flex-basis:calc((100% - 24px) / 3)}',
      'hk-plate.hv[size=L] .al{flex-direction:row;align-items:center;gap:12px;flex:none;min-height:44px}',
      '.al .wl{width:34px;height:34px;display:flex;flex:none}',
      '.al .wl hk-icon{width:100%;height:100%;--mdc-icon-size:100%;display:flex;color:var(--c,' + v('ink-2') + ')}',
      '.al .tx{display:flex;flex-direction:column;min-width:0}',
      '.al b{' + type('title') + ';font-weight:600;line-height:27px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--t,' + v('ink') + ')}',
      '.al small{' + type('body') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      'hk-plate.hv[size=L] .al .tx{flex:1}',
      'hk-plate.hv[size=L] .al .go{width:20px;height:20px;--mdc-icon-size:100%;display:flex;color:' + v('ink-2') + ';flex:none}',
      // THE ENTRIES: slots (Compact, Extra Large), rows (Large, and Wide's two groups), laid out by fit()
      '.ents{flex:1;min-width:0;min-height:0;display:grid;gap:8px;align-content:stretch}',
      'hk-plate.hv[size=C] .ents,hk-plate.hv[size=L] .ents,hk-plate.hv[size=W] .ents{grid-auto-rows:var(--row,54px);align-content:center}',
      // TALL: Large's heading, its state line free to take two lines; an entry with 92 px or more is the stack of HomeView's tile
      'hk-plate.hv .ents.stk .en{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px;text-align:center}',
      'hk-plate.hv[size=L] .ents.stk .en .gw{margin:0}hk-plate.hv[size=L] .ents.stk .en hk-icon{width:34px;height:34px}',
      'hk-plate.hv[size=L] .ents.stk .en .n{font-size:17px;line-height:22px}hk-plate.hv[size=L] .ents.stk .en .s{font-size:15px;line-height:20px;font-weight:400}',
      ':host([size=T]) hk-plate.hv .al small{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      // an entry: a tile of the accessory tiles' plate, resting or (not secured) the white of one that is on
      '.en{box-sizing:border-box;min-width:0;min-height:0;border-radius:' + (C.R.inner + 'px') + ';' + C.plate('tile') + ';display:flex;flex-direction:column;align-items:center;justify-content:center;',
      '  gap:2px;padding:8px 6px;text-align:center;transition:transform ' + C.DUR.press + ' ease,background-color .25s ease}',
      '.en:active{transform:scale(0.97)}',
      '.en hk-icon{width:30px;height:30px;--mdc-icon-size:100%;display:flex;flex:none;color:' + v('glyph') + '}',
      '.en:not(.ct) .gw{margin-bottom:4px}',
      '.en .n{' + type('body') + ';font-weight:600;line-height:19px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.en .s{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // a row (Large, Wide): the glyph, the name, the state at the right
      // A ROW (Large, Wide) is a Home pill's parts: the glyph at the left, the name over its state (15 / 600 on 16.5 px lines)
      'hk-plate.hv[size=C] .en,hk-plate.hv[size=L] .en,hk-plate.hv[size=W] .en{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto;align-content:center;column-gap:' + TILE.wellGap + 'px;row-gap:' + TILE.rowGap + 'px;padding:0 12.8px 0 ' + TILE.padL + 'px;text-align:left}',
      'hk-plate.hv[size=C] .en .gw,hk-plate.hv[size=L] .en .gw,hk-plate.hv[size=W] .en .gw{grid-row:1 / span 2;align-self:center}',
      'hk-plate.hv[size=C] .en .n,hk-plate.hv[size=C] .en .s,hk-plate.hv[size=L] .en .n,hk-plate.hv[size=W] .en .n,hk-plate.hv[size=L] .en .s,hk-plate.hv[size=W] .en .s{line-height:' + TILE.lineH + 'px}',
      'hk-plate.hv[size=C] .en .s,hk-plate.hv[size=L] .en .s,hk-plate.hv[size=W] .en .s{font-size:15px;font-weight:500}',
      'hk-plate.hv[size=C] .en hk-icon,hk-plate.hv[size=L] .en hk-icon,hk-plate.hv[size=W] .en hk-icon{width:24px;height:24px}hk-plate.hv[size=C] .en .gw,hk-plate.hv[size=L] .en .gw,hk-plate.hv[size=W] .en .gw{margin:0}',

      // NOT SECURED: the white plate, dark name, the state's ink on white, the glyph lit in its own color
      '.en.lit{background:#fff;--hk-glass-backdrop:none;-webkit-backdrop-filter:none;backdrop-filter:none}',
      '.en.lit .n{color:#000}.en.lit .s{color:' + v('ink-on-state') + '}.en.lit hk-icon{color:var(--lit)}',
      '.en.unk .s{color:' + v('ink-3') + '}',
      '.en.more hk-icon{color:' + v('ink-2') + '}',
      // EXTRA LARGE'S SLOTS ARE HOMEVIEW'S TILES (DESIGN.md "square cells", hkCards.centredTile): each slot a cell of its
      // own (hk-cell), the glyph bare in its box at 31 % (33 % where about square), sized by its ink, the name and its
      // one line centered under it -- the measured numbers, never this block's own
      '.en.ct{display:block;padding:0;container-type:size;container-name:hk-cell}',
      // (a slot under 150 px -- three rows of them on square cells -- is too short for those numbers: the same parts,
      // the glyph bare above the name and its one line, at the size it holds; the text never shrunk past a tile's)
      'hk-plate.hv[size=XL] .en:not(.ct) hk-icon{width:40px;height:40px}hk-plate.hv[size=XL] .en:not(.ct) .n{font-size:17px;line-height:22px}hk-plate.hv[size=XL] .en:not(.ct) .s{font-size:15px;line-height:20px}',
      '.en .gw{display:flex;align-items:center;justify-content:center}',
      C.centredTile({ host: ':host', plate: '.en.ct', lit: '.en.ct.lit', well: '.en.ct .gw', icon: '.en.ct .gw hk-icon', name: '.en.ct .n', sub: ['.en.ct .s'] }),
      '@media (prefers-reduced-motion:reduce){.en,.al{transition:none}.en:active,.al:active{transform:none}}',
      'hk-plate.hv{border-radius:var(--hk-block-radius, ' + C.M.radius + ')}',
      // DRAWN AGAIN WITH EXTRA LARGE (2026-11-08): a secured lock's glyph teal, a garage door's at rest; one not secured the white of a
      // lit tile, its glyph and state orange. Large: each a row of the block's width -- the name whole, the state at its right -- from
      // the top, under the alarm; Large and Tall end in the doors and windows' line (NOTICE_CSS); the rows a designed height, never grown
      'hk-plate.hv .ops{display:flex;justify-content:flex-start;gap:8px;flex:none;min-width:0;margin-top:auto}',
      'hk-plate.hv .op{box-sizing:border-box;flex:0 1 auto;min-width:0;max-width:100%;height:44px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 18px;border-radius:22px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      'hk-plate.hv .op hk-icon{width:20px;height:20px;--mdc-icon-size:100%;display:flex;flex:none}',
      'hk-plate.hv .op span{' + type('body') + ';font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      NOTICE_CSS, LM_CSS, 'hk-plate.hv .al .lm{top:0}',
      '.en.lk:not(.lit) hk-icon{color:var(--lk)}',
      '.en.lit hk-icon,.en.lit .s{color:' + v('warn') + '}.en.lit .s{font-weight:600}',
      // (its rows to the foot, their bottom the strip's -- the shield is the top's)
      'hk-plate.hv[size=W] .ents{align-content:end}',
      'hk-plate.hv[size=W] .lc{flex:0 0 42%;display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0}hk-plate.hv[size=W] .lc .al{flex:1 1 auto;min-height:0}',
      'hk-plate.hv[size=L]{gap:8px}hk-plate.hv[size=L] .ents{align-content:start}',
      'hk-plate.hv[size=L]:not(.tl) .en{grid-template-columns:26px minmax(0,1fr) auto;grid-template-rows:auto;column-gap:12px;padding:0 16px 0 14px}',
      'hk-plate.hv[size=L]:not(.tl) .en .gw{grid-row:auto}hk-plate.hv[size=L]:not(.tl) .en hk-icon{width:26px;height:26px}',
      'hk-plate.hv[size=L]:not(.tl) .en .n{grid-column:2;font-size:17px;line-height:22px}',
      'hk-plate.hv[size=L]:not(.tl) .en .s{grid-column:3;grid-row:1;font-size:15px;line-height:20px;text-align:right}',
      // (inside a square cell's block, its tiles concentric with it)
      '.en{border-radius:var(--hk-inner-radius,' + (C.R.inner + 'px') + ')}'
    ].join('');
    // a slot at its smallest: Compact's across, Extra Large's down; a row's height
    var HV_PILL_W = 150, HV_SLOT_H = 96, HV_ROW = 54, HV_GAP = 8;

    class HkGridSecurityHV extends HkBase {
      static get CSS() { return HV_CSS; }
      getCardSize() { return 2; }
      _size() { return sizeOf(this) || (this._config || {}).size || 'W'; }
      _sigOf() {
        var m = hvModel(this.client, this._config || {});
        return JSON.stringify([m.alarm, m.alarmSt && m.alarmSt.state, m.entries, this._size(), this._blockKey || '']);
      }
      _button(el, fn) {
        el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
        el.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
        el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); fn(); } });
      }
      _overview() { var c = this._config || {}; if (c.tap !== 'none' || c.custom_sheet) hvOverview(this); }
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
        var self = this, size = this._size(), m = hvModel(this.client, this._config || {});
        if (!this._built || this._shape !== size) {
          this._shape = size;
          // (TALL, 2026-11-07, the review, is Large's composition at 1 x 2: the plate says L; its heading has no chevron, the
          // block is too narrow for one beside "Disarmed")
          var alHtml = '<div class="al"><div class="wl"><hk-icon></hk-icon></div><div class="tx"><b></b><small></small></div>' +
            (size === 'L' ? '<button type="button" class="lm" hidden></button><hk-icon class="go" icon="mdi:chevron-right"></hk-icon>' : '') + '</div>';
          this._root.innerHTML = '<hk-plate class="hv' + (size === 'T' ? ' tl' : '') + '" data-hk-role="card" size="' + (size === 'T' ? 'L' : size) + '">' +
            // (Wide: the doors and windows' strip under the alarm's words, at the left -- 2026-11-08, the owner: so "the entity buttons
            // wouldn't get smaller")
            (size === 'W' ? '<div class="lc">' + alHtml + '<div class="ops"></div></div><div class="ents"></div>'
              : alHtml + '<div class="ents"></div>' + (size === 'L' || size === 'T' ? '<div class="ops"></div>' : '')) + '</hk-plate>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { card: q('.hv'), al: q('.al'), icon: q('.al .wl hk-icon'), big: q('.al b'), sub: q('.al small'), ents: q('.ents'), ops: q('.ops'), lm: q('.lm'), go: q('.go') };
          this._opsKey = null;
          this._button(this._e.al, function () { self._overview(); });
          this._entKey = null;
          this._built = true;
        }
        var e = this._e, look = alarmLook(m.alarmSt);
        e.icon.icon = m.alarm ? look.icon : 'mdi:shield-home';
        if (look.color && m.alarm) e.card.style.setProperty('--c', look.color); else e.card.style.removeProperty('--c');
        if (look.text) e.card.style.setProperty('--t', look.text); else e.card.style.removeProperty('--t');
        e.big.textContent = m.alarm ? look.word : 'Security';
        // (the alarm's mode, or -- with nothing to say of it -- the one line Small says)
        var line = hvLine(m);
        e.sub.textContent = m.alarm && line === look.word + (look.mode ? ' · ' + look.mode : '') ? (look.mode || '') : line;
        e.al.setAttribute('aria-label', hvSpoken(m) + '. Opens Security.');
        e.card.style.setProperty('--lit', (C.PALETTE.icon || {}).mint || C.ACCENTS.mint);
        e.card.style.setProperty('--lk', C.ACCENTS.teal);
        if (e.ops) {
          var dw = secRows(this.client).filter(function (r) { return !r.tile; }), ok = JSON.stringify(dw);
          if (ok !== this._opsKey) {
            this._opsKey = ok;
            var al = m.alarm, go = function () { if (!window.hkCards.openTarget(self, [{ page: 'doors-windows' }, al && { sheet: al }])) self._overview(); };
            doorsNotice(this, e.ops, dw, go, this._size() === 'W');
          }
        }
        // THE ENTRIES, built again only when who is in them or what they say changed; their order is the block's
        var items = size === 'W' ? this._groups(m) : m.entries;
        var key = JSON.stringify(items);
        if (key !== this._entKey) {
          this._entKey = key;
          e.ents.innerHTML = '';
          this._items = items;
          this._slots = items.map(function (it) { return self._slot(it); });
          this._more = this._slot({ more: true });
          this._slots.forEach(function (el) { e.ents.appendChild(el); });
          e.ents.appendChild(this._more);
        }
        this._fit();
      }
      // WIDE: two lines -- the locks together, the garage doors together (one: its own name) -- each its count
      _groups(m) {
        var out = [], locks = m.entries.filter(function (x) { return dom(x.id) === 'lock'; }), doors = m.entries.filter(function (x) { return dom(x.id) !== 'lock'; });
        var group = function (list, one, many, secureWord) {
          if (!list.length) return;
          if (list.length === 1) { out.push(list[0]); return; }
          var bad = list.filter(function (x) { return x.kind !== 'secure'; }), open = list.filter(function (x) { return x.kind === 'open' || x.kind === 'jammed'; });
          // (short, so the group's name keeps its room: "1 unlocked", "2 open", "1 unsure", "All locked")
          var word = !bad.length ? 'All ' + secureWord : open.length ? open.length + (list === locks ? ' unlocked' : ' open') : bad.length + ' unsure';
          out.push({ id: '', group: true, name: many, word: word, kind: open.length ? 'open' : bad.length ? 'unknown' : 'secure',
                     icon: list === locks ? entryIcon('lock.x', open.length ? 'open' : 'secure') : entryIcon('cover.x', open.length ? 'open' : 'secure') });
        };
        group(locks, 'Lock', 'Locks', 'locked');
        group(doors, 'Garage', 'Garage Doors', 'closed');
        return out;
      }
      _slot(it) {
        var self = this, d = document.createElement('div');
        d.className = 'en' + (it.more ? ' more' : it.kind === 'open' || it.kind === 'jammed' ? ' lit' : it.kind === 'unknown' ? ' unk' : '') + (!it.more && dom(it.id || 'lock.x') === 'lock' ? ' lk' : '');
        d.innerHTML = '<span class="gw"><hk-icon></hk-icon></span><span class="n"></span><span class="s"></span>';
        d.querySelector('hk-icon').icon = it.more ? 'mdi:dots-horizontal' : it.icon;
        d.querySelector('.n').textContent = it.more ? '' : it.name;
        d.querySelector('.s').textContent = it.more ? '' : it.word;
        if (!it.more) d.setAttribute('aria-label', it.name + ', ' + it.word + (it.group ? '. Opens Security.' : ''));
        this._button(d, function () {
          // an entry its own sheet (its controls: hold to unlock or open); a group or "N more" the overview
          if (it.more || it.group || !it.id) self._overview();
          else window.hkShell.moreInfo(it.id, self);
        });
        return d;
      }
      // HOW MANY FIT, from the room the entries have (the block's, measured): Compact a row of slots at least 84 px
      // wide; Extra Large two columns of slots at least 96 px tall; Large and Wide rows of 52 px. More than fit: the
      // last place is "N more", as big as the rest and a tap to the overview -- never a badge
      _fit() {
        var e = this._e;
        if (!e || !this._slots || !this._more) return;
        var size = this._size(), W = e.ents.clientWidth, H = e.ents.clientHeight;
        if (!W || !H) return;
        var cols = 1, rows = 1;
        // (Compact: Home pills, as many to a row as are 150 px wide, as many rows as are 54 tall -- 2 x 2 in its two cells)
        if (size === 'C') { cols = Math.max(1, Math.floor((W + HV_GAP) / (HV_PILL_W + HV_GAP))); rows = Math.max(1, Math.floor((H + HV_GAP) / (HV_ROW + HV_GAP))); }
        else if (size === 'XL') { cols = 2; rows = Math.max(1, Math.floor((H + HV_GAP) / (HV_SLOT_H + HV_GAP))); }
        else rows = Math.max(1, Math.floor((H + HV_GAP) / ((size === 'L' || size === 'T' ? SEC_LIST_ROW : HV_ROW) + HV_GAP)));
        var n = this._slots.length, cap = cols * rows, cut = n > cap, show = cut ? cap - 1 : n;
        // (Large: "+N more" in the heading's line, where the chevron was -- as Extra Large's and an Accessory Group's -- every row an entry)
        var inHead = size === 'L' && !!e.lm;
        if (inHead) {
          show = Math.min(n, cap); e.lm.hidden = !cut; e.lm.textContent = '+' + (n - show) + ' more';
          if (e.go) e.go.style.display = cut ? 'none' : '';
        }
        // (a few slots share the room evenly; Compact's never more than the slots there are)
        var useCols = cols;
        e.ents.style.gridTemplateColumns = 'repeat(' + useCols + ',minmax(0,1fr))';
        e.ents.style.gridTemplateRows = size === 'XL' || size === 'C' ? 'repeat(' + rows + ',minmax(0,1fr))' : '';
        // (the rows share what the block leaves them, 54 to 64 each: what is shown, or the shown and "N more", fills the band)
        if (size === 'L' || size === 'W' || size === 'T') {
          var used = cut ? rows : Math.min(n, rows), raw = Math.floor((H - (used - 1) * HV_GAP) / Math.max(1, used));
          // (Tall with 92 px or more to each: the entry is HomeView's stack -- the glyph over the name over its state -- to 100)
          var stk = size === 'T' && raw >= 92;
          e.ents.classList.toggle('stk', stk);
          // (Large's and Tall's rows a designed height from the top since 2026-11-08 -- Large's one line 56, Tall's two 54; Wide's still share its band)
          if (size === 'L' || (size === 'T' && cut)) { stk = false; e.ents.classList.remove('stk'); }
          e.ents.style.setProperty('--row', (size === 'L' || (size === 'T' && !stk) ? listRow(H, n).rh : stk ? Math.min(100, raw) : size === 'T' ? HV_ROW : Math.max(HV_ROW, Math.min(64, raw))) + 'px');
        }
        var keep = size === 'L' || size === 'T' ? shownFirst(this._items || [], show) : null;
        this._slots.forEach(function (el, i) { el.style.display = (keep ? keep[i] : i < show) ? '' : 'none'; });
        // HomeView's measured tile where a slot is 150 px tall or more (its own px: the block's measure, not the screen's)
        var tall = size === 'XL' && (H - (rows - 1) * HV_GAP) / rows >= 150;
        this._slots.concat([this._more]).forEach(function (el) {
          el.classList.toggle('ct', tall);
          var ic = el.querySelector('hk-icon');
          if (tall) ic.setAttribute('ink', String(C.TILE.centred.ink)); else ic.removeAttribute('ink');
        });
        this._more.style.display = cut && !inHead ? '' : 'none';
        if (cut) {
          var t = (n - show) + ' more';
          this._more.querySelector('.n').textContent = t;
          var hidden = this._slots.filter(function (el, i) { return keep ? !keep[i] : i >= show; }).map(function (el) { return el.getAttribute('aria-label'); }).filter(Boolean);
          this._more.setAttribute('aria-label', t + ': ' + hidden.join('; ') + '. Opens Security.');
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
    K.HkGridSecurityHV = HkGridSecurityHV; K.HkGridSecurityKey = HkGridSecurityKey; K.secEntryState = entryState;
    K.secHvModel = hvModel; K.secHvLine = hvLine;
  };
})();
