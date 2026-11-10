// @ts-check
// hk-alert.js -- the Alert block (`alert` in hk-grid-catalog.js; docs/phase11/ALERT.md), 2026-11-10.
//
//   hk-grid-alert-card   One thing that needs a look, said plainly: a headline ("Garage Still Open"), a line under it (its own
//                   words, and how long it has been so -- "Open for 23 min", "12 min ago"), a camera's still where one is
//                   named, and ONE prominent action -- the accessory's own tile tap, so a garage door or a lock opens its
//                   own controls (where it asks first) and the house's permissions are the accessory's. Made for Show When:
//                   a block's rule shows it in the block's own place while its conditions hold, and the block's own card
//                   (House Status, say) comes back when they stop -- the conditional block's work (hk-layout.js), not this
//                   file's. S, W, T, L and XL, on square cells (196 x 196) and tile cells (196 x 150).
//
// NOTHING STRETCHES (DESIGN.md "HomeView (Tall) on the Home Grid"): the headline upper left, the words at their sizes, the
// action a 44 px pill (48 on Large and Extra Large), and the room left given to the one element made to be big: the picture.
// A camera that is missing, unavailable or has no still drops its picture, and the block is the words and the action alone --
// both still there and working.
//
// THE PURE PART is first and has no DOM (window.hkAlert.lib): tests/test_alert_card.py runs it in node.
(function () {
  'use strict';
  if (window.hkAlert) return;                          // double-load guard

  // ======================================================================== pure
  var MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  // HOW LONG, in words: "less than a minute", "23 min", "1 hr 5 min", "2 days 3 hr"
  function dur(ms) {
    var m = Math.floor(Math.max(0, ms) / MIN);
    if (m < 1) return 'less than a minute';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (h < 24) return h + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
    return d + (d === 1 ? ' day' : ' days') + (h % 24 ? ' ' + (h % 24) + ' hr' : '');
  }
  // A STATE THAT IS A CONDITION, said with "for" ("Open for 23 min"); any other state is a moment ("12 min ago")
  var FOR = { open: 'Open', opening: 'Opening', closing: 'Closing', unlocked: 'Unlocked', jammed: 'Jammed', on: 'On', playing: 'Playing',
              paused: 'Paused', cleaning: 'Cleaning', heating: 'Heating', cooling: 'Cooling', home: 'Home', not_home: 'Away', triggered: 'Triggered' };
  var OPEN_CLASSES = { door: 1, garage_door: 1, window: 1, opening: 1 };
  function forWord(id, st) {
    var d = String(id || '').split('.')[0], s = st && st.state, dc = st && st.attributes && st.attributes.device_class;
    if (d === 'binary_sensor' && s === 'on') return OPEN_CLASSES[dc] ? 'Open' : dc === 'moisture' ? 'Wet' : dc === 'motion' || dc === 'occupancy' ? 'Detected' : 'On';
    if (d === 'binary_sensor' || d === 'sensor' || d === 'input_select' || d === 'select') return null;
    return FOR[s] || null;
  }
  // HOW LONG IT HAS BEEN SO: the entity's last_changed -- the moment it came into the state it is in (a cover's: when it became
  // open) -- to now. null when there is no telling: no entity, unavailable, unknown, an unreadable time. (Home Assistant restarting
  // starts last_changed again: the line then counts from the restart, never from a guess.)
  function since(id, st, now) {
    if (!st || st.state === 'unavailable' || st.state === 'unknown') return null;
    var t = Date.parse(st.last_changed || st.last_updated || '');
    if (!isFinite(t)) return null;
    var ms = Math.max(0, (now == null ? Date.now() : now) - t), word = forWord(id, st);
    if (word) return word + ' for ' + dur(ms);
    return ms < MIN ? 'Just now' : dur(ms) + ' ago';
  }
  // THE LINE UNDER THE HEADLINE: the block's own words, and how long, one after the other
  function subLine(text, elapsed) { return [text, elapsed].filter(Boolean).join(' · '); }

  // THE ACTION'S WORDS, from what the accessory's tile does with a tap (spec, its action) and the state it is in: [short, long].
  // `never`: the house never does it in one tap (hk-base.js neverToggles: a door, a lock, the alarm, the water, the heat) -- the
  // tap opens its controls, which ask first; the words still say what you are there to do.
  var RUNS = { scene: 1, script: 1, button: 1, input_button: 1, automation: 1 };
  function verb(id, st, spec, never) {
    var d = String(id || '').split('.')[0], s = st ? st.state : '', a = (st && st.attributes) || {}, name = a.friendly_name || id;
    var two = function (w) { return [w, w + ' ' + name]; };
    if (d === 'cover') return two(s === 'closed' || s === 'closing' ? 'Open' : 'Close');
    if (d === 'lock') return two(s === 'locked' || s === 'locking' ? 'Unlock' : 'Lock');
    if (d === 'alarm_control_panel') return two(s === 'disarmed' ? 'Arm' : 'Disarm');
    if (d === 'valve') return two(s === 'open' || s === 'opening' ? 'Close' : 'Open');
    if (RUNS[d]) return ['Run', name];
    if (d === 'camera') return ['View', 'View ' + name];
    if (d === 'media_player') return two(s === 'playing' ? 'Pause' : 'Play');
    if (spec && spec.action === 'toggle' && !never) return two(s === 'on' ? 'Turn Off' : 'Turn On');
    return ['Details', name];
  }
  // WHAT A TAP ON THE ACTION DOES: the accessory's tile's own -- its glyph's action where its tile has one (a light's toggle, a
  // button's press), else the tile's tap -- or its sheet. `tile`: hkStrategy.tileFor's config for it.
  function tapOf(tile) {
    var t = tile || {};
    return t.icon_tap_action || t.tap_action || { action: 'more-info' };
  }

  // HOW A BLOCK IS COMPOSED, iw x ih inside its inset: {mode, pic: [w, h] | null, pill (its height), col (the words' width)}
  //   S   no picture: the glyph's disc, the headline at the foot; a picture: the still to the block's corners, the words on it
  //   W   the still at the left (4:3, at most half), the words and the pill beside it
  //   T   the glyph and the headline, the line under it, the still (square at most), the pill at the foot: STACKED
  //   L   the glyph beside the headline, the still the block's width (the room the words and the pill leave, 16:9 at least
  //       and 4:3 at most), the pill the block's width at the foot
  //   XL  the still at the left (to 62 % of the width), the words and the pill in a column beside it
  // Without a picture every size is the words over the pill. HEAD: the words' fixed heights (headline lines, the line under it)
  // (L's headline is one line on a tile cell's 282 px, two on a square's: the picture keeps a shape worth looking at)
  var GAP = 12, PILL = { S: 0, W: 40, T: 44, L: 48, XL: 48 };
  var HEAD = { T: 32 + 8 + 44 + 2 + 34, L: 56 + 2 + 19, L1: 28 + 2 + 19 };   // T: disc, gap, 2 x 22 headline, gap, 2 x 17; L: 2 x 28, gap, 19
  function plan(size, iw, ih, hasPic, hasAct, tile) {
    var pill = hasAct && PILL[size] != null ? PILL[size] : 0, out = { mode: size, pic: null, pill: pill, col: iw };
    if (!hasPic) return out;
    var foot = pill ? pill + GAP : 0;
    if (size === 'S') { out.pic = [iw, ih]; return out; }
    if (size === 'W') {
      var ww = Math.round(Math.min(ih * 4 / 3, iw * 0.5));
      out.pic = [ww, ih]; out.col = iw - ww - 14; return out;
    }
    if (size === 'T') {
      var th = Math.floor(Math.min(iw, ih - HEAD.T - GAP - foot));
      if (th < 64) return out;                           // (no room for a picture worth showing: the words alone)
      out.pic = [iw, th]; return out;
    }
    if (size === 'L') {
      var lh = Math.floor(Math.min(iw * 0.75, ih - (tile ? HEAD.L1 : HEAD.L) - GAP - foot));
      if (lh < iw / 3) return out;
      out.pic = [iw, lh]; return out;
    }
    var xw = Math.round(Math.min(ih * 16 / 9, iw * 0.62));
    out.pic = [xw, ih]; out.col = iw - xw - 18;
    return out;
  }
  // A CAMERA THAT CAN SHOW A STILL: there, not unavailable, with a picture to fetch
  function camOk(st) {
    return !!(st && st.state !== 'unavailable' && st.state !== 'unknown' && st.attributes && st.attributes.entity_picture);
  }
  // THE HEADLINE when the block was given none: what the accessory is and the state it is in ("Garage Door Open"), else "Alert"
  function headlineOf(o, states, stateWord) {
    if (o.title) return o.title;
    var id = o.control || o.since, st = id && states ? states[id] : null;
    if (!st) return 'Alert';
    var name = (st.attributes && st.attributes.friendly_name) || id, w = stateWord ? stateWord(st, id) : st.state;
    return w ? name + ' ' + w : name;
  }

  var LIB = { dur: dur, since: since, forWord: forWord, subLine: subLine, verb: verb, tapOf: tapOf, plan: plan, camOk: camOk,
              headlineOf: headlineOf, PILL: PILL, HEAD: HEAD, GAP: GAP };
  window.hkAlert = { version: '1.0.0', lib: LIB };

  // ======================================================================== the card
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-alert] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkAlert.Card) return;
  var HkBase = C.HkBase, register = C.register, esc = C.esc, v = C.v, T = C.TYPE;
  function type(role) {
    var t = T[role];
    return 'font-size:' + t.size + 'px;font-weight:' + t.weight + (t.track ? ';letter-spacing:' + t.track : '');
  }
  var SIZES = /^(S|W|T|L|XL)$/;
  // the block in px (its cells), else a square cell's -- as the other blocks read it
  var SQ_BLOCK = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
  function accent(name) {
    var A = C.ACCENTS || {};
    if (name && /^#[0-9a-f]{6}$/i.test(name)) return name;
    return A[name] || A.orange || '#ff9f0a';
  }

  var CSS = [
    ':host{display:block;height:100%}',
    'hk-plate.al{box-sizing:border-box;height:100%;position:relative;display:flex;gap:14px;overflow:hidden;padding:' + C.blockPad('18px') + ';' +
      C.plate('card') + ';color:' + v('ink') + ';-webkit-tap-highlight-color:transparent;cursor:pointer}',
    'hk-plate.al.XL{gap:18px}',
    'hk-plate.al.T,hk-plate.al.L,hk-plate.al.np{flex-direction:column;gap:0}',
    // THE PICTURE: a camera's still at its planned size, to the inner radius; its tap is the camera's sheet (the still's own)
    '.pic{position:relative;flex:none;border-radius:var(--hk-inner-radius,12px);overflow:hidden;background:#0b0d12}',
    '.pic>hk-camera-mosaic-card{display:block}',
    'hk-plate.T .pic,hk-plate.L .pic{margin-top:' + GAP + 'px}',
    // THE WORDS: the glyph on its disc, the headline (its lines kept), the line under it
    '.col{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column}',
    'hk-plate.T .col,hk-plate.L .col{flex:none}',
    '.hd{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0}',
    'hk-plate.L .hd,hk-plate.W .hd{flex-direction:row;align-items:flex-start;gap:12px}',
    '.hw{min-width:0;flex:1 1 auto}',
    '.dk{flex:none;display:grid;place-items:center;border-radius:50%;color:#fff}',
    '.dk>hk-icon,.dk>hk-state-icon{display:flex;--mdc-icon-size:100%}',
    '.hl{' + type('headline') + ';line-height:22px;max-height:44px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;',
    '  overflow-wrap:anywhere;text-shadow:' + v('glow') + '}',
    'hk-plate.L .hl,hk-plate.XL .hl,hk-plate.np:not(.S):not(.W) .hl{' + type('title') + ';line-height:28px;max-height:56px}',
    'hk-plate.XL .hl,hk-plate.np.L .hl{max-height:84px;-webkit-line-clamp:3}',
    'hk-plate.np.XL .hl{font-size:34px;line-height:40px;max-height:120px}',
    '.sb{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;',
    '  -webkit-line-clamp:2;overflow-wrap:anywhere;text-shadow:' + v('glow') + '}',
    'hk-plate.L .sb,hk-plate.XL .sb{' + type('body') + ';line-height:19px}',
    'hk-plate.L:not(.np) .sb{-webkit-line-clamp:1;white-space:nowrap;text-overflow:ellipsis;display:block}',
    'hk-plate.tc.L.hp .hl{max-height:28px;-webkit-line-clamp:1}',
    'hk-plate.XL .sb{-webkit-line-clamp:3}',
    'hk-plate.tc.np.XL .hl{max-height:80px;-webkit-line-clamp:2}',
    'hk-plate.tc.W .sb,hk-plate.tc.S .sb{-webkit-line-clamp:1}',
    '.sb:empty{display:none}',
    // THE ACTION: one prominent pill -- the white plate of a lit tile, the accessory's glyph in the alert's color, its verb in the
    // first ink -- 44 px tall (48 on Large and Extra Large; 40 on Wide, the standard pill's), its reach 8 px round it
    '.go{all:unset;box-sizing:border-box;position:relative;flex:none;display:flex;align-items:center;justify-content:center;gap:8px;height:var(--ph,44px);',
    '  padding:0 18px;border-radius:999px;background:#fff;color:rgba(0,0,0,0.88);' + type('body') + ';font-weight:600;white-space:nowrap;cursor:pointer;',
    '  box-shadow:0 1px 3px rgba(0,0,0,0.18);-webkit-tap-highlight-color:transparent;transition:transform ' + C.DUR.press + ' ease,filter ' + C.DUR.press + ' ease;margin-top:auto}',
    '.go::after{content:"";position:absolute;inset:-6px -4px}',
    '.go:active{transform:scale(0.97);filter:brightness(0.92)}',
    '.go:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
    '.go .gw{min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '.go hk-icon,.go hk-state-icon{flex:none;width:20px;height:20px;--mdc-icon-size:20px;display:flex}',
    'hk-plate.W .go{align-self:flex-start;padding:0 16px}',
    'hk-plate.T .go,hk-plate.L .go,hk-plate.XL .go,hk-plate.np .go{align-self:stretch}',
    'hk-plate.np.W .go{align-self:flex-start}',
    // (the room the words and the picture leave: under the picture, before the pill -- never a stretched part)
    '.sp{flex:1 1 0;min-height:' + GAP + 'px}',
    // SMALL ON ITS PICTURE: the still to the block's corners, a scrim under the words, white words
    'hk-plate.S.hp{padding:0}',
    'hk-plate.S.hp .pic{position:absolute;inset:0;border-radius:inherit}',
    'hk-plate.S.hp .scr{position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(180deg,rgba(0,0,0,0) 38%,rgba(0,0,0,0.72))}',
    'hk-plate.S.hp .col{position:absolute;z-index:2;left:0;right:0;bottom:0;padding:' + C.blockPad('14px') + ';pointer-events:none;justify-content:flex-end;color:#fff}',
    'hk-plate.S.hp .hl{text-shadow:0 1px 2px rgba(0,0,0,0.5)}hk-plate.S.hp .sb{color:rgba(255,255,255,0.82);-webkit-line-clamp:1}',
    'hk-plate.S:not(.hp) .hl{margin-top:auto}',
    '@media (prefers-reduced-motion:reduce){.go,.go:active{transition:none;transform:none}}'
  ].join('');

  class HkAlertCard extends HkBase {
    static get CSS() { return CSS; }
    getCardSize() { return 4; }
    setConfig(config) {
      var c = Object.assign({}, config || {});
      // (the action's accessory is the card's `entity`, so HkBase's _act -- its confirmation, a door's never-one-tap -- is the tile's own)
      if (c.control) c.entity = c.control; else delete c.entity;
      this._layoutKey = '';
      super.setConfig(c);
    }
    _size() {
      var s = (this.getAttribute && this.getAttribute('size')) || (this._config || {}).size;
      return SIZES.test(s || '') ? s : 'L';
    }
    _states() { return (this.client && this.client.states) || {}; }
    _s(id) { return id ? this._states()[id] || null : null; }
    // the block inside its inset (the grid's --hk-pad-*), its cell shape
    _box(size) {
      this._watchBlock();
      var b = this._block(), d = SQ_BLOCK[size] || SQ_BLOCK.L, cs = null, pad = {};
      try { cs = getComputedStyle(/** @type {any} */ (this)); } catch (e) { cs = null; }
      ['t', 'r', 'b', 'l'].forEach(function (k) { var n = cs ? parseFloat(cs.getPropertyValue('--hk-pad-' + k)) : NaN; pad[k] = n >= 0 ? n : 18; });
      var w = b ? b.w : d[0], h = b ? b.h : d[1];
      // a tile cell's block: 150 px a row where a square's is 196 (the House Status rule)
      var tile = (size === 'S' || size === 'W') ? h < 180 : h < 370;
      return { w: w, h: h, iw: Math.max(0, w - pad.l - pad.r), ih: Math.max(0, h - pad.t - pad.b), tile: tile };
    }
    // WHAT THE ACTION DOES: the accessory's tile's tap, read from the tile the house would draw for it
    _tile() {
      var o = this._config || {}, S = window.hkStrategy, c = this.client;
      if (!o.control || !this._s(o.control)) return null;
      try { return S && S.tileFor && c ? S.tileFor(c, o.control, null) : { entity: o.control }; } catch (e) { return { entity: o.control }; }
    }
    _model(now) {
      var o = this._config || {}, states = this._states(), L = LIB;
      var cam = o.camera && camOk(states[o.camera]) ? o.camera : null;
      var tile = this._tile(), spec = tile ? tapOf(tile) : null, ctl = tile ? o.control : null;
      var never = !!(ctl && C.neverToggles && C.neverToggles(this.client, ctl));
      var words = ctl ? L.verb(ctl, states[ctl], spec, never) : null;
      var elapsed = o.since ? L.since(o.since, states[o.since], now) : null;
      var stateWord = function (st, id) { return L.forWord(id, st) || String(st.state || '').replace(/_/g, ' ').replace(/\b[a-z]/g, function (x) { return x.toUpperCase(); }); };
      return { title: L.headlineOf(o, states, stateWord), sub: L.subLine(o.text, elapsed), cam: cam, ctl: ctl, spec: spec, never: never,
               words: words, color: accent(o.color), icon: o.icon || null, glyphOf: o.icon ? null : (o.control || o.since || null) };
    }
    // A TAP ON THE PLATE (not the action, not the picture): the accessory's sheet, else the camera's, else the one it counts from.
    // Small has no pill: the plate is its action.
    _tapTarget() {
      var self = this, o = this._config || {}, m = this._last;
      if (this._size() === 'S' && m && m.ctl) return [{ run: function () { self._go(); } }];
      var out = [];
      [o.control, m && m.cam, o.since].forEach(function (id) { if (id && self._s(id)) out.push({ sheet: id }); });
      return out;
    }
    _go() {
      var m = this._last;
      if (!m || !m.ctl) return;
      this._act(m.spec, true);
    }
    _sigOf() {
      var o = this._config || {}, s = this._states(), out = this._size() + (this._blockKey || '') + '|' + Math.floor(Date.now() / 30000) + '|';
      [o.control, o.since, o.camera].forEach(function (id) {
        var st = id ? s[id] : null;
        out += (id || '') + '=' + (st ? st.state + '@' + (st.last_changed || '') + (st.attributes && st.attributes.entity_picture ? 'p' : '') : 'x') + ';';
      });
      return out;
    }
    connectedCallback() {
      super.connectedCallback();
      var self = this;
      // the line under the headline counts on: "Open for 23 min" moves each minute (the signature buckets by half minutes)
      clearInterval(this._tick);
      this._tick = setInterval(function () { if ((self._config || {}).since) self.redraw(); }, 30000);
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      clearInterval(this._tick); this._tick = null;
    }
    _glyph(m, px, color) {
      var st = 'width:' + px + 'px;height:' + px + 'px;--mdc-icon-size:' + px + 'px' + (color ? ';color:' + color : '');
      if (m.icon || !m.glyphOf) return '<hk-icon icon="' + esc(m.icon || 'mdi:alert-circle') + '" style="' + st + '" aria-hidden="true"></hk-icon>';
      return '<hk-state-icon data-e="' + esc(m.glyphOf) + '" style="' + st + '" aria-hidden="true"></hk-state-icon>';
    }
    _picture(pic) {
      var id = this._last.cam, key = id + '|' + pic[0] + 'x' + pic[1];
      if (!this._kid || this._kidKey !== key) {
        if (this._kid && this._kid.parentNode) this._kid.parentNode.removeChild(this._kid);
        this._kidKey = key;
        this._kid = C.create({ type: 'custom:hk-camera-mosaic-card', own_cameras: true, cameras: [{ entity: id }], height: pic[1], fit_w: pic[0], fit_h: pic[1],
                               seam: 0, snapshot_cap: '480x270', name_tag: 'hide', radius: 'var(--hk-inner-radius,12px)', shadow: 'none' });
        if (this._kid) { this._kid.setAttribute('size', this._size() === 'S' ? 'S' : 'L'); this._kid.style.setProperty('--hk-block-pad', '12px'); }
      }
      if (this._kid && this.client && this._kid.hkSetClient) this._kid.hkSetClient(this.client);
      var at = this._root.querySelector('.pic');
      if (this._kid && at && this._kid.parentNode !== at) at.appendChild(this._kid);
    }
    _dropPicture() {
      if (this._kid && this._kid.parentNode) this._kid.parentNode.removeChild(this._kid);
      this._kid = null; this._kidKey = '';
    }
    _render() {
      var self = this, size = this._size(), m = this._model(), box = this._box(size);
      this._last = m;
      var P = plan(size, box.iw, box.ih, !!m.cam, !!m.ctl, box.tile);
      if (size === 'S' && P.pic) P.pic = [box.w, box.h];          // (Small's still is the whole block, to its corners)
      var key = [size, box.tile ? 't' : 's', P.pic ? P.pic.join('x') : '-', P.pill, m.cam || '', m.ctl ? 1 : 0].join('|');
      if (key !== this._layoutKey) {
        this._layoutKey = key;
        var disc = size === 'L' ? 40 : size === 'XL' ? 44 : 32, np = !P.pic;
        if (size === 'W') disc = 36;
        if (np && (size === 'L' || size === 'XL')) disc = 52;
        // (the picture's tap is its own -- the camera's sheet -- so the plate never also answers it: data-notap. Small with an
        // action is one button: its picture is the plate's, and the tap the action's)
        var picHtml = P.pic ? '<div class="pic"' + (size === 'S' && m.ctl ? '' : ' data-notap') + ' style="width:' + P.pic[0] + 'px;height:' + P.pic[1] + 'px' +
          (size === 'S' && m.ctl ? ';pointer-events:none' : '') + '"></div>' : '';
        var dk = '<span class="dk" style="width:' + disc + 'px;height:' + disc + 'px"></span>';
        // (Large and Wide: the disc beside the headline and its line; Wide beside a picture has no disc -- the picture says it)
        var side = size === 'L' || size === 'W';
        var head = '<div class="hd">' + ((size === 'S' || size === 'W') && P.pic ? '' : dk) + '<div class="hw"><div class="hl"></div>' + (side ? '<div class="sb"></div>' : '') + '</div></div>';
        var sub = side ? '' : '<div class="sb"></div>';
        var go = P.pill ? '<button type="button" class="go" style="--ph:' + P.pill + 'px"><span class="gi"></span><span class="gw"></span></button>' : '';
        var cls = 'al ' + size + (box.tile ? ' tc' : ' sq') + (P.pic ? ' hp' : ' np');
        var body;
        if (size === 'S') body = P.pic ? picHtml + '<div class="scr"></div><div class="col"><div class="hl"></div><div class="sb"></div></div>' : '<div class="col">' + head + sub + '</div>';
        else if (size === 'W' || size === 'XL') body = picHtml + '<div class="col">' + head + sub + '<div class="sp"></div>' + go + '</div>';
        else body = '<div class="col">' + head + sub + '</div>' + picHtml + '<div class="sp"></div>' + go;
        this._root.innerHTML = '<hk-plate class="' + cls + '" data-hk-role="card" role="group">' + body + '</hk-plate>';
        this._plate = this._root.querySelector('hk-plate');
        var b = this._root.querySelector('.go');
        if (b) b.addEventListener('click', function (e) { e.stopPropagation(); self._go(); });
        if (!P.pic) this._dropPicture();
      }
      if (P.pic) this._picture(P.pic);
      // THE WORDS, put in place (the picture is never rebuilt for a new minute)
      var pl = this._plate, q = function (s) { return pl.querySelector(s); };
      q('.hl').textContent = m.title;
      var sb = q('.sb');
      if (sb) sb.textContent = m.sub;
      var dkEl = q('.dk');
      if (dkEl) {
        var px = parseFloat(dkEl.style.width) || 32;
        dkEl.style.background = m.color;
        C.morph(dkEl, this._glyph(m, Math.round(px * 0.58), '#fff'));
      }
      var pill = q('.go');
      if (pill && m.words) {
        var long = size === 'L' || size === 'XL' || (size === 'W' && !P.pic);
        pill.querySelector('.gw').textContent = long ? m.words[1] : m.words[0];
        C.morph(pill.querySelector('.gi'), this._glyph(m, 20, m.color));
        pill.setAttribute('aria-label', m.words[1] + (m.never ? ': opens its controls' : ''));
      }
      pl.setAttribute('aria-label', [m.title, m.sub].filter(Boolean).join(', '));
      var cl = this.client;
      if (cl && cl.bindStateIcon) Array.prototype.forEach.call(pl.querySelectorAll('hk-state-icon[data-e]'), function (el) {
        var st = cl.states && cl.states[el.getAttribute('data-e')];
        if (st && el.__hkSt !== st) { el.__hkSt = st; cl.bindStateIcon(el, st); }
      });
    }
  }

  register('hk-grid-alert-card', HkAlertCard, 'HK Alert',
    'One thing that needs a look: a headline, how long, a camera’s still and one action. Made for a Home Grid block’s Show When.');
  if (C.unlisted) C.unlisted('hk-grid-alert-card');
  window.hkAlert.Card = HkAlertCard;
  });
})();
