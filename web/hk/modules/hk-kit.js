// hk-kit.js -- THE KIT: the parts every New card is built from (docs/phase34/PLAN.md, 2026-11-22; the owner's review page,
// https://claude.ai/artifact/VW9DVM3ZipfFEgzrwT6Gj4: "everything should be cohesive, and work together from a design standpoint.
// It all needs to speak the same language" ... "close attention to margins/padding/spacing ... that radius follows through").
//
// Every card that has a kit drawing draws it (the trial's Card Design switch was removed 2026-11-23, the owner: "I really just
// wanted to be able to revert back code wise"); a card's older drawing stays only for what the kit doesn't draw (its _renderKit
// returns false). The parts, in design px of the block (a square cell is 196):
//
//   EDGES   words on the text inset (--hk-pad-*, 18 on square cells); shapes inside a card -- keys, covers, app icons, pictures,
//           the alarm's tile -- on the shape inset (--hk-spad-*, 13: the grid's gap)
//   CORNERS concentric: a shape on the shape inset takes the block's corner less that inset (34 - 13 = 21)
//   TYPE    display 24/700 (a song, an alert), title 20/600, body 18/400 secondary, label 15/600 secondary, hero 64 (52 on a
//           short cell) weight 500 tabular. Nothing else.
//   HEADER  every plate starts the same: the title at 18, the body under it at 42; 300 px and wider a 28 glyph leads (the
//           words then start 40 further in); "N more" at its right end. Content starts at 74.
//   KEY     the only control shape: 64 tall, the inner corner, 8 apart, edge to edge; the chosen one white (near-black on a
//           lit plate, and on Flat Light, where white is the plate)
//   ROW     60 tall (rows that share a card's height divide it evenly): a lead on the text inset, the words 12 after it,
//           title over body or the name left and the reading right; a hairline under all but the last
//   LIT     a plate for one device that is on is white with dark words, as HomeView's tiles are
//   GLYPHS  the screen's Icons (hkSettings.tileIcons) or the block's own Glyphs: White turns a glyph white only at rest;
//           anything on or needing you keeps its color
//
//   hkKit.on(card)               whether this card's screen draws New
//   hkKit.draw(card, html, bind) puts a New card's html in the card's root (its styles first) and runs bind(root)
//   hkKit.ctx(card)              { w, h, E, X, R, r, sq, light, white } for the block
//   hkKit.plate / head / key / keyRow / keyGrid / stack / row / rows / tx / glyph / svg / hero / headY / FY
// @ts-check
(function (global) {
  'use strict';
  if (global.hkKit) return;

  var KH = 64, G = 8, RH = 60, Y0 = 74;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function v(n, d) { return 'var(--hk-' + n + ',' + d + ')'; }

  // ---------------------------------------------------------------- the styles, once per card root
  var CSS = [
    '.kit{position:relative;box-sizing:border-box;height:100%;width:100%;overflow:hidden;color:' + v('ink', 'rgba(255,255,255,0.94)') + ';-webkit-tap-highlight-color:transparent;cursor:pointer;' +
      'font-family:' + v('font-body', '-apple-system,sans-serif') + '}',
    '.kit *{box-sizing:border-box}',
    '.kit .a{position:absolute}',
    '.kit .fc{display:flex;align-items:center;justify-content:center}',
    '.kit .num{font-variant-numeric:tabular-nums}',
    '.kit .kd,.kit .kt,.kit .kb,.kit .kl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}',
    '.kit .kd{font-size:24px;font-weight:700;letter-spacing:-.5px;line-height:28px}',
    '.kit .kd.two{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}',
    '.kit .kt{font-size:20px;font-weight:600;letter-spacing:-.4px;line-height:24px}',
    '.kit .kb{font-size:18px;font-weight:400;letter-spacing:-.3px;line-height:22px;color:' + v('ink-2', 'rgba(255,255,255,0.68)') + '}',
    '.kit .kl{font-size:15px;font-weight:600;letter-spacing:-.1px;line-height:20px;color:' + v('ink-2', 'rgba(255,255,255,0.68)') + '}',
    '.kit .kh{font-weight:500;letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.kit .quiet{color:' + v('ink-2', 'rgba(255,255,255,0.68)') + ';font-weight:500}',
    '.kit .sep{height:1px;background:' + v('line', 'rgba(255,255,255,.14)') + '}',
    // a key: the whole of it is the touch
    '.kit .key{all:unset;position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;' +
      'border-radius:var(--kit-r,21px);background:' + v('key', 'rgba(255,255,255,.14)') + ';color:inherit;text-shadow:inherit;touch-action:manipulation}',
    '.kit .key:active{background:' + v('key-strong', 'rgba(255,255,255,.24)') + '}',
    '.kit .key.on{background:#fff;color:#1c1c1e;text-shadow:none}',
    // (round 12: a key with nothing to do right now -- Lock All with everything locked -- is dimmed and takes no touch)
    '.kit .key[disabled]{opacity:.4;cursor:default;pointer-events:none}',
    '.kit .key:focus-visible,.kit .row:focus-visible,.kit .hit:focus-visible{outline:2px solid ' + v('ink-2', 'rgba(255,255,255,0.68)') + ';outline-offset:-2px}',
    '.kit .row,.kit .hit{all:unset;position:absolute;box-sizing:border-box;cursor:pointer}',
    '.kit .row:active,.kit .hit:active{background:' + v('key', 'rgba(255,255,255,.1)') + '}',
    // a glyph
    '.kit .g{display:inline-flex;align-items:center;justify-content:center;flex:none;line-height:0}',
    '.kit hk-icon{display:inline-block}',
    // LIT: white, dark words, no glow
    '.kit.lit{background:#fff !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;color:#1c1c1e;text-shadow:none;' +
      '--hk-glow:none;--hk-ink:#1c1c1e;--hk-ink-2:#767678;--hk-ink-3:rgba(60,60,67,.42);--hk-key:rgba(0,0,0,.065);--hk-key-strong:rgba(0,0,0,.12);--hk-line:rgba(0,0,0,.1);' +
      'box-shadow:' + v('on-shadow', '0 1px 2px rgba(0,0,0,.06),0 6px 18px rgba(0,0,0,.09)') + ' !important}',
    '.kit.lit .key.on,.kit.light .key.on{background:#1c1c1e;color:#fff}',
    // a picture or an app icon: its own corner, a soft shadow
    '.kit .pic{position:absolute;overflow:hidden;background:' + v('key', 'rgba(255,255,255,.14)') + ';box-shadow:0 4px 14px rgba(0,0,0,.22),0 0 0 .5px rgba(0,0,0,.12)}',
    '.kit .pic img{width:100%;height:100%;object-fit:cover;display:block}',
    // a track and its fill (progress, a battery)
    '.kit .trk{position:absolute;height:6px;border-radius:3px;background:' + v('line-strong', 'rgba(255,255,255,.24)') + ';overflow:hidden}',
    '.kit .trk>i{display:block;height:100%;border-radius:3px;background:currentColor}',
    // a round remote pad
    '.kit .pad{position:absolute;border-radius:50%;background:' + v('key', 'rgba(255,255,255,.14)') + '}',
    '.kit .pad .ok{position:absolute;left:32%;top:32%;width:36%;height:36%;border-radius:50%;background:' + v('key', 'rgba(255,255,255,.14)') +
      ';box-shadow:inset 0 0 0 1px ' + v('line', 'rgba(255,255,255,.14)') + '}',
    '.kit .pad button{all:unset;position:absolute;cursor:pointer;display:grid;place-items:center;border-radius:50%;color:' + v('ink-2', 'rgba(255,255,255,0.68)') + '}',
    '.kit .pad button:active{background:' + v('key-strong', 'rgba(255,255,255,.24)') + '}',
    // a page dot (a block that swipes)
    '.kit .dots{position:absolute;left:0;right:0;display:flex;justify-content:center;gap:7px}',
    '.kit .dots i{width:7px;height:7px;border-radius:4px;background:' + v('ink-3', 'rgba(255,255,255,0.40)') + '}.kit .dots i.on{background:' + v('ink', 'rgba(255,255,255,0.94)') + '}',
    // HomeView's centered tile at one cell (DESIGN.md: the glyph at a third, the name 21/600 and the state 20/400 under it; a short
    // cell 17/16)
    '.kit .ctn,.kit .cts{position:absolute;left:8px;right:8px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.kit .ctn{font-weight:600;letter-spacing:-.3px}.kit .cts{font-weight:400;letter-spacing:-.25px;color:' + v('ink-2', 'rgba(255,255,255,0.68)') + '}',
    '@media (prefers-reduced-motion:reduce){.kit *{animation:none !important;transition:none !important}}'
  ].join('');

  // ---------------------------------------------------------------- glyphs the kit draws itself
  var P = {
    chev: '<path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    down: '<path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
    up: '<path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
    home:
      '<rect x="3" y="4.5" width="18" height="12" rx="2.4" fill="none" stroke="currentColor" stroke-width="2.1"/><path d="M8.5 20h7" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
    play: '<path d="M7 4.8v14.4L19 12z"/>',
    pause: '<rect x="6.2" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.6" y="5" width="4.2" height="14" rx="1.3"/>',
    pp: '<path d="M3 6v12l8.5-6z"/><rect x="13.5" y="6" width="3" height="12" rx="1"/><rect x="18.5" y="6" width="3" height="12" rx="1"/>',
    minus: '<rect x="5" y="10.9" width="14" height="2.2" rx="1.1"/>',
    plus: '<rect x="5" y="10.9" width="14" height="2.2" rx="1.1"/><rect x="10.9" y="5" width="2.2" height="14" rx="1.1"/>',
    mute: '<path d="M3 9.5h3.5L11 5.5v13l-4.5-4H3z"/><path d="M15 9.5l5 5M20 9.5l-5 5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
    power: '<path d="M12 3.5v8M6.4 6.9a7.8 7.8 0 1 0 11.2 0" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>',
    dock: '<path d="M3.5 11.5L12 4l8.5 7.5M6 10v10h12V10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    more: '<circle cx="5.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.5" cy="12" r="1.9"/>',
    rooms:
      '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" fill="none" ' +
      'stroke="currentColor" stroke-width="2"/>' +
      '<rect x="3.5" y="13.5" width="7" height="7" rx="1.8" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" fill="none" ' +
        'stroke="currentColor" stroke-width="2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  /** @param {string} name @param {number} px @param {string} [color] */
  function svg(name, px, color) {
    return '<span class="g" style="width:' + px + 'px;height:' + px + 'px' + (color ? ';color:' + color : '') + '"><svg viewBox="0 0 24 24" width="' + px + '" height="' + px +
      '" fill="currentColor" aria-hidden="true">' + (P[name] || '') + '</svg></span>';
  }
  // a glyph by its icon name (hk:..., mdi:...); `on`: it is on or needs you, so it keeps its color under White glyphs
  /** @param {string} icon @param {number} px @param {string} [color] @param {boolean} [on] */
  function glyph(icon, px, color, on) {
    return '<span class="g' + (on ? ' on' : '') + '" style="width:' + px + 'px;height:' + px + 'px' + (color ? ';color:' + color : '') + '"><hk-icon icon="' + esc(icon) +
      '" style="--mdc-icon-size:' + px + 'px;width:' + px + 'px;height:' + px + 'px"></hk-icon></span>';
  }

  // ---------------------------------------------------------------- the block
  // (always: kept as the cards' one question, so the kit can be the only place that decides)
  /** @param {any} [card] */
  function on(card) { return true; }
  function px(cs, name, d) { var n = cs ? parseFloat(cs.getPropertyValue(name)) : NaN; return n >= 0 ? n : d; }
  // the block's size and insets, its corner and the look's light or dark
  function ctx(card) {
    var b = card && card._block ? card._block() : null, cs = null;
    try { cs = getComputedStyle(card); } catch (e) { cs = null; }
    var w = b ? b.w : (card && card.clientWidth) || 196, h = b ? b.h : (card && card.clientHeight) || 196;
    var X = px(cs, '--hk-pad-l', 18), E = px(cs, '--hk-spad-l', h < 180 && w < 220 ? 10 : 13), R = px(cs, '--hk-block-radius', 34);
    var S = global.hkSettings, look = null;
    try { look = S && S.rendering ? S.rendering() : null; } catch (e) { look = null; }
    var light = !!(look && look.flat && look.theme === 'light');
    var cfg = (card && card._config) || {}, icons = 'auto';
    try { icons = S && S.tileIcons ? S.tileIcons() : 'auto'; } catch (e) { icons = 'auto'; }
    var white = cfg.glyphs === 'white' || (cfg.glyphs !== 'color' && (icons === 'white' ||
      (icons === 'auto' && /^bright/.test(String((document.documentElement && document.documentElement.getAttribute('data-hk-glass')) || '')))));
    return { w: w, h: h, E: E, X: X, R: R, r: Math.max(8, R - E), sq: h >= 180 || (w < 220 && h >= 180), short: h < 180 && h > 0 && h < 200, light: light, white: white };
  }
  // a glyph's color for this block: White glyphs turn one at rest the words' own color; one that is on keeps its color
  /** @param {any} k @param {string} color @param {boolean} [isOn] */
  function tone(k, color, isOn) { return k.white && !isOn ? v('ink', 'rgba(255,255,255,0.94)') : color; }

  // ---------------------------------------------------------------- the parts (absolute, in the block's px)
  /** @param {number} x @param {number} y @param {number|null} [w] @param {number|null} [h] */
  function st(x, y, w, h) { return 'left:' + r1(x) + 'px;top:' + r1(y) + 'px;' + (w != null ? 'width:' + r1(w) + 'px;' : '') + (h != null ? 'height:' + r1(h) + 'px;' : ''); }
  function r1(n) { return Math.round(n * 10) / 10; }
  /** @param {number} x @param {number} y @param {number|null} w @param {number|null} h @param {string} [cls] @param {string} [css] @param {string} [inner] */
  function box(x, y, w, h, cls, css, inner) { return '<div class="a ' + (cls || '') + '" style="' + st(x, y, w, h) + (css || '') + '">' + (inner || '') + '</div>'; }
  /** @param {number} x @param {number} y @param {number} w @param {string} cls @param {string} text @param {string} [css] */
  function tx(x, y, w, cls, text, css) { return box(x, y, w, null, cls, css, text); }
  // the plate: the look's own surface (hkCards.plate: glass, its blur, its edge), or white while lit
  /** @param {any} k @param {string} inner @param {any} [o] */
  function plate(k, inner, o) {
    o = o || {};
    var C = global.hkCards, surf = C && C.plate ? C.plate('card') : '';
    return '<hk-plate class="kit' + (o.lit ? ' lit' : '') + (k.light ? ' light' : '') + (k.white ? ' white' : '') + (o.cls ? ' ' + o.cls : '') + '" data-hk-role="card" role="group" aria-label="' +
      esc(o.label || '') + '" style="' + surf + ';--kit-r:' + k.r + 'px' + (o.css ? ';' + o.css : '') + '">' + inner + '</hk-plate>';
  }
  // where a header goes: at 18, or centered with what is under it when a plate has only that much to show
  function headY(h, block) { return Math.max(18, Math.round((h - block) / 2)); }
  /** @param {any} k @param {any} o */
  function head(k, o) {
    var g = o.g && k.w >= 300, x = g ? k.X + 40 : k.X, y = o.y == null ? 18 : o.y, out = '';
    var trail = o.more ? (k.w >= 300 ? o.more + ' more' : '+' + o.more) : '', tw = trail ? Math.round(trail.length * 11 + 22) : 0;
    if (g) out += box(k.X, y + 9, 28, 28, 'fc', '', o.g);
    out += tx(x, y, k.w - x - k.X - tw - (tw ? 8 : 0), 'kt', esc(o.title)) + (o.sub ? tx(x, y + 24, k.w - x - k.X, 'kb', o.subHtml ? o.sub : esc(o.sub)) : '');
    if (trail) out += box(k.w - k.X - tw, y, tw, 24, '', 'display:flex;justify-content:flex-end;align-items:center;gap:1px', '<span class="kb">' + esc(trail) + '</span>' +
      svg('chev', 16, v('ink-3', 'rgba(255,255,255,0.40)')));
    return out;
  }
  // a key: o { g (html), t (words), on, tint, label, data: {name: value} }
  /** @param {number} x @param {number} y @param {number} w @param {number} h @param {any} o */
  function key(x, y, w, h, o) {
    var data = Object.keys(o.data || {}).map(function (n) { return ' data-' + n + '="' + esc(o.data[n]) + '"'; }).join('');
    return '<button type="button" class="key' + (o.on ? ' on' : '') + '" data-notap' + (o.off ? ' disabled aria-disabled="true"' : '') + data + ' aria-label="' + esc(o.label || o.t || '') +
      '" style="' + st(x, y, w, h) +
      (o.tint ? 'color:' + o.tint : '') + '">' + (o.g || '') + (o.t ? '<span class="kt" style="color:inherit">' + esc(o.t) + '</span>' : '') + '</button>';
  }
  function keyRow(x, y, w, list) { var n = list.length, kw = (w - (n - 1) * G) / n; return list.map(function (o, i) { return key(x + i * (kw + G), y, kw, KH, o); }).join(''); }
  function keyGrid(x, y, w, cols, list) { var kw = (w - (cols - 1) * G) / cols; return list.map(
    function (o, i) { return key(x + (i % cols) * (kw + G), y + Math.floor(i / cols) * (KH + G), kw, KH, o); }).join(''); }
  function FY(k) { return k.h - k.E - KH; }
  function foot(k, list) { return keyRow(k.E, FY(k), k.w - 2 * k.E, list); }
  // rows of keys stacked up from the bottom edge, each edge to edge
  function stack(k, lines) { var y = k.h - k.E - lines.length * KH - (lines.length - 1) * G, o = '';
    lines.forEach(function (ks, i) { o += keyRow(k.E, y + i * (KH + G), k.w - 2 * k.E, ks); }); return o; }
  function chunk(a, n) { var r = []; for (var i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; }
  // a row: r { lead (html), lw, lh, t, b, trail, quiet, label, data }; its words center in its height
  /** @param {any} k @param {number} x @param {number} y @param {number} w @param {any} r @param {boolean} [last] @param {number} [rh] */
  function row(k, x, y, w, r, last, rh) {
    rh = rh || RH;
    // (round 12: r.trw is room kept at the right for a trail the card draws itself -- On Now's dot and count; r.trCss is the trail's own style, Recent's softer time)
    var lw = r.lw || (r.lead ? 28 : 0), x1 = x + k.X + (lw ? lw + 12 : 0),
      trw = r.trw != null ? r.trw : r.trail ? Math.min(Math.round(String(r.trail).length * 11 + 12), Math.round((w - k.X - x1 + x) * 0.45)) : 0;
    var tw = x + w - k.X - x1 - (trw ? trw + 10 : 0), ty = y + (rh - (r.b ? 46 : 24)) / 2;
    var data = Object.keys(r.data || {}).map(function (n) { return ' data-' + n + '="' + esc(r.data[n]) + '"'; }).join('');
    var o = '<button type="button" class="row"' + (r.data ? ' data-notap' : '') + data + ' aria-label="' + esc(r.label || r.t) + '" style="' + st(x, y, w, rh) + '"></button>';
    if (r.lead) o += box(x + k.X, y + (rh - (r.lh || 28)) / 2, lw, r.lh || 28, 'fc', 'pointer-events:none', r.lead);
    var tc = r.quiet ? 'kt quiet' : 'kt';
    o += r.b ? tx(x1, ty, tw, tc, esc(r.t), 'pointer-events:none;' + (r.tCss || '')) + tx(x1, ty + 24, tw, 'kb', r.bHtml ? r.b : esc(r.b), 'pointer-events:none')
      : tx(x1, ty, tw, tc, esc(r.t), 'pointer-events:none;' + (r.tCss || ''));
    if (r.trail) o += tx(x + w - k.X - trw, y + (rh - 22) / 2, trw, 'kb', esc(r.trail), 'text-align:right;pointer-events:none;' +
      (r.trCss != null ? r.trCss : r.quiet ? '' : 'color:' + v('ink', 'rgba(255,255,255,0.94)')));
    if (!last) o += box(x1, y + rh - 1, x + w - k.X - x1, 1, 'sep', 'pointer-events:none');
    return o;
  }
  // rows in columns from y0 down to yMax (cols share the rows evenly); { html, more }
  /** @param {any} k @param {number} x0 @param {number} w @param {number} y0 @param {number} yMax @param {number} cols @param {any[]} items @param {number} [rh] */
  function rows(k, x0, w, y0, yMax, cols, items, rh) {
    rh = rh || RH;
    var n = Math.max(1, Math.min(Math.floor((yMax - y0) / rh), Math.ceil(items.length / cols))), cap = n * cols, shown = items.slice(0, cap), o = '';
    var cw = (w + (cols - 1) * k.X) / cols;
    shown.forEach(function (r, i) { var c = Math.floor(i / n), j = i % n; o += row(k, x0 + c * (cw - k.X), y0 + j * rh, cw, r, j === n - 1 || i === shown.length - 1, rh); });
    return { html: o, more: items.length - shown.length };
  }
  /** @param {number} x @param {number} y @param {number} w @param {string} text @param {number} fs @param {string} [align] */
  function hero(x, y, w, text, fs, align) { return tx(x, y, w, 'kh', text, 'font-size:' + fs + 'px;height:' + fs + 'px;text-align:' + (align || 'left')); }
  function dots(k, n, at) { var o = ''; for (var i = 0; i < n; i++) o += '<i' + (i === at ? ' class="on"' : '') + '></i>'; return '<div class="dots" style="top:' + (k.h - 10) + 'px">' + o + '</div>';
    }
  // the remote's round pad: data-key up / down / left / right / select
  function pad(x, y, d) {
    var a = Math.round(d * 0.15), o = '<div class="pad" data-notap style="' + st(x, y, d, d) + '"><span class="ok"></span>';
    /** @type {any[][]} */ ([['up', 'Up', d * 0.33, 0, d * 0.34, d * 0.32, 'up'], ['down', 'Down', d * 0.33, d * 0.68, d * 0.34, d * 0.32, 'down'],
      ['left', 'Left', 0, d * 0.33, d * 0.32, d * 0.34, 'back'],
      ['right', 'Right', d * 0.68, d * 0.33, d * 0.32, d * 0.34, 'chev']]).forEach(function (p) {
      o += '<button type="button" data-key="' + p[0] + '" aria-label="' + p[1] + '" style="' + st(p[2], p[3], p[4], p[5]) + '">' + svg(p[6], a) + '</button>';
    });
    return o + '<button type="button" data-key="select" aria-label="Select" style="' + st(d * 0.32, d * 0.32, d * 0.36, d * 0.36) + '"></button></div>';
  }

  // a block of one cell drawn as HomeView's centered tile: fig (a glyph, an icon, a number) at a third, the name and state under it
  /** @param {any} k @param {string} fig @param {string} name @param {string} sub @param {string} [subColor] */
  function tile(k, fig, name, sub, subColor) {
    var sq = k.h >= 180, gp = sq ? 66 : 50, gy = sq ? 32 : Math.round(k.h * 0.31 - 25), ny = sq ? 113 : Math.round(k.h * 0.55), lh = sq ? 27 : 22;
    return box((k.w - gp) / 2, gy, gp, gp, 'fc', '', fig) +
      '<div class="ctn" style="top:' + ny + 'px;font-size:' + (sq ? 21 : 17) + 'px;line-height:' + lh + 'px">' + esc(name) + '</div>' +
      '<div class="cts" style="top:' + (ny + lh) + 'px;font-size:' + (sq ? 20 : 16) + 'px;line-height:' + lh + 'px' + (subColor ? ';color:' + subColor : '') + '">' + esc(sub) + '</div>';
  }

  // ---------------------------------------------------------------- drawing a card
  // the card's root gets the kit's styles once and the html; the card's own Current html is forgotten, so going back draws it
  /** @param {any} card @param {string} html @param {(root: any) => void} [bind] */
  function draw(card, html, bind) {
    var root = card && card._root;
    if (!root) return false;
    card._html = null;
    if (card._kitHtml === html && root.querySelector('hk-plate.kit')) return true;
    card._kitHtml = html;
    root.innerHTML = '<style>' + CSS + '</style>' + html;
    if (bind) { try { bind(root); } catch (e) { console.error('[hk-kit] bind', e); } }
    // what isn't a key or a row opens the card's own sheet, as Current's plate does; a key says data-notap
    root.querySelectorAll('[data-notap]').forEach(function (el) { el.addEventListener('click', function (e) { e.stopPropagation(); }); });
    return true;
  }
  // a card that drew New and now draws Current again starts from nothing
  function forget(card) { if (card && card._kitHtml) { card._kitHtml = null; card._html = null; } }

  global.hkKit = { version: '1.0.0', CSS: CSS, KH: KH, G: G, RH: RH, Y0: Y0, esc: esc, v: v, on: on, ctx: ctx, tone: tone, draw: draw, forget: forget,
    plate: plate, head: head, headY: headY, key: key, keyRow: keyRow, keyGrid: keyGrid, foot: foot, FY: FY, stack: stack, chunk: chunk, row: row, rows: rows,
    tx: tx, box: box, st: st, hero: hero, tile: tile, dots: dots, pad: pad, svg: svg, glyph: glyph };
})(window);
