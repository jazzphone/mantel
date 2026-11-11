// hk-sky-mount.js - the flat sky, the covers and the self-mount.
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-mount'] = function (K) {
    var applyHidden = K.applyHidden, clientNow = K.clientNow, container = K.container, currentView = K.currentView,
        deepFind = K.deepFind, lovelaceCfg = K.lovelaceCfg, offPanel = K.offPanel, resolve = K.resolve,
        selfRender = K.selfRender, SH = K.SH, ST = K.ST, stateTick = K.stateTick, swiping = K.swiping,
        viewContainerEl = K.viewContainerEl, watch = K.watch;

    // FLAT: one solid color or one still photo under a fixed fade -- no sky
    // layers, canvas, grain, sampling, seasonal scene or blur. `opts.flat` is
    // the page's (resolve: hk-settings.js flatBackground).
    // One bounded bitmap per mounted wallpaper; no work on repeated state pushes.
    // The request is replaced on navigation/settings changes, so a late image
    // load can only paint the latest request. Canvas shares the image's cover fit.
    function renderFlatImage(layer, pic, look, color) {
      var key = (pic.getAttribute('src') || '') + '|' + [look.mode, look.strength, look.depth, look.brightness, color].join('|');
      if (!layer._hkImageCanvas) {
        var canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none';
        layer.insertBefore(canvas, layer.lastChild); layer._hkImageCanvas = canvas;
      }
      if (layer._hkImageRequest && layer._hkImageRequest.key === key) return;
      layer._hkImageRequest = { key: key, look: look, color: color };
      layer._hkImageCanvas.style.display = 'none'; pic.style.display = 'none';
      var draw = function () {
        var request = layer._hkImageRequest;
        if (!request || request.painted || !pic.getAttribute('src') || !layer.isConnected) return;
        try {
          if (window.hkFlatImage.paint(layer._hkImageCanvas, pic, request.look, request.color)) {
            layer._hkImageCanvas.style.display = 'block';
            request.painted = true;
            layer._hkImagePaints = (layer._hkImagePaints || 0) + 1;
          }
        } catch (e) { console.warn('[hk-flat-image] Photo could not be processed', e); }
      };
      pic.onload = draw;
      if (pic.complete && pic.naturalWidth) draw();
    }

    function renderFlat(client, card, opts, policy) {
      var en = opts.enable && client.states[opts.enable];
      var bg = (en && en.state === 'off') ? { color: 'auto' } : (opts.flat || { color: 'auto' });
      if (!ST.mounted || !ST.mounted.isConnected) {
        var host = container(card); if (!host) return;
        // position:fixed, like the SHEET: the element covers the VIEWPORT.
        // (An absolute element in the scrollable view container sized to the
        // whole content -- 6 000+ px on a tablet -- and the landscape covered
        // under it scaled up with it: the "large blown up version" with no
        // fade. z-index -1 is the wallpaper's place, under the views; contain
        // clips its children to the viewport; overflow:hidden for the same.)
        ST.mounted = document.createElement('div'); ST.mounted.id = 'hk-sky'; ST.mounted._hkFlat = true;
        ST.mounted.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;contain:strict;isolation:isolate';
        var img = document.createElement('img'); img.alt = '';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none';
        // a photo that can't be had: the theme's ground at once, not a blank
        img.onerror = function () {
          img.style.display = 'none'; img.removeAttribute('src');
          var layer = img.parentNode;
          if (layer) { layer.lastChild.style.background = 'transparent'; if (layer._hkImageCanvas) layer._hkImageCanvas.style.display = 'none'; }
        };
        var scrim = document.createElement('div');
        scrim.style.cssText = 'position:absolute;inset:0;pointer-events:none';
        // THE TINT (2026-10-17, the user: "convert the picture to grayscale and
        // then apply the tint"): a layer in the tint's color blended as
        // `color` -- the photo keeps its light and dark and takes the tint's
        // hue and saturation, a duotone; its opacity the Tint Strength. Then
        // the Tint Brightness: white or black over it. Still layers, drawn
        // once: no filter, nothing that runs.
        var tintL = document.createElement('div'), lightL = document.createElement('div');
        tintL.style.cssText = 'position:absolute;inset:0;pointer-events:none;mix-blend-mode:color;display:none';
        lightL.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none';
        ST.mounted.appendChild(img); ST.mounted.appendChild(tintL); ST.mounted.appendChild(lightL); ST.mounted.appendChild(scrim);
        var vb = SH.viewBackground(host);
        if (vb && vb.nextSibling) host.insertBefore(ST.mounted, vb.nextSibling); else host.insertBefore(ST.mounted, host.firstChild);
        watch();
      }
      ST.mountedPath = location.pathname;
      var C = window.hkCards, page = opts.page || 'home';
      var ground = C && C.flatColorHex ? C.flatColorHex(bg.color || 'auto', policy.theme, page)
                 : policy.theme === 'light' ? '#EEECE6' : '#17181A';
      // (a seed's ground in place of Automatic's -- a photo still waiting, or
      // gone, falls back to it too, its choice kept)
      if ((bg.color || 'auto') === 'auto' && opts.seed) ground = opts.seed;
      if (bg.photo) ground = opts.seed || (C && C.flatGround ? C.flatGround('home', policy.theme) : ground);
      ST.mounted.style.background = ground;
      var pic = ST.mounted.firstChild, src = bg.photo || '';
      if (ST.mounted._hkPhoto !== src) {
        ST.mounted._hkPhoto = src;
        if (src) { pic.style.display = 'block'; pic.src = src; }
        else { pic.removeAttribute('src'); pic.style.display = 'none'; }
      }
      // THE FADE: the theme's own ground washed over the photo (Sky /
      // Background -> Fade, 0-100): Light's limestone, Dark's near-black. A
      // fixed flat layer -- no sampled color, no brightness filter.
      ST.mounted.lastChild.style.background = src && pic.getAttribute('src') ? (C && C.flatFade ? C.flatFade(bg.fade, policy.theme) : 'transparent') : 'transparent';
      // THE TINT over the photo (the page's accent, or the user's own: Sky /
      // Background -> Tint), its strength and brightness
      var tint = bg.tint === 'accent' ? (C && C.flatAccentHex ? C.flatAccentHex() : null) : /^#[0-9a-f]{6}$/i.test(bg.tint || '') ? bg.tint : null;
      var tl = ST.mounted.children[1], ll = ST.mounted.children[2];
      if (tl && ll && tl !== ST.mounted.lastChild) {
        var on = !!(tint && src && pic.getAttribute('src'));
        var k = Math.max(0, Math.min(100, bg.tintAmount == null ? 60 : +bg.tintAmount || 0)) / 100;
        var lb = Math.max(-1, Math.min(1, ((bg.tintLight == null ? 50 : +bg.tintLight) - 50) / 50));
        tl.style.display = on && k ? 'block' : 'none';
        if (on) { tl.style.background = tint; tl.style.opacity = String(k); }
        ll.style.display = on && lb ? 'block' : 'none';
        if (on && lb) ll.style.background = lb > 0 ? 'rgba(255,255,255,' + (lb * 0.6).toFixed(3) + ')' : 'rgba(0,0,0,' + (-lb * 0.6).toFixed(3) + ')';
      }
      var imageLook = bg.imageLook;
      if (imageLook && imageLook.mode !== 'legacy' && src && pic.getAttribute('src')) {
        tl.style.display = 'none'; ll.style.display = 'none';
        ST.mounted.lastChild.style.background = window.hkFlatImage ? window.hkFlatImage.fade(imageLook.fade, policy.theme) : 'transparent';
        if (window.hkFlatImage) renderFlatImage(ST.mounted, pic, imageLook, imageLook.color === 'accent' ? (C && C.flatAccentHex ? C.flatAccentHex() : '#64798e') : imageLook.color);
      } else {
        ST.mounted._hkImageRequest = null; pic.onload = null;
        if (ST.mounted._hkImageCanvas) ST.mounted._hkImageCanvas.style.display = 'none';
        if (src && pic.getAttribute('src')) pic.style.display = 'block';
      }
      if (opts.sleep) ST.sleepEntity = opts.sleep;
      var sl = ST.sleepEntity && client.states[ST.sleepEntity]; if (sl) ST.asleep = sl.state === 'on';
      // never hidden while the tab is: a still picture costs nothing there, and
      // an inline hide stayed until the next tick -- the view's navy, then the
      // photo, each time the tab came back (2026-10-16)
      applyHidden();
    }
    // a still copy of the sky over it: its canvases' pictures drawn in, its motion stopped where it was
    function skyCover(el) {
      var c = el.cloneNode(true), i;
      c.classList.add('hk-snap');
      c.setAttribute('aria-hidden', 'true');
      c.style.pointerEvents = 'none';
      el.parentNode.insertBefore(c, el.nextSibling);
      var a = el.querySelectorAll('canvas'), b = c.querySelectorAll('canvas');
      for (i = 0; i < a.length && i < b.length; i++) {
        try { b[i].width = a[i].width; b[i].height = a[i].height; b[i].getContext('2d').drawImage(a[i], 0, 0); } catch (e) { /* a picture it may not read */ }
      }
      if (c.getAnimations && el.getAnimations) {
        var oa = el.getAnimations({ subtree: true }), ca = c.getAnimations({ subtree: true });
        ca.forEach(function (x, k) {
          try { if (oa[k] && oa[k].currentTime != null) x.currentTime = oa[k].currentTime; x.pause(); } catch (e) { /* gone */ }
        });
      }
      return c;
    }
    // (the copy, or null; false for the same background: nothing to fade -- hk-pageswipe.js skyFade fades it, as the
    // finger moves and on its way in, and swipeBack paints this page's own again under it when it goes back)
    function swipeCover(path) {
      if (!ST.mounted || !ST.mounted.isConnected || !ST.mounted.parentNode || offPanel()) return null;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
      var want = resolve(path), client = clientNow(), host = viewContainerEl();
      if (!want || !client || !host) return null;
      try { if (JSON.stringify(want) === JSON.stringify(resolve(swiping()))) return false; } catch (e) { /* fade */ }
      var cover = skyCover(ST.mounted);
      ST.SWIPE = { path: path, seg: String(path).split(/[?#]/)[0].split('/')[2] || '', until: Date.now() + 6000 };
      ST.snapNext = true;
      window.hkSky.render(client, host, want);
      return cover;
    }

    // Three navigation signals, all proven on wall tablets: location-changed
    // is what HA's own navigate()
    // fires, popstate catches the hardware back button and Fully's navigation,
    // and the poll catches anything that changes the URL without either.
    //
    // The poll doubles as the state tick. It is deliberately NOT a websocket
    // subscription: the sky's inputs are sun, weather, moon and two booleans,
    // and re-reading five states every few seconds is cheaper than managing a
    // subscription's lifecycle across view changes. It also catches a
    // screensaver flip within a tick, where watching sun.sun alone would leave
    // the sky running until the next elevation change.
    // REPAINT WHEN THE NEW VIEW IS ON SCREEN, NOT WHEN THE URL CHANGES.
    //
    // location-changed fires the instant a navigation starts, well before HA has
    // built the incoming view. Repainting there puts the NEW page's background
    // behind the OLD page's content for a beat -- tap Climate and its palette
    // arrives while the previous page is still up. Reading the config is faster
    // than building the view, so the module has to wait for the view on
    // purpose.
    //
    // SO THE VIEW TELLS US. A generated screen's view is `custom:hk-grid-view`, which is
    // our own element, and it announces `hk-view-ready` on window the moment it
    // is attached with its cards in it -- a first build and a return to a cached
    // view alike (cards/hk-layout.js). That is exactly "the new page is up", so
    // the repaint lands in the same frame as the view, however long the build
    // took. No polling, no ceiling, nothing to race.
    //
    // POLLING every 60ms for hui-view to be replaced, with a ~2s ceiling after
    // which it repaints anyway, is wrong at both ends on a slow tablet: a first
    // build past the ceiling gets its palette early, behind the previous page,
    // and every probe walks the whole shadow DOM.
    //
    // The poll is KEPT for a view of any other type, which cannot announce
    // itself, so a stock masonry view added to a sky dashboard degrades to
    // polling rather than never repainting.
    function viewEl() { return SH.tags.view ? deepFind(SH.tags.view.toUpperCase()) : null; }

    // (and a Home Grid screen's Home, hk-home-grid-view, the same way)
    var ANNOUNCING = { 'custom:hk-grid-view': 1, 'custom:hk-home-grid-view': 1 };
    function onNav() {
      if (ST.navWait) { clearInterval(ST.navWait); ST.navWait = null; }
      if (offPanel()) { selfRender(); return; }      // tears a stale sky down; no poll
      var v = currentView(lovelaceCfg());
      if (v && ANNOUNCING[v.type]) {           // hk-view-ready will come
        // A hash change (a pop-up) is not a page change and announces nothing.
        if (location.pathname !== ST.mountedPath) ST.navPending = Date.now();
        return;
      }
      var before = viewEl();
      var tries = 0;
      ST.navWait = setInterval(function () {
        var now = viewEl();
        // a different element, with content in it, is the new page being up
        var swapped = now && now !== before && now.children.length > 0;
        if (swapped || ++tries > 33) {           // ~2s ceiling, then repaint anyway
          clearInterval(ST.navWait); ST.navWait = null;
          selfRender();
        }
      }, 60);
    }
    function onViewReady() {
      if (ST.navWait) { clearInterval(ST.navWait); ST.navWait = null; }
      if (ST.readyFrame) return;
      ST.readyFrame = requestAnimationFrame(function () {
        ST.readyFrame = 0;
        ST.navPending = 0;
        selfRender();
      });
    }
    function firstMount() {
      if (ST.firstWait) return;
      var tries = 0;
      ST.firstWait = setInterval(function () {
        selfRender();
        // `mounted` is the honest test. A view that does not want a sky never
        // sets it, so the ceiling is what stops the ramp there -- 60ms x 100 is
        // 6s of two cheap DOM lookups, against a cold start that reaches the
        // view in under 200ms.
        if (ST.mounted || ++tries > 100) {
          clearInterval(ST.firstWait);
          ST.firstWait = null;
        }
      }, 60);
    }
    function selfDrive() {
      if (ST.selfPoll) return;
      ST.selfPoll = setInterval(stateTick, 3000);
      SH.onNavigate(onNav);
      window.addEventListener('popstate', onNav);
      window.addEventListener('hk-view-ready', onViewReady);
      // A settings change: a dashboard's Live sky may have been switched.
      if (window.hkSettings && window.hkSettings.onChange) {
        window.hkSettings.onChange(function () { selfRender(); });
      }
      selfRender();
      if (!ST.mounted) firstMount();
    }

    // what the shell and the later parts use of this one
    K.renderFlat = renderFlat; K.selfDrive = selfDrive; K.swipeCover = swipeCover;
  };
})();
