// hk-base-art.js - a picture's art.json, the chart scrubber and the palette.
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-art'] = function (K) {
    var ARTJ = K.ARTJ;

    function artJson(base, fn) {
      var a = ARTJ[base];
      if (a && a.json) { fn(a.json); a.fns.push(fn); return; }
      if (!a) {
        a = ARTJ[base] = { fns: [], json: null };
        var key = 'hk-art:' + base, kept = null;
        try { kept = JSON.parse(window.localStorage.getItem(key) || 'null'); } catch (e) { kept = null; }
        if (kept) a.json = kept;
        (typeof fetch === 'function' ? fetch(base + 'art.json', { cache: 'no-cache' }) : Promise.reject(new Error('no fetch')))
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
          .then(function (t) {
            var j = JSON.parse(t), same = a.json && JSON.stringify(a.json) === JSON.stringify(j);
            try { window.localStorage.setItem(key, t); } catch (e) { /* full or private: next load asks again */ }
            if (same) return;
            a.json = j;
            a.fns.slice().forEach(function (f) { f(j); });
          }).catch(function () {
            if (a.json) return;                 // the kept copy stands
            var w = a.fns; delete ARTJ[base];
            w.forEach(function (f) { f(null); });
          });
      }
      a.fns.push(fn);
      if (a.json) fn(a.json);
    }
    // ------------------------------------------------- one chart scrubber
    // HOVER, TOUCH OR KEYS ON A CHART (2026-10-16; PLAN-2026-10-17-hover-tap-
    // calendar-editing.md A1): every bar or line chart reads out the same way.
    // A mouse over it, or a finger held and dragged on it, lights the element
    // under it (`[data-i]` gets .hit, the box .on) and says it in the card's
    // readout; the chart takes focus, the arrow keys (Home, End) step it, the
    // readout is announced; leaving, lifting, Escape or Tab put the summary
    // back. Asked again on every paint (a repaint puts the markup's attributes
    // back), it keeps one set of listeners and reads the newest options.
    //   o: { say(i) -> text, count, nowI, rest, readout() -> element, name,
    //        index(x, y, box) -> i (default: across the svg), onPick(i | null) }
    // count, nowI and rest may be functions. A tap still taps: nothing here
    // stops a click, so a chart that opens a sheet keeps doing so.
    function scrub(card, box, o) {
      if (!box) return;
      box._hkO = o;
      var val = function (x) { return typeof x === 'function' ? x() : x; };
      box.setAttribute('tabindex', '0');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', (o.name || 'Chart') + '. Arrow keys move between bars.');
      var rd0 = o.readout && o.readout();
      if (rd0) rd0.setAttribute('aria-live', 'polite');
      if (box._hkScrub) return;
      box._hkScrub = true;
      var held = null, kb = -1;
      function opt() { return box._hkO || o; }
      function n() { return Math.max(1, val(opt().count) || 24); }
      function at(x, y) {
        var O = opt();
        if (O.index) return O.index(x, y, box);
        var svg = box.querySelector('svg');
        if (!svg) return -1;
        var r = svg.getBoundingClientRect();
        if (!r.width) return -1;
        return Math.max(0, Math.min(n() - 1, Math.floor((x - r.left) / r.width * n())));
      }
      function pick(i) {
        var O = opt();
        if (i < 0) return;
        box.classList.add('on');
        box.querySelectorAll('[data-i]').forEach(function (b) { b.classList.toggle('hit', +b.getAttribute('data-i') === i); });
        var rd = O.readout && O.readout();
        if (rd) rd.textContent = O.say(i);
        if (O.onPick) O.onPick(i);
      }
      function hide() {
        var O = opt();
        box.classList.remove('on');
        box.querySelectorAll('[data-i].hit').forEach(function (b) { b.classList.remove('hit'); });
        var rd = O.readout && O.readout();
        if (rd) rd.innerHTML = val(O.rest) || '';
        if (O.onPick) O.onPick(null);
      }
      box.addEventListener('keydown', function (e) {
        var k = e.key, m = n();
        if (k === 'Escape' || k === 'Tab') { kb = -1; hide(); return; }
        if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
        e.preventDefault();
        // the first arrow lands on now, else the last
        var now = val(opt().nowI);
        if (kb < 0 && (k === 'ArrowLeft' || k === 'ArrowRight')) kb = now != null ? now : m - 1;
        else kb = k === 'Home' ? 0 : k === 'End' ? m - 1 : Math.max(0, Math.min(m - 1, kb + (k === 'ArrowLeft' ? -1 : 1)));
        pick(kb);
      });
      box.addEventListener('blur', function () { kb = -1; hide(); });
      box.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || held === e.pointerId) pick(at(e.clientX, e.clientY)); });
      // A DRAG IS NOT A TAP: a finger that moved along the chart reads it, and
      // the click that follows its lift is not passed on (a chart that opens a
      // sheet on a tap would otherwise open it at the end of every scrub)
      var x0 = 0, moved = false;
      box.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return;
        held = e.pointerId; x0 = e.clientX; moved = false;
        try { box.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
        pick(at(e.clientX, e.clientY));
      });
      box.addEventListener('pointermove', function (e) { if (held === e.pointerId && Math.abs(e.clientX - x0) > 10) moved = true; });
      box.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
      ['pointerup', 'pointercancel'].forEach(function (k) {
        box.addEventListener(k, function (e) { if (e.pointerType !== 'mouse') { held = null; hide(); } });
      });
      box.addEventListener('click', function (e) {
        if (!moved) return;
        moved = false;
        e.stopPropagation(); e.preventDefault();
      }, true);
    }

    function button(el, fn) {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.addEventListener('click', fn);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
      });
      return el;
    }

    // The first letter capitalised and the rest left alone ("heat cool" ->
    // "Heat cool") -- hk-tile's `sentence` label mode. The word-by-word
    // title-casings (hk-tile's `titled`, the fan label, hk-chip's label_case,
    // hk-control's _pretty, hk-header's titleCase) are different rules.
    function sentenceCase(v) {
      var s = String(v);
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // ------------------------------------------------------------- palette
    // What a colour NAME in a card config means: `icon_color: orange` on a
    // tile, `color: teal` on a control, `colour: blue` on a chart. One table of
    // hues, shared by hk-tile.js, hk-control.js and hk-charts.js.
    //
    // THE DIFFERENCES ARE KEPT, BY NAME, not settled here: each family keeps
    // its own alpha and its own gray, and which is right is a visual call.
    //
    //   icon    glyphs and wells -- hk-tile's NAME_MAP, and every card that
    //           resolves a name through it. Alpha 0.98, gray 0.80, and it also
    //           knows grey, white and black.
    //   accent  hk-control's `color:` (well, slider fill, active segment).
    //           Alpha 0.96, gray 0.85; no grey / white / black, so those three
    //           still reach CSS as keywords.
    //   chart   hk-charts' fills, as the rgb triples it softens. Its gray is
    //           Apple's system gray (142, 142, 147), not the icon gray; no
    //           grey / white / black, so those fall back to orange like any
    //           unknown name.
    var HUE = {
      yellow: [255, 204, 0],   orange: [255, 159, 10], blue:   [86, 189, 228],
      green:  [48, 209, 88],   red:    [255, 69, 58],  purple: [191, 90, 242],
      pink:   [255, 55, 95],   teal:   [64, 200, 224], cyan:   [50, 173, 230],
      brown:  [172, 142, 104], mint:   [99, 230, 226]
    };
    // The alpha is a string, so '0.80' stays '0.80' in the output.
    function paint(alpha, more) {
      var out = {};
      Object.keys(HUE).forEach(function (k) {
        out[k] = 'rgba(' + HUE[k].join(', ') + ', ' + alpha + ')';
      });
      return Object.assign(out, more);
    }
    var PALETTE = {
      icon: paint('0.98', {
        gray:  'rgba(200, 200, 200, 0.80)', grey: 'rgba(200, 200, 200, 0.80)',
        white: 'rgba(255, 255, 255, 0.95)', black: 'rgba(0, 0, 0, 0.95)'
      }),
      accent: paint('0.96', { gray: 'rgba(200, 200, 200, 0.85)' }),
      chart: Object.assign({}, HUE, { gray: [142, 142, 147] })
    };
    var IDLE_TEXT     = 'rgba(255, 255, 255, 0.86)';

    // what the shell and the later parts use of this one
    K.artJson = artJson; K.button = button; K.PALETTE = PALETTE; K.scrub = scrub; K.sentenceCase = sentenceCase;
  };
})();
