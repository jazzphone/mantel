// hk-library-draw.js - the card's render and paint, and the shelves' element.
//
// PART OF THE MUSIC LIBRARY CARD (hk-library.js). Not a card and not run on its own: it registers one
// function, which hk-library.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkLibraryParts = window.hkLibraryParts || {})['hk-library-draw'] = function (KIT) {
    var C = KIT.C, DEBOUNCE = KIT.DEBOUNCE, drawNoMusic = KIT.drawNoMusic, KIND_LABEL = KIT.KIND_LABEL,
        KIND_ORDER = KIT.KIND_ORDER, musicMissing = KIT.musicMissing;

    // THE METHODS this part adds to HkLibraryCard.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // ------------------------------------------------------------ render
      _render() {
        // NO MUSIC FEATURE AND NO SPEAKER OF ITS OWN (`player:`,
        // `fallback_player:`): nowhere to play, and the reason is the feature
        if (musicMissing() && !this._player()) {
          this._e = null;
          drawNoMusic(this);
          return;
        }
        if (!this._built) {
          this._root.innerHTML =
            '<hk-plate data-hk-role="card">' +
            '<div class="bar">' +
            '<div class="crumb" data-hk-role="crumb"></div>' +
            '<input class="search" type="search" placeholder="Search artists, albums, songs…"' +
            ' data-hk-role="search" autocomplete="off" spellcheck="false">' +
            '</div>' +
            '<div data-hk-role="body"></div>' +
            '</hk-plate>';
          var q = this._root.querySelector.bind(this._root);
          if (this._config.layout === 'music' && this.routeEl) {
            // WHERE IT PLAYS, BESIDE THE SEARCH (the Music page's own button,
            // routeEl, and its line, noteEl): pinned with it, on every level
            var sr = document.createElement('div');
            sr.className = 'srow';
            var inp = q('.search');
            inp.parentNode.insertBefore(sr, inp);
            sr.appendChild(inp);
            sr.appendChild(this.routeEl);
            // (the bar runs bottom-up -- column-reverse -- so the line goes
            // before the row to show under it)
            if (this.noteEl) sr.parentNode.insertBefore(this.noteEl, sr);
            // a phone's row: searching, the button folds to its glyph and count
            inp.addEventListener('focus', function () { sr.classList.add('open'); });
            inp.addEventListener('blur', function () { setTimeout(function () { if (!inp.value) sr.classList.remove('open'); }, 120); });
            inp.addEventListener('input', function () { if (inp.value) sr.classList.add('open'); });
          }
          if (this._config.layout === 'music') {
            this.setAttribute('music', '');
            // (the list's ends fade as it scrolls: hk-base.js SCROLL EDGES)
            q('[data-hk-role="body"]').classList.add('hk-fades');
            if (C.edges) C.edges(q('[data-hk-role="body"]'));
          }
          this._e = { crumb: q('.crumb'), search: q('.search'),
                      body: q('[data-hk-role="body"]') };
          var self = this;
          this._e.search.addEventListener('input', function (ev) {
            var v = ev.target.value || '';
            self._query = v;
            clearTimeout(self._searchT);
            // Invalidate the previous request as soon as the query changes.
            // Waiting for the debounce leaves a window where an old response
            // can replace the results for the text now visible in the input.
            self._seq();
            if (!v.trim()) {
              self._mode = 'browse';
              self._load(self._stack.length ? self._stack[self._stack.length - 1] : null);
              return;
            }
            self._searchT = setTimeout(function () {
              self._mode = 'search';
              self._search(v.trim());
            }, DEBOUNCE);
          });
          // The back handler is bound in connectedCallback, not here -- see
          // _bindBack. Binding it in this once-only block would let a single
          // disconnect kill it permanently.
          this._bindBack();
          this._built = true;
          this._loadedFor = this._player();
          this._load(null);
          return;
        }
        // THE GROUP CHANGED UNDER US, NOT THE SPEAKER. The level on screen is
        // still the right level -- only the "+N" in the bar is stale -- so
        // repaint the bar and do NOT re-ask Music Assistant for a list we
        // already have. Without this, adding the group size to the signature
        // above would re-fetch the whole level every time anybody joined or
        // left a group anywhere, throwing away the page you were reading.
        if (this._player() === this._loadedFor) {
          this._crumb(this._stack.length ? this._stack[this._stack.length - 1] : null);
          return;
        }
        this._loadedFor = this._player();
        // A selection change re-resolves the player, so reload where we are.
        //
        // RE-RUN THE SEARCH IF THAT IS WHERE WE ARE, rather than browsing.
        // _load always sets `_ctx.mode = 'browse'` while `this._mode` stays
        // 'search', and those two disagreeing is a state the rest of the card
        // cannot read: the body paints browse items, the search box still holds
        // the query, and the back handler -- which tests `_mode` -- takes the
        // "leave the search" branch and clears a query whose results were never
        // on screen. search_media is per-entity like everything else here, so
        // the honest answer to "the speaker changed" is to ask the new speaker
        // the same question.
        if (this._mode === 'search' && this._query) {
          this._search(this._query);
          return;
        }
        this._load(this._stack.length ? this._stack[this._stack.length - 1] : null);
      }

      // Everything below the first build repaints only the body and the bar --
      // rebuilding the whole card would take the focus out of the search box on
      // every keystroke's response.
      _paint() {
        if (!this._e) return;
        var self = this, e = this._e;
        // The crumb follows the LIVE stack -- it should move the instant you
        // tap, so the page acknowledges the press. Only the GRID waits for its
        // data, because that is the part that would otherwise redraw wrongly.
        var live = this._stack.length ? this._stack[this._stack.length - 1] : null;
        this._crumb(live);
        // AT THE FIRST LEVEL OR NOT, said when it changes (the screensaver's
        // Browse shows the house's playlists above the first level only)
        var first = this._mode !== 'search' && !live;
        if (this._config.layout === 'music') { if (first) this.setAttribute('atroot', ''); else this.removeAttribute('atroot'); }
        if (first !== this._first) {
          this._first = first;
          this.dispatchEvent(new CustomEvent('hk-library-level', {
            detail: { root: first }, bubbles: true, composed: true }));
        }
        var ctx = this._ctx || { top: null, atRoot: true, mode: 'browse' };
        var top = ctx.top;
        // DECLARED HERE, not beside the grid it also feeds. `var` hoists, so a
        // declaration further down leaves this `undefined` for the shelf block
        // above it -- which renders nothing and looks exactly like the data
        // never arriving.
        var atRoot = ctx.mode === 'browse' && ctx.atRoot;

        e.body.innerHTML = '';
        if (this._err) { this._empty(this._err); return; }
        if (this._loading && this._pend) {
          e.body.appendChild(this._head(this._pend, [], { cover: '' }, 'Loading songs…'));
          return;
        }
        if (this._loading && !this._items) { e.body.innerHTML = '<div class="msg">Loading…</div>'; return; }
        var items = this._items || [];
        if (!items.length) {
          this._empty(ctx.mode === 'search' ? 'Nothing found.' : 'Nothing here.');
          return;
        }

        // A SEARCH ANSWERS IN SECTIONS. The kind comes from the item's URI
        // (`radiobrowser://radio/...`) rather than its media_class, because MA
        // labels a radio station `music` -- the generic fallback -- and four
        // stations under a heading called "Music" is the thing this replaces.
        if (ctx.mode === 'search') {
          var groups = {};
          items.forEach(function (n) {
            var k = self._kind(n);
            (groups[k] = groups[k] || []).push(n);
          });
          KIND_ORDER.forEach(function (k) {
            var list = groups[k];
            if (!list || !list.length) return;
            var sec = document.createElement('div');
            sec.className = 'sec';
            var h = document.createElement('h3');
            h.textContent = KIND_LABEL[k] || 'Other';
            sec.appendChild(h);
            sec.appendChild(k === 'track' ? self._list(list, null)
                                         : self._grid(list, false, null));
            e.body.appendChild(sec);
          });
          return;
        }

        // THE MUSIC PAGE'S FIRST LEVEL (`layout: music`): its own section
        // first (Your Playlists, rootExtra), then Discover, then the categories
        // under a Library heading -- what you play most, then suggestions, then
        // everything
        var music = this._config.layout === 'music' && atRoot;
        if (music) {
          if (this.rootExtra) e.body.appendChild(this.rootExtra);
          this._loadDiscover();
          var sh1 = this._shelvesEl();
          if (sh1) e.body.appendChild(sh1);
          var lh = document.createElement('h3');
          lh.className = 'libh';
          lh.textContent = 'Library';
          e.body.appendChild(lh);
          e.body.appendChild(this._grid(items, atRoot, top));
          return;
        }

        if (this._isTracks(items)) {
          // No header on a search's Tracks section: there is no album above it
          // to describe, and `top` is null there for exactly that reason.
          if (top) e.body.appendChild(this._head(top, items, this._trackInfo(items)));
          e.body.appendChild(this._list(items, top));
        } else {
          e.body.appendChild(this._grid(items, atRoot, top));
        }

        // SHELVES BELOW THE CATEGORIES, and only at the root of a browse.
        //
        // Above them, five rows of artwork would sit between the search box and
        // the seven things the page exists to open, pushing those down the page.
        // Discover is what you look at when you did not come with something in
        // mind; the categories are what you came for, so they keep the first
        // screen and Discover earns its place by being scrolled to. Inside a
        // category there are no shelves at all: there you asked a question, and
        // suggestions are noise.
        //
        // No heading over the categories. Directly under the search bar they
        // read as the page's own controls, and the first shelf's own heading is
        // what separates the two halves.
        if (atRoot) {
          this._loadDiscover();
          var shelves = this._shelvesEl();
          if (shelves) e.body.appendChild(shelves);
        }
      }
      _shelvesEl() {
        var self = this;
        {
          var shelves = document.createElement('div');
          shelves.className = 'shelves';
          (this._shelves || []).forEach(function (sh) {
            if (!sh.items || !sh.items.length) return;       // still loading, or empty
            var wrap = document.createElement('div');
            wrap.className = 'shelf';
            var h = document.createElement('h3');
            h.textContent = sh.title;
            wrap.appendChild(h);
            var row = document.createElement('div');
            row.className = 'row';
            sh.items.forEach(function (it) {
              row.appendChild(self._tile(self._shelfNode(it), false));
            });
            wrap.appendChild(row);
            shelves.appendChild(wrap);
            if (window.hkCards.fitPanWatch) window.hkCards.fitPanWatch(row);
          });
          // `.children.length`, not `.firstChild`: both are real DOM, but only
          // the first one also reads in tests/dom.js, so the ordering here can
          // be asserted rather than eyeballed.
          return shelves.children.length ? shelves : null;
        }
      }
    };
    KIT.install(Methods);
  };
})();
