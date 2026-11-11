// hk-library-player.js - which player everything targets, and the websocket calls.
//
// PART OF THE MUSIC LIBRARY CARD (hk-library.js). Not a card and not run on its own: it registers one
// function, which hk-library.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkLibraryParts = window.hkLibraryParts || {})['hk-library-player'] = function (KIT) {
    var CLIENT_WAIT = KIT.CLIENT_WAIT, musicMissing = KIT.musicMissing;

    // THE METHODS this part adds to HkLibraryCard.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // THE PAGE'S BACK CHEVRON IS OUR BACK BUTTON while we are inside the
      // library. hk-back-card offers each press as a cancelable `hk-back` event
      // first; taking it here is what gives the page ONE back control that means
      // "up a level" until there are no levels left, and then means "leave the
      // page" without anything special.
      _bindBack() {
        var self = this;
        if (!this._onBack) {
          this._onBack = function (ev) {
            if (!self.isConnected) return;
            if (self._mode !== 'search' && !self._stack.length) return;
            ev.preventDefault();
            self._back();
          };
        }
        window.removeEventListener('hk-back', this._onBack);
        window.addEventListener('hk-back', this._onBack);
      }

      // WHICH PLAYER EVERYTHING TARGETS: hkMusic's answer for this screen, the
      // same one the now-playing card draws (cards/hk-base.js). Every browse,
      // search and play call below names the result.
      //
      // `player:` IN THE CONFIG NAMES IT INSTEAD: the screensaver's Browse
      // (hk-saver-panel.js) plays on the music it is showing, which is not
      // always the one this screen would pick.
      _player() {
        var M = window.hkMusic;
        // THE MUSIC PAGE (hk-music.js) answers for itself: what it is showing,
        // or where the next music plays -- a function, so a change does not
        // rebuild the card (setConfig would take it back to its first level)
        if (typeof this.playerFor === 'function') { var pf = this.playerFor(); if (pf) return pf; }
        if (this._config.player) return this._config.player;
        return (M && this.client && M.player(this.client)) ||
               this._config.fallback_player || null;
      }

      // Re-render when the SELECTION moves (the library must follow it) and not
      // for anything else -- this card's content comes from a websocket call,
      // not from the states.
      // _playerName() IS IN HERE, not just the player.
      //
      // The crumb prints "Office +1", and the +N comes from the leader's
      // group_members -- so without it in the signature the page goes on
      // claiming a group size that no longer exists. With Browse open on the
      // Office context, unjoin the other room: the group drops to 0 members,
      // and the crumb would still say "Office +1" while _playerName()
      // recomputes to "Office". Right on load, wrong until something else
      // happens to repaint.
      //
      // It matters because this line is the page's ONLY statement about where
      // the music will come out, and an under-count is the dangerous direction:
      // a group that GREW still reads "+1" and you press play expecting two
      // rooms.
      _sigOf() {
        return (this._player() || '-') + '|' + this._playerName() +
               (musicMissing() ? '|no-music' : '');
      }

      // Music Assistant's config entry, for get_library: from the integration
      // (the live one), or `config_entry:` in YAML if a page still names it.
      _entry() {
        return (window.hkMusic && window.hkMusic.libraryEntry()) ||
               (this._config && this._config.config_entry) || null;
      }

      // ------------------------------------------------------------ data
      // `wait`: how long before giving up, 20 s unless the caller knows better
      _ws(msg, wait) {
        var self = this;
        // NO CONNECTION YET (2026-10-31, the owner: "Could not open that: no client", and Try Again worked): the page
        // asks as it opens, sometimes a moment before the house's connection reaches the card. Wait for it -- a
        // quarter second at a time, up to CLIENT_WAIT -- rather than fail the first ask
        if (!this.client || !this.client.callWS) {
          return new Promise(function (resolve, reject) {
            var t0 = Date.now(), look = function () {
              if (self.client && self.client.callWS) { self._ws(msg, wait).then(resolve, reject); return; }
              if (Date.now() - t0 >= CLIENT_WAIT) { reject(new Error('Music isn\u2019t connected yet')); return; }
              setTimeout(look, 250);
            };
            setTimeout(look, 250);
          });
        }
        return new Promise(function (resolve, reject) {
          var timer = setTimeout(function () {
            reject(new Error('Music Assistant did not respond. Try again.'));
          }, wait || 20000);
          try {
            // a service call over the WebSocket (get_library) is a command:
            // the client's action port; a read is the client's own callWS
            var port = window.hkClient.isWrite(msg) ? self._actions() : self.client;
            Promise.resolve(port.callWS(msg)).then(function (res) {
              clearTimeout(timer); resolve(res);
            }, function (err) {
              clearTimeout(timer); reject(err);
            });
          } catch (err) {
            clearTimeout(timer); reject(err);
          }
        });
      }

      // ---- ONE REQUEST AT A TIME WINS, AND IT IS THE NEWEST ONE.
      //
      // Every fetch on this card -- browse a level, page a category, run a
      // search -- writes `_items` from its own `.then`. With nothing checking
      // whether it is still the answer anybody wants, two in flight means the
      // SLOWER one lands last, so it wins.
      //
      // With the first answer held back 1.5s and the second 0.1s (which is
      // what a broad query on a busy server actually looks like):
      //
      //     type "love"      -> search starts
      //     type "zeppelin"  -> search starts, answers first, 19 results drawn
      //     "love" answers 1.4s later and REPLACES them
      //     search box: "zeppelin".  On screen: results for "love", and no
      //     Led Zeppelin at all.
      //
      // "THE CONTEXT IS CAPTURED WITH THE ITEMS, never re-derived from the
      // live stack at paint time" (see _load) is a different guard: it stops
      // a stale answer being drawn with the NEW level's styling. It does not
      // stop the stale answer being drawn at all, because nothing there
      // compares the two requests.
      //
      // A counter does. `_seq()` hands out the next number and makes it
      // current; `_stale(t)` is "something newer has been asked for since".
      // Every handler below -- success AND failure -- returns early when stale,
      // so a slow error cannot blank a good list either.
      //
      // SYNCHRONOUS TRANSITIONS BUMP IT TOO (_restoreSearch), because coming
      // back to saved results from memory must also beat a request that was in
      // flight when you pressed back.
      //
      // NOT ABORTED, just ignored. A callWS has no cancel, and a reply that
      // arrives and is dropped costs nothing measurable -- this is about which
      // answer gets to be the truth, not about saving a round trip.
      _seq() {
        this._req = (this._req || 0) + 1;
        return this._req;
      }

      // THE PAGE IS IN USE. Keep Playlists Ready (features/music/warm.py) then
      // starts nothing new for a couple of minutes, so this person's request is
      // not queued behind one of its own at Apple Music. At most every 30 s,
      // after the request it is about; a backend without the command says no.
      _inUse() {
        var now = Date.now();
        if (this._usedAt && now - this._usedAt < 30000) return;
        this._usedAt = now;
        try {
          // a hint the server acts on: through the action port
          var act = this._actions();
          if (act) Promise.resolve(act.callWS({ type: 'hk_music/used' })).catch(function () {});
        } catch (e) { /* nothing to report: it is a hint */ }
      }
    };
    KIT.install(Methods);
  };
})();
