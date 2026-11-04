// hk-media-saver.js - the screensaver's now-playing line and the Browse Music frame.
//
// PART OF THE MUSIC AND MEDIA CARDS (hk-media.js). Not a card and not run on its own: it registers one
// function, which hk-media.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkMediaParts = window.hkMediaParts || {})['hk-media-saver'] = function (K) {
    var esc = K.esc, HkBase = K.HkBase;

    // ------------------------------------------------ hk-screensaver-now-card
    //
    // WHATEVER IS PLAYING, bottom-left of the screensaver. Not whatever the
    // selector points at: on a screensaver there is nobody to have made a
    // selection, and the useful answer is "this is what the home is playing
    // right now". Grouped players are checked FIRST -- `players` is in priority
    // order -- so a group reports once instead of the card flickering between
    // its members.
    //
    // MUSIC SPEAKERS ONLY, and the exclusions are not all the same kind of
    // thing. TVs and Apple TVs read `playing` for hours, and "now playing"
    // here means music; a bedroom speaker playing a twelve-hour sleep sound
    // is exactly the sort of thing nobody wants named across the bottom of
    // a photo screensaver.
    // `music: true` takes the list from the integration's configured speakers.
    class HkScreensaverNowCard extends HkBase {
      static get CSS() {
        return [
          // The card occupies NO SPACE: WallPanel stacks the cards it is given
          // in an info box at the top-left, and the body below steps out of that
          // box to pin itself to the opposite corner.
          'hk-plate.ssnow{background:none;box-shadow:none;border:none;padding:0;',
          '  margin:0;height:0;overflow:visible;display:block}',
          // position:fixed so this sits in the VIEWPORT's bottom-left rather
          // than under the clock. left:20px matches the clock card's own left
          // margin, so the two line up.
          // will-change: its own compositing layer, so WallPanel re-layering
          // the photos underneath at each change cannot re-raster it -- see
          // `layer` on hk-clock-card. This card only exists on the screensaver.
          // the forecast screensaver raises it above its band (--hk-ss-corner-bottom)
          // (it glides there, rather than jumping, as the band comes and goes)
          // (--hk-ss-now-*: the screensaver's calendar pane, which takes this
          // row into its foot, smaller -- hk-saver.js layoutPane)
          '.sscorner{position:fixed;left:var(--hk-ss-now-left,20px);bottom:var(--hk-ss-now-bottom,var(--hk-ss-corner-bottom,22px));z-index:5;display:flex;',
          '  transition:bottom 1.2s ease;',
          '  will-change:transform;',
          '  align-items:center;gap:var(--hk-ss-np-gap,18px);max-width:var(--hk-ss-now-max,46vw);pointer-events:none}',
          '.sscorner img,.sscorner .ph{width:var(--hk-ss-np-art,104px);height:var(--hk-ss-np-art,104px);border-radius:12px;',
          '  flex:0 0 var(--hk-ss-np-art,104px)}',
          '.sscorner img{object-fit:cover;box-shadow:0 10px 30px rgba(0,0,0,.45)}',
          '.sscorner .ph{background:rgba(255,255,255,.14);align-items:center;',
          '  justify-content:center;font-size:44px;opacity:.7}',
          // text-shadow:none + filter, NOT the inherited text-shadow. Both lines
          // are nowrap + overflow:hidden for the ellipsis, and a text-shadow is
          // clipped by the element that paints it -- so the info box's 68px-blur
          // stack came out as a hard band around a ~38px line box. A filter
          // applies after the children clip, so the ellipsis still works and the
          // shadow escapes. These radii are sized for 24-34px text, not for the
          // 150px clock the info-box value is tuned to.
          //
          // The filter is on the TEXT div and not on the position:fixed wrapper
          // on purpose: `filter` makes an element a containing block for fixed
          // descendants, which would undo the corner pinning. Same reason the
          // screensaver info box itself still uses text-shadow.
          //
          // text-align:left is REQUIRED, not decoration. WallPanel's info box
          // centres its content and these two lines inherit that, so the track
          // and artist would sit centred against each other beside the album art
          // instead of sharing a left edge. Nothing in the card sets it, so there
          // is nothing to notice; the inherited value does it.
          // (--hk-ss-ink, -ink-2 and -glow: the screensaver's on a light face -- dark words, no shadow)
          '.sscorner .txt{min-width:0;text-align:left;text-shadow:none;',
          '  filter:var(--hk-ss-glow,drop-shadow(0px 1px 3px rgba(0,0,0,0.34))',
          '    drop-shadow(0px 3px 14px rgba(0,0,0,0.30)))}',
          '.sscorner .t{font-size:var(--hk-ss-np-title,34px);font-weight:700;letter-spacing:-0.4px;',
          '  line-height:1.12;color:var(--hk-ss-ink,rgba(255,255,255,.97));white-space:nowrap;',
          '  overflow:hidden;text-overflow:ellipsis}',
          '.sscorner .a{font-size:var(--hk-ss-np-artist,24px);font-weight:500;letter-spacing:-0.1px;',
          '  line-height:1.2;margin-top:4px;color:var(--hk-ss-ink-2,rgba(255,255,255,.82));',
          '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
        ].join('');
      }
      // `music: true`: the home's own speakers from the integration, presets
      // first -- the priority order a hand-written `players:` list would use,
      // without the list. `players:` still works for anything else.
      setConfig(config) {
        if (!config || !(config.music ||
                         (Array.isArray(config.players) && config.players.length))) {
          throw new Error('hk-screensaver-now: `music: true` or `players:` (in priority order)');
        }
        super.setConfig(config);
      }
      _players() {
        if (this._config.music && window.hkMusic) {
          return window.hkMusic.speakers().map(function (s) { return s.entity; });
        }
        return this._config.players || [];
      }
      getCardSize() { return 1; }
      _sigOf() {
        var h = this.client;
        if (!h) return null;
        var p = this._playing();
        if (!p) return 'none';
        var a = p.attributes || {};
        // The artwork URL is an input: a cover that lands after the title
        // (AirPlay metadata often does) must redraw the card.
        return p.entity_id + '|' + (a.media_title || '') + '|' + (a.media_artist || '') +
               '|' + (a.entity_picture_local || a.entity_picture || a.media_image_url || '');
      }
      _playing() {
        var ids = this._players();
        for (var i = 0; i < ids.length; i++) {
          var s = this._st(ids[i]);
          if (s && s.state === 'playing' && !(window.hkMusic && window.hkMusic.ignored(s))) return s;
        }
        return null;
      }
      _render() {
        if (!this._built) {
          this._root.innerHTML =
            '<hk-plate class="sscorner-host ssnow" data-hk-role="card"></hk-plate>';
          this._e = this._root.querySelector('.ssnow');
          this._built = true;
        }
        var p = this._playing();
        var a = (p && p.attributes) || {};
        var title = a.media_title || '', artist = a.media_artist || '';
        // NOTHING PLAYING DRAWS NOTHING, which is what keeps the screensaver
        // unchanged the rest of the time.
        if (!p || (!title && !artist)) {
          if (this._e.firstChild) this._e.textContent = '';
          return;
        }
        // entity_picture_local, not entity_picture: Music Assistant sets the
        // latter to an absolute URL on port 8095, which resolves only from
        // inside the LAN.
        var pic = a.entity_picture_local || a.entity_picture || a.media_image_url || '';
        if (pic && pic.charAt(0) === '/') pic = location.origin + pic;

        var box = document.createElement('div');
        box.className = 'sscorner';
        // THE PLACEHOLDER IS ALWAYS IN THE MARKUP, hidden, with the <img> in
        // front of it and an onerror that swaps them. A URL that 404s is not a
        // rare case here: not every speaker is Music Assistant, and the non-MA
        // ones can hand back a picture path that does not resolve, which would
        // draw the browser's broken-image icon on the screensaver. There is no
        // way to test the URL before rendering, so the markup has to survive it
        // failing.
        var ph = document.createElement('div');
        ph.className = 'ph';
        ph.textContent = '♫';
        ph.style.display = pic ? 'none' : 'flex';
        if (pic) {
          var img = document.createElement('img');
          img.src = pic;
          img.alt = '';
          // ...AND A URL THAT NEVER ANSWERS AT ALL. `error` fires for a 404;
          // it does NOT fire for a host that accepts the connection and then
          // says nothing, which is what a wall tablet with no internet access
          // gets from anything off the LAN (see _artImage in hk-base.js).
          // Without the timeout the screensaver shows an empty corner for as
          // long as it is up -- the same silence, one card over.
          var fall = function () {
            img.style.display = 'none';
            ph.style.display = 'flex';
          };
          var pt = setTimeout(function () {
            if (!(img.complete && img.naturalWidth > 0)) { img.src = ''; fall(); }
          }, 6000);
          img.addEventListener('load', function () { clearTimeout(pt); });
          img.addEventListener('error', function () { clearTimeout(pt); fall(); });
          box.appendChild(img);
        }
        box.appendChild(ph);
        var txt = document.createElement('div');
        txt.className = 'txt';
        var t = document.createElement('div');
        t.className = 't';
        t.textContent = title;              // textContent, so no escaping to get wrong
        var ar = document.createElement('div');
        ar.className = 'a';
        ar.textContent = artist;
        txt.appendChild(t);
        txt.appendChild(ar);
        box.appendChild(txt);
        this._e.innerHTML = '';
        this._e.appendChild(box);
      }
    }

    // ---------------------------------------------------------------------
    // hk-browse-card -- Music Assistant's own web UI, inside a dashboard page.
    //
    // WHY A CARD AND NOT A PAGE. A standalone page holding one iframe and a
    // "Close" button that calls window.close() does not work, for two reasons:
    //
    //   1. window.close() CANNOT CLOSE A PAGE THE SCRIPT DID NOT OPEN. A page
    //      reached by in-place navigation (`location.href = ...`) is not one,
    //      so Close does nothing at all, and on a kiosk tablet with no browser
    //      chrome there is no way back.
    //   2. It is outside the dashboard: no back chevron, no theme, no sky, and
    //      a full page load to reach it.
    //
    // As a subview it gets the same back chevron as every other page, which
    // cannot strand anybody, and the whole class of problem disappears.
    //
    // THE URL IS DERIVED, NOT HARDCODED. A literal
    // `http://<music-assistant-host>:8095` only works from that one address.
    // Music Assistant runs on the same host as Home Assistant on a different
    // port, so the host comes from wherever this page was served and only the
    // port is configuration. Any tablet reaching HA by any name or address
    // reaches MA the same way.
    //
    // MIXED CONTENT IS SAID OUT LOUD. MA serves plain HTTP. An HTTP frame inside
    // an HTTPS page is blocked by the browser with no visible error -- the
    // symptom is an empty rectangle, which looks like a broken flow but is
    // not. (Browse Music itself is hk-library-card, which has no frame.) So
    // rather than a blank frame, an HTTPS visitor is told what is happening
    // and given the direct link.
    class HkBrowseCard extends HkBase {
      setConfig(config) {
        this._config = Object.assign({ port: 8095, path: '/#/home' }, config || {});
        super.setConfig(this._config);
      }
      getCardSize() { return 12; }
      // Nothing here follows entity state; the frame owns itself once built.
      _sigOf() { return 'static'; }

      // ONE definition of the URL, exposed so the tests can drive it without a
      // browser. `host` is an escape hatch for the case where MA is genuinely
      // not on the same machine as HA; unset, it follows whatever address this
      // page was reached on, which is the whole point.
      _host(loc) { return this._config.host || (loc || location).hostname; }
      // SAME ORIGIN WHEN THE HOST SERVES IT. A host that serves Music
      // Assistant's web app under its own address (Mantel: /ma/, behind its
      // sign-in) says so through the shell; the frame is then same-origin --
      // https on an https page -- and nothing below about ports or mixed
      // content applies. An explicit `host` still wins (MA elsewhere). Only a
      // path on this origin is taken, never another site.
      _service() {
        if (this._config.host) return null;
        var S = window.hkShell;
        var u = S && typeof S.serviceUrl === 'function' ? S.serviceUrl('music_assistant') : null;
        return typeof u === 'string' && u.charAt(0) === '/' && u.charAt(1) !== '/' ? u : null;
      }
      _target(loc) {
        var svc = this._service();
        if (svc) return svc.replace(/\/+$/, '') + '/' + String(this._config.path || '').replace(/^\/+/, '');
        return (loc || location).protocol + '//' + this._host(loc) +
               ':' + this._config.port + this._config.path;
      }
      _direct(loc) {
        // http:// explicitly: the point is that MA is not on https.
        return 'http://' + this._host(loc) + ':' + this._config.port + this._config.path;
      }
      _blocked(loc) {
        // Only https-over-http is blocked. http pages -- every wall tablet --
        // frame http happily, and a same-origin frame (_service) never is.
        if (this._service()) return false;
        return (loc || location).protocol === 'https:';
      }

      _render() {
        if (this._built) return;
        this._built = true;
        var cfg = this._config;

        // A REBUILD REPLACES THE LAST BUILD. HkBase.setConfig clears _built so
        // a re-configured card rebuilds (the editor preview re-configures the
        // same element on every edit), and building on top of the previous one
        // would add one more iframe -- one more copy of Music Assistant's
        // whole web app -- and one more window resize listener per setConfig,
        // none of them ever released. The previous build's fit ramp stops too,
        // or its late steps would refit a frame now given an explicit height.
        (this._ramp || []).forEach(function (t) { clearTimeout(t); });
        this._ramp = null;
        this._unlisten();
        this._root.innerHTML = '';
        this._frame = null;

        if (this._blocked()) {
          var direct = this._direct();
          this._root.innerHTML =
            '<style>.hkb{display:flex;align-items:center;justify-content:center;' +
            'height:' + (cfg.height || '70vh') + ';padding:0 32px;text-align:center}' +
            '.hkb .in{max-width:520px;color:var(--hk-text,' + window.hkCards.v('ink') + ');font:400 16px/1.5 system-ui}' +
            '.hkb h3{font:600 20px/1.3 system-ui;margin:0 0 10px}' +
            '.hkb a{color:var(--hk-accent,#2f95dc)}</style>' +
            '<div class="hkb"><div class="in"><h3>Music Assistant is on your local network</h3>' +
            '<p>Its web player is served over plain HTTP, which this page cannot embed ' +
            'because you are connected over HTTPS. Everything else on this page works ' +
            'normally.</p><p><a href="' + esc(direct) + '" target="_blank" ' +
            'rel="noopener">Open Music Assistant directly</a></p></div></div>';
          return;
        }

        var f = document.createElement('iframe');
        f.src = this._target();
        f.setAttribute('allow', 'autoplay');
        f.style.cssText = 'width:100%;border:0;border-radius:' +
                          (cfg.radius || '18px') + ';display:block;background:#000';
        this._root.appendChild(f);
        this._frame = f;

        if (cfg.height) {
          f.style.height = cfg.height;      // an explicit height always wins
        } else {
          var self = this;
          // A BOUNDED RAMP, AND DELIBERATELY NOT A ResizeObserver.
          //
          // The frame has to be re-fitted after the page settles because Home
          // Assistant and the nested custom grids do not finish layout in one
          // turn; fitting once can leave the bottom gap several pixels out.
          //
          // An observer on this element is the obvious answer and it is WRONG:
          // setting the frame's height resizes the card, which fires the
          // observer, which fits again. Measured on a live page, that loop
          // settles at a 150px frame in a 657px viewport. Whatever the exact
          // path, sizing an element from a signal that its own size produces is
          // not stable, and no amount of guarding makes it so.
          //
          // So: fit a handful of times across the window in which a view is
          // still settling, then stop. The thing being waited for has no event.
          this._ramp = [0, 60, 200, 600, 1200].map(function (ms) {
            return setTimeout(function () { self._fit(); }, ms);
          });
          // Rotation and browser chrome appearing are real viewport changes and
          // do need handling; those have an event.
          this._onResize = function () { self._fit(); };
          window.addEventListener('resize', this._onResize);
        }
      }

      // FILL WHAT IS LEFT, WITH THE BOTTOM GAP EQUAL TO THE SIDE GAPS.
      //
      // A fixed `height: 78vh` is a guess that cannot work: the space above the
      // frame is the back chevron and the page heading, and that is a
      // different height on a kiosk tablet (no HA header) than on a desktop
      // dashboard (header present) -- so any single vh number is short on one
      // and overflows the other.
      //
      // So it is measured instead. The card's own left edge IS the side gutter
      // the page grid produced (2% / 96% / 2%, plus layout-card's 4px per nesting
      // level), so using it as the bottom margin makes all three equal by
      // construction rather than by a number someone tuned once at one size.
      _fit() {
        var f = this._frame;
        if (!f || !this.isConnected) return;
        var r = this.getBoundingClientRect();
        var gutter = Math.max(0, Math.round(r.left));
        // NOT minus the child's bottom margin. layout-card does put
        // `margin: 4px 4px 8px` on every grid child, and subtracting that 8px
        // looks right and measures wrong -- the gap goes to 42 against 34 at the
        // sides. The margin is part of the space being left below the frame, not
        // space taken from it. (A 9px discrepancy mid-layout is the ramp: the
        // card sits at top 101 mid-layout and 92 once settled.)
        var h = Math.round(window.innerHeight - r.top - gutter);
        // A floor, so a card measured mid-layout -- or one somewhere unexpected,
        // like a narrow editor preview -- never collapses to nothing.
        if (h < 200) h = 200;
        if (f.style.height !== h + 'px') f.style.height = h + 'px';
      }

      // A CACHED VIEW COMING BACK attaches the card again without building it
      // (_render returns once built), so the resize listener taken off on the
      // way out is put back here, and the frame fitted to the page as it is now
      // -- on the next frame, once the view it came back in has its layout.
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this._built && this._frame && !this._onResize) {
          var self = this;
          this._onResize = function () { self._fit(); };
          window.addEventListener('resize', this._onResize);
          requestAnimationFrame(function () { self._fit(); });
        }
      }

      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        this._unlisten();
      }

      _unlisten() {
        if (this._onResize) {
          window.removeEventListener('resize', this._onResize);
          this._onResize = null;
        }
      }
    }

    // what the shell and the later parts use of this one
    K.HkBrowseCard = HkBrowseCard; K.HkScreensaverNowCard = HkScreensaverNowCard;
  };
})();
