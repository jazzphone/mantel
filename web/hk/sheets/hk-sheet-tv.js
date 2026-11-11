// hk-sheet-tv.js - The TV sheet: a room's TV and its player as one (phase 23, docs/phase23/TV.md; web/hk/modules/hk-tv.js reads them).
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-tv'] = function (K) {
    var esc = K.esc, Panel = K.Panel, PANEL_CSS = K.PANEL_CSS, SP = K.SP, throttle = K.throttle;

    var v = function (/** @type {string} */ n) { return window.hkCards.v(n); };

    var I = {
      up: '<path d="M12 7.5l7 7-1.6 1.6-5.4-5.4-5.4 5.4L5 14.5z"/>',
      back: '<path d="M14.5 5l1.6 1.6L10.7 12l5.4 5.4-1.6 1.6-7-7z"/>',
      home: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 14.5zM8 19h8v1.5H8z"/>',
      pp: '<path d="M3 5.5v13l9-6.5zM14 5h2.8v14H14zM18.6 5h2.8v14h-2.8z"/>',
      play: '<path d="M7 4.6v14.8c0 1 1.1 1.6 2 1.1l11.6-7.4c.8-.5.8-1.7 0-2.2L9 3.5c-.9-.5-2 .1-2 1.1Z"/>',
      pause: '<rect x="6" y="4.5" width="4.4" height="15" rx="1.6"/><rect x="13.6" y="4.5" width="4.4" height="15" rx="1.6"/>',
      power: '<path d="M11 3h2v9h-2zM7.05 6.05l1.42 1.42A6 6 0 1 0 15.53 7.47l1.42-1.42A8 8 0 1 1 7.05 6.05z"/>',
      minus: '<rect x="5" y="11" width="14" height="2.2" rx="1.1"/>',
      plus: '<rect x="5" y="11" width="14" height="2.2" rx="1.1"/><rect x="10.9" y="5" width="2.2" height="14" rx="1.1"/>',
      spk: '<path d="M4 9h4l5-4v14l-5-4H4z"/>',
      spk2: '<path d="M3 9h4l5-4v14l-5-4H3zM15.5 8.5a5 5 0 0 1 0 7l-1.2-1.2a3.3 3.3 0 0 0 0-4.6zM18 6a8.5 8.5 0 0 1 0 12l-1.2-1.2a6.8 6.8 0 0 0 0-9.6z"/>'
    };

    /** @param {string} k @param {number} [n] */
    function svg(k, n) { return '<svg viewBox="0 0 24 24" width="' + (n || 22) + '" height="' + (n || 22) + '" aria-hidden="true" fill="currentColor">' + I[k] + '</svg>'; }

    // an app's tile: its App Store icon, else Apple's own glyph, else its name
    /** @param {any} a @param {string} [cls] */
    function tile(a, cls) {
      var inner = a.icon ? '<img src="' + esc(a.icon) + '" alt="" loading="lazy" draggable="false">' : a.glyph ? '<hk-icon icon="' + esc(a.glyph) + '"></hk-icon>' : '<span>' + esc(a.name) + '</span>';
      return '<button type="button" class="app' + (a.icon ? ' pic' : a.glyph ? ' gl' : ' nm') + (a.now ? ' now' : '') + (cls ? ' ' + cls : '') + '" data-app="' + esc(a.name) +
        '" aria-label="' + esc(a.name) + '">' + inner + '</button>';
    }

    class TvPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          ':host{display:flex;flex-direction:column}',
          ':host > div{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
          '.pn{flex:1 1 auto;min-height:0;gap:' + SP.block + 'px}',
          '.col{display:flex;flex-direction:column;gap:' + SP.block + 'px;min-width:0}',
          '.crd{padding:' + SP.cardPad + ';border-radius:' + SP.cardR + 'px;background:rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:12px;min-width:0}',
          ':host([hk-flat]) .crd{background:' + v('key') + '}',
          '.lab{margin:0;display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
          '.lab button{all:unset;cursor:pointer;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;color:' + v('ink-2') + '}',
          // WATCHING: the picture, what's on, play/pause and power
          '.now{display:flex;gap:16px;align-items:center;min-width:0}',
          // THE PICTURE: the player's artwork; else the open app's icon on a wash of its own colors; else a dark screen with the glyph.
          // Every background part said on its own, so a picture never repeats (a shorthand with a theme's value in it could fall back)
          '.art{position:relative;overflow:hidden;flex:0 0 auto;width:176px;aspect-ratio:16/9;border-radius:12px;display:grid;place-items:center;',
          '  background-color:#101018;background-position:center;background-size:cover;background-repeat:no-repeat}',
          '.art.scr{background-image:linear-gradient(155deg,#2a2a36 0%,#14141c 55%,#0a0a10 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}',
          '.art.scr hk-icon{--mdc-icon-size:40px;width:40px;height:40px;color:rgba(255,255,255,.42)}',
          // (the open app's icon in the middle of a black picture: the owner, 2026-11-11 -- not a bright wash of its colors)
          '.art.ico{background-color:#050507;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}',
          '.art .aic{position:relative;height:62%;aspect-ratio:1;border-radius:12px;box-shadow:0 4px 14px rgba(0,0,0,.35);object-fit:cover}',
          '.words{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
          '.ttl{font-size:17px;font-weight:600;letter-spacing:-.3px;color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.sub{font-size:13px;font-weight:500;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.ctl{display:flex;gap:12px;margin-top:10px}',
          '.rb{all:unset;box-sizing:border-box;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;cursor:pointer;background:' + v('key') + ';color:' + v('ink') + ';flex:none}',
          '.rb.solid{background:rgba(255,255,255,.94);color:#1c1c1e}',
          '.rb.on{background:rgba(255,255,255,.94);color:#1c1c1e}',
          '.rb:active{transform:scale(.94)}',
          '.rb:focus-visible,.app:focus-visible,.chip:focus-visible,.k:focus-visible,.ok:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
          // VOLUME
          '.vol{display:flex;align-items:center;gap:10px;min-width:0}',
          '.vol svg{color:' + v('ink-2') + ';flex:none}',
          '.vol input{flex:1 1 auto;min-width:0;-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:' + v('line-strong') + ';outline:none;margin:0}',
          '.vol input::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3)}',
          '.vol input::-moz-range-thumb{width:26px;height:26px;border:0;border-radius:50%;background:#fff}',
          '.steps{display:flex;align-items:center;justify-content:center;gap:14px}',
          '.steps span{font-size:13px;font-weight:600;color:' + v('ink-2') + ';min-width:64px;text-align:center}',
          // INPUTS
          '.chips{display:flex;flex-wrap:wrap;gap:8px}',
          '.chip{all:unset;box-sizing:border-box;height:36px;border-radius:18px;padding:0 14px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;',
          '  font-size:13px;font-weight:600;background:' + v('key') + ';color:' + v('ink') + ';max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.chip.on{background:rgba(255,255,255,.94);color:#1c1c1e}',
          '.chip small{font-weight:500;opacity:.7}',
          // APPS: 64 px tiles, the one open ringed
          '.apps{display:grid;grid-template-columns:repeat(auto-fill,64px);gap:12px;justify-content:space-between}',
          '.app{all:unset;box-sizing:border-box;width:64px;height:64px;border-radius:12px;cursor:pointer;position:relative;display:grid;place-items:center;overflow:hidden;',
          '  background:' + v('key') + ';color:' + v('ink') + ';box-shadow:0 2px 6px rgba(0,0,0,.18)}',
          '.app img{width:100%;height:100%;object-fit:cover;display:block}',
          '.app.gl{background:#111;color:#fff}.app.gl hk-icon{--mdc-icon-size:30px;width:30px;height:30px}',
          '.app.nm span{font-size:11px;font-weight:600;line-height:1.15;text-align:center;padding:4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
          // (the app that's open: a ring that is the tile's own outline, so it follows its corners exactly -- a dark hairline, then white,
          // so it shows on a white icon too; the owner, 2026-11-11: a separate ring with its own corners looked like a UI error)
          '.app.now{box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 0 5px #fff,0 0 16px 4px rgba(255,255,255,.3)}',
          '.app:active{transform:scale(.95)}',
          '.all{max-height:300px;overflow-y:auto;overscroll-behavior:contain}',
          // THE REMOTE
          '.rem{align-items:center;gap:16px;padding-top:18px}',
          '.seg{display:flex;gap:2px;padding:3px;border-radius:12px;background:' + v('key') + '}',
          '.seg button{all:unset;cursor:pointer;font-size:13px;font-weight:600;padding:9px 16px;border-radius:8px;color:' + v('ink-2') + '}',
          '.seg button.on{background:rgba(255,255,255,.94);color:#1c1c1e}',
          '.dpad{position:relative;width:236px;height:236px;border-radius:50%;background:' + v('key') + ';box-shadow:inset 0 0 0 1px ' + v('line') + ';flex:none;touch-action:manipulation}',
          '.k{all:unset;position:absolute;width:27%;height:27%;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:' + v('ink') + '}',
          '.k:active,.k.hit{background:' + v('key-strong') + '}',
          '.k.u{left:36.5%;top:2%}.k.d{left:36.5%;bottom:2%;transform:rotate(180deg)}.k.l{left:2%;top:36.5%;transform:rotate(-90deg)}.k.r{right:2%;top:36.5%;transform:rotate(90deg)}',
          '.ok{all:unset;position:absolute;left:31%;top:31%;width:38%;height:38%;border-radius:50%;display:grid;place-items:center;cursor:pointer;font-size:15px;font-weight:600;',
          '  color:' + v('ink') + ';background:' + v('key-strong') + ';box-shadow:inset 0 0 0 1px ' + v('line') + '}',
          '.ok:active,.ok.hit{background:rgba(255,255,255,.3)}',
          '.keys{display:flex;gap:16px;justify-content:center}.keys .rb{width:52px;height:52px}',
          '.kl{display:flex;gap:16px;justify-content:center;margin-top:12px;font-size:11px;font-weight:500;color:' + v('ink-2') + '}.kl span{width:52px;text-align:center}',
          '.none{font-size:15px;color:' + v('ink-2') + ';text-align:center;margin:auto}',
          '.note{font-size:13px;color:' + v('ink-3') + ';text-align:center}',
          // TWO COLUMNS ON A TABLET: the screen left, the remote right (300)
          ':host([wide]) .pn{flex-direction:row;gap:' + SP.region + 'px;padding:0;align-items:stretch}',
          ':host([wide]) .col.l{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}',
          ':host([wide]) .col.l::-webkit-scrollbar{display:none}',
          ':host([wide]) .col.r{flex:0 0 300px}',
          // (the remote spread down its card: the switch at the top, the pad as big as the column takes, the keys toward the foot)
          ':host([wide]) .col.r .crd{flex:1 1 auto;justify-content:space-evenly}',
          ':host([wide]) .dpad{width:264px;height:264px}',
          ':host([wide]) .keys{gap:22px}:host([wide]) .kl{gap:22px}:host([wide]) .keys .rb{width:58px;height:58px}:host([wide]) .kl span{width:58px}',
          // (the left column's last card takes what's left, so both columns end on the sheet's bottom inset: 2026-11-11, the owner)
          ':host([wide]) .col.l > .crd.fill{flex:1 0 auto}',
          // ONE COLUMN ON A PHONE: one scroll, the remote after Watching
          ':host(:not([wide])) .pn{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}',
          ':host(:not([wide])) .pn::-webkit-scrollbar{display:none}',
          ':host(:not([wide])) .art{width:128px}'
        ].join('');
      }
      hkWidthKind() { return 'tv'; }
      hkFill() { return true; }
      hkNoGear() { return true; }
      _wideAt() { return 700; }
      _onWide() { this._built = false; this._render(); }
      _set() {
        var T = window.hkTv, cfg = this._config || {};
        return T ? T.setFor(this.client, cfg.tv || this._id || cfg.entity || null) : null;
      }
      _sigOf() {
        var T = window.hkTv, set = this._set(), s = (this.client && this.client.states) || {};
        if (!T || !set) return 'none';
        var out = set.id + '|' + this.hasAttribute('wide') + '|' + (this._to || '') + '|' + (this._all ? 1 : 0) + '|';
        T.ids(set).forEach(function (id) { var st = s[id]; out += id + '=' + (st ? st.state + '@' + (st.last_updated || '') : 'x') + ';'; });
        return out;
      }
      disconnectedCallback() {
        super.disconnectedCallback();
        this._to = null; this._all = false;         // (Apple TV | TV goes back to whatever is on screen)
      }
      /** @param {any[][]} calls */
      _run(calls) {
        var self = this, i = 0;
        // (a turn_on first gives the device a moment before the next call: an app chosen from a dark room)
        function next() {
          if (i >= calls.length) return;
          var c = calls[i++];
          Promise.resolve(self._call(c[0], c[1], c[2])).catch(function () { /* the next still goes */ }).then(function () {
            setTimeout(next, c[1] === 'turn_on' ? 2500 : 120);
          });
        }
        next();
      }
      _render() {
        var self = this, T = window.hkTv, set = this._set();
        if (!T || !set) { this._root.innerHTML = '<div class="pn"><div class="none">This TV isn’t available.</div></div>'; this._built = false; return; }
        var lk = T.look(this.client, set), can = T.canArrows(this.client, set), wide = this.hasAttribute('wide');
        var to = this._to && can[this._to] ? this._to : lk.arrows;
        if (!this._built || this._builtFor !== set.id) {
          this._built = true; this._builtFor = set.id; this._appsKey = ''; this._inKey = ''; this._artKey = '';
          var seg = can.player && can.tv ? '<div class="seg" role="tablist" aria-label="The remote controls"><button type="button" data-to="player">' +
            (set.remotes.playerKind === 'apple_tv' ? 'Apple TV' : 'Player') + '</button><button type="button" data-to="tv">TV</button></div>' : '';
          var remote = can.player || can.tv ? '<div class="crd rem">' + seg +
            '<div class="dpad"><button type="button" class="k u" data-key="up" aria-label="Up">' + svg('up', 28) + '</button><button type="button" class="k d" data-key="down" aria-label="Down">' +
              svg('up', 28) + '</button>' +
            '<button type="button" class="k l" data-key="left" aria-label="Left">' + svg('up', 28) + '</button><button type="button" class="k r" data-key="right" aria-label="Right">' + svg('up', 28) +
              '</button>' +
            '<button type="button" class="ok" data-key="select">OK</button></div>' +
            '<div><div class="keys"><button type="button" class="rb" data-key="back" aria-label="Back">' + svg('back', 24) +
              '</button><button type="button" class="rb" data-key="home" aria-label="Home">' + svg('home', 24) + '</button>' +
            '<button type="button" class="rb" data-key="play_pause" aria-label="Play or pause">' + svg('pp', 24) +
              '</button></div><div class="kl"><span>Back</span><span>Home</span><span>Play</span></div></div>' +
            '<div class="steps vs" hidden><button type="button" class="rb" data-vol="down" aria-label="Volume down">' + svg('minus') +
              '</button><span>Volume</span><button type="button" class="rb" data-vol="up" aria-label="Volume up">' + svg('plus') + '</button></div>' +
            '</div>' : '';
          var left = '<div class="crd"><div class="lab">Watching</div><div class="now"><div class="art"></div><div class="words"><div class="ttl"></div><div class="sub"></div>' +
            '<div class="ctl"><button type="button" class="rb solid pp" aria-label="Play or pause">' + svg('pause') + '</button><button type="button" class="rb pw" aria-label="Power">' +
              svg('power') + '</button></div></div></div>' +
            '<div class="vol" hidden>' + svg('spk', 16) + '<input type="range" min="0" max="100" step="1" aria-label="Volume">' + svg('spk2', 18) + '</div></div>' +
            '<div class="crd ins" hidden><div class="lab">Input</div><div class="chips"></div></div>' +
            '<div class="crd aps" hidden><div class="lab"><span class="at">Recent Apps</span><button type="button" class="tog">All Apps…</button></div><div class="apps"></div></div>';
          this._root.innerHTML = '<div class="pn"><div class="col l">' + left + (wide ? '' : remote) + '</div>' + (wide && remote ? '<div class="col r">' + remote + '</div>' : '') + '</div>';
          var q0 = function (/** @type {string} */ s) { return self._root.querySelector(s); };
          this._root.querySelectorAll('[data-to]').forEach(function (b) {
            b.addEventListener('click', function () { self._to = b.getAttribute('data-to'); self._render(); });
          });
          this._root.querySelectorAll('[data-key]').forEach(function (b) {
            b.addEventListener('click', function () {
              var cur = self._set(), lk2 = T.look(self.client, cur), c2 = T.canArrows(self.client, cur), dest = self._to && c2[self._to] ? self._to : lk2.arrows;
              if (!dest) return;
              b.classList.add('hit'); setTimeout(function () { b.classList.remove('hit'); }, 160);
              self._run(T.press(self.client, cur, dest, b.getAttribute('data-key')));
            });
          });
          this._root.querySelectorAll('[data-vol]').forEach(function (b) {
            b.addEventListener('click', function () { self._run(T.volume(self.client, self._set(), b.getAttribute('data-vol'))); });
          });
          var send = throttle(function (/** @type {number} */ x) { self._run(T.volume(self.client, self._set(), 'set', x)); }, 250);
          var range = /** @type {HTMLInputElement} */ (q0('.vol input'));
          range.addEventListener('input', function () { self._drag = Date.now(); send(Number(range.value) / 100); });
          q0('.pp').addEventListener('click', function () { self._run(T.playPause(self.client, self._set())); });
          q0('.pw').addEventListener('click', function () { self._run(T.power(self.client, self._set())); });
          q0('.tog').addEventListener('click', function () { self._all = !self._all; self._appsKey = ''; self._render(); });
          this._root.addEventListener('click', function (ev) {
            var t = /** @type {HTMLElement} */ (ev.target), b = t && t.closest ? t.closest('[data-app],[data-input]') : null;
            if (!b) return;
            var cur = self._set();
            if (b.hasAttribute('data-app')) { self._run(T.open(self.client, cur, b.getAttribute('data-app'))); if (self._all) { self._all = false; self._appsKey = ''; } }
            else self._run(T.input(self.client, cur, b.getAttribute('data-input')));
          });
        }
        var q = function (/** @type {string} */ s) { return self._root.querySelector(s); };
        // WATCHING
        var art = q('.art'), apps = T.apps(this.client, set, undefined, this._all ? undefined : (wide && this._fitN) || 8), nowApp = apps.filter(function (a) { return a.now; })[0];
        var artKey = lk.art ? 'a' + lk.art : nowApp && nowApp.icon ? 'i' + nowApp.icon : 's';
        if (artKey !== this._artKey) {
          this._artKey = artKey;
          var url = function (/** @type {string} */ u) { return 'url("' + u.replace(/"/g, '%22') + '")'; };
          art.className = 'art' + (artKey === 's' ? ' scr' : artKey.charAt(0) === 'i' ? ' ico' : '');
          art.style.backgroundImage = lk.art ? url(lk.art) : '';
          art.innerHTML = lk.art ? '' : nowApp && nowApp.icon ? '<img class="aic" alt="" src="' + esc(nowApp.icon) + '">'
            : '<hk-icon icon="hk:television"></hk-icon>';
        }
        q('.ttl').textContent = lk.title;
        q('.sub').textContent = lk.sub || (lk.onPlayer ? '' : lk.tvOn ? 'On the TV' : lk.unavailable ? 'Unavailable' : '');
        var pp = q('.pp');
        pp.hidden = !lk.onPlayer;
        pp.innerHTML = svg(lk.playing ? 'pause' : 'play');
        q('.pw').classList.toggle('on', lk.on);
        // VOLUME: a slider where the device takes a level; - and + on the remote where it only steps
        var vol = lk.volume, vr = q('.vol'), vs = q('.vs');
        vr.hidden = vol.mode !== 'set';
        if (vol.mode === 'set' && vol.level != null && !(this._drag && Date.now() - this._drag < 1500)) {
          /** @type {HTMLInputElement} */ (vr.querySelector('input')).value = String(Math.round(vol.level * 100));
        }
        if (vs) vs.hidden = vol.mode !== 'step';
        // THE REMOTE: which way it points
        this._root.querySelectorAll('[data-to]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-to') === to); });
        this._root.querySelectorAll('.dpad button,.keys button').forEach(function (b) { /** @type {HTMLButtonElement} */ (b).disabled = !to; });
        // INPUTS: the TV's own, the player's named for it
        var ins = q('.ins'), inKey = JSON.stringify(lk.inputs) + lk.tvOn;
        ins.hidden = !set.tv || !lk.tvOn || !lk.inputs.length;
        if (inKey !== this._inKey) {
          this._inKey = inKey;
          q('.chips').innerHTML = lk.inputs.map(function (/** @type {any} */ x) {
            return '<button type="button" class="chip' + (x.on ? ' on' : '') + '" data-input="' + esc(x.name) + '">' +
              esc(x.player ? (set.remotes.playerKind === 'apple_tv' ? 'Apple TV' : 'Player') : x.name) +
              (x.player ? '<small>' + esc(x.name) + '</small>' : '') + '</button>';
          }).join('');
        }
        // APPS
        var aps = q('.aps');
        aps.hidden = !set.player || !apps.length;
        var list = this._all ? T.allApps(this.client, set) : apps, appsKey = JSON.stringify(list) + this._all;
        if (appsKey !== this._appsKey) {
          this._appsKey = appsKey;
          var box = q('.apps');
          box.className = 'apps' + (this._all ? ' all' : '');
          box.innerHTML = list.map(function (/** @type {any} */ a) { return tile(a); }).join('');
          q('.at').textContent = this._all ? 'All Apps' : (window.hkSettings && window.hkSettings.get('features.tv_show', 'recent') === 'favorites' ? 'Favorite Apps' : 'Apps');
          q('.tog').textContent = this._all ? 'Done' : 'All Apps…';
        }
        // THE LAST CARD SHOWN ON THE LEFT reaches the foot (.fill)
        var shown = Array.prototype.filter.call(this._root.querySelectorAll('.col.l > .crd'), function (el) { return !el.hidden; });
        shown.forEach(function (el, i) { el.classList.toggle('fill', i === shown.length - 1); });
        // AS MANY APPS AS FIT: the Apps card filling to the foot holds more rows, not bare plate (a TV that's off has no Input card).
        // Measured against the column's own foot, which the sheet sets, never the card's, which its apps set.
        if (wide && !this._all && !aps.hidden) {
          var col = this._root.querySelector('.col.l'), grid = q('.apps'), cb = col.getBoundingClientRect(), gb = grid.getBoundingClientRect();
          var cols = Math.max(1, Math.floor((gb.width + 12) / 76)), rows = Math.max(2, Math.floor((cb.bottom - gb.top - 14 + 12) / 76));
          if (gb.width > 0 && cols * rows !== (this._fitN || 8)) { this._fitN = cols * rows; this._appsKey = ''; this._render(); }
        }
      }
    }

    if (!customElements.get('hk-detail-tv')) customElements.define('hk-detail-tv', /** @type {any} */ (TvPanel));

    // what the shell and the later parts use of this one
    K.TvPanel = TvPanel;
  };
})();
