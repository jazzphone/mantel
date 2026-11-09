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
      // margins and its last row centered, never a tile spanning it. LIVE TV'S LABEL IS GONE (2026-11-08, the owner: "if the card's name is printed on the card...it can go"), and with
      // it the "N more" at its right (the block already shows what the size holds; the rest are the page's): the tiles take its room
      'hk-plate.tv:not(.one){display:flex;flex-direction:column;gap:10px;padding:' + C.blockPad('14px', true) + '}',
      '.gr{flex:1 1 0;min-height:0;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-content:center}',
      '.gr .ch{flex:none;width:var(--tw,160px);aspect-ratio:var(--ar,16/10)}',
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
      '.none{grid-column:1 / -1;align-self:center;text-align:center;' + C.typeCss('caption') + ';color:' + C.v('ink-2') + '}',
      // EXTRA LARGE IN TWO COLUMNS (2026-11-09, mockup 13, the owner: "the TV is showing on the left, with how far in it is; the other channels on
      // the right, a tap tunes one"): the channel that is on, a 268 px picture the block's height, its number and room over its show and a bar
      // in a dark foot; the rest as 56 px rows in a list that scrolls, in the shape of Now Playing's. The gap between the columns and the picture's
      // margin to the edge are the block's inset
      'hk-plate.tv.xl{display:flex;flex-direction:row;gap:' + C.blockPad('14px').replace(/^.*?(var\(--hk-pad-l,[^)]*\)).*$/, '$1') + ';padding:' + C.blockPad('14px') + '}',
      '.xl .lf{all:unset;box-sizing:border-box;position:relative;flex:none;width:268px;align-self:stretch;overflow:hidden;cursor:pointer;color:#fff;',
      '  border-radius:var(--hk-inner-radius,' + C.R.inner + 'px);background:linear-gradient(150deg,var(--c1),var(--c2));text-shadow:0 1px 2px rgba(0,0,0,.22);-webkit-tap-highlight-color:transparent}',
      '.xl .lf:active{opacity:.85}.xl .lf:focus-visible{outline:2px solid #fff;outline-offset:-4px}',
      '.xl .lf .bg::before{opacity:.18}.xl .lf .bg::after{background:none}',
      '.xl .ft{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;padding:40px 14px 14px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.76))}',
      '.xl .ft small{' + C.typeCss('caption') + ';line-height:16px;color:rgba(255,255,255,.86);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xl .ft b{font-size:22px;font-weight:600;line-height:27px;letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xl .ft .bar{margin-top:8px}',
      '.xl .rt{flex:1;min-width:0;display:flex;flex-direction:column}',
      C.headRowCss('.xl .hd') + C.headCss('.xl .hd>span'),
      '.xl .ql{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;scrollbar-width:none}',
      '.xl .ql::-webkit-scrollbar{display:none}',
      '.xl .ql.more{-webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 56px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 56px),transparent)}',
      '.xl .rw{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;height:56px;cursor:pointer;color:' + C.v('ink') + ';',
      '  border-bottom:1px solid rgba(255,255,255,.1);-webkit-tap-highlight-color:transparent}',
      '.xl .rw:last-child{border-bottom:0}.xl .rw:active{opacity:.55}.xl .rw:focus-visible{outline:2px solid ' + C.v('ink') + ';outline-offset:-2px}',
      '.xl .pc{position:relative;flex:none;width:56px;height:40px;overflow:hidden;border-radius:' + C.R.small + 'px;background:linear-gradient(150deg,var(--c1),var(--c2))}',
      '.xl .pc .bg{border-radius:0}.xl .pc .bg::before{opacity:.18}.xl .pc .bg::after{background:none}',
      '.xl .pc i{position:absolute;left:3px;top:3px;padding:1px 5px;border-radius:' + C.R.capsule('15px') + ';background:rgba(0,0,0,.55);color:#fff;font-style:normal;font-size:11px;font-weight:700;line-height:13px;font-variant-numeric:tabular-nums}',
      '.xl .wd{flex:1;min-width:0;display:flex;flex-direction:column}',
      '.xl .wd b{' + C.typeCss('body') + ';color:' + C.v('ink') + ';font-weight:600;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xl .wd small{' + C.typeCss('caption') + ';line-height:16px;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xl .rw .bar{width:46px;margin:0;background:rgba(255,255,255,.2)}'
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
        // (Extra Large lists every channel: its right column scrolls, 2026-11-09, mockup 13)
        if (this._size() === 'XL') return this._channels || [];
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
        if (s === 'XL') { this._renderXL(list); return; }
        var plate = document.createElement('hk-plate');
        plate.className = 'tv' + (s === 'S' || this._chosen() ? ' one' : '') + (this._chosen() && /^(T|L)$/.test(s) ? ' big' : '');
        plate.setAttribute('data-hk-role', 'card');
        plate.style.setProperty('--n', g[0]); plate.style.setProperty('--r', g[1]);
        var gr = plate;
        if (!plate.classList.contains('one')) {
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
      // WHICH CHANNEL IS ON (2026-11-09): the page's player is this screen's own stream (hk-cameras.js tvPlayer, a camera
      // entity in a full-screen viewer), not a media_player, so nothing in the house's states says what a screen is showing
      // -- it can't be read. So the left is the block's chosen channel, else the last one played from this block, else the
      // guide's first
      _onNow(list) {
        var n = this._played, one = this._chosen();
        return one || (n && list.filter(function (c) { return c.number === n; })[0]) || list[0];
      }
      _renderXL(list) {
        var h = this.client, self = this, on = this._onNow(list);
        var rest = list.filter(function (c) { return c !== on; });
        var plate = document.createElement('hk-plate');
        plate.className = 'tv xl'; plate.setAttribute('data-hk-role', 'card');
        var info = function (ch) {
          var st = (ch.now && h.states[ch.now]) || { state: '', attributes: {} }, a = st.attributes || {};
          return { a: a, show: st.state && st.state !== 'unknown' && st.state !== 'unavailable' ? st.state : 'Live', t: tintOf(ch.number || ch.name) };
        };
        var pic = function (box, a, px) { if (a.image) { box.insertAdjacentHTML('afterbegin', '<span class="bg"></span>'); self._artImage(a.image, box.querySelector('.bg'), '', px); } };
        var tune = function (b, ch) { b.addEventListener('click', function (e) { e.stopPropagation(); self._open(ch); }); };
        var i0 = info(on), lf = document.createElement('button');
        lf.type = 'button'; lf.className = 'lf';
        lf.style.setProperty('--c1', i0.t[0]); lf.style.setProperty('--c2', i0.t[1]);
        lf.setAttribute('aria-label', 'Watch ' + (on.name || on.number) + ', ' + i0.show);
        lf.innerHTML = '<span class="ft"><small></small><b></b>' + (i0.a.start && i0.a.end ? '<i class="bar"><i></i></i>' : '') + '</span>';
        pic(lf, i0.a, 600);
        lf.querySelector('small').textContent = (on.number || '') + (on.number && on.name ? ' · ' : '') + (on.name || '');
        lf.querySelector('b').textContent = i0.show;
        if (i0.a.start && i0.a.end) this._bars.push({ el: lf.querySelector('.bar i'), a: i0.a });
        tune(lf, on);
        plate.appendChild(lf);
        if (rest.length) {
          var rt = document.createElement('div'); rt.className = 'rt';
          var hd = document.createElement('div'), ql = document.createElement('div');
          hd.className = 'hd'; ql.className = 'ql';
          var hs = document.createElement('span'); hs.textContent = 'Channels'; hd.appendChild(hs);
          rt.appendChild(hd); rt.appendChild(ql);
          rest.forEach(function (ch) {
            var d = info(ch), b = document.createElement('button');
            b.type = 'button'; b.className = 'rw';
            b.style.setProperty('--c1', d.t[0]); b.style.setProperty('--c2', d.t[1]);
            b.setAttribute('aria-label', 'Watch ' + (ch.name || ch.number) + ', ' + d.show);
            b.innerHTML = '<span class="pc"><i></i></span><span class="wd"><b></b><small></small></span>' + (d.a.start && d.a.end ? '<i class="bar"><i></i></i>' : '');
            pic(b.querySelector('.pc'), d.a, 150);
            b.querySelector('.pc i').textContent = ch.number || String(ch.name || '').slice(0, 2);
            b.querySelector('b').textContent = d.show;
            b.querySelector('small').textContent = ch.name || '';
            if (d.a.start && d.a.end) self._bars.push({ el: b.querySelector('.bar i'), a: d.a });
            tune(b, ch);
            ql.appendChild(b);
          });
          var fade = function () { ql.classList.toggle('more', ql.scrollHeight - ql.clientHeight - ql.scrollTop > 4); };
          ql.addEventListener('scroll', fade, { passive: true });
          plate.appendChild(rt);
          this._fade = fade;
        } else plate.classList.add('solo');
        this._root.innerHTML = '';
        this._root.appendChild(plate);
        if (this._fade) { this._fade(); if (typeof requestAnimationFrame === 'function') requestAnimationFrame(this._fade); }
        this._tick();
      }
      // THE TILES' SIZE AND HOW MANY (2026-11-08): the width the columns give a tile in the room in the block; its shape the tallest of
      // 4 : 3, 3 : 2 and 16 : 10 that has every channel the block names in the room (none does: 16 : 10, as many as the rows hold); the
      // rest are the page's
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
      }
      // how far through, moved every half minute without a redraw
      _tick() {
        (this._bars || []).forEach(function (b) { b.el.style.width = tvShare(b.a).toFixed(1) + '%'; });
      }
      // THE LIVE TV PAGE'S PLAYER, full screen (hk-cameras.js), once its file is in
      _open(ch) {
        if (!ch || !ch.camera) return;
        this._played = ch.number;
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
