// hk-sidepane-css.js - the pane's CSS.
//
// PART OF THE SIDE PANE (hk-sidepane.js). Not a card and not run on its own: it registers one
// function, which hk-sidepane.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSidePaneParts = window.hkSidePaneParts || {})['hk-sidepane-css'] = function (K) {
    var C = K.C;

    // ------------------------------------------------------------ the CSS
    // Built on first use: never hkCards while this file loads (DESIGN.md
    // Rules 1). Logical sizes (a 400 px pane), scaled whole by the pane.
    // (built before hkCards has come, the design values have fallbacks of their
    // own, and it is not kept: drawn again once hkCards is here -- the pane
    // hangs under <body>, where no --hk-* value is set, and a sheet built
    // without fallbacks lost its hairlines and its second ink for good, on
    // whichever load drew it first -- the owner's dividers that came and went,
    // 2026-10-30)
    var CSS = null, BARE = { ink: '#fff', 'ink-2': 'rgba(235,235,245,0.6)', line: 'rgba(255,255,255,0.14)',
      'line-strong': 'rgba(255,255,255,0.22)', key: 'rgba(118,118,128,0.24)', 'key-strong': 'rgba(118,118,128,0.36)' };
    var WX_LAST = {};
    function cssReady() { var K = C(); return !!(K && K.v); }
    function css() {
      if (CSS) return CSS;
      var K = C(), v = K && K.v ? K.v : function (n) { return 'var(--hk-' + n + (BARE[n] ? ',' + BARE[n] : '') + ')'; }, R = (K && K.SP && K.SP.cardR) || 20;
      var out = [
        // (above the page, as Now Playing's pane was; under the menu, the tab bar and every sheet)
        ':host{position:fixed;z-index:5;display:none;box-sizing:border-box;color:' + v('ink') + ';font-family:var(--hk-font-body,inherit);',
        '  -webkit-tap-highlight-color:transparent;contain:layout style}',
        ':host([on]){display:block}',
        // (going: drawn while it slides away, never pressed -- _slide)
        ':host([leaving]:not([on])){display:block;pointer-events:none}',
        // (a swipe toward a page that has it: shown under the finger before it is on -- FOLLOW)
        ':host([peek]:not([on])){display:block;pointer-events:none}',
        ':host([mode="saver"]){position:absolute}',
        // A WIDGET on the Pages screen (Phase J; section() below): one section, filling its slot, no pane of its own
        ':host([mode="widget"]){position:absolute;inset:0}',
        // THE PANE: the docked side menu's material in the screen's look
        // (hk-menu.js .mat; the host's `look`, sync() below), as Now Playing's
        // pane was a frosted sheet -- one live blur, the page and the sky seen
        // through it. It was a near-solid navy plate (.92-.97) once, its blur
        // hidden under it (the owner, 2026-10-30: "the side pane isn't blurred
        // anymore?"). Its edge and shadow toward the page (a left pane's mirrored).
        '.pane{position:absolute;inset:0;overflow:hidden;background:rgba(28,28,32,0.52);',
        '  -webkit-backdrop-filter:blur(34px) saturate(1.9);backdrop-filter:blur(34px) saturate(1.9)}',  // hkCards.BLUR.heavy
        // Frosted and Tinted: no blur, near-solid, as the menu's (the pane is
        // always up on a wall tablet); the slow tablets' Flat the same
        ':host([look="frosted"]) .pane{background:rgba(34,38,56,0.95);-webkit-backdrop-filter:none;backdrop-filter:none}',
        ':host([look="tinted"]) .pane,:host([look="flat"]) .pane{background:rgba(24,24,28,0.93);-webkit-backdrop-filter:none;backdrop-filter:none}',
        // Bright Glass: the white wash over its light blur, the rim on the page side
        ':host([look="bright"]) .pane{background:linear-gradient(150deg,rgba(255,255,255,0.30),rgba(255,255,255,0.14));',
        '  -webkit-backdrop-filter:blur(4px) saturate(1.3) brightness(1.08);backdrop-filter:blur(4px) saturate(1.3) brightness(1.08)}',
        ':host([look="bright"][side="right"]) .pane{border-left:0;box-shadow:inset 1.5px 0 0 rgba(255,255,255,0.22),-18px 0 44px rgba(0,0,0,.18)}',
        ':host([look="bright"][side="left"]) .pane{border-right:0;box-shadow:inset -1.5px 0 0 rgba(255,255,255,0.22),18px 0 44px rgba(0,0,0,.18)}',
        ':host([look="bright"][side="band"]) .pane{border-top:0;box-shadow:inset 0 1.5px 0 rgba(255,255,255,0.22),0 -18px 44px rgba(0,0,0,.18)}',
        ':host([look="bright"]) .pin{text-shadow:0 1px 2px rgba(0,0,0,0.22)}',
        ':host([side="right"]) .pane{border-left:1px solid ' + v('line') + ';box-shadow:-18px 0 44px rgba(0,0,0,.30)}',
        ':host([side="left"]) .pane{border-right:1px solid ' + v('line') + ';box-shadow:18px 0 44px rgba(0,0,0,.30)}',
        ':host([side="band"]) .pane{border-top:1px solid ' + v('line') + ';box-shadow:0 -18px 44px rgba(0,0,0,.30)}',
        // DIM (the pane's Dim, dress() below): a shade over the glass and the album art, under the words
        ':host([dim]) .pane::before{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;background:rgba(0,0,0,var(--pane-dim,0))}',
        ':host([dim]) .pin{z-index:2}',
        ':host([mode="saver"]) .pane::before,:host([mode="widget"]) .pane::before{display:none}',
        // IN THE SCREENSAVER: on its pane's own background, under Home Status
        ':host([mode="saver"]) .pane{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:0;box-shadow:none}',
        // THE ALBUM ART behind the whole pane while a song plays (_artBg): two
        // canvases cross-fading, a shade for the words; a flat tint where the
        // look has no blur
        '.artbg{position:absolute;inset:0;opacity:0;transition:opacity 1.2s ease;pointer-events:none;overflow:hidden;background:#141418}',
        ':host([arted]) .artbg{opacity:1}',
        '.artbg b{position:absolute;left:-8%;top:-8%;width:116%;height:116%;display:block;opacity:0;transition:opacity 1.2s ease;background-size:cover;background-position:center}',
        '.artbg b.on{opacity:1}',
        '.artbg b.raw{background-size:cover;background-position:center;filter:blur(40px) brightness(.7)}',
        '.artbg i{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(6,10,18,.24),rgba(6,10,18,.34))}',
        ':host([arttint]) .artbg{background:var(--art-tint,#1c1c22)}:host([arttint]) .artbg b,:host([arttint]) .artbg i{display:none}',
        ':host([artdim]) .artbg{background:#0b0c0f}.artbg b.dim{left:0;top:0;width:100%;height:100%}.artbg b.dim.on{opacity:var(--hk-flat-art,.3)}',
        '@media (prefers-reduced-motion:reduce){.artbg,.artbg b{transition:none}}',
        '.pin{position:absolute;left:0;top:0;transform-origin:0 0;box-sizing:border-box;display:flex;flex-direction:column;padding:30px 28px 26px}',
        ':host([side="band"]) .pin{padding:20px 24px}',
        ':host([mode="saver"]) .pin{padding:4px 28px 22px}',
        ':host([mode="widget"]) .pane{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:0;box-shadow:none}',
        ':host([mode="widget"]) .pin{padding:0}',
        // THE SAME ROOM ABOVE AS AT THE SIDE (2026-10-31, the owner: "so much buffer/padding above the time"): the
        // pane's 30 px, the first section's own 14 and the clock's leading put its digits ~55 px down against 28 at the
        // right. Beside the page: the top inset the sides', the first section none of its own, and the big time trimmed
        // to its figures' height (text-box; where a browser has none, only the leading is left)
        ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .pin{padding-top:28px;padding-bottom:28px}',
        // ...and at the foot the same (2026-10-31, the owner: room under Security): the last section none of its own
        ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .secs>.sec:last-child:not(.cam2):not(.mp){padding-bottom:0}',
        ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .secs>.sec:first-child:not(.cam2):not(.mp){padding-top:0}',
        ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .secs>.sec[data-k="clock"]:first-child .big2{text-box:trim-start cap alphabetic}',
        ':host([mode="widget"]) .secs>.sec{flex:1 1 auto}',
        '.secs{display:flex;flex-direction:column;gap:12px;flex:1 1 auto;min-height:0;overflow:hidden}',
        // (...room at its sides for what reaches a little past a section's edge -- the clock's digits pulled back by
        // their side bearing: this column's clip still cut the 8 and the 9, 2026-10-31, the owner -- given back by a
        // margin, so nothing moves)
        ':host(:not([mode="widget"])) .secs{padding:0 8px;margin:0 -8px}',
        ':host([side="band"]) .secs{flex-direction:row;align-items:stretch}',
        ':host([side="band"]) .secs>.sec{flex:1 1 0;min-width:0}',
        '.secs>*{flex:none}',
        '.secs>.grow{flex:1 1 auto;min-height:0}',
        '.sec{background:' + v('key') + ';border-radius:' + R + 'px;padding:14px 16px;display:grid;gap:8px;align-content:start;box-sizing:border-box;overflow:hidden}',
        '.sec.cmp{padding:11px 16px}',
        // ON THE PANE (not a band, not a Pages-screen widget): the sections sit
        // straight on its glass, a hairline between them, no plates
        ':host(:not([mode="widget"]):not([side="band"])) .secs{gap:0}',
        ':host(:not([mode="widget"]):not([side="band"])) .sec:not(.cam2):not(.mp){background:none;border-radius:0;padding:14px 0}',
        ':host(:not([mode="widget"]):not([side="band"])) .sec.cmp:not(.cam2){padding:11px 0}',
        ':host(:not([mode="widget"]):not([side="band"])) .sec+.sec{border-top:1px solid ' + v('line') + '}',
        ':host(:not([mode="widget"]):not([side="band"])) .sec.cam2{margin:14px 0}',
        // (the music pane on the pane's ground, not a box: its line above straight)
        ':host(:not([mode="widget"]):not([side="band"])) .sec.mp{border-radius:0}',
        '.sec>.ev:last-child{border-bottom:0}',
        '.h2{display:flex;align-items:center;gap:6px;font:600 13px/1 var(--hk-font-body,inherit);letter-spacing:.3px;text-transform:uppercase;color:' + v('ink-2') + '}',
        // (the Clock's Size and Weight are --cks and --ckw, set by a section's classes; unset they are today's 72 / 48 px, 600)
        '.big2{font:var(--ckw,600) calc(72px*var(--cks,1))/1 var(--hk-font-body,inherit);letter-spacing:calc(-2px*var(--cks,1));font-variant-numeric:tabular-nums}',
        '.big2.less{font-size:calc(48px*var(--cks,1));letter-spacing:calc(-1.2px*var(--cks,1))}',
        '.cks-small{--cks:.75}.cks-large{--cks:1.25}.ckw-light{--ckw:300}.ckw-regular{--ckw:400}.ckw-bold{--ckw:700}',
        '.tm{white-space:nowrap}.tm small{font-size:.36em;font-weight:600;letter-spacing:0;margin-left:.18em;color:' + v('ink-2') + '}',
        // (the Clock lined up: the digits' side bearing taken back, so their ink starts where the date's does; AM
        // on their baseline; the date at the left, the sunset at the right)
        '.ck .tm{display:flex;align-items:baseline;margin-left:-0.05em}.ck .tm small{margin-left:.14em}',
        '.ckd{display:flex;justify-content:space-between;align-items:baseline;gap:4px 12px;flex-wrap:wrap}.ckd>*{white-space:nowrap}.ckd .sun{margin-left:auto}',
        // (a narrow pane: the date short, "Sat, Oct 31", so the sunset keeps its place at the right of it)
        '.sec[data-k="clock"]{container-type:inline-size}.ckd .ds{display:none}',
        // (the digits pulled back by their side bearing reach past the section's edge -- beside the page a section has
        // no side padding, and its clip cut the 8's left side off: 2026-10-31, the owner. The clock is never scrolled)
        '.sec[data-k="clock"]:not(.grow){overflow:visible}',
        // THE WEATHER BESIDE THE TIME (besideWeather): two rows on two baselines (2026-10-31, the owner: the date and the
        // sky "should line up") -- the time and the temperature, their figures on one baseline (the temperature two
        // thirds of the time's size, so it sits lower rather than growing heavy); the date and the sky on the next. The
        // time's side takes the room; the weather's is as wide as it needs. A second line runs under both
        '.ckrow{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"t w" "d s";column-gap:12px;row-gap:8px;align-items:baseline}',
        '.ckrow>.big2{grid-area:t;min-width:0}.ckrow>.ckx{grid-area:w}.ckrow>.ckd{grid-area:d;min-width:0}.ckrow>.ckxs{grid-area:s}.ckrow>.ck2{grid-column:1 / -1}',
        '.ckx{justify-self:end;white-space:nowrap;font:var(--ckw,600) calc(48px*var(--cks,1))/1 var(--hk-font-body,inherit);letter-spacing:calc(-1px*var(--cks,1))}',
        // (the figures are a <b>, which a browser draws a step BOLDER than the clock's own weight: 56° heavier than the
        // time it sits beside -- 2026-11-01, the owner. They take the clock's weight, as the time does)
        '.ckx b{font-weight:inherit}',
        // (the time's row ends at its figures' baseline, and the temperature's: the date sits the row gap under them,
        // not under the room a line of 48 px figures keeps below them -- 2026-11-01, the owner, on the mock-ups)
        '.ckrow>.big2,.ckrow>.ckx:not(.chip){text-box:trim-end cap alphabetic}.ckrow{row-gap:10px}',
        // (...and the first section's, whose top is trimmed to the figures' cap already: both ends)
        ':host(:not([mode="widget"]):not([mode="saver"]):not([side="band"])) .secs>.sec[data-k="clock"]:first-child .ckrow>.big2{text-box:trim-both cap alphabetic}',
        // QUIET: half the time's size, regular, the glyph in the date's gray
        '.ckx.q{font-weight:400;font-size:calc(34px*var(--cks,1));letter-spacing:0}.ckrow:has(.big2.less)>.ckx.q{font-size:calc(26px*var(--cks,1))}',
        '.ckx.q .wxg,.ckx.q hk-icon{opacity:.75}',
        // A CHIP: a small pill, level with the time's middle
        '.ckrow>.ckx.chip,.ckrow:has(.big2.less)>.ckx.chip{align-self:center;font:600 calc(20px*var(--cks,1))/1 var(--hk-font-body,inherit);letter-spacing:0}',
        '.ckx.chip .pill{display:inline-block;padding:9px 14px;border-radius:999px;background:' + v('line') + ';text-box:trim-both cap alphabetic;white-space:nowrap}',
        '.ckx.chip .wxg,.ckx.chip hk-icon{--gh:1.05em;--gg:.3em}',
        // ON THE DATE LINE: the time has its row to itself; the weather at the date's size, on the date's line
        '.ckrow.ckw-date{grid-template-areas:"t t" "d s"}.cka-right .ckrow.ckw-date{grid-template-areas:"t t" "s d"}',
        '.ckxs.dl2{color:' + v('ink-2') + '}.ckxs.dl2 b{font-weight:600;color:' + v('ink') + ';margin-right:.25em}',
        '.ckxs.dl2 .wxg,.ckxs.dl2 hk-icon{--gh:1.15em;--gg:.3em;opacity:.85}',
        '.cka-center .ckrow.ckw-date{grid-template-areas:"t" "d" "s"}',
        // (a narrow pane: the date and the temperature keep the line; the sky's words go -- centered, it has a line of its own)
        '@container (max-width:340px){.ckby:not(.cka-center) .dl2 .cn{display:none}}',
        // (the glyph inline, centered on the figures, so the line's baseline is the figures')
        // (centered on the figures: the glyph's drawing sits low in its box -- its ink measured 5 px under the digits' at 36 px,
        // 2026-11-01, the owner: "the glyph/icon sitting too low" -- so the box is raised by that, a seventh of the size)
        // THE GLYPH'S BOX, every look the same way (its ink is the viewBox: inkGlyph): --gh tall, wider than tall so a wide
        // symbol is as tall as a square one, its middle on the middle of the figures' caps (SF's cap height, .705 em),
        // --gg from the figures. A Material stand-in (no glyphs uploaded) keeps its own padding.
        '.ckx .wxg,.ckx hk-icon,.dl2 .wxg,.dl2 hk-icon{--gh:.82em;--gg:.24em;display:inline-block;width:calc(var(--gh) * 1.3);height:var(--gh);--mdc-icon-size:var(--gh);',
        '  vertical-align:calc(.3525em - var(--gh) / 2);margin-right:var(--gg);flex:none}',
        '.ckx .wxg svg,.dl2 .wxg svg{display:block;width:100%!important;height:100%!important;vertical-align:0!important}',
        '.ckxs{justify-self:end;text-align:right;white-space:nowrap}',
        '.ckrow:has(.big2.less)>.ckx{font-size:calc(36px*var(--cks,1))}',
        // (a narrow pane: the high goes, then the date's long form -- the time keeps its room)
        '@container (max-width:300px){.ckxs .hl{display:none}}',
        // (the time at the right: the weather at the left, mirrored -- 2026-10-31, the owner; centered: under the time)
        '.cka-right .ckrow{grid-template-columns:auto minmax(0,1fr);grid-template-areas:"w t" "s d"}',
        '.cka-right .ckx,.cka-right .ckxs{justify-self:start;text-align:left}',
        '.cka-center .ckrow{grid-template-columns:1fr;grid-template-areas:"t" "d" "w" "s";justify-items:center}.cka-center .ckx,.cka-center .ckxs{justify-self:center;text-align:center}',
        '.cka-center .ckrow>.ckx{margin-top:10px}',
        // ...and the date's line beside the weather has no room for the sunset at its right (it wrapped under, off to
        // the side -- 2026-10-31): there the sunset is a line of its own under the date, on the time's side
        '.ckby .ckd{flex-direction:column;flex-wrap:nowrap;gap:4px}.ckby .ckd .sun{margin-left:0}',
        // UNDER THE TIME (underTime): the clock's width, under a hairline, whatever the alignment
        '.ckb{border-top:1px solid ' + v('line') + ';padding-top:12px;margin-top:4px;text-align:left;justify-self:stretch;width:100%;box-sizing:border-box}',
        '.ckrow>.ckb{grid-column:1 / -1}',
        '.ckb.hrs{text-align:center}',
        // ...the sun's day: its arc, gone over in the sun's colours, the sun where it is; sunrise, daylight, sunset
        '.cksun svg{display:block;width:100%;height:auto;overflow:visible}',
        '.cksl{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;white-space:nowrap}',
        '.cksl span{display:inline-flex;align-items:center;gap:4px}.cksl hk-icon{--mdc-icon-size:16px;width:16px;height:16px;color:#ffd60a}',
        '@container (max-width:300px){.cksl .ckdl{display:none}}',
        // ...the moon: tonight's, drawn, its name and how much is lit, the next full or new moon
        '.ckmoon{display:flex;align-items:center;gap:14px}.ckmoon .moon{flex:none;filter:drop-shadow(0 0 6px rgba(242,240,230,.25))}',
        '.ckmoon b{display:block;font:600 17px/1.3 var(--hk-font-body,inherit)}',
        // ...the conditions: up to four readings, each its glyph, its value and its name
        '.ckrd{display:grid;grid-template-columns:repeat(var(--n,4),1fr);text-align:center;gap:6px}',
        '.ckrd hk-icon{--mdc-icon-size:20px;width:20px;height:20px;display:block;margin:0 auto 4px;color:' + v('ink-2') + '}',
        '.ckrd b{display:block;font:600 16px/1.25 var(--hk-font-body,inherit);white-space:nowrap}.ckrd span{display:block;font:500 12px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
        '.ckby.cka-right .ckd{align-items:flex-end}.ckby.cka-center .ckd{align-items:center}',
        '@container (max-width:320px){.ckd .ds{display:inline}.ckd:has(.ds) .dl{display:none}}',
        // THE CLOCK'S CHOICES (item 43): Stacked (the hours over the minutes), Analog (the small face with the time and date
        // beside it), Alignment, the second line, and the flashing colon (held under Reduce Motion as well as by skyLook())
        '.big2.stk{font-size:calc(60px*var(--cks,1));line-height:.92;letter-spacing:calc(-1.5px*var(--cks,1))}.big2.stk.less{font-size:calc(40px*var(--cks,1))}',
        '.stk .tm{display:flex;flex-direction:column;align-items:flex-start;margin-left:-0.05em}',
        '.sec[data-k="clock"].grow .big2.stk{font-size:calc(120px*var(--cks,1))}',
        '.ckan{display:flex;align-items:center;gap:16px;min-width:0}',
        '.ckan .face{width:calc(88px*var(--cks,1));height:auto;flex:none}.sec[data-size="less"] .ckan .face{width:calc(68px*var(--cks,1))}',
        '.ckt{display:grid;gap:4px;min-width:0}.ckt b{font:var(--ckw,600) calc(24px*var(--cks,1))/1.1 var(--hk-font-body,inherit);font-variant-numeric:tabular-nums;white-space:nowrap}',
        '.ckt .sub2{font-size:calc(15px*var(--cks,1))}.sub2.ck2{font-size:15px}',
        '.cka-center,.cka-center .sub2{text-align:center}.cka-right,.cka-right .sub2{text-align:right}',
        '.cka-center .ck .tm,.cka-center .ckd,.cka-center .ckan{justify-content:center}.cka-right .ck .tm,.cka-right .ckd,.cka-right .ckan{justify-content:flex-end}',
        '.cka-center .ckd .sun,.cka-right .ckd .sun{margin-left:0}.cka-right .ck .tm{margin-left:0}',
        '.cka-center .stk .tm{align-items:center;margin-left:0}.cka-right .stk .tm{align-items:flex-end}',
        '.cka-right .facebox{justify-items:end}',
        '@keyframes ckblink{0%,49%{opacity:1}50%,100%{opacity:.25}}.ckc{animation:ckblink 2s steps(1) infinite}',
        '@media (prefers-reduced-motion:reduce){.ckc{animation:none}}',
        '.wxg{display:inline-grid;place-items:center;flex:none}.hrs .wxg{display:grid;margin:2px auto}',
        '.sub2{font:500 17px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
        '.sub2.ctr{text-align:center}',
        '.r2{display:flex;align-items:center;gap:10px;font:600 17px/1.3 var(--hk-font-body,inherit);min-width:0}',
        '.r2 hk-icon{--mdc-icon-size:22px;width:22px;height:22px;flex:none}',
        '.r2 .tx{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.r2 .v2{margin-left:auto;color:' + v('ink-2') + ';font-weight:500;white-space:nowrap}',
        '.r2.warn .v2,.r2.heat hk-icon{color:#ff9f0a}.r2.cool hk-icon{color:#64d2ff}',
        '.r2.big{font-size:22px}.r2.big hk-icon{--mdc-icon-size:30px;width:30px;height:30px;color:#30b0c7}',
        // (Security at Less: what is open at the right, on the state's baseline, at the second line's size)
        '.r2.big .v2.sub2{align-self:baseline;font:500 15px/1.3 var(--hk-font-body,inherit);flex:none}.r2.big:has(.v2) .tx{align-self:baseline}',
        // A STATUS: its glyph the ink unless it has a color of its own (set on the glyph); at Less the name over the
        // label, as the status chip has them
        '.stt .r2.big hk-icon{color:inherit}',
        '.st2 .tx b{display:block;font:600 19px/1.25 var(--hk-font-body,inherit);overflow:hidden;text-overflow:ellipsis}',
        '.st2 .tx i{display:block;font:500 15px/1.3 var(--hk-font-body,inherit);font-style:normal;color:' + v('ink-2') + ';overflow:hidden;text-overflow:ellipsis}',
        '.cd{font-variant-numeric:tabular-nums;color:#ff9f0a}',
        // A TIMER'S ROW: the ring (the pause) at the left, the time over its name, the red Stop at the right
        '.tmr{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"r t s" "r n s";column-gap:12px;align-items:center;--ring:56px}',
        '.tmr hk-countdown{grid-area:t;align-self:end;font:400 24px/1.15 var(--hk-font-body,inherit);font-variant-numeric:tabular-nums;color:' + v('ink') + '}',
        '.tmr .tn{grid-area:n;align-self:start;min-width:0;font:500 14px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.tpr,.tst{all:unset;box-sizing:border-box;position:relative;display:grid;place-items:center;border-radius:50%;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.tpr{grid-area:r;width:var(--ring);height:var(--ring)}',
        '.tpr svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}',
        '.tpr circle{fill:none;stroke-width:10px;stroke:' + v('line-strong') + '}',
        '.tpr .l{stroke:#ff9f0a;stroke-linecap:round;stroke-dasharray:calc(var(--hk-left,1)*100) 100}',
        '.tpr hk-icon{position:relative;--mdc-icon-size:20px;width:20px;height:20px;color:#ff9f0a}',
        '.tst{grid-area:s;width:44px;height:44px;background:#ff453a}',
        '.tst hk-icon{--mdc-icon-size:20px;width:20px;height:20px;color:#fff}',
        '.tpr:active,.tst:active{transform:scale(0.95)}',
        '.tpr:focus-visible,.tst:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
        '.sec[data-size="less"] .tmr{--ring:44px}.sec[data-size="less"] .tmr hk-countdown{font-size:20px}',
        '.wnow{display:flex;align-items:center;gap:12px}',
        '.wnow hk-icon{--mdc-icon-size:44px;width:44px;height:44px;color:#ffd60a}',
        '.wnow b{font:600 44px/1 var(--hk-font-body,inherit);letter-spacing:-1px}',
        '.hrs{display:grid;grid-template-columns:repeat(5,1fr);text-align:center;font:600 13px/1.5 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
        '.hrs b{display:block;color:' + v('ink') + ';font-size:16px}',
        '.hrs hk-icon{--mdc-icon-size:18px;width:18px;height:18px;color:#ffd60a;display:block;margin:2px auto}',
        '.ev{display:grid;grid-template-columns:4px 1fr;gap:12px;align-items:start;padding:7px 0;border-bottom:1px solid ' + v('line') + '}',
        '.ev:last-child{border-bottom:0}',
        '.ev .cb{width:4px;border-radius:2px;align-self:stretch}',
        '.ev .et{min-width:0}',
        '.ev .et b{display:block;font:600 17px/1.3 var(--hk-font-body,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ev .et i{font:500 13px/1.3 var(--hk-font-body,inherit);font-style:normal;color:' + v('ink-2') + '}',
        // a day's heading over its events (the last event before the next day keeps no rule under it)
        '.evd{font:600 13px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + ';padding:12px 0 2px}',
        '.evd:first-child{padding-top:0}',
        '.ev:has(+ .evd){border-bottom:0}',
        '.np .art{width:56px;height:56px;border-radius:10px;object-fit:cover;flex:none;background:' + v('key') + ';display:grid;place-items:center}',
        '.np .tx{overflow:visible}.np .tx > b{display:block;overflow:hidden;text-overflow:ellipsis}.np .tx > i{display:block;font:500 15px/1.3 var(--hk-font-body,inherit);font-style:normal;color:' +
          v('ink-2') + ';overflow:hidden;text-overflow:ellipsis}',
        // BARE BUTTONS (2026-11-07, the owner: "do we need the wells (circles) behind the icons?"): the glyphs bigger,
        // each its whole button to tap; a press dims it
        '.pp{all:unset;cursor:pointer;flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%}',
        '.pp hk-icon{--mdc-icon-size:28px;width:28px;height:28px}',
        '.pp:active{opacity:.5}',
        '.cmp .pp{width:30px;height:30px}',
        // THE CONTROLS STRIP (hk-np-strip.js; 2026-11-09): its geometry, this pane's sizes -- the keys 44 px targets, play /
        // pause 52, the volume's row 44 (its slider as tall), 12 px clear above it; the progress bar to the pause glyph's ink
        // as far as that ink to the volume's track (player_look.js)
        window.hkNpStrip.CSS,
        // (the pane is drawn scaled -- 0.85 to 1.3, its .pin -- and a target is 44 px on the screen, the clear room 12: --hks-min
        // and --hks-g2 undo the scale)
        '.sec .hks{--hks-min:calc(44px / var(--hk-pin-z,1));--hks-g2:calc(12px / var(--hk-pin-z,1));',
        '  --hks-g1:calc(var(--hks-g2) + var(--_vh) / 2 - 3px);margin-top:14px;--hks-b:44px;--hks-pp:52px;--hks-x:44px;--hks-gb:34px;--hks-gpp:46px;--hks-gx:24px;--hks-th:0px;',
        '  --hks-ink:' + v('ink') + ';--hks-ink2:' + v('ink-2') + '}',
        '.sec[data-size=less] .hks{margin-top:0;--hks-g1:10px}',
        // (the speaker line: the label's size, a 44 px touch area on the screen; Up Next at the keys' right end, empty
        // where the queue is listed right under them -- mockup 12h, 2026-11-09)
        '.np .tx .hksl{display:flex;width:max-content;font-size:13px;line-height:18px;font-weight:600;color:' + v('ink-2') + ';--hksl-h:calc(44px / var(--hk-pin-z,1))}',
        '.np .tx .hksl-t i{display:none}',
        '.sec:has(.npqueue) .hks [data-act=queue]{visibility:hidden;pointer-events:none}',
        // (THE GAP BESIDE THE COVER IS ITS MARGIN (2026-11-09, the owner: "generally I'd like the same margin/gap from
        // the album art to the edge as the album art to the text on the right"): on a plate -- a band's, a widget's --
        // the section's 16 px inset; on the pane's own ground the pane's 28)
        '.r2.np{gap:16px}:host(:not([mode="widget"]):not([side="band"])) .r2.np{gap:28px}',
        '.np2 .art{width:88px;height:88px;border-radius:12px}.np2 .tx > b{font-size:20px}',
        '.npp{height:4px;border-radius:2px;background:' + v('line-strong') + ';overflow:hidden}',
        '.npp i{display:block;height:100%;background:' + v('ink') + ';transform-origin:left center}',
        // UP NEXT SCROLLS (2026-11-09, the owner: "the up next should scroll ... in all of the music players that show up
        // next"): every song in the queue, in a box as tall as the room the sections leave (_queue sets its height); the
        // heading stays above, the rows (.qs) scroll by finger with no scrollbar drawn and a soft fade at the foot while
        // more are below (the `more` mark, set on scroll)
        '.npqueue{display:flex;flex-direction:column;box-sizing:border-box;gap:6px;margin-top:12px;padding-top:16px;border-top:1px solid ' + v('line') + '}',
        '.npqueue .qs{display:grid;gap:6px;align-content:start;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;',
        '  -webkit-overflow-scrolling:touch;touch-action:pan-y;scrollbar-width:none}',
        '.npqueue .qs::-webkit-scrollbar{display:none}',
        '.npqueue .qs[more]{-webkit-mask-image:linear-gradient(180deg,#000 80%,transparent);mask-image:linear-gradient(180deg,#000 80%,transparent)}',
        '.npqueue .qh{flex:none}',
        '.npqueue .qh{all:unset;display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-size:13px;font-weight:600;color:' + v('ink-2') + ';height:28px}',
        '.npqueue .qh span{font-size:12px;font-weight:500}',
        '.npqueue .qr{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;height:56px;cursor:pointer;border-radius:10px;min-width:0}',
        '.npqueue .qr:active{background:' + v('key') + '}',
        '.npqueue button:focus-visible{outline:2px solid ' + v('ink') + ';outline-offset:2px}',
        '.npqueue .qa{width:48px;height:48px;flex:none;border-radius:8px;background:' + v('key') + ' center/cover no-repeat;display:grid;place-items:center}',
        '.npqueue .qa hk-icon{--mdc-icon-size:22px;width:22px;height:22px;color:' + v('ink-3') + '}',
        '.npqueue .qt{min-width:0;flex:1}.npqueue b,.npqueue small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.npqueue b{font-size:15px;font-weight:600}.npqueue small{font-size:13px;color:' + v('ink-2') + ';margin-top:2px}',
        '@keyframes npp{to{transform:scaleX(1)}}',
        '@media (prefers-reduced-motion:reduce){.npp i{animation:none!important}}',
        // (each speaker a centered box: hk-icon's own box is inline, so the small one sat on its text line, below the
        // slider's -- the owner, 2026-11-01)
        '.hks .mvs{cursor:pointer;touch-action:pan-y}.hks .mvs input{flex:1;min-width:0;-webkit-appearance:none;appearance:none;height:100%;background:transparent;margin:0;pointer-events:none}',
        // (filled with the ink up to the level, as the screensaver slide's volume and every player's, 2026-11-07)
        '.hks .mvs input::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(to right,' + v('ink') + ' 0 var(--f,0%),' + v('line-strong') + ' var(--f,0%) 100%)}',
        '.hks .mvs input::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-8px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3)}',
        '.hks .mvs input::-moz-range-track{height:6px;border-radius:3px;background:linear-gradient(to right,' + v('ink') + ' 0 var(--f,0%),' + v('line-strong') + ' var(--f,0%) 100%)}',
        '.hks .mvs input::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:50%;background:#fff}',
        // the screensaver's music pane, in a section: More is its art and
        // controls at the pane's width; Full takes what is left
        '.sec.mp{padding:0;display:block;position:relative;height:540px;background:none;overflow:visible}',
        '.sec.mp.grow{height:auto;min-height:540px}',
        // (More: the compact player, its Up Next and album left out)
        '.sec.mp.compact{height:430px}',
        // AT THE FOOT: the space between the top sections and the bottom ones
        '.secs>.gap{flex:1 1 auto;min-height:0;border:0}',
        ':host([side="band"]) .secs>.gap{flex:0 0 0}',
        // THE CALENDAR'S EVENTS at More and Full: scrolling inside the section
        // where they don't all fit (the pane never scrolls), Full taking the
        // room left
        '.evs.scroll{max-height:300px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
        '.evs.scroll::-webkit-scrollbar{display:none}',
        '.sec.grow[data-k="calendar"]{display:flex;flex-direction:column}',
        '.sec.grow[data-k="calendar"] .evs.scroll{max-height:none;flex:1 1 auto;min-height:0}',
        '.evs>.ev:last-child{border-bottom:0}',
        // A LIST THAT GIVES WAY (lst): down the pane (not a band, not a Pages
        // Screen widget) its section shrinks where the pane is short, to the
        // floor _floors sets; its rows scroll inside
        '.sec.shrink{display:flex;flex-direction:column}',
        '.sec.shrink>*{flex:none}',
        ':host(:not([side="band"]):not([mode="widget"])) .secs>.shrink:not(.grow){flex:0 1 auto}',
        '.lst{display:grid;gap:8px;align-content:start}.evs.lst{display:block}',
        '.sec.shrink>.lst{flex:0 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none}',
        '.sec.shrink>.lst::-webkit-scrollbar{display:none}',
        // ...and the calendar's events, down the pane, run as far as the pane
        // has room for, not to 300 px with a space under them (the owner,
        // 2026-10-31: "a gap/space above Who's Home that could be filled")
        // -- and so, where the pane is short, the first to give way
        ':host(:not([side="band"]):not([mode="widget"])) .sec.shrink>.evs.scroll{max-height:none}',
        ':host(:not([side="band"]):not([mode="widget"])) .secs>.shrink[data-k="calendar"]:not(.grow){flex-shrink:100}',
        '.sec.shrink>.lst.cut{-webkit-mask-image:linear-gradient(#000 calc(100% - 22px),transparent);mask-image:linear-gradient(#000 calc(100% - 22px),transparent)}',
        // A TAP: every section and each thing in it is a target
        '.secs>[data-i]:not([data-k="now_playing"]),[data-ent],[data-ev]{cursor:pointer}',
        '.secs>[data-i]:not([data-k="now_playing"]):active,[data-ent]:active,[data-ev]:active{opacity:.7}',
        '.sec.mp>*{position:absolute;inset:0;height:100%}',
        // (its heading, when the pane has them, above the music pane, not over it)
        '.sec.mp>.h2{position:relative;inset:auto;height:auto;padding:14px 0 0}',
        '.sec.mp>.h2~*{top:34px;height:auto;bottom:0}',
        '.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
        '.stats div{font:500 13px/1.3 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
        '.stats b{display:block;font:600 22px/1.25 var(--hk-font-body,inherit);color:' + v('ink') + '}',
        // (spread evenly across the pane, as the Who's Home block has them --
        // not packed to the left; the owner, 2026-10-31)
        '.ppl{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:14px}',
        '.ppl div{display:grid;justify-items:center;gap:4px;min-width:0;font:500 13px/1.2 var(--hk-font-body,inherit);color:' + v('ink-2') + '}',
        '.ppl i{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;font:600 18px/1 var(--hk-font-body,inherit);font-style:normal;color:#fff;overflow:hidden}',
        '.ppl i img{width:100%;height:100%;object-fit:cover}',
        '.ppl .away i{opacity:.45}',
        '.bar2{height:5px;border-radius:3px;background:' + v('line-strong') + ';position:relative;overflow:hidden}',
        '.bar2 i{position:absolute;left:0;top:0;bottom:0;background:#ff9f0a;border-radius:3px}',
        '.keys{display:flex;gap:8px;flex-wrap:wrap}',
        '.keys button{all:unset;cursor:pointer;font:600 13.5px/1 var(--hk-font-body,inherit);padding:11px 14px;border-radius:999px;background:' + v('key-strong') + '}',
        '.todo{display:grid;gap:2px}',
        '.it{all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;font:500 17px/1.3 var(--hk-font-body,inherit);min-height:32px}',
        '.it i{flex:none;width:18px;height:18px;border-radius:50%;box-shadow:inset 0 0 0 1.6px ' + v('ink-2') + '}',
        '.it span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.it.done span{text-decoration:line-through;color:' + v('ink-2') + '}',
        '.it.done i{background:#ff9500;box-shadow:none}',
        '.it:focus-visible,.pp:focus-visible,.keys button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
        '.add{display:flex;gap:8px}.add input{flex:1;min-width:0;font:500 15px/1 var(--hk-font-body,inherit);color:inherit;background:' + v('key') + ';border:0;border-radius:10px;padding:9px 12px}',
        '.add button{all:unset;cursor:pointer;display:grid;place-items:center;width:36px;border-radius:10px;background:' + v('key-strong') + '}',
        '.sec.cam2{padding:0;position:relative;aspect-ratio:16/9;display:block;background:#000}',
        '.sec.cam2.less{aspect-ratio:auto;height:120px}',
        '.sec.cam2.full{aspect-ratio:4/3}',
        '.sec.cam2>img,.sec.cam2>.live,.sec.cam2>.live>*{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
        // (the glyph on the dark plate until a still has loaded over it; the name by the section's Name)
        '.sec.cam2>.cg{position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,.4)}',
        '.sec.cam2>.cg hk-icon{width:40px;height:40px;--hk-icon-size:40px}',
        '.sec.cam2[data-name=hide] .cn,.sec.cam2[data-name=auto]:not(.less) .cn{display:none}',
        '.sec.cam2 .cn{position:absolute;left:12px;bottom:12px;font:600 13px/1 var(--hk-font-body,inherit);background:rgba(28,28,30,.62);padding:6px 9px;border-radius:999px}',
        '.sec.cam2 .lv{position:absolute;right:12px;top:12px;font:700 11px/1 var(--hk-font-body,inherit);letter-spacing:.06em;background:#ff3b30;padding:5px 8px;border-radius:999px;z-index:1}',
        '.sec.cam2.ring{box-shadow:inset 0 0 0 3px #ff3b30}',
        '.facebox{display:grid;place-items:center;flex:1;min-height:0}',
        '.sec[data-k="clock"].grow{display:flex;flex-direction:column}',
        '.face{width:min(100%,300px);height:auto}',
        '.face .dial{fill:none;stroke:' + v('line') + ';stroke-width:1.5}',
        '.face .nums{font:500 22px/1 var(--hk-font-body,inherit);fill:' + v('ink') + ';text-anchor:middle}',
        '.face .hh{stroke:' + v('ink') + ';stroke-width:6;stroke-linecap:round}.face .mh{stroke:' + v('ink') + ';stroke-width:4;stroke-linecap:round}',
        '.face .pin{fill:#ff9f0a}',
        '.more2{font:600 13px/1 var(--hk-font-body,inherit);color:' + v('ink-2') + ';text-align:center;padding:2px 0 0;flex:none}',
        ':host([side="band"]) .more2{align-self:center;padding:0 4px}',
        '@media (hover:hover){.pp:hover,.keys button:hover{background:' + v('key-strong') + '}}',
        // (the player's bare buttons, 2026-11-07: a pointer over one dims it, as the Full player's do -- a well behind
        // Speakers or Browse reached past the pane's edge and was cut off)

        '@media (prefers-reduced-motion:no-preference){:host([side]) .pane{transition:opacity .2s}}'
      ].join('\n');
      if (K && K.v) CSS = out;
      return out;
    }

    // what the shell and the later parts use of this one
    K.css = css; K.cssReady = cssReady; K.WX_LAST = WX_LAST;
  };
})();
