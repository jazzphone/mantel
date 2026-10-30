// THE PAGE'S END (hk-layout.js HkGridView._pageEnd / plateEdge; DESIGN.md
// "Page edges"): every page ends a gutter below its lowest plate -- but a
// card that fits itself to the window and keeps its own foot (data-hk-foot:
// the Music page's two columns) ends the page that foot below its own box.
// Its frame runs on under a bottom tab bar (hk-music.js); measured as a
// plate, the page ended a gutter below the WINDOW's foot and the bar's room
// was counted twice -- 1366 x 900 scrolled 114 px for nothing (2026-10-18).
// The boxes here are laid out by hand: a tiny tree of rects, the view's
// height following its root's bottom margin as a block's does.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
var root = HK_ROOT;
load(root + '/tests/dom.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
load(root + '/frontend/cards/hk-base.js');
load(root + '/frontend/cards/hk-layout.js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
}
var View = customElements.get('hk-grid-view');

// a box: tag, rect (top, bottom; left 0, width W), style, attributes, kids
var W = 1366;
function box(tag, top, bottom, cs, attrs, kids, shadow) {
  var n = { localName: tag, nodeType: 1, _cs: cs || {}, attrs: attrs || {}, children: kids || [], shadowRoot: null,
            getAttribute: function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
            getBoundingClientRect: function () {
              var t = typeof top === 'function' ? top() : top, b = typeof bottom === 'function' ? bottom() : bottom;
              return { top: t, bottom: b, left: 0, right: W, width: W, height: b - t };
            } };
  if (shadow) n.shadowRoot = { children: shadow };
  return n;
}
var CLEAR = 'rgba(0, 0, 0, 0)';
globalThis.getComputedStyle = function (el) {
  var c = el._cs || {};
  return { position: c.position || 'static', display: c.display || 'block',
           overflowY: c.overflowY || 'visible', backgroundColor: c.bg || CLEAR, backgroundImage: 'none',
           boxShadow: c.shadow || 'none', borderTopLeftRadius: c.radius || '0px',
           paddingBottom: c.paddingBottom || '0px',
           marginBottom: el.style && el.style.marginBottom ? el.style.marginBottom : (c.marginBottom || '0px'),
           getPropertyValue: function (k) { return k === '--hk-side' ? '0.02' : ''; } };
};
var GLASS = { bg: 'rgba(255, 255, 255, 0.2)', radius: '18px' };
var GUTTER = 8 + W * 0.02;

// A view whose content box ends where its root's margin box does, or at the
// window less the bar's room (its min-height), whichever is lower. `rootEnd`:
// the root's own bottom, before its margin.
function page(rootEnd, kids, minEnd) {
  var r = box('div', 0, rootEnd, {}, {}, kids);
  r.style = {};
  var v = box('hk-grid-view', 0, function () {
    return Math.max(minEnd, rootEnd + (parseFloat(r.style.marginBottom) || 0));
  });
  v._root = r; v.isConnected = true;
  v._holds = View.prototype._holds; v._clipRoom = function () {};
  v.end = function () { View.prototype._pageEnd.call(v); return v.getBoundingClientRect().bottom; };
  return v;
}

// THE MUSIC PAGE, 1366 x 900, a 96 px tab bar along the bottom: the card's
// box 28 -> 788 (its frame gives back the bar's room + 16), the frame 28 ->
// 900 under the bar, Browse's plate to the window's foot, Now Playing's to
// the card's. The view's min-height: 900 - 96.
var VH = 900, BAR = 96;
function music(foot, cardEnd, rootEnd) {
  var left = box('div', 28, cardEnd, GLASS), right = box('div', 92, VH, GLASS);
  var mu = box('div', 28, VH, {}, { 'class': 'mu' }, [left, right]);
  var plate = box('hk-plate', 28, cardEnd, { bg: CLEAR }, {}, [mu]);
  var card = box('hk-music-card', 28, cardEnd, {}, foot == null ? {} : { 'data-hk-foot': String(foot) }, [], [plate]);
  return page(rootEnd == null ? cardEnd + 8 : rootEnd, [card], VH - BAR);
}

(function () {
  var plateEdge = View.plateEdge;
  var bare = music(null, 788);
  ok('without a foot, the plate that runs on under the bar is the lowest (the bug\'s cause)',
     plateEdge(bare._root, 'bottom', GUTTER) === VH, plateEdge(bare._root, 'bottom', GUTTER));
  var end = bare.end();
  ok('...and the page grew past the window by about the bar\'s room', end + BAR > VH + 100, end);

  var m = music(16, 788);
  ok('a footed card counts as a plate (foot - gutter) below its box',
     Math.abs(plateEdge(m._root, 'bottom', GUTTER) - (788 + 16 - GUTTER)) < 1e-9, plateEdge(m._root, 'bottom', GUTTER));
  ok('its box is searched no further: Browse, under the bar, is not the page', plateEdge(m._root, 'bottom', GUTTER) < 788);
  end = m.end();
  ok('the Music page with a tab bar ends at the window (no scroll)', end + BAR <= VH, end);
  ok('...no margin is added: the card\'s foot already reaches the bar\'s room',
     (parseFloat(m._root.style.marginBottom) || 0) <= 8, m._root.style.marginBottom);
  var was = m._root.style.marginBottom, again = m.end();
  ok('measured again, nothing moves (no growth on every resize)', again === end && m._root.style.marginBottom === was);

  // A margin left from before (the bug's own, 114.5 px) is taken back.
  m = music(16, 788);
  m._root.style.marginBottom = '114.5px';
  end = m.end();
  ok('a stale margin is taken back: the page fits again', end + BAR <= VH && m._root.style.marginBottom === '8px',
     end + ' ' + m._root.style.marginBottom);

  // NO RESIDUAL FROM ROUNDING: a fractional top (23.19 on a tablet) leaves
  // the root's end a fraction off; rounded to nearest the margin overshot the
  // window by 0.04 px, which the browser can round up to a pixel of scroll.
  m = music(16, 787.96, 787.96 + 7.94);
  end = m.end();
  ok('the margin rounds down: the page never ends past the window by a fraction', end <= VH - BAR,
     end + ' margin ' + m._root.style.marginBottom);

  // NO TAB BAR: the frame ends 16 px above the window, the card's box with it.
  var nb = (function () {
    var left = box('div', 28, 884, GLASS), right = box('div', 92, 884, GLASS);
    var card = box('hk-music-card', 28, 884, {}, { 'data-hk-foot': '16' }, [],
                   [box('hk-plate', 28, 884, { bg: CLEAR }, {}, [box('div', 28, 884, {}, {}, [left, right])])]);
    return page(892, [card], VH);
  })();
  end = nb.end();
  ok('without a tab bar the Music page ends at the window too (a gutter below its frame scrolled 19 px)', end <= VH, end);
})();

// ORDINARY PAGES STILL END AT THEIR GUTTER (the 2026-10-17 Climate/Safari
// cases): a long page's lowest plate a gutter above its end, a short one's
// view held at the window by its min-height.
(function () {
  var long = page(1508, [box('div', 0, 1508, {}, {}, [box('hk-plate', 1200, 1500, GLASS)])], VH - BAR);
  var end = long.end();
  ok('a long page ends a gutter below its lowest plate', Math.abs(end - (1500 + GUTTER)) <= 0.1, end);
  var short = page(408, [box('div', 0, 408, {}, {}, [box('hk-plate', 100, 400, GLASS)])], VH - BAR);
  end = short.end();
  ok('a short page stays the window\'s height (its min-height)', end === VH - BAR, end);
  // a footed card beside a taller ordinary plate: the plate's gutter wins
  var mixed = page(1008, [box('div', 0, 1008, {}, {}, [
    box('hk-x-card', 28, 788, {}, { 'data-hk-foot': '16' }, [], [box('hk-plate', 28, 788, GLASS)]),
    box('hk-plate', 700, 1000, GLASS)])], VH - BAR);
  end = mixed.end();
  ok('a lower ordinary plate still ends the page a gutter below it', Math.abs(end - (1000 + GUTTER)) <= 0.1, end);
  // the left edge is untouched by a foot
  ok('plateEdge(left) ignores data-hk-foot', View.plateEdge(mixed._root, 'left') === 0);
})();

// THE PAGE'S END DOES NOT READ THE VIEW'S FOOT (Energy, 2026-10-18): a view's
// foot may not follow its root's bottom margin (a margin collapsing through
// it), and a pass that read it added the same difference again every time
// -- Energy ended 73 px past its last card, Power and Vacuums the same way.
// Here the view's foot ignores the margin altogether: every pass must still
// set the same margin, a gutter below the lowest plate.
(function () {
  var r = box('div', 0, 2368, {}, {}, [box('div', 0, 2368, {}, {}, [box('hk-plate', 2200, 2362, GLASS)])]);
  r.style = {};
  var v = box('hk-grid-view', 0, 2368);
  v._root = r; v.isConnected = true; v._holds = View.prototype._holds; v._clipRoom = function () {};
  var seen = [];
  for (var i = 0; i < 4; i++) { View.prototype._pageEnd.call(v); seen.push(r.style.marginBottom); }
  var want = Math.floor((GUTTER - (2368 - 2362)) * 10 + 1e-6) / 10 + 'px';
  ok('every pass sets the same margin whatever the view\'s foot does (no drift)',
     seen.every(function (x) { return x === want; }), seen.join(' ') + ' want ' + want);
  ok('...a gutter below the lowest plate: the root\'s foot + margin = plate + gutter',
     Math.abs(2368 + parseFloat(r.style.marginBottom) - (2362 + GUTTER)) <= 0.1, r.style.marginBottom);
  // and a margin left from before, however large, is not added to
  r.style.marginBottom = '73.2px';
  View.prototype._pageEnd.call(v);
  ok('a stale margin is replaced, not added to', r.style.marginBottom === want, r.style.marginBottom);
  // the view keeps that margin inside it: a block formatting context
  var src = View.prototype._build.toString();
  ok('the view is a flow-root, so the root\'s bottom margin stays inside it', /:host\{display:flow-root;/.test(src));
  ok('...clipping below only, with no overflow-clip-margin (Safari has none)', /:host\{display:flow-root;overflow-y:clip[;}]/.test(src) && !/clip-margin\s*:/.test(src + View.prototype._clipRoom.toString()));
})();

// THE CLIP REACHES THE BAR'S ROOM (shadows below the last row fade out
// instead of stopping flat at the view's foot, 2026-10-18)
(function () {
  var seen = globalThis.getComputedStyle;
  globalThis.getComputedStyle = function (el) {
    var r = seen(el);
    if (el._pad !== undefined) r.paddingBottom = el._pad;
    return r;
  };
  function view(pad) {
    var v = { parentElement: pad === null ? null : { _pad: pad, _cs: {} }, style: {} };
    View.prototype._clipRoom.call(v);
    return v.style.paddingBottom + '|' + v.style.marginBottom;
  }
  ok('the clipping box is as tall again as the room the container leaves below (96 px), and takes no layout room for it', view('96px') === '96px|-96px', view('96px'));
  ok('a fraction rounds down (never past the room)', view('96.7px') === '96px|-96px', view('96.7px'));
  ok('no room, no margin: the clip as it was', view('0px') === '|' && view(null) === '|');
  globalThis.getComputedStyle = seen;
})();

print(fail ? 'FAIL ' + fail + ' PAGE END TESTS' : 'ALL ' + pass + ' PAGE END TESTS PASS');
