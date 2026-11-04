// hk-settings-css.js - the panel's stylesheet.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-css'] = function (KIT) {
    // ------------------------------------------------------------ the shell
    var CSS = [
      // PINNED TO THE WINDOW. Home Assistant's panel container
      // (partial-panel-resolver) has no height of its own, so height:100% grew
      // the panel to its content and the window scrolled the menu and the page
      // together. The window's height gives each its own scroll.
      ':host{height:100vh;height:100dvh}',
      // SAFE AREAS (an iPhone or iPad full screen: the web app on the Home
      // Screen, a native app's web view): the notch, the status bar and the rounded
      // corners stay out of the lists. The host keeps the window's height and
      // pads itself; the bottom (the home indicator) pads each scroller's end,
      // so rows scroll under it but the last one stops above it. env() is 0
      // everywhere else (HA's panel, a desktop browser), so nothing moves there.
      // (the sides through --hk-safe-left / -right, which a check can stand in: hk-base.js SAFE)
      ':host{box-sizing:border-box;background:var(--hk-bg);',
      '  padding:env(safe-area-inset-top,0px) var(--hk-safe-right,env(safe-area-inset-right,0px)) 0 var(--hk-safe-left,env(safe-area-inset-left,0px))}',
      '.app{display:flex;height:100%;overflow:hidden;position:relative}',
      '.side{flex:none;width:320px;height:100%;overflow-y:auto;overscroll-behavior:contain;padding:0 16px calc(40px + env(safe-area-inset-bottom,0px));',
      '  border-right:.5px solid var(--hk-sep)}',
      '.sidetop{position:sticky;top:0;z-index:2;background:var(--hk-bg);padding:10px 0 12px;margin:0 -4px;',
      '  border-bottom:.5px solid transparent;transition:border-color .2s}',
      // the list scrolled under the search: its hairline, as the top bar's
      '.side.scrolled .sidetop{border-bottom-color:var(--hk-sep)}',
      // the title on the column the search field and the lists start on (4px
      // undoes .sidetop's -4px); only with Home Assistant's ☰ in front of it
      // is the row pulled left, so the button's own padding sits in the margin
      '.sidehead{display:flex;align-items:center;gap:4px;min-height:44px;margin-left:4px}',
      '.sidehead.menubtn{margin-left:-8px}',
      '.sidehead h1{margin:0;font-family:var(--hk-display);font-size:22px;font-weight:700;letter-spacing:.01em}',
      '.search{position:relative;margin:6px 4px 0}',
      '.search input{width:100%;height:36px;border:0;border-radius:10px;padding:0 30px 0 32px;background:var(--hk-fill);',
      '  color:var(--hk-label);font:inherit;font-size:16px;outline:none}',
      '.search input::placeholder{color:var(--hk-label2)}',
      '.search input:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--hk-tint) 45%,transparent)}',
      // a block, not an inline icon on a line's baseline (which sat it 3 px low)
      '.search .mag{position:absolute;left:9px;top:9px;width:18px;height:18px;color:var(--hk-label2);--mdc-icon-size:18px;display:flex}',
      // A PICKER'S SELECT MODE (several at once): its bar under the search
      '.pickbar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:-10px 4px 12px;min-height:36px}',
      // a background photo (photoGroup): the picture at the screen's shape, and
      // what it follows under it when it isn't its own
      '.cell.photoprev{flex-direction:column;align-items:stretch;gap:6px;padding-top:12px;padding-bottom:12px}',
      '.photoprev img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:10px;background:#05070e}',
      '.photoprev small{color:var(--hk-label2);font-size:13px}',
      '.flat-image-mini{position:relative;flex:none;width:80px;height:50px;overflow:hidden;border-radius:8px;margin-right:12px;background:var(--hk-cell)}',
      '.flat-image-thumb{display:block;width:100%;height:100%;object-fit:cover}',
      '.flat-image-preview{position:relative;overflow:hidden;border-radius:10px;aspect-ratio:16/10;background:var(--hk-cell)}',
      '.flat-image-preview canvas{display:block;width:100%;height:100%;object-fit:cover}',
      '.flat-image-wash{position:absolute;inset:0;pointer-events:none}',
      '.flat-image-adjust summary{cursor:pointer;min-height:44px;border-radius:10px;background:var(--hk-cell)}',
      // LANDSCAPES (2026-10-14): the picker's grid of HK's own photos, the one
      // in use ringed and ticked
      '.cell.landcell{display:block;padding:12px}',
      '.landgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px}',
      '.landgrid button{position:relative;display:block;border:0;padding:0;border-radius:10px;overflow:hidden;cursor:pointer;background:#05070e;aspect-ratio:16/10}',
      '.landgrid img{display:block;width:100%;height:100%;object-fit:cover}',
      // THE WALLPAPERS (2026-10-30): a grid in the group's own cell, each named
      '.cell.wallgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:12px 10px;padding-top:12px;padding-bottom:12px}',
      '.wallgrid button{display:flex;flex-direction:column;gap:6px;border:0;padding:0;margin:0;background:none;cursor:pointer;font:inherit;color:inherit;text-align:center}',
      '.wallgrid img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;background:#05070e}',
      // (2026-11-01, item 45) the picture in a frame of its own, MOVES on the ones that move
      '.wallgrid .pic{position:relative;display:block}',
      '.wallgrid .mv{position:absolute;left:6px;top:6px;font-size:10px;line-height:14px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:99px;background:rgba(0,0,0,.45);color:#fff}',
      '.wallgrid span{font-size:13px;line-height:16px;color:var(--hk-label2)}',
      // THE LOOKS (2026-10-30): each a row with its picture -- its colours or its wallpaper, its accent a dot
      '.cell.look{display:flex;align-items:center;gap:12px;padding-top:10px;padding-bottom:10px;text-decoration:none;color:inherit;cursor:pointer}',
      'div.cell.look{cursor:default}',
      '.cell.look .st{display:grid;gap:2px;min-width:0}.cell.look .st b{font-weight:600}.cell.look .st small{font-size:13px;line-height:1.3;color:var(--hk-label2)}',
      '.lookart{flex:none;width:64px;height:44px;border-radius:9px;position:relative;background-size:cover;background-position:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}',
      '.lookart i{position:absolute;right:6px;bottom:6px;width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 1.5px rgba(255,255,255,.8)}',
      '.wallgrid button.on img{box-shadow:0 0 0 3px var(--hk-tint)}',
      '.wallgrid button.on span{color:var(--hk-tint);font-weight:600}',
      '.landgrid button.on{box-shadow:0 0 0 3px var(--hk-tint)}',
      '.landgrid button.on::after{content:"\\2713";position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;background:var(--hk-tint);color:#fff;font-size:14px;font-weight:700;line-height:22px;text-align:center}',
      '.pickbar .pcount{flex:1;color:var(--hk-label2);font-size:15px;padding-left:4px;white-space:nowrap}',
      '.pickbar button{border:0;background:none;color:var(--hk-tint);font:inherit;font-size:15px;padding:7px 9px;border-radius:9px;cursor:pointer;white-space:nowrap}',
      '.pickbar button.add{background:var(--hk-tint);color:#fff;font-weight:600;padding:7px 14px}',
      '.pickbar button:disabled{opacity:.4;cursor:default}',
      '.pickbar button:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--hk-tint) 45%,transparent);outline:none}',
      '.side .grp{margin-bottom:22px}',
      '.side .gh{padding-left:12px}',
      '.side .cell{padding-left:12px;min-height:44px}',
      '.side .cell.hasic + .cell::before,.side .cell + .cell.hasic::before{left:54px}',
      '.side a.cell[aria-current="page"]{background:var(--hk-sel);color:#fff}',
      '.side a.cell[aria-current="page"] .val,.side a.cell[aria-current="page"] .chev,.side a.cell[aria-current="page"] small{color:rgba(255,255,255,.8)}',
      '.side a.cell[aria-current="page"]::before,.side a.cell[aria-current="page"] + .cell::before{display:none}',
      '.side a.cell[aria-current="page"] .tile{box-shadow:0 0 0 1.5px rgba(255,255,255,.55)}',
      '.side .chev{display:none}',
      ':host(:not([wide])) .side .chev{display:block}',
      '.detail{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;position:relative}',
      '.bar{flex:none;position:absolute;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;gap:8px;height:52px;',
      '  padding:0 10px;background:var(--hk-bar);-webkit-backdrop-filter:blur(20px) saturate(1.8);backdrop-filter:blur(20px) saturate(1.8);',
      '  border-bottom:.5px solid transparent;transition:border-color .2s}',
      '.bar.scrolled{border-bottom-color:var(--hk-sep)}',
      '.bar .back{display:inline-flex;align-items:center;gap:3px;height:44px;max-width:100%;min-width:0;padding:0 8px 0 2px;border:0;',
      '  background:none;color:var(--hk-tint);font-size:17px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.bar .back svg{width:12px;height:20px;flex:none}',
      '.bar .back span{overflow:hidden;text-overflow:ellipsis}',
      '.bar .mid{flex:1;min-width:0;text-align:center;font-weight:600;font-size:17px;opacity:0;transition:opacity .2s;',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.bar.scrolled .mid{opacity:1}',
      '.bar .st{flex:1 1 0;min-width:0;display:flex;justify-content:flex-end;align-items:center;gap:5px;font-size:13px;color:var(--hk-label2)}',
      '.bar .st.err{color:var(--hk-red)}',
      '.bar .st svg{width:13px;height:13px;color:var(--hk-green)}',
      '.bar .lead{flex:1 1 0;min-width:0;display:flex;align-items:center}',
      '.bar .mid{flex:0 1 auto;max-width:50%}',
      // the title shows in the bar only once the page scrolls (its large
      // title gone): until then it takes no room, and the back button's label
      // is not cut short beside an invisible one ("Living …", 2026-09-30)
      '.bar:not(.scrolled) .mid{max-width:0}',
      '.bar:not(.scrolled) .lead{flex:0 1 auto;max-width:calc(100% - 96px)}',
      '.scroll{flex:1;overflow-y:auto;overscroll-behavior:contain;padding-top:52px}',
      '.page{max-width:680px;margin:0 auto;padding:6px 20px calc(80px + env(safe-area-inset-bottom,0px))}',
      // 32px between the columns only: between the title and the settings the
      // subtitle's own 24px, as on every page without a preview (a 32px row
      // gap on top made it 56)
      '.page.split{max-width:1240px;display:grid;grid-template-columns:minmax(0,640px) minmax(320px,1fr);gap:0 32px;align-items:start}',
      // the preview starts where the settings start -- its PREVIEW beside the
      // first section's heading, not up beside the page's title
      '.page.split{grid-template-areas:"ph ." "pc pv"}',
      '.page.split .ph{grid-area:ph}',
      '.page.split .pc{grid-area:pc}',
      // -3px: the preview's heading sits 3px lower in its box than a group's
      // (measured), so this lines both up -- PREVIEW with the first section's
      // heading, the preview with the first group
      '.page.split .pvcol{grid-area:pv;align-self:start;position:sticky;top:64px;margin-top:-3px}',
      // no heading over the first group: PREVIEW rides above it, the box level with the group
      '.page.split.nohead .pvcol{margin-top:-28px}',
      // narrower: the preview sits under the title of the screen's own page
      ':host(:not([xwide])) .page.split{display:block;max-width:680px}',
      // ...and scrolls away with the page: sticky there, the settings scrolled
      // up under it and it lay over them (2026-10-06)
      ':host(:not([xwide])) .page.split .pvcol{margin:0 0 30px;max-width:480px;position:static}',
      '.pvcol:empty{display:none}',
      // PINNED (the bar's Preview): at the top of the page, over the settings
      // as they scroll under it; the size and moment pickers stay
      ':host .page.split .pvcol.pin,:host(:not([xwide])) .page.split .pvcol.pin{position:sticky;top:0;z-index:3;margin:0 -20px 18px;',
      '  padding:8px 20px 8px;max-width:none;background:var(--hk-bg);box-shadow:0 .5px 0 var(--hk-sep)}',
      ':host(:not([wide])) .page.split .pvcol.pin{margin:0 -16px 18px;padding:8px 16px 8px}',
      '.pvcol.pin .gf,.pvcol.pin .pvhead{display:none}',
      '.pvcol.pin .pvbox{margin:0 auto}',
      '.pvcol.pin .seg{margin-top:8px}',
      // the bar's Preview button: a pin and a word (Pin, Pinned), as a
      // navigation bar's text buttons are; filled while the preview is pinned
      '.bar .pvtoggle{flex:none;height:32px;margin-right:4px;padding:0 10px 0 7px;border:0;border-radius:16px;background:none;',
      '  color:var(--hk-tint);display:flex;align-items:center;gap:3px;cursor:pointer;font:inherit;font-size:15px;white-space:nowrap}',
      '.bar .pvtoggle hk-icon{--mdc-icon-size:18px;width:18px;height:18px;display:flex}',
      '.bar .pvtoggle[aria-pressed="true"]{background:var(--hk-fill)}',
      // A HOST'S WAY OUT (settingsHost().back), over the sidebar's name
      '.hostback{display:inline-flex;align-items:center;gap:3px;height:36px;margin:4px 0 -4px -6px;padding:0 8px 0 2px;color:var(--hk-tint);',
      '  text-decoration:none;font-size:17px}',
      '.hostback svg{width:12px;height:20px;flex:none}',
      '.code{margin:-14px 0 28px;padding:12px 16px;border-radius:10px;background:var(--hk-cell);color:var(--hk-label);',
      // YAML keeps its lines (wrapped, its indentation would lie): it scrolls
      // sideways, a size smaller on a phone so most lines fit
      '  font:13px/18px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow-x:auto;user-select:text}',
      '@media (max-width:640px){.code{font-size:12px;line-height:17px}}',
      // never wider than the page: its long lines scroll inside it
      '.code{max-width:100%;min-width:0;box-sizing:border-box}',
      'h1.lt{margin:4px 0 4px;font-family:var(--hk-display);font-size:34px;line-height:41px;font-weight:700;letter-spacing:.01em;outline:none}',
      ':host([wide]) h1.lt{font-size:30px;line-height:36px}',
      // A TITLE WITH NOTHING UNDER IT (no scope line) keeps the room the line would have left before the first group:
      // its 4 px alone put the group against the title (2026-10-31, the owner: "a lot of headings ... really close to
      // the first option" -- Screensaver Options over Same as All Screens)
      '.ph.bare{margin-bottom:20px}',
      '.scope{margin:0 0 24px;font-size:15px;line-height:20px;color:var(--hk-label2)}',
      // A SCREEN'S NAME, with its pencil (renaming the dashboard): the pencil
      // beside the title, centered on its line; the field the same size as the
      // title it replaces, Save and Cancel beside it
      '.tline{display:flex;align-items:center;gap:12px;min-width:0}',
      '.tline h1.lt{min-width:0;overflow-wrap:anywhere}',
      '.ren{flex:none;width:36px;height:36px;margin-top:2px;border:0;border-radius:18px;padding:0;background:var(--hk-fill);',
      '  color:var(--hk-tint);display:flex;align-items:center;justify-content:center;cursor:pointer}',
      '.ren svg{width:17px;height:17px}',
      '.renform{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 4px}',
      '.renform input{flex:1 1 220px;min-width:0;height:44px;box-sizing:border-box;border:0;border-radius:10px;padding:0 12px;',
      '  background:var(--hk-fill);color:var(--hk-label);font-family:var(--hk-display);font-size:24px;font-weight:700;outline:none}',
      '.renform input:focus{box-shadow:0 0 0 2px var(--hk-tint)}',
      '.renform button{height:44px;padding:0 18px;border:0;border-radius:10px;font:inherit;font-size:16px;font-weight:600;cursor:pointer}',
      '.renform .ok{background:var(--hk-tint);color:#fff}',
      '.renform .ok[disabled]{opacity:.45;cursor:default}',
      '.renform .no{background:var(--hk-fill);color:var(--hk-label)}',
      '.renerr{margin:2px 0 8px;font-size:14px;line-height:18px;color:var(--hk-red)}',
      '.scope b{font-weight:600;color:var(--hk-label)}',
      '.pvbox{position:relative;width:100%;aspect-ratio:16/10;margin:0 auto;border-radius:12px;overflow:hidden;background:#000;',
      '  box-shadow:0 0 0 .5px var(--hk-sep)}',
      // the size picker under the preview: the kit's segmented control, a glyph
      // over each name. A name never wraps: when one will not fit on its line
      // (a column of about 400-470 px), every tablet drops "Tablet" together
      '.seg.pvsize{display:grid;width:100%;margin-top:12px;box-sizing:border-box}',
      '.seg.pvsize button{height:auto;min-width:0;padding:6px 2px;display:flex;flex-direction:column;align-items:center;',
      '  gap:3px;font-size:12px;line-height:14px}',
      '.seg.pvsize .lb,.seg.pvsize .sh{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.seg.pvsize .sh,.seg.pvsize.short .lb{display:none}',
      '.seg.pvsize.short .sh{display:block}',
      '.seg.pvsize hk-icon{--mdc-icon-size:20px;width:20px;height:20px;display:flex}',
      '.seg.pvsize hk-icon.rot{transform:rotate(90deg)}',
      // the sky preview's moments (Day, Night, Spooky Night), over the sizes
      '.seg.pvmoment{display:grid;width:100%;margin-top:12px;box-sizing:border-box}',
      '.seg.pvmoment button{min-width:0;padding:0 6px}',
      '.pvsky .gf{margin:8px 0 0;padding-left:4px}',
      '.pvdim{font-variant-numeric:tabular-nums}',
      '.pvbox iframe{position:absolute;top:0;left:0;width:1280px;height:800px;border:0;transform-origin:0 0;pointer-events:none}',
      '.pvhead{display:flex;align-items:baseline;justify-content:space-between;padding:0 4px 8px}',
      '.pvhead span{font-size:13px;text-transform:uppercase;color:var(--hk-label2)}',
      '.pvhead a{font-size:15px;padding:12px 4px;margin:-12px -4px}',
      '.pvcol .gf{padding-left:4px}',
      '.accwrap{--acc-cell:var(--hk-cell);--acc-sep:var(--hk-sep);--acc-label:var(--hk-label);--acc-text:var(--hk-label);',
      '  --acc-label2:var(--hk-label2);--acc-label3:var(--hk-label3);--acc-value:var(--hk-label2);--acc-fill:var(--hk-off);',
      '  --acc-seg:var(--hk-seg);--acc-seg-on:var(--hk-seg-on);--acc-glyph:var(--hk-fill);--acc-glyph-on-bg:var(--hk-tint);',
      '  --acc-glyph-on-fg:#fff;--acc-red:var(--hk-red);--acc-green:var(--hk-green);--acc-orange:var(--hk-orange);font-size:var(--hk-body)}',
      '.accwrap .acc{gap:26px}',
      '.accwrap .acc .cap{padding:0 16px 7px;font-weight:400;letter-spacing:0}',
      // (the kit's own .grp margin is not for this pane's groups: it doubled
      // every gap on an accessory's page)
      '.accwrap .acc .grp{border-radius:10px;margin:0}',
      '.accwrap .acc .row{min-height:44px}',
      '.accwrap .acc .note{padding:0 16px}',
      '.dated{display:flex;gap:6px;flex:none}',
      '.dated .pop{background:var(--hk-fill);border-radius:7px;padding:5px 10px;color:var(--hk-label)}',
      '.inl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 16px}',
      '.inl input{flex:1 1 140px;min-width:0;height:34px;border:0;border-radius:8px;padding:0 10px;background:var(--hk-fill);color:var(--hk-label);font:inherit}',
      '.inl select{height:34px;border:0;border-radius:8px;padding:0 8px;background:var(--hk-fill);color:var(--hk-label);font:inherit;font-size:16px}',
      '.dated .pop select{inset:0;width:100%}',
      '.pbtn{height:36px;padding:0 16px;border:0;border-radius:18px;background:var(--hk-tint);color:#fff;font:inherit;font-weight:600;cursor:pointer}',
      '.pbtn:disabled{opacity:.4;cursor:default}',
      '.big{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:26px 16px 30px}',
      '.big .tile{width:64px;height:64px;border-radius:15px}',
      // the icon's own class pins 22 px: the tile's size has to be on it
      '.big .tile .ic{--mdc-icon-size:38px;color:#fff}',
      '.big h2{margin:6px 0 0;font-family:var(--hk-display);font-size:28px;font-weight:700}',
      '.big p{margin:0;max-width:44ch;color:var(--hk-label2);font-size:15px;line-height:20px}',
      '.steps{font-size:13px;color:var(--hk-label2);text-align:center;margin:0 0 8px}',
      // the kit's YAML editor is the card (.codebox)
      '.yaml{display:block}',
      'pre.ex{margin:0;padding:12px 16px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--hk-label);white-space:pre-wrap}',
      '.skycolors{display:flex;gap:8px;flex-wrap:wrap}.skycolors input[type=color]{width:44px;height:44px;padding:3px;border:1px solid var(--hk-label2);border-radius:8px;background:transparent}',
      '.ok{color:var(--hk-green)} .warn{color:var(--hk-orange)} .note{color:var(--hk-label2)}',
      // A TABLET'S DAY LEFT ALONE (Wall Tablets, 1.14): Touched -> Home ->
      // the screensaver -> dark, each where it starts
      '.cell.tl{display:block;padding:14px 16px 12px}',
      '.tl .track{display:flex;height:30px;border-radius:8px;overflow:hidden;gap:2px}',
      '.tl .seg{display:flex;align-items:center;justify-content:center;min-width:0;padding:0 6px;font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tl .use{background:#0a84ff}.tl .home{background:#30b0c7}.tl .saver{background:#bf5af2}.tl .dark{background:#636366}',
      '.tl .ticks{position:relative;height:34px;margin-top:6px;font-size:12px;line-height:16px;color:var(--hk-label2)}',
      '.tl .ticks span{position:absolute;top:0;padding-left:6px;border-left:1px solid var(--hk-sep);white-space:nowrap}',
      '.tl .ticks b{display:block;color:var(--hk-label);font-weight:600}',
      '.tl .tlwarn{margin-top:8px;color:var(--hk-orange);font-size:13px;line-height:18px}',
      '.url{font:13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;color:var(--hk-label)}',
      '.live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      '.loading{display:flex;align-items:center;justify-content:center;height:100%;color:var(--hk-label2)}',
      // ONE COLUMN (phones, narrow windows): the list is its own page
      ':host(:not([wide])) .side{width:100%;border-right:0;padding:0 16px calc(40px + env(safe-area-inset-bottom,0px))}',
      ':host(:not([wide])) .sidehead h1{font-size:34px;line-height:41px}',
      ':host(:not([wide])) .app[data-view="root"] .detail{display:none}',
      ':host(:not([wide])) .app[data-view="detail"] .side{display:none}',
      ':host(:not([wide])) .page{padding:6px 16px calc(80px + env(safe-area-inset-bottom,0px))}',
      // AT LEAST ONE SCREEN TALL: on a phone nothing above gives the page a
      // height, so `height:100%` would be the content's, and a short page
      // would end in a band of Home Assistant's own gray under it
      ':host(:not([wide])){min-height:100vh;min-height:100dvh}'
    ].join('\n');

    // what the shell and the later parts use of this one
    KIT.CSS = CSS;
  };
})();
