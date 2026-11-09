// hk-media-recent.js - the Home Grid's Music block: recently played and the playlists' sheet.
//
// PART OF THE MUSIC AND MEDIA CARDS (hk-media.js). Not a card and not run on its own: it registers one
// function, which hk-media.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkMediaParts = window.hkMediaParts || {})['hk-media-recent'] = function (K) {
    var C = K.C, drawNoMusic = K.drawNoMusic, esc = K.esc, HkBase = K.HkBase, musicMissing = K.musicMissing;

    // ------------------------------------------------ the Home Grid's widgets
    // A COLOR OF ITS OWN for a thing with no picture (a cover, a channel): one
    // of the accents, by its name, toward black along a gradient -- the
    // mock-up's covers and channel tiles (2026-10-31)
    var TINTS = ['blue', 'orange', 'purple', 'green', 'cyan', 'yellow', 'pink', 'indigo', 'teal', 'red'];
    function hashOf(s) {
      var h = 0; s = String(s || '');
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return Math.abs(h);
    }
    function tintOf(key) {
      var a = C.ACCENTS[TINTS[hashOf(key) % TINTS.length]], n = parseInt(a.slice(1), 16);
      var dark = function (c) { return Math.round(c * 0.45); };
      return [a, 'rgb(' + dark(n >> 16 & 255) + ',' + dark(n >> 8 & 255) + ',' + dark(n & 255) + ')'];
    }

    // ------------------------------------------------- hk-recent-music-card
    //
    // THE MUSIC BLOCK (2026-10-31, the owner: "S (last played, play on its
    // cover), W four covers with names, T six covers; L/XL as now"): Music's
    // Recently Played widget, mounted in the Home Grid's `music` panel block
    // (hk-grid-cards.js). What played last, then covers to play again; a tap
    // plays one on this screen's music (hkMusic.player), through
    // hk_frontend.music_play_media as Browse plays (hk-library.js _play).
    //   S   the last, play on its cover, its name and artist at the foot
    //   W   four covers in a row with their names
    //   T   six, two across (four on a tile cell)
    //   L   the last above a hairline and eight (four on a tile cell)
    //   XL  the last above twelve (six on a tile cell)
    // THE MUSIC PAGE'S LIST: its Recently played shelf's query (Browse's
    // Discover, hk-library.js _loadDiscover -- tracks by when they last
    // played), one cover per album, so a record played through shows once.
    // Asked again after RECENT_AGE on the next draw, as the shelf is; a failed
    // ask keeps what it had and tries again after RECENT_RETRY.
    var RECENT_AGE = 10 * 60 * 1000, RECENT_RETRY = 60 * 1000;
    // [covers in the grid, columns, rows] by size (L and XL: the last above them)
    var RECENT = { S: [0, 1, 1], W: [4, 4, 1], T: [6, 2, 3], L: [8, 4, 2], XL: [12, 4, 1] };
    function recentCovers(items) {
      var seen = {}, out = [];
      (items || []).forEach(function (it) {
        if (!it || !it.uri || out.length >= 40) return;
        var album = it.album && it.album.uri, key = album || it.image || it.uri;
        if (seen[key]) return;
        seen[key] = 1;
        out.push({ uri: it.uri, name: it.name || '', key: album || it.name || it.uri,
                   artist: ((it.artists || [])[0] || {}).name || '', image: it.image || (it.album && it.album.image) || null });
      });
      return out;
    }
    // THE MUSIC BLOCK'S SHOW (2026-10-31, the owner): Recently Played, the Music page's playlists (its presets, Play
    // Music's tiles), or one playlist; the playlists are read as the Music page reads them (hkMusic.playlists()).
    // A PLAYLIST WITH CHOICES (Decades: 2020s, 2010s...; 2026-11-01, the owner: "1 decades button with the Pop Up like
    // we do on the Music Page") is ONE tile among the playlists, its choices in the Music page's own sheet at a tap
    // (`options`); One Playlist of it lays its choices out as tiles, each playing at a tap.
    // A PLAYLIST'S COVER (2026-11-01, the owner): Mantel sends a pill with the picture of what it is built with
    // (`image`, music.py covers), drawn as the tile's cover; a pill with none keeps the gradient and its icon
    function playlistTiles(pls, only) {
      var out = [];
      (pls || []).forEach(function (p) {
        if (!p || (only && p.name !== only)) return;
        if (p.options && p.options.length && only) p.options.forEach(function (o) {
          out.push({ playlist: o.key, name: o.name, key: p.name + o.name, artist: p.name, icon: p.icon || null, image: o.image || null });
        });
        else if (p.options && p.options.length) {
          out.push({ name: p.name, key: p.name, artist: p.options.length + ' Playlists', icon: p.icon || null, image: p.image || null,
                     options: p.options.map(function (o) { return { playlist: o.key, name: o.name, image: o.image || null }; }) });
        } else if (p.key) out.push({ playlist: p.key, name: p.name, key: p.name, artist: 'Playlist', icon: p.icon || null, image: p.image || null });
      });
      return out;
    }
    // THE LAST PLAYED PLAYLIST (2026-11-08, the owner: "the card [should] know the last playlist played and offer that as the
    // Hero"): Music Assistant's library playlists by when each last played -- played here, on the Music page or anywhere
    // else -- asked once for every Music block (LASTPL_AGE, and again just after a block plays one), and the first the
    // Music page's playlists hold (a playlist, or a choice of one, by its items: `uris`) is the block's first cover
    var LASTPL_AGE = 3 * 60 * 1000, LASTPL = { uris: null, due: 0, busy: false, cards: [] };
    function heroFirst(tiles, pls) {
      var uris = LASTPL.uris || [], hit = /** @type {any} */ (null);
      for (var i = 0; i < uris.length && !hit; i++) {
        (pls || []).some(function (p) {
          var o = (p.options || []).filter(function (x) { return (x.uris || []).indexOf(uris[i]) >= 0; })[0];
          if (o) hit = { playlist: o.key, name: o.name, key: p.name + o.name, artist: 'Last Played', icon: p.icon || null, image: o.image || null };
          else if ((p.uris || []).indexOf(uris[i]) >= 0) hit = { name: p.name };
          return !!hit;
        });
      }
      if (!hit) return tiles;
      if (hit.playlist) return [hit].concat(tiles);
      var at = tiles.map(function (t) { return t.name; }).indexOf(hit.name);
      if (at < 0) return tiles;
      return [Object.assign({}, tiles[at], { artist: 'Last Played' })].concat(tiles.slice(0, at), tiles.slice(at + 1));
    }
    var MU_CSS = [
      ':host{display:block;height:100%}',
      // (a size container: the covers are sized by the plate's room)
      'hk-plate.mu{box-sizing:border-box;height:100%;display:flex;flex-direction:column;overflow:hidden;container-type:size;',
      '  padding:' + C.blockPad('14px') + ';' + C.plate('card') + '}',
      C.headCss('.lab') + '.lab{display:block;flex:none}',
      // A COVER: its picture, or a gradient of its own with a note
      '.cvr{position:relative;display:grid;place-items:center;overflow:hidden;flex:none;border-radius:' + C.R.small + 'px;',
      '  background:linear-gradient(140deg,var(--c1),var(--c2));box-shadow:0 4px 12px rgba(0,0,0,.25);transition:transform .12s ease,opacity .2s}',
      '.cvr img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
      '.cvr hk-icon{width:26px;height:26px;--mdc-icon-size:26px;color:rgba(255,255,255,.55)}',
      '.it,.last{all:unset;box-sizing:border-box;position:relative;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.it:active .cvr,.last:active .cvr{transform:scale(.97)}',
      '.busy .cvr{opacity:.55}',
      '.it:focus-visible .cvr,.last:focus-visible .cvr{outline:2px solid ' + C.v('ink') + ';outline-offset:2px}',
      // THE GRID: the covers as large as the room lets them, the first and last
      // on the inset's edges, the rows spread down the block (--n0 / --r0 the
      // size's, set on it; --n / --r what a cell's shape leaves, below)
      '.cvw{flex:1;min-height:0;container-type:size;margin-top:10px}',
      '.cv{height:100%;display:grid;--n:var(--n0);--r:var(--r0);--cv:min((100cqw - (var(--n) - 1) * 10px) / var(--n), (100cqh - (var(--r) - 1) * 10px) / var(--r) - 21px);',
      '  grid-template-columns:repeat(var(--n),var(--cv));grid-template-rows:repeat(var(--r),auto);justify-content:space-between;align-content:space-between}',
      // EVERY COVER, SCROLLING IN THE BLOCK (2026-11-01, the owner): across in Wide and Extra Large, down in Tall and
      // Large, the next row or column showing a little at the edge so it is plain there is more; a finger scrolls it
      // (the page's own swipe keeps the other direction)
      '.cv.x{grid-auto-flow:column;grid-template-columns:none;grid-auto-columns:var(--cv);justify-content:start;align-content:center;column-gap:10px;',
      '  --cv:min((100cqw - var(--n) * 10px) / (var(--n) + .4), (100cqh - (var(--r) - 1) * 10px) / var(--r) - 21px);',
      '  overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;touch-action:pan-x;scrollbar-width:none}',
      '.cv.y{grid-template-rows:none;grid-auto-rows:auto;align-content:start;row-gap:10px;',
      '  --cv:min((100cqw - (var(--n) - 1) * 10px) / var(--n), (100cqh - var(--r) * 10px) / (var(--r) + .35) - 21px);',
      '  overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;touch-action:pan-y;scrollbar-width:none}',
      '.cv::-webkit-scrollbar{display:none}',
      '.it{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.it .cvr{width:var(--cv);height:var(--cv)}',
      '.it .nm{display:block;' + C.typeCss('caption') + ';font-weight:600;line-height:17px;color:' + C.v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // THE LAST: S's cover with play on it; L's and XL's beside its name
      '.last{display:block;flex:none;width:var(--big);height:var(--big)}',
      '.last .cvr{width:100%;height:100%;border-radius:' + C.R.inner + 'px}',
      '.last .cvr hk-icon{width:36px;height:36px;--mdc-icon-size:36px}',
      '.mu.S .last{--big:min(96px, 100cqh - 44px)}',
      // SMALL (2026-11-01, the owner): the cover is the whole block, play in its middle, the name over its foot; a tap
      // anywhere else is the block's When Tapped (Choose a Playlist, the Music page...)
      'hk-plate.mu.S{padding:0;position:relative}',
      // (...but not when nothing has played: the words keep the block's inset -- with none, "Recently Played" ran past the
      // block's edge, 2026-11-09, the card picker's preview)
      'hk-plate.mu.S.em{padding:' + C.blockPad('14px') + '}',
      '.mu.S .bg{position:absolute;inset:0;border-radius:inherit;overflow:hidden}',
      '.mu.S .bg .cvr{width:100%;height:100%;border-radius:0;box-shadow:none}',
      '.mu.S .bg .cvr hk-icon{width:44px;height:44px;--mdc-icon-size:44px;opacity:0}',
      '.mu.S .sh{position:absolute;left:0;right:0;bottom:0;height:58%;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.62));pointer-events:none}',
      '.mu.S .go{all:unset;box-sizing:border-box;position:absolute;left:50%;top:40%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;',
      '  background:rgba(255,255,255,.94);display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35);transition:transform .12s ease;-webkit-tap-highlight-color:transparent}',
      '.mu.S .go:active{transform:scale(.92)}',
      '.mu.S .go:focus-visible{outline:2px solid #fff;outline-offset:3px}',
      '.mu.S .go hk-icon{width:30px;height:30px;--mdc-icon-size:30px;color:#1c1c1e}',
      '.mu.S.busy .go{opacity:.6}',
      '.mu.S .ft{position:absolute;left:14px;right:14px;bottom:12px;margin:0;pointer-events:none}',
      '.mu.S .t1,.mu.S .t2{color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.5)}',
      '.pl{position:absolute;right:-6px;bottom:-6px;width:40px;height:40px;border-radius:50%;background:#fff;display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.3)}',
      '.pl hk-icon{width:22px;height:22px;--mdc-icon-size:22px;color:#1c1c1e}',
      '.ft{margin-top:auto;min-width:0}',
      '.t1{display:block;' + C.typeCss('headline') + ';line-height:21px;color:' + C.v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.t2{display:block;' + C.typeCss('caption') + ';line-height:17px;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.top{display:flex;gap:16px;align-items:flex-start;flex:none}',
      '.mu.L .last,.mu.XL .last{--big:min(120px, 100cqh - 160px)}',
      // EXTRA LARGE (2026-11-08, the owner: "the last played playlist showing up at the top, and then below it, all of the
      // playlists with a horizontal scroll"): five across, the last played above as big as the height left lets it
      '.mu.XL .top .col{align-self:stretch}.pp{all:unset;box-sizing:border-box;margin-top:auto;align-self:flex-start;height:44px;padding:0 20px 0 14px;border-radius:22px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;' +
      '  background:rgba(255,255,255,.94);color:#1c1c1e;' + C.typeCss('headline') + ';-webkit-tap-highlight-color:transparent}.pp:active{transform:scale(.96)}.pp hk-icon{width:22px;height:22px;--mdc-icon-size:22px}',
      '.mu.XL .cv{--across:5}.mu.XL .cvw{flex:none}.mu.XL .top{flex:1;min-height:0}.mu.XL .last{height:100%;width:auto;aspect-ratio:1}',
      '.top .col{display:flex;flex-direction:column;min-width:0;flex:1}',
      // EXTRA LARGE IN TWO COLUMNS (2026-11-09, mockup 13: "the last thing played large on the left, with Play and Browse (56 px);
      // the rest of what was played on the right, scrolling. Today the art sits top-left and the row of covers runs off the
      // edge"): a 232 px column (heading, the 196 px cover, its name, Play and a round Browse at the foot), the gap the
      // block's inset, and the rest as 56 px rows that scroll with the fade at the foot (hk-media-now.js .npql)
      'hk-plate.mu.xl2{flex-direction:row;gap:var(--hk-pad-l,14px)}',
      '.xl2 .lc{display:flex;flex-direction:column;flex:none;width:232px;min-width:0;min-height:0}',
      C.headRowCss('.xl2 .hd2') + '.xl2 .hd2{justify-content:flex-start}',
      C.headCss('.xl2 .hd2 span'),
      '.xl2 .lc .last{--big:196px;width:196px;height:196px;aspect-ratio:auto;flex:none;margin-bottom:10px}',
      '.xl2 .lc .t1{' + C.typeCss('headline') + ';font-size:17px;font-weight:600;line-height:22px;margin:0}',
      '.xl2 .lc .t2{font-size:15px;font-weight:400;line-height:20px;color:' + C.v('ink-2') + '}',
      '.xl2 .acts{display:flex;gap:10px;margin-top:auto;flex:none}',
      '.xl2 .acts button{all:unset;box-sizing:border-box;height:56px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.xl2 .acts .pp{flex:1;border-radius:28px;background:rgba(255,255,255,.94);color:#1c1c1e;' + C.typeCss('headline') + '}',
      '.xl2 .acts .br{flex:none;width:56px;border-radius:50%;background:rgba(255,255,255,.16);color:' + C.v('ink') + '}',
      '.xl2 .acts button:active{transform:scale(.96)}',
      '.xl2 .acts button:focus-visible{outline:2px solid ' + C.v('ink') + ';outline-offset:2px}',
      '.xl2 .acts .pp hk-icon{width:22px;height:22px;--mdc-icon-size:22px}',
      '.xl2 .acts .br hk-icon{width:26px;height:26px;--mdc-icon-size:26px}',
      '.xl2 .rc{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}',
      '.xl2 .al{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;scrollbar-width:none}',
      '.xl2 .al::-webkit-scrollbar{display:none}',
      '.xl2 .al.more{-webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 56px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 56px),transparent)}',
      '.xl2 .rw{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;height:56px;cursor:pointer;border-bottom:1px solid ' + C.v('line') + ';-webkit-tap-highlight-color:transparent}',
      '.xl2 .rw:last-child{border-bottom:0}',
      '.xl2 .rw:active{opacity:.55}.xl2 .rw.busy{opacity:.55}',
      '.xl2 .rw:focus-visible{outline:2px solid ' + C.v('ink') + ';outline-offset:-2px}',
      '.xl2 .rw .cvr{width:44px;height:44px;box-shadow:none}.xl2 .rw .cvr hk-icon{width:20px;height:20px;--mdc-icon-size:20px}',
      '.xl2 .rw .tx{display:flex;flex-direction:column;min-width:0;flex:1}',
      '.xl2 .rw .rt{font-size:15px;font-weight:600;line-height:19px;color:' + C.v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xl2 .rw .ra{font-size:13px;font-weight:400;line-height:17px;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.xl2 .nn{flex:1;display:grid;place-items:center;text-align:center;' + C.typeCss('caption') + ';color:' + C.v('ink-2') + '}',
      '.top .t1{' + C.typeCss('title') + ';line-height:27px;margin-top:2px}',
      // (the second ink, not Music's pink -- 2026-11-01, the owner: "I don't like the Red Playlist Font color")
      '.top .t2{' + C.typeCss('body') + ';line-height:19px;color:' + C.v('ink-2') + '}',
      '.hr{height:1px;flex:none;margin:14px 0 4px;background:' + C.v('line') + '}',
      '.none{flex:1;display:grid;place-items:center;text-align:center;' + C.typeCss('caption') + ';color:' + C.v('ink-2') + '}',
      // ON A TILE CELL (196 x 150 a cell): a row fewer
      '@container hk-cell (max-height:379px){.mu.T .cv{--r:2}.mu.L .cv{--r:1}}'
    ].join('');

    class HkRecentMusicCard extends HkBase {
      static get CSS() { return MU_CSS; }
      getCardSize() { return 4; }
      _receiveClient() {
        if (window.hkMusic) window.hkMusic.attach(this.client);
        super._receiveClient();
      }
      _size() { var s = this.getAttribute('size'); return RECENT[s] ? s : 'L'; }
      _mode() { var m = this._config && this._config.show; return m === 'presets' || m === 'playlist' ? m : 'recent'; }
      // the playlists' tiles (Presets, One Playlist): none chosen or found, the first playlist, as the block begins
      _tiles() {
        var Mu = window.hkMusic, pls = Mu && Mu.playlists ? Mu.playlists() : [], m = this._mode();
        if (m === 'recent') return null;
        var one = m === 'playlist' ? (this._config.playlist || (pls[0] || {}).name) : null, s = this._size();
        if (m !== 'presets' || !(s === 'S' || s === 'L' || s === 'XL')) return playlistTiles(pls, one);
        this._lastPl();
        return heroFirst(playlistTiles(pls, null), pls);
      }
      // what is drawn: the size, the covers, and whether music is set up
      _sigOf() {
        var Mu = window.hkMusic;
        return JSON.stringify([this._size(), this._mode(), this._tiles(), this._items || null, !!(Mu && Mu.libraryEntry && Mu.libraryEntry()), musicMissing()]);
      }
      _lastPl() {
        var Mu = window.hkMusic, entry = Mu && Mu.libraryEntry && Mu.libraryEntry(), h = this.client;
        if (LASTPL.cards.indexOf(this) < 0) LASTPL.cards.push(this);
        if (!h || !h.callWS || !entry || LASTPL.busy || Date.now() < LASTPL.due) return;
        LASTPL.busy = true;
        LASTPL.due = Date.now() + LASTPL_AGE;
        var msg = { type: 'call_service', domain: 'music_assistant', service: 'get_library', return_response: true,
                    service_data: { config_entry_id: entry, media_type: 'playlist', order_by: 'last_played_desc', limit: 25 } };
        var port = window.hkClient && window.hkClient.isWrite(msg) ? this._actions() : h;
        Promise.resolve(port ? port.callWS(msg) : Promise.reject(new Error('no port'))).then(function (res) {
          var resp = (res && res.response) || res || {};
          LASTPL.uris = (resp.items || []).map(function (it) { return it && it.uri; }).filter(Boolean);
        }, function () { LASTPL.due = Date.now() + RECENT_RETRY; }).then(function () {
          LASTPL.busy = false;
          LASTPL.cards = LASTPL.cards.filter(function (c) { return c.isConnected; });
          LASTPL.cards.forEach(function (c) { c.redraw(); });
        });
      }
      _load() {
        var Mu = window.hkMusic, entry = Mu && Mu.libraryEntry && Mu.libraryEntry(), h = this.client, self = this;
        if (this._mode() !== 'recent' || !h || !h.callWS || !entry || this._busy || Date.now() < (this._due || 0)) return;
        this._busy = true;
        this._due = Date.now() + RECENT_AGE;
        var msg = { type: 'call_service', domain: 'music_assistant', service: 'get_library', return_response: true,
                    service_data: { config_entry_id: entry, media_type: 'track', order_by: 'last_played_desc', limit: 40 } };
        // (a service call over the WebSocket is the action port's; Mantel answers this one as a read: hk-library.js _ws)
        var port = window.hkClient && window.hkClient.isWrite(msg) ? this._actions() : h;
        Promise.resolve(port ? port.callWS(msg) : Promise.reject(new Error('no port'))).then(function (res) {
          var resp = (res && res.response) || res || {};
          self._items = recentCovers(resp.items);
        }, function () {
          if (!self._items) self._items = [];
          self._due = Date.now() + RECENT_RETRY;
        }).then(function () { self._busy = false; self.redraw(); });
      }
      _cover(it, cls) {
        var t = it ? tintOf(it.key) : ['rgba(255,255,255,.14)', 'rgba(255,255,255,.08)'];
        return '<span class="cvr' + (cls ? ' ' + cls : '') + '" style="--c1:' + t[0] + ';--c2:' + t[1] + '">' + (it ? '<hk-icon icon="' + esc(it.icon || 'mdi:music') + '"></hk-icon>' : '') + '</span>';
      }
      _render() {
        if (musicMissing()) { drawNoMusic(this); return; }
        var mode = this._mode(), tiles = this._tiles();
        if (!tiles) this._load();
        var s = this._size(), R = RECENT[s], items = tiles || this._items, list = items || [], self = this;
        // (a playlist's own name over its choices; Presets, the page's playlists)
        var lab = mode === 'presets' ? 'Playlists' : mode === 'playlist' ? (tiles[0] && tiles[0].artist !== 'Playlist' ? tiles[0].artist : 'Playlist') : 'Recently Played';
        // (every cover past the first: the grid scrolls -- across in Wide, down in Tall, Large and Extra Large)
        var last = list[0], more = s === 'W' || s === 'T' ? list.slice() : list.slice(1), axis = s === 'W' || s === 'XL' ? 'x' : 'y';
        // (still asking: the covers' places, empty)
        if (!items) { last = null; more = []; for (var i = 0; i < R[0]; i++) more.push(null); }
        var cell = function (it, i) {
          return '<button type="button" class="it" data-i="' + i + '"' + (it ? ' aria-label="Play ' + esc(it.name) + '"' : ' disabled') + '>' +
                 self._cover(it) + '<span class="nm">' + (it ? esc(it.name) : '&nbsp;') + '</span></button>';
        };
        var grid = '<div class="cvw"><div class="cv ' + axis + '" style="--n0:' + R[1] + ';--r0:' + R[2] + '">' + more.map(function (it, j) {
          return cell(it, s === 'W' || s === 'T' ? j : j + 1); }).join('') + '</div></div>';
        var lastBtn = '<button type="button" class="last" data-i="0"' + (last ? ' aria-label="Play ' + esc(last.name) + '"' : ' disabled') + '>' +
                      this._cover(last) + (s === 'S' && last ? '<span class="pl"><hk-icon icon="mdi:play"></hk-icon></span>' : '') + '</button>';
        // (no "Playlist" under a playlist where the label already says Playlists)
        var sub2 = last && !(lab === 'Playlists' && last.artist === 'Playlist') ? last.artist : '';
        var words = last ? '<b class="t1">' + esc(last.name) + '</b>' + (sub2 ? '<small class="t2">' + esc(sub2) + '</small>' : '') : '';
        var body;
        if (items && !items.length) body = '<span class="lab">' + lab + '</span><div class="none">' + (tiles ? 'No playlists yet. Add some in ' + window.hkShell.settingsPlace('Pages → Music') + '.' : 'Music played here shows up here.') + '</div>';
        else if (s === 'S') body = '<span class="bg">' + this._cover(last) + '</span><span class="sh"></span>' +
          (last ? '<button type="button" class="go" data-i="0" aria-label="Play ' + esc(last.name) + '"><hk-icon icon="mdi:play"></hk-icon></button>' : '') +
          '<div class="ft">' + words + '</div>';
        else if (s === 'W' || s === 'T') body = '<span class="lab">' + lab + '</span>' + grid;
        else if (s === 'XL' && mode !== 'playlist') {
          // (Extra Large, 2026-11-09 mockup 13: no list of the rest, the right column says so; the left column keeps its places while asking)
          var rows = more.map(function (it, j) {
            return '<button type="button" class="rw" data-i="' + (j + 1) + '"' + (it ? ' aria-label="Play ' + esc(it.name) + '"' : ' disabled') + '>' + self._cover(it) +
              '<span class="tx"><span class="rt">' + (it ? esc(it.name) : '&nbsp;') + '</span><span class="ra">' + (it ? esc(it.artist === 'Playlist' ? '' : it.artist) : '&nbsp;') + '</span></span></button>';
          }).join('');
          body = '<div class="lc"><div class="hd2"><span>' + lab + '</span></div>' + lastBtn + words +
            '<div class="acts"><button type="button" class="pp" data-i="0"' + (last ? '' : ' disabled') + '><hk-icon icon="mdi:play"></hk-icon>Play</button>' +
            '<button type="button" class="br" aria-label="Browse music"><hk-icon icon="mdi:magnify"></hk-icon></button></div></div>' +
            '<div class="rc"><div class="hd2"><span>' + (mode === 'presets' ? 'More Playlists' : 'Also Played') + '</span></div>' +
            (rows ? '<div class="al">' + rows + '</div>' : '<div class="nn">Nothing else yet.</div>') + '</div>';
        }
        else body = '<div class="top">' + lastBtn + '<div class="col"><span class="lab">' + lab + '</span>' + words +
          // (Extra Large: Play at the cover's foot, the column beside it not left empty)
          (s === 'XL' && last ? '<button type="button" class="pp" data-i="0"><hk-icon icon="mdi:play"></hk-icon>Play</button>' : '') +
          '</div></div><div class="hr"></div>' + grid;
        this._root.innerHTML = '<hk-plate class="mu ' + s + (s === 'XL' && mode !== 'playlist' && !(items && !items.length) ? ' xl2' : '') + (items && !items.length ? ' em' : '') + '" data-hk-role="card">' + body + '</hk-plate>';
        var plate = this._root.querySelector('hk-plate');
        this._across();
        this._fade();
        var br = this._root.querySelector('.br');
        if (br) br.addEventListener('click', function (e) { e.stopPropagation(); self._browse(); });
        if (s === 'S' && last && last.image) this._artImage(last.image, this._root.querySelector('.bg .cvr'), '<hk-icon icon="' + esc(last.icon || 'mdi:music') + '"></hk-icon>', 600);
        // (the Now Playing block's idle face reads this card's last played: hk-media-now.js _idleEngine)
        if (this.onDraw) this.onDraw(this);
        this._root.querySelectorAll('[data-i]').forEach(function (b) {
          var it = list[+b.getAttribute('data-i')];
          if (!it) return;
          if (it.image && b.querySelector('.cvr')) self._artImage(it.image, b.querySelector('.cvr'), '<hk-icon icon="' + esc(it.icon || 'mdi:music') + '"></hk-icon>', 300);
          if (s === 'S') b._busyOn = plate;            // (Small's busy look is the whole block's)
          b.addEventListener('click', function (e) { e.stopPropagation(); self._play(it, b); });
        });
      }
      // THE FADE AT THE FOOT of Extra Large's list while more is below it (hk-media-now.js _qFade; none once scrolled to the end)
      _fade() {
        var l = this._root.querySelector('.al');
        if (this._ro2) { this._ro2.disconnect(); this._ro2 = null; }
        if (!l) return;
        var f = function () { l.classList.toggle('more', l.scrollHeight - l.clientHeight - l.scrollTop > 4); };
        l.addEventListener('scroll', f, { passive: true });
        f();
        if (typeof ResizeObserver === 'function') { var ro = new ResizeObserver(f); ro.observe(l); this._ro2 = ro; }
      }
      // BROWSE (2026-11-09, mockup 13): what a tap on the block's plate opens -- the Music page's browse, else its player page
      _browse() {
        var M = window.hkCards.menu, path = M && M.pagePath ? (M.pagePath('music-browse') || M.pagePath('playmusic')) : null;
        if (path) window.hkShell.navigate(path);
      }
      // HOW BIG ACROSS (2026-11-07, the owner: a Wide Playlists block's covers "could fill out the space better",
      // its spare height all under the names): each cover as tall as the block's height lets it, the next one
      // peeking at the edge -- a quarter of it or more as it falls, else the covers a little smaller so 0.4 of it shows
      _across() {
        var cv = this._root.querySelector('.cv.x'), w = cv && /** @type {HTMLElement} */ (cv.parentNode);
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (!cv || !w || typeof ResizeObserver !== 'function') return;
        var fit = function () {
          // (no sizes, nothing to fit: a page not laid out yet, or HK Frontend's test DOM, which has no computed styles)
          var W = w.clientWidth, H = w.clientHeight, cs = W ? getComputedStyle(cv) : null;
          if (!cs || !cs.getPropertyValue || !cv.style.setProperty) return;
          var r = +(cs.getPropertyValue('--r') || 1) || 1, across = +cs.getPropertyValue('--across') || 0;
          if (across) {                // (Extra Large: so many across, the next peeking; the last played above takes the rest)
            var each = Math.floor((W - across * 10) / (across + 0.4));
            if (cv.style.getPropertyValue('--cv') !== each + 'px') cv.style.setProperty('--cv', each + 'px');
            if (w.style.height !== each + 21 + 'px') w.style.height = each + 21 + 'px';
            return;
          }
          if (!H) return;
          var tall = Math.floor((H - (r - 1) * 10) / r - 21);     // (the cover the height holds, its name under it)
          var seen = (W + 10) / (tall + 10), n = Math.max(1, Math.floor(seen));
          var size = seen - n >= 0.25 ? tall : Math.floor((W - n * 10) / (n + 0.4));
          if (cv.style.getPropertyValue('--cv') !== size + 'px') cv.style.setProperty('--cv', size + 'px');
        };
        this._ro = new ResizeObserver(fit);
        this._ro.observe(w);
        fit();
      }
      disconnectedCallback() {
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._ro2) { this._ro2.disconnect(); this._ro2 = null; }
        if (super.disconnectedCallback) super.disconnectedCallback();
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this._root && this._root.querySelector('.cv.x')) this._across();
      }
      // ON THIS SCREEN'S MUSIC, as Browse plays: the integration checks the
      // player, starts it and answers -- so a failure is said, not a cheerful
      // "Playing" over silence
      // WHERE IT PLAYS: the block's own speaker or group (its Plays On, while the house has it), else this screen's
      _target() {
        var Mu = window.hkMusic, sp = this._config && this._config.speaker;
        if (sp && Mu && Mu.known && Mu.known(sp)) return sp;
        return Mu && this.client ? Mu.player(this.client) : null;
      }
      // WHEN TAPPED, on the block's plate (its covers play): Choose a Playlist -- every playlist in the Music page's sheet,
      // so the block starts any of them -- else the Music page, else the speaker's sheet (hk-base.js openTarget)
      _tapTarget() {
        if ((this._config || {}).tap === 'playlists') return [{ run: this._choosePlaylist.bind(this) }];
        var p = this._target(), Mu = window.hkMusic;
        // (a preset is its rooms, never a player a sheet opens on: its first room's, as _play and _playList play it)
        var pre = p && Mu && Mu.presets && Mu.presets().filter(function (x) { return x.entity === p; })[0];
        if (pre) p = pre.members[0] || null;
        return [{ page: 'playmusic' }, p && { sheet: p }];
      }
      _play(it, el) {
        if (el && el._busyOn) el = el._busyOn;
        // (what just started is the last played: asked again once Music Assistant has it)
        var me = this;
        LASTPL.due = Math.min(LASTPL.due, Date.now() + 6000);
        setTimeout(function () { if (me.isConnected) me.redraw(); }, 6500);
        if (it.options) { this._choose(it, el); return; }
        if (it.playlist) { this._playList(it, el); return; }
        var Mu = window.hkMusic, player = this._target(), self = this;
        if (!player) { window.hkShell.toast({ message: 'Pick a speaker on the Music page to play ' + it.name + '.' }, this); return; }
        if (el.classList.contains('busy')) return;
        // A PRESET (its Plays On, 2026-11-01) is its rooms, never a player: the cover plays on the room that leads
        // (hkMusic.leader), then the rest join it -- as the Music page plays a library item on a set of rooms
        // (hk-music.js playTarget)
        var pre = Mu.presets && Mu.presets().filter(function (x) { return x.entity === player; })[0];
        var first = pre ? (Mu.leader ? Mu.leader(pre.members) : pre.members[0]) : player, rest = pre && pre.members.length > 1 ? pre.members.slice() : null;
        if (!first) { window.hkShell.toast({ message: 'That group has no speakers.' }, this); return; }
        el.classList.add('busy');
        this._callResp('hk_frontend', 'music_play_media', { player: first, media_content_id: it.uri, media_content_type: 'music' }).then(function (res) {
          el.classList.remove('busy');
          var r = (res && res.response) || {};
          if (!res.ok || r.ok === false) { window.hkShell.toast({ message: 'Could not play ' + it.name + (r.message ? ': ' + r.message : '') }, self); return; }
          if (Mu.setFocus) Mu.setFocus(first);
          if (rest) self._callResp('hk_frontend', 'music_transfer', { rooms: rest, source: first }).then(function (r2) {
            var a = (r2 && r2.response) || {};
            if (!r2.ok || a.ok === false) window.hkShell.toast({ message: 'Playing on ' + Mu.nameOf(first) + ' only: the others didn’t join.' }, self);
            else if (a.leader && Mu.known(a.leader)) Mu.setFocus(a.leader);
          });
          // played: it is the last now
          self._due = 0;
        });
      }
    }

    // -------------------------------------------------- hk-music-playlists-card
    //
    // THE PLAYLISTS' SHEET (a Music block's Choose a Playlist, 2026-11-01): every playlist as the block's own covers,
    // in a detail sheet; a tap plays it where the block plays (its speaker, else this screen's music) and the sheet
    // goes. A playlist with choices (Decades) opens them in place, Back over them.
    var PL_CSS = [
      ':host{display:block;height:auto}',
      '.pls{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:18px 16px;padding:4px 2px 10px}',
      '.pls .it{display:flex;flex-direction:column;gap:7px;min-width:0}',
      '.pls .cvr{width:100%;aspect-ratio:1;border-radius:' + C.R.inner + 'px}',
      '.pls .cvr hk-icon{width:34px;height:34px;--mdc-icon-size:34px;color:rgba(255,255,255,.7)}',
      '.pls .nm{' + C.typeCss('body') + ';font-weight:600;line-height:19px}',
      '.pls .sub{display:block;' + C.typeCss('caption') + ';line-height:16px;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.bk{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;margin:0 0 12px;cursor:pointer;' + C.typeCss('body') + ';color:' + C.v('accent') + '}',
      '.bk hk-icon{width:22px;height:22px;--mdc-icon-size:22px}',
      '.hd{' + C.typeCss('title') + ';line-height:27px;color:' + C.v('ink') + ';margin:0 0 14px}'
    ].join('');
    class HkMusicPlaylistsCard extends HkRecentMusicCard {
      static get CSS() { return MU_CSS + PL_CSS; }
      _size() { return 'L'; }
      _tapTarget() { return HkBase.prototype._tapTarget.call(this); }
      _sigOf() {
        var Mu = window.hkMusic;
        return JSON.stringify([Mu && Mu.playlists ? Mu.playlists() : [], this._open || null, musicMissing()]);
      }
      _render() {
        if (musicMissing()) { drawNoMusic(this); return; }
        var Mu = window.hkMusic, all = playlistTiles(Mu && Mu.playlists ? Mu.playlists() : [], null), self = this;
        var open = this._open ? all.filter(function (t) { return t.name === self._open && t.options; })[0] : null;
        if (this._open && !open) this._open = null;
        var list = open ? open.options.map(function (o) { return { playlist: o.playlist, name: o.name, key: open.name + o.name, artist: open.name, icon: open.icon, image: o.image || null }; }) : all;
        var html = (open ? '<button type="button" class="bk" data-back><hk-icon icon="mdi:chevron-left"></hk-icon>Playlists</button>' +
                           '<div class="hd">' + esc(open.name) + '</div>' : '') +
          '<div class="pls">' + list.map(function (it, i) {
            return '<button type="button" class="it" data-i="' + i + '" aria-label="' + (it.options ? 'Choose from ' : 'Play ') + esc(it.name) + '">' +
                   self._cover(it) + '<span class="nm">' + esc(it.name) + '</span><span class="sub">' + esc(it.artist) + '</span></button>';
          }).join('') + '</div>';
        this._list = list;
        this._root.innerHTML = html;
        var back = this._root.querySelector('[data-back]');
        if (back) back.addEventListener('click', function () { self._open = null; self.redraw(); });
        this._root.querySelectorAll('[data-i]').forEach(function (b) {
          var it = list[+b.getAttribute('data-i')];
          if (it.image && b.querySelector('.cvr')) self._artImage(it.image, b.querySelector('.cvr'), '<hk-icon icon="' + esc(it.icon || 'mdi:music') + '"></hk-icon>', 300);
          b.addEventListener('click', function (e) { e.stopPropagation(); self._pick(it, b); });
        });
      }
      // a cover tapped: a playlist with choices opens them; any other plays, and the sheet goes once it does
      _pick(it, el) {
        if (it.options) { this._open = it.name; this.redraw(); return Promise.resolve(false); }
        return Promise.resolve(this._playList(it, el)).then(function (played) {
          if (played && window.hkDetail && window.hkDetail.close) window.hkDetail.close();
          return played;
        });
      }
    }

    // what the shell and the later parts use of this one
    K.HkMusicPlaylistsCard = HkMusicPlaylistsCard; K.HkRecentMusicCard = HkRecentMusicCard;
    K.playlistTiles = playlistTiles; K.heroFirst = heroFirst; K.LASTPL = LASTPL; K.RECENT = RECENT; K.recentCovers = recentCovers; K.tintOf = tintOf;
  };
})();
