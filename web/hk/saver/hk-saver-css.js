// hk-saver-css.js - the saver's CSS.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-css'] = function (K) {
    var BAND_MAX = K.BAND_MAX, BAND_PAD = K.BAND_PAD, BAND_ZONE = K.BAND_ZONE, CROSSFADE_MS = K.CROSSFADE_MS,
        DEFAULT_CARD_WIDTH = K.DEFAULT_CARD_WIDTH, MU_ART_MS = K.MU_ART_MS, PANE_TOP = K.PANE_TOP, PANE_W = K.PANE_W,
        ZOOM = K.ZOOM;

    // ------------------------------------------------------------ the element
    var CSS = [
      ':host{position:fixed;inset:0;z-index:2147483000;display:block;background:#000;opacity:0;',
      '  transition:opacity var(--fade,3000ms) ease;touch-action:none;user-select:none;-webkit-user-select:none;',
      '  -webkit-tap-highlight-color:transparent;cursor:none;contain:strict;',
      // THE DASHBOARD'S FONT (SF Pro under HK Kiosk). This element hangs off
      // <body>, outside the view its theme is put on, so it does not inherit
      // it: it fell back to Roboto, whose weight-200 forecast numeral looks
      // squeezed beside the Weather page's. build() copies the view's font
      // onto --hk-saver-font; the house's (hk-base.js --hk-font-body) is the
      // fallback -- and the cards in it read it too.
      '  --ha-font-family-body:var(--hk-saver-font,var(--hk-font-body));',
      '  font-family:var(--hk-saver-font,var(--hk-font-body))}',
      ':host([on]){opacity:1}',
      // GETTING READY (2026-10-09): barely there -- too faint to see, but drawn,
      // so the first photo's layer is rastered before the fade shows it. From
      // opacity 0 the tablets' WebView rastered it during the fade, and the
      // host's black showed through the tiles not yet drawn: a black block over
      // the incoming photo (screen-recorded on the Living Room tablet).
      ':host([prep]){opacity:.004}',
      // PLAIN BLACK ([dark]): under the kiosk's Black screensaver (goDark), or
      // woken from a frozen page (stop) -- the photos, the forecast and the
      // clock out of sight, so the frame the tablet keeps is black and the
      // dashboard draws underneath before the fade away to it. [undark]: drawn
      // again under .blk's black, which then fades off them (lightSoon)
      ':host([dark]:not([undark])) .ph,:host([dark]:not([undark])) .fc,:host([dark]:not([undark])) .fcb,',
      ':host([dark]:not([undark])) .info,:host([dark]:not([undark])) .pane,:host([dark]:not([undark])) .mpanel{visibility:hidden}',
      // THE PANE TURNED OVER (the music's panel on its back): Home Status and
      // the timers in it are its front's
      '.info > hk-screensaver-status-card,.info > hk-timer-strip-card{transition:opacity .15s ease}',
      ':host([mpp]) .info > hk-screensaver-status-card,:host([mpp]) .info > hk-timer-strip-card{opacity:0}',
      ':host([mpkb]) .info,:host([mpkb]) .mu .mcol{visibility:hidden}',
      '.blk{position:absolute;inset:0;z-index:9;background:#000;opacity:0;pointer-events:none;transition:opacity var(--blk,0ms) ease}',
      ':host([dark]) .blk{opacity:1}',
      // waking: the dashboard drawing underneath (WAKE)
      ':host([on][waking]){opacity:.99}',
      // after a touch stop the element stays, invisible, to swallow taps (its
      // black kept: it is set as the fade back starts, over a dark screen)
      ':host([blocking]){cursor:default}',
      // EVERY PHOTO LAYER IS ITS OWN COMPOSITING LAYER, ALL THE TIME. Without
      // will-change a layer exists only while its opacity is animating: the
      // cross-fade created two and dropped them 3 s later (headless: 214 -> 216
      // -> 214 layers at every photo), and each of those made the tablets'
      // WebView re-raster what sits over the photos -- the flicker around each
      // change that WallPanel had too (fixed there 2026-09-15 the same way).
      '.ph{position:absolute;inset:0;z-index:0;opacity:0;transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
      '.ph.top{opacity:1}',
      // the images paint INTO their layer: an <img> with a layer of its own
      // loses it whenever its src is let go after a fade, which is the same
      // churn one level down (headless, 2026-09-30). Only Slow Zoom, which
      // animates the image, gives it one.
      '.ph img{position:absolute;inset:0;width:100%;height:100%;display:block}',
      ':host([zoom]) .ph img.fg{will-change:transform}',
      // THE BLURRED COPY BEHIND A PORTRAIT PHOTO: drawn once into a small canvas
      // (drawBackdrop) and scaled up -- the look of the old 40 px blur of the
      // whole photo, at a sliver of the cost to raster (2026-10-09)
      '.ph canvas.bg{position:absolute;left:-7.5%;top:-7.5%;width:115%;height:115%;display:block;filter:brightness(var(--bgdim,.8))}',
      '.ph canvas.bg[hidden]{display:none}',
      // the mosaic's cells (paintMosaic): canvases at the cells' own size
      '.ph.mo img.fg,.ph.mo canvas.bg{display:none}',
      '.ph .mowrap{position:absolute;inset:0;box-sizing:border-box}',
      '.ph[pw] .mowrap{right:var(--hk-pane-w,0px)}',
      '.ph .mocell{position:absolute;overflow:hidden;background:#0b0b0d}',
      '.ph .mowrap.round .mocell{border-radius:16px}',
      '.ph .mocell canvas{position:absolute;inset:0;width:100%;height:100%;display:block;transition:opacity ' + CROSSFADE_MS + 'ms ease}',
      '.ph.mo.zoom .mocell canvas{animation:hk-saver-zoom var(--zd,33s) linear forwards}',
      '.ph img.fg{object-fit:var(--fit,cover);object-position:var(--pos,50% 50%);transform-origin:var(--org,var(--pos,50% 50%));scale:var(--zm,1)}',
      '.ph.zoom img.fg{animation:hk-saver-zoom var(--zd,33s) linear forwards}',
      // THE PHOTOS' SCRIM, under the forecast details over them (band_photos):
      // black, toward the bottom, chosen on the tablet 2026-10-04. Painted into
      // each photo's own layer, so it fades with its photo and is covered by
      // the forecast slide like the photo is -- never a gradient that jumps.
      '.phscrim{position:absolute;left:0;right:0;bottom:0;height:58%;pointer-events:none;opacity:0;',
      '  transition:opacity ' + CROSSFADE_MS + 'ms ease;',
      '  background:linear-gradient(to bottom,rgba(0,0,0,0) 0%,rgba(0,0,0,.28) 35%,rgba(0,0,0,.55) 75%,rgba(0,0,0,.62) 100%)}',
      // ...ONLY FOR THE DETAILS OVER THE PHOTOS ([bandph]: band_photos), not
      // whenever they show: it went dark and light again under every forecast
      // slide, a layer made for the fade and dropped as the slide finished,
      // and the tablet drew what was round it again -- the days flickered just
      // after the forecast came in (2026-10-10). Over the forecast the details
      // have their own scrim (.fcscrim).
      ':host([bandph]) .phscrim{opacity:1}',
      '.ph[pw] .phscrim{right:var(--hk-pane-w,0px)}',
      '@keyframes hk-saver-zoom{from{transform:scale(1)}to{transform:scale(' + ZOOM + ')}}',
      // THE INFO BOX: where WallPanel put the cards, and how it dressed them,
      // measured on the tablets -- top-left, 600 px, bold white on the photo
      // with a deep shadow, everything aligned to the left edge. The now-playing
      // and timer cards pin themselves to their corners (position:fixed);
      // nothing here may transform or filter, or "fixed" would mean "in here".
      // THE CLOCK (Show: Clock, or Large): under the corner cards; clear of
      // the forecast's details and the side pane; gone under the music
      '.ck{position:absolute;inset:0;z-index:3;pointer-events:none;transition:opacity ' + CROSSFADE_MS + 'ms ease}',
      ':host([band]) .ck{bottom:var(--hk-ss-corner-bottom,0px)}',
      ':host([pane]) .ck{right:var(--hk-pane-w,' + PANE_W + 'px)}',
      ':host([muslide]) .ck{opacity:0}',
      // HOME ENERGY over a clock (the energy layer is opaque over a clock's own
      // background, so that clock stays), and the forecast as an additional
      // screen: the clock fades off it
      ':host([enslide]:not([ckgen])) .ck,:host([wxslide]:not([ckgen])) .ck,:host([hlslide]:not([ckgen])) .ck,:host([tmslide]:not([ckgen])) .ck,:host([ckmode][fcslide]) .ck{opacity:0}',
      // ...the forecast under a clock's own background, while it shows and
      // until the clock is back over it
      ':host([ckgen][fcslide]) .fc,:host([ckgen][fcout]) .fc{display:block}',
      // ...beside the pane; and what sits along the bottom steps aside for it
      ':host([pane]) .en,:host([pane]) .wx,:host([pane]) .hl{right:var(--hk-pane-w,' + PANE_W + 'px)}',
      ':host([enslide]) .info > hk-screensaver-now-card,:host([enslide]) .info > hk-timer-strip-card,',
      ':host([wxslide]) .info > hk-screensaver-now-card,:host([wxslide]) .info > hk-timer-strip-card,',
      ':host([hlslide]) .info > hk-screensaver-now-card,:host([hlslide]) .info > hk-timer-strip-card{opacity:0}',
      ':host([tmslide]) .info > hk-screensaver-now-card,:host([tmslide]) .info > hk-timer-strip-card{opacity:0}',
      // ...and the corner clock and weather: Home Energy tells the time itself,
      // smaller, so its rings keep their size (the user, 2026-10-14)
      // ...on a layer of its own for good, as the weather line's and what
      // plays: the fade alone made it one only while fading (2026-10-19)
      '.info > hk-clock-card{transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
      ':host([enslide]) .info > hk-clock-card,:host([enslide]) .info > hk-weather-strip-card,',
      ':host([wxslide]) .info > hk-clock-card,:host([wxslide]) .info > hk-weather-strip-card,',
      ':host([hlslide]) .info > hk-clock-card,:host([hlslide]) .info > hk-weather-strip-card{opacity:0}',
      ':host([tmslide]) .info > hk-clock-card,:host([tmslide]) .info > hk-weather-strip-card{opacity:0}',
      // ...and the corner clock tells the time in its place (Show: Clock or a
      // Large clock with Music First: the slide covered every clock there)
      '.info > [muonly]{display:none}',
      ':host([muslide]) .info > [muonly],:host([ckmode][fcslide]) .info > [muonly]{display:block;animation:hk-saver-muonly ' + CROSSFADE_MS + 'ms ease both}',
      '@keyframes hk-saver-muonly{from{opacity:0}to{opacity:1}}',
      ':host([ckgen]) .ph,:host([ckgen]) .fc{display:none}',
      // PHOTOS BEHIND THE CLOCK: the photos themselves (or, Soft, their
      // blurred copies), under a dark wash of their own Darken amount
      ':host([ckphotos][cksoft]) .ph img.fg{opacity:0}',
      ':host([ckphotos]) .ph::after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:rgba(0,0,0,var(--hk-ckdim,.35))}',
      // Today's own weather and music: the corners' step aside
      ':host([ckown]) .info hk-weather-strip-card,:host([ckown]) .info hk-screensaver-now-card{display:none}',
      // NIGHT MODE: nothing behind the clock; everything one dim red -- a
      // multiply wash over all of it (white becomes the red, black stays)
      ':host([cknight]) .ph,:host([cknight]) .fc,:host([cknight]) .fcb,:host([cknight]) .ck .ckbg,:host([cknight]) .ck .ckscrim,',
      ':host([cknight]) .ck .ckgrain,:host([cknight]) .ck .cklight{visibility:hidden}',
      '.nightwash{position:absolute;inset:0;z-index:8;pointer-events:none;background:#b3261e;mix-blend-mode:multiply;display:none}',
      ':host([cknight]) .nightwash{display:block}',
      '.info{position:absolute;z-index:4;left:0;top:0;width:var(--hk-saver-card-width,' + DEFAULT_CARD_WIDTH + 'px);',
      '  padding:31px 0 0 30px;box-sizing:content-box;text-align:left;display:flex;flex-direction:column;gap:9px;',
      '  --ha-card-background:none;--ha-card-box-shadow:none;--ha-card-border-width:0px;',
      '  --primary-text-color:#ffffff;--secondary-text-color:#dddddd;color:var(--hk-ink,rgba(255,255,255,0.94));',
      '  text-shadow:0px 2px 8px rgba(0,0,0,0.30),0px 6px 28px rgba(0,0,0,0.26),0px 12px 68px rgba(0,0,0,0.34);',
      '  --font-weight:bold;font-weight:bold;font-size:15px;letter-spacing:-0.23px;pointer-events:none}',
      '.info > *{display:block;flex:none}',
      // THE SLIDE CORNER (phase 13): one corner over every slide, the pieces' -- the screensaver's old corner cards step
      // aside under a slide, whatever the Show (the seven rules that hid them one slide at a time are its work now)
      '.scn{position:absolute;top:0;bottom:0;z-index:6;pointer-events:none;opacity:0;transition:opacity ' + CROSSFADE_MS + 'ms ease}',
      ':host([scorner]) .scn{opacity:1}',
      '.scn .scs{position:absolute;top:var(--m);display:flex;flex-direction:column;gap:var(--g)}',
      '.scn .scs.tl{left:var(--m);align-items:flex-start}.scn .scs.tr{right:var(--m);align-items:flex-end}',
      '.scn .scs > *{position:relative}',
      // (Big Weather as a slide tells the weather and the time on its own top line, on its 7.3-unit margin: what the corner
      // adds stands under them, on the same margin, where its own screen puts Home Status)
      // ...and while it fades out ([fcout]): the corner fades where it stood, never jumping to the photos' margin
      ':host([fcbig][fcslide]:not([pane])) .scn .scs,:host([fcbig][fcout]:not([pane])) .scn .scs{top:13.1vmin}',
      ':host([fcbig][fcslide]:not([pane])) .scn .scs.tl,:host([fcbig][fcout]:not([pane])) .scn .scs.tl{left:7.3vmin}',
      ':host([fcbig][fcslide]:not([pane])) .scn .scs.tr,:host([fcbig][fcout]:not([pane])) .scn .scs.tr{right:7.3vmin}',
      ':host([scorner]) .info > *:not([muonly]){opacity:0!important;transition:opacity ' + CROSSFADE_MS + 'ms ease}',
      // (with a layout the slide corner tells the time: the old corner clock kept for under the music never comes back
      // over it -- the forecast over a clock drew both, 2026-11-02)
      ':host([lay][scorner]) .info > [muonly]{display:none!important}',
      // THE LAYOUT (2026-11-01, the Screensaver editor's): its big element and widgets in .lay, under the corner cards;
      // the cards placed where its plan puts them (layoutDraw), whatever the Show's own rules said -- shown or not by
      // the plan alone ([lyhide]), and gone with the rest under a slide that covers them
      '.lay{position:absolute;inset:0;z-index:3;pointer-events:none;transition:opacity ' + CROSSFADE_MS + 'ms ease;--tint:var(--hk-ss-ink,rgba(255,255,255,.95))}',
      '.lay > *{position:absolute}',
      '.lay .lybig{color:var(--tint);white-space:nowrap;line-height:1;font-family:var(--hk-saver-font,-apple-system,system-ui,sans-serif);text-shadow:0 2px 24px rgba(0,0,0,.22)}',
      '.lay .lybig.measuring{visibility:hidden}',
      '.lay .lyland{background-repeat:no-repeat;pointer-events:none}',
      // (the subject's twin over the layout's face: laid out, faded and zoomed as its photo is -- layoutCut)
      '.lay .lycut{position:absolute;inset:0;opacity:0;transition:opacity ' + CROSSFADE_MS + 'ms ease;transform-origin:var(--org,var(--pos,50% 50%));scale:var(--zm,1);pointer-events:none}',
      '.lay .lycut.top{opacity:1}',
      '.lay .lycut img{transition:opacity ' + CROSSFADE_MS + 'ms ease}',
      '.lay .lycut.zoom{animation:hk-saver-zoom var(--zd,33s) linear forwards}',
      '.lay .lycut img{position:absolute;inset:0;width:100%;height:100%;object-fit:var(--fit,cover);object-position:var(--pos,50% 50%);',
      '  -webkit-mask-size:var(--fit,cover);mask-size:var(--fit,cover);-webkit-mask-position:var(--pos,50% 50%);mask-position:var(--pos,50% 50%);',
      '  -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;filter:brightness(calc(1 - var(--ph-dim,0)))}',
      '.lay .lycut[pw] img{width:calc(100% - var(--hk-pane-w,0px))}',
      ':host([ckphotos]) .lay .lycut img{filter:brightness(calc(1 - var(--hk-ckdim,.35)))}',
      '@media (prefers-reduced-motion:reduce){.lay .lycut.zoom{animation:none}}',
      // DARKEN IS THE PHOTOS' (phase 3): with a layout, the photos' wash at --ph-dim, whatever is in front of them
      ':host([lay][phdim]:not([ckphotos])) .ph::after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:rgba(0,0,0,var(--ph-dim,0))}',
      // UNDER A SLIDE ([lyoff], layoutSlides: the music, the forecast, the weather, Home Energy) the layout steps aside
      // altogether -- its big element, its widgets and its places for the cards -- and the corners are the screensaver's own,
      // as the slides were drawn for: the time, the date and the weather at the top left, Home Status at the top right
      // (2026-11-01, the owner's wall tablet: under the music the time was gone and the weather ran into Up Next)
      ':host([lay][lyoff]) .lay{opacity:0}',
      ':host([cklight]:not([cknight])) .lay{--tint:#1c1c1e}',
      // (Night Mode over a layout: its pieces and its time the night's dim ink, as the clock's own face goes)
      ':host([cknight]) .lay{--lay-ink:#9a9aa2 !important;--tint:#9a9aa2;filter:brightness(.7)}',
      // (Big Weather among the photos, or in their place, tells the time itself: the layout's big element and widgets
      // step aside while it shows, as they do for the music)
      ':host([lay][fcbig][fcslide]) .lay,:host([lay][fcbig][forecast]) .lay{opacity:0}',
      ':host([cklight]:not([cknight])) .lay .lybig{text-shadow:none}',
      ':host([lay]:not([lyoff])) .info,:host([lay][pside][pane]:not([lyoff])) .info{left:0;top:0;right:0;bottom:0;width:auto;padding:0;display:block}',
      ':host([lay]:not([lyoff])) .info > hk-clock-card,:host([lay]:not([lyoff])) .info > hk-weather-strip-card{position:absolute}',
      ':host([lay]:not([lyoff])) .info > *:not([lyhide]){display:block!important}',
      ':host([lay]:not([lyoff])) .info > [lyhide]{display:none!important}',
      // the forecast: no photo layers; the sky under everything; the band along
      // the bottom (the corner rows rise above it: --hk-ss-corner-bottom); the
      // band carries today's conditions, so the weather line leaves the clock
      ':host([forecast]) .ph{display:none}',
      // the forecast's own layer, over the photos: shown outright ([forecast]),
      // or faded in as one slide among the photos ([fcslide])
      // (opaque: the sky is drawn a moment after the layer is built, and no
      // photo may show through it meanwhile)
      '.fc{position:absolute;inset:0;z-index:0;opacity:0;visibility:hidden;pointer-events:none;will-change:opacity;background:#000;',
      '  transition:opacity ' + CROSSFADE_MS + 'ms ease}',
      '.fc.top{opacity:1;visibility:visible}',
      '.fsky{position:absolute;inset:0}',
      // the land under the band darkened toward the bottom: a sunlit meadow is
      // as bright as the band's text. Static (no blur), so it costs no frames.
      // (on the forecast only: the photos have their own, .phscrim; it comes
      // and goes with the forecast slide)
      // ...on a layer of its own for good (will-change), like every fading
      // layer here: only while fading, its layer was dropped as the slide
      // finished, and the band's layer it sits in was drawn again -- the days
      // flickered on a tablet just after the forecast came in (2026-10-10)
      '.fcscrim{position:absolute;left:0;right:0;bottom:0;height:48%;pointer-events:none;opacity:0;will-change:opacity;',
      '  transition:opacity ' + CROSSFADE_MS + 'ms ease;',
      '  background:linear-gradient(to bottom,rgba(6,10,18,0) 0%,rgba(6,10,18,.5) 30%,rgba(6,10,18,.66) 100%)}',
      ':host([forecast]) .fcscrim,:host([fcslide]) .fcscrim{opacity:1}',
      // column-reverse with auto margins: centred while it fits; a band
      // taller than the zone (a small screen) keeps to the bottom and grows up
      '.fcband{position:absolute;left:30px;right:30px;bottom:0;height:' + BAND_ZONE + ';box-sizing:border-box;',
      '  padding:' + BAND_PAD + 'px 0;display:flex;flex-direction:column-reverse;pointer-events:none}',
      '.fcband > *{margin:auto 0;flex:none;width:100%;max-width:' + BAND_MAX + 'px;align-self:center;',
      '  transform:translateX(var(--hk-band-shift,0px))}',
      // THE FORECAST DETAILS (the band: today, the hours, the days) on a layer
      // of their own, so they can show over the forecast OR the photos
      // (options band / band_photos); the weather line steps aside for them
      '.fcb{position:absolute;inset:0;z-index:3;opacity:0;pointer-events:none;will-change:opacity;',
      '  transition:opacity ' + CROSSFADE_MS + 'ms ease}',
      ':host([band]) .fcb{opacity:1}',
      // the band's glass never blurs what is behind it here: behind it the
      // photos and the forecast cross-fade, and a backdrop blur is redone on
      // every frame of that (the scrim gives the band its contrast instead)
      '.fcb{--hk-glass-backdrop:none}',
      // faded, not removed: with the band fading in and out over the same
      // time, removing it at once showed both (or neither) for 3 s
      // ...on a layer of its own for good: the fade alone made it one only
      // while fading (a layer made and dropped at every forecast slide)
      '.info > hk-weather-strip-card{transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
      // (...and under the music the details are covered: the corner tells the weather again)
      ':host([band]:not([muslide])) .info > hk-weather-strip-card{opacity:0}',
      // THE PANE ([pane]: the calendar, the music or both): the photo beside it, its own blurred copy
      // under the pane (the backdrop img, always shown), the forecast and its
      // details beside it too -- the sky held to its box, not the screen
      '.ph[pw] img.fg{width:calc(100% - var(--hk-pane-w,0px))}',
      '.ph[pw] canvas.bg[hidden]{display:block}',
      ':host([pane]) .fc,:host([pane]) .fcb{right:var(--hk-pane-w,0px)}',
      ':host([pane]) #hk-sky.own{position:absolute}',
      '.pane{position:absolute;z-index:4;top:0;right:0;bottom:0;width:var(--hk-pane-w,' + PANE_W + 'px);display:none;',
      // (a soft shadow off its left edge onto the photo: the pane sits a
      // little above it; drawn with the pane, it fades with it)
      '  border-left:1px solid rgba(255,255,255,0.10);background:linear-gradient(to bottom,rgba(8,12,22,0.30),rgba(8,12,22,0.60));',
      '  box-shadow:-18px 0 44px rgba(0,0,0,.42),-3px 0 12px rgba(0,0,0,.26);',
      '  color:var(--hk-ink,rgba(255,255,255,0.94));cursor:default}',
      // (there whenever a pane is asked for [panecfg]; up [pane] or not --
      // the music alone comes and goes with the music -- faded with a photo)
      ':host([panecfg]) .pane{display:block}',
      '.pane{opacity:0;transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
      ':host([pane]) .pane{opacity:1}',
      // the pane's music fades in and out with the music (its blurred art is
      // the whole pane's background beside the calendar too)
      ':host(:not([pm])) .pm{opacity:0;visibility:hidden}',
      // on the forecast it is the night sky's navy, faded in and out with it
      // (a layer of its own for good, like every fading layer here)
      '.pane::before{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(14,22,40,0.97),rgba(8,12,22,0.99));',
      '  opacity:0;transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
      ':host([forecast]) .pane::before,:host([fcslide]) .pane::before{opacity:1}',
      // the list between Home Status (above) and what plays and the timers
      // (its foot, below), each as tall as it is now (paneStack)
      '.pane .sc{position:absolute;z-index:1;left:0;right:0;top:var(--hk-pane-top,' + PANE_TOP + 'px);bottom:var(--hk-pane-bottom,0px);overflow-y:auto;overflow-x:hidden;',
      '  padding:0 var(--hk-pane-pad,28px);box-sizing:border-box;border-top:1px solid rgba(255,255,255,0.10);touch-action:pan-y;',
      '  overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;',
      '  -webkit-mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 90px),transparent 100%);',
      '  mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 90px),transparent 100%)}',
      '.pane .sc::-webkit-scrollbar{display:none}',
      // (nothing above it -- Home Status not in the pane: no rule to part them, paneStack)
      ':host([pbare]) .pane .sc{border-top:0}',
      // THE MUSIC (music_slide: .mu, a slide like the forecast's layer;
      // music_pane: .pm, in the pane). Sizes are a 1280 x 800 tablet's,
      // scaled with the screen (--z). Nothing here takes pointer events: the
      // buttons are found by place (musicHit), as the forecast details are.
      '.mu{position:absolute;inset:0;z-index:0;opacity:0;visibility:hidden;pointer-events:none;will-change:opacity;background:#000;',
      '  overflow:hidden;transition:opacity ' + CROSSFADE_MS + 'ms ease;--z:var(--hk-mu-zs,var(--hk-mu-z,1))}',
      '.mu.top{opacity:1;visibility:visible}',
      '.mu .mstage{display:contents}.mu .mmeta{min-width:0}',
      // (its blurred art under the pane too, seen through it; the song beside it)
      '.mu .mbody{container-type:size;--a:min(62cqh,42cqw)}',
      ':host([pane]) .mu .mbody{right:var(--hk-pane-w,0px)}',
      // PANE SIDE: LEFT (the Side Pane's, 2026-10-30): the pane on the left,
      // its edge and shadow toward the photo on its right, and everything that
      // stepped aside for it from the right steps aside from the left
      ':host([pside]) .pane{right:auto;left:0;border-left:0;border-right:1px solid rgba(255,255,255,0.10);',
      '  box-shadow:18px 0 44px rgba(0,0,0,.42),3px 0 12px rgba(0,0,0,.26)}',
      ':host([pside]) .ph[pw] img.fg{left:var(--hk-pane-w,0px)}',
      ':host([pside]) .ph[pw] .mowrap,:host([pside]) .ph[pw] .phscrim{right:0;left:var(--hk-pane-w,0px)}',
      ':host([pside][pane]) .ck,:host([pside][pane]) .en,:host([pside][pane]) .wx,:host([pside][pane]) .hl{right:0;left:var(--hk-pane-w,' + PANE_W + 'px)}',
      ':host([pside][pane]) .info{left:var(--hk-pane-w,' + PANE_W + 'px)}',
      ':host([pside][pane]) .fc,:host([pside][pane]) .fcb,:host([pside][pane]) .mu .mbody{right:0;left:var(--hk-pane-w,0px)}',
      // THE SIDE PANE'S OWN SECTIONS (cfg.pane_list): drawn by hk-sidepane.js
      // between Home Status and the pane's foot, on the pane's own background
      '.pane hk-side-pane{position:absolute;z-index:1;left:0;right:0;top:var(--hk-pane-top,' + PANE_TOP + 'px);bottom:var(--hk-pane-bottom,0px)}',
      '.pm{position:absolute;left:0;right:0;top:0;bottom:0;overflow:hidden;pointer-events:none;--z:var(--hk-mu-z,1);container-type:inline-size;',
      '  transition:opacity ' + MU_ART_MS + 'ms ease,visibility 0s linear ' + MU_ART_MS + 'ms;will-change:opacity}',
      ':host([pm]) .pm{transition:opacity ' + MU_ART_MS + 'ms ease,visibility 0s}',
      // the blurred art, two of them for the fade from one song to the next
      '.mbgf{position:absolute;inset:0;opacity:0;will-change:opacity;transition:opacity ' + MU_ART_MS + 'ms ease}',
      '.mbgf.on{opacity:1}',
      '.mbg{position:absolute;left:-8%;top:-8%;width:116%;height:116%;object-fit:cover;display:block}',
      '.mshade{position:absolute;inset:0;background:linear-gradient(to right,rgba(0,0,0,.36),rgba(0,0,0,.06) 62%,rgba(0,0,0,.10))}',
      '.pm .mshade{background:rgba(0,0,0,.28)}',
      '.mbody{position:absolute;inset:0;color:var(--hk-ink,rgba(255,255,255,0.94));text-align:left;text-shadow:0 1px 14px rgba(0,0,0,.22)}',
      '.msq{position:relative;width:100%;height:100%;border-radius:calc(14px * var(--z));background:rgba(255,255,255,.10);',
      '  box-shadow:0 calc(22px * var(--z)) calc(60px * var(--z)) rgba(0,0,0,.42)}',
      '.mph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}',
      '.mph svg{width:38%;height:38%;fill:rgba(255,255,255,.42)}',
      '.mfr{position:absolute;inset:0;opacity:0;will-change:opacity;transition:opacity ' + MU_ART_MS + 'ms ease}',
      '.mfr.on{opacity:1}',
      '.mfr img{display:block;width:100%;height:100%;object-fit:cover;border-radius:calc(14px * var(--z))}',
      // AN IMAGE WITH NO PICTURE IS NOT DRAWN: the browser outlines an empty
      // <img>, a faint light border round the no-artwork placeholder (seen on
      // the tablets, 2026-10-11) -- the big art's and Up Next's alike
      '.mu img:not([src]),.pm img:not([src]){visibility:hidden}',
      '.martist,.malbum,.mnt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // THE SPEAKER LINE in the room's place (hk-np-strip.js; mockup 12h, 2026-11-09): the room's size and weight, its
      // touch area 44 px tall round the words -- not clipped, so the row does not clip it; the words cut short instead
      '.mroom{min-width:0;max-width:100%}.mroom .hksl{text-transform:none;letter-spacing:.1px}',
      '.mu .mroom .hksl,.pm .mroom .hksl{--hksl-h:max(44px,calc(44px * var(--z)))}',
      // (narrow places, the first room alone: the screensaver's pane and the Side Pane's Full player)
      '.pm .hksl-t i{display:none}',
      '.mroom{font-size:calc(19px * var(--z));font-weight:600;opacity:.74;letter-spacing:.1px}',
      '.mtitle{font-size:calc(44px * var(--z));font-weight:700;letter-spacing:-.6px;line-height:1.1;margin-top:calc(10px * var(--z));',
      '  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}',
      '.martist{font-size:calc(28px * var(--z));font-weight:600;opacity:.92;margin-top:calc(6px * var(--z))}',
      '.malbum{font-size:calc(21px * var(--z));font-weight:500;opacity:.62;margin-top:calc(4px * var(--z))}',
      // THE CONTROLS STRIP (2026-11-09; modules/hk-np-strip.js): the progress, the transport and the volume are the one
      // strip every player draws with -- its geometry there, at this view's scale; what follows sets only this view's
      // sizes and places. (Before, the volume's track was found 28 px past its edges and the buttons 14 px past
      // theirs: a tap meant for play / pause could land on the volume -- the owner, 2026-11-09.)
      window.hkNpStrip.CSS,
      '.mu .hks,.pm .hks{--hks-z:var(--z);margin-top:calc(22px * var(--z))}',
      // (a row of the Up Next list is a button too, laid out as a row)
      '.mbtn{display:flex;align-items:center;transition:transform .15s ease,opacity .15s ease}',
      '.mbtn.hit{transform:scale(.88);opacity:.6}',
      '.mnext{display:flex;align-items:center;gap:calc(14px * var(--z));margin-top:calc(30px * var(--z));min-width:0}',
      '.pm .hks[novol] .mvol{display:none}',
      // (the next song's cover when Music Assistant has it -- often not until it
      // plays -- over a note, as the big art's placeholder)
      '.mnth{position:relative;flex:none;width:calc(50px * var(--z));height:calc(50px * var(--z));border-radius:calc(8px * var(--z));',
      '  overflow:hidden;background:rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center}',
      '.mnth svg{width:50%;height:50%;fill:rgba(255,255,255,.45)}',
      '.mnth img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
      '.mnx{min-width:0}',
      '.mnl{font-size:calc(13px * var(--z));font-weight:700;letter-spacing:.8px;text-transform:uppercase;opacity:.55}',
      '.mnt{font-size:calc(18px * var(--z));font-weight:500;opacity:.86;margin-top:calc(2px * var(--z))}',
      '[nodur] .hks .mprog,[nonext] .mnext{display:none}',
      // A NEW SONG KEEPS THE ROWS' PLACES while Music Assistant is asked what
      // comes next (and while its duration catches up): the column is held at
      // its foot, so a row gone for that moment dropped the song and the
      // buttons by its height and back -- a jump at every song change
      '.mnext{transition:opacity .3s ease}',
      '[nextwait] .mnext{opacity:0}',
      // (Speakers and Browse stay: with nothing playing they are the way to
      // start something -- where it plays, and what)
      '[idle] .martist,[idle] .malbum,[idle] .mprog,[idle] .mnext,[idle] .mbtn:not(.mpp):not(.mx){display:none}',
      '.pm[none]{display:none}',
      // THE SLIDE: the art on the right, the song below the clock, the date
      // and the weather on the left (what does not fit there goes: layoutMusic)
      // ONE MARGIN THREE TIMES (2026-11-09, the owner: "the gap on the right from the album art to the edge doesn't match
      // the gap from the text/controls on the left to the edge", and "the same margin/gap from the album art to the edge as
      // the album art to the text"): the column's margin to the left edge, the art's to the right edge and the gap between
      // them are one --mm, the column's own (it sat 50 px in, the art 6cqw in, 64 px between)
      '.mu .mbody{--mm:calc(50px * var(--z))}',
      '.mu .mart{position:absolute;width:var(--a);height:var(--a);right:var(--mm);top:calc(50cqh - var(--a) / 2)}',
      '.mu .mcol{position:absolute;left:var(--mm);bottom:max(7cqh,calc(40px * var(--z)));',
      '  width:calc(100cqw - var(--a) - 3 * var(--mm))}',
      '.mu[tight="1"] .mnext,.mu[tight="2"] .mnext,.mu[tight="2"] .malbum{display:none}',
      // A NARROW COLUMN (beside the pane): the volume on a row of its own, the
      // buttons centred between it and the progress bar above them
      '.mu .mcol{container-type:inline-size}',
      // (what the Slides section leaves out of Music Full Screen: musicParts)
      '.mu.h-room .mroom,.mu.h-album .malbum,.mu.h-progress .mprog,.mu.h-buttons .hks .mctl,.mu.h-volume .hks .mvol,.mu.h-next .mnext{display:none!important}',
      '.mu.h-buttons .hks .mvol{margin-top:0}',
      '.mu[tight="2"] .mtitle{-webkit-line-clamp:1}',
      // UPRIGHT (a phone, an iPad upright; phase 13): the art centered under the slide corner, the song and its buttons in
      // one column under it, the buttons on one line, the volume under them -- an iPhone's Now Playing
      // The controls keep a useful width even when a short screen needs smaller art.
      ':host([muup]) .mu .mbody{--a:min(84cqw,36cqh);--mg:4cqh}',
      ':host([muup]) .mu .mart{right:auto;left:calc(50cqw - var(--a) / 2);top:var(--hk-mu-top,12cqh)}',
      ':host([muup]) .mu .mcol{--cw:min(84cqw,max(var(--a),calc(380px * var(--z))));left:calc(50cqw - var(--cw) / 2);right:auto;width:var(--cw);bottom:auto;top:calc(var(--hk-mu-top,12cqh) + var(--a) + var(--mg))}',
      // Beside a pane: a lower stage, the cover and the complete text block
      // sharing one row. The text's center follows the cover even when lines wrap
      // or optional fields disappear; progress and transport span both columns.
      ':host([murow]) .mu .mstage{display:grid;position:absolute;left:var(--hk-mu-stage-x);top:var(--hk-mu-top);width:var(--hk-mu-stage-w);height:var(--hk-mu-stage-h);',
      '  grid-template-columns:var(--a) minmax(0,1fr);grid-template-rows:var(--a) minmax(calc(24px * var(--z)),1fr) auto auto auto;column-gap:var(--hk-mu-stage-x,calc(56px * var(--z)))}',
      ':host([murow]) .mu .mart{position:relative;left:auto;right:auto;top:auto;grid-column:1;grid-row:1}',
      ':host([murow]) .mu .mcol{display:contents;container-type:normal}',
      ':host([murow]) .mu .mmeta{grid-column:2;grid-row:1;align-self:center}',
      ':host([murow]) .mu .mroom:empty,:host([murow]) .mu .martist:empty,:host([murow]) .mu .malbum:empty{display:none}',
      ':host([murow]) .mu .mroom{font-size:calc(15px * var(--z));letter-spacing:1px;text-transform:uppercase}',
      ':host([murow]) .mu .mtitle{font-size:calc(38px * var(--z));line-height:1.12;margin-top:calc(12px * var(--z));-webkit-line-clamp:2}',
      ':host([murow]) .mu.h-room .mtitle,:host([murow]) .mu .mroom:empty+.mtitle{margin-top:0}',
      ':host([murow]) .mu .martist{font-size:calc(25px * var(--z));margin-top:calc(10px * var(--z))}',
      ':host([murow]) .mu .malbum{font-size:calc(18px * var(--z));margin-top:calc(6px * var(--z))}',
      ':host([murow]) .mu .hks{grid-column:1/-1;grid-row:3 / 5;margin-top:0}',
      // (Up Next under the song, beside the cover: drawQueueRows; only here)
      '.mq{display:none}',
      ':host([murow]) .mu .mq:not(:empty){display:flex;flex-direction:column;margin-top:calc(18px * var(--z))}',
      // UP NEXT SCROLLS (2026-11-09, the owner: "the up next should scroll"): the heading stays, the rows (.mql) scroll in
      // the room the layout gives the box (max-height, layoutMusicView) -- no scrollbar drawn, a soft fade at the foot
      // while more are below, dropped at the end (the `more` mark, queueFade). On the screensaver the finger is
      // followed by hk-saver.js (its views take no pointer events); the Now Playing page scrolls it natively
      '.mqh{flex:none}',
      '.mql{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;',
      '  scrollbar-width:none}',
      '.mql::-webkit-scrollbar{display:none}',
      '.mql[more]{-webkit-mask-image:linear-gradient(180deg,#000 80%,transparent);mask-image:linear-gradient(180deg,#000 80%,transparent)}',
      '.mqh{font-size:calc(13px * var(--z));font-weight:600;opacity:.66;padding-bottom:calc(6px * var(--z))}',
      '.mbtn.mqr{flex:none;box-sizing:border-box;min-height:44px;width:auto;height:auto;border-radius:0;justify-content:flex-start;gap:calc(12px * var(--z));padding:calc(7px * var(--z)) 0;',
      '  box-shadow:0 -.5px 0 rgba(255,255,255,.14);text-align:left}',
      '.mqt{flex:none;width:calc(40px * var(--z));height:calc(40px * var(--z));border-radius:calc(6px * var(--z));background:rgba(255,255,255,.10) center/cover}',
      '.mqx{min-width:0;flex:1}',
      '.mqx b,.mqx small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.mqx b{font-size:calc(17px * var(--z));font-weight:600}',
      '.mqx small{font-size:calc(14px * var(--z));opacity:.66}',
      // (the next song is in the rows: no Up Next line under the buttons too)
      ':host([murow]) .mu[mqon] .mnext{display:none}',
      ':host([murow]) .mu .mnext{grid-column:1/-1;grid-row:5;justify-content:center}',
      // what plays steps aside: the slide shows it big, the pane has it
      '.info > hk-screensaver-now-card{transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
      ':host([muslide]) .info > hk-screensaver-now-card{opacity:0}',
      ':host([pm]) .info > hk-screensaver-now-card{display:none}',
      // THE PANE'S MUSIC alone: all of the pane, the art as big as fits
      ':host(:not([pcal])) .pane .sc{display:none}',
      ':host(:not([pcal])) .pm .mbody{display:flex;flex-direction:column;text-align:center;',
      '  padding:var(--hk-pane-top,74px) var(--hk-pane-pad,28px) var(--hk-pm-foot,22px)}',
      ':host(:not([pcal])) .pm .mart{flex:1 1 auto;min-height:0;container-type:size;display:flex;align-items:center;justify-content:center;',
      '  margin:calc(10px * var(--z)) 0 calc(22px * var(--z))}',
      ':host(:not([pcal])) .pm .msq{width:min(100cqw,100cqh);height:min(100cqw,100cqh)}',
      ':host(:not([pcal])) .pm .mcol{flex:none}',
      ':host(:not([pcal])) .pm .mroom{font-size:calc(14px * var(--z))}',
      ':host(:not([pcal])) .pm .mtitle{font-size:calc(25px * var(--z));letter-spacing:-.3px;margin-top:calc(6px * var(--z))}',
      ':host(:not([pcal])) .pm .martist{font-size:calc(18px * var(--z))}',
      ':host(:not([pcal])) .pm .malbum{font-size:calc(15px * var(--z))}',
      ':host(:not([pcal])) .pm .hks{margin-top:calc(16px * var(--z))}',
      '.pm .hks{--hks-tf:calc(12px * var(--z));--hks-th:calc(22px * var(--z))}',
      // SPREAD ACROSS THE SONG'S WIDTH (2026-11-06, the owner: "too close together ... spread out in the Full size like
      // they are on the More size"): Speakers and Browse at the progress bar's ends, the transport between; the gap a
      // floor where the pane is narrow
      '.pm .hks{--hks-b:calc(50px * var(--z));--hks-pp:calc(62px * var(--z));--hks-x:calc(42px * var(--z));',
      '  --hks-gb:calc(38px * var(--z));--hks-gpp:calc(52px * var(--z));--hks-gx:calc(24px * var(--z))}',
      // (a narrow pane -- the band's sections, a 290 px strip: the five keep one
      // row, smaller and closer, rather than Browse dropping to a line of its
      // own, 2026-10-31)
      // (the targets keep the rule's 44 px, their glyphs smaller)
      '@container (max-width:360px){:host(:not([pcal])) .pm .hks{--hks-gb:calc(34px * var(--z));--hks-gpp:calc(46px * var(--z));--hks-gx:calc(22px * var(--z))}}',
      ':host(:not([pcal])) .pm .mnext{justify-content:center;margin-top:calc(28px * var(--z));text-align:left}',
      ':host(:not([pcal])) .pm .mnth{width:calc(38px * var(--z));height:calc(38px * var(--z))}',
      ':host(:not([pcal])) .pm .mnl{font-size:calc(10px * var(--z))}',
      ':host(:not([pcal])) .pm .mnt{font-size:calc(14px * var(--z))}',
      // ...UNDER THE CALENDAR: a row (the art beside the song), as tall as it
      // is, the list above it (paneStack)
      // (the art's blur behind the events too, a little darker there for
      // them; the music set off by a hairline, not an edge)
      ':host([pcal]) .pm .mshade{background:linear-gradient(to bottom,rgba(0,0,0,.42),rgba(0,0,0,.34) 45%,rgba(0,0,0,.24))}',
      ':host([pcal]) .pm .mbody::before{content:"";position:absolute;top:0;left:var(--hk-pane-pad,28px);right:var(--hk-pane-pad,28px);',
      '  border-top:1px solid rgba(255,255,255,0.14)}',
      ':host([pcal]) .pm .mbody{position:absolute;top:auto;left:0;right:0;bottom:0;display:grid;grid-template-columns:calc(120px * var(--z)) minmax(0,1fr);',
      '  column-gap:var(--hk-pane-pad,28px);align-items:center;padding:calc(22px * var(--z)) var(--hk-pane-pad,28px) var(--hk-pm-foot,22px)}',
      ':host([pcal]) .pm .mart{grid-row:1 / span 4;width:calc(120px * var(--z));height:calc(120px * var(--z))}',
      ':host([pcal]) .pm .msq{border-radius:calc(12px * var(--z))}',
      ':host([pcal]) .pm .mfr img{border-radius:calc(12px * var(--z))}',
      ':host([pcal]) .pm .mcol{display:contents}',
      ':host([pcal]) .pm .mroom,:host([pcal]) .pm .mtitle,:host([pcal]) .pm .martist,:host([pcal]) .pm .malbum{grid-column:2}',
      ':host([pcal]) .pm .hks,:host([pcal]) .pm .mnext{grid-column:1 / -1}',
      ':host([pcal]) .pm .mroom{font-size:calc(13px * var(--z))}',
      ':host([pcal]) .pm .mtitle{font-size:calc(22px * var(--z));letter-spacing:-.3px;margin-top:calc(4px * var(--z))}',
      ':host([pcal]) .pm .martist{font-size:calc(17px * var(--z));margin-top:calc(3px * var(--z))}',
      ':host([pcal]) .pm .malbum{font-size:calc(14px * var(--z));margin-top:calc(2px * var(--z))}',
      ':host([pcal]) .pm .hks{margin-top:calc(18px * var(--z));--hks-tk:calc(5px * var(--z))}',
      ':host([pcal]) .pm .mvol svg{width:calc(18px * var(--z));height:calc(18px * var(--z))}',
      ':host([pcal]) .pm .mvt b{width:calc(16px * var(--z));height:calc(16px * var(--z));margin:calc(-8px * var(--z)) 0 0 calc(-8px * var(--z))}',
      ':host([pcal]) .pm .mnext{margin-top:calc(24px * var(--z));gap:calc(12px * var(--z))}',
      ':host([pcal]) .pm .mnth{width:calc(38px * var(--z));height:calc(38px * var(--z));border-radius:calc(7px * var(--z))}',
      ':host([pcal]) .pm .mnl{font-size:calc(10px * var(--z))}',
      ':host([pcal]) .pm .mnt{font-size:calc(14px * var(--z))}',
      ':host([pcal]) .pm[idle] .hks{grid-column:1 / -1}',
      '@media (prefers-reduced-motion:reduce){.ph,.phscrim,.fcscrim,.mu,.mfr,.mbgf{transition:none}.ph.zoom img.fg,.ph.mo.zoom .mocell canvas{animation:none}}'
    ].join('\n') + '\n' + [
      // THE HOMEVIEW-STYLE FACES (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I)
      // Glance, Month and Day ([ckface]): what they show themselves, the corners leave out; on a light face
      // ([cklight]: its ground's luminance, hkSaverFaces inkFor) the corners' words go dark -- the ink the corner cards
      // draw with (--hk-ink and its steps), not only the box's colour: with that alone the time, the date and the
      // temperature stayed white on the light Day face (2026-10-31), and their glow goes
      ':host([ckface=glance]) .info hk-clock-card,:host([ckface=glance]) .info hk-weather-strip-card,:host([ckface=glance]) .info hk-screensaver-now-card{display:none}',
      ':host([ckface=month]) .info hk-clock-card{display:none}',
      // ...the Day face: the corner's time and weather smaller (its own words are the day; the corner's photos-sized
      // clock ran into "SATURDAY", 2026-10-31, the owner), and the day and its date moved down only where the corner's
      // words would still meet them (dayFit: --hk-day-push)
      ':host([ckface=day]) .info > hk-clock-card,:host([ckface=day]) .info > hk-weather-strip-card{zoom:.6}',
      ':host([ckface=day]:not([pane])) .info{--hk-ss-status-l1:min(28px,4.6vmin);--hk-ss-status-l2:min(19px,3.4vmin)}',
      '@media (max-width:599px){:host([ckface=day]:not([pane])) .info > hk-clock-card,:host([ckface=day]:not([pane])) .info > hk-weather-strip-card{zoom:.45}',
      '  :host([ckface=day]:not([pane])) .info{--hk-ss-status-right:30px;--hk-ss-status-width:calc(100vw - 60px);--hk-ss-status-l1:20px;--hk-ss-status-l2:15px}}',
      // ...Month's own top line is the month and the time: the corner weather has no room beside it, and Home Status
      // sits under it at its right edge (2026-10-31: both were drawn over it) -- in the face's units, 1vmin without the
      // pane; beside one, Home Status is in the pane
      ':host([ckface=month]) .info hk-weather-strip-card{display:none}',
      ':host([ckface=month]:not([pane])) .info{--hk-ss-status-top:calc(11.5vmin + 6px);--hk-ss-status-right:9.8vmin;--hk-ss-status-l1:min(26px,4.6vmin);--hk-ss-status-l2:min(18px,3.4vmin)}',
      ':host([ckface][cklight]:not([cknight])) .info{--primary-text-color:#1c1c1e;--secondary-text-color:#48484a;color:#1c1c1e;text-shadow:none;',
      '  --hk-ink:#1c1c1e;--hk-ink-2:rgba(28,28,30,.72);--hk-ink-3:rgba(28,28,30,.5);--hk-glyph:#1c1c1e;--hk-glow:none;',
      '  --hk-ss-ink:#1c1c1e;--hk-ss-ink-2:rgba(28,28,30,.72);--hk-ss-glow:none;',
      // (and the weather's glyph: its white parts drawn in the ink -- a white cloud on the light page, 2026-10-31,
      // the owner -- its sun still yellow)
      '  --hk-wx-w:#1c1c1e}',
      // ...but what sits in the pane beside it (Home Status, what plays, the timers: the pane's own dark ground) keeps
      // its light ink -- they are the corner's cards, drawn there
      ':host([ckface][cklight][pane]:not([cknight])) .info > hk-screensaver-status-card,:host([ckface][cklight][pane]:not([cknight])) .info > hk-screensaver-now-card,',
      ':host([ckface][cklight][pane]:not([cknight])) .info > hk-timer-strip-card{--primary-text-color:#ffffff;--secondary-text-color:#dddddd;color:rgba(255,255,255,0.94);',
      '  --hk-ink:initial;--hk-ink-2:initial;--hk-ink-3:initial;--hk-glyph:initial;--hk-glow:initial;--hk-ss-ink:initial;--hk-ss-ink-2:initial;--hk-ss-glow:initial;--hk-wx-w:initial}',
      // Big Weather ([fcbig]): it tells the time and the weather itself, over the forecast's sky -- not while the music
      // covers it (Music First: 2026-10-31, the owner: the time, the date and the weather were gone over the music
      // unless the Forecast's Layout was Classic; a Large clock's corner copy came back by its fade-in alone)
      ':host([fcbig][forecast]:not([muslide])) .info hk-clock-card,:host([fcbig][fcslide]:not([muslide])) .info hk-clock-card,',
      ':host([fcbig][forecast]:not([muslide])) .info hk-weather-strip-card,:host([fcbig][fcslide]:not([muslide])) .info hk-weather-strip-card{opacity:0}',
      // ...and what stays in its corners never lands on it (2026-10-31, the owner: "Disarmed" drawn over its time):
      // Home Status under the face's time (6.1 + 5.4 down, then 1.6 more), at its right edge, at the readings' sizes
      // (3.7, 2.9) and as wide as the top allows beside the condition (its 7.3 margins, 30 for the condition); what plays on the face's bottom row, to its numbers
      // (hkSaverFaces, THE BOTTOM ROW): on its 7.3-unit margin, 6.1 up, its picture as tall as a reading's box (14),
      // its title and artist the readings' sizes (3.7, 2.9), no wider than the row's left 40 % -- the face's units:
      // its 1cqmin is 1vmin on a screen without the pane; beside one, the corners are in the pane. Upright, it sits
      // above the readings with 4 units between: two rows of them (2 x 14 + 4), or one for two readings or fewer
      // ([fcn]: how many, from the face), or none
      ':host([fcbig][forecast]:not([pane])) .info,:host([fcbig][fcslide]:not([pane])) .info{--hk-ss-status-top:13.1vmin;--hk-ss-status-right:7.3vmin;',
      '  --hk-ss-status-width:calc(100vw - 44.6vmin);--hk-ss-status-l1:3.7vmin;--hk-ss-status-l2:2.9vmin;',
      '  --hk-ss-now-left:7.3vmin;--hk-ss-now-bottom:6.1vmin;--hk-ss-np-art:14vmin;--hk-ss-np-title:3.7vmin;--hk-ss-np-artist:2.9vmin;--hk-ss-np-gap:2.4vmin;',
      '  --hk-ss-now-max:calc(40vw - 7.3vmin)}',
      '@media (max-aspect-ratio:1/1){:host([fcbig][forecast]:not([pane])) .info,:host([fcbig][fcslide]:not([pane])) .info{',
      '  --hk-ss-now-bottom:calc(6.1vmin + 32vmin + 4vmin);--hk-ss-corner-bottom:calc(6.1vmin + 32vmin + 4vmin);--hk-ss-now-max:calc(100vw - 14.6vmin)}',
      '  :host([fcbig][fcn="1"]:not([pane])) .info,:host([fcbig][fcn="2"]:not([pane])) .info{--hk-ss-now-bottom:calc(6.1vmin + 14vmin + 4vmin);--hk-ss-corner-bottom:calc(6.1vmin + 14vmin + 4vmin)}',
      '  :host([fcbig][fcn="0"]:not([pane])) .info{--hk-ss-now-bottom:6.1vmin;--hk-ss-corner-bottom:6.1vmin}}',
      // PHOTO TITLES: the album's name and the year, bottom right, over a dark fade of its own (in the photo's layer,
      // so it fades with its photo); in the photo's own box, beside a pane
      '.ph .ttl{position:absolute;inset:0;container-type:size;pointer-events:none;background:linear-gradient(transparent 55%,rgba(0,0,0,.45))}',
      '.ph[pw] .ttl,.ph[pw] .tb{right:var(--hk-pane-w,0px)}',
      '.ph .ttl .tt{position:absolute;right:8.5cqmin;bottom:8.5cqmin;text-align:right;color:#fff;font-family:var(--hk-saver-font,-apple-system,system-ui,sans-serif);',
      '  text-shadow:0 2px 18px rgba(0,0,0,.35)}',
      '.ph .ttl .tt b{display:block;font-size:9.3cqmin;font-weight:700;letter-spacing:-.01em;line-height:1}',
      '.ph .ttl .tt span{display:block;font-size:3.7cqmin;font-weight:600;opacity:.85;line-height:1.5}',
      // PHOTO, TIME BEHIND: the photo, the time, then the photo's subject again over the time -- the same picture,
      // masked by its cut-out, laid out exactly as the photo is (its fit and focus; the zoom and Slow Zoom move all
      // three as one). A photo without a usable cut-out: the time in front, high in the middle.
      '.ph .tb{position:absolute;inset:0;pointer-events:none;container-type:size;transform-origin:var(--org,var(--pos,50% 50%));scale:var(--zm,1)}',
      '.ph.zoom .tb{animation:hk-saver-zoom var(--zd,33s) linear forwards}',
      '.ph .tb .tbt{position:absolute;display:flex;align-items:center;justify-content:center;white-space:nowrap;line-height:1;',
      '  font-family:var(--hk-saver-font,-apple-system,system-ui,sans-serif);font-weight:500;letter-spacing:-.03em;font-variant-numeric:proportional-nums;',
      '  color:rgba(255,255,255,.94);text-shadow:0 2px 30px rgba(0,0,0,.22)}',
      // (the one place: TB in hk-saver.js, glyphBox's numbers)
      // (its size and height as the screen sets them: --tb-size, --tb-top on the host, photoFaces)
      '.ph .tb .tbt{left:0;right:0;top:calc(var(--tb-top,6) * 1cqh);font-size:calc(var(--tb-size,24) * 1cqmin);height:calc(var(--tb-size,24) * 7cqmin / 6)}',
      '.ph .tb.wait{visibility:hidden}',
      '.ph .tb img.tbcut{object-fit:var(--fit,cover);object-position:var(--pos,50% 50%);',
      '  -webkit-mask-size:var(--fit,cover);mask-size:var(--fit,cover);-webkit-mask-position:var(--pos,50% 50%);mask-position:var(--pos,50% 50%);',
      '  -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}',
      ':host([cksoft]) .ph .tb{display:none}',
      // ...and while it shows, the clock is the photo's: the corner clock and a Large clock step aside, and the rest of
      // the corner (the weather, what is playing, the timers) keeps the corner, upper left, above the figures (2026-10-31,
      // the owner: under the time, centred, it "left the corner" -- back where Clock has it)
      ':host([tb]:not([forecast]):not([fcslide]):not([muslide]):not([enslide]):not([wxslide]):not([hlslide]):not([tmslide])) .info > hk-clock-card{display:none}',
      ':host([tb]:not([forecast]):not([fcslide]):not([muslide]):not([enslide]):not([wxslide]):not([hlslide]):not([tmslide])) .ck{opacity:0}',
      // ...on a phone, the weather at the size its narrower time calls for (its 36 px type and 60 px glyph are a
      // tablet's), and the photo's title clear of what is playing, under it at the left
      '@media (max-width:599px){:host([tb]:not([forecast]):not([fcslide]):not([muslide]):not([enslide]):not([wxslide]):not([hlslide]):not([tmslide])) .info > hk-weather-strip-card{zoom:.7}',
      '  .ph .ttl .tt{bottom:calc(8.5cqmin + 112px)}',
      // (and what is playing as wide as the phone allows: at 46 % of it, its song was "Bl...")
      '  :host{--hk-ss-now-max:calc(100vw - 40px)}}',
      // CLOCK ON PHOTOS: the time and the titles over the photos' dark wash (.ph::after), not under it -- under it the
      // time was drawn grey (2026-10-31, the owner: "the clock is dim"); the cut-out over the time darkened as the
      // wash darkens the photo (a black wash at d is the colour times 1 - d), so the subject still matches its photo
      ':host([ckphotos]) .ph .tb,:host([ckphotos]) .ph .ttl{z-index:3}',
      ':host([ckphotos]) .ph .tb img.tbcut{filter:brightness(calc(1 - var(--hk-ckdim,.35)))}',
      // TIME BEHIND'S OWN DARKEN on Photos and Both (2026-10-31, tbLook's --tb-dim): the same wash, the time and the
      // titles over it, the cut-out darkened with the photo -- none at 0, as before
      ':host([tb]:not([ckphotos])) .ph::after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:rgba(0,0,0,var(--tb-dim,0))}',
      ':host([tb]:not([ckphotos])) .ph .tb,:host([tb]:not([ckphotos])) .ph .ttl{z-index:3}',
      ':host([tb]:not([ckphotos])) .ph .tb img.tbcut{filter:brightness(calc(1 - var(--tb-dim,0)))}',
      '@media (prefers-reduced-motion:reduce){.ph.zoom .tb{animation:none}}'
    ].join('\n');
    // A CARD'S CONFIG for where it is now: Home Status at the top of the
    // pane sized for it, and the timers in its foot -- set again whenever the
    // pane comes or goes (setPane)
    // ...and its colours the screensaver's ink where one is set: dark on a light face ([cklight]), else as configured
    var INKS = { color: '--hk-ss-ink', ampm_color: '--hk-ss-ink-2', date_color: '--hk-ss-ink-2' };

    // what the shell and the later parts use of this one
    K.CSS = CSS; K.INKS = INKS;
  };
})();
