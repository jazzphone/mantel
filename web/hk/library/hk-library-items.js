// hk-library-items.js - the items: kinds, the track list, the header, the list and grid, the crumb and the tiles.
//
// PART OF THE MUSIC LIBRARY CARD (hk-library.js). Not a card and not run on its own: it registers one
// function, which hk-library.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkLibraryParts = window.hkLibraryParts || {})['hk-library-items'] = function (KIT) {
    var button = KIT.button, CATEGORY_ICON = KIT.CATEGORY_ICON, KIND_LABEL = KIT.KIND_LABEL, PAGE = KIT.PAGE;

    // THE METHODS this part adds to HkLibraryCard.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // WHICH SECTION AN ITEM BELONGS IN. media_class is not enough: Music
      // Assistant returns radio stations as the generic `music`, so grouping on
      // it alone puts four stations under a heading called "Music". The URI
      // carries the real type -- `radiobrowser://radio/...`,
      // `itunes_podcasts://podcast/...`, `library://playlist/116` -- and every
      // provider spells it the same way.
      _kind(n) {
        var m = /^[a-z0-9_]+:\/\/([a-z_]+)\//i.exec(String(n.media_content_id || ''));
        if (m && KIND_LABEL[m[1].toLowerCase()]) return m[1].toLowerCase();
        return KIND_LABEL[n.media_class] ? n.media_class : 'other';
      }

      // "Miles Davis - So What" is ONE string: browse_media gives a track no
      // separate artist field. MA always builds it `Artist - Title`, and the
      // split is on the FIRST separator so "Coldplay - Don't Panic - Single"
      // keeps its own dash. No separator at all means the whole thing is a
      // title, which is what a radio stream or an oddly-named file gives.
      _split(title) {
        var t = String(title || ''), i = t.indexOf(' - ');
        return i > 0 ? { artist: t.slice(0, i), title: t.slice(i + 3) }
                     : { artist: '', title: t };
      }

      // A list, not a grid, when EVERY item is a track. Not "most": a level
      // that mixes an album with its tracks is still a browse, and half a list
      // is worse than either.
      _isTracks(items) {
        var self = this;
        return items.length > 0 && items.every(function (n) {
          return self._kind(n) === 'track';
        });
      }

      // THE RULE THAT SHAPES A ROW: a column whose value is the same in every
      // row says nothing, so it is dropped. Inside an album that is both of
      // them -- one cover repeated nineteen times, one artist repeated nineteen
      // times -- and what is left is a numbered list of titles, which is what
      // an album IS. Inside a playlist neither holds, so each row keeps its own
      // artwork and its artist underneath. The same principle drops the class
      // subtitle from search results.
      _trackInfo(items) {
        var self = this;
        var parts = items.map(function (n) { return self._split(n.title); });
        var arts = {}, counts = {}, dominant = '', best = 0;
        items.forEach(function (n, i) {
          arts[n.thumbnail || ''] = 1;
          var a = parts[i].artist;
          if (!a) return;
          counts[a] = (counts[a] || 0) + 1;
          if (counts[a] > best) { best = counts[a]; dominant = a; }
        });
        var sameArt = Object.keys(arts).length === 1;
        return {
          parts: parts,
          sameArt: sameArt,
          dominant: dominant,
          // ONE COVER FOR EVERY ROW MEANS THIS IS AN ALBUM, and inside an
          // album the artist is already understood -- so only a row that
          // DIFFERS is worth printing. Apple does the same, and for the same
          // reason.
          //
          // Dominant, not unanimous: on an album where 18 of 19 tracks are the
          // main artist and the 19th has a guest, a strict all-or-nothing rule
          // prints the artist on all nineteen -- 18 of them saying nothing, and
          // the one that matters lost among them.
          //
          // Gated on the artwork because a PLAYLIST has no understood artist:
          // one act with 13 of 25 tracks is still worth naming on all 13, and
          // there the covers differ, so this never fires.
          albumish: sameArt && best > items.length / 2,
          cover: sameArt ? (items[0] && items[0].thumbnail) || '' : ''
        };
      }

      // THE HEADER OVER A TRACK LISTING: the artist, the album name and the
      // album cover above the tracks. It is also what pays for the rows
      // dropping those columns: the cover and the artist are said ONCE,
      // large, instead of nineteen times, small.
      //
      // THE COVER COMES FROM THE TILE YOU TAPPED. browse_media answers the
      // level itself with `thumbnail: null` -- measured on both an album and a
      // playlist -- so there is nothing to read from the response. The stack
      // keeps the node that was opened, which carries the artwork whether it
      // came from a grid tile or a Discover shelf, and the tracks' own shared
      // artwork is the fallback for a level opened any other way.
      // `wait` replaces the song count while the tracks are still coming.
      _head(top, items, info, wait) {
        var hd = document.createElement('div');
        hd.className = 'hd';
        var art = (top.node && top.node.thumbnail) || info.cover || '';
        var cover = document.createElement('div');
        cover.className = 'cover';
        if (art) {
          // _artImage, not a bare <img>: an artwork host a tablet cannot
          // reach never fires `error`, so this box would sit empty forever.
          this._artImage(art, cover, '<hk-icon icon="mdi:album"></hk-icon>', 600);
        } else {
          cover.innerHTML = '<hk-icon icon="mdi:album"></hk-icon>';
        }
        hd.appendChild(cover);
        var txt = document.createElement('div');
        txt.className = 'meta';
        // THE LEVEL'S TITLE IS PREFIXED TOO. The tile you tapped said
        // "Miles Davis - Kind of Blue", so printing it whole above a line
        // that already says "Miles Davis" says the artist twice. Same split as
        // the rows use, and the prefix is the AUTHORITATIVE artist for an album
        // -- better than the tracks' most common one, which is only a guess
        // that happens to be right.
        //
        // (browse_media's own answer for the level is the unprefixed "Kind of
        // Blue", but it arrives with thumbnail:null and is not what the
        // crumb shows, so the tile's title is the one source used here.)
        // The artist the LISTING carried, when there is one: get_library gives
        // it as its own field, which beats both splitting a title on " - " and
        // guessing from the tracks.
        var name = this._split(top.title);
        var h1 = document.createElement('div');
        h1.className = 'h1'; h1.textContent = name.title;
        txt.appendChild(h1);
        // The artist only when there IS one -- from the title, or failing that
        // from the tracks when they agree. A playlist has neither, and guessing
        // its most common artist would print something untrue of it.
        var artist = (top.node && top.node._artist) || name.artist
                   || (info.albumish ? info.dominant : '');
        if (artist) {
          var h2 = document.createElement('div');
          h2.className = 'h2'; h2.textContent = artist;
          txt.appendChild(h2);
        }
        var h3 = document.createElement('div');
        h3.className = wait ? 'h3 wait' : 'h3';
        h3.textContent = wait || (items.length + (items.length === 1 ? ' song' : ' songs'));
        txt.appendChild(h3);
        hd.appendChild(txt);
        return hd;
      }

      _list(items, top) {
        var self = this;
        var info = this._trackInfo(items);
        var parts = info.parts, sameArt = info.sameArt;
        var dominant = info.dominant, albumish = info.albumish;
        var list = document.createElement('div');
        list.className = 'list';

        var row = function (lead, t1, t2, onclick) {
          var rw = document.createElement('div');
          rw.className = 'rw';
          button(rw, onclick);
          rw.setAttribute('data-hk-name', t1 || '');
          rw.appendChild(lead);
          var txt = document.createElement('div');
          txt.className = 'txt';
          var a = document.createElement('div');
          a.className = 't1'; a.textContent = t1 || '';
          txt.appendChild(a);
          if (t2) {
            var b = document.createElement('div');
            b.className = 't2'; b.textContent = t2;
            txt.appendChild(b);
          }
          rw.appendChild(txt);
          list.appendChild(rw);
          return rw;
        };

        var glyph = function (icon) {
          var d = document.createElement('div');
          d.className = 'thumb';
          d.innerHTML = '<hk-icon icon="' + icon + '"></hk-icon>';
          return d;
        };

        // Play all is the first row, for the same reason it is the first tile
        // in a grid: opening an album to see its tracks must not be the only
        // way to lose the ability to play the album.
        if (top && top.playable) {
          row(glyph('mdi:play'), 'Play all', '', function () { self._play(top.node); });
        }

        items.slice(0, this._shown).forEach(function (n, i) {
          var lead;
          if (sameArt) {
            lead = document.createElement('div');
            lead.className = 'num';
            lead.textContent = String(i + 1);
          } else if (n.thumbnail) {
            lead = document.createElement('div');
            lead.className = 'thumb';
            self._artImage(n.thumbnail, lead,
                           '<hk-icon icon="mdi:music-note"></hk-icon>');
          } else {
            lead = glyph('mdi:music-note');
          }
          var artist = (albumish && parts[i].artist === dominant)
            ? '' : parts[i].artist;
          row(lead, parts[i].title, artist, function () { self._open(n); });
        });

        if (items.length > this._shown || this._pageMore) {
          var left = Math.max(items.length - this._shown, 0);
          row(glyph('mdi:dots-horizontal'),
              'Show ' + (left ? Math.min(PAGE, left) : PAGE) + ' more',
              left ? left + ' remaining' : '',
              function () { self._more(); });
        }
        return list;
      }

      // One grid, whether it holds a whole level or one section of a search.
      _grid(items, atRoot, top) {
        var self = this;
        var grid = document.createElement('div');
        // `cats` only at the root: it is what lets the category row stretch to
        // the full width, and what a list of results must never do.
        grid.className = atRoot ? 'grid cats' : 'grid';

        // PLAY ALL, first tile, when the thing we are INSIDE can itself be
        // played -- an album or a playlist. Without it, opening an album to see
        // the tracks would leave no way to play the album.
        if (top && top.playable) {
          grid.appendChild(this._tile({
            title: 'Play all', media_class: 'act', _icon: 'mdi:play',
            _click: function () { self._play(top.node); }
          }));
        }

        items.slice(0, this._shown).forEach(function (n) {
          grid.appendChild(self._tile(n, atRoot));
        });

        // `_pageMore` as well as the count: the last page of a category came
        // back full, so there is more on the server even though nothing is left
        // in `items`. Without this the Albums page would stop at 500 -- the same
        // silent truncation, just moved.
        if (items.length > this._shown || this._pageMore) {
          var left = Math.max(items.length - this._shown, 0);
          grid.appendChild(this._tile({
            title: 'Show ' + (left ? Math.min(PAGE, left) : PAGE) + ' more',
            sub: left ? left + ' remaining' : '',
            media_class: 'act', _icon: 'mdi:dots-horizontal',
            _click: function () { self._more(); }
          }));
        }
        return grid;
      }

      // "Kitchen +6", so the number of additional players is on screen too.
      // With six rooms joined, the leader's name alone says "Kitchen" and
      // nothing admits the other six are part of it.
      //
      // hkMusic.label() names the context the way the picker does: a preset by
      // its own name ("Downstairs"), a join as "Leader +N", a room by itself.
      _playerName() {
        if (typeof this.playerNameFor === 'function') { var pn = this.playerNameFor(); if (pn) return pn; }
        var M = window.hkMusic, own = this._config && this._config.player;
        if (M && this.client && own) {
          // the music that player is in, named as everywhere else ("Kitchen +3")
          var c = M.contexts(this.client).filter(function (x) {
            return x.key === own || x.members.indexOf(own) >= 0;
          })[0];
          return c ? M.label(c) : (M.nameOf ? M.nameOf(own) : own);
        }
        if (M && this.client) return M.resolve(this.client).name || '';
        return this._player() || '';
      }

      // The trail. Ancestors are tappable, the current level is not -- see the
      // ONE BACK CONTROL note in CSS for why there is no second button.
      _crumb(top) {
        var self = this, e = this._e.crumb;
        e.innerHTML = '';
        var add = function (text, dim, onclick) {
          var sp = document.createElement('span');
          sp.className = onclick ? 'up' : (dim ? 'dim' : 'here');
          sp.textContent = text;
          if (onclick) button(sp, onclick);
          e.appendChild(sp);
        };
        var sep = function () {
          var sp = document.createElement('span');
          sp.className = 'sep'; sp.textContent = '\u203A';   // ›
          e.appendChild(sp);
        };
        var rootLabel = 'Music';
        var who = this._playerName();
        // WHERE IT WILL PLAY, ON EVERY LEVEL -- not only at the root.
        //
        // This page's whole reason for existing is that it names the speaker
        // (see the file's header: "EVERY CALL HERE NAMES THE ENTITY"), so the
        // crumb must keep saying which one after you open anything. Otherwise:
        // search for a song from a wall tablet, tap it, and it plays -- to a
        // room whose name has not been on screen since the root, with nothing
        // else on the page naming it.
        //
        // On a wall tablet reachable from many rooms, "which room is this
        // going to come out of" is the most important fact on the screen.
        //
        // `.crumb` is its own full-width flex row with `flex-wrap:wrap`, so a
        // deep trail pushes this to a second line rather than squeezing it out.
        // THE MUSIC PAGE says it with its own button (routeEl), beside the
        // search on every level
        var own = !!this.routeEl;
        var stamp = function () { if (who && !own) add('\u00b7 ' + who, true, null); };

        if (this._mode === 'search') {
          add(rootLabel, false, function () { self._toRoot(); });
          sep();
          add('Search \u00b7 ' + this._query, false, null);
          stamp();
          return;
        }
        if (!this._stack.length) {
          add(rootLabel, false, null);
          stamp();
          return;
        }
        // A stack opened FROM a search is rooted in that search, and the crumb
        // says so -- otherwise the first step reads "Music" and tapping it
        // throws away the results the back chevron would have given you.
        if (this._saved) add('Search \u00b7 ' + this._saved.query, false,
                             function () { self._restoreSearch(); });
        else add(rootLabel, false, function () { self._toRoot(); });
        // Every ancestor is a step you can take, the last one is where you are.
        this._stack.forEach(function (n, i) {
          sep();
          if (i === self._stack.length - 1) add(n.title, false, null);
          else add(n.title, false, function () { self._toDepth(i + 1); });
        });
        stamp();
      }

      _toRoot() {
        this._stack = []; this._mode = 'browse'; this._query = ''; this._saved = null;
        if (this._e && this._e.search) this._e.search.value = '';
        this._load(null);
      }

      _toDepth(n) {
        this._stack = this._stack.slice(0, n);
        this._mode = 'browse';
        this._load(this._stack[this._stack.length - 1]);
      }

      _tile(n, isCategory) {
        var self = this;
        var el = document.createElement('div');
        el.className = 'it' + (n.media_class ? ' ' + n.media_class : '')
                     + (isCategory ? ' cat' : '');
        if (isCategory && !n._icon) {
          n = Object.assign({}, n, {
            _icon: CATEGORY_ICON[n.media_content_id] || 'mdi:music',
            thumbnail: null, sub: ''
          });
        }
        el.setAttribute('data-hk-name', n.title || '');
        // A CATEGORY IS THE SHARED ACTION TILE and nothing else: well, glyph,
        // label beside it. No artwork, so no `.art`; the label is inside, so no
        // caption under it. Everything below this point is for the things that
        // DO have artwork, which cannot be written over.
        if (isCategory) {
          el.className += ' tile';
          // createElement, not innerHTML: the well is two nodes and a text
          // node, and building it by hand is what lets tests/dom.js -- which
          // does not PARSE innerHTML -- assert the shape.
          var well = document.createElement('div');
          well.className = 'well';
          well.innerHTML = '<hk-icon icon="' + (n._icon || 'mdi:music') + '"></hk-icon>';
          var txt = document.createElement('div');
          txt.className = 'txt'; txt.textContent = n.title || '';
          el.appendChild(well); el.appendChild(txt);
          return button(el, function () { self._open(n); });
        }
        var art = document.createElement('div');
        art.className = 'art';
        if (n.thumbnail) {
          // A dead artwork URL must not leave a broken-image glyph on a wall --
          // and an UNREACHABLE one must not leave an empty square, which is
          // what a bare `error` listener cannot catch. See _artImage.
          this._artImage(n.thumbnail, art, '<hk-icon icon="mdi:music"></hk-icon>');
        } else {
          art.innerHTML = '<hk-icon icon="' + (n._icon || 'mdi:music') + '"></hk-icon>';
        }
        el.appendChild(art);
        var nm = document.createElement('div');
        nm.className = 'nm'; nm.textContent = n.title || '';
        el.appendChild(nm);
        // NO CLASS SUBTITLE. "album" or "playlist" under every search result
        // is only useful in one flat list mixing six kinds. The section
        // headings say it once per group, so under the tile it is the same
        // repetition as `directory` under the root categories -- "track"
        // printed nine times under nine tracks, inside a section already
        // called Tracks.
        //
        // `n.sub` is still honoured: that is the explicit one, used by Show
        // more's "N remaining".
        var subText = n.sub != null ? n.sub : '';
        if (subText) {
          var sub = document.createElement('div');
          sub.className = 'sub'; sub.textContent = subText;
          el.appendChild(sub);
        }
        return button(el, n._click || function () { self._open(n); });
      }
    };
    KIT.install(Methods);
  };
})();
