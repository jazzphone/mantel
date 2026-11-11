// hk-cameras-tv.js - the Live TV guide and its player.
//
// PART OF THE CAMERA CARDS (hk-cameras.js). Not a card and not run on its own: it registers one
// function, which hk-cameras.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkCamerasParts = window.hkCamerasParts || {})['hk-cameras-tv'] = function (K) {
    var C = K.C, HkBase = K.HkBase, releaseMedia = K.releaseMedia;

    // ======================================================================
    // hk-tv-guide-card -- LIVE TV: the channels the Live TV feature serves,
    // what is on each, and a tap that plays it full screen.
    //
    // THE CHANNELS COME FROM THE INTEGRATION, not from this card's config:
    // ws `hk_tv/channels` lists them, in order, with their camera and "now
    // playing" sensor. Channels are added and removed in Live TV's settings,
    // and every page showing this card follows.
    //
    // THE PLAYER is not a pop-up config: one full-screen sheet, made for
    // whichever channel was tapped, holding an hk-doorbell-card (the same live
    // WebRTC camera card, with `fill` and a tuning message). While it is open:
    //   * ws `hk_tv/watching` every 60 s names this screen as a viewer, and
    //     the viewers sensor carries it to a tablet's sleep logic, which can
    //     keep the tablet on its dashboard;
    //   * hkIdle holds, so a subview is not abandoned mid-show;
    //   * the controls fade after a few seconds and come back on a touch.
    // Closing (X, Escape, or leaving the page) stops all three and drops the
    // stream, which frees the tuner a few seconds later.
    var TV_HEARTBEAT_MS = 60000;
    var TV_CONTROLS_MS = 4000;
    var TV_RETRY_MS = [5000, 15000, 60000, 300000];   // an empty channel list: look again

    function tvTime(iso) {
      try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
      catch (e) { return ''; }
    }
    function tvLeft(end) {
      var m = Math.round((new Date(end) - Date.now()) / 60000);
      if (!(m > 0)) return '';
      return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm left' : m + 'm left';
    }
    function tvProgress(start, end) {
      var s = +new Date(start), e = +new Date(end), n = Date.now();
      if (!(e > s)) return 0;
      return Math.max(0, Math.min(100, (n - s) / (e - s) * 100));
    }

    class HkTvGuideCard extends HkBase {
      // EVERY CLASS IS tv-: BASE_CSS already styles .tile as the 70 px pill,
      // and a tv card would inherit it.
      static get CSS() {
        var M = C.M;
        return [
          '.tv-hd{font-size:20px;font-weight:700;margin:0 4px 10px}',
          '.tv-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(270px,1fr))}',
          '.tv-tile{' + M.glass + ';border:' + M.border + ';border-radius:' + M.radius + ';',
          '  box-shadow:' + M.shSm + ';overflow:hidden;cursor:pointer;display:flex;flex-direction:column;',
          '  text-align:left;padding:0;color:inherit;font:inherit;-webkit-tap-highlight-color:transparent}',
          '.tv-tile:active{transform:scale(.98)}',
          '.tv-art{position:relative;aspect-ratio:16/9;background:#0b0d12;overflow:hidden}',
          '.tv-pic{position:absolute;inset:0}',
          '.tv-pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
          '.tv-art hk-icon{position:absolute;left:50%;top:50%;translate:-50% -50%;',
          '  --mdc-icon-size:44px;color:rgba(255,255,255,.4)}',
          '.tv-live{position:absolute;left:10px;top:10px;padding:3px 8px;border-radius:8px;',
          '  background:#ff3b30;color:#fff;font-size:12px;font-weight:700;letter-spacing:.04em}',
          '.tv-logo{position:absolute;right:10px;top:10px;height:28px;max-width:40%;padding:4px 8px;',
          '  border-radius:9px;background:rgba(255,255,255,.88);display:flex;align-items:center}',
          '.tv-logo img{position:static;height:100%;width:auto;object-fit:contain}',
          '.tv-txt{padding:12px 14px 14px;display:flex;flex-direction:column;gap:3px;min-width:0}',
          '.tv-chan{font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
          '.tv-chan b{color:' + window.hkCards.v('ink') + ';font-size:15px;margin-right:6px}',
          // (the theme's ink: inherited, it was white on Flat's Light card)
          '.tv-title{font-size:17px;font-weight:700;color:' + window.hkCards.v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.tv-sub{font-size:14px;color:' + window.hkCards.v('ink-2') + ';',
          '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:1.2em}',
          '.tv-bar{height:4px;border-radius:2px;background:' + window.hkCards.v('line-strong') + ';margin:8px 0 4px;overflow:hidden}',
          '.tv-bar i{display:block;height:100%;background:' + window.hkCards.v('ink') + ';border-radius:2px}',
          '.tv-times,.tv-next{font-size:12.5px;color:' + window.hkCards.v('ink-2') + ';',
          '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.tv-empty{padding:24px;border-radius:' + M.radius + ';' + M.glass + ';text-align:center;',
          '  color:' + window.hkCards.v('ink-2') + '}'
        ].join('');
      }

      // Every "now playing" sensor wakes the card. The channel list is not a
      // state: it is asked for (_fetchChannels) on the first render, again
      // whenever the socket comes back (an HA restart), and again on a
      // back-off while the answer is empty -- see there.
      _sigOf() {
        var h = this.client;
        if (!h || !this._channels) return null;
        return this._channels.map(function (c) {
          var st = c.now && h.states[c.now];
          return c.number + '=' + (st ? st.last_updated : 'x');
        }).join(';');
      }

      // each new client also reaches the full-screen player, after HkBase's step
      _receiveClient() {
        super._receiveClient();
        if (this._player) this._player.update(this.client);
      }

      // THE CHANNEL LIST, ASKED FOR AGAIN WHENEVER IT CAN BE WRONG. Asked for
      // once per card, ever, a tablet that drew this page while HA was
      // restarting would be told "not configured" (Live TV not set up yet) or
      // have the call refused, and would say so until somebody reloaded it.
      // So:
      //   * the socket's `ready` -- it came back, i.e. HA restarted -- asks again;
      //   * an empty or unconfigured answer, or a refused call, asks again on a
      //     back-off (TV_RETRY_MS: 5 s, 15 s, 1 min, then every 5 min) while the
      //     card is on the page. One timer at most, never a tight loop;
      //   * an empty answer never replaces a list already drawn: right after a
      //     restart it means "not set up YET", and the back-off looks again.
      _fetchChannels() {
        var h = this.client, self = this;
        if (this._loading || !h || !h.callWS) return;
        clearTimeout(this._chanT);
        this._chanT = null;
        this._loading = true;
        Promise.resolve(h.callWS({ type: 'hk_tv/channels' })).then(function (r) {
          var list = (r && r.channels) || [];
          if (list.length || !(self._channels && self._channels.length)) {
            self._channels = list;
            self._configured = !!(r && r.configured);
          }
          return list.length > 0;
        }, function () {
          if (!self._channels) { self._channels = []; self._configured = false; }
          return false;
        }).then(function (good) {
          self._loading = false;
          if (good) self._chanTries = 0; else self._retryChannels();
          self.redraw();
        });
      }

      _retryChannels() {
        if (this.isConnected === false || this._chanT) return;
        var self = this, n = this._chanTries = (this._chanTries || 0) + 1;
        this._chanT = setTimeout(function () { self._chanT = null; self._fetchChannels(); },
          TV_RETRY_MS[Math.min(n - 1, TV_RETRY_MS.length - 1)]);
      }

      // `ready` is what home-assistant-js-websocket fires when the socket comes
      // BACK -- every reconnect, never the first connect. One listener, on the
      // client's subscription port (one per socket, so the same identity across
      // snapshots), and only while the card is on the page.
      _watchConn() {
        var conn = this.client && this.client.subscriptions;
        if (this.isConnected === false || !conn || conn === this._conn ||
            typeof conn.addEventListener !== 'function') return;
        this._unwatchConn();
        var self = this;
        this._conn = conn;
        this._onReady = function () { self._chanTries = 0; self._fetchChannels(); };
        conn.addEventListener('ready', this._onReady);
      }

      _unwatchConn() {
        if (this._conn && this._onReady && typeof this._conn.removeEventListener === 'function') {
          this._conn.removeEventListener('ready', this._onReady);
        }
        this._conn = null;
        this._onReady = null;
      }

      _render() {
        var h = this.client, self = this;
        if (!h) return;
        this._watchConn();
        if (!this._channels) { this._fetchChannels(); return; }
        this._root.innerHTML = '';
        if (!this._channels.length) {
          var e = document.createElement('div');
          e.className = 'tv-empty';
          e.textContent = this._configured
            ? 'No channels yet. Add some in ' + window.hkShell.settingsPlace('Pages → Live TV') + '.'
            : 'Add Live TV (' + window.hkShell.haPlace('HK Frontend → Add feature') + ') to show channels here.';
          this._root.append(e);
          return;
        }
        if (this._config && this._config.title) {
          var hd = document.createElement('div');
          hd.className = 'tv-hd';
          hd.textContent = this._config.title;
          this._root.append(hd);
        }
        var grid = document.createElement('div');
        grid.className = 'tv-grid';
        this._bars = [];
        this._channels.forEach(function (ch) { grid.append(self._tile(ch)); });
        this._root.append(grid);
      }

      _tile(ch) {
        var self = this, st = (ch.now && this.client.states[ch.now]) || { state: '', attributes: {} };
        var a = st.attributes || {};
        var t = document.createElement('button');
        t.className = 'tv-tile';
        var art = document.createElement('div');
        art.className = 'tv-art';
        // The picture gets its own box: _artImage's fallback replaces the box's
        // contents, and would take the LIVE badge and the logo with it.
        var pic = document.createElement('div');
        pic.className = 'tv-pic';
        art.append(pic);
        if (a.image) this._artImage(a.image, pic, '<hk-icon icon="mdi:television-classic"></hk-icon>', 600);
        else pic.innerHTML = '<hk-icon icon="mdi:television-classic"></hk-icon>';
        art.insertAdjacentHTML('beforeend', '<span class="tv-live">LIVE</span>');
        if (a.logo) {
          var lg = document.createElement('div');
          lg.className = 'tv-logo';
          this._artImage(a.logo, lg, '', 150);
          art.append(lg);
        }
        var txt = document.createElement('div');
        txt.className = 'tv-txt';
        var line = function (cls, text) {
          var d = document.createElement('div'); d.className = cls; d.textContent = text || ''; txt.append(d); return d;
        };
        var chan = line('tv-chan', ch.number);
        chan.insertAdjacentHTML('afterbegin', '<b></b>');
        chan.firstChild.textContent = ch.name;
        line('tv-title', st.state && st.state !== 'unknown' ? st.state : 'Live');
        line('tv-sub', a.subtitle || '');
        if (a.start && a.end) {
          var bar = document.createElement('div');
          bar.className = 'tv-bar';
          bar.innerHTML = '<i></i>';
          txt.append(bar);
          var times = line('tv-times', '');
          this._bars.push({ bar: bar.firstChild, times: times, a: a });
        }
        if (a.next_title) line('tv-next', 'Next: ' + a.next_title + (a.next_start ? ' · ' + tvTime(a.next_start) : ''));
        t.append(art, txt);
        t.addEventListener('click', function (e) { e.stopPropagation(); self._open(ch); });
        this._tick();
        return t;
      }

      // Progress moves every half minute without re-rendering the tiles.
      _tick() {
        (this._bars || []).forEach(function (b) {
          b.bar.style.width = tvProgress(b.a.start, b.a.end).toFixed(1) + '%';
          b.times.textContent = tvTime(b.a.start) + ' – ' + tvTime(b.a.end) +
            (tvLeft(b.a.end) ? ' · ' + tvLeft(b.a.end) : '');
        });
      }

      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        clearInterval(this._tickT);
        this._tickT = setInterval(function () { self._tick(); }, 30000);
        this._watchConn();
        // Back on the page with nothing to show: look again now, not at the
        // next step of a back-off that stopped when the page was left.
        if (this._channels && !this._channels.length) {
          this._chanTries = 0;
          this._fetchChannels();
        }
      }

      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        clearInterval(this._tickT);
        clearTimeout(this._chanT);
        this._chanT = null;
        this._unwatchConn();
        // Leaving the page ends the show: no stream, tuner or hold left behind.
        if (this._player) this._player.close();
      }

      _open(ch) {
        if (!ch.camera) return;
        if (this._player) this._player.close();
        this._player = tvPlayer(this, ch);
      }

      getCardSize() { return 6; }
    }

    // The full-screen player. Mounted in home-assistant's shadow root, like
    // hk-popup's sheets (position:fixed under a transformed view would be
    // placed against the view, not the screen).
    function tvPlayer(owner, ch) {
      var h = owner.client;
      var mount = window.hkShell.overlayRoot() || document.body;
      var el = document.createElement('div');
      el.className = 'hktv';
      el.innerHTML = '<style>' +
        '.hktv{position:fixed;inset:0;z-index:8;background:#000;display:flex;' +
        '  -webkit-tap-highlight-color:transparent}' +
        '.hktv>hk-doorbell-card{flex:1;height:100%;display:block}' +
        // CLEAR OF THE SCREEN'S EDGES (2026-10-30, the owner's iPhone Duo): the picture fills the screen, the
        // caption and the X keep out of its safe areas -- the Duo's strip of system controls down the side
        // covered the X; an iPhone on its side has its Dynamic Island there (--hk-safe-*: hk-base.js SAFE)
        '.hktv .top{position:absolute;left:calc(18px + var(--hk-safe-left,env(safe-area-inset-left,0px)));' +
        '  right:calc(18px + var(--hk-safe-right,env(safe-area-inset-right,0px)));' +
        '  top:calc(16px + var(--hk-safe-top,env(safe-area-inset-top,0px)));display:flex;' +
        '  align-items:center;justify-content:space-between;gap:12px;transition:opacity .3s;z-index:2}' +
        // The X NEVER fades -- there is always a way out;
        // the caption and the sound controls do.
        '.hktv .cap{transition:opacity .3s}' +
        '.hktv.quiet .cap{opacity:0}' +
        '.hktv .cap{height:40px;padding:0 16px;border-radius:20px;display:flex;align-items:center;' +
        '  background:rgba(28,28,30,.66);color:#fff;font-size:17px;font-weight:600;' +
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80%}' +
        '.hktv .x{width:44px;height:44px;border-radius:22px;flex:none;display:flex;' +
        '  align-items:center;justify-content:center;background:rgba(28,28,30,.66);color:#fff;' +
        '  cursor:pointer;--mdc-icon-size:24px}' +
        '</style><div class="top"><div class="cap"></div>' +
        '<div class="x" role="button" aria-label="Close" tabindex="0"><hk-icon icon="mdi:close"></hk-icon></div></div>';
      var cam = C.create({ type: 'custom:hk-doorbell-card', entity: ch.camera, fill: true,
                           tuning: ch.name, volume: true, aspect_ratio: '16x9', glass: false });
      el.insertBefore(cam, el.firstChild);
      var cap = el.querySelector('.cap');
      var quietT = null, beatT = null, closed = false;
      function quiet(on) {
        el.classList.toggle('quiet', on);
        cam.style.setProperty('--hk-db-bar-opacity', on ? '0' : '1');
        cam.style.setProperty('--hk-db-bar-events', on ? 'none' : 'auto');
      }
      function wake() {
        quiet(false);
        clearTimeout(quietT);
        quietT = setTimeout(function () { quiet(true); }, TV_CONTROLS_MS);
      }
      // Runs on EVERY state push (~10 a second) while the player is up, so it
      // writes only a caption that changed: an identical textContent still
      // replaces the text node, and that is a relayout and a repaint over
      // playing video for nothing.
      function caption(hh) {
        var st = ch.now && hh && hh.states[ch.now];
        var title = st && st.state && st.state !== 'unknown' ? st.state : '';
        var text = ch.name + (title ? ' · ' + title : '');
        if (cap.textContent !== text) cap.textContent = text;
      }
      function watching(on) {
        var act = owner._actions();          // a write: the client's action port
        if (!act) return;
        Promise.resolve(act.callWS({ type: 'hk_tv/watching', channel: on ? ch.number : null }))
          .catch(function (e) { console.warn('[hk-tv] watching', e); });
      }
      var player = {
        update: function (hh) { if (!closed) { cam.hkSetClient(hh); caption(hh); } },
        close: function () {
          if (closed) return;
          closed = true;
          clearTimeout(quietT); clearInterval(beatT);
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('pagehide', onHide);
          releaseMedia(el);
          if (el.parentNode) el.parentNode.removeChild(el);   // drops the stream
          watching(false);
          if (window.hkIdle && window.hkIdle.hold) window.hkIdle.hold('hk-tv', false);
          if (owner._player === player) owner._player = null;
        }
      };
      function onKey(e) { if (e.key === 'Escape') player.close(); }
      // A reload or navigation away never reaches close(): say so on the way
      // out (best effort -- the 150 s heartbeat expiry is the backstop).
      function onHide() { player.close(); }
      el.querySelector('.x').addEventListener('click', function (e) { e.stopPropagation(); player.close(); });
      el.addEventListener('pointerdown', wake, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('pagehide', onHide);
      mount.appendChild(el);
      player.update(h);
      wake();
      watching(true);
      beatT = setInterval(function () { watching(true); }, TV_HEARTBEAT_MS);
      if (window.hkIdle && window.hkIdle.hold) window.hkIdle.hold('hk-tv', true);
      return player;
    }

    // what the shell and the later parts use of this one
    K.HkTvGuideCard = HkTvGuideCard; K.tvPlayer = tvPlayer;
  };
})();
