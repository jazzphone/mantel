// hk-saverpieces-media.js -- THE SCREENSAVER'S MEDIA AND PHOTOS GLANCE PIECES (2026-11-02, phase 13 / 1b, wave B;
// docs/phase13/GLANCE-SPEC.md, "Media"): Up Next, Playing In and On This Day.
//
// A glance group is one file, loaded after hk-saverwidgets.js (the screensaver loads only the files its layout uses). It
// registers its pieces with hkSaverWidgets.define() and draws with the renderer's helpers and classes, so a piece looks
// like the core ones, with no CSS of its own. Every rule of the plan holds (SCREENSAVER-UNIFIED.md, "The rules every piece
// follows"): nothing here animates, nothing blurs; one read per source, shared; a read never wakes a read (0.1.104); a
// piece that "shows when..." says so through `off`, and data that is not there is not "nothing wrong".
//
//   upnext   inline, rectangular   while music plays AND the queue has a next song. Inline "Next: Paper Lanterns";
//                                  rectangular UP NEXT, the song in bold, its artist under it. Nothing when Music Assistant
//                                  has no next song, or isn't there (a dash would say "something is wrong"; there is
//                                  nothing wrong, so the piece gives its place back).
//   playin   inline                while music plays: the rooms it plays in, "Kitchen + Living Room" (hkMusic.label of the
//                                  context ctx.music.key names, else the room musicOf() already worked out).
//   thisday  inline                over a photo taken on this day in an earlier year (ctx.photo.date, "YYYY-MM-DD"):
//                                  "3 years ago today" / "A year ago today". A February 29th photo counts on the 28th in a
//                                  year without one.
//
// UP NEXT'S ONE READ. `music_assistant.get_queue` (return_response) is asked ONCE A SONG, as hk-saver.js's upNext() asks it for
// the music slide, through the same port: the client's action port (client.actions.callWS, which hk-saver.js calls sendWS)
// with the same message. The answer is kept in this module (one slot, whoever asks: the inline and the rectangular piece
// share it) and every upnext piece is drawn again once it lands. Three things keep it light:
//   - it is asked a moment after the song changes (ASK_DELAY), from a timer, never from inside a read, and only if nobody
//     has answered by then;
//   - hk-saver.js can answer for it: its upNext() already asks for the music slide, and calls
//     hkSaverWidgets._.media.setNext(key, next, song) with what it heard, so one song is one call;
//   - a failed or refused read is "no next song" until the song changes (not retried in a loop).
// A read that lands calls the renderer's calendar watchers (the same shared list the Countdown piece wakes its pieces with:
// `wakes` says 'calendar' for that reason), a moment later and once however many answers land: never inside a read.
// @ts-check
(function () {
  'use strict';
  var W = window.hkSaverWidgets;
  if (!W || !W.define || !W.PIECES) return;
  if (W._ && W._.media) return;                                 // loaded twice
  var H = W._;
  var esc = H.esc, inl = H.inl, cut = H.cut, DASH = H.DASH;

  var GROUP = 'Media and Photos';
  // The core Music piece has no accent of its own (its art is the color), so Up Next and Playing In take a calm violet;
  // On This Day a soft gold (the warm light of an old photograph). [light ink, black ink]
  var VIOLET = ['#b9a2ff', '#6a45c9'];
  var GOLD = ['#f0cf85', '#9a6f12'];

  // ------------------------------------------------------------ glyphs (24 x 24, the renderer's inline size 1.15 em; class a: the accent)
  var NEXT_GLYPH = '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M5 5.5v13l9.2-6.5z"/><path d="M16.6 5.5H19v13h-2.4z"/></svg>';
  var SPEAKER_GLYPH = '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M3.5 9.6h3.7l4.9-4.3v13.4l-4.9-4.3H3.5z"/>' +
    '<path d="M15.6 8.8a4.6 4.6 0 0 1 0 6.4M18.4 6.2a8.4 8.4 0 0 1 0 11.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var PHOTO_GLYPH = '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3.5" y="5" width="17" height="14" rx="2.8"/><circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none"/><path d="M4.4 17.2l4.6-4.4 3.2 3 2.6-2.4 4.8 3.8"/></svg>';

  // ------------------------------------------------------------ the music that plays (the core Music piece's own rule)
  function musicOn(X) {
    var m = X.ctx && X.ctx.music;
    return m && !m.idle && m.title ? m : null;
  }
  function sigOf(key, title, artist) { return String(key || '') + '|' + String(title || '') + '|' + String(artist || ''); }
  function str(x) { return typeof x === 'string' ? x : ''; }

  // ------------------------------------------------------------ UP NEXT: one read a song, shared
  var ASK_DELAY = 1500, ASK_LOST = 30000, WAKE_DELAY = 50, HEARD_MAX = 4;
  //   sig      key|title|artist of the song the slot is for ('' : none yet)
  //   next     undefined while unknown, null when there is none, else { title, artist }
  //   state    'wait' (a timer will ask), 'asking', 'done'
  var NEXT = { sig: '', key: '', next: undefined, state: 'done', n: 0, askedAt: 0, timer: null, wakeT: null, client: null, heard: {}, order: [] };

  // (the renderer's shared watchers each draw their piece again -- after the read has landed, and once however many land)
  function wakeSoon() {
    if (NEXT.wakeT) return;
    NEXT.wakeT = setTimeout(function () {
      NEXT.wakeT = null;
      var list = (H.cal && H.cal.watchers) || [];
      list.slice().forEach(function (f) { try { f(); } catch (e) { /* that piece is gone */ } });
    }, WAKE_DELAY);
  }
  function parse(r, key) {
    var q = r && r.response && r.response[key], n = q && q.next_item, mi = n && n.media_item;
    var title = str(mi && mi.name) || str(n && n.name);
    return title ? { title: title, artist: mi && mi.artists && mi.artists[0] ? str(mi.artists[0].name) : '' } : null;
  }
  function remember(sig, next) {
    if (NEXT.heard[sig] === undefined) {
      NEXT.order.push(sig);
      while (NEXT.order.length > HEARD_MAX) delete NEXT.heard[NEXT.order.shift()];
    }
    NEXT.heard[sig] = next;
  }
  function settle(sig, next) {
    remember(sig, next);
    if (NEXT.sig === sig) { NEXT.next = next; NEXT.state = 'done'; wakeSoon(); }
  }
  // asked from the timer a moment after the song changed, if nobody has answered
  function ask(sig, key) {
    NEXT.timer = null;
    if (NEXT.sig !== sig || NEXT.state !== 'wait') return;
    var c = NEXT.client, act = c && c.actions;
    if (!act || typeof act.callWS !== 'function') { settle(sig, null); return; }       // no port (or a host without Music Assistant)
    var n = ++NEXT.n;
    NEXT.state = 'asking'; NEXT.askedAt = Date.now();
    var done = function (v) { if (n === NEXT.n) settle(sig, v); };
    try {
      Promise.resolve(act.callWS({ type: 'call_service', domain: 'music_assistant', service: 'get_queue',
                                   service_data: { entity_id: key }, return_response: true }))
        .then(function (r) { done(parse(r, key)); }, function () { done(null); });
    } catch (e) { done(null); }
  }
  // the next song for the song playing: undefined until it is known. Called from a piece's read: it only ever sets a timer
  function nextOf(X, m) {
    var sig = sigOf(m.key, m.title, m.artist), now = Date.now();
    NEXT.client = X.client || NEXT.client;
    if (NEXT.sig !== sig) {
      if (NEXT.timer) { clearTimeout(NEXT.timer); NEXT.timer = null; }
      NEXT.sig = sig; NEXT.key = String(m.key || ''); NEXT.n++;
      if (NEXT.heard[sig] !== undefined) { NEXT.next = NEXT.heard[sig]; NEXT.state = 'done'; return NEXT.next; }
      NEXT.next = undefined; NEXT.state = 'wait';
      NEXT.timer = setTimeout(function () { ask(sig, NEXT.key); }, ASK_DELAY);
    } else if (NEXT.state === 'asking' && now - NEXT.askedAt > ASK_LOST) {
      NEXT.n++; NEXT.next = null; NEXT.state = 'done';       // (a read that never answers is given up on)
    }
    return NEXT.next;
  }
  // hk-saver.js's upNext() answers for the music slide: what it heard for `key`, null when there is no next song, and the
  // song it asked about ({ title, artist }; without it, the song this module last saw on that player)
  function setNext(key, next, song) {
    var sig = song ? sigOf(key, song.title, song.artist) : NEXT.sig && NEXT.key === String(key || '') ? NEXT.sig : '';
    if (!sig) return false;
    var v = next && str(next.title) ? { title: str(next.title), artist: str(next.artist) } : null;
    settle(sig, v);
    return true;
  }

  W.define('upnext', {
    name: 'Up Next', group: GROUP, wave: 'B', facts: ['upnext'], source: 'music_assistant.get_queue', when: 'while music plays',
    wakes: ['house', 'calendar'], pick: null, off: false, opts: {}, accent: VIOLET,
    shapes: {
      inline: {
        read: function (X) {
          var m = musicOn(X), n = m && !X.quiet ? nextOf(X, m) : null;
          return n ? { text: 'Next: ' + cut(n.title, 32), gl: 1 } : { off: true, text: '' };
        },
        draw: function (s) { return inl(NEXT_GLYPH, s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Next: Paper Lanterns', gl: 1 }
      },
      rectangular: {
        // the three lines of every rectangular piece, from one left edge: the label (in the accent), the song, its artist
        read: function (X) {
          var m = musicOn(X), n = m && !X.quiet ? nextOf(X, m) : null;
          return n ? { title: cut(n.title, 60), artist: cut(n.artist, 60) } : { off: true, title: '', artist: '' };
        },
        draw: function (s) {
          return '<div class="rt"><div class="l1 a">Up Next</div><div class="l2">' + esc(s.title) + '</div>' +
            (s.artist ? '<div class="l3">' + esc(s.artist) + '</div>' : '') + '</div>';
        },
        sample: { title: 'Paper Lanterns', artist: 'The Fictional Trio' }
      }
    }
  });

  // ------------------------------------------------------------ PLAYING IN: the rooms
  // the label of the playing context (hkMusic: "Kitchen + Living Room", "Kitchen +3", a preset's name), else the room the
  // screensaver's own reading already named
  function roomsOf(X, m) {
    var M = window.hkMusic, label = '';
    try {
      if (M && typeof M.contexts === 'function' && typeof M.label === 'function' && X.client) {
        var list = M.contexts(X.client) || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].key === m.key) { label = String(M.label(list[i]) || ''); break; }
        }
      }
    } catch (e) { label = ''; }
    return label || String(m.room || '');
  }
  W.define('playin', {
    name: 'Playing In', group: GROUP, wave: 'B', facts: ['playin'], source: 'hkMusic', when: 'while music plays',
    wakes: ['house'], pick: null, off: false, opts: {}, accent: VIOLET,
    shapes: {
      inline: {
        read: function (X) {
          var m = musicOn(X), rooms = m && !X.quiet ? roomsOf(X, m) : '';
          return rooms ? { text: cut(rooms, 36), gl: 1 } : { off: true, text: '' };
        },
        draw: function (s) { return inl(SPEAKER_GLYPH, s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Kitchen + Living Room', gl: 1 }
      }
    }
  });

  // ------------------------------------------------------------ ON THIS DAY: a photo from this day in an earlier year
  // how many years ago the day "YYYY-MM-DD" was, when it is today's month and day (a February 29th on the 28th, in a year
  // without one); null when it is not, is not a real day, or is not before this year
  function yearsAgo(date, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date == null ? '' : date));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], real = new Date(y, mo - 1, d);
    if (real.getFullYear() !== y || real.getMonth() !== mo - 1 || real.getDate() !== d) return null;
    var ny = now.getFullYear(), leap = ny % 4 === 0 && (ny % 100 !== 0 || ny % 400 === 0);
    if (mo === 2 && d === 29 && !leap) d = 28;
    if (mo !== now.getMonth() + 1 || d !== now.getDate()) return null;
    return ny - y >= 1 ? ny - y : null;
  }
  function agoWords(n) { return n === 1 ? 'A year ago today' : n + ' years ago today'; }
  W.define('thisday', {
    name: 'On This Day', group: GROUP, wave: 'B', facts: ['thisday'], source: 'photo', when: 'over a photo from this day',
    wakes: ['minute', 'house'], pick: null, off: false, opts: {}, accent: GOLD,
    shapes: {
      inline: {
        read: function (X) {
          var p = X.ctx && X.ctx.photo, n = p && !X.quiet ? yearsAgo(p.date, X.now) : null;
          return n ? { text: agoWords(n), gl: 1 } : { off: true, text: '' };
        },
        draw: function (s) { return inl(PHOTO_GLYPH, s.text); },
        text: function (s) { return s.text; },
        sample: { text: '3 years ago today', gl: 1 }
      }
    }
  });

  // (for the tests, and for hk-saver.js: setNext(key, next, song) is how its upNext() hands over what it heard)
  W._.media = {
    setNext: setNext, nextOf: nextOf, yearsAgo: yearsAgo, agoWords: agoWords, roomsOf: roomsOf, ASK_DELAY: ASK_DELAY,
    reset: function () {
      if (NEXT.timer) clearTimeout(NEXT.timer);
      if (NEXT.wakeT) clearTimeout(NEXT.wakeT);
      NEXT.sig = ''; NEXT.key = ''; NEXT.next = undefined; NEXT.state = 'done'; NEXT.n++; NEXT.askedAt = 0; NEXT.timer = null; NEXT.wakeT = null;
      NEXT.client = null; NEXT.heard = {}; NEXT.order = [];
    },
    state: function () { return { sig: NEXT.sig, state: NEXT.state, next: NEXT.next, asked: NEXT.n }; },
    VIOLET: VIOLET, GOLD: GOLD
  };
})();
