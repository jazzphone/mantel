// @ts-check
// hk-tv-card.js -- the TV block (`tv` in hk-grid-catalog.js; docs/phase23/TV.md), 2026-11-10.
//
//   hk-grid-tv-card   A room's TV and its player as one (hk-tv.js reads them): what's on, play/pause, the volume, the apps to tap, and
//                     on Extra Large the remote itself. S, W, T, L and XL, on square cells (196 x 196) and tile cells (196 x 150).
//
// AS THE OWNER APPROVED IT (the mockup, https://claude.ai/artifact/8NE4LZLB5Y27St2gLJtuGF, version 2: "some of the larger cards have a
// lot of space that isn't getting utilized"): every size fills its plate. Small: the app and play/pause, or power when it's off. Wide:
// what's on over five apps the plate's width. Tall: the picture with its title on it, volume steps, four larger apps. Large: a wide
// picture, play/pause and the volume, five apps, the Remote and power. Extra Large: all of Large beside the arrow pad. A tap on the
// plate (or Remote) opens the TV sheet (hk-sheet-tv.js); an app brings itself up from wherever the room is (hkTv.open).
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
    spk2: '<path d="M3 9h4l5-4v14l-5-4H3zM15.5 8.5a5 5 0 0 1 0 7l-1.2-1.2a3.3 3.3 0 0 0 0-4.6zM18 6a8.5 8.5 0 0 1 0 12l-1.2-1.2a6.8 6.8 0 0 0 0-9.6z"/>'
  };
  /** @param {string} k @param {number} [n] */
  function svg(k, n) { return '<svg viewBox="0 0 24 24" width="' + (n || 22) + '" height="' + (n || 22) + '" aria-hidden="true" fill="currentColor">' + P[k] + '</svg>'; }

  var CSS = [
    ':host{display:block;height:100%}',
    'hk-plate.tv{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;padding:' + C.blockPad('18px') + ';' +
      C.plate('card') + ';color:' + v('ink') + ';-webkit-tap-highlight-color:transparent;cursor:pointer}',
    window.hkCards.headCss('.lbl'),   // a block's heading: as written, not capitals (hk-base.js headCss)
    '.hd{font-size:17px;font-weight:600;letter-spacing:-.3px;line-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sb{font-size:13px;font-weight:500;line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.row{display:flex;align-items:center;gap:12px;min-width:0}',
    '.grow{flex:1 1 auto;min-width:0}',
    '.foot{margin-top:auto}',
    // THE PICTURE: what's on, its title on it
    // (as the sheet's: the artwork; else the open app's icon on a wash of its own colors; else a dark screen and the glyph -- every
    // background part said on its own, so a picture never repeats)
    '.art{position:relative;flex:none;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;',
    '  background-color:#101018;background-position:center;background-size:cover;background-repeat:no-repeat}',
    '.art.scr{background-image:linear-gradient(155deg,#2a2a36 0%,#14141c 55%,#0a0a10 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}',
    '.art.scr hk-icon{color:rgba(255,255,255,.42)}',
    // (the open app's icon small in the screen's top right, out of the title's way: the owner's option B, 2026-11-11)
    '.art .cor{position:absolute;top:10px;right:10px;z-index:2;border-radius:8px;object-fit:cover;box-shadow:0 2px 8px rgba(0,0,0,.4)}',
    // (the glyph or the app's icon centered in the whole box, the title over it at the foot: the owner, 2026-11-11)
    '.art .mid{position:absolute;inset:0;z-index:1;display:grid;place-items:center}',
    '.art .ov{position:absolute;left:12px;right:12px;bottom:10px;text-shadow:0 1px 8px rgba(0,0,0,.4)}',
    '.art.has::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.5),transparent 60%);pointer-events:none}',
    '.art .ov{z-index:2;color:rgba(255,255,255,.97)}.art .ov .sb{color:rgba(255,255,255,.85)}',
    // A ROUND KEY: 44 px, the main one solid
    '.rb{all:unset;box-sizing:border-box;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;cursor:pointer;flex:none;background:' + v('key') + ';color:' + v('ink') + '}',
    '.rb.solid{background:rgba(255,255,255,.94);color:#1c1c1e}',
    '.rb:active{transform:scale(.94)}',
    '.rb:focus-visible,.app:focus-visible,.k:focus-visible,.ok:focus-visible,.pill:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
    '.pill{all:unset;box-sizing:border-box;height:44px;border-radius:22px;padding:0 18px;display:inline-flex;align-items:center;gap:8px;cursor:pointer;',
    '  background:rgba(255,255,255,.94);color:#1c1c1e;font-size:15px;font-weight:600}',
    // VOLUME
    '.vol{display:flex;align-items:center;gap:10px;flex:1 1 auto;min-width:0}',
    '.vol svg{color:' + v('ink-2') + ';flex:none}',
    '.vol input{flex:1 1 auto;min-width:0;-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:' + v('line-strong') + ';outline:none;margin:0}',
    '.vol input::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3)}',
    '.vol input::-moz-range-thumb{width:24px;height:24px;border:0;border-radius:50%;background:#fff}',
    // THE APPS: tiles the plate's width, the one open ringed
    '.apps{display:flex;justify-content:space-between;gap:8px}',
    '.apps.g2{display:grid;grid-template-columns:repeat(2,auto);justify-content:space-between;row-gap:13px}',
    '.app{all:unset;box-sizing:border-box;position:relative;flex:none;border-radius:22%;cursor:pointer;display:grid;place-items:center;overflow:hidden;background:' + v('key') + ';color:' + v('ink') +
      ';box-shadow:0 2px 6px rgba(0,0,0,.18)}',
    '.app img{width:100%;height:100%;object-fit:cover;display:block}',
    '.app.gl{background:#111;color:#fff}',
    '.app.nm span{font-size:11px;font-weight:600;line-height:1.15;text-align:center;padding:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
    // (the app that's open: a ring that is the tile's own outline, so it follows its corners exactly -- a dark hairline, then white,
    // so it shows on a white icon too; the owner, 2026-11-11: a separate ring with its own corners looked like a UI error)
    '.app.now{box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 0 5px #fff,0 0 16px 4px rgba(255,255,255,.3)}',
    '.app:active{transform:scale(.95)}',
    // THE REMOTE (Extra Large)
    '.seg{display:flex;gap:2px;padding:3px;border-radius:12px;background:' + v('key') + '}',
    '.seg button{all:unset;cursor:pointer;font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;color:' + v('ink-2') + '}',
    '.seg button.on{background:rgba(255,255,255,.94);color:#1c1c1e}',
    '.dpad{position:relative;border-radius:50%;background:' + v('key') + ';box-shadow:inset 0 0 0 1px ' + v('line') + ';flex:none;touch-action:manipulation}',
    '.k{all:unset;position:absolute;width:30%;height:30%;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:' + v('ink') + '}',
    '.k:active{background:' + v('key-strong') + '}',
    '.k.u{left:35%;top:2%}.k.d{left:35%;bottom:2%;transform:rotate(180deg)}.k.l{left:2%;top:35%;transform:rotate(-90deg)}.k.r{right:2%;top:35%;transform:rotate(90deg)}',
    '.ok{all:unset;position:absolute;left:31%;top:31%;width:38%;height:38%;border-radius:50%;display:grid;place-items:center;cursor:pointer;font-size:15px;font-weight:600;background:' +
      v('key-strong') + '}',
    '.ok:active{background:rgba(255,255,255,.3)}',
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
    // the picture: the player's artwork, else the open app's icon, else the TV's glyph; its title on it where asked
    /** @param {any} lk @param {any} now @param {number} w @param {number} h @param {boolean} words */
    _art(lk, now, w, h, words) {
      // the artwork the player sends; else a black screen, the TV glyph in the middle, the open app's icon in the top right
      var url = function (/** @type {string} */ u) { return 'url(&quot;' + esc(u) + '&quot;)'; }, g = Math.round(Math.min(46, h * 0.32)), c = h >= 140 ? 34 : 28;
      var glyph = lk.art || (words && h < 70) ? '' : '<hk-icon icon="hk:television" style="--mdc-icon-size:' + g + 'px;width:' + g + 'px;height:' + g + 'px"></hk-icon>';
      var corner = !lk.art && now && now.icon && h >= 64 ? '<img class="cor" alt="" src="' + esc(now.icon) + '" style="width:' + c + 'px;height:' + c + 'px">' : '';
      return '<div class="art' + (lk.art ? ' has' : ' scr') + (words ? ' words' : '') + '" style="width:' + w + 'px;height:' + h + 'px' +
        (lk.art ? ';background-image:' + url(lk.art) : '') + '"><div class="mid">' + glyph + '</div>' + corner +
        (words ? '<div class="ov"><div class="hd">' + esc(lk.title) + '</div>' + (lk.sub ? '<div class="sb">' + esc(lk.sub) + '</div>' : '') + '</div>' : '') + '</div>';
    }
    /** @param {any} lk */
    _main(lk) {
      return lk.onPlayer ? '<button type="button" class="rb solid" data-notap data-act="pp" aria-label="' + (lk.playing ? 'Pause' : 'Play') + '">' + svg(lk.playing ? 'pause' : 'play') + '</button>'
        : '<button type="button" class="rb' + (lk.on ? ' solid' : '') + '" data-notap data-act="power" aria-label="Power">' + svg('power') + '</button>';
    }
    /** @param {any} lk @param {boolean} steps */
    _vol(lk, steps) {
      var vol = lk.volume;
      if (!vol.mode) return '';
      if (vol.mode === 'step' || steps) return '<button type="button" class="rb" data-notap data-vol="down" aria-label="Volume down">' + svg('minus') + '</button>';
      return '<div class="vol" data-notap>' + svg('spk', 16) + '<input type="range" min="0" max="100" step="1" value="' + Math.round((vol.level || 0) * 100) + '" aria-label="Volume">' +
        svg('spk2', 18) + '</div>';
    }
    /** @param {any[]} apps @param {number} n @param {number} size @param {string} [cls] */
    _apps(apps, n, size, cls) {
      return apps.length ? '<div class="apps' + (cls ? ' ' + cls : '') + '">' + apps.slice(0, n).map(function (a) { return tile(a, size); }).join('') + '</div>' : '';
    }
    /** @param {number} d @param {any} set @param {string|null} to @param {any} can */
    _remote(d, set, to, can) {
      var seg = can.player && can.tv ? '<div class="seg" data-notap><button type="button" data-to="player" class="' + (to === 'player' ? 'on' : '') + '">' +
        (set.remotes.playerKind === 'apple_tv' ? 'Apple TV' : 'Player') + '</button><button type="button" data-to="tv" class="' + (to === 'tv' ? 'on' : '') + '">TV</button></div>' : '';
      var a = Math.round(d * 0.13);
      return seg + '<div class="dpad" data-notap style="width:' + d + 'px;height:' + d + 'px">' +
        ['u', 'd', 'l', 'r'].map(function (k, i) { return '<button type="button" class="k ' + k + '" data-key="' + ['up', 'down', 'left', 'right'][i] + '" aria-label="' +
          ['Up', 'Down', 'Left', 'Right'][i] + '">' + svg('up', a) + '</button>'; }).join('') +
        '<button type="button" class="ok" data-key="select">OK</button></div>' +
        '<div class="row" style="gap:20px" data-notap><button type="button" class="rb" data-key="back" aria-label="Back">' + svg('back') +
          '</button><button type="button" class="rb" data-key="home" aria-label="Home">' + svg('home') +
        '</button><button type="button" class="rb" data-key="play_pause" aria-label="Play or pause">' + svg('pp') + '</button></div>';
    }
    _render() {
      var self = this, T = window.hkTv, size = this._size(), box = this._box(size), set = this._set(), cfg = this._config || {}, body = '', label = '';
      if (!T || !set) {
        var where = window.hkShell && window.hkShell.settingsPlace ? window.hkShell.settingsPlace('Accessories → TVs') : 'Accessories → TVs';
        body = '<div class="none"><div class="hd">TV</div><div class="sb">' + (cfg.tv && cfg.tv !== 'tablet_room' ? 'This TV isn’t available.' :
          'No TV in this room. Choose one in the block’s settings, or set TVs up in ' + esc(where) + '.') + '</div></div>';
      } else {
        var lk = T.look(this.client, set), can = T.canArrows(this.client, set), to = this._to && can[this._to] ? this._to : lk.arrows;
        var apps = T.apps(this.client, set, cfg.show || undefined, 6), now = apps.filter(function (a) { return a.now; })[0] || null;
        var iw = box.iw, ih = box.ih, title = lk.title, sub = lk.onPlayer ? lk.sub : lk.tvOn ? set.name : lk.unavailable ? 'Unavailable' : set.name;
        label = set.name + ', ' + title + (sub && sub !== set.name ? ', ' + sub : '');
        var gap = 12;
        if (size === 'S') {
          var head = now ? tile(now, 64) : '<div class="art scr" style="width:64px;height:64px;border-radius:50%"><div class="mid"><hk-icon icon="hk:television"></hk-icon></div></div>';
          body = '<div class="row" style="justify-content:space-between;align-items:flex-start">' + head + this._main(lk) + '</div>' +
            '<div class="foot"><div class="hd">' + esc(title) + '</div><div class="sb">' + esc(lk.on ? (lk.onPlayer && lk.sub ? lk.sub : set.name) : 'Tap an app to watch') + '</div></div>';
        } else if (size === 'W') {
          var n = 5, aw = Math.min(64, Math.floor((iw - 4 * 8) / n)), wTop = ih - aw;
          body = '<div class="row"><div class="grow"><div class="lbl">' + esc(set.name) + '</div><div class="hd" style="margin-top:4px">' + esc(title + (lk.onPlayer && lk.sub ? ' · ' + lk.sub : '')) +
            '</div>' +
            (wTop > 70 && !lk.onPlayer ? '<div class="sb">' + esc(lk.on ? (lk.source ? 'On the TV' : 'On') : 'Tap an app to watch') + '</div>' : '') + '</div>' + this._main(lk) + '</div>' +
            '<div class="foot">' + this._apps(apps, n, aw) + '</div>';
        } else if (size === 'T') {
          var as = ih >= 340 ? 70 : 56, arth = Math.max(56, Math.min(iw, ih - 16 - 44 - (as * 2 + 13) - 3 * gap - 4));
          body = '<div class="lbl">' + esc(set.name) + '</div><div style="height:' + gap + 'px"></div>' + this._art(lk, now, iw, arth, true) +
            '<div class="row" style="justify-content:space-between;margin-top:' + gap + 'px">' + (lk.volume.mode ? this._vol(lk, true) : '<span style="width:44px"></span>') + this._main(lk) +
            (lk.volume.mode ? '<button type="button" class="rb" data-notap data-vol="up" aria-label="Volume up">' + svg('plus') + '</button>' : '<span style="width:44px"></span>') + '</div>' +
            '<div class="foot">' + this._apps(apps, 4, as, 'g2') + '</div>';
        } else {
          var xl = size === 'XL', lw = xl ? iw - 206 - 22 : iw, rows = 20 + 44 + 64 + (xl ? 0 : 44), aw2 = Math.min(64, Math.floor((lw - 4 * 8) / 5));
          var arth2 = Math.max(56, Math.min(Math.round(lw * 9 / 16), ih - rows - (xl ? 3 : 4) * gap));
          var ctl = '<div class="row">' + this._main(lk) + (lk.volume.mode === 'set' ? this._vol(lk, false) : lk.volume.mode === 'step' ?
            '<span class="grow"></span>' + this._vol(lk, true) + '<button type="button" class="rb" data-notap data-vol="up" aria-label="Volume up">' + svg('plus') + '</button>' : '') + '</div>';
          var left = '<div style="display:flex;flex-direction:column;gap:' + gap + 'px;min-width:0;width:' + lw + 'px;height:100%">' +
            '<div class="row" style="height:20px;justify-content:space-between"><div class="lbl">' + esc(set.name) + '</div>' +
            (lk.onPlayer && set.input && set.tv ? '<div class="sb">' + esc((set.remotes.playerKind === 'apple_tv' ? 'Apple TV' : 'Player') + ' · ' + set.input) + '</div>' : !lk.onPlayer && lk.tvOn ?
              '<div class="sb">' + esc(lk.source || '') + '</div>' : '') + '</div>' +
            this._art(lk, now, lw, arth2, true) + ctl + this._apps(apps, 5, aw2) +
            (xl ? '' : '<div class="row foot" style="justify-content:space-between"><button type="button" class="pill" data-notap data-act="sheet">' + svg('remote', 18) + 'Remote</button>' +
              (lk.onPlayer ? '<button type="button" class="rb" data-notap data-act="power" aria-label="Power">' + svg('power') + '</button>' : '') + '</div>') + '</div>';
          if (!xl) body = left;
          else {
            var d = Math.max(120, Math.min(206, ih - (can.player && can.tv ? 38 : 0) - 44 - 2 * gap));
            body = '<div class="row" style="align-items:stretch;gap:22px;height:100%">' + left +
              '<div style="flex:none;width:206px;display:flex;flex-direction:column;align-items:center;justify-content:space-between">' +
              (can.player || can.tv ? this._remote(d, set, to, can) : '') + '</div></div>';
          }
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
          else if (a === 'sheet' && s && window.hkShell && window.hkShell.moreInfo) window.hkShell.moreInfo(s.tv || s.player);
        });
      });
      this._root.querySelectorAll('[data-vol]').forEach(function (b) {
        b.addEventListener('click', function (e) { e.stopPropagation(); self._run(T.volume(self.client, cur(), b.getAttribute('data-vol'))); });
      });
      this._root.querySelectorAll('.vol').forEach(function (el) { el.addEventListener('click', function (e) { e.stopPropagation(); }); });
      var range = /** @type {HTMLInputElement|null} */ (this._root.querySelector('.vol input'));
      if (range) {
        var send = C.throttle ? C.throttle(function (/** @type {number} */ x) { self._run(T.volume(self.client, cur(), 'set', x)); }, 250) :
          function (/** @type {number} */ x) { self._run(T.volume(self.client, cur(), 'set', x)); };
        range.addEventListener('input', function () { send(Number(range.value) / 100); });
      }
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
