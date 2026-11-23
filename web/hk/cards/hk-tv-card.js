// @ts-check
// hk-tv-card.js -- the TV block (`tv` in hk-grid-catalog.js; docs/phase23/TV.md), 2026-11-10.
//
//   hk-grid-tv-card   A room's TV and its player as one (hk-tv.js reads them): what's on, the remote, the volume and the apps to tap.
//                     S, W, T, L and XL, on square cells (196 x 196) and tile cells (196 x 150).
//
// THE REMOTE FIRST (the owner, 2026-11-21, mockup B of https://claude.ai/artifact/SEJXCoiRboFSWHhQAvrEVu: "I'm not too fond of the
// design ... especially since most TV apps don't display artwork"). The black screen box is gone: the open app's own icon is the
// picture (artwork, when sent, fills that square with the app on its corner). Small: the app, play/pause or power, what's on. Wide: the
// app big over what's on, the arrow pad on the right with Back and Home in its lower corners. Tall: what's on in a line, the pad, Back,
// Home and mute. Large: what's on and power, Back / Home / play beside the pad, a volume rocker, a row of apps. Extra Large: what's on
// and ten apps beside the whole remote. A tap on the plate opens the TV sheet (hk-sheet-tv.js); an app brings itself up from wherever
// the room is (hkTv.open).
(function () {
  'use strict';
  if (window.hkTvCard) return;                    // double-load guard
  window.hkTvCard = { version: '1.0.0' };

  function whenBase(/** @type {(C: any) => void} */ fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-tv-card] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkTvCard.Card) return;
  var HkBase = C.HkBase, register = C.register, esc = C.esc, v = C.v;
  var SIZES = /^(S|W|T|L|XL)$/;
  var SQ_BLOCK = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
  var P = {
    up: '<path d="M12 7.5l7 7-1.6 1.6-5.4-5.4-5.4 5.4L5 14.5z"/>',
    back: '<path d="M14.5 5l1.6 1.6L10.7 12l5.4 5.4-1.6 1.6-7-7z"/>',
    home: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 14.5zM8 19h8v1.5H8z"/>',
    pp: '<path d="M3 5.5v13l9-6.5zM14 5h2.8v14H14zM18.6 5h2.8v14h-2.8z"/>',
    play: '<path d="M7 4.6v14.8c0 1 1.1 1.6 2 1.1l11.6-7.4c.8-.5.8-1.7 0-2.2L9 3.5c-.9-.5-2 .1-2 1.1Z"/>',
    pause: '<rect x="6" y="4.5" width="4.4" height="15" rx="1.6"/><rect x="13.6" y="4.5" width="4.4" height="15" rx="1.6"/>',
    power: '<path d="M11 3h2v9h-2zM7.05 6.05l1.42 1.42A6 6 0 1 0 15.53 7.47l1.42-1.42A8 8 0 1 1 7.05 6.05z"/>',
    minus: '<rect x="5" y="11" width="14" height="2.2" rx="1.1"/>',
    plus: '<rect x="5" y="11" width="14" height="2.2" rx="1.1"/><rect x="10.9" y="5" width="2.2" height="14" rx="1.1"/>',
    remote: '<path d="M9 2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm3 3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zm-1.5 9v2h3v-2zm0 3.5v2h3v-2z"/>',
    spk: '<path d="M4 9h4l5-4v14l-5-4H4z"/>',
    spk2: '<path d="M3 9h4l5-4v14l-5-4H3zM15.5 8.5a5 5 0 0 1 0 7l-1.2-1.2a3.3 3.3 0 0 0 0-4.6zM18 6a8.5 8.5 0 0 1 0 12l-1.2-1.2a6.8 6.8 0 0 0 0-9.6z"/>',
    mute: '<path d="M3 9h4l5-4v14l-5-4H3zM15.3 9.4l1.3-1.3 2.4 2.4 2.4-2.4 1.3 1.3-2.4 2.4 2.4 2.4-1.3 1.3-2.4-2.4-2.4 2.4-1.3-1.3 2.4-2.4z"/>',
    input: '<path fill-rule="evenodd" d="M3 8h18v5.5L18.5 16h-13L3 13.5zM5 10v2.7L6.3 14h11.4l1.3-1.3V10z"/>'
  };
  /** @param {string} k @param {number} [n] */
  function svg(k, n) { return '<svg viewBox="0 0 24 24" width="' + (n || 22) + '" height="' + (n || 22) + '" aria-hidden="true" fill="currentColor">' + P[k] + '</svg>'; }

  var CSS = [
    ':host{display:block;height:100%}',
    'hk-plate.tv{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;padding:' + C.blockPad('18px') + ';' +
      C.plate('card') + ';color:' + v('ink') + ';-webkit-tap-highlight-color:transparent;cursor:pointer}',
    window.hkCards.headCss('.lbl'),   // a block's heading: as written, not capitals (hk-base.js headCss)
    '.hd{font-size:17px;font-weight:600;letter-spacing:-.3px;line-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // (a title never leaves its box: one line ends in an ellipsis, two lines are clamped with one, a long word breaks -- the owner,
    // 2026-11-21: "make sure that Titles in these boxes don't leave the box and have a ... at the end")
    '.hd.two{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;max-height:42px}',
    '.sb{font-size:13px;font-weight:500;line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.row{display:flex;align-items:center;gap:12px;min-width:0}',
    '.grow{flex:1 1 auto;min-width:0;overflow:hidden}',
    '.foot{margin-top:auto}',
    // WHAT'S ON: the open app's own icon is the picture (the owner, 2026-11-21: "most TV apps don't display artwork" -- no black
    // screen box any more). Artwork, when a player sends it, fills the same square with the app's icon on its corner; a TV on its
    // own input shows the input's glyph; off, the TV's glyph bare.
    '.hero{position:relative;flex:none;border-radius:22%;display:grid;place-items:center;background-position:center;background-size:cover;background-repeat:no-repeat}',
    '.hero.ico,.hero.art{box-shadow:0 2px 8px rgba(0,0,0,.3)}',
    '.hero.ico{overflow:hidden}.hero.ico img{width:100%;height:100%;object-fit:cover;display:block}',
    '.hero.gl{background:#111;color:#fff}',
    '.hero.nm{background:' + v('key') + ';color:' + v('ink') + '}.hero.nm span{font-size:12px;font-weight:600;line-height:1.15;text-align:center;padding:6px}',
    '.hero.inp{background:#1b1f27;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);color:rgba(255,255,255,.85)}',
    '.hero.off{color:' + v('ink') + '}',
    '.hero .bdg{position:absolute;right:-5px;bottom:-5px;width:34%;height:34%;border-radius:22%;object-fit:cover;box-shadow:0 0 0 2px rgba(0,0,0,.35)}',
    // A ROUND KEY: 44 px, the main one solid
    '.rb{all:unset;box-sizing:border-box;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;cursor:pointer;flex:none;background:' + v('key') + ';color:' + v('ink') + '}',
    '.rb.solid{background:rgba(255,255,255,.94);color:#1c1c1e}',
    '.rb:active{transform:scale(.94)}',
    '.rb:focus-visible,.app:focus-visible,.k:focus-visible,.ok:focus-visible,.rk button:focus-visible,.cap button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
    // THE APPS
    '.apps{display:flex;justify-content:space-between;gap:8px}',
    '.apps.grid{display:grid;justify-content:space-between;row-gap:14px}',
    '.app{all:unset;box-sizing:border-box;position:relative;flex:none;border-radius:22%;cursor:pointer;display:grid;place-items:center;overflow:hidden;background:' + v('key') + ';color:' + v('ink') +
      ';box-shadow:0 2px 6px rgba(0,0,0,.18)}',
    '.app img{width:100%;height:100%;object-fit:cover;display:block}',
    '.app.gl{background:#111;color:#fff}',
    '.app.nm span{font-size:11px;font-weight:600;line-height:1.15;text-align:center;padding:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
    '.app:active{transform:scale(.95)}',
    // THE REMOTE: the arrow pad, its keys, the volume rocker (upright) and capsule (across)
    '.seg{display:flex;gap:2px;padding:3px;border-radius:12px;background:' + v('key') + '}',
    '.seg button{all:unset;cursor:pointer;font-size:13px;font-weight:600;padding:7px 14px;border-radius:9px;color:' + v('ink-2') + '}',
    '.seg button.on{background:rgba(255,255,255,.94);color:#1c1c1e}',
    '.dpad{position:relative;border-radius:50%;background:' + v('key') + ';box-shadow:inset 0 0 0 1px ' + v('line') + ';flex:none;touch-action:manipulation}',
    '.k{all:unset;position:absolute;width:30%;height:30%;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:' + v('ink') + '}',
    '.k:active{background:' + v('key-strong') + '}',
    '.k.u{left:35%;top:2%}.k.d{left:35%;bottom:2%;transform:rotate(180deg)}.k.l{left:2%;top:35%;transform:rotate(-90deg)}.k.r{right:2%;top:35%;transform:rotate(90deg)}',
    '.ok{all:unset;position:absolute;left:31%;top:31%;width:38%;height:38%;border-radius:50%;display:grid;place-items:center;cursor:pointer;font-size:15px;font-weight:600;background:' +
      v('key-strong') + '}',
    '.ok:active{background:rgba(255,255,255,.3)}',
    '.rk{display:flex;flex-direction:column;align-items:center;justify-content:space-between;width:52px;border-radius:26px;flex:none;background:' + v('key') + '}',
    '.rk button{all:unset;width:52px;height:52px;display:grid;place-items:center;cursor:pointer;color:' + v('ink') + '}',
    '.rk svg.mid{color:' + v('ink-2') + '}',
    '.cap{display:flex;align-items:center;height:44px;border-radius:22px;flex:none;background:' + v('key') + '}',
    '.cap button{all:unset;width:44px;height:44px;display:grid;place-items:center;cursor:pointer;color:' + v('ink') + '}',
    '.cap span{flex:1 1 auto;text-align:center;font-size:13px;font-weight:600;color:' + v('ink-2') + '}',
    '.rk button:active,.cap button:active{background:' + v('key-strong') + ';border-radius:50%}',
    '.none{margin:auto;text-align:center;display:flex;flex-direction:column;gap:4px}'
  ].join('');

  /** @param {any} a @param {number} n */
  function tile(a, n) {
    var inner = a.icon ? '<img src="' + esc(a.icon) + '" alt="" loading="lazy" draggable="false">' :
      a.glyph ? '<hk-icon icon="' + esc(a.glyph) + '" style="--mdc-icon-size:' + Math.round(n * 0.46) + 'px;width:' + Math.round(n * 0.46) + 'px;height:' + Math.round(n * 0.46) + 'px"></hk-icon>' :
      '<span>' + esc(a.name) + '</span>';
    return '<button type="button" class="app' + (a.icon ? '' : a.glyph ? ' gl' : ' nm') + (a.now ? ' now' : '') + '" data-notap data-app="' + esc(a.name) + '" aria-label="' + esc(a.name) +
      '" style="width:' + n + 'px;height:' + n + 'px">' + inner + '</button>';
  }
  class HkTvCard extends HkBase {
    static get CSS() { return CSS; }
    getCardSize() { return 4; }
    _size() {
      var s = (this.getAttribute && this.getAttribute('size')) || (this._config || {}).size;
      return SIZES.test(s || '') ? s : 'L';
    }
    _box(/** @type {string} */ size) {
      this._watchBlock();
      var b = this._block(), d = SQ_BLOCK[size] || SQ_BLOCK.L, cs = null, pad = /** @type {any} */ ({});
      try { cs = getComputedStyle(/** @type {any} */ (this)); } catch (e) { cs = null; }
      ['t', 'r', 'b', 'l'].forEach(function (k) { var n = cs ? parseFloat(cs.getPropertyValue('--hk-pad-' + k)) : NaN; pad[k] = n >= 0 ? n : 18; });
      var w = b ? b.w : d[0], h = b ? b.h : d[1];
      return { w: w, h: h, iw: Math.max(0, w - pad.l - pad.r), ih: Math.max(0, h - pad.t - pad.b) };
    }
    _set() { var T = window.hkTv; return T && this.client ? T.setFor(this.client, (this._config || {}).tv || 'tablet_room') : null; }
    _tapTarget() { var s = this._set(); return s ? [{ sheet: s.tv || s.player }] : []; }
    _sigOf() {
      var T = window.hkTv, set = this._set(), s = (this.client && this.client.states) || {};
      var out = this._size() + (this._blockKey || '') + '|' + (this._to || '') + '|';
      if (!T || !set) return out + 'none';
      T.ids(set).forEach(function (id) { var st = s[id]; out += id + '=' + (st ? st.state + '@' + (st.last_updated || '') : 'x') + ';'; });
      return out + JSON.stringify(window.hkSettings ? [window.hkSettings.get('features.tv_apps', []), window.hkSettings.get('features.tv_show', 'recent')] : '');
    }
    /** @param {any[][]} calls */
    _run(calls) {
      var self = this, i = 0;
      function next() {
        if (i >= calls.length) return;
        var c = calls[i++];
        Promise.resolve(self._call(c[0], c[1], c[2])).catch(function () { /* the next still goes */ }).then(function () { setTimeout(next, c[1] === 'turn_on' ? 2500 : 120); });
      }
      next();
    }
    // WHAT'S ON, as a square of n px: the artwork with the app's icon on its corner, else the app's icon, its glyph or its name; a TV
    // on its own input, the input's glyph; off, the TV's glyph bare
    /** @param {any} lk @param {any} now @param {number} n */
    _hero(lk, now, n) {
      var g = Math.round(n * (lk.on ? 0.5 : 0.78)), sz = 'width:' + n + 'px;height:' + n + 'px';
      var gi = function (/** @type {string} */ ic) { return '<hk-icon icon="' + esc(ic) + '" style="--mdc-icon-size:' + g + 'px;width:' + g + 'px;height:' + g + 'px"></hk-icon>'; };
      if (lk.onPlayer && lk.art) {
        return '<div class="hero art" style="' + sz + ';background-image:url(&quot;' + esc(lk.art) + '&quot;)">' +
          (now && now.icon ? '<img class="bdg" alt="" src="' + esc(now.icon) + '">' : '') + '</div>';
      }
      if (lk.onPlayer && now) {
        if (now.icon) return '<div class="hero ico" style="' + sz + '"><img alt="" src="' + esc(now.icon) + '" draggable="false"></div>';
        if (now.glyph) return '<div class="hero gl" style="' + sz + '">' + gi(now.glyph) + '</div>';
        return '<div class="hero nm" style="' + sz + '"><span>' + esc(now.name) + '</span></div>';
      }
      if (lk.onPlayer) return '<div class="hero gl" style="' + sz + '">' + gi('hk:television') + '</div>';
      if (lk.tvOn) return '<div class="hero inp" style="' + sz + '">' + svg('input', g) + '</div>';
      return '<div class="hero off" style="' + sz + '">' + gi('hk:television') + '</div>';
    }
    /** @param {any} lk */
    _main(lk) {
      return lk.onPlayer ? '<button type="button" class="rb solid" data-notap data-act="pp" aria-label="' + (lk.playing ? 'Pause' : 'Play') + '">' + svg(lk.playing ? 'pause' : 'play') + '</button>'
        : this._power(lk, lk.on);
    }
    /** @param {any} lk @param {boolean} [solid] */
    _power(lk, solid) { return '<button type="button" class="rb' + (solid ? ' solid' : '') + '" data-notap data-act="power" aria-label="Power">' + svg('power') + '</button>'; }
    /** @param {string} key @param {string} label @param {string} glyph @param {string} [style] */
    _key(key, label, glyph, style) {
      return '<button type="button" class="rb" data-notap data-key="' + key + '" aria-label="' + label + '"' + (style ? ' style="' + style + '"' : '') + '>' + svg(glyph) + '</button>';
    }
    /** @param {number} d @param {string} [style] */
    _dpad(d, style) {
      var a = Math.round(d * 0.13);
      return '<div class="dpad" data-notap style="width:' + d + 'px;height:' + d + 'px' + (style ? ';' + style : '') + '">' +
        ['u', 'd', 'l', 'r'].map(function (k, i) { return '<button type="button" class="k ' + k + '" data-key="' + ['up', 'down', 'left', 'right'][i] + '" aria-label="' +
          ['Up', 'Down', 'Left', 'Right'][i] + '">' + svg('up', a) + '</button>'; }).join('') +
        '<button type="button" class="ok" data-key="select">OK</button></div>';
    }
    // the volume: upright (a rocker beside the pad) or across (a capsule under it); a mute key where the device mutes
    /** @param {any} lk @param {number} h */
    _rocker(lk, h) {
      if (!lk.volume.mode) return '<span style="width:52px;flex:none"></span>';
      return '<div class="rk" data-notap style="height:' + h + 'px"><button type="button" data-vol="up" aria-label="Volume up">' + svg('plus') + '</button>' +
        svg('spk', 18).replace('<svg ', '<svg class="mid" ') + '<button type="button" data-vol="down" aria-label="Volume down">' + svg('minus') + '</button></div>';
    }
    /** @param {any} lk @param {number} w */
    _capsule(lk, w) {
      if (!lk.volume.mode) return '';
      return '<div class="cap" data-notap style="width:' + w + 'px"><button type="button" data-vol="down" aria-label="Volume down">' + svg('minus') +
        '</button><span>Volume</span><button type="button" data-vol="up" aria-label="Volume up">' + svg('plus') + '</button></div>';
    }
    /** @param {any} lk */
    _mute(lk) {
      return lk.volume.mode && lk.volume.mute ? '<button type="button" class="rb" data-notap data-vol="mute" aria-label="' + (lk.volume.muted ? 'Unmute' : 'Mute') + '">' + svg('mute') + '</button>' :
        '';
    }
    /** @param {any[]} apps @param {number} n @param {number} size @param {number} [cols] */
    _apps(apps, n, size, cols) {
      if (!apps.length || n < 1) return '';
      return '<div class="apps' + (cols ? ' grid" style="grid-template-columns:repeat(' + cols + ',' + size + 'px)' : '') + '">' +
        apps.slice(0, n).map(function (a) { return tile(a, size); }).join('') + '</div>';
    }
    // NEW (Card Design, docs/phase34/PLAN.md; hk-kit.js): the remote first, as Current, in the kit's parts -- the open app's own
    // icon is the picture (it plays and pauses), its name and the TV's beside it, power, the round pad, Back / Home / Mute / Play /
    // − / + as keys, the apps' icons in a row on Large and a column on Extra Large. White while the TV is on; glass while off.
    _renderKit() {
      var K = window.hkKit, T = window.hkTv, set = this._set(), cfg = this._config || {}, self = this;
      if (!K || !T || !set) return false;
      var k = K.ctx(this), w = k.w, h = k.h, E = k.E, X = k.X, KH = K.KH, G = K.G, sq = h >= 180;
      var lk = T.look(this.client, set), can = T.canArrows(this.client, set), remote = !!(can.player || can.tv);
      var apps = T.apps(this.client, set, cfg.show || undefined, 12), now = apps.filter(function (a) { return a.now; })[0] || null;
      var others = apps.filter(function (a) { return !a.now; }), esc2 = K.esc, size = this._size();
      var title = lk.on ? lk.title : set.name, what = lk.onPlayer ? (lk.sub || (lk.app && lk.app !== title ? lk.app : '')) : lk.tvOn ? (lk.source ? 'On the TV' : '') : lk.unavailable ? 'Unavailable' :
        'Off';
      var sub = lk.on ? [what, title !== set.name ? set.name : ''].filter(Boolean).join(' · ') || set.name : what;
      // an app's icon as a key (n px, the concentric corner where it sits on the edge)
      var icon = function (/** @type {any} */ a, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ n, /** @type {boolean} */ main) {
        var r = n >= 52 ? k.r : Math.round(n * 0.3), inner;
        if (main && !lk.on) inner = '<span class="fc" style="width:100%;height:100%">' + K.glyph('hk:television', Math.round(n * 0.62), 'var(--hk-ink,rgba(255,255,255,0.94))') + '</span>';
        else if (main && lk.onPlayer && lk.art) inner = '<img alt="" src="' + esc2(lk.art) + '" draggable="false">';
        else if (a && a.icon) inner = '<img alt="" src="' + esc2(a.icon) + '" draggable="false" loading="lazy">';
        else if (a && a.glyph) inner = '<span class="fc" style="width:100%;height:100%;background:#111;color:#fff">' + K.glyph(a.glyph, Math.round(n * 0.46)) + '</span>';
        else if (main && lk.tvOn) inner = '<span class="fc" style="width:100%;height:100%;background:#1b1f27;color:rgba(255,255,255,.85)">' + svg('input', Math.round(n * 0.5)) + '</span>';
        else inner = '<span class="fc kl" style="width:100%;height:100%;padding:4px;white-space:normal;text-align:center;color:var(--hk-ink)">' + esc2(a ? a.name : set.name) + '</span>';
        var data = main ? (lk.onPlayer ? ' data-act="pp"' : ' data-act="power"') : ' data-app="' + esc2(a.name) + '"';
        var bg = main && !lk.on ? 'background:var(--hk-key);box-shadow:none;' : '';
        return '<button type="button" class="pic hit" data-notap' + data + ' aria-label="' + esc2(main ? (lk.onPlayer ? (lk.playing ? 'Pause' : 'Play') : 'Power') : 'Open ' + a.name) +
          '" style="' + K.st(x, y, n, n) + bg + 'border-radius:' + r + 'px">' + inner + '</button>';
      };
      var words = function (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ ww, /** @type {boolean} */ big) {
        return K.tx(x, y, ww, big ? 'kd' : 'kt', esc2(title)) + K.tx(x, y + (big ? 28 : 24), ww, 'kb', esc2(sub)); };
      /** @param {string} g @param {string} label @param {any} data @param {number} [n] */
      var kk = function (g, label, data, n) { return { g: K.svg(g, n || 26), label: label, data: data }; };
      var BACK = kk('back', 'Back', { key: 'back' }), HOME = kk('home', 'Home', { key: 'home' }), POWER = kk('power', 'Power', { act: 'power' });
      var PP = lk.onPlayer ? kk(lk.playing ? 'pause' : 'play', lk.playing ? 'Pause' : 'Play', { act: 'pp' }) : kk('pp', 'Play or pause', { key: 'play_pause' });
      var vol = lk.volume && lk.volume.mode, MUTE = vol && lk.volume.mute ? kk('mute', lk.volume.muted ? 'Unmute' : 'Mute', { vol: 'mute' }) : null;
      var VDN = vol ? kk('minus', 'Volume down', { vol: 'down' }) : null, VUP = vol ? kk('plus', 'Volume up', { vol: 'up' }) : null, o = '';
      var appsRow = function (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ ww, /** @type {number} */ n) {
        var s = 64, m = Math.min(n, others.length), gap = m > 1 ? (ww - m * s) / (m - 1) : 0, out = '';
        others.slice(0, m).forEach(function (a, i) { out += icon(a, x + i * (s + gap), y, s, false); }); return out; };
      if (size === 'S') {
        var z = sq ? 66 : 52, gy = sq ? 32 : 20;
        o += icon(now, (w - z) / 2, gy, z, true) + K.tx(8, sq ? 113 : 82, w - 16, 'kt', esc2(title), 'text-align:center') + K.tx(8, sq ? 140 : 104, w - 16, 'kb', esc2(sub), 'text-align:center');
      } else if (size === 'W') {
        var pd = h - 2 * E, pxx = w - E - pd, lw = remote ? pxx - E - G : w - 2 * E;
        if (sq) o += icon(now, E, E, 64, true) + words(E + 78, E + 6, lw - 78, true);
        else o += icon(now, E, E, 52, true) + words(E + 64, E + 4, lw - 64, false);
        if (remote) o += K.keyRow(E, K.FY(k), lw, [BACK, HOME]) + K.pad(pxx, E, pd);
        else o += appsRow(E, K.FY(k), w - 2 * E, 5);
      } else if (size === 'T') {
        if (sq) o += icon(now, E, E, 64, true) + K.key(w - E - KH, E, KH, KH, POWER) + words(X, 88, w - 2 * X, true);
        else o += icon(now, E, E, 52, true) + K.tx(E + 64, E + 12, w - E - X - 64, 'kd', esc2(title));
        if (remote) { var pd2 = sq ? w - 2 * E : 150; o += K.pad((w - pd2) / 2, sq ? 146 : 78, pd2) + K.keyRow(E, K.FY(k), w - 2 * E, [BACK, HOME]); }
        else o += K.keyGrid(E, sq ? 146 : 78, w - 2 * E, 2, []) + appsRow(E, K.FY(k), w - 2 * E, 2);
      } else {
        var lw2 = size === 'XL' ? Math.min(w, Math.round(w * 0.66)) : w, ic = sq ? 80 : 64;
        o += icon(now, E, E, ic, true) + words(E + ic + 14, E + (ic - 50) / 2, lw2 - 2 * E - ic - 14 - KH - 12, true) + K.key(lw2 - E - KH, E, KH, KH, POWER);
        var withApps = sq && size === 'L' && others.length, bottom = withApps ? h - E - 64 - 14 : h - E, top = E + ic + 12;
        if (remote) {
          var pd3 = Math.min(bottom - top, sq ? 200 : 999, lw2 * 0.52), cx = E + pd3 + 12, cw = lw2 - E - cx, kh = Math.min(76, (bottom - top - 2 * G) / 3), kw = (cw - G) / 2;
          var ky = top + (bottom - top - 3 * kh - 2 * G) / 2;
          o += K.pad(E, top + (bottom - top - pd3) / 2, pd3);
          [[BACK, HOME], [MUTE || PP, MUTE ? PP : null], [VDN, VUP]].forEach(function (r, i) {
            var list = r.filter(Boolean), ww = list.length === 1 ? cw : kw;
            list.forEach(function (o2, j) { o += K.key(cx + j * (kw + G), ky + i * (kh + G), ww, kh, /** @type {any} */ (o2)); });
          });
        } else o += appsRow(E, top, lw2 - 2 * E, 5);
        if (withApps) o += appsRow(E, h - E - 64, w - 2 * E, 5);
        if (size === 'XL') {
          var rx = lw2 + 5, rw = w - E - rx, isz = Math.min(76, (rw - 16) / 2), rowsN = Math.max(1, Math.floor((h - 2 * E + 12) / (isz + 12)));
          var vg = rowsN > 1 ? (h - 2 * E - rowsN * isz) / (rowsN - 1) : 0;
          others.slice(0, 2 * rowsN).forEach(function (a, i) { o += icon(a, rx + (i % 2) * (rw - isz), E + Math.floor(i / 2) * (isz + vg), isz, false); });
        }
      }
      var label = set.name + ', ' + title + (what ? ', ' + what : '');
      return K.draw(this, K.plate(k, o, { lit: !!lk.on, label: label, cls: 'tv' }), function (/** @type {any} */ root) { self._bindKit(root); });
    }
    /** @param {any} root */
    _bindKit(root) {
      var self = this, T = window.hkTv, cur = function () { return self._set(); };
      root.querySelectorAll('[data-app]').forEach(function (/** @type {any} */ b) { b.addEventListener('click', function () { self._run(T.open(self.client, cur(), b.getAttribute('data-app'))); }); });
      root.querySelectorAll('[data-act]').forEach(function (/** @type {any} */ b) {
        b.addEventListener('click', function () { var a = b.getAttribute('data-act'), s = cur(); self._run(a === 'pp' ? T.playPause(self.client, s) : T.power(self.client, s)); });
      });
      root.querySelectorAll('[data-vol]').forEach(function (/** @type {any} */ b) { b.addEventListener('click', function () { self._run(T.volume(self.client, cur(), b.getAttribute('data-vol'))); });
        });
      root.querySelectorAll('[data-key]').forEach(function (/** @type {any} */ b) {
        b.addEventListener('click', function () {
          var s = cur(), lk2 = T.look(self.client, s), c2 = T.canArrows(self.client, s), dest = self._to && c2[self._to] ? self._to : lk2.arrows;
          if (dest) self._run(T.press(self.client, s, dest, b.getAttribute('data-key')));
        });
      });
    }
    _render() {
      // (Card Design: New draws the kit's card; Current, today's, below -- hk-kit.js forgets the New html so going back redraws)
      if (window.hkKit && window.hkKit.on(this)) { if (this._renderKit()) return; } else if (window.hkKit) window.hkKit.forget(this);
      var self = this, T = window.hkTv, size = this._size(), box = this._box(size), set = this._set(), cfg = this._config || {}, body = '', label = '';
      if (!T || !set) {
        var where = window.hkShell && window.hkShell.settingsPlace ? window.hkShell.settingsPlace('Accessories → TVs') : 'Accessories → TVs';
        body = '<div class="none"><div class="hd">TV</div><div class="sb">' + (cfg.tv && cfg.tv !== 'tablet_room' ? 'This TV isn’t available.' :
          'No TV in this room. Choose one in the block’s settings, or set TVs up in ' + esc(where) + '.') + '</div></div>';
      } else {
        var lk = T.look(this.client, set), can = T.canArrows(this.client, set), to = this._to && can[this._to] ? this._to : lk.arrows, remote = !!(can.player || can.tv);
        var apps = T.apps(this.client, set, cfg.show || undefined, 12), now = apps.filter(function (a) { return a.now; })[0] || null;
        var others = apps.filter(function (a) { return !a.now; });
        var iw = box.iw, ih = box.ih;
        // the words: what's on, and under it the app (or the input, or Off) and the TV's name
        var title = lk.on ? lk.title : set.name;
        var what = lk.onPlayer ? (lk.sub || (lk.app && lk.app !== title ? lk.app : '')) : lk.tvOn ? (lk.source ? 'On the TV' : '') : lk.unavailable ? 'Unavailable' : 'Off';
        var sub = [what, title !== set.name ? set.name : ''].filter(Boolean).join(' · ');
        label = set.name + ', ' + title + (what ? ', ' + what : '');
        var pp = lk.onPlayer ? '' : this._key('play_pause', 'Play or pause', 'pp');
        if (size === 'S') {
          var hs = ih >= 150 ? 64 : 48;
          body = '<div class="row" style="justify-content:space-between;align-items:flex-start">' + this._hero(lk, now, hs) + this._main(lk) + '</div>' +
            '<div class="foot"><div class="hd' + (ih >= 150 ? ' two' : '') + '">' + esc(title) + '</div><div class="sb">' + esc(lk.on ? what || set.name : 'Off') + '</div></div>';
        } else if (size === 'W') {
          // (the app big on the left over what's on, the pad on the right: the owner, 2026-11-21, "make the Icon bigger ... fill in
          // the space that is in the middle". Back and Home in the pad's lower corners where it's tall enough, beside it where not)
          var tallW = ih >= 140, dw = remote ? Math.max(96, Math.min(152, ih - (tallW ? 8 : 0))) : 0, aw = !remote ? 0 : tallW ? dw + 52 : dw + 100;
          var hw = tallW ? 72 : 56, right = '';
          if (remote) {
            right = tallW ? '<div data-notap style="position:relative;flex:none;width:' + aw + 'px;height:' + ih + 'px">' + this._dpad(dw, 'position:absolute;left:26px;top:0') +
                this._key('back', 'Back', 'back', 'position:absolute;left:0;bottom:0') + this._key('home', 'Home', 'home', 'position:absolute;right:0;bottom:0') + '</div>'
              : '<div class="row" data-notap style="flex:none;gap:6px;align-items:flex-end">' + this._key('back', 'Back', 'back') + this._dpad(dw) + this._key('home', 'Home', 'home') + '</div>';
          }
          body = '<div class="row" style="align-items:stretch;height:100%;gap:12px"><div class="grow" style="display:flex;flex-direction:column">' +
            '<div class="row" style="justify-content:space-between;align-items:flex-start">' + this._hero(lk, now, hw) + this._main(lk) + '</div>' +
            '<div class="foot"><div class="hd' + (tallW ? ' two' : '') + '">' + esc(title) + '</div><div class="sb">' + esc(sub || set.name) + '</div></div></div>' +
            (right || this._apps(others, 3, 56)) + '</div>';
        } else if (size === 'T') {
          var dt = Math.max(96, Math.min(iw, ih - (44 + 10 + 21 + 17 + 16 + 16 + 44)));
          var keysT = [this._key('back', 'Back', 'back'), this._key('home', 'Home', 'home'), this._mute(lk) || pp].filter(Boolean).join('');
          body = '<div class="row" style="justify-content:space-between">' + this._hero(lk, now, 44) + this._main(lk) + '</div>' +
            '<div class="hd" style="margin-top:10px">' + esc(title) + '</div><div class="sb">' + esc(sub || set.name) + '</div>' +
            (remote ? this._dpad(dt, 'margin:auto') + '<div class="row" style="justify-content:space-between">' + keysT + '</div>'
              : '<div class="foot">' + this._apps(others, 4, 64, 2) + '</div>');
        } else if (size === 'L') {
          var showApps = ih - 48 - 16 - 16 - 48 >= 160, dl = Math.max(110, Math.min(206, ih - 48 - 16 - (showApps ? 16 + 48 : 0)));
          var colH = Math.min(dl, 160);
          body = '<div class="row">' + this._hero(lk, now, 48) + '<div class="grow"><div class="lbl" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
              esc(set.name + (lk.onPlayer && lk.app ? ' · ' + lk.app : '')) + '</div><div class="hd" style="margin-top:2px">' + esc(title) + '</div></div>' + this._power(lk) + '</div>' +
            (remote ? '<div class="row" style="justify-content:space-between;margin:auto 0">' +
                '<div style="display:flex;flex-direction:column;justify-content:space-between;height:' + colH + 'px">' + this._key('back', 'Back', 'back') + this._key('home', 'Home', 'home') +
                  (lk.onPlayer ? this._main(lk) : pp) + '</div>' + this._dpad(dl) + this._rocker(lk, colH) + '</div>'
              : '<div style="margin:auto 0">' + this._apps(others, 6, 48) + '</div>') +
            (showApps && remote ? this._apps(others, 6, 48) : '');
        } else {
          // EXTRA LARGE: what's on and the apps beside the whole remote
          var rw = 230, lw = iw - rw - 22, seg = can.player && can.tv;
          var dx = Math.max(110, Math.min(186, ih - (seg ? 36 + 12 : 0) - 44 - 44 - 2 * 12));
          var cols = 5, as = Math.min(56, Math.floor((lw - (cols - 1) * 10) / cols)), heroH = 72, used = 16 + 14 + heroH + 18 + 44 + 18;
          var rows = Math.max(1, Math.min(2, Math.floor((ih - used + 14) / (as + 14))));
          var left = '<div style="display:flex;flex-direction:column;min-width:0;width:' + lw + 'px;height:100%">' +
            '<div class="lbl" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(set.name) + '</div>' +
            '<div class="row" style="gap:14px;margin-top:14px">' + this._hero(lk, now, heroH) + '<div class="grow"><div class="hd two">' + esc(title) + '</div><div class="sb">' +
              esc(what) + '</div></div></div>' +
            '<div style="margin-top:auto">' + this._apps(others, cols * rows, as, cols) + '</div>' +
            '<div class="row" style="justify-content:space-between;margin-top:18px">' + (lk.onPlayer ? this._main(lk) : pp || '<span></span>') + this._power(lk) + '</div></div>';
          var rightX = !remote ? '' : '<div data-notap style="flex:none;width:' + rw + 'px;display:flex;flex-direction:column;align-items:center;justify-content:space-between">' +
            (seg ? '<div class="seg"><button type="button" data-to="player" class="' + (to === 'player' ? 'on' : '') + '">' +
              (set.remotes.playerKind === 'apple_tv' ? 'Apple TV' : 'Player') + '</button><button type="button" data-to="tv" class="' + (to === 'tv' ? 'on' : '') + '">TV</button></div>' : '') +
            this._dpad(dx) + '<div class="row" style="gap:18px">' + this._key('back', 'Back', 'back') + this._key('home', 'Home', 'home') +
              (this._mute(lk) || this._key('play_pause', 'Play or pause', 'pp')) + '</div>' +
            this._capsule(lk, dx) + '</div>';
          body = '<div class="row" style="align-items:stretch;gap:22px;height:100%">' + left + rightX + '</div>';
        }
      }
      var html = '<hk-plate class="tv ' + size + '" data-hk-role="card" role="group" aria-label="' + esc(label || 'TV') + '">' + body + '</hk-plate>';
      if (this._html === html) return;
      this._html = html;
      this._root.innerHTML = html;
      var cur = function () { return self._set(); };
      this._root.querySelectorAll('[data-app]').forEach(function (b) {
        b.addEventListener('click', function (e) { e.stopPropagation(); self._run(T.open(self.client, cur(), b.getAttribute('data-app'))); });
      });
      this._root.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var a = b.getAttribute('data-act'), s = cur();
          if (a === 'pp') self._run(T.playPause(self.client, s));
          else if (a === 'power') self._run(T.power(self.client, s));
        });
      });
      this._root.querySelectorAll('[data-vol]').forEach(function (b) {
        b.addEventListener('click', function (e) { e.stopPropagation(); self._run(T.volume(self.client, cur(), b.getAttribute('data-vol'))); });
      });
      this._root.querySelectorAll('[data-notap]').forEach(function (el) { el.addEventListener('click', function (e) { e.stopPropagation(); }); });
      this._root.querySelectorAll('[data-to]').forEach(function (b) {
        b.addEventListener('click', function (e) { e.stopPropagation(); self._to = b.getAttribute('data-to'); self.redraw(); });
      });
      this._root.querySelectorAll('[data-key]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var s = cur(), lk2 = T.look(self.client, s), c2 = T.canArrows(self.client, s), dest = self._to && c2[self._to] ? self._to : lk2.arrows;
          if (dest) self._run(T.press(self.client, s, dest, b.getAttribute('data-key')));
        });
      });
    }
  }

  register('hk-grid-tv-card', HkTvCard, 'HK TV',
    'A room’s TV and its Apple TV as one: what’s on, play and pause, the volume, the apps to tap, and the remote. Made for a Home Grid block.');
  if (C.unlisted) C.unlisted('hk-grid-tv-card');
  window.hkTvCard.Card = HkTvCard;
  });
})();
