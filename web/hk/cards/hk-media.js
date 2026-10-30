// hk-media.js -- the music cards: the player, the screensaver's now-playing line, the speaker picker
//
// hk-now-playing-card (THE player), hk-screensaver-now-card,
// hk-speaker-picker-card, and hk-browse-card (Music Assistant's own web player
// in a frame).
//
// Shared pieces -- HkBase, the editor helpers, register(), create(), the
// snapshot cache -- come from hk-base.js through window.hkCards.
(function () {
  'use strict';

  // hk-base.js is a Lovelace resource fetched in PARALLEL with this one, so
  // wait for its ready EVENT (never poll: rAF does not fire in a hidden tab,
  // and a tablet behind the screensaver would define nothing -- see
  // hk-base.js).
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-media] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkMedia) return;                  // double-load guard
  var HkBase = C.HkBase, M = C.M, register = C.register, create = C.create,
      SELECTED_BG = C.SELECTED_BG, SELECTED_TEXT = C.SELECTED_TEXT,
      esc = C.esc, button = C.button;

  // A NESTED CARD'S CLIENT, once the card can take it. hkCards.create configures a card
  // as soon as its element is defined and hands it nothing before; the host adapter's
  // bridge then decides what the child gets (in HA, an HA-drawn card needs the
  // frontend's object). A card that is not defined yet is skipped: the next push feeds it.
  // slice 9: hkCards.create's hkSetClient should take a client, and this goes.
  function feed(el, client) {
    if (el && client && typeof el.setConfig === 'function') window.hkHostClient.bridge(el, client);
  }

  // MUSIC NOT ADDED (2026-10-12). Without the Music feature the player and
  // the speaker picker have no speakers -- empty rooms, "Pick speakers on
  // Play Music" -- so they say what is missing instead. ONLY ON THE
  // INTEGRATION'S OWN ANSWERS: hkMusic.configured() is false until
  // hk_music/subscribe answers, and the settings feed's `added` is a stored
  // copy until it is live, so a house WITH Music never sees this line while
  // a page loads. (Same rule in hk-music.js and hk-library.js.)
  // (a place in Home Assistant's settings, as the host says it: hk-host-shell.js haPlace)
  function NO_MUSIC() { return 'Add the Music feature to play music here (' + window.hkShell.haPlace('Settings → Devices & services → HK Frontend → Add feature') + ').'; }
  function musicMissing() {
    var Mu = window.hkMusic, HS = window.hkSettings;
    if (!Mu || !Mu.configured || Mu.configured()) return false;
    return !!(HS && HS.live && !(C.added && C.added('music')));
  }
  // The line, in place of the card. `_built` goes false, so the card builds
  // itself from scratch once Music is added.
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

  // ------------------------------------------------------- hk-now-playing
  //
  // THE player. One card, two places: the Play Music page and the #media
  // bar. The speakers, presets and playlists come from the Music feature
  // through hkMusic.
  //
  // IT HAS NO `entity`. A Lovelace card binds its entity at config time, so
  // no single card could name "whatever this screen is about" without one
  // conditional copy of the whole player per speaker. Every field resolves
  // the player through hkMusic (cards/hk-base.js), per screen.
  //
  // TRANSPORT CALLS THE INTEGRATION, NOT media_player SERVICES, and every
  // call names its player: hk_frontend.music_transport (music.py) checks it
  // is a configured speaker, and acts on exactly what was on screen.
  // The stacked player geometry, emitted for more than one selector. See the
  // TALL note in HkNowPlayingCard.CSS for why it is a function and not a
  // literal block.
  function tall(sel) {
    return [
      sel + '{',
      // THREE BUTTONS, AND THAT IS WHY THIS IS SIMPLE.
      //
      // With `stop` there are four, and four buttons evenly spaced put
      // play/pause 31px left of the midline; every fix for that has its own
      // tell -- a 1fr between next and stop orphans it against the card
      // edge. With an ODD number of buttons the middle one IS the middle,
      // and two equal 1fr tracks are the whole rule.
      //
      // Stop stays in the BAR, where it earns its place: the bar is shown by
      // "the selected speaker is playing", so pause would leave it on screen
      // against a frozen track while stop ends playback and takes the bar
      // with it. On this page you are already looking at the player, and
      // pause is the control you want.
      '  --hk-np-cols:minmax(0,1fr) 64px 64px 64px minmax(0,1fr);',
      // THE RUNNING ORDER IS THE APPLE MUSIC ONE: the artist and song text
      // aligned left with the progress bar underneath it, then the media
      // controls, then volume at the bottom.
      //
      // Track, then progress (`sub`), then transport, then volume (`meta`).
      // The transport sitting BETWEEN the two bars is why they are two
      // control cards rather than one stacked one.
      '  --hk-np-areas:"art art art art art"',
      '                "title title title title title"',
      '                "artist artist artist artist artist"',
      '                "player player player player player"',
      '                "sub sub sub sub sub"',
      '                ". prev play next ."',
      '                "meta meta meta meta meta";',
      '  --hk-np-rows:min-content min-content min-content min-content min-content min-content min-content;',
      '  --hk-np-height:auto;--hk-np-tb-margin:0;--hk-np-gap:6px;',
      // ONE INSET: the margin above the album art matches the side margins,
      // and the volume and progress bars respect the same margins as the
      // art. Capping the art at 340 inside a 406px content box and centring
      // it gives THREE different insets on a 444px card: the art 52px from
      // the card edge, the bars 19px, and the top 21px.
      //
      // That 52 is not a margin anybody chose -- it is 18px of card padding
      // plus 34px of leftover gutter. Without the cap the art fills the
      // content box, so the ONLY inset left is the padding, and the bars
      // (which always span that box) line up with the artwork for free.
      // Bottom padding is 36, not 24, so there is a bit more space below
      // the volume slider. A slider's ink is a thin line inside
      // a 28px box, so an even padding LOOKS tighter under it than above the
      // artwork, which fills its box edge to edge.
      // NO SIDE PADDING, because there is no plate to be inside of.
      // The artwork is the column: 358px at the 4-across split, bigger than
      // with a plate even though the column is narrower, because there is no
      // padding holding it off a card edge.
      // Everything BELOW it keeps its own inset (--hk-np-below-inset).
      '  --hk-np-pad:0px 0px 30px 0px}',
      // max-width:none, deliberately. A cap is what creates the gutter, and
      // the art is sized by the COLUMN -- which is also how it gets bigger
      // rather than smaller: 340 -> 356 even in a narrower column, because
      // 68px of wasted gutter goes away. Big album art is the point.
      // --hk-np-art-max is still here for a caller that genuinely wants a cap.
      sel + ' .art{width:100%;height:auto;aspect-ratio:1;justify-self:stretch;',
      '  max-width:var(--hk-np-art-max,none)}',
      // LEFT, not centred. Centred text under left-aligned artwork has no
      // edge to line up with.
      //
      // --hk-np-below-inset INSETS EVERYTHING UNDER THE ARTWORK, so nothing
      // below the album art runs too close to the edge of the card.
      //
      // This is deliberately NOT more card padding, which is the obvious
      // move: the artwork is sized by the content box, so padding takes the
      // extra width straight off the cover -- and big artwork is the one
      // thing that must not shrink here. An inset on the rows BELOW the art
      // costs nothing, because none of them is what sets the card's size.
      //
      // The art therefore sits slightly WIDER than the text under it,
      // which is the intent: the cover reads as the subject and the text as
      // a caption on it, rather than both fighting for the same edge.
      sel + ' .title,' + sel + ' .artist,' + sel + ' .player,',
      sel + ' .sub,' + sel + ' .meta{',
      '  padding-left:var(--hk-np-below-inset,14px);',
      '  padding-right:var(--hk-np-below-inset,14px)}',
      // AIR BETWEEN THE COVER AND THE TRACK NAME. The row gap alone gives
      // 6px, which reads as the title being stuck to the artwork.
      sel + ' .title{margin-top:12px}',
      sel + ' .title{font-size:26px;letter-spacing:-0.6px;justify-self:start;',
      '  text-align:left;align-self:center;max-width:100%}',
      sel + ' .artist{font-size:16px;justify-self:start;text-align:left}',
      sel + ' .player{justify-self:start;text-align:left}',
      // THE TRANSPORT CAN SIT 4px LOW, with less space above the media
      // buttons than below them, and this is why.
      //
      // Measured: 19px from the progress times to the top of the glyph, 15px
      // from its bottom to the volume slider. The grid row is even (6px
      // either side); the slack is INSIDE the progress slot. hk-media-
      // control-card is a custom element, so it defaults to display:inline
      // -- and an inline child builds a line box with room for descenders
      // underneath it. Four pixels of font metrics, under a bar with no text
      // in it. (Same shape as the layout-card grid-layout trap: a custom
      // element that is inline until something says otherwise.)
      sel + ' .sub > *,' + sel + ' .meta > *{display:block}',
      // 64px BOXES WITH 34px GLYPHS -- these are touch targets for fingers
      // on a wall, not a mouse, so size and spacing help. 56 already clears
      // the 44px minimum, but there are no wells on these buttons, so the
      // GLYPH is all there is to aim at and the perceived target is the
      // glyph, not the box.
      // ---- NO BOUNDING BOX ----------------------------------------------------
      // With the album art as the whole background of Play Music, a box around
      // the player is not needed. A plate exists to separate the player from a
      // background it has no relationship to. Once the background IS this
      // cover, a box around the cover is a box around something already
      // unified.
      //
      // The card's OWN `.bg`/`.shade` go with it for the same reason: they
      // are a blurred copy of the same artwork, and the page paints that
      // full-bleed. Two blurred copies of one cover, one inside the other, is
      // exactly the muddle a plate would hide.
      sel + '{background:none;box-shadow:none;border:none}',
      sel + ' .bg,' + sel + ' .shade{display:none}',
      // AND THE CLIP GOES WITH THEM, or the album art's shadow is clipped on
      // the left and right.
      //
      // `hk-plate.np` carries `overflow:hidden`, and it is there for exactly
      // one thing: the blurred `.bg img` is inset -40px and 80px oversized, so
      // without a clip it would spill out of the card on every side. The line
      // above turns that layer off in this layout -- the page paints the
      // blurred cover full-bleed instead -- so the clip is left guarding
      // nothing and cropping the only thing that still needs to escape.
      //
      // The art is FULL-BLEED here (--hk-np-pad is `0px 0px 30px 0px`, so
      // there is no side padding at all) and its shadow is 0 10px 26px: 13px
      // of spill each side, cut dead at the sleeve edge, while the 30px of
      // bottom padding lets the bottom of the same shadow through -- sides
      // gone, bottom fine.
      //
      // Nothing else in this layout needs the card to clip: `.art` has its own
      // overflow:hidden for the image's rounded corners, and the title, artist
      // and player rows each carry theirs for their ellipsis.
      sel + '{overflow:visible}',
      // Text sits on the page wash now, so it carries its own contrast.
      // drop-shadow rather than text-shadow: .title and .artist clip with
      // overflow:hidden for their ellipsis, which crops a text-shadow -- see
      // the note on .player. A filter applies to the clipped result instead.
      sel + ' .title,' + sel + ' .artist,' + sel + ' .player{',
      '  filter:var(--hk-glow,drop-shadow(0 2px 8px rgba(0,0,0,.55)))}',
      // ON A LIGHT PAGE (hk-base.js tone(): someone else's dashboard, no
      // sky) there is no page wash under this plate-less player -- the text
      // and the transport glyphs take the theme's ink instead of white. Each
      // fallback is the base rule's own value, so with the tone unset (HK's
      // screens, where the sky paints the cover) nothing here changes.
      sel + ' .title{color:' + window.hkCards.v('ink') + '}',
      sel + ' .artist{color:' + window.hkCards.v('ink-2') + '}',
      sel + ' .player{color:' + window.hkCards.v('ink-3') + '}',
      sel + ' .art .none{background:' + window.hkCards.v('key') + '}',
      sel + ' .tb hk-icon{color:' + window.hkCards.v('glyph') + ';',
      '  filter:var(--hk-glow,drop-shadow(0 2px 5px rgba(0,0,0,.55)))}',
      sel + ' .tb:active hk-icon{filter:var(--hk-glow,drop-shadow(0 1px 3px rgba(0,0,0,.55)) brightness(0.9))}',
      // A LIGHTER SHADOW THAN THE PLATED PLAYER'S, so the album art's shadow
      // looks deliberate. The base rule is `0 22px 54px rgba(0,0,0,.55)`,
      // for artwork on a dark opaque plate that swallows most of it. On a
      // bright blurred cover it has nothing to sink into and reads as a grey
      // smudge under the sleeve, roughly the size of the sleeve -- which is
      // exactly what an accident looks like.
      //
      // Same family as every other lifted thing on this page: the pills
      // and the playlist tiles are 0 6px 18px at .10, this is the same shape
      // scaled to a 352px object.
      sel + ' .art{border-radius:16px;box-shadow:0 10px 26px rgba(0,0,0,.24)}',
      sel + ' .tb{height:64px;width:64px;align-self:center}',
      sel + ' .tb hk-icon{width:34px;height:34px;--mdc-icon-size:34px}',
      sel + ' .play hk-icon{width:46px;height:46px;--mdc-icon-size:46px}',
      // No stop button in this layout at all. It has no cell, and a grid
      // child naming a MISSING area is auto-placed rather than ignored, so it
      // has to be hidden outright or it appears in a column of its own.
      sel + ' .stop{display:none}',
      // The base rule gives .meta `padding:8px 0 2px`, which in the wide
      // layout separates it from a neighbour it does not have here. Here it
      // would just add 10px on top of the row gap and push the transport down
      // -- 10px that would have to come off the artwork to stay above the fold.
      // VERTICAL ONLY. A `padding:0` shorthand silently resets the left/right
      // inset the rule above has just set -- measured: art 25, title 39,
      // progress 39, volume 25, with the volume slider the one thing still
      // running to the card edge.
      // 16px ABOVE THE VOLUME, so the controls are not too close to the
      // volume slider. The row gap alone gives 5px between a 64px button
      // box and a 28px slider box -- both of which carry air inside them, so
      // the measured gap flatters what the eye actually sees.
      sel + ' .meta{padding-top:16px;padding-bottom:0}',
      // ROW GAP, EXPLICITLY. --hk-np-gap is the COLUMN gap only -- the base
      // `.np .grid` rule pins row-gap at a literal 8px -- so setting the
      // variable would do nothing for a layout whose rows are the whole point.
      // Seven rows means six gaps, so each pixel here costs six; at 8 the
      // card runs 3px past the fold.
      sel + ' .grid{row-gap:5px}'
    ].join('');
  }

  // The bar's Speakers panel: the bar's dark plate as glass; over the button
  // on a tablet (springing from it), a sheet from the foot on a phone
  var SPK_CSS = [
    '.scrim{position:fixed;inset:0;background:rgba(0,0,0,0);transition:background .3s}',
    '.scrim.on{background:rgba(0,0,0,.18)}.scrim.dim.on{background:rgba(0,0,0,.4)}',
    '.mpanel{background:rgba(32,30,38,.86);-webkit-backdrop-filter:blur(28px) saturate(1.4);backdrop-filter:blur(28px) saturate(1.4)}',
    '.mpanel .mpbg,.mpanel .mpshade{display:none}',
    '.mpanel .mpin{width:100%!important;height:100%!important}',
    '.mpanel .mpact{font-size:15px;gap:6px}.mpanel .mpact svg{width:16px;height:16px}.mpanel .mpact.stop svg{width:18px;height:18px}',
    '.mpanel.pop{position:fixed;border-radius:22px;box-shadow:0 26px 70px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12);',
    '  opacity:0;transform:scale(.6) translateY(24px);transition:transform .34s cubic-bezier(.32,.72,0,1),opacity .2s}',
    '.mpanel.pop.in{opacity:1;transform:none}',
    '.mpanel.sheet{position:fixed;left:0;right:0;bottom:0;top:auto;border-radius:28px 28px 0 0;',
    '  box-shadow:0 -10px 40px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.14);',
    '  transform:translateY(100%);transition:transform .38s cubic-bezier(.32,.72,0,1)}',
    '.mpanel.sheet.in{transform:none}',
    '@media (prefers-reduced-motion:reduce){.mpanel.pop,.mpanel.sheet{transition:none}}'
  ].join('');
  // the screensaver's Browse glyph (mdi library-music)
  var LIB = 'M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 5h-3v5.5a2.5 2.5 0 1 1-1-2V5h4v2z';
  // THE MUSIC PAGE (hk-music.js): its two addresses
  function onMusicPage() {
    var seg = String(location.pathname).split('/')[2] || '';
    return seg === 'playmusic' || seg === 'music-browse';
  }
  class HkNowPlayingCard extends HkBase {
    static get CSS() {
      return [
        'hk-plate.np{position:relative;overflow:hidden;display:block;',
        '  height:var(--hk-np-height,360px);border-radius:30px;',
        '  padding:var(--hk-np-pad,32px 36px);background:rgba(22,23,26,.90);',
        // The rim and the border, same as every glass surface -- but NOT the
        // glass background. This is an opaque sheet by design: the blurred
        // album art sits behind it and needs something solid to read against.
        '  border:' + window.hkCards.M.border + ';',
        '  box-shadow:inset 0 1px 0 rgba(255,255,255,0.20),0 22px 60px rgba(0,0,0,.42)}',
        // `art` repeats down the left so it spans every text row. bg and shade
        // are NOT in the grid: they are absolute, so they take no cell and
        // cover the whole card from hk-plate, the positioned ancestor.
        //
        // Zero-height rows of their own ("bg" and "shade" above the art) look
        // free and are not: each empty row still pays the 8px row-gap. That
        // pushes every row down 16px and the grid's content 10px out of its
        // bottom, so the album art would sit 49px from the top of the card and
        // 23px from the bottom -- an uneven margin around the artwork.
        //
        // THE TRANSPORT TRACKS ARE EXACTLY BUTTON-WIDE (62px), so the only
        // thing between two buttons is the 18px column-gap. Tracks of
        // 78/96/78/78 against a 62px button give three different gaps in a
        // four-button row, which looks thrown together. The trailing 1fr is
        // what keeps the transport left-aligned under the text.
        //
        // 306, not 288: the art is 288 wide and sits at the START of this
        // track, so the extra 18 becomes gutter. A margin-right on the art
        // does NOT work -- the column is a fixed width, so the margin
        // overflows and the boundary does not move. 18 + 18 column-gap = the
        // 36 the card's own left and right padding use.
        // BUILT FROM THE BOTTOM. With the spare height as the LAST row, the
        // title, player line and progress/volume sit up against the top of the
        // artwork and the gap opens BELOW them, between the volume and the
        // buttons (37px). An empty row on top takes the 1fr instead: the
        // controls stack up from the buttons, and the slack sits above the
        // title.
        '.np .grid{display:grid;height:100%;',
        // SIX COLUMNS: art, four transport cells, then a flexible tail.
        // Every row string has to AGREE on the count, because a grid whose
        // rows disagree on column count is not an error: it silently grows
        // implicit tracks and the artwork drifts.
        '  grid-template-areas:var(--hk-np-areas,"art . . . . ." "art title title title title title" "art artist artist artist artist artist" "art player player player player player" "art meta meta meta meta meta" "art prev play next stop .");',
        '  grid-template-columns:var(--hk-np-cols,306px 62px 62px 62px 62px minmax(0,1fr));',
        '  grid-template-rows:var(--hk-np-rows,1fr min-content min-content min-content min-content min-content);',
        '  column-gap:var(--hk-np-gap,18px);row-gap:8px;align-items:center}',
        '.np .bg,.np .shade{position:absolute;inset:0;pointer-events:none}',
        '.np .bg{z-index:0}.np .shade{z-index:1}',
        '.np .bg img{position:absolute;inset:-40px;width:calc(100% + 80px);',
        '  height:calc(100% + 80px);object-fit:cover;filter:blur(34px);',
        '  transform:scale(1.06);opacity:.62}',
        '.np .bg .flat{position:absolute;inset:0;',
        '  background:linear-gradient(125deg,#2a2524,#14161c)}',
        // A darkening wash. Without it the text sits on whatever the album
        // cover happens to be, and light covers make it unreadable.
        '.np .shade{background:linear-gradient(100deg,rgba(8,9,12,.86) 0%,',
        '  rgba(8,9,12,.62) 48%,rgba(8,9,12,.44) 100%)}',
        // MORE OF THE COVER, IN THE TALL LAYOUT ONLY: more colour from the
        // background showing through the player.
        //
        // The wash above runs at 100deg -- nearly horizontal -- because the
        // WIDE layout puts the art left and the text right, so it darkens the
        // text side. Stood up, the text is UNDERNEATH the art, so that
        // gradient darkens the whole card evenly and for no reason: the top
        // half it dims hardest is covered by the opaque artwork anyway.
        //
        // Vertical instead, and keyed to where the text actually is: nearly
        // clear behind the art, deepening through the title and artist,
        // darkest under the transport. Same readability, far more colour.
        '.np.tall .shade{background:linear-gradient(180deg,',
        '  rgba(8,9,12,.10) 0%,rgba(8,9,12,.14) 46%,',
        '  rgba(8,9,12,.52) 72%,rgba(8,9,12,.74) 100%)}',
        // .62 suits the heavier wash. With the wash off the top of the card
        // the cover can carry more of the surface.
        '.np.tall .bg img{opacity:.85}',
        // 288px. The album cover is the subject of this page -- at 228 it reads
        // as an icon beside the text rather than the thing you are listening
        // to. `start` on a tablet; on a phone it spans the full width, so it
        // centres.
        // The art still spans EVERY row, the empty top one included, so it
        // stays centred in the card: the same 36..324 box as before (measured).
        '.np .art{grid-area:art;z-index:2;align-self:center;',
        '  justify-self:var(--hk-np-art-justify,start);',
        '  width:288px;height:288px;border-radius:18px;',
        '  box-shadow:0 22px 54px rgba(0,0,0,.55);overflow:hidden}',
        '.np .art img{width:100%;height:100%;object-fit:cover;display:block}',
        '.np .art .none{width:100%;height:100%;display:flex;align-items:center;',
        '  justify-content:center;background:rgba(255,255,255,.07);',
        '  font-size:60px;opacity:.5}',
        '.np .title{grid-area:title;z-index:2;justify-self:start;align-self:end;',
        '  color:rgba(255,255,255,.97);font-size:34px;font-weight:700;',
        '  letter-spacing:-0.9px;line-height:1.15;max-width:100%;',
        '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.np .artist{grid-area:artist;z-index:2;justify-self:start;',
        '  color:rgba(255,255,255,.68);font-size:19px;font-weight:500;',
        '  letter-spacing:-0.4px;max-width:100%;overflow:hidden;',
        '  text-overflow:ellipsis;white-space:nowrap}',
        // max-width/overflow here are A SAFETY NET, not the layout: the CAP of
        // four room names is sized to the 1280 tablet column, and a long list
        // on a phone would push the card wider than the screen. overflow:hidden
        // is safe on THIS field because it carries no text-shadow -- overflow
        // clips a text-shadow, so do not copy it to the title.
        '.np .player{grid-area:player;z-index:2;justify-self:start;align-self:start;',
        '  padding-top:6px;color:rgba(255,255,255,.42);font-size:11.5px;',
        '  font-weight:700;letter-spacing:0.9px;max-width:100%;overflow:hidden;',
        '  text-overflow:ellipsis;white-space:nowrap}',
        // Spans the full right-hand column. A 560px cap read as a bar floating
        // in the middle of the card with nothing holding its right end.
        '.np .sub{grid-area:sub;z-index:2;justify-self:stretch;align-self:center;display:none}',
        '.np .meta{grid-area:meta;z-index:2;justify-self:stretch;',
        '  align-self:center;width:100%;padding:8px 0px 2px 0px}',
        // --hk-np-tb-margin: 10px above so volume -> buttons matches the
        // progress-labels -> volume spacing, 3px below so the buttons' bottom
        // edge lands on the artwork's (both 324px from the card top). The
        // phone's stacked layout sets it to 0.
        // NO WELL BEHIND THE TRANSPORT, as in Apple Music: the player buttons
        // have no circles around them, they float with a little shadow
        // underneath.
        //
        // `background:none`, not a smaller element: the 62px box STAYS as the
        // hit target. A bare 30px glyph is a 30px tap target, which is under
        // the 44px minimum and would be a real regression on a wall tablet
        // you poke while walking past. The button keeps its size and loses
        // only its fill.
        //
        // The shadow goes on the GLYPH via drop-shadow, not on the button via
        // box-shadow: box-shadow draws the shadow of the BOX, which is a
        // 62px square nobody can see. drop-shadow follows the alpha
        // of what is actually painted, which is the icon.
        '.np .tb{z-index:2;align-self:end;height:62px;width:62px;',
        '  margin:var(--hk-np-tb-margin,10px 0 3px 0);',
        '  border-radius:31px;background:none;border:none;',
        '  box-shadow:none;padding:0;display:flex;align-items:center;',
        '  justify-content:center;cursor:pointer;',
        '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
        '  transition:background-color .25s ease,transform .12s ease}',
        '.np .tb:active{transform:scale(0.97)}',
        // brightness() is on the glyph, not on .tb, combined with the
        // drop-shadow in ONE filter. Two filter declarations on the same
        // element do not compose -- the later simply replaces the earlier --
        // so a `filter:brightness()` on :active would have silently deleted
        // the shadow for the duration of every press.
        '.np .tb hk-icon{width:30px;height:30px;--mdc-icon-size:30px;',
        '  color:rgba(255,255,255,.95);',
        '  filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))}',
        '.np .tb:active hk-icon{filter:drop-shadow(0 1px 3px rgba(0,0,0,.55)) brightness(0.9)}',
        // Play/pause is the one you reach for, and with no wells to separate
        // them the size difference is what carries that.
        '.np .play hk-icon{width:38px;height:38px;--mdc-icon-size:38px}',
        '.np .prev{grid-area:prev}.np .play{grid-area:play}.np .next{grid-area:next}',
        // Shown by default: the full player's grid has a `stop` cell too.
        // A grid child naming a MISSING area is not ignored -- it is placed in
        // an implicit track, so it would appear in a column of its own. That is
        // the rule to remember if a caller ever passes its own --hk-np-areas
        // without one.
        '.np .stop{grid-area:stop;display:flex}',
        '.np .close{grid-area:close;display:none}',
        // the bar's alone: hidden elsewhere, or each would take a track of its own
        '.np .spk,.np .brw{display:none}',
        '.np.bar .spk{grid-area:spk;display:flex}.np.bar .brw{grid-area:brw;display:flex}',
        // a step quieter than the transport: they open things, they do not
        // act on the music
        '.np.bar .spk hk-icon{width:28px;height:28px;--mdc-icon-size:28px;color:rgba(255,255,255,.82)}',
        '.np.bar .brw{color:rgba(255,255,255,.82)}',
        '.np.bar .brw svg{width:26px;height:26px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))}',
        '.np.bar .spk.lit{background:rgba(255,255,255,.18)}',
        // ON THE MUSIC PAGE (a phone's: the bar is its mini player) there is
        // nothing to browse to
        '.np.bar.onmusic .brw{display:none}',
        // NO CLOSE BUTTON (2026-10-11): the bar is put away by swiping it
        // down (_swipe), as a phone's mini player -- the X took 54px of a
        // phone's title. Its element stays: the full player has none either.
        // (The bar takes vertical drags itself; sideways, the sliders.)
        'hk-plate.np.bar{touch-action:pan-x}',

        // ---- BAR ------------------------------------------------------------
        // The persistent now-playing bar: bottom of the screen, full width,
        // no scrim, dashboard still live underneath. Everything here is a
        // variable override plus a smaller type scale -- the card is
        // parameterised on --hk-np-areas/-cols/-rows/-height/-pad, which is
        // what makes a second layout cheap rather than a second card.
        //
        // TWO ROWS of half height, not one: title over artist is the only
        // part that wants stacking, and everything else spans both. The
        // full screen width is why nothing is cramped.
        'hk-plate.np.bar{height:var(--hk-np-height,84px);border-radius:var(--hk-np-radius,22px);',
        '  padding:var(--hk-np-pad,10px 14px)}',
        // DOCKED AT THE BOTTOM (the #media bar, 2026-10-10): square, full width,
        // a hairline along its top and a soft shadow up onto the page -- the
        // screensaver's pane, laid along the bottom. Set by the bar's sheet
        // (--hk-np-radius/-edge/-shadow); a floating bar keeps its own.
        'hk-plate.np.bar{border-top:var(--hk-np-edge,none);box-shadow:var(--hk-np-shadow,none)}',
        // CONTENT-SIZED ROWS, CENTRED AS A BLOCK. With 1fr rows the title is
        // align-self:end in the top half and the artist sits below the row
        // boundary, putting the pair's centre 3px under the artwork's.
        // min-content rows plus align-content:center centre the two lines as
        // one block, and the art -- which spans both rows and is centred in
        // them -- lands on the same line.
        '.np.bar .grid{column-gap:14px;row-gap:2px;align-content:center}',
        // THREE auto rows in the text column -- title, artist, progress -- so
        // every one of them centres on its own row rather than one hugging the
        // row above and one the row below.
        '.np.bar .title,.np.bar .artist,.np.bar .sub{align-self:center}',
        // The progress bar is the width of the text column and no wider, so
        // it reads as belonging to the song rather than to the card.
        '.np.bar .sub{padding:2px 0 0 0}',
        // Volume STANDS ALONE in the bar, vertically centred in its cell:
        // the full player's padding here is the gap under the progress times,
        // which the bar does not have above it.
        '.np.bar .meta{padding:0;align-self:center}',
        // The art is taller than the two text lines together, so it overflows
        // the row block equally above and below -- which is what keeps it
        // centred on the card rather than on the text.
        '.np.bar .art{align-self:center}',
        // A summary that opens the full page, so it should say so on a mouse.
        '.np.bar .art,.np.bar .title,.np.bar .artist{cursor:pointer}',
        // 56 SQUARE, set on the art itself. The base rule is
        // `.np .art{width:288px;height:288px}` -- the cover is the subject of
        // the Play Music PAGE. Setting the grid COLUMN to 56 does not resize
        // it: a 288px box stays 288px, forces the row, and the card overflows
        // ~200px past its own 84px height. The sheet carries
        // `overflow: visible` (its background is transparent), so that overflow
        // runs straight off the bottom of the screen and looks like the pop-up
        // is mispositioned. It is not; it is the artwork.
        '.np.bar .art{width:72px;height:72px;border-radius:12px;',
        '  box-shadow:0 4px 14px rgba(0,0,0,.45)}',
        '.np.bar .title{font-size:19px;line-height:1.2;white-space:nowrap;',
        '  overflow:hidden;text-overflow:ellipsis}',
        '.np.bar .artist{font-size:14px;line-height:1.2;white-space:nowrap;',
        '  overflow:hidden;text-overflow:ellipsis}',
        // The player line ("PLAYING ON - KITCHEN") has no room on one line
        // with everything else and is the least useful thing here: the
        // speaker picker is a tap away in the full sheet.
        '.np.bar .player{display:none}',
        // THREE OVERRIDES, all because the base .tb is tuned for the Play
        // Music PAGE, where the buttons sit on the card's bottom row:
        //   align-self:end          pushes them to the bottom of their area;
        //                           in the bar they span BOTH rows, so that
        //                           puts them 12px below the card's centre.
        //   margin 10px 0 3px 0     asymmetric on purpose there, and part of
        //                           the same 12px here.
        //   hk-icon 26x26           the icon BOX is fixed at 26 while
        //                           --mdc-icon-size sets the glyph, so
        //                           shrinking only the glyph leaves it
        //                           off-centre inside its own box.
        // 56px BUTTONS IN A 64px TRACK: the bar's controls bigger, and spaced
        // out a bit more.
        //
        // The SPACING is the track, not a margin. The bar's column-gap is a
        // single hard-coded 14px for the whole grid (`.np.bar .grid`), so
        // there is no way to open up the transport alone through the gap --
        // and a margin on a grid item inside a fixed track just shrinks the
        // button instead of moving it. A 64px track holding a 56px button
        // centres it with 4px either side, which reads as a 22px gap between
        // buttons against the grid's 14.
        //
        // `close` stays 48: it is chrome, it keeps its well, and it should not
        // grow alongside the controls it is not part of.
        '.np.bar .tb{width:48px;height:48px;align-self:center;margin:0}',
        '.np.bar .prev,.np.bar .play,.np.bar .next,.np.bar .stop{',
        '  width:56px;height:56px;justify-self:center}',
        // Bare here too -- the bar is the same player. Slightly smaller than
        // the page's 30/38, because the bar is 104px tall and the glyphs sit
        // beside a song title rather than under artwork.
        // Bigger glyphs here too. The BOX stays 48 -- the bar's columns are 48
        // and the 1106px minimum width is derived from them -- so this is glyph
        // only, which is the part you actually aim at with no wells.
        '.np.bar .tb hk-icon{width:30px;height:30px;--mdc-icon-size:30px}',
        '.np.bar .prev hk-icon,.np.bar .next hk-icon,.np.bar .stop hk-icon{',
        '  width:34px;height:34px;--mdc-icon-size:34px}',
        '.np.bar .play hk-icon{width:42px;height:42px;--mdc-icon-size:42px}',
        // The blurred cover behind the bar, softer than the page's: at 84px
        // tall a 34px blur is most of the element. Dimmer than the page's .62
        // as well, where it reads under the .92 plate below as the bar's own
        // depth.
        // (a touch brighter, 2026-10-11: the user found the cover's color
        // too faint under the docked bar's opaque plate -- .30 and the wash
        // below at .56/.40/.26 before)
        '.np.bar .bg img{filter:blur(22px);opacity:.38}',
        // NO BACKDROP BLUR. The bar is FIXED over a page that scrolls, so a
        // backdrop-filter on it (blur 24px, 1244x104) re-blurs the strip behind
        // it on every scroll frame. Measured on an Android wall tablet, 1500 px
        // page scrolls with the bar up, three alternating rounds: blurred --
        // p95 frame 22.1 ms every run, 21-42 frames over 20 ms; unblurred -- p95
        // 11.2 ms (2 of 3), 12-14 over 20 ms. So a denser tint in its place:
        // the blurred cover (.bg img, a filter on a STATIC image, rastered once)
        // and the shade still give it depth. .92, not .82: without the blur the
        // page behind is SHARP, and at .82 the favorites' labels read clearly
        // through the bar and fight its own text.
        // (--hk-np-plate: docked along the bottom it is opaque -- the page
        // ends above it, so nothing is meant to show through)
        'hk-plate.np.bar{background:var(--hk-np-plate,rgba(22,23,26,.92))}',
        // A lighter wash than the page's .86/.62/.44: chosen for the
        // translucent bar (at the page's values the transparency did not
        // read), and left as is under the .92 plate.
        '.np.bar .shade{background:linear-gradient(100deg,rgba(8,9,12,.50) 0%,',
        '  rgba(8,9,12,.34) 48%,rgba(8,9,12,.20) 100%)}',
        // NARROW WINDOWS.
        //
        // A wall tablet is typically 1280 CSS px (see the viewport note), so the
        // bar's geometry in its `vars:` is written for exactly that and needs no
        // query. A DESKTOP window is whatever somebody dragged it to.
        //
        // 1176, AND THE NUMBER IS DERIVED, NOT GUESSED. A hand-waved 1290 ("the
        // columns add up to about 1258") would silently take the volume slider
        // off every 1280px tablet, because 1280 is less than 1290. The columns
        // that cannot shrink are 72 + 220 + 4x64 + 380 + 48 = 976 (the two 1fr
        // spacers go to zero), plus nine 14px gaps = 1102, plus the card's 16px
        // padding either side and the sheet's 18px = 1170. So the layout holds
        // down to 1170 and the break belongs just under it, not 180px above.
        //
        // THE BREAKPOINT MOVES WITH THE BUTTON SIZE (48px transport tracks give
        // 1100) and there is nothing to warn you if it does not -- a bar that no
        // longer fits does not wrap or scroll, it just crushes the title column
        // to 0 (see the phone note below). Re-derive this sum whenever a track
        // changes.
        //
        // Drop the widest thing first. The volume slider is the one control
        // with a substitute -- the speaker's own buttons, the Play Music page
        // -- while the transport and the song are the point of the bar.
        // The area/column plan is REPLACED, not patched. Hiding `.meta` alone
        // is not enough: its 380px track is fixed by the grid and stays there,
        // empty. These give the narrow bar its own simpler plan, which also
        // means it does not have to be kept in step with the vars' numbers.
        // (On the Music page -- .onmusic, a phone's at most -- the same
        // plans without Browse, at every width; the bar's own vars: plan,
        // past 1176, has its .onmusic twin here too.)
        'hk-plate.np.bar.onmusic{',
        '  --hk-np-cols:72px minmax(220px,max-content) 1fr 56px 64px 64px 64px 64px 1fr minmax(0,380px);',
        '  --hk-np-areas:"art title . spk prev play next stop . meta"',
        '                "art artist . spk prev play next stop . meta"',
        '                "art sub . spk prev play next stop . meta"}',
        '@media (max-width:' + window.hkCards.BP.desk + 'px){hk-plate.np.bar{',
        '  --hk-np-cols:72px minmax(0,1fr) 52px 64px 64px 64px 64px 52px;',
        '  --hk-np-areas:"art title spk prev play next stop brw"',
        '                "art artist spk prev play next stop brw"',
        '                "art sub spk prev play next stop brw"}',
        '  hk-plate.np.bar.onmusic{',
        '  --hk-np-cols:72px minmax(0,1fr) 52px 64px 64px 64px 64px;',
        '  --hk-np-areas:"art title spk prev play next stop"',
        '                "art artist spk prev play next stop"',
        '                "art sub spk prev play next stop"}',
        '  .np.bar .meta{display:none}}',
        // Past that the stop button goes too: play/pause covers it, and at
        // this width nobody is glancing at the bar from across a room. 860
        // by the same sum without the volume track: 912 - 380 + gaps + padding.
        // Browse goes with it: the art and the title open the Music page
        // anyway, and with it the title kept 65px at 641.
        '@media (max-width:' + window.hkCards.BP.tabletUpright + 'px){hk-plate.np.bar,hk-plate.np.bar.onmusic{',
        '  --hk-np-cols:72px minmax(0,1fr) 52px 64px 64px 64px;',
        '  --hk-np-areas:"art title spk prev play next"',
        '                "art artist spk prev play next"',
        '                "art sub spk prev play next"}',
        '  .np.bar .stop,.np.bar .brw{display:none}}',
        // PHONE.
        //
        // The 860 plan bottoms out at EXACTLY a phone, which is why this is a
        // separate step and not a smaller number on the one above. Measured
        // at 402px: the sheet takes 18px a side and the card 16px, leaving
        // 334px of content, and 72 + 4x48 + five 14px gaps is 334. The title
        // column resolves to 0px and the close button runs 2px past the grid's
        // right edge. Nothing wraps and nothing scrolls, so this is invisible
        // to everything except a measurement.
        //
        // WHAT GOES: prev and next. Not a preference -- there is no width for
        // them. Keeping them costs 108px of the 307px a 375px phone has, and
        // a song title in the ~90px left is about nine characters. Play/pause
        // is the control you reach for on a phone, close is how you get the
        // bar off a small screen, and the full transport is ONE TAP away: the
        // artwork and the title open the Play Music page (`.np.bar .art` is
        // cursor:pointer for exactly that reason).
        //
        // The sizes have to be set here as well as the tracks. `.np.bar .art`
        // and `.np.bar .tb` are explicit widths, not track-driven -- narrowing
        // a grid column does NOT resize them, which is the same trap the 56px
        // artwork note above records.
        //
        //   64 + 44 + 44 + three 10px gaps = 182, so the title gets 152px of
        //   the 334 a 402px phone has, and 125px of the 307 at 375.
        //
        // SPEAKERS IN, CLOSE OUT (2026-10-11): the title keeps ~160px of a
        // 402px phone.
        '@media (max-width:' + window.hkCards.BP.phone + 'px){hk-plate.np.bar,hk-plate.np.bar.onmusic{',
        '  --hk-np-cols:56px minmax(0,1fr) 44px 44px;',
        '  --hk-np-areas:"art title spk play"',
        '                "art artist spk play"',
        '                "art sub spk play"}',
        '  .np.bar .spk hk-icon{width:22px;height:22px;--mdc-icon-size:22px}',
        // SLIMMER, AND NO CHIN ON TOP OF A CHIN (2026-10-11): 56px artwork
        // and 12px round it, the progress a line under the song (its times
        // go: phone_times in the strategy) -- and the foot's 12px is TAKEN
        // FROM an iPhone's home-indicator inset, not added to it. The
        // controls stay above the inset either way (34pt on an iPhone:
        // 102pt in all, was 138; 80 where there is none).
        '  hk-plate.np.bar{--hk-np-height:calc(68px + max(12px, env(safe-area-inset-bottom, 0px)));',
        '    --hk-np-pad:12px 24px max(12px, env(safe-area-inset-bottom, 0px))}',
        // ALONG THE TOP (Bar Position: Top; hk-popup.js sets np-top): the
        // same, its 12px taken from the top inset (the Dynamic Island's)
        '  :host([np-top]) hk-plate.np.bar{--hk-np-height:calc(68px + max(12px, env(safe-area-inset-top, 0px)));',
        '    --hk-np-pad:max(12px, env(safe-area-inset-top, 0px)) 24px 12px}',
        '  .np.bar .grid{row-gap:3px}',
        // column-gap DIRECTLY, not --hk-np-gap. `.np.bar .grid` hard-codes
        // 14px (see above), which beats the variable outright -- so an
        // `hk-np-gap` in the bar's `vars:` is inert, and setting it here would
        // be too. Measured: the var reads 10px on both the card and the grid
        // while the gap stays 14. Same specificity as that rule and later in
        // the sheet, so this wins.
        '  .np.bar .grid{column-gap:10px}',
        '  .np.bar .prev,.np.bar .next{display:none}',
        '  .np.bar .art{width:56px;height:56px;border-radius:10px}',
        '  .np.bar .tb{width:44px;height:44px}',
        '  .np.bar .tb hk-icon{width:22px;height:22px;--mdc-icon-size:22px}',
        // One step down each, so a title that fits at 19px still fits here.
        '  .np.bar .title{font-size:17px}',
        '  .np.bar .artist{font-size:13px}}',
        // ---- TALL ------------------------------------------------------------
        // The Play Music page's player, stood up in a 460px column beside the
        // speakers. It is A GEOMETRY, NOT A CARD: the card already resizes
        // nicely vertically, the way the phone uses it.
        //
        // ONE DEFINITION, TWO SELECTORS, and that is the point of tall() below.
        // A block of `--hk-np-*` overrides on :root under
        // `@media (max-width: 640px)` (in css/hk-responsive.css, say) cannot do
        // this, for two reasons:
        //
        //   * :root sets them by INHERITANCE, so any rule that declares them
        //     on the card itself silently wins -- which is exactly what a
        //     `tall` class does. The phone block would be dead the moment this
        //     class existed, and nothing would say so.
        //   * A media query cannot express "narrow COLUMN". The 460px column
        //     on a 1280px tablet needs this shape at a width where no media
        //     query fires.
        //
        // So the values live here once and are emitted twice: for the class,
        // and for any un-classed player below 640px, which keeps the phone
        // fallback.
        //
        // The artwork is the one thing that differs from a phone-only rule:
        // there it fills the screen, here it must fit a 460px column AND
        // leave the transport above the fold, so it is a percentage with a cap
        // rather than the base rule's fixed 288px square. The cap is MEASURED
        // against the fold, not chosen -- at 340 the card lands at 787 of 800.
        tall('hk-plate.np.tall'),
        // :not(.bar), AND THAT EXCLUSION IS LOAD-BEARING. `hk-plate.np` matches
        // the BAR too, so below 640px the #media bar would be handed the tall
        // player's geometry -- measured on a phone: --hk-np-height:auto and
        // --hk-np-pad:0 0 30px on the bar, which makes it 122px instead of 104
        // and leaves the transport sitting 20px from the top against 58 from the
        // bottom. The bar's own plan sets --hk-np-cols and --hk-np-areas on the
        // more specific `hk-plate.np.bar`, so those stay right and only the
        // variables tall() alone defines leak -- which is why it looks like
        // a centring bug rather than the wrong layout.
      '@media (max-width:' + window.hkCards.BP.phone + 'px){' + tall('hk-plate.np:not(.bar)') + '}',
      // ITS OWN DARK PLATE (wide and the docked bar): on a light page the
      // controls on it -- hk-media-control-card's progress and volume --
      // keep today's white. The tall layout has no plate and takes the light
      // look (tall() above).
      ':host([data-hk-light]) hk-plate.np.bar{' + window.hkCards.LIGHT_OFF + '}',
      '@media (min-width:' + (window.hkCards.BP.phone + 1) + 'px){:host([data-hk-light]) hk-plate.np:not(.tall){' + window.hkCards.LIGHT_OFF + '}}',
        '@media (prefers-reduced-motion:reduce){',
        '  .np .tb,.np .tb:active{transition:none;transform:none}}',
        // ======================================== ON A HOME GRID (G2)
        // A block of its own (docs/phase11/HOME-GRID.md), the plate filling
        // it at HK's corner, over the cover's blur (.bg, as every player),
        // the cover's size from the block's (the cell is a size container:
        // cqw / cqh are the block's). No player buttons (the sheet has them,
        // a tap away). Buttons keep 48 px targets.
        //   W  the cover beside the song, the transport under it
        //   T  the cover on top, the song, the progress, the transport
        //   L  the cover beside the song and its speaker, then the progress,
        //      the transport and the volume across, as Apple Music has them
        ':host([size]) hk-plate.np{--hk-np-height:100%;--hk-np-pad:' + window.hkCards.CARD.pad + ';border-radius:var(--hk-block-radius, ' + window.hkCards.M.radius + ');',
        // the shadow its neighbours have (the look's), not the page player's
        // 0 22px 60px, which spilt 80 px over the blocks round it
        '  box-shadow:inset 0 1px 0 rgba(255,255,255,.2),var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-lg') + ')}',
        ':host([size]) .np .grid{row-gap:2px;column-gap:var(--hk-np-gap,14px)}',
        ':host([size]) .np .meta,:host([size]) .np .sub,:host([size]) .np .stop{display:none}',
        ':host([size]) .np .art{width:var(--np-art);height:var(--np-art);border-radius:' + window.hkCards.R.inner + 'px;box-shadow:0 8px 22px rgba(0,0,0,.4)}',
        ':host([size]) .np .art .none{font-size:36px}',
        // the cover's blur shows through: a lighter wash than the page's
        // player (whose text runs across a whole column), the blur stronger
        ':host([size]) .np .bg img{opacity:.92}',
        // the blur kept inside the plate's corners: oversized and blurred, it
        // otherwise tinted a box round the block as far as the cell let it
        ':host([size]) .np .bg,:host([size]) .np .shade{overflow:hidden;border-radius:' + window.hkCards.M.radius + '}',
        ':host([size]) .np .shade{background:linear-gradient(100deg,rgba(8,9,12,.58) 0%,rgba(8,9,12,.38) 55%,rgba(8,9,12,.28) 100%)}',
        ':host([size]) .np .title{' + window.hkCards.typeCss('headline') + ';letter-spacing:0;line-height:22px;align-self:end}',
        ':host([size]) .np .artist{' + window.hkCards.typeCss('body') + ';line-height:19px;letter-spacing:0}',
        ':host([size]) .np .player{display:none}',
        ':host([size]) .np .tb{width:48px;height:48px;margin:0;align-self:center;justify-self:center}',
        ':host([size]) .np .tb hk-icon{width:28px;height:28px;--mdc-icon-size:28px}',
        ':host([size]) .np .play hk-icon{width:36px;height:36px;--mdc-icon-size:36px}',
        // SPEAKERS AND BROWSE (2026-10-27): either side of the transport, as on
        // the screensaver's pane; each turns the card over (_turn). W: five
        // 46 px tracks with no gap between them (the gap is in the art's
        // track) -- 110 + 12 + 230 of a 358 px block
        ':host([size]) .np .spk,:host([size]) .np .brw{display:flex;grid-area:spk;color:rgba(255,255,255,.86)}',
        ':host([size]) .np .brw{grid-area:brw}',
        ':host([size]) .np .spk hk-icon{width:24px;height:24px;--mdc-icon-size:24px;color:rgba(255,255,255,.86)}',
        ':host([size]) .np .brw svg{width:23px;height:23px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))}',
        // (nothing plays: no rooms to move -- Browse still starts something)
        ':host([size]) .np .spk.dis{opacity:.35;pointer-events:none}',
        // (the cover as tall as the block, but never wider than the room the
        // transport leaves it: a square cell's 196 would push it off the side)
        ':host([size=W]) hk-plate.np{--np-art:min(100cqh - 40px, 100cqw - 44px - 242px);',
        '  --hk-np-cols:calc(var(--np-art) + 12px) 46px 46px 46px 46px 46px minmax(0,1fr);',
        '  --hk-np-areas:"art . . . . . ." "art title title title title title title" "art artist artist artist artist artist artist" "art spk prev play next brw .";',
        '  --hk-np-rows:minmax(0,1fr) min-content min-content 52px}',
        ':host([size=W]) .np .grid{column-gap:0}',
        ':host([size=W]) .np .tb{width:46px}',
        // T: in the card's top corners, beside the cover (narrowed to clear them)
        ':host([size=T]) .np .spk,:host([size=T]) .np .brw{grid-area:auto;position:absolute;top:4px;width:32px;height:32px;z-index:3}',
        ':host([size=T]) .np .spk{left:4px}:host([size=T]) .np .brw{right:4px}',
        ':host([size=T]) .np .spk::before,:host([size=T]) .np .brw::before{content:"";position:absolute;inset:-6px}',
        ':host([size=T]) .np .spk hk-icon{width:21px;height:21px;--mdc-icon-size:21px}',
        ':host([size=T]) .np .brw svg{width:20px;height:20px}',
        ':host([size=T]) hk-plate.np{--np-art:min(100cqw - 76px, 100cqh - 190px);',
        '  --hk-np-cols:repeat(3,minmax(0,1fr));',
        '  --hk-np-areas:"art art art" "title title title" "artist artist artist" ". . ." "sub sub sub" "prev play next";',
        '  --hk-np-rows:var(--np-art) min-content min-content minmax(0,1fr) min-content 52px}',
        ':host([size=T]) .np .art{justify-self:center;margin-bottom:8px}',
        ':host([size=T]) .np.tall .shade,:host([size=T]) .np .shade{background:linear-gradient(180deg,rgba(8,9,12,.10) 0%,rgba(8,9,12,.30) 45%,rgba(8,9,12,.74) 100%)}',
        // (L: the transport centred on the middle three tracks; the cover
        // spans the first two, so it is as wide as the gap beside them allows)
        ':host([size=L]) hk-plate.np{--np-art:min(100cqh - 40px - 166px, (100cqw - 44px - 248px) / 2 + 78px);',
        '  --hk-np-cols:minmax(0,1fr) 64px 64px 64px minmax(0,1fr);',
        '  --hk-np-areas:"art art . . ." "art art title title title" "art art artist artist artist" "art art player player player" "art art . . ." "sub sub sub sub sub" "spk prev play next brw" "meta meta meta meta meta";',
        '  --hk-np-rows:minmax(0,1fr) min-content min-content min-content minmax(0,1fr) min-content 56px min-content}',
        // (the volume a 44 px target: its slider as tall as its row)
        ':host([size=L]) .np .meta{display:block;padding:0;--hk-range-h:44px}',
        ':host([size]) .np .sub{align-self:end}:host([size=L]) .np .sub,:host([size=T]) .np .sub{padding-top:12px}',
        ':host([size=L]) .np .title{' + window.hkCards.typeCss('title') + ';line-height:27px}',
        ':host([size=L]) .np .player{display:block;' + window.hkCards.typeCss('label-small') + ';padding-top:6px}',
        ':host([size=L]) .np .tb{width:56px;height:56px}',
        ':host([size=L]) .np .spk,:host([size=L]) .np .brw{width:48px}',
        ':host([size=L]) .np .tb hk-icon{width:32px;height:32px;--mdc-icon-size:32px}',
        ':host([size=L]) .np .play hk-icon{width:44px;height:44px;--mdc-icon-size:44px}',
        ':host([size][data-grid-pager]) hk-plate.np{--hk-np-pad:20px 22px 44px}',
        ':host([size=W][data-grid-pager]) hk-plate.np{--np-art:calc(100cqh - 64px);',
        '  --hk-np-areas:"art title title title title title title" "art spk prev play next brw .";--hk-np-rows:minmax(0,1fr) 46px}',
        ':host([size=W][data-grid-pager]) .np .artist{display:none}',
        ':host([size=W][data-grid-pager]) .np .tb{width:44px;height:44px}',
        ':host([size=T][data-grid-pager]) hk-plate.np{--np-art:min(100cqw - 76px,100cqh - 174px)}'
      ].join('');
    }

    getCardSize() { return 6; }

    // WHICH PLAYER: hkMusic's answer for THIS screen (cards/hk-base.js). A
    // single home-wide value would let another tablet change what this one
    // shows, and the transport would act on whatever it said at the moment
    // of the tap.
    _res() {
      return (window.hkMusic && this.client)
        ? window.hkMusic.resolve(this.client)
        : { player: null, context: null, reason: 'none', name: '' };
    }
    _player() {
      var p = this._st(this._res().player) || null;
      return window.hkMusic && window.hkMusic.ignored(p) ? null : p;
    }

    // EACH NEW CLIENT (HkBase calls this from Lovelace's entry and from a client set
    // directly): the music model follows its subscription port.
    _receiveClient() {
      if (window.hkMusic) window.hkMusic.attach(this.client);
      super._receiveClient();
      // the open Speakers panel follows the house, a few times a second at
      // most (rooms joining, levels, the queue's song); gone with the music
      var me = this._spk;
      if (me && Date.now() - me.ticked > 400) {
        me.ticked = Date.now();
        // (the Home Grid's back stays: Browse is how something starts)
        if (!this._musicCtx() && !me.turn) this._closeSpk(); else me.p.update();
      }
    }
    // the bar on the Music page (.onmusic): no Browse, no Close
    _closeGlyph() {
      var hc = this._root && this._root.querySelector('hk-plate.bar');
      if (!hc) return;
      hc.classList.toggle('onmusic', onMusicPage());
      this._locListen(true);
    }
    // the page change it follows, heard only while connected: a bar left
    // behind by a rebuilt dashboard must not stay reachable from window
    _locListen(on) {
      if (on && !this._onLoc) {
        var self = this;
        this._onLoc = function () { setTimeout(function () { self._closeGlyph(); }, 0); self._closeSpk(); };
        window.hkShell.onNavigate(this._onLoc);
        window.addEventListener('popstate', this._onLoc);
      } else if (!on && this._onLoc) {
        window.hkShell.offNavigate(this._onLoc);
        window.removeEventListener('popstate', this._onLoc);
        this._onLoc = null;
      }
    }

    // THE BAR'S SPEAKERS (2026-10-11): the screensaver's panel (Speakers /
    // Volume / Queue, hk-saver-panel.js), on any page but the Music page --
    // a popover over the button on a tablet, a sheet from the foot on a
    // phone. On <body> under a shadow root of its own, not in the bar: the
    // docked sheet clips, and the panel fires no events that need
    // home-assistant to hear them. It closes on a tap outside, on its X,
    // a moment after a request has landed, when the music goes, and when
    // the page changes.
    _openSpk() {
      var P = window.hkSaverPanel, self = this, h = this.client;
      if (this._spk) { this._closeSpk(); return; }
      var btn = this._root && this._root.querySelector('.spk'), card = this._root && this._root.querySelector('hk-plate');
      if (!P || !btn || !card || !h || !this._musicCtx()) return;
      var phone = window.innerWidth <= 640, b = btn.getBoundingClientRect(), top = card.getBoundingClientRect().top;
      var W = phone ? window.innerWidth : 430, H = phone ? Math.round(Math.min(640, window.innerHeight * 0.86)) : Math.round(Math.min(560, top - 28));
      var left = phone ? 0 : Math.round(Math.min(window.innerWidth - W - 16, Math.max(16, b.left + b.width / 2 - W / 2)));
      var host = document.createElement('div');
      // the dashboard's font: the panel is mounted under <body> (hk-base.js)
      host.style.cssText = 'position:fixed;inset:0;z-index:12;' + (window.hkCards.FONT_ROOT || '');
      var sr = host.attachShadow({ mode: 'open' }), HC = window.hkCards;
      var st = document.createElement('style');
      st.textContent = P.CSS + (HC && HC.shadeCss ? HC.shadeCss('.mpanel') : '') + SPK_CSS;
      sr.appendChild(st);
      var scrim = document.createElement('div'); scrim.className = 'scrim' + (phone ? ' dim' : '');
      sr.appendChild(scrim);
      var me = { host: host, scrim: scrim, phone: phone, doneT: null, ticked: 0 };
      me.p = P.create({
        tabs: ['speakers', 'volume', 'queue'],
        client: function () { return self.client; },
        ctx: function () { return self._musicCtx(); },
        art: function () { return null; },
        stop: true,
        follow: function (key) { var Mu = window.hkMusic; if (key && Mu && Mu.known(key)) Mu.setFocus(key); },
        done: function (ms) {
          if (self._spk !== me) return;
          clearTimeout(me.doneT);
          me.doneT = setTimeout(function () { if (self._spk === me) self._closeSpk(); }, ms || 0);
        },
        wide: function () { return false; }
      });
      var el = me.p.el;
      el.classList.add('up', phone ? 'sheet' : 'pop');
      el.style.cssText = phone ? 'height:' + H + 'px' :
        'left:' + left + 'px;top:' + (top - H - 14) + 'px;width:' + W + 'px;height:' + H + 'px;' +
        'transform-origin:' + Math.round(b.left + b.width / 2 - left) + 'px 100%';
      sr.appendChild(el);
      me.p.size(W, H, 1);
      me.p.show('speakers');
      scrim.addEventListener('click', function () { self._closeSpk(); });
      me.key = function (ev) { if (ev.key === 'Escape') self._closeSpk(); };
      window.addEventListener('keydown', me.key);
      document.body.appendChild(host);
      this._spk = me;
      btn.classList.add('lit');
      requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('in'); scrim.classList.add('on'); }); });
    }
    _closeSpk() {
      var me = this._spk;
      if (!me) return;
      this._spk = null;
      clearTimeout(me.doneT);
      window.removeEventListener('keydown', me.key);
      if (me.turn) {
        window.removeEventListener('resize', me.place);
        // (a field focused on a tablet: its keyboard goes with it)
        try { var fa = me.host.shadowRoot.activeElement; if (fa && fa.blur) fa.blur(); } catch (x) { /* ignore */ }
        me.scrim.classList.remove('on');
        var fin = function () { me.p.destroy(); me.host.remove(); me.turn.style.visibility = ''; };
        if (me.turn.isConnected) this._turnAnim(me, false, fin); else { if (me.anim) me.anim.cancel(); fin(); }
        return;
      }
      var btn = this._root && this._root.querySelector('.spk');
      if (btn) btn.classList.remove('lit');
      me.p.el.classList.remove('in'); me.scrim.classList.remove('on');
      setTimeout(function () { me.p.destroy(); me.host.remove(); }, 320);
    }
    // THE HOME GRID'S TURN-OVER (2026-10-27): Speakers and Browse turn the
    // card over, as the screensaver's pane turns (hk-saver.js turnPanel), and
    // its back grows out of the block into the screensaver's panel --
    // Speakers / Volume / Queue / Browse, what plays at its foot -- over the
    // page, dimmed a little behind it. On <body> under a shadow root of its
    // own, as the bar's: the block's cell clips. It closes on a tap outside,
    // its X, Escape, a moment after a request has landed (a pick played: the
    // card turns back to it), and with the page.
    _turn(tab) {
      var P = window.hkSaverPanel, self = this, HC = window.hkCards, me = this._spk;
      if (me) { if (me.p.tab() !== tab) me.p.show(tab); else this._closeSpk(); return; }
      var plate = this._root && this._root.querySelector('hk-plate.np');
      if (!P || !plate || !this.client) return;
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:12;' + (HC.FONT_ROOT || '');
      var sr = host.attachShadow({ mode: 'open' });
      var st = document.createElement('style');
      st.textContent = P.CSS + (HC.shadeCss ? HC.shadeCss('.mpanel') : '') +
        '.scrim{position:fixed;inset:0;background:rgba(0,0,0,0);transition:background .3s}.scrim.on{background:rgba(0,0,0,.34)}' +
        '.mpanel.turn{position:fixed;border-radius:' + HC.M.radius + ';background:rgb(24,25,29);' +
        'box-shadow:0 26px 70px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12)}' +
        // (a phone's width: four tabs and the X on one row)
        '.mpanel.turn.narrow .mptabs div{padding:0 6px}' +
        '@media (prefers-reduced-motion:reduce){.scrim{transition:none}}';
      sr.appendChild(st);
      var scrim = document.createElement('div'); scrim.className = 'scrim';
      sr.appendChild(scrim);
      me = { host: host, scrim: scrim, turn: plate, doneT: null, ticked: 0, anim: null };
      me.p = P.create({
        tabs: ['speakers', 'volume', 'queue', 'browse'],
        client: function () { return self.client; },
        ctx: function () { return self._musicCtx(); },
        // the cover, blurred behind the panel as on the screensaver
        art: function () {
          var i = self._e && self._e.art && self._e.art.querySelector('img');
          return i && i.complete && i.naturalWidth ? i : null;
        },
        stop: true,
        follow: function (key) { var Mu = window.hkMusic; if (key && Mu && Mu.known(key)) Mu.setFocus(key); },
        done: function (ms) {
          if (self._spk !== me) return;
          clearTimeout(me.doneT);
          me.doneT = setTimeout(function () { if (self._spk === me) self._closeSpk(); }, ms || 0);
        },
        wide: function () { return !!me.wide; },
        // what plays, at its foot: the front is turned away
        mini: function () { return true; },
        now: function () { return self._nowFor(); },
        transport: function (k) { self._svc(k === 'pp' ? 'play_pause' : 'next'); }
      });
      var el = me.p.el;
      el.classList.add('up', 'turn');
      sr.appendChild(el);
      me.place = function () {
        // (the block where it stands now: hidden, it is still laid out)
        if (me.hidRect && !me.anim) { var rr = plate.getBoundingClientRect(); me.hidRect = { left: rr.left, top: rr.top, width: rr.width, height: rr.height }; }
        var b = self._turnBox(me);
        me.box = b; me.wide = b.w >= 500;
        el.classList.toggle('narrow', b.w < 420);
        el.style.cssText = 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px';
        me.p.size(b.w, b.h, 1);
      };
      me.place();
      me.p.show(tab);
      scrim.addEventListener('click', function () { self._closeSpk(); });
      me.key = function (ev) { if (ev.key === 'Escape') self._closeSpk(); };
      window.addEventListener('keydown', me.key);
      window.addEventListener('resize', me.place);
      document.body.appendChild(host);
      this._spk = me;
      requestAnimationFrame(function () { scrim.classList.add('on'); });
      this._turnAnim(me, true);
    }
    // ITS BOX: bigger than the block -- 520 x 640 on a tablet, the width of
    // a phone -- centred on it, kept on the screen
    _turnBox(me) {
      var vw = window.innerWidth, vh = window.innerHeight, r = me.hidRect || me.turn.getBoundingClientRect();
      var phone = vw <= window.hkCards.BP.phone;
      var w = Math.round(phone ? vw - 24 : Math.min(vw - 32, Math.max(r.width, 520)));
      var h = Math.round(Math.min(vh - (phone ? 48 : 40), Math.max(r.height, 640)));
      var clamp = function (v, lo, hi) { return hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)); };
      var x = clamp(r.left + r.width / 2 - w / 2, 12, vw - w - 12), y = clamp(r.top + r.height / 2 - h / 2, 20, vh - h - 20);
      return { x: Math.round(x), y: Math.round(y), w: w, h: h };
    }
    // THE TURN: the card to edge-on where it stands, then the panel from
    // edge-on, growing from the block's size to its own; back the same way.
    // Transforms only.
    _turnAnim(me, opening, done) {
      var el = me.p.el, src = me.turn, B = me.box, self = this, EASE = window.hkCards.EASE;
      var reduce = (window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) ||
                   (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (opening) { var rr = src.getBoundingClientRect(); me.hidRect = { left: rr.left, top: rr.top, width: rr.width, height: rr.height }; }
      var R = me.hidRect, per = 1500;
      var edge = 'perspective(' + per + 'px) rotateY(90deg)';
      // the panel, at the block's place and size, turned -90
      var small = 'perspective(' + per + 'px) translate(' + Math.round(R.left + R.width / 2 - (B.x + B.w / 2)) + 'px,' +
                  Math.round(R.top + R.height / 2 - (B.y + B.h / 2)) + 'px) rotateY(-90deg) scale(' +
                  (R.width / B.w).toFixed(3) + ',' + (R.height / B.h).toFixed(3) + ')';
      var can = !reduce && typeof el.animate === 'function' && typeof src.animate === 'function';
      if (me.anim) { try { me.anim.cancel(); } catch (x) { /* done */ } me.anim = null; }
      if (opening) {
        if (!can) { src.style.visibility = 'hidden'; return; }
        el.style.visibility = 'hidden';
        var a = me.anim = src.animate([{ transform: 'none' }, { transform: edge }], { duration: 240, easing: EASE.exit, fill: 'forwards' });
        a.onfinish = function () {
          src.style.visibility = 'hidden'; a.cancel();
          if (self._spk !== me) { src.style.visibility = ''; return; }
          el.style.visibility = '';
          var b = me.anim = el.animate([{ transform: small }, { transform: 'none' }], { duration: 440, easing: EASE.standard });
          b.onfinish = function () { if (me.anim === b) me.anim = null; };
        };
      } else {
        if (!can) { done(); return; }
        var c1 = me.anim = el.animate([{ transform: 'none' }, { transform: small }], { duration: 300, easing: EASE.exit, fill: 'forwards' });
        c1.onfinish = function () {
          el.style.visibility = 'hidden';
          src.style.visibility = '';
          var c2 = me.anim = src.animate([{ transform: edge }, { transform: 'none' }], { duration: 280, easing: EASE.standard });
          c2.onfinish = function () { me.anim = null; done(); };
        };
      }
    }
    // what plays, for the panel's foot (hk-saver-panel.js drawMini)
    _nowFor() {
      var p = this._player(), Mu = window.hkMusic, c = this._musicCtx();
      if (!p) return null;
      var a = p.attributes || {};
      return { idle: !(p.state === 'playing' || p.state === 'paused'), playing: p.state === 'playing',
               title: this._title(p), artist: a.media_artist || '', pic: this._art(p),
               room: c && Mu && Mu.label ? Mu.label(c) : '' };
    }
    // the screen's bottom safe-area inset (an iPhone's home indicator), as
    // CSS has it: env() is not readable from script but through a box
    _insetBottom() {
      var r = this._root;
      if (!r) return 0;
      var p = this._insetProbe;
      if (!p || !p.isConnected) {
        p = this._insetProbe = document.createElement('div');
        p.style.cssText = 'position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;' +
          'height:env(safe-area-inset-bottom,0px)';
        r.appendChild(p);
      }
      return p.offsetHeight || 0;
    }
    // PUT AWAY: hk-popup's own close path (the hash cleared), the one its
    // backdrop and X use -- with `dismissable` it stays shut on this screen
    // until the music or the timers change
    // WHEN IT WAS LAST IN USE (hk-popup.js keeps the bar up a whole grace
    // after, the music paused or stopped): its Speakers open is now
    hkLastUse() { return this._spk ? Date.now() : (this._usedAt || 0); }
    _putAway() {
      if (location.hash) {
        history.replaceState(null, '', location.pathname + location.search);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    }
    // SWIPED DOWN, PUT AWAY (2026-10-11): the bar's close, as a phone's mini
    // player's. On purpose only --
    //   * it starts ON the bar (fixed: the page's scrolling never reaches
    //     it), not on its sliders (volume, progress) -- and not in the
    //     home-indicator strip at its foot (an iPhone's safe-area inset):
    //     a swipe down there is iOS's Reachability, sideways its app
    //     switcher, and no page can stop them -- the screen dropped
    //     with the bar, recorded 2026-10-11;
    //   * mostly downward: sideways or up is nothing at all (up from the
    //     foot is an iPhone's Home);
    //   * the plate follows the finger, and only past 40% of its height or
    //     on a downward flick does it go -- short of that it springs back;
    //   * past the slop it is a swipe, and no button under the finger fires.
    // It moves the docked SHEET, the timers' strip over the bar with it --
    // the whole of what goes away.
    _swipe(card) {
      var self = this, d = null, SLOP = 10;
      var sheetOf = function () {
        var n = self;
        while (n && !(n.classList && n.classList.contains('sheet'))) n = n.parentNode;
        return n;
      };
      card.addEventListener('pointerdown', function (ev) {
        if (d || self._spk || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
        var path = ev.composedPath ? ev.composedPath() : [], e = self._e || {};
        if (path.indexOf(e.meta) >= 0 || path.indexOf(e.sub) >= 0) return;
        var up = self.hasAttribute('np-top');
        if (!up && ev.clientY > window.innerHeight - self._insetBottom() - 4) return;
        var sh = sheetOf();
        if (!sh) return;
        // (along the top it goes up: the same swipe, mirrored)
        d = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, sh: sh, h: sh.offsetHeight || 100, on: false,
              dir: up ? -1 : 1, last: [ev.timeStamp, ev.clientY], prev: null };
      });
      card.addEventListener('pointermove', function (ev) {
        if (!d || ev.pointerId !== d.id) return;
        var dx = ev.clientX - d.x, dy = (ev.clientY - d.y) * d.dir;
        if (!d.on) {
          if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) { d = null; return; }
          if (dy < -SLOP) { d = null; return; }
          if (!(dy > SLOP && dy > Math.abs(dx) * 1.4)) return;
          d.on = true;
          try { card.setPointerCapture(d.id); } catch (x) { /* gone */ }
          d.sh.style.transition = 'none';
        }
        d.sh.style.transform = 'translateY(' + (d.dir * Math.max(0, dy - SLOP)) + 'px)';
        d.prev = d.last; d.last = [ev.timeStamp, ev.clientY];
      });
      var end = function (ev) {
        if (!d || ev.pointerId !== d.id) return;
        var g = d, sh = g.sh;
        d = null;
        if (!g.on) return;
        self._swallow = Date.now();
        var y = (ev.clientY - g.y) * g.dir - SLOP;
        var v = g.prev ? (g.last[1] - g.prev[1]) * g.dir / Math.max(1, g.last[0] - g.prev[0]) : 0;
        if (ev.type === 'pointerup' && (y > g.h * 0.4 || (v > 0.5 && y > 20))) {
          sh.style.transition = 'transform .2s cubic-bezier(.4,0,1,1)';
          sh.style.transform = 'translateY(' + (g.dir * 100) + '%)';
          // ...then closed where it already is: the sheet's own closed
          // place is the same translateY(100%), so nothing jumps
          setTimeout(function () { self._putAway(); sh.style.transition = ''; sh.style.transform = ''; }, 200);
        } else {
          sh.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)';
          sh.style.transform = '';
          setTimeout(function () { if (!sh.style.transform) sh.style.transition = ''; }, 300);
        }
      };
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', end);
      // a swipe is not a tap on what it started on
      card.addEventListener('click', function (ev) {
        if (self._swallow && Date.now() - self._swallow < 400) { ev.stopPropagation(); ev.preventDefault(); }
      }, true);
    }

    // what plays on this screen's music, as hkMusic resolves it
    _musicCtx() {
      var Mu = window.hkMusic, h = this.client;
      var r = Mu && h ? Mu.resolve(h) : null;
      return r && r.context ? r.context : null;
    }

    // A FOCUS CHANGE REPAINTS WITHOUT A HASS PUSH -- a context tapped on the
    // Play Music page, a request sent -- so the card listens for it, tied to
    // connection like every other listener in this library.
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      if (!this._musicOff && window.hkMusic) {
        this._musicOff = window.hkMusic.onChange(function () {
          if (self.client && self._config) self.redraw();
        });
      }
      // back on the page with a bar already drawn: follow page changes again
      if (this._root && this._root.querySelector('hk-plate.bar')) this._closeGlyph();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      if (this._musicOff) { this._musicOff(); this._musicOff = null; }
      this._locListen(false);
      this._closeSpk();
    }

    // The card re-renders when the RESOLVED player changes or when that
    // player does. The reason is in it too: "Ready on Kitchen" because it is
    // this tablet's room and "Ready on Kitchen" because a request is still
    // landing read the same, but they are different states.
    _sigOf() {
      var h = this.client, cfg = this._config;
      if (!h || !cfg) return null;
      var r = this._res();
      var p = this._st(r.player);
      var a = (p && p.attributes) || {};
      return r.player + ':' + r.reason + '|' +
             (p ? p.entity_id + p.last_updated : 'none') + '|' +
             // group_members changes without last_updated moving in some
             // integrations, and the player line names every joined room.
             ((a.group_members || []).join(',')) + '|' + (a.media_title || '') +
             (musicMissing() ? '|no-music' : '');
    }


    // entity_picture_local FIRST. Music Assistant sets entity_picture to an
    // ABSOLUTE url on its own port (http://<music-assistant-host>:8095/...), which only
    // resolves from inside the LAN -- so the art would be a broken image box
    // for anything reaching HA over an external hostname. entity_picture_local is
    // HA's own /api/media_player_proxy/ path: relative, carries its own token,
    // and works from every origin.
    _art(p) {
      var a = (p && p.attributes) || {};
      var pic = a.entity_picture_local || a.entity_picture || a.media_image_url
             || a.thumbnail || '';
      if (pic && pic.charAt(0) === '/') pic = location.origin + pic;
      return pic;
    }

    _title(p) {
      return (p && p.attributes && p.attributes.media_title) || 'Nothing Playing';
    }
    _artist(p) {
      var a = (p && p.attributes) || {};
      var artist = a.media_artist || '';
      var album = a.media_album_name || a.media_album || '';
      return (artist && album) ? (artist + ' · ' + album) : (artist || album || '');
    }

    // The SPEAKER, not the track -- so you can tell at a glance which room the
    // transport buttons are about to act on.
    //
    // An UNKNOWN selection says so rather than quietly showing another room:
    // a map that silently falls back to some other speaker shows that room's
    // artwork and title with nothing on screen admitting it.
    _playerLine(p) {
      if (!p) {
        var r0 = this._res();
        return r0.player ? 'NO SPEAKER  ·  ' + String(r0.name || r0.player).toUpperCase()
                         : 'NOTHING PLAYING  ·  PICK SPEAKERS ON PLAY MUSIC';
      }
      var M = window.hkMusic;
      var a = p.attributes || {};
      var s = p.state || 'idle';
      var label = s === 'playing' ? 'PLAYING ON'
                : (s === 'paused' ? 'PAUSED ON' : 'READY ON');
      // AD-HOC GROUPS. The selector holds the LEADER of whatever is playing,
      // so with five rooms joined the bare name would read "PLAYING ON .
      // KITCHEN HOMEPOD" and nothing would say the other four are playing too.
      //
      // group_members on a joined leader lists the leader AND every room
      // joined to it. A Music Assistant sync group reports None (its own
      // friendly name already says "Downstairs") and a single room reports an
      // empty list -- both fall through to the bare name.
      var g = a.group_members || [];
      if (g.length > 1) {
        // NAME THE ROOMS, don't just count them: hkMusic's short name, the
        // one the picker's pills use ("Kitchen"), rather than the entity's
        // friendly_name ("Kitchen HomePod MA"), which is unreadable four-across.
        var self = this;
        var names = g.map(function (e) {
          var o = self._st(e);
          return (M && M.known(e) && M.nameOf(e)) ||
                 (o && o.attributes && o.attributes.friendly_name) || e;
        });
        // FOUR, measured. The player line's column is 569px on a 1280 tablet;
        // four of the LONGEST room names come to ~548px and five to 652px. Past
        // that the count carries what the names cannot -- and a count beats a
        // truncation because it still tells you the total.
        var CAP = 4;
        var shown = names.slice(0, CAP).join(', ').toUpperCase();
        var rest = names.length > CAP ? (' +' + (names.length - CAP)) : '';
        return label + '  ·  ' + shown + rest;
      }
      // A sync group by its preset name ("DOWNSTAIRS"), not its entity's
      // friendly_name ("DOWNSTAIRS HOMEPODS DOWNSTAIRS").
      var own = (M && M.known(p.entity_id) && M.nameOf(p.entity_id)) || a.friendly_name || '';
      return label + '  ·  ' + String(own).toUpperCase();
    }

    // WHICH GLYPH THE TRANSPORT BUTTON SHOULD WEAR. A method rather than
    // four lines inside _render, so a test can ask the card the same question
    // the card asks itself -- a test that re-implements this expression would
    // pass with the feature deleted.
    _playIcon(p) { return (!!p && p.state === 'playing') ? 'mdi:pause' : 'mdi:play'; }

    _paintPlayButton(p) {
      var e = this._e;
      if (!e || !e.play) return;
      // THE LABEL IS GUARDED SEPARATELY FROM THE GLYPH, and it has to be:
      // an early return when the icon already matches would leave the
      // screen-reader label behind whenever the two start out of step. A test
      // that calls this method, instead of re-implementing it, catches that.
      var want = this._playIcon(p);
      var label = want === 'mdi:pause' ? 'Pause' : 'Play';
      var ic = e.play.querySelector('hk-icon');
      if (ic && ic.getAttribute('icon') !== want) ic.setAttribute('icon', want);
      if (e.play.getAttribute('aria-label') !== label) {
        e.play.setAttribute('aria-label', label);
      }
    }

    // EVERY TAP NAMES ITS PLAYER: the player drawn is the player sent, to
    // hk_frontend.music_transport (music.py), which checks it is a
    // configured speaker and serialises quick taps on the same player.
    _svc(command) {
      if (!this.client) return;
      var player = this._res().player;
      if (player) this._call('hk_frontend', 'music_transport', { player: player, command: command });
    }

    _render() {
      var cfg = this._config;
      // NO MUSIC FEATURE: the line instead of an empty player -- or, for a
      // card that hides while nothing plays (the docked bar), nothing
      if (musicMissing()) {
        if (cfg.hide_idle) {
          if (this.style.display !== 'none') this.style.display = 'none';
          this._root.innerHTML = '';
          this._built = false;
        } else {
          drawNoMusic(this);
        }
        this._e = null; this._metaCard = null; this._subCard = null;
        return;
      }
      if (!this._built) {
        this._root.innerHTML =
          '<hk-plate class="np' + (cfg.bar ? ' bar' : '') + (cfg.tall ? ' tall' : '') +
          '" data-hk-role="card"><div class="grid">' +
          '<div class="bg" data-hk-role="bg"></div>' +
          '<div class="shade" data-hk-role="shade"></div>' +
          '<div class="art" data-hk-role="art"></div>' +
          '<div class="title" data-hk-role="title"></div>' +
          '<div class="artist" data-hk-role="artist"></div>' +
          '<div class="player" data-hk-role="player"></div>' +
          '<div class="meta" data-hk-role="meta"></div>' +
          // SECOND CARD SLOT, for the bar. The full player stacks
          // progress + times + volume in one `meta` column; the bar is
          // 104px tall and cannot, so it passes TWO cards -- progress
          // here under the song name, volume alone in `meta`. Empty and
          // display:none unless sub_card is configured, because a div
          // whose grid-area is absent from the template gets
          // auto-placed and would add an implicit row to the full
          // player.
          '<div class="sub" data-hk-role="sub"></div>' +
          '<div class="tb prev" role="button" aria-label="Previous"' +
          ' data-hk-role="prev"><hk-icon icon="mdi:skip-previous"></hk-icon></div>' +
          // mdi:play, not mdi:play-pause -- the icon is swapped on every
          // render to say what the button will DO (see the update block).
          // Starting on `play` means the first paint of an idle player is
          // already right and never flickers through a combined glyph.
          '<div class="tb play" role="button" aria-label="Play"' +
          ' data-hk-role="play"><hk-icon icon="mdi:play"></hk-icon></div>' +
          '<div class="tb next" role="button" aria-label="Next"' +
          ' data-hk-role="next"><hk-icon icon="mdi:skip-next"></hk-icon></div>' +
          // STOP. Only the bar places it -- the full player's grid has no
          // `stop` area, so on that page this element has no cell and CSS
          // hides it. Stop rather than another pause because the bar is shown
          // by "the selected speaker is playing": pause would leave it on
          // screen against a frozen track, stop ends playback and the bar
          // goes with it.
          '<div class="tb stop" role="button" aria-label="Stop"' +
          ' data-hk-role="stop"><hk-icon icon="mdi:stop"></hk-icon></div>' +
          // CLOSE, as a CONTROL IN THE ROW rather than pop-up chrome. The
          // generic `close_button` hk-popup draws is absolutely positioned in
          // the sheet's top-right corner, which on a 104px bar reads as
          // something stuck to the outside of the card and is hard to see.
          // As a grid cell it is built in: it sits on the same baseline as the
          // transport and shares their well.
          //
          // Setting the hash to '' is hk-popup's own close path, the one the
          // backdrop tap and the X both use, so `dismissable` behaves
          // identically -- the sheet stays shut on this screen until playback
          // stops or the dismiss_scope changes.
          // SPEAKERS AND BROWSE (bar only, 2026-10-11): on either side of
          // the transport, as on the screensaver -- the screensaver's panel
          // (Speakers / Volume / Queue) and the Music page's search
          '<div class="tb spk" role="button" aria-label="Speakers"' +
          ' data-hk-role="spk"><hk-icon icon="hk:homepod"></hk-icon></div>' +
          '<div class="tb brw" role="button" aria-label="Browse Music" data-hk-role="brw">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + LIB + '"/></svg></div>' +
          '<div class="tb close" role="button" aria-label="Close"' +
          ' data-hk-role="close"><hk-icon icon="mdi:close"></hk-icon></div>' +
          '</div></hk-plate>';
        var q = this._root.querySelector.bind(this._root);
        this._e = { bg: q('.bg'), art: q('.art'), title: q('.title'),
                    artist: q('.artist'), player: q('.player'), meta: q('.meta'),
                    sub: q('.sub'), play: q('.play'), spk: q('.spk') };
        var self = this;
        q('.prev').addEventListener('click', function () { self._svc('previous'); });
        q('.play').addEventListener('click', function () { self._svc('play_pause'); });
        q('.next').addEventListener('click', function () { self._svc('next'); });
        q('.stop').addEventListener('click', function () { self._svc('stop'); });
        // ART AND TEXT OPEN THE PLAY MUSIC PAGE (bar only). On the page
        // itself they would navigate to where you already are, so this is
        // gated -- the bar is a summary, and the thing a summary should do
        // when tapped is take you to the full view.
        //
        // Relative because each tablet has its own dashboard root, so the
        // first path segment is whatever dashboard this is. `playmusic` is
        // the Play Music view's `path:`.
        if (cfg.bar) {
          var goPage = function () {
            // A HOST WITH A PLAYER OF ITS OWN (a phone app sets window.hkHostPlayer): that one, here
            var nat = window.hkHostPlayer;
            if (typeof nat === 'function') { nat(); return; }
            // ON THE MUSIC PAGE ITSELF (2026-10-11): the bar is its mini
            // player -- a tap opens its Now Playing (a phone's sheet)
            if (onMusicPage()) { window.dispatchEvent(new CustomEvent('hk-music-bar', { detail: { what: 'now' } })); return; }
            // ...and from anywhere else the same thing, there: the page opens
            // its Now Playing once it has laid itself out -- a phone's sheet;
            // at two or three columns the player is the page and there is
            // nothing to open (hk-music.js _wanted). A tap on the song is
            // always "show me the player" (2026-10-11).
            window.hkMusicWant = { what: 'now', at: Date.now() };
            var t = './playmusic';
            if (t.slice(0, 2) === './') {
              t = '/' + String(location.pathname).split('/')[1] + '/' + t.slice(2);
            }
            // Leave the hash behind, or the sheet re-opens over the page it
            // just navigated to.
            window.hkShell.navigate(t);
          };
          ['.art', '.title', '.artist'].forEach(function (sel) {
            var el = q(sel);
            if (el) el.addEventListener('click', goPage);
          });
        }
        if (cfg.bar) {
          // SPEAKERS: on the Music page, the page's own (it has Play Next On);
          // anywhere else the screensaver's panel, over the bar
          q('.spk').addEventListener('click', function () {
            if (onMusicPage()) { window.dispatchEvent(new CustomEvent('hk-music-bar', { detail: { what: 'speakers' } })); return; }
            self._openSpk();
          });
          // BROWSE: the Music page, in its search box
          q('.brw').addEventListener('click', function () {
            self._closeSpk();
            window.hkShell.navigate('/' + String(location.pathname).split('/')[1] + '/music-browse');
          });
        } else {
          // ON A HOME GRID (a block of its own, `size`): the card turns over
          q('.spk').addEventListener('click', function () { if (self.hasAttribute('size')) self._turn('speakers'); });
          q('.brw').addEventListener('click', function () { if (self.hasAttribute('size')) self._turn('browse'); });
        }
        q('.close').addEventListener('click', function () { self._putAway(); });
        if (cfg.bar) this._swipe(q('hk-plate'));
        // (a touch on the bar is it in use: hk-popup.js keeps it up a grace after)
        if (cfg.bar) q('hk-plate').addEventListener('pointerdown', function () { self._usedAt = Date.now(); }, true);
        // NO BROWSE BUTTON IN THE PLAYER: there is one on the page.
        // hk-speaker-picker-card appends a "Browse Music" tile to its row
        // whenever `browse_url` is set -- the picker's `browse_url` is the live
        // one; this card takes none.
        // The progress bar and volume slider, drawn straight onto this card's
        // glass. It has to be a REAL CARD rather than markup because an <input>
        // needs an event binding -- markup alone could only offer step buttons
        // for volume. Supplied per instance because its entity_from map is
        // generated alongside the speaker map.
        if (cfg.meta_card && window.hkCards && window.hkCards.create) {
          var mc = window.hkCards.create(cfg.meta_card);
          if (mc) { this._e.meta.appendChild(mc); this._metaCard = mc; }
        }
        if (cfg.sub_card && window.hkCards && window.hkCards.create) {
          var sc = window.hkCards.create(cfg.sub_card);
          if (sc) {
            this._e.sub.appendChild(sc);
            // FLEX, NOT BLOCK, and the difference is 4px of dead space.
            //
            // As a block the slot measures 35px tall around a 31px control
            // card, so the progress times sit 4px above the bottom of their
            // own row -- which reads as the transport underneath being pushed
            // down: 19px above the glyph against 15 below.
            //
            // The child has no margin and is display:block, so nothing should
            // leave a gap; the slot is a GRID ITEM, which establishes its
            // own formatting context, and the pocket survives there. A flex
            // column stretches the child to the slot instead of leaving it,
            // which puts the times where the box says they are: 14 above, 14
            // below.
            // TALL ONLY. Flex changes the slot's INTRINSIC width as well as
            // its height, and the bar's text column is
            // `minmax(220px, max-content)` -- so switching it there pushes
            // that column 220 -> 272 and moves the whole transport 26px
            // right. The 4px pocket only matters to the tall layout's
            // vertical rhythm, so the bar keeps its geometry.
            if (cfg.tall) {
              this._e.sub.style.display = 'flex';
              this._e.sub.style.flexDirection = 'column';
            } else {
              this._e.sub.style.display = 'block';
            }
            this._subCard = sc;
          }
        }
        this._built = true;
      }
      var e = this._e, p = this._player(), pic = this._art(p);
      if (cfg.bar) this._closeGlyph();
      // HIDE_IDLE (the docked #media bar): nothing playing or paused, no
      // player at all -- the bar opened for the timers alone is just their
      // strip, not a "Nothing Playing" row under it
      if (cfg.hide_idle) {
        var idle = !p || !(p.state === 'playing' || p.state === 'paused') || !(p.attributes && p.attributes.media_title);
        if (this.style.display !== (idle ? 'none' : '')) this.style.display = idle ? 'none' : '';
        if (idle) return;
      }

      // PUBLISH THE ARTWORK for whoever paints the page background.
      //
      // hk-sky.js draws the blurred cover behind the whole Play Music page,
      // but it must NOT resolve the speaker itself: which player this screen
      // shows is hkMusic's answer, read here. A second resolver in another
      // module can disagree with this one, and then the page shows one room's
      // artwork behind another room's player. This card already knows; it
      // says so.
      //
      // A plain global as well as the event: the sky may mount AFTER this
      // card has rendered, and would otherwise wait for a track change to
      // learn what is playing.
      if (window.hkNowArt !== pic) {
        window.hkNowArt = pic || null;
        window.dispatchEvent(new CustomEvent('hk-now-art',
          { detail: { url: pic || null } }));
      }

      // AN ATTRIBUTE VALUE, NOT A TEXT NODE. `pic` is built into an
      // `<img src="...">` STRING and handed to morph(), so anything in it that
      // ends an attribute ends the attribute. Most artwork here is HA's own
      // /api/media_player_proxy/... path and is inert, but `media_image_url`
      // and `thumbnail` come from the media source -- Music Assistant passes
      // the streaming service's own CDN URL through, and a signed one is full
      // of `&` and can carry quotes.
      //
      // DECODED BEFORE IT IS DRAWN (decoding="sync"). Safari decodes a large
      // picture off to the side and draws NOTHING where it goes until that is
      // done -- and every page change puts a new copy of the docked bar on
      // the new page: on the Mac its cover and its blurred backdrop were
      // missing for ~4 frames at each click (the user's screen recording,
      // 2026-10-11: the thumbnail an empty square, the bar flat and dark).
      // Chrome decodes in time, so the tablets never showed it. The cover is
      // already loaded (the same picture): decoding it in the frame costs a
      // few ms once, where the gap cost a visible blink every time.
      var picAttr = esc(pic);
      var bg = pic ? ('<img src="' + picAttr + '" alt="" decoding="sync">') : '<div class="flat"></div>';
      window.hkCards.morph(e.bg, bg);
      var art = pic ? ('<img src="' + picAttr + '" alt="" decoding="sync">')
                    : '<div class="none">&#9835;</div>';
      window.hkCards.morph(e.art, art);

      // THE BUTTON SHOWS WHAT IT WILL DO, not what it is: pause while music
      // is playing, play while music is paused or stopped.
      //
      // `mdi:play-pause` is the both-at-once glyph, which is honest about the
      // service it calls (media_play_pause) and useless as a status: it looks
      // identical whether the room is silent or mid-track. Every other
      // transport control here already says what it does.
      //
      // ONLY `playing` GETS THE PAUSE GLYPH. paused, idle, off, unavailable
      // and "no speaker resolved at all" are all states where the useful next
      // action is to start something, so they share the play triangle -- which
      // also makes the no-player case correct for free rather than by a branch.
      //
      // The ATTRIBUTE is set, not the element replaced: hk-icon re-renders on
      // an icon change, and swapping the node would throw away the one this
      // card's CSS has already sized (46px on the page, 38px in the pop-up,
      // 42px in the bar). The guard keeps it to one write per real change --
      // this block runs on every position tick.
      this._paintPlayButton(p);
      if (e.spk) e.spk.classList.toggle('dis', !this._musicCtx());

      var t = this._title(p);
      if (e.title.textContent !== t) e.title.textContent = t;
      var ar = this._artist(p);
      if (e.artist.textContent !== ar) e.artist.textContent = ar;
      // innerHTML, not textContent: the separator is &nbsp;&#183;&nbsp; and
      // the no-speaker case reads the same way.
      var pl = this._playerLine(p);
      if (e.player.__txt !== pl) { e.player.__txt = pl; e.player.textContent = pl; }
      // feed(), not a plain bridge: the nested card may not be upgraded yet.
      if (this._metaCard && this.client) feed(this._metaCard, this.client);
      if (this._subCard && this.client) feed(this._subCard, this.client);
    }
  }

  // ------------------------------------------------ hk-screensaver-now-card
  //
  // WHATEVER IS PLAYING, bottom-left of the screensaver. Not whatever the
  // selector points at: on a screensaver there is nobody to have made a
  // selection, and the useful answer is "this is what the home is playing
  // right now". Grouped players are checked FIRST -- `players` is in priority
  // order -- so a group reports once instead of the card flickering between
  // its members.
  //
  // MUSIC SPEAKERS ONLY, and the exclusions are not all the same kind of
  // thing. TVs and Apple TVs read `playing` for hours, and "now playing"
  // here means music; a bedroom speaker playing a twelve-hour sleep sound
  // is exactly the sort of thing nobody wants named across the bottom of
  // a photo screensaver.
  // `music: true` takes the list from the integration's configured speakers.
  class HkScreensaverNowCard extends HkBase {
    static get CSS() {
      return [
        // The card occupies NO SPACE: WallPanel stacks the cards it is given
        // in an info box at the top-left, and the body below steps out of that
        // box to pin itself to the opposite corner.
        'hk-plate.ssnow{background:none;box-shadow:none;border:none;padding:0;',
        '  margin:0;height:0;overflow:visible;display:block}',
        // position:fixed so this sits in the VIEWPORT's bottom-left rather
        // than under the clock. left:20px matches the clock card's own left
        // margin, so the two line up.
        // will-change: its own compositing layer, so WallPanel re-layering
        // the photos underneath at each change cannot re-raster it -- see
        // `layer` on hk-clock-card. This card only exists on the screensaver.
        // the forecast screensaver raises it above its band (--hk-ss-corner-bottom)
        // (it glides there, rather than jumping, as the band comes and goes)
        // (--hk-ss-now-*: the screensaver's calendar pane, which takes this
        // row into its foot, smaller -- hk-saver.js layoutPane)
        '.sscorner{position:fixed;left:var(--hk-ss-now-left,20px);bottom:var(--hk-ss-now-bottom,var(--hk-ss-corner-bottom,22px));z-index:5;display:flex;',
        '  transition:bottom 1.2s ease;',
        '  will-change:transform;',
        '  align-items:center;gap:var(--hk-ss-np-gap,18px);max-width:var(--hk-ss-now-max,46vw);pointer-events:none}',
        '.sscorner img,.sscorner .ph{width:var(--hk-ss-np-art,104px);height:var(--hk-ss-np-art,104px);border-radius:12px;',
        '  flex:0 0 var(--hk-ss-np-art,104px)}',
        '.sscorner img{object-fit:cover;box-shadow:0 10px 30px rgba(0,0,0,.45)}',
        '.sscorner .ph{background:rgba(255,255,255,.14);align-items:center;',
        '  justify-content:center;font-size:44px;opacity:.7}',
        // text-shadow:none + filter, NOT the inherited text-shadow. Both lines
        // are nowrap + overflow:hidden for the ellipsis, and a text-shadow is
        // clipped by the element that paints it -- so the info box's 68px-blur
        // stack came out as a hard band around a ~38px line box. A filter
        // applies after the children clip, so the ellipsis still works and the
        // shadow escapes. These radii are sized for 24-34px text, not for the
        // 150px clock the info-box value is tuned to.
        //
        // The filter is on the TEXT div and not on the position:fixed wrapper
        // on purpose: `filter` makes an element a containing block for fixed
        // descendants, which would undo the corner pinning. Same reason the
        // screensaver info box itself still uses text-shadow.
        //
        // text-align:left is REQUIRED, not decoration. WallPanel's info box
        // centres its content and these two lines inherit that, so the track
        // and artist would sit centred against each other beside the album art
        // instead of sharing a left edge. Nothing in the card sets it, so there
        // is nothing to notice; the inherited value does it.
        '.sscorner .txt{min-width:0;text-align:left;text-shadow:none;',
        '  filter:drop-shadow(0px 1px 3px rgba(0,0,0,0.34))',
        '    drop-shadow(0px 3px 14px rgba(0,0,0,0.30))}',
        '.sscorner .t{font-size:var(--hk-ss-np-title,34px);font-weight:700;letter-spacing:-0.4px;',
        '  line-height:1.12;color:rgba(255,255,255,.97);white-space:nowrap;',
        '  overflow:hidden;text-overflow:ellipsis}',
        '.sscorner .a{font-size:var(--hk-ss-np-artist,24px);font-weight:500;letter-spacing:-0.1px;',
        '  line-height:1.2;margin-top:4px;color:rgba(255,255,255,.82);',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      ].join('');
    }
    // `music: true`: the home's own speakers from the integration, presets
    // first -- the priority order a hand-written `players:` list would use,
    // without the list. `players:` still works for anything else.
    setConfig(config) {
      if (!config || !(config.music ||
                       (Array.isArray(config.players) && config.players.length))) {
        throw new Error('hk-screensaver-now: `music: true` or `players:` (in priority order)');
      }
      super.setConfig(config);
    }
    _players() {
      if (this._config.music && window.hkMusic) {
        return window.hkMusic.speakers().map(function (s) { return s.entity; });
      }
      return this._config.players || [];
    }
    getCardSize() { return 1; }
    _sigOf() {
      var h = this.client;
      if (!h) return null;
      var p = this._playing();
      if (!p) return 'none';
      var a = p.attributes || {};
      // The artwork URL is an input: a cover that lands after the title
      // (AirPlay metadata often does) must redraw the card.
      return p.entity_id + '|' + (a.media_title || '') + '|' + (a.media_artist || '') +
             '|' + (a.entity_picture_local || a.entity_picture || a.media_image_url || '');
    }
    _playing() {
      var ids = this._players();
      for (var i = 0; i < ids.length; i++) {
        var s = this._st(ids[i]);
        if (s && s.state === 'playing' && !(window.hkMusic && window.hkMusic.ignored(s))) return s;
      }
      return null;
    }
    _render() {
      if (!this._built) {
        this._root.innerHTML =
          '<hk-plate class="sscorner-host ssnow" data-hk-role="card"></hk-plate>';
        this._e = this._root.querySelector('.ssnow');
        this._built = true;
      }
      var p = this._playing();
      var a = (p && p.attributes) || {};
      var title = a.media_title || '', artist = a.media_artist || '';
      // NOTHING PLAYING DRAWS NOTHING, which is what keeps the screensaver
      // unchanged the rest of the time.
      if (!p || (!title && !artist)) {
        if (this._e.firstChild) this._e.textContent = '';
        return;
      }
      // entity_picture_local, not entity_picture: Music Assistant sets the
      // latter to an absolute URL on port 8095, which resolves only from
      // inside the LAN.
      var pic = a.entity_picture_local || a.entity_picture || a.media_image_url || '';
      if (pic && pic.charAt(0) === '/') pic = location.origin + pic;

      var box = document.createElement('div');
      box.className = 'sscorner';
      // THE PLACEHOLDER IS ALWAYS IN THE MARKUP, hidden, with the <img> in
      // front of it and an onerror that swaps them. A URL that 404s is not a
      // rare case here: not every speaker is Music Assistant, and the non-MA
      // ones can hand back a picture path that does not resolve, which would
      // draw the browser's broken-image icon on the screensaver. There is no
      // way to test the URL before rendering, so the markup has to survive it
      // failing.
      var ph = document.createElement('div');
      ph.className = 'ph';
      ph.textContent = '♫';
      ph.style.display = pic ? 'none' : 'flex';
      if (pic) {
        var img = document.createElement('img');
        img.src = pic;
        img.alt = '';
        // ...AND A URL THAT NEVER ANSWERS AT ALL. `error` fires for a 404;
        // it does NOT fire for a host that accepts the connection and then
        // says nothing, which is what a wall tablet with no internet access
        // gets from anything off the LAN (see _artImage in hk-base.js).
        // Without the timeout the screensaver shows an empty corner for as
        // long as it is up -- the same silence, one card over.
        var fall = function () {
          img.style.display = 'none';
          ph.style.display = 'flex';
        };
        var pt = setTimeout(function () {
          if (!(img.complete && img.naturalWidth > 0)) { img.src = ''; fall(); }
        }, 6000);
        img.addEventListener('load', function () { clearTimeout(pt); });
        img.addEventListener('error', function () { clearTimeout(pt); fall(); });
        box.appendChild(img);
      }
      box.appendChild(ph);
      var txt = document.createElement('div');
      txt.className = 'txt';
      var t = document.createElement('div');
      t.className = 't';
      t.textContent = title;              // textContent, so no escaping to get wrong
      var ar = document.createElement('div');
      ar.className = 'a';
      ar.textContent = artist;
      txt.appendChild(t);
      txt.appendChild(ar);
      box.appendChild(txt);
      this._e.innerHTML = '';
      this._e.appendChild(box);
    }
  }

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
  // HOW A SELECTION BECOMES A PLAYER (the whole design, in three rules):
  //   1. selection == a preset's set  -> that preset's player, which is a
  //      REAL MUSIC ASSISTANT SYNC GROUP. Presets such as Everywhere and
  //      Downstairs keep using MA's own saved sync, which is the best sync
  //      available.
  //   2. selection == exactly one speaker -> that speaker.
  //   3. anything else (an ad-hoc subset of 2+) -> a temporary join of
  //      those speakers.
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
      // A preset's own entity (its availability dims the pill) and each
      // context's artwork and artist (drawn in the context row) are inputs
      // too; neither moves a room's state.
      var presets = this._presets().map(function (p) {
        var s3 = p.entity && h.states[p.entity];
        return s3 ? s3.state : '-';
      }).join(',');
      var ctx = this._contexts().map(function (c) {
        return (c.image || '') + '~' + (c.artist || '');
      }).join(',');
      return r.player + ':' + r.reason + '|' + (src || '-') + '|' +
             (st ? st.state : '-') + '|' + rooms + '|' + presets + '|' + ctx +
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
    // player at the top of the page is actually coming out of. For a preset
    // that is the preset's own rooms, because a Music Assistant sync group
    // reports `group_members: []` on the group entity while its ROOMS report
    // all of its members. For a room it is that room plus whatever is
    // joined to it.
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
    // A context whose rooms are exactly a preset's rooms IS that preset, and
    // must be named and selected as one: `Downstairs` resolves to a real MA
    // sync group, and pointing the selector at `Kitchen` because kitchen
    // happens to be group_members[0] would silently downgrade it to an ad-hoc
    // join.
    //
    // Otherwise the leader's own option, which every room has -- which is why
    // this feature needs no second selector entity at all.
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

    // The three rules from the header. Returns the PLAYER for rules 1 and 2
    // -- a preset's sync group, or the one room -- or null for rule 3, which
    // needs the join path.
    _target() {
      var ps = this._presets();
      for (var i = 0; i < ps.length; i++) if (this._same(ps[i].entities)) return ps[i].entity || null;
      if (this._sel.size === 1) {
        var only = Array.from(this._sel)[0];
        var s = this._speakers().filter(function (x) { return x.entity === only; })[0];
        if (s) return s.entity;
      }
      return null;
    }

    // THE DESTINATION, as a list with the leader first. One shape for all
    // three rules, which is what lets hk_frontend.music_transfer have one path:
    //   preset      -> [its sync group entity]
    //   one speaker -> [that speaker]
    //   ad-hoc 2+   -> [leader, other, ...]
    // A preset's group entity comes from the configured presets
    // (`presets[].entity`): its `entities` are the MEMBERS, and transferring to
    // five rooms one at a time is not what "Everywhere" means -- MA's own sync
    // group is the better player and the whole point of rule 1.
    _targets() {
      var ps = this._presets();
      for (var i = 0; i < ps.length; i++) {
        if (this._same(ps[i].entities)) return ps[i].entity ? [ps[i].entity] : null;
      }
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
    // Read off _targets(), NOT off _sel, because _targets is what the script
    // receives and the script makes the same decision from the same list. For
    // a preset those differ on purpose -- _sel holds the member rooms while
    // _targets is the single sync-group player -- so testing _sel here would
    // label a preset "Add" while the script performed a move.
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
      var gm = ((st.attributes || {}).group_members || []).slice().sort();
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
      // whether it is a preset's sync group, one room or a join.
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
      // ONE CALL. Which of the three rules this selection is -- a preset's
      // sync group, one room, or a new join -- and everything each needs
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
          if (!p.entity || !self._available(p.entity) ||
              !list.length || !list.every(function (e) { return self._available(e); })) {
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

  // Listed in the card picker, with an editor, so it can be placed without
  // hand-written YAML.
  register('hk-speaker-picker-card', HkSpeakerPickerCard, 'HK Speaker Picker',
    'Choose one or more speakers, then tap a playlist to play it on them. The speakers, presets and playlists are set up in HK Settings → Features → Music.',
    C && [
      { name: 'browse_url', label: 'Browse page',
        helper: 'Where the Browse Music pill goes, e.g. ./music-browse on ' + window.hkShell.productName() + '\'s own screens. Empty: no pill. Speakers, presets and playlists are set up in HK Settings → Features → Music.',
        selector: { text: {} } }
    ],
    // NO browse_url IN THE STUB: ./music-browse is a page only HK Frontend's
    // generated screens have, so on a dashboard of your own the pill would
    // lead nowhere. Without it there is no pill; the option stays.
    function () { return {}; });

  register('hk-now-playing-card', HkNowPlayingCard, 'HK Now Playing',
    'Artwork, track and controls for the music this screen is showing.',
    C && [
      { name: 'hide_idle', label: 'Hide When Idle',
        helper: 'Draws nothing while nothing is playing or paused.',
        selector: { boolean: {} } },
      { name: 'tall', label: 'Tall layout',
        helper: 'Stacks artwork, track and controls in one column, for a narrow column or a phone.',
        selector: { boolean: {} } },
      C.section('Controls', [
        { name: 'meta_card', label: 'Controls Card',
          helper: 'Drawn under the track, as YAML: usually HK Media Controls following the screen\'s music, with the progress bar and volume (just the volume in the tall layout).',
          selector: { object: {} } },
        { name: 'sub_card', label: 'Progress Card',
          helper: 'Tall layout only: drawn between the track and the buttons, as YAML. Usually HK Media Controls with just the progress bar.',
          selector: { object: {} } }
      ], 'mdi:play-pause')
    ],
    // A CARD FROM THE PICKER HAS CONTROLS: the progress bar and volume, as an
    // HK Media Controls card following the screen's music -- what the Play
    // Music page and the docked bar draw (hk-strategy.js mediaBar), in the one
    // slot the default (wide) layout has. `sub_card` has no place in the wide
    // grid (it is the tall layout's and the bar's), so the stub does not use
    // it. No `music: true`: the player always follows the screen's music
    // (hkMusic) and never read it.
    function () {
      return { meta_card: { type: 'custom:hk-media-control-card', color: 'purple', bare: true,
                            parts: ['progress', 'volume'], entity_from: { music: true } } };
    });

  register('hk-screensaver-now-card', HkScreensaverNowCard,
    'HK Screensaver Now Playing',
    'Shows the track playing on any of the listed speakers, for a screensaver.',
    C && [{ name: 'music', label: 'The integration\'s speakers',
            helper: 'Follow the speakers set up for Music, presets first.',
            selector: { boolean: {} } },
          { name: 'players', helper: 'Instead of the above: these players, in priority order (groups first).',
            selector: { entity: { multiple: true, filter: { domain: 'media_player' } } } }],
    function () { return { music: true }; });
  // the screensaver's own (hk-saver.js): not offered in the card picker
  if (C && C.unlisted) C.unlisted('hk-screensaver-now-card');

  // ---------------------------------------------------------------------
  // hk-browse-card -- Music Assistant's own web UI, inside a dashboard page.
  //
  // WHY A CARD AND NOT A PAGE. A standalone page holding one iframe and a
  // "Close" button that calls window.close() does not work, for two reasons:
  //
  //   1. window.close() CANNOT CLOSE A PAGE THE SCRIPT DID NOT OPEN. A page
  //      reached by in-place navigation (`location.href = ...`) is not one,
  //      so Close does nothing at all, and on a kiosk tablet with no browser
  //      chrome there is no way back.
  //   2. It is outside the dashboard: no back chevron, no theme, no sky, and
  //      a full page load to reach it.
  //
  // As a subview it gets the same back chevron as every other page, which
  // cannot strand anybody, and the whole class of problem disappears.
  //
  // THE URL IS DERIVED, NOT HARDCODED. A literal
  // `http://<music-assistant-host>:8095` only works from that one address.
  // Music Assistant runs on the same host as Home Assistant on a different
  // port, so the host comes from wherever this page was served and only the
  // port is configuration. Any tablet reaching HA by any name or address
  // reaches MA the same way.
  //
  // MIXED CONTENT IS SAID OUT LOUD. MA serves plain HTTP. An HTTP frame inside
  // an HTTPS page is blocked by the browser with no visible error -- the
  // symptom is an empty rectangle, which looks like a broken flow but is
  // not. (Browse Music itself is hk-library-card, which has no frame.) So
  // rather than a blank frame, an HTTPS visitor is told what is happening
  // and given the direct link.
  class HkBrowseCard extends HkBase {
    setConfig(config) {
      this._config = Object.assign({ port: 8095, path: '/#/home' }, config || {});
      super.setConfig(this._config);
    }
    getCardSize() { return 12; }
    // Nothing here follows entity state; the frame owns itself once built.
    _sigOf() { return 'static'; }

    // ONE definition of the URL, exposed so the tests can drive it without a
    // browser. `host` is an escape hatch for the case where MA is genuinely
    // not on the same machine as HA; unset, it follows whatever address this
    // page was reached on, which is the whole point.
    _host(loc) { return this._config.host || (loc || location).hostname; }
    // SAME ORIGIN WHEN THE HOST SERVES IT. A host that serves Music
    // Assistant's web app under its own address (Mantel: /ma/, behind its
    // sign-in) says so through the shell; the frame is then same-origin --
    // https on an https page -- and nothing below about ports or mixed
    // content applies. An explicit `host` still wins (MA elsewhere). Only a
    // path on this origin is taken, never another site.
    _service() {
      if (this._config.host) return null;
      var S = window.hkShell;
      var u = S && typeof S.serviceUrl === 'function' ? S.serviceUrl('music_assistant') : null;
      return typeof u === 'string' && u.charAt(0) === '/' && u.charAt(1) !== '/' ? u : null;
    }
    _target(loc) {
      var svc = this._service();
      if (svc) return svc.replace(/\/+$/, '') + '/' + String(this._config.path || '').replace(/^\/+/, '');
      return (loc || location).protocol + '//' + this._host(loc) +
             ':' + this._config.port + this._config.path;
    }
    _direct(loc) {
      // http:// explicitly: the point is that MA is not on https.
      return 'http://' + this._host(loc) + ':' + this._config.port + this._config.path;
    }
    _blocked(loc) {
      // Only https-over-http is blocked. http pages -- every wall tablet --
      // frame http happily, and a same-origin frame (_service) never is.
      if (this._service()) return false;
      return (loc || location).protocol === 'https:';
    }

    _render() {
      if (this._built) return;
      this._built = true;
      var cfg = this._config;

      // A REBUILD REPLACES THE LAST BUILD. HkBase.setConfig clears _built so
      // a re-configured card rebuilds (the editor preview re-configures the
      // same element on every edit), and building on top of the previous one
      // would add one more iframe -- one more copy of Music Assistant's
      // whole web app -- and one more window resize listener per setConfig,
      // none of them ever released. The previous build's fit ramp stops too,
      // or its late steps would refit a frame now given an explicit height.
      (this._ramp || []).forEach(function (t) { clearTimeout(t); });
      this._ramp = null;
      this._unlisten();
      this._root.innerHTML = '';
      this._frame = null;

      if (this._blocked()) {
        var direct = this._direct();
        this._root.innerHTML =
          '<style>.hkb{display:flex;align-items:center;justify-content:center;' +
          'height:' + (cfg.height || '70vh') + ';padding:0 32px;text-align:center}' +
          '.hkb .in{max-width:520px;color:var(--hk-text,' + window.hkCards.v('ink') + ');font:400 16px/1.5 system-ui}' +
          '.hkb h3{font:600 20px/1.3 system-ui;margin:0 0 10px}' +
          '.hkb a{color:var(--hk-accent,#2f95dc)}</style>' +
          '<div class="hkb"><div class="in"><h3>Music Assistant is on your local network</h3>' +
          '<p>Its web player is served over plain HTTP, which this page cannot embed ' +
          'because you are connected over HTTPS. Everything else on this page works ' +
          'normally.</p><p><a href="' + esc(direct) + '" target="_blank" ' +
          'rel="noopener">Open Music Assistant directly</a></p></div></div>';
        return;
      }

      var f = document.createElement('iframe');
      f.src = this._target();
      f.setAttribute('allow', 'autoplay');
      f.style.cssText = 'width:100%;border:0;border-radius:' +
                        (cfg.radius || '18px') + ';display:block;background:#000';
      this._root.appendChild(f);
      this._frame = f;

      if (cfg.height) {
        f.style.height = cfg.height;      // an explicit height always wins
      } else {
        var self = this;
        // A BOUNDED RAMP, AND DELIBERATELY NOT A ResizeObserver.
        //
        // The frame has to be re-fitted after the page settles because Home
        // Assistant and the nested custom grids do not finish layout in one
        // turn; fitting once can leave the bottom gap several pixels out.
        //
        // An observer on this element is the obvious answer and it is WRONG:
        // setting the frame's height resizes the card, which fires the
        // observer, which fits again. Measured on a live page, that loop
        // settles at a 150px frame in a 657px viewport. Whatever the exact
        // path, sizing an element from a signal that its own size produces is
        // not stable, and no amount of guarding makes it so.
        //
        // So: fit a handful of times across the window in which a view is
        // still settling, then stop. The thing being waited for has no event.
        this._ramp = [0, 60, 200, 600, 1200].map(function (ms) {
          return setTimeout(function () { self._fit(); }, ms);
        });
        // Rotation and browser chrome appearing are real viewport changes and
        // do need handling; those have an event.
        this._onResize = function () { self._fit(); };
        window.addEventListener('resize', this._onResize);
      }
    }

    // FILL WHAT IS LEFT, WITH THE BOTTOM GAP EQUAL TO THE SIDE GAPS.
    //
    // A fixed `height: 78vh` is a guess that cannot work: the space above the
    // frame is the back chevron and the page heading, and that is a
    // different height on a kiosk tablet (no HA header) than on a desktop
    // dashboard (header present) -- so any single vh number is short on one
    // and overflows the other.
    //
    // So it is measured instead. The card's own left edge IS the side gutter
    // the page grid produced (2% / 96% / 2%, plus layout-card's 4px per nesting
    // level), so using it as the bottom margin makes all three equal by
    // construction rather than by a number someone tuned once at one size.
    _fit() {
      var f = this._frame;
      if (!f || !this.isConnected) return;
      var r = this.getBoundingClientRect();
      var gutter = Math.max(0, Math.round(r.left));
      // NOT minus the child's bottom margin. layout-card does put
      // `margin: 4px 4px 8px` on every grid child, and subtracting that 8px
      // looks right and measures wrong -- the gap goes to 42 against 34 at the
      // sides. The margin is part of the space being left below the frame, not
      // space taken from it. (A 9px discrepancy mid-layout is the ramp: the
      // card sits at top 101 mid-layout and 92 once settled.)
      var h = Math.round(window.innerHeight - r.top - gutter);
      // A floor, so a card measured mid-layout -- or one somewhere unexpected,
      // like a narrow editor preview -- never collapses to nothing.
      if (h < 200) h = 200;
      if (f.style.height !== h + 'px') f.style.height = h + 'px';
    }

    // A CACHED VIEW COMING BACK attaches the card again without building it
    // (_render returns once built), so the resize listener taken off on the
    // way out is put back here, and the frame fitted to the page as it is now
    // -- on the next frame, once the view it came back in has its layout.
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this._built && this._frame && !this._onResize) {
        var self = this;
        this._onResize = function () { self._fit(); };
        window.addEventListener('resize', this._onResize);
        requestAnimationFrame(function () { self._fit(); });
      }
    }

    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      this._unlisten();
    }

    _unlisten() {
      if (this._onResize) {
        window.removeEventListener('resize', this._onResize);
        this._onResize = null;
      }
    }
  }

  register('hk-browse-card', HkBrowseCard, 'HK Browse Music',
    'Music Assistant\'s web player, framed inside a dashboard page.',
    C && [
      { name: 'port', selector: { number: { min: 1, max: 65535, mode: 'box' } } },
      { name: 'path', selector: { text: {} } },
      { name: 'height', selector: { text: {} } }
    ],
    function () { return { port: 8095, path: '/#/home' }; });

  window.hkMedia = { version: '1.0.0' };
  });
})();
