// hk-menu-css.js - the menu's CSS.
//
// PART OF THE MENU (hk-menu.js). Not a card and not run on its own: it registers one
// function, which hk-menu.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkMenuParts = window.hkMenuParts || {})['hk-menu-css'] = function (K) {
    var EASE = K.EASE, NOW_PAD = K.NOW_PAD, SPRING = K.SPRING, TAB_H = K.TAB_H, TAB_W = K.TAB_W, W = K.W;

    var CSS = [
      ':host{all:initial}',
      '.root{position:fixed;left:0;top:0;width:0;height:0;z-index:6;',
      // the dashboard's font (hk-base.js FONT_ROOT): the menu hangs under
      // <body>, outside the view its theme is on
      '  ' + window.hkCards.FONT_ROOT + ';',
      '  -webkit-font-smoothing:antialiased;color:' + window.hkCards.v('ink') + '}',
      '.root.open{z-index:9}',
      '.scrim{position:fixed;inset:0;background:rgba(0,0,0,0.26);opacity:0;pointer-events:none;',
      '  transition:opacity .32s ease;-webkit-tap-highlight-color:transparent}',
      '.root.open .scrim{opacity:1;pointer-events:auto}',
      '.root.docked .scrim{display:none}',
      // THE PANEL. Its material is a layer of its own (.mat), so the panel is
      // not a backdrop root and the tab riding on its edge can still blur the
      // sky behind itself.
      // THE CLIP: the dashboard's own area. The panel slides out from ITS left
      // edge, so where Home Assistant's sidebar shows (no kiosk mode) a closed
      // panel is not left lying over it on a desktop.
      '.clip{position:fixed;left:var(--l,0px);top:var(--t,0px);right:0;height:var(--h,100vh);',
      '  overflow:hidden;pointer-events:none}',
      '.panel{position:absolute;left:0;top:0;height:100%;width:' + W + 'px;pointer-events:auto;',
      '  max-width:82vw;transform:translateX(-100%);transition:transform .38s ' + EASE + ';',
      '  display:flex;flex-direction:column;box-sizing:border-box;will-change:transform;',
      // the swipe that closes it (wireSwipe) is the page's to read: without
      // this a touch browser takes the sideways drag as its own after a few
      // pixels and sends pointercancel (down, move, move, cancel -- and the
      // menu stays open). Up and down still scroll.
      '  touch-action:pan-y}',
      '.root.open .panel,.root.docked .panel{transform:none}',
      // DOCKED BY ITSELF (a load, a window grown wide): in place, not slid in
      // -- and not drawn until the dashboard's left edge holds still (settle)
      '.root.still .panel{transition:none}',
      '.root.settling .panel{visibility:hidden}',
      '.mat{position:absolute;inset:0;background:rgba(28,28,32,0.52);',
      '  -webkit-backdrop-filter:blur(34px) saturate(1.9);backdrop-filter:blur(34px) saturate(1.9);',  // hkCards.BLUR.heavy
      '  border-right:1px solid rgba(255,255,255,0.10);pointer-events:none}',
      '.root.frosted .mat{background:rgba(34,38,56,0.95);-webkit-backdrop-filter:none;backdrop-filter:none}',
      // TINTED (no blur anywhere): the tab bar's Tinted -- the panel is
      // always up on a wall tablet, so a blur here would run every frame the
      // sky moves; near-solid, as a see-through panel over the land is not
      // read (the tab bar measured the same, 2026-10-05)
      '.root.tinted .mat{background:rgba(24,24,28,0.93);-webkit-backdrop-filter:none;backdrop-filter:none}',
      // BRIGHT GLASS (2026-10-30, DESIGN.md "Bright Glass"): a white wash over
      // the look's light blur (hkCards.BLUR.bright), the rim down its edge;
      // the page you're on a white pill, its name and icon the accent's,
      // deepened to read on white
      // (the look's Dim over it, 2026-11-01: --hk-bright-shade, hk-settings.js brightLook)
      '.root.bright .mat{background:var(--hk-bright-shade,linear-gradient(transparent,transparent)),linear-gradient(150deg,rgba(255,255,255,0.30),rgba(255,255,255,0.14));',
      '  -webkit-backdrop-filter:blur(4px) saturate(1.3) brightness(1.08);backdrop-filter:blur(4px) saturate(1.3) brightness(1.08);',
      '  border-right:0;box-shadow:inset -1.5px 0 0 rgba(255,255,255,0.22)}',
      // ...but open OVER the page (not docked beside it) it is a sheet: its
      // sheets' heavier blur, or the page's own text shows through its rows
      // (WebKit, 2026-10-30)
      '.root.bright:not(.docked) .mat{-webkit-backdrop-filter:blur(34px) saturate(2);backdrop-filter:blur(34px) saturate(2)}',
      '.root.bright .row{text-shadow:0 1px 2px rgba(0,0,0,0.18)}',
      '.root.bright .row.here{color:color-mix(in srgb,var(--hk-here,' + window.hkCards.v('accent') + ') 64%,#000);text-shadow:none}',
      '.root.bright .row.here::before{background:rgba(255,255,255,0.92)}',
      '.root.bright .row.here hk-icon{color:color-mix(in srgb,var(--hk-here,' + window.hkCards.v('accent') + ') 64%,#000)}',
      // The open panel's shadow, under the tab (z -2): on .mat it would fall
      // over the tab, which sits BEHIND the material (below).
      '.panel::before{content:"";position:absolute;inset:0;z-index:-2;pointer-events:none;',
      '  transition:box-shadow .38s ' + EASE + '}',
      '.root.open .panel::before{box-shadow:14px 0 44px rgba(0,0,0,0.26)}',
      // THE LIST. 14 px in from both panel edges, so a selected row's pill has
      // the same margin all round; 44 px rows (Apple's touch minimum) with 2 px
      // between them, so two selections never touch.
      // CLEAR OF THE STATUS BAR (on an iPhone, "Home" would sit under the
      // time and the Dynamic Island). The Home Assistant app draws
      // the page edge to edge, so the list starts below the device's safe
      // area -- env(), zero where there is none -- and scrolls away under a
      // fade that ends there too (the list's own fades, in the menu's <style>).
      // --hk-safe-top overrides it, for testing.
      '.list{position:relative;flex:1;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;',
      '  -webkit-overflow-scrolling:touch;scrollbar-width:none;box-sizing:border-box;',
      '  --safe:var(--hk-safe-top,env(safe-area-inset-top,0px));',
      '  padding:calc(22px + var(--safe)) 14px calc(28px + env(safe-area-inset-bottom,0px))',
      '    calc(14px + var(--hk-safe-left,env(safe-area-inset-left,0px)))}',
      '.list::-webkit-scrollbar{display:none}',
      // THE NOW-PLAYING BAR LIES OVER A DOCKED MENU'S FOOT (it runs the
      // dashboard's full width, hk-popup.js), and says how much of the
      // screen's bottom it covers (--hk-bar-h): the list gets that much more
      // room at its end, so its last rows still scroll up clear of the bar.
      '.root.docked .list{padding-bottom:calc(28px + env(safe-area-inset-bottom,0px) + var(--hk-bar-h,0px) - var(--hk-dock-h,0px))}',
      // DOCKED, the panel ends above the docked now-playing bar, which runs
      // the screen's whole width under it (hk-popup.js --hk-dock-h); a bar
      // that floats over the page still lies over its foot (--hk-bar-h above)
      '.root.docked .panel{height:calc(100% - var(--hk-dock-h,0px))}',
      // THE TIME AND WEATHER (Configure: "Time and weather in the menu on
      // these dashboards"), only while the menu is docked. Fixed above the
      // list -- only the rows scroll, under the hairline -- and no plate of
      // its own (a box round it looks out of place). Two
      // short lines for 300 px: "1:12 PM" beside "76°", then "Sunday, Sep 27"
      // beside "Sunny · Feels 75°". Its ink starts on the column the rows'
      // glyphs and the section headings start on (x = 29) and ends where it
      // starts from the other edge (x = 271): paintNow() measures each line's
      // side bearing, since a "1" starts well inside its own box.
      '.now{position:relative;flex:none;display:grid;grid-template-columns:minmax(0,1fr) auto;',
      '  column-gap:12px;row-gap:5px;align-items:end;box-sizing:border-box;color:' + window.hkCards.v('ink') + ';',
      // Match the page inset, then lift the block 6px for the 44px clock's
      // extra space above its visible digits compared with the status labels.
      // (and clear of a side safe area at the left: a phone turned, its Dynamic Island there -- hk-base.js SAFE)
      '  padding:calc((100vw - var(--hk-page-left,0px) - var(--hk-page-right,0px)) * var(--hk-side,0.02) - 2px + var(--hk-safe-top,env(safe-area-inset-top,0px))) ' + NOW_PAD + 'px 20px calc(' +
        NOW_PAD + 'px + var(--hk-safe-left,env(safe-area-inset-left,0px)))}',
      '.now[hidden],.rule[hidden]{display:none}',
      '.now .tm{display:flex;align-items:baseline;gap:4px;min-width:0;white-space:nowrap}',
      '.now .t{font-size:44px;font-weight:600;line-height:1;letter-spacing:0}',
      '.now .ap{font-size:16px;font-weight:500;line-height:1;color:' + window.hkCards.v('ink-2') + '}',
      '.now .wx{justify-self:end;display:flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer;',
      '  -webkit-tap-highlight-color:transparent}',
      '.now .g{display:flex;width:28px;height:28px}',
      '.now .tp{font-size:32px;font-weight:500;line-height:1;letter-spacing:0}',
      '.now .d,.now .c{font-size:14px;font-weight:600;line-height:1.2;letter-spacing:0;color:' + window.hkCards.v('ink-2') + ';',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.now .c{justify-self:end;text-align:right;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      // a border, snapped to device pixels (a filled 1 px box fell between them
      // on a Mac at 1.5x-1.7x and drew at half strength: hk-settings-kit.js)
      '.rule{position:relative;flex:none;height:0;margin:0 14px;border-top:1px solid rgba(255,255,255,0.14)}',
      // the safe area is the time's to clear, not the list's
      '.panel.has-now .list{--safe:0px}',
      '.row{display:flex;align-items:center;gap:14px;width:100%;height:44px;box-sizing:border-box;',
      '  padding:0 14px;border:0;border-radius:12px;background:none;color:' + window.hkCards.v('ink') + ';',
      '  font:inherit;font-size:17px;font-weight:400;letter-spacing:-0.41px;text-align:left;',
      '  cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color .15s ease}',
      '.row + .row{margin-top:2px}',
      // the highlight: the screen's Highlight Colour (paintIcons), Apple's orange by default
      '.row hk-icon{--mdc-icon-size:22px;width:22px;height:22px;flex:none;display:flex;color:' + window.hkCards.v('accent') + '}',
      '.row span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // THE HIGHLIGHT SLIDES TO THE NEW ROW (2026-10-10), as the tab bar's
      // does: it is a layer behind the row (::before), started over the row
      // you were on (--hx/--hy, --sx/--sy, slideHere) and let go -- a short
      // spring down or up the list. A transform: the compositor's, no layout.
      '.row{position:relative;isolation:isolate}',
      '.row.here{color:var(--hk-on-accent,#fff)}',
      '.row.here::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;',
      '  background:var(--hk-here,' + window.hkCards.v('accent') + ');transform-origin:0 0;',
      '  transform:translate(var(--hx,0px),var(--hy,0px)) scale(var(--sx,1),var(--sy,1));',
      '  transition:transform .42s ' + SPRING + '}',
      '.row.here.slide-from::before{transition:none}',
      '.row.here hk-icon{color:var(--hk-on-accent,#fff)}',
      // the Home Assistant section: iOS count bubbles, "More" and its rows
      '.row .bdg{flex:none;min-width:22px;height:22px;padding:0 7px;box-sizing:border-box;border-radius:11px;',
      '  background:#ff3b30;color:#fff;font-size:13px;font-weight:600;line-height:22px;text-align:center;letter-spacing:0}',
      '.row .bdg[hidden]{display:none}',
      '.row.more svg{flex:none;opacity:.45;transform:rotate(-90deg);transition:transform .2s ease}',
      '.row.more[aria-expanded="true"] svg{transform:none}',
      '.row.sub{height:40px;padding-left:50px;font-size:15px;color:' + window.hkCards.v('ink') + '}',
      '.row.sub hk-icon{--mdc-icon-size:20px;width:20px;height:20px;color:rgba(235,235,245,0.6)}',
      '@media (hover:hover){.row:not(.here):hover{background:rgba(255,255,255,0.07)}}',
      '.row:focus-visible,.sh:focus-visible,.tab:focus-visible{outline:2px solid rgba(255,255,255,0.7);outline-offset:-2px}',
      // SECTION HEADINGS: the Home app's "Categories" / "Rooms", which fold.
      '.sh{display:flex;align-items:center;justify-content:space-between;width:100%;height:36px;',
      '  box-sizing:border-box;margin:16px 0 2px;padding:0 14px;border:0;background:none;',
      '  color:' + window.hkCards.v('ink-2') + ';font:inherit;font-size:15px;font-weight:600;letter-spacing:-0.24px;',
      '  cursor:pointer;-webkit-tap-highlight-color:transparent}',
      // the fold chevron keeps its own color (an icon, not on the text scale)
      '.sh svg{transition:transform .2s ease;color:rgba(235,235,245,0.60)}',
      '.sh.shut svg{transform:rotate(-90deg)}',
      // THE EDGE TAB rides on the panel's right edge: closed, it is all that
      // shows, in the page's left margin; open, it becomes the close handle.
      // Its touch area grows up, down and off the screen -- never right, where
      // the first column of tiles is 8 px away.
      // 26 px at EVERY width, a wall tablet's size: a 14 px tab on a phone is
      // hard to hit with a thumb. Narrower than a wall tablet's 29.6 px
      // margin -- an iPad held upright (18.9), a phone (16) -- it lies over
      // the first column's edge; it only shows there when the screen asks for
      // it (On Narrow Screens).
      // BEHIND THE MENU (z -1 in the panel): sliding in or out it passes
      // under the material's edge, never across it.
      '.tab{position:absolute;z-index:-1;left:100%;top:var(--tab-y,84px);width:var(--tab-w,' + TAB_W + 'px);height:var(--tab-h,' + TAB_H + 'px);',
      '  box-sizing:border-box;padding:0;margin:0;border:1px solid rgba(255,255,255,0.14);border-left:0;',
      '  border-radius:0 var(--tab-r,15px) var(--tab-r,15px) 0;display:none;align-items:center;justify-content:center;',
      '  color:rgba(255,255,255,0.92);cursor:pointer;-webkit-tap-highlight-color:transparent;',
      // The chips' glass, with a thin neutral tint under it: 26 px of glass
      // over a seasonal leaf would take the leaf's color outright.
      '  background:linear-gradient(145deg,rgba(255,255,255,0.17),rgba(255,255,255,0.07)),rgba(26,30,46,0.24);',
      '  -webkit-backdrop-filter:blur(20px) saturate(1.15) brightness(0.86);',
      '  backdrop-filter:blur(20px) saturate(1.15) brightness(0.86);',
      '  box-shadow:inset 0 1px 0 rgba(255,255,255,0.20),0 6px 18px rgba(0,0,0,0.12);',
      '  transition:transform .12s ease,filter .12s ease}',
      '.root.frosted .tab{-webkit-backdrop-filter:none;backdrop-filter:none;',
      '  background:linear-gradient(145deg,rgba(255,255,255,0.18),rgba(255,255,255,0.09)),rgba(58,60,68,0.55)}',
      // the tab and the button are plates on the page: the cards' Tinted plate
      '.root.tinted .tab,.root.tinted .fab{-webkit-backdrop-filter:none;backdrop-filter:none;',
      '  background:var(--hk-glass-plate);border-color:transparent;box-shadow:var(--hk-look-shadow)}',
      // ...and Bright Glass's chip plate over its own light blur
      '.root.bright .tab,.root.bright .fab{background:var(--hk-chip-plate);border-color:transparent;box-shadow:var(--hk-look-shadow);',
      '  -webkit-backdrop-filter:var(--hk-blur-filter);backdrop-filter:var(--hk-blur-filter)}',
      '.root.tabbed .tab{display:flex}',
      // the scrolled tab: always there, out past the edge until the chip is
      // scrolled away (sync / scrolled below)
      '.root.tabscroll .tab{display:flex;transform:translateX(-100%);visibility:hidden;',
      '  transition:transform .22s ease,visibility 0s linear .22s,filter .12s ease}',
      '.root.tabscroll.tabbed .tab{transform:none;visibility:visible;',
      '  transition:transform .22s ease,visibility 0s,filter .12s ease}',
      '.root.docked .tab{display:none}',
      // CLOSED, the tab stands clear of a side safe area at the left (a phone
      // turned, its Dynamic Island there: hk-base.js SAFE); open, it is the
      // panel's handle again
      '.root:not(.open) .tab{margin-left:var(--hk-safe-left,env(safe-area-inset-left,0px))}',
      // the finger's target is bigger than the glass: above, below and out
      // over the page (the tab is on top of the page, so it may)
      '.tab::before{content:"";position:absolute;top:-16px;bottom:-16px;left:-4px;right:-14px}',
      '.tab:active{filter:brightness(1.25)}',
      '.tab hk-icon{--mdc-icon-size:var(--tab-ic,16px);width:var(--tab-ic,16px);height:var(--tab-ic,16px);display:flex;margin-left:-1px}',
      '.tab svg{display:none;margin-left:-1px;width:calc(var(--tab-ic,16px) - 2px);height:calc(var(--tab-ic,16px) - 2px)}',
      '.root.open .tab hk-icon{display:none}',
      '.root.open .tab svg{display:block}',
      // A PHONE'S HOME WITH NO CHIP to hold the menu button: a round one of
      // its own, top left. The last resort; every other page has its back
      // button, which carries the menu button on a phone.
      // (clear of a side safe area at the left, 2026-10-30: hk-base.js SAFE)
      '.fab{position:fixed;left:calc(max(var(--l,0px), var(--hk-safe-left,env(safe-area-inset-left,0px))) + 12px);',
      '  top:calc(var(--t,0px) + 12px + var(--hk-safe-top,env(safe-area-inset-top,0px)));width:40px;height:40px;',
      '  border-radius:50%;border:1px solid rgba(255,255,255,0.14);display:none;align-items:center;',
      '  justify-content:center;padding:0;color:rgba(255,255,255,0.92);cursor:pointer;',
      '  background:linear-gradient(145deg,rgba(255,255,255,0.16),rgba(255,255,255,0.07));',
      '  -webkit-backdrop-filter:blur(20px) saturate(1.4) brightness(0.82);backdrop-filter:blur(20px) saturate(1.4) brightness(0.82)}',
      '.root.fabbed .fab{display:flex}',
      '.root.open .fab{display:none}',
      '.fab hk-icon{--mdc-icon-size:20px;width:20px;height:20px;display:flex}',
      // THE EDGE SWIPE'S STRIP (wireEdge): the page's left margin, invisible,
      // under the tab (the clip paints after it). touch-action pan-y: a drag
      // up or down still scrolls the page, but a sideways one is ours -- no
      // browser takes it for a back swipe or a scroll, and no tile under it
      // takes the touch.
      // Below Home Assistant's toolbar while it shows: its menu button is there.
      '.edge{position:fixed;left:var(--l,0px);top:var(--edge-t,0px);bottom:0;width:var(--edge-w,20px);',
      '  display:none;touch-action:pan-y;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}',
      '.root.swipe .edge{display:block}',
      '.root.open .edge,.root.docked .edge{display:none}',
      // following the finger: no easing while it drags
      '.root.dragging .panel,.root.dragging .scrim{transition:none}',
      '@media (prefers-reduced-motion:reduce){.panel,.scrim,.sh svg,.row.more svg,.root.tabscroll .tab,.row.here::before{transition:none}}'
    ].join('\n');

    // what the shell and the later parts use of this one
    K.CSS = CSS;
  };
})();
