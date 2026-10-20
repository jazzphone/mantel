// mantel-player.js -- the Mac app's music player (web/home.js ?pane=player; apple/MantelMac).
//
// WHAT IT IS (Avery, 2026-10-19: "a brand new player that is clean and easy to use ... graphic rich and clean, like an
// Apple designer"): one column for the menu bar's popover, and any window, that grows with it --
//
//   the cover, big, over its own blurred, saturated copy filling the background (it settles back a little while
//   paused); the song, the artist and the room; how far in; previous / play-pause / next; the volume; and a row
//   below for where it plays (Speakers, Volume), what comes next (Queue) and something else (Browse).
//
// THE MUSIC IS THE HOUSE'S, AS EVERYWHERE ELSE: what plays is hkMusic's answer for this person (their focus, else what
// plays), and the buttons are the Music page's own requests through the gateway (hk_frontend.music_transport; the
// volume as media_player.volume_set, a group's members together). Speakers / Volume / Queue / Browse are the
// screensaver's panel (hk-saver-panel.js), used as the Music page uses it, unchanged. Nothing here is HK's shared code:
// a Mantel page of its own, so nothing that works on the tablets changes for it.
(function () {
  'use strict';
  if (customElements.get('mantel-player')) return;

  var VOL_EVERY = 200;         // a volume drag sends at most this often (ms)
  var VOL_HOLD = 4000;         // ...and its own value stands this long after, while the house catches up
  var ICON = {
    play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
    pause: 'M7 5h3.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm6.8 0H17a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    next: 'M3.5 6.6v10.8a.8.8 0 0 0 1.24.66L12 13.2v4.2a.8.8 0 0 0 1.24.66l8.1-5.4a.8.8 0 0 0 0-1.32l-8.1-5.4A.8.8 0 0 0 12 6.6v4.2L4.74 5.94A.8.8 0 0 0 3.5 6.6z',
    prev: 'M20.5 6.6v10.8a.8.8 0 0 1-1.24.66L12 13.2v4.2a.8.8 0 0 1-1.24.66l-8.1-5.4a.8.8 0 0 1 0-1.32l8.1-5.4A.8.8 0 0 1 12 6.6v4.2l7.26-4.86a.8.8 0 0 1 1.24.66z',
    note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z',
    vlo: 'M7 9v6h4l5 5V4l-5 5H7z',
    vhi: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z',
    speaker: 'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-5 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    queue: 'M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-5v6.18A3 3 0 1 0 19 20v-7h3v-2z',
    browse: 'M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 5h-3v5.5a2.5 2.5 0 1 1-1-2V5h4v2z'
  };
  function svg(d, cls) { return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }
  function mmss(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  // the volume of what plays: a preset's group and its members, several rooms together, or one room (as the Music page)
  function volumeCalls(ctx, presets, level) {
    if (ctx.kind === 'preset') {
      var p = presets.filter(function (x) { return x.entity === ctx.key; })[0];
      return [{ entity_id: ctx.key, volume_level: level }, { entity_id: (p && p.members) || ctx.members, volume_level: level }];
    }
    if (ctx.members && ctx.members.length > 1) return [{ entity_id: ctx.members.slice(), volume_level: level }];
    return [{ entity_id: ctx.key, volume_level: level }];
  }

  // Sizes follow the window: the cover takes what the words and buttons leave (--art), up to the column's width.
  var CSS = [
    ':host{position:fixed;inset:0;display:block;overflow:hidden;color:#fff;background:#0b0a12;',
    '  font-family:-apple-system,"SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased;',
    '  -webkit-user-select:none;user-select:none;cursor:default;--pad:22px;--ctl:clamp(46px,7.2vh,60px)}',
    // THE BACKGROUND: the cover itself, blurred and saturated to fill everything, darkened toward the bottom
    '.bg{position:absolute;inset:-25%;background:radial-gradient(120% 90% at 30% 10%,#4b2d7a 0%,#1b1530 55%,#0b0a12 100%)}',
    '.bg img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(60px) saturate(1.9) brightness(.78);',
    '  opacity:0;transition:opacity 1.2s ease;transform:scale(1.15)}',
    '.bg img.on{opacity:1}',
    '.veil{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.05) 0%,rgba(0,0,0,.18) 45%,rgba(0,0,0,.55) 100%)}',
    '.col{position:relative;height:100%;max-width:520px;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;',
    '  padding:14px var(--pad) 16px}',
    // THE COVER
    '.stage{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;container-type:size}',
    '.art{position:relative;width:min(100cqw,100cqh);height:min(100cqw,100cqh);border-radius:12px;overflow:hidden;',
    '  background:linear-gradient(145deg,rgba(255,255,255,.16),rgba(255,255,255,.05));',
    '  box-shadow:0 22px 48px rgba(0,0,0,.45),0 4px 12px rgba(0,0,0,.25);transition:transform .55s cubic-bezier(.2,.9,.25,1.15),box-shadow .55s}',
    ':host([paused]) .art{transform:scale(.86);box-shadow:0 10px 26px rgba(0,0,0,.35)}',
    '.art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .6s ease}',
    '.art img.on{opacity:1}',
    '.art .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}',
    '.art .ph svg{width:34%;height:34%;fill:rgba(255,255,255,.38)}',
    // THE SONG
    '.meta{flex:none;display:flex;align-items:flex-end;gap:10px;margin-top:16px}',
    '.words{flex:1;min-width:0}',
    '.title{font-size:18px;font-weight:700;letter-spacing:-.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.artist{font-size:15px;color:rgba(255,255,255,.66);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.room{flex:none;display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;letter-spacing:.2px;color:rgba(255,255,255,.8);',
    '  background:rgba(255,255,255,.14);padding:5px 9px 5px 7px;border-radius:99px;cursor:pointer;max-width:42%;margin-bottom:2px}',
    '.room svg{width:13px;height:13px;fill:currentColor;flex:none}',
    '.room span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.room:hover{background:rgba(255,255,255,.22)}',
    // HOW FAR IN
    '.prog{flex:none;margin-top:14px}',
    '.bar{height:4px;border-radius:2px;background:rgba(255,255,255,.22);overflow:hidden}',
    '.bar i{display:block;height:100%;width:calc(var(--p,0)*100%);background:rgba(255,255,255,.88);border-radius:2px}',
    '.times{display:flex;justify-content:space-between;margin-top:6px;font-size:11px;font-weight:600;color:rgba(255,255,255,.5);',
    '  font-variant-numeric:tabular-nums}',
    // THE BUTTONS
    '.ctl{flex:none;display:flex;align-items:center;justify-content:center;gap:clamp(20px,9vw,44px);margin-top:4px}',
    '.b{display:flex;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;transition:transform .12s,background .2s}',
    '.b svg{fill:#fff}',
    '.b:active{transform:scale(.88)}',
    '.b.sk{width:var(--ctl);height:var(--ctl)}',
    '.b.sk svg{width:44%;height:44%}',
    '.b.pp{width:calc(var(--ctl) * 1.18);height:calc(var(--ctl) * 1.18)}',
    '.b.pp svg{width:52%;height:52%}',
    '.b:hover{background:rgba(255,255,255,.12)}',
    '.b.off{opacity:.35;pointer-events:none}',
    // THE VOLUME
    '.vol{flex:none;display:flex;align-items:center;gap:10px;margin-top:6px}',
    '.vol svg{width:15px;height:15px;fill:rgba(255,255,255,.6);flex:none}',
    '.vt{position:relative;flex:1;height:22px;cursor:pointer;touch-action:none}',
    '.vt::before{content:"";position:absolute;left:0;right:0;top:9px;height:4px;border-radius:2px;background:rgba(255,255,255,.22)}',
    '.vt i{position:absolute;left:0;top:9px;height:4px;border-radius:2px;width:calc(var(--v,0)*100%);background:rgba(255,255,255,.88)}',
    '.vt b{position:absolute;top:4px;left:calc(var(--v,0)*100% - 7px);width:14px;height:14px;border-radius:50%;background:#fff;',
    '  box-shadow:0 1px 4px rgba(0,0,0,.35);opacity:0;transition:opacity .15s}',
    '.vt:hover b,.vt.drag b{opacity:1}',
    '.vol.off{opacity:.35;pointer-events:none}',
    // WHERE, WHAT NEXT, SOMETHING ELSE
    '.row{flex:none;display:flex;justify-content:space-around;margin-top:10px}',
    '.r{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:64px;padding:4px 6px;border-radius:10px;cursor:pointer;',
    '  font-size:10.5px;font-weight:600;color:rgba(255,255,255,.66);transition:background .2s,color .2s}',
    '.r svg{width:20px;height:20px;fill:currentColor}',
    '.r:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.r.on{color:#fff}',
    // THE PANEL (hk-saver-panel.js) rises over the player
    '.mpanel.mp{left:0;top:0;width:100%;height:100%;background:rgba(14,12,22,.72);-webkit-backdrop-filter:blur(30px) saturate(1.4);',
    '  backdrop-filter:blur(30px) saturate(1.4);transform:translateY(100%);transition:transform .38s cubic-bezier(.2,.9,.25,1)}',
    '.mpanel.mp.in{transform:none}',
    '.mpanel.mp .mpbg,.mpanel.mp .mpshade{display:none}',
    '.mpanel.mp .mpin{width:100%!important;height:100%!important}',
    '@media (prefers-reduced-motion:reduce){.art,.mpanel.mp,.bg img,.art img{transition:none}}'
  ].join('\n');

  class MantelPlayer extends HTMLElement {
    constructor() {
      super();
      this._root = this.attachShadow({ mode: 'open' });
      this._root.innerHTML = '<style>' + CSS + '</style>' +
        '<div class="bg"><img alt=""></div><div class="veil"></div>' +
        '<div class="col">' +
        '<div class="stage"><div class="art"><div class="ph">' + svg(ICON.note) + '</div><img alt=""></div></div>' +
        '<div class="meta"><div class="words"><div class="title"></div><div class="artist"></div></div>' +
        '<div class="room" role="button" aria-label="Speakers">' + svg(ICON.speaker) + '<span></span></div></div>' +
        '<div class="prog"><div class="bar"><i></i></div><div class="times"><span class="t0"></span><span class="t1"></span></div></div>' +
        '<div class="ctl"><div class="b sk" data-k="previous" role="button" aria-label="Previous">' + svg(ICON.prev) + '</div>' +
        '<div class="b pp" data-k="play_pause" role="button" aria-label="Play or pause">' + svg(ICON.play, 'ppi') + '</div>' +
        '<div class="b sk" data-k="next" role="button" aria-label="Next">' + svg(ICON.next) + '</div></div>' +
        '<div class="vol">' + svg(ICON.vlo) + '<div class="vt" role="slider" aria-label="Volume"><i></i><b></b></div>' + svg(ICON.vhi) + '</div>' +
        '<div class="row"><div class="r" data-tab="speakers" role="button">' + svg(ICON.speaker) + 'Speakers</div>' +
        '<div class="r" data-tab="queue" role="button">' + svg(ICON.queue) + 'Up Next</div>' +
        '<div class="r" data-tab="browse" role="button">' + svg(ICON.browse) + 'Browse</div></div>' +
        '</div>';
      var q = this._root.querySelector.bind(this._root);
      this._e = { bg: q('.bg img'), art: q('.art img'), ph: q('.art .ph'), title: q('.title'), artist: q('.artist'), room: q('.room'),
                  roomName: q('.room span'), bar: q('.bar'), t0: q('.t0'), t1: q('.t1'), pp: q('.ppi path'), ppBtn: q('.b.pp'),
                  skips: this._root.querySelectorAll('.b.sk'), vol: q('.vol'), vt: q('.vt'), row: q('.row'), col: q('.col') };
      this._pic = null; this._pos = null; this._vol = null; this._drag = null; this._pnl = null; this._next = null; this._target = null;
      this._wire();
    }

    // ---------------------------------------------------------------- the house
    _M() { return window.hkMusic; }
    get client() { var H = window.hkHostClient; return (H && H.current && H.current()) || null; }
    _actions() { var c = this.client; return (c && c.actions) || null; }
    _ctx() {
      var M = this._M(), h = this.client;
      if (!M || !h) return null;
      var r = M.resolve(h);
      return r && r.context ? r.context : null;
    }
    // nothing playing: the rooms the next music plays on (this person's answer until Speakers changes them)
    _targetRooms() {
      var M = this._M();
      if (this._target && this._target.length) return this._target;
      var p = M && this.client ? M.resolve(this.client).player : null;
      var pre = p && M.presets().filter(function (x) { return x.entity === p; })[0];
      return pre ? pre.members.slice() : p ? [p] : [];
    }

    connectedCallback() {
      var self = this;
      this._kick = function () { self._soon(); };
      window.addEventListener('hk-client-update', this._kick);
      window.addEventListener('hk-saver-panel', this._kick);
      window.addEventListener('resize', this._kick);
      if (this._M() && !this._off) this._off = this._M().onChange(this._kick);
      this._tick = setInterval(function () { self._progress(); }, 1000);
      this._render();
    }
    disconnectedCallback() {
      window.removeEventListener('hk-client-update', this._kick);
      window.removeEventListener('hk-saver-panel', this._kick);
      window.removeEventListener('resize', this._kick);
      if (this._off) { this._off(); this._off = null; }
      clearInterval(this._tick);
      this._closePanel(false);
    }
    // at most once a frame: the house hands a new client many times a second
    _soon() {
      var self = this;
      if (this._raf) return;
      this._raf = requestAnimationFrame(function () { self._raf = 0; self._render(); });
    }

    // ---------------------------------------------------------------- drawing
    _render() {
      var h = this.client, M = this._M(), e = this._e;
      if (!h || !M) return;
      var c = this._ctx(), st = c ? h.states[c.key] || {} : {}, a = st.attributes || {};
      if (c && this._target) this._target = null;      // music started: the rooms picked for it have done their job
      var playing = !!c && st.state === 'playing';
      this.toggleAttribute('paused', !playing);
      // the song
      var title = c ? (c.title || a.media_title || 'Playing') : 'Not Playing';
      var artist = c ? [c.artist || a.media_artist, a.media_album_name].filter(Boolean).join(' — ') : '';
      if (e.title.textContent !== title) e.title.textContent = title;
      if (e.artist.textContent !== artist) e.artist.textContent = artist;
      var rooms = c ? M.label(c) : this._targetRooms().map(function (r) { return M.nameOf(r); }).join(', ');
      if (e.roomName.textContent !== (rooms || 'Choose Speakers')) e.roomName.textContent = rooms || 'Choose Speakers';
      // the cover, and its blurred copy behind everything
      var pic = c ? (a.entity_picture_local || a.entity_picture || '') : '';
      if (pic && pic.charAt(0) === '/') pic = location.origin + pic;
      if (pic !== this._pic) this._art(pic);
      // play / pause; the skips only with something playing
      e.pp.setAttribute('d', playing ? ICON.pause : ICON.play);
      e.ppBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      Array.prototype.forEach.call(e.skips, function (b) { b.classList.toggle('off', !c); });
      // how far in
      this._pos = c ? { dur: Number(a.media_duration) || 0, pos: Number(a.media_position) || 0,
                        at: Date.parse(a.media_position_updated_at) || 0, playing: playing } : null;
      this._progress();
      // the volume (a finger's, while it is setting it)
      var v = typeof a.volume_level === 'number' ? a.volume_level : null;
      if (this._vol && (this._drag || Date.now() < this._vol.until)) v = this._vol.val;
      e.vol.classList.toggle('off', !c || v === null);
      e.vt.style.setProperty('--v', String(v || 0));
      if (this._pnl) this._pnl.p.update();
    }
    _progress() {
      var p = this._pos, e = this._e;
      if (!p || !p.dur) { e.bar.style.setProperty('--p', '0'); e.t0.textContent = p ? mmss(p.pos) : ''; e.t1.textContent = ''; return; }
      var t = Math.min(p.dur, p.pos + (p.playing && p.at ? (Date.now() - p.at) / 1000 : 0));
      e.bar.style.setProperty('--p', (t / p.dur).toFixed(4));
      e.t0.textContent = mmss(t);
      e.t1.textContent = '-' + mmss(p.dur - t);
    }
    // a new cover: loaded first, then faded in over the old one (and behind everything, blurred)
    _art(url) {
      var e = this._e, self = this;
      this._pic = url;
      if (!url) {
        e.art.classList.remove('on'); e.bg.classList.remove('on'); e.ph.style.display = '';
        return;
      }
      var img = new Image();
      img.onload = function () {
        if (self._pic !== url) return;
        e.art.src = url; e.bg.src = url;
        e.art.classList.add('on'); e.bg.classList.add('on'); e.ph.style.display = 'none';
      };
      img.onerror = function () { if (self._pic === url) { e.art.classList.remove('on'); e.bg.classList.remove('on'); e.ph.style.display = ''; } };
      img.src = url;
    }

    // ---------------------------------------------------------------- acting
    _call(domain, service, data) {
      var act = this._actions();
      if (!act) return Promise.resolve();
      return Promise.resolve(act.callService(domain, service, data)).catch(function (err) {
        console.error('[mantel-player] ' + domain + '.' + service + ' failed', err);
      });
    }
    _transport(cmd) {
      var c = this._ctx();
      if (c) {
        this._call('hk_frontend', 'music_transport', { player: c.key, command: cmd });
        if (cmd === 'play_pause' && this._pos) {     // drawn now, the house confirms it
          var p = this._pos;
          p.pos = Math.min(p.dur || Infinity, p.pos + (p.playing && p.at ? (Date.now() - p.at) / 1000 : 0));
          p.at = Date.now(); p.playing = !p.playing;
          this.toggleAttribute('paused', !p.playing);
          this._e.pp.setAttribute('d', p.playing ? ICON.pause : ICON.play);
        }
        return;
      }
      // nothing playing: Play starts something to play -- Browse
      if (cmd === 'play_pause') this._openPanel('browse');
    }
    _wire() {
      var self = this, e = this._e;
      this._root.querySelector('.ctl').addEventListener('click', function (ev) {
        var b = ev.target.closest('.b');
        if (b) self._transport(b.getAttribute('data-k'));
      });
      e.room.addEventListener('click', function () { self._openPanel('speakers'); });
      e.row.addEventListener('click', function (ev) {
        var r = ev.target.closest('.r');
        if (r) self._openPanel(r.getAttribute('data-tab'));
      });
      // THE VOLUME: a finger down on the track sets it there and drags it
      var at = function (x) {
        var r = e.vt.getBoundingClientRect();
        return r.width ? Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100) / 100 : null;
      };
      var send = function () {
        var d = self._drag, c = self._ctx(), M = self._M();
        if (d && d.t) { clearTimeout(d.t); d.t = null; }
        if (!self._vol || !c || self._vol.sent === self._vol.val) return;
        if (d) d.sent = Date.now();
        self._vol.sent = self._vol.val;
        volumeCalls(c, M.presets(), self._vol.val).reduce(function (p, data) {
          return p.then(function () { return self._call('media_player', 'volume_set', data); });
        }, Promise.resolve());
      };
      var move = function (x) {
        var v = at(x);
        if (v === null) return;
        self._vol = { val: v, until: Date.now() + VOL_HOLD, sent: self._vol ? self._vol.sent : null };
        e.vt.style.setProperty('--v', String(v));
        var d = self._drag, now = Date.now();
        if (!d) { send(); return; }
        if (now - d.sent >= VOL_EVERY) send(); else if (!d.t) d.t = setTimeout(send, VOL_EVERY - (now - d.sent));
      };
      e.vt.addEventListener('pointerdown', function (ev) {
        if (!self._ctx()) return;
        ev.preventDefault();
        try { e.vt.setPointerCapture(ev.pointerId); } catch (x) { /* gone */ }
        self._drag = { sent: 0, t: null };
        e.vt.classList.add('drag');
        move(ev.clientX);
      });
      e.vt.addEventListener('pointermove', function (ev) { if (self._drag) move(ev.clientX); });
      var up = function () {
        if (!self._drag) return;
        send();
        if (self._drag.t) clearTimeout(self._drag.t);
        self._drag = null;
        e.vt.classList.remove('drag');
        if (self._vol) self._vol.until = Date.now() + VOL_HOLD;
      };
      e.vt.addEventListener('pointerup', up);
      e.vt.addEventListener('pointercancel', up);
    }

    // ---------------------------------------------------------------- the panel
    // Speakers / Volume / Up Next / Browse: the screensaver's panel, risen over the player, as the Music page opens it
    _openPanel(tab) {
      var P = window.hkSaverPanel, self = this;
      if (!P) return;
      if (this._pnl) { if (this._pnl.p.tab() === tab) this._closePanel(true); else { this._pnl.p.show(tab); this._buttons(); } return; }
      if (!this._pcss) {
        var st = document.createElement('style');
        st.textContent = P.CSS + (window.hkCards && window.hkCards.shadeCss ? window.hkCards.shadeCss('.mpanel') : '');
        this._root.insertBefore(st, this._root.firstChild.nextSibling);   // before this card's own, which places it
        this._pcss = true;
      }
      var p = P.create({
        tabs: ['speakers', 'volume', 'queue', 'browse'],
        client: function () { return self.client; },
        ctx: function () { return self._ctx(); },
        art: function () { return null; },
        stop: true,
        target: function () { return self._targetRooms(); },
        setTarget: function (rooms) { self._target = rooms.slice(); self._render(); },
        // playing, its ticks are where the next pick plays (the Music page's rule)
        next: function () { var c = self._ctx(); return c ? (self._next || c.members.slice()) : self._targetRooms(); },
        setNext: function (rooms) { self._next = rooms ? rooms.slice() : null; },
        follow: function (key) { var M = self._M(); if (key && M && M.known(key)) M.setFocus(key); },
        done: function (ms) { clearTimeout(self._doneT); self._doneT = setTimeout(function () { self._closePanel(true); }, ms || 0); },
        wide: function () { return false; }
      });
      p.el.classList.add('mp', 'up');
      this._root.appendChild(p.el);
      p.size(this.clientWidth || window.innerWidth, this.clientHeight || window.innerHeight, 1);
      p.show(tab);
      this._pnl = { p: p };
      requestAnimationFrame(function () { requestAnimationFrame(function () { p.el.classList.add('in'); }); });
      this._buttons();
    }
    _closePanel(animated) {
      var me = this._pnl;
      if (!me) return;
      this._pnl = null;
      clearTimeout(this._doneT);
      me.p.el.classList.remove('in');
      if (animated) setTimeout(function () { me.p.destroy(); }, 400); else me.p.destroy();
      this._buttons();
    }
    _buttons() {
      var t = this._pnl ? this._pnl.p.tab() : '';
      Array.prototype.forEach.call(this._e.row.children, function (r) { r.classList.toggle('on', r.getAttribute('data-tab') === t); });
    }
  }
  customElements.define('mantel-player', MantelPlayer);
})();
