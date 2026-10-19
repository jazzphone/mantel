// hk-library.js -- browse and search Music Assistant, in our own chrome.
//
// hk-library-card (+ hk-library-editor), in place of Music Assistant's own
// web UI in an iframe.
//
// WHY NOT AN IFRAME: the group of speakers selected or playing on this screen
// has to be what the library plays to, and an iframe of MA cannot be told
// that. MA's selected player is `activePlayerId`, in-memory state in its
// Vue store, initialised undefined:
//
//   * NOT persisted    -- MA's localStorage on :8095 holds exactly one key,
//                         `mass_server_address`.
//   * NOT a preference -- MA's server-side user preferences carry `language`
//                         and `theme`, nothing else.
//   * NOT in the URL   -- MA reads only code, remote_id, join, onboard and
//                         remote from the query string.
//   * NOT scriptable   -- :8095 is a different origin from :8123, so the
//                         parent frame cannot reach into it.
//   * NOT in its own embed protocol -- MA does talk to a host frame
//                         (`home-assistant/subscribe-properties`, `navigate`,
//                         `toggle-menu`, and inbound `properties`), but that
//                         vocabulary carries a ROUTE, never a player.
//
// So an iframe can never be told where to play, and a tablet's copy of MA
// remembers whatever was last picked on it -- possibly days earlier.
//
// EVERY CALL HERE NAMES THE ENTITY, which is what makes the mismatch
// impossible rather than merely unlikely. There is no "active player" in this
// design to disagree with the page.
//
// ONE CONTRACT, AND A STABLE ONE. Browse, search and play are all core Home
// Assistant, not Music Assistant internals:
//
//     media_player/browse_media    the hierarchy, per entity
//     media_player/search_media    search, same shapes
//     media_player.play_media      play, targeted
//
// `music_assistant` is a CORE integration, so those are governed by Home
// Assistant's deprecation policy. MA's web app internals are not an API at
// all and have broken before: MA 2.10 put a login wall on that UI.
//
// WHAT CAN STILL DRIFT is the response SHAPE -- the keys read below
// (`children`, `title`, `media_content_id`, `media_content_type`,
// `can_play`, `can_expand`, `thumbnail`, `media_class`). Those are the keys
// to check after an upgrade that leaves this page blank.
(function () {
  'use strict';

  // hk-base.js is a Lovelace resource fetched in PARALLEL with this one, so
  // wait for its ready EVENT (never poll: rAF does not fire in a hidden tab,
  // and a tablet behind the screensaver would define nothing).
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-library] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkLibrary) return;                  // double-load guard
  var HkBase = C.HkBase, M = C.M, register = C.register, button = C.button;

  // MUSIC NOT ADDED (2026-10-12): one line saying so, instead of "No speaker selected." with nowhere to play.
  // ONLY ON THE INTEGRATION'S OWN ANSWERS -- hkMusic.configured() is false
  // until hk_music/subscribe answers, and the settings feed's `added` is a
  // stored copy until it is live -- so a house WITH Music never sees it while
  // a page loads. (The same rule as hk-media.js's.)
  // (a place in Home Assistant's settings, as the host says it: hk-host-shell.js haPlace)
  function NO_MUSIC() { return 'Add the Music feature to play music here (' + window.hkShell.haPlace('Settings → Devices & services → HK Frontend → Add feature') + ').'; }
  function musicMissing() {
    var Mu = window.hkMusic, HS = window.hkSettings;
    if (!Mu || !Mu.configured || Mu.configured()) return false;
    return !!(HS && HS.live && !(C.added && C.added('music')));
  }
  function drawNoMusic(card) {
    card._root.innerHTML = '';
    var el = document.createElement('hk-plate');
    el.setAttribute('data-hk-role', 'no-music');
    el.style.cssText = 'display:block;padding:24px;box-sizing:border-box;border-radius:' + M.radius + ';' +
      M.glass + ';border:' + M.border + ';text-align:center;font-size:15px;line-height:1.4;' +
      'color:' + window.hkCards.v('ink-2') + '';
    el.textContent = NO_MUSIC();
    card._root.appendChild(el);
    card._built = false;
  }

  // How many tiles to draw before the "Show more" tile. A library can have
  // hundreds of artists and browse_media returns ALL of them in one response
  // -- there is no server-side paging in this contract -- so the paging is
  // ours. It is a RENDER limit, not a fetch limit: the data is already in
  // hand and the cost being avoided is hundreds of promoted layers on a wall
  // tablet, where the bill is area times promotion.
  var PAGE = 60;

  // Search is typed, so it debounces. 350ms is long enough that a five-letter
  // artist is one request instead of five, and short enough not to feel laggy.
  var DEBOUNCE = 350;

  // How many items a Discover shelf shows. get_library answers 25 and five
  // shelves of 25 is 125 pieces of artwork on a wall tablet, where the bill
  // is area times promotion. A shelf is a glance; twelve is more than anyone
  // scrolls before they either see something or go to the categories.
  var SHELF = 12;

  // How long a set of Discover shelves is good for, and how soon a failed
  // fetch is tried again. See _loadDiscover.
  var SHELF_AGE = 10 * 60 * 1000;
  var SHELF_RETRY = 60 * 1000;


  // WHICH LIBRARY TYPES CAN BE OPENED rather than played. get_library returns
  // `media_type`, not browse_media's can_expand, so the two vocabularies are
  // bridged here. A track or a radio station is a leaf: tapping it plays it.
  var EXPANDABLE = { album: 1, artist: 1, playlist: 1, podcast: 1, audiobook: 1 };

  // SEARCH SECTIONS. One flat list mixing an artist, five albums, four
  // tracks, five playlists, four radio stations and five podcasts is a wall
  // of artwork you have to read the subtitle of; results are put into
  // sections by category, with headings.
  // Fixed order, so the shape of a result page is the same every time and the
  // thing you were looking for is where it was last time.
  var KIND_LABEL = {
    artist: 'Artists', album: 'Albums', track: 'Tracks',
    playlist: 'Playlists', radio: 'Radio stations',
    podcast: 'Podcasts', audiobook: 'Audiobooks'
  };
  var KIND_ORDER = ['artist', 'album', 'track', 'playlist',
                    'radio', 'podcast', 'audiobook', 'other'];

  // A CATEGORY IS LISTED BY get_library, NOT BY browse_media, and the reason
  // is that browse_media silently truncates. Measured against one library:
  //
  //     albums     browse 498    get_library 1126
  //     tracks     browse 277    get_library 7883
  //     artists    browse 479    get_library  479
  //     playlists  browse  45    get_library   45
  //
  // No error, no `not_shown` count, no marker of any kind -- the Albums page
  // would simply end at 498 of 1126 and look complete. get_library takes
  // limit/offset and pages honestly.
  //
  // Only the CATEGORY level uses it. Everything below it (an album's tracks,
  // an artist's albums) is browse_media, because those are small and
  // browse_media is the contract that knows how to expand a node.
  var CATEGORY_TYPE = {
    artists: 'artist', albums: 'album', tracks: 'track',
    playlists: 'playlist', radio: 'radio', podcasts: 'podcast',
    audiobooks: 'audiobook'
  };
  // 500 a page: albums is three requests, tracks sixteen, and nobody scrolls
  // to the end of either. Pages are fetched only when "Show more" runs out of
  // what is already loaded.
  var CHUNK = 500;

  // ONE ICON PER ROOT CATEGORY. The root is navigation, not artwork -- drawn
  // as artwork it is seven big empty squares with a generic note in each,
  // which looks bad and plain. These are keyed on the
  // media_content_id browse_media gives the root children, which are stable
  // Music Assistant category ids, not titles -- a title is localised and
  // would break the map in any language but English.
  //
  // A MODULE CONSTANT, not a class field: a class field is an INSTANCE
  // property, so `Ctor.prototype.CATEGORY_ICON` reads undefined and every
  // tile falls back to the note.
  var CATEGORY_ICON = {
    artists: 'mdi:account-music', albums: 'mdi:album',
    tracks: 'mdi:music-note', playlists: 'mdi:playlist-music',
    radio: 'mdi:radio', podcasts: 'mdi:podcast',
    audiobooks: 'mdi:book-music'
  };

  class HkLibraryCard extends HkBase {
    static get CSS() {
      return [
        'hk-plate{background:none;box-shadow:none;border:none;padding:0}',

        // ---- the bar: a breadcrumb row, then search across the full width.
        //
        // SEARCH IS THE POINT OF THIS PAGE, so it gets a tall bar of its own above
        // the items. In a 300px track off to the right, level with the
        // breadcrumb, it reads as a filter on the row rather than the main way in.
        '.bar{display:grid;grid-template-columns:minmax(0,1fr);',
        '  gap:14px;margin:0 0 18px 0}',
        '.search{height:52px;border-radius:26px;padding:0 22px;width:100%;',
        // (Flat: the cards' own surface, --hk-field-bg, so the search and
        // Plays on match the pills under them; the look's key elsewhere)
        '  box-sizing:border-box;background:var(--hk-field-bg,' + window.hkCards.v('key-strong') + ');box-shadow:var(--hk-field-shadow,none);',
        '  border:' + M.border + ';color:' + window.hkCards.v('ink') + ';font-size:17px;',
        '  font-family:inherit;outline:none}',
        '.search::placeholder{color:' + window.hkCards.v('ink-3') + '}',

        // ---- ONE BACK CONTROL ON THE PAGE, not two.
        //
        // A Back pill drawn by this card lands directly under the page's back
        // chevron -- two identical-looking controls stacked, doing different
        // things, which makes for a strange experience.
        //
        // The trail replaces it. Ancestors are tappable text, the current
        // level is not, and a breadcrumb does not compete with a button for
        // "the way back" -- the page chevron stays the only one of those.
        '.crumb{display:flex;align-items:center;gap:8px;min-width:0;',
        '  font-size:19px;font-weight:600;letter-spacing:-0.3px;',
        '  color:' + window.hkCards.v('ink') + ';flex-wrap:wrap}',
        '.crumb .dim{color:' + window.hkCards.v('ink-3') + ';font-weight:500}',
        '.crumb .up{cursor:pointer;color:' + window.hkCards.v('ink-2') + ';font-weight:500}',
        '.crumb .up:hover{color:' + window.hkCards.v('ink') + '}',
        '.crumb .sep{color:' + window.hkCards.v('ink-3') + ';font-weight:400}',
        '.crumb .here{min-width:0;overflow:hidden;text-overflow:ellipsis;',
        '  white-space:nowrap}',

        // ---- the grid of things
        // minmax(168px, 1fr), NOT a fixed track. With `repeat(auto-fill,
        // 168px)` the row packs six 168px tiles into 1212px and leaves 134px
        // of ragged edge under a search bar that spans the whole width, so the
        // tiles do not line up with it.
        //
        // The flexible max is what makes the row flush: the count comes from
        // the 168px MINIMUM, then the tracks share the remainder between
        // them. (minmax(0,1fr) does NOT work -- a zero minimum gives nothing
        // to count from and collapses to a column per pixel. The minimum must
        // be definite.)
        //
        '.grid{display:grid;',
        '  grid-template-columns:repeat(auto-fill,minmax(var(--hk-lib-track,168px),1fr));',
        '  gap:14px}',
        // THE CATEGORY ROW IS auto-FIT, and only it. With Audiobooks hidden,
        // six tiles sit in a row auto-fill sized for seven, so they stop
        // 182px short of a search bar that spans the whole width -- the same
        // ragged edge the rule above exists to prevent, walked back in by
        // removing a tile. auto-fit COLLAPSES the empty seventh track and the
        // six share the full width: 199px each, flush.
        //
        // NOT ON THE LISTS AND RESULTS, because that generosity has no floor.
        // A search matching two things would stretch them to 626px each, and
        // the artwork is square, so that is a 626px-TALL tile. The root is a
        // fixed half-dozen and can be trusted to stretch; nothing else is.
        //
        // A 240px ceiling instead of 1fr is the wrong shape entirely: with a
        // DEFINITE max, the repeat count comes from that max rather than the
        // minimum, so 1266px gives five 240px tracks, a ragged edge AND
        // Podcasts orphaned onto a second row.
        '.grid.cats{',
        '  grid-template-columns:repeat(auto-fit,minmax(var(--hk-lib-track,168px),1fr))}',
        '.it{cursor:pointer;user-select:none;min-width:0}',
        '.it .art{width:100%;aspect-ratio:1;border-radius:12px;overflow:hidden;',
        // (the look's own shadow, as every card's: Flat's contact shadow,
        // Tinted's, the glass cards' -- the user, 2026-10-17)
        '  background:' + window.hkCards.v('key') + ';box-shadow:var(--hk-look-shadow,' + window.hkCards.v('glass-shadow-sm') + ');',
        '  display:flex;align-items:center;justify-content:center}',
        '.it .art img{width:100%;height:100%;object-fit:cover;display:block}',
        '.it .art hk-icon{--mdc-icon-size:34px;width:34px;height:34px;',
        '  color:var(--hk-glyph,rgba(255,255,255,0.45))}',
        // A round cover for artists, square for everything else -- the same
        // shorthand every music app uses, and it saves a subtitle.
        '.it.artist .art{border-radius:50%}',
        '.it .nm{margin-top:9px;font-size:14px;font-weight:600;letter-spacing:-0.2px;',
        '  color:' + window.hkCards.v('ink') + ';overflow:hidden;text-overflow:ellipsis;',
        '  white-space:nowrap}',
        '.it .sub{font-size:12px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';',
        '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        // THE ROOT CATEGORIES ARE NOT ARTWORK and should not pretend to be.
        // Drawn as artwork they are seven big empty squares with a generic
        // note in each and the word "directory" underneath.
        //
        // They get a real icon each and a shorter tile instead. No generated
        // art: these are navigation, and an icon is what navigation looks
        // like everywhere else on these dashboards.
        //
        // A CATEGORY IS THE SHARED 70px ACTION TILE, not a shape of its own.
        // A label under the well like an album caption costs the row
        // 104 + 6 + 18 = 128px to say one word; inside the pill it costs
        // nothing, and the scene pills already are that pill. `.tile` in
        // hk-base.js is exactly this shape (42px well, 23px glyph, 15px/600
        // label beside it), it is what the playlist buttons one page back
        // are made of, and it costs this file no material of its own.
        //
        // The only override is the WIDTH. `.tile` is pinned to the pill's width because
        // its usual home is a fixed-track grid; here the track is what sizes
        // it, and the six of them share the row.
        '.it.cat{width:100%;min-width:0;max-width:none}',
        '.it:active .art{transform:scale(0.97)}',
        '.it .art{transition:transform .12s ease}',

        // "Play all" and "Show more" are tiles in the same grid so the row
        // rhythm never breaks.
        '.it.act .art{background:' + window.hkCards.v('key-strong') + ';}',

        '.msg{font-size:15px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';',
        '  padding:22px 4px}',

        // ---- DISCOVER: horizontal shelves, below the categories.
        // The gap above the first one is what separates the two halves of the
        // page, since the categories carry no heading of their own.
        '.shelves{margin:26px 0 0 0}',
        // A search section. Same heading as a Discover shelf -- they are the
        // same idea, a labelled group of results -- but the body is the normal
        // wrapping grid, because a search answer is something you read all of.
        '.sec{margin:0 0 22px 0}',
        '.sec:last-child{margin-bottom:0}',

        // ---- TRACKS ARE A LIST, NOT A GRID, in every view with a track
        // listing. A grid is actively bad for them: every tile in an album
        // carries the SAME cover art at 199px square, so nineteen identical
        // squares push the nineteen things that actually differ -- the
        // titles -- to a 13px caption each, truncated. A grid is for browsing
        // artwork; a track list is for reading names.
        //
        // ONE PLATE, HAIRLINES INSIDE, not a plate per row. Sixty rounded
        // plates each with its own shadow is sixty promoted layers, and on
        // a wall tablet the bill is area x promotion. It is also the list
        // idiom the rest of these dashboards already use.
        // ---- the header over a track listing: cover, album, artist, count.
        // Said once and large, which is what pays for the rows below dropping
        // those same two columns.
        '.hd{display:grid;grid-template-columns:132px minmax(0,1fr);',
        '  column-gap:20px;align-items:center;margin:0 0 18px 2px}',
        '.hd .cover{width:132px;height:132px;border-radius:12px;overflow:hidden;',
        '  background:' + window.hkCards.v('key') + ';display:flex;',
        '  align-items:center;justify-content:center;',
        '  box-shadow:var(--hk-look-shadow,' + window.hkCards.v('glass-shadow-lg') + ')}',
        '.hd .cover img{width:100%;height:100%;object-fit:cover;display:block}',
        '.hd .cover hk-icon{--mdc-icon-size:44px;width:44px;height:44px;',
        '  color:var(--hk-glyph,rgba(255,255,255,0.7))}',
        '.hd .meta{min-width:0}',
        '.hd .h1{font-size:26px;font-weight:700;letter-spacing:-0.5px;',
        '  color:' + window.hkCards.v('ink') + ';overflow:hidden;',
        '  text-overflow:ellipsis;white-space:nowrap}',
        '.hd .h2{margin-top:3px;font-size:16px;font-weight:600;',
        '  letter-spacing:-0.2px;color:' + window.hkCards.v('ink-2') + ';',
        '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.hd .h3{margin-top:7px;font-size:13.5px;font-weight:500;',
        '  color:' + window.hkCards.v('ink-3') + '}',
        // "Loading songs…" breathes while Music Assistant fetches, so a wait
        // of half a minute still reads as working rather than stuck
        '.hd .h3.wait{animation:hk-lib-wait 1.6s ease-in-out infinite}',
        '@keyframes hk-lib-wait{0%,100%{opacity:1}50%{opacity:.5}}',
        '@media (prefers-reduced-motion:reduce){.hd .h3.wait{animation:none}}',

        '.list{' + M.glass + ';border:' + M.border + ';',
        '  border-radius:' + M.radius + ';overflow:hidden;',
        '  box-shadow:var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,0.10))}',
        '.rw{display:grid;grid-template-columns:44px minmax(0,1fr);',
        '  column-gap:14px;align-items:center;height:58px;padding:0 16px;',
        '  cursor:pointer;user-select:none}',
        // inset, not border-top: a border would add a pixel to the row and
        // make every row a different height from the first.
        '.rw + .rw{box-shadow:inset 0 1px 0 ' + window.hkCards.v('line') + '}',
        '.rw:active{background:' + window.hkCards.v('key') + '}',
        '.rw .thumb{width:44px;height:44px;border-radius:8px;overflow:hidden;',
        '  background:' + window.hkCards.v('key') + ';display:flex;',
        '  align-items:center;justify-content:center}',
        '.rw .thumb img{width:100%;height:100%;object-fit:cover;display:block}',
        '.rw .thumb hk-icon{--mdc-icon-size:22px;width:22px;height:22px;',
        '  color:var(--hk-glyph,rgba(255,255,255,0.8))}',
        // tabular-nums so 9 and 10 do not shuffle the titles sideways.
        '.rw .num{font-size:15px;font-weight:600;text-align:center;',
        '  font-variant-numeric:tabular-nums;color:' + window.hkCards.v('ink-3') + '}',
        '.rw .txt{min-width:0}',
        '.rw .t1{font-size:15px;font-weight:600;letter-spacing:-0.2px;',
        '  color:' + window.hkCards.v('ink') + ';overflow:hidden;',
        '  text-overflow:ellipsis;white-space:nowrap}',
        '.rw .t2{margin-top:1px;font-size:13px;font-weight:500;',
        '  color:' + window.hkCards.v('ink-2') + ';overflow:hidden;',
        '  text-overflow:ellipsis;white-space:nowrap}',
        '.shelf{margin:0 0 20px 0}',
        // THE MUSIC PAGE (`layout: music`): the card is the page's right
        // column -- the search stays, the rest scrolls under it (its ends
        // fading as every list's do: hk-base.js SCROLL EDGES)
        ':host([music]){display:block;height:100%}',
        // (HkBase's own wrapper between the host and the card is as tall as
        // the host too: left at auto, 100% below it meant nothing, and the
        // list grew to all it holds instead of scrolling)
        ':host([music]) > div{height:100%}',
        // ...but a phone's one column scrolls as a page: no box of its own
        // (`flow`, set by the Music page), the search scrolling away with it
        ':host([music][flow]),:host([music][flow]) > div,:host([music][flow]) hk-plate{height:auto}',
        ':host([music][flow]) [data-hk-role="body"]{overflow:visible;flex:none}',
        ':host([music]) hk-plate{height:100%;display:flex;flex-direction:column;position:relative}',
        // (the search first, level with the page's Playing On; the trail
        // under it only inside something -- at the first level Your
        // Playlists says where it plays)
        ':host([music]) .bar{flex:none;margin:0;padding:0 0 14px 0;display:flex;flex-direction:column-reverse;gap:12px}',
        ':host([music]) .search{height:50px;border-radius:25px}',
        ':host([music][atroot]) .crumb{display:none}',
        // (the trail and, at its end, where it plays: one row)
        ':host([music]) .crumb{align-items:center;min-height:34px}',
        ':host([music]) .crumb .route{margin-left:auto}',
        // THE SEARCH ROW: the field takes what the button leaves (the button
        // its own size, as tall as the field); the line under them
        '.srow{display:flex;align-items:center;gap:12px;min-width:0}',
        '.srow .search{flex:1 1 auto;min-width:0;width:auto}',
        '.srow .route{flex:none;height:50px;border-radius:25px;padding:0 16px 0 14px;font-size:15px;margin-left:0;max-width:60%}',
        '.srow .route hk-icon{--mdc-icon-size:20px;width:20px;height:20px}',
        '.route .full{display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;white-space:nowrap}',
        '.route .full b{overflow:hidden;text-overflow:ellipsis;min-width:0}',
        '.route .full > span{flex:none}',
        '.route > svg,.route > hk-icon,.route > .rx{flex:none}',
        // a phone: a little smaller, and never more than leaves the search its
        // word (the room names give way first)
        ':host([music][flow]) .srow .route{font-size:14px;padding:0 13px 0 12px;gap:6px;max-width:calc(100% - 118px)}',
        ':host([music][flow]) .srow .route .full{gap:6px}',
        ':host([music][flow]) .srow .route .full > span{font-size:12.5px}',
        ':host([music][flow]) .srow .route hk-icon{--mdc-icon-size:18px;width:18px;height:18px}',
        ':host([music][flow]) .srow .search{padding:0 18px}',
        // ...ON THE PLAYLISTS' COLUMNS (2026-10-13): the search and Plays on
        // each take a column of the two-up pills under them, the same 14 px
        // apart, so their edges line up at any phone's width (they were each
        // their own width). Searching, the field takes the row again (below).
        ':host([music][flow]) .srow:not(.open){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:14px}',
        ':host([music][flow]) .srow:not(.open) .route{max-width:none;min-width:0}',
        ':host([music][flow]) .srow:not(.open) .route .full{flex:1 1 auto}',
        '.route .num{display:none;min-width:22px;height:22px;border-radius:11px;background:' + window.hkCards.v('key-strong') + ';font-size:13px;font-weight:700;',
        '  align-items:center;justify-content:center;padding:0 6px;box-sizing:border-box}',
        '.route.set .num{background:rgba(29,20,38,0.12)}',
        // ...on a phone, searching: the glyph and the count, the field the rest
        ':host([music][flow]) .srow.open .route .full{display:none}',
        ':host([music][flow]) .srow.open .route .num{display:flex}',
        ':host([music][flow]) .srow.open .route{padding:0 14px 0 12px;gap:6px}',
        ':host([music][flow]) .srow.open .route > svg{display:none}',
        ':host([music]) .bar .nextnote{display:flex;align-items:center;gap:8px;margin:0 2px;font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
        ':host([music]) .bar .nextnote:empty{display:none}',
        ':host([music]) .bar .nextnote hk-icon{--mdc-icon-size:16px;width:16px;height:16px;flex:none;display:flex}',
        // (14 px of room each side for the tiles' shadows -- a scroller clips
        // them at its edge -- given back by the margin, so nothing moves)
        ':host([music]) [data-hk-role="body"]{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;',
        // (--hk-lib-foot: the Music page's tab bar room, hk-music.js -- the
        // last row scrolls clear of the bar it scrolls behind)
        '  -webkit-overflow-scrolling:touch;scrollbar-width:none;padding:0 14px calc(24px + var(--hk-lib-foot, 0px)) 14px;margin:0 -14px}',
        ':host([music]) [data-hk-role="body"]::-webkit-scrollbar{display:none}',
        // ...no more room than the page's own gutter: a phone's is 12 px, and
        // 14 ran the list 2 px past each side of the screen (the page could
        // be nudged sideways)
        '@media (max-width:' + window.hkCards.BP.phone + 'px){:host([music]) [data-hk-role="body"]{padding-left:12px;padding-right:12px;margin:0 -12px}}',
        // ...its Your Playlists (the page's rootExtra): the categories' tile
        '.yp{margin:0 0 22px 0}',
        // the heading, and on its right where they play: one pill, like a
        // speaker picker -- Plays on <rooms> >, a tap is Change
        // ONE GAP DOWN THE COLUMN: the search to Plays on, Plays on to the
        // pills (and the line between, when there is one) -- the pills' own 14
        '.yp .yph{display:flex;align-items:center;gap:12px;margin:0 0 14px 2px}',
        '.yp .yph h3{margin:0;flex:none}',
        '.route{margin-left:auto;min-width:0;display:flex;align-items:center;gap:8px;height:34px;padding:0 12px 0 10px;border-radius:17px;',
        '  background:var(--hk-field-bg,' + window.hkCards.v('key') + ');box-shadow:var(--hk-field-shadow,none);border:' + M.border + ';cursor:pointer;box-sizing:border-box;color:' + window.hkCards.v('ink') + '}',
        '.route:active{background:' + window.hkCards.v('key-strong') + '}',
        '.route hk-icon{--mdc-icon-size:18px;width:18px;height:18px;flex:none;display:flex}',
        '.route span{font-size:13px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';flex:none}',
        '.route b{font-size:14px;font-weight:600;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.route svg{width:12px;height:12px;flex:none;fill:none;stroke:var(--hk-glyph,rgba(255,255,255,0.6));stroke-width:3;stroke-linecap:round;stroke-linejoin:round}',
        // PICKED ROOMS FOR THE NEXT MUSIC: the pill white, its X back to what plays
        '.route.set{background:#fff;color:#1d1426;border-color:transparent}',
        '.route.set span{color:rgba(29,20,38,0.6)}',
        '.route .rx{width:22px;height:22px;border-radius:50%;background:rgba(29,20,38,0.12);display:flex;align-items:center;justify-content:center;margin-right:-5px;flex:none}',
        '.route .rx svg{width:10px;height:10px;stroke:#1d1426}',
        '.yp .yph{flex-wrap:wrap;row-gap:8px}',
        '.yp .nextnote{display:flex;align-items:center;gap:8px;margin:0 2px 14px;font-size:13px;color:' + window.hkCards.v('ink-2') + '}',
        '.yp .nextnote hk-icon{--mdc-icon-size:16px;width:16px;height:16px;flex:none;display:flex}',
        '.yp .it.cat.on{background:#fff;color:#1c1c1e}',
        '.yp .it.cat.on hk-icon,.yp .it.cat.on .txt{color:#1c1c1e}',
        '.yp .it.cat.busy{opacity:.55}',
        '.yp .opts{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:8px}',
        '.yp .opt{height:36px;padding:0 16px;border-radius:18px;display:flex;align-items:center;font-size:14px;font-weight:600;cursor:pointer;',
        '  color:' + window.hkCards.v('ink') + ';border:1.5px solid ' + window.hkCards.v('mark') + ';box-sizing:border-box}',
        '.libh{margin:4px 0 10px 2px;font-size:16px;font-weight:600;letter-spacing:-0.2px;color:' + window.hkCards.v('ink') + '}',
        '.shelf h3,.sec h3{margin:0 0 10px 2px;font-size:16px;font-weight:600;',
        '  letter-spacing:-0.2px;color:' + window.hkCards.v('ink') + '}',
        // A SCROLLER, not a wrapping grid: a shelf is a glance, and a row
        // that wrapped to three lines would push the categories off the page.
        // THE SCROLLER CLIPS ITS CHILDREN'S SHADOWS, and the padding below is
        // what buys them room, so the artwork's shadow is not cut off.
        //
        // A horizontal scroller cannot have `overflow-y:visible` -- CSS turns
        // `visible` into `auto` when the other axis is not visible, which
        // would add a vertical scrollbar to a one-row shelf. So `hidden` has
        // to stay, and the only way to stop it cutting the artwork's lift is
        // to leave the shadow somewhere to land INSIDE the box.
        //
        // The art carries `0 6px 18px`, so it paints roughly blur/2 = 9px
        // beyond each side and 6+9 = 15px below. Measured at 1335x856 with
        // a `padding:2px 2px 8px 2px`:
        //
        //     art top    2.0px from the row's top edge   (needs ~3)
        //     art left   2.0px from the row's left edge  (needs ~9)  CLIPPED
        //     art bottom 37.8px from the row's bottom    (fine, the caption
        //                                                 sits in that space)
        //
        // Hence the sides, which is where it shows. 12px is the 9 the shadow
        // needs plus a little, and the NEGATIVE MARGIN gives it back so
        // nothing moves: the row's border box grows outward while its content
        // box -- where the tiles actually sit -- stays where it was. There is
        // nothing to bleed into: measured, this card has no clipping ancestor
        // at all and sits in a 1211px column with 89px of page gutter to its
        // left and 33px to its right.
        //
        // Do NOT "simplify" this to plain padding. That would inset the first
        // tile by 12px and break the left edge this page shares with the
        // search bar and the category grid above it.
        '.shelf .row{display:grid;grid-auto-flow:column;',
        '  grid-auto-columns:var(--hk-lib-shelf,150px);gap:14px;',
        '  overflow-x:auto;overflow-y:hidden;',
        '  padding:8px 12px 14px 12px;margin:-8px -12px -6px -12px;',
        '  scrollbar-width:none;-webkit-overflow-scrolling:touch}',
        '.shelf .row::-webkit-scrollbar{display:none}',
        '.shelf .it .nm{font-size:13px}',
        '.shelf .it .sub{font-size:11px}',
        // PHONE. The bar is `max-content + 1fr + 300px`, which needs more than
        // a phone has: measured at 402, the crumb collapses to 0px and the
        // search box to 34px -- a search field you cannot read what you typed
        // in. Nothing overflows, so only a measurement shows it.
        //
        // The search drops to its own full-width row instead. Two rows of bar
        // cost 50px on the one page where the thing you came to do is type.
        '@media (max-width:' + window.hkCards.BP.phone + 'px){',
        '  .bar{row-gap:10px}',
        // TWO COLUMNS, SPELLED OUT. Feeding a flexible track into the
        // variable does NOT work: `repeat(auto-fill, minmax(0,1fr))` is not
        // "fill with flexible columns", it resolves to TWENTY-SIX columns of
        // 0.77px and the artwork vanishes. auto-fill needs a definite track
        // to count, so the phone replaces the whole template instead.
        // (Same family as the minmax(168px,192px) no-op in
        // css/hk-responsive.css.)
        '  .hd{grid-template-columns:96px minmax(0,1fr);column-gap:14px}',
        '  .hd .cover{width:96px;height:96px}',
        '  .hd .h1{font-size:21px}',
        '  .hd .h2{font-size:14px}',
        '  .grid,.grid.cats{grid-template-columns:repeat(2,minmax(0,1fr))}}'
      ].join('');
    }

    setConfig(config) {
      if (!config) throw new Error('hk-library-card needs a config');
      // STATE FIRST, super SECOND, and the order is load-bearing.
      // HkBase.setConfig RENDERS synchronously, so anything _render touches
      // has to exist before the super call -- otherwise the first paint runs
      // against undefined fields and Lovelace replaces the whole card with
      // "Configuration error: Cannot read properties of undefined (reading
      // 'length')", which says nothing about where it came from.
      this._stack = [];          // breadcrumb of {title, type, id}
      this._items = null;        // what is on screen
      this._shown = PAGE;
      this._mode = 'browse';
      this._query = '';
      this._err = null;
      this._loading = false;
      this._saved = null;        // the search a stack was opened FROM
      this._pageMore = false;    // the last category page came back full
      this._paged = null;        // {node, type} of the category being paged
      super.setConfig(config);
    }

    getCardSize() { return 10; }

    // The listener is on WINDOW, so it outlives this element unless it is
    // removed -- and a stale one would swallow the back press on whatever
    // page came next.
    //
    // ...BUT IT HAS TO COME BACK. Registered inside the `if (!this._built)`
    // block in _render, which runs exactly once, the FIRST disconnect would
    // remove the listener for good and nothing would ever re-add it: after
    // opening Artists or Albums, Back would leave for the Play Music page
    // instead of going up a level.
    //
    // Loading /music-browse directly hides this, because the card is
    // freshly built and connected. Navigate Play Music -> Browse Music the
    // way the Browse pill does and Home Assistant re-places the card, which
    // disconnects it:
    //
    //     open Albums        stack 1, crumb "Music > Albums . Office"
    //     dispatch hk-back   defaultPrevented FALSE  <- nobody listening
    //                        stack still 1, the page chevron navigates away
    //
    // So it is tied to connection, on both edges, and idempotent -- a double
    // connect cannot register it twice.
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      this._bindBack();
      // The focus can move with no state push (a context tapped on Play Music,
      // the saved focus arriving). Re-run the render gate when it does.
      var self = this;
      if (!this._musicOff && window.hkMusic) {
        this._musicOff = window.hkMusic.onChange(function () {
          self._hkSig = null;
          if (self.client && self._config) self.redraw();
        });
      }
      // Configure -> Browse Music saved: the first page follows at once --
      // its categories are filtered when they load, so the level is asked
      // again; the Discover rows are re-read by the next paint.
      if (!this._settingsOff && window.hkSettings && window.hkSettings.onChange) {
        var seen = JSON.stringify([this._hidden(), this._rows()]);
        this._settingsOff = window.hkSettings.onChange(function () {
          var now = JSON.stringify([self._hidden(), self._rows()]);
          if (now === seen) return;
          seen = now;
          if (!self._built) return;
          if (!self._stack.length && self._mode !== 'search') self._load(null);
          else self._paint();
        });
      }
      if (this._resumeLoad && this._built) {
        this._resumeLoad = false;
        if (this._mode === 'search' && this._query) this._search(this._query);
        else this._load(this._stack.length ? this._stack[this._stack.length - 1] : null);
      }
    }

    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      if (this._musicOff) { this._musicOff(); this._musicOff = null; }
      if (this._settingsOff) { this._settingsOff(); this._settingsOff = null; }
      if (this._onBack) window.removeEventListener('hk-back', this._onBack);
      clearTimeout(this._searchT);
      this._resumeLoad = !!this._loading;
      this._seq();
    }

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

    // EACH NEW CLIENT (HkBase calls this from Lovelace's entry and from a client set
    // directly): the music model follows its subscription port.
    _receiveClient() {
      if (window.hkMusic) window.hkMusic.attach(this.client);
      super._receiveClient();
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
      if (!this.client || !this.client.callWS) return Promise.reject(new Error('no client'));
      var self = this;
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
    _stale(token) { return token !== this._req; }

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
        });
        // `.children.length`, not `.firstChild`: both are real DOM, but only
        // the first one also reads in tests/dom.js, so the ordering here can
        // be asserted rather than eyeballed.
        return shelves.children.length ? shelves : null;
      }
    }

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

  }

  register('hk-library-card', HkLibraryCard, 'HK Music Library',
    'Browse and search Music Assistant, playing to the speaker this screen is showing.',
    C.editor && [
      { name: 'player', label: 'Speaker',
        helper: 'Always play here. Empty: the screen\'s music room.',
        selector: { entity: { filter: { domain: 'media_player' } } } },
      { name: 'fallback_player', selector: { entity: { filter: { domain: 'media_player' } } },
        helper: 'Used only when this screen has no speaker at all.' },
      // THE CATEGORY IDS browse_media gives Music Assistant's first page
      // (settings.py BROWSE_CATEGORIES, CATEGORY_ICON above), in MA's order
      { name: 'hide', label: 'Hide Categories',
        helper: 'Left off the first page. Not set here: the ones hidden in HK Settings → Features → Music.',
        selector: { select: { multiple: true, mode: 'list', options: [
          { value: 'artists', label: 'Artists' }, { value: 'albums', label: 'Albums' },
          { value: 'tracks', label: 'Tracks' }, { value: 'playlists', label: 'Playlists' },
          { value: 'radio', label: 'Radio' }, { value: 'podcasts', label: 'Podcasts' },
          { value: 'audiobooks', label: 'Audiobooks' }] } } },
      // Rows are QUERIES (title, media_type, order_by or favorite), not names
      // from a list, so they stay YAML
      { name: 'discover', label: 'Discover Rows',
        helper: 'The first page\'s rows, as a YAML list of title, media type and order. Not set here: the ones picked in HK Settings → Features → Music.',
        selector: { object: {} } }
    ],
    function () { return { music: true }; });

  window.hkLibrary = { version: '1.0.0' };
  });
})();
