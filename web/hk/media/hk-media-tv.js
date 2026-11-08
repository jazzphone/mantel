// hk-media-tv.js - the Home Grid's Live TV channels block.
//
// PART OF THE MUSIC AND MEDIA CARDS (hk-media.js). Not a card and not run on its own: it registers one
// function, which hk-media.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkMediaParts = window.hkMediaParts || {})['hk-media-tv'] = function (K) {
    var C = K.C, esc = K.esc, HkBase = K.HkBase, tintOf = K.tintOf;

    // -------------------------------------------------- hk-tv-channels-card
    //
    // THE LIVE TV BLOCK (2026-10-31, the owner: "channels (a tile per channel
    // in its color, what is on, a progress bar); a tap opens that channel full
    // screen as the Live TV page does. No remote buttons"), mounted in the
    // Home Grid's `live_tv` panel block (hk-grid-cards.js). Small one
    // channel, Wide two, Tall three, Large four, Extra Large six -- the Live
    // TV page's first, in its order.
    //
    // THE PAGE'S OWN CHANNELS AND PLAYER (hk-cameras.js hk-tv-guide-card):
    // ws hk_tv/channels, asked again when the socket comes back and on a
    // back-off while the answer is empty (an HA restart says "not set up
    // yet"); each channel's `now` sensor for what is on; and its full-screen
    // player, hkCameras.tvPlayer, with its viewer heartbeat and idle hold.
    // A Mantel page loads hk-cameras.js when it is first needed (hkNeed).
    var TV_SLOTS = { S: 1, W: 2, T: 3, L: 4, XL: 6 };
    var TV_BACKOFF = [5000, 15000, 60000, 300000];
    function tvShare(a) {
      var s = +new Date(a.start), e = +new Date(a.end), n = Date.now();
      return e > s ? Math.max(0, Math.min(100, (n - s) / (e - s) * 100)) : 0;
    }
    // [columns, rows] for k channels in a size's slots
    function tvGrid(size, k) {
      if (size === 'T') return [1, k];
      if (size === 'L' || size === 'XL') { var r = k > (size === 'XL' ? 3 : 2) ? 2 : 1; return [Math.ceil(k / r), r]; }
      return [k, 1];
    }
    var TV_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.tv{position:relative;box-sizing:border-box;height:100%;display:grid;gap:10px;overflow:hidden;padding:' + C.blockPad('14px') + ';' + C.plate('card') + ';',
      '  grid-template-columns:repeat(var(--n,1),minmax(0,1fr));grid-template-rows:repeat(var(--r,1),minmax(0,1fr))}',
      // S: the one channel is the block (on its plate, which keeps the look's material)
      // (a channel chosen fills the block at any size, as Small's does)
      'hk-plate.tv.one{padding:0}',
      '.ch{all:unset;box-sizing:border-box;position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;padding:12px;',
      '  border-radius:var(--hk-inner-radius,' + C.R.inner + 'px);background:linear-gradient(150deg,var(--c1),var(--c2));color:#fff;cursor:pointer;',
      '  overflow:hidden;container-type:size;text-shadow:0 1px 2px rgba(0,0,0,.22);-webkit-tap-highlight-color:transparent;transition:transform .12s ease}',
      '.ch:active{transform:scale(.98)}',
      '.ch:focus-visible{outline:2px solid #fff;outline-offset:-4px}',
      '.one .ch{position:absolute;inset:0;border-radius:inherit;padding:' + C.blockPad('14px') + '}',
      // NOTHING STRETCHES (2026-11-08, the owner; DESIGN.md "Using the space"): a channel is one tile of a designed shape -- 4 : 3,
      // 3 : 2 or 16 : 10 (the guide's pictures are 16 : 9), the tallest of them that shows every channel the block names in the room it
      // has -- as wide as the block's columns make it (set by _fit: --tw, --ar), as many as the room holds, the group centered with equal
      // margins and its last row centered, never a tile spanning it. Large and Extra Large open with a label row, as the widget blocks
      // do: LIVE TV at the label role, and how many more channels the guide has at its right
      'hk-plate.tv:not(.one){display:flex;flex-direction:column;gap:10px}',
      '.gr{flex:1 1 0;min-height:0;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-content:center}',
      '.gr .ch{flex:none;width:var(--tw,160px);aspect-ratio:var(--ar,16/10)}',
      '.lh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:none;min-width:0;' + C.labelCss('label') + ';line-height:18px;color:' + C.v('ink-2') + '}',
      '.lh em{font-style:normal;' + C.typeCss('caption') + ';line-height:18px;text-transform:none;letter-spacing:0;white-space:nowrap}',
      // ITS MARK: the guide's logo on white where it has one, else its number
      '.lg{display:grid;place-items:center;flex:none;align-self:flex-start;min-width:38px;height:38px;padding:0 7px;box-sizing:border-box;',
      '  border-radius:' + C.R.small + 'px;background:rgba(255,255,255,.25);' + C.typeCss('body') + ';font-weight:800;font-variant-numeric:tabular-nums;text-shadow:none}',
      '.lg.pic{background:rgba(255,255,255,.9);padding:5px 7px}.lg img{display:block;max-height:100%;max-width:72px;object-fit:contain}',
      '.one .lg{min-width:52px;height:52px;' + C.typeCss('title') + ';font-weight:800}',
      // (a channel chosen on a big block -- Tall, Large, Extra Large: `big`, set from its size, as neither a <button>
      // nor the cell from inside the panel answers a size query in WebKit -- its mark and its words as large as the room)
      '.one.big .lg{min-width:76px;height:76px;padding:0 10px;font-size:30px;line-height:34px}.one.big .lg img{max-width:120px}',
      '.one.big .tx b{' + C.typeCss('title') + ';line-height:27px}.one.big .tx small{' + C.typeCss('body') + ';line-height:20px}',
      // WHAT'S ON'S ART BEHIND THE CHANNEL (2026-11-08, the owner: "the What's On artwork that the Live TV page displays as the
      // background for the channels ... a little dim"): the page's picture (the now sensor's `image`, as the page's tile draws it) fills
      // the tile, the channel's color over it and a scrim -- lighter at the top, where the mark is, darker under the words -- so the white
      // mark and words pass 4.5:1 on any picture; no picture (or one that never loads), the color alone
      '.bg{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none}.bg img{display:block;width:100%;height:100%;object-fit:cover}',
      '.bg::before,.bg::after{content:"";position:absolute;inset:0}.bg::before{background:linear-gradient(150deg,var(--c1),var(--c2));opacity:.32}',
      '.bg::after{background:linear-gradient(180deg,rgba(0,0,0,.3),rgba(0,0,0,.38) 40%,rgba(0,0,0,.74))}',
      '.ch>:not(.bg){position:relative}.art .lg:not(.pic){background:rgba(0,0,0,.34)}.art .bar{background:rgba(255,255,255,.34)}',
      '.tx{display:flex;flex-direction:column;min-width:0;margin-top:auto}',
      '.tx b{' + C.typeCss('body') + ';font-weight:600;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tx small{' + C.typeCss('caption') + ';line-height:16px;color:rgba(255,255,255,.86);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.one .tx b{' + C.typeCss('headline') + ';line-height:22px}',
      // HOW FAR THROUGH what is on
      '.bar{display:block;flex:none;height:4px;margin-top:8px;border-radius:' + C.R.capsule('4px') + ';background:rgba(255,255,255,.3);overflow:hidden}',
      '.bar i{display:block;height:100%;border-radius:' + C.R.capsule('4px') + ';background:#fff}',
      // (a short tile -- three down a Tall block on tile cells: its words and its
      // bar; the query reads the tile's content box, inside its 12 px padding)
      '@container (max-height:84px){.lg{display:none}}',
      '.none{grid-column:1 / -1;align-self:center;text-align:center;' + C.typeCss('caption') + ';color:' + C.v('ink-2') + '}'
    ].join('');

    class HkTvChannelsCard extends HkBase {
      static get CSS() { return TV_CSS; }
      getCardSize() { return 4; }
      _size() { var s = this.getAttribute('size'); return TV_SLOTS[s] ? s : 'L'; }
      // THE CHANNEL CHOSEN (the block's Channel option, 2026-10-31, the owner), by its guide number: it fills the
      // block. One the guide no longer has is left out, and the block shows the guide's first, as with none chosen.
      _chosen() {
        var n = this._config && this._config.channel;
        return n ? (this._channels || []).filter(function (c) { return c.number === n; })[0] || null : null;
      }
      _shown() {
        var one = this._chosen();
        return one ? [one] : (this._channels || []).slice(0, TV_SLOTS[this._size()]);
      }
      _sigOf() {
        var h = this.client;
        if (!h) return null;
        return JSON.stringify([this._size(), this._channels ? this._shown().map(function (c) {
          var st = c.now && h.states[c.now];
          return [c.number, c.name, c.camera, st ? st.last_updated : 'x'];
        }) : null, !!this._configured, this._blockKey || '']);
      }
      // the open player follows the house, as the page's does
      _receiveClient() {
        super._receiveClient();
        if (this._player) this._player.update(this.client);
      }
      _fetch() {
        var h = this.client, self = this;
        if (this._loading || !h || !h.callWS) return;
        clearTimeout(this._chanT); this._chanT = null;
        this._loading = true;
        Promise.resolve(h.callWS({ type: 'hk_tv/channels' })).then(function (r) {
          var list = (r && r.channels) || [];
          // (an empty answer never replaces channels already drawn: right after a restart it means "not yet")
          if (list.length || !(self._channels && self._channels.length)) { self._channels = list; self._configured = !!(r && r.configured); }
          return list.length > 0;
        }, function () {
          if (!self._channels) { self._channels = []; self._configured = false; }
          return false;
        }).then(function (good) {
          self._loading = false;
          if (good) self._tries = 0;
          else if (self.isConnected !== false && !self._chanT) {
            var n = self._tries = (self._tries || 0) + 1;
            self._chanT = setTimeout(function () { self._chanT = null; self._fetch(); }, TV_BACKOFF[Math.min(n - 1, TV_BACKOFF.length - 1)]);
          }
          self.redraw();
        });
      }
      // the socket back (an HA restart): the channels asked again
      _watchConn() {
        var conn = this.client && this.client.subscriptions, self = this;
        if (this.isConnected === false || !conn || conn === this._conn || typeof conn.addEventListener !== 'function') return;
        this._unwatchConn();
        this._conn = conn;
        this._onReady = function () { self._tries = 0; self._fetch(); };
        conn.addEventListener('ready', this._onReady);
      }
      _unwatchConn() {
        if (this._conn && this._onReady && typeof this._conn.removeEventListener === 'function') this._conn.removeEventListener('ready', this._onReady);
        this._conn = null; this._onReady = null;
      }
      _render() {
        var h = this.client, s = this._size(), self = this;
        if (!h) return;
        this._watchConn();
        if (this._watchBlock) this._watchBlock();
        if (!this._channels) this._fetch();
        var list = this._shown(), g = tvGrid(s, Math.max(1, list.length));
        this._bars = [];
        if (!list.length) {
          this._root.innerHTML = '<hk-plate class="tv" data-hk-role="card"><div class="none"></div></hk-plate>';
          this._root.querySelector('.none').textContent = !this._channels ? '' : this._configured
            ? 'No channels yet. Add some in ' + window.hkShell.settingsPlace('Pages → Live TV') + '.' : 'Add Live TV to show its channels here.';
          return;
        }
        var plate = document.createElement('hk-plate');
        plate.className = 'tv' + (s === 'S' || this._chosen() ? ' one' : '') + (this._chosen() && /^(T|L|XL)$/.test(s) ? ' big' : '');
        plate.setAttribute('data-hk-role', 'card');
        plate.style.setProperty('--n', g[0]); plate.style.setProperty('--r', g[1]);
        var gr = plate;
        if (!plate.classList.contains('one')) {
          // (Large and Extra Large: the label row over the tiles, which stand in a group of their own)
          if (s === 'L' || s === 'XL') { var lh = document.createElement('div'); lh.className = 'lh'; lh.innerHTML = '<span>Live TV</span><em></em>'; plate.appendChild(lh); }
          gr = document.createElement('div'); gr.className = 'gr'; plate.appendChild(gr);
        }
        list.forEach(function (ch, i) {
          var st = (ch.now && h.states[ch.now]) || { state: '', attributes: {} }, a = st.attributes || {};
          var t = tintOf(ch.number || ch.name), on = st.state && st.state !== 'unknown' && st.state !== 'unavailable' ? st.state : 'Live';
          var b = document.createElement('button');
          b.type = 'button'; b.className = 'ch';
          b.style.setProperty('--c1', t[0]); b.style.setProperty('--c2', t[1]);
          b.setAttribute('aria-label', 'Watch ' + (ch.name || ch.number) + ', ' + on);
          b.innerHTML = (a.image ? '<span class="bg"></span>' : '') + '<span class="lg"></span><span class="tx"><b></b><small></small></span>' + (a.start && a.end ? '<i class="bar"><i></i></i>' : '');
          if (a.image) { b.classList.add('art'); self._artImage(a.image, b.querySelector('.bg'), '', s === 'S' || self._chosen() ? 600 : 300); }
          var lg = b.querySelector('.lg'), mono = esc(ch.number || String(ch.name || '').slice(0, 2));
          if (a.logo) { lg.classList.add('pic'); self._artImage(a.logo, lg, mono, 150); lg.addEventListener('error', function () { lg.classList.remove('pic'); }, true); }
          else lg.innerHTML = mono;
          b.querySelector('b').textContent = on;
          b.querySelector('small').textContent = ch.name || ch.number || '';
          if (a.start && a.end) self._bars.push({ el: b.querySelector('.bar i'), a: a });
          b.addEventListener('click', function (e) { e.stopPropagation(); self._open(ch); });
          gr.appendChild(b);
        });
        this._root.innerHTML = '';
        this._root.appendChild(plate);
        this._fit(plate, g);
        this._tick();
      }
      // THE TILES' SIZE AND HOW MANY (2026-11-08): the width the columns give a tile in the room under the label row; its shape the tallest of
      // 4 : 3, 3 : 2 and 16 : 10 that has every channel the block names in the room (none does: 16 : 10, as many as the rows hold); the
      // rest are the page's, said at the label row's right ("6 more")
      _fit(plate, g) {
        var gr = plate.querySelector('.gr');
        if (!gr || typeof getComputedStyle !== 'function' || !gr.clientWidth) return;
        var gap = 10, W = gr.clientWidth, H = gr.clientHeight, cols = g[0], kids = Array.prototype.slice.call(gr.children), n = kids.length;
        var tw = (W - (cols - 1) * gap) / cols, need = Math.ceil(n / cols), pick = null;
        [{ r: 3 / 4, ar: '4/3' }, { r: 2 / 3, ar: '3/2' }, { r: 10 / 16, ar: '16/10' }].forEach(function (o) { if (!pick && need * tw * o.r + (need - 1) * gap <= H) pick = o; });
        pick = pick || { r: 10 / 16, ar: '16/10' };
        var th = tw * pick.r, rows = Math.max(1, Math.floor((H + gap) / (th + gap)));
        // (too short for even one row of that shape: the tile shrinks to its row, never stretches)
        if (th > H) { th = H; tw = th / pick.r; }
        gr.style.setProperty('--tw', Math.floor(tw) + 'px'); gr.style.setProperty('--ar', pick.ar);
        var shown = Math.min(n, cols * rows);
        kids.forEach(function (k, i) { k.style.display = i >= shown ? 'none' : ''; });
        var em = plate.querySelector('.lh em'), more = Math.max(0, (this._channels || []).length - shown);
        if (em) em.textContent = more ? more + ' more' : '';
      }
      // how far through, moved every half minute without a redraw
      _tick() {
        (this._bars || []).forEach(function (b) { b.el.style.width = tvShare(b.a).toFixed(1) + '%'; });
      }
      // THE LIVE TV PAGE'S PLAYER, full screen (hk-cameras.js), once its file is in
      _open(ch) {
        if (!ch || !ch.camera) return;
        var self = this, go = function () {
          var K = window.hkCameras;
          if (!K || !K.tvPlayer || self.isConnected === false) return;
          if (self._player) self._player.close();
          self._player = K.tvPlayer(self, ch);
        };
        if (window.hkCameras && window.hkCameras.tvPlayer) { go(); return; }
        var N = window.hkNeed;
        if (N && N.has && N.has('hk-tv-guide-card')) N('hk-tv-guide-card').then(go);
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        clearInterval(this._tickT);
        this._tickT = setInterval(function () { self._tick(); }, 30000);
        this._watchConn();
        if (this._channels && !this._channels.length) { this._tries = 0; this._fetch(); }
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        clearInterval(this._tickT);
        clearTimeout(this._chanT); this._chanT = null;
        this._unwatchConn();
        // leaving the page ends the show: no stream, tuner or hold left behind
        if (this._player) this._player.close();
      }
    }

    // what the shell and the later parts use of this one
    K.HkTvChannelsCard = HkTvChannelsCard; K.TV_SLOTS = TV_SLOTS; K.tvGrid = tvGrid;
  };
})();
