// hk-media-now.js - the player (Now Playing) and its stacked geometry, speaker panel CSS and music-page address.
//
// PART OF THE MUSIC AND MEDIA CARDS (hk-media.js). Not a card and not run on its own: it registers one
// function, which hk-media.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkMediaParts = window.hkMediaParts || {})['hk-media-now'] = function (K) {
    var drawNoMusic = K.drawNoMusic, feed = K.feed, HkBase = K.HkBase, musicMissing = K.musicMissing;

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
    // A HOME GRID BLOCK'S CONTENT BOX: its insets (hkCards.blockPad's, the
    // grid cell's --hk-pad-*) off the block's own width and height, for a
    // cover sized by the block
    var NP_PAD = { t: 'var(--hk-pad-t,20px)', r: 'var(--hk-pad-r,22px)', b: 'var(--hk-pad-b,20px)', l: 'var(--hk-pad-l,22px)' };
    var NP_W = '(100cqw - ' + NP_PAD.l + ' - ' + NP_PAD.r + ')', NP_H = '(100cqh - ' + NP_PAD.t + ' - ' + NP_PAD.b + ')';
    // the screensaver's Browse glyph (mdi library-music)
    var LIB = 'M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 5h-3v5.5a2.5 2.5 0 1 1-1-2V5h4v2z';
    // THE MUSIC PAGE (hk-music.js): its two addresses
    function onMusicPage() {
      var seg = String(location.pathname).split('/')[2] || '';
      return seg === 'playmusic' || seg === 'music-browse';
    }
    class HkNowPlayingCard extends HkBase {
      // (a block's tap, hk-base.js openTarget) the Now Playing page, else the playing speaker's sheet
      _tapTarget() { var p = this.client ? this._res().player : null; return [{ page: 'playmusic' }, p && { sheet: p }]; }
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
          // (a Home Grid block's label over the song: no area anywhere else)
          '.np .lab{display:none}',
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
          // cqw / cqh are the block's; NP_W / NP_H its content box). Music's
          // widgets (2026-10-31, the mock-up the owner approved: "Small new
          // (cover with Speakers beside it, song, controls). Tall: controls up
          // off the bottom edge. Speakers and Browse either side of the
          // controls; volume under them on W, T, L"). Every control a 44 px
          // target but Tall's row, where five share 160 px.
          //   S  the cover with Speakers beside it, the song, back / play /
          //      next along the foot (no room for the volume: its Speakers
          //      opens the panel's Volume)
          //   W  the cover beside the song, the transport with Speakers and
          //      Browse at its ends, the volume under it
          //   T  the cover on top, a label, the song, the progress, the
          //      transport, the volume -- the transport up off the foot
          //   L  the cover beside a label and the song, then the progress, the
          //      transport and the volume across, as Apple Music has them
          // On a tile cell (196 x 150, @container hk-cell) a size keeps its
          // order and loses a line: the artist on S and W, the label on T.
          ':host([size]) hk-plate.np{--hk-np-height:100%;--hk-np-pad:' + window.hkCards.blockPad(window.hkCards.CARD.pad) + ';border-radius:var(--hk-block-radius, ' + window.hkCards.M.radius + ');',
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
          ':host([size]) .np .bg,:host([size]) .np .shade{overflow:hidden;border-radius:var(--hk-block-radius, ' + window.hkCards.M.radius + ')}',
          ':host([size]) .np .shade{background:linear-gradient(100deg,rgba(8,9,12,.58) 0%,rgba(8,9,12,.38) 55%,rgba(8,9,12,.28) 100%)}',
          ':host([size]) .np .title{' + window.hkCards.typeCss('headline') + ';letter-spacing:0;line-height:22px;align-self:end}',
          ':host([size]) .np .artist{' + window.hkCards.typeCss('body') + ';line-height:19px;letter-spacing:0}',
          ':host([size]) .np .player{display:none}',
          // THE LABEL over the song (the widget's "NOW PLAYING"), on T and L
          // (z-index: over the wash, as every row of the player)
          ':host([size=T]) .np .lab,:host([size=L]) .np .lab{display:block;grid-area:lab;z-index:2;' + window.hkCards.typeCss('label') + ';line-height:16px;',
          '  color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;align-self:end;min-width:0}',
          // THE VOLUME under the transport on W, T and L: the slider in a 44 px
          // place for a finger, a small and a large speaker either side (the
          // pane's mini player's, 2026-10-31)
          ':host([size=W]) .np .meta,:host([size=T]) .np .meta,:host([size=L]) .np .meta{display:flex;align-items:center;gap:10px;padding:0;--hk-range-h:44px}',
          ':host([size]) .np .meta > :not(.vg){flex:1 1 auto;min-width:0;order:1}',
          ':host([size]) .np .vg{flex:none;width:14px;height:14px;--mdc-icon-size:14px;color:rgba(255,255,255,.75)}',
          ':host([size]) .np .vg.hi{order:2;width:20px;height:20px;--mdc-icon-size:20px}',
          // (T: Speakers and Browse stand at the volume's ends, its own speakers left out)
          ':host([size=T]) .np .vg{display:none}',
          ':host([size]) .np .tb{width:44px;height:44px;margin:0;align-self:center;justify-self:center;position:relative}',
          ':host([size]) .np .tb hk-icon{width:26px;height:26px;--mdc-icon-size:26px}',
          ':host([size]) .np .play hk-icon{width:34px;height:34px;--mdc-icon-size:34px}',
          // SPEAKERS AND BROWSE (2026-10-27): either side of the transport, as on
          // the screensaver's pane, each on a quiet round well (Music's widget,
          // 2026-10-31); each turns the card over (_turn)
          ':host([size]) .np .spk,:host([size]) .np .brw{display:flex;grid-area:spk;color:#fff}',
          ':host([size]) .np .brw{grid-area:brw}',
          ':host([size]) .np .spk::before,:host([size]) .np .brw::before{content:"";position:absolute;left:50%;top:50%;width:var(--np-well,34px);height:var(--np-well,34px);',
          '  border-radius:50%;background:rgba(255,255,255,.16);transform:translate(-50%,-50%)}',
          ':host([size]) .np .spk hk-icon,:host([size]) .np .brw svg{position:relative}',
          ':host([size]) .np .spk hk-icon{width:20px;height:20px;--mdc-icon-size:20px;color:#fff}',
          ':host([size]) .np .brw svg{width:19px;height:19px}',
          // (nothing plays: no rooms to move -- Browse still starts something)
          ':host([size]) .np .spk.dis{opacity:.35;pointer-events:none}',
          // S: the cover in the corner, Speakers in the other; the song; back,
          // play and next along the foot, their glyphs on the inset's edges
          // (each 44 px target reaching into the inset)
          ':host([size=S]) hk-plate.np{--np-art:min(64px, ' + NP_H + ' - 96px);',
          '  --hk-np-cols:44px minmax(0,1fr) 44px minmax(0,1fr) 44px;',
          '  --hk-np-areas:"art art . . spk" "title title title title title" "artist artist artist artist artist" ". . . . ." "prev . play . next";',
          '  --hk-np-rows:var(--np-art) min-content min-content minmax(0,1fr) 44px}',
          ':host([size=S]) .np .grid{column-gap:0;row-gap:0}',
          ':host([size=S]) .np .art{align-self:start}',
          ':host([size=S]) .np .title{padding-top:8px;align-self:start}',
          ':host([size=S]) .np .brw{display:none}',
          ':host([size=S]) .np .spk{align-self:start;justify-self:end;margin:-5px -5px 0 0}',
          ':host([size=S]) .np .prev{justify-self:start;margin-left:-10px}:host([size=S]) .np .next{justify-self:end;margin-right:-10px}',
          ':host([size=S]) .np .tb hk-icon{width:24px;height:24px;--mdc-icon-size:24px}',
          ':host([size=S]) .np .play hk-icon{width:30px;height:30px;--mdc-icon-size:30px}',
          ':host([size=S]) .np .spk hk-icon{width:20px;height:20px;--mdc-icon-size:20px}',
          '@container hk-cell (max-height:179px){:host([size=S]) hk-plate.np{--np-art:min(64px, ' + NP_H + ' - 76px)}:host([size=S]) .np .artist{display:none}}',
          // W: the cover as tall as the block, or as wide as five 44 px controls
          // leave it; the song at its top, the transport and the volume at its
          // foot (the column as tall as the cover, centred in the block)
          ':host([size=W]) hk-plate.np{display:flex;flex-direction:column;justify-content:center;',
          '  --np-art:min(' + NP_H + ', ' + NP_W + ' - 236px);',
          '  --hk-np-cols:calc(var(--np-art) + 16px) repeat(5,minmax(0,1fr));',
          '  --hk-np-areas:"art title title title title title" "art artist artist artist artist artist" "art . . . . ." "art spk prev play next brw" "art meta meta meta meta meta";',
          '  --hk-np-rows:min-content min-content minmax(0,1fr) 44px var(--np-vol,44px)}',
          ':host([size=W]) .np .grid{column-gap:0;row-gap:0;height:var(--np-art)}',
          ':host([size=W]) .np .spk{justify-self:start;margin-left:-5px}:host([size=W]) .np .brw{justify-self:end;margin-right:-5px}',
          '@container hk-cell (max-height:179px){:host([size=W]) .np .artist{display:none}}',
          // T: the cover across the top; the transport up off the foot, the
          // volume under it between Speakers and Browse -- the Side Pane's
          // mini player's line (2026-10-31): five across left each 32 px, and
          // three keys over two at the volume's ends keep every one 44
          ':host([size=T]) hk-plate.np{--hk-np-pad:' + NP_PAD.t + ' ' + NP_PAD.r + ' calc(' + NP_PAD.b + ' + 6px) ' + NP_PAD.l + ';',
          '  --np-art:min(' + NP_W + ', ' + NP_H + ' - 212px);',
          '  --hk-np-cols:44px minmax(0,1fr) 44px minmax(0,1fr) 44px;',
          '  --hk-np-areas:"art art art art art" "lab lab lab lab lab" "title title title title title" "artist artist artist artist artist" ". . . . ." "sub sub sub sub sub" "prev . play . next" "spk meta meta meta brw";',
          '  --hk-np-rows:calc(var(--np-art) + 12px) min-content min-content min-content minmax(0,1fr) min-content 44px var(--np-vol,44px)}',
          ':host([size=T]) .np .grid{column-gap:0;row-gap:0}',
          ':host([size=T]) .np .art{justify-self:start;align-self:start}',
          ':host([size=T]) .np .tb{width:44px;--np-well:30px}',
          ':host([size=T]) .np .spk{justify-self:start}:host([size=T]) .np .brw{justify-self:end}',
          ':host([size=T]) .np .tb hk-icon{width:24px;height:24px;--mdc-icon-size:24px}',
          ':host([size=T]) .np .play hk-icon{width:30px;height:30px;--mdc-icon-size:30px}',
          ':host([size=T]) .np .spk hk-icon{width:18px;height:18px;--mdc-icon-size:18px}',
          ':host([size=T]) .np .brw svg{width:17px;height:17px}',
          ':host([size=T]) .np.tall .shade,:host([size=T]) .np .shade{background:linear-gradient(180deg,rgba(8,9,12,.10) 0%,rgba(8,9,12,.30) 45%,rgba(8,9,12,.74) 100%)}',
          '@container hk-cell (max-height:379px){:host([size=T]) hk-plate.np{--np-art:min(' + NP_W + ', ' + NP_H + ' - 190px)}:host([size=T]) .np .lab{display:none}}',
          // (L: the transport centred on the middle three tracks; the cover
          // spans the first two, so it is as wide as the gap beside them allows)
          ':host([size=L]) hk-plate.np{--np-art:min(100cqh - 40px - 166px, (100cqw - 44px - 248px) / 2 + 78px);',
          '  --hk-np-cols:minmax(0,1fr) 64px 64px 64px minmax(0,1fr);',
          '  --hk-np-areas:"art art . . ." "art art lab lab lab" "art art title title title" "art art artist artist artist" "art art . . ." "sub sub sub sub sub" "spk prev play next brw" "meta meta meta meta meta";',
          '  --hk-np-rows:minmax(0,1fr) min-content min-content min-content minmax(0,1fr) min-content 56px min-content}',
          ':host([size]) .np .sub{align-self:end}:host([size=L]) .np .sub{padding-top:12px}:host([size=T]) .np .sub{padding-top:6px}',
          ':host([size=L]) .np .lab{padding-bottom:2px}',
          ':host([size=L]) .np .title{' + window.hkCards.typeCss('title') + ';line-height:27px}',
          ':host([size=L]) .np .tb{width:56px;height:56px;--np-well:40px}',
          ':host([size=L]) .np .spk,:host([size=L]) .np .brw{width:48px}',
          ':host([size=L]) .np .tb hk-icon{width:32px;height:32px;--mdc-icon-size:32px}',
          ':host([size=L]) .np .play hk-icon{width:44px;height:44px;--mdc-icon-size:44px}',
          ':host([size=L]) .np .spk hk-icon{width:24px;height:24px;--mdc-icon-size:24px}',
          ':host([size=L]) .np .brw svg{width:23px;height:23px}',
          // IN A PAGER (hk-pager-card): its dots under the block's foot, so no
          // volume and no label
          ':host([size][data-grid-pager]) hk-plate.np{--hk-np-pad:20px 22px 44px;--np-vol:0px}',
          ':host([size][data-grid-pager]) .np .meta,:host([size][data-grid-pager]) .np .lab{display:none}',
          ':host([size=W][data-grid-pager]) hk-plate.np{--np-art:calc(100cqh - 64px);',
          '  --hk-np-areas:"art title title title title title" "art spk prev play next brw";--hk-np-rows:minmax(0,1fr) 46px}',
          ':host([size=W][data-grid-pager]) .np .artist{display:none}',
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
          // a Small block's Speakers sheet opens on the Volume tab: the whole group's slider first
          group: self.getAttribute('size') === 'S',
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
          var path = ev.composedPath ? ev.composedPath() : [], e = /** @type {any} */ (self._e || {});
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
        // (a virtual pair's two players are one room: hkMusic.fold)
        var g = M && M.fold ? M.fold(a.group_members || []) : (a.group_members || []);
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
        // A known speaker by its own name, not its entity's friendly_name.
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
            '<div class="lab" data-hk-role="lab"></div>' +
            // (a Home Grid block's volume: a small and a large speaker either
            // side of the slider, only there -- the page's tall layout shows
            // every child of `meta`)
            '<div class="meta" data-hk-role="meta">' + (this.hasAttribute('size')
              ? '<hk-icon class="vg lo" icon="mdi:volume-high"></hk-icon><hk-icon class="vg hi" icon="mdi:volume-high"></hk-icon>' : '') + '</div>' +
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
                      sub: q('.sub'), play: q('.play'), spk: q('.spk'), lab: q('.lab') };
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
            // -- a Small block's Speakers to the Volume, the one it has no
            // slider for (the mock-up, 2026-10-31)
            q('.spk').addEventListener('click', function () {
              if (self.hasAttribute('size')) self._turn(self.getAttribute('size') === 'S' ? 'volume' : 'speakers');
            });
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
        // (ITEM 46: through hkCards.artImg, so a cover that will not load is the
        // note and a flat backdrop, never the broken-image "?"; the guard is the card's)
        var AI = window.hkCards.artImg;
        var bg = pic ? AI(pic, { ph: 'bg', attrs: 'decoding="sync"' }) : '<div class="flat"></div>';
        window.hkCards.morph(e.bg, bg);
        var art = pic ? AI(pic, { ph: 'note', attrs: 'decoding="sync"' })
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
        // a block's label: what the music is doing (the widget's "Now Playing")
        var lb = !p ? 'Not Playing' : p.state === 'playing' ? 'Now Playing' : p.state === 'paused' ? 'Paused' : 'Not Playing';
        if (e.lab && e.lab.textContent !== lb) e.lab.textContent = lb;
        // feed(), not a plain bridge: the nested card may not be upgraded yet.
        if (this._metaCard && this.client) feed(this._metaCard, this.client);
        if (this._subCard && this.client) feed(this._subCard, this.client);
      }
    }

    // what the shell and the later parts use of this one
    K.HkNowPlayingCard = HkNowPlayingCard;
  };
})();
