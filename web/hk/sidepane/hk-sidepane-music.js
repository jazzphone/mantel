// hk-sidepane-music.js - the music panel and the drawer's motion.
//
// PART OF THE SIDE PANE (hk-sidepane.js). Not a card and not run on its own: it registers one
// function, which hk-sidepane.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSidePaneParts = window.hkSidePaneParts || {})['hk-sidepane-music'] = function (K) {
    var C = K.C, clientNow = K.clientNow, musicNow = K.musicNow, musicOf = K.musicOf;

    // THE MUSIC'S PANEL OVER THE PANE (Less's Speakers and Browse): the
    // screensaver's (hk-saver-panel.js) -- Speakers, Volume, Queue, Browse, what
    // plays at its foot -- the pane's own size and place, so it opens where the
    // player is. A tap outside, its X, Escape, a moment after a request has
    // landed, and the music going close it. `how`: 'flip', the section turning
    // over to it (turnAnim); 'drawer' (2026-11-01, the owner: "the player slides
    // up to the top and below it is the browse/speaker/volume/queue tabs"), the
    // whole pane, what plays at its top, rising from where the section was
    // (drawerAnim)
    var mpnl = null;
    function musicPanel(pane, tab, from, how) {
      var P = window.hkSaverPanel, HC = C();
      if (mpnl) { if (mpnl.p.tab() !== tab) mpnl.p.show(tab); else closeMusicPanel(); return; }
      if (!P || !pane || !pane.getBoundingClientRect) return;
      var r = pane.getBoundingClientRect();
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:12;' + ((HC && HC.FONT_ROOT) || '');
      var sr = host.attachShadow({ mode: 'open' });
      var st = document.createElement('style');
      st.textContent = P.CSS + (HC && HC.shadeCss ? HC.shadeCss('.mpanel') : '') +
        '.scrim{position:fixed;inset:0}.mpanel.pn{position:fixed;border-radius:' + ((HC && HC.R && HC.R.sheet) || 38) + 'px;background:rgb(24,25,29);' +
        'box-shadow:0 26px 70px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12)}' +
        // THE DRAWER: the pane itself, what plays first (its cover a size up), the tabs under it
        // (the pane's own material: a dark glass over it, not a solid plate on whatever look the screen has)
        '.mpanel.pn.dr{border-radius:0;box-shadow:none;background:rgba(18,20,24,.93);-webkit-backdrop-filter:blur(30px) saturate(1.4);backdrop-filter:blur(30px) saturate(1.4)}' +
        '.mpanel.dr .mpmini{order:-1;border-top:0;border-bottom:1px solid rgba(255,255,255,.12);padding:24px 22px 16px}' +
        '.mpanel.dr .mpmini .ia{width:60px;height:60px;border-radius:10px}.mpanel.dr .mpmini .tx b{font-size:17px}' +
        '.mpanel.dr .mphd{padding-top:14px}';
      sr.appendChild(st);
      var scrim = document.createElement('div'); scrim.className = 'scrim';
      sr.appendChild(scrim);
      var me = { host: host, doneT: null };
      me.p = P.create({
        tabs: ['speakers', 'volume', 'queue', 'browse'],
        client: function () { return clientNow(); },
        ctx: function () { return musicNow(clientNow()); },
        art: function () { return null; },
        stop: true,
        follow: function (key) { var Mu = window.hkMusic; if (key && Mu && Mu.known && Mu.known(key)) Mu.setFocus(key); },
        done: function (ms) {
          if (mpnl !== me) return;
          clearTimeout(me.doneT);
          me.doneT = setTimeout(function () { if (mpnl === me) closeMusicPanel(); }, ms || 0);
        },
        wide: function () { return false; },
        mini: function () { return true; },
        now: function () {
          var m = musicOf(clientNow());
          return m ? { idle: false, playing: m.playing, title: m.title, artist: m.artist, pic: m.pic, room: '' } : null;
        },
        transport: function (k) {
          var c = clientNow(), m = c && musicOf(c);
          if (m && c.actions) c.actions.callService('media_player', k === 'pp' ? 'media_play_pause' : 'media_next_track', {}, { entity_id: m.key }).catch(function () { /* refused */ });
        }
      });
      var el = me.p.el, drawer = how === 'drawer', inset = drawer ? 0 : 8;
      el.classList.add('up', 'pn');
      if (drawer) el.classList.add('dr');
      el.style.cssText = 'left:' + (r.left + inset) + 'px;top:' + (r.top + inset) + 'px;width:' + (r.width - 2 * inset) + 'px;height:' + (r.height - 2 * inset) + 'px';
      sr.appendChild(el);
      me.p.size(r.width - 2 * inset, r.height - 2 * inset, 1);
      me.p.show(tab);
      scrim.addEventListener('click', closeMusicPanel);
      me.key = function (ev) { if (ev.key === 'Escape') closeMusicPanel(); };
      window.addEventListener('keydown', me.key);
      document.body.appendChild(host);
      mpnl = me;
      // FLIPPED OVER (Now Playing's When Tapped, 2026-10-31, item 44): the section turns over to the same panel;
      // or THE DRAWER rises from it
      if (from && from.getBoundingClientRect && (how === 'flip' || drawer)) {
        var fr = from.getBoundingClientRect();
        me.from = from; me.rect = { left: fr.left, top: fr.top, width: fr.width, height: fr.height };
        me.box = { x: r.left + inset, y: r.top + inset, w: r.width - 2 * inset, h: r.height - 2 * inset };
        me.how = how;
        if (drawer) drawerAnim(me, true); else turnAnim(me, true);
      }
    }
    function closeMusicPanel() {
      var me = mpnl;
      if (!me) return;
      mpnl = null;
      clearTimeout(me.doneT);
      window.removeEventListener('keydown', me.key);
      var fin = function () { try { me.p.destroy(); } catch (e) { /* gone */ } me.host.remove(); if (me.from && me.from.isConnected) me.from.style.visibility = ''; };
      if (me.from) { (me.how === 'drawer' ? drawerAnim : turnAnim)(me, false, fin); return; }
      fin();
    }
    // THE DRAWER'S RISE: what plays rides up from where the section's cover was to the pane's top, the drawer's glass
    // fading in over the pane as the section fades out under it, the tabs and the list rising in after. Closing runs the
    // same steps backwards. Transforms and opacity only; at rest under Reduce Motion.
    function drawerAnim(me, opening, done) {
      var el = me.p.el, src = me.from, B = me.box, R = me.rect, HC = C();
      var EASE = (HC && HC.EASE) || { standard: 'ease-out', exit: 'ease-in' };
      var reduce = (window.hkSettings && window.hkSettings.skyLook && window.hkSettings.skyLook().animations === false) ||
                   (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      // NO CLIP (2026-11-06, the owner: "when it slides in from the top or goes back down, it gets clipped at the bottom"):
      // the drawer opened as a clip from the section's box. Its edge swept through the list, and closing it left a dark
      // band of the small row over the pane before the section came back. Now the two cross-fade: nothing is cut.
      // (the small row starts level with the section's cover: its own cover sits under its 24 px of padding)
      var cover = src && src.isConnected && src.querySelector('.np .art');
      var lift = cover ? cover.getBoundingClientRect().top - 24 : R.top;
      var top = Math.max(0, Math.round(lift - B.y));
      var inner = el.querySelector('.mpin'), rest = el.querySelectorAll('.mphd,.mpbody,.mpfoot');
      var ride = [{ transform: 'translateY(' + top + 'px)' }, { transform: 'none' }];
      var rise = [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }];
      var stop = function () {
        (me.anims || []).forEach(function (x) { try { x.cancel(); } catch (e) { /* done */ } });
        me.anims = []; me.anim = null;
      };
      stop();
      var live = !!(src && src.isConnected && typeof src.animate === 'function');
      var can = !reduce && typeof el.animate === 'function';
      var run = function (target, frames, o) { var x = target.animate(frames, o); me.anims.push(x); return x; };
      var hideSrc = function (on) {
        if (!src || !src.isConnected) return;
        src.style.transition = 'none';
        src.style.visibility = on ? 'hidden' : '';
        if (!on) { void src.offsetWidth; src.style.transition = ''; }
      };
      if (opening) {
        if (!can) { hideSrc(true); return; }
        var o = { duration: 440, easing: EASE.standard };
        var a = me.anim = run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
        var r1 = inner ? run(inner, ride, o) : a;
        Array.prototype.forEach.call(rest, function (n) { run(n, rise, { duration: 320, delay: 120, easing: EASE.standard, fill: 'backwards' }); });
        if (live) {
          var f = run(src, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
          f.onfinish = function () { if (me.anims.indexOf(f) >= 0) hideSrc(true); };
        } else hideSrc(true);
        r1.onfinish = function () { if (me.anims.indexOf(r1) >= 0) stop(); };
      } else {
        if (!can) { done(); return; }
        var c = { duration: 360, easing: EASE.standard, fill: 'forwards' };
        if (inner) run(inner, ride.slice().reverse(), c);
        Array.prototype.forEach.call(rest, function (n) { run(n, rise.slice().reverse(), { duration: 140, easing: 'ease-in', fill: 'forwards' }); });
        var b = me.anim = run(el, [{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], c);
        if (live) {
          hideSrc(false);
          run(src, [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' });
        }
        b.onfinish = function () { stop(); done(); };
      }
    }
    // THE TURN, as the Home Grid's Now Playing block and the screensaver turn the card (hk-media.js _turnAnim): the section
    // to edge-on where it stands, then the panel from edge-on, growing from the section's size to its own; back the same
    // way. Transforms only; at rest under Reduce Motion (the section hidden, the panel shown).
    function turnAnim(me, opening, done) {
      var el = me.p.el, src = me.from, B = me.box, R = me.rect, HC = C();
      var EASE = (HC && HC.EASE) || { standard: 'ease-out', exit: 'ease-in' };
      var reduce = (window.hkSettings && window.hkSettings.skyLook && window.hkSettings.skyLook().animations === false) ||
                   (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      var edge = 'perspective(1500px) rotateY(90deg)';
      var small = 'perspective(1500px) translate(' + Math.round(R.left + R.width / 2 - (B.x + B.w / 2)) + 'px,' + Math.round(R.top + R.height / 2 - (B.y + B.h / 2)) +
                  'px) rotateY(-90deg) scale(' + (R.width / B.w).toFixed(3) + ',' + (R.height / B.h).toFixed(3) + ')';
      var live = src && src.isConnected && typeof src.animate === 'function';
      // (both halves on one schedule, the panel painted before it moves: hk-saver-panel.js turn)
      var P = window.hkSaverPanel;
      var can = !reduce && typeof el.animate === 'function' && !!(P && P.turn);
      if (me.anim) { try { me.anim.cancel(); } catch (x) { /* done */ } me.anim = null; }
      var o = { el: el, src: src, flat: small, edge: edge, srcGone: function (on) { if (src.isConnected) src.style.visibility = on ? 'hidden' : ''; } };
      if (opening) {
        if (!can || !live) { if (src && src.isConnected) src.style.visibility = 'hidden'; return; }
        o.out = [240, EASE.exit]; o.in = [440, EASE.standard];
        var tr = me.anim = P.turn(Object.assign(o, { done: function () { if (me.anim === tr) me.anim = null; } }), true);
      } else {
        if (!can || !live) { done(); return; }
        o.out = [300, EASE.exit]; o.in = [280, EASE.standard];
        me.anim = P.turn(Object.assign(o, { done: function () { me.anim = null; done(); } }), false);
      }
    }
    // NOW PLAYING IN THE PANE: the docked bar gives the music up to it while
    // it shows (hk-popup.js's `flag` condition, hk-strategy.js)
    function musicFlag(on) {
      var de = document.documentElement;
      if (!de || de.hasAttribute('hk-pane-music') === !!on) return;
      de.toggleAttribute('hk-pane-music', !!on);
      try { window.dispatchEvent(new Event('hk-popup-flags')); } catch (e) { /* none */ }
    }

    // what the shell and the later parts use of this one
    K.musicFlag = musicFlag; K.musicPanel = musicPanel;
  };
})();
