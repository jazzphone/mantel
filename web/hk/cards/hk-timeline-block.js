// @ts-check
// hk-timeline-block.js -- the House Timeline in two small places (docs/phase19/HOUSE-TIMELINE.md, "The views").
//
// hk-timeline-block-card   the Home Grid block "Recent" (`timeline` in hk-grid-catalog.js; Wide, Large, Extra Large): the
//                          last rows of the Timeline in the page's own look -- an icon by family, the title, the time,
//                          who did it when the viewer may know, a small picture when one was kept. Its `show` is
//                          Automatic (the morning summary from 5 to 11 AM, the latest rows after), Latest Events, or
//                          Morning Summary. Live. A tap opens the Timeline page. A wall tablet alone gets the
//                          limited view because the server hands it one: no names, and pictures only when its
//                          Owner turned them on for that tablet (what comes back is what is drawn).
// hk-timeline-strip-card   "Recent" under a camera's live view (the camera sheet, hk-sheet-security.js): the last ten
//                          events of that camera, each a small card with its first picture; a tap opens that row's
//                          sheet (the page's own, hk-timeline.js openSheet). A refusal (a role with no Timeline) hides it.
//
// Both read the way the page does -- client.callApi('GET', 'timeline?...'), 'timeline/summary' and the live
// subscription 'timeline/subscribe' -- and draw nothing of their own that the page's pure part (window.hkTimeline.lib,
// hk-timeline.js, loaded on first use) already says. Mantel's own: a host with no Timeline (Home Assistant's HK
// Frontend) never offers either (hkShell.hostPage), and a layout that has the block draws a stand-in there.
//
// THE PURE PART is first and has no DOM (window.hkTimelineBlock.lib): tests/test_timeline_block.py runs it in node.
(function () {
  'use strict';
  if (window.hkTimelineBlock) return;                 // double-load guard

  // ======================================================================== pure
  var LIMIT = { W: 5, L: 8, XL: 12 };                 // the rows a block asks for, by size
  var ROW_H = { W: 36, L: 52, XL: 52 };               // a row's height (Wide: one line; the rest: a title and a line under it)
  var HEAD = 25;                                      // the label's line and the gap under it
  var STRIP_MAX = 10;                                 // the camera strip's events
  var MODES = ['auto', 'latest', 'digest'];

  // the page's pure part, once hk-timeline.js has loaded (the file is lazy: ensureLib() asks for it)
  function T() { return (window.hkTimeline && window.hkTimeline.lib) || null; }

  function showOf(v) { return v === 'latest' || v === 'digest' ? v : 'auto'; }
  // WHAT SHOWS NOW, 'digest' or 'latest': Automatic is the digest from 5 to 11 AM at the house (the page's own
  // window for its top card), the rows after; the other two are what they say
  function viewNow(show, nowMs, ctx) {
    var s = showOf(show);
    if (s !== 'auto') return s;
    return T().summaryWindow(nowMs, ctx) === 'overnight' ? 'digest' : 'latest';
  }
  function limitOf(size) { return LIMIT[size] || LIMIT.L; }
  // HOW THE ROWS LAY OUT in `ih` px under the label: Extra Large runs two columns, the others one; as many rows as
  // fit, never more than the size asks for
  function layoutOf(size, ih) {
    var rowH = ROW_H[size] || ROW_H.L, cols = size === 'XL' ? 2 : 1;
    var per = Math.max(1, Math.floor(((ih > 0 ? ih : 0) - HEAD) / rowH));
    return { cols: cols, per: per, rowH: rowH, n: Math.min(limitOf(size), per * cols) };
  }

  // the day a row is from, in a word: '' for today, 'Yesterday', else the weekday ("Sun")
  function dayWord(ev, nowMs, ctx) {
    var L = T(), ms = ev.at * 1000, k = L.dayKey(ms, ctx), today = L.dayKey(nowMs, ctx);
    if (k === today) return '';
    if (k === L.shiftKey(today, -1)) return 'Yesterday';
    try { return new Intl.DateTimeFormat((ctx && ctx.tag) || 'en-US', { weekday: 'short', timeZone: ctx && ctx.zone }).format(ms); }
    catch (e) { return ''; }
  }
  // one row as the block draws it: {id, icon, color, warn, title, time, day, sub, thumb, thumbs}.
  // sub: who did it when the server says (never a name it did not send), else the room; and the count line
  function rowView(ev, nowMs, ctx) {
    var L = T(), look = L.lookOf(ev), warn = ev.level === 'warning', cnt = L.countLine(ev, ctx);
    // a block keeps to a name and a device; "by hand or an automation" is the page's to say (the room instead)
    var who = ev.who && ev.who.how !== 'hand_or_automation' ? L.whoLine(ev.who) : '';
    var pics = Array.isArray(ev.pics) ? ev.pics : [];
    return {
      id: ev.id, icon: look.icon, color: warn && look.color === 'gray' ? 'orange' : look.color, warn: warn,
      title: String(ev.title || ''), time: L.timeText(ev.at * 1000, ctx), day: dayWord(ev, nowMs, ctx),
      sub: [who || ev.area_name || '', cnt || ''].filter(Boolean).join(' · '),
      thumb: pics.length && pics[0] && pics[0].url ? pics[0].url : '', thumbs: pics.length
    };
  }
  // a row's time in a Wide block, which has no line for the day: "Yest. 10:28 PM"
  function wideTime(r) { return (r.day ? (r.day === 'Yesterday' ? 'Yest.' : r.day) + ' ' : '') + r.time; }
  // the rows to draw: newest first, the newest `n`
  function pick(events, n) { return (events || []).slice().sort(T().byTime).slice(0, Math.max(0, n)); }
  function merge(list, incoming, keep) { return pick(T().mergeEvents(list || [], incoming || []), keep); }
  // THE DIGEST AS THE BLOCK DRAWS IT: its label, its title, the lines it has room for (the page's own wording of a quiet
  // night when it sent none)
  function digestView(sum, room) {
    var L = T(), m = L.summaryView(sum), lines = m.lines.slice(), chips = m.chips;
    var label = sum && typeof sum === 'object' && sum.label ? String(sum.label) : (sum && sum.window === 'overnight' ? 'Overnight' : 'Today');
    if (!lines.length && chips.length) lines = [chips.map(function (c) { return c.label + ' ' + c.n; }).join(' · ')];
    var shown = lines.slice(0, room === undefined ? 3 : Math.max(1, room));
    return { label: label, title: m.title === label ? '' : m.title, lines: shown, more: lines.length - shown.length };
  }
  var EMPTY = 'Nothing yet today.';
  function errorWord(err) {
    var code = err && (err.code || err.error), status = err && err.status;
    return code === 'forbidden' || status === 403 ? 'The Timeline isn’t part of this account.' : 'Couldn’t load recent events.';
  }
  // THE STRIP'S WORDS: "Person" for "Person at Driveway Cam" (it is that camera's strip), "Doorbell" for a ring
  function shortTitle(ev) {
    var t = String(ev.title || ''), m = /^(Person|Vehicle|Animal|Package|Motion) at /.exec(t);
    if (m) return m[1];
    if (/^Someone rang /.test(t)) return 'Doorbell';
    return t;
  }
  // a strip card: {id, icon, color, title, time, day, thumb}
  function stripView(ev, nowMs, ctx) {
    var r = rowView(ev, nowMs, ctx);
    return { id: ev.id, icon: r.icon, color: r.color, title: shortTitle(ev), time: r.time, day: r.day, thumb: r.thumb };
  }
  function stripPath(camera) { return 'timeline?camera=' + encodeURIComponent(camera) + '&limit=' + STRIP_MAX; }
  function stripMessage(camera) { return { type: 'timeline/subscribe', camera: camera }; }
  function blockPath(size) { return 'timeline?limit=' + limitOf(size); }

  var LIB = {
    LIMIT: LIMIT, ROW_H: ROW_H, HEAD: HEAD, STRIP_MAX: STRIP_MAX, MODES: MODES, EMPTY: EMPTY, showOf: showOf, viewNow: viewNow,
    limitOf: limitOf, layoutOf: layoutOf, dayWord: dayWord, rowView: rowView, wideTime: wideTime, pick: pick, merge: merge,
    digestView: digestView, errorWord: errorWord, shortTitle: shortTitle, stripView: stripView, stripPath: stripPath,
    stripMessage: stripMessage, blockPath: blockPath
  };
  window.hkTimelineBlock = { version: '1.0.0', lib: LIB };

  // ======================================================================== the cards
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-timeline-block] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  // the page's pure part (and its sheet) is a lazy file of its own: ask for it by name, once
  var libWait = null;
  function ensureLib() {
    if (T()) return Promise.resolve(true);
    if (!libWait) {
      var N = window.hkNeed;
      libWait = Promise.resolve(N && typeof N.file === 'function' ? N.file('hk-timeline.js') : null)
        .then(function () { return !!T(); }, function () { return false; })
        .then(function (ok) { if (!ok) libWait = null; return ok; });
    }
    return libWait;
  }
  function hostHas() {
    var SH = window.hkShell;
    try { return !!(SH && typeof SH.hostPage === 'function' && SH.hostPage('timeline')); } catch (e) { return false; }
  }

  whenBase(function (C) {
  if (window.hkTimelineBlock.card) return;
  var HkBase = C.HkBase, register = C.register, esc = C.esc, v = C.v, ACC = C.ACCENTS;

  function ctxNow() {
    var Lc = window.hkLocale;
    try { return { tag: Lc ? Lc.tag() : 'en-US', zone: Lc ? Lc.zone() : undefined, hour12: Lc ? Lc.hour12() : undefined }; }
    catch (e) { return { tag: 'en-US' }; }
  }
  function sizeOf(el) {
    var s = (el.getAttribute && el.getAttribute('size')) || (el._config || {}).size;
    return /^(W|L|XL)$/.test(s || '') ? s : null;
  }
  function tint(name, a) {
    var rgb = (C.PALETTE && C.PALETTE.chart && C.PALETTE.chart[name]) || (name === 'brown' ? [162, 132, 94] : [142, 142, 147]);
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }
  function inkOf(name) {
    var p = C.PALETTE && C.PALETTE.icon && C.PALETTE.icon[name];
    return p || (name === 'brown' ? 'rgb(162,132,94)' : 'rgba(200,200,200,0.85)');
  }
  function icon(name, px) { return '<hk-icon icon="' + esc(name) + '" style="--mdc-icon-size:' + px + 'px;width:' + px + 'px;height:' + px + 'px"></hk-icon>'; }
  // the block in px inside its inset: the view's measure, else a square cell's (as the other blocks' inner())
  var SQ_BLOCK = { W: [405, 196], L: [405, 405], XL: [614, 405] };
  function inner(card, size) {
    if (card._watchBlock) card._watchBlock();
    var b = card._block ? card._block() : null, d = SQ_BLOCK[size] || SQ_BLOCK.L, pad = 18;
    try { pad = parseFloat(getComputedStyle(card).getPropertyValue('--hk-block-pad')) || 18; } catch (e) { pad = 18; }
    return { iw: (b ? b.w : d[0]) - 2 * pad, ih: (b ? b.h : d[1]) - 2 * pad };
  }

  // ---- what both read: the rows, the live feed, one place that starts it and stops it
  class HkTimelineFeed extends HkBase {
    // overridden: the path read, the live message, and how many rows are kept
    _path() { return 'timeline?limit=10'; }
    _message() { return { type: 'timeline/subscribe' }; }
    _keep() { return 10; }

    setConfig(config) {
      this._events = [];
      this._state = 'loading';                         // loading | ready | error
      this._err = null;
      this._started = false;
      this._seq = 0;
      super.setConfig(config || {});
    }
    // drawn from its own rows: the house's states are not its data
    _sigOf() { return 'timeline-feed'; }
    _receiveClient() {
      super._receiveClient();
      if (!this._started && this.client && this._config) { this._started = true; this._begin(); }
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this._started && this._lib) { this._subscribe(); this._load(true); }
      this._onConnect();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      this._unsubscribe();
      this._onDisconnect();
    }
    _onConnect() {}
    _onDisconnect() {}
    _begin() {
      var self = this;
      ensureLib().then(function (ok) {
        if (!ok) return;
        self._lib = true;
        self._beginData();
        self._load(false);
        self._subscribe();
      });
    }
    _beginData() {}
    _read(path) {
      var c = this.client;
      if (!c || typeof c.callApi !== 'function') return Promise.reject(Object.assign(new Error('no client'), { code: 'unavailable' }));
      try { return Promise.resolve(c.callApi('GET', path)); } catch (e) { return Promise.reject(e); }
    }
    _load(quiet) {
      var seq = ++this._seq, self = this;
      if (!quiet) { this._state = 'loading'; this._err = null; }
      this._read(this._path()).then(function (res) {
        if (seq !== self._seq) return;
        self._took(res || {});
        self._events = Array.isArray(res && res.events) ? pick(res.events, self._keep()) : [];
        self._state = 'ready';
        self._err = null;
        self._loadedAt = Date.now();
        self._paint();
      }, function (err) {
        if (seq !== self._seq) return;
        if (quiet && self._state === 'ready') return;
        self._state = 'error';
        self._err = err;
        self._paint();
      });
    }
    // eslint-disable-next-line no-unused-vars
    _took(_res) {}
    _subscribe() {
      this._unsubscribe();
      var c = this.client, conn = c && c.subscriptions, self = this, token = this._subToken = (this._subToken || 0) + 1;
      if (!conn || typeof conn.subscribeMessage !== 'function') return;
      this._readyOnce = false;
      try {
        Promise.resolve(conn.subscribeMessage(function (ev) { if (token === self._subToken) self._live(ev); }, this._message()))
          .then(function (u) { if (token !== self._subToken) { try { u(); } catch (e) { /* gone */ } return; } self._unsub = u; },
                function () { /* no live feed here: what was read stands */ });
      } catch (e) { /* the same */ }
    }
    _unsubscribe() {
      this._subToken = (this._subToken || 0) + 1;
      var u = this._unsub;
      this._unsub = null;
      if (typeof u === 'function') { try { var r = u(); if (r && r.catch) r.catch(function () {}); } catch (e) { /* gone */ } }
    }
    _live(ev) {
      if (!ev) return;
      if (ev.ready) {
        // a socket that came back: what happened meanwhile is read again
        if (this._readyOnce && this._state === 'ready') this._load(true);
        this._readyOnce = true;
        return;
      }
      if (!Array.isArray(ev.events) || this._state !== 'ready') return;
      this._events = merge(this._events, ev.events.filter(this._wants.bind(this)), this._keep());
      this._paint();
    }
    _wants() { return true; }
    _paint() { if (this._built) this._render(); }
  }

  // ======================================================================== the Home Grid block
  var NOW_MS = 60 * 1000;                              // the hour is looked at once a minute (Automatic's switch at 11)
  var SUMMARY_MS = 10 * 60 * 1000;
  var BLOCK_CSS = [
    ':host{display:block;height:100%}',
    'hk-plate.tb{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;',
    '  padding:' + C.blockPad('14px') + ';' + C.plate('card') + ';color:' + v('ink') + ';-webkit-tap-highlight-color:transparent}',
    '.wl{font-size:15px;font-weight:600;line-height:19px;letter-spacing:0.2px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}',
    '.ws{font-size:15px;font-weight:500;line-height:19px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}',
    '.hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:none;margin-bottom:6px}',
    '.cols{display:flex;gap:22px;flex:1;min-height:0}',
    '.col{flex:1 1 0;min-width:0;display:flex;flex-direction:column}',
    '.r{display:flex;align-items:center;gap:10px;box-sizing:border-box;height:52px;flex:none;border-bottom:1px solid ' + v('line') + '}',
    '.r:last-child{border-bottom:0}',
    '.r .ic{width:32px;height:32px;border-radius:16px;flex:none;display:flex;align-items:center;justify-content:center}',
    '.r .tx{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}',
    '.r .ti{font-size:15px;font-weight:600;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.r .sb{font-size:13px;font-weight:500;line-height:16px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.r .tm{flex:none;font-size:13px;font-weight:500;line-height:19px;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.r img{width:56px;height:36px;border-radius:7px;object-fit:cover;flex:none;display:block;background:' + v('key') + '}',
    '.r.w{height:36px}.r.w .ic{width:24px;height:24px;border-radius:12px}',
    '.r.w .ti{font-size:15px}',
    // the digest: its lines, each as the page says it
    '.dg{display:flex;flex-direction:column;gap:5px;min-height:0;overflow:hidden}',
    '.dg .l{font-size:16px;font-weight:600;line-height:21px;letter-spacing:-0.15px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}',
    '.dg.w .l{font-size:15px;line-height:19px;-webkit-line-clamp:1}',
    '.dg .sub{font-size:13px;font-weight:500;line-height:17px;color:' + v('ink-2') + ';display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin-bottom:3px}',
    '.dg .mr{font-size:13px;font-weight:500;color:' + v('ink-2') + '}',
    '.xl-l{flex:0 0 190px;min-width:0;display:flex;flex-direction:column;gap:6px}',
    '.none{margin:auto;font-size:15px;font-weight:500;color:' + v('ink-2') + ';text-align:center}',
    '.sk{display:flex;align-items:center;gap:10px;height:52px;flex:none}',
    '.sk i{display:block;background:' + v('key') + ';border-radius:8px}',
    '.sk .a{width:32px;height:32px;border-radius:16px;flex:none}',
    '.sk .b{flex:1;display:flex;flex-direction:column;gap:7px}.sk .b i{height:12px}.sk .b i + i{width:50%;height:10px}',
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}',
    '.sks{animation:pulse 1.4s ease-in-out infinite}',
    '@media (prefers-reduced-motion:reduce){.sks{animation:none}}'
  ].join('');

  class HkTimelineBlockCard extends HkTimelineFeed {
    static get CSS() { return BLOCK_CSS; }
    getCardSize() { return 4; }

    _size() { return sizeOf(this) || 'L'; }
    _keep() { return limitOf(this._size()); }
    _path() { return blockPath(this._size()); }
    _show() { return showOf((this._config || {}).show); }
    // (the plate's tap, hk-base.js openTarget): the Timeline page of this screen; none on a screen without it
    _tapTarget() { return [{ page: 'timeline' }]; }
    _sigOf() { return 'timeline-block'; }

    setConfig(config) {
      this._summary = null;
      this._summaryErr = false;
      this._summaryAt = 0;
      super.setConfig(config);
    }
    _onConnect() {
      var self = this;
      clearInterval(this._tick);
      this._tick = setInterval(function () { self._clock(); }, NOW_MS);
      if (this._lib) this._clock();
    }
    _onDisconnect() { clearInterval(this._tick); this._tick = null; }
    // the hour or the day turned: Automatic may be showing the other thing, and a row's day word has moved on
    _clock() {
      if (!this._lib) return;
      var key = this._viewKey();
      if (key === this._seen) return;
      this._seen = key;
      this._loadSummary();
      this._paint();
    }
    _viewKey() { var ctx = ctxNow(), now = Date.now(); return viewNow(this._show(), now, ctx) + '|' + T().dayKey(now, ctx); }
    _beginData() { this._seen = this._viewKey(); }
    _took(res) { this._limited = !!(res && res.limited); }

    // the morning summary, read again only when it is wanted and ten minutes old
    _loadSummary() {
      var now = Date.now(), self = this;
      if (viewNow(this._show(), now, ctxNow()) !== 'digest') return;
      if (this._summary && now - this._summaryAt < SUMMARY_MS) return;
      this._summaryAt = now;
      this._read('timeline/summary?window=overnight').then(function (res) {
        self._summary = res && typeof res === 'object' ? res : null;
        self._summaryErr = false;
        self._paint();
      }, function () {
        self._summaryErr = true;                       // the rows stand in for it
        self._paint();
      });
    }
    _load(quiet) {
      super._load(quiet);
      this._summaryAt = 0;
      this._loadSummary();
    }

    _render() {
      if (!this._built) {
        this._built = true;
        this._root.innerHTML = '<hk-plate class="tb" data-hk-role="card" role="group" aria-label="Recent"></hk-plate>';
        this._plate = this._root.querySelector('hk-plate');
      }
      var size = this._size(), box = inner(this, size), html;
      var lab = function (text) { return '<div class="wl" style="color:' + ACC.teal + '">' + esc(text) + '</div>'; };
      if (!this._lib || this._state === 'loading') {
        var sk = '';
        for (var i = 0; i < (size === 'W' ? 2 : 4); i++) sk += '<div class="sk sks"><i class="a"></i><div class="b"><i></i><i></i></div></div>';
        html = '<div class="hd">' + lab('Recent') + '</div><div class="cols"><div class="col" aria-busy="true">' + sk + '</div></div>';
      } else if (this._state === 'error') {
        html = '<div class="hd">' + lab('Recent') + '</div><div class="none">' + esc(errorWord(this._err)) + '</div>';
      } else {
        var ctx = ctxNow(), now = Date.now(), shown = viewNow(this._show(), now, ctx);
        if (shown === 'digest' && this._summary && !this._summaryErr) html = this._digest(size, box, ctx);
        else html = this._latest(size, box, ctx, now);
      }
      C.morph(this._plate, html);
    }

    _latest(size, box, ctx, now) {
      var lay = layoutOf(size, box.ih), rows = pick(this._events, lay.n).map(function (ev) { return rowView(ev, now, ctx); });
      var head = '<div class="hd"><div class="wl" style="color:' + ACC.teal + '">Recent</div></div>';
      if (!rows.length) return head + '<div class="none">' + esc(EMPTY) + '</div>';
      var wide = size === 'W';
      function row(r) {
        var sub = !wide && (r.day || r.sub) ? [r.day, r.sub].filter(Boolean).join(' · ') : '';
        var col = r.color;
        return '<div class="r' + (wide ? ' w' : '') + (r.warn ? ' warn' : '') + '">' +
          '<div class="ic" style="background:' + tint(col, 0.22) + ';color:' + inkOf(col) + '">' + icon(r.icon, wide ? 16 : 20) + '</div>' +
          '<div class="tx"><div class="ti">' + esc(r.title) + '</div>' + (sub ? '<div class="sb">' + esc(sub) + '</div>' : '') + '</div>' +
          (!wide && r.thumb ? '<img src="' + esc(r.thumb) + '" alt="" loading="lazy" decoding="async" draggable="false">' : '') +
          '<div class="tm">' + esc(wide ? wideTime(r) : r.time) + '</div></div>';
      }
      var cols = [];
      for (var c = 0; c < lay.cols; c++) cols.push(rows.slice(c * lay.per, (c + 1) * lay.per));
      return head + '<div class="cols">' + cols.filter(function (x) { return x.length; }).map(function (x) {
        return '<div class="col">' + x.map(row).join('') + '</div>';
      }).join('') + '</div>';
    }

    _digest(size, box, ctx) {
      var wide = size === 'W', xl = size === 'XL';
      var per = Math.max(1, Math.floor((box.ih - (xl ? 0 : HEAD) - (size === 'L' ? 40 : 0)) / (wide ? 24 : 50)));
      var d = digestView(this._summary, per);
      var more = d.more > 0 ? '<div class="mr">+' + d.more + ' more</div>' : '';
      var lines = d.lines.map(function (l) { return '<div class="l">' + esc(l) + '</div>'; }).join('');
      var head = '<div class="hd"><div class="wl" style="color:' + ACC.teal + '">' + esc(d.label) + '</div></div>';
      if (size === 'XL') {
        return '<div class="cols"><div class="xl-l"><div class="wl" style="color:' + ACC.teal + '">' + esc(d.label) + '</div>' +
          (d.title ? '<div class="sub" style="-webkit-line-clamp:4">' + esc(d.title) + '</div>' : '') + '</div><div class="col dg">' + lines + more + '</div></div>';
      }
      return head + '<div class="dg' + (wide ? ' w' : '') + '">' + (d.title && !wide ? '<div class="sub">' + esc(d.title) + '</div>' : '') + lines + more + '</div>';
    }
  }

  // ======================================================================== the camera strip
  var STRIP_H = 150;                                   // the strip's height under the picture, as the sheet reserves it
  var STRIP_EMPTY_H = 58;
  var STRIP_CSS = [
    ':host{display:block;color:' + v('ink') + '}',
    ':host([hidden]){display:none}',
    '.st{box-sizing:border-box;height:' + STRIP_H + 'px;padding:12px 0 14px;background:rgba(255,255,255,0.05);border-top:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:8px;overflow:hidden}',
    '.st.empty{height:' + STRIP_EMPTY_H + 'px;justify-content:center}',
    '.st .k{flex:none;padding:0 18px;font-size:12px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;line-height:16px;color:' + v('ink-2') + '}',
    '.st .none{padding:0 18px;font-size:14px;line-height:18px;color:' + v('ink-2') + '}',
    '.sc{flex:1;min-height:0;display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;padding:0 18px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;overscroll-behavior-x:contain}',
    '.sc::-webkit-scrollbar{display:none}',
    '.c{all:unset;box-sizing:border-box;flex:none;width:114px;display:flex;flex-direction:column;gap:5px;cursor:pointer;scroll-snap-align:start;-webkit-tap-highlight-color:transparent}',
    '.c:active{opacity:.7}',
    '.c:focus-visible{outline:2px solid rgba(100,181,255,.8);outline-offset:3px;border-radius:10px}',
    '.c .p{width:114px;height:64px;border-radius:10px;background:rgba(255,255,255,0.08);overflow:hidden;display:flex;align-items:center;justify-content:center;flex:none;position:relative}',
    '.c .p img{width:100%;height:100%;object-fit:cover;display:block}',
    '.c .t{font-size:13px;font-weight:600;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.c .m{font-size:12px;font-weight:500;line-height:15px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}'
  ].join('');

  class HkTimelineStripCard extends HkTimelineFeed {
    static get CSS() { return STRIP_CSS; }
    getCardSize() { return 2; }
    _camera() { return String((this._config || {}).camera || ''); }
    _path() { return stripPath(this._camera()); }
    _message() { return stripMessage(this._camera()); }
    _keep() { return STRIP_MAX; }
    _wants(ev) { return !!ev && ev.entity === this._camera(); }
    _sigOf() { return 'timeline-strip'; }

    setConfig(config) {
      if (!config || !config.camera) throw new Error('hk-timeline-strip-card: camera is required');
      this.hidden = true;                              // nothing to say yet, and a refusal says nothing at all
      this._room = -1;
      super.setConfig(config);
    }
    _onConnect() { this._tellRoom(true); }
    // the sheet reserves what the strip takes, so the picture is never pushed off the screen
    _tellRoom(force) {
      var h = this.hidden ? 0 : ((this._events && this._events.length) ? STRIP_H : STRIP_EMPTY_H);
      if (!force && h === this._room) return;
      this._room = h;
      try { this.dispatchEvent(new CustomEvent('hk-strip-room', { detail: { height: h }, bubbles: false })); } catch (e) { /* no events here */ }
    }
    _render() {
      if (!this._built) {
        this._built = true;
        this._root.innerHTML = '<div class="st" role="region" aria-label="Recent events at this camera"></div>';
        this._st = this._root.querySelector('.st');
        var self = this;
        this._root.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('[data-i]') : null;
          if (b) self._open(b.getAttribute('data-i'));
        });
      }
      var ready = this._lib && this._state === 'ready';
      // a camera with nothing recorded says so in one line; loading and a refusal show nothing
      this.hidden = !ready;
      if (!ready) { this._tellRoom(false); return; }
      var ctx = ctxNow(), now = Date.now(), cards = this._events.map(function (ev) { return stripView(ev, now, ctx); });
      var html;
      if (!cards.length) {
        html = '<div class="k">Recent</div><div class="none">Nothing recorded for this camera yet.</div>';
        this._st.className = 'st empty';
      } else {
        this._st.className = 'st';
        html = '<div class="k">Recent</div><div class="sc">' + cards.map(function (c) {
          var col = c.color;
          var pic = c.thumb ? '<img src="' + esc(c.thumb) + '" alt="" loading="lazy" decoding="async" draggable="false">'
                            : '<span style="color:' + inkOf(col) + '">' + icon(c.icon, 26) + '</span>';
          return '<button type="button" class="c" data-i="' + esc(c.id) + '" aria-label="' + esc(c.title + ', ' + (c.day ? c.day + ' ' : '') + c.time) + '">' +
            '<div class="p"' + (c.thumb ? '' : ' style="background:' + tint(col, 0.22) + '"') + '>' + pic + '</div>' +
            '<div class="t">' + esc(c.title) + '</div><div class="m">' + esc((c.day ? c.day + ' ' : '') + c.time) + '</div></button>';
        }).join('') + '</div>';
      }
      C.morph(this._st, html);
      this._tellRoom(false);
    }
    _open(id) {
      var ev = null, i;
      for (i = 0; i < this._events.length; i++) if (String(this._events[i].id) === String(id)) ev = this._events[i];
      var P = window.hkTimeline;
      if (ev && P && typeof P.openSheet === 'function') P.openSheet(ev, this.client, { noAll: true });
    }
  }

  register('hk-timeline-block-card', HkTimelineBlockCard, 'HK Recent', 'The last events at the house, or in the morning how the night went. Made for a Home Grid, where the host keeps a timeline.');
  register('hk-timeline-strip-card', HkTimelineStripCard, 'HK Recent Strip', 'The last events of one camera, under its live view. Made for the camera sheet, where the host keeps a timeline.');
  // blocks and strips, never cards to add by hand
  if (C.unlisted) { C.unlisted('hk-timeline-block-card'); C.unlisted('hk-timeline-strip-card'); }
  window.hkTimelineBlock.card = HkTimelineBlockCard;
  window.hkTimelineBlock.strip = HkTimelineStripCard;
  window.hkTimelineBlock.hostHas = hostHas;
  });
})();
