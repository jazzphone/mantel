// @ts-check
// hk-hv-media.js -- AN APPLE HOMEVIEW'S MEDIA PAGES (docs/phase36/PLAN.md, 2026-11-26): Music, Cameras and Live TV, each drawn for the
// HomeView from the page the build made (hk-hv.js: the kit, the frame, harvest()), with the data and the calls the page has always had.
//
//   hk-hv-music-card     Playing / Speakers / Library (the mode switch). Playing: the cover, the song, the transport, the rooms and the
//                        volume, then Up Next (Music Assistant's queue, hk_music/queue). Speakers: the Music page's own Speakers panel
//                        (hk-saver-panel.js: the capsule rows, the presets, Clear All, Reset, Update, Stop, each room's volume) laid out for
//                        this frame, told what the Music page tells it.
//                        Library: search (the Music page's own library card, a step deeper), the playlists, Radio. What plays, where and
//                        how loud is hkMusic's (the music model), every call the Music page's (hk_frontend.music_*).
//   hk-hv-cameras-card   the camera with the latest motion first and live, the rest two across as stills (a page of nine live streams
//                        is the one thing a HomeView need not do); a tap goes to one camera: the live picture (hk-doorbell-card, which has
//                        the hold-to-talk button where the camera has a speaker), what its device has (a light, a lock), and today's
//                        clips from the House Timeline, where the host keeps one.
//   hk-hv-tv-card        the channels (ws hk_tv/channels) two across, the one being watched lit; a tap goes to the channel: Now and Next,
//                        Play Here (Safari's own full-screen player on a HomeView: hkCameras.tvPlayer), Play On (the paired AirPlay
//                        screens, hk_tv/screens), Later Today.
(function () {
  'use strict';
  if (window.hkHvMedia) return;                    // double-load guard
  window.hkHvMedia = { version: '1.0.0' };

  function whenKit(/** @type {(H: any) => void} */ fn) {
    if (window.hkHV && window.hkHV.ready) return fn(window.hkHV);
    window.addEventListener('hk-hv-ready', function () { fn(window.hkHV); }, { once: true });
    if (window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-hv.js');
  }

  whenKit(function (H) {
  if (window.hkHvMedia.ready) return;
  window.hkHvMedia.ready = true;
  var esc = H.esc, P = H.P, C = H.C, v = C.v;

  // ------------------------------------------------------------------ small helpers
  // a lazy card's file, asked for by the card's tag (hkNeed) or by its file's name
  /** @param {string} tag */
  function needTag(tag) {
    var N = /** @type {any} */ (window).hkNeed;
    try { return Promise.resolve(typeof N === 'function' ? N(tag) : null).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
  }
  /** @param {string} file */
  function needFile(file) {
    var N = /** @type {any} */ (window).hkNeed;
    try { return Promise.resolve(N && N.file ? N.file(file) : null).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
  }
  /** @param {number} s */
  function mmss(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  /** @param {string[]} a @param {string[]} b */
  function same(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) < 0) return false;
    return true;
  }
  /** @param {any} s */
  function hash(s) { s = String(s || ''); var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  // a picture's backdrop when it has none: a gradient of its own, the same one for the same name
  var GRADS = ['#1e5bd8,#0b2a74', '#d62f2f,#7a1010', '#14a37f,#09543f', '#f2a516,#b0600a', '#7b3fe4,#3b1a8a', '#24292f,#4a525b',
               '#0d8ecf,#064a6e', '#e0457b,#7d1a3e', '#5e8c2f,#2d4a14', '#c75b12,#6b2c05', '#3a3f8f,#1b1e4a', '#8a8f96,#43474d'];
  /** @param {any} key */
  function grad(key) { return 'linear-gradient(135deg,' + GRADS[hash(key) % GRADS.length] + ')'; }
  // a picture's URL as the Music page asks the art for it (a local path gets this origin)
  /** @param {any} u */
  function artUrl(u) { u = typeof u === 'string' ? u : ''; return u && u.charAt(0) === '/' ? location.origin + u : u; }
  function ctxNow() {
    var Lc = /** @type {any} */ (window).hkLocale;
    try { return { tag: Lc ? Lc.tag() : 'en-US', zone: Lc ? Lc.zone() : undefined, hour12: Lc ? Lc.hour12() : undefined }; } catch (e) { return { tag: 'en-US' }; }
  }
  // a picture: its backdrop, the glyph until the picture comes (data-art: filled after the page is drawn, MediaPage._fillArts)
  /** @param {string} cls @param {string} url @param {string} icon @param {number} gpt @param {string} [style] */
  function art(cls, url, icon, gpt, style) {
    return '<div class="art ' + cls + '"' + (url ? ' data-art="' + esc(url) + '"' : '') + (style ? ' style="' + style + '"' : '') + '>' + H.glyph(icon, gpt, 'var(--hk-ink-2)') + '</div>';
  }

  // ------------------------------------------------------------------ the media pages' base
  var CSS = H.CSS + [
    // A PICTURE (a cover, a logo, a snapshot) is a picture, not glass: the inner corner and a soft shadow
    '.art{position:relative;overflow:hidden;border-radius:' + P(12) + ';background:' + v('key') + ';box-shadow:0 ' + P(6) + ' ' + P(16) +
      ' rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;flex:none}',
    '.art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
    '.art.ct img{object-fit:contain;padding:' + P(8) + ';background:#fff}',
    '.lbl-s{font-size:' + P(13) + ';font-weight:600;letter-spacing:' + P(0.3) + ';text-transform:uppercase;color:' + v('ink-2') + '}',
    '.cr{display:flex;gap:' + P(8) + ';flex-wrap:wrap}',
    '.mre{all:unset;cursor:pointer;font-size:' + P(15) + ';font-weight:600;color:' + v('ink-2') + ';padding:' + P(8) + ' 0 ' + P(8) + ' ' + P(12) + '}',
    '.mre.on{color:' + v('ink') + '}'
  ].join('\n');

  class MediaPage extends H.Page {
    static get CSS() { return CSS; }
    _render() {
      super._render();
      try { this._fillArts(); this._after(); } catch (e) { console.error('[hk-hv-media] ' + this.localName + ' after', e); }
    }
    _after() { /* a page's own, once drawn */ }
    // THE PICTURES: each [data-art] gets its image through the card's own art path (signed, timed out, a placeholder when it never comes)
    _fillArts() {
      var self = this;
      this._root.querySelectorAll('[data-art]').forEach(function (/** @type {any} */ el) {
        var u = el.getAttribute('data-art');
        if (!u || el._art === u) return;
        el._art = u;
        self._artImage(artUrl(u), el, el.innerHTML, 300);
      });
    }
    // a line of news, in the house's own toast
    /** @param {string} text */
    _say(text) {
      var S = /** @type {any} */ (window).hkShell;
      try { this.dispatchEvent(new CustomEvent(S.events.toast, { detail: { message: text }, bubbles: true, composed: true })); } catch (e) { /* no host toast */ }
    }
    // a read (the client's own) or a command (its action port), as the cards' _ws
    /** @param {any} msg */
    _ws(msg) {
      var W = /** @type {any} */ (window), port = W.hkClient && W.hkClient.isWrite && W.hkClient.isWrite(msg) ? this._actions() : this.client;
      if (!port || !port.callWS) return Promise.reject(new Error('not connected'));
      try { return Promise.resolve(port.callWS(msg)); } catch (e) { return Promise.reject(e); }
    }
    /** @param {Function} fn @param {number} ms */
    _later(fn, ms) { var t = setTimeout(fn, ms); (this._timers = this._timers || []).push(t); return t; }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      (this._timers || []).forEach(clearTimeout);
      this._timers = [];
    }
  }

  // =================================================================== MUSIC
  var MUSIC_CSS = CSS + [
    '.player{display:flex;gap:' + P(22) + ';height:' + P(228) + '}',
    '.player>.art{width:' + P(228) + ';height:' + P(228) + ';border-radius:' + P(22) + ';box-shadow:0 ' + P(14) + ' ' + P(34) + ' rgba(0,0,0,.4)}',
    '.pinfo{flex:1;min-width:0;display:flex;flex-direction:column;padding-right:' + P(8) + '}',
    '.ptt{font-size:' + P(24) + ';font-weight:700;letter-spacing:' + P(-0.4) + ';line-height:' + P(28) + ';margin-top:' + P(2) + ';overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.pat{font-size:' + P(17) + ';font-weight:500;color:' + v('ink-2') + ';margin-top:' + P(3) + ';overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.pprog{margin-top:auto}',
    '.ptimes{display:flex;justify-content:space-between;margin-top:' + P(6) + ';font-size:' + P(13) + ';font-weight:500;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums}',
    '.ptrans{display:flex;align-items:center;justify-content:space-between;margin-top:' + P(14) + ';padding:0 ' + P(4) + '}',
    '.pquiet{display:flex;flex-direction:column;gap:' + P(10) + ';margin-top:auto;align-items:flex-start}',
    '.where{display:flex;align-items:center;gap:' + P(12) + ';min-height:' + P(56) + ';margin-top:' + P(16) + '}',
    '.where .cap{flex:none;max-width:' + P(240) + ';overflow:hidden}',
    '.pvol{flex:1;min-width:0;display:flex;align-items:center;gap:' + P(10) + ';height:' + P(44) + ';padding-right:' + P(8) + ';touch-action:pan-y}',
    '.pvol.off{opacity:.4;pointer-events:none}',
    '.vt{flex:1;height:' + P(8) + ';border-radius:' + P(4) + ';background:' + v('line-strong') + ';position:relative;overflow:hidden}',
    '.vt>i{position:absolute;left:0;top:0;bottom:0;width:var(--v,0%);border-radius:' + P(4) + ';background:currentColor}',
    '.qlist{padding:' + P(4) + ' 0}',
    '.qrow{display:flex;align-items:center;gap:' + P(12) + ';width:100%;height:' + P(56) + ';padding:0 ' + P(16) + ' 0 ' + P(10) + ';border-top:1px solid ' + v('line') + ';text-align:left}',
    '.qrow:first-child{border-top:0}',
    '.qrow>.art{width:' + P(40) + ';height:' + P(40) + ';border-radius:' + P(8) + ';box-shadow:0 ' + P(2) + ' ' + P(6) + ' rgba(0,0,0,.3)}',
    '.qrow .mid{flex:1;min-width:0}',
    '.qrow .len{font-size:' + P(14) + ';font-weight:500;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums}',
    '.qrow.busy{opacity:.5}',
    // LIBRARY
    '.lbar{display:flex;gap:' + P(10) + ';margin-bottom:' + P(14) + '}',
    '.lbar .sr{flex:1;justify-content:flex-start;color:' + v('ink-2') + '}',
    '.plg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:' + P(14) + ' ' + P(12) + '}',
    '.pc{display:block;min-width:0;text-align:left}',
    '.pc>.art{width:100%;aspect-ratio:1/1}',
    '.pc .nm{margin-top:' + P(7) + ';font-size:' + P(14) + '}',
    '.pc.busy{opacity:.5}.pc.open>.art{outline:2px solid #fff;outline-offset:' + P(2) + '}',
    '.opts{margin-top:' + P(12) + '}',
    '.stn{display:flex;align-items:center;gap:' + P(12) + ';padding:0 ' + P(14) + ' 0 ' + P(12) + ';text-align:left}',
    '.stn>.art{width:' + P(76) + ';height:' + P(76) + ';border-radius:' + P(14) + '}',
    '.stn .words{flex:1;min-width:0;display:flex;flex-direction:column}',
    '.logo{font-size:' + P(17) + ';font-weight:800;color:#fff;text-shadow:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}',
    '.libslot hk-library-card{display:block}'
  ].join('\n');

  // WHERE A PICK PLAYS, nothing playing: the one room, or the first of a set -- and the rooms to bring in after it (the Music page's rule)
  /** @param {string[]} rooms */
  function playTarget(rooms) {
    var Mu = /** @type {any} */ (window).hkMusic;
    return { player: (Mu && Mu.leader ? Mu.leader(rooms) : rooms[0]) || null, then: rooms.length > 1 ? rooms.slice() : null };
  }
  // THE GROUP'S VOLUME (the Music page's rule): one room, the room; a group, every member in one call
  /** @param {any} c @param {number} level */
  function volumeCalls(c, level) {
    if (!c) return [];
    if (c.members.length > 1) return [{ entity_id: c.members.slice(), volume_level: level }];
    return [{ entity_id: c.key, volume_level: level }];
  }

  // THE SPEAKERS PANEL LAID OUT FOR THE HOMEVIEW'S FRAME (after the panel's own rules, and scoped so these win at any window size): the page's
  // title row has the mode switch, so the panel's tabs, its song line and its cover are left out. One column, the page's width: the
  // presets and Clear All across the top (scrolling sideways), the rooms as the panel's own capsules, full width, then the panel's
  // line and its Update / Reset / Stop in a row under them (2026-11-26: a narrow column beside the rooms squeezed the line and cut
  // the presets; and nothing in a page is sticky -- the HomeView's scrolling doesn't carry it). Its sizes stay the panel's own (its
  // rows are 56 px), so a room is the same pill here as on the Music page. Nothing loops: the bars that dance in a playing room stand still.
  var SPK_CSS = [
    '.spkp{position:relative;color:' + v('ink') + '}',
    '.spkp .mpanel{position:relative;display:block;overflow:visible;background:none;inset:auto;width:auto;height:auto}',
    '.spkp .mpbg,.spkp .mpshade,.spkp .mphd,.spkp .mpmini,.spkp .mptoast{display:none}',
    '.spkp .mpin{position:relative;width:auto!important;height:auto!important;zoom:1!important;display:flex;flex-direction:column;gap:' + P(14) +
      ';text-shadow:none}',
    '.spkp .mpbody{position:static;min-width:0}',
    '.spkp .mpt{position:static;overflow:visible;padding:0;-webkit-mask-image:none;mask-image:none}',
    '.spkp .mpt[hidden]{display:none}',
    '.spkp .mpchips{margin:0 0 ' + P(12) + ';padding:0}',
    '.spkp .mpfoot{position:static;display:flex;flex-direction:row;align-items:center;gap:' + P(12) + ';width:auto;overflow:visible;padding:0 ' + P(4) + ';border:0}',
    '.spkp .mpcap:not(.err){flex:1;min-width:0;min-height:0;margin:0;font-size:' + P(13) + ';line-height:1.35;color:' + v('ink-2') +
      ';display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere}',
    '.spkp .mpacts{display:flex;gap:' + P(8) + ';flex:none}',
    '.spkp .mpact{height:48px}',
    '.spkp .mpact.upd{width:auto;min-width:' + P(118) + ';padding:0 ' + P(18) + ';flex:none;white-space:nowrap}',
    '.spkp .mpact.rst,.spkp .mpact.stop{width:48px;flex:none;padding:0}.spkp .mpact.rst .w{display:none}',
    '.spkp .mpeq i{animation:none;transform:scaleY(.65)}'
  ].join('\n');

  class HvMusic extends MediaPage {
    static get CSS() { return MUSIC_CSS; }
    constructor() {
      super();
      this._c = null; this._target = null; this._ticks = null; this._vol = null; this._opt = null; this._q = null; this._qFor = '';
      this._radio = null; this._radioAt = 0; this._busyPl = null; this._openPl = null; this._pos = null; this._tickT = null;
      this._wireVolume();
    }
    _M() { return /** @type {any} */ (window).hkMusic; }
    _receiveClient() {
      var Mu = this._M();
      if (Mu && this.client) Mu.attach(this.client);
      super._receiveClient();
      if (this._lib && this.client && this._lib.hkSetClient) this._lib.hkSetClient(this.client);
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this, Mu = this._M();
      if (!this._musicOff && Mu) this._musicOff = Mu.onChange(function () { self._hkSig = null; if (self.client) self.redraw(); });
      if (!this._onVis) {
        this._onVis = function () { self._tickOn(); };
        document.addEventListener('visibilitychange', this._onVis);
        window.addEventListener('hk-saver', this._onVis);
        window.addEventListener('hk-black', this._onVis);
      }
      this._tickOn();
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._musicOff) { this._musicOff(); this._musicOff = null; }
      this._dropSpeakers();
      if (this._onVis) {
        document.removeEventListener('visibilitychange', this._onVis);
        window.removeEventListener('hk-saver', this._onVis); window.removeEventListener('hk-black', this._onVis);
        this._onVis = null;
      }
      if (this._tickT) { clearInterval(this._tickT); this._tickT = null; }
    }
    // what plays is hkMusic's answer, not one entity: it is read whole, so the signature adds it (as the Music page's)
    _sigOf() {
      var Mu = this._M(), h = this.client, base = super._sigOf();
      if (!Mu || !h) return base;
      var r = Mu.resolve(h), st = r.player && h.states[r.player];
      return (base || '') + '|' + [r.player, r.reason, st ? st.last_updated : '',
        Mu.contexts(h).map(function (/** @type {any} */ c) { return c.key + c.state + c.title + c.members.join(','); }).join(';'), (this._target || []).join(',')].join('|');
    }
    _ctx() {
      var Mu = this._M(), h = this.client;
      if (!Mu || !h) return null;
      var r = Mu.resolve(h);
      return r && r.context ? r.context : null;
    }
    // nothing playing: the rooms the next music plays on (this screen's own answer until Speakers changes them)
    _targetRooms() {
      var Mu = this._M();
      if (this._target && this._target.length) return this._target.slice();
      var p = Mu && this.client ? Mu.resolve(this.client).player : null;
      var pre = p && Mu.presets().filter(function (/** @type {any} */ x) { return x.entity === p; })[0];
      return pre ? pre.members.slice() : p ? [p] : [];
    }
    // where a pick goes: the rooms ticked while they differ from where it plays, else where it plays, else the rooms picked
    _pickRooms() {
      var c = this._c;
      if (c) return (this._ticks || c.members).slice();
      return this._targetRooms();
    }
    /** @param {string[]} g */
    _roomsLabel(g) {
      var Mu = this._M();
      var pre = Mu && Mu.presets().filter(function (/** @type {any} */ p) { return p.members.length === g.length && g.every(function (r) { return p.members.indexOf(r) >= 0; }); })[0];
      if (pre) return pre.name;
      if (g.length === 2) return Mu.nameOf(g[0]) + ' + ' + Mu.nameOf(g[1]);
      return g.length && Mu ? Mu.nameOf(g[0]) + (g.length > 2 ? ' +' + (g.length - 1) : '') : '';
    }

    // ------------------------------------------------------------ drawing
    draw() {
      var Mu = this._M(), title = (this._config || {}).title || 'Music';
      if (!Mu || !Mu.rooms().length) {
        return H.head({ title: title }) + '<div class="pl quiet">There are no speakers to play music on yet. Add them in ' + H.esc(H.where('Music')) + '.</div>';
      }
      var c = this._c = this._ctx(), mode = this.mode() || 'play', deep = this.deep();
      // (rooms ticked for the music that played are not for the music that plays now)
      if ((c ? c.key : '') !== this._ctxKey) { this._ctxKey = c ? c.key : ''; this._ticks = null; }
      if (deep && deep.search) return H.head({ title: 'Search Music', back: true }) + '<div class="libslot"></div>';
      var rooms = c ? c.members.length : 0;
      var sum = c ? '<b>' + rooms + (rooms === 1 ? ' Room' : ' Rooms') + '</b>' + (c.playing ? '' : ' · Paused') : 'Nothing Playing';
      var out = H.head({ title: title, sum: sum, right: H.seg([{ k: 'play', t: 'Playing' }, { k: 'spk', t: 'Speakers' }, { k: 'lib', t: 'Library' }], mode, 'mode') });
      if (mode === 'spk') return out + this._speakers(c);
      if (mode === 'lib') return out + this._library();
      return out + this._playing(c);
    }
    // THE ROOMS CAPSULE and the volume (the Music page's "Playing on" line and its slider)
    /** @param {any} c @param {string} label @param {number} level */
    _where(c, label, level) {
      var q = c ? H.key({ g: H.svg('list', 20), cls: 'sm', act: 'queue', label: 'Up Next' }) : '';
      return '<div class="where">' + H.cap({ g: H.svg('airplay', 20), t: label || 'Choose Speakers', cls: 'lg', act: 'rooms' }) +
        '<div class="pvol' + (c && level >= 0 ? '' : ' off') + '" data-hk-control>' + H.svg('volume', 20, 'var(--hk-ink-2)') +
        '<div class="vt" style="--v:' + Math.round(Math.max(0, level) * 100) + '%"><i></i></div></div>' + q + '</div>';
    }
    /** @param {any} c */
    _playing(c) {
      var Mu = this._M();
      if (!c) return this._quiet();
      var st = this.st(c.key), a = (st && st.attributes) || {};
      var pic = c.image || a.entity_picture_local || a.entity_picture || '';
      this._artSky(a);
      var playing = this._opt && Date.now() < this._opt.until ? this._opt.v : c.playing;
      this._pos = { dur: Number(a.media_duration) || 0, pos: Number(a.media_position) || 0, at: Date.parse(a.media_position_updated_at) || 0, playing: !!c.playing };
      var lv = typeof a.volume_level === 'number' ? a.volume_level : -1;
      if (this._vol && Date.now() < this._vol.until) lv = this._vol.val;
      var t = this._timesNow();
      var info = '<div class="pinfo"><div class="ptt">' + esc(c.title || a.media_title || Mu.label(c)) + '</div>' +
        '<div class="pat">' + esc([c.artist || a.media_artist, a.media_album_name].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="pprog"><div class="trk" style="height:' + P(5) + '"><i data-prog style="width:' + t.pct + '%"></i></div>' +
        '<div class="ptimes"><span data-t0>' + t.a + '</span><span data-t1>' + t.b + '</span></div></div>' +
        '<div class="ptrans">' + H.key({ g: H.svg('prev', 30), cls: 'lg bare', act: 'tp', data: { k: 'previous' }, label: 'Previous' }) +
        H.key({ g: H.svg(playing ? 'pause' : 'play', 30), cls: 'xl w', act: 'tp', data: { k: 'play_pause' }, label: playing ? 'Pause' : 'Play' }) +
        H.key({ g: H.svg('next', 30), cls: 'lg bare', act: 'tp', data: { k: 'next' }, label: 'Next' }) + '</div></div>';
      var out = '<div class="player">' + art('', pic, 'mdi:music', 72) + info + '</div>' + this._where(c, Mu.label(c), lv);
      var q = this._q && this._qFor === this._qKey(c) ? this._q : null, items = q && q.ok && q.items ? q.items.slice(1) : null;
      var shuf = !!a.shuffle;
      out += '<div id="upnext">' + H.section('Up Next', items && items.length ? items.length + (q.items.length >= 40 ? '+' : '') + (items.length === 1 ? ' song' : ' songs') : '',
        '<button class="mre' + (shuf ? ' on' : '') + '" data-act="shuffle" aria-pressed="' + shuf + '">Shuffle' + (shuf ? ' On' : '') + '</button>') + '</div>';
      if (!q) out += '<div class="pl quiet">Loading the queue…</div>';
      else if (!items || !items.length) out += '<div class="pl quiet">' + (q.ok ? 'Nothing is queued after this song.' : 'The rest of the queue can’t be read from Music Assistant.') + '</div>';
      else {
        var busy = this._qBusy;
        out += '<div class="pl qlist">' + items.map(function (/** @type {any} */ it) {
          return '<button class="qrow' + (busy === it.id ? ' busy' : '') + '" data-act="qplay" data-id="' + esc(it.id) + '">' + art('', it.image, 'mdi:music-note', 20) +
            '<div class="mid"><div class="nm">' + esc(it.title) + '</div><div class="st">' + esc(it.artist || '') + '</div></div><div class="len">' +
            (it.duration ? mmss(it.duration) : '') + '</div></button>';
        }).join('') + '</div>';
      }
      return out;
    }
    // NOTHING PLAYING, said quietly: the last thing played where it is known, the rooms it would start in, and a way to start
    _quiet() {
      var Mu = this._M(), h = this.client, r = Mu.resolve(h), st = r.player ? this.st(r.player) : null, a = (st && st.attributes) || {};
      var rooms = this._targetRooms(), label = this._roomsLabel(rooms);
      var last = a.media_title ? String(a.media_title) + (a.media_artist ? ' · ' + a.media_artist : '') : '';
      var pls = Mu.playlists() || [], first = pls[0];
      var pic = last ? (a.entity_picture_local || a.entity_picture || '') : '';
      var info = '<div class="pinfo"><div class="ptt">Nothing Playing</div><div class="pat">' + esc(last ? 'Last played: ' + last : label ? 'Ready on ' + label : 'Pick speakers to start') + '</div>' +
        '<div class="pquiet">' + (first ? H.cap({ g: H.svg('play', 18), t: 'Play ' + first.name, cls: 'lg w', act: 'startpl' }) : '') +
        H.cap({ g: H.svg('list', 18), t: 'Browse Library', cls: first ? '' : 'lg w', act: 'tolib' }) + '</div></div>';
      this._artSky(null);
      this._pos = null;
      return '<div class="player">' + art('', pic, 'mdi:music', 72) + info + '</div>' + this._where(null, label, -1);
    }
    // THE PAGE'S SKY IS THE COVER (hk-sky.js listens for hk-now-art; the Music page says it the same way)
    /** @param {any} a */
    _artSky(a) {
      var W = /** @type {any} */ (window), pub = a ? artUrl(a.entity_picture_local || a.entity_picture || a.media_image_url || a.thumbnail || '') : '';
      if (W.hkNowArt !== (pub || null)) {
        W.hkNowArt = pub || null;
        try { window.dispatchEvent(new CustomEvent('hk-now-art', { detail: { url: pub || null } })); } catch (e) { /* tests */ }
      }
    }
    _timesNow() {
      var p = this._pos;
      if (!p || !p.dur) return { pct: 0, a: p ? mmss(p.pos) : '--:--', b: '--:--' };
      var t = Math.min(p.dur, Math.max(0, p.pos + (p.playing && p.at ? (Date.now() - p.at) / 1000 : 0)));
      return { pct: Math.round(t / p.dur * 1000) / 10, a: mmss(t), b: '-' + mmss(p.dur - t) };
    }
    // the bar and the times move on their own (each second while it plays and is seen), without drawing the page
    _progress() {
      var el = this._root.querySelector('[data-prog]');
      if (!el) return;
      var t = this._timesNow(), t0 = this._root.querySelector('[data-t0]'), t1 = this._root.querySelector('[data-t1]');
      /** @type {any} */ (el).style.width = t.pct + '%';
      if (t0 && t0.textContent !== t.a) t0.textContent = t.a;
      if (t1 && t1.textContent !== t.b) t1.textContent = t.b;
    }
    _tickOn() {
      var self = this, S = /** @type {any} */ (window).hkSaver, up = false;
      try { up = !!(S && ((S.running && S.running()) || (S.black && S.black()))); } catch (e) { /* no saver */ }
      var want = this.isConnected && this._pos && this._pos.playing && this._pos.dur && !document.hidden && !up && (this.mode() || 'play') === 'play' && !this.deep();
      if (want && !this._tickT) this._tickT = setInterval(function () { self._progress(); self._tickOn(); }, 1000);
      else if (!want && this._tickT) { clearInterval(this._tickT); this._tickT = null; }
    }
    /** @param {any} c */
    _qKey(c) { return c ? c.key + '|' + c.title : ''; }
    _after() {
      var c = this._c, mode = this.mode() || 'play', deep = this.deep();
      this._tickOn();
      if (deep && deep.search) { this._dropSpeakers(); this._mountLib(); return; }
      if (mode === 'play') this._fetchQueue(c);
      if (mode === 'lib') this._loadRadio();
      if (mode === 'spk' && !deep) this._mountSpeakers(); else this._dropSpeakers();
    }
    // UP NEXT: Music Assistant's queue, asked once a song (hk_music/queue)
    /** @param {any} c */
    _fetchQueue(c) {
      var sig = this._qKey(c), self = this;
      if (!c || sig === this._qFor) return;
      this._qFor = sig; this._q = null;
      this._ws({ type: 'hk_music/queue', entity_id: c.key, limit: 40 }).then(function (r) {
        if (self._qFor !== sig) return;
        self._q = r && r.ok ? r : { ok: false };
        self.redraw();
      }, function () { if (self._qFor === sig) { self._q = { ok: false }; self.redraw(); } });
    }

    // ------------------------------------------------------------ Speakers
    // THE MUSIC PAGE'S OWN SPEAKERS PANEL (hk-saver-panel.js: the capsule rows, the presets, Clear All, Reset, Update, Stop, each room in the
    // music its own volume), made a part of this page and told the same things the Music page tells it. Drawn here is only its slot; the
    // panel is mounted in it once the page is drawn (_mountSpeakers), and it reads the house when told (every redraw), as the sheet's does.
    // The rooms and the music's own state are read here, so the page's signature watches them.
    /** @param {any} c */
    _speakers(c) {
      var Mu = this._M(), self = this;
      Mu.rooms().forEach(function (/** @type {any} */ r) { self.st(r.entity); });
      if (c) this.st(c.key);
      return '<div class="spkp"><div class="pl quiet">Loading the speakers…</div></div>';
    }
    // what the panel is told (the Music page's _panelOpts): the rooms picked for the next music while nothing plays (this page's _target),
    // the rooms ticked while it does (_ticks, where a library pick goes too), and the music it follows
    _panelOpts() {
      var self = this;
      return {
        tabs: ['speakers'],
        client: function () { return self.client; },
        ctx: function () { return self._ctx(); },
        art: function () { return null; },
        stop: true,
        target: function () { return self._targetRooms(); },
        setTarget: function (/** @type {string[]} */ rooms) { self._target = rooms.slice(); self._hkSig = null; },
        next: function () { var c = self._ctx(); return c ? (self._ticks || c.members).slice() : self._targetRooms(); },
        setNext: function (/** @type {string[] | null} */ rooms) { var c = self._ctx(); self._ticks = rooms && c && !same(rooms, c.members) ? rooms.slice() : null; },
        follow: function (/** @type {string} */ key) { var Mu = self._M(); if (key && Mu && Mu.known(key)) Mu.setFocus(key); },
        done: function () { /* a page, not a pop-up: it stays on the rooms */ },
        wide: function () { return false; }
      };
    }
    // the panel's look goes in this card's own shadow root, once its module is there
    _panelCss() {
      var P = /** @type {any} */ (window).hkSaverPanel;
      if (!P) return false;
      if (!this._pcss) {
        var st = document.createElement('style');
        st.textContent = P.CSS + SPK_CSS;
        this.shadowRoot.appendChild(st);
        this._pcss = true;
      }
      return true;
    }
    _mountSpeakers() {
      var self = this, slot = this._root.querySelector('.spkp'), P = /** @type {any} */ (window).hkSaverPanel;
      if (!slot) return;
      if (!P || !this._panelCss()) {
        if (!this._pWait) { this._pWait = true; needFile('hk-saver-panel.js').then(function () { self._pWait = false; if (self.isConnected && window.hkSaverPanel) self.redraw(); }); }
        return;
      }
      if (!this._pnl) {
        this._pnl = P.create(this._panelOpts());
        this._pnl.el.classList.add('up');
        this._pnl.show('speakers');
      }
      if (this._pnl.el.parentNode !== slot) { slot.textContent = ''; slot.appendChild(this._pnl.el); }
      this._pnl.update(true);
    }
    _dropSpeakers() { if (this._pnl) { this._pnl.destroy(); this._pnl = null; } }

    // ------------------------------------------------------------ Library
    _library() {
      var Mu = this._M(), pls = Mu.playlists() || [], self = this;
      var out = '<div class="lbar">' + H.cap({ g: H.svg('search', 18, 'var(--hk-ink-2)'), t: 'Search Music', cls: 'sr', act: 'search' }) +
        H.cap({ g: H.svg('shuffle', 18), t: 'Shuffle All', act: 'shuffleall', off: !pls.length }) + '</div>';
      if (!pls.length) out += '<div class="pl quiet">No playlists yet. Add them in ' + H.esc(H.where('Music')) + '.</div>';
      else {
        var open = this._openPl && pls.filter(function (/** @type {any} */ p) { return p.name === self._openPl; })[0];
        out += '<div class="plg">' + pls.map(function (/** @type {any} */ p, /** @type {number} */ i) {
          return '<button class="pc' + (self._busyPl === p.name ? ' busy' : '') + (self._openPl === p.name ? ' open' : '') + '" data-act="pl" data-k="' + i + '">' +
            art('', p.image || '', p.icon || 'mdi:playlist-music', 36, p.image ? '' : 'background:' + grad(p.name)) + '<div class="nm">' + esc(p.name) + '</div></button>';
        }).join('') + '</div>';
        if (open && open.options) {
          out += '<div class="cr opts">' + open.options.map(function (/** @type {any} */ o, /** @type {number} */ j) {
            return H.cap({ t: o.name, act: 'plopt', data: { k: pls.indexOf(open), j: j } });
          }).join('') + '</div>';
        }
      }
      var rs = this._radio;
      if (rs && rs.length) {
        out += H.section('Radio', rs.length + (rs.length >= 24 ? '+' : '') + (rs.length === 1 ? ' station' : ' stations')) + '<div class="grid">' +
          rs.map(function (/** @type {any} */ s, /** @type {number} */ i) {
          var ab = String(s.name || '').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 3).toUpperCase();
          var logo = s.image ? art('ct', s.image, 'mdi:radio', 30) : '<div class="art logo" style="background:' + grad(s.name) + '">' + esc(ab) + '</div>';
          return '<button class="pl c2 stn" data-act="station" data-k="' + i + '">' + logo + '<div class="words"><div class="nm">' + esc(s.name) + '</div><div class="st">Live</div></div></button>';
        }).join('') + '</div>';
      }
      return out;
    }
    // RADIO STATIONS: Music Assistant's library, as the Music page lists a category (music_assistant.get_library)
    _loadRadio() {
      var Mu = this._M(), self = this, entry = Mu && Mu.libraryEntry();
      if (!entry || !this.client || this._radioBusy || (this._radio && Date.now() - this._radioAt < 600000)) return;
      this._radioBusy = true;
      this._ws({ type: 'call_service', domain: 'music_assistant', service: 'get_library', return_response: true,
                 service_data: { config_entry_id: entry, media_type: 'radio', order_by: 'name', limit: 24 } }).then(function (res) {
        var resp = (res && res.response) || res || {};
        self._radio = (resp.items || []).filter(function (/** @type {any} */ it) { return it && it.uri; });
        self._radioAt = Date.now(); self._radioBusy = false;
        self.redraw();
      }, function () { self._radioBusy = false; self._radioAt = Date.now() - 540000; if (!self._radio) self._radio = []; });
    }
    // THE MUSIC PAGE'S OWN LIBRARY CARD (search, and every level under it), a step deeper; what it plays, this page plays
    _mountLib() {
      var self = this, slot = this._root.querySelector('.libslot');
      if (!slot) return;
      if (!this._lib) {
        needTag('hk-library-card').then(function () {
          if (self._lib || !self.deep() || !self.deep().search) return;
          var lib = H.C.create({ type: 'custom:hk-library-card', music: true, layout: 'music' });
          if (!lib) return;
          /** @type {any} */ (lib).playerFor = function () { return self._c ? self._c.key : playTarget(self._pickRooms()).player; };
          /** @type {any} */ (lib).playerNameFor = function () { return self._c ? self._M().label(self._c) : self._roomsLabel(self._pickRooms()); };
          /** @type {any} */ (lib).playVia = function (/** @type {any} */ node) { self._playNode(node); };
          lib.toggleAttribute('flow', true);
          lib.addEventListener(/** @type {any} */ (window).hkShell.events.toast, function (/** @type {any} */ e) {
            e.stopPropagation();
            if (e.detail && e.detail.message) self._say(e.detail.message);
          });
          self._lib = lib;
          if (self.client && lib.hkSetClient) lib.hkSetClient(self.client);
          self._mountLib();
          self._later(function () {
            var s = lib.shadowRoot && lib.shadowRoot.querySelector('.search');
            if (s) try { /** @type {any} */ (s).focus(); } catch (x) { /* not focusable yet */ }
          }, 400);
        });
        return;
      }
      if (this._lib.parentNode !== slot) slot.appendChild(this._lib);
    }

    // ------------------------------------------------------------ the calls
    /** @param {string[]} rooms @param {Function} go */
    _askThenPlay(rooms, go) {
      var Mu = this._M(), c = this._c, self = this;
      var others = Mu.contexts(this.client).filter(function (/** @type {any} */ x) {
        return (!c || x.key !== c.key) && x.members.some(function (/** @type {string} */ r) { return rooms.indexOf(r) < 0; });
      });
      if (!others.length || !C.confirmSheet) { go(); return; }
      var left = /** @type {string[]} */ ([]);
      others.forEach(function (/** @type {any} */ x) { x.members.forEach(function (/** @type {string} */ r) { if (rooms.indexOf(r) < 0) left.push(r); }); });
      var detail = others.length === 1 ? Mu.label(others[0]) + (others[0].title ? ' · ' + others[0].title : '') : others.map(function (/** @type {any} */ x) { return Mu.label(x); }).join(', ');
      C.confirmSheet('Also stop the other rooms?', function () {
        self._callResp('hk_frontend', 'music_stop', { rooms: left }).then(function () { go(); });
      }, { detail: detail, yes: 'Stop Playing', no: 'Leave Playing', onNo: go });
    }
    /** @param {any} pl @param {any} opt @param {boolean} [shuffle] */
    _playPlaylist(pl, opt, shuffle) {
      var rooms = this._pickRooms(), self = this, Mu = this._M();
      if (!rooms.length) { this._say('Pick a speaker first'); this.mode('spk'); return; }
      var key = opt ? opt.key : pl.key, name = opt ? opt.name : pl.name;
      this._askThenPlay(rooms, function () {
        self._busyPl = pl.name; self._openPl = null; self.redraw();
        self._say('Starting ' + name + '…');
        var guess = playTarget(rooms).player;
        if (guess && Mu.known(guess)) Mu.setFocus(guess, { hold: true });
        self._callResp('hk_frontend', 'music_play', { rooms: rooms, playlist: key }).then(function (res) {
          var r = (res && res.response) || {};
          self._busyPl = null;
          if (!res.ok || r.ok === false) { if (guess) Mu.release(guess); self.redraw(); self._say('Could not play ' + name + (r.message ? ': ' + r.message : '')); return; }
          if (r.leader && Mu.known(r.leader)) Mu.setFocus(r.leader, { hold: true });
          if (shuffle) self._call('media_player', 'shuffle_set', { entity_id: r.leader || guess, shuffle: true });
          self._ticks = null; self._target = null;
          self._say('Playing ' + name + ' on ' + self._roomsLabel(rooms));
          self.mode('play');
        });
      });
    }
    // A LIBRARY ITEM (a station, a search result): on what plays; nothing playing, on the rooms picked -- one player first, then the others
    /** @param {any} node */
    _playNode(node) {
      var c = this._c, self = this, Mu = this._M(), rooms = this._pickRooms();
      var t = c ? { player: c.key, then: null } : playTarget(rooms);
      if (!t.player) { this._say('Pick a speaker first'); return; }
      var label = c ? Mu.label(c) : this._roomsLabel(rooms);
      var go = function () {
        self._say('Playing ' + node.title + ' on ' + label);
        self._callResp('hk_frontend', 'music_play_media', { player: t.player, media_content_id: node.media_content_id, media_content_type: node.media_content_type }).then(function (res) {
          var r = (res && res.response) || {};
          if (!res.ok || r.ok === false) { self._say('Could not play ' + node.title + (r.message ? ': ' + r.message : '')); return; }
          if (Mu.known(t.player)) Mu.setFocus(t.player);
          self._target = null;
          if (t.then) {
            self._callResp('hk_frontend', 'music_transfer', { rooms: t.then, source: t.player }).then(function (r2) {
              var a = (r2 && r2.response) || {};
              if (a.leader && Mu.known(a.leader)) Mu.setFocus(a.leader);
            });
          }
          if (self.deep()) self.deep(null);
          self.mode('play');
        });
      };
      if (c) go(); else this._askThenPlay(rooms, go);
    }
    /** @param {string} cmd */
    _transport(cmd) {
      var c = this._c;
      if (!c) return;
      this._callResp('hk_frontend', 'music_transport', { player: c.key, command: cmd });
      if (cmd === 'play_pause') {
        var pos = this._pos;
        if (pos) { pos.pos = Math.min(pos.dur || Infinity, pos.pos + (pos.playing && pos.at ? (Date.now() - pos.at) / 1000 : 0)); pos.at = Date.now(); pos.playing = !pos.playing; }
        this._opt = { v: !(this._opt && Date.now() < this._opt.until ? this._opt.v : c.playing), until: Date.now() + 3000 };
          this.redraw();
      }
    }
    // THE VOLUME TRACK: the finger's once it goes sideways (down, the page scrolls); a tap sets it where it lands. Sent as the Music page's
    _wireVolume() {
      var self = this, root = this._root, s = /** @type {any} */ (null);
      /** @param {number} x */
      var at = function (x) { var r = s.tr.getBoundingClientRect(); return r.width ? Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100) / 100 : null; };
      var send = function () {
        var c = self._c, act = self._actions();
        if (s && s.t) { clearTimeout(s.t); s.t = null; }
        if (!c || !act || !self._vol || self._vol.sent === self._vol.val) return;
        self._vol.sent = self._vol.val;
        volumeCalls(c, self._vol.val).reduce(function (/** @type {Promise<any>} */ p, /** @type {any} */ d) {
          return p.then(function () { return act.callService('media_player', 'volume_set', d); });
        }, Promise.resolve()).catch(function (/** @type {any} */ e) { console.error('hk-hv-music: volume_set failed', e); });
      };
      var set = function (/** @type {number} */ x) {
        var val = at(x);
        if (val === null) return;
        self._vol = { val: val, until: Date.now() + 4000, sent: self._vol ? self._vol.sent : null };
        s.tr.style.setProperty('--v', Math.round(val * 100) + '%');
        var now = Date.now();
        if (now - s.last >= 250) { s.last = now; send(); } else if (!s.t) s.t = setTimeout(function () { s.last = Date.now(); send(); }, 250 - (now - s.last));
      };
      root.addEventListener('pointerdown', function (/** @type {PointerEvent} */ ev) {
        if (ev.button > 0 || !self._c) return;
        var el = /** @type {any} */ (ev.target) && /** @type {any} */ (ev.target).closest ? /** @type {any} */ (ev.target).closest('.pvol') : null;
        var tr = el && el.querySelector('.vt');
        if (!tr || el.classList.contains('off')) return;
        s = { el: el, tr: tr, x: ev.clientX, y: ev.clientY, pid: ev.pointerId, moved: false, side: false, last: 0, t: null };
      });
      root.addEventListener('pointermove', function (/** @type {PointerEvent} */ ev) {
        if (!s || ev.pointerId !== s.pid || s.side) return;
        if (!s.moved) {
          var dx = ev.clientX - s.x, dy = ev.clientY - s.y;
          if (Math.hypot(dx, dy) < 6) return;
          if (Math.abs(dy) > Math.abs(dx)) { s.side = true; return; }
          s.moved = true; self._dragging = true;
          try { s.el.setPointerCapture(ev.pointerId); } catch (x) { /* a test page */ }
        }
        ev.preventDefault();
        set(ev.clientX);
      });
      var end = function (/** @type {PointerEvent} */ ev, /** @type {boolean} */ ok) {
        if (!s || ev.pointerId !== s.pid) return;
        var d = s; s = null;
        if (!d.moved && !d.side && ok) { s = d; set(ev.clientX); send(); s = null; }
        else if (d.moved) { s = d; if (ok) send(); s = null; }
        if (d.moved) { self._eat = ok; setTimeout(function () { self._eat = false; }, 0); }
        self._dragging = false;
        if (self._vol) self._vol.until = Date.now() + 4000;
        if (self._pending) { self._pending = false; self.redraw(); }
      };
      root.addEventListener('pointerup', function (/** @type {PointerEvent} */ ev) { end(ev, true); });
      root.addEventListener('pointercancel', function (/** @type {PointerEvent} */ ev) { end(ev, false); });
    }

    /** @param {string} act @param {any} el */
    act(act, el) {
      var Mu = this._M(), k = el.getAttribute('data-k'), id = el.getAttribute('data-id'), self = this;
      if (act === 'mode') { this.mode(k); return true; }
      if (act === 'tp') { this._transport(String(k)); return true; }
      if (act === 'rooms') { this.mode('spk'); return true; }
      if (act === 'tolib') { this.mode('lib'); return true; }
      if (act === 'search') { this.deep({ search: true }); return true; }
      if (act === 'queue') {
        var up = this._root.querySelector('#upnext');
        if (up) try { up.scrollIntoView({ block: 'start' }); } catch (e) { /* tests */ }
        return true;
      }
      if (act === 'shuffle') {
        var c = this._c, st = c && this.st(c.key);
        if (c) this._call('media_player', 'shuffle_set', { entity_id: c.key, shuffle: !(st && st.attributes && st.attributes.shuffle) });
        return true;
      }
      if (act === 'qplay') {
        var cc = this._c, port = this._actions();
        if (!cc || !port || this._qBusy || !id) return true;
        this._qBusy = id; this.redraw();
        this._ws({ type: 'hk_music/queue_play', entity_id: cc.key, item_id: id }).then(function (r) {
          self._qBusy = null; self._qFor = '';
          if (r && r.ok === false) self._say('Could not play that song' + (r.message ? ': ' + r.message : ''));
          self.redraw();
        }, function () { self._qBusy = null; self._say('Could not play that song'); self.redraw(); });
        return true;
      }
      var pls = (Mu && Mu.playlists()) || [];
      if (act === 'startpl') { var f = pls[0]; if (f) this._playPlaylist(f, f.options && f.options[0] ? f.options[0] : null); return true; }
      if (act === 'pl') {
        var pl = pls[Number(k)];
        if (!pl || this._busyPl) return true;
        if (pl.options && pl.options.length) { this._openPl = this._openPl === pl.name ? null : pl.name; this.redraw(); return true; }
        this._playPlaylist(pl, null);
        return true;
      }
      if (act === 'plopt') {
        var p0 = pls[Number(k)], o = p0 && p0.options && p0.options[Number(el.getAttribute('data-j'))];
        if (p0 && o) this._playPlaylist(p0, o);
        return true;
      }
      if (act === 'shuffleall') {
        var pick = pls[Math.floor(Math.random() * pls.length)];
        if (pick) this._playPlaylist(pick, pick.options && pick.options[0] ? pick.options[0] : null, true);
        return true;
      }
      if (act === 'station') {
        var s0 = (this._radio || [])[Number(k)];
        if (s0) this._playNode({ title: s0.name, media_content_id: s0.uri, media_content_type: 'music' });
        return true;
      }
      return false;
    }
  }
  H.register('hk-hv-music-card', HvMusic, 'HK HomeView Music', 'The Music page on an Apple HomeView: what plays, the speakers, the library.');

  // =================================================================== CAMERAS
  var CAMERAS_CSS = CSS + [
    '.camg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:' + P(12) + '}',
    '.cam{position:relative;overflow:hidden;border-radius:' + P(20) + ';background:#0b0d12;height:' + P(150) + ';box-shadow:0 ' + P(6) + ' ' + P(18) + ' rgba(0,0,0,.4);isolation:isolate}',
    '.cam.big{grid-column:1 / -1;height:' + P(250) + ';border-radius:' + P(24) + '}',
    '.pb{position:absolute;inset:0;z-index:0}',
    '.pb>*{position:absolute!important;inset:0!important;display:block!important;width:100%!important;height:100%!important;border-radius:0!important;box-shadow:none!important;' +
      '--ha-card-border-radius:0!important}',
    '.hit{position:absolute;inset:0;z-index:3;display:block}',
    '.ov{position:absolute;inset:0;z-index:2;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.6);color:#fff}',
    '.ov .lab{position:absolute;left:' + P(14) + ';bottom:' + P(11) + ';right:' + P(60) + ';font-size:' + P(15) + ';font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.big .ov .lab{font-size:' + P(17) + '}',
    '.ov .age{position:absolute;right:' + P(12) + ';bottom:' + P(11) + ';font-size:' + P(12) + ';font-weight:600;color:rgba(255,255,255,.85);background:rgba(0,0,0,.5);padding:' + P(3) + ' ' + P(7) +
      ';border-radius:' + P(7) + ';text-shadow:none}',
    '.ov .mo{position:absolute;left:' + P(12) + ';top:' + P(12) + ';font-size:' + P(12) + ';font-weight:700;color:#000;background:#ffb340;padding:' + P(4) + ' ' + P(8) + ';border-radius:' + P(8) +
      ';text-shadow:none}',
    '.ov .gone{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:' + P(6) + ';font-size:' + P(14) +
      ';color:rgba(235,235,245,.62);padding-bottom:' + P(24) + '}',
    '.dpic{position:relative;border-radius:' + P(24) + ';overflow:hidden;background:#0b0d12;box-shadow:0 ' + P(6) + ' ' + P(18) + ' rgba(0,0,0,.4);min-height:' + P(120) + ';--hk-db-max:' + P(300) +
      '}',
    '.dpic>*{display:block}',
    '.acts{display:flex;gap:' + P(10) + ';margin-top:' + P(12) + '}',
    '.acap{flex:1;min-width:0;height:' + P(60) + ';border-radius:' + P(20) + '!important;display:flex;align-items:center;justify-content:center;gap:' + P(8) + ';font-size:' + P(16) +
      ';font-weight:600;padding:0 ' + P(10) + '}',
    '.acap .t{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.clip{display:flex;align-items:center;gap:' + P(12) + ';width:100%;height:' + P(62) + ';padding:0 ' + P(14) + ' 0 ' + P(10) + ';border-top:1px solid ' + v('line') + ';text-align:left}',
    '.clip:first-child{border-top:0}',
    '.clip>.art{width:' + P(76) + ';height:' + P(44) + ';border-radius:' + P(10) + ';box-shadow:0 ' + P(2) + ' ' + P(6) + ' rgba(0,0,0,.3)}',
    '.clip .mid{flex:1;min-width:0}',
    '.livei{display:inline-flex;align-items:center;gap:' + P(7) + ';height:' + P(34) + ';padding:0 ' + P(12) + ';border-radius:' + P(17) + ';background:' + v('key') + ';font-size:' + P(13) +
      ';font-weight:600}',
    '.livei::before{content:"";width:' + P(8) + ';height:' + P(8) + ';border-radius:50%;background:#ff453a}'
  ].join('\n');

  // the camera's own name, the device's: "Front Door", not "Front Door Low Resolution Channel"
  /** @param {any} h @param {string} id @param {any} st */
  function camName(h, id, st) {
    var ents = (h && h.entities) || {}, devs = (h && h.devices) || {}, e = ents[id] || {}, dv = e.device_id && devs[e.device_id];
    var n = (dv && (dv.name_by_user || dv.name)) || (st && st.attributes && st.attributes.friendly_name) || id;
    return String(n).replace(/\s+(low|medium|high)\s+resolution\s+channel$/i, '').replace(/\s+camera$/i, '') || String(n);
  }
  // WHAT KIND OF MOTION a detection sensor is, by its name
  /** @param {string} id @param {any} st */
  function motionKind(id, st) {
    var s = (id + ' ' + ((st && st.attributes && st.attributes.friendly_name) || '')).toLowerCase();
    return /person|people/.test(s) ? 'Person' : /vehicle|car\b/.test(s) ? 'Vehicle' : /animal|pet/.test(s) ? 'Animal' : /package/.test(s) ? 'Package' : /doorbell|ring/.test(s) ? 'Doorbell' : 'Motion';
  }
  // "now", "2m ago", "3h ago": since the last motion (the kit's short words, with "ago" after a number)
  /** @param {number} at @param {boolean} on @param {number} now */
  function agoWords(at, on, now) {
    var w = on ? 'now' : H.ago(at, now);
    return w === 'now' ? 'now' : w + ' ago';
  }
  var SENSOR_CLASS = { motion: 1, occupancy: 1, moving: 1 };

  class HvCameras extends MediaPage {
    static get CSS() { return CAMERAS_CSS; }
    constructor() {
      super();
      this._f = null; this._ix = null; this._clips = null; this._motionAt = {};
    }
    // the cameras, in the page's order, from the cards the build made
    _ids() {
      var seen = /** @type {Record<string, boolean>} */ ({});
      return H.cardsOf(this.h, 'hk-camera-live-card').map(function (/** @type {any} */ c) { return c.entity; })
        .filter(function (/** @type {any} */ id) { if (!id || typeof id !== 'string' || seen[id]) return false; seen[id] = true; return true; });
    }
    // WHICH ENTITIES BELONG TO EACH CAMERA'S DEVICE (its detection sensors, its light, its lock, its high channel): worked out once per registry
    /** @param {string[]} ids */
    _index(ids) {
      var h = this.client, ents = (h && h.entities) || {}, key = ids.join(',');
      if (this._ix && this._ix.ents === ents && this._ix.key === key) return this._ix;
      var devOf = /** @type {Record<string, string>} */ ({}), want = /** @type {Record<string, boolean>} */ ({});
      ids.forEach(function (id) { var e = ents[id]; if (e && e.device_id) { devOf[id] = e.device_id; want[e.device_id] = true; } });
      var byDev = /** @type {Record<string, string[]>} */ ({});
      Object.keys(ents).forEach(function (k) {
        var e = ents[k];
        if (!e || !e.device_id || !want[e.device_id]) return;
        var d = k.split('.')[0];
        if (d === 'binary_sensor' || d === 'light' || d === 'switch' || d === 'lock' || d === 'camera') (byDev[e.device_id] = byDev[e.device_id] || []).push(k);
      });
      return (this._ix = { ents: ents, key: key, devOf: devOf, byDev: byDev });
    }
    // ONE CAMERA: {id, name, gone, motion: {at, kind} | null, dev: [entities of its device]}
    /** @param {string} id @param {any} ix */
    _cam(id, ix) {
      var st = this.st(id), dev = ix.devOf[id], list = (dev && ix.byDev[dev]) || [], self = this, best = /** @type {any} */ (null), now = Date.now();
      list.forEach(function (/** @type {string} */ k) {
        if (k.indexOf('binary_sensor.') !== 0) return;
        var s = self.st(k), a = (s && s.attributes) || {};
        if (!s || s.state === 'unavailable' || s.state === 'unknown') return;
        if (!(SENSOR_CLASS[/** @type {keyof typeof SENSOR_CLASS} */ (a.device_class)] || /motion|person|vehicle|animal|package|doorbell|ring/.test(k))) return;
        var at = s.state === 'on' ? now : Date.parse(s.last_changed);
        if (isFinite(at) && (!best || at > best.at)) best = { at: at, kind: motionKind(k, s), on: s.state === 'on' };
      });
      return { id: id, st: st, name: camName(this.client, id, st), gone: !st || st.state === 'unavailable', motion: best, dev: list };
    }
    _plan() {
      var h = this.client, ids = this._ids(), ix = this._index(ids), self = this, now = Date.now();
      var cams = ids.map(function (id) { return self._cam(id, ix); });
      var deep = this.deep(), title = (this._config || {}).title || 'Cameras';
      if (deep && deep.cam) {
        var one = cams.filter(function (c) { return c.id === deep.cam; })[0];
        if (one) return this._planOne(one, ix, now);
      }
      if (!cams.length) {
        return { view: 'quiet', hd: H.head({ title: title }), rest: '<div class="pl quiet">No cameras on this screen. Add them in ' + H.esc(H.where('Accessories')) + '.</div>' };
      }
      // THE CAMERA WITH THE LATEST MOTION FIRST, then the rest in the page's own order
      var withMo = cams.filter(function (c) { return c.motion && !c.gone; }).sort(function (a, b) { return b.motion.at - a.motion.at; });
      var order = withMo.concat(cams.filter(function (c) { return withMo.indexOf(c) < 0; }));
      var first = order.filter(function (c) { return !c.gone; })[0] || order[0];
      order = [first].concat(order.filter(function (c) { return c !== first; }));
      var latest = withMo[0] && now - withMo[0].motion.at < 86400000 ? withMo[0].motion : null;
      var sum = '<b>' + cams.length + (cams.length === 1 ? ' Camera' : ' Cameras') + '</b>' +
        (latest ? ' · <span class="warn">Motion</span> ' + agoWords(latest.at, latest.on, now) : '');
      var tiles = order.map(function (c, i) {
        var big = i === 0, mo = c.motion && !c.gone && now - c.motion.at < 1800000 ? c.motion : null;
        var ov = c.gone ? '<div class="gone">' + H.glyph('hk:cctv', 30, 'var(--hk-ink-2)') + 'Unavailable</div>' : '';
        if (mo && big) ov += '<div class="mo">' + esc(mo.kind) + (mo.on ? '' : ' · ' + H.ago(mo.at, now)) + '</div>';
        ov += '<div class="lab">' + esc(c.name) + '</div>' + (big && !c.gone ? '<div class="age">Live</div>' : '') +
          (!big && mo ? '<div class="age">' + esc(mo.kind) + '</div>' : '');
        return { key: c.id + (big ? '|B' : '|S'), id: c.id, big: big, gone: c.gone, ov: ov + '<button class="hit" data-act="cam" data-id="' + esc(c.id) + '" aria-label="' + esc(c.name) +
          '"></button>' };
      });
      return { view: 'grid', hd: H.head({ title: title, sum: sum }), tiles: tiles, rest: '' };
    }
    // ONE CAMERA: the picture, what its device has, today's clips
    /** @param {any} c @param {any} ix @param {number} now */
    _planOne(c, ix, now) {
      var mo = c.motion && now - c.motion.at < 86400000 ? c.motion : null;
      var sum = mo ? '<span class="warn">' + esc(mo.kind) + '</span> · ' + agoWords(mo.at, mo.on, now) : c.gone ? 'Unavailable' : '';
      var hd = H.head({ title: c.name, back: true, sum: sum, right: c.gone ? '' : '<div class="livei">Live</div>' });
      var acts = '', light = c.dev.filter(function (/** @type {string} */ k) { return k.indexOf('light.') === 0 || (k.indexOf('switch.') === 0 && /light|flood|spot|lamp/.test(k)); })[0];
      var lock = c.dev.filter(function (/** @type {string} */ k) { return k.indexOf('lock.') === 0; })[0];
      if (light) {
        var ls = this.st(light), lon = H.isOn(ls);
        acts += H.plate({ cls: 'acap' + (lon ? ' lit' : ''), act: 'toggle', data: { id: light }, label: 'Light' },
          H.glyph('hk:lightbulb', 20, lon ? H.DEEP.yellow : 'var(--hk-ink)') + '<span class="t">' +
            esc(ls && ls.attributes.friendly_name ? String(ls.attributes.friendly_name).replace(c.name, '').trim() || 'Light' : 'Light') + '</span>');
      }
      if (lock) {
        var ks = this.st(lock), open = !!ks && ks.state !== 'locked';
        acts += H.plate({ cls: 'acap' + (open ? ' lit' : ''), act: 'toggle', data: { id: lock }, label: 'Lock' },
          H.glyph(open ? 'hk:lock-open-variant' : 'hk:lock', 20, open ? H.DEEP.teal : 'var(--hk-ink)') + '<span class="t">' + (open ? 'Unlocked' : 'Unlock') + '</span>');
      }
      var rest = acts ? '<div class="acts">' + acts + '</div>' : '';
      var cl = this._clips, host = this._hostTimeline();
      if (host && cl && cl.id === c.id && cl.state !== 'loading') {
        rest += H.section('Today at ' + c.name, cl.rows.length ? cl.rows.length + (cl.rows.length === 1 ? ' clip' : ' clips') : '');
        if (!cl.rows.length) rest += '<div class="pl quiet">' + (cl.state === 'error' ? 'Couldn’t load today’s clips.' : 'Nothing recorded today.') + '</div>';
        else {
          rest += '<div class="pl list" style="padding:' + P(4) + ' 0">' + cl.rows.map(function (/** @type {any} */ r) {
            return '<button class="clip" data-act="clip" data-id="' + esc(r.id) + '">' +
              '<div class="art">' + (r.thumb ? '<img src="' + esc(r.thumb) + '" alt="" loading="lazy" decoding="async">' : H.glyph('hk:cctv', 18, 'var(--hk-ink-2)')) + '</div>' +
              '<div class="mid"><div class="nm">' + esc(r.kind) + '</div><div class="st">' + esc(r.when) + '</div></div></button>';
          }).join('') + '</div>';
        }
      }
      return { view: 'deep', hd: hd, cam: c, rest: rest, gone: c.gone };
    }
    _hostTimeline() {
      var SH = /** @type {any} */ (window).hkShell;
      try { return !!(SH && typeof SH.hostPage === 'function' && SH.hostPage('timeline')); } catch (e) { return false; }
    }
    // THE PAGE IS MADE IN PLACE: its pictures are elements (live and still cards, the player), so a redraw that changes a label never
    // rebuilds one (a stream would start again); a tile that stays is only moved when its place changes
    _render() {
      if (!this.client || !this._config) return;
      this._reading = [];
      /** @type {any} */
      var o;
      try { o = this._plan(); } catch (e) {
        console.error('[hk-hv] ' + this.localName + ' draw', e);
        o = { view: 'err', hd: H.head({ title: (this._config || {}).title || '' }), rest: '<div class="pl quiet">This page could not be drawn.</div>' };
      }
      this._reads = this._reading; this._reading = null;
      try { this._frame(o); } catch (e) { console.error('[hk-hv] ' + this.localName + ' frame', e); }
      this._hkSig = this._sigOf();
      try { this._after(); } catch (e) { console.error('[hk-hv-media] cameras after', e); }
    }
    /** @param {any} el @param {string} html */
    _put(el, html) { if (el.__h !== html) { el.innerHTML = html; el.__h = html; } }
    /** @param {any} o */
    _frame(o) {
      var f = this._f;
      if (!f || f.view !== o.view) {
        this._f = f = { view: o.view, tiles: {}, grid: null, dbl: null, dblId: '' };
        this._root.innerHTML = '<div class="hvi"><div data-r="hd"></div><div data-r="main"></div><div data-r="rest"></div></div>';
        f.hd = this._root.querySelector('[data-r=hd]'); f.main = this._root.querySelector('[data-r=main]'); f.rest = this._root.querySelector('[data-r=rest]');
      }
      this._put(f.hd, o.hd);
      if (o.view === 'grid') this._tiles(o.tiles);
      else if (o.view === 'deep') this._deepPic(o.cam);
      this._put(f.rest, o.rest || '');
    }
    /** @param {any[]} list */
    _tiles(list) {
      var f = this._f, self = this, keep = /** @type {Record<string, boolean>} */ ({});
      if (!f.grid) { f.grid = document.createElement('div'); f.grid.className = 'camg'; f.main.appendChild(f.grid); }
      list.forEach(function (t, i) {
        var el = f.tiles[t.key];
        if (!el) {
          el = document.createElement('div');
          el.className = 'cam' + (t.big ? ' big' : '');
          el.innerHTML = '<div class="pb"></div><div class="ov"></div>';
          f.tiles[t.key] = el;
          if (!t.gone) self._mountPic(el, t);
        }
        var ov = el.lastChild;
        if (ov.__h !== t.ov) { ov.innerHTML = t.ov; ov.__h = t.ov; }
        keep[t.key] = true;
        var cur = f.grid.children[i];
        if (cur !== el) f.grid.insertBefore(el, cur || null);
      });
      Object.keys(f.tiles).forEach(function (k) { if (!keep[k]) { f.tiles[k].remove(); delete f.tiles[k]; } });
    }
    // THE FEATURED CAMERA is the page's live camera card (hk-camera-live-card: it takes its turn to connect and keeps the still under
    // the video); the others are stills (the same picture card its still is, `camera_view: auto`, refreshed by the host): nine
    // streams at once is what the page's own tiles queue for, and a HomeView does not need them
    /** @param {any} el @param {any} t */
    _mountPic(el, t) {
      var self = this, box = el.firstChild;
      needTag(t.big ? 'hk-camera-live-card' : 'hk-camera-mosaic-card').then(function () {
        var f = self._f;
        if (!f || f.tiles[t.key] !== el || !self.client) return;
        var pic = null;
        if (t.big) {
          pic = H.C.create({ type: 'custom:hk-camera-live-card', entity: t.id, aspect_ratio: '516x250', fit_mode: 'cover' });
          if (pic && /** @type {any} */ (pic).hkSetClient) /** @type {any} */ (pic).hkSetClient(self.client);
        } else {
          pic = H.C.createCard({ type: 'picture-entity', entity: t.id, camera_view: 'auto', show_name: false, show_state: false, aspect_ratio: '252x150',
                                 fit_mode: 'cover', tap_action: { action: 'none' }, hold_action: { action: 'none' } }, self.client);
        }
        if (pic) { box.appendChild(pic); el._pic = pic; }
      });
    }
    // the camera's own stream channel (the high one of the same device, where there is one) and its speaker, as the camera sheet picks them
    /** @param {any} c */
    _deepPic(c) {
      var f = this._f, self = this;
      if (c.gone) {
        if (f.dbl) { f.dbl.remove(); f.dbl = null; f.dblId = ''; }
        this._put(f.main, '<div class="pl quiet">' + esc(c.name) + ' is unavailable.</div>');
        return;
      }
      if (f.dblId === c.id && f.dbl) return;
      f.main.innerHTML = ''; f.main.__h = '';
      f.dblId = c.id;
      var h = this.client, ents = (h && h.entities) || {}, e = ents[c.id], dev = e && e.device_id, stream = c.id;
      if (dev) {
        var hi = Object.keys(ents).filter(function (k) { return k.indexOf('camera.') === 0 && ents[k].device_id === dev && /high/.test(k) && h.states[k] && h.states[k].state !== 'unavailable';
          }).sort()[0];
        if (hi) stream = hi;
      }
      var speaker = dev ? Object.keys(ents).filter(function (k) { return k.indexOf('media_player.') === 0 && ents[k].device_id === dev && /speaker/.test(k); }).sort()[0] : null;
      var box = document.createElement('div');
      box.className = 'dpic';
      f.main.appendChild(box);
      f.dbl = box;
      needTag('hk-doorbell-card').then(function () {
        if (self._f !== f || f.dbl !== box || !self.client) return;
        var cfg = /** @type {any} */ ({ type: 'custom:hk-doorbell-card', entity: stream, volume: true, aspect_ratio: 'auto', glass: false });
        if (speaker) cfg.speaker = speaker;
        var card = H.C.create(cfg);
        if (!card) return;
        box.appendChild(card);
        /** @type {any} */ (box)._card = card;
        if (/** @type {any} */ (card).hkSetClient) /** @type {any} */ (card).hkSetClient(self.client);
      });
    }
    // every new client reaches the pictures too (a still's signed address, a stream's own state)
    _receiveClient() {
      super._receiveClient();
      var f = this._f, c = this.client, B = /** @type {any} */ (window).hkHostClient;
      if (!f || !c) return;
      Object.keys(f.tiles).forEach(function (k) {
        var pic = f.tiles[k]._pic;
        if (!pic) return;
        if (pic.hkSetClient) pic.hkSetClient(c); else if (B && B.bridge) B.bridge(pic, c);
      });
      var card = f.dbl && f.dbl._card;
      if (card && card.hkSetClient) card.hkSetClient(c);
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      // the pictures go with the page (their streams end); drawn again when it comes back
      this._f = null; this._root.innerHTML = ''; this._hkSig = null;
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this.client && this._config && !this._f) this.redraw();
    }
    // TODAY'S CLIPS: the House Timeline's rows for this camera since the house's midnight (the camera sheet's Recent strip reads the same
    // feed); only where the host keeps one, read again when the camera has new motion
    _after() {
      var d = this.deep(), self = this, c = this.client;
      if (!d || !d.cam || !this._hostTimeline() || !c || typeof c.callApi !== 'function') return;
      var m = this._motionStamp(d.cam), cl = this._clips;
      if (cl && cl.id === d.cam && (cl.state === 'loading' || cl.stamp === m)) return;
      var id = d.cam, keep = cl && cl.id === id ? cl.rows : [];
      this._clips = { id: id, state: 'loading', rows: keep, stamp: m, events: cl && cl.id === id ? cl.events : [] };
      Promise.all([needFile('hk-timeline-block.js'), needFile('hk-timeline.js')]).then(function () {
        var W = /** @type {any} */ (window), lib = W.hkTimelineBlock && W.hkTimelineBlock.lib, T = W.hkTimeline && W.hkTimeline.lib;
        if (!lib || !T) throw new Error('no timeline');
        var ctx = ctxNow(), now = Date.now();
        return Promise.resolve(c.callApi('GET', lib.todayPath(id, lib.todayStart(now, ctx)))).then(function (/** @type {any} */ res) {
          var evs = Array.isArray(res && res.events) ? lib.pick(res.events, 50) : [];
          return { evs: evs, rows: evs.map(function (/** @type {any} */ ev) {
            var r = lib.rowView(ev, now, ctx);
            return { id: String(ev.id), kind: lib.shortTitle(ev), when: (r.day ? r.day + ' ' : '') + r.time + (ev.zone ? ' · ' + ev.zone : ''), thumb: r.thumb };
          }) };
        });
      }).then(function (/** @type {any} */ got) {
        if (!self._clips || self._clips.id !== id) return;
        self._clips = { id: id, state: 'ready', rows: got.rows, events: got.evs, stamp: m };
        self.redraw();
      }, function () {
        if (!self._clips || self._clips.id !== id) return;
        self._clips = { id: id, state: 'error', rows: [], events: [], stamp: m };
        self.redraw();
      });
    }
    // what changes when the camera has something new: the latest motion across its detection sensors
    /** @param {string} id */
    _motionStamp(id) {
      var ix = this._ix, dev = ix && ix.devOf[id], list = (dev && ix.byDev[dev]) || [], c = this.client, s = '';
      list.forEach(function (/** @type {string} */ k) { var x = c && c.states[k]; if (x && k.indexOf('binary_sensor.') === 0) s += x.last_updated; });
      return s;
    }
    /** @param {string} act @param {any} el */
    act(act, el) {
      var id = el.getAttribute('data-id');
      if (act === 'cam') { if (id) this.deep({ cam: id }); return true; }
      if (act === 'back') { this.deep(null); return true; }
      if (act === 'clip') {
        var cl = this._clips, W = /** @type {any} */ (window), ev = cl && (cl.events || []).filter(function (/** @type {any} */ e) { return String(e.id) === id; })[0];
        if (ev && W.hkTimeline && typeof W.hkTimeline.openSheet === 'function') W.hkTimeline.openSheet(ev, this.client, { noAll: true });
        return true;
      }
      return false;
    }
  }
  H.register('hk-hv-cameras-card', HvCameras, 'HK HomeView Cameras', 'The Cameras page on an Apple HomeView: the camera with motion first, the rest two across, one camera deeper.');

  // =================================================================== LIVE TV
  var TV_CSS = CSS + [
    '.ch{display:flex;align-items:center;gap:' + P(12) + ';padding:0 ' + P(14) + ' 0 ' + P(12) + ';text-align:left}',
    '.ch .words{flex:1;min-width:0;display:flex;flex-direction:column}',
    '.ch .trk{margin-top:' + P(8) + ';height:' + P(4) + '}',
    '.pl.lit .trk{background:rgba(0,0,0,.12)}.pl.lit .trk>i{background:#5e5ce6}',
    '.tvlogo{width:' + P(76) + ';height:' + P(76) + ';border-radius:' + P(16) + ';font-size:' + P(19) + ';font-weight:800;letter-spacing:' + P(-0.5) + ';color:#fff;text-shadow:none;box-shadow:0 ' +
      P(4) + ' ' + P(12) + ' rgba(0,0,0,.3),inset 0 0 0 1px rgba(255,255,255,.18)}',
    '.tvd{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:' + P(12) + ';align-items:start}',
    '.tvl{display:flex;flex-direction:column;text-shadow:0 1px 2px rgba(0,0,0,.35);min-width:0}',
    '.tvl .big{width:100%;height:' + P(142) + ';border-radius:' + P(24) + ';font-size:' + P(44) + ';font-weight:800;color:#fff;text-shadow:none;box-shadow:0 ' + P(8) + ' ' + P(22) +
      ' rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.18)}',
    '.tvl .big hk-icon{opacity:.6}',
    '.tvl .lbl{margin-top:' + P(16) + '}',
    '.tvl .now{font-size:' + P(22) + ';font-weight:700;letter-spacing:' + P(-0.35) + ';margin-top:' + P(4) + '}',
    '.tvl .nxt{margin-top:' + P(14) + '}',
    '.tvr{display:flex;flex-direction:column;gap:' + P(10) + ';min-width:0}',
    '.tvr .cap{justify-content:center;height:' + P(60) + ';border-radius:' + P(30) + '}',
    '.sched{display:flex;align-items:center;gap:' + P(14) + ';min-height:' + P(56) + ';padding:0 ' + P(16) + ' 0 ' + P(14) + ';border-top:1px solid ' + v('line') + '}',
    '.sched:first-child{border-top:0}',
    '.sched .when{width:' + P(74) + ';font-size:' + P(14) + ';font-weight:600;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums}',
    '.sched .mid{flex:1;min-width:0}'
  ].join('\n');

  var TV_RETRY_MS = [5000, 15000, 60000, 300000];
  var VIEWERS = 'sensor.tv_viewers';
  /** @param {any} iso */
  function tvLeft(iso) {
    var m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    if (!(m > 0)) return '';
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm left' : m + 'm left';
  }
  /** @param {any} start @param {any} end */
  function tvProgress(start, end) {
    var s = new Date(start).getTime(), e = new Date(end).getTime(), n = Date.now();
    if (!(e > s)) return 0;
    return Math.max(0, Math.min(100, (n - s) / (e - s) * 100));
  }
  // a channel's letters: its name's initials, or the first three of one word
  /** @param {string} name */
  function letters(name) {
    var w = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return 'TV';
    if (w.length === 1) return w[0].slice(0, 3).toUpperCase();
    return w.map(function (x) { return x.charAt(0); }).join('').slice(0, 3).toUpperCase();
  }

  class HvTv extends MediaPage {
    static get CSS() { return TV_CSS; }
    constructor() {
      super();
      this._channels = null; this._configured = false; this._loading = false; this._tries = 0; this._screens = null; this._vStamp = '';
      this._player = null; this._conn = null; this._tickT = null; this._busyScreen = '';
    }
    _receiveClient() {
      super._receiveClient();
      if (this._player) this._player.update(this.client);
    }
    /** @param {any} ch */
    _info(ch) {
      var st = ch.now ? this.st(ch.now) : null, a = (st && st.attributes) || {};
      var title = st && st.state && st.state !== 'unknown' && st.state !== 'unavailable' ? st.state : 'Live';
      return { title: title, a: a };
    }
    // the channel numbers somebody is watching now (the viewers sensor), and the screens each plays on (hk_tv/screens)
    _watched() {
      var vs = this.st(VIEWERS), a = (vs && vs.attributes) || {};
      return (Array.isArray(a.channels) ? a.channels : []).map(String);
    }
    /** @param {any} ch @param {any} a @param {string} cls @param {string} style */
    _logo(ch, a, cls, style) {
      var gr = 'background:' + grad(ch.number + ch.name);
      if (a.logo) return '<div class="art ct tvlogo ' + cls + '" data-art="' + esc(a.logo) + '" style="' + (style || '') + '"></div>';
      return '<div class="art tvlogo ' + cls + '" style="' + gr + ';' + (style || '') + '">' + esc(letters(ch.name)) + '</div>';
    }
    draw() {
      var title = (this._config || {}).title || 'Live TV', ch = this._channels, self = this;
      var deep = this.deep();
      if (ch === null) return H.head({ title: title }) + '<div class="pl quiet">Loading the channels…</div>';
      if (!ch.length) {
        return H.head({ title: title }) + '<div class="pl quiet">' + (this._configured ? 'No channels yet. Add some in ' + H.esc(H.where('Live TV')) + '.' :
          'Live TV isn’t set up in this house yet.') + '</div>';
      }
      var watched = this._watched();
      if (deep && deep.ch != null) {
        var one = ch.filter(function (/** @type {any} */ c) { return String(c.number) === String(deep.ch); })[0];
        if (one) return this._channel(one, watched);
      }
      var lit = ch.filter(function (/** @type {any} */ c) { return watched.indexOf(String(c.number)) >= 0; });
      var sum;
      if (lit.length === 1) {
        var scr = (this._screens || []).filter(function (/** @type {any} */ s) { return s.playing && String(s.playing.channel) === String(lit[0].number); })[0];
        sum = '<b>' + esc(lit[0].name) + '</b>' + (scr ? ' on ' + esc(scr.name) : ' playing');
      } else sum = lit.length ? '<b>' + lit.length + ' Playing</b>' : '<b>' + ch.length + (ch.length === 1 ? ' Channel' : ' Channels') + '</b>';
      return H.head({ title: title, sum: sum }) + '<div class="grid">' + ch.map(function (/** @type {any} */ c) {
        var inf = self._info(c), on = watched.indexOf(String(c.number)) >= 0, a = inf.a;
        var prog = a.start && a.end ? '<div class="trk"><i data-prog data-s="' + esc(a.start) + '" data-e="' + esc(a.end) + '" style="width:' + tvProgress(a.start, a.end).toFixed(1) +
          '%"></i></div>' : '';
        return H.plate({ cls: 'c2 ch' + (on ? ' lit' : ''), act: 'ch', data: { k: c.number }, label: c.name + ', ' + inf.title },
          self._logo(c, a, '', '') + '<div class="words"><div class="nm">' + esc(c.name) + '</div><div class="st">' + esc(inf.title) + '</div>' + prog + '</div>');
      }).join('') + '</div>';
    }
    // A CHANNEL: its big logo, Now and Next, Play Here, Play On, Later Today
    /** @param {any} ch @param {string[]} watched */
    _channel(ch, watched) {
      var inf = this._info(ch), a = inf.a, self = this, on = watched.indexOf(String(ch.number)) >= 0;
      var out = H.head({ title: ch.name, back: true, sum: on ? '<b>Playing</b>' : 'Channel ' + esc(ch.number) });
      var left = a.end ? tvLeft(a.end) : '';
      var pic = a.image ? '<div class="art big ct" data-art="' + esc(a.image) + '" style="background:#000"></div>' :
        this._logo(ch, a, 'big', 'width:100%;height:' + P(142) + ';border-radius:' + P(24) + ';font-size:' + P(44));
      var l = '<div class="tvl">' + pic + '<div class="lbl lbl-s">' + 'Now' + (left ? ' · ' + esc(left) : '') + '</div><div class="now">' + esc(inf.title) + '</div>' +
        (a.subtitle ? '<div class="st" style="margin-top:' + P(3) + '">' + esc(a.subtitle) + '</div>' : '') +
        (a.start && a.end ? '<div class="trk" style="margin-top:' + P(10) + ';height:' + P(5) + '"><i data-prog data-s="' + esc(a.start) + '" data-e="' + esc(a.end) + '" style="width:' +
          tvProgress(a.start, a.end).toFixed(1) + '%"></i></div>' : '') +
        (a.next_title ? '<div class="lbl-s nxt">Next' + (a.next_start ? ' · ' + esc(H.clock(a.next_start)) : '') + '</div><div class="st" style="font-size:' + P(15) + ';margin-top:' + P(3) + '">' +
          esc(a.next_title) + '</div>' : '') + '</div>';
      var scr = this._screens || [];
      var right = '<div class="tvr">' + H.cap({ g: H.svg('play', 18), t: 'Play Here', cls: 'lg w', act: 'here', data: { k: ch.number }, off: !ch.camera });
      if (scr.length) {
        right += '<div class="pl list c4" style="padding:' + P(6) + ' ' + P(8) + ' ' + P(6) + ' ' + P(10) + '"><div class="lbl-s" style="padding:' + P(8) + ' ' + P(6) + ' ' + P(4) +
          '">Play On</div><div class="rows">' +
          scr.map(function (/** @type {any} */ s) {
            var here = !!(s.playing && String(s.playing.channel) === String(ch.number)), busy = self._busyScreen === s.id;
            var val = busy ? 'Starting…' : here ? 'Playing' : s.playing ? 'In Use' : 'AirPlay';
            return H.row({ g: H.svg('airplay', 22), name: s.name, val: '<span style="font-size:' + P(13) + '">' + val + '</span>', lit: here, act: 'playon', data: { k: s.id } });
          }).join('') + '</div></div>';
      }
      right += '</div>';
      out += '<div class="tvd">' + l + right + '</div>';
      if (a.next_title) {
        out += H.section('Later Today') + '<div class="pl" style="padding:' + P(4) + ' 0"><div class="sched"><div class="when">' + esc(a.next_start ? H.clock(a.next_start) : 'Next') +
          '</div><div class="mid"><div class="nm">' + esc(a.next_title) + '</div></div></div></div>';
      }
      return out;
    }

    // ------------------------------------------------------------ the channel list (the guide card's own asking: hk_tv/channels)
    // asked for after the first draw, again when the socket comes back, and on a back-off while the answer is empty
    _after() {
      var vs = this.client && this.client.states[VIEWERS];
      if (!this._channels && !this._loading) this._fetch();
      this._watchConn();
      var stamp = vs ? vs.last_updated : '';
      if (this._channels && this._channels.length && stamp !== this._vStamp) { this._vStamp = stamp; this._fetchScreens(); }
      this._tickOn();
    }
    _fetch() {
      var self = this, h = this.client;
      if (this._loading || !h || !h.callWS) return;
      clearTimeout(this._chanT); this._chanT = null;
      this._loading = true;
      Promise.resolve(h.callWS({ type: 'hk_tv/channels' })).then(function (/** @type {any} */ r) {
        var list = (r && r.channels) || [];
        if (list.length || !(self._channels && self._channels.length)) { self._channels = list; self._configured = !!(r && r.configured); }
        return list.length > 0;
      }, function () { if (!self._channels) { self._channels = []; self._configured = false; } return false; }).then(function (good) {
        self._loading = false;
        if (good) self._tries = 0; else self._retry();
        self.redraw();
      });
    }
    _retry() {
      if (this.isConnected === false || this._chanT) return;
      var self = this, n = this._tries = (this._tries || 0) + 1;
      this._chanT = setTimeout(function () { self._chanT = null; self._fetch(); }, TV_RETRY_MS[Math.min(n - 1, TV_RETRY_MS.length - 1)]);
    }
    // THE AIRPLAY SCREENS Live TV may be sent to, and what each plays (a host without them says no: nothing to Play On)
    _fetchScreens() {
      var self = this, h = this.client;
      if (!h || !h.callWS) return;
      Promise.resolve(h.callWS({ type: 'hk_tv/screens' })).then(function (/** @type {any} */ r) {
        var list = (r && r.screens) || [];
        if (JSON.stringify(list) !== JSON.stringify(self._screens)) { self._screens = list; self.redraw(); }
      }, function () { /* no paired screens here */ });
    }
    _watchConn() {
      var conn = this.client && this.client.subscriptions, self = this;
      if (this.isConnected === false || !conn || conn === this._conn || typeof conn.addEventListener !== 'function') return;
      this._unwatchConn();
      this._conn = conn;
      this._onReady = function () { self._tries = 0; self._fetch(); self._fetchScreens(); };
      conn.addEventListener('ready', this._onReady);
    }
    _unwatchConn() {
      if (this._conn && this._onReady && typeof this._conn.removeEventListener === 'function') this._conn.removeEventListener('ready', this._onReady);
      this._conn = null; this._onReady = null;
    }
    // the bars move every half minute without drawing the page
    _tick() {
      this._root.querySelectorAll('[data-prog]').forEach(function (/** @type {any} */ el) {
        el.style.width = tvProgress(el.getAttribute('data-s'), el.getAttribute('data-e')).toFixed(1) + '%';
      });
    }
    _tickOn() {
      var self = this, any = !!this._root.querySelector('[data-prog]');
      if (any && !this._tickT && this.isConnected) this._tickT = setInterval(function () { if (!document.hidden) self._tick(); }, 30000);
      else if (!any && this._tickT) { clearInterval(this._tickT); this._tickT = null; }
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      this._watchConn();
      if (this._channels && !this._channels.length) { this._tries = 0; this._fetch(); }
      this._tickOn();
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._tickT) { clearInterval(this._tickT); this._tickT = null; }
      clearTimeout(this._chanT); this._chanT = null;
      this._unwatchConn();
      // leaving the page ends the show: no stream, tuner or hold left behind
      if (this._player) this._player.close();
    }
    // PLAY HERE: Apple's player, full screen, on a HomeView (hkCameras.tvPlayer: Safari's own, with its controls, the system volume and AirPlay)
    /** @param {any} ch */
    _here(ch) {
      var self = this;
      if (!ch || !ch.camera) return;
      needFile('hk-cameras.js').then(function () {
        var W = /** @type {any} */ (window);
        if (!W.hkCameras || !W.hkCameras.tvPlayer) { self._say('The player isn’t ready yet'); return; }
        if (self._player) self._player.close();
        self._player = W.hkCameras.tvPlayer(self, ch);
      });
    }
    // PLAY ON a screen (hk_tv/play_on), or stop what it plays of this channel (hk_tv/play_off)
    /** @param {any} ch @param {string} sid */
    _playOn(ch, sid) {
      var self = this, scr = (this._screens || []).filter(function (/** @type {any} */ s) { return s.id === sid; })[0];
      if (!scr || this._busyScreen) return;
      var stop = !!(scr.playing && String(scr.playing.channel) === String(ch.number));
      this._busyScreen = stop ? '' : sid;
      this.redraw();
      this._ws(stop ? { type: 'hk_tv/play_off', screen: sid } : { type: 'hk_tv/play_on', channel: ch.number, screen: sid }).then(function (/** @type {any} */ got) {
        self._busyScreen = '';
        if (got && got.error) self._say(got.message || 'Couldn’t play there');
        self._fetchScreens();
        self.redraw();
      }, function () { self._busyScreen = ''; self._say('Couldn’t play on ' + scr.name); self.redraw(); });
    }
    /** @param {string} act @param {any} el */
    act(act, el) {
      var k = el.getAttribute('data-k'), ch = this._channels || [];
      var by = function (/** @type {any} */ n) { return ch.filter(function (/** @type {any} */ c) { return String(c.number) === String(n); })[0]; };
      if (act === 'ch') { if (k != null) { this.deep({ ch: k }); this._fetchScreens(); } return true; }
      if (act === 'here') { var d = this.deep(); this._here(by(d && d.ch != null ? d.ch : k)); return true; }
      if (act === 'playon') { var d2 = this.deep(); var c2 = by(d2 && d2.ch); if (c2 && k) this._playOn(c2, k); return true; }
      return false;
    }
  }
  H.register('hk-hv-tv-card', HvTv, 'HK HomeView Live TV', 'The Live TV page on an Apple HomeView: the channels, and one channel deeper.');

  window.hkHvMedia.Music = HvMusic; window.hkHvMedia.Cameras = HvCameras; window.hkHvMedia.Tv = HvTv;
  });
})();
