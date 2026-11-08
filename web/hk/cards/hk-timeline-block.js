// @ts-check
// hk-timeline-block.js -- the House Timeline in two small places (docs/phase19/HOUSE-TIMELINE.md, "The views").
//
// hk-timeline-block-card   the Home Grid block "Recent" (`timeline` in hk-grid-catalog.js; S, W, T, L, XL), reworked
//                          2026-11-08 (docs/phase11/CARDS-AND-SHEETS-REVIEW.md, "Round two"): rows in the Timeline
//                          page's look -- each its glyph in its kind's color or its picture, the thing, the room and
//                          who, how long ago -- of a fixed height per size, "N more" in the label's line; the latest
//                          picture large (else the newest event) at Tall, Large and Extra Large; Small HomeView's tile
//                          of the newest event. Its `show` is Automatic (the morning summary from 5 to 11 AM, the
//                          latest rows after), Latest Events, or Morning Summary -- the summary as glyphs: a status and
//                          the night's kinds as tiles with their counts. Live. A row opens what it stands for (its
//                          camera, its thing, else its sheet on the Timeline); the plate opens the Timeline page. A
//                          wall tablet alone gets the limited view because the server hands it one: no names, and
//                          pictures only when its Owner turned them on for that tablet (what comes back is drawn).
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
  // THE BLOCK REWORKED (2026-11-08, the owner: "just essentially text on a card. No glyphs, no pictures, nothing...
  // Please rework this completely"): every row its glyph in its kind's color (the Timeline page's), the thing and what
  // it did, the room, a relative time, its picture; the latest picture large where there is room; the morning summary
  // as glyphs and counts. A block reads the newest READ rows -- what it shows, and "N more" for the rest.
  var READ = 25;
  var LIMIT = { S: 1, W: READ, T: READ, L: READ, XL: READ };       // the rows a block asks for, by size
  // NOTHING STRETCHES (2026-11-08, the owner: "entities in a card should maintain dimensions"): a row is 44 on Wide
  // and Tall, 56 on Large and Extra Large, whatever room is left; the block shows as many as fit and gives the rest to
  // the picture (made to be large) or to a quiet line
  var ROW_H = { W: 44, T: 44, L: 56, XL: 56 };
  var KIND_TILE = { big: [108, 76], small: [80, 44] };              // the morning summary's kinds, as tiles (w, h)
  var HEAD = 27;                                                     // the label's line and the gap under it
  var STRIP_MAX = 10;                                                // the camera strip's events
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
  function limitOf(size) { return LIMIT[size] || READ; }
  // HOW MANY WHOLE ROWS OF `h` FIT in `room` px, of `have`; and what is left (`rest`)
  function rowsFit(have, room, h) {
    room = room > 0 ? room : 0;
    var n = Math.max(0, Math.min(have, Math.floor(room / h)));
    return { n: n, h: h, rest: room - n * h };
  }
  // A GROUP OF `n` TILES OF w x h (gap g) IN W x H: how many fit, in how many columns and rows -- the group is then
  // centered in its place, a short last row centered too (flex-wrap), never a tile grown to fill
  function fitGrid(n, W, H, w, h, g) {
    var cols = Math.max(1, Math.floor((W + g) / (w + g))), rows = Math.max(1, Math.floor((H + g) / (h + g)));
    var shown = Math.min(n, cols * rows);
    return { n: shown, cols: Math.min(cols, shown) || 1, rows: Math.ceil(shown / Math.max(1, Math.min(cols, shown))) };
  }

  // the day a row is from, in a word: '' for today, 'Yesterday', else the weekday ("Sun")
  function dayWord(ev, nowMs, ctx) {
    var L = T(), ms = ev.at * 1000, k = L.dayKey(ms, ctx), today = L.dayKey(nowMs, ctx);
    if (k === today) return '';
    if (k === L.shiftKey(today, -1)) return 'Yesterday';
    try { return new Intl.DateTimeFormat((ctx && ctx.tag) || 'en-US', { weekday: 'short', timeZone: ctx && ctx.zone }).format(ms); }
    catch (e) { return ''; }
  }
  // HOW LONG AGO, as a glance says it: "Now", "4 min", "2 hr" (to six hours), then the clock today, "Yesterday", the
  // weekday. `long`: "4 min ago", "Yesterday, 10:28 PM" -- for a tile or a picture's caption, where it stands alone
  function ago(ev, nowMs, ctx, long) {
    var ms = ev.at * 1000, m = Math.floor((nowMs - ms) / 60000), day = dayWord(ev, nowMs, ctx), L = T();
    if (!day && m < 1) return long ? 'Just now' : 'Now';
    if (!day && m < 60) return m + ' min' + (long ? ' ago' : '');
    if (!day && m < 360) return Math.floor(m / 60) + ' hr' + (long ? ' ago' : '');
    if (!day) return L.timeText(ms, ctx);
    return long ? day + ', ' + L.timeText(ms, ctx) : day;
  }
  // THE TWO HALVES OF A TITLE (the server's words, hk_core/timeline/words.py): {a: what it is, b: what it did or where}
  // -- "Front Door" / "Unlocked", "Person" / "Front Door", "Doorbell" / "Front Door", "Alex" / "Arrived home"; a title
  // it has no words for is `a` alone
  var RANG = /^Someone rang (.+)$/, SEEN_AT = /^(Person|Vehicle|Animal|Package|Motion|Leak|Smoke|Carbon monoxide|Gas) at (.+)$/;
  var DID = /^(.+?) (opened|closed|locked|unlocked|is jammed|jammed|keeps changing(?: \(\d+ times\))?|armed [a-z ()]+|disarmed|triggered|arrived home|left home|is clear)$/;
  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function halves(ev) {
    var t = String(ev.title || ''), m;
    if (ev.family === 'system' || ev.family === 'refused') return { a: t, b: '' };
    if ((m = RANG.exec(t))) return { a: 'Doorbell', b: m[1] };
    if ((m = SEEN_AT.exec(t))) return { a: m[1], b: m[2] };
    if ((m = DID.exec(t))) return { a: m[1], b: cap(m[2].replace(/^is /, '').replace(/ \(\d+ times\)$/, '')) };
    return { a: t, b: '' };
  }
  // one row as the block draws it: {id, icon, color, warn, title, a, b, time, day, ago, sub, room, thumb, thumbs,
  // family, entity, ev}. sub: who did it when the server says (never a name it did not send), else the room; and the
  // count line
  function rowView(ev, nowMs, ctx) {
    var L = T(), look = L.lookOf(ev), warn = ev.level === 'warning', cnt = L.countLine(ev, ctx), h = halves(ev);
    // a block keeps to a name and a device; "by hand or an automation" is the page's to say (the room instead)
    var who = ev.who && ev.who.how !== 'hand_or_automation' ? L.whoLine(ev.who) : '';
    var pics = Array.isArray(ev.pics) ? ev.pics.filter(function (p) { return p && p.url; }) : [];
    return {
      id: ev.id, icon: look.icon, color: warn && look.color === 'gray' ? 'orange' : look.color, warn: warn,
      title: String(ev.title || ''), a: h.a, b: h.b, time: L.timeText(ev.at * 1000, ctx), day: dayWord(ev, nowMs, ctx),
      ago: ago(ev, nowMs, ctx), agoLong: ago(ev, nowMs, ctx, true), room: ev.area_name ? String(ev.area_name) : '',
      sub: [who || ev.area_name || '', cnt || ''].filter(Boolean).join(' · '),
      thumb: pics.length ? pics[0].url : '', thumbs: pics.length, family: ev.family, entity: ev.entity ? String(ev.entity) : ''
    };
  }
  // a row's time in a Wide block, which has no line for the day: "Yest. 10:28 PM"
  function wideTime(r) { return (r.day ? (r.day === 'Yesterday' ? 'Yest.' : r.day) + ' ' : '') + r.time; }
  // the rows to draw: newest first, the newest `n`
  function pick(events, n) { return (events || []).slice().sort(T().byTime).slice(0, Math.max(0, n)); }
  function merge(list, incoming, keep) { return pick(T().mergeEvents(list || [], incoming || []), keep); }
  // THE PICTURE A BLOCK SHOWS LARGE: the newest row that kept one (null: none did)
  function heroOf(events) {
    var all = pick(events, (events || []).length);
    for (var i = 0; i < all.length; i++) if (Array.isArray(all[i].pics) && all[i].pics.some(function (p) { return p && p.url; })) return all[i];
    return null;
  }
  // WHAT A ROW'S TAP OPENS (hk-base.js openTarget's places): what it stands for -- a camera's row its camera (the row's
  // entity, else the camera on the same device in `entities`, the registry), a door's, a lock's, the alarm's, a
  // person's its own sheet when this house knows it (its state or its registry entry); Mantel's own rows (and anything else) the row's sheet on the
  // Timeline (`timeline`)
  var CAMERA_FAMILIES = { doorbell: 1, detection: 1, motion: 1 };
  function openOf(ev, states, entities) {
    var e = ev && ev.entity ? String(ev.entity) : '', fam = ev && ev.family;
    if (!e || fam === 'system' || fam === 'refused') return 'timeline';
    if (CAMERA_FAMILIES[fam] && e.indexOf('camera.') !== 0) {
      var dev = entities && entities[e] && entities[e].device_id, cam = '';
      if (dev) Object.keys(entities).forEach(function (k) { if (!cam && k.indexOf('camera.') === 0 && entities[k] && entities[k].device_id === dev) cam = k; });
      if (cam) e = cam;
    }
    // (known by its state, or by the registry: a client loads states as they are wanted)
    return (states && states[e]) || (entities && entities[e]) ? e : 'timeline';
  }
  // THE DIGEST AS THE BLOCK DRAWS IT: its label, its title, the lines it has room for (the page's own wording of a quiet
  // night when it sent none)
  function digestView(sum, room) {
    var L = T(), m = L.summaryView(sum), lines = m.lines.slice(), chips = m.chips;
    var label = sum && typeof sum === 'object' && sum.label ? String(sum.label) : (sum && sum.window === 'overnight' ? 'Overnight' : 'Today');
    if (!lines.length && chips.length) lines = [chips.map(function (c) { return c.label + ' ' + c.n; }).join(' · ')];
    var shown = lines.slice(0, room === undefined ? 3 : Math.max(1, room));
    return { label: label, title: m.title === label ? '' : m.title, lines: shown, more: lines.length - shown.length };
  }
  // THE DIGEST AS GLYPHS (2026-11-08): {label, span: "9 PM to 7 AM", status: {icon, color, line, sub}, counts: [{id,
  // label, n, icon, color}], quiet, n}. The status is what the digest leads with: something still open or unlocked
  // (orange), a quiet night (the moon), else how the house is right now (green); the counts are the kinds, in the
  // page's order, each with its glyph
  var KIND_LOOK = { doors: ['hk:door-open', 'orange', 'Doors'], locks: ['hk:lock', 'green', 'Locks'], garage: ['hk:garage-open', 'orange', 'Garage'],
                    alarm: ['hk:shield-home', 'red', 'Alarm'], people: ['hk:location-enter', 'green', 'Arrivals'],
                    doorbell: ['hk:doorbell-video', 'orange', 'Doorbell'], cameras: ['hk:cctv', 'blue', 'Cameras'],
                    safety: ['hk:water-alert', 'red', 'Safety'], system: ['hk:alert-circle', 'gray', 'System'] };
  var GROUP_OF = { door: 'doors', window: 'doors', lock: 'locks', garage: 'garage', alarm: 'alarm', arrival: 'people', doorbell: 'doorbell',
                   detection: 'cameras', motion: 'cameras', safety: 'safety', system: 'system', refused: 'system' };
  var LEADS = /( is still open| are still open| is unlocked| are unlocked| is jammed| are jammed)\.$/;
  function digestParts(sum) {
    sum = sum && typeof sum === 'object' ? sum : {};
    var overnight = sum.window === 'overnight', m = T().summaryView(sum);
    var label = sum.label ? String(sum.label) : (overnight ? 'Overnight' : 'Today');
    var span = /\(([^)]+)\)\s*$/.exec(String(sum.title || ''));
    var byGroup = {}, order = Object.keys(KIND_LOOK), n = 0;
    Object.keys(sum.counts || {}).forEach(function (f) {
      var g = GROUP_OF[f], c = sum.counts[f];
      if (g && typeof c === 'number' && c > 0) { byGroup[g] = (byGroup[g] || 0) + c; n += c; }
    });
    var counts = order.filter(function (g) { return byGroup[g]; }).map(function (g) {
      var k = KIND_LOOK[g];
      return { id: g, label: k[2], n: byGroup[g], icon: k[0], color: k[1] };
    });
    var lines = m.lines, lead = lines.filter(function (l) { return LEADS.test(l); }), right = '';
    lines.forEach(function (l) { if (/^Right now: /.test(l)) right = cap(l.replace(/^Right now: /, '').replace(/\.$/, '')); });
    var quiet = !!sum.quiet || (!n && !lead.length), status;
    if (lead.length) status = { icon: 'hk:alert-circle', color: 'orange', line: lead[0].replace(/\.$/, ''), sub: lead.length > 1 ? lead.slice(1).join(' ').replace(/\.$/, '') : right };
    else if (quiet) status = { icon: 'mdi:moon-waning-crescent', color: 'purple', line: overnight ? 'A quiet night' : 'A quiet day', sub: (lines[0] || '').replace(/^A quiet [a-z]+\.\s*/, '').replace(/\.$/, '') || (overnight ? 'Nothing happened overnight' : 'Nothing has happened yet') };
    else status = { icon: 'mdi:check-circle', color: 'green', line: right || (n + (n === 1 ? ' event ' : ' events ') + (overnight ? 'overnight' : 'today')),
                     sub: right ? n + (n === 1 ? ' event ' : ' events ') + (overnight ? 'overnight' : 'today') : '' };
    return { label: label, span: span ? span[1] : '', status: status, counts: counts, quiet: quiet, n: n,
             events: Array.isArray(sum.events) ? sum.events : [] };
  }
  var EMPTY = 'Nothing yet today.';
  var NEW_HOUSE = ['Nothing yet', 'Doors, locks and cameras show up here'];
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
    LIMIT: LIMIT, READ: READ, ROW_H: ROW_H, KIND_TILE: KIND_TILE, HEAD: HEAD, STRIP_MAX: STRIP_MAX, MODES: MODES, EMPTY: EMPTY,
    NEW_HOUSE: NEW_HOUSE, showOf: showOf, viewNow: viewNow, limitOf: limitOf, rowsFit: rowsFit, dayWord: dayWord, ago: ago,
    halves: halves, rowView: rowView, wideTime: wideTime, pick: pick, merge: merge, heroOf: heroOf, openOf: openOf,
    digestView: digestView, digestParts: digestParts, fitGrid: fitGrid, errorWord: errorWord, shortTitle: shortTitle,
    stripView: stripView, stripPath: stripPath, stripMessage: stripMessage, blockPath: blockPath
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
    return /^(S|W|T|L|XL)$/.test(s || '') ? s : null;
  }
  function tint(name, a) {
    var rgb = (C.PALETTE && C.PALETTE.chart && C.PALETTE.chart[name]) || (name === 'brown' ? [162, 132, 94] : [142, 142, 147]);
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }
  // (gray, a closed door's and a disarmed alarm's, is the theme's second ink: the icon palette's light gray vanished on
  // Flat Light, 2026-11-08)
  function inkOf(name) {
    if (name === 'gray' || name === 'grey') return v('ink-2');
    var p = C.PALETTE && C.PALETTE.icon && C.PALETTE.icon[name];
    return p || (name === 'brown' ? 'rgb(162,132,94)' : 'rgba(200,200,200,0.85)');
  }
  function icon(name, px) { return '<hk-icon icon="' + esc(name) + '" style="--mdc-icon-size:' + px + 'px;width:' + px + 'px;height:' + px + 'px"></hk-icon>'; }
  // the block in px inside its inset: the view's measure, else a square cell's (as the other blocks' inner())
  var SQ_BLOCK = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
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
  var NOW_MS = 60 * 1000;                              // once a minute: "4 min" moves on, and Automatic's switch at 11
  var SUMMARY_MS = 10 * 60 * 1000;
  var type = C.typeCss;
  var BLOCK_CSS = [
    ':host{display:block;height:100%}',
    // (the text glow on the plate, so every word on the glass carries it, as the widget blocks do)
    'hk-plate.tb{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;padding:' + C.blockPad('14px') + ';' +
      C.plate('card') + ';color:' + v('ink') + ';text-shadow:' + v('glow') + ';-webkit-tap-highlight-color:transparent}',
    '.wl{font-size:15px;font-weight:600;line-height:19px;letter-spacing:0.2px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}',
    // THE LABEL'S LINE: RECENT in teal, what is not shown ("9 more") or the digest's hours at its right
    '.hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:none;height:19px;margin-bottom:8px}',
    '.hd .mr{' + type('caption') + ';line-height:19px;color:' + v('ink-2') + ';white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.body{flex:1;min-height:0;display:flex;flex-direction:column}',
    '.cols{flex:1;min-height:0;display:flex;gap:18px}.cols>*{flex:1 1 0;min-width:0}',
    // A ROW (the Timeline page's): the glyph in its kind's color on its tint (or the row's picture), the thing over its
    // room and who, the time on the title's line; its height the size's own (ROW_H), a hairline between
    '.list{display:flex;flex-direction:column;min-height:0;flex:1}.list.mid{justify-content:center}.list.fit{flex:none}',
    '.r{position:relative;display:flex;align-items:center;gap:12px;flex:none;min-width:0;cursor:pointer;outline:none}',
    '.r + .r::before{content:"";position:absolute;top:0;left:56px;right:0;height:1px;background:' + v('line') + '}',
    '.r:active{opacity:.6}.r:focus-visible{box-shadow:inset 0 0 0 2px rgba(100,181,255,.8);border-radius:8px}',
    // (the glyph's place is 44 wide: a well of 38, or the row's picture -- 44 square at the snapshots' 12 -- with its
    // glyph on a small well at its corner)
    '.ic{width:38px;height:38px;margin:0 3px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center}',
    '.ph{position:relative;width:44px;height:44px;flex:none}',
    '.ph img{width:44px;height:44px;border-radius:12px;object-fit:cover;display:block;background:' + v('key') + '}',
    '.r.c .ph,.r.c .ph img{width:36px;height:36px;border-radius:8px}.r.c .ph{margin:0 4px}',
    '.ph .ic{position:absolute;right:-6px;bottom:-6px;width:24px;height:24px;margin:0;box-shadow:0 1px 4px rgba(0,0,0,.3)}',
    '.ic hk-icon{display:block;--mdc-icon-size:100%}',
    '.tx{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}',
    '.t1{display:flex;align-items:baseline;gap:8px;min-width:0}',
    '.ti{flex:1;min-width:0;' + type('headline') + ';line-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tm{flex:none;' + type('caption') + ';line-height:21px;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.sb{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // (Tall: 32 px glyphs, the time in the line under the name)
    '.r.n{gap:10px}.r.n>.ic{width:32px;height:32px;margin:0}.r.n + .r.n::before{left:42px}',
    '.quiet{flex:none;height:44px;display:flex;align-items:center;justify-content:center;' + type('caption') + ';color:' + v('ink-3') + ';text-align:center}',
    // THE LEADING EVENT, LARGE (no picture kept): its glyph on a large well, its words in the title role -- the block's
    // weight when there is no picture to carry it. Large: a row of 84; Tall and Extra Large: stacked and centered
    '.lead{display:flex;align-items:center;gap:14px;flex:none;cursor:pointer;outline:none;min-width:0}',
    '.lead .ic{width:56px;height:56px;margin:0}',
    '.lead b{display:block;' + type('title') + ';line-height:27px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.lead span{display:block;' + type('body') + ';line-height:20px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.lead.up{flex-direction:column;justify-content:center;text-align:center;gap:10px;max-width:100%}.lead.up>div{max-width:100%;min-width:0}',
    '.lead.up .ic{width:72px;height:72px}',
    // THE PICTURE, LARGE (Tall, Large, Extra Large): the newest row that kept one, to the inner radius, its words on it
    // with the camera tiles' soft halo (hk-cameras.js .age); a tap opens its camera
    '.hero{position:relative;flex:none;border-radius:var(--hk-inner-radius,12px);overflow:hidden;background:' + v('key') + ';cursor:pointer;outline:none}',
    '.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
    '.hero .cap{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;padding:28px 12px 10px;',
    '  background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.45));color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.55)}',
    '.hero .cap hk-icon{width:22px;height:22px;flex:none;--mdc-icon-size:100%;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}',
    '.hero .cap .tx b{' + type('headline') + ';line-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hero .cap .tx span{' + type('caption') + ';line-height:17px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hero:active{opacity:.85}',
    // THE MORNING SUMMARY: how the house is, in its glyph and a headline, and the night's kinds as tiles -- each its
    // glyph, its count, its name
    '.st{display:flex;align-items:center;gap:12px;flex:none;min-width:0}.cols>.st{flex:1 1 0}',
    '.st .g{width:40px;height:40px;flex:none;display:flex;align-items:center;justify-content:center}',
    '.st .g hk-icon{width:34px;height:34px;--mdc-icon-size:100%}',
    '.st b{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;' + type('headline') + ';line-height:21px}',
    '.st span{display:block;' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}',
    '.body.grp{justify-content:center;padding-bottom:6%}',
    '.st.up{flex-direction:column;align-items:flex-start;gap:8px}',
    '.kt{display:flex;flex-wrap:wrap;justify-content:center;align-content:center;gap:10px;flex:1;min-height:0;min-width:0;margin-top:12px}',
    '.k{box-sizing:border-box;flex:none;width:' + KIND_TILE.big[0] + 'px;height:' + KIND_TILE.big[1] + 'px;border-radius:var(--hk-inner-radius,12px);background:' + v('key') + ';padding:10px 12px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}',
    '.k hk-icon{width:24px;height:24px;--mdc-icon-size:100%;display:block;flex:none}',
    '.k .n{display:flex;align-items:baseline;gap:6px;min-width:0}',
    '.k .n b{' + type('figure') + ';line-height:1;font-variant-numeric:tabular-nums}',
    '.k .n span{' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // (a short tile, Wide's and a tile cell's: the glyph, the count and its name on one line)
    '.k.s{width:' + KIND_TILE.small[0] + 'px;height:' + KIND_TILE.small[1] + 'px;flex-direction:row;align-items:center;justify-content:center;gap:8px;padding:0 10px}.k.s .n b{' + type('title') + '}.k.s .n span{display:none}',
    // (Tall's kinds: rows, the count at the right)
    '.kr{display:flex;flex-direction:column;flex:1;min-height:0;margin-top:12px}',
    '.kr>div{display:flex;align-items:center;gap:10px;flex:none;height:44px;position:relative}',
    '.kr>div + div::before{content:"";position:absolute;top:0;left:34px;right:0;height:1px;background:' + v('line') + '}',
    '.kr hk-icon{width:24px;height:24px;--mdc-icon-size:100%;flex:none}',
    '.kr span{flex:1;min-width:0;' + type('body') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.kr b{' + type('headline') + ';font-variant-numeric:tabular-nums}',
    // NOTHING TO SAY (a new house; a refusal; a quiet night with no kinds): HomeView's centered tile on the plate --
    // the glyph at a third, the words under it
    '.calm{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:4px;padding-bottom:6%}',
    '.calm hk-icon{width:44px;height:44px;--mdc-icon-size:100%;margin-bottom:8px}.calm>div{display:flex;flex-direction:column;align-items:center;gap:3px}',
    '.calm b{' + type('headline') + ';line-height:21px}',
    // (scaled to its block, 2026-11-08, the lead's review: Tall a 56 px glyph; Large and Extra Large 76, the title role)
    ':host([size=T]) .calm hk-icon{width:56px;height:56px;margin-bottom:10px}',
    ':host([size=L]) .calm hk-icon,:host([size=XL]) .calm hk-icon{width:76px;height:76px;margin-bottom:14px}',
    ':host([size=L]) .calm b,:host([size=XL]) .calm b{' + type('title') + ';line-height:28px}',
    '.calm span{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';max-width:260px}',
    '.calm.side{flex-direction:row;text-align:left;gap:14px;padding:0}.calm.side hk-icon{margin:0;flex:none}.calm.side>div{align-items:flex-start;gap:2px;min-width:0}',
    // the loading rows
    '.sk{display:flex;align-items:center;gap:12px;height:52px;flex:none}',
    '.sk i{display:block;background:' + v('key') + ';border-radius:8px}',
    '.sk .a{width:36px;height:36px;border-radius:50%;flex:none}',
    '.sk .b{flex:1;display:flex;flex-direction:column;gap:7px}.sk .b i{height:12px}.sk .b i + i{width:50%;height:10px}',
    // SMALL: one centered tile (hkCards.centredTile over the plate's parts: the glyph bare at its upper third in its
    // kind's color, the thing and what it did and when under it)
    ':host([size=S]) hk-plate.tb{padding:0}',
    '.icon{display:flex;--mdc-icon-size:100%}',
    C.centredTile({ host: ':host([size=S])', plate: 'hk-plate.tb', lit: 'hk-plate.tb.never', well: '.well', icon: '.icon', name: '.nm', sub: ['.tm1'] }),
    'hk-plate.tb .tm1{font-variant-numeric:tabular-nums}',
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
    // a minute went by: the times say so ("4 min" is "5 min"); when the hour or the day turned, Automatic may be
    // showing the other thing
    _clock() {
      if (!this._lib) return;
      var key = this._viewKey();
      if (key !== this._seen) { this._seen = key; this._loadSummary(); }
      this._paint();
    }
    _viewKey() { var ctx = ctxNow(), now = Date.now(); return viewNow(this._show(), now, ctx) + '|' + T().dayKey(now, ctx); }
    _beginData() { this._seen = this._viewKey(); }
    _took(res) { this._limited = !!(res && res.limited); this._capped = !!(res && res.next_before); }

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
        var self = this;
        // A ROW OPENS WHAT IT STANDS FOR (2026-11-08): its camera, its door or lock, or its sheet on the Timeline
        this._root.addEventListener('click', function (e) {
          var t = e.target && e.target.closest ? e.target.closest('[data-ev]') : null;
          if (t) self._open(t.getAttribute('data-ev'), e);
        });
        this._root.addEventListener('keydown', function (e) {
          var t = e.target;
          if ((e.key === 'Enter' || e.key === ' ') && t && t.getAttribute && t.getAttribute('data-ev')) { e.preventDefault(); self._open(t.getAttribute('data-ev'), e); }
        });
      }
      var size = this._size(), box = inner(this, size), html;
      if (!this._lib || this._state === 'loading') {
        var sk = '';
        for (var i = 0; i < (size === 'W' || size === 'S' ? 2 : 4); i++) sk += '<div class="sk sks"><i class="a"></i><div class="b"><i></i><i></i></div></div>';
        html = size === 'S' ? '' : head('Recent') + '<div class="list" aria-busy="true">' + sk + '</div>';
      } else if (this._state === 'error') {
        html = this._calm(size, 'mdi:history', 'gray', 'Recent', errorWord(this._err), true);
      } else {
        var ctx = ctxNow(), now = Date.now(), shown = viewNow(this._show(), now, ctx);
        if (shown === 'digest' && this._summary && !this._summaryErr) html = this._digest(size, box, ctx, now);
        else html = this._latest(size, box, ctx, now);
      }
      C.morph(this._plate, html);
    }
    _evOf(id) {
      var all = (this._events || []).concat(this._summary && Array.isArray(this._summary.events) ? this._summary.events : []);
      for (var i = 0; i < all.length; i++) if (String(all[i].id) === String(id)) return all[i];
      return null;
    }
    _open(id, e) {
      var ev = this._evOf(id), c = this.client, SH = window.hkShell, P = window.hkTimeline;
      if (!ev) return;
      if (e) e._hkBlockTap = true;
      // (the house as it is now: this card draws from its own rows and keeps the client it was first handed, whose
      // states may predate the rest of the house -- 2026-11-08, a person's row opened the Timeline's sheet, not theirs)
      var now = (C.client && C.client()) || c, to = openOf(ev, now && now.states, now && now.entities);
      if (to !== 'timeline' && SH && typeof SH.moreInfo === 'function') { SH.moreInfo(to, this); return; }
      if (P && typeof P.openSheet === 'function') P.openSheet(ev, c);
    }

    // NOTHING TO SHOW: the glyph, a headline and a line, centered (Small: HomeView's tile; Wide: laid sideways)
    _calm(size, icon, color, title, line, label) {
      if (size === 'S') {
        return '<div class="well"><hk-icon class="icon" ink="' + C.TILE.centred.ink + '" icon="' + esc(icon) + '" style="color:' + inkOf(color) + '"></hk-icon></div>' +
          '<div class="nm">' + esc(title) + '</div><div class="tm1">' + esc(line) + '</div>';
      }
      var words = '<div><b>' + esc(title) + '</b>' + (line ? '<span>' + esc(line) + '</span>' : '') + '</div>';
      return (label ? head('Recent') : '') + '<div class="calm' + (size === 'W' ? ' side' : '') + '">' + icon2(icon, color) + words + '</div>';
    }

    _latest(size, box, ctx, now) {
      var self = this, all = pick(this._events, limitOf(size));
      if (!all.length) return this._calm(size, 'mdi:history', 'teal', size === 'S' ? 'Recent' : NEW_HOUSE[0], size === 'S' ? NEW_HOUSE[0] : NEW_HOUSE[1], true);
      var rows = all.map(function (ev) { return rowView(ev, now, ctx); });
      // SMALL: the newest event, alone
      if (size === 'S') {
        var e0 = rows[0];
        return '<div class="well"><hk-icon class="icon" ink="' + C.TILE.centred.ink + '" icon="' + esc(e0.icon) + '" style="color:' + inkOf(e0.color) + '"></hk-icon></div>' +
          '<div class="nm">' + esc(e0.a) + '</div><div class="tm1">' + esc(tileLine(e0)) + '</div>';
      }
      // THE PICTURE TAKES WHAT THE ROWS LEAVE (Tall and Large: as many rows as fit under a picture of at least its
      // least, it the rest; Extra Large: half the block); the rows keep their own height
      var room = box.ih - HEAD, heroEv = size === 'W' ? null : heroOf(all), hero = '', gap = 12, h = ROW_H[size] || 56, n, few = false;
      if (heroEv) {
        var hr = rowView(heroEv, now, ctx), hh = room, hw = 0;
        rows = rows.filter(function (r) { return r.id !== hr.id; });
        if (size === 'XL') hw = Math.round((box.iw - 18) / 2);
        else {
          var least = Math.round(size === 'T' ? Math.min(box.iw * 9 / 16, room * 0.3) : Math.min(box.iw * 0.42, room * 0.45));
          n = Math.max(0, Math.min(rows.length, Math.floor((room - least - gap) / h)));
          hh = Math.min(room - gap - n * h, Math.round(size === 'T' ? box.iw : box.iw * 9 / 16));
          room -= hh + gap;
        }
        hero = '<div class="hero" role="button" tabindex="0" data-ev="' + esc(hr.id) + '" aria-label="' + esc(hr.title + ', ' + hr.agoLong) + '" style="height:' + hh + 'px' +
          (hw ? ';width:' + hw + 'px' : '') + '">' + '<img src="' + esc(hr.thumb) + '" alt="" decoding="async" draggable="false">' +
          '<div class="cap"><hk-icon icon="' + esc(hr.icon) + '" style="color:' + inkOf(hr.color) + '"></hk-icon><div class="tx"><b>' + esc(size === 'T' ? hr.a : hr.title) + '</b><span>' +
          esc(size === 'T' ? hr.agoLong : [hr.room, hr.agoLong].filter(Boolean).join(' · ')) + '</span></div></div></div>';
      } else if (size !== 'W') {
        // (no picture: the newest event is the hero, large. A FEW EVENTS, Large and Extra Large: the hero stacked and the
        // rest under it as one centered column -- not the hero left and two rows floating right, 2026-11-08)
        few = (size === 'L' || size === 'XL') && 150 + gap + (rows.length - 1) * h <= room;
        var ld = rows.shift(), up = size !== 'L' || few, lh = few ? 150 : size === 'L' ? 84 : size === 'T' ? 150 : room;
        hero = '<div class="lead' + (up ? ' up' : '') + '" role="button" tabindex="0" data-ev="' + esc(ld.id) + '" aria-label="' + esc(ld.title + ', ' + ld.agoLong) + '" style="height:' + lh + 'px' +
          (size === 'XL' && !few ? ';width:' + Math.round((box.iw - 18) / 2) + 'px' : '') + '">' + well(ld, up ? 72 : 56) + '<div><b>' + esc(size === 'T' ? ld.a : ld.title) + '</b>' +
          (size === 'T' ? '<span>' + esc(ld.b || ld.room) + '</span><span>' + esc(ld.agoLong) + '</span>'
                        : '<span>' + esc([ld.sub, size === 'XL' ? '' : ld.agoLong].filter(Boolean).join(' · ')) + '</span>' + (size === 'XL' ? '<span>' + esc(ld.agoLong) + '</span>' : '')) + '</div></div>';
        if (size !== 'XL' || few) room -= lh + gap;
      }
      var fit = rowsFit(rows.length, room, h), shown = rows.slice(0, fit.n), more = rows.length - shown.length;
      var narrow = size === 'T', fits = !more && fit.rest >= 44;
      // (cut: the rows centered in their place, the few px left split above and below; all shown: the rows and a quiet
      // line as one group, centered a touch above the middle with the hero over them)
      var single = size !== 'XL' || few;
      var list = '<div class="list' + (more || fits ? ' mid' : '') + (fits && single ? ' fit' : '') + '"' + (few ? ' style="width:' + Math.min(box.iw, 420) + 'px;align-self:center"' : '') + '>' + shown.map(function (r) { return self._row(r, h, narrow); }).join('') +
        (fits ? '<div class="quiet">' + (shown.length ? 'Nothing earlier' : 'Nothing else') + '</div>' : '') + '</div>';
      var moreWord = more || this._capped ? (more || 0) + (this._capped ? '+' : '') + ' more' : '';
      var hd = head('Recent', moreWord);
      if (size === 'XL' && hero && !few) return hd + '<div class="cols">' + hero + list + '</div>';
      var stack = (hero ? hero + '<div style="height:' + gap + 'px;flex:none"></div>' : '') + list;
      return hd + (fits ? '<div class="body grp">' + stack + '</div>' : stack);
    }
    _row(r, h, narrow) {
      var aria = r.title + ', ' + r.agoLong + (r.sub ? ', ' + r.sub : '');
      var open = '<div class="r' + (narrow ? ' n' : '') + (h < 56 ? ' c' : '') + '" role="button" tabindex="0" data-ev="' + esc(r.id) + '" aria-label="' + esc(aria) + '" style="height:' + h + 'px">';
      if (narrow) return open + well(r, 32) + '<div class="tx"><div class="ti">' + esc(r.a) + '</div><div class="sb">' + esc([r.b || r.room, r.ago].filter(Boolean).join(' · ')) + '</div></div></div>';
      // (the badge on a picture: the kind's color, the glyph white -- a tint over a photograph reads as mud)
      var lead = r.thumb ? '<div class="ph"><img src="' + esc(r.thumb) + '" alt="" loading="lazy" decoding="async" draggable="false">' +
        '<div class="ic" style="background:' + tint(r.color, 0.92) + ';color:#fff">' + icon(r.icon, 14) + '</div></div>' : well(r, 38);
      return open + lead + '<div class="tx"><div class="t1"><div class="ti">' + esc(r.title) + '</div><div class="tm">' + esc(r.ago) + '</div></div>' +
        (r.sub ? '<div class="sb">' + esc(r.sub) + '</div>' : '') + '</div></div>';
    }
    // THE MORNING SUMMARY, AS GLYPHS (2026-11-08): how the house is (the status: its glyph and headline), the night's
    // kinds as tiles with their counts, and the night's newest picture carrying the weight where there is room (Large
    // over a row of the kinds, Extra Large beside them); a quiet night is the moon alone, centered
    _digest(size, box, ctx, now) {
      var d = digestParts(this._summary), st = d.status, tinted = function (name, px, col) { return icon(name, px).replace('<hk-icon ', '<hk-icon style="color:' + inkOf(col) + '" '); };
      if (size === 'S') {
        return '<div class="well"><hk-icon class="icon" ink="' + C.TILE.centred.ink + '" icon="' + esc(st.icon) + '" style="color:' + inkOf(st.color) + '"></hk-icon></div>' +
          '<div class="nm">' + esc(d.quiet ? st.line : d.label) + '</div><div class="tm1">' + esc(d.quiet ? d.span || d.label : st.color === 'orange' ? st.line : d.n + (d.n === 1 ? ' event' : ' events')) + '</div>';
      }
      var hd = head(d.label, size === 'T' ? '' : d.span);
      if (d.quiet || !d.counts.length) return hd + '<div class="calm' + (size === 'W' ? ' side' : '') + '">' + icon2(st.icon, st.color) + '<div><b>' + esc(st.line) + '</b>' + (st.sub ? '<span>' + esc(st.sub) + '</span>' : '') + '</div></div>';
      var status = '<div class="st' + (size === 'T' ? ' up' : '') + '"><div class="g">' + tinted(st.icon, 34, st.color) + '</div><div style="min-width:0"><b>' + esc(st.line) + '</b>' + (st.sub ? '<span>' + esc(st.sub) + '</span>' : '') + '</div></div>';
      var room = box.ih - HEAD, gap = 12;
      // TALL: the status over the kinds as 44 px rows, the count at the right
      if (size === 'T') {
        var nk = Math.max(1, Math.floor((room - 104 - gap) / 44));
        return hd + '<div class="body grp">' + status + '<div class="kr" style="flex:none">' + d.counts.slice(0, nk).map(function (k) {
          return '<div>' + tinted(k.icon, 24, k.color) + '<span>' + esc(k.label) + '</span><b>' + k.n + '</b></div>';
        }).join('') + '</div></div>';
      }
      var tiles = function (list, W, H, small, flush) {
        var t = small ? KIND_TILE.small : KIND_TILE.big, g = fitGrid(list.length, W, H, t[0], t[1], 10);
        return '<div class="kt" style="width:' + Math.round(g.cols * (t[0] + 10) - 10) + 'px;max-width:100%;align-self:center' + (flush ? ';margin-top:0;flex:none' : '') + '">' + list.slice(0, g.n).map(function (k) {
          return '<div class="k' + (small ? ' s' : '') + '" title="' + esc(k.label) + '">' + tinted(k.icon, 24, k.color) + '<div class="n"><b>' + k.n + '</b><span>' + esc(k.label) + '</span></div></div>';
        }).join('') + '</div>';
      };
      // WIDE: the status left, the kinds as small tiles right
      if (size === 'W') return hd + '<div class="cols" style="align-items:center">' + status + tiles(d.counts, Math.floor((box.iw - 18) / 2), room, true, true) + '</div>';
      var picEv = heroOf(d.events), hr = picEv ? rowView(picEv, now, ctx) : null;
      var pic = function (w, h) {
        return '<div class="hero" role="button" tabindex="0" data-ev="' + esc(hr.id) + '" aria-label="' + esc(hr.title + ', ' + hr.agoLong) + '" style="height:' + h + 'px' + (w ? ';width:' + w + 'px' : '') + '">' +
          '<img src="' + esc(hr.thumb) + '" alt="" decoding="async" draggable="false"><div class="cap">' + tinted(hr.icon, 22, hr.color) +
          '<div class="tx"><b>' + esc(hr.title) + '</b><span>' + esc([hr.room, hr.agoLong].filter(Boolean).join(' · ')) + '</span></div></div></div>';
      };
      // LARGE with a picture: the status, the picture taking what is left, the kinds as one row of small tiles at the foot
      if (size === 'L' && hr) {
        var per = Math.max(1, Math.floor((box.iw + 10) / (KIND_TILE.small[0] + 10)));
        return hd + status + '<div style="height:' + gap + 'px;flex:none"></div>' + pic(0, room - 54 - gap - KIND_TILE.small[1] - gap) +
          '<div style="height:' + gap + 'px;flex:none"></div>' + tiles(d.counts.slice(0, per), box.iw, KIND_TILE.small[1], true, true);
      }
      // EXTRA LARGE with a picture: the status and the kinds left, the picture right
      if (size === 'XL' && hr) {
        var half = Math.round((box.iw - 18) / 2);
        // (the status and its kinds one group, centered a touch above the column's middle)
        return hd + '<div class="cols"><div class="body grp">' + status + tiles(d.counts, half, room - 54 - gap, false, true).replace('margin-top:0', 'margin-top:' + gap + 'px') + '</div>' + pic(half, room) + '</div>';
      }
      return hd + '<div class="body grp">' + status + tiles(d.counts, box.iw, room - 54 - gap, false, true).replace('margin-top:0', 'margin-top:' + gap + 'px') + '</div>';
    }
  }
  // the label's line: the label in teal, a word at its right
  function head(label, right) {
    return '<div class="hd"><div class="wl" style="color:' + ACC.teal + '">' + esc(label) + '</div>' + (right ? '<div class="mr">' + esc(right) + '</div>' : '') + '</div>';
  }
  // A ROW'S GLYPH: white on its kind's solid color (the Home app's lit well; 2026-11-08, the lead's review -- a 22 %
  // tint all but vanished on the Blur look's glass)
  function well(r, px) {
    return '<div class="ic" style="background:' + tint(r.color, 0.92) + ';color:#fff">' + icon(r.icon, Math.round(px * 0.56)) + '</div>';
  }
  // SMALL'S SECOND LINE: what it did and when, short enough for the tile ("Unlocked · 41m", "Armed night · Yest.")
  function tileLine(r) {
    var t = r.day ? (r.day === 'Yesterday' ? 'Yest.' : r.day) : r.ago.replace(/ min$/, 'm').replace(/ hr$/, 'h');
    var both = (r.b ? r.b + ' · ' : '') + t;
    return both.length <= 19 ? both : r.b && !r.day ? r.b : t;
  }
  // a glyph bare, in a color
  function icon2(name, color) { return '<hk-icon icon="' + esc(name) + '" style="color:' + inkOf(color) + '"></hk-icon>'; }

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
    '.sc{flex:1;min-height:0;display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;padding:0 18px;scroll-padding-inline:18px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;overscroll-behavior-x:contain}',
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
    // the feed is this camera's already: the server sends its device's rows, filed under whichever of its entities
    // heard them (Protect's under the high resolution channel while a tile shows the low one; a detection sensor), so
    // a row's entity is never compared with the camera's here (2026-11-05: the front door's Recent was empty)
    _wants(ev) { return !!ev; }
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
