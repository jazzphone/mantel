// hk-calendar-page.js - the Calendar page card and its CSS.
//
// PART OF THE CALENDAR CARDS (hk-calendar.js). Not a card and not run on its own: it registers one
// function, which hk-calendar.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkCalendarParts = window.hkCalendarParts || {})['hk-calendar-page'] = function (K) {
    var addDays = K.addDays, addMonths = K.addMonths, askDelete = K.askDelete, bars = K.bars, C = K.C,
        calIds = K.calIds, calName = K.calName, can = K.can, colorSig = K.colorSig, day0 = K.day0, DAY_MS = K.DAY_MS,
        DOW = K.DOW, DOW_LONG = K.DOW_LONG, dows = K.dows, edge = K.edge, edit_ = K.edit_, esc = K.esc,
        eventStyle = K.eventStyle, evRgb = K.evRgb, failedLine = K.failedLine, FLAT_EVENT_CSS = K.FLAT_EVENT_CSS,
        HkBase = K.HkBase, hourLabel = K.hourLabel, IC = K.IC, lanes = K.lanes, load = K.load, M = K.M, MON = K.MON,
        MON3 = K.MON3, newAt = K.newAt, onDay = K.onDay, ownDay = K.ownDay, parseYmd = K.parseYmd,
        repeatLabel = K.repeatLabel, rgba = K.rgba, sameDay = K.sameDay, setWeekStart = K.setWeekStart, show = K.show,
        soon = K.soon, span = K.span, store = K.store, time = K.time, tshort = K.tshort, weekStart = K.weekStart,
        writable = K.writable, ymd = K.ymd;

    // ------------------------------------------------------------ the page
    // THE RIGHT-HAND COLUMN'S WIDTH: the month's day panel, the day view's
    // column, and the view switch's place above them
    var RCOL = 380;
    // the view switch's slide: a touch past and back, as a UIKit spring (the tab bar's)
    var SPRING = 'cubic-bezier(.34,1.24,.42,1)';
    // where a view button sits in its switch (left and width)
    // THE VIEW SWITCH IS HK'S SEGMENTED CONTROL (hk-base.js segCss, segBox,
    // slideSeg), the same as the Energy tabs'
    function segBox(b) { return window.hkCards.segBox(b); }
    function slideSeg(b, from) { return window.hkCards.slideSeg(b, from); }
    // a panel's plate (hkCards.plate): the tall shadow, as every page card
    var GLASS = function () { return window.hkCards.plate('panel'); };
    var PAGE_CSS = function () {
      return [
        ':host{display:block;color:' + window.hkCards.v('ink') + ';-webkit-tap-highlight-color:transparent}',
        // the bar's and the rest's holders (_render): no box of their own
        '.hold{display:contents}',
        'button{appearance:none;font:inherit;color:' + window.hkCards.v('ink') + ';cursor:pointer;margin:0}',
        // (its controls level with Energy's tabs, one page edge from the top:
        // the 54 px row centers its 44 px controls 5 px in -- DESIGN.md "Page edges")
        // THE BAR FLOATS where the page scrolls, as the Energy tabs do (2026-11-08, the owner): a frosted strip once at
        // the top, its 44 px controls 6 px inside it all round (_float)
        '.bar{display:flex;align-items:center;gap:14px;min-height:52px;margin:-4px 0 16px;flex-wrap:wrap;position:sticky;z-index:4;' +
        '  top:max(var(--hk-energy-sticky-top,10px), calc(env(safe-area-inset-top, 0px) + 4px));border-radius:' + C.R.capsule('58px') + ';transition:background-color .25s ease}',
        '.bar.stuck{min-height:44px;padding:6px 6px 6px 18px;background:' + window.hkCards.v('float-plate') + ';',
        '  -webkit-backdrop-filter:var(--hk-float-backdrop,blur(24px) saturate(1.6));backdrop-filter:var(--hk-float-backdrop,blur(24px) saturate(1.6));',
        '  border:1px solid rgba(255,255,255,0.12);box-shadow:0 8px 24px rgba(0,0,0,0.28)}',
        '.ttl{font-size:34px;font-weight:700;letter-spacing:-0.6px;white-space:nowrap}',
        '.ttl span{font-weight:300;opacity:0.8}',
        '.arrows{display:flex;gap:8px}',
        // THE CONTROLS ARE GLASS LIKE THE PANELS (M.glass, not only its color):
        // the marker that cuts them out of the shared blur, so they follow the
        // screen's Glass setting as the calendar under them does
        '.rb{width:44px;height:44px;border-radius:22px;border:' + M.border + ';' + M.glass + ';display:flex;align-items:center;justify-content:center;padding:0}',
        '.pb{height:44px;padding:0 18px;border-radius:22px;border:' + M.border + ';' + M.glass + ';font-size:15px;font-weight:600}',
        '.sp{flex:1}',
        // the view switch and New Event over the right-hand column, the switch
        // starting where that column does (RCOL, the day panel and the day
        // view's column alike)
        '.rgt{width:' + RCOL + 'px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px}',
        // HK's segmented control (the choice slides to the new view), its
        // choices a fixed 74 px here
        C.segCss('.seg', { raised: true }),
        '.seg button{width:74px;padding:0}',
        '.new{height:44px;padding:0 18px 0 14px;border-radius:22px;border:0;background:#fff;color:#1c1c1e;font-size:15px;font-weight:600;display:flex;align-items:center;gap:6px;white-space:nowrap;' +
          'flex:none}',
        '.panel{' + GLASS() + ';position:relative;overflow:hidden}',
        '.body{display:flex;gap:20px;align-items:stretch}',
        '.wide .body{height:var(--cal-h,620px)}',
        '.ell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.warn{margin:0 0 12px;font-size:14px;font-weight:600;color:var(--hk-warn,#ffd60a)}',
        '.empty{padding:18px 0;font-size:15px;color:' + window.hkCards.v('ink-2') + '}',
        // ---- month
        '.mgrid{flex:1;min-width:0;padding:10px 12px 12px;display:flex;flex-direction:column}',
        '.dows{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));height:30px;align-items:center;flex:none}',
        '.dows div{padding-left:8px;font-size:11px;font-weight:600;letter-spacing:0.4px;color:' + window.hkCards.v('ink-2') + '}',
        '.weeks{flex:1;display:flex;flex-direction:column;min-height:0}',
        '.wk{position:relative;flex:1;min-height:0;border-top:1px solid ' + window.hkCards.v('line') + ';display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}',
        '.cell{position:relative;min-width:0;overflow:hidden;border:0;background:transparent;text-align:left;padding:0;display:block}',
        '.cell + .cell{border-left:1px solid ' + window.hkCards.v('line') + '}',
        '.cell.out{opacity:0.45}',
        '.cell.sel{background:' + window.hkCards.v('key') + '}',
        '.num{position:absolute;left:9px;top:8px;font-size:15px;font-weight:600;line-height:20px}',
        '.cell.today .num{left:5px;top:5px;width:26px;height:26px;line-height:26px;border-radius:13px;background:#fff;color:#1c1c1e;font-weight:700;text-align:center}',
        '.chips{position:absolute;left:9px;right:6px;display:flex;flex-direction:column;gap:2px}',
        '.chip{height:17px;line-height:17px;font-size:12px;font-weight:500;display:flex;align-items:center;gap:5px;min-width:0}',
        '.chip i{flex:none;width:7px;height:7px;border-radius:4px}',
        '.chip b{font-weight:700}',
        '.more{height:17px;line-height:17px;font-size:12px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
        '.bar1{position:absolute;height:18px;line-height:18px;border-radius:8px;font-size:11px;font-weight:700;padding:0 6px;box-sizing:border-box;',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:0;text-align:left;color:' + window.hkCards.v('ink') + '}',
        '.dots{position:absolute;left:0;right:0;bottom:6px;display:flex;justify-content:center;gap:3px}',
        '.dots i{width:6px;height:6px;border-radius:3px}',
        // ---- the day's list (month) and the agenda rows
        '.side{width:' + RCOL + 'px;flex:none;padding:' + window.hkCards.CARD.pad + ';display:flex;flex-direction:column}',
        '.dname{font-size:28px;font-weight:700;letter-spacing:-0.4px}',
        '.dsub{font-size:15px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';margin-top:2px}',
        // (its 10 px under the day's name as padding: the list scrolls right up
        // under the name, in a frame with the sheet's shadows -- BASE_CSS .hk-edge)
        '.list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;-webkit-overflow-scrolling:touch;padding-top:10px}',
        '.ad{width:100%;height:30px;margin-top:6px;border-radius:8px;border:0;display:flex;align-items:center;padding:0 12px;gap:8px;font-size:14px;font-weight:600;text-align:left;color:' +
          window.hkCards.v('ink') + '}',
        '.ad i{flex:none;width:8px;height:8px;border-radius:4px}',
        '.ad em{margin-left:auto;font-style:normal;font-weight:500;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
        '.ev{width:100%;display:flex;align-items:flex-start;padding:12px 0;border:0;border-bottom:1px solid ' + window.hkCards.v('line') + ';background:transparent;text-align:left;gap:0}',
        '.ev:last-child{border-bottom:0}',
        '.ev.past{opacity:0.5}',
        '.ev .tm{width:76px;flex:none;font-size:14px;font-weight:600;padding-top:2px}',
        '.ev i{flex:none;width:9px;height:9px;border-radius:5px;margin:7px 10px 0 0}',
        '.ev .tx{min-width:0;flex:1}',
        '.ev .t1{font-size:17px;font-weight:600}',
        '.ev .t2{font-size:14px;color:' + window.hkCards.v('ink-2') + ';margin-top:2px}',
        '.soon{flex:none;height:24px;padding:0 10px;border-radius:12px;background:#fff;color:#1c1c1e;font-size:12px;font-weight:700;display:flex;align-items:center;margin-left:8px}',
        '.addday{height:44px;border-radius:22px;border:1px dashed ' + window.hkCards.v('mark') +
          ';background:transparent;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;flex:none}',
        // ---- week and day: the time grid
        '.tg{flex:1;min-width:0;padding:8px 12px 12px;display:flex;flex-direction:column}',
        '.cols{display:grid;flex:none}',
        '.dh{display:flex;align-items:center;justify-content:center;gap:7px;height:46px;border:0;background:transparent;padding:0}',
        '.dh span{font-size:13px;font-weight:600;letter-spacing:0.6px;color:' + window.hkCards.v('ink-2') + '}',
        '.dh b{font-size:17px;font-weight:600}',
        '.dh.today b{width:28px;height:28px;line-height:28px;border-radius:14px;background:#fff;color:#1c1c1e;font-weight:700;text-align:center;font-size:15px}',
        '.alld{position:relative;border-top:1px solid ' + window.hkCards.v('line') + ';flex:none}',
        '.alld .lab{position:absolute;left:0;top:50%;transform:translateY(-50%);width:50px;text-align:right;font-size:11px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
        '.tl{position:relative;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;-webkit-overflow-scrolling:touch;border-top:1px solid ' +
          window.hkCards.v('line') + '}',
        '.hrs{position:relative}',
        '.hr{position:absolute;left:56px;right:0;height:0;border-top:1px solid ' + window.hkCards.v('line') + '}',
        '.hr span{position:absolute;left:-56px;top:-8px;width:50px;text-align:right;font-size:11px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
        '.days{position:absolute;top:0;bottom:0;right:0;display:grid}',
        '.dcol{position:relative;border-left:1px solid ' + window.hkCards.v('line') + '}',
        '.dcol.today{background:' + window.hkCards.v('key') + '}',
        '.slot{position:absolute;left:0;right:0;border:0;background:transparent;padding:0}',
        '.blk{position:absolute;box-sizing:border-box;overflow:hidden;border-radius:8px;padding:4px 8px 4px 10px;border:0;text-align:left;color:' + window.hkCards.v('ink') + ';line-height:1.25}',
        '.blk .t1{font-size:13px;font-weight:700}',
        '.blk .t2{font-size:12px;font-weight:500;color:rgba(255,255,255,0.8);margin-top:1px}',
        '.blk.past{opacity:0.85}',
        '.blk{box-shadow:inset 3px 0 0 var(--e,transparent)}',
        '.blk.sel{box-shadow:inset 3px 0 0 var(--e,transparent),0 0 0 2px ' + window.hkCards.v('ink') + '}',
        '.dayv .blk{border-radius:8px;padding:4px 12px;line-height:1.25}',
        '.dayv .blk .t1{font-size:15px}',
        '.dayv .blk .t2{font-size:13px;margin-top:2px}',
        '.now{position:absolute;height:2px;background:#ff453a;pointer-events:none}',
        '.now::before{content:"";position:absolute;left:-5px;top:-4px;width:10px;height:10px;border-radius:5px;background:#ff453a}',
        '.nowl{position:absolute;left:0;width:50px;text-align:right;font-size:11px;font-weight:700;color:#ff6961;pointer-events:none}',
        // ---- the day's right column: the month, the event
        '.rcol{width:' + RCOL + 'px;flex:none;display:flex;flex-direction:column;gap:16px;min-height:0}',
        '.mini{padding:16px 18px 14px;flex:none}',
        '.mini .mh{display:flex;align-items:center}',
        '.mini .mh b{font-size:17px;font-weight:700;flex:1}',
        '.mini .mh button{width:36px;height:36px;border:0;background:transparent;padding:0;display:flex;align-items:center;justify-content:center}',
        '.mgr{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));margin-top:6px;row-gap:2px}',
        '.mgr .w{text-align:center;font-size:11px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';height:22px;line-height:22px}',
        '.md{height:38px;border:0;background:transparent;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}',
        '.md b{height:26px;min-width:26px;line-height:26px;font-size:14px;font-weight:600;border-radius:13px;text-align:center}',
        '.md.out b{opacity:0.4}',
        '.md.today b{background:#fff;color:#1c1c1e;font-weight:700}',
        '.md.sel:not(.today) b{background:' + window.hkCards.v('key-strong') + '}',
        '.md i{width:5px;height:5px;border-radius:3px}',
        '.det{padding:18px 20px;flex:none}',
        '.det .c{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
        '.det .c i{width:10px;height:10px;border-radius:5px}',
        '.det h3{font-size:22px;font-weight:700;margin:8px 0 0;letter-spacing:-0.35px;overflow-wrap:anywhere}',
        '.det .ln{display:flex;align-items:flex-start;gap:10px;margin-top:9px;font-size:15px}',
        '.det .ln svg{flex:none;margin-top:2px}',
        '.det .ln span{min-width:0;overflow-wrap:anywhere}',
        '.det .note{color:' + window.hkCards.v('ink-2') + ';white-space:pre-wrap;max-height:84px;overflow:hidden}',
        '.det .acts{display:flex;gap:10px;margin-top:16px}',
        '.det .acts button{flex:1;height:44px;border-radius:22px;font-size:15px;font-weight:600}',
        '.det .ed{border:' + M.border + ';background:' + window.hkCards.v('key') + '}',
        '.det .rm{border:1px solid rgba(255,105,97,0.45);background:rgba(255,69,58,0.18);color:#ffb3ae}',
        '.det .none{font-size:15px;color:' + window.hkCards.v('ink-2') + '}',
        // ---- narrow (a phone): stacked
        '.narrow .ttl{font-size:26px}',
        '.narrow .bar{gap:10px}',
        '.narrow .sp{display:none}',
        '.narrow .arrows{margin-left:auto}',
        '.narrow .pb{order:4}',
        '.narrow .rgt{display:contents}',
        '.narrow .seg{order:5;flex:1}',
        '.narrow .seg button{flex:1;width:auto}',
        '.narrow .new{order:6;width:44px;padding:0;justify-content:center}', // (no words on a phone: a circle, not New Event's padding round a lone + -- 2026-11-10)
        // (floating on a phone: the view switch and the arrows, one row)
        '@media (max-width:' + window.hkCards.BP.phone + 'px){.narrow .bar.stuck .ttl,.narrow .bar.stuck .pb,.narrow .bar.stuck .new{display:none}' +
        '.narrow .bar.stuck{padding:6px;flex-wrap:nowrap}.narrow .bar.stuck .arrows{order:6;margin-left:0}}',
        '.narrow .body{flex-direction:column;gap:14px}',
        '.narrow .mgrid{padding:8px}',
        '.narrow .wk{height:56px;flex:none}',
        '.narrow .num{left:0;right:0;text-align:center}',
        '.narrow .cell.today .num{left:50%;margin-left:-13px}',
        '.narrow .side{width:auto;padding:18px}',
        '.narrow .list{overflow:visible}',
        '.narrow .tg{height:min(620px,calc(var(--hk-vh,100vh) - 220px));flex:none}',
        '.narrow .rcol{width:auto}',
        '.narrow .wl{padding:4px 18px 10px}',
        '.fit .body{height:var(--cal-h,620px)}',
        // (the week's list scrolls in a frame: the sheet's shadows, BASE_CSS .hk-edge)
        '.fit .wlp{flex:1;min-height:0;display:flex;flex-direction:column}',
        '.fit .wl{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;-webkit-overflow-scrolling:touch}',
        '.wl .dayh{font-size:13px;font-weight:700;letter-spacing:1.2px;color:' + window.hkCards.v('ink-2') + ';margin-top:16px}',
        '.wl .dayh.today{color:' + window.hkCards.v('ink') + '}'
      ].join('\n');
    };

    class HkCalendarCard extends HkBase {
      static get CSS() { return PAGE_CSS() + FLAT_EVENT_CSS; }
      constructor() {
        super();
        this._view = 'month';
        this._day = day0(new Date());     // the day chosen (and what the view shows)
        this._sel = null;                  // the event chosen (day view)
        this._evs = [];
        this._failed = [];
        this._have = '';                   // the range (and store version) the events are for
        this._n = 0;                       // answers in
        this._w = 0;
        var self = this;
        this._onChanged = function () { self._have = ''; self._fetch(); };
        this._onResize = function () { if (!self._rsz) self._rsz = requestAnimationFrame(function () { self._rsz = 0; self._measure(); }); };
        // on its own shadow root: they live and go with the card
        this._root.addEventListener('click', function (e) { self._click(e); });
        this._root.addEventListener('pointerdown', function (e) { self._swipeStart(e); });
        this._root.addEventListener('pointerup', function (e) { self._swipeEnd(e); });
        // ...and a swipe something else took is not ours: the page swipe's (hk-pageswipe.js says so with a
        // pointercancel as it starts) or the browser's scroll. Unheard, a swipe on the Calendar turned the page and its
        // month both (2026-11-02, the owner, swiping on through the Calendar: November, October, September...)
        this._root.addEventListener('pointercancel', function () { self._sx = null; });
      }
      setConfig(config) {
        var c = Object.assign({}, config || {});
        if (c.view === 'week' || c.view === 'day') this._view = c.view;
        super.setConfig(c);
      }
      getCardSize() { return 12; }
      // OPENED AT A DAY: ?day=2026-10-12 on the page's address (a calendar
      // notification's Go To). Read when the page shows, each new day once.
      _dayFromUrl() {
        var m = /[?&]day=(\d{4}-\d{2}-\d{2})/.exec(location.search || ''), d = m ? parseYmd(m[1]) : null;
        if (!d || m[1] === this._urlDay) return;
        this._urlDay = m[1];
        this._view = 'day';
        this._day = day0(d);
        this._sel = null;
        this._have = '';
        if (this.client) { this._fetch(); this.redraw(); }
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        this._dayFromUrl();
        if (!this._onLoc) { this._onLoc = function () { self._dayFromUrl(); }; }
        window.hkShell.onNavigate(this._onLoc);
        window.addEventListener('hk-calendar-changed', this._onChanged);
        window.addEventListener('resize', this._onResize);
        // (a docked bar or the Now Playing pane coming or going changes the room)
        window.addEventListener('hk-dock', this._onResize);
        window.addEventListener('hk-pane', this._onResize);
        // (the bar floating or in its place: any scroller's scroll, once a frame)
        this._onScroll = this._onScroll || function () { self._scrollQ = self._scrollQ || requestAnimationFrame(function () { self._scrollQ = 0; self._float(); }); };
        window.addEventListener('scroll', this._onScroll, { passive: true, capture: true });
        if (typeof ResizeObserver === 'function' && !this._ro) {
          this._ro = new ResizeObserver(function (en) {
            var w = en && en[0] && en[0].contentRect ? en[0].contentRect.width : self.clientWidth;
            if (Math.abs(w - self._w) < 2) return;
            self._w = w;
            self._measure();
            self.redraw();
          });
          this._ro.observe(this);
        }
        // every five minutes the events again (a calendar changed elsewhere)
        this._tick = setInterval(function () { self._have = ''; self._fetch(); }, 300000);
        // DRAWN BEFORE IT WAS PLACED, the page guessed its width (wide) and
        // its height (the 620 px default), and a cold load could show that
        // frame before the ResizeObserver and the measure below put it right
        // (2026-10-20, Safari on Mantel: the panels drew short, then grew).
        // So the width is taken now, the page drawn again for it, and the
        // panels measured, before the first frame -- and again once they are
        // drawn: measured from the body itself.
        var w0 = this.clientWidth || 0;
        if (w0 && Math.abs(w0 - this._w) >= 2) { this._w = w0; if (this.client && this._config) this.redraw(); }
        this._measure();
        this._m0 = setTimeout(function () { self._m0 = null; self._measure(); setTimeout(function () { if (self.isConnected) self._measure(); }, 400); }, 0);
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        window.removeEventListener('hk-calendar-changed', this._onChanged);
        window.hkShell.offNavigate(this._onLoc);
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('hk-dock', this._onResize);
        window.removeEventListener('hk-pane', this._onResize);
        window.removeEventListener('scroll', this._onScroll, { capture: true }); cancelAnimationFrame(this._scrollQ || 0); this._scrollQ = 0;
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._tick) { clearInterval(this._tick); this._tick = null; }
        if (this._m0) { clearTimeout(this._m0); this._m0 = null; }
        this._hkSig = null;
      }
      _wide() { return (this._w || this.clientWidth || 1200) >= 900; }
      // THE BAR FLOATS once scrolled to its sticky top (hk-energy.js HkEnergyPeriodCard). Its place keeps the height it
      // had (the strip's padding, a phone's one row), so the panels under it don't jump; a new bar floats at once.
      _float() {
        var bar = this._root && this._root.querySelector && this._root.querySelector('.bar'), cs = bar && this.isConnected && getComputedStyle(bar);
        if (!cs || cs.position !== 'sticky') return;
        var top = parseFloat(cs.top) || 0, r = bar.getBoundingClientRect(), was = bar.classList.contains('stuck');
        // (a phone: by the scroll past the bar's place, not where iOS draws the sticky bar -- read a frame late, the bar folded and unfolded every frame, 2026-11-10; 4 px either way)
        var sy = window.scrollY || 0; if (!was && r.top > top + 0.5) this._homeY = r.top + sy;
        var stuck = sy > 0 && this._homeY != null ? sy + top - this._homeY > (was ? -4 : -0.5) : r.top <= top + 0.5 && (sy > 0 || (this._homeTop != null && r.top < this._homeTop - 1));
        if (!was && (this._homeTop == null || r.top > top + 0.5)) this._homeTop = r.top; if (stuck === was) return;
        // (THE PAGE NEVER SHORTER, not for a moment: its spacer set before it folds, taken off after it opens -- a short week ended above where it was scrolled as it folded, iOS put the scroll back,
        // it opened and folded again: the bounce, 2026-11-10)
        if (!stuck) { bar.classList.remove('stuck'); bar.style.marginBottom = ''; return; }
        var h0 = bar.offsetHeight, mb0 = parseFloat(getComputedStyle(bar).marginBottom) || 0;
        bar.style.marginBottom = (mb0 + h0) + 'px'; bar.classList.add('stuck'); bar.style.marginBottom = (mb0 + h0 - bar.offsetHeight) + 'px';
      }
      // THE PAGE'S HEIGHT, on a wide screen: the panels reach the bottom of
      // the window, whatever is above them
      // MEASURED, NOT GUESSED (2026-10-15): it took a 74 px Home Assistant
      // toolbar that a kiosk screen doesn't have and none of the tab bar's
      // room, and the page ran ~190 px past the window -- the page scrolled,
      // not the week. The panels end where what follows them begins: the
      // view's room for a tab bar or a docked bar, the cards' margins (the
      // view's own end, hui-view, and its bottom padding), so the page fits
      // the window exactly and the week's hours scroll in their own panel.
      _measure() {
        if (!this.isConnected || !this.getBoundingClientRect) return;
        var H = window.innerHeight || 800, se = document.scrollingElement, sy = se ? se.scrollTop : (window.scrollY || 0);
        var body = this._root && this._root.querySelector('.wide .body, .fit .body');
        if (!body) {
          var r = this.getBoundingClientRect(), h0 = Math.max(460, Math.round(H - (r.top + sy) - 24));
          if (h0 !== this._h) { this._h = h0; this.style.setProperty('--cal-h', h0 + 'px'); }
          return;
        }
        // (to the end of the VIEW'S CONTENT -- the layout inside hui-view --
        // not hui-view's own: that one is stretched to the window, so measuring
        // to it only ever confirmed the height the panels already had, and a
        // desk opened at the 620 px default stayed there until a resize; 2026-10-16)
        var hv = null, inner = null, n = this, prev = null;
        for (var i = 0; i < 40 && n; i++) {
          if (window.hkShell.is(n, 'view')) { hv = n; inner = prev; break; }
          if (n.nodeType === 1) prev = n;
          n = n.parentNode || n.host;
        }
        var br = body.getBoundingClientRect(), after = 24;
        // THE PAGE'S EDGE BELOW (2026-10-17, DESIGN.md "Page edges"): the
        // panels end one page gutter above the window -- the gutter the view
        // keeps under every page (hk-layout.js gutter), so the view has nothing
        // to correct and the panels never move after they are drawn -- plus
        // whatever room is kept below the page (a tab bar's)
        var G = window.hkLayout && window.hkLayout.gutter ? window.hkLayout.gutter(this) : null;
        if (hv) {
          var vc = hv.parentNode && hv.parentNode.nodeType === 1 ? hv.parentNode : null;
          var pad = vc ? parseFloat(getComputedStyle(vc).paddingBottom) || 0 : 0;
          if (G != null) {
            after = G + pad + (parseFloat(getComputedStyle(hv).paddingBottom) || 0) +
              (inner ? parseFloat(getComputedStyle(inner).paddingBottom) || 0 : 0) + (parseFloat(hv.style.marginBottom) || 0);
          } else {
            var end = (inner || hv).getBoundingClientRect().bottom + (inner ? parseFloat(getComputedStyle(hv).paddingBottom) || 0 : 0);
            after = Math.max(0, end - br.bottom) + pad + (parseFloat(hv.style.marginBottom) || 0);
          }
        }
        var h = Math.max(460, Math.floor(H - (br.top + sy) - after));
        if (h !== this._h) { this._h = h; this.style.setProperty('--cal-h', h + 'px'); }
      }
      // THE DAYS SHOWN: the month's weeks, the week, or the day
      _range() {
        var d = this._day;
        if (this._view === 'month') {
          var first = new Date(d.getFullYear(), d.getMonth(), 1), from = weekStart(first);
          var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
          var weeks = Math.ceil((Math.round((day0(last) - from) / DAY_MS) + 1) / 7);
          return { from: from, to: addDays(from, weeks * 7), weeks: weeks };
        }
        if (this._view === 'week') { var w = weekStart(d); return { from: w, to: addDays(w, 7) }; }
        // the day, and its month (the little month's dots)
        var m0 = weekStart(new Date(d.getFullYear(), d.getMonth(), 1));
        return { from: m0, to: addDays(m0, 42) };
      }
      _fetch() {
        var h = this.client;
        if (!h) return;
        var r = this._range(), ids = calIds(h);
        var want = ids.join(',') + '|' + (+r.from) + '|' + (+r.to) + '|' + store.ver;
        if (want === this._have) return;
        this._have = want;
        var self = this;
        load(h, ids, r.from, r.to).then(function (got) {
          if (self._have !== want) return;
          self._evs = got.evs;
          self._failed = got.failed;
          self._n++;
          self.redraw();
        });
      }
      _sigOf() {
        var h = this.client;
        if (!h || !this._config) return null;
        var ids = calIds(h), HS = window.hkSettings;
        var out = ids.map(function (id) { var s = h.states[id]; return id + '=' + (s ? s.last_updated : 'x'); }).join(';');
        var cols = ids.map(function (id) { return HS && HS.calendarColor ? HS.calendarColor(id, h.states) : ''; }).join(',') + colorSig();
        return out + '|' + cols + '|' + this._n + '|' + this._view + '|' + (+this._day) + '|' + (this._sel || '') +
          '|' + (this._wide() ? 'W' : 'N') + '|' + Math.floor(Date.now() / 60000);
      }
      _go(view, day) {
        if (view) this._view = view;
        if (day) this._day = day0(day);
        this._sel = null;
        this._fetch();
        this.redraw();
      }
      _step(n) {
        var d = this._day;
        if (this._view === 'month') this._go(null, addMonths(new Date(d.getFullYear(), d.getMonth(), 1), n));
        else this._go(null, addDays(d, this._view === 'week' ? 7 * n : n));
      }
      _swipeStart(e) {
        if (e.pointerType === 'mouse') return;
        this._sx = e.clientX; this._sy = e.clientY; this._st = Date.now();
      }
      // A SWIPE across the month or the week turns it (a sideways flick, not
      // a scroll of the hours) -- where Swipe Between Pages doesn't take it
      _swipeEnd(e) {
        if (this._sx == null || e.pointerType === 'mouse') return;
        var dx = e.clientX - this._sx, dy = e.clientY - this._sy, dt = Date.now() - this._st;
        this._sx = null;
        if (dt < 700 && Math.abs(dx) > 70 && Math.abs(dy) < 50) { this._swiped = Date.now(); this._step(dx < 0 ? 1 : -1); }
      }
      _find(key) { return this._evs.filter(function (e) { return e.key === key; })[0] || null; }
      _click(e) {
        if (this._swiped && Date.now() - this._swiped < 400) return;
        var b = e.composedPath ? e.composedPath().filter(function (n) { return n.getAttribute && n.getAttribute('data-a'); })[0]
                                : (e.target.closest && e.target.closest('[data-a]'));
        if (!b) return;
        var a = b.getAttribute('data-a'), v = b.getAttribute('data-v'), h = this.client;
        if (a === 'prev') this._step(-1);
        else if (a === 'next') this._step(1);
        else if (a === 'today') this._go(null, new Date());
        else if (a === 'view') this._go(v, this._day);
        else if (a === 'new') newAt(h, this._view === 'month' || this._view === 'day' ? this._day : new Date(), false);
        else if (a === 'addday') newAt(h, this._day, false);
        else if (a === 'day') {
          var d = parseYmd(v);
          // a second tap on the chosen day opens it
          if (this._view === 'month' && sameDay(d, this._day)) this._go('day', d);
          else if (this._view === 'month') { this._day = d; if (d.getMonth() !== this._shownMonth) this._fetch(); this.redraw(); }
          else this._go('day', d);
        } else if (a === 'mini') { this._go(null, parseYmd(v)); }
        else if (a === 'minip' || a === 'minin') this._go(null, addMonths(this._day, a === 'minip' ? -1 : 1));
        else if (a === 'slot') {
          if (!writable(h).length) return;
          var p = v.split('T'), sd = parseYmd(p[0]);
          sd.setHours(+p[1], 0, 0, 0);
          newAt(h, sd, false);
        } else if (a === 'ev') {
          var ev = this._find(v);
          if (!ev) return;
          // ONE GESTURE, ONE MEANING (2026-10-16, the user): a tap on an event
          // opens its sheet in every view. The wide day view also marks it in
          // its side list, so the list is on it when the sheet closes.
          if (this._view === 'day' && this._wide()) { this._sel = v; this.redraw(); }
          show(h, ev);
        } else if (a === 'edit') { var e1 = this._find(this._sel); if (e1) edit_(h, e1); }
        else if (a === 'del') { var e2 = this._find(this._sel), self = this; if (e2) askDelete(h, e2, function () { self._sel = null; }); }
      }
      _render() {
        var h = this.client;
        if (!h || !this._config) return;
        setWeekStart(h);
        this._fetch();
        var wide = this._wide();
        // KEEP WHERE THE HOURS WERE SCROLLED (the page is redrawn whole)
        var tl = this._root.querySelector && this._root.querySelector('.tl');
        var keep = tl && tl.getAttribute && tl.getAttribute('data-k') === this._view + (+this._day) ? tl.scrollTop : null;
        var list = this._root.querySelector && this._root.querySelector('.list'), keepL = list ? list.scrollTop : 0;
        var bar = this._bar(h, wide), html = '';
        if (
          !calIds(
          h).length) html +=
          '<div class="panel" style="padding:22px"><div class="empty">No calendars. Add one to Home Assistant (Settings → Devices &amp;' +
          ' Services → Add Integration → Local Calendar) and it shows here.</div></div>';
        else {
          if (this._failed.length) html += '<div class="warn">' + esc(failedLine(h, this._failed)) + '</div>';
          html += this._view === 'week' ? this._week(h, wide) : this._view === 'day' ? this._dayView(h, wide) : this._month(h, wide);
        }
        // THE BAR IS WRITTEN ONLY WHEN IT CHANGES (2026-10-10). The page is
        // drawn again when its events arrive -- at once when they were fetched
        // before -- and a bar written again then cut the view switch's slide
        // short: the new button, mid-way, jumped home. So the bar and the rest
        // have holders of their own (display:contents: the layout as before),
        // and the bar's is left alone while its markup is the same.
        // NARROW ON A TABLET (beside the Now Playing pane, an iPad), THE WEEK
        // fits the window too ('fit'): its list scrolls in its panel, under a
        // page that stays put -- a phone's page scrolls as a phone's does
        var fit = !wide && this._view === 'week' && (window.innerWidth || 0) >= 640 && (window.innerHeight || 0) >= 500;
        var cls = (wide ? 'wide' : 'narrow') + (fit ? ' fit' : ''), wrap = this._wrap, fresh = false;
        if (!wrap || wrap.parentNode !== this._root || wrap.className !== cls) {
          fresh = true;
          // (a new layout: its panels measured again once drawn)
          var selfM = this;
          requestAnimationFrame(function () { if (selfM.isConnected) selfM._measure(); });
          this._root.innerHTML = '<div class="' + cls + '"><div class="hold"></div><div class="hold"></div></div>';
          wrap = this._wrap = this._root.children && this._root.children[0];
          if (wrap && wrap.children && wrap.children.length === 2) wrap.__bar = null;
          else wrap = this._wrap = null;
        }
        if (!wrap) {
          // markup that is not parsed (the test shim): the page whole, as before
          this._root.innerHTML = '<div class="' + cls + '">' + bar + html + '</div>';
        } else if (wrap.__bar !== bar) {
          // where the view switch's choice was, for its slide to the new one
          var was = wrap.children[0].querySelector && wrap.children[0].querySelector('.seg button[aria-selected="true"]');
          var segFrom = was ? segBox(was) : null;
          wrap.children[0].innerHTML = bar;
          wrap.__bar = bar;
          var nowSeg = segFrom && wrap.children[0].querySelector('.seg button[aria-selected="true"]');
          if (nowSeg) slideSeg(nowSeg, segFrom);
          this._float();
        }
        if (wrap) wrap.children[1].innerHTML = html;
        // MEASURED BEFORE THE FIRST PAINT (2026-10-20, Safari on Mantel): a
        // new layout's panels were measured a frame later, so on some loads
        // their first frame was the 620 px default and then they grew.
        // THE WARNING LINE COMES LATE: it sits above the panels and arrives
        // with the events' answer, often after the panels were measured --
        // they were pushed down by its height and ran past the window's
        // gutter, on some loads and not others. Measured again in the same
        // frame it comes or goes, so the panels' bottom edge stays put.
        var warned = this._failed.length > 0;
        if (fresh || warned !== !!this._warned) { this._warned = warned; this._measure(); }
        var tl2 = this._root.querySelector && this._root.querySelector('.tl');
        if (tl2 && tl2.setAttribute) {
          tl2.setAttribute('data-k', this._view + (+this._day));
          if (keep != null) tl2.scrollTop = keep;
          else tl2.scrollTop = Math.max(0, this._scrollTo * this._px - 12);
        }
        var l2 = this._root.querySelector && this._root.querySelector('.list');
        if (l2 && keepL) l2.scrollTop = keepL;
        // THE LISTS' EDGES: the sheet's shadows, top once scrolled, foot while
        // more lies below (hk-base.js edges; all drawn anew each time)
        if (C.edges) C.edges(this._root);
      }
      _bar(h, wide) {
        var d = this._day, v = this._view, ttl;
        if (v === 'month') ttl = MON[d.getMonth()] + ' <span>' + d.getFullYear() + '</span>';
        else if (v === 'week') {
          var a = weekStart(d), b = addDays(a, 6);
          ttl = (wide ? MON3[a.getMonth()] + ' ' + a.getDate() + ' – ' + (a.getMonth() === b.getMonth() ? '' : MON3[b.getMonth()] + ' ') + b.getDate()
                      : MON3[a.getMonth()] + ' ' + a.getDate() + ' – ' + b.getDate()) + ' <span>' + b.getFullYear() + '</span>';
        } else ttl = (wide ? DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] : DOW_LONG[d.getDay()].slice(0, 3) + ', ' + MON3[d.getMonth()]) +
                     ' ' + d.getDate() + ' <span>' + d.getFullYear() + '</span>';
        var prevL = v === 'month' ? 'Previous month' : v === 'week' ? 'Previous week' : 'Previous day';
        var nextL = v === 'month' ? 'Next month' : v === 'week' ? 'Next week' : 'Next day';
        var seg = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(function (o) {
          return '<button role="tab" data-a="view" data-v="' + o[0] + '" aria-selected="' + (o[0] === v) + '">' + o[1] + '</button>';
        }).join('');
        var isToday = v === 'month' ? (d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear())
                    : v === 'week' ? sameDay(weekStart(d), weekStart(new Date())) : sameDay(d, new Date());
        return '<div class="bar"><div class="ttl">' + ttl + '</div>' +
          '<div class="arrows"><button class="rb" data-a="prev" aria-label="' + prevL + '">' + IC.left + '</button>' +
          '<button class="rb" data-a="next" aria-label="' + nextL + '">' + IC.right + '</button></div>' +
          '<button class="pb" data-a="today"' + (isToday ? ' aria-current="date"' : '') + '>Today</button>' +
          '<div class="sp"></div><div class="rgt"><div class="seg" role="tablist" aria-label="View">' + seg + '</div>' +
          (writable(h).length ? '<button class="new" data-a="new" aria-label="New Event">' + IC.plus + (wide ? 'New Event' : '') + '</button>' : '') +
          '</div></div>';
      }
      // ---- the month
      _month(h, wide) {
        var r = this._range(), evs = this._evs, today = new Date(), d = this._day;
        this._shownMonth = d.getMonth();
        var rowH = wide ? (this._h || 620) - 20 - 30 : 56;
        rowH = wide ? rowH / r.weeks : 56;
        var weeks = '';
        for (var w = 0; w < r.weeks; w++) {
          var from = addDays(r.from, w * 7), bs = bars(evs, from, 7), shownLanes = wide ? Math.min(bs.lanes, 2) : 0;
          var cells = '';
          for (var c = 0; c < 7; c++) {
            var day = addDays(from, c), cls = 'cell' + (day.getMonth() !== d.getMonth() ? ' out' : '') +
              (sameDay(day, today) ? ' today' : '') + (sameDay(day, d) ? ' sel' : '');
            var mine = onDay(evs, day);
            var inner = '<span class="num">' + day.getDate() + '</span>';
            if (wide) {
              // the day's own (not an all-day bar shown above it)
              var barred = bs.list.filter(function (b) { return b.lane < shownLanes && c >= b.a && c <= b.b; }).map(function (b) { return b.ev; });
              var own = mine.filter(function (e) { return barred.indexOf(e) < 0; });
              var top = 31 + shownLanes * 20 + 2, room = Math.max(0, Math.floor((rowH - top - 2) / 19));
              var showN = own.length > room ? Math.max(0, room - 1) : own.length;
              inner += '<span class="chips" style="top:' + top + 'px">' + own.slice(0, showN).map(function (e) {
                var rgb = evRgb(e, h);
                return '<span class="chip"><i style="background:' + rgba(rgb, 1) + '"></i><span class="ell">' +
                  (e.allDay ? '' : '<b>' + tshort(e.start < day0(day) ? day0(day) : e.start) + '</b> ') + esc(e.title) + '</span></span>';
              }).join('') + (own.length > showN ? '<span class="more">+' + (own.length - showN) + ' more</span>' : '') + '</span>';
            } else if (ownDay(evs, day).length) {
              var cs = [];
              ownDay(evs, day).forEach(function (e) { var k = rgba(evRgb(e, h), 1); if (cs.indexOf(k) < 0) cs.push(k); });
              inner += '<span class="dots">' + cs.slice(0, 3).map(function (k) { return '<i style="background:' + k + '"></i>'; }).join('') + '</span>';
            }
            cells += '<button class="' + cls + '" data-a="day" data-v="' + ymd(day) + '" aria-label="' + DOW_LONG[day.getDay()] + ', ' +
              MON[day.getMonth()] + ' ' + day.getDate() + (mine.length ? ', ' + mine.length + (mine.length === 1 ? ' event' : ' events') : '') + '">' + inner + '</button>';
          }
          var barsHtml = bs.list.filter(function (b) { return b.lane < shownLanes; }).map(function (b) {
            var rgb = evRgb(b.ev, h);
            return '<button class="bar1" data-a="ev" data-v="' + esc(b.ev.key) + '" style="top:' + (31 + b.lane * 20) + 'px;left:calc(' + b.a +
              ' * 100% / 7 + 3px);width:calc(' + (b.b - b.a + 1) + ' * 100% / 7 - 6px);' + eventStyle(rgb, 0.55) + '">' + esc(b.ev.title) + '</button>';
          }).join('');
          weeks += '<div class="wk">' + cells + barsHtml + '</div>';
        }
        var grid = '<div class="panel mgrid"><div class="dows">' + dows(DOW).map(function (x) { return '<div>' + (wide ? x : x.charAt(0)) + '</div>'; }).join('') +
          '</div><div class="weeks">' + weeks + '</div></div>';
        return '<div class="body">' + grid + this._dayList(h, wide) + '</div>';
      }
      // THE CHOSEN DAY'S EVENTS (beside the month)
      _dayList(h, wide) {
        var d = this._day, now = new Date(), evs = onDay(this._evs, d), today = sameDay(d, now);
        var all = evs.filter(function (e) { return e.allDay || (e.start <= day0(d) && e.end >= addDays(day0(d), 1)); });
        var timed = evs.filter(function (e) { return all.indexOf(e) < 0; });
        var next = null;
        if (today) timed.forEach(function (e) { if (!next && soon(e, now)) next = e; });
        var sub = MON[d.getMonth()] + ' ' + d.getDate() + (today ? ' · Today' : sameDay(d, addDays(day0(now), 1)) ? ' · Tomorrow' : '');
        var rows = timed.map(function (e) {
          var rgb = evRgb(e, h), past = e.end <= now;
          var sl = e === next ? soon(e, now) : '';
          return '<button class="ev' + (past ? ' past' : '') + '" data-a="ev" data-v="' + esc(e.key) + '">' +
            '<span class="tm">' + (e.start < day0(d) ? 'Until' : time(e.start)) + '</span><i style="background:' + rgba(rgb, 1) + '"></i>' +
            '<span class="tx"><span class="t1 ell" style="display:block">' + esc(e.title) + '</span>' +
            '<span class="t2 ell" style="display:block">' + esc(span(e) + (e.loc ? ' · ' + e.loc : '')) + '</span></span>' +
            (sl ? '<span class="soon">' + sl + '</span>' : '') + '</button>';
        }).join('');
        var alls = all.map(function (e) {
          var rgb = evRgb(e, h);
          return '<button class="ad" data-a="ev" data-v="' + esc(e.key) + '" style="' + eventStyle(rgb, 0.4) + '"><i style="background:' +
            rgba(rgb, 1) + '"></i><span class="ell">' + esc(e.title) + '</span><em>' + esc(span(e)) + '</em></button>';
        }).join('');
        return '<div class="panel side"><div class="dname">' + DOW_LONG[d.getDay()] + '</div><div class="dsub">' + sub + '</div>' +
          '<div class="hk-edge"><div class="list">' + alls + (rows || (alls ? '' : '<div class="empty">Nothing on this day.</div>')) + '</div></div>' +
          (writable(h).length ? '<button class="addday" data-a="addday">' + IC.plus + ' Add an Event on ' + DOW_LONG[d.getDay()] + '</button>' : '') +
          '</div>';
      }
      // ---- the time grid (week: 7 columns; day: 1)
      _grid(h, days, wide, isDay) {
        var PX = isDay ? 48 : 44, now = new Date(), self = this;
        this._px = PX;
        var n = days.length, gutter = 56, evs = this._evs;
        var from = days[0], bs = bars(evs, from, n);
        var allH = Math.max(30, bs.lanes * 26 + 6);
        var heads = isDay ? '' : '<div class="cols" style="grid-template-columns:' + gutter + 'px repeat(' + n + ',minmax(0,1fr))"><div></div>' +
          days.map(function (d) {
            return '<button class="dh' + (sameDay(d, now) ? ' today' : '') + '" data-a="day" data-v="' + ymd(d) + '" aria-label="' +
              DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + '"><span>' + (wide ? DOW[d.getDay()] : DOW[d.getDay()].charAt(0)) +
              '</span><b>' + d.getDate() + '</b></button>';
          }).join('') + '</div>';
        var alld = '<div class="alld" style="height:' + allH + 'px"><span class="lab">all-day</span>' + bs.list.map(function (b) {
          var rgb = evRgb(b.ev, h);
          return '<button class="bar1" data-a="ev" data-v="' + esc(b.ev.key) + '" style="top:' + (4 + b.lane * 26) + 'px;height:22px;line-height:22px;font-size:12px;left:calc(' +
            gutter + 'px + ' + b.a + ' * (100% - ' + gutter + 'px) / ' + n + ' + 3px);width:calc(' + (b.b - b.a + 1) + ' * (100% - ' + gutter + 'px) / ' + n +
            ' - 6px);' + eventStyle(rgb, 0.55) + '">' + esc(b.ev.title) + (isDay && b.ev.allDay ? '<span style="font-weight:500;margin-left:8px;opacity:0.85">' +
              esc(span(b.ev).replace('All day · ', '').replace('All day', '')) + '</span>' : '') + '</button>';
        }).join('') + '</div>';
        // (the hour's label gives way to the time now, where they would meet)
        var nowAt = days.some(function (d) { return sameDay(d, now); }) ? (now - day0(now)) / 3600000 * PX : -99;
        var hrs = '';
        for (var hr = 1; hr < 24; hr++) {
          hrs += '<div class="hr" style="top:' + (hr * PX) + 'px">' + (Math.abs(hr * PX - nowAt) < 14 ? '' : '<span>' + hourLabel(hr) + '</span>') + '</div>';
        }
        var first = 24;
        var cols = days.map(function (d) {
          var a = day0(d), b = addDays(a, 1), today = sameDay(d, now);
          var items = evs.filter(function (e) { return !e.allDay && (e.end - e.start) < DAY_MS && e.start < b && e.end > a; })
            .map(function (e) { return { ev: e, s: e.start < a ? a : e.start, e: e.end > b ? b : e.end }; });
          var slots = '';
          for (var h2 = 0; h2 < 24; h2++) slots += '<button class="slot" tabindex="-1" aria-hidden="true" data-a="slot" data-v="' + ymd(d) + 'T' + h2 + '" style="top:' + (h2 * PX) + 'px;height:' +
            PX + 'px"></button>';
          var blocks = lanes(items).map(function (it) {
            var top = (it.s - a) / 3600000 * PX, ht = Math.max(18, (it.e - it.s) / 3600000 * PX - 3);
            first = Math.min(first, (it.s - a) / 3600000);
            var rgb = evRgb(it.ev, h), past = it.ev.end <= now, w = 100 / it.cols;
            return '<button class="blk' + (past ? ' past' : '') + (self._sel === it.ev.key ? ' sel' : '') + '" data-a="ev" data-v="' + esc(it.ev.key) + '" style="top:' + (top + 1) +
              'px;height:' + ht + 'px;left:calc(' + (it.col * w) + '% + 3px);width:calc(' + w + '% - 6px);' + eventStyle(rgb, past ? 0.28 : 0.5) + edge(rgb) + '">' +
              '<div class="t1 ell">' + esc(it.ev.title) + '</div>' + (ht > 30 ? '<div class="t2 ell">' + esc(span(it.ev) + (isDay && it.ev.loc ? ' · ' + it.ev.loc : '')) + '</div>' : '') +
                '</button>';
          }).join('');
          return '<div class="dcol' + (today && !isDay ? ' today' : '') + '">' + slots + blocks + '</div>';
        }).join('');
        var nowIdx = -1;
        days.forEach(function (d, i) { if (sameDay(d, now)) nowIdx = i; });
        var nowTop = (now - day0(now)) / 3600000 * PX;
        var nowLine = nowIdx < 0 ? '' : '<div class="now" style="top:' + nowTop + 'px;left:calc(' + gutter + 'px + ' + nowIdx + ' * (100% - ' + gutter + 'px) / ' + n +
          ');width:calc((100% - ' + gutter + 'px) / ' + n + ')"></div><div class="nowl" style="top:' + (nowTop - 8) + 'px">' + time(now).replace(' AM', '').replace(' PM', '') + '</div>';
        // first look: the hour before now (today shown) or before the first event, else 7 AM
        this._scrollTo = Math.max(0, Math.floor(nowIdx >= 0 ? (now - day0(now)) / 3600000 - 2 : first < 24 ? first - 1 : 7));
        // (the hours are a grid under their heading's rule, as iPad Calendar's:
        // no fades at its ends -- the user, 2026-10-17)
        return heads + alld + '<div class="tl"><div class="hrs" style="height:' + (24 * PX) + 'px">' + hrs +
          '<div class="days" style="left:' + gutter + 'px;grid-template-columns:repeat(' + n + ',minmax(0,1fr))">' + cols + '</div>' + nowLine + '</div></div>';
      }
      _week(h, wide) {
        var a = weekStart(this._day), days = [];
        for (var i = 0; i < 7; i++) days.push(addDays(a, i));
        if (!wide) return '<div class="body">' + this._weekList(h, days) + '</div>';
        return '<div class="body"><div class="panel tg">' + this._grid(h, days, wide, false) + '</div></div>';
      }
      // A WEEK ON A PHONE: day by day, as a list
      _weekList(h, days) {
        var now = new Date(), self = this;
        var out = days.map(function (d) {
          var evs = onDay(self._evs, d);
          return '<div class="dayh' + (sameDay(d, now) ? ' today' : '') + '">' + DOW_LONG[d.getDay()].toUpperCase() + ' · ' + MON3[d.getMonth()].toUpperCase() + ' ' + d.getDate() + '</div>' +
            (evs.length ? evs.map(function (e) {
              var rgb = evRgb(e, h);
              return '<button class="ev' + (e.end <= now ? ' past' : '') + '" data-a="ev" data-v="' + esc(e.key) + '"><span class="tm">' +
                (e.allDay ? 'All day' : time(e.start < day0(d) ? day0(d) : e.start)) + '</span><i style="background:' + rgba(rgb, 1) + '"></i><span class="tx">' +
                '<span class="t1 ell" style="display:block">' + esc(e.title) + '</span>' + (e.loc ? '<span class="t2 ell" style="display:block">' + esc(e.loc) + '</span>' : '') + '</span></button>';
            }).join('') : '<div class="empty" style="padding:8px 0">Nothing.</div>');
        }).join('');
        return '<div class="panel wlp"><div class="hk-edge"><div class="wl">' + out + '</div></div></div>';
      }
      _dayView(h, wide) {
        var d = this._day;
        var grid = '<div class="panel tg dayv">' + this._grid(h, [d], wide, true) + '</div>';
        if (!wide) return '<div class="body">' + grid + '</div>';
        return '<div class="body">' + grid + '<div class="rcol">' + this._mini(h) + this._detail(h) + '</div></div>';
      }
      // THE LITTLE MONTH beside the day: any day in a tap, a dot where there
      // are events
      _mini(h) {
        var d = this._day, from = weekStart(new Date(d.getFullYear(), d.getMonth(), 1)), now = new Date(), evs = this._evs;
        var cells = dows(['S', 'M', 'T', 'W', 'T', 'F', 'S']).map(function (x) { return '<div class="w">' + x + '</div>'; }).join('');
        var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        var n = Math.ceil((Math.round((day0(last) - from) / DAY_MS) + 1) / 7) * 7;
        for (var i = 0; i < n; i++) {
          var x = addDays(from, i), mine = ownDay(evs, x);
          var dot = mine.length ? rgba(evRgb(mine[0], h), 1) : 'transparent';
          cells += '<button class="md' + (x.getMonth() !== d.getMonth() ? ' out' : '') + (sameDay(x, now) ? ' today' : '') + (sameDay(x, d) ? ' sel' : '') +
            '" data-a="mini" data-v="' + ymd(x) + '" aria-label="' + MON[x.getMonth()] + ' ' + x.getDate() + '"><b>' + x.getDate() + '</b><i style="background:' + dot + '"></i></button>';
        }
        return '<div class="panel mini"><div class="mh"><b>' + MON[d.getMonth()] + ' ' + d.getFullYear() + '</b>' +
          '<button data-a="minip" aria-label="Previous month">' + IC.left + '</button><button data-a="minin" aria-label="Next month">' + IC.right + '</button></div>' +
          '<div class="mgr">' + cells + '</div></div>';
      }
      // THE CHOSEN EVENT (day view): tap one in the hours
      _detail(h) {
        var now = new Date(), d = this._day, ev = this._sel ? this._find(this._sel) : null;
        if (!ev) {
          // nothing chosen: the next one today, else the day's first
          var evs = onDay(this._evs, d);
          ev = evs.filter(function (e) { return !e.allDay && e.end > now; })[0] || evs.filter(function (e) { return !e.allDay; })[0] || null;
          if (ev) this._sel = ev.key;
        }
        if (!ev) {
          var anyAll = onDay(this._evs, d).length > 0;
          return '<div class="panel det"><div class="none">' + (anyAll ? 'Only all-day events on this day.' : 'Nothing on this day.') +
            (writable(h).length ? ' Tap an hour to add an event.' : '') + '</div></div>';
        }
        var rgb = evRgb(ev, h), sl = soon(ev, now);
        var when = (sameDay(ev.start, now) ? 'Today, ' : DOW_LONG[ev.start.getDay()] + ', ') + span(ev);
        var ed = can(h, ev.cal, 'update') && ev.uid, rm = can(h, ev.cal, 'delete') && ev.uid;
        return '<div class="panel det"><div class="c"><i style="background:' + rgba(rgb, 1) + '"></i>' + esc(calName(h, ev.cal)) +
          (sl ? '<span class="soon" style="margin-left:auto">' + sl + '</span>' : '') + '</div>' +
          '<h3>' + esc(ev.title) + '</h3>' +
          '<div class="ln">' + IC.clock + '<span>' + esc(when) + '</span></div>' +
          (ev.rrule ? '<div class="ln">' + IC.repeat + '<span>' + esc(repeatLabel(ev.rrule)) + '</span></div>' : '') +
          (ev.loc ? '<div class="ln">' + IC.pin + '<span>' + esc(ev.loc) + '</span></div>' : '') +
          (ev.desc ? '<div class="ln" style="color:' + window.hkCards.v('ink-2') + '">' + IC.notes + '<span class="note">' + esc(ev.desc) + '</span></div>' : '') +
          (ed || rm ? '<div class="acts">' + (ed ? '<button class="ed" data-a="edit">Edit</button>' : '') + (rm ? '<button class="rm" data-a="del">Delete</button>' : '') + '</div>' : '') +
          '</div>';
      }
    }

    // what the shell and the later parts use of this one
    K.HkCalendarCard = HkCalendarCard;
  };
})();
