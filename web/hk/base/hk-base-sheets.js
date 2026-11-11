// hk-base-sheets.js - the edges' shade and the choose sheet.
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-sheets'] = function (K) {
    var dialogMount = K.dialogMount, edgeCss = K.edgeCss, FONT_ROOT = K.FONT_ROOT, ST = K.ST, v = K.v;

    // ------------------------------------------------------- chooseSheet
    //
    // A LIST TO PICK ONE OF, in the same material as confirmSheet below.
    //
    // Built for a pill that stands for several choices: six decade playlists
    // behind one tile rather than six more tiles in a row that already holds
    // five.
    //
    // ITS OWN ELEMENT, not a mode of confirmSheet. They share a look and nothing
    // else -- one asks a yes/no about a sentence, this offers a list -- and
    // folding both into one function would mean every future change to either
    // reasoning about the other. The styling is duplicated deliberately and is
    // ~15 lines; a shared stylesheet for two sheets would be the harder thing to
    // follow.
    //
    // DISMISSABLE THREE WAYS, like confirmSheet: the backdrop, Escape, and a
    // Cancel row. A sheet on a wall tablet with no way out is the dead end this
    // dashboard is built to avoid.
    // THE HEADER RIDES ON THE LIST (2026-10-11). Wherever a header stays put
    // and a list scrolls under it -- the detail sheets, the screensaver's
    // calendar pane and its music panel, the tab bar's sheets, the calendar's
    // pop-ups, the choose sheet -- a soft shadow lies along the list's top edge
    // once the list has scrolled under it, and none while it is at its top
    // (nothing is under the header then). One look, from here:
    //
    //   shade(scroller, target, opts)  `hk-scrolled` on `target` while
    //       `scroller` is off its top, and --hk-shade-top: the scroller's top
    //       edge, measured from target's. `target` may be a function (a header
    //       drawn again with its content); `opts.foot`: the shadow at the
    //       target's own foot instead (a sticky header inside the scroller).
    //       Returns a function that unhooks it.
    //   shadeCss(sel)  the shadow, as `sel`'s ::after: `sel` must be
    //       positioned, and its ::after free.
    //
    // A passive listener that writes only when the edge is crossed, and an
    // opacity fade: nothing per frame while a list scrolls on a wall tablet.
    var SHADE_AT = 2;
    function shade(scroller, target, opts) {
      if (!scroller || !target || !scroller.addEventListener) return function () {};
      var foot = !!(opts && opts.foot);
      var check = function () {
        var tg = typeof target === 'function' ? target() : target;
        if (!tg) return;
        if (!tg.setAttribute || !tg.hasAttribute) return;
        var want = scroller.scrollTop > SHADE_AT;
        if (want === tg.hasAttribute('hk-scrolled')) return;
        if (want) {
          if (!foot && scroller.getBoundingClientRect && tg.getBoundingClientRect && tg.style && tg.style.setProperty) {
            var a = scroller.getBoundingClientRect(), b = tg.getBoundingClientRect();
            tg.style.setProperty('--hk-shade-top', Math.round(a.top - b.top) + 'px');
          }
          tg.setAttribute('hk-scrolled', '');
        } else tg.removeAttribute('hk-scrolled');
      };
      scroller.addEventListener('scroll', check, { passive: true });
      check();
      var off = function () { scroller.removeEventListener('scroll', check); };
      off.check = check;
      return off;
    }
    function edgeRead(sc) { var f = sc && sc._hkEdge; return f && f.setAttribute ? [f, sc.scrollTop > SHADE_AT, sc.scrollHeight - sc.clientHeight - sc.scrollTop > 2] : null; }
    function edgeWrite(r) { if (r) { r[0].toggleAttribute('hk-scrolled', r[1]); r[0].toggleAttribute('hk-scroll-more', r[2]); } }
    function edgeCheck(sc) { edgeWrite(edgeRead(sc)); }
    function edgeSoon(sc) {
      if (!ST.EDGE_DUE) requestAnimationFrame(function () { var d = Array.from(ST.EDGE_DUE); ST.EDGE_DUE = null; d.filter(function (x) { return x.isConnected; }).map(edgeRead).forEach(edgeWrite); });
      (ST.EDGE_DUE = ST.EDGE_DUE || new Set()).add(sc);
    }
    function edgeScroll(e) { edgeCheck(e.currentTarget); }
    function edges(root) {
      if (!root || !root.querySelectorAll) return;
      var frames = Array.prototype.slice.call(root.querySelectorAll('.hk-edge, .hk-fades'));
      if (root.classList && (root.classList.contains('hk-edge') || root.classList.contains('hk-fades'))) frames.unshift(root);
      if (!ST.EDGE_RO && typeof ResizeObserver !== 'undefined') {
        ST.EDGE_RO = new ResizeObserver(function (es) {
          es.forEach(function (x) { if (x.target.isConnected === false) ST.EDGE_RO.unobserve(x.target); else edgeCheck(x.target); });
        });
      }
      frames.forEach(function (f) {
        var sc = f.classList.contains('hk-fades') ? f : f.firstElementChild;
        if (!sc) return;
        if (sc._hkEdge !== f) {
          sc._hkEdge = f;
          sc.addEventListener('scroll', edgeScroll, { passive: true });
          if (ST.EDGE_RO) ST.EDGE_RO.observe(sc);
          if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(function () { edgeSoon(sc); }).observe(sc, { childList: true });
          }
        }
        edgeSoon(sc);
      });
    }
    // the header's shadow once a list scrolls under it: none (SCROLL EDGES)
    function shadeCss() { return ''; }
    function chooseSheet(title, options, onPick, opts) {
      opts = opts || {};
      if (!ST._choose) {
        ST._choose = document.createElement('div');
        ST._choose.id = 'hk-choose';
        ST._choose.innerHTML =
          '<style>' +
          '#hk-choose{position:fixed;inset:0;z-index:9999;display:none;' +
          '  align-items:center;justify-content:center;' +
          '  background:rgba(0,0,0,0.45);' + FONT_ROOT + '}' +
          '#hk-choose[data-open]{display:flex}' +
          // --hk-vh: the car's real window height, set only on the zoomed
          // Tesla dashboard (tesla-viewport.js), where 78vh is zoomed too and
          // is ~52% of the screen. Unset everywhere else: plain 100vh.
          '#hk-choose .box{position:relative;width:340px;max-height:calc(var(--hk-vh, 100vh) * .78);border-radius:16px;' +
          // no blur: at .94 over a dimmed page it could not be seen
          '  overflow:hidden;background:rgba(42,42,44,0.94);' +
          '  color:' + v('ink') + ';text-align:center;display:flex;flex-direction:column;' +
          '  box-shadow:0 24px 64px rgba(0,0,0,0.55),0 2px 10px rgba(0,0,0,0.35)}' +
          '#hk-choose .txt{padding:22px 24px 16px;font-size:15px;font-weight:600;' +
          '  line-height:1.35;color:' + v('ink') + '}' +
          // The list scrolls if it ever outgrows the sheet; six fit without it.
          '#hk-choose .list{overflow-y:auto;-webkit-overflow-scrolling:touch}' + edgeCss('#hk-choose ') +
          '#hk-choose .opt{appearance:none;border:0;background:none;width:100%;' +
          '  color:#0a84ff;font:inherit;font-size:17px;padding:15px 20px;' +
          '  cursor:pointer;display:block;' +
          '  box-shadow:inset 0 0.5px 0 rgba(255,255,255,0.18)}' +
          '#hk-choose .opt:active{background:rgba(255,255,255,0.08)}' +
          // Cancel is the last row and reads as the way out, not as a seventh
          // decade -- 600 against the options' regular weight, the same device
          // iOS uses to separate a sheet's dismissal from its choices.
          '#hk-choose .cancel{font-weight:600;' +
          '  box-shadow:inset 0 0.5px 0 rgba(255,255,255,0.18)}' +
          // the title riding on the list, once it scrolls (shade)
          '</style>' +
          '<div class="box"><div class="txt"></div>' +
          '<div class="list hk-fades"></div>' +
          '<button class="opt cancel" data-cancel>Cancel</button></div>';
        dialogMount(ST._choose);
        edges(ST._choose.querySelector('.list'));
      } else dialogMount(ST._choose);
      var close = function () {
        ST._choose.removeAttribute('data-open');
        document.removeEventListener('keydown', esc, true);
      };
      var esc = function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
      };
      ST._choose.querySelector('.txt').textContent = title || 'Choose';
      ST._choose.querySelector('[data-cancel]').textContent = opts.cancel || 'Cancel';
      ST._choose.querySelector('[data-cancel]').onclick = close;
      ST._choose.onclick = function (e) { if (e.target === ST._choose) close(); };
      var list = ST._choose.querySelector('.list');
      list.innerHTML = '';
      list.scrollTop = 0;
      (options || []).forEach(function (o) {
        var b = document.createElement('button');
        b.className = 'opt';
        b.textContent = o.name;
        b.setAttribute('data-hk-name', o.name);
        b.onclick = function () { close(); onPick(o); };
        list.appendChild(b);
      });
      ST._choose.setAttribute('data-open', '1');
      document.addEventListener('keydown', esc, true);
      return ST._choose;
    }

    // what the shell and the later parts use of this one
    K.chooseSheet = chooseSheet; K.edges = edges; K.shade = shade; K.shadeCss = shadeCss;
  };
})();
