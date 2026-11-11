// THE ROLLER (2026-11-09, the owner's mockup 5c, "Yes, build it"): hours, minutes and seconds on three wheels, as the
// Clock app sets a timer -- a flick spins a wheel and it settles on a number, a tap on a number above or below the band
// moves to it, the arrow keys step the focused wheel. The chosen row sits in one band across the wheels, its unit fixed
// beside it; the rows above and below fade and shrink. One piece wherever a timer is made: the New Timer card (the
// Timers page's Create a Timer, every Timers block's "+", the one-page Timers layout's panel) and the Extra Large
// Timers block's maker.
//
// Each wheel is a native scroller with scroll snapping: an iPad's own momentum and settle, no gesture code of ours.
//   hkRoller.CSS                    the styles, for a card's shadow root (sized by --hkr-row, --hkr-fs, --hkr-w, ...)
//   hkRoller.create(cols, o)        cols: [{ key, max, unit, label, value }]; o.onChange(values) as a wheel settles.
//                                   Answers { el, get(), set(values, smooth), sync() } -- el the roller to place.
// @ts-check
(function (global) {
  'use strict';
  if (global.hkRoller) return;

  var CSS = [
    // (the band and the rows are measured from --hkr-row: five rows show, the middle one chosen)
    // A WHEEL TAKES A FINGER ANYWHERE IN ITS COLUMN (2026-11-10, the owner: "your finger needs to be directly over the number"):
    // its scroller spans the number, the unit beside it and half the gap each side, the unit drawn over it (no touch of
    // its own); the roller's outer half-gaps given back by its margin and the band's inset, so nothing moves
    '.hkr{position:relative;display:flex;justify-content:center;gap:0;margin:0 calc(var(--hkr-gap,18px) / -2);height:calc(var(--hkr-row,44px) * 5);flex:none;',
    '  -webkit-user-select:none;user-select:none}',
    '.hkr-band{position:absolute;left:calc(var(--hkr-band-x,0px) + var(--hkr-gap,18px) / 2);right:calc(var(--hkr-band-x,0px) + var(--hkr-gap,18px) / 2);top:calc(var(--hkr-row,44px) * 2);' +
      'height:var(--hkr-row,44px);',
    '  border-radius:var(--hkr-band-r,12px);background:var(--hkr-band,rgba(255,255,255,.12));pointer-events:none}',
    '.hkr-col{position:relative;display:flex;align-items:center;height:100%}',
    '.hkr-w{box-sizing:border-box;width:calc(var(--hkr-w,44px) + 8px + var(--hkr-uw,36px) + var(--hkr-gap,18px));height:100%;',
    '  padding:0 calc(8px + var(--hkr-uw,36px) + var(--hkr-gap,18px) / 2) 0 calc(var(--hkr-gap,18px) / 2);overflow-y:auto;overflow-x:hidden;scroll-snap-type:y mandatory;',
    '  overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;scrollbar-width:none;outline:none;border-radius:8px;',
    '  -webkit-mask-image:linear-gradient(180deg,transparent,#000 24%,#000 76%,transparent);mask-image:linear-gradient(180deg,transparent,#000 24%,#000 76%,transparent)}',
    '.hkr-w::-webkit-scrollbar{display:none}',
    '.hkr-w:focus-visible{box-shadow:inset 0 0 0 2px var(--hkr-ink2,rgba(255,255,255,.68))}',
    '.hkr-pad{height:calc(var(--hkr-row,44px) * 2)}',
    '.hkr-i{height:var(--hkr-row,44px);display:flex;align-items:center;justify-content:flex-end;scroll-snap-align:center;cursor:pointer;',
    '  font-size:var(--hkr-fs,26px);font-weight:400;font-variant-numeric:tabular-nums;letter-spacing:-0.01em;color:var(--hkr-ink,#fff);',
    '  opacity:.22;transform:scale(.8);transform-origin:100% 50%}',
    '.hkr-i[data-d="1"]{opacity:.5;transform:scale(.9)}',
    '.hkr-i[data-d="0"]{opacity:1;transform:none;font-weight:600}',
    '.hkr-u{position:absolute;right:calc(var(--hkr-gap,18px) / 2);top:50%;transform:translateY(-50%);pointer-events:none;width:var(--hkr-uw,36px);font-size:calc(var(--hkr-fs,26px) - 6px);' +
      'font-weight:600;color:var(--hkr-ink2,rgba(255,255,255,.68));white-space:nowrap}'
  ].join('');

  function create(cols, o) {
    o = o || {};
    var doc = global.document, root = doc.createElement('div');
    root.className = 'hkr';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', o.label || 'Duration');
    // (a Home Grid block's tap opens its page: a wheel is a control of its own -- hk-base.js TAP_CONTROLS)
    root.setAttribute('data-hk-control', '');
    var band = doc.createElement('div');
    band.className = 'hkr-band';
    root.appendChild(band);
    var values = {}, wheels = [];

    function row(w) { return w.clientHeight ? w.clientHeight / 5 : 0; }
    function paint(wh) {
      var r = row(wh.w);
      if (!r) return;
      var c = wh.w.scrollTop / r, items = wh.items, lo = Math.max(0, Math.floor(c) - 3), hi = Math.min(items.length - 1, Math.ceil(c) + 3);
      for (var i = lo; i <= hi; i++) {
        var d = String(Math.min(2, Math.round(Math.abs(i - c))));
        if (items[i].getAttribute('data-d') !== d) items[i].setAttribute('data-d', d);
      }
      // (the rows that scrolled out of the window go back to the faint look)
      if (wh.lo != null) for (var j = wh.lo; j <= wh.hi; j++) if ((j < lo || j > hi) && items[j].getAttribute('data-d') !== '2') items[j].setAttribute('data-d', '2');
      wh.lo = lo; wh.hi = hi;
    }
    function say(wh) {
      var v = values[wh.c.key];
      wh.w.setAttribute('aria-valuenow', String(v));
      wh.w.setAttribute('aria-valuetext', v + ' ' + (wh.c.label || wh.c.unit || '').toLowerCase());
    }
    // A WHEEL AT REST: its value is the row in the band (the snap puts one there)
    function settle(wh) {
      var r = row(wh.w);
      if (!r) return;
      var v = Math.max(0, Math.min(wh.c.max, Math.round(wh.w.scrollTop / r)));
      paint(wh);
      if (v === values[wh.c.key]) return;
      values[wh.c.key] = v;
      say(wh);
      if (o.onChange) o.onChange(get());
    }
    function put(wh, smooth) {
      var r = row(wh.w), top = values[wh.c.key] * r;
      if (!r) return;
      if (Math.abs(wh.w.scrollTop - top) < 1) { paint(wh); return; }
      if (smooth && typeof wh.w.scrollTo === 'function') wh.w.scrollTo({ top: top, behavior: 'smooth' });
      else wh.w.scrollTop = top;
      paint(wh);
    }

    cols.forEach(function (c) {
      values[c.key] = Math.max(0, Math.min(c.max, c.value | 0));
      var col = doc.createElement('div'), w = doc.createElement('div'), u = doc.createElement('div');
      col.className = 'hkr-col';
      w.className = 'hkr-w';
      w.setAttribute('tabindex', '0');
      w.setAttribute('role', 'spinbutton');
      w.setAttribute('aria-label', c.label || c.unit || c.key);
      w.setAttribute('aria-valuemin', '0');
      w.setAttribute('aria-valuemax', String(c.max));
      var items = [];
      w.appendChild(Object.assign(doc.createElement('div'), { className: 'hkr-pad' }));
      for (var n = 0; n <= c.max; n++) {
        var it = doc.createElement('div');
        it.className = 'hkr-i';
        it.setAttribute('data-v', String(n));
        it.setAttribute('data-d', '2');
        it.textContent = String(n);
        items.push(it);
        w.appendChild(it);
      }
      w.appendChild(Object.assign(doc.createElement('div'), { className: 'hkr-pad' }));
      u.className = 'hkr-u';
      u.textContent = c.unit || '';
      col.appendChild(w);
      col.appendChild(u);
      root.appendChild(col);
      var wh = { c: c, w: w, items: items, t: null, raf: 0 };
      wheels.push(wh);
      say(wh);
      // SCROLLING: the look follows each frame; the value is read once the wheel is still (scrollend where the
      // engine has it, else a short quiet after the last scroll)
      w.addEventListener('scroll', function () {
        if (!wh.raf && global.requestAnimationFrame) wh.raf = global.requestAnimationFrame(function () { wh.raf = 0; paint(wh); });
        clearTimeout(wh.t);
        wh.t = setTimeout(function () { settle(wh); }, 140);
      }, { passive: true });
      w.addEventListener('scrollend', function () { clearTimeout(wh.t); settle(wh); });
      // A TAP ON A NUMBER moves the wheel to it (a flick's lift is no click)
      w.addEventListener('click', function (e) {
        var el = /** @type {Element|null} */ (e.target), t = el && el.closest ? el.closest('.hkr-i') : null;
        if (!t) return;
        values[c.key] = Number(t.getAttribute('data-v'));
        say(wh);
        put(wh, true);
        if (o.onChange) o.onChange(get());
      });
      // THE KEYS: up and down a step, Page Up / Down ten, Home and End the ends
      w.addEventListener('keydown', function (e) {
        var v = values[c.key], k = e.key;
        var to = k === 'ArrowUp' ? v - 1 : k === 'ArrowDown' ? v + 1 : k === 'PageUp' ? v - 10 : k === 'PageDown' ? v + 10 : k === 'Home' ? 0 : k === 'End' ? c.max : null;
        if (to == null) return;
        e.preventDefault();
        values[c.key] = Math.max(0, Math.min(c.max, to));
        say(wh);
        put(wh, false);
        if (o.onChange) o.onChange(get());
      });
    });

    function get() { var out = {}; Object.keys(values).forEach(function (k) { out[k] = values[k]; }); return out; }
    function set(vals, smooth) {
      wheels.forEach(function (wh) {
        if (vals && vals[wh.c.key] != null) values[wh.c.key] = Math.max(0, Math.min(wh.c.max, vals[wh.c.key] | 0));
        say(wh);
        put(wh, smooth);
      });
    }
    function sync() { wheels.forEach(function (wh) { put(wh, false); }); }
    // PLACED ONCE IT HAS A SIZE: a roller built before it is on screen (a sheet opening, a block laid out) has no rows to
    // scroll to yet -- it goes to its values when it gets one
    if (global.ResizeObserver) {
      var seen = 0;
      new global.ResizeObserver(function () {
        var h = root.clientHeight;
        if (h && h !== seen) { seen = h; sync(); }
      }).observe(root);
    }
    return { el: root, get: get, set: set, sync: sync };
  }

  // A DURATION AS THE WHEELS HOLD IT, and back: { h, m, s } <-> seconds
  function split(secs) { secs = Math.max(0, Math.round(Number(secs) || 0)); return { h: Math.min(23, Math.floor(secs / 3600)), m: Math.floor(secs / 60) % 60, s: secs % 60 }; }
  function hms(v) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(v.h | 0) + ':' + p(v.m | 0) + ':' + p(v.s | 0); }
  // the three wheels a timer is set with
  function timerCols(v) {
    v = v || {};
    return [{ key: 'h', max: 23, unit: 'hr', label: 'Hours', value: v.h }, { key: 'm', max: 59, unit: 'min', label: 'Minutes', value: v.m },
            { key: 's', max: 59, unit: 'sec', label: 'Seconds', value: v.s }];
  }

  global.hkRoller = { CSS: CSS, create: create, split: split, hms: hms, timerCols: timerCols };
})(globalThis);
