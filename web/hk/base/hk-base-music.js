// hk-base-music.js - hkMusic: the music model.
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-music'] = function (K) {
    var asClient = K.asClient, ST = K.ST;

    var MUSIC_KEY = 'hk_music_focus';
    // Longer than the slowest measured playlist start (12.7s) with room for a
    // regroup ahead of it; bounded, so a request that never lands cannot pin a
    // screen to a silent room.
    var MUSIC_HOLD = 45000;

    var hkMusic = (function () {
      var byEntity = {}, partOf = {};
      // A VIRTUAL PAIR (2026-10-31, docs/phase4/VIRTUAL-PAIRS.md): two Music
      // Assistant players made one room in Mantel Settings. Its `parts` are
      // both players, the room first; the second is folded into the room
      // wherever a group's members are read, so it is one speaker everywhere.
      function index() {
        byEntity = {}; partOf = {};
        ST.MUSIC.speakers.forEach(function (s) {
          byEntity[s.entity] = s;
          (s.parts || []).forEach(function (p) { if (p !== s.entity) partOf[p] = s.entity; });
        });
      }
      index();
      // `seen`: the contexts already playing when this focus was chosen, by
      // key -> since. Taken on the first resolve after a change, because a
      // choice has no state of its own. Only music NOT in it can pull a screen
      // whose own music has gone quiet.
      var focus = { key: null, at: 0, hold: 0, seen: null };
      // The context this screen is following (rule 3), so a PAUSE does not let
      // go of it: the bar's own pause would otherwise drop the screen back to
      // its idle focus -- the bar gone at the tap, Play Music "Ready on" a
      // room nobody asked for (measured on the Living Room tablet, following
      // the Office). A focused key keeps its paused music (rule 1); a
      // followed one now does too, until it stops or something else starts.
      var follow = null;
      var listeners = [];
      // conn: the subscription port attached; writer: the newest client on it.
      var conn = null, writer = null, writing = 0, attachEpoch = 0, closers = [];

      function known(e) { return !!(e && byEntity[e]); }
      // players as rooms, in their order: a pair's second player is its room, once
      function fold(list) {
        var out = [];
        (list || []).forEach(function (e) { var r = partOf[e] || e; if (out.indexOf(r) < 0) out.push(r); });
        return out;
      }
      function isGroup(e) { return !!(byEntity[e] && byEntity[e].members); }
      function rooms() { return ST.MUSIC.speakers.filter(function (s) { return !s.members; }); }
      function presets() { return ST.MUSIC.speakers.filter(function (s) { return !!s.members; }); }
      function nameOf(e) { return (byEntity[e] && byEntity[e].name) || e; }
      // WHO LEADS A PICK of rooms nothing plays on yet (hk_core MusicConfig.leader_of): the first of the house's
      // preferred leaders among them, else the first that is not an announcement room, else the first. A library
      // item plays there, then the others join it (2026-11-02: an announcement to the leader plays on its whole group)
      function leader(list) {
        list = list || [];
        var ann = ST.MUSIC.announce_rooms || [];
        var best = (ST.MUSIC.leaders || []).filter(function (r) { return list.indexOf(r) >= 0; })[0];
        return best || list.filter(function (r) { return ann.indexOf(r) < 0; })[0] || list[0] || null;
      }
      // THIS USER'S room -- each wall tablet signs in as its own user, and the
      // integration's options map users to rooms.
      function home() { return known(ST.MUSIC.home) ? ST.MUSIC.home : null; }
      // An Intercom message always; else only explicit announcement evidence (short tracks, no metadata and AirPlay's app name are music too).
      function ignored(st) {
        if (!st || ST.MUSIC.intercom.indexOf(st.entity_id) >= 0) return !!st;
        if (!ST.MUSIC.ignore_announcements) return false;
        var a = st.attributes || {}, id = String(a.media_content_id || '');
        return ST.MUSIC.announcements.indexOf(st.entity_id) >= 0 || a.announcement === true ||
          a.media_content_type === 'announcement' || id.indexOf('media-source://tts/') === 0 ||
          /^https?:\/\/[^/]+\/api\/tts_proxy\//.test(id);
      }
      function active(st) { return !!st && !ignored(st) && (st.state === 'playing' || st.state === 'paused' || held(st)); }
      // MUSIC STOPPED AFTER A PAUSE (2026-11-01, hk_core/music/resume.py): Music
      // Assistant stops a queue paused for 30 s, keeping its song and where it
      // was; the integration lists those players (`resumable`), and they read
      // as paused here, so the Music page keeps the song and play resumes it.
      function held(st) { return !!st && st.state === 'idle' && ST.MUSIC.resumable.indexOf(st.entity_id) >= 0; }

      // localStorage is only the FIRST PAINT, before the server answers. It can
      // throw (private mode, blocked storage) and may be empty; both are fine.
      try {
        var raw = window.localStorage && localStorage.getItem(MUSIC_KEY);
        var v0 = raw && JSON.parse(raw);
        // NOT checked against the speakers here: they arrive from the
        // integration AFTER this runs. resolve() ignores a key it does not know.
        if (v0 && typeof v0.key === 'string') { focus.key = v0.key; focus.at = v0.at || 0; }
      } catch (e) { /* no storage: the server copy or the home room will do */ }

      function emit() {
        listeners.slice().forEach(function (fn) {
          try { fn(); } catch (e) { console.error('[hkMusic] listener failed', e); }
        });
      }

      // EVERY SEPARATE THING THE HOUSE IS PLAYING, derived fresh each call.
      //   group   a join, keyed by its LEADER (group_members[0]); `preset` names
      //           the preset whose rooms it is exactly
      //   room    one room on its own
      // A PRESET IS ITS ROOMS (2026-11-01, hk_core/music/config.py): no Music
      // Assistant group plays it, so it is never a player of its own -- its id
      // (`entity`, "preset:...") is for choosing it, never for a command.
      function contexts(client) {
        var states = (client && client.states) || {};
        var seen = {}, out = [];
        function ctx(key, kind, members, st) {
          var a = (st && st.attributes) || {};
          return {
            key: key, kind: kind, leader: members[0], members: members,
            playing: !!st && st.state === 'playing', state: st ? (held(st) ? 'paused' : st.state) : 'unknown',
            title: a.media_title || '', artist: a.media_artist || '',
            image: a.entity_picture_local || a.entity_picture || null,
            since: Date.parse(st && st.last_changed) || 0,
            // (what streams() compares: where the music comes from, and how far in)
            app: a.app_id || a.source || '',
            pos: typeof a.media_position === 'number' ? a.media_position : null,
            posAt: Date.parse(a.media_position_updated_at) || 0
          };
        }
        rooms().forEach(function (r) {
          if (seen[r.entity]) return;
          var st = states[r.entity];
          if (!active(st)) return;
          var gm = fold((st.attributes || {}).group_members || []).filter(function (e) {
            return known(e) && !isGroup(e) && !ignored(states[e]);
          });
          var members = gm.length > 1 ? gm : [r.entity];
          members.forEach(function (m) { seen[m] = 1; });
          var lead = members[0];
          var c = ctx(lead, members.length > 1 ? 'group' : 'room', members, states[lead] || st);
          if (members.length > 1) { var pre = presetOf(members); if (pre) c.preset = pre.name; }
          out.push(c);
        });
        return out;
      }
      // the preset whose rooms are exactly these, or null
      function presetOf(members) {
        return presets().filter(function (p) {
          return p.members.length === members.length && members.every(function (m) { return p.members.indexOf(m) >= 0; });
        })[0] || null;
      }

      // THE SAME MUSIC IN SEVERAL ROOMS THAT ARE NOT JOINED (2026-10-14). An
      // iPhone AirPlaying Apple Music to every HomePod at once is nine players
      // to Music Assistant -- no group_members, no sync group -- so contexts()
      // is nine rooms, each "Dynamite", and the Music page's house list ran the
      // song and its controls off the foot of the Kitchen tablet. A LIST OF
      // WHAT PLAYS shows them as one: contexts with the same song, artist and
      // source, in the same play state and within SAME_POS seconds of each
      // other where both say how far in. {key, ctxs, members, title, artist,
      // image, playing, state}; `key` is its first context's.
      //
      // FOR DRAWING ONLY. Each context is still its own player: a stream is
      // never a COMMAND target -- a card hands the screen one of its contexts,
      // and the buttons act on that one player, as drawn.
      var SAME_POS = 10;
      function streams(ctxs, now) {
        now = now || Date.now();
        function at(c) {
          if (c.pos === null || c.pos === undefined) return null;
          return c.pos + (c.playing && c.posAt ? Math.max(0, now - c.posAt) / 1000 : 0);
        }
        function same(a, b) {
          if (!a.title || a.title !== b.title || a.artist !== b.artist || a.app !== b.app || a.playing !== b.playing) return false;
          var pa = at(a), pb = at(b);
          return pa === null || pb === null || Math.abs(pa - pb) <= SAME_POS;
        }
        var out = [];
        (ctxs || []).forEach(function (c) {
          var s = out.filter(function (x) { return same(x.ctxs[0], c); })[0];
          if (s) { s.ctxs.push(c); s.members = s.members.concat(c.members); return; }
          out.push({ key: c.key, ctxs: [c], members: c.members.slice(), title: c.title, artist: c.artist,
                     image: c.image, playing: c.playing, state: c.state });
        });
        return out;
      }

      function label(c, key) {
        if (!c) return key ? nameOf(key) : '';
        if (c.preset) return c.preset;
        // "Kitchen + Loft" at two, "Kitchen +3" beyond -- the picker's
        // convention, and everyone's: a five-room list does not fit, and two
        // names do.
        var n = c.members.length;
        if (n === 2) return nameOf(c.members[0]) + ' + ' + nameOf(c.members[1]);
        return n > 2 ? nameOf(c.leader) + ' +' + (n - 1) : nameOf(c.leader);
      }

      // {player, context, reason, name}. `reason` says which rule answered, so a
      // card -- and a person debugging one -- can tell "you chose this" from
      // "this is what is playing".
      function resolve(client) {
        var ctxs = contexts(client);
        // (only the LAST answer's follow carries over: any other answer ends it)
        var was = follow; follow = null;
        var now = Date.now();
        var key = known(focus.key) ? focus.key : null;
        // FIRST RESOLVE AFTER A CHOICE: remember what was already playing, so
        // only something that starts later can pull this screen away.
        //
        // "ALREADY" MEANS WHEN THE CHOICE WAS MADE, not when this page loaded.
        // A choice restored from the server or the first-paint copy (a reload,
        // a cleared cache) was made at `at`: music that started after it was
        // being followed before the reload and must still be. Measured from
        // the load instead, every reload took it as already playing and
        // dropped it -- the Master Bedroom tablet, its choice Everywhere at
        // 14:13, Downstairs started at 16:11, after a cleared cache showed
        // "Ready on Everywhere" and two cards over the art (2026-10-11). A
        // choice made HERE (`fresh`) keeps the plain rule: whatever plays at
        // that tap, so a tablet's clock a few seconds off the server's cannot
        // count music already playing as new.
        if (key && focus.seen === null) {
          focus.seen = {};
          ctxs.forEach(function (c) {
            if (c.playing && (focus.fresh || !focus.at || c.since <= focus.at)) focus.seen[c.key] = c.since;
          });
        }
        var mine = key && ctxs.filter(function (c) {
          return c.key === key || c.members.indexOf(key) >= 0;
        })[0];
        if (mine) return { player: mine.key, context: mine, reason: 'focus', name: label(mine) };
        if (key && now < focus.hold) return { player: key, context: null, reason: 'pending', name: nameOf(key) };
        var seen = key ? focus.seen : null;
        var playing = ctxs.filter(function (c) {
          return (c.playing || c.key === was) && (!seen || seen[c.key] !== c.since);
        });
        if (playing.length) {
          var h = home();
          // music that is playing before the followed music paused, then this
          // tablet's own room, then the newest
          playing.sort(function (a, b) {
            var ah = h && a.members.indexOf(h) >= 0 ? 1 : 0;
            var bh = h && b.members.indexOf(h) >= 0 ? 1 : 0;
            return ((b.playing ? 1 : 0) - (a.playing ? 1 : 0)) || (bh - ah) || (b.since - a.since);
          });
          follow = playing[0].key;
          return { player: playing[0].key, context: playing[0], reason: 'following',
                   name: label(playing[0]) };
        }
        var fall = key || home();
        return { player: fall, context: null, reason: key ? 'idle' : (fall ? 'home' : 'none'),
                 name: fall ? nameOf(fall) : '' };
      }

      // An explicit choice: a context card tapped, or a request sent. `hold`
      // keeps it on screen while the request is still landing.
      function setFocus(key, opts) {
        if (!known(key)) return false;
        var now = Date.now();
        focus.key = key; focus.at = now; focus.seen = null; focus.fresh = true; follow = null;
        focus.hold = opts && opts.hold ? now + MUSIC_HOLD : 0;
        try { if (window.localStorage) localStorage.setItem(MUSIC_KEY, JSON.stringify({ key: key, at: now })); }
        catch (e) { /* first-paint copy only */ }
        if (writer && writer.actions) {
          writing++;
          Promise.resolve(writer.actions.callWS({ type: 'frontend/set_user_data', key: MUSIC_KEY,
                                          value: { key: key, at: now } }))
            .catch(function (e) { console.error('[hkMusic] could not save focus', e); })
            .then(function () { writing--; });
        }
        emit();
        return true;
      }
      // A request that failed must not keep holding a silent room on screen.
      function release(key) {
        if (focus.key === key && focus.hold) { focus.hold = 0; emit(); }
      }

      // The server copy, followed live: the same user on another screen (your
      // phone and Chrome are one user) moves with it. Ignored while this screen
      // is mid-write, so its own older value cannot bounce back over a newer one.
      // The integration's answer: a new configuration replaces the old one
      // whole. A stored focus that is no longer a speaker is simply ignored by
      // resolve(), so an edit can never leave a screen pointing at nothing.
      function configure(cfg) {
        ST.MUSIC = {
          configured: !!(cfg && cfg.configured),
          speakers: (cfg && cfg.speakers) || [],
          floors: (cfg && cfg.floors) || [],
          playlists: (cfg && cfg.playlists) || [],
          home: (cfg && cfg.home) || null,
          ignore_announcements: !!(cfg && cfg.ignore_announcements),
          announcements: (cfg && cfg.announcements) || [], intercom: (cfg && cfg.intercom) || [],
          leaders: (cfg && cfg.leaders) || [],
          announce_rooms: (cfg && cfg.announce_rooms) || [],
          resumable: (cfg && cfg.resumable) || [],
          volume: cfg && cfg.volume,
          library: (cfg && cfg.library_entry) || null
        };
        index();
        emit();
      }

      // ONE SET OF SUBSCRIPTIONS PER CONNECTION, retried (hkSettings.subscribe):
      // a subscribe that fails -- the page reconnected while Home Assistant was
      // still starting -- would otherwise leave every music card empty until a reload.
      function sub(c, msg, fn, label) {
        var s = window.hkSettings && window.hkSettings.subscribe;
        if (s) return s(c, msg, fn, label);
        c.subscribeMessage(fn, msg).catch(function (e) {    // a harness without hk-settings
          console.error('[' + label + '] not available', e);
        });
        return function () {};
      }

      // THROUGH THE HOST'S SUBSCRIPTION PORT: new state snapshots on the same
      // socket share one port, so they never subscribe twice. A replacement port
      // ends the old pair first, and an old pair's late answer is ignored.
      function attach(source) {
        var client = asClient(source), c = client && client.subscriptions;
        if (!c) return;
        if (c === conn) { writer = client; return; }
        closers.splice(0).forEach(function (close) { close(); });
        conn = c; writer = client;
        var my = ++attachEpoch;
        closers.push(sub(c, { type: 'hk_music/subscribe' }, function (cfg) {
          if (my === attachEpoch) configure(cfg);
        }, 'hkMusic'));
        closers.push(sub(c, { type: 'frontend/subscribe_user_data', key: MUSIC_KEY }, function (ev) {
          if (my !== attachEpoch) return;
          var v = ev && ev.value;
          // A key is taken even if the speaker list has not arrived yet (the
          // two subscriptions answer in either order); resolve() validates it.
          if (writing || !v || typeof v.key !== 'string' || v.key === focus.key) return;
          focus.key = v.key; focus.at = v.at || 0; focus.hold = 0; focus.seen = null; focus.fresh = false;
          try { if (window.localStorage) localStorage.setItem(MUSIC_KEY, JSON.stringify(v)); }
          catch (e) { /* first-paint copy only */ }
          emit();
        }, 'hkMusic focus'));
      }

      // ATTACHED BY THE PAGE, not only by the music cards: a Speakers chip
      // (count: {music: true}) or a popup opened by `entity_from: {music: true}`
      // needs the speaker list on a page with no music card on it.
      // The host adapter owns discovery; its events also catch a late adapter
      // and a replacement connection on a page with no music card.
      (function () {
        var tries = 0;
        function selfAttach() {
          var host = window.hkHostClient, client = null;
          try { client = host && host.current ? host.current() : null; } catch (e) { return true; }
          if (!(client && client.subscriptions)) return false;
          attach(client);
          return true;
        }
        window.addEventListener('hk-host-client-ready', selfAttach);
        window.addEventListener('hk-client-update', selfAttach);
        if (selfAttach()) return;
        var t = setInterval(function () {
          if (selfAttach() || ++tries >= 300) clearInterval(t);   // a minute; cards attach too
        }, 200);
      })();

      function onChange(fn) {
        listeners.push(fn);
        return function () {
          var i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        };
      }

      return {
        speakers: function () { return ST.MUSIC.speakers.slice(); },
        rooms: rooms, presets: presets, known: known, isGroup: isGroup, fold: fold,
        nameOf: nameOf, leader: leader, home: home, ignored: ignored, active: active, contexts: contexts, streams: streams, resolve: resolve,
        player: function (client) { return resolve(client).player; },
        label: label, setFocus: setFocus, release: release, attach: attach,
        onChange: onChange, focus: function () { return focus.key; },
        configured: function () { return ST.MUSIC.configured; },
        floors: function () { return ST.MUSIC.floors.slice(); },
        playlists: function () { return ST.MUSIC.playlists.slice(); },
        libraryEntry: function () { return ST.MUSIC.library || null; },
        HOLD: MUSIC_HOLD,
        // Tests only: start from a clean slate, and hand in a configuration.
        _reset: function () { focus = { key: null, at: 0, hold: 0, seen: null }; follow = null; listeners = []; conn = null; writer = null; writing = 0; },
        _configure: configure
      };
    })();

    // what the shell and the later parts use of this one
    K.hkMusic = hkMusic;
  };
})();
