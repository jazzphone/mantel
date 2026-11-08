// hk-saverwidgets.js -- THE SCREENSAVER'S PIECES, drawn in every shape (2026-11-01, the owner: "Lets do the editor!";
// docs/phase12/SCREENSAVER-EDITOR.md, phase C1; reorganized 2026-11-02 around PIECES and SHAPES,
// docs/phase13/PIECES-SPEC.md, "The renderer"): ONE file that draws the lock-screen pieces from the house's real data in
// the approved mock-up's look (screensaver-editor.html: ring(), circ(), rect(), line(), bandHtml(), .bk-glass, .bk-tint).
//
// A PIECE is one fact (the weather, the time, the music...); a SHAPE is how it is drawn, the way an iPhone widget comes in
// sizes. Every piece is declared ONCE, next to its drawings (the plan's rule 1):
//
//   { name, group, wave, facts, source, when, wakes, pick, off, opts, defaults, accent, shapes: { shape: {read, draw, sample} } }
//
//   shape        size in units of `--u` (1 % of the screen's shorter side)
//   inline       3.6 u high, as wide as its text
//   circular     13 u square
//   rectangular  29 x 13 u
//   card         about 30 u wide, as tall as it draws, padded 1.6 u, radius 1.8 u
//   band         the zone's width, 10 u (readings) or 15 u (the forecast)
//
//   read(X) -> a JSON-able spec (what it would draw); draw(spec, opts) -> markup; sample -> a spec (or a function of the
//   piece's opts) for the editor's library, drawn with no house data. Optional per shape: fc (the forecasts it watches:
//   'daily', 'hourly'), idle (draws its placeholder while it has nothing to show), text(spec) (an inline shape's words,
//   for its width), w(spec) / h(spec) (its size in units, where it isn't the usual).
//
// WHAT IT COSTS A WALL TABLET: a piece is a handful of words and one small SVG, and is written again only when the spec
// it would draw has changed (update() compares the spec's JSON with the one it drew). Nothing animates and nothing here
// keeps a timer except the energy summary's waker below (the caller calls update() on the minute and when the house
// changes; a running timer says `live`: the one that wants a call every second). Glass is a static translucent fill and
// a hairline, never a backdrop filter. What arrives later -- a forecast, the Energy page's sums, the calendar's events --
// draws the piece again by itself when it lands.
//
// INK AND ACCENTS (the owner, 2026-11-02: "a little bit of color and a black/white option... the same for the whole
// screen"). The layer the pieces are in carries data-ink="white|black" and data-acc (accents on). `.hksw` draws in
// `var(--sw-ink)`: `c-auto` takes the layer's ink (--lay-ink, else the caller's --tint), `c-accent` the house's accent.
// The parts with meaning -- a ring's arc, a status dot, a glyph -- carry class `a` (or `g`, a weather glyph with its
// condition's own color) and draw in --sw-acc, or --sw-acc-d under black ink, when accents are on; else they are the
// ink. A piece's accent is a [light, dark] pair (or a function of what it drew), set on its element as --sw-acc and
// --sw-acc-d; a part with a color of its own (a calendar's, a reading's) sets the pair on itself. Black ink flips the
// legibility: a light text shadow, a lighter Glass, a light Tint. A piece the owner colored with the house accent stays
// that one color (its parts do not take the accents).
//
//   hkSaverWidgets.create(piece, shape, { u, back, color, h24, weather, opts })
//        -> { el, piece, shape, kind (= shape), facts, live, showing, measure(), update(client, now, ctx), setU(u), destroy() }
//     u        px per unit: everything is sized from `--u` on `el`, so the caller sizes a piece by plan()'s box (it sets
//              el's left and top; the band also its width)
//     back     'none' | 'glass' | 'tint'
//     color    'auto' (the screen's ink) | 'accent' (`--hk-accent`, else #ffb38a); v1's 'white' reads as 'auto'
//     h24      24-hour times;  weather   the weather entity id, or null (the house's)
//     opts     the piece's own choices (readings circular: { reading }; readings rectangular: { readings }; energy circular:
//              { reading }); anything not a choice of the piece's falls back to its default
//     update(client, now, ctx)  client {states, config, subscriptions?}; now a Date; ctx { title (title: undefined draws a
//              dash, '' draws nothing), events (the calendar's events, to share one read), music (the screensaver's
//              musicOf() reading, or null), face ({ font }: the Look's face, where it has a text form) }; true if it drew
//              again
//     showing  false while a "shows when..." piece has nothing to show (music not playing, no timer running): the
//              screensaver plans without it and reflows only when this changes, never on a tick
//     live     true while it wants a call every second (a running timer)
//     measure() -> {w, h} px: its unit size (inline: its text's width, measured when the page can, else estimated from
//              the text's length; a card: its drawn height, else estimated) -- call it after update()
//   hkSaverWidgets.create(v1id, opts) still works for the old widget ids (IDS), through the spec's v1 table
//   hkSaverWidgets.PIECES / has(piece, shape) / define(piece, declaration) / sample(piece, shape, opts) / CSS
//   hkSaverWidgets.has(id) / kind(id) / IDS: the v1 ids (the ones that are not cards)
(function () {
  'use strict';
  if (window.hkSaverWidgets) return;

  var FONT = '"SF Pro","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif';
  var DASH = '—';
  var DOT = ' · ';
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var BACKS = ['none', 'glass', 'tint'], COLORS = ['auto', 'accent'];
  var SHAPES = ['inline', 'circular', 'rectangular', 'card', 'band'];
  // each shape's usual size in units: [width, height]; an inline piece's width is its text's, a card's height what it draws
  var SIZE = { circular: [13, 13], rectangular: [29, 13], inline: [0, 3.6], card: [30, 0], band: [0, 10] };
  var LINE2 = 3.2;           // an inline piece's second line: its words (2.8 u) at a line height of 1.15
  var CAL_TTL = 300000;                     // the calendar is read at most this often (shared by every piece)
  var ENERGY_TTL = 30000;

  // ------------------------------------------------------------ the look (the mock-up's, in units of `--u`)
  var CSS = [
    '.hksw{box-sizing:border-box;display:flex;align-items:center;font-family:' + FONT + ';font-weight:600;line-height:1.15;',
    '  white-space:nowrap;color:var(--sw-ink);-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}',
    '.hksw.c-auto{--sw-ink:var(--lay-ink,var(--tint,#fff))}',
    '.hksw.c-accent{--sw-ink:var(--hk-accent,#ffb38a)}',
    // ACCENTS: the parts with meaning take their color when the layer says data-acc; without it (or under the house accent)
    // they are the ink. (A var() with nothing behind it draws the inherited ink, so a piece with no accent needs no rule.)
    '[data-acc] .hksw.c-auto .a{color:var(--sw-acc)}',
    '[data-acc] .hksw.c-auto .g{color:var(--sw-gl,var(--sw-acc))}',
    '[data-ink=black][data-acc] .hksw.c-auto .a{color:var(--sw-acc-d)}',
    '[data-ink=black][data-acc] .hksw.c-auto .g{color:var(--sw-gl-d,var(--sw-acc-d))}',
    // THE BACKDROP: Glass is a static scrim and a hairline (nothing blurred on a wall tablet), Tint the color in a dark
    // fill; under black ink the legibility flips -- a light shadow, a light scrim with a dark hairline, a light mix
    '.hksw.b-none{text-shadow:0 1px 8px rgba(0,0,0,.28)}',
    '.hksw.b-glass{background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}',
    '.hksw.b-tint{background:rgba(0,0,0,.38);background:color-mix(in srgb,var(--sw-ink) 20%,rgba(0,0,0,.38))}',
    '[data-ink=black] .hksw.b-none{text-shadow:0 1px 8px rgba(255,255,255,.5)}',
    '[data-ink=black] .hksw.b-glass{background:rgba(255,255,255,.5);box-shadow:inset 0 0 0 1px rgba(0,0,0,.14)}',
    '[data-ink=black] .hksw.b-tint{background:rgba(255,255,255,.55);background:color-mix(in srgb,var(--sw-ink) 14%,rgba(255,255,255,.55))}',
    '.hksw svg{display:block;flex:none}',
    '.hksw text{fill:currentColor;font-family:inherit}',
    // ONE SPACING SCALE, in u: .4  .8  1.2  1.6  2.4  3.2 (and .4em between a glyph and its words; a card's title sits .6 u over its
    // first line). Nothing in a backdrop sits closer than 1.6 u to its edge. A dot sits with its words .4em apart.
    '.hksw .dot{flex:none;display:inline-block;width:.62em;height:.62em;margin-right:.4em;border-radius:50%;background:currentColor}',
    // THE THREE LINES, the same in a card and a rectangular piece, from one left edge, 1.35 high: a label (2 u), the line (2.8 u),
    // the line under it (2.2 u)
    '.hksw .rt .l1, .hksw .cd .ct{font-size:calc(var(--u) * 2);line-height:1.35;opacity:.75;letter-spacing:.03em;text-transform:uppercase}',
    '.hksw .rt .l2, .hksw .cd .cl, .hksw .cd .s1{font-size:calc(var(--u) * 2.8);line-height:1.35}',
    '.hksw .rt .l3, .hksw .cd .s2{font-size:calc(var(--u) * 2.2);line-height:1.35;opacity:.85}',
    // circular
    '.hksw.k-circular{width:calc(var(--u) * 13);height:calc(var(--u) * 13);border-radius:50%;justify-content:center}',
    '.hksw.k-circular svg{width:100%;height:100%}',
    '.hksw.k-circular:not(.b-none) svg{width:80%;height:80%}',
    // rectangular
    '.hksw.k-rectangular{width:calc(var(--u) * 29);height:calc(var(--u) * 13);padding:0 calc(var(--u) * 2);border-radius:calc(var(--u) * 2.2);overflow:hidden}',
    '.hksw .rt{min-width:0;flex:1}',
    '.hksw .rt > div{overflow:hidden;text-overflow:ellipsis}',
    '.hksw .rt .l2{font-weight:700}',
    '.hksw .hrs{display:flex;flex:1;min-width:0;font-size:calc(var(--u) * 2.2);line-height:1.2;text-align:center}',
    '.hksw .hrs > div{flex:1;min-width:0}',
    '.hksw .hrs > div > div:first-child{opacity:.8}',
    '.hksw .hrs svg{width:calc(var(--u) * 3.2);height:calc(var(--u) * 3.2);margin:calc(var(--u) * .4) auto}',
    '.hksw .rr{display:flex;flex:1;min-width:0;text-align:center}',
    '.hksw .rr > div{flex:1;min-width:0}',
    '.hksw .rr .rl{font-size:calc(var(--u) * 2);line-height:1.35;opacity:.75;letter-spacing:.03em;text-transform:uppercase}',
    '.hksw .rr .rv{font-size:calc(var(--u) * 4.4);font-weight:700;line-height:1.25}',
    '.hksw .rr .bar{width:calc(var(--u) * 9);height:calc(var(--u) * .8);margin:calc(var(--u) * .4) auto 0}',
    '.hksw .evs{flex:1;min-width:0;display:flex;flex-direction:column;gap:0}',
    '.hksw .ev1{flex:1;min-width:0;display:flex}',
    '.hksw .ev{display:flex;align-items:center;min-width:0}',
    '.hksw .ev + .ev{margin-top:calc(var(--u) * .8)}',
    '.hksw .ev > div{min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '.hksw .ev .e1{font-size:calc(var(--u) * 2.2);line-height:1.2;font-weight:700;overflow:hidden;text-overflow:ellipsis}',
    '.hksw .ev .e2{font-size:calc(var(--u) * 1.8);line-height:1.2;opacity:.8;overflow:hidden;text-overflow:ellipsis}',
    // inline
    '.hksw.k-inline{display:inline-flex;height:calc(var(--u) * 3.6);font-size:calc(var(--u) * 2.8)}',
    // (with a backdrop, a pill: 4.8 u tall -- 1.2 u over and under the words -- 2.4 u at each end, 1.8 u on the glyph's side, round ends)
    '.hksw.k-inline:not(.b-none){height:calc(var(--u) * 4.8);padding:0 calc(var(--u) * 2.4);border-radius:999px;line-height:calc(var(--u) * 2.4)}',
    '.hksw.k-inline:not(.b-none) .il > svg:first-child, .hksw.k-inline:not(.b-none) .il > .dot:first-child{margin-left:calc(var(--u) * -.6)}',
    // (a glyph is centered on the line: SF's cap height sits at the middle of its line box, so the row's center is the caps')
    '.hksw .il{display:inline-flex;align-items:center;gap:.4em}',
    // the Date in two lines: the weekday over the date, both on one left (or right, or center) edge
    '.hksw.k-inline.l2{height:calc(var(--u) * 6.8)}.hksw.k-inline.l2:not(.b-none){height:calc(var(--u) * 8);border-radius:calc(var(--u) * 2.4)}',
    '.hksw .il.dl{flex-direction:column;align-items:flex-start;justify-content:center;gap:0;line-height:1.15}',
    '.hksw.al-right .il.dl{align-items:flex-end;text-align:right}.hksw.al-center .il.dl{align-items:center;text-align:center}',
    '.hksw .dw-light{font-weight:300}.hksw .dw-bold{font-weight:700}.hksw .dc-upper{text-transform:uppercase;letter-spacing:.04em}',
    '.hksw .il svg{width:1.15em;height:1.15em}',
    '.hksw .il .dot{margin-right:0}',
    // band: equal columns, each centered, so a row's figures sit on one baseline
    '.hksw.k-band{width:100%;height:calc(var(--u) * 10);align-items:center;text-align:center;font-size:calc(var(--u) * 3.2)}',
    '.hksw.k-band:not(.b-none){padding:0 calc(var(--u) * 2.4);border-radius:calc(var(--u) * 2.2)}',
    '.hksw .rd{flex:1;min-width:0;line-height:1.2}',
    '.hksw .rd small{display:block;font-size:calc(var(--u) * 2.4);font-weight:500;opacity:.8}',
    '.hksw.k-band.p-weather{height:calc(var(--u) * 15);gap:calc(var(--u) * 1.2);overflow:hidden;font-size:calc(var(--u) * 2.4)}',
    '.hksw.k-band.p-weather:not(.b-none){padding:0 calc(var(--u) * 2.4)}',
    '.hksw .tod{flex:none;text-align:left}',
    '.hksw .tod .big{font-size:calc(var(--u) * 5.6);font-weight:700;line-height:1;margin-left:-.05em}',
    '.hksw .tod .tw{display:flex;align-items:center;gap:calc(var(--u) * 1.2)}',
    '.hksw .tod .tw svg{width:calc(var(--u) * 5);height:calc(var(--u) * 5)}',
    '.hksw .tod .s1{margin-top:calc(var(--u) * .4);font-size:calc(var(--u) * 2.2);line-height:1.2;opacity:.8}',
    '.hksw .sep{flex:none;align-self:stretch;width:1px;margin:calc(var(--u) * 1.6) 0;background:currentColor;opacity:.2}',
    '.hksw .fcs{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;align-content:flex-start;height:calc(var(--u) * 11);overflow:hidden;column-gap:calc(var(--u) * .8)}',
    '.hksw .fcs .sep{height:calc(var(--u) * 9.4);margin:calc(var(--u) * .8) calc(var(--u) * .8)}',
    '.hksw .wfc{flex:1 0 calc(var(--u) * 6.4);min-width:0;height:calc(var(--u) * 11);display:flex;flex-direction:column;justify-content:center;text-align:center;line-height:1.25;white-space:nowrap}',
    '.hksw .wfc.dy{flex-basis:calc(var(--u) * 9.6)}',
    '.hksw .wfc .t{opacity:.8;font-size:calc(var(--u) * 2.1)}',
    '.hksw .wfc svg{width:calc(var(--u) * 4.2);height:calc(var(--u) * 4.2);margin:calc(var(--u) * .4) auto}',
    '.hksw .wfc .v{font-size:calc(var(--u) * 2.5)}',
    '.hksw .wfc .v i{font-style:normal;opacity:.6}',
    // card: about 30 u wide, as tall as it draws, from one left edge
    // (a card with no backdrop has no padding: its words and its art on the margin, as every other piece's -- 2026-11-02, the
    // owner: the music "pushed to the right" of the weather under it. With a backdrop, the backdrop's edge is on the margin)
    '.hksw.k-card.b-none{padding:0;min-width:0}',
    '.hksw.k-card{width:max-content;min-width:calc(var(--u) * 24);max-width:calc(var(--u) * 44);padding:calc(var(--u) * 2);border-radius:calc(var(--u) * 2.2);flex-direction:column;align-items:stretch;justify-content:flex-start;overflow:hidden}',
    '.hksw .cd{box-sizing:border-box;min-width:0;width:100%}',
    // (a card with a title has 2.4 u around it, not 2)
    '.hksw .cd.ti{padding:calc(var(--u) * .4)}',
    // (...not with no backdrop: its words on the margin, as every other card's -- Home Status on the right ended 0.4 u in)
    '.hksw.b-none .cd.ti{padding:0}',
    '.hksw .cd.ti .ct + div{margin-top:calc(var(--u) * .6)}',
    '.hksw .cd > div{overflow:hidden;text-overflow:ellipsis}',
    // (a big number never needs an ellipsis: its row draws the round figures' overshoot below the baseline, which a
    // line-height of 1 leaves outside the box -- the owner: "the temp is being clipped")
    '.hksw .cd > .big,.hksw .cd > .cw{overflow:visible}',
    '.hksw.k-card.b-none{overflow:visible}',
    '.hksw .cd .big{font-size:calc(var(--u) * 8.5);font-weight:700;line-height:1;letter-spacing:-.01em;margin-left:-.05em}',
    // (the Time's card: large figures, thin as the lock screen's time, and its date under them; at 150 % the old corner
    // clock's 150 px on an 800 px tablet -- the size a screen with no saved layout gets, hk-saver.js autoLayout)
    '.hksw .cd.tc .big{font-size:calc(var(--u) * 12);font-weight:500;letter-spacing:-.03em}',
    '.hksw .cd.tc .s1{font-size:calc(var(--u) * 3.2);margin-top:calc(var(--u) * .8)}',
    '.hksw .cd .big + .s1, .hksw .cd .cw + .s1{margin-top:calc(var(--u) * .8)}',
    '.hksw .cd .cl{font-weight:600}',
    '.hksw .cd .cw{display:flex;align-items:center;justify-content:space-between}',
    '.hksw .cd .cw svg{width:calc(var(--u) * 7);height:calc(var(--u) * 7)}',
    '.hksw .cd.mc{display:flex;align-items:center;gap:calc(var(--u) * 1.6)}',
    // A PIECE'S WORDS ALIGNED (2026-11-03, the owner: a piece on the right "aligned to the right to match the edge of the
    // screen"): its lines to its right edge -- a song's art at that edge too -- or centered; and a card without its title
    '.hksw.al-right .cd,.hksw.al-right .rt{text-align:right}.hksw.al-right .cd > div,.hksw.al-right .rt > div{justify-content:flex-end}',
    '.hksw.al-right .cd.mc{flex-direction:row-reverse}',
    '.hksw.al-center .cd,.hksw.al-center .rt{text-align:center}.hksw.al-center .cd > div,.hksw.al-center .rt > div{justify-content:center}',
    '.hksw.no-ti .cd .ct{display:none}.hksw.no-ti .cd.ti{padding:0}.hksw.no-ti .cd.ti .ct + div{margin-top:0}',
    '.hksw .cd.mc .art{flex:none;width:calc(var(--u) * 12);height:calc(var(--u) * 12);border-radius:calc(var(--u) * 1.2);object-fit:cover;background:rgba(127,127,127,.28)}',
    '.hksw .cd.mc span.art{display:flex;align-items:center;justify-content:center}',
    '.hksw .cd.mc span.art svg{width:55%;height:55%}',
    '.hksw .cd.mc .mt{min-width:0;flex:1}',
    '.hksw .cd.mc .mt > div{overflow:hidden;text-overflow:ellipsis}',
    '.hksw .cd.mc .m1{font-size:calc(var(--u) * 2.8);line-height:1.35;font-weight:700}',
    '.hksw .cd.mc .m2{font-size:calc(var(--u) * 2.2);line-height:1.35}',
    '.hksw .cd.mc .m3{font-size:calc(var(--u) * 2);line-height:1.35;opacity:.7;letter-spacing:.03em;text-transform:uppercase}',
    '.hksw .tr{display:flex;align-items:center;gap:calc(var(--u) * 1.2);height:calc(var(--u) * 5.4)}',
    '.hksw .tr + .tr{margin-top:calc(var(--u) * .4)}',
    '.hksw .tr .mr{width:calc(var(--u) * 5);height:calc(var(--u) * 5)}',
    '.hksw .tr .tn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:calc(var(--u) * 2.4)}',
    '.hksw .tr .tt{font-size:calc(var(--u) * 2.8);font-weight:700}'
  ].join('\n');
  var cssIn = false;
  // one style for the page (a caller with a shadow root of its own puts hkSaverWidgets.CSS in it)
  var docSheet = null, sheets = [];
  function ensureCss() {
    var host = document.head || document.body || null;
    if (cssIn || !host || !host.appendChild) return;
    var st = document.createElement('style');
    st.setAttribute('data-hk-saverwidgets', '');
    st.textContent = CSS;
    host.appendChild(st);
    docSheet = st;
    cssIn = true;
  }
  // A SHEET FOR A SHADOW ROOT (the screensaver's layer, its slide corner, the editor): kept up to date as the glance
  // groups' files add their own rules (addCss) -- one sheet per root however many files, never a copy that misses the
  // rules of a file loaded after it was made
  function sheet() {
    var st = document.createElement('style');
    st.setAttribute('data-hk-saverwidgets', '');
    st.textContent = CSS;
    sheets = sheets.filter(function (x) { return x.isConnected !== false; });
    sheets.push(st);
    return st;
  }
  function addCss(more) {
    if (!more || CSS.indexOf(more) >= 0) return;
    CSS += '\n' + more;
    window.hkSaverWidgets.CSS = CSS;
    if (docSheet) docSheet.textContent = CSS;
    sheets.forEach(function (st) { st.textContent = CSS; });
  }

  // ------------------------------------------------------------ small helpers
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function num(v) { var n = Number(v); return v !== null && v !== undefined && v !== '' && isFinite(n) ? n : null; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round(v) { return v == null ? DASH : String(Math.round(v)); }
  function deg(v) { return v == null ? DASH : Math.round(v) + '°'; }
  function when(v) { var t = v instanceof Date ? +v : Date.parse(v); return isFinite(t) ? t : null; }
  function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  // a time: 12-hour "5:52" (with AM or PM where asked), or 24-hour "17:52"
  function tm(d, h24, mer) {
    var h = d.getHours(), m = d.getMinutes();
    if (h24) return pad(h) + ':' + pad(m);
    return ((h % 12) || 12) + ':' + pad(m) + (mer ? (h < 12 ? ' AM' : ' PM') : '');
  }
  // an hour's name in a column: "12 PM", or "13:00"
  function hourName(d, h24) {
    var h = d.getHours();
    return h24 ? pad(h) + ':00' : ((h % 12) || 12) + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function secs(v) {
    // (hkTimers.secs, as the strip reads a timer's length: seconds, or H:MM:SS)
    var T = window.hkTimers;
    if (T && T.secs) return T.secs(v);
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    var p = String(v).split(':').map(Number);
    if (p.some(isNaN)) return 0;
    while (p.length < 3) p.unshift(0);
    return p[0] * 3600 + p[1] * 60 + p[2];
  }
  function clockText(s) {
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(x) : m + ':' + pad(x);
  }
  // a Look's face font as a family list: "Playfair Display", serif -- or a shorthand's tail ("600 40px Playfair Display")
  function familyOf(font) {
    var f = String(font == null ? '' : font).trim();
    return f.replace(/^.*?\d+(?:\.\d+)?(?:px|em|rem|pt|%)(?:\/\S+)?\s+/, '');
  }

  // ------------------------------------------------------------ accents (a [light, dark] pair of hex colors each)
  //   light is for white ink (over a dark picture), dark for black ink (over a light one)
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgbHex(a) { return '#' + a.map(function (v) { return (Math.round(clamp(v, 0, 255)) + 256).toString(16).slice(1); }).join(''); }
  function mix(a, b, t) { var p = hexRgb(a), q = hexRgb(b); return rgbHex([0, 1, 2].map(function (i) { return p[i] + (q[i] - p[i]) * t; })); }
  // a ramp of [at, light, dark] stops: the pair at a value
  function ramp(stops, v) {
    if (v <= stops[0][0]) return [stops[0][1], stops[0][2]];
    for (var i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], t = (v - a[0]) / (b[0] - a[0]);
        return [mix(a[1], b[1], t), mix(a[2], b[2], t)];
      }
    }
    var z = stops[stops.length - 1];
    return [z[1], z[2]];
  }
  // the outside temperature (in degrees F): cool blue, through a pale sky, to a warm orange -- restrained, not a rainbow
  var TEMPC = [[10, '#6fb6ff', '#1f6fc4'], [40, '#8fd3e8', '#1b86a3'], [62, '#ffd27a', '#b07a00'], [80, '#ffa55c', '#c4600f'], [98, '#ff7a5c', '#c23a1f']];
  function tempAcc(f) { return f == null ? null : ramp(TEMPC, f); }
  // the air quality index by its category: good, moderate, unhealthy for some, unhealthy, very unhealthy
  var AQIC = [[50, '#5fd38a', '#1f8a4c'], [100, '#ffd84d', '#a88400'], [150, '#ffa24d', '#c25e00'], [200, '#ff6b5e', '#c4261a'], [1e9, '#c58bff', '#7a35c4']];
  function aqiAcc(a) {
    if (a == null) return null;
    for (var i = 0; i < AQIC.length; i++) if (a <= AQIC[i][0]) return [AQIC[i][1], AQIC[i][2]];
    return null;
  }
  var GREEN = ['#5fd38a', '#1f8a4c'], AMBER = ['#ffb340', '#b36b00'], RED = ['#ff6b5e', '#c4261a'], YELLOW = ['#ffd166', '#8a5d00'], ORANGE = ['#ffa24d', '#c25e00'];
  // the style attribute a part with a color of its own carries
  function accStyle(p) { return p ? ' style="--sw-acc:' + p[0] + ';--sw-acc-d:' + p[1] + '"' : ''; }

  // ------------------------------------------------------------ glyphs (our own; hk-saverfaces.js keeps its two private)
  var CLOUD = 'M7 14.5h10.2a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-10 1A3.1 3.1 0 0 0 7 14.5z';
  var SUN = '<circle cx="12" cy="12" r="4.4"/><path d="M11 2.6h2v2.6h-2zM11 18.8h2v2.6h-2zM2.6 11h2.6v2H2.6zM18.8 11h2.6v2h-2.6zM4.9 6.3l1.4-1.4 1.8 1.8-1.4 1.4zM15.9 17.3l1.4-1.4 1.8 1.8-1.4 1.4zM4.9 17.7l1.8-1.8 1.4 1.4-1.8 1.8zM15.9 6.7l1.8-1.8 1.4 1.4-1.8 1.8z"/>';
  var MOON = '<path d="M20 14.6A8.6 8.6 0 0 1 9.4 4 8.6 8.6 0 1 0 20 14.6z"/>';
  var LINE = ' fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"';
  var GLYPH = {
    sun: SUN, moon: MOON,
    cloud: '<path d="M7 19h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 19z"/>',
    partly: '<circle cx="8.2" cy="8" r="3"/><path d="M9.6 20h7.6a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2 1A2.9 2.9 0 0 0 9.6 20z"/>',
    partlynight: '<path d="M11.6 4.2A5 5 0 1 0 14 12 5.5 5.5 0 0 1 11.6 4.2z" transform="translate(-4 -1) scale(.8)"/><path d="M9.6 20h7.6a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2 1A2.9 2.9 0 0 0 9.6 20z"/>',
    rain: '<path d="' + CLOUD + '"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"' + LINE + '/>',
    snow: '<path d="' + CLOUD + '"/><path d="M8 18.5v.1M12 20v.1M16 18.5v.1"' + LINE.replace('1.8', '2.6') + '/>',
    bolt: '<path d="' + CLOUD + '"/><path d="M12.8 14.6l-3 4.4h2.6l-1 3.4 3.8-5h-2.6z"/>',
    fog: '<path d="M4 9h16M6 13h14M4 17h12"' + LINE.replace('1.8', '2.2') + '/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H3zm0 4h15a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H3zm0 4h7v2H3z"/>'
  };
  // each glyph's own color, by what the sky is doing (the sun warm, rain blue, cloud a cool gray, the moon pale)
  var GCOL = { sun: YELLOW, moon: ['#d6dcff', '#5560a8'], partly: ['#ffd98a', '#8a5d00'], partlynight: ['#d6dcff', '#5560a8'], cloud: ['#cdd8e4', '#617689'],
               fog: ['#c3ced8', '#6c7b88'], rain: ['#82c3ff', '#2a74c8'], snow: ['#c4e8ff', '#4a8fbf'], bolt: YELLOW, wind: ['#a8ded3', '#2f8f7e'] };
  var WXG = { sunny: 'sun', 'clear-night': 'moon', partlycloudy: 'partly', cloudy: 'cloud', fog: 'fog', rainy: 'rain', pouring: 'rain', hail: 'rain',
              snowy: 'snow', 'snowy-rainy': 'snow', lightning: 'bolt', 'lightning-rainy': 'bolt', windy: 'wind', 'windy-variant': 'wind', exceptional: 'cloud' };
  // a condition's glyph; at night the sun is the moon
  function wxGlyph(cond, night) {
    var g = WXG[cond] || 'cloud';
    if (night && g === 'sun') g = 'moon';
    if (night && g === 'partly') g = 'partlynight';
    var c = GCOL[g] || GCOL.cloud;
    return '<svg class="g" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" style="--sw-gl:' + c[0] + ';--sw-gl-d:' + c[1] + '">' + GLYPH[g] + '</svg>';
  }
  function lockGlyph(open) {
    return '<path d="M6 10h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" fill="currentColor"/>' +
      '<path d="' + (open ? 'M8 10V7a4 4 0 0 1 7.6-1.7' : 'M8 10V7a4 4 0 0 1 8 0v3') + '"' + LINE.replace('1.8', '2.2') + '/>';
  }
  // a music note (the music pieces' glyph and the card's art when there is no picture)
  var NOTE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M9 18V6.5l10-2V16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.7"/><circle cx="16.5" cy="16" r="2.7"/></svg>';

  // ------------------------------------------------------------ the ring (the mock-up's ring(), in a 100 x 100 box)
  //   frac  how full (null: the track alone); gauge: a three-quarter arc open at the bottom, else a whole ring
  //   main  the figure; sub the label under it; subs [lo, hi] the two ends of a gauge, at its open bottom
  //   (the arcs carry class `a`: the part with meaning, which takes the piece's accent)
  function ring(o) {
    var r = 43, c = 2 * Math.PI * r, arc = o.gauge ? 0.75 : 1, rot = o.gauge ? 135 : -90;
    var circle = function (op, len) {
      return '<circle class="a" cx="50" cy="50" r="43" fill="none" stroke="currentColor"' + (op ? ' stroke-opacity="' + op + '"' : '') +
        ' stroke-width="7.5" stroke-linecap="round" stroke-dasharray="' + len.toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(' + rot + ' 50 50)"/>';
    };
    var T = function (x, y, size, w, s, op) {
      return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-weight="' + w + '" font-size="' + size + '"' + (op ? ' opacity="' + op + '"' : '') + '>' + esc(s) + '</text>';
    };
    var n = String(o.main).length, big = n <= 3 ? 30 : n === 4 ? 26 : n === 5 ? 21 : n === 6 ? 18 : 15;
    var hasSub = o.sub != null && o.sub !== '';
    var svg = '<svg viewBox="0 0 100 100" aria-hidden="true">' + circle('.3', c * arc);
    if (o.frac != null) svg += circle(null, c * arc * clamp(o.frac, 0, 1));
    // THE FIGURE IS CENTERED BY ITS CAPS: a digit stands about .71 em tall, so its baseline is half of that below the line it
    // is centered on -- the ring's center (50), a little above it with a label under (45) or the gauge's two ends (47). The label
    // is on one baseline in every ring (72; a gauge's ends 90). (A temperature's digits are what is centered, its degree sign
    // hanging after them, as the Lock Screen's gauges have it: centered whole, "56°" sat left in its ring -- the owner,
    // 2026-11-01. Half the sign's advance, ~0.38 em)
    var cy = o.subs ? 47 : hasSub ? 45 : 50;
    svg += T(/°$/.test(String(o.main)) ? (50 + big * 0.19).toFixed(1) : 50, (cy + big * 0.355).toFixed(1), big, 700, o.main);
    if (hasSub) svg += T(50, 72, String(o.sub).length <= 4 ? 14 : String(o.sub).length <= 6 ? 12 : 10, 600, o.sub, '.85');
    if (o.subs) svg += T(31, 90, 13, 600, o.subs[0], '.85') + T(69, 90, 13, 600, o.subs[1], '.85');
    return svg + '</svg>';
  }
  // a small ring that empties (a card's timer row), in a 24 x 24 box
  function miniRing(frac) {
    var c = 2 * Math.PI * 10;
    return '<svg class="mr" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round">' +
      '<circle class="a" cx="12" cy="12" r="10" stroke-opacity=".3"/>' +
      (frac > 0 ? '<circle class="a" cx="12" cy="12" r="10" stroke-dasharray="' + (c * clamp(frac, 0, 1)).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 12 12)"/>' : '') + '</svg>';
  }
  // a thin bar, filled to a fraction (a reading under its figure)
  function bar(frac) {
    return '<svg class="bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" fill="currentColor"><rect class="a" width="100" height="6" rx="3" opacity=".3"/>' +
      (frac != null && frac > 0 ? '<rect class="a" width="' + (clamp(frac, 0, 1) * 100).toFixed(1) + '" height="6" rx="3"/>' : '') + '</svg>';
  }
  // a rectangular piece's three lines: a small label, a bold line (with a dot of the piece's accent where asked), a line under it
  function lines(a, b, c, dot) {
    return '<div class="rt"><div class="l1">' + esc(a) + '</div><div class="l2">' + (dot ? '<i class="dot a"></i>' : '') + esc(b) + '</div>' +
      (c ? '<div class="l3">' + esc(c) + '</div>' : '') + '</div>';
  }
  // an inline piece's markup: its glyph (or dot), then its words
  function inl(glyph, text) { return '<span class="il">' + (glyph || '') + '<span>' + esc(text) + '</span></span>'; }

  // Align a corner's visible ink, including a digit's side bearing and the weather SVG's view-box padding.
  // Scale is the preview frame's transform: margins are in layout pixels, measurements in screen pixels.
  // Cache the actual glyph edge: mathematical font bounds can include nearly transparent edge pixels.
  // (THE PIXELS THE SCREEN LIGHTS, 2026-11-07: the glyph drawn at its size on screen -- the font size times the
  // frame's scale -- and at the same fraction of a pixel as its origin there, so its first lit column is the one the
  // screen lights; the corner then moves by whole pixels and that fraction stays. Drawn at the layout size and scaled,
  // a 78 px clock digit at 1920 x 1080 came out 1.2 px off the date; drawn finer, its geometric edge, the leading
  // digit of the hour decided which pixel lit, and a check passed or failed by the time of day.)
  var cornerCtx = null, cornerInk = {};
  function glyphLeft(font, ch, px, frac) {
    var key = font + '|' + ch + '|' + px.toFixed(2) + '|' + Math.round(frac * 16);
    if (cornerInk[key] !== undefined) return cornerInk[key];
    var canvas = document.createElement('canvas'), pad = Math.ceil(px);
    canvas.width = canvas.height = pad * 3;
    var ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.font = font.replace(/(^|\s)([\d.]+)px/, function (m, sp) { return sp + px + 'px'; });
    ctx.fillStyle = '#fff'; ctx.fillText(ch, pad + Math.round(frac * 16) / 16, pad * 2);
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data, left = 0;
    outer: for (var x = 0; x < canvas.width; x++) for (var y = 0; y < canvas.height; y++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 64) { left = x - pad; break outer; }
    }
    if (Object.keys(cornerInk).length >= 48) cornerInk = {};
    return (cornerInk[key] = left);
  }
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { cornerInk = {}; });
  function alignLeft(stack, scale) {
    if (!stack || !(scale > 0) || !document.createRange) return;
    var left = Math.round(stack.getBoundingClientRect().left);
    Array.prototype.forEach.call(stack.children, function (piece) {
      var prior = parseFloat(piece.style.marginLeft) || 0;
      if (!piece.getBoundingClientRect().width) return;
      var il = piece.querySelector('.il'), first = il && il.firstElementChild, x = null;
      if (!first) return;
      if (first.tagName.toLowerCase() === 'svg') {
        try { var b = first.getBBox(), m = first.getScreenCTM(); if (m) x = m.a * b.x + m.c * b.y + m.e; } catch (e) { /* not drawn yet */ }
      } else {
        // Keep the leading digit's tabular cell, but measure its glyph without a font-specific tabular inset.
        if (piece.classList.contains('p-time')) {
          var parent = first, pc = getComputedStyle(parent), fk = [pc.fontStyle, pc.fontWeight, pc.fontSize, pc.fontFamily].join(' ');
          var lead = parent.querySelector('[data-corner-digit]');
          if (lead && lead.getAttribute('data-corner-font') !== fk) { parent.textContent = parent.textContent; lead = null; }
          if (!lead && parent.firstChild && parent.firstChild.nodeType === 3) {
            var text = parent.textContent, letter = Array.from(text)[0], rg = document.createRange();
            rg.setStart(parent.firstChild, 0); rg.setEnd(parent.firstChild, letter.length);
            var width = rg.getBoundingClientRect().width / scale;
            lead = document.createElement('span'); lead.setAttribute('data-corner-digit', ''); lead.setAttribute('data-corner-font', fk);
            lead.style.cssText = 'display:inline-block;text-align:left;font-variant-numeric:proportional-nums;width:' + width + 'px';
            lead.textContent = letter; parent.replaceChildren(lead, document.createTextNode(text.slice(letter.length)));
          }
          if (lead) first = lead;
        }
        var t = first.firstChild;
        if (!t || t.nodeType !== 3 || !t.textContent) return;
        if (!cornerCtx) cornerCtx = document.createElement('canvas').getContext('2d');
        if (!cornerCtx) return;
        var cs = getComputedStyle(first), range = document.createRange(), ch = Array.from(t.textContent)[0];
        var font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].join(' '); cornerCtx.font = font;
        range.setStart(t, 0); range.setEnd(t, ch.length);
        var r = range.getBoundingClientRect(), mt = cornerCtx.measureText(ch);
        // Tabular figures center a proportional glyph in its wider digit cell.
        var cell = /[0-9]/.test(ch) && /tabular-nums/.test(cs.fontVariantNumeric) ? (r.width / scale - mt.width) / 2 : 0;
        var x0 = r.left + cell * scale, base = Math.floor(x0);
        x = base + glyphLeft(font, ch, parseFloat(cs.fontSize) * scale, x0 - base);
      }
      if (x !== null && isFinite(x) && Math.abs((left - x) / scale) > 0.03) piece.style.marginLeft = (prior + (left - x) / scale).toFixed(3) + 'px';
    });
  }

  // ------------------------------------------------------------ what the house says
  // THE HOME STATUS WORDS, from the header's one security calculation (hk-header.js status(), which the screensaver's
  // Home Status card draws): "Home Secured" when armed and everything shut, else what isn't, its first two items --
  // the card's own first line. Where the header isn't loaded the card draws nothing and so do we: a dash.
  var ALARM = { armed_home: 'Armed Home', armed_away: 'Armed Away', armed_night: 'Armed Night', armed_vacation: 'Armed Vacation',
                disarmed: 'Disarmed', triggered: 'Triggered', pending: 'Pending', arming: 'Arming' };
  function homeWords(states) {
    var H = window.hkHeader;
    if (!H || typeof H.status !== 'function') return null;
    var s = H.status(states || {});
    return { secured: s.secured, items: s.items, alarm: ALARM[s.alarmRaw] || '', raw: s.alarmRaw,
             line: s.secured ? 'Home Secured' : s.items.slice(0, 2).join(DOT) || 'All Clear' };
  }
  // how the house stands, for the status accent: red an alarm going off, amber something open, green secured
  function homeLevel(h) { return !h ? '' : h.raw === 'triggered' ? 'alarm' : h.secured ? 'ok' : 'open'; }
  var LEVEL = { ok: GREEN, open: AMBER, alarm: RED };
  // the house's locks: the ones Status & Chips names, else every lock
  function locksOf(states) {
    var H = window.hkHeader, ids = [];
    try { ids = H && H.lists ? H.lists().locks || [] : []; } catch (e) { ids = []; }
    if (!ids.length) ids = Object.keys(states).filter(function (k) { return k.indexOf('lock.') === 0; });
    return ids;
  }
  // the sun's next event: whichever of next_setting and next_rising is first, and how far through the day (or night)
  // it is -- from the last event of the other kind, a day before the coming one of it
  function sunNext(states, now) {
    var a = (states['sun.sun'] || {}).attributes || {}, t = +now;
    var set = when(a.next_setting), rise = when(a.next_rising);
    var ev = [['Sunset', set, rise], ['Sunrise', rise, set]].filter(function (e) { return e[1] != null && e[1] >= t - 60000; })
      .sort(function (p, q) { return p[1] - q[1]; })[0];
    if (!ev) return null;
    var start = ev[2] != null ? ev[2] - 86400000 : ev[1] - 43200000;
    return { name: ev[0], at: new Date(ev[1]), frac: clamp((t - start) / (ev[1] - start), 0, 1) };
  }
  // the house's inside temperature: Status & Chips' Indoor Temperature, else the thermostats' (the chosen ones, else
  // every climate) mean current_temperature
  function insideOf(X) {
    var HS = window.hkSettings, st = X.st, id = HS && HS.get ? HS.get('features.temperature', null) : null, v = id && st[id] ? num(st[id].state) : null;
    if (v != null) return v;
    var list = HS && HS.get ? HS.get('features.thermostats', []) : [];
    if (!Array.isArray(list) || !list.length) list = Object.keys(st).filter(function (k) { return k.indexOf('climate.') === 0; });
    var t = list.map(function (k) { return st[k] && num((st[k].attributes || {}).current_temperature); }).filter(function (x) { return x != null; });
    return t.length ? t.reduce(function (p, q) { return p + q; }, 0) / t.length : null;
  }
  // the house battery and the sun (the Energy page's house battery where its sums are in; the side pane's scan else)
  function scan(st, re, dc) {
    return Object.keys(st).filter(function (k) { return re.test(k) && (!dc || (st[k].attributes || {}).device_class === dc) && num(st[k].state) !== null; })[0] || null;
  }
  function batteryOf(X) {
    var s = X.energy(), v = s && s.battery != null ? s.battery : null;
    if (v != null) return v;
    // (mirrors hk-sidepane.js energy: a sensor named for the house, home or Powerwall battery)
    var id = scan(X.st, /^sensor\..*(house|home|powerwall).*battery/, 'battery');
    return id ? num(X.st[id].state) : null;
  }
  function solarOf(X) {
    // (mirrors hk-sidepane.js energy: a sensor named for solar power; also a power sensor named for the panels)
    var st = X.st, id = scan(st, /^sensor\..*solar.*power/) || scan(st, /^sensor\..*(solar|pv)/, 'power');
    if (!id) return null;
    var v = num(st[id].state), u = (st[id].attributes || {}).unit_of_measurement;
    return v == null ? null : u === 'W' ? v / 1000 : v;
  }
  // degrees Fahrenheit, from a temperature in the unit the weather says (else the house's unit system): the accent's scale
  function fahr(X, v, unit) {
    if (v == null) return null;
    var us = ((X.client && X.client.config) || {}).unit_system || {}, c = unit ? unit === 'C' : /C/.test(String(us.temperature || ''));
    return Math.round(c ? v * 9 / 5 + 32 : v);
  }
  // the running timers, soonest first (the strip's sensor, sensor.running_quick_timers: its `running` rows)
  function timerRows(X) {
    var run = ((X.st['sensor.running_quick_timers'] || {}).attributes || {}).running, t = +X.now;
    return (Array.isArray(run) ? run : []).filter(function (r) { return r && when(r.finishes_at) != null; })
      .sort(function (p, q) { return when(p.finishes_at) - when(q.finishes_at); })
      .map(function (r) {
        var left = Math.max(0, Math.ceil((when(r.finishes_at) - t) / 1000)), ent = r.entity_id && X.st[r.entity_id];
        return { name: String(r.name || 'Timer'), left: left, total: secs(r.total) || (ent ? secs((ent.attributes || {}).duration) : 0) };
      });
  }
  // a forecast entry's day as [year, month, day] numbers, from the date it says (the entity's own day, not ours)
  function dayOf(f) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String((f && f.datetime) || ''));
    if (m) return [+m[1], +m[2] - 1, +m[3]];
    var t = when(f && f.datetime);
    if (t == null) return null;
    var d = new Date(t);
    return [d.getFullYear(), d.getMonth(), d.getDate()];
  }
  function dayKey(a) { return a[0] * 10000 + a[1] * 100 + a[2]; }
  // the calendar's next events: timed ones not yet over (one under way is NOW), then today's all-day ones
  function nextEvents(evs, now, names, n) {
    var t = +now, day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), day1 = new Date(+day0 + 90000000);
    var list = (evs || []).map(function (e) {
      var s = when(e && e.start), en = when(e && e.end);
      return s == null ? null : { title: String(e.title || e.summary || 'Event'), loc: String(e.loc || e.location || ''), cal: e.cal, uid: e.uid, allDay: !!e.allDay,
                                  start: new Date(s), end: new Date(en == null ? s + 3600000 : en) };
    }).filter(Boolean).sort(function (a, b) { return a.start - b.start; });
    var picks = list.filter(function (e) { return !e.allDay && +e.end > t; })
      .concat(list.filter(function (e) { return e.allDay && +e.end > t && +e.start < +day1; })).slice(0, n || 1);
    picks.forEach(function (pick) {
      pick.where = pick.loc || (names && pick.cal && names[pick.cal]) || '';
      pick.now = !pick.allDay && +pick.start <= t;
      pick.dayN = Math.round((new Date(pick.start.getFullYear(), pick.start.getMonth(), pick.start.getDate()) - day0) / 86400000);
    });
    return picks;
  }
  function nextEvent(evs, now, names) { return nextEvents(evs, now, names, 1)[0] || null; }
  // "3:30 PM", "Tomorrow, 9:15 AM", "Thu, 9:15 AM", "until 4:30 PM", "All Day"
  function eventWhen(e, h24) {
    if (e.now) return 'until ' + tm(e.end, h24, true);
    var day = e.dayN <= 0 ? '' : e.dayN === 1 ? 'Tomorrow' : DAYS[e.start.getDay()].slice(0, 3);
    if (e.allDay) return day || 'All Day';
    return (day ? day + ', ' : '') + tm(e.start, h24, true);
  }
  // an event's color: the calendar's own as Settings has it (hkSettings.eventColor, in hk-calendar.js's palette), as a pair
  function eventAcc(e, st) {
    var HS = window.hkSettings, C = window.hkCards, key = 'orange', hue = (C && C.PALETTE && C.PALETTE.chart) || {};
    try { key = HS && HS.eventColor ? HS.eventColor(e.cal, e.title, e.uid, st) : HS && HS.calendarColor ? HS.calendarColor(e.cal, st) : 'orange'; } catch (x) { key = 'orange'; }
    if (key === 'white') return null;
    var rgb = hue[key] && hue[key].length === 3 ? hue[key] : [255, 159, 10];
    return [rgbHex(rgb), rgbHex(rgb.map(function (v) { return v * 0.62; }))];
  }

  // ------------------------------------------------------------ the readings (one table: the circle, the pair, the band)
  //   each: label; acc (a pair, or a function of its value); read(X) -> { main, sub, frac, v, label? }
  var WIND_TOP = [[/mph|mi/i, 30], [/km/i, 50], [/m\/s|ms/i, 14], [/kn|kt/i, 25]];
  var RD = {
    humidity: { label: 'Humidity', acc: ['#7cc8ff', '#1f78b8'],
      read: function (X) { var w = X.wx(), h = w && w.humidity; return { main: h == null ? DASH : Math.round(h) + '%', sub: 'HUM', frac: h == null ? null : clamp(h / 100, 0, 1), v: null }; } },
    aqi: { label: 'AQI', acc: function (v) { return aqiAcc(v); },
      read: function (X) {
        var w = X.wx(), a = w && w.aqi;
        return { main: a == null ? DASH : String(a), sub: 'AQI', frac: a == null ? null : Math.round(clamp(a / 300, 0, 1) * 200) / 200, v: a == null ? null : a };
      } },
    inside: { label: 'Inside', acc: function (v) { return tempAcc(v); },
      read: function (X) {
        var v = insideOf(X), us = ((X.client && X.client.config) || {}).unit_system || {}, c = /C/.test(String(us.temperature || '')), lo = c ? 10 : 50, hi = c ? 32 : 90;
        return { main: deg(v), sub: 'IN', frac: v == null ? null : Math.round(clamp((v - lo) / (hi - lo), 0, 1) * 200) / 200, v: fahr(X, v, c ? 'C' : 'F') };
      } },
    sunset: { label: 'Sunset', acc: ['#ff9f6b', '#c4551a'],
      read: function (X) {
        var n = sunNext(X.st, X.now);
        return n ? { main: tm(n.at, X.h24), sub: n.name.toUpperCase(), frac: Math.round(n.frac * 200) / 200, v: null, label: n.name }
                 : { main: DASH, sub: 'SUNSET', frac: null, v: null };
      } },
    wind: { label: 'Wind', acc: ['#8ad8c0', '#2f8f7e'],
      read: function (X) {
        var w = X.wx(), s = w && w.wind, unit = (w && w.windUnit) || '', top = 30;
        WIND_TOP.forEach(function (r) { if (r[0].test(unit)) top = r[1]; });
        return { main: s == null ? DASH : String(Math.round(s)), sub: unit ? unit.toUpperCase() : 'WIND', frac: s == null ? null : Math.round(clamp(s / top, 0, 1) * 200) / 200, v: null, unit: unit };
      } }
  };
  // a reading, as a spec: its key, what it says, and the value its color follows
  function readingOf(X, k) {
    var r = RD[k] || RD.humidity, o = r.read(X);
    o.k = RD[k] ? k : 'humidity';
    if (!o.label) o.label = r.label;
    return o;
  }
  function readingAcc(spec) {
    var r = RD[spec.k];
    if (!r) return null;
    return typeof r.acc === 'function' ? r.acc(spec.v) : r.acc;
  }

  // ------------------------------------------------------------ the pieces
  // each: the declaration above; X (see create()): st, now, h24, ctx, opts, wx(), hourly(), daily(), night(t), energy(),
  // events(), calNames(), timers(), music(), face()
  var PIECES = {};
  function define(piece, d) {
    if (!piece || !d || !d.shapes || typeof d.shapes !== 'object') return null;
    var out = { name: d.name || piece, group: d.group || '', wave: d.wave || 'now', facts: d.facts || [], source: d.source || '', when: d.when || null,
                wakes: d.wakes || [], pick: d.pick || null, off: !!d.off, opts: d.opts || {}, defaults: d.defaults || {}, accent: d.accent || null, shapes: {} };
    Object.keys(d.shapes).forEach(function (s) {
      var sh = d.shapes[s];
      if (SHAPES.indexOf(s) >= 0 && sh && typeof sh.read === 'function' && typeof sh.draw === 'function') out.shapes[s] = sh;
    });
    if (!Object.keys(out.shapes).length) return null;
    PIECES[piece] = out;
    return out;
  }
  function has(piece, shape) {
    // (one argument: a v1 widget id, as before)
    if (shape === undefined) return !!V1[piece];
    return !!(PIECES[piece] && PIECES[piece].shapes[shape]);
  }
  // a piece's own choices, from what it was given: a choice not on the piece's list, or none, is its default
  function optsOf(d, given) {
    var out = {};
    given = given || {};
    Object.keys(d.opts).forEach(function (k) {
      var choices = d.opts[k], v = given[k];
      // (an option that is words, 1 to 40 characters, or a picked entity of the domains it names: GLANCE-SPEC.md)
      if (choices === 'text') { out[k] = typeof v === 'string' && v.trim() ? v.slice(0, 40) : (d.defaults[k] || ''); return; }
      if (typeof choices === 'string' && choices.indexOf('entity:') === 0) {
        out[k] = typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v) && choices.slice(7).split(',').indexOf(v.split('.')[0]) >= 0 ? v : (d.defaults[k] || '');
        return;
      }
      var def = d.defaults[k] !== undefined ? d.defaults[k] : choices[0];
      if (Array.isArray(def)) {
        out[k] = def.map(function (x, i) { return Array.isArray(v) && choices.indexOf(v[i]) >= 0 ? v[i] : x; });
      } else {
        out[k] = choices.indexOf(v) >= 0 ? v : def;
      }
    });
    return out;
  }
  function accOf(d, spec, po) {
    var a = typeof d.accent === 'function' ? d.accent(spec, po) : d.accent;
    return Array.isArray(a) && a.length === 2 && typeof a[0] === 'string' ? a : null;
  }

  // ---- WEATHER: the temperature and the sky (hkWxReadings, the Weather page's reading), by temperature; glyphs by condition
  define('weather', {
    name: 'Weather', group: 'Weather and Sky', wave: 'now', facts: ['weather'], source: 'hkWxReadings', when: null,
    wakes: ['minute', 'house', 'forecast'], pick: null, off: false, opts: {}, accent: function (s) { return tempAcc(s.tf); },
    shapes: {
      inline: {
        read: function (X) {
          var w = X.wx();
          return w && w.temp != null ? { text: deg(w.temp) + ' ' + (w.says || ''), cond: w.cond, night: X.night(+X.now), tf: fahr(X, w.temp, w.unit) } : { text: DASH };
        },
        draw: function (s) { return inl(s.cond ? wxGlyph(s.cond, s.night) : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: '64° Cloudy', cond: 'cloudy', night: false, tf: 64 }
      },
      circular: {
        // today's range as a gauge: the temperature along the day's low to high
        fc: ['daily'],
        read: function (X) {
          var w = X.wx(), t = w && w.temp, hi = w && w.hi, lo = w && w.lo;
          return { main: deg(t), lo: lo == null ? '' : round(lo), hi: hi == null ? '' : round(hi), tf: fahr(X, t, w && w.unit),
                   frac: t != null && hi != null && lo != null && hi > lo ? Math.round(clamp((t - lo) / (hi - lo), 0, 1) * 200) / 200 : null };
        },
        draw: function (s) { return ring({ gauge: true, frac: s.frac, main: s.main, subs: s.lo !== '' && s.hi !== '' ? [s.lo, s.hi] : null }); },
        sample: { main: '64°', lo: '55', hi: '72', tf: 64, frac: 0.53 }
      },
      rectangular: {
        // Now, then the two hours after it from the hourly forecast
        fc: ['hourly'],
        read: function (X) {
          var w = X.wx(), t = +X.now, night = X.night, cols = [{ t: 'Now', c: w ? w.cond : null, n: night(t), v: w ? deg(w.temp) : DASH }];
          var next = (X.hourly() || []).map(function (f) { return { at: when(f && f.datetime), f: f }; })
            .filter(function (e) { return e.at != null && e.at > t; }).sort(function (p, q) { return p.at - q.at; }).slice(0, 2);
          for (var i = 0; i < 2; i++) {
            var e = next[i], at = e ? new Date(e.at) : new Date(new Date(t).setMinutes(0, 0, 0) + 3600000 * (i + 1));
            cols.push({ t: hourName(at, X.h24), c: e ? e.f.condition : null, n: e ? (e.f.is_daytime === false || (e.f.is_daytime == null && night(e.at))) : false, v: e ? deg(num(e.f.temperature)) : DASH });
          }
          return { cols: cols, tf: fahr(X, w && w.temp, w && w.unit) };
        },
        draw: function (s) {
          return '<div class="hrs">' + s.cols.map(function (c) {
            return '<div><div>' + esc(c.t) + '</div>' + (c.c ? wxGlyph(c.c, c.n) : '<svg viewBox="0 0 24 24" aria-hidden="true"></svg>') + '<div>' + esc(c.v) + '</div></div>';
          }).join('') + '</div>';
        },
        sample: { cols: [{ t: 'Now', c: 'cloudy', n: false, v: '64°' }, { t: '3 PM', c: 'partlycloudy', n: false, v: '67°' }, { t: '4 PM', c: 'partlycloudy', n: false, v: '66°' }], tf: 64 }
      },
      card: {
        // the temperature big, its glyph, the condition, the day's high and low
        fc: ['daily'],
        read: function (X) {
          var w = X.wx();
          if (!w || w.temp == null) return { main: DASH, says: '', hi: '', lo: '' };
          return { main: deg(w.temp), cond: w.cond, night: X.night(+X.now), says: w.says || '', tf: fahr(X, w.temp, w.unit),
                   hi: w.hi == null ? '' : deg(w.hi), lo: w.lo == null ? '' : deg(w.lo) };
        },
        draw: function (s) {
          return '<div class="cd"><div class="cw"><div class="big">' + esc(s.main) + '</div>' + (s.cond ? wxGlyph(s.cond, s.night) : '') + '</div>' +
            '<div class="s1">' + esc(s.says || ' ') + '</div>' +
            '<div class="s2">' + (s.hi !== '' || s.lo !== '' ? 'H ' + esc(s.hi || DASH) + '  L ' + esc(s.lo || DASH) : ' ') + '</div></div>';
        },
        h: function () { return 20.1; },
        sample: { main: '64°', cond: 'cloudy', night: false, says: 'Cloudy', hi: '72°', lo: '55°', tf: 64 }
      },
      band: {
        // Today's temperature and sky, the next six hours, the next four days (both forecasts watched)
        fc: ['hourly', 'daily'],
        read: function (X) {
          var w = X.wx(), t = +X.now, night = X.night, now = X.now;
          var hrs = (X.hourly() || []).map(function (f) { return { at: when(f && f.datetime), f: f }; })
            .filter(function (e) { return e.at != null && e.at > t; }).sort(function (p, q) { return p.at - q.at; }).slice(0, 6)
            .map(function (e) {
              return { t: hourName(new Date(e.at), X.h24), c: e.f.condition || '', n: e.f.is_daytime === false || (e.f.is_daytime == null && night(e.at)), v: deg(num(e.f.temperature)) };
            });
          var today = dayKey([now.getFullYear(), now.getMonth(), now.getDate()]), seen = {};
          var days = (X.daily() || []).map(function (f) { return { d: dayOf(f), f: f }; })
            .filter(function (e) { return e.d && dayKey(e.d) > today && !seen[dayKey(e.d)] && (seen[dayKey(e.d)] = true); })
            .sort(function (p, q) { return dayKey(p.d) - dayKey(q.d); }).slice(0, 4)
            .map(function (e) {
              return { t: DAYS[new Date(e.d[0], e.d[1], e.d[2]).getDay()].slice(0, 3), c: e.f.condition || '', hi: deg(num(e.f.temperature)), lo: deg(num(e.f.templow)) };
            });
          return { main: w ? deg(w.temp) : DASH, says: w ? w.says || '' : '', cond: w ? w.cond : '', night: night(t), tf: fahr(X, w && w.temp, w && w.unit), hrs: hrs, days: days };
        },
        draw: function (s) {
          var col = function (c, v) { return '<div class="wfc"><div class="t">' + esc(c.t) + '</div>' + (c.c ? wxGlyph(c.c, c.n) : '<svg viewBox="0 0 24 24" aria-hidden="true"></svg>') + '<div class="v">' + v + '</div></div>'; };
          // (each column `wfc`, never `fc`: the screensaver's own forecast slide is .fc in the same shadow root, and its rules
          // -- hidden, display:none under a generated clock -- hid every column, 2026-11-07)
          // (the hours and the days in one row that wraps out of sight: where the screen is too narrow for them all -- a
          // phone -- the last go first, the days, and never squeezed into each other, 2026-11-02)
          return '<div class="tod"><div class="tw"><div class="big">' + esc(s.main) + '</div>' + (s.cond ? wxGlyph(s.cond, s.night) : '') + '</div><div class="s1">' + esc(s.says || ' ') + '</div></div>' +
            '<div class="fcs">' +
            (s.hrs.length ? '<div class="sep"></div>' + s.hrs.map(function (c) { return col(c, esc(c.v)); }).join('') : '') +
            (s.days.length ? '<div class="sep"></div>' + s.days.map(function (c) { return col(c, esc(c.hi) + ' <i>' + esc(c.lo) + '</i>').replace('class="wfc"', 'class="wfc dy"'); }).join('') : '') +
            '</div>';
        },
        w: function () { return 80; },
        h: function () { return 15; },
        sample: {
          main: '64°', says: 'Cloudy', cond: 'cloudy', night: false, tf: 64,
          hrs: [{ t: '3 PM', c: 'partlycloudy', n: false, v: '67°' }, { t: '4 PM', c: 'partlycloudy', n: false, v: '66°' }, { t: '5 PM', c: 'cloudy', n: false, v: '62°' },
                { t: '6 PM', c: 'cloudy', n: true, v: '59°' }, { t: '7 PM', c: 'rainy', n: true, v: '57°' }, { t: '8 PM', c: 'rainy', n: true, v: '56°' }],
          days: [{ t: 'Tue', c: 'rainy', hi: '61°', lo: '52°' }, { t: 'Wed', c: 'partlycloudy', hi: '66°', lo: '50°' }, { t: 'Thu', c: 'sunny', hi: '70°', lo: '51°' }, { t: 'Fri', c: 'sunny', hi: '72°', lo: '54°' }]
        }
      }
    }
  });

  // ---- READINGS: one reading in a ring, two side by side, or Big Weather's row; AQI by its category, the others their own
  define('readings', {
    name: 'Readings', group: 'Weather and Sky', wave: 'now', facts: ['readings'], source: 'hkWxReadings', when: null,
    wakes: ['minute', 'house', 'forecast'], pick: null, off: false,
    opts: { reading: ['humidity', 'aqi', 'inside', 'sunset', 'wind'], readings: ['humidity', 'aqi', 'inside', 'sunset', 'wind'] },
    defaults: { reading: 'humidity', readings: ['humidity', 'aqi'] },
    // (the ring takes its reading's color; the pair and the row set a color on each of their readings)
    accent: function (s) { return s.k ? readingAcc(s) : null; },
    shapes: {
      circular: {
        read: function (X) { var o = readingOf(X, X.opts.reading); return { k: o.k, main: o.main, sub: o.sub, frac: o.frac, v: o.v }; },
        draw: function (s) { return ring({ gauge: s.k !== 'sunset', frac: s.frac, main: s.main, sub: s.sub }); },
        sample: function (po) {
          var S = { humidity: { main: '58%', sub: 'HUM', frac: 0.58, v: null }, aqi: { main: '42', sub: 'AQI', frac: 0.14, v: 42 }, inside: { main: '71°', sub: 'IN', frac: 0.53, v: 71 },
                    sunset: { main: '5:12', sub: 'SUNSET', frac: 0.8, v: null }, wind: { main: '8', sub: 'MPH', frac: 0.27, v: null } };
          var o = S[po.reading] || S.humidity;
          return { k: S[po.reading] ? po.reading : 'humidity', main: o.main, sub: o.sub, frac: o.frac, v: o.v };
        }
      },
      rectangular: {
        // two readings, each its label, its figure and a bar
        read: function (X) {
          return { cols: X.opts.readings.map(function (k) { var o = readingOf(X, k); return { k: o.k, main: o.main, label: RD[o.k].label, frac: o.frac, v: o.v }; }) };
        },
        draw: function (s) {
          return '<div class="rr">' + s.cols.map(function (c) {
            return '<div' + accStyle(readingAcc(c)) + '><div class="rl">' + esc(c.label) + '</div><div class="rv">' + esc(c.main) + '</div>' + bar(c.frac) + '</div>';
          }).join('') + '</div>';
        },
        sample: function (po) {
          var S = { humidity: ['58%', 0.58, null], aqi: ['42', 0.14, 42], inside: ['71°', 0.53, 71], sunset: ['5:12', 0.8, null], wind: ['8', 0.27, null] };
          return { cols: (po.readings || ['humidity', 'aqi']).map(function (k) { var s = S[k] || S.humidity; return { k: S[k] ? k : 'humidity', main: s[0], label: RD[S[k] ? k : 'humidity'].label, frac: s[1], v: s[2] }; }) };
        }
      },
      band: {
        // Big Weather's bottom row, as it draws it: only the readings the house has, each figure over its label
        read: function (X) {
          var w = X.wx(), cols = [], n = sunNext(X.st, X.now);
          if (w && n) cols.push({ k: 'sunset', main: tm(n.at, X.h24, true), label: n.name });
          else if (w && w.sunset) cols.push({ k: 'sunset', main: tm(w.sunset, X.h24, true), label: 'Sunset' });
          if (w && w.wind != null) cols.push({ k: 'wind', main: Math.round(w.wind) + (w.windUnit ? ' ' + w.windUnit : ''), label: 'Wind' });
          if (w && w.humidity != null) cols.push({ k: 'humidity', main: Math.round(w.humidity) + '%', label: 'Humidity' });
          if (w && w.aqi != null) cols.push({ k: 'aqi', main: String(w.aqi), label: 'AQI', v: w.aqi });
          return { cols: cols };
        },
        draw: function (s) {
          return s.cols.length ? s.cols.map(function (c) {
            return '<div class="rd"' + accStyle(readingAcc(c)) + '>' + esc(c.main) + '<small><i class="dot a"></i>' + esc(c.label) + '</small></div>';
          }).join('') : '<div class="rd">' + DASH + '</div>';
        },
        w: function (s) { return Math.max(1, s ? s.cols.length : 0) * 14; },
        h: function () { return 10; },
        sample: { cols: [{ k: 'sunset', main: '5:12 PM', label: 'Sunset' }, { k: 'wind', main: '8 mph', label: 'Wind' }, { k: 'humidity', main: '58%', label: 'Humidity' }, { k: 'aqi', main: '42', label: 'AQI', v: 42 }] }
      }
    }
  });

  // ---- DATE
  // (2026-11-04, the owner: "an option to make it 2 line and any other styling options that would make sense"): one line
  // or two (the weekday over the date, lined up by Align, its side of the screen by default); the weekday and the month
  // long, short or none/a number; the year; the weight and capitals. The defaults draw it as it always was.
  function dateLines(d, po) {
    po = po || {};
    var m = d.getMonth(), day = d.getDate(), yr = po.year === 'on';
    var date = po.month === 'number' ? (m + 1) + '/' + day + (yr ? '/' + d.getFullYear() : '')
             : (po.month === 'short' ? MONTHS[m].slice(0, 3) : MONTHS[m]) + ' ' + day + (yr ? ', ' + d.getFullYear() : '');
    var wk = po.weekday === 'none' ? '' : po.weekday === 'short' ? DAYS[d.getDay()].slice(0, 3) : DAYS[d.getDay()];
    return !wk ? [date] : po.lines === 'two' ? [wk, date] : [wk + ', ' + date];
  }
  function dateDraw(s) {
    var cls = (s.weight && s.weight !== 'standard' ? ' dw-' + s.weight : '') + (s.upper ? ' dc-upper' : '');
    if (s.lines.length < 2) return '<span class="il' + cls + '"><span>' + esc(s.lines[0]) + '</span></span>';
    return '<span class="il dl' + cls + '">' + s.lines.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</span>';
  }
  function dateOf(d, po) { return { lines: dateLines(d, po), weight: po && po.weight, upper: !!(po && po.case === 'upper') }; }
  define('date', {
    name: 'Date', group: 'Time and Calendar', wave: 'now', facts: ['date'], source: 'clock', when: null, wakes: ['minute'], pick: null, off: false,
    opts: { lines: ['one', 'two'], weekday: ['long', 'short', 'none'], month: ['long', 'short', 'number'], year: ['off', 'on'], weight: ['standard', 'light', 'bold'], case: ['normal', 'upper'] }, accent: null,
    shapes: {
      inline: {
        read: function (X) { return dateOf(X.now, X.opts); },
        draw: dateDraw,
        text: function (s) { return s.lines.join(' '); },
        lines: function (s) { return s ? s.lines.length : 1; },
        sample: function (po) { return dateOf(new Date(2026, 10, 2), po); }
      }
    }
  });

  // ---- TIME: the small time, in the Look's face font where the face has a text form, else the widget font
  function timeFont(X) { var f = X.ctx && X.ctx.face && X.ctx.face.font; return f ? familyOf(f) : ''; }
  define('time', {
    name: 'Time', group: 'Time and Calendar', wave: 'now', facts: ['time'], source: 'clock', when: null, wakes: ['minute'], pick: null, off: false, opts: {}, accent: null,
    shapes: {
      inline: {
        read: function (X) { return { text: tm(X.now, X.h24), font: timeFont(X) }; },
        draw: function (s) { return s.font ? '<span class="il"><span style="font-family:' + esc(s.font) + '">' + esc(s.text) + '</span></span>' : inl('', s.text); },
        text: function (s) { return s.text; },
        sample: { text: '7:42', font: '' }
      },
      card: {
        // the time over the date
        read: function (X) { return { time: tm(X.now, X.h24), date: DAYS[X.now.getDay()] + ', ' + MONTHS[X.now.getMonth()] + ' ' + X.now.getDate(), font: timeFont(X) }; },
        draw: function (s) {
          return '<div class="cd tc"><div class="big"' + (s.font ? ' style="font-family:' + esc(s.font) + '"' : '') + '>' + esc(s.time) + '</div><div class="s1">' + esc(s.date) + '</div></div>';
        },
        h: function () { return 17.1; },
        sample: { time: '7:42', date: 'Monday, November 2', font: '' }
      }
    }
  });

  // ---- STATUS: the house's security (hk-header.js status()): green secured, amber something open, red an alarm going off
  define('status', {
    name: 'House Status', group: 'Home', wave: 'now', facts: ['status'], source: 'hkHeader', when: null, wakes: ['house'], pick: null, off: false, opts: {},
    accent: function (s) { return LEVEL[s.lvl] || null; },
    shapes: {
      inline: {
        read: function (X) { var h = homeWords(X.st); return { text: h ? h.line : DASH, lvl: homeLevel(h), gl: h ? 1 : 0 }; },
        draw: function (s) { return inl(s.gl ? '<i class="dot a"></i>' : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Home Secured', lvl: 'ok', gl: 1 }
      },
      circular: {
        // the locks: how many are open
        read: function (X) {
          var n = 0, known = 0;
          locksOf(X.st).forEach(function (id) {
            var v = (X.st[id] || {}).state;
            if (v === 'unknown' || v === 'unavailable' || v === undefined) return;
            known++;
            if (v === 'unlocked') n++;
          });
          return { text: !known ? DASH : n ? n + ' Unlocked' : 'Locked', open: n > 0, lvl: !known ? '' : n ? 'open' : 'ok' };
        },
        draw: function (s) {
          // (the ring's track as every circular piece has it, so the row's circles are one size; the glyph in it, the words on the
          // labels' one baseline, 72 -- 2026-11-02, a bare lock looked smaller than its neighbors and sat on a line of its own)
          var fs = s.text.length > 8 ? 11 : 14;
          return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="43" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="7.5"/>' +
            '<g class="a" transform="translate(35.6 24) scale(1.2)">' + lockGlyph(s.open) + '</g>' +
            '<text x="50" y="72" text-anchor="middle" font-weight="600" font-size="' + fs + '">' + esc(s.text) + '</text></svg>';
        },
        sample: { text: 'Locked', open: false, lvl: 'ok' }
      },
      rectangular: {
        // HOME, then the alarm and the first thing wrong; or Secured, and the alarm
        read: function (X) {
          var h = homeWords(X.st);
          if (!h) return { l1: 'Home', l2: DASH, l3: '', lvl: '' };
          // (the alarm once, first, then what is wrong)
          var rest = h.items.filter(function (t) { return t !== h.alarm; });
          if (h.secured) return { l1: 'Home', l2: 'Secured', l3: h.alarm, lvl: homeLevel(h) };
          return { l1: 'Home', l2: h.alarm || rest[0] || 'All Clear', l3: (h.alarm ? rest : rest.slice(1)).slice(0, 2).join(DOT), lvl: homeLevel(h) };
        },
        draw: function (s) { return lines(s.l1, s.l2, s.l3, !!s.lvl); },
        sample: { l1: 'Home', l2: 'Secured', l3: 'Armed Away', lvl: 'ok' }
      },
      card: {
        // HOME, the alarm, then up to two things open or unlocked -- or Secured
        read: function (X) {
          var h = homeWords(X.st);
          if (!h) return { alarm: '', items: [], secured: null, lvl: '' };
          // (the alarm said once: Home Status's own list starts with it)
          var rest = h.items.filter(function (t) { return t !== h.alarm; });
          return { alarm: h.alarm, items: h.secured ? [] : rest.slice(0, 2), secured: !!h.secured, lvl: homeLevel(h) };
        },
        draw: function (s) {
          var row = function (t, dot) { return '<div class="cl">' + (dot ? '<i class="dot a"></i>' : '') + esc(t) + '</div>'; };
          var body = s.secured === null ? row(DASH) : (s.alarm ? row(s.alarm, s.lvl === 'alarm') : '') +
            (s.secured ? row('Secured', true) : s.items.length ? s.items.map(function (t) { return row(t, true); }).join('') : row('All Clear', true));
          return '<div class="cd ti"><div class="ct">Home</div>' + body + '</div>';
        },
        h: function (s) { return 8.1 + 3.78 * Math.max(1, (s && s.secured !== null ? (s.alarm ? 1 : 0) + (s.secured ? 1 : Math.max(1, s.items.length)) : 1)); },
        sample: { alarm: 'Armed Away', items: [], secured: true, lvl: 'ok' }
      }
    }
  });

  // ---- MUSIC: shows while the screensaver's music reading says something plays (ctx.music, from musicOf())
  function musicOn(X) {
    var m = X.ctx && X.ctx.music;
    return m && !m.idle && m.title ? m : null;
  }
  define('music', {
    name: 'Music', group: 'Media and Photos', wave: 'now', facts: ['music'], source: 'musicOf', when: 'while music plays', wakes: ['house'], pick: null, off: false, opts: {}, accent: null,
    shapes: {
      inline: {
        read: function (X) {
          var m = musicOn(X);
          return m ? { text: String(m.title) + (m.artist ? DOT + m.artist : ''), gl: 1 } : { off: true, text: '' };
        },
        draw: function (s) { return inl(NOTE, s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Night Harbor' + DOT + 'The Fictional Trio', gl: 1 }
      },
      card: {
        // the art (a square with rounded corners; a note when there is none), the song, the artist, the room
        read: function (X) {
          var m = musicOn(X);
          return m ? { title: String(m.title), artist: String(m.artist || ''), room: String(m.room || ''), pic: String(m.pic || '') } : { off: true };
        },
        draw: function (s) {
          return '<div class="cd mc">' + (s.pic ? '<img class="art" alt="" src="' + esc(s.pic) + '">' : '<span class="art">' + NOTE + '</span>') +
            '<div class="mt"><div class="m1">' + esc(s.title) + '</div>' + (s.artist ? '<div class="m2">' + esc(s.artist) + '</div>' : '') +
            (s.room ? '<div class="m3">' + esc(s.room) + '</div>' : '') + '</div></div>';
        },
        h: function () { return 16; },
        sample: { title: 'Night Harbor', artist: 'The Fictional Trio', room: 'Kitchen', pic: '' }
      }
    }
  });

  // ---- TIMERS: shows while one runs (sensor.running_quick_timers); orange
  define('timers', {
    name: 'Timers', group: 'Time and Calendar', wave: 'now', facts: ['timers'], source: 'sensor.running_quick_timers', when: 'while a timer runs',
    wakes: ['second', 'house'], pick: null, off: false, opts: {}, accent: ORANGE,
    shapes: {
      circular: {
        // the timer ending soonest, its time left as a ring that empties
        idle: true,
        read: function (X) {
          var row = timerRows(X)[0];
          if (!row) return { off: true, main: DASH, name: 'TIMER', frac: 0, live: false };
          return { main: clockText(row.left), name: cut(row.name.toUpperCase(), 9), frac: row.total ? Math.round(clamp(row.left / row.total, 0, 1) * 500) / 500 : 1, live: row.left > 0 };
        },
        draw: function (s) { return ring({ frac: s.frac, main: s.main, sub: s.name }); },
        sample: { main: '4:12', name: 'PASTA', frac: 0.42, live: false }
      },
      card: {
        // up to three running, each a small ring, its name and its time left
        idle: true,
        read: function (X) {
          var rows = timerRows(X).slice(0, 3);
          if (!rows.length) return { off: true, rows: [], live: false };
          return { rows: rows.map(function (r) { return { name: cut(r.name, 16), left: clockText(r.left), frac: r.total ? Math.round(clamp(r.left / r.total, 0, 1) * 500) / 500 : 1 }; }),
                   live: rows.some(function (r) { return r.left > 0; }) };
        },
        draw: function (s) {
          return '<div class="cd">' + (s.rows.length ? s.rows.map(function (r) {
            return '<div class="tr">' + miniRing(r.frac) + '<div class="tn">' + esc(r.name) + '</div><div class="tt">' + esc(r.left) + '</div></div>';
          }).join('') : '<div class="s2">No timers running</div>') + '</div>';
        },
        h: function (s) { var n = Math.max(1, s && s.rows ? s.rows.length : 1); return 4 + 5.4 * n + 0.4 * (n - 1); },
        sample: { rows: [{ name: 'Pasta', left: '4:12', frac: 0.42 }, { name: 'Dryer', left: '18:30', frac: 0.7 }], live: false }
      }
    }
  });

  // ---- EVENTS: the calendar's next events, each in its calendar's color
  define('events', {
    name: 'Calendar', group: 'Time and Calendar', wave: 'now', facts: ['calendar'], source: 'hkCalendar', when: null, wakes: ['minute', 'calendar'], pick: null, off: false, opts: {},
    accent: function (s) { var e = s.evs && s.evs[0]; return e && e.c ? e.c : s.c || null; },
    shapes: {
      inline: {
        read: function (X) {
          var e = nextEvent(X.events(), X.now, X.calNames());
          return e ? { text: e.title + DOT + eventWhen(e, X.h24), c: eventAcc(e, X.st), gl: 1 } : { text: DASH };
        },
        draw: function (s) { return inl(s.gl ? '<i class="dot a"></i>' : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Piano Lesson' + DOT + '3:30 PM', c: ['#ff9f0a', '#9a5f06'], gl: 1 }
      },
      rectangular: {
        // the next two (one, the whole three lines: when, what, where)
        read: function (X) {
          var evs = nextEvents(X.events(), X.now, X.calNames(), 2);
          return { evs: evs.map(function (e) {
            return { l1: (e.now ? 'Now' : 'Up Next') + DOT + eventWhen(e, X.h24), l2: e.title, l3: e.where, w: eventWhen(e, X.h24), c: eventAcc(e, X.st) };
          }) };
        },
        draw: function (s) {
          if (!s.evs.length) return lines('Up Next', DASH, '');
          if (s.evs.length === 1) return '<div class="ev1"' + accStyle(s.evs[0].c) + '>' + lines(s.evs[0].l1, s.evs[0].l2, s.evs[0].l3, true) + '</div>';
          return '<div class="evs">' + s.evs.map(function (e) {
            return '<div class="ev"' + accStyle(e.c) + '><i class="dot a"></i><div><div class="e1">' + esc(e.l2) + '</div><div class="e2">' + esc(e.w + (e.l3 ? DOT + e.l3 : '')) + '</div></div></div>';
          }).join('') + '</div>';
        },
        sample: { evs: [{ l1: 'Up Next' + DOT + '3:30 PM', l2: 'Piano Lesson', l3: 'Music Room', w: '3:30 PM', c: ['#ff9f0a', '#9a5f06'] },
                        { l1: 'Up Next' + DOT + '6:00 PM', l2: 'Dinner at Mom\'s', l3: '', w: '6:00 PM', c: ['#5ea5ff', '#1d5fb8'] }] }
      }
    }
  });

  // ---- ENERGY: the house battery (green) or the panels (yellow) in a ring; today's sums (hkEnergy.summary)
  define('energy', {
    name: 'Energy', group: 'Energy', wave: 'now', facts: ['energy'], source: 'hkEnergy', when: null, wakes: ['house', 'energy'], pick: null, off: false,
    opts: { reading: ['battery', 'solar'] }, defaults: { reading: 'battery' },
    accent: function (s) { return s.k === 'solar' ? YELLOW : s.k === 'battery' ? GREEN : null; },
    shapes: {
      circular: {
        read: function (X) {
          if (X.opts.reading === 'solar') {
            var k = solarOf(X), top = k == null ? 5 : k > 10 ? 20 : k > 5 ? 10 : 5;
            return { k: 'solar', main: k == null ? DASH : k >= 10 ? String(Math.round(k)) : (Math.round(k * 10) / 10).toFixed(1), frac: k == null ? null : Math.round(clamp(k / top, 0, 1) * 200) / 200 };
          }
          var b = batteryOf(X);
          return { k: 'battery', main: b == null ? DASH : Math.round(b) + '%', frac: b == null ? null : clamp(b / 100, 0, 1) };
        },
        draw: function (s) { return s.k === 'solar' ? ring({ gauge: true, frac: s.frac, main: s.main, sub: 'kW' }) : ring({ frac: s.frac, main: s.main, sub: 'HOME' }); },
        sample: function (po) {
          return po.reading === 'solar' ? { k: 'solar', main: '3.2', frac: 0.64 } : { k: 'battery', main: '84%', frac: 0.84 };
        }
      },
      rectangular: {
        // the Energy page's sums (hkEnergy.summary, as the Energy slide reads them): today's use and what the panels made
        read: function (X) {
          var s = X.energy(), H = window.hkEnergy, k = function (v) { return (H && H.kwh ? H.kwh(v) : (Math.round(v * 10) / 10).toFixed(1)) + ' kWh'; };
          if (!s || !s.today) return { l1: 'Energy Today', l2: DASH + ' kWh used', l3: DASH + ' kWh made' };
          var solar = (s.rings || []).some(function (r) { return r.key === 'solar'; });
          return { l1: 'Energy Today', l2: k(s.today.energy) + ' used', l3: solar ? k(s.today.solar) + ' made' : '' };
        },
        draw: function (s) { return lines(s.l1, s.l2, s.l3); },
        sample: { l1: 'Energy Today', l2: '18.4 kWh used', l3: '22.1 kWh made' }
      }
    }
  });

  // ---- TITLE: the photo's title (ctx.title: album · year)
  define('title', {
    name: 'Photo Title', group: 'Media and Photos', wave: 'now', facts: ['title'], source: 'photo', when: null, wakes: ['house'], pick: null, off: false, opts: {}, accent: null,
    shapes: {
      inline: {
        read: function (X) { var t = X.ctx && X.ctx.title; return { text: t === undefined || t === null ? DASH : String(t) }; },
        draw: function (s) { return inl('', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Lake Weekend' + DOT + '2024' }
      }
    }
  });

  // ------------------------------------------------------------ the v1 ids (the old widget ids, through the spec's table)
  var V1 = {
    temp: ['weather', 'circular'], aqi: ['readings', 'circular', { reading: 'aqi' }], humidity: ['readings', 'circular', { reading: 'humidity' }],
    inside: ['readings', 'circular', { reading: 'inside' }], sunset: ['readings', 'circular', { reading: 'sunset' }],
    battery: ['energy', 'circular', { reading: 'battery' }], solar: ['energy', 'circular', { reading: 'solar' }],
    timer: ['timers', 'circular'], locks: ['status', 'circular'],
    next_event: ['events', 'rectangular'], next_hours: ['weather', 'rectangular'], home_status: ['status', 'rectangular'], energy_today: ['energy', 'rectangular'],
    date: ['date', 'inline'], weather_line: ['weather', 'inline'], status_line: ['status', 'inline'], event_line: ['events', 'inline'], photo_title: ['title', 'inline'],
    readings: ['readings', 'band']
  };
  // (the cards' ids map too, for a caller that makes one by its old id; they are not in IDS)
  var V1CARDS = { clock_card: ['time', 'card'], music_card: ['music', 'card'], timers_card: ['timers', 'card'], weather_card: ['weather', 'card'],
                  status_card: ['status', 'card'], forecast_band: ['weather', 'band'] };

  // ------------------------------------------------------------ one piece, in one shape
  function create(piece, shape, o) {
    if (typeof shape === 'string') return build(piece, shape, o, null);
    // create(v1id, opts): the old widget id, through the table (its own opts under the caller's)
    var v1 = V1[piece] || V1CARDS[piece];
    o = shape || {};
    if (!v1) return null;
    var opts = {};
    Object.keys(v1[2] || {}).forEach(function (k) { opts[k] = v1[2][k]; });
    Object.keys(o.opts || {}).forEach(function (k) { opts[k] = o.opts[k]; });
    return build(v1[0], v1[1], { u: o.u, back: o.back, color: o.color, h24: o.h24, weather: o.weather, opts: opts }, piece);
  }
  function build(piece, shape, o, v1id) {
    var decl = PIECES[piece], def = decl && decl.shapes[shape];
    if (!def) return null;
    o = o || {};
    var back = BACKS.indexOf(o.back) >= 0 ? o.back : 'none', color = COLORS.indexOf(o.color) >= 0 ? o.color : 'auto';
    var u = num(o.u) > 0 ? num(o.u) : 8, h24 = !!o.h24, po = optsOf(decl, o.opts);
    var el = document.createElement('div');
    el.className = 'hksw k-' + shape + ' p-' + piece + ' w-' + (v1id || piece) + ' b-' + back + ' c-' + color +
                   (o.align === 'right' || o.align === 'center' ? ' al-' + o.align : '') + (o.title === false ? ' no-ti' : '');
    el.style.setProperty('--u', u + 'px');
    ensureCss();

    var dead = false, busy = false, drawn = null, spec = null, last = { client: null, now: null, ctx: null };
    var fcs = {}, needFetched = {};
    var en = { at: 0, val: null, stale: false };
    var api = { el: el, id: v1id || piece, piece: piece, shape: shape, kind: shape, facts: decl.facts.slice(), live: false, showing: !decl.when };

    // THE FORECASTS this piece draws (daily: today's high and low, the days; hourly: the next hours), watched as the cards
    // watch them (hkWxForecast: one watcher per kind -- the band needs both), drawn again when one arrives, and let go of
    // in destroy()
    function watchForecast(entity) {
      var F = window.hkWxForecast, c = last.client, started = false;
      if (!def.fc || !F || !c || !c.subscriptions || !entity) return false;
      def.fc.forEach(function (kind) {
        var s = fcs[kind] || (fcs[kind] = { w: null, entity: '', data: [] });
        if (s.entity === entity) return;
        if (s.w) s.w.release();
        s.entity = entity;
        var w = s.w = F.watch(c.subscriptions, kind, entity, function () {
          if (!w || s.w !== w) return;
          s.data = w.data();
          again();
        });
        // (a forecast another card already watches is here now, and is not announced again)
        s.data = w.data();
        started = true;
      });
      return started;
    }
    // CODE THAT ISN'T THERE YET (Mantel loads its card files on first use): asked for once, drawn again when it lands
    function need(file) {
      if (needFetched[file] || !window.hkNeed || !window.hkNeed.file) return;
      needFetched[file] = true;
      try { Promise.resolve(window.hkNeed.file(file)).then(again, function () { /* the next update asks no more */ }); } catch (e) { /* none */ }
    }
    // (with the clock the caller last gave: an editor's preview of the evening keeps its evening)
    function again() { if (!dead && last.client) api.update(last.client, last.now, last.ctx); }

    var X = {
      client: null, st: {}, now: new Date(), h24: h24, ctx: null, quiet: false, opts: po, piece: piece, shape: shape,
      // the weather now (hkWxReadings, the Weather page's reading) with the daily forecast this piece watches
      wx: function () {
        var R = window.hkWxReadings;
        if (X.quiet) return null;
        if (!R) { need('hk-weather.js'); return null; }
        var read = function () { return R.read(X.client, { entity: o.weather || null, daily: X.daily() }); };
        var w = read();
        if (w && watchForecast(w.entity)) w = read();
        Object.keys(fcs).forEach(function (k) { if (fcs[k].w) fcs[k].w.ensure(); });
        return w;
      },
      hourly: function () { return X.quiet || !fcs.hourly ? [] : fcs.hourly.data; },
      daily: function () { return X.quiet || !fcs.daily ? [] : fcs.daily.data; },
      // night at an instant: the header's reading of the sun's times, else the sun now
      night: function (t) {
        var H = window.hkHeader;
        try { if (H && H.nightAt) return !!H.nightAt(X.st, t); } catch (e) { /* below */ }
        return (X.st['sun.sun'] || {}).state === 'below_horizon' && Math.abs(t - +X.now) < 3600000;
      },
      // the Energy page's sums, kept ENERGY_TTL (a minute's worth of statistics is not worth reading every update); the
      // statistics' arrival draws the piece again
      energy: function () {
        var H = window.hkEnergy, t = Date.now();
        if (X.quiet) return null;
        if (!H || !H.summary) { need('hk-energy.js'); return null; }
        // (asked again when its sums arrive -- at most once a second: a summary that wakes whoever just read it would
        // otherwise read again at once, forever, and hold the page; 2026-11-01, the house's Battery widget)
        if (en.at && t - en.at < (en.stale ? 1000 : en.val ? ENERGY_TTL : 3000)) return en.val;
        en.stale = false; en.at = t;
        try {
          en.val = H.summary(X.client, waker) || null;
        } catch (e) { console.warn('[hk-saverwidgets]', piece, e && e.message); en.val = null; }
        return en.val;
      },
      // the calendar's events: handed in (ctx.events), else the shared read (one per CAL_TTL for every piece)
      events: function () { return X.quiet ? [] : X.ctx && Array.isArray(X.ctx.events) ? X.ctx.events : calendar(X.client); },
      calNames: function () {
        var names = {};
        Object.keys(X.st).forEach(function (k) { if (k.indexOf('calendar.') === 0) names[k] = (X.st[k].attributes || {}).friendly_name || ''; });
        return names;
      }
    };
    // ONE WAKER for this piece, and its wake a moment later: the summary keeps who it wakes (a new one on each read
    // was a new subscriber each time), and a wake drawn at once from inside a read never lets the page breathe
    var wakeT = null, waker = { get isConnected() { return !dead; }, requestUpdate: wake, redraw: wake };
    function wake() {
      en.stale = true;
      if (wakeT || dead) return;
      // (after the second a read waits for: then the read it wakes for is one that reads)
      wakeT = setTimeout(function () { wakeT = null; if (!busy) again(); }, Math.max(250, 1000 - (Date.now() - en.at)));
    }
    if (decl.wakes.indexOf('calendar') >= 0) CAL.watchers.push(again);

    api.update = function (client, now, ctx) {
      if (dead) return false;
      last.client = client || { states: {} }; last.now = now; last.ctx = ctx;
      X.client = last.client; X.st = last.client.states || {};
      X.now = now instanceof Date ? now : isFinite(now) && now !== null && now !== undefined ? new Date(now) : new Date();
      X.ctx = ctx || null;
      if (busy) { en.stale = true; return false; }
      busy = true;
      try {
        try { spec = def.read(X); } catch (e) {
          // (a reading that throws draws what an empty house would: dashes)
          console.warn('[hk-saverwidgets]', piece, shape, e && e.message);
          X.quiet = true;
          try { X.st = {}; X.ctx = null; spec = def.read(X); } catch (e2) { return false; } finally { X.quiet = false; }
        }
      } finally { busy = false; }
      api.live = !!spec.live;
      // (blank: a line of words with nothing to say -- a lone dash, no reading of its fact on this house -- which the
      // screensaver leaves out as it does a "shows when..." piece with nothing to show; a circle keeps its dash, a gauge waiting)
      var says = shape === 'inline' && def.text ? String(def.text(spec) || '').trim() : null;
      api.showing = !spec.off;
      api.blank = shape === 'inline' && (says === '' || says === DASH);
      var key = JSON.stringify(spec);
      if (key === drawn) return false;
      drawn = key;
      paint(el, decl, def, spec, po);
      return true;
    };

    // THE SIZE IT WANTS, in px: its unit size; an inline piece's is its text's -- measured where the page can, else
    // estimated from the number of letters (the tests' shim has no layout); a card's height is what it drew
    api.measure = function () {
      // (an inline piece with a backdrop is a pill: 4.8 u tall, 2.4 u at each end, 1.8 u on its glyph's side)
      var k = SIZE[shape], pill = shape === 'inline' && back !== 'none', gl = !!(spec && (spec.gl || spec.cond)), pad = pill ? (gl ? 4.2 : 4.8) * u : 0,
          ih = ((pill ? 4.8 : k[1]) + (def.lines && def.lines(spec) > 1 ? LINE2 : 0)) * u;
      var hOf = function () { return (def.h ? def.h(spec) : k[1]) * u; };
      if (shape === 'inline') {
        var inner = el.firstElementChild || null, mw = inner && inner.offsetWidth > 0 ? inner.offsetWidth : 0;
        if (mw) return { w: Math.ceil(mw + pad), h: ih };
        var txt = spec && def.text ? def.text(spec) : '';
        return { w: txt ? Math.ceil(txt.length * 0.52 * 2.8 * u + (gl ? 4.3 * u : 0) + pad) : 0, h: ih };
      }
      if (shape === 'band') return { w: (def.w ? def.w(spec) : 60) * u, h: hOf() };
      // (a card is as wide as its words, 24 to 44 u: a song's title isn't cut at a width it was given, 2026-11-02)
      if (shape === 'card') return { w: el.offsetWidth > 0 ? el.offsetWidth : k[0] * u, h: el.offsetHeight > 0 ? el.offsetHeight : hOf() };
      return { w: k[0] * u, h: k[1] * u };
    };
    api.setU = function (v) {
      if (!(num(v) > 0)) return;
      u = num(v);
      el.style.setProperty('--u', u + 'px');
    };
    api.destroy = function () {
      dead = true;
      clearTimeout(wakeT); wakeT = null;
      if (window.hkStats && window.hkStats.release) { try { window.hkStats.release(waker); } catch (e) { /* gone */ } }
      Object.keys(fcs).forEach(function (k) { if (fcs[k].w) { fcs[k].w.release(); fcs[k].w = null; } });
      var i = CAL.watchers.indexOf(again);
      if (i >= 0) CAL.watchers.splice(i, 1);
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    return api;
  }
  // a spec onto an element: its markup (nothing, while a "shows when" piece has nothing and draws no placeholder) and its accent
  function paint(el, decl, def, spec, po) {
    el.innerHTML = spec.off && !def.idle ? '' : def.draw(spec, po);
    // (an inline piece in two lines -- the Date's -- is taller by one line of its words)
    if (def.lines && el.classList) el.classList.toggle('l2', def.lines(spec) > 1);
    var acc = accOf(decl, spec, po);
    if (acc) {
      el.style.setProperty('--sw-acc', acc[0]);
      el.style.setProperty('--sw-acc-d', acc[1]);
    } else if (el.style.removeProperty) {
      el.style.removeProperty('--sw-acc');
      el.style.removeProperty('--sw-acc-d');
    }
  }
  // AN ELEMENT DRAWN FROM THE SAMPLE, for the editor's library: the shape's plausible readings (64°, Cloudy), no house data
  function sample(piece, shape, o) {
    var decl = PIECES[piece], def = decl && decl.shapes[shape];
    if (!def) return null;
    o = o || {};
    var back = BACKS.indexOf(o.back) >= 0 ? o.back : 'none', color = COLORS.indexOf(o.color) >= 0 ? o.color : 'auto';
    var u = num(o.u) > 0 ? num(o.u) : 4, po = optsOf(decl, o.opts);
    var el = document.createElement('div');
    el.className = 'hksw k-' + shape + ' p-' + piece + ' w-' + piece + ' b-' + back + ' c-' + color;
    el.style.setProperty('--u', u + 'px');
    ensureCss();
    var spec = typeof def.sample === 'function' ? def.sample(po) : def.sample;
    paint(el, decl, def, JSON.parse(JSON.stringify(spec || {})), po);
    return el;
  }

  // THE CALENDAR'S EVENTS, one read for every piece that wants them (hkCalendar.load, the Calendar page's and the
  // side pane's own): today and tomorrow, asked for again after CAL_TTL, a failed read after CAL_RETRY, and a read
  // that never answers given up after CAL_LOST (as the side pane's: one sent as the connection was made again never
  // answers). No calendar code or no calendars: nothing is asked.
  var CAL_RETRY = 30000, CAL_LOST = 30000;
  var CAL = { evs: null, at: 0, busy: 0, failAt: 0, n: 0, asked: false, watchers: [] };
  function calendar(client) {
    var K = window.hkCalendar, now = Date.now();
    if (!K && !CAL.asked && window.hkNeed && window.hkNeed.file) {
      CAL.asked = true;
      try { Promise.resolve(window.hkNeed.file('hk-calendar.js')).then(function () { CAL.watchers.slice().forEach(function (f) { f(); }); }, function () { /* none */ }); } catch (e) { /* none */ }
    }
    if (CAL.busy && now - CAL.busy > CAL_LOST) CAL.busy = 0;
    if (!K || !K.load || !K.ids || !client || CAL.busy || now - CAL.failAt < CAL_RETRY || (CAL.evs && now - CAL.at < CAL_TTL)) return CAL.evs || [];
    var ids = [];
    try { ids = K.ids(client); } catch (e) { ids = []; }
    if (!ids.length) { CAL.evs = []; CAL.at = now; return CAL.evs; }
    var n = ++CAL.n, from = new Date(); from.setHours(0, 0, 0, 0);
    var to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 2);
    CAL.busy = now;
    var done = function () { CAL.busy = 0; };
    try {
      K.load(client, ids, from, to).then(function (got) {
        if (n !== CAL.n) return;
        done(); CAL.evs = (got && got.evs) || []; CAL.at = Date.now(); CAL.failAt = 0;
        CAL.watchers.slice().forEach(function (f) { f(); });
      }, function () { if (n === CAL.n) { done(); CAL.failAt = Date.now(); } });
    } catch (e) { done(); CAL.failAt = now; }
    return CAL.evs || [];
  }

  window.hkSaverWidgets = {
    alignLeft: alignLeft, PIECES: PIECES, SHAPES: SHAPES, has: has, define: define, create: create, sample: sample, CSS: CSS, sheet: sheet, addCss: addCss,
    // (the v1 ids: what the old callers asked for)
    IDS: Object.keys(V1), V1: V1, kind: function (id) { return V1[id] ? V1[id][1] : null; },
    _: { ring: ring, miniRing: miniRing, bar: bar, wxGlyph: wxGlyph, nextEvent: nextEvent, nextEvents: nextEvents, eventWhen: eventWhen, sunNext: sunNext, homeWords: homeWords,
         cal: CAL, tm: tm, esc: esc, num: num, clamp: clamp, deg: deg, when: when, cut: cut, DASH: DASH, DOT: DOT, lines: lines, inl: inl, accStyle: accStyle, ramp: ramp, tempAcc: tempAcc,
         aqiAcc: aqiAcc, eventAcc: eventAcc, optsOf: optsOf, familyOf: familyOf, timerRows: timerRows, readingOf: readingOf, hourName: hourName, clockText: clockText,
         ACC: { green: GREEN, amber: AMBER, red: RED, yellow: YELLOW, orange: ORANGE } }
  };
})();
