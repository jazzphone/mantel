// hk-library-actions.js - play, open, back, the saved search and the notices.
//
// PART OF THE MUSIC LIBRARY CARD (hk-library.js). Not a card and not run on its own: it registers one
// function, which hk-library.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkLibraryParts = window.hkLibraryParts || {})['hk-library-actions'] = function (KIT) {
    // THE METHODS this part adds to HkLibraryCard.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      _play(node) {
        var player = this._player(), self = this;
        if (!player || !node) return;
        if (typeof this.playVia === 'function') { this.playVia(node); return; }
        // AN UNAVAILABLE SPEAKER IS REFUSED HERE, OUT LOUD.
        //
        // Home Assistant skips an unavailable entity inside a service call and
        // reports SUCCESS -- the same trap the Speakers picker documents in its
        // _available() -- so while Music Assistant is restarting, every tap on
        // this page would say "Playing ..." and nothing would play. The picker
        // dims such a speaker; this page has no pill to dim, so it answers the tap.
        var st = this._st(player);
        if (!st || st.state === 'unavailable' || st.state === 'unknown') {
          this._flash((this._playerName() || 'That speaker') +
                      ' is unavailable right now. Try again in a moment.');
          return;
        }
        // SAY IT IS STARTING, THEN SAY WHAT HAPPENED.
        //
        // Printing "Playing <title>" unconditionally, the instant the call
        // leaves, means a refused play, an unavailable speaker or a Music
        // Assistant that has gone away all produce a cheerful confirmation of
        // something that never happened, and the only other evidence is
        // silence from a speaker in another room.
        //
        // _call resolves `false` when Home Assistant REJECTED the call, which
        // is the failure this can actually observe (it still cannot promise the
        // speaker made a sound -- see the note on _call in hk-base.js). That is
        // worth reporting honestly rather than not at all.
        this._flash('Playing ' + node.title + ' on ' + (this._playerName() || 'this speaker'));
        // THROUGH THE INTEGRATION: hk_frontend.music_play_media checks the
        // player again on the server, waits for playback to actually start,
        // and ANSWERS -- so "could not play" also covers a queue Music
        // Assistant accepted and never started, not only a rejected call.
        this._callResp('hk_frontend', 'music_play_media', {
          player: player,
          media_content_id: node.media_content_id,
          media_content_type: node.media_content_type
        }).then(function (res) {
          var r = (res && res.response) || {};
          if (!res.ok || r.ok === false) {
            self._flash('Could not play ' + node.title + (r.message ? ': ' + r.message : ''));
            return;
          }
          // What you just played is what this screen is about now.
          if (window.hkMusic) window.hkMusic.setFocus(player);
          // (the screensaver's Browse closes on it)
          self.dispatchEvent(new CustomEvent('hk-library-played', {
            detail: { player: player, title: node.title }, bubbles: true, composed: true }));
        });
      }

      // ------------------------------------------------------- navigation
      _open(node) {
        if (node.can_expand) {
          // LEAVING A SEARCH. Opening a result pushes onto the same stack a
          // browse uses and sets mode back to `browse`, which on its own loses
          // the search entirely: the back arrow would land you on the root
          // categories with the query still sitting in the box, which is the
          // worst of both, instead of returning to the search you were in.
          //
          // The RESULTS are kept, not just the query, so coming back is instant
          // and does not re-ask Music Assistant a question it already answered.
          if (this._mode === 'search' && !this._stack.length) {
            this._saved = { query: this._query, items: this._items,
                            shown: this._shown };
          }
          this._stack.push({ title: node.title, type: node.media_content_type,
                             id: node.media_content_id, playable: !!node.can_play,
                             node: node });
          this._mode = 'browse';
          this._load(this._stack[this._stack.length - 1]);
        } else if (node.can_play) {
          this._play(node);
        }
      }

      _back() {
        // DEPTH FIRST. Stepping out of the last level of a stack that was
        // entered FROM a search returns to the results, not to the root.
        if (this._stack.length) {
          this._stack.pop();
          if (!this._stack.length && this._saved) { this._restoreSearch(); return; }
          this._load(this._stack.length ? this._stack[this._stack.length - 1] : null);
          return;
        }
        if (this._mode === 'search') {
          this._mode = 'browse'; this._query = ''; this._saved = null;
          if (this._e && this._e.search) this._e.search.value = '';
          this._load(null);
          return;
        }
        this._load(null);
      }

      // Straight from memory: no round trip, and the same number of tiles are
      // showing as when you left.
      _restoreSearch() {
        var s = this._saved;
        this._saved = null;
        // A synchronous transition still has to beat anything in flight: press
        // back while a level is loading and that load must not land on top of
        // the results we just restored from memory.
        this._seq();
        this._loading = false; this._pend = null;
        this._mode = 'search';
        this._query = s.query;
        if (this._e && this._e.search) this._e.search.value = s.query;
        this._items = s.items;
        this._shown = s.shown;
        this._pageMore = false; this._paged = null;
        this._ctx = { top: null, atRoot: false, mode: 'search' };
        this._paint();
      }

      // HOME ASSISTANT'S OWN TOAST, not a line at the top of the list.
      //
      // The body is what you scroll. As its first child, the message for a tap
      // on the twentieth track of a playlist -- "Playing ..." or "Could not
      // play ..." -- would appear ninety rows above you, off screen, so the
      // one thing this page says about a press would be invisible on exactly
      // the press that needs it. Setting and clearing it would also rebuild
      // the whole body twice, re-requesting every piece of artwork on it.
      // The host's toast (hkShell.toast; in Home Assistant the event its own
      // panels use): a snackbar pinned to the bottom of the screen, above
      // everything, which kiosk_mode does not hide. `_toast` keeps the last message so a test can
      // ask what was said.
      _flash(message) {
        this._toast = message;
        window.hkShell.toast({ message: message }, this);
      }

      _retry() {
        if (this._mode === 'search' && this._query) this._search(this._query);
        else this._load(this._stack.length ? this._stack[this._stack.length - 1] : null);
      }

      _empty(message) {
        var self = this, box = document.createElement('div');
        box.className = 'msg';
        box.textContent = message;
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Try again';
        retry.addEventListener('click', function () { self._retry(); });
        box.appendChild(document.createElement('br'));
        box.appendChild(retry);
        this._e.body.appendChild(box);
      }
    };
    KIT.install(Methods);
  };
})();
