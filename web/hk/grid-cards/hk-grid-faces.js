// hk-grid-faces.js - the clock block and the Cameras face.
//
// PART OF THE HOME GRID'S CARDS (hk-grid-cards.js). Not a card and not run on its own: it registers one
// function, which hk-grid-cards.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridCardsParts = window.hkGridCardsParts || {})['hk-grid-faces'] = function (K) {
    var C = K.C, CAM_GAP = K.CAM_GAP, CAM_MAX = K.CAM_MAX, camGrid = K.camGrid, camRing = K.camRing, FULL_CSS = K.FULL_CSS,
        HkGridFull = /** @type {HkLooseElementConstructor} */ (K.HkGridFull), setting = K.setting, sizeOf = K.sizeOf, v = K.v;

    // THE CLOCK BLOCK (2026-10-24, the owner: "many clocks", for a phone on
    // a nightstand): HK's own clock (hk-clock-card, the header's type), or
    // one of the screensaver's faces (hk-saverclock.js, sized by container
    // units, so they fit a block as they fit a screen) -- with its plate,
    // or `bare` on the wallpaper. CLOCK_FACES (hk-grid-catalog.js) are the
    // faces that read at a block's size; the rest need a screen of their own.
    function clockModule() {
      if (window.hkSaverClock) return Promise.resolve(window.hkSaverClock);
      if (!/** @type {any} */ (clockModule).p) {
        /** @type {any} */ (clockModule).p = import('/hk/modules/hk-saverclock.js').then(function () { return window.hkSaverClock; })
          .catch(function (e) { /** @type {any} */ (clockModule).p = null; console.warn('[hk-grid] clock', e && e.message); return null; });
      }
      return /** @type {any} */ (clockModule).p;
    }
    // (the block clips the face, not the face itself: scaled down, its own box is smaller than its drawing)
    var CLOCK_CSS = '.body{height:100%}.ck .ckroot{overflow:visible}.ck{position:relative;height:100%;box-sizing:border-box;overflow:hidden;border-radius:var(--hk-block-radius, ' + C.R.plate +
      'px)}' +
      '.ck.plate{' + C.plate('card') + '}';
    // THE DIALS USE THEIR BLOCK (2026-11-07, the review: an Analog face in Wide or Tall sat small in the middle with 124 px of bare
    // plate on both sides, 458 at XXL): a round face -- Analog, Classic, Analog Numbers -- in a block that is not square is the
    // face as large as the height lets it and, beside it (Wide, Extra Large, Full Width) or under it (Tall), the weekday and the
    // date -- Wide and wider the time too, as a figure -- as the HomeView clock widget has them. The face stays bare as HomeView draws it.
    var ROUND = { analog: 1, classic: 1, numbers: 1 };
    var SPLIT_CSS = '.ck.split{display:flex;align-items:center;justify-content:center;gap:18px;padding:' + C.blockPad('14px') + ';text-shadow:' + v('glow') + '}' +
      '.ck.split .cf{position:relative;flex:none;height:100%;aspect-ratio:1/1;min-width:0}' +
      '.ck.split.xx{justify-content:space-evenly}' +
      '.ck.split.t{flex-direction:column;gap:12px}.ck.split.t .cf{flex:none;width:100%;height:auto;aspect-ratio:1/1}' +
      '.ck.split .ct{min-width:0;display:flex;flex-direction:column;gap:2px;color:' + v('ink') + '}.ck.split.t .ct{flex:none;align-items:center;text-align:center;width:100%}' +
      '.ck.split .d1{' + C.typeCss('title') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ck.split.xw .d1{' + C.typeCss('figure-l') + '}' +
      '.ck.split .d2{' + C.typeCss('headline') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ck.split .d3{' + C.typeCss('figure') + ';font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:8px}' +
      '.ck.split.xw .d3{' + C.typeCss('figure-l') + ';font-weight:600}' +
      '.ck.split.t .d3{margin-top:4px}';
    // ===================================================== the clock, in the kit (round 12, 2026-11-23)
    // The owner: "Your clock is good." and, of Double Extra Large: "If we are doing Double extra large...for some cards, we need to make it worth
    // it...maybe for clock we would have the calendar?" The Analog and Analog Numbers faces are drawn from the kit's parts: the face (numerals
    // round a quiet dial, white hands, a slim orange second hand and hub) on Small and Large; wider, the time and the date beside it; Tall the
    // time and the date under it. Double Extra Large (1241 x 405) is the clock and the calendar in one plate: the face, the time and date as the
    // reading, a hairline, the month (today in a red circle, a dot under each day with events in its calendar's color), a hairline, and
    // the events still to come as list rows. Digital draws the same Double Extra Large with the time itself in the face's place; every other
    // size of Digital and the screensaver's faces stay as they are.
    // THE SECOND HAND OBEYS BOTH SWITCHES: it is drawn, and stepped once a second, only while Motion (Appearance) and the Background's
    // Animations allow it and the card is on the screen; held still it is not drawn and the card is drawn again once a minute.
    var CK_ORANGE = '#ff9f0a', CK_RED = '#ff3b30', EASE = C.EASE;
    function ymdOf(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
    // the face: numerals at .76 of the radius, the hands, a slim second hand with a tail and a hub; centered on its own origin
    function ckFace(R, hm, sec) {
      var p = function (n) { return Math.round(n * 100) / 100; }, o = '<svg width="' + 2 * R + '" height="' + 2 * R + '" viewBox="' + p(-R) + ' ' + p(-R) + ' ' + 2 * R + ' ' + 2 * R +
        '" aria-hidden="true" style="display:block;overflow:visible">';
      for (var i = 0; i < 12; i++) {
        var a = i * Math.PI / 6;
        o += '<text x="' + p(Math.sin(a) * R * 0.76) + '" y="' + p(-Math.cos(a) * R * 0.76 + R * 0.085) + '" text-anchor="middle" font-size="' + p(R * 0.22) +
          '" font-weight="500" fill="currentColor" style="font-family:inherit">' + (i || 12) + '</text>';
      }
      var hand = function (cls, len, width, deg) {
        return '<g class="' + cls + '" style="transform:rotate(' + p(deg) + 'deg)"><line y1="0" y2="' + p(-len) + '" stroke="currentColor" stroke-width="' + p(width) +
          '" stroke-linecap="round"/></g>';
      };
      o += hand('hh', R * 0.48, R * 0.07, hm.h) + hand('mh', R * 0.72, R * 0.045, hm.m);
      if (sec != null) o += '<g class="sh" style="transform:rotate(' + p(sec) + 'deg);transition:transform .25s ' + EASE.spring + '"><line y1="' + p(R * 0.16) + '" y2="' + p(-R * 0.8) +
        '" stroke="' + CK_ORANGE + '" stroke-width="' + p(Math.max(1.4, R * 0.018)) + '"/></g>';
      return o + '<circle r="' + p(R * 0.05) + '" fill="' + CK_ORANGE + '"/></svg>';
    }
    // the month as a grid of its days from `x`, `w` wide: the weekday letters, then the weeks (4 to 6), today in a red circle, a dot under a day
    // for each calendar with something on it (up to three); `days` maps a day of the month to its colors
    function ckMonth(Kit, x, y, w, h, m) {
      var cw = w / 7, rows = Math.ceil((m.lead + m.n) / 7), rh = Math.min(52, (h - 22) / rows), ch = Math.min(rh - 6, cw - 6, m.big ? 36 : 30), o = '';
      m.dows.forEach(function (l, i) { o += Kit.tx(x + i * cw, y, cw, 'kl', Kit.esc(l), 'text-align:center;font-size:13px'); });
      for (var dn = 1; dn <= m.n; dn++) {
        var pos = m.lead + dn - 1, col = pos % 7, cx = x + col * cw, cy = y + 22 + Math.floor(pos / 7) * rh, isT = dn === m.today, ds = m.dots[dn] || [], weekend = m.ends.indexOf(col) >= 0;
        o += Kit.box(cx + (cw - ch) / 2, cy + 2, ch, ch, 'fc num', 'border-radius:' + ch / 2 + 'px;font-size:' + (m.big ? 17 : 15) + 'px;font-weight:' + (isT ? 700 : 500) + ';' +
          (isT ? 'background:' + CK_RED + ';color:#fff;text-shadow:none' : weekend ? 'color:' + v('ink-2') : ''), String(dn)) +
          (ds.length ? Kit.box(cx + cw / 2 - ds.length * 4, cy + ch + 5, ds.length * 8, 5, '', 'display:flex;gap:3px', ds.map(function (c) {
            return '<span style="width:5px;height:5px;border-radius:calc(5px / 2);background:' + c + '"></span>'; }).join('')) : '');
      }
      return o;
    }
    // the whole of the clock's plate for a size: d { dial (a face, else the time itself), hm { h, m } hands' degrees, sec (the second hand's degrees, or null),
    // time, ap, weekday, date, dateShort, dateYear, cal { month name, month: ckMonth's input, title, events: [{ color, t, b }], more } }
    function ckLayout(Kit, k, sz, d) {
      var w = k.w, h = k.h, X = k.X, E = k.E, sq = h >= 180, o = '', fsFor = function (n, m) { return sq ? n : m; };
      var face = function (cx, cy, R) { return Kit.box(cx - R, cy - R, 2 * R, 2 * R, 'ckf', '', ckFace(R, d.hm, d.sec)); };
      var time = function (x, y, ww, fs, al) {
        return Kit.tx(x, y, ww, 'kh', Kit.esc(d.time) + (d.ap ? '<span style="font-size:' + (sz === 'XXL' ? 0.3 : 0.36) + 'em;font-weight:600;margin-left:' + (sz === 'XXL' ? 8 : 6) + 'px;color:' +
          v('ink-2') + '">' + Kit.esc(d.ap) + '</span>' : ''), 'font-size:' + fs + 'px;height:' + fs + 'px;line-height:' + fs + 'px;text-align:' + (al || 'left'));
      };
      if (sz === 'S' || sz === 'L') return face(w / 2, h / 2, Math.min(w, h) / 2 - E);
      if (sz === 'T') {
        var R = w / 2 - E, fs = fsFor(64, 52);
        return face(w / 2, E + R, R) + time(0, E + 2 * R + 18, w, fs, 'center') + Kit.tx(X, E + 2 * R + 26 + fs, w - 2 * X, 'kb', Kit.esc(d.dateShort), 'text-align:center');
      }
      if (sz === 'W' || sz === 'XL') {
        var R2 = Math.min(h / 2 - E, sz === 'W' ? 999 : w * 0.25), x1 = E + 2 * R2 + 28, fs2 = sz === 'W' ? fsFor(56, 52) : fsFor(76, 64), by = (h - (fs2 + 8 + 48)) / 2;
        return face(E + R2, h / 2, R2) + time(x1, by, w - x1 - X, fs2) + Kit.tx(x1, by + fs2 + 8, w - x1 - X, 'kt', Kit.esc(d.weekday)) + Kit.tx(x1, by + fs2 + 32, w - x1 - X, 'kb', Kit.esc(d.date));
      }
      // Double Extra Large: the face (or the time itself), the reading, the month, the events
      var rx = d.dial ? 790 : 640, mx = rx + 10, mw = d.dial ? 230 : 300, sx = mx + mw + 10, c = d.cal || {};
      if (d.dial) o += face(405 / 2, h / 2, 405 / 2 - E) + time(415, 110, 360, 120) + Kit.tx(415, 244, 360, 'kd', Kit.esc(d.weekday)) + Kit.tx(415, 274, 360, 'kb', Kit.esc(d.dateYear));
      else o += time(X, Math.round((h - 150) / 2) - 18, rx - 2 * X, 150, 'left') + Kit.tx(X, Math.round((h - 150) / 2) + 150, rx - 2 * X, 'kd', Kit.esc(d.weekday)) +
        Kit.tx(X, Math.round((h - 150) / 2) + 180, rx - 2 * X, 'kb', Kit.esc(d.dateYear));
      o += Kit.box(rx, 18, 1, h - 36, 'sep', '') + Kit.tx(mx + 8, 18, mw - 8, 'kt', Kit.esc(c.name || '')) + (c.month ? ckMonth(Kit, mx, 52, mw, h - 70, c.month) : '') +
        '<button type="button" class="hit" data-notap data-day="' + Kit.esc(d.today || '') + '" aria-label="Open the Calendar" style="' + Kit.st(mx - 2, 10, mw + 4, h - 20) + 'border-radius:' + k.r +
          'px"></button>';
      o += Kit.box(sx, 18, 1, h - 36, 'sep', '') + Kit.tx(sx + X, 18, w - sx - 2 * X, 'kt', Kit.esc(c.title || 'Today')) +
        (c.more ? Kit.tx(sx + X, 18, w - sx - 2 * X, 'kb', '+' + c.more + ' more', 'text-align:right') : '');
      var list = (c.events || []).map(function (e) {
        return { lead: '<span style="display:block;width:4px;height:40px;border-radius:calc(4px / 2);background:' + e.color + '"></span>', lw: 4, lh: 40, t: e.t, b: e.b, label: e.t + ', ' + e.b,
          data: { day: e.day } };
      });
      if (list.length) o += Kit.rows(k, sx, w - sx, 52, h - 6, 1, list).html;
      else o += Kit.tx(sx + X, 62, w - sx - 2 * X, 'kb', Kit.esc(c.empty || ''));
      return o;
    }

    class HkGridClockCard extends HkGridFull {
      static get CSS() { return FULL_CSS + CLOCK_CSS + SPLIT_CSS; }
      getCardSize() { return 2; }
      // (the plate's tap, hk-base.js openTarget) a clock leads to the Timers page, as iOS's clock widget opens Clock
      _tapTarget() { return [{ page: 'timers' }]; }
      // 24-hour as the screen's screensaver clock is (its 24-Hour Clock; off, as HK's own clock reads)
      _h24() {
        var M = window.hkCards.menu, b = M && M.board ? M.board() || {} : {}, so = b.screensaver_options || {};
        return so.clock_24 === true || (so.clock_24 == null && setting('look.saver.clock_24', false) === true);
      }
      // its box hidden: its own option (0.1.72), or its block's Hide Box (the cell's --hk-bare)
      _bare() {
        if ((this._config || {}).bare) return true;
        try { return getComputedStyle(this).getPropertyValue('--hk-bare').trim() === '1'; } catch (e) { return false; }
      }
      _sigOf() { var c = this._config || {}; return JSON.stringify([c.clock_style || '', this._bare(), sizeOf(this), this._h24()]); }
      _render() {
        // (the kit's clock, _renderKit; the older drawing below for what the kit does not draw)
        if (this._kitOn()) { if (this._renderKit()) return; } else if (window.hkKit) window.hkKit.forget(this);
        var c = Object.assign({}, this._config || {}, { bare: this._bare() }), style = c.clock_style || '', key = this._sigOf(), self = this;
        if (this._built && this._key === key) { if (this._face && this._face.setClient) this._face.setClient(this.client); if (this._go) this._go(); return; }
        this._key = key; this._built = true; this._kids = [];
        if (this._face) { try { this._face.destroy(); } catch (e) { /* gone */ } this._face = null; }
        if (!style) {
          // HK's clock: its own plate, or none and the header's glow to read on the wallpaper
          this._root.innerHTML = '<div class="body"></div>';
          var k = this._mount(this._root.querySelector('.body'), Object.assign({ type: 'custom:hk-clock-card' }, c.bare ? { shadow: true } : {}), sizeOf(this) || 'W');
          if (c.bare) k.setAttribute('bare', '');
          return;
        }
        var sz = sizeOf(this) || 'S', split = ROUND[style] && /^(W|T|XL|XXL)$/.test(sz);
        this._root.innerHTML = '<div class="ck' + (c.bare ? '' : ' plate') + (split ? ' split' + (sz === 'T' ? ' t' : sz === 'W' ? '' : sz === 'XXL' ? ' xw xx' : ' xw') : '') + '">' +
          (split ? '<div class="cf"></div><div class="ct"><div class="d1"></div><div class="d2"></div>' + '<div class="d3"></div>' + '</div>' : '') + '</div>';
        var ck = this._root.querySelector('.ck'), box = split ? ck.querySelector('.cf') : ck, run = this._run = (this._run || 0) + 1;
        if (split) this._tick(ck);
        clockModule().then(function (M) {
          if (!M || run !== self._run || !box.isConnected) return;
          self._face = M.mount(box, { style: style, h24: self._h24(), bg: 'none', scrim: false, client: self.client });
          self._fillWatch(box, !!c.bare, style, split);
        });
      }
      // ---- THE KIT'S CLOCK (round 12; ckLayout above). The block's own sizes only, no Hide Box (that is the face on the wallpaper).
      _kitOn() {
        var st = (this._config || {}).clock_style || '', sz = sizeOf(this);
        return !!(window.hkKit && sz && !this._bare() && (st === 'analog' || st === 'numbers' || (st === '' && sz === 'XXL')));
      }
      // may the second hand move: Motion on, the Background's Animations on, no reduced motion, this card not held still
      _kitMoves() {
        var S = window.hkSettings, still = false;
        try { still = !!(S && S.rendering && S.rendering().motion === false) || !!(S && S.skyLook && S.skyLook().animations === false) || this.hasAttribute('hk-still'); } catch (e) { still = false; }
        try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) still = true; } catch (e) { /* as set */ }
        return !still && !document.hidden;
      }
      // the house's time as the card shows it: its zone (hkStats.tz), its language, 12 or 24 hours
      _kitTime() {
        var L = window.hkLocale, S = window.hkStats, d = new Date(), tag, zone, h24 = this._h24();
        try { tag = L && L.tag ? L.tag() : undefined; zone = S && S.tz ? S.tz() : undefined; } catch (e) { tag = undefined; zone = undefined; }
        var f = function (o) { try { return new Intl.DateTimeFormat(tag, Object.assign({ timeZone: zone }, o)).format(d); } catch (e) { return new Intl.DateTimeFormat(tag, o).format(d); } };
        var parts = function (o) { try { return new Intl.DateTimeFormat(tag, Object.assign({ timeZone: zone }, o)).formatToParts(d); } catch (e) {
          return new Intl.DateTimeFormat(tag, o).formatToParts(d); } };
        var n = function (list, type) { var p = list.filter(function (x) { return x.type === type; })[0]; return p ? Number(p.value) : 0; };
        var hm = parts({ hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric' });
        var H = n(hm, 'hour') % 24, M = n(hm, 'minute'), s = n(hm, 'second'), pad = function (x) { return (x < 10 ? '0' : '') + x; };
        var ap = '', time;
        if (h24) time = pad(H) + ':' + pad(M);
        else {
          time = ((H % 12) || 12) + ':' + pad(M);
          var dp = parts({ hour: 'numeric', hour12: true }).filter(function (x) { return x.type === 'dayPeriod'; })[0];
          ap = dp ? dp.value : H < 12 ? 'AM' : 'PM';
        }
        return { d: d, H: H, M: M, s: s, time: time, ap: ap, year: n(hm, 'year'), month: n(hm, 'month'), day: n(hm, 'day'), tag: tag,
                 weekday: f({ weekday: 'long' }), date: f({ month: 'long', day: 'numeric' }), dateShort: f({ weekday: 'long', month: 'short', day: 'numeric' }),
                 dateYear: f({ month: 'long', day: 'numeric', year: 'numeric' }), monthName: f({ month: 'long' }) };
      }
      _renderKit() {
        var Kit = window.hkKit, cfg = this._config || {}, sz = sizeOf(this), self = this;
        if (!Kit || !this._root) return false;
        // (a card that was a screensaver face or HK's own clock lets go of it)
        this._built = false; this._key = null;
        if (this._face) { try { this._face.destroy(); } catch (e) { /* gone */ } this._face = null; }
        clearInterval(this._tk); this._tk = null;
        this._watchBlock();
        var k = Kit.ctx(this), t = this._kitTime(), moves = this._kitMoves() && !!(cfg.clock_style), turns = this._kTurns || 0;
        if (t.s < (this._kS == null ? 60 : this._kS)) turns = this._kS == null ? 0 : turns + 1;
        this._kS = t.s; this._kTurns = turns;
        var hm = { h: ((t.H % 12) + t.M / 60) * 30, m: (t.M + t.s / 60) * 6 };
        var d = { dial: !!cfg.clock_style, hm: hm, sec: moves ? turns * 360 + t.s * 6 : null, time: t.time, ap: t.ap, weekday: t.weekday, date: t.date, dateShort: t.dateShort,
                  dateYear: t.dateYear, cal: sz === 'XXL' ? this._kitCal(t, k) : null, today: sz === 'XXL' ? t.year + '-' + (t.month < 10 ? '0' : '') + t.month + '-' + (t.day < 10 ? '0' : '') +
                    t.day : '' };
        var label = 'Clock, ' + t.time + (t.ap ? ' ' + t.ap : '') + ', ' + t.dateShort;
        var html = '<style>:host{display:block;width:100%;box-sizing:border-box}:host([size]){height:100%}hk-plate{display:block}</style>' +
          Kit.plate(k, ckLayout(Kit, k, sz, d), { label: label, cls: 'ck2' });
        var ok = Kit.draw(this, html, function (root) {
          root.querySelectorAll('[data-day]').forEach(function (b) {
            b.addEventListener('click', function () { self._kitGo(b.getAttribute('data-day')); });
          });
        });
        this._kMin = Math.floor(Date.now() / 60000); this._kMoved = moves;
        if (window.hkGlass && window.hkGlass.rendered) window.hkGlass.rendered(this);
        this._kitArm();
        if (sz === 'XXL') this._kitFetch(t);
        return ok;
      }
      // the second hand, once a second while it may move; otherwise the card is looked at once a minute. Nothing runs for a card that is not on
      // the screen (a page that is out of sight, a hidden tab): it wakes when it is seen
      _kitArm() {
        clearTimeout(this._kt);
        this._kt = null;
        if (!this.isConnected) return;
        var self = this, wait = this._kMoved ? 1000 - Date.now() % 1000 + 5 : 60000 - Date.now() % 60000 + 50;
        this._kt = setTimeout(function () { self._kt = null; self._kitStep(); }, wait);
        if (this._kIO || typeof IntersectionObserver !== 'function') return;
        this._kSeen = true;
        this._kIO = new IntersectionObserver(function (es) {
          var seen = es.some(function (e) { return e.isIntersecting; });
          if (seen && !self._kSeen) { self._kSeen = true; self._kitStep(); } else self._kSeen = seen;
        });
        this._kIO.observe(this);
      }
      _kitStep() {
        if (!this.isConnected || !this._kitOn()) return;
        var moves = this._kitMoves() && !!(this._config || {}).clock_style;
        if (this._kSeen === false) { this._kitArm(); return; }
        // a new minute, or the switches changed: drawn again; else only the second hand turns
        if (Math.floor(Date.now() / 60000) !== this._kMin || moves !== this._kMoved) { this._renderKit(); return; }
        var sh = this._root.querySelector('.sh'), s = new Date().getSeconds();
        if (moves && sh) {
          if (s < this._kS) this._kTurns = (this._kTurns || 0) + 1;
          this._kS = s;
          sh.style.transform = 'rotate(' + ((this._kTurns || 0) * 360 + s * 6) + 'deg)';
        }
        this._kitArm();
      }
      // THE MONTH AND THE DAY'S EVENTS (Double Extra Large), from the Calendar's own store (hkCalendar.load: one answer per calendar and range, shared
      // with the Calendar blocks): drawn with what has come, again when it does
      _kitCal(t, k) {
        var evs = this._kEvs || [], now = t.d, today = new Date(t.year, t.month - 1, t.day), WS = 0, self = this;
        try { WS = window.hkStats && window.hkStats.weekStart ? window.hkStats.weekStart(this.client) || 0 : 0; } catch (e) { WS = 0; }
        var first = new Date(t.year, t.month - 1, 1), n = new Date(t.year, t.month, 0).getDate(), lead = (first.getDay() - WS + 7) % 7;
        var letters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], dows = letters.slice(WS).concat(letters.slice(0, WS));
        var ends = [0, 6].map(function (i) { return (i - WS + 7) % 7; });
        var rgb = function (e) {
          var HS = window.hkSettings, st = (self.client && self.client.states) || {}, hue = (C.PALETTE && C.PALETTE.chart) || {}, key = 'orange';
          try { key = HS && HS.eventColor ? HS.eventColor(e.cal, e.title, e.uid, st) : HS && HS.calendarColor ? HS.calendarColor(e.cal, st) : 'orange'; } catch (er) { key = 'orange'; }
          var c = key === 'white' ? [255, 255, 255] : hue[key];
          return 'rgb(' + (c && c.length === 3 ? c : [255, 159, 10]).join(',') + ')';
        };
        var day0 = function (y, m, dd) { return new Date(y, m, dd); }, dots = {};
        for (var dn = 1; dn <= n; dn++) {
          var a = day0(t.year, t.month - 1, dn), b = day0(t.year, t.month - 1, dn + 1), cs = [];
          // a day's own events: what starts on it or lasts no longer than it (not a month-long all-day event passing through)
          evs.forEach(function (e) {
            if (e.start < b && e.end > a && ((e.start >= a) || (e.end - e.start) <= 864e5)) { var c = rgb(e); if (cs.indexOf(c) < 0) cs.push(c); }
          });
          if (cs.length) dots[dn] = cs.slice(0, 3);
        }
        var upcoming = evs.filter(function (e) { return e.end > now; }), time = function (e) {
          try { return new Intl.DateTimeFormat(t.tag, e.start.getMinutes() || self._h24() ? { hour: 'numeric', minute: '2-digit', hour12: !self._h24() } : { hour: 'numeric', hour12: true }).format(
            e.start); } catch (er) { return ''; }
        };
        var tomorrow = new Date(t.year, t.month - 1, t.day + 1), when = function (e) {
          var s0 = new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate()), same = s0 <= today && e.end > today;
          var clock = e.allDay ? 'All day' : time(e), name = same ? '' : +s0 === +tomorrow ? 'Tomorrow' : new Intl.DateTimeFormat(t.tag, { weekday: 'short' }).format(e.start);
          return same || (e.allDay && !name) ? clock : name + (e.allDay ? '' : ', ' + clock);
        };
        var inToday = upcoming.filter(function (e) { return e.start < tomorrow; }).length, rows = Math.floor((k.h - 52 - 6) / 60), shown = upcoming.slice(0, rows);
        return { name: t.monthName, title: inToday ? 'Today' : 'Upcoming', more: Math.max(0, upcoming.length - shown.length),
                 empty: this._kLoaded ? 'Nothing scheduled' : '', month: { lead: lead, n: n, today: t.day, dots: dots, dows: dows, ends: ends, big: !(this._config || {}).clock_style },
                 events: shown.map(function (e) { return { color: rgb(e), t: e.title, b: when(e), day: ymdOf(e.start) }; }) };
      }
      // what the month and the list read: every calendar's events, the month's weeks and the week ahead, asked for again every five minutes
      _kitFetch(t) {
        var CAL = window.hkCalendar, self = this, h = this.client;
        if (!CAL) {
          // (the Calendar's code is a lazy file on Mantel: asked for by name, then drawn again)
          if (window.hkNeed && window.hkNeed.file && !this._kNeed) {
            this._kNeed = true;
            Promise.resolve(window.hkNeed.file('hk-calendar.js')).then(function () { self._kNeed = false; if (window.hkCalendar && self.isConnected) self._kitFetch(self._kitTime()); },
              function () { self._kNeed = false; });
          }
          return;
        }
        if (!h || (this._kAt && Date.now() - this._kAt < 300000 && this._kMon === t.month)) return;
        var ids = CAL.ids(h), from = new Date(t.year, t.month - 1, 1), WS = 0;
        try { WS = window.hkStats && window.hkStats.weekStart ? window.hkStats.weekStart(h) || 0 : 0; } catch (e) { WS = 0; }
        from = new Date(from.getFullYear(), from.getMonth(), 1 - ((from.getDay() - WS + 7) % 7));
        var to = new Date(Math.max(+new Date(from.getFullYear(), from.getMonth(), from.getDate() + 42), +new Date(t.year, t.month - 1, t.day + 8)));
        this._kAt = Date.now(); this._kMon = t.month;
        if (!ids.length) { this._kEvs = []; this._kLoaded = true; return; }
        CAL.load(h, ids, from, to).then(function (got) {
          self._kEvs = got.evs; self._kLoaded = true;
          if (self.isConnected && self._kitOn()) self._renderKit();
        });
        if (!this._kOn) {
          this._kOn = function () { self._kAt = 0; if (self.isConnected) self._kitFetch(self._kitTime()); };
          window.addEventListener('hk-calendar-changed', this._kOn);
        }
      }
      // a day of the month or an event: that day on the Calendar page
      _kitGo(day) {
        var dash = '/' + (String(location.pathname).split('/')[1] || '') + '/';
        if (window.hkCards && window.hkCards.navigate) window.hkCards.navigate(dash + 'calendar' + (day ? '?day=' + day : ''), this);
      }
      // the weekday, the date and the time beside or under a dial, kept to the minute
      _tick(ck) {
        var self = this, set = function (sel, t) { var e = ck.querySelector(sel); if (e && e.textContent !== t) e.textContent = t; };
        var go = function () {
          if (!ck.isConnected) return;
          // the house's time, in the screen's locale: its zone (hkStats.tz, the Energy page's), its clock (12 or 24 hours)
          var L = window.hkLocale, S = window.hkStats, d = new Date(), tag, zone;
          try { tag = L && L.tag ? L.tag() : undefined; zone = S && S.tz ? S.tz() : undefined; } catch (e) { tag = undefined; zone = undefined; }
          var f = function (o) { try { return new Intl.DateTimeFormat(tag, Object.assign({ timeZone: zone }, o)).format(d); } catch (e) { return new Intl.DateTimeFormat(tag, o).format(d); } };
          set('.d1', f({ weekday: 'long' })); set('.d2', f({ month: 'long', day: 'numeric' }));
          set('.d3', f({ hour: 'numeric', minute: '2-digit', hour12: !self._h24() }));
        };
        this._go = go; go();
        clearInterval(this._tk);
        this._tk = setInterval(go, 15000);
      }
      // THE FACE FILLS ITS BLOCK (2026-10-24, the owner on the nightstand
      // layouts: StandBy's digits fill the screen). A face is sized for a
      // whole screen -- its time a third of the height -- so in a block it
      // is scaled until its drawing reaches the block's edges, less a margin
      // (more inside the box) -- up, or down when a face sized by the block's
      // height is wider than a Tall block. Measured again as the block
      // resizes and once the face's fonts are in.
      // (Analog Numbers bare fills its block to the edge of its disc, as HomeView's does)
      _fillWatch(box, bare, style, split) {
        var root = box.querySelector('.ckroot'), self = this;
        if (!root) return;
        var fill = function () {
          root.style.transform = '';
          var b = box.getBoundingClientRect(), face = root.querySelector('.face'), l = Infinity, t = Infinity, r = -Infinity, btm = -Infinity;
          if (!face || !b.width || !b.height) return;
          face.querySelectorAll('*').forEach(function (e) {
            var q = e.getBoundingClientRect();
            if (!q.width || !q.height || q.width >= b.width * 0.999 && q.height >= b.height * 0.999) return;
            l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); btm = Math.max(btm, q.bottom);
          });
          if (!(r > l && btm > t)) return;
          var m = split ? 0.98 : bare ? (style === 'numbers' ? 1 : 0.92) : 0.8, k = Math.min(b.width * m / (r - l), b.height * m / (btm - t), 3);
          // centred on the drawing's own middle, not the block's
          var dx = (b.left + b.width / 2) - (l + r) / 2, dy = (b.top + b.height / 2) - (t + btm) / 2;
          if (Math.abs(k - 1) > 0.02) root.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + k.toFixed(3) + ')';
        };
        root.style.transformOrigin = '50% 50%';
        if (this._fillRO) this._fillRO.disconnect();
        if (typeof ResizeObserver !== 'undefined') { this._fillRO = new ResizeObserver(function () { fill(); }); this._fillRO.observe(box); }
        [60, 700, 2500].forEach(function (ms) { setTimeout(function () { if (self._face) fill(); }, ms); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fill);
      }
      // back on the page (the view host takes a view out and puts it back): the face it let go of is drawn again;
      // nothing else redraws a card whose state did not change, so the block stayed empty
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this._config && !this._built) this.redraw();
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._face) { try { this._face.destroy(); } catch (e) { /* gone */ } this._face = null; }
        if (this._fillRO) { this._fillRO.disconnect(); this._fillRO = null; }
        clearInterval(this._tk); this._tk = null;
        clearTimeout(this._kt); this._kt = null;
        if (this._kIO) { this._kIO.disconnect(); this._kIO = null; }
        if (this._kOn) { window.removeEventListener('hk-calendar-changed', this._kOn); this._kOn = null; }
        this._built = false; this._run = (this._run || 0) + 1;
      }
    }

    // ===================================================== hk-grid-cameras-card
    // THE CAMERAS FACE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase G):
    // the cameras named, else every camera in Cameras' order, up to nine at
    // once in the block's arrangement (camGrid). The stills are the camera
    // strip's own (hk-cameras.js, its `grid` layout): double-buffered, each
    // at its tile's size every `refresh` s and only while on screen, never
    // under the screensaver. A tap opens that camera live (its camera sheet).
    // ONE LIVE FEED AT A TIME (a tablet decodes one well; nine never connect:
    // hk-cameras.js): the face opens none of its own but the doorbell's tile
    // while it rings -- for RING_MS, and never under a sheet, the camera
    // sheet's being the one then.
    var RING_MS = 60000;
    // ...and of two faces on one screen, the first to hear the ring has it
    var camLive = null;
    var CAMS_CSS = ':host{display:block;height:100%}.cams{height:100%}.cams > *{display:block;height:100%}';
    class HkGridCamerasCard extends HkGridFull {
      static get CSS() { return CAMS_CSS; }
      getCardSize() { return 6; }
      _size() { var s = this.getAttribute && this.getAttribute('size'); return CAM_MAX[s] || s === 'F' ? s : 'XL'; }
      // its cameras: those the house has (a removed one leaves no hole)
      _ids() {
        var st = (this.client && this.client.states) || {};
        return (this._config.cameras || []).filter(function (id) { return !!st[id]; });
      }
      // (Full: the view's columns, from its cell -- 2 on a phone)
      _cols() {
        try { return parseFloat(getComputedStyle(this).getPropertyValue('--hk-span-c')) || 0; } catch (e) { return 0; }
      }
      _arrange(n) { var b = this._block(); return camGrid(this._size(), n, b && b.w, b && b.h, this._cols()); }
      _live(ids) {
        var P = window.hkSettings, id;
        if (!this._ringing || (window.hkPopupCover || 0) > 0) return null;
        if (P && P.rendering && !P.rendering().autoplay) return null;     // (a tablet that plays no video)
        if (camLive && camLive !== this && camLive.isConnected !== false && camLive._ringing) return null;
        id = camRing(ids, this._ringing === true ? null : this._ringing);
        if (id) camLive = this;
        return id;
      }
      _cfg() {
        var ids = this._ids(), g = this._arrange(ids.length), shown = ids.slice(0, g[0] * g[1]), live = this._live(shown);
        return Object.assign({ type: 'custom:hk-camera-mosaic-card', own_cameras: true, grid: g, seam: CAM_GAP, show_age: false,
                               refresh: this._config.refresh || 10, cameras: shown.map(function (id) { return { entity: id }; }) },
                             live ? { live: live } : {});
      }
      _sigOf() { return JSON.stringify([this._ids(), this._size(), this._blockKey || '', this._ringing || '', (window.hkPopupCover || 0) > 0]); }
      // a new box for what it shows (the mosaic, or the stand-in)
      _box() {
        var box = document.createElement('div');
        box.className = 'cams';
        this._root.textContent = '';
        this._root.appendChild(box);
        this._kids = [];
        return box;
      }
      _render() {
        if (!this.client) return;                      // (which cameras the house has: not known yet)
        this._watchBlock();
        var cfg = this._cfg(), key = JSON.stringify(cfg);
        if (!cfg.cameras.length) {
          // (none of its cameras in the house: the catalog's stand-in, as a block with nothing to show)
          if (this._key === '') return;
          this._key = ''; this._mosaic = null;
          this._mount(this._box(), { type: 'custom:hk-key-card', name: 'Cameras', icon: 'hk:camera' });
          return;
        }
        if (this._mosaic && this._key === key) return;
        this._key = key;
        if (this._mosaic) {
          if (this._mosaic.getAttribute('size') !== this._size()) this._mosaic.setAttribute('size', this._size());
          this._mosaic.setConfig(cfg);
          return;
        }
        this._mosaic = this._mount(this._box(), cfg, this._size());
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        if (!this._onRing) {
          // A RING: the doorbell's tile live for a minute (a later ring, a minute from then)
          this._onRing = function (e) {
            var n = e && e.detail;
            if (!n || n.type !== 'notification' || n.kind !== 'doorbell') return;
            self._ringing = n.camera || true;
            clearTimeout(self._ringT);
            self._ringT = setTimeout(function () { self._ringing = null; if (camLive === self) camLive = null; self.redraw(); }, RING_MS);
            self.redraw();
          };
          // a sheet opening takes the live tile back to its still; closing gives it back
          this._onCover = function () { if (self._ringing) self.redraw(); };
        }
        window.addEventListener('hk-house-event', this._onRing);
        window.addEventListener('hk-popup-change', this._onCover);
      }
      disconnectedCallback() {
        window.removeEventListener('hk-house-event', this._onRing);
        window.removeEventListener('hk-popup-change', this._onCover);
        clearTimeout(this._ringT);
        this._ringing = null;
        if (camLive === this) camLive = null;
        if (super.disconnectedCallback) super.disconnectedCallback();
      }
    }

    // what the shell and the later parts use of this one
    K.HkGridCamerasCard = HkGridCamerasCard; K.HkGridClockCard = HkGridClockCard;
  };
})();
