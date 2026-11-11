// hk-home-timers.js - the running timers grid and the new timer card.
//
// PART OF THE HOME CARDS (hk-home.js). Not a card and not run on its own: it registers one
// function, which hk-home.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkHomeParts = window.hkHomeParts || {})['hk-home-timers'] = function (K) {
    var button = K.button, C = K.C, esc = K.esc, HkBase = K.HkBase, M = K.M, NO_HELPERS = K.NO_HELPERS,
        SELECTED_BG = K.SELECTED_BG, SELECTED_TEXT = K.SELECTED_TEXT;

    // =========================================================== timers grid
    // The whole "Running" section of the Timers page: every timer that is
    // counting, one card each, plus the empty state when none are.
    //
    // WHY ONE CARD. A Lovelace view is a static list of cards, so "one card
    // per running timer" can only be spelled there as "one card per POSSIBLE
    // timer, each in its own `type: conditional`, hidden" -- thousands of
    // lines of YAML for a house with many timers. The list of timers lives
    // here as config instead, and the card draws the ones that are running.
    //
    // THE COUNTDOWN IS STILL hk-timers.js AND MUST BE. That module owns
    // <hk-countdown>, which repaints itself off a deadline four times a second
    // and hands the fraction back to its parent as --hk-left for the progress
    // bar. None of that is state a card re-render can produce -- the client reports a
    // running timer changing exactly twice, at start and at finish -- so this
    // card calls hkTimers.html() for the countdown row, and the module's
    // markup lands in this shadow root.
    //
    // RE-RENDER DISCIPLINE IS THE ONE HAZARD. each new client arrives on every state
    // change in the house, and rebuilding this grid on each one would tear down
    // and recreate every <hk-countdown> several times a second -- each one
    // restarting its paint and flashing --hk-left back to the 1 fallback, so the
    // bars would jitter. So _sig() reduces the timers this card actually draws to
    // one string and _render() returns early when it has not moved.
    //
    // THE EMPTY STATE READS NO SENSOR. A `type: conditional` can only test an
    // entity; this card can just look at the timers it was given. The page's
    // own list IS the page's condition, so the two cannot disagree.
    class HkTimersCard extends HkBase {
      static get CSS() {
        return [
          // 388, not 400: layout-card gives every grid child a 4px side margin
          // that no config removes, so three 400px cards need 1248 of a 1280
          // tablet page's 1229 and only two fit (measured). The number is about
          // the page width, not about nesting.
          // 10 apart, as every card on the page (hk-base TILE.gridGap)
          '.grid{display:grid;grid-template-columns:repeat(auto-fill,388px);  grid-auto-rows:196px;column-gap:' + window.hkCards.TILE.gridGap + 'px;row-gap:' + window.hkCards.TILE.gridGap +
            'px;margin:0 0 14px 0}',
          // 196 exactly: 52 (head) + 48 (countdown and its bar, which
          // hkTimers.html emits as ONE wrapper and so occupies one row) + 52
          // (buttons) + two 12px gaps + 32 of padding.
          '.tc{height:196px;padding:16px 18px;border-radius:' + M.radius + ';  ' + M.glass + ';border:' + M.border + ';  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-lg') +
            ');',
          '  display:grid;column-gap:12px;row-gap:12px;align-items:center;  grid-template-columns:repeat(4,minmax(0,1fr));  grid-template-rows:52px minmax(0,1fr) 52px;',
          '  grid-template-areas:"head head head head" "count count count count"                     "pause restart plus finish"}',
          '.tc > .head{grid-area:head;justify-self:stretch;min-width:0;overflow:hidden}',
          '.tc > .count{grid-area:count;justify-self:stretch;align-self:center;min-width:0}',
          // The four controls, with an
          // explicit 21px icon row -- an <hk-icon> has no intrinsic height, so a
          // min-content row collapses it to nothing and the buttons render as
          // bare captions. The caption row CAN be min-content; text sizes itself.
          '.tb{height:52px;border-radius:18px;background:' + window.hkCards.v('key') +
            ';  border:none;box-shadow:none;padding:0;justify-self:stretch;  display:grid;grid-template-columns:minmax(0,1fr);',
          '  grid-template-rows:21px min-content;align-content:center;  justify-items:center;row-gap:3px;cursor:pointer;user-select:none}',
          '.tb hk-icon{--mdc-icon-size:19px;width:19px;height:19px;  color:' + window.hkCards.v('glyph') + '}',
          '.tb > span{font-size:11px;font-weight:600;letter-spacing:0.1px;  line-height:1;color:' + window.hkCards.v('ink-2') + '}',
          // The empty state is a LINE OF TEXT, not a card. A full-width glass
          // plate with one grey sentence in it looks out of place: a plate is
          // this frontend's shape for a THING YOU CAN TOUCH, and there is nothing
          // here to touch. Sitting the sentence directly under the heading says
          // "this section is empty" without pretending to be a control.
          '.empty{padding:2px 4px 14px 4px;font-size:15px;font-weight:500;  letter-spacing:-0.2px;color:' + window.hkCards.v('ink-3') + '}',
          // PHONE. The 388px track above is a TABLET number -- it is the page
          // width divided by three, and `auto-fill` with a fixed track cannot
          // shrink below it, so at 402px it would lay one 388px card into ~354px
          // of room and the cards would run off the right edge. One full-width column
          // instead; the card's own four control tracks are already
          // `minmax(0,1fr)` and divide whatever they are given (~70px each at
          // 402px, against 52px tall buttons, which is fine).
          '@media (max-width:' + window.hkCards.BP.phone + 'px){  .grid{grid-template-columns:minmax(0,1fr)}',
          '}',
          // ------------------------------------------------ FIT (the Timers page)
          // `fit: true` -- the card fills the running column of the one-page
          // Timers layout (hk-timers-page-card) and the COUNT decides the shape:
          //   1-2 running   the full card, two across
          //   3-4 running   the compact card, two across
          //   5-6 running   the compact card, three across
          //   7 or more     pages of six, swiped sideways, with dots
          // so the running column never grows past two rows and the House
          // timers under it keep their place beside the keypad.
          '.grid.fit{grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));grid-auto-rows:auto;margin:0}',
          // THE COMPACT CARD: the same four rows, smaller -- a 40 px well, the
          // countdown, and the four controls as icons (the caption goes; the
          // glyphs are the ones the full card labels). 164 = 12 + 40 + 8 + 44
          // (the countdown and its bar) + 8 + 40 + 12 -- two rows of it and the
          // House timers fit beside the keypad panel with the bottoms level.
          '.tc.cp{height:164px;padding:12px 16px;row-gap:8px;grid-template-rows:40px minmax(0,1fr) 40px}',
          '.tc.cp .tb{height:40px;border-radius:13px;grid-template-rows:21px}',
          '.tc.cp .tb > span{display:none}',
          // PAGES. A sideways scroll-snap row, one page per viewport, padded all
          // round so the cards' shadows are not cut at its edges (the row's
          // negative margin puts the cards back where a grid would have them),
          // and 32 px apart so the next page never shows in that padding.
          '.pages{display:grid;grid-auto-flow:column;grid-auto-columns:100%;column-gap:32px;  overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-padding:0 16px;',
          '  padding:16px;margin:-16px;overscroll-behavior-x:contain;scrollbar-width:none;  -webkit-overflow-scrolling:touch}',
          '.pages::-webkit-scrollbar{display:none;width:0;height:0}',
          // its own formatting context, so the row's negative margin is taken
          // back inside it -- as a plain child it escapes, and the card comes
          // out 16 px taller than its two rows
          '.pw{display:flow-root}',
          '.page{scroll-snap-align:start;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));  grid-template-rows:repeat(2,164px);gap:12px;align-content:start}',
          // THE HEADING IS THIS CARD'S in `fit` (config `heading`), so the dots
          // sit at the right of it: pages cost no height, and the House timers
          // under the grid stay level with the keypad however many there are.
          '.hrow{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
          // The dots: 24 px targets around an 8 px dot. Swiping is the way;
          // a dot is a jump to that page.
          '.dots{display:flex;justify-content:flex-end;gap:2px;height:24px;margin-top:5px}',
          '.dots button{all:unset;width:24px;height:24px;display:flex;align-items:center;  justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
          '.dots i{width:8px;height:8px;border-radius:4px;background:' + window.hkCards.v('ink-3') + ';  transition:background-color .2s ease}',
          '.dots button[aria-current="true"] i{background:' + window.hkCards.v('ink') + '}',
          // PHONE: one column and no sideways pages -- the page itself scrolls,
          // so every running timer is simply the next card down.
          '@media (max-width:' + window.hkCards.BP.phone + 'px){  .grid.fit{grid-template-columns:minmax(0,1fr)}  .pages{display:block;overflow:visible;padding:0;margin:0}  .pw{display:block}',
          '  .page{grid-template-columns:minmax(0,1fr);grid-template-rows:none;grid-auto-rows:164px;margin:0 0 12px}  .page:last-child{margin-bottom:0}',
          '  .dots{display:none}',
          '}',
          '@media (prefers-reduced-motion: reduce){.dots i{transition:none}}'
        ].join('');
      }

      _onConfig() { this._sig = null; this._page = 0; }

      _list() { var T = window.hkTimers, c = this._config.timers || []; return T && T.withMade ? T.withMade(c, this.client && this.client.states) : c; }
      // (Flat Light's lit color, Apple's light orange, as every lit well's:
      // hk-base flatColor; unchanged in the other looks)
      _tint() { return window.hkCards.flatColor(this._config.tint || 'rgba(255, 159, 10, 0.95)', 'well'); }

      // Only the timers that are counting, in configured order. `paused` is
      // included: a paused timer is still something you are steering.
      _running() {
        var self = this;
        return this._list().filter(function (t) {
          var st = self._st(t.entity);
          return st && (st.state === 'active' || st.state === 'paused');
        });
      }

      // Everything a redraw could possibly change, in one string. `finishes_at`
      // is what moves when a timer is started, paused or extended; `remaining` is
      // the truth on a paused one; `duration` drives the sub-line and Restart.
      _sigOf() {
        var self = this;
        return this._list().map(function (t) {
          var st = self._st(t.entity);
          if (!st) { return t.entity + '|-'; }
          var a = st.attributes || {};
          var nm = t.label_entity ? (self._st(t.label_entity) || {}).state : '';
          return [t.entity, st.state, a.finishes_at || '', a.remaining || '',
                  a.duration || '', nm || ''].join('|');
        }).join(';') + (window.hkTimers ? ';M' : ';-');
      }

      _boot() {
        // A BACKSTOP. hk-loader.js imports hk-timers.js on every page, but the
        // imports run in parallel with the cards, so a timer card can render
        // first -- and a page could be missing the loader. So the first render
        // pulls it in if it is not there yet; hk-timers.js ignores a second load.
        // A <script> tag rather than import(): this file is a classic script.
        if (window.hkTimers || window.__hkTimersBooting) { return; }
        window.__hkTimersBooting = true;
        var s = document.createElement('script');
        s.src = '/hk/modules/hk-timers.js';
        s.onload = function () {
          window.dispatchEvent(new Event('hk-timers-ready'));
        };
        s.onerror = function () {
          window.__hkTimersBooting = false;      // let the next render retry
          console.error('[hk-timers] could not load /hk/modules/hk-timers.js');
        };
        document.head.appendChild(s);
        if (!this.__wired) {
          this.__wired = true;
          var self = this;
          window.addEventListener('hk-timers-ready', function once() {
            window.removeEventListener('hk-timers-ready', once);
            self._sig = null;                    // force the next render through
            self._render();
          });
        }
      }

      // NOT named _call -- see hk-security.js _alarm(): shadowing HkBase._call
      // would make this recurse forever and pause/resume/cancel do nothing.
      _timer(entity, service, data) {
        if (!this.client) { return; }
        var d = Object.assign({ entity_id: entity }, data || {});
        this._call('timer', service, d);
      }

      // Seconds left, right now. finishes_at is the ONLY live source on an active
      // timer: `remaining` is frozen at the value it had when the timer started
      // (measured -- a 2-minute timer reported 0:02:00 at t+3s, t+25s and t+45s
      // while the truth ticked 116 -> 96 -> 76). On a PAUSED timer there is no
      // deadline and `remaining` is the truth. hk-timers.js act() does the
      // identical calculation for the pop-up pills; keep the two in step.
      _left(st) {
        var a = (st && st.attributes) || {};
        if (st && st.state === 'active' && a.finishes_at) {
          var end = Date.parse(a.finishes_at);
          if (!isNaN(end)) { return Math.max(0, (end - Date.now()) / 1000); }
        }
        return window.hkTimers ? window.hkTimers.secs(a.remaining) : 0;
      }

      _hms(t) {
        var p = function (n) { return String(n).padStart(2, '0'); };
        return Math.floor(t / 3600) + ':' + p(Math.floor((t % 3600) / 60)) +
               ':' + p(t % 60);
      }

      _btn(area, icon, label, fn) {
        var d = document.createElement('div');
        d.className = 'tb';
        d.style.gridArea = area;
        button(d, fn);
        var i = document.createElement('hk-icon'); i.setAttribute('icon', icon);
        var s = document.createElement('span'); s.textContent = label;
        d.appendChild(i); d.appendChild(s);
        return d;
      }

      // The head: well, name, sub-line. One flex row rather than two grid cells,
      // because the button row below needs four EQUAL tracks and an icon column
      // would have forced the buttons to span unevenly.
      _head(t, st, compact) {
        var tint = this._tint();
        var s = st.state;
        // Filled well while RUNNING, hollow otherwise -- the same grammar as
        // the vacuum card. Colour means "this is happening now", and
        // a paused timer is deliberately not shouting.
        var liveNow = s === 'active';
        var bg = liveNow ? tint : '' + window.hkCards.v('key-strong') + '';
        // (Flat: a white glyph in a colored lit well, as on every tile --
        // DESIGN.md; the other looks keep the vacuum card's dark one)
        var S = window.hkSettings, flat = !!(S && S.rendering && S.rendering().flat);
        var fg = liveNow ? (flat ? '#fff' : 'rgba(0,0,0,0.82)') : 'var(--hk-glyph,rgba(255,255,255,0.80))';
        var px = t.glyph_px || '28px';
        // the compact card's 40 px well: the glyph scales with it
        var well = compact ? 40 : 52;
        if (compact) { px = Math.round(parseFloat(px) * 40 / 52) + 'px'; }
        // The name, in priority order: the live label helper if this timer has
        // one AND it holds something real, then the configured fallback, then the
        // entity's friendly name. `unknown` is the case that matters -- an
        // input_text never written reads that, not empty.
        var raw = t.label_entity ? ((this._st(t.label_entity) || {}).state || '') : '';
        var given = ['', 'unknown', 'unavailable'].indexOf(String(raw).trim()) >= 0
          ? '' : String(raw).trim();
        var n = given || t.label || (st.attributes || {}).friendly_name || '';
        // The sub-line is the SET duration, not the remaining one -- the
        // countdown below already owns "remaining". "1 hr" beside a running
        // 0:47:12 says how far through you are, which the countdown cannot.
        var T = window.hkTimers;
        var dur = T ? T.pretty((st.attributes || {}).duration) : '';
        var word = s === 'active' ? 'Running' : s === 'paused' ? 'Paused' : 'Ready';
        var sub = dur ? word + ' · ' + dur : word;

        var d = document.createElement('div');
        d.className = 'head';
        d.innerHTML =
          '<div style="display:flex;align-items:center;gap:12px;min-width:0;">' +
            '<div style="flex:0 0 auto;width:' + well + 'px;height:' + well + 'px;border-radius:' + (well / 2) + 'px;' +
              'background:' + bg + ';display:flex;align-items:center;' +
              'justify-content:center;">' +
              '<hk-icon icon="' + esc(t.glyph || 'mdi:timer-outline') + '" ' +
                'style="--mdc-icon-size:' + esc(px) + ';color:' + fg + ';">' +
              '</hk-icon></div>' +
            '<div style="min-width:0;text-align:left;">' +
              '<div style="font-size:17px;font-weight:600;letter-spacing:-0.45px;' +
                'color:' + window.hkCards.v('ink') + ';line-height:1.25;overflow:hidden;' +
                'text-overflow:ellipsis;white-space:nowrap;">' + esc(n) + '</div>' +
              '<div style="font-size:13px;font-weight:500;letter-spacing:-0.1px;' +
                'color:' + window.hkCards.v('ink-2') + ';line-height:1.3;">' + esc(sub) + '</div>' +
            '</div></div>';
        return d;
      }

      _card(t, st, compact) {
        var self = this;
        var e = t.entity;
        var c = document.createElement('div');
        c.className = compact ? 'tc cp' : 'tc';
        // ITS NAME OPENS ITS SHEET (the timer sheet, hk-headers.js): the four
        // controls below keep their own taps
        var hd = this._head(t, st, compact);
        hd.style.cursor = 'pointer';
        button(hd, function () {
          window.hkShell.moreInfo(e, self);
        });
        hd.setAttribute('aria-label', 'Open ' + (hd.textContent || 'timer'));
        c.appendChild(hd);

        var count = document.createElement('div');
        count.className = 'count';
        var T = window.hkTimers;
        // No module, or nothing to count: a dash and an empty bar slot, holding
        // the row's height so the four buttons do not jump up a line the moment a
        // timer finishes. A card that changes height reflows every card after it.
        var blank = '<div style="text-align:left;"><div style="font-size:30px;' +
          'font-weight:300;letter-spacing:-0.8px;line-height:1;' +
          'color:' + window.hkCards.v('ink-3') + ';">&mdash;</div>' +
          '<div style="margin-top:10px;height:4px;"></div></div>';
        count.innerHTML = (T && T.html(st.attributes, { fill: this._tint() })) || blank;
        c.appendChild(count);

        // 1. Start / Pause / Resume. One key does all three: timer.start resumes
        //    a paused timer and runs an idle one at its configured duration, so
        //    only the ACTIVE case needs the other service.
        var s = st.state;
        c.appendChild(this._btn('pause',
          s === 'active' ? 'mdi:pause' : 'mdi:play',
          s === 'active' ? 'Pause' : s === 'paused' ? 'Resume' : 'Start',
          function () { self._timer(e, s === 'active' ? 'pause' : 'start'); }));

        // 2. Restart. `duration` is the last STARTED duration, not the one in
        //    YAML, so this restarts at whatever the timer is currently set to.
        //    Passing no duration would be a no-op on an active timer, not a
        //    restart.
        c.appendChild(this._btn('restart', 'mdi:restart', 'Restart', function () {
          self._timer(e, 'start', {
            duration: (st.attributes || {}).duration || '0:00:00'
          });
        }));

        // 3. +5 min. There is no service that ADDS time, and timer.start with a
        //    duration restarts at that duration -- so the extension is expressed
        //    as an absolute new length computed from the live remaining. Read
        //    _left() for why that cannot come from the `remaining` attribute.
        c.appendChild(this._btn('plus', 'mdi:plus', '5 min', function () {
          var live = self._st(e) || st;
          self._timer(e, 'start', {
            duration: self._hms(Math.round(self._left(live)) + 300)
          });
        }));

        // 4. Finish, not Cancel. timer.finish FIRES the finished event, so
        //    whatever the timer was for actually happens -- which is what an
        //    automation listening for it expects. Cancel ends silently, and two
        //    buttons that look alike and differ only in whether the rest of the
        //    house reacts is a trap.
        c.appendChild(this._btn('finish', 'mdi:check', 'Finish', function () {
          self._timer(e, 'finish');
        }));
        return c;
      }

      _render() {
        if (!this._config) { return; }
        this._boot();
        var sig = this._sigOf();
        if (sig === this._sig) { return; }        // see the class comment
        this._sig = sig;

        var running = this._running();
        if (this._config.fit) { this._renderFit(running); return; }
        this._root.innerHTML = '';
        var grid = document.createElement('div');
        grid.className = 'grid';
        for (var i = 0; i < running.length; i++) {
          var t = running[i];
          grid.appendChild(this._card(t, this._st(t.entity)));
        }
        // Only mount the grid when it has something in it. Empty, its 14px
        // bottom margin would push the empty line down as if a row were there.
        if (running.length) { this._root.appendChild(grid); }
        if (!running.length) {
          var e = document.createElement('div');
          e.className = 'empty';
          e.textContent = this._config.empty_text ||
                          'Nothing is running. Set one above.';
          this._root.appendChild(e);
        }
      }
      // THE SHAPE FOR THIS MANY -- see `fit` in the CSS. Exposed for the tests.
      static shape(n) {
        if (n <= 2) return { compact: false, cols: 2, per: 2 };
        if (n <= 4) return { compact: true, cols: 2, per: 4 };
        return { compact: true, cols: 3, per: 6 };
      }

      _renderFit(running) {
        var self = this, n = running.length, sh = HkTimersCard.shape(n);
        var keep = this._page || 0;
        this._root.innerHTML = '';
        this._pages = null; this._dots = null;
        var hrow = null;
        if (this._config.heading) {
          hrow = document.createElement('div'); hrow.className = 'hrow';
          var hd = document.createElement('div'); hd.className = 'head'; hd.textContent = this._config.heading;
          hrow.appendChild(hd);
          this._root.appendChild(hrow);
        }
        if (!n) {
          var e = document.createElement('div');
          e.className = 'empty';
          e.textContent = this._config.empty_text || 'Nothing is running.';
          this._root.appendChild(e);
          return;
        }
        if (n <= 6) {
          var grid = document.createElement('div');
          grid.className = 'grid fit';
          grid.style.setProperty('--cols', String(sh.cols));
          running.forEach(function (t) { grid.appendChild(self._card(t, self._st(t.entity), sh.compact)); });
          this._root.appendChild(grid);
          this._page = 0;
          return;
        }
        // SEVEN OR MORE: pages of six, three across and two down.
        var pages = document.createElement('div');
        pages.className = 'pages';
        var count = Math.ceil(n / 6);
        // THE PAGES BY REFERENCE, not pages.children: hk-glass puts the row's
        // shared blur layer INSIDE the row (it scrolls with it), so the first
        // child is not always the first page.
        this._pageEls = [];
        for (var p = 0; p < count; p++) {
          var pg = document.createElement('div');
          pg.className = 'page';
          this._pageEls.push(pg);
          running.slice(p * 6, p * 6 + 6).forEach(function (t) {
            pg.appendChild(self._card(t, self._st(t.entity), true));
          });
          pages.appendChild(pg);
        }
        var dots = document.createElement('div');
        dots.className = 'dots';
        dots.setAttribute('role', 'tablist');
        for (var d = 0; d < count; d++) {
          (function (i) {
            var b = document.createElement('button');
            b.setAttribute('aria-label', 'Timers page ' + (i + 1) + ' of ' + count);
            b.appendChild(document.createElement('i'));
            b.addEventListener('click', function () { self._goPage(i, true); });
            dots.appendChild(b);
          })(d);
        }
        pages.addEventListener('scroll', function () {
          var i = self._pageAt();
          if (i !== self._page) { self._page = i; self._paintDots(); }
        }, { passive: true });
        var pw = document.createElement('div'); pw.className = 'pw';
        pw.appendChild(pages);
        this._root.appendChild(pw);
        (hrow || this._root).appendChild(dots);
        this._pages = pages; this._dots = dots;
        // A redraw (a timer started, paused or finished) keeps the page you
        // were on -- or the last one, if it has gone.
        this._page = Math.min(keep, count - 1);
        this._paintDots();
        // Now (the row is laid out as soon as it is attached) and again on the
        // next frame, in case the page was not yet laid out.
        var restore = function () { self._goPage(self._page, false); };
        restore();
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
      }
      // A page's left edge, relative to the first page's.
      _pageLeft(i) {
        var k = this._pages && this._pageEls;
        if (!k || !k[i] || !k[0] || !k[i].getBoundingClientRect) return 0;
        // exact, not offsetLeft's whole pixels: a page is 764.8 px wide here
        return k[i].getBoundingClientRect().left - k[0].getBoundingClientRect().left;
      }
      _pageAt() {
        var k = this._pages && this._pageEls, x = this._pages ? this._pages.scrollLeft : 0, best = 0;
        if (!k) return 0;
        for (var i = 1; i < k.length; i++) {
          if (Math.abs(this._pageLeft(i) - x) < Math.abs(this._pageLeft(best) - x)) best = i;
        }
        return best;
      }
      _goPage(i, smooth) {
        if (!this._pages) return;
        this._page = i;
        var left = this._pageLeft(i);
        if (smooth && !(window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) && this._pages.scrollTo) this._pages.scrollTo({ left: left, behavior: 'smooth' });
        else this._pages.scrollLeft = left;
        this._paintDots();
      }
      _paintDots() {
        if (!this._dots) return;
        var cur = this._page;
        Array.prototype.forEach.call(this._dots.children, function (b, i) {
          b.setAttribute('aria-current', i === cur ? 'true' : 'false');
        });
      }
      // WHAT IT SHOWS, in Lovelace's 50px rows: the one empty line, or the
      // running timers' rows of 196px cards (up to three across); in `fit`, one
      // row for two or fewer, else its two compact rows (pages beyond six).
      getCardSize() {
        var n = this._config ? this._running().length : 0;
        if (!n) return 1;
        var size = this._config.fit ? (n <= 2 ? 4 : 7) : 4 * Math.ceil(n / 3);
        return size + (this._config.fit && this._config.heading ? 1 : 0);
      }
    }
    // ============================================================== new timer
    // The timer creator: the duration on wheels (hk-roller.js), a name, and Start.
    // WHY THE TYPING LIVES HERE. Kept in input_text helpers, the half-typed
    // duration and name would be GLOBAL entities used as a scratchpad: two
    // tablets would share them, every keystroke would be a service call
    // broadcast to every connected client, and the partly-typed value would
    // sit in the state machine.
    // Here the value is a JS property and typing re-renders nothing; _paint()
    // touches only the end time, the chips and the Start state, so the <input>
    // keeps its caret and the wheels their places.
    // WHAT STILL HAPPENS SERVER-SIDE: script.quick_timer_start (or Mantel, which
    // answers for it) takes the HH:MM:SS and starts a real timer entity.
    // This card collects; Home Assistant decides.
    class HkTimerNewCard extends HkBase {
      static get CSS() {
        var R = window.hkRoller;
        return [
          // THE ROLLER (hk-roller.js; the owner's mockup 5c, 2026-11-09): hours, minutes and seconds on three wheels, where the
          // keypad was -- the same wheels in every layout here and in the Extra Large Timers block's maker
          R ? R.CSS : '',
          '.hkr{--hkr-ink:' + window.hkCards.v('ink') + ';--hkr-ink2:' + window.hkCards.v('ink-2') + ';--hkr-band:' + window.hkCards.v('key') + ';--hkr-band-r:' + window.hkCards.R.inner + 'px}',
          // TWO COLUMNS by default: the wheels and when it ends on the left; the name, its chips and Start on the right
          '.wrap{display:grid;grid-template-columns:384px minmax(0,1fr);gap:28px}',
          // PHONE: stacked, the wheels first and full width
          '@media (max-width:' + window.hkCards.BP.phone + 'px){  .wrap{grid-template-columns:minmax(0,1fr);gap:18px}',
          '}',
          // ...AND BY ITS OWN WIDTH on someone else's dashboard: a section or a
          // Masonry column is narrower than the two columns on any screen, and
          // the name, chips and Start ran out of it. Stacked as on a phone. HK's
          // own pages keep the screen-width rule above (no container there).
          ':host([data-hk-foreign]){container-type:inline-size}',
          '@container (max-width:' + window.hkCards.BP.phone + 'px){  .wrap:not(.panel){grid-template-columns:minmax(0,1fr);gap:18px}',
          '}',
          // WHEN IT WOULD END ("Ends 4:52 PM"), under the wheels; a message ("Too many timers are running.") takes its place
          // while it shows -- the two share one cell
          '.ro{display:grid;justify-items:center;min-height:18px;min-width:0}',
          '.ro > *{grid-area:1 / 1;min-width:0}',
          '.ro .ends{font-size:14px;font-weight:500;line-height:18px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
          '.ro .hk-status{margin:0;min-height:0;line-height:18px;font-size:14px;text-align:center}',
          '.ro:has(.hk-status[data-kind]) .ends{visibility:hidden}',
          // SIX ACROSS, ONE ROW. minmax(0,1fr) rather than 1fr is what lets a long chip ellipsize instead of widening its
          // track and pushing the other five out of the card.
          '.chips{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));  grid-auto-rows:48px;gap:10px;margin:0 0 14px 0}',
          '.chip2{height:48px;border-radius:17px;padding:0 10px;min-width:0;border:' + M.border + ';  box-shadow:none;' + M.glass + ';display:flex;align-items:center;',
          '  justify-content:center;cursor:pointer;user-select:none;font-size:16px;',
          '  font-weight:600;letter-spacing:-0.3px;color:' + window.hkCards.v('ink') + ';',
          '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
          '  transition:background-color .22s ease,transform .12s ease}',
          '.chip2:active{transform:scale(0.96)}',
          '.chip2[aria-pressed="true"]{background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}',
          // A real <input>, which is the point: it keeps its own value and its
          // own caret, and nothing re-renders while somebody is typing.
          '.namebox{height:58px;border-radius:20px;padding:8px 16px;margin:0 0 14px 0;  ' + M.glass + ';border:' + M.border + ';display:flex;align-items:center;gap:10px}',
          '.namebox hk-icon{flex:none;width:18px;height:18px;--mdc-icon-size:18px;color:' + window.hkCards.v('ink-2') + '}',
          '.namebox input{all:unset;width:100%;height:100%;font-size:19px;font-weight:600;  letter-spacing:-0.3px;color:' + window.hkCards.v('ink') + ';font-family:inherit}',
          '.namebox input::placeholder{color:' + window.hkCards.v('ink-3') + ';font-weight:400}',
          '.start{height:70px;border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border + ';  box-shadow:' + M.shSm + ';display:flex;align-items:center;justify-content:center;',
          '  font-size:17px;font-weight:600;letter-spacing:-0.3px;cursor:pointer;',
          '  user-select:none;transition:transform .12s ease}',
          '.start:active{transform:scale(0.97)}',
          '.start[aria-disabled="true"]{opacity:0.45;pointer-events:none}',
          '@media (prefers-reduced-motion: reduce){  .chip2,.chip2:active,.start,.start:active{    transition:none;transform:none}}',
          // ------------------------------------------------------ THE PANEL
          // `layout: panel` -- one column on its own glass plate, the right-hand side of the one-page Timers layout
          // (hk-timers-page-card) and the sheet a Timers block's "+" opens: the wheels and when it would end, the name, its
          // chips, and Start. The plate is the only glass surface; the chips on it are tints, not plates.
          '.wrap.panel{display:flex;flex-direction:column;gap:12px;padding:20px;box-sizing:border-box;height:100%;',
          '  border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border + ';',
          '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-lg') + ')}',
          '.panel .chip2,.panel .namebox{background:' + window.hkCards.v('key') + ';box-shadow:none}',
          '.panel .namebox{height:48px;border-radius:24px;margin:0;border:0}',
          '.panel .namebox input{font-size:17px}',
          // THE NAMES AS A FIXED GRID, three by two: chips that wrap get
          // awkward as they shrink. Every chip
          // the same width, 44 px tall, a long name ellipsized in its own cell.
          '.panel .chips{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:44px;gap:8px;margin:0}',
          '.panel .chip2{height:44px;border-radius:14px;font-size:15px}',
          // the chosen name in the selected material (the plate's key color
          // above would otherwise win: same specificity, later)
          '.panel .chip2[aria-pressed="true"]{background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}',
          '.panel .start{height:56px;border-radius:28px;margin-top:auto;font-size:18px;font-weight:700;border:0}',
          '.panel .start[aria-disabled="false"]{background:var(--hk-timer-tint,rgba(255,159,10,0.95));border-color:transparent;  color:rgba(0,0,0,0.85)}',
          '.panel .start[aria-disabled="true"]{opacity:1;color:' + window.hkCards.v('ink-3') + ';background:' + window.hkCards.v('key') + '}',
          // WIDE (`data-wide`, set by hk-timers-page-card when the page stacks: an iPad held upright, a tablet with the
          // menu docked): this panel runs the full width under the page, so its one column would be a tall strip. Two
          // columns instead -- the wheels and when it ends on the left; the name, its chips and Start on the right.
          ':host([data-wide]) .wrap.panel{display:grid;height:auto;column-gap:24px;row-gap:10px;  grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(4,56px) auto;',
          '  grid-template-areas:"roll name" "roll chips" "roll chips" "roll start" "ro ."}',
          ':host([data-wide]) .panel .hkr{grid-area:roll;align-self:center}',
          ':host([data-wide]) .panel .ro{grid-area:ro}',
          ':host([data-wide]) .panel .namebox{grid-area:name;height:56px;border-radius:28px}',
          ':host([data-wide]) .panel .chips{grid-area:chips;grid-auto-rows:56px;gap:10px;margin:0}',
          ':host([data-wide]) .panel .chip2{height:56px}',
          ':host([data-wide]) .panel .start{grid-area:start;margin:0}',
          // ------------------------------------------------------ THE SHEET
          // `layout: sheet` -- the panel's one column inside a detail sheet (the Timers page's Create a Timer): the sheet
          // is the plate, so no plate of its own; the quick names are the selectable pills' 40 px capsules, three by two
          '.wrap.panel.sheetl{background:none;border:0;box-shadow:none;padding:0;height:auto;min-height:100%;gap:14px}',
          '.sheetl .chips{grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:40px;gap:10px}',
          '.sheetl .chip2{height:40px;border-radius:' + C.R.capsule('40px') + ';' + C.PILL_LABEL + ';padding:0 8px}',
          window.hkCards.headCss('.sheetl .lab') + '.sheetl .lab{margin:2px 2px -6px}',
          '.sheetl .start{margin-top:4px}',
          '.sheetl .hkr:focus-within .hkr-band{background:' + window.hkCards.v('key-strong') + '}',
          '.sheetl .chip2:focus-visible,.sheetl .start:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}',
          // ------------------------------------------------------ IN A BLOCK
          // `layout: block` -- the Extra Large Timers block's maker (mockup 5c): the wheels, a name and Start on the
          // block's inner tile; its row height is the block's to give (--hkr-row on the host). A message shows under the
          // wheels only while there is one.
          ':host([data-layout=block]){display:block;height:100%}',
          '.wrap.panel.blockl{height:100%;padding:var(--hk-mk-pad,14px 16px 16px);gap:var(--hk-mk-gap,10px);border-radius:var(--hk-inner-radius,20px);border:0;justify-content:space-between;',
          '  background:' + window.hkCards.v('key') + ';box-shadow:none}',
          '.blockl .hkr{--hkr-row:var(--hk-mk-row,40px);--hkr-fs:var(--hk-mk-fs,24px);--hkr-w:40px;--hkr-uw:34px;--hkr-gap:14px;--hkr-band-x:-4px}',
          '.blockl .ro{min-height:0}.blockl .ro .ends{display:none}.blockl .ro:not(:has(.hk-status[data-kind])){display:none}',
          '.blockl .namebox{height:56px;border-radius:28px;padding:0 16px;background:' + window.hkCards.v('key') + '}',
          '.blockl .namebox input{font-size:15px;font-weight:500}',
          '.blockl .start{height:56px;border-radius:28px;margin-top:0;font-size:17px;font-weight:600}',
          ':host([data-noname]) .blockl .namebox{display:none}'
        ].join('');
      }
      _onConfig() {
        this._dur = Object.assign({}, HkTimerNewCard.last || { h: 0, m: 15, s: 0 });
        this._name = ''; this._built = false;
        if (this._config && this._config.layout === 'block') this.setAttribute('data-layout', 'block');
      }
      _panel() { var l = this._config && this._config.layout; return l === 'panel' || l === 'sheet' || l === 'block'; }
      // "Ends 10:52 PM" moves with the clock, so the panel refreshes it while
      // it is on the page -- only that line, never the wheels or the input.
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        if (!this._endsT) this._endsT = setInterval(function () { self._paintEnds(); }, 15000);
        if (this._roller) this._roller.sync();
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._endsT) { clearInterval(this._endsT); this._endsT = null; }
      }
      _paintEnds() {
        var el = this._root && this._root.querySelector('.ends');
        if (!el) return;
        var t = this._parse();
        el.textContent = t.total
          ? 'Ends ' + new Date(Date.now() + t.total * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          : 'Set a duration';
      }
      // "25 min", "1 hr", "1 hr 30 min", "45 sec", "1 min 30 sec" -- what Start says it will start.
      static words(t) {
        if (!t.total) return '';
        var out = [];
        if (t.h) out.push(t.h + ' hr');
        if (t.m) out.push(t.m + ' min');
        if (t.s) out.push(t.s + ' sec');
        return out.join(' ');
      }
      // Reads no entity -- the wheels and the name are set here. Same trap as the
      // area picker: a null signature would repaint it on every state push (132
      // mutations for 12 unchanged updates). The wheels and inputs call _paint themselves.
      _sigOf() { return 'static'; }

      // THE DURATION is the wheels': hours, minutes, seconds
      _parse() {
        var d = this._dur || {}, h = d.h | 0, m = d.m | 0, s = d.s | 0;
        return { h: h, m: m, s: s, total: h * 3600 + m * 60 + s };
      }
      // (for a test, or anything that sets the wheels: they follow)
      _setDur(v) {
        this._dur = { h: v.h | 0, m: v.m | 0, s: v.s | 0 };
        if (this._roller) this._roller.set(this._dur, true);
        this._paint();
      }
      // THE NAME IS CLEARED ON SUCCESS, NOT ON TAP; THE DURATION STAYS (as the
      // Clock app keeps the wheels where they were -- the same timer again is one
      // tap). Clearing straight after the call, before it has resolved, would
      // lose the name when the call is rejected: no timer exists and nothing is
      // said.
      //
      // `_busy` is the other half: without it a second tap during the round
      // trip sends a second timer.
      //
      // ACCEPTED IS NOT STARTED, AND THAT GAP IS VISIBLE HERE. It is a BLOCKING
      // call to the script itself, asking for the response the allocator
      // returns ({started, slot} or {started, reason}; see
      // helpers/quick_timers.yaml, and Mantel's timers.py, which answers the same
      // way). Three distinct outcomes, three messages.
      //
      // THE START SCRIPT, with the wheels' HH:MM:SS: script.quick_timer_start
      // takes a duration to the second and a name (the keypad's
      // quick_timer_create read only hours and minutes).
      _start() {
        var t = this._parse();
        if (!t.total || !this.client) return;
        // `start_script` is an entity id; a blocking call needs it split. A
        // configured value without a domain is assumed to be a script.
        var ent = this._config.start_script || 'script.quick_timer_start';
        var parts = ent.indexOf('.') === -1 ? ['script', ent] : ent.split('.');
        // NO SUCH SCRIPT: the quick-timer helpers are not installed (a card
        // placed by hand on a dashboard of one's own). Say that, not "could not
        // reach Home Assistant", which sends someone checking the network.
        if (!this.client.states[parts.join('.')]) {
          this._setStatus('failed', NO_HELPERS());
          this._paint();
          return;
        }
        if (!this._begin('Starting timer…')) return;   // second tap: ignored
        var self = this, name = this._name.trim();
        this._callResp(parts[0], parts[1], Object.assign({ duration: window.hkRoller.hms(t) }, name ? { name: name } : {},
          this._ringsIn() ? { rings_in: this._ringsIn() } : {})).then(function (r) {
          self._end();
          // DISPATCH REJECTED. _call has logged it, the wheels and the name are
          // exactly as set, and the message stays up until the next attempt.
          if (!r.ok) {
            self._setStatus('failed', 'Could not reach Home Assistant. Tap to retry.');
            self._paint();
            return;
          }
          var res = r.response;
          // NO RESPONSE AT ALL. An older quick_timers.yaml, or a start_script
          // pointed somewhere that returns nothing. Accepted is all that is
          // known, so that is all that is claimed.
          if (!res || typeof res.started !== 'boolean') {
            self._clearForm();
            self._setStatus('sent', 'Sent to Home Assistant.', 4000);
            self._paint();
            return;
          }
          if (res.started) {
            self._clearForm();
            self._setStatus('sent', 'Timer started.', 4000);
            // in a sheet: started is done -- the sheet goes, the page shows it
            if (self._config.close_on_start && window.hkDetail && window.hkDetail.close) {
              setTimeout(function () { window.hkDetail.close(); }, 700);
            }
          } else if (res.reason === 'no_free_slot') {
            // THE ENTRY IS KEPT. Every slot is busy; cancel one and this same tap works.
            self._setStatus('warn', 'Too many timers are running.');
          } else {
            self._setStatus('warn', 'That works out to no time at all.');
          }
          self._paint();
        });
      }

      _addRingsIn(nb) { var T = window.hkTimers, h = T && T.ringsInHtml && this.client ? T.ringsInHtml(this.client.states) : ''; if (h) nb.insertAdjacentHTML('beforeend', h); }
      _ringsIn() { var el = this._root && this._root.querySelector('.ringsin'); return el ? el.value : ''; }
      _clearForm() {
        HkTimerNewCard.last = Object.assign({}, this._dur);
        this._name = '';
        var inp = this._root.querySelector('.namebox input');
        if (inp) { inp.value = ''; }
      }

      // Repaints ONLY what changes. Rebuilding the card would blow away the
      // <input> and the caret with it, and the wheels' places.
      _paint() {
        var start = this._root.querySelector('.start');
        if (!start) { return; }
        var t = this._parse(), nm = this._name.trim();
        this._paintEnds();
        // DISABLED WHILE IN FLIGHT as well as while empty. _begin already drops
        // a second submission; this is so the button LOOKS inert rather than
        // looking tappable and doing nothing.
        start.setAttribute('aria-disabled', (t.total && !this._busy) ? 'false' : 'true');
        // Start says what it will start ("Start 25 min").
        start.textContent = this._busy ? 'Starting…' : (t.total ? 'Start ' + HkTimerNewCard.words(t) : 'Start Timer');
        Array.prototype.forEach.call(this._root.querySelectorAll('.chip2'), function (c) {
          c.setAttribute('aria-pressed', c.getAttribute('data-name') === nm ? 'true' : 'false');
        });
      }

      _btn(cls, text, fn) {
        var d = document.createElement('div');
        d.className = cls; d.textContent = text;
        return button(d, fn);
      }
      _wheels() {
        var self = this, R = window.hkRoller;
        if (!R) return null;
        this._roller = R.create(R.timerCols(this._dur), { label: 'Timer length', onChange: function (v) { self._dur = v; self._paint(); } });
        return this._roller.el;
      }
      _nameBox() {
        var self = this, nb = document.createElement('div'); nb.className = 'namebox';
        nb.innerHTML = '<hk-icon icon="mdi:pencil"></hk-icon>';
        var inp = document.createElement('input');
        inp.type = 'text'; inp.placeholder = 'Name (optional)'; inp.maxLength = 32;
        inp.setAttribute('aria-label', 'Timer name');
        inp.addEventListener('input', function () { self._name = inp.value; self._paint(); });
        nb.appendChild(inp); this._addRingsIn(nb);
        return nb;
      }
      _chips(inp) {
        var self = this, chips = document.createElement('div'); chips.className = 'chips';
        // QUICK NAMES: a shortcut into the name field, never a duration. The
        // pressed one is whichever the field now says, so typing over it
        // clears it.
        (this._config.name_chips || []).slice(0, 6).forEach(function (n) {
          var c = self._btn('chip2', n, function () {
            self._name = (self._name.trim() === n) ? '' : n;
            inp.value = self._name; self._paint();
          });
          c.setAttribute('data-name', n);
          chips.appendChild(c);
        });
        return chips;
      }
      _readout() {
        var ro = document.createElement('div'); ro.className = 'ro';
        var ends = document.createElement('div'); ends.className = 'ends';
        ro.appendChild(ends); ro.appendChild(this._statusNode());
        return ro;
      }

      _render() {
        if (!this._config) { return; }
        if (this._built) { this._paint(); return; }
        if (this._panel()) { this._renderPanel(); return; }
        var self = this;
        this._root.innerHTML = '';
        var wrap = document.createElement('div'); wrap.className = 'wrap';
        var left = document.createElement('div');
        var wh = this._wheels();
        if (wh) left.appendChild(wh);
        left.appendChild(this._readout());
        var right = document.createElement('div');
        var nb = this._nameBox(); right.appendChild(nb);
        right.appendChild(this._chips(nb.querySelector('input')));
        right.appendChild(this._btn('start', 'Start Timer', function () { self._start(); }));
        wrap.appendChild(left); wrap.appendChild(right);
        this._root.appendChild(wrap);
        this._built = true;
        this._paint();
      }

      // The same parts in one column: the panel, the sheet, the block's maker.
      _renderPanel() {
        var self = this;
        this._root.innerHTML = '';
        // THE PLATE FILLS THE HOST, so the page can stretch the panel to the
        // left column's height (Start is pinned to the bottom of it).
        this._root.style.height = '100%';
        var layout = this._config.layout, sheet = layout === 'sheet', block = layout === 'block';
        var wrap = document.createElement('div'); wrap.className = 'wrap panel' + (sheet ? ' sheetl' : block ? ' blockl' : '');
        if (this._config.tint) wrap.style.setProperty('--hk-timer-tint', window.hkCards.flatColor(this._config.tint, 'well'));
        // ENTER STARTS, from the name field or a wheel (a wheel's arrows are its own)
        wrap.addEventListener('keydown', function (e) {
          var t = e.composedPath ? e.composedPath()[0] : e.target;
          if (e.key === 'Enter' && !(t && t.getAttribute && t.getAttribute('role') === 'button')) { e.preventDefault(); self._start(); }
        });
        var wh = this._wheels();
        if (wh) wrap.appendChild(wh);
        wrap.appendChild(this._readout());
        var nb = this._nameBox(); wrap.appendChild(nb);
        if (!block) {
          var chips = this._chips(nb.querySelector('input'));
          if (sheet && chips.children.length) {
            var lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = 'Quick Names';
            wrap.appendChild(lab);
            chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Quick names');
          }
          wrap.appendChild(chips);
        }
        wrap.appendChild(this._btn('start', 'Start Timer', function () { self._start(); }));
        this._root.appendChild(wrap);
        this._built = true;
        this._paint();
      }
      getCardSize() { return 8; }
    }

    // what the shell and the later parts use of this one
    K.HkTimerNewCard = HkTimerNewCard; K.HkTimersCard = HkTimersCard;
  };
})();
