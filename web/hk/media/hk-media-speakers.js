// hk-media-speakers.js - the speaker picker and the notification ids it shows.
//
// PART OF THE MUSIC AND MEDIA CARDS (hk-media.js). Not a card and not run on its own: it registers one
// function, which hk-media.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkMediaParts = window.hkMediaParts || {})['hk-media-speakers'] = function (K) {
    var button = K.button, create = K.create, drawNoMusic = K.drawNoMusic, feed = K.feed, HkBase = K.HkBase, M = K.M,
        musicMissing = K.musicMissing, SELECTED_BG = K.SELECTED_BG, SELECTED_TEXT = K.SELECTED_TEXT;

    // ======================================================= SPEAKER PICKER
    // The Play Music page's speaker selection. Same shape as HkAreaSelectCard
    // above -- a card-local Set, nothing written to HA until you press a
    // playlist -- and for the same reason: which rooms you want music in right
    // now is a per-screen choice that lasts seconds. It is not global state and
    // two tablets must not share it. See that card's header.
    //
    // WHY THE PLAYLIST TILES LIVE INSIDE THIS CARD.
    // A separate card cannot read this one's Set, so the action that
    // consumes the selection has to sit with it -- exactly how Clean/Clear
    // sit with the area pills. It also reads better: pick rooms, pick music,
    // one gesture.
    //
    // HOW A SELECTION BECOMES A PLAYER (the whole design, in two rules):
    //   1. selection == exactly one speaker -> that speaker.
    //   2. anything else (2+, a preset's rooms too) -> a join of those
    //      speakers. A preset is a name for its rooms (2026-11-01): no Music
    //      Assistant sync group plays it, since one cannot pause.
    class HkSpeakerPickerCard extends HkBase {
      static get CSS() {
        return [
          // --hk-track, NOT the vacuum picker's literal 228px.
          //
          // Two reasons. (1) This page's playlist tiles are the pill's width, so a 228px
          // pill grid puts the two grids on different right edges -- visible as
          // a ragged column down the middle of the page. (2) THE PHONE LAYOUT
          // INCLUDES THIS PAGE, and below 640px hk-responsive.css redefines
          // --hk-track to minmax(168px, 1fr). A custom property inherits THROUGH
          // a shadow boundary, so writing the var here is what makes this card
          // reflow on a phone; a literal 228px would overflow a 402px screen and
          // never wrap.
          // The literal in the fallback keeps that file's contract: above 640px
          // the computed value is unchanged.
          '.grid{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));',
          '  grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap + 'px;margin:0 0 14px 0}',
          '.presets{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));',
          '  grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap + 'px;margin:0 0 14px 0}',
          // --hk-cell-bleed:0. Below 640px BASE_CSS sizes a .tile
          // `calc(100% + var(--hk-cell-bleed, 8px))`, and that 8px exists to pay
          // back the 4px side margins LAYOUT-CARD gives its grid children. These
          // tiles are children of the grid right here, which gives them no such
          // margin, so the default bleed just makes them 8px too wide -- measured
          // on a 402px phone, 187px tiles in a 179px column, eating the gap.
          // hk-row.js sets the same 0 on its own children for the same reason.
          '.tiles{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));',
          '  grid-auto-rows:' + window.hkCards.TILE.h + 'px;gap:' + window.hkCards.TILE.gridGap + 'px;margin:4px 0 16px 0}',
          // THE SAME LIFT THE PILLS HAVE, so the playlist buttons have a shadow
          // too. Measured: every pill in this card carries
          // `0 6px 18px rgba(0,0,0,.1)` from BASE_CSS, and a tile with only an
          // inset highlight sits flat on the page beside controls that do not --
          // invisible on a plate, obvious once the background is a photograph.
          //
          // On the HOST, not the tile's own hk-plate: that card lives in another
          // shadow root this file cannot reach. The host is display:block and
          // the card fills it exactly (measured, pill-sized for both), so a shadow
          // here traces the same box -- as long as it also carries the same
          // radius, hence the shared token rather than the 23.5px literal.
          '.tiles > *{--hk-cell-bleed:0px;border-radius:' + window.hkCards.M.radius + ';',
          '  box-shadow:var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,0.10))}',
          // 37px of top padding, and the number is an ALIGNMENT, not a taste.
          //
          // It gives more air above this heading AND lines the bottom of the
          // second row of pills up with the volume slider line -- the two wants
          // turn out to be the same number. Measured at a tablet's content size:
          // the volume slider's centre line sits at 755 and the second row of
          // playlist tiles would end at 740, so the 15px of air lands the tile
          // row exactly on the slider. The left column's last control and the
          // right column's last row share a line.
          //
          // IT IS ONLY TRUE FOR THIS STACK. Add a speaker, a floor or a
          // playlist row and it drifts -- re-measure rather than trusting it.
          '.sub{font-size:15px;font-weight:600;letter-spacing:-0.2px;',
          '  color:' + window.hkCards.v('ink-2') + ';padding:37px 4px 8px 4px}',
          '.notice{font-size:14px;color:' + window.hkCards.v('warn') + ';',
          '  padding:0 4px 8px 4px}',
          '.notice.note{cursor:pointer}',
          // Same rule as the vacuum picker: it separates things that only change
          // a selection from things that act on the home.
          '.rule{height:1px;margin:6px 4px 16px 4px;padding:0;border:none;',
          '  border-radius:0;box-shadow:none;background:' + window.hkCards.v('line') + '}',
          // A preset is a shortcut, not a twelfth speaker. The dashed border says
          // "this fills the boxes below" without inventing a new material.
          // (Tinted draws no edge: --hk-look-dash gives the shortcut its own)
          '.preset{border:var(--hk-look-dash, ' + window.hkCards.M.border + ');border-style:dashed}',
          '.preset[aria-pressed="true"]{border-style:solid}',

          // ---- THE CONTEXT ROW: one card per separate thing the home is
          // playing, and the only new furniture this feature adds.
          //
          // IT APPEARS ONLY WHEN THERE IS SOMETHING TO CHOOSE BETWEEN. One
          // context is what the page already shows in full, at the size of half
          // the screen -- a card repeating it would be a second, smaller copy of
          // the answer. So below two contexts this row is not rendered at all.
          // THE PILL TRACK, AND A SCROLLER: the cards take the same pill width as
          // everything else, and the row scrolls sideways, since more players
          // playing would otherwise make it look worse.
          //
          // Both halves are the same fix. A wrapping row of wide cards grows a
          // second and third line as the home gets busier, pushing the speakers
          // down the page; a scroller is fixed height whatever happens, and nine
          // contexts cost one row either way. Same `--hk-track` as every other
          // grid on this page, so nothing here has a width of its own.
          //
          // grid-auto-flow:column is what makes it a row rather than a wrap --
          // the same shape the Discover shelves on the Browse page use.
          // THE PADDING IS SHADOW ROOM, and the negative margin gives it back.
          // Same defect and same fix as the Discover shelves on the Browse page
          // (see hk-library.js `.shelf .row` for the measurement): a horizontal
          // scroller has to carry `overflow-y:hidden` -- CSS promotes a
          // `visible` other-axis to `auto` -- so it clips the `0 6px 18px` lift
          // on these cards unless the shadow has somewhere to land inside the
          // box. 2px is not enough on any side except the bottom.
          //
          // The margin cancels the padding exactly, so the cards do not move
          // and the row still lines up with the pill grids below it.
          '.ctx{display:grid;grid-auto-flow:column;',
          '  grid-auto-columns:var(--hk-track,' + window.hkCards.TILE.w + 'px);gap:' + window.hkCards.TILE.gridGap + 'px;',
          '  overflow-x:auto;overflow-y:hidden;',
          '  margin:-8px -12px 8px -12px;',
          '  padding:8px 12px 14px 12px;scrollbar-width:none;',
          '  -webkit-overflow-scrolling:touch}',
          '.ctx::-webkit-scrollbar{display:none}',
          // The same plate, radius and lift as every other card on the page; the
          // only new shape is the 38px artwork chip, which is what makes a
          // context recognisable at a glance from across the room.
          '.cx{border-radius:' + M.radius + ';border:' + M.border + ';',
          '  ' + M.glass + ';box-shadow:var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,0.10));',
          '  padding:9px 12px;display:grid;grid-template-columns:38px minmax(0,1fr);',
          '  column-gap:10px;align-items:center;cursor:pointer;user-select:none;',
          '  transition:background-color .22s ease, transform .12s ease}',
          '.cx:active{transform:scale(0.97)}',
          '.cx .sw{width:38px;height:38px;border-radius:9px;overflow:hidden;',
          '  background:' + window.hkCards.v('key') + ';display:flex;',
          '  align-items:center;justify-content:center}',
          '.cx .sw img{width:100%;height:100%;object-fit:cover;display:block}',
          '.cx .sw hk-icon{--mdc-icon-size:20px;width:20px;height:20px;',
          '  color:var(--hk-glyph,rgba(255,255,255,0.7))}',
          // THE TEXT SCROLLS WHEN IT WILL NOT FIT in the smaller pill.
          //
          // On a 192px card, minus a 38px cover and its gap and the padding,
          // the text has ~118px -- enough for most room names and almost no
          // track titles. An ellipsis hides exactly the half that identifies
          // the song, so the ones that do not fit travel instead.
          //
          // ONLY THE ONES THAT NEED IT. `.go` is set per element, measured
          // after layout, so a name that fits sits still -- a row where
          // everything slides is unreadable, and most of these fit.
          '.cx .nm,.cx .tr{white-space:nowrap;overflow:hidden;',
          '  text-overflow:ellipsis}',
          '.cx .nm{font-size:13px;font-weight:700;letter-spacing:-0.2px;',
          '  color:' + window.hkCards.v('ink') + '}',
          '.cx .tr{margin-top:1px;font-size:11.5px;font-weight:500;',
          '  color:' + window.hkCards.v('ink-2') + '}',
          // The travelling element loses its ellipsis -- the two together read
          // as a bug, a line that slides AND is cut off at the same edge.
          '.cx .go{text-overflow:clip}',
          '.cx .go > span{display:inline-block;padding-right:28px;',
          '  animation:hk-cx-slide var(--hk-cx-dur,9s) linear infinite}',
          // Duplicated content means the line never shows a gap at the end of a
          // pass; the copy arrives as the original leaves.
          '@keyframes hk-cx-slide{from{transform:translateX(0)}',
          '  to{transform:translateX(-50%)}}',
          // A wall tablet that has asked for less motion gets none: the text
          // goes back to an ellipsis rather than sliding forever in the corner
          // of somebody's eye.
          '@media (prefers-reduced-motion: reduce){',
          '  .cx .go{text-overflow:ellipsis}',
          '  .cx .go > span{animation:none;padding-right:0}}',
          // THE CURRENT ONE IS THE SOLID WHITE PLATE, exactly as a selected pill
          // is. One selection material on the page, used for one meaning: "this
          // is the one you are acting on".
          '.cx[aria-pressed="true"]{background:' + SELECTED_BG + '}',
          '.cx[aria-pressed="true"] .nm{color:' + SELECTED_TEXT + '}',
          '.cx[aria-pressed="true"] .tr{color:rgba(0,0,0,0.58)}',
          '.cx[aria-pressed="true"] .sw{background:rgba(0,0,0,0.10)}',

          // ---- THE THIRD STATE: is this room playing, and is it playing what
          // the player at the top of this page is showing?
          //
          // A GLYPH, NOT A COLOUR: colour requires knowing what the colours
          // mean. A play triangle does not -- sound is coming out of this
          // room -- so the icon carries the fact and the colour only refines it.
          // Learn nothing and you still read which rooms are making noise.
          //
          // NOT A SECOND LINE. The pill is 40px with one centred 13.5px label; a
          // status line under it needs ~52px, and that breaks the 192x40 track
          // this page shares with the room pills, the preset pills,
          // Clear/Transfer/Browse and the Vacuum page's actions. One page growing
          // its pills to explain itself would cost the consistency of five grids.
          //
          // ABSOLUTE, at the right edge. The pill is `display:grid` with a
          // single 1fr column and the label centred in it, so an icon in flow
          // would shove the label sideways on exactly the rooms that happen to
          // be playing -- a grid that twitches as music starts and stops.
          '.pill{position:relative}',
          // top:0;bottom:0 + flex, rather than top:50% + translate: the glyph
          // centres against the PILL's box however tall the svg turns out to
          // be, which top:50% does not.
          // 16px, not 13: at 13 the play glyph reads as a speck at arm's length
          // -- and this glyph is the whole third state, so a speck is the same as
          // nothing. The contrast is up with it: 0.88 on glass, 0.68 on the
          // selected white plate.
          '.pill .pi{position:absolute;right:10px;top:0;bottom:0;',
          '  display:flex;align-items:center;pointer-events:none;',
          '  color:' + window.hkCards.v('glyph') + '}',
          '.pill .pi svg{width:16px;height:16px;display:block;fill:currentColor}',
          // AMBER ONLY FOR THE EXCEPTION. "Playing what you are looking at" is
          // the ordinary case and takes the ordinary colour; "playing something
          // else" is the thing you did not know, and --hk-warn is the right
          // register for it -- not an error, but worth a look. That is the
          // information hierarchy the colour is allowed to carry, on top of a
          // glyph that already works without it.
          '.pill.elsewhere .pi{color:' + window.hkCards.v('warn') + '}',
          // The selected plate is near-white, so a white glyph would vanish
          // into it. Amber still reads on white, so only `here` needs this.
          '.pill[aria-pressed="true"] .pi{color:rgba(0,0,0,0.68)}',
          '.pill[aria-pressed="true"].elsewhere .pi{color:#B26A00}',
          // The label is centred across the whole pill, so a long name would
          // run under the glyph. Give it back the 16px the glyph occupies.
          // `> span` MATCHES THE GLYPH TOO, which is why the play glyph cannot
          // compensate for rooms with long names on its own.
          // The glyph lives in a <span class="pi">, which is a direct child of
          // the pill -- so `.pill.here > span{padding:0 22px}` pads the GLYPH
          // as well, blowing it up to a 60px box and dragging the arrow 22px
          // left, straight into the end of a long room name.
          //
          // Measured with that rule, from the pill's right edge:
          //     glyph span [11, 71]   arrow itself [33, 49]
          //     "Primary Bedroom" text ended at 39  -- inside the arrow
          //     "Office" ended at 76               -- clear of it, which is why
          //                                           only long names looked wrong
          //
          // The label alone is padded, and the glyph is explicitly unpadded,
          // so every arrow sits in the same place off the right side of the pill
          // whatever the name is.
          '.pill > span.pi{padding:0}',
          '.pill.here > span:not(.pi),.pill.elsewhere > span:not(.pi){padding:0 22px}',
          // Clear sits alone under the speaker grid, on the SAME track so it
          // lines up under the left-hand column instead of floating.
          //
          // It gets NO quieter label. A 55%/500 label against the normal 86%/600
          // reads as DISABLED -- and the pill really does disable itself at zero
          // selection, by dropping to opacity 0.35. Two near-identical greys for
          // "usable" and "not usable" is worse than none: measured side by side,
          // an enabled Clear with that label looks greyer than an unselected room
          // next to it. Its position under the grid, and the fact that it never
          // lights, are what mark it as different.
          '.clearrow{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));',
          '  grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap + 'px;margin:0 0 14px 0}',
          // THE LAST COLUMN, whatever the auto-fill count turns out to be.
          // -2/-1 is the final track of the explicit grid, which is what
          // auto-fill builds -- so this follows the room pills above it to
          // four columns on a tablet without naming the number twice.
          '.clearrow .browse{grid-column:-2 / -1}',
          // Below 640px the pill grid is two across, and pinning Browse to the
          // last column there would put it under Transfer with a hole beside
          // it. Let it flow instead.
          '@media (max-width:' + window.hkCards.BP.phone + 'px){.clearrow .browse{grid-column:auto}}',
          // Transcribed from hk-area-select-card's `.floor` (cards/hk-home.js),
          // because the Vacuums page and this one use the same device: a plain
          // floor label over a grid of things you can tick. Two pages that look
          // the same should BE the same rule, not two near-copies.
          '.floor{font-size:15px;font-weight:600;letter-spacing:-0.2px;',
          '  color:' + window.hkCards.v('ink-2') + ';padding:0px 4px 8px 4px}'
        ].join('');
      }

      _onConfig() {
        this._sel = new Set();
        // Start on whatever this screen is showing (hkMusic), so opening the
        // page lights the speakers that are actually playing rather than an
        // empty grid.
        this._seeded = false;
        // Until the person touches the grid, it keeps following the focus: the
        // server's copy of it arrives a moment after the first paint, and music
        // started elsewhere can move it. After a tap, the grid is theirs.
        this._touched = false;
      }

      _res() {
        return (window.hkMusic && this.client)
          ? window.hkMusic.resolve(this.client)
          : { player: null, context: null, reason: 'none', name: '' };
      }
      _presetFor(entity) {
        return this._presets().filter(function (x) { return x.entity === entity; })[0] || null;
      }

      // ALMOST never re-render from the states. This card shows a SELECTION, and a
      // selection does not change because a track did -- returning a constant
      // (not null, which means "always render") keeps it off the
      // 12-renders-a-second path the base class warns about, and selection
      // changes call _render() directly.
      //
      // TWO STATES ARE IN IT FOR Transfer. Whether Transfer is offered
      // depends on the selector and on whether the player it names is
      // playing, so a constant would leave a pill that lights and dims a
      // whole page visit late. Both are STATES, not attributes: they move
      // when playback starts or stops and when the speaker changes, a handful
      // of times an hour, while media_position moves constantly and is not
      // read. A re-render is free of side effects here -- it rebuilds from
      // the Set, and the one-time seed is guarded by _seeded.
      //
      // EVERY SPEAKER'S state IS AN INPUT. The dot says which rooms are
      // playing, so a room starting or stopping has to repaint this card.
      // Leaving them out makes a chip that is right on load and wrong until
      // the next reload.
      //
      // group_members is in the signature too, and not for completeness: the
      // whole point of `elsewhere` is that it flips when a room JOINS or LEAVES
      // this page's audio, which can happen with no state change at all.
      _sigOf() {
        var h = this.client;
        if (!h) return 'static';
        var r = this._res();
        var src = this._source();
        var st = src && h.states[src];
        var rooms = this._speakers().map(function (x) {
          var s2 = h.states[x.entity];
          if (!s2) return '-';
          var a = s2.attributes || {};
          // The TITLE is in here because the context row prints it: a group
          // moving to the next track changes what this card has to draw, with
          // no state change and no group change to notice it by.
          return s2.state + ':' + ((a.group_members || []).length) + ':' +
            (s2.state === 'playing' || s2.state === 'paused' ? (a.media_title || '') : '');
        }).join(',');
        // Each context's artwork and artist (drawn in the context row) are
        // inputs too; they do not move a room's state.
        var ctx = this._contexts().map(function (c) {
          return (c.image || '') + '~' + (c.artist || '');
        }).join(',');
        return r.player + ':' + r.reason + '|' + (src || '-') + '|' +
               (st ? st.state : '-') + '|' + rooms + '|' + ctx +
               (musicMissing() ? '|no-music' : '');
      }

      // THE HOME COMES FROM THE INTEGRATION: rooms, presets, floors and
      // playlists are configured in the UI and handed to every screen by
      // hkMusic. Nothing about them is in this card's YAML.
      _speakers() {
        return window.hkMusic ? window.hkMusic.rooms().map(function (s) {
          return { name: s.name, entity: s.entity }; }) : [];
      }
      _presets() {
        return window.hkMusic ? window.hkMusic.presets().map(function (s) {
          return { name: s.name, entity: s.entity, entities: s.members || [] }; }) : [];
      }
      _floors() { return window.hkMusic ? window.hkMusic.floors() : []; }
      _playlists() { return window.hkMusic ? window.hkMusic.playlists() : []; }

      // WHICH SPEAKERS ARE CARRYING *THIS PAGE'S* AUDIO.
      //
      // Not "what is selected" -- the pills already say that -- but what the
      // player at the top of the page is actually coming out of: that room
      // plus whatever is joined to it.
      _hereSet() {
        var out = {}, h = this.client, cfg = this._config;
        if (!h || !cfg) return out;
        var r = this._res();
        if (r.context) {
          r.context.members.forEach(function (e) { out[e] = 1; });
          return out;
        }
        if (!r.player) return out;
        var p = this._presetFor(r.player);
        if (p) {
          (p.entities || []).forEach(function (e) { out[e] = 1; });
          return out;
        }
        out[r.player] = 1;
        var st = h.states[r.player];
        ((st && st.attributes && st.attributes.group_members) || [])
          .forEach(function (e) { out[e] = 1; });
        return out;
      }

      // ---- CONTEXTS: every separate thing the home is playing -------------
      //
      // A "context" is not a new concept and is deliberately not stored
      // anywhere: it IS a Music Assistant group, read back out of
      // `group_members`. A home can run two of them at once -- the Office
      // playing one thing while the Kitchen and the Living Room play another
      // -- and what the page needs is the ability to name more than one. So
      // this derives them instead of inventing a second selector:
      //
      //   * every speaker that is playing or paused, grouped by its group;
      //   * a room on its own is a context of one;
      //   * silence is not a context.
      //
      // ORDER MATTERS AND IS NOT OURS. `group_members[0]` is the group's LEADER
      // (measured: with eight rooms joined, every member reports the same
      // room first), and the leader is what the selector has to point at for
      // the rest of the page -- the requests, the now-playing card -- to
      // follow. Members are filtered against our own speakers so a player we
      // offer no pill for cannot end up as a leader nobody can tap.
      _contexts() {
        // hkMusic derives them -- ONE derivation for every card on every
        // screen (cards/hk-base.js). It also recognises a sync group by the
        // group's own state rather than by a room list that happens to match.
        var h = this.client;
        if (!h || !this._config || !window.hkMusic) return [];
        return window.hkMusic.contexts(h);
      }

      // WHAT TO CALL A CONTEXT, and -- the load-bearing half -- which selector
      // option names it.
      //
      // A context whose rooms are exactly a preset's rooms is named as that
      // preset (hkMusic.label); its key is still its leader's, which every
      // room has -- which is why this feature needs no second selector entity
      // at all.
      _ctxLabel(ctx) {
        return { name: window.hkMusic ? window.hkMusic.label(ctx) : ctx.key,
                 key: ctx.key };
      }

      // POINT THIS SCREEN AT A CONTEXT. Setting the focus is what makes the
      // rest of the screen follow -- the now-playing card, the bar, Browse --
      // and only this screen: another tablet's page does not move with it.
      _useContext(ctx) {
        this._playOp = (this._playOp || 0) + 1;
        this._touched = true;
        this._sel = new Set(ctx.members);
        if (window.hkMusic) window.hkMusic.setFocus(ctx.key);
        this._render();
      }

      // THE THIRD STATE. A pill says whether it is SELECTED; without this it
      // would never say whether it is PLAYING, and "playing something other
      // than what this page is showing" would be invisible -- a playlist meant
      // for one room can come out of a stale group of eight, and the page
      // looks right the whole time.
      //
      //   ''          not playing
      //   'here'      playing THIS page's audio
      //   'elsewhere' playing, but not part of it
      //
      // Deliberately orthogonal to selection: a room can be selected and playing
      // something else, and that combination is the one worth seeing.
      _playFor(entity, here) {
        var h = this.client;
        var st = h && h.states[entity];
        if (!st || st.state !== 'playing') return '';
        return here[entity] ? 'here' : 'elsewhere';
      }

      // ---- SPEAKERS THAT ARE NOT THERE ------------------------------------
      //
      // Music Assistant restarting takes every player in the home with it.
      // Every room and every sync group reports `unavailable` at the same
      // moments, several times a week -- the integration reloading rather
      // than any one speaker dropping off.
      //
      // Unhandled, a pill for an unavailable speaker looks exactly like a
      // pill for an idle one, ticks exactly the same, and pressing a playlist
      // then produces silence with no error, no toast and nothing in the log
      // -- `media_player.play_media` at an unavailable entity is accepted and
      // does nothing. That is the one shape of failure this dashboard is
      // explicitly built to not have.
      //
      // So: an unavailable pill is dimmed and cannot be ticked, and one that
      // goes away WHILE ticked is dropped from the selection on the next
      // render. Dropping it is the honest half -- the alternative is a
      // selection that says "3 speakers" and plays to two, a silent partial
      // success.
      // A missing entity also cannot be trusted as a playback target. Once the
      // host hands a card its client, its states snapshot is complete; a typo, renamed
      // entity or removed speaker must be treated as unavailable. MA restarts
      // usually use the explicit `unavailable` state instead.
      _available(entity) {
        var st = this.client && this.client.states[entity];
        if (!st) return false;
        return st.state !== 'unavailable' && st.state !== 'unknown';
      }

      // A vanished member invalidates the whole requested set. Shrinking it
      // silently would turn an Everywhere preset into an ad-hoc subset, or a
      // two-room request into one room, while the user thinks they asked for
      // the original set. Requiring a fresh choice keeps the request explicit.
      _pruneGone() {
        var self = this;
        var dropped = Array.from(this._sel).some(function (e) {
          return !self._available(e);
        });
        if (dropped) {
          this._playOp = (this._playOp || 0) + 1;
          this._sel.clear();
          this._notice = 'A speaker became unavailable. Select speakers again.';
        }
        return dropped;
      }

      // Seed the Set from what this screen is showing, on first render with a
      // client -- and again whenever the focus moves, until the person touches
      // the grid (see _touched).
      //
      // FROM THE LIVE GROUP, not just from the leader: with four rooms joined
      // and playing, one lit pill would not answer "which speakers are on",
      // which is what this card exists to show. A preset lights its rooms.
      // Members this card has no pill for are left out, or the selection could
      // not be cleared by tapping.
      _seed() {
        if (this._seeded || !this.client || !this._config) return;
        this._seeded = true;
        var r = this._res();
        if (!r.player) return;
        var known = {};
        this._speakers().forEach(function (x) { known[x.entity] = 1; });
        if (r.context) {
          var members = r.context.members.filter(function (e) { return known[e]; });
          if (members.length) { this._sel = new Set(members); return; }
        }
        var p = this._presetFor(r.player);
        if (p) { this._sel = new Set(p.entities || []); return; }
        if (!known[r.player]) return;
        var st = this.client.states[r.player];
        var live = ((st && st.attributes && st.attributes.group_members) || [])
          .filter(function (e) { return known[e]; });
        this._sel = new Set(live.length > 1 ? live : [r.player]);
      }

      _same(list) {
        var a = this._sel, b = list || [];
        if (a.size !== b.length) return false;
        for (var i = 0; i < b.length; i++) if (!a.has(b[i])) return false;
        return true;
      }

      _toggle(id) {
        this._playOp = (this._playOp || 0) + 1;
        this._touched = true;
        this._notice = '';
        this._sel.has(id) ? this._sel.delete(id) : this._sel.add(id);
        this._render();
      }
      // A preset TOGGLES: tapping the active one clears, so it is a way out as
      // well as a way in. Tapping an inactive one replaces the selection rather
      // than adding to it -- "Downstairs" means those rooms, not those rooms plus
      // whatever was already ticked.
      _preset(p) {
        if (!p || !p.entity || !this._available(p.entity) ||
            !(p.entities || []).length ||
            !p.entities.every(this._available.bind(this))) return;
        this._playOp = (this._playOp || 0) + 1;
        this._touched = true;
        this._notice = '';
        if (this._same(p.entities)) this._sel = new Set();
        else this._sel = new Set(p.entities || []);
        this._render();
      }
      _clear() {
        this._playOp = (this._playOp || 0) + 1;
        this._touched = true;
        this._notice = ''; this._sel.clear(); this._render();
      }

      _requestValid(requested) {
        var self = this;
        var target = this._targets();
        return !!requested && requested.length > 0 &&
          requested.length === this._sel.size &&
          !!target && !!target.length && this._available(target[0]) &&
          requested.every(function (e) { return self._sel.has(e) && self._available(e); });
      }

      _requestChanged() {
        this._notice = 'Speakers changed. Select them again before playing.';
        this._render();
      }

      // The rules from the header. Returns the PLAYER for one room, or null
      // for two or more, which need the join path -- a preset's rooms too: its
      // id is no player (hk_core/music/config.py).
      _target() {
        if (this._sel.size === 1) {
          var only = Array.from(this._sel)[0];
          var s = this._speakers().filter(function (x) { return x.entity === only; })[0];
          if (s) return s.entity;
        }
        return null;
      }

      // THE DESTINATION, as a list with the leader first. One shape for every
      // rule, which is what lets hk_frontend.music_transfer have one path:
      //   one speaker -> [that speaker]
      //   2+ (a preset's rooms too) -> [leader, other, ...]
      _targets() {
        return this._sel.size ? Array.from(this._sel) : null;
      }

      // WHERE THE MUSIC IS NOW: the player this screen shows. The Set in this
      // card is local and nothing reaches HA until you press something, so the
      // focus resolves to the source and the Set to the destination.
      _source() {
        if (!this.client || !this._config) return null;
        return this._res().player || null;
      }

      // ADD, OR MOVE? The selection either contains the room the music is in or
      // it does not, and those are two different requests:
      //
      //   contains it  ->  ADD    keep playing there, extend into the rest
      //   does not     ->  MOVE   take it out of there and put it elsewhere
      //
      // Read off _targets(), the list the script receives, so both make the
      // same decision from the same list.
      _adding() {
        var t = this._targets(), src = this._source();
        return !!src && !!t && t.indexOf(src) >= 0;
      }

      // ONE PREDICATE, AND THE ENGINE HAS THE SAME ONE.
      //
      // Wherever two copies of a rule disagree there is a lit button that does
      // nothing. A card check weaker than the transfer's own precondition (say,
      // rejecting only the exact single-room no-op while the transfer refuses
      // when `leader == source`) lights the pill, accepts the press, and then
      // stops dead on the first condition -- silently, because a failed
      // top-level `condition:` ends a script with no error and nothing in the
      // log, and `script.turn_on` resolves the moment the script STARTS (see the
      // note on _call in hk-base.js). The same two rooms would give opposite
      // outcomes depending on which pill was tapped first.
      //
      // The engine chooses its own leader, so tap order is irrelevant and the
      // only things left to check are the ones below -- which are exactly the
      // conditions it still refuses on.
      _canTransfer() {
        var src = this._source(), t = this._targets();
        if (!src || !t || !t.length) return false;
        var st = this.client && this.client.states[src];
        if (!st || (st.state !== 'playing' && st.state !== 'paused')) return false;
        // "Add the room it is already in, and nothing else" has no work in it.
        if (t.length === 1 && t[0] === src) return false;
        // Nor has "make the group exactly what it already is" -- the same
        // short-circuit the integration makes for a group that already exists.
        var gm = (window.hkMusic && window.hkMusic.fold ? window.hkMusic.fold((st.attributes || {}).group_members || [])
                  : ((st.attributes || {}).group_members || []).slice()).sort();
        if (gm.length && gm.length === t.length) {
          var want = t.slice().sort();
          var same = true;
          for (var i = 0; i < gm.length; i++) if (gm[i] !== want[i]) same = false;
          if (same) return false;
        }
        return true;
      }

      // Waits for the answer like every other request: the script reports the
      // leader the music ended up on, and this screen follows it there.
      _transfer() {
        if (!this._canTransfer()) return;
        var op = this._playOp = (this._playOp || 0) + 1;
        var src = this._source(), t = this._targets();
        var guess = t.indexOf(src) >= 0 ? src : t[0];
        // The SELECTION, not the resolved targets: the integration decides
        // whether it is one room or a join.
        this._request('transfer', { rooms: Array.from(this._sel), source: src }, guess, op);
      }

      // THE ROOMS THAT WILL STILL BE PLAYING SOMETHING ELSE AFTERWARDS.
      //
      // This is the whole trigger for the prompt below, and the test is `some`,
      // not `every` -- a context counts if ANY of its rooms is being left
      // behind. That distinction is easy to miss:
      //
      //     Everywhere playing, select the Office, press a playlist
      //
      // Under `every` that context would be excluded, because the Office is one
      // of its rooms, so the press would be treated as a pure takeover and ask
      // nothing -- while every other room carried on playing the old thing. The
      // question is not "is this context yours or mine", it is "will a room
      // still be playing something you did not ask for", and half a context
      // answers yes.
      //
      // A context entirely inside the selection is still silent: that is a
      // replacement, and asking whether to stop what you are replacing is not a
      // question.
      _otherContexts() {
        var sel = this._sel;
        return this._contexts().filter(function (cx) {
          return cx.members.some(function (e) { return !sel.has(e); });
        });
      }

      // "ALSO STOP THE OTHER ROOMS?"
      //
      // A user may want to start another player, or to start music somewhere
      // else and stop what is playing now -- and guessing wrong starts speaker
      // groups nobody meant to leave running.
      //
      // Nothing in the selection tells the two apart -- "play in the Office" is
      // the same gesture whether or not you also want the Kitchen to stop.
      // Always stopping everything is right by accident for the common case and
      // wrong for the one the context row exists to serve. So it asks, ONCE, at
      // the moment of the press.
      //
      // ONLY WHEN IT IS A REAL QUESTION. No prompt when nothing else is
      // playing, and none when the only thing playing is what you selected --
      // that is a replacement, not a choice. It fires exactly when starting
      // this music would leave a room playing something else.
      //
      // BOTH BUTTONS ACT, and that is why the shared sheet grew a second
      // choice: the frequent answer here is "leave them", and a sheet where the
      // frequent answer is spelled "Cancel" teaches people to dismiss it.
      _askThenPlay(pl, go, requested, expectedOp) {
        var others = this._otherContexts();
        if (!others.length ||
            !window.hkCards || !window.hkCards.confirmSheet) { go(); return; }
        var self = this;
        // ONLY THE ROOMS BEING LEFT BEHIND. A context can be half-taken -- two
        // rooms playing together and you selected one of them -- and stopping
        // the half you are about to play to would silence the music a moment
        // after starting it.
        var sel = this._sel;
        var rooms = [];
        others.forEach(function (cx) {
          cx.members.forEach(function (e) { if (!sel.has(e)) rooms.push(e); });
        });
        // Name what will stop, rather than making them remember. One context
        // gets its track too; several get counted, because five lines of detail
        // on a wall tablet is a paragraph nobody reads.
        var detail;
        if (others.length === 1) {
          var l = this._ctxLabel(others[0]);
          detail = l.name + (others[0].title ? ' \u00b7 ' + others[0].title : '');
        } else {
          detail = others.map(function (cx) { return self._ctxLabel(cx).name; })
                         .join(', ');
        }
        window.hkCards.confirmSheet(
          'Also stop the other rooms?', function () {
            if (self._playOp !== expectedOp) return;
            if (!self._requestValid(requested)) { self._requestChanged(); return; }
            // A direct script call waits for Stop to finish. script.turn_on
            // only confirms that it started, allowing a late stop to silence
            // the new music after go() has begun.
            self._call('hk_frontend', 'music_stop', { rooms: rooms }).then(function (ok) {
              if (self._playOp !== expectedOp) return;
              if (ok && self._requestValid(requested)) go();
              else self._requestChanged();
            });
          },
          { detail: detail, yes: 'Stop Playing', no: 'Leave Playing', onNo: go });
      }

      // A PILL WITH `options` PLAYS NOTHING ITSELF -- it asks which one.
      //
      // For example a Decades pill: six playlists behind one tile instead of
      // six more tiles in a row that already holds five.
      //
      // THE CHOICE COMES FIRST, BEFORE EVERYTHING ELSE. The picked option is
      // then an ordinary playlist press: same _askThenPlay, so "also stop the
      // other rooms?" still fires, and same _playNow, so all three speaker
      // rules still apply. Putting the chooser anywhere later would mean
      // asking two questions in a row, or asking about rooms for music the
      // person has not chosen yet.
      //
      // The synthetic pl keeps the PARENT's name so the pill you pressed is the
      // one that lights (see _hkLit in _render) -- not one of six that has no
      // tile.
      _play(pl) {
        if (!this._sel.size || !this.client) return;
        this._playOp = (this._playOp || 0) + 1;
        var expectedOp = this._playOp;
        var self0 = this;
        if (pl.options && pl.options.length &&
            window.hkCards && window.hkCards.chooseSheet) {
          window.hkCards.chooseSheet(pl.name, pl.options.map(function (o) {
            return { name: o.name, key: o.key, icon: pl.icon };
          }), function (opt) {
            self0._play({ name: pl.name, key: opt.key, icon: pl.icon });
          });
          return;
        }
        // Everything below is what a press does; it is the callback, so the
        // question can come first.
        var requested = Array.from(this._sel);
        this._askThenPlay(pl, function () {
          if (self0._playOp === expectedOp) self0._playNow(pl, requested);
        }, requested, expectedOp);
      }

      _playNow(pl, requested) {
        if (!this.client) return;
        if (!this._requestValid(requested || Array.from(this._sel))) {
          this._requestChanged(); return;
        }
        var tgt = this._target();
        var op = this._playOp = (this._playOp || 0) + 1;
        var targets = this._targets();
        this._lastPlaylist = pl;
        // ONE CALL. Which rule this selection is -- one room, or a join (a
        // preset's rooms too) -- and everything each needs
        // (releasing what is in the way, joining, the home volume) is the
        // integration's business (music.py), where it is tested and where
        // each room is locked while it is being changed. This card only says
        // WHICH rooms and WHAT to play. The hold target is its best guess at
        // the leader; the answer replaces it.
        this._request('play', { rooms: Array.from(this._sel), playlist: pl.key },
                      tgt || (targets && targets[0]), op);
      }

      // ONE REQUEST, ONE ANSWER.
      //
      // The action is CALLED, not fired and forgotten, so this waits for it to
      // finish and reads what it returns -- `{ok, leader}`. Until then the
      // screen HOLDS its focus on the target, so the page shows the rooms you
      // asked for while the playlist loads (up to ~12s) instead of whatever
      // else happens to be playing.
      //
      // THE LEADER THE SCRIPT REPORTS WINS. It is not always the target this
      // card guessed: the integration adopts an existing group's real
      // leader, and a transfer that adds rooms keeps the one already playing.
      //
      // A FAILURE RELEASES THE HOLD -- a silent room must not stay pinned on
      // screen -- and says so here. The engine also publishes its own
      // notification with the details, which _notes shows; this line is only
      // the prompt that the press did not land.
      _request(service, data, target, op) {
        var M = window.hkMusic, self = this;
        if (M && target) M.setFocus(target, { hold: true });
        this._notice = '';
        this._busy = service === 'play' && this._lastPlaylist ? this._lastPlaylist.name : null;
        // The op that LIT the pill is the one that puts it out. Every selection
        // change bumps _playOp, so comparing against that would leave a pill lit
        // for ever after a room was tapped mid-request.
        this._busyOp = op;
        this._paintBusy();
        // `service` is the request's own name (play, transfer, stop); the
        // action is Music's, in the integration's domain.
        return this._callResp('hk_frontend', 'music_' + service, data).then(function (res) {
          if (self._busy && op === self._busyOp) { self._busy = null; self._paintBusy(); }
          // THREE ANSWERS. The call itself can be rejected (a dropped socket);
          // the engine can refuse, by ANSWERING `{ok: false, message}`; or it
          // can succeed WITH a message -- a Move or a preset where some rooms
          // did not join. That one is shown too: the music is playing, and
          // the person who pressed is told which rooms are not.
          var r = (res && res.response) || {};
          var failed = !res.ok || r.ok === false;
          if (!failed) {
            var lead = r.leader;
            if (M && lead && M.known(lead) && lead !== target) M.setFocus(lead, { hold: true });
            if (r.message && !r.superseded && op === self._playOp) {
              self._notice = 'Playing, but ' + String(r.message).replace(/\.$/, '') + '.';
              self._render();
            }
          } else {
            if (M && target) M.release(target);
            if (op === self._playOp) {
              var why = r.message || res.error || '';
              self._notice = 'That did not work' +
                (why ? ': ' + String(why).replace(/\.$/, '') : '') + '.';
              self._render();
            }
          }
          return res;
        });
      }

      // THE PRESSED PILL LIGHTS WHILE ITS REQUEST IS IN FLIGHT: the only
      // honest "working on it" is this screen's own request.
      _paintBusy() {
        var sc = this._scenes || {}, h = this.client;
        Object.keys(sc).forEach(function (k) {
          sc[k]._hkSig = null;
          if (h) feed(sc[k], h);
        });
      }

      _render() {
        if (!this._config) return;
        // NO MUSIC FEATURE: no rooms, presets or playlists to draw -- say so
        if (musicMissing()) { drawNoMusic(this); return; }
        this._seed();
        // BEFORE ANYTHING IS DRAWN OR COUNTED. A speaker that went away while
        // it was ticked must not survive into the heading, the play target or
        // _target()'s idea of which rule this selection is.
        this._pruneGone();
        var self = this;
        this._root.innerHTML = '';
        // Read ONCE per render, not once per pill: it walks the presets and a
        // group_members list, and a page can carry a dozen pills.
        var here = this._hereSet();

        // ---- the context row, when the home is doing more than one thing
        var ctxs = this._contexts();
        var marquee = [];
        if (ctxs.length > 1) {
          var row = document.createElement('div');
          row.className = 'ctx';
          if (window.hkCards.fitPanWatch) window.hkCards.fitPanWatch(row);
          ctxs.forEach(function (cx) {
            var info = self._ctxLabel(cx);
            var el = document.createElement('div');
            el.className = 'cx';
            button(el, function () { self._useContext(cx); });
            // Current = every room of it is carrying this page's audio. Derived
            // from the same `here` set the pills use, so the card and the pills
            // can never disagree about which context the page is on.
            var isNow = cx.members.every(function (e) { return here[e]; });
            el.setAttribute('aria-pressed', isNow ? 'true' : 'false');
            var sw = document.createElement('div');
            sw.className = 'sw';
            if (cx.image) {
              // _artImage, not a bare <img>. These are entity_picture_local
              // paths so they come from Home Assistant itself, but the rule is
              // the same one the library needs: an image that never answers
              // fires no `error`, and a context card would keep a permanently
              // empty cover.
              self._artImage(cx.image, sw, '<hk-icon icon="mdi:music"></hk-icon>');
            } else {
              sw.innerHTML = '<hk-icon icon="mdi:music"></hk-icon>';
            }
            var txt = document.createElement('div');
            var nm = document.createElement('div');
            nm.className = 'nm'; nm.textContent = info.name;
            var tr = document.createElement('div');
            tr.className = 'tr';
            // What it is playing, which is the question the amber glyph could
            // raise but not answer.
            tr.textContent = cx.title
              ? (cx.artist ? cx.title + ' \u00b7 ' + cx.artist : cx.title)
              : (cx.playing ? 'Playing' : 'Paused');
            txt.appendChild(nm); txt.appendChild(tr);
            el.appendChild(sw); el.appendChild(txt);
            // Decide AFTER layout which of these two lines actually overflows.
            // Measured per element rather than guessed from character counts:
            // "Living Room" fits and "Walk This Way - Run-DMC" does not, and
            // no rule about length would say that.
            marquee.push(nm); marquee.push(tr);
            el.setAttribute('data-hk-name', info.name);
            row.appendChild(el);
          });
          this._root.appendChild(row);
        }

        // ---- group shortcuts
        var ps = this._presets();
        if (ps.length) {
          var pg = document.createElement('div');
          pg.className = 'presets';
          ps.forEach(function (p) {
            // A preset's dot is ALL-OR-NOTHING, the same rule its lit state
            // uses: "Downstairs is playing" is only true when all its rooms
            // are. Four of five is exactly the state that must NOT read as
            // Downstairs playing.
            // `elsewhere` MEANS ONE OF ITS ROOMS IS PLAYING SOMETHING THAT IS
            // NOT THIS PAGE'S AUDIO -- not merely "not all of them are playing
            // it". Otherwise, with two rooms playing this page's music,
            // Everywhere would light amber, saying "playing something else"
            // about rooms that are playing exactly what is on screen.
            // Partly-here is not a warning, it is just partly here.
            var list = p.entities || [];
            var pPlay = list.some(function (e) {
              return self._playFor(e, here) === 'elsewhere';
            }) ? 'elsewhere'
               : (list.length && list.every(function (e) {
                   return self._playFor(e, here) === 'here';
                 }) ? 'here' : '');
            var pe = self._pill(p.name, self._same(p.entities), 'preset',
              function () { self._preset(p); }, pPlay);
            // A preset is a shortcut to its rooms; with none of them there it
            // is a shortcut to nothing.
            if (!list.length || !list.every(function (e) { return self._available(e); })) {
              pe.style.opacity = '0.35';
              pe.style.pointerEvents = 'none';
              pe.setAttribute('tabindex', '-1');
              pe.setAttribute('aria-disabled', 'true');
            }
            pg.appendChild(pe);
          });
          this._root.appendChild(pg);
        }

        // ---- the speakers, optionally under floor labels.
        //
        // THE LABELS ARE INERT, AND THAT IS A DECISION: keep the preset pills,
        // and make the floor headings just labels.
        //
        // The temptation is a tappable "Main floor" that ticks its speakers,
        // because a floor is often EXACTLY a preset's rooms. But a preset is not
        // a selection: `Downstairs` resolves to media_player.downstairs and
        // `Everywhere` to media_player.everywhere, both REAL MA SYNC GROUPS, and a
        // header that merely ticked pills would silently downgrade to ad-hoc
        // joining, which does not scale. A label cannot cause that regression; a
        // button could.
        //
        // Floors reference speakers BY ENTITY rather than redeclaring them, so
        // `speakers:` stays the one source of truth for names and options --
        // and anything not named by a floor still renders, in a trailing
        // unlabelled grid, so a speaker added to `speakers:` and forgotten here
        // cannot silently vanish from the page.
        var all = this._speakers();
        var floors = this._floors();
        var pill = function (sp) {
          var p = self._pill(sp.name, self._sel.has(sp.entity), '',
            function () { self._toggle(sp.entity); },
            self._playFor(sp.entity, here));
          // The same treatment Clear and Transfer get when they would be a
          // no-op, for the same reason: a control that cannot do anything must
          // not look like it can.
          if (!self._available(sp.entity)) {
            p.style.opacity = '0.35';
            p.style.pointerEvents = 'none';
            p.setAttribute('tabindex', '-1');
            p.setAttribute('aria-disabled', 'true');
            p.setAttribute('aria-label', sp.name + ', unavailable');
          }
          return p;
        };
        var grid = function (list) {
          var g = document.createElement('div');
          g.className = 'grid';
          list.forEach(function (sp) { g.appendChild(pill(sp)); });
          return g;
        };
        if (floors.length) {
          var placed = {};
          floors.forEach(function (f) {
            var ids = f.entities || [];
            var list = [];
            ids.forEach(function (id) {
              for (var i = 0; i < all.length; i++) {
                if (all[i].entity === id) { list.push(all[i]); placed[id] = 1; return; }
              }
            });
            if (!list.length) return;
            if (f.name) {
              var lab = document.createElement('div');
              lab.className = 'floor';
              lab.textContent = f.name;
              self._root.appendChild(lab);
            }
            self._root.appendChild(grid(list));
          });
          var rest = all.filter(function (sp) { return !placed[sp.entity]; });
          if (rest.length) this._root.appendChild(grid(rest));
        } else {
          this._root.appendChild(grid(all));
        }

        // ---- Clear, DIRECTLY UNDER THE SPEAKERS IT CLEARS.
        //
        // Not in the tile row below the rule, beside the playlists, where it
        // would read as one more thing to play -- that rule separates controls
        // that only change the SELECTION from actions that play music, and Clear
        // is the first kind. Not in the group row above either: it is not a
        // group, and sitting beside Everywhere and Downstairs would imply it
        // selects something.
        //
        // What it acts on is the speaker grid, so it goes immediately under the
        // speaker grid, reading as the last line of that block. It never lights
        // (the pressed argument is a literal false) and it dims at zero, because
        // clearing nothing does nothing.
        var clear = this._pill('Clear', false, 'clear',
          function () { self._clear(); });
        if (!this._sel.size) {
          clear.style.opacity = '0.35';
          clear.style.pointerEvents = 'none';
          clear.setAttribute('tabindex', '-1');
          clear.setAttribute('aria-disabled', 'true');
        }
        // A RULE ABOVE IT, between the rooms and the Clear / Transfer buttons.
        // Clear and Transfer act ON the speaker grid, so they belong under it --
        // but with floor labels above them they read as one more floor group
        // whose heading went missing. The rule says "these are actions on what
        // is above", which is the same job the existing rule does between these
        // and the playlists.
        this._root.appendChild(
          (function () { var d = document.createElement('div');
                         d.className = 'rule'; return d; })());
        var cr = document.createElement('div');
        cr.className = 'clearrow';
        cr.appendChild(clear);

        // ---- Transfer, beside Clear, for the same reason Clear is here: it
        // acts on the speaker grid above it. Both are things you do to the
        // SELECTION, above the rule that separates those from playing music.
        //
        // It is not a playlist and must not read as one. Pressing it starts
        // nothing new -- it moves what is already playing, with its queue and
        // its position, onto the rooms now ticked.
        //
        // Dim unless it would do something: you can see from the lit pills what
        // is playing and what you have picked, so a Transfer that is a no-op is
        // just a button that lies. See _canTransfer.
        // THE LABEL SAYS WHICH OF THE TWO IT IS ABOUT TO DO.
        //
        // "Transfer" alone admits to only one of the button's two meanings, and
        // the honest fix is not a better word but a second one.
        //
        // A DYNAMIC DESTINATION ("Move to Downstairs") does not work: the ad-hoc
        // case fits ("Move to 3 rooms") and presets fit ("Move to Downstairs",
        // 18 chars against the ~19 this 192px pill holds), but "Move to Primary
        // Bathroom" is 24 and does not. A label that is specific when the room
        // name is short and generic when it is long teaches you nothing -- you
        // have to read it every time. The room name belongs in the heading
        // below, which has no width limit.
        //
        // This is dynamic on the thing that actually changes what happens, and
        // both strings are short enough to never truncate.
        var xf = this._pill(this._adding() ? 'Add Rooms' : 'Move Music',
          false, 'clear',
          function () { self._transfer(); });
        if (!this._canTransfer()) {
          xf.style.opacity = '0.35';
          xf.style.pointerEvents = 'none';
          xf.setAttribute('tabindex', '-1');
          xf.setAttribute('aria-disabled', 'true');
        }
        cr.appendChild(xf);

        // ---- Stop All, beside Transfer.
        //
        // IT EXISTS BECAUSE NOTHING IMPLICIT DOES IT. Starting music in a room
        // does not pause every other room, because a home showing a row of
        // contexts is meant to run several at once -- so "make the home quiet"
        // needs a button of its own, once, on purpose.
        //
        // Dim unless something is playing, the same rule Transfer follows: a
        // button that cannot do anything should not look like it can.
        var anyPlaying = this._contexts().length > 0;
        var sa = this._pill('Stop All', false, 'clear', function () {
          self._playOp = (self._playOp || 0) + 1;
          // Through _request like every other press, so a refused stop says so.
          self._request('stop', {}, null, self._playOp);
        });
        if (!anyPlaying) {
          sa.style.opacity = '0.35';
          sa.style.pointerEvents = 'none';
          sa.setAttribute('tabindex', '-1');
          sa.setAttribute('aria-disabled', 'true');
        }
        cr.appendChild(sa);

        // ---- Browse Music, at the FAR RIGHT of this row: Clear, Transfer,
        // space, Browse Music.
        //
        // As a tile beside the playlists it would be the only one that does not
        // play anything -- and at the bottom of a page, easily never seen. This
        // row is already the row of things that are not "play this now", so it
        // belongs here; the gap separates a navigation from the two controls
        // that act on the selection.
        if (this._config.browse_url) {
          var br = this._pill('Browse Music', false, 'browse', function () {
            // AN IN-DASHBOARD NAVIGATION, not a page load. `location.assign`
            // reloads Home Assistant from scratch -- the HA logo pops up for
            // a split second while the whole frontend boots again.
            //
            // pushState + location-changed is what HA's own navigate() does.
            // Relative, because each tablet has its own dashboard root, so
            // the first path segment is whatever dashboard this is.
            var t = self._config.browse_url || './music-browse';
            if (t.slice(0, 2) === './') {
              t = '/' + String(location.pathname).split('/')[1] + '/' + t.slice(2);
            }
            window.hkShell.navigate(t);
          });
          cr.appendChild(br);
        }
        this._root.appendChild(cr);

        // NO RULE HERE, as long as there is a good enough gap for clear
        // separation between the two.
        //
        // There is one directly ABOVE Clear/Transfer, and two rules 40px
        // apart would fence those two pills in rather than group anything. The
        // separation is `.sub`'s top margin instead -- see its rule in CSS. The
        // rule that remains is the one that does the original job: selection
        // above it, actions on the home below.

        // ---- what to play. The heading counts the selection, the way the
        // vacuum card's Start tile does -- it is the only confirmation needed.
        var n = this._sel.size;
        var h = document.createElement('div');
        h.className = 'sub';
        h.textContent = n === 0 ? 'Select a speaker'
          : 'Play to ' + (this._presetName() ||
              (n === 1 ? '1 speaker' : n + ' speakers'));
        this._root.appendChild(h);
        if (this._notice) {
          var notice = document.createElement('div');
          notice.className = 'notice';
          notice.textContent = this._notice;
          this._root.appendChild(notice);
        }
        // What the engine reported -- see _subNotes. Tap to dismiss.
        this._noteList().forEach(function (nt) {
          var el = document.createElement('div');
          el.className = 'notice note';
          button(el, function () {
            self._call('persistent_notification', 'dismiss',
                       { notification_id: nt.notification_id });
          });
          el.setAttribute('data-hk-note', nt.notification_id);
          el.textContent = (nt.title ? nt.title + '. ' : '') + (nt.message || '') +
                           ' (Tap to dismiss.)';
          self._root.appendChild(el);
        });

        // THE PLAYLISTS ARE SCENE PILLS: real hk-scene-cards, so they carry the
        // scene pill's held tap look and progress-ring sweep (hk-tap.js) rather
        // than a flat tile that only flinches on press.
        //
        // The pill's own tap_action is `none`: what a playlist does depends on
        // THIS card's selection (_play), which a nested card cannot see, so the
        // click is handled here. The ring is hk-tap.js's and keys off the press,
        // not the action, so it still runs.
        //
        // BUILT ONCE AND RE-APPENDED. This card rebuilds its DOM on every
        // selection change; recreating the pills each time would throw away a
        // ring mid-sweep and re-run setConfig for nothing.
        var t = document.createElement('div'); t.className = 'tiles';
        this._playlists().forEach(function (pl) {
          var el = self._scene(pl.name, pl.icon, function () { self._play(pl); }, n === 0);
          var name = pl.name;
          el._hkLit = function () { return self._busy === name; };
          t.appendChild(el);
        });
        // NO BROWSE MUSIC TILE HERE: every other tile in this row plays
        // something, and Browse navigates. It lives in the Clear/Transfer row --
        // see there -- which is the row of things that are NOT "play this now".
        this._root.appendChild(t);

        // LAST, once everything is in the document: scrollWidth is 0 on an
        // element that has not been laid out, so measuring any earlier would
        // find nothing overflowing and nothing would ever travel.
        if (marquee.length) this._marquee(marquee);
      }

      // "Play to Downstairs" when the selection IS a preset.
      _presetName() {
        var ps = this._presets();
        for (var i = 0; i < ps.length; i++) if (this._same(ps[i].entities)) return ps[i].name;
        return '';
      }

      // WHICH LINES HAVE TO TRAVEL. Called at the end of a render, because
      // scrollWidth is zero until the element is laid out -- and only elements
      // that genuinely overflow are wrapped, so a row of fitting names stays
      // still. The duplicate copy is what makes the loop seamless; the duration
      // is proportional to the distance so long titles do not race.
      _marquee(nodes) {
        (nodes || []).forEach(function (el) {
          if (!el || !el.isConnected) return;
          var over = el.scrollWidth - el.clientWidth;
          if (over <= 1) return;
          var text = el.textContent;
          el.classList.add('go');
          el.textContent = '';
          var a = document.createElement('span');
          a.textContent = text;
          var b = document.createElement('span');
          b.textContent = text;
          el.appendChild(a); el.appendChild(b);
          // ~34px a second, which reads at arm's length without hurrying.
          var dur = Math.max(6, Math.round((el.scrollWidth / 2) / 34));
          el.style.setProperty('--hk-cx-dur', dur + 's');
        });
      }

      _pill(text, on, extra, onclick, play) {
        var b = document.createElement('div');
        b.className = 'pill' + (extra ? ' ' + extra : '') + (play ? ' ' + play : '');
        button(b, onclick);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        var s = document.createElement('span'); s.textContent = text;
        b.appendChild(s);
        // A GLYPH ON THE SAME LINE, not a repaint of the plate. The selected
        // plate is solid white and the idle one is glass; that contrast is the
        // whole selection signal, and painting a second meaning onto it would
        // cost more than it bought. The glyph is a second channel on the same
        // pill, so the two facts stay separable at arm's length.
        if (play) {
          // AN INLINE SVG, NOT <hk-icon>. Measured on a wall dashboard:
          // the icon element's own box centres perfectly (vOffset 0) while the
          // <ha-svg-icon> it renders inside sits 5px LOWER -- so the box is
          // right and the glyph is visibly low. A path of our own has no
          // internals to fight, and drops a custom element from a grid that
          // draws fourteen of these.
          var d = document.createElement('span');
          d.className = 'pi';
          d.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M8 5v14l11-7z"></path></svg>';
          // Said out loud too -- a screen reader gets no colour and no glyph.
          b.setAttribute('aria-label', text + ', playing' +
            (play === 'elsewhere' ? ' something else' : ''));
          b.appendChild(d);
        }
        return b;
      }

      _scene(name, icon, onclick, dim) {
        this._scenes = this._scenes || {};
        var key = name + '|' + icon;
        var el = this._scenes[key];
        if (!el) {
          // NO ENTITY: a playlist is not a thing in Home Assistant. The pill
          // lights from _hkLit (this card's own request), never from a state.
          el = create({ type: 'custom:hk-scene-card', entity: 'hk_music.playlist',
                        name: name, icon: icon, tap_action: { action: 'none' } });
          el.setAttribute('data-hk-name', name);    // findable in devtools and tests
          // CAPTURE PHASE, or no playlist press ever reaches Home Assistant.
          // A tap lands on the pill's own hk-plate, whose click handler
          // (HkBase._bind) calls stopPropagation -- so a bubbling listener
          // here NEVER hears a real tap. A test that calls el.click() on this
          // host skips the inner card and passes anyway.
          // A capturing listener on the host runs before the inner handler.
          el.addEventListener('click', function () { if (!el._hkDim) onclick(); }, true);
          this._scenes[key] = el;
          if (this.client) feed(el, this.client);
        }
        // Dim, do not remove: an empty selection has nothing to play TO, and the
        // row keeping its shape says the playlists are still there.
        el._hkDim = !!dim;
        el.style.opacity = dim ? '0.4' : '';
        el.style.pointerEvents = dim ? 'none' : '';
        el.setAttribute('aria-disabled', dim ? 'true' : 'false');
        return el;
      }

      // The picker never re-renders from the states (see _sigOf), but the pills inside
      // it are live cards and must still get every client to light and to draw.
      _receiveClient() {
        var c = this.client;
        if (window.hkMusic) window.hkMusic.attach(c);
        super._receiveClient();
        var sc = this._scenes || {};
        Object.keys(sc).forEach(function (k) { feed(sc[k], c); });
        this._subNotes();
      }

      // ---- WHAT THE MUSIC ENGINE SAID, SHOWN WHERE THE PRESS WAS MADE --------
      //
      // Every failure the music engine can report -- a group that did not form,
      // rooms that would not release, a queue that did not move, a playlist
      // that did not start, a Stop All that left music on -- is published as a
      // persistent_notification, with a sentence written for a person. And
      // NOBODY AT A WALL TABLET SEES ONE: those live behind the sidebar bell,
      // and kiosk_mode hides the sidebar on a tablet dashboard. The press is
      // accepted, the room stays silent, and the explanation sits in a drawer
      // nobody can open.
      //
      // So this card listens for exactly those ids and prints them in the
      // notice line under the heading. The ENGINE still owns the outcome -- it
      // creates the notification on failure and dismisses it on the next
      // success -- and this is only the display. Tapping one dismisses it, so
      // the tablet is never left holding a message it cannot clear.
      //
      // A websocket SUBSCRIPTION rather than a state read: persistent
      // notifications have not been entities since 2023.6, so the client's states
      // cannot see them. The subscription is tied to connection, both edges,
      // like the library's back listener, and home-assistant-js-websocket
      // re-subscribes it by itself after a reconnect.
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        this._subNotes();
        // THE FOCUS MOVES WITHOUT A HASS PUSH (the saved focus arriving from
        // the server, a context tapped, a request landing). Repaint -- and,
        // while nobody has touched the grid, re-seed it from the new focus.
        var self = this;
        if (!this._musicOff && window.hkMusic) {
          this._musicOff = window.hkMusic.onChange(function () {
            if (!self._touched) self._seeded = false;
            // A MESSAGE ABOUT AN EARLIER PRESS IS STALE once the screen has
            // moved on -- "That did not work" must not sit under the heading
            // while the next request plays fine. A failure releases its hold
            // (which lands here) BEFORE it writes its own message, so this
            // never erases the one it is about.
            self._notice = '';
            if (self.client && self._config) self.redraw();
          });
        }
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._musicOff) { this._musicOff(); this._musicOff = null; }
        var s = this._noteSub;
        this._noteSub = null;
        // an unsubscribe the server refuses (the socket reconnected; it has
        // already forgotten the subscription) is not an error of ours
        if (s) s.then(function (unsub) { var r = unsub && unsub(); if (r && r.catch) r.catch(function () {}); }, function () {});
      }
      _subNotes() {
        if (this._noteSub || !this.isConnected) return;
        var conn = this.client && this.client.subscriptions;    // the client's port
        if (!conn || !conn.subscribeMessage) return;
        var self = this;
        this._noteSub = conn.subscribeMessage(function (ev) { self._onNotes(ev); },
          { type: 'persistent_notification/subscribe' });
        this._noteSub.catch(function (err) {
          console.error('hk-speaker-picker: cannot follow notifications', err);
          self._noteSub = null;
        });
      }
      _onNotes(ev) {
        if (!ev) return;
        if (ev.type === 'current' || !this._notes) this._notes = {};
        var mine = this._notes, list = ev.notifications || {};
        var before = JSON.stringify(mine);
        Object.keys(list).forEach(function (id) {
          if (MUSIC_NOTES.indexOf(id) < 0) return;
          if (ev.type === 'removed') delete mine[id];
          else mine[id] = list[id];
        });
        // Only the music notifications rebuild this card; every other
        // persistent notification is none of its business.
        if (JSON.stringify(mine) !== before) this._render();
      }
      // Newest first. At most a handful exist -- one id per kind of failure.
      _noteList() {
        var n = this._notes || {};
        return Object.keys(n).map(function (k) { return n[k]; })
          .sort(function (a, b) {
            return String(b.created_at || '').localeCompare(String(a.created_at || ''));
          });
      }

      getCardSize() { return 8; }
    }

    // THE NOTIFICATION IDS THE MUSIC FEATURE PUBLISHES (features/music/const.py).
    // Anything else in the drawer -- an integration's repair notice, a login
    // attempt -- is not this page's business and is not shown on it.
    var MUSIC_NOTES = ['music_play_failed', 'speaker_group_failed',
                       'music_preset_failed', 'music_transfer_failed',
                       'music_transfer_partial', 'music_stop_failed'];

    // what the shell and the later parts use of this one
    K.HkSpeakerPickerCard = HkSpeakerPickerCard;
  };
})();
