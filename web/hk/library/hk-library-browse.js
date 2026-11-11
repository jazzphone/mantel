// hk-library-browse.js - loading a level, a category's pages, the Discover shelves and search.
//
// PART OF THE MUSIC LIBRARY CARD (hk-library.js). Not a card and not run on its own: it registers one
// function, which hk-library.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkLibraryParts = window.hkLibraryParts || {})['hk-library-browse'] = function (KIT) {
    var C = KIT.C, CATEGORY_TYPE = KIT.CATEGORY_TYPE, CHUNK = KIT.CHUNK, EXPANDABLE = KIT.EXPANDABLE, PAGE = KIT.PAGE,
        SHELF = KIT.SHELF, SHELF_AGE = KIT.SHELF_AGE, SHELF_RETRY = KIT.SHELF_RETRY;

    // THE METHODS this part adds to HkLibraryCard.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      _load(node) {
        var self = this, player = this._player();
        if (!player) { this._err = 'No speaker selected.'; this._paint(); return; }
        // A category lists through get_library (see CATEGORY_TYPE). Without a
        // config entry there is nothing to ask, so it falls back to
        // browse_media -- truncated, but working.
        var mt = node && !this._stack.slice(0, -1).length &&
                 CATEGORY_TYPE[node.id];
        this._pend = null;
        if (mt && this._entry()) {
          this._loadCategory(node, mt, 0);
          return;
        }
        // NO _paint() HERE, or the root flashes.
        //
        // _open pushes the crumb BEFORE calling _load, so a repaint at this
        // point would draw the OLD list -- the root categories -- with the NEW
        // level's context: `atRoot` is already false, so every category would
        // lose its icon and fall back to a generic note for the ~200ms the
        // request takes -- seven notes where seven icons had been.
        //
        // The old level simply stays on screen, correctly drawn, until the new
        // one arrives. That is also what a fast page should look like.
        // NOT a paged category, so clear the paging state. Leaving it set puts
        // a "Show more" on a level that has nothing more behind it.
        this._pageMore = false; this._paged = null;
        this._loading = true; this._err = null;
        var tok = this._seq();
        var msg = { type: 'media_player/browse_media', entity_id: player };
        if (node) {
          msg.media_content_type = node.type;
          msg.media_content_id = node.id;
        }
        // THE EXCEPTION TO "NO _paint() HERE": a playlist or an album is drawn
        // at once -- its header, with the cover from the tile you tapped, the
        // title and "Loading songs…" -- and the tracks follow. Music Assistant does not keep a playlist's
        // tracks in its database; it asks Apple Music, caches the answer for
        // only 3 hours, and backs off when Apple rate-limits it, so opening a
        // playlist measured 7-45 s (2026-10-14; 0.05 s once cached). That long
        // with the Playlists grid still on screen reads as a tap that did not
        // register. The header is the level itself, not a placeholder for it,
        // so a fast album does not flash: the same header stays and the rows
        // fill in under it.
        //
        // `_pend` is separate from `_ctx` on purpose: `_items` and `_ctx` still
        // describe the level you left, which is the one back returns to.
        var kind = node && node.node && this._kind(node.node);
        if (kind === 'playlist' || kind === 'album') {
          this._pend = node;
          this._paint();
        }
        // ...AND IT IS GIVEN THE TIME IT NEEDS. Rock Classics took 45 s cold, so
        // the usual 20 s turned a playlist that was coming into "did not
        // respond". MA retries Apple for up to ~2 minutes; the header shows the
        // wait, so waiting that long is honest.
        this._ws(msg, this._pend ? 120000 : 0).then(function (res) {
          if (self._stale(tok)) return;
          self._pend = null;
          self._loading = false;
          self._items = self._filter(res && res.children);
          // THE CONTEXT IS CAPTURED WITH THE ITEMS, never re-derived from the
          // live stack at paint time -- that coupling is what let a navigation
          // in flight restyle the list it had not replaced yet.
          self._ctx = { top: node || null, atRoot: !node, mode: 'browse' };
          self._shown = PAGE;
          self._paint();
        }).catch(function (e) {
          if (self._stale(tok)) return;
          self._pend = null;
          self._loading = false;
          self._err = 'Could not open that: ' + (e && e.message ? e.message : e);
          self._paint();
        });
        if (node) this._inUse();
      }

      // ONE PAGE OF A CATEGORY. offset 0 replaces, anything else appends.
      //
      // `_pageMore` is "the last page came back full", which is the only
      // honest answer available: get_library reports no total, so the card
      // cannot say "1126 albums" without asking for all of them first.
      _loadCategory(node, mediaType, offset) {
        var self = this, cfg = this._config;
        this._pend = null;
        this._loading = true; this._err = null;
        var tok = this._seq();
        this._ws({ type: 'call_service', domain: 'music_assistant',
                   service: 'get_library', return_response: true,
                   service_data: { config_entry_id: this._entry(),
                                   media_type: mediaType, order_by: 'name',
                                   limit: CHUNK, offset: offset } })
          .then(function (res) {
            if (self._stale(tok)) return;
            var resp = (res && res.response) || res || {};
            var page = (resp.items || []).map(function (it) {
              return self._shelfNode(it, true);
            });
            self._loading = false;
            self._pageMore = page.length === CHUNK;
            self._paged = { node: node, type: mediaType };
            if (offset) {
              self._items = (self._items || []).concat(page);
            } else {
              self._items = page;
              self._ctx = { top: node, atRoot: false, mode: 'browse' };
              self._shown = PAGE;
            }
            self._paint();
          })
          .catch(function (e) {
            if (self._stale(tok)) return;
            self._loading = false;
            self._err = 'Could not open that: ' + (e && e.message ? e.message : e);
            self._paint();
          });
      }

      // "Show more", for both shapes of list. It grows what is DISPLAYED, and
      // fetches another page when it runs out of what is loaded.
      _more() {
        this._shown += PAGE;
        if (this._pageMore && !this._loading && this._paged &&
            this._shown >= (this._items || []).length) {
          this._loadCategory(this._paged.node, this._paged.type, this._items.length);
          return;                       // _loadCategory repaints when it lands
        }
        this._paint();
      }

      // THE ROOT IS NOT ALL OF IT. browse_media's root mixes Music Assistant's
      // own categories with every HA media source installed -- Camera, Image
      // upload, Text-to-speech, UniFi Protect. Those are not music and have no
      // business on this page, so the root keeps only MA's own
      // (`media_content_type: music_assistant`). Below the root everything is
      // already MA's, so nothing is filtered.
      //
      // `hide:` DROPS CATEGORIES YOU DO NOT USE. The root is whatever Music
      // Assistant offers, not what this home listens to (audiobooks, say). A
      // category nobody opens is a tile everybody has to read past, and on a
      // wall tablet the row it costs is real estate the rows below it need.
      // It is config, not a constant, because every home has a different
      // unused one.
      _filter(children) {
        var list = Array.isArray(children) ? children : [];
        if (this._stack.length || this._mode === 'search') return list;
        var hide = {};
        this._hidden().forEach(function (h) { hide[String(h)] = 1; });
        return list.filter(function (c) {
          return c && c.media_content_type === 'music_assistant' &&
                 !hide[c.media_content_id];
        });
      }

      // DISCOVER. One `music_assistant.get_library` call per shelf, each with an
      // order_by -- the same HA contract the rest of the page uses, so there is
      // no Music Assistant token in the browser and no second API to keep up
      // with. Fetched once and cached: these are "recently"/"most" lists, not
      // live state, and re-fetching them on every return to the root would cost
      // five round trips for a page you are passing through.
      //
      // ...BUT NOT FOREVER. "Fetched once" means once per CARD, and Home
      // Assistant keeps a visited view's cards alive until the page reloads
      // -- on a wall tablet, that can be days. So "Recently played" would show
      // this morning's music all evening, and a shelf whose fetch failed once
      // (Music Assistant restarting) would stay an empty list, i.e. absent,
      // until the next reload.
      //
      // So a set of shelves is good for SHELF_AGE, and is refreshed the next
      // time the root is drawn after that -- no timer, no polling while the
      // page is hidden. What is on screen stays on screen until the new answer
      // arrives, so a refresh never blanks a shelf. A failure keeps the last
      // good items and is retried after SHELF_RETRY rather than on the very
      // next paint: the answer to a failed fetch repaints the root, and
      // "retry on every paint" against a server that is down would be a loop.
      // WHAT THIS PAGE LEAVES OUT AND WHICH ROWS IT SHOWS: the card's own
      // `hide:` / `discover:` when its YAML has them, else the home's
      // (Configure -> Browse Music), else the defaults.
      _hidden() {
        var own = this._config && this._config.hide;
        if (Array.isArray(own)) return own;
        var h = C.setting ? C.setting('browse.hide', null) : null;
        return Array.isArray(h) ? h : [];
      }
      _rows() {
        var own = this._config && this._config.discover;
        if (Array.isArray(own)) return own;
        // The home's rows (Configure -> Browse Music) arrive as the queries
        // themselves; hk-settings.js carries the defaults for the first paint,
        // so a generated dashboard's page -- `{ music: true }` and nothing
        // else -- has a Discover section too.
        var r = C.setting ? C.setting('browse.discover', null) : null;
        return Array.isArray(r) ? r : [];
      }

      _loadDiscover() {
        var self = this;
        var rows = this._rows();
        // OTHER ROWS THAN LAST TIME (Configure -> Browse Music was saved): the
        // old shelves are dropped and the new ones fetched now, rather than
        // waiting out SHELF_AGE with the wrong headings on screen.
        var sig = JSON.stringify(rows);
        if (this._shelves && this._shelvesSig != null && this._shelvesSig !== sig) {
          this._shelves = null; this._shelvesBusy = false; this._shelvesDue = 0;
          this._shelfGen = (this._shelfGen || 0) + 1;
        }
        this._shelvesSig = sig;
        if (!rows.length || !this._entry()) return;
        var now = Date.now();
        if (this._shelves && (this._shelvesBusy || now < (this._shelvesDue || 0))) return;
        if (!this._shelves) {
          this._shelves = rows.map(function (r) {
            return { title: r.title, items: null };
          });
        }
        var gen = this._shelfGen = (this._shelfGen || 0) + 1;
        var pending = rows.length, failed = 0;
        this._shelvesBusy = true;
        this._shelvesDue = now + SHELF_AGE;
        var settle = function () {
          if (gen !== self._shelfGen || --pending > 0) return;
          self._shelvesBusy = false;
          if (failed) self._shelvesDue = Date.now() + SHELF_RETRY;
        };
        rows.forEach(function (r, i) {
          var data = { config_entry_id: self._entry(),
                       media_type: r.media_type };
          if (r.order_by) data.order_by = r.order_by;
          if (r.favorite) data.favorite = true;
          self._ws({ type: 'call_service', domain: 'music_assistant',
                     service: 'get_library', service_data: data,
                     return_response: true })
            .then(function (res) {
              if (gen !== self._shelfGen) return;
              var resp = (res && res.response) || res || {};
              self._shelves[i].items = (resp.items || []).slice(0, SHELF);
              settle();
              self._paint();
            })
            .catch(function () {
              if (gen !== self._shelfGen) return;
              // A shelf that cannot load just does not appear. It is a
              // suggestion; an error message where a suggestion should be is
              // worse than the absence of one. One that HAD loaded keeps what
              // it had -- a slightly old suggestion beats a missing one.
              if (!self._shelves[i].items) self._shelves[i].items = [];
              failed++;
              settle();
              self._paint();
            });
        });
      }

      // get_library items carry {name, uri, media_type, image}; browse_media
      // nodes carry {title, media_content_id, media_content_type, thumbnail}.
      // One renderer, so the shelf item is translated into a node here -- and
      // the uri IS a valid browse id (library://playlist/151 opens to its
      // tracks), which is what lets a shelf tile drill in like any other.
      //
      // `withArtist` is for the CATEGORY listings, and it is not decoration:
      // browse_media titles an album "Miles Davis - Kind of Blue" while
      // get_library titles it "Kind of Blue" and puts the artist in its own
      // field. Without carrying it across, listing through get_library
      // would silently drop the artist from every album tile. A Discover shelf
      // passes false -- its tiles are small and its rows already have a heading.
      _shelfNode(it, withArtist) {
        var artist = ((it.artists || [])[0] || {}).name || '';
        var n = {
          title: it.name,
          media_content_id: it.uri,
          media_content_type: 'music',
          media_class: it.media_type,
          thumbnail: it.image || null,
          can_expand: !!EXPANDABLE[it.media_type],
          can_play: true
        };
        if (artist) {
          n._artist = artist;
          if (withArtist) n.sub = artist;
        }
        return n;
      }

      _search(q) {
        var self = this, player = this._player();
        if (!player) return;
        // A fresh search FROM THE ROOT replaces whatever was saved, so back
        // cannot resurrect a query you have already moved on from. Searching
        // from inside something keeps it: back out of that search returns you
        // to where you were standing, which is still the album you opened.
        if (!this._stack.length) this._saved = null;
        this._pageMore = false; this._paged = null; this._pend = null;
        this._loading = true; this._err = null;
        var tok = this._seq();
        this._ws({ type: 'media_player/search_media', entity_id: player,
                   search_query: q }).then(function (res) {
          if (self._stale(tok)) return;
          self._loading = false;
          // search_media answers with the same node shape as browse_media, so
          // one renderer serves both.
          self._items = (res && res.result) || (res && res.children) || [];
          self._ctx = { top: null, atRoot: false, mode: 'search' };
          self._shown = PAGE;
          self._paint();
        }).catch(function (e) {
          if (self._stale(tok)) return;
          self._loading = false;
          self._err = 'Search failed: ' + (e && e.message ? e.message : e);
          self._paint();
        });
        this._inUse();
      }
    };
    KIT.install(Methods);
  };
})();
