// hk-calendar-pane.js - the screensaver's calendar pane card and its CSS.
//
// PART OF THE CALENDAR CARDS (hk-calendar.js). Not a card and not run on its own: it registers one
// function, which hk-calendar.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkCalendarParts = window.hkCalendarParts || {})['hk-calendar-pane'] = function (K) {
    var addDays = K.addDays, bigTime = K.bigTime, CAL_RED = K.CAL_RED, calIds = K.calIds, calName = K.calName,
        colorSig = K.colorSig, day0 = K.day0, DAY_MS = K.DAY_MS, DOW_LONG = K.DOW_LONG, dows = K.dows, esc = K.esc,
        eventStyle = K.eventStyle, evRgb = K.evRgb, FLAT_EVENT_CSS = K.FLAT_EVENT_CSS, HkBase = K.HkBase, IC = K.IC,
        load = K.load, MON = K.MON, MON3 = K.MON3, onDay = K.onDay, ownDay = K.ownDay, parseYmd = K.parseYmd,
        rgba = K.rgba, sameDay = K.sameDay, show = K.show, soon = K.soon, span = K.span, store = K.store,
        time = K.time, weekStart = K.weekStart, ymd = K.ymd;

    // ------------------------------------------------------------ the pane
    // THE SCREENSAVER'S CALENDAR PANE (hk-saver.js draws its place, its
    // background and its scrolling): today's events and the coming days',
    // big enough to read across a room. Past events today are dimmed; the
    // next one says how soon.
    var PANE_CSS = [
      ':host{display:block;color:' + window.hkCards.v('ink') + '}',
      '.day{padding-top:22px}',
      '.lbl{font-size:13px;font-weight:700;letter-spacing:1.4px;color:' + window.hkCards.v('ink-2') + '}',
      '.date{font-size:24px;font-weight:700;letter-spacing:-0.3px;margin-top:2px}',
      '.ad{margin-top:12px;min-height:32px;border-radius:8px;display:flex;align-items:center;padding:4px 12px;gap:8px;font-size:15px;font-weight:600;color:' + window.hkCards.v('ink') + '}',
      '.ad i{flex:none;width:8px;height:8px;border-radius:4px}',
      '.ad em{margin-left:auto;font-style:normal;font-weight:500;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap}',
      '.ev{display:flex;align-items:flex-start;padding:12px 0;border-bottom:1px solid ' + window.hkCards.v('line') + '}',
      '.ev:last-child{border-bottom:0}',
      '.ev.past{opacity:0.45}',
      '.tm{width:82px;flex:none;font-size:16px;font-weight:600;padding-top:3px}',
      '.ev i{flex:none;width:10px;height:10px;border-radius:5px;margin:9px 12px 0 0}',
      '.tx{min-width:0;flex:1}',
      '.t1{font-size:20px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.t2{font-size:15px;color:' + window.hkCards.v('ink-2') + ';margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.soon{flex:none;margin:2px 0 0 8px;height:24px;padding:0 10px;border-radius:12px;background:#fff;color:#1c1c1e;font-size:12px;font-weight:700;display:flex;align-items:center}',
      '.none{font-size:17px;color:' + window.hkCards.v('ink-2') + ';padding:12px 0 4px}',
      '.foot{height:60px}',
      // ON A HOME GRID (the `calendar` block; 2026-10-31, the owner's mock-up "Blocks as widgets": Calendar's own
      // widgets): a plate -- the weekday in the calendar's red, the date large, then what is next, each event with
      // its color as a bar. Small: the next event and how many more today, the block one tap. Tall and Large: the
      // rows fill the block (Large beside the date), a later day under its own heading, "N more" at the foot when
      // they don't all fit. Extra Large: the month, a dot under each day with something on it, and the chosen
      // day's events beside it. Each size on a tile cell first, then on a square one (below).
      ':host([size]) .blk{' + window.hkCards.plate('card') + ';box-sizing:border-box;height:100%;padding:' + window.hkCards.blockPad(window.hkCards.CARD.pad) +
        ';  overflow:hidden;display:flex;flex-direction:column}',
      // 2026-11-08, the owner: titles "all need to match" -- the one heading, Music's
      window.hkCards.headCss('.wg .wd') + '.wg .wd{height:16px;padding:1.5px 0;margin-bottom:8px;flex:none}.wg .wd+.ls{margin-top:0}',
      '.wg .dn{font-weight:300;line-height:1.02;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;flex:none}',
      '.wg.S .dn{font-size:36px}.wg.T .dn{font-size:44px}.wg.L .dn,.wg.W .dn{font-size:54px}.wg .rt{display:flex;flex-direction:column;min-width:0;flex:1}',
      '.wg .rt b,.wg .rt small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wg .rt b{' + window.hkCards.typeCss('headline') + ';line-height:21px}',
      '.wg .rt small{' + window.hkCards.typeCss('caption') + ';line-height:17px;color:' + window.hkCards.v('ink-2') + '}.wg .bar{flex:none;width:4px;align-self:stretch;border-radius:calc(4px / 2)}',
      '.wg .ft{flex:none;margin-top:auto;padding-top:6px;font-size:15px;line-height:18px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.wg .nil{flex:none;font-size:15px;line-height:18px;padding:10px 0;color:' + window.hkCards.v('ink-2') +
        '}.wg .end{flex:1 1 auto;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:18px;color:' + window.hkCards.v('ink-2') + '}',
      // THE ROWS: a tap opens the event's sheet; 54 px, a finger's and more
      '.wg .ls{flex:1 1 0;min-height:0;display:flex;flex-direction:column;overflow:hidden;margin-top:6px}',
      '.wg .ev2{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:54px;padding:8px 0;flex:none;min-width:0;  cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.wg .ev2+.ev2{border-top:1px solid ' + window.hkCards.v('line') + '}',
      '.wg .ev2:active{opacity:0.6}.wg .ev2.past{opacity:0.5}',
      '.wg [role=button]:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}',
      window.hkCards.headCss('.wg .gh') + '.wg .gh{flex:none;padding:12px 0 0;box-sizing:content-box;height:16px}',
      // Small: one tap -- the next event's sheet, or the Calendar page
      '.wg.S{cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.wg.S .nx{display:flex;gap:8px;margin-top:6px;min-width:0;flex:none}.wg.S .rt b{font-size:15px;line-height:19px}.wg.S .rt small{font-size:13px;line-height:16px}',
      '.wg.S .ft{font-size:13px;line-height:16px}',
      // Large: the date in a column of its own, the rows beside it
      ':host([size]) .wg.W,:host([size]) .wg.L,:host([size]) .wg.XL{flex-direction:row;gap:22px}',
      '.wg .c1{flex:0 0 104px;min-width:0;display:flex;flex-direction:column}',
      '.wg .c2{flex:1 1 0;min-width:0;display:flex;flex-direction:column}',
      '.wg.L .ls,.wg.W .ls{margin-top:0}',
      // THE EMPTY DAY (2026-11-08): the date, a title line and the next event (or a calm line) in the busy day's places (below)
      '.wg .et{' + window.hkCards.typeCss('title') +
        ';line-height:26px;text-wrap:balance;text-align:center;flex:none}.wg .ls>.et:only-child{margin:auto}.wg .es{font-size:15px;line-height:19px;color:' + window.hkCards.v('ink-2') +
        ';text-align:center;text-wrap:balance;margin-top:4px}',
      // (2026-11-09, the owner, agreed: the weekday "should stay put" on an empty day -- the busy day's places: the weekday and the date at the top-left, the line beside the date (Large, Wide) or
      // under it (Tall, Small), from the left)
      ':host([size]) .wg.em{align-items:stretch;justify-content:flex-start}:host([size]) .wg.em.W,:host([size]) .wg.em.L{flex-direction:row;gap:22px}:host([size]) .wg.em.T{flex-direction:column}' +
        '.wg.em .c2{flex:1 1 0;justify-content:flex-start;padding-top:22px}.wg.em.T .c2{padding-top:6px}',
      '.wg.em :is(.et,.es,.wd){text-align:left}.wg.em .ev2{max-width:100%;margin-top:8px;padding:6px 0}',
      // Extra Large: the month (seven columns of a finger's width), the chosen day beside it. The month's name and
      // arrows sit over the month on a square cell; on a tile (150 px) over the day, the weeks taking the height.
      '.wg .mon{flex:0 0 322px;min-width:0;display:flex;flex-direction:column}',
      window.hkCards.headRowCss('.wg .mh'),
      window.hkCards.headCss('.wg .mh b'),
      '.wg .mh>span{display:flex;gap:8px;flex:none;margin-right:-4px}',
      '.wg .ch{all:unset;cursor:pointer;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:' + window.hkCards.v('ink') + '}',
      '.wg .ch:active{opacity:0.6}',
      '.wg .mon .mh{display:none}.wg .c2 .mh{display:flex}',
      '.wg .mg2{flex:1 1 0;min-height:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:16px repeat(var(--w),minmax(0,1fr))}',
      '.wg .mg2 .w{' + window.hkCards.labelCss('label-small') + ';line-height:16px;text-align:center}',
      '.wg .md{all:unset;box-sizing:border-box;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
        '.wg .md b{position:relative;display:flex;align-items:center;justify-content:center;height:min(38px,100%);aspect-ratio:1;border-radius:50%;',
      '  font-size:17px;font-weight:500;font-variant-numeric:tabular-nums}',
      '.wg .md em{position:absolute;left:0;right:0;bottom:3px;display:flex;justify-content:center;gap:2px}.wg .md u{width:5px;height:5px;border-radius:50%}',
      '.wg .md.today b{box-shadow:inset 0 0 0 2px ' + CAL_RED + '}',
      // the chosen day filled: the ink's own color, its number the ground's (dark on the sky, light on Flat Light)
      '.wg .md.sel b{background:' + window.hkCards.v('ink') + ';color:var(--hk-flat-ground,#1c1c1e);font-weight:600}.wg .md.sel.today b{background:' + CAL_RED + ';color:#fff;box-shadow:none}',
      '.wg .md:active b{opacity:0.6}.wg .md.out{cursor:default}',
      // (the cell is the block's own, so a square one is 180 px and up for Small, two rows' 360 for the rest)
      '@container hk-cell (min-height:180px) or style(--hk-cell-shape: square){.wg.S .dn{font-size:44px}.wg.S .nx{margin-top:8px}}',
      '@container hk-cell (min-height:360px){.wg.T .dn{font-size:54px}.wg.L .dn{font-size:64px}  .wg .mon .mh{display:flex}.wg .c2 .mh{display:none}}',
      // MONTH VIEW: seven columns, the weeks' rows sharing the height; the day's
      // number sized to its cell (container units: the block is a container)
      '.blk.mo{gap:6px}',
      window.hkCards.headCss('.mo .mh') + '.mo .mh{flex:none;height:16px;padding:1.5px 0;margin-bottom:2px}',
      '.mo .mg{flex:1;min-height:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:auto repeat(var(--w),minmax(0,1fr));align-items:center;justify-items:center;' +
        'gap:2px 0}',
      '.mo .mw{' + window.hkCards.labelCss('label-small') + ';line-height:14px}',
      '.mo .md{all:unset;box-sizing:border-box;cursor:pointer;-webkit-tap-highlight-color:transparent;position:relative;display:flex;align-items:center;justify-content:center;height:100%;' +
        'max-height:calc(100cqw / 7.6);aspect-ratio:1;border-radius:50%;',
      '  font-size:clamp(11px,min(5.4cqw,7.5cqh),24px);font-weight:500;font-variant-numeric:tabular-nums}',
      // (at night the wash makes white the red: today's number goes black, --hk-night-on-red, to read on its circle)
      '.mo .md.now{background:' + CAL_RED + ';color:var(--hk-night-on-red,#fff)}',
      '.mo .md.now i{background:var(--hk-night-on-red,#fff)}',
      '.mo .md i{position:absolute;bottom:12%;width:4px;height:4px;border-radius:2px;background:' + window.hkCards.v('ink-2') + '}',
      '.mo button.md:active{opacity:.6}.mo button.md:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:1px}',
      '.mo .md.out{cursor:default}'
    ].join('\n');
    class HkCalendarPaneCard extends HkBase {
      static get CSS() { return PANE_CSS + FLAT_EVENT_CSS; }
      // (a block's tap, hk-base.js openTarget) the Calendar page, else the first calendar's sheet
      _tapTarget() {
        var ids = this.client ? calIds(this.client) : [];
        return [{ page: 'calendar' }, ids[0] && { sheet: ids[0] }];
      }
      constructor() {
        super();
        this._evs = []; this._have = ''; this._n = 0;
        var self = this;
        this._onChanged = function () { self._have = ''; self._fetch(); };
      }
      getCardSize() { return 6; }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        window.addEventListener('hk-calendar-changed', this._onChanged);
        this._tick = setInterval(function () { self._have = ''; self._fetch(); }, 300000);
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        window.removeEventListener('hk-calendar-changed', this._onChanged);
        if (this._tick) { clearInterval(this._tick); this._tick = null; }
        this._hkSig = null;
      }
      _calIds(h) {
        var own = (this._config || {}).calendars;
        return Array.isArray(own) && own.length ? own.filter(function (id) { return h.states[id]; }) : calIds(h);
      }
      // (a block with no `days` of its own reads the week ahead, 2026-11-07: its rows fill the height, the rest counted at the foot)
      _days() { var n = Number((this._config || {}).days), z = this._cellSize(); return n >= 1 && n <= 7 ? Math.round(n) : z && z !== 'XL' ? 7 : 2; }
      // what to read: today and the coming days, or (Month View, Extra Large) the weeks the month's grid shows
      _range() {
        var now = new Date();
        // (Extra Large: the month it shows, turned with its arrows)
        if (this._cellSize() === 'XL') { var m = this._mon || now, w = weekStart(new Date(m.getFullYear(), m.getMonth(), 1)); return [w, addDays(w, 42)]; }
        if (this._month()) { var a = weekStart(new Date(now.getFullYear(), now.getMonth(), 1)); return [a, addDays(a, 42)]; }
        return [day0(now), addDays(day0(now), this._days())];
      }
      _month() { return !!(this._config || {}).month && !!this._cellSize(); }
      _fetch() {
        var h = this.client;
        if (!h) return;
        var rg = this._range(), from = rg[0], to = rg[1], ids = this._calIds(h);
        var want = ids.join(',') + '|' + (+from) + '|' + (+to) + '|' + store.ver;
        if (want === this._have) return;
        this._have = want;
        var self = this;
        load(h, ids, from, to).then(function (got) {
          if (self._have !== want) return;
          self._evs = got.evs; self._n++;
          self.redraw();
        });
      }
      _sigOf() {
        var h = this.client;
        if (!h || !this._config) return null;
        var ids = this._calIds(h), HS = window.hkSettings;
        return ids.map(function (id) { var s = h.states[id]; return id + '=' + (s ? s.last_updated : 'x') + '/' +
          (HS && HS.calendarColor ? HS.calendarColor(id, h.states) : ''); }).join(';') + colorSig() + '|' + this._n + '|' + Math.floor(Date.now() / 60000);
      }
      _render() {
        var h = this.client;
        if (!h || !this._config) return;
        this._fetch();
        var sized = this._cellSize();
        if (sized) { this._renderBlock(sized); return; }
        var now = new Date(), d0 = day0(now), self = this, html = '', next = null;
        onDay(this._evs, d0).forEach(function (e) { if (!next && soon(e, now)) next = e; });
        for (var i = 0; i < this._days(); i++) {
          var d = addDays(d0, i), evs = onDay(self._evs, d);
          var all = evs.filter(function (e) { return e.allDay || (e.start <= d && e.end >= addDays(d, 1)); });
          var timed = evs.filter(function (e) { return all.indexOf(e) < 0; });
          var lbl = i === 0 ? 'TODAY' : i === 1 ? 'TOMORROW' : DOW_LONG[d.getDay()].toUpperCase();
          var date = i < 2 ? DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() : MON[d.getMonth()] + ' ' + d.getDate();
          html += '<div class="day"><div class="lbl">' + lbl + '</div><div class="date">' + date + '</div>' +
            all.map(function (e) {
              var rgb = evRgb(e, h);
              return '<div class="ad" style="' + eventStyle(rgb, 0.4) + '"><i style="background:' + rgba(rgb, 1) + '"></i>' + esc(e.title) + '<em>All day</em></div>';
            }).join('') +
            '<div>' + timed.map(function (e) {
              var rgb = evRgb(e, h), sl = e === next ? soon(e, now) : '';
              var sub = e.loc || (e.end - e.start > 3600000 ? time(e.start) + ' – ' + time(e.end) : calName(h, e.cal));
              return '<div class="ev' + (e.end <= now ? ' past' : '') + '"><div class="tm">' + (e.start < d ? 'Until' : time(e.start)) +
                '</div><i style="background:' + rgba(rgb, 1) + '"></i><div class="tx"><div class="t1">' + esc(e.title) + '</div><div class="t2">' +
                esc(sub) + '</div></div>' + (sl ? '<div class="soon">' + sl + '</div>' : '') + '</div>';
            }).join('') + '</div>' +
            (evs.length ? '' : '<div class="none">Nothing scheduled.</div>') + '</div>';
        }
        if (!this._calIds(h).length) html = '<div class="day"><div class="none">No calendars.</div></div>';
        this._root.innerHTML = html + '<div class="foot"></div>';
      }
      // A HOME GRID BLOCK (2026-10-31, Calendar's widgets): Small, Tall and Large say what is next, Extra Large is
      // the month with a day's events beside it; Month View (`month`) keeps Tall and Large a month of their own
      _renderBlock(sized) {
        var d0 = day0(new Date());
        this._watchBlock();
        if (sized === 'XL') { this._renderMonthDay(); return; }
        if (this._month() && sized !== 'S' && sized !== 'W') { this._renderMonth(sized, d0); return; }
        this._renderNext(sized, d0);
      }
      // WHAT IS NEXT: what is still to come today, all-day first, then the coming days (`days`) each under its
      // own heading -- Small the first of them; Tall and Large as many rows as fit
      _renderNext(sized, d0) {
        var h = this.client, now = new Date(), shown = [], rows = [], todayN = 0, fd = d0, fi = 0;
        for (var i = 0; i < this._days(); i++) {
          var d = addDays(d0, i), evs = onDay(this._evs, d).filter(function (e) { return e.end > now && shown.indexOf(e) < 0; });
          if (!i) todayN = evs.length;
          if (i && evs.length && sized !== 'W') rows.push('<div class="gh">' + esc(i === 1 ? 'Tomorrow' : DOW_LONG[d.getDay()] + ', ' + MON3[d.getMonth()] + ' ' + d.getDate()) + '</div>');
          evs.forEach(function (e) {
            if (shown.push(e) === 1) { fd = d; fi = i; }
            rows.push(evRow(h, e, d, shown.length - 1, i, sized === 'W' ? 'day' : sized === 'T' ? 'start' : 'span'));
          });
        }
        this._shown = shown;
        var head = '<div class="wd">' + esc(DOW_LONG[d0.getDay()]) + '</div><div class="dn">' + d0.getDate() + '</div>';
        var empty = '<div class="nil">' + (this._calIds(h).length ? (shown.length ? 'Nothing more today' : 'Nothing scheduled') : 'No calendars') + '</div>';
        // THE EMPTY DAY (2026-11-08, the review): nothing left today and none ahead (or, Wide, only later days) -- the date, a title line and the next event or a calm line, where the busy day has
        // them; Tall and Large with later events keep their list
        if (sized !== 'S' && !todayN && this._calIds(h).length && (sized === 'W' || !shown.length)) {
          var dd = this._days(), nxt = shown.length ? evRow(h, shown[0], fd, 0, fi, 'day') : '<div class="es">' + (dd > 1 ? 'The next ' + dd + ' days are clear' : 'A clear day') + '</div>';
          this._root.innerHTML = '<div class="blk wg em ' + sized + '">' + (sized === 'W' || sized === 'L' ? '<div class="c1">' + head + '</div>' : head) +
            '<div class="c2"><div class="et">Nothing scheduled' + (shown.length ? ' today' : '') + '</div>' + nxt + '</div></div>';
          this._wireTaps(); return;
        }
        if (sized === 'S') {
          // the next event (today's, else the coming days' first) and how many more today
          var e = shown[0], sub = e ? whenShort(e, e.start < d0 ? d0 : e.start, true) : '';
          if (e && !sameDay(e.start < d0 ? d0 : e.start, d0)) sub = (sameDay(e.start, addDays(d0, 1)) ? 'Tomorrow' : DOW_LONG[e.start.getDay()]) + ' · ' + sub;
          // (one today: nothing else; none today, tomorrow's shown: nothing more)
          var foot = !e ? '' : todayN > 1 ? (todayN - 1) + ' more today' : todayN ? 'Nothing else today' : 'Nothing more today';
          this._root.innerHTML = '<div class="blk wg' + (e ? '' : ' em') + ' S" role="button" tabindex="0" data-go="1" aria-label="' +
            esc(DOW_LONG[d0.getDay()] + ', ' + MON[d0.getMonth()] + ' ' + d0.getDate() + (e ? '. Next: ' + e.title + ', ' + sub : '') + (foot ? '. ' + foot : '')) + '">' +
            head + (e ? '<div class="nx"><i class="bar" style="background:' + rgba(evRgb(e, h), 1) + '"></i><span class="rt"><b>' + esc(e.title) +
            '</b><small>' + esc(sub) + '</small></span></div>' : empty.replace('"nil"', '"es"')) + (foot ? '<div class="ft">' + esc(foot) + '</div>' : '') + '</div>';
        } else {
          var list = shown.length ? (todayN ? '' : empty) + rows.join('') : empty;
          var ls = '<div class="ls">' + list + '</div><div class="ft" style="display:none"></div>';
          this._root.innerHTML = '<div class="blk wg ' + sized + '">' +
            (sized === 'L' || sized === 'W' ? '<div class="c1">' + head + '</div><div class="c2">' + ls + '</div>' : head + ls) + '</div>';
          this._fitRows();
        }
        this._wireTaps();
      }
      // THE ROWS THAT FIT, the rest counted at the foot ("2 more tomorrow"); a heading left with nothing under it
      // goes with them
      _fitRows() {
        var ls = this._root.querySelector('.ls'), ft = this._root.querySelector('.ft');
        var cut = fitRows(ls, ft), last = ls.lastElementChild;
        // (everything fits and a good deal of the height is left: a quiet line in the middle of it, not bare glass)
        if (!cut) { if (last && ls.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom >= 36 && this._shown.length) ls.insertAdjacentHTML('beforeend', '<div class="end">' +
          (this._days() > 6 ? 'Nothing else this week' : 'Nothing more coming up') + '</div>'); return; }
        var evs = cut.filter(function (r) { return r.hasAttribute('data-ev'); });
        var days = evs.map(function (r) { return r.getAttribute('data-i'); }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        ft.textContent = evs.length + ' more' + (days.length === 1 && days[0] === '0' ? ' today' : days.length === 1 && days[0] === '1' ? ' tomorrow' : '');
      }
      // ONE DAY'S MONTH (Extra Large, as the nightstand's and an upright phone's Calendar page has it -- this
      // file's month, narrow): the month's days, a dot in each event's color under a day with something on it,
      // today ringed, the chosen day filled; beside it the chosen day's events. A tap on a day chooses it, a tap
      // on the chosen day opens it on the Calendar page; the arrows turn the month.
      _renderMonthDay() {
        var h = this.client, now = new Date();
        var sel = this._sel || day0(now), m0 = this._mon || new Date(now.getFullYear(), now.getMonth(), 1);
        var first = new Date(m0.getFullYear(), m0.getMonth(), 1), a = weekStart(first), last = new Date(m0.getFullYear(), m0.getMonth() + 1, 0);
        var weeks = Math.ceil((Math.round((day0(last) - a) / DAY_MS) + 1) / 7);
        var cells = dows(['S', 'M', 'T', 'W', 'T', 'F', 'S']).map(function (x) { return '<span class="w" aria-hidden="true">' + x + '</span>'; }).join('');
        for (var i = 0; i < weeks * 7; i++) {
          var d = addDays(a, i);
          if (d.getMonth() !== m0.getMonth()) { cells += '<span class="md out" aria-hidden="true"></span>'; continue; }
          var cs = [];
          ownDay(this._evs, d).forEach(function (e) { var k = rgba(evRgb(e, h), 1); if (cs.indexOf(k) < 0) cs.push(k); });
          cells += '<span class="md' + (sameDay(d, now) ? ' today' : '') + (sameDay(d, sel) ? ' sel' : '') + '" role="button" tabindex="0" data-day="' + ymd(d) +
            '" aria-label="' + esc(DOW_LONG[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + (cs.length ? ', with events' : '')) + '"><b>' + d.getDate() +
            (cs.length ? '<em>' + cs.slice(0, 3).map(function (k) { return '<u style="background:' + k + '"></u>'; }).join('') + '</em>' : '') + '</b></span>';
        }
        var name = MON[m0.getMonth()] + (m0.getFullYear() !== now.getFullYear() ? ' ' + m0.getFullYear() : '');
        var mh = '<div class="mh"><b>' + esc(name) + '</b><span><span class="ch" role="button" tabindex="0" data-mon="-1" aria-label="Previous month">' + IC.left +
          '</span><span class="ch" role="button" tabindex="0" data-mon="1" aria-label="Next month">' + IC.right + '</span></span></div>';
        // the chosen day: every event of it, the past dimmed
        var evs = onDay(this._evs, sel);
        this._shown = evs;
        var rows = evs.map(function (e, n) { return evRow(h, e, sel, n, 0, 'span', e.end <= now); }).join('');
        var lab = (sameDay(sel, now) ? 'Today, ' : DOW_LONG[sel.getDay()] + ', ') + MON3[sel.getMonth()] + ' ' + sel.getDate();
        this._root.innerHTML = '<div class="blk wg XL"><div class="mon">' + mh + '<div class="mg2" style="--w:' + weeks + '">' + cells + '</div></div>' +
          '<div class="c2">' + mh + '<div class="wd">' + esc(lab) + '</div><div class="ls">' +
          (rows || (this._calIds(h).length ? '<div class="et">Nothing scheduled</div>' : '<div class="nil">No calendars</div>')) +
          '</div><div class="ft" style="display:none"></div></div></div>';
        var cut = fitRows(this._root.querySelector('.ls'), this._root.querySelector('.ft'));
        if (cut) this._root.querySelector('.ft').textContent = cut.filter(function (r) { return r.hasAttribute('data-ev'); }).length + ' more';
        this._wireTaps();
      }
      // THE BLOCK'S TAPS, once: an event's row its sheet; Small the next event (or the Calendar page); a day of
      // the month chosen, then opened; the month's arrows
      _wireTaps() {
        if (this._taps) return;
        this._taps = true;
        var self = this;
        var go = function (day) {
          var dash = '/' + (String(location.pathname).split('/')[1] || '') + '/';
          window.hkCards.navigate(dash + 'calendar?day=' + ymd(day), self);
        };
        var act = function (ev) {
          var t = ev.target && ev.target.closest && ev.target.closest('[data-ev],[data-day],[data-mon],[data-go]');
          if (!t) return;
          var shown = self._shown || [];
          if (t.hasAttribute('data-ev')) { var e = shown[+t.getAttribute('data-ev')]; if (e) show(self.client, e); return; }
          if (t.hasAttribute('data-go')) { if (shown[0]) show(self.client, shown[0]); else go(new Date()); return; }
          if (t.hasAttribute('data-day')) {
            var d = parseYmd(t.getAttribute('data-day'));
            if (!d) return;
            if (sameDay(d, self._sel || new Date())) { go(d); return; }
            self._sel = d;
            self.redraw();
            return;
          }
          // a month on: the 1st chosen, or today in today's month
          var now = new Date(), m0 = self._mon || new Date(now.getFullYear(), now.getMonth(), 1);
          var m = new Date(m0.getFullYear(), m0.getMonth() + Number(t.getAttribute('data-mon')), 1);
          self._mon = m;
          self._sel = m.getMonth() === now.getMonth() && m.getFullYear() === now.getFullYear() ? day0(now) : m;
          self._fetch();
          self.redraw();
        };
        this._root.addEventListener('click', act);
        this._root.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(ev); } });
      }
    }

    // ONE EVENT'S ROW in a block: its color as a bar, its name, and when -- the start (Tall), or from and to and
    // where (Large, Extra Large); `day` is the day it is listed under
    function evRow(h, e, day, n, i, how, past) {
      var sub = how === 'span' ? whenShort(e, day) + (e.loc ? ' · ' + e.loc : '') : (how === 'day' && i ? (i === 1 ? 'Tomorrow' : DOW_LONG[day.getDay()]) + ' · ' : '') + whenShort(e, day, true);
      return '<div class="ev2' + (past ? ' past' : '') + '" role="button" tabindex="0" data-ev="' + n + '" data-i="' + i + '" aria-label="' + esc(e.title + ', ' + sub) + '">' +
        '<i class="bar" style="background:' + rgba(evRgb(e, h), 1) + '"></i><span class="rt"><b>' + esc(e.title) + '</b><small>' + esc(sub) + '</small></span></div>';
    }
    // when, short: "All day", "4:00 PM" (`start`), "4:00 – 6:00 PM", "Until 9:00 AM" (begun the day before)
    function whenShort(e, day, start) {
      var d = day0(day);
      if (e.allDay || (e.start <= d && e.end >= addDays(d, 1))) return 'All day';
      if (e.start < d) return 'Until ' + time(e.end);
      if (start) return time(e.start);
      return sameDay(e.start, e.end) ? bigTime(e) : span(e);
    }
    // THE ROWS THAT FIT (2026-10-31, the owner: a list fills the room it is given and says "N more" when cut,
    // never a fixed gap): every row drawn, then -- when the last one runs past the list's foot -- the foot's line
    // (`ft`, if any) shown and the rows past the list's new foot hidden. The hidden rows, or 0 when all fit. Before the view
    // has measured the block (nothing laid out) nothing is cut: the block is drawn again when it has. (2026-11-07: the foot's line holds a word while it is measured -- with none it is 18 px short and
    // the last row kept is cut by it.)
    function fitRows(ls, ft) {
      if (!ls || typeof ls.getBoundingClientRect !== 'function') return 0;
      var box = ls.getBoundingClientRect(), rows = Array.prototype.slice.call(ls.children || []);
      if (!(box.height > 0) || !rows.length) return 0;
      if (rows[rows.length - 1].getBoundingClientRect().bottom <= box.bottom + 0.5) return 0;
      if (ft) { ft.style.display = ''; ft.textContent = ft.textContent || '0 more'; }
      var foot = ls.getBoundingClientRect().bottom + 0.5, cut = [];
      rows.forEach(function (r) { if (cut.length || r.getBoundingClientRect().bottom > foot) cut.push(r); });
      // (a day's heading with none of its rows left under it)
      var keep = rows.filter(function (r) { return cut.indexOf(r) < 0; }), end = keep[keep.length - 1];
      if (end && end.classList.contains('gh')) cut.unshift(end);
      cut.forEach(function (r) { r.style.display = 'none'; });
      return cut;
    }

    // what the shell and the later parts use of this one
    K.fitRows = fitRows; K.HkCalendarPaneCard = HkCalendarPaneCard;
  };
})();
